/**
 * 讀取 fine-tune 所需的全部資料：原始版本、grid 現況、規則與名單。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 供 fine-tune 運算使用的 context
 */
function buildFineTuneContext_(quarterId, versionNo) {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const original = readSheet(SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        serviceDateId: row[C.SERVICE_DATE_ID],
        serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID],
        slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID],
        personName: row[C.PERSON_NAME_SNAPSHOT],
        assignSource: row[C.ASSIGN_SOURCE],
        // 第二十輪批次階段 A2：人手改動偵測要算出「呢一格本來應該渲染成
        // 咩文字」，而 `classifyGridCell_()` 要睇 `ruleFlags` 先分得出
        // SPECIAL_SKIP／STRUCTURAL_NA／MANUAL_PENDING／GENUINE_GAP。
        // 之前冇帶呢一欄，所以偵測器只可以「由文字反推人名」——
        // 見 `renderExpectedGridText_()` 嘅說明。
        ruleFlags: splitList_(row[C.RULE_FLAGS])
      };
    });

  if (original.length === 0) {
    throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄');
  }

  // 第十六輪批次階段 B：身分名單與個人崗位排除。做法同
  // `buildGeneratorContext_()` 完全一致（增補後嘅名單蓋過 `eligibility.byPost`），
  // 確保「生成嗰陣容許嘅安排」同「步驟 3／5 重跑規則檢查」用同一份資料、
  // 同一套增補邏輯——唔會出現生成完全乾淨、一重跑就話違規呢種矛盾。
  const posts = readPostsNormalized();
  const eligibility = readEligibility();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  eligibility.byPost = roleContext.eligibleByPost;

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    timezone: timezone,
    original: original,
    gridValues: readGridPersonIds_(quarterId, versionNo, timezone),
    // 第二十輪批次階段 A2：算「呢一格本來應該渲染成咩」要用嘅三樣嘢
    // （顯示標籤、逐崗位 EmptyDisplay、逐日期 ExternalOwner）。
    gridRender: buildGridRenderContext_(quarterId, timezone, posts),
    serviceDates: readServiceDatesNormalized(quarterId, timezone),
    posts: posts,
    eligibility: eligibility,
    roles: roleContext.roles,
    personPostExclusions: roleContext.exclusions,
    peopleById: indexPeopleById_(),
    unavailable: readUnavailableNormalized(timezone),
    rules: readRules(),
    maxMoves: Number(config[CONFIG_KEYS.FINETUNE_MAX_MOVES]) || DEFAULTS.FINETUNE_MAX_MOVES,
    maxPerQuarterDefault: Number(config[CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER]) || 8,
    // 預設 TRUE（維持原行為：SEMI_HARD 違反一律回報）。讀一次存進 context，
    // 不要放進 findStateViolations_() 內部才讀——那個函式在 proposeMinimalFix()／
    // findReplacementPerson_() 的候選人迴圈裡會被呼叫很多次，每次都讀一次 Config
    // 會有不必要的額外開銷。
    warnOnSemiHard: getConfig(CONFIG_KEYS.WARN_ON_SEMI_HARD_BREAK, true) === true
  };
}

/**
 * 讀取 grid 工作表的現況，把每格的姓名解析回 PersonID。
 * 透過第 2 行的機器鍵與第 1 欄的日期定位，姓名以 resolvePersonId() 精確比對。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} timezone 時區
 * @returns {Object.<string, {personId: ?string, text: string}>} 以 "date|postId|slot" 為鍵的現況
 */
function readGridPersonIds_(quarterId, versionNo, timezone) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(3, 1, Math.max(0, lastRow - 2), lastCol).getValues();

  const result = {};
  values.forEach(function (row) {
    const dateStr = toDateString(row[0], timezone);
    if (!dateStr) return;
    for (let c = 3; c < keys.length; c++) {
      const key = String(keys[c] || '');
      if (key.indexOf('#') === -1) continue;
      const parts = key.split('#');
      // 這裡只取文字，不做姓名解析：
      // 解析每一格會令未改動的格也重新查一次姓名，遇到同名或別名時會解析到另一個人，
      // 造成派工在版本之間漂移（例如某人的服侍次數莫名其妙變多）。
      result[dateStr + '|' + parts[0] + '|' + parts[1]] = String(row[c] || '').trim();
    }
  });
  return result;
}

/**
 * 組出定位單一格子的鍵。SlotIndex 一律轉成字串，
 * 避免同一格在不同來源分別以數字與文字表示而查不到。
 * @param {string} serviceDate 主日日期
 * @param {string} postId 崗位 ID
 * @param {*} slotIndex 位次
 * @returns {string} 格子鍵
 */
function cellKey_(serviceDate, postId, slotIndex) {
  return serviceDate + '|' + postId + '|' + String(slotIndex);
}

/**
 * 正規化格內文字，供比對是否有人手改動使用。
 * 佔位文字（「待確認」等）與空白一律視為相同。
 * @param {*} text 格內文字
 * @returns {string} 正規化後的文字；代表未派人時回傳空字串
 */
function normalizeCellText_(text) {
  const trimmed = String(text === null || text === undefined ? '' : text).trim();
  if (trimmed === '') return '';
  return GRID_PLACEHOLDER_TEXTS.indexOf(trimmed) === -1 ? trimmed : '';
}

/**
 * 比對原始版本與 grid 現況，找出人手改動，並檢查改動後的狀態違反了哪些規則。
 * @param {Object} context fine-tune 的資料集
 * @returns {{changes: Object[], violations: Object[], manualState: Object[]}} 分析結果
 */
function analyseManualState_(context) {
  // ⚠️ 第三十輪批次階段 A2：只收一個參數，但傳錯嘢入去嘅後果一樣係
  // 「行到深處先爆一個講唔出原因嘅 TypeError」。
  requireContextArg_('analyseManualState_', 1, context, ['posts', 'serviceDates']);

  const overlay = buildGridOverlayState_(context);
  return {
    changes: overlay.changes,
    unresolved: overlay.unresolved,
    violations: findStateViolations_(overlay.manualState, context),
    manualState: overlay.manualState
  };
}

