// 第三十三輪批次階段 A：「補上電郵之後的第一封信」——由真入口叫落去。
// FIXTURE-OK: 檔內唯一一處係喺 `buildFineTuneContext_()` 嘅替身入面
// **讀返** `row[C.ASSIGN_SOURCE]`（由真正寫入嘅長表讀），唔係手砌一個值。
// 執行方式：node tests/resend_first_notify_after_email.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 這一份守住的是什麼
// ═════════════════════════════════════════════════════════════════════
//
// 第三十二輪的 e2e 測試用 `checkKnownRed()` 記低咗兩個真 bug：
//
//   1. `deliverOne_()`（Mailer.gs）嘅「RESEND 且內容未變」關卡只比 hash，
//      完全唔理會 `computeResendDiff_()`（ResendFlow.gs）已經算好嘅
//      `firstNotifyDueToEmail`。後果：一個人喺 OFFICIAL 因為查無電郵被
//      `SKIPPED_NO_EMAIL`，幹事之後補上電郵、派工一格都冇改——上游正確
//      咁把佢列入「要通知」，但走到 `deliverOne_()` 因為 hash 冇變即刻被判
//      `SKIPPED_UNCHANGED`，**第一封信永遠冇真正發出**，而且冇任何錯誤訊息。
//
//   2. 上一輪寫入嘅 `SKIPPED_UNCHANGED` 唔喺基準名單，所以下一輪
//      `computeResendDiff_()` 搵返嘅基準仍然係更舊嗰筆 `SKIPPED_NO_EMAIL`
//      ⇒ 同一個人再被列入「要通知」、再被同一個關卡擋住 ⇒ **死循環**。
//
// 兩者本質係同一個 bug：`deliverOne_()` 用自己一套更粗嘅邏輯重新判斷
// 「要唔要寄」，蓋過咗上游已經做好嘅決定（本專案嘅「兩個真相來源」bug class）。
//
// ─────────────────────────────────────────────────────────────────────
// Fixture 照真實形狀砌（2026-08-20 實測嘅 2027T4 v10）
// ─────────────────────────────────────────────────────────────────────
//
// 57 人、其中 7 位 NameMapping 冇電郵。呢度一律用假 ID（P9xxx）同明顯係假嘅名
//（呢個 repo 係公開嘅，真實 PersonID 都唔可以寫），但**人數同比例照真實形狀**，
// 因為呢個 bug 嘅表現同「有幾多人喺同一輪冇改動」直接相關。
//
// 冇電郵嗰 7 位喺 fixture 入面**散佈喺名單各處**，唔係整齊咁排喺最尾
// ——照返實測嗰個形狀，因為名單次序會影響 SendLog 嘅寫入次序同分批 flush。
//
// ⚠️ 由真入口叫落去（A4，冇商量餘地）：
//   步驟 4　`apiStep4Confirm`（WebAppFlow.gs → executeStep4Send_ → sendStage）
//   步驟 5　`apiStep5Plan` → `apiStep5SendPreview` → `apiStep5SendConfirm`
//           （WebAppFlow.gs → executeStep5Send_ → sendResendStage_ → deliverOne_）
// 冇任何一步直接叫 `deliverOne_()`。
//
// 用 `tests/helpers/mock_sheets_realistic.js`（第三十二輪新寫），唔用舊嘅
// `sheet_mock.js`——後者冇 `getLastRow()`／`getLastColumn()`，而
// `getQuarterStage_()` 呢類函式係直接讀 `SpreadsheetApp` 唔經 `readSheet()`。

const { loadGasSource } = require('./helpers/gas_loader');
const {
  RealisticMockSpreadsheet, seedSheet
} = require('./helpers/mock_sheets_realistic');

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
  'FiveStageCore.gs', 'WebAppFlow.gs'
]);

const Q = '2027T4';
const TZ = 'Pacific/Auckland';
const VERSION = 10;   // 照實測嘅 v10

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'a3-test@example.invalid'; } }; } };
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

