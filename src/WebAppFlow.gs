/**
 * 階段 B：Web UI 版的五階段流程。這個檔案只負責「HTTP 請求進來、把
 * `FiveStageCore.gs` 的結果整理成前端看得懂的 JSON、把前端的選擇轉呼叫回
 * `FiveStageCore.gs`」——所有 Stage 檢查、業務規則、流程判斷全部在
 * `FiveStageCore.gs`（選單版本 `FourStageFlow.gs` 共用同一份），這裡完全不重複
 * 實作（階段 C 重構，見 `FiveStageCore.gs` 檔頭說明）。
 *
 * 每一個 `api*` 函式開頭都呼叫 `assertWebAppRequestAllowed_()`（`WebApp.gs`），
 * 全部會改動資料的動作都透過 `FiveStageCore.gs` 重新做一次 `requireQuarterStage_()`
 * ——不信任前端傳來的「目前 Stage」，一律由後端重新讀取。
 */

/**
 * 供前端呼叫：取得指定季度五個步驟目前的狀態，用於畫面上五張卡片的可用／完成／
 * 鎖定狀態。純讀取。
 *
 * 步驟 1 在 Web UI 一律唯讀顯示、不提供按鈕（見 `ui/Script.html`）——生成初稿
 * 由自動排程執行，Web UI 不應該有人手入口，跟選單「準備工作 ▸ 生成職事表」是
 * 兩回事，不在這個五步驟流程之內。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 五個步驟的狀態摘要
 */
function apiGetFlowState(quarterId) {
  assertWebAppRequestAllowed_();
  const stage = getQuarterStage_(quarterId);
  const latestVersionNo = findLatestVersionNo(quarterId);
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;

  const step1 = { versionExists: latestVersionNo >= 0 };
  if (step1.versionExists) {
    step1.versionNo = latestVersionNo;
    step1.sheetName = buildRosterSheetName_(quarterId, latestVersionNo);
    step1.createdAt = findVersionCreatedAt_(quarterId, latestVersionNo);
  }

  const stageIndex = QUARTER_STAGE_ORDER.indexOf(stage);

  return {
    quarterId: quarterId,
    stage: stage,
    isDryRun: isDryRun,
    latestVersionNo: latestVersionNo,
    step1: step1,
    step2: {
      available: stage === QUARTER_STAGE.DRAFT && step1.versionExists,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.DRAFT),
      lastSentAt: findLastSendTimestamp_(quarterId, MAIL_STAGES.REVIEW)
    },
    step3: {
      available: stage === QUARTER_STAGE.REVIEW_SENT || stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.REVIEW_SENT)
    },
    step4: {
      available: stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stage === QUARTER_STAGE.OFFICIAL_SENT,
      lastSentAt: findLastSendTimestamp_(quarterId, MAIL_STAGES.OFFICIAL)
    },
    step5: {
      available: stage === QUARTER_STAGE.OFFICIAL_SENT,
      lastSentAt: findLastSendTimestamp_(quarterId, MAIL_STAGES.RESEND)
    }
  };
}

/**
 * 找出 RosterVersions 中某個版本的建立時間。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {?string} 建立時間；找不到回傳 null
 */
function findVersionCreatedAt_(quarterId, versionNo) {
  const V = COLUMNS.ROSTER_VERSIONS;
  let found = null;
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    if (row[V.QUARTER_ID] === quarterId && Number(row[V.VERSION_NO]) === versionNo) {
      found = String(row[V.CREATED_AT] || '') || null;
    }
  });
  return found;
}

/**
 * 找出 SendLog 中某季某階段最後一次寄送的時間（含 DRY_RUN 的紀錄，因為那也代表
 * 這個步驟「跑過一次」）。
 * @param {string} quarterId 季度 ID
 * @param {string} stage MAIL_STAGES 其中一個值
 * @returns {?string} 最後一次的 SentAt；找不到回傳 null
 */
function findLastSendTimestamp_(quarterId, stage) {
  const C = COLUMNS.SEND_LOG;
  let latest = null;
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId || row[C.STAGE] !== stage) return;
    const sentAt = String(row[C.SENT_AT] || '');
    if (sentAt && (!latest || sentAt > latest)) latest = sentAt;
  });
  return latest;
}

