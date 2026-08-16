/**
 * 第十七輪批次階段 A／B：**身分規則影響預估（唯讀）** 與 **主席兼報告理論上限**。
 *
 * ## 呢個工具答一條問題
 *
 * 教會五條新規則（見 `docs/排表規則.md`）落實之後，候選人池會收窄。收窄幾多、
 * 邊個崗位會因此排唔出人，喺生成之前完全睇唔到——要等重設季度、重新生成、
 * 再逐格數空格先知，而嗰陣已經浪費咗一次生成。
 *
 * 呢個工具喺**生成之前**答：「加咗身分規則之後，邊個崗位仲排唔排得出人？」
 *
 * ## 唯讀保證
 *
 * 只呼叫讀取函式與 `tryWriteDiagnostics_()`。冇任何 `setValue`／`insertSheet`／
 * `deleteSheet`／`MailApp` 呼叫，唔會產生版本、唔會寄信、唔會改動任何既有
 * 工作表——唯一嘅寫入係覆寫 Diagnostics 入面同名嗰份報告。
 *
 * ## ⚠️ 只顯示 PersonID，唔顯示姓名
 *
 * 報告會寫入 Diagnostics，而 Diagnostics 有機會被複製去對話或者文件。
 * 全檔案任何地方都唔會輸出 `nameTC`——要對返邊個人，幹事自己去 NameMapping 查。
 * （同 `Roles.gs` 嘅 `buildRoleOverviewRows_()`、`SoftRuleMetrics.gs` 嘅
 * `measureRolePostFocus_()` 同一個考慮。）
 */

/** 可行性判斷嘅結論代號。 */
const ROLE_IMPACT_VERDICT = {
  IMPOSSIBLE: '必定完全排不到人',
  CLASH: '同週必定撞人',
  CONSECUTIVE: '必定違反準硬規則',
  OVERLOAD: '必定有人超額',
  CAPACITY: '必定排不滿',
  OK: '正常'
};

/**
 * 算出本季**每個崗位真係要排**嘅主日清單。直接重用 `getSkipReason_()`
 * （Generator.gs）——即係生成器決定「呢一格排唔排」用嘅同一個函式，
 * 唔會出現「預估話要排 13 週、實際生成只排 12 週」呢種對唔上嘅情況。
 *
 * @param {Object} post 已正規化嘅崗位
 * @param {Object[]} serviceDates 本季全部主日
 * @param {Object.<string, Object>} specialByDate 特別主日索引
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @returns {Object[]} 呢個崗位真係要排嘅主日
 */
function listApplicableDatesForPost_(post, serviceDates, specialByDate, rules) {
  return serviceDates.filter(function (d) {
    const special = specialByDate[d.serviceDate] || { skipPostIds: [], lockPostIds: [] };
    return getSkipReason_(post, d, special, rules) === null;
  });
}

/**
 * 讀取「每季次數上限」嘅生效值（同 `resolveAssignmentLimit_()` 一致，
 * 但呢度唔需要成個 fine-tune context）。
 * @param {Object} person 人員物件（可能有個人 maxPerQuarter）
 * @param {Object.<string, Object>} rules RuleSettings
 * @param {number} defaultLimit Config 嘅預設值
 * @returns {number} 生效嘅上限
 */
function resolvePersonQuarterLimit_(person, rules, defaultLimit) {
  const personMax = (person && person.maxPerQuarter !== null && person.maxPerQuarter !== undefined
    && !isNaN(person.maxPerQuarter)) ? Number(person.maxPerQuarter) : NaN;
  if (!isNaN(personMax)) return personMax;
  const rule = rules[RULE_IDS.MAX_PER_QUARTER];
  const ruleTarget = rule ? Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : NaN;
  return isNaN(ruleTarget) ? defaultLimit : ruleTarget;
}

/**
 * 算一組日期入面，「唔可以有兩個連續主日」嘅前提下最多可以揀幾多個。
 *
 * 做法：將日期按本季主日次序排好，數出**連續嘅段**（run），每段長度 L
 * 最多可以揀 `ceil(L / 2)` 個（隔一個揀一個）。呢個係路徑圖最大獨立集嘅
 * 標準結果，對每一段都係精確值。
 *
 * 例：本季 13 週，某人可用第 1、2、3、7、9 週
 *   → 段 [1,2,3]（長 3 → 2 個）、段 [7]（1 個）、段 [9]（1 個）＝ 4
 *
 * @param {string[]} dates 該人可用嘅日期
 * @param {Object.<string, number>} dateIndex 日期 → 本季第幾個主日（0-based）
 * @returns {number} 最多可揀嘅個數
 */
