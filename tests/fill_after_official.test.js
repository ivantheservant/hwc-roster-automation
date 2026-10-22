// 第七十四輪批次 BC 組：正式發出之後，〔填講員／翻譯／獻花〕不再直接改已寄出的版本。
// FIXTURE-OK: 生成用真入口（`apiGenerateDraftExecute()`），填格用真入口（`apiSavePreacherTranslationEntry()`）；
// 唯一手砌嘅係 `SendLog` 嘅寄出紀錄（模擬「這一版已經正式發出」）——寄出紀錄係既有資料，手砌係正路。
// 執行方式：node tests/fill_after_official.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十三輪 K1，2028T3）
// ═════════════════════════════════════════════════════════════════════
//
// 已正式發出之後用〔填講員／翻譯／獻花〕把一格獻花改成一位會友，之後撳〔儲存及寄出〕回「沒有偵測到任何改動」。
// 成因：`apiSavePreacherTranslationEntry()` 找最新版本，直接改**那一版**嘅 `RosterAssignments`（連 grid），
// 不理那一版是不是已經寄出 ⇒ ①已寄出嘅內容被改寫、寄出紀錄對唔上；②「只寄給安排有改動的人」拿最新版同
// 「上次寄出的版本」比較，兩者係同一版 ⇒ 填獻花嗰位會友永遠收唔到通知。
//
//   BC1　已通知過人嘅版本 ⇒ 不改 `RosterAssignments`，只寫 grid 工作表嗰一格
//   BC2　未通知過（初稿、只寄過審閱本、寄失敗）⇒ 照舊直接改
//   BC3　按**版本**判斷：舊版寄過、最新版未寄 ⇒ 照舊
//   BC4　彈窗資料：`writesToSheetOnly`、已寫工作表嗰格 `currentName`／`sheetOnly`；未寄 ⇒ 兩者皆無
//   BC5　〔儲存及寄出〕偵測得到工作表上嗰一格改動（`gridChanges`），而且冇放行框
//   BC6　「開季前準備」嘅「獻花未填」計數：已通知過人嘅版本要計入工作表上已填嗰格
//   BC7　畫面：專屬提示句、狀態寫「已寫在職事表，未儲存成新版本」而非「已儲存 ✓」

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
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs', 'MakeupSend.gs', 'WebAppPreQuarter.gs', 'AnnualCombined.gs'
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

function flowerRow(versionNo, dateStr) {
  return gas.readSheet(S.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && gas.toDateString(r[A.SERVICE_DATE], TZ) === dateStr && r[A.POST_ID] === 'FLOWER';
  });
}
/** 直接改長表某一格嘅 AssignSource——模擬「生成器錯誤地自己排咗」。 */
function setFlowerSource(versionNo, dateStr, source) {
  const sheet = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = function (k) { return headers.indexOf(k) + 1; };
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (String(sheet.getRange(r, col(A.QUARTER_ID)).getValue()) !== Q) continue;
    if (Number(sheet.getRange(r, col(A.VERSION_NO)).getValue()) !== versionNo) continue;
    if (String(sheet.getRange(r, col(A.POST_ID)).getValue()) !== 'FLOWER') continue;
    if (gas.toDateString(sheet.getRange(r, col(A.SERVICE_DATE)).getValue(), TZ) !== dateStr) continue;
    sheet.getRange(r, col(A.ASSIGN_SOURCE)).setValue(source);
    return true;
  }
  return false;
}
const noAutoOf = function (list) {
  return (list || []).filter(function (v) { return v.ruleId === gas.RULE_IDS.NO_AUTO_GENERATE; });
};


