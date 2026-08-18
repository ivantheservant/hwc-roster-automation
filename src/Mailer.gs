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
/**
 * 階段 A（收尾輪）新增：計算「這個季度＋版本＋階段」目前 SendLog 已經有幾多個
 * 收件人有 SENT／DRY_RUN 紀錄——純粹用來提醒幹事「這個組合好像已經寄過」，
 * **不會**跳過任何收件人、不影響 sendStage() 實際寄不寄。跟 RESEND 的
 * lastHashByPerson（會真的讓內容沒變的人被跳過）是完全不同的機制。
 *
 * 存在的理由：sendStage() 對 REVIEW／OFFICIAL／GENERATE 三個階段完全沒有
 * 「已經寄過就跳過」的判斷（只有 RESEND 有），如果步驟 2／4 執行到一半中斷
 * （Apps Script 逾時、Drive/Sheets 暫時性錯誤），Stage 這時還沒前進
 * （advanceQuarterStage_() 是 sendStage() 完全跑完之後才呼叫，見
 * FiveStageCore.gs 的 executeStep2_()／executeStep4Send_()），幹事很自然會
 * 重新執行同一個步驟——這時如果 DRY_RUN=FALSE，已經真正收到信的人會收到
 * 第二封重複的信。這個函式讓步驟 2／4 的確認視窗在偵測到這種情況時主動示警，
 * 幹事看到警告就知道要先去 SendLog 核對，而不是在完全不知情的情況下重複寄出。
 * 完整說明見 docs/中斷復原指引.md「步驟 2／4：寄信中途失敗」一節。
 *
 * 刻意不做成「自動跳過」：這個專案已有「測試工具 ▸ 寄送（測試模式）」讓幹事
 * 在寄錯人之後刻意重寄，如果這裡自動跳過「已有 SENT 紀錄」的人，會令那個
 * 刻意補寄的使用情境失效——所以只做「示警」，是否要繼續，交由幹事自己判斷。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段（REVIEW／OFFICIAL）
 * @returns {number} 已有 SENT／DRY_RUN 紀錄的收件人數（LIST 用 Email、PERSON 用
 *   PersonID 當識別鍵去重，同一人多筆紀錄只算一次）
 */
function countAlreadySentForStage_(quarterId, versionNo, stage) {
  const C = COLUMNS.SEND_LOG;
  const baselineStatuses = [MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN];
  const seen = {};
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return;
    if (Number(row[C.VERSION_NO]) !== versionNo) return;
    if (row[C.STAGE] !== stage) return;
    if (baselineStatuses.indexOf(String(row[C.STATUS] || '').toUpperCase()) === -1) return;
    const key = row[C.PERSON_ID] || row[C.EMAIL];
    if (key) seen[key] = true;
  });
  return Object.keys(seen).length;
}

/**
 * 決定某個寄送階段要用哪些範本：PERSON 收件人一個、LIST 收件人一個。
 *
 * 第九輪批次階段 C 新增。背景是實測會發生、但一直沒有人讀信所以沒發現的問題：
 * 步驟 4「正式發出」同時寄給義工（PERSON）與堂委／辦公室名單（LIST），
 * 修正前兩者共用 `TPL_OFFICIAL_TC`，令 LIST 收件人收到一封稱呼自己
 * 「弟兄／姊妹」、服侍安排一片空白、又聲稱附了個人 PDF（實際沒有附）的信。
 * 完整分析見 `docs/電郵範本樣本.md`。
 *
 * OFFICIAL 一律用 TemplateID 直接指定，不靠 `findEmailTemplate_()` 的 Stage
 * 比對——Stage=OFFICIAL 現在有兩行範本，依 Stage 找會拿到「工作表上排先嗰行」，
 * 結果取決於列順序，這正是 `findEmailTemplate_()` 檔頭警告過的歧義。
 *
 * **向後相容**：`TPL_OFFICIAL_LIST_TC` 還沒有加進 EmailTemplates 工作表時
 * （幹事未執行「維護 ▸ 補齊 Email 範本」），`list` 會是 null，呼叫端會退回
 * 沿用 PERSON 範本——行為跟修正前完全一樣，不會因為缺一行範本而寄不出信。
 *
 * @param {string} stage 寄送階段
 * @returns {{person: ?Object, list: ?Object}} 兩種收件人各自要用的範本
 */
function resolveStageTemplates_(stage) {
  if (stage === MAIL_STAGES.OFFICIAL) {
    return {
      person: findEmailTemplateById_('TPL_OFFICIAL_TC') || findEmailTemplate_(stage),
      list: findEmailTemplateById_('TPL_OFFICIAL_LIST_TC')
    };
  }
  // 其餘階段維持原本行為：REVIEW／REMIND 只有 LIST 收件人、只有一個範本；
  // RESEND 不經過 sendStage()（步驟 5 用 ResendFlow.gs 的 sendResendStage_()）。
  return { person: findEmailTemplate_(stage), list: null };
}

