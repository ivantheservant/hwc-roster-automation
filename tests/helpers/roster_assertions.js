// 階段 A（Opus 深度輪）新增：把 roster_patterns_rules.md 的硬規則清單寫成
// 可執行的斷言。這是「系統絕不自動違反硬規則」這句話的自動化證據。
//
// 刻意用兩層互相獨立的檢查，兩層都必須零違反：
//
// 【第一層：重用正式碼的規則引擎】
//   直接呼叫 FineTune.gs 真正的 findStateViolations_()——就是步驟 3／5 套用
//   申報之後「重跑規則檢查」用的同一個函式。這一層回答的問題是：
//   **「按照系統自己的 RuleSettings 設定，這份排表有沒有違反規則？」**
//   優先重用而不是另寫一份，正是為了避免副本走樣（見 A1 的指示）。
//
// 【第二層：不看 RuleSettings 的獨立結構檢查】
//   逐條照 roster_patterns_rules.md 的文字直接檢查排表結果，完全不理
//   RuleSettings 怎麼設定。這一層回答的是另一個問題：
//   **「不論系統怎樣設定，這份排表有沒有違反規格文件寫明的硬規則？」**
//
//   為什麼需要第二層：第一層有一個結構性盲點——findStateViolations_() 只會
//   回報「RuleSettings 裡 Enabled=TRUE 而且 Level=HARD」的規則。如果哪天有人
//   （或哪次改動）把 HARD_ELIGIBILITY 的 Level 改成 SOFT、或 Enabled 改成
//   FALSE，第一層會安靜地回報「零違反」，測試照樣全綠，但實際上系統已經在
//   亂派人。第二層不看設定、只看結果，這種情況會被抓到。
//
//   這不算「另寫一份會走樣的副本」：兩層的目的與輸入不同（一個看設定、一個
//   看規格），互為對照才有意義。真正要避免的是「抄一份同樣讀 RuleSettings
//   的判斷邏輯」，那種副本才會跟正式碼各自漂移。

/**
 * 把 buildRoster_() 的 assignments 轉成 findStateViolations_() 要的 state 格式。
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @returns {Object[]} state
 */
function toViolationState(assignments) {
  return assignments.map(function (a) {
    return {
      serviceDateId: a.serviceDateId,
      serviceDate: a.serviceDate,
      postId: a.postId,
      slotIndex: a.slotIndex,
      personId: a.personId,
      isManual: false
    };
  });
}

/**
 * 第一層：用正式碼的規則引擎檢查，只挑出 HARD 級別的違反。
 * @param {Object} gas gas_loader 載入的沙箱
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @param {Object} context 生成時用的 context
 * @returns {Object[]} HARD 違反清單（正常情況應該是空陣列）
 */
function findHardViolationsViaEngine(gas, assignments, context) {
  return gas.findStateViolations_(toViolationState(assignments), context)
    .filter(function (v) { return v.severity === gas.RULE_LEVELS.HARD; });
}

/**
 * 第一層（附帶）：挑出 SEMI_HARD 級別的違反（準硬規則，A4 用）。
 * @param {Object} gas gas_loader 載入的沙箱
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @param {Object} context 生成時用的 context
 * @returns {Object[]} SEMI_HARD 違反清單
 */
function findSemiHardViolationsViaEngine(gas, assignments, context) {
  return gas.findStateViolations_(toViolationState(assignments), context)
    .filter(function (v) { return v.severity === gas.RULE_LEVELS.SEMI_HARD; });
}

