// 第六十七輪批次 AF 組：把人手編好嘅整季職事表匯入系統。
// FIXTURE-OK: 匯入範本由真入口 `apiCreateImportSheet()` 建；格內文字係幹事貼上嘅**外部輸入**，
// 手砌係正路；版本一律由 `apiImportRosterExecute()` 建。
// 執行方式：node tests/roster_import.test.js
//
// 守住：
//   AF1　範本：崗位、位置數、主日、特別主日灰格由工作表讀出（改一個崗位嘅位置數 ⇒ 範本跟住變）
//   AF2　檢查：一格認唔出 ⇒ 擋；一格違反硬規則 ⇒ 要放行；空格 ⇒ 只警告；灰格有名 ⇒ 警告並忽略；
//   　　　講員自由文字照收
//   AF3　匯入：零版本 ⇒ 第 0 版、`Basis=IMPORT`、全部 MANUAL；放行紀錄係 AG 組格式（之後儲存唔使再打字）；
//   　　　已有版本 ⇒ 新一版
//   AF4　「已在系統外寄出」⇒ Stage=OFFICIAL_SENT、每人一行 EXTERNAL；之後改 1 格 ⇒ 步驟 5 只列受影響嘅人；
//   　　　補寄預覽一個都唔列
//   AF5　畫面：區四入口、第 1 步提示、唯讀白名單

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
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
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'SendOptions.gs', 'PersonalLinkInMail.gs',
  'PreacherTranslationFill.gs', 'MakeupSend.gs', 'PdfBatch.gs', 'WebAppZone4.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppSaveConfirm.gs',
  'RosterImport.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
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
const READ_ONLY = ['P9603', 'P9604'];   // 只可以做讀經

const ss = new RealisticMockSpreadsheet();
function dvBuilder() {
  const rec = { list: null, allowInvalid: null };
  const self = {
    requireValueInList: function (list) { rec.list = list; return self; },
    setAllowInvalid: function (v) { rec.allowInvalid = v; return self; },
    setHelpText: function () { return self; },
    build: function () { return rec; }
  };
  return self;
}
const builtRules = [];
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: function () { const b = dvBuilder(); const orig = b.build; b.build = function () { const r = orig(); builtRules.push(r); return r; }; return b; },
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'af@example.invalid'; } }; } };
gas.CacheService = { getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; } };
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    if (fmt === 'dd/MM') { const p = d.split('-'); return p[2] + '/' + p[1]; }
    if (fmt === 'MM-dd') { const p = d.split('-'); return p[1] + '-' + p[2]; }
    return d + ' ' + t;
  },
  parseDate: function (str, tz) {
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) throw new Error('mock parseDate: ' + str);
    const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    let guess = new Date(target);
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(guess);
      const o = {}; parts.forEach(function (p) { if (p.type !== 'literal') o[p.type] = p.value; });
      const asIfUTC = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour) % 24, Number(o.minute), Number(o.second));
      const diff = target - asIfUTC; if (diff === 0) break; guess = new Date(guess.getTime() + diff);
    }
    return guess;
  },
  computeDigest: function (algo, input) {
    const crypto = require('crypto');
    return Array.from(crypto.createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest());
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' }, sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { publishCalls++; return { failed: false, message: '' }; };
let publishCalls = 0;
gas.findPublicLinkRow_ = function () { return null; };
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };
gas.resolveMailAttachmentFolder_ = function () { return null; };
gas.checkMissingPersonalPdfs_ = function () { return { missing: [], total: 0 }; };
gas.protectV0 = function () { protectCalls++; };
let protectCalls = 0;

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.V0_PROTECT, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' }]);
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
  Object.keys(PEOPLE).forEach(function (id) {
    if (READ_ONLY.indexOf(id) === -1) elig.push(['CHAIR', id]);
    elig.push(['READ', id]);
  });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
    C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  elig.map(function (p, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0], [C.ELIGIBILITY.PERSON_ID]: p[1],
      [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
  }));
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
    C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY],
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER', 'HARD_SPECIAL_SUNDAY_SKIP'].map(function (id) {
    return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD', [C.RULE_SETTINGS.ENABLED]: true,
      [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));
  // 特別主日：DATES[6] 跳過讀經 ⇒ 範本嗰格灰
  seedSheet(ss, S.SPECIAL_SUNDAYS, ['SS'], Object.keys(C.SPECIAL_SUNDAYS).map(function (x) { return C.SPECIAL_SUNDAYS[x]; }), [
    { [C.SPECIAL_SUNDAYS.SPECIAL_ID]: 'SP1', [C.SPECIAL_SUNDAYS.QUARTER_ID]: Q,
      [C.SPECIAL_SUNDAYS.SERVICE_DATE]: DATES[6], [C.SPECIAL_SUNDAYS.TYPE]: '合堂', [C.SPECIAL_SUNDAYS.TITLE]: '聯合崇拜',
      [C.SPECIAL_SUNDAYS.SKIP_POST_IDS]: 'READ', [C.SPECIAL_SUNDAYS.LOCK_POST_IDS]: '', [C.SPECIAL_SUNDAYS.ACTIVE]: true }]);
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  // 第六十八輪批次 AL 組：一個「正式發出」嘅名單收件人（辦公室）——匯入選「已在系統外寄出」之後，
  // 補寄預覽唔可以再列佢。
  const ER = C.EMAIL_RECIPIENTS;
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], Object.keys(ER).map(function (x) { return ER[x]; }), [
    { [ER.RECIPIENT_ID]: 'RC1', [ER.EMAIL]: 'office@example.invalid', [ER.DISPLAY_NAME]: '辦公室',
      [ER.STAGE]: 'OFFICIAL,RESEND', [ER.SEND_AS]: 'TO', [ER.ACTIVE]: true }]);
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'],
    [C.EMAIL_TEMPLATES.TEMPLATE_ID, C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG, C.EMAIL_TEMPLATES.SUBJECT,
      C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN, C.EMAIL_TEMPLATES.ATTACH_TYPE, C.EMAIL_TEMPLATES.ACTIVE],
    ['REVIEW', 'OFFICIAL', 'RESEND'].map(function (stage) {
      return { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_' + stage + '_TC', [C.EMAIL_TEMPLATES.STAGE]: stage,
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表', [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>',
        [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}', [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true };
    }));
}
buildFixture();

