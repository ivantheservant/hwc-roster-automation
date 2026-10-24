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
 * 第七十五輪批次 CC 組：特別主日用唔用（Config `SPECIAL_SUNDAYS_ENABLED`，預設 FALSE）。
 *
 * ⚠️ 讀唔到 Config 都當 FALSE（Ivan 已決定拿走特別主日；靜靜開返舊行為反而會令
 * 幹事見到佢以為已經冇咗嘅「特殊主日」）。
 * @returns {boolean}
 */
function isSpecialSundaysEnabled_() {
  try {
    return getConfig(CONFIG_KEYS.SPECIAL_SUNDAYS_ENABLED, DEFAULTS.SPECIAL_SUNDAYS_ENABLED) === true;
  } catch (err) {
    return false;
  }
}

/**
 * 讀取指定季度的 SpecialSundays（特別主日安排）。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {Object[]} 該季度的特別主日物件陣列
 */
function readSpecialSundays(quarterId) {
  // 第七十五輪批次 CC 組：關咗（預設）⇒ 一律當冇特別主日。呢度係生成、調整、核對、匯入、
  // 角色影響、軟規則量度、grid 標題／外部單位索引嘅共同入口，所以只喺呢度關一次。
  if (!isSpecialSundaysEnabled_()) return [];
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

/**
 * 第六十三輪批次 A 組：這一季某一版喺 `RosterAssignments` 最後一次改動嘅時間。
 *
 * 「過期」嘅兩個判斷都靠佢：公開連結（`evaluatePublicLinkFreshness_()`）
 * 同個人 PDF（`isPersonalPdfStale_()`）。填講員／翻譯／獻花係直接改最新版本
 *（唔造新版本），所以只有 `UpdatedAt` 先睇得出「內容喺發佈／產生之後改過」。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} timezone 時區
 * @returns {?string} `yyyy-MM-dd HH:mm:ss`；一格都冇時間就回 null
 */
function readLatestAssignmentUpdatedAt_(quarterId, versionNo, timezone) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  let max = null;
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
    if (Number(row[A.VERSION_NO]) !== Number(versionNo)) return;
    const t = normalizeSheetTimestamp_(row[A.UPDATED_AT], timezone);
    if (t && (max === null || t > max)) max = t;
  });
  return max;
}

/**
 * 第六十三輪批次 B 組：**特別主日逐日嘅安排——生成器同「開季前準備」共用。**
 *
 * 只計 `Active = TRUE`（Active=FALSE 代表幹事已經決定唔用呢一列）。
 *
 * ⚠️ 「開季前準備」本來自己數「講員未填」，完全唔理特別主日
 *（`SkipPostIDs` 有 `PREACHER` 嗰週照計「未填」）。佢同生成器一定要讀
 * 同一份——各寫一份嘅話，生成器話嗰週唔設講員，開季前準備就話未填。
 *
 * @param {Object[]} specialRows `SpecialSundays` 嘅列（呼叫端已篩季度）
 * @param {string} timezone 時區
 * @returns {Object.<string, {specialId: string, skipPostIds: string[], lockPostIds: string[]}>}
 */
function buildSpecialSundayByDate_(specialRows, timezone) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const byDate = {};
  (specialRows || [])
    .filter(function (row) { return isTrueValue_(row[S.ACTIVE]); })
    .forEach(function (row) {
      const dateStr = toDateString(row[S.SERVICE_DATE], timezone);
      if (!dateStr) return;
      byDate[dateStr] = {
        specialId: row[S.SPECIAL_ID],
        skipPostIds: splitList_(row[S.SKIP_POST_IDS]),
        lockPostIds: splitList_(row[S.LOCK_POST_IDS])
      };
    });
  return byDate;
}

