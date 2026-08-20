// 第三十四輪批次甲組：「儲存並確認」五項，由真入口叫落去。
// 執行方式：node tests/save_confirm_requests_applied.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 2026-08-20 實測揭出嘅五項（全部喺同一條執行路徑）
// ═════════════════════════════════════════════════════════════════════
//
// 甲1　0 格人手改動 ＋ 有申報 ⇒ 直接拋錯。
//      「幹事只填申報、完全唔碰 grid」係日常最常見嘅用法，而呢條路從來冇實作過。
//
// 甲2　有 grid 改動 ＋ 有申報 ⇒ 版本建立成功、Stage 前進、公開連結重發，
//      但**申報完全冇被套用**（RequestID／Status 仍然空白、AuditLog 冇紀錄），
//      而版本備註同確認畫面都寫住「申報 1 筆」。⚠️ 靜默失敗。
//
// 甲3　因此形成死鎖：掣 3 嘅閘門擋住未處理申報，但撳掣 1 永遠處理唔完。
//
// 甲4　失敗訊息把「一個字都冇寫入」講成「可能只寫入了一部分」。
//
// 甲5　新版本嘅格子分類整個遺失（`ruleFlags` 被寫死空陣列）⇒
//      PDF 圖例把 79 格冇派人嘅格全部報成「系統未能安排」，而事實係 0 格。
//
// ⚠️ 全部由真入口 `apiSaveAndConfirmPlan` / `apiSaveAndConfirmExecute` 叫落去，
// 用 `tests/helpers/mock_sheets_realistic.js`，**唔 stub**
// `buildFineTuneContext_()`／`resolveAuthoritativeState_()`／`createRosterSheet()`
// ——嗰三個正正就係出事嗰條路。

const { loadGasSource } = require('./helpers/gas_loader');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./helpers/mock_sheets_realistic');
const { countVersionCellClasses, diffVersionRuleFlags } = require('./helpers/version_cell_classes');

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

const Q = '2027T3';
const TZ = 'Pacific/Auckland';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'jia-test@example.invalid'; } }; } };
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
    if (fmt === 'M/d' || fmt === 'MM/dd' || fmt === 'dd/MM') {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date).split('-');
      return fmt === 'dd/MM' ? (Number(p[2]) + '/' + Number(p[1])) : (Number(p[1]) + '/' + Number(p[2]));
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

gas.buildSeedNote_ = function (r) {
  return 'seed=' + r.seed + '　第 ' + r.attemptIndex + ' / ' + r.attemptsRun + ' 次';
};
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return null; };
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture
 *
 * 6 個主日 × 3 個崗位 = 18 格。刻意砌成三種「冇派人」都有：
 *   CHAIR　　正常自動排
 *   PREACH　 AutoGenerate=FALSE ⇒ 全部 6 格「待確認」（MANUAL_PENDING）
 *   COMMUNE　第 1 個主日聖餐 ⇒ 嗰格 STRUCTURAL_NA
 * 噉先驗得到「分類冇壞」，而唔係全部倒入同一個桶。
 * ══════════════════════════════════════════════════════════════ */

const PEOPLE = {
  P9301: { nameTC: '測試甲01' },
  P9302: { nameTC: '測試甲02' },
  P9303: { nameTC: '測試甲03' },
  P9304: { nameTC: '測試甲04' }
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
        [C.QUARTERS.START_DATE]: '2027-07-04', [C.QUARTERS.END_DATE]: '2027-08-08',
        [C.QUARTERS.STAGE]: 'DRAFT' }
    ]);

  for (let i = 0; i < 6; i++) {
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
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY], [
      { [C.POSTS.POST_ID]: 'CHAIR', [C.POSTS.POST_NAME_TC]: '主席', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' },
      { [C.POSTS.POST_ID]: 'READ', [C.POSTS.POST_NAME_TC]: '讀經', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 2, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' },
      // ⚠️ AutoGenerate=FALSE ⇒ 系統唔會排，格子應該分類成「待確認」
      //（MANUAL_PENDING），唔係「系統未能安排」。甲5 就係呢個分別。
      { [C.POSTS.POST_ID]: 'PREACH', [C.POSTS.POST_NAME_TC]: '講員', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: false, [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 3, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' }
    ]);

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id].nameTC,
        [C.NAME_MAPPING.EMAIL]: id.toLowerCase() + '@example.invalid', [C.NAME_MAPPING.ACTIVE]: true };
    }));

  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    elig.push(['CHAIR', id]);
    elig.push(['READ', id]);
  });
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
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
      // ⚠️ 呢兩條**一定要開**，否則 `getSkipReason_()`（Generator.gs）唔會
      // 標 `ruleFlags`，而冇 flag 嘅話 `classifyGridCell_()` 本來就分唔出
      // 「待確認」同「系統未能安排」——即係連 v0 呢個基準線都會係錯嘅，
      // 後面全部比較都變成冇意思。實測嗰個環境兩條都係開住嘅。
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_NO_AUTO_PREACHER', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_COMMUNION_FIRST_SUNDAY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
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

