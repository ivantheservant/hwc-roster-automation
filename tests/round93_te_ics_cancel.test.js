// 第九十三輪批次 TE 組：日曆檔提示句及「已取消」事件（Ivan 決定 D5＝B）。
// 執行方式：node tests/round93_te_ics_cancel.test.js
//
//   TE1 純函式 buildIcsCalendarText_：取消事件 UID 與原事件相同、SEQUENCE 較大、STATUS:CANCELLED、SUMMARY「已取消：」、
//       仍然 METHOD:PUBLISH；每個 VEVENT 的 DESCRIPTION 最後有「（第 N 版，以最新一封信為準）」
//   TE2 computeCancelledCellsForPerson_：上一次實際收到的版本（SendLog SENT 的 OFFICIAL／RESEND）有、這一版沒有的格；
//       第一次寄／找不到 ⇒ 沒有；EXTERNAL、DRY_RUN 不算；取最近一次
//   TE3 buildIcsAttachmentForPerson_：這一版沒有任何崗位但有取消事件 ⇒ 照樣附（只有取消事件）；兩樣都沒有 ⇒ 不附
//   TE4 deliverOne_（RESEND）：信件內文提示句——只在有取消事件時才有第二句；第一次寄（OFFICIAL）沒有取消事件
//   TE5 寄出畫面的說明
// 用假資料（假甲、P9xxx、example.invalid）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs', 'MailRedirect.gs', 'IcsExport.gs', 'PersonalLinkInMail.gs', 'Mailer.gs']);
const unfold = (text) => text.replace(/\r\n /g, '').split('\r\n');

const BASE = {
  quarterId: '2099T1', versionNo: 3, personId: 'P9001',
  assignments: [{ serviceDate: '2099-01-04', postId: 'READ', slotIndex: 1, postNameTC: '讀經' }],
  cancelled: [{ serviceDate: '2099-01-11', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }],
  earlyMinutesByPost: {}, defaultStartTime: '10:30', defaultEndTime: '12:00', dtstampUtc: '20990101T000000Z'
};

console.log('\n=== TE1：ICS 內容 ===');
{
  const text = gas.buildIcsCalendarText_(BASE);
  const lines = unfold(text);
  const events = text.split('BEGIN:VEVENT').slice(1).map((e) => unfold(e.split('END:VEVENT')[0]));
  check('★★★★★ 兩個事件（一個服侍、一個取消）', events.length === 2, String(events.length));
  const cancelEv = events.filter((e) => e.indexOf('STATUS:CANCELLED') !== -1)[0];
  const normalEv = events.filter((e) => e.indexOf('STATUS:CANCELLED') === -1)[0];
  const field = (ev, k) => (ev.filter((l) => l.indexOf(k + ':') === 0)[0] || '').slice(k.length + 1);
  const originalUid = gas.buildIcsUid_('2099T1', 'P9001', '2099-01-11', 'CHAIR', 1);
  check('★★★★★★ 取消事件的 UID 和原事件（上一版同一格）完全相同', field(cancelEv, 'UID') === originalUid, field(cancelEv, 'UID') + ' vs ' + originalUid);
  const prevText = gas.buildIcsCalendarText_(Object.assign({}, BASE, { versionNo: 1, assignments: [{ serviceDate: '2099-01-11', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }], cancelled: [] }));
  const prevSeq = Number((prevText.match(/SEQUENCE:(\d+)/) || [])[1]);
  check('★★★★★★ SEQUENCE ＝ 這一版版本號，比原事件（上一版）大', Number(field(cancelEv, 'SEQUENCE')) === 3 && Number(field(cancelEv, 'SEQUENCE')) > prevSeq, field(cancelEv, 'SEQUENCE') + ' vs ' + prevSeq);
  check('★★★★★ SUMMARY 前加「已取消：」', field(cancelEv, 'SUMMARY') === '已取消：主席', field(cancelEv, 'SUMMARY'));
  check('★★★★★★ 日曆仍然是 METHOD:PUBLISH（不是 REQUEST／CANCEL 邀請）', lines.indexOf('METHOD:PUBLISH') !== -1 && lines.every((l) => !/^METHOD:(REQUEST|CANCEL)/.test(l)));
  check('★★★★ 取消事件時間和原事件一樣（DTSTART／DTEND 同一格）',
    field(cancelEv, 'DTSTART;TZID=Pacific/Auckland') === '20990111T103000' && field(cancelEv, 'DTEND;TZID=Pacific/Auckland') === '20990111T120000');
  check('★★★★★ 每個 VEVENT 的 DESCRIPTION 最後一行是「（第 3 版，以最新一封信為準）」（兩個事件都有）',
    [cancelEv, normalEv].every((e) => /（第 3 版，以最新一封信為準）$/.test(field(e, 'DESCRIPTION').replace(/\\n/g, '\n').trim())), JSON.stringify([field(cancelEv, 'DESCRIPTION'), field(normalEv, 'DESCRIPTION')]));
  check('★★★★ 服侍事件不是取消', field(normalEv, 'SUMMARY') === '讀經');
  const noCancel = gas.buildIcsCalendarText_(Object.assign({}, BASE, { cancelled: [] }));
  check('★★★★ 沒有取消事件 ⇒ 沒有 STATUS:CANCELLED', noCancel.indexOf('CANCELLED') === -1);
}

