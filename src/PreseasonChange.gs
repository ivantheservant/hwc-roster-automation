/**
 * 第九十八輪批次 YB 組：已有版本之後，開季前資料有改動 ⇒ 電郵通知幹事、狀態卡講明。
 *
 * ── 為甚麼 ────────────────────────────────────────────────────────
 * 生成之後幹事再改名單、偏好、不能服侍、合堂……職事表不會自己跟着變，要按〔請系統幫我調整〕
 * 再〔儲存〕成新一版才生效。改的人和排表的人可能不是同一位，所以要有人提醒。
 *
 * ── 偵測方法（內容快照，不靠 AuditLog）─────────────────────────────
 * 身分（Roles）、規則（RuleSettings）等工作表可以直接在試算表上改，AuditLog 沒有紀錄，
 * 所以改為比較內容：
 *   ・每建立一個版本（`registerVersion_()`）就把九類資料逐行做一個短 hash，存入 `PreseasonBaselines`
 *     （一季一類一行；第一次用時自動建立）。部署前已有的版本：每日檢查第一次見到時補記。
 *   ・檢查時重新讀一次、逐行比較（按每行的鍵：多了、少了、內容不同各算 1 項）。
 *   ・同一批改動只通知一次（`NOTIFIED` 那一行記住上一次通知的簽名）；再有新改動 ⇒ 再通知。
 *   ・季度已開始（今日 ≥ StartDate）、沒有版本、Config `PRESEASON_CHANGE_NOTIFY=FALSE` ⇒ 不檢查。
 *
 * ⚠️ 用工作表不用 PropertiesService：同 `RehearsalState` 一樣，connector 讀不到 Properties。
 */

const PRESEASON_CHANGE_CATEGORIES = [
  { id: 'ELIG', label: '名單' },
  { id: 'EXCL', label: '暫時不做' },
  { id: 'WEIGHT', label: '排表偏好' },
  { id: 'UNAVAIL', label: '不能服侍' },
  { id: 'CHOIR', label: '詩班獻詩' },
  { id: 'COMBINED', label: '合堂' },
  { id: 'PRE', label: '預先安排' },
  { id: 'ROLES', label: '身分（堂委／執事）' },
  { id: 'RULES', label: '規則設定' }
];
const PRESEASON_NOTIFIED_CATEGORY = 'NOTIFIED';
const PRESEASON_CHANGE_AUDIT_ACTION = 'PRESEASON_CHANGE_NOTIFIED';
const PRESEASON_CHANGE_ACTION_TEXT = '請打開幹事介面，按〔請系統幫我調整〕，檢查後〔儲存〕成新一版，改動才會生效。';
const PRESEASON_BASELINES_TITLES_TC = ['季度', '版本', '類別', '內容摘要（程式用）', '記錄時間'];
/** 每一行的鍵、內容各用 7 個字元（32 位元 hash，36 進位） */
const PRESEASON_HASH_WIDTH = 7;

/** 機器鍵 */
function preseasonBaselineKeys_() {
  const B = COLUMNS.PRESEASON_BASELINES;
  return [B.QUARTER_ID, B.VERSION_NO, B.CATEGORY, B.DATA, B.CAPTURED_AT];
}

/** 32 位元 hash（djb2 變體），定長 7 字元。**純函式。** */
function preseasonHash_(text) {
  const s = String(text);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(36)).slice(-PRESEASON_HASH_WIDTH);
}

