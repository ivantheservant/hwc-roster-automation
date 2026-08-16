// 第十六輪批次階段 A／B：教會新規則 1／2／3（身分限制、個人崗位排除）的
// 行為測試。執行方式：node tests/role_hard_rules.test.js
//
// 測嘅係**真正嘅原始碼**（用 tests/helpers/gas_loader.js 載入 Roles.gs／
// Generator.gs／FineTune.gs），唔係另外抄一份邏輯——呢三條係硬規則，
// 「系統絕不自動違反硬規則」呢個保證嘅價值完全建立喺「測嘅係真正會跑嘅
// 嗰份程式碼」之上。
//
// 涵蓋範圍（每一項都對應任務嘅一個明確要求）：
//   B1  聯集而唔係交集：新任堂委冇 Eligibility 歷史一樣排得到報告
//   B1  但前任堂委有 Eligibility 歷史都排唔到（身分已經過期）
//   B1  幹事喺 Eligibility 明確寫 Eligible=FALSE 嘅覆寫權要保得住
//   B3  三條路徑（生成／步驟3-5重跑／核對）全部要捉得到違規
//   A3  生效日期：換屆之後舊季度唔會被追溯判定為違規
//   規則2 多身分 OR 語意（堂委或執事都得）
//   規則3 個人崗位排除，包括「日後解除」
//   安全網 RuleSettings 冇登記呢兩條規則時，級別唔可以跌做 SOFT

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource();

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
// 測試資料：全部虛構姓名、虛構 PersonID
//   P001 假甲：現任堂委（2026-01-01 起，未卸任）
//   P002 假乙：前任堂委（2020-01-01 至 2025-12-31 卸任）
//   P003 假丙：現任執事
//   P004 假丁：冇任何身分嘅一般義工
// =====================================================================
const ROLES = [
  { personId: 'P001', roleCode: 'COMMITTEE', effectiveFrom: '2026-01-01', effectiveTo: '' },
  { personId: 'P002', roleCode: 'COMMITTEE', effectiveFrom: '2020-01-01', effectiveTo: '2025-12-31' },
  { personId: 'P003', roleCode: 'DEACON', effectiveFrom: '2026-01-01', effectiveTo: '' }
];

console.log('\n=== A3【核心】isEffectiveOn_()：生效期間判斷（換屆之後舊季度唔會被追溯判違規）===');
{
  checkEqual('★★★ 在任期間之內 → true', gas.isEffectiveOn_('2026-01-01', '', '2026-06-01'), true);
  checkEqual('★★★★ 卸任之後 → false（今日睇，前任堂委唔再算堂委）',
    gas.isEffectiveOn_('2020-01-01', '2025-12-31', '2026-06-01'), false);
  checkEqual('★★★★ 但翻查卸任之前嘅舊季度 → true（呢個就係唔會追溯判違規嘅關鍵）',
    gas.isEffectiveOn_('2020-01-01', '2025-12-31', '2025-06-01'), true);
  checkEqual('★★★ 生效日之前 → false', gas.isEffectiveOn_('2026-01-01', '', '2025-12-31'), false);
  checkEqual('★★ 邊界：生效日當日 → true（包含）', gas.isEffectiveOn_('2026-01-01', '', '2026-01-01'), true);
  checkEqual('★★ 邊界：結束日當日 → true（包含）',
    gas.isEffectiveOn_('2020-01-01', '2025-12-31', '2025-12-31'), true);
  checkEqual('★★ 兩邊都留空 → 永遠有效', gas.isEffectiveOn_('', '', '2026-06-01'), true);
  checkEqual('★ 冇日期可以判斷 → false（唔會靜靜當有效）', gas.isEffectiveOn_('', '', ''), false);
}

