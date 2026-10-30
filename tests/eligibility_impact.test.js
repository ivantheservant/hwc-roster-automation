// 第六十七輪批次 AI 組：改完名單要知道哪幾格要重排。
// FIXTURE-OK: 版本由 `apiGenerateDraftExecute()` 真入口產生；名單改動經
// `apiSaveEligibilityBatch()`（名單維護）同 `apiApplyEligibilitySheet()`（開季前第 0 步）
// 兩個真入口。唯一手砌嘅係名單工作表上嘅人手改動（外部輸入）。
// 執行方式：node tests/eligibility_impact.test.js
//
// 守住：
//   AI1　名單維護儲存完 ⇒ 回傳「最新一版有 N 格的人已不在該崗位名單上」＋逐格列出（人名、崗位中文名）
//   AI2　狀態卡（`apiGetDashboardState`）同一個數字；加返資格 ⇒ 0
//   AI3　開季前第 0 步「儲存並套用名單」同一支
//   AI4　畫面由同一支 `buildEligibilityImpactNodes()` 砌字，兩個結果窗都有〔請系統幫我調整〕

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Trigger.gs', 'WebAppGuards.gs', 'WebAppDashboard.gs',
  'WebAppGenerate.gs', 'GridNameDropdown.gs', 'MailRedirect.gs',
  'SendRecipients.gs', 'Mailer.gs',
  'WebAppRoster3Common.gs', 'WebAppEligibility.gs', 'EligibilitySheetEditor.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppSaveConfirm.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
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
const DATES = [];
const PEOPLE = { P9601: '假甲', P9602: '假乙', P9603: '假丙', P9604: '假丁' };

const ss = new RealisticMockSpreadsheet();
function dvBuilder() {
  const self = {
    requireValueInList: function () { return self; },
    setAllowInvalid: function () { return self; },
    setHelpText: function () { return self; },
    build: function () { return {}; }
  };
  return self;
}
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: dvBuilder,
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'ai@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    if (fmt === 'dd/MM') { const p = d.split('-'); return p[2] + '/' + p[1]; }
    return d + ' ' + t;
  },
  computeDigest: function (algo, input) {
    const crypto = require('crypto');
    return Array.from(crypto.createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest());
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };
gas.resolveMailAttachmentFolder_ = function () { return null; };
gas.checkMissingPersonalPdfs_ = function () { return { missing: [], total: 0 }; };

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 1,
      [C.QUARTERS.START_DATE]: '2099-01-04', [C.QUARTERS.END_DATE]: '2099-02-22', [C.QUARTERS.STAGE]: 'DRAFT' }]);
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(2099, 0, 4 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    DATES.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['D'], [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID,
    C.SERVICE_DATES.SERVICE_DATE, C.SERVICE_DATES.WEEK_INDEX, C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
  DATES.map(function (d, i) {
    return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
      [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
      [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
  }));
  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE, C.POSTS.ALLOW_CONSECUTIVE,
    C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
  [['CHAIR', '主席', true], ['READ', '讀經', true], ['PREACH', '講員', false]].map(function (p, i) {
    return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
      [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY', [C.POSTS.AUTO_GENERATE]: p[2],
      [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW', [C.POSTS.MUTEX_GROUP]: '', [C.POSTS.DISPLAY_ORDER]: i + 1,
      [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
  }));
  seedSheet(ss, S.NAME_MAPPING, ['N'], [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id],
        [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
    }));
  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) { elig.push(['CHAIR', id]); elig.push(['READ', id]); });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
    C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE, C.ELIGIBILITY.HISTORICAL_COUNT, C.ELIGIBILITY.SOURCE,
    C.ELIGIBILITY.ADDED_BY, C.ELIGIBILITY.ADDED_AT],
  elig.map(function (p, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0], [C.ELIGIBILITY.PERSON_ID]: p[1],
      [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true, [C.ELIGIBILITY.HISTORICAL_COUNT]: 0 };
  }));
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
    C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY],
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD', [C.RULE_SETTINGS.ENABLED]: true,
      [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS', 'SPECIAL_SUNDAYS',
    'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS', 'EMAIL_RECIPIENTS', 'EMAIL_TEMPLATES'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
}
buildFixture();

function whoIsOn(versionNo, date, post) {
  const row = gas.readSheet_(S.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && gas.toDateString_(r[A.SERVICE_DATE], TZ) === date && r[A.POST_ID] === post;
  })[0];
  return row ? String(row[A.PERSON_ID] || '') : null;
}
function cellsOf(versionNo, personId, post) {
  return gas.readSheet_(S.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && r[A.POST_ID] === post && String(r[A.PERSON_ID] || '') === personId;
  }).map(function (r) { return gas.toDateString_(r[A.SERVICE_DATE], TZ); });
}

