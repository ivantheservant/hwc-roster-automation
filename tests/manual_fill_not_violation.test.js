// 第六十三輪批次 K 組：人手填嘅講員／翻譯／獻花，唔係「違反規則」。
// 執行方式：node tests/manual_fill_not_violation.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 瀏覽器實測，`2028T2` v0）
// ═════════════════════════════════════════════════════════════════════
//
// 經幹事介面「填講員／翻譯／獻花」填咗 3 格獻花。人名喺 `NameMapping`，
// 所以 `apiSavePreacherTranslationEntry()` 連結咗 PersonID。之後撳
// 「儲存」，確認畫面列出：
//
//   ⚠ 違反了一定要遵守的規則：3 格
//   4 月 2 日　FLOWER——這個崗位不由系統排，要你自己填
//
// 要打字「確認」先儲存得到——而且之後**每一次**儲存、套用申報都要。
// 幹事正正就係自己填咗，系統反而話佢違反「要你自己填」。
//
// 成因：`findStateViolations_()` 對 `AutoGenerate = FALSE` 嘅崗位
// **凡有 PersonID 就報**，唔理係邊個放落去。
//
// ⚠️ 呢份測試嘅 fixture 一律由真入口產生（第三十八輪 B 組）：
// 職事表由 `apiGenerateDraftExecute()` 生成，獻花由
// `apiSavePreacherTranslationEntry()` 填。

const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./helpers/mock_sheets_realistic.js');
const fs = require('fs');
const path = require('path');

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
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs'
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
const A = C.ROSTER_ASSIGNMENTS;
const Q = '2099T1';
const DATES = [];
const PEOPLE = { P9701: '假獻甲', P9702: '假獻乙', P9703: '假獻丙' };

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = {
  getActiveSpreadsheet: function () { return ss; },
  newDataValidation: function () {
    const rec = {};
    const self = {
      requireValueInList: function (l) { rec.list = l; return self; },
      setAllowInvalid: function () { return self; },
      setHelpText: function () { return self; },
      build: function () { return rec; }
    };
    return self;
  },
  ProtectionType: { SHEET: 'SHEET' }
};
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'k@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    if (fmt === 'yyyy-MM-dd') return d;
    return d + ' 09:00:00';
  },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.buildSeedNote_ = function (r) { return 'seed=' + r.seed; };
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };
gas.findPublicLinkRow_ = function () { return { fileUrl: 'https://example.invalid/p' }; };
gas.nowTimestamp_ = function () { return '2099-01-01 09:00:00'; };
gas.applyTimestampFormat_ = function () {};
gas.writeToPossiblyProtectedGridSheet_ = function (sheet, fn) { fn(); return false; };

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
  [['CHAIR', '主席', true], ['READ', '讀經', true], ['FLOWER', '獻花', false]]
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
  // ⚠️ 獻花嘅資格**特登**畀晒三個人——令「唯一可能嘅違反」就係 NO_AUTO_GENERATE，
  // 測到嘅先至係呢條規則本身。
  const elig = [];
  Object.keys(PEOPLE).forEach(function (id) {
    elig.push(['CHAIR', id]); elig.push(['READ', id]); elig.push(['FLOWER', id]);
  });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  elig.map(function (p, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0],
      [C.ELIGIBILITY.PERSON_ID]: p[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
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
})();

function flowerRow(versionNo, dateStr) {
  return gas.readSheet_(S.ROSTER_ASSIGNMENTS).find(function (r) {
    return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo
      && gas.toDateString_(r[A.SERVICE_DATE], TZ) === dateStr && r[A.POST_ID] === 'FLOWER';
  });
}
/** 直接改長表某一格嘅 AssignSource——模擬「生成器錯誤地自己排咗」。 */
function setFlowerSource(versionNo, dateStr, source) {
  const sheet = ss.getSheetByName(S.ROSTER_ASSIGNMENTS);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = function (k) { return headers.indexOf(k) + 1; };
  for (let r = 3; r <= sheet.getLastRow(); r++) {
    if (String(sheet.getRange(r, col(A.QUARTER_ID)).getValue()) !== Q) continue;
    if (Number(sheet.getRange(r, col(A.VERSION_NO)).getValue()) !== versionNo) continue;
    if (String(sheet.getRange(r, col(A.POST_ID)).getValue()) !== 'FLOWER') continue;
    if (gas.toDateString_(sheet.getRange(r, col(A.SERVICE_DATE)).getValue(), TZ) !== dateStr) continue;
    sheet.getRange(r, col(A.ASSIGN_SOURCE)).setValue(source);
    return true;
  }
  return false;
}
const noAutoOf = function (list) {
  return (list || []).filter(function (v) { return v.ruleId === gas.RULE_IDS.NO_AUTO_GENERATE; });
};

