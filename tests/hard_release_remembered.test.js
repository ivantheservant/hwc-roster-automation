// 第六十七輪批次 AG／AH 組：放行整季記住；寄出前講空格同已放行。
// FIXTURE-OK: 全部資料由真入口產生（`apiGenerateDraftExecute()` ＋ grid 打字 ＋
// `apiSaveAndConfirmExecute()`）。唯一手砌嘅係 AuditLog 嘅**舊格式**放行行
//（第五十三至六十六輪主流程寫落嘅嗰種）——舊紀錄係既有資料，手砌係正路。
// 執行方式：node tests/hard_release_remembered.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan：「人手改動可以違反規則，放行之後整季記住」、「有空格也可以發出，但要有警告」。
//
// 現場（第六十六輪之前）：主流程「儲存及寄出」放行時只寫一行人類可讀嘅稽核紀錄
//（`action='放行硬規則違反'`、notes `日期　PostID#slot　RuleID`），**冇 PersonID**，
// `classifyHardViolations_()` 認唔返 ⇒ 下一次儲存同一狀態又要打字；「請系統幫我調整」
// 又會建議改走佢已經決定嘅格。
//
//   AG1　放行一次 → 再儲存同一狀態 ⇒ 唔使打字，清單喺「已放行」而且講得出第幾版放行
//   AG2　換人 ⇒ 要重新放行（範圖＝同季度、同格、同人、同規則）
//   AG3　「請系統幫我調整」唔會動已放行嘅格，就算勾咗都唔動
//   AG4　舊格式紀錄：核對得到該版本嗰格嘅人先認；核對唔到就唔認
//   AH1　人手清空一格 ⇒ 三個寄出確認框同狀態卡嘅資料都有它；特別主日跳過嘅唔算
//   AH2　畫面：三個確認框同狀態卡由同一支 `buildSendWarningNodes()` 砌字

const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const {
  RealisticMockSpreadsheet, seedSheet
} = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Trigger.gs', 'WebAppGuards.gs', 'WebAppDashboard.gs',
  'WebAppGenerate.gs', 'GridNameDropdown.gs', 'MailRedirect.gs',
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'SendOptions.gs', 'PersonalLinkInMail.gs',
  'SuggestionSheet.gs', 'CellDecisions.gs',
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
// P9603／P9604 **只可以**做讀經——放落主席就係 HARD_ELIGIBILITY。
const PEOPLE = { P9601: '假甲', P9602: '假乙', P9603: '假丙', P9604: '假丁' };
const READ_ONLY = ['P9603', 'P9604'];

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
gas.Session = {
  getActiveUser: function () { return { getEmail: function () { return 'ag@example.invalid'; } }; }
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
    if (fmt === 'dd/MM') { const p = d.split('-'); return p[2] + '/' + p[1]; }
    return d + ' ' + t;
  },
  parseDate: function (str, tz, fmt) {
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) throw new Error('mock Utilities.parseDate: 唔支援嘅格式 fmt=' + fmt + ' str=' + str);
    const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    let guess = new Date(target);
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).formatToParts(guess);
      const o = {};
      parts.forEach(function (p) { if (p.type !== 'literal') o[p.type] = p.value; });
      const asIfUTC = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day),
        Number(o.hour) % 24, Number(o.minute), Number(o.second));
      const diff = target - asIfUTC;
      if (diff === 0) break;
      guess = new Date(guess.getTime() + diff);
    }
    return guess;
  },
  computeDigest: function (algo, input) {
    const crypto = require('crypto');
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
    return Array.from(crypto.createHash('sha256').update(bytes).digest());
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
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' },
    // 第七十五輪批次 CC 組：特別主日預設關閉；呢份測試守嘅係「開住」嗰陣嘅舊行為
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SPECIAL_SUNDAYS_ENABLED, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' }]);
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
      [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
  }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    if (READ_ONLY.indexOf(id) === -1) elig.push(['CHAIR', id]);
    elig.push(['READ', id]);
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
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
      [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));

  // 特別主日：DATES[6] 跳過讀經 ⇒ 嗰一格冇人係**刻意**嘅，唔算空格。
  seedSheet(ss, S.SPECIAL_SUNDAYS, ['SS'], Object.keys(C.SPECIAL_SUNDAYS).map(function (x) { return C.SPECIAL_SUNDAYS[x]; }), [
    { [C.SPECIAL_SUNDAYS.SPECIAL_ID]: 'SP1', [C.SPECIAL_SUNDAYS.QUARTER_ID]: Q,
      [C.SPECIAL_SUNDAYS.SERVICE_DATE]: DATES[6], [C.SPECIAL_SUNDAYS.TYPE]: '合堂',
      [C.SPECIAL_SUNDAYS.TITLE]: '', [C.SPECIAL_SUNDAYS.SKIP_POST_IDS]: 'READ',
      [C.SPECIAL_SUNDAYS.LOCK_POST_IDS]: '', [C.SPECIAL_SUNDAYS.ACTIVE]: true }]);

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS', 'EMAIL_RECIPIENTS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'],
    [C.EMAIL_TEMPLATES.TEMPLATE_ID, C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG,
      C.EMAIL_TEMPLATES.SUBJECT, C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN,
      C.EMAIL_TEMPLATES.ATTACH_TYPE, C.EMAIL_TEMPLATES.ACTIVE],
    ['REVIEW', 'OFFICIAL', 'RESEND'].map(function (stage) {
      return { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_' + stage + '_TC', [C.EMAIL_TEMPLATES.STAGE]: stage,
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true };
    }));
}
buildFixture();

