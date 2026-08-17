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
 * 第二十三輪批次階段 E1（決定 D2）：步驟 2 容許嘅 Stage。
 *
 * 「未正式發出之前嘅任何時候」都可以寄審閱本。寫成常數係因為
 * `planStep2_()` 同 `executeStep2_()` 兩邊都要用同一份清單——
 * 兩邊各寫一次就係「同一個判斷寫兩次、兩邊漂移」嗰個 bug class。
 */
const STEP2_ALLOWED_STAGES_ = [
  QUARTER_STAGE.DRAFT,
  QUARTER_STAGE.REVIEW_SENT,
  QUARTER_STAGE.REQUESTS_APPLIED
];

/**
 * 步驟 2 的確認資料。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, recipientCount: number, isDryRun: boolean}}
 */
function planStep2_(quarterId) {
  // 第二十三輪批次階段 E1（決定 D2）：由 `[DRAFT]` 放寬成三個 Stage。
  // 掣 2 開放於「未正式發出之前嘅任何時候」——由 `REQUESTS_APPLIED` 撳
  // 係合法嘅**第二輪審閱**（堂委提咗意見、幹事改完，想再俾佢哋睇一次）。
  // 舊寫法只准 `DRAFT`，即係「一季只可以俾堂委睇一次」，
  // 同實際運作對唔上。
  requireQuarterStage_(quarterId, STEP2_ALLOWED_STAGES_, '步驟 2：寄給堂委審閱');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');
  return {
    quarterId: quarterId,
    versionNo: versionNo,
    recipientCount: countReviewerRecipients_(),
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false,
    // 階段 A（收尾輪）新增：>0 代表這個版本＋這個階段在 SendLog 已經有人收過信，
    // 很可能是上次執行中途中斷後重新執行——見 Mailer.gs 的
    // countAlreadySentForStage_() 說明，只示警不阻擋。
    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.REVIEW)
  };
}

/**
 * 步驟 2 的實際執行：寄審閱信、Stage 前進到 REVIEW_SENT。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `sendStage()` 的回傳結果
 */
function executeStep2_(quarterId) {
  requireQuarterStage_(quarterId, STEP2_ALLOWED_STAGES_, '步驟 2：寄給堂委審閱');
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');
  const result = sendStage(quarterId, versionNo, MAIL_STAGES.REVIEW);

  // 第二十三輪批次階段 E1（決定 D2）：**一律設為 `REVIEW_SENT`，唔係「前進一格」。**
  // 由 `REQUESTS_APPLIED` 撳掣 2 係第二輪審閱，Stage 要退回 `REVIEW_SENT`
  // ——因為而家真係「已寄給堂委、等緊佢哋意見」。
  // 用 `setQuarterStage_()` 而唔係 `advanceQuarterStage_()`：後者寫入
  // AuditLog 嘅 action 寫死係「Stage 前進」，退返轉頭嗰陣紀錄會講大話。
  setQuarterStage_(quarterId, QUARTER_STAGE.REVIEW_SENT, '步驟 2：寄給堂委審閱（第二輪審閱會令 Stage 退回）');
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
  // 第十九輪批次階段 A：呢度而家睇到 grid 上嘅人手改動（之前讀長表，
  // 所以幹事點改都冇分別）。`manualChanges` 交畀呼叫端，令對話框
  // 講得出「偵測到 N 格人手改動」，同埋確認之後 materialise 成新版本。
  const recomputed = recomputeLatestVersionState_(quarterId, versionNo);
  return {
    mode: 'NO_PENDING_NEEDS_ADVANCE',
    stage: stage,
    versionNo: versionNo,
    sheetName: buildRosterSheetName_(quarterId, versionNo),
    violations: recomputed.violations,
    manualChanges: recomputed.changes,
    manualUnresolved: recomputed.unresolved,
    manualState: recomputed.state,
    context: recomputed.context,
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
  const result = checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
  // 第十九輪批次階段 C1：缺件比例過高時 `gate.blocked = true`，
  // 呼叫端唔應該再畀「現在繼續」呢個選擇。
  result.gate = evaluateStep4MissingPdfGate_(result);
  return result;
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
  return {
    recipientCount: recipientCount,
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false,
    // 階段 A（收尾輪）新增：見 planStep2_() 同一段說明——步驟 4 的收件人數量
    // 遠多於步驟 2（約 60 人 vs 幾位堂委），實際撞到 Apps Script 執行逾時的
    // 風險也高得多，這個警示對步驟 4 更重要。
    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.OFFICIAL)
  };
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

  // 第十九輪批次階段 C1：真正寄之前再擋一次。
  // 唔可以淨係靠對話框——Web UI 每次請求都係獨立嘅，畫面順序攔唔到
  // 直接呼叫；而且幹事由睇警告到撳確認之間，狀態有可能已經變咗。
  const gate = evaluateStep4MissingPdfGate_(
    checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL));
  if (gate.blocked) {
    throw new Error('步驟 4：正式發出——因為個人 PDF 缺件太多而中止。\n\n' + gate.message);
  }

  const result = sendStage(quarterId, versionNo, MAIL_STAGES.OFFICIAL);

  // 第十九輪批次階段 C2：**寄送結果唔理想就唔前進 Stage。**
  //
  // 修正之前呢度係無條件前進。實測後果：57 / 57 人因為缺 PDF 而冇收到，
  // Stage 照樣去咗 OFFICIAL_SENT，跟住想重跑步驟 4 就被 Stage 檢查拒絕
  // ——即係「系統話已正式發出、Stage 鎖死，但全體義工冇收到」，
  // 而且冇任何合法補救途徑，最後係靠步驟 5 嘅副作用救返。
  //
  // 劃線準則見 `evaluateStep4SendOutcome_()`：查無電郵唔算未處理
  // （已知而且無解），其餘「試過但未成功」一律算未處理。
  const outcome = evaluateStep4SendOutcome_(result);
  result.outcome = outcome;
  result.outcomeSentence = buildStep4OutcomeSentence_(result);
  result.advanced = outcome.ok;
  if (outcome.ok) {
    advanceQuarterStage_(quarterId, QUARTER_STAGE.OFFICIAL_SENT);
  }
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