/** 讀一格的文字（日期 ⇒ yyyy-MM-dd）。 */
function preseasonCellText_(value, timezone) {
  if (value instanceof Date) return toDateString_(value, timezone);
  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * 某一類的逐行記錄（{鍵: 內容}）。同一個鍵出現多次 ⇒ 加「#2」「#3」。**純函式。**
 * @param {string[][]} pairs [[鍵, 內容], ...]
 * @returns {Object.<string, string>} keyHash → valueHash
 */
function buildPreseasonCategoryMap_(pairs) {
  const seen = {};
  const out = {};
  pairs.forEach(function (p) {
    const n = (seen[p[0]] = (seen[p[0]] || 0) + 1);
    out[preseasonHash_(n > 1 ? p[0] + '#' + n : p[0])] = preseasonHash_(p[1]);
  });
  return out;
}

/**
 * 這一季開季前資料的快照（九類，每類 keyHash → valueHash）。**只讀。**
 * 可選的工作表（暫時不做、排表偏好、預先安排、身分）不存在 ⇒ 那一類是空的。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, Object.<string, string>>}
 */
function readPreseasonSnapshot_(quarterId, timezone) {
  const t = function (v) { return preseasonCellText_(v, timezone); };
  const b = function (v) { return isTrueValue_(v) ? 'T' : 'F'; };
  const join = function (arr) { return arr.join('|'); };
  const out = {};

  const E = COLUMNS.ELIGIBILITY;
  out.ELIG = buildPreseasonCategoryMap_(readSheet_(SHEETS.ELIGIBILITY).map(function (r) {
    return [join([t(r[E.PERSON_ID]), t(r[E.POST_ID])]), join([b(r[E.ELIGIBLE]), b(r[E.ACTIVE])])];
  }));

  const X = COLUMNS.PERSON_POST_EXCLUSIONS;
  out.EXCL = buildPreseasonCategoryMap_(readOptionalSheetRows_(SHEETS.PERSON_POST_EXCLUSIONS).map(function (r) {
    return [t(r[X.EXCLUSION_ID]) || join([t(r[X.PERSON_ID]), t(r[X.POST_ID])]),
      join([t(r[X.PERSON_ID]), t(r[X.POST_ID]), t(r[X.EFFECTIVE_FROM]), t(r[X.EFFECTIVE_TO]), b(r[X.ACTIVE])])];
  }));

  const W = COLUMNS.PERSON_POST_WEIGHT;
  out.WEIGHT = buildPreseasonCategoryMap_(readOptionalSheetRows_(SHEETS.PERSON_POST_WEIGHT).map(function (r) {
    return [t(r[W.WEIGHT_ID]) || join([t(r[W.PERSON_ID]), t(r[W.POST_ID])]),
      join([t(r[W.PERSON_ID]), t(r[W.POST_ID]), t(r[W.ADJUST]), t(r[W.EFFECTIVE_FROM]), t(r[W.EFFECTIVE_TO]), b(r[W.ACTIVE])])];
  }));

  const D = COLUMNS.SERVICE_DATES;
  const dateRows = readSheet_(SHEETS.SERVICE_DATES).filter(function (r) { return t(r[D.QUARTER_ID]) === quarterId; });
  const dates = dateRows.map(function (r) { return t(r[D.SERVICE_DATE]); }).filter(Boolean).sort();
  out.CHOIR = buildPreseasonCategoryMap_(dateRows.map(function (r) {
    return [t(r[D.SERVICE_DATE]), b(r[D.CHOIR_SINGING])];
  }));
  out.COMBINED = buildPreseasonCategoryMap_(dateRows.map(function (r) {
    const kind = t(r[D.COMBINED_KIND]).toUpperCase();
    return [t(r[D.SERVICE_DATE]), kind ? join([kind, t(r[D.COMBINED_NAME])]) : ''];
  }));

  // 不能服侍（已確認的義工申報會寫成 Unavailable 的一行）：只看和這一季主日重疊的
  const U = COLUMNS.UNAVAILABLE;
  const first = dates[0] || '';
  const last = dates[dates.length - 1] || '';
  out.UNAVAIL = buildPreseasonCategoryMap_(readSheet_(SHEETS.UNAVAILABLE).filter(function (r) {
    if (!first) return true;
    const from = t(r[U.DATE_FROM]);
    const to = t(r[U.DATE_TO]) || from;
    return !(to && to < first) && !(from && from > last);
  }).map(function (r) {
    return [t(r[U.UNAVAILABLE_ID]) || join([t(r[U.PERSON_ID]), t(r[U.DATE_FROM])]),
      join([t(r[U.PERSON_ID]), t(r[U.DATE_FROM]), t(r[U.DATE_TO]), t(r[U.APPLIES_TO]), t(r[U.POST_IDS]), t(r[U.STATUS]).toUpperCase()])];
  }));

  const P = COLUMNS.PRE_ASSIGNMENTS;
  out.PRE = buildPreseasonCategoryMap_(readOptionalSheetRows_(SHEETS.PRE_ASSIGNMENTS).filter(function (r) {
    return t(r[P.QUARTER_ID]) === quarterId && (t(r[P.PERSON_ID]) || t(r[P.FREE_TEXT]));
  }).map(function (r) {
    return [join([t(r[P.SERVICE_DATE]), t(r[P.POST_ID]), String(Number(r[P.SLOT_INDEX]) || 1)]),
      join([t(r[P.PERSON_ID]), t(r[P.PERSON_ID]) ? '' : t(r[P.FREE_TEXT])])];
  }));

  const R = COLUMNS.ROLES;
  out.ROLES = buildPreseasonCategoryMap_(readOptionalSheetRows_(SHEETS.ROLES).map(function (r) {
    return [t(r[R.ROLE_ASSIGNMENT_ID]) || join([t(r[R.PERSON_ID]), t(r[R.ROLE_CODE])]),
      join([t(r[R.PERSON_ID]), t(r[R.ROLE_CODE]).toUpperCase(), t(r[R.EFFECTIVE_FROM]), t(r[R.EFFECTIVE_TO]), b(r[R.ACTIVE])])];
  }));

  const S = COLUMNS.RULE_SETTINGS;
  out.RULES = buildPreseasonCategoryMap_(readSheet_(SHEETS.RULE_SETTINGS).map(function (r) {
    return [t(r[S.RULE_ID]), join([t(r[S.LEVEL]), b(r[S.ENABLED]), t(r[S.SCOPE_POST_IDS]), t(r[S.TARGET_VALUE]),
      t(r[S.TOLERANCE]), t(r[S.PARAM_JSON]), t(r[S.ON_VIOLATION]), t(r[S.PRIORITY])])];
  }));
  return out;
}

/** {keyHash: valueHash} ⇒ 定長字串（按鍵排序）。**純函式。** */
function encodePreseasonCategory_(map) {
  return Object.keys(map || {}).sort().map(function (k) { return k + map[k]; }).join('');
}

/** `encodePreseasonCategory_()` 的反向。**純函式。** */
function decodePreseasonCategory_(text) {
  const out = {};
  const s = String(text || '');
  const w = PRESEASON_HASH_WIDTH;
  for (let i = 0; i + 2 * w <= s.length; i += 2 * w) out[s.slice(i, i + w)] = s.slice(i + w, i + 2 * w);
  return out;
}

/**
 * 兩份快照逐類比較：鍵多了、少了、內容不同各算 1 項。**純函式。**
 * @param {Object} base 基準快照
 * @param {Object} cur 現時快照
 * @returns {{id: string, label: string, count: number}[]} 只列有改動的類別（按固定次序）
 */
function diffPreseasonSnapshots_(base, cur) {
  const out = [];
  PRESEASON_CHANGE_CATEGORIES.forEach(function (c) {
    const a = (base || {})[c.id] || {};
    const b = (cur || {})[c.id] || {};
    let n = 0;
    Object.keys(a).forEach(function (k) { if (b[k] !== a[k]) n++; });
    Object.keys(b).forEach(function (k) { if (!(k in a)) n++; });
    if (n > 0) out.push({ id: c.id, label: c.label, count: n });
  });
  return out;
}

/**
 * 這一批改動的簽名（同一批只通知一次）：有改動的類別在現時快照的內容。**純函式。**
 * @param {Object} cur 現時快照
 * @param {Object[]} items `diffPreseasonSnapshots_()` 的結果
 * @returns {string}
 */
function preseasonChangeSignature_(cur, items) {
  return preseasonHash_((items || []).map(function (it) { return it.id + ':' + encodePreseasonCategory_((cur || {})[it.id]); }).join(';'));
}

/**
 * 讀 `PreseasonBaselines` 裏這一季的基準。沒有 ⇒ null。
 * @param {string} quarterId 季度 ID
 * @returns {?{versionNo: number, snapshot: Object, notifiedSig: string}}
 */
function readPreseasonBaseline_(quarterId) {
  const B = COLUMNS.PRESEASON_BASELINES;
  const rows = readOptionalSheetRows_(SHEETS.PRESEASON_BASELINES).filter(function (r) {
    return String(r[B.QUARTER_ID] || '').trim() === quarterId;
  });
  if (rows.length === 0) return null;
  const out = { versionNo: Number(rows[0][B.VERSION_NO]), snapshot: {}, notifiedSig: '' };
  rows.forEach(function (r) {
    const cat = String(r[B.CATEGORY] || '').trim();
    if (cat === PRESEASON_NOTIFIED_CATEGORY) out.notifiedSig = String(r[B.DATA] || '').trim();
    else out.snapshot[cat] = decodePreseasonCategory_(r[B.DATA]);
  });
  return out;
}

/** 取得（必要時建立）`PreseasonBaselines` 工作表。 */
function ensurePreseasonBaselinesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.PRESEASON_BASELINES);
  if (!sheet) sheet = ss.insertSheet(SHEETS.PRESEASON_BASELINES);
  const keys = preseasonBaselineKeys_();
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  if (!keys.every(function (k, i) { return existing[i] === k; })) {
    sheet.getRange(1, 1, 1, PRESEASON_BASELINES_TITLES_TC.length).setValues([PRESEASON_BASELINES_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/**
 * 把這一季的基準整份換成 `snapshot`（版本 `versionNo`；通知簽名 `notifiedSig`）。**會寫 PreseasonBaselines。**
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} snapshot 快照
 * @param {string} notifiedSig 已通知的簽名（新版本 ⇒ 空白）
 * @returns {void}
 */
function writePreseasonBaseline_(quarterId, versionNo, snapshot, notifiedSig) {
  const sheet = ensurePreseasonBaselinesSheet_();
  const keys = preseasonBaselineKeys_();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) {
    const ids = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0] || '').trim() === quarterId) sheet.deleteRow(i + 3);
    }
  }
  const now = nowTimestamp_();
  const rows = PRESEASON_CHANGE_CATEGORIES.map(function (c) {
    return [quarterId, versionNo, c.id, encodePreseasonCategory_(snapshot[c.id]), now];
  }).concat([[quarterId, versionNo, PRESEASON_NOTIFIED_CATEGORY, notifiedSig || '', now]]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, keys.length).setValues(rows);
}