/**
 * 第七十四輪批次 BC 組：這一個版本有冇**已經通知過人**（正式發出或改動後重發）。
 *
 * 現場（第七十三輪 K1）：2028T3 已正式發出，〔填講員／翻譯／獻花〕仍然直接改寫已寄出那一版嘅
 * `RosterAssignments`，結果寄出紀錄同內容對唔上，而且「只寄給安排有改動的人」拿最新版同「上次寄出的版本」
 * 比較——兩者係同一版 ⇒ 填獻花嗰位會友永遠收唔到通知。
 *
 * 判斷：`SendLog` 有呢一版（`VersionNo`）嘅 `OFFICIAL` 或 `RESEND` 紀錄，而且 Status 屬「已收到」
 * （`isNoticeReceivedRecord_()`＝SENT／DRY_RUN／SKIPPED_UNCHANGED／EXTERNAL，補寄工具同一個共用判斷，
 * 唔另寫一套）。**按版本判斷**：已正式發出之後存成新一版（未寄）就恢復照舊直接填。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]=} sendLogRows 選填；唔傳就自己讀 SendLog
 * @returns {boolean}
 */
function isVersionNoticeSent_(quarterId, versionNo, sendLogRows) {
  if (!quarterId || versionNo === undefined || versionNo === null) return false;
  const C = COLUMNS.SEND_LOG;
  if (!sendLogRows) {
    // 連 SendLog 工作表都未建立 ⇒ 從來冇寄過任何嘢；其他讀取失敗唔吞，照樣拋出（唔可以靜靜當成「未寄」）
    if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG)) return false;
  }
  return (sendLogRows || readSheet(SHEETS.SEND_LOG)).some(function (row) {
    if (String(row[C.QUARTER_ID] || '').trim() !== quarterId) return false;
    if (Number(row[C.VERSION_NO]) !== Number(versionNo)) return false;
    const stage = String(row[C.STAGE] || '').trim();
    if (stage !== MAIL_STAGES.OFFICIAL && stage !== MAIL_STAGES.RESEND) return false;
    return isNoticeReceivedRecord_({ status: String(row[C.STATUS] || '').trim() });
  });
}

/* ═════════════════════════════════════════════════════════════════════
 * 第七十五輪批次 CC 組：每週標題（放喺 SheetReader.gs：全部測試同入口都會載入呢個檔）
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 第七十五輪批次 CC 組：**每週標題可以喺職事表直接改。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 嘅決定
 * ═════════════════════════════════════════════════════════════════════
 *
 * 「確認特別主日」可唔可以拿走？崗位跟職事表，未有就由幹事喺介面填；
 * 喺介面都可以改嗰一週嘅標題（浸禮崇拜、堂慶……），少一個功能，易用易學。
 *
 * 所以：特別主日預設關閉（`SPECIAL_SUNDAYS_ENABLED`），而職事表工作表嘅「類型」欄
 *（現時寫「主日崇拜」）由幹事直接改。〔儲存〕時：
 *
 *   ・「類型」欄同預期唔同 ⇒ 算一項改動（出現喺「你改了這 N 格」）
 *   ・寫入 `ServiceDates.Title`（空白 ＝ 預設；改返預設 ⇒ 清空）
 *   ・之後每一版職事表、公開職事表、個人 PDF、個人頁都用呢個標題
 *
 * ⚠️ 「預期」＝ 呢一週而家應該顯示乜（`Title` 有值就係佢，否則 `ServiceType`
 *（＋特別主日名稱，如果仲開住））。比對嘅係**顯示文字**，同人手改動偵測
 *「渲染再比對」係同一個做法（第二十輪 A2）。
 *
 * ⚠️ 舊版本嘅工作表唔會改——佢哋嘅「類型」欄保留當時顯示嘅標題。
 *「用某一版作起點」（CH 組）會連「類型」欄一齊抄，所以儲存時標題會跟返嗰一版。
 */

/** 職事表工作表「類型」欄嘅位置（第 3 欄；第 1 欄日期、第 2 欄週次）。 */
const WEEK_TITLE_GRID_COLUMN = 3;

/**
 * 呢一季每週嘅自訂標題 `{yyyy-MM-dd: Title}`（只含有值嘅週）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>}
 */
function buildWeekTitleIndex_(quarterId, timezone) {
  const S = COLUMNS.SERVICE_DATES;
  const index = {};
  readServiceDates(quarterId).forEach(function (row) {
    const title = String(row[S.TITLE] === undefined || row[S.TITLE] === null ? '' : row[S.TITLE]).trim();
    if (!title) return;
    const d = toDateString(row[S.SERVICE_DATE], timezone);
    if (d) index[d] = title;
  });
  return index;
}

