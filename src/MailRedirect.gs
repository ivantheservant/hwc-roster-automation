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
 * ⚠️ 第四十四輪批次 E 組：可以填**多過一個**地址，用逗號、分號、頓號
 * 或者換行分開都可以（例如「我自己 ＋ 幫手那位」一齊看同一批信）。
 * 逐個地址照樣要通過 `isPlausibleEmail_()`；有一個打錯就整批拋，
 * 不會「寄得到那幾個先寄」——部分成功在這裡是最壞的結果。
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
 * 第四十四輪批次 E 組：**可以填多過一個地址。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要改
 * ═════════════════════════════════════════════════════════════════════
 *
 * Ivan 想同時用兩個信箱睇實測（一個自己、一個幫手嗰位）。他在 Config 填了
 * 兩個地址、用逗號分隔，然後一撳寄出就收到：
 *
 *     Config 的 MAIL_REDIRECT_ALL_TO 填了「a@…, b@…」，
 *     但它看起來不像一個電郵地址。
 *
 * 成因：整串字直接餵去 `isPlausibleEmail_()`，而它見到逗號同空白就回
 * `false`（它本來就是驗**一個**地址的）。
 *
 * ⚠️ 分隔符要收得闊：逗號、分號、頓號、換行、空白都算。
 * 幹事在試算表一格入面打兩個地址，最自然就是打一個頓號或者換行——
 * 而「只認半形逗號」等於把同一個錯留在下一次。
 *
 * ⚠️ 但驗證**不可以放寬**：逐個地址照樣要通過 `isPlausibleEmail_()`。
 * 一個打錯的地址混在裡面而系統照寄，等於那一封靜靜掉進黑洞。
 *
 * @param {string} raw Config 那一格的原文
 * @returns {{targets: string[], bad: string[]}} 通過的、同埋看起來不像電郵的
 */
function parseMailRedirectTargets_(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw);
  const pieces = text.split(/[,;、\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });

  const targets = [];
  const bad = [];
  pieces.forEach(function (p) {
    if (!isPlausibleEmail_(p)) { bad.push(p); return; }
    // 重複嘅唔算錯，但唔好寄兩次。
    if (targets.indexOf(p) === -1) targets.push(p);
  });
  return { targets: targets, bad: bad };
}

/**
 * 現時的轉寄地址，逐個。空陣列代表沒有設定（正常運作）。
 *
 * ⚠️ 讀不到 Config **不可以當成「沒有設定」**——那樣會在應該轉寄的時候
 * 真的寄給義工。讀不到就拋，寧可寄不出。
 *
 * ⚠️ 有一個打錯就**整批拋**，不會「寄得到那幾個先寄」。
 * 部分成功在這裡是最壞的結果：幹事見到信到了，就以為設定沒有問題，
 * 而其實有一個地址由頭到尾收不到，他要對到最後才發現。
 *
 * @returns {string[]} 轉寄地址；沒有設定時回空陣列
 */
function readMailRedirectTargets_() {
  const raw = getConfig(CONFIG_KEYS.MAIL_REDIRECT_ALL_TO, '');
  const value = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!value) return [];

  const parsed = parseMailRedirectTargets_(value);
  if (parsed.bad.length > 0) {
    throw new Error(buildThreePartMessage_(
      'Config 的 ' + CONFIG_KEYS.MAIL_REDIRECT_ALL_TO + ' 入面，這 '
        + parsed.bad.length + ' 個看起來不像電郵地址：' + parsed.bad.join('、'),
      '一封都沒有寄出。',
      ['去 Config 工作表把它們改成正確的電郵地址',
        '要填多過一個地址的話，用逗號、分號、頓號或者換行分開都可以',
        '或者把整格清空——清空就代表正常寄給收件人本人']));
  }
  if (parsed.targets.length === 0) {
    // 例如成格得幾個逗號。當成「填錯咗」處理，唔可以當成冇設定——
    // 當成冇設定就會真係寄咗俾義工。
    throw new Error(buildThreePartMessage_(
      'Config 的 ' + CONFIG_KEYS.MAIL_REDIRECT_ALL_TO + ' 填了「' + value
        + '」，但入面找不到任何一個電郵地址。',
      '一封都沒有寄出。',
      ['去 Config 工作表填一個正確的電郵地址',
        '或者把整格清空——清空就代表正常寄給收件人本人']));
  }
  return parsed.targets;
}

/**
 * 現時的轉寄地址，砌成 `MailApp.sendEmail()` 收得嘅一個字串。
 * 空字串代表沒有設定（正常運作）。
 *
 * ⚠️ 名同回傳型別都保持不變，因為 `sendRealEmail_()` 要嘅正正係
 * 一個「收件人字串」。多過一個就用逗號駁埋——`MailApp` 本身收得。
 *
 * @returns {string} 轉寄地址；沒有設定時回空字串
 */
