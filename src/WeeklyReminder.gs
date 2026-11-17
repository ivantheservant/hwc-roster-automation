/**
 * 第一百一十四輪批次 UE 組：每週事奉提醒（Ivan 決定 D1：每星期一提醒當週主日的事奉）。
 *
 * ── 甚麼時候寄 ────────────────────────────────────────────────────
 *   每日自動排程的一步（`dailyAutomationCheck_()`，出錯只影響這一步）。
 *   Config `WEEKLY_REMINDER_ENABLED`（預設 FALSE；上線時與其他自動寄出一併開）、
 *   `WEEKLY_REMINDER_WEEKDAY`（1＝星期一 … 6＝星期六；0 或 7＝星期日；預設 1）。
 *   「寄出期」＝提醒日至該主日前一日：例如星期一提醒 ⇒ 星期一至星期六都算；星期一沒有執行（自動排程出錯等）
 *   ⇒ 之後幾日補寄；主日當日及之後不補。
 *
 * ── 寄給誰 ────────────────────────────────────────────────────────
 *   只限**已經正式發出**的季度（`getQuarterStage_() === OFFICIAL_SENT`，與狀態卡「已正式發出給全體」同一個判斷；
 *   第一百一十輪 TB-2 之後放棄部分寄出亦會即時改為 OFFICIAL_SENT），用最新版本。
 *   那個主日有崗位、PersonID 在名單上而且啟用的人（名單以外的文字不寄；合堂而沒有崗位的主日沒有人可寄）。
 *   `ROLLOUT_AUDIENCE=LEADERS` ⇒ 只寄給現任堂委、執事、幹事（RolloutAudience.gs 同一個判斷）。
 *   同一人同日幾個崗位合成一封。沒有電郵的人合成一封摘要寄給 `MAIL_ADMIN_NOTIFY`（每個主日一次）。
 *
 * ── 只寄一次 ──────────────────────────────────────────────────────
 *   逐人紀錄（工作表 `WeeklyReminderLog`：季度、主日、PersonID、寄出日期、結果），鍵＝季度＋主日＋PersonID。
 *   SENT ⇒ 不再寄；DRY_RUN ⇒ 只在仍然是 DRY_RUN 時算（上線之後真正寄一次，照 `hasUnavailableScheduleRecord_()` 的做法）；
 *   FAILED ⇒ 翌日只補失敗的人（同一日不重試），直至主日前一日；全部寄不出 ⇒ 通知 `MAIL_ADMIN_NOTIFY` 一次。
 *   每一次執行有時間預算（`SEND_TIME_BUDGET_MS`，與寄出同一支 `shouldStopForSendBudget_()`）；超過就停，
 *   下一次每日檢查接着寄未寄的人。
 *
 * ── 取捨 ──────────────────────────────────────────────────────────
 *   提醒寄出之後職事表再有改動：不補寄提醒（改動由第 3 步〔變動的人〕通知）。
 *   全部經寄信閘門：DRY_RUN 只模擬；`MAIL_REDIRECT_ALL_TO` 照舊轉寄（`sendRealEmail_()`／`notifyAdmin_()`）。
 */

const WEEKLY_REMINDER_TEMPLATE_ID = 'TPL_WEEKLY_REMINDER_TC';
const WEEKLY_REMINDER_AUDIT_ACTION = 'WEEKLY_REMINDER_SENT';
const WEEKLY_REMINDER_NO_EMAIL_ACTION = 'WEEKLY_REMINDER_NO_EMAIL_NOTIFIED';
const WEEKLY_REMINDER_FAIL_NOTIFY_ACTION = 'WEEKLY_REMINDER_FAIL_NOTIFIED';
const WEEKLY_REMINDER_LOG_TITLES_TC = ['季度', '主日', 'PersonID', '寄出日期', '結果（SENT／DRY_RUN／FAILED）'];
const WEEKDAY_NAMES_TC = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** @returns {string[]} 第 2 行機器鍵 */
function weeklyReminderLogKeys_() {
  const L = COLUMNS.WEEKLY_REMINDER_LOG;
  return [L.QUARTER_ID, L.SERVICE_DATE, L.PERSON_ID, L.SENT_DATE, L.RESULT];
}

