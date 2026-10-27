/**
 * 分批產生個人版 PDF，把「產生 PDF」與「寄送」拆成兩個獨立步驟。
 *
 * 背景：58 人份個人 PDF 逐一即時匯出（原本的寄送流程做法）實測要 550–750 秒，
 * 遠超 Apps Script 單次執行 6 分鐘（360 秒）的上限，且會被平台直接中斷
 * （"Exceeded maximum execution time"，不是可以 catch 的例外，中斷前已處理的人
 * 也未必有任何紀錄）。改為選單「產生個人 PDF」分批執行、進度存在 Script Properties，
 * 每批處理到接近時間上限就停下存進度，下次按同一個選單、輸入同一個季度／版本即可接續，
 * 用法與「診斷工具 → 參數掃描」（見 Tune.gs 的 tuneParameters()）完全同一手法。
 *
 * 寄送階段（Mailer.gs 的 OFFICIAL／RESEND）不再即時匯出 PDF，
 * 改為直接讀取這裡已經產生好、存在 Shared Drive 的檔案。
 */

/**
 * 分批產生指定季度、版本的全部個人版 PDF。單次呼叫只處理一批（人數由 Config 的
 * PDF_BATCH_SIZE 決定，另有時間安全網 PDF_BATCH_TIME_BUDGET_MS 防止單批人數設太大
 * 仍超過 Apps Script 的執行上限），未完成時把進度存入 Script Properties，
 * 下次以同一個季度／版本呼叫會自動接續。
 *
 * 一開始就會呼叫 resolveMailAttachmentFolder_() 驗證 Shared Drive 資料夾設定，
 * 資料夾無效或未設定會立即拋錯中止，不會像舊流程那樣逐個匯出到一半才發現無處存放。
 *
 * 已存在且屬同一版本（檔名完全相同）的 PDF 預設略過，不重新匯出；
 * Config 的 PDF_REGENERATE_IF_EXISTS=TRUE 時強制全部重做。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{done: boolean, quarterId: string, versionNo: number, doneCount: number,
 *   totalPeople: number, generatedCount: number, skippedExistingCount: number,
 *   totalRetries: number, totalHighlightMs: number, totalExportMs: number,
 *   errors: Object[], elapsedMs: number}} 進度或最終結果
 */
function generatePersonalPdfBatch_(quarterId, versionNo) {
  // 需求 3：一開始就檢查資料夾，無效就立即中止，不要處理到一半才發現沒地方存。
  // 第二十六輪批次階段 B：改用「季度 ▸ 版本」子資料夾。
  // ⚠️ **一批只解析一次**——嗰個函式要攞 LockService 鎖，逐個檔叫一次
  // 就係 58 次攞鎖，慢到冇朋友。
  const folder = getOrCreateRosterSubfolder_(quarterId, versionNo);

  const progress = loadPdfBatchProgress_(quarterId, versionNo);
  const forceRegenerate = getConfig(CONFIG_KEYS.PDF_REGENERATE_IF_EXISTS, false) === true;
  const batchSize = Math.max(1, Math.round(
    getConfig(CONFIG_KEYS.PDF_BATCH_SIZE, DEFAULTS.PDF_BATCH_SIZE)));

  // 效能優化：以下兩者在同一批要處理的所有人之間完全共用，一次讀取即可，
  // 不必像原本那樣每個人各自重讀一次。分別解決實測的兩個效能熱點：
  // (1) 逐一呼叫 folder.getFilesByName() 查詢 Drive 判斷「是否已存在」；
  // (2) locatePersonCells_() 逐人重讀整份 RosterAssignments 再篩這一版。
  // forceRegenerate 時本來就不需要判斷是否已存在，略過這次不必要的資料夾列舉。
  // 追加階段 AG：改用 listExistingFileSizes_()（連大小一併記錄），不再只記檔名——
  // 「已存在」現在要求大小也達標，否則視為缺件重新產生，避免一個曾經失敗留下的
  // 0 bytes 舊檔被永遠當成「已經產生過」而略過。
  // ⚠️ 第六十三輪批次 A2 組：連最後更新時間一齊列——「已存在」仲要「唔係過期」
  const existingFileSizes = forceRegenerate ? null : listExistingFileInfo_(folder);
  const versionAssignments = readVersionAssignmentsRaw_(quarterId, versionNo);

  const before = snapshotPdfBatchCounts_(progress);
  const run = runPersonalPdfBatchLoop_(
    quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes, versionAssignments, batchSize);
  const callInfo = buildPdfBatchCallInfo_(before, progress, run);

  if (progress.remainingPersonIds.length === 0) {
    clearPdfBatchProgress_();
    return buildPdfBatchResult_(progress, true, callInfo);
  }

  savePdfBatchProgress_(progress);
  return buildPdfBatchResult_(progress, false, callInfo);
}

/**
 * 分批產生個人 PDF 的共用核心迴圈：從 progress.remainingPersonIds 依序取出，
 * 逐人呼叫 generateOnePersonalPdf_()，累計統計數字，接近 PDF_BATCH_TIME_BUDGET_MS
 * 時間預算或到達 batchSize 上限就停下——直接修改傳入的 progress 物件，不回傳新值。
 *
 * 由 generatePersonalPdfBatch_()（處理全體）與步驟 5 專用的
 * generatePersonalPdfBatchForPeople_()（只處理被改動者）共用，兩者的差異只在
 * 「一開始 remainingPersonIds 放什麼人」與「進度存哪把 Script Properties 鍵」，
 * 逐人處理、時間預算、統計累計的邏輯完全一致，抽出來避免兩處重複維護。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} progress 進度物件，會被就地修改
 * @param {Folder} folder 已驗證過的 Shared Drive 資料夾
 * @param {boolean} forceRegenerate 是否強制重新產生
 * @param {?Map<string, number>} existingFileSizes listExistingFileSizes_() 的結果，或 null
 * @param {Object[]} versionAssignments readVersionAssignmentsRaw_() 的結果
 * @param {number} batchSize 這次呼叫最多處理幾人
 * @returns {{attemptedIds: string[]}} 這一次呼叫處理過（含自動再試）嘅 personId
 */
