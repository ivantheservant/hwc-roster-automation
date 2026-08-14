/**
 * 執行指定階段的電郵寄送流程。
 *
 * 安全機制：本函式（以及它呼叫的所有函式）在 Config 的 DRY_RUN=TRUE 時
 * 絕不呼叫 MailApp/GmailApp，只把每一封本應寄出的信寫入 SendLog，Status 填 DRY_RUN。
 *
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段：GENERATE / REMIND / OFFICIAL / RESEND
 * @returns {{sent: number, dryRun: number, skipped: number, unchanged: number, failed: number,
 *   errorPdf: number, errorPdfMissing: number, isDryRun: boolean, noEmailPeople: string[],
 *   retryCount: number, durationMs: number}} 各類結果的統計
 */
function sendStage(quarterId, versionNo, stage) {
  assertNotPreviewMode_('sendStage');
  // 追加階段 N：OFFICIAL 永遠不可以由自動排程觸發，結構性防護見 Trigger.gs 的
  // assertOfficialNotFromAutomationTrigger_()——目前 dailyAutomationCheck_() 根本
  // 沒有任何路徑會走到這裡，這一行是防日後不小心改壞的第二道防線。
  if (stage === MAIL_STAGES.OFFICIAL) assertOfficialNotFromAutomationTrigger_(quarterId);
  const startedAt = Date.now();
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const template = findEmailTemplate_(stage);
  if (!template) throw new Error('EmailTemplates 中找不到 Stage=' + stage + ' 的範本（也沒有 OFFICIAL 可退回使用）');

  // 需求 3：附件要存 Shared Drive 時，一開始就驗證資料夾，無效立即中止——
  // 不要讓 58 人的迴圈跑到一半才發現存不了（曾經花 538 秒才報錯）。
  // 這裡涵蓋選單與自動排程兩個呼叫路徑，是唯一的把關點。
  const attachType = String(template.attachType || ATTACH_TYPE.NONE).toUpperCase();
  if (attachType === ATTACH_TYPE.FULL_PDF || attachType === ATTACH_TYPE.PERSONAL_PDF) {
    resolveMailAttachmentFolder_();
  }

  const context = buildMailContext_(quarterId, versionNo, stage);
  const outcomes = [];

  // 階段 G 新增：原本 SendLog 只在整批寄完之後才一次寫入——如果 Apps Script
  // 在迴圈中途逾時（6 分鐘執行上限），已經真正寄出的信會完全沒有任何 SendLog
  // 紀錄，重新執行時無法判斷哪些人已經收過信，等於「做了一半又不知道做到哪」。
  // 改成每 SEND_LOG_FLUSH_BATCH_SIZE 個收件人就先把已處理的部分寫入，把「逾時時
  // 最多遺失幾筆紀錄」的曝險範圍從「整批」縮小到「還沒寫入的最後一小段」。
  // 注意：這不是完整的「安全重試」——重新執行 OFFICIAL／GENERATE／REVIEW 仍然會
  // 對全部收件人重新寄送一次（不像 RESEND 有 lastHashByPerson 判斷「內容沒變就
  // 跳過」），只是把「完全沒有任何紀錄」的最壞情況縮小成「有紀錄、只是不完整」。
  const flushBatchSize = Number(getConfig(CONFIG_KEYS.SEND_LOG_FLUSH_BATCH_SIZE, DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE)) || DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE;
  let flushedCount = 0;
  listRecipients_(stage, context).forEach(function (recipient) {
    outcomes.push(deliverOne_(recipient, template, context, isDryRun));
    if (outcomes.length - flushedCount >= flushBatchSize) {
      writeSendLogRows_(outcomes.slice(flushedCount), context);
      flushedCount = outcomes.length;
    }
  });

  const noEmailPeople = outcomes
    .filter(function (o) { return o.status === MAIL_STATUS.SKIPPED_NO_EMAIL; })
    .map(function (o) { return o.displayName + '（' + o.personId + '）'; });

  if (flushedCount < outcomes.length) writeSendLogRows_(outcomes.slice(flushedCount), context);
  if (noEmailPeople.length > 0) notifyAdminNoEmail_(noEmailPeople, context, isDryRun);

  const retryCount = outcomes.reduce(function (sum, o) { return sum + (o.retries || 0); }, 0);

  // 階段 F 新增：每次寄送批次記一筆 AuditLog（批次 ID、收件人數、模式）。
  // SendLog 本身沒有 BatchID 欄，這裡的批次 ID 只用於 AuditLog，不寫回 SendLog。
  writeAuditLog_({
    action: '寄送批次',
    targetSheet: SHEETS.SEND_LOG,
    targetKey: 'SEND-' + compactTimestamp_(),
    newValue: 'Stage=' + stage + '　收件人=' + outcomes.length
      + '　模式=' + (isDryRun ? 'DRY_RUN（模擬）' : '正式寄出'),
    source: 'sendStage',
    notes: '成功=' + countStatus_(outcomes, MAIL_STATUS.SENT) + '　模擬=' + countStatus_(outcomes, MAIL_STATUS.DRY_RUN)
      + '　查無電郵=' + countStatus_(outcomes, MAIL_STATUS.SKIPPED_NO_EMAIL) + '　失敗=' + countStatus_(outcomes, MAIL_STATUS.FAILED)
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
    durationMs: Date.now() - startedAt
  };
}

/**
 * 讀取寄信所需的全部資料。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段
 * @returns {Object} 供寄信流程使用的 context
 */
function buildMailContext_(quarterId, versionNo, stage) {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const assignments = readSheet(SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID],
        slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID]
      };
    });

  const quarter = findQuarter_(quarterId) || {};
  const postNames = {};
  readPostsNormalized().forEach(function (p) { postNames[p.postId] = p.postNameTC; });

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    stage: stage,
    timezone: timezone,
    assignments: assignments,
    assignmentsByPerson: groupAssignmentsByPerson_(assignments),
    postNames: postNames,
    peopleById: indexPeopleById_(),
    subjectPrefix: String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || ''),
    senderName: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || ''),
    replyTo: String(config[CONFIG_KEYS.MAIL_REPLY_TO] || ''),
    adminEmail: String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || ''),
    lastHashByPerson: readLastHashByPerson_(quarterId),
    // 追加階段 AO：只有步驟 5 的 computeResendDiff_() 會用到，OFFICIAL／其他階段
    // 多讀這一份小資料的成本可忽略，不特地依 stage 條件略過，維持 context 建構邏輯單純。
    lastStatusByPerson: readLastStatusByPerson_(quarterId),
    placeholders: {
      QuarterID: quarterId,
      VersionNo: 'v' + versionNo,
      StartDate: toDateString(quarter[COLUMNS.QUARTERS.START_DATE], timezone),
      EndDate: toDateString(quarter[COLUMNS.QUARTERS.END_DATE], timezone),
      OfficialSendDate: toDateString(quarter[COLUMNS.QUARTERS.OFFICIAL_SEND_ON], timezone),
      SpreadsheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      // 第三輪批次下一輪（新一批階段 B）新增：目前的四階段流程 Stage 與建議下一步，
      // 供 docs/系統範圍稽核.md 建議的新 TPL_REMIND_TC 範本使用。用 try/catch
      // 包住——buildMailContext_() 本來就會在 GENERATE／OFFICIAL 等各種階段被呼叫，
      // 不希望這兩個新欄位的計算意外令其他階段的寄送失敗；查不到就留空，
      // applyPlaceholders_() 的清理機制會處理掉範本裡對應的 {CurrentStage}／
      // {NextAction} 文字，不會露出未代入的花括號。
      CurrentStage: resolveCurrentStageForPlaceholder_(quarterId),
      NextAction: resolveNextActionForPlaceholder_(quarterId)
    }
  };
}

