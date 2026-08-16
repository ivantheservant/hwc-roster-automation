// 第十六輪批次階段 C：教會新規則 4（堂委盡量集中喺四個指定崗位）嘅測試。
// 執行方式：node tests/role_post_focus.test.js
//
// 呢條係**軟規則**，所以測試嘅重點同硬規則完全唔同：
//   硬規則測「絕對唔會發生」；軟規則測「有得揀嘅時候會避開，冇得揀嘅時候
//   仍然排得出」——後者先係軟規則存在嘅理由，如果排唔出就應該做硬規則。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

// C3 嘅量度函式（measureRolePostFocus_）住喺 SoftRuleMetrics.gs，
// 唔喺預設嘅生成器檔案清單入面，所以要額外載入。
const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'SoftRuleMetrics.gs']));

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

// P001 假甲＝現任堂委；P004 假丁＝一般義工
const ROLES = [{ personId: 'P001', roleCode: 'COMMITTEE', effectiveFrom: '2026-01-01', effectiveTo: '' }];

/** 集中崗位：主席／報告／當值堂委／聖餐襄禮。USHER（司事）刻意唔喺入面。 */
const FOCUS_POSTS = 'CHAIR,ANNOUNCE,DUTY,COMMUNION';

function focusRule(strength, scope) {
  return {
    RuleID: 'SOFT_ROLE_POST_FOCUS',
    Level: 'SOFT',
    Enabled: 'TRUE',
    ScopePostIDs: scope === undefined ? FOCUS_POSTS : scope,
    TargetValue: strength,
    Priority: 50,
    ParamJSON: '{"roles":["COMMITTEE"]}'
  };
}

function buildContext(rules, extra) {
  return Object.assign({
    quarterId: '2026T3',
    serviceDates: [
      { serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true }
    ],
    posts: [{
      postId: 'USHER', postNameTC: '司事', slotCount: 1, distinctWithinPost: true,
      frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
      displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: ''
    }],
    eligibility: {
      byPost: { USHER: ['P001', 'P004'] },
      byPerson: {},
      // 刻意令**堂委 P001 嘅歷史次數遠高於 P004**——即係話「冇規則 4 嘅話，
      // 選人分數會偏向揀 P001」。噉樣下面嘅測試先證明得到：排到 P004
      // 係規則 4 扭轉咗結果，唔係本來就會揀 P004。
      historicalCount: { USHER: { P001: 30, P004: 1 } },
      explicitlyExcluded: {}
    },
    roles: ROLES,
    personPostExclusions: [],
    peopleById: {
      P001: { personId: 'P001', nameTC: '假甲', maxPerQuarter: null },
      P004: { personId: 'P004', nameTC: '假丁', maxPerQuarter: null }
    },
    unavailable: [], specialByDate: {},
    rules: rules,
    priorWeeks: {}, existingAssignments: {}, quotaByPerson: {},
    maxPerQuarterDefault: 8, selectionStrategy: 'LONGEST_UNSERVED',
    historicalWeight: 0.5, scoreWeights: { selectionWeight: 1, historicalWeight: 0.5, stalenessWeight: 1 },
    randomSeed: 42, scoreTieEpsilon: 0
  }, extra || {});
}

console.log('\n=== C1【核心】軟規則：有其他人選時避開堂委 ===');
{
  const withRule = gas.buildRoster_(buildContext({ SOFT_ROLE_POST_FOCUS: focusRule(5) }));
  checkEqual('★★★★★ 集中範圍以外嘅崗位（司事），有其他人選時排一般義工而唔係堂委',
    withRule.assignments[0].personId, 'P004');

  // 反證：關咗呢條規則，同一份資料會排到堂委 P001（因為佢歷史次數高好多，
  // 選人分數本來就偏向佢）——證明上面排到 P004 真係由規則 4 扭轉，
  // 唔係本來就會揀 P004 嘅空殼斷言。
  const withoutRule = gas.buildRoster_(buildContext({}));
  checkEqual('★★★★★ 反證：關咗規則 4，同一份資料排返堂委 P001（證明規則 4 真係扭轉咗結果）',
    withoutRule.assignments[0].personId, 'P001');
}