/** 只改通知簽名那一格。 */
function writePreseasonNotifiedSig_(quarterId, sig) {
  const sheet = ensurePreseasonBaselinesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;
  const values = sheet.getRange(3, 1, lastRow - 2, 3).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === quarterId && String(values[i][2] || '').trim() === PRESEASON_NOTIFIED_CATEGORY) {
      sheet.getRange(i + 3, 4).setValue(sig || '');
      return;
    }
  }
}

/**
 * 建立版本時記下基準（`registerVersion_()` 叫）。失敗只記 WARN，不令建立版本失敗——
 * 每日檢查見到基準的版本號不對，會補記一次。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 新版本號
 */
function capturePreseasonBaselineSafe_(quarterId, versionNo) {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    writePreseasonBaseline_(quarterId, versionNo, readPreseasonSnapshot_(quarterId, timezone), '');
  } catch (err) {
    log_('WARN', 'capturePreseasonBaselineSafe_（' + quarterId + ' v' + versionNo + '）記不到開季前資料基準：' + err.message);
  }
}

/** 「排表偏好 2 項、預先安排 1 項」。 */
function joinPreseasonChangeItems_(items) {
  return (items || []).map(function (it) { return it.label + ' ' + it.count + ' 項'; }).join('、');
}

/**
 * 通知電郵（標題、內文）。**純函式。**
 * @param {string} prefix 標題前綴（MAIL_SUBJECT_PREFIX）
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 最新版本號
 * @param {Object[]} items `diffPreseasonSnapshots_()` 的結果
 * @param {string} adminUrl 幹事介面連結（可以空白）
 * @returns {{subject: string, body: string}}
 */
