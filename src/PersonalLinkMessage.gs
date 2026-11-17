/**
 * 第一百一十二輪批次 UC 組：沒有電郵的人——〔複製訊息〕。
 *
 * 啟用的事奉人員之中有十多位沒有任何電郵：他們收不到信，幹事要自己砌一段訊息再貼到 WhatsApp。
 * 這裏由伺服器砌好那一段文字（稱呼、季度、用途、這個人的個人連結、截止日、有疑問找誰），
 * 前端按〔複製訊息〕時才取得，放入剪貼簿。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 安全
 * ─────────────────────────────────────────────────────────────────────
 *   ・個人連結等同這個人的鑰匙。`apiGetPersonalLinkMessage()` 一律要「可以修改」的權限（只可查看、只是確認者都拒絕）；
 *     伺服器端把關，不只靠頁面隱藏按鈕。
 *   ・分階段開放（`ROLLOUT_AUDIENCE`）照舊：第一階段只有堂委、執事、幹事可以取得訊息。
 *   ・連結只在這支函式的回傳值出現一次；清單、預覽、AuditLog 都不帶連結或 token。
 *   ・AuditLog 只記 PersonID（不記連結）：誰、在哪一季、複製了哪一位、哪一種訊息。
 *   ・沒有個人連結的人不出按鈕，畫面寫「還沒有個人連結」（伺服器判斷 `copyState`）。
 *
 * 文字來自 EmailTemplates 兩個範本（申報、正式發出各一個），和電郵範本同一套 placeholders、同一個更新途徑。
 */

/** 兩種訊息：DECLARE＝邀請申報不能服侍的日子；OFFICIAL＝正式發出之後給事奉人員看自己的服侍安排。 */
const PERSONAL_LINK_MESSAGE_PURPOSE = { DECLARE: 'DECLARE', OFFICIAL: 'OFFICIAL' };
const PERSONAL_LINK_MESSAGE_TEMPLATE_IDS = {
  DECLARE: 'TPL_PERSONAL_LINK_MESSAGE_DECLARE_TC',
  OFFICIAL: 'TPL_PERSONAL_LINK_MESSAGE_OFFICIAL_TC'
};
const PERSONAL_LINK_MESSAGE_AUDIT_ACTION = 'PERSONAL_LINK_MESSAGE_COPIED';

/** 〔複製訊息〕按鈕的狀態：OK＝可以複製；NO_LINK＝這個人還沒有個人連結；NOT_OPEN＝第一階段還沒有開放給這個人。 */
const PERSONAL_LINK_MESSAGE_STATE = { OK: 'OK', NO_LINK: 'NO_LINK', NOT_OPEN: 'NOT_OPEN' };

/**
 * @param {*} purpose 前端傳來的種類
 * @returns {string} DECLARE 或 OFFICIAL
 * @throws {Error} 認不出
 */
function normalisePersonalLinkMessagePurpose_(purpose) {
  const p = String(purpose || '').trim().toUpperCase();
  if (p === PERSONAL_LINK_MESSAGE_PURPOSE.DECLARE || p === PERSONAL_LINK_MESSAGE_PURPOSE.OFFICIAL) return p;
  throw new Error(buildThreePartMessage_('認不出這是哪一種訊息。', '沒有取得任何訊息。', ['請重新開啟這個畫面再試']));
}

/**
 * 砌訊息文字。**純計算**（範本由呼叫端傳入），方便離線測試。
 * @param {Object} tpl 範本（bodyPlain）
 * @param {{name: string, quarterId: string, quarterLabel: string, link: string, generateDate: string, deadline: string}} v
 * @returns {string}
 */
function renderPersonalLinkMessageText_(tpl, v) {
  const placeholders = {
    QuarterLabel: v.quarterLabel, QuarterID: v.quarterId,
    GenerateDate: v.generateDate || '生成日', Deadline: v.deadline || '生成日之前',
    PersonalLink: v.link
  };
  return applyPlaceholders_(tpl.bodyPlain, placeholders, { displayName: v.name }, '');
}

/**
 * @param {string} templateId
 * @returns {boolean} 是不是〔複製訊息〕的範本（範本樣本用，不要當電郵加頁尾）
 */
function isPersonalLinkMessageTemplateId_(templateId) {
  return templateId === PERSONAL_LINK_MESSAGE_TEMPLATE_IDS.DECLARE || templateId === PERSONAL_LINK_MESSAGE_TEMPLATE_IDS.OFFICIAL;
}

/**
 * 範本：EmailTemplates 有（而且啟用）就用；沒有就用內建預設（〔補建設定及範本〕會加入）。
 * @param {string} purpose DECLARE 或 OFFICIAL
 * @returns {Object}
 */
function findPersonalLinkMessageTemplate_(purpose) {
  const id = PERSONAL_LINK_MESSAGE_TEMPLATE_IDS[purpose];
  let tpl = null;
  try { tpl = findEmailTemplateById_(id); } catch (err) { tpl = null; }
  return tpl || EMAIL_TEMPLATE_SEEDS.filter(function (t) { return t.templateId === id; })[0];
}

/**
 * 這幾個人的〔複製訊息〕狀態。**只讀；不回傳 token。**
 * @param {string[]} personIds
 * @returns {Object.<string, string>} PersonID ⇒ PERSONAL_LINK_MESSAGE_STATE
 */
