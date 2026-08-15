/**
 * 讀取排表所需的全部資料，整理成純函式可直接使用的 context 物件。
 * 所有日期在此階段一律正規化為 yyyy-MM-dd 字串，讓核心運算不需再碰時區。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 供 buildRoster_() 使用的 context
 */
function buildGeneratorContext_(quarterId) {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;

  const quarter = findQuarter_(quarterId);
  if (!quarter) {
    throw new Error('找不到季度: ' + quarterId + '（請檢查 Quarters 工作表）');
  }

  const serviceDates = readServiceDatesNormalized(quarterId, timezone);
  const posts = readPostsNormalized();

  const peopleById = {};
  readPeople().forEach(function (row) {
    const personId = row[COLUMNS.NAME_MAPPING.PERSON_ID];
    const rawMax = row[COLUMNS.NAME_MAPPING.MAX_PER_QUARTER];
    peopleById[personId] = {
      personId: personId,
      nameTC: row[COLUMNS.NAME_MAPPING.NAME_TC],
      maxPerQuarter: (rawMax === '' || rawMax === null || rawMax === undefined) ? null : Number(rawMax)
    };
  });

  // Status 非 ACTIVE 的請假紀錄視為已撤回，不納入判斷。
  const unavailable = readUnavailableNormalized(timezone);

  // Active=FALSE 的特別主日（例如範例列）不套用。
  const specialByDate = {};
  readSpecialSundays(quarterId)
    .filter(function (row) { return isTrueValue_(row[COLUMNS.SPECIAL_SUNDAYS.ACTIVE]); })
    .forEach(function (row) {
      const dateStr = toDateString(row[COLUMNS.SPECIAL_SUNDAYS.SERVICE_DATE], timezone);
      specialByDate[dateStr] = {
        specialId: row[COLUMNS.SPECIAL_SUNDAYS.SPECIAL_ID],
        skipPostIds: splitList_(row[COLUMNS.SPECIAL_SUNDAYS.SKIP_POST_IDS]),
        lockPostIds: splitList_(row[COLUMNS.SPECIAL_SUNDAYS.LOCK_POST_IDS])
      };
    });

  const carryOverWeeks = Number(config[CONFIG_KEYS.CARRY_OVER_WEEKS]) || 0;
  const quarterStart = toDateString(quarter[COLUMNS.QUARTERS.START_DATE], timezone);

  const rules = readRules();
  const eligibility = readEligibility();
  const maxPerQuarterDefault = Number(config[CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER]) || DEFAULTS.MAX_PER_QUARTER;

  return {
    quarterId: quarterId,
    serviceDates: serviceDates,
    posts: posts,
    eligibility: eligibility,
    peopleById: peopleById,
    unavailable: unavailable,
    specialByDate: specialByDate,
    rules: rules,
    priorWeeks: readPriorWeeks_(quarterStart, carryOverWeeks, timezone),
    existingAssignments: readQuarterAssignments_(quarterId, timezone),
    quotaByPerson: computePersonQuotas_(eligibility, peopleById, serviceDates, posts, rules, maxPerQuarterDefault),
    maxPerQuarterDefault: maxPerQuarterDefault,
    selectionStrategy: String(config[CONFIG_KEYS.SELECTION_STRATEGY] || SELECTION_STRATEGIES.LONGEST_UNSERVED).toUpperCase(),
    historicalWeight: readHistoricalWeight_(config),
    scoreWeights: readScoreWeights_(config),
    randomSeed: Number(config[CONFIG_KEYS.RANDOM_SEED]) || 0,
    // 第九輪批次階段 B：分數容差。負數一律當 0（不啟用），避免打錯符號時
    // 產生無法預期的比較行為。見 compareCandidates_()／pickEpsilonWinner_()。
    scoreTieEpsilon: Math.max(0,
      readNumericConfig_(config, CONFIG_KEYS.SCORE_TIE_EPSILON, DEFAULTS.SCORE_TIE_EPSILON))
  };
}

/**
 * 為每個人計算本季的「應有次數」配額，按其歷史服侍次數佔全體的比例分配。
 *
 * 取代「每人上限 = 全體平均」的做法：歷史分佈是右偏的，大部分人每季只服侍 1–3 次，
 * 另有一小群核心義工做到 7–8 次。用單一平均值當上限會把核心義工壓在平均線附近。
 *
 * 配額 = (該人全崗位 HistoricalCount 總和 / 全體總和) × 本季可派格數 × 配額倍率
 * 四捨五入後，最少 1 次，最多不超過該人的 MaxPerQuarter（個人值或 Config 預設）。
 *
 * @param {Object} eligibility readEligibility() 的結果
 * @param {Object.<string, Object>} peopleById 在職人員索引
 * @param {Object[]} serviceDates 本季的主日清單
 * @param {Object[]} posts 崗位清單
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {number} maxPerQuarterDefault Config 的每季次數上限預設值
 * @returns {Object.<string, number>} {PersonID: 本季配額}
 */
function computePersonQuotas_(eligibility, peopleById, serviceDates, posts, rules, maxPerQuarterDefault) {
  const totalSlots = countAssignableSlots_(serviceDates, posts);
  const multiplier = readQuotaMultiplier_(rules);

  const personTotals = {};
  let grandTotal = 0;
  Object.keys(eligibility.historicalCount).forEach(function (postId) {
    const byPerson = eligibility.historicalCount[postId];
    Object.keys(byPerson).forEach(function (personId) {
      if (!peopleById[personId]) return;
      personTotals[personId] = (personTotals[personId] || 0) + byPerson[personId];
      grandTotal += byPerson[personId];
    });
  });

  const quotas = {};
  Object.keys(personTotals).forEach(function (personId) {
    const person = peopleById[personId];
    const personMax = (person && person.maxPerQuarter !== null && !isNaN(person.maxPerQuarter))
      ? person.maxPerQuarter : maxPerQuarterDefault;
    const share = grandTotal === 0 ? 0 : personTotals[personId] / grandTotal;
    const raw = Math.round(share * totalSlots * multiplier);
    quotas[personId] = Math.max(1, Math.min(personMax, raw));
  });
  return quotas;
}

/**
 * 計算本季實際可自動派工的格數，作為配額分配的總量。
 * 排除 AutoGenerate=FALSE 的崗位與主日，以及不在當週的 FIRST_SUNDAY 崗位。
 * @param {Object[]} serviceDates 本季的主日清單
 * @param {Object[]} posts 崗位清單
 * @returns {number} 可派工的格數
 */
function countAssignableSlots_(serviceDates, posts) {
  let total = 0;
  serviceDates.forEach(function (date) {
    if (!date.autoGenerate) return;
    posts.forEach(function (post) {
      if (!post.autoGenerate) return;
      if (post.frequency === POST_FREQUENCY.AS_NEEDED) return;
      if (post.frequency === POST_FREQUENCY.FIRST_SUNDAY && !date.isFirstSundayOfMonth) return;
      total += post.slotCount;
    });
  });
  return total;
}

/**
 * 讀取 SOFT_PERSONAL_QUOTA 的配額倍率（TargetValue）。
 * 規則不存在或未啟用時回傳 1.0，配額計算本身不受影響
 * （是否採用配額扣分由 isRuleEnabled_ 另行判斷）。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @returns {number} 配額倍率
 */
function readQuotaMultiplier_(rules) {
  const rule = rules[RULE_IDS.PERSONAL_QUOTA];
  if (!rule) return 1;
  const value = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  return isNaN(value) || value <= 0 ? 1 : value;
}

