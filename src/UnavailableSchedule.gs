/**
 * 第一百零五輪批次 RB 組：申報不能服侍日子——時間表自動化（由 UNAVAILABLE_INVITE_AUTO_FROM_QUARTER 那一季起；之前照舊人手）。
 *
 * ── Ivan 的時間表（G＝生成日；截止日＝G）─────────────────────────────────
 *   G−21  請確認事奉人員表（即季前資料，內容不變；主旨及第一段寫明確認期限及申報連結寄出日）→ 幹事＋堂委＋執事（季前資料收件人）
 *   G−14  寄申報連結（照開放範圍 ROLLOUT_AUDIENCE），信內寫明兩星期內（截止日之前）完成 → 事奉人員
 *   G−14 至 G  新申報不逐次通知幹事、堂委（UNAVAILABLE_QUIET_DURING_WINDOW）
 *   G−3   提醒一次：只寄給收到邀請而未有任何回覆的人 → 事奉人員
 *   G     「申報期已完結：共 N 份申報待確認」＋確認畫面深連結 → 幹事＋堂委
 *   G 之後 新申報照舊逐次通知 → 幹事＋確認者
 *
 * ── 日數（Config，全部有預設）──────────────────────────────────────────
 *   UNAVAILABLE_INVITE_DAYS_BEFORE_GENERATE（14）、LIST_CONFIRM_DAYS_BEFORE_INVITE（7）、
 *   UNAVAILABLE_REMIND_DAYS_BEFORE_DEADLINE（3）。
 *
 * ── 舊 Config 相容 ─────────────────────────────────────────────────────
 *   - 季前資料的日子：時間表自動化開着、而且是時間表季度 ⇒ G −（7＋14）；否則照舊 PRESEASON_DAYS_BEFORE（14）。
 *   - 截止日：時間表季度（UNAVAILABLE_INVITE_AUTO_FROM_QUARTER 及之後）⇒ G；之前的季度照舊 G − PERSONAL_UNAVAILABLE_DEADLINE_DAYS
 *     （2027T1 的邀請可能已經用舊截止日寄出，不改）。
 *
 * ── 只做一次 ───────────────────────────────────────────────────────────
 *   每一步每季寫一行 AuditLog（申報連結沿用 UNAVAILABLE_INVITE_SENT，NEW_VALUE 第一段 AUTO；提醒 UNAVAILABLE_REMIND_SENT；
 *   完結通知 UNAVAILABLE_WINDOW_CLOSED），有紀錄（模擬亦算）就不再做。DRY_RUN 照舊只模擬。
 *   已經有版本（已生成）⇒ 申報連結、提醒、完結通知都不做。
 *
 * ── 「我這一季沒有不能服侍的日子」──────────────────────────────────────
 *   個人連結頁的按鈕寫入 `UnavailableReplies`（第一次使用時自動建立；一人一季一行，Status ACTIVE／WITHDRAWN），
 *   有效的回覆＝已回覆，不會收到 G−3 提醒；可以再改（取消）。確認畫面列出誰已回覆「沒有」。
 */

const UNAVAILABLE_REMIND_TEMPLATE_ID = 'TPL_UNAVAILABLE_REMIND_TC';
const UNAVAILABLE_WINDOW_CLOSED_TEMPLATE_ID = 'TPL_UNAVAILABLE_WINDOW_CLOSED_TC';
const UNAVAILABLE_REMIND_AUDIT_ACTION = 'UNAVAILABLE_REMIND_SENT';
const UNAVAILABLE_WINDOW_CLOSED_AUDIT_ACTION = 'UNAVAILABLE_WINDOW_CLOSED';
const UNAVAILABLE_NONE_REPLY_AUDIT_ACTION = 'UNAVAILABLE_NONE_REPLY';
const UNAVAILABLE_REPLY_STATUS = { ACTIVE: 'ACTIVE', WITHDRAWN: 'WITHDRAWN' };
const UNAVAILABLE_REPLIES_TITLES_TC = ['回覆編號', 'PersonID', '季度', '回覆', '回覆時間', '狀態'];
/** 個人連結頁按鈕（PersonalRoster.html 同一句）。 */
const UNAVAILABLE_NONE_BUTTON_LABEL = '我這一季沒有不能服侍的日子';

/** 時間表自動化開着嗎。 */
function isUnavailableInviteAutoOn_() {
  return getConfig_(CONFIG_KEYS.UNAVAILABLE_INVITE_AUTO, false) === true;
}