function runPersonalPdfBatchLoop_(
  quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes, versionAssignments, batchSize
) {
  const runStartedAt = Date.now();
  let processedThisRun = 0;

  // 階段 B：整批共用同一個渲染 context（複製工作表、隱藏機器鍵行、讀格線索引、
  // 讀底色與字重基準各只做一次），取代原本每個人各複製與刪除一次工作表。
  // 詳細分析見 PdfExport.gs 的 openPersonalPdfRenderContext_()。
  // 這一批處理完（無論是做完全部人、到達批次上限、時間預算用盡，還是中途拋錯）
  // 都會在 finally 刪除暫存工作表，不會留下垃圾。
  const renderContext = openPersonalPdfRenderContext_(quarterId, versionNo);
  // 第六十三輪批次 A2 組：整批共用一個「內容最後改動時間」
  renderContext.contentStamp = forceRegenerate ? null : readPersonalPdfContentStamp_(quarterId, versionNo);
  try {
    return runPersonalPdfBatchLoopInner_(
      quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes,
      versionAssignments, batchSize, renderContext, runStartedAt, processedThisRun);
  } finally {
    renderContext.close();
  }
}

/**
 * runPersonalPdfBatchLoop_() 的實際迴圈，抽出來只是為了讓上面那層可以用
 * try/finally 保證暫存工作表一定會被刪除。參數與上層相同，另加 renderContext。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} progress 進度物件，會被就地修改
 * @param {Folder} folder 已驗證過的 Shared Drive 資料夾
 * @param {boolean} forceRegenerate 是否強制重新產生
 * @param {?Map<string, number>} existingFileSizes listExistingFileSizes_() 的結果，或 null
 * @param {Object[]} versionAssignments readVersionAssignmentsRaw_() 的結果
 * @param {number} batchSize 這次呼叫最多處理幾人
 * @param {Object} renderContext openPersonalPdfRenderContext_() 的結果
 * @param {number} runStartedAt 這次執行開始的時間戳
 * @param {number} processedThisRun 已處理人數的起始值
 * @returns {{attemptedIds: string[]}}
 */
function runPersonalPdfBatchLoopInner_(
  quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes,
  versionAssignments, batchSize, renderContext, runStartedAt, processedThisRun
) {
  const attemptedIds = [];
  const failedThisRun = [];
  while (progress.remainingPersonIds.length > 0 && processedThisRun < batchSize) {
    const personId = progress.remainingPersonIds.shift();
    attemptedIds.push(personId);
    const outcome = generateOnePersonalPdf_(
      quarterId, versionNo, personId, folder, forceRegenerate, existingFileSizes,
      versionAssignments, renderContext);

    progress.doneCount++;
    if (outcome.skippedExisting) {
      progress.skippedExistingCount++;
    } else if (!outcome.error) {
      // ⚠️ 第六十六輪批次 AC 組：**失敗唔計入「新產生」**。
      // 之前 `else` 一律 `generatedCount++`，失敗嗰份混咗入去——
      // 現場（2026-10-21 自測 S08）報「59／59 新產生 59 份」而 Drive 淨係 58 個檔。
      progress.generatedCount++;
    }
    // 第六十三輪批次 A2 組：舊檔過期而重做嘅份數，報告要講出嚟
    if (outcome.regeneratedStale) progress.staleRegeneratedCount = (progress.staleRegeneratedCount || 0) + 1;
    progress.totalRetries += outcome.retries;
    progress.totalHighlightMs += outcome.highlightMs;
    progress.totalExportMs += outcome.exportMs;
    if (outcome.error) {
      progress.errors.push({ personId: personId, nameTC: outcome.nameTC, message: outcome.error });
      failedThisRun.push(personId);
    }
    // 追加階段 AG：記錄「曾經拋錯、但核對後確認其實已經成功」的人數，
    // 供完成報告透明顯示這件事發生過幾次——這不是失敗，不進 errors 清單，
    // 但幹事應該知道有發生過，不要完全隱藏。
    if (outcome.recovered) progress.recoveredCount = (progress.recoveredCount || 0) + 1;

    processedThisRun++;

    const elapsed = Date.now() - runStartedAt;
    const avgPerPerson = elapsed / processedThisRun;
    if (progress.remainingPersonIds.length > 0 && elapsed + avgPerPerson > PDF_BATCH_TIME_BUDGET_MS) {
      break;
    }
  }

  retryFailedPersonalPdfsOnce_(
    quarterId, versionNo, progress, folder, existingFileSizes, versionAssignments,
    renderContext, runStartedAt, failedThisRun, processedThisRun);
  return { attemptedIds: attemptedIds };
}

/**
 * ⚠️ 第六十六輪批次 AC 組：一批做完、仲有時間 ⇒ 把**這一輪失敗**嘅人自動再試**一次**。
 *
 * 做喺共用核心迴圈呢一層（`runPersonalPdfBatchLoopInner_()`），所以全體版、指定人版
 *（改動後重發、補寄、紙本）、選單版、自測機全部一次過受惠。
 *
 * - 只試一次；仍然失敗就留喺 `progress.errors`（原本嗰條，唔重複記）。
 * - 時間預算用同主迴圈一樣嘅判斷（`elapsed + 平均每人 > PDF_BATCH_TIME_BUDGET_MS` 就唔試），
 *   唔會為咗再試撞 Apps Script 六分鐘上限。
 * - 再試用 `forceRegenerate=true`：唔好因為「已存在」而略過；殘留嘅半成品檔會被覆寫。
 * - 成功 ⇒ 由 `errors` 拎走、`generatedCount++`；`doneCount` 唔再加（嗰個人已經算過一次）。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} progress 進度物件（就地修改）
 * @param {Folder} folder 資料夾
 * @param {?Map} existingFileSizes 同主迴圈一樣
 * @param {Object[]} versionAssignments 同主迴圈一樣
 * @param {Object} renderContext 同主迴圈一樣
 * @param {number} runStartedAt 這次執行開始嘅時間戳
 * @param {string[]} failedIds 這一次執行入面失敗嘅 personId
 * @param {number} processedThisRun 這一次執行主迴圈處理咗幾多人（計平均用時）
 * @returns {void}
 */
function retryFailedPersonalPdfsOnce_(
  quarterId, versionNo, progress, folder, existingFileSizes, versionAssignments,
  renderContext, runStartedAt, failedIds, processedThisRun
) {
  for (let i = 0; i < failedIds.length; i++) {
    const elapsed = Date.now() - runStartedAt;
    const avgPerPerson = elapsed / Math.max(1, processedThisRun);
    if (elapsed + avgPerPerson > PDF_BATCH_TIME_BUDGET_MS) return;

    const personId = failedIds[i];
    const outcome = generateOnePersonalPdf_(
      quarterId, versionNo, personId, folder, true, existingFileSizes,
      versionAssignments, renderContext);
    progress.totalRetries += outcome.retries || 0;
    if (outcome.error) continue;

    progress.errors = progress.errors.filter(function (e) { return e.personId !== personId; });
    progress.generatedCount++;
    progress.retriedOkCount = (progress.retriedOkCount || 0) + 1;
    progress.totalHighlightMs += outcome.highlightMs || 0;
    progress.totalExportMs += outcome.exportMs || 0;
  }
}

