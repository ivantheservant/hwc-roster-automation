/**
 * 第九十輪批次 QC 組：義工在個人專屬連結申報不能服侍（取代共用試算表）。
 *
 * Ivan 2026-10-30 決定：義工在自己的個人專屬連結（`?p=<token>&q=<季度>`）勾選不能服侍的主日，
 * 幹事在〔不能服侍的日期〕確認之後才生效。
 *
 * ── 資料 ─────────────────────────────────────────────────────────
 *   新工作表 `UnavailableSubmissions`（第 1 行中文標題、第 2 行機器鍵；第一次提交時自動建立）：
 *   SubmissionID、PersonID、ServiceDate、Reason、SubmittedAt、Status（PENDING／ACCEPTED／REJECTED／WITHDRAWN）、
 *   DecidedBy、DecidedAt、UnavailableID、Late。
 *   **義工提交不會直接寫 `Unavailable`**——幹事〔接受〕之後才建立 `Unavailable` 行（Source=PERSONAL_LINK）。
 *   已生成的季度，之後就走現有「之後才申報不能服侍」那一套提醒（按 Unavailable.CreatedAt 判斷）。
 *
 * ── 安全（個人連結部署是 access=ANYONE）────────────────────────────
 *   - 公開函式只有 `PERSONAL_LINK_PUBLIC_APIS` 列的兩個（提交、撤回）。每個第一句一定是
 *     `const person = assertPersonalLinkCaller_(token);`——用 token 認人（NameMapping.PersonalLinkToken、Active），
 *     認不到 ⇒ 中性錯誤（PERSONAL_LINK_INVALID_MESSAGE），不透露原因。測試 round88_pd_public_globals 逐個核對。
 *   - 只可以寫入**自己**的申報；日期一定要是允許範圍內的主日、不是過去的日子；每次最多 20 個日期；
 *     每人每日最多 10 次提交（按工作表上這個人今日的提交數，不靠快取）；原因去掉 HTML、最多 100 字。
 *   - AuditLog 只寫 PersonID，**不寫 token**。
 */

/** 個人連結頁可以呼叫的公開函式（不以 _ 結尾）。加名之前要寫明理由，並更新 round88_pd_public_globals。 */
const PERSONAL_LINK_PUBLIC_APIS = ['personalSubmitUnavailable', 'personalWithdrawUnavailable'];

const UNAVAILABLE_SUBMISSION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN'
};

/** 個人頁上的狀態字眼。 */
const UNAVAILABLE_SUBMISSION_STATUS_TC = {
  PENDING: '等候幹事確認',
  ACCEPTED: '已確認',
  REJECTED: '不接受',
  WITHDRAWN: '已撤回'
};

/** 接受之後建立的 `Unavailable` 行的 Source。 */
const UNAVAILABLE_SOURCE_PERSONAL_LINK = 'PERSONAL_LINK';

const PERSONAL_UNAVAILABLE_MAX_DATES = 20;
const PERSONAL_UNAVAILABLE_MAX_PER_DAY = 10;
const PERSONAL_UNAVAILABLE_REASON_MAX = 100;

/** `UnavailableSubmissions` 第 1 行中文標題（對應 `unavailableSubmissionKeys_()` 次序）。 */
const UNAVAILABLE_SUBMISSIONS_TITLES_TC = [
  '申報編號', '人', '主日', '原因', '提交時間', '狀態（PENDING／ACCEPTED／REJECTED／WITHDRAWN）',
  '決定者', '決定時間', '建立的不能服侍編號', '截止日之後'
];

/** @returns {string[]} 機器鍵（次序同中文標題一致） */
function unavailableSubmissionKeys_() {
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  return [S.SUBMISSION_ID, S.PERSON_ID, S.SERVICE_DATE, S.REASON, S.SUBMITTED_AT, S.STATUS,
    S.DECIDED_BY, S.DECIDED_AT, S.UNAVAILABLE_ID, S.LATE];
}

/**
 * 取得（必要時建立）`UnavailableSubmissions` 工作表。
 * @returns {Sheet}
 */
function ensureUnavailableSubmissionsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.UNAVAILABLE_SUBMISSIONS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.UNAVAILABLE_SUBMISSIONS);
  const keys = unavailableSubmissionKeys_();
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  const ok = keys.every(function (k, i) { return existing[i] === k; });
  if (!ok) {
    sheet.getRange(1, 1, 1, UNAVAILABLE_SUBMISSIONS_TITLES_TC.length).setValues([UNAVAILABLE_SUBMISSIONS_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/**
 * 全部申報（工作表還沒有建立 ⇒ 空陣列）。日期、時間一律轉成字串。
 * @param {string} timezone 時區
 * @returns {Object[]} {sheetRow, submissionId, personId, serviceDate, reason, submittedAt, submittedDay, status, late, unavailableId}
 */
function readUnavailableSubmissions_(timezone) {
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.UNAVAILABLE_SUBMISSIONS)) return [];
  return readSheet_(SHEETS.UNAVAILABLE_SUBMISSIONS).map(function (r, i) {
    const at = r[S.SUBMITTED_AT];
    const atText = Object.prototype.toString.call(at) === '[object Date]'
      ? Utilities.formatDate(at, timezone, 'yyyy-MM-dd HH:mm:ss') : String(at || '').trim();
    return {
      sheetRow: i + 3,
      submissionId: String(r[S.SUBMISSION_ID] || '').trim(),
      personId: String(r[S.PERSON_ID] || '').trim(),
      serviceDate: toDateString_(r[S.SERVICE_DATE], timezone),
      reason: String(r[S.REASON] || '').trim(),
      submittedAt: atText,
      submittedDay: atText.slice(0, 10),
      status: String(r[S.STATUS] || '').trim().toUpperCase(),
      late: isTrueValue_(r[S.LATE]),
      unavailableId: String(r[S.UNAVAILABLE_ID] || '').trim()
    };
  }).filter(function (s) { return !!s.submissionId; });
}

/**
 * 原因：去掉 HTML、合併空白、最多 100 字。**純函式。**
 * @param {*} raw 義工輸入
 * @returns {string}
 */
function sanitizePersonalUnavailableReason_(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PERSONAL_UNAVAILABLE_REASON_MAX);
}

/**
 * 個人連結公開函式的第一句：用 token 認人。認不到（或 Web UI 停用）⇒ 中性錯誤，不透露原因。
 * @param {*} token 頁面送來的 token
 * @returns {{personId: string, nameTC: string}}
 */
function assertPersonalLinkCaller_(token) {
  try {
    assertWebAppEnabled_();
  } catch (err) {
    throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  }
  const t = typeof token === 'string' ? token.trim() : '';
  // 格式不對就不用讀表（32 個十六進位字元，見 generatePersonalLinkToken_()）
  if (!/^[0-9a-fA-F]{32}$/.test(t)) throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  const person = findPersonByToken_(t);
  if (!person) throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  return { personId: String(person.personId || '').trim(), nameTC: String(person.nameTC || '').trim() };
}

/**
 * 可以申報的季度：未完結（EndDate ≥ 今日）的季度之中，按開始日最近的 N 季（Config，預設 2）。
 * @param {string} todayStr 今日
 * @param {string} timezone 時區
 * @returns {Object[]} {quarterId, label, startDate, endDate, generateDate, deadline}
 */
function listPersonalUnavailableQuarters_(todayStr, timezone) {
  const Q = COLUMNS.QUARTERS;
  const ahead = Math.max(1, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_QUARTERS_AHEAD, 2)) || 2);
  const deadlineDays = Math.max(0, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_DEADLINE_DAYS, 7)) || 0);
  const config = readConfig_();
  return readSheet_(SHEETS.QUARTERS)
    .map(function (r) {
      const generateDate = readPreseasonGenerateDate_(r, config);
      return {
        quarterId: String(r[Q.QUARTER_ID] || '').trim(),
        startDate: toDateString_(r[Q.START_DATE], timezone),
        endDate: toDateString_(r[Q.END_DATE], timezone),
        generateDate: generateDate,
        deadline: generateDate ? shiftDateString_(generateDate, -deadlineDays) : ''
      };
    })
    .filter(function (q) { return q.quarterId && q.endDate && q.endDate >= todayStr; })
    .sort(function (a, b) { return a.startDate < b.startDate ? -1 : (a.startDate > b.startDate ? 1 : 0); })
    .slice(0, ahead)
    .map(function (q) { q.label = buildQuarterLabel_(q.quarterId); return q; });
}

