/**
 * 第六十七輪批次 AF 組：**把人手編好嘅整季職事表匯入系統。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要有呢一支
 * ═════════════════════════════════════════════════════════════════════
 *
 * Ivan 嘅要求（功能 5）：「季度用舊方法開始的話，可以把整季匯入系統，之後用介面繼續。」
 * 之前**完全冇**——用舊方法排好嘅一季，要入系統只可以逐格打入 grid。
 *
 * 三步，全部由幹事介面「進階與診斷 ▸ 匯入人手編好的職事表」入：
 *
 *   一、產生匯入範本（`apiCreateImportSheet()`）——工作表 `匯入_<季度>`，**唔寫任何派工**。
 *       版面同舊式人手職事表同一個方向：每一行係一個崗位嘅一個位置、每一欄係一個主日，
 *       方便由舊表整塊複製貼上。崗位、位置數、主日、特別主日一律由工作表讀出。
 *       每格有該崗位合資格名單嘅下拉，但**容許打名單以外嘅字**（貼上唔會被擋）。
 *       結構性不適用／特別主日跳過嘅格塗灰寫「—」。
 *   二、檢查（`apiCheckImportSheet()`，唯讀）——認唔出嘅名字**擋住**；硬規則違反要打字放行
 *      （放行用 AG 組嘅格式記住）；空格只警告（AH 組同一支）；灰格有名就警告並忽略；
 *       講員／翻譯／獻花照收（`MANUAL`），客席講員認唔出名字唔算錯。
 *   三、匯入成為版本（`apiImportRosterExecute()`）——冇版本 ⇒ 第 0 版；有 ⇒ 新一版。
 *       `Basis=IMPORT`、全部格 `AssignSource=MANUAL`，**走現有嘅 `createRosterSheet()`／
 *       `writeAssignments()`／`registerVersion()`**，之後重新發佈公開連結。
 *       幹事可以聲明「已經在系統外寄給全體」⇒ Stage 推到 `OFFICIAL_SENT`，每位有派工嘅人
 *       寫一行 `SendLog`（`Stage=OFFICIAL`、`Status=EXTERNAL`、hash 照現有算法），**唔寄任何電郵**。
 *
 * ⚠️ 名字解析、規則檢查、空格定義、放行紀錄全部用現有函式——呢度只係把佢哋接起嚟。
 */

/** 匯入範本工作表名。 */
function buildImportSheetName_(quarterId) {
  return IMPORT_SHEET_PREFIX + String(quarterId || '').trim();
}

/**
 * 匯入範本嘅結構：行（崗位×位置）、欄（主日）、灰格（不適用）。全部由工作表讀出。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, timezone: string, posts: Object[], serviceDates: Object[],
 *   rows: Object[], naByKey: Object.<string, string>, specialTitleByDate: Object}}
 *   `rows[i] = {postId, slotIndex, label, post}`；`naByKey['date|post|slot'] = ruleId`
 */
