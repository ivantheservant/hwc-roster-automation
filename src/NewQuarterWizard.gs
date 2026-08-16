/**
 * 階段 E 新增：「準備工作 ▸ ⚠️ 新增季度」——輸入年份＋季別，自動算出整季的
 * 主日日期清單與 GenerateOn／OfficialSendOn，寫入 Quarters 與 ServiceDates。
 *
 * 追加階段 AY 決策 AY-1（記在 HANDOFF.md「待 Ivan 覆核的決策」）：全專案原本
 * 沒有任何地方定義「T1～T4 對應哪幾個月」——StartDate／EndDate 一直都是人手
 * 逐季輸入。這裡採用最常見的日曆季度慣例（T1=1-3月、T2=4-6月、T3=7-9月、
 * T4=10-12月），因為找不到任何程式碼或既有資料可以查證教會實際用的是不是
 * 這一套（教會有可能用學期制或財政年度等其他劃分）。為免猜錯導致整季日期
 * 全部錯開，流程中間加了一個可選的「自訂開始日」輸入——留空就用日曆季度算出
 * 的日期，填了就以填的為準（EndDate 一律再從自訂開始日往後推 3 個月減 1 日，
 * 維持「一季＝三個月」的長度）。確認畫面一定會完整列出算出的開始／結束日，
 * 讓你在真正寫入前有機會發現不對勁並取消。
 */

/**
 * T1～T4 對應的起始月份（1-based），見上方檔頭的決策 AY-1。
 *
 * 第十七輪批次階段 C：呢個常數而家只係**預設值**——實際生效值由
 * `readQuarterTermStartMonths_()` 由 Config 嘅 `QUARTER_TERM_START_MONTHS`
 * 讀返嚟（缺少／格式唔啱時退回呢度）。留返呢個常數係為咗兩件事：
 * 讀唔到 Config 時嘅安全網，以及畀純函式測試唔使砌 Config 都跑得到。
 */
const QUARTER_TERM_START_MONTH = { 1: 1, 2: 4, 3: 7, 4: 10 };

/**
 * 由 Config 讀出 T1～T4 嘅起始月份。格式係逗號分隔嘅四個月份數字
 * （預設 `1,4,7,10`）。任何一項唔係 1-12 之間嘅整數，或者唔夠四項，
 * 一律**整組**退回 `QUARTER_TERM_START_MONTH` 並記一句 WARN——
 * 半套設定（例如只有三項啱）比完全用預設值更危險，會令某一季嘅日期
 * 靜靜噉錯開。
 *
 * 呢個 Key 喺 ConfigSeed 登記為 `LIST` 型，所以 `readConfig()` 會回傳
 * **陣列**（`['1','4','7','10']`）而唔係字串。`String(陣列)` 啱啱好就係
 * 逗號分隔嘅字串，所以下面 `String(...)` 之後再 `splitList_()` 兩種形態
 * 都處理得到——`getConfig()` 退回 `DEFAULTS`（字串）嗰陣亦都一樣。
 * @returns {Object.<number, number>} {1: 起始月, 2: …, 3: …, 4: …}
 */
function readQuarterTermStartMonths_() {
  const raw = String(getConfig(CONFIG_KEYS.QUARTER_TERM_START_MONTHS,
    DEFAULTS.QUARTER_TERM_START_MONTHS) || '').trim();
  const parts = splitList_(raw).map(function (s) { return Number(s); });

  const valid = parts.length === 4 && parts.every(function (m) {
    return !isNaN(m) && Number.isInteger(m) && m >= 1 && m <= 12;
  });
  if (!valid) {
    if (raw !== '') {
      log_('WARN', 'Config 的 ' + CONFIG_KEYS.QUARTER_TERM_START_MONTHS
        + ' 格式不正確（收到「' + raw + '」，需要是四個 1-12 的月份，逗號分隔），'
        + '已改用預設值 ' + DEFAULTS.QUARTER_TERM_START_MONTHS);
    }
    return QUARTER_TERM_START_MONTH;
  }
  return { 1: parts[0], 2: parts[1], 3: parts[2], 4: parts[3] };
}

/**
 * 依年份與季別算出日曆季度的開始日／結束日（yyyy-MM-dd）。
 * @param {number} year 年份
 * @param {number} term 季別（1-4）
 * @param {Object.<number, number>=} startMonths 各季起始月份；省略時用
 *   `QUARTER_TERM_START_MONTH`（呼叫端想用 Config 設定就自己傳
 *   `readQuarterTermStartMonths_()` 嘅結果進嚟——噉樣呢個函式維持純函式，
 *   測試唔使砌 Config）
 * @returns {{startDate: string, endDate: string}}
 */
