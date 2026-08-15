/**
 * 通用讀表函式：第 1 行視為說明列自動跳過，第 2 行視為標題列，
 * 從第 3 行起讀取資料，回傳以標題為屬性名稱的物件陣列。
 * @param {string} sheetName 工作表名稱
 * @returns {Object[]} 物件陣列，屬性名稱對應標題列；找不到資料時回傳空陣列
 */
function readSheet(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('找不到工作表: ' + sheetName);
  }
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) {
    return [];
  }

  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dataRows = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();

  const result = [];
  for (let r = 0; r < dataRows.length; r++) {
    const obj = {};
    let isEmpty = true;
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (!header) continue;
      const value = dataRows[r][c];
      obj[header] = value;
      if (value !== '' && value !== null) isEmpty = false;
    }
    if (!isEmpty) result.push(obj);
  }
  return result;
}

/**
 * 讀取 Posts 工作表，只回傳 Active=TRUE 的職位，並按 DisplayOrder 由小到大排序。
 * @returns {Object[]} 職位物件陣列
 */
function readPosts() {
  const rows = readSheet(SHEETS.POSTS).filter(function (row) {
    return isTrueValue_(row[COLUMNS.POSTS.ACTIVE]);
  });
  rows.sort(function (a, b) {
    return Number(a[COLUMNS.POSTS.DISPLAY_ORDER]) - Number(b[COLUMNS.POSTS.DISPLAY_ORDER]);
  });
  return rows;
}

/**
 * 讀取 NameMapping 工作表（會友/義工名冊），只回傳 Active=TRUE 的人。
 * @returns {Object[]} 人員物件陣列
 */
function readPeople() {
  return readSheet(SHEETS.NAME_MAPPING).filter(function (row) {
    return isTrueValue_(row[COLUMNS.NAME_MAPPING.ACTIVE]);
  });
}

/**
 * 讀取 Eligibility 工作表，建立雙向索引與歷史服侍次數對照。
 * 只計入 Active=TRUE 且 Eligible=TRUE 的紀錄。
 * @returns {{byPost: Object.<string, string[]>, byPerson: Object.<string, string[]>,
 *   historicalCount: Object.<string, Object.<string, number>>}}
 *   byPost 為 {PostID: [PersonID...]}、byPerson 為 {PersonID: [PostID...]}、
 *   historicalCount 為 {PostID: {PersonID: HistoricalCount}}
 */
function readEligibility() {
  const rows = readSheet(SHEETS.ELIGIBILITY);
  const byPost = {};
  const byPerson = {};
  const historicalCount = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isTrueValue_(row[COLUMNS.ELIGIBILITY.ACTIVE])) continue;
    if (!isTrueValue_(row[COLUMNS.ELIGIBILITY.ELIGIBLE])) continue;
    const personId = row[COLUMNS.ELIGIBILITY.PERSON_ID];
    const postId = row[COLUMNS.ELIGIBILITY.POST_ID];
    if (!personId || !postId) continue;
    if (!byPost[postId]) byPost[postId] = [];
    byPost[postId].push(personId);
    if (!byPerson[personId]) byPerson[personId] = [];
    byPerson[personId].push(postId);
    if (!historicalCount[postId]) historicalCount[postId] = {};
    historicalCount[postId][personId] = Number(row[COLUMNS.ELIGIBILITY.HISTORICAL_COUNT]) || 0;
  }
  return { byPost: byPost, byPerson: byPerson, historicalCount: historicalCount };
}

/**
 * 讀取 Posts 並正規化為排表與核對邏輯共用的物件格式（只含 Active=TRUE，按 DisplayOrder 排序）。
 * @returns {Object[]} 正規化後的崗位物件陣列
 */
function readPostsNormalized() {
  return readPosts().map(function (row) {
    return {
      postId: row[COLUMNS.POSTS.POST_ID],
      postNameTC: row[COLUMNS.POSTS.POST_NAME_TC],
      slotCount: Number(row[COLUMNS.POSTS.SLOT_COUNT]) || 1,
      distinctWithinPost: isTrueValue_(row[COLUMNS.POSTS.DISTINCT_WITHIN_POST]),
      frequency: String(row[COLUMNS.POSTS.FREQUENCY] || POST_FREQUENCY.WEEKLY).toUpperCase(),
      autoGenerate: isTrueValue_(row[COLUMNS.POSTS.AUTO_GENERATE]),
      allowConsecutive: String(row[COLUMNS.POSTS.ALLOW_CONSECUTIVE] || ALLOW_CONSECUTIVE.ALLOW).toUpperCase(),
      mutexGroup: String(row[COLUMNS.POSTS.MUTEX_GROUP] || '').trim(),
      displayOrder: Number(row[COLUMNS.POSTS.DISPLAY_ORDER]),
      emptyDisplay: row[COLUMNS.POSTS.EMPTY_DISPLAY],
      earlyArrivalMinutes: Number(row[COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES]) || 0
    };
  });
}