function buildImportLayout_(quarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const posts = readPostsNormalized()
    .filter(function (p) { return p.postId; })
    .sort(function (a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
  const serviceDates = readServiceDatesNormalized(quarterId, timezone);
  if (serviceDates.length === 0) {
    throw new Error('ServiceDates 找不到 ' + quarterId + ' 的主日，請先在「開季前準備」建立這一季。');
  }
  const specialByDate = buildSpecialSundayByDate_(readSpecialSundays(quarterId), timezone);
  const rules = readRules();

  const rows = [];
  const naByKey = {};
  posts.forEach(function (post) {
    for (let slot = 1; slot <= (post.slotCount || 1); slot++) {
      rows.push({
        postId: post.postId,
        slotIndex: slot,
        label: post.postNameTC + ((post.slotCount || 1) > 1 ? ' ' + slot : ''),
        post: post
      });
      serviceDates.forEach(function (d) {
        const special = specialByDate[d.serviceDate] || { skipPostIds: [], lockPostIds: [] };
        const skip = getSkipReason_(post, d, special, rules);
        // 只有「結構性不適用」同「特別主日跳過」先係灰格；講員／翻譯／獻花嗰種
        // `AutoGenerate=FALSE` 係**要幹事自己填**嘅，唔灰。
        if (skip && (STRUCTURAL_NA_RULE_IDS.indexOf(skip.ruleId) !== -1
          || SPECIAL_SKIP_RULE_IDS.indexOf(skip.ruleId) !== -1)) {
          naByKey[cellKey_(d.serviceDate, post.postId, slot)] = skip.ruleId;
        }
      });
    }
  });

  return {
    quarterId: quarterId,
    timezone: timezone,
    posts: posts,
    serviceDates: serviceDates,
    rows: rows,
    naByKey: naByKey,
    specialTitleByDate: buildSpecialSundayTitleIndex_(quarterId, timezone)
  };
}

/**
 * 供前端呼叫：建立 `匯入_<季度>` 範本。**會寫入**（建一張新工作表），但唔寫任何派工。
 * 已存在就唔覆蓋，直接回傳連結——幹事可能已經貼咗一半。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{created: boolean, sheetName: string, url: string, rowCount: number, dateCount: number, naCount: number}}
 */
function apiCreateImportSheet(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('建立匯入範本', function () {
    const q = String(quarterId || '').trim();
    const sheetName = buildImportSheetName_(q);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const layout = buildImportLayout_(q);
    const existing = ss.getSheetByName(sheetName);
    if (existing) {
      return {
        created: false, sheetName: sheetName, url: buildGridSheetUrl_(sheetName),
        rowCount: layout.rows.length, dateCount: layout.serviceDates.length,
        naCount: Object.keys(layout.naByKey).length
      };
    }

    const sheet = ss.insertSheet(sheetName);
    const dateCount = layout.serviceDates.length;
    const totalCols = IMPORT_LABEL_COLUMNS + dateCount;

    // 第 1 行：日期標題（特別主日附名稱）；第 2 行：日期機器鍵（隱藏）
    const header = ['崗位', '（機器鍵）'].concat(layout.serviceDates.map(function (d) {
      const title = layout.specialTitleByDate[d.serviceDate];
      // `yyyy-MM-dd` → `MM-dd`（同 grid 日期欄同一個格式）
      return d.serviceDate.slice(5) + (title ? '\n' + title : '');
    }));
    const keyRow = ['KEY', 'POST#SLOT'].concat(layout.serviceDates.map(function (d) { return d.serviceDate; }));
    sheet.getRange(1, 1, 1, totalCols).setValues([header]).setFontWeight('bold').setWrap(true);
    sheet.getRange(2, 1, 1, totalCols).setValues([keyRow]);

    // 第 3 行起：每個崗位位置一行
    const body = layout.rows.map(function (r) {
      return [r.label, r.postId + '#' + r.slotIndex].concat(layout.serviceDates.map(function (d) {
        return layout.naByKey[cellKey_(d.serviceDate, r.postId, r.slotIndex)] ? IMPORT_NA_MARK : '';
      }));
    });
    if (body.length > 0) {
      sheet.getRange(IMPORT_HEADER_ROWS + 1, 1, body.length, totalCols).setValues(body);
    }

    // 灰格＋下拉（容許名單以外嘅字——同 grid 嘅名單選單同一條規矩，見 GridNameDropdown.gs 檔頭）
    const eligibility = readEligibility();
    const nameById = {};
    readPeople().forEach(function (row) {
      const id = String(row[COLUMNS.NAME_MAPPING.PERSON_ID] || '').trim();
      if (id) nameById[id] = String(row[COLUMNS.NAME_MAPPING.NAME_TC] || '').trim();
    });
    layout.rows.forEach(function (r, i) {
      const rowNo = IMPORT_HEADER_ROWS + 1 + i;
      layout.serviceDates.forEach(function (d, j) {
        if (layout.naByKey[cellKey_(d.serviceDate, r.postId, r.slotIndex)]) {
          sheet.getRange(rowNo, IMPORT_LABEL_COLUMNS + 1 + j).setBackground(IMPORT_NA_BACKGROUND);
        }
      });
      if (r.post.autoGenerate === false) return;   // 講員／翻譯／獻花：自由文字，唔設選單
      const names = (eligibility.byPost[r.postId] || [])
        .map(function (pid) { return nameById[pid]; })
        .filter(function (n) { return !!n; })
        .sort();
      if (names.length === 0) return;
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(names, true)
        .setAllowInvalid(true)
        .setHelpText('可以在選單裡面選，也可以直接貼上名單以外的名——檢查的時候會逐個列出來。')
        .build();
      try {
        sheet.getRange(rowNo, IMPORT_LABEL_COLUMNS + 1, 1, dateCount).setDataValidation(rule);
      } catch (err) {
        log_('WARN', '匯入範本 ' + sheetName + ' 第 ' + rowNo + ' 行設不到下拉：' + err.message);
      }
    });

    sheet.hideRows(2);
    sheet.hideColumns(2);
    sheet.setFrozenRows(IMPORT_HEADER_ROWS);
    sheet.setFrozenColumns(1);

    writeAuditLog_({
      action: 'IMPORT_SHEET_CREATED', targetSheet: sheetName, targetKey: q,
      oldValue: '', newValue: layout.rows.length + ' 行 × ' + dateCount + ' 個主日',
      source: 'apiCreateImportSheet', notes: '匯入範本（未寫任何派工）'
    });

    return {
      created: true, sheetName: sheetName, url: buildGridSheetUrl_(sheetName),
      rowCount: layout.rows.length, dateCount: dateCount, naCount: Object.keys(layout.naByKey).length
    };
  });
}

/**
 * 讀 `匯入_<季度>`：靠第 2 行日期鍵同第 2 欄 `POST#slot` 定位，唔靠位置。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, string>} `'date|post|slot' → 格內文字（已正規化）`
 */
function readImportSheetCells_(quarterId) {
  const sheetName = buildImportSheetName_(quarterId);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '找不到匯入範本「' + sheetName + '」。', '什麼都沒有改動。', ['先撳「建立匯入範本」']));
  }
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= IMPORT_HEADER_ROWS || lastCol <= IMPORT_LABEL_COLUMNS) return {};
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  // ⚠️ 試算表會把 `yyyy-MM-dd` 字串自動變成日期值——同 grid 第 1 欄一樣，用 `toDateString()` 讀返
  const dateKeys = values[1].map(function (v) { return v ? toDateString(v, timezone) : ''; });
  const out = {};
  for (let r = IMPORT_HEADER_ROWS; r < values.length; r++) {
    const key = String(values[r][1] || '').trim();
    const parts = key.split('#');
    if (parts.length !== 2) continue;
    for (let c = IMPORT_LABEL_COLUMNS; c < lastCol; c++) {
      const dateStr = String(dateKeys[c] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
      out[cellKey_(dateStr, parts[0], Number(parts[1]))] = normalizeCellText_(values[r][c]);
    }
  }
  return out;
}