// IO 邊界（理由同 e2e_five_stage_flow.test.js 檔頭嗰五個邊界一致）
gas.checkMissingPersonalPdfs_ = function () { return { applicable: false, missing: [], total: 0 }; };
gas.resolveMailAttachmentFolder_ = function () { return null; };
gas.listPendingBackfillCells_ = function () { return []; };
// 「表上有冇未儲存嘅人手改動」要讀真正嘅 grid 工作表（Roster_2027T4_v10）。
// 呢份測試冇建立 grid 版面（同 e2e_five_stage_flow.test.js 嘅「邊界一／二」
// 同一個理由），而呢個敘事本身係「派工一格都冇改」，所以明確回報零改動。
// ⚠️ 呢個 stub 唔可以用嚟遮住真嘅未儲存改動——`unsaved_changes_guard.test.js`
// 專門守住呢個關卡本身。
gas.readDashboardUnsavedState_ = function () {
  return { hasAny: false, gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, error: '' };
};

// 同一個理由：`recomputeLatestVersionViolations_()` 經 `buildFineTuneContext_()`
// 讀 grid 工作表。由**真正寫入嘅 RosterAssignments** 重組 context，令下游
// 真正嘅硬規則檢查照跑（規則表本身係空嘅 ⇒ 冇違反），唔係直接假裝「零違反」。
gas.buildFineTuneContext_ = function (quarterId, versionNo) {
  const config = gas.readConfig();
  const timezone = config[gas.CONFIG_KEYS.SYS_TIMEZONE] || TZ;
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const original = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        serviceDateId: row[C.SERVICE_DATE_ID],
        serviceDate: gas.toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID], slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID], personName: row[C.PERSON_NAME_SNAPSHOT],
        assignSource: row[C.ASSIGN_SOURCE]
      };
    });
  const posts = gas.readPostsNormalized();
  const postNames = {};
  posts.forEach(function (p) { postNames[p.postId] = p.postNameTC; });
  const peopleById = {};
  gas.readPeople().forEach(function (row) {
    const N = gas.COLUMNS.NAME_MAPPING;
    peopleById[row[N.PERSON_ID]] = {
      personId: row[N.PERSON_ID], nameTC: row[N.NAME_TC], email: row[N.EMAIL] || ''
    };
  });
  return {
    quarterId: quarterId, versionNo: versionNo, timezone: timezone,
    posts: posts, postNames: postNames,
    serviceDates: gas.readServiceDatesNormalized(quarterId, timezone),
    rules: gas.readRules(), peopleById: peopleById, eligibility: gas.readEligibility(),
    unavailable: gas.readUnavailableNormalized(timezone),
    maxMoves: 999, maxPerQuarterDefault: 8, warnOnSemiHard: true,
    roles: { rows: [] }, personPostExclusions: [],
    original: original, gridValues: {}, gridRender: { labels: {} }
  };
};
gas.resolveAuthoritativeState_ = function (context) {
  return {
    state: context.original.map(function (a) { return Object.assign({ isManual: false }, a); }),
    changes: [], unresolved: []
  };
};
gas.findPublicLinkRow_ = function (quarterId) {
  return { quarterId: quarterId, fileId: 'mock', fileUrl: 'https://example.invalid/mock',
    lastPublishedAt: '', lastPublishedVersion: '', sharingAccess: '', sharingPermission: '', createdAt: '' };
};
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture：57 人（50 有電郵、7 冇），13 個主日、5 個崗位
 * ══════════════════════════════════════════════════════════════ */

const PERSON_COUNT = 57;
// 照實測嗰 7 位喺名單入面嘅相對位置換算成序號，令「冇電郵嘅人散佈喺名單各處」
// 呢個形狀一致，唔係整齊咁排喺最尾——名單次序會影響 SendLog 嘅寫入次序同分批 flush。
const NO_EMAIL_INDEXES = [29, 37, 38, 39, 42, 43, 54];
const SUBJECT_INDEX = 54;   // 本輪要補電郵嗰一位
const pid = function (i) { return 'P9' + String(i).padStart(3, '0'); };
const SUBJECT_ID = pid(SUBJECT_INDEX);

const PEOPLE = [];
for (let i = 1; i <= PERSON_COUNT; i++) {
  const hasEmail = NO_EMAIL_INDEXES.indexOf(i) === -1;
  PEOPLE.push({
    personId: pid(i),
    nameTC: '測試' + String(i).padStart(2, '0') + '號',
    email: hasEmail ? pid(i).toLowerCase() + '@example.invalid' : ''
  });
}