/** 模擬幹事喺 grid 打字——外部輸入，手砌係正路。 */
function setGrid(sheetName, date, post, text) {
  const sh = ss.getSheetByName(sheetName);
  let keyRow = -1;
  for (let r = 1; r <= Math.min(sh.getLastRow(), 12); r++) {
    const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (row.some(function (v) { return String(v || '').indexOf('#') !== -1; })) { keyRow = r; break; }
  }
  if (keyRow === -1) return false;
  const head = sh.getRange(keyRow, 1, 1, sh.getLastColumn()).getValues()[0];
  let col = -1;
  for (let i = 0; i < head.length; i++) {
    if (String(head[i]) === post + '#1') { col = i + 1; break; }
  }
  if (col === -1) return false;
  for (let r = keyRow + 1; r <= sh.getLastRow(); r++) {
    if (gas.toDateString_(sh.getRange(r, 1).getValue(), TZ) !== date) continue;
    sh.getRange(r, col).setValue(text);
    return true;
  }
  return false;
}
function whoIsOn(versionNo, date, post) {
  const row = gas.readSheet_(S.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && gas.toDateString_(r[A.SERVICE_DATE], TZ) === date && r[A.POST_ID] === post;
  })[0];
  return row ? String(row[A.PERSON_ID] || '') : null;
}
function gridOf(versionNo) { return gas.buildRosterSheetName_(Q, versionNo); }
function auditRows() { return gas.readSheet_(S.AUDIT_LOG); }
/** 稽核表嘅標題行唔一定係第 1 行（fixture 有一行表名）——掃出嚟。 */
function auditHeader(sh) {
  for (let r = 1; r <= Math.min(sh.getLastRow(), 5); r++) {
    const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (row.indexOf(C.AUDIT_LOG.ACTION) !== -1) return { row: r, headers: row };
  }
  throw new Error('AuditLog 搵唔到標題行');
}
function appendAudit(action, targetKey, notes) {
  const sh = ss.getSheetByName(S.AUDIT_LOG);
  const headers = auditHeader(sh).headers;
  const L = C.AUDIT_LOG;
  const row = headers.map(function (h) {
    if (h === L.LOG_ID) return 'LEGACY' + sh.getLastRow();
    if (h === L.TIMESTAMP) return '2099-01-01 00:00:00';
    if (h === L.ACTION) return action;
    if (h === L.TARGET_SHEET) return S.ROSTER_ASSIGNMENTS;
    if (h === L.TARGET_KEY) return targetKey;
    if (h === L.NOTES) return notes;
    return '';
  });
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}
function deleteAuditRowsWhere(pred) {
  const sh = ss.getSheetByName(S.AUDIT_LOG);
  const head = auditHeader(sh);
  const headers = head.headers;
  for (let r = sh.getLastRow(); r > head.row; r--) {
    const vals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = vals[i]; });
    if (pred(obj)) sh.deleteRow(r);
  }
}
const CELL_DATE = 2;   // DATES[2] 主席——放落唔合資格嘅人

