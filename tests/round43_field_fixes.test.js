// 第四十三輪批次 A／B／C／D／E／F／G／H／I：幹事實測第三輪嘅回饋。
// 執行方式：node tests/round43_field_fixes.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// ── C1：對話框報咗一個數字，而張表上冇對應嘅嘢 ──────────────────
//
// 現場：彈窗講「黃色格 ＝ 你自己改過的（1 格）／藍色格（1 格）」，
// 而 Ivan 喺 `_建議` 工作表上**搵唔到任何黃色格**。
//
// 成因：同一格既俾佢改過、又俾系統再改一次。兩個數字各自算啱咗，
// 而上色嗰段寫成「系統改過嘅蓋過幹事改過嘅」——所以表上得一格藍。
//
// ⚠️ 呢個係**第二次**同一種問題（上一次係第四十二輪嗰句
//「系統會用你改完那一版做起點」——承諾咗一件佢唔會做嘅事）。
//
// 所以由呢一輪開始多一條規矩：
//
//   **對話框報告嘅每一個數字，都要有一條測試證明表上真係有對應嘅嘢。**
//
// 而要做到呢件事，`mock_sheets_realistic.js` 嘅 `setBackground()`／
// `setNote()` 由 no-op 改成**真係記低**——之前兩樣都係 no-op，
// 所以呢一類 bug 一條測試都捉唔到。

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
  'Trigger.gs', 'WebAppGuards.gs', 'WebAppDashboard.gs', 'WebAppRollback.gs',
  'WebAppGenerate.gs', 'GridNameDropdown.gs', 'MailRedirect.gs',
  'SendRecipients.gs', 'Mailer.gs', 'SendOptions.gs', 'SuggestionSheet.gs'
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

const ROOT = path.join(__dirname, '..');
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
const bare = function (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

const Q = '2099T3';
const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS;
const S = gas.SHEETS;
const DATES = [];
const PEOPLE = {
  P9801: '試甲', P9802: '試乙', P9803: '試丙', P9804: '試丁', P9805: '試戊'
};

const ss = new RealisticMockSpreadsheet();
function dvBuilder() {
  const rec = { list: null, allowInvalid: null };
  const self = {
    _rec: rec,
    requireValueInList: function (l) { rec.list = l; return self; },
    setAllowInvalid: function (v) { rec.allowInvalid = v; return self; },
    setHelpText: function () { return self; },
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
  getActiveUser: function () { return { getEmail: function () { return 'r43@example.invalid'; } }; }
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
    return d + ' 09:00:00';
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
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 3,
      [C.QUARTERS.START_DATE]: '2099-07-05', [C.QUARTERS.END_DATE]: '2099-08-23',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);

  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.UTC(2099, 6, 5 + i * 7));
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

  // 主席 BLOCK ⇒ 造得出「連續兩週同一人」。
  // 講員 `AutoGenerate = FALSE` ⇒ D 組要證明佢**唔會**被自動派人。
  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE,
    C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER,
    C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
  [['CHAIR', '主席', true, 'BLOCK'], ['READ', '讀經', true, 'ALLOW'],
    ['PREACH', '講員', false, 'ALLOW']]
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

function keyRowOf(sh) {
  for (let r = 1; r <= Math.min(sh.getLastRow(), 12); r++) {
    const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (row.some(function (v) { return String(v || '').indexOf('#') !== -1; })) return r;
  }
  return -1;
}
function colOf(sh, postKey) {
  const keys = sh.getRange(keyRowOf(sh), 1, 1, sh.getLastColumn()).getValues()[0];
  for (let c = 0; c < keys.length; c++) if (String(keys[c] || '') === postKey) return c + 1;
  return -1;
}
function rowOf(sh, dateStr) {
  const kr = keyRowOf(sh);
  for (let r = kr + 1; r <= sh.getLastRow(); r++) {
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) === dateStr) return r;
  }
  return -1;
}
function setGrid(sheetName, dateStr, postKey, text) {
  const sh = ss.getSheetByName(sheetName);
  const r = rowOf(sh, dateStr);
  const c = colOf(sh, postKey);
  if (r === -1 || c === -1) return false;
  sh.getRange(r, c).setValue(text);
  return true;
}
function readGrid(sheetName, dateStr, postKey) {
  const sh = ss.getSheetByName(sheetName);
  return String(sh.getRange(rowOf(sh, dateStr), colOf(sh, postKey)).getValue() || '').trim();
}