/**
 * 讀取三個計分量級。三個 Key 都是選填：缺少、留空或數值無效時採用 SCORE_DEFAULTS。
 * 讓量級可在 Config 調校，不需要改動程式碼。
 * @param {Object.<string, *>} config readConfig() 的結果
 * @returns {{chairDualBonus: number, preferenceBonus: number, selectionWeight: number}} 計分量級
 */
function readScoreWeights_(config) {
  return {
    chairDualBonus: readNumericConfig_(config, CONFIG_KEYS.SCORE_CHAIR_DUAL_BONUS, SCORE_DEFAULTS.CHAIR_DUAL_BONUS),
    preferenceBonus: readNumericConfig_(config, CONFIG_KEYS.SCORE_PREFERENCE_BONUS, SCORE_DEFAULTS.PREFERENCE_BONUS),
    selectionWeight: readNumericConfig_(config, CONFIG_KEYS.SCORE_SELECTION_WEIGHT, SCORE_DEFAULTS.SELECTION_WEIGHT)
  };
}

/**
 * 讀取一個選填的數值型 Config，缺少或無效時回傳預設值。
 * @param {Object.<string, *>} config readConfig() 的結果
 * @param {string} key Config 的 Key
 * @param {number} fallback 預設值
 * @returns {number} 讀到的數值或預設值
 */
function readNumericConfig_(config, key, fallback) {
  const raw = config[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * 讀取 Config 的 SELECTION_WEIGHT_HISTORICAL（歷史服侍次數的加權比重）。
 * 此 Key 為選填：缺少、留空或數值無效時一律回傳 0，
 * 即完全按「最久沒服侍者優先」排序，行為與未設定此權重時相同。
 * @param {Object.<string, *>} config readConfig() 的結果
 * @returns {number} 介於 0 與 1 之間的權重
 */
function readHistoricalWeight_(config) {
  const raw = config[CONFIG_KEYS.SELECTION_WEIGHT_HISTORICAL];
  if (raw === undefined || raw === null || raw === '') return 0;
  const parsed = Number(raw);
  if (isNaN(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

/**
 * 在 Quarters 工作表中尋找指定季度。
 * @param {string} quarterId 季度 ID
 * @returns {?Object} 該季度的資料列；找不到時回傳 null
 */
function findQuarter_(quarterId) {
  const rows = readSheet(SHEETS.QUARTERS);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COLUMNS.QUARTERS.QUARTER_ID] === quarterId) return rows[i];
  }
  return null;
}

/**
 * 讀取季度開始日之前最後 N 個主日的派工紀錄，用於跨季界的「連續兩週」判斷。
 * 同一個主日若有多個版本，只取版本號最大的那一版。
 * @param {string} quarterStartDate 季度開始日，格式 yyyy-MM-dd
 * @param {number} carryOverWeeks 要往前看的主日數
 * @param {string} timezone 時區
 * @returns {Array<Object.<string, string[]>>} 由舊到新排列，每個元素為 {postId: [personId...]}
 */
function readPriorWeeks_(quarterStartDate, carryOverWeeks, timezone) {
  if (carryOverWeeks <= 0) return [];

  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    const dateStr = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    return dateStr && dateStr < quarterStartDate;
  });
  if (rows.length === 0) return [];

  // 每個主日只保留最大版本號的紀錄
  const maxVersionByDate = {};
  rows.forEach(function (row) {
    const dateStr = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    const versionNo = Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) || 0;
    if (maxVersionByDate[dateStr] === undefined || versionNo > maxVersionByDate[dateStr]) {
      maxVersionByDate[dateStr] = versionNo;
    }
  });

  const byDate = {};
  rows.forEach(function (row) {
    const dateStr = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    if ((Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) || 0) !== maxVersionByDate[dateStr]) return;
    const personId = row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID];
    if (!personId) return;
    const postId = row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID];
    if (!byDate[dateStr]) byDate[dateStr] = {};
    if (!byDate[dateStr][postId]) byDate[dateStr][postId] = [];
    byDate[dateStr][postId].push(personId);
  });

  const sortedDates = Object.keys(byDate).sort();
  return sortedDates.slice(-carryOverWeeks).map(function (d) { return byDate[d]; });
}

/**
 * 讀取指定季度已存在的派工紀錄，供 LockPostIDs 保留現有值使用。
 * 同一格若有多個版本，只取版本號最大的那一版。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, Object>} 以 "serviceDate|postId|slotIndex" 為鍵的紀錄對照
 */
function readQuarterAssignments_(quarterId, timezone) {
  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] === quarterId;
  });
  const result = {};
  rows.forEach(function (row) {
    const dateStr = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    const key = dateStr + '|' + row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID] + '|' + row[COLUMNS.ROSTER_ASSIGNMENTS.SLOT_INDEX];
    const versionNo = Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) || 0;
    if (!result[key] || versionNo >= result[key].versionNo) {
      result[key] = {
        versionNo: versionNo,
        personId: row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID],
        personName: row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT]
      };
    }
  });
  return result;
}

/**
 * 排表核心：純函式，只依 context 內的資料運算，不讀寫任何工作表。
 * 逐週、逐崗位（依 DisplayOrder）、逐 slot 派人。
 * @param {Object} context buildGeneratorContext_() 產生的資料集
 * @returns {{assignments: Object[], warnings: Object[]}} 派工結果與警告清單
 */