console.log('\n=== C1【核心】軟規則：冇其他人選時仍然排得出（呢個就係唔做硬規則嘅原因）===');
{
  const onlyCommittee = buildContext({ SOFT_ROLE_POST_FOCUS: focusRule(100) });
  onlyCommittee.eligibility.byPost.USHER = ['P001'];   // 池入面得堂委一個
  delete onlyCommittee.peopleById.P004;

  const result = gas.buildRoster_(onlyCommittee);
  checkEqual('★★★★★ 即使強度調到 100，冇其他人選時堂委仍然排得到（軟規則唔會令格子留空）',
    result.assignments[0].personId, 'P001');
}

console.log('\n=== C1：集中範圍**之內**嘅崗位唔會被扣分 ===');
{
  const inScope = buildContext({ SOFT_ROLE_POST_FOCUS: focusRule(5) });
  inScope.posts = [Object.assign({}, inScope.posts[0], { postId: 'CHAIR', postNameTC: '主席' })];
  inScope.eligibility.byPost = { CHAIR: ['P001', 'P004'] };
  inScope.eligibility.historicalCount = { CHAIR: { P001: 30, P004: 1 } };

  const result = gas.buildRoster_(inScope);
  checkEqual('★★★★ 主席（喺集中範圍內）照樣可以排堂委，唔會被規則 4 扣分',
    result.assignments[0].personId, 'P001');
}

console.log('\n=== C2：強度可配置（TargetValue 就係扣分倍率）===');
{
  const state = {
    context: {
      rules: { SOFT_ROLE_POST_FOCUS: focusRule(7) },
      roles: ROLES
    },
    post: { postId: 'USHER', postNameTC: '司事' },
    serviceDate: { serviceDate: '2026-07-05' }
  };
  const v = gas.evaluateRolePostFocus_('P001', state);
  check('★★★★ 產生違規物件', !!v);
  checkEqual('★★★★★ multiplier 直接等於 TargetValue（強度可調）', v.multiplier, 7);
  checkEqual('★★★ 級別係 SOFT（唔會令生成器排除呢個候選人）', v.level, 'SOFT');
  check('★★★ 訊息講明係軟規則、人手不足時仍可排（避免幹事誤會係 bug）',
    v.reason.indexOf('軟規則') !== -1, v.reason);

  const noStrength = gas.evaluateRolePostFocus_('P001', {
    context: { rules: { SOFT_ROLE_POST_FOCUS: focusRule('') }, roles: ROLES },
    post: { postId: 'USHER', postNameTC: '司事' },
    serviceDate: { serviceDate: '2026-07-05' }
  });
  checkEqual('★★★ TargetValue 留空時退回 1（唔會變成 0 或 NaN 令扣分失效）', noStrength.multiplier, 1);
}

console.log('\n=== C2：唔適用嘅情況一律回傳 null（唔會誤扣分）===');
{
  const base = {
    context: { rules: { SOFT_ROLE_POST_FOCUS: focusRule(5) }, roles: ROLES },
    post: { postId: 'USHER', postNameTC: '司事' },
    serviceDate: { serviceDate: '2026-07-05' }
  };
  check('★★★★ 唔係堂委嘅人 → null（規則 4 同佢無關）',
    gas.evaluateRolePostFocus_('P004', base) === null);
  check('★★★★ 規則未啟用 → null',
    gas.evaluateRolePostFocus_('P001', { context: { rules: {}, roles: ROLES }, post: base.post, serviceDate: base.serviceDate }) === null);
  check('★★★★★ ScopePostIDs 留空（設定未完成）→ null'
    + '——唔可以每格都扣分，否則排表結果會離奇噉偏',
    gas.evaluateRolePostFocus_('P001', {
      context: { rules: { SOFT_ROLE_POST_FOCUS: focusRule(5, '') }, roles: ROLES },
      post: base.post, serviceDate: base.serviceDate
    }) === null);
  check('★★★★ 堂委喺佢仲未上任嗰陣（生效日之前）→ null（同硬規則一樣睇主日當日）',
    gas.evaluateRolePostFocus_('P001', {
      context: base.context, post: base.post, serviceDate: { serviceDate: '2025-07-05' }
    }) === null);
}