// =====================================================================
console.log('\n=== 前置：生成初稿，幹事把唔合資格嘅人放落主席 ===');
check('（前置）生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
const V0 = gas.findLatestVersionNo_(Q);
const ORIGINAL_CHAIR = whoIsOn(V0, DATES[CELL_DATE], 'CHAIR');
check('（前置）v0 嗰格本來有合資格嘅人', ORIGINAL_CHAIR && READ_ONLY.indexOf(ORIGINAL_CHAIR) === -1, ORIGINAL_CHAIR);
check('（前置）打字：假丁 → 主席', setGrid(gridOf(V0), DATES[CELL_DATE], 'CHAIR', PEOPLE.P9604));

let V1 = -1;
console.log('\n=== AG1【核心】第一次儲存要打字放行，而且寫落機器可讀紀錄 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(Q);
  // ⚠️ 第七十五輪批次 CF／CG 組（Ivan 決定）：打字放行換成逐格勾「保留我的安排，系統不要調整」。
  // 勾咗 ＝ 放行；儲存時轉成**同一套**機器可讀放行紀錄（下面全部斷言照舊）。
  check('★★★★★ 計劃：有 1 格真違反、要決定（勾選）', plan.needsDecision === true && plan.needsRelease === false
    && plan.violations.real.length === 1 && plan.violations.real[0].ruleId === 'HARD_ELIGIBILITY'
    && plan.decisionItems.rules.length === 1,
    JSON.stringify(plan.violations).slice(0, 400));
  let threw = null;
  try { gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] }); } catch (e) { threw = e; }
  check('★★★★★ 未勾 ⇒ 拒絕', threw !== null && /你還沒有決定/.test(threw.message), threw && threw.message);

  const it = plan.decisionItems.rules[0];
  gas.apiSetCellDecisions(Q, [{ serviceDate: it.serviceDate, postId: it.postId, slotIndex: it.slotIndex,
    kind: it.kind, cellText: it.cellText, ruleId: it.ruleId, checked: true }]);
  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★ 勾咗「保留我的安排」⇒ 建立新版本',
    result.ok === true && result.versionCreated === true, JSON.stringify(result).slice(0, 300));
  V1 = gas.findLatestVersionNo_(Q);
  checkEqual('★★★★ 新版本嗰格就係假丁', whoIsOn(V1, DATES[CELL_DATE], 'CHAIR'), 'P9604');

  const rows = auditRows().filter(function (r) { return r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_ACTION; });
  check('★★★★★★ 稽核有一行 `' + gas.HARD_RELEASE_ACTION + '`（機器可讀）', rows.length === 1,
    JSON.stringify(auditRows().map(function (r) { return r[C.AUDIT_LOG.ACTION]; })));
  const notes = rows.length ? String(rows[0][C.AUDIT_LOG.NOTES]) : '';
  const expectedKey = gas.buildHardViolationKey_(Q, {
    serviceDate: DATES[CELL_DATE], postId: 'CHAIR', slotIndex: 1, personId: 'P9604', ruleId: 'HARD_ELIGIBILITY' });
  check('★★★★★★ notes 有 6 欄 key（季度|日期|PostID|slot|PersonID|RuleID）',
    notes.indexOf(gas.HARD_RELEASE_KEY_PREFIX) !== -1 && notes.indexOf(expectedKey) !== -1, notes);
  check('★★★★★ notes 寫明放行版本 `' + gas.HARD_RELEASE_VERSION_PREFIX + V1 + '`',
    notes.indexOf(gas.HARD_RELEASE_VERSION_PREFIX + V1) !== -1, notes);
}

