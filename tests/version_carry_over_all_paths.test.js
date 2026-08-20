// 第三十六輪批次 A／B／C：建立新版本時，冇被改動嘅嘢要完整搬過去。
// FIXTURE-OK: 檔內全部係喺斷言度**讀返**已經寫入嘅長表欄位
// （`cellOf(...)[A.ASSIGN_SOURCE]`），唔係手砌。
// 真正嘅資料一律由真入口產生：`apiGenerateDraftExecute()` ＋
// `apiSavePreacherTranslationEntry()`。
// 執行方式：node tests/version_carry_over_all_paths.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢個 class 燒過三次，每次都逃過測試
// ═════════════════════════════════════════════════════════════════════
//
// 第三十四輪甲5　`materialiseManualEdits_()` 丟 `ruleFlags`
// 　　　　　　　⇒ PDF 圖例把 79 格報成「系統未能安排」
// 第三十六輪 A　 `materialiseManualEdits_()` 丟 `personName`
// 　　　　　　　⇒ 講員一格變成「⚠ 未能安排」（**資料遺失**）
// 第三十六輪　　 `applyDecisions()` 兩樣都丟（第五條路，一直冇人查過）
//
// 每次嘅測試都只斷言「數量對」——273 格仍然係 273 格，所以三次都逃得過。
// **數量對而內容錯**先係呢幾輪反覆出現嘅形態。
//
// ⚠️ 呢一份用 `tests/helpers/version_carry_over.js` 逐格逐欄位比，
// 而且**五條建立版本嘅路全部都要過**。
//
// ─────────────────────────────────────────────────────────────────────
// 教訓：舊產物唔可以證明現在嘅碼
// ─────────────────────────────────────────────────────────────────────
//
// 第三十四輪甲5 嘅報告用「2027T2 v1 冇事」去推斷「`applyRequests_()` 冇事」。
// 但 2027T2 v1 係 2026-08-17 用**舊碼**建立嘅舊產物——佢只證明嗰一日嘅碼冇事。
// 所以呢一份每一條路都**用當下嘅碼即場建立一個新版本再睇**。

const { loadGasSource } = require('./helpers/gas_loader');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./helpers/mock_sheets_realistic');
const { diffUnchangedCells, auditCellClasses, snapshotVersion } = require('./helpers/version_carry_over');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).split('\n').slice(0, 8).join('\n      '));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs', 'Debug.gs', 'Tune.gs',
  'Verify.gs', 'SoftRuleMetrics.gs', 'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs', 'PreacherTranslationFill.gs',
  // 第三十八輪批次 D 組：路 5 要真入口 apiDetectChanges()
  'WebApp.gs'
]);

const Q = '2027T3';
const TZ = 'Pacific/Auckland';
const ss = new RealisticMockSpreadsheet();
// 資料驗證（Decision 欄嘅下拉選單）純粹係試算表 UI，冇任何邏輯——
// mock 嘅 Range 已經有 setDataValidation()，呢度只補返個 builder。
function dvBuilder() {
  const self = {
    requireValueInList: function () { return self; },
    setAllowInvalid: function () { return self; },
    setHelpText: function () { return self; },
    build: function () { return { _mock: 'dataValidation' }; }
  };
  return self;
}
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: dvBuilder
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'r36@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (d, tz, f) {
    if (f === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    if (f === 'yyyy-MM-dd HH:mm:ss') {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d) + ' 00:00:00';
    }
    return d.toISOString();
  },
  parseDate: function (s) { return new Date(String(s).slice(0, 10) + 'T00:00:00Z'); },
  computeDigest: function (a, i) {
    return Array.from(require('crypto').createHash('sha256').update(String(i)).digest());
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, sleep: function () {}
};
gas.log_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.assertWebAppRequestAllowed_ = function () {};
// `apiSavePreacherTranslationEntry()` 要嘅兩個 GAS-only 工具。
gas.nowTimestamp_ = function () { return '2026-08-20 16:48:18'; };
gas.applyTimestampFormat_ = function () {};
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };

/* ══════════════════════════════════════════════════════════════
 * Fixture：三種「曾經被丟失過」嘅格全部都要有
 *   ・非自動崗位 ＋ 自由文字　　　PREACH（AutoGenerate=FALSE）
 *   ・SKIPPED ＋ 有 skip 原因　　  PREACH 其餘幾格（HARD_NO_AUTO_PREACHER）
 *   ・「這一週不設」　　　　　　　COMMUNION（非首主日 ⇒ 結構性不適用）
 * ══════════════════════════════════════════════════════════════ */

const PEOPLE = { P9601: '測試甲01', P9602: '測試甲02', P9603: '測試甲03' };
const GUEST = '客席講員某某';
const DATES = [];
const C = gas.COLUMNS;
const S = gas.SHEETS;
const A = C.ROSTER_ASSIGNMENTS;

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 3,
      [C.QUARTERS.START_DATE]: '2027-07-04', [C.QUARTERS.END_DATE]: '2027-09-26',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  // 第三十七輪批次：照現場形狀——13 個主日 × 3 個非自動崗位 ＝ 39 格。
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2027, 6, 4 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    DATES.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['D'], [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID,
    C.SERVICE_DATES.SERVICE_DATE, C.SERVICE_DATES.WEEK_INDEX,
    C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    DATES.map(function (d, i) {
      return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
    }));

  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE,
    C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER,
    C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
    [['CHAIR', '主席', true], ['READ', '讀經', true],
      // ⚠️ 三個非自動崗位。中文名一定要啱——`findPreacherTranslationPostIds_()`
      // 係靠中文名認嘅（唔係靠 PostID）。
      ['PREACH', '講員', false], ['TRANSLATE', '翻譯', false], ['FLOWER', '獻花', false],
      ['COMMUNION', '聖餐襄禮', true]].map(function (p, i) {
      return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false,
        // COMMUNION 用 FIRST_SUNDAY ⇒ 非首主日嗰幾格會係「這一週不設」
        // （STRUCTURAL_NA）。三種曾經被丟失過嘅格之中嘅一種。
        [C.POSTS.FREQUENCY]: p[0] === 'COMMUNION' ? 'FIRST_SUNDAY' : 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: p[2], [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW',
        [C.POSTS.MUTEX_GROUP]: '', [C.POSTS.DISPLAY_ORDER]: i + 1,
        [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
    }));

  seedSheet(ss, S.NAME_MAPPING, ['N'], [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC,
    C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id],
        [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
    }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    elig.push(['CHAIR', id]); elig.push(['READ', id]); elig.push(['COMMUNION', id]);
  });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
    elig.map(function (p, i) {
      return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0],
        [C.ELIGIBILITY.PERSON_ID]: p[1], [C.ELIGIBILITY.ELIGIBLE]: true,
        [C.ELIGIBILITY.ACTIVE]: true };
    }));

  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL,
    C.RULE_SETTINGS.ENABLED, C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION,
    C.RULE_SETTINGS.PRIORITY],
    ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER', 'HARD_COMMUNION_FIRST_SUNDAY']
      .map(function (id) {
        return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
          [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
          [C.RULE_SETTINGS.PRIORITY]: 1 };
      }));

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS',
    // 第三十八輪批次 D 組：路 5 由真入口 apiDetectChanges() 寫提案入呢張表
    'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

// ⚠️ 第三十八輪批次 B 組：`setSnapshot()` 已經刪走。
// 佢只寫 `PersonNameSnapshot`、留低 `assignSource = SKIPPED`，
// 而真入口 `apiSavePreacherTranslationEntry()` 會同時寫 `MANUAL`——
// 即係佢砌出嚟嘅狀態**真實程式碼永遠唔會產生**。
// 連續兩輪嘅假綠燈就係噉嚟。而家一律用真入口填。