/**
 * 第六十六輪批次 AC／AD 組：呢一次呼叫**之前**嘅計數，用嚟計「呢一次呼叫做咗幾多」。
 * @param {Object} progress 進度物件
 * @returns {{generated: number, skipped: number}}
 */
function snapshotPdfBatchCounts_(progress) {
  return { generated: progress.generatedCount || 0, skipped: progress.skippedExistingCount || 0 };
}

/**
 * 第六十六輪批次 AD 組：呢一次呼叫自己嘅增量（唔係累計）。
 *
 * 前端要由「一次操作」嘅角度報數字（開頭 48 位、總共新產生幾份、失敗幾份）。
 * 指定人版（補寄）每次接駁都重新計「還差誰」，`totalPeople`／`generatedCount` 係
 * **嗰一次**嘅數——前端若直接顯示最後一次回傳，就會見到「23 / 23」而實際做咗 48 份。
 * 所以後端逐次交出增量，由前端累加（見 ScriptZone1.html `addPdfBatchResult_()`）。
 *
 * @param {{generated: number, skipped: number}} before `snapshotPdfBatchCounts_()` 嘅結果
 * @param {Object} progress 進度物件（呢一次呼叫之後）
 * @param {{attemptedIds: string[]}} run 核心迴圈嘅回傳
 * @returns {{callGeneratedCount: number, callSkippedCount: number, attemptedIds: string[]}}
 */
function buildPdfBatchCallInfo_(before, progress, run) {
  return {
    callGeneratedCount: (progress.generatedCount || 0) - before.generated,
    callSkippedCount: (progress.skippedExistingCount || 0) - before.skipped,
    attemptedIds: (run && run.attemptedIds) || []
  };
}

/**
 * 步驟 5「改動後重發」專用：只為指定的一批 personIds 產生個人 PDF，不是全體 58 人。
 * 一次產生全體要 ~15 分鐘，遠超 Apps Script 6 分鐘上限；改後重發通常只影響少數人，
 * 用這個函式搭配 loadPdfResendBatchProgress_() 走跟 generatePersonalPdfBatch_() 一樣的
 * 分批／時間預算／大小驗證邏輯（見 runPersonalPdfBatchLoop_()），差別只在名單來源
 * 跟進度另外存一把 PDF_RESEND_BATCH_PROGRESS_KEY——不會跟「準備工作 ▸ 產生個人 PDF」
 * （處理全體）的進度互相覆蓋，因為兩者可能在同一個季度交替執行。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string[]} personIds 只為這些人產生 PDF（呼叫端已經算好「被改動者」名單）
 * @returns {{done: boolean, quarterId: string, versionNo: number, doneCount: number,
 *   totalPeople: number, generatedCount: number, skippedExistingCount: number,
 *   totalRetries: number, totalHighlightMs: number, totalExportMs: number,
 *   errors: Object[], elapsedMs: number}} 進度或最終結果
 */
function generatePersonalPdfBatchForPeople_(quarterId, versionNo, personIds) {
  // 第二十六輪批次階段 B：同上，一批只解析一次。
  const folder = getOrCreateRosterSubfolder_(quarterId, versionNo);

  const progress = loadPdfResendBatchProgress_(quarterId, versionNo, personIds);
  const forceRegenerate = getConfig(CONFIG_KEYS.PDF_REGENERATE_IF_EXISTS, false) === true;
  const batchSize = Math.max(1, Math.round(
    getConfig(CONFIG_KEYS.PDF_BATCH_SIZE, DEFAULTS.PDF_BATCH_SIZE)));

  // ⚠️ 第六十三輪批次 A2 組：連最後更新時間一齊列——「已存在」仲要「唔係過期」
  const existingFileSizes = forceRegenerate ? null : listExistingFileInfo_(folder);
  const versionAssignments = readVersionAssignmentsRaw_(quarterId, versionNo);

  const before = snapshotPdfBatchCounts_(progress);
  const run = runPersonalPdfBatchLoop_(
    quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes, versionAssignments, batchSize);
  const callInfo = buildPdfBatchCallInfo_(before, progress, run);

  if (progress.remainingPersonIds.length === 0) {
    clearPdfResendBatchProgress_();
    return buildPdfBatchResult_(progress, true, callInfo);
  }

  savePdfResendBatchProgress_(progress);
  return buildPdfBatchResult_(progress, false, callInfo);
}

/**
 * 一次列出資料夾內所有檔案的名稱與大小，供之後判斷「是否已存在」時用記憶體中的
 * Map 查詢，取代逐一呼叫 folder.getFilesByName(name)（逐一發出 Drive 查詢）。
 * 實測「略過已存在」這一步、58 個檔案耗時的主因就是這種逐一查詢。
 *
 * 追加階段 AG：原本只記檔名（Set），改記大小（Map）——「已存在」現在要求大小
 * 也達標，否則視為缺件重新產生，避免一個曾經失敗留下的 0 bytes 舊檔被永遠當成
 * 「已經產生過」而略過（這正是實測抓到的一種假失敗留下的隱患：一旦 0 bytes 的
 * 檔案被誤判成功存在，下次批次執行只查檔名存不存在，永遠不會重新產生）。
 *
 * @param {Folder} folder 要列出的資料夾
 * @returns {Map<string, number>} 資料夾內目前所有檔名對應的大小（bytes）
 */
function listExistingFileSizes_(folder) {
  const sizes = new Map();
  listExistingFileInfo_(folder).forEach(function (info, name) { sizes.set(name, info.sizeBytes); });
  return sizes;
}

/**
 * 第六十三輪批次 A2 組：同上，但連最後更新時間一齊記（`{sizeBytes, lastUpdated}`）。
 * 一次列舉，唔會逐個檔再問 Drive。
 * @param {Folder} folder 要列出的資料夾
 * @returns {Map<string, {sizeBytes: number, lastUpdated: *}>}
 */
function listExistingFileInfo_(folder) {
  const info = new Map();
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    info.set(file.getName(), { sizeBytes: file.getSize(), lastUpdated: file.getLastUpdated() });
  }
  return info;
}

