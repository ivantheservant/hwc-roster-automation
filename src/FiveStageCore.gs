/**
 * 階段 C：五階段流程與介面無關的核心邏輯，選單版本（`FourStageFlow.gs`）與
 * Web UI 版本（`WebAppFlow.gs`）共用同一份實作。
 *
 * 這個檔案裡的函式只做三件事：檢查 Stage、呼叫既有的業務邏輯函式
 * （`planApplyRequests_`／`applyRequests_`／`sendStage`／`computeResendDiff_`／
 * `sendResendStage_`／`generatePersonalPdfBatchForPeople_` 等，全部原封不動，
 * 一行都沒有改）、回傳結構化的結果物件——**完全不呼叫 `SpreadsheetApp.getUi()`，
 * 也不組合任何要給人看的多行文字**。文字怎麼排、對話框怎麼分段，各自留給呼叫端：
 * 選單版本組 `ui.alert()`／`ui.prompt()` 的字串，Web UI 版本把同一份資料轉成
 * JSON 交給前端渲染。
 *
 * 這是重構，不是新功能。抽出來之前，這些邏輯分別散落在
 * `FourStageFlow.gs`（同步、`ui.prompt()` 可以跨對話框保留區域變數）與
 * `WebAppFlow.gs`（無狀態、每次 HTTP 請求重新計算，見該檔案檔頭說明）——
 * 兩邊呼叫的業務函式、判斷順序完全一樣，差別只在「用什麼方式問使用者、
 * 用什麼方式顯示結果」。抽出來之後兩邊改成呼叫這裡，各自只保留「問」與「顯示」。
 *
 * 唯一刻意不抽的部分：步驟 3、5 的硬規則放行文字輸入。選單版本用單次同步的
 * `ui.prompt()` 取得文字並立即判斷（`confirmHardViolationOverride_()`，
 * `FourStageFlow.gs`）；Web UI 版本因為每次 HTTP 請求都是獨立的，`releaseText`
 * 由前端保留、每次呼叫都重新驗證（見 `WebAppFlow.gs` 的說明）。兩者取得文字的
 * 方式在架構上本質不同，硬要合併成同一個函式反而會犧牲 Web UI 版本「每個關卡
 * 各自重新驗證」這個刻意加強的安全性質。真正共用的判斷核心是
 * `resolveHardViolationRelease_()`（`FourStageFlow.gs`）——兩邊都呼叫它決定
 * 「這份文字算不算數」，這才是這兩種情境唯一應該共用、也已經共用的部分。
 */

/* ============================================================
 * Web UI 五張步驟卡片的可用／完成狀態
 * ============================================================ */

/**
 * 階段 B5 抽出：依 Stage（與步驟 1 是否已有版本）決定步驟 2～5 四張卡片的
 * available／done 狀態，純函式、不讀寫任何工作表——原本這段判斷邏輯直接寫在
 * `WebAppFlow.gs` 的 `apiGetFlowState()` 裡，這裡抽出來只是把「純判斷」與
 * 「讀 SendLog 找 lastSentAt 這類有 IO 的部分」分開，方便獨立測試，
 * `apiGetFlowState()` 的輸出格式與行為完全不變（`ui/Index.html`／`ui/Script.html`
 * 沒有任何改動）。
 *
 * ⚠️ 「任何時候最多只有一個步驟按鈕 available」這個直覺**不成立**：Stage＝
 * REQUESTS_APPLIED 時，步驟 3（可重複執行套用新申報）與步驟 4（正式發出）
 * 同時 available，這是既有、刻意的設計（步驟 3 的文件說明本來就是「可重複執行」），
 * 不是這次抽函式引入的行為，抽出來時原封不動保留。
 *
 * @param {string} stage QUARTER_STAGE 其中一個值
 * @param {boolean} step1VersionExists 這一季是否已有生成過的版本（決定步驟 2 能不能開）
 * @returns {{step2: {available: boolean, done: boolean}, step3: {available: boolean, done: boolean},
 *   step4: {available: boolean, done: boolean}, step5: {available: boolean}}}
 */
