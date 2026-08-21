/**
 * 建立職事表 grid 工作表 Roster_{quarterId}_v{versionNo}。
 * 第 1 行為中文標題、第 2 行為隱藏的機器鍵、第 3 行起每個主日一行，
 * 末段附上每人本季服侍次數統計。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} assignments performRosterGeneration_() 產生的派工結果
 * @param {Object[]} warnings performRosterGeneration_() 產生的警告清單
 * @returns {string} 建立的工作表名稱
 */
function createRosterSheet(quarterId, versionNo, assignments, warnings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = buildRosterSheetName_(quarterId, versionNo);

  const existing = ss.getSheetByName(sheetName);
  if (existing) {
    throw new Error('工作表 ' + sheetName + ' 已存在，請先刪除或改用新的版本號');
  }
  const sheet = ss.insertSheet(sheetName);

  const layout = buildGridLayout_(quarterId, assignments);
  const warningIndex = indexWarnings_(warnings);

  // 第 1 行中文標題、第 2 行機器鍵
  sheet.getRange(1, 1, 1, layout.headers.length).setValues([layout.headers]);
  sheet.getRange(2, 1, 1, layout.keys.length).setValues([layout.keys]);
  // 標題設為自動換行：欄位在 PDF 被縮窄時，文字會往下折行而不是被裁掉或溢出到隔壁欄
  sheet.getRange(1, 1, 1, layout.headers.length)
    .setFontWeight('bold')
    .setBackground(GRID_COLORS.HEADER)
    .setWrap(true)
    .setVerticalAlignment('middle');

  log_('INFO', 'createRosterSheet 標題陣列：' + JSON.stringify(layout.headers));

  // 第 3 行起：每個主日一行
  if (layout.rows.length > 0) {
    sheet.getRange(3, 1, layout.rows.length, layout.keys.length).setValues(layout.rows);
  }

  applyCellMarks_(sheet, layout, warningIndex);
  // 第十輪批次階段 A2：圖例排喺統計之前——PDF 由上而下讀，睇完表就即刻見到
  // 每個標示係咩意思，唔使揭到最後。回傳實際用咗幾多行，令統計區跟住浮動。
  const legendRowCount = writeLegendSection_(sheet, layout);
  writeStatsSection_(sheet, layout, assignments, legendRowCount);

  sheet.hideRows(2);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, layout.keys.length);
  applyGridColumnWidthsForA4_(sheet, layout);

  // ⚠️ 第四十一輪批次 A 組：**每一張新的 grid 都自動有名單下拉選單。**
  //
  // 原本這是主流程第 3 步，要幹事自己撳一粒掣。Ivan 實測之後講明：
  // 「我想『生成』自動做這一步。每一個編輯過的版本都應該有這個下拉選單。」
  //
  // 掛在這裡（而不是在五條建立版本的路各自加一次）是刻意的：
  // 這個函式是那五條路唯一的匯合點——生成初稿、套用申報、
  // 人手改動、套用微調決定、回到上一個版本，五條都經過這裡。
  // 掛在這裡，之後任何一條新加的路都自動有，不用記得。
  // 逐條路各加一次，就一定會有一條忘記——那是本專案反覆出事的形狀。
  //
  // ⚠️ 失敗不可以令整個建立版本失敗。選單是輔助，職事表本身才是主體。
  // 但也不可以靜靜失敗——幹事會以為有選單，開了表卻沒有，
  // 然後以為是自己看錯。所以失敗要寫 log，而且交給呼叫端。
  let dropdownResult = null;
  try {
    dropdownResult = applyGridNameDropdowns_(quarterId, versionNo);
  } catch (err) {
    log_('WARN', 'createRosterSheet：名單下拉選單套用不到（職事表本身已經建立好）：'
      + err.message);
    dropdownResult = { failed: true, error: err.message, columns: [], skipped: [] };
  }
  // 呼叫端要拿得到就讀這一個。回傳值維持是工作表名稱——
  // 改回傳形狀會影響五條路，不值得。
  createRosterSheet.lastDropdownResult = dropdownResult;

  return sheetName;
}

/**
 * 組出職事表 grid 工作表的名稱。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {string} 工作表名稱，例如 "Roster_2026T4_v0"
 */
function buildRosterSheetName_(quarterId, versionNo) {
  return SHEET_PREFIXES.ROSTER + quarterId + '_v' + versionNo;
}

/**
 * 依派工結果排出 grid 的欄位結構與資料列。
 * 欄位順序：日期 / 週次 / 類型，之後每個崗位的每個 slot 各一欄（依 DisplayOrder）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} assignments 派工結果
 * @returns {{headers: string[], keys: string[], rows: Array[], dates: Object[], cellIndex: Object}}
 *   headers 為中文標題、keys 為機器鍵、rows 為資料列、cellIndex 為 "date|postId|slot" 對應欄號
 */
function buildGridLayout_(quarterId, assignments) {
  const posts = readPosts();
  const serviceDates = readServiceDates(quarterId);
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const labels = readGridCellLabels_();
  const pendingLabel = labels.pending;
  const naLabel = labels.na;

  const specialSkipLabel = labels.specialSkip;
  // 第十輪批次階段 A3：對照教會現行人手製作的職事表——特別主日會喺日期下面
  // 註明（「浸禮」「堂慶合堂」「宣教月」），堂委一眼就知道嗰一週唔同。
  // 系統原本只顯示 ServiceDates.ServiceType（例如「主日崇拜」），
  // SpecialSundays.Title 完全冇出現喺表上。呢度把 Title 併入「類型」欄，
  // 唔另開新欄——新開欄會令全部「第 4 欄起先係崗位」嘅假設要逐處覆核，
  // 而「類型」欄本身就喺日期隔籬，位置同人手版一樣。
  const specialTitleByDate = buildSpecialSundayTitleIndex_(quarterId, timezone);
  // 第十四輪批次階段 D：對照教會現行人手職事表——被跳過嘅格子唔係淨係寫
  // 「特殊主日」呢句通用字，而係直接寫邊個單位負責（例如「英語堂」
  // 「華語堂」），見 buildSpecialSundayExternalOwnerIndex_() 檔頭說明。
  const externalOwnerByDate = buildSpecialSundayExternalOwnerIndex_(quarterId, timezone);
  const headers = [GRID_LABELS.DATE, GRID_LABELS.WEEK, GRID_LABELS.TYPE];
  const keys = [GRID_KEYS.DATE, GRID_KEYS.WEEK, GRID_KEYS.TYPE];
  const cellIndex = {};
  const emptyDisplayByPostId = {};

  posts.forEach(function (post) {
    emptyDisplayByPostId[post[COLUMNS.POSTS.POST_ID]] = post[COLUMNS.POSTS.EMPTY_DISPLAY];
  });

  posts.forEach(function (post) {
    const slotCount = Number(post[COLUMNS.POSTS.SLOT_COUNT]) || 1;
    for (let slot = 1; slot <= slotCount; slot++) {
      // 編號與崗位名之間不加空格：PDF 的窄欄會在空格處換行，
      // 令「聖餐襄禮 1」拆成兩行，看起來像編號錯位到下一欄。
      const label = slotCount > 1
        ? post[COLUMNS.POSTS.POST_NAME_TC] + slot
        : post[COLUMNS.POSTS.POST_NAME_TC];
      headers.push(label);
      keys.push(post[COLUMNS.POSTS.POST_ID] + '#' + slot);
    }
  });

  const dates = serviceDates
    .map(function (row) {
      return {
        serviceDate: toDateString(row[COLUMNS.SERVICE_DATES.SERVICE_DATE], timezone),
        weekIndex: Number(row[COLUMNS.SERVICE_DATES.WEEK_INDEX]),
        serviceType: row[COLUMNS.SERVICE_DATES.SERVICE_TYPE]
      };
    })
    .sort(function (a, b) { return a.weekIndex - b.weekIndex; });

  const assignmentIndex = {};
  assignments.forEach(function (a) {
    assignmentIndex[a.serviceDate + '|' + a.postId + '|' + a.slotIndex] = a;
  });

  const classCounts = {};
  Object.keys(GRID_CELL_CLASS).forEach(function (k) { classCounts[GRID_CELL_CLASS[k]] = 0; });

  const rows = dates.map(function (d, rowOffset) {
    const row = [d.serviceDate, d.weekIndex, describeServiceType_(d.serviceType, specialTitleByDate[d.serviceDate])];
    for (let c = 3; c < keys.length; c++) {
      const parts = keys[c].split('#');
      const key = d.serviceDate + '|' + parts[0] + '|' + parts[1];
      const assignment = assignmentIndex[key];
      const cellClass = classifyGridCell_(assignment);
      cellIndex[key] = {
        row: rowOffset + 3, column: c + 1, assignment: assignment, cellClass: cellClass
      };
      classCounts[cellClass]++;
      row.push(resolveGridCellText_(
        assignment, cellClass, emptyDisplayByPostId[parts[0]], labels, externalOwnerByDate[d.serviceDate]));
    }
    return row;
  });

  return {
    headers: headers, keys: keys, rows: rows, dates: dates,
    cellIndex: cellIndex, classCounts: classCounts, labels: labels
  };
}

