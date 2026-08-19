// 第三十三輪批次階段 F1：由 `apiSaveAndConfirmPlan/Execute` 真入口叫落去，
// 而且**用一張真正嘅 grid 工作表**（有人手改動）。
// 執行方式：node tests/save_confirm_real_grid_entry.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// 第三十二輪嘅 e2e 步驟 3 用咗 `apiStep3Plan/Apply/Release/Decline`
//（`WebAppFlow.gs`），但**幹事喺 Web UI 實際撳嗰粒係
// `apiSaveAndConfirmPlan` / `apiSaveAndConfirmExecute`**（`WebAppSaveConfirm.gs`）。
//
// 當時略過嘅理由係：「佢把表上人手改動同 Requests 申報夾埋處理，
// 要讀真正嘅 grid 工作表」——即係要 stub `buildFineTuneContext_()`／
// `resolveAuthoritativeState_()`，而嗰兩個正正就係「人手改動偵測」嘅心臟。
// Stub 咗佢哋就等於冇測到幹事真正撳嗰條路。
//
// 呢一輪正面處理：**唔 stub 佢哋**，改為用
// `tests/helpers/mock_sheets_realistic.js` 建一張真正嘅 grid 工作表
//（由**真正嘅 `createRosterSheet()`** 寫出嚟，唔係測試自己砌），
// 然後喺上面改一格，再由真入口叫落去。
//
// 所以呢份測試真正行過嘅路係：
//   apiSaveAndConfirmPlan
//     → buildSaveAndConfirmPlan_
//       → buildFineTuneContext_   ← 真正讀 grid 工作表（冇 stub）
//         → readGridPersonIds_    ← 真正逐格讀
//       → resolveAuthoritativeState_（GRID_OVERLAY 模式，冇 stub）
//   apiSaveAndConfirmExecute
//     → materialiseManualEdits_   ← 真正寫新版本

const { loadGasSource } = require('./helpers/gas_loader');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs', 'Debug.gs', 'Tune.gs',
  'Verify.gs', 'SoftRuleMetrics.gs', 'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs'
]);

const Q = '2027T2';
const TZ = 'Pacific/Auckland';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'f1-test@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    if (fmt === 'yyyy-MM-dd HH:mm:ss') {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
      const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(date);
      return d + ' ' + t;
    }
    if (fmt === 'M/d' || fmt === 'MM/dd') {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date).split('-');
      return Number(p[1]) + '/' + Number(p[2]);
    }
    return date.toISOString();
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

// ⚠️ **`createRosterSheet()` 冇 stub** ——呢份測試嘅重點就係要有一張
// 由正式碼寫出嚟嘅真 grid 工作表。呢個係同 e2e_five_stage_flow.test.js
// 最大嘅分別（嗰邊「邊界一」把佢 stub 走咗）。
//
// 同樣**冇 stub** `buildFineTuneContext_()` 同 `resolveAuthoritativeState_()`
// ——嗰兩個正正就係人手改動偵測嘅心臟。

// 只 stub 真正掂唔到嘅外部 IO。
gas.buildSeedNote_ = function (result) {
  return 'seed=' + result.seed + '　第 ' + result.attemptIndex + ' / ' + result.attemptsRun + ' 次';
};
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function (quarterId) {
  return { quarterId: quarterId, fileId: 'mock', fileUrl: 'https://example.invalid/mock',
    lastPublishedAt: '', lastPublishedVersion: '', sharingAccess: '', sharingPermission: '', createdAt: '' };
};
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture
 * ══════════════════════════════════════════════════════════════ */

const PEOPLE = {
  P9101: { nameTC: '測試甲01', email: 'p9101@example.invalid' },
  P9102: { nameTC: '測試甲02', email: 'p9102@example.invalid' },
  P9103: { nameTC: '測試甲03', email: 'p9103@example.invalid' },
  P9104: { nameTC: '測試甲04', email: 'p9104@example.invalid' }
};

