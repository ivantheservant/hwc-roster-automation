/**
 * 第九十輪批次 QC 組：開季前準備〔寄出申報邀請〕——請義工用自己的個人專屬連結申報不能服侍。
 *
 * ── 收件人 ───────────────────────────────────────────────────────
 * 這一季事奉人員表上的人：自動排的崗位（「堂委」「執事」按今日現任展開）＋ `SAME_DAY_EXCLUSIVE_POST_IDS`
 * 的崗位（領詩、司琴）＋ 詩班名單；`NameMapping.Active`。每人一封，內有他自己的個人專屬連結（q＝這一季）、
 * 截止日（生成日之前 `PERSONAL_UNAVAILABLE_DEADLINE_DAYS` 日）、怎樣申報。
 * 沒有電郵的人在預覽列出「請幹事代為輸入」；沒有個人連結 token 的人同樣列出（不寄）。
 *
 * ── 紀錄 ─────────────────────────────────────────────────────────
 * 遵守 DRY_RUN、MAIL_REDIRECT_ALL_TO（sendRealEmail_ 套用）、主旨測試前綴。只寫 AuditLog（UNAVAILABLE_INVITE_SENT），
 * 模擬和真正寄出分開（NEW_VALUE 第三段 DRY_RUN／SENT，照第八十六輪 MA 組的做法）。不寫 SendLog、不改 Stage。
 * AuditLog 不寫個人連結（連結內有 token）。
 */

const UNAVAILABLE_INVITE_TEMPLATE_ID = 'TPL_UNAVAILABLE_INVITE_TC';
const UNAVAILABLE_INVITE_AUDIT_ACTION = 'UNAVAILABLE_INVITE_SENT';

/** 預設範本（EmailTemplates 沒有這一行時用；「補齊 Email 範本」會加入）。 */
function unavailableInviteTemplateDefault_() {
  return EMAIL_TEMPLATE_SEEDS.filter(function (t) { return t.templateId === UNAVAILABLE_INVITE_TEMPLATE_ID; })[0];
}

/**
 * 收件人（這一季事奉人員表上的人）。**只讀。**
 * @param {string} todayStr 今日（「堂委」「執事」以這一日的現任為準）
 * @returns {{recipients: Object[], noEmail: string[], noLink: string[]}}
 *   recipients：{personId, displayName, email, token}（token 只留在伺服器端，預覽不回傳）
 */
function buildUnavailableInviteRecipients_(todayStr) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const posts = readPostsNormalized_({ includeGroups: true });
  const sameDay = readSameDayExclusivePostIds_();
  const choirId = readChoirGroupPostId_();
  const postIds = posts.filter(function (p) {
    if (p.postId === choirId) return true;
    if (p.showInRoster === false) return false;
    return p.autoGenerate === true || sameDay.indexOf(p.postId) !== -1;
  }).map(function (p) { return p.postId; });
  const eligibility = readEligibility_();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  const ctx = { eligibility: eligibility, roles: roleContext.roles };
  const wanted = {};
  postIds.forEach(function (postId) {
    (roleContext.eligibleByPost[postId] || []).forEach(function (id) {
      if (!eligibilityRoleTokenFailure_(ctx, postId, id, todayStr)) wanted[id] = true;
    });
  });
  const M = COLUMNS.NAME_MAPPING;
  const recipients = [];
  const noEmail = [];
  const noLink = [];
  readPeople_().forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (!id || !wanted[id]) return;
    const name = String(row[M.NAME_TC] || '').trim() || id;
    const email = String(row[M.EMAIL] || '').trim();
    const token = String(row[M.PERSONAL_LINK_TOKEN] || '').trim();
    if (!email) { noEmail.push(name); return; }
    if (!token) { noLink.push(name); return; }
    recipients.push({ personId: id, displayName: name, email: email, token: token });
  });
  recipients.sort(function (a, b) { return a.displayName < b.displayName ? -1 : (a.displayName > b.displayName ? 1 : 0); });
  return { recipients: recipients, noEmail: noEmail.sort(), noLink: noLink.sort() };
}

/**
 * 這一季的生成日、截止日。
 * @param {string} quarterId 季度 ID
 * @returns {{generateDate: string, deadline: string}}
 */
function readUnavailableInviteDates_(quarterId) {
  const row = findQuarter_(quarterId);
  const generateDate = row ? readPreseasonGenerateDate_(row, readConfig_()) : '';
  const days = Math.max(0, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_DEADLINE_DAYS, 7)) || 0);
  return { generateDate: generateDate, deadline: generateDate ? shiftDateString_(generateDate, -days) : '' };
}

/**
 * 這一季寄申報邀請的紀錄（最後一筆；分開記真正寄出那一筆）。
 * @param {string} quarterId 季度 ID
 * @returns {?{date: string, simulated: boolean, real: ?{date: string}}}
 */
