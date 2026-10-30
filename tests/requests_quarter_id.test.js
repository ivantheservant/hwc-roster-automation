// 第六十三輪批次 E 組：`Requests` 嘅 QuarterID 空白或打錯 ⇒ 申報被靜靜吞掉。
// 執行方式：node tests/requests_quarter_id.test.js
//
// 現場：`readPendingRequests_()` 第一句就係
//   `if (String(row[qCol] || '').trim() !== quarterId) return;`
// 而且排喺「不完整計數」之前，所以 QuarterID 空白、小寫 `2027t3`、全形字元、
// 前後有不可見字元嘅申報**完全唔出現**：唔套用、唔計入略過數、唔顯示 NEEDS_INPUT。
//
// （fixture 同 manual_fill_not_violation.test.js 一樣，由真入口生成。）

const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./helpers/mock_sheets_realistic.js');
const fs = require('fs');
const path = require('path');

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
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs'
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
const Q = '2099T1';
const DATES = [];
const PEOPLE = { P9701: '假獻甲', P9702: '假獻乙', P9703: '假獻丙' };

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: function () {
    const rec = {};
    const self = {
      requireValueInList: function (l) { rec.list = l; return self; },
      setAllowInvalid: function () { return self; },
      setHelpText: function () { return self; },
      build: function () { return rec; }
    };
    return self;
  },
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'k@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    if (fmt === 'yyyy-MM-dd') return d;
    return d + ' 09:00:00';
  },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return { fileUrl: 'https://example.invalid/p' }; };
gas.nowTimestamp_ = function () { return '2099-01-01 09:00:00'; };
gas.applyTimestampFormat_ = function () {};
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };

(function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 1,
      [C.QUARTERS.START_DATE]: '2099-01-04', [C.QUARTERS.END_DATE]: '2099-01-25',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);
  for (let i = 0; i < 4; i++) {
    const d = new Date(Date.UTC(2099, 0, 4 + i * 7));
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
  [['CHAIR', '主席', true], ['READ', '讀經', true], ['FLOWER', '獻花', false]]
    .map(function (p, i) {
      return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
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
  // ⚠️ 獻花嘅資格**特登**畀晒三個人——令「唯一可能嘅違反」就係 NO_AUTO_GENERATE，
  // 測到嘅先至係呢條規則本身。
  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    elig.push(['CHAIR', id]); elig.push(['READ', id]); elig.push(['FLOWER', id]);
  });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  elig.map(function (p, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0],
      [C.ELIGIBILITY.PERSON_ID]: p[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
  }));
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL,
    C.RULE_SETTINGS.ENABLED, C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION,
    C.RULE_SETTINGS.PRIORITY],
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
      [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
})();


// =====================================================================
console.log('\n=== 前置：用真入口生成 ===');
check('（前置）生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);

const RQ = C.REQUESTS;
const RKEYS = Object.keys(RQ).map(function (k) { return RQ[k]; });
function addRequest(quarterText, dateStr, personId) {
  appendRows(ss, S.REQUESTS, RKEYS, [{
    [RQ.QUARTER_ID]: quarterText, [RQ.SERVICE_DATE]: dateStr, [RQ.POST_NAME]: '獻花',
    [RQ.PERSON_NAME]: PEOPLE[personId], [RQ.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE }]);
}
addRequest('', DATES[1], 'P9702');                                   // 第 3 行：空白
addRequest('２０９９ｔ１​', DATES[2], 'P9703');  // 第 4 行：全形小寫＋零闊度
addRequest('2099T2', DATES[3], 'P9701');                             // 第 5 行：寫錯季度
addRequest('', '2099-05-03', 'P9701');                               // 第 6 行：空白而日期唔屬於呢季
addRequest(' 2099t1 ', DATES[0], 'P9701');                           // 第 7 行：小寫＋前後空白

console.log('\n=== E【核心】讀待處理申報 ===');
const pending = gas.readPendingRequests_(Q);
const byRow = {};
pending.forEach(function (p) { byRow[p.sheetRow] = p; });
{
  check('★★★★★★ QuarterID 空白、日期屬於呢一季 ⇒ **出現**（舊寫法靜靜吞咗）',
    !!byRow[3], JSON.stringify(Object.keys(byRow)));
  check('★★★★★ 而且帶住「按日期判斷」嘅說明',
    byRow[3] && /QuarterID 空白，按日期判斷為 2099T1/.test(byRow[3].quarterNote));
  check('★★★★★★ 全形、小寫、零闊度字元 ⇒ 正規化之後認到', !!byRow[4] && !byRow[4].quarterMismatch);
  check('★★★★★ 小寫＋前後空白 ⇒ 認到', !!byRow[7] && !byRow[7].quarterMismatch && !byRow[7].quarterNote);
  check('★★★★★★ 寫咗另一季、日期屬於呢一季 ⇒ 出現而且標住對唔上', !!byRow[5]
    && /2099T2/.test(byRow[5].quarterMismatch) && /屬於 2099T1/.test(byRow[5].quarterMismatch),
    JSON.stringify(byRow[5]));
  check('★★★★ 空白而日期唔屬於呢一季 ⇒ 唔關呢一季事（判斷唔到）', !byRow[6]);
}

console.log('\n=== E【核心】驗證同套用 ===');
{
  const plan = gas.planApplyRequests_(Q);
  const cat = {};
  plan.results.forEach(function (r) { cat[r.sheetRow] = r; });
  check('★★★★★★ 對唔上 ⇒ NEEDS_INPUT，講明兩個值',
    cat[5] && cat[5].category === 'NEEDS_INPUT' && /2099T2/.test(cat[5].reason) && /2099T1/.test(cat[5].reason),
    JSON.stringify(cat[5]));
  check('★★★★ 空白嗰筆照常驗證（可以套用）', cat[3] && cat[3].category === 'APPLY', JSON.stringify(cat[3]));
  gas.applyRequests_(plan, [], undefined, 'e-test', []);
  const rows = gas.readSheet_(S.REQUESTS);
  const note3 = String(rows[0][RQ.RESULT_NOTE] || '');
  check('★★★★★★ 處理結果寫明「QuarterID 空白，按日期判斷為 2099T1」',
    /^QuarterID 空白，按日期判斷為 2099T1；/.test(note3), note3);
  check('★★★★ 對唔上嗰筆寫 NEEDS_INPUT', String(rows[2][RQ.STATUS]) === 'NEEDS_INPUT', JSON.stringify(rows[2]));
}

console.log('\n=== E：QuarterID 欄都有下拉 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RequestsSheet.gs'), 'utf8');
  check('★★★★★ applyRequestsValidations_() 對 QuarterID 欄套用下拉',
    /applyWarningListValidation_\(sheet, quarterCol, dataRowCount, quarterOptions\)/.test(src));
  check('★★★★★ 季度選項同日期選項用同一個 selectValidQuarterIdsForRequests_()',
    /const quarterOptions = selectValidQuarterIdsForRequests_\(/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