function computeFiveStepAvailability_(stage, step1VersionExists) {
  const stageIndex = QUARTER_STAGE_ORDER.indexOf(stage);
  return {
    step2: {
      available: stage === QUARTER_STAGE.DRAFT && step1VersionExists,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.DRAFT)
    },
    step3: {
      available: stage === QUARTER_STAGE.REVIEW_SENT || stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.REVIEW_SENT)
    },
    step4: {
      available: stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stage === QUARTER_STAGE.OFFICIAL_SENT
    },
    step5: {
      available: stage === QUARTER_STAGE.OFFICIAL_SENT
    }
  };
}

/* ============================================================
 * 步驟 2：寄給堂委審閱
 * ============================================================ */

/**
 * 步驟 2 的確認資料。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, recipientCount: number, isDryRun: boolean}}
 */
function planStep2_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.DRAFT], '步驟 2：寄給堂委審閱');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');
  return {
    quarterId: quarterId,
    versionNo: versionNo,
    recipientCount: countReviewerRecipients_(),
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false
  };
}

/**
 * 步驟 2 的實際執行：寄審閱信、Stage 前進到 REVIEW_SENT。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `sendStage()` 的回傳結果
 */
function executeStep2_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.DRAFT], '步驟 2：寄給堂委審閱');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');
  const result = sendStage(quarterId, versionNo, MAIL_STAGES.REVIEW);
  advanceQuarterStage_(quarterId, QUARTER_STAGE.REVIEW_SENT);
  return result;
}

/* ============================================================
 * 步驟 3：套用修改申報
 * ============================================================ */

/**
 * 步驟 3 的驗證結果。純讀取，不套用任何申報。
 *
 * 回傳的 `mode` 對應四種情境（與原本 `runFourStageStep3_()`／
 * `handleStep3NoPendingRequests_()` 的分支一一對應）：
 * - `HAS_PENDING`：有待處理申報，附 `plan`（原始 `planApplyRequests_()` 結果，
 *   呼叫端自行決定要不要進一步處理／序列化）
 * - `NO_PENDING_DONE`：沒有待處理申報，且 Stage 已經是 REQUESTS_APPLIED
 * - `NO_VERSION`：沒有待處理申報，但連版本都找不到
 * - `NO_PENDING_NEEDS_ADVANCE`：沒有待處理申報，但 Stage 仍未前進，附上
 *   目前最新版本的違規清單，供決定要不要放行前進
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 見上方各 mode 的說明
 */
