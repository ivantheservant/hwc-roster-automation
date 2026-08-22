// 第五十三輪批次 A 組：S03 揀格嘅次序反咗，一條真嘅紅擋住九條。
// 執行方式：node tests/selftest_safe_cell_pick.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 第五十二輪修好之後，自測機推進到 6 綠 1 紅 9 被擋住。
// S05 每次都紅，Ivan 撳咗三次「只重跑紅色情境」，三份報告一字不差：
//
//     執行時拋錯：發生了什麼：有 1 格違反了一定要遵守的規則，
//     需要你打字放行才能儲存。
//     現在的情況：職事表沒有任何改動，第 0 版仍然是最新一版。
//
// ⚠️⚠️ **這一次系統一次都沒有做錯。**
//
// S03 寫進去的名字系統認得出（第五十一輪 A 組已修），
// 但那個人在該崗位的 `Eligibility` 上不合資格，
// 所以「儲存並確認」要求打字放行。**這是硬規則，攔得對。**
//
// ─────────────────────────────────────────────────────────────────────
// 成因：次序反了
// ─────────────────────────────────────────────────────────────────────
//
// 舊 `selfTestPickCells_()`：
//     由 `RosterAssignments` 順住揀頭三格有人的 → 揀完才去找替代人選
//   ⇒ 揀了一格之後才發現「這個崗位只有一個合資格的人」
//   ⇒ 被迫揀一個不合資格的
//
// 正確次序：**先問「有沒有合資格的替代人選」，有才揀那一格。**
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 這一份用真的 `findStateViolations_()`
// ═════════════════════════════════════════════════════════════════════
//
// 揀格那一支不自己判斷「合不合資格」——它問系統本身那一支：
// 「換了人之後，有沒有**多了**一條違反？」
//
// 所以這一份載入真的 `FineTune.gs`，砌一個最小 context，
// 讓真的規則檢查跑。自己再寫一套判斷去驗，就是第三個算法。

const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const FILES = [
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'ArgShape.gs',
  'StateSource.gs', 'Roles.gs', 'Generator.gs', 'FineTune.gs', 'SelfTestRunner.gs'
];

/**
 * 造一個最小但**真**的 context，讓真的 `findStateViolations_()` 跑得起來。
 *
 * 三個主日 × 兩個崗位。`byPost` 決定邊個合資格。
 *
 * @param {Object} gas 沙箱
 * @param {Object} byPost `{postId: [personId, ...]}`
 * @param {Array} state 派工狀態
 * @returns {Object} context
 */
function makeContext(gas, byPost, state, opts) {
  const C = gas.COLUMNS.RULE_SETTINGS;
  const makeRule = function (id) {
    const r = {};
    r[C.RULE_ID] = id;
    r[C.ENABLED] = 'TRUE';
    r[C.LEVEL] = gas.RULE_LEVELS.HARD;
    return r;
  };

  const peopleById = {};
  ((opts && opts.people) || ['P1', 'P2', 'P3', 'P4', 'P5']).forEach(function (id) {
    peopleById[id] = { personId: id, nameTC: '假' + id, email: '', maxPerQuarter: null };
  });

  return {
    quarterId: '2028T3', versionNo: 0, timezone: 'Asia/Hong_Kong',
    original: state,
    gridValues: {},
    // ⚠️ `buildGridOverlayState_()` 要呢兩個欄位先肯做嘢——
    // 冇就拋錯，唔會靜靜噉當空。空 `gridValues` ＝ 冇人手改動。
    gridRender: { labels: {}, autoGenerateByPostId: { CHAIR: true, USHER: true } },
    serviceDates: ['2028-07-02', '2028-07-09', '2028-07-16'].map(function (d, i) {
      return { serviceDateId: 'D' + i, serviceDate: d, isFirstSundayOfMonth: i === 0 };
    }),
    posts: [
      { postId: 'CHAIR', postNameTC: '主席', autoGenerate: true, frequency: 'WEEKLY' },
      { postId: 'USHER', postNameTC: '司事', autoGenerate: true, frequency: 'WEEKLY' }
    ],
    eligibility: { byPost: byPost },
    // ⚠️ 兩個都係陣列——`undefined` 同 `{}` 都會拋錯（第十八輪嘅防線）。
    roles: [], personPostExclusions: [],
    peopleById: peopleById,
    // ⚠️ 開埋 `HARD_UNAVAILABLE`——呢條係驗「一個**合資格**但嘅
    // 候選人一樣可以撞到另一條規則」——而呢個正正係
    // 「揀完問系統有冇多咗違反」嘸一支存在嘅理由。
    unavailable: (opts && opts.unavailable) || [],
    rules: (function () {
      const r = {};
      r[gas.RULE_IDS.ELIGIBILITY] = makeRule(gas.RULE_IDS.ELIGIBILITY);
      r[gas.RULE_IDS.UNAVAILABLE] = makeRule(gas.RULE_IDS.UNAVAILABLE);
      return r;
    })(),
    maxMoves: 5, maxPerQuarterDefault: 8, warnOnSemiHard: false
  };
}

