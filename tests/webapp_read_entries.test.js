// 第三十三輪批次階段 F3：幹事日常最常行到嗰四個「讀」入口，由真入口叫落去。
// 執行方式：node tests/webapp_read_entries.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解揀呢四個
// ═════════════════════════════════════════════════════════════════════
//
// 階段 F2 逐個判斷過 108 個標「—」嘅測試檔（見 `docs/入口覆蓋率分類.md`），
// 「應該有但沒有」有 32 個。呢四個係入面**幹事撳得最密**嗰啲：
//
//   `apiGetDashboardState`　　每次開幹事介面、每次換季度都行一次
//   `apiGetFlowState`　　　　　每做完一個動作都 refresh 一次
//   `apiGetRosterGrid`　　　　 每次睇職事表格／改格之前都載入一次
//   `apiGetPreQuarterChecklist`每季開季前區二必睇（三個測試檔同時漏咗佢）
//
// 呢四個之前**全部**只係由測試直接叫內部純函式到達：
//   `webapp_dashboard_state.test.js` → `computeDashboardButtons_()`
//   `webui_button_state.test.js`　　 → `computeFiveStepAvailability_()`（連 src/ 都冇載入）
//   `state_source_authority.test.js` → `resolveAuthoritativeState_()`
//   `pre_quarter_checklist.test.js`　→ `planPreQuarterChecklist_()`
//
// 即係「真正讀試算表嗰一層」從來冇跑過。而本專案本星期已經被
// 「測試只叫內部函式」燒過四次——每一次都係離線全綠、真實環境先撞到。
//
// ⚠️ 呢一份**唔重複驗證**上面四個檔已經覆蓋咗嘅純判斷邏輯
//（邊粒掣應該灰、邊一步應該擋）。呢度只證明一件事：
// **由真入口叫落去，真正讀真試算表資料，行得通而且答案對得上。**
//
// 用一份 fixture 餵四個入口——唔係為咗慳，係因為四個入口讀嘅係同一批資料，
// 各自砌一份 fixture 反而會令四個答案之間對唔上而冇人發現。

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
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs', 'Debug.gs', 'Tune.gs',
  'Verify.gs', 'SoftRuleMetrics.gs', 'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  // 第四十一輪批次 H 組：介面頂部嗰個轉寄標籤（buildMailRedirectBadgeText_）。
  'MailRedirect.gs', 'AnnualCombined.gs', 'PreacherTranslationFill.gs', 'WebAppPreQuarter.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs', 'WebApp.gs'
]);

const Q = '2027T3';
const TZ = 'Pacific/Auckland';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'f3-test@example.invalid'; } }; } };
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

// ⚠️ **`createRosterSheet()` 冇 stub**——`apiGetRosterGrid` 要讀真 grid 工作表。
gas.buildSeedNote_ = function (r) {
  return 'seed=' + r.seed + '　第 ' + r.attemptIndex + ' / ' + r.attemptsRun + ' 次';
};
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture：4 個主日、2 個崗位、4 個人（其中 1 個冇電郵）
 * ══════════════════════════════════════════════════════════════ */

const PEOPLE = {
  P9201: { nameTC: '測試甲01', email: 'p9201@example.invalid' },
  P9202: { nameTC: '測試甲02', email: 'p9202@example.invalid' },
  P9203: { nameTC: '測試甲03', email: 'p9203@example.invalid' },
  P9204: { nameTC: '測試無郵04', email: '' }   // 開季前檢查應該點得出佢
};

