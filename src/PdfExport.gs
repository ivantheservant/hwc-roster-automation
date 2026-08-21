/**
 * 匯出整季完整版職事表 PDF，存入 Config 的 ROSTER_DRIVE_FOLDER_ID 資料夾。
 * 選單「匯出 PDF」用的公開入口；供電郵附件用的路徑見 generateMailAttachment_()。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @param {number} versionNo 版本號
 * @returns {{fileId: string, fileName: string, folderName: string}} 產生的檔案資訊
 */
function exportRosterPdf(quarterId, versionNo) {
  const built = buildFullRosterPdfBlob_(quarterId, versionNo);
  return saveBlobToRosterFolder_(built.blob);
}

/**
 * 產生整季完整版職事表 PDF 的 blob，不寫入 Drive。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{blob: Blob, fileName: string}} PDF 內容與檔名
 */
function buildFullRosterPdfBlob_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const fileName = buildAttachmentName_(quarterId, versionNo, GRID_LABELS.FULL_VERSION);
  // 第四十一輪批次 F 組：只印職事表本身（見 `resolveRosterOnlyExportOpts_()`）。
  const exported = exportSheetAsPdfBlob_(sheet, fileName, resolveRosterOnlyExportOpts_(sheet));
  return { blob: exported.blob, fileName: fileName, retries: exported.retries };
}

/**
 * 匯出個人版職事表 PDF，存入 Config 的 ROSTER_DRIVE_FOLDER_ID 資料夾（一般後備邏輯）。
 * 選單「匯出 PDF」用的公開入口；供電郵附件用的路徑見 generateMailAttachment_()，
 * 該路徑改用 resolveMailAttachmentFolder_() 強制要求 Shared Drive。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personId 對象的 PersonID
 * @returns {{fileId: string, fileName: string, folderName: string}} 產生的檔案資訊
 */
function exportPersonalPdf(quarterId, versionNo, personId) {
  const built = buildPersonalPdfBlob_(quarterId, versionNo, personId);
  const saved = saveBlobToRosterFolder_(built.blob);
  saved.highlighted = built.highlighted;
  saved.personName = built.personName;
  return saved;
}

/**
 * 產生個人版職事表 PDF 的 blob，不寫入 Drive：先複製一份 grid 工作表，
 * 把該人的格加上底色，匯出後刪除暫存工作表。是否加底色由 Config 的
 * ATTACH_HIGHLIGHT_PERSONAL 決定。供 exportPersonalPdf()（選單）與
 * generateMailAttachment_()（電郵附件）共用，避免重複實作 highlight／匯出邏輯。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personId 對象的 PersonID
 * @param {Object[]=} versionAssignments 選填，已篩到這個 quarterId／versionNo 的
 *   RosterAssignments 原始列，原封不動轉傳給 locatePersonCells_()。批次產生多人 PDF
 *   時（見 PdfBatch.gs 的 generatePersonalPdfBatch_()）由外層讀一次、所有人共用，
 *   避免每人各自重讀一次整份 RosterAssignments。不傳時完全比照原本行為。
 * @returns {{blob: Blob, fileName: string, highlighted: number, personName: string,
 *   retries: number, highlightMs: number, exportMs: number}} PDF 內容與相關資訊，
 *   highlightMs／exportMs 分開量度「定位＋複製工作表＋上色＋flush」與「呼叫匯出」各花多少時間
 */
function buildPersonalPdfBlob_(quarterId, versionNo, personId, versionAssignments, renderContext) {
  // 沒有傳入共用 context 時（例如選單「匯出 PDF」單獨匯出一人），自己開一個、
  // 用完即關，行為與階段 B 之前完全一致。批次產生多人時由呼叫端開一次共用，
  // 避免每人各自複製與刪除一次工作表——那是實測最慢的一步，見
  // openPersonalPdfRenderContext_() 的說明。
  const ownContext = !renderContext;
  const ctx = renderContext || openPersonalPdfRenderContext_(quarterId, versionNo);

  try {
    const personName = lookupPersonName_(personId);
    const fileName = buildAttachmentName_(quarterId, versionNo, personName);

    const highlightStart = Date.now();

    // 上色前先確認找得到格子，同時直接沿用這次定位的結果去上色，不必再定位第二次
    // （原本這裡只做存在性檢查，實際上色時 highlightPersonCells_() 內部會重新呼叫
    // 一次 locatePersonCells_()，等於同一個人定位兩次；在複製出來的 tempSheet 上定位
    // 跟在原本的 sheet 上定位結果一致，因為 copyTo() 是當下內容的完整快照，而兩次定位
    // 之間完全沒有任何程式碼寫入過原本的 sheet，所以在複製前先定位、把結果沿用到
    // 複製後的 tempSheet，跟原本「複製後才定位」是等價的）
    let located = null;
    if (ctx.wantHighlight) {
      located = locatePersonCells_(
        ctx.sourceSheet, quarterId, versionNo, personId, versionAssignments, ctx.gridIndex);
      if (located.matched.length === 0) {
        throw new Error(
          '在 ' + ctx.sheetName + ' 中找不到 ' + personName + '（' + personId + '）的任何一格。\n'
            + '已掃描 ' + located.scanned + ' 格資料。\n'
            + '請確認該人在這一版有被派工；可執行 debugPersonalHighlight() 查看詳情。'
        );
      }
    }

    let marked = 0;
    if (ctx.wantHighlight) {
      marked = applyPersonHighlightToContext_(ctx, located.matched);
    }
    // 匯出走 UrlFetchApp 讀伺服器上的檔案，必須先把待寫入的格式提交，
    // 否則匯出的會是未上色的版本（這是先前 highlight 完全沒生效的原因）
    SpreadsheetApp.flush();
    const highlightMs = Date.now() - highlightStart;

    const exportStart = Date.now();
    // 第四十一輪批次 F 組：個人版都一樣只印職事表本身。
    // ⚠️ 用 `ctx.rosterOnlyOpts`（開 context 那一次算好），
    // 不是每個人各自再掃一次第一欄——幾十個人就是幾十次讀表，
    // 而那條路本來就已經接近執行上限。
    const exported = exportSheetAsPdfBlob_(ctx.tempSheet, fileName, ctx.rosterOnlyOpts);
    const exportMs = Date.now() - exportStart;

    return {
      blob: exported.blob, fileName: fileName, highlighted: marked, personName: personName,
      retries: exported.retries, highlightMs: highlightMs, exportMs: exportMs
    };
  } finally {
    if (ownContext) ctx.close();
  }
}

