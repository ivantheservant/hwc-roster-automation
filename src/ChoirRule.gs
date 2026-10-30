/**
 * 第九十輪批次 QB 組：規則 SEMI_CHOIR_SUNDAY 的判斷（生成、findStateViolations_、〔請系統幫我調整〕共用）。
 * 詩班獻詩的主日，詩班名單上的人盡量不擔任任何職事表崗位。資料見 WebAppChoir.gs 檔頭。
 */

/**
 * Config `CHOIR_GROUP_POST_ID`（預設 CHOIR）。
 * @returns {string}
 */
function readChoirGroupPostId_() {
  return String(getConfig_(CONFIG_KEYS.CHOIR_GROUP_POST_ID, 'CHOIR') || 'CHOIR').trim();
}

/**
 * 規則 SEMI_CHOIR_SUNDAY：這個人那一日是不是「詩班獻詩的主日的詩班成員」。**純函式。**
 * 「堂委」「執事」寫在詩班名單上的，按那一日的身分判斷（同崗位名單的做法）。
 * @param {Object} ctx 規則 context（`rules`、`eligibility`（含 roleOnlyByPost）、`roles`、`choirGroupPostId`）
 * @param {string} personId 人
 * @param {boolean} choirSinging 那一日是不是詩班獻詩
 * @param {string} dateStr 主日
 * @returns {boolean}
 */
function isChoirSundayConflict_(ctx, personId, choirSinging, dateStr) {
  if (!choirSinging || !personId || !ctx) return false;
  const choirId = ctx.choirGroupPostId;
  if (!choirId) return false;
  if (!isRuleEnabledAllowingDefault_(ctx.rules || {}, RULE_IDS.CHOIR_SUNDAY)) return false;
  const pool = ((ctx.eligibility && ctx.eligibility.byPost) || {})[choirId] || [];
  if (pool.indexOf(personId) === -1) return false;
  return !eligibilityRoleTokenFailure_(ctx, choirId, personId, dateStr);
}

/**
 * 違規一句人話：「某某是詩班成員，7 月 16 日詩班獻詩，盡量不擔任其他崗位。」
 * @param {string} personName 名
 * @param {string} dateStr 主日
 * @returns {string}
 */
function buildChoirSundayReason_(personName, dateStr) {
  return (personName || '這個人') + ' 是詩班成員，' + sameDayHumanDate_(dateStr) + '詩班獻詩，盡量不擔任其他崗位。';
}

/**
 * 這一季每個主日的詩班獻詩設定（視窗、季前資料、整季重設計數都用這一支）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {{serviceDate: string, singing: boolean}[]}（按日期）
 */
function readChoirSinging_(quarterId, timezone) {
  const D = COLUMNS.SERVICE_DATES;
  return readSheet_(SHEETS.SERVICE_DATES)
    .filter(function (r) { return String(r[D.QUARTER_ID] || '').trim() === quarterId; })
    .map(function (r) {
      return { serviceDate: toDateString_(r[D.SERVICE_DATE], timezone), singing: isTrueValue_(r[D.CHOIR_SINGING]) };
    })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); });
}

/**
 * 詩班名單有幾多人（名字＋「堂委」「執事」按今日現任展開）。讀不到 ⇒ null。
 * @returns {?number}
 */
function readChoirMemberCountSafe_() {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const eligibility = readEligibility_();
    const roleContext = buildRoleContext_(eligibility, readPostsNormalized_(), timezone);
    return (roleContext.eligibleByPost[readChoirGroupPostId_()] || []).length;
  } catch (err) {
    log_('WARN', 'readChoirMemberCountSafe_ 讀不到詩班名單：' + err.message);
    return null;
  }
}

/**
 * 某一日的詩班名單（名字＋那一日現任的「堂委」「執事」）。讀不到 ⇒ `error`。
 * @param {string} dateStr 參考日期
 * @param {string} timezone 時區
 * @returns {{ids: string[], error: string}}
 */
function readChoirMembersOnSafe_(dateStr, timezone) {
  try {
    const eligibility = readEligibility_();
    const roleContext = buildRoleContext_(eligibility, readPostsNormalized_(), timezone);
    const ctx = { eligibility: eligibility, roles: roleContext.roles };
    const choirId = readChoirGroupPostId_();
    const ids = (roleContext.eligibleByPost[choirId] || []).filter(function (id) {
      return !eligibilityRoleTokenFailure_(ctx, choirId, id, dateStr);
    });
    return { ids: ids, error: '' };
  } catch (err) {
    log_('WARN', 'readChoirMembersOnSafe_ 讀不到詩班名單：' + err.message);
    return { ids: [], error: err.message };
  }
}
