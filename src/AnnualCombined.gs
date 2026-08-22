/**
 * 第十六輪批次階段 D：**每年固定四次合堂**（教會新規則 5）。
 *
 * 教會每年有四次固定合堂：
 *   1. 復活節主日（浸禮）——日期每年浮動，但**可以算得出**
 *   2. 5 月 22 日前後的主日——**要出表時先向教會確認**，算唔出
 *   3. 8 月最後一個主日（宣教月合堂）——算得出
 *   4. 10 月第一個主日（浸禮）——算得出
 *
 * 呢個檔案做兩件事：
 * - **D1**：輸入年份，一次過算出四行 `SpecialSundays` 建議，畀幹事喺對話框
 *   確認之後先寫入（唔會自動寫）。
 * - **D2／D3**：五月嗰次「未確認」呢件事唔可以靠人記——`SpecialSundays`
 *   新增咗 `Confirmed` 欄，未確認嘅列會被**現有嘅提醒機制**（`Trigger.gs`
 *   嘅 `judgeRemindAction_()`，新增第三個維度）同**生成完成畫面**主動揪出嚟。
 *
 * ---
 * ## D4：三種合堂類型使唔使喺 SpecialSundays 分開處理？——**唔使**
 *
 * 歷史上三種合堂嘅分別係：
 * - 浸禮：翻譯需求較高
 * - 堂慶：通常由英語堂帶領詩、司琴
 * - 宣教月：講員多數係宣教士
 *
 * 逐項核對過之後，**三種分別全部落喺系統本來就唔會自動排嘅崗位上**，
 * 所以唔需要新增任何機制：
 * - 「翻譯需求較高」——翻譯崗位係 `AutoGenerate=FALSE`，系統從來唔會
 *   自動派，一律由幹事用「填寫講員／翻譯／獻花」人手填。系統就算知道
 *   「今次浸禮要多啲翻譯」都做唔到嘢，因為佢本來就唔負責排呢一格。
 * - 「英語堂帶領詩司琴」——已經完全表達得到：`SkipPostIDs` 填領詩同司琴
 *   嘅 PostID、`ExternalOwner` 填「英語堂」，職事表就會喺嗰兩格顯示
 *   「英語堂」。呢個正正就係 2026-10-04 實測過嘅做法。
 * - 「講員多為宣教士」——講員同樣係 `AutoGenerate=FALSE`，人手填。
 *
 * 結論：`Type`（自由文字）＋ `Title` ＋ `SkipPostIDs` ＋ `ExternalOwner`
 * 四個既有欄位已經足夠表達三者嘅分別，而且係用**資料**表達，唔係喺程式碼
 * 寫死三種類型嘅特殊邏輯（後者一旦教會改做法就要改程式）。本工具嘅做法係
 * 幫每一次合堂**預先填好合理嘅 Type／Title 建議值**，令呢個分別以資料形式
 * 保留落嚟，幹事確認時可以自行修改。
 */

/** 年度合堂建議入面，每一次合堂嘅識別碼（唔係 SpecialID，只係本工具內部用）。 */
const ANNUAL_COMBINED_KINDS = {
  EASTER: 'EASTER',
  MAY: 'MAY',
  MISSION: 'MISSION',
  OCTOBER: 'OCTOBER'
};

/**
 * 計算指定年份嘅**復活節主日**（西方教會／格里曆），回傳 `yyyy-MM-dd`。
 *
 * 用 Anonymous Gregorian algorithm（又叫 Meeus/Jones/Butcher 演算法）——
 * 呢個係計格里曆復活節嘅標準演算法，對 1583 年之後嘅任何年份都準確，
 * **冇任何寫死嘅日期表**（任務明確要求）。
 *
 * 復活節嘅定義：春分（教會定為 3 月 21 日）之後第一個滿月之後嘅第一個主日。
 * 演算法用「黃金數」同「世紀修正」算出教會定義嘅滿月日期再推到主日，
 * 唔係用真實天文觀測，所以完全可以離線計算、每次結果一樣。
 *
 * 驗證用嘅已知答案（測試檔有逐年斷言）：
 *   2024-03-31、2025-04-20、2026-04-05、2027-03-28、2028-04-16
 *
 * @param {number} year 西曆年份（四位數）
 * @returns {string} 復活節主日，格式 yyyy-MM-dd
 */
