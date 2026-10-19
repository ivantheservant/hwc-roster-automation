// 第六十三輪批次 B 組：特別主日嘅 `SkipPostIDs` 對講員／翻譯無效。
// 執行方式：node tests/special_skip_preacher.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（`2027T4` v0）
// ═════════════════════════════════════════════════════════════════════
//
// 2027-10-03（`SkipPostIDs=CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO`）：
//   CHAIR／WORSHIP／PIANO　→ `HARD_SPECIAL_SUNDAY_SKIP`
//   PREACHER／TRANSLATOR　→ `HARD_NO_AUTO_PREACHER`（公開版顯示「待確認」）
//
// 成因：`getSkipReason_()` 嘅 `!post.autoGenerate` 排喺 `skipPostIds` 前面，
// 講員／翻譯／獻花 `AutoGenerate=FALSE`，所以永遠拎到 NO_AUTO。
//
// 連鎖：「講員未填」永遠多數一週；填講員畫面叫幹事去填一個本來唔設嘅講員。
//
// ⚠️ fixture 由真入口產生：`apiGenerateDraftExecute()`。

const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs', 'MailRedirect.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs',
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs',
  'AnnualCombined.gs', 'WebAppPeople.gs', 'WebAppPreQuarter.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS;
const S = gas.SHEETS;
const A = C.ROSTER_ASSIGNMENTS;
const Q = '2099T4';
const DATES = [];
const R = gas.RULE_IDS;

// =====================================================================
console.log('\n=== B1【核心】getSkipReason_() 次序 ===');
{
  const rules = {};
  [R.NO_AUTO_GENERATE, R.COMMUNION_FIRST_SUNDAY].forEach(function (id) {
    rules[id] = { [C.RULE_SETTINGS.ENABLED]: true };
  });
  const preacher = { postId: 'PREACHER', autoGenerate: false, frequency: 'WEEKLY' };
  const skip = { skipPostIds: ['PREACHER'], lockPostIds: [] };
  const none = { skipPostIds: [], lockPostIds: [] };
  const sunday = { autoGenerate: true, isFirstSundayOfMonth: false };
  check('★★★★★★ 講員喺 SkipPostIDs ⇒ HARD_SPECIAL_SUNDAY_SKIP（唔再係 NO_AUTO）',
    gas.getSkipReason_(preacher, sunday, skip, rules).ruleId === R.SPECIAL_SUNDAY_SKIP);
  check('★★★★★ 唔喺 SkipPostIDs ⇒ 照舊 NO_AUTO_GENERATE',
    gas.getSkipReason_(preacher, sunday, none, rules).ruleId === R.NO_AUTO_GENERATE);
  const communion = { postId: 'HC', autoGenerate: true, frequency: gas.POST_FREQUENCY.FIRST_SUNDAY };
  check('★★★★★ 每月第一主日限定仍然排最前（結構性不適用優先）',
    gas.getSkipReason_(communion, sunday, { skipPostIds: ['HC'], lockPostIds: [] }, rules).ruleId
      === R.COMMUNION_FIRST_SUNDAY);
  const asNeeded = { postId: 'X', autoGenerate: true, frequency: gas.POST_FREQUENCY.AS_NEEDED };
  check('★★★★ AS_NEEDED 崗位喺 SkipPostIDs ⇒ 都係特別主日跳過',
    gas.getSkipReason_(asNeeded, sunday, { skipPostIds: ['X'], lockPostIds: [] }, rules).ruleId
      === R.SPECIAL_SUNDAY_SKIP);
}

// =====================================================================
const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: function () {
    const self = { requireValueInList: function () { return self; }, setAllowInvalid: function () { return self; },
      setHelpText: function () { return self; }, build: function () { return {}; } };
    return self;
  },
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'b@example.invalid'; } }; } };
gas.CacheService = { getScriptCache: function () {
  return { get: function () { return null; }, put: function () {}, remove: function () {} }; } };
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    return fmt === 'yyyy-MM-dd' ? d : d + ' 09:00:00';
  },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.nowTimestamp_ = function () { return '2099-10-01 09:00:00'; };
gas.applyTimestampFormat_ = function () {};

