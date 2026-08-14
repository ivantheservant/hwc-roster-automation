/**
 * 「維護 ▸ ⚠️ 重設季度測試資料」：把一個季度累積的測試資料清走，供正式上線前重來一次。
 *
 * 這是全系統最危險的功能之一，所以寫得刻意保守：
 * - **先算後做**：`planQuarterReset_()` 只讀取、只統計，完全不刪任何東西；
 *   實際刪除的 `executeQuarterReset_()` 只按這份計畫執行，不會自己再去找東西刪
 * - **範圍嚴格限定在一個季度**：所有掃描都以 QuarterID 篩選，其他季度完全不碰
 * - **不確定的一律不刪**：辨識不到的檔案、來源不是 REQUEST 的 Unavailable、
 *   受保護的版本，一律留下並列入「需要人手處理」清單，由幹事自己判斷
 * - **PDF 只移到垃圾桶**（`setTrashed(true)`），不永久刪除，30 日內可自行復原
 * - **刪除前先寫 AuditLog**：先記錄將被刪除的內容摘要，才開始刪
 *
 * 絕對不碰的工作表（無論任何情況）：Eligibility、NameMapping、NameAlias、Config、
 * EmailTemplates、EmailRecipients、Posts、RuleSettings、ServiceDates、SpecialSundays。
 * 這些是系統的基礎設定與人員資料，跟「某一季的測試痕跡」無關。
 */

/** 執行重設前必須逐字輸入的確認字串。 */
const QUARTER_RESET_CONFIRM_TEXT = '確認重設';

/**
 * 掃描一個季度目前有哪些測試資料可以清理。**只讀取，完全不刪任何東西。**
 *
 * @param {string} quarterId 季度 ID
 * @param {boolean} includeV0 是否連 v0 一併清理。v0 是原始版本、通常已加保護，
 *   預設不清；true 時才會列入。
 * @returns {Object} 清理計畫，含各項數量、要刪的具體目標、以及需要人手處理的項目
 */
