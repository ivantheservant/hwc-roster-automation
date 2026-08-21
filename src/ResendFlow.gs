/**
 * 「步驟 5：改動後重發」的核心：OFFICIAL_SENT 之後如果有人手調動，套用 Requests、
 * 產生新版本、比對出這一輪跟上次寄出時內容不同的人，只為這些人產生新版個人 PDF、
 * 只寄給這些人 + 一份 LIST 摘要，不騷擾內容沒有改動的人。
 *
 * 「套用 Requests」直接重用既有的 planApplyRequests_()／applyRequests_()
 * （RequestsApply.gs，完全不修改，只多傳一個 basis='RESEND'）；
 * 「產生 PDF」直接重用 generatePersonalPdfBatchForPeople_()（PdfBatch.gs）；
 * 這個檔案只新增「比對改動者」與「寄送」這兩步。入口見 FourStageFlow.gs 的
 * runFourStageStep5_()，選單登記在 Menu.gs。
 *
 * 不重用 sendStage()：findEmailTemplate_() 依 Stage 找範本，Stage=RESEND 現在
 * 同時有 TPL_RESEND_TC（PERSON）與 TPL_RESEND_LIST_TC（LIST）兩個範本，
 * 依 Stage 找會有歧義（見 Mailer.gs 的 findEmailTemplate_() 檔頭註解）。
 * sendResendStage_() 改用 findEmailTemplateById_() 直接指定各自要用哪一個範本，
 * 逐一收件人仍沿用既有的 deliverOne_()，不重寫寄信邏輯本身。
 */

/**
 * 比對「這一版每個人的派工」跟「SendLog 記錄的上次已確實處理（見
 * Mailer.gs 的 readLastSendRecordByPerson_() 的 Status 白名單）hash」，
 * 找出這一版跟上次寄出時內容不同、或雖然內容沒變但仍然需要通知的人。
 *
 * 涵蓋範圍含被整個頂走、這一版一格派工都沒有的人：這種人 assignments=[]、
 * newHash=ASSIGNMENT_HASH_EMPTY，只要上次確實寄送過（oldHash 是別的值），
 * 一樣會被判定為「改動」，不需要另外特別處理——這正是「服侍次數減少到零的人
 * 一樣要收信」的根據所在，不是額外加上去的規則，是 hash 比對本身自然涵蓋的結果。
 *
 * 追加階段 AO：另外涵蓋「hash 沒變，但上次因查無電郵而略過（Status=
 * SKIPPED_NO_EMAIL）、現在 NameMapping 已經補上電郵」這種人——對這個人來說，
 * 這其實是他第一次真正收到通知，不能因為派工內容沒變就跳過，否則他永遠不會
 * 收到任何通知。這種情況用 `firstNotifyDueToEmail` 標記，供呼叫端在確認對話框
 * 與有改動者區分顯示。
 *
 * @param {Object} context buildMailContext_(quarterId, versionNo, MAIL_STAGES.RESEND) 的結果
 * @returns {Object[]} 每項為 {personId, nameTC, hasAssignments, assignments, oldHash, newHash,
 *   firstNotifyDueToEmail}，依 PersonID 排序
 */