/**
 * 這一季用不用時間表（UNAVAILABLE_INVITE_AUTO_FROM_QUARTER 及之後；QuarterID 是「年＋T＋季」，字串比較即可）。
 * @param {string} quarterId
 * @returns {boolean}
 */
function isUnavailableScheduleQuarter_(quarterId) {
  const from = String(getConfig_(CONFIG_KEYS.UNAVAILABLE_INVITE_AUTO_FROM_QUARTER, '2027T2') || '').trim().toUpperCase();
  const id = String(quarterId || '').trim().toUpperCase();
  if (!id) return false;
  return !from || id >= from;
}

/**
 * 時間表各日子（純函式；G 空白 ⇒ 全部空白）。
 * @param {string} generateDate G（yyyy-MM-dd）
 * @returns {{preseasonDate: string, inviteDate: string, remindDate: string, deadline: string, inviteDays: number, listConfirmDays: number, remindDays: number}}
 */
function computeUnavailableSchedule_(generateDate) {
  const num = function (key, d) {
    const n = Number(getConfig_(key, d));
    return isNaN(n) || n < 0 ? d : n;
  };
  const inviteDays = num(CONFIG_KEYS.UNAVAILABLE_INVITE_DAYS_BEFORE_GENERATE, 14);
  const listConfirmDays = num(CONFIG_KEYS.LIST_CONFIRM_DAYS_BEFORE_INVITE, 7);
  const remindDays = num(CONFIG_KEYS.UNAVAILABLE_REMIND_DAYS_BEFORE_DEADLINE, 3);
  const g = String(generateDate || '').trim();
  return {
    preseasonDate: g ? shiftDateString_(g, -(inviteDays + listConfirmDays)) : '',
    inviteDate: g ? shiftDateString_(g, -inviteDays) : '',
    remindDate: g ? shiftDateString_(g, -remindDays) : '',
    deadline: g,
    inviteDays: inviteDays, listConfirmDays: listConfirmDays, remindDays: remindDays
  };
}

/**
 * 這一季是否按時間表運作：時間表自動化開着（UNAVAILABLE_INVITE_AUTO）而且是時間表季度。
 * 自動化關着（預設）⇒ 截止日、季前資料日子、逐次通知全部照舊。
 * @param {string} quarterId
 * @returns {boolean}
 */
function isUnavailableScheduleActive_(quarterId) {
  return isUnavailableInviteAutoOn_() && isUnavailableScheduleQuarter_(quarterId);
}

/**
 * 申報截止日（所有地方同一支）：按時間表運作的季度 ⇒ G；其他 ⇒ G − PERSONAL_UNAVAILABLE_DEADLINE_DAYS（舊計法）。
 * @param {string} quarterId
 * @param {string} generateDate G
 * @returns {string}
 */
function unavailableDeadlineFor_(quarterId, generateDate) {
  if (!generateDate) return '';
  if (isUnavailableScheduleActive_(quarterId)) return generateDate;
  const days = Math.max(0, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_DEADLINE_DAYS, 7)) || 0);
  return shiftDateString_(generateDate, -days);
}

/**
 * 季前資料在生成日之前幾日寄（所有地方同一支）：時間表自動化開着、而且是時間表季度 ⇒ 7＋14；否則 PRESEASON_DAYS_BEFORE。
 * @param {string} quarterId
 * @returns {number}
 */
function preseasonDaysBeforeFor_(quarterId) {
  if (isUnavailableScheduleActive_(quarterId)) {
    const s = computeUnavailableSchedule_('2000-01-01');
    return s.inviteDays + s.listConfirmDays;
  }
  return Number(getConfig_(CONFIG_KEYS.PRESEASON_DAYS_BEFORE, 14));
}

/**
 * 新申報要不要逐次通知（靜默期：時間表自動化開着、UNAVAILABLE_QUIET_DURING_WINDOW、時間表季度、在截止日之前提交）。
 * 截止日之前提交的由「申報期已完結」通知一次過交代；截止日當日及之後提交的照舊逐次通知。
 * @param {string} quarterId 申報的主日落在哪一季
 * @param {string} submittedDay 提交日（yyyy-MM-dd）
 * @param {string} generateDate 那一季的 G
 * @returns {boolean} true＝不逐次通知
 */