// =====================================================================
console.log('\n=== 前置：生成初稿 ===');
check('（前置）生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
const V0 = gas.findLatestVersionNo_(Q);
const TARGET = whoIsOn(V0, DATES[1], 'CHAIR');
const TARGET_CELLS = cellsOf(V0, TARGET, 'CHAIR');
check('（前置）嗰個人喺 v0 做過主席', TARGET && TARGET_CELLS.length >= 1, JSON.stringify(TARGET_CELLS));

console.log('\n=== AI1【核心】名單維護：取消一個人嘅主席資格 ⇒ 講得出邊幾格受影響 ===');
let impact = null;
{
  check('（對照）未改名單 ⇒ 0 格', gas.apiGetDashboardState(Q).eligibilityImpact.count === 0);
  const res = gas.apiSaveEligibilityBatch([{ personId: TARGET, postId: 'CHAIR', eligible: false }], Q);
  check('★★★★ 儲存成功', res.ok === true && res.removed === 1, JSON.stringify(res).slice(0, 300));
  impact = res.eligibilityImpact;
  check('★★★★★★ 回傳 `eligibilityImpact`，而且冇錯', !!impact && !impact.error, JSON.stringify(impact));
  checkEqual('★★★★★★ 格數 ＝ 嗰個人喺最新一版做主席嘅格數', impact.count, TARGET_CELLS.length);
  check('★★★★★ 逐格列出：日期、崗位中文名、人名', impact.items.every(function (it) {
    return TARGET_CELLS.indexOf(it.serviceDate) !== -1 && it.postNameTC === '主席' && it.personName === PEOPLE[TARGET];
  }), JSON.stringify(impact.items));
  check('★★★★ 版本號係最新一版', impact.versionNo === V0, impact.versionNo);
}

console.log('\n=== AI2【核心】狀態卡同一個數字；加返資格 ⇒ 0 ===');
{
  const dash = gas.apiGetDashboardState(Q);
  checkEqual('★★★★★★ `apiGetDashboardState().eligibilityImpact.count` 同儲存結果一樣', dash.eligibilityImpact.count, impact.count);
  const back = gas.apiSaveEligibilityBatch([{ personId: TARGET, postId: 'CHAIR', eligible: true }], Q);
  check('★★★★★ 加返資格 ⇒ 0 格', back.ok === true && back.eligibilityImpact.count === 0, JSON.stringify(back.eligibilityImpact));
  checkEqual('★★★★ 冇傳季度（例如加新人嗰條路）⇒ null，唔會冧',
    gas.apiSaveEligibilityBatch([], undefined).eligibilityImpact, null);
}

console.log('\n=== AI3【核心】開季前第 0 步「儲存並套用名單」同一支 ===');
{
  const opened = gas.apiOpenEligibilitySheet();
  const sheet = ss.getSheetByName(opened.sheetName);
  const postIds = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const chairCol = postIds.indexOf('CHAIR') + 1;
  check('（前置）名單工作表有主席欄', chairCol > 0, postIds.join(','));
  // 幹事喺主席欄把嗰個人清走——外部輸入，手砌係正路
  let cleared = false;
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (String(sheet.getRange(r, chairCol).getValue() || '') === PEOPLE[TARGET]) {
      sheet.getRange(r, chairCol).setValue(''); cleared = true; break;
    }
  }
  check('（前置）清走咗', cleared);
  const applied = gas.apiApplyEligibilitySheet(Q);
  check('★★★★ 套用成功', applied.changed === true && applied.removed === 1, JSON.stringify(applied).slice(0, 300));
  checkEqual('★★★★★★ 結果帶 `eligibilityImpact`，格數同名單維護嗰條路一樣', applied.eligibilityImpact.count, TARGET_CELLS.length);
  check('★★★★★ 人名崗位同樣寫出', applied.eligibilityImpact.items[0].personName === PEOPLE[TARGET]
    && applied.eligibilityImpact.items[0].postNameTC === '主席', JSON.stringify(applied.eligibilityImpact.items[0]));
  checkEqual('★★★★ 狀態卡跟住變', gas.apiGetDashboardState(Q).eligibilityImpact.count, TARGET_CELLS.length);
}

