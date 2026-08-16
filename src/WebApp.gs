/**
 * 追加階段 AV：Web UI 的安全模型，共三層，全部要同時成立才會真正執行任何動作：
 *
 * 1. **`appsscript.json` 的部署權限**（`webapp.access = "MYSELF"`，
 *    `executeAs = "USER_DEPLOYING"`）——這是 Google 平台層級的第一道關卡，
 *    只有部署這個 Web App 的那個 Google 帳號本人才能打開頁面。選 `MYSELF` 而不是
 *    `DOMAIN`（同 domain 已登入者皆可）或 `ANYONE`，是因為現階段 Web UI 只有一個
 *    操作者（幹事本人），沒有必要放寬到整個 domain；而且教會的 Google Workspace
 *    domain 成員不一定人人都應該有權限操作職事表系統。日後如果真的需要讓其他人
 *    （例如另一位幹事）直接使用，屆時應該改成 `DOMAIN` 並同步擴充下面的
 *    `WEBAPP_ALLOWED_EMAILS`，而不是一開始就開放。
 * 2. **Config 的 `WEBAPP_ENABLED` 總開關**（預設 FALSE）——即使 Web App 已經
 *    deploy、部署權限也設對了，這一關沒開，`doGet()` 與全部 `api*` 函式一律
 *    拒絕執行。存在的理由：deploy 這個動作本身不代表幹事已經準備好啟用它，
 *    這一關讓「已部署」與「已啟用」分開，幹事要主動多做一步才會真正生效。
 * 3. **`WEBAPP_ALLOWED_EMAILS` 白名單**——即使前兩關都過了，`Session.getActiveUser()`
 *    讀到的呼叫者電郵仍然要在名單內（留空時只允許 `SCRIPT_ACCOUNT_EMAIL`）。
 *    這是防止「部署權限日後被人手改鬆」的第二道獨立防線，不依賴第 1 關繼續生效。
 *
 * 三層獨立生效，不是「隨便一關過了就算」，見 `assertWebAppRequestAllowed_()`。
 */

/**
 * 檢查 Web UI 總開關（Config 的 `WEBAPP_ENABLED`）。沒開就拋錯。
 * @returns {void}
 */
function assertWebAppEnabled_() {
  if (getConfig(CONFIG_KEYS.WEBAPP_ENABLED, false) !== true) {
    throw new Error('Web UI 目前已停用（Config 的 WEBAPP_ENABLED 不是 TRUE）。');
  }
}

/**
 * 檢查呼叫者是否在允許名單內。`WEBAPP_ALLOWED_EMAILS` 留空時，退回只允許
 * `SCRIPT_ACCOUNT_EMAIL` 那一個人——空白絕對不代表「任何人皆可」，兩者都空白時
 * 直接拒絕（等同名單是空集合，沒有人在內）。
 * @returns {void}
 */
function assertApiCallerAuthorized_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error('無法識別呼叫者身分（Session.getActiveUser() 讀不到電郵），拒絕執行。');
  }

  const configured = getConfig(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, []);
  const explicitList = (Array.isArray(configured) ? configured : [])
    .map(function (e) { return String(e).trim().toLowerCase(); })
    .filter(Boolean);
  const allowList = explicitList.length > 0
    ? explicitList
    : [String(getConfig(CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, '')).trim().toLowerCase()].filter(Boolean);

  if (allowList.length === 0) {
    throw new Error('Web UI 允許名單是空的（WEBAPP_ALLOWED_EMAILS 與 SCRIPT_ACCOUNT_EMAIL 都未設定），拒絕執行。');
  }
  if (allowList.indexOf(email) === -1) {
    throw new Error('（' + email + '）不在 Web UI 允許名單內，拒絕執行。');
  }
}

/**
 * 合併第 2、3 層檢查，供每一個 `api*` 函式開頭呼叫。第 1 層（部署權限）由
 * Google 平台在請求到達這個腳本之前就把關，程式碼裡沒有東西可以額外檢查。
 * @returns {void}
 */
