// 第六十三輪批次 A 組：填講員之後，公開連結同個人 PDF 都冇跟上（同一個根）。
// 執行方式：node tests/stale_after_fill.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（`2027T4`）
// ═════════════════════════════════════════════════════════════════════
//
//   11:20:43　v0 生成
//   11:20:51　公開連結自動發佈
//   11:21–11:23　經「填講員／翻譯／獻花」填咗 12 週講員、4 週獻花
//
// 一個月之後讀公開試算表：「更新時間：2026-09-08 11:20:51」，
// **13 週講員全部「待確認」**。填講員係直接改最新版本（唔造新版本），
// 而全系統只有「造新版本」嗰幾條路先會發佈。
//
// 同一個根嘅第二個後果：個人 PDF 嘅「已存在」只睇檔名＋大小。
// 先產 PDF、後填講員 ⇒ 57 份 PDF 永遠印住「待確認」，寄出時冇任何警告。
//
// 正常流程「生成 → 填講員 → 寄給堂委審閱」：審閱信信末嗰條永久連結
// 開出嚟，講員一欄全部「待確認」——堂委會以為幹事未填。
//
// ⚠️ fixture 一律由真入口產生：`apiGenerateDraftExecute()`、
// `apiSavePreacherTranslationEntry()`。

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
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs', 'MailRedirect.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs',
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs',
  'PdfExport.gs', 'PdfFolders.gs', 'PdfBatch.gs'
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
const Q = '2099T1';
const DATES = [];
const PEOPLE = { P9301: '假講甲', P9302: '假講乙', P9303: '假講丙' };

// ── 時鐘：每叫一次 nowTimestamp_() 行前一分鐘 ─────────────────────
let tick = 0;
function clockText(n) {
  const p2 = function (x) { return x < 10 ? '0' + x : String(x); };
  return '2099-01-01 ' + p2(9 + Math.floor(n / 60)) + ':' + p2(n % 60) + ':00';
}
function nowText() { return clockText(tick++); }
/** 一個喺 TZ 顯示成 `text` 嘅 Date（Drive 檔案嘅 getLastUpdated() 係 Date）。 */
function tzDate(text) {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  let guess = new Date(target);
  for (let i = 0; i < 3; i++) {
    const o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(guess).forEach(function (p) { if (p.type !== 'literal') o[p.type] = p.value; });
    const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
    if (asUtc === target) break;
    guess = new Date(guess.getTime() + (target - asUtc));
  }
  return guess;
}

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
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'a@example.invalid'; } }; } };
gas.CacheService = { getScriptCache: function () {
  return { get: function () { return null; }, put: function () {}, remove: function () {} }; } };
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    if (fmt === 'yyyy-MM-dd') return d;
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit',
      second: '2-digit', hour12: false }).format(date);
    return d + ' ' + t;
  },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.nowTimestamp_ = nowText;
gas.applyTimestampFormat_ = function () {};
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };

// ── 公開連結：一張假嘅 PublicLinks ──────────────────────────────────
let linkRow = null;
let publishCount = 0;
let publishShouldFail = false;
gas.findPublicLinkRow_ = function () { return linkRow; };
gas.publishPublicRoster_ = function (quarterId) {
  if (publishShouldFail) throw new Error('外部試算表暫時寫不到');
  publishCount++;
  const at = nowText();
  linkRow = { quarterId: quarterId, fileUrl: 'https://example.invalid/public',
    lastPublishedAt: at, lastPublishedAtRaw: at, lastPublishedVersion: gas.findLatestVersionNo_(quarterId) };
  return { versionNo: linkRow.lastPublishedVersion };
};

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
  [['CHAIR', '主席', true], ['PREACH', '講員', false]].map(function (p, i) {
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
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  Object.keys(PEOPLE).map(function (id, i) {
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
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
})();

// =====================================================================
console.log('\n=== A：時間值統一（Date 同字串要比得埋）===');
{
  check('★★★★ 字串原樣', gas.normalizeSheetTimestamp_('2099-01-01 09:05:00', TZ) === '2099-01-01 09:05:00');
  check('★★★★ 冇秒數補 00', gas.normalizeSheetTimestamp_('2099-01-01 09:05', TZ) === '2099-01-01 09:05:00');
  check('★★★★★ Date（試算表自動轉咗）同字串得出同一個值',
    gas.normalizeSheetTimestamp_(tzDate('2099-01-01 09:05:00'), TZ) === '2099-01-01 09:05:00');
  check('★★★★★ 讀唔到 ⇒ null（唔係空字串、唔係「好舊」）',
    gas.normalizeSheetTimestamp_('', TZ) === null && gas.normalizeSheetTimestamp_('亂打', TZ) === null);
}

console.log('\n=== 前置：生成（會自動發佈公開連結）===');
gas.apiGenerateDraftExecute(Q);
check('（前置）生成之後自動發佈咗一次', publishCount === 1 && linkRow && linkRow.lastPublishedVersion === 0,
  JSON.stringify(linkRow));
{
  const f = gas.evaluatePublicLinkFreshness_(Q);
  check('★★★★ 生成完、未改過 ⇒ 唔過期', f.hasLink && !f.stale, JSON.stringify(f));
}

// 「產生個人 PDF」：喺發佈之後、填講員之前
const PDF_TIME = tzDate(nowText());
const chairPeople = gas.listPeopleNeedingPersonalPdf_(Q, 0);
const FILES = new Map();
chairPeople.forEach(function (p) {
  FILES.set(gas.buildAttachmentName_(Q, 0, p.nameTC), { sizeBytes: 50000, lastUpdated: PDF_TIME });
});
check('（前置）有人要個人 PDF', chairPeople.length > 0);

console.log('\n=== 填一格講員（直接改最新版本，唔造新版本）===');
gas.apiSavePreacherTranslationEntry(Q, DATES[0], 'PREACH', 1, '客席某牧師');
check('（前置）仍然係第 0 版', gas.findLatestVersionNo_(Q) === 0);

console.log('\n=== A1【核心】公開連結判定過期 ===');
{
  const f = gas.evaluatePublicLinkFreshness_(Q);
  check('★★★★★★ 填講員之後公開連結**過期**'
    + '——現場：一個月後開連結，13 週講員全部「待確認」',
    f.stale === true && f.reason === 'EDITED_AFTER_PUBLISH', JSON.stringify(f));
  check('★★★★ 講得出發佈時間同改動時間', f.lastPublishedAt && f.lastEditAt > f.lastPublishedAt,
    JSON.stringify(f));
  check('★★★★★ `tryPublishPublicRoster_()` 唔可以再以為「已經係最新」而略過',
    gas.publicLinkAlreadyAtLatest_(Q) === false);
}

console.log('\n=== A2【核心】個人 PDF 三個入口都判定過期 ===');
{
  const stamp = gas.readPersonalPdfContentStamp_(Q, 0);
  check('（前置）內容時間晚過 PDF 時間', stamp.updatedAt > gas.normalizeSheetTimestamp_(PDF_TIME, TZ),
    JSON.stringify(stamp));

  // 1. generateOnePersonalPdf_()：過期 ⇒ 唔當已存在，重做
  let built = 0;
  gas.buildPersonalPdfBlob_ = function () { built++; return { fileName: 'x.pdf', blob: {}, retries: 0 }; };
  gas.saveOrOverwriteFile_ = function () { return { getSize: function () { return 50000; } }; };
  const pid = chairPeople[0].personId;
  const out = gas.generateOnePersonalPdf_(Q, 0, pid, {}, false, FILES, [], { contentStamp: stamp });
  check('★★★★★★ 產生個人 PDF：過期嘅檔**唔當已存在**，要重做',
    out.skippedExisting === false && built === 1, JSON.stringify(out));
  check('★★★★ 而且標住「因為過期而重做」（報告要講）', out.regeneratedStale === true);
  // 對照：檔案喺改動之後先產生 ⇒ 照略過
  const fresh = new Map();
  fresh.set(gas.buildAttachmentName_(Q, 0, chairPeople[0].nameTC),
    { sizeBytes: 50000, lastUpdated: tzDate(nowText()) });
  const out2 = gas.generateOnePersonalPdf_(Q, 0, pid, {}, false, fresh, [], { contentStamp: stamp });
  check('★★★★★ 對照：改動之後先產生嘅 ⇒ 照略過（唔會每次都重做 57 份）',
    out2.skippedExisting === true && built === 1);

  // 2. checkMissingPersonalPdfs_()：過期計入缺件，分開講
  gas.findEmailTemplate_ = function () { return { attachType: 'PERSONAL_PDF' }; };
  gas.listRosterPdfInfoForQuarter_ = function () { return FILES; };
  const miss = gas.checkMissingPersonalPdfs_(Q, 0, gas.MAIL_STAGES.OFFICIAL);
  check('★★★★★★ 寄前缺件檢查：過期嘅計入缺件',
    miss.missing.length === chairPeople.length, JSON.stringify(miss));
  check('★★★★★ 而且分開講「缺」同「過期」',
    miss.absent.length === 0 && miss.stale.length === chairPeople.length);
  const gate = gas.evaluateStep4MissingPdfGate_(miss, 0.2);
  check('★★★★ 關卡訊息講明係過期', gate.blocked && /過期/.test(gate.message), gate.message);

  // 3. lookupExistingPersonalPdf_()：寄信嗰刻
  gas.findRosterPdfFile_ = function () {
    return { getSize: function () { return 50000; }, getLastUpdated: function () { return PDF_TIME; },
      getBlob: function () { return {}; }, getId: function () { return 'f'; } };
  };
  let thrown = null;
  try {
    gas.lookupExistingPersonalPdf_({ quarterId: Q, versionNo: 0 }, { personId: pid });
  } catch (err) { thrown = err; }
  check('★★★★★★ 寄信嗰刻：過期 ⇒ 當缺件（missing=true）',
    thrown && thrown.missing === true, thrown ? thrown.message : '冇拋錯');
  check('★★★★★ 訊息講明「填講員之前產生，請重新執行產生個人 PDF」',
    thrown && /填講員/.test(thrown.message) && /產生個人 PDF/.test(thrown.message));
}

console.log('\n=== A1【核心】寄給堂委審閱之前自動重發佈 ===');
{
  let sent = 0;
  gas.sendStage_ = function () { sent++; return { isDryRun: true, sent: 0, dryRun: 1, skipped: 0, failed: 0 }; };
  const before = publishCount;
  const r = gas.executeStep2_(Q);
  check('★★★★★★ 寄之前自動重發佈咗一次', publishCount === before + 1, publishCount);
  check('★★★★ 之後先寄', sent === 1);
  check('★★★★ 結果講明「寄之前已更新公開連結」', r.publicLinkRepublished === true);
  const f = gas.evaluatePublicLinkFreshness_(Q);
  check('★★★★★ 之後公開連結**唔再過期**', f.stale === false, JSON.stringify(f));

  // 未過期 ⇒ 唔會無謂再發
  const r2 = gas.ensurePublicLinkFreshBeforeSend_(Q);
  check('★★★★★ 未過期 ⇒ 唔再發（發佈要開外部試算表，唔係平嘢）',
    r2.republished === false && publishCount === before + 1);
}

console.log('\n=== A1：重發佈失敗 ⇒ 擋住，一封都唔寄 ===');
{
  gas.apiSavePreacherTranslationEntry(Q, DATES[1], 'PREACH', 1, '客席另一位牧師');
  check('（前置）又過期', gas.evaluatePublicLinkFreshness_(Q).stale === true);
  publishShouldFail = true;
  let sent = 0;
  gas.sendStage_ = function () { sent++; return {}; };
  let err = null;
  try { gas.executeStep2_(Q); } catch (e) { err = e; }
  check('★★★★★★ 擋住，而且係三段式訊息', err && /發生了甚麼/.test(err.message)
    && /一封都沒有寄出/.test(err.message), err ? err.message : '冇擋');
  check('★★★★★★ 一封都冇寄', sent === 0);
  publishShouldFail = false;
}

console.log('\n=== A1：其餘幾種情況 ===');
{
  const saved = linkRow;
  linkRow = Object.assign({}, saved, { lastPublishedVersion: -1 });
  check('★★★★ 版本號唔同 ⇒ 過期（VERSION）', gas.evaluatePublicLinkFreshness_(Q).reason === 'VERSION');
  linkRow = Object.assign({}, saved, { lastPublishedAt: '', lastPublishedAtRaw: '' });
  check('★★★★ 查唔到發佈時間 ⇒ 寧可當過期', gas.evaluatePublicLinkFreshness_(Q).reason === 'UNKNOWN_PUBLISH_TIME');
  linkRow = null;
  const none = gas.evaluatePublicLinkFreshness_(Q);
  check('★★★★★ 從來未發佈過 ⇒ 唔叫過期，係「冇連結」（另一道關卡處理）',
    none.hasLink === false && none.stale === false);
  linkRow = saved;
}

console.log('\n=== A：判斷只有一份，每處都叫佢 ===');
{
  const read = function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); };
  const core = read('FiveStageCore.gs');
  ['executeStep2_', 'executeStep4Send_', 'executeStep5Send_'].forEach(function (fn) {
    const body = core.slice(core.indexOf('function ' + fn + '('), core.indexOf('\n}', core.indexOf('function ' + fn + '(')));
    check('★★★★★ ' + fn + '() 寄之前叫 ensurePublicLinkFreshBeforeSend_()',
      body.indexOf('ensurePublicLinkFreshBeforeSend_(quarterId)') !== -1
      && body.indexOf('ensurePublicLinkFreshBeforeSend_(quarterId)')
        < Math.max(body.indexOf('sendStage_('), body.indexOf('sendResendStage_(')));
  });
  check('★★★★★ Dashboard 嘅 publicLink.stale 由同一支判斷出',
    /publicLink\.stale = !!\(freshness\.hasLink && freshness\.stale\)/.test(read('WebAppDashboard.gs'))
    && /evaluatePublicLinkFreshness_\(quarterId\)/.test(read('WebAppDashboard.gs')));
  check('★★★★ 畫面有「立即重新發佈」', /立即重新發佈/.test(read('ui/Script.html')));
  const mailer = read('Mailer.gs');
  const batch = read('PdfBatch.gs');
  check('★★★★★ 三個 PDF 入口都叫 isPersonalPdfStale_()',
    /isPersonalPdfStale_\(file\.getLastUpdated\(\)/.test(mailer)
    && /isPersonalPdfStale_\(existing\.lastUpdated/.test(batch)
    && /isPersonalPdfStale_\(info\.lastUpdated, stamp\.updatedAt, stamp\.timezone\)\) stale\.push\(p\)/.test(batch));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