console.log('\n=== AI4【核心】畫面：同一支函式、有〔請系統幫我調整〕出口 ===');
{
  const ui = loadUiScripts(['Script.html']);
  const text = function (nodes) { return nodes.map(function (n) { return n.textContent; }).join('\n'); };
  const plain = text(ui.buildEligibilityImpactNodes(impact));
  // 第六十八輪批次 AM 組：狀態卡／第 2 步唔假設「名單改過」，用中性句
  check('★★★★★★ 狀態卡版本：「這一版有 N 格的人不在該崗位的名單上（你已放行的不計在內）」，唔講「名單改了之後」',
    plain.indexOf('這一版有 ' + impact.count + ' 格的人不在該崗位的名單上（你已放行的不計在內）') !== -1
    && plain.indexOf('名單改了之後') === -1, plain);
  const plainSaved = text(ui.buildEligibilityImpactNodes(impact, { withButton: true }));
  check('★★★★★★ 儲存名單後嘅結果窗：保留「名單改了之後，這一版有 N 格的人已經不在該崗位的名單上」',
    new RegExp('名單改了之後，這一版有 ' + impact.count + ' 格的人已經不在該崗位的名單上').test(plainSaved), plainSaved);
  check('★★★★★ 列出人名同崗位', plain.indexOf(PEOPLE[TARGET]) !== -1 && plain.indexOf('主席') !== -1, plain);
  const hasButton = function (node) {
    if (node.tagName === 'BUTTON' && node.textContent === '請系統幫我調整') return true;
    return (node.children || []).some(hasButton);
  };
  check('★★★★ 狀態卡／第 2 步用嘅版本：講明出口、但冇掣', /按「請系統幫我調整」/.test(plain)
    && !ui.buildEligibilityImpactNodes(impact).some(hasButton), plain);
  const withBtn = ui.buildEligibilityImpactNodes(impact, { withButton: true });
  check('★★★★★★ 結果窗版本有一粒〔請系統幫我調整〕', withBtn.some(hasButton));
  checkEqual('★★★★ 0 格 ⇒ 冇節點', ui.buildEligibilityImpactNodes({ count: 0, items: [], moreCount: 0, error: '' }).length, 0);
  check('★★★★★ 算唔到 ⇒ 講一句', /算不到/.test(text(ui.buildEligibilityImpactNodes({ count: 0, items: [], moreCount: 0, error: '壞了' }))));

  const read = function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', f), 'utf8'); };
  check('★★★★★ 名單維護儲存後叫 buildEligibilityImpactNodes(res.eligibilityImpact, { withButton: true })',
    /buildEligibilityImpactNodes\(res\.eligibilityImpact, \{ withButton: true \}\)/.test(read('ScriptZone3.html')));
  check('★★★★★ 名單維護儲存傳埋季度', /'apiSaveEligibilityBatch', changes, currentQuarterId\)/.test(read('ScriptZone3.html')));
  check('★★★★★ 第 0 步結果窗叫 buildEligibilityImpactNodes(r.eligibilityImpact, { withButton: true })',
    /buildEligibilityImpactNodes\(r\.eligibilityImpact, \{ withButton: true \}\)/.test(read('ScriptMainFlow.html')));
  check('★★★★ 第 2 步卡叫 buildEligibilityImpactNodes(d.eligibilityImpact)',
    /buildEligibilityImpactNodes\(d\.eligibilityImpact\)/.test(read('ScriptMainFlow.html')));
  check('★★★★ 狀態卡叫 buildEligibilityImpactNodes(d.eligibilityImpact)',
    /buildEligibilityImpactNodes\(d\.eligibilityImpact\)/.test(read('Script.html')));
}

console.log('\n=== AM【核心】已放行嘅格唔計入「不在名單上」提示 ===');
{
  // 此刻（AI3 之後）：TARGET 已經唔喺主席名單上，佢喺最新一版嘅主席格全部未放行
  const before = gas.apiGetDashboardState(Q).eligibilityImpact;
  checkEqual('（前置）未放行 ⇒ 狀態卡數到 TARGET 嘅全部主席格', before.count, TARGET_CELLS.length);
  // 幹事明知而放行：用真正寫放行紀錄嗰支（匯入、儲存確認放行都係呢支），key 取自狀態卡自己列出嘅違反
  gas.logHardViolationRelease_(Q, 'eligibility_impact.test（模擬幹事放行）', before.items.map(function (it) {
    return { serviceDate: it.serviceDate, postId: it.postId, slotIndex: it.slotIndex,
      personId: it.personId, ruleId: gas.RULE_IDS.ELIGIBILITY, postNameTC: it.postNameTC, personName: it.personName };
  }), V0);
  const released = gas.apiGetDashboardState(Q).eligibilityImpact;
  checkEqual('★★★★★★ 全部放行 ⇒ 狀態卡冇提示（0 格）', released.count, 0);
  const uiAm = loadUiScripts(['Script.html']);
  checkEqual('★★★★★ 狀態卡冇節點', uiAm.buildEligibilityImpactNodes(released).length, 0);

  // 另一格（讀經）未放行 ⇒ 只數嗰幾格，唔計已放行嘅主席格
  const READER = whoIsOn(V0, DATES[2], 'READ');
  const READ_CELLS = cellsOf(V0, READER, 'READ');
  check('（前置）有人做過讀經', !!READER && READ_CELLS.length >= 1, JSON.stringify(READ_CELLS));
  const res = gas.apiSaveEligibilityBatch([{ personId: READER, postId: 'READ', eligible: false }], Q);
  check('（前置）取消讀經資格成功', res.ok === true, JSON.stringify(res).slice(0, 200));
  const mixed = gas.apiGetDashboardState(Q).eligibilityImpact;
  checkEqual('★★★★★★ 另一格未放行 ⇒ 提示只數未放行嗰幾格', mixed.count, READ_CELLS.length);
  check('★★★★★ 列出嘅全部係讀經，冇主席（已放行）', mixed.items.every(function (it) { return it.postId === 'READ'; }), JSON.stringify(mixed.items));
  checkEqual('★★★★ 結果窗（儲存名單後）同一個數字', res.eligibilityImpact.count, READ_CELLS.length);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