/**
 * ⚠️⚠️ 第六十三輪批次 A2 組：**個人 PDF 係咪「過期」——唯一嘅判斷。**
 *
 * 舊做法：「已存在」只睇檔名＋大小。先產 PDF、後填講員 ⇒ 57 份 PDF
 * 永遠印住「待確認」，寄出時冇任何警告（填講員唔造新版本，所以檔名唔變）。
 *
 * 規則：檔案最後更新時間**早過**呢一版 `RosterAssignments` 最大 `UpdatedAt`
 * ⇒ 過期。PDF 印嘅係**整張表**，任何一格改咗，全部人嘅 PDF 都過期。
 *
 * ⚠️ 三處共用，唔可以各自寫：
 *   `generateOnePersonalPdf_()`　　過期 ⇒ 唔當「已存在」，重新產生
 *   `checkMissingPersonalPdfs_()`　過期計入缺件（分開講「缺」同「過期」）
 *   `lookupExistingPersonalPdf_()`（Mailer.gs）過期 ⇒ `missing = true`
 *
 * ⚠️ 判斷唔到（長表冇時間、檔案冇時間）⇒ **唔當過期**。
 * 冇時間嗰陣「過期」係猜，而猜錯嘅代價係每次寄出都重做 57 份 PDF。
 *
 * @param {*} fileLastUpdated 檔案嘅 `getLastUpdated()`（Date）
 * @param {?string} contentUpdatedAt `readLatestAssignmentUpdatedAt_()` 嘅結果
 * @param {string} timezone 時區
 * @returns {boolean} 係咪過期
 */
function isPersonalPdfStale_(fileLastUpdated, contentUpdatedAt, timezone) {
  if (!contentUpdatedAt) return false;
  const fileAt = normalizeSheetTimestamp_(fileLastUpdated, timezone);
  if (!fileAt) return false;
  return fileAt < contentUpdatedAt;
}

/**
 * 一版嘅「內容最後改動時間」。一批只讀一次（要讀成張 `RosterAssignments`）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{timezone: string, updatedAt: ?string}}
 */
function readPersonalPdfContentStamp_(quarterId, versionNo) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return { timezone: timezone, updatedAt: readLatestAssignmentUpdatedAt_(quarterId, versionNo, timezone) };
}

/**
 * 讀取 RosterAssignments 中屬於指定季度、版本的原始列，供批次產生個人 PDF 時
 * 所有人共用同一份篩選結果，不必每人各自重讀整份 RosterAssignments 再篩一次
 * （見 PdfExport.gs 的 locatePersonCells_() 的 versionAssignments 參數）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 已篩到這個版本的 RosterAssignments 列
 */
function readVersionAssignmentsRaw_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  return readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
  });
}

/**
 * 處理單一個人的 PDF：已存在同版本檔案（且大小正常）且不強制重做就略過；
 * 否則產生並存檔。任何一人失敗都只記錄在該人身上，不影響其他人繼續處理。
 *
 * 追加階段 AG：新增兩道防線，對應實測抓到的兩種假結果——
 * 1. 存檔後核對檔案大小：`buildPersonalPdfBlob_()` 內部的匯出已經有重試與大小檢查
 *    （見 PdfExport.gs 的 fetchWithRetry_()／exportSheetAsPdfBlob_()），但那是檢查
 *    「匯出當下拿到的 blob」，存檔（`saveOrOverwriteFile_()`）這一步本身另外出問題
 *    的機率雖然低，仍然存檔後多核對一次剛存好的檔案大小，才能保證回報「成功」
 *    的時候，Drive 上真的有一個大小正常的檔案。
 * 2. 拋錯不代表沒有成功：DriveApp／匯出服務偶爾會在動作其實已經完成之後才拋出
 *    暫時性錯誤（例如「Service error: Drive」），查證過一次實際案例的假失敗正是
 *    這個原因——檔案其實已經正常建立，只是確認回應失敗。catch 到例外時，先用
 *    checkFileActuallySucceeded_() 核對檔案是不是其實已經成功，成功的話改判成功，
 *    不會把真正成功的檔案也計入失敗清單。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personId 對象的 PersonID
 * @param {Folder} folder 已驗證過的 Shared Drive 資料夾
 * @param {boolean} forceRegenerate 是否強制重新產生（忽略已存在的檔案）
 * @param {Map<string, number>=} existingFileSizes 選填，listExistingFileSizes_() 的結果，
 *   由呼叫端（generatePersonalPdfBatch_）一次讀取後所有人共用；不傳時退回逐一查詢 Drive。
 * @param {Object[]=} versionAssignments 選填，readVersionAssignmentsRaw_() 的結果，
 *   原封不動轉傳給 buildPersonalPdfBlob_()；不傳時退回原本每人各自重讀的行為。
 * @param {Object=} renderContext 選填，openPersonalPdfRenderContext_() 的結果，
 *   由批次迴圈開一次、整批共用（階段 B）；不傳時 buildPersonalPdfBlob_() 會自己開一個
 *   用完即關，行為與階段 B 之前完全一致。
 * @returns {{skippedExisting: boolean, retries: number, highlightMs: number,
 *   exportMs: number, nameTC: string, error: (string|undefined), recovered: (boolean|undefined)}}
 *   這個人的處理結果；recovered=true 代表曾經拋錯，但核對後確認檔案其實已經成功
 */
