/**
 * 第十一輪批次階段 C：ICS 日曆檔（.ics）。步驟4正式發出／步驟5重發時，
 * 隨個人 PDF 一併附上，讓義工可以直接加入 iPhone/Google 日曆。
 *
 * 架構：本檔案分兩層——
 * 1. 純函式（buildIcsCalendarText_ 及其輔助函式）：完全不呼叫任何 GAS API，
 *    只做字串／數字運算，可以直接在 Node 測試（見 tests/ics_calendar.test.js）。
 * 2. GAS 包裝層（buildIcsAttachmentForPerson_／readEarlyArrivalMinutesByPost_）：
 *    負責讀 Config／Posts、呼叫 Utilities，組出可以放進 MailApp 附件的 Blob。
 *
 * 關鍵設計决定（對應 C1-C6 需求）：
 * - UID 刻意不含 VersionNo，確保同一人同一日同一崗位跨版本 UID 相同——
 *   義工的日曆 App 收到「同 UID、新 SEQUENCE」的事件時會更新既有事件，
 *   不會重複新增一個看起來一樣的事件。
 * - SEQUENCE 直接用 versionNo：同一個 UID 只會隨版本號遞增出現（版本號本身
 *   單調遞增），完全符合 RFC 5545「SEQUENCE 遞增代表這是較新版本」的語意，
 *   不需要另外維護一個獨立的遞增計數器。
 * - DTSTART/DTEND 用 TZID=Pacific/Auckland 搭配本地時間字串（不轉 UTC），
 *   讓日曆 App 依 VTIMEZONE 定義自己換算，時間顯示對唔對唔會受伺服器時區影響。
 * - 時間位移計算刻意唔用 Utilities.formatDate／真實時區資料庫，只用單純的
 *   數字運算模擬「同一個時鐘往前撥」，令這個函式喺 Node 環境一樣行為一致、
 *   完全唔需要 mock 任何 GAS API 先至測試得到。
 */

/**
 * Pacific/Auckland 的 VTIMEZONE 定義（紐西蘭 2007 年之後的 DST 規則：
 * 9 月最後一個星期日轉夏令 NZDT (+13:00)，4 月第一個星期日轉回標準 NZST (+12:00)）。
 * 這是公開、通用的時區定義資料，不含任何本專案的私隱資訊。
 */
var ICS_VTIMEZONE_AUCKLAND_LINES = [
  'BEGIN:VTIMEZONE',
  'TZID:Pacific/Auckland',
  'BEGIN:STANDARD',
  'DTSTART:19700405T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
  'TZOFFSETFROM:+1300',
  'TZOFFSETTO:+1200',
  'TZNAME:NZST',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700928T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU',
  'TZOFFSETFROM:+1200',
  'TZOFFSETTO:+1300',
  'TZNAME:NZDT',
  'END:DAYLIGHT',
  'END:VTIMEZONE'
];

// 第十三輪批次階段 E【bug 修正】：由 hwc-roster.local 改用 .invalid——
// `.local` 係 RFC 6762 保留俾 mDNS（Bonjour／本機網絡裝置探索）用，唔係
// 「呢個網域一定唔存在」嘅慣例；`.invalid` 先係 RFC 2606 明確保留、專門
// 表達「呢個位址肯定唔會解析到任何嘢」嘅 TLD，同本專案其他測試/範例資料
// 一致（見 tests/scan_sensitive.test.js 嘅安全網域清單）。
var ICS_UID_DOMAIN = 'hwc-roster.invalid';
var ICS_LINE_FOLD_MAX_OCTETS = 75;

/**
 * 把 "yyyy-MM-dd" + "HH:mm" 組成的本地時間往前（或不）撥指定分鐘數，
 * 回傳 ICS 本地時間格式 "yyyyMMdd'T'HHmmss"（不含時區資訊，配合
 * DTSTART/DTEND 的 TZID= 參數使用）。
 *
 * 刻意用 Date.UTC() 純粹當作「一個沒有時區觀念的計算軸」（不代表真正 UTC），
 * 只用來做「減去 N 分鐘」的數字運算，避免依賴 GAS 的 Utilities.formatDate／
 * 真實時區資料庫，讓這個函式在 Node 環境可以直接測試。
 * @param {string} dateStr "yyyy-MM-dd"
 * @param {string} timeStr "HH:mm"
 * @param {number} minutesEarlier 要往前撥的分鐘數（0＝不撥）
 * @returns {string} "yyyyMMdd'T'HHmmss"
 */
function shiftIcsLocalDateTime_(dateStr, timeStr, minutesEarlier) {
  var dateParts = String(dateStr).split('-').map(Number);
  var timeParts = String(timeStr).split(':').map(Number);
  var ms = Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1])
    - (Number(minutesEarlier) || 0) * 60000;
  var dt = new Date(ms);
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return dt.getUTCFullYear() + pad2(dt.getUTCMonth() + 1) + pad2(dt.getUTCDate())
    + 'T' + pad2(dt.getUTCHours()) + pad2(dt.getUTCMinutes()) + '00';
}