/**
 * 規則檢查用嘅 context——同 `buildFineTuneContext_()` 同一批讀取函式，但唔靠任何既有版本
 *（匯入嘅季度可能一個版本都冇）。`original` 由匯入狀態砌，帶 `ruleFlags` 令
 * `listGenuineBlankCells_()`（AH 組同一支）認得灰格同講員格唔算空格。
 */
function buildImportRuleContext_(layout, state) {
  const config = readConfig();
  const posts = layout.posts;
  const eligibility = readEligibility();
  const roleContext = buildRoleContext_(eligibility, posts, layout.timezone);
  eligibility.byPost = roleContext.eligibleByPost;
  return {
    quarterId: layout.quarterId,
    versionNo: -1,
    timezone: layout.timezone,
    original: state,
    gridValues: {},
    gridRender: buildGridRenderContext_(layout.quarterId, layout.timezone, posts),
    serviceDates: layout.serviceDates,
    posts: posts,
    eligibility: eligibility,
    roles: roleContext.roles,
    personPostExclusions: roleContext.exclusions,
    peopleById: indexPeopleById_(),
    unavailable: readUnavailableNormalized(layout.timezone),
    rules: readRules(),
    maxMoves: Number(config[CONFIG_KEYS.FINETUNE_MAX_MOVES]) || DEFAULTS.FINETUNE_MAX_MOVES,
    maxPerQuarterDefault: Number(config[CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER]) || 8,
    warnOnSemiHard: getConfig(CONFIG_KEYS.WARN_ON_SEMI_HARD_BREAK, true) === true
  };
}