/**
 * 供 {CurrentStage} placeholder 使用：查詢目前的 Quarters.Stage，查不到（例如
 * 季度不存在、Stage 欄缺失）就回傳空字串，不拋錯——見 buildMailContext_() 的
 * 說明，這裡不能讓一個顯示用的小欄位打斷整個寄信流程。
 * @param {string} quarterId 季度 ID
 * @returns {string} Stage 值；查不到回傳空字串
 */
function resolveCurrentStageForPlaceholder_(quarterId) {
  try {
    return getQuarterStage_(quarterId);
  } catch (err) {
    return '';
  }
}

/**
 * 供 {NextAction} placeholder 使用：依目前 Stage 查 STAGE_NEXT_ACTION
 * （Constants.gs）。Stage 是 OFFICIAL_SENT 或查詢失敗時回傳空字串——
 * OFFICIAL_SENT 代表流程已經走完，沒有「下一步」這個概念。
 * @param {string} quarterId 季度 ID
 * @returns {string} 建議下一步的選單路徑文字；不適用時回傳空字串
 */
function resolveNextActionForPlaceholder_(quarterId) {
  const stage = resolveCurrentStageForPlaceholder_(quarterId);
  return STAGE_NEXT_ACTION[stage] || '';
}

/**
 * 把派工紀錄按 PersonID 分組，並在組內按日期、崗位、slot 排序。
 * @param {Object[]} assignments 派工紀錄
 * @returns {Object.<string, Object[]>} {PersonID: [派工紀錄...]}
 */
function groupAssignmentsByPerson_(assignments) {
  const byPerson = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!byPerson[a.personId]) byPerson[a.personId] = [];
    byPerson[a.personId].push(a);
  });
  Object.keys(byPerson).forEach(function (personId) {
    byPerson[personId].sort(function (x, y) {
      const key1 = x.serviceDate + '|' + x.postId + '|' + x.slotIndex;
      const key2 = y.serviceDate + '|' + y.postId + '|' + y.slotIndex;
      return key1 < key2 ? -1 : (key1 > key2 ? 1 : 0);
    });
  });
  return byPerson;
}

/**
 * 建立 PersonID 對人員資料的索引（含電郵與個人季度上限）。
 * @returns {Object.<string, Object>} {PersonID: {personId, nameTC, email, maxPerQuarter}}
 */
function indexPeopleById_() {
  const map = {};
  readPeople().forEach(function (row) {
    const personId = row[COLUMNS.NAME_MAPPING.PERSON_ID];
    const rawMax = row[COLUMNS.NAME_MAPPING.MAX_PER_QUARTER];
    map[personId] = {
      personId: personId,
      nameTC: row[COLUMNS.NAME_MAPPING.NAME_TC],
      email: String(row[COLUMNS.NAME_MAPPING.EMAIL] || '').trim(),
      maxPerQuarter: (rawMax === '' || rawMax === null || rawMax === undefined) ? null : Number(rawMax)
    };
  });
  return map;
}

/**
 * 列出本階段的收件人。
 * LIST 類別來自 EmailRecipients：一般階段看 Stage 欄是否包含本階段；
 * REVIEW 階段（四階段流程的「步驟 2：寄給堂委審閱」）例外，完全依 Role=REVIEWER
 * 判斷（見 EmailRecipientsSeed.gs 的 `isReviewerRecipientRow_()`，與
 * `countReviewerRecipients_()` 共用同一條件，不會出現兩邊各自實作、改一邊漏一邊的情況），
 * 不理 Stage 欄——審閱者不一定跟 GENERATE/REMIND/OFFICIAL/RESEND 的名單重疊。
 * PERSON 類別只在 OFFICIAL 與 RESEND 階段產生，對象為本季有被派工的人。
 *
 * Role 欄兩個值的實際意思（階段 D，詳見 EmailRecipientsSeed.gs 檔頭說明）：
 * REVIEWER＝會收步驟 2 的審閱信；ALL＝不會收步驟 2 的審閱信，只依 Stage 欄決定
 * 其餘階段收不收——ALL 這個名稱容易誤會成「所有階段都收」，實際意思剛好相反。
 *
 * 步驟 5「改動後重發」：RESEND 階段的 PERSON 名單另外納入「這一版完全沒有任何
 * 派工、但 SendLog 有上次寄送紀錄」的人——即被整個頂走、這一版一格都沒有的人。
 * 這種人不會出現在 context.assignmentsByPerson（那個物件只收有派工的人），
 * 原本的邏輯完全不會通知到他們，違反「被頂走、服侍次數減少到零的人一樣要收信」
 * 的要求。多納入的人如果 hash 其實沒變（例如連續兩次重發都是零派工），
 * deliverOne_() 既有的「未變略過」判斷會照常正確跳過，不會重複騷擾。
 * OFFICIAL 階段完全不受影響（OFFICIAL 從來不會有「上次寄送紀錄」這種情況，
 * 因為 OFFICIAL 是這一季第一次正式寄送）。
 *
 * @param {string} stage 寄送階段
 * @param {Object} context 寄信 context
 * @returns {Object[]} 收件人陣列
 */