/**
 * 把 planApplyRequests_() 的單一 results 項目整理成前端要用的欄位，
 * 不回傳 post／serviceDate 等內部使用的完整物件。
 * @param {Object} r plan.results 的單一項目
 * @returns {Object} 前端用的精簡物件
 */
function mapRequestForClient_(r) {
  return {
    sheetRow: r.sheetRow,
    serviceDateText: r.serviceDateText,
    postNameText: r.postNameText,
    personNameText: r.personNameText,
    requestType: r.requestType,
    reason: r.reason || ''
  };
}

/**
 * 把 decorateViolations_() 的單一違規項目整理成前端要用的欄位。
 * @param {Object} v 違規項目
 * @returns {Object} 前端用的精簡物件
 */
function mapViolationForClient_(v) {
  return {
    serviceDate: v.serviceDate,
    postNameTC: v.postNameTC,
    slotIndex: v.slotIndex,
    personName: v.personName,
    ruleId: v.ruleId,
    severity: v.severity,
    reason: v.reason
  };
}

/**
 * 把 `planStep3_()`／`planStep5_()` 的 `HAS_PENDING` 分支（附完整 `plan`）
 * 轉成前端要用的三個清單。
 * @param {Object} plan `planApplyRequests_()` 的結果
 * @returns {{applyList: Object[], confirmList: Object[], needsInputList: Object[]}}
 */
function mapPendingPlanForClient_(plan) {
  return {
    applyList: plan.results.filter(function (r) { return r.category === 'APPLY'; }).map(mapRequestForClient_),
    confirmList: plan.results.filter(function (r) { return r.category === 'CONFIRM'; }).map(mapRequestForClient_),
    needsInputList: plan.results.filter(function (r) { return r.category === 'NEEDS_INPUT'; }).map(mapRequestForClient_)
  };
}

/* ============================================================
 * 步驟 2：寄給堂委審閱
 * ============================================================ */

/**
 * 供前端呼叫：步驟 2 的確認畫面資料，內容與選單版本的確認對話框一致。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 確認畫面資料
 */
function apiStep2Preview(quarterId) {
  assertWebAppRequestAllowed_();
  return planStep2_(quarterId);
}

/**
 * 供前端呼叫：實際執行步驟 2——寄審閱信、Stage 前進到 REVIEW_SENT。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 寄送結果統計，欄位與選單版本完成對話框一致
 */
function apiStep2Confirm(quarterId) {
  assertWebAppRequestAllowed_();
  const result = executeStep2_(quarterId);
  return {
    isDryRun: result.isDryRun, sent: result.sent, dryRun: result.dryRun,
    skipped: result.skipped, failed: result.failed, errorPdf: result.errorPdf
  };
}

/* ============================================================
 * 步驟 3：套用修改申報
 * ============================================================ */

/**
 * 供前端呼叫：步驟 3 的驗證結果（對應選單版本的 1/3 視窗，或沒有待處理申報時
 * 的重新檢查畫面）。純讀取，不套用任何申報。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 依情況回傳不同的 mode
 */
function apiStep3Plan(quarterId) {
  assertWebAppRequestAllowed_();
  const plan = planStep3_(quarterId);

  if (plan.mode === 'HAS_PENDING') {
    return Object.assign(
      { mode: 'HAS_PENDING', stage: plan.stage, skippedIncompleteCount: plan.plan.skippedIncompleteCount },
      mapPendingPlanForClient_(plan.plan)
    );
  }
  if (plan.mode === 'NO_PENDING_NEEDS_ADVANCE') {
    return {
      mode: plan.mode,
      stage: plan.stage,
      versionNo: plan.versionNo,
      sheetName: plan.sheetName,
      violations: plan.violations.map(mapViolationForClient_),
      requiresRelease: !resolveHardViolationRelease_(plan.violations, ''),
      skippedIncompleteCount: plan.skippedIncompleteCount
    };
  }
  return plan; // NO_PENDING_DONE ／ NO_VERSION：本來就已經是精簡物件
}

/**
 * 供前端呼叫：幹事在 1/3 畫面選擇「取消」。
 * @param {string} quarterId 季度 ID
 * @returns {{recorded: number}} 實際寫回的 NEEDS_INPUT 行數
 */
