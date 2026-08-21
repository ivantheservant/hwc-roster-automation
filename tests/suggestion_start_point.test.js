// 第四十二輪批次 A 組 ＋ B 組：〔請系統幫我調整〕嘅起點同違反偵測。
// FIXTURE-OK: 全部職事表資料由真入口 `apiGenerateDraftExecute()` 產生；
// 手砌嘅只有「幹事喺 grid 打字」（嗰個本來就係外部輸入）。
// 執行方式：node tests/suggestion_start_point.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// ── A 組：介面明文承諾咗一件系統唔會做嘅事 ──────────────────────
//
// 建議表上面自己寫住：
//
//   「改完可以回介面再撳一次『請系統幫我調整』，
//     系統會用你改完之後這一版做起點再算一次。」
//
// 而現場（2026-08-21 晚）係噉：
//
//   1. 改兩格 → 撳調整 → 建議表出現，報「你自己改過的（2 格）」
//   2. 撳〔稍後再決定〕
//   3. **喺正式職事表再改另外兩格**
//   4. 再撳調整 ⇒ 仍然報 2 格，第 3 步嗰兩格當咗唔存在
//
// ⚠️ 呢一份最核心嗰條斷言就係第 4 步要報 **4 格**。
//
// ⚠️ 而更加要記住嘅係點解呢個 bug 特別嚴重：
// **一句假承諾比冇個功能更差。** 冇功能佢會自己搵辦法；
// 有一句假承諾佢會信、會照做，然後系統靜靜做另一件事。
// 所以由呢一輪開始：畫面上每一句「系統會…」，都要有一條測試證明佢真係會。
//
// ── B 組：藍色格 0 格 ──────────────────────────────────────────
//
// Ivan 改咗兩格主席，系統報「藍色格 ＝ 系統建議改的（0 格）」。
// 要查清楚係「佢改嗰兩格真係冇違反」定係「系統根本偵測唔到」。
//
// 呢一份造一個**肯定違反**嘅改動（把某一週嘅主席改成上一週嗰一位，
// 而嗰個崗位 `AllowConsecutive = BLOCK`），然後由**真入口**
// `apiBuildSuggestion()` 叫落去，要求藍色格 ≥ 1。

const { loadGasSource } = require('./helpers/gas_loader.js');
const {
  RealisticMockSpreadsheet, seedSheet
} = require('./helpers/mock_sheets_realistic.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Trigger.gs', 'WebAppGuards.gs', 'WebAppDashboard.gs',
  'WebAppGenerate.gs', 'GridNameDropdown.gs', 'MailRedirect.gs',
  'Mailer.gs', 'SuggestionSheet.gs'
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

const Q = '2099T2';
const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS;
const S = gas.SHEETS;
const A = C.ROSTER_ASSIGNMENTS;
const DATES = [];
const PEOPLE = {
  P9701: '測甲', P9702: '測乙', P9703: '測丙', P9704: '測丁',
  P9705: '測戊', P9706: '測己'
};

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
  getActiveUser: function () { return { getEmail: function () { return 'b@example.invalid'; } }; }
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
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };

function buildFixture() {
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ,
      [C.CONFIG.TYPE]: 'STR' }]);
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 2,
      [C.QUARTERS.START_DATE]: '2099-04-05', [C.QUARTERS.END_DATE]: '2099-05-24',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(2099, 3, 5 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    DATES.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['D'],
    [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID,
      C.SERVICE_DATES.SERVICE_DATE, C.SERVICE_DATES.WEEK_INDEX,
      C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    DATES.map(function (d, i) {
      return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0,
        [C.SERVICE_DATES.AUTO_GENERATE]: true };
    }));

  // ⚠️ 主席嗰個崗位 `AllowConsecutive = BLOCK`——B 組要造一個
  // 「連續兩週同一人」嘅違反，所以呢個欄位一定要 BLOCK。
  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE,
    C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER,
    C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
  [['CHAIR', '主席', true, 'BLOCK'], ['READ', '讀經', true, 'ALLOW']]
    .map(function (p, i) {
      return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: p[2], [C.POSTS.ALLOW_CONSECUTIVE]: p[3],
        [C.POSTS.MUTEX_GROUP]: '', [C.POSTS.DISPLAY_ORDER]: i + 1,
        [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
    }));

  seedSheet(ss, S.NAME_MAPPING, ['N'], [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC,
    C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
  Object.keys(PEOPLE).map(function (id) {
    return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id],
      [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid',
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

  // ⚠️ `SEMI_NO_CONSECUTIVE` 一定要開，否則 `findStateViolations_()`
  // 根本唔會行嗰一段——噉樣藍色格永遠係 0，而測試會綠燈，
  // 即係一個假綠燈：測試同現場都話「冇違反」，而其實係冇檢查過。
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL,
    C.RULE_SETTINGS.ENABLED, C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION,
    C.RULE_SETTINGS.PRIORITY],
  [['HARD_ELIGIBILITY', 'HARD'], ['HARD_NO_AUTO_PREACHER', 'HARD'],
    ['SEMI_NO_CONSECUTIVE', 'SEMI_HARD']].map(function (r) {
    return { [C.RULE_SETTINGS.RULE_ID]: r[0], [C.RULE_SETTINGS.LEVEL]: r[1],
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'WARN',
      [C.RULE_SETTINGS.PRIORITY]: 1 };
  }));

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

/** 搵機器鍵嗰一行（建議表頂有圖例，行號會浮動）。 */
function findKeyRow(sh) {
  for (let r = 1; r <= Math.min(sh.getLastRow(), 12); r++) {
    const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (row.some(function (v) { return String(v || '').indexOf('#') !== -1; })) return r;
  }
  return -1;
}

/** 模擬幹事喺 grid 打字——外部輸入，手砌係正路。 */
function setGrid(sheetName, date, post, text) {
  const sh = ss.getSheetByName(sheetName);
  const keyRow = findKeyRow(sh);
  if (keyRow === -1) return false;
  const head = sh.getRange(keyRow, 1, 1, sh.getLastColumn()).getValues()[0];
  let col = -1;
  for (let i = 0; i < head.length; i++) {
    if (String(head[i]) === post + '#1') { col = i + 1; break; }
  }
  if (col === -1) return false;
  for (let r = keyRow + 1; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) !== date) continue;
    sh.getRange(r, col).setValue(text);
    return true;
  }
  return false;
}

function readGrid(sheetName, date, post) {
  const sh = ss.getSheetByName(sheetName);
  const keyRow = findKeyRow(sh);
  const head = sh.getRange(keyRow, 1, 1, sh.getLastColumn()).getValues()[0];
  let col = -1;
  for (let i = 0; i < head.length; i++) {
    if (String(head[i]) === post + '#1') { col = i + 1; break; }
  }
  for (let r = keyRow + 1; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) !== date) continue;
    return String(sh.getRange(r, col).getValue() || '').trim();
  }
  return '';
}

function snapshotAssignments() {
  return JSON.stringify(gas.readSheet(S.ROSTER_ASSIGNMENTS));
}