/**
 * 把 grid 上嘅人手改動疊加喺 `context.original` 之上，得出「目前真正嘅狀態」。
 *
 * 第十九輪批次階段 B：由 `analyseManualState_()` 抽出嚟，因為
 * `resolveAuthoritativeState_()`（`StateSource.gs`）都要用同一套疊加邏輯。
 * **疊加邏輯全專案只可以有呢一份**——第十八輪階段 C 就係因為兩個工具
 * 各自實作同一個收窄邏輯而分岔，唔應該再犯同一個錯。
 *
 * @param {Object} context fine-tune 嘅資料集（要有 `original` 同 `gridValues`）
 * @returns {{changes: Object[], unresolved: Object[], manualState: Object[]}}
 */
function buildGridOverlayState_(context) {
  // ⚠️ 第三十輪批次階段 A2：先認「傳錯咗一個陣列（state）入嚟」呢種形狀。
  // 下面嗰個 `gridRender` 檢查係另一件事（欄位缺失），兩個都要。
  //
  // ⚠️ 必要欄位只列**呢個函式自己真係讀嘅**（`gridValues`／`original`），
  // 唔可以順手寫 `posts`——佢根本冇用到，寫咗就會擋住一啲完全合法嘅
  // 精簡 context，而個錯誤訊息仲會指去一個錯嘅方向。
  requireContextArg_('buildGridOverlayState_', 1, context, ['gridValues', 'original']);

  // 第二十輪批次階段 A2：`gridRender` 冇傳就拋錯，唔可以靜靜咁當佢空。
  //
  // 同第十八輪 `requireRoleContextField_()`、第十九輪
  // `resolveAuthoritativeState_()` 係同一套做法。呢度特別重要：
  // 如果冇咗渲染資料就退回「舊嘅反推做法」，個 bug 會靜靜咁復活，
  // 而且**淨係喺有合堂嘅季度先出現**——最難察覺嗰種。
  // ─────────────────────────────────────────────────────────────────────
  // ⚠️ 第三十五輪批次 A 組：`autoGenerateByPostId` **一樣係必要欄位**。
  // ─────────────────────────────────────────────────────────────────────
  //
  // 唔可以「冇就當全部崗位都係自動排」——噉樣就係把一個「我唔知道」
  // 靜靜當成「係」，而後果就係本輪嗰個 bug 原封不動翻生
  //（講員一填，「儲存並確認」永遠撳唔到）。
  // 呢個正正係本專案 bug class 第 2 條，唔可以喺修佢嘅時候順手種返一個。
  if (!context || !context.gridRender || !context.gridRender.labels
    || !context.gridRender.autoGenerateByPostId) {
    throw new Error(
      '人手改動偵測需要 `context.gridRender`'
      + '（顯示標籤／EmptyDisplay／AutoGenerate／ExternalOwner）。\n\n'
      + '收到的值是：' + (context && context.gridRender === undefined
        ? 'undefined（完全沒有傳）' : JSON.stringify(context && context.gridRender)) + '\n\n'
      + '⚠️ 這個欄位不可以省略。偵測人手改動的方法是「算出這一格本來應該\n'
      + '渲染成什麼，再跟 grid 實際內容比對」，沒有這份資料就算不出來。\n\n'
      + '如果退回舊的「由 grid 文字反推人名」做法，「特殊主日」、外部負責單位\n'
      + '（英語堂／華語堂）、「待確認」這些「顯示用」文字會全部被當成\n'
      + '「認不出的人手改動」——第二十輪批次就是這樣，只要季度裡有任何合堂，\n'
      + '「把工作表的人手改動寫成新版本」就完全用不到。\n\n'
      + '修正方法：context 從 `buildFineTuneContext_()` 取得的話已經放好這個欄位；\n'
      + '自己組 context（例如測試 fixture）就用 `buildGridRenderContext_()`'
      + '（RosterWriter.gs）產生，不要自己拼。'
    );
  }

  const changes = [];
  const unresolved = [];

  const manualState = context.original.map(function (a) {
    const key = a.serviceDate + '|' + a.postId + '|' + a.slotIndex;
    const gridText = context.gridValues[key];
    const base = {
      serviceDateId: a.serviceDateId,
      serviceDate: a.serviceDate,
      postId: a.postId,
      slotIndex: a.slotIndex
    };

    // grid 沒有這一格（例如崗位是後來加的）：照抄原值
    if (gridText === undefined) {
      return Object.assign({}, base, { personId: a.personId, isManual: false });
    }

    // ─────────────────────────────────────────────────────────────────
    // ⚠️ 第三十五輪批次 A 組：`AutoGenerate = FALSE` 嘅崗位**整格略過**。
    // ─────────────────────────────────────────────────────────────────
    //
    // 講員／翻譯／獻花呢類崗位嘅值**本來就係自由文字**——外請講員
    //（例如外來嘅客席講員）根本唔喺 `NameMapping`，亦都唔應該喺。
    // 佢哋喺 `RosterAssignments` 只有 `PersonNameSnapshot`、冇 `PersonID`。
    //
    // 修正之前，下面嗰段見到「grid 有字、版本記錄解析出空」就當成
    // 一格認唔出嘅人手改動 ⇒ 整批拒絕建立新版本。
    //
    // 現場後果（2027T3）：**任何一季只要幹事填過講員，
    // 就永遠撳唔到「儲存並確認」。** 而填講員係開季前必做嘅事,
    // 即係呢條路喺真實使用上一定會踩到。
    //
    // 呢啲格嘅唯一寫入途徑係「填講員／翻譯／獻花」
    //（`PreacherTranslationFill.gs`，佢會同時寫長表同 grid），
    // **唔係 grid 人手改動**。所以佢哋唔應該參與人手改動偵測，
    // 亦都唔應該攞去 `NameMapping` 解析。
    //
    // ⚠️ 判斷由 `Posts` 嘅 `AutoGenerate` 讀出嚟，**唔用崗位 ID 白名單**
    // ——崗位會增減，寫死 ID 會喺下一次加崗位嗰陣再爆一次。
    if (context.gridRender.autoGenerateByPostId[a.postId] === false) {
      return Object.assign({}, base, { personId: a.personId, isManual: false });
    }

    // ── 第二十輪批次階段 A2：比對方向由「反推」改成「渲染再比對」 ──
    //
    // 舊做法係比 `gridText` 同 `a.personName`。噉樣嘅話，任何**唔係人名
    // 嘅顯示文字**都會同空白嘅 personName 唔同，於是被當成人手改動：
    // 「特殊主日」、「英語堂」（ExternalOwner）、「⚠ 未能安排」……
    //
    // 實測（2026T4）：2026-10-04 合堂，領詩／司琴顯示「特殊主日」，
    // 令偵測器報 3 格（真改動 1 格 ＋ 誤報 2 格），而且因為嗰兩格
    // 「認唔出」而整批拒絕建立新版本——**有合堂嘅季度就完全用唔到**。
    //
    // 新做法：由 `RosterAssignments` 算出「呢一格本來應該渲染成咩」
    // （`renderExpectedGridText_()`，重用寫 grid 嗰段程式碼），
    // 同 grid 實際內容比對。相等就唔係人手改動。
    // 「特殊主日」對「特殊主日」自然相等，唔需要任何白名單。
    const normalizedGrid = normalizeCellText_(gridText);
    const expectedText = renderExpectedGridText_(
      a, a.postId, a.serviceDate, context.gridRender);
    if (normalizedGrid === normalizeCellText_(expectedText)) {
      return Object.assign({}, base, { personId: a.personId, isManual: false });
    }

    // 到這裡才是真正的人手改動
    const resolvedId = normalizedGrid === '' ? '' : (resolvePersonId(normalizedGrid) || '');

    // 第二道防線：解析到嘅人同原本一樣 ⇒ 實際上冇改到嘢。
    //
    // 用途：幹事重新打咗同一個人（或者佢嘅別名），或者將來多咗一種
    // 顯示文字而上面嘅渲染比對漏咗——只要最終派工一樣，就唔應該騷擾
    // 幹事、更加唔應該擋住建立新版本。
    //
    // ⚠️ **一定要要求 `resolvedId` 非空**。如果寫成
    // `resolvedId === (a.personId || '')`，噉一個空格入面打錯字
    // （解析唔到 ⇒ `resolvedId = ''`，而原本亦係 `''`）就會**靜靜咁
    // 被當成「冇改動」**，幹事打咗嘅嘢憑空消失而且冇任何提示。
    // 呢個正正就係第十八輪嗰個 bug class（缺失被當成有意義嘅值），
    // 唔可以喺修另一個 bug 嘅時候順手種返一個。
    if (resolvedId && resolvedId === a.personId) {
      return Object.assign({}, base, { personId: a.personId, isManual: false });
    }
    // 空白對空白亦都唔係改動（例如佔位文字被刪走，最終一樣係冇人）
    if (normalizedGrid === '' && !a.personId) {
      return Object.assign({}, base, { personId: '', isManual: false });
    }

    if (normalizedGrid !== '' && !resolvedId) {
      unresolved.push(Object.assign({}, base, {
        text: normalizedGrid,
        // 階段 C1：訊息要講得出「本來應該係咩」，幹事先知道自己改壞咗乜
        expectedText: expectedText,
        originalName: a.personName || ''
      }));
    }

    changes.push(Object.assign({}, base, {
      originalPersonId: a.personId,
      originalName: a.personName || '',
      manualPersonId: resolvedId,
      manualText: normalizedGrid
    }));

    return Object.assign({}, base, { personId: resolvedId, isManual: true });
  });

  return { changes: changes, unresolved: unresolved, manualState: manualState };
}

