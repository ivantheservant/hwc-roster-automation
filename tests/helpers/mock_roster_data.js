// 階段 A（Opus 深度輪）新增：組出排表生成器需要的 context 假資料。
//
// 全部人名一律是明顯虛構的（「測甲01」這種格式），電郵一律 x.com——這個
// repo 是 public，測試資料絕不可以出現真實會友資料（見 tests/scan_sensitive.test.js）。
// 崗位結構刻意貼近真實教會的形狀（15 個崗位、司事／司數各 2 個位且同週不可
// 重複、聖餐襄禮只在每月首主日、講員與翻譯不自動生成），因為「刻意刁難」的
// 測試情境要有意義，資料形狀就必須跟真實情況同構——但具體有哪些人、誰做過
// 哪個崗位，全部是造出來的。
//
// context 的欄位對照 Generator.gs 的 buildGeneratorContext_() 回傳值：測試
// 不呼叫那個函式（它要讀真實試算表），改為在這裡用假資料組出同樣形狀的物件。

/** 崗位 ID 常數，供測試檔引用時不用打字串。 */
const POST = {
  CHAIR: 'CHAIR',           // 主席
  ANNOUNCE: 'ANNOUNCE',     // 報告
  SCRIPTURE: 'SCRIPTURE',   // 讀經
  WORSHIP: 'WORSHIP',       // 領詩
  PIANO: 'PIANO',           // 司琴
  USHER: 'USHER',           // 司事（2 個位，同週不可重複）
  COUNTER: 'COUNTER',       // 司數（2 個位，同週不可重複）
  AUDIO: 'AUDIO',           // 音響
  PPT: 'PPT',               // PPT 控制
  VIDEO: 'VIDEO',           // 錄影
  TRAFFIC: 'TRAFFIC',       // 交通指揮
  DEACON: 'DEACON',         // 當值堂委
  COMMUNION: 'COMMUNION',   // 聖餐襄禮（只在每月第一個主日）
  PREACHER: 'PREACHER',     // 講員（不自動生成）
  TRANSLATE: 'TRANSLATE'    // 翻譯（不自動生成）
};

/**
 * 崗位定義。形狀對照 readPostsNormalized()（SheetReader.gs）的輸出。
 * @returns {Object[]} 正規化後的崗位陣列
 */
function buildPosts() {
  const def = function (postId, nameTC, opts) {
    opts = opts || {};
    return {
      postId: postId,
      postNameTC: nameTC,
      slotCount: opts.slotCount || 1,
      distinctWithinPost: !!opts.distinctWithinPost,
      frequency: opts.frequency || 'WEEKLY',
      autoGenerate: opts.autoGenerate !== false,
      allowConsecutive: opts.allowConsecutive || 'BLOCK',
      mutexGroup: opts.mutexGroup || '',
      displayOrder: opts.displayOrder,
      emptyDisplay: opts.emptyDisplay || 'PENDING'
    };
  };

  return [
    def(POST.CHAIR, '主席', { displayOrder: 1 }),
    // 報告是「洩壓閥」：真實規則容許連續兩週同一人（約 27%），所以 ALLOW
    def(POST.ANNOUNCE, '報告', { displayOrder: 2, allowConsecutive: 'ALLOW' }),
    def(POST.SCRIPTURE, '讀經', { displayOrder: 3 }),
    def(POST.WORSHIP, '領詩', { displayOrder: 4 }),
    def(POST.PIANO, '司琴', { displayOrder: 5 }),
    def(POST.USHER, '司事', { displayOrder: 6, slotCount: 2, distinctWithinPost: true }),
    def(POST.COUNTER, '司數', { displayOrder: 7, slotCount: 2, distinctWithinPost: true }),
    def(POST.AUDIO, '音響', { displayOrder: 8 }),
    def(POST.PPT, 'PPT 控制', { displayOrder: 9 }),
    def(POST.VIDEO, '錄影', { displayOrder: 10 }),
    def(POST.TRAFFIC, '交通指揮', { displayOrder: 11 }),
    def(POST.DEACON, '當值堂委', { displayOrder: 12 }),
    def(POST.COMMUNION, '聖餐襄禮', { displayOrder: 13, frequency: 'FIRST_SUNDAY' }),
    def(POST.PREACHER, '講員', { displayOrder: 14, autoGenerate: false }),
    def(POST.TRANSLATE, '翻譯', { displayOrder: 15, autoGenerate: false })
  ];
}