(function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 4,
      [C.QUARTERS.START_DATE]: '2099-10-04', [C.QUARTERS.END_DATE]: '2099-10-25',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);
  for (let i = 0; i < 4; i++) {
    const d = new Date(Date.UTC(2099, 9, 4 + i * 7));
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
  [['CHAIR', '主席', true], ['PREACH', '講員', false]].map(function (p, i) {
    return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
      [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
      [C.POSTS.AUTO_GENERATE]: p[2], [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW',
      [C.POSTS.MUTEX_GROUP]: '', [C.POSTS.DISPLAY_ORDER]: i + 1,
      [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
  }));
  seedSheet(ss, S.NAME_MAPPING, ['N'], [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC,
    C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
  ['P9401', 'P9402'].map(function (id) {
    return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: '假' + id.slice(-2),
      [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
  }));
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  ['P9401', 'P9402'].map(function (id, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: 'CHAIR',
      [C.ELIGIBILITY.PERSON_ID]: id, [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
  }));
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL,
    C.RULE_SETTINGS.ENABLED, C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION,
    C.RULE_SETTINGS.PRIORITY],
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));
  const SP = C.SPECIAL_SUNDAYS;
  seedSheet(ss, S.SPECIAL_SUNDAYS, ['SS'], Object.keys(SP).map(function (k) { return SP[k]; }), [
    { [SP.SPECIAL_ID]: 'SS1', [SP.QUARTER_ID]: Q, [SP.SERVICE_DATE]: DATES[1], [SP.TYPE]: '合堂',
      [SP.TITLE]: '測試合堂', [SP.SKIP_POST_IDS]: 'CHAIR,PREACH', [SP.ACTIVE]: true }]);
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
})();

console.log('\n=== 前置：用真入口生成（第 2 週係合堂，講員喺 SkipPostIDs）===');
gas.apiGenerateDraftExecute(Q);
function flagsOf(dateStr, postId) {
  const row = gas.readSheet(S.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === 0
      && gas.toDateString(r[A.SERVICE_DATE], TZ) === dateStr && r[A.POST_ID] === postId;
  });
  return row ? gas.splitList_(row[A.RULE_FLAGS]) : null;
}

console.log('\n=== B1【核心】生成出嚟嘅講員格 ===');
{
  check('★★★★★★ 合堂嗰週嘅講員係 HARD_SPECIAL_SUNDAY_SKIP'
    + '——現場：PREACHER 係 HARD_NO_AUTO_PREACHER，公開版顯示「待確認」',
    JSON.stringify(flagsOf(DATES[1], 'PREACH')) === JSON.stringify([R.SPECIAL_SUNDAY_SKIP]),
    JSON.stringify(flagsOf(DATES[1], 'PREACH')));
  check('★★★★★ 同一週嘅主席都係（對照：本來就啱）',
    JSON.stringify(flagsOf(DATES[1], 'CHAIR')) === JSON.stringify([R.SPECIAL_SUNDAY_SKIP]));
  check('★★★★★ 其他週嘅講員照舊係 NO_AUTO_GENERATE（待確認）',
    JSON.stringify(flagsOf(DATES[0], 'PREACH')) === JSON.stringify([R.NO_AUTO_GENERATE]));
}

console.log('\n=== B2：填講員畫面唔列嗰一格 ===');
{
  const pending = gas.apiListPreacherTranslationPending(Q).pending;
  const dates = pending.filter(function (p) { return p.postId === 'PREACH'; })
    .map(function (p) { return p.serviceDate; });
  check('★★★★★★ 合堂嗰週嘅講員**唔喺**待填清單'
    + '——列咗就係叫幹事去填一個本來唔設嘅講員',
    dates.indexOf(DATES[1]) === -1, JSON.stringify(dates));
  check('★★★★ 其他三週照列', dates.length === 3, JSON.stringify(dates));
}

console.log('\n=== B3：「這一季還要做的」唔再多數一週 ===');
{
  const checklist = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(Q));
  const item = checklist.items.filter(function (i) { return i.id === 'preacherEmpty'; })[0];
  check('★★★★★★ 「講員未填」係 3 週，唔係 4 週', item && item.count === 3, JSON.stringify(item));

  // 同一份 SpecialSundays 資料：Active=FALSE ⇒ 唔跳過
  const inputs = gas.buildPreQuarterChecklistInputs_(Q);
  inputs.specialRows = inputs.specialRows.map(function (r) {
    return Object.assign({}, r, { [C.SPECIAL_SUNDAYS.ACTIVE]: false });
  });
  const item2 = gas.planPreQuarterChecklist_(inputs).items.filter(function (i) { return i.id === 'preacherEmpty'; })[0];
  check('★★★★★ 特別主日 Active=FALSE ⇒ 照計（同生成器同一個規則）', item2.count === 4, JSON.stringify(item2));
}

console.log('\n=== B：生成器同開季前準備讀同一個函式 ===');
{
  const fs = require('fs');
  const path = require('path');
  const read = function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); };
  check('★★★★ 生成器用 buildSpecialSundayByDate_()',
    /buildSpecialSundayByDate_\(readSpecialSundays\(quarterId\), timezone\)/.test(read('Generator.gs')));
  check('★★★★ 開季前準備用同一支',
    /buildSpecialSundayByDate_\(specialRows, input\.timezone\)/.test(read('WebAppPreQuarter.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