function readUnavailableInviteRecord_(quarterId) {
  const A = COLUMNS.AUDIT_LOG;
  let found = null;
  let real = null;
  readSheet_(SHEETS.AUDIT_LOG).forEach(function (row) {
    if (row[A.ACTION] !== UNAVAILABLE_INVITE_AUDIT_ACTION) return;
    if (String(row[A.TARGET_KEY] || '').trim() !== quarterId) return;
    const parts = String(row[A.NEW_VALUE] || '').split('|');
    const simulated = String(parts[2] || '').trim().toUpperCase() !== 'SENT';
    found = { date: parts[1] || '', simulated: simulated };
    if (!simulated) real = { date: parts[1] || '' };
  });
  if (found) found.real = real;
  return found;
}

/**
 * 供前端呼叫：〔寄出申報邀請〕預覽（人數、沒有電郵的人）。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiUnavailableInvitePreview(quarterId) {
  assertWebAppRequestAllowed_('apiUnavailableInvitePreview');
  const id = String(quarterId || '').trim();
  beginSheetReadMemo_();
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const who = buildUnavailableInviteRecipients_(today);
    const dates = readUnavailableInviteDates_(id);
    return {
      quarterId: id,
      quarterLabel: buildQuarterLabel_(id),
      generateDate: dates.generateDate,
      deadline: dates.deadline,
      recipientCount: who.recipients.length,
      recipientNames: who.recipients.map(function (r) { return r.displayName; }),
      noEmail: who.noEmail,
      noLink: who.noLink,
      baseUrlMissing: !String(getConfig_(CONFIG_KEYS.WEBAPP_VOLUNTEER_URL, '') || '').trim(),
      dryRun: getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false,
      sentRecord: readUnavailableInviteRecord_(id)
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：〔寄出〕申報邀請。
 * @param {string} quarterId 季度 ID
 * @returns {Object} sendUnavailableInvites_() 的結果
 */
function apiUnavailableInviteSend(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('寄出申報邀請', function () {
    return sendUnavailableInvites_(String(quarterId || '').trim());
  });
}

/**
 * 寄出申報邀請。**會寄信**（DRY_RUN 時只模擬）＋寫 AuditLog。
 * @param {string} quarterId 季度 ID
 * @returns {{dryRun: boolean, sent: number, simulated: number, failed: Object[], noEmail: string[], noLink: string[]}}
 */
function sendUnavailableInvites_(quarterId) {
  const config = readConfig_();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const baseUrl = String(config[CONFIG_KEYS.WEBAPP_VOLUNTEER_URL] || '').trim();
  if (!baseUrl) {
    throw new Error(buildThreePartMessage_('還沒有設定義工個人連結的網址（Config WEBAPP_VOLUNTEER_URL）。',
      '一封都沒有寄出。', ['請管理員先在 Config 填上個人連結部署的 /exec 網址']));
  }
  const who = buildUnavailableInviteRecipients_(today);
  const dates = readUnavailableInviteDates_(quarterId);
  const tpl = findEmailTemplateById_(UNAVAILABLE_INVITE_TEMPLATE_ID) || unavailableInviteTemplateDefault_();
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const dryRun = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  const context = { senderName: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || ''), replyTo: String(config[CONFIG_KEYS.MAIL_REPLY_TO] || '') };
  let sent = 0;
  let simulated = 0;
  const failed = [];
  who.recipients.forEach(function (r) {
    const placeholders = {
      QuarterLabel: buildQuarterLabel_(quarterId), QuarterID: quarterId,
      GenerateDate: dates.generateDate || '生成日', Deadline: dates.deadline || '生成日之前',
      PersonalLink: buildPersonalRosterUrl_(baseUrl, r.token, quarterId)
    };
    const subject = prefix + applyPlaceholders_(tpl.subject, placeholders, r, '');
    const html = applyPlaceholders_(tpl.bodyHtml, placeholders, r, '');
    const plain = applyPlaceholders_(tpl.bodyPlain, placeholders, r, '');
    if (dryRun) { simulated++; return; }
    try {
      sendRealEmail_({ email: r.email, displayName: r.displayName }, subject, html, plain, context, null, null);
      sent++;
    } catch (err) {
      failed.push({ name: r.displayName, error: err.message });
    }
  });
  writeAuditLog_({
    action: UNAVAILABLE_INVITE_AUDIT_ACTION,
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    oldValue: '',
    newValue: 'MANUAL|' + today + '|' + (dryRun ? 'DRY_RUN' : 'SENT'),
    source: 'apiUnavailableInviteSend',
    notes: (dryRun ? '模擬 ' + simulated : '寄出 ' + sent) + ' 封申報邀請（截止日 ' + (dates.deadline || '未定') + '）'
      + (failed.length ? '；失敗 ' + failed.length + ' 封：' + failed.map(function (f) { return f.name; }).join('、') : '')
      + (who.noEmail.length ? '；沒有電郵：' + who.noEmail.join('、') : '')
      + (who.noLink.length ? '；沒有個人連結：' + who.noLink.join('、') : '')
  });
  return { dryRun: dryRun, sent: sent, simulated: simulated, failed: failed, noEmail: who.noEmail, noLink: who.noLink };
}