function maxNonConsecutiveCount_(dates, dateIndex) {
  const indexes = dates.map(function (d) { return dateIndex[d]; })
    .filter(function (i) { return i !== undefined; })
    .sort(function (a, b) { return a - b; });
  if (indexes.length === 0) return 0;

  let total = 0;
  let runLength = 1;
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] === indexes[i - 1] + 1) {
      runLength++;
    } else {
      total += Math.ceil(runLength / 2);
      runLength = 1;
    }
  }
  total += Math.ceil(runLength / 2);
  return total;
}

/**
 * 階段 B1：算「同一人同一週兼任主席與報告」喺本季嘅**理論最高週數上界**。
 *
 * ## 點解需要呢個數
 *
 * `SOFT_CHAIR_EQ_ANNOUNCE` 嘅目標值 63% 係由歷史資料算返出嚟嘅。但身分規則
 * 收窄咗報告嘅候選池之後，同時喺兩個池入面嘅人可能得返幾個——嗰陣「軟規則
 * 實測量度」報「偏低」，好可能係**規則造成嘅天花板**，唔係排表出錯。
 * 調高目標值唔會改善，改嘅只會係一個永遠達唔到嘅數字。系統要識得自己講出
 * 呢件事，唔好要幹事自己估。
 *
 * ## 推導（每一步都係「每個兼任週都一定要滿足」嘅必要條件）
 *
 * 設 `D` ＝ 同時喺主席池同報告池、而且喺該週兩個崗位都通過晒 HARD 檢查嘅人；
 * `W` ＝ 兩個崗位都要排嘅週數。
 *
 * 1. 每一個兼任週都只可以歸屬**一個人**（就係嗰個兼任嘅人），所以
 *    兼任總週數 ＝ Σ（每個人嘅兼任週數）。
 * 2. 每一週最多只可以有一個兼任週，所以總數 ≤ `W`。
 * 3. 某人 `d` 嘅兼任週一定係佢「兩個崗位都用得着」嘅週（`A_d`），
 *    所以 `d` 嘅兼任週數 ≤ `|A_d|`。
 * 4. 如果主席或者報告任何一個 `AllowConsecutive=BLOCK`，`d` 嘅兼任週唔可以
 *    連續兩週（兼任代表佢當週做咗嗰個崗位），所以 `d` 嘅兼任週數
 *    ≤ `maxNonConsecutiveCount_(A_d)`。
 *
 * **上界 ＝ min( W, Σ_d cap_d )**，`cap_d` 係第 3／4 點嘅較細者。
 *
 * ## ⚠️ 兩個版本，同埋點解要分開
 *
 * `guaranteedBound`（第 1–3 點）：只用**HARD 級別**嘅限制。生成器排除候選人
 * 嘅條件係 `level === HARD`，所以呢個版本喺任何情況下都**證明唔會低估**。
 * 代價係好鬆——通常等於 `W`（100%），對「63% 仲達唔達得到」冇乜參考價值。
 *
 * `bound`（第 1–4 點）：再加埋連續兩週嘅限制。⚠️ `SEMI_NO_CONSECUTIVE` 係
 * **SEMI_HARD**，唔係 HARD——生成器只會重扣分（1000）而唔會直接排除，
 * 理論上仍然可以違反。所以呢個數係「**準硬規則有被遵守嘅前提下**」嘅上界，
 * 唔係絕對保證。實測值高過佢，代表準硬規則被放行咗，報告會照講出嚟，
 * 唔會當成計錯數。
 *
 * ## 明確唔緊嘅簡化（會令上界偏高，即偏向安全）
 *
 * - 冇考慮非兼任嘅週一樣要有人做主席同報告，嗰啲人選會同兼任者爭同一批格。
 * - 冇考慮唔同兼任者之間爭同一週。
 * - **冇用每季次數上限**（`SOFT_MAX_PER_QUARTER`）：佢係 SOFT 級別，生成器
 *   超額只係扣分唔會擋，用咗就會令上界變成可以低估，反而唔安全。
 *
 * @param {Object} chairPost 主席崗位（已正規化）
 * @param {Object} announcePost 報告崗位（已正規化）
 * @param {Object} chairAvail `computePostAvailability_()` 對主席嘅結果
 * @param {Object} announceAvail 同上，對報告
 * @param {Object[]} serviceDates 本季全部主日（按次序）
 * @returns {{applicable: boolean, weeksBothPosts: number, dualCount: number,
 *   bound: number, boundRatio: ?number, guaranteedBound: number, guaranteedRatio: ?number,
 *   consecutiveBlocked: boolean, assumptions: string[], dualPeople: Object[]}}
 */
