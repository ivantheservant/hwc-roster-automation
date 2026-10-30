// 第八十四輪批次 KE 組：〔變動的人〕要列出被換走而沒有電郵的人。
// 執行方式：node tests/round84_ke_changed_no_email.test.js
//
// 現場（第八十三輪 G21）：第 12 週讀經原本嗰位被換走，但佢冇電郵（上一次正式發出時唔喺收件名單，
// SendLog 冇佢嘅 hash）⇒ 〔變動的人〕只列換入嗰位，原本嗰位完全冇提。
//
//   KE1　後端：noEmailChanged 列出被換走、冇電郵嘅人（原本／現在）；同基準版本比較
//   KE2　唔改變寄給誰同人數（pickedKeys、people 照舊）
//   KE3　安排冇變、冇電郵嘅人唔列；有電郵嘅人唔列
//   KE4　前端寄出窗：「這幾位的安排有改動，但沒有電郵，請另外通知」逐個寫名字同改動
//   KE5　前端完成窗：同樣列出
// 下面用假名、假 PersonID。

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
  return { [SL.QUARTER_ID]: Q, [SL.STAGE]: stage, [SL.VERSION_NO]: v, [SL.PERSON_ID]: personId, [SL.STATUS]: status, [SL.SENT_AT]: at };
};
const raRow = function (v, personId, date, postId) {
  return { [RA.QUARTER_ID]: Q, [RA.VERSION_NO]: v, [RA.PERSON_ID]: personId, [RA.SERVICE_DATE]: date, [RA.POST_ID]: postId, [RA.SLOT_INDEX]: 1 };
};
// 甲＝P9811（有電郵，第 5 版冇崗位，第 6 版接手第 12 週讀經）；乙＝P9812（冇電郵，第 5 版第 12 週讀經，第 6 版被換走）
// 丙＝P9813（冇電郵，兩版一樣）；丁＝P9814（有電郵，兩版一樣）
const SEND_LOG = [
  sendRow('OFFICIAL', 5, 'P9814', 'DRY_RUN', '2098-06-10T10:00:00Z')
];
const RA_ROWS = [
  raRow(5, 'P9812', '2098-09-20', 'READ'), raRow(5, 'P9812', '2098-07-05', 'USHER'),
  raRow(5, 'P9813', '2098-07-12', 'USHER'), raRow(5, 'P9814', '2098-07-19', 'CHAIR'),
  raRow(6, 'P9811', '2098-09-20', 'READ'), raRow(6, 'P9812', '2098-07-05', 'USHER'),
  raRow(6, 'P9813', '2098-07-12', 'USHER'), raRow(6, 'P9814', '2098-07-19', 'CHAIR')
];
gas.readSheet_ = function (name) {
  if (name === gas.SHEETS.SEND_LOG) return SEND_LOG;
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return RA_ROWS;
  return [];
};
const people = {
  P9811: { personId: 'P9811', nameTC: '假甲', email: 'p9811@example.invalid' },
  P9812: { personId: 'P9812', nameTC: '假乙', email: '' },
  P9813: { personId: 'P9813', nameTC: '假丙', email: '' },
  P9814: { personId: 'P9814', nameTC: '假丁', email: 'p9814@example.invalid' }
};
const baseline = gas.readResendBaseline_(Q);
gas.buildMailContext_ = function () {
  return {
    stage: 'RESEND',
    assignmentsByPerson: {
      P9811: [cell('2098-09-20', 'READ')], P9812: [cell('2098-07-05', 'USHER')],
      P9813: [cell('2098-07-12', 'USHER')], P9814: [cell('2098-07-19', 'CHAIR')]
    },
    lastHashByPerson: { P9814: gas.computeAssignmentHash_([cell('2098-07-19', 'CHAIR')]) },
    lastStatusByPerson: { P9814: 'DRY_RUN' },
    lastSummaryByPerson: {},
    peopleById: people, postNames: {}, timezone: 'Pacific/Auckland',
    resendBaseline: baseline
  };
};
gas.findLatestVersionNo_ = function () { return 6; };
gas.readSendLogSummaryForDashboard_ = function () { return { officialSentOnce: true }; };
gas.readResendChangeNotes_ = function () { return {}; };
gas.findLastSentSnapshot_ = function () { return { versionNo: 5, sentAt: '2098-06-10 22:00', stage: 'OFFICIAL' }; };
gas.buildCurrentArrangementByPerson_ = function () { return {}; };