console.log('\n=== 規則 1／2【核心】personHasAnyRoleOn_()：多身分係 OR 唔係 AND ===');
{
  checkEqual('★★★★ 現任堂委做「只准堂委」嘅崗位 → 符合',
    gas.personHasAnyRoleOn_(ROLES, 'P001', ['COMMITTEE'], '2026-06-01'), true);
  checkEqual('★★★★ 前任堂委（已卸任）做同一個崗位 → 唔符合',
    gas.personHasAnyRoleOn_(ROLES, 'P002', ['COMMITTEE'], '2026-06-01'), false);
  checkEqual('★★★★ 但前任堂委喺佢仲在任嗰季 → 符合（唔會追溯判違規）',
    gas.personHasAnyRoleOn_(ROLES, 'P002', ['COMMITTEE'], '2025-06-01'), true);
  checkEqual('★★★ 執事做「堂委或執事」嘅崗位 → 符合（OR 語意，規則 2）',
    gas.personHasAnyRoleOn_(ROLES, 'P003', ['COMMITTEE', 'DEACON'], '2026-06-01'), true);
  checkEqual('★★★★ 但執事做「只准堂委」嘅崗位 → 唔符合（證明真係 OR 唔係「有身分就得」）',
    gas.personHasAnyRoleOn_(ROLES, 'P003', ['COMMITTEE'], '2026-06-01'), false);
  checkEqual('★★★ 完全冇身分嘅人 → 唔符合',
    gas.personHasAnyRoleOn_(ROLES, 'P004', ['COMMITTEE'], '2026-06-01'), false);
  checkEqual('★★★ 崗位冇身分要求（空陣列）→ 一律符合（其餘崗位行為完全不變）',
    gas.personHasAnyRoleOn_(ROLES, 'P004', [], '2026-06-01'), true);
}