/* ============================================================
 * 第十九輪批次階段 C：步驟 4 缺件保護與 Stage 前進判斷
 *
 * 實測撞到嘅事（Ivan 親自行過）：
 *   1. 未產生個人 PDF 就行步驟 4，系統警告「57 / 57 人缺個人 PDF」，
 *      但**畀咗「現在繼續」呢個選擇**
 *   2. 撳「繼續」⇒ 收件人 59、模擬 2、PDF 缺件 57、失敗 0
 *      —— 57 位義工一個都冇通知到
 *   3. **但 Stage 照樣前進到 OFFICIAL_SENT**
 *   4. 補齊 PDF 之後想重跑步驟 4 ⇒ 「需要 Stage 為 REQUESTS_APPLIED」，拒絕
 *   5. 結果變成：系統話「已正式發出」、Stage 已鎖死，但全體義工冇收到，
 *      而摘要嗰行「失敗：0」令人以為一切正常
 *
 * 換咗 DRY_RUN=FALSE 嘅真實運作，呢個就係一次靜靜噉失敗嘅正式發出。
 * ============================================================ */

/**
 * C1：缺件比例過高就唔應該畀人繼續。
 *
 * 點解要用**比例**而唔係「有缺件就擋」：少量缺件係合理嘅營運情況
 * （例如某人姓名有特殊字元令 PDF 匯出失敗，1 / 57），一刀切全擋會令
 * 幹事為咗一個人卡住成季，噉樣佢就會想辦法繞過個關卡——關卡越嚴，
 * 被繞過嘅機會越大。所以：少量放行（有警告），大量直接擋。
 *
 * 門檻放喺 Config（`STEP4_MAX_MISSING_PDF_RATIO`，預設 0.2），
 * 有需要可以自己調。57 / 57 = 1.0，遠超門檻，一定擋。
 *
 * @param {Object} missingResult `checkMissingPersonalPdfs_()` 嘅結果
 * @param {number=} maxRatio 容許嘅缺件比例（0–1）；預設讀 Config
 * @returns {{blocked: boolean, ratio: number, missingCount: number,
 *   total: number, maxRatio: number, message: string}}
 */
function evaluateStep4MissingPdfGate_(missingResult, maxRatio) {
  const limit = typeof maxRatio === 'number'
    ? maxRatio
    : Number(getConfig(CONFIG_KEYS.STEP4_MAX_MISSING_PDF_RATIO, DEFAULTS.STEP4_MAX_MISSING_PDF_RATIO));

  if (!missingResult || !missingResult.applicable || !missingResult.total) {
    return { blocked: false, ratio: 0, missingCount: 0, total: 0, maxRatio: limit, message: '' };
  }

  const missingCount = missingResult.missing.length;
  const ratio = missingCount / missingResult.total;
  if (missingCount === 0 || ratio <= limit) {
    return {
      blocked: false, ratio: ratio, missingCount: missingCount,
      total: missingResult.total, maxRatio: limit, message: ''
    };
  }

  return {
    blocked: true, ratio: ratio, missingCount: missingCount,
    total: missingResult.total, maxRatio: limit,
    message: '缺個人 PDF 的人數是 ' + missingCount + ' / ' + missingResult.total
      + '（' + (ratio * 100).toFixed(1) + '%），超過容許上限 '
      + (limit * 100).toFixed(0) + '%。\n\n'
      + '⚠️ 這一步不能繼續——照樣寄出的話，這 ' + missingCount
      + ' 位義工會一個都收不到通知，\n'
      + '而 Stage 會前進到 OFFICIAL_SENT、鎖住重跑步驟 4 的路。\n\n'
      + '請先執行「準備工作 ▸ 產生個人 PDF」，補齊之後再回來。\n\n'
      + '（如果你確定這一季本來就不需要個人 PDF 附件，'
      + '請改 Email 範本的 AttachType，不要用放行的方式繞過。'
      + '要調整容許比例的話，改 Config 的 '
      + CONFIG_KEYS.STEP4_MAX_MISSING_PDF_RATIO + '。）'
  };
}

