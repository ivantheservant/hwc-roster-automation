// 第七十五輪批次 CP 組：重設季度要清得徹底。
// 執行方式：node tests/round75_cp_reset_thorough.test.js
//
//   CP1　日期完全落喺呢一季嘅 Unavailable（任何 Source、任何狀態）⇒ 清，並列入確認清單；
//        跨季嘅人手紀錄、其他季度 ⇒ 唔郁
//   CP2　呢一季嘅逐格決定（CellDecisions）⇒ 清；其他季度唔郁
//   CP3　放行失效：AuditLog 唔刪，但重設之後讀唔返舊放行；重新生成再填同一格 ⇒ 要重新確認
//   CP4　`匯入_<季度>`、`Verify_<季度>_v*`、`Roster_<季度>_v*_建議` ⇒ 刪；名字相似嘅表唔郁
//   CP5　每週標題（ServiceDates.Title）⇒ 只清呢一季
//   CP6　PersonPostExclusions 唔碰，但確認清單列出「會影響這一季的人員設定」

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { appendRows, seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 800));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'QuarterReset.gs', 'Menu.gs'] });
const gas = sc.gas;
const C = sc.C;
const S = sc.S;
const D = sc.DATES;
gas.listRosterPdfFilesForQuarter_ = function () { return []; };
gas.listEditableCopyFilesForQuarter_ = function () { return []; };
gas.listEmptyVersionFoldersForReset_ = function () { return []; };

gas.apiGenerateDraftExecute(sc.Q);
// 臨時幫手＋一定要遵守嘅違反（勾保留 ⇒ 放行）＋每週標題
sc.setCell(0, D[2], 'CHAIR#1', 'ivan');
sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));
sc.setCell(0, D[1], '_TYPE', '聖餐主日');
gas.apiSetCellDecisions(sc.Q, [
  { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true },
  { serviceDate: D[3], postId: 'WORSHIP', slotIndex: 1, kind: 'KEEP', cellText: sc.nameOf('P9704'), ruleId: 'HARD_ELIGIBILITY', checked: true }
]);
let plan0 = gas.apiSaveAndConfirmPlan(sc.Q);
if (plan0.needsDecision) {
  gas.apiSetCellDecisions(sc.Q, (plan0.decisionItems.rules || []).concat(plan0.decisionItems.names || [])
    .map((r) => Object.assign({}, r, { checked: true })));
}
const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）第 1 版建立', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 300));
const auditBefore = gas.readSheet_(S.AUDIT_LOG);
const releasedBefore = Object.keys(gas.readReleasedHardViolationKeys_(auditBefore, sc.Q));
check('（準備）有放行紀錄', releasedBefore.length >= 1, JSON.stringify(releasedBefore));
// 另一季嘅決定（唔可以被清）
const otherQ = '2099T2';
gas.ensureCellDecisionsSheet_();
appendRows(sc.ss, S.CELL_DECISIONS, Object.keys(C.CELL_DECISIONS).map((k) => C.CELL_DECISIONS[k]), [
  { [C.CELL_DECISIONS.DECISION_ID]: 'X1', [C.CELL_DECISIONS.QUARTER_ID]: otherQ, [C.CELL_DECISIONS.SERVICE_DATE]: '2099-04-05',
    [C.CELL_DECISIONS.POST_ID]: 'CHAIR', [C.CELL_DECISIONS.SLOT_INDEX]: 1, [C.CELL_DECISIONS.KIND]: 'TEMP_HELPER',
    [C.CELL_DECISIONS.CELL_TEXT]: 'x', [C.CELL_DECISIONS.STATUS]: 'ACTIVE' }
]);

// Unavailable
const U = C.UNAVAILABLE;
const uRow = (id, person, from, to, source, status) => ({ [U.UNAVAILABLE_ID]: id, [U.PERSON_ID]: person,
  [U.DATE_FROM]: from, [U.DATE_TO]: to, [U.SOURCE]: source, [U.STATUS]: status, [U.APPLIES_TO]: 'ALL' });