function generateOnePersonalPdf_(
  quarterId, versionNo, personId, folder, forceRegenerate, existingFileSizes, versionAssignments, renderContext
) {
  const personName = lookupPersonName_(personId);
  const fileName = buildAttachmentName_(quarterId, versionNo, personName);
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));

  // 階段 E（第五輪批次）修正：forceRegenerate=TRUE 時，「是否已存在」這個問題
  // 的答案永遠不影響結果（下面的 `!forceRegenerate && alreadyExists` 一定是
  // false），原本卻仍然會執行整段查詢——`existingFileSizes` 在 forceRegenerate
  // 時本來就是 null（見 generatePersonalPdfBatch_() 的呼叫端），於是每人都會
  // 白白多一次 `folder.getFilesByName()` 的 Drive 查詢，查完卻完全用不到結果。
  // 改成 forceRegenerate 時整段跳過，不查也不判斷。
  let existing;
  let staleExisting = false;
  if (!forceRegenerate) {
    if (existingFileSizes) {
      // 第六十三輪批次 A2 組：呢個 Map 而家係 `listExistingFileInfo_()` 嘅結果
      //（`{sizeBytes, lastUpdated}`）；舊式（淨係大小）一樣收得落。
      const v = existingFileSizes.has(fileName) ? existingFileSizes.get(fileName) : undefined;
      existing = v === undefined ? undefined
        : (typeof v === 'number' ? { sizeBytes: v, lastUpdated: null } : v);
    } else {
      const found = folder.getFilesByName(fileName);
      if (found.hasNext()) {
        const f = found.next();
        existing = { sizeBytes: f.getSize(), lastUpdated: f.getLastUpdated() };
      }
    }
    // ⚠️ 第六十三輪批次 A2 組：檔名同大小都啱，但係**內容改咗之前**產生嘅
    // （例如先產 PDF、後填講員）⇒ 唔當已存在，要重做。
    const stamp = (renderContext && renderContext.contentStamp)
      || readPersonalPdfContentStamp_(quarterId, versionNo);
    staleExisting = !!existing && existing.sizeBytes >= minBytes
      && isPersonalPdfStale_(existing.lastUpdated, stamp.updatedAt, stamp.timezone);
    const alreadyExists = !!existing && existing.sizeBytes >= minBytes && !staleExisting;
    if (alreadyExists) {
      return { skippedExisting: true, retries: 0, highlightMs: 0, exportMs: 0, nameTC: personName };
    }
  }

  const attemptStartedAt = new Date();
  try {
    const built = buildPersonalPdfBlob_(quarterId, versionNo, personId, versionAssignments, renderContext);
    const savedFile = saveOrOverwriteFile_(folder, built.fileName, built.blob);
    const savedSize = savedFile.getSize();
    if (savedSize < minBytes) {
      throw new Error('已存檔但檔案大小只有 ' + savedSize + ' bytes（門檻 ' + minBytes + ' bytes），懷疑內容不完整');
    }
    return {
      skippedExisting: false,
      retries: built.retries || 0,
      highlightMs: built.highlightMs || 0,
      exportMs: built.exportMs || 0,
      nameTC: personName,
      regeneratedStale: staleExisting
    };
  } catch (err) {
    const recovered = checkFileActuallySucceeded_(folder, fileName, attemptStartedAt);
    if (recovered) {
      return {
        skippedExisting: false, retries: err.retries || 0, highlightMs: 0, exportMs: 0,
        nameTC: personName, recovered: true
      };
    }
    return {
      skippedExisting: false, retries: err.retries || 0, highlightMs: 0, exportMs: 0,
      nameTC: personName, error: err.message
    };
  }
}

/**
 * 追加階段 AG 新增：核對指定季度、版本「應該有幾多人的個人 PDF」跟「Shared Drive
 * 實際找到幾多個、大小是否正常」。只讀，不寫入、不產生、不刪除任何東西。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{folderName: string, totalPeople: number, minBytes: number,
 *   missing: Object[], tooSmall: Object[], okCount: number}}
 *   missing／tooSmall 每項為 {personId, nameTC, fileName}（tooSmall 另含 sizeBytes）
 */
function planPersonalPdfIntegrityCheck_(quarterId, versionNo) {
  const people = listPeopleNeedingPersonalPdf_(quarterId, versionNo);
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  // ⚠️ 第二十六輪批次階段 B：**一定要新舊兩處都睇。**
  // 淨係睇子資料夾嘅話，舊季度（檔案平舖喺根）會全部報「缺件」——
  // 而檔案其實好地地喺度。呢種「報告話缺，實際唔缺」比漏報更難查。
  const folder = { getName: function () { return resolveMailAttachmentFolder_().getName(); } };
  const existingFileInfo = listRosterPdfInfoForQuarter_(quarterId);
  // 第六十三輪批次 A2 組：順手報出過期數目（判斷同寄出嗰陣同一支）
  const stamp = readPersonalPdfContentStamp_(quarterId, versionNo);

  const missing = [];
  const tooSmall = [];
  const stale = [];
  let okCount = 0;

  people.forEach(function (p) {
    const fileName = buildAttachmentName_(quarterId, versionNo, p.nameTC);
    if (!existingFileInfo.has(fileName)) {
      missing.push({ personId: p.personId, nameTC: p.nameTC, fileName: fileName });
      return;
    }
    const info = existingFileInfo.get(fileName);
    if (info.sizeBytes < minBytes) {
      tooSmall.push({ personId: p.personId, nameTC: p.nameTC, fileName: fileName, sizeBytes: info.sizeBytes });
      return;
    }
    if (isPersonalPdfStale_(info.lastUpdated, stamp.updatedAt, stamp.timezone)) {
      stale.push({ personId: p.personId, nameTC: p.nameTC, fileName: fileName });
      return;
    }
    okCount++;
  });

  return {
    folderName: folder.getName(), totalPeople: people.length, minBytes: minBytes,
    missing: missing, tooSmall: tooSmall, stale: stale, okCount: okCount,
    contentUpdatedAt: stamp.updatedAt || ''
  };
}

/**
 * 列出指定季度、版本中「有被派工、需要個人 PDF」的人員清單。
 * 直接讀 RosterAssignments，不依賴任何電郵範本，供「產生個人 PDF」與
 * 寄送前的缺件檢查（checkMissingPersonalPdfs_）共用同一份名單邏輯。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 每項為 {personId, nameTC}，依 PersonID 排序
 */
function listPeopleNeedingPersonalPdf_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const personIds = {};
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return;
    if (Number(row[C.VERSION_NO]) !== versionNo) return;
    const personId = row[C.PERSON_ID];
    if (personId) personIds[personId] = true;
  });

  const peopleById = indexPeopleById_();
  return Object.keys(personIds).sort().map(function (personId) {
    const person = peopleById[personId];
    return { personId: personId, nameTC: person ? person.nameTC : personId };
  });
}

/**
 * 第七十九輪批次 GA 組：這一次寄出實際附的是不是個人版 PDF。
 *
 * 有 `sendOptions` ⇒ `resolveSendOptions_()`（寄信同一支）的 `attachType`；
 * 沒有（`null`／`undefined`／非物件）⇒ 範本嗰一欄（今日行為）。
 *
 * @param {string} stage 寄送階段
 * @param {?Object=} sendOptions 幹事在寄出窗的決定
 * @returns {boolean}
 */
function personalPdfNeededForSend_(stage, sendOptions) {
  if (sendOptions && typeof sendOptions === 'object') {
    const decision = resolveSendOptions_(stage, sendOptions, resolveStageTemplates_(stage));
    return decision.attachType === ATTACH_TYPE.PERSONAL_PDF;
  }
  const template = findEmailTemplate_(stage);
  return !!template && String(template.attachType || '').toUpperCase() === ATTACH_TYPE.PERSONAL_PDF;
}

