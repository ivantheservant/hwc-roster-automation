/**
 * 階段 C（Opus 深度輪）新增：中斷之後「只補寄未收到的人」。
 *
 * ============================================================
 * 解決什麼問題
 * ============================================================
 * 步驟 2（寄給堂委審閱）與步驟 4（正式發出）的 sendStage() 是「先逐個收件人
 * 寄完，最後才令 Stage 前進」。如果中途撞到 Apps Script 的 6 分鐘上限（步驟 4
 * 約六十位收件人，最容易發生），Stage 仍然停在原地，幹事很自然會重新執行同一
 * 個步驟——但 sendStage() 對 REVIEW／OFFICIAL **沒有**「已經寄過就跳過」的
 * 判斷（那只有 RESEND 靠 hash 比對才有），於是已經收過信的人會再收一封。
 *
 * 上一輪（第六輪批次階段 A）已經加了偵測與警示，但幹事見到警示之後仍然只能
 * 人手判斷怎麼補救，沒有工具。這個檔案就是補上那個工具。
 *
 * ============================================================
 * 「未收到」怎樣界定（C1）
 * ============================================================
 * 對每一位**應收名單上的人**，看他在 SendLog 中這個「季度＋版本＋階段」的
 * 紀錄，分成四類——刻意分四類而不是二分法，因為三種「沒收到信」的原因需要
 * 完全不同的處理：
 *
 * | 分類 | SendLog 狀態 | 意思 | 補寄工具怎麼處理 |
 * |---|---|---|---|
 * | 已寄 | SENT／DRY_RUN | 系統已經處理完，信已寄出（或模擬寄出） | **不再寄**，避免重複 |
 * | 寄失敗 | FAILED／ERROR_PDF／ERROR_PDF_MISSING | 系統試過但出錯 | **要補寄** |
 * | 未嘗試 | 完全沒有紀錄 | 中斷令這個人根本沒被處理到 | **要補寄** |
 * | 無法寄 | SKIPPED_NO_EMAIL，或 NameMapping 查無電郵 | 不是「未寄」而是「寄不到」 | **分開顯示，不補寄** |
 *
 * 最後那一類刻意獨立出來：補寄他們沒有意義（一樣寄不出），但幹事需要知道
 * 有這幾位、要另外用電話或 WhatsApp 通知，所以一定要顯示，不可以靜靜略過。
 *
 * ============================================================
 * 安全設計
 * ============================================================
 * - **plan-only 優先**（C2）：planMakeupSend_() 完全唯讀，列出四類名單與判定
 *   原因，確認無誤才可以執行。
 * - **復用既有寄送邏輯**（C3）：executeMakeupSend_() 用的是 deliverOne_()、
 *   findEmailTemplate_()、writeSendLogRows_()——跟 sendStage() 同一套，沒有
 *   另寫一份會走樣的副本。差別只在於「收件人名單是補寄清單而不是全部」。
 * - **SendLog 可分辨**（C3）：補寄那一批的 SendID 中間會多一段 `MAKEUP`
 *   （見 Mailer.gs 的 writeSendLogRows_()）。**刻意不改 Stage 欄**——Stage
 *   一定要維持真正的階段值，否則 readLastSendRecordByPerson_()（步驟 5 的
 *   hash 比對基準）與 countAlreadySentForStage_() 都會漏掉這一批。
 * - **絕不改動 Stage**（C4）：這個檔案完全沒有呼叫 advanceQuarterStage_()，
 *   純粹補寄。補寄前後 Quarters.Stage 一模一樣。
 */

/** 補寄批次在 SendID 中的標記，方便日後在 SendLog 一眼認出哪些是補寄。 */
const MAKEUP_SEND_ID_TAG = 'MAKEUP';

/** 執行補寄時要逐字輸入的確認文字，沿用既有的打字確認慣例。 */
const MAKEUP_CONFIRM_TEXT = '確認補寄';

/** 補寄工具支援的階段：只有這兩個階段會出現「寄一半中斷」的問題。 */
const MAKEUP_SUPPORTED_STAGES = [MAIL_STAGES.REVIEW, MAIL_STAGES.OFFICIAL];

/**
 * 把 SendLog 中某個「季度＋版本＋階段」的紀錄，整理成每個收件人的最終狀態。
 *
 * 同一個收件人可能有多筆紀錄（例如先 FAILED 後來補寄成功），一律以**最後
 * 一筆**為準——SendLog 一律 append，後出現的就是較新的，跟
 * readLastSendRecordByPerson_()（Mailer.gs）用同一個假設。
 *
 * @param {Object[]} sendLogRows readSheet(SHEETS.SEND_LOG) 的結果
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 階段
 * @returns {Object.<string, string>} {收件人識別鍵: 最後一次的 Status}
 */
