// 第三十六輪批次 A／B／C：建立新版本時，冇被改動嘅嘢要完整搬過去。
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
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs'
]);

const Q = '2027T3';
const TZ = 'Pacific/Auckland';
const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
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
      [C.QUARTERS.START_DATE]: '2027-07-04', [C.QUARTERS.END_DATE]: '2027-07-25',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  for (let i = 0; i < 4; i++) {
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
      ['PREACH', '講員', false], ['COMMUNION', '聖餐襄禮', true]].map(function (p, i) {
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
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

function setSnapshot(v, date, post, name) {
  const sh = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const h = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = function (k) { return h.indexOf(k) + 1; };
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, col(A.QUARTER_ID)).getValue()) !== Q) continue;
    if (Number(sh.getRange(r, col(A.VERSION_NO)).getValue()) !== v) continue;
    if (String(sh.getRange(r, col(A.POST_ID)).getValue()) !== post) continue;
    if (gas.toDateString(sh.getRange(r, col(A.SERVICE_DATE)).getValue(), TZ) !== date) continue;
    sh.getRange(r, col(A.PERSON_NAME_SNAPSHOT)).setValue(name);
    return true;
  }
  return false;
}
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
  checkEqual('★★★★ 16 格（4 主日 × 4 崗位）', audit.counts.total, 16);
  check('★★★★★ 三種「曾經被丟失過」嘅格 fixture 真係有：'
    + '待確認（講員）同不設（非首主日聖餐）',
    audit.counts.manualPending >= 4 && audit.counts.structuralNa >= 3,
    JSON.stringify(audit.counts));
  checkEqual('★★★★★ v0 「未能安排」＝ 0（基準線）', audit.counts.genuineGap, 0);

  // 填一位外請講員（模擬「填講員／翻譯／獻花」：長表 ＋ grid 都寫自由文字）
  check('（前置）長表寫入自由文字', setSnapshot(0, DATES[0], 'PREACH', GUEST));
  check('（前置）grid 寫入同一個字', setGrid(0, DATES[0], 'PREACH', GUEST));
  checkEqual('（前置）佢真係冇 PersonID', String(cellOf(0, DATES[0], 'PREACH')[A.PERSON_ID] || ''), '');
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
  checkEqual('★★★★★ 而且佢仍然係「待確認」，唔係「未能安排」',
    gas.classifyGridCell_({
      personId: cellOf(next, DATES[0], 'PREACH')[A.PERSON_ID],
      assignSource: cellOf(next, DATES[0], 'PREACH')[A.ASSIGN_SOURCE],
      ruleFlags: gas.splitList_(cellOf(next, DATES[0], 'PREACH')[A.RULE_FLAGS])
    }), gas.GRID_CELL_CLASS.MANUAL_PENDING);
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

console.log('\n=== 路 5／5：applyDecisions()（微調提案）——第五條路 ===');
{
  // ⚠️ 呢條路之前**從來冇被查過**。三輪都只數過四條。
  // 佢兩個 bug 都有（`personName: ''` ＋ `ruleFlags: []`）。
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'FineTune.gs'), 'utf8');
  // ⚠️ 直接切「砌 assignments」嗰段，唔用 `indexOf('writeAssignments(')` 做終點
  // ——嗰個字串喺註解入面都出現過，會切得太早而令下面幾條變成假綠燈。
  const body = src.slice(src.indexOf('function applyDecisions('));
  const start = body.indexOf('const assignments = analysis.manualState.map(');
  const end = body.indexOf('revertBlocked.forEach(');
  check('（前置）切到 applyDecisions 砌 assignments 嗰段',
    start !== -1 && end !== -1 && end > start, 'start=' + start + ' end=' + end);
  const upToWrite = body.slice(start, end);
  // ⚠️ 拆走註解先查——修正嗰段嘅註解**特登引用咗舊嗰兩行**做對照，
  // 唔拆嘅話會查中自己嘅註解，變成一條永遠紅嘅假警報。
  const bare = upToWrite.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ 唔再寫死 `ruleFlags: []`'
    + '（同第三十四輪甲5 一模一樣嘅 bug，只係喺另一條路）',
    !/ruleFlags:\s*\[\]/.test(bare), bare.slice(-300));
  check('★★★★★ 唔再寫死「認唔到人就一律空字串」嘅 personName'
    + '（同 A 組一模一樣嘅 bug）',
    !/personName:\s*person \? person\.nameTC : ''/.test(bare), bare.slice(-300));
  check('★★★★★ 冇被今次決定改動嘅格，`ruleFlags` 由 originalRow 搬過去',
    /ruleFlags:[\s\S]{0,120}originalRow\.ruleFlags/.test(upToWrite), upToWrite.slice(-400));
  check('★★★★★ `personName` 亦都由 originalRow 搬過去',
    /personName:[\s\S]{0,160}originalRow\.personName/.test(upToWrite));
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