/**
 * 階段 B 新增：開一個可以連續產生多人個人 PDF 的「渲染 context」。
 *
 * 效能分析（階段 B）：實測 58 人約 15 分鐘、每人約 4 秒花在「highlight」這一段，
 * 而真正匯出只需約 0.8 秒。逐行追查後，慢的並不是 Ivan 提示的三個方向：
 * - `highlightPersonCells_()` 本來就已經是 `setBackgrounds()`／`setFontWeights()`
 *   批次寫入，不是逐格 `setBackground()`
 * - `locatePersonCells_()` 的 RosterAssignments 重讀，追加階段 E 已經用
 *   `versionAssignments` 解決
 * - `SpreadsheetApp.flush()` 每人一次是必需的（不 flush 匯出到的會是未上色的版本）
 *
 * 真正的瓶頸是**每個人都複製一次整張工作表再刪除一次**（`sheet.copyTo()` ＋
 * `ss.deleteSheet()`），加上每人各自把整個資料區的底色與字重**讀出來再寫回去**
 * （`getBackgrounds()`／`getFontWeights()`／`setBackgrounds()`／`setFontWeights()`
 * 各一次，13×24 = 312 格）。`copyTo()` 要複製全部值、格式、批註、欄寬，是 Sheets
 * 最慢的操作之一，58 人就是 58 次複製 ＋ 58 次刪除。
 *
 * 這個 context 把「複製工作表、隱藏機器鍵行、讀取格線索引、讀取底色與字重基準」
 * 全部改成**整批只做一次**，之後每個人只需要：寫底色、寫字重、flush、匯出。
 * 每人的寫入一律由「基準 ＋ 這個人的格」重新組成，所以上一個人的 highlight 會
 * 自動被覆蓋掉，不需要額外的還原步驟。
 *
 * 視覺效果完全不變：底色仍然是 `GRID_COLORS.PERSONAL_HIGHLIGHT`、字重仍然是 bold、
 * 其他格仍然保留原有底色（因為基準就是複製出來那一刻的實際底色）。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} context，用完必須呼叫 close() 刪除暫存工作表
 */
function openPersonalPdfRenderContext_(quarterId, versionNo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const wantHighlight = getConfig(CONFIG_KEYS.ATTACH_HIGHLIGHT_PERSONAL, false) === true;
  const gridIndex = wantHighlight ? buildGridIndex_(sheet) : null;

  const tempSheet = sheet.copyTo(ss).setName(SHEET_PREFIXES.TEMP_PDF + 'batch_' + Date.now());
  tempSheet.hideRows(2);

  let dataRange = null;
  let baseBackgrounds = null;
  let baseWeights = null;
  if (wantHighlight) {
    const lastRow = tempSheet.getLastRow();
    const lastCol = tempSheet.getLastColumn();
    if (lastRow >= 3 && lastCol >= 1) {
      dataRange = tempSheet.getRange(3, 1, lastRow - 2, lastCol);
      baseBackgrounds = dataRange.getBackgrounds();
      baseWeights = dataRange.getFontWeights();
    }
  }

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    sheetName: sheetName,
    sourceSheet: sheet,
    tempSheet: tempSheet,
    wantHighlight: wantHighlight,
    gridIndex: gridIndex,
    // 第四十一輪批次 F 組：整批只算一次，之後每個人共用。
    rosterOnlyOpts: resolveRosterOnlyExportOpts_(tempSheet),
    dataRange: dataRange,
    baseBackgrounds: baseBackgrounds,
    baseWeights: baseWeights,
    close: function () {
      try {
        ss.deleteSheet(tempSheet);
      } catch (err) {
        log_('WARN', 'openPersonalPdfRenderContext_.close 刪除暫存工作表失敗：' + err.message);
      }
    }
  };
}

/**
 * 階段 B 新增：把某一個人的格子套用到 context 的暫存工作表上。
 *
 * 每次都由「基準底色／字重」重新組成整個資料區再寫回去——所以上一個人的 highlight
 * 會被這一次覆蓋掉，不需要額外的還原步驟，也不會出現「上一個人的顏色殘留在這個人的
 * PDF 上」這種錯誤。基準本身是複製工作表那一刻的實際格式，所以其他格（例如灰色的
 * 待確認格）一律原樣保留，視覺效果與階段 B 之前完全一致。
 *
 * @param {Object} ctx openPersonalPdfRenderContext_() 的結果
 * @param {Object[]} matched locatePersonCells_() 回傳的 matched 陣列
 * @returns {number} 已標示的格數
 */
function applyPersonHighlightToContext_(ctx, matched) {
  if (!ctx.dataRange || matched.length === 0) return 0;

  const backgrounds = ctx.baseBackgrounds.map(function (row) { return row.slice(); });
  const weights = ctx.baseWeights.map(function (row) { return row.slice(); });

  let applied = 0;
  matched.forEach(function (cell) {
    const r = cell.row - 3;
    const c = cell.column - 1;
    if (r < 0 || r >= backgrounds.length || c < 0 || c >= backgrounds[r].length) return;
    backgrounds[r][c] = GRID_COLORS.PERSONAL_HIGHLIGHT;
    weights[r][c] = 'bold';
    applied++;
  });

  ctx.dataRange.setBackgrounds(backgrounds);
  ctx.dataRange.setFontWeights(weights);
  return applied;
}

