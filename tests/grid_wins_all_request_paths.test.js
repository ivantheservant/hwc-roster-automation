// 第三十八輪批次 F 組：「grid 贏」要喺**每一條套用申報嘅路**上生效。
// 執行方式：node tests/grid_wins_all_request_paths.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// 規格 1.4：同一格幹事已經喺職事表上親手改咗 ⇒ **以幹事改嗰個為準**，
// 嗰筆申報唔套用，但**一定要記低**（Requests 嘅處理結果欄要講得出），
// 否則嗰位義工提交嘅要求就無聲無息消失咗。
//
// 第三十四輪喺掣 1「儲存並確認」實作咗呢一條。但實作方式係
// **由呼叫端傳一個列號清單入 `applyRequests_()`**，而全系統有三條路
// 會叫 `applyRequests_()`：
//
//   掣 1「儲存並確認」　`apiSaveAndConfirmExecute()`（WebAppSaveConfirm.gs）✅ 有傳
//   步驟 3「套用修改申報」`executeStep3Apply_()`（FiveStageCore.gs）　　　　❌ 冇傳
//   步驟 5「改動後重發」　`executeStep5Send_()` 嗰條（FiveStageCore.gs）　　❌ 冇傳
//
// 冇傳嗰兩條路，個 set 係空嘅 ⇒ 整段 grid 贏嘅邏輯直接跳過 ⇒
// 申報照樣蓋過幹事親手改嗰格，而且冇任何提示。
//
// 呢個同第十九輪嗰個 bug 係同一件事嘅下半截：嗰時修好咗「睇邊度」
//（讀 grid 唔讀長表），但「邊個贏」只喺一條路上實作咗。
//
// ⚠️ 呢一份**一定要由真入口叫落去**（第三十八輪 B 組）。
// 直接叫 `applyRequests_()` 就證明唔到步驟 3 嗰條路有冇行過呢段邏輯。

const { loadGasSource } = require('./helpers/gas_loader.js');
const {
  RealisticMockSpreadsheet, seedSheet, appendRows
} = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs'
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

const Q = '2099T1';
const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS;
const S = gas.SHEETS;
const A = C.ROSTER_ASSIGNMENTS;
const R = C.REQUESTS;
const DATES = [];

const PEOPLE = { P9601: '假甲', P9602: '假乙', P9603: '假丙', P9604: '假丁' };

const ss = new RealisticMockSpreadsheet();
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
gas.Session = {
  getActiveUser: function () { return { getEmail: function () { return 'f@example.invalid'; } }; }
};
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date);
    return d + ' ' + t;
  },
  sleep: function () {}
};
gas.log_ = function () {};
// Web 入口嘅存取閘（WebApp.gs）唔喺載入清單——呢一份唔係測存取控制。
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 1,
      [C.QUARTERS.START_DATE]: '2099-01-04', [C.QUARTERS.END_DATE]: '2099-02-22',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  for (let i = 0; i < 8; i++) {
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
  [['CHAIR', '主席'], ['READ', '讀經']].map(function (p, i) {
    return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
      [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
      [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW',
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
    C.RULE_SETTINGS.PRIORITY], []);

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

function cellOf(v, date, post) {
  return gas.readSheet(S.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === v
      && gas.toDateString(r[A.SERVICE_DATE], TZ) === date && r[A.POST_ID] === post;
  })[0];
}

/** 模擬幹事喺 grid 工作表打字——呢個係外部輸入，手砌係正路。 */
function setGrid(v, date, post, text) {
  const sh = ss.getSheetByName(gas.buildRosterSheetName_(Q, v));
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  let col = -1;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i]) === post + '#1') { col = i + 1; break; }
  }
  if (col === -1) return false;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) !== date) continue;
    sh.getRange(r, col).setValue(text);
    return true;
  }
  return false;
}

function requestRowsFor(quarterId) {
  return gas.readSheet(S.REQUESTS).filter(function (r) { return r[R.QUARTER_ID] === quarterId; });
}

