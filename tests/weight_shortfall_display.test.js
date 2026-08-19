// 第二十九輪批次階段 C：偏好未達標／超標，要喺「排表偏好」畫面自己解釋。
// 執行方式：node tests/weight_shortfall_display.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 背景
// ─────────────────────────────────────────────────────────────────────
//
// 畫面已經顯示 `上一季 N 次　→　今季目標 M 次　今季已排 K 次`
//（呢個係上一輪做嘅，Ivan 覺得好過原本要求嘅「加一節統計」，保留）。
//
// 但 `K ≠ M` 嗰陣完全冇講點解。原因收咗喺選單「軟規則實測量度」，
// 而幹事根本唔會去嗰度——佢喺呢一頁只會得出一個結論：
// **「呢個功能壞咗」。**
//
// ⚠️ 而且未達標同超標**兩邊都要講**。
// 「今季目標 2 次　今季已排 3 次」而冇下文，同「乜都冇發生」一樣難解。
//
// ⚠️ 最緊要嗰條：**唔可以喺前端另寫一套判斷**。
// 一律行 `buildPersonPostWeightReport_()`——同 `Diagnostics` 嗰一節、
// 同選單版嗰個工具用嘅係同一份計算。另寫一次就係
// 「同一件事兩個真相來源」，本專案撞過最多次嗰類問題。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RoleImpact.gs',
  'PersonPostWeight.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// `shiftDateString_()` 要 `Utilities.formatDate`（原因判斷會拎前後一週嚟比較）。
// ⚠️ 沙箱嘅 `Utilities` 係一個會拋錯嘅 Proxy，所以要**整個換走**，
// 唔可以只加一個屬性上去。
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    if (fmt !== 'yyyy-MM-dd') throw new Error('測試只支援 yyyy-MM-dd：' + fmt);
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1)
      + '-' + pad(date.getUTCDate());
  }
};

// ⚠️ 假 PersonID 一律 P9xxx，假名一律明顯係假。
const POST = 'ANNOUNCE';
const postNames = {}; postNames[POST] = '報告';
const peopleById = {
  P9001: { personId: 'P9001', nameTC: '測試甲' },
  P9002: { personId: 'P9002', nameTC: '測試乙' },
  P9003: { personId: 'P9003', nameTC: '測試丙' }
};

function weights(adjust, target, baseline) {
  const row = {
    personId: 'P9001', postId: POST, adjust: adjust,
    baseline: baseline === undefined ? 1 : baseline,
    baselineSource: gas.WEIGHT_BASELINE_SOURCE.PREV_QUARTER,
    target: target, reason: '測試'
  };
  return { rows: [row], byKey: { 'P9001|ANNOUNCE': row }, invalid: [] };
}

/** 砌一批派工：`dates` 係 [{date, personId}]。 */
function assignments(list) {
  return list.map(function (x) {
    return { personId: x.p, postId: POST, serviceDate: x.d };
  });
}

const D = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24', '2027-01-31'];

console.log('\n=== C【核心】未達標：一句原因，唔可以淨係得個數字 ===');
{
  // 目標 3 次，但每季上限 2 次而佢已經排咗 2 次 ⇒ 撞上限。
  const report = gas.buildPersonPostWeightReport_(
    assignments([{ d: D[0], p: 'P9001' }, { d: D[1], p: 'P9001' },
      { d: D[2], p: 'P9002' }, { d: D[3], p: 'P9003' }]),
    weights(2, 3), peopleById, postNames,
    { rules: {}, defaultLimit: 2 });
  const row = report.rows[0];
  check('★★★★★ 未達標 ⇒ `gapText` 有嘢',
    row.met === false && row.gapText !== '', JSON.stringify(row.gapText));
  check('★★★★★ 而且以「未達標：」開頭（幹事一眼睇到係邊個方向）',
    row.gapText.indexOf('未達標：') === 0, row.gapText);
  check('★★★★★ 講得出真正嗰個原因（撞每季上限）'
    + '——「未達標」三個字本身冇資訊',
    row.gapText.indexOf('撞到每季上限') !== -1, row.gapText);
  check('★★★★★ 而且 `gapText` 同 `shortfallText` 同源（唔係另寫一句）',
    row.gapText === '未達標：' + row.shortfallText);
}

console.log('\n=== C【核心】超標：亦要一句原因 ===');
{
  // 目標 1 次，但呢個崗位五個主日得三個人排 ⇒ 佢會被排到多過目標。
  const report = gas.buildPersonPostWeightReport_(
    assignments([{ d: D[0], p: 'P9001' }, { d: D[1], p: 'P9002' },
      { d: D[2], p: 'P9001' }, { d: D[3], p: 'P9003' }, { d: D[4], p: 'P9001' }]),
    weights(0, 1), peopleById, postNames,
    { rules: {}, defaultLimit: 8 });
  const row = report.rows[0];
  check('★★★★★ 排到多過目標 ⇒ `gapText` 一樣有嘢'
    + '——「目標 1 次　已排 3 次」而冇下文，同乜都冇發生一樣難解',
    row.actualCount === 3 && row.targetCount === 1 && row.gapText !== '',
    JSON.stringify(row));
  check('★★★★★ 以「比目標多 N 次：」開頭，而且 N 講啱',
    row.gapText.indexOf('比目標多 2 次：') === 0, row.gapText);
  check('★★★★★ 講得出最常見嗰個正解：偏好係軟嘅，排夠之後唔會擋住佢'
    + '——幹事唔會自己知呢一點，而佢正正就係「明明設咗但仲係多咗」嘅答案',
    row.gapText.indexOf('排夠目標之後系統只是不再為他加分') !== -1, row.gapText);
  check('★★★★ 人少格多嗰陣亦講返（5 個主日、3 個人）',
    row.gapText.indexOf('5 個主日') !== -1 && row.gapText.indexOf('3 位不同的人') !== -1,
    row.gapText);
  check('★★★★★ `met` 仍然係 true——**超標唔係「未達標」**，'
    + '兩者混做一個旗標就會喺統計入面數錯',
    row.met === true);
}

