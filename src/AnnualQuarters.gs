/**
 * 第十七輪批次階段 C：**產生下一年度四個季度（確認後寫入）**。
 *
 * ## 起因
 *
 * 第十六輪嘅「產生年度合堂建議」跑 2027 年嗰陣，四項入面**三項被略過**，
 * 原因唔係工具有 bug，而係 `Quarters` 得 2026T4 同 2027T1 兩季，
 * 涵蓋唔到 2027-05-23／08-29／10-03——搵唔到 `QuarterID` 嘅列寫落去
 * 全系統都讀唔到，所以嗰個工具正確噉略過咗。
 *
 * 即係話：**要用年度合堂工具，就要先有成年嘅季度。** 現有嘅
 * 「⚠️ 新增季度」一次只做一季，要做四次、每次答三條問題。呢個工具
 * 一次過做齊一年。
 *
 * ## 同「新增季度」嘅分工
 *
 * | | ⚠️ 新增季度 | ⚠️ 產生下一年度四個季度 |
 * |---|---|---|
 * | 範圍 | 一季 | 一年四季 |
 * | 自訂開始日 | 有（可以覆寫日曆季度） | 冇（一律用 Config 嘅月份劃分） |
 * | GenerateOn／OfficialSendOn | 會算 | 會算（第四十四輪批次 G 組；以前留空） |
 * | 已存在時 | 拋錯、整個工具停低 | **略過嗰一季**，其餘照做 |
 *
 * 冇自訂開始日係刻意嘅：一次過四季，逐季問自訂開始日就變返四次問答，
 * 失去咗「一次過」嘅意義。要特殊處理某一季，用返「新增季度」。
 *
 * ## 安全設計
 *
 * - **只 append，永遠唔覆寫。** `QuarterID` 已存在 ⇒ 整季略過並喺結果列明；
 *   `ServiceDateID` 已存在 ⇒ 嗰一行略過。
 * - 先出**唯讀預覽**（列清楚每季起訖、主日數、第一個同最後一個主日），
 *   確認之後先寫。
 * - 季度月份劃分讀 Config 嘅 `QUARTER_TERM_START_MONTHS`，唔寫死。
 */

/**
 * 算出指定年份四個季度嘅完整規劃。**純讀取，唔寫入任何嘢。**
 *
 * `weekCount` 係自己數出嚟嘅主日數（`listSundaysInRange_()`），唔係假設
 * 13 週——一季實際可以係 12 或者 14 個主日，視乎月份點樣落。
 *
 * ═════════════════════
 * ⚠️ 第四十四輪批次 G 組：而家會算埋 GenerateOn／OfficialSendOn
 * ═════════════════════
 *
 * Ivan 用呢個工具開咗 2028 年四季，然後喺主流程見到：
 *
 *     這一季的 Quarters 沒有填生成日期（GenerateOn），
 *     所以系統講不出還有多久。
 *
 * 舊設計係「一律留空，之後跑『計算季度日期』逐季補」。但兩件事都無效：
 * 一、幹事唔會記得跑一個藏喺選單入面、名字叫「計算季度日期」嘅工具；
 * 二、`OfficialSendOn` 空白會令 GENERATE／REMIND 範本嘅
 *     `{OfficialSendDate}` 喺信入面顯示空白——**信已經寄出去先發現**。
 *
 * 而算呢兩個日期唯一要嘅就係 `StartDate` ＋ Config 嘅前置日數，
 * 兩樣喺呢一步都已經有。留空唔係一個保守嘅選擇，係一個缺口。
 *
 * ⚠️ 前置日數未設定 ⇒ 照樣留空，而且喺預覽明講算唔到。
 * **唔可以當成 0**——當成 0，`GenerateOn` 就變咗開季當日，
 * 即係「到咗先生成」，而幹事要嘅係提早 35 日。
 *
 * @param {number} year 西曆年份
 * @param {Object.<number, number>} startMonths T1～T4 嘅起始月份
 * @param {Object.<string, boolean>} existingQuarterIds 已存在嘅 QuarterID
 * @param {Object.<string, boolean>} existingServiceDateIds 已存在嘅 ServiceDateID
 * @param {{leadGenerate: ?number, leadOfficial: ?number, guardMode: string}} dateSettings
 *   `readQuarterDateSettings_()` 嘅結果。**必須傳**——漏傳嘅話兩欄會靜靜留空，
 *   而嗰個正正就係呢一組要修嘅嘢。
 * @returns {Object[]} 四項規劃，每項含 quarterId／startDate／endDate／weekCount／
 *   generateOn／officialSendOn／serviceDates／alreadyExists／newServiceDates／
 *   skippedServiceDates
 */
