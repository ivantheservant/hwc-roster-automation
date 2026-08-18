// 第二十七輪批次階段 B：排表偏好收尾——建表工具，同「偏好未生效時要解釋」。
// 執行方式：node tests/person_post_weight_limit_feedback.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢一輪修緊嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// 上一輪嘅離線驗收：四行偏好之中兩行「冇變」。
// 機制係啱嘅——嗰兩位已經撞到 `MaxPerQuarter`，而偏好係軟嘅，
// 唔會為咗滿足偏好而突破上限。
//
// **但幹事揀咗「多一次」而乜都冇發生，畫面唔會解釋點解。**
// 佢只會得出一個結論：「呢個功能壞咗」，然後去做一啲更危險嘅嘢
// （例如去取消／新增人哋嘅崗位資格——嗰個係完全唔同、而且好難復原嘅事）。
//
// 所以本輪加兩樣：
//   1. 畫面上即場講「呢位已經接近每季上限，加『多一次』可能唔會生效」
//   2. 品質統計逐行講得出**係邊一條規則擋住**，唔可以只寫「未達標」

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
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

/* ══════════════════════════════════════════════════════════════
 * B1：建表工具
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B1 建表工具：欄位齊全、有說明 ===');
{
  const src = read('src/PersonPostWeight.gs');

  check('★★★★★ 有 ensurePersonPostWeightSheet_()',
    typeof gas.ensurePersonPostWeightSheet_ === 'function');
  check('★★★★★ 中文標題數目 ＝ 機器鍵數目'
    + '——兩邊唔等長嘅話，工作表建咗出嚟但欄位對唔上，而且睇落完全正常',
    gas.PERSON_POST_WEIGHT_HEADERS_TC.length
      === gas.getPersonPostWeightHeaderKeys_().length,
    gas.PERSON_POST_WEIGHT_HEADERS_TC.length + ' vs '
      + gas.getPersonPostWeightHeaderKeys_().length);

  // 逐個機器鍵都要係 COLUMNS 入面真正嗰個，唔可以喺呢度另打一次字。
  const keys = gas.getPersonPostWeightHeaderKeys_();
  const declared = Object.keys(gas.COLUMNS.PERSON_POST_WEIGHT)
    .map((k) => gas.COLUMNS.PERSON_POST_WEIGHT[k]);
  check('★★★★★ 十個欄位一個都冇漏（同 COLUMNS 完全對得上）',
    declared.every((c) => keys.indexOf(c) !== -1) && keys.length === declared.length,
    '表頭：' + keys.join('、'));

  check('★★★★★ 「偏好」那一欄的標題寫明範圍同正負代表咩'
    + '——只寫 Adjust 嘅話，幹事會唔知 -1 定 +1 先係「少做」',
    gas.PERSON_POST_WEIGHT_HEADERS_TC.some(
      (h) => h.indexOf('正數') !== -1 && h.indexOf('負數') !== -1));
  check('★★★★★ 「解除日」那一欄的標題寫明「不要刪除整行」'
    + '——刪咗行就冇咗「當時堂委係點決定」嘅紀錄',
    gas.PERSON_POST_WEIGHT_HEADERS_TC.some((h) => h.indexOf('不要刪除整行') !== -1));
  check('★★★★ 「原因」那一欄的標題講明點解要填',
    gas.PERSON_POST_WEIGHT_HEADERS_TC.some((h) => h.indexOf('原因') === 0));

  check('★★★★★ 已存在時完全唔動（沿用 ensureSimpleSheet_，佢查到就即刻回）',
    /ensureSimpleSheet_\(\s*\n?\s*SHEETS\.PERSON_POST_WEIGHT/.test(src));
  check('★★★★ 有選單入口 runEnsurePersonPostWeightSheet_()',
    /function runEnsurePersonPostWeightSheet_/.test(src));
  check('★★★★★ 而且會寫 AuditLog（建表都係一個改動）',
    /writeAuditLog_\(\{[\s\S]{0,300}?SHEETS\.PERSON_POST_WEIGHT/.test(src));
}

console.log('\n=== B1 三個地方都要認得呢張表 ===');
{
  check('★★★★★ 選單「維護」有「補建排表偏好工作表」',
    read('src/Menu.gs').indexOf(
      ".addItem('補建排表偏好工作表', 'runEnsurePersonPostWeightSheet_')") !== -1);

  const fresh = read('src/FreshEnvironmentCheck.gs');
  check('★★★★★ 全新環境自我檢查認得佢',
    /sheet: SHEETS\.PERSON_POST_WEIGHT/.test(fresh));
  check('★★★★★ 而且講明「缺少時不會出錯」'
    + '——寫成必要表嘅話，一個正常環境會被報成有問題',
    /SHEETS\.PERSON_POST_WEIGHT[\s\S]{0,400}?缺少時不會出錯/.test(fresh));

  const diag = read('src/Diagnostics.gs');
  check('★★★★★ 匯出關鍵狀態有 PersonPostWeight 一節',
    /section\('PersonPostWeight'/.test(diag));
  check('★★★★★ 而且分得出「工作表尚未建立」同「已建立但空白」'
    + '——兩者都係「零項生效」，但下一步要做嘅事完全唔同',
    diag.indexOf('（工作表尚未建立）') !== -1);
}

/* ══════════════════════════════════════════════════════════════
 * B2：未達標要講得出係邊條規則擋住
 * ══════════════════════════════════════════════════════════════ */