const SL = C.SEND_LOG;
const SL_COLS = Object.keys(SL).map(function (k) { return SL[k]; });
function addSendLog(versionNo, stage, status) {
  appendRows(ss, S.SEND_LOG, SL_COLS, [{
    [SL.QUARTER_ID]: Q, [SL.VERSION_NO]: versionNo, [SL.STAGE]: stage, [SL.STATUS]: status,
    [SL.PERSON_ID]: 'P9701', [SL.SENT_AT]: '2099-01-01 09:00:00'
  }]);
}
function clearSendLog() {
  const sh = ss.getSheetByName(S.SEND_LOG);
  const n = sh.getLastRow();
  if (n >= 3) sh.deleteRows(3, n - 2);
}
function gridCell(versionNo, dateStr, postId) {
  const sh = ss.getSheetByName('Roster_' + Q + '_v' + versionNo);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = keys.indexOf(postId + '#1') + 1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) === dateStr) return String(sh.getRange(r, col).getValue());
  }
  return null;
}
const pendingFlower = function (list, d) {
  return list.pending.filter(function (p) { return p.postId === 'FLOWER' && p.serviceDate === d; })[0];
};

console.log('\n=== 前置：用真入口生成 v0 ===');
{
  check('（前置）生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
  const r0 = flowerRow(0, DATES[0]);
  check('（前置）獻花 DATES[0] 一開始冇人', !r0[A.PERSON_ID] && !r0[A.PERSON_NAME_SNAPSHOT], JSON.stringify(r0));
}

console.log('\n=== BC2／BC3　未通知過人 ⇒ 照舊直接改（RosterAssignments＋grid）===');
{
  const before = gas.apiListPreacherTranslationPending(Q);
  check('★★★★ 未寄過任何嘢：writesToSheetOnly = false', before.writesToSheetOnly === false, JSON.stringify(before).slice(0, 200));
  addSendLog(0, gas.MAIL_STAGES.REVIEW, 'SENT');
  const res = gas.apiSavePreacherTranslationEntry(Q, DATES[0], 'FLOWER', 1, PEOPLE.P9701);
  check('★★★★★ 只寄過審閱本 ⇒ sheetOnly = false', res.sheetOnly === false, JSON.stringify(res));
  const row = flowerRow(0, DATES[0]);
  check('★★★★★ RosterAssignments 照舊被改（PersonID）', row[A.PERSON_ID] === 'P9701', JSON.stringify(row));
  check('★★★★ grid 也寫咗', gridCell(0, DATES[0], 'FLOWER') === PEOPLE.P9701, gridCell(0, DATES[0], 'FLOWER'));
  // 寄失敗唔算「已通知」
  addSendLog(0, gas.MAIL_STAGES.OFFICIAL, 'FAILED');
  const res2 = gas.apiSavePreacherTranslationEntry(Q, DATES[1], 'FLOWER', 1, PEOPLE.P9702);
  check('★★★★ 正式發出但狀態 FAILED（冇人收到）⇒ 唔算已通知，照舊直接改', res2.sheetOnly === false, JSON.stringify(res2));
  check('★★★★ isVersionNoticeSent_：舊版寄過、最新版（v1）未寄 ⇒ false（按版本判斷）',
    gas.isVersionNoticeSent_(Q, 1) === false);
  clearSendLog();
}

console.log('\n=== BC1／BC4　已正式發出 ⇒ 不改 RosterAssignments，只寫 grid；彈窗讀工作表 ===');
{
  addSendLog(0, gas.MAIL_STAGES.OFFICIAL, 'DRY_RUN');
  const before = gas.apiListPreacherTranslationPending(Q);
  check('★★★★★ 已正式發出（DRY_RUN 都算）：writesToSheetOnly = true', before.writesToSheetOnly === true);
  const target = DATES[2];
  const rowBefore = JSON.stringify(flowerRow(0, target));
  const res = gas.apiSavePreacherTranslationEntry(Q, target, 'FLOWER', 1, PEOPLE.P9703);
  check('★★★★★★ 回傳 sheetOnly = true', res.sheetOnly === true, JSON.stringify(res));
  check('★★★★★★ RosterAssignments **完全冇動**（已寄出嗰一版嘅內容唔可以被改寫）',
    JSON.stringify(flowerRow(0, target)) === rowBefore, JSON.stringify(flowerRow(0, target)));
  check('★★★★★ grid 工作表嗰一格已經有人名', gridCell(0, target, 'FLOWER') === PEOPLE.P9703, gridCell(0, target, 'FLOWER'));
  const audit = gas.readSheet(S.AUDIT_LOG).filter(function (r) { return r[C.AUDIT_LOG.ACTION] === 'FILL_PREACHER_TRANSLATION'; });
  check('★★★★ AuditLog 記一行，備註講明只寫工作表',
    audit.length > 0 && /只寫了職事表工作表/.test(String(audit[audit.length - 1][C.AUDIT_LOG.NOTES])),
    JSON.stringify(audit.slice(-1)));

  const after = gas.apiListPreacherTranslationPending(Q);
  const cell = pendingFlower(after, target);
  check('★★★★★ 彈窗資料：工作表上已填嗰格仍然列出，而且帶住 currentName（見到工作表上嘅值，唔係舊值／空格）',
    cell && cell.currentName === PEOPLE.P9703 && cell.sheetOnly === true, JSON.stringify(cell));
  const other = pendingFlower(after, DATES[3]);
  check('★★★★ 其他未填嘅格：冇 currentName、sheetOnly=false',
    other && other.currentName === '' && other.sheetOnly === false, JSON.stringify(other));
  check('★★★★ 改寫同一格：第二次填另一個人，彈窗讀到最新嗰個',
    gas.apiSavePreacherTranslationEntry(Q, target, 'FLOWER', 1, PEOPLE.P9702).sheetOnly === true
    && pendingFlower(gas.apiListPreacherTranslationPending(Q), target).currentName === PEOPLE.P9702);
  gas.apiSavePreacherTranslationEntry(Q, target, 'FLOWER', 1, PEOPLE.P9703);
}

console.log('\n=== BC5　〔儲存及寄出〕偵測得到工作表上嗰一格改動，而且冇放行框 ===');
{
  const target = DATES[2];
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★★ 不是「零改動」（第七十三輪 K1 就係回「沒有偵測到任何改動」）',
    plan.zeroChange === false, JSON.stringify(plan).slice(0, 300));
  const hit = (plan.gridChanges || []).filter(function (g) {
    return JSON.stringify(g).indexOf(target) !== -1 && JSON.stringify(g).indexOf('FLOWER') !== -1;
  });
  check('★★★★★ gridChanges 列出這一格獻花', hit.length === 1, JSON.stringify(plan.gridChanges).slice(0, 400));
  check('★★★★★ 沒有放行框（填獻花唔係違反）', plan.needsRelease === false, JSON.stringify(plan.violations.real).slice(0, 300));
}

