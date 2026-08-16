// 第十八輪批次階段 C：崗位動用率嘅**分母**要用收窄後嘅名單。
// 執行方式：node tests/manpower_usage_denominator.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個檔案鎖住嘅係「兩個工具要講同一件事」
// ─────────────────────────────────────────────────────────────────────
//
// 現象（同一季、同一時間，兩個工具講唔同數字）：
//   「身分規則影響預估」：報告 套用後 6 人、當值堂委 套用後 8 人
//   「軟規則實測量度」  ：報告 合資格 10 人、當值堂委 合資格 10 人
//
// 10 ＝ Eligibility 9 人 ＋ 聯集加入 1 人，即係**收窄之前**嘅候選池。
// 後果：動用率用錯分母（4/10 ＝ 40% 報「偏低」），實際應該係
// 4/6 ＝ 66.7% 同 4/8 ＝ 50.0%，兩個都唔應該報偏低——
// 本季 7 個「偏低」警告入面有 2 個係假警報。
//
// 核心斷言：**有身分要求嘅崗位，動用率嘅分母必須等於
// `computePostAvailability_()` 算出嘅套用後人數**——即係影響預估用嘅
// 同一個函式、同一個數字。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

// Diagnostics.gs：`diagRow_()`（buildSoftRuleMetricRows_ 會用到）
const gas = loadGasSource(
  FILES_FOR_GENERATOR.concat(['Verify.gs', 'Diagnostics.gs', 'RoleImpact.gs', 'SoftRuleMetrics.gs']));

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

// =====================================================================
// Fixture：重現 Ivan 見到嘅形狀（全部 P9xxx 假 ID）
//   報告   要 COMMITTEE  → Eligibility 9 人 ＋ 聯集 1 人 ＝ 10，收窄後 6
//   當值堂委 要 COMMITTEE,DEACON → 同樣 10，收窄後 8
//   司事   冇身分要求 → 收窄前後一樣
// =====================================================================
const WEEKS = 13;
const dates = [];
{
  let d = Date.UTC(2026, 9, 4);
  for (let i = 0; i < WEEKS; i++) {
    const iso = new Date(d).toISOString().slice(0, 10);
    dates.push({ serviceDateId: 'SD' + (i + 1), serviceDate: iso, weekIndex: i + 1, isFirstSundayOfMonth: i === 0 });
    d += 7 * 86400000;
  }
}

function makePost(postId, nameTC, requiredRoles) {
  return {
    postId: postId, postNameTC: nameTC, slotCount: 1, distinctWithinPost: true,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
    displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0,
    requiredRoles: requiredRoles || ''
  };
}

const POSTS = [
  makePost('ANNOUNCE', '報告', 'COMMITTEE'),
  makePost('DEACONDUTY', '當值堂委', 'COMMITTEE,DEACON'),
  makePost('USHER', '司事', '')
];

// P9001-P9006 有 COMMITTEE；P9007-P9008 有 DEACON；P9009-P9010 冇身分
const COMMITTEE = ['P9001', 'P9002', 'P9003', 'P9004', 'P9005', 'P9006'];
const DEACON = ['P9007', 'P9008'];
const NONE = ['P9009', 'P9010'];
const ALL = COMMITTEE.concat(DEACON, NONE);

