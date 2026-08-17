/**
 * 把姓名的異體寫法透過 NameAlias 表轉換為正名（NameTC）。
 * 找不到對應 Alias 時原樣回傳輸入的名稱。
 * @param {string} name 輸入的姓名（可能是別名或正名）
 * @returns {string} 正名；找不到對應時回傳原始輸入
 */
function normalizeName(name) {
  if (!name) return name;
  const aliasMap = readNameAlias();
  const personId = aliasMap[name];
  if (!personId) return name;

  const people = readSheet(SHEETS.NAME_MAPPING);
  for (let i = 0; i < people.length; i++) {
    if (people[i][COLUMNS.NAME_MAPPING.PERSON_ID] === personId) {
      return people[i][COLUMNS.NAME_MAPPING.NAME_TC] || name;
    }
  }
  return name;
}

/**
 * 依姓名精確查找 PersonID：先比對 NameMapping 的正名（NameTC），再查 NameAlias。
 * 不做模糊比對。
 * @param {string} name 姓名（正名或別名）
 * @returns {?string} 找到的 PersonID；找不到則回傳 null
 */
function resolvePersonId(name) {
  if (!name) return null;
  const people = readSheet(SHEETS.NAME_MAPPING);
  for (let i = 0; i < people.length; i++) {
    if (people[i][COLUMNS.NAME_MAPPING.NAME_TC] === name) {
      return people[i][COLUMNS.NAME_MAPPING.PERSON_ID];
    }
  }
  const aliasMap = readNameAlias();
  return aliasMap[name] || null;
}

/**
 * 第十五輪批次新增：把幹事喺 `ui.prompt()` 輸入嘅識別字串（QuarterID、
 * PersonID 等）正規化，防止「睇落一模一樣、但 `===` 比對唔到」呢類隱形
 * 輸入錯誤。
 *
 * 背景：全專案有超過 20 個 `ui.prompt()` 輸入點捕捉 QuarterID，全部只做
 * `.trim()`，冇處理**全形字元**。中文輸入法一旦切咗去全形模式，打「2026T4」
 * 會變成「２０２６Ｔ４」——喺對話框嘅小字型入面同半形字幾乎睇唔出分別，
 * 但 `'２０２６Ｔ４' === '2026T4'` 係 `false`。呢類輸入唔會被 `.trim()`
 * 處理，會令 `findLatestVersionNo()`／`readServiceDates()` 呢類靠嚴格
 * 相等比對嘅查詢靜靜噉搵唔到、回傳「已存在但你打嘅嗰個字串搵唔到」呢種
 * 睇落好似資料有問題、其實係輸入有問題嘅假象。
 *
 * **唔止 QuarterID**——同一個風險喺任何「人手打字入一個要同資料庫做嚴格
 * 相等比對嘅識別字串」嘅地方都存在，例如「重新產生單一個人的 token」
 * 輸入嘅 PersonID（`reissuePersonalLinkToken_()`）。函式名冇叫
 * `normalizeQuarterId_` 就係刻意留返做通用嘅識別字輸入正規化，唔止服務
 * QuarterID 一種用途。
 *
 * 處理埋兩類人手輸入常見嘅隱形字元問題：
 * 1. **全形 ASCII**（U+FF01–U+FF5E）轉返半形（U+0021–U+007E，減
 *    `0xFEE0`）——涵蓋全形數字、全形英文字母、全形符號。
 * 2. **零闊度字元**（U+200B 零闊度空格、U+FEFF BOM／零闊度不斷行空格、
 *    U+200C／U+200D）——複製貼上常見嘅隱形殘留，一律移除。
 *
 * 刻意**唔轉大小寫**——QuarterID／PersonID 本身有意義嘅大小寫（例如
 * `2026T4` 嘅 `T` 係大寫），唔應該幫使用者「猜」佢想打乜，只處理呢兩類
 * 客觀上「睇落一樣、實際上唔一樣」嘅字元差異。
 *
 * @param {*} raw 使用者輸入嘅原始文字
 * @returns {string} 正規化之後嘅字串
 */