function listRecipients_(stage, context) {
  const recipients = [];

  readSheet(SHEETS.EMAIL_RECIPIENTS).forEach(function (row) {
    if (!isTrueValue_(row[COLUMNS.EMAIL_RECIPIENTS.ACTIVE])) return;

    if (stage === MAIL_STAGES.REVIEW) {
      if (!isReviewerRecipientRow_(row)) return;
    } else {
      const stages = splitList_(row[COLUMNS.EMAIL_RECIPIENTS.STAGE]);
      if (stages.indexOf(stage) === -1) return;
    }

    recipients.push({
      type: RECIPIENT_TYPE.LIST,
      personId: '',
      email: String(row[COLUMNS.EMAIL_RECIPIENTS.EMAIL] || '').trim(),
      displayName: row[COLUMNS.EMAIL_RECIPIENTS.DISPLAY_NAME] || '',
      sendAs: String(row[COLUMNS.EMAIL_RECIPIENTS.SEND_AS] || SEND_AS.TO).toUpperCase()
    });
  });

  if (stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND) {
    const personIds = {};
    Object.keys(context.assignmentsByPerson).forEach(function (id) { personIds[id] = true; });
    if (stage === MAIL_STAGES.RESEND) {
      Object.keys(context.lastHashByPerson || {}).forEach(function (id) { personIds[id] = true; });
    }
    Object.keys(personIds).sort().forEach(function (personId) {
      const person = context.peopleById[personId];
      recipients.push({
        type: RECIPIENT_TYPE.PERSON,
        personId: personId,
        email: person ? person.email : '',
        displayName: person ? person.nameTC : personId,
        sendAs: SEND_AS.TO
      });
    });
  }

  return recipients;
}

/**
 * 處理單一收件人：計算 hash、判斷是否需要寄、產生附件、組出內容，
 * 並在 DRY_RUN=FALSE 時才真正寄出。回傳結果供寫入 SendLog。
 *
 * 附件無論有沒有電郵都會產生（只要範本有設定 AttachType），
 * 讓幹事／管理員可以到 Shared Drive 核對內容；只有「真正寄出」這一步
 * 才會因為沒有電郵或 DRY_RUN 而略過。
 *
 * @param {Object} recipient 收件人資料
 * @param {Object} template 電郵範本
 * @param {Object} context 寄信 context
 * @param {boolean} isDryRun 是否為測試模式
 * @returns {Object} 這封信的處理結果
 */
function deliverOne_(recipient, template, context, isDryRun) {
  const personAssignments = recipient.personId
    ? (context.assignmentsByPerson[recipient.personId] || [])
    : [];
  const hash = recipient.personId ? computeAssignmentHash_(personAssignments) : '';

  // 步驟 5「改動後重發」：RESEND 現在也會通知「這一版完全沒有任何派工」的人
  // （見 listRecipients_() 的說明），這種人 buildAssignmentSummary_() 會回傳空字串，
  // 直接代入 {AssignmentSummary} 會產生一段讀起來斷掉的信（「服侍安排如下：」
  // 後面卻是空白）。這裡在代入範本之前，用一句文意通順的替代文字頂上——只在
  // 真正是 PERSON 收件人、且真的沒有任何派工時套用，LIST 收件人與有派工的人
  // 完全不受影響（OFFICIAL 階段的 PERSON 收件人一定有派工，這段邏輯對它是死碼，
  // 不會改變 OFFICIAL 的行為）。
  const summary = (recipient.type === RECIPIENT_TYPE.PERSON && personAssignments.length === 0)
    ? '本季您暫時沒有任何服侍安排，因此本次未附上個人職事表。'
    : buildAssignmentSummary_(personAssignments, context.postNames, context.timezone);

  const base = {
    recipientType: recipient.type,
    personId: recipient.personId,
    email: recipient.email,
    displayName: recipient.displayName,
    hash: hash,
    summary: summary,
    attachmentName: '',
    messageId: '',
    errorMessage: '',
    retries: 0
  };

  // RESEND 且內容未變：預設完全不需要處理，連 PDF 都不必重新產生。
  // Config 的 RESEND_ONLY_CHANGED 可關閉這個判斷（設 FALSE）：例如範本文字本身
  // 改了、派工內容雖然沒變但還是想強制對每個人重寄一次。預設 TRUE，維持原行為。
  const resendOnlyChanged = getConfig(CONFIG_KEYS.RESEND_ONLY_CHANGED, true) === true;
  if (context.stage === MAIL_STAGES.RESEND
      && recipient.type === RECIPIENT_TYPE.PERSON
      && resendOnlyChanged
      && context.lastHashByPerson[recipient.personId] === hash) {
    return Object.assign({}, base, { status: MAIL_STATUS.SKIPPED_UNCHANGED });
  }

  let attachment = null;
  try {
    attachment = generateMailAttachment_(template, context, recipient);
  } catch (err) {
    // 找不到已產生的個人 PDF（err.missing）與真正的產生/存檔失敗要分開記錄，
    // 兩者都停在這裡、不寄出這一封，但不能讓其他收件人也失敗。
    // err.retries 由 fetchWithRetry_ 附加，即使最終失敗也能統計實際重試了幾次。
    return Object.assign({}, base, {
      status: err.missing ? MAIL_STATUS.ERROR_PDF_MISSING : MAIL_STATUS.ERROR_PDF,
      errorMessage: err.message,
      retries: err.retries || 0
    });
  }
  const attachmentName = attachment ? decorateAttachmentName_(attachment) : '';
  base.retries = attachment ? (attachment.retries || 0) : 0;

  if (!recipient.email) {
    return Object.assign({}, base, { status: MAIL_STATUS.SKIPPED_NO_EMAIL, attachmentName: attachmentName });
  }

  const subject = context.subjectPrefix
    + applyPlaceholders_(template.subject, context.placeholders, recipient, summary);
  const bodyHtml = applyPlaceholders_(template.bodyHtml, context.placeholders, recipient, summary);
  const bodyPlain = applyPlaceholders_(template.bodyPlain, context.placeholders, recipient, summary);

  if (isDryRun) {
    log_('INFO', '[DRY_RUN] 不寄出 → ' + recipient.email + ' | ' + subject
      + (attachment ? '（附件已產生：' + attachmentName + '）' : ''));
    return Object.assign({}, base, { status: MAIL_STATUS.DRY_RUN, attachmentName: attachmentName });
  }

  try {
    sendRealEmail_(recipient, subject, bodyHtml, bodyPlain, context, attachment);
    return Object.assign({}, base, { status: MAIL_STATUS.SENT, attachmentName: attachmentName });
  } catch (err) {
    return Object.assign({}, base, { status: MAIL_STATUS.FAILED, errorMessage: err.message, attachmentName: attachmentName });
  }
}