function planQuarterReset_(quarterId, includeV0) {
  const plan = {
    quarterId: quarterId,
    includeV0: includeV0 === true,
    versions: [],          // {versionNo, sheetName, protected, sheetExists}
    versionSheetNames: [],
    assignmentRows: 0,
    sendLogRows: 0,
    requestRows: 0,
    unavailableRequestRows: 0,
    unavailableManualRows: 0,
    pdfFiles: [],          // {id, name, sizeBytes}
    pdfUnrecognised: [],   // 不確定屬於哪個季度的檔案，一律不刪
    quarterStage: '',
    manualAttention: []    // 需要人手處理的項目說明
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- RosterVersions 與對應的 grid 工作表 ----
  const V = COLUMNS.ROSTER_VERSIONS;
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    if (String(row[V.QUARTER_ID] || '').trim() !== quarterId) return;
    const versionNo = Number(row[V.VERSION_NO]);
    const isProtected = isTrueValue_(row[V.PROTECTED]);
    const sheetName = String(row[V.SHEET_NAME] || '').trim() || buildRosterSheetName_(quarterId, versionNo);

    if (versionNo === 0 && !plan.includeV0) {
      plan.manualAttention.push('v0（' + sheetName + '）：原始版本，本次選擇保留。'
        + '如果確定要連 v0 一併清走，重新執行並選擇「連 v0 一齊清」。');
      return;
    }
    if (isProtected && versionNo !== 0) {
      plan.manualAttention.push('v' + versionNo + '（' + sheetName + '）：RosterVersions 標示為受保護（Protected=TRUE），'
        + '不會自動清除。如果確定要清，請先在 RosterVersions 把 Protected 改為 FALSE。');
      return;
    }

    plan.versions.push({
      versionNo: versionNo,
      sheetName: sheetName,
      isProtected: isProtected,
      sheetExists: !!ss.getSheetByName(sheetName)
    });
    plan.versionSheetNames.push(sheetName);
  });
  plan.versions.sort(function (a, b) { return a.versionNo - b.versionNo; });

  const versionNosToClear = {};
  plan.versions.forEach(function (v) { versionNosToClear[v.versionNo] = true; });

  // ---- RosterAssignments：只算屬於這個季度、且版本在清理範圍內的行 ----
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
    if (!versionNosToClear[Number(row[A.VERSION_NO])]) return;
    plan.assignmentRows++;
  });

  // ---- SendLog：這個季度的全部紀錄 ----
  const S = COLUMNS.SEND_LOG;
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[S.QUARTER_ID] || '').trim() !== quarterId) return;
    plan.sendLogRows++;
  });

  // ---- Requests：這個季度的全部行 ----
  const R = COLUMNS.REQUESTS;
  try {
    readSheet(SHEETS.REQUESTS).forEach(function (row) {
      if (String(row[R.QUARTER_ID] || '').trim() !== quarterId) return;
      plan.requestRows++;
    });
  } catch (err) {
    plan.manualAttention.push('Requests 工作表讀取失敗或不存在，這一項略過：' + err.message);
  }

  // ---- Unavailable：只清 Source=REQUEST（系統由申報自動加入）的行 ----
  // 幹事人手輸入的真實不可服侍日絕對不可以清，所以逐行檢查 Source。
  // Unavailable 沒有 QuarterID 欄，只能靠日期範圍判斷屬於哪一季。
  const U = COLUMNS.UNAVAILABLE;
  const quarter = findQuarter_(quarterId);
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const quarterStart = quarter ? toDateString(quarter[COLUMNS.QUARTERS.START_DATE], timezone) : '';
  const quarterEnd = quarter ? toDateString(quarter[COLUMNS.QUARTERS.END_DATE], timezone) : '';

  if (!quarterStart || !quarterEnd) {
    plan.manualAttention.push('Quarters 找不到 ' + quarterId + ' 的起訖日期，'
      + '無法判斷 Unavailable 哪些行屬於這一季，因此 Unavailable 完全不清，請自行檢查。');
  } else {
    readSheet(SHEETS.UNAVAILABLE).forEach(function (row) {
      const dateFrom = toDateString(row[U.DATE_FROM], timezone);
      if (!dateFrom || dateFrom < quarterStart || dateFrom > quarterEnd) return;
      const source = String(row[U.SOURCE] || '').trim().toUpperCase();
      if (source === 'REQUEST') {
        plan.unavailableRequestRows++;
      } else {
        plan.unavailableManualRows++;
      }
    });
    if (plan.unavailableManualRows > 0) {
      plan.manualAttention.push('Unavailable 有 ' + plan.unavailableManualRows
        + ' 行落在這一季、但 Source 不是 REQUEST（即幹事人手輸入的真實不可服侍日），'
        + '一律保留不清。如果其中有測試資料，請自行刪除。');
    }
  }

  // ---- RosterPDF 資料夾 ----
  try {
    const folder = resolveMailAttachmentFolder_();
    const pattern = new RegExp('^' + escapeRegExp_(quarterId) + '_v(\\d+)');
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      const match = pattern.exec(name);
      if (!match) continue;                       // 其他季度或不明檔案：不碰
      const versionNo = Number(match[1]);
      if (versionNo === 0 && !plan.includeV0) continue;
      plan.pdfFiles.push({ id: file.getId(), name: name, sizeBytes: file.getSize() });
    }
  } catch (err) {
    plan.manualAttention.push('無法開啟 RosterPDF 資料夾，PDF 完全不清：' + err.message
      + '（如果 Config 的 ROSTER_DRIVE_FOLDER_ID 未設定，這是預期行為）');
  }

  // ---- Quarters.Stage ----
  try {
    plan.quarterStage = getQuarterStage_(quarterId);
  } catch (err) {
    plan.manualAttention.push('讀取 Quarters 的 Stage 失敗：' + err.message);
  }

  return plan;
}

