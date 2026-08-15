/**
 * 軟規則實測量度工具（唯讀，只寫 Diagnostics）。
 *
 * 存在的理由：軟規則（主席兼報告比例、報告連續兩週比例、每人每季次數貼近歷史
 * 分佈）到目前為止**只有離線 mock 測試**，從來沒有對真實生成結果量度過。
 * 2027T1 五個步驟雖然全部在真實試算表跑通，但「跑得完」跟「排出來的表符合
 * 歷史習慣」是兩件事——後者一直沒有數字可以看。
 *
 * 跟既有工具的分工（刻意不重複造輪子）：
 * - `Verify.gs` 的 `verifyRoster()` 已經算過其中幾項，但它**會建立一張
 *   `Verify_XXXX_vN` 工作表**，不是唯讀工具；而且它的目標欄取自 RuleSettings
 *   的 TargetValue，不是「歷史 78 週基準」，兩者用途不同。
 *   本檔案**直接重用**它的 `buildVerifyContext_()`／`computeChairEqAnnounceRatio_()`／
 *   `computeAnnounceConsecutiveRatio_()`／`computeServiceDistribution_()`，
 *   不另外抄一份計算邏輯——抄一份的話兩邊遲早會算出不同的數字。
 * - `MultiRun.gs` 的 `compareMultiRun()` 算的是「多份候選表的比較」，
 *   而且會寫 `MultiRun_Result` 工作表，同樣不是唯讀。
 *
 * 本檔案自己新增的，是那兩個既有工具都沒有的兩項：
 * - 準硬規則（同一崗位連續兩週同一人）的**違反明細**（哪一週、哪個崗位、誰），
 *   既有的 `computeAdjacentRepeatRates_()` 只給得出數量。
 * - **各崗位實際動用了多少人 vs 該崗位合資格人數**——人手集中在少數人身上
 *   （例如某崗位有 12 個人合資格，實際整季只用了 3 個）是排表品質的重要警號，
 *   但完全不會被任何既有指標反映出來。
 *
 * 唯讀保證：本檔案只呼叫 `readSheet()`／`readConfig()` 這類讀取函式與
 * `writeDiagnosticsReport_()`，完全沒有其他 `setValue`／`insertSheet`／
 * `deleteSheet` 呼叫，也不會產生版本、不會寄信。
 */

/** 判斷結果的固定文字，供報告與測試共用一個來源。 */
const SOFT_METRIC_JUDGEMENT = {
  NORMAL: '正常',
  HIGH: '偏高，建議留意',
  LOW: '偏低，建議留意',
  UNKNOWN: '無法判斷（資料不足）'
};

/**
 * 讀取判斷門檻。三個門檻全部可在 Config 調校，不寫死在程式碼裡——不同季度的
 * 人手鬆緊差很遠，「差多少才算偏離」本來就應該由幹事按實際情況調整。
 * 缺少、留空或數值無效時一律退回 DEFAULTS（見 `readNumericConfig_()`）。
 * @returns {{ratioTolerance: number, countToleranceRatio: number, postUsageMinRatio: number}}
 */
function readSoftMetricThresholds_() {
  const config = readConfig();
  return {
    ratioTolerance: readNumericConfig_(config,
      CONFIG_KEYS.SOFT_METRIC_RATIO_TOLERANCE, DEFAULTS.SOFT_METRIC_RATIO_TOLERANCE),
    countToleranceRatio: readNumericConfig_(config,
      CONFIG_KEYS.SOFT_METRIC_COUNT_TOLERANCE_RATIO, DEFAULTS.SOFT_METRIC_COUNT_TOLERANCE_RATIO),
    postUsageMinRatio: readNumericConfig_(config,
      CONFIG_KEYS.SOFT_METRIC_POST_USAGE_MIN_RATIO, DEFAULTS.SOFT_METRIC_POST_USAGE_MIN_RATIO)
  };
}