// ⚠️ 假 PersonID 一律用 P9xxx，假名一律明顯係假（本專案硬規定）。
const W = { personId: 'P9001', postId: 'CHAIR', adjust: 1 };
const A = (personId, postId, serviceDate) =>
  ({ personId: personId, postId: postId, serviceDate: serviceDate });

console.log('\n=== B2【核心】撞到每季上限——就係實測嗰兩行「冇變」嘅原因 ===');
{
  // P9001 本季已經排咗 8 次（其他崗位），上限 8。
  const assignments = [];
  ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24',
    '2027-01-31', '2027-02-07', '2027-02-14', '2027-02-21'].forEach((d) => {
    assignments.push(A('P9001', 'USHER', d));
    assignments.push(A('P9002', 'CHAIR', d));
  });

  const out = gas.explainWeightShortfall_(W, 2, 0, assignments, 8);
  check('★★★★★ 講得出係「撞到每季上限」，而且把上限同已排次數都寫出嚟',
    out.text.indexOf('每季上限') !== -1 && out.text.indexOf('8') !== -1,
    out.text);
  check('★★★★★ 而且解釋咗點解系統唔會為咗偏好而突破'
    + '——唔解釋嘅話，幹事會覺得個功能壞咗',
    out.text.indexOf('偏好是軟的') !== -1, out.text);
}

console.log('\n=== B2【核心】上限查不到 ⇒ 要講「查不到」，唔可以當成「未到上限」 ===');
{
  const out = gas.explainWeightShortfall_(W, 2, 0, [A('P9002', 'CHAIR', '2027-01-03')], null);
  check('★★★★★ 明確講「每季上限查不到」'
    + '——當成「冇上限」就係本專案最常撞嗰個 bug class：'
    + '一個缺失被當成一個有意義嘅值靜靜過',
    out.text.indexOf('每季上限查不到') !== -1, out.text);
  check('★★★★ 而且明確講「無法判斷」，唔會扮到已經檢查過',
    out.text.indexOf('無法判斷') !== -1, out.text);
}

console.log('\n=== B2 該崗位格數不足 ===');
{
  // CHAIR 本季只有兩個主日要排，但目標係 5 次。
  const assignments = [A('P9002', 'CHAIR', '2027-01-03'), A('P9002', 'CHAIR', '2027-01-10')];
  const out = gas.explainWeightShortfall_(W, 5, 0, assignments, 8);
  check('★★★★★ 講得出「這個崗位這一季只有 2 個主日要排」',
    out.text.indexOf('只有 2 個主日') !== -1, out.text);
}