console.log('\n=== 規則 3：findActivePersonPostExclusion_()（個人崗位排除，可日後解除）===');
{
  const EX = [
    { personId: 'P001', postId: 'CHAIR', reason: '暫時不擔任主席', effectiveFrom: '2026-01-01', effectiveTo: '' },
    { personId: 'P003', postId: 'CHAIR', reason: '不擔任主席', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' }
  ];
  check('★★★★ 生效中嘅排除 → 搵到',
    !!gas.findActivePersonPostExclusion_(EX, 'P001', 'CHAIR', '2026-06-01'));
  checkEqual('★★★ 排除訊息帶得返原因（違規訊息要講得出點解）',
    gas.findActivePersonPostExclusion_(EX, 'P001', 'CHAIR', '2026-06-01').reason, '暫時不擔任主席');
  check('★★★ 同一個人其他崗位 → 唔受影響',
    gas.findActivePersonPostExclusion_(EX, 'P001', 'ANNOUNCE', '2026-06-01') === null);
  check('★★★★ 已經解除（填咗解除日）→ 唔再排除（呢個就係「日後解除」嘅做法）',
    gas.findActivePersonPostExclusion_(EX, 'P003', 'CHAIR', '2026-06-01') === null);
  check('★★★ 但解除之前嗰段時間仍然算排除（歷史保留）',
    !!gas.findActivePersonPostExclusion_(EX, 'P003', 'CHAIR', '2026-02-01'));
}

console.log('\n=== B1【核心】buildRoleAugmentedEligibleByPost_()：聯集，唔係交集 ===');
{
  const posts = [
    { postId: 'ANNOUNCE', postNameTC: '報告', requiredRoles: 'COMMITTEE' },
    { postId: 'DUTY', postNameTC: '當值堂委', requiredRoles: 'COMMITTEE,DEACON' },
    { postId: 'USHER', postNameTC: '司事', requiredRoles: '' }
  ];
  // P001（新任堂委）刻意**唔喺** ANNOUNCE 嘅 Eligibility 名單入面，
  // 模擬「新任堂委從來未做過報告，所以冇歷史紀錄」。
  const eligibility = {
    byPost: { ANNOUNCE: ['P002'], DUTY: [], USHER: ['P004'] },
    explicitlyExcluded: {}
  };
  const augmented = gas.buildRoleAugmentedEligibleByPost_(eligibility, posts, ROLES);

  check('★★★★★ 新任堂委 P001 冇 Eligibility 歷史，一樣入到報告嘅候選池（如果用交集就會漏咗佢）',
    augmented.ANNOUNCE.indexOf('P001') !== -1, JSON.stringify(augmented.ANNOUNCE));
  check('★★★ 原本喺名單嘅 P002 冇被踢走（聯集唔會減少人）',
    augmented.ANNOUNCE.indexOf('P002') !== -1);
  check('★★★★ 當值堂委池同時有堂委 P001 同執事 P003（規則 2 嘅 OR）',
    augmented.DUTY.indexOf('P001') !== -1 && augmented.DUTY.indexOf('P003') !== -1,
    JSON.stringify(augmented.DUTY));
  check('★★★ 執事 P003 唔會被加入「只准堂委」嘅報告池',
    augmented.ANNOUNCE.indexOf('P003') === -1, JSON.stringify(augmented.ANNOUNCE));
  checkEqual('★★★★ 冇身分要求嘅崗位完全冇被改動（其餘崗位行為一格都唔變）',
    augmented.USHER, ['P004']);
}

console.log('\n=== B1【核心】幹事喺 Eligibility 明確寫 Eligible=FALSE 嘅覆寫權要保得住 ===');
{
  const posts = [{ postId: 'ANNOUNCE', postNameTC: '報告', requiredRoles: 'COMMITTEE' }];
  const eligibility = {
    byPost: { ANNOUNCE: [] },
    // 幹事明確寫低：即使 P001 係堂委，都唔好排佢做報告
    explicitlyExcluded: { ANNOUNCE: { P001: true } }
  };
  const augmented = gas.buildRoleAugmentedEligibleByPost_(eligibility, posts, ROLES);
  check('★★★★★ 明確 Eligible=FALSE 嘅人唔會因為有身分而被自動加返入池'
    + '（否則幹事寫落嘅否決會被身分規則靜靜推翻）',
    (augmented.ANNOUNCE || []).indexOf('P001') === -1, JSON.stringify(augmented.ANNOUNCE));
}

console.log('\n=== 安全網【核心】RuleSettings 冇登記呢兩條規則時，級別唔可以跌做 SOFT ===');
{
  // 呢個係本輪最危險嘅失敗方式：級別跌做 SOFT ⇒ 生成器唔會排除違規者
  // （pickPerson_ 只排除 level === HARD 嘅候選人）⇒ 唔係堂委嘅人照樣排到做報告。
  const emptyRules = {};
  const v1 = gas.makeViolation_(emptyRules, gas.RULE_IDS.ROLE_REQUIRED, '測試');
  const v2 = gas.makeViolation_(emptyRules, gas.RULE_IDS.PERSON_POST_EXCLUDED, '測試');
  checkEqual('★★★★★ HARD_ROLE_REQUIRED 冇登記時仍然係 HARD', v1.level, 'HARD');
  checkEqual('★★★★★ HARD_PERSON_POST_EXCLUDED 冇登記時仍然係 HARD', v2.level, 'HARD');

  const other = gas.makeViolation_(emptyRules, gas.RULE_IDS.MAX_PER_QUARTER, '測試');
  checkEqual('★★★ 其餘規則冇登記時維持原本行為（fallback 仍然係 SOFT，冇被本輪改動）',
    other.level, 'SOFT');

  checkEqual('★★★★ 兩條新規則冇登記時預設啟用（真正嘅開關喺資料本身）',
    [gas.isRuleEnabledAllowingDefault_(emptyRules, gas.RULE_IDS.ROLE_REQUIRED),
      gas.isRuleEnabledAllowingDefault_(emptyRules, gas.RULE_IDS.PERSON_POST_EXCLUDED)],
    [true, true]);
  checkEqual('★★★★ 但幹事明確寫 Enabled=FALSE 時一定要停用（保留人手覆寫權）',
    gas.isRuleEnabledAllowingDefault_(
      { HARD_ROLE_REQUIRED: { RuleID: 'HARD_ROLE_REQUIRED', Enabled: 'FALSE' } },
      gas.RULE_IDS.ROLE_REQUIRED),
    false);
  checkEqual('★★★ 其餘規則維持「冇登記＝停用」（isRuleEnabled_ 行為冇改）',
    gas.isRuleEnabled_(emptyRules, gas.RULE_IDS.MAX_PER_QUARTER), false);
}

// =====================================================================
// 路徑一：生成器（buildRoster_ → pickPerson_ → evaluateViolations_）
// =====================================================================
console.log('\n=== B3 路徑一【核心】生成器絕不自動違反身分硬規則 ===');
{
  function buildContext(overrides) {
    const posts = [
      {
        postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1, distinctWithinPost: true,
        frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
        displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0,
        requiredRoles: 'COMMITTEE'
      }
    ];
    const eligibility = {
      // 池入面刻意放晒四個人（包括前任堂委、執事、一般義工），
      // 只有 P001 係現任堂委——生成器一定要淨係揀到 P001。
      byPost: { ANNOUNCE: ['P001', 'P002', 'P003', 'P004'] },
      byPerson: {},
      historicalCount: { ANNOUNCE: { P001: 1, P002: 20, P003: 15, P004: 12 } },
      explicitlyExcluded: {}
    };
    return Object.assign({
      quarterId: '2026T3',
      serviceDates: [
        { serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true },
        { serviceDateId: 'SD2', serviceDate: '2026-07-12', weekIndex: 2, isFirstSundayOfMonth: false, autoGenerate: true }
      ],
      posts: posts,
      eligibility: eligibility,
      roles: ROLES,
      personPostExclusions: [],
      peopleById: {
        P001: { personId: 'P001', nameTC: '假甲', maxPerQuarter: null },
        P002: { personId: 'P002', nameTC: '假乙', maxPerQuarter: null },
        P003: { personId: 'P003', nameTC: '假丙', maxPerQuarter: null },
        P004: { personId: 'P004', nameTC: '假丁', maxPerQuarter: null }
      },
      unavailable: [],
      specialByDate: {},
      rules: {},
      priorWeeks: {},
      existingAssignments: {},
      quotaByPerson: {},
      maxPerQuarterDefault: 8,
      selectionStrategy: 'LONGEST_UNSERVED',
      historicalWeight: 0.5,
      scoreWeights: { selectionWeight: 1, historicalWeight: 0.5, stalenessWeight: 1 },
      randomSeed: 42,
      scoreTieEpsilon: 0
    }, overrides || {});
  }

  const result = gas.buildRoster_(buildContext());
  const assigned = result.assignments.filter((a) => !!a.personId);

  check('★★★★★ 全部已派嘅報告格都係現任堂委 P001（前任堂委／執事／一般義工一個都冇被排到）',
    assigned.length > 0 && assigned.every((a) => a.personId === 'P001'),
    JSON.stringify(assigned.map((a) => a.serviceDate + '=' + a.personId)));

  // 反證：如果崗位冇身分要求，池入面其他人排得到——證明上面嗰個斷言
  // 真係由身分規則造成，唔係「無論點都只會揀 P001」嘅空殼。
  const noRequirement = buildContext();
  noRequirement.posts = [Object.assign({}, noRequirement.posts[0], { requiredRoles: '' })];
  const noReq = gas.buildRoster_(noRequirement);
  const noReqPeople = {};
  noReq.assignments.forEach((a) => { if (a.personId) noReqPeople[a.personId] = true; });
  check('★★★★ 反證：崗位冇身分要求時，池入面其他人排得到（證明上面嘅斷言真係由身分規則造成）',
    Object.keys(noReqPeople).some((id) => id !== 'P001'),
    '實際排到：' + JSON.stringify(Object.keys(noReqPeople)));

  // ⚠️ 實際操作陷阱：Posts.RequiredRoles 填咗，但 Roles 工作表仲係空——
  // 呢個崗位會**完全排唔到人**（冇人持有嗰個身分）。呢個係 Ivan 最容易
  // 踩到嘅次序問題（先填 RequiredRoles、後填名單），所以特登鎖住呢個行為，
  // 並且喺 collectRoleOverview_() 有專門嘅檢查會報「這個崗位會永遠排不到人」。
  const emptyRoster = gas.buildRoster_(buildContext({ roles: [] }));
  const emptyAssigned = emptyRoster.assignments.filter((a) => !!a.personId);
  checkEqual('★★★★★ 陷阱：RequiredRoles 填咗但 Roles 名單仲係空 → 該崗位全部留空'
    + '（唔會靜靜違規排一個人落去；「身分名單概況」會報告呢個情況）',
    emptyAssigned.length, 0);
}

console.log('\n=== B3 路徑一：全部候選人都唔符合身分時，留空而唔係硬排一個 ===');
{
  const context = {
    quarterId: '2026T3',
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true }],
    posts: [{
      postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1, distinctWithinPost: true,
      frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
      displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: 'COMMITTEE'
    }],
    // 池入面得執事同一般義工，一個現任堂委都冇
    eligibility: { byPost: { ANNOUNCE: ['P003', 'P004'] }, byPerson: {}, historicalCount: {}, explicitlyExcluded: {} },
    roles: ROLES,
    personPostExclusions: [],
    peopleById: {
      P003: { personId: 'P003', nameTC: '假丙', maxPerQuarter: null },
      P004: { personId: 'P004', nameTC: '假丁', maxPerQuarter: null }
    },
    unavailable: [], specialByDate: {}, rules: {}, priorWeeks: {}, existingAssignments: {},
    quotaByPerson: {}, maxPerQuarterDefault: 8, selectionStrategy: 'LONGEST_UNSERVED',
    historicalWeight: 0.5, scoreWeights: { selectionWeight: 1, historicalWeight: 0.5, stalenessWeight: 1 },
    randomSeed: 42, scoreTieEpsilon: 0
  };

  const result = gas.buildRoster_(context);
  const cell = result.assignments[0];
  checkEqual('★★★★★ 冇任何合資格身分嘅人時，格子留空（絕不為咗填滿而違反硬規則）', cell.personId, '');
  check('★★★ 留空原因講得出係身分規則（唔係一句含糊嘅「排唔到」）',
    result.warnings.some((w) => String(w.reason || '').indexOf('HARD_ROLE_REQUIRED') !== -1),
    JSON.stringify(result.warnings.map((w) => w.reason)));
}