function computeEasterSunday_(year) {
  const y = Number(year);
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);   // 3＝三月　4＝四月
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatYmd_(y, month, day);
}

/**
 * 把年／月／日組成 `yyyy-MM-dd` 字串（月日補零）。
 * 唔用 `Utilities.formatDate()`——嗰個要 Date 物件同時區，呢度純粹係
 * 三個數字砌字串，冇必要引入時區問題（同 `daysBetween_()` 一樣嘅考慮）。
 * @param {number} year 年
 * @param {number} month 月（1-12）
 * @param {number} day 日
 * @returns {string} yyyy-MM-dd
 */
function formatYmd_(year, month, day) {
  const mm = month < 10 ? '0' + month : String(month);
  const dd = day < 10 ? '0' + day : String(day);
  return year + '-' + mm + '-' + dd;
}

/**
 * 求指定年月嘅**第 n 個星期日**。
 * @param {number} year 年
 * @param {number} month 月（1-12）
 * @param {number} n 第幾個（1＝第一個）
 * @returns {string} yyyy-MM-dd
 */
function nthSundayOfMonth_(year, month, n) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0＝星期日
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return formatYmd_(year, month, firstSunday + (n - 1) * 7);
}

/**
 * 求指定年月嘅**最後一個星期日**。
 * @param {number} year 年
 * @param {number} month 月（1-12）
 * @returns {string} yyyy-MM-dd
 */
function lastSundayOfMonth_(year, month) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
  return formatYmd_(year, month, daysInMonth - lastDow);
}

/**
 * 求**最接近**指定日期嘅星期日。同分（前後都係 3 日）時取**之後**嗰個
 * ——「5 月 22 日前後」嘅講法冇偏向，取之後嗰個係因為合堂通常會就住
 * 已排好嘅活動順延，而且揀一個固定規則好過每次唔同。
 *
 * ⚠️ 呢個只係**建議日期**，五月嗰次一定要向教會確認，所以產生出嚟嘅列
 * 一律標 `Confirmed=FALSE`。
 *
 * @param {number} year 年
 * @param {number} month 月（1-12）
 * @param {number} day 日
 * @returns {string} yyyy-MM-dd
 */
function nearestSundayTo_(year, month, day) {
  const target = formatYmd_(year, month, day);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (dow === 0) return target;
  const daysBack = dow;          // 退返上一個星期日
  const daysForward = 7 - dow;   // 去到下一個星期日
  return shiftDateString_(target, daysForward <= daysBack ? daysForward : -daysBack);
}

/**
 * D1：算出指定年份嘅四次合堂建議。**純函式，只計算，唔讀唔寫任何工作表。**
 *
 * 每一項嘅 `confirmed` 欄反映「日期本身係咪已經確定」：三次算得出嘅係
 * `true`，五月嗰次係 `false`（要向教會問）。`Type`／`Title`／`notes`
 * 係預填嘅建議文字，幹事喺確認畫面之後仍然可以自行喺工作表修改。
 *
 * `skipPostIds` 一律**留空**——邊個崗位要跳過（例如堂慶由英語堂帶領詩
 * 司琴）係教會逐次決定嘅事，唔應該由工具擅自填，填錯咗反而會令幹事以為
 * 系統已經處理好。畫面同備註會提醒幹事自己填。
 *
 * @param {number} year 西曆年份
 * @returns {Object[]} 四項建議，每項 {kind, serviceDate, type, title, confirmed, notes}
 */