/**
 * 「類型」欄應該顯示嘅文字。純函式。
 * @param {*} serviceType `ServiceDates.ServiceType`
 * @param {string=} specialTitle 特別主日名稱（關咗就係空）
 * @param {string=} weekTitle `ServiceDates.Title`
 * @returns {string}
 */
function resolveWeekTypeText_(serviceType, specialTitle, weekTitle) {
  const t = String(weekTitle || '').trim();
  return t || describeServiceType_(serviceType, specialTitle);
}

/**
 * 每一週「類型」欄應該顯示嘅文字 `{yyyy-MM-dd: 文字}`。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>}
 */
function buildTypeTextByDate_(quarterId, timezone) {
  const S = COLUMNS.SERVICE_DATES;
  const specialTitles = buildSpecialSundayTitleIndex_(quarterId, timezone);
  const out = {};
  readServiceDates(quarterId).forEach(function (row) {
    const d = toDateString(row[S.SERVICE_DATE], timezone);
    if (!d) return;
    out[d] = resolveWeekTypeText_(row[S.SERVICE_TYPE], specialTitles[d], row[S.TITLE]);
  });
  return out;
}

/**
 * 公開職事表／個人頁／匯入表嗰種「日期下面寫一行標題」用嘅索引：
 * 特別主日名稱（開住先有）再由每週自訂標題蓋過。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>}
 */
function buildDisplayTitleIndex_(quarterId, timezone) {
  const merged = Object.assign({}, buildSpecialSundayTitleIndex_(quarterId, timezone));
  const weekTitles = buildWeekTitleIndex_(quarterId, timezone);
  Object.keys(weekTitles).forEach(function (d) { merged[d] = weekTitles[d]; });
  return merged;
}

/**
 * 讀職事表工作表嘅「類型」欄 `{yyyy-MM-dd: 文字}`。
 * @param {string} sheetName 工作表名
 * @param {string} timezone 時區
 * @returns {Object.<string, string>}
 */
function readGridTypeColumn_(sheetName, timezone) {
  // ⚠️ 讀唔到「類型」欄唔可以令整個 context 建唔到（人手改動偵測仲要照做）——
  // 工作表本身唔見咗嘅話，`readGridPersonIds_()` 已經會大聲拋錯。呢度只係少咗標題偵測，記 WARN。
  try {
    return readGridTypeColumnUnsafe_(sheetName, timezone);
  } catch (err) {
    log_('WARN', 'readGridTypeColumn_ 讀不到「類型」欄（每週標題改動這次偵測不到）：' + err.message);
    return {};
  }
}

/**
 * `readGridTypeColumn_()` 嘅本體（會拋錯）。
 * @param {string} sheetName 工作表名
 * @param {string} timezone 時區
 * @returns {Object.<string, string>}
 */
function readGridTypeColumnUnsafe_(sheetName, timezone) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return {};
  const keys = sheet.getRange(2, 1, 1, WEEK_TITLE_GRID_COLUMN).getValues()[0];
  // ⚠️ 用第 2 行機器鍵確認第 3 欄真係「類型」，唔係靠位置估。
  if (String(keys[WEEK_TITLE_GRID_COLUMN - 1] || '').trim() !== GRID_KEYS.TYPE) return {};
  const values = sheet.getRange(3, 1, lastRow - 2, WEEK_TITLE_GRID_COLUMN).getValues();
  const out = {};
  values.forEach(function (row) {
    const d = toDateString(row[0], timezone);
    if (d) out[d] = String(row[WEEK_TITLE_GRID_COLUMN - 1] === null || row[WEEK_TITLE_GRID_COLUMN - 1] === undefined
      ? '' : row[WEEK_TITLE_GRID_COLUMN - 1]).trim();
  });
  return out;
}

