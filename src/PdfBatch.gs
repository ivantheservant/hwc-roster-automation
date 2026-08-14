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
  // 需求 3：一開始就檢查資料夾，無效就立即中止，不要處理到一半才發現沒地方存
  const folder = resolveMailAttachmentFolder_();

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
  const existingFileSizes = forceRegenerate ? null : listExistingFileSizes_(folder);
  const versionAssignments = readVersionAssignmentsRaw_(quarterId, versionNo);

  runPersonalPdfBatchLoop_(
    quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes, versionAssignments, batchSize);

  if (progress.remainingPersonIds.length === 0) {
    clearPdfBatchProgress_();
    return buildPdfBatchResult_(progress, true);
  }

  savePdfBatchProgress_(progress);
  return buildPdfBatchResult_(progress, false);
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
 * @returns {void}
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
  try {
    runPersonalPdfBatchLoopInner_(
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
 * @returns {void}
 */
function runPersonalPdfBatchLoopInner_(
  quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes,
  versionAssignments, batchSize, renderContext, runStartedAt, processedThisRun
) {
  while (progress.remainingPersonIds.length > 0 && processedThisRun < batchSize) {
    const personId = progress.remainingPersonIds.shift();
    const outcome = generateOnePersonalPdf_(
      quarterId, versionNo, personId, folder, forceRegenerate, existingFileSizes,
      versionAssignments, renderContext);

    progress.doneCount++;
    if (outcome.skippedExisting) {
      progress.skippedExistingCount++;
    } else {
      progress.generatedCount++;
    }
    progress.totalRetries += outcome.retries;
    progress.totalHighlightMs += outcome.highlightMs;
    progress.totalExportMs += outcome.exportMs;
    if (outcome.error) {
      progress.errors.push({ personId: personId, nameTC: outcome.nameTC, message: outcome.error });
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
  const folder = resolveMailAttachmentFolder_();

  const progress = loadPdfResendBatchProgress_(quarterId, versionNo, personIds);
  const forceRegenerate = getConfig(CONFIG_KEYS.PDF_REGENERATE_IF_EXISTS, false) === true;
  const batchSize = Math.max(1, Math.round(
    getConfig(CONFIG_KEYS.PDF_BATCH_SIZE, DEFAULTS.PDF_BATCH_SIZE)));

  const existingFileSizes = forceRegenerate ? null : listExistingFileSizes_(folder);
  const versionAssignments = readVersionAssignmentsRaw_(quarterId, versionNo);

  runPersonalPdfBatchLoop_(
    quarterId, versionNo, progress, folder, forceRegenerate, existingFileSizes, versionAssignments, batchSize);

  if (progress.remainingPersonIds.length === 0) {
    clearPdfResendBatchProgress_();
    return buildPdfBatchResult_(progress, true);
  }

  savePdfResendBatchProgress_(progress);
  return buildPdfBatchResult_(progress, false);
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
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    sizes.set(file.getName(), file.getSize());
  }
  return sizes;
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

  let existingSize;
  if (existingFileSizes) {
    existingSize = existingFileSizes.has(fileName) ? existingFileSizes.get(fileName) : undefined;
  } else {
    const found = folder.getFilesByName(fileName);
    existingSize = found.hasNext() ? found.next().getSize() : undefined;
  }
  const alreadyExists = existingSize !== undefined && existingSize >= minBytes;
  if (!forceRegenerate && alreadyExists) {
    return { skippedExisting: true, retries: 0, highlightMs: 0, exportMs: 0, nameTC: personName };
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
      nameTC: personName
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
  const folder = resolveMailAttachmentFolder_();
  const people = listPeopleNeedingPersonalPdf_(quarterId, versionNo);
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const existingFileSizes = listExistingFileSizes_(folder);

  const missing = [];
  const tooSmall = [];
  let okCount = 0;

  people.forEach(function (p) {
    const fileName = buildAttachmentName_(quarterId, versionNo, p.nameTC);
    if (!existingFileSizes.has(fileName)) {
      missing.push({ personId: p.personId, nameTC: p.nameTC, fileName: fileName });
      return;
    }
    const size = existingFileSizes.get(fileName);
    if (size < minBytes) {
      tooSmall.push({ personId: p.personId, nameTC: p.nameTC, fileName: fileName, sizeBytes: size });
      return;
    }
    okCount++;
  });

  return {
    folderName: folder.getName(), totalPeople: people.length, minBytes: minBytes,
    missing: missing, tooSmall: tooSmall, okCount: okCount
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
 * 寄送 OFFICIAL／RESEND 之前的缺件檢查：該階段的範本若要求個人版 PDF，
 * 就核對本季每個有被派工的人是否已有對應的檔案存在 Shared Drive。
 *
 * 一開始就會呼叫 resolveMailAttachmentFolder_()（需求 3），資料夾無效會直接拋錯，
 * 讓呼叫端（Menu.gs 的 runSendStage_）在還沒開始任何寄送動作之前就能提醒使用者。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段
 * @returns {{applicable: boolean, missing: Object[], total: number}}
 *   applicable=false 代表這個階段／範本不需要個人 PDF，missing 一律為空陣列
 */
function checkMissingPersonalPdfs_(quarterId, versionNo, stage) {
  if (stage !== MAIL_STAGES.OFFICIAL && stage !== MAIL_STAGES.RESEND) {
    return { applicable: false, missing: [], total: 0 };
  }
  const template = findEmailTemplate_(stage);
  if (!template || String(template.attachType || '').toUpperCase() !== ATTACH_TYPE.PERSONAL_PDF) {
    return { applicable: false, missing: [], total: 0 };
  }

  const folder = resolveMailAttachmentFolder_();
  const people = listPeopleNeedingPersonalPdf_(quarterId, versionNo);
  // 跟 generateOnePersonalPdf_() 同一個效能理由：一次列出資料夾內容，
  // 不要對每個人各自查詢一次 Drive（見 listExistingFileSizes_()）。
  // 追加階段 AG：大小不足門檻的檔案也算缺件——0 bytes 的檔案存在不代表可用。
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const existingFileSizes = listExistingFileSizes_(folder);
  const missing = people.filter(function (p) {
    const fileName = buildAttachmentName_(quarterId, versionNo, p.nameTC);
    const size = existingFileSizes.get(fileName);
    return size === undefined || size < minBytes;
  });

  return { applicable: true, missing: missing, total: people.length };
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
function buildPdfBatchResult_(progress, done) {
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
    recoveredCount: progress.recoveredCount || 0,
    elapsedMs: Date.now() - progress.startedAtMs
  };
}