function planAnnualCombinedSundays_(year) {
  const y = Number(year);
  return [
    {
      kind: ANNUAL_COMBINED_KINDS.EASTER,
      serviceDate: computeEasterSunday_(y),
      type: '合堂',
      title: '復活節主日（浸禮）',
      confirmed: true,
      notes: '日期由復活節演算法自動算出，不需要人手確認。'
        + '浸禮通常翻譯需求較高，翻譯本來就是人手填寫的崗位，記得預留人手。'
    },
    {
      kind: ANNUAL_COMBINED_KINDS.MAY,
      serviceDate: nearestSundayTo_(y, 5, 22),
      type: '合堂',
      title: '五月合堂（日期待確認）',
      confirmed: false,
      notes: '⚠️ 這是「5 月 22 日前後」推算出來的「建議日期」，'
        + '實際日期每年不同，必須向教會確認之後，把日期改成正確的那一天、'
        + '再把 ' + COLUMNS.SPECIAL_SUNDAYS.CONFIRMED + ' 改成 TRUE。'
        + '未確認之前，系統會在生成初稿前一星期主動提醒你。'
    },
    {
      kind: ANNUAL_COMBINED_KINDS.MISSION,
      serviceDate: lastSundayOfMonth_(y, 8),
      type: '合堂',
      title: '宣教月合堂',
      confirmed: true,
      notes: '八月最後一個主日，日期自動算出。'
        + '講員多數是宣教士，講員本來就是人手填寫的崗位。'
    },
    {
      kind: ANNUAL_COMBINED_KINDS.OCTOBER,
      serviceDate: nthSundayOfMonth_(y, 10, 1),
      type: '合堂',
      title: '十月主日（浸禮）',
      confirmed: true,
      notes: '十月第一個主日，日期自動算出。'
    }
  ];
}

/**
 * 判斷一列 `SpecialSundays` 係咪**未確認日期**。
 *
 * ⚠️ **空白＝已確認**（見 `COLUMNS.SPECIAL_SUNDAYS.CONFIRMED` 上面嘅說明）。
 * 呢個方向好易搞錯，所以全系統只准由呢一個函式判斷，唔好喺其他地方
 * 另外寫 `isTrueValue_()`——`isTrueValue_('')` 係 `false`，直接用就會令
 * 全部既有列變成「未確認」，提醒機制即刻噴一堆假警報。
 *
 * @param {Object} row `SpecialSundays` 的一列（readSheet 的物件格式）
 * @returns {boolean} 是否未確認
 */
function isUnconfirmedSpecialSunday_(row) {
  const raw = row[COLUMNS.SPECIAL_SUNDAYS.CONFIRMED];
  if (raw === '' || raw === null || raw === undefined) return false; // 空白＝已確認
  return !isTrueValue_(raw);
}

/**
 * D2／D3：列出指定季度有邊啲**未確認日期**嘅特殊主日。
 * 只讀取，唔寫任何嘢。`SpecialSundays` 工作表未建立時回傳空陣列。
 *
 * 只計 `Active=TRUE` 嘅列——`Active=FALSE` 代表幹事已經決定唔用呢一列
 * （例如今年冇堂慶），冇必要再提醒佢去確認一個唔會用嘅日期。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 每項 {specialId, serviceDate, type, title}
 */
function listUnconfirmedSpecialSundays_(quarterId, timezone) {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  return readOptionalSheet_(SHEETS.SPECIAL_SUNDAYS)
    .filter(function (row) { return row[C.QUARTER_ID] === quarterId; })
    .filter(function (row) { return isTrueValue_(row[C.ACTIVE]); })
    .filter(isUnconfirmedSpecialSunday_)
    .map(function (row) {
      return {
        specialId: row[C.SPECIAL_ID],
        serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
        type: row[C.TYPE],
        title: row[C.TITLE]
      };
    });
}

/**
 * 把未確認清單組成一段畀人睇嘅文字，生成完成畫面（D3）與提醒信共用。
 * 冇未確認項目時回傳空字串，呼叫端可以直接用 `if (text)` 判斷要唔要顯示。
 * @param {Object[]} unconfirmed `listUnconfirmedSpecialSundays_()` 的結果
 * @returns {string} 可讀文字；沒有未確認項目時為空字串
 */