function setGrid(v, date, post, text) {
  const sh = ss.getSheetByName(gas.buildRosterSheetName_(Q, v));
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  let col = -1;
  for (let c = 0; c < keys.length; c++) if (String(keys[c] || '') === post + '#1') { col = c + 1; break; }
  if (col === -1) return false;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) === date) {
      sh.getRange(r, col).setValue(text); return true;
    }
  }
  return false;
}
function cellOf(v, date, post) {
  return gas.readSheet(S.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === v
      && gas.toDateString(r[A.SERVICE_DATE], TZ) === date && r[A.POST_ID] === post;
  });
}
const KEY = function (date, post) { return date + '|' + post + '|1'; };

/** 每一條路建立完新版本之後，一律行呢一套。 */
function assertCarriedOver(pathName, base, next, changedKeys) {
  const problems = diffUnchangedCells(gas, Q, base, next, changedKeys, TZ);
  checkEqual('★★★★★ [' + pathName + '] 冇被改動嘅格，五個欄位逐字相同'
    + '（serviceDateId／personId／personName／assignSource／ruleFlags）',
    problems, []);

  const audit = auditCellClasses(gas, Q, next, true);
  checkEqual('★★★★★ [' + pathName + '] 格子分類守門'
    + '（五個桶加起嚟 ＝ 總格數，而且「未能安排」≠ 總數 − 有派人）',
    audit.problems, []);
  return audit.counts;
}

