// 第二十八輪批次階段 A4：排表品質統計要有「排表偏好」一節。
// 執行方式：node tests/weight_metrics_section.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 上一輪點解漏咗
// ─────────────────────────────────────────────────────────────────────
//
// 上一輪把 `buildPersonPostWeightReport_()` 接進咗 `runSoftRuleMetrics_()`
// 嘅**彈窗文字**，但冇接進 `buildSoftRuleMetricRows_()`——而後者先係
// 寫入 `Diagnostics` 工作表、幹事真正會讀嗰一份。
//
// 結果：稽核文件寫咗「已加入量度」，實際輸出入面完全冇。
// Ivan 讀晒整份 2027T4 v1 品質統計先發現。
//
// ⚠️ 呢個係本輪最重要嘅一課：**冇量度嘅軟機制等於冇機制**。
// 上一輪個偏好機制由頭到尾完全冇效果，而冇人睇得出，
// 就係因為冇一個地方會印「目標幾多、實際幾多」。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
  // `resolveWeightQuarterLimit_()` 會叫 RoleImpact 嗰個共用嘅上限解析
  // ——三層上限（個人值 ▸ RuleSettings ▸ Config 預設）只可以有一個算法。
  'RoleImpact.gs', 'PersonPostWeight.gs'
]);