/** 一格派工。 */
function cell(dateIdx, postId, slotIndex, personId) {
  return {
    serviceDateId: 'D' + dateIdx,
    serviceDate: ['2028-07-02', '2028-07-09', '2028-07-16'][dateIdx],
    postId: postId, slotIndex: slotIndex, personId: personId, isManual: false
  };
}

/**
 * 跑一次 `selfTestPickSafeCells_()`，用真的規則檢查。
 *
 * @param {Object} opts `{byPost, state, howMany}`
 * @returns {Object} `{gas, picked, violationCalls}`
 */
function pick(opts) {
  const gas = loadGasSource(FILES);
  let violationCalls = 0;
  const realFind = gas.findStateViolations_;
  gas.findStateViolations_ = function (state, context) {
    violationCalls++;
    return realFind(state, context);
  };
  const context = makeContext(gas, opts.byPost, opts.state, opts);
  gas.buildFineTuneContext_ = function () { return context; };
  // ⚠️ **唔 stub `resolveAuthoritativeState_()`**——用真嗰支，
  // 佢會由 `context.original` 砌出 state。
  gas.readGridPersonIds_ = function () { return {}; };
  gas.log_ = function () {};
  // ⚠️ 呢一支**唔應該被叫到**。叫到就代表揀格嗰支冇用 context 嗰份
  // 增補過嘅名單，而規則檢查用嘅係增補過嗰份——即係兩個算法。
  let readEligibilityCalls = 0;
  gas.readEligibility = function () {
    readEligibilityCalls++;
    return { byPost: {}, byPerson: {}, historicalCount: {}, explicitlyExcluded: {} };
  };

  const picked = gas.selfTestPickSafeCells_('2028T3', 0, opts.howMany);
  return {
    gas: gas, picked: picked, violationCalls: violationCalls,
    readEligibilityCalls: readEligibilityCalls
  };
}

// =====================================================================
console.log('\n=== A1【核心】只有一個合資格的人 ⇒ 那一格不揀 ===');
{
  // CHAIR 只有 P1 合資格 ⇒ 三格 CHAIR 全部揀唔到替代人選。
  // USHER 有 P2 P3 ⇒ 揀得。
  const box = pick({
    byPost: { CHAIR: ['P1'], USHER: ['P2', 'P3'] },
    state: [
      cell(0, 'CHAIR', 1, 'P1'), cell(0, 'USHER', 1, 'P2'),
      cell(1, 'CHAIR', 1, 'P1'), cell(1, 'USHER', 1, 'P2'),
      cell(2, 'CHAIR', 1, 'P1'), cell(2, 'USHER', 1, 'P2')
    ],
    howMany: 3
  });

  checkEqual('★★★★★★ **一格 CHAIR 都冇揀**'
    + '——CHAIR 喺 Eligibility 上得 P1 一個，'
    + '揀咗就一定要用一個唔合資格嘅人，而「儲存並確認」會攔住',
    box.picked.cells.filter(function (c) { return c.postId === 'CHAIR'; }).length, 0);
  checkEqual('★★★★★★ 揀到嘅全部係 USHER', box.picked.cells.length, 3);
  check('★★★★★★ 而且每一格都帶住替代人選'
    + '——⚠️ 順手帶出嚟，唔好揀完格再查一次。'
    + '查兩次就有兩個答案，第四十六輪嗰個 3 vs 9 就係噉嚟',
    box.picked.cells.every(function (c) {
      return c.replacement && c.replacement.personId && c.replacement.name;
    }), JSON.stringify(box.picked.cells));
  check('★★★★★★ 替代人選唔會係現時嗰個人',
    box.picked.cells.every(function (c) {
      return c.replacement.personId !== c.personId;
    }), JSON.stringify(box.picked.cells));
  check('★★★★★ 而且要講得出點解揀唔到 CHAIR',
    box.picked.rejected.some(function (r) { return /CHAIR/.test(r); }),
    JSON.stringify(box.picked.rejected));
}