function personalLinkMessageStates_(personIds) {
  const M = COLUMNS.NAME_MAPPING;
  const tokenById = {};
  readPeople_().forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (id) tokenById[id] = String(row[M.PERSONAL_LINK_TOKEN] || '').trim();
  });
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  let lookup = null;
  const out = {};
  (personIds || []).forEach(function (id) {
    if (!tokenById[id]) { out[id] = PERSONAL_LINK_MESSAGE_STATE.NO_LINK; return; }
    try {
      if (!lookup && readRolloutAudience_() !== ROLLOUT_AUDIENCE.ALL) lookup = buildRolloutLeaderLookup_(timezone, today);
      out[id] = isPersonalDeclareAllowed_(id, timezone, today, lookup || undefined)
        ? PERSONAL_LINK_MESSAGE_STATE.OK : PERSONAL_LINK_MESSAGE_STATE.NOT_OPEN;
    } catch (err) {
      // 讀不到開放範圍 ⇒ 當作還沒有開放（較安全）
      out[id] = PERSONAL_LINK_MESSAGE_STATE.NOT_OPEN;
    }
  });
  return out;
}

/**
 * 給清單用：每位沒有電郵的人加上 `copyState`（伺服器判斷）。讀不到 ⇒ 全部 NOT_OPEN（不出按鈕）。
 * @param {Object[]} people 每筆要有 personId；臨時幫手（沒有真正的 PersonID）不加
 * @returns {Object[]} 同一批物件（已加 copyState）
 */
function attachPersonalLinkMessageState_(people) {
  const real = (people || []).filter(function (p) { return p && p.personId && !p.tempHelper; });
  let states = {};
  try { states = personalLinkMessageStates_(real.map(function (p) { return p.personId; })); } catch (err) {
    log_('WARN', 'attachPersonalLinkMessageState_ 讀不到：' + err.message);
  }
  real.forEach(function (p) { p.copyState = states[p.personId] || PERSONAL_LINK_MESSAGE_STATE.NOT_OPEN; });
  return people;
}

/**
 * 供前端呼叫：取得一位沒有電郵的人的訊息文字（按〔複製訊息〕時才呼叫）。
 * 要「可以修改」的權限；第一階段只有堂委、執事、幹事；沒有個人連結 ⇒ 不給。寫 AuditLog（只記 PersonID）。
 * @param {string} quarterId 季度 ID
 * @param {string} personId
 * @param {string} purpose DECLARE 或 OFFICIAL
 * @returns {{ok: boolean, name: string, text: string, message: string}}
 */
function apiGetPersonalLinkMessage(quarterId, personId, purpose) {
  assertWebAppRequestAllowed_();
  // 上一行不傳名字 ⇒ 要「可以修改」的權限（只可查看、只是確認者都拒絕）
  const id = String(quarterId || '').trim();
  const pid = String(personId || '').trim();
  const kind = normalisePersonalLinkMessagePurpose_(purpose);
  if (!id || !pid || !findQuarter_(id)) {
    throw new Error(buildThreePartMessage_('找不到這一季或這位事奉人員。', '沒有取得任何訊息。', ['請重新開啟這個畫面再試']));
  }
  const M = COLUMNS.NAME_MAPPING;
  const person = readPeople_().filter(function (row) { return String(row[M.PERSON_ID] || '').trim() === pid; })[0];
  if (!person || !isTrueValue_(person[M.ACTIVE])) {
    throw new Error(buildThreePartMessage_('這位事奉人員不在名單上，或者已經停用。', '沒有取得任何訊息。', ['請到〔名單維護〕核對']));
  }
  const token = String(person[M.PERSONAL_LINK_TOKEN] || '').trim();
  const name = String(person[M.NAME_TC] || '').trim() || pid;
  if (!token) {
    throw new Error(buildThreePartMessage_(name + '還沒有個人連結。', '沒有取得任何訊息。',
      ['每日自動排程或下一次寄出之前會自動補發；也可以在〔進階與診斷〕補發']));
  }
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  if (!isPersonalDeclareAllowed_(pid, timezone, today)) {
    throw new Error(buildThreePartMessage_('現在只開放給堂委、執事及幹事，' + name + '暫時不用通知。', '沒有取得任何訊息。',
      ['全面開放之後再取得訊息']));
  }
  const baseUrl = String(getConfig_(CONFIG_KEYS.WEBAPP_VOLUNTEER_URL, '') || '').trim();
  const link = buildPersonalRosterUrl_(baseUrl, token, id);
  if (!link) {
    throw new Error(buildThreePartMessage_('還沒有設定事奉人員個人連結的網址。', '沒有取得任何訊息。', ['請管理員先在 Config 填上個人連結部署的網址']));
  }
  if (kind === PERSONAL_LINK_MESSAGE_PURPOSE.OFFICIAL && findLatestVersionNo_(id) < 0) {
    throw new Error(buildThreePartMessage_('這一季還沒有職事表。', '沒有取得任何訊息。', ['生成職事表之後再取得訊息']));
  }
  const dates = readUnavailableInviteDates_(id);
  const text = renderPersonalLinkMessageText_(findPersonalLinkMessageTemplate_(kind), {
    name: name, quarterId: id, quarterLabel: buildQuarterLabel_(id), link: link,
    generateDate: dates.generateDate, deadline: dates.deadline
  });
  // AuditLog 只記 PersonID，不記連結、token、訊息內容
  writeAuditLog_({
    action: PERSONAL_LINK_MESSAGE_AUDIT_ACTION,
    targetSheet: SHEETS.NAME_MAPPING,
    targetKey: pid,
    oldValue: '',
    newValue: kind,
    source: 'apiGetPersonalLinkMessage',
    notes: '幹事複製了沒有電郵的事奉人員的訊息（' + id + '，' + (kind === PERSONAL_LINK_MESSAGE_PURPOSE.DECLARE ? '申報不能服侍的日子' : '正式發出') + '）'
  });
  return { ok: true, name: name, text: text, message: '已複製給' + name + '的訊息，請貼到 WhatsApp 或短訊。' };
}
