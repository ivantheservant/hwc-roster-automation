// 第十七輪批次階段 E：**反方向**嘅向後相容測試。
// 執行方式：node tests/role_rules_isolation.test.js
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 重要發現：原本要求嘅斷言唔成立，而且**唔係 bug**
// ─────────────────────────────────────────────────────────────────────
//
// 本輪原本要求嘅斷言係：「設定身分規則之後，冇身分要求嗰啲崗位，
// 派工逐格完全一致」。實測**唔成立**——真實形狀嘅 fixture 入面，
// 六個中立崗位 78 格入面有 77 格變咗。
//
// 逐層追查之後確認**唔係 bug，係生成器設計上必然嘅結果**：
//
// 生成器嘅選人分數係**跨崗位共用**嘅。`state.quarterCount`（每人本季
// 累計次數）、`state.lastServed`（上次服侍日期→staleness）、
// `SOFT_PERSONAL_QUOTA`／`SOFT_QUARTER_DISTRIBUTION` 全部都係「一個人
// 喺**所有崗位**加埋做咗幾多次」。所以：
//
//   身分規則令報告改咗派另一批人
//     → 嗰批人嘅 quarterCount／lastServed 變咗
//       → 佢哋喺之後每一個崗位嘅選人分數都變咗
//         → 音響、司事、司數……跟住變
//
// 呢個**正正就係我哋想要嘅行為**：系統要平衡每個人嘅總負擔。如果中立
// 崗位完全唔受影響，就代表生成器冇做跨崗位負擔平衡——嗰個先係 bug。
//
// 所以呢個檔案改為鎖住三個**真正成立而且有意義**嘅隔離性質：
//   E1. 身分規則「一個人都冇加、一個人都冇剔」時，成張表逐格完全一致
//       ——呢個先係「規則程式碼本身冇副作用」嘅真正保證
//   E2. 中立崗位嘅**候選池**喺任何情況下都逐個 PersonID 完全一致
//   E3. 中立崗位喺任何情況下都**零身分違規**
//
// E1 一旦爆，代表身分規則碰咗唔應該碰嘅嘢（真 bug）。
// E2／E3 一旦爆，代表收窄邏輯漏到中立崗位度（真 bug）。
// 詳細記錄見 docs/系統範圍稽核.md 第十七輪批次階段 E。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

const gas = loadGasSource(FILES_FOR_GENERATOR);

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

const WEEKS = 13;
/** 冇身分要求嘅崗位——要證明「規則程式碼碰都冇碰過」嘅對象。 */
const NEUTRAL_POST_IDS = ['CHAIR', 'USHER', 'SOUND', 'PIANO', 'WORSHIP', 'COUNT'];

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

function makePost(postId, nameTC, order, overrides) {
  return Object.assign({
    postId: postId, postNameTC: nameTC, slotCount: 1, distinctWithinPost: true,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
    displayOrder: order, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: ''
  }, overrides || {});
}

/**
 * 造 context。
 * @param {string} mode
 *   'none'   ＝ 身分規則完全未設定
 *   'noop'   ＝ 身分名單啱啱好等於報告現有候選池（規則生效但一個人都冇加冇剔）
 *   'real'   ＝ 只有部分人有身分（真實形狀：規則會真正收窄候選池）
 */
