// 第六十三輪批次 S 組：第 2 步提示（狀態卡）同寄出閘有冇讀到唔同嘅「未儲存改動」。
// 執行方式：node tests/dashboard_unsaved_consistency.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 瀏覽器實測，兩次；同一次測試另外兩次就正確）
// ═════════════════════════════════════════════════════════════════════
//
//   ・`Requests` 加咗 3 行申報（有 QuarterID），撳「重新整理」，第 2 步寫
//     「堂委沒有提出改動」；30 秒後撳「儲存及寄出」，確認畫面正確列出 2＋1 筆
//   ・grid 用下拉改咗 1 格，撳「重新整理」，第 2 步寫「未偵測到你在表上改過
//     任何格」；隨即撳「寄出」，卻正確攔住「你有 1 格改動還未儲存」
//
// 讀碼睇唔出分別：兩邊都叫 `readDashboardUnsavedState_()`；唯一分別係狀態卡
// 喺 `apiGetDashboardState()` 嘅 `readSheet()` 記憶入面行。
//
// 呢個測試係**重現嘗試**：用真入口生成、真 grid 工作表、真申報表，逐個情境
// 比較「狀態卡（開記憶）」同「寄出閘（冇記憶）」讀到嘅數字。
// **結果：三個情境都一樣**——即係喺程式層面重現唔到。所以 S 組冇改邏輯，
// 只加咗診斷 log（`logDashboardUnsavedDiag_()`），呢度一齊鎖住。
//
// 如果日後有人改咗狀態卡嘅讀法（例如加快取），令兩邊讀到唔同嘅數字，
// 呢個測試會紅。
//
// （fixture 同 requests_quarter_id.test.js 一樣，由真入口生成；假季度、假 ID。）

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

// 捕捉 Logger（診斷 log 寫去呢度）
const logged = [];
gas.Logger = { log: function (m) { logged.push(String(m)); } };