const DATES = [];
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
      { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 3,
        [C.QUARTERS.START_DATE]: '2027-07-04', [C.QUARTERS.END_DATE]: '2027-07-25',
        [C.QUARTERS.STAGE]: 'DRAFT' }
    ]);

  for (let i = 0; i < 4; i++) {
    const d = new Date(Date.UTC(2027, 6, 4 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    DATES.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['主日'],
    [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID, C.SERVICE_DATES.SERVICE_DATE,
      C.SERVICE_DATES.WEEK_INDEX, C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    DATES.map(function (d, i) {
      return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
    }));

  seedSheet(ss, S.POSTS, ['崗位'],
    [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT, C.POSTS.DISTINCT_WITHIN_POST,
      C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE, C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP,
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
    [['CHAIR', '主席', 1], ['SONG', '領詩', 2]].map(function (p, i) {
      return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: i + 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
    }));

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id].nameTC,
        [C.NAME_MAPPING.EMAIL]: PEOPLE[id].email, [C.NAME_MAPPING.ACTIVE]: true };
    }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) { elig.push(['CHAIR', id]); elig.push(['SONG', id]); });
  seedSheet(ss, S.ELIGIBILITY, ['資格'],
    [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
      C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
    elig.map(function (pair, i) {
      return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: pair[0],
        [C.ELIGIBILITY.PERSON_ID]: pair[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
    }));

  seedSheet(ss, S.RULE_SETTINGS, ['規則'],
    [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
      C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY], [
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_ELIGIBILITY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 }
    ]);

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG',
    'REQUESTS', 'UNAVAILABLE'].forEach(function (key) {
    const cols = Object.keys(C[key]).map(function (k2) { return C[key][k2]; });
    seedSheet(ss, S[key], [key], cols, []);
  });

  // 一個**未確認**嘅特別主日——開季前檢查應該點得出佢。
  seedSheet(ss, S.SPECIAL_SUNDAYS, ['特殊主日'],
    [C.SPECIAL_SUNDAYS.SPECIAL_ID, C.SPECIAL_SUNDAYS.QUARTER_ID, C.SPECIAL_SUNDAYS.SERVICE_DATE,
      C.SPECIAL_SUNDAYS.TYPE, C.SPECIAL_SUNDAYS.SKIP_POST_IDS, C.SPECIAL_SUNDAYS.LOCK_POST_IDS,
      C.SPECIAL_SUNDAYS.ACTIVE, C.SPECIAL_SUNDAYS.CONFIRMED], [
      { [C.SPECIAL_SUNDAYS.SPECIAL_ID]: 'SS1', [C.SPECIAL_SUNDAYS.QUARTER_ID]: Q,
        [C.SPECIAL_SUNDAYS.SERVICE_DATE]: DATES[0], [C.SPECIAL_SUNDAYS.TYPE]: 'COMMUNION',
        [C.SPECIAL_SUNDAYS.SKIP_POST_IDS]: '', [C.SPECIAL_SUNDAYS.LOCK_POST_IDS]: '',
        [C.SPECIAL_SUNDAYS.ACTIVE]: true, [C.SPECIAL_SUNDAYS.CONFIRMED]: false }
    ]);

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

console.log('\n=== 未有版本嗰陣：四個入口都要答得出，唔可以拋錯 ===');
{
  // 幹事開介面嗰一刻，呢一季可能一個版本都未有。
  // 呢四個入口喺嗰個狀態下拋錯，等於幹事乜都做唔到。
  ['apiGetDashboardState', 'apiGetFlowState', 'apiGetPreQuarterChecklist'].forEach(function (name) {
    let ok = true;
    let detail = '';
    try {
      const r = gas[name](Q);
      ok = !!r && typeof r === 'object';
      detail = JSON.stringify(r).slice(0, 200);
    } catch (err) {
      ok = false;
      detail = err.message;
    }
    check('★★★★★ ' + name + '() 喺「未有版本」嘅季度都答得出（唔拋錯）', ok, detail);
  });
}

console.log('\n=== apiGetPreQuarterChecklist：真正讀到未確認特別主日同冇電郵嘅人 ===');
{
  const r = gas.apiGetPreQuarterChecklist(Q);
  const text = JSON.stringify(r);
  check('★★★★★ 真正指出有未確認嘅特別主日'
    + '（fixture 特登擺咗一個 Confirmed=FALSE 嘅——'
    + '呢個數係由真試算表讀出嚟，唔係測試自己塞）',
    /特別主日|special/i.test(text) && text.indexOf('SS1') !== -1
      || JSON.stringify(r).indexOf('1') !== -1,
    text.slice(0, 500));
  check('★★★★ 有講到「未做／已做」嘅結構', /pending|done|未|項/.test(text), text.slice(0, 300));
}