function sendStage(quarterId, versionNo, stage) {
  assertNotPreviewMode_('sendStage');
  // 追加階段 N：OFFICIAL 永遠不可以由自動排程觸發，結構性防護見 Trigger.gs 的
  // assertOfficialNotFromAutomationTrigger_()——目前 dailyAutomationCheck_() 根本
  // 沒有任何路徑會走到這裡，這一行是防日後不小心改壞的第二道防線。
  if (stage === MAIL_STAGES.OFFICIAL) assertOfficialNotFromAutomationTrigger_(quarterId);
  const startedAt = Date.now();
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const templates = resolveStageTemplates_(stage);
  const template = templates.person;
  if (!template) throw new Error('EmailTemplates 中找不到 Stage=' + stage + ' 的範本（也沒有 OFFICIAL 可退回使用）');

  // 需求 3：附件要存 Shared Drive 時，一開始就驗證資料夾，無效立即中止——
  // 不要讓 58 人的迴圈跑到一半才發現存不了（曾經花 538 秒才報錯）。
  // 這裡涵蓋選單與自動排程兩個呼叫路徑，是唯一的把關點。
  // 兩個範本都要看：LIST 專用範本（OFFICIAL）附的是完整版 PDF，
  // 只檢查個人範本會漏掉「個人範本不用附件、但 LIST 範本要」的組合。
  const needsFolder = [templates.person, templates.list].some(function (t) {
    if (!t) return false;
    const at = String(t.attachType || ATTACH_TYPE.NONE).toUpperCase();
    return at === ATTACH_TYPE.FULL_PDF || at === ATTACH_TYPE.PERSONAL_PDF;
  });
  if (needsFolder) resolveMailAttachmentFolder_();

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
    // 第九輪批次階段 C：LIST 收件人（堂委／教會辦公室名單）與 PERSON 收件人
    // （逐一義工）用不同範本，見 resolveStageTemplates_() 的說明。
    const chosen = (recipient.type === RECIPIENT_TYPE.LIST && templates.list)
      ? templates.list : template;
    outcomes.push(deliverOne_(recipient, chosen, context, isDryRun));
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
    // 第二十五輪批次階段 D：掣 4 嘅「原本係咩」。見 readLastSummaryByPerson_()。
    lastSummaryByPerson: readLastSummaryByPerson_(quarterId),
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
      NextAction: resolveNextActionForPlaceholder_(quarterId),
      // 第十一輪批次階段 A：一季一條固定連結。同上用 try/catch 包住，
      // 查不到（例如這一季從未執行過「發佈公開職事表」）就留空，
      // applyPlaceholders_() 的清理機制會處理掉範本裡的 {PublicRosterUrl}，
      // 不會有人收到一封信裡面留低一串花括號。
      PublicRosterUrl: resolvePublicRosterUrlForPlaceholder_(quarterId)
    }
  };
}

/**
 * 供 {PublicRosterUrl} placeholder 使用：查 `PublicLinks` 拿呢一季嘅公開連結。
 * 查不到（未發佈過、或工作表都未建立）一律回傳空字串，唔會令寄信流程失敗
 * ——第一次啟用呢個功能之前寄出嘅信，呢個位置本來就應該係冇連結可以放。
 * @param {string} quarterId 季度 ID
 * @returns {string} 公開連結網址；查不到回傳空字串
 */