function setStage(stage) {
  const sh = ss.getSheetByName(S.QUARTERS);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(3, keys.indexOf(C.QUARTERS.STAGE) + 1).setValue(stage);
}
function addReq(dateStr, personId) {
  appendRows(ss, S.REQUESTS, RKEYS, [{
    [RQ.QUARTER_ID]: Q, [RQ.SERVICE_DATE]: dateStr, [RQ.POST_NAME]: '獻花',
    [RQ.PERSON_NAME]: PEOPLE[personId], [RQ.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE }]);
}
function editGridChair(versionNo, row) {
  const g = ss.getSheetByName(gas.buildRosterSheetName_(Q, versionNo));
  const keys = g.getRange(2, 1, 1, g.getLastColumn()).getValues()[0];
  const col = keys.indexOf('CHAIR#1') + 1;
  const cur = String(g.getRange(row, col).getValue());
  const other = Object.keys(PEOPLE).map(function (id) { return PEOPLE[id]; })
    .filter(function (n) { return n !== cur; })[0];
  g.getRange(row, col).setValue(other);
}
/** 狀態卡（`apiGetDashboardState()`，開住 readSheet 記憶）同寄出閘（冇記憶）各讀一次。 */
function readBoth(versionNo) {
  const dash = gas.apiGetDashboardState(Q);
  const gate = gas.readDashboardUnsavedState_(Q, versionNo);
  return { dash: dash, gate: gate };
}
const FIELDS = ['gridChangeCount', 'unresolvedCount', 'pendingRequestCount', 'needsInputCount', 'hasAny'];
function same(a, b) {
  return FIELDS.every(function (k) { return a[k] === b[k]; });
}
function pick(o) {
  const out = {};
  FIELDS.forEach(function (k) { out[k] = o[k]; });
  return JSON.stringify(out);
}

const v0 = gas.findLatestVersionNo(Q);
setStage('REVIEW_SENT');

// =====================================================================
console.log('\n=== S1（現場第一次）：已寄堂委，申報表加咗申報 ⇒ 第 2 步要講有申報 ===');
{
  const r0 = readBoth(v0);
  // 第八十二輪批次 IG 組（刻意改動）：審閱階段冇改動都只係「未偵測到」（唔再講「堂委沒有提出改動」）
  check('（前提）未加申報 ⇒「未偵測到你在表上改過任何格」',
    /^未偵測到你在表上改過任何格/.test(r0.dash.buttons.save.dynamicText), r0.dash.buttons.save.dynamicText);
  addReq(DATES[1], 'P9702');
  addReq(DATES[2], 'P9703');
  const r = readBoth(v0);
  check('★★★★★★ 狀態卡讀到 2 筆待處理（唔係 0）', r.dash.unsaved.pendingRequestCount === 2, pick(r.dash.unsaved));
  check('★★★★★★ 同寄出閘讀到嘅一樣', same(r.dash.unsaved, r.gate), pick(r.dash.unsaved) + ' vs ' + pick(r.gate));
  check('★★★★★ 第 2 步唔再寫「堂委沒有提出改動」',
    r.dash.buttons.save.dynamicText === '有 2 筆修改申報未處理。', r.dash.buttons.save.dynamicText);
}

console.log('\n=== S2（現場第二次）：grid 改咗 1 格 ⇒ 第 2 步要講改咗 1 格 ===');
{
  editGridChair(v0, 4);
  const r = readBoth(v0);
  check('★★★★★★ 狀態卡讀到 1 格改動', r.dash.unsaved.gridChangeCount === 1, pick(r.dash.unsaved));
  check('★★★★★★ 同寄出閘讀到嘅一樣', same(r.dash.unsaved, r.gate), pick(r.dash.unsaved) + ' vs ' + pick(r.gate));
  check('★★★★★ 第 2 步寫「偵測到你在表上改了 1 格」',
    /^偵測到你在表上改了 1 格/.test(r.dash.buttons.save.dynamicText), r.dash.buttons.save.dynamicText);
}

console.log('\n=== S3：儲存成新版本之後，喺新版本再改 1 格（現場第二次係喺儲存後嘅版本改） ===');
{
  const saved = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  const v1 = gas.findLatestVersionNo(Q);
  check('（前提）儲存成新版本', saved && saved.ok !== false && v1 === v0 + 1, JSON.stringify(saved).slice(0, 300));
  const r0 = readBoth(v1);
  check('（前提）儲存完 ⇒ 冇未儲存改動', r0.dash.unsaved.hasAny === false && same(r0.dash.unsaved, r0.gate),
    pick(r0.dash.unsaved));
  editGridChair(v1, 5);
  const r = readBoth(v1);
  check('★★★★★★ 狀態卡讀到新版本嗰 1 格', r.dash.unsaved.gridChangeCount === 1, pick(r.dash.unsaved));
  check('★★★★★★ 同寄出閘讀到嘅一樣', same(r.dash.unsaved, r.gate), pick(r.dash.unsaved) + ' vs ' + pick(r.gate));
}

// =====================================================================
console.log('\n=== S：診斷 log ===');
{
  const diag = logged.filter(function (m) { return m.indexOf('[DIAG] 未儲存狀態 ') === 0; });
  check('★★★★★ 每次讀都寫一行診斷（狀態卡＋寄出閘）', diag.length >= 8, 'n=' + diag.length);
  const last = diag[diag.length - 1] || '';
  check('★★★★★ 寫齊：季度、版本、grid 名、改動格、申報分類、讀取時間、用時',
    new RegExp('^\\[DIAG\\] 未儲存狀態 ' + Q + ' v1 grid=Roster_' + Q + '_v1 改動格=1 認不出=0 '
      + '待處理申報=0 看不懂申報=0 不完整申報=\\d+ 讀取開始=\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z 用時=\\d+ms$').test(last),
    last);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function logDashboardUnsavedDiag_('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  check('★★★★★ 診斷唔寫任何工作表（呢條路喺唯讀記憶入面行）',
    /Logger\.log\(line\)/.test(body) && !/writeAuditLog_|appendRow|setValue|getSheetByName/.test(body));
  const err = gas.logDashboardUnsavedDiag_(Q, 0,
    { gridChangeCount: -1, unresolvedCount: -1, pendingRequestCount: -1, hasAny: true, error: '假錯誤' },
    Date.now(), null);
  check('★★★★ 讀唔到嘅時候都有一行（講明錯誤，數字係 -1／?）',
    / 改動格=-1 /.test(err) && / 看不懂申報=\? /.test(err) && / 錯誤=假錯誤$/.test(err), err);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