function computeCalendarQuarterRange_(year, term, startMonths) {
  const months = startMonths || QUARTER_TERM_START_MONTH;
  const pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  const startMonth = months[term];
  const startDate = year + '-' + pad2(startMonth) + '-01';
  const nextTerm = term === 4 ? 1 : term + 1;
  const nextYear = term === 4 ? year + 1 : year;
  const nextStartDate = nextYear + '-' + pad2(months[nextTerm]) + '-01';
  return { startDate: startDate, endDate: shiftDateString_(nextStartDate, -1) };
}

/**
 * 列出 [startDate, endDate] 範圍內（含首尾）所有星期日，yyyy-MM-dd 陣列，由早到晚排序。
 * @param {string} startDate 開始日
 * @param {string} endDate 結束日
 * @returns {string[]}
 */
function listSundaysInRange_(startDate, endDate) {
  let cursor = startDate;
  while (!isSundayDate_(cursor) && cursor <= endDate) cursor = shiftDateString_(cursor, 1);
  const sundays = [];
  while (cursor <= endDate) {
    sundays.push(cursor);
    cursor = shiftDateString_(cursor, 7);
  }
  return sundays;
}

/**
 * 上線前規劃：驗證輸入、算出整季的主日清單與各個日期欄位，純讀取，不寫入任何東西。
 * @param {number} year 年份
 * @param {number} term 季別（1-4）
 * @param {string} customStartDate 自訂開始日（yyyy-MM-dd）；空字串代表使用日曆季度算出的預設值
 * @returns {Object} 供確認畫面與 `executeNewQuarterWizard_()` 使用的規劃結果
 */
function planNewQuarterWizard_(year, term, customStartDate) {
  const quarterId = year + 'T' + term;
  if (findQuarterRowInfo_(quarterId)) {
    throw new Error('Quarters 已經有 ' + quarterId + ' 這一季，為免覆寫既有資料，本工具拒絕執行。'
      + '如果要重新計算日期，請用「準備工作 ▸ ⚠️ 計算季度日期」；如果要清掉重來，'
      + '請自行到 Quarters／ServiceDates 工作表人手刪除對應的列（本工具不會幫你刪）。');
  }
  if (readServiceDates(quarterId).length > 0) {
    throw new Error('ServiceDates 已經有 ' + quarterId + ' 的主日紀錄（雖然 Quarters 沒有這一季），'
      + '為免資料衝突，本工具拒絕執行，請自行檢查 ServiceDates 工作表。');
  }

  const calendarRange = computeCalendarQuarterRange_(year, term, readQuarterTermStartMonths_());
  let startDate = calendarRange.startDate;
  let endDate = calendarRange.endDate;
  let usedCustomStart = false;
  if (customStartDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStartDate)) {
      throw new Error('自訂開始日「' + customStartDate + '」格式不對，請用 yyyy-MM-dd（例如 2027-01-04）。');
    }
    startDate = customStartDate;
    endDate = shiftDateString_(shiftDateStringByMonths_(startDate, 3), -1);
    usedCustomStart = true;
  }

  const sundays = listSundaysInRange_(startDate, endDate);
  if (sundays.length === 0) {
    throw new Error('算出的日期範圍（' + startDate + ' 至 ' + endDate + '）內一個星期日都沒有，'
      + '請檢查年份／季別／自訂開始日是否輸入正確。');
  }

  const config = readConfig();
  const guardMode = String(config[CONFIG_KEYS.SEND_WEEKDAY_GUARD] || 'NONE').toUpperCase();
  const leadGenerate = Number(config[CONFIG_KEYS.LEAD_DAYS_GENERATE]);
  const leadOfficial = Number(config[CONFIG_KEYS.LEAD_DAYS_OFFICIAL]);
  const generateOn = isNaN(leadGenerate) ? '' : applyWeekdayGuard_(shiftDateString_(startDate, leadGenerate), guardMode);
  const officialSendOn = isNaN(leadOfficial) ? '' : applyWeekdayGuard_(shiftDateString_(startDate, leadOfficial), guardMode);

  let lastMonth = '';
  const serviceDates = sundays.map(function (date, i) {
    const monthKey = date.slice(0, 7);
    const isFirstSundayOfMonth = monthKey !== lastMonth;
    lastMonth = monthKey;
    return {
      serviceDateId: quarterId + '-W' + (i + 1 < 10 ? '0' + (i + 1) : String(i + 1)),
      serviceDate: date,
      weekIndex: i + 1,
      isFirstSundayOfMonth: isFirstSundayOfMonth
    };
  });

  return {
    quarterId: quarterId, year: year, term: term,
    startDate: startDate, endDate: endDate, usedCustomStart: usedCustomStart,
    weekCount: sundays.length, serviceDates: serviceDates,
    generateOn: generateOn, officialSendOn: officialSendOn,
    leadDaysConfigured: !isNaN(leadGenerate) && !isNaN(leadOfficial)
  };
}