function buildSendStatusByRecipient_(sendLogRows, quarterId, versionNo, stage) {
  const C = COLUMNS.SEND_LOG;
  const statusByKey = {};
  sendLogRows.forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return;
    if (Number(row[C.VERSION_NO]) !== versionNo) return;
    if (row[C.STAGE] !== stage) return;
    // PERSON 收件人用 PersonID、LIST 收件人沒有 PersonID 就用 Email——
    // 跟 listRecipients_() 產生收件人的方式對應。
    const key = row[C.PERSON_ID] || String(row[C.EMAIL] || '').trim().toLowerCase();
    if (!key) return;
    statusByKey[key] = String(row[C.STATUS] || '').toUpperCase();
  });
  return statusByKey;
}

/**
 * 單一收件人的補寄判定。純函式，不讀任何工作表——方便獨立測試，也方便
 * 呼叫端與測試共用同一套判斷。
 *
 * @param {Object} recipient listRecipients_() 產生的收件人
 * @param {?string} lastStatus 這個收件人在 SendLog 的最後一次 Status；沒有紀錄時傳 null
 * @returns {{category: string, reason: string}} category 為
 *   'ALREADY_SENT'／'NEEDS_RESEND'／'CANNOT_SEND'
 */
function classifyMakeupRecipient_(recipient, lastStatus) {
  // 沒有電郵的一律歸入「無法寄」，不論 SendLog 有沒有紀錄——補寄他們沒有
  // 意義（一樣寄不出），但一定要顯示出來讓幹事另外通知。
  if (!recipient.email) {
    return {
      category: 'CANNOT_SEND',
      reason: 'NameMapping 沒有電郵地址，補寄一樣寄不出，請另外用其他方式通知'
    };
  }

  if (lastStatus === null || lastStatus === undefined || lastStatus === '') {
    return { category: 'NEEDS_RESEND', reason: 'SendLog 完全沒有紀錄，代表上次執行中斷時未處理到這一位' };
  }
  if (lastStatus === MAIL_STATUS.SENT) {
    return { category: 'ALREADY_SENT', reason: '已經成功寄出（SENT）' };
  }
  if (lastStatus === MAIL_STATUS.DRY_RUN) {
    return { category: 'ALREADY_SENT', reason: '已在模擬模式處理（DRY_RUN），系統視為已處理' };
  }
  if (lastStatus === MAIL_STATUS.SKIPPED_NO_EMAIL) {
    return { category: 'CANNOT_SEND', reason: '上次因查無電郵而略過（SKIPPED_NO_EMAIL）' };
  }
  if (lastStatus === MAIL_STATUS.SKIPPED_UNCHANGED) {
    // 這個狀態只有 RESEND 階段才會出現，REVIEW／OFFICIAL 理論上不會遇到；
    // 保守處理成「已處理」，不重複寄。
    return { category: 'ALREADY_SENT', reason: '內容未變而略過（SKIPPED_UNCHANGED），系統視為已處理' };
  }
  // FAILED／ERROR_PDF／ERROR_PDF_MISSING 以及任何其他未知狀態
  return { category: 'NEEDS_RESEND', reason: '上次處理結果是「' + lastStatus + '」，未成功寄出' };
}

/**
 * 補寄計畫（plan-only，完全唯讀，不寄任何電郵、不改動任何工作表）。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 階段（只支援 MAKEUP_SUPPORTED_STAGES）
 * @returns {Object} 計畫內容
 */
function planMakeupSend_(quarterId, versionNo, stage) {
  if (MAKEUP_SUPPORTED_STAGES.indexOf(stage) === -1) {
    throw new Error('補寄工具只支援「' + MAKEUP_SUPPORTED_STAGES.join('」與「')
      + '」兩個階段。步驟 5（RESEND）本身已經靠 hash 比對自動只寄給有改動的人，'
      + '中斷後直接重新執行步驟 5 就會正確補寄，不需要這個工具'
      + '（見 docs/中斷復原指引.md）。');
  }

  const context = buildMailContext_(quarterId, versionNo, stage);
  const recipients = listRecipients_(stage, context);
  const statusByKey = buildSendStatusByRecipient_(
    readSheet(SHEETS.SEND_LOG), quarterId, versionNo, stage);

  const alreadySent = [];
  const needsResend = [];
  const cannotSend = [];

  recipients.forEach(function (recipient) {
    const key = recipient.personId || String(recipient.email || '').trim().toLowerCase();
    const lastStatus = key ? (statusByKey[key] === undefined ? null : statusByKey[key]) : null;
    const verdict = classifyMakeupRecipient_(recipient, lastStatus);
    const entry = {
      type: recipient.type,
      personId: recipient.personId,
      email: recipient.email,
      displayName: recipient.displayName,
      lastStatus: lastStatus === null ? '（無紀錄）' : lastStatus,
      reason: verdict.reason
    };
    if (verdict.category === 'ALREADY_SENT') alreadySent.push(entry);
    else if (verdict.category === 'CANNOT_SEND') cannotSend.push(entry);
    else needsResend.push(entry);
  });

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    stage: stage,
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false,
    totalExpected: recipients.length,
    alreadySent: alreadySent,
    needsResend: needsResend,
    cannotSend: cannotSend
  };
}