function buildFixture() {
  const C = gas.COLUMNS;
  const S = gas.SHEETS;

  seedSheet(ss, S.CONFIG, ['Key', 'Value', 'Type'],
    [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
      { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
      { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }
    ]);

  seedSheet(ss, S.QUARTERS, ['季度'],
    [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
      C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
      { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 2,
        [C.QUARTERS.START_DATE]: '2027-04-04', [C.QUARTERS.END_DATE]: '2027-06-27',
        [C.QUARTERS.STAGE]: 'DRAFT' }
    ]);

  const dates = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(2027, 3, 4 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    dates.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['主日'],
    [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID, C.SERVICE_DATES.SERVICE_DATE,
      C.SERVICE_DATES.WEEK_INDEX, C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    dates.map(function (d, i) {
      return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
    }));

  seedSheet(ss, S.POSTS, ['崗位'],
    [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT, C.POSTS.DISTINCT_WITHIN_POST,
      C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE, C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP,
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY], [
      { [C.POSTS.POST_ID]: 'CHAIR', [C.POSTS.POST_NAME_TC]: '主席', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' },
      { [C.POSTS.POST_ID]: 'SONG', [C.POSTS.POST_NAME_TC]: '領詩', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 2, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' }
    ]);

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id].nameTC,
        [C.NAME_MAPPING.EMAIL]: PEOPLE[id].email, [C.NAME_MAPPING.ACTIVE]: true };
    }));

  // 四個人全部兩個崗位都合資格 ⇒ 人手把任何一格改成任何一個人都唔會
  // 撞硬規則，令呢份測試專注喺「人手改動有冇被偵測到」呢件事本身。
  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    elig.push(['CHAIR', id]);
    elig.push(['SONG', id]);
  });
  seedSheet(ss, S.ELIGIBILITY, ['資格'],
    [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
      C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
    elig.map(function (pair, i) {
      return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'ELIG' + i, [C.ELIGIBILITY.POST_ID]: pair[0],
        [C.ELIGIBILITY.PERSON_ID]: pair[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
    }));

  seedSheet(ss, S.RULE_SETTINGS, ['規則'],
    [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
      C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY], [
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_ELIGIBILITY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_UNAVAILABLE', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 }
    ]);

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG',
    'REQUESTS', 'SPECIAL_SUNDAYS', 'UNAVAILABLE'].forEach(function (key) {
    const cols = Object.keys(C[key]).map(function (k2) { return C[key][k2]; });
    seedSheet(ss, S[key], [key], cols, []);
  });

  seedSheet(ss, S.EMAIL_TEMPLATES, ['範本'],
    [C.EMAIL_TEMPLATES.TEMPLATE_ID, C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG,
      C.EMAIL_TEMPLATES.SUBJECT, C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN,
      C.EMAIL_TEMPLATES.ATTACH_TYPE, C.EMAIL_TEMPLATES.ACTIVE], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['收件人'],
    [C.EMAIL_RECIPIENTS.RECIPIENT_ID, C.EMAIL_RECIPIENTS.EMAIL, C.EMAIL_RECIPIENTS.DISPLAY_NAME,
      C.EMAIL_RECIPIENTS.STAGE, C.EMAIL_RECIPIENTS.SEND_AS, C.EMAIL_RECIPIENTS.ACTIVE,
      C.EMAIL_RECIPIENTS.ROLE], []);
}

buildFixture();

/* ══════════════════════════════════════════════════════════════
 * 敘事
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 步驟 1：真正生成 v0（連埋真正嘅 grid 工作表）===');
let gridSheetName = '';
{
  const plan = gas.apiGenerateDraftPlan(Q);
  check('★★★★ plan 唔會 blocked', plan.blocked !== true, JSON.stringify(plan));
  const result = gas.apiGenerateDraftExecute(Q);
  check('★★★★★ 生成成功', result.ok !== false, JSON.stringify(result));

  gridSheetName = gas.buildRosterSheetName_(Q, 0);
  const sheet = ss.getSheetByName(gridSheetName);
  check('★★★★★ **真正嘅 grid 工作表由 createRosterSheet() 建立咗**'
    + '（呢個就係第三十二輪略過咗嗰件事）', !!sheet, gridSheetName);
  if (sheet) {
    check('★★★★ grid 有第 2 行機器鍵同資料行', sheet.getLastRow() >= 3, String(sheet.getLastRow()));
  }
}

/** 喺真 grid 工作表度搵一格，回 {row, col, key, currentText}。 */
function findGridCell(postId, slotIndex, dateStr) {
  const sheet = ss.getSheetByName(gridSheetName);
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const wanted = postId + '#' + slotIndex;
  let col = -1;
  for (let c = 0; c < keys.length; c++) {
    if (String(keys[c] || '') === wanted) { col = c + 1; break; }
  }
  if (col === -1) return null;
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    const cellDate = gas.toDateString(sheet.getRange(r, 1).getValue(), TZ);
    if (cellDate === dateStr) {
      return { row: r, col: col, key: wanted, currentText: String(sheet.getRange(r, col).getValue() || '').trim() };
    }
  }
  return null;
}