/**
 * 真正寄出一封電郵。呼叫前必須已確認 DRY_RUN=FALSE。
 * 本函式是整個專案唯二呼叫 MailApp.sendEmail() 的地方之一（另一個是 notifyAdmin_()，
 * 供只通知幹事的場合使用），且自身再做一次 DRY_RUN 防呆。
 * @param {Object} recipient 收件人資料
 * @param {string} subject 已組好的標題
 * @param {string} bodyHtml HTML 內文
 * @param {string} bodyPlain 純文字內文
 * @param {Object} context 寄信 context
 * @param {?{blob: Blob}} attachment 已產生的附件；沒有附件時傳 null
 * @returns {void}
 */
function sendRealEmail_(recipient, subject, bodyHtml, bodyPlain, context, attachment) {
  // 防呆：即使呼叫端判斷錯誤，這裡再擋一次
  assertNotPreviewMode_('sendRealEmail_');
  if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== false) {
    throw new Error('DRY_RUN 仍為 TRUE，拒絕寄出');
  }
  const options = { htmlBody: bodyHtml };
  if (context.senderName) options.name = context.senderName;
  if (context.replyTo) options.replyTo = context.replyTo;
  if (attachment && attachment.blob) options.attachments = [attachment.blob];
  MailApp.sendEmail(recipient.email, subject, bodyPlain || '', options);
}

/**
 * 依範本的 AttachType 實際產生附件（PDF），並存入 Shared Drive。
 * NONE 或不適用（例如 PERSONAL_PDF 但收件人不是個人）時回傳 null，不視為錯誤。
 * 真正失敗（找不到工作表、Shared Drive 未設定等）一律 throw，由呼叫端記為 ERROR_PDF。
 *
 * FULL_PDF 在同一次 sendStage() 執行中只會產生與存檔一次（用 context 記住結果），
 * 所有 LIST 收件人共用同一個檔案，不會每個收件人各建一份完整版。
 * 存檔一律經 saveOrOverwriteFile_()：同名檔案先移到垃圾桶再重建，
 * 不會每次執行都在資料夾裡多一個檔案。
 *
 * @param {Object} template 電郵範本
 * @param {Object} context 寄信 context（本函式會在其上暫存 _attachmentFolder* 與
 *   _fullRosterAttachment 欄位，作為同一次執行內的記憶體快取，不寫入任何工作表）
 * @param {Object} recipient 收件人資料
 * @returns {?{blob: Blob, fileName: string, fileId: string, folderName: string, sizeBytes: number, retries: number}}
 *   附件資訊；不需要附件時回傳 null
 */
function generateMailAttachment_(template, context, recipient) {
  const attachType = String(template.attachType || ATTACH_TYPE.NONE).toUpperCase();
  if (attachType === ATTACH_TYPE.NONE || attachType === '') return null;
  if (attachType === ATTACH_TYPE.PERSONAL_PDF && recipient.type !== RECIPIENT_TYPE.PERSON) return null;

  // 步驟 5「改動後重發」：RESEND 現在也會通知「這一版完全沒有任何派工」的人
  // （見 listRecipients_() 的說明），這種人不會有個人 PDF 可以附——PdfBatch.gs
  // 的批次產生本來就會略過沒有派工的人（見 runFourStageStep5_() 只為
  // hasAssignments=true 的被改動者產生 PDF），這裡對應略過附件，不會去找一個
  // 根本不會存在的檔案。原本 lookupExistingPersonalPdf_() 找不到檔案只會拋錯，
  // 變成 ERROR_PDF_MISSING、整封信都不寄，違反「這種人一樣要收信」的要求。
  // OFFICIAL 階段的 PERSON 收件人一定有派工（context.assignmentsByPerson 只收
  // 有派工的人），這段邏輯對它是死碼，不會改變 OFFICIAL 的行為。
  if (attachType === ATTACH_TYPE.PERSONAL_PDF
      && (context.assignmentsByPerson[recipient.personId] || []).length === 0) {
    return null;
  }

  if (attachType === ATTACH_TYPE.FULL_PDF) {
    return buildFullRosterAttachmentCached_(context);
  }

  return lookupExistingPersonalPdf_(context, recipient);
}

/**
 * 讀取已由「產生個人 PDF」（見 PdfBatch.gs 的 generatePersonalPdfBatch_）存在
 * Shared Drive 的個人版 PDF，不再即時匯出。OFFICIAL／RESEND 用這個路徑，
 * 目的是避免逐人即時匯出耗時過長、超過 Apps Script 的執行上限。
 *
 * 找不到檔案、或找到但大小小於 Config 的 PDF_MIN_SIZE_BYTES（追加階段 AG：
 * 0 bytes 或明顯過小的檔案一律當缺件，不會當成正常附件寄出——查證抓到過
 * 這種情況：「產生個人 PDF」把一個內容空白的檔案誤判成功存檔，此處原本沒有
 * 再檢查一次，DRY_RUN=FALSE 時義工會收到一個打不開的附件，系統卻顯示一切正常）
 * 都拋出的例外會標記 err.missing=true，deliverOne_ 據此記為
 * MAIL_STATUS.ERROR_PDF_MISSING（而非產生失敗的 ERROR_PDF），
 * ErrorMessage 明確提示要先執行「產生個人 PDF」。
 *
 * @param {Object} context 寄信 context
 * @param {Object} recipient 收件人資料
 * @returns {{blob: Blob, fileName: string, fileId: string, folderName: string, sizeBytes: number, retries: number}}
 */
function lookupExistingPersonalPdf_(context, recipient) {
  const folder = resolveMailAttachmentFolderCached_(context);
  const personName = lookupPersonName_(recipient.personId);
  const fileName = buildAttachmentName_(context.quarterId, context.versionNo, personName);

  const found = folder.getFilesByName(fileName);
  if (!found.hasNext()) {
    const error = new Error('請先執行『產生個人 PDF』（找不到 ' + fileName + '）');
    error.missing = true;
    throw error;
  }

  const file = found.next();
  const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const sizeBytes = file.getSize();
  if (sizeBytes < minBytes) {
    const error = new Error('找到 ' + fileName + '，但檔案大小只有 ' + sizeBytes + ' bytes'
      + '（門檻 ' + minBytes + ' bytes），懷疑內容空白或截斷，當作缺件處理。'
      + '請重新執行『產生個人 PDF』（記得開啟 Config 的 PDF_REGENERATE_IF_EXISTS 或先移除這個檔案）。');
    error.missing = true;
    throw error;
  }

  return {
    blob: file.getBlob(),
    fileName: fileName,
    fileId: file.getId(),
    folderName: folder.getName(),
    sizeBytes: sizeBytes,
    retries: 0
  };
}