function normalizeIdInput_(raw) {
  let text = String(raw === null || raw === undefined ? '' : raw);
  // 全形 ASCII → 半形
  text = text.replace(/[！-～]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  // 零闊度字元一律移除
  text = text.replace(/[​‌‍﻿]/g, '');
  return text.trim();
}

/**
 * 把 Date 物件格式化為 yyyy-MM-dd 字串，使用 Config 設定的時區（SYS_TIMEZONE）。
 * @param {Date} date 日期物件
 * @returns {string} 格式化後的日期字串
 */
function formatDate(date) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return toDateString(date, timezone);
}

/**
 * 把 yyyy-MM-dd 字串解析為 Date 物件，使用 Config 設定的時區（SYS_TIMEZONE）。
 * @param {string} str 日期字串，格式為 yyyy-MM-dd
 * @returns {Date} 解析後的日期物件
 */
function parseDate(str) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return Utilities.parseDate(str + ' 00:00:00', timezone, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * 把儲存格值（可能是 Date 物件或字串）正規化為 yyyy-MM-dd 字串。
 * 時區以參數明確傳入，不讀取 Config，方便在純函式中使用。
 *
 * 追加階段 AB：原本字串一律原樣 `String(value).trim()` 回傳，等於只處理了
 * Date 物件那一半，跟這個函式自己的說明（「正規化為 yyyy-MM-dd」）並不相符。
 * 實測踩到的問題：Requests 的日期格由下拉選單揀入之後，Google 試算表會把
 * 「2026-10-04」自動辨識成真正的日期值，讀出來是 Date 物件；而當時
 * readPendingRequests_() 用的是 `String(...)`，得出
 * 「Sun Oct 04 2026 00:00:00 GMT+1300 (New Zealand Daylight Time)」，
 * 拿去跟已正規化的 ServiceDates 比對必然對不上，三筆申報全部被判 NEEDS_INPUT。
 *
 * 現在字串也會嘗試辨識兩種常見寫法再統一輸出 yyyy-MM-dd：
 *   yyyy-MM-dd／yyyy/MM/dd（補零，例如 2026-1-5 → 2026-01-05）
 *   d/M/yyyy／dd-MM-yyyy（**日在前**，例如 4/10/2026 → 2026-10-04）
 * 日在前是刻意的選擇，對應本專案的 en_NZ 地區設定（見 SPREADSHEET_LOCALE_NZ）
 * 與幹事的書寫習慣；不會出現「4/10 被讀成 4 月 10 日」這種美式解讀。
 * 兩種都辨識不到時原樣回傳（只 trim），讓錯誤訊息能顯示幹事實際輸入了什麼，
 * 而不是靜靜換成一個猜出來的日期。
 *
 * @param {*} value 儲存格原始值，可為 Date 或字串
 * @param {string} timezone 時區名稱，例如 "Pacific/Auckland"
 * @returns {string} yyyy-MM-dd 格式字串；空值時回傳空字串；無法辨識時回傳原字串
 */
function toDateString(value, timezone) {
  // ⚠️ 第二十一輪批次階段 C：呢個函式服務嘅係「**讀系統自己寫入嘅資料**」
  // （ServiceDates／RosterAssignments／Unavailable／Quarters 等等）。
  //
  // **唔可以收緊。** 收緊會令既有資料讀唔到——例如 Requests 有一行歷史
  // 紀錄係 `2027/05/09`（已 APPLIED），收緊嘅話讀嗰行就會拋錯。
  //
  // **幹事輸入嘅日期唔好用呢個。** 佢接受 `dd/MM/yyyy`，即係
  // `05/06/2027` 一律當 6 月 5 日——無聲噉猜，猜錯就係把人排錯主日。
  // 幹事輸入路徑一律用 `parseOfficerDateInput_()`（見下面）。
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }

  const text = String(value).trim();
  if (text === '') return '';

  const pad2 = function (s) { return s.length === 1 ? '0' + s : s; };

  const isoLike = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoLike) return isoLike[1] + '-' + pad2(isoLike[2]) + '-' + pad2(isoLike[3]);

  const dayFirst = text.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dayFirst) return dayFirst[3] + '-' + pad2(dayFirst[2]) + '-' + pad2(dayFirst[1]);

  return text;
}