/**
 * 實際補寄：只寄給計畫中 needsResend 的人。
 *
 * **完全復用 sendStage() 那一套寄送邏輯**（findEmailTemplate_／deliverOne_／
 * writeSendLogRows_），沒有另寫一份。跟 sendStage() 唯一的差別是收件人名單，
 * 以及 context.sendIdTag 令 SendLog 的 SendID 帶上 MAKEUP 標記。
 *
 * **絕不改動 Quarters.Stage**——這個函式完全沒有呼叫 advanceQuarterStage_()。
 *
 * @param {Object} plan planMakeupSend_() 的結果
 * @returns {Object} 寄送結果統計
 */
function executeMakeupSend_(plan) {
  assertNotPreviewMode_('executeMakeupSend_');
  // 沿用 sendStage() 的結構性防護：OFFICIAL 永遠不可以由自動排程觸發，
  // 補寄工具同樣要受這道防線約束（它也會真正寄信給全體義工）。
  if (plan.stage === MAIL_STAGES.OFFICIAL) assertOfficialNotFromAutomationTrigger_(plan.quarterId);

  if (plan.needsResend.length === 0) {
    return { sent: 0, dryRun: 0, skipped: 0, failed: 0, errorPdf: 0, errorPdfMissing: 0,
      isDryRun: plan.isDryRun, attempted: 0 };
  }

  const template = findEmailTemplate_(plan.stage);
  if (!template) throw new Error('EmailTemplates 中找不到 Stage=' + plan.stage + ' 的範本');

  const attachType = String(template.attachType || ATTACH_TYPE.NONE).toUpperCase();
  if (attachType === ATTACH_TYPE.FULL_PDF || attachType === ATTACH_TYPE.PERSONAL_PDF) {
    resolveMailAttachmentFolder_();
  }

  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const context = buildMailContext_(plan.quarterId, plan.versionNo, plan.stage);
  context.sendIdTag = MAKEUP_SEND_ID_TAG;

  // 重新用 listRecipients_() 取回完整的收件人物件（plan 裡存的是精簡版），
  // 並且**以現時狀態重新篩一次**——不信任 plan 產生之後狀態沒有變過，
  // 這跟 FiveStageCore.gs 各處「不信任前端傳來的舊快照」是同一個原則。
  const needKeys = {};
  plan.needsResend.forEach(function (r) {
    needKeys[r.personId || String(r.email || '').trim().toLowerCase()] = true;
  });
  const statusByKey = buildSendStatusByRecipient_(
    readSheet(SHEETS.SEND_LOG), plan.quarterId, plan.versionNo, plan.stage);

  const targets = listRecipients_(plan.stage, context).filter(function (recipient) {
    const key = recipient.personId || String(recipient.email || '').trim().toLowerCase();
    if (!needKeys[key]) return false;
    const lastStatus = statusByKey[key] === undefined ? null : statusByKey[key];
    return classifyMakeupRecipient_(recipient, lastStatus).category === 'NEEDS_RESEND';
  });

  const outcomes = [];
  const flushBatchSize = Number(getConfig(CONFIG_KEYS.SEND_LOG_FLUSH_BATCH_SIZE, DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE))
    || DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE;
  let flushedCount = 0;
  targets.forEach(function (recipient) {
    outcomes.push(deliverOne_(recipient, template, context, isDryRun));
    if (outcomes.length - flushedCount >= flushBatchSize) {
      writeSendLogRows_(outcomes.slice(flushedCount), context);
      flushedCount = outcomes.length;
    }
  });
  if (flushedCount < outcomes.length) writeSendLogRows_(outcomes.slice(flushedCount), context);

  writeAuditLog_({
    action: '補寄未收到者',
    targetSheet: SHEETS.SEND_LOG,
    targetKey: plan.quarterId + ' v' + plan.versionNo + ' ' + plan.stage,
    oldValue: '應收 ' + plan.totalExpected + ' 人，已寄 ' + plan.alreadySent.length
      + ' 人，無法寄 ' + plan.cannotSend.length + ' 人',
    newValue: '補寄 ' + outcomes.length + ' 人　模式='
      + (isDryRun ? 'DRY_RUN（模擬）' : '正式寄出'),
    source: 'executeMakeupSend_',
    notes: '成功=' + countStatus_(outcomes, MAIL_STATUS.SENT)
      + '　模擬=' + countStatus_(outcomes, MAIL_STATUS.DRY_RUN)
      + '　失敗=' + countStatus_(outcomes, MAIL_STATUS.FAILED)
      + '；Stage 完全沒有改動'
  });

  return {
    sent: countStatus_(outcomes, MAIL_STATUS.SENT),
    dryRun: countStatus_(outcomes, MAIL_STATUS.DRY_RUN),
    skipped: countStatus_(outcomes, MAIL_STATUS.SKIPPED_NO_EMAIL),
    failed: countStatus_(outcomes, MAIL_STATUS.FAILED),
    errorPdf: countStatus_(outcomes, MAIL_STATUS.ERROR_PDF),
    errorPdfMissing: countStatus_(outcomes, MAIL_STATUS.ERROR_PDF_MISSING),
    isDryRun: isDryRun,
    attempted: outcomes.length
  };
}