const IMPORT = gas.buildImportSheetName_(Q);
/** 匯入表定位：第 2 行日期鍵、第 2 欄 `POST#slot`。 */
function importCell(date, key) {
  const sh = ss.getSheetByName(IMPORT);
  // 試算表會把日期字串自動變成日期值——同系統一樣用 toDateString 讀返
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) {
    return v instanceof Date ? gas.toDateString(v, TZ) : String(v);
  });
  const col = keys.indexOf(date) + 1;
  let row = -1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, 2).getValue()) === key) { row = r; break; }
  }
  if (col < 1 || row < 1) throw new Error('匯入表搵唔到 ' + date + ' / ' + key);
  return sh.getRange(row, col);
}
function setImport(date, key, text) { importCell(date, key).setValue(text); }
function rowsOf(versionNo) {
  return gas.readSheet(S.ROSTER_ASSIGNMENTS).filter(function (r) { return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo; });
}
function cellOf(versionNo, date, post) {
  return rowsOf(versionNo).filter(function (r) { return gas.toDateString(r[A.SERVICE_DATE], TZ) === date && r[A.POST_ID] === post; })[0];
}
function setPostSlotCount(postId, n) {
  const sh = ss.getSheetByName(S.POSTS);
  const headers = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf(C.POSTS.POST_ID) + 1;
  const slotCol = headers.indexOf(C.POSTS.SLOT_COUNT) + 1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, idCol).getValue()) === postId) { sh.getRange(r, slotCol).setValue(n); return; }
  }
}