function computeResendDiff_(context) {
  const personIds = {};
  Object.keys(context.assignmentsByPerson).forEach(function (id) { personIds[id] = true; });
  Object.keys(context.lastHashByPerson || {}).forEach(function (id) { personIds[id] = true; });

  const changed = [];
  Object.keys(personIds).sort().forEach(function (personId) {
    const assignments = context.assignmentsByPerson[personId] || [];
    const newHash = computeAssignmentHash_(assignments);
    const oldHash = (context.lastHashByPerson || {})[personId] || '';
    const hashChanged = newHash !== oldHash;

    const person = context.peopleById[personId];
    const lastStatus = (context.lastStatusByPerson || {})[personId] || '';
    const nowHasEmail = !!(person && person.email);
    const firstNotifyDueToEmail = !hashChanged && lastStatus === MAIL_STATUS.SKIPPED_NO_EMAIL && nowHasEmail;

    if (!hashChanged && !firstNotifyDueToEmail) return;

    changed.push({
      personId: personId,
      nameTC: person ? person.nameTC : personId,
      hasAssignments: assignments.length > 0,
      assignments: assignments,
      oldHash: oldHash,
      newHash: newHash,
      firstNotifyDueToEmail: firstNotifyDueToEmail,
      // 第三十三輪批次階段 A：把「為什麼要寄」明明白白帶出去，讓下游
      // deliverOne_() 直接執行這個決定，不要再自己用 hash 判斷一次。
      // hashChanged 優先——兩者同時成立時，派工真的改了才是主要原因。
      notifyReason: hashChanged
        ? RESEND_NOTIFY_REASON.ASSIGNMENT_CHANGED
        : RESEND_NOTIFY_REASON.FIRST_NOTIFY_AFTER_EMAIL_ADDED
    });
  });
  return changed;
}

/**
 * 把被改動者名單整理成 TPL_RESEND_LIST_TC 的 {ChangedPeopleSummary} 內容：
 * 每人一行「姓名：日期 崗位；日期 崗位」。完全沒有派工的人（被整個頂走）
 * 另外用一句話說明，不直接接 buildAssignmentSummary_([]) 的空字串——
 * 跟 Mailer.gs 的 deliverOne_() 給零派工 PERSON 收件人用的替代句同一個理由，
 * 避免讀起來斷掉（「姓名：」後面直接空白）。
 * @param {Object[]} changedList computeResendDiff_() 的結果
 * @param {Object} context buildMailContext_() 的結果
 * @returns {string} 供 applyPlaceholders_() 代入 {ChangedPeopleSummary} 的文字
 */
function buildChangedPeopleSummaryText_(changedList, context) {
  if (changedList.length === 0) return '（本輪沒有任何人異動）';
  return changedList.map(function (c) {
    const summary = c.hasAssignments
      ? buildAssignmentSummary_(c.assignments, context.postNames, context.timezone)
      : '本季暫時沒有任何服侍安排';
    return c.nameTC + '：' + summary;
  }).join('\n');
}

/**
 * 步驟 5「改動後重發」的實際寄送：只寄給 changedPersonIds 名單中的人
 * （PERSON，用 TPL_RESEND_TC）＋ EmailRecipients 中 Stage 欄含 RESEND 的名單
 * （LIST，用 TPL_RESEND_LIST_TC，內容為本輪異動摘要）。
 *
 * 呼叫前必須已經產生好 changedPersonIds 中「有派工」那些人的個人 PDF
 * （見 generatePersonalPdfBatchForPeople_()）；沒有派工的人不需要 PDF，
 * generateMailAttachment_() 既有的零派工略過附件邏輯會處理。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號（套用 Requests 後的新版本）
 * @param {string[]} changedPersonIds 這一輪判定為「有改動」的 PersonID 清單
 *   （來自 computeResendDiff_()，含零派工的被頂走者）
 * @returns {{sent: number, dryRun: number, skipped: number, unchanged: number, failed: number,
 *   errorPdf: number, errorPdfMissing: number, isDryRun: boolean, noEmailPeople: string[],
 *   retryCount: number, durationMs: number, changedCount: number, listRecipientCount: number}}
 *   各類結果的統計
 */