function apiStep3Decline(quarterId) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(
    quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');
  return declineWithFreshPlan_(quarterId);
}

/**
 * 供前端呼叫：套用申報。`acceptConfirmList` 是使用者在「未曾任該崗位」子問題的
 * 選擇——true＝全部接受，false／未提供＝全部拒絕。
 * 重新計算一次 plan（不信任 `apiStep3Plan()` 那次的結果仍然有效）。
 * @param {string} quarterId 季度 ID
 * @param {boolean} acceptConfirmList 是否接受全部 CONFIRM 類別的申報
 * @returns {Object} 套用結果，含是否已經前進、是否仍需要放行
 */
function apiStep3Apply(quarterId, acceptConfirmList) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(
    quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');

  const plan = planApplyRequests_(quarterId);
  if (plan.results.length === 0) {
    throw new Error('已經沒有待處理的申報了（可能在你確認的期間被其他人處理過），請重新整理再試一次。');
  }
  const confirmList = plan.results.filter(function (r) { return r.category === 'CONFIRM'; });
  const confirmedSheetRows = acceptConfirmList === true ? confirmList.map(function (r) { return r.sheetRow; }) : [];

  const result = executeStep3Apply_(plan, confirmedSheetRows);
  return {
    sheetName: result.sheetName,
    baseVersionNo: result.baseVersionNo,
    appliedCount: result.appliedCount,
    rejectedCount: result.rejectedCount,
    needsInputCount: result.needsInputCount,
    pendingBackfillCount: result.pendingBackfillCount,
    violations: result.violations.map(mapViolationForClient_),
    requiresRelease: !result.advanced,
    advanced: result.advanced
  };
}

/**
 * 供前端呼叫：硬規則放行（或「沒有待處理申報但 Stage 未前進」情境的放行）。
 * @param {string} quarterId 季度 ID
 * @param {string} releaseText 使用者輸入的放行文字
 * @returns {Object} 是否已經前進；未前進時附上目前的違規清單供前端重新顯示
 */
function apiStep3Release(quarterId, releaseText) {
  assertWebAppRequestAllowed_();
  const result = executeStep3Release_(quarterId, releaseText);
  if (result.violations) result.violations = result.violations.map(mapViolationForClient_);
  return result;
}

/* ============================================================
 * 步驟 4：正式發出
 * ============================================================ */

/**
 * 供前端呼叫：步驟 4 第一畫面——仍有待處理申報／待補格子的警告。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 版本號、待處理申報、待補格子
 */
function apiStep4GetPendingWarnings(quarterId) {
  assertWebAppRequestAllowed_();
  const warnings = planStep4Warnings_(quarterId);
  return {
    versionNo: warnings.versionNo,
    pendingRequests: warnings.pendingRequests.map(function (r) {
      return { serviceDateText: r.serviceDateText, postNameText: r.postNameText, personNameText: r.personNameText };
    }),
    pendingCells: warnings.pendingCells.slice(0, 20).map(function (c) { return { serviceDate: c.serviceDate, key: c.key }; }),
    pendingCellsTotal: warnings.pendingCells.length
  };
}

/**
 * 供前端呼叫：步驟 4 第二畫面——個人 PDF 缺件檢查。純讀取。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 缺件檢查結果
 */
function apiStep4GetMissingPdfWarnings(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const missingCheck = planStep4MissingPdf_(quarterId, versionNo);
  return {
    applicable: missingCheck.applicable,
    total: missingCheck.total,
    missing: missingCheck.missing.slice(0, 30).map(function (p) { return { nameTC: p.nameTC, personId: p.personId }; }),
    missingTotal: missingCheck.missing.length
  };
}

/**
 * 供前端呼叫：步驟 4 最終確認畫面。純讀取。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 收件人數、DRY_RUN
 */
function apiStep4GetSendPreview(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  return planStep4SendPreview_(quarterId, versionNo);
}

/**
 * 供前端呼叫：實際執行步驟 4——正式寄出、Stage 前進到 OFFICIAL_SENT。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 寄送結果統計
 */