function planAnnualQuarters_(year, startMonths, existingQuarterIds, existingServiceDateIds,
  dateSettings) {
  if (!dateSettings || typeof dateSettings !== 'object') {
    throw new Error('planAnnualQuarters_()：第 5 個參數 dateSettings 沒有傳。'
      + '它是 readQuarterDateSettings_() 的結果，用來計算 GenerateOn／OfficialSendOn。'
      + '漏傳的話那兩欄會靜靜留空——而那正是第四十四輪批次 G 組要修的問題，'
      + '所以這裡寧可拋錯。');
  }
  const plans = [];

  for (let term = 1; term <= 4; term++) {
    const quarterId = year + 'T' + term;
    const range = computeCalendarQuarterRange_(year, term, startMonths);
    const sundays = listSundaysInRange_(range.startDate, range.endDate);

    let lastMonth = '';
    const serviceDates = sundays.map(function (date, i) {
      const monthKey = date.slice(0, 7);
      const isFirstSundayOfMonth = monthKey !== lastMonth;
      lastMonth = monthKey;
      return {
        // ServiceDateID 沿用「新增季度」嘅格式：`{QuarterID}-W{兩位數週次}`
        serviceDateId: quarterId + '-W' + (i + 1 < 10 ? '0' + (i + 1) : String(i + 1)),
        serviceDate: date,
        weekIndex: i + 1,
        isFirstSundayOfMonth: isFirstSundayOfMonth
      };
    });

    const newServiceDates = serviceDates.filter(function (sd) {
      return !existingServiceDateIds[sd.serviceDateId];
    });

    plans.push({
      quarterId: quarterId,
      year: year,
      term: term,
      startDate: range.startDate,
      endDate: range.endDate,
      weekCount: sundays.length,
      firstSunday: sundays.length > 0 ? sundays[0] : '',
      lastSunday: sundays.length > 0 ? sundays[sundays.length - 1] : '',
      // 算唔到（Config 嘅前置日數未填）就係空字串，而預覽會明講。
      generateOn: computeQuarterDateFromLead_(
        range.startDate, dateSettings.leadGenerate, dateSettings.guardMode),
      officialSendOn: computeQuarterDateFromLead_(
        range.startDate, dateSettings.leadOfficial, dateSettings.guardMode),
      serviceDates: serviceDates,
      newServiceDates: newServiceDates,
      skippedServiceDates: serviceDates.length - newServiceDates.length,
      alreadyExists: !!existingQuarterIds[quarterId]
    });
  }

  return plans;
}

/**
 * 讀取目前已存在嘅 `QuarterID` 與 `ServiceDateID`，供 `planAnnualQuarters_()`
 * 判斷邊啲要略過。純讀取。
 * @returns {{quarterIds: Object.<string, boolean>, serviceDateIds: Object.<string, boolean>}}
 */