function computeChairAnnounceUpperBound_(chairPost, announcePost, chairAvail, announceAvail, serviceDates) {
  const dateIndex = {};
  serviceDates.forEach(function (d, i) { dateIndex[d.serviceDate] = i; });

  // W：兩個崗位都真係要排嘅週
  const chairDates = {};
  Object.keys(chairAvail.byPerson).forEach(function (p) {
    chairAvail.byPerson[p].forEach(function (d) { chairDates[d] = true; });
  });
  const bothDates = {};
  Object.keys(announceAvail.byPerson).forEach(function (p) {
    announceAvail.byPerson[p].forEach(function (d) { if (chairDates[d]) bothDates[d] = true; });
  });
  const weeksBothPosts = Object.keys(bothDates).length;

  const consecutiveBlocked =
    chairPost.allowConsecutive === ALLOW_CONSECUTIVE.BLOCK
    || announcePost.allowConsecutive === ALLOW_CONSECUTIVE.BLOCK;

  const dualPeople = [];
  let sumCap = 0;
  let sumGuaranteed = 0;

  Object.keys(chairAvail.byPerson).sort().forEach(function (personId) {
    const announceDates = announceAvail.byPerson[personId];
    if (!announceDates) return; // 唔係雙重合資格

    const announceSet = {};
    announceDates.forEach(function (d) { announceSet[d] = true; });
    const both = chairAvail.byPerson[personId].filter(function (d) { return !!announceSet[d]; });
    if (both.length === 0) return;

    const nonConsecutive = maxNonConsecutiveCount_(both, dateIndex);
    const cap = consecutiveBlocked ? Math.min(both.length, nonConsecutive) : both.length;

    sumGuaranteed += both.length;
    sumCap += cap;
    dualPeople.push({
      personId: personId,
      bothWeeks: both.length,
      cap: cap
    });
  });

  const bound = Math.min(weeksBothPosts, sumCap);
  const guaranteedBound = Math.min(weeksBothPosts, sumGuaranteed);

  const assumptions = [
    '每個兼任週只歸屬一個人，所以總數不會超過「各人上限之和」',
    '每一週最多一個兼任週，所以總數不會超過兩個崗位都要排的週數（' + weeksBothPosts + ' 週）',
    '兼任者當週必須同時通過兩個崗位的全部 HARD 檢查（身分、個人排除、不能服侍、Eligibility）'
  ];
  if (consecutiveBlocked) {
    assumptions.push('假設準硬規則「同一崗位不可連續兩週」有被遵守'
      + '（' + RULE_IDS.NO_CONSECUTIVE + ' 是 SEMI_HARD 級別，生成器只重扣分、不會直接排除，'
      + '所以這一項不是絕對保證；實測值高於上限即代表這條規則被放行了）');
  }
  assumptions.push('沒有使用每季次數上限（' + RULE_IDS.MAX_PER_QUARTER
    + ' 是 SOFT 級別，超額只扣分不會擋，用了反而會讓上限變成可能低估）');
  assumptions.push('沒有考慮非兼任週也要有人做主席與報告、以及不同兼任者爭同一週'
    + '——所以這個上限偏鬆（實際通常達不到）');

  return {
    applicable: weeksBothPosts > 0,
    weeksBothPosts: weeksBothPosts,
    dualCount: dualPeople.length,
    bound: bound,
    boundRatio: weeksBothPosts === 0 ? null : bound / weeksBothPosts,
    guaranteedBound: guaranteedBound,
    guaranteedRatio: weeksBothPosts === 0 ? null : guaranteedBound / weeksBothPosts,
    consecutiveBlocked: consecutiveBlocked,
    assumptions: assumptions,
    dualPeople: dualPeople
  };
}

