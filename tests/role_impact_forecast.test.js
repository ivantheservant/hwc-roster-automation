// 第十七輪批次階段 A／B：身分規則影響預估、主席兼報告理論上限。
// 執行方式：node tests/role_impact_forecast.test.js
//
// ⚠️ 全部測試資料都係自造嘅 P9xxx 假 ID，唔係真實設定。
//
// 本檔案最重要嘅一節係 B4：**上界永遠 >= 實際生成結果**。做法係真正跑
// `buildRoster_()`（正式碼）幾十次，逐次數返實際兼任週數，同上界比。
// 呢個係唯一可以真正證明「上界唔會低估」嘅做法——靜態檢查證明唔到。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'RoleImpact.gs']));

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/** 造 N 個主日（由 2027-04-04 起，逐週）。 */
function makeDates(n) {
  const out = [];
  let d = Date.UTC(2027, 3, 4);
  for (let i = 0; i < n; i++) {
    const iso = new Date(d).toISOString().slice(0, 10);
    out.push({
      serviceDateId: 'SD' + (i + 1), serviceDate: iso, weekIndex: i + 1,
      isFirstSundayOfMonth: iso.slice(8) <= '07', autoGenerate: true
    });
    d += 7 * 86400000;
  }
  return out;
}

function makePost(postId, nameTC, overrides) {
  return Object.assign({
    postId: postId, postNameTC: nameTC, slotCount: 1, distinctWithinPost: true,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
    displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: ''
  }, overrides || {});
}

console.log('\n=== maxNonConsecutiveCount_()：路徑圖最大獨立集 ===');
{
  const idx = {};
  makeDates(13).forEach((d, i) => { idx[d.serviceDate] = i; });
  const all = makeDates(13).map((d) => d.serviceDate);

  checkEqual('★★★ 全部 13 週可用 → 最多 7 週（隔週）',
    gas.maxNonConsecutiveCount_(all, idx), 7);
  checkEqual('★★★ 只可用 1 週 → 1', gas.maxNonConsecutiveCount_([all[0]], idx), 1);
  checkEqual('★★★★ 連續 3 週 → 2（第 1、3 週）',
    gas.maxNonConsecutiveCount_([all[0], all[1], all[2]], idx), 2);
  checkEqual('★★★★ 本身已經隔開（第 1、3、5 週）→ 3（全部揀得晒）',
    gas.maxNonConsecutiveCount_([all[0], all[2], all[4]], idx), 3);
  checkEqual('★★★★ 兩段：[1,2,3] + [7] → 2 + 1 = 3',
    gas.maxNonConsecutiveCount_([all[0], all[1], all[2], all[6]], idx), 3);
  checkEqual('★★ 空陣列 → 0', gas.maxNonConsecutiveCount_([], idx), 0);
  checkEqual('★★ 連續 4 週 → 2', gas.maxNonConsecutiveCount_([all[0], all[1], all[2], all[3]], idx), 2);
}

console.log('\n=== B1【核心】computeChairAnnounceUpperBound_()：兩個極端 ===');
{
  const dates = makeDates(13);
  const allDates = dates.map((d) => d.serviceDate);

  // 極端一：全部人都雙重合資格，而且冇 BLOCK → 上界應該係 W（13 週，100%）
  {
    const chair = makePost('CHAIR', '主席');
    const announce = makePost('ANNOUNCE', '報告');
    const avail = {
      byPerson: { P9001: allDates, P9002: allDates, P9003: allDates },
      pool: ['P9001', 'P9002', 'P9003'], usableSlotCount: 39
    };
    const r = gas.computeChairAnnounceUpperBound_(chair, announce, avail, avail, dates);
    checkEqual('★★★★★ 極端一（全員雙重合資格、冇連續限制）→ 上界 = 13 週 = 100%',
      [r.bound, r.weeksBothPosts], [13, 13]);
    checkEqual('★★★ 雙重合資格人數', r.dualCount, 3);
    checkEqual('★★★ 比例 100%', r.boundRatio, 1);
  }

  // 極端二：一個雙重合資格嘅人都冇 → 上界 0
  {
    const chair = makePost('CHAIR', '主席');
    const announce = makePost('ANNOUNCE', '報告');
    const chairAvail = { byPerson: { P9001: allDates }, pool: ['P9001'], usableSlotCount: 13 };
    const announceAvail = { byPerson: { P9002: allDates }, pool: ['P9002'], usableSlotCount: 13 };
    const r = gas.computeChairAnnounceUpperBound_(chair, announce, chairAvail, announceAvail, dates);
    checkEqual('★★★★★ 極端二（冇人同時合資格）→ 上界 = 0 週 = 0%', r.bound, 0);
    checkEqual('★★★★ 雙重合資格人數 0', r.dualCount, 0);
    checkEqual('★★★ 兩個崗位都要排嘅週數仍然係 13（上界細係因為冇人，唔係因為冇週）',
      r.weeksBothPosts, 13);
  }
}

