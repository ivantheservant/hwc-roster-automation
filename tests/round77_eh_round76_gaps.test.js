// 第七十七輪批次 EH 組：第七十六輪回歸 F1–F3 及一句字眼。
// 執行方式：node tests/round77_eh_round76_gaps.test.js
//
//   EH1（F1）舊「以第 M 版作起點」標記跨重設仍然生效 ⇒ 標記要唔早過基準版本建立時間、亦唔早過該季最後一次重設
//   EH2（F2）儲存確認窗把人手清空嘅講員／獻花當成「還有 N 格沒有人」⇒ 按 Posts.AutoGenerate=FALSE 判斷；真空格照計
//   EH3（F3）第 4 步卡片標題「要印紙本的有 N 位」漏計臨時幫手 ⇒ 卡片、寄出窗、第 4 步名單三個數字一致
//   EH4　字眼：「第 1 及第 2 及第 3 及第 4 及第 5 版」⇒「第 1 至 5 版都」「第 2、4 至 6 版」

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppMainFlow.gs', 'PdfExport.gs', 'PaperPack.gs', 'SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
const gas = sc.gas;
const D = sc.DATES;
const A = sc.C.AUDIT_LOG;

console.log('\n=== EH1（F1）：純函式 ===');
{
  const row = (ts, oldV, newV, action) => ({ [A.ACTION]: action || 'VERSION_START_POINT', [A.TARGET_KEY]: sc.Q, [A.OLD_VALUE]: oldV, [A.NEW_VALUE]: newV, [A.TIMESTAMP]: ts });
  const marker = row('2099-01-05 10:00:00', 1, 0);
  check('★★★★★★ 標記早過基準版本建立時間 ⇒ 唔算（重設前留低嘅舊標記）',
    gas.findStartPointForSave_([marker], sc.Q, 1, { timezone: sc.TZ, versionCreatedAt: '2099-01-06 09:00:00', lastResetAt: null }) === null);
  check('★★★★★★ 標記早過該季最後一次重設 ⇒ 唔算',
    gas.findStartPointForSave_([marker], sc.Q, 1, { timezone: sc.TZ, versionCreatedAt: '2099-01-01 09:00:00', lastResetAt: '2099-01-06 09:00:00' }) === null);
  check('★★★★★ 標記喺基準版本之後、重設之後 ⇒ 算',
    gas.findStartPointForSave_([marker], sc.Q, 1, { timezone: sc.TZ, versionCreatedAt: '2099-01-05 09:00:00', lastResetAt: '2099-01-04 09:00:00' }) === 0);
  check('★★★★ 同一秒（harness 全部時間一樣）⇒ 照算',
    gas.findStartPointForSave_([marker], sc.Q, 1, { timezone: sc.TZ, versionCreatedAt: '2099-01-05 10:00:00', lastResetAt: '2099-01-05 10:00:00' }) === 0);
  const resetRow = row('2099-01-06 09:00:00', '', '', 'QUARTER_RESET_BATCH_AFTER');
  check('★★★★★ findLastQuarterResetAt_：讀到該季最後一次重設時間；Date 物件都認得',
    gas.findLastQuarterResetAt_([resetRow, Object.assign({}, resetRow, { [A.TIMESTAMP]: new Date('2099-01-07T09:00:00Z') })], sc.Q, 'UTC') === '2099-01-07 09:00:00'
    && gas.findLastQuarterResetAt_([], sc.Q, sc.TZ) === null);
  check('★★★★ 重設完成嗰行用同一個 action 常數', /action: QUARTER_RESET_AFTER_ACTION,/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'QuarterReset.gs'), 'utf8')));
}

console.log('\n=== EH1（F1）：真入口——重設前嘅標記唔會變成今次嘅起點 ===');
{
  gas.apiGenerateDraftExecute(sc.Q);
  const chair0 = sc.getCell(0, D[0], 'CHAIR#1');
  const other = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => n !== chair0)[0];
  sc.setCell(0, D[0], 'CHAIR#1', other);
  let r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 1 版', r && r.versionNo === 1);
  // 用第 0 版作起點（寫一個標記，OldValue=1）
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  // 模擬「之後重設咗、再生成到第 1 版」：寫一行重設紀錄（時間較後）、再把第 1 版嘅 CreatedAt 推後
  const realNow = gas.nowTimestamp_;
  gas.nowTimestamp_ = () => '2099-01-02 09:00:00';
  gas.writeAuditLog_({ action: 'QUARTER_RESET_BATCH_AFTER', targetSheet: '（多張）', targetKey: sc.Q, oldValue: '', newValue: 'x', source: 't', notes: '' });
  gas.nowTimestamp_ = realNow;
  const V = sc.C.ROSTER_VERSIONS;
  const rvSheet = sc.ss.getSheetByName(sc.S.ROSTER_VERSIONS);
  const keys = rvSheet.getRange(2, 1, 1, rvSheet.getLastColumn()).getValues()[0];
  for (let rr = 3; rr <= rvSheet.getLastRow(); rr++) {
    if (Number(rvSheet.getRange(rr, keys.indexOf(V.VERSION_NO) + 1).getValue()) === 1) rvSheet.getRange(rr, keys.indexOf(V.CREATED_AT) + 1).setValue('2099-01-03 09:00:00');
  }
  check('★★★★★★ 重設之後（而且版本係重設後建立嘅）⇒ 舊標記唔算，儲存來源唔會寫「以第 0 版作起點」',
    gas.readStartPointBasisForSave_(sc.Q, 1) === null, String(gas.readStartPointBasisForSave_(sc.Q, 1)));
  // 之後再真正用一次起點（時間最新）⇒ 算
  gas.nowTimestamp_ = () => '2099-01-04 09:00:00';
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  gas.nowTimestamp_ = realNow;
  check('★★★★★ 重設之後再用起點 ⇒ 算', gas.readStartPointBasisForSave_(sc.Q, 1) === '以第 0 版作起點');
}