console.log('\n=== B3 路徑一：規則 3（個人崗位排除）喺生成時生效 ===');
{
  function ctx(exclusions) {
    return {
      quarterId: '2026T3',
      serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true }],
      posts: [{
        postId: 'CHAIR', postNameTC: '主席', slotCount: 1, distinctWithinPost: true,
        frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
        displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: ''
      }],
      eligibility: { byPost: { CHAIR: ['P001', 'P004'] }, byPerson: {}, historicalCount: { CHAIR: { P001: 30, P004: 1 } }, explicitlyExcluded: {} },
      roles: ROLES,
      personPostExclusions: exclusions,
      peopleById: {
        P001: { personId: 'P001', nameTC: '假甲', maxPerQuarter: null },
        P004: { personId: 'P004', nameTC: '假丁', maxPerQuarter: null }
      },
      unavailable: [], specialByDate: {}, rules: {}, priorWeeks: {}, existingAssignments: {},
      quotaByPerson: {}, maxPerQuarterDefault: 8, selectionStrategy: 'LONGEST_UNSERVED',
      historicalWeight: 0.5, scoreWeights: { selectionWeight: 1, historicalWeight: 0.5, stalenessWeight: 1 },
      randomSeed: 42, scoreTieEpsilon: 0
    };
  }

  const excluded = gas.buildRoster_(ctx([
    { personId: 'P001', postId: 'CHAIR', reason: '暫時不擔任主席', effectiveFrom: '2026-01-01', effectiveTo: '' }
  ]));
  checkEqual('★★★★★ 被排除嘅人唔會被排到嗰個崗位', excluded.assignments[0].personId, 'P004');

  const lifted = gas.buildRoster_(ctx([
    // 同一條排除，但已經解除（解除日喺呢個主日之前）
    { personId: 'P001', postId: 'CHAIR', reason: '暫時不擔任主席', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }
  ]));
  checkEqual('★★★★ 解除之後同一個人排得返（證明「日後解除」真係得，唔係一世都排唔到）',
    lifted.assignments[0].personId, 'P001');
}

