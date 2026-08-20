/**
 * 第二十三輪批次階段 C：**只喺明確開啟期間生效**嘅 `readSheet()` 記憶體快取。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有，同埋點解係「opt-in」而唔係一律開
 * ─────────────────────────────────────────────────────────────────────
 *
 * `apiGetDashboardState()` 要一次過算出成版嘢（四粒掣嘅狀態、未儲存改動、
 * 區二未做完項數），期間會經過幾個各自 `readSheet()` 嘅既有函式
 * （`buildFineTuneContext_()`／`buildMailContext_()`／`readPendingRequests_()`…）。
 * 唔做嘢嘅話，`RosterAssignments`（幾百行）同 `SendLog`（只會單調增長、
 * 冇歸檔機制）喺同一次呼叫入面會被完整讀幾次——純粹浪費。
 *
 * ⚠️ **點解唔一律開快取**：全域快取會令「寫入之後再讀」讀到過時資料。
 * 本專案好多流程正正係噉（`writeAssignments()` 之後再 `readSheet()` 核對），
 * 一律開快取就會種一個極難查嘅 bug——而且係「靜靜讀到舊資料」呢一類，
 * 同本專案已經燒過幾次嘅 bug class 同源。
 *
 * 所以：**預設關閉**，只有明確 `beginSheetReadMemo_()` 嗰段先生效，
 * 而且一定要喺 `finally` 入面 `endSheetReadMemo_()`。
 * **只可以喺完全冇寫入嘅純讀取流程開。**
 */
let SHEET_READ_MEMO_ = null;

/**
 * 開始 `readSheet()` 快取。**只可以喺完全唔寫入嘅純讀取流程用**，
 * 而且一定要配 `try/finally` 確保收尾。
 * @returns {void}
 */
function beginSheetReadMemo_() {
  SHEET_READ_MEMO_ = {};
}

/**
 * 結束 `readSheet()` 快取，之後恢復每次都真正讀表。
 * @returns {void}
 */
function endSheetReadMemo_() {
  SHEET_READ_MEMO_ = null;
}

/**
 * 第二十四輪批次階段 A1：由快取攞資料嗰陣**回傳淺複本**，唔回傳快取本身。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要複本，同埋點解揀複本而唔揀 Object.freeze()
 * ─────────────────────────────────────────────────────────────────────
 *
 * 冇複本嘅話，快取存嘅係陣列 reference。快取開啟期間如果有人 mutate 咗
 * 攞返嚟嘅陣列或者入面嘅 row（`.sort()`／`.push()`／改 property），
 * 同一次呼叫之後再讀同一張表就會攞到**被改過嘅資料**。
 *
 * 逐個 `readSheet()` 呼叫點掃描過（第二十四輪階段 A1）：
 * - 全部 `record[C.X] = …` 嘅賦值都係喺**新建嘅 `{}`** 上面，唔係 readSheet 出嚟嘅 row
 * - 四處 `.sort()` 全部喺 `.filter()`／`.map()` **之後**先排（嗰啲已經係新陣列）
 *
 * 所以**目前冇任何一處會 mutate**——呢個係將來風險，唔係現有 bug。
 *
 * **點解揀淺複本，唔揀 `Object.freeze()`：**
 *
 * | 做法 | 有人 mutate 時會點 |
 * |---|---|
 * | `Object.freeze()` | 非嚴格模式下**靜靜失敗**——改動消失，程式繼續行落去 |
 * | 淺複本（採用）| 改動只影響呼叫者自己嗰份，快取保持乾淨 |
 *
 * ⚠️ **靜靜失敗正正就係本專案已經燒過幾次嘅 bug class。** 但更決定性嘅
 * 理由係**語意一致**：冇快取嗰陣，每次 `readSheet()` 都回傳全新物件。
 * 淺複本令**有快取同冇快取嘅行為完全一樣**；freeze 就會令兩者唔同
 * ——而且個分別只會喺「有開快取」嗰條路徑先浮現，即係
 * **測試全綠、偏偏就係實際會行嗰條路出事**。
 *
 * 成本：每次快取命中複製 N 個物件。相對於一次 `getValues()` 來回，
 * 呢個成本可以忽略。
 *
 * @param {Object[]} rows 快取入面嘅資料
 * @returns {Object[]} 淺複本（外層陣列同每一行都係新物件）
 */
function cloneMemoRows_(rows) {
  return rows.map(function (row) {
    const copy = {};
    Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
    return copy;
  });
}

/**
 * 通用讀表函式：第 1 行視為說明列自動跳過，第 2 行視為標題列，
 * 從第 3 行起讀取資料，回傳以標題為屬性名稱的物件陣列。
 * @param {string} sheetName 工作表名稱
 * @returns {Object[]} 物件陣列，屬性名稱對應標題列；找不到資料時回傳空陣列
 */
