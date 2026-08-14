/**
 * REVIEW／REMIND／OFFICIAL／RESEND 四個電郵範本的預設內容。
 *
 * 注意 Stage 用的是 MAIL_STAGES.REMIND（值為 "REMIND"），不是「REMINDER」：
 * sendStage() 與 findEmailTemplate_() 全部以 MAIL_STAGES 的值比對 Stage 欄，
 * 若這裡寫成 "REMINDER" 會導致 REMIND 階段永遠找不到範本。
 *
 * 內容為書面語繁體中文、教會幹事對義工通知的語氣，之後可直接在 EmailTemplates
 * 工作表修改文字，不需要改程式碼。
 *
 * 這份清單本身就是選單「補齊 Email 範本」（見 planEmailTemplateSeed_()／
 * seedEmailTemplates_()）唯一的資料來源，掃描邏輯完全不認 Stage 名稱、只認這個
 * 陣列裡有什麼、工作表已有什麼——所以日後四階段流程或其他功能再新增寄送階段時，
 * 只要把新的一項加進這裡，「補齊 Email 範本」自動就會認得，不需要另外建立新選單。
 * TPL_REVIEW_TC（四階段流程「步驟 2：寄給堂委審閱」用）就是照這個方式加進來的。
 */
const EMAIL_TEMPLATE_SEEDS = [
  {
    templateId: 'TPL_REVIEW_TC',
    stage: MAIL_STAGES.REVIEW,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表初稿——請於 {OfficialSendDate} 正式發出前覆核',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，敬請協助覆核。</p>'
      + '<p>試算表連結：{SpreadsheetUrl}</p>'
      + '<p>完整版職事表已附於本郵件，方便離線查看。</p>'
      + '<p>本表計劃於 {OfficialSendDate} 正式發給各位義工，敬請於該日之前回覆意見。</p>'
      + '<p>如需要修改（例如有人不能服侍、或需要指定某人服侍），請直接回覆本郵件說明，'
      + '由幹事統一處理，請勿直接修改試算表上的儲存格，以便追蹤所有改動。</p>'
      + '<p>現階段各位義工尚未收到任何通知，本次只在堂委及幹事之間傳閱。</p>'
      + '<p>如有查詢，請直接回覆本郵件。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，敬請協助覆核。\n\n'
      + '試算表連結：{SpreadsheetUrl}\n\n'
      + '完整版職事表已附於本郵件，方便離線查看。\n\n'
      + '本表計劃於 {OfficialSendDate} 正式發給各位義工，敬請於該日之前回覆意見。\n\n'
      + '如需要修改（例如有人不能服侍、或需要指定某人服侍），請直接回覆本郵件說明，'
      + '由幹事統一處理，請勿直接修改試算表上的儲存格，以便追蹤所有改動。\n\n'
      + '現階段各位義工尚未收到任何通知，本次只在堂委及幹事之間傳閱。\n\n'
      + '如有查詢，請直接回覆本郵件。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{OfficialSendDate},{SpreadsheetUrl}',
    attachType: ATTACH_TYPE.FULL_PDF
  },
  {
    templateId: 'TPL_REMIND_TC',
    stage: MAIL_STAGES.REMIND,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表提醒——請於 {OfficialSendDate} 前覆核',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已上載，現提醒各位：</p>'
      + '<p>職事表將於 {OfficialSendDate} 正式發送給各服侍人員，請在此之前完成覆核及所需的人手調動。</p>'
      + '<p>試算表連結：{SpreadsheetUrl}</p>'
      + '<p>如有查詢，請直接回覆本郵件。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已上載，現提醒各位：\n'
      + '職事表將於 {OfficialSendDate} 正式發送給各服侍人員，請在此之前完成覆核及所需的人手調動。\n\n'
      + '試算表連結：{SpreadsheetUrl}\n\n'
      + '如有查詢，請直接回覆本郵件。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{OfficialSendDate},{SpreadsheetUrl}',
    attachType: ATTACH_TYPE.NONE
  },
  {
    templateId: 'TPL_OFFICIAL_TC',
    stage: MAIL_STAGES.OFFICIAL,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表——敬請留意閣下的服侍安排',
    bodyHtml: '<p>{PersonName} 弟兄／姊妹：</p>'
      + '<p>平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表已經確定，閣下本季的服侍安排如下：</p>'
      + '<p>{AssignmentSummary}</p>'
      + '<p>個人版職事表已作為附件，敬請查收並預留時間。如因特殊情況未能出席，請盡早聯絡幹事安排調動。</p>'
      + '<p>多謝配搭服侍！</p>',
    bodyPlain: '{PersonName} 弟兄／姊妹：\n\n'
      + '平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表已經確定，閣下本季的服侍安排如下：\n\n'
      + '{AssignmentSummary}\n\n'
      + '個人版職事表已作為附件，敬請查收並預留時間。如因特殊情況未能出席，請盡早聯絡幹事安排調動。\n\n'
      + '多謝配搭服侍！',
    placeholders: '{PersonName},{QuarterID},{StartDate},{EndDate},{AssignmentSummary},{SpreadsheetUrl}',
    attachType: ATTACH_TYPE.PERSONAL_PDF
  },
  {
    templateId: 'TPL_RESEND_TC',
    stage: MAIL_STAGES.RESEND,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表更新——敬請留意最新安排',
    bodyHtml: '<p>{PersonName} 弟兄／姊妹：</p>'
      + '<p>平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動有所更新，'
      + '閣下本季最新的服侍安排如下：</p>'
      + '<p>{AssignmentSummary}</p>'
      + '<p>最新版個人職事表已作為附件，敬請以此為準。如有疑問，請直接回覆本郵件或聯絡幹事。</p>'
      + '<p>多謝配搭服侍！</p>',
    bodyPlain: '{PersonName} 弟兄／姊妹：\n\n'
      + '平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動有所更新，閣下本季最新的服侍安排如下：\n\n'
      + '{AssignmentSummary}\n\n'
      + '最新版個人職事表已作為附件，敬請以此為準。如有疑問，請直接回覆本郵件或聯絡幹事。\n\n'
      + '多謝配搭服侍！',
    placeholders: '{PersonName},{QuarterID},{StartDate},{EndDate},{AssignmentSummary},{SpreadsheetUrl}',
    attachType: ATTACH_TYPE.PERSONAL_PDF
  },
  {
    // 步驟 5「改動後重發」用的 LIST 摘要範本：跟 TPL_RESEND_TC 同一個 Stage=RESEND，
    // 但收件人是 EmailRecipients（LIST，例如堂委／幹事），不是逐一義工——寄送時由
    // ResendFlow.gs 的 sendResendStage_() 用 findEmailTemplateById_() 直接指定要
    // 用哪一個範本，不經過 Stage 判斷，見 Mailer.gs 的 findEmailTemplate_() 檔頭註解。
    templateId: 'TPL_RESEND_LIST_TC',
    stage: MAIL_STAGES.RESEND,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表已改動重發——本輪異動摘要',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動已重新發出，'
      + '本輪有異動的人員及其最新安排如下：</p>'
      + '<p>{ChangedPeopleSummary}</p>'
      + '<p>完整版職事表已作為附件。如有查詢，請直接回覆本郵件。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動已重新發出，'
      + '本輪有異動的人員及其最新安排如下：\n\n'
      + '{ChangedPeopleSummary}\n\n'
      + '完整版職事表已作為附件。如有查詢，請直接回覆本郵件。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{ChangedPeopleSummary},{SpreadsheetUrl}',
    attachType: ATTACH_TYPE.FULL_PDF
  }
];