// ⚠️ `explainWeightShortfall_()` 會經 `shiftDateString_()` 算前後一週，
// 而嗰個函式尾巴用 `Utilities.formatDate(…, 'UTC', 'yyyy-MM-dd')`。
// 沙箱嘅 GAS 替身係「一碰就拋錯」嘅 Proxy，所以要**整個物件換走**
// ——`gas.Utilities.formatDate = fn` 係冇效嘅（Proxy 連讀屬性都會拋）。
gas.Utilities = {
  formatDate: function (date, tz, pattern) {
    if (tz !== 'UTC' || pattern !== 'yyyy-MM-dd') {
      throw new Error('測試替身只支援 UTC / yyyy-MM-dd，收到：' + tz + ' / ' + pattern);
    }
    return date.toISOString().slice(0, 10);
  }
};

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const metrics = read('src/SoftRuleMetrics.gs');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== A4【核心】接進**寫入 Diagnostics 嗰份**，唔止彈窗 ===');
{
  check('★★★★★ 有 buildPersonPostWeightMetricRows_()',
    /function buildPersonPostWeightMetricRows_\(quarterId, versionNo\)/.test(metrics));
  check('★★★★★ 而且真係接咗落 rows（＝會寫入 Diagnostics 工作表）'
    + '——上一輪就係只接咗彈窗，所以幹事讀嘅嗰份報告完全冇偏好量度',
    /rows = rows\.concat\(buildPersonPostWeightMetricRows_\(/.test(metrics));

  const runBody = metrics.slice(metrics.indexOf('function runSoftRuleMetrics_'));
  check('★★★★★ concat 喺 tryWriteDiagnostics_() **之前**'
    + '——之後先接就等於冇接',
    runBody.indexOf('buildPersonPostWeightMetricRows_')
      < runBody.indexOf('tryWriteDiagnostics_'));
}

console.log('\n=== A4【核心】冇偏好時**唔可以整節消失** ===');
{
  const body = bodyOf(metrics, 'buildPersonPostWeightMetricRows_');
  check('★★★★★ 零項生效時照樣回一行，寫「本季沒有設定任何排表偏好」'
    + '——完全消失嘅話，「冇設定」同「有設定但冇顯示」就分唔開，'
    + '而上一輪出事嘅正正係後者',
    body.indexOf('（本季沒有設定任何排表偏好）') !== -1
    && /weights\.rows\.length === 0 && weights\.invalid\.length === 0/.test(body));
  check('★★★★★ 讀唔到都要留一行（唔可以靜靜整節唔見）',
    /catch \(err\)[\s\S]{0,300}?（讀不到）/.test(body));
  check('★★★★ 而且講明「查不到不代表沒有偏好生效」',
    body.indexOf('這一節查不到，不代表沒有偏好生效') !== -1);
}

console.log('\n=== A4 逐行要有：上一季、偏好、目標、實際、差、未達標原因 ===');
{
  const body = bodyOf(metrics, 'buildPersonPostWeightMetricRows_');
  ['目標 ', '實際 ', '差 ', '上一季 ', '偏好 '].forEach(function (piece) {
    check('★★★★ 逐行有「' + piece.trim() + '」', body.indexOf(piece) !== -1);
  });
  check('★★★★★ 未達標要講得出係邊條規則擋住，唔可以只寫「未達標」三個字',
    /未達標原因：' \+ r\.shortfallText/.test(body));
  check('★★★★ 達標嗰啲標 ✅（一眼分得出）', body.indexOf('✅ 達標') !== -1);
  check('★★★★★ 超出範圍嘅行照樣列出，而且講明「完全沒有生效」',
    /weights\.invalid\.forEach/.test(body)
    && body.indexOf('這一行完全沒有生效') !== -1);
}

console.log('\n=== A4【核心】報告用嘅目標，同排表計分用嘅係同一個數 ===');
{
  const src = read('src/PersonPostWeight.gs');
  const reportBody = bodyOf(src, 'buildPersonPostWeightReport_');
  check('★★★★★ 報告直接用 `w.target`（＝ computePersonPostWeightBonus_ 用嗰個）'
    + '——舊做法用「該崗位平均 ＋ 偏好」，'
    + '而嗰個平均係由呢一次生成嘅結果算返出嚟，偏好一生效佢自己都會升，'
    + '即係一個追唔到嘅目標，而且同排表實際追嘅嘢完全無關',
    /const target = \(w\.target === null \|\| w\.target === undefined\)/.test(reportBody));
  check('★★★★★ 「未達標」門檻係 0（目標已經係整數，差一次就係差一次）'
    + '——舊版用 0.5，因為舊目標值係小數；而家用返 0.5 就會漏報差一次嘅情況',
    /const shortfall = target - got;/.test(reportBody)
    && /const explained = shortfall > 0\s*\n/.test(reportBody)
    && !/shortfall > 0\.5/.test(reportBody));

  // 兩處讀基準嘅呼叫都要傳 baselineData，否則目標會退化成「0 ＋ 偏好」。
  const calls = (metrics.match(/readActivePersonPostWeights_\([\s\S]{0,120}?\)/g) || []);
  check('★★★★★ SoftRuleMetrics 入面每一個 readActivePersonPostWeights_() 都傳咗基準資料',
    calls.length >= 2 && calls.every(function (c) {
      return c.indexOf('buildWeightBaselineData_') !== -1;
    }), calls.join(' ／ '));
}

console.log('\n=== A4 報告行內容（真係跑一次）===');
{
  const weights = {
    rows: [{
      personId: 'P9001', postId: 'DEACON', adjust: 1, reason: '堂委決議',
      baseline: 1, baselineSource: gas.WEIGHT_BASELINE_SOURCE.PREV_QUARTER,
      baselineLabel: '2026年10-12月', target: 2
    }],
    invalid: []
  };
  const assignments = [
    { personId: 'P9001', postId: 'DEACON', serviceDate: '2027-01-03' },
    { personId: 'P9002', postId: 'DEACON', serviceDate: '2027-01-10' }
  ];
  const report = gas.buildPersonPostWeightReport_(
    assignments, weights,
    { P9001: { personId: 'P9001', nameTC: '測試甲', maxPerQuarter: 8 } },
    { DEACON: '當值堂委' }, { rules: {}, defaultLimit: 8 });

  const row = report.rows[0];
  check('★★★★★ 目標用基準 ＋ 偏好（1 ＋ 1 ＝ 2），唔係「平均 ＋ 偏好」',
    row.targetCount === 2, JSON.stringify(row));
  check('★★★★ 實際 1 次、差 -1', row.actualCount === 1 && row.gap === -1);
  check('★★★★★ 未達標，而且講得出原因', row.met === false && row.shortfallText.length > 0,
    row.shortfallText);
  check('★★★★ 基準文字講得出係邊一季',
    row.baselineText.indexOf('2026年10-12月') !== -1, row.baselineText);
  check('★★★★★ 冇偏好時回一句「目前沒有任何生效中的偏好」，唔係空白',
    gas.buildPersonPostWeightReport_([], { rows: [], invalid: [] }, {}, {})
      .lines.join('').indexOf('目前沒有任何生效中的偏好') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
