// 第三十輪批次階段 A3：**由端點入口叫落去**，唔係直接叫內部函式。
// 執行方式：node tests/api_endpoint_entry.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有呢一份
// ─────────────────────────────────────────────────────────────────────
//
// 實測：幹事撳掣 1「儲存並確認」一撳即爆
//
//   TypeError: Cannot read properties of undefined (reading 'forEach')
//     at findStateViolations_ (FineTune:278)
//     at buildSaveAndConfirmPlan_ (WebAppSaveConfirm:156)
//     at apiSaveAndConfirmPlan (WebAppSaveConfirm:44)
//
// 成因係一行 `findStateViolations_(context, resolved.state)`——參數次序調轉。
// 語法完全合法，114 個測試全綠。
//
// ⚠️ **點解一個都捉唔到：全部測試都直接叫內部函式**
//（`findStateViolations_(state, context)`，次序啱嘅），
// 冇一個由 `apiSaveAndConfirmPlan()` 呢個入口叫落去。
// 掣 1 係成套系統最核心嗰粒掣，由 Prompt B 寫出嚟到今日，
// **六輪之間冇一個測試行過佢**。
//
// 呢一份嘅做法：載入全部真程式碼，**只換走最外層嘅 IO**
//（讀試算表、讀 Config），然後**真係叫個端點**。
// 由端點到 IO 之間每一行都真正執行——包括參數次序。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'Roles.gs', 'RoleImpact.gs', 'HardViolationClass.gs',
  'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'WebAppGuards.gs', 'WebAppFlow.gs',
  'WebAppSaveConfirm.gs', 'WebAppRollback.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

/* ══════════════════════════════════════════════════════════════
 * 假資料（⚠️ 假 PersonID 一律 P9xxx，假名一律明顯係假）
 * ══════════════════════════════════════════════════════════════ */

const DATES = ['2027-10-03', '2027-10-10', '2027-10-17'];
const POSTS = [
  { postId: 'CHAIR', postNameTC: '主席', slotCount: 1, distinctWithinPost: false,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'WARN',
    mutexGroup: '', requiredRoles: '' },
  { postId: 'USHER', postNameTC: '司事', slotCount: 1, distinctWithinPost: false,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'WARN',
    mutexGroup: '', requiredRoles: '' }
];

function fakeState() {
  const out = [];
  DATES.forEach(function (d, i) {
    POSTS.forEach(function (p) {
      out.push({
        serviceDateId: 'SD' + i, serviceDate: d, postId: p.postId, slotIndex: 1,
        personId: i % 2 === 0 ? 'P9001' : 'P9002', isManual: false
      });
    });
  });
  return out;
}

function fakeContext() {
  return {
    quarterId: '2027T4', versionNo: 1,
    posts: POSTS,
    postNames: { CHAIR: '主席', USHER: '司事' },
    serviceDates: DATES.map(function (d, i) {
      return { serviceDateId: 'SD' + i, serviceDate: d, weekIndex: i + 1,
        isFirstSundayOfMonth: i === 0 };
    }),
    // 一條規則都唔開 ⇒ `findStateViolations_()` 會行足全程但回空陣列。
    // 呢一份測嘅係「有冇爆」，唔係「捉唔捉到違規」。
    rules: {},
    peopleById: { P9001: { nameTC: '測試甲' }, P9002: { nameTC: '測試乙' } },
    eligibility: { byPost: { CHAIR: ['P9001', 'P9002'], USHER: ['P9001', 'P9002'] } },
    // ⚠️ `roles` 同 `personPostExclusions` 兩個都係 `requireRoleContextField_()`
    // 逼住要有嘅——**漏咗會拋錯，唔會靜靜當成空**（第十八輪嘅設計）。
    // 呢一份測試特登唔繞過佢：一個真嘅 context 就係有呢兩個欄位。
    roles: { rows: [] },
    personPostExclusions: [],
    original: fakeState(),
    gridValues: {},
    gridRender: { labels: {} }
  };
}

/** 換走最外層 IO，令端點可以喺 Node 真正行一次。 */
function stubIo(overrides) {
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.getConfig = function (key, fallback) { return fallback; };
  gas.readConfig = function () { return {}; };
  gas.log_ = function () {};
  gas.getQuarterStage_ = function () { return gas.QUARTER_STAGE.REVIEW_SENT; };
  gas.findLatestVersionNo = function () { return 1; };
  gas.buildFineTuneContext_ = function () { return fakeContext(); };
  gas.resolveAuthoritativeState_ = function () {
    return { state: fakeState(), changes: [], unresolved: [] };
  };
  gas.planApplyRequests_ = function () {
    return { results: [], skippedIncompleteCount: 0, quarterId: '2027T4' };
  };
  gas.readSheet = function () { return []; };
  gas.readPostsNormalized = function () { return POSTS; };
  gas.buildSaveConfirmProposals_ = function () { return []; };
  Object.keys(overrides || {}).forEach(function (k) { gas[k] = overrides[k]; });
}

