// 第四十一輪批次 B 組：〔檢查我的改動〕＋〔請系統幫我調整〕。
// FIXTURE-OK: 呢一份全部係喺斷言度**讀返**已經寫入嘅長表欄位
//（`row[A.ASSIGN_SOURCE]` 呢類），唔係手砌。
// 真正嘅資料一律由真入口產生：`apiGenerateDraftExecute()` ＋ 喺 grid 打字。
// 執行方式：node tests/suggestion_sheet.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 講「一個好重要嘅缺失功能」：改完之後要有得檢查、有得叫系統幫手調整，
// 而且要喺一張新工作表睇建議版本、兩種顏色分開「我改嘅」同「系統改嘅」。
//
// ⚠️ 呢一組**唔係由零做**。系統本來就有 `proposeMinimalFix()` 同
// `analyseManualState_()`。呢一組係把佢哋接上主流程。
//
// 所以呢一份守嘅係三件事：
//   一、〔檢查〕真係唯讀——**一格都唔可以寫**
//   二、〔調整〕唔會碰 `RosterAssignments`——建議表係一張獨立工作表
//   三、〔接受〕行嘅係 `materialiseManualEdits_()`（已經修好過嗰條路），
//   　　唔係第六條新嘅建立版本路
//
// ⚠️ 全部 fixture 由真入口產生（第三十八輪 B 組）。

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
  // indexPeopleById_ 喺 Mailer.gs（buildFineTuneContext_ 會用）。
  'Mailer.gs',
  'SuggestionSheet.gs'
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
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

/** 模擬幹事喺 grid 打字——外部輸入，手砌係正路。 */
function setGrid(sheetName, date, post, text) {
  const sh = ss.getSheetByName(sheetName);
  // ⚠️ 建議表上面有一段圖例，所以機器鍵嗰一行唔一定係第 2 行。
  // 同 readGridTextFromSheet_() 一樣，用掃描——寫死行號就會靜靜寫錯位。
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
    if (gas.toDateString(sh.getRange(r, 1).getValue(), TZ) !== date) continue;
    sh.getRange(r, col).setValue(text);
    return true;
  }
  return false;
}

function snapshotAssignments() {
  return JSON.stringify(gas.readSheet(S.ROSTER_ASSIGNMENTS));
}

// =====================================================================
console.log('\n=== 前置：生成初稿 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
const V0 = gas.findLatestVersionNo(Q);
const GRID0 = gas.buildRosterSheetName_(Q, V0);

// =====================================================================
console.log('\n=== B1【核心】〔檢查我的改動〕係唯讀 ===');
{
  const before = snapshotAssignments();
  const sheetsBefore = ss.getSheets ? ss.getSheets().length : 0;

  const r = gas.apiCheckMyChanges(Q);
  check('★★★★ 答得出嘢', r.ok === true, JSON.stringify(r).slice(0, 200));
  checkEqual('★★★★★ 冇改過 ⇒ 一格改動都冇，而且講得出「可以儲存」',
    { changes: r.changes.length, allClear: r.allClear }, { changes: 0, allClear: true });

  checkEqual('★★★★★ `RosterAssignments` 一個字都冇變'
    + '——呢粒掣喺畫面上寫住「只看，不會改動任何東西」，'
    + '講咗就一定要做到',
    snapshotAssignments(), before);
}

console.log('\n=== B1：改一格之後，檢查要逐格講得出「由邊個改成邊個」 ===');
{
  const beforeName = PEOPLE[gas.readSheet(S.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[A.QUARTER_ID] === Q && Number(row[A.VERSION_NO]) === V0
      && gas.toDateString(row[A.SERVICE_DATE], TZ) === DATES[2] && row[A.POST_ID] === 'CHAIR';
  })[0][A.PERSON_ID]];
  const target = Object.keys(PEOPLE).find(function (id) { return PEOPLE[id] !== beforeName; });

  check('（前置）幹事改咗一格', setGrid(GRID0, DATES[2], 'CHAIR', PEOPLE[target]));

  const before = snapshotAssignments();
  const r = gas.apiCheckMyChanges(Q);
  checkEqual('★★★★★ 認到一格改動', r.changes.length, 1);
  checkEqual('★★★★★ 而且講得出由邊個改成邊個'
    + '（只講「改咗 1 格」證明唔到系統睇到嘅就係佢改嗰格）',
    { from: r.changes[0].fromName, to: r.changes[0].toName },
    { from: beforeName, to: PEOPLE[target] });
  check('★★★★ 崗位寫中文名，唔係 PostID',
    r.changes[0].postNameTC === '主席', r.changes[0].postNameTC);
  checkEqual('★★★★★ 檢查完之後 `RosterAssignments` 仍然一個字都冇變',
    snapshotAssignments(), before);
}