/**
 * 第十輪批次階段 A：讀齊四種留空格子的顯示文字，一次過讀完傳落去，
 * 避免逐格呼叫 `getConfig()`。全部可在 Config 調整，冇一個寫死。
 * @returns {{pending: string, na: string, specialSkip: string, gap: string}}
 */
function readGridCellLabels_() {
  return {
    pending: getConfig(CONFIG_KEYS.GRID_PENDING_LABEL, DEFAULTS.GRID_PENDING_LABEL),
    na: getConfig(CONFIG_KEYS.GRID_NOT_APPLICABLE_LABEL, DEFAULTS.GRID_NOT_APPLICABLE_LABEL),
    specialSkip: getConfig(CONFIG_KEYS.GRID_SPECIAL_SKIP_LABEL, DEFAULTS.GRID_SPECIAL_SKIP_LABEL),
    gap: getConfig(CONFIG_KEYS.GRID_GAP_LABEL, DEFAULTS.GRID_GAP_LABEL)
  };
}

/**
 * 第十輪批次階段 A：決定一格要顯示咩文字。分類本身由 `classifyGridCell_()`
 * （Generator.gs）負責，呢度淨係做「分類 → 文字」嘅對照，兩者職責分開。
 *
 * `MANUAL_PENDING` 仍然行返 `resolveEmptyDisplayText_()`，即係尊重
 * `Posts.EmptyDisplay` 逐個崗位嘅設定（PENDING／NA／BLANK）——有啲崗位
 * 幹事可能想佢完全空白，唔想見到「（待填）」。
 *
 * 第十四輪批次階段 D：`SPECIAL_SKIP` 優先用 `specialSkipText`（來自
 * `SpecialSundays.ExternalOwner`，例如「英語堂」「華語堂」）——對照教會
 * 現行人手職事表嘅做法，被跳過嘅格子直接寫邊個單位負責，比一句通用嘅
 * 「特殊主日」更有用（義工一睇就知道唔使自己搵人、亦知道去邊度問）。
 * `ExternalOwner` 冇填（幹事未填、或者呢個特別主日根本冇外部單位負責，
 * 例如純粹減少崗位、唔係轉俾另一堂）就退回原本嘅通用文字，行為同加呢個
 * 功能之前一致，唔強制要求填。
 *
 * @param {?Object} assignment 派工結果
 * @param {string} cellClass `classifyGridCell_()` 的結果
 * @param {string} emptyDisplay 該崗位的 Posts.EmptyDisplay 設定
 * @param {{pending: string, na: string, specialSkip: string, gap: string}} labels
 * @param {string=} specialSkipText 該主日嘅 `SpecialSundays.ExternalOwner`；
 *   留空就用 `labels.specialSkip`
 * @returns {string} 該格要顯示的文字
 */
function resolveGridCellText_(assignment, cellClass, emptyDisplay, labels, specialSkipText) {
  if (cellClass === GRID_CELL_CLASS.ASSIGNED) return (assignment && assignment.personName) || '';
  if (cellClass === GRID_CELL_CLASS.STRUCTURAL_NA) return labels.na;
  if (cellClass === GRID_CELL_CLASS.SPECIAL_SKIP) return String(specialSkipText || '').trim() || labels.specialSkip;
  if (cellClass === GRID_CELL_CLASS.GENUINE_GAP) return labels.gap;
  return resolveEmptyDisplayText_(emptyDisplay, labels.pending, labels.na);
}

/**
 * 第十輪批次階段 A3：建立「主日日期 → 特別主日名稱」對照，供「類型」欄註明。
 * 只取 Active=TRUE 的行；`Title` 空白時退回 `Type`，兩者都空白就當作冇特別安排。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>} {yyyy-MM-dd: 特別主日名稱}
 */
function buildSpecialSundayTitleIndex_(quarterId, timezone) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const index = {};
  readSpecialSundays(quarterId).forEach(function (row) {
    if (!isTrueValue_(row[S.ACTIVE])) return;
    const dateStr = toDateString(row[S.SERVICE_DATE], timezone);
    if (!dateStr) return;
    const title = String(row[S.TITLE] || '').trim() || String(row[S.TYPE] || '').trim();
    if (title) index[dateStr] = title;
  });
  return index;
}

/**
 * 第十四輪批次階段 D：建立「主日日期 → 外部負責單位」對照，供 `SPECIAL_SKIP`
 * 格子顯示用（見 `resolveGridCellText_()`）。
 *
 * 背景：`SpecialSundays.ExternalOwner` 呢個欄喺 schema 定義咗（見
 * `SpecialSundaysSeed.gs`），但之前全專案完全冇任何程式碼讀取——被跳過嘅
 * 格子一律顯示同一句通用文字（`GRID_SPECIAL_SKIP_LABEL`，預設「特殊主日」），
 * 完全冧唔到係邊個單位接手。對照教會現行人手職事表嘅做法，合堂週被跳過嘅
 * 格子會直接寫「英語堂」／「華語堂」（邊個單位負責），呢個資訊對義工嚟講
 * 比一句「特殊主日」更有用（唔使自己估、亦知道有疑問去邊度問）。
 *
 * 只取 `Active=TRUE` 嘅行；`ExternalOwner` 空白就唔加入索引（呼叫端
 * `resolveGridCellText_()` 會退回通用文字）——填唔填係人手決定，唔強制。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, string>} {yyyy-MM-dd: 外部負責單位文字}
 */
function buildSpecialSundayExternalOwnerIndex_(quarterId, timezone) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const index = {};
  readSpecialSundays(quarterId).forEach(function (row) {
    if (!isTrueValue_(row[S.ACTIVE])) return;
    const dateStr = toDateString(row[S.SERVICE_DATE], timezone);
    if (!dateStr) return;
    const owner = String(row[S.EXTERNAL_OWNER] || '').trim();
    if (owner) index[dateStr] = owner;
  });
  return index;
}

/**
 * 第十輪批次階段 A3：把「類型」欄組成「主日崇拜（浸禮）」這種寫法。
 * 冇特別安排就照舊淨係顯示 ServiceType，行為與加入呢個功能之前一致。
 * @param {*} serviceType ServiceDates.ServiceType 的原始值
 * @param {string=} specialTitle 該日的特別主日名稱
 * @returns {string} 「類型」欄要顯示的文字
 */