console.log('\n=== AG1【核心】再儲存同一狀態 ⇒ 唔使打字，清單喺「已放行」 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★★ needsDecision = false', plan.needsDecision === false, JSON.stringify(plan.violations.real).slice(0, 300));
  check('★★★★★★ 喺 `violations.released`', plan.violations.released.length === 1
    && plan.violations.released[0].personId === 'P9604', JSON.stringify(plan.violations.released).slice(0, 300));
  checkEqual('★★★★★ 說得出係第幾版放行', plan.violations.released[0].releasedVersionNo, V1);
  let threw = null;
  try { gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] }); } catch (e) { threw = e; }
  check('★★★★★ 唔打字都儲存得到（零改動路徑）', threw === null, threw && threw.message);

  // 第六十九輪批次 AR 組：確認畫面「已放行」分組每一行寫「（第 N 版放行）」（同狀態卡同一份 releasedVersionNo）；
  // 舊格式紀錄（冇版本號）唔寫。用真 plan 餵真函式。
  const uiAr = loadUiScripts(['Script.html']);
  const textOf = function (node) {
    return String(node.textContent || '') + (node.children || []).map(textOf).join('\n');
  };
  const shown = textOf(uiAr.renderViolations(plan.violations));
  check('★★★★★★ 已放行嗰行寫「（第 ' + V1 + ' 版放行）」', shown.indexOf('（第 ' + V1 + ' 版放行）') !== -1, shown);
  const legacy = textOf(uiAr.renderViolations({ real: [], structural: [], semiHard: [], released: [
    { serviceDate: DATES[CELL_DATE], postNameTC: '主席', slotIndex: 1, personName: PEOPLE.P9604, ruleId: 'HARD_ELIGIBILITY' }] }));
  check('★★★★★ 舊格式紀錄（冇版本號）：照列嗰格、但唔寫「版放行」',
    legacy.indexOf(PEOPLE.P9604) !== -1 && legacy.indexOf('版放行') === -1, legacy);
}

console.log('\n=== AG3【核心】「請系統幫我調整」唔動已放行嘅格 ===');
{
  // 幹事另外改咗一格（合資格嘅換人），令建議表有嘢可做
  const readNow = whoIsOn(V1, DATES[3], 'READ');
  const other = Object.keys(PEOPLE).filter(function (id) { return id !== readNow; })[0];
  check('（前置）另外改一格讀經', setGrid(gridOf(V1), DATES[3], 'READ', PEOPLE[other]));
  const r = gas.apiBuildSuggestion(Q);
  check('★★★★ 建議表建立成功', r.ok === true, JSON.stringify(r).slice(0, 300));
  const u = (r.untouchedManual || []).filter(function (x) {
    return x.serviceDate === DATES[CELL_DATE] && x.postNameTC === '主席';
  })[0];
  check('★★★★★★ 嗰格列喺「你改過、而違反規則的格」而且標 released', !!u && u.released === true,
    JSON.stringify(r.untouchedManual));
  checkEqual('★★★★★ 帶放行版本', u ? u.releasedVersionNo : null, V1);
  check('★★★★★ 系統冇改嗰格（systemCount 0）', r.systemCount === 0, JSON.stringify(r).slice(0, 300));

  // 就算勾咗（allowKeys）都唔動——已放行係幹事明確嘅決定
  const r2 = gas.apiBuildSuggestion(Q, 'GRID', [u ? u.key : '']);
  check('★★★★★★ 勾咗都唔動', r2.ok === true && r2.systemCount === 0
    && (r2.untouchedManual || []).some(function (x) { return x.released === true; }),
    JSON.stringify(r2).slice(0, 300));

  // 第六十九輪批次 AQ 組：已放行嘅格只喺「已放行」嗰段出現，「系統改完之後仍然違反」唔計佢。
  // 另外放一格**未放行**嘅真違反（同一個唔合資格嘅人，另一個主日）——「仍然違反」要剛好只有呢一格。
  const otherDate = DATES[5];
  const otherChairBefore = whoIsOn(V1, otherDate, 'CHAIR');
  check('（前置）另一個主日主席格：假丁（唔合資格、未放行）', setGrid(gridOf(V1), otherDate, 'CHAIR', PEOPLE.P9604));
  const rq = gas.apiBuildSuggestion(Q);
  check('★★★★ 建議表建立成功', rq.ok === true, JSON.stringify(rq).slice(0, 300));
  const remainingDates = (rq.remaining || []).map(function (x) { return x.serviceDate + '|' + x.postNameTC; });
  // ⚠️ 第七十五輪批次 CF 組（Ivan 決定）：冇勾「保留我的安排」嘅違反格，系統會試住調整
  //（唔再係「親手改過一律唔動」）。所以未放行嗰格唔再列喺「系統沒有動」，而係俾系統改。
  check('★★★★★★ 「仍然違反」唔計已放行嗰格',
    remainingDates.indexOf(DATES[CELL_DATE] + '|主席') === -1, JSON.stringify(remainingDates));
  check('★★★★★ 已放行嗰格仍然喺「系統沒有動」標 released；未放行而冇勾嗰格唔喺度（系統會調整）',
    (rq.untouchedManual || []).some(function (x) { return x.serviceDate === DATES[CELL_DATE] && x.released === true; })
    && !(rq.untouchedManual || []).some(function (x) { return x.serviceDate === otherDate; }),
    JSON.stringify(rq.untouchedManual));
  check('（收尾）另一個主日主席格改返', setGrid(gridOf(V1), otherDate, 'CHAIR', otherChairBefore ? PEOPLE[otherChairBefore] : ''));
  check('（收尾）改返嗰格讀經', setGrid(gridOf(V1), DATES[3], 'READ', PEOPLE[readNow]));
}