console.log('\n=== BC6　「開季前準備」嘅獻花未填計數 ===');
{
  const inputs = gas.buildPreQuarterChecklistInputs_(Q);
  check('★★★★★ 已通知過人嘅版本：工作表上已填嗰格計入「已填」（唔會填完仍顯示未填）',
    inputs.filledByDatePost[DATES[2] + '|FLOWER'] === true, JSON.stringify(inputs.filledByDatePost));
  const flower = gas.planPreQuarterChecklist_(inputs).items.filter(function (i) { return i.id === 'flowerEmpty'; })[0];
  check('★★★★ 獻花未填 = 4 週 − 已填 3 格（2 格寫入長表、1 格只寫工作表）= 1', flower.count === 1, JSON.stringify(flower));
  clearSendLog();
  const inputs2 = gas.buildPreQuarterChecklistInputs_(Q);
  check('★★★★ 未通知過人：照舊只看資料層（工作表上嗰格唔計）',
    !inputs2.filledByDatePost[DATES[2] + '|FLOWER'], JSON.stringify(inputs2.filledByDatePost));
}

console.log('\n=== BC7　畫面：專屬提示句、狀態文字 ===');
{
  const zone2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8').split(String.fromCharCode(13)).join('');
  check('★★★★★ 提示句全文（Ivan 指定）',
    zone2.indexOf('這一季已經正式發出。你在這裡改的格會先寫在職事表上；要撳第 2 步〔儲存及寄出〕才會成為新一版，') !== -1
    && zone2.indexOf('之後用「改動後重發」通知受影響的人。') !== -1);
  check('★★★★★ 儲存之後狀態：sheetOnly ⇒「已寫在職事表，未儲存成新版本」，否則「已儲存 ✓」',
    zone2.indexOf("(res && res.sheetOnly)") !== -1 && zone2.indexOf("'已寫在職事表，未儲存成新版本' : '已儲存 ✓'") !== -1);
  check('★★★★ 開彈窗時已寫工作表嘅格預填狀態文字', zone2.indexOf("c.sheetOnly ? '已寫在職事表，未儲存成新版本' : ''") !== -1);
  check('★★★★ 只有 writesToSheetOnly 先出新提示（否則照舊句）',
    zone2.indexOf('if (data.writesToSheetOnly) {') !== -1 && zone2.indexOf('} else if (data.officialSentHint) {') !== -1);
}