function describeServiceType_(serviceType, specialTitle) {
  const base = String(serviceType === null || serviceType === undefined ? '' : serviceType).trim();
  const special = String(specialTitle || '').trim();
  if (!special) return base;
  if (!base) return special;
  // 名稱本身已經包含 ServiceType 時唔重複（例如 Title 直接寫「主日崇拜（浸禮）」）
  if (special.indexOf(base) !== -1) return special;
  return base + '（' + special + '）';
}

/**
 * 判斷一個 SKIPPED 格是不是「結構性不適用」——該崗位在這一週根本不存在
 * （目前只有非首主日的聖餐襄禮，見 STRUCTURAL_NA_RULE_IDS），不是「崗位存在、
 * 只是留空待人手填」。這是顯示優先級最高的判斷，優先於 Posts.EmptyDisplay。
 * @param {Object} assignment 派工結果（含 ruleFlags 陣列）
 * @returns {boolean} 是否為結構性不適用
 */
function isStructuralNotApplicable_(assignment) {
  return (assignment.ruleFlags || []).some(function (id) {
    return STRUCTURAL_NA_RULE_IDS.indexOf(id) !== -1;
  });
}

/**
 * 階段 A 新增：判斷一個 SKIPPED 格是不是「因為特別主日而跳過」——這個崗位平常
 * 會自動生成，只是這一週被 SpecialSundays.SkipPostIDs 標記跳過（見
 * SPECIAL_SKIP_RULE_IDS），跟「這個崗位本來就永遠不自動生成」（講員／翻譯／
 * 獻花，走 resolveEmptyDisplayText_() 的一般 PENDING／NA／BLANK 判斷）是不同
 * 概念，顯示優先級低於 isStructuralNotApplicable_()、高於一般 EmptyDisplay 判斷。
 * @param {Object} assignment 派工結果（含 ruleFlags 陣列）
 * @returns {boolean} 是否為特別主日跳過
 */
function isSpecialSundaySkip_(assignment) {
  return (assignment.ruleFlags || []).some(function (id) {
    return SPECIAL_SKIP_RULE_IDS.indexOf(id) !== -1;
  });
}

/**
 * 決定「崗位存在但留空」的格子要顯示什麼文字，依 Posts.EmptyDisplay 欄的設定。
 * 供 buildGridLayout_()（grid 工作表——完整版／個人 highlight PDF 都是從這張
 * 工作表匯出，不需要另外處理）與 WebApp.gs 的 apiGetRosterGrid()（Web UI）共用，
 * 確保三處顯示邏輯一致。
 * @param {string} rawEmptyDisplay Posts.EmptyDisplay 欄的原始值
 * @param {string} pendingLabel Config 的 GRID_PENDING_LABEL
 * @param {string} naLabel Config 的 GRID_NOT_APPLICABLE_LABEL
 * @returns {string} 要顯示的文字
 */
function resolveEmptyDisplayText_(rawEmptyDisplay, pendingLabel, naLabel) {
  const value = String(rawEmptyDisplay || '').trim().toUpperCase();
  if (value === POST_EMPTY_DISPLAY.NA) return naLabel;
  if (value === POST_EMPTY_DISPLAY.BLANK) return '';
  return pendingLabel;
}

/**
 * 第十一輪批次階段 A／B 新增：把 `RosterAssignments` 長表某個版本的紀錄，
 * 轉換成 `buildGridLayout_()`／`classifyGridCell_()` 要的形狀
 * （`{serviceDate, postId, slotIndex, personId, personName, assignSource, ruleFlags}`，
 * `ruleFlags` 是陣列，不是逗號分隔字串）。
 *
 * 存在的理由：`createRosterSheet()` 當下用的是生成器剛產生、還在記憶體裡的
 * 陣列（`ruleFlags` 本來就是陣列）；但「發佈公開職事表」（`PublicRoster.gs`）
 * 與「個人專屬連結」（`WebAppPersonalLink.gs`）都是**事後**重新讀取已經寫入
 * 長表的某個版本，`RuleFlags` 這時已經被 `writeAssignments()` 序列化成字串，
 * 兩者形狀不同、不能直接傳給 `buildGridLayout_()`。這個函式只做一次轉換，
 * 供上述兩個新功能共用，不會各自重複一份轉換邏輯。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 轉換後的派工結果，可直接傳給 `buildGridLayout_()`
 */
function readVersionAssignmentsForGrid_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readSheet(SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        // ⚠️ 第三十六輪批次：**`serviceDateId` 本來冇帶出嚟。**
        //
        // `apiRollbackExecute()`（WebAppRollback.gs）用呢個函式攞目標版本
        // 嘅內容再 `writeAssignments()`，而佢寫 `serviceDateId: a.serviceDateId`
        // ——`undefined` ⇒ **回退建立嘅新版本，成版 ServiceDateID 全部空白**。
        // 實測（呢一輪嘅五路測試）：v3 十六格全部空白。
        //
        // 同 A 組、甲5 係同一個 class：建立新版本嗰陣冇被改動嘅嘢冇完整搬過去。
        // 呢個係第六個實例，而且係靠 C 組嗰條共用斷言先揪到
        //（本來只比四個欄位，加咗呢一個之後即刻紅）。
        serviceDateId: row[C.SERVICE_DATE_ID],
        serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID],
        slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID],
        personName: row[C.PERSON_NAME_SNAPSHOT] || '',
        assignSource: row[C.ASSIGN_SOURCE],
        ruleFlags: splitList_(row[C.RULE_FLAGS])
      };
    });
}

/**
 * 把警告清單整理成以 "date|postId|slot" 為鍵的索引，方便標示格子。
 * @param {Object[]} warnings 警告清單
 * @returns {Object.<string, Object[]>} 每格對應的警告陣列
 */
function indexWarnings_(warnings) {
  const index = {};
  (warnings || []).forEach(function (w) {
    const key = w.serviceDate + '|' + w.postId + '|' + w.slotIndex;
    if (!index[key]) index[key] = [];
    index[key].push(w);
  });
  return index;
}

/**
 * 為有警告或被略過的格子加上底色，並只在真正需要注意時加批註。
 *
 * 批註一律只來自 warnings。AutoGenerate=FALSE 與 FIRST_SUNDAY 這類「正常留空」
 * 的格只上灰底、不加批註 —— 因為 Google Sheets 的批註在匯出 PDF 時會變成頁尾註腳，
 * 幾十個「略過原因」會佔去大半篇幅。
 *
 * @param {Sheet} sheet 目標工作表
 * @param {Object} layout buildGridLayout_() 的結果
 * @param {Object.<string, Object[]>} warningIndex 警告索引
 * @returns {void}
 */