console.log('\n=== C 啱啱好等於目標 ⇒ 冇嘢要講 ===');
{
  const report = gas.buildPersonPostWeightReport_(
    assignments([{ d: D[0], p: 'P9001' }, { d: D[1], p: 'P9001' },
      { d: D[2], p: 'P9002' }]),
    weights(1, 2), peopleById, postNames, { rules: {}, defaultLimit: 8 });
  const row = report.rows[0];
  check('★★★★★ 目標 2、實際 2 ⇒ `gapText` 係空字串'
    + '——冇差距而印一句解釋，等於教幹事忽略呢個位',
    row.targetCount === 2 && row.actualCount === 2 && row.gapText === '',
    JSON.stringify(row));
}

console.log('\n=== C 上限查不到 ⇒ 講「查不到」，唔可以當「冇上限」 ===');
{
  const report = gas.buildPersonPostWeightReport_(
    assignments([{ d: D[0], p: 'P9001' }]),
    weights(2, 3), peopleById, postNames, null);
  check('★★★★★ 冇傳上限資料 ⇒ 明講「每季上限查不到」'
    + '——當成「冇上限」就係缺失被當成正常值靜靜過',
    report.rows[0].gapText.indexOf('每季上限查不到') !== -1,
    report.rows[0].gapText);
}

console.log('\n=== C【核心】畫面同後端：一個欄位、一份計算 ===');
{
  const zone3 = read('src/ui/ScriptZone3.html');
  const backend = read('src/WebAppWeightEdit.gs');

  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  const zone3Code = stripComments(zone3);

  check('★★★★★ 畫面直接印 `person.gapText`',
    /person\.gapText\) \{[\s\S]{0,200}?'⚠ ' \+ person\.gapText/.test(zone3), 'weightRow');
  check('★★★★★ **畫面冇自己比較目標同實際**'
    + '——前端自己判斷方向再砌一句，就係同一件事兩個真相來源',
    !/thisQuarterCount\s*[<>]\s*/.test(zone3Code)
    && !/person\.target\s*[<>!=]==?\s*person\.thisQuarterCount/.test(zone3Code));
  check('★★★★★ 亦冇喺前端出現「未達標」「比目標多」呢啲字面'
    + '（文案一律由後端出）',
    zone3Code.indexOf('未達標') === -1 && zone3Code.indexOf('比目標多') === -1);

  check('★★★★★ 後端行 `buildPersonPostWeightReport_()`，唔係另寫一套',
    /buildPersonPostWeightReport_\(\s*\n?\s*assignments, active, peopleById, postNames/
      .test(backend));
  check('★★★★★ 而且只搬 `gapText` 出去（唔會前端再拆 reasons 自己砌）',
    /if \(r\.gapText\) byKey\[r\.personId \+ '\|' \+ r\.postId\] = r\.gapText;/.test(backend));
  check('★★★★★ 未有版本／讀取失敗 ⇒ 回 `null`（查不到），'
    + '**唔係一個空 map**——兩者意思相反',
    /if \(versionNo < 0\) return null;/.test(backend)
    && /gapAvailable: gapByKey !== null/.test(backend));
  check('★★★★ 一條偏好都冇 ⇒ 回空 map（查得到，只係冇嘢講）',
    /if \(!active \|\| !active\.rows \|\| active\.rows\.length === 0\) \{[\s\S]{0,200}?return \{\};/
      .test(backend));
  check('★★★★★ 日期經 `toDateString()` 正規化先用'
    + '——由工作表讀出嚟可能係 Date 物件，而原因判斷會攞佢做前後一週比較',
    /serviceDate: toDateString\(row\[A\.SERVICE_DATE\], timezone\)/.test(backend));
  check('★★★★★ 每季上限讀唔到 ⇒ 傳 `null`，唔係傳一個估出嚟嘅數',
    /function buildWeightLimitContextSafely_[\s\S]{0,400}?catch \(err\) \{[\s\S]{0,200}?return null;/
      .test(backend));
}

console.log('\n=== C 同 Diagnostics 那一節仍然同源 ===');
{
  const metrics = read('src/SoftRuleMetrics.gs');
  check('★★★★★ `Diagnostics` 嗰一節都係行同一個 `buildPersonPostWeightReport_()`',
    (metrics.match(/buildPersonPostWeightReport_\(/g) || []).length >= 2);
  check('★★★★ 文字輸出用返 `gapText`（未達標同超標都會出）',
    /if \(row\.gapText\) lines\.push/.test(read('src/PersonPostWeight.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