console.log('\n=== TE2：上一次實際收到的版本 ===');
function sheetScene(sendLog, assignRows) {
  const S = gas.SHEETS;
  gas.readSheet_ = function (name) {
    if (name === S.SEND_LOG) return sendLog;
    if (name === S.ROSTER_ASSIGNMENTS) return assignRows;
    return [];
  };
}
const SL = gas.COLUMNS.SEND_LOG;
const RA = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const sl = (personId, versionNo, stage, status, at) => ({ [SL.QUARTER_ID]: '2099T1', [SL.VERSION_NO]: versionNo, [SL.STAGE]: stage,
  [SL.PERSON_ID]: personId, [SL.STATUS]: status, [SL.SENT_AT]: at });
const ra = (versionNo, personId, date, post, slot) => ({ [RA.QUARTER_ID]: '2099T1', [RA.VERSION_NO]: versionNo, [RA.PERSON_ID]: personId,
  [RA.SERVICE_DATE]: date, [RA.POST_ID]: post, [RA.SLOT_INDEX]: slot });
const ctx = (stage, versionNo) => ({ quarterId: '2099T1', versionNo: versionNo, stage: stage, timezone: 'Pacific/Auckland', postNames: { CHAIR: '主席', READ: '讀經' } });
{
  sheetScene([sl('P9001', 1, 'OFFICIAL', 'SENT', '2099-01-01T00:00:00Z')],
    [ra(1, 'P9001', '2099-01-04', 'READ', 1), ra(1, 'P9001', '2099-01-11', 'CHAIR', 1), ra(2, 'P9001', '2099-01-04', 'READ', 1)]);
  const mine = [{ serviceDate: '2099-01-04', postId: 'READ', slotIndex: 1 }];
  let r = gas.computeCancelledCellsForPerson_(ctx('RESEND', 2), 'P9001', mine);
  check('★★★★★★ 上一次收到第 1 版有「主席」、第 2 版沒有 ⇒ 取消「主席」那一格（帶崗位名稱）', r.length === 1 && r[0].postId === 'CHAIR' && r[0].serviceDate === '2099-01-11' && r[0].postNameTC === '主席', JSON.stringify(r));
  check('★★★★★ 兩版都有的格（讀經）不取消', r.every((c) => c.postId !== 'READ'));
  check('★★★★★★ 第一次寄（OFFICIAL 階段）⇒ 沒有取消事件', gas.computeCancelledCellsForPerson_(ctx('OFFICIAL', 2), 'P9001', mine).length === 0);
  check('★★★★★★ 找不到上一次收到的版本（這個人從沒收過）⇒ 沒有取消事件', gas.computeCancelledCellsForPerson_(ctx('RESEND', 2), 'P9099', mine).length === 0);
  check('★★★★ 沒有 personId ⇒ 沒有', gas.computeCancelledCellsForPerson_(ctx('RESEND', 2), '', mine).length === 0);

  sheetScene([sl('P9001', 1, 'OFFICIAL', 'EXTERNAL', '2099-01-01T00:00:00Z'), sl('P9001', 1, 'OFFICIAL', 'DRY_RUN', '2099-01-02T00:00:00Z'),
    sl('P9001', 1, 'OFFICIAL', 'SKIPPED_NO_EMAIL', '2099-01-02T00:00:00Z')],
  [ra(1, 'P9001', '2099-01-11', 'CHAIR', 1)]);
  check('★★★★★ EXTERNAL、DRY_RUN、查無電郵都不算「收到」⇒ 沒有取消事件', gas.computeCancelledCellsForPerson_(ctx('RESEND', 2), 'P9001', mine).length === 0);

  sheetScene([sl('P9001', 1, 'OFFICIAL', 'SENT', '2099-01-01T00:00:00Z'), sl('P9001', 2, 'RESEND', 'SENT', '2099-01-05T00:00:00Z')],
    [ra(1, 'P9001', '2099-01-11', 'CHAIR', 1), ra(2, 'P9001', '2099-01-18', 'CHAIR', 1)]);
  r = gas.computeCancelledCellsForPerson_(ctx('RESEND', 3), 'P9001', mine);
  check('★★★★★ 收到過兩次 ⇒ 以最近一次（第 2 版）為準：只取消第 2 版有的那一格', r.length === 1 && r[0].serviceDate === '2099-01-18', JSON.stringify(r));
  check('★★★★ 上一次收到的版本不比這一版小（重寄同一版）⇒ 沒有', gas.computeCancelledCellsForPerson_(ctx('RESEND', 2), 'P9001', mine).length === 0);
}