console.log('\n=== BC8　〔儲存及寄出〕之後：工作表上嗰格成為新一版，自由文字名唔會蒸發 ===');
{
  clearSendLog();
  addSendLog(0, gas.MAIL_STAGES.OFFICIAL, 'DRY_RUN');
  const v0Before = JSON.stringify([flowerRow(0, DATES[2]), flowerRow(0, DATES[3])]);
  // DATES[2]：NameMapping 內嘅會友；DATES[3]：外請（唔喺 NameMapping）嘅自由文字
  gas.apiSavePreacherTranslationEntry(Q, DATES[2], 'FLOWER', 1, PEOPLE.P9703);
  const freeRes = gas.apiSavePreacherTranslationEntry(Q, DATES[3], 'FLOWER', 1, '客席甲');
  check('★★★★ 外請自由文字一樣只寫工作表', freeRes.sheetOnly === true && freeRes.linkedToNameMapping === false, JSON.stringify(freeRes));
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★ 計劃唔被擋，自由文字唔當「認不出的名」',
    plan.blocked === false && (plan.unresolved || []).length === 0, JSON.stringify(plan).slice(0, 300));
  check('★★★★★ 兩格都偵測到', (plan.gridChanges || []).length === 2, JSON.stringify(plan.gridChanges).slice(0, 400));
  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★ 建立新版本', result.ok === true && result.versionCreated === true, JSON.stringify(result).slice(0, 300));
  const v1 = gas.findLatestVersionNo(Q);
  check('★★★★ 新版本號 = 1', v1 === 1);
  const r2 = flowerRow(1, DATES[2]);
  const r3 = flowerRow(1, DATES[3]);
  check('★★★★★ 新一版：會友嗰格有 PersonID、來源 MANUAL',
    r2[A.PERSON_ID] === 'P9703' && r2[A.ASSIGN_SOURCE] === 'MANUAL', JSON.stringify(r2));
  check('★★★★★ 新一版：自由文字嗰格名字保留、來源 MANUAL（唔蒸發成空字串）',
    r3[A.PERSON_NAME_SNAPSHOT] === '客席甲' && r3[A.ASSIGN_SOURCE] === 'MANUAL', JSON.stringify(r3));
  check('★★★★★★ 已寄出嗰一版（v0）嘅長表始終冇被改寫',
    JSON.stringify([flowerRow(0, DATES[2]), flowerRow(0, DATES[3])]) === v0Before);
  check('★★★★ 新一版未通知過人 ⇒ 再填格恢復照舊直接改',
    gas.apiSavePreacherTranslationEntry(Q, DATES[1], 'FLOWER', 1, PEOPLE.P9701).sheetOnly === false);
}

console.log('\n=== BC9　已通知過人嘅版本：工作表找唔到嗰格 ⇒ 要拋錯，唔可以靜靜當成功 ===');
{
  clearSendLog();
  addSendLog(1, gas.MAIL_STAGES.RESEND, 'SENT');
  let threw = null;
  try { gas.apiSavePreacherTranslationEntry(Q, '2099-12-31', 'FLOWER', 1, PEOPLE.P9701); } catch (e) { threw = e; }
  check('★★★★★ 改動後重發過嘅最新版（v1）+ 日期唔存在 ⇒ 拋錯（唯一寫入嘅地方寫唔到）',
    threw !== null && /找不到這一格/.test(threw.message), threw && threw.message);
  check('★★★★ 重發（RESEND）紀錄一樣算已通知', gas.isVersionNoticeSent_(Q, 1) === true);
  clearSendLog();
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