/** 加一筆申報落 Requests（RequestID 留空 ＝ 未處理）。 */
function addRequest(dateStr, postNameTC, personNameTC, type) {
  const R = gas.COLUMNS.REQUESTS;
  appendRows(ss, gas.SHEETS.REQUESTS,
    [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME, R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS], [
      { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: dateStr, [R.POST_NAME]: postNameTC,
        [R.PERSON_NAME]: personNameTC, [R.REQUEST_TYPE]: type, [R.STATUS]: '' }
    ]);
}

/** 讀 Requests 全部行（含 RequestID／Status）。 */
function readRequests() {
  return gas.readSheet(gas.SHEETS.REQUESTS).filter(function (r) {
    return r[gas.COLUMNS.REQUESTS.QUARTER_ID] === Q;
  });
}

/** 某一版某一格而家係邊個。 */
function whoIsOn(versionNo, dateStr, postId) {
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const row = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[C.QUARTER_ID] === Q && Number(r[C.VERSION_NO]) === versionNo
      && gas.toDateString(r[C.SERVICE_DATE], TZ) === dateStr && r[C.POST_ID] === postId;
  });
  return row ? String(row[C.PERSON_ID] || '') : '(冇呢一格)';
}

/** 喺真 grid 工作表改一格。 */
function editGridCell(versionNo, dateStr, postId, slotIndex, text) {
  const sheet = ss.getSheetByName(gas.buildRosterSheetName_(Q, versionNo));
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const wanted = postId + '#' + slotIndex;
  let col = -1;
  for (let c = 0; c < keys.length; c++) if (String(keys[c] || '') === wanted) { col = c + 1; break; }
  if (col === -1) return false;
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (gas.toDateString(sheet.getRange(r, 1).getValue(), TZ) === dateStr) {
      sheet.getRange(r, col).setValue(text);
      return true;
    }
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
 * 敘事
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 前置：生成 v0，而且分類本身係啱嘅 ===');
{
  const r = gas.apiGenerateDraftExecute(Q);
  check('★★★★ 生成成功', r.ok !== false, JSON.stringify(r).slice(0, 300));

  const c = countVersionCellClasses(gas, Q, 0);
  checkEqual('★★★★★ v0 總格數 18（6 主日 × 3 崗位）', c.total, 18);
  checkEqual('★★★★★ 「講員」6 格全部係「待確認」（AutoGenerate=FALSE，唔係系統排唔到）',
    c.manualPending, 6);
  checkEqual('★★★★★ v0 「系統未能安排」＝ 0（AUTO 版本本來就係啱嘅，'
    + '呢一條係基準線——如果連呢度都唔係 0，後面全部比較都冇意思）',
    c.genuineGap, 0);
  checkEqual('★★★★ 四個桶加起嚟等於總格數',
    c.assigned + c.manualPending + c.structuralNa + c.specialSkip + c.genuineGap, c.total);
}

console.log('\n=== 甲1：0 格人手改動 ＋ 1 筆可套用申報 ⇒ 要成功，唔可以拋錯 ===');
{
  // 「幹事只填申報、完全唔碰 grid」——日常最常見嘅用法。
  const target = whoIsOn(0, DATES[2], 'READ');
  const newPerson = Object.keys(PEOPLE).find(function (id) { return id !== target; });
  addRequest(DATES[2], '讀經', PEOPLE[newPerson].nameTC, gas.REQUEST_TYPE.DESIGNATED_SERVE);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★ plan 唔會 blocked', plan.blocked !== true, JSON.stringify(plan).slice(0, 300));
  checkEqual('★★★★★ plan 見到 0 格人手改動', plan.gridChanges.length, 0);
  checkEqual('★★★★★ plan 見到 1 筆可套用申報', plan.requests.apply.length, 1);
  check('★★★★ 唔係 zeroChange（有申報就唔係「乜都冇改」）', plan.zeroChange !== true);

  let result = null;
  let threw = '';
  try {
    result = gas.apiSaveAndConfirmExecute(Q, { decisions: plan.gridChanges, confirmedRequestRows: [] });
  } catch (err) {
    threw = err.message;
  }
  check('★★★★★ **唔會拋錯**（修正之前呢度就係 materialiseManualEdits_() '
    + '嘅空守衛拋「沒有收到任何人手改動」）', threw === '', threw);
  check('★★★★★ 真正建立咗新版本', result && result.ok === true && result.versionCreated === true,
    JSON.stringify(result).slice(0, 400));

  checkEqual('★★★★★ 建立咗 v1', gas.findLatestVersionNo(Q), 1);
  checkEqual('★★★★★ **申報真正生效**：' + DATES[2] + ' 讀經而家係 ' + newPerson
    + '（修正之前三張表都仍然係原本嗰個）', whoIsOn(1, DATES[2], 'READ'), newPerson);

  // 甲2：Requests 要被回寫。
  const reqs = readRequests();
  checkEqual('★★★★ Requests 有 1 行', reqs.length, 1);
  check('★★★★★ **RequestID 被寫回**（修正之前永遠空白 ⇒ 幹事以為處理咗，其實冇）',
    String(reqs[0][gas.COLUMNS.REQUESTS.REQUEST_ID] || '').trim() !== '',
    JSON.stringify(reqs[0]));
  check('★★★★★ Status 被寫回', String(reqs[0][gas.COLUMNS.REQUESTS.STATUS] || '').trim() !== '',
    String(reqs[0][gas.COLUMNS.REQUESTS.STATUS]));
  checkEqual('★★★★ 回報嘅 appliedRequestCount 由真正套用結果出，唔係由 plan 出',
    result.appliedRequestCount, 1);
}

console.log('\n=== 甲5：新版本嘅格子分類冇壞（呢一條係共用斷言）===');
{
  const c = countVersionCellClasses(gas, Q, 1);
  checkEqual('★★★★★ v1 總格數仍然 18', c.total, 18);
  checkEqual('★★★★★ 「待確認」仍然係 6 格（修正之前變 0）', c.manualPending, 6);
  checkEqual('★★★★★ **「系統未能安排」＝ 0**（修正之前 = 全部冇派人嘅格）',
    c.genuineGap, 0);
  checkEqual('★★★★ 四個桶加起嚟等於總格數',
    c.assigned + c.manualPending + c.structuralNa + c.specialSkip + c.genuineGap, c.total);

  const diffs = diffVersionRuleFlags(gas, Q, 0, 1, []);
  checkEqual('★★★★★ v1 逐格 ruleFlags 同 v0 一模一樣'
    + '（申報只改人，唔應該動到任何一格嘅跳過原因）', diffs, []);
}

console.log('\n=== 甲2：1 格人手改動 ＋ 1 筆申報（不同格）⇒ 兩者都要生效 ===');
{
  const chairBefore = whoIsOn(1, DATES[0], 'CHAIR');
  const chairNew = Object.keys(PEOPLE).find(function (id) { return id !== chairBefore; });
  check('（前置）grid 改一格成功',
    editGridCell(1, DATES[0], 'CHAIR', 1, PEOPLE[chairNew].nameTC));

  const readBefore = whoIsOn(1, DATES[4], 'READ');
  const readNew = Object.keys(PEOPLE).find(function (id) { return id !== readBefore; });
  addRequest(DATES[4], '讀經', PEOPLE[readNew].nameTC, gas.REQUEST_TYPE.DESIGNATED_SERVE);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★ plan 見到 1 格人手改動', plan.gridChanges.length, 1);
  checkEqual('★★★★ plan 見到 1 筆可套用申報', plan.requests.apply.length, 1);

  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: plan.gridChanges, confirmedRequestRows: [] });
  check('★★★★ 成功', result.ok === true, JSON.stringify(result).slice(0, 300));

  checkEqual('★★★★★ 人手改動生效：' + DATES[0] + ' 主席 → ' + chairNew,
    whoIsOn(2, DATES[0], 'CHAIR'), chairNew);
  checkEqual('★★★★★ **申報同時生效**：' + DATES[4] + ' 讀經 → ' + readNew
    + '（修正之前呢一格永遠唔會變）', whoIsOn(2, DATES[4], 'READ'), readNew);

  const c = countVersionCellClasses(gas, Q, 2);
  checkEqual('★★★★★ v2 分類仍然啱：待確認 6', c.manualPending, 6);
  checkEqual('★★★★★ v2 「系統未能安排」＝ 0', c.genuineGap, 0);

  const exempt = [DATES[0] + '|CHAIR|1'];
  checkEqual('★★★★★ 除咗被人手改嗰一格，其餘逐格 ruleFlags 一模一樣',
    diffVersionRuleFlags(gas, Q, 1, 2, exempt), []);
}