function applyCellMarks_(sheet, layout, warningIndex) {
  if (layout.rows.length === 0) return;

  const rowCount = layout.rows.length;
  const colCount = layout.keys.length;
  const backgrounds = [];
  const notes = [];
  for (let r = 0; r < rowCount; r++) {
    backgrounds.push(new Array(colCount).fill(null));
    notes.push(new Array(colCount).fill(''));
  }

  Object.keys(layout.cellIndex).forEach(function (key) {
    const cell = layout.cellIndex[key];
    const r = cell.row - 3;
    const c = cell.column - 1;
    const assignment = cell.assignment;
    const cellWarnings = warningIndex[key];

    const isForced = assignment && assignment.assignSource === ASSIGN_SOURCE.FORCED;
    // 第十輪批次階段 A：底色一律跟 classifyGridCell_() 的分類走，唔再自己
    // 判斷一次 assignSource／ruleFlags。cellClass 由 buildGridLayout_() 算好
    // 放喺 cellIndex，顯示文字同底色用同一個分類，唔會兩邊唔一致。
    const cellClass = cell.cellClass || classifyGridCell_(assignment);

    if (cellClass === GRID_CELL_CLASS.GENUINE_GAP) {
      // 「系統應該排但排唔出」——沿用「待補格」同一隻粉紅色。兩者語意本來就
      // 係同一件事（系統排唔到、要人手補），資料層訊號亦都一模一樣
      // （PersonID 空 + AssignSource=SKIPPED + RuleFlags 含 HARD_ELIGIBILITY），
      // 所以 listPendingBackfillCells_() 本來就會列到呢啲格。一種顏色一個意思。
      backgrounds[r][c] = getConfig(
        CONFIG_KEYS.GRID_PENDING_FILL_COLOR, DEFAULTS.GRID_PENDING_FILL_COLOR);
    } else if (cellClass === GRID_CELL_CLASS.SPECIAL_SKIP) {
      // 階段 A（第六輪）：特別主日跳過的格子用獨立底色，跟一般略過的灰底
      // 區分開，一眼就看得出「這一週不一樣」。
      backgrounds[r][c] = GRID_COLORS.SPECIAL_SKIP;
    } else if (cellClass === GRID_CELL_CLASS.STRUCTURAL_NA
      || cellClass === GRID_CELL_CLASS.MANUAL_PENDING) {
      backgrounds[r][c] = GRID_COLORS.SKIPPED;
    } else if (cellWarnings && cellWarnings.length > 0) {
      backgrounds[r][c] = isForced ? GRID_COLORS.FORCED : GRID_COLORS.WARNING;
    }

    // 只有真正的規則警告才加批註（例如某崗位完全沒有合資格人選）。
    // 正常留空的格即使有 ruleFlags 也不加，避免 PDF 產生大量註腳。
    if (cellWarnings && cellWarnings.length > 0) {
      notes[r][c] = cellWarnings.map(function (w) {
        return w.ruleId + ': ' + w.reason;
      }).join('\n');
    }
  });

  const range = sheet.getRange(3, 1, rowCount, colCount);
  range.setBackgrounds(backgrounds);
  range.setNotes(notes);
}

/**
 * 第十輪批次階段 A2：組出圖例的內容（純函式，不碰工作表，方便測試）。
 *
 * 每一行都附上「本季實際幾多格」——呢個數字對堂委特別有用：
 * 「未能安排：0 格」本身就係系統嘅賣點，而「（待填）：39 格」亦都即刻解釋咗
 * 點解表上有咁多空位（講員／翻譯／獻花 3 個崗位 × 13 週），
 * 唔會俾人誤會成「系統排唔到咁多格」。
 *
 * 刻意**全部五類都列出嚟**（包括 0 格嘅），唔係淨係列有出現嘅——
 * 圖例嘅作用係解釋整套標示方式，而「呢一類係 0 格」本身就係一項資訊。
 *
 * @param {Object} layout buildGridLayout_() 的結果（需要 classCounts 與 labels）
 * @returns {Array[]} 每項為 [標示, 意思, 格數文字]
 */
function buildLegendRows_(layout) {
  const counts = layout.classCounts || {};
  const labels = layout.labels || readGridCellLabels_();
  const countText = function (cls) { return (counts[cls] || 0) + ' 格'; };

  return [
    ['（姓名）', '系統自動安排，已排定人選', countText(GRID_CELL_CLASS.ASSIGNED)],
    [labels.pending, '此崗位不由系統自動安排（講員、翻譯、獻花），需要人手填寫',
      countText(GRID_CELL_CLASS.MANUAL_PENDING)],
    [labels.na, '這一週不設此崗位（例如聖餐襄禮只在每月第一個主日）',
      countText(GRID_CELL_CLASS.STRUCTURAL_NA)],
    [labels.specialSkip, '這一週有特別安排（見「類型」欄），此崗位不用系統安排',
      countText(GRID_CELL_CLASS.SPECIAL_SKIP)],
    [labels.gap, '系統找不到合資格而當日又有空的人，需要人手處理',
      countText(GRID_CELL_CLASS.GENUINE_GAP)]
  ];
}

/**
 * 第十二輪批次階段 A：把 `classifyGridCell_()` 的五種分類轉成公開/個人
 * 頁面要用的底色，供 `computePublicRosterBackgrounds_()` 與
 * `transposeRosterForPublicView_()` 共用同一套邏輯（一種分類一種顏色，
 * 唔會兩處各自維護一份對照、改一邊漏一邊）。
 * 刻意唔沿用 grid 工作表本身嘅底色邏輯（`applyCellMarks_()`）——嗰個會將
 * 「有人但觸發規則警告」畫成黃色／橙色，兩者都係診斷用途，唔應該出現喺
 * 對外公開嘅版本，見 `PublicRoster.gs` 檔頭說明。
 * @param {string} cellClass `classifyGridCell_()` 的結果
 * @param {string} gapColor 「排唔出」格要用嘅底色
 * @returns {?string} 底色；`ASSIGNED`（或未知分類）一律回傳 `null`（唔上色）
 */
function resolveGridCellBackground_(cellClass, gapColor) {
  if (cellClass === GRID_CELL_CLASS.GENUINE_GAP) return gapColor;
  if (cellClass === GRID_CELL_CLASS.SPECIAL_SKIP) return GRID_COLORS.SPECIAL_SKIP;
  if (cellClass === GRID_CELL_CLASS.STRUCTURAL_NA || cellClass === GRID_CELL_CLASS.MANUAL_PENDING) {
    return GRID_COLORS.SKIPPED;
  }
  return null;
}

/**
 * 第十三輪批次階段 A4【bug 修正】：把 "yyyy-MM-dd" 轉成公開/個人頁面日期
 * 標題要用嘅標籤，用可配置嘅樣板代入（`{M}`＝月、`{d}`＝日）。
 *
 * 實測發現：第十二輪批次原本淨係回傳一個純數字字串（例如 "3"），寫入
 * Google 試算表之後被自動判斷成數字格式，顯示做 "3.0"（浮點數）——
 * `setValues()` 收到睇落似數字嘅字串，Google 試算表會主動轉做數字型別
 * 儲存格，之後套用嘅預設數字格式可能帶小數位。改用帶中文字嘅樣板
 * （預設 `{M}月{d}日`，例如「1月3日」）令儲存格內容一定唔會被誤判做
 * 數字，同時比純數字對讀者更清楚（唔使抬頭對返上面嘅月份分組先知道
 * 邊一個月）。
 *
 * 刻意唔用 `Utilities.formatDate()`——嗰個要真正 GAS 環境，會令呢個
 * 函式冧唔到再係純函式，自己用簡單嘅 token 代入就夠（只需要月同日
 * 兩個數字，唔需要完整嘅日期格式化能力）。
 * @param {string} dateStr "yyyy-MM-dd"
 * @param {string=} pattern 樣板，支援 `{M}`／`{d}`；留空用
 *   `DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT`
 * @returns {string} 代入後嘅日期標籤
 */
function formatShortDateLabel_(dateStr, pattern) {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return String(dateStr || '');
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return String(pattern || DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT)
    .split('{M}').join(String(month))
    .split('{d}').join(String(day));
}

/**
 * 第十二輪批次階段 A：把已排序（按週次由小到大）嘅日期欄位陣列，
 * 按月分組成「月份標題橫跨該月幾多個日期欄」嘅陣列，供公開/個人頁面
 * 畫月份標題列（merge 跨欄）用。假設輸入已經按日期排序——`buildGridLayout_()`
 * 產生嘅 `dates` 本來就按 `weekIndex` 由小到大排，季度內嘅週次同日期
 * 必然同步遞增，所以連續同月份嘅日期一定相鄰，唔會斷開又重新出現。
 * @param {{serviceDate: string}[]} dateColumns 已排序嘅日期欄位陣列
 * @returns {{month: number, label: string, span: number}[]} 月份分組
 */