/**
 * 第二十一輪批次階段 C：**幹事輸入**嘅日期，只收兩種寫法。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要同 `toDateString()` 分家
 * ─────────────────────────────────────────────────────────────────────
 *
 * `toDateString()` 服務嘅係「**讀系統自己寫入嘅資料**」——ServiceDates、
 * RosterAssignments、Unavailable 等等。嗰啲值係系統寫嘅，格式受控，
 * 寬鬆少少冇問題，而且**唔可以收緊**：收緊會令舊資料讀唔到。
 *
 * 但佢同時被用嚟讀**幹事打入去嘅** Requests 日期欄，而嗰邊寬鬆係有害嘅：
 *
 * `toDateString()` 會接受 `dd/MM/yyyy`，即係 `05/06/2027` 一律當
 * **6 月 5 日**。呢個係**無聲噉猜**——猜錯就係把人排錯主日，
 * 而且冇任何提示。日／月次序喺唔同地方習慣唔同，冇得靠估。
 *
 * 而且原本嘅錯誤訊息寫「斜線、句點、日月倒轉、全形數字都認不出來」，
 * 但實際上斜線同日月倒轉係收嘅——**訊息同行為唔一致**，
 * 幹事照住訊息改反而改到一個系統會靜靜猜錯嘅寫法。
 *
 * 所以：幹事輸入路徑只收兩種，而且錯誤訊息同實際行為完全一致。
 *
 * | 輸入 | 收唔收 | 理由 |
 * |---|---|---|
 * | 儲存格本身係 Date 物件 | ✅ | 由下拉選單揀嘅一定係噉，最穩陣 |
 * | 文字 `yyyy-MM-dd` | ✅ | 冇歧義 |
 * | `2027/05/16` | ❌ | 斜線同 `dd/MM/yyyy` 撞，要靠估 |
 * | `16/05/2027` | ❌ | 日月次序靠估 |
 * | `2027.05.16`、`2027年5月16日`、全形數字 | ❌ | 認唔到 |
 *
 * @param {*} value 儲存格原始值
 * @param {string} timezone 時區
 * @returns {{ok: boolean, dateStr: string, rawText: string}}
 *   `ok=false` 時 `dateStr` 係空字串，`rawText` 係原本嘅文字（供錯誤訊息回顯）
 */
function parseOfficerDateInput_(value, timezone) {
  if (value === null || value === undefined || value === '') {
    return { ok: false, dateStr: '', rawText: '' };
  }

  // 由下拉選單揀入嘅日期，Google 試算表會辨識成真正嘅日期值 ⇒ Date 物件。
  // 呢個係最穩陣嘅輸入方式，亦係我哋鼓勵嘅做法。
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return {
      ok: true,
      dateStr: Utilities.formatDate(value, timezone, 'yyyy-MM-dd'),
      rawText: ''
    };
  }

  const text = String(value).trim();
  if (text === '') return { ok: false, dateStr: '', rawText: '' };

  // 嚴格 yyyy-MM-dd：月同日一定要兩位數，唔接受 `2027-5-6`。
  // 唔係吹毛求疵——接受一位數就要決定 `2027-5-6` 係咪等於 `2027-05-06`，
  // 而嗰個判斷同下拉選單揀出嚟嘅格式又唔一致，徒增一種要維護嘅寫法。
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { ok: true, dateStr: text, rawText: text };
  }

  return { ok: false, dateStr: '', rawText: text };
}

/**
 * 第二十二輪批次階段 B1：把儲存格值轉成報告／確認視窗要顯示嘅文字，
 * 唔會誤把 `false`、`0` 呢類「有意義嘅假值」當成「冇值」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個 helper（同一個 bug class 已經燒過幾次）
 * ─────────────────────────────────────────────────────────────────────
 *
 * `String(value || '').trim()` 呢種寫法好常見，但 `||` 判斷嘅係 JS 嘅
 * falsy——`false`、`0`、`''`、`null`、`undefined` 全部一視同仁。
 * 一格 boolean `false`（例如 Eligibility.Active）經過呢種寫法會變成
 * `false || '' → ''`，畫面就印出「Active=」而唔係「Active=FALSE」，
 * 睇落好似個值不見咗，實際上係一個明確嘅假值。
 *
 * 第十八輪 `countHardViolations_` 漏傳 `roles`、呢一輪嘅 QuarterReset.gs
 * B1，都係同一個 bug class：**用 `||` 做預設值，會連「有意義嘅假值」
 * 一齊吞埋。**
 *
 * 呢個 helper 淨係喺 `null`／`undefined`／空字串先用 fallback，
 * boolean `false` 與數字 `0` 一律照原樣顯示（用 `String()` 轉字串）。
 *
 * ⚠️ **呢個係顯示用嘅 helper，唔係讀資料嘅 helper**——只負責「畫面應該
 * 印咩字」，唔負責判斷業務邏輯（例如「呢一行是否啟用」仍然要用
 * `isTrueValue_()` 呢類明確嘅判斷式，唔好用呢個 helper 嘅回傳值去做
 * if 判斷）。
 *
 * @param {*} value 儲存格原始值
 * @param {string=} fallback 值缺失時顯示嘅文字，預設 '（空白）'
 * @returns {string} 用嚟顯示嘅文字
 */