/**
 * 產生（或沿用）整季完整版 PDF 附件，同一次 sendStage() 執行只做一次，
 * 結果暫存在 context._fullRosterAttachment，之後每個收件人直接沿用同一份。
 * @param {Object} context 寄信 context
 * @returns {{blob: Blob, fileName: string, fileId: string, folderName: string, sizeBytes: number, retries: number}} 附件資訊
 */
function buildFullRosterAttachmentCached_(context) {
  if (!context._fullRosterAttachment) {
    applyExportPacing_(context);
    const built = buildFullRosterPdfBlob_(context.quarterId, context.versionNo);
    const folder = resolveMailAttachmentFolderCached_(context);
    const file = saveOrOverwriteFile_(folder, built.fileName, built.blob);
    context._fullRosterAttachment = {
      blob: built.blob,
      fileName: built.fileName,
      fileId: file.getId(),
      folderName: folder.getName(),
      sizeBytes: file.getSize(),
      retries: built.retries || 0
    };
  }
  return context._fullRosterAttachment;
}

/**
 * 在每次真正呼叫 Google 試算表匯出（會打到 UrlFetchApp）之前加入固定間隔，
 * 主動降低觸發速率限制（HTTP 429）的機率，跟 fetchWithRetry_() 的被動重試互補。
 * 第一次匯出不用等，之後每次都先等 PDF_EXPORT_PACING_MS 毫秒（預設 500ms）。
 * 用 context._exportCount 判斷是不是第一次，範圍是單次 sendStage() 執行。
 * @param {Object} context 寄信 context
 * @returns {void}
 */
function applyExportPacing_(context) {
  const pacingMs = Math.max(0, Math.round(
    getConfig(CONFIG_KEYS.PDF_EXPORT_PACING_MS, DEFAULTS.PDF_EXPORT_PACING_MS)));
  if ((context._exportCount || 0) > 0 && pacingMs > 0) {
    Utilities.sleep(pacingMs);
  }
  context._exportCount = (context._exportCount || 0) + 1;
}

/**
 * 解析（或沿用）寄送附件用的 Shared Drive 資料夾，同一次 sendStage() 執行只解析一次。
 *
 * 這是修正「同一批次內有人 ERROR_PDF、有人成功」不一致問題的關鍵：原本每個收件人
 * 各自呼叫 getConfig() 讀 ROSTER_DRIVE_FOLDER_ID，而 getConfig() 背後的 readConfig()
 * 用 CacheService 的腳本快取（5 分鐘 TTL，全腳本共用，不是單次執行內的快取）。
 * 如果快取剛好在 58 人的迴圈跑到一半時過期，前面幾人會讀到舊值（成功），
 * 後面讀到新值（失敗），造成同一批次結果不一致。
 * 現在改為「這次執行只解析一次，之後全部沿用同一個結果」，
 * 資料夾設定無效時，同一批次會全部 ERROR_PDF，不會再有中途變卦的情況。
 *
 * @param {Object} context 寄信 context
 * @returns {Folder} Shared Drive 資料夾
 */
function resolveMailAttachmentFolderCached_(context) {
  if (!context._attachmentFolderResolved) {
    context._attachmentFolderResolved = true;
    try {
      context._attachmentFolder = resolveMailAttachmentFolder_();
    } catch (err) {
      context._attachmentFolderError = err.message;
    }
  }
  if (context._attachmentFolderError) throw new Error(context._attachmentFolderError);
  return context._attachmentFolder;
}

/**
 * 把附件檔名與大小組成一個字串，供寫入 SendLog 的 AttachmentName 欄。
 * @param {{fileName: string, sizeBytes: number}} attachment generateMailAttachment_() 的結果
 * @returns {string} 例如 "2026T4_v7_粵語堂職事表_陳大文.pdf（186 KB）"
 */
function decorateAttachmentName_(attachment) {
  return attachment.fileName + '（' + formatFileSize_(attachment.sizeBytes) + '）';
}

/**
 * 計算某人的 AssignmentHash：把該人全部的 ServiceDate+PostID+SlotIndex 排序後
 * 串接，取 SHA-256 的十六進位前 16 位。內容沒改動時 hash 必定相同。
 *
 * 追加階段 AO：沒有派工時回傳固定標記 `ASSIGNMENT_HASH_EMPTY`（見 Constants.gs），
 * 不再回傳空字串——空字串寫入 SendLog.AssignmentHash 後，跟這一欄「從來沒被寫過」
 * 的真正空白儲存格讀出來完全無法分辨，步驟 5「改動後重發」逐輪比較零派工的人
 * 這一輪跟上一輪是否「同樣是零派工」時，不應該依賴這種巧合式的空字串相等。
 * @param {Object[]} personAssignments 該人的派工紀錄（已排序）
 * @returns {string} 16 位十六進位字串；沒有派工時回傳 `ASSIGNMENT_HASH_EMPTY`
 */
