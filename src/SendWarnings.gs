/**
 * 第六十七輪批次 AG／AH 組：**寄出前要講嘅兩樣嘢**——呢一版有幾多格應該有人而冇人（AH），
 * 同埋呢一季有幾多格係幹事放行咗嘅違反規則安排（AG）。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要一支共用
 * ═════════════════════════════════════════════════════════════════════
 *
 * Ivan 嘅要求：「有空格也可以發出，但要有警告」、「人手改動可以違反規則，放行之後整季記住」。
 * 之前只有儲存確認畫面講空格（`plan.blankCells`）；正式發出只提「待補（黃底）」格
 * （`listPendingBackfillCells_()`——只數 `AssignSource=SKIPPED`，幹事人手清空嘅格唔算）；
 * 寄審閱、改動後重發、狀態卡一句都冇。四個地方各寫一次，四個數字會慢慢唔一樣。
 *
 * 所以：**空格只有一個定義**（`listGenuineBlankCells_()`，第四十三輪 D／G 組嗰支，
 * 儲存確認用緊嘅同一支）；**已放行只有一個定義**（`classifySaveConfirmViolations_()`
 * → `classifyHardViolations_()`，同儲存確認用緊嘅同一套）。呢度只係對「最新已儲存版本」
 * 叫一次，交畀三個寄出確認框同狀態卡。
 *
 * ⚠️ 寄出嗰刻寄嘅係**已儲存嘅版本**（`assertNoUnsavedChanges_()` 保證），所以呢度用
 * `context.original`（版本紀錄），**唔疊加 grid**。
 *
 * 算唔到（例如版本紀錄讀唔到）⇒ 回 `error`，數字一律 0——呼叫端唔會因此冧，
 * 但畫面**唔可以**把「算唔到」當成「冇問題」，所以 `error` 要帶返去。
 */

/**
 * 由版本紀錄砌出派工狀態（同 `analyseManualState_()` 嘅 `manualState` 同一個形狀，
 * 但唔疊加 grid）。
 * @param {Object} context `buildFineTuneContext_()` 嘅結果
 * @returns {Object[]}
 */
function versionStateFromOriginal_(context) {
  return (context.original || []).map(function (a) {
    return {
      serviceDateId: a.serviceDateId,
      serviceDate: a.serviceDate,
      postId: a.postId,
      slotIndex: a.slotIndex,
      personId: a.personId || '',
      isManual: false
    };
  });
}

/**
 * 寄出前嘅警告摘要（唯讀）。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號（通常係最新）
 * @returns {{versionNo: number,
 *   blank: {count: number, items: Object[], moreCount: number},
 *   released: {count: number, items: Object[], moreCount: number},
 *   error: string}}
 *   `items` 最多 `SEND_WARNING_LIST_LIMIT` 項，其餘入 `moreCount`。
 *   每項：`{serviceDate, postId, postNameTC, slotIndex, personId, personName, ruleId, reason, releasedVersionNo}`
 */
function summariseVersionSendWarnings_(quarterId, versionNo) {
  const empty = { count: 0, items: [], moreCount: 0 };
  const out = { versionNo: versionNo, blank: empty, released: empty, error: '' };
  if (!(versionNo >= 0)) return out;
  try {
    // 唔讀 grid（`skipGrid`）：呢度要嘅係已儲存版本，而且 grid 嗰次讀取係整個 context 最貴嘅一步。
    const context = buildFineTuneContext_(quarterId, versionNo, { skipGrid: true });
    const state = versionStateFromOriginal_(context);
    const postNames = {};
    (context.posts || []).forEach(function (p) { postNames[p.postId] = p.postNameTC; });

    const blanks = listGenuineBlankCells_(state, context).map(function (b) {
      return {
        serviceDate: b.serviceDate, postId: b.postId,
        postNameTC: postNames[b.postId] || b.postId, slotIndex: b.slotIndex
      };
    });
    const violations = findStateViolations_(state, context);
    const classified = classifySaveConfirmViolations_(quarterId, versionNo, violations);
    const released = classified.released.map(function (v) {
      return {
        serviceDate: v.serviceDate, postId: v.postId,
        postNameTC: postNames[v.postId] || v.postId, slotIndex: v.slotIndex,
        personId: v.personId || '', personName: nameOfPersonId_(context, v.personId),
        ruleId: v.ruleId, reason: v.reason || v.ruleId,
        releasedVersionNo: v.releasedVersionNo === undefined ? null : v.releasedVersionNo
      };
    });
    out.blank = limitSendWarningList_(blanks);
    out.released = limitSendWarningList_(released);
  } catch (err) {
    if (typeof log_ === 'function') {
      log_('WARN', 'summariseVersionSendWarnings_（' + quarterId + ' v' + versionNo + '）算不到：' + err.message);
    }
    out.error = err.message;
  }
  return out;
}

/** 清單最多出幾多項，其餘用「另有 N 格」。 */
const SEND_WARNING_LIST_LIMIT = 10;

/**
 * @param {Object[]} items 全部
 * @returns {{count: number, items: Object[], moreCount: number}}
 */
function limitSendWarningList_(items) {
  return {
    count: items.length,
    items: items.slice(0, SEND_WARNING_LIST_LIMIT),
    moreCount: Math.max(0, items.length - SEND_WARNING_LIST_LIMIT)
  };
}