/**
 * 檢查匯入表（唯讀）。`apiCheckImportSheet()` 同 `apiImportRosterExecute()` **行同一份**。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 見函式末嘅回傳
 */
function buildImportPlan_(quarterId) {
  const q = String(quarterId || '').trim();
  const layout = buildImportLayout_(q);
  const cells = readImportSheetCells_(q);
  const postNames = {};
  layout.posts.forEach(function (p) { postNames[p.postId] = p.postNameTC; });
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[COLUMNS.NAME_MAPPING.PERSON_ID] || '').trim();
    if (id) nameById[id] = String(row[COLUMNS.NAME_MAPPING.NAME_TC] || '').trim();
  });

  const unresolved = [];
  const ignoredNa = [];
  const freeText = [];
  const state = [];
  const assignments = [];
  let filledCount = 0;

  layout.rows.forEach(function (r) {
    layout.serviceDates.forEach(function (d) {
      const key = cellKey_(d.serviceDate, r.postId, r.slotIndex);
      const naRule = layout.naByKey[key] || '';
      const text = cells[key] === undefined ? '' : cells[key];
      const base = {
        serviceDateId: d.serviceDateId, serviceDate: d.serviceDate,
        postId: r.postId, slotIndex: r.slotIndex, postNameTC: r.label
      };

      if (naRule) {
        if (text !== '' && text !== IMPORT_NA_MARK) ignoredNa.push(Object.assign({}, base, { text: text }));
        state.push(Object.assign({}, base, { personId: '', isManual: false, assignSource: ASSIGN_SOURCE.SKIPPED, ruleFlags: [naRule] }));
        assignments.push(Object.assign({}, base, { personId: '', personName: '', assignSource: ASSIGN_SOURCE.SKIPPED, ruleFlags: [naRule] }));
        return;
      }

      const typed = text === IMPORT_NA_MARK ? '' : text;
      if (typed === '') {
        // 講員／翻譯／獻花留空係「待填」，唔算空格（AH 組同一個定義——靠 ruleFlags）
        const flags = r.post.autoGenerate === false ? [RULE_IDS.NO_AUTO_GENERATE] : [];
        state.push(Object.assign({}, base, { personId: '', isManual: false, assignSource: ASSIGN_SOURCE.SKIPPED, ruleFlags: flags }));
        assignments.push(Object.assign({}, base, { personId: '', personName: '', assignSource: ASSIGN_SOURCE.SKIPPED, ruleFlags: flags }));
        return;
      }

      filledCount++;
      const personId = resolvePersonId(typed) || '';
      if (!personId) {
        if (r.post.autoGenerate === false) {
          // 客席講員唔喺名單係正常嘅（同填講員工具嘅規則）。
          // flag 照帶 `NO_AUTO_GENERATE`——同生成器寫嘅一樣，令「有冇人」嘅定義（AH 組）唔會把呢格當空格。
          freeText.push(Object.assign({}, base, { text: typed }));
          state.push(Object.assign({}, base, { personId: '', isManual: true, assignSource: ASSIGN_SOURCE.MANUAL, ruleFlags: [RULE_IDS.NO_AUTO_GENERATE] }));
          assignments.push(Object.assign({}, base, { personId: '', personName: typed, assignSource: ASSIGN_SOURCE.MANUAL, ruleFlags: [RULE_IDS.NO_AUTO_GENERATE] }));
          return;
        }
        unresolved.push(Object.assign({}, base, { text: typed }));
        return;
      }
      const flags = r.post.autoGenerate === false ? [RULE_IDS.NO_AUTO_GENERATE] : [];
      state.push(Object.assign({}, base, { personId: personId, isManual: true, assignSource: ASSIGN_SOURCE.MANUAL, ruleFlags: flags }));
      assignments.push(Object.assign({}, base, {
        personId: personId, personName: nameById[personId] || typed,
        assignSource: ASSIGN_SOURCE.MANUAL, ruleFlags: flags
      }));
    });
  });

  const latestVersionNo = findLatestVersionNo(q);
  const plan = {
    ok: true,
    quarterId: q,
    sheetName: buildImportSheetName_(q),
    hasVersion: latestVersionNo >= 0,
    latestVersionNo: latestVersionNo,
    versionNoToCreate: latestVersionNo + 1,
    filledCount: filledCount,
    cellCount: state.length,
    unresolved: unresolved,
    blocked: unresolved.length > 0,
    ignoredNa: ignoredNa,
    freeText: freeText,
    blankCells: [],
    violations: { real: [], released: [], structural: [], semiHard: [] },
    needsRelease: false,
    confirmText: IMPORT_CONFIRM_TEXT,
    assignments: assignments
  };
  if (plan.blocked) return plan;

  const context = buildImportRuleContext_(layout, state);
  plan.blankCells = listGenuineBlankCells_(state, context).map(function (b) {
    return { serviceDate: b.serviceDate, postId: b.postId, postNameTC: postNames[b.postId] || b.postId, slotIndex: b.slotIndex };
  });
  const violations = findStateViolations_(state, context).map(function (v) {
    return Object.assign({}, v, {
      postNameTC: postNames[v.postId] || v.postId,
      personName: nameOfPersonId_(context, v.personId)
    });
  });
  plan.violations = classifySaveConfirmViolations_(q, latestVersionNo, violations);
  plan.needsRelease = plan.violations.real.length > 0;
  plan.confirmText = plan.needsRelease ? IMPORT_RELEASE_CONFIRM_TEXT : IMPORT_CONFIRM_TEXT;
  return plan;
}

