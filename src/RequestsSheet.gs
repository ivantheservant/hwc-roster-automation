/**
 * 「建立 Requests 工作表」：幹事登記「不能服侍／指定服侍」申報用的工作表。
 * 日期／崗位／姓名三欄的資料驗證設為「顯示警告」而非「拒絕輸入」——幹事可以手打
 * 不在名單上的值，實際把關留給「套用修改申報」（RequestsApply.gs，追加階段的第二部分）。
 *
 * Status／處理結果／處理時間三欄由系統填寫，**不用 Google Sheets 的 Range.protect()**：
 * 實測發現 protect() 只能擋「不在編輯者清單內的人」，但幹事本身就是試算表的編輯者，
 * protect() 完全擋不住她／他自己手改（這是 P-6 測試發現的真實 bug）。改用三層防線：
 * 1. Status 欄設資料驗證，只允許四個合法值，設為「拒絕輸入」——擋得住打錯字（例如「test」），
 *    但擋不住幹事刻意打一個合法值（例如手打 APPLIED）冒充系統已處理。
 * 2. 處理結果／處理時間兩欄的第 1 行標題加註解「系統填寫，請勿手改」，純粹提示。
 * 3.（真正的防線）「套用修改申報」執行時一律以系統自己的判斷**整段覆寫**這三欄，
 *    完全不讀取、不理會這三欄目前的任何值——即使欄位被手改過，也不會影響套用結果，
 *    因為套用邏輯根本不會拿舊值來做任何判斷。
 * 另外新增選單「清理 Requests 手改痕跡」，把不像是系統寫入的殘留值找出來清空。
 *
 * ⚠️ Q-3 測試發現：Status 欄的資料驗證曾經被手動清掉過（幹事清空 Status／處理結果／
 * 處理時間內容時，若用到會一併清掉驗證規則的操作），導致拒絕輸入完全失效。
 * 所有 setDataValidation() 呼叫現在都套用到**整欄**（第 3 行到 sheet.getMaxRows()），
 * 不是只套在建立當下寫入的那幾行；另外新增選單「重設 Requests 驗證規則」，
 * 可以隨時重新套用全部欄位的驗證與格式，不影響已填入的資料，日後幹事不小心
 * 清掉驗證時可以直接用這個修復，不需要我介入改程式碼。
 */

/** Requests 第 1 行（中文標題）與第 2 行（機器鍵）的欄位順序，兩個陣列一一對應。 */
const REQUESTS_HEADERS_TC = ['RequestID', 'QuarterID', '日期', '崗位', '姓名', '類型', 'Status', '處理結果', '建立時間', '處理時間', '備註'];

/**
 * 取得 Requests 第 2 行機器鍵陣列，順序須與 REQUESTS_HEADERS_TC 一一對應。
 * 寫成函式而非頂層 const：本檔案（R 開頭）依字母序早於 Constants.gs 載入，
 * 頂層直接引用 COLUMNS 會撞到 TDZ（跟 ConfigSeed.gs 的 getConfigKeySeeds_() 同理）。
 * @returns {string[]} 機器鍵陣列
 */
function getRequestsHeaderKeys_() {
  const C = COLUMNS.REQUESTS;
  return [
    C.REQUEST_ID, C.QUARTER_ID, C.SERVICE_DATE, C.POST_NAME, C.PERSON_NAME,
    C.REQUEST_TYPE, C.STATUS, C.RESULT_NOTE, C.CREATED_AT, C.PROCESSED_AT, C.NOTES
  ];
}

/**
 * 建立（若不存在）或重新整理（若已存在）Requests 工作表。
 * 已存在時只重新整理日期／崗位／姓名三欄的下拉選單來源，完全不動任何既有資料列。
 * @param {string} quarterId 這次要開放申報、日期下拉選單要對應的季度 ID
 * @returns {{isNew: boolean}} isNew 表示這次是否新建立了工作表
 */
