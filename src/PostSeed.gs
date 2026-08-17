/**
 * 「補建 Posts 欄位」：Posts 工作表補上 EmptyDisplay 欄（決定「崗位存在但留空」的
 * 格子要顯示 PENDING／NA／BLANK 中的哪一種，見 Constants.gs 的 POST_EMPTY_DISPLAY
 * 與 RosterWriter.gs 的 resolveEmptyDisplayText_()）。
 *
 * 手法與 ConfigSeed.gs 的「補建 Config 參數」一致：只 append，絕不覆寫既有內容。
 * 這裡多一層考量——這是**欄**不是**列**，所以規則是：
 * - 欄本身不存在時，只能加在最後一欄之後，不可插入到中間
 * - 欄已存在時，只填補目前是空白的格，已經有值的格完全不動
 *
 * ---
 * 第十一輪批次階段 C（ICS 日曆檔）架構調整說明：
 *
 * 原始需求文字是「每個崗位的提早分鐘數要在 Config 逐個設定」，實作時改為
 * Posts 工作表新增 EarlyArrivalMinutes 欄，而不是逐一開 Config Key（例如
 * EARLY_ARRIVAL_MINUTES_音響、EARLY_ARRIVAL_MINUTES_司事……）。理由：
 *
 * 1. ConfigSeed.gs 的「補建 Config 參數」與 SelfTest.gs 都假設 Config 是一份
 *    **固定已知**的 Key 集合（逐一列出、逐一自我檢查完整性）。崗位數量與
 *    名稱會隨季度調整（新增/停用崗位），若每個崗位對應一個動態 Config Key，
 *    這兩份「固定清單」的自我檢查機制都會失效或需要另外改成動態掃描，
 *    等於要另建一套跟 Config 平行的機制，複雜度更高。
 * 2. Posts 工作表本來就是「每個崗位一列、逐崗位設定」的資料結構，已經有
 *    EmptyDisplay、AllowConsecutive 這類逐崗位設定的欄位（就是這個檔案
 *    在做的事）——EarlyArrivalMinutes 加進來是同一個既有模式的延伸，不是
 *    新增一種資料形狀。
 * 3. 對幹事而言，「呢個崗位要提早幾多分鐘」跟「呢個崗位留空點顯示」是同一類
 *    決定（崗位本身的屬性），放在同一張 Posts 表比分散在 Config 表更直覺、
 *    也更容易一次看晒全部崗位的設定。
 *
 * 全域預設崇拜時間（ICS_SERVICE_START_TIME／ICS_SERVICE_END_TIME）仍然留在
 * Config——那是「一個」值，不是「每個崗位各一個」，符合 Config 原本的用途。
 *
 * 用法與 EmptyDisplay 完全一致：留空的崗位視為 0（不提早），只有真正需要
 * 提早到場的崗位（例如音響、司事）才需要填數字。
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

/**
 * 檢查 Posts 工作表的 EarlyArrivalMinutes 欄現況，算出要新增／填補的內容
 * （只讀，不寫入）。留空的崗位一律視為 0（不提早），所以這個工具**不會**
 * 幫任何崗位自動填一個非零的建議值——幹事需要自己判斷邊個崗位要提早、
 * 提早幾多分鐘，工具只負責補建欄位本身，不猜測數值。
 * @returns {{columnExists: boolean, columnIndex: number, rows: Object[]}}
 *   columnIndex 為 1-based 欄號（欄不存在時＝目前最後一欄+1）；
 *   rows 為要補 0 的格，每項 {sheetRow, postId, postName, value}
 */
function planPostEarlyArrivalMinutesSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES);
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

  for (let i = 0; i < dataRowCount; i++) {
    const currentValue = String(existingValues[i][0] || '').trim();
    if (currentValue !== '') continue; // 已有值，略過（只填補空格，不覆蓋）

    plan.rows.push({ sheetRow: i + 3, postId: ids[i][0], postName: String(names[i][0] || '').trim(), value: 0 });
  }
  return plan;
}

/**
 * 第十六輪批次階段 B：檢查 Posts 工作表的 `RequiredRoles` 欄現況（只讀，不寫入）。
 *
 * 跟另外兩個 seed 工具一個重要分別：**這個工具只補建欄位本身，一格值都不會填。**
 * 「邊個崗位需要邊個身分」係教會嘅規定，工具冇資格猜——而且猜錯嘅後果好嚴重：
 * 亂填一個身分要求落去，嗰個崗位就會即刻排唔到人（因為冇人符合），
 * 而幹事只會見到一堆莫名其妙嘅空格。所以一律留空（＝冇身分要求＝行為不變），
 * 由幹事按教會規則自己填。
 *
 * 對照另外兩個工具：`EmptyDisplay` 有明確嘅安全預設值（PENDING）、
 * `EarlyArrivalMinutes` 有明確嘅安全預設值（0＝不提早），兩者填錯都唔會令
 * 排表排唔到人，所以佢哋會填預設值；`RequiredRoles` 冇呢種安全預設值。
 *
 * @returns {{columnExists: boolean, columnIndex: number, postCount: number}}
 *   columnIndex 為 1-based 欄號（欄不存在時＝目前最後一欄+1）
 */
function planPostRequiredRolesSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.POSTS.REQUIRED_ROLES);
  const columnExists = existingIndex !== -1;

  return {
    columnExists: columnExists,
    columnIndex: columnExists ? existingIndex + 1 : lastCol + 1,
    postCount: Math.max(0, lastRow - 2)
  };
}

/**
 * 依 planPostRequiredRolesSeed_() 的計畫，在 Posts 工作表補建 `RequiredRoles` 欄。
 * 只加欄（第 2 行機器鍵、第 1 行中文標題），**不填任何一格的值**。
 * 欄已存在時完全不動，回傳 false。
 * @param {Object} plan planPostRequiredRolesSeed_() 的結果
 * @returns {boolean} 是否真的新增了欄位
 */
function seedPostRequiredRoles_(plan) {
  if (plan.columnExists) return false;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  sheet.getRange(1, plan.columnIndex).setValue('崗位身分要求（逗號分隔，留空＝沒有要求）');
  sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.POSTS.REQUIRED_ROLES);
  return true;
}

/**
 * 選單項目「維護 ▸ 補建 Posts 欄位（崗位身分要求）」的執行入口。
 * @returns {void}
 */
function runSeedPostRequiredRoles_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 Posts 欄位（崗位身分要求）';
  try {
    const plan = planPostRequiredRolesSeed_();
    if (plan.columnExists) {
      ui.alert(title,
        'Posts 工作表已經有 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄（第 '
          + plan.columnIndex + ' 欄），沒有做任何改動。\n\n'
          + '要設定身分要求，請直接在該欄填入身分代號：\n'
          + '　報告 → ' + ROLE_CODES.COMMITTEE + '\n'
          + '　當值堂委 → ' + ROLE_CODES.COMMITTEE + ',' + ROLE_CODES.DEACON + '\n'
          + '　其餘崗位 → 留空（＝沒有身分要求）',
        ui.ButtonSet.OK);
      return;
    }

    const confirm = ui.alert(title,
      '會在 Posts 工作表最後一欄之後新增 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄'
        + '（目前共 ' + plan.postCount + ' 個崗位）。\n\n'
        + '⚠️ 只會加欄位本身，不會填任何一格的值——\n'
        + '　 「哪個崗位需要哪個身分」是教會的規定，系統不會替你猜，\n'
        + '　 填錯的話那個崗位會直接排不到人。\n\n'
        + '新增之後請自己填：\n'
        + '　報告 → ' + ROLE_CODES.COMMITTEE + '（堂委）\n'
        + '　當值堂委 → ' + ROLE_CODES.COMMITTEE + ',' + ROLE_CODES.DEACON + '（堂委或執事）\n'
        + '　其餘崗位 → 留空\n\n'
        + '確定要新增嗎？',
      ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;

    seedPostRequiredRoles_(plan);
    writeAuditLog_({
      action: '補建 Posts 欄位',
      targetSheet: SHEETS.POSTS,
      targetKey: COLUMNS.POSTS.REQUIRED_ROLES,
      newValue: '（只新增欄位，沒有填任何值）',
      source: 'runSeedPostRequiredRoles_'
    });
    ui.alert(title,
      '已新增 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄（第 ' + plan.columnIndex + ' 欄），全部留空。\n\n'
        + '請自己填入身分要求，填完用「查看 ▸ 身分名單概況（唯讀）」核對一次。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPostRequiredRoles_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 依 planPostEarlyArrivalMinutesSeed_() 的計畫寫入 Posts 工作表：
 * 欄不存在就先在最後一欄之後新增（第 2 行寫機器鍵 'EarlyArrivalMinutes'，
 * 第 1 行寫一個中文標題方便你在工作表上辨識），然後把目前空白的格填 0
 * （0＝不提早，之後你可以自行在工作表上改成需要的分鐘數）。
 * 完全不會動到欄不存在以外的任何既有內容。
 * @param {Object} plan planPostEarlyArrivalMinutesSeed_() 的結果
 * @returns {number} 實際寫入的格數
 */
function seedPostEarlyArrivalMinutes_(plan) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);

  if (!plan.columnExists) {
    sheet.getRange(1, plan.columnIndex).setValue('提早到場分鐘數');
    sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES);
  }

  plan.rows.forEach(function (r) {
    sheet.getRange(r.sheetRow, plan.columnIndex).setValue(r.value);
  });

  return plan.rows.length;
}