/**
 * 檢查 EmailTemplates 目前缺少哪些範本（只讀，不寫入）。
 *
 * 依 TemplateID 判斷「是否已存在」，不是依 Stage——步驟 5「改動後重發」之後，
 * Stage=RESEND 底下有兩個範本（TPL_RESEND_TC／TPL_RESEND_LIST_TC），如果沿用
 * 舊版「這個 Stage 有沒有任何範本」的判斷法，只要 TPL_RESEND_TC 已存在，
 * 就會永遠判定 Stage=RESEND「已經有範本」，導致 TPL_RESEND_LIST_TC 永遠不會被
 * 這個工具提供新增，即使 EMAIL_TEMPLATE_SEEDS 陣列裡明明已經有這一項。
 * @returns {{missing: Object[]}} 缺少的範本清單（EMAIL_TEMPLATE_SEEDS 的子集）
 */
function planEmailTemplateSeed_() {
  const existingTemplateIds = {};
  readSheet(SHEETS.EMAIL_TEMPLATES).forEach(function (row) {
    const id = String(row[COLUMNS.EMAIL_TEMPLATES.TEMPLATE_ID] || '').trim();
    if (id) existingTemplateIds[id] = true;
  });
  return {
    missing: EMAIL_TEMPLATE_SEEDS.filter(function (t) { return !existingTemplateIds[t.templateId]; })
  };
}

/**
 * 把缺少的範本寫入 EmailTemplates（附加在現有資料之後）。
 * 只新增，不覆寫既有範本；呼叫前應先用 planEmailTemplateSeed_() 確認清單。
 * @param {Object[]} missing 要新增的範本清單
 * @returns {number} 實際寫入的行數
 */
function seedEmailTemplates_(missing) {
  if (missing.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EMAIL_TEMPLATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.EMAIL_TEMPLATES);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.EMAIL_TEMPLATES;
  const now = nowTimestamp_();

  const rows = missing.map(function (t) {
    const record = {};
    record[C.TEMPLATE_ID] = t.templateId;
    record[C.STAGE] = t.stage;
    record[C.LANG] = t.lang;
    record[C.SUBJECT] = t.subject;
    record[C.BODY_HTML] = t.bodyHtml;
    record[C.BODY_PLAIN] = t.bodyPlain;
    record[C.PLACEHOLDERS] = t.placeholders;
    record[C.ATTACH_TYPE] = t.attachType;
    record[C.ACTIVE] = 'TRUE';
    record[C.UPDATED_AT] = now;
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, rows.length, headers.length).setValues(rows);
  applyTimestampFormat_(sheet, headers, [C.UPDATED_AT], targetRow, rows.length);
  return rows.length;
}