function isUnavailableSubmissionQuiet_(quarterId, submittedDay, generateDate) {
  if (getConfig_(CONFIG_KEYS.UNAVAILABLE_QUIET_DURING_WINDOW, true) === false) return false;
  if (!quarterId || !generateDate || !isUnavailableScheduleActive_(quarterId)) return false;
  return String(submittedDay || '') < generateDate;
}

/* ───────────────────────── 「沒有不能服侍的日子」回覆 ───────────────────────── */

function unavailableReplyKeys_() {
  const R = COLUMNS.UNAVAILABLE_REPLIES;
  return [R.REPLY_ID, R.PERSON_ID, R.QUARTER_ID, R.REPLY, R.REPLIED_AT, R.STATUS];
}

/** 取得（必要時建立）`UnavailableReplies` 工作表。 */
function ensureUnavailableRepliesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.UNAVAILABLE_REPLIES);
  if (!sheet) sheet = ss.insertSheet(SHEETS.UNAVAILABLE_REPLIES);
  const keys = unavailableReplyKeys_();
  const existing = sheet.getLastColumn() > 0 ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  if (!keys.every(function (k, i) { return existing[i] === k; })) {
    sheet.getRange(1, 1, 1, UNAVAILABLE_REPLIES_TITLES_TC.length).setValues([UNAVAILABLE_REPLIES_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/**
 * 有效的「沒有不能服侍的日子」回覆：{quarterId: {personId: repliedAt}}。工作表未建立 ⇒ 空。**只讀。**
 * @returns {Object.<string, Object.<string, string>>}
 */
function readUnavailableNoneReplies_() {
  const R = COLUMNS.UNAVAILABLE_REPLIES;
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.UNAVAILABLE_REPLIES)) return out;
  readSheet_(SHEETS.UNAVAILABLE_REPLIES).forEach(function (r) {
    if (String(r[R.STATUS] || '').trim().toUpperCase() !== UNAVAILABLE_REPLY_STATUS.ACTIVE) return;
    const q = String(r[R.QUARTER_ID] || '').trim();
    const p = String(r[R.PERSON_ID] || '').trim();
    if (!q || !p) return;
    if (!out[q]) out[q] = {};
    out[q][p] = String(r[R.REPLIED_AT] || '').trim();
  });
  return out;
}

/**
 * 確認畫面用：按季度列出回覆「沒有」的人（只列還沒有版本的季度；季度、名字排序）。
 * @param {Object.<string, Object.<string, string>>} replies readUnavailableNoneReplies_()
 * @param {Object.<string, string>} names PersonID → 名
 * @returns {Array<{quarterId: string, names: string[]}>}
 */
function listUnavailableNoneReplyGroups_(replies, names) {
  return Object.keys(replies || {}).sort().filter(function (q) {
    return findLatestVersionNo_(q) < 0;
  }).map(function (q) {
    const list = Object.keys(replies[q]).map(function (pid) { return names[pid] || pid; });
    list.sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); });
    return { quarterId: q, names: list };
  }).filter(function (g) { return g.names.length > 0; });
}

/**
 * 寫入「沒有」回覆（none=true）或取消（none=false）。一人一季一行。**會寫入。** 呼叫者要已經拿着鎖。
 * @param {string} personId
 * @param {string} quarterId
 * @param {boolean} none
 * @returns {boolean} 有沒有改動
 */
function setUnavailableNoneReply_(personId, quarterId, none) {
  const R = COLUMNS.UNAVAILABLE_REPLIES;
  const sheet = ensureUnavailableRepliesSheet_();
  const keys = unavailableReplyKeys_();
  const lastRow = sheet.getLastRow();
  const body = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, keys.length).getValues() : [];
  const ci = function (k) { return keys.indexOf(k); };
  let rowIndex = -1;
  for (let i = 0; i < body.length; i++) {
    if (String(body[i][ci(R.PERSON_ID)]).trim() === personId && String(body[i][ci(R.QUARTER_ID)]).trim() === quarterId) { rowIndex = i; break; }
  }
  const status = none ? UNAVAILABLE_REPLY_STATUS.ACTIVE : UNAVAILABLE_REPLY_STATUS.WITHDRAWN;
  if (rowIndex === -1 && !none) return false;
  if (rowIndex !== -1 && String(body[rowIndex][ci(R.STATUS)]).trim().toUpperCase() === status) return false;
  const record = rowIndex === -1 ? keys.map(function () { return ''; }) : body[rowIndex].slice();
  if (rowIndex === -1) {
    record[ci(R.REPLY_ID)] = 'NR-' + quarterId + '-' + personId;
    record[ci(R.PERSON_ID)] = personId;
    record[ci(R.QUARTER_ID)] = quarterId;
    record[ci(R.REPLY)] = 'NONE';
  }
  record[ci(R.REPLIED_AT)] = nowTimestamp_();
  record[ci(R.STATUS)] = status;
  sheet.getRange(rowIndex === -1 ? sheet.getLastRow() + 1 : rowIndex + 3, 1, 1, keys.length).setValues([record]);
  writeAuditLog_({ action: UNAVAILABLE_NONE_REPLY_AUDIT_ACTION, targetSheet: SHEETS.UNAVAILABLE_REPLIES,
    targetKey: quarterId + '|' + personId, newValue: status, source: 'personalReplyNoUnavailable',
    notes: none ? '事奉人員按了〔' + UNAVAILABLE_NONE_BUTTON_LABEL + '〕' : '事奉人員取消了「這一季沒有不能服侍的日子」' });
  return true;
}