/**
 * 階段 B 新增：把 grid 工作表的「機器鍵欄對照」與「日期列對照」讀出來，
 * 供 locatePersonCells_() 重用。批次產生多人 PDF 時，這兩份索引對每個人都一樣，
 * 原本卻是每個人各自讀一次整個資料區（13×24 格）再重建一次。
 * @param {Sheet} sheet 要建索引的 grid 工作表
 * @returns {?{keys: Array, columnByKey: Object, rowByDate: Object, values: Array, scanned: number}}
 *   資料不足以建索引時回傳 null
 */
function buildGridIndex_(sheet) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol < 4) return null;

  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const columnByKey = {};
  keys.forEach(function (key, i) {
    if (key) columnByKey[String(key)] = i + 1;
  });

  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const rowByDate = {};
  values.forEach(function (row, i) {
    const dateStr = toDateString(row[0], timezone);
    if (dateStr) rowByDate[dateStr] = i + 3;
  });

  const dataColumns = keys.filter(function (k) { return String(k || '').indexOf('#') !== -1; }).length;
  return {
    keys: keys,
    columnByKey: columnByKey,
    rowByDate: rowByDate,
    values: values,
    scanned: Object.keys(rowByDate).length * dataColumns
  };
}

/**
 * 找出指定人員在 grid 工作表上佔用了哪些格子，但不改動工作表。
 *
 * 主要方法是用 RosterAssignments 的 PersonID 定位（第 2 行機器鍵 + 第 1 欄日期），
 * 這比姓名文字比對可靠。若該版本的長表沒有紀錄（例如 grid 被人手改過），
 * 則退回以 PersonID 反查姓名，再用姓名文字掃描整個 grid。
 *
 * @param {Sheet} sheet 要掃描的工作表
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personId 對象的 PersonID
 * @param {Object[]=} versionAssignments 選填，已經篩到這個 quarterId／versionNo 的
 *   RosterAssignments 原始列（readSheet() 的物件格式）。批次產生多人 PDF 時
 *   （見 PdfBatch.gs），58 個人各自呼叫這個函式都要重讀一次整份 RosterAssignments，
 *   實測是「略過已存在」以外、另一個沒被注意到的效能熱點；改成外面只讀一次、
 *   篩到這個版本，傳進來讓每個人共用，這裡只需要再篩 PersonID。不傳這個參數時
 *   完全比照原本的行為，自己讀一次、篩三個條件，供其他呼叫端（例如選單「匯出 PDF」
 *   單獨匯出一人、debugPersonalHighlight() 診斷）維持不變。
 * @returns {{personName: string, scanned: number, matched: Object[], method: string}}
 *   matched 每項為 {row, column, key}
 */
function locatePersonCells_(sheet, quarterId, versionNo, personId, versionAssignments, gridIndex) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const personName = lookupPersonName_(personId);
  const empty = { personName: personName, scanned: 0, matched: [], method: 'NONE' };

  // 階段 B：批次產生多人 PDF 時，格線索引對每個人都一樣，由呼叫端建一次共用
  // （見 buildGridIndex_()）；不傳時自己建一次，行為與階段 B 之前完全一致。
  const index = gridIndex || buildGridIndex_(sheet);
  if (!index) return empty;

  const keys = index.keys;
  const columnByKey = index.columnByKey;
  const values = index.values;
  const rowByDate = index.rowByDate;
  const scanned = index.scanned;

  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const sourceRows = versionAssignments || readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
  });
  const mine = sourceRows.filter(function (row) {
    return row[C.PERSON_ID] === personId;
  });

  const matched = [];
  mine.forEach(function (row) {
    const dateStr = toDateString(row[C.SERVICE_DATE], timezone);
    const key = row[C.POST_ID] + '#' + row[C.SLOT_INDEX];
    const r = rowByDate[dateStr];
    const c = columnByKey[key];
    if (r && c) matched.push({ row: r, column: c, key: key });
  });

  if (matched.length > 0) {
    return { personName: personName, scanned: scanned, matched: matched, method: 'PERSON_ID' };
  }

  // 退回姓名文字比對：處理 grid 被人手改動但長表未更新的情況
  const byName = [];
  values.forEach(function (row, rowOffset) {
    for (let c = 0; c < keys.length; c++) {
      if (String(keys[c] || '').indexOf('#') === -1) continue;
      if (String(row[c] || '').trim() === personName) {
        byName.push({ row: rowOffset + 3, column: c + 1, key: String(keys[c]) });
      }
    }
  });

  return {
    personName: personName,
    scanned: scanned,
    matched: byName,
    method: byName.length > 0 ? 'NAME_TEXT' : 'NONE'
  };
}

/*
 * 階段 B 註記：原本這裡有一個 highlightPersonCells_(sheet, matched)，每個人各自
 * 讀一次整個資料區的底色與字重、改幾格、再寫回去。已由
 * applyPersonHighlightToContext_() 取代——後者用整批只讀一次的基準重新組成，
 * 每人省掉兩次整區讀取。視覺輸出完全相同（同一個底色常數、同樣 bold、
 * 同樣保留其他格原有底色），只是不再重複讀取。
 */

/**
 * 診斷用：印出個人版 highlight 的定位結果，不會改動任何工作表。
 * 在 Apps Script 編輯器直接執行，然後看「執行紀錄」。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @param {number} versionNo 版本號
 * @param {string} personId 對象的 PersonID，例如 "P0001"
 * @returns {Object} 定位結果，同時已寫入 Logger
 */