/**
 * 「類型」欄有冇被改過。**純運算**（資料由 `buildFineTuneContext_()` 放好）。
 *
 * `context.gridTypeValues` 冇 ⇒ 呢個 context 冇讀 grid（例如 `skipGrid`）⇒ 冇改動。
 * 有 grid 但冇 `context.gridRender.typeTextByDate` ⇒ **拋錯**：唔知預期係乜就唔可以靜靜當冇改。
 * @param {Object} context fine-tune context
 * @returns {Object[]} 每項 `{serviceDate, fromTitle, toTitle}`
 */
function detectWeekTitleChanges_(context) {
  const grid = context && context.gridTypeValues;
  if (!grid || Object.keys(grid).length === 0) return [];
  const expected = context.gridRender && context.gridRender.typeTextByDate;
  if (!expected) {
    throw new Error('偵測每週標題改動需要 `context.gridRender.typeTextByDate`（每週「類型」欄本來應該顯示乜）。'
      + '用 `buildGridRenderContext_()` 產生，不要自己拼。');
  }
  const out = [];
  Object.keys(grid).sort().forEach(function (d) {
    if (!Object.prototype.hasOwnProperty.call(expected, d)) return;   // 唔係呢一季嘅日期
    const now = String(grid[d] || '').trim();
    const want = String(expected[d] || '').trim();
    if (now !== want) out.push({ serviceDate: d, fromTitle: want, toTitle: now });
  });
  return out;
}

/**
 * 確保 `ServiceDates` 有「Title」一欄（第 1 行中文標題、第 2 行機器鍵）。冇就加喺最尾。
 * @param {Sheet} sheet ServiceDates 工作表
 * @returns {number} 「Title」欄嘅欄號（1-based）
 */
function ensureServiceDatesTitleColumn_(sheet) {
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const at = keys.indexOf(COLUMNS.SERVICE_DATES.TITLE);
  if (at !== -1) return at + 1;
  const col = lastCol + 1;
  sheet.getRange(1, col).setValue('每週標題（空白＝預設）');
  sheet.getRange(2, col).setValue(COLUMNS.SERVICE_DATES.TITLE);
  return col;
}

/**
 * 把「類型」欄嘅改動寫入 `ServiceDates.Title`。**會寫入**（逐週寫 AuditLog）。
 *
 * 改成同預設（`ServiceType`＋特別主日名稱）一樣 ⇒ 清空 Title（即係「改返預設」）。
 * 改成空白 ⇒ 都係清空（「類型」欄唔可以冇字——下一版會顯示預設）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} titleChanges `detectWeekTitleChanges_()` 嘅結果
 * @param {string} timezone 時區
 * @param {string} source 呼叫者（AuditLog）
 * @returns {number} 寫咗幾多週
 */
function writeWeekTitles_(quarterId, titleChanges, timezone, source) {
  if (!titleChanges || titleChanges.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERVICE_DATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SERVICE_DATES);
  const titleCol = ensureServiceDatesTitleColumn_(sheet);
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const S = COLUMNS.SERVICE_DATES;
  const qCol = keys.indexOf(S.QUARTER_ID);
  const dCol = keys.indexOf(S.SERVICE_DATE);
  const tCol = keys.indexOf(S.SERVICE_TYPE);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const specialTitles = buildSpecialSundayTitleIndex_(quarterId, timezone);
  const byDate = {};
  titleChanges.forEach(function (c) { byDate[c.serviceDate] = c; });

  let written = 0;
  values.forEach(function (row, i) {
    if (String(row[qCol] || '').trim() !== quarterId) return;
    const d = toDateString(row[dCol], timezone);
    const change = byDate[d];
    if (!change) return;
    const defaultText = describeServiceType_(row[tCol], specialTitles[d]);
    const newTitle = (change.toTitle === '' || change.toTitle === defaultText) ? '' : change.toTitle;
    sheet.getRange(i + 3, titleCol).setValue(newTitle);
    written++;
    writeAuditLog_({
      action: 'WEEK_TITLE_CHANGED',
      targetSheet: SHEETS.SERVICE_DATES,
      targetKey: quarterId + '|' + d,
      oldValue: change.fromTitle,
      newValue: newTitle || ('（預設）' + defaultText),
      source: source || 'writeWeekTitles_',
      notes: '幹事在職事表「類型」欄改了每週標題'
    });
  });
  return written;
}