// =====================================================================
console.log('\n=== 前置：生成初稿 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
const V0 = gas.findLatestVersionNo(Q);
const GRID = gas.buildRosterSheetName_(Q, V0);

// =====================================================================
console.log('\n=== C1【核心】對話框報嘅每一個數字，張表上都要有對應嘅嘢 ===');
{
  // ⚠️ 第四十六輪批次 C 組：**呢一節嘅預期行為反轉咗。**
  //
  // 本來造嘅係「一格既俾幹事改過、又俾系統再改一次」（紫色）。
  // 而由第四十六輪開始，Ivan 定咗一條原則：
  //
  //   > 系統改壞幹事親手做嘅決定，比排錯更差。
  //
  // 所以同一個 case 而家嘅正確結果係：**系統唔會動嗰一格**，
  // 改為上第四種色（橙）＋ 一個講清楚嘅備註 ＋ 喺對話框問返佢。
  //
  // 「紫色」呢一種**仍然存在**，但佢而家只會喺幹事**明確勾咗准動**
  // 之後先出現——下面第二段就係造嗰一種。
  const prev = readGrid(GRID, DATES[2], 'CHAIR#1');
  check('（前置）上一週有人', prev !== '' && prev.indexOf('待填') === -1, prev);
  check('（前置）改成連續兩週同一人', setGrid(GRID, DATES[3], 'CHAIR#1', prev));

  const r = gas.apiBuildSuggestion(Q, 'GRID');
  check('★★★★ 產生到建議表', r.ok === true, JSON.stringify(r).slice(0, 300));

  const norm = function (x) { return String(x || '').toLowerCase(); };
  const countColours = function (sheetName) {
    const sh2 = ss.getSheetByName(sheetName);
    const kr2 = keyRowOf(sh2);
    const seen2 = { manual: 0, system: 0, both: 0, manualViolation: 0 };
    for (let row = kr2 + 1; row <= sh2.getLastRow(); row++) {
      for (let c = 1; c <= sh2.getLastColumn(); c++) {
        const bg = norm(sh2.getRange(row, c).getBackground());
        if (bg === norm(gas.SUGGESTION_COLOR_MANUAL_VIOLATION)) seen2.manualViolation++;
        else if (bg === norm(gas.SUGGESTION_COLOR_MANUAL)) seen2.manual++;
        else if (bg === norm(gas.SUGGESTION_COLOR_SYSTEM)) seen2.system++;
        else if (bg === norm(gas.SUGGESTION_COLOR_BOTH)) seen2.both++;
      }
    }
    return seen2;
  };
  const sh = ss.getSheetByName(r.sheetName);
  const kr = keyRowOf(sh);
  const seen = countColours(r.sheetName);

  checkEqual('★★★★★★ **對話框報嘅每一個數字，同張表上實際上咗色嘅格數一模一樣**'
    + '——現場就係報「黃色 1 格」而張表上一格黃色都冇',
    r.colourCounts, seen);
  check('★★★★★★ **系統冇動幹事改嗰一格**，改為上橙色'
    + '——呢個係第四十六輪 C 組嗰條原則：'
    + '系統改壞幹事親手做嘅決定，比排錯更差',
    seen.manualViolation >= 1, JSON.stringify(seen));
  check('★★★★★★ 而且嗰一格**完全冇被改走**（`systemKeys` 唔會包住佢）'
    + '——上色啱咗而個值被改咗，等於顏色講大話',
    readGrid(r.sheetName, DATES[3], 'CHAIR#1') === prev,
    readGrid(r.sheetName, DATES[3], 'CHAIR#1') + ' / ' + prev);
  check('★★★★★ 對話框逐格列出嚟俾佢自己決定',
    (r.untouchedManual || []).length >= 1, JSON.stringify(r.untouchedManual));
  check('★★★★★ 而且講得出邊一格、邊個、點解',
    (r.untouchedManual || []).some(function (u) {
      return u.serviceDate === DATES[3] && u.postNameTC === '主席'
        && u.personName === prev && u.reason.indexOf('上一週同崗位已是此人') !== -1;
    }), JSON.stringify(r.untouchedManual));
  check('★★★★★ 四種顏色各有各嘅色碼，冇兩種撞埋',
    gas.SUGGESTION_COLOR_MANUAL !== gas.SUGGESTION_COLOR_SYSTEM
      && gas.SUGGESTION_COLOR_SYSTEM !== gas.SUGGESTION_COLOR_BOTH
      && gas.SUGGESTION_COLOR_MANUAL !== gas.SUGGESTION_COLOR_BOTH
      && gas.SUGGESTION_COLOR_MANUAL_VIOLATION !== gas.SUGGESTION_COLOR_MANUAL
      && gas.SUGGESTION_COLOR_MANUAL_VIOLATION !== gas.SUGGESTION_COLOR_SYSTEM
      && gas.SUGGESTION_COLOR_MANUAL_VIOLATION !== gas.SUGGESTION_COLOR_BOTH, '');
  check('★★★★★ 圖例有印埋第三同第四種顏色（唔印就要人自己估）',
    sh.getRange(2, 3).getValue().indexOf('紫色格') !== -1
      && sh.getRange(2, 4).getValue().indexOf('橙色格') !== -1,
    String(sh.getRange(2, 3).getValue()) + ' | ' + String(sh.getRange(2, 4).getValue()));

  // ── 格註：橙色格要講清楚「系統冇動佢」同埋點樣叫佢動 ──────────
  const notes = [];
  for (let row = kr + 1; row <= sh.getLastRow(); row++) {
    for (let c = 1; c <= sh.getLastColumn(); c++) {
      const n = String(sh.getRange(row, c).getNote() || '').trim();
      if (n) notes.push(n);
    }
  }
  check('★★★★★ **橙色格真係有格註**'
    + '——一格橙色而冇備註，幹事唔知點解佢係橙色',
    notes.length >= 1, 'notes=' + notes.length);
  const blockNote = notes.filter(function (n) {
    return n.indexOf('你改的這一格違反了規則') !== -1;
  })[0];
  check('★★★★★★ 格註明講**系統冇動佢**'
    + '——唔講嘅話，佢會以為系統已經修好咗',
    !!blockNote && blockNote.indexOf('系統沒有動它') !== -1, String(blockNote));
  check('★★★★★ 而且講得出真正嘅原因（呢個 case 係連續兩週同一人）',
    !!blockNote && blockNote.indexOf('上一週同崗位已是此人') !== -1, String(blockNote));
  check('★★★★★ 亦都講埋「想系統一併調整可以點做」'
    + '——一句「系統冇動」而唔講點樣叫佢動，等於得一半',
    !!blockNote && blockNote.indexOf('勾選這一格') !== -1, String(blockNote));

  // ── 勾咗之後：系統先至動 ───────────────────────────────────
  //
  // ⚠️ 呢一段係整節嘅反證。冇佢嘅話，上面全部斷言用一句
  // 「系統乜都唔做」都會綠——而嗰個唔係我哋要嘅行為。
  const allowKey = (r.untouchedManual || [])[0] && (r.untouchedManual || [])[0].key;
  check('（前置）攞到嗰一格嘅 key', !!allowKey, String(allowKey));
  const r2 = gas.apiBuildSuggestion(Q, 'GRID', [allowKey]);
  check('★★★★ 再產生一次', r2.ok === true, JSON.stringify(r2).slice(0, 200));
  check('★★★★★★ **勾咗之後系統真係動咗嗰一格**'
    + '——唔動嘅話，個勾選框就係一個冇作用嘅裝飾',
    readGrid(r2.sheetName, DATES[3], 'CHAIR#1') !== prev,
    readGrid(r2.sheetName, DATES[3], 'CHAIR#1') + ' / ' + prev);
  const seen2 = countColours(r2.sheetName);
  check('★★★★★★ 而且嗰一格變成**紫色**（你改過，而系統又再改咗一次）',
    seen2.both >= 1 && seen2.manualViolation === 0, JSON.stringify(seen2));
  checkEqual('★★★★★ 第二次嘅數字一樣對得住表上實際上色',
    r2.colourCounts, seen2);

  const notes2 = [];
  const sh2 = ss.getSheetByName(r2.sheetName);
  const kr2b = keyRowOf(sh2);
  for (let row = kr2b + 1; row <= sh2.getLastRow(); row++) {
    for (let c = 1; c <= sh2.getLastColumn(); c++) {
      const n = String(sh2.getRange(row, c).getNote() || '').trim();
      if (n) notes2.push(n);
    }
  }
  const fixNote = notes2.filter(function (n) { return n.indexOf('系統改了這一格') !== -1; })[0];
  check('★★★★★ 系統改嗰格嘅格註講得出**真正嘅原因**'
    + '——呢個 case 係連續兩週同一人，所以要見到「上一週同崗位已是此人」；'
    + '淨係寫「建議改派 ○○」等於答緊「改成乜」，唔係「點解改」',
    !!fixNote && fixNote.indexOf('上一週同崗位已是此人') !== -1,
    JSON.stringify(notes2.slice(0, 3)));
  check('★★★★ 而且照樣講埋改成邊個（兩樣都要，唔係二選一）',
    !!fixNote && fixNote.indexOf('建議改派') !== -1
      && fixNote.indexOf('改成「試甲」') !== -1, String(fixNote));
}

console.log('\n=== C2：建議表都要有下拉選單 ===');
{
  const state = gas.apiGetSuggestionState(Q);
  const sh = ss.getSheetByName(state.sheetName);
  const dd = gas.applyNameDropdownsToSheet_(sh, state.sheetName, keyRowOf(sh));
  check('★★★★★ 建議表套得到選單（機器鍵行唔喺第 2 行，所以行號要傳入）',
    dd.columns.length >= 1, JSON.stringify(dd).slice(0, 300));
  check('★★★★★ 而且講員嗰欄唔會有選單（佢本來就係自由文字）',
    dd.skipped.some(function (s) { return s.postId === 'PREACH'; }),
    JSON.stringify(dd.skipped));
  check('★★★★★ `writeSuggestionSheet_()` 真係有叫佢'
    + '——唔叫嘅話幹事喺建議表上改就冇選單，而佢正正係要喺嗰張表改',
    /applyNameDropdownsToSheet_\(sheet, sheetName, headerRow \+ 1\)/
      .test(bare(read('src/SuggestionSheet.gs'))), '');
}

console.log('\n=== C3：欄闊同日期格式 ===');
{
  const w = bare(read('src/RosterWriter.gs'));
  check('★★★★★ 建議表用**同一個**設欄寬嘅函式（唔係另寫一份）',
    /applyGridColumnWidthsForA4_\(sheet, layout, dataStart\)/
      .test(bare(read('src/SuggestionSheet.gs'))), '');
  check('★★★★★ 人名欄唔換行（Ivan 兩次都講「要一行顯示得完」）',
    /setWrap\(false\)/.test(w), '');
  checkEqual('★★★★ 日期顯示格式係 MM-dd', gas.GRID_DATE_FORMAT, 'MM-dd');
  check('★★★★★ 而且**只改顯示格式，唔改儲存嘅值**'
    + '——格入面仍然係一個真日期值，全部讀回 grid 嘅路都靠佢比對',
    /setNumberFormat\(GRID_DATE_FORMAT\)/.test(w)
      && !/setValues\(\[\[GRID_DATE_FORMAT/.test(w), '');
}

// =====================================================================
console.log('\n=== B【核心】儲存之後即刻撳建議：唔可以整一張接受唔到嘅表 ===');
{
  gas.apiDiscardSuggestion(Q);
  // 先把 grid 同版本紀錄弄成一致（即係「啱啱儲存完」嗰個狀態）。
  const before = gas.apiCheckMyChanges(Q);
  check('（前置）而家仲有改動', before.changes.length > 0, String(before.changes.length));

  // 把改動還原返，模擬「儲存完之後 grid 同版本紀錄一致」。
  const orig = gas.readSheet(S.ROSTER_ASSIGNMENTS).filter(function (row) {
    return String(row[C.ROSTER_ASSIGNMENTS.QUARTER_ID] || '') === Q
      && Number(row[C.ROSTER_ASSIGNMENTS.VERSION_NO]) === V0
      && gas.toDateString(row[C.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ) === DATES[3]
      && row[C.ROSTER_ASSIGNMENTS.POST_ID] === 'CHAIR';
  })[0];
  setGrid(GRID, DATES[3], 'CHAIR#1',
    String(orig[C.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT] || ''));
  checkEqual('（前置）而家零改動', gas.apiCheckMyChanges(Q).changes.length, 0);

  const r = gas.apiBuildSuggestion(Q, 'GRID');
  checkEqual('★★★★★★ **唔會整一張建議表出嚟**'
    + '——整咗嘅話，幹事撳〔接受〕就會撞到一句寫俾開發者睇嘅'
    + '「materialiseManualEdits_() 沒有收到任何人手改動」',
    { ok: r.ok, nothingToDo: r.nothingToDo }, { ok: false, nothingToDo: true });
  check('★★★★★ 而且真係一張都冇整出嚟',
    gas.apiGetSuggestionState(Q).hasSuggestion === false, '');
  check('★★★★★ 訊息要講得出點解（唔可以淨係話「唔得」）',
    String(r.message || '').indexOf('沒有建立建議表') !== -1, r.message);
}

console.log('\n=== B：舊版本嘅建議表要清走 ===');
{
  // 造一張 v0 嘅建議表，然後建立一個新版本 ⇒ 舊嗰張要冇咗。
  setGrid(GRID, DATES[5], 'CHAIR#1', PEOPLE.P9805);
  const built = gas.apiBuildSuggestion(Q, 'GRID');
  check('（前置）有一張 v' + V0 + ' 嘅建議表', built.ok === true, JSON.stringify(built).slice(0, 200));

  // ⚠️ **唔可以用〔接受〕嚟造呢個 case**：接受嗰條路本身會叫
  // `discardSuggestionSheet_()` 清走當前版本嗰張，所以就算個掃走機制
  // 完全冇生效，最後都係一張都冇——一個假綠燈。
  //
  // 要造一張**真嘅過時建議表**，就要用一條「會建立新版本但唔會清建議表」
  // 嘅路。回退（`apiRollbackExecute`）就係其中一條。
  const accepted = gas.apiAcceptSuggestion(Q);
  check('（前置）先接受一次，整出 v1', accepted.ok === true,
    JSON.stringify(accepted).slice(0, 200));

  // 再喺 v1 上面整一張建議表——**呢一張先係之後會過時嗰張**。
  const v1 = gas.findLatestVersionNo(Q);
  check('（前置）而家係 v' + v1, v1 >= 1, String(v1));
  check('（前置）喺 v1 改一格',
    setGrid(gas.buildRosterSheetName_(Q, v1), DATES[4], 'CHAIR#1', PEOPLE.P9804));
  const built2 = gas.apiBuildSuggestion(Q, 'GRID');
  check('（前置）v1 有一張建議表', built2.ok === true,
    JSON.stringify(built2).slice(0, 200));

  const before = ss.getSheets().map(function (x) { return x.getName(); })
    .filter(function (n) { return /_建議$/.test(n); });
  check('（前置）而家真係有一張建議表', before.length === 1, before.join('、'));

  // ⚠️ 回退有一道閘：grid 上有未儲存改動就唔准回退。
  // 所以要先把嗰一格改返原樣（建議表本身唔受影響，佢係另一張表）。
  const back = gas.readSheet(S.ROSTER_ASSIGNMENTS).filter(function (row) {
    return String(row[C.ROSTER_ASSIGNMENTS.QUARTER_ID] || '') === Q
      && Number(row[C.ROSTER_ASSIGNMENTS.VERSION_NO]) === v1
      && gas.toDateString(row[C.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ) === DATES[4]
      && row[C.ROSTER_ASSIGNMENTS.POST_ID] === 'CHAIR';
  })[0];
  setGrid(gas.buildRosterSheetName_(Q, v1), DATES[4], 'CHAIR#1',
    String(back[C.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT] || ''));

  // 回退會建立一個新版本，而且**唔會**經過〔接受〕嗰條清理路——
  // 所以 v1 嗰張建議表就變成一張過時嘅表。
  const rolled = gas.apiRollbackExecute(Q, 0, '確認');
  check('（前置）回退成功，建立咗一個新版本',
    rolled && rolled.ok !== false, JSON.stringify(rolled).slice(0, 200));

  const names = ss.getSheets().map(function (s) { return s.getName(); });
  check('★★★★★★ 舊版本嗰張建議表冇咗'
    + '——留住嘅話，幹事開試算表見到兩張「建議」，分唔清邊張係最新，'
    + '而其中一張係由一個已經被取代嘅版本算出嚟',
    names.filter(function (n) { return /_建議$/.test(n); }).length === 0,
    names.join('、'));
  check('★★★★★ 而且掛喺 `createRosterSheet()`（五條建立版本嘅路唯一匯合點）',
    /discardStaleSuggestionSheets_\(quarterId, versionNo\)/
      .test(bare(read('src/RosterWriter.gs'))), '');
  check('★★★★★ 清嘅時候名字比對要嚴格'
    + '——寬鬆比對會連幹事自己開嘅「2028T1_建議名單」都刪埋',
    /\^\\d\+_建議\$/.test(read('src/SuggestionSheet.gs')), '');
}

// =====================================================================
console.log('\n=== D【核心】「⚠ 未能安排」嗰啲格要試住填 ===');
{
  const latest = gas.findLatestVersionNo(Q);
  const grid = gas.buildRosterSheetName_(Q, latest);
  // 人手清空兩格 ⇒ 造出「應該有人而冇人」。
  check('（前置）清空一格', setGrid(grid, DATES[6], 'READ#1', ''));
  check('（前置）再清空一格', setGrid(grid, DATES[7], 'READ#1', ''));

  const chk = gas.apiCheckMyChanges(Q);
  check('★★★★★ 〔檢查我的改動〕數得到嗰兩格空格',
    chk.blanks.length >= 2, JSON.stringify(chk.blanks));
  check('★★★★★ 而且**講員嗰欄唔會算入去**（佢本來就係人手填）',
    chk.blanks.every(function (b) { return b.postNameTC !== '講員'; }),
    JSON.stringify(chk.blanks));

  const r = gas.apiBuildSuggestion(Q, 'GRID');
  check('★★★★ 產生到建議表', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ **系統真係幫嗰幾格填咗人**'
    + '——Ivan：「點解唔安排嗰啲『⚠ 未能安排』？佢應該做得到。」',
    readGrid(r.sheetName, DATES[6], 'READ#1') !== ''
      && readGrid(r.sheetName, DATES[7], 'READ#1') !== '',
    JSON.stringify([readGrid(r.sheetName, DATES[6], 'READ#1'),
      readGrid(r.sheetName, DATES[7], 'READ#1')]));

  const sh = ss.getSheetByName(r.sheetName);
  const note = sh.getRange(rowOf(sh, DATES[6]), colOf(sh, 'READ#1')).getNote();
  check('★★★★★★ 而且嗰格有備註，講明「本來排不出，系統建議派某某」'
    + '——冇備註嘅話，幹事見到一個名突然出現，唔知邊度嚟',
    note.indexOf('本來排不出') !== -1 && note.indexOf('系統建議派') !== -1, note);

  check('★★★★★ 講員嗰欄**一格都冇被自動派人**'
    + '（派落去係製造一個錯，唔係修一個錯）',
    readGrid(r.sheetName, DATES[6], 'PREACH#1').indexOf('試') === -1,
    readGrid(r.sheetName, DATES[6], 'PREACH#1'));
}

console.log('\n=== D：填唔到嗰啲要逐格講，而且講原因 ===');
{
  const src = bare(read('src/SuggestionSheet.gs'));
  check('★★★★★ 填唔到會收入 `unfillable`，唔係靜靜略過',
    /unfillable\.push\(\{/.test(src), '');
  check('★★★★★ 而且帶住原因（`findReplacementPerson_()` 本來就分得出三種）',
    /reason: found\.reason \|\|/.test(src), '');
  check('★★★★★ 畫面真係逐格印出嚟',
    /r\.unfillable && r\.unfillable\.length > 0/.test(bare(read('src/ui/ScriptSuggestion.html'))), '');
  check('★★★★★ 有上限，而且**上限一定要講出嚟**'
    + '——靜靜做一半，幹事會以為淨返嗰啲係系統睇過搞唔掂，'
    + '而其實係系統根本冇睇過',
    /GAP_FILL_MAX_CELLS/.test(src)
      && /r\.gapCapped/.test(bare(read('src/ui/ScriptSuggestion.html'))), '');
  check('★★★★★ 「本來就應該留白」嗰三種一格都唔會掂',
    /RULE_IDS\.NO_AUTO_GENERATE/.test(bare(read('src/FineTune.gs')))
      && /STRUCTURAL_NA_RULE_IDS/.test(bare(read('src/FineTune.gs')))
      && /SPECIAL_SKIP_RULE_IDS/.test(bare(read('src/FineTune.gs'))), '');
}

console.log('\n=== D／G：「空格」只有一個定義 ===');
{
  // ⚠️ 三個地方要用同一份：〔檢查我的改動〕、〔請系統幫我調整〕、
  // 儲存前嘅提醒。各寫一次嘅話，三個數字會慢慢唔一樣。
  const users = ['src/SuggestionSheet.gs', 'src/WebAppSaveConfirm.gs'];
  users.forEach(function (f) {
    check('★★★★★ ' + f + ' 用共用嗰個 `listGenuineBlankCells_()`',
      /listGenuineBlankCells_\(/.test(bare(read(f))), '');
  });
  check('★★★★★ 而且定義本身只有一份（喺 FineTune.gs）',
    /function listGenuineBlankCells_/.test(read('src/FineTune.gs'))
      && !/function listGenuineBlankCells_/.test(read('src/SuggestionSheet.gs')), '');
}

// =====================================================================
console.log('\n=== A【核心】同一時間只可以有一個會改動資料嘅動作 ===');
{
  const src = bare(read('src/MutationLock.gs'));
  check('★★★★★ 用 `tryLock(0)`——**唔等**',
    /const MUTATION_LOCK_WAIT_MS = 0;/.test(src), '');
  check('★★★★★ 攞唔到就即刻拋一個講得明白嘅訊息'
    + '——等三十秒然後照做一次，等於佢撳兩次就真係做兩次',
    /另一個動作還在做緊/.test(read('src/MutationLock.gs')), '');
  check('★★★★★ 攞鎖本身出錯**唔可以當成攞到**',
    /} catch \(err\) \{[\s\S]{0,400}系統拿不到/.test(read('src/MutationLock.gs')), '');
  check('★★★★★ 放鎖失敗唔可以蓋過原本嘅結果（或者原本嗰個錯）',
    /log_\('WARN', 'withMutationLock_ 放鎖失敗/.test(read('src/MutationLock.gs')), '');

  // 真係擋得住：把鎖換成「永遠攞唔到」，然後由真入口叫。
  const realLock = gas.LockService;
  gas.LockService = {
    getDocumentLock: function () {
      return { tryLock: function () { return false; }, releaseLock: function () {} };
    }
  };
  let threw = '';
  try { gas.apiGenerateDraftExecute(Q); } catch (e) { threw = e.message; }
  gas.LockService = realLock;
  check('★★★★★★ **攞唔到鎖嗰陣，真入口真係唔會做嘢**',
    threw.indexOf('另一個動作還在做緊') !== -1, threw.slice(0, 200));
}

console.log('\n=== A：全部長時間會寫入嘅入口都包咗 ===');
{
  const targets = [
    ['src/WebAppGenerate.gs', 'apiGenerateDraftExecute'],
    ['src/WebAppSaveConfirm.gs', 'apiSaveAndConfirmExecute'],
    ['src/EligibilitySheetEditor.gs', 'apiApplyEligibilitySheet'],
    ['src/PaperPack.gs', 'apiGeneratePaperPack'],
    ['src/PaperPack.gs', 'apiGeneratePlainPaper'],
    ['src/WebAppRollback.gs', 'apiRollbackExecute'],
    ['src/SuggestionSheet.gs', 'apiBuildSuggestion'],
    ['src/SuggestionSheet.gs', 'apiAcceptSuggestion']
  ];
  targets.forEach(function (t) {
    const src = read(t[0]);
    check('★★★★★ ' + t[1] + ' 包咗互斥鎖',
      new RegExp('function ' + t[1] + '\\([^)]*\\) \\{[\\s\\S]{0,300}withMutationLock_')
        .test(src), '');
  });
}

console.log('\n=== A：畫面嗰一層 ===');
{
  const common = read('src/ui/Script.html');
  const style = read('src/ui/Style.html');
  check('★★★★★ 鎖係一個 body class ＋ CSS，**唔怕重畫**'
    + '——逐粒掣設 `disabled` 嘅話，動作期間重畫一次鎖就自己冇咗，'
    + '而嗰個正正就係 Ivan 講嘅「畫面好似重新整理咗，我可以自由撳」',
    /document\.body\.classList\.toggle\('is-busy'/.test(common)
      && /body\.is-busy > \*:not\(\.busy-overlay\) \{ pointer-events: none; \}/.test(style), '');
  check('★★★★★ 而且連 `select`／`input` 都鎖（頂部嗰個季度下拉係一個 `select`）',
    /querySelectorAll\('button, select, input, textarea'\)/.test(common), '');
  check('★★★★★ 重畫完會**重新鎖一次**新造出嚟嗰批節點',
    /reapplyBusyLockIfNeeded_\(\);/.test(common)
      && /function reapplyBusyLockIfNeeded_/.test(common), '');
  check('★★★★★ 而且 `loadDashboard()` 收尾真係有叫佢',
    /renderZone4\(dashboardState_\);[\s\S]{0,600}reapplyBusyLockIfNeeded_\(\);/.test(common), '');
}

// =====================================================================
console.log('\n=== E／F：收件人選擇同自行輸入電郵 ===');
{
  const sendPlan = bare(read('src/WebAppSendPlan.gs'));
  const paper = bare(read('src/ui/ScriptSendPaper.html'));
  const common = bare(read('src/ui/Script.html'));
  const opts = bare(read('src/SendOptions.gs'));

  check('★★★★★ 收件名單同紙本用**同一個共用元件**',
    (paper.match(/pickListNodes\(\{/g) || []).length >= 2, '');
  // ⚠️ 第四十六輪批次 A 組：收件人池搬咗去 `src/SendRecipients.gs`，
  // 而且同階段無關。守嘅嘢一個字都冇變——身分一定要由 `Roles` 讀。
  const sendRecipients = bare(read('src/SendRecipients.gs'));
  check('★★★★★ 身分由 `Roles` 讀（連生效期），**唔係喺畫面寫死一份名單**'
    + '——寫死嗰份下一屆就錯，而且冇人會記得去改',
    /readRolesSafe_\(timezone\)/.test(sendRecipients)
      && /isEffectiveOn_\(r\.effectiveFrom, r\.effectiveTo, today\)/.test(sendRecipients), '');
  check('★★★★★ 群組勾選係「加入」唔係「取代」'
    + '（Ivan 明確要求「全部堂委 ＋ 另外三個人」呢種用法）',
    /sendPoolMembersOf\(g\.key\)\.forEach\(\(c\) => \{ selected\[c\.key\] = cb\.checked; \}\)/
      .test(paper), '');
  // ⚠️ 第四十六輪批次 A1 組：一組零人嗰陣要講嘅嘢改咗——
  // 而家有四個身分（堂委／執事／IT／幹事），而 `IT` 同 `幹事` 係新加嘅，
  // 好可能一個人都未填。所以逐組講，唔再淨係講「堂委或執事」。
  check('★★★★★ 一組零人嗰陣要講點解同去邊度加'
    + '——靜靜出一個勾唔到嘅框，幹事只會以為系統壞咗',
    /現時沒有人有這個身分。要用這一組，先去「名單維護 ▸ 身分」/.test(paper), '');

  check('★★★★★★ 自行輸入嗰格同六個來源喺**同一版**'
    + '——收埋去另一個窗嘅話，幹事勾咗「職事表上全部人」就永遠見唔到，'
    + '而佢想做嘅好可能正正就係「全部人 ＋ 多一個地址」',
    (paper.match(/buildExtraEmailBox\(sendOptions_/g) || []).length >= 2, '');
  check('★★★★★ 而且主確認掣撳落去之前會驗一次格式',
    /if \(!commitExtraEmails\(sendOptions_\)\) return;/.test(paper), '');
  check('★★★★★ 自行輸入嘅電郵格式唔啱**即刻標紅**，唔係等撳落去先講',
    /input\.classList\.toggle\('bad-input'/.test(common), '');
  check('★★★★★ 後端一樣要驗，而且格式唔啱要**拋錯**唔可以靜靜略過',
    /badEmails\.push\(e\)/.test(opts) && /看起來不是電郵/.test(read('src/SendOptions.gs')), '');
  check('★★★★★ 呢啲地址係 `LIST` 唔係 `PERSON`'
    + '——當成 PERSON 嘅話，下游會去查佢「呢一季有邊幾格」而查唔到，'
    + '然後逐個地方各自處理一次空值',
    /type: RECIPIENT_TYPE\.LIST,/.test(
      opts.slice(opts.indexOf('function appendExtraEmailRecipients_'))), '');
  check('★★★★★ 已經喺名單入面嘅唔會加多次（否則佢會收到兩封）',
    /if \(seen\[key\]\) return;/.test(
      opts.slice(opts.indexOf('function appendExtraEmailRecipients_'))), '');
  check('★★★★★ 紙本嗰邊：**仍然完全唔會讀任何收件人名單**'
    + '——嗰個「結構上不可能寄俾義工」嘅保證冇鬆開',
    !/readPeople\(\)|EMAIL_RECIPIENTS/.test(
      bare(read('src/PaperPack.gs')).slice(
        bare(read('src/PaperPack.gs')).indexOf('function apiEmailPaperPackToSelf'))), '');
}

// =====================================================================
console.log('\n=== G：儲存之前要提醒「仲有 N 格冇人」===');
{
  const zone1 = bare(read('src/ui/ScriptZone1.html'));
  const save = bare(read('src/WebAppSaveConfirm.gs'));
  check('★★★★★ 後端算得出 `blankCells`', /blankCells: blankCells,/.test(save), '');
  check('★★★★★ 有空格就**唔可以行快路**（快路唔彈窗，即係佢完全冇被提醒過）',
    /&& \(plan\.blankCells \|\| \[\]\)\.length === 0;/.test(zone1), '');
  check('★★★★★ 冇空格嘅時候**唔會出呢一段**（每次都出就等於冇出過）',
    /if \(plan\.blankCells && plan\.blankCells\.length > 0\) \{/.test(zone1), '');
  check('★★★★★ 而且加咗一粒直接接落〔請系統幫我調整〕',
    /extraActions: buildFixItActions\(plan\)/.test(zone1)
      && /openBuildSuggestion\(\);/.test(zone1), '');
  check('★★★★★ 但**冇嘢可以調整嗰陣唔會出嗰粒掣**'
    + '——一粒撳咗只會話「冇嘢要調整」嘅掣，就係一粒冇用嘅掣',
    /if \(!hasBlank && !hasViolation\) return \[\];/.test(zone1), '');
}

console.log('\n=== H：版面 ===');
{
  const index = read('src/ui/Index.html');
  const flow = bare(read('src/ui/ScriptMainFlow.html'));
  const zone2 = bare(read('src/ui/ScriptZone2.html'));
  check('★★★★★ 「開季前準備」排喺主流程**之上**',
    index.indexOf('id="zone2"') < index.indexOf('id="mainFlow"'), '');
  check('★★★★★ 而且預設展開', /aria-expanded="true"/.test(index), '');
  check('★★★★★ 改名單嗰一步搬咗入去做第 0 步',
    /body\.appendChild\(renderStepEligibility\(\)\)/.test(zone2), '');
  check('★★★★★ 而且係**同一個函式**，唔係喺 zone2 另寫一份',
    !/function renderStepEligibility/.test(zone2), '');
  // ⚠️ 第四十四輪批次 F 組：**呢一條斷言唔夠。**
  //
  // 佢綠燈，而 Ivan 實測話「冇問過」——而佢係啱嘅。呢條證明嘅只係
  //「檔案入面有呢個名」，唔係「每一條去生成嘅路都會經過佢」。
  // 當時實際上有三條路，只有一條包咗。
  //
  // 真正嘅斷言喺 `tests/generate_asks_eligibility.test.js`：
  // 嗰度真係行嗰幾個函式，逐條路睇彈窗有冇喺讀資料之前出現。
  // 呢一條保留住做「第四十三輪做過呢件事」嘅紀錄，唔可以當佢係保證。
  check('★★★★ 生成之前會問「使唔使先改名單」，而且〔先去改名單〕真係帶佢去'
    + '（⚠️ 只證明有呢個名；真正嘅保證喺 generate_asks_eligibility.test.js）',
    /askEligibilityFirst/.test(flow) && /openEligibilitySheet\(\);/.test(flow), '');
  check('★★★★★ 第 2 步有〔回到上一個儲存版本〕，而且走返同一條回退路',
    /openRollbackToPrevious/.test(flow)
      && /apiRollbackPlan/.test(bare(read('src/ui/ScriptRollback.html'))), '');
  check('★★★★★ 撳之前要講明「未儲存嘅改動會唔見咗」'
    + '——回退會重寫 grid 工作表，佢改咗而未儲存嗰幾格會被蓋走',
    /還未儲存的東西，會不見了/.test(read('src/ui/ScriptRollback.html')), '');
  check('★★★★★ 一粒撳唔到而又冇解釋嘅掣，唔准存在',
    /} else if \(opts\.disabled\) \{[\s\S]{0,200}b\.title =/.test(flow), '');
}

// =====================================================================
console.log('\n=== I：MAIL_REDIRECT_ALL_TO 現況 ===');
{
  check('★★★★★ 1. Config key 有', /MAIL_REDIRECT_ALL_TO: 'MAIL_REDIRECT_ALL_TO'/
    .test(read('src/Constants.gs')), '');
  check('★★★★★ 2. `ConfigSeed.gs` 有對應嗰一行'
    + '——第三十三輪嘅教訓：CONFIG_KEYS 有而 seed 冇，補建功能就永遠建唔出佢',
    /key: CONFIG_KEYS\.MAIL_REDIRECT_ALL_TO/.test(read('src/ConfigSeed.gs')), '');
  check('★★★★★ 3. 真正寄出用嘅係轉寄之後嗰個地址',
    /MailApp\.sendEmail\(redirected\.toEmail,/.test(read('src/Mailer.gs')), '');
  check('★★★★★ 4. 主旨加咗 `[原收件人：XXX]`',
    /'\[原收件人：' \+ who \+ '\] ' \+ plan\.subject/.test(read('src/MailRedirect.gs')), '');
  check('★★★★★ 5. 內文頂有橫幅（HTML 同純文字兩邊都有）',
    /bodyHtml: buildRedirectBannerHtml_\(banner\)/.test(read('src/MailRedirect.gs'))
      && /bodyPlain: banner \+/.test(read('src/MailRedirect.gs')), '');
  check('★★★★★ 6. 介面頂部有標籤',
    /id="mailRedirectBadge"/.test(read('src/ui/Index.html'))
      && /mailRedirectBadge: buildMailRedirectBadgeText_\(\)/
        .test(read('src/WebAppDashboard.gs')), '');
  check('★★★★★ 7. SendLog 同時記低原收件人同實際收件人',
    /INTENDED_EMAIL: 'IntendedEmail'/.test(read('src/Constants.gs'))
      && /record\[C\.DELIVERED_TO\] = /.test(read('src/Mailer.gs')), '');
  check('★★★★★★ 8. 全面體檢入面係**紅色（必須處理）**，唔係黃色'
    + '——留住一個轉寄地址上線，系統會報告「已寄出 51 封」而全體義工'
    + '一封都收唔到；「睇落完全成功而實際上全錯」正正要用紅色擋',
    /HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS = \[[\s\S]{0,600}'MAIL_REDIRECT_ALL_TO'/
      .test(read('src/FullHealthCheck.gs')), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