function debugPersonalHighlight(quarterId, versionNo, personId) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    log_('ERROR', 'debugPersonalHighlight: 找不到工作表 ' + sheetName);
    return null;
  }

  const located = locatePersonCells_(sheet, quarterId, versionNo, personId);
  const lines = [
    '=== debugPersonalHighlight ===',
    '工作表：' + sheetName,
    'PersonID：' + personId,
    '反查到的姓名：' + (located.personName || '（查不到，NameMapping 沒有此 PersonID）'),
    'ATTACH_HIGHLIGHT_PERSONAL：' + getConfig(CONFIG_KEYS.ATTACH_HIGHLIGHT_PERSONAL, false),
    '掃描了 ' + located.scanned + ' 格',
    '命中 ' + located.matched.length + ' 格',
    '定位方式：' + located.method
      + (located.method === 'PERSON_ID' ? '（用 RosterAssignments 的 PersonID）'
        : located.method === 'NAME_TEXT' ? '（長表無紀錄，改用姓名文字比對）'
        : '（完全找不到）')
  ];

  located.matched.forEach(function (cell) {
    lines.push('  命中：第 ' + cell.row + ' 行、第 ' + cell.column + ' 欄　' + cell.key
      + '　內容「' + sheet.getRange(cell.row, cell.column).getValue() + '」');
  });

  if (located.matched.length === 0) {
    lines.push('  → 請確認此人在 ' + quarterId + ' v' + versionNo + ' 有被派工，');
    lines.push('     或 RosterAssignments 中該版本的 PersonID 欄是否真的是 ' + personId);
  }

  Logger.log(lines.join('\n'));
  return located;
}

/**
 * 依 Config 的 ATTACH_PAGE_ORIENTATION 把單一工作表匯出為 PDF blob。
 * 遇到 HTTP 429／5xx 會自動重試（見 fetchWithRetry_），仍失敗才拋出例外。
 * @param {Sheet} sheet 要匯出的工作表
 * @param {string} fileName 檔案名稱（含副檔名）
 * @returns {{blob: Blob, retries: number}} PDF 內容與實際重試次數
 */
function exportSheetAsPdfBlob_(sheet, fileName, opts) {
  const orientation = String(getConfig(CONFIG_KEYS.ATTACH_PAGE_ORIENTATION, PAGE_ORIENTATION.LANDSCAPE)).toUpperCase();
  const isPortrait = orientation === PAGE_ORIENTATION.PORTRAIT;
  const ssId = sheet.getParent().getId();

  // ⚠️ 第四十一輪批次 F 組：只印到第 `opts.lastRow` 行為止。
  //
  // Google 匯出網址的 `r1`／`r2` 是 **0-based、右邊開區間**，
  // 所以「印到第 N 行」＝ `r1=0&r2=N`。差一格就會少印最後一個主日，
  // 而那種錯在 PDF 上看起來完全正常（只是少了一行）。
  //
  // ⚠️ 不傳 `opts` 的時候一個參數都不加——行為同今日一模一樣。
  const rangeParams = [];
  const lastRow = Number(opts && opts.lastRow);
  if (lastRow > 0) {
    rangeParams.push('r1=0');
    rangeParams.push('r2=' + Math.floor(lastRow));
  }

  // 注意：fitw 與 scale 是互相衝突的兩個縮放參數。
  // 同時指定 fitw=true 與 scale=4（fit to page）會過度壓縮，
  // 令標題文字的字框互相重疊，PDF 中看起來就像編號跑到了下一欄。
  // 這裡只用 fitw=true（縮到頁寬），縱向則讓它自然分頁。
  const params = [
    'format=pdf',
    'gid=' + sheet.getSheetId(),
    'portrait=' + (isPortrait ? 'true' : 'false'),
    'size=A4',
    'fitw=true',
    'gridlines=true',
    'printtitle=false',
    'sheetnames=false',
    'pagenumbers=true',
    'fzr=true',
    'top_margin=0.4',
    'bottom_margin=0.4',
    'left_margin=0.4',
    'right_margin=0.4'
  ].concat(rangeParams).join('&');

  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?' + params;
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const result = fetchWithRetry_(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  }, minBytes);

  if (result.responseCode !== 200) {
    const error = new Error('匯出 PDF 失敗，HTTP ' + result.responseCode
      + '（已重試 ' + result.retries + ' 次）'
      + (result.responseCode === 429
        ? '——Google 試算表匯出的速率限制，連續匯出大量 PDF 時常見。'
        : '（通常是尚未授權外部連線，請在編輯器手動執行一次並按「允許」）'));
    error.retries = result.retries;
    throw error;
  }
  // 追加階段 AG：HTTP 200 不保證內容正常——實測發現匯出服務偶爾會回傳 200
  // 但內容是空白或截斷的檔案（0 bytes），原本完全沒有檢查，會被當成成功存檔，
  // 靜靜產生一個打不開的 PDF。fetchWithRetry_() 已經把「200 但太小」納入同一套
  // 重試機制，這裡拿到的已經是重試過仍然太小的最終結果，一律當失敗。
  if (result.blobTooSmall) {
    const size = result.blob.getBytes().length;
    const error = new Error('匯出 PDF 內容過小（' + size + ' bytes，門檻 ' + minBytes + ' bytes），'
      + '已重試 ' + result.retries + ' 次仍然過小，懷疑 Google 試算表匯出服務暫時異常，內容可能空白或截斷。');
    error.retries = result.retries;
    throw error;
  }
  return { blob: result.blob.setName(fileName), retries: result.retries };
}

/**
 * 呼叫 UrlFetchApp.fetch()，遇到 429（速率限制）或 5xx（伺服器錯誤）時
 * 用指數退避自動重試。重試次數與初始間隔從 Config 讀取：
 * PDF_EXPORT_MAX_RETRIES（預設 4 次）、PDF_EXPORT_RETRY_DELAY_MS（預設 1000 毫秒，
 * 每次重試前的等待時間會倍增，例如 1s、2s、4s、8s）。
 * 其他狀態碼（例如 401/403/404）不重試，因為那是設定問題，重試也不會變好。
 *
 * 追加階段 AG：新增 minBytes 選填參數——HTTP 200 不保證內容正常，實測發現匯出
 * 服務偶爾會回傳 200 但內容是空白或截斷的檔案。傳入 minBytes 時，回應碼是 200
 * 但內容小於這個大小也會觸發重試（沿用同一套指數退避），跟 429／5xx 用同一個
 * 重試預算，不是另外疊加一輪。
 *
 * @param {string} url 要請求的網址
 * @param {Object} options UrlFetchApp.fetch() 的選項
 * @param {number=} minBytes 選填，內容最小大小（bytes）；不傳則不檢查內容大小
 * @returns {{responseCode: number, blob: Blob, retries: number, blobTooSmall: boolean}}
 *   最後一次嘗試的結果、實際重試次數；blobTooSmall 為 true 代表 responseCode=200
 *   但內容小於 minBytes、且已經重試到上限仍然過小
 */