function createOrRefreshRequestsSheet_(quarterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.REQUESTS);
  const isNew = !sheet;

  if (isNew) {
    sheet = buildRequestsSheetStructure_(ss);
  }

  applyRequestsValidations_(sheet, quarterId);
  applyRequestTypeValidation_(sheet);
  applyStatusValidation_(sheet);
  applySystemColumnNotes_(sheet);

  return { isNew: isNew };
}

/**
 * 建立 Requests 工作表的骨架：只寫標題列與凍結／隱藏設定，不在這裡套用資料驗證——
 * 驗證統一交給 createOrRefreshRequestsSheet_() 呼叫的幾個 apply*Validation_()，
 * 新建立與重新整理走同一套邏輯，避免兩處各自為政、日後改一邊忘記改另一邊。
 * @param {Spreadsheet} ss 試算表
 * @returns {Sheet} 新建立的工作表
 */
function buildRequestsSheetStructure_(ss) {
  const sheet = ss.insertSheet(SHEETS.REQUESTS);
  const keys = getRequestsHeaderKeys_();

  sheet.getRange(1, 1, 1, REQUESTS_HEADERS_TC.length).setValues([REQUESTS_HEADERS_TC])
    .setFontWeight('bold')
    .setBackground(GRID_COLORS.HEADER)
    .setWrap(true);
  sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  sheet.setFrozenRows(2);
  sheet.hideRows(2);
  sheet.autoResizeColumns(1, keys.length);

  return sheet;
}

/**
 * 對類型欄套用「拒絕輸入」的清單型資料驗證，只允許 REQUEST_TYPE 的兩個值。
 * 套用範圍是整欄（第 3 行到 sheet.getMaxRows()）。
 * @param {Sheet} sheet Requests 工作表
 * @returns {void}
 */
function applyRequestTypeValidation_(sheet) {
  const keys = getRequestsHeaderKeys_();
  const typeCol = keys.indexOf(COLUMNS.REQUESTS.REQUEST_TYPE) + 1;
  if (typeCol === 0) return;

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([REQUEST_TYPE.CANNOT_SERVE, REQUEST_TYPE.DESIGNATED_SERVE], true)
    .setAllowInvalid(false)
    .setHelpText('請選擇：' + REQUEST_TYPE.CANNOT_SERVE + ' 或 ' + REQUEST_TYPE.DESIGNATED_SERVE)
    .build();
  sheet.getRange(3, typeCol, Math.max(1, sheet.getMaxRows() - 2), 1).setDataValidation(rule);
}

/**
 * 重新整理日期／崗位／姓名三欄的下拉選單來源。三欄一律用「顯示警告」而非「拒絕輸入」
 * （setAllowInvalid(true)）：幹事可以手打不在名單上的值（例如姓名有別字、或人還沒加入
 * NameMapping），真正的把關留給「套用修改申報」在驗證階段判斷。
 * @param {Sheet} sheet Requests 工作表
 * @param {string} quarterId 日期下拉選單要對應的季度 ID
 * @returns {void}
 */
function applyRequestsValidations_(sheet, quarterId) {
  const keys = getRequestsHeaderKeys_();
  const dateCol = keys.indexOf(COLUMNS.REQUESTS.SERVICE_DATE) + 1;
  const postCol = keys.indexOf(COLUMNS.REQUESTS.POST_NAME) + 1;
  const personCol = keys.indexOf(COLUMNS.REQUESTS.PERSON_NAME) + 1;

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const dateOptions = readServiceDatesNormalized(quarterId, timezone)
    .map(function (d) { return d.serviceDate; });
  const postOptions = readPostsNormalized().map(function (p) { return p.postNameTC; });
  const personOptions = readPeople().map(function (row) { return row[COLUMNS.NAME_MAPPING.NAME_TC]; });

  const dataRowCount = Math.max(1, sheet.getMaxRows() - 2);
  applyWarningListValidation_(sheet, dateCol, dataRowCount, dateOptions);
  applyWarningListValidation_(sheet, postCol, dataRowCount, postOptions);
  applyWarningListValidation_(sheet, personCol, dataRowCount, personOptions);
}