function readExistingQuarterAndServiceDateIds_() {
  const quarterIds = {};
  readSheet(SHEETS.QUARTERS).forEach(function (row) {
    const id = String(row[COLUMNS.QUARTERS.QUARTER_ID] || '').trim();
    if (id) quarterIds[id] = true;
  });

  const serviceDateIds = {};
  readSheet(SHEETS.SERVICE_DATES).forEach(function (row) {
    const id = String(row[COLUMNS.SERVICE_DATES.SERVICE_DATE_ID] || '').trim();
    if (id) serviceDateIds[id] = true;
  });

  return { quarterIds: quarterIds, serviceDateIds: serviceDateIds };
}

/**
 * 依規劃寫入 `Quarters` 與 `ServiceDates`。
 *
 * ⚠️ **本輪唔可以寫入試算表，呢個函式本輪冇執行過**，只實作好俾之後用。
 *
 * 只 append：`alreadyExists` 嘅季度完全唔掂（連佢嘅 ServiceDates 都唔會補，
 * 因為嗰一季係人手建立定係之前用工具建立，我哋唔知佢有冇特殊安排——
 * 要補就用返「新增季度」或者人手處理）；`ServiceDateID` 已存在嘅行略過。
 *
 * `GenerateOn`／`OfficialSendOn` 由 `planAnnualQuarters_()` 算好帶落嚟；
 * 算唔到（Config 嘅前置日數未填）就仍然係空白。
 *
 * @param {Object[]} plans `planAnnualQuarters_()` 嘅結果
 * @returns {{quartersWritten: number, serviceDatesWritten: number, skippedQuarters: string[]}}
 */
function executeAnnualQuarters_(plans) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const quartersSheet = ss.getSheetByName(SHEETS.QUARTERS);
  if (!quartersSheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);
  const serviceDatesSheet = ss.getSheetByName(SHEETS.SERVICE_DATES);
  if (!serviceDatesSheet) throw new Error('找不到工作表: ' + SHEETS.SERVICE_DATES);

  const quartersHeaders = quartersSheet.getRange(2, 1, 1, quartersSheet.getLastColumn()).getValues()[0];
  const serviceDatesHeaders = serviceDatesSheet
    .getRange(2, 1, 1, serviceDatesSheet.getLastColumn()).getValues()[0];
  const Q = COLUMNS.QUARTERS;
  const S = COLUMNS.SERVICE_DATES;

  const quarterRows = [];
  const serviceDateRows = [];
  const skippedQuarters = [];

  plans.forEach(function (plan) {
    if (plan.alreadyExists) {
      skippedQuarters.push(plan.quarterId);
      return;
    }

    const q = {};
    q[Q.QUARTER_ID] = plan.quarterId;
    q[Q.YEAR] = plan.year;
    q[Q.TERM] = 'T' + plan.term;
    q[Q.START_DATE] = plan.startDate;
    q[Q.END_DATE] = plan.endDate;
    q[Q.WEEK_COUNT] = plan.weekCount;
    // ⚠️ 第四十四輪批次 G 組：算得到就寫落去（算唔到就仍然係空字串）。
    // 舊行為係一律留空、叫幹事之後跑「計算季度日期」補——而佢唔會記得，
    // 結果主流程一直顯示「這一季的 Quarters 沒有填生成日期」。
    q[Q.GENERATE_ON] = plan.generateOn || '';
    q[Q.OFFICIAL_SEND_ON] = plan.officialSendOn || '';
    q[Q.STAGE] = QUARTER_STAGE.DRAFT;
    quarterRows.push(quartersHeaders.map(function (h) { return q[h] === undefined ? '' : q[h]; }));

    plan.newServiceDates.forEach(function (sd) {
      const r = {};
      r[S.SERVICE_DATE_ID] = sd.serviceDateId;
      r[S.QUARTER_ID] = plan.quarterId;
      r[S.SERVICE_DATE] = sd.serviceDate;
      r[S.WEEK_INDEX] = sd.weekIndex;
      r[S.IS_FIRST_SUNDAY_OF_MONTH] = sd.isFirstSundayOfMonth ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
      r[S.SERVICE_TYPE] = '主日崇拜';
      r[S.AUTO_GENERATE] = BOOLEAN_TEXT.TRUE;
      serviceDateRows.push(serviceDatesHeaders.map(function (h) { return r[h] === undefined ? '' : r[h]; }));
    });
  });

  if (quarterRows.length > 0) {
    quartersSheet.getRange(quartersSheet.getLastRow() + 1, 1, quarterRows.length, quartersHeaders.length)
      .setValues(quarterRows);
  }
  if (serviceDateRows.length > 0) {
    serviceDatesSheet
      .getRange(serviceDatesSheet.getLastRow() + 1, 1, serviceDateRows.length, serviceDatesHeaders.length)
      .setValues(serviceDateRows);
  }

  return {
    quartersWritten: quarterRows.length,
    serviceDatesWritten: serviceDateRows.length,
    skippedQuarters: skippedQuarters
  };
}