console.log('\n=== readRoleFocusRoles_()：ParamJSON 解析與安全退回 ===');
{
  checkEqual('★★★ 正常解析', gas.readRoleFocusRoles_({ ParamJSON: '{"roles":["COMMITTEE","DEACON"]}' }),
    ['COMMITTEE', 'DEACON']);
  checkEqual('★★★ 留空 → 預設堂委', gas.readRoleFocusRoles_({ ParamJSON: '' }), ['COMMITTEE']);
  checkEqual('★★★★ JSON 打錯 → 退回預設值而唔係拋錯（唔可以令成個排表流程中斷）',
    gas.readRoleFocusRoles_({ ParamJSON: '{roles:[COMMITTEE' }), ['COMMITTEE']);
  checkEqual('★★★ roles 唔係陣列 → 退回預設值',
    gas.readRoleFocusRoles_({ ParamJSON: '{"roles":"COMMITTEE"}' }), ['COMMITTEE']);
  checkEqual('★★ 會轉大寫', gas.readRoleFocusRoles_({ ParamJSON: '{"roles":["committee"]}' }), ['COMMITTEE']);
}

console.log('\n=== C3【核心】量度：堂委喺集中崗位以外服侍咗幾多次 ===');
{
  const posts = [
    { postId: 'CHAIR', postNameTC: '主席' },
    { postId: 'ANNOUNCE', postNameTC: '報告' },
    { postId: 'USHER', postNameTC: '司事' },
    { postId: 'SOUND', postNameTC: '音響' }
  ];
  const assignments = [
    { serviceDate: '2026-07-05', postId: 'CHAIR', personId: 'P001' },      // 集中範圍內
    { serviceDate: '2026-07-12', postId: 'ANNOUNCE', personId: 'P001' },   // 集中範圍內
    { serviceDate: '2026-07-19', postId: 'USHER', personId: 'P001' },      // 範圍外
    { serviceDate: '2026-07-26', postId: 'SOUND', personId: 'P001' },      // 範圍外
    { serviceDate: '2026-07-05', postId: 'USHER', personId: 'P004' },      // 唔係堂委，唔計
    { serviceDate: '2025-07-05', postId: 'USHER', personId: 'P001' }       // 上任之前，唔計
  ];
  const m = gas.measureRolePostFocus_(assignments, posts, ROLES, ['COMMITTEE'], ['CHAIR', 'ANNOUNCE', 'DUTY', 'COMMUNION']);

  checkEqual('★★★★★ 集中範圍以外嘅次數', m.outsideCount, 2);
  checkEqual('★★★★ 集中範圍以內嘅次數', m.insideCount, 2);
  checkEqual('★★★★ 堂委本季總服侍次數（唔包一般義工、唔包上任之前）', m.totalCount, 4);
  checkEqual('★★★ 範圍外比例', m.outsideRatio, 0.5);
  checkEqual('★★★★ 逐崗位明細（按次數排序）',
    m.byPost.map((p) => p.postId + '=' + p.count), ['USHER=1', 'SOUND=1']);
  checkEqual('★★★★ 逐人明細只有 PersonID 冇姓名（報告會寫入 Diagnostics，唔應該帶姓名）',
    m.byPerson, [{ personId: 'P001', count: 2 }]);
  check('★★★ 崗位明細帶埋中文名，方便幹事睇',
    m.byPost[0].postNameTC === '司事', JSON.stringify(m.byPost[0]));
}

console.log('\n=== C3：設定未完成時，量度報告要講得出「無法計算」而唔係報 0 ===');
{
  const noScope = gas.measureRolePostFocus_([], [], ROLES, ['COMMITTEE'], []);
  checkEqual('★★★★ 冇設定集中崗位 → applicable=false（唔會報一個誤導性嘅 0）',
    noScope.applicable, false);
  const noRoles = gas.measureRolePostFocus_([], [], [], ['COMMITTEE'], ['CHAIR']);
  checkEqual('★★★★ Roles 工作表仲係空 → applicable=false', noRoles.applicable, false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
