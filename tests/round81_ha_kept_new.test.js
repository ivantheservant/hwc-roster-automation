// 第八十一輪批次 HA 組：之前已經保留的格，唔再令之後每一次〔儲存〕都出確認窗；確認窗講明點解出現。
// 執行方式：node tests/round81_ha_kept_new.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（demo 前最後回歸 M6.2／M7.2／M12）
// ═════════════════════════════════════════════════════════════════════
//
//   M4 勾咗第 4 週領詩「保留我的安排」（一定要遵守）。之後每一次〔儲存〕（只換一個司事）
//   都出「會儲存成第 N 版」確認窗，窗內冇任何一句講點解——快路要求 `keptCount＝0`。
//
//   HA1　上一版已保留／放行嘅格、上一版已標記嘅臨時幫手，今次只改另一格 ⇒ 快路成立
//   HA2　今次新保留一格、新標記臨時幫手 ⇒ 出窗，「為甚麼」列出佢哋
//   HA3　今次把保留格換咗另一個都違規嘅人 ⇒ 算新
//   HA4　上一版算唔到 ⇒ 全部當新
//   HA5　每一種原因都會出現喺「為甚麼」；冇原因 ⇒ 空
//   HA6　舊嘅盡量避免、舊嘅保留格唔放入「為甚麼」；今次帶來嘅盡量避免先放
//   HA7　前端：有 `confirmReasons` ⇒ 只睇佢；確認窗最上面顯示

const fs = require('fs');
const path = require('path');
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
const codes = (plan) => (plan.confirmReasons || []).map((r) => r.code).sort().join(',');
const save = () => gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
const ids = ['P9701', 'P9702', 'P9703', 'P9705'];
const freeOn = (v, date, keys) => {
  const busy = keys.map((k) => sc.getCell(v, date, k));
  return ids.map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
};

gas.apiGenerateDraftExecute(sc.Q);

console.log('\n=== HA2【核心】今次新保留一格、新標記臨時幫手 ⇒ 出窗，「為甚麼」列出 ===');
{
  sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));   // 唔喺領詩名單（一定要遵守）
  sc.setCell(0, D[2], 'CHAIR#1', 'ivan');                 // 名單上搵唔到（臨時幫手）
  gas.apiSetCellDecisions(sc.Q, [
    { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true },
    { serviceDate: D[3], postId: 'WORSHIP', slotIndex: 1, kind: 'KEEP', cellText: sc.nameOf('P9704'), ruleId: 'HARD_ELIGIBILITY', checked: true }
  ]);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（前置）全部決定咗', plan.needsDecision === false, JSON.stringify(plan.decisionItems));
  check('★★★★★★ keptNewCount＝2（新保留 1 格＋新臨時幫手 1 位）', plan.keptNewCount === 2, String(plan.keptNewCount));
  check('★★★★★★ 「為甚麼」列出 KEPT_NEW 同 TEMP_HELPER_NEW',
    codes(plan).indexOf('KEPT_NEW') !== -1 && codes(plan).indexOf('TEMP_HELPER_NEW') !== -1, codes(plan));
  const kept = plan.confirmReasons.filter((r) => r.code === 'KEPT_NEW')[0];
  check('★★★★★ 字句：你新保留了 1 格違反規則的安排', kept && kept.text === '你新保留了 1 格違反規則的安排', kept && kept.text);
  check('★★★★★★ 快路唔成立（要出確認窗）', ui.saveIsCompletelyClean(plan) === false);
  const r = save();
  check('（前置）第 1 版建立', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
}

console.log('\n=== HA1【核心】上一版已保留／已放行、已標記臨時幫手 ⇒ 只改另一格 ⇒ 快路成立 ===');
{
  const free = freeOn(1, D[0], ['CHAIR#1', 'READ#1', 'WORSHIP#1']);
  sc.setCell(1, D[0], 'CHAIR#1', free);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  // 儲存咗之後：保留嘅一定要遵守違反變成放行紀錄（`released`）；臨時幫手已經入版本，唔再係「找不到」
  check('（前置）表上仍然有上一版已放行嘅格（舊快路會因為佢彈窗）', plan.violations.released.length >= 1,
    JSON.stringify({ kept: plan.keptCount, released: plan.violations.released.length }));
  check('★★★★★★ 但唔係今次帶來 ⇒ keptNewCount＝0、releasedNew 係空',
    plan.keptNewCount === 0 && plan.violations.releasedNew.length === 0,
    JSON.stringify({ keptNew: plan.keptNewCount, releasedNew: plan.violations.releasedNew }));
  check('★★★★★★ 「為甚麼」係空', plan.confirmReasons.length === 0, codes(plan));
  check('★★★★★★ 快路成立（直接儲存，唔出確認窗）', ui.saveIsCompletelyClean(plan) === true);
  const r = save();
  check('（前置）第 2 版建立', r && r.versionNo === 2, JSON.stringify(r).slice(0, 300));
}

console.log('\n=== HA6：今次帶來「盡量避免」⇒「為甚麼」只列佢，唔列舊保留格 ===');
{
  sc.setCell(2, D[1], 'READ#1', sc.getCell(2, D[0], 'READ#1'));  // 連續兩週（盡量避免）
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 「為甚麼」只得 SEMI_HARD_NEW', codes(plan) === 'SEMI_HARD_NEW', codes(plan));
  check('★★★★★ 舊保留格照舊計入 keptCount（下面提示用），唔入「為甚麼」', plan.keptCount + plan.violations.released.length >= 1);
  check('★★★★★ 快路唔成立', ui.saveIsCompletelyClean(plan) === false);
  sc.setCell(2, D[1], 'READ#1', sc.getCell(1, D[1], 'READ#1'));  // 改返
}