/**
 * 組出唯讀預覽對話框嘅文字。純函式，方便測試。
 * @param {number} year 年份
 * @param {Object[]} plans `planAnnualQuarters_()` 嘅結果
 * @param {Object.<number, number>} startMonths 生效中嘅月份劃分
 * @returns {string} 預覽文字
 */
function buildAnnualQuartersPreview_(year, plans, startMonths) {
  const lines = [
    year + ' 年四個季度：',
    '（季度月份劃分 T1=' + startMonths[1] + '月起、T2=' + startMonths[2]
      + '月起、T3=' + startMonths[3] + '月起、T4=' + startMonths[4] + '月起，'
      + '可在 Config 的 ' + CONFIG_KEYS.QUARTER_TERM_START_MONTHS + ' 調整）',
    ''
  ];

  plans.forEach(function (p) {
    lines.push(p.quarterId + '　' + p.startDate + ' 至 ' + p.endDate);
    lines.push('　　主日 ' + p.weekCount + ' 個　第一個 ' + p.firstSunday + '　最後一個 ' + p.lastSunday);
    // ⚠️ 第四十四輪批次 G 組：兩個日期要**喺預覽度睇得到**。
    // 寫入之後先去 Quarters 逐格對，等於冇畀佢過目。
    lines.push('　　生成日期 ' + (p.generateOn || '（算不出）')
      + '　正式發出日期 ' + (p.officialSendOn || '（算不出）'));
    if (p.alreadyExists) {
      lines.push('　　⚠ Quarters 已經有這一季 → 整季略過（不會覆寫任何既有資料）');
    } else if (p.skippedServiceDates > 0) {
      lines.push('　　⚠ 其中 ' + p.skippedServiceDates + ' 個主日的 ServiceDateID 已存在 → 那幾行會略過');
    }
    lines.push('');
  });

  const writable = plans.filter(function (p) { return !p.alreadyExists; });
  const totalDates = writable.reduce(function (s, p) { return s + p.newServiceDates.length; }, 0);
  lines.push('將新增：' + writable.length + ' 個季度、' + totalDates + ' 行 ServiceDates。');
  lines.push('');
  // ⚠️ 第四十四輪批次 G 組：算得到就唔使再叫佢跑另一個工具。
  // 算唔到就要明講**點解**同埋**跟住做乜**——一句「算不出」而唔講原因，
  // 幹事只會當佢係壞咗。
  const cannot = plans.filter(function (p) {
    return !p.alreadyExists && (!p.generateOn || !p.officialSendOn);
  });
  if (cannot.length > 0) {
    lines.push('⚠️ 其中 ' + cannot.length + ' 季算不出生成日期／正式發出日期，');
    lines.push('　 原因是 Config 的 ' + CONFIG_KEYS.LEAD_DAYS_GENERATE + ' 或 '
      + CONFIG_KEYS.LEAD_DAYS_OFFICIAL + ' 還沒有填。');
    lines.push('　 那兩格會留空。填好 Config 之後，執行');
    lines.push('　 「準備工作 ▸ ⚠️ 計算季度日期」就可以補上。');
  } else {
    lines.push('生成日期與正式發出日期會一併寫入，不用再另外執行「計算季度日期」。');
  }
  lines.push('');
  lines.push('只會新增，不會覆寫任何一格既有資料。確定要寫入嗎？');
  return lines.join('\n');
}