/**
 * 把「本版實測」與「歷史基準」比較，算出差距與一句人話判斷。
 * 純函式，測試直接呼叫這一份。
 * @param {?number} actual 本版實測值
 * @param {?number} baseline 歷史基準值
 * @param {number} tolerance 容差（與 actual／baseline 同單位）
 * @returns {{gap: ?number, judgement: string}} 差距（實測 − 基準）與判斷文字
 */
function judgeAgainstBaseline_(actual, baseline, tolerance) {
  if (actual === null || actual === undefined || isNaN(actual)
    || baseline === null || baseline === undefined || isNaN(baseline)) {
    return { gap: null, judgement: SOFT_METRIC_JUDGEMENT.UNKNOWN };
  }
  const gap = actual - baseline;
  if (Math.abs(gap) <= Math.abs(tolerance)) {
    return { gap: gap, judgement: SOFT_METRIC_JUDGEMENT.NORMAL };
  }
  return { gap: gap, judgement: gap > 0 ? SOFT_METRIC_JUDGEMENT.HIGH : SOFT_METRIC_JUDGEMENT.LOW };
}

/**
 * 找出「同一崗位連續兩個主日派了同一個人」的全部實例，並附明細。
 *
 * 這正是 `SEMI_NO_CONSECUTIVE` 這條準硬規則要避免的情況。判斷範圍刻意跟
 * `Generator.gs` 的 `evaluateViolations_()` 一致：只看 `AllowConsecutive`
 * 不是 `ALLOW` 的崗位——`ALLOW` 的崗位（最典型是報告這個「洩壓閥」崗位）
 * 連續兩週本來就是容許的設計，把它算成違反只會製造大量假警報。
 *
 * 純函式，不讀任何工作表。
 * @param {Object[]} assignments 已正規化的派工紀錄（含 serviceDate／postId／personId／personName）
 * @param {Object[]} posts 已正規化的崗位清單（含 allowConsecutive）
 * @param {string[]} sortedDates 本季主日日期，由早到晚
 * @returns {{count: number, details: Object[]}} 違反總數與明細
 *   （每項 {serviceDate, previousDate, postId, postNameTC, personId, personName, allowConsecutive}）
 */
function listConsecutiveSamePersonViolations_(assignments, posts, sortedDates) {
  const byPostDate = {};
  const nameById = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (a.personName) nameById[a.personId] = a.personName;
    if (!byPostDate[a.postId]) byPostDate[a.postId] = {};
    if (!byPostDate[a.postId][a.serviceDate]) byPostDate[a.postId][a.serviceDate] = [];
    byPostDate[a.postId][a.serviceDate].push(a.personId);
  });

  const details = [];
  posts.forEach(function (post) {
    // 跟 Generator.gs 的 evaluateViolations_() 同一個條件：ALLOW 不算違反
    if (post.allowConsecutive === ALLOW_CONSECUTIVE.ALLOW) return;
    const byDate = byPostDate[post.postId] || {};
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = byDate[sortedDates[i - 1]] || [];
      const cur = byDate[sortedDates[i]] || [];
      if (prev.length === 0 || cur.length === 0) continue;
      cur.forEach(function (personId) {
        if (prev.indexOf(personId) === -1) return;
        details.push({
          serviceDate: sortedDates[i],
          previousDate: sortedDates[i - 1],
          postId: post.postId,
          postNameTC: post.postNameTC,
          personId: personId,
          personName: nameById[personId] || personId,
          allowConsecutive: post.allowConsecutive
        });
      });
    }
  });

  return { count: details.length, details: details };
}

/**
 * 計算每個崗位「實際動用了多少人」對「該崗位合資格人數」的比例。
 *
 * 這一項既有工具完全沒有。它回答的是一個排表品質上很重要、但從其他指標
 * 完全看不出來的問題：**人手有沒有過度集中在少數幾個人身上**。
 * 例如某崗位有 12 個人合資格，整季卻只用了 3 個人，其餘 9 個從來沒被派到——
 * 每人次數分佈、比例型規則全部都可能顯示「正常」，因為那些指標看的是
 * 「有服侍的人之間」的分佈，看不到「完全沒被叫到的人」。
 *
 * 只統計本季真的有派工格的崗位（`assignedSlots > 0`）——`AutoGenerate=FALSE`
 * 的講員／翻譯／獻花這類崗位整季都是空的，列出來只是噪音。
 *
 * 純函式，不讀任何工作表。
 * @param {Object[]} assignments 已正規化的派工紀錄
 * @param {Object[]} posts 已正規化的崗位清單
 * @param {Object.<string, string[]>} eligibleByPost `readEligibility().byPost`
 * @param {number} minRatio 動用率低於這個值就標為偏低
 * @returns {Object[]} 每個崗位一項，含 usedCount／eligibleCount／ratio／judgement／unusedPeople
 */