/**
 * 組出一個服侍事件的穩定 UID：只由「季度＋人＋日期＋崗位＋slot」決定，
 * 刻意不含 VersionNo——同一個服侍安排跨版本重發時 UID 必須維持相同，
 * 日曆 App 才會把它當成「同一個事件的更新」而不是新事件。
 * @param {string} quarterId 季度 ID
 * @param {string} personId 人員 ID
 * @param {string} serviceDate "yyyy-MM-dd"
 * @param {string} postId 崗位 ID
 * @param {number} slotIndex slot 編號
 * @returns {string} UID
 */
function buildIcsUid_(quarterId, personId, serviceDate, postId, slotIndex) {
  return [quarterId, personId, serviceDate, postId, slotIndex].join('-') + '@' + ICS_UID_DOMAIN;
}

/**
 * 依 RFC 5545 轉義 TEXT 值：反斜線／分號／逗號要加反斜線，換行轉成字面 "\n"。
 * @param {string} text 原始文字
 * @returns {string} 轉義後文字
 */
function escapeIcsText_(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * 計算單一字元的 UTF-8 位元組數（含 surrogate pair 組成的單一 code point）。
 * @param {string} ch 單一字元（可能是 surrogate pair，由呼叫端用 Array.from 切好）
 * @returns {number} UTF-8 位元組數
 */
function utf8ByteLength_(ch) {
  var code = ch.codePointAt(0);
  if (code <= 0x7F) return 1;
  if (code <= 0x7FF) return 2;
  if (code <= 0xFFFF) return 3;
  return 4;
}

/**
 * 依 RFC 5545 的「行折疊」規則折一行內容：每個實體行（含延續行開頭那個空格）
 * 不超過 75 octets（用 UTF-8 位元組數計算，不是字元數——本專案內容含中文，
 * 一個中文字通常是 3 個 octets），超過就插入 CRLF + 一個空白字元延續。
 * @param {string} line 未折疊的單一邏輯行（不含結尾的 CRLF）
 * @returns {string} 折疊後的內容（行內可能含 CRLF，呼叫端輸出時不再另外處理）
 */
function foldIcsLine_(line) {
  var chars = Array.from(String(line));
  var result = '';
  var currentLineBytes = 0;
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    var bytes = utf8ByteLength_(ch);
    if (currentLineBytes + bytes > ICS_LINE_FOLD_MAX_OCTETS) {
      result += '\r\n ';
      currentLineBytes = 1; // 延續行開頭那個空白本身佔 1 個 octet
    }
    result += ch;
    currentLineBytes += bytes;
  }
  return result;
}

/**
 * 組出單一事件的 DESCRIPTION：本季職事表字樣、如果當日還有其他崗位就列出
 * （對應 C2「DESCRIPTION 寫該日其他資訊」），最後加一句如何申報不能服侍。
 * @param {string} quarterId 季度 ID
 * @param {string[]} otherPostNames 當日其他崗位的中文名稱
 * @returns {string} DESCRIPTION 內容（未轉義）
 */
function buildIcsDescription_(quarterId, otherPostNames) {
  var lines = [quarterId + ' 職事表'];
  if (otherPostNames.length > 0) {
    lines.push('當日其他崗位：' + otherPostNames.join('、'));
  }
  lines.push('如當日不能服侍，請盡早聯絡幹事安排調動。');
  return lines.join('\n');
}

/**
 * 純函式：組出某人整季服侍安排的完整 ICS 內容（VCALENDAR，含每個服侍安排
 * 一個 VEVENT）。不呼叫任何 GAS API，opts 的每個欄位都必須由呼叫端算好傳入。
 *
 * @param {Object} opts
 * @param {string} opts.quarterId 季度 ID
 * @param {number} opts.versionNo 版本號（用作每個 VEVENT 的 SEQUENCE）
 * @param {string} opts.personId 人員 ID
 * @param {{serviceDate: string, postId: string, slotIndex: number, postNameTC: string}[]} opts.assignments
 *   該人的派工紀錄（每筆一個 VEVENT）
 * @param {Object.<string, number>} opts.earlyMinutesByPost {PostID: 提早到場分鐘數}
 * @param {string} opts.defaultStartTime 預設崇拜開始時間 "HH:mm"
 * @param {string} opts.defaultEndTime 預設崇拜結束時間 "HH:mm"
 * @param {string} opts.dtstampUtc 本次產生時間，UTC，格式 "yyyyMMdd'T'HHmmss'Z'"
 * @returns {string} 完整 ICS 內容（CRLF 換行，結尾有 CRLF）
 */