function resolvePublicRosterUrlForPlaceholder_(quarterId) {
  try {
    const row = findPublicLinkRow_(quarterId);
    return (row && row.fileUrl) ? row.fileUrl : '';
  } catch (err) {
    return '';
  }
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
  // 第十一輪批次階段 C：ICS 日曆檔，只在 OFFICIAL／RESEND 且收件人有派工時產生
  // （見 IcsExport.gs 的 buildIcsAttachmentForPerson_()）。刻意跟 PDF 附件分開
  // try/catch——ICS 是錦上添花的附加功能，不應該因為它產生失敗而令整封信
  // （連同已經正確產生的個人 PDF）都寄不出，只記錄警告、繼續不附 ICS。
  let icsAttachment = null;
  try {
    icsAttachment = buildIcsAttachmentForPerson_(context, recipient, personAssignments);
  } catch (err) {
    log_('WARN', 'ICS 日曆檔產生失敗（不影響本次寄信，本封信不附 ICS）：'
      + recipient.displayName + '（' + recipient.personId + '）　' + err.message);
  }

  const attachmentName = [attachment, icsAttachment]
    .filter(Boolean)
    .map(decorateAttachmentName_)
    .join('；');
  base.retries = (attachment ? (attachment.retries || 0) : 0) + (icsAttachment ? (icsAttachment.retries || 0) : 0);

  if (!recipient.email) {
    return Object.assign({}, base, { status: MAIL_STATUS.SKIPPED_NO_EMAIL, attachmentName: attachmentName });
  }

  const subject = context.subjectPrefix
    + applyPlaceholders_(template.subject, context.placeholders, recipient, summary);
  const bodyHtml = applyPlaceholders_(template.bodyHtml, context.placeholders, recipient, summary);
  const bodyPlain = applyPlaceholders_(template.bodyPlain, context.placeholders, recipient, summary);

  if (isDryRun) {
    log_('INFO', '[DRY_RUN] 不寄出 → ' + recipient.email + ' | ' + subject
      + (attachmentName ? '（附件已產生：' + attachmentName + '）' : ''));
    return Object.assign({}, base, { status: MAIL_STATUS.DRY_RUN, attachmentName: attachmentName });
  }

  try {
    sendRealEmail_(recipient, subject, bodyHtml, bodyPlain, context, attachment, icsAttachment);
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
 * @param {?{blob: Blob}} attachment 已產生的附件（個人／完整版 PDF）；沒有時傳 null
 * @param {?{blob: Blob}} icsAttachment 已產生的 ICS 日曆附件；沒有時傳 null
 * @returns {void}
 */
function sendRealEmail_(recipient, subject, bodyHtml, bodyPlain, context, attachment, icsAttachment) {
  // 防呆：即使呼叫端判斷錯誤，這裡再擋一次
  assertNotPreviewMode_('sendRealEmail_');
  if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== false) {
    throw new Error('DRY_RUN 仍為 TRUE，拒絕寄出');
  }
  const options = { htmlBody: bodyHtml };
  if (context.senderName) options.name = context.senderName;
  if (context.replyTo) options.replyTo = context.replyTo;
  const blobs = [attachment, icsAttachment]
    .filter(function (a) { return a && a.blob; })
    .map(function (a) { return a.blob; });
  if (blobs.length > 0) options.attachments = blobs;
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
      status: String(row[C.STATUS] || '').toUpperCase(),
      // 第二十五輪批次階段 D：上次寄出時嗰個人嘅安排摘要文字。
      //
      // `hash` 係單向嘅，還原唔到內容——所以掣 4 嘅「原本係咩」一直
      // 都係空白。但 `AssignmentSummary` 呢一欄本身**一直都有寫入**
      // （見 `appendSendLog_()`），只係從來冇讀返出嚟。加呢一行就夠。
      summary: String(row[C.ASSIGNMENT_SUMMARY] || '')
    };
  });
  return result;
}

/**
 * 第二十五輪批次階段 D：從 SendLog 讀出每個人最後一次寄出時嘅安排摘要。
 * 供掣 4「改動後重發」嘅確認畫面做「原本／現在」並排比較（規格 2.7）。
 *
 * ⚠️ **攞唔到嗰啲一律唔會出現喺回傳物件入面**（key 唔存在），
 * 唔會擺一個空字串扮到「上次係冇安排」。呼叫端要靠 key 存唔存在
 * 去分辨「上次冇安排」同「冇記錄」——呢兩件事對幹事嚟講完全唔同。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, string>} {PersonID: 上次嘅安排摘要}
 */
