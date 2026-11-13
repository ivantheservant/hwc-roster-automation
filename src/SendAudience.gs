/**
 * 第一百零一輪批次 ZE-1：收件人選擇（共用元件的伺服器端）。
 *
 * 用於〔寄出季前資料〕（purpose＝PRESEASON）及〔寄出／匯出申報不能服侍日子連結〕（purpose＝INVITE）。
 * 可以勾：「堂委（現任 N 位）」「執事（現任 N 位）」「幹事」「全部事奉人員（N 位）」「指定的人」（從名單選人，可多選；
 * 季前資料亦可以輸入電郵）。確認前列出全部收件人（名字＋有沒有電郵；同一地址只收一封）。
 *
 * 第一階段（ROLLOUT_AUDIENCE=LEADERS，見 RolloutAudience.gs）：「全部事奉人員」及非堂委／執事／幹事的「指定的人」不可選；
 * **伺服器端同樣把關**（resolveAudienceSelection_() 拋錯），不只靠介面。
 *
 * 預設：季前資料＝堂委＋執事＋幹事；申報連結＝按開放範圍（LEADERS ⇒ 堂委＋執事＋幹事；ALL ⇒ 全部事奉人員）。
 * 其他會寄給幹事以外的人的介面動作（寄給堂委審閱、正式發出、改動後重發、補寄等）這一輪不改。
 */

const AUDIENCE_PURPOSE = { PRESEASON: 'PRESEASON', INVITE: 'INVITE' };
const AUDIENCE_GROUP = { COMMITTEE: 'COMMITTEE', DEACON: 'DEACON', ADMIN: 'ADMIN', ALL: 'ALL' };

/**
 * 名單上的人（在職）：{personId: {personId, name, email}}。
 * @returns {Object.<string, Object>}
 */
function readAudiencePeople_() {
  const M = COLUMNS.NAME_MAPPING;
  const out = {};
  readPeople_().forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (!id) return;
    out[id] = { personId: id, name: String(row[M.NAME_TC] || '').trim() || id, email: String(effectivePersonEmail_(row) || '').trim(),
      preferred: usesPreferredEmail_(row) };   // 第一百零五輪批次 RA 組：用指定寄信電郵
  });
  return out;
}

/**
 * 各組的人（PersonID）。全部事奉人員＝這一季事奉人員表上的人（和申報邀請同一份：listUnavailableInviteCandidateIds_）。
 * @param {string} todayStr
 * @returns {{committee: string[], deacon: string[], admin: string[], all: string[], adminEmails: string[], lookup: Object}}
 */
function buildAudienceGroups_(todayStr) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const lookup = buildRolloutLeaderLookup_(timezone, todayStr);
  const all = Object.keys(listUnavailableInviteCandidateIds_(todayStr)).sort();
  return { committee: lookup.committee.slice(), deacon: lookup.deacon.slice(), admin: lookup.admin.slice(), all: all,
    adminEmails: readRolloutAdminEmails_(), lookup: lookup };
}

/**
 * 這個用途的預設勾選。
 * @param {string} purpose AUDIENCE_PURPOSE
 * @param {string} rollout ROLLOUT_AUDIENCE
 * @returns {string[]} AUDIENCE_GROUP
 */
function defaultAudienceGroups_(purpose, rollout) {
  if (purpose === AUDIENCE_PURPOSE.INVITE && rollout === ROLLOUT_AUDIENCE.ALL) return [AUDIENCE_GROUP.ALL];
  return [AUDIENCE_GROUP.COMMITTEE, AUDIENCE_GROUP.DEACON, AUDIENCE_GROUP.ADMIN];
}

/**
 * 畫面用的選項（唯讀）。
 * @param {string} purpose AUDIENCE_PURPOSE
 * @param {string} todayStr
 * @returns {Object}
 */
function buildAudienceOptions_(purpose, todayStr) {
  const rollout = readRolloutAudience_();
  const leadersOnly = rollout === ROLLOUT_AUDIENCE.LEADERS;
  const g = buildAudienceGroups_(todayStr);
  const people = readAudiencePeople_();
  const groups = [
    { id: AUDIENCE_GROUP.COMMITTEE, label: '堂委（現任 ' + g.committee.length + ' 位）', allowed: true, note: '' },
    { id: AUDIENCE_GROUP.DEACON, label: '執事（現任 ' + g.deacon.length + ' 位）', allowed: true, note: '' },
    { id: AUDIENCE_GROUP.ADMIN, label: '幹事', allowed: true, note: '' },
    { id: AUDIENCE_GROUP.ALL, label: '全部事奉人員（' + g.all.length + ' 位）', allowed: !leadersOnly,
      note: leadersOnly ? ROLLOUT_LEADERS_ONLY_NOTE : '' }
  ];
  const list = Object.keys(people).map(function (id) {
    const p = people[id];
    const allowed = !leadersOnly || g.lookup.isLeader(id);
    return { personId: id, name: p.name, hasEmail: !!p.email, allowed: allowed };
  }).sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  return {
    purpose: purpose, rollout: rollout, leadersOnly: leadersOnly, leadersOnlyNote: ROLLOUT_LEADERS_ONLY_NOTE,
    groups: groups, people: list, defaults: defaultAudienceGroups_(purpose, rollout),
    allowEmails: purpose === AUDIENCE_PURPOSE.PRESEASON
  };
}

/**
 * 把勾選變成收件人。同一地址只收一封。第一階段違規 ⇒ 拋錯（伺服器端把關）。
 * @param {string} purpose AUDIENCE_PURPOSE
 * @param {?{groups: string[], personIds: string[], emails: string[]}} selection 不傳 ⇒ 預設
 * @param {string} todayStr
 * @returns {{people: Object[], noEmail: Object[], extra: Object[], selection: Object}}
 *   people：{personId, displayName, email, why}；noEmail：{personId, displayName, why}；extra：{email, displayName, why}（輸入的電郵）
 */