console.log('\n=== TE3：沒有崗位的人 ===');
{
  gas.Utilities = {
    formatDate: () => '20990101T000000Z',
    newBlob: (t, type, name) => ({ text: t, name: name, getBytes: () => Buffer.from(t), getDataAsString: () => t })
  };
  gas.readPostsNormalized_ = () => [];
  gas.getConfig_ = (k, d) => d;
  const c = Object.assign(ctx('RESEND', 3), { postNames: { CHAIR: '主席' } });
  const recipient = { type: 'PERSON', personId: 'P9001', displayName: '假甲' };
  const cancelled = [{ serviceDate: '2099-01-11', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }];
  const a = gas.buildIcsAttachmentForPerson_(c, recipient, [], cancelled);
  check('★★★★★★ 這一版沒有任何崗位、但有取消事件 ⇒ 照樣附日曆檔，只有取消事件',
    a && a.cancelledCount === 1 && /STATUS:CANCELLED/.test(a.blob.text) && (a.blob.text.match(/BEGIN:VEVENT/g) || []).length === 1, a && a.blob && a.blob.text);
  check('★★★★★ 沒有崗位、也沒有取消事件 ⇒ 不附', gas.buildIcsAttachmentForPerson_(c, recipient, [], []) === null && gas.buildIcsAttachmentForPerson_(c, recipient, null) === null);
  check('★★★★ LIST 收件人不附', gas.buildIcsAttachmentForPerson_(c, { type: 'LIST' }, [], cancelled) === null);
}