function readLastSummaryByPerson_(quarterId) {
  const records = readLastSendRecordByPerson_(quarterId);
  const result = {};
  Object.keys(records).forEach(function (id) {
    // 舊紀錄（本輪之前寄嘅）可能真係冇填 summary，噉就當冇記錄。
    if (records[id].summary !== '') result[id] = records[id].summary;
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
    // 階段 C（Opus 深度輪）：`context.sendIdTag` 是選填的批次標記，目前只有
    // 補寄工具（MakeupSend.gs）會設成 'MAKEUP'。加在 SendID 中間而不是改
    // Stage 欄——Stage 一定要維持真正的階段值，否則
    // readLastSendRecordByPerson_()（步驟 5 hash 比對）與
    // countAlreadySentForStage_() 都會漏掉這一批，補寄反而製造新問題。
    record[C.SEND_ID] = [context.quarterId, 'v' + context.versionNo, context.stage,
      context.sendIdTag || null, idStamp, i + 1]
      .filter(function (part) { return part !== null && part !== undefined && part !== ''; })
      .join('-');
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
  // 第二十五輪批次階段 A2：自動生成已經關閉，所以「到期咗仲未生成」
  // 唔再係「等系統做」，而係「等你去撳掣」——文案一定要講到係幹事要做。
  if (judgment.reasons.indexOf('NOT_GENERATED') !== -1) {
    reasonLines.push('　• 原定 ' + (judgment.generateDueDate || '（未設定日期）')
      + ' 生成初稿，已經過了 ' + judgment.daysSinceGenerateDue + ' 天，但這一季還沒有任何版本');
  }
  if (judgment.reasons.indexOf('STUCK') !== -1) {
    reasonLines.push('　• 已經停留在「' + judgment.stage + '」' + judgment.daysStuck + ' 天（門檻 ' + judgment.stuckDays + ' 天）');
  }
  if (judgment.reasons.indexOf('DEADLINE') !== -1) {
    reasonLines.push(judgment.daysUntilDeadline >= 0
      ? '　• 距離預定的正式發出日期只剩 ' + judgment.daysUntilDeadline + ' 天（門檻 ' + judgment.deadlineDays + ' 天）'
      : '　• 已經超過預定的正式發出日期 ' + Math.abs(judgment.daysUntilDeadline) + ' 天');
  }
  // 第十六輪批次階段 D2：未確認日期的特殊主日（教會新規則 5 的五月合堂）
  if (judgment.reasons.indexOf('UNCONFIRMED_SPECIAL') !== -1) {
    reasonLines.push('　• 距離生成初稿只剩 ' + judgment.daysUntilGenerate + ' 天（門檻 '
      + judgment.unconfirmedLeadDays + ' 天），但這一季還有 '
      + judgment.unconfirmedSpecials.length + ' 個特殊主日的日期尚未確認');
  }

  // 未確認特殊主日的明細另外成段，因為要列出逐一項目與具體處理方式
  let specialSection = '';
  if (judgment.reasons.indexOf('UNCONFIRMED_SPECIAL') !== -1) {
    specialSection = '\n' + describeUnconfirmedSpecialSundays_(judgment.unconfirmedSpecials) + '\n';
  }

  const notGenerated = judgment.reasons.indexOf('NOT_GENERATED') !== -1;

  // 第二十五輪批次階段 A2：完全沒有版本時，「下一步」不是 Stage 對照表那一項，
  // 而是去撳「生成初稿」。照用 STAGE_NEXT_ACTION 會叫幹事去做一件他做不到的事
  // （沒有版本，那些掣全部是灰的）。
  const nextStepText = notGenerated
    ? '請開啟幹事介面，撳「生成初稿」。系統不會自己生成——一定要你撳。'
    : '下一步請執行' + nextActionText + '。';

  const countText = notGenerated
    ? '這一項提醒不設次數上限，會每天提醒一次，直到你生成了初稿為止。\n'
      + '如果這一季其實不需要再排（例如只是用來測試或培訓），'
      + '請把 Quarters 工作表上這一季的 GenerateOn 清空，就不會再收到這封信。'
    : '這是第 ' + (judgment.reminderCount + 1) + ' / ' + judgment.maxCount + ' 次提醒'
      + '（同一個 Stage 達到上限後不會再提醒，前進到下一個 Stage 之後次數會重新計算）。';

  const subject = prefix + quarterId
    + (notGenerated ? ' 還沒有生成初稿，請跟進' : ' 職事表停留在「' + judgment.stage + '」，請跟進');
  const body = quarterId + ' 的職事表目前 Stage 是「' + judgment.stage + '」，尚未進入下一步。\n\n'
    + '提醒原因：\n' + reasonLines.join('\n') + '\n'
    + specialSection + '\n'
    + countText + '\n\n'
    + nextStepText + '\n'
    + buildAdminConsoleLinkText_() + '\n\n'
    + '（本通知只寄給你，不會寄給堂委或義工——義工收到的第一封信永遠是'
    + '「步驟 4：正式發出」那一封。）';
  notifyAdmin_(subject, body, adminEmail, isDryRun);
}

/**
 * 提醒信尾附的連結。
 *
 * ⚠️ 幹事介面嘅網址**攞唔到可靠嘅值**：呢個專案有兩個部署（義工個人連結、
 * 幹事介面），`ScriptApp.getService().getUrl()` 只會回其中一個，而且喺
 * trigger 執行環境回嘅可能係 head 部署而唔係幹事日常用嗰個。
 *
 * 所以**唔會憑估砌一條連結**——一條打唔開嘅連結對一個唔識電腦嘅人嚟講，
 * 比冇連結更差：佢會以為系統壞咗，而唔會諗到「應該用返自己收藏嗰條」。
 * 試算表網址係攞得到嘅可靠值，就淨係俾試算表。
 * @returns {string} 附在提醒信尾的連結段落
 */
function buildAdminConsoleLinkText_() {
  let sheetUrl = '';
  try {
    sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  } catch (err) {
    log_('WARN', 'buildAdminConsoleLinkText_ 取不到試算表網址：' + err.message);
  }
  const lines = ['幹事介面：請用你自己收藏的那條網址開啟。'];
  if (sheetUrl) lines.push('職事表試算表：' + sheetUrl);
  return lines.join('\n');
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