function apiStep4Confirm(quarterId) {
  assertWebAppRequestAllowed_();
  const result = executeStep4Send_(quarterId);
  return {
    isDryRun: result.isDryRun, sent: result.sent, dryRun: result.dryRun,
    skipped: result.skipped, unchanged: result.unchanged,
    failed: result.failed, errorPdf: result.errorPdf, errorPdfMissing: result.errorPdfMissing
  };
}

/* ============================================================
 * 步驟 5：改動後重發
 * ============================================================ */

/**
 * 供前端呼叫：步驟 5 第一畫面——是否有待處理申報。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `mode='HAS_PENDING'` 時附申報清單；否則 `mode='NO_PENDING'`
 */
function apiStep5Plan(quarterId) {
  assertWebAppRequestAllowed_();
  const plan = planStep5_(quarterId);
  if (plan.mode === 'NO_PENDING') return plan;

  return Object.assign(
    {
      mode: 'HAS_PENDING',
      baseVersionNo: plan.plan.baseVersionNo,
      nextVersionNo: plan.plan.baseVersionNo + 1,
      skippedIncompleteCount: plan.plan.skippedIncompleteCount,
      isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false
    },
    mapPendingPlanForClient_(plan.plan)
  );
}

/**
 * 供前端呼叫：步驟 5「取消」1/3。
 * @param {string} quarterId 季度 ID
 * @returns {{recorded: number}} 實際寫回的行數
 */
function apiStep5Decline(quarterId) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');
  return declineWithFreshPlan_(quarterId);
}

/**
 * 供前端呼叫：套用申報（步驟 5 版本，`basis=RESEND`）。Stage 維持 OFFICIAL_SENT。
 * 如果套用結果有硬規則違反，回傳 `requiresAck: true`——真正的關卡設在
 * `apiStep5GeneratePdfs()` 與 `apiStep5SendConfirm()`，見那兩個函式的說明。
 * @param {string} quarterId 季度 ID
 * @param {boolean} acceptConfirmList 是否接受全部 CONFIRM 類別的申報
 * @returns {Object} 套用結果
 */
function apiStep5Apply(quarterId, acceptConfirmList) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');

  const plan = planApplyRequests_(quarterId);
  if (plan.results.length === 0) {
    throw new Error('已經沒有待處理的申報了（可能在你確認的期間被其他人處理過），請重新整理再試一次。');
  }
  const confirmList = plan.results.filter(function (r) { return r.category === 'CONFIRM'; });
  const confirmedSheetRows = acceptConfirmList === true ? confirmList.map(function (r) { return r.sheetRow; }) : [];

  const result = executeStep5Apply_(plan, confirmedSheetRows);
  return {
    sheetName: result.sheetName,
    baseVersionNo: result.baseVersionNo,
    appliedCount: result.appliedCount,
    rejectedCount: result.rejectedCount,
    needsInputCount: result.needsInputCount,
    pendingBackfillCount: result.pendingBackfillCount,
    violations: result.violations.map(mapViolationForClient_),
    requiresAck: !resolveHardViolationRelease_(result.violations, '')
  };
}

/**
 * 供前端呼叫：檢查目前最新版本的硬規則放行文字是否正確。純讀取，讓前端可以
 * 在真正呼叫會消耗資源的函式之前，先驗證使用者打的文字對不對。
 * @param {string} quarterId 季度 ID
 * @param {string} releaseText 使用者輸入的放行文字
 * @returns {{ok: boolean, violations: Object[]}}
 */
function apiStep5CheckRelease(quarterId, releaseText) {
  assertWebAppRequestAllowed_();
  const changed = planStep5ChangedList_(quarterId);
  const violations = recomputeLatestVersionViolations_(quarterId, changed.versionNo);
  return { ok: resolveHardViolationRelease_(violations, releaseText), violations: violations.map(mapViolationForClient_) };
}

/**
 * 供前端呼叫：產生本輪改動者的個人 PDF（可能要按時間預算分批、重複呼叫）。
 *
 * **這裡是步驟 5 兩個真正的硬規則關卡之一**：如果目前最新版本仍有硬規則違反，
 * 一律要求 `releaseText` 等於「確認放行」才會真正執行，不會因為前端畫面順序
 * 而被繞過——即使有人跳過「看過違規畫面」這一步直接呼叫這個函式，一樣會被擋下來。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} releaseText 硬規則放行文字（沒有硬規則違反時可傳空字串）
 * @returns {Object} 這一批的產生進度；`blocked:true` 時代表被硬規則關卡擋住
 */
