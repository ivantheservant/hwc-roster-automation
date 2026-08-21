/**
 * 第四十一輪批次 H 組：**安全地真正寄一次信。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 為什麼需要這一個
 * ═════════════════════════════════════════════════════════════════════
 *
 * Ivan 要試「寄出」這個功能——真的產生附件、真的經過 `MailApp`、
 * 真的收到一封信。`DRY_RUN = TRUE` 做不到這件事：它在 `sendRealEmail_()`
 * 之前就攔住了，整條路的後半段從來沒有真的跑過。
 *
 * 但是**不可以直接把 `DRY_RUN` 改成 `FALSE`**：
 * `NameMapping` 現在有幾十位真實義工的真實電郵。一撳寄出，
 * 幾十封信立刻寄出去，主旨還帶著測試前綴、內容是測試季度的資料。
 * **這是不可以還原的。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * 做法：`MAIL_REDIRECT_ALL_TO`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Config 有值的時候，**每一封信的收件人一律改成那個地址**，
 * 不論 `DRY_RUN` 是 `TRUE` 還是 `FALSE`。
 *
 * 於是 `DRY_RUN = FALSE` ＋ `MAIL_REDIRECT_ALL_TO = 你自己的地址`
 * 就可以走完整條路，而**沒有任何一封會去到義工手上**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 一個「安全地寄錯人」的機制，本身就是一個危險
 * ─────────────────────────────────────────────────────────────────────
 *
 * 它最壞的失敗方式不是「轉寄不成功」，而是**忘記關掉**——
 * 上線之後幹事撳「正式發出」，全體義工一封都收不到，
 * 而系統報告會說「已寄出 51 封」，SendLog 也會說成功。
 *
 * 所以這個機制的每一處都要**大聲**：
 *   ・信件主旨前面加 `[原收件人：XXX]`
 *   ・信件內文頂部一段明顯的橫幅
 *   ・`SendLog` 兩樣都記（原本要寄給誰、實際寄到哪裡）
 *   ・幹事介面頂部一個標籤，跟「測試模式」那個並排
 *   ・上線前檢查列為 🔴 必須處理
 *
 * 五處全部有測試釘住。少一處，它就有機會靜靜生效。
 */

/**
 * 現時的轉寄地址。空字串代表沒有設定（正常運作）。
 *
 * ⚠️ 讀不到 Config **不可以當成「沒有設定」**——那樣會在應該轉寄的時候
 * 真的寄給義工。讀不到就拋，寧可寄不出。
 *
 * @returns {string} 轉寄地址；沒有設定時回空字串
 */
function readMailRedirectTarget_() {
  const raw = getConfig(CONFIG_KEYS.MAIL_REDIRECT_ALL_TO, '');
  const value = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!value) return '';
  if (!isPlausibleEmail_(value)) {
    throw new Error(buildThreePartMessage_(
      'Config 的 ' + CONFIG_KEYS.MAIL_REDIRECT_ALL_TO + ' 填了「' + value
        + '」，但它看起來不像一個電郵地址。',
      '一封都沒有寄出。',
      ['去 Config 工作表把它改成一個正確的電郵地址',
        '或者把它清空——清空就代表正常寄給收件人本人']));
  }
  return value;
}

/**
 * 把一封信按轉寄設定改寫。**純函式，可以離線測。**
 *
 * @param {Object} plan {toEmail, displayName, subject, bodyHtml, bodyPlain}
 * @param {string} redirectTo 轉寄地址（空字串代表不轉寄）
 * @returns {Object} {toEmail, subject, bodyHtml, bodyPlain, redirected, originalEmail}
 */
function applyMailRedirect_(plan, redirectTo) {
  const target = String(redirectTo || '').trim();
  if (!target) {
    return {
      toEmail: plan.toEmail,
      subject: plan.subject,
      bodyHtml: plan.bodyHtml,
      bodyPlain: plan.bodyPlain,
      redirected: false,
      originalEmail: plan.toEmail
    };
  }

  // ⚠️ 主旨前面一定要寫出**本來寄給誰**。
  // 收件匣裡面幾十封主旨一模一樣的信，分不出是哪一位的。
  const who = String(plan.displayName || '').trim() || String(plan.toEmail || '').trim() || '（不知道是誰）';
  const banner = '⚠️ 這封信本來是寄給「' + who + '」（' + plan.toEmail + '），'
    + '因為系統設定了轉寄測試地址（' + CONFIG_KEYS.MAIL_REDIRECT_ALL_TO
    + '），所以寄到你這裡。收件人本人沒有收到這封信。';

  return {
    toEmail: target,
    subject: '[原收件人：' + who + '] ' + plan.subject,
    bodyHtml: buildRedirectBannerHtml_(banner) + String(plan.bodyHtml || ''),
    bodyPlain: banner + '\n\n────────────────────\n\n' + String(plan.bodyPlain || ''),
    redirected: true,
    originalEmail: plan.toEmail
  };
}

/**
 * 橫幅的 HTML 版。
 * ⚠️ 要轉義——`displayName` 是使用者輸入，不轉義就是一條 XSS 路。
 * @param {string} text 橫幅文字
 * @returns {string} HTML
 */
function buildRedirectBannerHtml_(text) {
  const safe = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="background:#fce8e6;border:2px solid #a1160a;color:#a1160a;'
    + 'padding:12px;margin-bottom:16px;font-weight:bold;">' + safe + '</div>';
}

/**
 * 幹事介面頂部那個標籤的文字。沒有設定時回空字串。
 *
 * ⚠️ **不可以靜靜生效。** 這個機制最壞的失敗方式是「忘記關掉」——
 * 上線之後幹事撳「正式發出」，全體一封都收不到，而報告說「已寄出 51 封」。
 * 所以介面上一定要有一個看得見的標籤。
 *
 * @returns {string} 標籤文字；沒有設定時回空字串
 */
function buildMailRedirectBadgeText_() {
  let target = '';
  try {
    target = readMailRedirectTarget_();
  } catch (err) {
    // 設定有問題本身也要講出來——比「沒有標籤」好。
    return '⚠️ 轉寄設定有問題：' + err.message.split('\n')[0];
  }
  if (!target) return '';
  return '⚠️ 全部信件轉寄至 ' + target;
}
