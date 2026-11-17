/**
 * 第一百零九輪批次 SA 組：寄出的時間預算及續寄。
 *
 * 背景：〔寄給堂委／執事〕〔給所有人〕〔變動的人〕一次執行之內逐個收件人處理；
 * Apps Script 單次執行最多 6 分鐘，58 封個人版 PDF 模擬寄出已經要 3.5–4.8 分鐘。
 * 真正寄出時超時，會有一部分人收到、一部分人收不到，最後一小段連 SendLog 紀錄也沒有，
 * 再按一次又會重複寄給已收到的人。
 *
 * 做法：
 *   ・每一段寄出有時間預算（Config `SEND_TIME_BUDGET_MS`，預設 240000）。處理下一位之前，
 *     「已用時間＋平均每位時間 > 預算」⇒ 停手，把已處理的全部寫入 SendLog，回傳「未寄完」。
 *   ・同一次寄出有一個批次鍵（SendLog `SendBatchID` 欄；第一次分段寄出時缺欄自動補建）。
 *     收件人名單、寄送選項、版本號在第一次寄出時記在 Script Properties（`PENDING_SEND_BATCH`）。
 *   ・續寄只處理這一批還沒有 SendLog 紀錄的人；名單或版本與第一次不同 ⇒ 停下來說明，不多寄、不少寄。
 *   ・幹事介面收到「未寄完」就自動呼叫〔繼續寄出〕（`apiContinueSendBatch()`），直至寄完；
 *     全部寄完才推進 Stage、才寫「寄送批次」AuditLog、才出完成窗（數字是各段合計）。
 *   ・中途關了頁面或出錯：狀態卡顯示「上一次寄出未完成」及〔繼續寄出〕；未完成期間不可以另開一批。
 *   ・續寄不可以由自動排程觸發。
 * 〔補寄未收到的人〕本身每次都按 SendLog 重新計算誰未收到，所以只加時間預算，不用批次紀錄。
 */

/** Script Properties 的鍵：未完成的寄出批次（JSON）。 */
const SEND_BATCH_PROP_KEY = 'PENDING_SEND_BATCH';

/** 批次種類。 */
const SEND_BATCH_KIND = { STAGE: 'STAGE', RESEND: 'RESEND' };

/** 呼叫寄出的網頁入口（`apiStep2Confirm` 等）在呼叫前登記，用來記下〔變動的人〕的說明文字。 */
var SEND_BATCH_ENTRY_ = null;

/** 沒有 PropertiesService 時（本機測試）用的記憶體備用。 */
var SEND_BATCH_MEMORY_STORE_ = null;

/**
 * 網頁入口登記這一次寄出的額外資料（續寄時用同一份）。
 * @param {string} api 入口名稱
 * @param {Object=} extra 例如 {releaseText}
 * @returns {void}
 */
function setSendBatchEntry_(api, extra) {
  SEND_BATCH_ENTRY_ = { api: api, extra: extra || {} };
}

/** @returns {number} 每一段的時間預算（毫秒） */
function sendTimeBudgetMs_() {
  const n = Number(getConfig_(CONFIG_KEYS.SEND_TIME_BUDGET_MS, DEFAULTS.SEND_TIME_BUDGET_MS));
  return n > 0 ? n : DEFAULTS.SEND_TIME_BUDGET_MS;
}

/**
 * 處理下一位之前判斷要不要停。**純函式。**
 * 一位都未處理 ⇒ 不停（每一段最少處理一位，保證有進展）。
 * @param {number} startedAt 這一段開始的時間（毫秒）
 * @param {number} loopStartedAt 逐位處理開始的時間（毫秒；用來算平均每位時間）
 * @param {number} processedCount 這一段已處理人數
 * @param {number} now 現在（毫秒）
 * @param {number} budgetMs 預算
 * @returns {boolean} true＝停手
 */
function shouldStopForSendBudget_(startedAt, loopStartedAt, processedCount, now, budgetMs) {
  if (!(processedCount > 0)) return false;
  const elapsed = now - startedAt;
  const avg = (now - loopStartedAt) / processedCount;
  return elapsed + avg > budgetMs;
}

/**
 * 收件人的識別鍵（事奉人員用 PersonID；名單收件人用電郵小寫）。
 * @param {Object} r 收件人
 * @returns {string}
 */