/**
 * 階段 A 嘅主體：逐個崗位算收窄前後嘅人數與可行性。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} 供 `buildRoleImpactRows_()` 組報告用
 */
function collectRoleImpact_(quarterId) {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;

  const serviceDates = readServiceDatesNormalized(quarterId, timezone);
  if (serviceDates.length === 0) {
    throw new Error('找不到 ' + quarterId + ' 的主日資料（ServiceDates）。'
      + '請先用「準備工作 ▸ ⚠️ 新增季度」或「⚠️ 產生下一年度四個季度」建立這一季。');
  }

  const posts = readPostsNormalized();
  const eligibility = readEligibility();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  const rules = readRules();
  const unavailable = readUnavailableNormalized(timezone);
  const maxPerQuarterDefault = Number(config[CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER]) || DEFAULTS.MAX_PER_QUARTER;

  const peopleById = {};
  readPeople().forEach(function (row) {
    const id = row[COLUMNS.NAME_MAPPING.PERSON_ID];
    const rawMax = row[COLUMNS.NAME_MAPPING.MAX_PER_QUARTER];
    peopleById[id] = {
      personId: id,
      maxPerQuarter: (rawMax === '' || rawMax === null || rawMax === undefined) ? null : Number(rawMax)
    };
  });

  const specialByDate = {};
  readSpecialSundays(quarterId)
    .filter(function (row) { return isTrueValue_(row[COLUMNS.SPECIAL_SUNDAYS.ACTIVE]); })
    .forEach(function (row) {
      const dateStr = toDateString(row[COLUMNS.SPECIAL_SUNDAYS.SERVICE_DATE], timezone);
      specialByDate[dateStr] = {
        skipPostIds: splitList_(row[COLUMNS.SPECIAL_SUNDAYS.SKIP_POST_IDS]),
        lockPostIds: splitList_(row[COLUMNS.SPECIAL_SUNDAYS.LOCK_POST_IDS])
      };
    });

  const maxRule = rules[RULE_IDS.MAX_PER_QUARTER];
  const maxTarget = maxRule ? Number(maxRule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : NaN;

  const availabilityByPost = {};
  const items = posts
    .filter(function (p) { return p.autoGenerate; })
    .map(function (post) {
      const applicableDates = listApplicableDatesForPost_(post, serviceDates, specialByDate, rules);
      const slotsNeeded = applicableDates.length * post.slotCount;

      // 收窄之前：Eligibility 名單（`readEligibility()` 已經剔走 Eligible=FALSE），
      // 再扣走唔喺在職名單嘅人——同 `pickPerson_()` 嘅第一層過濾一致。
      const beforeIds = (eligibility.byPost[post.postId] || [])
        .filter(function (id) { return !!peopleById[id]; });

      const avail = computePostAvailability_(post, applicableDates, roleContext, peopleById, unavailable);
      availabilityByPost[post.postId] = avail;

      const poolCount = avail.pool.length;
      const avgPerPerson = poolCount === 0 ? null : slotsNeeded / poolCount;

      // 因為身分規則（或個人排除／請假）而由「收窄前」跌出候選池嘅人
      const poolSet = {};
      avail.pool.forEach(function (id) { poolSet[id] = true; });
      const droppedIds = beforeIds.filter(function (id) { return !poolSet[id]; });
      const historical = eligibility.historicalCount[post.postId] || {};
      const dropped = droppedIds
        .map(function (id) { return { personId: id, historicalCount: historical[id] || 0 }; })
        .sort(function (a, b) { return b.historicalCount - a.historicalCount; });

      // 因為身分而**新加入**候選池嘅人（聯集嘅另一半，例如新任堂委）
      const beforeSet = {};
      beforeIds.forEach(function (id) { beforeSet[id] = true; });
      const added = avail.pool.filter(function (id) { return !beforeSet[id]; });

      const verdicts = [];
      if (poolCount === 0) {
        verdicts.push({ code: ROLE_IMPACT_VERDICT.IMPOSSIBLE,
          detail: '候選池是空的，這個崗位本季每一格都會留空' });
      } else {
        if (post.distinctWithinPost && poolCount < post.slotCount) {
          verdicts.push({ code: ROLE_IMPACT_VERDICT.CLASH,
            detail: '同一週需要 ' + post.slotCount + ' 個不同的人，但候選池只有 ' + poolCount + ' 人' });
        }
        if (post.allowConsecutive === ALLOW_CONSECUTIVE.BLOCK && poolCount < 2) {
          verdicts.push({ code: ROLE_IMPACT_VERDICT.CONSECUTIVE,
            detail: '這個崗位不可連續兩週同一人，但候選池只有 ' + poolCount + ' 人' });
        }
        if (!isNaN(maxTarget) && avgPerPerson !== null && avgPerPerson > maxTarget) {
          verdicts.push({ code: ROLE_IMPACT_VERDICT.OVERLOAD,
            detail: '平均每人要做 ' + avgPerPerson.toFixed(1) + ' 次，超過每季次數上限 ' + maxTarget });
        }
        if (avail.usableSlotCount < slotsNeeded) {
          verdicts.push({ code: ROLE_IMPACT_VERDICT.CAPACITY,
            detail: '把每個人可以服侍的主日全部加起來只有 ' + avail.usableSlotCount
              + ' 格，少於需要的 ' + slotsNeeded + ' 格（有人只在部分週次可用）' });
        }
      }
      if (verdicts.length === 0) verdicts.push({ code: ROLE_IMPACT_VERDICT.OK, detail: '' });

      return {
        postId: post.postId,
        postNameTC: post.postNameTC,
        requiredRoles: requiredRolesOfPost_(post),
        weeks: applicableDates.length,
        slotCount: post.slotCount,
        slotsNeeded: slotsNeeded,
        beforeCount: beforeIds.length,
        poolCount: poolCount,
        usableSlotCount: avail.usableSlotCount,
        avgPerPerson: avgPerPerson,
        dropped: dropped,
        added: added,
        verdicts: verdicts
      };
    });

  // 階段 B3：同一份上限數字也放進這個報告，令幹事在生成之前就知道會見到什麼
  const chairAnnounce = buildChairAnnounceBoundFromContext_(
    rules, posts, availabilityByPost, serviceDates);

  return {
    quarterId: quarterId,
    weekCount: serviceDates.length,
    maxPerQuarterTarget: isNaN(maxTarget) ? null : maxTarget,
    rolesSheetExists: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ROLES),
    items: items,
    chairAnnounce: chairAnnounce,
    maxPerQuarterDefault: maxPerQuarterDefault
  };
}