/** 「類型」欄改動喺逐格清單入面用嘅假崗位鍵（唔會撞到任何真崗位 ID）。 */
const WEEK_TITLE_POST_KEY = '__TITLE__';
/** 「類型」欄改動喺清單入面顯示嘅名。 */
const WEEK_TITLE_LABEL_TC = '類型（每週標題）';

/**
 * 把標題改動砌成「你改了這 N 格」清單嘅行（三個畫面三種欄名都填齊）。
 * @param {Object[]} titleChanges `detectWeekTitleChanges_()` 嘅結果
 * @returns {Object[]}
 */
function buildWeekTitleChangeRows_(titleChanges) {
  return (titleChanges || []).map(function (c) {
    return {
      serviceDate: c.serviceDate,
      postId: WEEK_TITLE_POST_KEY,
      postNameTC: WEEK_TITLE_LABEL_TC,
      slotIndex: 1,
      isTitle: true,
      originalName: c.fromTitle || '（空白）',
      manualName: c.toTitle || '（空白，改回預設）',
      fromName: c.fromTitle || '（空白）',
      toName: c.toTitle || '（空白，改回預設）',
      source: 'MANUAL'
    };
  });
}

/**
 * 第七十四輪批次 BC 組：grid 文字係咪「幹事填咗人」（唔係空白、唔係佔位文字）。
 * 佔位文字用 `GRID_PLACEHOLDER_TEXTS`、`GRID_LABELS.PENDING`、`GRID_LABELS.GAP`——同寫 grid 嗰邊同一份。
 * @param {*} value 儲存格值
 * @returns {boolean}
 */
function isGridCellFilledByPerson_(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return false;
  if (GRID_PLACEHOLDER_TEXTS.indexOf(text) !== -1) return false;
  if (text === GRID_LABELS.PENDING || text === GRID_LABELS.GAP) return false;
  // 第七十五輪批次 CD 組：開季前準備而家照工作表計——Config 可改嘅四個顯示標籤
  //（待填／不設／特殊主日／未能安排）都唔係人名。
  try {
    const labels = readGridCellLabels_();
    if ([labels.pending, labels.na, labels.specialSkip, labels.gap].indexOf(text) !== -1) return false;
  } catch (err) { /* 讀唔到 Config ⇒ 只靠上面兩道 */ }
  return true;
}

/**
 * 第七十四輪批次 BC 組：讀最新版本 grid 工作表上，講員／翻譯／獻花**已經有人名**嘅格子。
 * 只喺「已通知過人嘅版本」用（呢啲格只寫咗工作表，未寫入 `RosterAssignments`，要撳
 * 〔儲存及寄出〕先成為新一版）。純讀取；工作表唔存在 ⇒ 空物件。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string[]} postIds 要讀嘅崗位 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>} `yyyy-MM-dd|postId|slotIndex` → 工作表上嘅文字
 */
function readGridFilledManualCells_(quarterId, versionNo, postIds, timezone) {
  const out = {};
  const gridSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(buildRosterSheetName_(quarterId, versionNo));
  if (!gridSheet) return out;
  const lastRow = gridSheet.getLastRow();
  const lastCol = gridSheet.getLastColumn();
  if (lastRow < 3 || lastCol < 1) return out;
  const keys = gridSheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const body = gridSheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  body.forEach(function (row) {
    const date = toDateString(row[0], timezone);
    if (!date) return;
    keys.forEach(function (key, ci) {
      const m = /^(.+)#(\d+)$/.exec(String(key || ''));
      if (!m || postIds.indexOf(m[1]) === -1) return;
      if (!isGridCellFilledByPerson_(row[ci])) return;
      out[date + '|' + m[1] + '|' + Number(m[2])] = String(row[ci]).trim();
    });
  });
  return out;
}

/* ═════════════════════════════════════════════════════════════════════
 * 第七十五輪批次 CE／CF 組：逐格決定（讀）
 * ═════════════════════════════════════════════════════════════════════
 *
 * 寫入喺 `CellDecisions.gs`（`apiSetCellDecisions()`）。讀放喺呢度：檢查、調整、儲存、
 * 寄出都要用，而全部入口都會載入 SheetReader.gs。
 */

