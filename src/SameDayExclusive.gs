/**
 * 第九十輪批次 QA 組：同日不兼任（HARD_SAME_DAY_EXCLUSIVE）。
 *
 * 音樂部意見（Ivan 2026-10-30 決定）：領詩、司琴由幹事在職事表人手填（Posts.AutoGenerate=FALSE），
 * 填了之後，那個人同一個主日不可以再擔任其他崗位（包括另一個同日不兼任的崗位）。
 *
 * ── 範圍 ────────────────────────────────────────────────────────
 * 崗位由 Config `SAME_DAY_EXCLUSIVE_POST_IDS`（預設 `WORSHIP,PIANO`）決定，不寫死。
 * 規則預設開啟、HARD（`RULE_DEFAULT_ENABLED`／`RULE_DEFAULT_LEVELS`）；`RuleSettings` 有行就照該行。
 *
 * ── 違反掛在哪一格 ─────────────────────────────────────────────
 * 某人某日擔任同日不兼任崗位（「錨」：按 Posts 次序第一個同日不兼任的崗位）⇒ 他那一日**其他崗位**
 * 的每一格都是違反（違反掛在那幾格，不掛在錨）。所以〔請系統幫我調整〕會保留領詩／司琴那一格，
 * 改另一個崗位那一格；另一格亦是人手填的崗位（AutoGenerate=FALSE）⇒ 系統不改，列入「需要人手處理」
 * （見 `isSameDayExclusiveManualOnlyViolation_()`）。
 *
 * 同一崗位同日兩格同一人不在這裏處理（那是 HARD_DISTINCT_SLOT）。
 *
 * ── 認人 ────────────────────────────────────────────────────────
 * 人手填的名字由偵測人手改動那一步經 `NameMapping`／`NameAlias` 解析成 PersonID；
 * 認不出（外請、名單以外，只有名字）⇒ 沒有 PersonID ⇒ 這裏不檢查。
 */

/** 兩格都是人手填的崗位時〔請系統幫我調整〕的一句（列入「需要人手處理」）。 */
const SAME_DAY_MANUAL_ONLY_NOTE = '兩格都是人手填的崗位，系統不會改，需要人手處理';

/**
 * Config `SAME_DAY_EXCLUSIVE_POST_IDS`（PostID 陣列，去空白、去重）。
 * @returns {string[]}
 */
function readSameDayExclusivePostIds_() {
  return parseSameDayExclusivePostIds_(getConfig_(CONFIG_KEYS.SAME_DAY_EXCLUSIVE_POST_IDS, 'WORSHIP,PIANO'));
}

/**
 * @param {*} raw Config 原值
 * @returns {string[]}
 */