function buildMonthGroups_(dateColumns) {
  const groups = [];
  dateColumns.forEach(function (dc) {
    const month = Number(String(dc.serviceDate).split('-')[1]);
    const last = groups[groups.length - 1];
    if (last && last.month === month) {
      last.span++;
    } else {
      groups.push({ month: month, label: month + '月', span: 1 });
    }
  });
  return groups;
}

/**
 * 第十二輪批次階段 A【本輪最重要】：把 `buildGridLayout_()` 產生嘅「日期做列、
 * 崗位做欄」grid，轉置成「崗位做列、日期做欄」——對照教會現行人手職事表嘅
 * 方向（崗位在左欄、日期在頂列、按月分組），亦令欄數固定喺「幾多週 + 1」
 * （通常 13＋1＝14 欄），唔會再因為崗位／slot 數量增加而越嚟越闊，
 * 大幅改善手機睇嘅體驗。
 *
 * 刻意寫成純函式——唔碰 `SpreadsheetApp`，只食 `buildGridLayout_()` 已經
 * 產生嘅 `layout`、崗位清單、特別主日對照三樣輸入，方便直接測試「邊一格
 * 轉置去邊度」呢個結構本身係啱嘅，唔使真正嘅 GAS 環境。
 *
 * 多 slot 嘅崗位（例如司事、司數各 2 個 slot，聖餐襄禮 4 個 slot）喺原本
 * 嘅日期做列版面係「同一崗位嘅唔同 slot 各佔一欄」，轉置之後就變成
 * 「同一崗位嘅唔同 slot 各佔一列」，`isFirstSlot=true` 嘅嗰一列供呼叫端
 * 決定邊一列要垂直合併崗位名稱嗰個儲存格（`slotCount` 就係要合併幾多列）。
 *
 * 第十三輪批次階段 A6【bug 修正，第十四輪批次階段 A 再修正】：
 * `Posts.EmptyDisplay=BLANK` 嘅崗位（例如獻花、翻譯——刻意留空、幹事
 * 介面唔想每格都顯示「（待填）」）喺幹事介面留白冇問題，但對外公開嘅
 * 版面成行留白冇任何說明，義工會誤以為漏咗嘢。
 *
 * 第十三輪批次原本嘅做法係逐格代入 `displayOptions.blankNote` 呢句
 * 說明文字——**實測發現呢個做法本身有問題**：一行通常有 13 個日期欄，
 * 13 格全部重複同一句十幾字嘅說明，唔單止畫面好嘈吵，仲會令儲存格
 * 內文字換行、拉高成行嘅列高，令表格睇落成大截無啦啦變闊變高。
 *
 * 改為**完全唔喺格內寫任何文字**（留返自然嘅空白，同幹事介面一致），
 * 說明改成**喺圖例加一行**（見 `PublicRoster.gs` 嘅
 * `buildBlankRowLegendEntry_()`）。呢個函式呢度淨係負責數清楚實際有幾多
 * 格屬於呢一類（`blankPendingCount`），俾圖例組數字用——判斷邏輯本身
 * 冇變，仍然係 `cellClass === MANUAL_PENDING && text === ''`（呢個組合喺
 * `resolveGridCellText_()` 唯一對應 `EmptyDisplay=BLANK`）。
 *
 * 刻意**唔改** `resolveGridCellText_()`／幹事介面嘅 grid——嗰個嘅空白
 * 係刻意設計（幹事知道呢啲係人手安排、唔需要提示），呢個統計只喺轉置
 * 呢一層做，只影響公開／個人頁面嘅圖例。
 *
 * @param {Object} layout `buildGridLayout_()` 的結果
 * @param {{postId: string, postNameTC: string, slotCount: number}[]} posts
 *   崗位清單，必須同 `buildGridLayout_()` 內部用嚟組 `layout.keys` 嘅
 *   `readPosts()` 次序完全一致（呼叫端負責保證，通常直接傳
 *   `readPostsNormalized()` 嘅結果）
 * @param {Object.<string, string>} specialTitleByDate {yyyy-MM-dd: 特別主日名稱}
 * @param {{dateFormatPattern: string}=} displayOptions
 *   `dateFormatPattern` 見 `formatShortDateLabel_()`
 * @returns {{dateColumns: Object[], monthGroups: Object[], postRows: Object[], blankPendingCount: number}}
 *   `dateColumns`：每個日期欄一項 `{serviceDate, weekIndex, dayLabel, specialTitle}`；
 *   `monthGroups`：`buildMonthGroups_()` 的結果；
 *   `postRows`：每個崗位 slot 一項
 *   `{postId, postNameTC, slotIndex, slotCount, isFirstSlot, cells}`，
 *   `cells` 為 `{text, cellClass}` 陣列，順序同 `dateColumns` 一致；
 *   `blankPendingCount`：全表 `EmptyDisplay=BLANK` 而實際留空嘅格數，
 *   供圖例組「（空白）」一行用
 */
function transposeRosterForPublicView_(layout, posts, specialTitleByDate, displayOptions) {
  const opts = displayOptions || {};
  const dateColumns = layout.dates.map(function (d) {
    return {
      serviceDate: d.serviceDate,
      weekIndex: d.weekIndex,
      dayLabel: formatShortDateLabel_(d.serviceDate, opts.dateFormatPattern),
      specialTitle: (specialTitleByDate && specialTitleByDate[d.serviceDate]) || ''
    };
  });
  const monthGroups = buildMonthGroups_(dateColumns);

  // 建立 (dateIndex, columnIndex) → cellClass 對照——columnIndex 沿用
  // layout.rows 本身嘅 0-based 欄索引（前 3 欄係日期／週次／類型），
  // 直接由 layout.cellIndex 逐項反推，唔重新掃 assignments 一次。
  const classByCell = dateColumns.map(function () { return []; });
  Object.keys(layout.cellIndex).forEach(function (key) {
    const cell = layout.cellIndex[key];
    const dateIndex = cell.row - 3;
    const columnIndex = cell.column - 1;
    if (!classByCell[dateIndex]) classByCell[dateIndex] = [];
    classByCell[dateIndex][columnIndex] = cell.cellClass;
  });

  let columnIndex = 3; // layout.keys／layout.rows 的 0-based 索引，前 3 欄係日期/週次/類型
  const postRows = [];
  let blankPendingCount = 0;
  posts.forEach(function (post) {
    const slotCount = Math.max(1, Number(post.slotCount) || 1);
    for (let slot = 1; slot <= slotCount; slot++) {
      const cIdx = columnIndex;
      const cells = dateColumns.map(function (dc, dateIndex) {
        const rowArr = layout.rows[dateIndex];
        const text = (rowArr && rowArr[cIdx] !== undefined) ? rowArr[cIdx] : '';
        const cellClass = (classByCell[dateIndex] && classByCell[dateIndex][cIdx]) || null;
        if (cellClass === GRID_CELL_CLASS.MANUAL_PENDING && text === '') blankPendingCount++;
        return { text: text, cellClass: cellClass };
      });
      postRows.push({
        postId: post.postId,
        postNameTC: post.postNameTC,
        slotIndex: slot,
        slotCount: slotCount,
        isFirstSlot: slot === 1,
        cells: cells
      });
      columnIndex++;
    }
  });

  return {
    dateColumns: dateColumns, monthGroups: monthGroups, postRows: postRows,
    blankPendingCount: blankPendingCount
  };
}