/** 第一次寄出時建立（〔補建設定及範本〕亦會建立）。@returns {{sheet: Object, created: boolean}} */
function ensureWeeklyReminderLogSheet_() {
  return ensureKeyedSheet_(SHEETS.WEEKLY_REMINDER_LOG, WEEKLY_REMINDER_LOG_TITLES_TC, weeklyReminderLogKeys_());
}

/** Config 開關。 */
function isWeeklyReminderEnabled_() {
  const v = getConfig_(CONFIG_KEYS.WEEKLY_REMINDER_ENABLED, DEFAULTS.WEEKLY_REMINDER_ENABLED);
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/**
 * 提醒日（0＝星期日 … 6＝星期六）。7 當作星期日；認不出 ⇒ 預設（星期一）。**純函式。**
 * @param {*} raw Config 值
 * @returns {number}
 */
function normaliseWeeklyReminderWeekday_(raw) {
  const n = Math.floor(Number(raw));
  if (isNaN(n) || n < 0 || n > 7 || String(raw).trim() === '') return DEFAULTS.WEEKLY_REMINDER_WEEKDAY;
  return n === 7 ? 0 : n;
}

/**
 * 提醒日至主日相隔幾日（星期一 ⇒ 6；星期六 ⇒ 1；星期日 ⇒ 7，即前一個主日提醒下一個主日）。**純函式。**
 * @param {number} weekday 0–6
 * @returns {number}
 */
function weeklyReminderDaysBefore_(weekday) {
  return weekday === 0 ? 7 : 7 - weekday;
}

/** yyyy-MM-dd ⇒ 星期幾（0＝星期日）。**純函式。** */
function weekdayOfDateString_(dateStr) {
  return new Date(String(dateStr) + 'T12:00:00Z').getUTCDay();
}

/**
 * 今日要提醒哪幾個主日：today < 主日 ≤ today + 相隔日數（＝提醒日至主日前一日都算，錯過提醒日會補）。**純函式。**
 * @param {string} today yyyy-MM-dd
 * @param {number} weekday 提醒日（0–6）
 * @param {Object[]} serviceDates [{quarterId, serviceDate}]
 * @returns {Object[]} 依日期排序
 */
function pickWeeklyReminderTargets_(today, weekday, serviceDates) {
  const last = shiftDateString_(today, weeklyReminderDaysBefore_(weekday));
  const seen = {};
  return (serviceDates || []).filter(function (s) {
    const key = s.quarterId + '|' + s.serviceDate;
    if (!s.serviceDate || seen[key] || !(s.serviceDate > today && s.serviceDate <= last)) return false;
    seen[key] = true;
    return true;
  }).sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); });
}

/**
 * 下一次提醒日（今日或之後最早一個提醒日）及要提醒的主日（＝提醒日加相隔日數）。**純函式。**
 * 〔自動排程狀態〕用。
 * @param {string} today
 * @param {number} weekday
 * @returns {{date: string, serviceDate: string}}
 */
function nextWeeklyReminderDate_(today, weekday) {
  let d = today;
  for (let i = 0; i < 7; i++) {
    if (weekdayOfDateString_(d) === weekday) break;
    d = shiftDateString_(d, 1);
  }
  return { date: d, serviceDate: shiftDateString_(d, weeklyReminderDaysBefore_(weekday)) };
}

/** 「M 月 d 日（主日）」。**純函式。** */
function formatWeeklyReminderDate_(dateStr) {
  const p = String(dateStr || '').split('-');
  if (p.length !== 3) return String(dateStr || '');
  return Number(p[1]) + ' 月 ' + Number(p[2]) + ' 日（主日）';
}

/**
 * 崗位 ⇒ 一行。到場時間＝崇拜開始時間減這個崗位的提早到場分鐘；沒有填（0）就不寫。**純函式。**
 * @param {string} postName
 * @param {number} earlyMinutes
 * @param {string} startTime HH:mm
 * @returns {string}
 */
