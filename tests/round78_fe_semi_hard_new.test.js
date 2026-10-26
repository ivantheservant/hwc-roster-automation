// 第七十八輪批次 FE 組：〔儲存〕快路只睇今次儲存帶出嚟嘅「盡量避免」違反。
// 執行方式：node tests/round78_fe_semi_hard_new.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十八輪回歸 H5）
// ═════════════════════════════════════════════════════════════════════
//
//   第 2 版存咗一格「連續兩週」（盡量避免）。之後喺第 2 版只換一個司事（冇違規）撳〔儲存〕，
//   照樣出「會儲存成第 3 版」確認窗——表上只要有一格已存嘅「盡量避免」，之後每次儲存都彈窗。
//
//   FE1　今次帶出嘅「盡量避免」⇒ 仲係出確認窗
//   FE2　上一版已經存咗嘅 ⇒ 唔再擋快路（確認窗照樣列出，只係唔會因為佢而彈）
//   FE3　再帶出一格新嘅 ⇒ 又要出確認窗
//   FE4　上一版算唔到 ⇒ 全部當新（保守）
//   FE5　舊後端冇 `semiHardNew` ⇒ 前端照舊用全部

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppZone4.gs'] });
const gas = sc.gas;
const D = sc.DATES;
const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
gas.apiGenerateDraftExecute(sc.Q);
const ids = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'];
const keyOf = (v) => v.serviceDate + '|' + v.postId + '|' + v.slotIndex + '|' + v.ruleId + '|' + v.personId;
let oldKeys = [];
const ruleIds = (list) => (list || []).map((v) => v.ruleId + '@' + v.serviceDate).join(',');
const save = () => gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });

console.log('\n=== FE1【核心】今次帶出嘅「盡量避免」⇒ 出確認窗 ===');
{
  // 第 2 週讀經 ＝ 第 1 週讀經嗰位（READ 嘅 AllowConsecutive＝WARN ⇒ 盡量避免）
  sc.setCell(0, D[1], 'READ#1', sc.getCell(0, D[0], 'READ#1'));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（準備）有「盡量避免」違反', plan.violations.semiHard.length >= 1, JSON.stringify(plan.violations).slice(0, 400));
  check('★★★★★★ 今次帶出嘅 ⇒ semiHardNew 有佢', plan.violations.semiHardNew.length === plan.violations.semiHard.length,
    ruleIds(plan.violations.semiHardNew) + ' / ' + ruleIds(plan.violations.semiHard));
  check('★★★★★★ 快路唔成立（要出確認窗）', ui.saveIsCompletelyClean(plan) === false);
  const r = save();
  check('（準備）第 1 版建立', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
}

console.log('\n=== FE2【核心】上一版已存嘅「盡量避免」唔再擋快路 ===');
{
  // 第 4 週主席換人（主席 AllowConsecutive＝ALLOW；揀一個當日冇其他崗位嘅人）
  const busy = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((k) => sc.getCell(1, D[3], k));
  const free = ids.map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
  sc.setCell(1, D[3], 'CHAIR#1', free);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（準備）表上仲有上一版嗰格「盡量避免」', plan.violations.semiHard.length >= 1, ruleIds(plan.violations.semiHard));
  oldKeys = plan.violations.semiHard.map(keyOf);
  check('★★★★★★ 但唔係今次帶出 ⇒ semiHardNew 係空', plan.violations.semiHardNew.length === 0,
    ruleIds(plan.violations.semiHardNew));
  check('（準備）其他嘢都乾淨', plan.violations.real.length === 0 && (plan.blankCells || []).length === 0
    && !plan.needsDecision && plan.gridChanges.length === 1, JSON.stringify({
    real: plan.violations.real.length, blanks: (plan.blankCells || []).length, nd: plan.needsDecision, g: plan.gridChanges.length }));
  check('★★★★★★ 快路成立（直接儲存，唔出確認窗）', ui.saveIsCompletelyClean(plan) === true);
  const r = save();
  check('（準備）第 2 版建立', r && r.versionNo === 2, JSON.stringify(r).slice(0, 300));
}

console.log('\n=== FE3：再帶出一格新嘅 ⇒ 又要出確認窗 ===');
{
  const reader = sc.getCell(2, D[2], 'READ#1');
  sc.setCell(2, D[3], 'READ#1', reader);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  const fresh = plan.violations.semiHardNew;
  check('★★★★★ semiHardNew 只有新嗰格，冇上一版嗰格',
    fresh.length >= 1 && oldKeys.length >= 1 && fresh.every((v) => oldKeys.indexOf(keyOf(v)) === -1)
      && plan.violations.semiHard.some((v) => oldKeys.indexOf(keyOf(v)) !== -1),
    ruleIds(fresh) + ' / ' + ruleIds(plan.violations.semiHard));
  check('★★★★★★ 快路唔成立', ui.saveIsCompletelyClean(plan) === false);
}

console.log('\n=== FE4：上一版算唔到 ⇒ 全部當新 ===');
{
  const realFind = gas.findStateViolations_;
  gas.findStateViolations_ = function () { throw new Error('讀不到'); };
  const list = [{ serviceDate: D[1], postId: 'READ', slotIndex: 1, ruleId: 'SEMI_NO_CONSECUTIVE', personId: 'P9701' }];
  const out = gas.filterNewSemiHardViolations_(list, { original: [] });
  gas.findStateViolations_ = realFind;
  check('★★★★★ 算唔到 ⇒ 原封不動當新', out.length === 1, JSON.stringify(out));
  check('★★★★ 冇違反 ⇒ 空', gas.filterNewSemiHardViolations_([], { original: [] }).length === 0);
}

console.log('\n=== FE5：舊後端冇 semiHardNew ⇒ 前端照舊用全部 ===');
{
  const base = { violations: { real: [], semiHard: [{ ruleId: 'X' }], released: [], kept: [] },
    requests: { apply: [], confirm: [], needsInput: [] }, overlaps: [], unresolved: [],
    gridChanges: [{ serviceDate: D[0] }], blankCells: [] };
  check('★★★★ 冇 semiHardNew ⇒ 唔成立', ui.saveIsCompletelyClean(base) === false);
  const withNew = JSON.parse(JSON.stringify(base));
  withNew.violations.semiHardNew = [];
  check('★★★★★ semiHardNew 空 ⇒ 成立', ui.saveIsCompletelyClean(withNew) === true);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
