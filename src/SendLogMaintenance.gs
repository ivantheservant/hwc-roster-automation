/**
 * 「清除一批 SendLog 記錄」：測試期間 SendLog 會累積大量測試產生的記錄，
 * 這個工具讓幹事按「批次」（一次 sendStage() 執行寫入的那一組列）整批刪除，
 * 不用人手 scroll 選取行號。**只操作 SendLog 工作表，不碰任何其他工作表**，
 * 也**沒有「清除全部」這種選項**——一律要輸入完整的批次前綴字串才能刪除。
 *
 * 批次的判斷依據：SendID 的組成是
 * `[QuarterID, 'v'+VersionNo, Stage, idStamp, 序號].join('-')`
 * （見 Mailer.gs 的 writeSendLogRows_()），同一次 sendStage() 執行內，
 * 全部收件人的 idStamp 相同、只有序號不同——把 SendID 去掉最後一段（序號）
 * 就是「批次前綴」，同一批次的所有列一定有相同的批次前綴。
 */

/**
 * 讀取 SendLog 的原始資料，附上每一列實際的工作表行號（供刪除時定位）。
 * @returns {{headers: string[], rows: Object[]}} rows 每項為 {sheetRow, ...欄位}
 */
function readSendLogRaw_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SEND_LOG);

  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return { headers: [], rows: [] };

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();

  const rows = values.map(function (row, i) {
    const record = { sheetRow: i + 3 };
    headers.forEach(function (h, c) { record[h] = row[c]; });
    return record;
  });
  return { headers: headers, rows: rows };
}

/**
 * 把 SendID 去掉最後一段（序號），取得批次前綴。
 * @param {string} sendId SendLog.SendID 欄的值
 * @returns {string} 批次前綴；SendID 格式不符（少於 2 段）時原樣回傳
 */
function extractSendLogBatchPrefix_(sendId) {
  const parts = String(sendId || '').split('-');
  if (parts.length < 2) return String(sendId || '');
  return parts.slice(0, -1).join('-');
}

/**
 * 把 SendLog 依批次前綴分組，統計每批的行數、Stage、時間、Status 分佈。
 * @returns {Object[]} 每項為 {prefix, quarterId, versionNo, stage, sentAt,
 *   rowCount, statusSummary, sheetRows}，sheetRows 為該批全部列的實際行號
 */
function groupSendLogBatches_() {
  const data = readSendLogRaw_();
  const C = COLUMNS.SEND_LOG;
  const batches = {};

  data.rows.forEach(function (r) {
    const prefix = extractSendLogBatchPrefix_(r[C.SEND_ID]);
    if (!batches[prefix]) {
      batches[prefix] = {
        prefix: prefix,
        quarterId: r[C.QUARTER_ID],
        versionNo: r[C.VERSION_NO],
        stage: r[C.STAGE],
        sentAt: r[C.SENT_AT],
        rowCount: 0,
        statusCounts: {},
        sheetRows: []
      };
    }
    const b = batches[prefix];
    b.rowCount++;
    b.sheetRows.push(r.sheetRow);
    const status = String(r[C.STATUS] || '（空白）');
    b.statusCounts[status] = (b.statusCounts[status] || 0) + 1;
  });

  const idStampOf = function (prefix) {
    const parts = String(prefix).split('-');
    return parts[parts.length - 1] || '';
  };

  return Object.keys(batches)
    .map(function (k) { return batches[k]; })
    .sort(function (a, b) {
      const sa = idStampOf(a.prefix);
      const sb = idStampOf(b.prefix);
      return sb < sa ? -1 : (sb > sa ? 1 : 0);
    });
}

/**
 * 把 Status 分佈統計整理成一行文字，例如「2 筆 DRY_RUN、58 筆 ERROR_PDF_MISSING」。
 * @param {Object.<string, number>} statusCounts {Status: 行數}
 * @returns {string} 摘要文字
 */
function formatSendLogStatusSummary_(statusCounts) {
  return Object.keys(statusCounts)
    .map(function (s) { return statusCounts[s] + ' 筆 ' + s; })
    .join('、');
}

/**
 * 依批次前綴刪除 SendLog 對應的全部列。逐行由下往上刪（deleteRow()），
 * 不假設同一批次的列一定連續，確保無論實際排列方式都刪對行、不會刪錯鄰近列。
 * @param {string} prefix 要刪除的批次前綴（完整字串）
 * @returns {number} 實際刪除的行數；找不到符合的批次時回傳 0
 */
function deleteSendLogBatch_(prefix) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SEND_LOG);

  const data = readSendLogRaw_();
  const C = COLUMNS.SEND_LOG;
  const targetRows = data.rows
    .filter(function (r) { return extractSendLogBatchPrefix_(r[C.SEND_ID]) === prefix; })
    .map(function (r) { return r.sheetRow; })
    .sort(function (a, b) { return b - a; }); // 由下往上刪，避免行號位移

  targetRows.forEach(function (rowNum) { sheet.deleteRow(rowNum); });
  return targetRows.length;
}