// =====================================================================
console.log('\n=== AF1【核心】範本：崗位、位置數、主日、灰格由工作表讀出 ===');
{
  const r = gas.apiCreateImportSheet(Q);
  check('★★★★★ 建立成功', r.created === true && r.sheetName === IMPORT, JSON.stringify(r));
  checkEqual('★★★★★★ 3 個崗位各 1 個位置 ⇒ 3 行；8 個主日', { rows: r.rowCount, dates: r.dateCount }, { rows: 3, dates: 8 });
  checkEqual('★★★★★ 特別主日跳過讀經 ⇒ 1 格灰', r.naCount, 1);
  const na = importCell(DATES[6], 'READ#1');
  check('★★★★★ 灰格寫「—」而且塗灰', na.getValue() === gas.IMPORT_NA_MARK && na.getBackground() === gas.IMPORT_NA_BACKGROUND,
    na.getValue() + ' ' + na.getBackground());
  // 第六十八輪批次 AN 組：灰格唔可以有資料驗證（否則每格出「不在清單內」紅色小三角）；同一行嘅普通格仍然有下拉
  check('★★★★★★ 灰格冇資料驗證規則', na.getDataValidation() === null, JSON.stringify(na.getDataValidation()));
  check('★★★★★ 同一行嘅普通格仍然有下拉（驗證冇被整行清走）',
    importCell(DATES[0], 'READ#1').getDataValidation() !== null && importCell(DATES[5], 'READ#1').getDataValidation() !== null);
  check('★★★★ 日期標題附特別主日名稱', /聯合崇拜/.test(String(ss.getSheetByName(IMPORT).getRange(1, 2 + 7).getValue())));
  check('★★★★★ 下拉容許名單以外嘅字（貼上唔會被擋）', builtRules.length >= 2 && builtRules.every(function (x) { return x.allowInvalid === true; }),
    JSON.stringify(builtRules));
  check('★★★★ 主席嘅選單只有合資格嘅人（唔包括只做讀經嘅）',
    builtRules.some(function (x) { return x.list.indexOf(PEOPLE.P9601) !== -1 && x.list.indexOf(PEOPLE.P9604) === -1; }), JSON.stringify(builtRules));
  checkEqual('★★★★ 一格派工都冇寫', gas.readSheet(S.ROSTER_ASSIGNMENTS).length, 0);

  const again = gas.apiCreateImportSheet(Q);
  check('★★★★ 已存在 ⇒ 唔覆蓋，直接回傳', again.created === false && again.sheetName === IMPORT);

  // 改讀經位置數 ⇒ 範本跟住變
  ss.deleteSheet(ss.getSheetByName(IMPORT));
  setPostSlotCount('READ', 2);
  const r2 = gas.apiCreateImportSheet(Q);
  checkEqual('★★★★★★ 讀經改成 2 個位置 ⇒ 4 行', r2.rowCount, 4);
  check('★★★★ 行名「讀經 1」「讀經 2」', String(importCell(DATES[0], 'READ#2').getValue()) === '' && (function () {
    const sh = ss.getSheetByName(IMPORT);
    const labels = []; for (let x = 3; x <= sh.getLastRow(); x++) labels.push(String(sh.getRange(x, 1).getValue()));
    return labels.indexOf('讀經 1') !== -1 && labels.indexOf('讀經 2') !== -1;
  })());
  ss.deleteSheet(ss.getSheetByName(IMPORT));
  setPostSlotCount('READ', 1);
  gas.apiCreateImportSheet(Q);
}

