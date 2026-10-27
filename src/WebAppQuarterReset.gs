/**
 * 第八十二輪批次 IJ 組：幹事介面〔整季清走重來〕（Ivan：要喺幹事介面把一季重設到「還未生成初稿」）。
 *
 * ⚠️ **唔另寫一套清理。** 同試算表選單「⚠️⚠️ 重設季度測試資料」用同一批後端：
 *   掃描　`planQuarterReset_()`（QuarterReset.gs，只讀）
 *   清單　`describeQuarterResetPlanLines_()`（Menu.gs，選單確認清單嗰一份）
 *   執行　`executeQuarterResetBatch_()`（QuarterReset.gs，做之前／之後都寫 AuditLog）
 *   封鎖　`readQuarterResetBlockedQuarters_()`（`QUARTER_RESET_BLOCKED_QUARTERS`）
 * 一律連第 0 版一齊清（整季由零開始）。要打「確認重設」先做（前端提早擋，後端再驗一次）。
 */

/** 已正式發出嘅季度，確認清單最上面嗰句紅字。 */
const QUARTER_RESET_OFFICIAL_SENT_WARNING = '這一季已經正式發出給全體，清走之後寄出紀錄亦會清走。';

/**
 * 呢一季可唔可以用〔整季清走重來〕（主畫面按鈕用：封鎖 ⇒ 灰掣＋原因）。
 * @param {string} quarterId 季度 ID
 * @returns {{blocked: boolean, reason: string}}
 */
function describeQuarterResetAvailability_(quarterId) {
  const id = String(quarterId || '').trim().toUpperCase();
  if (!id) return { blocked: true, reason: '先在頁頂選一個季度。' };
  let blockedList = [];
  try {
    blockedList = readQuarterResetBlockedQuarters_();
  } catch (err) {
    // 讀唔到封鎖清單 ⇒ 一律當封鎖（呢個係全系統最危險嘅動作之一）
    log_('WARN', 'describeQuarterResetAvailability_ 讀不到封鎖清單：' + err.message);
    return { blocked: true, reason: '讀不到「不可以重設的季度」設定，暫時不可以清走。撳「重新整理」再試。' };
  }
  const split = splitQuarterResetTargets_([id], blockedList);
  if (split.blocked.length > 0) {
    return { blocked: true,
      reason: id + ' 受保護（Config 的 ' + CONFIG_KEYS.QUARTER_RESET_BLOCKED_QUARTERS + '），不可以清走。' };
  }
  return { blocked: false, reason: '' };
}

/**
 * 〔整季清走重來〕第一步：確認清單（只讀）。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, quarterLabel: string, blocked: boolean, blockedReason: string,
 *   officialSent: boolean, officialSentWarning: string, lines: string[], nothingToDo: boolean, confirmText: string}}
 */
function apiQuarterResetPlan(quarterId) {
  assertWebAppRequestAllowed_();
  const id = String(quarterId || '').trim().toUpperCase();
  const avail = describeQuarterResetAvailability_(id);
  const base = { quarterId: id, quarterLabel: id ? buildQuarterLabel_(id) : '', blocked: avail.blocked,
    blockedReason: avail.reason, officialSent: false, officialSentWarning: '', lines: [], nothingToDo: true,
    confirmText: QUARTER_RESET_CONFIRM_TEXT };
  if (avail.blocked) return base;
  const plan = planQuarterReset_(id, true);
  const summary = summariseQuarterResetBatch_([{ quarterId: id, plan: plan }]);
  const officialSent = isQuarterOfficiallySentForReset_(id, plan);
  return Object.assign(base, {
    officialSent: officialSent,
    officialSentWarning: officialSent ? QUARTER_RESET_OFFICIAL_SENT_WARNING : '',
    lines: describeQuarterResetPlanLines_(id, plan),
    nothingToDo: summary.nothingToDo
  });
}

/**
 * 〔整季清走重來〕第二步：真正清走（要打「確認重設」）。
 * @param {string} quarterId 季度 ID
 * @param {string} typed 幹事打嘅字
 * @returns {{ok: boolean, quarterId: string, failed: boolean, error: string, result: ?Object}}
 */
function apiQuarterResetExecute(quarterId, typed) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('整季清走重來', function () {
    return quarterResetExecute_locked_(quarterId, typed);
  });
}

function quarterResetExecute_locked_(quarterId, typed) {
  const id = String(quarterId || '').trim().toUpperCase();
  if (String(typed || '').trim() !== QUARTER_RESET_CONFIRM_TEXT) {
    throw new Error(buildThreePartMessage_(
      '輸入的文字不是「' + QUARTER_RESET_CONFIRM_TEXT + '」。',
      '已取消，沒有清走任何東西。',
      ['要清走的話，逐字輸入「' + QUARTER_RESET_CONFIRM_TEXT + '」再撳一次']));
  }
  // 後端再驗一次封鎖（唔信前端）
  const avail = describeQuarterResetAvailability_(id);
  if (avail.blocked) {
    throw new Error(buildThreePartMessage_(avail.reason, '沒有清走任何東西。', ['揀另一個季度']));
  }
  const plan = planQuarterReset_(id, true);
  const batch = executeQuarterResetBatch_([{ quarterId: id, plan: plan }]);
  const r = batch.results[0] || { ok: false, error: '沒有結果', result: null };
  return { ok: r.ok === true, quarterId: id, failed: r.ok !== true, error: r.error || '', result: r.result };
}

/**
 * 呢一季有冇正式發出過（Stage＝OFFICIAL_SENT，或者 SendLog 有正式發出紀錄）。
 * @param {string} quarterId 季度 ID
 * @param {Object} plan `planQuarterReset_()` 嘅結果（要 `quarterStage`）
 * @returns {boolean}
 */
function isQuarterOfficiallySentForReset_(quarterId, plan) {
  if (plan && plan.quarterStage === QUARTER_STAGE.OFFICIAL_SENT) return true;
  try {
    return !!readSendLogSummaryForDashboard_(quarterId).officialSentOnce;
  } catch (err) {
    log_('WARN', 'isQuarterOfficiallySentForReset_ 讀不到 SendLog：' + err.message);
    return false;
  }
}