function planStep3_(quarterId) {
  const stage = requireQuarterStage_(
    quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');
  const plan = planApplyRequests_(quarterId);

  if (plan.results.length > 0) {
    return { mode: 'HAS_PENDING', stage: stage, plan: plan };
  }
  if (stage === QUARTER_STAGE.REQUESTS_APPLIED) {
    return { mode: 'NO_PENDING_DONE', stage: stage, skippedIncompleteCount: plan.skippedIncompleteCount };
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    return { mode: 'NO_VERSION', stage: stage, skippedIncompleteCount: plan.skippedIncompleteCount };
  }
  const violations = recomputeLatestVersionViolations_(quarterId, versionNo);
  return {
    mode: 'NO_PENDING_NEEDS_ADVANCE',
    stage: stage,
    versionNo: versionNo,
    sheetName: buildRosterSheetName_(quarterId, versionNo),
    violations: violations,
    skippedIncompleteCount: plan.skippedIncompleteCount
  };
}

/**
 * 步驟 3：套用申報。有硬規則違反時**不會**前進 Stage，由呼叫端另外處理放行
 * （選單版本：`confirmHardViolationOverride_()`；Web UI 版本：
 * `apiStep3Release()`），沒有硬規則違反時直接前進。
 * @param {Object} plan `planApplyRequests_()` 的結果（來自 `planStep3_()` 的
 *   `HAS_PENDING` 分支，或呼叫端自行重新計算的同一份東西）
 * @param {number[]} confirmedSheetRows 幹事同意套用的 CONFIRM 類別申報列號
 * @returns {Object} `applyRequests_()` 的結果，額外附 `advanced`（Stage 是否已前進）
 */
function executeStep3Apply_(plan, confirmedSheetRows) {
  const result = applyRequests_(plan, confirmedSheetRows);
  let advanced = false;
  if (resolveHardViolationRelease_(result.violations, '')) {
    advanceQuarterStage_(plan.quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
    advanced = true;
  }
  result.advanced = advanced;
  return result;
}

/**
 * 步驟 3：硬規則放行（或「沒有待處理申報但 Stage 未前進」情境的放行）。
 * **重新計算目前最新版本的違規狀況，不信任呼叫端傳入的舊快照**——見本檔案檔頭
 * 說明，這是 Web UI 兩次獨立請求之間狀態可能已變的真正防線；選單版本因為
 * 整個流程在同一次執行內完成，重新計算的結果本來就跟套用當下一致，一起共用
 * 這個函式不會改變選單版本的行為。
 * @param {string} quarterId 季度 ID
 * @param {string} releaseText 放行文字
 * @returns {{advanced: boolean, alreadyAdvanced: (boolean|undefined), violations: (Object[]|undefined)}}
 */
function executeStep3Release_(quarterId, releaseText) {
  const stage = requireQuarterStage_(
    quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');
  if (stage === QUARTER_STAGE.REQUESTS_APPLIED) {
    return { advanced: false, alreadyAdvanced: true };
  }
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');
  const violations = recomputeLatestVersionViolations_(quarterId, versionNo);
  if (!resolveHardViolationRelease_(violations, releaseText)) {
    return { advanced: false, violations: violations };
  }
  const hard = violations.filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hard.length > 0) logHardViolationRelease_(quarterId, '步驟 3：套用修改申報（Web UI）', hard);
  advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
  return { advanced: true };
}

/**
 * 步驟 3／5 共用：幹事撳「取消」時，把 NEEDS_INPUT 的原因寫回 Requests。
 * @param {string} quarterId 季度 ID
 * @returns {{recorded: number}} 實際寫回的行數
 */
function declineWithFreshPlan_(quarterId) {
  const plan = planApplyRequests_(quarterId);
  return { recorded: recordNeedsInputOutcomes_(plan) };
}

/* ============================================================
 * 步驟 4：正式發出
 * ============================================================ */

/**
 * 步驟 4 第一組警告：仍有待處理申報／待補格子。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{versionNo: number, pendingRequests: Object[], pendingCells: Object[]}}
 */
function planStep4Warnings_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');

  let pendingRequests = [];
  try {
    pendingRequests = readPendingRequests_(quarterId);
  } catch (err) {
    // 找不到 Requests 工作表時視為這一季沒有申報，不阻擋
  }
  const pendingCells = listPendingBackfillCells_(quarterId, versionNo);
  return { versionNo: versionNo, pendingRequests: pendingRequests, pendingCells: pendingCells };
}

/**
 * 步驟 4 第二組警告：個人 PDF 缺件檢查。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} `checkMissingPersonalPdfs_()` 的結果
 */
function planStep4MissingPdf_(quarterId, versionNo) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  return checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
}

/**
 * 步驟 4 最終確認畫面：收件人數、DRY_RUN。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{recipientCount: number, isDryRun: boolean}}
 */
function planStep4SendPreview_(quarterId, versionNo) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  const recipientCount = listRecipients_(
    MAIL_STAGES.OFFICIAL, buildMailContext_(quarterId, versionNo, MAIL_STAGES.OFFICIAL)).length;
  return { recipientCount: recipientCount, isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false };
}

/**
 * 步驟 4 的實際執行：正式寄出、Stage 前進到 OFFICIAL_SENT。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `sendStage()` 的回傳結果
 */
function executeStep4Send_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');
  const result = sendStage(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
  advanceQuarterStage_(quarterId, QUARTER_STAGE.OFFICIAL_SENT);
  return result;
}

/* ============================================================
 * 步驟 5：改動後重發
 * ============================================================ */

/**
 * 步驟 5 第一段：是否有待處理申報。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `mode='HAS_PENDING'` 時附 `plan`；否則 `mode='NO_PENDING'`
 */
