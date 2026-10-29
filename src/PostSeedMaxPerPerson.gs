/**
 * 第八十五輪批次 LD 組：檢查 Posts 工作表有沒有 `MaxPerPersonPerQuarter` 欄（只讀）。
 * @returns {{columnExists: boolean, columnIndex: number, postCount: number}}
 */
function planPostMaxPerPersonSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER);
  return {
    columnExists: existingIndex !== -1,
    columnIndex: existingIndex !== -1 ? existingIndex + 1 : lastCol + 1,
    postCount: Math.max(0, lastRow - 2)
  };
}

/**
 * 依計畫補建 `MaxPerPersonPerQuarter` 欄（只加欄，不填值；留空＝不限）。
 * @param {Object} plan planPostMaxPerPersonSeed_() 的結果
 * @returns {boolean} 是否真的新增了欄位
 */
function seedPostMaxPerPerson_(plan) {
  if (plan.columnExists) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
  sheet.getRange(1, plan.columnIndex).setValue('每人每季最多幾次（留空＝不限）');
  sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER);
  return true;
}

/**
 * 選單「維護 ▸ 補建 Posts 欄位（每人每季最多幾次）」。
 * @returns {void}
 */
function runSeedPostMaxPerPerson_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 Posts 欄位（每人每季最多幾次）';
  try {
    const plan = planPostMaxPerPersonSeed_();
    if (plan.columnExists) {
      ui.alert(title, 'Posts 工作表已經有 ' + COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER + ' 欄（第 '
        + plan.columnIndex + ' 欄），沒有做任何改動。\n\n在該欄填一個數字（例如讀經填 1）＝每人每季最多幾次；留空＝不限。',
      ui.ButtonSet.OK);
      return;
    }
    const confirm = ui.alert(title, '會在 Posts 工作表最後一欄之後新增 ' + COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER
      + ' 欄（目前共 ' + plan.postCount + ' 個崗位），全部留空（＝不限）。\n\n確定要新增嗎？', ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;
    seedPostMaxPerPerson_(plan);
    writeAuditLog_({
      action: '補建 Posts 欄位',
      targetSheet: SHEETS.POSTS,
      targetKey: COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER,
      newValue: '（只新增欄位，沒有填任何值）',
      source: 'runSeedPostMaxPerPerson_'
    });
    ui.alert(title, '已新增 ' + COLUMNS.POSTS.MAX_PER_PERSON_PER_QUARTER + ' 欄（第 ' + plan.columnIndex
      + ' 欄），全部留空。要限制某個崗位，在那一格填數字。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPostMaxPerPerson_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