console.log('\n=== B2 同一日已經喺其他崗位服侍 ===');
{
  const assignments = [
    A('P9002', 'CHAIR', '2027-01-03'), A('P9001', 'USHER', '2027-01-03'),
    A('P9002', 'CHAIR', '2027-01-10'), A('P9001', 'USHER', '2027-01-10')
  ];
  const out = gas.explainWeightShortfall_(W, 2, 0, assignments, 8);
  check('★★★★★ 講得出「有 2 個主日他當天已經在其他崗位服侍」',
    out.text.indexOf('2 個主日他當天已經在其他崗位服侍') !== -1, out.text);
}

console.log('\n=== B2 連續兩週（準硬規則）===');
{
  // P9001 喺 01-10 做咗 CHAIR，所以 01-03 同 01-17 都會構成連續兩週。
  const assignments = [
    A('P9002', 'CHAIR', '2027-01-03'),
    A('P9001', 'CHAIR', '2027-01-10'),
    A('P9002', 'CHAIR', '2027-01-17')
  ];
  const out = gas.explainWeightShortfall_(W, 3, 1, assignments, 8);
  check('★★★★★ 講得出「會造成同一崗位連續兩週（準硬規則）」',
    out.text.indexOf('連續兩週') !== -1, out.text);
  check('★★★★ 而且係 2 個主日（前一週同後一週）',
    out.text.indexOf('2 個主日會造成') !== -1, out.text);
}

console.log('\n=== B2 一般競爭：講「其他人更需要平均」而唔係扮唔知 ===');
{
  const assignments = [
    A('P9002', 'CHAIR', '2027-01-03'), A('P9003', 'CHAIR', '2027-01-10')
  ];
  const out = gas.explainWeightShortfall_(W, 2, 0, assignments, 8);
  check('★★★★ 講得出係一般嘅平均分配',
    out.text.indexOf('其他人更需要平均') !== -1, out.text);
  check('★★★★★ 任何情況下都唔會只留一句「未達標」'
    + '——講唔出邊條規則擋住，就等於冇解釋過',
    out.reasons.length > 0);
}

console.log('\n=== B2 報告：達標嘅唔加噪音，未達標嘅一定有原因 ===');
{
  const weights = {
    rows: [{ personId: 'P9001', postId: 'CHAIR', adjust: 1, reason: '堂委決議' }],
    invalid: []
  };
  const people = { P9001: { personId: 'P9001', nameTC: '測試甲', maxPerQuarter: 8 } };
  const postNames = { CHAIR: '主席' };
  const ctx = { rules: {}, defaultLimit: 8 };

  // 未達標：P9001 已經排滿 8 次
  const busy = [];
  for (let i = 0; i < 8; i++) busy.push(A('P9001', 'USHER', '2027-01-0' + (i + 1)));
  ['2027-02-07', '2027-02-14', '2027-02-21'].forEach((d) => busy.push(A('P9002', 'CHAIR', d)));

  const short = gas.buildPersonPostWeightReport_(busy, weights, people, postNames, ctx);
  check('★★★★★ 未達標嗰行有「未達標原因」，而且講得出係每季上限',
    short.lines.some((l) => l.indexOf('未達標原因') !== -1 && l.indexOf('每季上限') !== -1),
    short.lines.join('\n'));
  check('★★★★ rows 入面有 met=false 同 shortfallReasons',
    short.rows[0].met === false && short.rows[0].shortfallReasons.length > 0);

  // 達標：P9001 做咗 2 次 CHAIR，其他人各 1 次 ⇒ 平均約 1.33，目標約 2.33
  const ok = [
    A('P9001', 'CHAIR', '2027-01-03'), A('P9001', 'CHAIR', '2027-01-17'),
    A('P9002', 'CHAIR', '2027-01-10'), A('P9003', 'CHAIR', '2027-01-24')
  ];
  const okReport = gas.buildPersonPostWeightReport_(ok, weights, people, postNames, ctx);
  check('★★★★ 差距喺四捨五入範圍內就唔報原因'
    + '——目標值本身係小數，差 0.3 次唔算「冇生效」，'
    + '每行都報一堆原因只會令真正有問題嗰行淹沒咗',
    okReport.rows[0].met === true
      && !okReport.lines.some((l) => l.indexOf('未達標原因') !== -1),
    JSON.stringify(okReport.rows[0]));
}