function computePostManpowerUsage_(assignments, posts, eligibleByPost, minRatio) {
  const usedByPost = {};
  const assignedSlotsByPost = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!usedByPost[a.postId]) usedByPost[a.postId] = {};
    usedByPost[a.postId][a.personId] = (usedByPost[a.postId][a.personId] || 0) + 1;
    assignedSlotsByPost[a.postId] = (assignedSlotsByPost[a.postId] || 0) + 1;
  });

  return posts
    .filter(function (post) { return (assignedSlotsByPost[post.postId] || 0) > 0; })
    .map(function (post) {
      const used = usedByPost[post.postId] || {};
      const usedIds = Object.keys(used);
      const eligible = eligibleByPost[post.postId] || [];
      const eligibleCount = eligible.length;
      const ratio = eligibleCount === 0 ? null : usedIds.length / eligibleCount;
      const unusedPeople = eligible.filter(function (id) { return !used[id]; });
      return {
        postId: post.postId,
        postNameTC: post.postNameTC,
        assignedSlots: assignedSlotsByPost[post.postId] || 0,
        usedCount: usedIds.length,
        eligibleCount: eligibleCount,
        ratio: ratio,
        unusedCount: unusedPeople.length,
        unusedPeople: unusedPeople,
        judgement: ratio === null
          ? SOFT_METRIC_JUDGEMENT.UNKNOWN
          : (ratio < minRatio ? SOFT_METRIC_JUDGEMENT.LOW : SOFT_METRIC_JUDGEMENT.NORMAL)
      };
    });
}

/**
 * 量度單一版本的全部軟規則指標。唯讀：只讀工作表，不寫任何東西。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 量度結果，供 `buildSoftRuleMetricRows_()` 與跨版本比較使用
 */
function measureSoftRuleMetrics_(quarterId, versionNo) {
  const context = buildVerifyContext_(quarterId, versionNo);
  if (context.assignments.length === 0) {
    throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄');
  }
  const thresholds = readSoftMetricThresholds_();
  const sortedDates = context.serviceDates.map(function (d) { return d.serviceDate; });

  // 前三項直接重用 Verify.gs 的計算，不另外抄一份
  const chairEq = computeChairEqAnnounceRatio_(context);
  const announce = computeAnnounceConsecutiveRatio_(context);
  const distribution = computeServiceDistribution_(context);

  const consecutive = listConsecutiveSamePersonViolations_(
    context.assignments, context.posts, sortedDates);
  const manpower = computePostManpowerUsage_(
    context.assignments, context.posts, context.eligibility.byPost, thresholds.postUsageMinRatio);

  // 歷史基準：比例型取自 RuleSettings 的 TargetValue（那就是由 78 週歷史算出來
  // 再寫進工作表的值），次數型取自 HISTORICAL_BASELINE（Constants.gs）
  const chairEqBaseline = chairEq ? chairEq.target : null;
  const announceBaseline = announce ? announce.target : null;

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    thresholds: thresholds,
    weekCount: sortedDates.length,
    chairEq: chairEq,
    chairEqBaseline: chairEqBaseline,
    chairEqJudgement: judgeAgainstBaseline_(
      chairEq ? chairEq.ratio : null, chairEqBaseline, thresholds.ratioTolerance),
    announce: announce,
    announceBaseline: announceBaseline,
    announceJudgement: judgeAgainstBaseline_(
      announce ? announce.ratio : null, announceBaseline, thresholds.ratioTolerance),
    distribution: distribution,
    peopleCountJudgement: judgeAgainstBaseline_(
      distribution.peopleCount, HISTORICAL_BASELINE.PEOPLE_COUNT,
      HISTORICAL_BASELINE.PEOPLE_COUNT * thresholds.countToleranceRatio),
    averageJudgement: judgeAgainstBaseline_(
      distribution.average, HISTORICAL_BASELINE.AVG_PER_PERSON,
      HISTORICAL_BASELINE.AVG_PER_PERSON * thresholds.countToleranceRatio),
    maxJudgement: judgeAgainstBaseline_(
      distribution.maxCount, HISTORICAL_BASELINE.MAX_PER_PERSON,
      HISTORICAL_BASELINE.MAX_PER_PERSON * thresholds.countToleranceRatio),
    consecutive: consecutive,
    manpower: manpower
  };
}