/**
 * 選單項目「準備工作 ▸ ⚠️ 產生下一年度四個季度（確認後寫入）」嘅執行入口。
 * @returns {void}
 */
function runAnnualQuartersWizard_() {
  const ui = SpreadsheetApp.getUi();
  const title = '產生下一年度四個季度';

  const response = ui.prompt(title,
    '請輸入年份（例如 2027）：\n\n'
      + '會一次過算好這一年四個季度的起訖日與全部主日，\n'
      + '先給你看預覽，確認之後才寫入 Quarters 與 ServiceDates。\n\n'
      + '已經存在的季度會整季略過，不會覆寫任何既有資料。',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const year = parseInt(normalizeIdInput_(response.getResponseText()), 10);
  if (isNaN(year) || year < 2000 || year > 2100) {
    ui.alert(title, '年份必須是 2000-2100 之間的數字，已取消。', ui.ButtonSet.OK);
    return;
  }

  let plans;
  let startMonths;
  try {
    startMonths = readQuarterTermStartMonths_();
    const existing = readExistingQuarterAndServiceDateIds_();
    plans = planAnnualQuarters_(year, startMonths, existing.quarterIds, existing.serviceDateIds,
      readQuarterDateSettings_());
  } catch (err) {
    log_('ERROR', 'planAnnualQuarters_ 失敗: ' + err.message);
    ui.alert(title, '計算失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const writable = plans.filter(function (p) { return !p.alreadyExists; });
  if (writable.length === 0) {
    ui.alert(title,
      buildAnnualQuartersPreview_(year, plans, startMonths)
        + '\n\n四個季度全部已經存在，不需要執行。',
      ui.ButtonSet.OK);
    return;
  }

  if (ui.alert(title + '（預覽）', buildAnnualQuartersPreview_(year, plans, startMonths),
    ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const result = executeAnnualQuarters_(plans);
    writeAuditLog_({
      action: '產生年度季度',
      targetSheet: SHEETS.QUARTERS,
      targetKey: String(year),
      newValue: result.quartersWritten + ' 個季度、' + result.serviceDatesWritten + ' 行 ServiceDates',
      source: 'runAnnualQuartersWizard_',
      notes: result.skippedQuarters.length > 0
        ? '略過已存在的季度：' + result.skippedQuarters.join('、') : '沒有略過任何季度'
    });

    const done = [
      '已新增 ' + result.quartersWritten + ' 個季度、'
        + result.serviceDatesWritten + ' 行 ServiceDates。'
    ];
    if (result.skippedQuarters.length > 0) {
      done.push('', '略過（已經存在，一格都沒有動）：' + result.skippedQuarters.join('、'));
    }
    done.push('',
      '接下來要做的事：',
      '1. 「準備工作 ▸ ⚠️ 計算季度日期」——逐季補上 GenerateOn 與 OfficialSendOn',
      '　 （這個工具刻意留空，因為那兩個日期取決於 Config 的 lead days，',
      '　 而且你可能想按實際情況微調）。',
      '2. 「準備工作 ▸ ⚠️ 產生年度合堂建議」——現在季度齊全了，四次合堂',
      '　 應該全部寫得入去，不會再像上次那樣被略過三項。',
      '3. 「查看 ▸ 身分規則影響預估（唯讀）」——生成初稿之前先看一次，',
      '　 確認加了身分規則之後每個崗位還排不排得出人。');
    ui.alert(title, done.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runAnnualQuartersWizard_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
