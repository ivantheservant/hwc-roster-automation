// 第十四輪批次階段 B：`src/IcsTestSend.gs`（sendIcsTestEmail_）嘅回歸測試。
// 執行方式：node tests/ics_test_send.test.js
//
// 呢個檔案本身係一個「薄組裝層」：真正嘅重活（讀資料、產生 PDF／ICS 附件、
// 真正寄信）全部交俾已經喺其他測試檔驗證過嘅既有函式（buildMailContext_、
// generateMailAttachment_、buildIcsAttachmentForPerson_、sendRealEmail_……）。
// 所以呢度唔重新測嗰啲函式本身，改為用 loadGasSource() 嘅 overrides 機制
// 逐一注入可觀察嘅假實作，只測 IcsTestSend.gs 自己嘅組裝邏輯：
//   - DRY_RUN 唔係 FALSE 就一定拒絕（唔繞過既有防呆）
//   - 收件人電郵一定換成測試地址，唔係呢個人自己喺 NameMapping 登記嘅電郵
//   - 主旨一定帶測試前綴
//   - 揀嘅人搵唔到／冇派工都要清楚拒絕
//   - PDF 產生失敗要整個中止（同 deliverOne_ 一致），ICS 產生失敗只警告唔中止
//   - 完全唔碰 SendLog，只寫 AuditLog，AuditLog 唔會記低實際測試電郵地址

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkThrows(label, fn, messagePattern) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  const ok = err !== null && (!messagePattern || messagePattern.test(err.message));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log('      ' + (err ? ('實際訊息：' + err.message) : '沒有拋出任何錯誤'));
}

/**
 * 建一組可觀察嘅假依賴＋一個 loadGasSource() 出嚟嘅沙箱。每個測試場景各自
 * 呼叫一次，方便逐場景控制 dryRun／peopleById／assignmentsByPerson 等狀態，
 * 唔使互相污染。
 */
function buildSandbox(opts) {
  const o = opts || {};
  const dryRunValue = o.dryRunValue === undefined ? false : o.dryRunValue;
  const calls = { sendRealEmail: [], writeAuditLog: [], generateMailAttachment: [], buildIcsAttachment: [] };

  const context = {
    peopleById: o.peopleById || { P001: { personId: 'P001', nameTC: '陳大文', email: 'realvolunteer@x.com' } },
    assignmentsByPerson: o.assignmentsByPerson || {
      P001: [{ serviceDate: '2027-01-10', postId: 'CHAIR', slotIndex: 1 }]
    },
    postNames: { CHAIR: '主席' },
    timezone: 'Pacific/Auckland',
    subjectPrefix: '[粵語堂職事表] ',
    placeholders: {}
  };

  const templates = o.templates !== undefined ? o.templates : {
    person: { subject: '{QuarterID} 職事表已發出', bodyHtml: '<p>hi</p>', bodyPlain: 'hi', attachType: 'PERSONAL_PDF' },
    list: null
  };

  const overrides = {
    getConfig: function (key) { return key === 'DRY_RUN' ? dryRunValue : undefined; },
    log_: function () {},
    assertNotPreviewMode_: function () {},
    buildMailContext_: function () { return context; },
    resolveStageTemplates_: function () { return templates; },
    generateMailAttachment_: function (template, ctx, recipient) {
      calls.generateMailAttachment.push({ template: template, recipient: recipient });
      if (o.pdfThrows) throw new Error('請先執行『產生個人 PDF』（找不到檔案）');
      return { blob: 'FAKE_PDF_BLOB', fileName: 'fake.pdf' };
    },
    buildIcsAttachmentForPerson_: function (ctx, recipient, assignments) {
      calls.buildIcsAttachment.push({ recipient: recipient, assignments: assignments });
      if (o.icsThrows) throw new Error('ICS 產生失敗（測試模擬）');
      return { blob: 'FAKE_ICS_BLOB', fileName: 'fake.ics' };
    },
    buildAssignmentSummary_: function () { return '主席：2027-01-10'; },
    applyPlaceholders_: function (text) { return text; },
    decorateAttachmentName_: function (a) { return a.fileName; },
    sendRealEmail_: function (recipient, subject, bodyHtml, bodyPlain, ctx, attachment, icsAttachment) {
      calls.sendRealEmail.push({
        recipient: recipient, subject: subject, bodyHtml: bodyHtml,
        attachment: attachment, icsAttachment: icsAttachment
      });
    },
    writeAuditLog_: function (entry) { calls.writeAuditLog.push(entry); }
  };

  const gas = loadGasSource(['Constants.gs', 'IcsTestSend.gs'], overrides);
  return { gas: gas, calls: calls };
}