/**
 * 把比例格式化成百分比字串，`null` 顯示為「-」。
 * 沿用 `Verify.gs` 的 `formatPercent_()`，這裡只是多一層 null 保護。
 * @param {?number} ratio 比例
 * @returns {string} 百分比字串
 */
function formatMetricPercent_(ratio) {
  return (ratio === null || ratio === undefined) ? '-' : formatPercent_(ratio);
}

/**
 * 把差距格式化成帶正負號的字串，方便一眼看出是高於還是低於基準。
 * @param {?number} gap 差距
 * @param {boolean} asPercent 是否以百分點顯示
 * @returns {string} 例如 "+3.2 個百分點"／"-0.4 次"／"-"
 */
function formatMetricGap_(gap, asPercent) {
  if (gap === null || gap === undefined || isNaN(gap)) return '-';
  const sign = gap > 0 ? '+' : (gap < 0 ? '' : '±');
  return asPercent
    ? sign + (gap * 100).toFixed(1) + ' 個百分點'
    : sign + gap.toFixed(2) + ' 次';
}

/**
 * 把量度結果組成 Diagnostics 的行陣列：每一項都有「歷史基準／本版實測／差距／判斷」。
 * 純函式（除了 `diagRow_()` 這個純粹的物件包裝），不讀寫工作表。
 * @param {Object} m `measureSoftRuleMetrics_()` 的結果
 * @returns {Object[]} `diagRow_()` 產生的行陣列
 */