// =====================================================================
console.log('\n=== 前置：生成初稿 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
// 步驟 3 要求 Stage 已經行到 REVIEW_SENT。呢度用系統自己嘅
// `advanceQuarterStage_()` 推上去，唔直接改 Quarters 工作表——
// 前面步驟 1／2 涉及真正寄信，唔屬於呢一份嘅範圍。
gas.advanceQuarterStage_(Q, gas.QUARTER_STAGE.REVIEW_SENT);
checkEqual('（前置）Stage 已經行到步驟 3 可以做嘅位置',
  gas.getQuarterStage_(Q), gas.QUARTER_STAGE.REVIEW_SENT);

// =====================================================================
console.log('\n=== F 組【核心】步驟 3 嗰條路：grid 贏，而且申報要記低 ===');
{
  const base = gas.findLatestVersionNo(Q);
  const before = String(cellOf(base, DATES[2], 'CHAIR')[A.PERSON_ID]);
  const mine = Object.keys(PEOPLE).find(function (id) { return id !== before; });
  const theirs = Object.keys(PEOPLE).find(function (id) { return id !== before && id !== mine; });

  // 幹事親手把呢一格改成「mine」
  check('（前置）幹事喺 grid 親手改咗 ' + DATES[2] + ' 主席',
    setGrid(base, DATES[2], 'CHAIR', PEOPLE[mine]));

  // 同一格有一筆申報想改成「theirs」
  appendRows(ss, S.REQUESTS, [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME,
    R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS], [
    { [R.REQUEST_ID]: '', [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: DATES[2],
      [R.POST_NAME]: '主席', [R.PERSON_NAME]: PEOPLE[theirs],
      [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' }]);

  // ── 由真入口叫落去：步驟 3 ────────────────────────────────────
  const plan = gas.apiStep3Plan(Q);
  check('（前置）步驟 3 認到有一筆待處理申報',
    plan && plan.mode === 'HAS_PENDING', JSON.stringify(plan && plan.mode));

  const res = gas.apiStep3Apply(Q, []);
  check('★★★★ 步驟 3 行得完', !!res, JSON.stringify(res).slice(0, 200));

  const next = gas.findLatestVersionNo(Q);
  checkEqual('★★★★★ **幹事親手改嗰個人留低咗**'
    + '（修正之前：申報會靜靜蓋過去，幹事改完跑完步驟 3 就冇咗，冇任何提示）',
    String(cellOf(next, DATES[2], 'CHAIR')[A.PERSON_ID]), mine);

  const req = requestRowsFor(Q).filter(function (r) { return gas.toDateString(r[R.SERVICE_DATE], TZ) === DATES[2] && r[R.POST_NAME] === '主席'; })[0];
  checkEqual('★★★★★ 而嗰筆申報唔可以就噉消失——Status 要寫得出佢冇被套用',
    String(req[R.STATUS]), gas.REQUEST_STATUS.REJECTED);
  check('★★★★★ 而且處理結果欄講得出**點解**（義工提交嘅要求唔可以無聲無息消失）',
    String(req[R.RESULT_NOTE] || '').indexOf('親手改過') !== -1,
    '處理結果 = ' + JSON.stringify(String(req[R.RESULT_NOTE] || '')));
}

// =====================================================================
console.log('\n=== F 組：反方向——冇人手改動嗰格，申報照樣要生效 ===');
{
  const base = gas.findLatestVersionNo(Q);
  const before = String(cellOf(base, DATES[4], 'READ')[A.PERSON_ID]);
  const theirs = Object.keys(PEOPLE).find(function (id) { return id !== before; });

  appendRows(ss, S.REQUESTS, [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME,
    R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS], [
    { [R.REQUEST_ID]: '', [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: DATES[4],
      [R.POST_NAME]: '讀經', [R.PERSON_NAME]: PEOPLE[theirs],
      [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' }]);

  gas.apiStep3Apply(Q, []);
  const next = gas.findLatestVersionNo(Q);

  checkEqual('★★★★★ 冇人手改動嗰格，申報照樣套用'
    + '（唔係就代表修正把所有申報都擋咗，等於整個申報功能失效）',
    String(cellOf(next, DATES[4], 'READ')[A.PERSON_ID]), theirs);
  const req = requestRowsFor(Q).filter(function (r) { return gas.toDateString(r[R.SERVICE_DATE], TZ) === DATES[4] && r[R.POST_NAME] === '讀經'; })[0];
  checkEqual('★★★★★ 而且 Status 係 APPLIED',
    String(req[R.STATUS]), gas.REQUEST_STATUS.APPLIED);
}

// =====================================================================
console.log('\n=== F 組：呼叫端傳咗清單嗰陣，以呼叫端為準（掣 1 嗰條路唔變）===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'RequestsApply.gs'), 'utf8');
  const i = src.indexOf('const gridOverriddenSet = {};');
  const seg = src.slice(i, src.indexOf('const workingByKey = {};', i));
  check('★★★★★ 有傳 `gridOverriddenSheetRows` 就用佢，冇傳先自己算'
    + '（掣 1 嗰條路已經喺 plan 嗰邊算好，唔可以喺呢度覆蓋佢）',
    /if \(gridOverriddenSheetRows\)/.test(seg) && /else/.test(seg), seg.slice(-400));
  // ⚠️ 第三十九輪批次（順手）：呢個判斷本來喺兩個檔各寫一次
  // （呢度同 `buildSaveAndConfirmPlan_()` 嘅 `overlaps`）。
  // 兩段答案一致，但係兩個真相來源——本專案反覆出事嗰一類。
  // 而家合併成 `findRequestGridOverlaps_()`，兩邊都叫佢。
  //
  // 所以呢一條由「檢查嗰段推導」改成守更緊要嗰件事：**兩邊真係同一個函式**。
  check('★★★★★ 自己算嗰段係叫共用嘅 `findRequestGridOverlaps_()`',
    /findRequestGridOverlaps_\(plan\)/.test(seg), seg.slice(-500));
  check('★★★★★ 而掣 1 嗰條路叫嘅係**同一個**函式'
    + '——唔係同一個，就係兩個真相來源，改一個另一個唔會跟',
    /findRequestGridOverlaps_\(requestPlan/.test(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', 'src', 'WebAppSaveConfirm.gs'), 'utf8')));
  check('★★★★★ 而嗰個共用函式係睇 `plan.assignByKey[...].isManual`'
    + '（grid 疊加算出嚟嘅「幹事有冇親手改過」，唯一來源）',
    /findRequestGridOverlaps_[\s\S]{0,1400}assignByKey\[[\s\S]{0,200}isManual/.test(src),
    '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
