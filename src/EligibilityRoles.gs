/**
 * 第八十五輪批次 LC 組：事奉人員表（崗位名單）可以寫「堂委」「執事」。
 *
 * Ivan：「事奉人員表除了人名外，若果輸入是堂委／執事，都可以取到名單中的人來事奉。」
 *
 * ── 資料怎樣存 ──────────────────────────────────────────────────
 * `Eligibility` 一行的 PersonID 寫成身分代號，例如 `ROLE:COMMITTEE`（前綴＋`ROLE_LABELS_TC` 的代號）。
 * 崗位名單工作表／崗位資格畫面顯示和輸入都用中文標籤（「堂委」「執事」），日後在
 * `ROLE_LABELS_TC` 加身分代號，不用改這裏。
 *
 * ── 意思 ─────────────────────────────────────────────────────────
 * **每一個主日當日**在 `Roles` 有效（EffectiveFrom／EffectiveTo、Active）的該身分的人，都可以排這個崗位；
 * 換屆之後自動跟從。同一人既有名字又屬於「堂委」，兩者並存（以名字那一行為準，不重複計算）。
 *
 * ── 三條規矩 ─────────────────────────────────────────────────────
 *   一、候選池是安全的超集（任何一行 Active 的身分紀錄都計入），真正收窄由逐格逐日檢查負責
 *      （和 `buildRoleAugmentedEligibleByPost_()` 的做法一致）：只經「堂委」取得資格的人，
 *      某一主日已不是堂委 ⇒ 那一日不合資格（`HARD_ELIGIBILITY`，訊息寫明「已不是堂委」）。
 *   二、歷史次數不可以變成 0：名字被「堂委」取代之後，原本那一行變成 Active=FALSE，
 *      `HistoricalCount` 仍在那一行；經身分加入的人一律沿用那個數（配額、選人用）。
 *   三、個人設定照樣適用（暫時不做某崗位、不能服侍、排表偏好、NameMapping.Active、MaxPerQuarter、
 *      Posts.RequiredRoles）——這些檢查本來就按 PersonID 做，展開之後自然生效。
 */

/** Eligibility.PersonID 裏代表身分的前綴。 */
const ELIGIBILITY_ROLE_TOKEN_PREFIX = 'ROLE:';

/**
 * 身分代號 → Eligibility 用的代號（例如 `COMMITTEE` → `ROLE:COMMITTEE`）。
 * @param {string} roleCode 身分代號
 * @returns {string}
 */
function eligibilityRoleTokenOf_(roleCode) {
  return ELIGIBILITY_ROLE_TOKEN_PREFIX + String(roleCode || '').trim().toUpperCase();
}

/**
 * Eligibility.PersonID 是不是身分代號；是就回傳身分代號（大寫），否則空字串。
 * @param {string} personId Eligibility.PersonID
 * @returns {string}
 */
function parseEligibilityRoleToken_(personId) {
  const s = String(personId || '').trim();
  if (s.toUpperCase().indexOf(ELIGIBILITY_ROLE_TOKEN_PREFIX) !== 0) return '';
  return s.slice(ELIGIBILITY_ROLE_TOKEN_PREFIX.length).trim().toUpperCase();
}

/**
 * 崗位名單上輸入的文字是不是身分標籤（「堂委」「執事」……，即 `ROLE_LABELS_TC`；代號本身也認）。
 * @param {string} text 幹事輸入的文字
 * @returns {string} 身分代號（例如 `COMMITTEE`）；不是 ⇒ 空字串
 */
function resolveEligibilityRoleLabel_(text) {
  // 全形／零闊度字元／前後空白一律先正規化；英文代號不分大小寫
  const t = normalizeIdInput_(text).toUpperCase();
  if (!t) return '';
  const codes = Object.keys(ROLE_LABELS_TC);
  for (let i = 0; i < codes.length; i++) {
    if (normalizeIdInput_(ROLE_LABELS_TC[codes[i]]).toUpperCase() === t) return codes[i];
    if (codes[i].toUpperCase() === t) return codes[i];
  }
  return '';
}