appendRows(sc.ss, S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [
  uRow('U1', 'P9701', '2099-01-11', '2099-01-11', 'MANUAL', 'ACTIVE'),      // 完全喺季內 ⇒ 清
  uRow('U2', 'P9702', '2099-01-25', '2099-02-10', 'MANUAL', 'ACTIVE'),      // 跨季 ⇒ 留
  uRow('U3', 'P9703', '2098-12-20', '2099-01-05', 'MANUAL', 'ACTIVE'),      // 季前開始 ⇒ 唔郁
  uRow('U4', 'P9701', '2099-05-03', '2099-05-03', 'MANUAL', 'ACTIVE'),      // 其他季 ⇒ 唔郁
  uRow('U5', 'P9705', '2099-01-18', '', 'WEB', 'CANCELLED'),                // 季內、已取消 ⇒ 清
  uRow('U6', 'P9704', '2099-01-04', '2099-01-04', 'REQUEST', 'ACTIVE')       // 申報 ⇒ 清（照舊）
]);

// 其他工作表
['匯入_' + sc.Q, 'Verify_' + sc.Q + '_v0', 'Verify_' + sc.Q + '_v1', 'Roster_' + sc.Q + '_v1_建議',
  '匯入_' + sc.Q + '_備份', 'Roster_' + sc.Q + '_v1_建議名單', 'Verify_' + otherQ + '_v0'].forEach((n) => {
  if (!sc.ss.getSheetByName(n)) sc.ss.insertSheet(n);
});

// PersonPostExclusions
const X = C.PERSON_POST_EXCLUSIONS;
seedSheet(sc.ss, S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), [
  { [X.EXCLUSION_ID]: 'X1', [X.PERSON_ID]: 'P9705', [X.POST_ID]: 'CHAIR', [X.REASON]: '休息',
    [X.EFFECTIVE_FROM]: '2099-01-01', [X.EFFECTIVE_TO]: '', [X.ACTIVE]: true },
  { [X.EXCLUSION_ID]: 'X2', [X.PERSON_ID]: 'P9703', [X.POST_ID]: 'READ', [X.REASON]: '舊',
    [X.EFFECTIVE_FROM]: '2098-01-01', [X.EFFECTIVE_TO]: '2098-06-30', [X.ACTIVE]: true }
]);
const exclusionsBefore = JSON.stringify(gas.readSheet_(S.PERSON_POST_EXCLUSIONS));

console.log('\n=== 計畫（確認清單）===');
const plan = gas.planQuarterReset_(sc.Q, true);
const lines = gas.describeQuarterResetPlanLines_(sc.Q, plan).join('\n');
{
  const ids = plan.unavailableInQuarterDetails.map((u) => u.personId + '@' + u.dateFrom).sort();
  check('★★★★★★ CP1 完全喺季內嘅 Unavailable（任何來源、任何狀態）列出', JSON.stringify(ids)
    === JSON.stringify(['P9701@2099-01-11', 'P9704@2099-01-04', 'P9705@2099-01-18']), JSON.stringify(plan.unavailableInQuarterDetails));
  check('★★★★★ CP1 確認清單逐行列出（連名字）', /會清除的不能服侍日期（完全在這一季之內）/.test(lines)
    && lines.indexOf(sc.nameOf('P9701') + '（P9701）　2099-01-11') !== -1, lines);
  check('★★★★ CP1 跨季嘅人手紀錄列為「不會清」', plan.unavailableManualDetails.length === 1
    && plan.unavailableManualDetails[0].personId === 'P9702', JSON.stringify(plan.unavailableManualDetails));
  check('★★★★★ CP2 決定紀錄數到（只數呢一季）', plan.cellDecisionRows === 2, plan.cellDecisionRows);
  check('★★★★★ CP3 確認清單講明放行會失效', plan.releasedKeyCount >= 1 && /已放行的規則違反：\d+ 項（重設之後不再生效/.test(lines), lines);
  check('★★★★★★ CP4 其他工作表：只列呢一季、名字嚴格對得上', JSON.stringify(plan.extraSheetNames)
    === JSON.stringify(['Roster_' + sc.Q + '_v1_建議', 'Verify_' + sc.Q + '_v0', 'Verify_' + sc.Q + '_v1', '匯入_' + sc.Q].sort()),
    JSON.stringify(plan.extraSheetNames));
  check('★★★★★ CP5 每週標題數到', plan.weekTitleDates.length === 1 && plan.weekTitleDates[0] === D[1], JSON.stringify(plan.weekTitleDates));
  check('★★★★★★ CP6 會影響這一季的人員設定列出（只列生效中嘅）', plan.personSettingNotes.length === 1
    && plan.personSettingNotes[0].indexOf(sc.nameOf('P9705') + '　暫不擔任 主席') === 0
    && /會影響這一季的人員設定（不會改，只是讓你知道）/.test(lines), JSON.stringify(plan.personSettingNotes));
}