/**
 * 〔我這一季沒有不能服侍的日子〕／取消的實際內容（公開函式 personalReplyNoUnavailable 在 PersonalUnavailable.gs）。
 * **只寫這個人自己的那一行**；只可以回覆頁面上列出（仍可申報）的季度。
 * @param {{personId: string}} person 這個人（已核對 token）
 * @param {string} anchorQuarterId 連結的季度（決定頁面列哪幾季）
 * @param {*} quarterId 回覆的季度
 * @param {boolean} none true＝沒有；false＝取消
 * @returns {{ok: boolean, message: string, view: Object}}
 */
function replyNoUnavailable_(person, anchorQuarterId, quarterId, none) {
  const now = personalUnavailableToday_();
  const anchor = typeof anchorQuarterId === 'string' ? anchorQuarterId : '';
  const q = typeof quarterId === 'string' ? quarterId.trim() : '';
  const view = function () { return buildPersonalUnavailableView_(person.personId, now.today, now.timezone, anchor); };
  // 跟提交一樣：分階段開放時，未開放的人不可以回覆（伺服器端把關）
  if (!isPersonalDeclareAllowed_(person.personId, now.timezone, now.today)) {
    return { ok: false, message: fillContactName_(ROLLOUT_DECLARE_CLOSED_TEXT), view: null, closed: true };
  }
  const open = listPersonalUnavailableQuarters_(now.today, now.timezone, anchor).map(function (x) { return x.quarterId; });
  if (!q || open.indexOf(q) === -1) return { ok: false, message: '這一季已經不可以回覆。', view: view() };
  setUnavailableNoneReply_(person.personId, q, none === true);
  return { ok: true,
    message: none === true ? '已記錄：這一季沒有不能服侍的日子。你不會收到截止日之前的提醒。' : '已取消。如有不能服侍的日子，請在下面申報。',
    view: view() };
}

/* ───────────────────────── 每日檢查 ───────────────────────── */

/**
 * 這一季這一步做過了嗎（AuditLog）。真正寄出過（第三段 SENT，人手或自動）一定算；
 * 自動模擬（AUTO…DRY_RUN）只在現時仍是 DRY_RUN 時算——不會每日重複模擬，而上線（DRY_RUN=FALSE）之後仍然會真正寄一次。
 * @param {string} action AuditLog ACTION
 * @param {string} quarterId
 * @returns {boolean}
 */
function hasUnavailableScheduleRecord_(action, quarterId) {
  const A = COLUMNS.AUDIT_LOG;
  const dryNow = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  return readSheet_(SHEETS.AUDIT_LOG).some(function (row) {
    if (row[A.ACTION] !== action || String(row[A.TARGET_KEY] || '').trim() !== quarterId) return false;
    const parts = String(row[A.NEW_VALUE] || '').split('|');
    const outcome = String(parts[2] || '').trim().toUpperCase();
    if (outcome === 'SENT') return true;
    return dryNow && parts[0] === 'AUTO' && outcome === 'DRY_RUN';
  });
}

/**
 * 還沒有回覆的人（收到邀請的人之中：這一季沒有任何申報，也沒有「沒有」回覆）。純函式。
 * @param {Object[]} recipients 邀請的收件人 {personId,...}
 * @param {Object[]} submissions readUnavailableSubmissions_()
 * @param {string} startDate 季度開始日
 * @param {string} endDate 季度結束日
 * @param {Object.<string, string>} noneReplies 這一季的「沒有」回覆 {personId: at}
 * @returns {Object[]}
 */
