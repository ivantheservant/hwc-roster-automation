/**
 * 「補建 Posts 欄位」：Posts 工作表補上 EmptyDisplay 欄（決定「崗位存在但留空」的
 * 格子要顯示 PENDING／NA／BLANK 中的哪一種，見 Constants.gs 的 POST_EMPTY_DISPLAY
 * 與 RosterWriter.gs 的 resolveEmptyDisplayText_()）。
 *
 * 手法與 ConfigSeed.gs 的「補建 Config 參數」一致：只 append，絕不覆寫既有內容。
 * 這裡多一層考量——這是**欄**不是**列**，所以規則是：
 * - 欄本身不存在時，只能加在最後一欄之後，不可插入到中間
 * - 欄已存在時，只填補目前是空白的格，已經有值的格完全不動
 */

/**
 * 三個特定崗位的預設值（依你的明確指示）；其餘全部崗位（含聖餐襄禮）預設 PENDING。
 * 用 PostName_TC 精確比對——如果你的 Posts 工作表用字跟這裡不完全一樣（例如簡繁或
 * 有無空格），該崗位會落到「其餘全部崗位」那條規則變成 PENDING，
 * 執行前的確認視窗會列出每個崗位實際算出來的值，可以在下指令前先核對一次。
 * @returns {Object.<string, string>} {PostName_TC: EmptyDisplay 預設值}
 */
function getPostEmptyDisplayOverrides_() {
  return {
    '講員': POST_EMPTY_DISPLAY.PENDING,
    '翻譯': POST_EMPTY_DISPLAY.BLANK,
    '獻花': POST_EMPTY_DISPLAY.BLANK
  };
}

/**
 * 檢查 Posts 工作表的 EmptyDisplay 欄現況，算出要新增／填補的內容（只讀，不寫入）。
 * @returns {{columnExists: boolean, columnIndex: number, rows: Object[]}}
 *   columnIndex 為 1-based 欄號（欄不存在時＝目前最後一欄+1）；
 *   rows 為要填的格，每項 {sheetRow, postId, postName, value}
 */
function planPostEmptyDisplaySeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.POSTS.EMPTY_DISPLAY);
  const columnExists = existingIndex !== -1;
  const columnIndex = columnExists ? existingIndex + 1 : lastCol + 1;

  const plan = { columnExists: columnExists, columnIndex: columnIndex, rows: [] };
  const dataRowCount = lastRow - 2;
  if (dataRowCount <= 0) return plan;

  const postIdCol = headers.indexOf(COLUMNS.POSTS.POST_ID) + 1;
  const postNameCol = headers.indexOf(COLUMNS.POSTS.POST_NAME_TC) + 1;
  const ids = sheet.getRange(3, postIdCol, dataRowCount, 1).getValues();
  const names = sheet.getRange(3, postNameCol, dataRowCount, 1).getValues();
  const existingValues = columnExists
    ? sheet.getRange(3, columnIndex, dataRowCount, 1).getValues()
    : names.map(function () { return ['']; });

  const overrides = getPostEmptyDisplayOverrides_();

  for (let i = 0; i < dataRowCount; i++) {
    const currentValue = String(existingValues[i][0] || '').trim();
    if (currentValue !== '') continue; // 已有值，略過（只填補空格，不覆蓋）

    const postName = String(names[i][0] || '').trim();
    const value = overrides[postName] || POST_EMPTY_DISPLAY.PENDING;
    plan.rows.push({ sheetRow: i + 3, postId: ids[i][0], postName: postName, value: value });
  }
  return plan;
}

/**
 * 依 planPostEmptyDisplaySeed_() 的計畫寫入 Posts 工作表：
 * 欄不存在就先在最後一欄之後新增（第 2 行寫機器鍵 'EmptyDisplay'，
 * 第 1 行寫一個中文標題方便你在工作表上辨識），然後只填補目前空白的格。
 * 完全不會動到欄不存在以外的任何既有內容。
 * @param {Object} plan planPostEmptyDisplaySeed_() 的結果
 * @returns {number} 實際寫入的格數
 */
function seedPostEmptyDisplay_(plan) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  if (!plan.columnExists) {
    sheet.getRange(1, plan.columnIndex).setValue('留空顯示方式');
    sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.POSTS.EMPTY_DISPLAY);
  }

  plan.rows.forEach(function (r) {
    sheet.getRange(r.sheetRow, plan.columnIndex).setValue(r.value);
  });

  return plan.rows.length;
}