/**
 * 由 `SOFT_CHAIR_EQ_ANNOUNCE` 嘅 `ScopePostIDs` 揾出主席／報告兩個崗位，
 * 再算上限。規則唔存在、或者兩個崗位有一個唔喺 `availabilityByPost` 入面
 * （例如 `AutoGenerate=FALSE`）就回傳 `applicable:false`。
 *
 * 抽成獨立函式係為咗畀「身分規則影響預估」（階段 A／B3）同
 * 「軟規則實測量度」（階段 B2）共用同一段推導，唔會兩邊各自算出唔同嘅上限。
 *
 * @param {Object.<string, Object>} rules RuleSettings
 * @param {Object[]} posts 已正規化嘅崗位清單
 * @param {Object.<string, Object>} availabilityByPost {PostID: computePostAvailability_() 結果}
 * @param {Object[]} serviceDates 本季全部主日
 * @returns {Object} `computeChairAnnounceUpperBound_()` 嘅結果，或 {applicable:false, reason}
 */
function buildChairAnnounceBoundFromContext_(rules, posts, availabilityByPost, serviceDates) {
  const rule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  if (!rule) {
    return { applicable: false, reason: 'RuleSettings 沒有 ' + RULE_IDS.CHAIR_EQ_ANNOUNCE };
  }
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length < 2) {
    return { applicable: false, reason: RULE_IDS.CHAIR_EQ_ANNOUNCE + ' 的 ScopePostIDs 不足兩個崗位' };
  }

  const chairPost = findPost_(posts, scope[0]);
  const announcePost = findPost_(posts, scope[1]);
  const chairAvail = availabilityByPost[scope[0]];
  const announceAvail = availabilityByPost[scope[1]];
  if (!chairPost || !announcePost || !chairAvail || !announceAvail) {
    return {
      applicable: false,
      reason: '找不到 ' + scope[0] + ' 或 ' + scope[1]
        + ' 的崗位資料（可能是 Active=FALSE 或 AutoGenerate=FALSE）'
    };
  }

  const result = computeChairAnnounceUpperBound_(
    chairPost, announcePost, chairAvail, announceAvail, serviceDates);
  result.chairPostId = scope[0];
  result.announcePostId = scope[1];
  result.target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  result.tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  return result;
}