function buildIcsCalendarText_(opts) {
  var lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//HWC Cantonese Congregation Roster//Roster Automation//TC');
  lines.push('METHOD:PUBLISH');
  lines.push('CALSCALE:GREGORIAN');
  lines = lines.concat(ICS_VTIMEZONE_AUCKLAND_LINES);

  opts.assignments.forEach(function (a) {
    var earlyMinutes = (opts.earlyMinutesByPost && opts.earlyMinutesByPost[a.postId]) || 0;
    var dtStart = shiftIcsLocalDateTime_(a.serviceDate, opts.defaultStartTime, earlyMinutes);
    var dtEnd = shiftIcsLocalDateTime_(a.serviceDate, opts.defaultEndTime, 0);
    var uid = buildIcsUid_(opts.quarterId, opts.personId, a.serviceDate, a.postId, a.slotIndex);
    var otherPosts = opts.assignments
      .filter(function (b) { return b.serviceDate === a.serviceDate && b.postId + '|' + b.slotIndex !== a.postId + '|' + a.slotIndex; })
      .map(function (b) { return b.postNameTC; });
    var description = buildIcsDescription_(opts.quarterId, otherPosts);

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('SEQUENCE:' + Math.max(0, Number(opts.versionNo) || 0));
    lines.push('DTSTAMP:' + opts.dtstampUtc);
    lines.push('DTSTART;TZID=Pacific/Auckland:' + dtStart);
    lines.push('DTEND;TZID=Pacific/Auckland:' + dtEnd);
    lines.push('SUMMARY:' + escapeIcsText_(a.postNameTC));
    lines.push('DESCRIPTION:' + escapeIcsText_(description));
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine_).join('\r\n') + '\r\n';
}

/**
 * 依 Posts 工作表建立 {PostID: 提早到場分鐘數} 對照（留空視為 0）。
 * @returns {Object.<string, number>}
 */
function readEarlyArrivalMinutesByPost_() {
  var map = {};
  readPostsNormalized().forEach(function (p) {
    map[p.postId] = p.earlyArrivalMinutes || 0;
  });
  return map;
}

/**
 * 依 Config 的 ICS_ATTACHMENT_NAME_PATTERN 風格（沿用個人 PDF 的命名習慣）
 * 組出 .ics 附件檔名。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} personName 對象姓名
 * @returns {string} 檔名（以 .ics 結尾）
 */
function buildIcsFileName_(quarterId, versionNo, personName) {
  return quarterId + '_v' + versionNo + '_服侍日曆_' + (personName || '') + '.ics';
}

/**
 * GAS 包裝層：只在 OFFICIAL／RESEND 兩個階段、收件人是 PERSON、且本季有派工
 * 時才產生 ICS 附件（對應 C4／C5），其餘情況一律回傳 null（不視為錯誤）。
 * @param {Object} context 寄信 context（見 Mailer.gs 的 buildMailContext_()）
 * @param {Object} recipient 收件人資料
 * @param {Object[]} personAssignments 該收件人的派工紀錄（deliverOne_ 已算好）
 * @returns {?{blob: Blob, fileName: string, sizeBytes: number, retries: number}}
 */
function buildIcsAttachmentForPerson_(context, recipient, personAssignments) {
  if (recipient.type !== RECIPIENT_TYPE.PERSON) return null;
  if (context.stage !== MAIL_STAGES.OFFICIAL && context.stage !== MAIL_STAGES.RESEND) return null;
  if (!personAssignments || personAssignments.length === 0) return null;

  var defaultStart = String(getConfig(CONFIG_KEYS.ICS_SERVICE_START_TIME, DEFAULTS.ICS_SERVICE_START_TIME));
  var defaultEnd = String(getConfig(CONFIG_KEYS.ICS_SERVICE_END_TIME, DEFAULTS.ICS_SERVICE_END_TIME));

  var icsText = buildIcsCalendarText_({
    quarterId: context.quarterId,
    versionNo: context.versionNo,
    personId: recipient.personId,
    assignments: personAssignments.map(function (a) {
      return {
        serviceDate: a.serviceDate,
        postId: a.postId,
        slotIndex: a.slotIndex,
        postNameTC: context.postNames[a.postId] || a.postId
      };
    }),
    earlyMinutesByPost: readEarlyArrivalMinutesByPost_(),
    defaultStartTime: defaultStart,
    defaultEndTime: defaultEnd,
    dtstampUtc: Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'")
  });

  var fileName = buildIcsFileName_(context.quarterId, context.versionNo, recipient.displayName);
  var blob = Utilities.newBlob(icsText, 'text/calendar', fileName);
  return { blob: blob, fileName: fileName, sizeBytes: blob.getBytes().length, retries: 0 };
}