console.log('\n=== AF2【核心】檢查：認唔出 ⇒ 擋；硬規則 ⇒ 要放行；空格 ⇒ 只警告 ===');
{
  // 幹事貼上：主席全部假甲、讀經假乙（留空 DATES[5]）、講員第一週客席、一格打錯名
  DATES.forEach(function (d) { setImport(d, 'CHAIR#1', PEOPLE.P9601); });
  DATES.forEach(function (d, i) { if (i !== 5 && i !== 6) setImport(d, 'READ#1', PEOPLE.P9602); });
  setImport(DATES[0], 'PREACH#1', '客席講員');
  setImport(DATES[2], 'CHAIR#1', '唔存在嘅人');

  let plan = gas.apiCheckImportSheet(Q);
  check('★★★★★★ 一格認唔出 ⇒ 擋住', plan.blocked === true && plan.unresolved.length === 1
    && plan.unresolved[0].text === '唔存在嘅人' && plan.unresolved[0].serviceDate === DATES[2], JSON.stringify(plan.unresolved));
  check('★★★★ 講得出係邊格（崗位中文名）', plan.unresolved[0].postNameTC === '主席');
  check('★★★★ 回前端唔帶成千格 assignments', plan.assignments === undefined);
  let threw = null;
  try { gas.apiImportRosterExecute(Q, { confirmText: gas.IMPORT_CONFIRM_TEXT }); } catch (e) { threw = e; }
  check('★★★★★★ 擋住嗰陣匯入會拋錯、乜都冇寫', threw && /認不出/.test(threw.message) && gas.readSheet(S.ROSTER_ASSIGNMENTS).length === 0, threw && threw.message);

  // 改成唔合資格嘅人（假丁只做讀經）⇒ 要放行；灰格打名 ⇒ 警告
  setImport(DATES[2], 'CHAIR#1', PEOPLE.P9604);
  setImport(DATES[6], 'READ#1', PEOPLE.P9602);
  plan = gas.apiCheckImportSheet(Q);
  check('★★★★★ 唔再擋', plan.blocked === false);
  check('★★★★★★ 一格違反硬規則 ⇒ needsRelease、要打「' + gas.IMPORT_RELEASE_CONFIRM_TEXT + '」',
    plan.needsRelease === true && plan.violations.real.length === 1 && plan.violations.real[0].ruleId === 'HARD_ELIGIBILITY'
    && plan.violations.real[0].personName === PEOPLE.P9604 && plan.confirmText === gas.IMPORT_RELEASE_CONFIRM_TEXT,
    JSON.stringify(plan.violations.real));
  check('★★★★★ 空格只警告：1 格（讀經 ' + DATES[5] + '）；特別主日跳過嗰格同講員留空唔算',
    plan.blankCells.length === 1 && plan.blankCells[0].serviceDate === DATES[5] && plan.blankCells[0].postNameTC === '讀經',
    JSON.stringify(plan.blankCells));
  check('★★★★★ 灰格有名 ⇒ 警告並會忽略', plan.ignoredNa.length === 1 && plan.ignoredNa[0].text === PEOPLE.P9602, JSON.stringify(plan.ignoredNa));
  check('★★★★★ 客席講員唔算認唔出，照收', plan.freeText.length === 1 && plan.freeText[0].text === '客席講員', JSON.stringify(plan.freeText));
  check('★★★★ 講員唔會被當成 HARD_NO_AUTO_PREACHER 違反',
    !plan.violations.real.concat(plan.violations.structural).some(function (x) { return x.ruleId === 'HARD_NO_AUTO_PREACHER'; }));
  checkEqual('★★★★ 填了幾多格（灰格嗰個名唔計）', plan.filledCount, 8 + 6 + 1);
  check('★★★★ 講明係第 0 版', plan.hasVersion === false && plan.versionNoToCreate === 0);
}