console.log('\n=== AG2【核心】換人 ⇒ 要重新放行 ===');
{
  check('（前置）同一格換成另一個唔合資格嘅人（假丙）', setGrid(gridOf(V1), DATES[CELL_DATE], 'CHAIR', PEOPLE.P9603));
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★★ needsDecision = true（放行只記住「同一個人」）', plan.needsDecision === true
    && plan.violations.real.length === 1 && plan.violations.real[0].personId === 'P9603',
    JSON.stringify(plan.violations).slice(0, 300));
  check('（收尾）改返假丁', setGrid(gridOf(V1), DATES[CELL_DATE], 'CHAIR', PEOPLE.P9604));
  check('★★★★ 改返 ⇒ 又唔使打字', gas.apiSaveAndConfirmPlan(Q).needsRelease === false);
}

console.log('\n=== AG4【核心】舊格式紀錄（主流程第五十三至六十六輪）：核對得到個人先認 ===');
{
  // 第七十五輪批次 CF 組：AG1 嘅「保留我的安排」勾選仲生效（CellDecisions），會令呢度永遠當已決定。
  // 呢一節驗嘅係 AuditLog 放行紀錄本身，所以先取消嗰個勾。
  gas.apiSetCellDecisions(Q, [{ serviceDate: DATES[CELL_DATE], postId: 'CHAIR', slotIndex: 1, kind: 'KEEP',
    cellText: PEOPLE.P9604, ruleId: 'HARD_ELIGIBILITY', checked: false }]);
  // 主流程嘅儲存同時寫咗一行舊格式（人類可讀）稽核行——兩行都刪走先係「冇紀錄」
  deleteAuditRowsWhere(function (r) {
    return r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_ACTION
      || r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION;
  });
  check('（對照）刪走兩種紀錄 ⇒ 又要打字', gas.apiSaveAndConfirmPlan(Q).needsDecision === true);

  // 舊格式：action『放行硬規則違反』、targetKey『<季度> v<版本>』、notes『日期　PostID#slot　RuleID』
  appendAudit(gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION, Q + ' v' + V1,
    DATES[CELL_DATE] + '　CHAIR#1　HARD_ELIGIBILITY');
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★★ 該版本嗰格嘅人正係假丁 ⇒ 認做已放行', plan.needsDecision === false
    && plan.violations.released.length === 1, JSON.stringify(plan.violations).slice(0, 300));
  checkEqual('★★★★★ 放行版本由 targetKey 讀出', plan.violations.released[0].releasedVersionNo, V1);

  // 指向 v0：v0 嗰格係另一個人 ⇒ 核對唔到 ⇒ 唔認
  deleteAuditRowsWhere(function (r) { return r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION; });
  appendAudit(gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION, Q + ' v' + V0,
    DATES[CELL_DATE] + '　CHAIR#1　HARD_ELIGIBILITY');
  check('★★★★★★ 指向嗰一版嗰格係另一個人 ⇒ **唔認**', gas.apiSaveAndConfirmPlan(Q).needsDecision === true);

  // 另一季度嘅紀錄唔算
  deleteAuditRowsWhere(function (r) { return r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION; });
  appendAudit(gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION, '2098T4 v' + V1,
    DATES[CELL_DATE] + '　CHAIR#1　HARD_ELIGIBILITY');
  check('★★★★ 另一季度嘅舊紀錄唔算', gas.apiSaveAndConfirmPlan(Q).needsDecision === true);

  // 留低一行認得到嘅，落面 AH 要用
  deleteAuditRowsWhere(function (r) { return r[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION; });
  appendAudit(gas.HARD_RELEASE_MAINFLOW_LEGACY_ACTION, Q + ' v' + V1,
    DATES[CELL_DATE] + '　CHAIR#1　HARD_ELIGIBILITY');
}