function pickUnrepliedInvitees_(recipients, submissions, startDate, endDate, noneReplies) {
  const replied = {};
  (submissions || []).forEach(function (s) {
    if (s.serviceDate >= startDate && s.serviceDate <= endDate) replied[s.personId] = true;
  });
  Object.keys(noneReplies || {}).forEach(function (id) { replied[id] = true; });
  return (recipients || []).filter(function (r) { return !replied[r.personId]; });
}

/**
 * 每日檢查：時間表的各步（申報連結、提醒、完結通知）。季前資料那一步仍然由 runPreseasonAutoSend_() 做（日子見 preseasonDaysBeforeFor_()）。
 * @param {Object} quarterRow Quarters 一行
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @param {boolean} isDryRun
 * @returns {Object[]} 報告 {quarterId, action, outcome, detail}
 */
function runUnavailableScheduleSteps_(quarterRow, today, config, isDryRun) {
  const Q = COLUMNS.QUARTERS;
  const quarterId = String(quarterRow[Q.QUARTER_ID] || '').trim();
  const row = function (action, outcome, detail) { return { quarterId: quarterId, action: action, outcome: outcome, detail: detail }; };
  if (!isUnavailableInviteAutoOn_()) return [row('UNAVAILABLE_SCHEDULE', 'SKIP', 'DISABLED')];
  if (!isUnavailableScheduleQuarter_(quarterId)) return [row('UNAVAILABLE_SCHEDULE', 'SKIP', 'BEFORE_FROM_QUARTER')];
  const generateDate = readPreseasonGenerateDate_(quarterRow, config);
  if (!generateDate) return [row('UNAVAILABLE_SCHEDULE', 'SKIP', 'NO_GENERATE_DATE')];
  if (findLatestVersionNo_(quarterId) >= 0) return [row('UNAVAILABLE_SCHEDULE', 'SKIP', 'HAS_VERSION')];
  const s = computeUnavailableSchedule_(generateDate);
  const out = [];
  const invited = hasUnavailableScheduleRecord_(UNAVAILABLE_INVITE_AUDIT_ACTION, quarterId);

  // G−14：申報連結
  if (today >= s.inviteDate && today < s.deadline && !invited) {
    const r = sendUnavailableInvites_(quarterId, null, { mode: 'AUTO', source: 'dailyAutomationCheck_' });
    out.push(row('UNAVAILABLE_INVITE', 'SENT', (r.dryRun ? '模擬 ' + r.simulated : '寄出 ' + r.sent) + ' 封申報連結（截止日 ' + s.deadline + '）'));
  } else {
    out.push(row('UNAVAILABLE_INVITE', 'SKIP', invited ? 'ALREADY_DONE' : (today < s.inviteDate ? 'NOT_DUE' : 'WINDOW_PASSED')));
  }
  const invitedNow = invited || out[0].outcome === 'SENT';

  // G−3：提醒未回覆的人
  if (invitedNow && today >= s.remindDate && today < s.deadline && !hasUnavailableScheduleRecord_(UNAVAILABLE_REMIND_AUDIT_ACTION, quarterId)) {
    const r = sendUnavailableReminders_(quarterId, quarterRow, today, config);
    out.push(row('UNAVAILABLE_REMIND', 'SENT', (r.dryRun ? '模擬 ' + r.simulated : '寄出 ' + r.sent) + ' 封提醒（未回覆 ' + r.unreplied + ' 位）'));
  } else {
    out.push(row('UNAVAILABLE_REMIND', 'SKIP', !invitedNow ? 'NOT_INVITED' : (today < s.remindDate ? 'NOT_DUE' : 'DONE_OR_PASSED')));
  }

  // G：申報期已完結
  if (invitedNow && today >= s.deadline && !hasUnavailableScheduleRecord_(UNAVAILABLE_WINDOW_CLOSED_AUDIT_ACTION, quarterId)) {
    const r = sendUnavailableWindowClosed_(quarterId, s.deadline, config, isDryRun);
    out.push(row('UNAVAILABLE_WINDOW_CLOSED', 'SENT', (r.dryRun ? '模擬' : '') + '通知幹事、堂委：申報期已完結，' + r.pendingCount + ' 份待確認'));
  } else {
    out.push(row('UNAVAILABLE_WINDOW_CLOSED', 'SKIP', !invitedNow ? 'NOT_INVITED' : (today < s.deadline ? 'NOT_DUE' : 'ALREADY_DONE')));
  }
  return out;
}