function displayCellValue_(value, fallback) {
  const fb = fallback === undefined ? '（空白）' : fallback;
  if (value === null || value === undefined) return fb;
  if (value === '') return fb;
  return String(value);
}

/**
 * 把逗號分隔的字串拆成陣列，並去除前後空白與空項目。
 * @param {*} value 原始儲存格值
 * @returns {string[]} 拆分後的陣列；空值時回傳空陣列
 */
function splitList_(value) {
  if (value === null || value === undefined || value === '') return [];
  return String(value)
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/**
 * 計算兩個 yyyy-MM-dd 日期字串之間相差的天數。
 * 直接以日期數字運算，不受時區與夏令時間影響。
 * @param {string} fromDateStr 起始日期，格式 yyyy-MM-dd
 * @param {string} toDateStr 結束日期，格式 yyyy-MM-dd
 * @returns {number} 相差天數；toDateStr 較早時為負數
 */
function daysBetween_(fromDateStr, toDateStr) {
  const from = Date.UTC(
    Number(fromDateStr.slice(0, 4)),
    Number(fromDateStr.slice(5, 7)) - 1,
    Number(fromDateStr.slice(8, 10))
  );
  const to = Date.UTC(
    Number(toDateStr.slice(0, 4)),
    Number(toDateStr.slice(5, 7)) - 1,
    Number(toDateStr.slice(8, 10))
  );
  return Math.round((to - from) / 86400000);
}

/**
 * 把 yyyy-MM-dd 日期字串平移指定天數，回傳新的 yyyy-MM-dd 字串。
 * 用 UTC 日期數字運算，不受時區與夏令時間影響（與 daysBetween_ 同一套做法）。
 * @param {string} dateStr 起始日期，格式 yyyy-MM-dd
 * @param {number} days 要平移的天數，可為負數
 * @returns {string} 平移後的日期字串
 */
function shiftDateString_(dateStr, days) {
  const base = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10))
  );
  const shifted = new Date(base + days * 86400000);
  return Utilities.formatDate(shifted, 'UTC', 'yyyy-MM-dd');
}

/**
 * 判斷一個 yyyy-MM-dd 日期字串是不是星期日。用 UTC 運算避免時區誤差。
 * @param {string} dateStr 日期字串，格式 yyyy-MM-dd
 * @returns {boolean} 是否為星期日
 */
function isSundayDate_(dateStr) {
  const base = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10))
  );
  return new Date(base).getUTCDay() === 0;
}

/**
 * 逸出字串中的正規表示式特殊字元，讓字串可以安全地當成正規表示式的字面內容使用。
 * @param {string} text 原始字串
 * @returns {string} 逸出後的字串
 */
function escapeRegExp_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 產生統一格式的時間戳字串，供所有寫入儲存格的時間欄位使用。
 *
 * 刻意寫入**字串**而非 Date 物件：Date 物件在儲存格的顯示會受試算表本身的
 * 地區與時區設定影響，設定不對就會出現差一日或美式日期格式。
 * 字串則不論試算表設定如何都顯示相同內容。
 *
 * 時區一律從 Config 的 SYS_TIMEZONE 讀取，不寫死在程式內。
 *
 * @param {Date=} date 要格式化的時間；省略時採用現在時間
 * @returns {string} yyyy-MM-dd HH:mm:ss 格式的字串
 */
function nowTimestamp_(date) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return Utilities.formatDate(date || new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * 產生用於 ID 的緊湊時間戳（yyyyMMddHHmmss），時區同樣取自 Config。
 * @param {Date=} date 要格式化的時間；省略時採用現在時間
 * @returns {string} yyyyMMddHHmmss 格式的字串
 */
function compactTimestamp_(date) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return Utilities.formatDate(date || new Date(), timezone, 'yyyyMMddHHmmss');
}