/** 回前端嘅版本——唔帶成千格嘅 `assignments`。 */
function stripImportPlanForClient_(plan) {
  const out = Object.assign({}, plan);
  delete out.assignments;
  return out;
}

/**
 * 供前端呼叫：檢查匯入表。**唯讀。**
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiCheckImportSheet(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    return stripImportPlanForClient_(buildImportPlan_(quarterId));
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：匯入成為版本。**會寫入。**
 *
 * @param {string} quarterId 季度 ID
 * @param {{confirmText: string, sentExternally: boolean}} payload 打字確認＋「已經在系統外寄給全體」
 * @returns {Object}
 */
function apiImportRosterExecute(quarterId, payload) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('匯入人手職事表', function () {
    return apiImportRosterExecute_locked_(quarterId, payload || {});
  });
}

function apiImportRosterExecute_locked_(quarterId, input) {
  const plan = buildImportPlan_(quarterId);
  const q = plan.quarterId;
  if (plan.blocked) {
    throw new Error(buildThreePartMessage_(
      '匯入表裡面有 ' + plan.unresolved.length + ' 個名字系統認不出。',
      '什麼都沒有改動。',
      ['在匯入表把那幾格改成正確的寫法', '如果是新人，撳〔立即加入這個人〕', '改好再撳一次「檢查並匯入」']));
  }
  if (plan.filledCount === 0) {
    throw new Error(buildThreePartMessage_(
      '匯入表一格都沒有填。', '什麼都沒有改動。', ['先把人手職事表貼進「' + plan.sheetName + '」']));
  }
  const typed = String(input.confirmText || '').trim();
  if (typed !== plan.confirmText) {
    throw new Error(buildThreePartMessage_(
      plan.needsRelease
        ? '有 ' + plan.violations.real.length + ' 格違反了一定要遵守的規則，需要你打字放行才能匯入。'
        : '匯入會建立一個新版本，需要你打字確認。',
      '什麼都沒有改動。',
      ['在確認格輸入「' + plan.confirmText + '」再撳一次']));
  }

  const versionNo = plan.versionNoToCreate;
  const shouldProtect = versionNo === 0 && getConfig(CONFIG_KEYS.V0_PROTECT, false) === true;
  const assignments = plan.assignments.map(function (a) {
    return {
      serviceDateId: a.serviceDateId, serviceDate: a.serviceDate, postId: a.postId, slotIndex: a.slotIndex,
      personId: a.personId, personName: a.personName, assignSource: a.assignSource, ruleFlags: a.ruleFlags
    };
  });

  // ⚠️ 一定要走現有建立版本嘅函式——唔另寫一套寫入
  const sheetName = createRosterSheet(q, versionNo, assignments, []);
  writeAssignments(q, versionNo, assignments);
  if (shouldProtect) protectV0(sheetName);
  registerVersion(q, versionNo, sheetName, VERSION_VALUES.BASIS_IMPORT,
    plan.hasVersion ? plan.latestVersionNo : null, 0, shouldProtect,
    IMPORT_VERSION_NOTE + '（' + plan.sheetName + '，' + plan.filledCount + ' 格）');

  if (plan.needsRelease) {
    // AG 組格式：6 欄 key ＋ 放行版本，之後儲存同一狀態唔使再打字
    logHardViolationRelease_(q, 'apiImportRosterExecute（匯入人手職事表）', plan.violations.real, versionNo);
  }

  writeAuditLog_({
    action: 'ROSTER_IMPORTED', targetSheet: sheetName, targetKey: q,
    oldValue: plan.hasVersion ? ('最新 v' + plan.latestVersionNo) : '（沒有版本）',
    newValue: 'v' + versionNo + '（' + plan.filledCount + ' 格，全部 MANUAL）',
    source: 'apiImportRosterExecute',
    notes: IMPORT_VERSION_NOTE + '；來源工作表 ' + plan.sheetName
      + (plan.needsRelease ? '；放行 ' + plan.violations.real.length + ' 格硬規則違反' : '')
  });

  // 第四點：已經在系統外寄過 ⇒ Stage 推到 OFFICIAL_SENT ＋ 每位有派工嘅人一行 EXTERNAL 基準
  let externalRows = 0;
  let stage = getQuarterStage_(q);
  if (input.sentExternally === true) {
    externalRows = writeExternalSendBaseline_(q, versionNo, assignments);
    setQuarterStage_(q, QUARTER_STAGE.OFFICIAL_SENT, '匯入人手職事表：幹事聲明已在系統外寄給全體');
    stage = QUARTER_STAGE.OFFICIAL_SENT;
  }

  const publish = tryPublishPublicRoster_(q);

  return {
    ok: true,
    versionNo: versionNo,
    sheetName: sheetName,
    url: buildGridSheetUrl_(sheetName),
    cellCount: plan.filledCount,
    releasedCount: plan.needsRelease ? plan.violations.real.length : 0,
    blankCount: plan.blankCells.length,
    stage: stage,
    externalRows: externalRows,
    publishFailed: !!publish.failed,
    publishMessage: publish.message || '',
    message: '已經把「' + plan.sheetName + '」匯入成第 ' + versionNo + ' 版（' + plan.filledCount + ' 格）。'
      + (input.sentExternally === true
        ? '這一季已記成「已正式發出給全體」；之後改動只會寄給有改動的人。'
        : '這一季仍然是「草稿」，之後照常寄審閱或正式發出。')
  };
}