console.log('\n=== AF3【核心】匯入：零版本 ⇒ 第 0 版、Basis=IMPORT、全部 MANUAL ===');
{
  let threw = null;
  try { gas.apiImportRosterExecute(Q, { confirmText: '' }); } catch (e) { threw = e; }
  check('★★★★★ 唔打字 ⇒ 拒絕', threw && /打字放行/.test(threw.message), threw && threw.message);
  threw = null;
  try { gas.apiImportRosterExecute(Q, { confirmText: gas.IMPORT_CONFIRM_TEXT }); } catch (e) { threw = e; }
  check('★★★★★ 有違反而只打「' + gas.IMPORT_CONFIRM_TEXT + '」⇒ 拒絕', threw !== null && gas.readSheet(S.ROSTER_ASSIGNMENTS).length === 0);

  const r = gas.apiImportRosterExecute(Q, { confirmText: gas.IMPORT_RELEASE_CONFIRM_TEXT, sentExternally: false });
  check('★★★★★★ 匯入成第 0 版', r.ok === true && r.versionNo === 0, JSON.stringify(r).slice(0, 300));
  checkEqual('★★★★★ findLatestVersionNo = 0', gas.findLatestVersionNo(Q), 0);
  const V = C.ROSTER_VERSIONS;
  const vrow = gas.readSheet(S.ROSTER_VERSIONS).filter(function (x) { return x[V.QUARTER_ID] === Q; })[0];
  checkEqual('★★★★★★ Basis = IMPORT', vrow && vrow[V.BASIS], gas.VERSION_VALUES.BASIS_IMPORT);
  check('★★★★ 版本說明「由人手職事表匯入」', /由人手職事表匯入/.test(String(vrow && vrow[V.NOTES])), vrow && vrow[V.NOTES]);
  check('★★★★ 狀態卡譯做「由人手職事表匯入」', gas.apiGetDashboardState(Q).latestVersion.basisText === '由人手職事表匯入');
  check('★★★★ 第 0 版照 V0_PROTECT 加保護', protectCalls === 1);
  check('★★★★ grid 工作表存在', !!ss.getSheetByName(gas.buildRosterSheetName_(Q, 0)));
  const rows = rowsOf(0);
  checkEqual('★★★★★ 每格都有一行（3 崗位 × 8 主日）', rows.length, 24);
  check('★★★★★★ 有人嘅格全部 MANUAL', rows.filter(function (x) { return x[A.PERSON_ID]; })
    .every(function (x) { return x[A.ASSIGN_SOURCE] === gas.ASSIGN_SOURCE.MANUAL; }),
    JSON.stringify(rows.map(function (x) { return [x[A.POST_ID], x[A.PERSON_ID], x[A.ASSIGN_SOURCE]]; })));
  const preach = cellOf(0, DATES[0], 'PREACH');
  check('★★★★★ 客席講員：PersonNameSnapshot 保留、MANUAL、冇 PersonID',
    preach && preach[A.PERSON_NAME_SNAPSHOT] === '客席講員' && preach[A.ASSIGN_SOURCE] === gas.ASSIGN_SOURCE.MANUAL && !preach[A.PERSON_ID], JSON.stringify(preach));
  const na = cellOf(0, DATES[6], 'READ');
  check('★★★★★ 灰格：忽略名字、SKIPPED、帶特別主日跳過 flag',
    na && !na[A.PERSON_ID] && na[A.ASSIGN_SOURCE] === gas.ASSIGN_SOURCE.SKIPPED && /HARD_SPECIAL_SUNDAY_SKIP/.test(String(na[A.RULE_FLAGS])), JSON.stringify(na));
  checkEqual('★★★★ 違反規則嗰格嘅人就係假丁', cellOf(0, DATES[2], 'CHAIR')[A.PERSON_ID], 'P9604');
  checkEqual('★★★★ Stage 仍然 DRAFT', gas.getQuarterStage_(Q), gas.QUARTER_STAGE.DRAFT);
  check('★★★★ 重新發佈咗公開連結', publishCalls === 1);

  const release = gas.readSheet(S.AUDIT_LOG).filter(function (x) { return x[C.AUDIT_LOG.ACTION] === gas.HARD_RELEASE_ACTION; });
  check('★★★★★★ 放行紀錄係 AG 組格式（6 欄 key ＋ RELEASED_VERSION:0）',
    release.length === 1 && String(release[0][C.AUDIT_LOG.NOTES]).indexOf(gas.HARD_RELEASE_KEY_PREFIX) !== -1
    && String(release[0][C.AUDIT_LOG.NOTES]).indexOf(gas.HARD_RELEASE_VERSION_PREFIX + '0') !== -1, JSON.stringify(release));
  const save = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★★ 之後「儲存及寄出」同一狀態唔使再打字（整季記住）', save.needsRelease === false && save.violations.released.length === 1,
    JSON.stringify(save.violations).slice(0, 300));
}

console.log('\n=== AF3：已有版本 ⇒ 新一版，舊版本保留 ===');
{
  const before = gas.apiCheckImportSheet(Q);
  check('★★★★★ 再檢查：違反已經放行過 ⇒ 唔使再打放行字', before.needsRelease === false && before.violations.released.length === 1
    && before.confirmText === gas.IMPORT_CONFIRM_TEXT, JSON.stringify(before.violations).slice(0, 300));
  const r = gas.apiImportRosterExecute(Q, { confirmText: before.confirmText, sentExternally: false });
  checkEqual('★★★★★ 建立第 1 版', r.versionNo, 1);
  check('★★★★ 第 0 版原封不動', rowsOf(0).length === 24 && rowsOf(1).length === 24);
  check('★★★★ 第 1 版唔加保護', protectCalls === 1);
}