/**
 * 把試算表本身的地區與時區設定改為與 Config 一致。
 * 這會影響儲存格中 Date 物件的顯示方式，以及試算表內建函式的日期運算。
 * @returns {{before: Object, after: Object, changed: boolean}} 改動前後的設定
 */
function applyTimezoneSettings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetTimezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const targetLocale = SPREADSHEET_LOCALE_NZ;

  const before = { timeZone: ss.getSpreadsheetTimeZone(), locale: ss.getSpreadsheetLocale() };
  if (before.timeZone !== targetTimezone) ss.setSpreadsheetTimeZone(targetTimezone);
  if (before.locale !== targetLocale) ss.setSpreadsheetLocale(targetLocale);

  const after = { timeZone: ss.getSpreadsheetTimeZone(), locale: ss.getSpreadsheetLocale() };
  return {
    before: before,
    after: after,
    changed: before.timeZone !== after.timeZone || before.locale !== after.locale
  };
}

/**
 * 為指定的時間戳欄位設定儲存格數字格式。
 *
 * 即使我們寫入的是字串，Google Sheets 仍會把「像日期」的字串自動轉成日期值，
 * 之後按儲存格的數字格式顯示。若該格原本是純日期格式，時分秒就會不見。
 * 所以每次寫入時間戳都要一併設定格式。格式字串取自 Config，不寫死。
 *
 * @param {Sheet} sheet 目標工作表
 * @param {string[]} headers 標題列
 * @param {string[]} columnNames 要設定格式的欄位名稱
 * @param {number} startRow 起始行號
 * @param {number} rowCount 行數
 * @returns {void}
 */
function applyTimestampFormat_(sheet, headers, columnNames, startRow, rowCount) {
  if (rowCount <= 0) return;
  const format = String(getConfig(CONFIG_KEYS.SYS_TIMESTAMP_FORMAT, DEFAULTS.TIMESTAMP_FORMAT));

  columnNames.forEach(function (columnName) {
    const columnIndex = headers.indexOf(columnName) + 1;
    if (columnIndex === 0) return;
    sheet.getRange(startRow, columnIndex, rowCount, 1).setNumberFormat(format);
  });
}

/**
 * 第十三輪批次階段 B【核心共用 helper】：完全還原一張工作表到「乾淨、
 * 冇任何版面殘留」嘅狀態，供任何會設定版面（合併儲存格／凍結列或欄／
 * 欄闊等）嘅寫入點喺重寫內容之前呼叫。
 *
 * ## 背景：點解需要呢個函式
 *
 * Google 試算表有兩個結構性限制（完整說明見
 * `docs/GoogleSheetsAPI限制.md`）：
 * 1. 合併儲存格唔可以跨越凍結／非凍結嘅分界線（列同欄都係）；
 * 2. **`Range.clear()`／`Sheet.clear()` 唔會解除合併、唔會歸零凍結列／欄**
 *    ——呢個唔係顯而易見嘅行為，好容易寫成「clear() 咗就等於乾淨」。
 *
 * 兩者夾埋嘅後果：重寫一張已經被寫過（甚至寫到一半失敗、留低中間狀態）
 * 嘅工作表時，上一次留低嘅合併／凍結狀態會繼續存在，同呢一次即將設定
 * 嘅新合併／凍結產生衝突——呢個係 `PublicRoster.gs` 實測撞到「You can't
 * merge frozen and non-frozen rows」呢個 bug 嘅根源。
 *
 * ## 做法
 *
 * 唔去推斷「上次可能停喺邊一步」（例如上次可能因為拋錯而冇行到
 * `setFrozenRows()`，令目前凍結狀態同預期唔一致），一律強制清到底：
 * 1. 凍結列／欄歸零——一定要行喺解除合併之前，凍結範圍仲存在嘅話，
 *    部分合併格可能解除唔到；
 * 2. 解除全部合併（`breakApart()`，對成張表嘅範圍呼叫一次就可以解晒
 *    全部獨立嘅合併群組，唔使逐個搵）；
 * 3. 清除內容／格式／備註／資料驗證／條件格式；
 * 4. 縮到只剩 1 欄 1 行——等寫入端自己用 `ensureSheetDimensions_()`
 *    決定要幾大，避免上一版面用剩嘅多餘欄／列留喺右邊／下面
 *    （實測發現：新版面 14 欄，舊版面 24 欄，重寫之後右邊 10 欄
 *    仍然殘留住上一版嘅內容）。
 *
 * @param {Sheet} sheet 要還原嘅工作表
 * @returns {void}
 */
