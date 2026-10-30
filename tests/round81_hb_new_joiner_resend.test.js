// 第八十一輪批次 HB 組：〔變動的人〕漏咗「新加入、之前未收過信」嘅人。
// 執行方式：node tests/round81_hb_new_joiner_resend.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（demo 前最後回歸 M12／M13／M15.2）
// ═════════════════════════════════════════════════════════════════════
//
//   正式發出（第 5 版）之後，把第 9 週讀經由甲換成乙；乙喺第 5 版**冇任何崗位**（所以當時冇收信）。
//   〔變動的人〕只列甲 1 位，乙被歸入「另外 9 位上一次沒有收到」；完成窗「模擬 1 封」。
//   新換入嘅人收唔到「你新增咗一格」嘅通知——佢正正係最需要通知嘅人。
//
//   HB1　基準版本＝SendLog 最後一次 OFFICIAL／RESEND（或 EXTERNAL）嗰一版
//   HB2　冇舊 hash 嘅人分兩類：新加入（基準版本冇安排、從未收過）⇒ 安排有改動；漏收 ⇒ 照舊
//   HB3　〔變動的人〕列出甲、乙兩位；乙「原本：（上一次沒有安排）」；確認窗人數＝2
//   HB4　真正寄出兩人都有上游理由（唔會被 SKIPPED_UNCHANGED 擋）；PDF 名單有乙
//   HB5　讀唔到基準 ⇒ 同以前一樣（冇舊 hash 一律當漏收）
//   HB6　乙經〔變動的人〕收過之後，補寄唔再列佢（RESEND 都算收過）

const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SendRecipients.gs', 'SendOptions.gs', 'Mailer.gs',
  'ResendFlow.gs', 'WebAppGuards.gs', 'WebAppSendPlan.gs', 'MakeupSend.gs'
]);
gas.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: function (_a, value) {
    return Array.prototype.slice.call(require('crypto').createHash('sha256').update(String(value), 'utf8').digest());
  }
};
gas.buildAssignmentSummary_ = function (list) {
  return list.map(function (a) { return a.serviceDate + ' ' + a.postId; }).join('；');
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};

const Q = '2098T3';
const SL = gas.COLUMNS.SEND_LOG;
const RA = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const cell = function (date, postId) { return { serviceDate: date, postId: postId, slotIndex: 1 }; };
const sendRow = function (stage, v, personId, status, at) {
  return { [SL.QUARTER_ID]: Q, [SL.STAGE]: stage, [SL.VERSION_NO]: v, [SL.PERSON_ID]: personId,
    [SL.STATUS]: status, [SL.SENT_AT]: at };
};
const raRow = function (v, personId) { return { [RA.QUARTER_ID]: Q, [RA.VERSION_NO]: v, [RA.PERSON_ID]: personId }; };

// 甲＝P9801（第 5 版有 2 格，第 9 週讀經被換走）；乙＝P9802（第 5 版冇任何崗位，第 6 版接手）；
// 丙＝P9803（第 5 版有崗位、冇電郵 ⇒ SKIPPED_NO_EMAIL，有 hash）；丁＝P9804（第 5 版有崗位、寄失敗 ⇒ 冇 hash＝漏收）
let SEND_LOG = [
  sendRow('REVIEW', 4, 'P9805', 'DRY_RUN', '2098-06-01T10:00:00Z'),
  sendRow('OFFICIAL', 5, 'P9801', 'DRY_RUN', '2098-06-10T10:00:00Z'),
  sendRow('OFFICIAL', 5, 'P9803', 'SKIPPED_NO_EMAIL', '2098-06-10T10:00:00Z'),
  sendRow('OFFICIAL', 5, 'P9804', 'FAILED', '2098-06-10T10:00:00Z')
];
const RA_ROWS = [raRow(5, 'P9801'), raRow(5, 'P9801'), raRow(5, 'P9803'), raRow(5, 'P9804'),
  raRow(6, 'P9801'), raRow(6, 'P9802'), raRow(6, 'P9803'), raRow(6, 'P9804')];
gas.readSheet_ = function (name) {
  if (name === gas.SHEETS.SEND_LOG) return SEND_LOG;
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return RA_ROWS;
  return [];
};