function computeAssignmentHash_(personAssignments) {
  if (personAssignments.length === 0) return ASSIGNMENT_HASH_EMPTY;
  const canonical = personAssignments
    .map(function (a) { return a.serviceDate + '|' + a.postId + '|' + a.slotIndex; })
    .sort()
    .join(';');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  const hex = digest.map(function (byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
  return hex.substring(0, 16);
}

/**
 * 把某人的派工整理成一行摘要，供電郵內文與 SendLog 的 AssignmentSummary 欄使用。
 * 格式「10/04 主席；11/08 報告」：日期格式與分隔符皆從 Config 讀取，按日期順序排列
 * （personAssignments 由 groupAssignmentsByPerson_() 排序，此處不再重排）。
 * @param {Object[]} personAssignments 該人的派工紀錄（已按日期排序）
 * @param {Object.<string, string>} postNames {PostID: 中文崗位名}
 * @param {string} timezone 時區，用於格式化日期
 * @returns {string} 摘要文字；沒有派工時回傳空字串
 */
function buildAssignmentSummary_(personAssignments, postNames, timezone) {
  const dateFormat = String(getConfig(CONFIG_KEYS.MAIL_SUMMARY_DATE_FORMAT, DEFAULTS.MAIL_SUMMARY_DATE_FORMAT));
  const separator = String(getConfig(CONFIG_KEYS.MAIL_SUMMARY_SEPARATOR, DEFAULTS.MAIL_SUMMARY_SEPARATOR));
  const tz = timezone || DEFAULTS.TIMEZONE;

  return personAssignments
    .map(function (a) {
      const dateLabel = Utilities.formatDate(parseDate(a.serviceDate), tz, dateFormat);
      return dateLabel + ' ' + (postNames[a.postId] || a.postId);
    })
    .join(separator);
}

/**
 * 讀取 SendLog 中每個人「最後一次已確實處理」的紀錄（hash 與 Status 一併回傳）。
 * `readLastHashByPerson_()`／`readLastStatusByPerson_()` 都是這個函式的薄包裝，
 * 保證兩者永遠讀到同一行，不會各自套用不同篩選條件、兜出不一致的組合。
 *
 * 追加階段 AO：「最後一次已確實處理」認定為 Status 屬於 SENT／DRY_RUN／
 * SKIPPED_NO_EMAIL 三者之一——這三種都代表系統當時已經完整計算過該人這一版的
 * 派工與 hash，只是 SKIPPED_NO_EMAIL 因為查無電郵沒有真的寄出。原本只認
 * SENT／DRY_RUN 兩種，漏掉 SKIPPED_NO_EMAIL 的後果：一個人本來就沒有電郵、
 * 這一版派工完全沒變，也會因為「查不到基準」被誤判成「改動」而重複通知
 * （步驟 5 v11→v12 測試時，多位無電郵者的假陽性正是這個原因）。
 * 明確排除 FAILED／ERROR_PDF／ERROR_PDF_MISSING 這類真正處理中途出錯的紀錄
 * ——這些代表當時的 hash／派工計算可能不完整或不可信，不該當作下次比對的基準。
 * SKIPPED_UNCHANGED 同樣不在這三者之列：如果它是某人最新的一行，代表在它之前
 * 一定還有一行 hash 相同的 SENT／DRY_RUN／SKIPPED_NO_EMAIL，略過它、改採更早那行，
 * 找到的 hash 值本來就相同，不影響結果。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, {hash: string, status: string}>} {PersonID: {hash, status}}
 */
function readLastSendRecordByPerson_(quarterId) {
  const C = COLUMNS.SEND_LOG;
  const baselineStatuses = [MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN, MAIL_STATUS.SKIPPED_NO_EMAIL];
  const rows = readSheet(SHEETS.SEND_LOG).filter(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return false;
    if (!row[C.PERSON_ID]) return false;
    return baselineStatuses.indexOf(String(row[C.STATUS] || '').toUpperCase()) !== -1;
  });

  const result = {};
  rows.forEach(function (row) {
    result[row[C.PERSON_ID]] = {
      hash: String(row[C.ASSIGNMENT_HASH] || ''),
      status: String(row[C.STATUS] || '').toUpperCase()
    };
  });
  return result;
}

/**
 * 從 SendLog 讀出每個人最後一次已確實處理的 AssignmentHash（見
 * `readLastSendRecordByPerson_()` 的 Status 白名單說明）。RESEND 階段用它來判斷
 * 內容有沒有改動過。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, string>} {PersonID: 最後一次的 hash}
 */
function readLastHashByPerson_(quarterId) {
  const records = readLastSendRecordByPerson_(quarterId);
  const result = {};
  Object.keys(records).forEach(function (id) { result[id] = records[id].hash; });
  return result;
}

/**
 * 追加階段 AO：從 SendLog 讀出每個人最後一次已確實處理的 Status（見
 * `readLastSendRecordByPerson_()` 的白名單說明）。步驟 5「改動後重發」用它判斷
 * 「上次因查無電郵而略過、這次已經補上電郵」這種即使 hash 沒變也要通知的情況
 * （見 ResendFlow.gs 的 `computeResendDiff_()`）。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, string>} {PersonID: 最後一次的 Status}
 */
function readLastStatusByPerson_(quarterId) {
  const records = readLastSendRecordByPerson_(quarterId);
  const result = {};
  Object.keys(records).forEach(function (id) { result[id] = records[id].status; });
  return result;
}

/**
 * 在 EmailTemplates 中尋找指定階段的範本。
 * 找不到時退回 OFFICIAL 階段的範本（RESEND 通常沿用 OFFICIAL 的內容）。
 *
 * ⚠️ 步驟 5「改動後重發」之後，Stage=RESEND 可能同時有兩行範本
 * （TPL_RESEND_TC 給 PERSON 收件人、TPL_RESEND_LIST_TC 給 LIST 收件人）——
 * 這個函式純粹依 Stage 找，找到「第一個符合的」就回傳，遇到同一個 Stage 有
 * 多於一個範本時無法分辨要哪一個，回傳結果取決於工作表上的列順序。
 * `sendResendStage_()`（ResendFlow.gs，步驟 5 實際寄送用）不會呼叫這個函式，
 * 而是用下面的 `findEmailTemplateById_()` 直接指定要用哪一個範本，不會有這個歧義。
 * 這個函式維持給既有的「寄送（測試模式）」與「預覽電郵範本」用，這兩個是唯讀／
 * DRY_RUN 可控的測試工具，遇到 RESEND 這種有兩個範本的階段時，看到的可能是
 * TPL_RESEND_TC 或 TPL_RESEND_LIST_TC 其中一個，是已知、可接受的限制。
 *
 * BodyPlain 欄空白時，自動由 BodyHtml 產生純文字版（見 htmlToPlainText_()），
 * 不會把空字串直接交給 MailApp.sendEmail() 當作純文字內容——原本沒有這個 fallback，
 * BodyPlain 空白的範本（GENERATE／REMIND／OFFICIAL／RESEND 這四個既有範本目前都是
 * 空白）寄出時，純文字版的 MIME 內容會是完全空白的信，即使 HTML 版本正常。
 * 這裡只在讀出時「即時運算」出來，不寫回工作表。
 *
 * @param {string} stage 寄送階段
 * @returns {?Object} 範本物件；完全找不到時回傳 null
 */
function findEmailTemplate_(stage) {
  const C = COLUMNS.EMAIL_TEMPLATES;
  const rows = readSheet(SHEETS.EMAIL_TEMPLATES).filter(function (row) {
    return isTrueValue_(row[C.ACTIVE]);
  });

  const pick = function (targetStage) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][C.STAGE] || '').toUpperCase() === targetStage) return rows[i];
    }
    return null;
  };

  const row = pick(stage) || (stage === MAIL_STAGES.RESEND ? pick(MAIL_STAGES.OFFICIAL) : null);
  return row ? normalizeEmailTemplateRow_(row) : null;
}