/**
 * 檢查一份派工狀態違反了哪些規則。只檢查 RuleSettings 中 Enabled=TRUE 的規則，
 * 且只回報 HARD 與 SEMI_HARD 級別（SOFT 屬於偏好，不算「被破壞」）。
 * @param {Object[]} state 派工狀態陣列
 * @param {Object} context fine-tune 的資料集
 * @returns {Object[]} 違規清單，每項含定位資訊與 ruleId
 */
function findStateViolations_(state, context) {
  // ⚠️ 第三十輪批次階段 A2：參數次序防線。**唔會自動糾正**——見 ArgShape.gs。
  requireStateArg_('findStateViolations_', 1, state, 'context');
  requireContextArg_('findStateViolations_', 2, context, ['posts', 'serviceDates', 'rules']);

  const violations = [];
  const rules = context.rules;
  const postById = {};
  context.posts.forEach(function (p) { postById[p.postId] = p; });
  const dateInfo = {};
  context.serviceDates.forEach(function (d) { dateInfo[d.serviceDate] = d; });
  const orderedDates = context.serviceDates.map(function (d) { return d.serviceDate; });

  const byDatePost = {};
  const quarterCount = {};
  state.forEach(function (s) {
    if (!s.personId) return;
    if (!byDatePost[s.serviceDate]) byDatePost[s.serviceDate] = {};
    if (!byDatePost[s.serviceDate][s.postId]) byDatePost[s.serviceDate][s.postId] = [];
    byDatePost[s.serviceDate][s.postId].push(s);
    quarterCount[s.personId] = (quarterCount[s.personId] || 0) + 1;
  });

  const add = function (cell, ruleId, reason) {
    const rule = rules[ruleId] || {};
    violations.push({
      serviceDateId: cell.serviceDateId,
      serviceDate: cell.serviceDate,
      postId: cell.postId,
      slotIndex: cell.slotIndex,
      personId: cell.personId,
      isManual: cell.isManual,
      ruleId: ruleId,
      // 第十六輪批次階段 B：同 `makeViolation_()`（Generator.gs）一樣，
      // RuleSettings 冇對應一列時查 `RULE_DEFAULT_LEVELS`。兩處必須一致，
      // 否則同一條規則喺生成同重跑檢查會被當成兩個唔同級別。
      severity: String(rule[COLUMNS.RULE_SETTINGS.LEVEL]
        || RULE_DEFAULT_LEVELS[ruleId] || RULE_LEVELS.SOFT).toUpperCase(),
      reason: reason
    });
  };

  state.forEach(function (cell) {
    if (!cell.personId) return;
    const post = postById[cell.postId];

    if (isRuleEnabled_(rules, RULE_IDS.ELIGIBILITY)) {
      const pool = context.eligibility.byPost[cell.postId] || [];
      if (pool.indexOf(cell.personId) === -1) {
        add(cell, RULE_IDS.ELIGIBILITY, '不在 Eligibility 名單內');
      }
    }
    if (isRuleEnabled_(rules, RULE_IDS.UNAVAILABLE)
        && isPersonUnavailable_(cell.personId, cell.serviceDate, cell.postId, context.unavailable)) {
      add(cell, RULE_IDS.UNAVAILABLE, '該日已表明不能服侍');
    }
    if (post && post.frequency === POST_FREQUENCY.FIRST_SUNDAY && isRuleEnabled_(rules, RULE_IDS.COMMUNION_FIRST_SUNDAY)) {
      const info = dateInfo[cell.serviceDate];
      if (info && !info.isFirstSundayOfMonth) {
        add(cell, RULE_IDS.COMMUNION_FIRST_SUNDAY, '出現在非每月第一主日');
      }
    }
    if (post && !post.autoGenerate && isRuleEnabled_(rules, RULE_IDS.NO_AUTO_GENERATE)) {
      add(cell, RULE_IDS.NO_AUTO_GENERATE, 'AutoGenerate=FALSE 的崗位被派人');
    }

    // ---- 第十六輪批次階段 B：教會新規則 1／2（身分限制）----
    // 呢條係本輪最需要涵蓋到重跑檢查嘅規則：幹事可以喺 grid 直接打一個名，
    // 生成器管唔到，所以只有呢度（步驟 3／5 重跑）同 Verify.gs 捉得到。
    if (post && isRuleEnabledAllowingDefault_(rules, RULE_IDS.ROLE_REQUIRED)) {
      const required = requiredRolesOfPost_(post);
      // 第十八輪批次階段 A2：`undefined` 一律拋錯，唔可以當成空陣列
      if (required.length > 0
          && !personHasAnyRoleOn_(
            requireRoleContextField_(context, 'roles', 'findStateViolations_'),
            cell.personId, required, cell.serviceDate)) {
        // 第十七輪批次階段 D1：訊息由 Roles.gs 嘅共用函式產生，四處一致
        add(cell, RULE_IDS.ROLE_REQUIRED,
          buildRoleRequiredReason_(post, required, cell.serviceDate));
      }
    }

    // ---- 第十六輪批次階段 B：教會新規則 3（個別人士的崗位限制）----
    if (post && isRuleEnabledAllowingDefault_(rules, RULE_IDS.PERSON_POST_EXCLUDED)) {
      const exclusion = findActivePersonPostExclusion_(
        requireRoleContextField_(context, 'personPostExclusions', 'findStateViolations_'),
        cell.personId, cell.postId, cell.serviceDate);
      if (exclusion) {
        add(cell, RULE_IDS.PERSON_POST_EXCLUDED,
          buildPersonPostExcludedReason_(post, exclusion));
      }
    }
  });

  // 次數上限每人只回報一次，掛在該人最後一個主日的格上。
  // 若放在逐格迴圈內，一個做了 9 次的人會產生 9 項違規，把提案清單淹沒。
  if (isRuleEnabled_(rules, RULE_IDS.MAX_PER_QUARTER)) {
    const dateOrder = {};
    orderedDates.forEach(function (d, i) { dateOrder[d] = i; });

    const lastCellByPerson = {};
    state.forEach(function (cell) {
      if (!cell.personId) return;
      const current = lastCellByPerson[cell.personId];
      if (!current || (dateOrder[cell.serviceDate] || 0) >= (dateOrder[current.serviceDate] || 0)) {
        lastCellByPerson[cell.personId] = cell;
      }
    });

    Object.keys(lastCellByPerson).forEach(function (personId) {
      const limit = resolveAssignmentLimit_(personId, context);
      const used = quarterCount[personId] || 0;
      if (used > limit) {
        add(lastCellByPerson[personId], RULE_IDS.MAX_PER_QUARTER,
          '本季共 ' + used + ' 次，超過上限 ' + limit);
      }
    });
  }

  // 同週同崗位重複
  if (isRuleEnabled_(rules, RULE_IDS.DISTINCT_SLOT)) {
    Object.keys(byDatePost).forEach(function (dateStr) {
      Object.keys(byDatePost[dateStr]).forEach(function (postId) {
        const post = postById[postId];
        if (!post || !post.distinctWithinPost) return;
        const seen = {};
        byDatePost[dateStr][postId].forEach(function (cell) {
          if (seen[cell.personId]) {
            add(cell, RULE_IDS.DISTINCT_SLOT, '同週同崗位重複派了同一人');
          }
          seen[cell.personId] = true;
        });
      });
    });
  }

  // 連續兩週同一人
  if (isRuleEnabled_(rules, RULE_IDS.NO_CONSECUTIVE)) {
    for (let i = 1; i < orderedDates.length; i++) {
      const prevDate = orderedDates[i - 1];
      const curDate = orderedDates[i];
      const prevPosts = byDatePost[prevDate] || {};
      const curPosts = byDatePost[curDate] || {};
      Object.keys(curPosts).forEach(function (postId) {
        const post = postById[postId];
        if (!post || post.allowConsecutive === ALLOW_CONSECUTIVE.ALLOW) return;
        const prevPeople = (prevPosts[postId] || []).map(function (c) { return c.personId; });
        curPosts[postId].forEach(function (cell) {
          if (prevPeople.indexOf(cell.personId) !== -1) {
            add(cell, RULE_IDS.NO_CONSECUTIVE, '上一週同崗位已是此人');
          }
        });
      });
    }
  }

  // HARD 一律回報；SEMI_HARD 預設也回報，可用 Config 的 WARN_ON_SEMI_HARD_BREAK=FALSE
  // 關閉（context.warnOnSemiHard，見 buildFineTuneContext_()）。另有白名單的 SOFT
  // 規則固定回報，不受這個開關影響，它們的 severity 維持 SOFT，不會被當成硬規則違反。
  return violations.filter(function (v) {
    if (v.severity === RULE_LEVELS.HARD) return true;
    if (v.severity === RULE_LEVELS.SEMI_HARD && context.warnOnSemiHard) return true;
    return FINETUNE_REPORTED_SOFT_RULES.indexOf(v.ruleId) !== -1;
  });
}

