// 第十八輪批次階段 A：「缺失被當成有意義嘅值」呢個 bug class 嘅回歸測試。
// 執行方式：node tests/role_context_required.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個檔案鎖住嘅係一個**真實發生過**嘅 bug
// ─────────────────────────────────────────────────────────────────────
//
// `Tune.gs` 嘅 `countHardViolations_()` 手砌 verifyContext，冇放
// `roles`／`personPostExclusions`。當時規則檢查寫嘅係 `context.roles || []`，
// 於是 `undefined` 被靜靜噉當成空陣列 ⇒ `personHasAnyRoleOn_([], ...)`
// 對每個人都 false ⇒ **每一格有身分要求嘅崗位都被當成違規**。
//
// 實際後果：參數掃描 12 組全部報「硬規則違反 26」（＝ 13 個報告格 ＋
// 13 個當值堂委格），12 行全部標成失敗色；而同一季真正生成出嚟嘅 v0
// 其實係 0 違反。兩個工具講緊完全相反嘅嘢。
//
// ⚠️ **52 個測試全部 PASS 都捉唔到呢個 bug**，因為冇一個測試會手砌
// 一個**唔完整**嘅 context——所有 fixture 都係完整嘅。呢個檔案就係補返
// 嗰個缺口：專門測「唔完整嘅 context 會點」。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs']));

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
/** 回傳拋出嘅 Error，冇拋就回傳 null。 */
function catchError(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

// =====================================================================
// A2 方向一：「呼叫者漏傳」一定要拋錯
// =====================================================================
console.log('\n=== A2【核心】方向一：欄位係 undefined（呼叫者漏傳）→ 一定拋錯 ===');
{
  const base = {
    posts: [], serviceDates: [], assignments: [],
    eligibility: { byPost: {} }, unavailable: []
  };

  const missingRoles = catchError(function () {
    gas.checkHardRuleViolations_(Object.assign({}, base, { personPostExclusions: [] }));
  });
  check('★★★★★ checkHardRuleViolations_ 缺 roles → 拋錯（呢個就係 Tune.gs 嗰個 bug）',
    missingRoles !== null);
  check('★★★★ 錯誤訊息講得出**漏咗邊個欄位**',
    missingRoles && missingRoles.message.indexOf('`roles`') !== -1, missingRoles && missingRoles.message);
  check('★★★★ 錯誤訊息講得出**邊個函式需要佢**',
    missingRoles && missingRoles.message.indexOf('checkHardRuleViolations_') !== -1);
  check('★★★★ 錯誤訊息講得出**點樣修**（去邊度攞）',
    missingRoles && missingRoles.message.indexOf('buildRoleContext_') !== -1);
  check('★★★ 錯誤訊息解釋咗「空陣列 vs undefined」點解唔同',
    missingRoles && missingRoles.message.indexOf('undefined') !== -1
      && missingRoles.message.indexOf('空陣列') !== -1);

  const missingExclusions = catchError(function () {
    gas.checkHardRuleViolations_(Object.assign({}, base, { roles: [] }));
  });
  check('★★★★★ 缺 personPostExclusions → 一樣拋錯',
    missingExclusions !== null);
  check('★★★★ 而且講得出係邊個欄位',
    missingExclusions && missingExclusions.message.indexOf('`personPostExclusions`') !== -1);
}

console.log('\n=== A2：null 同非陣列都要拋錯（唔可以只擋 undefined）===');
{
  const base = {
    posts: [], serviceDates: [], assignments: [],
    eligibility: { byPost: {} }, unavailable: [], personPostExclusions: []
  };
  check('★★★★ roles 係 null → 拋錯',
    catchError(function () { gas.checkHardRuleViolations_(Object.assign({}, base, { roles: null })); }) !== null);
  check('★★★★ roles 係物件（唔係陣列）→ 拋錯',
    catchError(function () { gas.checkHardRuleViolations_(Object.assign({}, base, { roles: {} })); }) !== null);
  check('★★★ roles 係字串 → 拋錯',
    catchError(function () { gas.checkHardRuleViolations_(Object.assign({}, base, { roles: '' })); }) !== null);
  check('★★★ context 本身係 undefined → 拋錯而唔係 TypeError',
    (function () {
      const e = catchError(function () { gas.checkHardRuleViolations_(undefined); });
      return e !== null && e.message.indexOf('缺少') !== -1;
    })());
}

// =====================================================================
// A2 方向二：合法嘅「真係冇資料」仍然要正常運作
// =====================================================================
console.log('\n=== A2【核心】方向二：空陣列（真係冇任何身分資料）→ 正常運作，唔可以爆 ===');
{
  // 呢個係第十六輪刻意支援嘅向後相容情境：`Roles` 工作表未建立，
  // `readRolesSafe_()` 回傳 `[]`。呢條路徑一定要繼續行得通。
  const context = {
    posts: [{ postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', distinctWithinPost: true }],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2027-05-02', weekIndex: 1, isFirstSundayOfMonth: true }],
    assignments: [{ serviceDate: '2027-05-02', postId: 'CHAIR', slotIndex: 1, personId: 'P9001', personName: '假甲' }],
    eligibility: { byPost: { CHAIR: ['P9001'] } },
    unavailable: [],
    roles: [],
    personPostExclusions: []
  };
  const err = catchError(function () { gas.checkHardRuleViolations_(context); });
  check('★★★★★ 空陣列唔會拋錯（Roles 工作表未建立係合法情境）', err === null, err && err.message);
  checkEqual('★★★★★ 而且結果係 0 違反（唔可以因為冇身分名單就當全部違規）',
    gas.checkHardRuleViolations_(context).total, 0);
}

// =====================================================================
// A4：用「2026T4 v0 形狀」嘅 fixture 斷言 countHardViolations_ 回傳 0
// =====================================================================
console.log('\n=== A4【核心】重現 bug：有身分要求嘅崗位 + 完整 context → 0 違反 ===');
{
  // 造一個同 2026T4 v0 **形狀**一樣嘅場景（全部 P9xxx 假 ID）：
  // 13 週、報告要 COMMITTEE、當值堂委要 COMMITTEE 或 DEACON，
  // 而實際派工全部都係合資格嘅人——即係「真正生成出嚟嘅乾淨結果」。
  const WEEKS = 13;
  const dates = [];
  let d = Date.UTC(2026, 9, 4);
  for (let i = 0; i < WEEKS; i++) {
    const iso = new Date(d).toISOString().slice(0, 10);
    dates.push({ serviceDateId: 'SD' + (i + 1), serviceDate: iso, weekIndex: i + 1, isFirstSundayOfMonth: i === 0 });
    d += 7 * 86400000;
  }

  const committee = ['P9001', 'P9002', 'P9003', 'P9004', 'P9005', 'P9006'];
  const deacon = ['P9007', 'P9008', 'P9009', 'P9010'];

  const roles = committee.map(function (id) {
    return { personId: id, roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' };
  }).concat(deacon.map(function (id) {
    return { personId: id, roleCode: 'DEACON', effectiveFrom: '', effectiveTo: '' };
  }));

  const posts = [
    { postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', distinctWithinPost: true },
    { postId: 'DEACON', postNameTC: '當值堂委', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE,DEACON', distinctWithinPost: true }
  ];

  // 派工：報告輪流用 6 個堂委；當值堂委輪流用 4 個執事。全部合資格。
  const assignments = [];
  dates.forEach(function (dt, i) {
    assignments.push({
      serviceDate: dt.serviceDate, postId: 'ANNOUNCE', slotIndex: 1,
      personId: committee[i % committee.length], personName: committee[i % committee.length]
    });
    assignments.push({
      serviceDate: dt.serviceDate, postId: 'DEACON', slotIndex: 1,
      personId: deacon[i % deacon.length], personName: deacon[i % deacon.length]
    });
  });

  const eligibility = {
    byPost: { ANNOUNCE: committee.slice(), DEACON: committee.concat(deacon) }
  };

  const fullContext = {
    posts: posts, serviceDates: dates, assignments: assignments,
    eligibility: eligibility, unavailable: [],
    roles: roles, personPostExclusions: []
  };

  const result = gas.checkHardRuleViolations_(fullContext);
  checkEqual('★★★★★ 完整 context ⇒ 0 項違反（同真正生成出嚟嘅 v0 一致）', result.total, 0);

  // ⚠️ 反證：呢個先係整個 bug 嘅核心——證明「當時嗰個 `|| []` 行為」
  // 真係會產生 26 項假違反。我哋唔可以再叫得到舊版程式碼，所以直接
  // 模擬佢：把 roles 換成空陣列（＝ `undefined || []` 嘅結果）。
  const asIfMissing = Object.assign({}, fullContext, { roles: [] });
  const brokenResult = gas.checkHardRuleViolations_(asIfMissing);
  checkEqual('★★★★★ 反證：roles 被當成空陣列時，會誤報 26 項違反'
    + '（13 個報告格 ＋ 13 個當值堂委格）——同 Ivan 喺參數掃描見到嘅數字一模一樣',
    brokenResult.total, 26);

  const roleGroup = brokenResult.groups.filter(function (g) { return g.label.indexOf('身分限制') !== -1; })[0];
  checkEqual('★★★★ 而且 26 項全部落喺「違反身分限制」呢一組',
    roleGroup && roleGroup.items.length, 26);

  // 而家個 guard 令呢種情況根本去唔到「靜靜算出 26」嗰一步
  check('★★★★★ 修正之後：真正嘅漏傳（undefined）會即刻拋錯，'
    + '唔會再靜靜噉算出 26 呢個睇落好合理嘅假數字',
    catchError(function () {
      const noRoles = Object.assign({}, fullContext);
      delete noRoles.roles;
      gas.checkHardRuleViolations_(noRoles);
    }) !== null);
}

// =====================================================================
// A3：其餘三條規則檢查路徑都要有同一個 guard
// =====================================================================
console.log('\n=== A3：三條規則檢查路徑都受 guard 保護 ===');
{
  // 路徑二：findStateViolations_（步驟 3／5 重跑）
  const ftContext = {
    posts: [{ postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', allowConsecutive: 'ALLOW', distinctWithinPost: true }],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-10-04', weekIndex: 1, isFirstSundayOfMonth: true }],
    eligibility: { byPost: { ANNOUNCE: ['P9001'] }, explicitlyExcluded: {} },
    unavailable: [], rules: {}, peopleById: {}, warnOnSemiHard: true, maxPerQuarterDefault: 8
    // 刻意唔放 roles／personPostExclusions
  };
  const state = [{ serviceDateId: 'SD1', serviceDate: '2026-10-04', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P9001', isManual: false }];
  const ftErr = catchError(function () { gas.findStateViolations_(state, ftContext); });
  check('★★★★★ findStateViolations_ 缺欄位 → 拋錯', ftErr !== null);
  check('★★★★ 訊息指名 findStateViolations_',
    ftErr && ftErr.message.indexOf('findStateViolations_') !== -1, ftErr && ftErr.message);

  // 補齊之後應該正常
  ftContext.roles = [{ personId: 'P9001', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' }];
  ftContext.personPostExclusions = [];
  const ftOk = catchError(function () { gas.findStateViolations_(state, ftContext); });
  check('★★★★ 補齊之後正常運作', ftOk === null, ftOk && ftOk.message);
  checkEqual('★★★★ 而且合資格嘅人係 0 違反',
    gas.findStateViolations_(state, ftContext)
      .filter(function (v) { return v.ruleId === gas.RULE_IDS.ROLE_REQUIRED; }).length, 0);

  // 路徑一：evaluateViolations_（生成器）
  const post = {
    postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1, distinctWithinPost: true,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
    displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: 'COMMITTEE'
  };
  const genState = {
    context: {
      rules: {}, peopleById: { P9001: {} }, unavailable: [], posts: [post],
      quotaByPerson: {}, maxPerQuarterDefault: 8, scoreWeights: {}
      // 刻意唔放 roles
    },
    post: post, slot: 1,
    serviceDate: { serviceDateId: 'SD1', serviceDate: '2026-10-04' },
    weekByPost: {}, weekByPerson: {}, previousWeek: {}, quarterCount: {}, lastServed: {},
    ratioState: { weeksCounted: 0, chairEqAnnounce: 0, announceConsecutive: 0, dualQualified: 0, dualAssigned: 0 }
  };
  const genErr = catchError(function () { gas.evaluateViolations_('P9001', genState); });
  check('★★★★★ evaluateViolations_ 缺欄位 → 拋錯', genErr !== null);
  check('★★★★ 訊息指名 evaluateViolations_',
    genErr && genErr.message.indexOf('evaluateViolations_') !== -1, genErr && genErr.message);
}

console.log('\n=== A3：共用 mock helper 已經明確填好兩個欄位（唔會再有測試漏傳）===');
{
  const ctx = mock.buildGeneratorContextMock({ weekCount: 2, peopleCount: 20 });
  check('★★★★ buildGeneratorContextMock() 有 roles 而且係陣列', Array.isArray(ctx.roles));
  check('★★★★ 有 personPostExclusions 而且係陣列', Array.isArray(ctx.personPostExclusions));
  check('★★★ 預設係空陣列（fixture 冇身分資料，係一個明確嘅宣告）',
    ctx.roles.length === 0 && ctx.personPostExclusions.length === 0);
  check('★★★ 而且可以由 options 傳入（想測身分規則嘅時候）',
    mock.buildGeneratorContextMock({
      weekCount: 2, peopleCount: 20,
      roles: [{ personId: 'P9001', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' }]
    }).roles.length === 1);
}

console.log('\n=== A1：Tune.gs 嘅 countHardViolations_ 而家有轉發兩個欄位 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Tune.gs'), 'utf8');
  const fnBody = src.slice(src.indexOf('function countHardViolations_'));
  check('★★★★★ verifyContext 有轉發 roles', fnBody.indexOf('roles: context.roles') !== -1);
  check('★★★★★ verifyContext 有轉發 personPostExclusions',
    fnBody.indexOf('personPostExclusions: context.personPostExclusions') !== -1);
  check('★★★ 而且冇另外讀一次工作表（唔應該出現 readRolesSafe_／buildRoleContext_）',
    fnBody.indexOf('readRolesSafe_') === -1 && fnBody.indexOf('buildRoleContext_(') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