function buildPreseasonChangeNotifyText_(prefix, quarterId, versionNo, items, adminUrl) {
  const subject = (prefix || '') + quarterId + ' 職事表：開季前資料在第 ' + versionNo + ' 版之後有改動';
  const body = quarterId + ' 職事表第 ' + versionNo + ' 版之後，以下開季前資料有改動：\n\n'
    + (items || []).map(function (it) { return it.label + '：' + it.count + ' 項'; }).join('\n')
    + '\n\n' + PRESEASON_CHANGE_ACTION_TEXT
    + (adminUrl ? '\n' + adminUrl : '');
  return { subject: subject, body: body };
}

/** 幹事介面連結（WEBAPP_STEWARD_URL?quarter=…；沒有設定 ⇒ 空白）。 */
function buildPreseasonChangeAdminUrl_(quarterId) {
  const base = String(getConfig_(CONFIG_KEYS.WEBAPP_STEWARD_URL, '') || '').trim();
  if (!base) return '';
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'quarter=' + encodeURIComponent(quarterId);
}

/**
 * 判斷這一季要不要檢查。**只讀。**
 * @param {string} quarterId 季度 ID
 * @param {string} today yyyy-MM-dd
 * @param {string} timezone 時區
 * @returns {{check: boolean, reason: string, versionNo: number}}
 */