/**
 * 針對被破壞的規則計算最小改動方案，最多提出 Config 的 FINETUNE_MAX_MOVES 個建議。
 * 優先改動「非人手改過」的格，以尊重幹事的意圖；
 * 若違規格本身就是人手改動，才回頭建議改該格。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{batchId: string, proposals: Object[], changes: Object[], violations: Object[]}} 建議方案
 */
function proposeMinimalFix(quarterId, versionNo) {
  const context = buildFineTuneContext_(quarterId, versionNo);
  const analysis = analyseManualState_(context);
  const batchId = 'FT-' + quarterId + '-v' + versionNo + '-'
    + compactTimestamp_();

  // 以 BaseVersion 的派工作為 OriginalPersonID 的來源。
  // key 一律經 cellKey_() 產生，避免 SlotIndex 有時是數字有時是文字而查不到。
  const originalByKey = {};
  context.original.forEach(function (a) {
    originalByKey[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a;
  });

  const proposals = [];
  const unfixable = [];
  const handled = {};

  // 循序處理：每產生一項建議就把它視為已生效，再據此計算下一項。
  // 否則逐項獨立計算會出現「兩項提案都建議同一人」而製造出新的連續兩週違反。
  let workingState = analysis.manualState;

  while (proposals.length < context.maxMoves) {
    const violations = findStateViolations_(workingState, context);
    const violation = violations.filter(function (v) {
      return !handled[cellKey_(v.serviceDate, v.postId, v.slotIndex)];
    })[0];
    if (!violation) break;

    const key = cellKey_(violation.serviceDate, violation.postId, violation.slotIndex);
    handled[key] = true;

    const replacement = findReplacementPerson_(violation, workingState, context);
    const original = originalByKey[key] || {};
    if (!original.personId) {
      log_('WARN', 'proposeMinimalFix: 找不到 ' + key + ' 在 v' + versionNo
        + ' 的原始派工，OriginalPersonID 會留空，該行不能使用 REVERT_ORIGINAL');
    }

    const post = findPostById_(context.posts, violation.postId);
    proposals.push({
      batchId: batchId,
      quarterId: quarterId,
      baseVersionNo: versionNo,
      serviceDateId: violation.serviceDateId,
      serviceDate: violation.serviceDate,
      postId: violation.postId,
      postNameTC: post ? post.postNameTC : violation.postId,
      slotIndex: violation.slotIndex,
      slotCount: post ? post.slotCount : 1,
      severityLevel: violation.severity,
      suggestedName: replacement.personId
        ? nameOfPersonId_(context, replacement.personId) : '',
      manualName: nameOfPersonId_(context, violation.personId),
      originalPersonId: original.personId || '',
      manualPersonId: violation.personId,
      suggestedPersonId: replacement.personId,
      brokenRuleId: violation.ruleId,
      severity: violation.severity,
      reason: violation.reason + '；' + replacement.reason
    });

    if (replacement.personId) {
      // 把這項建議套進工作狀態，令下一項建議看得見它的影響
      workingState = substituteCell_(workingState, key, replacement.personId);
    } else {
      unfixable.push({
        serviceDate: violation.serviceDate,
        postId: violation.postId,
        slotIndex: violation.slotIndex,
        ruleId: violation.ruleId,
        reason: replacement.reason
      });
    }
  }

  return {
    batchId: batchId,
    proposals: proposals,
    unfixable: unfixable,
    changes: analysis.changes,
    unresolved: analysis.unresolved,
    violations: analysis.violations
  };
}

/**
 * 依 PostID 在崗位清單中尋找崗位。
 * @param {Object[]} posts 崗位清單
 * @param {string} postId 崗位 ID
 * @returns {?Object} 崗位資料；找不到時回傳 null
 */
function findPostById_(posts, postId) {
  for (let i = 0; i < posts.length; i++) {
    if (posts[i].postId === postId) return posts[i];
  }
  return null;
}

/**
 * 依 PersonID 取得中文姓名，供提案清單顯示。
 * @param {Object} context fine-tune 的資料集
 * @param {string} personId 對象的 PersonID
 * @returns {string} 中文姓名；查不到時回傳 PersonID 或「（空白）」
 */
function nameOfPersonId_(context, personId) {
  if (!personId) return '（空白）';
  const person = context.peopleById[personId];
  return person ? person.nameTC : personId;
}

/**
 * 統計某批次各種 Decision 的數量，供「套用決定」在執行前檢查有無未決定的行。
 * @param {string} batchId 批次 ID
 * @returns {{total: number, pending: number, byDecision: Object.<string, number>}} 統計結果
 */
function summariseBatchDecisions(batchId) {
  const C = COLUMNS.FINE_TUNE_PROPOSALS;
  const rows = readSheet(SHEETS.FINE_TUNE_PROPOSALS).filter(function (row) {
    return row[C.BATCH_ID] === batchId;
  });

  const byDecision = {};
  let pending = 0;
  rows.forEach(function (row) {
    const decision = String(row[C.DECISION] || '').trim().toUpperCase() || FINETUNE_DECISION.PENDING;
    byDecision[decision] = (byDecision[decision] || 0) + 1;
    if (decision === FINETUNE_DECISION.PENDING) pending++;
  });

  return { total: rows.length, pending: pending, byDecision: byDecision };
}

/**
 * 回傳一份把指定格換成另一人的新狀態陣列，原陣列不受影響。
 * @param {Object[]} state 目前的派工狀態
 * @param {string} key 要替換的格子鍵（cellKey_ 產生）
 * @param {string} personId 新的 PersonID
 * @returns {Object[]} 新的狀態陣列
 */
function substituteCell_(state, key, personId) {
  return state.map(function (s) {
    if (cellKey_(s.serviceDate, s.postId, s.slotIndex) !== key) return s;
    return {
      serviceDateId: s.serviceDateId,
      serviceDate: s.serviceDate,
      postId: s.postId,
      slotIndex: s.slotIndex,
      personId: personId,
      isManual: s.isManual
    };
  });
}

/**
 * 為違規的格子尋找替代人選：在該崗位的合資格名單中，
 * 找一位不會造成任何 HARD／SEMI_HARD 違規的人。
 * @param {Object} violation 違規紀錄
 * @param {Object[]} state 目前的派工狀態
 * @param {Object} context fine-tune 的資料集
 * @returns {{personId: string, reason: string}} 建議人選；找不到時 personId 為空字串
 */
function findReplacementPerson_(violation, state, context) {
  // ⚠️ 第三十輪批次階段 A2：同 `findStateViolations_()` 一樣收 `(…, state, context)`。
  requireStateArg_('findReplacementPerson_', 2, state, 'context');
  requireContextArg_('findReplacementPerson_', 3, context, ['eligibility']);

  const pool = (context.eligibility.byPost[violation.postId] || []).slice().sort();
  const key = cellKey_(violation.serviceDate, violation.postId, violation.slotIndex);

  // 先記下目前已存在的違規，之後只拒絕「新增」的違規，
  // 不會因為表上別處本來就有的問題而否決一個本身可行的人選。
  const existingKeys = {};
  findStateViolations_(state, context).forEach(function (v) {
    existingKeys[violationKey_(v)] = true;
  });

  let quotaBlocked = 0;
  let sideEffectBlocked = 0;

  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    if (candidate === violation.personId) continue;
    if (!context.peopleById[candidate]) continue;

    const trial = substituteCell_(state, key, candidate);

    // MAX_PER_QUARTER 是 SOFT 級別，不會出現在 findStateViolations_ 的結果，
    // 所以要另外檢查，否則建議會令某人的次數超出上限。
    if (exceedsAssignmentLimit_(candidate, trial, context)) {
      quotaBlocked++;
      continue;
    }

    const trialViolations = findStateViolations_(trial, context);
    const targetStillBroken = trialViolations.some(function (v) {
      return cellKey_(v.serviceDate, v.postId, v.slotIndex) === key;
    });
    if (targetStillBroken) continue;

    // 換人可能在相鄰週製造新的違反，所以要檢查整張表而不只是目標格
    const introduced = trialViolations.filter(function (v) {
      return !existingKeys[violationKey_(v)];
    });
    if (introduced.length > 0) {
      sideEffectBlocked++;
      continue;
    }

    const person = context.peopleById[candidate];
    return { personId: candidate, reason: '建議改派 ' + (person ? person.nameTC : candidate) };
  }

  const notes = [];
  if (quotaBlocked > 0) notes.push(quotaBlocked + ' 人會超出次數上限');
  if (sideEffectBlocked > 0) notes.push(sideEffectBlocked + ' 人會造成其他格新違反');
  return {
    personId: '',
    reason: '找不到不衝突的人選' + (notes.length > 0 ? '（' + notes.join('、') + '）' : '') + '，需要人手處理'
  };
}