function planStep5_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');

  let pendingRequests = [];
  try {
    pendingRequests = readPendingRequests_(quarterId);
  } catch (err) {
    // 找不到 Requests 工作表視為沒有申報
  }
  if (pendingRequests.length === 0) return { mode: 'NO_PENDING' };

  const plan = planApplyRequests_(quarterId);
  if (plan.results.length === 0) return { mode: 'NO_PENDING' };

  return { mode: 'HAS_PENDING', plan: plan };
}

/**
 * 步驟 5：套用申報（`basis=RESEND`）。**不會前進 Stage**——步驟 5 本來就維持
 * OFFICIAL_SENT。有硬規則違反時由呼叫端另外處理後續是否放行繼續。
 * @param {Object} plan `planApplyRequests_()` 的結果
 * @param {number[]} confirmedSheetRows 幹事同意套用的 CONFIRM 類別申報列號
 * @returns {Object} `applyRequests_()` 的結果
 */
function executeStep5Apply_(plan, confirmedSheetRows) {
  return applyRequests_(plan, confirmedSheetRows, VERSION_VALUES.BASIS_RESEND);
}

/**
 * 步驟 5：比對出這一版跟上次寄出時內容不同的人。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{versionNo: number, context: Object, changedList: Object[]}}
 */
function planStep5ChangedList_(quarterId) {
  requireQuarterStage_(quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');
  const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.RESEND);
  const changedList = computeResendDiff_(context);
  return { versionNo: versionNo, context: context, changedList: changedList };
}

/**
 * 步驟 5：產生本輪改動者的個人 PDF（可能要分批、重複呼叫）。**呼叫前一定要先用
 * `resolveHardViolationRelease_()`（呼叫端自行判斷）確認硬規則放行**——這個函式
 * 本身不做放行判斷，因為選單版本與 Web UI 版本取得放行文字的時間點不同
 * （見本檔案檔頭說明），判斷邏輯留給各自的呼叫端。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} changedList `computeResendDiff_()` 的結果
 * @returns {Object} `generatePersonalPdfBatchForPeople_()` 的結果；改動者全部零派工時
 *   回傳 `{done: true, doneCount: 0, totalPeople: 0}`
 */
function executeStep5GeneratePdfs_(quarterId, versionNo, changedList) {
  const peopleNeedingPdf = changedList.filter(function (c) { return c.hasAssignments; }).map(function (c) { return c.personId; });
  if (peopleNeedingPdf.length === 0) return { done: true, doneCount: 0, totalPeople: 0 };
  return generatePersonalPdfBatchForPeople_(quarterId, versionNo, peopleNeedingPdf);
}

/**
 * 步驟 5 最終確認畫面（3/3）：改動者名單、無電郵名單、即將寄出的信件數、DRY_RUN。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} context `buildMailContext_()` 的結果
 * @param {Object[]} changedList `computeResendDiff_()` 的結果
 * @returns {Object} 3/3 畫面資料
 */
function planStep5SendPreview_(quarterId, versionNo, context, changedList) {
  const listRecipientCount = listRecipients_(MAIL_STAGES.RESEND, context)
    .filter(function (r) { return r.type === RECIPIENT_TYPE.LIST; }).length;
  const noEmailList = changedList.filter(function (c) {
    const person = context.peopleById[c.personId];
    return !(person && person.email);
  });
  return {
    changedList: changedList,
    noEmailList: noEmailList,
    personSendableCount: changedList.length - noEmailList.length,
    listRecipientCount: listRecipientCount,
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false
  };
}

/**
 * 步驟 5 的實際寄送。**呼叫前一定要先確認硬規則放行**（同
 * `executeStep5GeneratePdfs_()`，判斷邏輯留給呼叫端）。Stage 維持 OFFICIAL_SENT。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} changedList `computeResendDiff_()` 的結果
 * @returns {Object} `sendResendStage_()` 的結果
 */
function executeStep5Send_(quarterId, versionNo, changedList) {
  return sendResendStage_(quarterId, versionNo, changedList.map(function (c) { return c.personId; }));
}