function describeUnconfirmedSpecialSundays_(unconfirmed) {
  if (!unconfirmed || unconfirmed.length === 0) return '';
  const lines = ['⚠️ 這一季有 ' + unconfirmed.length + ' 個特殊主日的日期「尚未確認」：'];
  unconfirmed.forEach(function (u) {
    lines.push('　' + u.serviceDate + '　' + (u.title || u.type || '（沒有標題）'));
  });
  lines.push('請向教會確認實際日期，在 ' + SHEETS.SPECIAL_SUNDAYS
    + ' 工作表修正日期之後，把 ' + COLUMNS.SPECIAL_SUNDAYS.CONFIRMED + ' 欄改成 TRUE。');
  lines.push('（日期不對的話，被跳過的崗位會落在錯誤的一週，'
    + '而且要重新生成才會修正，所以請在正式發出之前處理好。）');
  return lines.join('\n');
}

/**
 * 為指定年份嘅建議日期找出對應嘅 `QuarterID`——寫入 `SpecialSundays`
 * 需要 `QuarterID`，而佢係由 `Quarters` 嘅 `StartDate`／`EndDate` 決定。
 * 搵唔到就回傳空字串，呼叫端負責顯示「呢個季度仲未建立」嘅提示。
 * @param {string} dateStr 日期（yyyy-MM-dd）
 * @param {string} timezone 時區名稱
 * @returns {string} QuarterID；找不到時為空字串
 */
function findQuarterIdForDate_(dateStr, timezone) {
  const C = COLUMNS.QUARTERS;
  const rows = readSheet(SHEETS.QUARTERS);
  for (let i = 0; i < rows.length; i++) {
    const start = toDateString(rows[i][C.START_DATE], timezone);
    const end = toDateString(rows[i][C.END_DATE], timezone);
    if (!start || !end) continue;
    if (dateStr >= start && dateStr <= end) return String(rows[i][C.QUARTER_ID] || '');
  }
  return '';
}

/**
 * 把 D1 嘅建議加上「呢個日期屬於邊個季度」同「`SpecialSundays` 係咪已經
 * 有同一日嘅列」兩項資訊，供確認畫面顯示。只讀取，唔寫入。
 * @param {number} year 西曆年份
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 建議陣列，每項多咗 quarterId／alreadyExists 兩個欄位
 */
function planAnnualCombinedWithContext_(year, timezone) {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  const existing = {};
  readOptionalSheet_(SHEETS.SPECIAL_SUNDAYS).forEach(function (row) {
    const d = toDateString(row[C.SERVICE_DATE], timezone);
    if (d) existing[d] = true;
  });

  return planAnnualCombinedSundays_(year).map(function (item) {
    return Object.assign({}, item, {
      quarterId: findQuarterIdForDate_(item.serviceDate, timezone),
      alreadyExists: !!existing[item.serviceDate]
    });
  });
}

/**
 * 把確認過嘅建議寫入 `SpecialSundays`。
 *
 * ⚠️ **本輪唔可以寫入試算表，呢個函式本輪冇執行過**，只實作好俾之後用。
 *
 * 安全設計：
 * - **只 append，永遠唔覆寫**——同一日已經有列（`alreadyExists`）嘅一律
 *   略過，唔會蓋走幹事已經填好嘅 `SkipPostIDs`／`ExternalOwner`。
 * - 搵唔到 `QuarterID` 嘅（該季度仲未喺 `Quarters` 建立）同樣略過，
 *   因為冇 `QuarterID` 嘅列全系統都讀唔到，寫咗等於垃圾列。
 * - `SkipPostIDs` 一律留空，由幹事自己填（見 `planAnnualCombinedSundays_()`）。
 *
 * @param {Object[]} plan `planAnnualCombinedWithContext_()` 的結果
 * @returns {{written: number, skipped: Object[]}} 寫入列數與被略過的項目
 */