/**
 * 第十四輪批次階段 A：組出公開／個人頁面圖例入面「（空白）」嗰一行——
 * 解釋「有啲崗位嘅格完全留空，唔係漏咗」，取代第十三輪批次逐格重複
 * 寫呢句說明嘅做法（見 `transposeRosterForPublicView_()` 檔頭說明）。
 *
 * 沿用 `buildLegendRows_()` 已有嘅慣例（`docs/幹事操作說明.md`／
 * `RosterWriter.gs` 都係「刻意全部類別都列出嚟，包括 0 格嘅」），呢一行
 * 只喺 `blankNote` 有設定（幹事冇喺 Config 清空呢個功能）先會出現，
 * 有出現就一定顯示（唔理 count 係咪 0）——「0 格」本身都係一項有用資訊
 * （代表呢一季冇任何崗位整格留空）。
 *
 * 標記欄用「（空白）」而唔係留空白——同 `buildLegendRows_()` 嘅
 * 「（姓名）」一致，圖例入面嘅標記本來就係*描述*呢一類格會顯示咩，
 * 唔係逐字複製格入面嘅實際內容（呢一類格入面實際上乜都冇）。
 *
 * @param {string} blankNote `PUBLIC_ROSTER_BLANK_NOTE` 嘅內容（同一段文字
 *   直接沿用做圖例說明，唔需要另外設一個 Config key）
 * @param {number} count `transposeRosterForPublicView_()` 回傳嘅
 *   `blankPendingCount`
 * @returns {?Array} `[marker, meaning, countText]`；`blankNote` 空白時
 *   回傳 `null`（呼叫端唔加呢一行）
 */
function buildBlankRowLegendEntry_(blankNote, count) {
  const note = String(blankNote || '').trim();
  if (!note) return null;
  return ['（空白）', note, (Number(count) || 0) + ' 格'];
}

/**
 * 第十輪批次階段 A2：在 grid 資料列之後寫入圖例，並在最底加一句備註
 * （對照教會現行人手職事表底部嗰句聯絡人字句）。
 *
 * 兩者都可以喺 Config 關掉／改字：`GRID_SHOW_LEGEND`、`GRID_FOOTER_NOTE`。
 * 備註留空就唔會寫嗰一行。
 *
 * @param {Sheet} sheet 目標工作表
 * @param {Object} layout buildGridLayout_() 的結果
 * @returns {number} 這一段實際佔用的行數（供統計區接落去排）
 */
function writeLegendSection_(sheet, layout) {
  const showLegend = getConfig(CONFIG_KEYS.GRID_SHOW_LEGEND, DEFAULTS.GRID_SHOW_LEGEND) === true;
  const footerNote = String(getConfig(CONFIG_KEYS.GRID_FOOTER_NOTE, DEFAULTS.GRID_FOOTER_NOTE) || '').trim();
  if (!showLegend && !footerNote) return 0;

  let row = layout.rows.length + 4;
  const startRow = row;

  if (showLegend) {
    sheet.getRange(row, 1).setValue(GRID_LABELS.LEGEND_TITLE)
      .setFontWeight('bold')
      .setBackground(GRID_COLORS.STATS_HEADER);
    row++;

    const legendRows = buildLegendRows_(layout);
    sheet.getRange(row, 1, legendRows.length, 3).setValues(legendRows);

    // 每一行嘅第一格用返該類別喺表上嘅實際底色，令圖例同表格對得上
    const gapColor = getConfig(CONFIG_KEYS.GRID_PENDING_FILL_COLOR, DEFAULTS.GRID_PENDING_FILL_COLOR);
    const markerColors = [
      [null], [GRID_COLORS.SKIPPED], [GRID_COLORS.SKIPPED],
      [GRID_COLORS.SPECIAL_SKIP], [gapColor]
    ];
    sheet.getRange(row, 1, markerColors.length, 1).setBackgrounds(markerColors);
    row += legendRows.length;
  }

  if (footerNote) {
    row++;
    sheet.getRange(row, 1).setValue(footerNote).setFontStyle('italic');
    row++;
  }

  return row - startRow;
}

/**
 * 在 grid 資料列（與圖例）之後附上每人本季服侍次數統計。
 * @param {Sheet} sheet 目標工作表
 * @param {Object} layout buildGridLayout_() 的結果
 * @param {Object[]} assignments 派工結果
 * @param {number=} extraOffset 圖例區佔用的行數，統計區順序排喺佢下面
 * @returns {void}
 */
function writeStatsSection_(sheet, layout, assignments, extraOffset) {
  const counts = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!counts[a.personId]) counts[a.personId] = { name: a.personName, count: 0 };
    counts[a.personId].count++;
  });

  const stats = Object.keys(counts)
    .map(function (personId) {
      return [counts[personId].name, personId, counts[personId].count];
    })
    .sort(function (a, b) {
      if (b[2] !== a[2]) return b[2] - a[2];
      return a[1] < b[1] ? -1 : 1;
    });

  const startRow = layout.rows.length + 5 + (Number(extraOffset) || 0);
  sheet.getRange(startRow, 1).setValue(GRID_LABELS.STATS_TITLE)
    .setFontWeight('bold')
    .setBackground(GRID_COLORS.STATS_HEADER);
  sheet.getRange(startRow + 1, 1, 1, 3)
    .setValues([[GRID_LABELS.NAME, GRID_LABELS.PERSON_ID, GRID_LABELS.COUNT]])
    .setFontWeight('bold');
  if (stats.length > 0) {
    sheet.getRange(startRow + 2, 1, stats.length, 3).setValues(stats);
  }
}

/**
 * 把派工結果寫入 RosterAssignments 長表（附加在現有資料之後）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} assignments 派工結果
 * @returns {number} 寫入的列數
 */
function writeAssignments(quarterId, versionNo, assignments) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ROSTER_ASSIGNMENTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.ROSTER_ASSIGNMENTS);
  if (assignments.length === 0) return 0;

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const now = nowTimestamp_();
  const actor = Session.getActiveUser().getEmail();
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const rows = assignments.map(function (a) {
    const record = {};
    record[C.ASSIGNMENT_ID] = [quarterId, 'v' + versionNo, a.serviceDateId, a.postId, a.slotIndex].join('-');
    record[C.QUARTER_ID] = quarterId;
    record[C.VERSION_NO] = versionNo;
    record[C.SERVICE_DATE_ID] = a.serviceDateId;
    record[C.SERVICE_DATE] = a.serviceDate;
    record[C.POST_ID] = a.postId;
    record[C.SLOT_INDEX] = a.slotIndex;
    record[C.PERSON_ID] = a.personId;
    record[C.PERSON_NAME_SNAPSHOT] = a.personName;
    record[C.ASSIGN_SOURCE] = a.assignSource;
    record[C.RULE_FLAGS] = (a.ruleFlags || []).join(',');
    record[C.LOCKED] = a.assignSource === ASSIGN_SOURCE.LOCKED ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
    record[C.UPDATED_AT] = now;
    record[C.UPDATED_BY] = actor;
    return headers.map(function (h) {
      return record[h] === undefined ? '' : record[h];
    });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, rows.length, headers.length).setValues(rows);
  applyTimestampFormat_(sheet, headers, [C.UPDATED_AT], targetRow, rows.length);
  return rows.length;
}

/**
 * 在 RosterVersions 登記一個新版本。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} sheetName 對應的 grid 工作表名稱
 * @param {string} basis 版本依據，例如 "AUTO_GENERATE"
 * @param {?number} parentVersionNo 上一版版本號，沒有時傳 null
 * @param {number} warningCount 警告數目
 * @param {boolean} isProtected 是否已加保護
 * @param {string=} notes 備註，例如採用的 seed，供日後重現該版本
 * @returns {void}
 */