/**
 * 為每一位有派工嘅人寫一行 `SendLog` 基準：`Stage=OFFICIAL`、`Status=EXTERNAL`、
 * hash 照 `computeAssignmentHash_()`。**唔寄任何電郵。**
 * @returns {number} 寫了幾多行
 */
function writeExternalSendBaseline_(quarterId, versionNo, assignments) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const byPerson = groupAssignmentsByPerson_(assignments);
  const peopleById = indexPeopleById_();
  const postNames = {};
  readPostsNormalized().forEach(function (p) { postNames[p.postId] = p.postNameTC; });

  const outcomes = Object.keys(byPerson).map(function (personId) {
    const person = peopleById[personId] || {};
    return {
      recipientType: 'PERSON',
      personId: personId,
      email: person.email || '',
      displayName: person.nameTC || personId,
      hash: computeAssignmentHash_(byPerson[personId]),
      summary: buildAssignmentSummary_(byPerson[personId], postNames, timezone),
      attachmentName: '',
      status: MAIL_STATUS.EXTERNAL,
      messageId: '',
      errorMessage: '',
      intendedEmail: person.email || '',
      deliveredTo: ''
    };
  });
  if (outcomes.length === 0) return 0;
  writeSendLogRows_(outcomes, {
    quarterId: quarterId, versionNo: versionNo, stage: MAIL_STAGES.OFFICIAL, sendDecision: null
  });
  return outcomes.length;
}