/* ══════════════════════════════════════════════════════════════
 * 敘事
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 路 1／5：performRosterGeneration_()（生成初稿）===');
{
  const r = gas.apiGenerateDraftExecute(Q);
  check('★★★★ 生成成功', r.ok !== false, JSON.stringify(r).slice(0, 200));

  const audit = auditCellClasses(gas, Q, 0, true);
  checkEqual('★★★★★ v0 分類守門', audit.problems, []);
  checkEqual('★★★★ 78 格（13 主日 × 6 崗位）', audit.counts.total, 13 * 6);
  checkEqual('★★★★★ 39 格非自動崗位（13 主日 × 講員／翻譯／獻花）——照現場形狀',
    audit.counts.manualPending, 39);
  check('★★★★★ 三種「曾經被丟失過」嘅格 fixture 真係有：'
    + '待確認（講員）同不設（非首主日聖餐）',
    audit.counts.manualPending >= 4 && audit.counts.structuralNa >= 3,
    JSON.stringify(audit.counts));
  checkEqual('★★★★★ v0 「未能安排」＝ 0（基準線）', audit.counts.genuineGap, 0);

  // ─────────────────────────────────────────────────────────────────
  // ⚠️ 第三十七輪批次 B 組：**一定要用真入口填，唔可以手砌。**
  // ─────────────────────────────────────────────────────────────────
  //
  // 上一輪呢度用 `setSnapshot()` 手砌——只寫 `PersonNameSnapshot`，
  // 而 `assignSource` 留返 `SKIPPED`。但真正嘅入口
  // `apiSavePreacherTranslationEntry()` **同時會把 assignSource 寫成 MANUAL**。
  //
  // 即係 fixture 砌出嚟嗰個形狀，**真正嘅碼根本唔會產生**。
  // 而 `MANUAL` 正正就係令 `classifyGridCell_()` 跌落 GENUINE_GAP 嗰個值。
  // 所以上一輪嗰條共用斷言完全正常噉通過咗，而現場一撳就爆。
  //
  // 呢個係 bug class 第 6 條（測試冇由真入口叫落去）用喺**建立資料**嗰邊。
  check('（前置）用真入口 apiSavePreacherTranslationEntry() 填講員',
    gas.apiSavePreacherTranslationEntry(Q, DATES[0], 'PREACH', 1, GUEST) !== undefined);
  checkEqual('（前置）佢真係冇 PersonID（外請講員唔喺 NameMapping）',
    String(cellOf(0, DATES[0], 'PREACH')[A.PERSON_ID] || ''), '');
  checkEqual('★★★★★ （證據）真入口會把 assignSource 寫成 MANUAL'
    + '——上一輪 fixture 手砌嗰陣留咗 SKIPPED，所以斷言先會放行',
    String(cellOf(0, DATES[0], 'PREACH')[A.ASSIGN_SOURCE]), gas.ASSIGN_SOURCE.MANUAL);
  checkEqual('★★★★★ 而 ruleFlags 冇被清走（真入口唔會掂佢）',
    gas.splitList_(cellOf(0, DATES[0], 'PREACH')[A.RULE_FLAGS]), [gas.RULE_IDS.NO_AUTO_GENERATE]);

  const afterFill = auditCellClasses(gas, Q, 0, true);
  checkEqual('★★★★★ **填完之後，同一版嘅「未能安排」仍然係 0**'
    + '（現場就係喺呢一刻由 0 變 1——一格都未複製過）',
    afterFill.counts.genuineGap, 0);
  checkEqual('★★★★★ 而且嗰一格算「有人」（只有 ASSIGNED 會渲染人名，'
    + '判錯類 ＝ 個名喺 grid 同 PDF 上消失）',
    gas.classifyGridCell_({
      personId: cellOf(0, DATES[0], 'PREACH')[A.PERSON_ID],
      personName: cellOf(0, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT],
      assignSource: cellOf(0, DATES[0], 'PREACH')[A.ASSIGN_SOURCE],
      ruleFlags: gas.splitList_(cellOf(0, DATES[0], 'PREACH')[A.RULE_FLAGS])
    }), gas.GRID_CELL_CLASS.ASSIGNED);
}

console.log('\n=== 路 2／5：applyRequests_()（有申報嗰條路）===');
{
  const base = gas.findLatestVersionNo(Q);
  const before = cellOf(base, DATES[2], 'READ')[A.PERSON_ID];
  const target = Object.keys(PEOPLE).find(function (id) { return id !== before; });
  const R = C.REQUESTS;
  appendRows(ss, S.REQUESTS, [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME,
    R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS], [
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: DATES[2], [R.POST_NAME]: '讀經',
      [R.PERSON_NAME]: PEOPLE[target], [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE,
      [R.STATUS]: '' }]);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★ 0 格人手改動 ＋ 1 筆申報', [plan.gridChanges.length, plan.requests.apply.length], [0, 1]);
  const res = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★ 成功', res.ok === true, JSON.stringify(res).slice(0, 200));

  const next = gas.findLatestVersionNo(Q);
  assertCarriedOver('applyRequests_', base, next, [KEY(DATES[2], 'READ')]);
  checkEqual('★★★★★ 申報真係生效', String(cellOf(next, DATES[2], 'READ')[A.PERSON_ID]), target);
  checkEqual('★★★★★ **講員嗰格嘅自由文字原封不動**',
    String(cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT]), GUEST);
}

console.log('\n=== 路 3／5：materialiseManualEdits_()（純人手改動）===');
{
  const base = gas.findLatestVersionNo(Q);
  const before = cellOf(base, DATES[1], 'CHAIR')[A.PERSON_ID];
  const target = Object.keys(PEOPLE).find(function (id) { return id !== before; });
  check('（前置）grid 改一格', setGrid(base, DATES[1], 'CHAIR', PEOPLE[target]));

  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★ 1 格人手改動 ＋ 0 筆申報',
    [plan.gridChanges.length, plan.requests.apply.length], [1, 0]);
  const res = gas.apiSaveAndConfirmExecute(Q, { decisions: plan.gridChanges, confirmedRequestRows: [] });
  check('★★★★ 成功', res.ok === true, JSON.stringify(res).slice(0, 200));

  const next = gas.findLatestVersionNo(Q);
  assertCarriedOver('materialiseManualEdits_', base, next, [KEY(DATES[1], 'CHAIR')]);
  checkEqual('★★★★★ 人手改動生效', String(cellOf(next, DATES[1], 'CHAIR')[A.PERSON_ID]), target);

  // ★ 第三十六輪 A 組嘅核心：修正之前呢一格會變成空字串 ⇒ 顯示「⚠ 未能安排」。
  checkEqual('★★★★★ **講員嗰格嘅自由文字原封不動**'
    + '（A 組：修正之前呢度會變成空字串，PDF 上顯示「⚠ 未能安排」——'
    + '幹事開季前填嘅 13 個講員一撳就全部唔見，而且冇任何錯誤訊息）',
    String(cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT]), GUEST);
  // ⚠️ 第三十七輪批次：呢一格而家算「有人」（ASSIGNED），唔再係「待確認」
  //——佢真係有一個幹事親手填嘅人名。而且只有 ASSIGNED 會渲染人名。
  // 呢度**一定要傳 `personName`**，唔傳就會重現返個 bug（見 helper 嘅註解）。
  checkEqual('★★★★★ 而且佢算「有人」（ASSIGNED），唔係「未能安排」',
    gas.classifyGridCell_({
      personId: cellOf(next, DATES[0], 'PREACH')[A.PERSON_ID],
      personName: cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT],
      assignSource: cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE],
      ruleFlags: gas.splitList_(cellOf(next, DATES[0], 'PREACH')[A.RULE_FLAGS])
    }), gas.GRID_CELL_CLASS.ASSIGNED);
  checkEqual('★★★★★ 而且 assignSource 仍然係 MANUAL（唔會被覆寫成 SKIPPED）',
    String(cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE]), gas.ASSIGN_SOURCE.MANUAL);
}

console.log('\n=== 路 4／5：apiRollbackExecute()（回到上一個版本）===');
{
  const base = gas.findLatestVersionNo(Q);
  const targetVersion = 0;
  const plan = gas.apiRollbackPlan(Q, targetVersion);
  check('★★★★ rollback plan 唔會 blocked', plan.blocked !== true,
    JSON.stringify(plan).slice(0, 300));

  const res = gas.apiRollbackExecute(Q, targetVersion, gas.ROLLBACK_CONFIRM_TEXT);
  check('★★★★ 成功', res && res.ok !== false, JSON.stringify(res).slice(0, 300));

  const next = gas.findLatestVersionNo(Q);
  check('★★★★★ 建立咗新版本（唔係刪走舊版本）', next === base + 1, 'base=' + base + ' next=' + next);

  // 回退嘅「基準」係目標版本——新版本應該逐格等於 v0（一格都冇改動清單）。
  const problems = diffUnchangedCells(gas, Q, targetVersion, next, [], TZ);
  checkEqual('★★★★★ [apiRollbackExecute] 新版本逐格等於目標版本'
    + '（五個欄位全部，包括 serviceDateId）', problems, []);
  const audit = auditCellClasses(gas, Q, next, true);
  checkEqual('★★★★★ [apiRollbackExecute] 分類守門', audit.problems, []);
  checkEqual('★★★★★ 講員嗰格嘅自由文字都要跟住回退返嚟',
    String(cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT]), GUEST);
}

console.log('\n=== 路 5／5：applyDecisions()（微調提案）——真入口端到端 ===');
{
  const base = gas.findLatestVersionNo(Q);

  // 造一個真嘅違反：加一位只做「讀經」嘅人，然後喺 grid 把佢擺入「主席」。
  // ⚠️ 呢兩樣都係**幹事嘅輸入**（NameMapping 同 grid 打字），手砌係正路。
  const N = C.NAME_MAPPING, E = C.ELIGIBILITY;
  appendRows(ss, S.NAME_MAPPING, [N.PERSON_ID, N.NAME_TC, N.EMAIL, N.ACTIVE],
    [{ [N.PERSON_ID]: 'P9699', [N.NAME_TC]: '假戊',
      [N.EMAIL]: 'p9699@example.invalid', [N.ACTIVE]: true }]);
  appendRows(ss, S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
    [{ [E.ELIGIBILITY_ID]: 'E999', [E.PERSON_ID]: 'P9699', [E.POST_ID]: 'READ',
      [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);

  const origChair = String(cellOf(base, DATES[3], 'CHAIR')[A.PERSON_ID]);
  check('（前置）grid 把「主席」改成一位冇資格做主席嘅人',
    setGrid(base, DATES[3], 'CHAIR', '假戊'));

  // ── 真入口一：檢查改動 ────────────────────────────────────────
  const detect = gas.apiDetectChanges(Q, base);
  check('★★★★★ 真入口 apiDetectChanges() 認到呢格人手改動',
    detect.changeCount >= 1, JSON.stringify(detect).slice(0, 300));
  check('★★★★★ 而且認到佢違反硬規則（唔係靜靜放行）',
    detect.violationCount >= 1, JSON.stringify(detect).slice(0, 300));
  check('★★★★★ 提案真係寫入咗 FineTuneProposals（唔係手砌一張表塞落去）',
    detect.written >= 1, 'written=' + detect.written);

  // ── 幹事去 FineTuneProposals 填 Decision（呢個係人手輸入，正路）──
  const P = C.FINE_TUNE_PROPOSALS;
  const psh = ss.getSheetByName(S.FINE_TUNE_PROPOSALS);
  const phead = psh.getRange(2, 1, 1, psh.getLastColumn()).getValues()[0];
  const dcol = phead.indexOf(P.DECISION) + 1;
  const bcol = phead.indexOf(P.BATCH_ID) + 1;
  let decided = 0;
  for (let r = 3; r <= psh.getLastRow(); r++) {
    if (String(psh.getRange(r, bcol).getValue()) !== detect.batchId) continue;
    psh.getRange(r, dcol).setValue(gas.FINETUNE_DECISION.REVERT_ORIGINAL);
    decided++;
  }
  check('（前置）幹事把提案全部設成「還原為原本的人」', decided >= 1, 'decided=' + decided);

  // ── 真入口二：套用決定 ────────────────────────────────────────
  const result = gas.applyDecisions(detect.batchId);
  check('★★★★★ 真入口 applyDecisions() 行得完（第五條路，之前三輪都只係讀原始碼）',
    !!(result && result.sheetName), JSON.stringify(result).slice(0, 300));

  const next = gas.findLatestVersionNo(Q);
  checkEqual('★★★★ 真係建立咗新一版', next, base + 1);

  // ★★★ 核心：呢條路一直冇端到端查過。兩個 bug 都喺呢度出現過。
  assertCarriedOver('applyDecisions', base, next, [KEY(DATES[3], 'CHAIR')]);

  checkEqual('★★★★★ 「還原為原本的人」真係生效',
    String(cellOf(next, DATES[3], 'CHAIR')[A.PERSON_ID]), origChair);

  checkEqual('★★★★★ **講員嗰格嘅自由文字原封不動**'
    + '（第三十六輪查出呢條路寫死 `personName: \'\'`——'
    + '幹事撳「套用決定」，13 個講員名一次過消失）',
    String(cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT]), GUEST);
  checkEqual('★★★★★ 而且佢仍然算「有人」（ASSIGNED），唔係「未能安排」',
    gas.classifyGridCell_({
      personId: cellOf(next, DATES[0], 'PREACH')[A.PERSON_ID],
      personName: cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT],
      assignSource: cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE],
      ruleFlags: gas.splitList_(cellOf(next, DATES[0], 'PREACH')[A.RULE_FLAGS])
    }), gas.GRID_CELL_CLASS.ASSIGNED);
  checkEqual('★★★★★ assignSource 仍然係 MANUAL（唔會被壓成 SKIPPED）',
    String(cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE]), gas.ASSIGN_SOURCE.MANUAL);

  checkEqual('★★★★★ 「這一週不設」嗰啲格嘅 ruleFlags 冇被清走'
    + '（第三十四輪甲5 同一個 bug，喺呢條路上）',
    gas.splitList_(cellOf(next, DATES[1], 'COMMUNION')[A.RULE_FLAGS]).length > 0, true);

  const cls = auditCellClasses(gas, Q, next, true);
  checkEqual('★★★★★ 套用決定之後，「未能安排」仍然係 0'
    + '（現場嘅指紋係「未能安排 ＝ 總格數 − 有派人」，helper 會擋住）',
    cls.counts.genuineGap, 0);
}


console.log('\n=== 路 5b：決定落喺「冇人喺 grid 改過」嘅格上面 ===');
{
  // ─────────────────────────────────────────────────────────────────
  // 點解要特登砌呢個情境
  // ─────────────────────────────────────────────────────────────────
  //
  // `applyDecisions()` 入面 `touchedByDecision` 同 `s.isManual` 喺絕大部分
  // 情況下結果一樣，唯一分得出嘅時候係：
  //   • 呢一格**唔係**幹事喺 grid 改嘅（isManual = false）
  //   • 但係今次決定令佢**變成空白**（搵唔到替補）
  // 呢陣冇咗 `touchedByDecision`，個格就會留低**上一版嗰個人嘅名**——
  // grid 同 PDF 照舊印住佢，但實際上冇人服侍。
  //
  // 造法：把「讀經」嘅資格全部關掉 ⇒ 每一格讀經都違反 HARD_ELIGIBILITY，
  // 而且搵唔到任何替補 ⇒ 系統建議係空白。
  //（改資格表係幹事嘅正常操作，季中收到人退出就會噉做。）
  const base = gas.findLatestVersionNo(Q);
  const E = C.ELIGIBILITY;
  const esh = ss.getSheetByName(S.ELIGIBILITY);
  const ehead = esh.getRange(2, 1, 1, esh.getLastColumn()).getValues()[0];
  const pcol = ehead.indexOf(E.POST_ID) + 1;
  const acol = ehead.indexOf(E.ACTIVE) + 1;
  let closed = 0;
  for (let r = 3; r <= esh.getLastRow(); r++) {
    if (String(esh.getRange(r, pcol).getValue()) !== 'READ') continue;
    esh.getRange(r, acol).setValue(false);
    closed++;
  }
  check('（前置）幹事把「讀經」嘅資格全部關掉', closed > 0, 'closed=' + closed);

  const detect = gas.apiDetectChanges(Q, base);
  check('★★★★★ 提案係喺**冇人喺 grid 改過**嘅格上面（呢個先分得出兩條分支）',
    detect.changeCount === 0 && detect.written >= 1,
    'changeCount=' + detect.changeCount + ' written=' + detect.written);
  check('★★★★★ 而且系統搵唔到替補（建議係空白）',
    detect.proposals.some(function (p) { return !p.suggestedPersonId; }),
    JSON.stringify(detect.proposals.slice(0, 2)));

  const P = C.FINE_TUNE_PROPOSALS;
  const psh = ss.getSheetByName(S.FINE_TUNE_PROPOSALS);
  const phead = psh.getRange(2, 1, 1, psh.getLastColumn()).getValues()[0];
  const col = function (k) { return phead.indexOf(k) + 1; };
  const touched = [];
  for (let r = 3; r <= psh.getLastRow(); r++) {
    if (String(psh.getRange(r, col(P.BATCH_ID)).getValue()) !== detect.batchId) continue;
    if (String(psh.getRange(r, col(P.SUGGESTED_PERSON_ID)).getValue() || '')) continue;
    psh.getRange(r, col(P.DECISION)).setValue(gas.FINETUNE_DECISION.ACCEPT_SUGGESTED);
    touched.push(KEY(gas.toDateString(psh.getRange(r, col(P.SERVICE_DATE_ID)).getValue(), TZ)
      || '', 'READ'));
  }
  check('（前置）幹事把「搵唔到替補」嗰啲設成「採用系統建議」', touched.length > 0);

  const beforeNames = {};
  DATES.forEach(function (d) {
    beforeNames[d] = String(cellOf(base, d, 'READ')[A.PERSON_NAME_SNAPSHOT] || '');
  });

  gas.applyDecisions(detect.batchId);
  const next = gas.findLatestVersionNo(Q);

  // 實測結果：**決定永遠唔會把一格洗成空白。**
  // ─────────────────────────────────────────────────────────────────
  //
  // `applyDecisions()` 嘅關卡係 `ACCEPT_SUGGESTED && entry.suggested`
  //（FineTune.gs）——建議係空白嗰陣會跌落 `else`，即係同 KEEP_MANUAL 一樣
  // 保留現況。`REVERT_ORIGINAL` 亦都有 `revertBlocked` 擋住同一件事。
  //
  // 呢個係**啱嘅**：搵唔到替補係「排唔到」，唔係「唔使人做」。
  // 靜靜洗成空白會令一格服侍冇人知就冇咗。呢度鎖住呢個行為。
  const kept = DATES.filter(function (d) {
    return beforeNames[d] !== ''
      && String(cellOf(next, d, 'READ')[A.PERSON_NAME_SNAPSHOT] || '') === beforeNames[d];
  });
  checkEqual('★★★★★ 搵唔到替補嗰啲格**保留現況**，唔會被靜靜洗成空白'
    + '（洗成空白 ＝ 一格服侍冇人知就冇咗，而幹事只會見到「已套用」）',
    kept.length, DATES.filter(function (d) { return beforeNames[d] !== ''; }).length);

  checkEqual('★★★★★ 而講員嗰格嘅自由文字**照樣**原封不動'
    + '（同一次寫入入面，唔同種類嘅格要行唔同嘅規則）',
    String(cellOf(next, DATES[0], 'PREACH')[A.PERSON_NAME_SNAPSHOT]), GUEST);
  checkEqual('★★★★★ assignSource 亦都仍然係 MANUAL',
    String(cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE]), gas.ASSIGN_SOURCE.MANUAL);

  const cls5b = auditCellClasses(gas, Q, next, true);
  checkEqual('★★★★★ 「未能安排」仍然係 0', cls5b.counts.genuineGap, 0);
}

console.log('\n=== C：守門本身要擋得住（用一個真嘅壞版本試）===');
{
  // 人手把最新版本嘅 ruleFlags 清空 ⇒ 守門一定要嘈。
  const v = gas.findLatestVersionNo(Q);
  const sh = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const h = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = function (k) { return h.indexOf(k) + 1; };
  const beforeSnap = snapshotVersion(gas, Q, v, TZ);
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, col(A.QUARTER_ID)).getValue()) !== Q) continue;
    if (Number(sh.getRange(r, col(A.VERSION_NO)).getValue()) !== v) continue;
    sh.getRange(r, col(A.RULE_FLAGS)).setValue('');
  }

  const audit = auditCellClasses(gas, Q, v, true);
  check('★★★★★ 清空 ruleFlags 之後，分類守門真係會嘈'
    + '（唔會嘈嘅話呢個 helper 就係一條假綠燈）',
    audit.problems.length > 0, JSON.stringify(audit.problems));
  check('★★★★★ 而且明確講出「未能安排 ＝ 總格數 − 有派人」呢個指紋'
    + '（現場就係 273 − 194 = 79）',
    audit.problems.join('').indexOf('指紋') !== -1, JSON.stringify(audit.problems));

  // 逐格比對亦都要揪到。
  const restored = {};
  Object.keys(beforeSnap).forEach(function (k) { restored[k] = beforeSnap[k]; });
  const problems = diffUnchangedCells(gas, Q, v - 1, v, [], TZ);
  check('★★★★★ 逐格比對都揪到（唔係只有分類守門先揪到）',
    problems.length > 0, JSON.stringify(problems).slice(0, 300));
  check('★★★★ 而且印得出係邊一格、邊個欄位、舊值同新值',
    problems.some(function (p) { return p.indexOf('ruleFlags') !== -1 && p.indexOf('→') !== -1; }),
    problems.slice(0, 3).join(' / '));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