function registerVersion(quarterId, versionNo, sheetName, basis, parentVersionNo, warningCount, isProtected, notes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ROSTER_VERSIONS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.ROSTER_VERSIONS);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.ROSTER_VERSIONS;
  const record = {};
  record[C.VERSION_ID] = quarterId + '-v' + versionNo;
  record[C.QUARTER_ID] = quarterId;
  record[C.VERSION_NO] = versionNo;
  record[C.SHEET_NAME] = sheetName;
  record[C.BASIS] = basis;
  record[C.PARENT_VERSION_NO] = parentVersionNo === null ? '' : parentVersionNo;
  record[C.STATUS] = VERSION_VALUES.STATUS_DRAFT;
  record[C.PROTECTED] = isProtected ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
  record[C.WARNING_COUNT] = warningCount;
  record[C.CREATED_AT] = nowTimestamp_();
  record[C.CREATED_BY] = Session.getActiveUser().getEmail();
  record[C.NOTES] = notes || '';

  const row = headers.map(function (h) {
    return record[h] === undefined ? '' : record[h];
  });
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  applyTimestampFormat_(sheet, headers, [C.CREATED_AT], targetRow, 1);

  // 階段 F 新增：版本建立是全部五個步驟共用的唯一登記點，「版本號、基於哪個版本、
  // 原因」原本只寫進 RosterVersions 本身（record 已經含 ParentVersionNo／Basis／
  // Notes），這裡另外寫一筆 AuditLog，讓「查看 AuditLog 摘要」不需要另外去讀
  // RosterVersions 就能看到這件事發生過。
  writeAuditLog_({
    action: '建立新版本',
    targetSheet: SHEETS.ROSTER_VERSIONS,
    targetKey: quarterId + '-v' + versionNo,
    oldValue: parentVersionNo === null ? '（無，新季度第一版）' : 'v' + parentVersionNo,
    newValue: basis,
    notes: notes || ''
  });
}

/**
 * 找出指定季度目前最大的版本號。
 * @param {string} quarterId 季度 ID
 * @returns {number} 最大版本號；尚未有任何版本時回傳 -1
 */
function findLatestVersionNo(quarterId) {
  const rows = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (row) {
    return row[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] === quarterId;
  });
  let max = -1;
  rows.forEach(function (row) {
    const versionNo = Number(row[COLUMNS.ROSTER_VERSIONS.VERSION_NO]);
    if (!isNaN(versionNo) && versionNo > max) max = versionNo;
  });
  return max;
}

/**
 * 第十五輪批次新增：列出 `RosterVersions` 入面實際出現過嘅全部 QuarterID
 * （去重，由新到舊排）。
 *
 * 存在嘅理由：`findLatestVersionNo()` 搵唔到版本時，單單話「找不到 X 已生成
 * 的版本」冇俾使用者足夠資訊判斷係「呢一季真係未生成」定係「打嘅 QuarterID
 * 同資料庫入面嘅唔一致」（例如全形字元、隱形字元——見
 * `normalizeIdInput_()` 檔頭說明）。呼叫端可以將呢個清單接落錯誤訊息，
 * 令呢類問題一睇就知，唔使好似呢一輪咁樣要逐層追查先搵到。
 * @returns {string[]} QuarterID 清單，由新到舊（字串排序，跟 QuarterID
 *   本身「年份+T+季別」嘅寫法剛好等於時間順序）
 */
function listKnownQuarterIds_() {
  const ids = {};
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    const id = String(row[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] || '').trim();
    if (id) ids[id] = true;
  });
  return Object.keys(ids).sort().reverse();
}

/**
 * 第十五輪批次新增：組出「搵唔到呢個季度已生成嘅版本」嘅錯誤訊息，附上
 * `RosterVersions` 實際有嘅 QuarterID 清單，令使用者一睇就知係「呢一季
 * 真係未生成」定係「打嘅字同資料庫入面唔一致」。見 `listKnownQuarterIds_()`
 * 檔頭說明。
 * @param {string} quarterId 搵唔到嘅 QuarterID
 * @returns {string} 完整錯誤訊息
 */
function buildQuarterNotFoundMessage_(quarterId) {
  const known = listKnownQuarterIds_();
  const knownText = known.length > 0
    ? '目前已生成過版本的季度：' + known.slice(0, 15).join('、')
      + (known.length > 15 ? '……等共 ' + known.length + ' 個' : '') + '。'
      + '如果你輸入的跟這個清單看起來一樣但仍然找不到，可能是全形字元，或者複製貼上帶了看不見的字元。請重新逐個字打一次。'
    : '目前 RosterVersions 完全沒有任何已生成的版本紀錄。';
  return '找不到 "' + quarterId + '" 已生成的版本，請先執行「步驟 1：生成初稿」。' + knownText;
}

/**
 * 追加階段 V 新增的唯讀診斷：統計 RosterAssignments 每個「季度＋版本」實際有幾多行、
 * 幾多行有 PersonID、涉及幾多個不同的人。
 *
 * 用途：`buildMailContext_()`（Mailer.gs）與 `buildFineTuneContext_()`（FineTune.gs）
 * 都是靠「QuarterID＋VersionNo」去 RosterAssignments 篩資料，一旦某個版本在這張表
 * 沒有資料，寄送會找不到收件人、步驟 3 會直接拋錯。用試算表的檢視工具人手數行數
 * 很容易只讀到最前面一部分（例如只看到第一個版本的 175 行就以為全表只有 175 行），
 * 所以改由程式自己完整掃一次、按版本分組報告，數字才可靠。
 *
 * @returns {{totalRows: number, groups: Object[]}}
 *   groups 每項為 {quarterId, versionNo, rowCount, assignedCount, personCount}，
 *   依 quarterId、versionNo 排序
 */
function summariseAssignmentVersions_() {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS);
  const byKey = {};

  rows.forEach(function (row) {
    const quarterId = String(row[C.QUARTER_ID] || '');
    const versionNo = Number(row[C.VERSION_NO]);
    const key = quarterId + '|' + versionNo;
    if (!byKey[key]) {
      byKey[key] = {
        quarterId: quarterId, versionNo: versionNo,
        rowCount: 0, assignedCount: 0, persons: {}
      };
    }
    const g = byKey[key];
    g.rowCount++;
    const personId = row[C.PERSON_ID];
    if (personId) {
      g.assignedCount++;
      g.persons[personId] = true;
    }
  });

  const groups = Object.keys(byKey).map(function (k) {
    const g = byKey[k];
    return {
      quarterId: g.quarterId, versionNo: g.versionNo, rowCount: g.rowCount,
      assignedCount: g.assignedCount, personCount: Object.keys(g.persons).length
    };
  }).sort(function (a, b) {
    if (a.quarterId !== b.quarterId) return a.quarterId < b.quarterId ? -1 : 1;
    return a.versionNo - b.versionNo;
  });

  return { totalRows: rows.length, groups: groups };
}

/**
 * 為 v0 原始版工作表加上保護，只留 Config 的 SCRIPT_ACCOUNT_EMAIL 可編輯。
 * 注意：試算表擁有者無法被移除編輯權，這是 Google 的限制。
 * @param {string} sheetName 要保護的工作表名稱
 * @returns {void}
 */
