/**
 * 第一百零一輪批次 ZB／ZE 組：第一階段開放範圍（Config `ROLLOUT_AUDIENCE`）。
 *
 *   LEADERS（預設）＝第一階段：申報不能服侍的日子只開放給現任堂委、執事及幹事。
 *   ALL　　　　　　＝全部事奉人員。
 *
 * 「幹事」＝電郵在 `WEBAPP_ALLOWED_EMAILS` 或 `MAIL_ADMIN_NOTIFY` 的人（按 NameMapping 的實際電郵對應），
 * 加上 Roles 身分 CLERK（幹事）。堂委、執事以今日的 Roles 為準。
 *
 * 用的地方（同一個判斷，不要另寫）：
 *   ・電郵內個人專屬連結那一行（PersonalLinkInMail.gs）
 *   ・個人連結頁的申報區（WebAppPersonalLink.gs）及提交申報的 api（伺服器端把關）
 *   ・收件人選擇的「全部事奉人員」「指定的人」可不可以選（SendAudience.gs）
 */

const ROLLOUT_AUDIENCE = {
  LEADERS: 'LEADERS',
  ALL: 'ALL'
};

/** 第一階段時個人連結頁申報區顯示的一句（{ContactName} 由 ROSTER_CONTACT_TC 代入）。 */
const ROLLOUT_DECLARE_CLOSED_TEXT = '申報不能服侍的日子暫時未開放。如有不能服侍的日子，請直接與{ContactName}聯絡。';

/** 收件人選擇不可選時旁邊那一句。 */
const ROLLOUT_LEADERS_ONLY_NOTE = '現時是第一階段，只開放給堂委、執事及幹事。';

/**
 * @returns {string} ROLLOUT_AUDIENCE 之一；認不出 ⇒ LEADERS（較安全）
 */
function readRolloutAudience_() {
  const v = String(getConfig_(CONFIG_KEYS.ROLLOUT_AUDIENCE, ROLLOUT_AUDIENCE.LEADERS) || '').trim().toUpperCase();
  return v === ROLLOUT_AUDIENCE.ALL ? ROLLOUT_AUDIENCE.ALL : ROLLOUT_AUDIENCE.LEADERS;
}

/**
 * 幹事聯絡人稱呼（Config `ROSTER_CONTACT_TC`，預設「幹事」）。
 * @returns {string}
 */
function readRosterContactName_() {
  const v = String(getConfig_(CONFIG_KEYS.ROSTER_CONTACT_TC, '幹事') || '').trim();
  return v || '幹事';
}

/**
 * 把一段文字的 {ContactName} 換成幹事聯絡人稱呼。
 * @param {string} text
 * @returns {string}
 */
function fillContactName_(text) {
  return String(text || '').split('{ContactName}').join(readRosterContactName_());
}

/**
 * 電郵名單（逗號、分號、頓號、空白分隔），全部小寫。
 * @param {*} raw Config 值（LIST 會是陣列）
 * @returns {string[]}
 */
function splitRolloutEmails_(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,，;；、\s]+/);
  return list.map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
}

/**
 * 幹事的電郵（WEBAPP_ALLOWED_EMAILS ∪ MAIL_ADMIN_NOTIFY），小寫、不重複。
 * @returns {string[]}
 */
function readRolloutAdminEmails_() {
  const out = [];
  splitRolloutEmails_(getConfig_(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, []))
    .concat(splitRolloutEmails_(getConfig_(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, '')))
    .forEach(function (e) { if (out.indexOf(e) === -1) out.push(e); });
  return out;
}

/**
 * 現任堂委、執事、幹事（以 dateStr 為準）。
 * @param {string} timezone
 * @param {string} dateStr yyyy-MM-dd
 * @returns {{committee: string[], deacon: string[], admin: string[], isLeader: function(string): boolean}}
 */
function buildRolloutLeaderLookup_(timezone, dateStr) {
  const committee = [];
  const deacon = [];
  const admin = [];
  const push = function (list, id) { if (id && list.indexOf(id) === -1) list.push(id); };
  readRolesSafe_(timezone).forEach(function (r) {
    if (!isEffectiveOn_(r.effectiveFrom, r.effectiveTo, dateStr)) return;
    if (r.roleCode === ROLE_CODES.COMMITTEE) push(committee, r.personId);
    else if (r.roleCode === ROLE_CODES.DEACON) push(deacon, r.personId);
    else if (r.roleCode === ROLE_CODES.CLERK) push(admin, r.personId);
  });
  const adminEmails = readRolloutAdminEmails_();
  if (adminEmails.length > 0) {
    readPeople_().forEach(function (row) {
      const email = String(effectivePersonEmail_(row) || '').trim().toLowerCase();
      if (email && adminEmails.indexOf(email) !== -1) push(admin, String(row[COLUMNS.NAME_MAPPING.PERSON_ID] || '').trim());
    });
  }
  const set = {};
  committee.concat(deacon, admin).forEach(function (id) { set[id] = true; });
  return {
    committee: committee, deacon: deacon, admin: admin,
    isLeader: function (personId) { return set[String(personId || '').trim()] === true; }
  };
}

/**
 * 這個人可不可以用個人連結申報不能服侍的日子。ALL ⇒ 一律可以；LEADERS ⇒ 只限堂委、執事、幹事。
 * @param {string} personId
 * @param {string} timezone
 * @param {string} dateStr
 * @param {Object=} lookup 已建好的 buildRolloutLeaderLookup_()（同一批多人時重用）
 * @returns {boolean}
 */
function isPersonalDeclareAllowed_(personId, timezone, dateStr, lookup) {
  if (readRolloutAudience_() === ROLLOUT_AUDIENCE.ALL) return true;
  const l = lookup || buildRolloutLeaderLookup_(timezone, dateStr);
  return l.isLeader(personId);
}

/**
 * 寄信時用：這位收件人信內的個人連結那一行可不可以提申報。同一批信只建一次名單（記在 context）。
 * 讀不到身分資料 ⇒ 當作不可以（較安全：只寫「只供查看」）。
 * @param {Object} context 寄信 context（有 timezone）
 * @param {string} personId
 * @returns {boolean}
 */
function isMailDeclareAllowed_(context, personId) {
  try {
    if (readRolloutAudience_() === ROLLOUT_AUDIENCE.ALL) return true;
    if (!context._rolloutLookup) {
      const tz = context.timezone || getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
      context._rolloutLookup = buildRolloutLeaderLookup_(tz, Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
    }
    return context._rolloutLookup.isLeader(personId);
  } catch (err) {
    log_('WARN', '判斷第一階段開放範圍時出錯（個人連結那一行改為只供查看）：' + err.message);
    return false;
  }
}