/**
 * 在 EmailTemplates 中依 TemplateID 直接找一個範本，不經過 Stage 判斷。
 * 步驟 5「改動後重發」專用（見 ResendFlow.gs 的 sendResendStage_()）——Stage=RESEND
 * 現在可能有兩行範本，用 TemplateID 直接指定，保證拿到的是哪一個範本，不受
 * 工作表列順序影響，也不會有 findEmailTemplate_() 那種歧義。
 * @param {string} templateId 要找的 TemplateID
 * @returns {?Object} 範本物件；找不到（或找到但 Active≠TRUE）時回傳 null
 */
function findEmailTemplateById_(templateId) {
  const C = COLUMNS.EMAIL_TEMPLATES;
  const rows = readSheet(SHEETS.EMAIL_TEMPLATES).filter(function (row) {
    return isTrueValue_(row[C.ACTIVE]) && row[C.TEMPLATE_ID] === templateId;
  });
  return rows.length > 0 ? normalizeEmailTemplateRow_(rows[0]) : null;
}

/**
 * 把 EmailTemplates 的一列原始資料整理成寄送流程共用的範本物件格式，
 * 供 findEmailTemplate_()／findEmailTemplateById_() 共用，避免兩處重複同一段轉換邏輯。
 * @param {Object} row readSheet(SHEETS.EMAIL_TEMPLATES) 的一列
 * @returns {Object} 範本物件
 */
function normalizeEmailTemplateRow_(row) {
  const C = COLUMNS.EMAIL_TEMPLATES;
  const bodyHtml = String(row[C.BODY_HTML] || '');
  const rawBodyPlain = String(row[C.BODY_PLAIN] || '');

  return {
    templateId: row[C.TEMPLATE_ID],
    stage: row[C.STAGE],
    lang: row[C.LANG],
    subject: String(row[C.SUBJECT] || ''),
    bodyHtml: bodyHtml,
    bodyPlain: rawBodyPlain !== '' ? rawBodyPlain : htmlToPlainText_(bodyHtml),
    attachType: row[C.ATTACH_TYPE]
  };
}

/**
 * 把範本的 BodyHtml 轉成陽春的純文字版，供 findEmailTemplate_() 在 BodyPlain
 * 欄空白時當作 fallback。只處理這個專案範本會用到的簡單結構（一連串 `<p>...</p>`，
 * 沒有巢狀標籤、沒有清單／表格）：
 * 1. `<br>` 轉成換行
 * 2. `</p>` 轉成兩個換行（段落之間留一行空白，跟現有範本手寫 BodyPlain 的風格一致）
 * 3. 其餘標籤（含開頭的 `<p ...>`）整個移除
 * 4. 還原常見 HTML entity（&nbsp;／&lt;／&gt;／&quot;／&#39;／&apos;／&amp;，
 *    &amp; 最後處理，避免先轉出的 & 被後面的規則誤判成其他 entity 的開頭）
 * 5. 頭尾多餘的空白行去掉
 * @param {string} html 原始 BodyHtml
 * @returns {string} 轉換後的純文字
 */
function htmlToPlainText_(html) {
  let text = String(html || '');
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*p\s*>/gi, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&apos;/gi, '\'')
    .replace(/&amp;/gi, '&');
  return text.trim();
}

/**
 * 把範本中的 {變數} 換成實際值。
 * 支援季度層級的變數，以及 {PersonName}、{AssignmentSummary}。
 *
 * 第三輪批次下一輪（新一批階段 B）：處理完全部已知的 placeholder 之後，
 * 加一道清理——任何還留在文字裡、形如 {XxxYyy} 的字串（代表範本用了一個
 * 這個階段沒有提供的變數）一律換成空字串，不是拋錯、也不是保留原始的
 * 「{XxxYyy}」文字留在信裡給收件人看到。這是為了讓
 * docs/系統範圍稽核.md 建議的新 TPL_REMIND_TC 範本可以安全使用
 * {CurrentStage}／{NextAction} 這類只有部分呼叫情境才有意義的變數——
 * 即使某次呼叫沒有提供某個變數，範本也不會壞掉，只是那個位置留空。
 * @param {string} text 範本文字
 * @param {Object.<string, string>} placeholders 季度層級的變數對照
 * @param {Object} recipient 收件人資料
 * @param {string} summary 該人的派工摘要
 * @returns {string} 代入後的文字
 */
function applyPlaceholders_(text, placeholders, recipient, summary) {
  let result = String(text || '');
  Object.keys(placeholders).forEach(function (key) {
    result = result.split('{' + key + '}').join(placeholders[key]);
  });
  result = result.split('{PersonName}').join(recipient.displayName || '');
  result = result.split('{AssignmentSummary}').join(summary || '');
  result = result.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '');
  return result;
}

/**
 * 把本次所有處理結果寫入 SendLog（附加在現有資料之後）。
 * @param {Object[]} outcomes deliverOne_() 的結果陣列
 * @param {Object} context 寄信 context
 * @returns {number} 寫入的列數
 */