/**
 * 寄送 OFFICIAL／RESEND 之前的缺件檢查：該階段的範本若要求個人版 PDF，
 * 就核對本季每個有被派工的人是否已有對應的檔案存在 Shared Drive。
 *
 * 一開始就會呼叫 resolveMailAttachmentFolder_()（需求 3），資料夾無效會直接拋錯，
 * 讓呼叫端（Menu.gs 的 runSendStage_）在還沒開始任何寄送動作之前就能提醒使用者。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * ⚠️ 第七十九輪批次 GA 組：**「這一次實際附甚麼」跟幹事在寄出窗揀的**，
 * 不是只看範本。揀了「不附」或「整季 PDF」，根本不需要個人 PDF，不應該叫幹事
 * 等 8 分鐘產生 58 份。有傳 `sendOptions` 就用寄信嗰條路同一支
 * `resolveSendOptions_()` 解析；沒傳（試算表選單版本，沒有揀附件的畫面）
 * 照範本，行為同以前一樣。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段
 * @param {?Object=} sendOptions 幹事在寄出窗的決定（可以不傳）
 * @returns {{applicable: boolean, missing: Object[], total: number}}
 *   applicable=false 代表這個階段／附件不需要個人 PDF，missing 一律為空陣列
 */
function checkMissingPersonalPdfs_(quarterId, versionNo, stage, sendOptions) {
  if (stage !== MAIL_STAGES.OFFICIAL && stage !== MAIL_STAGES.RESEND) {
    return { applicable: false, missing: [], total: 0 };
  }
  if (!personalPdfNeededForSend_(stage, sendOptions)) {
    return { applicable: false, missing: [], total: 0 };
  }

  const people = listPeopleNeedingPersonalPdf_(quarterId, versionNo);
  // 跟 generateOnePersonalPdf_() 同一個效能理由：一次列出資料夾內容，
  // 不要對每個人各自查詢一次 Drive（見 listExistingFileSizes_()）。
  // 追加階段 AG：大小不足門檻的檔案也算缺件——0 bytes 的檔案存在不代表可用。
  // 第二十六輪批次階段 B：新舊兩處都睇（見 planPersonalPdfIntegrityCheck_ 嘅說明）。
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const existingFileInfo = listRosterPdfInfoForQuarter_(quarterId);
  // ⚠️ 第六十三輪批次 A2 組：過期（內容改咗之後未重做）都算缺件——
  // 寄出去嘅會係一份印住「待確認」嘅舊表。但**分開講**：
  //   `absent`　　冇檔／檔案太細
  //   `stale`　　 有檔，但係內容改咗之前產生嘅（例如填講員之前）
  const stamp = readPersonalPdfContentStamp_(quarterId, versionNo);
  const absent = [];
  const stale = [];
  people.forEach(function (p) {
    const fileName = buildAttachmentName_(quarterId, versionNo, p.nameTC);
    const info = existingFileInfo.get(fileName);
    if (info === undefined || info.sizeBytes < minBytes) { absent.push(p); return; }
    if (isPersonalPdfStale_(info.lastUpdated, stamp.updatedAt, stamp.timezone)) stale.push(p);
  });

  return {
    applicable: true, missing: absent.concat(stale), absent: absent, stale: stale,
    total: people.length
  };
}

/**
 * 讀取上次未完成的批次進度。季度或版本不同、沒有紀錄，或進度已經是舊格式時，
 * 從頭建立一份新的（清單來自 listPeopleNeedingPersonalPdf_）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 進度物件
 */
function loadPdfBatchProgress_(quarterId, versionNo) {
  const raw = PropertiesService.getScriptProperties().getProperty(PDF_BATCH_PROGRESS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved && saved.quarterId === quarterId && saved.versionNo === versionNo) return saved;
    } catch (err) {
      log_('WARN', 'generatePersonalPdfBatch_: 進度紀錄損毀，重新開始。' + err.message);
    }
  }

  const people = listPeopleNeedingPersonalPdf_(quarterId, versionNo);
  return {
    quarterId: quarterId,
    versionNo: versionNo,
    remainingPersonIds: people.map(function (p) { return p.personId; }),
    totalPeople: people.length,
    doneCount: 0,
    generatedCount: 0,
    skippedExistingCount: 0,
    totalRetries: 0,
    totalHighlightMs: 0,
    totalExportMs: 0,
    errors: [],
    startedAtMs: Date.now()
  };
}

/**
 * 把批次進度存入 Script Properties，供下次執行接續。
 * @param {Object} progress 進度物件
 * @returns {void}
 */
function savePdfBatchProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(PDF_BATCH_PROGRESS_KEY, JSON.stringify(progress));
}

/**
 * 清除批次進度紀錄。
 * @returns {void}
 */
function clearPdfBatchProgress_() {
  PropertiesService.getScriptProperties().deleteProperty(PDF_BATCH_PROGRESS_KEY);
}

/**
 * 讀取步驟 5「改動後重發」上次未完成的 PDF 批次進度。季度、版本，或這次要處理的
 * personIds 名單（依排序後 join 成的 signature 比對）跟上次不同時，視為新的一輪，
 * 從頭建立進度——避免「先按一次只改 3 個人、按了一半、後來又多改了 2 個人再按」
 * 誤用範圍不對的舊進度。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string[]} personIds 這一輪要處理的 personId 清單
 * @returns {Object} 進度物件
 */
function loadPdfResendBatchProgress_(quarterId, versionNo, personIds) {
  const signature = personIds.slice().sort().join(',');
  const raw = PropertiesService.getScriptProperties().getProperty(PDF_RESEND_BATCH_PROGRESS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved && saved.quarterId === quarterId && saved.versionNo === versionNo
          && saved.signature === signature) {
        return saved;
      }
    } catch (err) {
      log_('WARN', 'generatePersonalPdfBatchForPeople_: 進度紀錄損毀，重新開始。' + err.message);
    }
  }

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    signature: signature,
    remainingPersonIds: personIds.slice(),
    totalPeople: personIds.length,
    doneCount: 0,
    generatedCount: 0,
    skippedExistingCount: 0,
    totalRetries: 0,
    totalHighlightMs: 0,
    totalExportMs: 0,
    errors: [],
    startedAtMs: Date.now()
  };
}

/**
 * 把步驟 5 PDF 批次進度存入 Script Properties，供下次執行接續。
 * @param {Object} progress 進度物件
 * @returns {void}
 */
function savePdfResendBatchProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(PDF_RESEND_BATCH_PROGRESS_KEY, JSON.stringify(progress));
}