/**
 * C2：寄送結果算唔算「完成」，即係應唔應該前進 Stage。
 *
 * 點樣劃線：
 *
 * | 狀態 | 算唔算已處理 | 理由 |
 * |---|---|---|
 * | `SENT` | ✅ | 真係寄咗 |
 * | `DRY_RUN` | ✅ | 演習模式下嘅正常結果 |
 * | `SKIPPED_NO_EMAIL` | ✅ | **已知而且無解**——本季有 7 位義工本來就冇電郵，唔應該因為呢個卡住成季 |
 * | `SKIPPED_UNCHANGED` | ✅ | 冇改動、唔使再寄 |
 * | `FAILED` | ❌ | 寄送失敗，有得補救 |
 * | `ERROR_PDF` | ❌ | PDF 產生失敗，有得補救 |
 * | `ERROR_PDF_MISSING` | ❌ | PDF 缺件，有得補救 |
 *
 * 原則：**「系統試過但未成功、而且補救得到」嘅一律唔算完成。**
 * 「無論點做都唔會成功」（冇電郵）就唔應該卡住流程。
 *
 * @param {Object} sendResult `sendStage()` 嘅結果
 * @returns {{ok: boolean, unhandledCount: number, breakdown: Object, message: string}}
 */
function evaluateStep4SendOutcome_(sendResult) {
  const failed = Number(sendResult.failed || 0);
  const errorPdf = Number(sendResult.errorPdf || 0);
  const errorPdfMissing = Number(sendResult.errorPdfMissing || 0);
  const unhandled = failed + errorPdf + errorPdfMissing;

  const breakdown = { failed: failed, errorPdf: errorPdf, errorPdfMissing: errorPdfMissing };
  if (unhandled === 0) {
    return { ok: true, unhandledCount: 0, breakdown: breakdown, message: '' };
  }

  const parts = [];
  if (errorPdfMissing > 0) parts.push(errorPdfMissing + ' 位因為缺個人 PDF');
  if (errorPdf > 0) parts.push(errorPdf + ' 位因為個人 PDF 產生失敗');
  if (failed > 0) parts.push(failed + ' 位因為寄送失敗');

  return {
    ok: false,
    unhandledCount: unhandled,
    breakdown: breakdown,
    message: '⚠️ 有 ' + unhandled + ' 位義工未收到通知（' + parts.join('、') + '）。\n\n'
      + 'Stage 維持在 REQUESTS_APPLIED，沒有前進到 OFFICIAL_SENT——\n'
      + '所以你補救之後可以再執行一次「步驟 4：正式發出」。\n\n'
      + '建議做法：\n'
      + (errorPdfMissing + errorPdf > 0
        ? '　1. 執行「準備工作 ▸ 產生個人 PDF」補齊缺的檔案\n　2. 再執行一次「步驟 4：正式發出」\n'
        : '　1. 再執行一次「步驟 4：正式發出」\n')
      + '\n只想補寄未成功那幾位、不想全部再寄一次的話，\n'
      + '用「四階段流程 ▸ 補寄未收到的人（唯讀預覽）」先看清楚名單。\n'
      + '（查無電郵的義工不算未處理——那是已知而且沒有辦法解決的情況，'
      + '不會因此卡住流程。）'
  };
}

/**
 * C4：把寄送結果嘅數字翻譯成一句結論。
 *
 * 點解要有呢句：實測見到嘅摘要係
 * 「寄出 0　模擬 2　失敗 0　PDF 缺件 57」——每個數字都啱，
 * 但**讀落去似乎冇事**（「失敗：0」）。57 位義工冇收到通知呢件事，
 * 要人自己由四個數字入面推出嚟。數字唔會講故事，結論句要自己講。
 *
 * @param {Object} sendResult `sendStage()` 嘅結果
 * @returns {string} 一句結論
 */
function buildStep4OutcomeSentence_(sendResult) {
  const outcome = evaluateStep4SendOutcome_(sendResult);
  const reached = Number(sendResult.sent || 0) + Number(sendResult.dryRun || 0);
  const noEmail = Number(sendResult.skipped || 0);

  if (outcome.ok) {
    return '✅ 結論：' + reached + ' 位義工已'
      + (sendResult.isDryRun ? '模擬通知（DRY_RUN，沒有真正寄出）' : '收到通知')
      + (noEmail > 0 ? '；另有 ' + noEmail + ' 位查無電郵，本來就寄不到' : '')
      + '，沒有任何一位是因為系統出錯而漏掉。';
  }

  return '⚠️ 結論：' + outcome.unhandledCount + ' 位義工未收到通知。'
    + (reached > 0 ? '（已' + (sendResult.isDryRun ? '模擬' : '') + '通知 ' + reached + ' 位' : '（')
    + (noEmail > 0 ? '；另有 ' + noEmail + ' 位查無電郵，本來就寄不到' : '')
    + '）';
}