function buildWeeklyReminderPostLine_(postName, earlyMinutes, startTime) {
  const early = Number(earlyMinutes) || 0;
  const m = /^(\d{2}):(\d{2})$/.exec(String(startTime || ''));
  if (early <= 0 || !m) return '・' + postName;
  let mins = Number(m[1]) * 60 + Number(m[2]) - early;
  if (mins < 0) mins += 24 * 60;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return '・' + postName + '——請在 ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' 前到場';
}

/**
 * 一個主日 ⇒ 每人一項（同一人幾個崗位合成一項）。**純函式。**
 * 只收 PersonID 在名單上而且啟用的人（名單以外的文字、臨時幫手不寄）。
 * @param {Object[]} assignments [{serviceDate, postId, slotIndex, personId}]
 * @param {string} serviceDate
 * @param {Object.<string, {name: string, active: boolean}>} peopleById
 * @param {Object.<string, {name: string, early: number, order: number}>} postsById
 * @param {string} startTime
 * @returns {Object[]} [{personId, name, postNames: string[], lines: string[]}]
 */
function groupWeeklyReminderAssignments_(assignments, serviceDate, peopleById, postsById, startTime) {
  const byPerson = {};
  const order = [];
  (assignments || []).forEach(function (a) {
    if (a.serviceDate !== serviceDate) return;
    const pid = String(a.personId || '').trim();
    const person = peopleById[pid];
    if (!pid || !person || !person.active) return;
    if (!byPerson[pid]) { byPerson[pid] = { personId: pid, name: person.name, posts: [] }; order.push(pid); }
    const post = postsById[a.postId] || { name: a.postId, early: 0, order: 9999 };
    if (!byPerson[pid].posts.some(function (p) { return p.postId === a.postId; })) {
      byPerson[pid].posts.push({ postId: a.postId, name: post.name, early: post.early, order: post.order });
    }
  });
  return order.map(function (pid) {
    const e = byPerson[pid];
    e.posts.sort(function (x, y) { return x.order - y.order; });
    return { personId: pid, name: e.name, postNames: e.posts.map(function (p) { return p.name; }),
      lines: e.posts.map(function (p) { return buildWeeklyReminderPostLine_(p.name, p.early, startTime); }) };
  });
}

/**
 * 逐人紀錄 ⇒ 這個主日誰已收到、誰今日已試過而失敗。**純函式。**
 * @param {Object[]} rows [{personId, sentDate, result}]（已篩到同一季同一個主日）
 * @param {boolean} dryNow
 * @param {string} today
 * @returns {{received: Object.<string, boolean>, failedToday: Object.<string, boolean>, failedEver: Object.<string, boolean>}}
 */
function summariseWeeklyReminderLog_(rows, dryNow, today) {
  const received = {};
  const failedToday = {};
  const failedEver = {};
  (rows || []).forEach(function (r) {
    const res = String(r.result || '').toUpperCase();
    if (res === 'SENT' || (dryNow && res === 'DRY_RUN')) received[r.personId] = true;
    if (res === 'FAILED') { failedEver[r.personId] = true; if (r.sentDate === today) failedToday[r.personId] = true; }
  });
  return { received: received, failedToday: failedToday, failedEver: failedEver };
}

/** 這一季這一個主日的逐人紀錄（工作表未建立 ⇒ 空）。 */
function readWeeklyReminderLog_(quarterId, serviceDate) {
  const L = COLUMNS.WEEKLY_REMINDER_LOG;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.WEEKLY_REMINDER_LOG)) return [];
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const asDate = function (v) { return v && typeof v.getTime === 'function' ? toDateString_(v, timezone) : String(v || '').slice(0, 10); };
  return readSheet_(SHEETS.WEEKLY_REMINDER_LOG).filter(function (r) {
    return String(r[L.QUARTER_ID] || '').trim() === quarterId && asDate(r[L.SERVICE_DATE]) === serviceDate;
  }).map(function (r) {
    return { personId: String(r[L.PERSON_ID] || '').trim(), sentDate: asDate(r[L.SENT_DATE]), result: String(r[L.RESULT] || '').toUpperCase() };
  });
}