function writeSendLogRows_(outcomes, context) {
  if (outcomes.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SEND_LOG);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = nowTimestamp_();
  const idStamp = compactTimestamp_();
  const actor = Session.getActiveUser().getEmail();
  const C = COLUMNS.SEND_LOG;

  const rows = outcomes.map(function (o, i) {
    const record = {};
    record[C.SEND_ID] = [context.quarterId, 'v' + context.versionNo, context.stage,
      idStamp, i + 1].join('-');
    record[C.QUARTER_ID] = context.quarterId;
    record[C.VERSION_NO] = context.versionNo;
    record[C.STAGE] = context.stage;
    record[C.RECIPIENT_TYPE] = o.recipientType;
    record[C.PERSON_ID] = o.personId;
    record[C.EMAIL] = o.email;
    record[C.DISPLAY_NAME] = o.displayName;
    record[C.ASSIGNMENT_HASH] = o.hash;
    record[C.ASSIGNMENT_SUMMARY] = o.summary;
    record[C.ATTACHMENT_NAME] = o.attachmentName;
    record[C.SENT_AT] = now;
    record[C.STATUS] = o.status;
    record[C.MESSAGE_ID] = o.messageId;
    record[C.ERROR_MESSAGE] = o.errorMessage;
    record[C.TRIGGERED_BY] = actor;
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, rows.length, headers.length).setValues(rows);
  applyTimestampFormat_(sheet, headers, [C.SENT_AT], targetRow, rows.length);
  return rows.length;
}

/**
 * 統一的「只通知幹事」寄信函式：整個專案唯一呼叫 MailApp.sendEmail() 的兩個地方
 * 之一（另一個是 sendRealEmail_()，供一般收件人使用）。原本只服務「查無電郵名單」
 * 這一種用途（notifyAdminNoEmail_()），追加階段 N 把它一般化，讓「生成初稿完成通知」
 * 與「Stage 停滯提醒」這兩個新的幹事專屬通知（notifyAdminGenerateDone_()／
 * notifyAdminStageReminder_()）可以共用同一個真正寄信的呼叫點，不需要新增第三個
 * MailApp.sendEmail() 呼叫。DRY_RUN=TRUE 時只寫 Logger，不寄出。
 * @param {string} subject 標題（含前綴由呼叫端自行組好）
 * @param {string} body 純文字內文
 * @param {string} adminEmail 收件人（Config 的 MAIL_ADMIN_NOTIFY）
 * @param {boolean} isDryRun 是否為測試模式
 * @returns {void}
 */
function notifyAdmin_(subject, body, adminEmail, isDryRun) {
  if (!adminEmail) {
    log_('WARN', 'MAIL_ADMIN_NOTIFY 未設定，通知只記錄在 Logger：' + subject);
  }

  // 防呆：與 sendRealEmail_ 一樣，寄出前再確認一次 Config
  if (isDryRun || !adminEmail || getConfig(CONFIG_KEYS.DRY_RUN, true) !== false) {
    log_('INFO', '[DRY_RUN] 不寄出管理員通知 → ' + adminEmail + '\n' + subject + '\n' + body);
    return;
  }
  MailApp.sendEmail(adminEmail, subject, body);
}

/**
 * 把「查無電郵」的名單通知 Config 的 MAIL_ADMIN_NOTIFY。
 * @param {string[]} noEmailPeople 沒有電郵的人員描述陣列
 * @param {Object} context 寄信 context
 * @param {boolean} isDryRun 是否為測試模式
 * @returns {void}
 */
function notifyAdminNoEmail_(noEmailPeople, context, isDryRun) {
  const subject = context.subjectPrefix + context.quarterId + ' 職事表：'
    + noEmailPeople.length + ' 人查無電郵';
  const body = '以下人員在 NameMapping 沒有電郵地址，未能收到職事表通知：\n\n'
    + noEmailPeople.join('\n')
    + '\n\n請補上電郵後再執行 RESEND。';
  notifyAdmin_(subject, body, context.adminEmail, isDryRun);
}

/**
 * 追加階段 N：自動排程自動生成初稿完成後，通知幹事去覆核，不寄給堂委、不寄給義工
 * ——寄給堂委審閱是步驟 2 的責任，要幹事看過初稿、決定沒問題了才手動執行。
 * @param {string} quarterId 季度 ID
 * @param {Object} genResult performRosterGeneration_() 的結果，至少含 sheetName
 * @param {Object} config readConfig() 的結果
 * @param {boolean} isDryRun 是否為測試模式
 * @returns {void}
 */
function notifyAdminGenerateDone_(quarterId, genResult, config, isDryRun) {
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const adminEmail = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '');
  const subject = prefix + quarterId + ' 初稿已生成，請覆核';
  const body = quarterId + ' 的職事表初稿已由自動排程生成（' + genResult.sheetName + '）。\n\n'
    + '請登入試算表覆核內容，確認沒問題後執行「職事表系統 → 四階段流程 → 步驟 2：寄給堂委審閱」。\n\n'
    + '（本通知只寄給你，不會寄給堂委或義工——寄給堂委審閱是步驟 2 的責任，需要你先看過初稿再決定。）';
  notifyAdmin_(subject, body, adminEmail, isDryRun);
}

/**
 * 第三輪批次下一輪（新一批階段 B）：Stage 停留在 DRAFT／REVIEW_SENT／
 * REQUESTS_APPLIED 三者之一太久（停滯時間）、或距離正式發出日期太近（死線
 * 接近）時提醒幹事，兩個原因可以同時成立、但只會寄這一封信。只寄給幹事，
 * 不寄給堂委或義工——義工收到的第一封信永遠是「步驟 4：正式發出」那一封，
 * 這一點不會因為 REMIND 擴大範圍而改變。
 * @param {string} quarterId 季度 ID
 * @param {Object} judgment judgeRemindAction_() 的結果（outcome=WOULD_RUN 時呼叫），
 *   至少含 stage、reasons、reminderCount、maxCount、daysStuck、daysUntilDeadline、
 *   stuckDays、deadlineDays
 * @param {Object} config readConfig() 的結果
 * @param {boolean} isDryRun 是否為測試模式
 * @returns {void}
 */
function notifyAdminStageReminder_(quarterId, judgment, config, isDryRun) {
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const adminEmail = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '');
  const nextAction = STAGE_NEXT_ACTION[judgment.stage];
  const nextActionText = nextAction ? '「職事表系統 → ' + nextAction + '」' : '登入試算表查看目前狀態';

  const reasonLines = [];
  if (judgment.reasons.indexOf('STUCK') !== -1) {
    reasonLines.push('　• 已經停留在「' + judgment.stage + '」' + judgment.daysStuck + ' 天（門檻 ' + judgment.stuckDays + ' 天）');
  }
  if (judgment.reasons.indexOf('DEADLINE') !== -1) {
    reasonLines.push(judgment.daysUntilDeadline >= 0
      ? '　• 距離預定的正式發出日期只剩 ' + judgment.daysUntilDeadline + ' 天（門檻 ' + judgment.deadlineDays + ' 天）'
      : '　• 已經超過預定的正式發出日期 ' + Math.abs(judgment.daysUntilDeadline) + ' 天');
  }

  const subject = prefix + quarterId + ' 職事表停留在「' + judgment.stage + '」，請跟進';
  const body = quarterId + ' 的職事表目前 Stage 是「' + judgment.stage + '」，尚未進入下一步。\n\n'
    + '提醒原因：\n' + reasonLines.join('\n') + '\n\n'
    + '這是第 ' + (judgment.reminderCount + 1) + ' / ' + judgment.maxCount + ' 次提醒'
    + '（同一個 Stage 達到上限後不會再提醒，前進到下一個 Stage 之後次數會重新計算）。\n\n'
    + '下一步請執行' + nextActionText + '。\n\n'
    + '（本通知只寄給你，不會寄給堂委或義工——義工收到的第一封信永遠是'
    + '「步驟 4：正式發出」那一封。）';
  notifyAdmin_(subject, body, adminEmail, isDryRun);
}

/**
 * 統計某個 Status 出現的次數。
 * @param {Object[]} outcomes 處理結果陣列
 * @param {string} status 要統計的狀態
 * @returns {number} 出現次數
 */
function countStatus_(outcomes, status) {
  return outcomes.filter(function (o) { return o.status === status; }).length;
}