/**
 * 某身分在某一日的現任（`Roles` 有效）。dateStr 空 ⇒ 任何一行 Active 的都計（候選池的超集）。
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @param {string} roleCode 身分代號
 * @param {string=} dateStr yyyy-MM-dd
 * @returns {string[]} PersonID（已排序、不重複）
 */
function roleHoldersOn_(roles, roleCode, dateStr) {
  const out = {};
  (roles || []).forEach(function (r) {
    if (r.roleCode !== roleCode) return;
    if (dateStr && !isEffectiveOn_(r.effectiveFrom, r.effectiveTo, dateStr)) return;
    out[r.personId] = true;
  });
  return Object.keys(out).sort();
}

/**
 * 顯示用：「堂委（現任 6 位：甲、乙……）」。
 * @param {string} roleCode 身分代號
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @param {Object.<string, string>} nameById PersonID → 中文名
 * @param {string} dateStr 以哪一日為準（yyyy-MM-dd）
 * @param {number=} maxNames 最多列幾個名字（預設全部）
 * @returns {string}
 */
function describeEligibilityRoleToken_(roleCode, roles, nameById, dateStr, maxNames) {
  const label = ROLE_LABELS_TC[roleCode] || roleCode;
  // 讀不到身分名單（null）⇒ 講明，不可以當成「現任 0 位」
  if (roles === null || roles === undefined) return label + '（讀不到現任名單）';
  const ids = roleHoldersOn_(roles, roleCode, dateStr);
  if (ids.length === 0) return label + '（現任 0 位）';
  const names = ids.map(function (id) { return (nameById && nameById[id]) || id; });
  const limit = maxNames && maxNames > 0 ? maxNames : names.length;
  return label + '（現任 ' + ids.length + ' 位：' + names.slice(0, limit).join('、')
    + (names.length > limit ? '……' : '') + '）';
}

/**
 * 經身分代號展開的候選人（候選池超集）＋「只經身分取得資格」的人。**純函式。**
 *
 * @param {Object} eligibility `readEligibility_()` 的結果（要有 `rolesByPost`）
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @returns {{addByPost: Object.<string, string[]>, roleOnlyByPost: Object.<string, Object.<string, string[]>>}}
 *   addByPost＝要加入候選池的人；roleOnlyByPost[postId][personId]＝此人經哪幾個身分取得資格
 *  （名字本身在名單上的人不算「只經身分」）
 */
function buildEligibilityRoleExpansion_(eligibility, roles) {
  const addByPost = {};
  const roleOnlyByPost = {};
  const rolesByPost = (eligibility && eligibility.rolesByPost) || {};
  const excluded = (eligibility && eligibility.explicitlyExcluded) || {};
  Object.keys(rolesByPost).forEach(function (postId) {
    const explicit = {};
    ((eligibility.byPost || {})[postId] || []).forEach(function (id) { explicit[id] = true; });
    const postExcluded = excluded[postId] || {};
    rolesByPost[postId].forEach(function (roleCode) {
      roleHoldersOn_(roles, roleCode, '').forEach(function (personId) {
        if (explicit[personId] || postExcluded[personId]) return;
        if (!roleOnlyByPost[postId]) roleOnlyByPost[postId] = {};
        if (!roleOnlyByPost[postId][personId]) {
          roleOnlyByPost[postId][personId] = [];
          if (!addByPost[postId]) addByPost[postId] = [];
          addByPost[postId].push(personId);
        }
        if (roleOnlyByPost[postId][personId].indexOf(roleCode) === -1) roleOnlyByPost[postId][personId].push(roleCode);
      });
    });
  });
  return { addByPost: addByPost, roleOnlyByPost: roleOnlyByPost };
}

/**
 * 經身分加入的人沿用原本那一行的 HistoricalCount（就地補入 `eligibility.historicalCount`）。
 * 名字本身在名單上的人照舊；從來沒有那一行的人＝0（新任，確實沒有歷史）。
 * @param {Object} eligibility `readEligibility_()` 的結果（會就地修改 historicalCount）
 * @param {Object.<string, Object.<string, string[]>>} roleOnlyByPost `buildEligibilityRoleExpansion_()` 的結果
 * @returns {void}
 */