console.log('\n=== B1：AllowConsecutive=BLOCK 令上界收緊（呢個就係第 4 點推導）===');
{
  const dates = makeDates(13);
  const allDates = dates.map((d) => d.serviceDate);
  const announce = makePost('ANNOUNCE', '報告');
  const avail = { byPerson: { P9001: allDates }, pool: ['P9001'], usableSlotCount: 13 };

  const noBlock = gas.computeChairAnnounceUpperBound_(
    makePost('CHAIR', '主席', { allowConsecutive: 'ALLOW' }), announce, avail, avail, dates);
  checkEqual('★★★★ 冇 BLOCK：一個人可以做晒 13 週 → 上界 13', noBlock.bound, 13);

  const blocked = gas.computeChairAnnounceUpperBound_(
    makePost('CHAIR', '主席', { allowConsecutive: 'BLOCK' }), announce, avail, avail, dates);
  checkEqual('★★★★★ 有 BLOCK：同一個人唔可以連續兩週 → 上界跌到 7（ceil(13/2)）',
    blocked.bound, 7);
  check('★★★★ 有 BLOCK 時，假設清單要明確講出「呢一項唔係絕對保證」',
    blocked.assumptions.some((a) => a.indexOf('SEMI_HARD') !== -1),
    JSON.stringify(blocked.assumptions));
  checkEqual('★★★★★ 但**唔含準硬規則嘅絕對上界**維持 13（呢個先係任何情況都唔會低估嗰個）',
    blocked.guaranteedBound, 13);
}

console.log('\n=== B1：只做得到部分週次嘅人，上界要跟住收窄 ===');
{
  const dates = makeDates(13);
  const allDates = dates.map((d) => d.serviceDate);
  const chair = makePost('CHAIR', '主席', { allowConsecutive: 'BLOCK' });
  const announce = makePost('ANNOUNCE', '報告');

  // P9001 主席可用全季，但報告只可用頭 3 週 → 交集得 3 週 → cap = ceil(3/2) = 2
  const chairAvail = { byPerson: { P9001: allDates }, pool: ['P9001'], usableSlotCount: 13 };
  const announceAvail = {
    byPerson: { P9001: allDates.slice(0, 3) }, pool: ['P9001'], usableSlotCount: 3
  };
  const r = gas.computeChairAnnounceUpperBound_(chair, announce, chairAvail, announceAvail, dates);
  checkEqual('★★★★★ 兩個崗位都用得着嘅只有 3 週、又唔可以連續 → 上界 2', r.bound, 2);
  checkEqual('★★★★ 兩個崗位都要排嘅週數亦都只有 3（報告只有嗰 3 週有人）',
    r.weeksBothPosts, 3);
}

