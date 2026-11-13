/**
 * REVIEW／REMIND／OFFICIAL／RESEND 四個電郵範本的預設內容。
 *
 * 注意 Stage 用的是 MAIL_STAGES.REMIND（值為 "REMIND"），不是「REMINDER」：
 * sendStage_() 與 findEmailTemplate_() 全部以 MAIL_STAGES 的值比對 Stage 欄，
 * 若這裡寫成 "REMINDER" 會導致 REMIND 階段永遠找不到範本。
 *
 * 內容為書面語繁體中文、教會幹事對事奉人員通知的語氣，之後可直接在 EmailTemplates
 * 工作表修改文字，不需要改程式碼。
 *
 * 這份清單本身就是選單「補齊 Email 範本」（見 planEmailTemplateSeed_()／
 * seedEmailTemplates_()）唯一的資料來源，掃描邏輯完全不認 Stage 名稱、只認這個
 * 陣列裡有什麼、工作表已有什麼——所以日後四階段流程或其他功能再新增寄送階段時，
 * 只要把新的一項加進這裡，「補齊 Email 範本」自動就會認得，不需要另外建立新選單。
 * TPL_REVIEW_TC（四階段流程「步驟 2：寄給堂委審閱」用）就是照這個方式加進來的。
 */
/**
 * 第一百零一輪批次 ZB 組：〔邀請〕信「怎樣申報」一段——要和個人連結頁（PersonalRoster.html）**完全一致**：
 * 區塊名稱、按鈕名稱、確認後顯示的字。tests/round101_zb_email_templates.test.js 檢查每個「」〔〕名稱都在頁面出現
 * （狀態欄的字由 PersonalUnavailable.gs UNAVAILABLE_SUBMISSION_STATUS_TC 提供），日後改頁面會提醒要改這一段。
 */
const UNAVAILABLE_INVITE_HOW_TO_TEXT = '怎樣申報：打開連結，在「申報不能服侍的日子」按一下你不能服侍的主日（再按一下取消），'
  + '選擇「全部崗位」或「只限以下崗位」，可以填原因，然後按〔提交〕。'
  + '幹事或堂委確認之後，頁面下面「我已申報的日子」的狀態會顯示「已確認了你的申請」。'
  + '截止日之後仍然可以申報，但未必來得及安排。';