/**
 * 第二層：完全不看 RuleSettings，逐條照 roster_patterns_rules.md 的硬規則
 * 直接檢查排表結果。
 *
 * 涵蓋規格文件「A. 硬規則（系統絕不自動違反）」表格的全部六條：
 *   1. 崗位資格——只可派曾任該崗位的人（Eligibility）
 *   2. 同週 司事1 ≠ 司事2（泛化成：任何 distinctWithinPost=TRUE 的崗位）
 *   3. 同週 司數1 ≠ 司數2（同上，由第 2 條一併涵蓋）
 *   4. 當事人已表明該日不能服侍
 *   5. 聖餐襄禮只在每月第一個主日（泛化成：frequency=FIRST_SUNDAY 的崗位）
 *   6. 講員不自動生成（泛化成：autoGenerate=FALSE 的崗位）
 *
 * @param {Object} gas gas_loader 載入的沙箱（借用 isPersonUnavailable_ 判斷日期範圍）
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @param {Object} context 生成時用的 context
 * @returns {Object[]} 違反清單，每項為 {rule, serviceDate, postId, slotIndex, personId, detail}
 */
function findHardViolationsIndependently(gas, assignments, context) {
  const violations = [];
  const postById = {};
  context.posts.forEach(function (p) { postById[p.postId] = p; });
  const dateById = {};
  context.serviceDates.forEach(function (d) { dateById[d.serviceDate] = d; });

  const record = function (rule, a, detail) {
    violations.push({
      rule: rule, serviceDate: a.serviceDate, postId: a.postId,
      slotIndex: a.slotIndex, personId: a.personId, detail: detail
    });
  };

  // ---- 規則 1／4／5／6：逐格檢查 ----
  assignments.forEach(function (a) {
    const post = postById[a.postId];
    if (!post) return;

    // 規則 6：autoGenerate=FALSE 的崗位（講員／翻譯）絕不可以有人
    if (!post.autoGenerate) {
      if (a.personId) record('講員不自動生成', a, '崗位 autoGenerate=FALSE 卻被派了人');
      return; // 這種崗位不需要再檢查其餘規則
    }

    // 規則 5：frequency=FIRST_SUNDAY 的崗位（聖餐襄禮）只可以在該月第一個主日有人
    if (post.frequency === 'FIRST_SUNDAY') {
      const dateInfo = dateById[a.serviceDate];
      if (a.personId && dateInfo && !dateInfo.isFirstSundayOfMonth) {
        record('聖餐襄禮只在每月第一個主日', a, '出現在非每月第一主日');
      }
    }

    if (!a.personId) return; // 留空的格不需要檢查以下規則

    // 規則 1：只可派曾任該崗位的人
    const pool = (context.eligibility.byPost || {})[a.postId] || [];
    if (pool.indexOf(a.personId) === -1) {
      record('崗位資格', a, '不在 Eligibility 名單內');
    }

    // 規則 4：當事人已表明該日不能服侍
    if (gas.isPersonUnavailable_(a.personId, a.serviceDate, a.postId, context.unavailable)) {
      record('當事人已表明該日不能服侍', a, '該日 Unavailable 有紀錄');
    }
  });

  // ---- 規則 2／3：同週同崗位不可重複（司事、司數等 distinctWithinPost 崗位）----
  const byDatePost = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    const key = a.serviceDate + '|' + a.postId;
    if (!byDatePost[key]) byDatePost[key] = [];
    byDatePost[key].push(a);
  });
  Object.keys(byDatePost).forEach(function (key) {
    const group = byDatePost[key];
    const post = postById[group[0].postId];
    if (!post || !post.distinctWithinPost) return;
    const seen = {};
    group.forEach(function (a) {
      if (seen[a.personId]) {
        record('同週同崗位不可重複', a, '同一週同一崗位重複派了同一人');
      }
      seen[a.personId] = true;
    });
  });

  return violations;
}

/**
 * 一次過跑齊兩層檢查，回傳合併結果。
 * @param {Object} gas gas_loader 載入的沙箱
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @param {Object} context 生成時用的 context
 * @returns {{engine: Object[], independent: Object[], total: number}}
 */
function checkAllHardRules(gas, assignments, context) {
  const engine = findHardViolationsViaEngine(gas, assignments, context);
  const independent = findHardViolationsIndependently(gas, assignments, context);
  return { engine: engine, independent: independent, total: engine.length + independent.length };
}