/**
 * 「M 月 D 日」。
 * @param {string} dateStr yyyy-MM-dd
 * @returns {string}
 */
function personalUnavailableDayLabel_(dateStr) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  return m ? Number(m[1]) + ' 月 ' + Number(m[2]) + ' 日' : String(dateStr || '');
}

/**
 * 個人頁「申報不能服侍的日子」那一段的資料。**只讀；只有這個人自己的資料。**
 * @param {string} personId 已經用 token 認出來的人
 * @param {string} todayStr 今日
 * @param {string} timezone 時區
 * @returns {{quarters: Object[], submissions: Object[], maxDates: number, maxReason: number}}
 */
function buildPersonalUnavailableView_(personId, todayStr, timezone) {
  const D = COLUMNS.SERVICE_DATES;
  const U = COLUMNS.UNAVAILABLE;
  const quarters = listPersonalUnavailableQuarters_(todayStr, timezone);
  const mine = readUnavailableSubmissions_(timezone).filter(function (s) { return s.personId === personId; });
  const byDate = {};
  mine.forEach(function (s) {
    if (s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING || s.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED) {
      byDate[s.serviceDate] = s.status;
    }
  });
  // 已經在不能服侍名單（任何來源、生效中）的日子不用再申報
  const listed = readUnavailable_().filter(function (r) {
    return isUnavailableRowActive_(r) && String(r[U.PERSON_ID] || '').trim() === personId;
  }).map(function (r) {
    const from = toDateString_(r[U.DATE_FROM], timezone);
    return { from: from, to: toDateString_(r[U.DATE_TO], timezone) || from,
      all: String(r[U.APPLIES_TO] || UNAVAILABLE_VALUES.APPLIES_TO_ALL).trim() === UNAVAILABLE_VALUES.APPLIES_TO_ALL };
  });
  const isListed = function (d) { return listed.some(function (u) { return u.all && u.from <= d && d <= u.to; }); };
  const dateRows = readSheet_(SHEETS.SERVICE_DATES);
  const out = quarters.map(function (q) {
    const dates = dateRows
      .filter(function (r) { return String(r[D.QUARTER_ID] || '').trim() === q.quarterId; })
      .map(function (r) { return toDateString_(r[D.SERVICE_DATE], timezone); })
      .filter(function (d) { return d && d >= todayStr; })
      .sort()
      .map(function (d) {
        return { serviceDate: d, label: personalUnavailableDayLabel_(d),
          status: byDate[d] || (isListed(d) ? 'LISTED' : '') };
      });
    return { quarterId: q.quarterId, label: q.label, deadline: q.deadline, dates: dates };
  }).filter(function (q) { return q.dates.length > 0; });
  const submissions = mine
    .filter(function (s) { return s.status !== UNAVAILABLE_SUBMISSION_STATUS.WITHDRAWN && s.serviceDate >= todayStr; })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); })
    .map(function (s) {
      return {
        submissionId: s.submissionId,
        serviceDate: s.serviceDate,
        label: personalUnavailableDayLabel_(s.serviceDate),
        reason: s.reason,
        status: s.status,
        statusText: UNAVAILABLE_SUBMISSION_STATUS_TC[s.status] || s.status,
        canWithdraw: s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING,
        late: s.late
      };
    });
  return { quarters: out, submissions: submissions,
    maxDates: PERSONAL_UNAVAILABLE_MAX_DATES, maxReason: PERSONAL_UNAVAILABLE_REASON_MAX };
}