/**
 * 產生一季的主日清單。每月第一個主日標記 isFirstSundayOfMonth=TRUE，
 * 用真實的日曆邏輯計算（不是每 4 週硬當一次），確保聖餐襄禮的斷言有意義。
 * @param {string} quarterId 季度 ID
 * @param {string} startDate 第一個主日，格式 yyyy-MM-dd
 * @param {number} weekCount 週數
 * @returns {Object[]} 正規化後的主日陣列
 */
function buildServiceDates(quarterId, startDate, weekCount) {
  const base = Date.UTC(
    Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)));
  const seenMonths = {};
  const dates = [];
  for (let i = 0; i < weekCount; i++) {
    const d = new Date(base + i * 7 * 86400000);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    const iso = y + '-' + pad(mo) + '-' + pad(day);
    const monthKey = y + '-' + pad(mo);
    // 這個季度內、該月出現的第一個主日，就是該月的第一個主日
    const isFirst = !seenMonths[monthKey];
    seenMonths[monthKey] = true;
    dates.push({
      serviceDateId: quarterId + '-W' + (i + 1),
      serviceDate: iso,
      weekIndex: i + 1,
      isFirstSundayOfMonth: isFirst,
      serviceType: '主日崇拜',
      specialId: '',
      autoGenerate: true
    });
  }
  return dates;
}

/**
 * 產生虛構人員。名稱格式「測甲01」——明顯是造出來的，不可能跟真實會友撞名。
 * @param {number} count 人數
 * @returns {Object.<string, Object>} peopleById，形狀對照 indexPeopleById_()
 */
function buildPeople(count) {
  const peopleById = {};
  for (let i = 1; i <= count; i++) {
    const num = i < 10 ? '0' + i : String(i);
    const personId = 'P' + (i < 100 ? ('00' + i).slice(-3) : String(i));
    peopleById[personId] = {
      personId: personId,
      nameTC: '測甲' + num,
      email: 'test' + num + '@x.com',
      maxPerQuarter: null
    };
  }
  return peopleById;
}

/**
 * 依「每個崗位要有幾多個合資格的人」組出 eligibility，形狀對照 readEligibility()。
 * 分配方式是輪流指派（人數不足時會重複用同一批人），確保結果可重現、
 * 不受亂數影響——測試要能夠準確控制「這個崗位剛好得 N 個人」這種條件。
 * @param {Object.<string, Object>} peopleById 全部人員
 * @param {Object.<string, number>} poolSizeByPost {崗位ID: 合資格人數}
 * @param {Object=} options 選填；options.historicalCount 可指定某崗位某人的歷史次數
 * @returns {{byPost: Object, byPerson: Object, historicalCount: Object}}
 */
function buildEligibility(peopleById, poolSizeByPost, options) {
  const allIds = Object.keys(peopleById).sort();
  const byPost = {};
  const byPerson = {};
  const historicalCount = {};

  let cursor = 0;
  Object.keys(poolSizeByPost).forEach(function (postId) {
    const size = poolSizeByPost[postId];
    const pool = [];
    for (let i = 0; i < size; i++) {
      const personId = allIds[(cursor + i) % allIds.length];
      if (pool.indexOf(personId) === -1) pool.push(personId);
    }
    // 每個崗位的起點錯開，令不同崗位的人選池不會完全重疊
    cursor += Math.max(1, Math.floor(size / 2));

    byPost[postId] = pool;
    historicalCount[postId] = {};
    pool.forEach(function (personId, idx) {
      if (!byPerson[personId]) byPerson[personId] = [];
      byPerson[personId].push(postId);
      // 歷史次數造一個右偏分佈（前面的人次數高），貼近真實情況
      historicalCount[postId][personId] = Math.max(1, 10 - idx);
    });
  });

  if (options && options.historicalCount) {
    Object.keys(options.historicalCount).forEach(function (postId) {
      historicalCount[postId] = Object.assign({}, historicalCount[postId], options.historicalCount[postId]);
    });
  }

  return { byPost: byPost, byPerson: byPerson, historicalCount: historicalCount };
}