// =====================================================================
let V2 = -1;
let warnings = null;
console.log('\n=== AH1【核心】人手清空一格 ⇒ 寄出前嘅資料有它；特別主日跳過嘅唔算 ===');
{
  check('（前置）v' + V1 + ' 特別主日跳過嘅讀經格本來就冇人', whoIsOn(V1, DATES[6], 'READ') === '');
  check('（前置）清空一格讀經', setGrid(gridOf(V1), DATES[5], 'READ', ''));
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★ 儲存確認講得出 1 格空格（同一個定義）', (plan.blankCells || []).length === 1
    && plan.blankCells[0].serviceDate === DATES[5], JSON.stringify(plan.blankCells));
  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('（前置）儲存成功', result.ok === true && result.versionCreated === true, JSON.stringify(result).slice(0, 200));
  V2 = gas.findLatestVersionNo_(Q);
  checkEqual('（前置）新版本嗰格真係冇人', whoIsOn(V2, DATES[5], 'READ'), '');

  const review = gas.apiStep2Preview(Q, {});
  warnings = review.sendWarnings;
  check('★★★★★★ 寄審閱確認框資料有 `sendWarnings`', !!warnings && !warnings.error, JSON.stringify(warnings));
  checkEqual('★★★★★★ 空格 1 格（特別主日跳過嗰格唔算）', warnings.blank.count, 1);
  check('★★★★★ 列得出邊一格，崗位用中文名', warnings.blank.items[0].serviceDate === DATES[5]
    && warnings.blank.items[0].postNameTC === '讀經', JSON.stringify(warnings.blank.items));
  checkEqual('★★★★★★ 已放行 1 格', warnings.released.count, 1);
  check('★★★★★ 已放行列得出人名同版本', warnings.released.items[0].personName === PEOPLE.P9604
    && warnings.released.items[0].releasedVersionNo === V1, JSON.stringify(warnings.released.items));

  const dash = gas.apiGetDashboardState(Q);
  checkEqual('★★★★★ 狀態卡同一個數字', { b: dash.sendWarnings.blank.count, r: dash.sendWarnings.released.count }, { b: 1, r: 1 });

  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.REQUESTS_APPLIED, 'test');
  const official = gas.apiStep4GetSendPreview(Q, V2, {});
  checkEqual('★★★★★ 正式發出確認框同一個數字',
    { b: official.sendWarnings.blank.count, r: official.sendWarnings.released.count }, { b: 1, r: 1 });

  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.OFFICIAL_SENT, 'test');
  const resend = gas.apiStep5Plan(Q, {});
  checkEqual('★★★★★ 改動後重發確認框同一個數字',
    { b: resend.sendWarnings.blank.count, r: resend.sendWarnings.released.count }, { b: 1, r: 1 });
  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.DRAFT, 'test');
}