const POSTS = [
  { id: 'CHAIR', name: '主席' }, { id: 'SONG', name: '領詩' }, { id: 'PA', name: '音響' },
  { id: 'USHER', name: '招待' }, { id: 'READ', name: '讀經' }
];

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
      { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 4,
        [C.QUARTERS.START_DATE]: '2027-10-03', [C.QUARTERS.END_DATE]: '2027-12-26',
        // 步驟 4 要求 REQUESTS_APPLIED——呢份測試由步驟 4 開始，
        // 前面幾步各有專門測試（e2e_five_stage_flow.test.js）覆蓋。
        [C.QUARTERS.STAGE]: gas.QUARTER_STAGE.REQUESTS_APPLIED }
    ]);

  const dates = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2027, 9, 3 + i * 7));
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
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
    POSTS.map(function (p, i) {
      return { [C.POSTS.POST_ID]: p.id, [C.POSTS.POST_NAME_TC]: p.name, [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: i + 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
    }));

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    PEOPLE.map(function (p) {
      return { [C.NAME_MAPPING.PERSON_ID]: p.personId, [C.NAME_MAPPING.NAME_TC]: p.nameTC,
        [C.NAME_MAPPING.EMAIL]: p.email, [C.NAME_MAPPING.ACTIVE]: true };
    }));

  // 每人剛好一格派工：13 主日 × 5 崗位 = 65 格，用頭 57 格。
  // 一人一格令每個人嘅 hash 都唔同，而且「派工完全冇改動」呢件事
  // 喺步驟 5 可以逐個人明確斷言。
  const assignments = [];
  let k = 0;
  for (let d = 0; d < dates.length && k < PERSON_COUNT; d++) {
    for (let p = 0; p < POSTS.length && k < PERSON_COUNT; p++) {
      const person = PEOPLE[k];
      assignments.push({
        [C.ROSTER_ASSIGNMENTS.ASSIGNMENT_ID]: 'A' + (k + 1),
        [C.ROSTER_ASSIGNMENTS.QUARTER_ID]: Q,
        [C.ROSTER_ASSIGNMENTS.VERSION_NO]: VERSION,
        [C.ROSTER_ASSIGNMENTS.SERVICE_DATE_ID]: 'SD' + (d + 1),
        [C.ROSTER_ASSIGNMENTS.SERVICE_DATE]: dates[d],
        [C.ROSTER_ASSIGNMENTS.POST_ID]: POSTS[p].id,
        [C.ROSTER_ASSIGNMENTS.SLOT_INDEX]: 1,
        [C.ROSTER_ASSIGNMENTS.PERSON_ID]: person.personId,
        [C.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT]: person.nameTC,
        [C.ROSTER_ASSIGNMENTS.ASSIGN_SOURCE]: 'AUTO',
        [C.ROSTER_ASSIGNMENTS.RULE_FLAGS]: '', [C.ROSTER_ASSIGNMENTS.LOCKED]: false,
        [C.ROSTER_ASSIGNMENTS.UPDATED_AT]: '', [C.ROSTER_ASSIGNMENTS.UPDATED_BY]: ''
      });
      k++;
    }
  }
  seedSheet(ss, S.ROSTER_ASSIGNMENTS, ['派工'],
    [C.ROSTER_ASSIGNMENTS.ASSIGNMENT_ID, C.ROSTER_ASSIGNMENTS.QUARTER_ID, C.ROSTER_ASSIGNMENTS.VERSION_NO,
      C.ROSTER_ASSIGNMENTS.SERVICE_DATE_ID, C.ROSTER_ASSIGNMENTS.SERVICE_DATE, C.ROSTER_ASSIGNMENTS.POST_ID,
      C.ROSTER_ASSIGNMENTS.SLOT_INDEX, C.ROSTER_ASSIGNMENTS.PERSON_ID, C.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT,
      C.ROSTER_ASSIGNMENTS.ASSIGN_SOURCE, C.ROSTER_ASSIGNMENTS.RULE_FLAGS, C.ROSTER_ASSIGNMENTS.LOCKED,
      C.ROSTER_ASSIGNMENTS.UPDATED_AT, C.ROSTER_ASSIGNMENTS.UPDATED_BY], assignments);

  seedSheet(ss, S.ROSTER_VERSIONS, ['版本'],
    [C.ROSTER_VERSIONS.VERSION_ID, C.ROSTER_VERSIONS.QUARTER_ID, C.ROSTER_VERSIONS.VERSION_NO,
      C.ROSTER_VERSIONS.SHEET_NAME, C.ROSTER_VERSIONS.BASIS, C.ROSTER_VERSIONS.PARENT_VERSION_NO,
      C.ROSTER_VERSIONS.STATUS, C.ROSTER_VERSIONS.PROTECTED, C.ROSTER_VERSIONS.WARNING_COUNT,
      C.ROSTER_VERSIONS.CREATED_AT, C.ROSTER_VERSIONS.CREATED_BY, C.ROSTER_VERSIONS.NOTES], [
      { [C.ROSTER_VERSIONS.VERSION_ID]: Q + '-v' + VERSION, [C.ROSTER_VERSIONS.QUARTER_ID]: Q,
        [C.ROSTER_VERSIONS.VERSION_NO]: VERSION, [C.ROSTER_VERSIONS.SHEET_NAME]: 'Roster_' + Q + '_v' + VERSION,
        [C.ROSTER_VERSIONS.BASIS]: 'REQUESTS_APPLIED', [C.ROSTER_VERSIONS.PARENT_VERSION_NO]: VERSION - 1,
        [C.ROSTER_VERSIONS.STATUS]: 'ACTIVE', [C.ROSTER_VERSIONS.PROTECTED]: false,
        [C.ROSTER_VERSIONS.WARNING_COUNT]: 0, [C.ROSTER_VERSIONS.CREATED_AT]: '',
        [C.ROSTER_VERSIONS.CREATED_BY]: '', [C.ROSTER_VERSIONS.NOTES]: '' }
    ]);

  ['SEND_LOG', 'AUDIT_LOG', 'REQUESTS', 'SPECIAL_SUNDAYS', 'UNAVAILABLE',
    'ELIGIBILITY', 'RULE_SETTINGS'].forEach(function (key) {
    const cols = Object.keys(C[key]).map(function (k2) { return C[key][k2]; });
    seedSheet(ss, S[key], [key], cols, []);
  });

  seedSheet(ss, S.EMAIL_TEMPLATES, ['範本'],
    [C.EMAIL_TEMPLATES.TEMPLATE_ID, C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG,
      C.EMAIL_TEMPLATES.SUBJECT, C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN,
      C.EMAIL_TEMPLATES.ATTACH_TYPE, C.EMAIL_TEMPLATES.ACTIVE], [
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_OFFICIAL_TC', [C.EMAIL_TEMPLATES.STAGE]: 'OFFICIAL',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表正式發出',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>',
        [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_OFFICIAL_LIST_TC', [C.EMAIL_TEMPLATES.STAGE]: 'OFFICIAL',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表正式發出（堂委）',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>已發出。</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '已發出。',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_RESEND_TC', [C.EMAIL_TEMPLATES.STAGE]: 'RESEND',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表已更新',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>',
        [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_RESEND_LIST_TC', [C.EMAIL_TEMPLATES.STAGE]: 'RESEND',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表已更新（堂委）',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>已更新。</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '已更新。',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true }
    ]);

  seedSheet(ss, S.EMAIL_RECIPIENTS, ['收件人'],
    [C.EMAIL_RECIPIENTS.RECIPIENT_ID, C.EMAIL_RECIPIENTS.EMAIL, C.EMAIL_RECIPIENTS.DISPLAY_NAME,
      C.EMAIL_RECIPIENTS.STAGE, C.EMAIL_RECIPIENTS.SEND_AS, C.EMAIL_RECIPIENTS.ACTIVE,
      C.EMAIL_RECIPIENTS.ROLE], [
      { [C.EMAIL_RECIPIENTS.RECIPIENT_ID]: 'REC1', [C.EMAIL_RECIPIENTS.EMAIL]: 'deacon@example.invalid',
        [C.EMAIL_RECIPIENTS.DISPLAY_NAME]: '堂委', [C.EMAIL_RECIPIENTS.STAGE]: 'OFFICIAL,RESEND',
        [C.EMAIL_RECIPIENTS.SEND_AS]: 'TO', [C.EMAIL_RECIPIENTS.ACTIVE]: true,
        [C.EMAIL_RECIPIENTS.ROLE]: 'REVIEWER' }
    ]);
}