const EMAIL_TEMPLATE_SEEDS = [
  // ═════════════════════════════════════════════════════════════════════
  // 第一百零一輪批次 ZB 組：照 Ivan 逐項改（以試算表上原有的文字為底本）。
  //   ・主試算表的網址或 ID 在任何情況下都不可以出現在寄出的電郵：{SpreadsheetUrl} 全部刪除
  //   ・公開連結那一行一律寫「{QuarterID} 職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）：<連結>」；
  //     範本沒有寫 ⇒ 系統在信末加（Mailer.gs appendPermanentLinkFooter_()），每封信最多一次
  //   ・{ContactName}＝Config ROSTER_CONTACT_TC；{VersionLabel}＝例如 2028T3v1
  //   ・試算表上現有的行不會自動跟着改：幹事介面「進階與診斷」〔更新電郵範本到最新版〕（EmailTemplateUpdate.gs）
  // ═════════════════════════════════════════════════════════════════════
  {
    // 第一百零一輪批次 ZB 組：試算表上一直有這一行（測試工具「寄送（測試模式）」Stage=GENERATE 用），種子補回。
    templateId: 'TPL_GENERATE_TC',
    stage: MAIL_STAGES.GENERATE,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表（初稿，請覆核）',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，請按以下連結預覽。</p>'
      + '<p><strong>{QuarterID} 職事表預覽</strong>（只供查看，不能修改；內容更新後打開就是最新版）：'
      + '<a href="{PublicRosterUrl}">{PublicRosterUrl}</a></p>'
      + '<p>正式發出日期：{OfficialSendDate}</p>'
      + '<p>如需修改，請與{ContactName}聯絡，由幹事統一修改；任何人都不可以直接修改試算表。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，請按以下連結預覽。\n\n'
      + '{QuarterID} 職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）：{PublicRosterUrl}\n\n'
      + '正式發出日期：{OfficialSendDate}\n\n'
      + '如需修改，請與{ContactName}聯絡，由幹事統一修改；任何人都不可以直接修改試算表。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{OfficialSendDate},{PublicRosterUrl},{ContactName}',
    attachType: ATTACH_TYPE.FULL_PDF
  },
  {
    // ⚠️ 這個範本只有測試工具「寄送（測試模式）」指定 Stage=REMIND 才會用到；自動排程的「階段提醒」
    // 不經這個範本（Trigger.gs judgeRemindAction_() → Mailer.gs notifyAdminStageReminder_()）。
    templateId: 'TPL_REMIND_TC',
    stage: MAIL_STAGES.REMIND,
    lang: 'TC',
    subject: '提醒：{QuarterID} 職事表將於 {OfficialSendDate} 正式發出',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>{QuarterID} 職事表將於 {OfficialSendDate} 正式發給各位事奉人員。如需修改，請於該日之前與{ContactName}聯絡。</p>'
      + '<p><strong>{QuarterID} 職事表預覽</strong>（只供查看，不能修改；內容更新後打開就是最新版）：'
      + '<a href="{PublicRosterUrl}">{PublicRosterUrl}</a></p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '{QuarterID} 職事表將於 {OfficialSendDate} 正式發給各位事奉人員。如需修改，請於該日之前與{ContactName}聯絡。\n\n'
      + '{QuarterID} 職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）：{PublicRosterUrl}',
    placeholders: '{QuarterID},{OfficialSendDate},{PublicRosterUrl},{ContactName}',
    attachType: ATTACH_TYPE.NONE
  },
  {
    templateId: 'TPL_OFFICIAL_TC',
    stage: MAIL_STAGES.OFFICIAL,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂主日職事表（定稿）',
    // 個人專屬連結、職事表預覽兩行由系統在信末加（PersonalLinkInMail.gs、Mailer.gs）。
    bodyHtml: '<p>親愛的 {PersonName}：</p>'
      + '<p>{QuarterID} 的主日職事表已定稿，你的服侍安排如下：</p>'
      + '<p>{AssignmentSummary}</p>'
      + '<p>附件是完整職事表，你的名字已加了標示。如未能出席，或有任何疑問，請與{ContactName}聯絡。</p>',
    bodyPlain: '親愛的 {PersonName}：\n\n'
      + '{QuarterID} 的主日職事表已定稿，你的服侍安排如下：\n\n'
      + '{AssignmentSummary}\n\n'
      + '附件是完整職事表，你的名字已加了標示。如未能出席，或有任何疑問，請與{ContactName}聯絡。',
    placeholders: '{PersonName},{QuarterID},{AssignmentSummary},{ContactName}',
    attachType: ATTACH_TYPE.PERSONAL_PDF
  },
  {
    templateId: 'TPL_RESEND_TC',
    stage: MAIL_STAGES.RESEND,
    lang: 'TC',
    subject: '更新：{QuarterID} 粵語堂主日職事表',
    bodyHtml: '<p>親愛的 {PersonName}：</p>'
      + '<p>{QuarterID} 職事表有更新，你的服侍安排如下：</p>'
      + '<p>{AssignmentSummary}</p>'
      + '<p>請以此電郵為準。</p>',
    bodyPlain: '親愛的 {PersonName}：\n\n'
      + '{QuarterID} 職事表有更新，你的服侍安排如下：\n\n'
      + '{AssignmentSummary}\n\n'
      + '請以此電郵為準。',
    placeholders: '{PersonName},{QuarterID},{AssignmentSummary}',
    attachType: ATTACH_TYPE.PERSONAL_PDF
  },
  {
    templateId: 'TPL_REVIEW_TC',
    stage: MAIL_STAGES.REVIEW,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表初稿——請於 {OfficialSendDate} 正式發出前覆核',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，敬請協助覆核。</p>'
      + '<p>完整版職事表已附於本郵件，方便離線查看。</p>'
      + '<p>本表計劃於 {OfficialSendDate} 正式發給各位事奉人員，敬請於該日之前回覆意見。</p>'
      + '<p>如需要修改（例如有人不能服侍、或需要指定某人服侍），請直接回覆本郵件說明，由幹事統一處理。</p>'
      + '<p>現階段各位事奉人員尚未收到任何通知，本次只在堂委及幹事之間傳閱。</p>'
      + '<p>如有查詢，請直接回覆本郵件。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表初稿已生成，敬請協助覆核。\n\n'
      + '完整版職事表已附於本郵件，方便離線查看。\n\n'
      + '本表計劃於 {OfficialSendDate} 正式發給各位事奉人員，敬請於該日之前回覆意見。\n\n'
      + '如需要修改（例如有人不能服侍、或需要指定某人服侍），請直接回覆本郵件說明，由幹事統一處理。\n\n'
      + '現階段各位事奉人員尚未收到任何通知，本次只在堂委及幹事之間傳閱。\n\n'
      + '如有查詢，請直接回覆本郵件。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{OfficialSendDate}',
    attachType: ATTACH_TYPE.FULL_PDF
  },
  {
    // 步驟 5「改動後重發」用的 LIST 摘要範本：跟 TPL_RESEND_TC 同一個 Stage=RESEND，
    // 但收件人是 EmailRecipients（LIST，例如堂委／幹事）——寄送時由 ResendFlow.gs 的
    // sendResendStage_() 用 findEmailTemplateById_() 直接指定。
    templateId: 'TPL_RESEND_LIST_TC',
    stage: MAIL_STAGES.RESEND,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表已改動重發（{VersionLabel}）——本輪異動摘要',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動已重新發出（版本 {VersionLabel}），'
      + '本輪有異動的人員及其最新安排如下：</p>'
      + '<p>{ChangedPeopleSummary}</p>'
      + '<p>完整版職事表已作為附件。如有查詢，請直接回覆本郵件。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '{QuarterID}（{StartDate} 至 {EndDate}）的職事表因人手調動已重新發出（版本 {VersionLabel}），'
      + '本輪有異動的人員及其最新安排如下：\n\n'
      + '{ChangedPeopleSummary}\n\n'
      + '完整版職事表已作為附件。如有查詢，請直接回覆本郵件。',
    placeholders: '{QuarterID},{StartDate},{EndDate},{VersionLabel},{ChangedPeopleSummary}',
    attachType: ATTACH_TYPE.FULL_PDF
  },
  {
    // 步驟 4「正式發出」的 LIST 收件人（堂委、教會辦公室等）用的範本，附完整版 PDF。
    templateId: 'TPL_OFFICIAL_LIST_TC',
    stage: MAIL_STAGES.OFFICIAL,
    lang: 'TC',
    subject: '{QuarterID} 粵語堂職事表已正式發出——完整版隨郵附上',
    bodyHtml: '<p>各位堂委、幹事：</p>'
      + '<p>平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表已經定稿，'
      + '並已於今日分別發送給本季各位有服侍的事奉人員，每位收到的是自己那一份個人職事表。</p>'
      + '<p>完整版職事表已作為附件，方便各位存檔及查閱。</p>'
      + '<p>如發現任何需要調動的地方，請直接回覆本郵件通知幹事，由幹事統一處理後再重新發出。</p>',
    bodyPlain: '各位堂委、幹事：\n\n'
      + '平安！{QuarterID}（{StartDate} 至 {EndDate}）的職事表已經定稿，'
      + '並已於今日分別發送給本季各位有服侍的事奉人員，每位收到的是自己那一份個人職事表。\n\n'
      + '完整版職事表已作為附件，方便各位存檔及查閱。\n\n'
      + '如發現任何需要調動的地方，請直接回覆本郵件通知幹事，由幹事統一處理後再重新發出。',
    placeholders: '{QuarterID},{StartDate},{EndDate}',
    attachType: ATTACH_TYPE.FULL_PDF
  },
  // 第八十五輪批次 LF 組：季前資料（PreseasonPack.gs；不經 sendStage_()，Stage 欄只作標記）
  {
    templateId: 'TPL_PRESEASON_TC',
    stage: 'PRESEASON',
    lang: 'TC',
    // 第一百零五輪批次 RB 組：即「請確認事奉人員表」（時間表 G−21）——主旨及第一段寫明確認期限、申報連結寄出日
    subject: '{QuarterLabel} 職事表：請在 {ListConfirmBy} 之前確認事奉人員表，申報連結將於 {InviteDate} 寄給事奉人員',
    bodyHtml: '<p>各位堂委、執事、幹事：</p>'
      + '<p>平安！請在 {ListConfirmBy} 之前確認以下的事奉人員表及排表資料。申報不能服侍日子的連結將於 {InviteDate} 寄給事奉人員，'
      + '{QuarterLabel}的職事表將於 {GenerateDate} 生成。</p>'
      + '{PreseasonContentHtml}'
      + '<p>如需更改，請在 {ListConfirmBy} 之前通知{ContactName}。</p>',
    bodyPlain: '各位堂委、執事、幹事：\n\n'
      + '平安！請在 {ListConfirmBy} 之前確認以下的事奉人員表及排表資料。申報不能服侍日子的連結將於 {InviteDate} 寄給事奉人員，'
      + '{QuarterLabel}的職事表將於 {GenerateDate} 生成。\n\n'
      + '{PreseasonContentPlain}\n\n'
      + '如需更改，請在 {ListConfirmBy} 之前通知{ContactName}。',
    placeholders: '{QuarterLabel},{GenerateDate},{ListConfirmBy},{InviteDate},{ContactName},{PreseasonContentHtml},{PreseasonContentPlain}',
    attachType: ATTACH_TYPE.NONE
  },
  // 第九十輪批次 QC 組：〔邀請事奉人員申報不能服侍的日子〕（UnavailableInvite.gs；不經 sendStage_()，Stage 欄只作標記）
  {
    templateId: 'TPL_UNAVAILABLE_INVITE_TC',
    stage: 'UNAVAILABLE_INVITE',
    lang: 'TC',
    subject: '{QuarterLabel} 職事表：請在 {Deadline} 之前申報不能服侍的主日',
    // 第一百零五輪批次 RB 組：寫明兩星期內（截止日之前）完成；沒有不能服侍的日子亦請按頁面上的按鈕
    bodyHtml: '<p>{PersonName}：</p>'
      + '<p>平安！{QuarterLabel}的職事表將於 {GenerateDate} 生成。如果你在這一季有不能服侍的主日，'
      + '請在兩星期內（{Deadline} 之前）用你的個人專屬連結申報：</p>'
      + '<p><a href="{PersonalLink}">{PersonalLink}</a></p>'
      + '<p>' + UNAVAILABLE_INVITE_HOW_TO_TEXT + '</p>'
      + '<p>如果這一季沒有不能服侍的日子，請在同一頁按〔我這一季沒有不能服侍的日子〕，讓我們知道你已經回覆。</p>'
      + '<p>這條連結只供你本人使用，請不要轉發。</p>',
    bodyPlain: '{PersonName}：\n\n'
      + '平安！{QuarterLabel}的職事表將於 {GenerateDate} 生成。如果你在這一季有不能服侍的主日，'
      + '請在兩星期內（{Deadline} 之前）用你的個人專屬連結申報：\n\n'
      + '{PersonalLink}\n\n'
      + UNAVAILABLE_INVITE_HOW_TO_TEXT + '\n\n'
      + '如果這一季沒有不能服侍的日子，請在同一頁按〔我這一季沒有不能服侍的日子〕，讓我們知道你已經回覆。\n\n'
      + '這條連結只供你本人使用，請不要轉發。',
    placeholders: '{QuarterLabel},{GenerateDate},{Deadline},{PersonalLink}',
    attachType: ATTACH_TYPE.NONE
  },
  // 第一百零五輪批次 RB 組：截止日前提醒（G−3；只寄給收到邀請而未有任何回覆的人；UnavailableSchedule.gs）
  {
    templateId: 'TPL_UNAVAILABLE_REMIND_TC',
    stage: 'UNAVAILABLE_REMIND',
    lang: 'TC',
    subject: '{QuarterLabel} 職事表：提醒——請在 {Deadline} 之前申報不能服侍的主日',
    bodyHtml: '<p>{PersonName}：</p>'
      + '<p>平安！提醒你：{QuarterLabel}（{QuarterID}）不能服侍的主日，請在 {Deadline} 之前用你的個人專屬連結申報。'
      + '我們還未收到你的回覆。</p>'
      + '<p><a href="{PersonalLink}">{PersonalLink}</a></p>'
      + '<p>如果這一季沒有不能服侍的日子，請在同一頁按〔我這一季沒有不能服侍的日子〕。如有查詢，請聯絡{ContactName}。</p>'
      + '<p>這條連結只供你本人使用，請不要轉發。</p>',
    bodyPlain: '{PersonName}：\n\n'
      + '平安！提醒你：{QuarterLabel}（{QuarterID}）不能服侍的主日，請在 {Deadline} 之前用你的個人專屬連結申報。'
      + '我們還未收到你的回覆。\n\n'
      + '{PersonalLink}\n\n'
      + '如果這一季沒有不能服侍的日子，請在同一頁按〔我這一季沒有不能服侍的日子〕。如有查詢，請聯絡{ContactName}。\n\n'
      + '這條連結只供你本人使用，請不要轉發。',
    placeholders: '{QuarterLabel},{QuarterID},{Deadline},{PersonalLink},{ContactName}',
    attachType: ATTACH_TYPE.NONE
  },
  // 第一百零五輪批次 RB 組：申報期已完結（G；幹事＋堂委；UnavailableSchedule.gs）
  {
    templateId: 'TPL_UNAVAILABLE_WINDOW_CLOSED_TC',
    stage: 'UNAVAILABLE_WINDOW_CLOSED',
    lang: 'TC',
    subject: '{QuarterLabel} 申報期已完結：共 {PendingCount} 份申報待確認',
    bodyHtml: '<p>各位幹事、堂委：</p>'
      + '<p>平安！{QuarterLabel}（{QuarterID}）申報不能服侍日子的期限（{Deadline}）已經完結，共 {PendingCount} 份申報待確認。</p>'
      + '<p>請確認申報，然後生成職事表：<br>{ConfirmUrl}</p>'
      + '<p>如有查詢，請聯絡{ContactName}。</p>',
    bodyPlain: '各位幹事、堂委：\n\n'
      + '平安！{QuarterLabel}（{QuarterID}）申報不能服侍日子的期限（{Deadline}）已經完結，共 {PendingCount} 份申報待確認。\n\n'
      + '請確認申報，然後生成職事表：\n{ConfirmUrl}\n\n'
      + '如有查詢，請聯絡{ContactName}。',
    placeholders: '{QuarterLabel},{QuarterID},{Deadline},{PendingCount},{ConfirmUrl},{ContactName}',
    attachType: ATTACH_TYPE.NONE
  },
  // 第九十四輪批次 UC 組：通知申請人處理結果（PersonalUnavailable.gs notifyUnavailableDecisions_；不經 sendStage_()，Stage 欄只作標記）。
  // {DecisionHtml}／{DecisionPlain} 由程式按「確認」「不確認」組出（buildUnavailableDecisionPlaceholders_）。
  {
    templateId: 'TPL_UNAVAILABLE_DECIDED_TC',
    stage: 'UNAVAILABLE_DECIDED',
    lang: 'TC',
    subject: '{QuarterLabel} 不能服侍的申報：處理結果',
    bodyHtml: '<p>{PersonName}：平安！</p>{DecisionHtml}<p>這封信由職事表系統發出。</p>',
    bodyPlain: '{PersonName}：平安！\n\n{DecisionPlain}\n\n這封信由職事表系統發出。',
    placeholders: '{QuarterLabel},{DecisionHtml},{DecisionPlain}',
    attachType: ATTACH_TYPE.NONE
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
  readSheet_(SHEETS.EMAIL_TEMPLATES).forEach(function (row) {
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