/**
 * 把補寄計畫整理成可讀文字，預覽與執行前確認共用同一份內容。
 * @param {Object} plan planMakeupSend_() 的結果
 * @returns {string[]}
 */
function buildMakeupPlanLines_(plan) {
  const lines = [
    plan.quarterId + '　v' + plan.versionNo + '　階段：' + plan.stage,
    'DRY_RUN：' + (plan.isDryRun ? 'TRUE（不會真正寄出）' : 'FALSE（會真正寄出！）'),
    '',
    '應收名單共 ' + plan.totalExpected + ' 位，分類如下：',
    '　✅ 已寄（不會再寄）：' + plan.alreadySent.length + ' 位',
    '　📮 未收到（會補寄）：' + plan.needsResend.length + ' 位',
    '　⚠️ 無法寄（不會補寄，請另外通知）：' + plan.cannotSend.length + ' 位',
    ''
  ];

  if (plan.needsResend.length > 0) {
    lines.push('【會補寄給以下 ' + plan.needsResend.length + ' 位】');
    plan.needsResend.slice(0, 30).forEach(function (r) {
      lines.push('　' + (r.displayName || r.email) + '　上次狀態：' + r.lastStatus + '　' + r.reason);
    });
    if (plan.needsResend.length > 30) lines.push('　……另有 ' + (plan.needsResend.length - 30) + ' 位');
    lines.push('');
  }

  if (plan.cannotSend.length > 0) {
    lines.push('【以下 ' + plan.cannotSend.length + ' 位無法寄出，補寄工具幫不到，請你另外通知】');
    plan.cannotSend.slice(0, 30).forEach(function (r) {
      lines.push('　' + (r.displayName || r.personId) + '　' + r.reason);
    });
    if (plan.cannotSend.length > 30) lines.push('　……另有 ' + (plan.cannotSend.length - 30) + ' 位');
    lines.push('');
  }

  lines.push('這個工具**不會改動流程階段**（Stage 保持不變），純粹補寄。');
  return lines;
}

/**
 * 選單項目「四階段流程 ▸ 補寄未收到的人（唯讀預覽）」的執行入口。完全唯讀。
 * @returns {void}
 */