console.log('\n=== 甲2：1 格人手改動 ＋ 1 筆申報（同一格）⇒ grid 贏 ===');
{
  const before = whoIsOn(2, DATES[1], 'CHAIR');
  const gridWants = Object.keys(PEOPLE).find(function (id) { return id !== before; });
  const requestWants = Object.keys(PEOPLE).find(function (id) {
    return id !== before && id !== gridWants;
  });
  check('（前置）搵到兩個唔同嘅人做「grid 想要」同「申報想要」',
    !!gridWants && !!requestWants && gridWants !== requestWants,
    'grid=' + gridWants + ' request=' + requestWants);

  check('（前置）grid 改一格成功',
    editGridCell(2, DATES[1], 'CHAIR', 1, PEOPLE[gridWants].nameTC));
  addRequest(DATES[1], '主席', PEOPLE[requestWants].nameTC, gas.REQUEST_TYPE.DESIGNATED_SERVE);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★★ plan 講得出呢一格有衝突（overlaps 唔係空）',
    plan.overlaps.length >= 1, JSON.stringify(plan.overlaps));
  if (plan.overlaps.length >= 1) {
    const o = plan.overlaps[0];
    checkEqual('★★★★ overlap 講得出係邊一日', o.serviceDate, DATES[1]);
    check('★★★★★ overlap 同時講得出「申報想要邊個」同「grid 而家係邊個」'
      + '——幹事要睇得出佢親手改嗰個會蓋過申報',
      String(o.requestWants || '').indexOf(PEOPLE[requestWants].nameTC) !== -1
        && String(o.gridHas || '').indexOf(PEOPLE[gridWants].nameTC) !== -1,
      JSON.stringify(o));
  }

  const overriddenRow = plan.overlaps.length >= 1 ? plan.overlaps[0].sheetRow : null;
  gas.apiSaveAndConfirmExecute(Q, { decisions: plan.gridChanges, confirmedRequestRows: [] });
  checkEqual('★★★★★ **grid 贏**（規格 1.4：幹事親手改嗰個係最新真相）',
    whoIsOn(3, DATES[1], 'CHAIR'), gridWants);

  // ⚠️ 被蓋過嗰筆申報唔可以靜靜消失——義工提交咗嘢，佢要喺 Requests
  // 見得到「點解冇跟到」。
  const R = gas.COLUMNS.REQUESTS;
  const overridden = readRequests().find(function (r) { return r.__sheetRow === overriddenRow; })
    || readRequests().filter(function (r) {
      return gas.toDateString(r[R.SERVICE_DATE], TZ) === DATES[1] && r[R.POST_NAME] === '主席';
    })[0];
  check('（前置）搵返被蓋過嗰一行', !!overridden, String(overriddenRow));
  if (overridden) {
    check('★★★★★ 被 grid 蓋過嗰筆申報有 RequestID（已處理，唔會永遠掛住）',
      String(overridden[R.REQUEST_ID] || '').trim() !== '', JSON.stringify(overridden));
    check('★★★★★ 而且處理結果明講「以你改的為準，這一筆沒有套用」'
      + '——義工提交咗嘢，唔可以無聲無息消失',
      String(overridden[R.RESULT_NOTE] || '').indexOf('以你改的為準') !== -1,
      String(overridden[R.RESULT_NOTE] || '') + ' / ' + String(overridden[R.STATUS] || ''));
  }
}