function buildSoftRuleMetricRows_(m) {
  const rows = [];
  const label = m.quarterId + ' v' + m.versionNo;
  const t = m.thresholds;

  rows.push(diagRow_('概況', label, m.weekCount + ' 個主日',
    '判斷門檻：比例型 ±' + (t.ratioTolerance * 100).toFixed(1) + ' 個百分點'
      + '　次數型 ±' + (t.countToleranceRatio * 100).toFixed(0) + '%'
      + '　崗位動用率下限 ' + (t.postUsageMinRatio * 100).toFixed(0) + '%'
      + '（三者皆可在 Config 調整，見 ' + CONFIG_KEYS.SOFT_METRIC_RATIO_TOLERANCE + ' 等三個 Key）'));

  // ---- 1. 主席與報告同一人 ----
  if (m.chairEq) {
    rows.push(diagRow_('1. 主席兼報告比例', label,
      '歷史基準 ' + formatMetricPercent_(m.chairEqBaseline)
        + '　→　本版實測 ' + formatMetricPercent_(m.chairEq.ratio),
      '差距 ' + formatMetricGap_(m.chairEqJudgement.gap, true)
        + '　判斷：' + m.chairEqJudgement.judgement
        + '　（' + m.chairEq.same + '/' + m.chairEq.weeks + ' 週）'));
  } else {
    rows.push(diagRow_('1. 主席兼報告比例', label, '無法計算',
      'RuleSettings 沒有 ' + RULE_IDS.CHAIR_EQ_ANNOUNCE + '，或該規則的 ScopePostIDs 不足兩個崗位'));
  }

  // ---- 2. 報告連續兩週同一人 ----
  if (m.announce) {
    rows.push(diagRow_('2. 報告連續兩週比例', label,
      '歷史基準 ' + formatMetricPercent_(m.announceBaseline)
        + '　→　本版實測 ' + formatMetricPercent_(m.announce.ratio),
      '差距 ' + formatMetricGap_(m.announceJudgement.gap, true)
        + '　判斷：' + m.announceJudgement.judgement
        + '　（' + m.announce.repeats + '/' + m.announce.pairs + ' 對相鄰主日）'));
  } else {
    rows.push(diagRow_('2. 報告連續兩週比例', label, '無法計算',
      'RuleSettings 沒有 ' + RULE_IDS.ANNOUNCE_RELIEF + '，或該規則的 ScopePostIDs 是空的'));
  }

  // ---- 3. 每人服侍次數分佈 ----
  const d = m.distribution;
  rows.push(diagRow_('3. 服侍次數分佈', '總用人數',
    '歷史基準 ' + HISTORICAL_BASELINE.PEOPLE_COUNT + ' 人　→　本版實測 ' + d.peopleCount + ' 人',
    '差距 ' + formatMetricGap_(m.peopleCountJudgement.gap, false).replace(' 次', ' 人')
      + '　判斷：' + m.peopleCountJudgement.judgement));
  rows.push(diagRow_('3. 服侍次數分佈', '平均次數',
    '歷史基準 ' + HISTORICAL_BASELINE.AVG_PER_PERSON + ' 次　→　本版實測 ' + d.average.toFixed(2) + ' 次',
    '差距 ' + formatMetricGap_(m.averageJudgement.gap, false)
      + '　判斷：' + m.averageJudgement.judgement));
  rows.push(diagRow_('3. 服侍次數分佈', '最高次數',
    '歷史基準 ' + HISTORICAL_BASELINE.MAX_PER_PERSON + ' 次　→　本版實測 ' + d.maxCount + ' 次',
    '差距 ' + formatMetricGap_(m.maxJudgement.gap, false)
      + '　判斷：' + m.maxJudgement.judgement));
  d.histogram.forEach(function (bucket) {
    const historical = HISTORICAL_BASELINE_DISTRIBUTION[bucket.count];
    rows.push(diagRow_('3. 服侍次數分佈（逐檔）', '服侍 ' + bucket.count + ' 次',
      '歷史 ' + (historical === undefined ? 0 : historical) + ' 人　→　本版 ' + bucket.people + ' 人',
      historical === undefined ? '歷史上沒有出現過這個次數' : ''));
  });

  // ---- 4. 準硬規則違反（含明細）----
  rows.push(diagRow_('4. 準硬規則（同崗位連續兩週）', '違反總數',
    m.consecutive.count + ' 項', '目標 0 項；只計 AllowConsecutive≠ALLOW 的崗位'
      + '（ALLOW 的崗位連續兩週是刻意容許的洩壓閥設計，不算違反）'));
  m.consecutive.details.forEach(function (v, i) {
    rows.push(diagRow_('4. 準硬規則（明細）', '#' + (i + 1) + ' ' + v.serviceDate,
      v.postNameTC + '　' + v.personName,
      '上一個主日（' + v.previousDate + '）同一崗位已經是此人；AllowConsecutive=' + v.allowConsecutive));
  });

  // ---- 5. 各崗位人手動用率 ----
  m.manpower.forEach(function (p) {
    rows.push(diagRow_('5. 崗位人手動用率', p.postNameTC + '（' + p.postId + '）',
      '動用 ' + p.usedCount + ' / 合資格 ' + p.eligibleCount + ' 人'
        + '　＝ ' + formatMetricPercent_(p.ratio),
      '本季派了 ' + p.assignedSlots + ' 格；判斷：' + p.judgement
        + (p.unusedCount > 0 ? '　整季未被派到：' + p.unusedCount + ' 人' : '')));
  });

  return rows;
}