function buildRoster_(context) {
  const rules = context.rules;
  const random = makeSeededRandom_(context.randomSeed);
  const assignments = [];
  const warnings = [];

  /** @type {Object.<string, number>} 每人本季已派次數 */
  const quarterCount = {};
  /** @type {Object.<string, string>} 每人最後一次服侍的日期（yyyy-MM-dd） */
  const lastServed = {};

  // 用季前 CARRY_OVER_WEEKS 週的紀錄，作為第一週的「上一週」基準
  let previousWeek = context.priorWeeks.length > 0
    ? context.priorWeeks[context.priorWeeks.length - 1]
    : {};

  // 各條比例型 SOFT 規則的達成率追蹤
  // dualQualified / dualAssigned 供 SOFT_CHAIR_PREFER_DUAL 使用
  const ratioState = {
    chairEqAnnounce: 0,
    announceConsecutive: 0,
    weeksCounted: 0,
    dualQualified: 0,
    dualAssigned: 0
  };

  for (let w = 0; w < context.serviceDates.length; w++) {
    const serviceDate = context.serviceDates[w];
    const special = context.specialByDate[serviceDate.serviceDate] || { skipPostIds: [], lockPostIds: [] };
    /** @type {Object.<string, string[]>} 本週已派人：{postId: [personId...]} */
    const weekByPost = {};
    /** @type {Object.<string, string[]>} 本週已派人：{personId: [postId...]} */
    const weekByPerson = {};

    ratioState.weeksCounted++;

    for (let p = 0; p < context.posts.length; p++) {
      const post = context.posts[p];
      const skipReason = getSkipReason_(post, serviceDate, special, rules);

      for (let slot = 1; slot <= post.slotCount; slot++) {
        const baseRow = {
          serviceDateId: serviceDate.serviceDateId,
          serviceDate: serviceDate.serviceDate,
          postId: post.postId,
          slotIndex: slot
        };

        if (skipReason) {
          assignments.push(makeAssignment_(baseRow, '', '', ASSIGN_SOURCE.SKIPPED, [skipReason.ruleId]));
          continue;
        }

        if (special.lockPostIds.indexOf(post.postId) !== -1) {
          const locked = context.existingAssignments[
            serviceDate.serviceDate + '|' + post.postId + '|' + slot
          ];
          const lockedPersonId = locked ? locked.personId : '';
          const lockedName = lockedPersonId
            ? (context.peopleById[lockedPersonId] ? context.peopleById[lockedPersonId].nameTC : locked.personName)
            : '';
          assignments.push(makeAssignment_(baseRow, lockedPersonId, lockedName, ASSIGN_SOURCE.LOCKED, []));
          if (!lockedPersonId) {
            warnings.push(makeWarning_(baseRow, '', '此崗位在該特別主日被 LockPostIDs 鎖定，但沒有現有人選可保留，需人手填寫'));
          } else {
            registerAssigned_(lockedPersonId, post, serviceDate, weekByPost, weekByPerson, quarterCount, lastServed);
          }
          continue;
        }

        const outcome = pickPerson_({
          context: context,
          post: post,
          slot: slot,
          serviceDate: serviceDate,
          weekByPost: weekByPost,
          weekByPerson: weekByPerson,
          previousWeek: previousWeek,
          quarterCount: quarterCount,
          lastServed: lastServed,
          ratioState: ratioState,
          random: random
        });

        if (!outcome.personId) {
          assignments.push(makeAssignment_(baseRow, '', '', ASSIGN_SOURCE.SKIPPED, [RULE_IDS.ELIGIBILITY]));
          warnings.push(makeWarning_(baseRow, RULE_IDS.ELIGIBILITY, outcome.reason));
          continue;
        }

        const person = context.peopleById[outcome.personId];
        const violatedIds = outcome.violations.map(function (v) { return v.ruleId; });
        assignments.push(makeAssignment_(
          baseRow,
          outcome.personId,
          person ? person.nameTC : outcome.personId,
          outcome.forced ? ASSIGN_SOURCE.FORCED : ASSIGN_SOURCE.AUTO,
          violatedIds
        ));

        // OnViolation 為 IGNORE 的規則不產生警告，只影響排序
        outcome.violations.forEach(function (v) {
          if (v.onViolation === ON_VIOLATION.IGNORE) return;
          warnings.push(makeWarning_(baseRow, v.ruleId, v.reason));
        });

        registerAssigned_(outcome.personId, post, serviceDate, weekByPost, weekByPerson, quarterCount, lastServed);
        updateRatioState_(post, outcome.personId, weekByPost, previousWeek, rules, ratioState, context.eligibility);
      }
    }

    previousWeek = weekByPost;
  }

  return { assignments: assignments, warnings: warnings };
}

/**
 * 判斷某崗位在某個主日是否整格留空，並回傳對應的規則 ID。
 * 只有在 RuleSettings 中該規則 Enabled=TRUE 時才生效。
 * @param {Object} post 崗位資料
 * @param {Object} serviceDate 主日資料
 * @param {Object} special 該主日的特別安排（skipPostIds / lockPostIds）
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @returns {?{ruleId: string, reason: string}} 需留空時回傳原因；否則回傳 null
 */
function getSkipReason_(post, serviceDate, special, rules) {
  if (!post.autoGenerate && isRuleEnabled_(rules, RULE_IDS.NO_AUTO_GENERATE)) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '此崗位 AutoGenerate=FALSE，系統不自動派人' };
  }
  if (post.frequency === POST_FREQUENCY.FIRST_SUNDAY
      && !serviceDate.isFirstSundayOfMonth
      && isRuleEnabled_(rules, RULE_IDS.COMMUNION_FIRST_SUNDAY)) {
    return { ruleId: RULE_IDS.COMMUNION_FIRST_SUNDAY, reason: '此崗位只在每月第一個主日安排' };
  }
  if (post.frequency === POST_FREQUENCY.AS_NEEDED) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '此崗位 Frequency=AS_NEEDED，按需要人手安排' };
  }
  if (special.skipPostIds.indexOf(post.postId) !== -1) {
    // 階段 A：獨立的 ruleId（不共用 NO_AUTO_GENERATE），讓顯示層可以把「這個崗位
    // 平常會自動生成，只是這一週因為特別主日而跳過」跟「這個崗位本來就永遠不
    // 自動生成」分開標示，見 SPECIAL_SKIP_RULE_IDS。
    return { ruleId: RULE_IDS.SPECIAL_SUNDAY_SKIP, reason: '此崗位在該特別主日的 SkipPostIDs 名單內' };
  }
  if (!serviceDate.autoGenerate) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '該主日 AutoGenerate=FALSE' };
  }
  return null;
}

/**
 * 為單一 slot 挑選人選：先以 HARD 規則篩選，再依違規扣分與選人策略排序。
 *
 * 階段 A（Opus 深度輪）修正：若所有候選人都違反 HARD 規則，**留空並發出
 * 警告**，不再「改選違規最輕者並標記為 forced」。
 *
 * 原本的 forced 機制會令系統在候選人池非空、但每個人都違反至少一條 HARD
 * 規則時（最典型：整個崗位池當週全部表明不能服侍），自動指派其中一人，
 * 即時造成 HARD 規則違反——雖然步驟 3／5 之後會透過「確認放行」關卡要求
 * 幹事人手確認才能前進 Stage，但違反本身在生成當下已經發生，不是「留空
 * 待人手處理」。這跟系統「絕不自動違反硬規則，寧可留空」的設計原則不一致，
 * 已在 `docs/系統範圍稽核.md` 記錄為本輪找到的演算法問題並修正。
 *
 * 修正後：`candidates.length === 0`（完全沒有合資格人選）與「有候選人池，
 * 但全部都違反 HARD 規則」現在是同一種結果——留空、`ASSIGN_SOURCE.SKIPPED`、
 * 產生警告，交給 `summariseBlankAssignments_()` 歸入「系統應該排但排不出」
 * 的「真正缺口」統計，讓幹事在步驟 1 的完成畫面就直接看到，需要人手指派。
 *
 * @param {Object} state 目前的排表狀態（context / post / slot / 各項累計資料）
 * @returns {{personId: string, violations: Object[], forced: boolean, reason: string}} 挑選結果
 */