function readMailRedirectTarget_() {
  return readMailRedirectTargets_().join(',');
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
  let targets = [];
  try {
    targets = readMailRedirectTargets_();
  } catch (err) {
    // 設定有問題本身也要講出來——比「沒有標籤」好。
    return '⚠️ 轉寄設定有問題：' + err.message.split('\n')[0];
  }
  if (targets.length === 0) return '';
  // ⚠️ 第四十四輪批次 E 組：**逐個列出來，不可以只講「2 個地址」。**
  // 這個標籤唯一的用途，就是讓幹事一眼認得出「這不是我要的設定」。
  // 只講個數，他要走去 Config 才知道是哪幾個——而那正是他不會做的一步。
  return '⚠️ 全部信件轉寄至 ' + targets.join('、')
    + (targets.length > 1 ? ('（共 ' + targets.length + ' 個地址）') : '');
}

/* ═════════════════════════════════════════════════════════════════════
 * 第五十輪批次 E 組：**`SendLog` 缺 `IntendedEmail` 同 `DeliveredTo`。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 現場（第四十九輪自測機嘅 I01，每一個情境都報）：
 *
 *     I01｜預期 0 個缺欄｜實際 2 個缺欄｜
 *     SendLog：缺「IntendedEmail」（COLUMNS.SEND_LOG.INTENDED_EMAIL）；
 *     SendLog：缺「DeliveredTo」（COLUMNS.SEND_LOG.DELIVERED_TO）
 *
 * 呢一條係真嘅：
 *   ・`Constants.gs` 定義咗兩個鍵，而且註釋自己寫住「兩樣都要記」
 *   ・`Mailer.gs` 真係有寫呢兩個值入 `record`
 *   ・**但** `writeSendLogRows_()` 係按表頭逐欄寫（`headers.map(...)`），
 *     而真實試算表冇呢兩欄 ⇒ 兩個值靜靜掉咗
 *
 * ⚠️ 後果好實在：`MAIL_REDIRECT_ALL_TO` 而家有值、正在生效。
 * 即係 Ivan 準備做嘅真實寄信測試，`SendLog` 只會記到轉寄地址，
 * 記唔到「呢一封原本要寄畀邊個」。
 * 第四十一輪 H 組要防嗰件事，**一次都冇真正生效過**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 同第四十七輪 C 組一模一樣
 * ─────────────────────────────────────────────────────────────────────
 *
 * 第四十七輪修嘅係 `SpecialSundays` 缺 `Confirmed`。同一種病：
 * **`COLUMNS` 定義咗鍵，真實試算表冇嗰一欄，寫入靜靜略過。**
 *
 * ⚠️ 而第四十七輪 C5 特登為此寫嘅 `tools/lint-schema-drift.js`
 * **捉唔到呢一個**——因為佢比對嘅係「`COLUMNS.<SHEET>` 嘅鍵」對
 * 「程式碼入面嘅 `*_HEADERS_TC` 陣列」，而 `SendLog` 喺程式碼入面
 * 根本冇 header 陣列，所以佢冇嘢可以比，就當成冇問題。
 *
 * **即係嗰支 lint 只驗得到「碼對碼」，驗唔到「碼對真實試算表」。**
 * 呢一次係 I01（執行期不變量）捉到嘅。
 */

/** `SendLog` 應該有、而真實試算表可能冇嘅欄。 */
function sendLogExpectedKeys_() {
  const C = COLUMNS.SEND_LOG;
  return Object.keys(C).map(function (k) { return C[k]; });
}

/**
 * 算一算 `SendLog` 缺邊幾欄。**純讀取。**
 *
 * @returns {{sheetExists: boolean, headers: string[], missing: string[],
 *   nextCol: number, rowCount: number}}
 */
function planSendLogColumnBackfill_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);
  if (!sheet) {
    return { sheetExists: false, headers: [], missing: [], nextCol: 0, rowCount: 0 };
  }
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0
    ? sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (v) {
      return String(v || '').trim();
    })
    : [];
  const missing = sendLogExpectedKeys_().filter(function (key) {
    return headers.indexOf(key) === -1;
  });
  return {
    sheetExists: true, headers: headers, missing: missing,
    nextCol: lastCol + 1, rowCount: Math.max(0, lastRow - 2)
  };
}