console.log('\n=== HB1：基準版本 ===');
const baseline = gas.readResendBaseline_(Q);
{
  check('★★★★★★ 基準＝最後一次 OFFICIAL（第 5 版），唔係 REVIEW 嗰一版', baseline && baseline.versionNo === 5, JSON.stringify(baseline));
  check('★★★★★ 第 5 版有安排：甲、丙、丁（冇乙）',
    baseline.assignedById.P9801 && baseline.assignedById.P9803 && baseline.assignedById.P9804 && !baseline.assignedById.P9802);
  check('★★★★★ 曾經喺正式發出名單：甲、丙、丁（REVIEW 唔算）',
    baseline.everSentById.P9801 && baseline.everSentById.P9804 && !baseline.everSentById.P9805 && !baseline.everSentById.P9802);
  const prev = SEND_LOG;
  SEND_LOG = [sendRow('REVIEW', 4, 'P9805', 'DRY_RUN', '2098-06-01T10:00:00Z')];
  check('★★★★ 未正式發出過 ⇒ null', gas.readResendBaseline_(Q) === null);
  SEND_LOG = prev;
  check('★★★★ 讀唔到 ⇒ 安全版回 null', (function () {
    const r = gas.readSheet_; gas.readSheet_ = function () { throw new Error('x'); };
    const out = gas.readResendBaselineSafe_(Q); gas.readSheet_ = r; return out === null;
  })());
}

const oldP1 = [cell('2098-08-20', 'READ'), cell('2098-08-27', 'READ')];
const oldP3 = [cell('2098-07-02', 'USHER')];
const people = {
  P9801: { personId: 'P9801', nameTC: '假甲', email: 'p9801@example.invalid' },
  P9802: { personId: 'P9802', nameTC: '假乙', email: 'p9802@example.invalid' },
  P9803: { personId: 'P9803', nameTC: '假丙', email: '' },
  P9804: { personId: 'P9804', nameTC: '假丁', email: 'p9804@example.invalid' }
};
const makeContext = function (withBaseline) {
  return {
    stage: 'RESEND',
    assignmentsByPerson: {
      P9801: [cell('2098-08-20', 'READ')],
      P9802: [cell('2098-08-27', 'READ')],
      P9803: oldP3,
      P9804: [cell('2098-07-09', 'CHAIR')]
    },
    lastHashByPerson: { P9801: gas.computeAssignmentHash_(oldP1), P9803: gas.computeAssignmentHash_(oldP3) },
    lastStatusByPerson: { P9801: 'DRY_RUN', P9803: 'SKIPPED_NO_EMAIL' },
    lastSummaryByPerson: { P9801: '20/08 讀經；27/08 讀經' },
    peopleById: people, postNames: {}, timezone: 'Pacific/Auckland',
    resendBaseline: withBaseline ? baseline : null
  };
};

console.log('\n=== HB2【核心】冇舊 hash 嘅人分兩類 ===');
const ctx = makeContext(true);
const diff = gas.computeResendDiff_(ctx);
{
  const by = {};
  diff.forEach(function (c) { by[c.personId] = c; });
  check('（前置）改動名單：甲、乙、丁（丙冇變）', Object.keys(by).sort().join(',') === 'P9801,P9802,P9804', Object.keys(by).join(','));
  check('★★★★★★ 乙＝新加入（基準版本冇安排、從未收過）', by.P9802.newJoiner === true);
  check('★★★★★★ 乙算「安排有改動」', gas.isArrangementChangedSinceLastSend_(by.P9802) === true);
  check('★★★★★ 乙嘅上游理由係 NEW_ASSIGNMENT', by.P9802.notifyReason === gas.RESEND_NOTIFY_REASON.NEW_ASSIGNMENT, by.P9802.notifyReason);
  check('★★★★★★ 丁（基準版本有安排、寄失敗）唔係新加入 ⇒ 照舊「上一次沒有收到」',
    by.P9804.newJoiner === false && gas.isArrangementChangedSinceLastSend_(by.P9804) === false);
  check('★★★★★ 甲照舊「安排有改動」', gas.isArrangementChangedSinceLastSend_(by.P9801) === true && by.P9801.newJoiner === false);
}

