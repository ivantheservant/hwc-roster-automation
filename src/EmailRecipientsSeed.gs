/**
 * 「補建 EmailRecipients 欄位」：新增 Role 欄，決定收件人是否為四階段流程
 * 「步驟 2：寄給堂委審閱」的審閱者（見 Mailer.gs 的 listRecipients_() REVIEW 分支）。
 * 值只有 REVIEWER／ALL 兩種；欄不存在時新增在最後一欄之後，現有列 Role 空白者，
 * SendAs=CC 的預設為 REVIEWER，其餘預設 ALL（只填補空白，已有值的列不動）。
 *
 * ---- 兩個值的實際意思（階段 D：Ivan 已決定教會辦公室要收步驟 2 的審閱信，
 * 由 Ivan 自己把該行的 Role 由 ALL 改為 REVIEWER，程式碼不碰試算表資料）----
 * - REVIEWER：會收到「步驟 2：寄給堂委審閱」的審閱信；其餘寄送階段（GENERATE／
 *   REMIND／OFFICIAL／RESEND）仍然完全依 Stage 欄決定收不收，Role 不影響那幾個階段。
 * - ALL：**不會**收到「步驟 2」的審閱信，只依 Stage 欄決定收不收其他階段的信。
 *   ⚠️ 這個名稱容易讓人誤會成「所有階段都收」，實際意思剛好相反——是「非審閱者」，
 *   跟字面「ALL」的直覺完全不符，見 HANDOFF.md「待 Ivan 覆核的決策」是否要改名。
 */

/**
 * 檢查 EmailRecipients 是否已有 Role 欄，算出要新增的欄與要補的預設值。只讀，不寫入。
 * @returns {{columnExists: boolean, columnIndex: number, rows: Object[]}}
 *   rows 每項為 {sheetRow, displayName, sendAs, value}
 */
function planEmailRecipientsRoleSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EMAIL_RECIPIENTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.EMAIL_RECIPIENTS);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.EMAIL_RECIPIENTS.ROLE);
  const columnExists = existingIndex !== -1;
  const columnIndex = columnExists ? existingIndex + 1 : lastCol + 1;

  const plan = { columnExists: columnExists, columnIndex: columnIndex, rows: [] };
  const dataRowCount = lastRow - 2;
  if (dataRowCount <= 0) return plan;

  const sendAsCol = headers.indexOf(COLUMNS.EMAIL_RECIPIENTS.SEND_AS) + 1;
  const displayNameCol = headers.indexOf(COLUMNS.EMAIL_RECIPIENTS.DISPLAY_NAME) + 1;
  const sendAsValues = sheet.getRange(3, sendAsCol, dataRowCount, 1).getValues();
  const displayNames = sheet.getRange(3, displayNameCol, dataRowCount, 1).getValues();
  const existingRoleValues = columnExists
    ? sheet.getRange(3, columnIndex, dataRowCount, 1).getValues()
    : sendAsValues.map(function () { return ['']; });

  for (let i = 0; i < dataRowCount; i++) {
    const currentRole = String(existingRoleValues[i][0] || '').trim();
    if (currentRole !== '') continue; // 已有值，略過（只填補空白）
    const sendAs = String(sendAsValues[i][0] || '').trim().toUpperCase();
    const value = sendAs === SEND_AS.CC ? RECIPIENT_ROLE.REVIEWER : RECIPIENT_ROLE.ALL;
    plan.rows.push({ sheetRow: i + 3, displayName: displayNames[i][0], sendAs: sendAs, value: value });
  }
  return plan;
}

/**
 * 依 planEmailRecipientsRoleSeed_() 的計畫寫入 EmailRecipients：欄不存在就新增在
 * 最後一欄之後（第 1 行中文標題「角色」、第 2 行機器鍵 Role），然後只填補空白的列。
 * @param {Object} plan planEmailRecipientsRoleSeed_() 的結果
 * @returns {number} 實際填入的列數
 */
function seedEmailRecipientsRole_(plan) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EMAIL_RECIPIENTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.EMAIL_RECIPIENTS);

  if (!plan.columnExists) {
    sheet.getRange(1, plan.columnIndex).setValue('角色');
    sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.EMAIL_RECIPIENTS.ROLE);
  }
  plan.rows.forEach(function (r) {
    sheet.getRange(r.sheetRow, plan.columnIndex).setValue(r.value);
  });
  return plan.rows.length;
}

/**
 * 階段 D4 新增：「這一行 EmailRecipients 算不算這一次審閱信的收件人」的單一判斷條件，
 * 供 `countReviewerRecipients_()`（這裡）與 Mailer.gs 的 `listRecipients_()` REVIEW
 * 分支共用——原本兩處各自重複實作同一條件（Active=TRUE 且 Role=REVIEWER），
 * 是同一份規則寫在兩個地方，容易改一邊漏一邊（見 B1 測試 `mailer_recipients.test.js`
 * 專門驗證兩邊結果一致）。合併風險低：兩處原本的邏輯逐字比對完全相同，這裡只是
 * 把它抽成一個函式，不改變任何一邊的行為。
 * @param {Object} row readSheet(SHEETS.EMAIL_RECIPIENTS) 的一列
 * @returns {boolean} true＝這一行是這次審閱信的收件人
 */
function isReviewerRecipientRow_(row) {
  return isTrueValue_(row[COLUMNS.EMAIL_RECIPIENTS.ACTIVE])
    && String(row[COLUMNS.EMAIL_RECIPIENTS.ROLE] || '').trim().toUpperCase() === RECIPIENT_ROLE.REVIEWER;
}

/**
 * 統計目前 Role=REVIEWER 且 Active=TRUE 的收件人數，供「步驟 2：寄給堂委審閱」的
 * 確認對話框顯示。
 * @returns {number} 審閱者人數
 */
function countReviewerRecipients_() {
  return readSheet(SHEETS.EMAIL_RECIPIENTS).filter(isReviewerRecipientRow_).length;
}