/**
 * A3：同一季度兩個版本的並列比較，讓幹事看到人手修改與申報套用之後，
 * 軟規則數值有沒有被破壞。
 *
 * 預設比較 v0（系統原始生成）與最新版（人手改動與申報全部套用之後）——
 * 這正是「系統排出來的表」與「最後真正發出去的表」的差別。
 *
 * @param {Object} baseMetrics 舊版本（通常是 v0）的量度結果
 * @param {Object} latestMetrics 新版本（通常是最新版）的量度結果
 * @returns {Object[]} `diagRow_()` 產生的行陣列
 */
function buildSoftRuleVersionComparisonRows_(baseMetrics, latestMetrics) {
  const rows = [];
  const section = '6. 跨版本比較（v' + baseMetrics.versionNo + ' → v' + latestMetrics.versionNo + '）';

  const compare = function (item, oldValue, newValue, formatter) {
    if (oldValue === null || oldValue === undefined || newValue === null || newValue === undefined) {
      rows.push(diagRow_(section, item, '無法比較', '其中一個版本算不出這一項'));
      return;
    }
    const delta = newValue - oldValue;
    rows.push(diagRow_(section, item,
      formatter(oldValue) + '　→　' + formatter(newValue),
      delta === 0 ? '沒有變化'
        : '變動 ' + (delta > 0 ? '+' : '') + formatter(delta)
          + (Math.abs(delta) > 0 ? '（人手改動與申報套用造成）' : '')));
  };

  const asPercent = function (v) { return (v * 100).toFixed(1) + '%'; };
  const asCount = function (v) { return v.toFixed(2) + ' 次'; };
  const asPeople = function (v) { return v + ' 人'; };

  compare('主席兼報告比例',
    baseMetrics.chairEq ? baseMetrics.chairEq.ratio : null,
    latestMetrics.chairEq ? latestMetrics.chairEq.ratio : null, asPercent);
  compare('報告連續兩週比例',
    baseMetrics.announce ? baseMetrics.announce.ratio : null,
    latestMetrics.announce ? latestMetrics.announce.ratio : null, asPercent);
  compare('總用人數',
    baseMetrics.distribution.peopleCount, latestMetrics.distribution.peopleCount, asPeople);
  compare('平均次數',
    baseMetrics.distribution.average, latestMetrics.distribution.average, asCount);
  compare('最高次數',
    baseMetrics.distribution.maxCount, latestMetrics.distribution.maxCount, function (v) { return v + ' 次'; });

  // 準硬規則違反數變多，是人手改動破壞了規則的最直接證據，單獨標示
  const oldCount = baseMetrics.consecutive.count;
  const newCount = latestMetrics.consecutive.count;
  rows.push(diagRow_(section, '準硬規則違反數',
    oldCount + ' 項　→　' + newCount + ' 項',
    newCount > oldCount
      ? '⚠️ 增加了 ' + (newCount - oldCount) + ' 項——人手改動或申報套用引入了新的「同崗位連續兩週」，'
        + '請看上面第 4 節的明細確認是否可以接受'
      : (newCount < oldCount ? '減少了 ' + (oldCount - newCount) + ' 項' : '沒有變化')));

  return rows;
}

/**
 * 選單項目「查看 ▸ 軟規則實測量度（唯讀）」的執行入口。
 *
 * 唯讀：只讀取資料與寫入 Diagnostics，不建立任何工作表、不產生版本、不寄信。
 * @returns {void}
 */