console.log('\n=== HB3【核心】〔變動的人〕列出甲、乙兩位 ===');
gas.buildMailContext_ = function () { return makeContext(true); };
gas.findLatestVersionNo_ = function () { return 6; };
gas.readSendLogSummaryForDashboard_ = function () { return { officialSentOnce: true }; };
gas.readResendChangeNotes_ = function () { return {}; };
gas.findLastSentSnapshot_ = function () { return { versionNo: 5, sentAt: '2098-06-10 22:00', stage: 'OFFICIAL' }; };
gas.buildCurrentArrangementByPerson_ = function () { return {}; };
{
  const plan = gas.planResendChangedPersons_(Q);
  const p2 = plan.changed.filter(function (c) { return c.personId === 'P9802'; })[0];
  check('★★★★★★ 乙「原本：（上一次沒有安排）」', p2 && p2.previousSummary === '（上一次沒有安排）', p2 && p2.previousSummary);
  check('★★★★★ 安排有改動 2 位、上一次沒有收到 1 位', plan.arrangementChangedCount === 2 && plan.notReceivedCount === 1,
    JSON.stringify({ a: plan.arrangementChangedCount, n: plan.notReceivedCount }));
  const r = gas.apiGetSendChangedRecipients(Q);
  check('（前置）ok', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 〔變動的人〕：甲、乙', r.people.map(function (p) { return p.personId; }).sort().join(',') === 'P9801,P9802',
    JSON.stringify(r.people.map(function (p) { return p.personId; })));
  check('★★★★★★ 預設勾選甲、乙（寄出窗、確認窗人數＝2）', r.pickedKeys.slice().sort().join(',') === 'P9801,P9802', JSON.stringify(r.pickedKeys));
  check('★★★★★ 「另外 1 位上一次沒有收到」（丁）', r.notReceivedCount === 1, String(r.notReceivedCount));
}

console.log('\n=== HB4【核心】真正寄出兩人都有理由；PDF 名單有乙 ===');
gas.findEmailTemplateById_ = function (id) {
  return id === 'TPL_RESEND_TC' ? { attachType: 'PERSONAL_PDF' } : (id === 'TPL_RESEND_LIST_TC' ? { attachType: 'NONE' } : null);
};
gas.findEmailTemplate_ = function () { return { attachType: 'PERSONAL_PDF' }; };
{
  const c2 = makeContext(true);
  const changedIds = gas.computeResendDiff_(c2).map(function (c) { return c.personId; });
  const opts = { recipientScope: 'PICK', pickedKeys: ['P9801', 'P9802'], attachType: 'PERSONAL_PDF' };
  c2.notifyReasonByPerson = {};
  gas.computeResendDiff_(c2).forEach(function (c) { c2.notifyReasonByPerson[c.personId] = c.notifyReason; });
  const decision = gas.resolveSendOptions_('RESEND', opts, { person: { attachType: 'PERSONAL_PDF' }, list: null });
  const targets = gas.resolveResendTargetPersonIds_(c2, decision, changedIds, false);
  check('★★★★★★ 真正寄出：甲、乙', targets.slice().sort().join(',') === 'P9801,P9802', JSON.stringify(targets));
  check('★★★★★★ 兩人都有上游理由（唔會被「內容沒變」擋）',
    !!c2.notifyReasonByPerson.P9801 && c2.notifyReasonByPerson.P9802 === 'NEW_ASSIGNMENT', JSON.stringify(c2.notifyReasonByPerson));
  const pdf = gas.listResendPdfTargetPersonIds_(makeContext(true), opts, changedIds);
  check('★★★★★★ 要產生個人 PDF：甲、乙', pdf.join(',') === 'P9801,P9802', JSON.stringify(pdf));
}

console.log('\n=== HB5：讀唔到基準 ⇒ 同以前一樣 ===');
{
  const d = gas.computeResendDiff_(makeContext(false));
  const p2 = d.filter(function (c) { return c.personId === 'P9802'; })[0];
  check('★★★★★ 冇基準 ⇒ 乙唔當新加入（照舊上一次沒有收到）', p2 && p2.newJoiner === false
    && gas.isArrangementChangedSinceLastSend_(p2) === false);
}

console.log('\n=== HB6：乙經〔變動的人〕收過之後，補寄唔再列佢 ===');
{
  const rows = SEND_LOG.concat([sendRow('RESEND', 6, 'P9802', 'DRY_RUN', '2098-06-20T10:00:00Z')]);
  const idx = gas.buildQuarterNoticeReceivedIndex_(Q, 'OFFICIAL', rows);
  check('★★★★★★ 補寄（正式發出給全體）當乙已收過', gas.isNoticeReceivedRecord_(idx.P9802) === true, JSON.stringify(idx.P9802));
  check('★★★★ 丁（寄失敗）仍然未收過', gas.isNoticeReceivedRecord_(idx.P9804) === false, JSON.stringify(idx.P9804));
}

console.log('\n=== HB7：改動後重發嘅 context 真係帶基準（靜態）===');
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  check('★★★★★ buildMailContext_（RESEND）讀基準版本',
    src.indexOf('resendBaseline: stage === MAIL_STAGES.RESEND ? readResendBaselineSafe_(quarterId) : null') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