console.log('\n=== KE1–KE3：後端 ===');
const r = gas.apiGetSendChangedRecipients(Q);
check('（前置）ok', r.ok === true, JSON.stringify(r).slice(0, 300));
const ne = r.noEmailChanged || [];
check('★★★★★★ KE1 列出被換走、冇電郵嘅乙', ne.length === 1 && ne[0].personId === 'P9812' && ne[0].nameTC === '假乙', JSON.stringify(ne));
check('★★★★★★ KE1 原本／現在（同上一次正式發出嗰一版比較）', ne[0] && ne[0].previousSummary === '2098-07-05 USHER；2098-09-20 READ'
  && ne[0].currentSummary === '2098-07-05 USHER', JSON.stringify(ne[0]));
check('★★★★★★ KE2 唔改變寄給誰：只寄甲（新加入）', r.pickedKeys.join(',') === 'P9811' && r.people.map((p) => p.personId).join(',') === 'P9811',
  JSON.stringify([r.pickedKeys, r.people]));
check('★★★★★ KE3 安排冇變嘅丙、有電郵嘅丁唔列', ne.every((p) => p.personId !== 'P9813' && p.personId !== 'P9814'), JSON.stringify(ne));
{
  // 整個換走（呢一版冇任何崗位）⇒「現在：這一季沒有安排」
  const save = RA_ROWS.splice(5, 1);
  const ctx0 = gas.buildMailContext_;
  gas.buildMailContext_ = function () { const c = ctx0(); delete c.assignmentsByPerson.P9812; return c; };
  const r2 = gas.apiGetSendChangedRecipients(Q);
  const p = (r2.noEmailChanged || [])[0] || {};
  check('★★★★★ KE1 整個換走 ⇒「現在：這一季沒有安排」', p.personId === 'P9812' && p.currentSummary === '這一季沒有安排', JSON.stringify(r2.noEmailChanged));
  gas.buildMailContext_ = ctx0;
  RA_ROWS.splice(5, 0, save[0]);
}

console.log('\n=== KE4：前端寄出窗 ===');
const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptSendPaper.html']);
{
  ui.__r = r;
  vm.runInContext("sendMode_ = 'CHANGED'; sendModeData_ = __r; sendPool_ = [{ key: 'P9811', personId: 'P9811', type: 'PERSON', displayName: '假甲', hasEmail: true, selectable: true, sources: ['CHANGED'] }];"
    + " sendPoolGroups_ = [{ key: 'CHANGED', label: '安排有改動的人', total: 1, selectable: 1, members: [] }];"
    + " sendOptions_ = { pickedKeys: ['P9811'], extraEmails: [], attachType: 'NONE', includeIcs: false };", ui);
  ui.drawSendMain({ kind: 'RESEND', latestVersion: { versionNo: 6 }, sendHistory: { batches: [] }, permanentLink: { hasLink: true }, attachOptionNotes: {} });
  const t = ui.document.getElementById('modalBody').textContent;
  check('★★★★★★ KE4 寄出窗有「這幾位的安排有改動，但沒有電郵，請另外通知」', t.indexOf('這幾位的安排有改動，但沒有電郵，請另外通知（1 位）') !== -1, t);
  check('★★★★★★ KE4 逐個寫名字同改動（原本／現在）', t.indexOf('假乙') !== -1 && t.indexOf('原本：2098-07-05 USHER；2098-09-20 READ／現在：2098-07-05 USHER') !== -1, t);
  check('★★★★★ KE2 寄給誰人數照舊（1 位）', t.indexOf('這一次會寄給 1 位') !== -1, t);
}

console.log('\n=== KE5：前端完成窗 ===');
{
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.callServerMutating = async (name) => {
    if (name === 'apiStep5GeneratePdfs') return { done: true, total: 0, generated: 0, skipped: 0, failed: 0 };
    return { isDryRun: true, sent: 0, dryRun: 1, skipped: 0, zeroAssignmentPeople: [] };
  };
  (async () => {
    await ui.resendGeneratePdfsThenSend('', null);
    const t = ui.document.getElementById('modalBody').textContent;
    check('★★★★★★ KE5 完成窗同樣列出', ui.document.getElementById('modalTitle').textContent === '改動後重發：完成'
      && t.indexOf('這幾位的安排有改動，但沒有電郵，請另外通知（1 位）') !== -1 && t.indexOf('假乙') !== -1, t);
    vm.runInContext("sendMode_ = 'ALL';", ui);
    await ui.resendGeneratePdfsThenSend('', null);
    check('★★★★ 其他掣嘅完成窗唔出呢一段', ui.document.getElementById('modalBody').textContent.indexOf('請另外通知') === -1);
    console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
    process.exit(fail === 0 ? 0 : 1);
  })().catch((e) => { console.log('FAIL  未預期例外：' + e.stack); process.exit(1); });
}