console.log('\n=== 執行 ===');
const res = gas.executeQuarterReset_(plan);
{
  check('（準備）冇出錯', res.errors.length === 0, JSON.stringify(res.errors));
  const left = gas.readSheet_(S.UNAVAILABLE).map((r) => r[U.UNAVAILABLE_ID]).sort();
  check('★★★★★★ CP1 Unavailable：U1／U5／U6 清走；U2（跨季）、U3（季前）、U4（其他季）留', JSON.stringify(left)
    === JSON.stringify(['U2', 'U3', 'U4']), JSON.stringify(left));
  const dec = gas.readSheet_(S.CELL_DECISIONS).map((r) => r[C.CELL_DECISIONS.QUARTER_ID]);
  check('★★★★★★ CP2 呢一季嘅決定清走；其他季度留', JSON.stringify(dec) === JSON.stringify([otherQ]), JSON.stringify(dec));
  const names = sc.ss.getSheets().map((s) => s.getName());
  check('★★★★★★ CP4 呢一季嘅匯入／核對／建議表刪咗', !names.some((n) => n === '匯入_' + sc.Q || /^Verify_2099T1_v\d+$/.test(n)
    || /^Roster_2099T1_v\d+_建議$/.test(n)), JSON.stringify(names));
  check('★★★★★ CP4 名字相似嘅表、其他季度嘅表唔郁', names.indexOf('匯入_' + sc.Q + '_備份') !== -1
    && names.indexOf('Roster_' + sc.Q + '_v1_建議名單') !== -1 && names.indexOf('Verify_' + otherQ + '_v0') !== -1);
  const titles = gas.readSheet_(S.SERVICE_DATES).map((r) => String(r[C.SERVICE_DATES.TITLE] || ''));
  check('★★★★★ CP5 每週標題清空', titles.every((t) => t === ''), JSON.stringify(titles));
  check('★★★★★★ CP6 PersonPostExclusions 一格都冇改', JSON.stringify(gas.readSheet_(S.PERSON_POST_EXCLUSIONS)) === exclusionsBefore);

  const audit = gas.readSheet_(S.AUDIT_LOG);
  const releaseRows = audit.filter((r) => r[C.AUDIT_LOG.ACTION] === '硬規則放行');
  check('★★★★★ CP3 AuditLog 嘅放行紀錄冇刪', releaseRows.length >= 1);
  check('★★★★★★ CP3 重設之後讀唔返舊放行', Object.keys(gas.readReleasedHardViolationKeys_(audit, sc.Q)).length === 0
    && Object.keys(gas.readReleasedHardViolationInfo_(audit, sc.Q)).length === 0);
  check('★★★★ CP3 其他季度嘅放行唔受影響（重設標記只認呢一季）',
    gas.lastQuarterResetAuditIndex_(audit, otherQ) === -1 && gas.lastQuarterResetAuditIndex_(audit, sc.Q) > -1);
}

console.log('\n=== 重設之後再生成：同一格要重新確認 ===');
{
  gas.apiGenerateDraftExecute(sc.Q);
  sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));
  const p = gas.apiSaveAndConfirmPlan(sc.Q);
  const rule = (p.decisionItems && p.decisionItems.rules || []).filter((r) => r.key === D[3] + '|WORSHIP|1')[0];
  check('★★★★★★ 舊放行唔再生效：要重新決定（未勾、冇「已放行」）', p.needsDecision === true && rule
    && rule.checked === false && rule.released !== true, JSON.stringify(p.decisionItems));

  // 放行喺重設之後先寫 ⇒ 照樣有效
  const audit = gas.readSheet_(S.AUDIT_LOG).slice();
  audit.push({ [C.AUDIT_LOG.ACTION]: '硬規則放行', [C.AUDIT_LOG.TARGET_KEY]: sc.Q,
    [C.AUDIT_LOG.NOTES]: 'RELEASED_KEYS:' + sc.Q + '|' + D[3] + '|WORSHIP|1|P9704|HARD_ELIGIBILITY' });
  check('★★★★★ 重設之後嘅放行照樣有效', Object.keys(gas.readReleasedHardViolationKeys_(audit, sc.Q)).length === 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