function fetchWithRetry_(url, options, minBytes) {
  const maxRetries = Math.max(0, Math.round(
    getConfig(CONFIG_KEYS.PDF_EXPORT_MAX_RETRIES, DEFAULTS.PDF_EXPORT_MAX_RETRIES)));
  let delayMs = Math.max(0, Math.round(
    getConfig(CONFIG_KEYS.PDF_EXPORT_RETRY_DELAY_MS, DEFAULTS.PDF_EXPORT_RETRY_DELAY_MS)));

  let attempt = 0;
  while (true) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const blob = response.getBlob();
    const isHttpRetryable = code === 429 || (code >= 500 && code < 600);
    const isBlobTooSmall = code === 200 && minBytes > 0 && blob.getBytes().length < minBytes;
    const isRetryable = isHttpRetryable || isBlobTooSmall;

    if (!isRetryable || attempt >= maxRetries) {
      return { responseCode: code, blob: blob, retries: attempt, blobTooSmall: isBlobTooSmall };
    }

    log_('WARN', 'fetchWithRetry_: '
      + (isBlobTooSmall ? '內容過小（' + blob.getBytes().length + ' bytes，門檻 ' + minBytes + ' bytes）' : 'HTTP ' + code)
      + '，' + (delayMs / 1000) + ' 秒後重試（第 ' + (attempt + 1) + ' / ' + maxRetries + ' 次）');
    Utilities.sleep(delayMs);
    attempt++;
    delayMs *= 2;
  }
}

/**
 * 把 blob 存入 Config 的 ROSTER_DRIVE_FOLDER_ID 資料夾。
 * 該設定留空時，改存到本試算表所在的資料夾，並在 Logger 記錄提醒。
 * 同名檔案會被覆蓋（見 saveOrOverwriteFile_），不會每次執行都多一個檔案。
 * @param {Blob} blob 要儲存的檔案內容
 * @returns {{fileId: string, fileName: string, folderName: string}} 產生的檔案資訊
 */
function saveBlobToRosterFolder_(blob) {
  const folder = resolveRosterFolder_();
  const file = saveOrOverwriteFile_(folder, blob.getName(), blob);
  return { fileId: file.getId(), fileName: file.getName(), folderName: folder.getName() };
}

/**
 * 把 blob 存入指定資料夾；若已有同名檔案，確保執行完只留一份最新內容，
 * 不會每次執行都新增一個檔案。
 *
 * 用「先建立新檔、再清掉其他同名舊檔」而非「先清舊檔再建立」：
 * Google Drive 的檔名查詢（getFilesByName）不保證強一致性——剛建立的檔案
 * 有時要過一會才會出現在查詢結果。若先查再建，遇到這種延遲就會查不到
 * 剛建立的舊檔而漏刪，造成同名檔案越疊越多（這正是先前回報的「覆蓋沒有
 * 完全生效」）。改成先建立新檔（用 ID 直接鎖定，不受查詢延遲影響），
 * 再查一次同名清單、把「不是這次剛建的」全部清掉，新檔本身穩定存在，
 * 舊檔多半也已建立一段時間、查詢延遲的機率低很多。
 *
 * 用「移到垃圾桶」而非就地更新內容：DriveApp（基本服務）沒有提供
 * 覆寫既有檔案二進位內容的方法——File.setContent() 只接受純文字內容，
 * 不支援 PDF 這類二進位格式。若要真正就地更新，需要改用進階 Drive 服務，
 * 那需要你額外在 Apps Script 專案啟用，本次沒有要求就沒有加。
 * 「移到垃圾桶」是可復原的操作（Drive 垃圾桶保留期內可救回），不是永久刪除。
 *
 * @param {Folder} folder 目標資料夾
 * @param {string} fileName 檔案名稱
 * @param {Blob} blob 檔案內容
 * @returns {File} 新建立的檔案
 */
function saveOrOverwriteFile_(folder, fileName, blob) {
  const newFile = folder.createFile(blob.setName(fileName));

  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    const file = existing.next();
    if (file.getId() !== newFile.getId()) file.setTrashed(true);
  }

  return newFile;
}

/**
 * 追加階段 AG：核對「拋錯之後，檔案是不是其實已經成功建立」。
 *
 * 查證過的成因：DriveApp／試算表匯出服務偶爾會在動作其實已經完成之後，才在
 * 確認回應這一步拋出「Service error: Drive」之類的暫時性例外——`saveOrOverwriteFile_()`
 * 的 `folder.createFile()` 已經把檔案寫進 Drive，只是確認回應失敗，指令碼收到的
 * 是例外，不是成功，於是把一個其實正常的檔案誤記成失敗。
 *
 * 三個條件同時成立才算「其實成功」：檔案存在、大小不小於 PDF_MIN_SIZE_BYTES、
 * 而且是這次呼叫期間（sinceDate 之後）才建立或更新的——最後一點是關鍵，避免把
 * 資料夾裡剛好已經有的不相關舊檔（例如上次執行留下的、這次其實真的失敗）
 * 誤判成這次成功。三個條件有一個不成立，就不算成功，維持原本的失敗判定。
 *
 * @param {Folder} folder 目標資料夾
 * @param {string} fileName 檔案名稱
 * @param {Date} sinceDate 本次嘗試開始的時間，只有這之後才更新的檔案才算數
 * @returns {boolean} 是否確認其實已經成功
 */
function checkFileActuallySucceeded_(folder, fileName, sinceDate) {
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    const file = files.next();
    if (file.getLastUpdated().getTime() < sinceDate.getTime()) continue;
    if (file.getSize() < minBytes) continue;
    return true;
  }
  return false;
}

