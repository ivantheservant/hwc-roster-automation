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
    // 第十輪批次階段 B1：逐行列出「落喺呢一季、但 Source 唔係 REQUEST」嘅
    // Unavailable。以前淨係報一個數字「有 N 行」，幹事要自己去成張 Unavailable
    // 慢慢揀邊幾行落喺呢季——實測時就係因為咁，有一行人手輸入嘅測試資料
    // 冇被清走。**列出嚟但一樣唔會自動刪**：人手輸入嘅真實請假絕對唔可以
    // 由程式判斷「應該係測試資料」。
    unavailableManualDetails: [],
    // 第十輪批次階段 B2：由「指定服侍」申報自動寫入 Eligibility 嘅行
    // （writeNewEligibilityRows_()，Source=REQUEST）。Eligibility 喺呢個工具嘅
    // 「絕對不碰」名單入面，所以唔會清——但佢會**永久影響之後每一次生成**
    // （嗰個人由此對嗰個崗位變成合資格），所以一定要列出嚟俾幹事知。
    eligibilityRequestRows: [],
    pdfFiles: [],          // {id, name, sizeBytes}
    pdfUnrecognised: [],   // 不確定屬於哪個季度的檔案，一律不刪
    quarterStage: '',
    // 第十四輪批次階段 E【新發現的缺口】：FineTuneProposals（主表，「步驟 3：
    // 套用修改申報」用嘅暫存區）同 FineTuneProposals_Archive（歷史批次封存表，
    // 見 archiveOldProposals_()）兩張表都有 QuarterID 欄，但之前呢個工具完全
    // 冇檢查過。主表通常會自然清空（每次套用新一批就搬走舊嘅），但封存表
    // 只會不斷累積、永遠唔會自動清，測試季度反覆套用申報留低嘅殘留會一直
    // 留喺度。
    fineTuneProposalRows: 0,
    fineTuneProposalArchiveRows: 0,
    // 第十二輪批次階段 D：呢一季有冇發佈過公開職事表（PublicLinks）。
    // 有嘅話，執行階段會**清空檔案內容**（顯示「已重設」提示）但**唔會
    // 刪除檔案／PublicLinks 紀錄**，理由見 clearPublicRosterOnQuarterReset_()
    // 檔頭說明。呢度只負責喺計畫階段查一次（唔寫入任何嘢），俾確認畫面
    // 可以話畀幹事知呢一項將會發生。
    publicLinkFileUrl: '',
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
        plan.unavailableManualDetails.push({
          personId: String(row[U.PERSON_ID] || '').trim(),
          dateFrom: dateFrom,
          dateTo: toDateString(row[U.DATE_TO], timezone),
          source: String(row[U.SOURCE] || '').trim() || '（空白）',
          appliesTo: String(row[U.APPLIES_TO] || '').trim(),
          postIds: String(row[U.POST_IDS] || '').trim(),
          status: String(row[U.STATUS] || '').trim()
        });
      }
    });
    if (plan.unavailableManualRows > 0) {
      plan.manualAttention.push('Unavailable 有 ' + plan.unavailableManualRows
        + ' 行落在這一季、但 Source 不是 REQUEST（即幹事人手輸入的不可服侍日），'
        + '一律保留不清——程式無法分辨哪一行是真實請假、哪一行是測試時打的。'
        + '下面已逐行列出，請自己看一次，測試資料請自行到 Unavailable 刪除，'
        + '否則重新生成時系統會繼續避開這些人。');
    }
  }

  // ---- Eligibility：由「指定服侍」申報自動加入的行（不清，但一定要講）----
  // 這一項是階段 B2 逐項確認「清乾淨之後重新生成會不會有殘留影響」時發現的：
  // 步驟 3 套用「指定服侍」申報時，如果申報的人未曾做過該崗位，
  // writeNewEligibilityRows_() 會在 Eligibility 新增一行（Source=REQUEST、
  // HistoricalCount=0）。這一行**不屬於任何季度**，重設季度不會碰到它，
  // 於是它會永久留下來、影響之後每一季的生成結果——那個人從此對那個崗位
  // 變成合資格，而且因為 HistoricalCount=0，還會輕微改變配額與選人分數的正規化。
  try {
    const E = COLUMNS.ELIGIBILITY;
    readSheet(SHEETS.ELIGIBILITY).forEach(function (row) {
      if (String(row[E.SOURCE] || '').trim().toUpperCase() !== 'REQUEST') return;
      // 第二十二輪批次階段 B1／B2：Active 是 boolean，之前用
      // `String(row[E.ACTIVE] || '').trim()` 會把 `false` 吞成空字串
      // （`false || '' → ''`），畫面印出「Active=」睇落好似冇值。
      // AddedAt 是 Date 物件，之前直接 `String(dateObj)` 會印出完整
      // 帶時區嘅英文長格式；改用 toDateString()（系統寫入嘅資料，
      // 讀取路徑用寬鬆嘅那個函式，見它自己的檔頭說明）輸出 yyyy-MM-dd。
      plan.eligibilityRequestRows.push({
        eligibilityId: String(row[E.ELIGIBILITY_ID] || '').trim(),
        personId: String(row[E.PERSON_ID] || '').trim(),
        postId: String(row[E.POST_ID] || '').trim(),
        active: displayCellValue_(row[E.ACTIVE]),
        addedAt: toDateString(row[E.ADDED_AT], timezone)
      });
    });
    if (plan.eligibilityRequestRows.length > 0) {
      plan.manualAttention.push('Eligibility 有 ' + plan.eligibilityRequestRows.length
        + ' 行是由「指定服侍」申報自動加入的（Source=REQUEST）。'
        + 'Eligibility 屬於人員基礎資料，本工具絕對不碰——但這些行會繼續影響'
        + '重新生成的結果（那個人從此對那個崗位算合資格）。'
        + '如果是測試時亂填出來的，請自己到 Eligibility 把該行 Active 改成 FALSE 或刪除；'
        + '如果是真實的資格變更，就保留。下面已逐行列出。');
    }
  } catch (err) {
    plan.manualAttention.push('Eligibility 讀取失敗，無法檢查「指定服侍自動加入」的行：' + err.message);
  }

  // ---- RosterPDF 資料夾 ----
  // 第二十二輪批次階段 B3：哪些版本號要清，只信一個來源——上面已經算好的
  // `versionNosToClear`（已經排除咗 v0＝不清、Protected=TRUE 嘅版本）。
  // 之前呢度自己重新寫一次 `versionNo === 0 && !plan.includeV0`，完全冇理
  // Protected，結果係受保護版本嘅版本登記、grid、RosterAssignments 三樣都
  // 保得住，但佢嘅 PDF 會被當普通版本清走——保護做咗一半。
  // 同一個判斷寫兩次、兩邊漂移，係本專案已經燒過幾次嘅 bug class
  // （第十九輪「兩個真相來源」同源），所以呢度改成直接重用
  // `versionNosToClear`，唔再自己判斷一次。
  try {
    const pattern = new RegExp('^' + escapeRegExp_(quarterId) + '_v(\\d+)');
    // 第二十六輪批次階段 B：經共用入口，根資料夾同「季度 ▸ 版本」子資料夾
    // 都會掃到。自己 getFiles() 嘅話會漏掉子資料夾入面嗰批，
    // 而重設之後嗰啲舊 PDF 仍然留喺度，下一次生成就會撈亂新舊。
    listRosterPdfFilesForQuarter_(quarterId).forEach(function (file) {
      const match = pattern.exec(file.name);
      if (!match) return;                          // 其他季度或不明檔案：不碰
      const versionNo = Number(match[1]);
      if (!versionNosToClear[versionNo]) return;   // v0（未選）或受保護版本：不清
      plan.pdfFiles.push({ id: file.id, name: file.name, sizeBytes: file.sizeBytes });
    });
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

  // ---- PublicLinks（第十二輪批次階段 D）----
  // 刻意唔用 PublicRoster.gs 嗰個共用嘅查詢入口——嗰個入口為咗
  // first-run 安全會喺讀取前順手確保工作表存在，全新環境下第一次呼叫
  // 可能因此建立一張新工作表。呢個 plan 函式必須保持零寫入，所以自己做
  // 一次唔會建表嘅唯讀查詢：工作表本身都未存在就直接當「呢一季冇發佈過」。
  try {
    const publicLinksSheet = ss.getSheetByName(SHEETS.PUBLIC_LINKS);
    if (publicLinksSheet) {
      const C = COLUMNS.PUBLIC_LINKS;
      const row = readSheet(SHEETS.PUBLIC_LINKS).find(function (r) {
        return String(r[C.QUARTER_ID] || '').trim() === quarterId;
      });
      if (row && String(row[C.FILE_ID] || '').trim()) {
        plan.publicLinkFileUrl = String(row[C.FILE_URL] || '').trim();
      }
    }
  } catch (err) {
    plan.manualAttention.push('檢查 PublicLinks（公開職事表）失敗，略過：' + err.message);
  }

  // ---- FineTuneProposals（主表）／FineTuneProposals_Archive（第十四輪批次階段 E 新增）----
  // 兩張表都有 QuarterID 欄，之前呢個工具完全冇檢查過（見上面 fineTuneProposalRows／
  // fineTuneProposalArchiveRows 嘅欄位說明）。主表通常唔會太大（每次套用新一批就
  // 自動搬走舊嘅，見 archiveOldProposals_()），但封存表只會不斷累積、需要按季度清。
  try {
    const FT = COLUMNS.FINE_TUNE_PROPOSALS;
    plan.fineTuneProposalRows = readSheet(SHEETS.FINE_TUNE_PROPOSALS).filter(function (row) {
      return String(row[FT.QUARTER_ID] || '').trim() === quarterId;
    }).length;
  } catch (err) {
    plan.manualAttention.push('檢查 FineTuneProposals 失敗，略過：' + err.message);
  }
  try {
    const ftArchiveSheet = ss.getSheetByName(FINETUNE_ARCHIVE_SHEET);
    if (ftArchiveSheet) {
      const FT = COLUMNS.FINE_TUNE_PROPOSALS;
      plan.fineTuneProposalArchiveRows = readSheet(FINETUNE_ARCHIVE_SHEET).filter(function (row) {
        return String(row[FT.QUARTER_ID] || '').trim() === quarterId;
      }).length;
    }
  } catch (err) {
    plan.manualAttention.push('檢查 FineTuneProposals_Archive 失敗，略過：' + err.message);
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
    fineTuneProposalRowsDeleted: 0, fineTuneProposalArchiveRowsDeleted: 0,
    pdfTrashed: 0, stageReset: false, publicRosterCleared: false, errors: []
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
      + '　FineTuneProposals=' + plan.fineTuneProposalRows + ' 行'
      + '　FineTuneProposals_Archive=' + plan.fineTuneProposalArchiveRows + ' 行'
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

  // ---- FineTuneProposals（主表）／FineTuneProposals_Archive（第十四輪批次階段 E 新增）----
  result.fineTuneProposalRowsDeleted = deleteRowsMatching_(SHEETS.FINE_TUNE_PROPOSALS, function (record) {
    return String(record[COLUMNS.FINE_TUNE_PROPOSALS.QUARTER_ID] || '').trim() === plan.quarterId;
  }, result.errors);
  if (ss.getSheetByName(FINETUNE_ARCHIVE_SHEET)) {
    result.fineTuneProposalArchiveRowsDeleted = deleteRowsMatching_(FINETUNE_ARCHIVE_SHEET, function (record) {
      return String(record[COLUMNS.FINE_TUNE_PROPOSALS.QUARTER_ID] || '').trim() === plan.quarterId;
    }, result.errors);
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

  // ---- 公開職事表（第十二輪批次階段 D）----
  // 只喺 plan 階段已經確認呢一季有發佈紀錄先嘗試——見
  // clearPublicRosterOnQuarterReset_()（PublicRoster.gs）檔頭嘅決策說明：
  // 唔刪除檔案／PublicLinks 紀錄，只清空內容做「已重設」提示。
  if (plan.publicLinkFileUrl) {
    try {
      result.publicRosterCleared = clearPublicRosterOnQuarterReset_(plan.quarterId);
    } catch (err) {
      result.errors.push('清空公開職事表失敗：' + err.message);
    }
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

/* ═════════════════════════════════════════════════════════════════════
 * 第四十七輪批次 E 組：**沙盒季度批次清理。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 一次只食一個 QuarterID 嘅時候，清四季就要由頭做四次：
 * 打 QuarterID ⇒ 揀 v0 ⇒ 睇清單 ⇒ 打「確認重設」。
 *
 * 做四次唔止係煩：**中間任何一次撳錯／睇漏，都冇一個總覽睇得返**。
 * 而每一次都要重新讀一次「呢一季會清乜」，前後對唔對得上，
 * 全靠幹事自己記住。
 *
 * ⚠️ 呢一組加嘅係**批次外殼**，唔係新嘅刪除邏輯。
 * 真正刪嘢嗰兩支（`planQuarterReset_()`／`executeQuarterReset_()`）
 * 一行都冇改——包括佢哋嗰啲「絕對不碰」嘅界線。
 */

/**
 * 「重設季度測試資料」絕對唔可以碰嘅季度（程式內建預設值）。
 *
 * ⚠️ 空白**唔會**變成「乜都唔擋」——見 `readQuarterResetBlockedQuarters_()`。
 * 語意同 `REHEARSAL_PROTECTED_QUARTERS` 一樣，但**另開一格**：
 * 嗰一個守嘅係「演練唔可以碰邊幾季」，呢一個守嘅係「清理唔可以清邊幾季」。
 */
const QUARTER_RESET_BLOCKED_DEFAULT = '2026T4';

/**
 * 讀「重設季度測試資料唔可以碰邊幾季」設定。
 *
 * ⚠️ 呢一格填成空白**仍然退回內建預設**。
 * 一格打空咗就冧晒保護，係最易誤觸嗰種——而呢一支係全系統
 * 最危險嘅功能之一，冧咗就係真係清走咗。
 * 想真正解除某一季嘅保護，只能把它由嗰一格移走。
 *
 * @returns {string[]} 季度 ID 陣列
 */
function readQuarterResetBlockedQuarters_() {
  let raw = '';
  try {
    raw = String(getConfig(CONFIG_KEYS.QUARTER_RESET_BLOCKED_QUARTERS,
      QUARTER_RESET_BLOCKED_DEFAULT) || '').trim();
  } catch (err) {
    raw = QUARTER_RESET_BLOCKED_DEFAULT;
  }
  if (raw === '') raw = QUARTER_RESET_BLOCKED_DEFAULT;
  return splitList_(raw);
}

/**
 * 把幹事打入去嗰串字拆成季度 ID 清單。**純函式。**
 *
 * @param {string} raw 例如 `2027T1, 2027T2，2027T3`
 * @returns {{quarterIds: string[], duplicates: string[]}}
 */
function parseQuarterResetBatchInput_(raw) {
  // `normalizeIdInput_()` 順手把全形逗號（U+FF0C）轉成半形——
  // 幹事用中文輸入法打，好自然就會打到全形。
  const text = normalizeIdInput_(raw);
  const quarterIds = [];
  const duplicates = [];
  text.split(',').forEach(function (piece) {
    const id = String(piece || '').trim().toUpperCase();
    if (id === '') return;
    // ⚠️ 重複要**報出嚟**，唔可以靜靜去重。
    // 靜靜去重嘅話，幹事以為佢揀咗三季，而畫面顯示兩季，
    // 佢會以為系統食咗一季。
    if (quarterIds.indexOf(id) !== -1) {
      if (duplicates.indexOf(id) === -1) duplicates.push(id);
      return;
    }
    quarterIds.push(id);
  });
  return { quarterIds: quarterIds, duplicates: duplicates };
}

/**
 * 把季度清單分成「可以清」同「受保護」兩堆。**純函式。**
 *
 * @param {string[]} quarterIds 要清嘅季度
 * @param {string[]} blockedQuarters 受保護嘅季度
 * @returns {{allowed: string[], blocked: string[]}}
 */
function splitQuarterResetTargets_(quarterIds, blockedQuarters) {
  const blocked = (blockedQuarters || []).map(function (q) {
    return String(q || '').trim().toUpperCase();
  });
  const out = { allowed: [], blocked: [] };
  (quarterIds || []).forEach(function (raw) {
    const id = String(raw || '').trim().toUpperCase();
    if (id === '') return;
    // ⚠️ 被擋嗰季要**明講**。靜靜略過嘅話，
    // 幹事以為清咗三季，而實際兩季，而佢唔會發現。
    if (blocked.indexOf(id) !== -1) out.blocked.push(id);
    else out.allowed.push(id);
  });
  return out;
}

/**
 * 把逐季嘅 plan 加埋成一份總覽。**純函式。**
 *
 * ⚠️ **逐季細項同總數兩樣都要有。**
 * 淨係一個總數嘅話，幹事睇唔出邊一季會清走乜，
 * 而佢要判斷嘅正正就係「呢一季係咪真係可以清」。
 *
 * @param {Array<{quarterId: string, plan: Object}>} entries 逐季嘅計畫
 * @returns {{perQuarter: Object[], totals: Object, nothingToDo: boolean}}
 */
function summariseQuarterResetBatch_(entries) {
  const perQuarter = [];
  const totals = {
    quarters: 0, versions: 0, assignmentRows: 0, sendLogRows: 0,
    requestRows: 0, unavailableRequestRows: 0,
    fineTuneProposalRows: 0, fineTuneProposalArchiveRows: 0,
    pdfFiles: 0, manualAttention: 0
  };

  (entries || []).forEach(function (entry) {
    const plan = entry.plan || {};
    const item = {
      quarterId: entry.quarterId,
      quarterStage: plan.quarterStage || '（讀取不到）',
      versions: (plan.versions || []).length,
      versionLabels: (plan.versions || []).map(function (v) { return 'v' + v.versionNo; }),
      assignmentRows: plan.assignmentRows || 0,
      sendLogRows: plan.sendLogRows || 0,
      requestRows: plan.requestRows || 0,
      unavailableRequestRows: plan.unavailableRequestRows || 0,
      fineTuneProposalRows: plan.fineTuneProposalRows || 0,
      fineTuneProposalArchiveRows: plan.fineTuneProposalArchiveRows || 0,
      pdfFiles: (plan.pdfFiles || []).length,
      manualAttention: (plan.manualAttention || []).slice()
    };
    perQuarter.push(item);

    totals.quarters += 1;
    totals.versions += item.versions;
    totals.assignmentRows += item.assignmentRows;
    totals.sendLogRows += item.sendLogRows;
    totals.requestRows += item.requestRows;
    totals.unavailableRequestRows += item.unavailableRequestRows;
    totals.fineTuneProposalRows += item.fineTuneProposalRows;
    totals.fineTuneProposalArchiveRows += item.fineTuneProposalArchiveRows;
    totals.pdfFiles += item.pdfFiles;
    totals.manualAttention += item.manualAttention.length;
  });

  const nothingToDo = totals.versions === 0 && totals.assignmentRows === 0
    && totals.sendLogRows === 0 && totals.requestRows === 0
    && totals.unavailableRequestRows === 0 && totals.fineTuneProposalRows === 0
    && totals.fineTuneProposalArchiveRows === 0 && totals.pdfFiles === 0;

  return { perQuarter: perQuarter, totals: totals, nothingToDo: nothingToDo };
}

/**
 * 逐季執行清理。**每一季獨立 try/catch，獨立寫 AuditLog。**
 *
 * ⚠️ 一季爆咗就成批停低嘅話，會變成「前面清咗一半、後面完全冇做」，
 * 而幹事唔知停咗喺邊。所以爆咗嗰季記低，繼續做下一季。
 *
 * ⚠️ 每一季寫**兩次** AuditLog：做之前一次、做之後一次。
 * 只有 before 嘅話，「打算清」同「實際清咗」永遠對唔到帳——
 * 一季中途爆咗，AuditLog 睇落同成功一模一樣。
 *
 * @param {Array<{quarterId: string, plan: Object}>} entries 逐季嘅計畫
 * @returns {{results: Object[], failedQuarters: string[]}}
 */
function executeQuarterResetBatch_(entries) {
  const results = [];
  const failedQuarters = [];

  (entries || []).forEach(function (entry) {
    const quarterId = entry.quarterId;
    const plan = entry.plan;

    // ── 做之前 ────────────────────────────────────────────────
    try {
      writeAuditLog_({
        action: 'QUARTER_RESET_BATCH_BEFORE',
        targetSheet: '（多張）',
        targetKey: quarterId,
        oldValue: 'Stage=' + (plan.quarterStage || '?')
          + '　版本=' + (plan.versions || []).map(function (v) {
            return 'v' + v.versionNo;
          }).join(',')
          + '　RosterAssignments=' + (plan.assignmentRows || 0) + ' 行'
          + '　SendLog=' + (plan.sendLogRows || 0) + ' 行'
          + '　PDF=' + (plan.pdfFiles || []).length + ' 個',
        newValue: '（準備清理）',
        source: 'executeQuarterResetBatch_',
        notes: '批次清理，這一批共 ' + (entries || []).length + ' 季'
      });
    } catch (err) {
      // AuditLog 寫唔到唔應該擋住清理本身——但要記低。
      log_('ERROR', 'QUARTER_RESET_BATCH_BEFORE 寫入失敗（' + quarterId + '）: ' + err.message);
    }

    // ── 真正做 ────────────────────────────────────────────────
    try {
      const result = executeQuarterReset_(plan);
      results.push({ quarterId: quarterId, ok: true, result: result, error: '' });

      try {
        writeAuditLog_({
          action: 'QUARTER_RESET_BATCH_AFTER',
          targetSheet: '（多張）',
          targetKey: quarterId,
          oldValue: '（見同一季的 QUARTER_RESET_BATCH_BEFORE）',
          newValue: 'RosterVersions=' + result.versionRowsDeleted + ' 行'
            + '　grid=' + result.versionSheetsDeleted + ' 張'
            + '　RosterAssignments=' + result.assignmentRowsDeleted + ' 行'
            + '　SendLog=' + result.sendLogRowsDeleted + ' 行'
            + '　PDF=' + result.pdfTrashed + ' 個已移到垃圾桶',
          source: 'executeQuarterResetBatch_',
          notes: (result.errors || []).length > 0
            ? '過程中有 ' + result.errors.length + ' 項出錯：' + result.errors.join('；')
            : '沒有出錯'
        });
      } catch (err) {
        log_('ERROR', 'QUARTER_RESET_BATCH_AFTER 寫入失敗（' + quarterId + '）: ' + err.message);
      }
    } catch (err) {
      log_('ERROR', 'executeQuarterReset_ 失敗（' + quarterId + '）: ' + err.message);
      failedQuarters.push(quarterId);
      results.push({ quarterId: quarterId, ok: false, result: null, error: err.message });

      // ⚠️ 爆咗嗰季**都要寫低**。靜靜冇咗嘅話，
      // AuditLog 上面呢一季就只有一句「準備清理」，
      // 而冇人知佢到底清咗幾多先至爆。
      try {
        writeAuditLog_({
          action: 'QUARTER_RESET_BATCH_FAILED',
          targetSheet: '（多張）',
          targetKey: quarterId,
          oldValue: '（見同一季的 QUARTER_RESET_BATCH_BEFORE）',
          newValue: '中途失敗',
          source: 'executeQuarterResetBatch_',
          notes: '錯誤訊息：' + err.message
            + '　⚠️ 部分內容可能已經被清走，請對照 BEFORE 那一筆檢查'
        });
      } catch (err2) {
        log_('ERROR', 'QUARTER_RESET_BATCH_FAILED 寫入失敗（' + quarterId + '）: ' + err2.message);
      }
    }
  });

  return { results: results, failedQuarters: failedQuarters };
}