function assertWebAppRequestAllowed_() {
  assertWebAppEnabled_();
  assertApiCallerAuthorized_();
}

/**
 * Web App 的進入點，回傳操作介面頁面。
 *
 * ⚠️ 第十一輪批次階段 B：**呢個函式而家由兩個唔同 access 設定嘅部署共用**
 * ——幹事介面本身嘅部署（`access=MYSELF`）同義工用嘅「個人專屬連結」部署
 * （`access=ANYONE`，見 `WebAppPersonalLink.gs` 檔頭說明）。**必須假設呼叫者
 * 未經任何權限檢查**，第一件事就要判斷「呢個係咪個人連結請求」，係嘅話
 * 完全唔行下面幹事介面嗰三層防護（義工冇 Google 身分可以過白名單），
 * 唔係先至行返原本嘅邏輯。呢個分流一定要排喺最頭，唔可以有任何共用邏輯
 * 排喺分流之前。
 *
 * 安全模型見上方「追加階段 AV」的說明區塊。總開關關閉、或呼叫者不在白名單內時，
 * **一律不會渲染 `ui/Index`**，只回傳一個不含任何職事表資料的說明頁——
 * 兩種情況用不同文字，方便幹事自己判斷是「未啟用」還是「無權限」。
 *
 * 注意：本專案**尚未部署**為 Web App（依指示不執行 clasp deploy）。
 * 此函式已可運作，日後在編輯器按「部署 → 新增部署 → 網頁應用程式」即可啟用，
 * 但部署之後 `WEBAPP_ENABLED` 仍然是 FALSE，要幹事自己去 Config 開啟才會真正可用。
 *
 * @param {Object} e 查詢參數（`e.parameter.p` 有值就是個人專屬連結請求）
 * @returns {HtmlOutput} 要顯示的頁面
 */