/**
 * 把 `collectRoleImpact_()` 嘅結果組成 Diagnostics 行陣列。純函式。
 * @param {Object} o `collectRoleImpact_()` 嘅結果
 * @returns {Object[]} `diagRow_()` 產生嘅行陣列
 */
function buildRoleImpactRows_(o) {
  const rows = [];

  rows.push(diagRow_('概況', o.quarterId, o.weekCount + ' 個主日',
    o.rolesSheetExists
      ? '身分名單已建立。以下逐個「會自動生成」的崗位比較套用身分規則前後的候選人數。'
      : '⚠ ' + SHEETS.ROLES + ' 工作表尚未建立，身分規則全部未生效，'
        + '「套用後」與「套用前」會完全一樣。'));

  o.items.forEach(function (it) {
    const label = it.postNameTC + '（' + it.postId + '）';
    const roleText = it.requiredRoles.length > 0
      ? '身分要求：' + describeRoleCodes_(it.requiredRoles)
      : '沒有身分要求';

    rows.push(diagRow_('1. 候選人數變化', label,
      '套用前 ' + it.beforeCount + ' 人　→　套用後 ' + it.poolCount + ' 人'
        + (it.beforeCount === it.poolCount ? '（不變）' : ''),
      roleText));

    rows.push(diagRow_('2. 本季需求', label,
      it.weeks + ' 週 × 每週 ' + it.slotCount + ' 格 ＝ ' + it.slotsNeeded + ' 格',
      it.avgPerPerson === null
        ? '候選池是空的，無法計算平均'
        : '池內每人平均要做 ' + it.avgPerPerson.toFixed(2) + ' 次'
          + '　　可服侍格數總和 ' + it.usableSlotCount + '（每人可服侍主日數相加，是本季最多能填的格數上界）'));

    it.verdicts.forEach(function (v) {
      rows.push(diagRow_('3. 可行性判斷', label, v.code, v.detail));
    });

    if (it.added.length > 0) {
      rows.push(diagRow_('4. 因身分而新加入候選池', label, it.added.length + ' 人',
        it.added.join('、') + '（這些人在 Eligibility 沒有這個崗位的紀錄，'
          + '但持有所需身分，例如新任堂委——這正是採用「聯集」而不是「交集」的目的）'));
    }

    if (it.dropped.length > 0) {
      rows.push(diagRow_('5. 被規則剔走的人', label, it.dropped.length + ' 人',
        '以下按這個崗位的歷史服侍次數由高至低排列（只顯示 PersonID，姓名請自行到 NameMapping 對照）'));
      it.dropped.forEach(function (d) {
        rows.push(diagRow_('5. 被規則剔走的人', '　' + label + '　' + d.personId,
          '歷史 ' + d.historicalCount + ' 次',
          '原因：不持有所需身分、或有生效中的個人崗位排除、或本季全部主日都不能服侍'));
      });
    }
  });

  // ---- 階段 B3：主席兼報告理論上限 ----
  const ca = o.chairAnnounce;
  if (!ca || !ca.applicable) {
    rows.push(diagRow_('6. 主席兼報告理論上限', o.quarterId, '無法計算',
      (ca && ca.reason) || '缺少必要設定'));
  } else {
    rows.push(diagRow_('6. 主席兼報告理論上限', o.quarterId,
      '最多 ' + ca.bound + ' / ' + ca.weeksBothPosts + ' 週　＝ ' + formatPercent_(ca.boundRatio),
      '歷史基準（' + RULE_IDS.CHAIR_EQ_ANNOUNCE + ' 的 TargetValue）'
        + formatPercent_(ca.target)
        + '　　同時在兩個候選池內的人：' + ca.dualCount + ' 人'));

    if (!isNaN(ca.target) && ca.boundRatio !== null && ca.boundRatio < ca.target - ca.tolerance) {
      rows.push(diagRow_('6. 主席兼報告理論上限', '⚠ 重要', '本季理論上限低於歷史基準',
        buildChairAnnounceCeilingNote_(ca)));
    }

    rows.push(diagRow_('6. 主席兼報告理論上限', '　不含準硬規則的絕對上界',
      ca.guaranteedBound + ' / ' + ca.weeksBothPosts + ' 週　＝ ' + formatPercent_(ca.guaranteedRatio),
      '這個數字只用 HARD 級別的限制推導，任何情況下都不會低估；'
        + '上面那個較緊的上限額外假設了準硬規則「不可連續兩週」有被遵守'));

    ca.assumptions.forEach(function (a, i) {
      rows.push(diagRow_('6. 主席兼報告理論上限', '　推導假設 ' + (i + 1), '', a));
    });
  }

  return rows;
}

