// 第三十五輪批次 A／B／C／D 組：由真入口叫落去。
// 執行方式：node tests/preacher_free_text_save_confirm.test.js
//
// ═════════════════════════════════════════════════════════════════════
// A 組（上線 blocker）：講員一填，「儲存並確認」永遠撳唔到
// ═════════════════════════════════════════════════════════════════════
//
// 現場（2027T3）：`2027-07-04` 講員一格早前用「填講員／翻譯／獻花」填咗
// 一位外請講員。佢**唔喺 `NameMapping`**（外請講員本來就唔應該喺），
// 所以喺 `RosterAssignments` 只有自由文字、冇 `PersonID`。
//
// 人手改動偵測見到「grid 有字、版本記錄解析出空」就當成一格認唔出嘅
// 人手改動 ⇒ 整批拒絕建立新版本。**任何一季只要幹事填過講員，
// 就永遠撳唔到「儲存並確認」**——而填講員係開季前必做嘅事。
//
// ⚠️ 判斷由 `Posts` 嘅 `AutoGenerate` 讀出嚟，**唔用崗位 ID 白名單**
// ——崗位會增減，寫死 ID 會喺下一次加崗位嗰陣再爆一次。
//
// B 組：對話框把兩個值講反（實際係「你打了」嗰個欄位名寫錯咗，永遠空）。
// C／D 組：主席兼報告「上限」算出 100% 而被當成目標；兩個工具講兩套。

const { loadGasSource } = require('./helpers/gas_loader');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./helpers/mock_sheets_realistic');

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
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs'
]);

const Q = '2027T3';
const TZ = 'Pacific/Auckland';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'r35@example.invalid'; } }; } };
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
    if (fmt === 'dd/MM') {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date).split('-');
      return p[2] + '/' + p[1];
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
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture：4 個主日 × 3 個崗位（CHAIR／READ 自動排，PREACH 唔自動排）
 * ══════════════════════════════════════════════════════════════ */

const PEOPLE = { P9501: '測試甲01', P9502: '測試甲02', P9503: '測試甲03' };
const GUEST_PREACHER = '某某某牧師';   // 刻意唔喺 NameMapping
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
    [['CHAIR', '主席', true], ['READ', '讀經', true], ['PREACH', '講員', false]]
      .map(function (p, i) {
        return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
          [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
          [C.POSTS.AUTO_GENERATE]: p[2], [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW',
          [C.POSTS.MUTEX_GROUP]: '', [C.POSTS.DISPLAY_ORDER]: i + 1,
          [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
      }));

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id],
        [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
    }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) { elig.push(['CHAIR', id]); elig.push(['READ', id]); });
  seedSheet(ss, S.ELIGIBILITY, ['資格'],
    [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
      C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
    elig.map(function (pair, i) {
      return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: pair[0],
        [C.ELIGIBILITY.PERSON_ID]: pair[1], [C.ELIGIBILITY.ELIGIBLE]: true,
        [C.ELIGIBILITY.ACTIVE]: true };
    }));

  seedSheet(ss, S.RULE_SETTINGS, ['規則'],
    [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
      C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY], [
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_ELIGIBILITY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
        [C.RULE_SETTINGS.PRIORITY]: 1 },
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_NO_AUTO_PREACHER', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK',
        [C.RULE_SETTINGS.PRIORITY]: 1 }
    ]);

  // ⚠️ `NameAlias` 一定要有——`resolvePersonId()` 會讀佢。
  // 只有喺**真正有人手改動**嗰陣先會行到嗰條路，所以呢張表遲咗先要
  // ——而「遲咗先要」本身就係 A 組修正生效嘅旁證：講員嗰幾格根本冇行到解析。
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG',
    'REQUESTS', 'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS'].forEach(function (key) {
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

/** 喺真 grid 工作表寫一格。 */
function setGridCell(versionNo, dateStr, postId, text) {
  const sheet = ss.getSheetByName(gas.buildRosterSheetName_(Q, versionNo));
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  let col = -1;
  for (let c = 0; c < keys.length; c++) if (String(keys[c] || '') === postId + '#1') { col = c + 1; break; }
  if (col === -1) return false;
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (gas.toDateString(sheet.getRange(r, 1).getValue(), TZ) === dateStr) {
      sheet.getRange(r, col).setValue(text);
      return true;
    }
  }
  return false;
}
/** 直接改長表某一格嘅人名快照（模擬「填講員／翻譯／獻花」寫入嘅自由文字）。 */
function setAssignmentSnapshot(versionNo, dateStr, postId, nameText) {
  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const sheet = ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = function (k) { return headers.indexOf(k) + 1; };
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (String(sheet.getRange(r, col(A.QUARTER_ID)).getValue()) !== Q) continue;
    if (Number(sheet.getRange(r, col(A.VERSION_NO)).getValue()) !== versionNo) continue;
    if (String(sheet.getRange(r, col(A.POST_ID)).getValue()) !== postId) continue;
    if (gas.toDateString(sheet.getRange(r, col(A.SERVICE_DATE)).getValue(), TZ) !== dateStr) continue;
    sheet.getRange(r, col(A.PERSON_NAME_SNAPSHOT)).setValue(nameText);
    return true;
  }
  return false;
}
function whoIsOn(versionNo, dateStr, postId, field) {
  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const row = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && gas.toDateString(r[A.SERVICE_DATE], TZ) === dateStr && r[A.POST_ID] === postId;
  });
  return row ? String(row[field] || '') : '(冇呢一格)';
}