console.log('\n=== EH2（F2）：人手清空嘅講員／獻花唔算「沒有人」 ===');
{
  const sc2 = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'SendWarnings.gs'] });
  const g2 = sc2.gas;
  const D2 = sc2.DATES;
  g2.apiGenerateDraftExecute(sc2.Q);
  sc2.setCell(0, D2[0], 'PREACH#1', 'Rev Wong');
  sc2.setCell(0, D2[0], 'FLOWER#1', 'Guest Flower');
  const s1 = g2.apiSaveAndConfirmExecute(sc2.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 1 版有講員、獻花', s1 && s1.versionNo === 1);
  sc2.setCell(1, D2[0], 'PREACH#1', '');
  sc2.setCell(1, D2[0], 'FLOWER#1', '');
  sc2.setCell(1, D2[2], 'READ#1', '');   // 真空格（系統排嘅崗位）
  const plan = g2.apiSaveAndConfirmPlan(sc2.Q);
  const blanks = (plan.blankCells || []).map((b) => b.serviceDate + '|' + b.postId);
  check('★★★★★★ 儲存確認窗：清空嘅講員／獻花唔算「還有 N 格沒有人」（按 Posts.AutoGenerate=FALSE，唔靠上一版旗標）',
    !blanks.some((k) => /\|(PREACH|FLOWER)$/.test(k)), JSON.stringify(blanks));
  check('★★★★★ 真空格（第 3 週讀經）照計，而且只得佢', blanks.length === 1 && blanks[0] === D2[2] + '|READ', JSON.stringify(blanks));
  const chk = g2.apiCheckMyChanges(sc2.Q);
  check('★★★★ 〔檢查我的改動〕同一個數', (chk.blanks || []).length === 1, JSON.stringify(chk.blanks));
}

console.log('\n=== EH3（F3）：第 4 步卡片標題計埋臨時幫手 ===');
{
  const sc3 = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppMainFlow.gs', 'PdfExport.gs', 'PaperPack.gs'] });
  const g3 = sc3.gas;
  const D3 = sc3.DATES;
  g3.apiGenerateDraftExecute(sc3.Q);
  sc3.setCell(0, D3[2], 'CHAIR#1', 'ivan');
  sc3.setCell(0, D3[1], 'CHAIR#1', sc3.nameOf('P9707'));
  g3.apiSetCellDecisions(sc3.Q, [{ serviceDate: D3[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }]);
  let plan = g3.apiSaveAndConfirmPlan(sc3.Q);
  if (plan.needsDecision) g3.apiSetCellDecisions(sc3.Q, (plan.decisionItems.rules || []).map((r) => Object.assign({}, r, { checked: true })));
  const saved = g3.apiSaveAndConfirmExecute(sc3.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 1 版', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 200));
  const state = g3.apiGetPaperListState(sc3.Q);
  const expected = state.noEmail.length + state.tempHelpers.length;
  check('★★★★★★ 卡片標題人數（countPeopleWithoutEmail_）＝ 冇電郵 ＋ 臨時幫手（第 4 步預設勾選人數）',
    g3.countPeopleWithoutEmail_(sc3.Q) === expected && expected === 2, JSON.stringify([g3.countPeopleWithoutEmail_(sc3.Q), state.noEmail, state.tempHelpers]));
  const u = g3.buildUnreachablePeople_(sc3.Q, null);
  check('★★★★★ 同寄出窗「收不到電郵」人數一致', u.people.length === expected, JSON.stringify(u));
  const flow = g3.apiGetMainFlowState ? g3.apiGetMainFlowState(sc3.Q) : null;
  check('★★★★ 主流程 paperCount 同一個數', !flow || flow.paperCount === expected, JSON.stringify(flow && flow.paperCount));
}

console.log('\n=== EH4：字眼 ===');
{
  check('★★★★★ [1,2,3,4,5] ⇒「1 至 5」；[2,4,5,6] ⇒「2」「4 至 6」；[2,3] ⇒「2、3」；[7] ⇒「7」',
    JSON.stringify(gas.formatVersionNoRanges_([1, 2, 3, 4, 5])) === '["1 至 5"]'
    && JSON.stringify(gas.formatVersionNoRanges_([2, 4, 5, 6])) === '["2","4 至 6"]'
    && JSON.stringify(gas.formatVersionNoRanges_([2, 3])) === '["2、3"]'
    && JSON.stringify(gas.formatVersionNoRanges_([7])) === '["7"]');
  const realHist = gas.listSendHistory_;
  const realLatest = gas.findLatestVersionNo;
  gas.listSendHistory_ = () => [];
  gas.findLatestVersionNo = () => 5;
  check('★★★★★★ 「第 1 至 5 版都未寄過給任何人」', gas.buildSendHistoryView_(sc.Q).warnSentence === '⚠️ 目前是第 5 版，第 1 至 5 版都未寄過給任何人。', gas.buildSendHistoryView_(sc.Q).warnSentence);
  gas.listSendHistory_ = () => [{ versionNo: 3, sent: 1, stage: 'REVIEW', sentAt: 'x', total: 1, noEmail: 0, failed: 0 }];
  gas.findLatestVersionNo = () => 6;
  check('★★★★★ 「第 1、2、4 至 6 版未寄過給任何人」', gas.buildSendHistoryView_(sc.Q).warnSentence === '⚠️ 目前是第 6 版，第 1、2、4 至 6 版未寄過給任何人。', gas.buildSendHistoryView_(sc.Q).warnSentence);
  gas.listSendHistory_ = realHist;
  gas.findLatestVersionNo = realLatest;
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