/**
 * 「本季理論上限低於歷史基準」嘅標準說明文字。階段 A 嘅報告同階段 B2 嘅
 * 「軟規則實測量度」共用同一句，避免兩邊講法唔一致。
 * @param {Object} ca `computeChairAnnounceUpperBound_()` 嘅結果（已補 target）
 * @returns {string} 說明文字
 */
function buildChairAnnounceCeilingNote_(ca) {
  return '本季理論上限低於歷史基準，原因是身分規則收窄了候選池，'
    + '這不是排表錯誤，調高目標值不會改善。'
    + '（同時具備主席與報告資格的只有 ' + ca.dualCount + ' 人，'
    + '兩個崗位都要排的週數是 ' + ca.weeksBothPosts + ' 週。）';
}

/**
 * 選單項目「查看 ▸ 身分規則影響預估（唯讀）」嘅執行入口。
 * @returns {void}
 */
function runRoleImpactForecast_() {
  const ui = SpreadsheetApp.getUi();
  const title = '身分規則影響預估（唯讀）';

  const response = ui.prompt(title,
    '請輸入 QuarterID（例如 2027T2）：\n\n'
      + '會在生成初稿之前，先算出加了身分規則之後，每個崗位還排不排得出人。\n'
      + '完全唯讀，不會產生版本、不會改動任何工作表。',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) {
    ui.alert(title, '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('計算中，請稍候…', title, 60);
    const impact = collectRoleImpact_(quarterId);
    tryWriteDiagnostics_('身分規則影響預估', buildRoleImpactRows_(impact));

    const lines = [quarterId + '　' + impact.weekCount + ' 個主日', ''];
    const problems = impact.items.filter(function (it) {
      return it.verdicts.some(function (v) { return v.code !== ROLE_IMPACT_VERDICT.OK; });
    });

    if (problems.length === 0) {
      lines.push('✓ 全部會自動生成的崗位都通過可行性判斷，沒有結構性問題。', '');
    } else {
      lines.push('⚠ 有 ' + problems.length + ' 個崗位的可行性判斷不是「正常」：', '');
      problems.forEach(function (it) {
        lines.push('　' + it.postNameTC + '（' + it.postId + '）　候選池 ' + it.poolCount + ' 人');
        it.verdicts.forEach(function (v) {
          if (v.code !== ROLE_IMPACT_VERDICT.OK) lines.push('　　→ ' + v.code + '：' + v.detail);
        });
      });
      lines.push('');
    }

    const narrowed = impact.items.filter(function (it) { return it.dropped.length > 0; });
    if (narrowed.length > 0) {
      lines.push('候選池有收窄的崗位：');
      narrowed.forEach(function (it) {
        lines.push('　' + it.postNameTC + '：' + it.beforeCount + ' → ' + it.poolCount
          + ' 人（剔走 ' + it.dropped.length + ' 人，明細見 Diagnostics）');
      });
      lines.push('');
    }

    const ca = impact.chairAnnounce;
    if (ca && ca.applicable) {
      lines.push('主席兼報告理論上限：' + ca.bound + ' / ' + ca.weeksBothPosts + ' 週　＝ '
        + formatPercent_(ca.boundRatio)
        + '　（歷史基準 ' + formatPercent_(ca.target) + '）');
      if (!isNaN(ca.target) && ca.boundRatio !== null && ca.boundRatio < ca.target - ca.tolerance) {
        lines.push('⚠ ' + buildChairAnnounceCeilingNote_(ca));
      }
      lines.push('');
    }

    lines.push(DIAGNOSTICS_WRITTEN_NOTE);
    ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runRoleImpactForecast_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