/* ══════════════════════════════════════════════════════════════
 * 敘事
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 前置：生成 v0，講員一格係「待確認」 ===');
{
  const r = gas.apiGenerateDraftExecute(Q);
  check('★★★★ 生成成功', r.ok !== false, JSON.stringify(r).slice(0, 300));
  checkEqual('★★★★ 講員一格冇人（AutoGenerate=FALSE）',
    whoIsOn(0, DATES[0], 'PREACH', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID), '');
}

console.log('\n=== A：填咗一位唔喺 NameMapping 嘅外請講員 ===');
{
  // 模擬「填講員／翻譯／獻花」做嘅嘢：長表寫自由文字（冇 PersonID）、grid 寫同一個字。
  check('（前置）長表寫入自由文字',
    setAssignmentSnapshot(0, DATES[0], 'PREACH', GUEST_PREACHER));
  check('（前置）grid 寫入同一個字', setGridCell(0, DATES[0], 'PREACH', GUEST_PREACHER));
  checkEqual('（前置）確認佢真係冇 PersonID',
    whoIsOn(0, DATES[0], 'PREACH', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID), '');
  checkEqual('（前置）而 grid 上真係有字',
    whoIsOn(0, DATES[0], 'PREACH', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT),
    GUEST_PREACHER);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★ **唔會被判成「有名字認不出」**（呢一條就係上線 blocker：'
    + '任何一季只要幹事填過講員，就永遠撳唔到「儲存並確認」）',
    plan.blockReason !== 'UNRESOLVED_NAMES',
    JSON.stringify({ blocked: plan.blocked, reason: plan.blockReason,
      unresolved: plan.unresolved }).slice(0, 400));
  checkEqual('★★★★★ 亦都唔算人手改動——嗰啲格嘅唯一寫入途徑係'
    + '「填講員／翻譯／獻花」，唔係 grid', (plan.gridChanges || []).length, 0);
  check('★★★★ zeroChange=true（真係一格都冇改）', plan.zeroChange === true,
    JSON.stringify(plan.zeroChange));
}

console.log('\n=== A：改成另一個自由文字，一樣唔算人手改動 ===');
{
  check('（前置）grid 改成另一個名', setGridCell(0, DATES[0], 'PREACH', '另一位客席講員'));
  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★★ 仍然 0 格人手改動（嗰個唔係 grid 嘅職責）',
    (plan.gridChanges || []).length, 0);
  check('★★★★★ 仍然唔會判「認唔出」', plan.blockReason !== 'UNRESOLVED_NAMES',
    String(plan.blockReason));
  // 還原
  setGridCell(0, DATES[0], 'PREACH', GUEST_PREACHER);
}

console.log('\n=== A 對照組：AutoGenerate=TRUE 嘅崗位打錯名，仍然要被擋 ===');
{
  check('（前置）主席一格打一個唔存在嘅名',
    setGridCell(0, DATES[0], 'CHAIR', '完全唔存在嘅人'));
  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★★ **仍然**被擋（豁免唔可以擴大到全部崗位）',
    plan.blockReason, 'UNRESOLVED_NAMES');
  checkEqual('★★★★ 剛好一格', (plan.unresolved || []).length, 1);

  // ── B 組：兩個值都要印，而且唔可以講反 ──
  const u = plan.unresolved[0];
  checkEqual('★★★★★ **`gridText` ＝ 幹事真正打嗰個**'
    + '（修正之前呢個欄位名寫錯咗，永遠 fallback 到空字串，'
    + '結果對話框話你打咗空白，但 grid 上明明有字）',
    u.gridText, '完全唔存在嘅人');
  check('★★★★★ `expectedText` ＝ 本來應該渲染成咩，而且**同 gridText 唔同**'
    + '——兩個值調轉咗嘅話呢一條會紅',
    u.expectedText !== undefined && u.expectedText !== u.gridText,
    JSON.stringify(u));
  check('★★★★ 舊欄位名 rawText 保留，但帶住正確嘅值',
    u.rawText === u.gridText, JSON.stringify(u));
  checkEqual('★★★★ 講得出係邊一日', u.serviceDate, DATES[0]);
  // ⚠️ 順帶：`context.postNames` 喺 `buildFineTuneContext_()` **根本唔存在**
  //（只有寄信嗰個 context 先有），所以本檔案三處嘅三元運算永遠 fallback
  // 到 postId ⇒ 幹事見到 `PREACHER#1` 呢種機器鍵。
  // 現場對話框嗰句 `2027-07-04　PREACHER#1　……` 就係噉嚟。
  checkEqual('★★★★★ 講得出中文崗位名，唔係機器鍵'
    + '（`context.postNames` 唔存在，要由 `context.posts` 譯）',
    u.postNameTC, '主席');

  // 還原
  setGridCell(0, DATES[0], 'CHAIR',
    PEOPLE[whoIsOn(0, DATES[0], 'CHAIR', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID)]);
}

console.log('\n=== A：講員已填 ＋ 一筆可套用申報 ⇒ 成功，講員原封不動 ===');
{
  const before = whoIsOn(0, DATES[2], 'READ', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID);
  const target = Object.keys(PEOPLE).find(function (id) { return id !== before; });
  const R = gas.COLUMNS.REQUESTS;
  appendRows(ss, gas.SHEETS.REQUESTS,
    [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME, R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS], [
      { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: DATES[2], [R.POST_NAME]: '讀經',
        [R.PERSON_NAME]: PEOPLE[target], [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE,
        [R.STATUS]: '' }
    ]);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★ 唔會被擋', plan.blocked !== true, JSON.stringify(plan.blockReason));
  checkEqual('★★★★ 見到 1 筆可套用申報', plan.requests.apply.length, 1);

  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★ 成功建立新版本', result.ok === true && result.versionCreated === true,
    JSON.stringify(result).slice(0, 300));

  const v = gas.findLatestVersionNo(Q);
  checkEqual('★★★★★ 申報生效', whoIsOn(v, DATES[2], 'READ',
    gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID), target);
  checkEqual('★★★★★ **講員嗰格原封不動**（自由文字跟住新版本帶落去，冇被清走）',
    whoIsOn(v, DATES[0], 'PREACH', gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT),
    GUEST_PREACHER);
}

console.log('\n=== C：上限唔再當成目標值 ===');
{
  // 直接測純判斷，唔使砌一個「上限啱啱好 100%」嘅完整季度。
  const chairEq = { same: 3, weeks: 13, ratio: 3 / 13, target: 0.63, tolerance: 0.05 };

  const refCeil = {
    baseline: 0.63, tolerance: 0.05, hasCeiling: true,
    ceiling: { applicable: true, boundRatio: 1.0, bound: 13, weeksBothPosts: 13, dualCount: 9 },
    reference: 1.0, deviates: false, exceedsCeiling: false
  };
  const desc = gas.describeChairEqReference_(refCeil, chairEq);

  checkEqual('★★★★★ 三行：實測／歷史基準／本季理論上限', desc.lines.length, 3);
  check('★★★★★ 實測嗰行有對數同百分比',
    /^實測：23\.1%（3\/13 週）$/.test(desc.lines[0]), desc.lines[0]);
  check('★★★★★ 歷史基準嗰行明講「在還沒有身分規則的年代……只供參考」'
    + '——唔講嘅話幹事會以為佢仍然係目標',
    desc.lines[1].indexOf('只供參考') !== -1
    && desc.lines[1].indexOf('還沒有身分規則') !== -1, desc.lines[1]);
  check('★★★★★ 上限嗰行明講「偏鬆的上界，實際通常達不到，**不是目標**」'
    + '——函式自己嘅假設清單一直都噉寫，只係之前冇人照住做',
    desc.lines[2].indexOf('不是目標') !== -1
    && desc.lines[2].indexOf('偏鬆的上界') !== -1, desc.lines[2]);
  check('★★★★★ 冇「± 5.0%」——容差係目標值先有意義，冇目標就唔應該有容差',
    desc.text.indexOf('±') === -1, desc.text);
  check('★★★★★ 冇「偏低」「偏離」', !/偏低|偏離/.test(desc.text), desc.text);
  checkEqual('★★★★★ 實測 < 上限 ⇒ 唔亮燈（deviates=false）', refCeil.deviates, false);
  checkEqual('★★★★ 亦都冇 alert', desc.alert, '');
}

console.log('\n=== C：唯一會亮燈嘅情況——實測 > 上限 ===');
{
  const chairEq = { same: 12, weeks: 13, ratio: 12 / 13, target: 0.63, tolerance: 0.05 };
  const ref = {
    baseline: 0.63, tolerance: 0.05, hasCeiling: true,
    ceiling: { applicable: true, boundRatio: 0.5, bound: 6, weeksBothPosts: 13, dualCount: 3 },
    reference: 0.5, deviates: true, exceedsCeiling: true
  };
  const desc = gas.describeChairEqReference_(ref, chairEq);
  check('★★★★★ 有 alert', desc.alert !== '', desc.alert);
  check('★★★★★ 而且直接叫幹事去睇連續兩週嘅明細（有行動意義嘅訊號）',
    desc.alert.indexOf('連續兩週') !== -1, desc.alert);
  check('★★★★ 提到嗰條準硬規則嘅 ID',
    desc.alert.indexOf(gas.RULE_IDS.NO_CONSECUTIVE) !== -1, desc.alert);
}

console.log('\n=== C：算唔到上限嗰陣 ===');
{
  const chairEq = { same: 3, weeks: 13, ratio: 3 / 13, target: 0.63, tolerance: 0.05 };
  const ref = { baseline: 0.63, tolerance: 0.05, hasCeiling: false, ceiling: null,
    reference: 0.63, deviates: false, exceedsCeiling: false };
  const desc = gas.describeChairEqReference_(ref, chairEq);
  check('★★★★★ 上限嗰行講「（算不出）」，唔會靜靜咁唔出現',
    desc.lines[2].indexOf('（算不出）') !== -1, desc.lines[2]);
  check('★★★★ 仍然係三行', desc.lines.length === 3);
  check('★★★★★ 仍然唔判偏離', !/偏低|偏離/.test(desc.text), desc.text);
}

console.log('\n=== D：兩個工具用同一份文字（防止第三次分叉）===');
{
  const fs = require('fs');
  const path = require('path');
  const read = function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); };

  const verify = read('Verify.gs');
  const metrics = read('SoftRuleMetrics.gs');
  check('★★★★★ Verify.gs（核對職事表）叫 describeChairEqReference_()',
    /describeChairEqReference_\(ref, chairEq\)/.test(verify));
  check('★★★★★ SoftRuleMetrics.gs（軟規則實測量度）都係叫同一個',
    /describeChairEqReference_\(m\.chairEqRef, m\.chairEq\)/.test(metrics));

  const bareMetrics = metrics.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 「軟規則實測量度」唔再自己砌「（歷史基準 X）＋ 判斷」嗰句'
    + '——嗰句就係現場同「核對職事表」對唔上嗰句',
    !/主席兼報告：[\s\S]{0,80}歷史基準[\s\S]{0,60}chairEqJudgement/.test(bareMetrics));
  check('★★★★★ chairEqJudgement 唔再被攞去判偏離（設成 null）',
    /chairEqJudgement: null/.test(metrics));

  // 同一份輸入，兩個工具攞到嘅文字**逐字相同**。
  const chairEq = { same: 3, weeks: 13, ratio: 3 / 13, target: 0.63, tolerance: 0.05 };
  const ref = { baseline: 0.63, tolerance: 0.05, hasCeiling: true,
    ceiling: { applicable: true, boundRatio: 1.0, bound: 13, weeksBothPosts: 13, dualCount: 9 },
    reference: 1.0, deviates: false, exceedsCeiling: false };
  const a = gas.describeChairEqReference_(ref, chairEq).text;
  const b = gas.describeChairEqReference_(ref, chairEq).text;
  checkEqual('★★★★★ 同一份輸入 ⇒ 逐字相同（措辭只有一份，唔可能分叉）', a, b);
  check('★★★★ 而且真係有內容', a.length > 20, a);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