function buildContext(mode) {
  const gated = mode !== 'none';
  const dates = makeDates(WEEKS);

  const posts = [
    makePost('CHAIR', '主席', 1),
    makePost('ANNOUNCE', '報告', 2, gated ? { requiredRoles: 'COMMITTEE' } : {}),
    makePost('USHER', '司事', 3, { slotCount: 2 }),
    makePost('SOUND', '音響', 4),
    makePost('PIANO', '司琴', 5),
    makePost('WORSHIP', '領詩', 6),
    makePost('COUNT', '司數', 7, { slotCount: 2 })
  ];

  const peopleById = {};
  const allIds = [];
  for (let i = 1; i <= 20; i++) {
    const id = 'P9' + (i < 10 ? '00' : '0') + i;
    allIds.push(id);
    peopleById[id] = { personId: id, nameTC: id, maxPerQuarter: null };
  }

  // 每個崗位嘅 Eligibility 名單刻意唔同（模擬真實情況），
  // 但**每次生成都用完全同一份**。
  const byPost = {};
  const historicalCount = {};
  posts.forEach(function (p, pi) {
    const pool = allIds.filter(function (_, i) { return (i + pi) % 3 !== 0; });
    byPost[p.postId] = pool;
    historicalCount[p.postId] = {};
    pool.forEach(function (id, i) { historicalCount[p.postId][id] = 5 + ((i * 7 + pi) % 20); });
  });

  let roles = [];
  if (mode === 'noop') {
    // 身分名單 ＝ 報告現有候選池，一個唔多一個唔少
    // ⇒ 聯集加唔到人、硬規則亦都剔唔走人 ⇒ 規則生效但完全冇效果
    roles = byPost.ANNOUNCE.map(function (id) {
      return { personId: id, roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' };
    });
  } else if (mode === 'real') {
    for (let i = 1; i <= 6; i++) {
      roles.push({ personId: 'P900' + i, roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' });
    }
  }

  const eligibility = {
    byPost: byPost, byPerson: {}, historicalCount: historicalCount, explicitlyExcluded: {}
  };
  if (gated) {
    // 同 buildGeneratorContext_() 做嘅嘢一樣
    eligibility.byPost = gas.buildRoleAugmentedEligibleByPost_(eligibility, posts, roles);
  }

  return {
    quarterId: '2027T2',
    serviceDates: dates,
    posts: posts,
    eligibility: eligibility,
    roles: roles,
    personPostExclusions: [],
    peopleById: peopleById,
    unavailable: [], specialByDate: {},
    rules: {
      SOFT_CHAIR_EQ_ANNOUNCE: {
        RuleID: 'SOFT_CHAIR_EQ_ANNOUNCE', Level: 'SOFT', Enabled: 'TRUE',
        ScopePostIDs: 'CHAIR,ANNOUNCE', TargetValue: 0.63, Tolerance: 0.1, Priority: 50
      },
      SEMI_NO_CONSECUTIVE: {
        RuleID: 'SEMI_NO_CONSECUTIVE', Level: 'SEMI_HARD', Enabled: 'TRUE', Priority: 20
      },
      HARD_DISTINCT_SLOT: {
        RuleID: 'HARD_DISTINCT_SLOT', Level: 'HARD', Enabled: 'TRUE', Priority: 10
      }
    },
    priorWeeks: {}, existingAssignments: {}, quotaByPerson: {},
    maxPerQuarterDefault: 99, selectionStrategy: 'LONGEST_UNSERVED',
    historicalWeight: 0.5,
    scoreWeights: { chairDualBonus: 30, preferenceBonus: 50, selectionWeight: 45 },
    randomSeed: 20270402, scoreTieEpsilon: 0
  };
}

function toCellMap(assignments) {
  const map = {};
  assignments.forEach(function (a) {
    map[a.serviceDate + '|' + a.postId + '|' + a.slotIndex] = a.personId || '';
  });
  return map;
}

const ctxNone = buildContext('none');
const ctxNoop = buildContext('noop');
const ctxReal = buildContext('real');

const cellsNone = toCellMap(gas.buildRoster_(buildContext('none')).assignments);
const cellsNoop = toCellMap(gas.buildRoster_(buildContext('noop')).assignments);
const cellsReal = toCellMap(gas.buildRoster_(buildContext('real')).assignments);

console.log('\n=== 前置：三次生成嘅格子集合完全一樣（否則之後嘅比對冇意義）===');
{
  const k = Object.keys(cellsNone).sort();
  check('★★★★ 三次生成都係同一批格子',
    JSON.stringify(k) === JSON.stringify(Object.keys(cellsNoop).sort())
    && JSON.stringify(k) === JSON.stringify(Object.keys(cellsReal).sort()));
  const filled = Object.keys(cellsNone).filter(function (x) { return cellsNone[x] !== ''; }).length;
  check('★★★ 真係有排到嘢（唔係全部空，令下面嘅比對變空殼）', filled > 50, '有人嘅格數：' + filled);
}

console.log('\n=== E1【核心】規則生效但零加零剔時，成張表逐格完全一致 ===');
{
  // 呢個先係「身分規則程式碼本身冇副作用」嘅真正保證：
  // `noop` 情境下規則確實有跑（RequiredRoles 有填、roles 有資料、
  // 硬規則逐格檢查過），只係一個人都冇加、一個人都冇剔。
  // 如果呢個都唔一致，代表規則程式碼碰咗唔應該碰嘅嘢——**真 bug**。
  let poolsSame = true;
  const poolDiffs = [];
  Object.keys(ctxNone.eligibility.byPost).forEach(function (p) {
    if (JSON.stringify(ctxNone.eligibility.byPost[p])
        !== JSON.stringify(ctxNoop.eligibility.byPost[p])) {
      poolsSame = false;
      poolDiffs.push(p);
    }
  });
  check('★★★★ 前置：noop 情境下全部候選池真係一模一樣（包括有身分要求嗰個）',
    poolsSame, '唔一致嘅崗位：' + JSON.stringify(poolDiffs));

  const diffs = [];
  Object.keys(cellsNone).forEach(function (key) {
    if (cellsNone[key] !== cellsNoop[key]) {
      diffs.push(key + '：' + (cellsNone[key] || '（空）') + ' → ' + (cellsNoop[key] || '（空）'));
    }
  });
  check('★★★★★ 成張表（' + Object.keys(cellsNone).length + ' 格）逐格完全一致'
    + '——身分規則零加零剔時對排表結果零影響',
    diffs.length === 0,
    '有 ' + diffs.length + ' 格唔一致：\n      ' + diffs.slice(0, 20).join('\n      '));
}

console.log('\n=== E2【核心】中立崗位嘅候選池：任何情況下都逐個 PersonID 完全一致 ===');
{
  // `buildRoleAugmentedEligibleByPost_()` 對冇 RequiredRoles 嘅崗位直接
  // `return`，所以呢個性質應該喺**任何**設定下都成立，包括真實設定。
  const diffs = [];
  NEUTRAL_POST_IDS.forEach(function (postId) {
    const base = JSON.stringify(ctxNone.eligibility.byPost[postId]);
    if (JSON.stringify(ctxNoop.eligibility.byPost[postId]) !== base) diffs.push(postId + '（noop）');
    if (JSON.stringify(ctxReal.eligibility.byPost[postId]) !== base) diffs.push(postId + '（real）');
  });
  checkEqual('★★★★★ 六個中立崗位嘅候選池，noop 同 real 兩種設定下都同「未設定」完全一樣',
    diffs, []);

  // 反證：有身分要求嗰個崗位喺 real 情境下**真係有變**
  check('★★★★ 反證：有身分要求嘅報告，候選池喺 real 情境下確實變咗'
    + '（否則上面嘅斷言證明唔到收窄邏輯有喺運作）',
    JSON.stringify(ctxReal.eligibility.byPost.ANNOUNCE)
      !== JSON.stringify(ctxNone.eligibility.byPost.ANNOUNCE));
}

console.log('\n=== E3【核心】中立崗位喺任何情況下都零身分違規 ===');
{
  const context = {
    posts: ctxReal.posts,
    serviceDates: ctxReal.serviceDates,
    eligibility: ctxReal.eligibility,
    roles: ctxReal.roles,
    personPostExclusions: [],
    unavailable: [], rules: {}, peopleById: {}, warnOnSemiHard: true, maxPerQuarterDefault: 99
  };

  // 把 real 情境嘅生成結果餵返去重跑檢查，睇中立崗位有冇被判違規
  const state = Object.keys(cellsReal).map(function (key) {
    const parts = key.split('|');
    return {
      serviceDateId: '', serviceDate: parts[0], postId: parts[1],
      slotIndex: Number(parts[2]), personId: cellsReal[key], isManual: false
    };
  }).filter(function (s) { return !!s.personId; });

  const violations = gas.findStateViolations_(state, context);
  const neutralRoleViolations = violations.filter(function (v) {
    return NEUTRAL_POST_IDS.indexOf(v.postId) !== -1
      && (v.ruleId === gas.RULE_IDS.ROLE_REQUIRED || v.ruleId === gas.RULE_IDS.PERSON_POST_EXCLUDED);
  });
  checkEqual('★★★★★ 中立崗位零身分違規（規則完全冇套用落去）',
    neutralRoleViolations.map(function (v) { return v.postId + '|' + v.ruleId; }), []);

  // 反證：整個 state 入面確實有跑過身分規則（唔係規則根本冇 enable）
  const gatedChecked = ctxReal.posts.filter(function (p) {
    return gas.requiredRolesOfPost_(p).length > 0;
  });
  check('★★★★ 反證：確實有崗位帶住身分要求（規則有喺度跑）', gatedChecked.length > 0);
}

console.log('\n=== E4：real 情境下，有身分要求嘅崗位真係只排到合資格嘅人 ===');
{
  const committee = {};
  for (let i = 1; i <= 6; i++) committee['P900' + i] = true;

  const bad = [];
  Object.keys(cellsReal).forEach(function (key) {
    const parts = key.split('|');
    if (parts[1] !== 'ANNOUNCE') return;
    const personId = cellsReal[key];
    if (personId && !committee[personId]) bad.push(key + '=' + personId);
  });
  checkEqual('★★★★★ 報告全部由持有 COMMITTEE 嘅人擔任', bad, []);
}

console.log('\n=== E5【記錄】中立崗位嘅派工確實會跟住變——呢個係跨崗位負擔平衡，唔係 bug ===');
{
  // 呢一節唔係「要求佢一致」，而係**明確記錄呢個耦合關係存在**，
  // 令日後有人見到中立崗位變咗嗰陣，喺呢度直接搵到解釋，唔使再查一次。
  let neutralChanged = 0;
  let neutralTotal = 0;
  Object.keys(cellsNone).forEach(function (key) {
    if (NEUTRAL_POST_IDS.indexOf(key.split('|')[1]) === -1) return;
    neutralTotal++;
    if (cellsNone[key] !== cellsReal[key]) neutralChanged++;
  });

  check('★★★★★ 真實設定下，中立崗位確實有格子變咗（' + neutralChanged + ' / ' + neutralTotal + ' 格）'
    + '——成因係生成器嘅 quarterCount／lastServed／選人分數係跨崗位共用嘅：'
    + '報告改咗派另一批人，嗰批人嘅累計次數同 staleness 就變咗，'
    + '之後每個崗位嘅選人分數都會跟住變。呢個係**負擔平衡應有嘅行為**，'
    + '如果中立崗位完全唔受影響，反而代表生成器冇做跨崗位平衡。',
    neutralChanged > 0,
    '一格都冇變——如果係噉，要反過來檢查生成器係咪冇做跨崗位負擔平衡');

  check('★★★ 而且中立崗位嘅「有冇人」格局大致維持（唔會忽然多咗一堆空格）',
    Object.keys(cellsReal).filter(function (k) {
      return NEUTRAL_POST_IDS.indexOf(k.split('|')[1]) !== -1 && cellsReal[k] === '';
    }).length
    === Object.keys(cellsNone).filter(function (k) {
      return NEUTRAL_POST_IDS.indexOf(k.split('|')[1]) !== -1 && cellsNone[k] === '';
    }).length);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