function doGet(e) {
  // 第十一輪批次階段 B：分流一定排最頭。有 p 參數＝個人專屬連結，
  // 完全唔行下面幹事介面嗰三層防護函式（renderPersonalRosterPage_() 自己
  // 有一套完全獨立嘅安全模型，見 WebAppPersonalLink.gs 檔頭說明），
  // 亦都唔會渲染 ui/Index。
  if (e && e.parameter && e.parameter.p) {
    return renderPersonalRosterPage_(e);
  }

  try {
    assertWebAppEnabled_();
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<p>Web UI 目前已停用。</p>'
        + '<p>如需啟用，請在試算表的 Config 工作表把 <code>WEBAPP_ENABLED</code> 設為 '
        + '<code>TRUE</code>，並確認 Apps Script 的部署存取權限設定正確。</p>'
    ).setTitle('粵語堂職事表系統（已停用）');
  }

  try {
    assertApiCallerAuthorized_();
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<p>你沒有權限使用這個頁面。</p>'
        + '<p>如果你認為這是錯誤，請聯絡系統管理員，'
        + '在 Config 工作表的 <code>WEBAPP_ALLOWED_EMAILS</code> 加入你的電郵。</p>'
    ).setTitle('粵語堂職事表系統（無權限）');
  }

  return HtmlService.createTemplateFromFile(UI_FILES.INDEX)
    .evaluate()
    .setTitle('粵語堂職事表系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 讓 HTML 檔案可以引入其他 HTML 片段（樣式、腳本）。
 * @param {string} fileName 檔案名稱，例如 "ui/Style"
 * @returns {string} 該檔案的內容
 */
function includeHtml(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

/**
 * 第十一輪批次階段 D：供前端呼叫——讀取幹事本人儲存喺 UserProperties 嘅
 * 深色/淺色偏好。前端預設用瀏覽器 localStorage（同步、免來回伺服器），
 * 只喺 localStorage 讀寫失敗（例如 HtmlService sandbox 擋咗）時先會退回
 * 呼叫呢個 function（見 ui/Script.html 嘅切換邏輯）。
 * @returns {string} 'dark'／'light'／''（未設定過，前端會改跟裝置設定）
 */
function apiGetThemePreference() {
  assertWebAppRequestAllowed_();
  const value = PropertiesService.getUserProperties().getProperty(WEBAPP_THEME_PROPERTY_KEY);
  return (value === 'dark' || value === 'light') ? value : '';
}

/**
 * 第十一輪批次階段 D：供前端呼叫——寫入幹事本人嘅深色/淺色偏好到
 * UserProperties（localStorage 唔可用時嘅後備路徑，見 apiGetThemePreference()）。
 * @param {string} theme 'dark'／'light'；其他值一律略過不寫入
 * @returns {void}
 */
function apiSetThemePreference(theme) {
  assertWebAppRequestAllowed_();
  const normalized = (theme === 'dark' || theme === 'light') ? theme : '';
  if (!normalized) return;
  PropertiesService.getUserProperties().setProperty(WEBAPP_THEME_PROPERTY_KEY, normalized);
}

/**
 * 供前端呼叫：列出所有季度與其最新版本號。
 * @returns {Object[]} 每個季度的 {quarterId, status, startDate, endDate, latestVersionNo}
 */
function apiListQuarters() {
  assertWebAppRequestAllowed_();
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readSheet(SHEETS.QUARTERS).map(function (row) {
    const quarterId = row[COLUMNS.QUARTERS.QUARTER_ID];
    return {
      quarterId: quarterId,
      status: row[COLUMNS.QUARTERS.STATUS],
      startDate: toDateString(row[COLUMNS.QUARTERS.START_DATE], timezone),
      endDate: toDateString(row[COLUMNS.QUARTERS.END_DATE], timezone),
      latestVersionNo: findLatestVersionNo(quarterId)
    };
  });
}

/**
 * 供前端呼叫：列出指定季度的所有版本。
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 版本清單
 */
function apiListVersions(quarterId) {
  assertWebAppRequestAllowed_();
  const C = COLUMNS.ROSTER_VERSIONS;
  return readSheet(SHEETS.ROSTER_VERSIONS)
    .filter(function (row) { return row[C.QUARTER_ID] === quarterId; })
    .map(function (row) {
      return {
        versionNo: Number(row[C.VERSION_NO]),
        sheetName: row[C.SHEET_NAME],
        basis: row[C.BASIS],
        status: row[C.STATUS],
        warningCount: Number(row[C.WARNING_COUNT]) || 0
      };
    })
    .sort(function (a, b) { return b.versionNo - a.versionNo; });
}

/**
 * 供前端呼叫：生成職事表並建立新版本，回傳統計摘要。
 * 與選單「生成職事表」走同一套流程（`performRosterGeneration_()`）。
 *
 * 追加階段 AV：這個函式底層跟選單「準備工作 ▸ 生成職事表」共用同一個實作，
 * 而那個選單項目本身沒有 Stage 檢查（設計上任何時候都可以手動重跑生成）。
 * 但透過 Web UI 呼叫額外加了 `Stage=DRAFT` 的檢查，是刻意比選單版本更嚴格，
 * 不是「規則不一致」：階段 E 檢視時發現的真實風險是，Web UI 可以在
 * Stage 已經前進到 `REQUESTS_APPLIED`／`OFFICIAL_SENT` 之後，繞過使用者所在的
 * 選單情境，不知不覺建立一個新版本——而步驟 3／4／5 全部用
 * `findLatestVersionNo()` 認定「目前是哪一版」，這樣的新版本會在使用者不知情下
 * 變成之後步驟的底本。要求 `Stage=DRAFT` 正是四階段流程步驟 1 本身的前置條件
 * （`runFourStageStep1_()`），這裡是把同一個防線也套用在 Web UI 上，
 * 防止它在生成初稿的時機以外的任何時候插入一個新版本。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 生成結果摘要
 */
function apiGenerateRoster(quarterId) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(quarterId, [QUARTER_STAGE.DRAFT], '生成職事表（Web UI）');
  const result = performRosterGeneration_(quarterId);
  return {
    sheetName: result.sheetName,
    versionNo: result.versionNo,
    assigned: result.assigned,
    blank: result.blank,
    warnings: result.warnings,
    attemptsRun: result.attemptsRun,
    attemptIndex: result.attemptIndex,
    seed: result.seed,
    deviation: result.deviation,
    // 第十六輪批次階段 D3：未確認日期的特殊主日。目前 Web UI 的步驟 1 是
    // 唯讀顯示（生成一律由選單或自動排程執行），所以前端暫時沒有畫面用到
    // 這個欄位；照樣回傳是為了讓兩個入口的回傳結構保持一致——日後如果
    // Web UI 加回生成入口，唔使再記得補呢一項。
    unconfirmedSpecials: result.unconfirmedSpecials || [],
    unconfirmedSpecialsText: describeUnconfirmedSpecialSundays_(result.unconfirmedSpecials)
  };
}

/**
 * 判斷 RosterAssignments.RuleFlags 的原始文字（逗號分隔，例如 "HARD_COMMUNION_FIRST_SUNDAY"）
 * 是否含有結構性不適用的 RuleID。與 RosterWriter.gs 的 isStructuralNotApplicable_()
 * 判斷邏輯相同，差別只在於這裡的輸入已經被 writeAssignments() 序列化成字串，
 * 不是原始陣列。
 * @param {string} flagsText RuleFlags 欄的原始文字
 * @returns {boolean} 是否為結構性不適用
 */
function isStructuralNotApplicableFlagsText_(flagsText) {
  const ids = String(flagsText || '').split(',');
  return STRUCTURAL_NA_RULE_IDS.some(function (id) { return ids.indexOf(id) !== -1; });
}

/**
 * 供前端呼叫：取得職事表 grid 的內容，供網頁表格顯示。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{headers: string[], rows: Object[][]}} 表頭與每格的 {text, state} 資料
 */
function apiGetRosterGrid(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  // 第十輪批次階段 A：改為跟 grid／PDF 完全共用同一套分類與文字對照
  // （classifyGridCell_() ＋ resolveGridCellText_()），令三個顯示面
  // （grid 工作表、由 grid 匯出的 PDF、Web UI）永遠講同一件事。
  // 修正前 Web UI 只分得出「結構性不適用」與其餘，「排唔出」同「待人手填」
  // 一律顯示同一個 pendingLabel，跟 grid 一樣有分唔開嘅問題。
  const labels = readGridCellLabels_();
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const assignments = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
  });
  if (assignments.length === 0) throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄');

  const byKey = {};
  assignments.forEach(function (row) {
    const key = toDateString(row[C.SERVICE_DATE], timezone) + '|' + row[C.POST_ID] + '|' + row[C.SLOT_INDEX];
    byKey[key] = {
      // classifyGridCell_() 要嘅形狀：RuleFlags 喺長表係逗號分隔字串，
      // 拆返做陣列先餵入去，判斷邏輯就同 grid 嗰邊一模一樣。
      personId: row[C.PERSON_ID],
      personName: row[C.PERSON_NAME_SNAPSHOT] || '',
      assignSource: row[C.ASSIGN_SOURCE],
      ruleFlags: splitList_(row[C.RULE_FLAGS]),
      flagsText: row[C.RULE_FLAGS]
    };
  });

  const posts = readPostsNormalized();
  const headers = [GRID_LABELS.DATE, GRID_LABELS.WEEK];
  const cellKeys = [];
  const emptyDisplayByPostId = {};
  posts.forEach(function (post) {
    emptyDisplayByPostId[post.postId] = post.emptyDisplay;
    for (let slot = 1; slot <= post.slotCount; slot++) {
      headers.push(post.slotCount > 1 ? post.postNameTC + slot : post.postNameTC);
      cellKeys.push(post.postId + '#' + slot);
    }
  });

  const rows = readServiceDatesNormalized(quarterId, timezone).map(function (d) {
    const row = [
      { text: d.serviceDate, state: 'meta' },
      { text: String(d.weekIndex), state: 'meta' }
    ];
    cellKeys.forEach(function (key) {
      const parts = key.split('#');
      const cell = byKey[d.serviceDate + '|' + parts[0] + '|' + parts[1]];
      if (!cell) {
        row.push({ text: '', state: 'empty' });
        return;
      }
      const cellClass = classifyGridCell_(cell);
      const text = resolveGridCellText_(cell, cellClass, emptyDisplayByPostId[parts[0]], labels);

      if (cellClass === GRID_CELL_CLASS.GENUINE_GAP) {
        // 'gap' 係本輪新增嘅狀態，前端樣式見 ui/Style.html
        row.push({ text: text, state: 'gap', title: cell.flagsText });
      } else if (cellClass !== GRID_CELL_CLASS.ASSIGNED) {
        row.push({ text: text, state: 'skipped', title: cell.flagsText });
      } else if (cell.assignSource === ASSIGN_SOURCE.FORCED) {
        row.push({ text: text, state: 'forced', title: cell.flagsText });
      } else {
        row.push({ text: text, state: cell.flagsText ? 'warning' : 'ok', title: cell.flagsText });
      }
    });
    return row;
  });

  return { headers: headers, rows: rows };
}