function runMakeupSendPlan_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptMakeupTarget_(ui, '補寄未收到的人（唯讀預覽）');
  if (!target) return;

  let plan;
  try {
    plan = planMakeupSend_(target.quarterId, target.versionNo, target.stage);
  } catch (err) {
    log_('ERROR', 'runMakeupSendPlan_ 失敗: ' + err.message);
    ui.alert('補寄未收到的人（唯讀預覽）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const rows = [
    diagRow_('補寄預覽', '（季度／版本／階段）',
      plan.quarterId + ' v' + plan.versionNo + ' ' + plan.stage, ''),
    diagRow_('補寄預覽', '應收名單', plan.totalExpected + ' 位', ''),
    diagRow_('補寄預覽', '已寄', plan.alreadySent.length + ' 位', '不會再寄'),
    diagRow_('補寄預覽', '未收到', plan.needsResend.length + ' 位', '會補寄'),
    diagRow_('補寄預覽', '無法寄', plan.cannotSend.length + ' 位', '請另外通知')
  ];
  plan.needsResend.forEach(function (r) {
    rows.push(diagRow_('補寄預覽', '未收到：' + (r.displayName || r.email), r.lastStatus, r.reason));
  });
  plan.cannotSend.forEach(function (r) {
    rows.push(diagRow_('補寄預覽', '無法寄：' + (r.displayName || r.personId), r.lastStatus, r.reason));
  });
  tryWriteDiagnostics_('補寄預覽', rows);

  const lines = buildMakeupPlanLines_(plan);
  lines.push('', DIAGNOSTICS_WRITTEN_NOTE);
  ui.alert('補寄未收到的人（唯讀預覽）', lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * 選單項目「四階段流程 ▸ ⚠️ 執行補寄未收到的人」的執行入口。
 * @returns {void}
 */
function runMakeupSendExecute_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptMakeupTarget_(ui, '執行補寄未收到的人');
  if (!target) return;

  let plan;
  try {
    plan = planMakeupSend_(target.quarterId, target.versionNo, target.stage);
  } catch (err) {
    log_('ERROR', 'runMakeupSendExecute_ 失敗: ' + err.message);
    ui.alert('執行補寄未收到的人', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.needsResend.length === 0) {
    ui.alert('執行補寄未收到的人',
      buildMakeupPlanLines_(plan).join('\n') + '\n\n沒有任何人需要補寄，已結束。', ui.ButtonSet.OK);
    return;
  }

  const lines = buildMakeupPlanLines_(plan);
  lines.push('', '確認以上名單無誤後，請在下一步逐字輸入「' + MAKEUP_CONFIRM_TEXT + '」。');
  const confirm = ui.prompt('⚠️ 執行補寄未收到的人（最後確認）', lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;
  if (confirm.getResponseText().trim() !== MAKEUP_CONFIRM_TEXT) {
    ui.alert('執行補寄未收到的人',
      '輸入的文字不是「' + MAKEUP_CONFIRM_TEXT + '」，已取消，沒有寄出任何電郵。', ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('補寄中，請稍候…', '補寄未收到的人', 120);
    const result = executeMakeupSend_(plan);
    ui.alert('執行補寄未收到的人（完成）',
      (result.isDryRun ? '模式：DRY_RUN（沒有真正寄出任何電郵）' : '模式：正式寄出') + '\n\n'
        + '嘗試補寄：' + result.attempted + ' 位\n'
        + '寄出：' + result.sent + '　模擬：' + result.dryRun + '\n'
        + '查無電郵略過：' + result.skipped + '\n'
        + '失敗：' + result.failed + '　PDF失敗：' + result.errorPdf
        + '　PDF缺件：' + result.errorPdfMissing + '\n\n'
        + '流程階段（Stage）完全沒有改動。\n'
        + '這一批在 SendLog 的 SendID 會帶有「' + MAKEUP_SEND_ID_TAG + '」標記，方便日後分辨。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runMakeupSendExecute_ 執行失敗: ' + err.message);
    ui.alert('執行補寄未收到的人', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 詢問補寄的目標：季度、版本、階段。
 * @param {Ui} ui SpreadsheetApp.getUi() 的結果
 * @param {string} title 對話框標題
 * @returns {?{quarterId: string, versionNo: number, stage: string}} 取消時回傳 null
 */
function promptMakeupTarget_(ui, title) {
  const stageResponse = ui.prompt(title,
    '要補寄哪一個階段？請輸入：\n'
      + '　' + MAIL_STAGES.REVIEW + '　＝步驟 2：寄給堂委審閱\n'
      + '　' + MAIL_STAGES.OFFICIAL + '　＝步驟 4：正式發出\n\n'
      + '（步驟 5「改動後重發」不需要這個工具——它本身已經靠內容比對'
      + '自動只寄給有改動的人，中斷後直接重新執行步驟 5 即可。）',
    ui.ButtonSet.OK_CANCEL);
  if (stageResponse.getSelectedButton() !== ui.Button.OK) return null;
  const stage = stageResponse.getResponseText().trim().toUpperCase();
  if (MAKEUP_SUPPORTED_STAGES.indexOf(stage) === -1) {
    ui.alert(title, '「' + stage + '」不是支援的階段，請輸入 '
      + MAKEUP_SUPPORTED_STAGES.join(' 或 ') + '。', ui.ButtonSet.OK);
    return null;
  }

  const target = promptQuarterAndVersion_(title);
  if (!target) return null;
  return { quarterId: target.quarterId, versionNo: target.versionNo, stage: stage };
}