function protectV0(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const protection = sheet.protect().setDescription('v0 原始版，建立後鎖定');
  const scriptAccount = getConfig(CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, '');

  protection.removeEditors(protection.getEditors());
  if (scriptAccount) protection.addEditor(scriptAccount);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

/**
 * 第二十輪批次階段 A2：算出「呢一格**本來應該**渲染成咩文字」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個函式
 * ─────────────────────────────────────────────────────────────────────
 *
 * 「人手改動偵測」（`buildGridOverlayState_()`，FineTune.gs）原本嘅方向係
 * **由 grid 文字反推 PersonID**：見到一格有字、而 `RosterAssignments`
 * 嗰格冇人名，就當成「幹事改咗嘢」，再 `resolvePersonId()` 查係邊個。
 *
 * 呢個方向有一個根本問題：**grid 上面唔係淨係得人名。** 仲有一批
 * 「顯示用」嘅文字：
 *
 *   • `特殊主日`（`GRID_SPECIAL_SKIP_LABEL`）
 *   • `英語堂`／`華語堂`（`SpecialSundays.ExternalOwner`）
 *   • `待確認`／`—`（`Posts.EmptyDisplay` 嘅 PENDING／BLANK）
 *   • `⚠ 未能安排`（`GRID_GAP_LABEL`）
 *
 * 呢啲全部都會被當成「認唔出嘅人手改動」。
 *
 * 實測後果（2026T4）：2026-10-04 係合堂，領詩／司琴由英語堂負責，
 * grid 顯示「特殊主日」。幹事真係改咗一格（SCRIPTURE），
 * 偵測器報 **3 格**——真嗰格 ＋ 兩格誤報，然後因為兩格誤報「認唔出」
 * 而**整批拒絕建立新版本**。即係話：**只要季度入面有任何合堂，
 * 整個「把人手改動寫成新版本」功能就完全用唔到。**
 * 每年四次合堂，實際上每季都有機會中。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解唔用白名單補鑊
 * ─────────────────────────────────────────────────────────────────────
 *
 * 最快嘅做法係把「特殊主日」加入 `GRID_PLACEHOLDER_TEXTS`。但噉樣
 * **下次多一種顯示文字又會再中**——`ExternalOwner` 係幹事自由輸入嘅，
 * 「英語堂」「華語堂」「青年崇拜」……根本列唔完。
 *
 * 所以改變方向：**由 `RosterAssignments` 算出「呢一格本來應該渲染成咩」，
 * 再同 grid 實際內容比對。相等就唔係人手改動。**
 * 噉樣「特殊主日」對「特殊主日」自然相等，唔需要任何白名單。
 *
 * ⚠️ **本函式唔會自己實作渲染邏輯**，而係呼叫 `classifyGridCell_()` ＋
 * `resolveGridCellText_()`——即係寫 grid 嗰陣用嘅同一段程式碼
 * （見 `buildRosterGridData_()`）。兩份平行邏輯遲早分岔，分岔嗰陣
 * 呢個工具就會講大話；第十八輪階段 C 已經因為同類問題食過一次虧。
 *
 * @param {?Object} assignment 該格嘅派工（要有 personId／personName／
 *   assignSource／ruleFlags）
 * @param {string} postId 崗位 ID
 * @param {string} serviceDate 主日日期（yyyy-MM-dd）
 * @param {Object} renderContext `buildGridRenderContext_()` 嘅結果
 * @returns {string} 該格應該顯示嘅文字
 */
function renderExpectedGridText_(assignment, postId, serviceDate, renderContext) {
  return resolveGridCellText_(
    assignment,
    classifyGridCell_(assignment),
    renderContext.emptyDisplayByPostId[postId],
    renderContext.labels,
    renderContext.externalOwnerByDate[serviceDate]
  );
}

/**
 * 第二十輪批次階段 A2：收齊 `renderExpectedGridText_()` 需要嘅三樣嘢。
 *
 * 一次過讀完傳落去，唔好逐格讀——同 `buildRosterGridData_()` 入面
 * `readGridCellLabels_()` 只讀一次係同一個理由。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @param {Object[]=} posts 已讀好嘅 `readPostsNormalized()` 結果（可選，慳一次讀取）
 * @returns {{labels: Object, emptyDisplayByPostId: Object, externalOwnerByDate: Object}}
 */
function buildGridRenderContext_(quarterId, timezone, posts) {
  const emptyDisplayByPostId = {};
  // 第三十五輪批次 A 組：邊啲崗位係「本來就唔由系統排」。
  // 擺喺呢度而唔係另外讀一次 `Posts`——呢個 context 本身就係
  // 「人手改動偵測要用嘅逐崗位資料」，多一個欄位唔使多讀一次表。
  const autoGenerateByPostId = {};
  (posts || readPostsNormalized()).forEach(function (p) {
    emptyDisplayByPostId[p.postId] = p.emptyDisplay;
    autoGenerateByPostId[p.postId] = p.autoGenerate !== false;
  });
  return {
    labels: readGridCellLabels_(),
    emptyDisplayByPostId: emptyDisplayByPostId,
    autoGenerateByPostId: autoGenerateByPostId,
    externalOwnerByDate: buildSpecialSundayExternalOwnerIndex_(quarterId, timezone)
  };
}

/**
 * 第四十一輪批次 F 組：**欄寬配合 A4 橫向印得出。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 實測見到的問題
 * ═════════════════════════════════════════════════════════════════════
 *
 * 「欄位收縮了、撐不夠闊。」
 *
 * 成因是匯出用 `fitw=true`（縮到頁寬）：整張表有二十幾欄，Google 為了
 * 塞落一版 A4，會把每一欄按比例縮細。而 `autoResizeColumns()` 之後，
 * 「週次」那一欄（只有一個數字）同「聖餐襄禮1」那一欄（五個字）
 * 寬度差好遠——縮的時候**兩欄按同一個比例縮**，
 * 結果人名那幾欄縮到三個中文字都放不下，而「週次」那一欄仍然浪費著位。
 *
 * 所以要做的不是「加闊」，是**把省得到的位讓給人名那幾欄**：
 *   日期　　剛好放得下 `2027-01-03`
 *   週次　　最窄（只有一個數字）
 *   類型　　窄（「主日崇拜」四個字，太長的會折行）
 *   人名　　夠放三個中文字（教會的中文名絕大部分是二至三個字）
 *
 * ⚠️ 用 `setColumnWidth()` 而不是留給 `autoResizeColumns()`：
 * autoResize 是按**內容**決定的，所以同一個崗位欄會因為那一季剛好排到
 * 一個四個字的名而變闊，下一季又變窄——即是同一份表每季印出來都不同樣。
 *
 * ⚠️ 這個函式**只設欄寬**，一格資料都不碰。
 * 失敗（例如工作表被保護）不可以令建立版本失敗——見呼叫端的 try/catch。
 */

/** 日期欄：剛好放得下 `2027-01-03`。 */
const GRID_WIDTH_DATE = 82;

/** 週次欄：最窄。只有一個一至兩位數。 */
const GRID_WIDTH_WEEK = 40;

/** 類型欄：窄。「主日崇拜」四個字，更長的靠自動換行折下去。 */
const GRID_WIDTH_TYPE = 74;

/**
 * 人名欄：夠放三個中文字。
 *
 * 教會的中文名絕大部分是二至三個字；四個字的會折行，
 * 而折行比縮到看不清楚好——起碼讀得出。
 */
const GRID_WIDTH_NAME = 62;

/**
 * 把 grid 的欄寬設成配合 A4 橫向。
 *
 * @param {Sheet} sheet grid 工作表
 * @param {Object} layout `buildGridLayout_()` 的結果
 */
function applyGridColumnWidthsForA4_(sheet, layout) {
  sheet.setColumnWidth(1, GRID_WIDTH_DATE);
  sheet.setColumnWidth(2, GRID_WIDTH_WEEK);
  sheet.setColumnWidth(3, GRID_WIDTH_TYPE);

  // ⚠️ 第 4 欄起才是崗位。前三欄是日期／週次／類型——這個假設
  // 在 `buildGridLayout_()`、`buildGridIndex_()` 幾處都有，
  // 不是這裡自己定的。
  const nameColumnCount = layout.keys.length - 3;
  if (nameColumnCount > 0) {
    sheet.setColumnWidths(4, nameColumnCount, GRID_WIDTH_NAME);
  }

  // 人名欄設定自動換行：四個字的名會折成兩行，而不是被隔壁欄蓋住。
  // ⚠️ 蓋住是最差的一種——印出來看起來像那一格是空的。
  if (nameColumnCount > 0 && layout.rows.length > 0) {
    sheet.getRange(3, 4, layout.rows.length, nameColumnCount).setWrap(true);
  }
}