function apiStep5GeneratePdfs(quarterId, releaseText) {
  assertWebAppRequestAllowed_();
  const changed = planStep5ChangedList_(quarterId);
  const violations = recomputeLatestVersionViolations_(quarterId, changed.versionNo);
  if (!resolveHardViolationRelease_(violations, releaseText)) {
    return { blocked: true, violations: violations.map(mapViolationForClient_) };
  }
  const hardForPdf = violations.filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hardForPdf.length > 0) logHardViolationRelease_(quarterId, '步驟 5：改動後重發（Web UI，產生 PDF）', hardForPdf);
  if (changed.changedList.length === 0) {
    return { blocked: false, done: true, doneCount: 0, totalPeople: 0, noChanges: true };
  }
  const pdfResult = executeStep5GeneratePdfs_(quarterId, changed.versionNo, changed.changedList);
  return {
    blocked: false, done: pdfResult.done, doneCount: pdfResult.doneCount, totalPeople: pdfResult.totalPeople,
    errors: pdfResult.errors
  };
}

/**
 * 供前端呼叫：步驟 5 第三畫面（3/3）的資料。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `mode='NO_CHANGES'` 時代表沒有改動需要重發；否則附完整名單與統計
 */
function apiStep5SendPreview(quarterId) {
  assertWebAppRequestAllowed_();
  const changed = planStep5ChangedList_(quarterId);
  if (changed.changedList.length === 0) return { mode: 'NO_CHANGES', versionNo: changed.versionNo };

  const preview = planStep5SendPreview_(quarterId, changed.versionNo, changed.context, changed.changedList);
  const changedForClient = preview.changedList.map(function (c) {
    const person = changed.context.peopleById[c.personId];
    return {
      nameTC: c.nameTC,
      hasAssignments: c.hasAssignments,
      firstNotifyDueToEmail: !!c.firstNotifyDueToEmail,
      hasEmail: !!(person && person.email)
    };
  });

  return {
    mode: 'READY',
    versionNo: changed.versionNo,
    changedList: changedForClient,
    noEmailCount: preview.noEmailList.length,
    personSendableCount: preview.personSendableCount,
    listRecipientCount: preview.listRecipientCount,
    isDryRun: preview.isDryRun
  };
}

/**
 * 供前端呼叫：實際寄送（步驟 5 的最終動作）。**這是步驟 5 第二個、也是最關鍵的
 * 硬規則關卡**——真正會呼叫 `MailApp`（DRY_RUN=FALSE 時）之前，重新讀一次目前
 * 最新版本的違規狀況，沒有正確的放行文字一律拒絕執行。
 * @param {string} quarterId 季度 ID
 * @param {string} releaseText 硬規則放行文字（沒有硬規則違反時可傳空字串）
 * @returns {Object} 寄送結果；`blocked:true` 時代表被硬規則關卡擋住，或沒有改動需要重發
 */
function apiStep5SendConfirm(quarterId, releaseText) {
  assertWebAppRequestAllowed_();
  const changed = planStep5ChangedList_(quarterId);
  const violations = recomputeLatestVersionViolations_(quarterId, changed.versionNo);
  if (!resolveHardViolationRelease_(violations, releaseText)) {
    return { blocked: true, violations: violations.map(mapViolationForClient_) };
  }
  const hardForSend = violations.filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hardForSend.length > 0) logHardViolationRelease_(quarterId, '步驟 5：改動後重發（Web UI，寄送）', hardForSend);
  if (changed.changedList.length === 0) return { blocked: false, noChanges: true };

  const sendResult = executeStep5Send_(quarterId, changed.versionNo, changed.changedList);
  return {
    blocked: false,
    isDryRun: sendResult.isDryRun, sent: sendResult.sent, dryRun: sendResult.dryRun,
    skipped: sendResult.skipped, failed: sendResult.failed,
    errorPdf: sendResult.errorPdf, errorPdfMissing: sendResult.errorPdfMissing
  };
}