/**
 * 嵌入 `<script>` 的 JSON：`<`、`>`、`&`、U+2028／2029 一律轉義（原因是義工自己輸入的字）。
 * @param {*} obj 資料
 * @returns {string}
 */
function jsonForInlineScript_(obj) {
  return JSON.stringify(obj === undefined ? null : obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** @returns {string} 6 個十六進位字元（編號用，避免同一秒撞號） */
function randomIdSuffix_() {
  return Utilities.getUuid().split('-').join('').slice(0, 6);
}

/** @returns {{timezone: string, today: string}} */
function personalUnavailableToday_() {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return { timezone: timezone, today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd') };
}

/**
 * 個人連結公開函式：提交不能服侍的日子。**只寫 `UnavailableSubmissions` 這個人自己的行。**
 * @param {string} token 個人連結 token
 * @param {string[]} dates 主日（yyyy-MM-dd）
 * @param {string} reason 原因（可以空白）
 * @returns {{ok: boolean, message: string, added: number, view: Object}}
 */
function personalSubmitUnavailable(token, dates, reason) {
  const person = assertPersonalLinkCaller_(token);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, message: '系統繁忙，請稍後再試。', added: 0 };
  }
  try {
    return submitPersonalUnavailable_(person, dates, reason);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 提交的實際內容（已認出人、已拿鎖）。
 * @param {{personId: string, nameTC: string}} person 這個人
 * @param {*} dates 頁面送來的日期
 * @param {*} reason 頁面送來的原因
 * @returns {{ok: boolean, message: string, added: number, view: Object}}
 */
function submitPersonalUnavailable_(person, dates, reason) {
  const now = personalUnavailableToday_();
  const fail = function (message) {
    return { ok: false, message: message, added: 0,
      view: buildPersonalUnavailableView_(person.personId, now.today, now.timezone) };
  };
  if (!Array.isArray(dates) || dates.length === 0) return fail('請先勾選日子。');
  const wanted = [];
  dates.forEach(function (d) {
    const s = typeof d === 'string' ? d.trim() : '';
    if (wanted.indexOf(s) === -1) wanted.push(s);
  });
  if (wanted.length > PERSONAL_UNAVAILABLE_MAX_DATES) {
    return fail('每次最多可以提交 ' + PERSONAL_UNAVAILABLE_MAX_DATES + ' 個日子，請分開提交。');
  }
  const view = buildPersonalUnavailableView_(person.personId, now.today, now.timezone);
  const allowed = {};
  const quarterOf = {};
  view.quarters.forEach(function (q) {
    q.dates.forEach(function (d) { allowed[d.serviceDate] = d.status; quarterOf[d.serviceDate] = q; });
  });
  const bad = wanted.filter(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Object.prototype.hasOwnProperty.call(allowed, d); });
  if (bad.length > 0) return fail('有日子不可以申報（不是可以選的主日，或者已經過去），請重新整理頁面再選。');
  const all = readUnavailableSubmissions_(now.timezone);
  const batchesToday = {};
  all.forEach(function (s) {
    if (s.personId === person.personId && s.submittedDay === now.today) batchesToday[s.submittedAt] = true;
  });
  if (Object.keys(batchesToday).length >= PERSONAL_UNAVAILABLE_MAX_PER_DAY) {
    return fail('今日的提交次數已經到上限，請明天再試，或者聯絡幹事。');
  }
  const fresh = wanted.filter(function (d) { return !allowed[d]; });   // 已申報／已確認／已在名單 ⇒ 不重複
  if (fresh.length === 0) return fail('勾選的日子已經申報過了。');
  const cleanReason = sanitizePersonalUnavailableReason_(reason);
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const sheet = ensureUnavailableSubmissionsSheet_();
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const stamp = nowTimestamp_();
  const idBase = 'SUB-' + compactTimestamp_() + '-' + person.personId + '-' + randomIdSuffix_();
  const lateDates = [];
  fresh.sort().forEach(function (d, i) {
    const q = quarterOf[d];
    const late = !!(q && q.deadline && now.today > q.deadline);
    if (late) lateDates.push(d);
    const rec = {};
    rec[S.SUBMISSION_ID] = idBase + '-' + (i + 1);
    rec[S.PERSON_ID] = person.personId;
    rec[S.SERVICE_DATE] = d;
    rec[S.REASON] = cleanReason;
    rec[S.SUBMITTED_AT] = stamp;
    rec[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.PENDING;
    rec[S.LATE] = late;
    appendRowFields_(sheet, headers, rec);
  });
  writeAuditLog_({
    action: 'PERSONAL_UNAVAILABLE_SUBMITTED',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: person.personId,
    oldValue: '',
    newValue: fresh.join('、'),
    source: 'personalSubmitUnavailable',
    notes: '個人專屬連結申報 ' + fresh.length + ' 個日子' + (lateDates.length ? '（截止日之後：' + lateDates.join('、') + '）' : '')
  });
  return { ok: true, added: fresh.length,
    message: '已提交 ' + fresh.length + ' 個日子，等候幹事確認。',
    view: buildPersonalUnavailableView_(person.personId, now.today, now.timezone) };
}

/**
 * 個人連結公開函式：撤回一項**等候確認**的申報。只可以撤回自己的。
 * @param {string} token 個人連結 token
 * @param {string} submissionId 申報編號
 * @returns {{ok: boolean, message: string, view: Object}}
 */
function personalWithdrawUnavailable(token, submissionId) {
  const person = assertPersonalLinkCaller_(token);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, message: '系統繁忙，請稍後再試。' };
  }
  try {
    return withdrawPersonalUnavailable_(person, submissionId);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 撤回的實際內容。
 * @param {{personId: string}} person 這個人
 * @param {*} submissionId 頁面送來的編號
 * @returns {{ok: boolean, message: string, view: Object}}
 */
function withdrawPersonalUnavailable_(person, submissionId) {
  const now = personalUnavailableToday_();
  const id = typeof submissionId === 'string' ? submissionId.trim() : '';
  const target = readUnavailableSubmissions_(now.timezone).filter(function (s) {
    return s.submissionId === id && s.personId === person.personId;
  })[0];
  const view = function () { return buildPersonalUnavailableView_(person.personId, now.today, now.timezone); };
  // 不是自己的、找不到 ⇒ 同一句（不透露那個編號是不是別人的）
  if (!target) return { ok: false, message: '找不到這一項申報，請重新整理頁面。', view: view() };
  if (target.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED) {
    return { ok: false, message: '這一項已經確認。如需取消，請聯絡幹事。', view: view() };
  }
  if (target.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) {
    return { ok: false, message: '這一項已經處理，不可以撤回。', view: view() };
  }
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const sheet = ensureUnavailableSubmissionsSheet_();
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  writeRowFields_(sheet, headers, target.sheetRow, (function () {
    const u = {};
    u[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.WITHDRAWN;
    u[S.DECIDED_AT] = nowTimestamp_();
    return u;
  })());
  writeAuditLog_({
    action: 'PERSONAL_UNAVAILABLE_WITHDRAWN',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: person.personId,
    oldValue: target.serviceDate + '｜' + UNAVAILABLE_SUBMISSION_STATUS.PENDING,
    newValue: target.serviceDate + '｜' + UNAVAILABLE_SUBMISSION_STATUS.WITHDRAWN,
    source: 'personalWithdrawUnavailable',
    notes: '個人專屬連結撤回：' + target.submissionId
  });
  return { ok: true, message: '已撤回 ' + personalUnavailableDayLabel_(target.serviceDate) + ' 的申報。', view: view() };
}

// ═════════════════════════════════════════════════════════════════════
// 幹事端
// ═════════════════════════════════════════════════════════════════════

/**
 * 等候確認的申報（幹事〔不能服侍的日期〕最上面那一段）。
 * @param {string} timezone 時區
 * @returns {Object[]} {submissionId, personId, personName, serviceDate, reason, submittedAt, late}
 */
function readPendingUnavailableSubmissions_(timezone) {
  const names = buildPersonNameIndex_();
  return readUnavailableSubmissions_(timezone)
    .filter(function (s) { return s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING; })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); })
    .map(function (s) {
      return { submissionId: s.submissionId, personId: s.personId, personName: names[s.personId] || s.personId,
        serviceDate: s.serviceDate, reason: s.reason, submittedAt: s.submittedAt, late: s.late };
    });
}

/**
 * 等候確認的申報數目（主畫面、季前資料用）。讀不到 ⇒ 拋錯（呼叫端照實講）。
 * @param {?{start: string, end: string}} range 只計落在這段日子的（null ⇒ 全部）
 * @returns {number}
 */
function countPendingUnavailableSubmissions_(range) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readUnavailableSubmissions_(timezone).filter(function (s) {
    if (s.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) return false;
    return !range || (s.serviceDate >= range.start && s.serviceDate <= range.end);
  }).length;
}