/** 逐人加紀錄。寫不到只寫 log（不可以令已經寄出的信變成「失敗」）。 */
function appendWeeklyReminderLog_(rows) {
  if (!rows || rows.length === 0) return;
  try {
    const sheet = ensureWeeklyReminderLogSheet_().sheet;
    const values = rows.map(function (r) { return [r.quarterId, r.serviceDate, r.personId, r.sentDate, r.result]; });
    sheet.getRange(Math.max(sheet.getLastRow(), 2) + 1, 1, values.length, values[0].length).setValues(values);
  } catch (err) {
    log_('WARN', '每週事奉提醒逐人紀錄寫不到：' + err.message);
  }
}

/** 同一季同一個主日有沒有寫過某個通知（DRY_RUN 的模擬紀錄只在仍然是 DRY_RUN 時算）。 */
function hasWeeklyReminderNotice_(action, key) {
  const A = COLUMNS.AUDIT_LOG;
  const dryNow = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  return readSheet_(SHEETS.AUDIT_LOG).some(function (row) {
    if (row[A.ACTION] !== action || String(row[A.TARGET_KEY] || '').trim() !== key) return false;
    const outcome = String(String(row[A.NEW_VALUE] || '').split('|')[2] || '').trim().toUpperCase();
    return outcome === 'SENT' || (dryNow && outcome === 'DRY_RUN');
  });
}

/**
 * 每一位的佔位符（正式寄出及範本樣本共用）。**純函式。**
 * @param {Object} entry groupWeeklyReminderAssignments_() 的一項
 * @param {string} quarterId
 * @param {string} serviceDate
 * @param {string} personalUrl 個人專屬連結（沒有 ⇒ 空）
 * @param {boolean} html
 * @returns {Object}
 */
function buildWeeklyReminderPlaceholders_(entry, quarterId, serviceDate, personalUrl, html) {
  const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  const linkLine = personalUrl
    ? (html ? '你的個人專屬連結（可以看這一季全部安排）：<br><a href="' + esc(personalUrl) + '">' + esc(personalUrl) + '</a><br>這條連結只供你本人使用，請不要轉發。'
      : '你的個人專屬連結（可以看這一季全部安排）：\n' + personalUrl + '\n這條連結只供你本人使用，請不要轉發。')
    : '';
  return {
    QuarterLabel: buildQuarterLabel_(quarterId), QuarterID: quarterId,
    ServiceDateText: formatWeeklyReminderDate_(serviceDate),
    AssignmentLines: html ? entry.lines.map(esc).join('<br>') : entry.lines.join('\n'),
    PersonalLinkLine: linkLine
  };
}

/**
 * 給幹事的「沒有電郵」摘要（正式及範本樣本共用）。**純函式。**
 * @param {string} prefix 主旨前綴
 * @param {string} quarterId
 * @param {string} serviceDate
 * @param {Object[]} people [{name, postNames}]
 * @returns {{subject: string, body: string}}
 */
function buildWeeklyReminderNoEmailText_(prefix, quarterId, serviceDate, people) {
  const dateText = formatWeeklyReminderDate_(serviceDate);
  return {
    subject: prefix + dateText + ' 每週事奉提醒：' + people.length + ' 位沒有電郵，請另外通知',
    body: '每週事奉提醒已經寄給 ' + dateText + ' 有崗位而有電郵的事奉人員（' + buildQuarterLabel_(quarterId) + '）。\n\n'
      + '下面 ' + people.length + ' 位沒有電郵，收不到提醒，請另外通知（例如電話或 WhatsApp）：\n'
      + people.map(function (p) { return '　・' + p.name + '：' + p.postNames.join('、'); }).join('\n') + '\n\n'
      + '要補電郵：在出席系統補上，或在幹事介面「常用設定」〔補填電郵〕。\n'
      + '（本通知只寄給你，不會寄給事奉人員。）'
  };
}

