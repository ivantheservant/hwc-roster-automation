// 第十九輪批次階段 F／G：Requests 跨季度日期驗證、日期格式錯誤訊息、套用摘要結論句。
// 執行方式：node tests/requests_dates_and_summary.test.js

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  'Roles.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'RequestsSheet.gs', 'RequestsApply.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/** 造一列 Quarters 資料（只填測試用得到嘅兩欄）。 */
function quarterRow(quarterId, endDate) {
  const row = {};
  row[gas.COLUMNS.QUARTERS.QUARTER_ID] = quarterId;
  row[gas.COLUMNS.QUARTERS.END_DATE] = endDate;
  return row;
}

console.log('\n=== F1【核心】日期選單要涵蓋全部仍然有效嘅季度 ===');
{
  const today = '2026-08-17';
  const rows = [
    quarterRow('2026T2', '2026-06-28'),   // 已過期
    quarterRow('2026T3', '2026-09-27'),   // 進行中
    quarterRow('2026T4', '2026-12-27'),   // 未來
    quarterRow('2027T1', '2027-03-28')    // 未來
  ];

  checkEqual('★★★★★ 未過期嘅季度全部納入'
    + '（實測問題：幹事處理 2026T4 嘅申報，選單只有 2027T1 嘅日期，'
    + '要人手打字，打完出紅色三角）',
    gas.selectValidQuarterIdsForRequests_(rows, '', today, 'Pacific/Auckland'),
    ['2026T3', '2026T4', '2027T1']);

  checkEqual('★★★★★ 指名嘅季度即使已過期都要納入'
    + '（幹事有可能要補做／修正一個已完結季度嘅紀錄）',
    gas.selectValidQuarterIdsForRequests_(rows, '2026T2', today, 'Pacific/Auckland'),
    ['2026T2', '2026T3', '2026T4', '2027T1']);

  checkEqual('★★★★ 指名一個本來就有效嘅季度唔會重複',
    gas.selectValidQuarterIdsForRequests_(rows, '2026T4', today, 'Pacific/Auckland'),
    ['2026T3', '2026T4', '2027T1']);
}

console.log('\n=== F1：邊界情況 ===');
{
  const today = '2026-08-17';
  checkEqual('★★★★★ EndDate 空白時當佢有效（缺失唔應該被當成「已過期」'
    + '呢個有意義嘅答案——第十八輪嗰個 bug class）',
    gas.selectValidQuarterIdsForRequests_(
      [quarterRow('2026T4', '')], '', today, 'Pacific/Auckland'),
    ['2026T4']);
  checkEqual('★★★★ 啱啱好今日完結嘅季度仍然算有效',
    gas.selectValidQuarterIdsForRequests_(
      [quarterRow('2026T3', today)], '', today, 'Pacific/Auckland'),
    ['2026T3']);
  checkEqual('★★★ 冇 QuarterID 嘅列會被略過，唔會爆',
    gas.selectValidQuarterIdsForRequests_(
      [quarterRow('', '2027-01-01')], '', today, 'Pacific/Auckland'),
    []);
  checkEqual('★★★ 空表唔會爆',
    gas.selectValidQuarterIdsForRequests_([], '', today, 'Pacific/Auckland'), []);
}

