// 第三十九輪批次 A／C／D 組：幹事主流程六步。
// 執行方式：node tests/main_flow_six_steps.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// 呢一輪嘅重心由「修 bug」轉成「幹事撳得落手」，所以呢一份守嘅係
// **幹事撳落去會唔會發生佢預期嗰件事**：
//
//   第 1 步　掣上面寫住嘅係邊一季？已經開始／已經過去有冇警告？
//   第 3 步　下拉選單有冇擋死「打一個唔喺名單上嘅名」？
//   第 4 步　認唔出嘅名字有冇被靜靜略過？
//   第 5 步　系統判斷嘅階段啱唔啱？「會寄咩」講唔講得出？
//   第 6 步　邊幾位要印紙本？查唔到名嗰啲有冇被略過？
//
// ⚠️ 全部代表「系統寫過嘅資料」嘅 fixture 一律由真入口產生
//（第三十八輪 B 組）：職事表由 `apiGenerateDraftExecute()` 生成，
// 講員由 `apiSavePreacherTranslationEntry()` 填。

const { loadGasSource } = require('./helpers/gas_loader.js');
const {
  RealisticMockSpreadsheet, seedSheet
} = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  // 第四十一輪批次 H 組：介面頂部嗰個轉寄標籤（buildMailRedirectBadgeText_）。
  'MailRedirect.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs',
  'PreacherTranslationFill.gs',
  // 本輪新增
  'WebAppMainFlow.gs', 'GridNameDropdown.gs', 'EligibilitySheetEditor.gs',
  'WebAppSendPlan.gs',
  // 第四十輪批次 A 組：寄出嗰三個選項喺呢度解析（apiGetSendPlanSummary 要用）。
  'SendOptions.gs',
  // 第四十一輪批次 E 組：附件選項嗰幾行小字（describeAttachOption_）。
  'PersonalLinkInMail.gs',
  // 第四十一輪批次 H 組：介面頂部嗰個轉寄標籤。
  'MailRedirect.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS;
const S = gas.SHEETS;
const A = C.ROSTER_ASSIGNMENTS;

// 三季：一季已經過去、一季正在進行、一季未開始。今天當成 2099-02-15。
const Q_PAST = '2098T4';
const Q_NOW = '2099T1';
const Q_NEXT = '2099T2';
const DATES_NOW = [];

const PEOPLE = { P9601: '假甲', P9602: '假乙', P9603: '假丙', P9604: '假丁' };
/** 假丁刻意冇電郵——第 6 步就係靠佢。 */
const NO_EMAIL = { P9604: true };

const ss = new RealisticMockSpreadsheet();
function dvBuilder() {
  const rec = { list: null, allowInvalid: null, helpText: '' };
  const self = {
    _rec: rec,
    requireValueInList: function (list, drop) { rec.list = list; rec.showDropdown = drop; return self; },
    setAllowInvalid: function (v) { rec.allowInvalid = v; return self; },
    setHelpText: function (t) { rec.helpText = t; return self; },
    build: function () { return rec; }
  };
  return self;
}
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: dvBuilder,
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = {
  getActiveUser: function () { return { getEmail: function () { return 'flow@example.invalid'; } }; }
};
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
// ⚠️ 「今天」寫死成 2099-02-15，令「已經開始／已經過去」測得到。
// 用真嘅今天，呢幾條斷言會隨住日子過去而變綠變紅——即係一條會自己
// 由綠變紅嘅測試，而變紅嗰陣同被測嘅程式一啲關係都冇。
//
// ⚠️ 但**只可以造假「而家」嗰一刻**。`Utilities.formatDate()` 全系統
// 都用嚟格式化任何一個日期（`toDateString()` 就係靠佢），一律回 FAKE_TODAY
// 嘅話，所有日期都會變成同一日——實測過：長表搵唔到任何一格。
// 所以只有「傳入嘅時間同執行嗰刻相差一秒之內」先當成「而家」。
const FAKE_TODAY = '2099-02-15';
function fmtDate_(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const isNow = Math.abs(date.getTime() - Date.now()) < 1000;
    if (fmt === 'yyyy-MM-dd') return isNow ? FAKE_TODAY : fmtDate_(date, tz);
    if (isNow) return FAKE_TODAY + ' 09:00:00';
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
    return fmtDate_(date, tz) + ' ' + t;
  },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.nowTimestamp_ = function () { return FAKE_TODAY + ' 09:00:00'; };