/**
 * 按 `planQuarterReset_()` 的計畫實際執行清理。呼叫前必須已經取得幹事的打字確認。
 *
 * 執行次序刻意由「最容易復原」到「最難復原」：先寫 AuditLog 留底，再刪資料列，
 * 然後刪 grid 工作表，PDF 只移到垃圾桶，最後才重設 Stage。
 * 任何一步拋錯都會中斷，已經完成的部分不會回滾——所以先寫 AuditLog 很重要，
 * 出事時至少知道當時打算刪什麼。
 *
 * @param {Object} plan planQuarterReset_() 的結果
 * @returns {Object} 實際執行結果的統計
 */
function executeQuarterReset_(plan) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {
    versionRowsDeleted: 0, versionSheetsDeleted: 0, assignmentRowsDeleted: 0,
    sendLogRowsDeleted: 0, requestRowsDeleted: 0, unavailableRowsDeleted: 0,
    pdfTrashed: 0, stageReset: false, errors: []
  };

  // 先留底：刪之前把打算刪什麼寫入 AuditLog
  writeAuditLog_({
    action: '重設季度測試資料',
    targetSheet: '（多張）',
    targetKey: plan.quarterId,
    oldValue: 'Stage=' + plan.quarterStage
      + '　版本=' + plan.versions.map(function (v) { return 'v' + v.versionNo; }).join(',')
      + '　RosterAssignments=' + plan.assignmentRows + ' 行'
      + '　SendLog=' + plan.sendLogRows + ' 行'
      + '　Requests=' + plan.requestRows + ' 行'
      + '　Unavailable(Source=REQUEST)=' + plan.unavailableRequestRows + ' 行'
      + '　PDF=' + plan.pdfFiles.length + ' 個',
    newValue: '（全部清除，Stage 重設為 ' + QUARTER_STAGE.DRAFT + '）',
    source: 'MENU',
    notes: '連 v0 一齊清：' + (plan.includeV0 ? 'YES' : 'NO')
      + '；需要人手處理的項目：' + (plan.manualAttention.length || 0) + ' 項'
  });

  const versionNosToClear = {};
  plan.versions.forEach(function (v) { versionNosToClear[v.versionNo] = true; });

  // ---- RosterAssignments ----
  result.assignmentRowsDeleted = deleteRowsMatching_(SHEETS.ROSTER_ASSIGNMENTS, function (record) {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    return String(record[A.QUARTER_ID] || '').trim() === plan.quarterId
      && versionNosToClear[Number(record[A.VERSION_NO])] === true;
  }, result.errors);

  // ---- SendLog ----
  result.sendLogRowsDeleted = deleteRowsMatching_(SHEETS.SEND_LOG, function (record) {
    return String(record[COLUMNS.SEND_LOG.QUARTER_ID] || '').trim() === plan.quarterId;
  }, result.errors);

  // ---- Requests ----
  result.requestRowsDeleted = deleteRowsMatching_(SHEETS.REQUESTS, function (record) {
    return String(record[COLUMNS.REQUESTS.QUARTER_ID] || '').trim() === plan.quarterId;
  }, result.errors);

  // ---- Unavailable：只刪 Source=REQUEST 且落在這一季的行 ----
  if (plan.unavailableRequestRows > 0) {
    const U = COLUMNS.UNAVAILABLE;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const quarter = findQuarter_(plan.quarterId);
    const quarterStart = quarter ? toDateString(quarter[COLUMNS.QUARTERS.START_DATE], timezone) : '';
    const quarterEnd = quarter ? toDateString(quarter[COLUMNS.QUARTERS.END_DATE], timezone) : '';
    if (quarterStart && quarterEnd) {
      result.unavailableRowsDeleted = deleteRowsMatching_(SHEETS.UNAVAILABLE, function (record) {
        const source = String(record[U.SOURCE] || '').trim().toUpperCase();
        if (source !== 'REQUEST') return false;   // 人手輸入的絕對不刪
        const dateFrom = toDateString(record[U.DATE_FROM], timezone);
        return !!dateFrom && dateFrom >= quarterStart && dateFrom <= quarterEnd;
      }, result.errors);
    }
  }

  // ---- RosterVersions 的登記列 ----
  result.versionRowsDeleted = deleteRowsMatching_(SHEETS.ROSTER_VERSIONS, function (record) {
    const V = COLUMNS.ROSTER_VERSIONS;
    return String(record[V.QUARTER_ID] || '').trim() === plan.quarterId
      && versionNosToClear[Number(record[V.VERSION_NO])] === true;
  }, result.errors);

  // ---- grid 工作表 ----
  plan.versions.forEach(function (v) {
    if (!v.sheetExists) return;
    try {
      const sheet = ss.getSheetByName(v.sheetName);
      if (sheet) {
        ss.deleteSheet(sheet);
        result.versionSheetsDeleted++;
      }
    } catch (err) {
      result.errors.push('刪除工作表 ' + v.sheetName + ' 失敗：' + err.message);
    }
  });

  // ---- PDF：只移到垃圾桶 ----
  plan.pdfFiles.forEach(function (f) {
    try {
      DriveApp.getFileById(f.id).setTrashed(true);
      result.pdfTrashed++;
    } catch (err) {
      result.errors.push('移除 PDF ' + f.name + ' 失敗：' + err.message);
    }
  });

  // ---- Quarters.Stage 重設 ----
  try {
    resetQuarterStageForTesting_(plan.quarterId);
    result.stageReset = true;
  } catch (err) {
    result.errors.push('重設 Stage 失敗：' + err.message);
  }

  return result;
}