// =====================================================================
console.log('\n=== A1【核心】候選人合資格，但撞到另一條規則 ⇒ 一樣要跳過 ===');
{
  // ⚠️⚠️ 呢一條先係「問系統本身嗰一支」嘅真正理由。
  //
  // 只睇 `Eligibility` 嘅話，P3 合 CHAIR 資格，揀佢睇落完全冇問題。
  // 但 P3 喺 2028-07-02 請咗假——`HARD_UNAVAILABLE` 一樣係硬規則，
  // 一樣會要求打字放行，一樣會令 S05 拋錯。
  //
  // 自己寫一套「合唔合資格」嘅判斷就會揀中佢。
  const box = pick({
    people: ['P1', 'P2', 'P3'],
    byPost: { CHAIR: ['P1', 'P3'] },
    state: [cell(0, 'CHAIR', 1, 'P1'), cell(1, 'CHAIR', 1, 'P1')],
    unavailable: [{
      personId: 'P3', dateFrom: '2028-07-02', dateTo: '2028-07-02',
      appliesTo: 'ALL', postIds: []
    }],
    howMany: 2
  });

  checkEqual('★★★★★★ 2028-07-02 嗰一格唔揀'
    + '——唯一嘅候選人 P3 啱啱嗰一日請咗假。'
    + '只睇 Eligibility 嘅話佢完全合格，'
    + '但換咗之後會多咗一條硬規則違反',
    box.picked.cells.map(function (c) { return c.serviceDate; }).join('、'),
    '2028-07-09');
  checkEqual('★★★★★ 2028-07-09 嗰一格揀得，P3 嗰一日冇請假',
    box.picked.cells.length > 0 ? box.picked.cells[0].replacement.personId : '（冇）',
    'P3');
  check('★★★★★ 而且講得出 07-02 嗰一格為何揀唔到',
    box.picked.rejected.some(function (r) { return /2028-07-02/.test(r); }),
    JSON.stringify(box.picked.rejected));
}

// =====================================================================
console.log('\n=== A1【核心】三格唔可以全部落喺同一日 ===');
{
  // 同一日有三個 USHER slot。舊寫法會順住揀晒三個。
  const box = pick({
    byPost: { USHER: ['P2', 'P3'] },
    state: [
      cell(0, 'USHER', 1, 'P2'), cell(0, 'USHER', 2, 'P2'), cell(0, 'USHER', 3, 'P2'),
      cell(1, 'USHER', 1, 'P2'), cell(2, 'USHER', 1, 'P2')
    ],
    howMany: 3
  });
  const dates = box.picked.cells.map(function (c) { return c.serviceDate; });
  checkEqual('★★★★★★ 三格落喺三個唔同主日'
    + '——同一日改三格會順手撞到「同週司事1 ≠ 司事2」嗰類同週規則，'
    + '又係另一種雜訊',
    dates.sort().join('、'), '2028-07-02、2028-07-09、2028-07-16');
}

// =====================================================================
console.log('\n=== A1【核心】揀格嗰支問嘅係真嘅規則檢查 ===');
{
  const box = pick({
    byPost: { CHAIR: ['P1'], USHER: ['P2', 'P3'] },
    state: [cell(0, 'CHAIR', 1, 'P1'), cell(1, 'USHER', 1, 'P2')],
    howMany: 2
  });
  check('★★★★★★ 真係叫過 `findStateViolations_()`'
    + '——揀格嗰支唔自己判斷「合唔合資格」，佢問系統本身嗰一支。'
    + '自己再寫一套就係第二個算法',
    box.violationCalls >= 2, '叫咗 ' + box.violationCalls + ' 次');
  checkEqual('★★★★★★ **冇叫過 `readEligibility()`**'
    + '——`buildFineTuneContext_()` 會用身分名單增補候選池，'
    + '而規則檢查用嘅係增補後嗰份。用未增補嗰份就係同一件事兩個算法',
    box.readEligibilityCalls, 0);
}

// =====================================================================
console.log('\n=== A2 全季都揀唔到 ⇒ 空陣列，唔可以硬揀一個唔合資格嘅 ===');
{
  const box = pick({
    byPost: { CHAIR: ['P1'], USHER: ['P2'] },
    state: [cell(0, 'CHAIR', 1, 'P1'), cell(1, 'USHER', 1, 'P2')],
    howMany: 3
  });
  checkEqual('★★★★★★ **一格都唔揀**'
    + '——⚠️ 絕對唔可以用「揀一個唔合資格嘅人然後叫 S05 打字放行」去繞過。'
    + '噉做嘅話，S05 驗嘅就唔再係「正常儲存」，'
    + '而成條主流程都會喺一個帶住規則違反嘅版本上面跑',
    box.picked.cells.length, 0);
  checkEqual('★★★★★ 而且逐格講得出點解',
    box.picked.rejected.length, 2);
}