// =====================================================================
// 路徑二：步驟 3／5 重跑規則檢查（findStateViolations_）
// =====================================================================
console.log('\n=== B3 路徑二【核心】步驟 3／5 重跑規則檢查捉得到人手改動造成嘅違規 ===');
{
  const context = {
    posts: [
      { postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', allowConsecutive: 'ALLOW', distinctWithinPost: true },
      { postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
    ],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true }],
    eligibility: { byPost: { ANNOUNCE: ['P001', 'P002'], CHAIR: ['P001', 'P004'] }, explicitlyExcluded: {} },
    roles: ROLES,
    personPostExclusions: [
      { personId: 'P001', postId: 'CHAIR', reason: '暫時不擔任主席', effectiveFrom: '2026-01-01', effectiveTo: '' }
    ],
    unavailable: [],
    rules: {},
    peopleById: {},
    warnOnSemiHard: true,
    maxPerQuarterDefault: 8
  };

  // 模擬幹事喺 grid 人手打咗兩個違規安排
  const state = [
    { serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P002', isManual: true },
    { serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: 'CHAIR', slotIndex: 1, personId: 'P001', isManual: true }
  ];
  const violations = gas.findStateViolations_(state, context);

  const roleV = violations.filter((v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED);
  const exclV = violations.filter((v) => v.ruleId === gas.RULE_IDS.PERSON_POST_EXCLUDED);

  checkEqual('★★★★★ 捉到「前任堂委被人手排去做報告」（規則 1）', roleV.length, 1);
  checkEqual('★★★★ 呢項違規係 HARD（唔係 SOFT，會擋住步驟 4）', roleV[0] && roleV[0].severity, 'HARD');
  check('★★★ 違規訊息講得出違反邊一條（要求「堂委」）',
    roleV[0] && roleV[0].reason.indexOf('堂委') !== -1, roleV[0] && roleV[0].reason);
  checkEqual('★★★★★ 捉到「被明確排除嘅人被人手排去嗰個崗位」（規則 3）', exclV.length, 1);
  check('★★★ 排除違規訊息帶得返原因',
    exclV[0] && exclV[0].reason.indexOf('暫時不擔任主席') !== -1, exclV[0] && exclV[0].reason);

  // 反證：合規嘅安排唔應該報任何身分違規
  const cleanState = [
    { serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P001', isManual: true },
    { serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: 'CHAIR', slotIndex: 1, personId: 'P004', isManual: true }
  ];
  const cleanV = gas.findStateViolations_(cleanState, context).filter(
    (v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED || v.ruleId === gas.RULE_IDS.PERSON_POST_EXCLUDED);
  checkEqual('★★★★ 反證：完全合規嘅安排零身分違規（證明上面唔係「乜都當違規」）', cleanV.length, 0);
}

console.log('\n=== A3 跨路徑：換屆之後翻查舊季度，唔會被追溯判定為違規 ===');
{
  const context = {
    posts: [{ postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', allowConsecutive: 'ALLOW', distinctWithinPost: true }],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2025-06-01', weekIndex: 1, isFirstSundayOfMonth: true }],
    eligibility: { byPost: { ANNOUNCE: ['P002'] }, explicitlyExcluded: {} },
    roles: ROLES,          // P002 喺 2025-12-31 先卸任
    personPostExclusions: [],
    unavailable: [], rules: {}, peopleById: {}, warnOnSemiHard: true, maxPerQuarterDefault: 8
  };
  // 2025 年嗰季，P002 仲係堂委
  const oldSeason = gas.findStateViolations_(
    [{ serviceDateId: 'SD1', serviceDate: '2025-06-01', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P002', isManual: false }],
    context).filter((v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED);
  checkEqual('★★★★★ 舊季度（P002 仍在任）重新核對＝零違規'
    + '——呢個就係「換屆時填結束日、唔好刪除整行」嘅價值', oldSeason.length, 0);

  // 同一個人、同一個崗位，但係卸任之後嘅季度
  context.serviceDates = [{ serviceDateId: 'SD2', serviceDate: '2026-06-07', weekIndex: 1, isFirstSundayOfMonth: true }];
  const newSeason = gas.findStateViolations_(
    [{ serviceDateId: 'SD2', serviceDate: '2026-06-07', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P002', isManual: false }],
    context).filter((v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED);
  checkEqual('★★★★ 但新季度（已卸任）同一個安排＝違規', newSeason.length, 1);
}

console.log('\n=== 向後相容：未建立 Roles 工作表／未填 RequiredRoles 時，行為完全不變 ===');
{
  const context = {
    posts: [{ postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true }],
    eligibility: { byPost: { ANNOUNCE: ['P002', 'P004'] }, explicitlyExcluded: {} },
    roles: [],                 // 工作表未建立
    personPostExclusions: [],  // 工作表未建立
    unavailable: [], rules: {}, peopleById: {}, warnOnSemiHard: true, maxPerQuarterDefault: 8
  };
  const v = gas.findStateViolations_(
    [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P004', isManual: false }],
    context).filter((x) => x.ruleId === gas.RULE_IDS.ROLE_REQUIRED || x.ruleId === gas.RULE_IDS.PERSON_POST_EXCLUDED);
  checkEqual('★★★★★ 兩張新表都未建立時，零身分違規（舊環境 push 咗新版都唔會突然爆一堆錯）', v.length, 0);

  checkEqual('★★★ requiredRolesOfPost_() 對留空欄位回傳空陣列',
    gas.requiredRolesOfPost_({ requiredRoles: '' }), []);
  checkEqual('★★★ requiredRolesOfPost_() 對欄位完全唔存在（undefined）都唔會拋錯',
    gas.requiredRolesOfPost_({}), []);
  checkEqual('★★ requiredRolesOfPost_() 會 trim 同轉大寫（試算表打細楷都認得）',
    gas.requiredRolesOfPost_({ requiredRoles: ' committee , deacon ' }), ['COMMITTEE', 'DEACON']);
}

console.log('\n=== describeRoleCodes_()：違規訊息要講人話 ===');
{
  checkEqual('★★★ 單一身分', gas.describeRoleCodes_(['COMMITTEE']), '「堂委」');
  checkEqual('★★★ 多身分用「或」連接（反映 OR 語意）',
    gas.describeRoleCodes_(['COMMITTEE', 'DEACON']), '「堂委」或「執事」');
  checkEqual('★★ 認唔到嘅代號原樣顯示（打錯字要睇得到，唔好靜靜消失）',
    gas.describeRoleCodes_(['COMMITEE']), '「COMMITEE」');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