gas.applyTimestampFormat_ = function () {};
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };
// 公開連結：預設當成「已經有一條」。
let publicLinkRow_ = { fileUrl: 'https://example.invalid/public-roster' };
gas.findPublicLinkRow_ = function () { return publicLinkRow_; };

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);

  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q_PAST, [C.QUARTERS.YEAR]: 2098, [C.QUARTERS.TERM]: 4,
      [C.QUARTERS.START_DATE]: '2098-10-05', [C.QUARTERS.END_DATE]: '2098-12-28',
      [C.QUARTERS.STAGE]: 'DRAFT' },
    { [C.QUARTERS.QUARTER_ID]: Q_NOW, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 1,
      [C.QUARTERS.START_DATE]: '2099-01-04', [C.QUARTERS.END_DATE]: '2099-03-29',
      [C.QUARTERS.STAGE]: 'DRAFT' },
    { [C.QUARTERS.QUARTER_ID]: Q_NEXT, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 2,
      [C.QUARTERS.START_DATE]: '2099-04-05', [C.QUARTERS.END_DATE]: '2099-06-28',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(2099, 0, 4 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    DATES_NOW.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['D'], [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID,
    C.SERVICE_DATES.SERVICE_DATE, C.SERVICE_DATES.WEEK_INDEX,
    C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
  DATES_NOW.map(function (d, i) {
    return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q_NOW,
      [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
      [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
  }));

  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE,
    C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER,
    C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
  [['CHAIR', '主席', true], ['READ', '讀經', true], ['PREACH', '講員', false]]
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
      [C.NAME_MAPPING.EMAIL]: NO_EMAIL[id] ? '' : (id.toLowerCase() + '@example.invalid'),
      [C.NAME_MAPPING.ACTIVE]: true };
  }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) { elig.push(['CHAIR', id]); elig.push(['READ', id]); });
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
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
      [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID,
    C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG, C.EMAIL_TEMPLATES.SUBJECT,
    C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN,
    C.EMAIL_TEMPLATES.PLACEHOLDERS, C.EMAIL_TEMPLATES.ATTACH_TYPE,
    C.EMAIL_TEMPLATES.ACTIVE, C.EMAIL_TEMPLATES.UPDATED_AT], [
    { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_REVIEW_TC', [C.EMAIL_TEMPLATES.STAGE]: 'REVIEW',
      [C.EMAIL_TEMPLATES.SUBJECT]: '審閱', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '請看 {PublicRosterUrl}',
      [C.EMAIL_TEMPLATES.BODY_HTML]: '請看 {PublicRosterUrl}',
      [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
    { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_OFFICIAL_TC', [C.EMAIL_TEMPLATES.STAGE]: 'OFFICIAL',
      [C.EMAIL_TEMPLATES.SUBJECT]: '正式', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '你那一份：{PublicRosterUrl}',
      [C.EMAIL_TEMPLATES.BODY_HTML]: '你那一份：{PublicRosterUrl}',
      [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'PERSONAL_PDF', [C.EMAIL_TEMPLATES.ACTIVE]: true }]);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

// =====================================================================
console.log('\n=== A1【核心】第 1 步：掣上面寫住邊一季 ===');
{
  // 規則一：**佢而家睇緊嗰一季如果未生成過，就係佢。**
  // 佢打開咗、望住緊，最想做嘅一定係生成佢。
  const sel = gas.resolveGenerateTargetQuarter_(Q_NEXT);
  checkEqual('★★★★★ 睇緊嗰一季未生成過 ⇒ 目標就係佢（唔使佢去下拉選單度搵）',
    sel.quarterId, Q_NEXT);
  checkEqual('★★★★ 佢喺將來，所以冇警告', sel.warn, '');
  check('★★★★ 掣上面嗰個名係人話，唔係機器代號（2099T2）',
    sel.label.indexOf('T2') === -1 && sel.label.indexOf('年') !== -1, sel.label);

  // 規則二：冇揀住任何一季（例如啱啱開頁）⇒ 開始日期最早而又未生成嗰一季。
  const none = gas.resolveGenerateTargetQuarter_('');
  checkEqual('★★★★ 冇揀季度 ⇒ 開始日期最早而又未生成過嗰一季', none.quarterId, Q_PAST);
  checkEqual('★★★★★ 而且**明確講出佢已經過去**'
    + '（唔講就等於靜靜幫佢做咗一個決定）', none.warn, 'PAST');
  check('★★★★★ 警告係三段式人話，講得出「而家乜都未改動過」',
    none.warnMessage.indexOf('什麼都沒有改動') !== -1, none.warnMessage);
  check('★★★★ 而且寫住結束日期，令佢自己分得出係咪真係搞錯咗',
    none.warnMessage.indexOf('2098-12-28') !== -1, none.warnMessage);
}

console.log('\n=== A1：已經開始咗嘅季度——准許，但要講 ===');
{
  const t = gas.resolveGenerateTargetQuarter_(Q_NOW);
  checkEqual('★★★★★ 目標 ＝ 佢而家睇緊嗰一季', t.quarterId, Q_NOW);
  checkEqual('★★★★★ 而且講出佢已經開始咗', t.warn, 'STARTED');
  check('★★★★ 警告寫住開始日期', t.warnMessage.indexOf('2099-01-04') !== -1, t.warnMessage);
  check('★★★★★ 但**冇擋住佢**——補一個漏咗嘅季度係真實會發生嘅事',
    t.found === true && t.alreadyGenerated === false, JSON.stringify(t));
}

// =====================================================================
console.log('\n=== 前置：用真入口生成 2099T1 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q_NOW) !== undefined);
check('（前置）用真入口填一格講員',
  gas.apiSavePreacherTranslationEntry(Q_NOW, DATES_NOW[0], 'PREACH', 1, '客席甲牧師') !== undefined);

console.log('\n=== A1：生成咗之後，目標會跳去下一個未生成嘅季度 ===');
{
  const t = gas.resolveGenerateTargetQuarter_(Q_NOW);
  checkEqual('★★★★★ 唔會再指住已經生成過嗰一季', t.quarterId, Q_PAST);
}

// =====================================================================
console.log('\n=== A3【核心】第 3 步：下拉選單唔可以變成限制 ===');
{
  const r = gas.apiApplyGridNameDropdowns(Q_NOW);
  const byPost = {};
  r.columns.forEach(function (c) { byPost[c.postId] = c; });

  check('★★★★ 自動排嘅崗位有加選單', !!byPost.CHAIR && !!byPost.READ, JSON.stringify(r.columns));
  checkEqual('★★★★★ 講員嗰欄**刻意冇選單**——佢係自由文字，'
    + '俾個選單只會令幹事以為「唔喺選單上就係唔可以」',
    r.skipped.filter(function (s) { return s.postId === 'PREACH'; })
      .map(function (s) { return s.reason; }), ['NOT_AUTO']);

  // ★★★ 呢一條係整個功能嘅關鍵。
  const sheet = ss.getSheetByName(gas.buildRosterSheetName_(Q_NOW, gas.findLatestVersionNo(Q_NOW)));
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const chairCol = keys.indexOf('CHAIR#1') + 1;
  const rule = sheet.getRange(3, chairCol, 1, 1).getDataValidation
    ? sheet.getRange(3, chairCol, 1, 1).getDataValidation() : null;
  // mock 冇記低驗證規則，所以改為由原始碼證明——見落面「原始碼」嗰一節。
  check('（前置）搵到主席嗰一欄', chairCol > 0, 'keys=' + keys.join(','));

  check('★★★★ 略過咗嘅欄有喺一句人話入面交代',
    r.summary.indexOf('講員') !== -1, r.summary);
  check('★★★★★ 而且句說話明確講出「照樣可以打一個唔喺名單上嘅名」'
    + '——唔講嘅話，外請講員／新人／借調就會被幹事自己堵死',
    r.summary.indexOf('不在名單上') !== -1, r.summary);
}

console.log('\n=== A3：`setAllowInvalid(true)` 唔可以被改走 ===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'GridNameDropdown.gs'), 'utf8');
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 一律 `setAllowInvalid(true)`'
    + '——改成 false 就會把外請講員／新人／借調直接堵死',
    /setAllowInvalid\(true\)/.test(bare) && !/setAllowInvalid\(false\)/.test(bare), bare.slice(0, 300));
}

// =====================================================================
console.log('\n=== A4【核心】第 4 步：認唔出嘅名字唔可以靜靜略過 ===');
{
  const opened = gas.apiOpenEligibilitySheet();
  checkEqual('★★★★ 開到張名單工作表', opened.sheetName, gas.ELIGIBILITY_SHEET_NAME);

  const sheet = ss.getSheetByName(gas.ELIGIBILITY_SHEET_NAME);
  const postIds = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const chairCol = postIds.indexOf('CHAIR') + 1;
  check('（前置）搵到主席嗰一欄', chairCol > 0, postIds.join(','));

  // 幹事喺主席嗰欄打錯一個字。**呢個係外部輸入，手砌係正路。**
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, chairCol).setValue('打錯咗嘅名');

  const plan = gas.apiPlanEligibilitySheetApply(Q_NOW);
  check('★★★★★ 認唔出嗰個名有被列出嚟', plan.unresolved.length === 1,
    JSON.stringify(plan.unresolved));
  check('★★★★★ 而且講得出係邊一欄、邊一行、打咗咩',
    plan.unresolved[0].note.indexOf('打錯咗嘅名') !== -1
    && plan.unresolved[0].note.indexOf('主席') !== -1, plan.unresolved[0].note);
  checkEqual('★★★★★ **有認唔出就唔准套用**——認唔出而照樣套用，'
    + '等於把嗰個人靜靜移出名單，而冇人會知',
    plan.blocked, true);

  let threw = null;
  try { gas.apiApplyEligibilitySheet(Q_NOW); } catch (e) { threw = e; }
  check('★★★★★ 真係拋錯，唔係靜靜寫入一半', threw !== null);
  check('★★★★★ 而且明確講「一個都冇寫入」'
    + '——講唔清楚嘅話，幹事唔知要唔要再撳一次',
    threw && threw.message.indexOf('一個都沒有寫入') !== -1, threw && threw.message);
}

console.log('\n=== A4：改好之後，新增同移走都要逐項列出 ===');
{
  const sheet = ss.getSheetByName(gas.ELIGIBILITY_SHEET_NAME);
  const postIds = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const chairCol = postIds.indexOf('CHAIR') + 1;
  const readCol = postIds.indexOf('READ') + 1;

  // 把打錯嗰個改成一個真人（＝主席多咗一個），再喺讀經度移走一個。
  sheet.getRange(sheet.getLastRow(), chairCol).setValue('');
  // 讀經第一行清空 ⇒ 嗰個人被移走。
  const firstReadName = String(sheet.getRange(3, readCol).getValue() || '');
  sheet.getRange(3, readCol).setValue('');

  const plan = gas.apiPlanEligibilitySheetApply(Q_NOW);
  checkEqual('★★★★★ 冇認唔出嘅名字就唔再擋', plan.blocked, false);
  check('★★★★★ 移走嗰個有列出嚟',
    plan.removed.some(function (r) { return r.nameTC === firstReadName && r.postId === 'READ'; }),
    JSON.stringify(plan.removed));
  check('★★★★★ 而且標明佢喺現有職事表上仲有幾多格'
    + '——移走名單唔會把佢由已排好嘅格拿走，幹事一定要知道呢件事',
    plan.removed.some(function (r) { return r.assignedCount > 0; }),
    JSON.stringify(plan.removed));

  const applied = gas.apiApplyEligibilitySheet(Q_NOW);
  checkEqual('★★★★ 真係套用咗', applied.changed, true);

  // ★ 停用，唔係刪行。
  const E = C.ELIGIBILITY;
  const rows = gas.readSheet(S.ELIGIBILITY).filter(function (r) {
    return r[E.POST_ID] === 'READ';
  });
  checkEqual('★★★★★ 移走 ＝ 停用，**冇刪任何一行**'
    + '（刪咗就冇任何紀錄講得出佢上一季點解會被排到）',
    rows.length, Object.keys(PEOPLE).length);
  checkEqual('★★★★ 而且真係有一行變咗停用',
    rows.filter(function (r) { return r[E.ACTIVE] === false; }).length, 1);
}

// =====================================================================
console.log('\n=== C【核心】第 5 步：階段由系統判斷 ===');
{
  const s = gas.apiGetSendPlanSummary(Q_NOW);
  checkEqual('★★★★★ DRAFT 階段 ⇒ 寄給堂委審閱', s.kind, 'REVIEW');
  check('★★★★★ 而且用一句人話講出嚟，唔係機器代號',
    s.kindSentence.indexOf('堂委審閱') !== -1
    && s.kindSentence.indexOf('REVIEW') === -1, s.kindSentence);
  check('★★★★ 講得出寄俾邊幾個', s.recipientSentence.indexOf('堂委') !== -1, s.recipientSentence);

  // ★★★ 那條永久連結一律要喺信入面。
  checkEqual('★★★★★ 認得出審閱範本入面有放永久連結',
    s.contents.hasPermanentLink, true);
  check('★★★★★ 而且喺「會寄咩」嗰個清單度講咗出嚟',
    s.contents.items.some(function (i) { return i.indexOf('永久連結') !== -1; }),
    JSON.stringify(s.contents.items));
}

console.log('\n=== C：範本冇放連結時要嘈，唔可以靜靜寄一封冇連結嘅信 ===');
{
  const t = gas.describeSendContents_('OFFICIAL');
  checkEqual('★★★★ 正式發出嗰個範本有放連結', t.hasPermanentLink, true);
  check('★★★★ 而且認得出佢會附個人 PDF',
    t.items.some(function (i) { return i.indexOf('個人') !== -1; }), JSON.stringify(t.items));
  check('★★★★★ 亦都講咗 .ics 只有「這一季有服侍嘅人」先會收到'
    + '——講到好似人人都有，幹事就會去追一個唔存在嘅問題',
    t.items.some(function (i) { return i.indexOf('.ics') !== -1 && i.indexOf('有服侍') !== -1; }),
    JSON.stringify(t.items));
}

console.log('\n=== C：階段揀邊一個 ===');
{
  checkEqual('★★★★★ 三個都著嗰陣，揀行得最前嗰個（重發）',
    gas.resolveSendKind_({
      review: { enabled: true }, official: { enabled: true }, resend: { enabled: true }
    }), 'RESEND');
  checkEqual('★★★★★ 審閱同正式都著嗰陣，揀正式（流程往前行嗰個方向）',
    gas.resolveSendKind_({ review: { enabled: true }, official: { enabled: true } }), 'OFFICIAL');
  checkEqual('★★★★ 一個都唔著 ⇒ NONE', gas.resolveSendKind_({}), 'NONE');
}

// =====================================================================
console.log('\n=== D【核心】第 6 步：邊幾位要印紙本 ===');
{
  const s = gas.apiGetPaperListState(Q_NOW);
  check('★★★★ 認到有排工嘅人', s.noEmail.length + s.withEmail.length > 0,
    JSON.stringify(s).slice(0, 200));
  check('★★★★★ 冇電郵嗰位喺「要印」嗰邊',
    s.noEmail.some(function (p) { return p.personId === 'P9604'; }),
    JSON.stringify(s.noEmail));
  check('★★★★ 有電郵嗰啲喺「可以額外加」嗰邊',
    s.withEmail.every(function (p) { return p.personId !== 'P9604'; }),
    JSON.stringify(s.withEmail));
  check('★★★★ 每一位都講得出佢呢一季有幾多格',
    s.noEmail.concat(s.withEmail).every(function (p) { return p.cellCount > 0; }),
    JSON.stringify(s.noEmail));
}

console.log('\n=== D：NameMapping 查唔到嘅人唔可以被略過 ===');
{
  // 直接喺長表加一格，PersonID 係一個 NameMapping 冇嘅編號。
  // FIXTURE-OK: 呢度模擬嘅係「資料本身有唔一致」——真實環境會出現
  //（有人喺 NameMapping 被刪走而長表仲留住舊 PersonID）。
  // 由真入口係造唔到呢個狀態嘅，而呢一條守嘅正正就係「遇到就要嘈」。
  const sh = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const head = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const line = new Array(head.length).fill('');
  const col = function (k) { return head.indexOf(k); };
  const v = gas.findLatestVersionNo(Q_NOW);
  line[col(A.QUARTER_ID)] = Q_NOW;
  line[col(A.VERSION_NO)] = v;
  line[col(A.SERVICE_DATE)] = DATES_NOW[0];
  line[col(A.POST_ID)] = 'READ';
  line[col(A.SLOT_INDEX)] = 9;
  line[col(A.PERSON_ID)] = 'P9999';
  sh.getRange(sh.getLastRow() + 1, 1, 1, head.length).setValues([line]);

  const s = gas.apiGetPaperListState(Q_NOW);
  const ghost = s.noEmail.filter(function (p) { return p.personId === 'P9999'; })[0];
  check('★★★★★ 查唔到名嗰個仍然會出現喺名單度'
    + '（略過咗 ⇒ 幹事少印一份，而且完全唔知少咗邊個）', !!ghost,
    JSON.stringify(s.noEmail));
  check('★★★★★ 而且明明白白寫住「查不到這個編號」，唔係一個空白名',
    ghost && ghost.nameTC.indexOf('查不到') !== -1, ghost && ghost.nameTC);
}

// =====================================================================
console.log('\n=== 這幾個 api 全部係唯讀 ===');
{
  const fs = require('fs');
  const path = require('path');
  const READ_ONLY = [
    ['WebAppMainFlow.gs', 'apiGetMainFlowState'],
    ['WebAppMainFlow.gs', 'apiGetPaperListState'],
    ['WebAppSendPlan.gs', 'apiGetSendPlanSummary'],
    ['EligibilitySheetEditor.gs', 'apiPlanEligibilitySheetApply']
  ];
  READ_ONLY.forEach(function (pair) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', pair[0]), 'utf8');
    const start = src.indexOf('function ' + pair[1] + '(');
    const body = src.slice(start, src.indexOf('\n}', start));
    const bare = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('★★★★★ ' + pair[1] + ' 冇任何寫入'
      + '——佢喺前端嘅唯讀白名單度，一寫入就會令狀態快取唔同步',
      !/setValue|setValues|insertSheet|deleteSheet|writeAuditLog_/.test(bare),
      bare.slice(0, 200));
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