// =====================================================================
console.log('\n=== A2 揀唔夠 ⇒ 要講清楚，唔可以靜靜噉少咗一格 ===');
{
  const gas = loadGasSource(FILES);
  const short = gas.describeSafePickShortfall_(
    { cells: [{}, {}], rejected: ['2028-07-02　CHAIR（Eligibility 上這個崗位只有現在那一位）'],
      tries: 5, budgetHit: false }, 3);
  check('★★★★★★ 講得出「只找到 2 格」同埋點解'
    + '——唔講嘅話，S03 淨係報「找到 2 格」，而冇人知點解係 2 唔係 3',
    /只找到 2 格/.test(short) && /只有現在那一位/.test(short), short);
  checkEqual('★★★★★ 揀夠咗就一句都唔講',
    gas.describeSafePickShortfall_({ cells: [{}, {}, {}], rejected: [], tries: 3 }, 3), '');
  check('★★★★★ 試到上限就要講明「冇掃完整季」'
    + '——唔講嘅話，一句「只找到 1 格」會被當成「成季得一格」',
    /沒有掃完整季/.test(gas.describeSafePickShortfall_(
      { cells: [{}], rejected: [], tries: 60, budgetHit: true }, 3)), '');
}

// =====================================================================
console.log('\n=== A1 試嘅次數有上限——唔可以食光時間預算 ===');
{
  // ⚠️ 要真係試得郁先驗到個上限：30 個**合資格但成季請晒假**嘅候選人。
  // 每一個都要重算一次規則，每一次都被彈走。
  const many = ['P2'];
  for (let i = 0; i < 30; i++) many.push('Q' + i);
  const box = pick({
    people: many,
    byPost: { USHER: many },
    state: [cell(0, 'USHER', 1, 'P2'), cell(1, 'USHER', 1, 'P2'), cell(2, 'USHER', 1, 'P2')],
    unavailable: many.slice(1).map(function (id) {
      return { personId: id, dateFrom: '2028-01-01', dateTo: '2028-12-31',
        appliesTo: 'ALL', postIds: [] };
    }),
    howMany: 3
  });
  check('★★★★★★ 重算次數有上限'
    + '——第五十輪嗰個時間預算問題唔可以走回頭路：'
    + '一支掃到全季都唔停嘅揀格，會令 13 條情境又變成「未跑」',
    box.violationCalls <= 62, '叫咗 ' + box.violationCalls + ' 次');
}

// =====================================================================
console.log('\n=== A3 違反嘅身分證唔可以包 personId ===');
{
  const gas = loadGasSource(FILES);
  const key = gas.selfTestViolationKey_({
    ruleId: 'HARD_ELIGIBILITY', serviceDate: '2028-07-02',
    postId: 'CHAIR', slotIndex: 1, personId: 'P9'
  });
  check('★★★★★★ 唔包 `personId`'
    + '——包咗嘅話，一格本來就違反緊嘅嘢換咗個人之後會被當成「新違反」，'
    + '於是嗰一格永遠揀唔到。我哋要問嘅係「有冇**多咗**一個問題」',
    key.indexOf('P9') === -1, key);
  checkEqual('★★★★★ 而且分得開唔同格',
    key, 'HARD_ELIGIBILITY|2028-07-02|CHAIR|1');
}

// =====================================================================
console.log('\n=== A1 揀完之後寫入嗰支唔可以再查一次 ===');
{
  const gas = loadGasSource(FILES);
  let secondLookup = 0;
  gas.indexPeopleById_ = function () { return { P2: { nameTC: '假P2' } }; };
  gas.readEligibility = function () { return { byPost: {} }; };
  gas.selfTestPickReplacementName_ = function () {
    secondLookup++;
    return { name: '另一個答案', personId: 'PX', eligible: false };
  };
  const written = [];
  gas.selfTestWriteGridCell_ = function (q, v, d, p, sl, text) {
    written.push(d + '|' + p + '|' + text);
    return true;
  };
  const result = gas.selfTestWriteRealNames_('2028T3', 0, [{
    serviceDate: '2028-07-02', postId: 'USHER', slotIndex: 1, personId: 'P1',
    replacement: { personId: 'P2', name: '假P2' }
  }]);
  checkEqual('★★★★★★ **冇再查第二次**'
    + '——揀格嗰陣已經問過系統「換咗之後有冇多咗違反」，'
    + '呢度再查一次就會有第二個答案，可以推翻嗰個判斷',
    secondLookup, 0);
  checkEqual('★★★★★★ 寫入嘅係揀格嗰陣帶出嚟嗰個名',
    written.join('；'), '2028-07-02|USHER|假P2');
  checkEqual('★★★★★ 而且照樣數得到寫咗幾多格', result.written, 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