function resolveAudienceSelection_(purpose, selection, todayStr) {
  const rollout = readRolloutAudience_();
  const leadersOnly = rollout === ROLLOUT_AUDIENCE.LEADERS;
  const g = buildAudienceGroups_(todayStr);
  const people = readAudiencePeople_();
  const sel = selection && typeof selection === 'object' ? selection : { groups: defaultAudienceGroups_(purpose, rollout) };
  const groups = (Array.isArray(sel.groups) ? sel.groups : []).map(function (x) { return String(x || '').trim().toUpperCase(); });
  const pickIds = (Array.isArray(sel.personIds) ? sel.personIds : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  const emails = (Array.isArray(sel.emails) ? sel.emails : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);

  if (leadersOnly && groups.indexOf(AUDIENCE_GROUP.ALL) !== -1) {
    throw new Error(buildThreePartMessage_('「全部事奉人員」現時不可以選。' + ROLLOUT_LEADERS_ONLY_NOTE,
      '一封都沒有寄出。', ['只選堂委、執事、幹事或指定的堂委／執事／幹事', '要開放給全部事奉人員：在〔使用權限〕把開放範圍改為「全部事奉人員」']));
  }
  const notLeader = pickIds.filter(function (id) { return leadersOnly && !g.lookup.isLeader(id); });
  if (notLeader.length > 0) {
    throw new Error(buildThreePartMessage_('指定的人之中有 ' + notLeader.length + ' 位不是堂委、執事或幹事。' + ROLLOUT_LEADERS_ONLY_NOTE,
      '一封都沒有寄出。', ['把那幾位剔走，再試一次']));
  }
  if (emails.length > 0 && purpose !== AUDIENCE_PURPOSE.PRESEASON) {
    throw new Error('申報連結是每人一條的個人連結，只可以寄給名單上的人，不可以輸入電郵。');
  }
  const bad = emails.filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
  if (bad.length > 0) throw new Error('這幾個電郵格式不對：' + bad.join('、') + '。一封都沒有寄出。');

  const whyById = {};
  const order = [];
  const addId = function (id, why) {
    if (!id) return;
    if (!whyById[id]) { whyById[id] = []; order.push(id); }
    if (whyById[id].indexOf(why) === -1) whyById[id].push(why);
  };
  if (groups.indexOf(AUDIENCE_GROUP.COMMITTEE) !== -1) g.committee.forEach(function (id) { addId(id, '堂委'); });
  if (groups.indexOf(AUDIENCE_GROUP.DEACON) !== -1) g.deacon.forEach(function (id) { addId(id, '執事'); });
  if (groups.indexOf(AUDIENCE_GROUP.ADMIN) !== -1) g.admin.forEach(function (id) { addId(id, '幹事'); });
  if (groups.indexOf(AUDIENCE_GROUP.ALL) !== -1) g.all.forEach(function (id) { addId(id, '事奉人員'); });
  pickIds.forEach(function (id) { addId(id, '指定'); });

  const seenEmail = {};
  const out = [];
  const noEmail = [];
  order.forEach(function (id) {
    const p = people[id] || { personId: id, name: id, email: '' };
    const why = whyById[id].join('、');
    if (!p.email) { noEmail.push({ personId: id, displayName: p.name, why: why }); return; }
    // 申報連結是每人一條 ⇒ 按人（同一個地址的兩個人各收自己那一封）；季前資料按地址（同一地址只收一封）
    const k = purpose === AUDIENCE_PURPOSE.INVITE ? ('id:' + id) : p.email.toLowerCase();
    if (seenEmail[k]) { seenEmail[k].why += '、' + why; return; }
    seenEmail[k] = { personId: id, displayName: p.name, email: p.email, why: why, preferred: !!p.preferred };
    if (purpose !== AUDIENCE_PURPOSE.INVITE) seenEmail[p.email.toLowerCase()] = seenEmail[k];
    out.push(seenEmail[k]);
  });
  const extra = [];
  const addEmail = function (e, label, why) {
    const k = e.toLowerCase();
    if (seenEmail[k]) { if (seenEmail[k].why.indexOf(why) === -1) seenEmail[k].why += '、' + why; return; }
    seenEmail[k] = { personId: '', displayName: label || e, email: e, why: why };
    extra.push(seenEmail[k]);
  };
  // 幹事組：MAIL_ADMIN_NOTIFY／WEBAPP_ALLOWED_EMAILS 對應不到名單上的人 ⇒ 季前資料照寄那個地址（申報連結要個人連結，寄不到）
  if (groups.indexOf(AUDIENCE_GROUP.ADMIN) !== -1 && purpose === AUDIENCE_PURPOSE.PRESEASON) {
    splitRolloutEmails_(getConfig_(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, '')).forEach(function (e) { addEmail(e, '幹事', '幹事'); });
  }
  // 季前資料一向都寄 Config PRESEASON_EXTRA_RECIPIENTS（額外收件人），不論勾了甚麼
  if (purpose === AUDIENCE_PURPOSE.PRESEASON) {
    splitRolloutEmails_(getConfig_(CONFIG_KEYS.PRESEASON_EXTRA_RECIPIENTS, '')).forEach(function (e) { addEmail(e, e, '額外收件人'); });
  }
  emails.forEach(function (e) { addEmail(e, e, '輸入的電郵'); });
  return { people: out, noEmail: noEmail, extra: extra,
    selection: { groups: groups, personIds: pickIds, emails: emails } };
}