buildFixture();

/** 讀某一階段嘅 SendLog，整理成 {personId: Status}。 */
function sendLogByPerson(stage) {
  const C = gas.COLUMNS.SEND_LOG;
  const out = {};
  gas.readSheet(gas.SHEETS.SEND_LOG).forEach(function (row) {
    if (row[C.STAGE] !== stage) return;
    if (!row[C.PERSON_ID]) return;
    out[row[C.PERSON_ID]] = row[C.STATUS];
  });
  return out;
}
function countStatus(map, status) {
  return Object.keys(map).filter(function (k) { return map[k] === status; }).length;
}

/* ══════════════════════════════════════════════════════════════
 * 敘事
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 前置：fixture 真係 57 人、7 位冇電郵 ===');
{
  const people = gas.readPeople();
  checkEqual('★★★★ NameMapping 有 57 人', people.length, PERSON_COUNT);
  const noEmail = people.filter(function (r) { return !r[gas.COLUMNS.NAME_MAPPING.EMAIL]; });
  checkEqual('★★★★ 其中 7 位冇電郵（照 2027T4 v10 實測形狀）', noEmail.length, 7);
  check('★★★★ 本輪主角 ' + SUBJECT_ID + ' 一開始確實冇電郵',
    noEmail.some(function (r) { return r[gas.COLUMNS.NAME_MAPPING.PERSON_ID] === SUBJECT_ID; }));
}

console.log('\n=== 步驟 4：正式發出（apiStep4Confirm，真入口）===');
{
  const result = gas.apiStep4Confirm(Q, '');
  const log = sendLogByPerson('OFFICIAL');

  checkEqual('★★★★★ Stage → OFFICIAL_SENT（真正由 executeStep4Send_() 前進）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.OFFICIAL_SENT);
  checkEqual('★★★★★ 50 位有電郵嘅人真正被 sendStage() 記成 DRY_RUN',
    countStatus(log, gas.MAIL_STATUS.DRY_RUN), PERSON_COUNT - 7);
  checkEqual('★★★★★ 7 位冇電郵嘅人真正被記成 SKIPPED_NO_EMAIL',
    countStatus(log, gas.MAIL_STATUS.SKIPPED_NO_EMAIL), 7);
  checkEqual('★★★★★ 主角 ' + SUBJECT_ID + ' 喺 OFFICIAL 被 SKIPPED_NO_EMAIL',
    log[SUBJECT_ID], gas.MAIL_STATUS.SKIPPED_NO_EMAIL);
  check('★★★★ 結果講得出寄咗幾多封', typeof result.dryRun === 'number', JSON.stringify(result));
}

console.log('\n=== 幹事到 NameMapping 幫 ' + SUBJECT_ID + ' 補上電郵（派工一格都唔改）===');
{
  const sheet = ss.getSheetByName(gas.SHEETS.NAME_MAPPING);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf(gas.COLUMNS.NAME_MAPPING.PERSON_ID) + 1;
  const emailCol = headers.indexOf(gas.COLUMNS.NAME_MAPPING.EMAIL) + 1;
  let done = false;
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (sheet.getRange(r, idCol).getValue() === SUBJECT_ID) {
      sheet.getRange(r, emailCol).setValue('subject-fixed@example.invalid');
      done = true;
    }
  }
  check('（前置條件）電郵已經補上', done);
}

console.log('\n=== 步驟 5 第一輪：apiStep5Plan → apiStep5SendConfirm（真入口）===');
{
  const plan = gas.apiStep5Plan(Q);
  const changedIds = plan.changed.map(function (c) { return c.personId; }).sort();

  checkEqual('★★★★★ 上游 computeResendDiff_() 只列出主角一個人'
    + '（派工完全冇改動，佢係唯一「補咗電郵、之前被 SKIPPED_NO_EMAIL」嗰位）',
    changedIds, [SUBJECT_ID]);
  const entry = plan.changed[0];
  check('★★★★★ 而且明確標住 firstNotifyDueToEmail=true（唔係「有改動」）',
    entry && entry.firstNotifyDueToEmail === true, JSON.stringify(entry));

  const preview = gas.apiStep5SendPreview(Q);
  check('★★★★ 送出預覽準備好', preview.mode === 'READY', JSON.stringify(preview));

  const sendResult = gas.apiStep5SendConfirm(Q, '');
  check('★★★★ 冇被硬規則關卡擋住', sendResult.blocked !== true, JSON.stringify(sendResult));

  const log = sendLogByPerson('RESEND');

  // ★ 呢一條就係階段 A 修正嘅核心斷言。修好之前呢度係 SKIPPED_UNCHANGED。
  checkEqual('★★★★★ **主角真正被寄出**（DRY_RUN），唔再係 SKIPPED_UNCHANGED'
    + '——deliverOne_() 執行上游嘅決定，唔再自己用 hash 重新判斷一次',
    log[SUBJECT_ID], gas.MAIL_STATUS.DRY_RUN);

  // 另外 6 位冇電郵嘅人：hash 冇變、亦都仲未有電郵 ⇒ 上游根本冇列入名單
  // ⇒ deliverOne_() 完全冇被叫到 ⇒ SendLog 呢一階段冇佢哋嘅行。
  // 呢個唔係漏測——係「只騷擾需要騷擾嘅人」呢個設計嘅正確結果。
  const stillNoEmail = NO_EMAIL_INDEXES.filter(function (i) { return i !== SUBJECT_INDEX; }).map(pid);
  checkEqual('★★★★★ 另外 6 位仍然冇電郵嘅人，本輪根本冇被嘗試'
    + '（SendLog RESEND 階段完全冇佢哋嘅行——上游冇列入名單，唔係寄失敗）',
    stillNoEmail.filter(function (p) { return log[p] !== undefined; }), []);

  // 其餘 50 位有電郵、派工又冇改動嘅人，同樣唔會被列入名單。
  const unchangedOthers = PEOPLE
    .filter(function (p) { return p.email && p.personId !== SUBJECT_ID; })
    .map(function (p) { return p.personId; });
  checkEqual('★★★★★ 其餘 50 位（有電郵、派工冇變）本輪同樣冇被嘗試'
    + '——RESEND_ONLY_CHANGED=TRUE 嘅原意完全保留，冇因為呢次修正而變成「一律重寄」',
    unchangedOthers.filter(function (p) { return log[p] !== undefined; }), []);
}

console.log('\n=== 步驟 5 第二輪：同一件事再撳一次（A2 死循環防線）===');
{
  const plan = gas.apiStep5Plan(Q);
  const changedIds = plan.changed.map(function (c) { return c.personId; }).sort();

  // 修好之前：第一輪寫入嘅係 SKIPPED_UNCHANGED，而嗰個 Status 唔喺基準名單
  // ⇒ 基準仍然停留喺更舊嗰筆 SKIPPED_NO_EMAIL ⇒ 主角再次被列入名單
  // ⇒ 再次被同一個 hash 關卡擋住 ⇒ 死循環，冇任何錯誤訊息。
  checkEqual('★★★★★ **主角唔會再出現**——第一輪已經真正寄咗（DRY_RUN，本身就喺基準名單），'
    + '死循環唔成立', changedIds, []);
  checkEqual('★★★★ mode=NO_CHANGES', plan.mode, 'NO_CHANGES');
}

console.log('\n=== A2：基準名單抽咗做常數，而且同 MAIL_STATUS 對得上 ===');
{
  const baseline = gas.RESEND_BASELINE_STATUSES;
  const excluded = gas.RESEND_NON_BASELINE_STATUSES;
  check('★★★★ RESEND_BASELINE_STATUSES 存在而且係陣列', Array.isArray(baseline));
  check('★★★★★ SKIPPED_UNCHANGED 已經入咗基準名單（見 Constants.gs 嘅理由表）',
    baseline.indexOf(gas.MAIL_STATUS.SKIPPED_UNCHANGED) !== -1, JSON.stringify(baseline));

  // MAIL_STATUS 每一個值都一定要表過態：入基準，或者喺排除清單有理由。
  const unspoken = Object.keys(gas.MAIL_STATUS).filter(function (k) {
    const v = gas.MAIL_STATUS[k];
    return baseline.indexOf(v) === -1 && !excluded[k];
  });
  checkEqual('★★★★★ MAIL_STATUS 冇任何一個值係「未表過態」'
    + '（加新 Status 但冇決定佢算唔算基準 ⇒ 呢條會紅）', unspoken, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