console.log('\n=== AH2【核心】畫面：三個確認框同狀態卡由同一支函式砌字 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const text = function (nodes) { return nodes.map(function (n) { return n.textContent; }).join('\n'); };
  const full = text(ui.buildSendWarningNodes(warnings));
  check('★★★★★★ 「這一版還有 1 格沒有人，收到的人會見到空格」', /這一版還有 1 格沒有人，收到的人會看到空格/.test(full), full);
  check('★★★★★ 列出嗰格（日期＋讀經）', /讀經/.test(full) && /2 月 8 日/.test(full), full);
  check('★★★★★★ 「這一季有 1 格是你放行的違反規則安排」', /這一季有 1 格是你放行的違反規則安排/.test(full), full);
  check('★★★★★ 清單寫人名同「第 ' + V1 + ' 版放行」', new RegExp(PEOPLE.P9604 + '[\\s\\S]*第 ' + V1 + ' 版放行').test(full), full);
  check('★★★★ 講明唔會阻擋', /不會阻擋/.test(full), full);

  const compact = text(ui.buildSendWarningNodes(warnings, { compact: true }));
  check('★★★★ 狀態卡（compact）都有兩句', /這一版還有 1 格沒有人/.test(compact) && /這一季有 1 格是你放行/.test(compact), compact);

  const many = { blank: { count: 13, items: warnings.blank.items, moreCount: 12 }, released: { count: 0, items: [], moreCount: 0 }, error: '' };
  check('★★★★ 超過上限寫「另有 12 格」', /另有 12 格/.test(text(ui.buildSendWarningNodes(many))));
  checkEqual('★★★★ 冇嘢要說 ⇒ 冇節點', ui.buildSendWarningNodes({ blank: { count: 0, items: [] }, released: { count: 0, items: [] }, error: '' }).length, 0);
  check('★★★★★ 算唔到 ⇒ 講一句，唔可以當冇問題',
    /算不到/.test(text(ui.buildSendWarningNodes({ blank: { count: 0, items: [] }, released: { count: 0, items: [] }, error: '壞了' }))));

  // 「請系統幫我調整」結果窗：已放行嘅格標「已放行（第 X 版）——系統不會改動這一格」、冇勾選框
  const sg = loadUiScripts(['Script.html', 'ScriptSuggestion.html']);
  sg.renderSuggestionResult({
    ok: true, sheetName: '建議', url: 'about:blank', startNote: '', colourCounts: { manual: 1, system: 0, both: 0, manualViolation: 1 },
    untouchedManual: [
      { key: 'k1', serviceDate: DATES[CELL_DATE], postNameTC: '主席', slotIndex: 1, personName: PEOPLE.P9604,
        ruleId: 'HARD_ELIGIBILITY', reason: '不在名單內', released: true, releasedVersionNo: V1 },
      { key: 'k2', serviceDate: DATES[3], postNameTC: '讀經', slotIndex: 1, personName: PEOPLE.P9603,
        ruleId: 'HARD_ELIGIBILITY', reason: '不在名單內', released: false, releasedVersionNo: null }
    ],
    remaining: [], unfillable: []
  });
  const body = sg.document.getElementById('modalBody');
  const bodyText = body.textContent;
  // 第七十五輪批次 CF 組：段題改為「系統沒有動這幾格（N 格）」，冇勾選框（勾選喺〔檢查我的改動〕）
  check('★★★★★★ 段題「系統沒有動這幾格（2 格）」', /系統沒有動這幾格（2 格）/.test(bodyText), bodyText);
  check('★★★★★★ 已放行嗰格標「已放行，第 ' + V1 + ' 版」',
    new RegExp('已放行，第 ' + V1 + ' 版').test(bodyText), bodyText);
  const countInputs = function (node) {
    let n = node.tagName === 'INPUT' ? 1 : 0;
    (node.children || []).forEach(function (c) { n += countInputs(c); });
    return n;
  };
  checkEqual('★★★★★ 建議窗冇勾選框（「准系統調整我勾了的」已拿走）', countInputs(body), 0);

  // 三個確認框真係叫呢支——用原始碼守住（唔係靠文字比對結果）
  const fs = require('fs');
  const path = require('path');
  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const calls = (z1.match(/buildSendWarningNodes\((preview|plan)\.sendWarnings\)/g) || []).length;
  checkEqual('★★★★★ ScriptZone1 三個確認框各叫一次 buildSendWarningNodes', calls, 3);
  const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'Script.html'), 'utf8');
  check('★★★★ 狀態卡叫 buildSendWarningNodes(d.sendWarnings, { compact: true })',
    /buildSendWarningNodes\(d\.sendWarnings, \{ compact: true \}\)/.test(script));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
