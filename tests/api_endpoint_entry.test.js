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
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'Roles.gs', 'RoleImpact.gs', 'HardViolationClass.gs',
  'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'WebAppGuards.gs', 'WebAppFlow.gs',
  // 第三十二輪批次階段 D4：步驟 2 嘅端點 `apiStep2Preview()` 只係一層薄殼，
  // 真正做嘢嘅係 `FiveStageCore.gs` 嘅 `planStep2_()`／`executeStep2_()`。
  // 唔載入佢就會 `planStep2_ is not defined`——而嗰個錯**唔係**測試想證嘅嘢。
  // ⚠️ 第四十七輪批次 B 組：`planStep2_()` 而家行
  // `resolveActualRecipients_()`（`SendRecipients.gs`），
  // 而佢會叫 `buildMailContext_()`／`resolveStageTemplates_()`（`Mailer.gs`）
  // 同 `resolveSendOptions_()`（`SendOptions.gs`）。
  //
  // ⚠️ 呢個係**想要**嘅耦合：呢一組 bug 嘅本質就係
  //「事前講會寄給誰」同「實際寄給誰」有兩個算法。收埋一個之後，
  // 事前預覽自然要載入寄信嗰邊嘅嘢——載入清單長咗，
  // 但兩個數字唔會再各自漂走。
  'SendOptions.gs', 'MailRedirect.gs', 'SendRecipients.gs', 'Mailer.gs',
  'FiveStageCore.gs',
  // 第三十九輪批次（順手）：「同一格既有 grid 改動又有申報 ⇒ grid 贏」
  // 嗰個判斷本來喺兩個檔各寫一次，而家合併成 `findRequestGridOverlaps_()`
  //（RequestsApply.gs）。`buildSaveAndConfirmPlan_()` 會叫佢，
  // 唔載入就會 `findRequestGridOverlaps_ is not defined`——
  // 同上面 FiveStageCore 嗰個理由一模一樣。
  'RequestsApply.gs',
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

/* ══════════════════════════════════════════════════════════════
 * 第三十二輪批次階段 D4：**步驟 2 係五步入面唯一冇真入口測試嗰步**
 * ══════════════════════════════════════════════════════════════
 *
 * `tools/lint-entry-coverage.js` 掃出嚟嘅結果：
 *
 *   步驟 1 生成初稿　　`apiGenerateRoster`　　　✅（rollback_zero_version）
 *   步驟 2 寄給堂委　　`apiStep2Preview/Confirm`　❌ **冇**
 *   步驟 3 儲存並確認　`apiSaveAndConfirmPlan`　✅（呢一份上面）
 *   步驟 4 正式發出　　`apiStep4Confirm`　　　　✅（unsaved_changes_guard）
 *   步驟 5 改動後重發　`apiStep5Plan`　　　　　✅（resend_changed_persons）
 *
 * 所以只補呢一步，**唔為咗湊夠五個而重複寫**。
 */

console.log('\n=== D4【核心】步驟 2「寄給堂委審閱」由端點入口行一次 ===');
{
  // ⚠️ 第四十七輪批次 B1 組：`planStep2_()` 唔再叫
  // `countReviewerRecipients_()`——佢而家行 `resolveActualRecipients_()`，
  // 即係**真正會寄嗰一份名單**。所以呢度改為 stub 嗰一個。
  //
  // 呢個改動本身就係整組 B 嘅重點：事前預覽同真正寄出行同一個算法。
  stubIo({
    countAlreadySentForStage_: function () { return 0; },
    resolveActualRecipients_: function () {
      return [
        { type: 'LIST', personId: '', email: 'a@example.invalid',
          displayName: '堂委甲', sendAs: 'TO' },
        { type: 'LIST', personId: '', email: 'b@example.invalid',
          displayName: '堂委乙', sendAs: 'TO' },
        { type: 'PERSON', personId: 'P9001', email: 'c@example.invalid',
          displayName: '測試丙', sendAs: 'TO' },
        { type: 'PERSON', personId: 'P9002', email: '',
          displayName: '測試丁', sendAs: 'TO' }
      ];
    }
  });

  let result = null;
  let thrown = null;
  try {
    result = gas.apiStep2Preview('2027T4');
  } catch (err) {
    thrown = err;
  }

  check('★★★★★ **`apiStep2Preview()` 唔會拋錯**'
    + '——由端點到 IO 之間每一行都真正行過，包括 `requireQuarterStage_()`'
    + '同 `findLatestVersionNo()` 嘅回傳點樣被用',
    thrown === null, thrown && (thrown.message + '\n' + thrown.stack));
  check('★★★★★ 而且真係攞到收件人數同版本號',
    result !== null && result.recipientCount === 4 && result.versionNo === 1,
    JSON.stringify(result));
  check('★★★★★★ 第四十七輪批次 B3 組：**連名單一齊回**，唔淨係一個數字'
    + '——現場嗰句「會寄給這 3 位」一個名都冇，'
    + '幹事撳〔確定寄出〕之前核對唔到任何嘢',
    result !== null && result.recipientPreview
    && result.recipientPreview.total === 4
    && result.recipientPreview.shown.length === 4,
    JSON.stringify(result && result.recipientPreview));
  check('★★★★★ 電郵有遮一半，但仍然分得出邊個係邊個',
    result !== null
    && result.recipientPreview.shown[0].emailMasked.indexOf('@example.invalid') !== -1
    && result.recipientPreview.shown[0].emailMasked.indexOf('a@') === -1,
    JSON.stringify(result && result.recipientPreview.shown[0]));
  check('★★★★★ 查唔到電郵嗰個要標出嚟（佢會被略過，而個數字照計佢）',
    result !== null && result.recipientPreview.shown[3].hasEmail === false,
    JSON.stringify(result && result.recipientPreview.shown[3]));
  check('★★★★ `isDryRun` 有講（呢個欄位決定確認畫面寫「會唔會真係寄」）',
    result !== null && typeof result.isDryRun === 'boolean', JSON.stringify(result));
}