function writeAnnualCombinedSundays_(plan) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) {
    throw new Error('找不到工作表: ' + SHEETS.SPECIAL_SUNDAYS
      + '。請先執行「維護 ▸ 補建 SpecialSundays 工作表」。');
  }

  const C = COLUMNS.SPECIAL_SUNDAYS;
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colOf = function (key) { return headers.indexOf(key) + 1; };

  const dateCol = colOf(C.SERVICE_DATE);
  const quarterCol = colOf(C.QUARTER_ID);
  if (dateCol === 0 || quarterCol === 0) {
    throw new Error(SHEETS.SPECIAL_SUNDAYS + ' 缺少 ' + C.SERVICE_DATE
      + ' 或 ' + C.QUARTER_ID + ' 欄，無法寫入。');
  }

  const skipped = [];
  let written = 0;
  let nextRow = sheet.getLastRow() + 1;
  if (nextRow < 3) nextRow = 3;

  plan.forEach(function (item) {
    if (item.alreadyExists) {
      skipped.push({ item: item, reason: SHEETS.SPECIAL_SUNDAYS + ' 已經有同一日的列，不覆寫' });
      return;
    }
    if (!item.quarterId) {
      skipped.push({ item: item, reason: '找不到對應的季度（' + SHEETS.QUARTERS + ' 還沒有涵蓋這一天的季度）' });
      return;
    }

    // ⚠️ 第四十七輪批次 C3 組：**欄唔存在 ⇒ 大聲失敗，唔可以靜靜略過。**
    //
    // 本來係 `if (col > 0) …`，即係欄唔存在就靜靜唔寫。而 `SpecialSundays`
    // 由第一日就冇 `Confirmed` 欄（見 `SpecialSundaysSeed.gs` 檔內說明），
    // 所以呢個工具「把五月嗰行標成未確認」呢件事**由頭到尾冇發生過**——
    // 而工具嘅報告一直話做咗。
    //
    // 呢一改本身會令「未跑過補欄工具」嘅試算表喺跑年度合堂工具時失敗。
    // **嗰個係想要嘅行為**——比靜靜寫唔到好。所以錯誤訊息一定要
    // 講得出係邊一欄、同埋去邊度補。
    const setCell = function (key, value) {
      const col = colOf(key);
      if (col <= 0) {
        throw new Error(buildThreePartMessage_(
          '「' + SHEETS.SPECIAL_SUNDAYS + '」這一張工作表沒有「' + key + '」這一欄，'
            + '所以這一次要寫進去的內容寫不了。',
          '什麼都沒有寫入——這一次的年度合堂建議整批停下來了。',
          ['去選單「維護 ▸ ⚠️ 補建 SpecialSundays 缺欄」補上這一欄',
            '補完之後再撳一次這個工具',
            '⚠️ 那一支工具只會在最後加欄，不會重排、不會改動任何既有資料']));
      }
      sheet.getRange(nextRow, col).setValue(value);
    };
    setCell(C.SPECIAL_ID, item.quarterId + '-' + item.kind);
    setCell(C.QUARTER_ID, item.quarterId);
    setCell(C.SERVICE_DATE, item.serviceDate);
    setCell(C.TYPE, item.type);
    setCell(C.TITLE, item.title);
    setCell(C.ACTIVE, 'TRUE');
    // 第四十七輪批次 D4 組：**新寫入嗰幾行帶住預設跳過崗位。**
    //
    // 之前呢一格一律留空，而確認畫面仲明文寫住「需要你自己填」。
    // 即係把一件每次都一樣嘅嘢（合堂嗰五個崗位由另一堂帶領）
    // 交咗畀幹事逐次記得人手做。
    //
    // ⚠️ 只修呢一邊唔夠：既有嗰幾季仲係空白。
    // 「維護 ▸ 補填合堂跳過崗位」補嘅就係嗰邊。
    setCell(C.SKIP_POST_IDS, readCombinedDefaultSkipPostIds_());
    setCell(C.CONFIRMED, item.confirmed ? 'TRUE' : 'FALSE');
    setCell(C.NOTES, item.notes);

    nextRow++;
    written++;
  });

  return { written: written, skipped: skipped };
}

/**
 * 選單項目「準備工作 ▸ ⚠️ 產生年度合堂建議」的執行入口。
 * 先算、再喺對話框列出四項建議（含所屬季度、會唔會被略過），
 * 幹事確認之後先至寫入。
 * @returns {void}
 */