/**
 * 把違反清單整理成一行行可讀文字，測試失敗時印出來方便定位。
 * @param {{engine: Object[], independent: Object[]}} result checkAllHardRules() 的結果
 * @param {number=} limit 最多印幾項，預設 5
 * @returns {string}
 */
function describeViolations(result, limit) {
  const max = limit || 5;
  const lines = [];
  result.engine.slice(0, max).forEach(function (v) {
    lines.push('  [規則引擎] ' + v.serviceDate + ' ' + v.postId + '#' + v.slotIndex
      + ' ' + v.personId + ' ' + v.ruleId + '：' + v.reason);
  });
  if (result.engine.length > max) lines.push('  [規則引擎] ……另有 ' + (result.engine.length - max) + ' 項');
  result.independent.slice(0, max).forEach(function (v) {
    lines.push('  [獨立檢查] ' + v.serviceDate + ' ' + v.postId + '#' + v.slotIndex
      + ' ' + v.personId + ' ' + v.rule + '：' + v.detail);
  });
  if (result.independent.length > max) lines.push('  [獨立檢查] ……另有 ' + (result.independent.length - max) + ' 項');
  return lines.join('\n');
}

/**
 * 統計軟規則的實際達成數值（A5 用）。
 * @param {Object[]} assignments buildRoster_() 的輸出
 * @param {Object} context 生成時用的 context
 * @param {string} chairPostId 主席崗位 ID
 * @param {string} announcePostId 報告崗位 ID
 * @returns {{weeks: number, chairEqAnnounceRatio: number, announceConsecutiveRatio: number,
 *   countsByPerson: Object.<string, number>, peopleServed: number, maxCount: number, avgCount: number}}
 */
function measureSoftRules(assignments, context, chairPostId, announcePostId) {
  const orderedDates = context.serviceDates.map(function (d) { return d.serviceDate; });
  const byDatePost = {};
  const countsByPerson = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!byDatePost[a.serviceDate]) byDatePost[a.serviceDate] = {};
    if (!byDatePost[a.serviceDate][a.postId]) byDatePost[a.serviceDate][a.postId] = [];
    byDatePost[a.serviceDate][a.postId].push(a.personId);
    countsByPerson[a.personId] = (countsByPerson[a.personId] || 0) + 1;
  });

  let chairEqAnnounce = 0;
  let announceConsecutive = 0;
  orderedDates.forEach(function (date, i) {
    const posts = byDatePost[date] || {};
    const chair = posts[chairPostId] || [];
    const announce = posts[announcePostId] || [];
    if (chair.length > 0 && announce.length > 0 && chair.indexOf(announce[0]) !== -1) {
      chairEqAnnounce++;
    }
    if (i > 0) {
      const prevAnnounce = (byDatePost[orderedDates[i - 1]] || {})[announcePostId] || [];
      if (announce.length > 0 && prevAnnounce.indexOf(announce[0]) !== -1) {
        announceConsecutive++;
      }
    }
  });

  const counts = Object.keys(countsByPerson).map(function (k) { return countsByPerson[k]; });
  const sum = counts.reduce(function (t, n) { return t + n; }, 0);

  return {
    weeks: orderedDates.length,
    chairEqAnnounceRatio: orderedDates.length > 0 ? chairEqAnnounce / orderedDates.length : 0,
    announceConsecutiveRatio: orderedDates.length > 1 ? announceConsecutive / (orderedDates.length - 1) : 0,
    countsByPerson: countsByPerson,
    peopleServed: counts.length,
    maxCount: counts.length > 0 ? Math.max.apply(null, counts) : 0,
    avgCount: counts.length > 0 ? sum / counts.length : 0
  };
}

module.exports = {
  toViolationState,
  findHardViolationsViaEngine,
  findSemiHardViolationsViaEngine,
  findHardViolationsIndependently,
  checkAllHardRules,
  describeViolations,
  measureSoftRules
};