/**
 * 把 yyyy-MM-dd 日期字串加上／減去指定的月數，回傳新的 yyyy-MM-dd 字串。
 * 用 UTC 運算，只用於「往後推 N 個月」這種粗粒度的季度長度計算，不是給
 * 精細的日曆運算用（那些一律用 shiftDateString_() 的天數版本）。
 * @param {string} dateStr 起始日期
 * @param {number} months 要平移的月數，可為負數
 * @returns {string}
 */
function shiftDateStringByMonths_(dateStr, months) {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = dateStr.slice(8, 10);
  const totalMonths = (year * 12 + (month - 1)) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  return newYear + '-' + pad2(newMonth) + '-' + day;
}

/**
 * 依 `planNewQuarterWizard_()` 的結果，實際寫入 Quarters 與 ServiceDates。
 * 只有這個函式會真正寫入工作表；規劃階段（`planNewQuarterWizard_()`）純讀取。
 * @param {Object} plan `planNewQuarterWizard_()` 的結果
 * @returns {{quarterRowWritten: boolean, serviceDateRowsWritten: number}}
 */
function executeNewQuarterWizard_(plan) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const quartersSheet = ss.getSheetByName(SHEETS.QUARTERS);
  if (!quartersSheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);
  const quartersHeaders = quartersSheet.getRange(2, 1, 1, quartersSheet.getLastColumn()).getValues()[0];
  const Q = COLUMNS.QUARTERS;
  const quarterRecord = {};
  quarterRecord[Q.QUARTER_ID] = plan.quarterId;
  quarterRecord[Q.YEAR] = plan.year;
  quarterRecord[Q.TERM] = 'T' + plan.term;
  quarterRecord[Q.START_DATE] = plan.startDate;
  quarterRecord[Q.END_DATE] = plan.endDate;
  quarterRecord[Q.WEEK_COUNT] = plan.weekCount;
  quarterRecord[Q.GENERATE_ON] = plan.generateOn;
  quarterRecord[Q.OFFICIAL_SEND_ON] = plan.officialSendOn;
  quarterRecord[Q.STAGE] = QUARTER_STAGE.DRAFT;
  const quarterRow = quartersHeaders.map(function (h) { return quarterRecord[h] === undefined ? '' : quarterRecord[h]; });
  quartersSheet.getRange(quartersSheet.getLastRow() + 1, 1, 1, quartersHeaders.length).setValues([quarterRow]);

  const serviceDatesSheet = ss.getSheetByName(SHEETS.SERVICE_DATES);
  if (!serviceDatesSheet) throw new Error('找不到工作表: ' + SHEETS.SERVICE_DATES);
  const serviceDatesHeaders = serviceDatesSheet.getRange(2, 1, 1, serviceDatesSheet.getLastColumn()).getValues()[0];
  const S = COLUMNS.SERVICE_DATES;
  const serviceDateRows = plan.serviceDates.map(function (sd) {
    const record = {};
    record[S.SERVICE_DATE_ID] = sd.serviceDateId;
    record[S.QUARTER_ID] = plan.quarterId;
    record[S.SERVICE_DATE] = sd.serviceDate;
    record[S.WEEK_INDEX] = sd.weekIndex;
    record[S.IS_FIRST_SUNDAY_OF_MONTH] = sd.isFirstSundayOfMonth ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
    record[S.SERVICE_TYPE] = '主日崇拜';
    record[S.AUTO_GENERATE] = BOOLEAN_TEXT.TRUE;
    return serviceDatesHeaders.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });
  const startRow = serviceDatesSheet.getLastRow() + 1;
  serviceDatesSheet.getRange(startRow, 1, serviceDateRows.length, serviceDatesHeaders.length).setValues(serviceDateRows);

  return { quarterRowWritten: true, serviceDateRowsWritten: serviceDateRows.length };
}

/**
 * 選單項目「準備工作 ▸ ⚠️ 新增季度」的執行入口。
 * 依序問年份、季別、（可選）自訂開始日，算出整季主日清單與日期欄位後，
 * 一次過完整列出即將寫入的內容給幹事確認，確認後才寫入 Quarters／ServiceDates。
 * SpecialSundays（合併崇拜／浸禮／宣教月等特別主日）不會自動偵測，確認畫面
 * 與完成畫面都會提醒幹事自行到 SpecialSundays 標記。
 * @returns {void}
 */