console.log('\n=== B2 每季上限只可以有一個算法 ===');
{
  const src = read('src/PersonPostWeight.gs');
  check('★★★★★ resolveWeightQuarterLimit_() 重用 RoleImpact 嗰個'
    + '——自己再寫一次「個人值 ?? Config 預設」會漏咗 RuleSettings 嘅'
    + ' TargetValue，即係排表用一個上限、報告用另一個',
    /resolvePersonQuarterLimit_\(person, ctx\.rules, Number\(ctx\.defaultLimit\)\)/.test(src));
  check('★★★★★ 冇 rules 就回 null（＝查不到），唔會硬撐一個值出嚟',
    gas.resolveWeightQuarterLimit_({ maxPerQuarter: null }, null) === null);
  check('★★★★ 個人值優先',
    gas.resolveWeightQuarterLimit_({ maxPerQuarter: 3 }, { rules: {}, defaultLimit: 8 }) === 3);
  check('★★★★ 冇個人值就用預設',
    gas.resolveWeightQuarterLimit_({ maxPerQuarter: null }, { rules: {}, defaultLimit: 8 }) === 8);
}

console.log('\n=== B2 畫面：接近上限即場講，查不到就講查不到 ===');
{
  const zone3 = read('src/ui/ScriptZone3.html');
  const backend = read('src/WebAppWeightEdit.gs');

  check('★★★★★ 前端用規格指定嗰句文案',
    zone3.indexOf('這位已經接近每季上限（') !== -1
    && zone3.indexOf('，加「多一次」可能不會生效。') !== -1);
  check('★★★★★ 已經排滿嘅講法更肯定（「不會生效」而唔係「可能不會」）'
    + '——已經到咗上限係一個確定嘅事實，唔應該講成猜測',
    zone3.indexOf('加「多一次」不會生效') !== -1);
  check('★★★★★ quarterLoad 係 null（查不到）嗰陣**唔講**'
    + '——講「他還沒有接近上限」等於話「已經檢查過」，而根本冇檢查過',
    /const load = person\.quarterLoad;[\s\S]{0,120}?if \(load && load\.near\)/.test(zone3));
  check('★★★★★ 而且畫面頂會講出「點解查不到」',
    /if \(!weightData\.loadAvailable\)/.test(zone3));

  check('★★★★★ 後端分開 available 同 byPerson 兩件事',
    /available: true, reason: '', byPerson: byPerson/.test(backend));
  check('★★★★★ 未有版本 ⇒ available=false ＋ 講原因（唔係當成零次）',
    /versionNo < 0/.test(backend) && backend.indexOf('還沒有生成過任何版本') !== -1);
  check('★★★★★ 讀取失敗都係 available=false（唔會靜靜當成「冇人接近上限」）',
    /catch \(err\) \{[\s\S]{0,240}?return none\(/.test(backend));
  check('★★★★ 上限查不到嘅人**唔會**放入 byPerson（唔擺一個估出嚟嘅值）',
    /if \(limit === null\) return;/.test(backend));
  check('★★★★ 前端把季度傳落去（唔傳嘅話後端永遠答「查不到」）',
    /apiGetPersonPostWeightMatrix', currentQuarterId/.test(zone3));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