console.log('\n=== 甲3：只剩 NEEDS_INPUT 申報 ⇒ 唔可以令「正式發出」永遠鎖死 ===');
{
  // 一筆系統睇唔明嘅申報：日期根本唔喺呢一季。
  addRequest('2099-01-03', '主席', PEOPLE.P9301.nameTC, gas.REQUEST_TYPE.DESIGNATED_SERVE);

  const plan = gas.apiSaveAndConfirmPlan(Q);
  check('★★★★ plan 認得出佢係 NEEDS_INPUT', plan.requests.needsInput.length >= 1,
    JSON.stringify(plan.requests));
  checkEqual('★★★★ 冇任何可套用申報', plan.requests.apply.length, 0);

  const versionNo = gas.findLatestVersionNo(Q);
  const unsaved = gas.readDashboardUnsavedState_(Q, versionNo);
  checkEqual('★★★★★ **pendingRequestCount ＝ 0**——NEEDS_INPUT 唔算「未處理」，'
    + '佢永遠唔會自動改動職事表，擋住佢冇保護到任何嘢，只會令幹事無路可走',
    unsaved.pendingRequestCount, 0);
  checkEqual('★★★★★ 但佢**冇消失**：needsInputCount 獨立數得出',
    unsaved.needsInputCount, 1);
  check('★★★★★ hasAny ＝ false ⇒ 「正式發出」嘅閘門唔會再永遠鎖死',
    unsaved.hasAny === false, JSON.stringify(unsaved));

  const text = gas.buildSaveButtonText_({ unsaved: unsaved, stage: gas.QUARTER_STAGE.DRAFT });
  check('★★★★★ 掣 1 嘅文字仍然講得出「有 1 筆申報系統看不懂」'
    + '——唔可以靜靜消失（嗰個就係另一個「缺失被當成正常值」）',
    text.indexOf('看不懂') !== -1 && text.indexOf('1') !== -1, text);
  check('★★★★ 而且明講佢唔會擋住正式發出', text.indexOf('不會擋住') !== -1, text);
}