console.log('\n=== F3【核心】日期對唔上時要講得出係邊一種原因，唔可以靜靜略過 ===');
{
  // 格式錯（實測提到嘅例子：打咗 2026/11/15）
  const slash = gas.describeUnknownRequestDate_('2026/11/15', '2026T4');
  check('★★★★★ 斜線格式 ⇒ 明確講格式唔正確、並講出正確格式',
    slash.indexOf('格式認不出來') !== -1 && slash.indexOf('yyyy-MM-dd') !== -1, slash);
  check('★★★★ 建議用下拉選單（治本）', slash.indexOf('下拉選單') !== -1);

  // 格式啱但唔屬於呢個季度
  const wrongQuarter = gas.describeUnknownRequestDate_('2027-01-03', '2026T4');
  check('★★★★★ 格式啱但唔屬於呢季 ⇒ 講明係季度唔對，'
    + '唔好令人以為自己打錯字',
    wrongQuarter.indexOf('格式正確') !== -1 && wrongQuarter.indexOf('QuarterID') !== -1,
    wrongQuarter);
  check('★★★★ 兩種原因嘅訊息唔一樣（修正之前共用同一句）',
    slash !== wrongQuarter);

  // 空白
  const blank = gas.describeUnknownRequestDate_('', '2026T4');
  check('★★★★ 空白有自己嘅講法', blank.indexOf('空白') !== -1, blank);

  // 其他常見打法
  ['15/11/2026', '2026.11.15', '２０２６-１１-１５'].forEach(function (t) {
    check('★★★ 「' + t + '」會被判成格式問題',
      gas.describeUnknownRequestDate_(t, '2026T4').indexOf('格式認不出來') !== -1);
  });
}

// =====================================================================
// 階段 G
// =====================================================================
console.log('\n=== G1【核心】套用摘要要講出「其中有幾多筆造成違反」===');
{
  // 實測嗰次：已套用 3 筆、已拒絕 0、無法套用 0，但其中一筆造成硬規則違反
  const sentence = gas.buildApplySummarySentence_({
    appliedCount: 3, rejectedCount: 0, needsInputCount: 0,
    violations: [{ severity: gas.RULE_LEVELS.HARD, ruleId: 'HARD_ROLE_REQUIRED' }]
  });
  check('★★★★★ 明確講出硬規則違反項數'
    + '——之前得「已套用：3 筆　已拒絕：0 筆　無法套用：0 筆」，'
    + '讀落似乎三筆都無事',
    sentence.indexOf('硬規則違反 1 項') !== -1, sentence);
  check('★★★★★ 而且要點破「已套用 ≠ 冇問題」呢個誤解'
    + '（申報套用成功，但套用嘅結果違反咗規則——係兩件事）',
    sentence.indexOf('不代表沒有問題') !== -1, sentence);
  check('★★★★ 有警告符號', sentence.indexOf('⚠️') !== -1);

  // 準硬規則都要計
  const semi = gas.buildApplySummarySentence_({
    appliedCount: 2, violations: [{ severity: gas.RULE_LEVELS.SEMI_HARD }]
  });
  check('★★★★ 準硬規則違反一樣會講',
    semi.indexOf('準硬規則違反 1 項') !== -1, semi);

  // 兩種一齊
  const both = gas.buildApplySummarySentence_({
    appliedCount: 5,
    violations: [
      { severity: gas.RULE_LEVELS.HARD }, { severity: gas.RULE_LEVELS.HARD },
      { severity: gas.RULE_LEVELS.SEMI_HARD }
    ]
  });
  check('★★★★ 兩種一齊出現時分開報',
    both.indexOf('硬規則違反 2 項') !== -1 && both.indexOf('準硬規則違反 1 項') !== -1, both);
}

console.log('\n=== G1：反向——冇違反時唔可以嚇人 ===');
{
  const clean = gas.buildApplySummarySentence_({
    appliedCount: 3, violations: []
  });
  check('★★★★★ 冇違反時講「沒有造成任何違反」，唔會出 ⚠️',
    clean.indexOf('✅') !== -1 && clean.indexOf('⚠️') === -1, clean);
  checkEqual('★★★ 冇套用又冇違反時唔講廢話',
    gas.buildApplySummarySentence_({ appliedCount: 0, violations: [] }), '');
  checkEqual('★★★ violations 冇傳都唔會爆',
    gas.buildApplySummarySentence_({ appliedCount: 0 }), '');
}

console.log('\n=== G2：步驟 3 同步驟 5 兩邊都要有結論句 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'FourStageFlow.gs'), 'utf8');
  const hits = (src.match(/buildApplySummarySentence_\(/g) || []).length;
  checkEqual('★★★★★ 兩處都加咗（步驟 5 用同一段套用邏輯，'
    + '所以有同一個問題——只修一邊等於冇修）', hits, 2);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