// =====================================================================
console.log('\n=== 前置：生成初稿 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
const V0 = gas.findLatestVersionNo(Q);
const GRID = gas.buildRosterSheetName_(Q, V0);
check('★★★★ 有一張 grid', !!ss.getSheetByName(GRID), GRID);

// =====================================================================
console.log('\n=== A【核心】撳兩次調整，中間喺正式表再改 ⇒ 一定要計埋 ===');
{
  // ── 第 1 次：改兩格 ────────────────────────────────────────
  const chair0 = readGrid(GRID, DATES[0], 'CHAIR');
  const names = Object.keys(PEOPLE).map(function (id) { return PEOPLE[id]; });
  const pick = function (exclude) {
    return names.filter(function (n) { return exclude.indexOf(n) === -1; })[0];
  };

  const c2 = readGrid(GRID, DATES[2], 'CHAIR');
  const c3 = readGrid(GRID, DATES[3], 'CHAIR');
  check('（前置）改第一格', setGrid(GRID, DATES[2], 'CHAIR', pick([c2, chair0])));
  check('（前置）改第二格', setGrid(GRID, DATES[3], 'CHAIR', pick([c3, chair0])));

  const first = gas.apiBuildSuggestion(Q);
  check('★★★★ 第一次調整成功', first.ok === true, JSON.stringify(first).slice(0, 300));
  checkEqual('★★★★★ 第一次認到 2 格', first.manualCount, 2);
  check('★★★★★ 而且講得出起點係邊一張表'
    + '——唔講嘅話，「系統有冇計我啱啱改嗰幾格」呢條問題幹事答唔到',
    String(first.startNote || '').indexOf(GRID) !== -1, first.startNote);

  // ── 幹事撳〔稍後再決定〕：建議表留低，正式表冇動 ─────────────
  check('（前置）建議表仲喺度', !!ss.getSheetByName(first.sheetName), first.sheetName);

  // ── 第 2 次：**喺正式表**再改多兩格 ─────────────────────────
  const c5 = readGrid(GRID, DATES[5], 'CHAIR');
  const c6 = readGrid(GRID, DATES[6], 'CHAIR');
  check('（前置）喺正式表再改第三格', setGrid(GRID, DATES[5], 'CHAIR', pick([c5, chair0])));
  check('（前置）喺正式表再改第四格', setGrid(GRID, DATES[6], 'CHAIR', pick([c6, chair0])));

  const second = gas.apiBuildSuggestion(Q);
  check('★★★★ 第二次調整成功', second.ok === true, JSON.stringify(second).slice(0, 300));

  // ⚠️⚠️ 呢一條就係現場嗰個 bug。上一輪呢度會係 2。
  checkEqual('★★★★★★ **第二次要認到 4 格**'
    + '——建議表上面自己寫住「系統會用你改完之後那一版做起點再算一次」，'
    + '報返 2 格就等於介面呃咗幹事',
    second.manualCount, 4);
  checkEqual('★★★★★ 而且起點係**正式表**（唔係上一次嗰張建議表快照）',
    second.startSource, 'GRID');
  check('★★★★★ 起點嗰句要講得出係邊一張、邊一版',
    String(second.startNote || '').indexOf(GRID) !== -1
      && String(second.startNote || '').indexOf('第 ' + V0 + ' 版') !== -1,
    second.startNote);
}

console.log('\n=== A【核心】喺建議表上改 ⇒ 起點係建議表 ===');
{
  const state = gas.apiGetSuggestionState(Q);
  check('（前置）有建議表', state.hasSuggestion === true, JSON.stringify(state));

  // ⚠️ 只改建議表，唔掂正式表 ⇒ 唔應該問，直接用建議表。
  const before = readGrid(state.sheetName, DATES[1], 'READ');
  const other = Object.keys(PEOPLE).map(function (id) { return PEOPLE[id]; })
    .filter(function (n) { return n !== before; })[0];
  check('（前置）喺建議表改一格', setGrid(state.sheetName, DATES[1], 'READ', other));

  const r = gas.apiBuildSuggestion(Q);
  check('★★★★ 成功', r.ok === true, JSON.stringify(r).slice(0, 300));
  checkEqual('★★★★★ 起點係建議表'
    + '（Ivan 明確要求：可以喺建議表上再改，重複到滿意為止）',
    r.startSource, 'SUGGESTION');
  check('★★★★★ 起點嗰句講得出建議表個名',
    String(r.startNote || '').indexOf('_建議') !== -1, r.startNote);
}

console.log('\n=== A【核心】兩張都改過 ⇒ 問幹事，唔可以靜靜揀一張 ===');
{
  const state = gas.apiGetSuggestionState(Q);
  const gBefore = readGrid(GRID, DATES[4], 'READ');
  const sBefore = readGrid(state.sheetName, DATES[4], 'CHAIR');
  const names = Object.keys(PEOPLE).map(function (id) { return PEOPLE[id]; });
  check('（前置）喺正式表改一格',
    setGrid(GRID, DATES[4], 'READ',
      names.filter(function (n) { return n !== gBefore; })[0]));
  check('（前置）喺建議表改一格',
    setGrid(state.sheetName, DATES[4], 'CHAIR',
      names.filter(function (n) { return n !== sBefore; })[0]));

  const before = snapshotAssignments();
  const r = gas.apiBuildSuggestion(Q);
  checkEqual('★★★★★★ **回一個「要你揀」**，唔可以自己揀一張'
    + '——揀錯嗰張就等於靜靜丟咗佢一批改動，而佢完全唔會知',
    { ok: r.ok, needsChoice: r.needsChoice }, { ok: false, needsChoice: true });
  check('★★★★★ 而且兩張表個名都講得出（唔講嘅話佢揀乜都唔知）',
    String(r.gridSheetName || '').indexOf(GRID) !== -1
      && String(r.suggestionSheetName || '').indexOf('_建議') !== -1,
    JSON.stringify(r));
  check('★★★★★ 訊息要明講「另一張嘅改動今次唔會計」',
    String(r.message || '').indexOf('不會計算在內') !== -1, r.message);
  checkEqual('★★★★★ 問緊嘅時候一格都唔可以寫', snapshotAssignments(), before);

  // ── 幹事揀咗「用正式表」──────────────────────────────────
  const chosen = gas.apiBuildSuggestion(Q, 'GRID');
  check('★★★★★ 揀完之後照做', chosen.ok === true, JSON.stringify(chosen).slice(0, 300));
  checkEqual('★★★★★ 而且真係用佢揀嗰張', chosen.startSource, 'GRID');
}

console.log('\n=== A：指紋讀唔到 ⇒ 問幹事，唔可以猜 ===');
{
  // ⚠️ 舊嘅建議表（呢一輪之前產生嘅）冇嗰一行指紋。
  // 猜錯嘅代價係靜靜丟咗佢一批改動，所以一律問。
  const state = gas.apiGetSuggestionState(Q);
  const sh = ss.getSheetByName(state.sheetName);
  let fpRow = -1;
  for (let r = sh.getLastRow(); r >= 1; r--) {
    if (String(sh.getRange(r, 1).getValue() || '').trim()
        === gas.SUGGESTION_FINGERPRINT_MARK) { fpRow = r; break; }
  }
  check('★★★★ 建議表最底真係有一行指紋', fpRow > 0, 'fpRow=' + fpRow);
  check('★★★★★ 而且嗰一行唔會被當成資料讀入去'
    + '（讀咗入去就會令兩次指紋永遠對唔上，變成每次都問一條冇意義嘅問題）',
    Object.keys(gas.readGridTextFromSheet_(state.sheetName, TZ))
      .every(function (k) { return /^\d{4}-\d{2}-\d{2}\|/.test(k); }), '');

  sh.getRange(fpRow, 1, 1, 3).setValues([['', '', '']]);
  const r = gas.apiBuildSuggestion(Q);
  checkEqual('★★★★★ 指紋冇咗 ⇒ 問幹事', r.needsChoice, true);
  check('★★★★ 而且講得出係「睇唔出由邊一版算出嚟」',
    String(r.message || '').indexOf('看不出') !== -1, r.message);

  // 收拾：揀返正式表，令下面嘅測試由一個乾淨狀態開始。
  gas.apiBuildSuggestion(Q, 'GRID');
}

// =====================================================================
console.log('\n=== B【核心】造一個肯定違反嘅改動 ⇒ 藍色格一定 ≥ 1 ===');
{
  gas.apiDiscardSuggestion(Q);

  // ⚠️ 由**真入口**造：喺 grid 打字，把第 4 週嘅主席改成第 3 週嗰一位。
  // `CHAIR` 嘅 `AllowConsecutive = BLOCK`，所以呢個一定違反
  // `SEMI_NO_CONSECUTIVE`。
  const prev = readGrid(GRID, DATES[2], 'CHAIR');
  check('（前置）上一週有人', prev !== '' && prev.indexOf('待填') === -1, prev);
  check('（前置）把下一週嘅主席改成上一週嗰一位',
    setGrid(GRID, DATES[3], 'CHAIR', prev));

  const chk = gas.apiCheckMyChanges(Q);
  check('★★★★★ 〔檢查我的改動〕捉到呢個違反'
    + '——捉唔到就代表偵測嗰一段根本冇行過，而畫面會話「全部沒有問題」',
    (chk.violations || []).some(function (v) {
      return v.ruleId === gas.RULE_IDS.NO_CONSECUTIVE;
    }), JSON.stringify(chk.violations));

  const r = gas.apiBuildSuggestion(Q, 'GRID');
  check('★★★★ 產生到建議表', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ **藍色格 ≥ 1**'
    + '——Ivan 現場見到 0 格，要分得出「真係冇違反」定係「偵測唔到」。'
    + '呢個 case 係肯定違反，所以 0 就一定係 bug',
    r.systemCount >= 1, 'systemCount=' + r.systemCount
      + ' remaining=' + JSON.stringify(r.remaining));
}

console.log('\n=== B：藍色格嘅備註要講得出「點解改」 ===');
{
  // ⚠️ Ivan 未驗過呢一項（佢嗰次藍色格係 0，所以冇嘢可以睇）。
  const state = gas.apiGetSuggestionState(Q);
  const sh = ss.getSheetByName(state.sheetName);
  const notes = [];
  const keyRow = findKeyRow(sh);
  for (let r = keyRow + 1; r <= sh.getLastRow(); r++) {
    for (let c = 1; c <= sh.getLastColumn(); c++) {
      const n = sh.getRange(r, c).getNote();
      if (n) notes.push(n);
    }
  }
  // ⚠️ 第四十三輪批次 C1：`mock_sheets_realistic.js` 而家**真係記低格註同底色**。
  // 之前兩樣都係 no-op，所以「對話框報咗，但表上冇」呢一類 bug
  // 一條測試都捉唔到——現場撞到嗰個黃色格就係噉走甩嘅。
  const built = gas.buildSuggestionState_(Q,
    gas.resolveSuggestionStartPoint_(Q, gas.findLatestVersionNo(Q), 'GRID'));
  const noteTexts = Object.keys(built.notes).map(function (k) { return built.notes[k]; });
  // （下面兩條斷言要用到 `noteTexts`，所以要喺呢一行之後。）
  check('★★★★★ 系統改過嘅格有備註，而且講得出原因',
    noteTexts.some(function (t) { return t.indexOf('系統改了這一格。原因：') !== -1; }),
    JSON.stringify(noteTexts).slice(0, 400));
  check('★★★★★ 而且講得出原本係邊個、改成邊個'
    + '——淨係講「系統改咗」，幹事核對唔到',
    noteTexts.some(function (t) {
      return t.indexOf('原本是「') !== -1 && t.indexOf('改成「') !== -1;
    }), JSON.stringify(noteTexts).slice(0, 400));
  check('★★★★★★ **而且嗰啲備註真係寫咗落張表**'
    + '——呢一條就係 C1 嗰類問題嘅防線：對話框講「把滑鼠停喺上面會見到原因」，'
    + '就一定要有一條測試證明表上真係有嗰個註',
    notes.length >= 1, 'notes=' + notes.length);
  check('★★★★★ 表上嗰個註同產生出嚟嗰個係同一句',
    notes.some(function (n) { return noteTexts.indexOf(n) !== -1; }),
    JSON.stringify(notes).slice(0, 300));
}

console.log('\n=== B：藍色格 0 格嗰陣，文案要讀得通 ===');
{
  const ui = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptSuggestion.html'), 'utf8');
  const bare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 系統一格都唔使改嗰陣，直接講「不需要調整任何東西」'
    + '——「藍色格 0 格」要人自己推理，而佢推理嘅結果多數係「系統壞咗」',
    /cc\.system === 0 && cc\.both === 0/.test(bare) && /不需要調整任何東西/.test(ui), '');
  check('★★★★★★ 而且三個數字全部讀 `colourCounts`（上色嗰陣數出嚟嗰個）'
    + '——讀 `manualCount`／`systemCount` 就會出現第四十三輪現場嗰個情況：'
    + '對話框報「黃色 1 格」而張表上一格黃色都冇',
    /const cc = r\.colourCounts/.test(bare)
      && !/r\.manualCount/.test(bare) && !/r\.systemCount/.test(bare), '');
}