const ROLES = COMMITTEE.map(function (id) {
  return { personId: id, roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' };
}).concat(DEACON.map(function (id) {
  return { personId: id, roleCode: 'DEACON', effectiveFrom: '', effectiveTo: '' };
}));

// 收窄前嘅候選池（＝ Eligibility ∪ 身分持有人）：三個崗位都係 10 人
const ELIGIBLE_BY_POST = {
  ANNOUNCE: ALL.slice(),
  DEACONDUTY: ALL.slice(),
  USHER: ALL.slice()
};

const PEOPLE_BY_ID = {};
ALL.forEach(function (id) { PEOPLE_BY_ID[id] = true; });

const ROLE_CONTEXT = { roles: ROLES, exclusions: [], eligibleByPost: ELIGIBLE_BY_POST };

/** 用影響預估嘅函式算出「套用後」人數。 */
function availabilityFor(post) {
  return gas.computePostAvailability_(post, dates, ROLE_CONTEXT, PEOPLE_BY_ID, []);
}

const AVAILABILITY = {};
POSTS.forEach(function (p) { AVAILABILITY[p.postId] = availabilityFor(p); });

console.log('\n=== 前置：fixture 真係重現到「收窄前 10、收窄後 6／8」呢個形狀 ===');
{
  checkEqual('★★★★ 報告：收窄前 10 人', ELIGIBLE_BY_POST.ANNOUNCE.length, 10);
  checkEqual('★★★★★ 報告：收窄後 6 人（只有 COMMITTEE）',
    AVAILABILITY.ANNOUNCE.pool.length, 6);
  checkEqual('★★★★ 當值堂委：收窄前 10 人', ELIGIBLE_BY_POST.DEACONDUTY.length, 10);
  checkEqual('★★★★★ 當值堂委：收窄後 8 人（COMMITTEE 或 DEACON）',
    AVAILABILITY.DEACONDUTY.pool.length, 8);
  checkEqual('★★★★ 司事（冇身分要求）：收窄前後都係 10 人',
    AVAILABILITY.USHER.pool.length, 10);
}

// 派工：三個崗位各用 4 個人（輪流）
const assignments = [];
dates.forEach(function (dt, i) {
  assignments.push({ serviceDate: dt.serviceDate, postId: 'ANNOUNCE', slotIndex: 1, personId: COMMITTEE[i % 4] });
  assignments.push({ serviceDate: dt.serviceDate, postId: 'DEACONDUTY', slotIndex: 1, personId: COMMITTEE.concat(DEACON)[i % 4] });
  assignments.push({ serviceDate: dt.serviceDate, postId: 'USHER', slotIndex: 1, personId: ALL[i % 4] });
});

console.log('\n=== C1【核心】分母改用收窄後名單 ===');
{
  const result = gas.computePostManpowerUsage_(
    assignments, POSTS, ELIGIBLE_BY_POST, 0.5, AVAILABILITY);
  const byPost = {};
  result.forEach(function (r) { byPost[r.postId] = r; });

  checkEqual('★★★★★ 報告：分母 6（唔係 10）', byPost.ANNOUNCE.eligibleCount, 6);
  checkEqual('★★★★★ 當值堂委：分母 8（唔係 10）', byPost.DEACONDUTY.eligibleCount, 8);
  checkEqual('★★★★ 司事（冇身分要求）：分母維持 10，行為完全冇變',
    byPost.USHER.eligibleCount, 10);

  checkEqual('★★★★★ 報告動用率 4/6 ＝ 66.7%（唔再係 4/10 ＝ 40%）',
    Math.round(byPost.ANNOUNCE.ratio * 1000) / 10, 66.7);
  checkEqual('★★★★★ 當值堂委動用率 4/8 ＝ 50.0%（唔再係 40%）',
    Math.round(byPost.DEACONDUTY.ratio * 1000) / 10, 50);
}

console.log('\n=== C1【核心】修正之後，兩個假警報消失 ===');
{
  // 門檻 0.5：舊行為 40% < 50% → 兩個都報「偏低」；
  // 新行為 66.7% 同 50.0% 都唔應該報偏低。
  const fixed = gas.computePostManpowerUsage_(
    assignments, POSTS, ELIGIBLE_BY_POST, 0.5, AVAILABILITY);
  const fixedByPost = {};
  fixed.forEach(function (r) { fixedByPost[r.postId] = r; });

  check('★★★★★ 報告唔再報「偏低」',
    fixedByPost.ANNOUNCE.judgement !== gas.SOFT_METRIC_JUDGEMENT.LOW,
    '判斷：' + fixedByPost.ANNOUNCE.judgement);
  check('★★★★★ 當值堂委唔再報「偏低」',
    fixedByPost.DEACONDUTY.judgement !== gas.SOFT_METRIC_JUDGEMENT.LOW,
    '判斷：' + fixedByPost.DEACONDUTY.judgement);

  // 反證：用舊行為（唔傳 availability）就會報偏低——證明呢兩個假警報真係
  // 由分母造成，唔係我改咗門檻或者其他嘢
  const old = gas.computePostManpowerUsage_(assignments, POSTS, ELIGIBLE_BY_POST, 0.5, undefined);
  const oldByPost = {};
  old.forEach(function (r) { oldByPost[r.postId] = r; });
  checkEqual('★★★★★ 反證：舊行為（分母用收窄前）→ 報告分母係 10',
    oldByPost.ANNOUNCE.eligibleCount, 10);
  check('★★★★★ 反證：舊行為下兩個崗位都報「偏低」（就係嗰兩個假警報）',
    oldByPost.ANNOUNCE.judgement === gas.SOFT_METRIC_JUDGEMENT.LOW
      && oldByPost.DEACONDUTY.judgement === gas.SOFT_METRIC_JUDGEMENT.LOW,
    '報告：' + oldByPost.ANNOUNCE.judgement + '　當值堂委：' + oldByPost.DEACONDUTY.judgement);
}

console.log('\n=== C3【核心】兩個工具講同一個數字（呢個就係最終要鎖住嘅嘢）===');
{
  const usage = gas.computePostManpowerUsage_(
    assignments, POSTS, ELIGIBLE_BY_POST, 0.5, AVAILABILITY);

  const mismatches = [];
  usage.forEach(function (u) {
    const post = POSTS.filter(function (p) { return p.postId === u.postId; })[0];
    // 影響預估算出嘅「套用後人數」
    const forecastCount = availabilityFor(post).pool.length;
    if (u.eligibleCount !== forecastCount) {
      mismatches.push(u.postId + '：量度 ' + u.eligibleCount + ' vs 影響預估 ' + forecastCount);
    }
  });
  checkEqual('★★★★★ 每一個崗位嘅動用率分母 === 影響預估算出嘅套用後人數'
    + '（兩個工具用同一個 computePostAvailability_，唔可能再分岔）',
    mismatches, []);

  // 特別再點名兩個有身分要求嘅（任務明確要求）
  const byPost = {};
  usage.forEach(function (r) { byPost[r.postId] = r; });
  checkEqual('★★★★★ 報告：量度分母 === 影響預估套用後人數',
    byPost.ANNOUNCE.eligibleCount, availabilityFor(POSTS[0]).pool.length);
  checkEqual('★★★★★ 當值堂委：量度分母 === 影響預估套用後人數',
    byPost.DEACONDUTY.eligibleCount, availabilityFor(POSTS[1]).pool.length);
}

console.log('\n=== C2：報告要同時顯示收窄前後兩個數字 ===');
{
  const usage = gas.computePostManpowerUsage_(
    assignments, POSTS, ELIGIBLE_BY_POST, 0.5, AVAILABILITY);
  const byPost = {};
  usage.forEach(function (r) { byPost[r.postId] = r; });

  checkEqual('★★★★ 有身分要求嘅崗位帶埋「套用前」人數',
    byPost.ANNOUNCE.eligibleCountBeforeRules, 10);
  check('★★★★ 而且標示咗「被身分規則收窄過」',
    byPost.ANNOUNCE.narrowedByRoleRules === true);
  check('★★★★ 冇收窄嘅崗位唔會加嗰句（避免噪音）',
    byPost.USHER.narrowedByRoleRules === false);

  // 實際渲染出嚟嘅文字
  const rows = gas.buildSoftRuleMetricRows_({
    quarterId: '2026T4', versionNo: 0,
    thresholds: { ratioTolerance: 0.05, countToleranceRatio: 0.2, postUsageMinRatio: 0.5 },
    weekCount: WEEKS, chairEq: null, chairEqBaseline: null, chairEqCeiling: null,
    chairEqJudgement: { gap: null, judgement: '—' },
    announce: null, announceBaseline: null, announceJudgement: { gap: null, judgement: '—' },
    distribution: { peopleCount: 10, average: 3, maxCount: 5, histogram: [] },
    peopleCountJudgement: { gap: null, judgement: '—' },
    averageJudgement: { gap: null, judgement: '—' },
    maxJudgement: { gap: null, judgement: '—' },
    consecutive: { count: 0, details: [] },
    manpower: usage,
    roleFocus: { applicable: false }
  });
  const usageRows = rows.filter(function (r) { return r.section.indexOf('崗位人手動用率') !== -1; });
  const announceRow = usageRows.filter(function (r) { return r.item.indexOf('報告') !== -1; })[0];

  check('★★★★★ 渲染文字同時見到「6 人」同「套用前 10 人」',
    announceRow && announceRow.value.indexOf('合資格 6 人') !== -1
      && announceRow.value.indexOf('套用前 10 人') !== -1,
    announceRow && announceRow.value);
  check('★★★★ 備註講明分母扣咗啲咩、同影響預估一致',
    announceRow && announceRow.note.indexOf('身分規則影響預估') !== -1,
    announceRow && announceRow.note);

  const usherRow = usageRows.filter(function (r) { return r.item.indexOf('司事') !== -1; })[0];
  check('★★★ 冇收窄嘅崗位唔會出現「套用前」字樣',
    usherRow && usherRow.value.indexOf('套用前') === -1, usherRow && usherRow.value);
}

console.log('\n=== 退化保護：算唔到收窄後名單時，要標明而唔係靜靜用錯數字 ===');
{
  const degraded = gas.computePostManpowerUsage_(assignments, POSTS, ELIGIBLE_BY_POST, 0.5, {});
  const byPost = {};
  degraded.forEach(function (r) { byPost[r.postId] = r; });
  check('★★★★ availability 係空物件時，narrowed=false（呼叫端可以標明）',
    byPost.ANNOUNCE.narrowed === false);
  checkEqual('★★★ 而且退回用收窄前嘅人數（唔會變 0 或者爆）',
    byPost.ANNOUNCE.eligibleCount, 10);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