function resetSheetToBlankSlate_(sheet) {
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);

  const maxRows = sheet.getMaxRows();
  const maxCols = sheet.getMaxColumns();
  const fullRange = sheet.getRange(1, 1, maxRows, maxCols);
  fullRange.breakApart();
  fullRange.clearDataValidations();

  sheet.clear();
  sheet.clearNotes();
  sheet.clearConditionalFormatRules();

  if (sheet.getMaxColumns() > 1) sheet.deleteColumns(2, sheet.getMaxColumns() - 1);
  if (sheet.getMaxRows() > 1) sheet.deleteRows(2, sheet.getMaxRows() - 1);
}

/**
 * 確保一張工作表至少有指定嘅列數／欄數，唔夠就新增。刻意喺寫入內容之前
 * 明確呼叫，唔依賴 `getRange()` 對超出目前工作表尺寸嘅範圍會唔會自動
 * 擴展工作表呢個唔一定喺所有情況下都清楚保證嘅行為——`resetSheetToBlankSlate_()`
 * 會將工作表縮到 1 欄 1 行，寫入端需要嘅實際尺寸一定要喺呢度先明確擴大。
 * @param {Sheet} sheet 目標工作表
 * @param {number} minRows 最少需要嘅列數
 * @param {number} minCols 最少需要嘅欄數
 * @returns {void}
 */
function ensureSheetDimensions_(sheet, minRows, minCols) {
  const currentCols = sheet.getMaxColumns();
  if (currentCols < minCols) sheet.insertColumnsAfter(currentCols, minCols - currentCols);
  const currentRows = sheet.getMaxRows();
  if (currentRows < minRows) sheet.insertRowsAfter(currentRows, minRows - currentRows);
}

/**
 * 寫入一筆 AuditLog 紀錄。時間戳一律經 nowTimestamp_() 產生。
 * AuditLog 工作表不存在時只記 Logger，不中斷呼叫端的流程。
 * @param {{action: string, targetSheet: string, targetKey: string,
 *   oldValue: (string|undefined), newValue: (string|undefined),
 *   source: (string|undefined), notes: (string|undefined)}} entry 要記錄的內容
 * @returns {void}
 */
function writeAuditLog_(entry) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUDIT_LOG);
  if (!sheet) {
    log_('WARN', '找不到 ' + SHEETS.AUDIT_LOG + ' 工作表，稽核紀錄只寫入 Logger：' + JSON.stringify(entry));
    return;
  }

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.AUDIT_LOG;
  const timestamp = nowTimestamp_();

  const record = {};
  record[C.LOG_ID] = 'LOG-' + compactTimestamp_() + '-' + Math.floor(Math.random() * 1000);
  record[C.TIMESTAMP] = timestamp;
  record[C.ACTOR] = Session.getActiveUser().getEmail();
  record[C.ACTION] = entry.action || '';
  record[C.TARGET_SHEET] = entry.targetSheet || '';
  record[C.TARGET_KEY] = entry.targetKey || '';
  record[C.OLD_VALUE] = entry.oldValue || '';
  record[C.NEW_VALUE] = entry.newValue || '';
  record[C.SOURCE] = entry.source || '';
  record[C.NOTES] = entry.notes || '';

  const row = headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  applyTimestampFormat_(sheet, headers, [C.TIMESTAMP], targetRow, 1);
}

/**
 * 把位元組數格式化為人看得懂的檔案大小。
 * @param {number} bytes 位元組數
 * @returns {string} 例如 "128 KB"、"1.35 MB"
 */
function formatFileSize_(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 統一格式的日誌輸出，寫入 Apps Script 的 Logger。
 * @param {string} level 日誌等級，例如 'INFO'、'WARN'、'ERROR'
 * @param {string} message 日誌內容
 * @returns {void}
 */
function log_(level, message) {
  Logger.log('[' + level + '] ' + message);
}