/**
 * 供前端呼叫：執行核對並回傳報告內容。
 *
 * 追加階段 AV：這個函式會寫入一張新的 `Verify_` 工作表，但**沒有**加 Stage 檢查
 * ——對應的選單項目「測試工具 ▸ 核對職事表」（`runVerifyRoster_()`）本身也沒有
 * Stage 限制，設計上任何 Stage、任何版本都可以核對。它不會改動
 * RosterAssignments／RosterVersions，不會影響 `findLatestVersionNo()` 認定的
 * 「目前版本」，跟 `apiGenerateRoster()` 那種會實際改變流程狀態的風險不同，
 * 所以刻意維持與選單版本一致、不額外加限制（見 HANDOFF.md 決策 AV-2）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{sheetName: string, rows: Object[], summary: Object}} 核對報告
 */
function apiVerifyRoster(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const result = verifyRoster(quarterId, versionNo);
  return {
    sheetName: result.sheetName,
    rows: result.report.rows,
    summary: {
      adjacentRepeats: result.report.summary.adjacentRepeats,
      hardViolationCount: result.report.summary.hardViolationCount,
      peopleCount: result.report.summary.distribution.peopleCount,
      average: result.report.summary.distribution.average,
      maxCount: result.report.summary.distribution.maxCount
    }
  };
}