/** 全部寄不出時給幹事的通知（正式及範本樣本共用）。**純函式。** */
function buildWeeklyReminderFailureText_(prefix, quarterId, serviceDate, failedCount) {
  const dateText = formatWeeklyReminderDate_(serviceDate);
  return {
    subject: prefix + dateText + ' 每週事奉提醒有 ' + failedCount + ' 封寄不出',
    body: '每日自動排程寄出 ' + dateText + '（' + buildQuarterLabel_(quarterId) + '）的每週事奉提醒時，' + failedCount + ' 封全部寄不出。\n\n'
      + '系統會在翌日只補寄未收到的人，直至主日前一日。如果一直寄不出，請核對這些人的電郵地址，'
      + '或者到幹事介面「進階與診斷」〔自動排程狀態〕看最近一次執行的結果。\n'
      + '（本通知只寄給你，不會寄給事奉人員。）'
  };
}

/**
 * 每日自動排程的一步。出錯會拋（呼叫端 try/catch，只影響這一步）。
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @param {boolean} isDryRun
 * @returns {Object[]} 報告 [{quarterId, action, outcome, detail}]
 */
function runWeeklyReminderStep_(today, config, isDryRun) {
  const row = function (quarterId, outcome, detail) { return { quarterId: quarterId, action: 'WEEKLY_REMINDER', outcome: outcome, detail: detail }; };
  if (!isWeeklyReminderEnabled_()) return [row('', 'SKIP', 'DISABLED')];
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const weekday = normaliseWeeklyReminderWeekday_(getConfig_(CONFIG_KEYS.WEEKLY_REMINDER_WEEKDAY, DEFAULTS.WEEKLY_REMINDER_WEEKDAY));
  const SD = COLUMNS.SERVICE_DATES;
  const serviceDates = readSheet_(SHEETS.SERVICE_DATES).map(function (r) {
    return { quarterId: String(r[SD.QUARTER_ID] || '').trim(), serviceDate: toDateString_(r[SD.SERVICE_DATE], timezone) };
  });
  const targets = pickWeeklyReminderTargets_(today, weekday, serviceDates);
  if (targets.length === 0) return [row('', 'SKIP', 'NOT_DUE')];
  return targets.map(function (t) {
    if (getQuarterStage_(t.quarterId) !== QUARTER_STAGE.OFFICIAL_SENT) return row(t.quarterId, 'SKIP', 'NOT_OFFICIAL（' + t.serviceDate + '）');
    return sendWeeklyReminderFor_(t.quarterId, t.serviceDate, today, config, isDryRun);
  });
}

/**
 * 寄一個主日的提醒（只寄未收過的人）。**會寄信**（DRY_RUN 只模擬）＋逐人紀錄＋AuditLog。
 * @returns {{quarterId: string, action: string, outcome: string, detail: string}}
 */
