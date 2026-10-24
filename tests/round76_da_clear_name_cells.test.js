// 第七十六輪批次 DA 組：清空「只有名字、冇 PersonID」嘅格，系統要當成改動。
// 執行方式：node tests/round76_da_clear_name_cells.test.js
//
// 第七十五輪回歸 R8：用第 0 版作起點再儲存，第 2 版仍帶住外請講員同獻花——
// 因為「空白對空白」只睇 PersonID，冇睇原本有冇名字。
//
//   DA1　三種只有名字嘅格（外請講員、名單以外嘅名、臨時幫手）清空 ⇒ 偵測到改動；儲存後新版本係空白
//   DA2　清空「不由系統排」崗位（Posts.AutoGenerate=FALSE）⇒ 顯示「（待填）」，唔係「⚠ 未能安排」；
//        系統排嘅崗位清空 ⇒ 真係空格
//   DA3　反方向：原本空白、填返名字 ⇒ 照樣係改動
//   DA4　第七十五輪 R8 步驟：以第 1 版作起點 ⇒ 名字返嚟；以第 0 版作起點 ⇒ 名字（連臨時幫手）清走
//   DA5　有申報嗰條儲存路（planApplyRequests_）同一個判斷

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
const A = sc.A;
const D = sc.DATES;
const save = () => gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
const nameIn = (v, d, post) => String(sc.cellRow(v, d, post)[A.PERSON_NAME_SNAPSHOT] || '');

gas.apiGenerateDraftExecute(sc.Q);
const v0Chair = sc.getCell(0, D[2], 'CHAIR#1');
sc.setCell(0, D[0], 'PREACH#1', 'Rev Wong');        // 外請講員
sc.setCell(0, D[0], 'FLOWER#1', 'Guest Flower');    // 名單以外嘅名（人手崗位）
sc.setCell(0, D[2], 'CHAIR#1', 'ivan');             // 臨時幫手（系統排嘅崗位）
gas.apiSetCellDecisions(sc.Q, [
  { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }
]);
const r1 = save();
check('（準備）第 1 版有三個名', r1.versionNo === 1 && nameIn(1, D[0], 'PREACH') === 'Rev Wong'
  && nameIn(1, D[0], 'FLOWER') === 'Guest Flower' && nameIn(1, D[2], 'CHAIR') === 'ivan', JSON.stringify(r1).slice(0, 200));

console.log('\n=== DA1／DA2：清空 ===');
{
  sc.setCell(1, D[0], 'PREACH#1', '');
  sc.setCell(1, D[0], 'FLOWER#1', '');
  sc.setCell(1, D[2], 'CHAIR#1', '');
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  const posts = (plan.gridChanges || []).map((c) => c.postId).sort();
  check('★★★★★★ 三格清空都偵測到（外請講員、名單以外嘅名、臨時幫手）',
    JSON.stringify(posts) === JSON.stringify(['CHAIR', 'FLOWER', 'PREACH']), JSON.stringify(plan.gridChanges));
  check('★★★★ 唔使逐格決定（清空唔係名單問題）', plan.needsDecision !== true, JSON.stringify(plan.decisionItems));
  const r2 = save();
  check('（準備）第 2 版', r2.versionNo === 2, JSON.stringify(r2).slice(0, 200));
  check('★★★★★★ 第 2 版三格都係空白（名字冇回魂）', nameIn(2, D[0], 'PREACH') === ''
    && nameIn(2, D[0], 'FLOWER') === '' && nameIn(2, D[2], 'CHAIR') === '',
  [nameIn(2, D[0], 'PREACH'), nameIn(2, D[0], 'FLOWER'), nameIn(2, D[2], 'CHAIR')].join('/'));
  const labels = gas.readGridCellLabels_ ? gas.readGridCellLabels_() : null;
  const pending = labels ? labels.pending : '（待填）';
  check('★★★★★★ 講員清空 ⇒ 顯示「（待填）」（不由系統排），唔係「⚠ 未能安排」',
    sc.getCell(2, D[0], 'PREACH#1') === pending, sc.getCell(2, D[0], 'PREACH#1'));
  check('★★★★★ 系統排嘅崗位（主席）清空 ⇒ 真空格', /未能安排/.test(sc.getCell(2, D[2], 'CHAIR#1')),
    sc.getCell(2, D[2], 'CHAIR#1'));
  check('★★★★ 儲存後冇改動', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
}

console.log('\n=== DA3：反方向——空白填返名字 ===');
{
  sc.setCell(2, D[1], 'PREACH#1', 'Pastor Lee');
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★ 原本空白、填咗名 ⇒ 改動', (plan.gridChanges || []).some((c) => c.postId === 'PREACH' && c.serviceDate === D[1]),
    JSON.stringify(plan.gridChanges));
  sc.setCell(2, D[1], 'PREACH#1', '');
  check('★★★★ 改返空白 ⇒ 冇改動（空白對空白）', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
}

console.log('\n=== DA5：有申報嗰條儲存路 ===');
{
  sc.setCell(2, D[0], 'PREACH#1', 'Rev Wong');
  save();   // 第 3 版有 Rev Wong
  sc.setCell(3, D[0], 'PREACH#1', '');
  const plan = gas.planApplyRequests_(sc.Q);
  const k = gas.cellKey_(D[0], 'PREACH', 1);
  const cell = plan.assignByKey[k];
  check('★★★★★ planApplyRequests_：清空嘅講員格係空白', cell && cell.personName === '' && cell.isManual === true,
    JSON.stringify(cell));
  check('★★★★★ 而且帶「不自動排」原因（唔會變「未能安排」）', cell && (cell.ruleFlags || []).indexOf(gas.RULE_IDS.NO_AUTO_GENERATE) !== -1,
    JSON.stringify(cell && cell.ruleFlags));
  sc.setCell(3, D[0], 'PREACH#1', 'Rev Wong');   // 還原，唔影響下面
}

console.log('\n=== DA4：第七十五輪 R8 步驟（用舊版本作起點）===');
{
  gas.apiUseVersionAsStartPoint(sc.Q, 1);
  const r = save();
  check('（準備）以第 1 版作起點 ⇒ 第 4 版', r.versionNo === 4, JSON.stringify(r).slice(0, 200));
  check('★★★★★★ 以第 1 版作起點：三個名都返嚟', nameIn(4, D[0], 'PREACH') === 'Rev Wong'
    && nameIn(4, D[0], 'FLOWER') === 'Guest Flower' && nameIn(4, D[2], 'CHAIR') === 'ivan',
  [nameIn(4, D[0], 'PREACH'), nameIn(4, D[0], 'FLOWER'), nameIn(4, D[2], 'CHAIR')].join('/'));
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★ 以第 0 版作起點：三格都算改動', ['PREACH', 'FLOWER', 'CHAIR'].every((p) =>
    (plan.gridChanges || []).some((c) => c.postId === p)), JSON.stringify(plan.gridChanges));
  const r5 = save();
  check('★★★★★★ 第 5 版＝第 0 版：外請講員、獻花空白，臨時幫手冇咗（返返第 0 版個人）',
    r5.versionNo === 5 && nameIn(5, D[0], 'PREACH') === '' && nameIn(5, D[0], 'FLOWER') === ''
      && nameIn(5, D[2], 'CHAIR') === v0Chair,
    [r5.versionNo, nameIn(5, D[0], 'PREACH'), nameIn(5, D[0], 'FLOWER'), nameIn(5, D[2], 'CHAIR'), v0Chair].join('/'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