/**
 * 組出用於比對違規是否相同的鍵：同一格、同一條規則視為同一項違規。
 * @param {Object} violation 違規紀錄
 * @returns {string} 違規鍵
 */
function violationKey_(violation) {
  return cellKey_(violation.serviceDate, violation.postId, violation.slotIndex) + '|' + violation.ruleId;
}

/**
 * 檢查某人在指定狀態下的服侍次數是否超出其上限。
 * 上限取個人的 MaxPerQuarter，沒有設定時用 SOFT_MAX_PER_QUARTER 的 TargetValue，
 * 再退回 Config 的 DEFAULT_MAX_PER_QUARTER。
 * @param {string} personId 要檢查的 PersonID
 * @param {Object[]} state 派工狀態（已套用擬議的替換）
 * @param {Object} context fine-tune 的資料集
 * @returns {boolean} 是否超出上限
 */
function exceedsAssignmentLimit_(personId, state, context) {
  // ⚠️ 第三十輪批次階段 A2：同上。
  requireStateArg_('exceedsAssignmentLimit_', 2, state, 'context');
  requireContextArg_('exceedsAssignmentLimit_', 3, context, ['peopleById']);

  const limit = resolveAssignmentLimit_(personId, context);
  let count = 0;
  state.forEach(function (s) { if (s.personId === personId) count++; });
  return count > limit;
}