function pickPerson_(state) {
  const pool = state.context.eligibility.byPost[state.post.postId] || [];
  const candidates = pool.filter(function (personId) {
    return !!state.context.peopleById[personId];
  });

  if (candidates.length === 0) {
    return {
      personId: '',
      violations: [],
      forced: false,
      reason: '此崗位在 Eligibility 中沒有任何在職的合資格人選'
    };
  }

  // 依 PersonID 排序後才抽亂數，確保同一 RANDOM_SEED 每次產生相同結果
  const sorted = candidates.slice().sort();
  const historicalByPost = state.context.eligibility.historicalCount[state.post.postId] || {};
  const scored = sorted.map(function (personId) {
    const violations = evaluateViolations_(personId, state);
    const lastServed = state.lastServed[personId] || '';
    return {
      personId: personId,
      violations: violations,
      penalty: sumPenalty_(violations),
      bonus: computeBonus_(personId, state),
      hasHard: violations.some(function (v) { return v.level === RULE_LEVELS.HARD; }),
      lastServed: lastServed,
      staleness: lastServed ? daysBetween_(lastServed, state.serviceDate.serviceDate) : null,
      historicalCount: historicalByPost[personId] || 0,
      tieBreak: state.random()
    };
  });
  applySelectionScores_(scored, state.context.historicalWeight);

  // 選人分數要真正參與計分，而不是只做同分時的決勝。
  // 否則 SOFT_QUARTER_DISTRIBUTION 一旦扣分，任何選人偏好都會被壓過，
  // 令服侍次數卡在 3-5 次，永遠達不到歷史上核心義工 8 次的水平。
  scored.forEach(function (c) {
    c.score = c.penalty - c.bonus - (c.selectionScore * state.context.scoreWeights.selectionWeight);
  });

  const clean = scored.filter(function (c) { return !c.hasHard; });
  if (clean.length === 0) {
    const violatedRuleIds = {};
    scored.forEach(function (c) {
      c.violations.forEach(function (v) {
        if (v.level === RULE_LEVELS.HARD) violatedRuleIds[v.ruleId] = true;
      });
    });
    return {
      personId: '',
      violations: [],
      forced: false,
      reason: '此崗位合資格人選在本週全部違反 HARD 規則（'
        + Object.keys(violatedRuleIds).sort().join('、') + '），系統選擇留空，'
        + '不會為了填滿格子而違反硬規則'
    };
  }
  const finalists = clean;

  // 第九輪批次階段 B：epsilon 容差（Config 的 SCORE_TIE_EPSILON，預設 0＝不啟用）。
  // 排序保留給下面的 trace 顯示用；真正的優勝者一律由 pickEpsilonWinner_() 決定，
  // 原因見該函式的說明（sort 遇上不可傳遞的比較函式會有「近似鏈」問題）。
  const epsilon = state.context.scoreTieEpsilon || 0;
  finalists.sort(function (a, b) { return compareCandidates_(a, b, state.context.selectionStrategy, epsilon); });
  const winner = pickEpsilonWinner_(finalists, state.context.selectionStrategy, epsilon);

  if (state.context.trace) {
    state.context.trace.push({
      serviceDate: state.serviceDate.serviceDate,
      postId: state.post.postId,
      slotIndex: state.slot,
      winner: winner.personId,
      ratioState: {
        weeksCounted: state.ratioState.weeksCounted,
        chairEqAnnounce: state.ratioState.chairEqAnnounce,
        announceConsecutive: state.ratioState.announceConsecutive,
        dualQualified: state.ratioState.dualQualified,
        dualAssigned: state.ratioState.dualAssigned
      },
      candidates: finalists.slice(0, TRACE_CANDIDATE_LIMIT).map(function (c) {
        return {
          personId: c.personId,
          penalty: c.penalty,
          bonus: c.bonus,
          selectionScore: c.selectionScore,
          historicalCount: c.historicalCount,
          staleness: c.staleness,
          score: c.score,
          violations: c.violations.map(function (v) { return v.ruleId; })
        };
      })
    });
  }

  return {
    personId: winner.personId,
    violations: winner.violations,
    // clean 只保留 !hasHard 的候選人，走到這裡代表 winner 一定沒有 HARD 違反
    // （最多只有 SEMI_HARD／SOFT），forced 永遠是 false——上面 clean.length===0
    // 的分支已經處理了「全部候選人都違反 HARD 規則」的情況，不會再走到這裡。
    forced: false,
    reason: ''
  };
}

/**
 * 比較兩位候選人的優先次序：規則扣分少者優先，其次選人分數高者優先，最後用 seeded 亂數。
 *
 * 第九輪批次階段 B 新增 `epsilon` 參數（分數容差），用來根治「RANDOM_SEED 完全
 * 沒有作用」這個問題：`score = penalty - bonus - selectionScore × selectionWeight`，
 * 其中 `selectionScore` 是連續浮點數，兩個人的 score 實務上幾乎不可能剛好相等，
 * 所以 `a.score !== b.score` 幾乎永遠成立，`tieBreak`（唯一用到 seed 的地方）
 * 永遠輪不到——實測 30 個不同 seed 產生逐格完全相同的職事表，`generateBest()`
 * 跑 20 次等於把同一份表算 20 次。
 *
 * **epsilon = 0 時，本函式的行為跟加入這個參數之前逐字相同**：
 * `Math.abs(a.score - b.score) > 0` 跟原本的 `a.score !== b.score` 是同一個條件
 * （兩數不等 ⟺ 差的絕對值大於 0）。這是刻意的——預設值就是 0，不啟用時
 * 排表結果一格都不會變，要真的改變行為必須由幹事自己在 Config 設定非零值。
 *
 * @param {Object} a 候選人 A 的評分結果
 * @param {Object} b 候選人 B 的評分結果
 * @param {string} strategy 選人策略；非 LONGEST_UNSERVED 時只用亂數決定
 * @param {number=} epsilon 分數容差，差距在這個範圍內視為同分；預設 0（不啟用）
 * @returns {number} 排序用的比較值
 */
function compareCandidates_(a, b, strategy, epsilon) {
  const eps = (epsilon > 0) ? epsilon : 0;
  if (Math.abs(a.score - b.score) > eps) return a.score - b.score;
  // 只在**沒有**啟用容差時才保留 selectionScore 這一層。
  //
  // 原因（離線測試實際抓到的問題）：只對 score 加容差是不夠的——`selectionScore`
  // 本身也是連續浮點數，兩個人幾乎不可能相等，所以同分群組內的決勝權只是從
  // 「score」轉移到「selectionScore」，`tieBreak`（唯一用到 seed 的地方）
  // 一樣永遠輪不到，換 seed 照樣產生逐格相同的表，等於白做。
  // 第一版改動就是這樣寫，測試量度到「容差確實改變了排表結果，但 30 個 seed
  // 仍然只產生 1 份表」，才發現這一層。
  //
  // 而且這一層在容差生效時本來就是重複計算：`score` 的定義是
  // `penalty - bonus - selectionScore × selectionWeight`，**已經包含了
  // selectionScore**。既然兩個人的 score 差距在容差之內、視為「一樣好」，
  // 就不應該再拿已經算進去的同一個訊號決勝一次，應該直接交給 seed 亂數。
  //
  // eps === 0 時這一層原封不動保留，所以預設行為跟加入容差之前逐字相同。
  if (eps === 0 && strategy === SELECTION_STRATEGIES.LONGEST_UNSERVED
    && a.selectionScore !== b.selectionScore) {
    return b.selectionScore - a.selectionScore;
  }
  return a.tieBreak - b.tieBreak;
}

/**
 * 從候選人中挑出優勝者，容差版本。
 *
 * 為什麼不直接用 `finalists.sort(compareCandidates_)[0]`：加了 epsilon 之後，
 * `compareCandidates_()` 不再是一個**可傳遞**（transitive）的比較函式——
 * a≈b、b≈c 不代表 a≈c（a 與 c 可能相差 2×epsilon）。把不可傳遞的比較函式交給
 * `Array.prototype.sort()`，結果雖然仍然可重現（同一組輸入必定得出同一個輸出），
 * 但可能經由「近似鏈」讓一個分數遠差於最佳者的候選人排到第一——epsilon 越大
 * 越容易發生。那等於在幹事完全不知情的情況下降低排表品質。
 *
 * 這裡改為明確定義：**只有「跟最佳分數相差不超過 epsilon」的候選人才算同分**，
 * 同分群組之內再用 selectionScore 與 tieBreak 決勝。這樣：
 * - 優勝者永遠不會比最佳分數差超過 epsilon（差距有明確上界，不會被鏈式放大）；
 * - 同分群組內任何兩人的分數差最多是 epsilon，所以群組內用
 *   `compareCandidates_()` 排序時，一律走到 selectionScore／tieBreak 那兩層，
 *   等於一個真正可傳遞的排序，不會有上面那個問題；
 * - **epsilon = 0 時結果跟舊寫法逐字相同**：群組＝分數剛好等於最低分的那些人，
 *   再按 selectionScore 高者優先、tieBreak 細者優先，正是原本
 *   `sort(compareCandidates_)[0]` 會挑出來的同一個人。
 *
 * @param {Object[]} finalists 已濾走 HARD 違反的候選人（至少一個）
 * @param {string} strategy 選人策略
 * @param {number} epsilon 分數容差
 * @returns {Object} 優勝的候選人
 */