/**
 * 清除步驟 5 PDF 批次進度紀錄。
 * @returns {void}
 */
function clearPdfResendBatchProgress_() {
  PropertiesService.getScriptProperties().deleteProperty(PDF_RESEND_BATCH_PROGRESS_KEY);
}

/**
 * 把進度物件整理成 generatePersonalPdfBatch_() 對外的回傳格式。
 * elapsedMs 是從第一次呼叫（progress.startedAtMs）到現在的累積時間，橫跨多次批次呼叫。
 * @param {Object} progress 進度物件
 * @param {boolean} done 是否已全部完成
 * @returns {Object} 對外結果
 */
function buildPdfBatchResult_(progress, done, callInfo) {
  const info = callInfo || {};
  return {
    done: done,
    quarterId: progress.quarterId,
    versionNo: progress.versionNo,
    doneCount: progress.doneCount,
    totalPeople: progress.totalPeople,
    generatedCount: progress.generatedCount,
    skippedExistingCount: progress.skippedExistingCount,
    totalRetries: progress.totalRetries,
    totalHighlightMs: progress.totalHighlightMs,
    totalExportMs: progress.totalExportMs,
    errors: progress.errors,
    // ⚠️ 第六十六輪批次 AC 組：失敗份數單獨列出（`generatedCount` 唔包失敗）
    failedCount: (progress.errors || []).length,
    retriedOkCount: progress.retriedOkCount || 0,
    // 第六十六輪批次 AD 組：呢一次呼叫自己嘅增量，見 `buildPdfBatchCallInfo_()`
    callGeneratedCount: info.callGeneratedCount === undefined ? progress.generatedCount : info.callGeneratedCount,
    callSkippedCount: info.callSkippedCount === undefined ? progress.skippedExistingCount : info.callSkippedCount,
    attemptedIds: info.attemptedIds || [],
    recoveredCount: progress.recoveredCount || 0,
    elapsedMs: Date.now() - progress.startedAtMs
  };
}

/**
 * 第六十六輪批次 AC／AD 組：Web API 回畀前端嘅「產生個人 PDF」欄位——
 * 全體版、改動後重發、補寄**全部經呢一支**，前端先至可以用同一個顯示。
 * `errors` 只出 personId／姓名／訊息。
 * @param {Object} result `buildPdfBatchResult_()` 嘅結果
 * @returns {{failedCount: number, errors: Object[], callGeneratedCount: number,
 *   callSkippedCount: number, attemptedIds: string[]}}
 */
function pdfBatchClientFields_(result) {
  const errors = (result.errors || []).map(function (e) {
    return { personId: e.personId, nameTC: e.nameTC || e.personId, message: e.message || '' };
  });
  return {
    failedCount: errors.length,
    errors: errors,
    callGeneratedCount: result.callGeneratedCount === undefined ? (result.generatedCount || 0) : result.callGeneratedCount,
    callSkippedCount: result.callSkippedCount === undefined ? (result.skippedExistingCount || 0) : result.callSkippedCount,
    attemptedIds: result.attemptedIds || []
  };
}

/**
 * 第十九輪批次階段 D1：個人 PDF 檔案按版本號分佈嘅診斷（唯讀）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個工具
 * ─────────────────────────────────────────────────────────────────────
 *
 * 實測見到嘅現象：
 *   1. 執行「產生個人 PDF」→ 報「已全部完成 57 人，新產生 57 個，
 *      略過（已存在同版本且大小正常）0 個」
 *   2. 步驟 5 → 確認畫面顯示「版本號：v1」，但又再重新產生咗 57 份
 *
 * 睇落好似 bug——同一個 v1、`PDF_REGENERATE_IF_EXISTS` 又係 FALSE，
 * 理論上應該全部略過。
 *
 * **但機制上呢個係合理行為。** 檔名係
 * `{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf`，
 * **版本號嵌喺檔名入面**（`buildAttachmentName_()`，PdfExport.gs）。
 * 「已存在」嘅判斷係「同一個檔名 + 大小達標」（`generateOnePersonalPdf_()`），
 * 所以只要版本號唔同，就一定係另一個檔名 ⇒ 一定要重新產生。
 *
 * 而「產生個人 PDF」個選單項嘅版本號提示係「留空 = 最新版本」
 * （`promptQuarterAndVersion_()`）——即係話：**如果產生 PDF 嗰陣最新版本
 * 係 v0，之後步驟 3 套用申報建立咗 v1，噉步驟 5 為 v1 重做全部 57 份
 * 係完全正確嘅**，因為 v1 嘅內容可能同 v0 唔同，唔應該把 v0 嘅 PDF
 * 當成 v1 嘅寄出去。版本號放入檔名，正正就係為咗防止呢件事。
 *
 * 呢個工具令上面嗰個推論**由「應該係噉」變成「睇得到」**：
 * 列出資料夾入面每個版本號各有幾多份，一眼睇得出係咪版本號唔同。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, latestVersionNo: number, byVersion: Object[],
 *   totalFiles: number, folderName: string}}
 */
function diagnosePersonalPdfVersions_(quarterId) {
  const folder = resolveMailAttachmentFolder_();
  const latestVersionNo = findLatestVersionNo(quarterId);
  // 第二十六輪批次階段 B：經共用入口，新舊兩處都會計到。

  // 用一個唔可能出現喺真實姓名入面嘅哨兵字串去反推檔名格式，
  // 就唔使喺呢度重新拼一次 pattern（重複實作＝遲早分岔）。
  const counts = {};
  let totalFiles = 0;
  // 第六十三輪批次 A2 組：最新版本嗰批之中，有幾多份係內容改咗之前產生嘅
  const stamp = latestVersionNo >= 0
    ? readPersonalPdfContentStamp_(quarterId, latestVersionNo) : { updatedAt: null, timezone: '' };
  let latestStaleCount = 0;
  listRosterPdfFilesForQuarter_(quarterId, { withLastUpdated: true }).forEach(function (f) {
    const name = f.name;
    if (name.indexOf(quarterId) === -1) return;
    totalFiles++;
    const match = /_v(\d+)_/.exec(name);
    const key = match ? 'v' + match[1] : '（檔名裡看不到版本號）';
    counts[key] = (counts[key] || 0) + 1;
    if (key === 'v' + latestVersionNo
        && isPersonalPdfStale_(f.lastUpdated, stamp.updatedAt, stamp.timezone)) latestStaleCount++;
  });

  const byVersion = Object.keys(counts).sort().map(function (k) {
    return { version: k, count: counts[k] };
  });

  return {
    quarterId: quarterId,
    latestVersionNo: latestVersionNo,
    byVersion: byVersion,
    totalFiles: totalFiles,
    latestStaleCount: latestStaleCount,
    folderName: folder.getName()
  };
}