/**
 * 通用的「按條件刪除資料列」：讀出整張表，找出符合條件的列號，**由下往上**逐行刪除
 * （避免刪除時後面的行號往上移導致刪錯，手法與 SendLogMaintenance.gs 的
 * `deleteSendLogBatch_()` 一致）。
 * @param {string} sheetName 工作表名稱
 * @param {function(Object): boolean} matcher 傳入一列的物件，回傳是否要刪
 * @param {string[]} errors 出錯時把訊息 push 進來
 * @returns {number} 實際刪除的列數
 */
function deleteRowsMatching_(sheetName, matcher, errors) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return 0;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 3 || lastCol === 0) return 0;

    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();

    const targetRows = [];
    values.forEach(function (row, i) {
      const record = {};
      headers.forEach(function (h, c) { if (h) record[h] = row[c]; });
      let matched = false;
      try {
        matched = matcher(record) === true;
      } catch (err) {
        matched = false; // 判斷不到就當作不刪——保守優先
      }
      if (matched) targetRows.push(i + 3);
    });

    targetRows.sort(function (a, b) { return b - a; }); // 由下往上刪
    targetRows.forEach(function (rowNum) { sheet.deleteRow(rowNum); });
    return targetRows.length;
  } catch (err) {
    if (errors) errors.push('清理 ' + sheetName + ' 失敗：' + err.message);
    return 0;
  }
}

/**
 * 把季度的 Stage 重設回初始值 DRAFT，並清空 StageUpdatedAt。
 *
 * 刻意不呼叫 `advanceQuarterStage_()`：那個函式的語意是「依流程前進」，
 * 有「不可倒退」的約定（見 QuarterStage.gs 檔頭）。這裡是測試資料重設，
 * 是明確要倒退回起點，屬於不同的意圖，所以獨立實作、獨立命名，
 * 免得日後有人以為 `advanceQuarterStage_()` 可以用來倒退。
 * @param {string} quarterId 季度 ID
 * @returns {void}
 */
function resetQuarterStageForTesting_(quarterId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const info = findQuarterRowInfo_(quarterId);
  if (!info) throw new Error('Quarters 找不到季度: ' + quarterId);

  const stageCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE) + 1;
  if (stageCol === 0) throw new Error('Quarters 缺少 Stage 欄');
  sheet.getRange(info.sheetRow, stageCol).setValue(QUARTER_STAGE.DRAFT);

  const stageAtCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE_UPDATED_AT) + 1;
  if (stageAtCol > 0) sheet.getRange(info.sheetRow, stageAtCol).setValue('');
}