console.log('\n=== TE4：信件內文提示句 ===');
{
  const NOTICE1 = '附件的日曆檔（.ics）只包括你自己的服侍，請以最新一封信的日曆檔為準。';
  const NOTICE2 = '這個日曆檔亦包括已取消的服侍。Apple 日曆和 Outlook 多數會自動刪除；Google 日曆匯入時未必會刪除，如仍見到舊的服侍事件，請自行刪除。';
  check('★★★★★ 提示句原文（第一句）', gas.ICS_NOTICE_BASE === NOTICE1, gas.ICS_NOTICE_BASE);
  check('★★★★★ 提示句原文（取消事件那一句）', gas.ICS_NOTICE_CANCELLED === NOTICE2, gas.ICS_NOTICE_CANCELLED);
  check('★★★★ appendIcsNotice_：沒有取消事件 ⇒ 只有第一句（純文字、HTML 兩邊）',
    gas.appendIcsNotice_('內文', false, false).indexOf(NOTICE1) !== -1 && gas.appendIcsNotice_('內文', false, false).indexOf('已取消') === -1
    && gas.appendIcsNotice_('<p>內文</p>', false, true).indexOf(NOTICE1) !== -1 && gas.appendIcsNotice_('<p>內文</p>', false, true).indexOf('已取消') === -1);
  check('★★★★ 有取消事件 ⇒ 兩句都有', gas.appendIcsNotice_('內文', true, false).indexOf(NOTICE2) !== -1 && gas.appendIcsNotice_('<p>內文</p>', true, true).indexOf('Google 日曆') !== -1);

  // 真正走 deliverOne_
  const sent = [];
  gas.MailApp = { sendEmail: function () { sent.push(Array.prototype.slice.call(arguments)); } };
  gas.assertNotPreviewMode_ = () => {};
  gas.Utilities = Object.assign({}, gas.Utilities, {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    parseDate: (str) => new Date(String(str).slice(0, 10) + 'T12:00:00Z'),
    computeDigest: (algo, input) => Array.from(require('crypto').createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest())
  });
  gas.getConfig_ = (k, d) => (k === 'DRY_RUN' ? false : d);
  gas.log_ = () => {};
  const template = { templateId: 'T', stage: 'RESEND', subject: '更新', bodyHtml: '<p>{PersonName}</p>', bodyPlain: '{PersonName}', attachType: 'NONE' };
  function run(stage, assignments, prevLog, prevAssign) {
    sheetScene(prevLog, prevAssign);
    sent.length = 0;
    const context = {
      quarterId: '2099T1', versionNo: 2, stage: stage, timezone: 'Pacific/Auckland', postNames: { CHAIR: '主席', READ: '讀經' },
      assignmentsByPerson: { P9001: assignments }, placeholders: {}, lastHashByPerson: {}, notifyReasonByPerson: { P9001: 'CHANGED' },
      sendDecision: { includeIcs: true, attachType: 'NONE', listAttachType: 'NONE' }, subjectPrefix: '', personalTokenById: {}, volunteerBaseUrl: ''
    };
    const out = gas.deliverOne_({ type: 'PERSON', personId: 'P9001', email: 'vol@example.invalid', displayName: '假甲', sendAs: 'TO' }, template, context, false);
    return { out: out, mail: sent[0] };
  }
  const mine = [{ serviceDate: '2099-01-04', postId: 'READ', slotIndex: 1 }];
  const prevLog = [sl('P9001', 1, 'OFFICIAL', 'SENT', '2099-01-01T00:00:00Z')];
  const prevAssign = [ra(1, 'P9001', '2099-01-04', 'READ', 1), ra(1, 'P9001', '2099-01-11', 'CHAIR', 1)];
  let r = run('RESEND', mine, prevLog, prevAssign);
  check('★★★★★★ 改動後重發、有被調走的格 ⇒ 內文兩句提示都有（純文字）', r.mail && r.mail[2].indexOf(NOTICE1) !== -1 && r.mail[2].indexOf(NOTICE2) !== -1, r.mail && r.mail[2]);
  check('★★★★★ HTML 版同樣兩句', r.mail[3].htmlBody.indexOf(NOTICE1) !== -1 && r.mail[3].htmlBody.indexOf('Google 日曆匯入時未必會刪除') !== -1);
  check('★★★★★ 附了日曆檔，而且有取消事件', r.mail[3].attachments.length === 1 && /STATUS:CANCELLED/.test(r.mail[3].attachments[0].text));
  r = run('RESEND', mine, [], []);
  check('★★★★★★ 沒有上一次收到的紀錄 ⇒ 只有第一句，沒有取消事件', r.mail[2].indexOf(NOTICE1) !== -1 && r.mail[2].indexOf(NOTICE2) === -1 && !/CANCELLED/.test(r.mail[3].attachments[0].text));
  r = run('RESEND', mine, prevLog, [ra(1, 'P9001', '2099-01-04', 'READ', 1)]);
  check('★★★★★ 這一版和上一版一樣（沒有格被調走）⇒ 只有第一句', r.mail[2].indexOf(NOTICE2) === -1);
  r = run('OFFICIAL', mine, prevLog, prevAssign);
  check('★★★★★★ 第一次寄（OFFICIAL）⇒ 只有第一句，沒有取消事件', r.mail[2].indexOf(NOTICE1) !== -1 && r.mail[2].indexOf(NOTICE2) === -1 && !/CANCELLED/.test(r.mail[3].attachments[0].text));
  r = run('RESEND', [], prevLog, prevAssign);
  check('★★★★★★ 調走後這一版沒有任何崗位的人 ⇒ RESEND 信照樣附日曆檔（只有取消事件）＋兩句提示',
    r.mail && r.mail[3].attachments.length === 1 && /STATUS:CANCELLED/.test(r.mail[3].attachments[0].text) && r.mail[2].indexOf(NOTICE2) !== -1
    && (r.mail[3].attachments[0].text.match(/BEGIN:VEVENT/g) || []).length === 2, r.mail && JSON.stringify(r.mail[3]).slice(0, 300));
  const ctxNo = (function () {
    sheetScene(prevLog, prevAssign);
    sent.length = 0;
    const c2 = { quarterId: '2099T1', versionNo: 2, stage: 'RESEND', timezone: 'Pacific/Auckland', postNames: {}, assignmentsByPerson: { P9001: mine },
      placeholders: {}, lastHashByPerson: {}, notifyReasonByPerson: { P9001: 'CHANGED' }, sendDecision: { includeIcs: false, attachType: 'NONE', listAttachType: 'NONE' },
      subjectPrefix: '', personalTokenById: {}, volunteerBaseUrl: '' };
    gas.deliverOne_({ type: 'PERSON', personId: 'P9001', email: 'vol@example.invalid', displayName: '假甲' }, template, c2, false);
    return sent[0];
  })();
  check('★★★★★ 幹事揀「不附日曆檔」⇒ 沒有附件，也沒有提示句', ctxNo && (!ctxNo[3].attachments || ctxNo[3].attachments.length === 0) && ctxNo[2].indexOf(NOTICE1) === -1);
}

console.log('\n=== TE5：寄出畫面 ===');
{
  const ui = read('src/ui/ScriptSendPaper.html');
  check('★★★★★ 「附 .ics 日曆檔」旁的說明：只包括收件人自己的服侍日期及時間；改動後重發時，已取消的服侍亦會包括在內',
    ui.indexOf('只包括收件人自己的服侍日期及時間；改動後重發時，已取消的服侍亦會包括在內。') !== -1);
  const mailer = read('src/Mailer.gs');
  check('★★★★ 提示句由程式產生，不改 EmailTemplates 工作表', /appendIcsNotice_\(bodyHtmlBase/.test(mailer) && read('src/EmailTemplateSeed.gs').indexOf('只包括你自己的服侍') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
