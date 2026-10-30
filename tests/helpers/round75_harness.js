// 第七十五輪批次：共用嘅擬真試算表場景（CC／CD／CE／CF／CG／CH／CJ／CP 測試用）。
//
// 一季四個主日、五個崗位：
//   CHAIR（主席，自動）　READ（讀經，自動，有「盡量避免連續兩週」）　WORSHIP（領詩，自動，名單只得三位）
//   FLOWER（獻花，人手）　PREACH（講員，人手）
// 七位會友（P9701–P9707）：P9707 冇電郵；P9706 唔喺任何自動崗位名單。
//
// ⚠️ 生成、儲存、檢查全部行真入口（`apiGenerateDraftExecute()`／`apiSaveAndConfirmExecute()`……），
// 只係 Google API 換成 `mock_sheets_realistic.js` 嘅擬真試算表。

const { loadGasSource } = require('./gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet, appendRows } = require('./mock_sheets_realistic.js');

const BASE_FILES = [
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'Debug.gs', 'Tune.gs', 'Verify.gs', 'SoftRuleMetrics.gs',
  'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs', 'RequestsApply.gs', 'FourStageFlow.gs',
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs', 'MailRedirect.gs', 'WebAppRollback.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs', 'WebAppSaveConfirm.gs',
  'PreacherTranslationFill.gs', 'GridNameDropdown.gs', 'MakeupSend.gs', 'WebAppPreQuarter.gs',
  'AnnualCombined.gs', 'SuggestionSheet.gs', 'UnresolvedNameFix.gs',
  // 第七十七輪批次 EG 組：主畫面同寄出路都會叫出席系統同步（讀唔到就當冇，唔拋）
  'HwcasSync.gs'
];

/**
 * 砌一個場景。
 * @param {Object=} opts {extraFiles: string[], config: Object.<string,string>, specialRows: Object[]}
 * @returns {Object} {gas, ss, Q, DATES, TZ, PEOPLE, C, S, helpers...}
 */
function buildRound75Scene(opts) {
  opts = opts || {};
  const files = BASE_FILES.concat(opts.extraFiles || []).filter(function (f, i, a) { return a.indexOf(f) === i; });
  const gas = loadGasSource(files);
  const TZ = 'Pacific/Auckland';
  const C = gas.COLUMNS;
  const S = gas.SHEETS;
  const Q = '2099T1';
  const DATES = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];
  const PEOPLE = {
    P9701: '假甲', P9702: '假乙', P9703: '假丙', P9704: '假丁', P9705: '假戊', P9706: '假己', P9707: '假庚'
  };

  const ss = new RealisticMockSpreadsheet();
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return ss; },
    newDataValidation: function () {
      const rec = {};
      const self = {
        requireValueInList: function (l, show) { rec.list = l; rec.showDropdown = show; return self; },
        requireValueInRange: function (r, show) { rec.range = r; rec.showDropdown = show; return self; },
        setAllowInvalid: function (v) { rec.allowInvalid = v; return self; },
        setHelpText: function (t) { rec.helpText = t; return self; },
        build: function () { return rec; }
      };
      return self;
    },
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
  };
  gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'k@example.invalid'; } }; } };
  gas.CacheService = {
    getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; }
  };
  gas.LockService = {
    getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; },
    getDocumentLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; }
  };
  gas.Utilities = {
    formatDate: function (date, tz, fmt) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz || TZ }).format(date);
      if (fmt === 'yyyy-MM-dd') return d;
      if (fmt === 'yyyy-MM-dd HH:mm') return d + ' 09:00';
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

  const cfg = Object.assign({
    DRY_RUN: ['TRUE', 'BOOL'],
    SYS_TIMEZONE: [TZ, 'STR']
  }, opts.config || {});
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE],
    Object.keys(cfg).map(function (k) {
      return { [C.CONFIG.KEY]: gas.CONFIG_KEYS[k] || k, [C.CONFIG.VALUE]: cfg[k][0], [C.CONFIG.TYPE]: cfg[k][1] };
    }));
  seedSheet(ss, S.QUARTERS, ['Q'], [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
    C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
    { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2099, [C.QUARTERS.TERM]: 1,
      [C.QUARTERS.START_DATE]: '2099-01-01', [C.QUARTERS.END_DATE]: '2099-01-31',
      [C.QUARTERS.STAGE]: 'DRAFT' }]);
  seedSheet(ss, S.SERVICE_DATES, ['D'], [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID,
    C.SERVICE_DATES.SERVICE_DATE, C.SERVICE_DATES.WEEK_INDEX,
    C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.SERVICE_TYPE, C.SERVICE_DATES.AUTO_GENERATE],
  DATES.map(function (d, i) {
    return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
      [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
      [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.SERVICE_TYPE]: '主日崇拜',
      [C.SERVICE_DATES.AUTO_GENERATE]: true };
  }));
  const POSTS = [
    ['CHAIR', '主席', true, 'ALLOW'], ['READ', '讀經', true, 'WARN'], ['WORSHIP', '領詩', true, 'ALLOW'],
    ['FLOWER', '獻花', false, 'ALLOW'], ['PREACH', '講員', false, 'ALLOW']
  ];
  seedSheet(ss, S.POSTS, ['P'], [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT,
    C.POSTS.DISTINCT_WITHIN_POST, C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE,
    C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP, C.POSTS.DISPLAY_ORDER,
    C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
  POSTS.map(function (p, i) {
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
      [C.NAME_MAPPING.EMAIL]: id === 'P9707' ? '' : id.toLowerCase() + '@example.invalid',
      [C.NAME_MAPPING.ACTIVE]: true };
  }));
  const elig = [];
  ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9707'].forEach(function (id) {
    elig.push(['CHAIR', id]); elig.push(['READ', id]); elig.push(['FLOWER', id]);
  });
  ['P9701', 'P9702', 'P9703'].forEach(function (id) { elig.push(['WORSHIP', id]); });
  seedSheet(ss, S.ELIGIBILITY, ['E'], [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID,
    C.ELIGIBILITY.POST_ID, C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
  elig.map(function (p, i) {
    return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'E' + i, [C.ELIGIBILITY.POST_ID]: p[0],
      [C.ELIGIBILITY.PERSON_ID]: p[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
  }));
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL,
    C.RULE_SETTINGS.ENABLED, C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION,
    C.RULE_SETTINGS.PRIORITY], [
    { [C.RULE_SETTINGS.RULE_ID]: 'HARD_ELIGIBILITY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
    { [C.RULE_SETTINGS.RULE_ID]: 'HARD_NO_AUTO_PREACHER', [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
    { [C.RULE_SETTINGS.RULE_ID]: 'HARD_SPECIAL_SUNDAY_SKIP', [C.RULE_SETTINGS.LEVEL]: 'HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
    { [C.RULE_SETTINGS.RULE_ID]: 'SEMI_NO_CONSECUTIVE', [C.RULE_SETTINGS.LEVEL]: 'SEMI_HARD',
      [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'WARN', [C.RULE_SETTINGS.PRIORITY]: 2 }
  ]);
  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'SEND_LOG', 'AUDIT_LOG', 'REQUESTS',
    'SPECIAL_SUNDAYS', 'UNAVAILABLE', 'NAME_ALIAS', 'FINE_TUNE_PROPOSALS'].forEach(function (k) {
    seedSheet(ss, S[k], [k], Object.keys(C[k]).map(function (x) { return C[k][x]; }), []);
  });
  if (opts.specialRows && opts.specialRows.length) {
    const SS = C.SPECIAL_SUNDAYS;
    appendRows(ss, S.SPECIAL_SUNDAYS, Object.keys(SS).map(function (k) { return SS[k]; }), opts.specialRows);
  }
  seedSheet(ss, S.EMAIL_TEMPLATES, ['T'], [C.EMAIL_TEMPLATES.TEMPLATE_ID], []);
  seedSheet(ss, S.EMAIL_RECIPIENTS, ['RC'], [C.EMAIL_RECIPIENTS.RECIPIENT_ID], []);

  // ── 小工具 ───────────────────────────────────────────────────
  const A = C.ROSTER_ASSIGNMENTS;
  function rows(versionNo) {
    return gas.readSheet_(S.ROSTER_ASSIGNMENTS).filter(function (r) {
      return r[A.QUARTER_ID] === Q && Number(r[A.VERSION_NO]) === versionNo;
    });
  }
  function cellRow(versionNo, dateStr, postId) {
    return rows(versionNo).find(function (r) {
      return gas.toDateString_(r[A.SERVICE_DATE], TZ) === dateStr && r[A.POST_ID] === postId;
    });
  }
  function gridSheet(versionNo) { return ss.getSheetByName('Roster_' + Q + '_v' + versionNo); }
  function gridPos(versionNo, dateStr, key) {
    const sh = gridSheet(versionNo);
    const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
    const col = keys.indexOf(key) + 1;
    for (let r = 3; r <= sh.getLastRow(); r++) {
      if (gas.toDateString_(sh.getRange(r, 1).getValue(), TZ) === dateStr) return { sh: sh, row: r, col: col };
    }
    return null;
  }
  function getCell(versionNo, dateStr, key) {
    const p = gridPos(versionNo, dateStr, key);
    return p ? String(p.sh.getRange(p.row, p.col).getValue()) : null;
  }
  function setCell(versionNo, dateStr, key, value) {
    const p = gridPos(versionNo, dateStr, key);
    p.sh.getRange(p.row, p.col).setValue(value);
  }
  function nameOf(id) { return PEOPLE[id]; }

  return {
    gas: gas, ss: ss, Q: Q, DATES: DATES, TZ: TZ, PEOPLE: PEOPLE, C: C, S: S, A: A,
    rows: rows, cellRow: cellRow, gridSheet: gridSheet, getCell: getCell, setCell: setCell, nameOf: nameOf,
    appendRows: appendRows
  };
}

module.exports = { buildRound75Scene };
