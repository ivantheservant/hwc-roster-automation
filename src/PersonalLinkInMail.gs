/**
 * 第四十一輪批次 E 組：**每一封信要附上收件人自己那條個人專屬連結。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 逐項講清楚的三種附件內容
 * ═════════════════════════════════════════════════════════════════════
 *
 * | 附件選項 | 收件人會收到 |
 * |---|---|
 * | 不附 | 內文 ＋ **他的個人專屬連結** ＋ 永久連結 |
 * | 個人版 PDF | 個人版 PDF ＋ **他的個人專屬連結** ＋ 永久連結 |
 * | 整季 PDF | 一份整季 PDF（沒有 highlight）＋ 永久連結 |
 *
 * ⚠️ 關鍵那一句：**「不附」不等於「什麼都沒有」。**
 * 沒有個人專屬連結的話，那一封信對收件人完全沒有用——
 * 他只會見到一段內文同一條全體共用的連結，找不到自己那幾格。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 為什麼「整季 PDF」那一種沒有個人連結
 * ─────────────────────────────────────────────────────────────────────
 *
 * 那一種是「一份大家看的表」——寄給堂委名單、或者幹事想全體看同一份。
 * 附一條每人不同的連結會令那封信變成半個人化，反而更亂。
 * 這是 Ivan 明確定的，不是推論。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 沒有 token 的人
 * ─────────────────────────────────────────────────────────────────────
 *
 * `NameMapping.PersonalLinkToken` 可能是空的（新加的人還沒有補發過）。
 * 這時候**退回只有永久連結**，而且要在寄出報告講明有幾多位——
 * 靜靜略過的話，那幾位收到的信會比其他人少一段，而沒有人知道。
 */

/**
 * 個人專屬連結的網址。**查不到就回空字串，不猜。**
 *
 * ⚠️ 一條打不開的連結，對一個不熟電腦的人來說比沒有連結更差——
 * 他會以為系統壞了，然後打電話問。所以沒有把握就不附。
 *
 * @param {string} baseUrl 義工部署的 `/exec` 網址（Config）
 * @param {string} token 那個人的 `PersonalLinkToken`
 * @param {string} quarterId 季度 ID
 * @returns {string} 網址；缺任何一樣就回空字串
 */
function buildPersonalRosterUrl_(baseUrl, token, quarterId) {
  const base = String(baseUrl || '').trim();
  const t = String(token || '').trim();
  const q = String(quarterId || '').trim();
  if (!base || !t || !q) return '';
  const joiner = base.indexOf('?') === -1 ? '?' : '&';
  return base + joiner + 'p=' + encodeURIComponent(t) + '&q=' + encodeURIComponent(q);
}

/**
 * 這一次寄出，附件那一種要不要附個人專屬連結。
 *
 * ⚠️ 這一句是上面那張表的**唯一**實作。畫面上那幾行說明文字
 * （`describeAttachOption_()`）同這裡讀同一個判斷——
 * 兩邊各寫一次的話，畫面會講一件事而系統做另一件事。
 *
 * @param {string} attachType `ATTACH_TYPE` 之一
 * @returns {boolean} 要不要附
 */
function attachTypeWantsPersonalLink_(attachType) {
  const t = String(attachType || '').toUpperCase();
  return t === ATTACH_TYPE.NONE || t === ATTACH_TYPE.PERSONAL_PDF;
}

/**
 * 畫面上每個附件選項下面那一行小字。
 *
 * ⚠️ 要幹事撳之前就知道收件人會收到甚麼。
 * 只寫「不附」三個字，他會以為那封信是空的。
 *
 * @param {string} attachType `ATTACH_TYPE` 之一
 * @returns {string} 一行
 */
function describeAttachOption_(attachType) {
  const t = String(attachType || '').toUpperCase();
  if (t === ATTACH_TYPE.NONE) {
    return '收件人會收到：信件內文 ＋ 他自己那條個人專屬連結（打開只看到他自己那幾格）'
      + ' ＋ 那條永久連結。';
  }
  if (t === ATTACH_TYPE.PERSONAL_PDF) {
    return '收件人會收到：他自己那一份 PDF（他的名字有標示）'
      + ' ＋ 他自己那條個人專屬連結 ＋ 那條永久連結。';
  }
  if (t === ATTACH_TYPE.FULL_PDF) {
    return '收件人會收到：一份整季 PDF（沒有任何標示，大家看的都一樣）'
      + ' ＋ 那條永久連結。這一種沒有個人專屬連結。';
  }
  return '';
}

/**
 * 個人專屬連結那一段（純文字版）。
 * @param {string} url 網址
 * @returns {string} 段落
 */
function buildPersonalLinkFooterPlain_(url) {
  return '\n\n你自己那一份（打開只看到你有份服侍的日子）：\n' + url;
}

/**
 * 同上，HTML 版。⚠️ 網址要轉義——它來自資料，理論上可以含 `&`。
 * @param {string} url 網址
 * @returns {string} HTML
 */
function buildPersonalLinkFooterHtml_(url) {
  const safe = String(url)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return '<p>你自己那一份（打開只看到你有份服侍的日子）：<br>'
    + '<a href="' + safe + '">' + safe + '</a></p>';
}

/**
 * 把個人專屬連結加落信末。
 *
 * ⚠️ 三種情況（`tests/personal_link_in_mail.test.js` 各斷言一次）：
 *   這一種附件不需要個人連結（整季 PDF）　⇒ 原封不動
 *   需要，但那個人沒有 token／沒有設定網址 ⇒ 原封不動（**不可以出現空連結**）
 *   需要而且拿得到　　　　　　　　　　　　 ⇒ 加
 *
 * @param {string} text 已經套用完 placeholder 的內文
 * @param {string} url 個人專屬連結（拿不到時傳空字串）
 * @param {boolean} isHtml 是不是 HTML 版
 * @returns {string} 加完（或者原封不動）的內文
 */
function appendPersonalLinkFooter_(text, url, isHtml) {
  const link = String(url || '').trim();
  if (!link) return text;
  return String(text || '')
    + (isHtml ? buildPersonalLinkFooterHtml_(link) : buildPersonalLinkFooterPlain_(link));
}

/**
 * `PersonID` → `PersonalLinkToken`。**純讀取，一次過讀好。**
 *
 * ⚠️ 在 `buildMailContext_()` 讀一次，不要在 `deliverOne_()` 逐個人讀一次表——
 * 幾十位收件人就是幾十次讀表，而那條路本來就已經接近執行上限。
 *
 * @returns {Object.<string, string>} 對照表；沒有 token 的人不會出現在裡面
 */
function indexPersonalLinkTokens_() {
  const N = COLUMNS.NAME_MAPPING;
  const out = {};
  try {
    readPeople().forEach(function (row) {
      const id = String(row[N.PERSON_ID] || '').trim();
      const token = String(row[N.PERSONAL_LINK_TOKEN] || '').trim();
      if (id && token) out[id] = token;
    });
  } catch (err) {
    // ⚠️ 讀不到**不可以令整批寄信失敗**——個人連結是錦上添花，
    // 職事表本身才是主體。但要寫 log，而且那幾位會被算進
    // 「沒有個人連結」那個數字，報告會講出來。
    log_('WARN', 'indexPersonalLinkTokens_ 讀不到：' + err.message);
  }
  return out;
}