/**
 * 取得存放 PDF 的 Drive 資料夾。
 * 優先使用 Config 的 ROSTER_DRIVE_FOLDER_ID；未設定時退回本試算表所在的資料夾。
 * @returns {Folder} Drive 資料夾
 */
function resolveRosterFolder_() {
  const folderId = String(getConfig(CONFIG_KEYS.ROSTER_DRIVE_FOLDER_ID, '')).trim();
  if (folderId) return DriveApp.getFolderById(folderId);

  log_('WARN', 'Config 的 ROSTER_DRIVE_FOLDER_ID 未設定，PDF 改存到試算表所在的資料夾');
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const parents = ssFile.getParents();
  if (parents.hasNext()) return parents.next();
  return DriveApp.getRootFolder();
}

/**
 * 判斷資料夾是否為個人 My Drive（而非 Shared Drive）。
 * Shared Drive 上的檔案／資料夾沒有單一擁有者，getOwner() 會回傳 null；
 * 能取得擁有者就代表這是個人 My Drive 的資料夾。
 * @param {Folder} folder 要檢查的資料夾
 * @returns {boolean} 是否為個人 My Drive
 */
function isPersonalMyDriveFolder_(folder) {
  try {
    return !!folder.getOwner();
  } catch (err) {
    // 無法取得擁有者時（常見於 Shared Drive），視為非個人資料夾
    return false;
  }
}

/**
 * 取得寄送電郵附件專用的存放資料夾：一律讀取 Config 的 ROSTER_DRIVE_FOLDER_ID，
 * 且必須是 Shared Drive，不允許個人 My Drive（否則幹事換人或原擁有者移交帳號後會找不到檔案）。
 *
 * 與 resolveRosterFolder_() 不同，這裡沒有「找不到就退回試算表所在資料夾」的後備——
 * 那個後備很可能正正是個人 My Drive，會違反本要求。缺少設定時直接拋錯，
 * 讓呼叫端（deliverOne_）把它記為 ERROR_PDF，而不是靜靜存到錯的地方。
 *
 * @returns {Folder} Shared Drive 資料夾
 */
function resolveMailAttachmentFolder_() {
  const folderId = String(getConfig(CONFIG_KEYS.ROSTER_DRIVE_FOLDER_ID, '')).trim();
  if (!folderId) {
    throw new Error('Config 的 ROSTER_DRIVE_FOLDER_ID 未設定。寄送附件必須存於 Shared Drive，'
      + '請在 Config 填入 Shared Drive 資料夾的 ID。');
  }

  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    throw new Error('無法開啟 Config 的 ROSTER_DRIVE_FOLDER_ID 指定的資料夾（' + folderId + '）：' + err.message);
  }

  if (isPersonalMyDriveFolder_(folder)) {
    throw new Error('Config 的 ROSTER_DRIVE_FOLDER_ID 指向個人 My Drive 資料夾「' + folder.getName()
      + '」。寄送附件必須存於 Shared Drive，請改成 Shared Drive 資料夾的 ID。');
  }
  return folder;
}

/**
 * 掃描寄送附件資料夾內的**全部**檔案，分成「屬於指定季度、認得出版本號」與
 * 「認不出來」兩組，供選單「清理舊 PDF」顯示完整概況，不會漏報孤兒檔案。
 *
 * 只認得檔名開頭符合 "{QuarterID}_v{數字}" 這個慣例（對應 ATTACH_NAME_PATTERN
 * 設定為 "{QuarterID}_{VersionNo}_..." 時，buildAttachmentName_() 實際產生的格式）。
 * 認不出來的檔案**一律不會被清理**——寧可少清、明確列出讓你自己判斷，
 * 也不要憑猜測誤刪不相關的檔案。
 *
 * 「保留最新版本」不是按單一全域版本號判斷，而是逐個「身分」各自保留自己最新
 * 那一份——步驟 5「改動後重發」之後，同一個資料夾會混著不同版本：這一輪沒有
 * 被改動的人停留在舊版本（因為步驟 5 只為被改動者產生新版 PDF，見 PdfBatch.gs 的
 * generatePersonalPdfBatchForPeople_()），被改動的人已經是新版本，兩者都要保留，
 * 不能用「不是全域最新版就清理」判斷，否則會把仍在使用中、沒改動的人的 PDF
 * 誤判成舊檔清掉。「身分」＝檔名扣掉版本號那一段之後的部分（例如
 * "2026T4_v11_粵語堂職事表_陳大文.pdf" 的身分是 "_粵語堂職事表_陳大文.pdf"），
 * 完整版 PDF 的檔名（PersonName="完整版"）同樣落在這個規則內，是它自己的一個身分。
 *
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {{folderName: string, totalFileCount: number, recognized: Object[],
 *   unrecognized: Object[], nonLatest: Object[], latestCount: number, identityCount: number}}
 *   recognized／unrecognized 為資料夾內全部檔案的分類；nonLatest 是 recognized 中
 *   同一身分裡版本號不是該身分最新版、要清理的子集；identityCount 是 recognized
 *   涵蓋的不同身分數（大致等於「有幾個人＋完整版」，僅供顯示參考）
 */