function runNewQuarterWizard_() {
  const ui = SpreadsheetApp.getUi();
  const title = '新增季度';

  const yearResponse = ui.prompt(title, '請輸入年份（例如 2027）：', ui.ButtonSet.OK_CANCEL);
  if (yearResponse.getSelectedButton() !== ui.Button.OK) return;
  const year = parseInt(yearResponse.getResponseText().trim(), 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    ui.alert(title, '年份必須是 2000-2100 之間的數字，已取消。', ui.ButtonSet.OK);
    return;
  }

  const termResponse = ui.prompt(title, '請輸入季別（1、2、3 或 4，也可以輸入 T1～T4）：', ui.ButtonSet.OK_CANCEL);
  if (termResponse.getSelectedButton() !== ui.Button.OK) return;
  const termDigits = termResponse.getResponseText().replace(/[^0-9]/g, '');
  const term = parseInt(termDigits, 10);
  if (isNaN(term) || term < 1 || term > 4) {
    ui.alert(title, '季別必須是 1 到 4 之間，已取消。', ui.ButtonSet.OK);
    return;
  }

  const defaultRange = computeCalendarQuarterRange_(year, term, readQuarterTermStartMonths_());
  const customStartResponse = ui.prompt(
    title,
    '以日曆季度計算，這一季預設是 ' + defaultRange.startDate + ' 至 ' + defaultRange.endDate + '\n'
      + '（T1=1-3月、T2=4-6月、T3=7-9月、T4=10-12月——如果教會實際用的季度劃分不是這一套，'
      + '請在下面輸入正確的開始日）。\n\n'
      + '如果預設範圍正確，留空直接按確定；否則請輸入開始日（yyyy-MM-dd）：',
    ui.ButtonSet.OK_CANCEL);
  if (customStartResponse.getSelectedButton() !== ui.Button.OK) return;
  const customStartDate = customStartResponse.getResponseText().trim();

  let plan;
  try {
    plan = planNewQuarterWizard_(year, term, customStartDate);
  } catch (err) {
    ui.alert(title, err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = [
    'QuarterID：' + plan.quarterId,
    '開始日：' + plan.startDate + (plan.usedCustomStart ? '（你輸入的自訂值）' : '（日曆季度算出）'),
    '結束日：' + plan.endDate,
    '主日數量：' + plan.weekCount + ' 個',
    'GenerateOn：' + (plan.generateOn || '（空白——Config 的 LEAD_DAYS_GENERATE 未設定，算不出來，之後可以用「計算季度日期」補算）'),
    'OfficialSendOn：' + (plan.officialSendOn || '（空白——Config 的 LEAD_DAYS_OFFICIAL 未設定，算不出來，之後可以用「計算季度日期」補算）'),
    'Stage：DRAFT',
    '',
    '主日清單：'
  ];
  plan.serviceDates.forEach(function (sd) {
    lines.push('　第 ' + sd.weekIndex + ' 週　' + sd.serviceDate + (sd.isFirstSundayOfMonth ? '（該月第一個主日）' : ''));
  });
  lines.push(
    '',
    '⚠️ 特別主日（合併崇拜、浸禮、宣教月等）不會自動偵測，以上全部先當成普通主日寫入。'
      + '寫入之後記得自己到 SpecialSundays 工作表逐一標記特別主日：合堂週通常只需要'
      + '填 SkipPostIDs（例如只跳過領詩、司琴，其餘崗位照常自動排）；'
      + '只有「呢一週完全冇崇拜、成個主日所有崗位都唔使排」呢種罕見情況'
      + '（例如整週外借場地），先需要改 ServiceDates.AutoGenerate=FALSE'
      + '（呢個係成週停用，唔係「跳過幾個崗位」，唔好同合堂週混用）。',
    '',
    '確定要寫入 Quarters 與 ServiceDates 嗎？'
  );

  if (ui.alert(title + '（確認）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const result = executeNewQuarterWizard_(plan);
    ui.alert(
      title + '（完成）',
      '已建立 ' + plan.quarterId + '：Quarters 新增 1 列，ServiceDates 新增 '
        + result.serviceDateRowsWritten + ' 列（Stage=DRAFT）。\n\n'
        + '記得檢查特殊主日——到 SpecialSundays 工作表標記合併崇拜／浸禮／宣教月等特別安排，'
        + '這一步系統不會幫你做。準備好之後可以執行「步驟 1：生成初稿」。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runNewQuarterWizard_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
