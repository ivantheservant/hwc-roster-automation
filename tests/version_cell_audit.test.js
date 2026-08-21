// 第三十八輪批次 G 組：逐季逐版清點格子分類（唯讀工具）。
// 執行方式：node tests/version_cell_audit.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// `VersionCellAudit.gs` 係一個**唯讀**工具，用嚟一次過睇清楚
// 「邊一季、邊一版嘅資料壞咗」。呢一份要證明三件事：
//
//   1. 好嘅版本要判 OK——唔可以成日嘈，否則冇人會再睇佢
//   2. 壞嘅版本要判 BAD，而且要**講得出係邊一種指紋**
//   3. 佢真係唔會改任何資料
//
// ⚠️ 好嘅版本一律由**真入口**產生（第三十八輪 B 組），
// 壞嘅版本先至手砌——因為現行程式碼已經唔會再產生嗰種資料，
// 而呢個工具存在嘅理由正正就係「舊版本裡面仲有」。

const { loadGasSource } = require('./helpers/gas_loader.js');
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
  'WebAppGenerate.gs', 'PreacherTranslationFill.gs', 'VersionCellAudit.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
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
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = {
  getActiveUser: function () { return { getEmail: function () { return 'g@example.invalid'; } }; }
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
gas.nowTimestamp_ = function () { return '2099-01-01 09:00:00'; };
gas.applyTimestampFormat_ = function () {};
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
  [['CHAIR', '主席', true, 'WEEKLY'], ['READ', '讀經', true, 'WEEKLY'],
    ['PREACH', '講員', false, 'WEEKLY'],
    ['COMMUNION', '聖餐襄禮', true, 'FIRST_SUNDAY']].map(function (p, i) {
    return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
      [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: p[3],
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
    elig.push(['CHAIR', id]); elig.push(['READ', id]); elig.push(['COMMUNION', id]);
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
  // ⚠️ 呢三條規則一定要開——生成器係靠佢哋去寫 `RuleFlags`。
  // 唔開嘅話「這一週不設」同「待確認」兩種格都唔會帶跳過原因，
  // fixture 本身就唔似真實資料，個測試會驗緊一個唔存在嘅世界。
  ['HARD_ELIGIBILITY', 'HARD_NO_AUTO_PREACHER', 'HARD_COMMUNION_FIRST_SUNDAY']
    .map(function (id) {
      return { [C.RULE_SETTINGS.RULE_ID]: id, [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
        [C.RULE_SETTINGS.PRIORITY]: 1 };
    }));

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);
}
buildFixture();

// =====================================================================
console.log('\n=== 前置：用真入口生成一個好版本 ===');
check('★★★★ 生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
check('（前置）用真入口填一格講員',
  gas.apiSavePreacherTranslationEntry(Q, DATES[0], 'PREACH', 1, '客席甲牧師') !== undefined);

console.log('\n=== G 組：好版本要判 OK（成日嘈就冇人會再睇佢）===');
{
  const results = gas.auditAllVersionCellClasses();
  checkEqual('★★★★ 掃到一個版本', results.length, 1);
  const r = results[0];
  checkEqual('★★★★★ 由真入口產生嘅版本判 OK', r.level, 'OK');
  checkEqual('★★★★ 五個桶加起嚟 ＝ 總格數（唔可以有格漏數）',
    Object.keys(r.counts).reduce(function (s, k) { return s + r.counts[k]; }, 0), r.total);
  checkEqual('★★★★★ 填咗嘅講員格計落「有派人」，唔係「未能安排」',
    r.counts[gas.GRID_CELL_CLASS.GENUINE_GAP], 0);
  check('★★★★ 「這一週不設」真係數到（非首主日嘅聖餐襄禮）',
    r.counts[gas.GRID_CELL_CLASS.STRUCTURAL_NA] > 0, JSON.stringify(r.counts));
}

// =====================================================================
// 落面呢兩個係**手砌嘅壞版本**。
// FIXTURE-OK: 現行程式碼已經唔會再產生呢種資料（第三十四至三十八輪修好晒），
// 而呢個工具存在嘅唯一理由就係「舊版本裡面仲有」。要驗佢認唔認得出，
// 就一定要砌返一個出嚟——由真入口係造唔到嘅。
// =====================================================================
function corruptVersion(fromVersion, newVersion, mutate) {
  const sh = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const head = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = function (k) { return head.indexOf(k) + 1; };
  const src = [];
  for (let r = 3; r <= sh.getLastRow(); r++) {
    const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
    if (String(row[col(A.QUARTER_ID) - 1]) !== Q) continue;
    if (Number(row[col(A.VERSION_NO) - 1]) !== fromVersion) continue;
    src.push(row.slice());
  }
  const out = src.map(function (row) {
    row[col(A.VERSION_NO) - 1] = newVersion;
    mutate(row, col);
    return row;
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return out.length;
}

console.log('\n=== G 組：指紋一——所有冇人嘅格都被算成「排唔出」 ===');
{
  // 第三十四輪甲5 嗰個 bug 嘅後果：`RuleFlags` 整批被寫死空陣列。
  const n = corruptVersion(0, 1, function (row, col) {
    row[col(A.RULE_FLAGS) - 1] = '';
    row[col(A.PERSON_NAME_SNAPSHOT) - 1] = row[col(A.PERSON_ID) - 1]
      ? row[col(A.PERSON_NAME_SNAPSHOT) - 1] : '';
  });
  check('（前置）造咗一個 RuleFlags 被清空嘅版本', n > 0, 'n=' + n);

  const r = gas.auditAllVersionCellClasses().filter(function (x) { return x.versionNo === 1; })[0];
  checkEqual('★★★★★ 判 BAD', r.level, 'BAD');
  check('★★★★★ 而且講得出係「未能安排 ＝ 總格數 − 有派人」呢個指紋'
    + '（唔講出嚟嘅話，幹事只會以為系統排得差，唔會知係資料壞咗）',
    r.note.indexOf('剛好等於') !== -1, r.note);
  check('★★★★ 而且句說話寫俾人睇，唔係機器代號',
    r.note.indexOf('GENUINE_GAP') === -1 && r.note.indexOf('RuleFlags') === -1, r.note);
}

console.log('\n=== G 組：指紋二——上一版有名、呢一版變空白 ===');
{
  // 第三十六／三十七輪嗰個 bug 嘅後果：講員格個名冇咗，
  // 但 `RuleFlags` 嘅 NO_AUTO_GENERATE 仲喺度。
  //
  // ⚠️ 呢種格喺五個桶入面同「從來冇填過」**一模一樣**（兩者都係「待確認」），
  // 所以淨係數桶係揀唔出嚟嘅。要靠**比較上一版**先分得到。
  //
  // 先照抄一份好嘅做 v2（佢嘅上一版係壞咗嘅 v1，所以 v2 唔會被誤報），
  // 再由 v2 造出「個名冇咗」嘅 v3。
  check('（前置）先照抄一份好嘅做 v2', corruptVersion(0, 2, function () {}) > 0);
  const n = corruptVersion(2, 3, function (row, col) {
    if (row[col(A.POST_ID) - 1] !== 'PREACH') return;
    row[col(A.PERSON_NAME_SNAPSHOT) - 1] = '';
  });
  check('（前置）造咗一個講員名冇咗嘅 v3', n > 0, 'n=' + n);

  const r = gas.auditAllVersionCellClasses().filter(function (x) { return x.versionNo === 3; })[0];
  checkEqual('★★★★★ 判 BAD', r.level, 'BAD');
  check('★★★★★ 而且**講得出上一版係邊一版、掉咗嘅係邊個名**'
    + '——呢句就係幹事補返個名嘅唯一線索（系統自己補唔到：'
    + '嗰個名淨係仲留喺上一版度）',
    r.note.indexOf('還有名字') !== -1 && r.note.indexOf('客席甲牧師') !== -1, r.note);
  checkEqual('★★★★ 而且逐格列得出',
    r.lostNames.map(function (l) { return l.postId; }), ['PREACH']);

  // 反方向：淨係數桶係分唔出呢一版同一個「從來冇填過」嘅版本嘅。
  const counts = r.counts;
  checkEqual('★★★★★ 反證：呢一版嘅五個桶睇落完全正常'
    + '（即係話「只數桶」呢個做法會漏咗呢一整類問題）',
    counts[gas.GRID_CELL_CLASS.GENUINE_GAP], 0);
}

console.log('\n=== G 組：呢個工具只看，唔改 ===');
{
  const before = JSON.stringify(gas.readSheet(S.ROSTER_ASSIGNMENTS));
  const versionsBefore = JSON.stringify(gas.readSheet(S.ROSTER_VERSIONS));
  gas.auditAllVersionCellClasses();
  checkEqual('★★★★★ RosterAssignments 一個字都冇變'
    + '（呢個工具刻意冇寫自動修復——見 VersionCellAudit.gs 檔頭）',
    JSON.stringify(gas.readSheet(S.ROSTER_ASSIGNMENTS)), before);
  checkEqual('★★★★★ RosterVersions 一個字都冇變',
    JSON.stringify(gas.readSheet(S.ROSTER_VERSIONS)), versionsBefore);

  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'VersionCellAudit.gs'), 'utf8');
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 整份檔案冇任何寫入 RosterAssignments 嘅程式碼'
    + '（多開一條唔經檢查嘅寫入路，就係五輪教訓嘅相反）',
    bare.indexOf('SHEETS.ROSTER_ASSIGNMENTS') !== -1
      && !/ROSTER_ASSIGNMENTS[\s\S]{0,200}setValue/.test(bare), '');
  check('★★★★★ 而且唯一會寫嘅係佢自己嗰張報告表',
    (bare.match(/insertSheet\(/g) || []).length === 1
      && bare.indexOf('VERSION_CELL_AUDIT_SHEET') !== -1, '');
}

console.log('\n=== G 組：分類一律經 classifyGridCell_() ===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'VersionCellAudit.gs'), 'utf8');
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 用 `classifyGridCell_()`，冇自己再寫一套判斷'
    + '（自己寫一套 ⇒ 呢個工具會同 grid／PDF 講唔同嘅話）',
    /classifyGridCell_\(/.test(bare), '');
  check('★★★★★ 而且有把 `personName` 傳落去'
    + '（漏傳 ⇒ 呢個工具會把填好嘅講員格報成「未能安排」，'
    + '即係佢自己製造出佢要搵嘅症狀）',
    /personName:\s*row\[C\.PERSON_NAME_SNAPSHOT\]/.test(bare), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
