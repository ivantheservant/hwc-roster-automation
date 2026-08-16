/**
 * 第十四輪批次階段 B：ICS 日曆檔是四個新功能（一季一條固定連結／個人專屬
 * 連結／ICS／深色模式）之中唯一從未在真實環境驗證過的一個——`docs/ICS檔樣本.md`
 * 已經用離線產生器逐項核對過內容格式，但從未有人真正收過一封帶 ICS 附件的信、
 * 用真機（尤其 iPhone Mail）打開驗證過。
 *
 * 呢個檔案提供一個獨立、範圍收得好窄嘅測試工具：用某個真實在職人員本季**真實**
 * 派工資料，組出同「步驟 4：正式發出」一模一樣嘅信件內容（個人 highlight PDF
 * ＋ICS 附件），但只寄去一個由操作者當場輸入嘅測試電郵地址——**絕對唔會寄去
 * 任何義工自己嘅電郵**，亦唔會影響任何人之後真正嘅寄送判斷。
 *
 * ## 點解要獨立一個函式，唔重用 sendStage()
 * `sendStage()`（`Mailer.gs`）一定會寄畀 `listRecipients_()` 傳返嘅全部
 * 收件人（可能幾十人），冇「淨係寄一個人」呢個參數，唔可以借嚟做單一測試信。
 *
 * ## 點解唔寫入 SendLog
 * `SendLog` 嘅 `Stage=OFFICIAL＋QuarterID＋VersionNo＋PersonID` 組合會被
 * `countAlreadySentForStage_()`／`readLastHashByPerson_()` 用嚟判斷「呢個人
 * 呢一版係咪已經寄過」。如果呢個純測試用途嘅寄送寫成同一個 Stage，會令呢個人
 * 之後真正嘅 OFFICIAL／RESEND 被誤判成「已經寄過」，可能導致佢實際上冇收到過
 * 信但系統以為佢收咗。改用 `AuditLog` 記錄呢次測試（唔會被任何 dedup 邏輯
 * 讀取），`SendLog` 完全唔動。
 *
 * ## DRY_RUN 呢個測試路徑點處理——刻意唔繞過
 * `sendRealEmail_()`（全專案淨係兩個會真正呼叫 `MailApp.sendEmail()` 嘅函式
 * 之一）本身有一重防呆：Config 嘅 `DRY_RUN` 唔係 `FALSE` 就拒絕寄出。
 * 呢個檔案**刻意唔繞過呢重防呆**——`DRY_RUN` 係全專案防止「唔小心真係寄咗畀
 * 成班義工」嘅唯一總開關，如果為咗呢個測試工具開一個特例令佢喺 `DRY_RUN=TRUE`
 * 都可以寄出，就會喺呢個總開關度開一個缺口，日後任何人（包括未來嘅自己）都
 * 可能誤用呢個缺口去繞過正常防呆，風險遠大過「測試呢一封信要記得手動去 Config
 * 將 DRY_RUN 暫時改做 FALSE、用完改返 TRUE」呢個額外步驟。所以：**用呢個工具
 * 之前必須人手去 Config 將 DRY_RUN 暫時改做 FALSE**，`runSendIcsTestEmail_()`
 * 嘅確認對話框會讀出目前嘅 `DRY_RUN` 值，仍然係 `TRUE` 就直接擋、唔畀繼續。
 * 完整步驟見 `docs/ICS實測步驟.md`。
 */

/**
 * 用某個真實在職人員本季真實派工資料，組出同 OFFICIAL 階段一致嘅信件內容並
 * 真正寄出——但收件人電郵一律換成呼叫端提供嘅 `testEmail`，唔會用呢個人
 * 自己喺 `NameMapping` 登記嘅電郵。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personId 用嚟提供真實派工資料嘅人（必須本季有派工，
 *   否則 highlight／ICS 都冇實際內容可以驗證）
 * @param {string} testEmail 呢封信實際寄去嘅電郵地址
 * @returns {{displayName: string, personId: string, testEmail: string,
 *   subject: string, attachmentName: string}}
 */