function sendResendStage_(quarterId, versionNo, changedPersonIds, sendOptions) {
  assertNotPreviewMode_('sendResendStage_');
  const startedAt = Date.now();
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;

  const personTemplate = findEmailTemplateById_('TPL_RESEND_TC');
  if (!personTemplate) throw new Error('EmailTemplates 找不到 TPL_RESEND_TC，請先執行「維護 ▸ 補齊 Email 範本」');
  const listTemplate = findEmailTemplateById_('TPL_RESEND_LIST_TC');
  if (!listTemplate) throw new Error('EmailTemplates 找不到 TPL_RESEND_LIST_TC，請先執行「維護 ▸ 補齊 Email 範本」');

  // 需求 3：附件要存 Shared Drive 時，一開始就驗證資料夾，無效立即中止——
  // 跟 sendStage() 同一個把關理由，這裡兩個範本都需要附件（PERSONAL_PDF／FULL_PDF）。
  resolveMailAttachmentFolder_();

  const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.RESEND);
  const changedList = computeResendDiff_(context);
  context.placeholders.ChangedPeopleSummary = buildChangedPeopleSummaryText_(changedList, context);

  // 第三十三輪批次階段 A：把上游的決定交給下游執行。
  //
  // computeResendDiff_() 已經逐個人判斷過「要不要寄、為什麼要寄」，
  // deliverOne_() 讀這一份就夠，不需要（也不可以）再用 hash 判斷一次。
  // 第三十二輪實測踩到的 bug 正是 deliverOne_() 自己再判斷一次，
  // 把上游決定要寄的人擋了下來——見 Constants.gs 的 RESEND_NOTIFY_REASON。
  // ⚠️ 第四十輪批次 A 組：三個決定喺呢度一次過解析完，
  // 落到 `deliverOne_()` 嗰一層已經係結論（理由見 SendOptions.gs 檔頭）。
  context.sendDecision = resolveSendOptions_(
    MAIL_STAGES.RESEND, sendOptions, { person: personTemplate, list: listTemplate });

  context.notifyReasonByPerson = {};
  changedList.forEach(function (c) {
    context.notifyReasonByPerson[c.personId] = c.notifyReason;
  });

  const outcomes = [];
  // 階段 G：跟 sendStage() 同一個理由，分批寫入 SendLog，見 Mailer.gs 的說明。
  const flushBatchSize = Number(getConfig(CONFIG_KEYS.SEND_LOG_FLUSH_BATCH_SIZE, DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE)) || DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE;
  let flushedCount = 0;
  const maybeFlush_ = function () {
    if (outcomes.length - flushedCount >= flushBatchSize) {
      writeSendLogRows_(outcomes.slice(flushedCount), context);
      flushedCount = outcomes.length;
    }
  };

  // ⚠️ 第四十輪批次 A 組：收件範圍。
  //
  // 呢個決定**一定要喺呢度做**——即係喺 `deliverOne_()` 上游。
  // 落咗去先篩，就變返第三十三輪嗰個 bug（下游自己重新判斷要唔要寄）。
  //
  //   CHANGED_ONLY　呼叫端傳落嚟嗰批（＝今日嘅行為）
  //   ALL　　　　　　呢一版有派工嘅、加上一次收過信嘅（同 listRecipients_ 一致）
  //   PICK　　　　　幹事逐個揀嗰批
  const decision = context.sendDecision;
  let targetPersonIds = changedPersonIds.slice();
  if (decision.recipientScope === SEND_RECIPIENT_SCOPE.ALL) {
    const everyone = {};
    Object.keys(context.assignmentsByPerson || {}).forEach(function (id) { everyone[id] = true; });
    Object.keys(context.lastHashByPerson || {}).forEach(function (id) { everyone[id] = true; });
    targetPersonIds = Object.keys(everyone);
    // ⚠️ 幹事揀咗「全部人」＝ 佢明知內容可能冇變都要寄。
    // `deliverOne_()` 嗰個 hash 保險絲會把「內容冇變」嘅人擋走，
    // 所以要喺呢度俾佢哋一個理由——同 `RESEND_ONLY_CHANGED=FALSE` 同一個意思。
    targetPersonIds.forEach(function (id) {
      if (!context.notifyReasonByPerson[id]) {
        context.notifyReasonByPerson[id] = '幹事選擇寄給全部人';
      }
    });
  } else if (decision.recipientScope === SEND_RECIPIENT_SCOPE.PICK) {
    targetPersonIds = targetPersonIds.filter(function (id) {
      return decision.pickedKeys[id] === true;
    });
    // 幹事揀咗一個唔喺「有改動」名單入面嘅人 ⇒ 照樣寄俾佢。
    Object.keys(decision.pickedKeys).forEach(function (key) {
      if (key.indexOf('LIST:') === 0) return;
      if (targetPersonIds.indexOf(key) === -1) {
        targetPersonIds.push(key);
        context.notifyReasonByPerson[key] = '幹事指定要寄給這一位';
      }
    });
  }

  targetPersonIds.slice().sort().forEach(function (personId) {
    const person = context.peopleById[personId];
    const recipient = {
      type: RECIPIENT_TYPE.PERSON,
      personId: personId,
      email: person ? person.email : '',
      displayName: person ? person.nameTC : personId,
      sendAs: SEND_AS.TO
    };
    outcomes.push(deliverOne_(recipient, personTemplate, context, isDryRun));
    maybeFlush_();
  });

  // ⚠️ 第四十六輪批次 A 組：`LIST` 嗰邊個池一樣要跟幹事嘅選擇。
  //
  // 本來個池係 `listRecipients_(RESEND, …)`，即係只有 `Stage` 欄寫住
  // 包含 RESEND 嗰幾行。幹事勾咗一個冇標 RESEND 嘅地址，就會靜靜寄唔到
  // ——而畫面照樣把佢算入「已選 N 位」。
  const listRecipients = filterRecipientsByScope_(
    resolveSendRecipientPool_(MAIL_STAGES.RESEND, context, decision)
      .filter(function (r) { return r.type === RECIPIENT_TYPE.LIST; }),
    decision);
  listRecipients.forEach(function (recipient) {
    outcomes.push(deliverOne_(recipient, listTemplate, context, isDryRun));
    maybeFlush_();
  });

  const noEmailPeople = outcomes
    .filter(function (o) { return o.status === MAIL_STATUS.SKIPPED_NO_EMAIL; })
    .map(function (o) { return o.displayName + '（' + o.personId + '）'; });

  if (flushedCount < outcomes.length) writeSendLogRows_(outcomes.slice(flushedCount), context);
  if (noEmailPeople.length > 0) notifyAdminNoEmail_(noEmailPeople, context, isDryRun);

  const retryCount = outcomes.reduce(function (sum, o) { return sum + (o.retries || 0); }, 0);

  // 階段 F 新增：跟 sendStage() 同一套批次記錄方式。
  writeAuditLog_({
    action: '寄送批次',
    targetSheet: SHEETS.SEND_LOG,
    targetKey: 'SEND-' + compactTimestamp_(),
    newValue: 'Stage=' + MAIL_STAGES.RESEND + '　收件人=' + outcomes.length
      + '　模式=' + (isDryRun ? 'DRY_RUN（模擬）' : '正式寄出'),
    source: 'sendResendStage_',
    notes: '成功=' + countStatus_(outcomes, MAIL_STATUS.SENT) + '　模擬=' + countStatus_(outcomes, MAIL_STATUS.DRY_RUN)
      + '　查無電郵=' + countStatus_(outcomes, MAIL_STATUS.SKIPPED_NO_EMAIL) + '　失敗=' + countStatus_(outcomes, MAIL_STATUS.FAILED)
      // 第四十輪批次 A 組：今次用咗咩選項（同 sendStage() 一致）。
      + '　' + describeSendDecision_(context.sendDecision)
  });

  return {
    sent: countStatus_(outcomes, MAIL_STATUS.SENT),
    dryRun: countStatus_(outcomes, MAIL_STATUS.DRY_RUN),
    skipped: countStatus_(outcomes, MAIL_STATUS.SKIPPED_NO_EMAIL),
    unchanged: countStatus_(outcomes, MAIL_STATUS.SKIPPED_UNCHANGED),
    failed: countStatus_(outcomes, MAIL_STATUS.FAILED),
    errorPdf: countStatus_(outcomes, MAIL_STATUS.ERROR_PDF),
    errorPdfMissing: countStatus_(outcomes, MAIL_STATUS.ERROR_PDF_MISSING),
    isDryRun: isDryRun,
    noEmailPeople: noEmailPeople,
    retryCount: retryCount,
    durationMs: Date.now() - startedAt,
    changedCount: changedPersonIds.length,
    listRecipientCount: listRecipients.length
  };
}
