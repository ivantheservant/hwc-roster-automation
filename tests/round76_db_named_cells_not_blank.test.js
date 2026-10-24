// 第七十六輪批次 DB 組：「這一版還有 N 格沒有人」唔可以包括有名字嘅格。
// 執行方式：node tests/round76_db_named_cells_not_blank.test.js
//
// 第七十五輪回歸 R10：寄出確認窗列出 7 月 2 日講員、獻花、7 月 16 日報告——
// 即係 `Rev Wong`、`Guest Flower`、`ivan`，三格都有名字。
//
//   DB1　「有冇人」只有一個定義（isCellFilled_）：有 PersonID 或者有名字
//   DB2　寄出確認窗／狀態卡（summariseVersionSendWarnings_）：外請講員、名單以外嘅名、臨時幫手唔算空格；真空格照計
//   DB3　儲存確認、檢查我的改動、待補格子、匯入預覽都經同一個定義

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'SendWarnings.gs'] });
const gas = sc.gas;
const D = sc.DATES;

console.log('\n=== DB1：同一個定義 ===');
{
  check('★★★★★ 有 PersonID ⇒ 有人', gas.isCellFilled_('P9701', '') === true);
  check('★★★★★★ 冇 PersonID 但有名 ⇒ 有人', gas.isCellFilled_('', 'Rev Wong') === true);
  check('★★★★★ 兩樣都冇（或者得空格）⇒ 冇人', gas.isCellFilled_('', '') === false && gas.isCellFilled_(null, '  ') === false);
}

gas.apiGenerateDraftExecute(sc.Q);
sc.setCell(0, D[0], 'PREACH#1', 'Rev Wong');       // 外請講員
sc.setCell(0, D[0], 'FLOWER#1', 'Guest Flower');   // 名單以外嘅名
sc.setCell(0, D[2], 'CHAIR#1', 'ivan');            // 臨時幫手
sc.setCell(0, D[3], 'READ#1', '');                 // 真空格（系統排嘅崗位）
gas.apiSetCellDecisions(sc.Q, [
  { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }
]);
const plan = gas.apiSaveAndConfirmPlan(sc.Q);
const planBlanks = (plan.blankCells || []).map((b) => b.serviceDate + '|' + b.postId);
const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）第 1 版', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 200));

console.log('\n=== DB2：寄出確認窗／狀態卡 ===');
{
  const w = gas.summariseVersionSendWarnings_(sc.Q, 1);
  const keys = w.blank.items.map((b) => b.serviceDate + '|' + b.postId);
  check('★★★★★★ 有名字嘅三格唔算「沒有人」', !keys.some((k) => /\|(PREACH|FLOWER)$/.test(k) && k.indexOf(D[0]) === 0)
    && keys.indexOf(D[2] + '|CHAIR') === -1, JSON.stringify(keys));
  check('★★★★★★ 真空格照計（第 4 週讀經），而且只得佢', w.blank.count === 1 && keys[0] === D[3] + '|READ',
    JSON.stringify(w.blank));
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 狀態卡用同一份（1 格）', dash.sendWarnings && dash.sendWarnings.blank.count === 1,
    JSON.stringify(dash.sendWarnings && dash.sendWarnings.blank));
}

console.log('\n=== DB3：其他地方 ===');
{
  check('★★★★★ 儲存確認嘅空格清單一樣只得真空格', JSON.stringify(planBlanks) === JSON.stringify([D[3] + '|READ']),
    JSON.stringify(planBlanks));
  const chk = gas.apiCheckMyChanges(sc.Q);
  check('★★★★ 檢查我的改動：同一個數', (chk.blanks || []).length === 1, JSON.stringify(chk.blanks));
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  check('★★★★ 待補格子（listPendingBackfillCells_）經 isCellFilled_',
    /isCellFilled_\(row\[C\.PERSON_ID\], row\[C\.PERSON_NAME_SNAPSHOT\]\)/.test(src('RequestsApply.gs')));
  check('★★★★ 匯入預覽：外請講員帶住名（freeText）', /personId: '', freeText: typed, isManual: true/.test(src('RosterImport.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