/**
 * 真正補欄。**只喺最後加欄，一格既有資料都唔會動。**
 *
 * ⚠️ **唔會替既有行填值。** 舊行到底寄咗去邊，而家已經無從得知——
 * 猜一個上去就係造假紀錄。而一份造假嘅寄送紀錄，比冇紀錄更差：
 * 冇紀錄嘅時候你知道自己唔知；假紀錄會令你以為自己知。
 *
 * @param {Object} plan `planSendLogColumnBackfill_()` 的結果
 * @returns {{added: string[]}}
 */
function executeSendLogColumnBackfill_(plan) {
  if (!plan.sheetExists || plan.missing.length === 0) return { added: [] };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);
  let col = plan.nextCol;
  plan.missing.forEach(function (key) {
    // 第 1 行係中文標題、第 2 行係機器鍵——同其他工作表一樣。
    sheet.getRange(1, col).setValue(key);
    sheet.getRange(2, col).setValue(key);
    col++;
  });

  // ⚠️ **到此為止。** 唔會替任何一行填值。

  writeAuditLog_({
    action: 'SEND_LOG_COLUMN_BACKFILL',
    targetSheet: SHEETS.SEND_LOG,
    targetCell: '第 ' + plan.nextCol + ' 欄起',
    oldValue: '（沒有這幾欄）',
    newValue: plan.missing.join('、'),
    source: 'executeSendLogColumnBackfill_',
    notes: '只在最後加欄；沒有重排、沒有刪除、沒有改動任何既有資料，'
      + '亦沒有替任何一行填值（舊行寄去了哪裡已經無從得知，'
      + '猜一個上去就是造假紀錄）'
  });
  return { added: plan.missing.slice() };
}

/**
 * 選單項目「維護 ▸ ⚠️ 補建 SendLog 缺欄」的執行入口。
 * @returns {void}
 */
function runSendLogColumnBackfill_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 SendLog 缺欄';

  let plan;
  try {
    plan = planSendLogColumnBackfill_();
  } catch (err) {
    log_('ERROR', 'runSendLogColumnBackfill_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (!plan.sheetExists) {
    ui.alert(title, '找不到「' + SHEETS.SEND_LOG + '」這一張工作表。', ui.ButtonSet.OK);
    return;
  }
  if (plan.missing.length === 0) {
    ui.alert(title,
      '這一張表已經有全部欄，沒有改動。\n\n'
        + '目前有 ' + plan.headers.length + ' 欄、' + plan.rowCount + ' 行資料。',
      ui.ButtonSet.OK);
    return;
  }

  const lines = [
    '「' + SHEETS.SEND_LOG + '」現在缺這 ' + plan.missing.length + ' 欄：',
    '　' + plan.missing.join('、'),
    ''
  ];
  // ⚠️ 轉寄生效嗰陣要講得特別清楚——嗰個就係呢兩欄存在嘅理由。
  let redirectTargets = [];
  try {
    redirectTargets = readMailRedirectTargets_();
  } catch (err) {
    redirectTargets = [];
  }
  if (redirectTargets.length > 0
      && plan.missing.indexOf(COLUMNS.SEND_LOG.INTENDED_EMAIL) !== -1) {
    lines.push('⚠️ 轉寄測試地址目前生效中（' + redirectTargets.join('、') + '）。');
    lines.push('　 缺了「' + COLUMNS.SEND_LOG.INTENDED_EMAIL + '」這一欄，');
    lines.push('　 寄出去之後就查不到「這一封原本要寄給誰」。');
    lines.push('');
  }
  lines.push('會做的事：');
  lines.push('　・在最後（第 ' + plan.nextCol + ' 欄起）加這幾欄，標題同機器鍵各一行');
  lines.push('');
  lines.push('不會做的事：');
  lines.push('　・不會重排、不會刪除任何一欄');
  lines.push('　・不會改動任何一格既有資料');
  lines.push('　・不會替任何一行填值');
  lines.push('');
  lines.push('補完之後，既有的 ' + plan.rowCount + ' 行這幾欄會是空白——那是正常的，');
  lines.push('因為那些是補欄之前寄的，寄去了哪裡已經無從得知。');
  lines.push('');
  lines.push('要加這幾欄嗎？');

  if (ui.alert(title, lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  let result;
  try {
    result = executeSendLogColumnBackfill_(plan);
  } catch (err) {
    log_('ERROR', 'executeSendLogColumnBackfill_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  ui.alert(title,
    '已經加好這 ' + result.added.length + ' 欄：\n　' + result.added.join('、') + '\n\n'
      + '既有的 ' + plan.rowCount + ' 行這幾欄是空白的——那是正常的。\n'
      + '由現在起寄出的每一封，都會記得到「原本要寄給誰」同「實際寄去了哪裡」。',
    ui.ButtonSet.OK);
}