// =====================================================================
console.log('\n=== 前置：用真入口生成，再用真入口填一格獻花（名單上嘅人）===');
{
  check('（前置）生成成功', gas.apiGenerateDraftExecute(Q) !== undefined);
  gas.apiSavePreacherTranslationEntry(Q, DATES[0], 'FLOWER', 1, PEOPLE.P9701);
  const row = flowerRow(0, DATES[0]);
  check('（前置）長表連結咗 PersonID（即係現場嗰種：人名喺 NameMapping）',
    row && row[A.PERSON_ID] === 'P9701', JSON.stringify(row));
  check('（前置）AssignSource 係 MANUAL', row && row[A.ASSIGN_SOURCE] === 'MANUAL',
    JSON.stringify(row));
}

console.log('\n=== K【核心】儲存確認：人手填嘅獻花唔係違反 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(Q);
  const all = [].concat(plan.violations.real, plan.violations.released,
    plan.violations.structural, plan.violations.semiHard);
  check('★★★★★★ 確認畫面**冇**列出「這個崗位不由系統排，要你自己填」'
    + '——幹事正正就係自己填咗', noAutoOf(all).length === 0, JSON.stringify(noAutoOf(all)));
  check('★★★★★ 唔使打字放行（needsRelease = false）'
    + '——否則之後每一次儲存都要放行，放行變成日常噪音',
    plan.needsRelease === false, JSON.stringify(plan.violations.real).slice(0, 400));
}

console.log('\n=== K：重跑規則檢查嘅其他入口一樣唔報 ===');
{
  const context = gas.buildFineTuneContext_(Q, 0);
  const record = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.VERSION_OF_RECORD, 'k-test').state;
  check('★★★★★ 已定案版本（寄出／回退預覽嗰種）冇 NO_AUTO_GENERATE',
    noAutoOf(gas.findStateViolations_(record, context)).length === 0);
  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'k-test').state;
  check('★★★★★ grid 疊加（儲存／套用申報嗰種）冇 NO_AUTO_GENERATE',
    noAutoOf(gas.findStateViolations_(overlay, context)).length === 0);
  check('★★★★ 已定案版本嘅狀態帶住 assignSource（唔帶就要靠上一版估）',
    record.some(function (s) { return s.postId === 'FLOWER' && s.assignSource === 'MANUAL'; }));

  const verify = gas.checkHardRuleViolations_(gas.buildVerifyContext_(Q, 0));
  const g = verify.groups.filter(function (x) { return /AutoGenerate=FALSE/.test(x.label); })[0];
  check('★★★★★ 「核對職事表」都唔報（Verify.gs 同一支判斷）',
    g && g.items.length === 0, JSON.stringify(g));
}

