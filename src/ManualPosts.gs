/**
 * 第九十一輪批次 RA 組：「人手填寫的崗位」一律由 `Posts` 決定，名稱由 `Posts.PostName_TC` 組成。
 *
 * 準則和生成器（`structuralSkipFor_()`）、格子分類（`classifyGridCell_()`）一樣：
 *   `AutoGenerate=FALSE` ⇒ 人手填；`Frequency=AS_NEEDED` ⇒ 按需要人手安排（例如翻譯）。
 *
 * 不再寫死「講員、翻譯、獻花」——第九十輪領詩、司琴改為人手填之後，生成確認窗、完成窗、圖例等
 * 仍然只寫那三個。亦**不看** `RuleSettings` 的 `HARD_NO_AUTO_PREACHER.ScopePostIDs`：
 * `ScopePostIDs` 留空、或者有填而沒有包括某個 `AutoGenerate=FALSE` 的崗位，那個崗位照樣是人手填
 * （生成器本來就只看 `AutoGenerate`，這裏和它一致）。
 */

/**
 * 一個崗位是不是人手填寫的。接受 `readPostsNormalized_()` 的物件或 `readPosts_()` 的原始行。**純函式。**
 * @param {Object} post 崗位
 * @returns {boolean}
 */
function isManualFillPost_(post) {
  if (!post) return false;
  const normalized = post.postId !== undefined;
  const autoGenerate = normalized ? post.autoGenerate : isTrueValue_(post[COLUMNS.POSTS.AUTO_GENERATE]);
  const frequency = String((normalized ? post.frequency : post[COLUMNS.POSTS.FREQUENCY]) || '').trim().toUpperCase();
  return autoGenerate === false || frequency === POST_FREQUENCY.AS_NEEDED;
}

/**
 * 人手填寫的崗位（按傳入的次序，即 Posts 的 DisplayOrder）。**純函式。**
 * @param {Object[]} posts `readPostsNormalized_()` 或 `readPosts_()` 的結果
 * @returns {{postId: string, postNameTC: string}[]}
 */
function listManualFillPosts_(posts) {
  return (posts || []).filter(isManualFillPost_).map(function (p) {
    const normalized = p.postId !== undefined;
    const postId = String((normalized ? p.postId : p[COLUMNS.POSTS.POST_ID]) || '').trim();
    const name = String((normalized ? p.postNameTC : p[COLUMNS.POSTS.POST_NAME_TC]) || '').trim();
    return { postId: postId, postNameTC: name || postId };
  }).filter(function (p) { return !!p.postId; });
}

/**
 * 「講員、翻譯、獻花、領詩、司琴」這樣的一串名稱。沒有 ⇒ 空字串。**純函式。**
 * @param {Object[]} posts 崗位
 * @returns {string}
 */
function describeManualFillPostNames_(posts) {
  return listManualFillPosts_(posts).map(function (p) { return p.postNameTC; }).join('、');
}

/**
 * 讀 Posts 組出名稱；讀不到 ⇒ 空字串（呼叫端用 `manualFillPostsPhrase_()` 就會退回「人手填寫的崗位」）。
 * @returns {string}
 */
function readManualFillPostNamesSafe_() {
  try {
    return describeManualFillPostNames_(readPosts_());
  } catch (err) {
    log_('WARN', '讀不到人手填寫的崗位：' + err.message);
    return '';
  }
}

/**
 * 「人手填寫的崗位（講員、翻譯、獻花、領詩、司琴）」；沒有名稱 ⇒「人手填寫的崗位」。**純函式。**
 * @param {string} names `describeManualFillPostNames_()` 的結果
 * @returns {string}
 */
function manualFillPostsPhrase_(names) {
  const n = String(names || '').trim();
  return n ? '人手填寫的崗位（' + n + '）' : '人手填寫的崗位';
}