console.log('\n=== 冇人手改動嗰陣：plan 要講「零改動」===');
{
  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★ 唔會 blocked（真正讀到 grid 工作表）', plan.blocked !== true, JSON.stringify(plan).slice(0, 400));
  checkEqual('★★★★★ gridChanges 係空（真正逐格比對過，唔係測試自己講）',
    (plan.gridChanges || []).length, 0);
  check('★★★★ zeroChange=true', plan.zeroChange === true, JSON.stringify(plan.zeroChange));
}

console.log('\n=== 幹事喺 grid 上改一格：plan 要真正偵測到 ===');
const dates = [];
{
  const D = gas.COLUMNS.SERVICE_DATES;
  gas.readSheet(gas.SHEETS.SERVICE_DATES)
    .sort(function (a, b) { return Number(a[D.WEEK_INDEX]) - Number(b[D.WEEK_INDEX]); })
    .forEach(function (r) { dates.push(gas.toDateString(r[D.SERVICE_DATE], TZ)); });
}
let editedCell = null;
let newPersonName = '';
{
  editedCell = findGridCell('CHAIR', 1, dates[1]);
  check('（前置條件）搵到第 2 週主席嗰格', !!editedCell, JSON.stringify(editedCell));

  // 揀一個「唔係而家嗰個」嘅人手填落去，模擬幹事直接喺表上打名。
  const currentText = editedCell.currentText;
  const candidate = Object.keys(PEOPLE).map(function (id) { return PEOPLE[id].nameTC; })
    .find(function (n) { return n !== currentText; });
  newPersonName = candidate;
  check('（前置條件）揀到一個唔同嘅人手填值',
    !!newPersonName && newPersonName !== currentText,
    '原本=' + currentText + ' 新=' + newPersonName);

  const sheet = ss.getSheetByName(gridSheetName);
  sheet.getRange(editedCell.row, editedCell.col).setValue(newPersonName);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★ 唔會 blocked', plan.blocked !== true, JSON.stringify(plan).slice(0, 400));
  checkEqual('★★★★★ **真正偵測到剛好 1 格人手改動**'
    + '——由 buildFineTuneContext_() → readGridPersonIds_() 逐格讀真表得出，'
    + '唔係 stub 出嚟嘅',
    (plan.gridChanges || []).length, 1);

  if ((plan.gridChanges || []).length === 1) {
    const ch = plan.gridChanges[0];
    checkEqual('★★★★★ 講得出係邊一格（日期）', ch.serviceDate, dates[1]);
    check('★★★★ 講得出係邊個崗位',
      String(ch.postNameTC || ch.postId || '').indexOf('主席') !== -1
        || ch.postId === 'CHAIR', JSON.stringify(ch));
    check('★★★★★ 講得出改成邊個人',
      JSON.stringify(ch).indexOf(newPersonName) !== -1, JSON.stringify(ch));
  }
  check('★★★★ zeroChange 唔再係 true', plan.zeroChange !== true, JSON.stringify(plan.zeroChange));
}

console.log('\n=== apiSaveAndConfirmExecute：真正寫成新一版 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(Q);
  const payload = {
    targetVersionNo: plan.targetVersionNo,
    gridChanges: plan.gridChanges,
    acceptConfirmList: true,
    releaseText: ''
  };
  const result = gas.apiSaveAndConfirmExecute(Q, payload);
  check('★★★★★ 執行成功', result && result.blocked !== true, JSON.stringify(result).slice(0, 500));

  const newVersionNo = gas.findLatestVersionNo(Q);
  checkEqual('★★★★★ 真正建立咗 v1', newVersionNo, 1);

  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const rows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === newVersionNo;
  });
  check('★★★★ v1 有派工紀錄', rows.length > 0, String(rows.length));

  const target = rows.find(function (r) {
    return gas.toDateString(r[A.SERVICE_DATE], TZ) === dates[1] && r[A.POST_ID] === 'CHAIR';
  });
  check('★★★★★ **人手改動真正寫入咗 v1**（第 2 週主席變成 ' + newPersonName + '）',
    !!target && String(target[A.PERSON_NAME_SNAPSHOT] || '').indexOf(newPersonName) !== -1,
    JSON.stringify(target));

  // 改完之後再問一次：新一版嘅 grid 同新一版嘅資料一致 ⇒ 應該冇改動剩。
  const after = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★★ 套用之後再 plan 一次，冇改動剩'
    + '（唔會每次都報同一格——嗰種係「套用咗但冇真正寫入」嘅典型症狀）',
    (after.gridChanges || []).length, 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