function scanNonLatestPdfs_(quarterId) {
  const folder = resolveMailAttachmentFolder_();
  const pattern = new RegExp('^' + escapeRegExp_(quarterId) + '_v(\\d+)(.*)$');

  const recognized = [];
  const unrecognized = [];
  let totalFileCount = 0;

  // ⚠️ 第二十六輪批次階段 B：經共用入口，根資料夾同「季度 ▸ 版本」
  // 子資料夾都會掃到。逐個工具自己列根資料夾嘅話會**只睇到一半檔案**，
  // 而且唔會報錯，只會少報——清理少報可接受，但缺件檢查少報就會變成
  // 「報告話缺、實際檔案喺度」，嗰種更難查。所以全部工具一律經同一個入口。
  // （呢段特登唔寫出嗰個舊寫法嘅字面樣——tests/ 有一條斷言就係掃佢。）
  listRosterPdfFilesForQuarter_(quarterId).forEach(function (file) {
    totalFileCount++;
    const match = pattern.exec(file.name);
    if (match) {
      recognized.push({ id: file.id, name: file.name, versionNo: Number(match[1]), identity: match[2] });
    } else {
      unrecognized.push({ id: file.id, name: file.name });
    }
  });

  const maxVersionByIdentity = {};
  recognized.forEach(function (f) {
    if (!(f.identity in maxVersionByIdentity) || f.versionNo > maxVersionByIdentity[f.identity]) {
      maxVersionByIdentity[f.identity] = f.versionNo;
    }
  });
  const nonLatest = recognized.filter(function (f) { return f.versionNo !== maxVersionByIdentity[f.identity]; });

  return {
    folderName: folder.getName(),
    totalFileCount: totalFileCount,
    recognized: recognized,
    unrecognized: unrecognized,
    nonLatest: nonLatest,
    latestCount: recognized.length - nonLatest.length,
    identityCount: Object.keys(maxVersionByIdentity).length
  };
}

/**
 * 把指定的檔案移到垃圾桶（可復原，非永久刪除）。
 * @param {string[]} fileIds 要移到垃圾桶的檔案 ID 清單
 * @returns {number} 實際處理的數目
 */
function trashFiles_(fileIds) {
  fileIds.forEach(function (id) { DriveApp.getFileById(id).setTrashed(true); });
  return fileIds.length;
}

/**
 * 階段 C（第五輪批次）新增：按「季度＋版本」統計 RosterPDF 資料夾內的檔案數
 * 與總容量，並標示哪個版本是該季度**目前登記的最新版本**（依 RosterVersions，
 * 不是資料夾裡出現過的版本號最大值——步驟 5「改動後重發」之後，資料夾可能
 * 混雜多個版本的檔案，但 RosterVersions 記錄的才是真正「目前生效」的版本）。
 *
 * 純統計用途，不判斷「該不該刪」——這裡標示的 `isLatestVersion=false` 只是
 * 「這個版本已經不是最新」，不代表可以放心整批清掉：`scanNonLatestPdfs_()`
 * 逐身分判斷才是實際清理（「清理舊 PDF」選單項）依據的邏輯，因為同一個
 * 資料夾可能有人還在用舊版本（見該函式的檔頭說明）。這裡只是給你一個
 * 「幾多空間可以透過清理釋放」的概觀。
 *
 * 呼叫端已經解析好 folder（`resolveMailAttachmentFolder_()`）與
 * `listExistingFileSizes_(folder)`，這裡不重新呼叫 `folder.getFiles()`
 * 第二次——Drive API 呼叫本身有延遲，同一份資料重複列兩次沒有必要。
 *
 * @param {Folder} folder 要統計的資料夾
 * @param {Map<string, number>} fileSizes `listExistingFileSizes_(folder)` 的結果
 * @returns {{totalFileCount: number, totalSizeBytes: number, groups: Object[]}}
 *   groups 每項為 {quarterId, versionNo, fileCount, sizeBytes, isLatestVersion}，
 *   按 quarterId、versionNo 排序；命名不符合慣例的檔案歸在
 *   {quarterId: '', versionNo: null, ...} 這一組
 */
function scanPdfStatsByQuarterVersion_(folder, fileSizes) {
  const pattern = /^(.+?)_v(\d+)_/;

  const latestVersionByQuarter = {};
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    const qid = String(row[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] || '').trim();
    if (!qid) return;
    const vNo = Number(row[COLUMNS.ROSTER_VERSIONS.VERSION_NO]);
    if (!(qid in latestVersionByQuarter) || vNo > latestVersionByQuarter[qid]) latestVersionByQuarter[qid] = vNo;
  });

  const groups = {};
  let totalFileCount = 0;
  let totalSizeBytes = 0;
  fileSizes.forEach(function (size, name) {
    totalFileCount++;
    totalSizeBytes += size;
    const match = pattern.exec(name);
    const quarterId = match ? match[1] : '';
    const versionNo = match ? Number(match[2]) : null;
    const key = match ? quarterId + '|' + versionNo : '（不符合命名慣例）';
    if (!groups[key]) groups[key] = { quarterId: quarterId, versionNo: versionNo, fileCount: 0, sizeBytes: 0 };
    groups[key].fileCount++;
    groups[key].sizeBytes += size;
  });

  const result = Object.keys(groups).map(function (key) {
    const g = groups[key];
    return Object.assign({}, g, {
      isLatestVersion: !!g.quarterId && latestVersionByQuarter[g.quarterId] === g.versionNo
    });
  }).sort(function (a, b) {
    if (a.quarterId !== b.quarterId) return a.quarterId < b.quarterId ? -1 : 1;
    return (a.versionNo || 0) - (b.versionNo || 0);
  });

  return { totalFileCount: totalFileCount, totalSizeBytes: totalSizeBytes, groups: result };
}

/**
 * 階段 C（第五輪批次）新增：「按季度清理」的 plan 階段——列出資料夾內屬於
 * 指定季度的**全部**已辨識檔案（不分版本；跟「清理舊 PDF」／
 * `scanNonLatestPdfs_()` 只清「非最新版本」不同，這個工具是給「整個季度已經
 * 測試完畢，要整批清走」這種情境用的，例如測試季度收工後不需要保留任何
 * 版本）。只讀取，完全不刪除任何東西。
 * @param {string} quarterId 季度 ID
 * @returns {{folderName: string, files: Object[], totalSizeBytes: number}}
 *   files 每項為 {id, name, sizeBytes, versionNo}
 */