/**
 * 供前端呼叫：〔接受〕〔不接受〕〔全部接受〕。**會寫入。**
 * 接受 ⇒ 建立 `Unavailable` 行（Source=PERSONAL_LINK、原因照填）並記 UnavailableID；不接受 ⇒ 只改狀態。
 * @param {string[]} submissionIds 申報編號
 * @param {string} decision 'ACCEPT'／'REJECT'
 * @returns {{ok: boolean, accepted: number, rejected: number, skipped: number, message: string}}
 */
function apiDecideUnavailableSubmissions(submissionIds, decision) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('處理義工申報', function () {
    return decideUnavailableSubmissions_(submissionIds, decision, Session.getActiveUser().getEmail());
  });
}

function decideUnavailableSubmissions_(submissionIds, decision, decidedBy) {
  const accept = decision === 'ACCEPT';
  if (!accept && decision !== 'REJECT') throw new Error('不認得的決定：' + decision);
  const ids = (Array.isArray(submissionIds) ? submissionIds : []).map(function (x) { return String(x || '').trim(); });
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const U = COLUMNS.UNAVAILABLE;
  const subs = readUnavailableSubmissions_(timezone);
  const subSheet = ensureUnavailableSubmissionsSheet_();
  const subHeaders = subSheet.getRange(2, 1, 1, subSheet.getLastColumn()).getValues()[0];
  const names = buildPersonNameIndex_();
  let unav = null;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  const stamp = nowTimestamp_();
  // 加隨機部分：同一秒內兩次〔接受〕不會撞編號
  const idBase = 'UNAV-' + compactTimestamp_() + '-' + randomIdSuffix_();
  ids.forEach(function (id) {
    const s = subs.filter(function (x) { return x.submissionId === id; })[0];
    if (!s || s.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) { skipped++; return; }
    const updates = {};
    updates[S.DECIDED_BY] = decidedBy || '';
    updates[S.DECIDED_AT] = stamp;
    if (accept) {
      if (!unav) unav = openSheetForEdit_(SHEETS.UNAVAILABLE);
      const newId = idBase + '-' + (accepted + 1);
      const rec = {};
      rec[U.UNAVAILABLE_ID] = newId;
      rec[U.PERSON_ID] = s.personId;
      rec[U.DATE_FROM] = s.serviceDate;
      rec[U.DATE_TO] = s.serviceDate;
      rec[U.APPLIES_TO] = UNAVAILABLE_VALUES.APPLIES_TO_ALL;
      rec[U.POST_IDS] = '';
      rec[U.REASON] = s.reason;
      rec[U.SOURCE] = UNAVAILABLE_SOURCE_PERSONAL_LINK;
      rec[U.STATUS] = UNAVAILABLE_VALUES.STATUS_ACTIVE;
      rec[U.CREATED_AT] = stamp;
      rec[U.CREATED_BY] = decidedBy || '';
      appendRowFields_(unav.sheet, unav.headers, rec);
      updates[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED;
      updates[S.UNAVAILABLE_ID] = newId;
      accepted++;
    } else {
      updates[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.REJECTED;
      rejected++;
    }
    writeRowFields_(subSheet, subHeaders, s.sheetRow, updates);
    writeZone3Audit_({
      action: accept ? 'PERSONAL_UNAVAILABLE_ACCEPTED' : 'PERSONAL_UNAVAILABLE_REJECTED',
      targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
      targetKey: s.submissionId,
      oldValue: UNAVAILABLE_SUBMISSION_STATUS.PENDING,
      newValue: updates[S.STATUS] + (accept ? '｜' + updates[S.UNAVAILABLE_ID] : ''),
      notes: (names[s.personId] || s.personId) + '　' + s.serviceDate + (s.reason ? '　原因：' + s.reason : '')
    });
  });
  const parts = [];
  if (accepted) parts.push('已接受 ' + accepted + ' 項（已加入不能服侍的日期）');
  if (rejected) parts.push('不接受 ' + rejected + ' 項');
  if (skipped) parts.push(skipped + ' 項已經處理過或找不到，沒有改動');
  return { ok: true, accepted: accepted, rejected: rejected, skipped: skipped,
    message: parts.length ? parts.join('；') + '。' : '沒有改動。' };
}

/**
 * 每日檢查：有新的待確認申報 ⇒ 通知幹事一次（同一日最多一封；遵守 DRY_RUN；Config 可關）。
 * 「新」＝提交時間在上一次通知之後。通知紀錄寫 AuditLog（UNAVAILABLE_SUBMISSION_NOTIFIED）。
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @param {boolean} isDryRun DRY_RUN
 * @returns {Object} 報告一行 {quarterId, action, outcome, detail}
 */
function runUnavailableSubmissionNotify_(today, config, isDryRun) {
  const row = function (outcome, detail) { return { quarterId: '', action: 'UNAVAILABLE_SUBMISSIONS', outcome: outcome, detail: detail }; };
  if (getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_NOTIFY, true) === false) return row('SKIP', 'DISABLED');
  const A = COLUMNS.AUDIT_LOG;
  let lastAt = '';
  readSheet_(SHEETS.AUDIT_LOG).forEach(function (r) {
    if (r[A.ACTION] === 'UNAVAILABLE_SUBMISSION_NOTIFIED') lastAt = String(r[A.NEW_VALUE] || '').split('|')[0];
  });
  if (lastAt && lastAt.slice(0, 10) === today) return row('SKIP', 'ALREADY_TODAY');
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const pending = readPendingUnavailableSubmissions_(timezone);
  const fresh = pending.filter(function (s) { return !lastAt || s.submittedAt > lastAt; });
  if (fresh.length === 0) return row('SKIP', 'NOTHING_NEW');
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const adminEmail = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '');
  const lines = fresh.slice(0, 30).map(function (s) {
    return '　• ' + s.personName + '　' + s.serviceDate + (s.reason ? '　原因：' + s.reason : '') + (s.late ? '　（截止日之後）' : '');
  });
  if (fresh.length > 30) lines.push('　……另有 ' + (fresh.length - 30) + ' 項');
  const body = '有 ' + fresh.length + ' 項新的義工申報（不能服侍）等候確認（全部待確認：' + pending.length + ' 項）：\n\n'
    + lines.join('\n') + '\n\n請打開幹事介面「開季前準備 ▸ 不能服侍的日期」，在最上面逐項〔接受〕或〔不接受〕。';
  notifyAdmin_(prefix + '義工申報不能服侍：' + fresh.length + ' 項等候確認', body, adminEmail, isDryRun);
  writeAuditLog_({
    action: 'UNAVAILABLE_SUBMISSION_NOTIFIED',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: today,
    newValue: nowTimestamp_() + '|' + (isDryRun || getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false ? 'DRY_RUN' : 'SENT'),
    source: 'dailyAutomationCheck_',
    notes: '新申報 ' + fresh.length + ' 項；全部待確認 ' + pending.length + ' 項'
  });
  return row('SENT', (isDryRun ? '模擬' : '') + '通知幹事：' + fresh.length + ' 項新的義工申報');
}