function sendIcsTestEmail_(quarterId, versionNo, personId, testEmail) {
  assertNotPreviewMode_('sendIcsTestEmail_');
  if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== false) {
    throw new Error('Config 的 DRY_RUN 目前不是 FALSE，無法寄出測試信。\n\n'
      + '請先到 Config 工作表暫時將 DRY_RUN 改為 FALSE，測試完成、確認收到之後'
      + '記得改回 TRUE（除非你正準備正式發出，那就不用改回去）。');
  }
  const cleanEmail = String(testEmail || '').trim();
  if (!cleanEmail) throw new Error('未提供測試電郵地址。');

  const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
  const person = context.peopleById[personId];
  if (!person) throw new Error('找不到 PersonID=' + personId + '（或者這個人 Active 不是 TRUE）。');
  const personAssignments = context.assignmentsByPerson[personId] || [];
  if (personAssignments.length === 0) {
    throw new Error(person.nameTC + '（' + personId + '）在 ' + quarterId + ' v' + versionNo
      + ' 沒有任何派工，無法驗證 highlight／ICS 的實際內容，請換一位本季有派工的人。');
  }

  const templates = resolveStageTemplates_(MAIL_STAGES.OFFICIAL);
  const template = templates.person;
  if (!template) throw new Error('EmailTemplates 中找不到 TPL_OFFICIAL_TC（也沒有 OFFICIAL 可退回使用）。');

  // 收件人物件刻意將 email 換成測試地址——下游 generateMailAttachment_()／
  // buildIcsAttachmentForPerson_() 只會用 personId 去搵派工資料同產生附件，
  // 唔會用到 email 呢個欄位，換咗都唔影響附件內容係咪呢個人嘅真實資料。
  const recipient = {
    type: RECIPIENT_TYPE.PERSON,
    personId: personId,
    email: cleanEmail,
    displayName: person.nameTC,
    sendAs: SEND_AS.TO
  };

  // 附件產生邏輯同 deliverOne_() 完全一致：個人 PDF 產生失敗（例如未先執行
  // 「產生個人 PDF」）會直接 throw，令呢個測試中止並提示點做——刻意唔吞掉，
  // 因為呢個工具本來就係要模擬「呢個人真正會收到嘅信」，如果連正式發送都會
  // 冇 PDF，測試信都應該一致噉樣失敗，唔應該靜靜地跳過附件、令 Ivan 睇到
  // 一封「假裝正常」但實際上唔完整嘅測試信。ICS 附件則同 deliverOne_() 一樣
  // 用 try/catch 包住，失敗只警告、唔阻斷（ICS 係錦上添花的附加功能）。
  const attachment = generateMailAttachment_(template, context, recipient);
  let icsAttachment = null;
  try {
    icsAttachment = buildIcsAttachmentForPerson_(context, recipient, personAssignments);
  } catch (err) {
    log_('WARN', 'ICS 測試信：日曆檔產生失敗（不影響本次寄信，本封信不附 ICS）：' + err.message);
  }
  const attachmentName = [attachment, icsAttachment].filter(Boolean).map(decorateAttachmentName_).join('；');

  const summary = buildAssignmentSummary_(personAssignments, context.postNames, context.timezone);
  const testPrefix = '【測試郵件，內容為 ' + person.nameTC + ' 的真實資料，非正式發出】';
  const subject = testPrefix + context.subjectPrefix
    + applyPlaceholders_(template.subject, context.placeholders, recipient, summary);
  const bodyHtml = applyPlaceholders_(template.bodyHtml, context.placeholders, recipient, summary);
  const bodyPlain = applyPlaceholders_(template.bodyPlain, context.placeholders, recipient, summary);

  sendRealEmail_(recipient, subject, bodyHtml, bodyPlain, context, attachment, icsAttachment);

  writeAuditLog_({
    action: 'ICS／highlight 測試信',
    targetKey: quarterId + '-v' + versionNo + '-' + personId,
    newValue: '已寄出（測試地址不記錄在 AuditLog，避免留低個人聯絡方式）',
    source: 'sendIcsTestEmail_',
    notes: '純測試用途，刻意不寫入 SendLog，不會影響這個人之後正式 OFFICIAL／RESEND 的派送判斷'
      + '（附件：' + (attachmentName || '無') + '）'
  });

  return {
    displayName: person.nameTC, personId: personId, testEmail: cleanEmail,
    subject: subject, attachmentName: attachmentName
  };
}