function pickEpsilonWinner_(finalists, strategy, epsilon) {
  const eps = (epsilon > 0) ? epsilon : 0;

  let bestScore = finalists[0].score;
  for (let i = 1; i < finalists.length; i++) {
    if (finalists[i].score < bestScore) bestScore = finalists[i].score;
  }

  const tied = finalists.filter(function (c) { return c.score <= bestScore + eps; });
  tied.sort(function (a, b) { return compareCandidates_(a, b, strategy, eps); });
  return tied[0];
}

/**
 * 計算每位候選人的選人分數，分數越高越優先。
 * 由兩個正規化為 0–1 的分項按 Config 的 SELECTION_WEIGHT_HISTORICAL 加權合併：
 * 歷史服侍次數（Eligibility.HistoricalCount）與距上次服侍的天數。
 * 權重 0 等同純粹「最久沒服侍者優先」，權重 1 則強烈偏好歷史次數高的核心義工。
 * @param {Object[]} scored 候選人評分結果陣列，會就地補上 selectionScore
 * @param {number} historicalWeight 歷史次數的加權比重（0 至 1）
 * @returns {void}
 */
function applySelectionScores_(scored, historicalWeight) {
  if (scored.length === 0) return;

  // 從未服侍者視為比所有已服侍者再久一週，確保排在最前
  let maxStaleness = 0;
  scored.forEach(function (c) {
    if (c.staleness !== null && c.staleness > maxStaleness) maxStaleness = c.staleness;
  });
  const stalenessValues = scored.map(function (c) {
    return c.staleness === null ? maxStaleness + 7 : c.staleness;
  });

  const recencyNorm = normalizeValues_(stalenessValues);
  const historicalNorm = normalizeValues_(scored.map(function (c) { return c.historicalCount; }));

  scored.forEach(function (c, i) {
    c.selectionScore = historicalWeight * historicalNorm[i] + (1 - historicalWeight) * recencyNorm[i];
  });
}

/**
 * 把一組數值線性正規化到 0 至 1 之間。所有數值相同時一律回傳 0（由後續條件決勝）。
 * @param {number[]} values 原始數值陣列
 * @returns {number[]} 正規化後的陣列，長度與輸入相同
 */
function normalizeValues_(values) {
  let min = Infinity;
  let max = -Infinity;
  values.forEach(function (v) {
    if (v < min) min = v;
    if (v > max) max = v;
  });
  const span = max - min;
  return values.map(function (v) { return span === 0 ? 0 : (v - min) / span; });
}

/**
 * 計算候選人的偏好獎勵分：目前只有 SOFT_CHAIR_EQ_ANNOUNCE 會給獎勵。
 * 當「主席兼報告」的比例仍低於 RuleSettings 的 TargetValue 時，
 * 本週主席在派報告時會取得獎勵分，使其優先於一般候選人。
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {number} 獎勵分（正數，計分時會被扣除）；不適用時回傳 0
 */
function computeBonus_(personId, state) {
  return computeChairEqAnnounceBonus_(personId, state)
    + computeAnnounceReliefBonus_(personId, state)
    + computeChairPreferDualBonus_(personId, state);
}

/**
 * SOFT_CHAIR_PREFER_DUAL 的獎勵分：派主崗位時，偏好同時具備配對崗位資格的候選人。
 *
 * 背景：若主崗位平均分給全部合資格者，其中不少人並無配對崗位的資格，
 * 兼任比例的理論上限就會被壓低，令 SOFT_CHAIR_EQ_ANNOUNCE 的目標無法達成。
 * 累計比例達標後即停止加分，讓只具單一資格的人仍有出場機會。
 *
 * 崗位完全由 RuleSettings 決定：主崗位取自本規則的 ScopePostIDs，
 * 配對崗位取自 SOFT_CHAIR_EQ_ANNOUNCE 的 ScopePostIDs 中的另一個崗位。
 * RuleSettings 沒有這條規則時一律回傳 0，行為與未加入此規則時相同。
 *
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {number} 獎勵分；不適用時回傳 0
 */
function computeChairPreferDualBonus_(personId, state) {
  const rules = state.context.rules;
  if (!isRuleEnabled_(rules, RULE_IDS.CHAIR_PREFER_DUAL)) return 0;

  const rule = rules[RULE_IDS.CHAIR_PREFER_DUAL];
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.indexOf(state.post.postId) === -1) return 0;

  const partnerPostId = findPartnerPostId_(rules, state.post.postId);
  if (!partnerPostId) return 0;

  const partnerPool = state.context.eligibility.byPost[partnerPostId] || [];
  if (partnerPool.indexOf(personId) === -1) return 0;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  if (isNaN(target)) return 0;

  // 分母包含正在決定的這一週
  const denominator = state.ratioState.dualAssigned + 1;
  return isBehindTargetPace_(state.ratioState.dualQualified, denominator, target)
    ? state.context.scoreWeights.chairDualBonus : 0;
}

/**
 * 在 SOFT_CHAIR_EQ_ANNOUNCE 的 ScopePostIDs 中，找出與指定崗位配對的另一個崗位。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {string} postId 目前的崗位 ID
 * @returns {string} 配對崗位 ID；找不到時回傳空字串
 */
function findPartnerPostId_(rules, postId) {
  const pairRule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  if (!pairRule) return '';
  const pair = splitList_(pairRule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (pair.indexOf(postId) === -1) return '';
  const partner = pair.filter(function (id) { return id !== postId; });
  return partner.length > 0 ? partner[0] : '';
}

/**
 * SOFT_CHAIR_EQ_ANNOUNCE 的獎勵分：累計比例落後於目標進度時，
 * 本週主席在派報告時取得獎勵，使其優先於一般候選人。
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {number} 獎勵分；不適用時回傳 0
 */
function computeChairEqAnnounceBonus_(personId, state) {
  const rules = state.context.rules;
  if (!isRuleEnabled_(rules, RULE_IDS.CHAIR_EQ_ANNOUNCE)) return 0;

  const rule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length < 2 || state.post.postId !== scope[1]) return 0;

  const chairThisWeek = state.weekByPost[scope[0]] || [];
  if (chairThisWeek.indexOf(personId) === -1) return 0;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  if (isNaN(target)) return 0;

  return isBehindTargetPace_(state.ratioState.chairEqAnnounce, state.ratioState.weeksCounted, target)
    ? state.context.scoreWeights.preferenceBonus : 0;
}