/**
 * 讀取指定季度的 ServiceDates 並正規化，按 WeekIndex 由小到大排序。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 正規化後的主日物件陣列
 */
function readServiceDatesNormalized(quarterId, timezone) {
  const rows = readServiceDates(quarterId).map(function (row) {
    return {
      serviceDateId: row[COLUMNS.SERVICE_DATES.SERVICE_DATE_ID],
      serviceDate: toDateString(row[COLUMNS.SERVICE_DATES.SERVICE_DATE], timezone),
      weekIndex: Number(row[COLUMNS.SERVICE_DATES.WEEK_INDEX]),
      isFirstSundayOfMonth: isTrueValue_(row[COLUMNS.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]),
      serviceType: row[COLUMNS.SERVICE_DATES.SERVICE_TYPE],
      specialId: row[COLUMNS.SERVICE_DATES.SPECIAL_ID],
      autoGenerate: isTrueValue_(row[COLUMNS.SERVICE_DATES.AUTO_GENERATE])
    };
  });
  rows.sort(function (a, b) { return a.weekIndex - b.weekIndex; });
  return rows;
}

/**
 * 讀取 Unavailable 並正規化，只保留 Status=ACTIVE 的紀錄。
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 正規化後的不可服侍時段陣列
 */
function readUnavailableNormalized(timezone) {
  return readUnavailable()
    .filter(function (row) {
      return String(row[COLUMNS.UNAVAILABLE.STATUS] || '').toUpperCase() === UNAVAILABLE_VALUES.STATUS_ACTIVE;
    })
    .map(function (row) {
      return {
        personId: row[COLUMNS.UNAVAILABLE.PERSON_ID],
        dateFrom: toDateString(row[COLUMNS.UNAVAILABLE.DATE_FROM], timezone),
        dateTo: toDateString(row[COLUMNS.UNAVAILABLE.DATE_TO], timezone),
        appliesTo: String(row[COLUMNS.UNAVAILABLE.APPLIES_TO] || UNAVAILABLE_VALUES.APPLIES_TO_ALL).toUpperCase(),
        postIds: splitList_(row[COLUMNS.UNAVAILABLE.POST_IDS])
      };
    });
}

/**
 * 讀取 NameAlias 工作表，建立 Alias 到 PersonID 的對照。只計入 Active=TRUE 的紀錄。
 * @returns {Object.<string, string>} {alias: personId}
 */
function readNameAlias() {
  const rows = readSheet(SHEETS.NAME_ALIAS);
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isTrueValue_(row[COLUMNS.NAME_ALIAS.ACTIVE])) continue;
    const alias = row[COLUMNS.NAME_ALIAS.ALIAS];
    const personId = row[COLUMNS.NAME_ALIAS.PERSON_ID];
    if (!alias || !personId) continue;
    map[alias] = personId;
  }
  return map;
}

/**
 * 讀取指定季度的 ServiceDates（主日日期清單）。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {Object[]} 該季度的主日物件陣列
 */
function readServiceDates(quarterId) {
  return readSheet(SHEETS.SERVICE_DATES).filter(function (row) {
    return row[COLUMNS.SERVICE_DATES.QUARTER_ID] === quarterId;
  });
}

/**
 * 讀取指定季度的 SpecialSundays（特別主日安排）。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {Object[]} 該季度的特別主日物件陣列
 */
function readSpecialSundays(quarterId) {
  return readSheet(SHEETS.SPECIAL_SUNDAYS).filter(function (row) {
    return row[COLUMNS.SPECIAL_SUNDAYS.QUARTER_ID] === quarterId;
  });
}

/**
 * 讀取 Unavailable 工作表（請假／不可用時段），回傳所有紀錄。
 * @returns {Object[]} 不可用時段物件陣列
 */
function readUnavailable() {
  return readSheet(SHEETS.UNAVAILABLE);
}

/**
 * 讀取 RuleSettings 工作表，回傳以 RuleID 為鍵的規則物件對照表。
 * @returns {Object.<string, Object>} {ruleId: 規則物件}
 */
function readRules() {
  const rows = readSheet(SHEETS.RULE_SETTINGS);
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    const ruleId = rows[i][COLUMNS.RULE_SETTINGS.RULE_ID];
    if (!ruleId) continue;
    map[ruleId] = rows[i];
  }
  return map;
}

/**
 * 判斷儲存格的布林值，同時處理實際布林值與 "TRUE"/"FALSE" 字串。
 * @param {*} value 儲存格原始值
 * @returns {boolean} 是否視為 TRUE
 */
function isTrueValue_(value) {
  if (value === true) return true;
  return String(value).trim().toUpperCase() === 'TRUE';
}