/**
 * 取得某人的每季次數上限：優先用 NameMapping 的個人 MaxPerQuarter，
 * 其次用 SOFT_MAX_PER_QUARTER 的 TargetValue，最後退回 Config 的 DEFAULT_MAX_PER_QUARTER。
 * @param {string} personId 對象的 PersonID
 * @param {Object} context fine-tune 的資料集
 * @returns {number} 次數上限
 */
function resolveAssignmentLimit_(personId, context) {
  const person = context.peopleById[personId];
  const rule = context.rules[RULE_IDS.MAX_PER_QUARTER];
  const ruleTarget = rule ? Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : NaN;
  const personMax = (person && person.maxPerQuarter !== null && person.maxPerQuarter !== undefined
    && !isNaN(person.maxPerQuarter))
    ? Number(person.maxPerQuarter)
    : NaN;

  if (!isNaN(personMax)) return personMax;
  return isNaN(ruleTarget) ? context.maxPerQuarterDefault : ruleTarget;
}

/**
 * 把建議方案寫入 FineTuneProposals 工作表（附加在現有資料之後），Decision 欄留空待決定。
 * @param {Object} result proposeMinimalFix() 的結果
 * @returns {number} 寫入的列數
 */
function writeProposals(result) {
  if (result.proposals.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.FINE_TUNE_PROPOSALS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.FINE_TUNE_PROPOSALS);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.FINE_TUNE_PROPOSALS;

  const rows = result.proposals.map(function (p, i) {
    const record = {};
    record[C.PROPOSAL_ID] = p.batchId + '-' + (i + 1);
    record[C.BATCH_ID] = p.batchId;
    record[C.QUARTER_ID] = p.quarterId;
    record[C.BASE_VERSION_NO] = p.baseVersionNo;
    record[C.SERVICE_DATE_ID] = p.serviceDateId;
    record[C.POST_ID] = p.postId;
    record[C.SLOT_INDEX] = p.slotIndex;
    record[C.ORIGINAL_PERSON_ID] = p.originalPersonId;
    record[C.MANUAL_PERSON_ID] = p.manualPersonId;
    record[C.SUGGESTED_PERSON_ID] = p.suggestedPersonId;
    record[C.BROKEN_RULE_ID] = p.brokenRuleId;
    record[C.SEVERITY] = p.severity;
    record[C.REASON] = p.reason;
    record[C.DECISION] = FINETUNE_DECISION.PENDING;
    record[C.DECIDED_BY] = '';
    record[C.DECIDED_AT] = '';
    record[C.RESULT_VERSION_NO] = '';
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  applyDecisionValidation_(sheet, headers);
  applyTimestampFormat_(sheet, headers, [C.DECIDED_AT], startRow, rows.length);
  return rows.length;
}

/**
 * 在 Decision 欄加上下拉選單，只容許 schema 定義的四個值。
 *
 * 套用範圍是**整欄**（第 3 行到 sheet.getMaxRows()），不是只套用在剛寫入的那幾行——
 * 這是 Q-3 測試在 Requests 發現同類問題（資料驗證只套在建立時的某幾行，其餘既有列
 * 沒有驗證，一旦被手動清掉就沒有補救機制）後，回頭稽核全專案 setDataValidation()
 * 呼叫點時一併抓到並修正的。每次呼叫都重新覆蓋整欄，即使某幾行的驗證被手動清掉，
 * 下一次寫入提案或套用決定時都會自動補回來。
 * @param {Sheet} sheet FineTuneProposals 工作表
 * @param {string[]} headers 標題列
 * @returns {void}
 */
function applyDecisionValidation_(sheet, headers) {
  const decisionColumn = headers.indexOf(COLUMNS.FINE_TUNE_PROPOSALS.DECISION) + 1;
  if (decisionColumn === 0) return;

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(FINETUNE_DECISION_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText('請選擇：PENDING（未決定）／KEEP_MANUAL（保留你的改動）／'
      + 'ACCEPT_SUGGESTED（採用系統建議）／REVERT_ORIGINAL（還原為系統原本排的人）')
    .build();
  sheet.getRange(3, decisionColumn, Math.max(1, sheet.getMaxRows() - 2), 1).setDataValidation(rule);
}

/**
 * 按 FineTuneProposals 中該批次的 Decision 欄產生新版本。
 * Decision=ACCEPT 採用 SuggestedPersonID，其餘一律保留幹事的人手改動。
 * @param {string} batchId 批次 ID
 * @returns {{sheetName: string, versionNo: number, accepted: number, total: number}} 新版本資訊
 */
function applyDecisions(batchId) {
  const C = COLUMNS.FINE_TUNE_PROPOSALS;
  const proposalRows = readSheet(SHEETS.FINE_TUNE_PROPOSALS).filter(function (row) {
    return row[C.BATCH_ID] === batchId;
  });
  if (proposalRows.length === 0) throw new Error('找不到批次: ' + batchId);

  const quarterId = proposalRows[0][C.QUARTER_ID];
  const baseVersionNo = Number(proposalRows[0][C.BASE_VERSION_NO]);
  const context = buildFineTuneContext_(quarterId, baseVersionNo);
  const analysis = analyseManualState_(context);

  // 逐格的決定；沒有提案的格一律照抄，不會經過任何排表運算
  const decisionByKey = {};
  proposalRows.forEach(function (row) {
    const key = cellKey_(row[C.SERVICE_DATE_ID], row[C.POST_ID], row[C.SLOT_INDEX]);
    decisionByKey[key] = {
      decision: String(row[C.DECISION] || '').trim().toUpperCase(),
      suggested: String(row[C.SUGGESTED_PERSON_ID] || '').trim(),
      original: String(row[C.ORIGINAL_PERSON_ID] || '').trim(),
      manual: String(row[C.MANUAL_PERSON_ID] || '').trim()
    };
  });

  const originalByKey = {};
  context.original.forEach(function (a) {
    originalByKey[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a;
  });

  let acceptedCount = 0;
  let revertedCount = 0;
  let manualKeptCount = 0;
  const revertBlocked = [];

  const assignments = analysis.manualState.map(function (s) {
    const decisionKey = cellKey_(s.serviceDateId, s.postId, s.slotIndex);
    const entry = decisionByKey[decisionKey];
    const originalRow = originalByKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] || {};

    // 預設：完全照抄目前狀態（BaseVersionNo 的派工，加上幹事已作的人手改動）
    let personId = s.personId;
    let source = s.isManual ? ASSIGN_SOURCE.MANUAL : (originalRow.assignSource || ASSIGN_SOURCE.AUTO);

    if (entry) {
      if (entry.decision === FINETUNE_DECISION.ACCEPT_SUGGESTED && entry.suggested) {
        personId = entry.suggested;
        source = ASSIGN_SOURCE.FINE_TUNED;
        acceptedCount++;
      } else if (entry.decision === FINETUNE_DECISION.REVERT_ORIGINAL) {
        // OriginalPersonID 為空時不可還原，否則會把該格洗成空白
        const fallbackOriginal = entry.original || originalRow.personId || '';
        if (!fallbackOriginal) {
          revertBlocked.push({
            key: decisionKey,
            serviceDate: s.serviceDate,
            postId: s.postId,
            slotIndex: s.slotIndex
          });
          manualKeptCount++;
        } else {
          personId = fallbackOriginal;
          source = originalRow.assignSource || ASSIGN_SOURCE.AUTO;
          revertedCount++;
        }
      } else {
        // KEEP_MANUAL 與 PENDING 都保留幹事的現況，即上面的預設值
        manualKeptCount++;
      }
    }

    const person = context.peopleById[personId];
    // ─────────────────────────────────────────────────────────────────
    // ⚠️ 第三十六輪批次：**呢度係第五條建立版本嘅路，而且兩樣都壞。**
    // ─────────────────────────────────────────────────────────────────
    //
    // 全系統一共有五條路會 `writeAssignments()` 建立新版本：
    //   1. `performRosterGeneration_()`（MultiRun.gs）　　生成初稿
    //   2. `applyRequests_()`（RequestsApply.gs）　　　　 套用申報
    //   3. `materialiseManualEdits_()`（StateSource.gs）　純人手改動
    //   4. `applyDecisions()`（**呢度**）　　　　　　　　 微調提案
    //   5. `apiRollbackExecute()`（WebAppRollback.gs）　　回到上一個版本
    //
    // 之前三輪逐個修 2、3，但**冇人數過總共有幾多條**，所以呢一條
    // 由頭到尾冇被查過。佢兩個 bug 都有：
    //
    //   `personName: person ? person.nameTC : ''`
    //     ⇒ 非自動崗位（講員／翻譯／獻花）嘅自由文字蒸發（同 A 組一樣）
    //   `ruleFlags: []`
    //     ⇒ 跳過原因整批丟失，格子分類全部倒入「未能安排」（同甲5 一樣）
    //
    // 兩條都照返已經驗證過嘅寫法：認唔到人而且唔係今次改動 ⇒ 原封不動搬。
    const touchedByDecision = !!(entry
      && entry.decision !== FINETUNE_DECISION.KEEP_MANUAL
      && entry.decision !== FINETUNE_DECISION.PENDING);
    return {
      serviceDateId: s.serviceDateId,
      serviceDate: s.serviceDate,
      postId: s.postId,
      slotIndex: s.slotIndex,
      personId: personId || '',
      personName: person
        ? person.nameTC
        : ((s.isManual || touchedByDecision) ? '' : (originalRow.personName || '')),
      assignSource: personId ? source : ASSIGN_SOURCE.SKIPPED,
      // 呢一格今次真係被改過 ⇒ 舊嘅跳過原因唔再適用（佢描述緊舊嗰個佔用者）；
      // 冇被改過 ⇒ 原因原封不動保留。同 `materialiseManualEdits_()` 一致。
      ruleFlags: (s.isManual || touchedByDecision) ? [] : ((originalRow.ruleFlags || []).slice())
    };
  });

  revertBlocked.forEach(function (blocked) {
    writeAuditLog_({
      action: 'FINETUNE_REVERT_BLOCKED',
      targetSheet: SHEETS.FINE_TUNE_PROPOSALS,
      targetKey: batchId + ' / ' + blocked.key,
      oldValue: '',
      newValue: '',
      source: 'applyDecisions',
      notes: 'Decision 為 REVERT_ORIGINAL 但 OriginalPersonID 為空，已略過該行以免寫入空值'
    });
  });

  const newVersionNo = findLatestVersionNo(quarterId) + 1;
  const remainingViolations = findStateViolations_(
    assignments.map(function (a) {
      return {
        serviceDateId: a.serviceDateId,
        serviceDate: a.serviceDate,
        postId: a.postId,
        slotIndex: a.slotIndex,
        personId: a.personId,
        isManual: false
      };
    }),
    context
  );
  const warnings = remainingViolations.map(function (v) {
    return makeWarning_(v, v.ruleId, v.reason);
  });

  const sheetName = createRosterSheet(quarterId, newVersionNo, assignments, warnings);
  writeAssignments(quarterId, newVersionNo, assignments);
  registerVersion(quarterId, newVersionNo, sheetName, VERSION_VALUES.BASIS_FINE_TUNE, baseVersionNo, warnings.length, false);
  markProposalsApplied_(batchId, newVersionNo);
  const archived = archiveOldProposals_(batchId);

  return {
    sheetName: sheetName,
    versionNo: newVersionNo,
    accepted: acceptedCount,
    reverted: revertedCount,
    manualKept: manualKeptCount,
    revertBlocked: revertBlocked,
    archived: archived,
    total: proposalRows.length
  };
}

/**
 * 把除了指定批次以外的提案搬到 FineTuneProposals_Archive，令主表只保留最新一批。
 * 封存表不存在時自動建立，並沿用主表的標題列。
 * @param {string} keepBatchId 要保留在主表的批次 ID
 * @returns {number} 已搬走的行數
 */
function archiveOldProposals_(keepBatchId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.FINE_TUNE_PROPOSALS);
  if (!sheet) return 0;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) return 0;

  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const batchColumn = headers.indexOf(COLUMNS.FINE_TUNE_PROPOSALS.BATCH_ID) + 1;
  if (batchColumn === 0) return 0;

  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const keepRows = [];
  const archiveRows = [];
  values.forEach(function (row) {
    const isEmpty = row.every(function (cell) { return cell === '' || cell === null; });
    if (isEmpty) return;
    if (String(row[batchColumn - 1]) === keepBatchId) {
      keepRows.push(row);
    } else {
      archiveRows.push(row);
    }
  });
  if (archiveRows.length === 0) return 0;

  const archive = ss.getSheetByName(FINETUNE_ARCHIVE_SHEET) || createProposalArchive_(ss, headers);
  const archiveStartRow = archive.getLastRow() + 1;
  archive.getRange(archiveStartRow, 1, archiveRows.length, lastCol).setValues(archiveRows);
  applyTimestampFormat_(archive, headers, [COLUMNS.FINE_TUNE_PROPOSALS.DECIDED_AT],
    archiveStartRow, archiveRows.length);

  // 重寫主表的資料區：只留下要保留的批次。
  // 一併 clearFormat()：保留行會被搬到新的行號，若不清除就會沿用該位置原本那行的格式，
  // 導致剛才在 markProposalsApplied_ 設好的時間戳格式失效（DecidedAt 又變回只顯示日期）。
  sheet.getRange(3, 1, lastRow - 2, lastCol)
    .clearContent()
    .clearDataValidations()
    .clearFormat();

  if (keepRows.length > 0) {
    sheet.getRange(3, 1, keepRows.length, lastCol).setValues(keepRows);
    applyDecisionValidation_(sheet, headers);
    applyTimestampFormat_(sheet, headers, [COLUMNS.FINE_TUNE_PROPOSALS.DECIDED_AT],
      3, keepRows.length);
  }
  return archiveRows.length;
}

/**
 * 建立提案封存工作表，沿用主表的標題列。
 * @param {Spreadsheet} ss 試算表
 * @param {string[]} headers 主表的標題列
 * @returns {Sheet} 新建立的封存工作表
 */
function createProposalArchive_(ss, headers) {
  const archive = ss.insertSheet(FINETUNE_ARCHIVE_SHEET);
  archive.getRange(1, 1).setValue('已套用的 fine-tune 提案封存，由「套用決定」自動搬入，僅供查閱。');
  archive.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
  archive.setFrozenRows(2);
  return archive;
}

/**
 * 在 FineTuneProposals 回填該批次的 DecidedBy / DecidedAt / ResultVersionNo。
 * @param {string} batchId 批次 ID
 * @param {number} resultVersionNo 產生的新版本號
 * @returns {void}
 */
function markProposalsApplied_(batchId, resultVersionNo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.FINE_TUNE_PROPOSALS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.FINE_TUNE_PROPOSALS;
  const batchCol = headers.indexOf(C.BATCH_ID) + 1;
  const decidedByCol = headers.indexOf(C.DECIDED_BY) + 1;
  const decidedAtCol = headers.indexOf(C.DECIDED_AT) + 1;
  const resultCol = headers.indexOf(C.RESULT_VERSION_NO) + 1;
  if (batchCol === 0) return;

  const batchValues = sheet.getRange(3, batchCol, lastRow - 2, 1).getValues();
  const actor = Session.getActiveUser().getEmail();
  const now = nowTimestamp_();

  batchValues.forEach(function (row, i) {
    if (row[0] !== batchId) return;
    const rowNumber = i + 3;
    if (decidedByCol > 0) sheet.getRange(rowNumber, decidedByCol).setValue(actor);
    if (decidedAtCol > 0) {
      sheet.getRange(rowNumber, decidedAtCol).setValue(now);
      applyTimestampFormat_(sheet, headers, [C.DECIDED_AT], rowNumber, 1);
    }
    if (resultCol > 0) sheet.getRange(rowNumber, resultCol).setValue(resultVersionNo);
  });
}