function runSoftRuleMetrics_() {
  const ui = SpreadsheetApp.getUi();
  const title = '軟規則實測量度（唯讀）';
  const target = promptQuarterAndVersion_(title);
  if (!target) return;

  let metrics;
  let rows;
  let baseMetrics = null;
  try {
    metrics = measureSoftRuleMetrics_(target.quarterId, target.versionNo);
    rows = buildSoftRuleMetricRows_(metrics);

    // A3：如果量度的不是 v0 本身，順帶跟 v0 並列比較。v0 不存在（例如舊資料
    // 已封存、或該季根本沒有 v0）只是拿不到比較基準，不應該令整個工具失敗，
    // 所以獨立 try/catch，失敗時報告照樣產生、只是少了第 6 節。
    if (target.versionNo !== 0) {
      try {
        baseMetrics = measureSoftRuleMetrics_(target.quarterId, 0);
        rows = rows.concat(buildSoftRuleVersionComparisonRows_(baseMetrics, metrics));
      } catch (err) {
        rows.push(diagRow_('6. 跨版本比較', 'v0', '無法比較', 'v0 讀不到：' + err.message));
      }
    }
  } catch (err) {
    log_('ERROR', 'runSoftRuleMetrics_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  // 第十二輪批次階段 C【bug 修正】：tryWriteDiagnostics_() 回傳嘅係
  // 「有冇成功寫入」嘅布林值，唔係寫入行數，行數應該係 rows.length。
  tryWriteDiagnostics_('軟規則實測量度', rows);
  const written = rows.length;

  const flagged = [];
  if (metrics.chairEqJudgement.judgement !== SOFT_METRIC_JUDGEMENT.NORMAL
    && metrics.chairEqJudgement.judgement !== SOFT_METRIC_JUDGEMENT.UNKNOWN) {
    flagged.push('主席兼報告比例：' + metrics.chairEqJudgement.judgement);
  }
  if (metrics.announceJudgement.judgement !== SOFT_METRIC_JUDGEMENT.NORMAL
    && metrics.announceJudgement.judgement !== SOFT_METRIC_JUDGEMENT.UNKNOWN) {
    flagged.push('報告連續兩週比例：' + metrics.announceJudgement.judgement);
  }
  const lowUsage = metrics.manpower.filter(function (p) {
    return p.judgement === SOFT_METRIC_JUDGEMENT.LOW;
  });
  if (lowUsage.length > 0) {
    flagged.push('崗位人手動用率偏低：' + lowUsage.map(function (p) { return p.postNameTC; }).join('、'));
  }

  const lines = [
    metrics.quarterId + ' v' + metrics.versionNo + '（共 ' + metrics.weekCount + ' 個主日）',
    '',
    '主席兼報告：' + formatMetricPercent_(metrics.chairEq ? metrics.chairEq.ratio : null)
      + '（歷史基準 ' + formatMetricPercent_(metrics.chairEqBaseline) + '）　'
      + metrics.chairEqJudgement.judgement,
    '報告連續兩週：' + formatMetricPercent_(metrics.announce ? metrics.announce.ratio : null)
      + '（歷史基準 ' + formatMetricPercent_(metrics.announceBaseline) + '）　'
      + metrics.announceJudgement.judgement,
    '總用人數：' + metrics.distribution.peopleCount + ' 人（歷史 ' + HISTORICAL_BASELINE.PEOPLE_COUNT + '）　'
      + metrics.peopleCountJudgement.judgement,
    '平均次數：' + metrics.distribution.average.toFixed(2) + '（歷史 ' + HISTORICAL_BASELINE.AVG_PER_PERSON + '）　'
      + metrics.averageJudgement.judgement,
    '最高次數：' + metrics.distribution.maxCount + '（歷史 ' + HISTORICAL_BASELINE.MAX_PER_PERSON + '）　'
      + metrics.maxJudgement.judgement,
    '',
    '準硬規則（同崗位連續兩週）違反：' + metrics.consecutive.count + ' 項',
    '崗位人手動用率偏低：' + lowUsage.length + ' 個崗位',
    ''
  ];

  if (baseMetrics) {
    lines.push('跟 v0 比較：準硬規則違反 ' + baseMetrics.consecutive.count + ' → ' + metrics.consecutive.count + ' 項');
    lines.push('');
  }
  if (flagged.length > 0) {
    lines.push('需要留意：');
    flagged.forEach(function (f) { lines.push('　• ' + f); });
    lines.push('');
  } else {
    lines.push('全部指標都在門檻範圍內。');
    lines.push('');
  }

  lines.push('完整明細（含逐項差距、準硬規則違反明細、各崗位動用率）已寫入 '
    + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「軟規則實測量度」，共 ' + written + ' 行。');
  lines.push('');
  lines.push('本工具完全唯讀：沒有改動任何職事表、沒有產生版本、沒有寄出任何電郵。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