function carryHistoricalCountForRoleExpansion_(eligibility, roleOnlyByPost) {
  const all = eligibility.historicalCountAll || {};
  Object.keys(roleOnlyByPost || {}).forEach(function (postId) {
    Object.keys(roleOnlyByPost[postId]).forEach(function (personId) {
      const n = (all[postId] || {})[personId];
      if (!n) return;
      if (!eligibility.historicalCount[postId]) eligibility.historicalCount[postId] = {};
      if (!eligibility.historicalCount[postId][personId]) eligibility.historicalCount[postId][personId] = n;
    });
  });
}

/**
 * 逐格逐日：只經身分取得資格的人，那一日還是不是那個身分。**純函式。**
 * @param {Object} context 規則檢查 context（要有 `eligibility.roleOnlyByPost`、`roles`）
 * @param {string} postId 崗位
 * @param {string} personId 人
 * @param {string} dateStr 主日（yyyy-MM-dd）
 * @returns {string} 不合資格的原因；合資格（或不是只經身分）⇒ 空字串
 */
function eligibilityRoleTokenFailure_(context, postId, personId, dateStr) {
  const only = (((context && context.eligibility && context.eligibility.roleOnlyByPost) || {})[postId] || {})[personId];
  if (!only || only.length === 0) return '';
  if (personHasAnyRoleOn_((context && context.roles) || [], personId, only, dateStr)) return '';
  const labels = only.map(function (c) { return ROLE_LABELS_TC[c] || c; });
  return '已不是' + labels.join('或') + '（崗位名單上寫的是「' + labels.join('」「')
    + '」，此人在 ' + dateStr + ' 當日已不是' + labels.join('或') + '）';
}

/**
 * 顯示／輸入用：某崗位名單「名字＋身分代號」的完整清單（崗位名單工作表、預覽用）。
 * @param {Object} eligibility `readEligibility_()` 的結果
 * @param {string} postId 崗位
 * @returns {string[]} PersonID 與身分代號（`ROLE:…`）
 */
function eligibilityEntriesOfPost_(eligibility, postId) {
  const people = ((eligibility && eligibility.byPost) || {})[postId] || [];
  const tokens = (((eligibility && eligibility.rolesByPost) || {})[postId] || []).map(eligibilityRoleTokenOf_);
  return people.concat(tokens);
}

/**
 * 某一日的候選名單（名字＋當日現任）——按崗位列人的畫面（排表偏好、選單等）用。
 * @param {Object} eligibility `readEligibility_()` 的結果
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @param {string} postId 崗位
 * @param {string} dateStr yyyy-MM-dd
 * @returns {string[]} PersonID（不重複）
 */
function expandEligibilityOnDate_(eligibility, roles, postId, dateStr) {
  const out = {};
  const excluded = ((eligibility && eligibility.explicitlyExcluded) || {})[postId] || {};
  (((eligibility && eligibility.byPost) || {})[postId] || []).forEach(function (id) { out[id] = true; });
  ((((eligibility && eligibility.rolesByPost) || {})[postId]) || []).forEach(function (code) {
    roleHoldersOn_(roles, code, dateStr).forEach(function (id) { if (!excluded[id]) out[id] = true; });
  });
  return Object.keys(out);
}

/**
 * 畫面顯示用：讀身分名單和今日日期。讀不到 ⇒ roles＝null（顯示「讀不到現任名單」，不擋畫面）。
 * @param {string} timezone 時區
 * @returns {{roles: ?Object[], today: string}}
 */
function readRolesForDisplay_(timezone) {
  try {
    return { roles: readRolesSafe_(timezone), today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd') };
  } catch (err) {
    log_('WARN', 'readRolesForDisplay_ 讀不到身分名單：' + err.message);
    return { roles: null, today: '' };
  }
}