/**
 * SOFT_ANNOUNCE_RELIEF 的獎勵分：報告連續兩週同一人的比例落後於目標進度時，
 * 上週的報告人在本週取得獎勵。
 *
 * 沒有這個獎勵的話，LONGEST_UNSERVED 會一直把「最久沒服侍的人」推上來，
 * 上週剛服侍過的人永遠排最後，令連續比例固定停在 0%。
 *
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {number} 獎勵分；不適用時回傳 0
 */
function computeAnnounceReliefBonus_(personId, state) {
  const rules = state.context.rules;
  if (!isRuleEnabled_(rules, RULE_IDS.ANNOUNCE_RELIEF)) return 0;

  const rule = rules[RULE_IDS.ANNOUNCE_RELIEF];
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.indexOf(state.post.postId) === -1) return 0;

  const lastWeek = state.previousWeek[state.post.postId] || [];
  if (lastWeek.indexOf(personId) === -1) return 0;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  if (isNaN(target)) return 0;

  return isBehindTargetPace_(state.ratioState.announceConsecutive, state.ratioState.weeksCounted, target)
    ? state.context.scoreWeights.preferenceBonus : 0;
}

/**
 * 判斷某個累計數量是否落後於目標比例的進度。
 *
 * 用「累計數 < 目標比例 × 已處理週數」而不是「加一格後的比例 <= 目標」，
 * 後者在第一週必定成立不了（1/1 永遠大於任何小於 1 的目標），會白白浪費一週，
 * 而且會令整季的達成率長期低於目標。
 *
 * @param {number} count 目前累計數量
 * @param {number} weeksCounted 已處理的週數
 * @param {number} target 目標比例（0 至 1）
 * @returns {boolean} 是否落後於進度（落後就應該給獎勵）
 */
function isBehindTargetPace_(count, weeksCounted, target) {
  return count < target * weeksCounted;
}

/**
 * 檢查某位候選人違反了哪些規則。每條規則的 Level / OnViolation / Priority / 參數
 * 一律從 RuleSettings 讀取；規則 Enabled=FALSE 時完全跳過。
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {Object[]} 違規清單，每項為 {ruleId, level, priority, onViolation, reason}
 */
function evaluateViolations_(personId, state) {
  const rules = state.context.rules;
  const post = state.post;
  const violations = [];

  if (isRuleEnabled_(rules, RULE_IDS.UNAVAILABLE)
      && isPersonUnavailable_(personId, state.serviceDate.serviceDate, post.postId, state.context.unavailable)) {
    violations.push(makeViolation_(rules, RULE_IDS.UNAVAILABLE, '當事人已表明該日不能服侍'));
  }

  if (isRuleEnabled_(rules, RULE_IDS.DISTINCT_SLOT) && post.distinctWithinPost) {
    const already = state.weekByPost[post.postId] || [];
    if (already.indexOf(personId) !== -1) {
      violations.push(makeViolation_(rules, RULE_IDS.DISTINCT_SLOT, '同週同崗位的其他位已派此人'));
    }
  }

  if (isRuleEnabled_(rules, RULE_IDS.MUTEX_GROUP) && post.mutexGroup) {
    const postsThisWeek = state.weekByPerson[personId] || [];
    const clash = postsThisWeek.filter(function (otherPostId) {
      const other = findPost_(state.context.posts, otherPostId);
      return other && other.mutexGroup === post.mutexGroup;
    });
    if (clash.length > 0) {
      violations.push(makeViolation_(rules, RULE_IDS.MUTEX_GROUP,
        '本週已派同組崗位 (' + post.mutexGroup + '): ' + clash.join(',')));
    }
  }

  if (isRuleEnabled_(rules, RULE_IDS.MAX_PER_QUARTER)) {
    const person = state.context.peopleById[personId];
    const rule = rules[RULE_IDS.MAX_PER_QUARTER];
    const ruleTarget = rule ? Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : NaN;
    const limit = (person && person.maxPerQuarter !== null && !isNaN(person.maxPerQuarter))
      ? person.maxPerQuarter
      : (isNaN(ruleTarget) ? state.context.maxPerQuarterDefault : ruleTarget);
    const used = state.quarterCount[personId] || 0;
    if (used >= limit) {
      violations.push(makeViolation_(rules, RULE_IDS.MAX_PER_QUARTER,
        '本季已排 ' + used + ' 次，已達上限 ' + limit));
    }
  }

  if (isRuleEnabled_(rules, RULE_IDS.NO_CONSECUTIVE) && post.allowConsecutive !== ALLOW_CONSECUTIVE.ALLOW) {
    const lastWeekSamePost = state.previousWeek[post.postId] || [];
    if (lastWeekSamePost.indexOf(personId) !== -1) {
      violations.push(makeViolation_(rules, RULE_IDS.NO_CONSECUTIVE,
        '上一週同崗位已是此人（Posts.AllowConsecutive=' + post.allowConsecutive + '）'));
    }
  }

  // 啟用 SOFT_PERSONAL_QUOTA 時，改用每人各自的配額；
  // SOFT_QUARTER_DISTRIBUTION 便退為整體參考指標，不再逐人扣分。
  if (isRuleEnabled_(rules, RULE_IDS.PERSONAL_QUOTA)) {
    const quotaViolation = evaluatePersonalQuota_(personId, state);
    if (quotaViolation) violations.push(quotaViolation);
  } else if (isRuleEnabled_(rules, RULE_IDS.QUARTER_DISTRIBUTION)) {
    const rule = rules[RULE_IDS.QUARTER_DISTRIBUTION];
    const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
    const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
    const used = state.quarterCount[personId] || 0;
    if (!isNaN(target) && used >= target + tolerance) {
      violations.push(makeViolation_(rules, RULE_IDS.QUARTER_DISTRIBUTION,
        '本季已排 ' + used + ' 次，高於歷史平均 ' + target));
    }
  }

  const chairEq = evaluateChairEqAnnounce_(personId, state);
  if (chairEq) violations.push(chairEq);

  const relief = evaluateAnnounceRelief_(personId, state);
  if (relief) violations.push(relief);

  return violations;
}

/**
 * 評估 SOFT_PERSONAL_QUOTA：以該人自己的配額（按歷史比例分配）判斷是否已排太多。
 *
 * 未達配額時完全不扣分，讓核心義工能自然做到 7–8 次；
 * 超出配額後按超出幅度遞增扣分，避免一個人無限制地被連續選中。
 *
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {?Object} 違規物件；未超出配額時回傳 null
 */
function evaluatePersonalQuota_(personId, state) {
  const rules = state.context.rules;
  const rule = rules[RULE_IDS.PERSONAL_QUOTA];
  const quota = state.context.quotaByPerson[personId];
  if (!quota) return null;

  const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  const allowed = quota * (1 + tolerance);
  const used = state.quarterCount[personId] || 0;
  if (used < allowed) return null;

  // 超出越多，扣分倍率越高
  const overage = Math.floor(used - allowed) + 1;
  return makeViolation_(rules, RULE_IDS.PERSONAL_QUOTA,
    '本季已排 ' + used + ' 次，超出個人配額 ' + quota + '（容差後 ' + allowed.toFixed(1) + '）',
    overage);
}

/**
 * 評估 SOFT_CHAIR_EQ_ANNOUNCE：主席與報告由同一人擔任的比例要貼近 TargetValue。
 * ScopePostIDs 第一個為主席崗位、第二個為報告崗位，比例與容差皆由 RuleSettings 決定。
 * 比例未達標時，本週主席會被優先選為報告；已達標則反過來扣分。
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {?Object} 違規物件；不適用或不違規時回傳 null
 */