/**
 * 把 `diagnosePersonalPdfVersions_()` 嘅結果講成人話，並且直接答
 * 「下一次寄送會唔會重做全部 PDF」。
 * @param {Object} diag `diagnosePersonalPdfVersions_()` 嘅結果
 * @returns {string} 報告文字
 */
function buildPersonalPdfVersionReport_(diag) {
  const latestKey = 'v' + diag.latestVersionNo;
  const latestEntry = diag.byVersion.filter(function (v) { return v.version === latestKey; })[0];
  const latestCount = latestEntry ? latestEntry.count : 0;
  const staleCount = diag.totalFiles - latestCount;

  const lines = [
    diag.quarterId + ' 的個人 PDF 現況（資料夾：' + diag.folderName + '）',
    '',
    '　目前最新版本：v' + diag.latestVersionNo,
    '　資料夾內這一季的檔案：' + diag.totalFiles + ' 個',
    ''
  ];
  diag.byVersion.forEach(function (v) {
    lines.push('　　' + v.version + '：' + v.count + ' 個'
      + (v.version === latestKey ? '　← 最新版本' : '　（舊版本）'));
  });

  lines.push('');
  if (latestCount === 0 && diag.totalFiles > 0) {
    lines.push('⚠️ 最新版本 ' + latestKey + ' 一份都沒有——下一次寄送會重新產生全部。');
    lines.push('');
    lines.push('這不是故障。檔名裡面有版本號'
      + '（{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf），');
    lines.push('「已存在」的判斷是「同一個檔名而且大小達標」，所以版本號一變，');
    lines.push('舊檔就不算數——因為新版本的內容可能不同，把舊版本的 PDF 當成');
    lines.push('新版本寄出去才是真正的錯。版本號放進檔名正是為了防止這件事。');
    lines.push('');
    lines.push('最常見的成因：產生 PDF 的時候最新版本還是舊那個'
      + '（「產生個人 PDF」的版本號留空 = 當時的最新版本），');
    lines.push('之後步驟 3 套用申報又建立了新版本。');
  } else if (staleCount > 0) {
    lines.push('　最新版本已有 ' + latestCount + ' 個，另有 ' + staleCount
      + ' 個是舊版本的檔案（不會被寄出，可以用「清理舊 PDF」移除）。');
  } else if (!diag.latestStaleCount) {
    lines.push('✅ 全部檔案都是最新版本，下一次寄送會略過已存在的，不會重做。');
  }
  // ⚠️ 第六十三輪批次 A2 組：版本號啱，但內容改咗之後未重做（例如填講員之後）
  if (diag.latestStaleCount > 0) {
    lines.push('');
    lines.push('⚠️ 最新版本 ' + latestKey + ' 之中有 ' + diag.latestStaleCount
      + ' 份是這一版內容改動之前產生的（例如填講員／翻譯／獻花之前），已經過期。');
    lines.push('請重新執行「產生個人 PDF」——過期的會自動重新產生，不需要先手動刪除。');
  }
  return lines.join('\n');
}

/**
 * 選單：個人 PDF 版本分佈（唯讀）。
 * @returns {void}
 */
function runDiagnosePersonalPdfVersions_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('個人 PDF 版本分佈（唯讀）',
    '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  try {
    const diag = diagnosePersonalPdfVersions_(quarterId);
    ui.alert('個人 PDF 版本分佈（唯讀）',
      buildPersonalPdfVersionReport_(diag) + '\n\n（本工具只讀取，沒有改動任何東西。）',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('個人 PDF 版本分佈（唯讀）', '檢查失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 第十九輪批次階段 D2：估算一批個人 PDF 要幾耐，用嚟喺對話框先講清楚。
 *
 * 數字來源：2026-08-17 嘅 57 份實測——總耗時 530.3 秒，即每份約 9.3 秒
 * （已包含撞速率限制之後嘅重試等待）。呢個係**實測平均**，唔係理論值。
 *
 * @param {number} count 要產生嘅份數
 * @returns {string} 例如「約 9 分鐘」
 */
function estimatePersonalPdfDurationText_(count) {
  if (!count || count <= 0) return '';
  const seconds = count * PERSONAL_PDF_SECONDS_PER_FILE;
  if (seconds < 90) return '約 ' + Math.round(seconds) + ' 秒';
  return '約 ' + Math.max(1, Math.round(seconds / 60)) + ' 分鐘';
}

/**
 * 第十九輪批次階段 E2：睇完一批之後，把「重試次數」翻譯成一句可行動嘅提示。
 *
 * 點解要有：實測 57 份撞咗 47 次重試，即係大部分匯出都至少撞過一次
 * Google 端嘅速率限制，而「重試 47 次」呢五個字本身唔會令人知道
 * **超過一半嘅總時間係喺度等**（285 / 530 秒），更加唔會令人知道
 * 呢件事係調得郁嘅。
 *
 * ⚠️ 呢一項係優化提示，唔係錯誤。重試機制本身運作正常（最終 57 份
 * 全部成功、`ERROR_PDF = 0`），唔應該因為呢個提示而去改重試邏輯。
 *
 * @param {Object} result `buildPdfBatchResult_()` 嘅結果
 * @returns {string} 提示文字；唔需要提示時回傳空字串
 */
function buildPdfRetryHintText_(result) {
  const total = Number(result.totalPeople || 0);
  const retries = Number(result.totalRetries || 0);
  if (total <= 0 || retries <= 0) return '';
  const ratio = retries / total;
  if (ratio < PDF_RETRY_RATIO_HINT_THRESHOLD) return '';

  return '\n\n💡 重試 ' + retries + ' 次 / ' + total + ' 份（'
    + (ratio * 100).toFixed(0) + '%）——大部分匯出都撞到 Google 端的速率限制，\n'
    + '而每次重試之前都要等，這些等待時間往往佔總耗時一半以上。\n'
    + '想快一點的話，可以把 Config 的 ' + CONFIG_KEYS.PDF_EXPORT_PACING_MS
    + ' 調大（目前預設 ' + DEFAULTS.PDF_EXPORT_PACING_MS + ' ms）：\n'
    + '每份之間多等一點，反而可能因為不再撞限制而令總時間變短。\n'
    + '（這不是故障——這一批全部都成功產生了。）';
}