/**
 * 正規化格內文字（決定有冇失效就係比呢個）。同人手改動偵測同一個規則（`normalizeCellText_()`）。
 * @param {*} text 格內文字
 * @returns {string}
 */
function normalizeDecisionText_(text) {
  const t = String(text === null || text === undefined ? '' : text).trim();
  return GRID_PLACEHOLDER_TEXTS.indexOf(t) === -1 ? t : '';
}

/**
 * 讀一季**生效中**嘅逐格決定。冇 `CellDecisions` 工作表 ⇒ 空（未有人勾過）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object[]} 每項 `{key, serviceDate, postId, slotIndex, kind, cellText, ruleId}`
 */
function readActiveCellDecisions_(quarterId, timezone) {
  let exists = false;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    exists = !!(ss && ss.getSheetByName && ss.getSheetByName(SHEETS.CELL_DECISIONS));
  } catch (err) {
    exists = false;
  }
  if (!exists) return [];
  const D = COLUMNS.CELL_DECISIONS;
  return readSheet(SHEETS.CELL_DECISIONS).filter(function (row) {
    return String(row[D.QUARTER_ID] || '').trim() === quarterId
      && String(row[D.STATUS] || '').trim() === CELL_DECISION_STATUS.ACTIVE;
  }).map(function (row) {
    const serviceDate = toDateString(row[D.SERVICE_DATE], timezone);
    const postId = String(row[D.POST_ID] || '').trim();
    const slotIndex = Number(row[D.SLOT_INDEX]) || 1;
    return {
      key: serviceDate + '|' + postId + '|' + slotIndex,
      serviceDate: serviceDate, postId: postId, slotIndex: slotIndex,
      kind: String(row[D.KIND] || '').trim(),
      cellText: normalizeDecisionText_(row[D.CELL_TEXT]),
      ruleId: String(row[D.RULE_ID] || '').trim()
    };
  });
}

/**
 * 逐格決定索引。`isKept(key, text)`／`isTempHelper(key, text)`：**格內而家嘅文字要同決定嗰陣一樣**先算數。
 * @param {Object[]} decisions `readActiveCellDecisions_()` 嘅結果
 * @returns {{isKept: function(string, string): boolean, isTempHelper: function(string, string): boolean, list: Object[]}}
 */
function buildCellDecisionIndex_(decisions) {
  const byKind = {};
  (decisions || []).forEach(function (d) {
    byKind[d.kind + '§' + d.key] = d.cellText;
  });
  const match = function (kind, key, text) {
    const k = kind + '§' + key;
    return Object.prototype.hasOwnProperty.call(byKind, k)
      && byKind[k] === normalizeDecisionText_(text);
  };
  return {
    list: decisions || [],
    isKept: function (key, text) { return match(CELL_DECISION_KIND.KEEP, key, text); },
    isTempHelper: function (key, text) { return match(CELL_DECISION_KIND.TEMP_HELPER, key, text); }
  };
}

/**
 * 讀一季嘅決定索引（讀唔到 ⇒ 空索引＋WARN；**唔可以當成「全部已決定」**）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object} `buildCellDecisionIndex_()` 嘅結果
 */
function readCellDecisionIndex_(quarterId, timezone) {
  try {
    return buildCellDecisionIndex_(readActiveCellDecisions_(quarterId, timezone));
  } catch (err) {
    log_('WARN', 'readCellDecisionIndex_ 讀不到逐格決定，全部當未決定：' + err.message);
    return buildCellDecisionIndex_([]);
  }
}

/**
 * 某一格職事表上而家嘅文字（決定比對用）。`context.gridValues` 冇嗰格 ⇒ 用版本紀錄嘅名。
 * @param {Object} context fine-tune context
 * @param {string} key `date|post|slot`
 * @returns {string}
 */