function evaluateChairEqAnnounce_(personId, state) {
  const rules = state.context.rules;
  if (!isRuleEnabled_(rules, RULE_IDS.CHAIR_EQ_ANNOUNCE)) return null;

  const rule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length < 2) return null;

  const chairPostId = scope[0];
  const announcePostId = scope[1];
  if (state.post.postId !== announcePostId) return null;

  const chairThisWeek = state.weekByPost[chairPostId] || [];
  if (chairThisWeek.indexOf(personId) === -1) return null;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  if (isNaN(target)) return null;

  // 只有「已超前進度且超出容差」才扣分；落後進度時交由 computeChairEqAnnounceBonus_ 給獎勵
  if (isBehindTargetPace_(state.ratioState.chairEqAnnounce, state.ratioState.weeksCounted, target + tolerance)) {
    return null;
  }
  const achieved = state.ratioState.chairEqAnnounce / Math.max(1, state.ratioState.weeksCounted);

  return makeViolation_(rules, RULE_IDS.CHAIR_EQ_ANNOUNCE,
    '主席兼報告的比例已達 ' + achieved.toFixed(2) + '，高於目標 ' + target);
}

/**
 * 評估 SOFT_ANNOUNCE_RELIEF：報告崗位容許連續兩週同一人，但比例不超過 TargetValue。
 * 這是排不出人時的洩壓閥；比例超標後才開始扣分。
 * @param {string} personId 候選人的 PersonID
 * @param {Object} state 目前的排表狀態
 * @returns {?Object} 違規物件；不適用或不違規時回傳 null
 */
function evaluateAnnounceRelief_(personId, state) {
  const rules = state.context.rules;
  if (!isRuleEnabled_(rules, RULE_IDS.ANNOUNCE_RELIEF)) return null;

  const rule = rules[RULE_IDS.ANNOUNCE_RELIEF];
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.indexOf(state.post.postId) === -1) return null;

  const lastWeek = state.previousWeek[state.post.postId] || [];
  if (lastWeek.indexOf(personId) === -1) return null;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  if (isNaN(target)) return null;

  // 同上：落後進度時不扣分，交由 computeAnnounceReliefBonus_ 給獎勵
  if (isBehindTargetPace_(state.ratioState.announceConsecutive, state.ratioState.weeksCounted, target + tolerance)) {
    return null;
  }
  const achieved = state.ratioState.announceConsecutive / Math.max(1, state.ratioState.weeksCounted);

  return makeViolation_(rules, RULE_IDS.ANNOUNCE_RELIEF,
    '報告連續兩週同一人的比例已達 ' + achieved.toFixed(2) + '，高於目標 ' + target);
}

/**
 * 在派人成功後更新各條比例型 SOFT 規則的達成率計數。
 * @param {Object} post 剛派完的崗位
 * @param {string} personId 獲派者的 PersonID
 * @param {Object.<string, string[]>} weekByPost 本週各崗位已派人
 * @param {Object.<string, string[]>} previousWeek 上一週各崗位的派人
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {Object} ratioState 比例累計狀態，會就地更新
 * @param {Object} eligibility readEligibility() 的結果，用於判斷是否具備配對崗位資格
 * @returns {void}
 */
function updateRatioState_(post, personId, weekByPost, previousWeek, rules, ratioState, eligibility) {
  const dualRule = rules[RULE_IDS.CHAIR_PREFER_DUAL];
  if (dualRule) {
    const scope = splitList_(dualRule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
    if (scope.indexOf(post.postId) !== -1) {
      ratioState.dualAssigned++;
      const partnerPostId = findPartnerPostId_(rules, post.postId);
      const partnerPool = partnerPostId ? (eligibility.byPost[partnerPostId] || []) : [];
      if (partnerPool.indexOf(personId) !== -1) ratioState.dualQualified++;
    }
  }

  const chairRule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  if (chairRule) {
    const scope = splitList_(chairRule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
    if (scope.length >= 2 && post.postId === scope[1]) {
      const chairThisWeek = weekByPost[scope[0]] || [];
      if (chairThisWeek.indexOf(personId) !== -1) ratioState.chairEqAnnounce++;
    }
  }

  const reliefRule = rules[RULE_IDS.ANNOUNCE_RELIEF];
  if (reliefRule) {
    const scope = splitList_(reliefRule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
    if (scope.indexOf(post.postId) !== -1) {
      const lastWeek = previousWeek[post.postId] || [];
      if (lastWeek.indexOf(personId) !== -1) ratioState.announceConsecutive++;
    }
  }
}

/**
 * 把一次成功派工登記到本週與全季的各項累計資料中。
 * @param {string} personId 獲派者的 PersonID
 * @param {Object} post 崗位資料
 * @param {Object} serviceDate 主日資料
 * @param {Object.<string, string[]>} weekByPost 本週各崗位已派人，會就地更新
 * @param {Object.<string, string[]>} weekByPerson 本週各人已派崗位，會就地更新
 * @param {Object.<string, number>} quarterCount 每人本季次數，會就地更新
 * @param {Object.<string, string>} lastServed 每人最後服侍日期，會就地更新
 * @returns {void}
 */
function registerAssigned_(personId, post, serviceDate, weekByPost, weekByPerson, quarterCount, lastServed) {
  if (!weekByPost[post.postId]) weekByPost[post.postId] = [];
  weekByPost[post.postId].push(personId);
  if (!weekByPerson[personId]) weekByPerson[personId] = [];
  weekByPerson[personId].push(post.postId);
  quarterCount[personId] = (quarterCount[personId] || 0) + 1;
  lastServed[personId] = serviceDate.serviceDate;
}

/**
 * 判斷某人在指定日期、指定崗位是否處於不可服侍狀態。
 * AppliesTo=ALL 代表所有崗位；否則只涵蓋 PostIDs 欄列出的崗位。
 * @param {string} personId 要檢查的 PersonID
 * @param {string} dateStr 主日日期，格式 yyyy-MM-dd
 * @param {string} postId 崗位 ID
 * @param {Object[]} unavailableRows 已正規化的 Unavailable 資料
 * @returns {boolean} 是否不可服侍
 */
function isPersonUnavailable_(personId, dateStr, postId, unavailableRows) {
  for (let i = 0; i < unavailableRows.length; i++) {
    const row = unavailableRows[i];
    if (row.personId !== personId) continue;
    if (row.dateFrom && dateStr < row.dateFrom) continue;
    if (row.dateTo && dateStr > row.dateTo) continue;
    if (row.appliesTo === UNAVAILABLE_VALUES.APPLIES_TO_ALL || row.postIds.length === 0) return true;
    if (row.postIds.indexOf(postId) !== -1) return true;
  }
  return false;
}

/**
 * 依 RuleSettings 的 Level 與 Priority 計算違規總扣分。
 * Level 決定量級（HARD 遠大於 SEMI_HARD 遠大於 SOFT），Priority 數字越小加權越重。
 * @param {Object[]} violations 違規清單
 * @returns {number} 扣分總和
 */
function sumPenalty_(violations) {
  let total = 0;
  for (let i = 0; i < violations.length; i++) {
    const base = RULE_LEVEL_PENALTY[violations[i].level] || RULE_LEVEL_PENALTY.SOFT;
    const priority = Number(violations[i].priority);
    const weight = isNaN(priority) ? 0 : Math.max(0, 100 - priority);
    const multiplier = violations[i].multiplier || 1;
    total += (base + weight) * multiplier;
  }
  return total;
}

/**
 * 依 RuleSettings 的內容組出一個違規物件。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {string} ruleId 規則 ID
 * @param {string} reason 違規原因描述
 * @param {number=} multiplier 扣分倍率，用於「超出越多扣越重」的遞增扣分；預設 1
 * @returns {{ruleId: string, level: string, priority: number, onViolation: string,
 *   reason: string, multiplier: number}} 違規物件
 */
function makeViolation_(rules, ruleId, reason, multiplier) {
  const rule = rules[ruleId] || {};
  return {
    ruleId: ruleId,
    level: String(rule[COLUMNS.RULE_SETTINGS.LEVEL] || RULE_LEVELS.SOFT).toUpperCase(),
    priority: Number(rule[COLUMNS.RULE_SETTINGS.PRIORITY]),
    onViolation: String(rule[COLUMNS.RULE_SETTINGS.ON_VIOLATION] || ON_VIOLATION.WARN).toUpperCase(),
    reason: reason,
    multiplier: (multiplier === undefined || isNaN(multiplier)) ? 1 : Math.max(1, multiplier)
  };
}

/**
 * 判斷某條規則在 RuleSettings 中是否存在且 Enabled=TRUE。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {string} ruleId 規則 ID
 * @returns {boolean} 是否啟用
 */
function isRuleEnabled_(rules, ruleId) {
  const rule = rules[ruleId];
  if (!rule) return false;
  return isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED]);
}

/**
 * 依 PostID 在崗位清單中尋找崗位。
 * @param {Object[]} posts 崗位清單
 * @param {string} postId 崗位 ID
 * @returns {?Object} 崗位資料；找不到時回傳 null
 */
function findPost_(posts, postId) {
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].postId === postId) return posts[i];
  }
  return null;
}