function judgePreseasonChangeCheck_(quarterId, today, timezone) {
  if (getConfig_(CONFIG_KEYS.PRESEASON_CHANGE_NOTIFY, true) === false) return { check: false, reason: 'DISABLED', versionNo: -1 };
  const versionNo = findLatestVersionNo_(quarterId);
  if (!(versionNo >= 0)) return { check: false, reason: 'NO_VERSION', versionNo: versionNo };
  const q = findQuarter_(quarterId);
  const start = q ? toDateString_(q[COLUMNS.QUARTERS.START_DATE], timezone) : '';
  if (start && today >= start) return { check: false, reason: 'STARTED', versionNo: versionNo };
  return { check: true, reason: '', versionNo: versionNo };
}

/**
 * 一季的檢查及通知（每日檢查、〔立即檢查〕都用這一支）。**會寫 PreseasonBaselines／AuditLog，可能寄信。**
 * @param {string} quarterId 季度 ID
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @param {boolean} isDryRun DRY_RUN
 * @param {string} source 呼叫來源（AuditLog）
 * @returns {{quarterId: string, action: string, outcome: string, detail: string, items: Object[]}}
 */
function runPreseasonChangeNotify_(quarterId, today, config, isDryRun, source) {
  const row = function (outcome, detail, items) {
    return { quarterId: quarterId, action: 'PRESEASON_CHANGE', outcome: outcome, detail: detail, items: items || [] };
  };
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const judged = judgePreseasonChangeCheck_(quarterId, today, timezone);
  if (!judged.check) return row('SKIP', judged.reason);
  const cur = readPreseasonSnapshot_(quarterId, timezone);
  const base = readPreseasonBaseline_(quarterId);
  if (!base || base.versionNo !== judged.versionNo) {
    writePreseasonBaseline_(quarterId, judged.versionNo, cur, '');
    return row('SKIP', 'BASELINE_CAPTURED');
  }
  const items = diffPreseasonSnapshots_(base.snapshot, cur);
  if (items.length === 0) {
    if (base.notifiedSig) writePreseasonNotifiedSig_(quarterId, '');
    return row('SKIP', 'NO_CHANGE');
  }
  const sig = preseasonChangeSignature_(cur, items);
  if (sig === base.notifiedSig) return row('SKIP', 'ALREADY_NOTIFIED', items);
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const text = buildPreseasonChangeNotifyText_(prefix, quarterId, judged.versionNo, items, buildPreseasonChangeAdminUrl_(quarterId));
  notifyAdmin_(text.subject, text.body, config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY], isDryRun);
  writePreseasonNotifiedSig_(quarterId, sig);
  const dry = isDryRun || getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  writeAuditLog_({
    action: PRESEASON_CHANGE_AUDIT_ACTION,
    targetSheet: SHEETS.PRESEASON_BASELINES,
    targetKey: quarterId + '-v' + judged.versionNo,
    newValue: nowTimestamp_() + '|' + (dry ? 'DRY_RUN' : 'SENT'),
    source: source || 'dailyAutomationCheck_',
    notes: joinPreseasonChangeItems_(items)
  });
  return row('SENT', (dry ? '模擬' : '') + '通知幹事：' + quarterId + ' 第 ' + judged.versionNo + ' 版之後開季前資料有改動（'
    + joinPreseasonChangeItems_(items) + '）', items);
}