/**
 * 對指定欄套用「顯示警告」的清單型資料驗證（不拒絕輸入）。
 * @param {Sheet} sheet 目標工作表
 * @param {number} col 1-based 欄號；0 代表找不到該欄，直接略過
 * @param {number} numRows 要套用的列數（從第 3 行開始）
 * @param {string[]} options 清單來源
 * @returns {void}
 */
function applyWarningListValidation_(sheet, col, numRows, options) {
  if (col === 0 || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(3, col, numRows, 1).setDataValidation(rule);
}

/**
 * 對 Status 欄套用「拒絕輸入」的清單型資料驗證，只允許 REQUEST_STATUS 的四個值。
 * 這只擋得住打錯字／打亂七八糟的值，擋不住幹事刻意打一個合法值冒充系統已處理——
 * 那道防線在「套用修改申報」整段覆寫這三欄（見本檔案開頭註解第 3 點）。
 * @param {Sheet} sheet Requests 工作表
 * @returns {void}
 */
function applyStatusValidation_(sheet) {
  const keys = getRequestsHeaderKeys_();
  const statusCol = keys.indexOf(COLUMNS.REQUESTS.STATUS) + 1;
  if (statusCol === 0) return;

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      [REQUEST_STATUS.PENDING, REQUEST_STATUS.APPLIED, REQUEST_STATUS.REJECTED, REQUEST_STATUS.NEEDS_INPUT],
      true
    )
    .setAllowInvalid(false)
    .setHelpText('Status 由系統填寫，只允許 PENDING／APPLIED／REJECTED／NEEDS_INPUT，請勿手改')
    .build();
  sheet.getRange(3, statusCol, Math.max(1, sheet.getMaxRows() - 2), 1).setDataValidation(rule);
}

/**
 * 在處理結果／處理時間兩欄的第 1 行標題加註解，提示這是系統填寫的欄位。
 * 純粹提示用途，不是實際的把關機制。
 * @param {Sheet} sheet Requests 工作表
 * @returns {void}
 */
function applySystemColumnNotes_(sheet) {
  const keys = getRequestsHeaderKeys_();
  const note = '系統填寫，請勿手改——套用修改申報時會整段覆寫，手改也不會影響處理結果。';
  [COLUMNS.REQUESTS.RESULT_NOTE, COLUMNS.REQUESTS.PROCESSED_AT].forEach(function (key) {
    const col = keys.indexOf(key) + 1;
    if (col === 0) return;
    sheet.getRange(1, col).setNote(note);
  });
}

/**
 * 「重設 Requests 驗證規則」：重新套用全部欄位的資料驗證與格式，不影響已填入的資料
 * （setDataValidation()／setNote() 都不會動到 Value）。日後幹事不小心把某欄的
 * 驗證規則清掉時（例如 Q-3 測試發現的 Status 欄失效），可以直接用這個修復，
 * 不必等我改程式碼——這是這個選單存在的主要理由，不只是這次事後補救。
 * @param {string} quarterId 日期下拉選單要對應的季度 ID
 * @returns {{columns: string[]}} 已重設的欄位說明，供對話框顯示
 */
function resetRequestsValidations_(quarterId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.REQUESTS + '，請先執行「建立 Requests 工作表」');

  applyRequestsValidations_(sheet, quarterId);
  applyRequestTypeValidation_(sheet);
  applyStatusValidation_(sheet);
  applySystemColumnNotes_(sheet);

  return {
    columns: [
      '日期（顯示警告，對應 ' + quarterId + '）',
      '崗位（顯示警告）',
      '姓名（顯示警告）',
      '類型（拒絕輸入）',
      'Status（拒絕輸入）',
      '處理結果／處理時間（標題註解）'
    ]
  };
}

/* ============================================================
 * 選單「清理 Requests 手改痕跡」
 * ============================================================
 * Status 的拒絕輸入驗證只能擋打錯字，擋不住幹事刻意打一個合法值（例如手打 APPLIED）
 * 冒充系統已處理；「套用修改申報」本身雖然不會被這種殘留值誤導（整段覆寫，見檔頭註解），
 * 但殘留的假象會讓幹事誤以為某筆申報已經處理過。這個工具找出兩種可疑情況並清空：
 * 1. Status 有值，但不是四個合法值之一（含合法值以外的任何文字）
 * 2. RequestID 為空，但 Status／處理結果／處理時間任一欄有值
 *    （正常情況下這三欄只會在「套用修改申報」指派 RequestID 的同時一起寫入，
 *    RequestID 空白代表這一行從未真正被系統處理過）
 */