function planQuarterPdfCleanup_(quarterId) {
  const folder = resolveMailAttachmentFolder_();
  const pattern = new RegExp('^' + escapeRegExp_(quarterId) + '_v(\\d+)');
  const files = [];
  let totalSizeBytes = 0;
  // 第二十六輪批次階段 B：經共用入口（見 scanNonLatestPdfs_ 嘅說明）。
  listRosterPdfFilesForQuarter_(quarterId).forEach(function (file) {
    const match = pattern.exec(file.name);
    if (!match) return;
    totalSizeBytes += file.sizeBytes;
    files.push({ id: file.id, name: file.name, sizeBytes: file.sizeBytes, versionNo: Number(match[1]) });
  });
  // quarterId 帶落 plan：executeQuarterPdfCleanup_() 清完之後要用佢
  // 收拾空咗嘅版本資料夾。
  return {
    quarterId: quarterId, folderName: folder.getName(),
    files: files, totalSizeBytes: totalSizeBytes
  };
}

/**
 * 依 planQuarterPdfCleanup_() 的計畫，把整個季度的全部已辨識 PDF 一次過移到
 * 垃圾桶（不分版本，30 日內可復原）。只應該由選單「維護 ▸ ⚠️⚠️ 按季度清理
 * PDF」（經過打字確認）呼叫，不應該在其他地方自動呼叫。
 * @param {Object} plan planQuarterPdfCleanup_() 的結果
 * @returns {number} 移到垃圾桶的檔案數
 */
function executeQuarterPdfCleanup_(plan) {
  const count = trashFiles_(plan.files.map(function (f) { return f.id; }));
  // 第二十六輪批次階段 B：清完之後把**空咗嘅**版本資料夾收走，
  // 唔好留一堆空 `v0`／`v1`。只刪真係空嘅，入面有嘢一律唔掂
  // （見 removeEmptyVersionFolders_()）。
  // 包 try/catch：收唔到空資料夾唔應該令一次成功嘅清理變成失敗。
  try {
    plan.emptyFoldersRemoved = removeEmptyVersionFolders_(plan.quarterId || '');
  } catch (err) {
    log_('WARN', 'executeQuarterPdfCleanup_ 收拾空資料夾失敗（檔案已清）：' + err.message);
    plan.emptyFoldersRemoved = [];
  }
  return count;
}

/**
 * 依 Config 的 ATTACH_NAME_PATTERN 組出附件檔名。
 * 支援的變數：{QuarterID}、{PersonName}、{VersionNo}。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personName 對象姓名；完整版請傳 "完整版"
 * @returns {string} 檔案名稱（確保以 .pdf 結尾）
 */
function buildAttachmentName_(quarterId, versionNo, personName) {
  const pattern = String(getConfig(CONFIG_KEYS.ATTACH_NAME_PATTERN, DEFAULTS.ATTACH_NAME_PATTERN));
  let name = pattern
    .split('{QuarterID}').join(quarterId)
    .split('{PersonName}').join(personName || '')
    .split('{VersionNo}').join('v' + versionNo);
  if (name.toLowerCase().indexOf('.pdf') === -1) name += '.pdf';
  return name;
}

/**
 * 依 PersonID 取得中文姓名。
 * @param {string} personId 對象的 PersonID
 * @returns {string} 中文姓名；找不到時回傳 PersonID 本身
 */
function lookupPersonName_(personId) {
  const people = readSheet(SHEETS.NAME_MAPPING);
  for (let i = 0; i < people.length; i++) {
    if (people[i][COLUMNS.NAME_MAPPING.PERSON_ID] === personId) {
      return people[i][COLUMNS.NAME_MAPPING.NAME_TC] || personId;
    }
  }
  return personId;
}

/**
 * 第四十一輪批次 F 組：**職事表本身印到第幾行為止。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 為什麼要這樣找，不是記住行數
 * ═════════════════════════════════════════════════════════════════════
 *
 * 圖例那一段用多少行，本身是浮動的（`writeLegendSection_()` 回傳實際行數，
 * 而它跟 Config 的 `GRID_SHOW_LEGEND` 有關）。記住一個行數，
 * 一旦圖例多了或者少了一行，PDF 就會少印一個主日，或者多印半段圖例——
 * 而那兩種在 PDF 上看起來都完全正常。
 *
 * 所以改為**在第一欄找那兩段的標題**，找到就在它前面截住。
 *
 * ⚠️ 兩段都找不到（例如 `GRID_SHOW_LEGEND` 關掉了、或者是一張舊表）
 * 就回 `0` ＝ 不截。**寧可多印，不可以少印。**
 * 少印一個主日是一個沒有人看得出的錯；多印一段圖例只是不好看。
 *
 * @param {Sheet} sheet grid 工作表
 * @returns {number} 要印到第幾行（1-based）；`0` 代表不截
 */
function findRosterGridLastRow_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;

  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  let cut = 0;
  for (let r = 3; r <= lastRow; r++) {
    const text = String(colA[r - 1][0] || '').trim();
    if (text === GRID_LABELS.LEGEND_TITLE || text === GRID_LABELS.STATS_TITLE) {
      cut = r - 1;
      break;
    }
  }
  if (cut <= 0) return 0;

  // 標題前面通常有一行空行分隔，一併截走——留住的話，PDF 最底會有
  // 一條孤零零的空白列，看起來像印漏了東西。
  while (cut >= 3 && String(colA[cut - 1][0] || '').trim() === '') cut--;
  return cut >= 3 ? cut : 0;
}

/**
 * 匯出 PDF 的時候要不要截住。**讀 Config，一個地方決定。**
 *
 * ⚠️ 兩條 PDF 路（個人版、整季版）都叫這一個，
 * 不是各自讀一次 Config——各自讀的話，日後有人只改了其中一條，
 * 就會出現「個人版沒有圖例而整季版有」，而幹事會以為系統壞了。
 *
 * @param {Sheet} sheet grid 工作表
 * @returns {{lastRow: number}|undefined} 傳給 `exportSheetAsPdfBlob_()` 的選項
 */
function resolveRosterOnlyExportOpts_(sheet) {
  if (getConfig(CONFIG_KEYS.PDF_ROSTER_ONLY, DEFAULTS.PDF_ROSTER_ONLY) !== true) return undefined;
  const lastRow = findRosterGridLastRow_(sheet);
  if (lastRow <= 0) return undefined;
  return { lastRow: lastRow };
}