// =====================================================================
// B4【本檔案最重要】：上界永遠 >= 實際生成結果
// =====================================================================
console.log('\n=== B4【核心】上界永遠 >= 實際生成結果（真正跑 buildRoster_ 驗證）===');
{
  /**
   * 造一個完整 context 並真正生成，回傳 {actualDualWeeks, bound, guaranteedBound}。
   * @param {Object} opts dualCount＝雙重合資格人數；chairBlock＝主席是否 BLOCK；
   *   weeks＝主日數；seed＝亂數種子
   */
  function runScenario(opts) {
    const dates = makeDates(opts.weeks);
    const allDates = dates.map((d) => d.serviceDate);

    const chair = makePost('CHAIR', '主席', {
      allowConsecutive: opts.chairBlock ? 'BLOCK' : 'ALLOW', displayOrder: 1
    });
    const announce = makePost('ANNOUNCE', '報告', { displayOrder: 2 });
    const posts = [chair, announce];

    // 雙重合資格 P9001..P900{dualCount}；另外各加 3 個單邊合資格嘅人，
    // 令生成器有其他選擇（否則結果會被逼到極端，測唔到真實行為）。
    const dual = [];
    for (let i = 1; i <= opts.dualCount; i++) dual.push('P900' + i);
    const chairOnly = ['P9101', 'P9102', 'P9103'];
    const announceOnly = ['P9201', 'P9202', 'P9203'];

    const peopleById = {};
    dual.concat(chairOnly, announceOnly).forEach((id) => {
      peopleById[id] = { personId: id, nameTC: id, maxPerQuarter: null };
    });

    const chairPool = dual.concat(chairOnly);
    const announcePool = dual.concat(announceOnly);
    const historicalCount = { CHAIR: {}, ANNOUNCE: {} };
    chairPool.forEach((id, i) => { historicalCount.CHAIR[id] = 10 + i; });
    announcePool.forEach((id, i) => { historicalCount.ANNOUNCE[id] = 10 + i; });

    const context = {
      quarterId: '2027T2',
      serviceDates: dates,
      posts: posts,
      eligibility: {
        byPost: { CHAIR: chairPool, ANNOUNCE: announcePool },
        byPerson: {}, historicalCount: historicalCount, explicitlyExcluded: {}
      },
      roles: [], personPostExclusions: [],
      peopleById: peopleById,
      unavailable: [], specialByDate: {},
      // 開住 CHAIR_EQ_ANNOUNCE，令生成器真係會盡量令主席兼報告——
      // 唔開嘅話實際兼任數會偏低，個測試就變成「隨便一個上界都過到」。
      //
      // ⚠️ **一定要連 SOFT_CHAIR_PREFER_DUAL 一齊開。** 實測寫呢個測試嗰陣
      // 淨係開 CHAIR_EQ_ANNOUNCE，結果 48 個情境全部 0 兼任週：因為主席嗰格
      // 會揀咗歷史次數最高嘅人，而嗰個人未必有報告資格，之後派報告嗰陣
      // `computeChairEqAnnounceBonus_()` 見到「本週主席唔喺報告候選名單」
      // 就一律回傳 0，兼任永遠發生唔到。SOFT_CHAIR_PREFER_DUAL 正正就係
      // 為咗解決呢件事而存在（見 `computeChairPreferDualBonus_()` 嘅註釋）。
      rules: {
        SOFT_CHAIR_EQ_ANNOUNCE: {
          RuleID: 'SOFT_CHAIR_EQ_ANNOUNCE', Level: 'SOFT', Enabled: 'TRUE',
          ScopePostIDs: 'CHAIR,ANNOUNCE', TargetValue: 0.63, Tolerance: 0.1, Priority: 50
        },
        SOFT_CHAIR_PREFER_DUAL: {
          RuleID: 'SOFT_CHAIR_PREFER_DUAL', Level: 'SOFT', Enabled: 'TRUE',
          ScopePostIDs: 'CHAIR', TargetValue: 0.63, Tolerance: 0.1, Priority: 55
        },
        SEMI_NO_CONSECUTIVE: {
          RuleID: 'SEMI_NO_CONSECUTIVE', Level: 'SEMI_HARD', Enabled: 'TRUE', Priority: 20
        }
      },
      priorWeeks: {}, existingAssignments: {}, quotaByPerson: {},
      maxPerQuarterDefault: 99, selectionStrategy: 'LONGEST_UNSERVED',
      historicalWeight: 0.5,
      // ⚠️ 一定要用返 `readScoreWeights_()` 嘅真實形狀（三個 key 齊）。
      // 漏咗 `preferenceBonus` 嘅話，`computeChairEqAnnounceBonus_()` 會回傳
      // `undefined`，`score` 變 NaN，生成器完全唔會揀兼任——實測寫呢個測試
      // 嗰陣就係噉，48 個情境全部 0 兼任週，令「上界 >= 實際」變成一個
      // 永遠過到嘅空殼斷言。
      scoreWeights: {
        chairDualBonus: 30,
        preferenceBonus: 50,
        selectionWeight: 45
      },
      randomSeed: opts.seed, scoreTieEpsilon: 0
    };

    const result = gas.buildRoster_(context);

    // 實際兼任週數
    const byDate = {};
    result.assignments.forEach((a) => {
      if (!a.personId) return;
      if (!byDate[a.serviceDate]) byDate[a.serviceDate] = {};
      byDate[a.serviceDate][a.postId] = a.personId;
    });
    let actualDualWeeks = 0;
    Object.keys(byDate).forEach((d) => {
      const c = byDate[d].CHAIR;
      const n = byDate[d].ANNOUNCE;
      if (c && n && c === n) actualDualWeeks++;
    });

    // 上界（用同一份 pool 資料組 availability）
    const mkAvail = (pool) => {
      const byPerson = {};
      pool.forEach((id) => { byPerson[id] = allDates.slice(); });
      return { byPerson: byPerson, pool: pool.slice(), usableSlotCount: pool.length * allDates.length };
    };
    const b = gas.computeChairAnnounceUpperBound_(
      chair, announce, mkAvail(chairPool), mkAvail(announcePool), dates);

    return {
      actualDualWeeks: actualDualWeeks,
      bound: b.bound,
      guaranteedBound: b.guaranteedBound,
      label: 'dual=' + opts.dualCount + ' block=' + opts.chairBlock
        + ' weeks=' + opts.weeks + ' seed=' + opts.seed
    };
  }

  const scenarios = [];
  [1, 2, 4, 6].forEach((dualCount) => {
    [true, false].forEach((chairBlock) => {
      [9, 13].forEach((weeks) => {
        [1, 7, 42].forEach((seed) => {
          scenarios.push(runScenario({ dualCount, chairBlock, weeks, seed }));
        });
      });
    });
  });

  const guaranteedViolations = scenarios.filter((s) => s.actualDualWeeks > s.guaranteedBound);
  check('★★★★★ 全部 ' + scenarios.length + ' 個情境：實際兼任週數 <= **絕對上界**'
    + '（呢個係唔含準硬規則假設嘅版本，任何情況下都唔應該被超過）',
    guaranteedViolations.length === 0,
    JSON.stringify(guaranteedViolations.map((s) => s.label + ' 實際=' + s.actualDualWeeks
      + ' 絕對上界=' + s.guaranteedBound)));

  const boundViolations = scenarios.filter((s) => s.actualDualWeeks > s.bound);
  check('★★★★★ 全部情境：實際兼任週數 <= **含準硬規則假設嘅上界**'
    + '（超過即代表準硬規則被放行，報告會照講出嚟）',
    boundViolations.length === 0,
    JSON.stringify(boundViolations.map((s) => s.label + ' 實際=' + s.actualDualWeeks
      + ' 上界=' + s.bound)));

  // 反證：個上界唔係大到冇意義（否則上面兩個斷言就係空殼）。
  //
  // 唔用「實際 === 上界」做斷言：個上界刻意留咗鬆位（冇考慮非兼任週一樣要
  // 有人做、唔同兼任者爭同一週），實務上好少會剛好頂到。用「最接近嘅情境
  // 達到上界七成以上」——夠證明個上界貼身，又唔會因為排表器改咗少少
  // 加權就變成 flaky。
  const bestRatio = scenarios.reduce(function (best, s) {
    if (s.bound === 0) return best;
    const r = s.actualDualWeeks / s.bound;
    return r > best ? r : best;
  }, 0);
  check('★★★★ 反證：至少有一個情境嘅實際結果達到上界嘅 70% 以上'
    + '（證明個上界貼身，唔係大到永遠過到嘅空殼）',
    bestRatio >= 0.7,
    '最高達成率 ' + (bestRatio * 100).toFixed(1) + '%　'
      + JSON.stringify(scenarios
        .map((s) => s.label + ' 實際=' + s.actualDualWeeks + ' 上界=' + s.bound).slice(0, 6)));

  // 而且要真係有兼任週發生過——全部 0 嘅話，上面兩個「<= 上界」嘅斷言
  // 就係 vacuously true，等於冇測過。（實測寫呢個測試嗰陣就係噉，
  // 原因係 fixture 漏咗 SOFT_CHAIR_PREFER_DUAL，見上面 rules 嘅註釋。）
  const totalDual = scenarios.reduce(function (sum, s) { return sum + s.actualDualWeeks; }, 0);
  check('★★★★★ 全部情境合計真係排出過兼任週（否則上面兩個斷言係空殼）',
    totalDual > 0, '合計兼任週數：' + totalDual);

  const blockScenarios = scenarios.filter((s) => s.label.indexOf('block=true') !== -1);
  check('★★★ BLOCK 情境全部有跑到（唔係靜靜噉零個情境然後 vacuously 通過）',
    blockScenarios.length === scenarios.length / 2);
}