/**
 * 組出一筆派工結果。
 * @param {Object} baseRow 含 serviceDateId / serviceDate / postId / slotIndex 的基本資料
 * @param {string} personId 獲派者的 PersonID，留空表示未派人
 * @param {string} personName 獲派者姓名快照
 * @param {string} assignSource 派工來源，見 ASSIGN_SOURCE
 * @param {string[]} ruleFlags 相關的規則 ID 清單
 * @returns {Object} 派工結果物件
 */
function makeAssignment_(baseRow, personId, personName, assignSource, ruleFlags) {
  return {
    serviceDateId: baseRow.serviceDateId,
    serviceDate: baseRow.serviceDate,
    postId: baseRow.postId,
    slotIndex: baseRow.slotIndex,
    personId: personId,
    personName: personName,
    assignSource: assignSource,
    ruleFlags: ruleFlags
  };
}

/**
 * 組出一筆警告紀錄。
 * @param {Object} baseRow 含 serviceDate / postId / slotIndex 的基本資料
 * @param {string} ruleId 相關規則 ID
 * @param {string} reason 警告原因描述
 * @returns {{serviceDate: string, postId: string, slotIndex: number, ruleId: string, reason: string}} 警告物件
 */
function makeWarning_(baseRow, ruleId, reason) {
  return {
    serviceDate: baseRow.serviceDate,
    postId: baseRow.postId,
    slotIndex: baseRow.slotIndex,
    ruleId: ruleId,
    reason: reason
  };
}

/**
 * 階段 C 新增：把生成結果的「留空格子」拆成四種語意完全不同的類別，取代原本
 * 一律含糊算進同一個「blank」數字的做法（`MultiRun.gs` 的
 * `genResult.assignments.length - assigned`）。
 *
 * - **structuralNa**（結構性不適用，不需要任何人處理）：崗位在這一週根本不存在
 *   （目前只有非首主日的聖餐襄禮，見 STRUCTURAL_NA_RULE_IDS）。
 * - **specialSkip**（因特別主日而跳過，通常不需要人處理，但幹事應該知道）：
 *   崗位平常會自動生成，只是這一週被 SpecialSundays.SkipPostIDs 標記跳過
 *   （見 SPECIAL_SKIP_RULE_IDS）。
 * - **manualPending**（待人手填寫，系統設計上本來就不自動生成）：
 *   講員／翻譯／獻花這類 Posts.AutoGenerate=FALSE 或 Frequency=AS_NEEDED 的崗位，
 *   或整個主日 ServiceDates.AutoGenerate=FALSE。這是幹事**預期中**要做的事，
 *   不是系統出錯。
 * - **genuineGap**（系統應該排但排不出，真正的問題）：完全找不到合資格人選
 *   （RULE_IDS.ELIGIBILITY）或 LockPostIDs 鎖定的崗位沒有現有人選可保留——
 *   這是唯一真正代表「系統有問題、幹事要優先處理」的類別。
 *
 * @param {Object[]} assignments performRosterGeneration_() 的派工結果（in-memory，
 *   含 ruleFlags；已寫入 RosterAssignments 之後這個欄位不一定完整保留，
 *   這個函式只適合在生成當下的 in-memory 結果上呼叫）
 * @returns {{structuralNaCount: number, specialSkipCount: number,
 *   manualPendingCount: number, genuineGapCount: number,
 *   genuineGapCells: Object[], totalBlank: number}}
 */
function summariseBlankAssignments_(assignments) {
  let structuralNaCount = 0;
  let specialSkipCount = 0;
  let manualPendingCount = 0;
  let genuineGapCount = 0;
  const genuineGapCells = [];

  assignments.forEach(function (a) {
    if (a.personId) return; // 已經有人，不算留空

    const flags = a.ruleFlags || [];
    if (flags.some(function (id) { return STRUCTURAL_NA_RULE_IDS.indexOf(id) !== -1; })) {
      structuralNaCount++;
    } else if (flags.some(function (id) { return SPECIAL_SKIP_RULE_IDS.indexOf(id) !== -1; })) {
      specialSkipCount++;
    } else if (a.assignSource === ASSIGN_SOURCE.SKIPPED
      && flags.indexOf(RULE_IDS.NO_AUTO_GENERATE) !== -1) {
      manualPendingCount++;
    } else {
      // 涵蓋 RULE_IDS.ELIGIBILITY（完全找不到合資格人選）與 LockPostIDs
      // 鎖定但沒有現有人選可保留（assignSource=LOCKED，ruleFlags 為空陣列）
      // 兩種情況——都是「系統應該排但排不出」的真正問題。
      genuineGapCount++;
      genuineGapCells.push({
        serviceDate: a.serviceDate, postId: a.postId, slotIndex: a.slotIndex,
        reason: a.assignSource === ASSIGN_SOURCE.LOCKED
          ? 'LockPostIDs 鎖定但沒有現有人選可保留'
          : '找不到合資格人選'
      });
    }
  });

  return {
    structuralNaCount: structuralNaCount,
    specialSkipCount: specialSkipCount,
    manualPendingCount: manualPendingCount,
    genuineGapCount: genuineGapCount,
    genuineGapCells: genuineGapCells,
    totalBlank: structuralNaCount + specialSkipCount + manualPendingCount + genuineGapCount
  };
}

/**
 * 建立可重現的 seeded 亂數產生器（mulberry32）。
 * 同一個 seed 必定產生相同的數列，確保排表結果可重現。
 * @param {number} seed 亂數種子，取自 Config 的 RANDOM_SEED
 * @returns {function(): number} 回傳 0 至 1 之間亂數的函式
 */
function makeSeededRandom_(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