// =====================================================================
console.log('\n=== A：介面上每一句「系統會…」都要有測試證明佢真係會 ===');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'SuggestionSheet.gs'), 'utf8');
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ 建議表上面嗰句改成「重新讀這一張表做起點」'
    + '——舊嗰句「用你改完之後這一版」係一句假承諾',
    /系統會重新讀這一張表做起點再算一次/.test(src), '');
  check('★★★★★ 而且講埋「改正式表就用正式表、兩張都改就會問你」',
    /兩張都改過的話，它會問你要用哪一張/.test(src), '');
  check('★★★★★ `buildSuggestionState_()` 唔可以再自己靠「建議表在不在」猜起點',
    !/const hasSuggestion = /.test(bare)
      && /function buildSuggestionState_\(quarterId, start\)/.test(bare), '');
  check('★★★★★ 起點每次都由 `resolveSuggestionStartPoint_()` 重新算',
    /const start = resolveSuggestionStartPoint_\(quarterId, versionNo, startFrom\);/.test(bare),
    '');
  check('★★★★★ 建議表個指紋要**讀返出嚟先算**（同一把尺）'
    + '——用寫入之前嗰份資料算嘅話，幹事一格都冇改都會被當成改過',
    /readGridTextFromSheet_\(sheetName, timezone\)\)/.test(bare), '');
}

console.log('\n=== A：指紋函式本身 ===');
{
  const a = { 'x|P|1': '甲', 'y|P|1': '乙' };
  const b = { 'y|P|1': '乙', 'x|P|1': '甲' };
  checkEqual('★★★★★ 同一份內容、唔同插入次序 ⇒ 同一個指紋'
    + '（靠 `Object.keys()` 次序嘅話，每次都會以為幹事改過）',
    gas.fingerprintGridText_(a), gas.fingerprintGridText_(b));
  check('★★★★★ 改一個字 ⇒ 指紋唔同',
    gas.fingerprintGridText_(a) !== gas.fingerprintGridText_({ 'x|P|1': '丙', 'y|P|1': '乙' }),
    '');
  check('★★★★★ 多一格 ⇒ 指紋唔同（格數係指紋嘅一部分）',
    gas.fingerprintGridText_(a)
      !== gas.fingerprintGridText_({ 'x|P|1': '甲', 'y|P|1': '乙', 'z|P|1': '' }), '');
  checkEqual('★★★★ 空 map 唔會炸', gas.fingerprintGridText_({}),
    gas.fingerprintGridText_({}));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