/**
 * G−3 提醒：只寄給收到邀請（開放範圍的預設收件人）而未有任何回覆的人。**會寄信**（DRY_RUN 只模擬）＋AuditLog。
 * @returns {{dryRun: boolean, sent: number, simulated: number, unreplied: number}}
 */
function sendUnavailableReminders_(quarterId, quarterRow, today, config) {
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const who = resolveInviteAudience_(null, today);
  const start = toDateString_(quarterRow[COLUMNS.QUARTERS.START_DATE], timezone);
  const end = toDateString_(quarterRow[COLUMNS.QUARTERS.END_DATE], timezone);
  const unreplied = pickUnrepliedInvitees_(who.recipients, readUnavailableSubmissions_(timezone), start, end,
    readUnavailableNoneReplies_()[quarterId] || {});
  const r = sendUnavailableInvites_(quarterId, { recipients: unreplied, noEmail: [], noLink: [] },
    { mode: 'AUTO', source: 'dailyAutomationCheck_', templateId: UNAVAILABLE_REMIND_TEMPLATE_ID, auditAction: UNAVAILABLE_REMIND_AUDIT_ACTION,
      noteLabel: '截止日前提醒' });
  return { dryRun: r.dryRun, sent: r.sent, simulated: r.simulated, unreplied: unreplied.length };
}

/**
 * G：申報期已完結 ⇒ 幹事（MAIL_ADMIN_NOTIFY）＋現任堂委。**會寄信**（DRY_RUN 只模擬）＋AuditLog。
 * @returns {{dryRun: boolean, pendingCount: number, recipients: number}}
 */
function sendUnavailableWindowClosed_(quarterId, deadline, config, isDryRun) {
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const pendingCount = countPendingSubmissionsForQuarterSafe_(quarterId);
  const tpl = findEmailTemplateById_(UNAVAILABLE_WINDOW_CLOSED_TEMPLATE_ID)
    || EMAIL_TEMPLATE_SEEDS.filter(function (t) { return t.templateId === UNAVAILABLE_WINDOW_CLOSED_TEMPLATE_ID; })[0];
  const placeholders = buildUnavailableWindowClosedPlaceholders_(quarterId, deadline, pendingCount);
  const recipients = readUnavailableWindowClosedRecipients_(config, today);
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const who = { displayName: '', email: '' };
  notifyAdmin_(prefix + applyPlaceholders_(tpl.subject, placeholders, who, ''), applyPlaceholders_(tpl.bodyPlain, placeholders, who, ''),
    recipients.join(','), isDryRun);
  const dryRun = isDryRun || getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  writeAuditLog_({ action: UNAVAILABLE_WINDOW_CLOSED_AUDIT_ACTION, targetSheet: SHEETS.QUARTERS, targetKey: quarterId,
    newValue: 'AUTO|' + today + '|' + (dryRun ? 'DRY_RUN' : 'SENT'), source: 'dailyAutomationCheck_',
    notes: '申報期已完結（截止日 ' + deadline + '）：' + pendingCount + ' 份待確認；收件人 ' + recipients.length + ' 個' });
  return { dryRun: dryRun, pendingCount: pendingCount, recipients: recipients.length };
}

/** 完結通知的佔位符（範本樣本共用）。 */
function buildUnavailableWindowClosedPlaceholders_(quarterId, deadline, pendingCount) {
  const url = buildUnavailableConfirmUrl_(quarterId);
  return { QuarterLabel: buildQuarterLabel_(quarterId), QuarterID: quarterId, Deadline: deadline || '截止日',
    PendingCount: String(pendingCount), ConfirmUrl: url || '（幹事介面「開季前準備 ▸ 不能服侍的日期」最上面）' };
}

/** 完結通知收件人：MAIL_ADMIN_NOTIFY＋現任堂委（有電郵的；去重）。 */
function readUnavailableWindowClosedRecipients_(config, today) {
  const out = [];
  const seen = {};
  const add = function (e) {
    const v = String(e || '').trim();
    if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; out.push(v); }
  };
  String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '').split(/[,;、\s]+/).forEach(add);
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const people = readAudiencePeople_();
  buildRolloutLeaderLookup_(timezone, today).committee.forEach(function (id) { add((people[id] || {}).email); });
  return out;
}