/**
 * 選單項目「⚠️ 寄送單一 ICS／highlight 測試信」的執行入口。
 * @returns {void}
 */
function runSendIcsTestEmail_() {
  const ui = SpreadsheetApp.getUi();
  const title = '寄送單一 ICS／highlight 測試信';

  const dryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  if (dryRun) {
    ui.alert(title,
      '⚠️ Config 的 DRY_RUN 目前是 TRUE，這個工具無法運作（它必須真正寄出這一封信，'
        + '否則沒辦法在 iPhone 上實際打開驗證）。\n\n'
        + '請先到 Config 工作表，把 DRY_RUN 暫時改為 FALSE，再重新執行這個選單項目。\n\n'
        + '⚠️ 提醒：DRY_RUN=FALSE 期間，如果執行「步驟 4：正式發出」或'
        + '「測試工具 ▸ 寄送（測試模式）」，會真正寄信給全部義工，測試完這個工具之後'
        + '記得把 DRY_RUN 改回 TRUE（除非正準備正式發出）。',
      ui.ButtonSet.OK);
    return;
  }

  const target = promptQuarterAndVersion_(title);
  if (!target) return;

  const personResponse = ui.prompt(title,
    '請輸入用來提供真實派工資料的 PersonID（可在 NameMapping 查到，'
      + '建議挑一個本季有多次服侍、最好有需要提早到場的崗位的人，方便同時驗證多個事件與提早到場時間）：',
    ui.ButtonSet.OK_CANCEL);
  if (personResponse.getSelectedButton() !== ui.Button.OK) return;
  const personId = normalizeIdInput_(personResponse.getResponseText());
  if (!personId) {
    ui.alert(title, '未輸入 PersonID，已取消。', ui.ButtonSet.OK);
    return;
  }

  const emailResponse = ui.prompt(title,
    '請輸入這封測試信要寄去的電郵地址（建議填你自己的地址，方便用 iPhone 打開驗證；'
      + '這封信只會寄去這一個地址，不會寄給任何義工）：',
    ui.ButtonSet.OK_CANCEL);
  if (emailResponse.getSelectedButton() !== ui.Button.OK) return;
  const testEmail = emailResponse.getResponseText().trim();
  if (!testEmail || testEmail.indexOf('@') === -1) {
    ui.alert(title, '電郵地址看起來不正確，已取消。', ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(title,
    '⚠️ 這封信會真正寄出（不受 DRY_RUN 影響，因為你剛已經確認 DRY_RUN=FALSE）：\n\n'
      + '　季度：' + target.quarterId + '　版本：v' + target.versionNo + '\n'
      + '　資料來源：PersonID=' + personId + '（信件內容會是這個人本季真實的服侍安排）\n'
      + '　實際寄去：' + testEmail + '\n'
      + '　不會寄給任何義工。\n\n'
      + '確定要繼續嗎？',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    const result = sendIcsTestEmail_(target.quarterId, target.versionNo, personId, testEmail);
    ui.alert(title,
      '✅ 已寄出測試信。\n\n'
        + '　資料來源：' + result.displayName + '（' + result.personId + '）\n'
        + '　寄去：' + result.testEmail + '\n'
        + '　附件：' + (result.attachmentName || '（無）') + '\n\n'
        + '請到 ' + testEmail + ' 的信箱（建議用 iPhone Mail）查收，核對事件時間、'
        + '提早到場時間有沒有生效、時區顯示是否正確。完整核對清單見'
        + ' docs/ICS實測步驟.md。\n\n'
        + '這封信不會寫入 SendLog，也不會影響這個人之後正式的 OFFICIAL／RESEND 派送判斷。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSendIcsTestEmail_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