function readSheet(sheetName) {
  if (SHEET_READ_MEMO_ && Object.prototype.hasOwnProperty.call(SHEET_READ_MEMO_, sheetName)) {
    return cloneMemoRows_(SHEET_READ_MEMO_[sheetName]);
  }

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

  if (SHEET_READ_MEMO_) SHEET_READ_MEMO_[sheetName] = result;
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
  const explicitlyExcluded = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isTrueValue_(row[COLUMNS.ELIGIBILITY.ACTIVE])) continue;
    const personId = row[COLUMNS.ELIGIBILITY.PERSON_ID];
    const postId = row[COLUMNS.ELIGIBILITY.POST_ID];
    if (!personId || !postId) continue;

    // 第十六輪批次階段 B 新增：`Active=TRUE` 但 `Eligible=FALSE` 的行，語意是
    // 幹事**明確**寫低「呢個人唔好排呢個崗位」，跟「根本沒有這一行」（從來
    // 沒有人考慮過）是兩回事。以前兩者的結果一樣（都是不在 byPost 裡），
    // 所以無須分辨；但身分名單上線之後，一個持有所需身分的人會被
    // `buildRoleAugmentedEligibleByPost_()` 自動補進候選池——如果不記住這個
    // 明確的否決，幹事寫落的 `Eligible=FALSE` 會被身分規則靜靜噉推翻。
    if (!isTrueValue_(row[COLUMNS.ELIGIBILITY.ELIGIBLE])) {
      if (!explicitlyExcluded[postId]) explicitlyExcluded[postId] = {};
      explicitlyExcluded[postId][personId] = true;
      continue;
    }

    if (!byPost[postId]) byPost[postId] = [];
    byPost[postId].push(personId);
    if (!byPerson[personId]) byPerson[personId] = [];
    byPerson[personId].push(postId);
    if (!historicalCount[postId]) historicalCount[postId] = {};
    historicalCount[postId][personId] = Number(row[COLUMNS.ELIGIBILITY.HISTORICAL_COUNT]) || 0;
  }
  return {
    byPost: byPost,
    byPerson: byPerson,
    historicalCount: historicalCount,
    explicitlyExcluded: explicitlyExcluded
  };
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
      earlyArrivalMinutes: Number(row[COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES]) || 0,
      // 第十六輪批次階段 B：擔任這個崗位所需的身分（逗號分隔＝任一符合即可）。
      // 欄不存在時 row[...] 是 undefined，`splitList_()` 會得出空陣列＝沒有要求，
      // 所以未補建這一欄的舊環境完全不受影響。
      requiredRoles: String(row[COLUMNS.POSTS.REQUIRED_ROLES] || '').trim()
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
/**
 * 第三十四輪批次乙3：**「呢一筆不能服侍算唔算生效」——全系統唯一嘅判斷。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 點解要抽出嚟
 * ─────────────────────────────────────────────────────────────────────
 *
 * 2026-08-20 實測：把一行改成 `CANCELLED` 之後，**排表引擎已經正確咁忽略咗佢**
 *（呢個函式下面嗰個 filter），但幹事畫面「不能服侍的日期」照樣把佢列喺
 * 「生效中」——因為 `WebAppUnavailable.gs` 嗰邊由頭到尾**完全冇睇 `Status`**，
 * 只係按日期分「生效中」同「過期」。
 *
 * 兩層對「生效」有兩套理解，而且**係危險嗰個方向**：
 * 幹事會以為一條已經取消嘅限制仍然生效，於是唔敢派嗰個人。
 * 呢個係本專案 bug class 第 3 條。
 *
 * 而家兩邊都叫呢一個函式。要改「點先算生效」就改呢度一個地方。
 *
 * @param {Object} row `readUnavailable()` 出嚟嘅一列
 * @returns {boolean} 生效（`Status` 係 ACTIVE）先回 true
 */
function isUnavailableRowActive_(row) {
  return String(row[COLUMNS.UNAVAILABLE.STATUS] || '').trim().toUpperCase()
    === UNAVAILABLE_VALUES.STATUS_ACTIVE;
}

function readUnavailableNormalized(timezone) {
  return readUnavailable()
    .filter(isUnavailableRowActive_)
    .map(function (row) {
      return {
        personId: row[COLUMNS.UNAVAILABLE.PERSON_ID],
        dateFrom: toDateString(row[COLUMNS.UNAVAILABLE.DATE_FROM], timezone),
        dateTo: toDateString(row[COLUMNS.UNAVAILABLE.DATE_TO], timezone),
        appliesTo: String(row[COLUMNS.UNAVAILABLE.APPLIES_TO] || UNAVAILABLE_VALUES.APPLIES_TO_ALL).toUpperCase(),
        postIds: splitList_(row[COLUMNS.UNAVAILABLE.POST_IDS]),
        // 第二十一輪批次階段 A：硬規則違反三分類要判斷「呢行申報係咪
        // 版本生成之後先新增」，所以要帶埋建立時間。原值照傳（唔喺呢度
        // 格式化）——`toEpochMillis_()` 會處理 Date 物件同字串兩種情況。
        createdAt: row[COLUMNS.UNAVAILABLE.CREATED_AT]
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