/* ══════════════════════════════════════════════════════════════
 * A3-1　apiSaveAndConfirmPlan()：由入口叫，真係行到底
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A3【核心】掣 1「儲存並確認」由端點入口行一次 ===');
{
  stubIo();
  let result = null;
  let thrown = null;
  try {
    result = gas.apiSaveAndConfirmPlan('2027T4');
  } catch (err) {
    thrown = err;
  }

  check('★★★★★ **唔會拋錯**'
    + '——實測撞到嗰個 `Cannot read properties of undefined (reading \'forEach\')`'
    + '就係喺呢條路上面爆',
    thrown === null, thrown && (thrown.message + '\n' + thrown.stack));
  check('★★★★★ 而且真係行到最尾（唔係中途 blocked）',
    result !== null && result.blocked === false,
    JSON.stringify(result && { blocked: result.blocked, reason: result.blockReason }));
  check('★★★★★ 規則檢查嗰一步有跑到（`violations` 四類齊全）'
    + '——呢個就係參數次序寫反嗰一行',
    result !== null && result.violations
    && Array.isArray(result.violations.real)
    && Array.isArray(result.violations.released)
    && Array.isArray(result.violations.structural)
    && Array.isArray(result.violations.semiHard),
    JSON.stringify(result && result.violations));
  check('★★★★ 零改動路徑判斷到（冇 grid 改動、冇申報）',
    result !== null && result.zeroChange === true);
  check('★★★★ `REVIEW_SENT` 零改動 ⇒ 只前進 Stage',
    result !== null && result.zeroChangeAction === 'ADVANCE_STAGE_ONLY');
}

console.log('\n=== A3 反面：把參數次序改返轉頭，呢一份要即刻着 ===');
{
  // ⚠️ 呢一段係整份測試嘅意義所在：證明佢真係捉得到嗰個 bug，
  // 而唔係一份「碰巧綠色」嘅測試。
  const realFind = gas.findStateViolations_;
  let sawSwapped = false;
  gas.findStateViolations_ = function (a, b) {
    // 模擬「呼叫端寫反咗」：第一個參數收到 context。
    if (!Array.isArray(a) && a && a.posts) sawSwapped = true;
    return realFind(a, b);
  };
  stubIo();
  let thrown = null;
  try { gas.apiSaveAndConfirmPlan('2027T4'); } catch (err) { thrown = err; }
  gas.findStateViolations_ = realFind;

  check('★★★★★ 現時傳落去嘅第 1 個參數係**陣列（state）**，唔係 context',
    sawSwapped === false && thrown === null,
    'sawSwapped=' + sawSwapped + ' thrown=' + (thrown && thrown.message));
}

/* ══════════════════════════════════════════════════════════════
 * A3-2　apiRollbackPlan()：同一條路，只係未撳過
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A3【核心】「回到上一個版本」預覽由端點入口行一次 ===');
{
  stubIo({
    findLatestVersionNo: function () { return 2; },
    readDashboardUnsavedState_: function () {
      return { hasAny: false, gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0 };
    },
    readVersionAssignmentsForGrid_: function (quarterId, versionNo) {
      const names = { P9001: '測試甲', P9002: '測試乙' };
      return fakeState().map(function (s) {
        // 第 1 版同第 2 版有一格唔同，令預覽有嘢可以列。
        const pid = (versionNo === 1 && s.postId === 'CHAIR' && s.serviceDate === DATES[0])
          ? 'P9002' : s.personId;
        // ⚠️ 逐格比對用嘅係 `personName`，唔係 `personId`——
        // 假資料漏咗呢個欄位就會變成「兩版一模一樣」，測試綠但乜都冇驗到。
        return Object.assign({}, s, { personId: pid, personName: names[pid] });
      });
    },
    buildFineTuneContext_: function () { return fakeContext(); },
    buildVersionBasisText_: function () { return '（測試）'; },
    readVersionRow_: function () { return null; }
  });

  let result = null;
  let thrown = null;
  try {
    result = gas.apiRollbackPlan('2027T4', 1);
  } catch (err) {
    thrown = err;
  }

  check('★★★★★ 唔會拋錯'
    + '——呢個端點嘅參數次序**一樣寫反咗**，只係冇人撳過所以未爆',
    thrown === null, thrown && (thrown.message + '\n' + thrown.stack));
  check('★★★★★ 真係行到最尾（唔係 blocked）',
    result !== null && result.blocked === false,
    JSON.stringify(result && { blocked: result.blocked, reason: result.blockReason }));
  check('★★★★★ 規則檢查跑到，而且**冇報「查不到」**'
    + '——`violationCheckFailed` 有值就代表嗰個 try/catch 食咗一個錯，'
    + '而畫面會顯示「檢查唔到」（比爆更難察覺）',
    result !== null && !result.violationCheckFailed,
    JSON.stringify(result && result.violationCheckFailed));
  check('★★★★ 逐格比對有結果（第 1 版同第 2 版有一格唔同）',
    result !== null && Array.isArray(result.cellChanges) && result.cellChanges.length === 1,
    JSON.stringify(result && result.cellChanges));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