/**
 * 供前端呼叫：執行 fine-tune 分析，回傳三欄對照供網頁顯示。
 * 同時把建議寫入 FineTuneProposals。
 *
 * 追加階段 AV：跟 `apiVerifyRoster()` 同一個理由，沒有加 Stage 檢查——對應的
 * 選單項目「準備工作 ▸ 檢查改動」本身也沒有 Stage 限制，而且這裡寫入的是
 * FineTuneProposals（建議清單，要幹事另外去該表填 Decision、再執行「套用決定」
 * 才會真正生效），不會直接改動 RosterAssignments 或影響「目前版本」的認定。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{batchId: string, written: number, changeCount: number, violationCount: number,
 *   proposals: Object[]}} fine-tune 結果
 */
function apiDetectChanges(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const result = proposeMinimalFix(quarterId, versionNo);
  const written = writeProposals(result);
  const people = indexPeopleById_();
  const nameOf = function (personId) {
    if (!personId) return '（空白）';
    return people[personId] ? people[personId].nameTC : personId;
  };

  return {
    batchId: result.batchId,
    written: written,
    changeCount: result.changes.length,
    violationCount: result.violations.length,
    proposals: result.proposals.map(function (p) {
      return {
        serviceDateId: p.serviceDateId,
        postId: p.postId,
        slotIndex: p.slotIndex,
        original: nameOf(p.originalPersonId),
        manual: nameOf(p.manualPersonId),
        suggested: nameOf(p.suggestedPersonId),
        brokenRuleId: p.brokenRuleId,
        severity: p.severity,
        reason: p.reason
      };
    })
  };
}