function parseSameDayExclusivePostIds_(raw) {
  const out = [];
  String(raw === null || raw === undefined ? '' : raw).split(/[,，、;\s]+/).forEach(function (t) {
    const id = t.trim();
    if (id && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

/**
 * 規則有冇生效（開着而且有設崗位）。
 * @param {Object} rules RuleSettings 對照表
 * @param {?string[]} postIds 同日不兼任崗位
 * @returns {boolean}
 */
function isSameDayExclusiveActive_(rules, postIds) {
  return Array.isArray(postIds) && postIds.length > 0
    && isRuleEnabledAllowingDefault_(rules || {}, RULE_IDS.SAME_DAY_EXCLUSIVE);
}

/**
 * 「7 月 2 日」。
 * @param {string} serviceDate `yyyy-MM-dd`
 * @returns {string}
 */
function sameDayHumanDate_(serviceDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(serviceDate || ''));
  return m ? (Number(m[2]) + ' 月 ' + Number(m[3]) + ' 日') : String(serviceDate || '');
}

/**
 * 違規一句人話：「某某 7 月 2 日已經是領詩，同日不可以再做司事。」
 * @param {string} personName 名
 * @param {string} serviceDate `yyyy-MM-dd`
 * @param {string} anchorPostName 同日不兼任崗位的中文名
 * @param {string} postName 這一格崗位的中文名
 * @returns {string}
 */
function buildSameDayExclusiveReason_(personName, serviceDate, anchorPostName, postName) {
  return (personName || '這個人') + ' ' + sameDayHumanDate_(serviceDate) + '已經是' + anchorPostName
    + '，同日不可以再做' + postName + '。';
}

/**
 * 找出同日兼任的格。**純函式。**
 *
 * @param {Object[]} cells 每一格 `{serviceDate, postId, slotIndex, personId}`（沒有 personId 的格略過）
 * @param {string[]} exclusivePostIds 同日不兼任崗位
 * @param {Object[]} posts 崗位（決定錨的次序；`postNameTC` 用來寫句子）
 * @returns {{cell: Object, anchor: Object}[]} 每一項＝一格違反（`cell`）及它的錨（`anchor`）
 */
function findSameDayExclusiveConflicts_(cells, exclusivePostIds, posts) {
  const excl = {};
  (exclusivePostIds || []).forEach(function (id) { excl[id] = true; });
  if (Object.keys(excl).length === 0) return [];
  const order = {};
  (posts || []).forEach(function (p, i) { order[p.postId] = i; });
  const rank = function (c) {
    return (order[c.postId] === undefined ? 100000 : order[c.postId]) * 100 + (Number(c.slotIndex) || 0);
  };
  const groups = {};
  const keys = [];
  (cells || []).forEach(function (c) {
    if (!c || !c.personId) return;
    const k = c.serviceDate + '|' + c.personId;
    if (!groups[k]) { groups[k] = []; keys.push(k); }
    groups[k].push(c);
  });
  const out = [];
  keys.forEach(function (k) {
    const list = groups[k];
    const exclusive = list.filter(function (c) { return excl[c.postId]; });
    if (exclusive.length === 0) return;
    const anchor = exclusive.slice().sort(function (a, b) { return rank(a) - rank(b); })[0];
    list.forEach(function (c) {
      if (c.postId === anchor.postId) return;
      out.push({ cell: c, anchor: anchor });
    });
  });
  return out;
}

/**
 * 生成時：這個人這一日可不可以做這個崗位。**純函式。**
 * @param {string} postId 正在排的崗位
 * @param {string[]} postsAlreadyToday 這個人今日已經排了的崗位（weekByPerson）
 * @param {?string} reservedPostId 這個人今日已被鎖定格佔用的同日不兼任崗位（未輪到處理的鎖定格）
 * @param {string[]} exclusivePostIds 同日不兼任崗位
 * @returns {?string} 違反時回錨崗位的 PostID；可以 ⇒ null
 */
function sameDayExclusiveAnchorForCandidate_(postId, postsAlreadyToday, reservedPostId, exclusivePostIds) {
  const excl = exclusivePostIds || [];
  const others = (postsAlreadyToday || []).filter(function (id) { return id !== postId; });
  if (reservedPostId && reservedPostId !== postId && others.indexOf(reservedPostId) === -1) others.push(reservedPostId);
  if (others.length === 0) return null;
  const exclusiveOther = others.filter(function (id) { return excl.indexOf(id) !== -1; })[0];
  if (exclusiveOther) return exclusiveOther;
  if (excl.indexOf(postId) !== -1) return postId;
  return null;
}

/**
 * 這一項違反是不是「兩格都是人手填的崗位」——〔請系統幫我調整〕不改，列入「需要人手處理」。
 * @param {Object} violation 違反（`ruleId`、`postId`）
 * @param {Object[]} posts 崗位
 * @returns {boolean}
 */
function isSameDayExclusiveManualOnlyViolation_(violation, posts) {
  if (!violation || violation.ruleId !== RULE_IDS.SAME_DAY_EXCLUSIVE) return false;
  const post = (posts || []).filter(function (p) { return p.postId === violation.postId; })[0];
  return !!post && !post.autoGenerate;
}

/**
 * 改動之後仍然沒有**新增**同日兼任（補空格網絡把關用）。**純函式。**
 * @param {string[]} exclusivePostIds 同日不兼任崗位
 * @param {Object[]} posts 崗位
 * @param {Object[]} before 改動前全部格
 * @param {Object[]} after 改動後全部格
 * @returns {boolean} true＝沒有新增
 */
function sameDayExclusiveNotWorse_(exclusivePostIds, posts, before, after) {
  const count = function (cells) { return findSameDayExclusiveConflicts_(cells, exclusivePostIds, posts).length; };
  return count(after) <= count(before);
}

/**
 * 「領詩／司琴」（按 Posts 次序；找不到中文名就用 PostID）。
 * @param {string[]} exclusivePostIds 同日不兼任崗位
 * @param {Object[]} posts 崗位
 * @returns {string}
 */
function describeSameDayExclusivePosts_(exclusivePostIds, posts) {
  const nameById = {};
  (posts || []).forEach(function (p) { nameById[p.postId] = p.postNameTC || p.postId; });
  return (exclusivePostIds || []).map(function (id) { return nameById[id] || id; }).join('／');
}

/**
 * 狀態卡：這一張表（含未儲存的改動）有幾多格同日兼任（勾了「保留我的安排」的不計）。**純函式。**
 * @param {Object[]} state 派工狀態（`resolveAuthoritativeState_()` 的 state）
 * @param {Object} context fine-tune context（要有 `posts`、`rules`、`sameDayExclusivePostIds`、`peopleById`）
 * @param {?function(string): boolean} isKeptKey `date|post|slot` ⇒ 有沒有勾保留
 * @returns {{count: number, items: Object[], postsLabel: string}}
 */
function summariseSameDayExclusive_(state, context, isKeptKey) {
  const ids = (context && context.sameDayExclusivePostIds) || [];
  const out = { count: 0, items: [], postsLabel: describeSameDayExclusivePosts_(ids, context && context.posts) };
  if (!context || !isSameDayExclusiveActive_(context.rules, ids)) return out;
  const nameById = {};
  (context.posts || []).forEach(function (p) { nameById[p.postId] = p.postNameTC || p.postId; });
  findSameDayExclusiveConflicts_(state, ids, context.posts).forEach(function (x) {
    const key = x.cell.serviceDate + '|' + x.cell.postId + '|' + x.cell.slotIndex;
    if (isKeptKey && isKeptKey(key)) return;
    const person = (context.peopleById || {})[x.cell.personId];
    const personName = person ? person.nameTC : x.cell.personId;
    out.items.push({
      serviceDate: x.cell.serviceDate, postId: x.cell.postId, slotIndex: x.cell.slotIndex,
      postNameTC: nameById[x.cell.postId] || x.cell.postId, personId: x.cell.personId, personName: personName,
      anchorPostNameTC: nameById[x.anchor.postId] || x.anchor.postId,
      reason: buildSameDayExclusiveReason_(personName, x.cell.serviceDate,
        nameById[x.anchor.postId] || x.anchor.postId, nameById[x.cell.postId] || x.cell.postId)
    });
  });
  out.count = out.items.length;
  return out;
}