function currentCellTextForDecision_(context, key) {
  if (context && context.gridValues && Object.prototype.hasOwnProperty.call(context.gridValues, key)) {
    return normalizeDecisionText_(context.gridValues[key]);
  }
  const a = ((context && context.original) || []).filter(function (o) {
    return o.serviceDate + '|' + o.postId + '|' + o.slotIndex === key;
  })[0];
  return a ? normalizeDecisionText_(a.personName) : '';
}

/**
 * 第七十五輪批次 CE／CF 組：把「認唔出嘅名」同「違反規則嘅格」砌成逐格決定項目。
 *
 * ⚠️ 三個畫面（檢查我的改動、儲存、請系統幫我調整）一定要用同一份——
 * 否則一個畫面話「已確認」，另一個話「未決定」。
 *
 * @param {Object} context fine-tune context
 * @param {Object[]} unresolved overlay 嘅 unresolved
 * @param {Object[]} violations 違反（HARD＋SEMI_HARD；結構性不適用會略過）
 * @param {Object} decisionIndex `buildCellDecisionIndex_()`
 * @param {?Object} releaseContext `buildHardViolationClassContext_()`（讀唔到 ⇒ null，當冇放行）
 * @returns {{names: Object[], rules: Object[]}}
 */
function buildDecisionItems_(context, unresolved, violations, decisionIndex, releaseContext) {
  const postNameById = {};
  (context.posts || []).forEach(function (p) { postNameById[p.postId] = p.postNameTC; });
  const names = (unresolved || []).map(function (u) {
    const key = u.serviceDate + '|' + u.postId + '|' + u.slotIndex;
    const text = normalizeDecisionText_(u.text);
    return {
      kind: CELL_DECISION_KIND.TEMP_HELPER, key: key,
      serviceDate: u.serviceDate, postId: u.postId, postNameTC: postNameById[u.postId] || u.postId,
      slotIndex: u.slotIndex, cellText: text, text: text, expectedText: u.expectedText || '',
      checked: decisionIndex.isTempHelper(key, text)
    };
  });
  const rules = [];
  const seen = {};
  (violations || []).forEach(function (v) {
    if (v.severity !== RULE_LEVELS.HARD && v.severity !== RULE_LEVELS.SEMI_HARD) return;
    if (STRUCTURAL_NA_RULE_IDS.indexOf(v.ruleId) !== -1) return;
    const key = v.serviceDate + '|' + v.postId + '|' + v.slotIndex;
    const dedupe = key + '§' + v.ruleId;
    if (seen[dedupe]) return;
    seen[dedupe] = true;
    const cellText = currentCellTextForDecision_(context, key);
    let released = null;
    if (v.severity === RULE_LEVELS.HARD && releaseContext) {
      try {
        const c = classifyHardViolations_([v], releaseContext);
        released = c.released.length > 0 ? c.released[0]
          : (c.lateUnavailable.length > 0 ? c.lateUnavailable[0] : null);
      } catch (err) {
        released = null;
      }
    }
    rules.push({
      kind: CELL_DECISION_KIND.KEEP, key: key,
      serviceDate: v.serviceDate, postId: v.postId,
      postNameTC: v.postNameTC || postNameById[v.postId] || v.postId,
      slotIndex: v.slotIndex, personId: v.personId || '', personName: v.personName || cellText,
      cellText: cellText, ruleId: v.ruleId, severity: v.severity,
      mustFollow: v.severity === RULE_LEVELS.HARD, reason: v.reason || '',
      released: !!released,
      releasedVersionNo: (released && released.releasedVersionNo !== undefined) ? released.releasedVersionNo : null,
      checked: !released && decisionIndex.isKept(key, cellText),
      violation: v
    });
  });
  return { names: names, rules: rules };
}

/**
 * 逐格決定項目送去前端嘅形狀（唔帶內部嘅 `violation` 物件）。
 * @param {Object} item `buildDecisionItems_()` 嘅一項
 * @returns {Object}
 */
function publicDecisionItem_(item) {
  const out = {};
  Object.keys(item).forEach(function (k) { if (k !== 'violation') out[k] = item[k]; });
  return out;
}