console.log('\n=== B1：認唔出嘅名字要列出嚟 ===');
{
  check('（前置）打一個唔喺名單上嘅名', setGrid(GRID0, DATES[3], 'READ', '唔存在嘅人'));
  const r = gas.apiCheckMyChanges(Q);
  checkEqual('★★★★★ 認唔出嗰個有列出嚟', r.unresolved.length, 1);
  check('★★★★ 而且講得出佢打咗咩',
    r.unresolved[0].text === '唔存在嘅人', JSON.stringify(r.unresolved[0]));
  checkEqual('★★★★★ 而且 `allClear` 一定要係 false'
    + '——有認唔出嘅名而話「可以儲存」，係一個講錯咗嘅結論',
    r.allClear, false);

  // 清返佢，落面幾節先跑得
  check('（收尾）清返嗰格', setGrid(GRID0, DATES[3], 'READ', ''));
}

console.log('\n=== B2【核心】建議表都要擋認唔出嘅名字 ===');
{
  // ⚠️ 理由同儲存嗰條路一模一樣（見 UnresolvedNameFix.gs）：
  // 一個冇 PersonID 嘅名，嗰一格對嗰個人完全冇作用。
  // 喺呢度放行，就等於俾佢經由建議表嗰條路溜入正式版本——
  // 而幹事會以為「系統調整過 ⇒ 一定冇問題」。
  const latest = gas.findLatestVersionNo(Q);
  const gridNow = gas.buildRosterSheetName_(Q, latest);
  check('（前置）喺正式表打一個唔喺名單上嘅名',
    setGrid(gridNow, DATES[5], 'CHAIR', '又一個唔存在嘅人'));

  const before = snapshotAssignments();
  const r = gas.apiBuildSuggestion(Q);
  checkEqual('★★★★★ 拒絕產生建議表', r.ok, false);
  check('★★★★★ 而且逐個列出認唔出嗰幾個',
    (r.unresolved || []).length === 1, JSON.stringify(r.unresolved));
  check('★★★★ 訊息明確講「乜都冇改動，亦都冇建立建議表」',
    String(r.message || '').indexOf('沒有建立建議表') !== -1, r.message);
  checkEqual('★★★★★ `RosterAssignments` 一個字都冇變',
    snapshotAssignments(), before);
  check('★★★★★ 而且真係冇整咗一張建議表出嚟',
    gas.apiGetSuggestionState(Q).hasSuggestion === false, '');

  check('（收尾）清返嗰格', setGrid(gridNow, DATES[5], 'CHAIR', ''));
}
// =====================================================================
console.log('\n=== B2【核心】〔請系統幫我調整〕唔會碰 RosterAssignments ===');
{
  const before = snapshotAssignments();
  const r = gas.apiBuildSuggestion(Q);
  check('★★★★ 產生到建議表', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('★★★★★ 建議表係一張獨立工作表，名有「_建議」',
    r.sheetName.indexOf('_建議') !== -1, r.sheetName);
  check('★★★★★ 而且真係存在', !!ss.getSheetByName(r.sheetName), r.sheetName);

  checkEqual('★★★★★ **`RosterAssignments` 一個字都冇變**'
    + '——建議表只係一張俾佢睇嘅嘢，撳「接受」之前正式資料唔可以動',
    snapshotAssignments(), before);

  // ⚠️ 上面清返嗰格「唔存在嘅人」都算一個改動（由有字變成空白）——
  // 嗰個係啱嘅，清空一格本來就係一個改動。
  check('★★★★ 幹事改過嗰啲格算入「你改嘅」', r.manualCount >= 1, 'manualCount=' + r.manualCount);
}

console.log('\n=== B2：建議表要有圖例，兩種顏色嘅意思要印出嚟 ===');
{
  const state = gas.apiGetSuggestionState(Q);
  check('★★★★★ 主流程查得到「而家有一張未處理嘅建議表」'
    + '——唔講嘅話，幹事會喺正式表上改，然後發現改動唔見咗',
    state.hasSuggestion === true, JSON.stringify(state));

  const sh = ss.getSheetByName(state.sheetName);
  const top = sh.getRange(1, 1, 4, 2).getValues();
  const flat = top.map(function (row) { return row.join(' '); }).join('\n');
  check('★★★★★ 表頂講明「呢個係建議版本，唔係正式版本」',
    flat.indexOf('建議版本') !== -1 && flat.indexOf('不會影響正式職事表') !== -1, flat);
  check('★★★★★ 而且兩種顏色嘅意思都印咗出嚟（唔可以要人自己猜）',
    flat.indexOf('黃色格') !== -1 && flat.indexOf('藍色格') !== -1, flat);
  check('★★★★ 亦都講埋「改完可以再撳一次調整」（Ivan 要求嘅重複流程）',
    flat.indexOf('再撳一次') !== -1, flat);
}

console.log('\n=== B2：喺建議表上再改，下一次調整要以佢做起點 ===');
{
  // ⚠️ 呢個係 Ivan 明確要求嘅：「幹事亦都可以直接喺嗰張建議版本上再改，
  // 然後再撳『調整』，重複到滿意為止。」
  const state = gas.apiGetSuggestionState(Q);
  const target = Object.keys(PEOPLE)[3];
  check('（前置）喺建議表上再改一格', setGrid(state.sheetName, DATES[4], 'READ', PEOPLE[target]));

  const r = gas.apiBuildSuggestion(Q);
  check('★★★★★ 第二次調整仍然成功', r.ok === true, JSON.stringify(r).slice(0, 200));
  check('★★★★★ 而且認到建議表上嗰個新改動'
    + '（認唔到就代表佢以正式表做起點，幹事喺建議表上改嗰啲會靜靜消失）',
    r.manualCount >= 2, 'manualCount=' + r.manualCount);
}

// =====================================================================
console.log('\n=== B3【核心】〔接受〕行嘅係已經修好過嗰條路 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'SuggestionSheet.gs'), 'utf8');
  const body = src.slice(src.indexOf('function apiAcceptSuggestion'));
  check('★★★★★ 接受用 `materialiseManualEdits_()`'
    + '——即係「儲存我的修改」嗰條已經喺真實環境跑過、'
    + '而且第三十六／三十七輪逐個欄位修好過嘅路',
    /materialiseManualEdits_\(/.test(body.slice(0, 2500)), body.slice(0, 400));
  check('★★★★★ **冇另寫一套建立版本嘅邏輯**'
    + '——另寫就變成第六條路，而前面五條每一條都出過同一類 bug',
    !/writeAssignments\(/.test(body.slice(0, 2500))
    && !/createRosterSheet\(/.test(body.slice(0, 2500)), body.slice(0, 600));
}

console.log('\n=== B3：接受之後，建議表要清走 ===');
{
  const before = gas.findLatestVersionNo(Q);
  const r = gas.apiAcceptSuggestion(Q);
  check('★★★★ 接受成功', r.ok === true, JSON.stringify(r).slice(0, 200));
  checkEqual('★★★★★ 真係建立咗新一版', gas.findLatestVersionNo(Q), before + 1);

  const oldName = gas.buildRosterSheetName_(Q, before) + '_建議';
  check('★★★★★ 建議表已經清走'
    + '——唔清走會積落一堆「_建議」，下一次幹事分唔清邊張係最新',
    !ss.getSheetByName(oldName), oldName);
  checkEqual('★★★★ 而且 `apiGetSuggestionState()` 亦都話冇',
    gas.apiGetSuggestionState(Q).hasSuggestion, false);
}

console.log('\n=== B3：接受之後，冇改動嘅格四個欄位要逐字搬過去 ===');
{
  // ⚠️ 呢個係第三十六輪嗰條共用斷言嘅精神：`applyDecisions()` 嗰條路
  // 第三十七輪查出兩個 bug（`personName`／`ruleFlags` 都會遺失），
  // 而第三十八輪修完**只有靜態驗證**。而家佢會俾真人用到，所以一定要驗。
  const v = gas.findLatestVersionNo(Q);
  const rows = function (ver) {
    const out = {};
    gas.readSheet(S.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (row[A.QUARTER_ID] !== Q || Number(row[A.VERSION_NO]) !== ver) return;
      out[gas.toDateString(row[A.SERVICE_DATE], TZ) + '|' + row[A.POST_ID]] = {
        personId: String(row[A.PERSON_ID] || ''),
        personName: String(row[A.PERSON_NAME_SNAPSHOT] || ''),
        assignSource: String(row[A.ASSIGN_SOURCE] || ''),
        ruleFlags: gas.splitList_(row[A.RULE_FLAGS]).slice().sort().join(',')
      };
    });
    return out;
  };
  const prev = rows(v - 1);
  const now = rows(v);

  const drifted = [];
  Object.keys(prev).forEach(function (k) {
    if (!now[k]) { drifted.push(k + '　整格唔見咗'); return; }
    // 幹事／系統改過嗰幾格本來就會唔同，所以只比「人冇變」嗰啲。
    if (prev[k].personId !== now[k].personId) return;
    ['personName', 'assignSource', 'ruleFlags'].forEach(function (f) {
      if (prev[k][f] !== now[k][f]) {
        drifted.push(k + '　' + f + '：「' + prev[k][f] + '」→「' + now[k][f] + '」');
      }
    });
  });
  checkEqual('★★★★★ 冇換人嘅格，`personName`／`assignSource`／`ruleFlags` 逐字相同'
    + '——呢三欄係第三十四至三十八輪連續五輪出事嗰三欄',
    drifted, []);
}

console.log('\n=== B：放棄 ===');
{
  // ⚠️ 第四十三輪批次 B 組：**啱啱接受完，grid 同版本紀錄一模一樣**，
  // 而嗰種情況系統唔會再建立建議表（建立咗接受唔到，見 apiBuildSuggestion）。
  // 所以要先真係改一格，先至有嘢可以建議。
  const latestNow = gas.findLatestVersionNo(Q);
  const gridNow2 = gas.buildRosterSheetName_(Q, latestNow);
  const someone = PEOPLE[Object.keys(PEOPLE)[1]];
  check('（前置）先喺正式表改一格', setGrid(gridNow2, DATES[6], 'CHAIR', someone));

  const built = gas.apiBuildSuggestion(Q);
  check('（前置）再產生一張建議表', built.ok === true, JSON.stringify(built).slice(0, 200));
  const before = snapshotAssignments();
  const versionBefore = gas.findLatestVersionNo(Q);

  const r = gas.apiDiscardSuggestion(Q);
  check('★★★★ 放棄成功', r.ok === true && r.removed === true, JSON.stringify(r));
  checkEqual('★★★★★ `RosterAssignments` 一個字都冇變', snapshotAssignments(), before);
  checkEqual('★★★★★ 亦都冇建立新版本', gas.findLatestVersionNo(Q), versionBefore);
  checkEqual('★★★★ 建議表冇咗', gas.apiGetSuggestionState(Q).hasSuggestion, false);

  const again = gas.apiDiscardSuggestion(Q);
  check('★★★★ 再放棄一次唔會拋錯（可能佢撳咗兩次）',
    again.ok === true && again.removed === false, JSON.stringify(again));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