function sendWeeklyReminderFor_(quarterId, serviceDate, today, config, isDryRun) {
  const key = quarterId + '|' + serviceDate;
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const versionNo = findLatestVersionNo_(quarterId);
  if (versionNo < 0) return { quarterId: quarterId, action: 'WEEKLY_REMINDER', outcome: 'SKIP', detail: 'NO_VERSION（' + serviceDate + '）' };
  const M = COLUMNS.NAME_MAPPING;
  const peopleById = {};
  const rowsById = {};
  readPeople_().forEach(function (r) {
    const id = String(r[M.PERSON_ID] || '').trim();
    if (!id) return;
    peopleById[id] = { name: String(r[M.NAME_TC] || '').trim() || id, active: true };   // readPeople_() 只回傳 Active=TRUE
    rowsById[id] = r;
  });
  const postsById = {};
  readPostsNormalized_().forEach(function (p, i) { postsById[p.postId] = { name: p.postNameTC || p.postId, early: p.earlyArrivalMinutes || 0, order: i }; });
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const assignments = readVersionAssignmentsRaw_(quarterId, versionNo).map(function (r) {
    return { serviceDate: toDateString_(r[A.SERVICE_DATE], timezone), postId: String(r[A.POST_ID] || '').trim(),
      slotIndex: r[A.SLOT_INDEX], personId: String(r[A.PERSON_ID] || '').trim() };
  });
  const startTime = normalizeTimeOfDay_(getConfig_(CONFIG_KEYS.ICS_SERVICE_START_TIME, DEFAULTS.ICS_SERVICE_START_TIME), DEFAULTS.ICS_SERVICE_START_TIME);
  let entries = groupWeeklyReminderAssignments_(assignments, serviceDate, peopleById, postsById, startTime);
  if (entries.length === 0) return { quarterId: quarterId, action: 'WEEKLY_REMINDER', outcome: 'SKIP', detail: 'NO_ASSIGNMENTS（' + serviceDate + '）' };
  // 開放範圍：第一階段只寄給堂委、執事、幹事
  if (readRolloutAudience_() !== ROLLOUT_AUDIENCE.ALL) {
    const lookup = buildRolloutLeaderLookup_(timezone, today);
    entries = entries.filter(function (e) { return lookup.isLeader(e.personId); });
  }
  const dryNow = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  const done = summariseWeeklyReminderLog_(readWeeklyReminderLog_(quarterId, serviceDate), dryNow, today);
  const withEmail = [];
  const noEmail = [];
  entries.forEach(function (e) {
    const email = effectivePersonEmail_(rowsById[e.personId]);
    if (!email) noEmail.push(e); else withEmail.push(Object.assign({ email: email, token: String(rowsById[e.personId][M.PERSONAL_LINK_TOKEN] || '').trim() }, e));
  });
  const toSend = withEmail.filter(function (e) { return !done.received[e.personId] && !done.failedToday[e.personId]; });

  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const tpl = findEmailTemplateById_(WEEKLY_REMINDER_TEMPLATE_ID)
    || EMAIL_TEMPLATE_SEEDS.filter(function (s) { return s.templateId === WEEKLY_REMINDER_TEMPLATE_ID; })[0];
  const baseUrl = String(config[CONFIG_KEYS.WEBAPP_VOLUNTEER_URL] || '').trim();
  const context = { senderName: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || ''), replyTo: String(config[CONFIG_KEYS.MAIL_REPLY_TO] || '') };
  const budget = typeof sendTimeBudgetMs_ === 'function' ? sendTimeBudgetMs_() : DEFAULTS.SEND_TIME_BUDGET_MS;
  const startedAt = Date.now();
  const loopStartedAt = startedAt;
  let sent = 0;
  let simulated = 0;
  let failed = 0;
  let processed = 0;
  let stopped = 0;
  const logRows = [];
  for (let i = 0; i < toSend.length; i++) {
    if (shouldStopForSendBudget_(startedAt, loopStartedAt, processed, Date.now(), budget)) { stopped = toSend.length - i; break; }
    const e = toSend[i];
    const url = buildPersonalRosterUrl_(baseUrl, e.token, quarterId);
    const who = { displayName: e.name, email: e.email };
    const subject = prefix + applyPlaceholders_(tpl.subject, buildWeeklyReminderPlaceholders_(e, quarterId, serviceDate, url, false), who, '');
    const html = applyPlaceholders_(tpl.bodyHtml, buildWeeklyReminderPlaceholders_(e, quarterId, serviceDate, url, true), who, '');
    const plain = applyPlaceholders_(tpl.bodyPlain, buildWeeklyReminderPlaceholders_(e, quarterId, serviceDate, url, false), who, '');
    processed++;
    if (dryNow) { simulated++; logRows.push({ quarterId: quarterId, serviceDate: serviceDate, personId: e.personId, sentDate: today, result: 'DRY_RUN' }); continue; }
    try {
      sendRealEmail_({ email: e.email, displayName: e.name }, subject, html, plain, context, null, null);
      sent++;
      logRows.push({ quarterId: quarterId, serviceDate: serviceDate, personId: e.personId, sentDate: today, result: 'SENT' });
    } catch (err) {
      failed++;
      logRows.push({ quarterId: quarterId, serviceDate: serviceDate, personId: e.personId, sentDate: today, result: 'FAILED' });
    }
  }
  appendWeeklyReminderLog_(logRows);

  // 沒有電郵的人：每個主日給幹事一封摘要
  let noEmailNotified = false;
  if (noEmail.length > 0 && !hasWeeklyReminderNotice_(WEEKLY_REMINDER_NO_EMAIL_ACTION, key)) {
    const text = buildWeeklyReminderNoEmailText_(prefix, quarterId, serviceDate, noEmail);
    notifyAdmin_(text.subject, text.body, String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || ''), isDryRun);
    writeAuditLog_({ action: WEEKLY_REMINDER_NO_EMAIL_ACTION, targetSheet: SHEETS.QUARTERS, targetKey: key,
      newValue: 'AUTO|' + today + '|' + (dryNow ? 'DRY_RUN' : 'SENT'), source: 'dailyAutomationCheck_',
      notes: noEmail.length + ' 位沒有電郵：' + noEmail.map(function (e) { return e.personId; }).join('、') });
    noEmailNotified = true;
  }
  // 全部寄不出：通知幹事一次（同一季同一個主日）
  if (!dryNow && failed > 0 && sent === 0 && !hasWeeklyReminderNotice_(WEEKLY_REMINDER_FAIL_NOTIFY_ACTION, key)) {
    const text = buildWeeklyReminderFailureText_(prefix, quarterId, serviceDate, failed);
    notifyAdmin_(text.subject, text.body, String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || ''), isDryRun);
    writeAuditLog_({ action: WEEKLY_REMINDER_FAIL_NOTIFY_ACTION, targetSheet: SHEETS.QUARTERS, targetKey: key,
      newValue: 'AUTO|' + today + '|SENT', source: 'dailyAutomationCheck_', notes: failed + ' 封寄不出' });
  }

  const alreadyCount = withEmail.length - toSend.length;
  if (processed === 0 && !noEmailNotified) {
    return { quarterId: quarterId, action: 'WEEKLY_REMINDER', outcome: 'SKIP',
      detail: 'ALREADY_DONE（' + serviceDate + '：已收到 ' + alreadyCount + ' 位' + '）' };
  }
  const outcome = dryNow ? 'DRY_RUN' : (failed > 0 && sent === 0 ? 'FAILED' : (stopped > 0 || failed > 0 ? 'PARTIAL' : 'SENT'));
  const detail = serviceDate + '：' + (dryNow ? '模擬 ' + simulated : '寄出 ' + sent) + ' 封'
    + (failed ? '、失敗 ' + failed + ' 封（翌日再試）' : '')
    + (stopped ? '、時間預算用完，餘下 ' + stopped + ' 位下一次接着寄' : '')
    + (alreadyCount ? '；已收到 ' + alreadyCount + ' 位' : '')
    + (noEmail.length ? '；沒有電郵 ' + noEmail.length + ' 位' + (noEmailNotified ? '（已通知幹事）' : '') : '');
  if (processed > 0) {
    writeAuditLog_({ action: WEEKLY_REMINDER_AUDIT_ACTION, targetSheet: SHEETS.QUARTERS, targetKey: key,
      newValue: 'AUTO|' + today + '|' + outcome, source: 'dailyAutomationCheck_', notes: detail });
  }
  return { quarterId: quarterId, action: 'WEEKLY_REMINDER', outcome: outcome === 'FAILED' ? 'ERROR' : outcome, detail: detail };
}

/**
 * 〔自動排程狀態〕的一行：每週事奉提醒（開／關、下一次、寄給誰）。
 * @param {string} today
 * @returns {{label: string, who: string, onOff: string}}
 */
function describeWeeklyReminderForStatus_(today) {
  const weekday = normaliseWeeklyReminderWeekday_(getConfig_(CONFIG_KEYS.WEEKLY_REMINDER_WEEKDAY, DEFAULTS.WEEKLY_REMINDER_WEEKDAY));
  const next = nextWeeklyReminderDate_(today, weekday);
  const on = isWeeklyReminderEnabled_();
  return {
    label: '每週事奉提醒',
    who: '每' + WEEKDAY_NAMES_TC[weekday] + '寄給緊接的主日有崗位的人（只限已正式發出的季度，用最新版本；按開放範圍；同一人幾個崗位合成一封）；'
      + '沒有電郵的人合成一封寄幹事（MAIL_ADMIN_NOTIFY）。'
      + (on ? '下一次：' : '開啟之後下一次：') + next.date + '（' + WEEKDAY_NAMES_TC[weekday] + '），提醒 ' + next.serviceDate + ' 的事奉',
    onOff: on ? '開' : '關'
  };
}