/* 第七十五輪批次 CH 組：〔用這一版作起點〕嘅 AuditLog 標記（寫：`WebAppRollback.gs`；讀：儲存）。 */
/** AuditLog「以舊版本作起點」標記嘅 action。TargetKey＝季度、OldValue＝寫入時最新版本號、NewValue＝起點版本號。 */
const VERSION_START_POINT_ACTION = 'VERSION_START_POINT';

/**
 * 儲存嗰陣：最新一版（`baseVersionNo`）之上有冇「以第 M 版作起點」。
 * 只認**最後一個**而且係喺 `baseVersionNo` 之上寫嘅標記——之後有任何新版本，
 * 基準版本號就唔同，舊標記自然唔再算。
 * @param {Array[]} auditRows `readSheet(SHEETS.AUDIT_LOG)`
 * @param {string} quarterId 季度 ID
 * @param {number} baseVersionNo 儲存時嘅基準版本
 * @returns {?number} 起點版本號；冇就 null
 */
function findStartPointForSave_(auditRows, quarterId, baseVersionNo) {
  const C = COLUMNS.AUDIT_LOG;
  let found = null;
  (auditRows || []).forEach(function (r) {
    if (String(r[C.ACTION] || '') !== VERSION_START_POINT_ACTION) return;
    if (String(r[C.TARGET_KEY] || '').trim() !== quarterId) return;
    if (Number(r[C.OLD_VALUE]) !== Number(baseVersionNo)) return;
    const m = Number(r[C.NEW_VALUE]);
    if (!isNaN(m)) found = m;
  });
  return found;
}

/**
 * 儲存用嘅來源文字：有起點 ⇒「以第 M 版作起點」；冇 ⇒ null（照用 `BASIS_FINE_TUNE`）。
 * 讀唔到 AuditLog 唔可以令儲存失敗 ⇒ WARN、當冇。
 * @param {string} quarterId 季度 ID
 * @param {number} baseVersionNo 基準版本
 * @returns {?string}
 */
function readStartPointBasisForSave_(quarterId, baseVersionNo) {
  try {
    const m = findStartPointForSave_(readSheet(SHEETS.AUDIT_LOG), quarterId, baseVersionNo);
    return m === null ? null : '以第 ' + m + ' 版作起點';
  } catch (err) {
    log_('WARN', 'readStartPointBasisForSave_ 讀不到 AuditLog：' + err.message);
    return null;
  }
}

/**
 * 第七十五輪批次 CP 組：PersonID → 中文名（唯讀；確認清單用）。讀唔到就回空物件、記 WARN。
 * @returns {Object.<string, string>}
 */
function readPersonNameIndex_() {
  const out = {};
  try {
    const N = COLUMNS.NAME_MAPPING;
    readSheet(SHEETS.NAME_MAPPING).forEach(function (r) {
      const id = String(r[N.PERSON_ID] || '').trim();
      if (id) out[id] = String(r[N.NAME_TC] || '').trim();
    });
  } catch (err) {
    log_('WARN', 'readPersonNameIndex_ 讀不到人員名單：' + err.message);
  }
  return out;
}

/**
 * 第七十五輪批次 CP 組：AuditLog 入面「重設季度測試資料」嘅 Action（`executeQuarterReset_()` 寫）。
 * 呢一行就係「放行失效」嘅標記。
 */
const QUARTER_RESET_AUDIT_ACTION = '重設季度測試資料';

/**
 * 呢一季**最後一次**重設喺 AuditLog 第幾行（陣列索引）；冇重設過 ⇒ -1。
 * AuditLog 只會加、唔會改，行嘅次序就係時間次序。
 * @param {Array[]} auditRows `readSheet(SHEETS.AUDIT_LOG)`
 * @param {string} quarterId 季度 ID
 * @returns {number}
 */
function lastQuarterResetAuditIndex_(auditRows, quarterId) {
  const C = COLUMNS.AUDIT_LOG;
  let at = -1;
  (auditRows || []).forEach(function (row, i) {
    if (String(row[C.ACTION] || '') === QUARTER_RESET_AUDIT_ACTION
      && String(row[C.TARGET_KEY] || '').trim() === quarterId) at = i;
  });
  return at;
}