console.log('\n=== AF4【核心】「已經在系統外寄給全體」⇒ OFFICIAL_SENT ＋ 每人一行 EXTERNAL ===');
{
  let mailCalls = 0;
  gas.MailApp = { sendEmail: function () { mailCalls++; } };
  gas.GmailApp = { sendEmail: function () { mailCalls++; } };
  const r = gas.apiImportRosterExecute(Q, { confirmText: gas.IMPORT_CONFIRM_TEXT, sentExternally: true });
  checkEqual('★★★★★ 建立第 2 版', r.versionNo, 2);
  checkEqual('★★★★★★ Stage = OFFICIAL_SENT', gas.getQuarterStage_(Q), gas.QUARTER_STAGE.OFFICIAL_SENT);
  const L = C.SEND_LOG;
  const ext = gas.readSheet(S.SEND_LOG).filter(function (x) { return x[L.QUARTER_ID] === Q; });
  const persons = {};
  rowsOf(2).forEach(function (x) { if (x[A.PERSON_ID]) persons[x[A.PERSON_ID]] = true; });
  checkEqual('★★★★★★ 每位有派工嘅人一行、Stage=OFFICIAL、Status=EXTERNAL',
    { n: ext.filter(function (x) { return x[L.PERSON_ID]; }).length, stages: ext.every(function (x) { return x[L.STAGE] === 'OFFICIAL'; }), status: ext.every(function (x) { return x[L.STATUS] === gas.MAIL_STATUS.EXTERNAL; }) },
    { n: Object.keys(persons).length, stages: true, status: true });
  check('★★★★★ hash 照現有算法（同 computeAssignmentHash_ 一致）', ext.every(function (x) {
    const mine = rowsOf(2).filter(function (y) { return x[L.PERSON_ID] && y[A.PERSON_ID] === x[L.PERSON_ID]; }).map(function (y) {
      return { serviceDate: gas.toDateString(y[A.SERVICE_DATE], TZ), postId: y[A.POST_ID], slotIndex: Number(y[A.SLOT_INDEX]) };
    });
    return String(x[L.ASSIGNMENT_HASH]) === gas.computeAssignmentHash_(mine);
  }));
  checkEqual('★★★★★ 冇寄任何電郵', mailCalls, 0);
  checkEqual('★★★★ 回傳講明寫了幾多行', r.externalRows, Object.keys(persons).length);
  const reach = gas.countOfficialReach_(Q, 2);
  checkEqual('★★★★★ 狀態卡：應收全部已收（EXTERNAL 算收過）', { expected: reach.expected, notReached: reach.notReached },
    { expected: Object.keys(persons).length, notReached: 0 });

  // 補寄預覽：一個都唔列
  const makeup = gas.apiMakeupSendPlan(Q, 'OFFICIAL');
  check('★★★★★★ 補寄預覽一個都唔列（EXTERNAL 算收過）——包括名單收件人（第六十八輪批次 AL 組）',
    makeup.ok === true && makeup.people.length === 0
    && makeup.alreadySentCount === Object.keys(persons).length + 1, JSON.stringify(makeup).slice(0, 300));
  const listRows = ext.filter(function (x) { return !x[L.PERSON_ID]; });
  check('★★★★★ 名單收件人嗰行：無 PersonID、以 Email 做鍵、Stage=OFFICIAL、Status=EXTERNAL',
    listRows.length === 1 && String(listRows[0][L.EMAIL]) === 'office@example.invalid'
    && listRows[0][L.STAGE] === 'OFFICIAL' && listRows[0][L.STATUS] === gas.MAIL_STATUS.EXTERNAL, JSON.stringify(listRows));

  // 之後改 1 格（讀經 DATES[1] 假乙 → 假丙）⇒ 步驟 5 只列受影響嘅兩位
  const grid = gas.buildRosterSheetName_(Q, 2);
  const sh = ss.getSheetByName(grid);
  let keyRow = -1;
  for (let x = 1; x <= 12; x++) {
    const rowVals = sh.getRange(x, 1, 1, sh.getLastColumn()).getValues()[0];
    if (rowVals.some(function (v) { return String(v || '').indexOf('#') !== -1; })) { keyRow = x; break; }
  }
  const head = sh.getRange(keyRow, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = head.indexOf('READ#1') + 1;
  let done = false;
  for (let x = keyRow + 1; x <= sh.getLastRow(); x++) {
    if (gas.toDateString(sh.getRange(x, 1).getValue(), TZ) === DATES[1]) { sh.getRange(x, col).setValue(PEOPLE.P9603); done = true; break; }
  }
  check('（前置）改咗一格', done);
  const saved = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('（前置）儲存成第 3 版', saved.ok === true && gas.findLatestVersionNo(Q) === 3, JSON.stringify(saved).slice(0, 200));
  // 第六十九輪批次 AS 組：匯入（IMPORT）之後再儲存一次（FINE_TUNE）⇒ 狀態卡版本來源是「人手調整後」，
  // 唔可以停喺「由人手職事表匯入」。（查過：呢條係綠 ⇒ 唔係 bug；補驗時見到舊字多數係畫面未刷新。）
  const dashAs = gas.apiGetDashboardState(Q).latestVersion;
  checkEqual('★★★★★★ 匯入後儲存一次：最新版本 basisText＝人手調整後', { v: dashAs.versionNo, t: dashAs.basisText },
    { v: 3, t: '人手調整後' });
  const basisOfV3 = gas.readSheet(S.ROSTER_VERSIONS).filter(function (r) {
    return r[C.ROSTER_VERSIONS.QUARTER_ID] === Q && Number(r[C.ROSTER_VERSIONS.VERSION_NO]) === 3;
  })[0];
  checkEqual('★★★★★ RosterVersions 第 3 版 Basis＝FINE_TUNE', basisOfV3 && basisOfV3[C.ROSTER_VERSIONS.BASIS], gas.VERSION_VALUES.BASIS_FINE_TUNE);
  const step5 = gas.apiStep5Plan(Q, {});
  const changedIds = (step5.changed || []).map(function (p) { return p.personId; }).sort();
  checkEqual('★★★★★★ 步驟 5 只列出受影響嘅兩位（換走嘅假乙、換入嘅假丙）', changedIds, ['P9602', 'P9603']);
}

console.log('\n=== AF5【核心】畫面 ===');
{
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', f), 'utf8');
  const zone4 = read('ScriptZone4.html');
  check('★★★★★ 區四有「建立匯入表」「檢查並匯入」', /zone4Row\('建立匯入表'/.test(zone4) && /zone4Row\('檢查並匯入'/.test(zone4));
  check('★★★★★ 檢查係唯讀呼叫、匯入係會寫入嘅呼叫',
    /callServer\('apiCheckImportSheet', currentQuarterId\)/.test(zone4) && /callServerMutating\('apiImportRosterExecute', currentQuarterId, \{/.test(zone4)
    && /callServerMutating\('apiCreateImportSheet', currentQuarterId\)/.test(zone4));
  check('★★★★★ 認唔出嘅名有〔立即加入這個人〕（同儲存確認同一個對話框）', /openAddUnresolvedPerson\(u, openImportRoster\)/.test(zone4));
  check('★★★★★ 有「已經在系統外寄給全體」選項、預設未寄過', /已經在系統外寄給全體/.test(zone4) && /let sentExternally = false;/.test(zone4));
  check('★★★★ 空格用 AH 組同一支 buildSendWarningNodes', /buildSendWarningNodes\(\{\s*blank:/.test(zone4));
  check('★★★★★ 第 1 步未有版本時有「已經用舊方法排好？」連去匯入',
    /已經用舊方法排好？/.test(read('ScriptMainFlow.html')) && /openImportRoster\(\)/.test(read('ScriptMainFlow.html')));
  check('★★★★ 唯讀白名單有 apiCheckImportSheet', /'apiCheckImportSheet',/.test(read('Script.html')));
}

console.log('\n=== AP：入口名稱統一叫「匯入人手編好的職事表」（第六十八輪批次）===');
{
  const ENTRY = '匯入人手編好的職事表';
  const OLD = '匯入人手職事表';
  const srcDir = path.join(__dirname, '..', 'src');
  const files = [];
  fs.readdirSync(srcDir).forEach(function (f) { if (/\.gs$/.test(f)) files.push(path.join(srcDir, f)); });
  fs.readdirSync(path.join(srcDir, 'ui')).forEach(function (f) { if (/\.html$/.test(f)) files.push(path.join(srcDir, 'ui', f)); });
  const stale = files.filter(function (f) { return fs.readFileSync(f, 'utf8').indexOf(OLD) !== -1; })
    .map(function (f) { return path.basename(f); });
  checkEqual('★★★★★★ src/*.gs 同 src/ui/*.html 冇任何地方仍然寫「' + OLD + '」', stale, []);
  const zone4 = fs.readFileSync(path.join(srcDir, 'ui', 'ScriptZone4.html'), 'utf8');
  check('★★★★★ 區四標題同「系統出問題」彈窗指引都用「進階與診斷 ▸ ' + ENTRY + '」',
    zone4.indexOf("sectionTitle('" + ENTRY + "')") !== -1
    && zone4.indexOf('進階與診斷 ▸ ' + ENTRY + '」把副本讀回系統') !== -1);
  const manual = fs.readFileSync(path.join(__dirname, '..', 'docs', '系統出問題時手動繼續.md'), 'utf8');
  check('★★★★ 手動繼續說明書同一個名稱', manual.indexOf(OLD) === -1 && manual.indexOf('進階與診斷 ▸ ' + ENTRY) !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