/**
 * 掃描 Requests，找出疑似手改痕跡的資料列（只讀，不寫入）。
 * @returns {{rows: Object[]}} rows 每項為 {sheetRow, requestId, status, reason}
 */
function planCleanRequestsTampering_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.REQUESTS);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const plan = { rows: [] };
  if (lastRow < 3) return plan;

  const keys = getRequestsHeaderKeys_();
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const idCol = keys.indexOf(COLUMNS.REQUESTS.REQUEST_ID);
  const statusCol = keys.indexOf(COLUMNS.REQUESTS.STATUS);
  const resultCol = keys.indexOf(COLUMNS.REQUESTS.RESULT_NOTE);
  const processedCol = keys.indexOf(COLUMNS.REQUESTS.PROCESSED_AT);
  const validStatuses = [REQUEST_STATUS.PENDING, REQUEST_STATUS.APPLIED, REQUEST_STATUS.REJECTED, REQUEST_STATUS.NEEDS_INPUT];

  values.forEach(function (row, i) {
    const requestId = String(row[idCol] || '').trim();
    const status = String(row[statusCol] || '').trim().toUpperCase();
    const hasResult = row[resultCol] !== '' && row[resultCol] !== null && row[resultCol] !== undefined;
    const hasProcessedAt = row[processedCol] !== '' && row[processedCol] !== null && row[processedCol] !== undefined;
    const hasAnySystemValue = status !== '' || hasResult || hasProcessedAt;
    if (!hasAnySystemValue) return;

    const statusInvalid = status !== '' && validStatuses.indexOf(status) === -1;
    const missingIdButHasValue = requestId === '' && hasAnySystemValue;
    if (!statusInvalid && !missingIdButHasValue) return;

    plan.rows.push({
      sheetRow: i + 3,
      requestId: requestId,
      status: row[statusCol],
      reason: statusInvalid ? 'Status 值不屬 PENDING／APPLIED／REJECTED／NEEDS_INPUT 四者之一'
        : 'RequestID 為空，但 Status／處理結果／處理時間有值（不像是系統寫入的）'
    });
  });
  return plan;
}

/**
 * 依 planCleanRequestsTampering_() 的計畫清空可疑資料列的 Status／處理結果／處理時間，
 * 並在備註欄記錄清理原因與時間。
 * @param {Object} plan planCleanRequestsTampering_() 的結果
 * @returns {number} 實際清理的列數
 */
function cleanRequestsTampering_(plan) {
  if (plan.rows.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.REQUESTS);

  const keys = getRequestsHeaderKeys_();
  const statusCol = keys.indexOf(COLUMNS.REQUESTS.STATUS) + 1;
  const resultCol = keys.indexOf(COLUMNS.REQUESTS.RESULT_NOTE) + 1;
  const processedCol = keys.indexOf(COLUMNS.REQUESTS.PROCESSED_AT) + 1;
  const notesCol = keys.indexOf(COLUMNS.REQUESTS.NOTES) + 1;
  const now = nowTimestamp_();

  plan.rows.forEach(function (r) {
    if (statusCol > 0) sheet.getRange(r.sheetRow, statusCol).setValue('');
    if (resultCol > 0) sheet.getRange(r.sheetRow, resultCol).setValue('');
    if (processedCol > 0) sheet.getRange(r.sheetRow, processedCol).setValue('');
    if (notesCol > 0) {
      const stamp = '[' + now + '] 偵測到手改痕跡（' + r.reason + '），已清空 Status／處理結果／處理時間';
      const existing = String(sheet.getRange(r.sheetRow, notesCol).getValue() || '');
      sheet.getRange(r.sheetRow, notesCol).setValue(existing ? existing + '\n' + stamp : stamp);
    }
  });
  return plan.rows.length;
}