function sendRecipientKey_(r) {
  return String((r && r.personId) || String((r && r.email) || '').trim().toLowerCase());
}

function sendBatchStore_() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService && PropertiesService.getScriptProperties) {
      return PropertiesService.getScriptProperties();
    }
  } catch (err) {
    // 本機測試沙箱沒有 PropertiesService ⇒ 用記憶體（正式環境一定有）
  }
  return {
    getProperty: function () { return SEND_BATCH_MEMORY_STORE_; },
    setProperty: function (k, v) { SEND_BATCH_MEMORY_STORE_ = v; },
    deleteProperty: function () { SEND_BATCH_MEMORY_STORE_ = null; }
  };
}

/** @returns {?Object} 未完成的寄出批次；沒有 ⇒ null */
function readPendingSendBatch_() {
  try {
    const raw = sendBatchStore_().getProperty(SEND_BATCH_PROP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    log_('WARN', '讀不到未完成的寄出批次：' + err.message);
    return null;
  }
}

/** @param {Object} record @returns {void} */
function writePendingSendBatch_(record) {
  sendBatchStore_().setProperty(SEND_BATCH_PROP_KEY, JSON.stringify(record));
}

/** @returns {void} */
function clearPendingSendBatch_() {
  const store = sendBatchStore_();
  if (store.deleteProperty) store.deleteProperty(SEND_BATCH_PROP_KEY);
  else store.setProperty(SEND_BATCH_PROP_KEY, '');
}

/**
 * SendLog 沒有 `SendBatchID` 欄 ⇒ 補欄（只在最後加欄，不改任何既有資料）。
 * @returns {void}
 */
function ensureSendLogBatchColumn_() {
  const plan = planSendLogColumnBackfill_();
  if (!plan.sheetExists) return;
  if (plan.missing.indexOf(COLUMNS.SEND_LOG.SEND_BATCH_ID) === -1) return;
  executeSendLogColumnBackfill_(plan);
}

/**
 * 這一批已經處理過的人：SendLog 有這個批次鍵的行；另外，同一季同一版同一階段、
 * 在這一批開始之後已經 SENT／DRY_RUN 的人（例如中途用〔補寄未收到的人〕寄了）也算，不再重複寄。
 * @param {Object} record 批次紀錄
 * @param {Object[]=} rows SendLog 各行（測試可以傳入）
 * @returns {Object.<string, boolean>}
 */
function readSendBatchProcessedKeys_(record, rows) {
  const C = COLUMNS.SEND_LOG;
  const out = {};
  const okStatuses = [MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN];
  (rows || readSheet_(SHEETS.SEND_LOG)).forEach(function (row) {
    const key = String(row[C.PERSON_ID] || String(row[C.EMAIL] || '').trim().toLowerCase());
    if (!key) return;
    if (String(row[C.SEND_BATCH_ID] || '') === record.id) { out[key] = true; return; }
    if (String(row[C.QUARTER_ID]) !== record.quarterId) return;
    if (Number(row[C.VERSION_NO]) !== Number(record.versionNo)) return;
    if (String(row[C.STAGE]) !== record.stage) return;
    if (okStatuses.indexOf(String(row[C.STATUS] || '').toUpperCase()) === -1) return;
    // SentAt 可能是 Date（工作表讀回）或文字（只到秒）⇒ 容許 60 秒誤差
    const v = row[C.SENT_AT];
    const at = v && typeof v.getTime === 'function' ? v.getTime() : new Date(String(v || '')).getTime();
    if (!isNaN(at) && at >= Number(record.startedAtMs || 0) - 60000) out[key] = true;
  });
  return out;
}

/**
 * 續寄前核對名單：第一次的名單減去已處理的，必須等於現時的名單減去已處理的。**純函式。**
 * @param {string[]} storedKeys 第一次的收件人鍵
 * @param {string[]} currentKeys 現時重新計算的收件人鍵
 * @param {Object.<string, boolean>} processed 已處理
 * @returns {{same: boolean, added: string[], removed: string[]}}
 */
function compareSendBatchRecipients_(storedKeys, currentKeys, processed) {
  const rest = function (keys) {
    const m = {};
    (keys || []).forEach(function (k) { if (!processed[k]) m[k] = true; });
    return m;
  };
  const a = rest(storedKeys);
  const b = rest(currentKeys);
  const added = Object.keys(b).filter(function (k) { return !a[k]; });
  const removed = Object.keys(a).filter(function (k) { return !b[k]; });
  return { same: added.length === 0 && removed.length === 0, added: added, removed: removed };
}

/**
 * 開始一次寄出，或者接着上一段。
 * @param {string} kind SEND_BATCH_KIND
 * @param {string} quarterId 季度
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段
 * @param {Object[]} recipients 這一次全部收件人（未扣除已處理）
 * @param {Object=} sendOptions 寄送選項（`resumeBatchId` 有值 ⇒ 續寄）
 * @returns {{id: string, record: Object, processed: Object.<string, boolean>, isResume: boolean}}
 */
function beginSendBatch_(kind, quarterId, versionNo, stage, recipients, sendOptions) {
  const resumeId = sendOptions && sendOptions.resumeBatchId ? String(sendOptions.resumeBatchId) : '';
  const keys = (recipients || []).map(sendRecipientKey_);
  ensureSendLogBatchColumn_();
  if (resumeId) {
    // 續寄不可以由自動排程觸發
    if (typeof AUTOMATION_TRIGGER_CONTEXT_ACTIVE !== 'undefined' && AUTOMATION_TRIGGER_CONTEXT_ACTIVE) {
      throw new Error('續寄不可以由自動排程觸發，必須由幹事在幹事介面按〔繼續寄出〕。');
    }
    const p = readPendingSendBatch_();
    if (!p || p.id !== resumeId) {
      throw new Error(buildThreePartMessage_('找不到這一批未完成的寄出（可能已經寄完，或者已經放棄）。',
        '這一次沒有寄出任何電郵。', ['按〔重新整理〕看最新狀態']));
    }
    if (p.kind !== kind || p.quarterId !== quarterId || p.stage !== stage) {
      throw new Error(buildThreePartMessage_('這一批未完成的寄出不是這一個寄出動作（' + p.quarterId + '，' + p.stage + '）。',
        '這一次沒有寄出任何電郵。', ['按狀態卡的〔繼續寄出〕']));
    }
    if (Number(p.versionNo) !== Number(versionNo)) {
      throw new Error(buildThreePartMessage_(
        '第一段寄出的是第 ' + p.versionNo + ' 版，現在最新是第 ' + versionNo + ' 版（中途儲存過）。',
        '餘下的人沒有寄出——不可以一半人收舊版、一半人收新版。',
        ['按狀態卡的〔不再繼續這一批〕', '然後用第 3 步重新寄出（已收到的人會再收一次最新版）']));
    }
    const processed = readSendBatchProcessedKeys_(p);
    const cmp = compareSendBatchRecipients_(p.recipientKeys, keys, processed);
    if (!cmp.same) {
      throw new Error(buildThreePartMessage_(
        '餘下要寄的人和第一段開始時不同（多了 ' + cmp.added.length + ' 位、少了 ' + cmp.removed.length + ' 位），'
          + '可能是名單或電郵中途改過。',
        '這一次沒有寄出任何電郵，不會多寄或少寄。',
        ['按狀態卡的〔不再繼續這一批〕', '然後用〔補寄未收到的人〕寄給未收到的人']));
    }
    return { id: p.id, record: p, processed: processed, isResume: true };
  }
  const existing = readPendingSendBatch_();
  if (existing) {
    const left = Math.max(0, Number(existing.total || 0) - Object.keys(readSendBatchProcessedKeys_(existing)).length);
    throw new Error(buildThreePartMessage_(
      '上一次寄出還未完成（' + existing.quarterId + ' 第 ' + existing.versionNo + ' 版，' + existing.stage + '，還有 ' + left + ' 位未寄）。',
      '這一次沒有寄出任何電郵：同一時間只可以有一批寄出，否則會重複寄。',
      ['先按狀態卡的〔繼續寄出〕把上一次寄完', '或者按〔不再繼續這一批〕放棄餘下的人，再用〔補寄未收到的人〕']));
  }
  const entry = SEND_BATCH_ENTRY_ || {};
  const record = {
    id: 'SB-' + compactTimestamp_(), kind: kind, quarterId: quarterId, versionNo: Number(versionNo), stage: stage,
    recipientKeys: keys, total: keys.length, segments: [], startedAtMs: Date.now(),
    sendOptions: sanitizeSendBatchOptions_(sendOptions), entryApi: entry.api || '', extra: entry.extra || {}
  };
  writePendingSendBatch_(record);
  return { id: record.id, record: record, processed: {}, isResume: false };
}

/**
 * 記在批次紀錄的寄送選項（拿走續寄專用的鍵）。
 * @param {Object=} sendOptions
 * @returns {Object}
 */
function sanitizeSendBatchOptions_(sendOptions) {
  const out = {};
  Object.keys(sendOptions || {}).forEach(function (k) {
    if (k === 'resumeBatchId') return;
    out[k] = sendOptions[k];
  });
  return out;
}

/**
 * 一段寄完（或者到了預算而停）之後更新批次紀錄。
 * @param {{id: string, record: Object}} batch beginSendBatch_() 的結果
 * @param {{count: number, ms: number, retries: number}} segment 這一段
 * @param {number} remaining 這一批還有幾位未處理
 * @returns {Object[]} 到目前為止各段
 */
function finishSendSegment_(batch, segment, remaining) {
  const record = batch.record;
  record.segments = (record.segments || []).concat([segment]);
  if (remaining > 0) writePendingSendBatch_(record);
  else clearPendingSendBatch_();
  return record.segments;
}

/**
 * 這一批在 SendLog 的合計（完成窗、AuditLog 用）。
 * @param {string} batchId
 * @param {Object[]=} rows SendLog 各行（測試可以傳入）
 * @returns {{total: number, byStatus: Object.<string, number>, noEmailPeople: string[]}}
 */
function summariseSendBatchFromLog_(batchId, rows) {
  const C = COLUMNS.SEND_LOG;
  const byStatus = {};
  const noEmailPeople = [];
  let total = 0;
  (rows || readSheet_(SHEETS.SEND_LOG)).forEach(function (row) {
    if (String(row[C.SEND_BATCH_ID] || '') !== batchId) return;
    total++;
    const st = String(row[C.STATUS] || '').toUpperCase();
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (st === MAIL_STATUS.SKIPPED_NO_EMAIL) noEmailPeople.push(String(row[C.DISPLAY_NAME] || '') + '（' + String(row[C.PERSON_ID] || '') + '）');
  });
  return { total: total, byStatus: byStatus, noEmailPeople: noEmailPeople };
}

/**
 * 「未寄完」的回傳。
 * @param {Object} batch beginSendBatch_() 的結果
 * @param {number} processedThisSegment 這一段處理了幾位
 * @param {number} remaining 還有幾位
 * @param {boolean} isDryRun
 * @param {number} startedAt 這一段開始（毫秒）
 * @returns {Object}
 */
function buildIncompleteSendResult_(batch, processedThisSegment, remaining, isDryRun, startedAt) {
  const total = Number(batch.record.total || 0);
  return {
    incomplete: true, batchId: batch.id, total: total,
    processedTotal: Math.max(0, total - remaining), remaining: remaining,
    segmentCount: (batch.record.segments || []).length,
    processedThisSegment: processedThisSegment, isDryRun: isDryRun,
    message: '已處理 ' + Math.max(0, total - remaining) + '／' + total + ' 位，繼續寄出……',
    durationMs: Date.now() - startedAt
  };
}

/**
 * 「寄送批次」AuditLog 的分段說明。**純函式。**
 * @param {Object[]} segments [{count, ms}]
 * @returns {string}
 */
function describeSendSegments_(segments) {
  const list = segments || [];
  return '分 ' + list.length + ' 段：' + list.map(function (s, i) {
    return '第 ' + (i + 1) + ' 段 ' + s.count + ' 位 ' + Math.round(Number(s.ms || 0) / 1000) + ' 秒';
  }).join('；');
}

/**
 * 菜單、彩排等沒有續寄介面的路徑：未寄完時的說明。
 * @param {Object} result 寄出結果
 * @returns {string}
 */
function describeIncompleteSendForMenu_(result) {
  return '已處理 ' + result.processedTotal + ' 位，餘下 ' + result.remaining + ' 位未寄（時間預算已用完）。'
    + '請到幹事介面按狀態卡的〔繼續寄出〕，只會寄給餘下的人。';
}

/**
 * 狀態卡用：這一季有沒有未完成的寄出。
 * @param {string} quarterId
 * @returns {?{batchId: string, quarterId: string, stage: string, versionNo: number, total: number, remaining: number, kind: string}}
 */
function describePendingSendBatch_(quarterId) {
  const p = readPendingSendBatch_();
  if (!p) return null;
  let processedCount = 0;
  try { processedCount = Object.keys(readSendBatchProcessedKeys_(p)).filter(function (k) { return p.recipientKeys.indexOf(k) !== -1; }).length; } catch (err) { processedCount = 0; }
  return { batchId: p.id, quarterId: p.quarterId, stage: p.stage, versionNo: p.versionNo, kind: p.kind,
    total: Number(p.total || 0), remaining: Math.max(0, Number(p.total || 0) - processedCount),
    sameQuarter: !quarterId || p.quarterId === quarterId };
}

/**
 * 這一次呼叫是不是續寄現時未完成的那一批（同一個批次鍵、同一季、同一個階段）。
 * 用來略過只應該在第一段把關的檢查（例如「這一季已經正式發出過」）。
 * @param {string} quarterId
 * @param {string} stage MAIL_STAGES
 * @param {Object=} sendOptions
 * @returns {boolean}
 */
function isResumingSendBatch_(quarterId, stage, sendOptions) {
  const resumeId = sendOptions && sendOptions.resumeBatchId ? String(sendOptions.resumeBatchId) : '';
  if (!resumeId) return false;
  const p = readPendingSendBatch_();
  return !!(p && p.id === resumeId && p.quarterId === quarterId && p.stage === stage);
}

/**
 * 供前端呼叫：接着寄出餘下的人。按批次紀錄找回原本的寄出動作，用同一個入口（同一套把關）續寄。
 * 不另外拿鎖：下面各入口自己拿。
 * @param {string} batchId
 * @returns {Object} 該入口的回傳（未寄完 ⇒ incomplete: true）
 */
function apiContinueSendBatch(batchId) {
  assertWebAppRequestAllowed_();
  const p = readPendingSendBatch_();
  if (!p || p.id !== String(batchId || '')) {
    throw new Error(buildThreePartMessage_('找不到這一批未完成的寄出（可能已經寄完）。', '沒有寄出任何電郵。', ['按〔重新整理〕看最新狀態']));
  }
  const opts = Object.assign({}, p.sendOptions || {}, { resumeBatchId: p.id });
  if (p.kind === SEND_BATCH_KIND.RESEND) return apiStep5SendConfirm(p.quarterId, (p.extra && p.extra.releaseText) || '', opts);
  if (p.stage === MAIL_STAGES.REVIEW) return apiStep2Confirm(p.quarterId, opts);
  if (p.stage === MAIL_STAGES.OFFICIAL) return apiStep4Confirm(p.quarterId, opts);
  // 其他階段（只有選單會開始，例如提醒）：直接接着寄
  return withMutationLock_('繼續寄出', function () {
    const r = sendStage_(p.quarterId, p.versionNo, p.stage, opts);
    return r;
  });
}

/**
 * 供前端呼叫：放棄一批未完成的寄出（餘下的人不寄；已寄的照舊有紀錄）。
 * @param {string} batchId
 * @returns {{ok: boolean, message: string}}
 */
function apiAbandonSendBatch(batchId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('不再繼續這一批寄出', function () {
    const p = readPendingSendBatch_();
    if (!p || p.id !== String(batchId || '')) return { ok: false, message: '找不到這一批未完成的寄出（可能已經寄完）。' };
    const info = describePendingSendBatch_(p.quarterId) || { remaining: 0 };
    clearPendingSendBatch_();
    // 第一百一十輪批次 TB-2 組：已經寄出過的部分是事實 ⇒ 進度要和狀態卡、寄出把關一致
    const plan = planStageAfterAbandonedBatch_(p, getQuarterStage_(p.quarterId),
      countOfficialSendLogRows_(p.quarterId), Math.max(0, Number(p.total || 0) - info.remaining));
    if (plan.newStage === QUARTER_STAGE.OFFICIAL_SENT) advanceQuarterStage_(p.quarterId, plan.newStage);
    else if (plan.newStage) setQuarterStage_(p.quarterId, plan.newStage, plan.reason);
    writeAuditLog_({
      action: 'SEND_BATCH_ABANDONED', targetSheet: SHEETS.SEND_LOG, targetKey: p.id,
      oldValue: p.quarterId + ' 第 ' + p.versionNo + ' 版 ' + p.stage + '：共 ' + p.total + ' 位',
      newValue: plan.auditText.replace('{N}', String(info.remaining)), source: 'apiAbandonSendBatch'
    });
    return { ok: true, stageChangedTo: plan.newStage || '',
      message: plan.message.replace(/\{N\}/g, String(info.remaining)) };
  });
}

/**
 * 第一百一十輪批次 TB-2 組：放棄一批之後，季度進度（`Quarters.Stage`）要怎樣。**純函式。**
 *
 * 狀態卡及〔給所有人〕的把關（`assertNeverOfficiallySent_()`）都是「SendLog 有任何 OFFICIAL 紀錄
 * ＝已經正式發出過」。正式發出寄到一半就放棄，以前 Stage 停在正式發出之前，結果：
 * 狀態卡說已經正式發出、〔給所有人〕被擋，但〔變動的人〕又要 Stage＝OFFICIAL_SENT 才可以用。
 * 所以用**同一個數**判斷：這一季有 OFFICIAL 紀錄 ⇒ Stage 推進到 OFFICIAL_SENT；
 * 一筆都沒有 ⇒ Stage 不變，之後可以再按〔給所有人〕（把關見 0 筆不會擋）。
 * 審閱本寄出一部分就放棄 ⇒ 照全部寄完時的做法設為 REVIEW_SENT（已正式發出就不退回）。
 * 改動後重發本來就在 OFFICIAL_SENT ⇒ 不用改。
 *
 * @param {Object} record 批次紀錄（kind、stage、quarterId）
 * @param {string} currentStage 現時 Stage
 * @param {number} officialRows 這一季 SendLog 的 OFFICIAL 紀錄數（和把關同一個數）
 * @param {number} processedCount 這一批已處理人數
 * @returns {{newStage: string, reason: string, auditText: string, message: string}}
 */
function planStageAfterAbandonedBatch_(record, currentStage, officialRows, processedCount) {
  const rest = '餘下 {N} 位請用「進階與診斷 ▸ 補寄未收到的人」寄出（只會寄給還沒有收到的人）。';
  const out = { newStage: '', reason: '', auditText: '放棄餘下 {N} 位', message: '已放棄這一批餘下的 {N} 位。' + rest };
  if (!record || record.kind !== SEND_BATCH_KIND.STAGE) return out;
  if (record.stage === MAIL_STAGES.OFFICIAL) {
    if (!(officialRows > 0)) {
      out.auditText = '一位都未寄出就放棄（餘下 {N} 位）；進度不變';
      out.message = '已放棄這一批。一位都還沒有寄出，這一季的進度沒有改變，可以再按第 3 步〔給所有人〕。';
      return out;
    }
    out.auditText = '部分寄出後放棄，餘下 {N} 位請用〔補寄未收到的人〕';
    out.message = '已放棄這一批餘下的 {N} 位。已經寄出的部分是正式發出，所以這一季的進度改為「已正式發出」。' + rest;
    if (currentStage !== QUARTER_STAGE.OFFICIAL_SENT) {
      out.newStage = QUARTER_STAGE.OFFICIAL_SENT;
      out.reason = '正式發出部分寄出後放棄';
    }
    return out;
  }
  if (record.stage === MAIL_STAGES.REVIEW && processedCount > 0 && currentStage !== QUARTER_STAGE.OFFICIAL_SENT
    && currentStage !== QUARTER_STAGE.REVIEW_SENT) {
    out.newStage = QUARTER_STAGE.REVIEW_SENT;
    out.reason = '審閱本部分寄出後放棄';
    out.auditText = '部分寄出後放棄，餘下 {N} 位請用〔補寄未收到的人〕';
  }
  return out;
}