console.log('\n=== K 對照組：系統自己排咗 ⇒ 照樣報 ===');
{
  const context = gas.buildFineTuneContext_(Q, 0);
  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'k-test').state;
  const key = gas.cellKey_(DATES[0], 'FLOWER', 1);

  // 搵替補／提案：系統試放一個人落去 ⇒ 系統揀嘅人
  const trial = gas.substituteCell_(overlay, key, 'P9702');
  const trialHits = noAutoOf(gas.findStateViolations_(trial, context));
  check('★★★★★★ 系統試放嘅人（搵替補）⇒ **照報**'
    + '——唔報嘅話系統會自己建議一個講員',
    trialHits.length === 1 && trialHits[0].personId === 'P9702', JSON.stringify(trialHits));
  check('★★★★ substituteCell_ 寫明係 FINE_TUNED',
    trial.filter(function (s) { return gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === key; })[0]
      .assignSource === 'FINE_TUNED');

  // 換咗人但冇講來源 ⇒ 唔可以搬上一版嘅 MANUAL
  const swapped = overlay.map(function (s) {
    if (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) !== key) return s;
    return { serviceDateId: s.serviceDateId, serviceDate: s.serviceDate, postId: s.postId,
      slotIndex: s.slotIndex, personId: 'P9703', isManual: false };
  });
  check('★★★★★ 換咗人而又冇講來源 ⇒ 當系統排（唔可以搬上一版嗰個 MANUAL）',
    noAutoOf(gas.findStateViolations_(swapped, context)).length === 1);

  // 生成器錯誤地 AUTO 排咗
  check('（前置）把獻花嗰格嘅來源改成 AUTO', setFlowerSource(0, DATES[0], 'AUTO'));
  const ctx2 = gas.buildFineTuneContext_(Q, 0);
  const rec2 = gas.resolveAuthoritativeState_(ctx2, gas.STATE_SOURCE.VERSION_OF_RECORD, 'k').state;
  check('★★★★★★ 生成器錯誤地 AUTO 排咗獻花 ⇒ **照樣報**',
    noAutoOf(gas.findStateViolations_(rec2, ctx2)).length === 1);
  const plan = gas.apiSaveAndConfirmPlan(Q);
  // 第七十五輪批次 CF／CG 組：打字放行換成逐格勾選（needsDecision）
  check('★★★★★ 而且儲存確認要決定（勾「保留我的安排」＝放行）', plan.needsDecision === true
    && noAutoOf(plan.violations.real).length === 1, JSON.stringify(plan.violations.real).slice(0, 300));
  const verify = gas.checkHardRuleViolations_(gas.buildVerifyContext_(Q, 0));
  const g = verify.groups.filter(function (x) { return /AutoGenerate=FALSE/.test(x.label); })[0];
  check('★★★★★ 「核對職事表」都報', g && g.items.length === 1, JSON.stringify(g));
  setFlowerSource(0, DATES[0], 'MANUAL');
}

console.log('\n=== K：申報指定嘅人（套用申報）一樣唔算違反 ===');
{
  const R = C.REQUESTS;
  appendRows(ss, S.REQUESTS, Object.keys(R).map(function (k) { return R[k]; }), [
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: DATES[1], [R.POST_NAME]: '獻花',
      [R.PERSON_NAME]: PEOPLE.P9702, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE }]);
  const plan = gas.planApplyRequests_(Q);
  const applyRows = plan.results.filter(function (r) { return r.category === 'APPLY'; });
  check('（前置）呢筆申報被認做「可以套用」', applyRows.length === 1,
    JSON.stringify(plan.results.map(function (r) { return [r.category, r.reason]; })));
  const out = gas.applyRequests_(plan, [], undefined, 'k-test', []);
  check('（前置）套用咗', out.appliedCount === 1, JSON.stringify(out).slice(0, 300));
  check('★★★★★ 套用之後重跑規則檢查：申報指定嘅獻花**唔係**違反'
    + '——申報係人提出嘅，同填講員工具一樣係人手決定',
    noAutoOf(out.violations).length === 0, JSON.stringify(noAutoOf(out.violations)));
}

console.log('\n=== K：判斷只有一份（唔可以各自寫）===');
{
  const strip = function (s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); };
  const fine = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'FineTune.gs'), 'utf8'));
  const verify = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'Verify.gs'), 'utf8'));
  check('★★★★ findStateViolations_() 叫 isNoAutoGenerateViolation_()',
    /isNoAutoGenerateViolation_\(post, sourceOf\(cell\)\)/.test(fine));
  check('★★★★ Verify.gs 叫同一支',
    /isNoAutoGenerateViolation_\(post, a\.assignSource/.test(verify));
  check('★★★★ 兩邊都冇再自己寫「!post.autoGenerate」嗰個判斷',
    !/!post\.autoGenerate/.test(fine) && !/!post\.autoGenerate/.test(verify));
  check('★★★★ 判斷本身：MANUAL／LOCKED 唔算，AUTO／FINE_TUNED／未知 照算',
    gas.isNoAutoGenerateViolation_({ autoGenerate: false }, 'MANUAL') === false
    && gas.isNoAutoGenerateViolation_({ autoGenerate: false }, 'LOCKED') === false
    && gas.isNoAutoGenerateViolation_({ autoGenerate: false }, 'AUTO') === true
    && gas.isNoAutoGenerateViolation_({ autoGenerate: false }, 'FINE_TUNED') === true
    && gas.isNoAutoGenerateViolation_({ autoGenerate: false }, null) === true
    && gas.isNoAutoGenerateViolation_({ autoGenerate: true }, 'AUTO') === false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