/**
 * 組出 RuleSettings 對照表，形狀對照 readRules()。全部規則預設 Enabled=TRUE，
 * Level 對照真實設定（硬規則 HARD、連續兩週 SEMI_HARD、其餘 SOFT）。
 * @param {Object=} overrides 選填，{ruleId: {欄位: 值}} 逐條覆寫
 * @returns {Object.<string, Object>} rules
 */
function buildRules(overrides) {
  const rule = function (ruleId, level, opts) {
    opts = opts || {};
    return {
      RuleID: ruleId,
      RuleName: ruleId,
      Level: level,
      Enabled: 'TRUE',
      ScopePostIDs: opts.scope || '',
      TargetValue: opts.target === undefined ? '' : opts.target,
      Tolerance: opts.tolerance === undefined ? '' : opts.tolerance,
      ParamJSON: '',
      OnViolation: opts.onViolation || 'WARN',
      Priority: opts.priority === undefined ? 50 : opts.priority,
      Description: ''
    };
  };

  const rules = {
    HARD_ELIGIBILITY: rule('HARD_ELIGIBILITY', 'HARD', { priority: 1 }),
    HARD_DISTINCT_SLOT: rule('HARD_DISTINCT_SLOT', 'HARD', { priority: 2 }),
    HARD_UNAVAILABLE: rule('HARD_UNAVAILABLE', 'HARD', { priority: 3 }),
    HARD_COMMUNION_FIRST_SUNDAY: rule('HARD_COMMUNION_FIRST_SUNDAY', 'HARD', { priority: 4 }),
    HARD_NO_AUTO_PREACHER: rule('HARD_NO_AUTO_PREACHER', 'HARD', { priority: 5 }),
    HARD_SPECIAL_SUNDAY_SKIP: rule('HARD_SPECIAL_SUNDAY_SKIP', 'HARD', { priority: 6 }),
    HARD_MUTEX_GROUP: rule('HARD_MUTEX_GROUP', 'HARD', { priority: 7 }),
    SEMI_NO_CONSECUTIVE: rule('SEMI_NO_CONSECUTIVE', 'SEMI_HARD', { priority: 20 }),
    SOFT_CHAIR_EQ_ANNOUNCE: rule('SOFT_CHAIR_EQ_ANNOUNCE', 'SOFT', {
      scope: POST.CHAIR + ',' + POST.ANNOUNCE, target: 0.63, tolerance: 0.05, priority: 60
    }),
    SOFT_CHAIR_PREFER_DUAL: rule('SOFT_CHAIR_PREFER_DUAL', 'SOFT', {
      scope: POST.CHAIR, target: 0.63, priority: 61
    }),
    SOFT_ANNOUNCE_RELIEF: rule('SOFT_ANNOUNCE_RELIEF', 'SOFT', {
      scope: POST.ANNOUNCE, target: 0.27, tolerance: 0.05, priority: 62
    }),
    SOFT_MAX_PER_QUARTER: rule('SOFT_MAX_PER_QUARTER', 'SOFT', { target: 8, priority: 70 }),
    SOFT_PERSONAL_QUOTA: rule('SOFT_PERSONAL_QUOTA', 'SOFT', { target: 1.0, tolerance: 0.3, priority: 71 })
  };

  if (overrides) {
    Object.keys(overrides).forEach(function (ruleId) {
      rules[ruleId] = Object.assign({}, rules[ruleId] || rule(ruleId, 'SOFT'), overrides[ruleId]);
    });
  }
  return rules;
}

/**
 * 「正常資源」的預設崗位人數配置：貼近真實教會的規模（技術崗位 pool 約 6 人，
 * 一般崗位 8–20 人），足夠讓 13 週的季度在不違反任何硬規則的情況下排滿。
 * @returns {Object.<string, number>}
 */
function defaultPoolSizes() {
  const sizes = {};
  sizes[POST.CHAIR] = 13;
  sizes[POST.ANNOUNCE] = 8;
  sizes[POST.SCRIPTURE] = 20;
  sizes[POST.WORSHIP] = 15;
  sizes[POST.PIANO] = 10;
  sizes[POST.USHER] = 20;
  sizes[POST.COUNTER] = 8;
  sizes[POST.AUDIO] = 6;
  sizes[POST.PPT] = 6;
  sizes[POST.VIDEO] = 6;
  sizes[POST.TRAFFIC] = 8;
  sizes[POST.DEACON] = 9;
  sizes[POST.COMMUNION] = 16;
  // 講員／翻譯 autoGenerate=FALSE，本來就不會被派，pool 給不給都一樣；
  // 刻意給一個非空 pool，確保「就算有合資格的人，系統也絕不自動派」這一點
  // 真的被測到——如果 pool 是空的，就算生成器壞了也會因為沒人可派而剛好沒事。
  sizes[POST.PREACHER] = 5;
  sizes[POST.TRANSLATE] = 4;
  return sizes;
}