console.log('\n=== HA3：把保留格換咗另一個都違規嘅人 ⇒ 算新 ===');
{
  sc.setCell(2, D[3], 'WORSHIP#1', sc.nameOf('P9706'));   // P9706 唔喺任何自動崗位名單
  gas.apiSetCellDecisions(sc.Q, [
    { serviceDate: D[3], postId: 'WORSHIP', slotIndex: 1, kind: 'KEEP', cellText: sc.nameOf('P9706'), ruleId: 'HARD_ELIGIBILITY', checked: true }
  ]);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（前置）全部決定咗', plan.needsDecision === false, JSON.stringify(plan.decisionItems));
  check('★★★★★★ 同一格換咗人 ⇒ 新保留（KEPT_NEW）', codes(plan).indexOf('KEPT_NEW') !== -1, codes(plan));
  check('★★★★★ 快路唔成立', ui.saveIsCompletelyClean(plan) === false);
}

console.log('\n=== HA4：上一版算唔到 ⇒ 全部當新 ===');
{
  const real = gas.findStateViolations_;
  gas.findStateViolations_ = function () { throw new Error('讀不到'); };
  const idx = gas.buildBaseViolationIndex_({ original: [] }, 'test');
  gas.findStateViolations_ = real;
  const list = [{ serviceDate: D[1], postId: 'READ', slotIndex: 1, ruleId: 'HARD_ELIGIBILITY', personId: 'P9701' }];
  check('★★★★★ 算唔到 ⇒ null', idx === null, JSON.stringify(idx));
  check('★★★★★★ null ⇒ 原封不動當新', gas.filterNewSinceBase_(list, idx).length === 1);
  check('★★★★ 有索引而且同一個 ⇒ 舊', gas.filterNewSinceBase_(list, { [gas.baseViolationKey_(list[0])]: true }).length === 0);
  check('★★★★★ 臨時幫手：上一版同一格唔同名 ⇒ 新',
    gas.filterNewTempHelpers_([{ key: 'k', text: 'ivan' }], { original: [] }).length === 1);
}

console.log('\n=== HA5：每一種原因都會出現喺「為甚麼」===');
{
  const all = gas.buildSaveConfirmReasons_({
    realCount: 1, undecidedRuleCount: 1, undecidedNameCount: 1, semiHardNewCount: 1, keptNewCount: 1,
    tempHelpersNewCount: 1, releasedNewCount: 1, requestApplyCount: 2, requestConfirmCount: 1,
    requestNeedsInputCount: 1, overlapCount: 1, blankCellCount: 3, gridChangeCount: 1
  });
  const want = ['RULE_UNDECIDED', 'NAME_UNDECIDED', 'SEMI_HARD_NEW', 'KEPT_NEW', 'TEMP_HELPER_NEW', 'RELEASED_NEW',
    'REQUEST_APPLY', 'REQUEST_CONFIRM', 'REQUEST_NEEDS_INPUT', 'OVERLAP', 'BLANK_CELLS'];
  check('★★★★★★ 十一種原因全部列出', want.every((c) => all.some((r) => r.code === c)), all.map((r) => r.code).join(','));
  check('★★★★★ 字句帶數字（有 2 筆修改申報要套用／還有 3 格沒有人）',
    all.some((r) => r.text === '有 2 筆修改申報要套用') && all.some((r) => r.text === '還有 3 格沒有人'));
  check('★★★★★★ 全部零、有改動 ⇒ 空', gas.buildSaveConfirmReasons_({ gridChangeCount: 1 }).length === 0);
  check('★★★★ 全部零、又冇改動 ⇒ NO_GRID_CHANGE（唔可以靜靜直接儲存）',
    gas.buildSaveConfirmReasons_({ gridChangeCount: 0 })[0].code === 'NO_GRID_CHANGE');
}

console.log('\n=== HA7：前端 ===');
{
  const base = { violations: { real: [], semiHard: [{ ruleId: 'X' }], released: [], kept: [] },
    requests: { apply: [], confirm: [], needsInput: [] }, overlaps: [], unresolved: [],
    gridChanges: [{ serviceDate: D[0] }], blankCells: [], keptCount: 3 };
  check('★★★★★★ 有 confirmReasons（空）⇒ 只睇佢：直接儲存', ui.saveIsCompletelyClean(Object.assign({ confirmReasons: [] }, base)) === true);
  check('★★★★★★ 有原因 ⇒ 出窗', ui.saveIsCompletelyClean(Object.assign({ confirmReasons: [{ code: 'BLANK_CELLS' }] }, base)) === false);
  check('★★★★★ 舊後端（冇 confirmReasons）⇒ 照舊判斷', ui.saveIsCompletelyClean(base) === false);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const main = src.slice(src.indexOf('function renderSaveMain'));
  check('★★★★★ 確認窗最上面放「為甚麼要你看一看」', main.indexOf('buildSaveWhySection(plan.confirmReasons)')
    !== -1 && main.indexOf('buildSaveWhySection(plan.confirmReasons)') < main.indexOf('buildChangedCellsSection('));
  check('★★★★ 標題字句', src.indexOf("'為甚麼要你看一看'") !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
