// 第八十三輪批次 JC 組：排表偏好窗嘅數字同機器代號。
// 執行方式：node tests/round83_jc_weight_gap_names.test.js
//
// 現場（第八十二輪 Q2 收尾）：某人「報告」一欄寫「今季目標 6 次　今季已排 6 次」，同一欄又寫
// 「⚠ 比目標多 5 次……」（上一季 5 次、偏好多一次）；確認窗寫「P9706 ANNOUNCE → 一般（預設）」。
// 來源：警告句由 `buildPersonPostWeightReport_()` 計，而傳入嘅偏好行冇 `baseline`／`target`
// ⇒ 目標用咗 `computeWeightTarget_(0, +1)`＝1；畫面同一行嘅目標係 基準 5 ＋ 1＝6。
//
//   JC1　上一季 5 次、偏好多一次、今季已排 6 次 ⇒ 冇警告
//   JC2　今季已排 7 次 ⇒「比目標多 1 次」
//   JC3　確認窗、無效行清單寫「人名　崗位名」，冇 `P\d{4}`、冇崗位代號

const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'PersonPostWeight.gs', 'WebAppWeightEdit.gs'
]);
gas.getConfig_ = function (key, fallback) { return fallback; };
gas.log_ = function () {};
gas.findLatestVersionNo_ = function () { return 0; };
gas.buildWeightLimitContextSafely_ = function () { return null; };
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
let rowsFor = [];
gas.readVersionAssignmentsRaw_ = function () { return rowsFor; };
gas.toDateString_ = function (v) { return String(v); };

const active = { rows: [{ personId: 'P9706', postId: 'ANNOUNCE', adjust: 1, reason: 'demo', scope: 'QUARTER' }],
  invalid: [], byKey: {} };
const nameById = { P9706: '測試甲' };
const posts = [{ postId: 'ANNOUNCE', postNameTC: '報告' }];
const baselineData = { prev: { byKey: { 'P9706|ANNOUNCE': 5 }, label: '2028年4-6月' }, historicalByKey: {} };
const assign = (n) => Array.from({ length: n }, (_, i) => ({ [A.PERSON_ID]: 'P9706', [A.POST_ID]: 'ANNOUNCE',
  [A.SERVICE_DATE]: '2028-07-' + String(2 + i * 7).padStart(2, '0') }));

console.log('\n=== JC1／JC2：警告句同畫面同一個目標 ===');
{
  rowsFor = assign(6);
  const gap6 = gas.readWeightGapTextByKey_('2028T3', active, nameById, posts, baselineData);
  check('★★★★★★ JC1 目標 6（5＋1）、已排 6 ⇒ 冇警告', gap6 && !gap6['P9706|ANNOUNCE'], JSON.stringify(gap6));
  rowsFor = assign(7);
  const gap7 = gas.readWeightGapTextByKey_('2028T3', active, nameById, posts, baselineData);
  check('★★★★★★ JC2 已排 7 ⇒「比目標多 1 次」', gap7 && /^比目標多 1 次/.test(gap7['P9706|ANNOUNCE'] || ''), JSON.stringify(gap7));
  rowsFor = assign(5);
  const gap5 = gas.readWeightGapTextByKey_('2028T3', active, nameById, posts, baselineData);
  check('★★★★★ JC2 已排 5 ⇒ 未達標（唔係「多」）', gap5 && /^未達標/.test(gap5['P9706|ANNOUNCE'] || ''), JSON.stringify(gap5));
  const target = gas.computeWeightTarget_(gas.resolveWeightBaseline_('P9706', 'ANNOUNCE', baselineData).baseline, 1);
  check('★★★★ 畫面嗰行嘅目標（同一支計算）＝6', target === 6, String(target));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'WebAppWeightEdit.gs'), 'utf8');
  check('★★★★★ 偏好窗真入口有把同一份基準傳落去', src.indexOf('const gapByKey = readWeightGapTextByKey_(quarterId, active, nameById, posts, baselineData);') !== -1);
}

console.log('\n=== JC3：確認窗冇 PersonID／PostID ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone3.html']);
  ui.__wd = { choices: [{ adjust: 1, label: '多一次' }, { adjust: 0, label: '一般（預設）' }],
    posts: [{ postId: 'ANNOUNCE', postNameTC: '報告', people: [{ personId: 'P9706', nameTC: '測試甲' }] }],
    invalid: [{ personId: 'P9706', postId: 'ANNOUNCE', reason: 'Adjust=9 超出範圍' }], quarterLabel: '2028年7-9月' };
  ui.__wc = { 'P9706|ANNOUNCE': { adjust: 0, reason: 'demo 彩排' } };
  vm.runInContext('weightData = __wd; weightChanges = __wc;', ui);
  ui.confirmWeightBatch();
  const text = ui.document.getElementById('modalBody').textContent;
  check('★★★★★★ JC3 確認窗寫「測試甲　報告」', text.indexOf('測試甲　報告　→ 一般（預設）') !== -1, text);
  check('★★★★★★ JC3 確認窗冇 P\\d{4}、冇 ANNOUNCE', !/P\d{4}/.test(text) && text.indexOf('ANNOUNCE') === -1, text);
  check('★★★★★ JC3 無效行同樣寫人名崗位名', ui.weightPersonPostLabel('P9706', 'ANNOUNCE') === '測試甲　報告');
  check('★★★★ 查唔到都唔印代號', !/P\d{4}|XPOST/.test(ui.weightPersonPostLabel('P9999', 'XPOST')));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★ 無效行清單用 weightPersonPostLabel', src.indexOf("text: weightPersonPostLabel(b.personId, b.postId) + '　' + b.reason") !== -1);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