/**
 * 組出完整的 context，形狀對照 buildGeneratorContext_() 的回傳值。
 * @param {Object=} options 覆寫項目：weekCount／peopleCount／poolSizes／unavailable／
 *   randomSeed／rules／specialByDate／priorWeeks／maxPerQuarterDefault／
 *   selectionStrategy／historicalWeight／quotaMultiplier
 * @returns {Object} 可以直接餵給 buildRoster_() 的 context
 */
function buildGeneratorContextMock(options) {
  const o = options || {};
  const quarterId = o.quarterId || '2099T1';
  const weekCount = o.weekCount === undefined ? 13 : o.weekCount;
  const peopleCount = o.peopleCount === undefined ? 89 : o.peopleCount;

  const posts = o.posts || buildPosts();
  const serviceDates = buildServiceDates(quarterId, o.startDate || '2099-01-04', weekCount);
  const peopleById = o.peopleById || buildPeople(peopleCount);
  const poolSizes = o.poolSizes || defaultPoolSizes();
  const eligibility = o.eligibility || buildEligibility(peopleById, poolSizes, o.eligibilityOptions);
  const rules = o.rules || buildRules(o.ruleOverrides);

  const context = {
    quarterId: quarterId,
    serviceDates: serviceDates,
    posts: posts,
    eligibility: eligibility,
    peopleById: peopleById,
    unavailable: o.unavailable || [],
    specialByDate: o.specialByDate || {},
    rules: rules,
    priorWeeks: o.priorWeeks || [],
    existingAssignments: o.existingAssignments || {},
    quotaByPerson: {},
    maxPerQuarterDefault: o.maxPerQuarterDefault === undefined ? 8 : o.maxPerQuarterDefault,
    selectionStrategy: o.selectionStrategy || 'LONGEST_UNSERVED',
    historicalWeight: o.historicalWeight === undefined ? 0.65 : o.historicalWeight,
    scoreWeights: o.scoreWeights || { chairDualBonus: 30, preferenceBonus: 50, selectionWeight: 45 },
    randomSeed: o.randomSeed === undefined ? 1 : o.randomSeed,
    // findStateViolations_()（FineTune.gs）額外需要的兩個欄位——測試的斷言
    // 直接重用那個函式，所以 context 要同時滿足兩邊的需求
    warnOnSemiHard: o.warnOnSemiHard === undefined ? true : o.warnOnSemiHard
  };

  // quotaByPerson 用正式碼的 computePersonQuotas_() 計算（由呼叫端注入 gas 沙箱），
  // 沒有注入時留空物件——SOFT_PERSONAL_QUOTA 找不到配額會直接略過，不影響硬規則。
  if (o.gas && typeof o.gas.computePersonQuotas_ === 'function') {
    context.quotaByPerson = o.gas.computePersonQuotas_(
      eligibility, peopleById, serviceDates, posts, rules,
      context.maxPerQuarterDefault);
  }

  return context;
}

/**
 * 組出 Unavailable 紀錄，形狀對照 readUnavailableNormalized()。
 * @param {string[]} personIds 對象
 * @param {string} dateFrom 起始日期
 * @param {string} dateTo 結束日期
 * @param {string[]=} postIds 只針對某些崗位；省略代表整日不可服侍（AppliesTo=ALL）
 * @returns {Object[]}
 */
function buildUnavailable(personIds, dateFrom, dateTo, postIds) {
  return personIds.map(function (personId) {
    return {
      personId: personId,
      dateFrom: dateFrom,
      dateTo: dateTo,
      appliesTo: postIds && postIds.length > 0 ? 'POSTS' : 'ALL',
      postIds: postIds || []
    };
  });
}

module.exports = {
  POST,
  buildPosts,
  buildServiceDates,
  buildPeople,
  buildEligibility,
  buildRules,
  defaultPoolSizes,
  buildGeneratorContextMock,
  buildUnavailable
};