function runAnnualCombinedWizard_() {
  const ui = SpreadsheetApp.getUi();
  const title = '產生年度合堂建議';

  const response = ui.prompt(title,
    '請輸入年份（例如 2027）：\n\n'
      + '會算出這一年的四次固定合堂：\n'
      + '　1. 復活節主日（浸禮）——自動算出\n'
      + '　2. 五月合堂（5 月 22 日前後）——只能給建議日期，要你向教會確認\n'
      + '　3. 八月最後一個主日（宣教月合堂）——自動算出\n'
      + '　4. 十月第一個主日（浸禮）——自動算出',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const year = parseInt(normalizeIdInput_(response.getResponseText()), 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    ui.alert(title, '年份必須是 2000-2100 之間的數字，已取消。', ui.ButtonSet.OK);
    return;
  }

  let plan;
  try {
    const config = readConfig();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    plan = planAnnualCombinedWithContext_(year, timezone);
  } catch (err) {
    log_('ERROR', 'planAnnualCombinedWithContext_ 失敗: ' + err.message);
    ui.alert(title, '計算失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = [year + ' 年的四次固定合堂：', ''];
  plan.forEach(function (item, i) {
    lines.push((i + 1) + '. ' + item.serviceDate + '　' + item.title);
    lines.push('　　季度：' + (item.quarterId || '⚠ 找不到對應季度，這一項會被略過'));
    lines.push('　　日期確認狀態：' + (item.confirmed ? '已確定' : '⚠ 建議日期，需要你向教會確認'));
    if (item.alreadyExists) lines.push('　　⚠ 已經有同一日的列，這一項會被略過（不會覆寫你已填的內容）');
    lines.push('');
  });

  const writable = plan.filter(function (i) { return !i.alreadyExists && i.quarterId; });
  if (writable.length === 0) {
    ui.alert(title, lines.join('\n') + '\n沒有任何一項可以寫入，不需要執行。', ui.ButtonSet.OK);
    return;
  }

  lines.push('將新增 ' + writable.length + ' 行到 ' + SHEETS.SPECIAL_SUNDAYS + '。');
  lines.push('');
  const defaultSkip = readCombinedDefaultSkipPostIds_();
  lines.push('跳過崗位（SkipPostIDs）會先填上：');
  lines.push('　' + (defaultSkip || '（Config 那一格是空白，所以留空）'));
  lines.push('　 合堂那一天，這幾個崗位由另一堂帶領，所以不由本堂排。');
  lines.push('　 要改就去 Config「' + CONFIG_KEYS.COMBINED_DEFAULT_SKIP_POST_IDS + '」。');
  lines.push('');
  lines.push('⚠️ 外部負責單位（ExternalOwner）仍然一律留空，');
  lines.push('　 需要你自己按每一次合堂的實際安排填寫（例如堂慶由英語堂帶領詩、司琴，');
  lines.push('　 就在那一行加上那兩個崗位的 PostID 與「英語堂」）。');
  lines.push('');
  lines.push('確定要寫入嗎？');

  if (ui.alert(title + '（確認）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const result = writeAnnualCombinedSundays_(plan);
    writeAuditLog_({
      action: '產生年度合堂建議',
      targetSheet: SHEETS.SPECIAL_SUNDAYS,
      targetKey: String(year),
      newValue: result.written + ' 行',
      source: 'runAnnualCombinedWizard_',
      notes: plan.map(function (i) { return i.serviceDate + ' ' + i.title; }).join('；')
    });

    const done = ['已新增 ' + result.written + ' 行到 ' + SHEETS.SPECIAL_SUNDAYS + '。'];
    if (result.skipped.length > 0) {
      done.push('', '略過 ' + result.skipped.length + ' 項：');
      result.skipped.forEach(function (s) {
        done.push('　' + s.item.serviceDate + '　' + s.item.title + '　→　' + s.reason);
      });
    }
    const needsConfirm = plan.filter(function (i) { return !i.confirmed && !i.alreadyExists && i.quarterId; });
    if (needsConfirm.length > 0) {
      done.push('', '⚠️ 其中 ' + needsConfirm.length + ' 項的日期只是建議值，需要你向教會確認：');
      needsConfirm.forEach(function (i) { done.push('　' + i.serviceDate + '　' + i.title); });
      done.push('確認之後請在工作表修正日期，並把 ' + COLUMNS.SPECIAL_SUNDAYS.CONFIRMED + ' 改成 TRUE。');
      done.push('（在你確認之前，系統會在生成初稿前一星期自動提醒你。）');
    }
    ui.alert(title, done.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runAnnualCombinedWizard_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