/**
 * 狀態卡：「第 N 版之後，開季前資料有改動：排表偏好 2 項、預先安排 1 項。」（同電郵同一個來源）
 * **只讀**——沒有基準（例如部署前的版本、每日檢查還沒有補記）⇒ 不顯示。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 最新版本號
 * @returns {{count: number, text: string, items: Object[]}}
 */
function describePreseasonChangeForDashboard_(quarterId, versionNo) {
  const none = { count: 0, text: '', items: [] };
  if (!(versionNo >= 0)) return none;
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const judged = judgePreseasonChangeCheck_(quarterId, today, timezone);
    if (!judged.check) return none;
    const base = readPreseasonBaseline_(quarterId);
    if (!base || base.versionNo !== versionNo) return none;
    const items = diffPreseasonSnapshots_(base.snapshot, readPreseasonSnapshot_(quarterId, timezone));
    if (items.length === 0) return none;
    return { count: items.length, items: items,
      text: '第 ' + versionNo + ' 版之後，開季前資料有改動：' + joinPreseasonChangeItems_(items) + '。按〔請系統幫我調整〕，檢查後〔儲存〕成新一版，改動才會生效。' };
  } catch (err) {
    log_('WARN', 'describePreseasonChangeForDashboard_ 算不到：' + err.message);
    return none;
  }
}

/**
 * 供前端呼叫：進階與診斷〔檢查開季前資料改動〕——只檢查這一季，和每日檢查同一支。
 * **會寫 PreseasonBaselines／AuditLog，有改動時會通知幹事（遵守 DRY_RUN）。**
 * @param {string} quarterId 季度 ID
 * @returns {{ok: boolean, outcome: string, message: string}}
 */
function apiRunPreseasonChangeCheck(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('檢查開季前資料改動', function () {
    const id = String(quarterId || '').trim();
    const config = readConfig_();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const isDryRun = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
    const r = runPreseasonChangeNotify_(id, today, config, isDryRun, 'apiRunPreseasonChangeCheck');
    const texts = {
      DISABLED: 'Config PRESEASON_CHANGE_NOTIFY 是 FALSE，沒有檢查。',
      NO_VERSION: '這一季還沒有任何版本，不用檢查。',
      STARTED: '這一季已經開始，不再檢查。',
      BASELINE_CAPTURED: '這一季最新版本還沒有基準，現在已經記下；之後的改動才會通知。',
      NO_CHANGE: '最新版本之後，開季前資料沒有改動。',
      ALREADY_NOTIFIED: '這一批改動已經通知過（' + joinPreseasonChangeItems_(r.items) + '），沒有再寄。'
    };
    return { ok: true, outcome: r.outcome, message: r.outcome === 'SENT' ? r.detail + '。' : (texts[r.detail] || r.detail) };
  });
}