console.log('\n=== 【核心】DRY_RUN 不是 FALSE 就一定拒絕，不會被這個測試工具繞過 ===');
{
  const { gas, calls } = buildSandbox({ dryRunValue: true });
  checkThrows('★★★★ DRY_RUN=TRUE 時直接拒絕，不會呼叫 sendRealEmail_',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com'); },
    /DRY_RUN/);
  check('★★★ 拒絕時完全沒有呼叫 sendRealEmail_（不會不小心寄出）', calls.sendRealEmail.length === 0);
}
{
  const { gas, calls } = buildSandbox({ dryRunValue: 'TRUE' }); // Config 常見寫法：字串 "TRUE"，不是 boolean true
  checkThrows('★★ DRY_RUN 值是字串 "TRUE"（不是 boolean）一樣被拒絕（同 getConfig 全專案既有慣例 !== false 一致）',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com'); }, /DRY_RUN/);
}

console.log('\n=== 【核心】收件人電郵一定換成測試地址，不是這個人自己的真實電郵 ===');
{
  const { gas, calls } = buildSandbox({ dryRunValue: false });
  const result = gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress-test@x.com');

  check('★★★★ sendRealEmail_ 只被呼叫一次（只寄一封）', calls.sendRealEmail.length === 1);
  const sent = calls.sendRealEmail[0];
  check('★★★★ 實際收件人電郵是測試地址，不是 realvolunteer@x.com（不可以寄給義工本人）',
    sent.recipient.email === 'myaddress-test@x.com', 'got=' + sent.recipient.email);
  check('★★ recipient.personId 仍然是 P001（下游附件產生要靠呢個搵返真實派工資料）',
    sent.recipient.personId === 'P001');
  check('★★★ 主旨帶測試前綴，並且清楚寫住資料來源姓名（陳大文），避免收件人誤以為係正式發出',
    sent.subject.indexOf('測試郵件') !== -1 && sent.subject.indexOf('陳大文') !== -1,
    'subject=' + sent.subject);
  check('★ 回傳值帶測試地址、資料來源姓名、附件名稱', result.testEmail === 'myaddress-test@x.com'
    && result.displayName === '陳大文' && result.attachmentName.indexOf('fake.pdf') !== -1
    && result.attachmentName.indexOf('fake.ics') !== -1);
}

console.log('\n=== 找不到 PersonID／該人本季沒有派工，都清楚拒絕 ===');
{
  const { gas } = buildSandbox({ dryRunValue: false, peopleById: {} });
  checkThrows('★★★ 揀咗一個唔存在（或 Active 唔係 TRUE）嘅 PersonID 會清楚拒絕',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P404', 'myaddress@x.com'); }, /找不到 PersonID/);
}
{
  const { gas } = buildSandbox({
    dryRunValue: false,
    peopleById: { P001: { personId: 'P001', nameTC: '陳大文', email: 'realvolunteer@x.com' } },
    assignmentsByPerson: {}
  });
  checkThrows('★★★ 揀咗一個本季完全冇派工嘅人會清楚拒絕（唔會寄一封冇嘢好驗證嘅空信）',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com'); }, /沒有任何派工/);
}
{
  const { gas } = buildSandbox({ dryRunValue: false, templates: { person: null, list: null } });
  checkThrows('★★ 搵唔到 TPL_OFFICIAL_TC 範本會清楚拒絕',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com'); }, /TPL_OFFICIAL_TC|範本/);
}

console.log('\n=== PDF 產生失敗要整個中止；ICS 產生失敗只警告、不中止（同 deliverOne_ 行為一致）===');
{
  const { gas, calls } = buildSandbox({ dryRunValue: false, pdfThrows: true });
  checkThrows('★★★ 個人 PDF 未產生（Shared Drive 搵唔到）時整個測試信中止，唔會寄出「假裝正常」嘅信',
    function () { gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com'); }, /產生個人 PDF/);
  check('★★ PDF 失敗時完全冇呼叫 sendRealEmail_', calls.sendRealEmail.length === 0);
}
{
  const { gas, calls } = buildSandbox({ dryRunValue: false, icsThrows: true });
  const result = gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress@x.com');
  check('★★★ ICS 產生失敗唔會中止寄信（同 deliverOne_ 一致：ICS 係錦上添花，唔應該累到已經產生好嘅 PDF 都寄唔出）',
    calls.sendRealEmail.length === 1);
  check('★ 附件名稱冇 ICS（因為產生失敗），但有 PDF', result.attachmentName.indexOf('fake.pdf') !== -1
    && result.attachmentName.indexOf('fake.ics') === -1);
}

console.log('\n=== 【核心】完全不寫 SendLog（避免污染這個人之後正式 OFFICIAL／RESEND 的判斷），只寫 AuditLog ===');
{
  const { gas, calls } = buildSandbox({ dryRunValue: false });
  gas.sendIcsTestEmail_('2027T1', 3, 'P001', 'myaddress-test@x.com');
  check('★★★★ 剛好呼叫咗一次 writeAuditLog_', calls.writeAuditLog.length === 1);
  const entry = calls.writeAuditLog[0];
  check('★★ AuditLog 完全冇記低實際測試電郵地址（避免喺 AuditLog 留低個人聯絡方式）',
    JSON.stringify(entry).indexOf('myaddress-test@x.com') === -1, JSON.stringify(entry));

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'IcsTestSend.gs'), 'utf8');
  check('★★★★ 原始碼本身完全冇出現 SHEETS.SEND_LOG／writeSendLogRows_'
    + '（靜態鎖住「刻意唔寫 SendLog」呢個設計決定，唔淨係得註解講）',
    source.indexOf('SHEETS.SEND_LOG') === -1 && source.indexOf('writeSendLogRows_') === -1);
}

console.log('\n=== 選單入口（runSendIcsTestEmail_）：DRY_RUN 仍為 TRUE 時直接擋，不會走到任何 prompt ===');
{
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'IcsTestSend.gs'), 'utf8');
  const start = source.indexOf('function runSendIcsTestEmail_');
  const body = source.slice(start);
  check('★★★ runSendIcsTestEmail_ 一開始就檢查 DRY_RUN，唔係一路 prompt 到最後先發現寄唔到',
    /const dryRun = getConfig\(CONFIG_KEYS\.DRY_RUN, true\) !== false;/.test(body)
      && body.indexOf('if (dryRun) {') < body.indexOf('promptQuarterAndVersion_'));
}

console.log('\n=== Menu.gs 有掛呢個新選單項目 ===');
{
  const menuSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'Menu.gs'), 'utf8');
  check('★★ 「測試工具」子選單有掛「寄送單一 ICS／highlight 測試信」',
    /addItem\('⚠️ 寄送單一 ICS／highlight 測試信', 'runSendIcsTestEmail_'\)/.test(menuSource));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