// =====================================================================
// 階段 A：候選池收窄與可行性判斷
// =====================================================================
console.log('\n=== A【核心】computePostAvailability_()：收窄用返生成器同一批 predicate ===');
{
  const dates = makeDates(4);
  const allDates = dates.map((d) => d.serviceDate);
  const post = makePost('ANNOUNCE', '報告', { requiredRoles: 'COMMITTEE' });

  const roleContext = {
    roles: [
      { personId: 'P9001', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' },
      // P9002 喺第 3 週先上任 → 只做得到後兩週
      { personId: 'P9002', roleCode: 'COMMITTEE', effectiveFrom: allDates[2], effectiveTo: '' },
      { personId: 'P9003', roleCode: 'DEACON', effectiveFrom: '', effectiveTo: '' }
    ],
    exclusions: [
      { personId: 'P9004', postId: 'ANNOUNCE', reason: '暫停', effectiveFrom: '', effectiveTo: '' }
    ],
    eligibleByPost: { ANNOUNCE: ['P9001', 'P9002', 'P9003', 'P9004', 'P9005'] }
  };
  const peopleById = { P9001: {}, P9002: {}, P9003: {}, P9004: {}, P9005: {} };
  // P9005 有 COMMITTEE 身分但第 1 週請假——用嚟驗 Unavailable 有被計入
  roleContext.roles.push({ personId: 'P9005', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' });
  const unavailable = [{
    personId: 'P9005', dateFrom: allDates[0], dateTo: allDates[0],
    appliesTo: 'ALL', postIds: [], status: 'ACTIVE'
  }];

  const avail = gas.computePostAvailability_(post, dates, roleContext, peopleById, unavailable);

  checkEqual('★★★★★ 候選池：只留低持有 COMMITTEE、又冇被排除嘅人',
    avail.pool, ['P9001', 'P9002', 'P9005']);
  check('★★★★ P9003（只有 DEACON）被剔走——身分唔啱', avail.pool.indexOf('P9003') === -1);
  check('★★★★ P9004（有生效中嘅個人排除）被剔走', avail.pool.indexOf('P9004') === -1);
  checkEqual('★★★★★ P9002 第 3 週先上任 → 只有 2 個主日可服侍',
    avail.byPerson.P9002.length, 2);
  checkEqual('★★★★ P9005 第 1 週請假 → 4 週入面得 3 週可服侍',
    avail.byPerson.P9005.length, 3);
  checkEqual('★★★★★ usableSlotCount ＝ 4 + 2 + 3 ＝ 9'
    + '（呢個係「本季最多填得到幾多格」嘅上界，捉得到「人數夠但個個都只得幾週」）',
    avail.usableSlotCount, 9);
}

console.log('\n=== A：usableSlotCount 捉得到「人數睇落夠、實際填唔滿」===');
{
  const dates = makeDates(10);
  const allDates = dates.map((d) => d.serviceDate);
  const post = makePost('ANNOUNCE', '報告', { requiredRoles: 'COMMITTEE' });

  // 5 個人，每人只做得到 1 週 → 池 5 人（睇落夠），但總容量只有 5 格，需要 10 格
  const roles = [];
  const eligible = [];
  const peopleById = {};
  for (let i = 1; i <= 5; i++) {
    const id = 'P90' + i;
    roles.push({ personId: id, roleCode: 'COMMITTEE', effectiveFrom: allDates[i - 1], effectiveTo: allDates[i - 1] });
    eligible.push(id);
    peopleById[id] = {};
  }
  const avail = gas.computePostAvailability_(post, dates,
    { roles: roles, exclusions: [], eligibleByPost: { ANNOUNCE: eligible } }, peopleById, []);

  checkEqual('★★★ 候選池 5 人（單睇人數會以為夠）', avail.pool.length, 5);
  checkEqual('★★★★★ 但可服侍格數總和只有 5，少於需要嘅 10 格'
    + '——單睇 poolCount 會過分樂觀，呢個就係加 usableSlotCount 嘅理由',
    avail.usableSlotCount, 5);
}

console.log('\n=== A：listApplicableDatesForPost_() 重用 getSkipReason_（唔會同生成器對唔上）===');
{
  const dates = makeDates(8);
  const rules = {
    HARD_COMMUNION_FIRST_SUNDAY: { RuleID: 'HARD_COMMUNION_FIRST_SUNDAY', Level: 'HARD', Enabled: 'TRUE' },
    HARD_NO_AUTO_PREACHER: { RuleID: 'HARD_NO_AUTO_PREACHER', Level: 'HARD', Enabled: 'TRUE' }
  };

  const weekly = gas.listApplicableDatesForPost_(makePost('CHAIR', '主席'), dates, {}, rules);
  checkEqual('★★★ 每週崗位 → 全部 8 週', weekly.length, 8);

  const communion = gas.listApplicableDatesForPost_(
    makePost('COMMUNION', '聖餐襄禮', { frequency: 'FIRST_SUNDAY' }), dates, {}, rules);
  const firstSundays = dates.filter((d) => d.isFirstSundayOfMonth).length;
  checkEqual('★★★★ 聖餐襄禮只計每月第一個主日（同生成器一致）',
    communion.length, firstSundays);
  check('★★★ 而且真係有揀走一部分（唔係全部都係第一主日令個斷言變空殼）',
    firstSundays > 0 && firstSundays < 8, '第一主日數：' + firstSundays);

  const skipped = gas.listApplicableDatesForPost_(
    makePost('WORSHIP', '領詩'), dates,
    { [dates[0].serviceDate]: { skipPostIds: ['WORSHIP'], lockPostIds: [] } }, rules);
  checkEqual('★★★★ 特別主日 SkipPostIDs 嗰一週會被扣走', skipped.length, 7);
}

console.log('\n=== A：ROLE_IMPACT_VERDICT 常數同判斷文字對得上 ===');
{
  check('★★★ 五種結論都有定義',
    !!gas.ROLE_IMPACT_VERDICT.IMPOSSIBLE && !!gas.ROLE_IMPACT_VERDICT.CLASH
    && !!gas.ROLE_IMPACT_VERDICT.CONSECUTIVE && !!gas.ROLE_IMPACT_VERDICT.OVERLOAD
    && !!gas.ROLE_IMPACT_VERDICT.OK);
  check('★★ 「必定完全排不到人」用字同任務描述一致',
    gas.ROLE_IMPACT_VERDICT.IMPOSSIBLE.indexOf('必定') === 0);
}

console.log('\n=== B2：天花板說明文字要講清楚「唔係排表錯誤、調高目標值唔會改善」===');
{
  const note = gas.buildChairAnnounceCeilingNote_({
    dualCount: 4, weeksBothPosts: 13, bound: 6, boundRatio: 6 / 13, target: 0.63
  });
  check('★★★★★ 明確講「不是排表錯誤」', note.indexOf('不是排表錯誤') !== -1, note);
  check('★★★★★ 明確講「調高目標值不會改善」', note.indexOf('調高目標值不會改善') !== -1, note);
  check('★★★★ 講得出成因係身分規則收窄候選池', note.indexOf('身分規則收窄') !== -1, note);
  check('★★★ 帶埋實際數字（幾多人雙重合資格）', note.indexOf('4 人') !== -1, note);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