console.log('\n=== D4 步驟 2 嘅 Stage 閘門由入口叫都要生效 ===');
{
  // ⚠️ 第二十五輪把步驟 2 放寬到三個 Stage。`OFFICIAL_SENT` 唔喺入面——
  // 一季已經正式發出咗之後，唔應該再「寄審閱本」。
  stubIo({
    countReviewerRecipients_: function () { return 4; },
    countAlreadySentForStage_: function () { return 0; },
    getQuarterStage_: function () { return gas.QUARTER_STAGE.OFFICIAL_SENT; }
  });
  let thrown = null;
  try { gas.apiStep2Preview('2027T4'); } catch (err) { thrown = err; }
  check('★★★★★ `OFFICIAL_SENT` ⇒ 由入口叫都會被擋'
    + '——閘門唔可以只喺內部函式生效',
    thrown !== null, '完全冇拋錯');
  check('★★★★ 而且訊息講得出係邊一步同而家係咩 Stage',
    thrown !== null && thrown.message.indexOf('步驟 2') !== -1
    && thrown.message.indexOf('OFFICIAL_SENT') !== -1, thrown && thrown.message);
}

console.log('\n=== D4 步驟 2 冇版本 ⇒ 要講「請先生成初稿」，唔可以靜靜過 ===');
{
  stubIo({
    countReviewerRecipients_: function () { return 4; },
    countAlreadySentForStage_: function () { return 0; },
    findLatestVersionNo: function () { return -1; }
  });
  let thrown = null;
  try { gas.apiStep2Preview('2027T4'); } catch (err) { thrown = err; }
  check('★★★★★ 冇版本 ⇒ 拋錯'
    + '——`-1` 係「冇版本」嘅記號，唔可以被當成一個版本號用落去',
    thrown !== null, '完全冇拋錯');
  check('★★★★★ 而且明確叫人去撳「步驟 1：生成初稿」',
    thrown !== null && thrown.message.indexOf('生成初稿') !== -1,
    thrown && thrown.message);
}

console.log('\n=== D4 步驟 2 執行前一定要行埋兩道前置檢查 ===');
{
  // 掣 2 永不改動職事表內容，所以有未儲存改動時一律拒絕；
  // 冇公開連結亦唔應該寄（堂委收到嘅信入面嗰條連結會係死嘅）。
  let calledUnsaved = 0;
  let calledPublicLink = 0;
  let calledExecute = 0;
  stubIo({
    assertNoUnsavedChanges_: function () { calledUnsaved++; },
    assertPublicLinkReady_: function () { calledPublicLink++; },
    executeStep2_: function () {
      calledExecute++;
      return { isDryRun: true, sent: 0, dryRun: 4, skipped: 0, failed: 0, errorPdf: 0 };
    }
  });

  const out = gas.apiStep2Confirm('2027T4');
  check('★★★★★ `assertNoUnsavedChanges_()` 有被叫'
    + '——冇呢道檢查，堂委會收到一條指向舊版本嘅連結，'
    + '而幹事以為佢哋睇緊啱啱改完嗰版',
    calledUnsaved === 1, String(calledUnsaved));
  check('★★★★★ `assertPublicLinkReady_()` 有被叫', calledPublicLink === 1,
    String(calledPublicLink));
  check('★★★★★ 而且真係行到 `executeStep2_()`', calledExecute === 1, String(calledExecute));
  check('★★★★ 回傳六個欄位齊全（前端靠佢哋砌完成畫面）',
    out && typeof out.isDryRun === 'boolean' && out.dryRun === 4
    && out.sent === 0 && out.skipped === 0 && out.failed === 0 && out.errorPdf === 0,
    JSON.stringify(out));
}

console.log('\n=== D4 反面：前置檢查拋錯 ⇒ 一定唔可以寄出去 ===');
{
  // ⚠️ 呢一段先係重點：證明個閘真係擋得住，唔係「叫咗但冇用」。
  let calledExecute = 0;
  stubIo({
    assertNoUnsavedChanges_: function () { throw new Error('有未儲存的改動'); },
    assertPublicLinkReady_: function () {},
    executeStep2_: function () { calledExecute++; return {}; }
  });
  let thrown = null;
  try { gas.apiStep2Confirm('2027T4'); } catch (err) { thrown = err; }
  check('★★★★★ 拋咗錯', thrown !== null);
  check('★★★★★ **而且一封信都冇寄**'
    + '——「檢查有叫到」同「檢查真係擋到」係兩件事，只測前者等於冇測',
    calledExecute === 0, String(calledExecute));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
