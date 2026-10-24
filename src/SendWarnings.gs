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
      // 第七十六輪批次 DB 組：冇 PersonID 但有名（外請講員、名單以外嘅名、臨時幫手）要帶住，
      // 否則 `listGenuineBlankCells_()` 會把佢哋當成「沒有人」（第七十五輪回歸 R10）
      freeText: originalFreeText_(a),
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
 *   unreleased: {count: number, items: Object[], moreCount: number},
 *   error: string}}
 *   第七十三輪批次 BA 組：`unreleased`＝**未放行**嘅硬規則違反（儲存確認嘅「真違反」同一個定義），
 *   改動後重發／正式發出嘅確認窗用黃框提醒，**不阻擋**。
 *   `items` 最多 `SEND_WARNING_LIST_LIMIT` 項，其餘入 `moreCount`。
 *   每項：`{serviceDate, postId, postNameTC, slotIndex, personId, personName, ruleId, reason, releasedVersionNo}`
 */
function summariseVersionSendWarnings_(quarterId, versionNo) {
  const empty = { count: 0, items: [], moreCount: 0 };
  const out = { versionNo: versionNo, blank: empty, released: empty, unreleased: empty, error: '' };
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
    // 第七十三輪批次 BA 組：未放行嘅（`classified.real`）——寄出時只提醒，不阻擋
    const unreleased = classified.real.map(function (v) {
      return {
        serviceDate: v.serviceDate, postId: v.postId,
        postNameTC: postNames[v.postId] || v.postId, slotIndex: v.slotIndex,
        personId: v.personId || '', personName: nameOfPersonId_(context, v.personId),
        ruleId: v.ruleId, reason: v.reason || v.ruleId
      };
    });
    out.blank = limitSendWarningList_(blanks);
    out.released = limitSendWarningList_(released);
    out.unreleased = limitSendWarningList_(unreleased);
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

/**
 * 第六十七輪批次 AI 組：**名單改了之後，最新一版有幾多格的人已經唔喺該崗位名單上。**
 *
 * Ivan：「改完名單要知道哪幾格要重排。」之前「儲存並套用名單」只講「這幾位已經排在
 * 現有職事表上」（`stillAssigned`——按**移走嘅人**數），而「名單維護 ▸ 更改各崗位的
 * 事奉人員」儲存完一句都冇講。兩邊各自算又會對唔上，所以呢度同 `findStateViolations_()`
 * **同一套判斷**（`RULE_IDS.ELIGIBILITY`），對已儲存嘅最新版本算一次，三個地方
 *（兩個儲存結果窗、狀態卡／第 2 步）都讀呢一份。
 *
 * 第六十八輪批次 AM 組：**已放行嘅格唔計**。幹事明知而放行嘅格（例如匯入時放行一個
 * 唔喺名單上嘅人做領詩），狀態卡再話「要你再望一眼」只會令人以為係名單改動做成。
 * 「已放行」同第六十七輪 AG 組**同一支判斷**（`classifySaveConfirmViolations_()` 的 `released`），
 * 唔另寫一份；分類失敗時該函式會把全部當真違反，所以最差情況只係多報，唔會漏報。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{versionNo: number, count: number, items: Object[], moreCount: number, error: string}}
 *   每項 `{serviceDate, postId, postNameTC, slotIndex, personId, personName}`
 */
function summariseEligibilityImpact_(quarterId) {
  const out = { versionNo: -1, count: 0, items: [], moreCount: 0, error: '' };
  try {
    const versionNo = findLatestVersionNo(quarterId);
    out.versionNo = versionNo;
    if (!(versionNo >= 0)) return out;
    const context = buildFineTuneContext_(quarterId, versionNo, { skipGrid: true });
    const state = versionStateFromOriginal_(context);
    const postNames = {};
    (context.posts || []).forEach(function (p) { postNames[p.postId] = p.postNameTC; });

    const seen = {};
    const items = [];
    const eligibility = findStateViolations_(state, context).filter(function (v) {
      return v.ruleId === RULE_IDS.ELIGIBILITY;
    });
    const releasedKeys = {};
    classifySaveConfirmViolations_(quarterId, versionNo, eligibility).released.forEach(function (v) {
      releasedKeys[cellKey_(v.serviceDate, v.postId, v.slotIndex)] = true;
    });
    eligibility.forEach(function (v) {
      const key = cellKey_(v.serviceDate, v.postId, v.slotIndex);
      if (releasedKeys[key]) return;
      if (seen[key]) return;
      seen[key] = true;
      items.push({
        serviceDate: v.serviceDate, postId: v.postId,
        postNameTC: postNames[v.postId] || v.postId, slotIndex: v.slotIndex,
        personId: v.personId || '', personName: nameOfPersonId_(context, v.personId)
      });
    });
    const limited = limitSendWarningList_(items);
    out.count = limited.count;
    out.items = limited.items;
    out.moreCount = limited.moreCount;
  } catch (err) {
    if (typeof log_ === 'function') {
      log_('WARN', 'summariseEligibilityImpact_（' + quarterId + '）算不到：' + err.message);
    }
    out.error = err.message;
  }
  return out;
}