console.log('\n=== 甲1：0 格 ＋ 0 筆 ⇒ zeroChange 路徑，行為不變 ===');
{
  // 把嗰筆 NEEDS_INPUT 刪走（模擬幹事處理咗）。
  const reqSheet = ss.getSheetByName(gas.SHEETS.REQUESTS);
  const headers = reqSheet.getRange(2, 1, 1, reqSheet.getLastColumn()).getValues()[0];
  const dateCol = headers.indexOf(gas.COLUMNS.REQUESTS.SERVICE_DATE) + 1;
  for (let r = 3; r <= reqSheet.getLastRow(); r++) {
    if (gas.toDateString(reqSheet.getRange(r, dateCol).getValue(), TZ) === '2099-01-03') {
      [gas.COLUMNS.REQUESTS.SERVICE_DATE, gas.COLUMNS.REQUESTS.POST_NAME,
        gas.COLUMNS.REQUESTS.PERSON_NAME, gas.COLUMNS.REQUESTS.REQUEST_TYPE].forEach(function (k) {
        reqSheet.getRange(r, headers.indexOf(k) + 1).setValue('');
      });
    }
  }

  const plan = gas.apiSaveAndConfirmPlan(Q);
  checkEqual('★★★★ 0 格人手改動', plan.gridChanges.length, 0);
  checkEqual('★★★★ 0 筆待處理申報', plan.requests.apply.length + plan.requests.needsInput.length, 0);
  check('★★★★★ zeroChange ＝ true（現有行為不變）', plan.zeroChange === true);

  const before = gas.findLatestVersionNo(Q);
  const result = gas.apiSaveAndConfirmExecute(Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★ 成功而且冇建立版本', result.ok === true && result.versionCreated === false,
    JSON.stringify(result).slice(0, 300));
  checkEqual('★★★★ 版本號冇變', gas.findLatestVersionNo(Q), before);
}

console.log('\n=== 甲4：失敗文案要分「一個字都冇寫」同「寫到一半」 ===');
{
  const base = gas.findLatestVersionNo(Q);

  // 情況一：乾淨失敗（版本未建立）。
  const clean = gas.buildSaveConfirmFailureResult_(Q, base, new Error('測試用：建立版本之前就失敗'));
  check('★★★★★ 乾淨失敗要明講「沒有任何東西被寫入」',
    clean.message.indexOf('沒有任何東西被寫入') !== -1, clean.message);
  check('★★★★★ 而且叫人直接再試，唔叫人去回退'
    + '（回退本身會建立新版本——一句嚇人嘅文案會製造一個真正多餘嘅版本）',
    clean.message.indexOf('直接再撳一次') !== -1
      && clean.message.indexOf('回到上一個版本') === -1, clean.message);
  checkEqual('★★★★ partialWrite ＝ false', clean.partialWrite, false);

  // 情況二：真係寫到一半（假裝下一版嘅 grid 工作表已經建立咗）。
  ss.insertSheet(gas.buildRosterSheetName_(Q, base + 1));
  const partial = gas.buildSaveConfirmFailureResult_(Q, base, new Error('測試用：寫到一半'));
  check('★★★★★ 偵測到 grid 工作表已經存在 ⇒ 講「可能只寫入了一部分」',
    partial.message.indexOf('只寫入了一部分') !== -1, partial.message);
  check('★★★★ 而且指出核對同回退嘅路',
    partial.message.indexOf('檢查各版本派工紀錄') !== -1
      && partial.message.indexOf('回到上一個版本') !== -1, partial.message);
  checkEqual('★★★★ partialWrite ＝ true', partial.partialWrite, true);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