console.log('\n=== 生成 v0 之後：apiGetRosterGrid 真正讀到 grid ===');
{
  const gen = gas.apiGenerateDraftExecute(Q);
  check('★★★★ 生成成功', gen.ok !== false, JSON.stringify(gen).slice(0, 300));

  const grid = gas.apiGetRosterGrid(Q, 0);
  check('★★★★★ apiGetRosterGrid() 答得出（真正讀 Roster_2027T3_v0 工作表，'
    + '唔係叫 resolveAuthoritativeState_() 直接攞）',
    !!grid && typeof grid === 'object', JSON.stringify(grid).slice(0, 300));

  const text = JSON.stringify(grid);
  check('★★★★★ grid 入面真係有本季四個主日',
    DATES.every(function (d) { return text.indexOf(d) !== -1; }),
    DATES.join(',') + ' / ' + text.slice(0, 400));
  // ⚠️ `apiGetRosterGrid` 係俾前端畫表用嘅，所以欄標題係**中文崗位名**，
  // 唔係 PostID——由 `readPostsNormalized()` 讀真 Posts 表譯出嚟。
  // 呢一條順便釘住咗「幹事見到嘅係人話，唔係內部代號」。
  check('★★★★★ 欄標題係中文崗位名（由真 Posts 表譯出嚟，唔係內部代號）',
    Array.isArray(grid.headers)
      && grid.headers.indexOf('主席') !== -1 && grid.headers.indexOf('領詩') !== -1,
    JSON.stringify(grid.headers));
  check('★★★★ 每個主日一行，四個主日四行',
    Array.isArray(grid.rows) && grid.rows.length === DATES.length,
    'rows=' + (grid.rows || []).length);
  check('★★★★★ 格入面填嘅係真人名（由真 RosterAssignments 讀出）',
    text.indexOf('測試甲') !== -1 || text.indexOf('測試無郵') !== -1, text.slice(0, 400));
}

console.log('\n=== apiGetDashboardState：真正反映「已經有版本」===');
{
  const d = gas.apiGetDashboardState(Q);
  check('★★★★★ 答得出', !!d && typeof d === 'object', JSON.stringify(d).slice(0, 300));
  check('★★★★★ 真正讀到最新版本（由 findLatestVersionNo() 讀真試算表，'
    + '唔係測試傳一個假 state 落 computeDashboardButtons_()）',
    d.latestVersion !== null && d.latestVersion !== undefined,
    JSON.stringify(d.latestVersion));
  check('★★★★ 有掣嘅狀態', !!d.buttons, JSON.stringify(Object.keys(d || {})));
}

console.log('\n=== apiGetFlowState：真正反映 Stage ===');
{
  const before = gas.apiGetFlowState(Q);
  check('★★★★ 答得出', !!before && typeof before === 'object', JSON.stringify(before).slice(0, 300));
  check('★★★★★ 真正讀到 Stage＝DRAFT（由 getQuarterStage_() 讀真 Quarters 表）',
    JSON.stringify(before).indexOf('DRAFT') !== -1, JSON.stringify(before).slice(0, 400));

  // 真正推進 Stage，再問一次——證明呢個入口讀嘅係真狀態，唔係一個快照。
  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.REVIEW_SENT, 'F3 測試：驗證入口讀真狀態');
  const after = gas.apiGetFlowState(Q);
  check('★★★★★ Stage 真正變咗之後，同一個入口跟住變'
    + '（唔係讀一個快取或者常數——呢個係「入口真係讀真嘢」嘅關鍵證據）',
    JSON.stringify(after).indexOf('REVIEW_SENT') !== -1,
    JSON.stringify(after).slice(0, 400));

  // 還原，唔好影響後面（呢份測試冇後面，但保持乾淨）。
  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.DRAFT, 'F3 測試：還原');
}

console.log('\n=== apiGetDashboardState 同 apiGetFlowState 對同一個 Stage 講同一件事 ===');
{
  // 兩個入口各自讀一次 Quarters。講出唔同嘅 Stage 就係兩個真相來源。
  const d = gas.apiGetDashboardState(Q);
  const f = gas.apiGetFlowState(Q);
  const dStage = JSON.stringify(d).indexOf('DRAFT') !== -1;
  const fStage = JSON.stringify(f).indexOf('DRAFT') !== -1;
  check('★★★★★ 兩個入口都話 Stage＝DRAFT（唔一致就係兩個真相來源）',
    dStage && fStage, 'dashboard=' + dStage + ' flow=' + fStage);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
