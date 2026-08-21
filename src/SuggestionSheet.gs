/**
 * 第四十一輪批次 B 組：**「檢查我的改動」＋「請系統幫我調整」。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 講的那個缺口
 * ═════════════════════════════════════════════════════════════════════
 *
 * > 我改完之後，需要檢查我的改動有沒有違反很重要的規則（一粒檢查掣），
 * > 同埋一粒掣讓系統調整整張表——例如有些空格、有些替換。
 * > 幹事可以在一張新的工作表看系統建議的版本，再撳一粒掣接受。
 * > 幹事也可以直接在那張建議版本上再改，然後再撳「調整」，
 * > 重複這個過程直到他滿意再儲存。
 * > 幹事改的用一種顏色、系統建議的用另一種顏色，全部要標示出來。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 這不是從零做
 * ─────────────────────────────────────────────────────────────────────
 *
 * 系統本來就有這條路：`FineTune.gs` 的 `proposeMinimalFix()`
 * （最小改動修復被破壞的規則）、`analyseManualState_()`（逐格比對現時
 * grid 同最新版本，算出改了甚麼、違反了甚麼、認不出甚麼）。
 *
 * 這一組做的是**把它接上主流程**，不是重新寫一套。
 * 接上去的同時，那條路就終於會被真人跑到——那本身是額外的好處：
 * `applyDecisions()` 是第三十七輪查出「五條建立版本的路之中唯一一條
 * 從來沒有端到端跑過」那一條。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 建議表是臨時的
 * ─────────────────────────────────────────────────────────────────────
 *
 * 接受或者放棄之後一定要清走。不清走的話，試算表會慢慢積落一堆
 * `_建議` 工作表，而下一次幹事開的時候分不清哪一張是最新的。
 *
 * ⚠️ 底色只是**顯示層**。它不會影響 `RosterAssignments` 的任何一格——
 * 接受的時候讀的是格子裡面的**文字**，不是顏色。
 */

/** 建議表的名稱後綴。 */
const SUGGESTION_SHEET_SUFFIX = '_建議';

/** 幹事自己改過那些格的底色。 */
const SUGGESTION_COLOR_MANUAL = '#fff3c4';
/** 系統建議改的格的底色。 */
const SUGGESTION_COLOR_SYSTEM = '#d7e9ff';

/**
 * 建議表的名稱。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {string} 工作表名稱
 */
function buildSuggestionSheetName_(quarterId, versionNo) {
  return buildRosterSheetName_(quarterId, versionNo) + SUGGESTION_SHEET_SUFFIX;
}

/**
 * 供前端呼叫：〔檢查我的改動〕。**唯讀，一格都不會寫。**
 *
 * ⚠️ 這一粒掣不改任何東西。介面上要講明——不講的話，
 * 幹事撳完不敢再撳第二次，怕改了甚麼。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 檢查結果
 */
function apiCheckMyChanges(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) {
      return { ok: false, message: '這一季還沒有生成過任何版本。' };
    }
    const context = buildFineTuneContext_(quarterId, versionNo);

    // ⚠️ 一定要經 `resolveAuthoritativeState_()` 並且明確傳 mode。
    //
    // 這個 context 同時有 `original`（長表）同 `gridValues`（grid 工作表），
    // 兩者在「幹事剛改過 grid」的時候並不相同。直接讀其中一份，
    // 就是第十九輪那個 bug：幹事改 grid 改極都沒有用。
    //
    // 這裡要的是 `GRID_OVERLAY`——「檢查我的改動」講的就是他改了甚麼。
    const resolved = resolveAuthoritativeState_(
      context, STATE_SOURCE.GRID_OVERLAY, 'apiCheckMyChanges');
    const analysis = {
      changes: resolved.changes,
      unresolved: resolved.unresolved,
      manualState: resolved.state,
      violations: findStateViolations_(resolved.state, context)
    };

    const postNames = {};
    context.posts.forEach(function (p) { postNames[p.postId] = p.postNameTC; });

    // ── 改了哪幾格 ─────────────────────────────────────────────
    const changes = analysis.changes.map(function (c) {
      return {
        serviceDate: c.serviceDate,
        postNameTC: postNames[c.postId] || c.postId,
        slotIndex: c.slotIndex,
        // ⚠️ 空白要講得出是空白。寫一個空字串落畫面，
        // 幹事會以為系統壞了或者自己看漏。
        fromName: c.originalName || '（空白）',
        toName: c.manualText || '（空白）'
      };
    });

    // ── 哪幾格的名字認不出 ─────────────────────────────────────
    const unresolved = analysis.unresolved.map(function (u) {
      return {
        serviceDate: u.serviceDate,
        postId: u.postId,
        postNameTC: postNames[u.postId] || u.postId,
        slotIndex: u.slotIndex,
        text: u.text,
        expectedText: u.expectedText || ''
      };
    });

    // ── 哪幾格違反規則 ─────────────────────────────────────────
    const violations = (analysis.violations || []).map(function (v) {
      return {
        serviceDate: v.serviceDate,
        postNameTC: postNames[v.postId] || v.postId,
        slotIndex: v.slotIndex,
        personName: v.personName || '',
        ruleId: v.ruleId,
        severity: v.severity,
        reason: v.reason || ''
      };
    });

    // ── 哪幾格空了 ─────────────────────────────────────────────
    //
    // ⚠️ 只算「系統本來要排」的格。講員／翻譯／獻花本來就留白，
    // 把它們算進去會令這個清單長到沒有人看。
    // 上一版逐格的跳過原因。⚠️ 只讀 `ruleFlags`，不讀人——
    // 這個函式已經明確表過態（上面叫過 resolver），所以在這裡讀
    // `original` 拿補充資料是合法的，不是「兩份真相求其揀一份」。
    const flagsByKey = {};
    context.original.forEach(function (a) {
      flagsByKey[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a.ruleFlags || [];
    });

    const blanks = [];
    (analysis.manualState || []).forEach(function (s) {
      if (s.personId) return;
      const flags = flagsByKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] || [];
      if (flags.indexOf(RULE_IDS.NO_AUTO_GENERATE) !== -1) return;
      if (flags.some(function (id) { return STRUCTURAL_NA_RULE_IDS.indexOf(id) !== -1; })) return;
      if (flags.some(function (id) { return SPECIAL_SKIP_RULE_IDS.indexOf(id) !== -1; })) return;
      blanks.push({
        serviceDate: s.serviceDate,
        postNameTC: postNames[s.postId] || s.postId,
        slotIndex: s.slotIndex
      });
    });

    return {
      ok: true,
      versionNo: versionNo,
      changes: changes,
      unresolved: unresolved,
      violations: violations,
      blanks: blanks,
      // 一句總結。全部乾淨的時候要講得出「可以儲存」——
      // 一個空清單不會告訴幹事下一步做甚麼。
      allClear: unresolved.length === 0 && violations.length === 0 && blanks.length === 0
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 讀一張任意工作表的 grid 文字（同 `readGridPersonIds_()` 一模一樣的形狀）。
 *
 * ⚠️ 存在的理由：`readGridPersonIds_()` 寫死了讀正式那一張。
 * 建議表要用同一套疊加邏輯，就要讀得到它。
 *
 * ⚠️ **不做姓名解析**，同 `readGridPersonIds_()` 一致——
 * 逐格重新解析會令未改動的格在同名／別名的情況下漂移到另一個人。
 *
 * @param {string} sheetName 工作表名稱
 * @param {string} timezone 時區
 * @returns {Object.<string, string>} `日期|崗位|slot` → 格內文字
 */
function readGridTextFromSheet_(sheetName, timezone) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // ⚠️ **不可以寫死「機器鍵在第 2 行」。**
  //
  // 正式那一張是這樣沒錯，但建議表上面多了一段圖例（Ivan 要求圖例印在表頂），
  // 所以機器鍵那一行被推低了。寫死行號的後果：讀出來全部是空的，
  // 而幹事在建議表上改的東西會靜靜消失——他改完再撳一次調整，
  // 系統會當他甚麼都沒有改過。
  //
  // 改成掃描：機器鍵那一行的特徵是「有格子含 #」（`POSTID#slot`）。
  let keyRow = -1;
  for (let r = 1; r <= Math.min(lastRow, 12); r++) {
    const row = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    const hasKey = row.some(function (v) { return String(v || '').indexOf('#') !== -1; });
    if (hasKey) { keyRow = r; break; }
  }
  if (keyRow === -1) {
    throw new Error(buildThreePartMessage_(
      '在「' + sheetName + '」找不到機器鍵那一行（格子裡面帶 # 的那一行）。',
      '什麼都沒有讀到，也什麼都沒有改動。',
      ['那一行可能被刪掉了或者被改過。刪掉這一張表，再撳一次「請系統幫我調整」重新產生']));
  }

  const keys = sheet.getRange(keyRow, 1, 1, lastCol).getValues()[0];
  const dataStart = keyRow + 1;
  const values = lastRow >= dataStart
    ? sheet.getRange(dataStart, 1, lastRow - dataStart + 1, lastCol).getValues() : [];

  const result = {};
  values.forEach(function (row) {
    const dateStr = toDateString(row[0], timezone);
    if (!dateStr) return;
    for (let c = 3; c < keys.length; c++) {
      const key = String(keys[c] || '');
      if (key.indexOf('#') === -1) continue;
      const parts = key.split('#');
      result[dateStr + '|' + parts[0] + '|' + parts[1]] = String(row[c] || '').trim();
    }
  });
  return result;
}

/**
 * 建議版本的內容。**純計算，不寫任何工作表。**
 *
 * ⚠️ 起點是「幹事現在看著那一版」——如果建議表已經存在，起點就是**它**。
 * 這樣他就可以在建議表上再改、再撳一次調整，重複到滿意為止
 * （Ivan 明確要求這一點）。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} {versionNo, rows, manualKeys, systemKeys, notes, ...}
 */
function buildSuggestionState_(quarterId) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。', '什麼都沒有改動。', ['先在第 1 步生成職事表']));
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const context = buildFineTuneContext_(quarterId, versionNo);

  // 建議表已經存在 ⇒ 以它為起點（他在上面再改過）。
  const suggestionName = buildSuggestionSheetName_(quarterId, versionNo);
  const hasSuggestion = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(suggestionName);
  if (hasSuggestion) {
    context.gridValues = readGridTextFromSheet_(suggestionName, timezone);
  }

  // ── 一、幹事那一版（把 grid 疊加落上一版）─────────────────────
  //
  // ⚠️ 同 `apiCheckMyChanges()` 一樣，一定要明確傳 mode。
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'buildSuggestionState_');
  const analysis = {
    changes: resolved.changes,
    unresolved: resolved.unresolved,
    manualState: resolved.state,
    violations: findStateViolations_(resolved.state, context)
  };

  // ⚠️ 認不出的名字**一定要擋**。理由同儲存那條路一模一樣
  //（見 UnresolvedNameFix.gs）：一個沒有 PersonID 的名字，
  // 那一格對那個人完全沒有作用。在這裡放行，就等於讓它經由
  // 建議表那條路溜進正式版本。
  if (analysis.unresolved.length > 0) {
    return {
      blocked: true,
      versionNo: versionNo,
      unresolved: analysis.unresolved,
      message: '有 ' + analysis.unresolved.length + ' 格的名字系統認不出。'
    };
  }

  const manualKeys = {};
  analysis.changes.forEach(function (c) {
    manualKeys[cellKey_(c.serviceDate, c.postId, c.slotIndex)] = true;
  });

  // ── 二、系統的最小改動建議 ───────────────────────────────────
  //
  // ⚠️ 用返 `proposeMinimalFix()`——**不在這裡重寫一套修復邏輯**。
  // 它已經有「循序處理、每產生一項建議就視為已生效」那一套，
  // 重寫一定會分岔。
  const fix = proposeMinimalFixFromState_(context, analysis);

  const systemKeys = {};
  const notes = {};
  const stateByKey = {};
  analysis.manualState.forEach(function (s) {
    stateByKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] = s;
  });

  fix.proposals.forEach(function (p) {
    const key = cellKey_(p.serviceDate, p.postId, p.slotIndex);
    if (!p.suggestedPersonId) {
      // 找不到替補：不改那一格，但要在備註講明——
      // 不講的話，幹事會以為系統看不到那個問題。
      notes[key] = '這一格違反了規則（' + (p.reason || p.brokenRuleId)
        + '），但系統找不到任何合資格又沒有衝突的人可以換。要你自己決定。';
      return;
    }
    const before = stateByKey[key] ? (stateByKey[key].personId || '') : '';
    if (before === p.suggestedPersonId) return;   // 冇實際改動
    systemKeys[key] = true;
    if (stateByKey[key]) stateByKey[key].personId = p.suggestedPersonId;
    notes[key] = '系統改了這一格。原因：' + (p.reason || p.brokenRuleId)
      + '。原本是「' + (p.manualName || '（空白）') + '」，改成「'
      + (p.suggestedName || '（空白）') + '」。';
  });

  // ⚠️ 上一版逐格的中繼資料（`ruleFlags`／`assignSource`／原本的名字）。
  //
  // 在這裡算好，是為了令 `writeSuggestionSheet_()` 完全不用碰
  // `context.original`——那個函式沒有表過態（沒有叫 resolver），
  // 在那裡讀「兩份真相之一」就是靜靜揀了一份。
  //
  // 這幾個欄位**只是中繼資料，不是人**：搬版本的時候要原封不動帶過去
  //（第三十四／三十六／三十七輪連續三輪修的就是這件事）。
  const originalMeta = {};
  context.original.forEach(function (a) {
    originalMeta[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a;
  });

  return {
    blocked: false,
    versionNo: versionNo,
    context: context,
    originalMeta: originalMeta,
    state: analysis.manualState,
    manualKeys: manualKeys,
    systemKeys: systemKeys,
    notes: notes,
    unfixable: fix.unfixable,
    remainingViolations: findStateViolations_(analysis.manualState, context)
  };
}

/**
 * 同 `proposeMinimalFix()` 一樣，但用一份**已經算好的** analysis，
 * 不再自己叫一次 `buildFineTuneContext_()`。
 *
 * ⚠️ 存在的理由：這裡的起點可能是建議表（不是正式那一張），
 * 而 `proposeMinimalFix()` 寫死了自己去讀正式那一張。
 * 兩者的修復邏輯必須是同一段——所以這裡**不重寫**，
 * 只是把「起點從哪裡來」這一件事抽出來。
 *
 * @param {Object} context fine-tune context（`gridValues` 可能已被換掉）
 * @param {Object} analysis `analyseManualState_(context)` 的結果
 * @returns {Object} {proposals, unfixable}
 */
function proposeMinimalFixFromState_(context, analysis) {
  const proposals = [];
  const unfixable = [];
  const handled = {};
  let workingState = analysis.manualState.map(function (s) {
    return Object.assign({}, s);
  });

  while (proposals.length < context.maxMoves) {
    const violations = findStateViolations_(workingState, context);
    const violation = violations.filter(function (v) {
      return !handled[cellKey_(v.serviceDate, v.postId, v.slotIndex)];
    })[0];
    if (!violation) break;

    const key = cellKey_(violation.serviceDate, violation.postId, violation.slotIndex);
    handled[key] = true;

    const replacement = findReplacementPerson_(violation, workingState, context);
    const post = findPostById_(context.posts, violation.postId);
    proposals.push({
      serviceDate: violation.serviceDate,
      postId: violation.postId,
      postNameTC: post ? post.postNameTC : violation.postId,
      slotIndex: violation.slotIndex,
      manualName: nameOfPersonId_(context, violation.personId),
      suggestedPersonId: replacement.personId,
      suggestedName: replacement.personId
        ? nameOfPersonId_(context, replacement.personId) : '',
      brokenRuleId: violation.ruleId,
      reason: replacement.reason || violation.reason || violation.ruleId
    });

    if (!replacement.personId) {
      unfixable.push({
        serviceDate: violation.serviceDate,
        postId: violation.postId,
        slotIndex: violation.slotIndex,
        ruleId: violation.ruleId
      });
      continue;
    }
    // 把這一項視為已生效，再算下一項——否則逐項獨立計算會出現
    // 「兩項建議都指同一個人」而製造出新的違反。
    workingState.forEach(function (s) {
      if (cellKey_(s.serviceDate, s.postId, s.slotIndex) !== key) return;
      s.personId = replacement.personId;
    });
  }

  return { proposals: proposals, unfixable: unfixable };
}

/**
 * 供前端呼叫：〔請系統幫我調整〕。**會寫入（建立／重建那一張建議表）。**
 *
 * ⚠️ 它**不會**碰 `RosterAssignments`。建議表是一張獨立的工作表，
 * 幹事撳〔接受這個建議版本〕之前，正式資料一格都沒有變。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} {ok, sheetName, url, manualCount, systemCount, ...}
 */
function apiBuildSuggestion(quarterId) {
  assertWebAppRequestAllowed_();
  const built = buildSuggestionState_(quarterId);
  if (built.blocked) {
    return {
      ok: false,
      blocked: true,
      unresolved: built.unresolved,
      message: buildThreePartMessage_(
        built.message,
        '什麼都沒有改動，也沒有建立建議表。',
        ['先在職事表把那幾格的名字改成正確的寫法',
          '或者撳「儲存我的修改」，那裡有〔立即加入這個人〕'])
    };
  }

  const sheetName = buildSuggestionSheetName_(quarterId, built.versionNo);
  const written = writeSuggestionSheet_(quarterId, built, sheetName);

  writeAuditLog_({
    action: 'SUGGESTION_BUILT',
    targetSheet: sheetName,
    targetCell: '',
    oldValue: '',
    newValue: '幹事改了 ' + Object.keys(built.manualKeys).length + ' 格，系統再改了 '
      + Object.keys(built.systemKeys).length + ' 格'
  });

  return {
    ok: true,
    versionNo: built.versionNo,
    sheetName: sheetName,
    url: buildGridSheetUrl_(sheetName),
    manualCount: Object.keys(built.manualKeys).length,
    systemCount: Object.keys(built.systemKeys).length,
    // ⚠️ 系統改完之後仍然違反規則的格**一定要講出來**。
    // 不講的話，幹事會以為「系統調整過 ＝ 一定沒問題」，
    // 然後直接接受——而那幾格其實仍然是壞的。
    remaining: (built.remainingViolations || []).map(function (v) {
      return {
        serviceDate: v.serviceDate,
        postNameTC: (written.postNames[v.postId] || v.postId),
        slotIndex: v.slotIndex,
        personName: v.personName || '',
        ruleId: v.ruleId,
        reason: v.reason || ''
      };
    }),
    unfixableCount: (built.unfixable || []).length
  };
}

/**
 * 把建議版本寫成一張工作表：兩種底色 ＋ 逐格備註 ＋ 表頂圖例。
 *
 * ⚠️ 底色純粹是顯示層。接受的時候讀的是格子裡面的**文字**，不是顏色——
 * 靠顏色做判斷的話，幹事在表上改動一格（顏色不會跟著變）就會全錯。
 *
 * @param {string} quarterId 季度 ID
 * @param {Object} built `buildSuggestionState_()` 的結果
 * @param {string} sheetName 要寫的工作表名稱
 * @returns {{postNames: Object}} 給呼叫端用的崗位中文名對照
 */
function writeSuggestionSheet_(quarterId, built, sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const context = built.context;
  const postNames = {};
  context.posts.forEach(function (p) { postNames[p.postId] = p.postNameTC; });

  // 把狀態轉成 `createRosterSheet()` 要的形狀，再用同一個版面產生器——
  // 不另寫一套版面，否則建議表同正式表會慢慢長得不一樣。
  const assignments = built.state.map(function (s) {
    // 用上游算好的中繼資料——這個函式刻意完全不碰 `context.original`
    // （理由見 `buildSuggestionState_()` 裡面 `originalMeta` 的說明）。
    const orig = built.originalMeta[cellKey_(s.serviceDate, s.postId, s.slotIndex)] || {};
    const person = context.peopleById[s.personId];
    return {
      serviceDateId: s.serviceDateId || orig.serviceDateId,
      serviceDate: s.serviceDate,
      postId: s.postId,
      slotIndex: s.slotIndex,
      personId: s.personId || '',
      personName: person ? person.nameTC : (orig.personName || ''),
      assignSource: orig.assignSource || ASSIGN_SOURCE.AUTO,
      ruleFlags: (orig.ruleFlags || []).slice()
    };
  });

  const layout = buildGridLayout_(quarterId, assignments);

  // ── 表頂圖例（兩種顏色的意思）───────────────────────────────
  //
  // ⚠️ 圖例一定要印出來，不可以要人自己猜。兩隻淺色本身分不出意思。
  const legend = [
    ['這是建議版本，不是正式版本。你在這裡改甚麼都不會影響正式職事表。'],
    ['黃色格 ＝ 你自己改過的', '藍色格 ＝ 系統建議改的'],
    ['系統改過的格，把滑鼠停在上面會見到它為甚麼改。'],
    ['改完可以回介面再撳一次「請系統幫我調整」，'
      + '系統會用你改完之後這一版做起點再算一次。']
  ];
  legend.forEach(function (line, i) {
    sheet.getRange(i + 1, 1, 1, Math.max(2, line.length)).setValues(
      [line.concat(new Array(Math.max(0, Math.max(2, line.length) - line.length)).fill(''))]);
  });
  sheet.getRange(2, 1).setBackground(SUGGESTION_COLOR_MANUAL);
  sheet.getRange(2, 2).setBackground(SUGGESTION_COLOR_SYSTEM);
  sheet.getRange(1, 1, legend.length, 1).setFontWeight('bold');

  const headerRow = legend.length + 1;

  // ── 表身（同正式表一樣的欄位）───────────────────────────────
  const grid = [layout.headers, layout.keys].concat(layout.rows);
  sheet.getRange(headerRow, 1, grid.length, layout.keys.length).setValues(grid);
  sheet.getRange(headerRow, 1, 1, layout.keys.length)
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
  sheet.hideRows(headerRow + 1);
  sheet.setFrozenRows(headerRow + 1);

  // ── 兩種底色 ＋ 逐格備註 ─────────────────────────────────────
  const dataStart = headerRow + 2;
  layout.rows.forEach(function (row, r) {
    const dateStr = String(row[0]);
    for (let c = 3; c < layout.keys.length; c++) {
      const key = String(layout.keys[c] || '');
      if (key.indexOf('#') === -1) continue;
      const parts = key.split('#');
      const cellKey = cellKey_(dateStr, parts[0], Number(parts[1]));
      const cell = sheet.getRange(dataStart + r, c + 1);
      // ⚠️ 次序：系統改過的**蓋過**幹事改過的。
      // 一格既被幹事改過、又被系統再改一次，對他來講最重要的資訊是
      // 「系統動過我改的那一格」——所以顯示藍色，而備註會講返原本是甚麼。
      if (built.systemKeys[cellKey]) {
        cell.setBackground(SUGGESTION_COLOR_SYSTEM);
      } else if (built.manualKeys[cellKey]) {
        cell.setBackground(SUGGESTION_COLOR_MANUAL);
      }
      if (built.notes[cellKey]) cell.setNote(built.notes[cellKey]);
    }
  });

  sheet.autoResizeColumns(1, layout.keys.length);
  return { postNames: postNames };
}

/**
 * 供前端呼叫：〔接受這個建議版本〕。**會建立正式新版本。**
 *
 * ⚠️ 走的是 `materialiseManualEdits_()`——即是「儲存我的修改」那一條
 * 已經在真實環境跑過、而且第三十六／三十七輪逐個欄位修好過的路。
 * **不另寫一套建立版本的邏輯**：那樣就變成第六條路，而前面五條
 * 每一條都出過同一類的 bug。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 結果
 */
function apiAcceptSuggestion(quarterId) {
  assertWebAppRequestAllowed_();
  const versionNo = findLatestVersionNo(quarterId);
  const sheetName = buildSuggestionSheetName_(quarterId, versionNo);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(sheetName)) {
    throw new Error(buildThreePartMessage_(
      '找不到建議表「' + sheetName + '」。',
      '什麼都沒有改動。',
      ['可能已經接受過或者放棄過了，撳「重新整理」看看',
        '或者再撳一次「請系統幫我調整」']));
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const context = buildFineTuneContext_(quarterId, versionNo);
  // ⚠️ 建議表**就是**這一次要儲存的 grid。把它當成 gridValues 餵落去，
  // 下游那一條路就完全不用知道有「建議表」這一回事。
  context.gridValues = readGridTextFromSheet_(sheetName, timezone);

  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'apiAcceptSuggestion');
  if (resolved.unresolved.length > 0) {
    throw new Error(buildThreePartMessage_(
      '建議表上有 ' + resolved.unresolved.length + ' 格的名字系統認不出。',
      '什麼都沒有儲存，建議表也留著沒有動。',
      ['回去建議表把那幾格改成正確的寫法，再撳一次接受']));
  }

  const created = materialiseManualEdits_(
    context, resolved.changes, resolved.state, 'apiAcceptSuggestion');
  // ⚠️ 參數次序：第 7 個係 ，第 8 個先係 。
  // 傳漏一個就會把說明寫落「有冇保護」嗰一欄，而畫面睇落完全正常。
  registerVersion(
    quarterId, created.versionNo, created.sheetName,
    VERSION_VALUES.BASIS_FINE_TUNE, versionNo, 0, false,
    '接受系統建議版本：' + resolved.changes.length + ' 格');

  // ⚠️ 建議表一定要清走。留著的話會積落一堆 `_建議`，
  // 而下一次幹事分不清哪一張是最新的。
  discardSuggestionSheet_(quarterId, versionNo);

  const publish = tryPublishPublicRoster_(quarterId);

  writeAuditLog_({
    action: 'SUGGESTION_ACCEPTED',
    targetSheet: created.sheetName,
    targetCell: '',
    oldValue: 'v' + versionNo,
    newValue: 'v' + created.versionNo + '（' + resolved.changes.length + ' 格）'
  });

  return {
    ok: true,
    versionNo: created.versionNo,
    baseVersionNo: versionNo,
    cellCount: resolved.changes.length,
    publishFailed: publish.failed,
    publishError: publish.message,
    message: '已經接受建議，儲存成第 ' + created.versionNo + ' 版（'
      + resolved.changes.length + ' 格改動）。'
  };
}

/**
 * 供前端呼叫：〔放棄，回到我自己那一版〕。**只刪建議表。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} 結果
 */
function apiDiscardSuggestion(quarterId) {
  assertWebAppRequestAllowed_();
  const versionNo = findLatestVersionNo(quarterId);
  const removed = discardSuggestionSheet_(quarterId, versionNo);
  return {
    ok: true,
    removed: removed,
    message: removed
      ? '已經放棄建議版本。你自己那一版（職事表上的內容）一格都沒有改過。'
      : '本來就沒有建議表。什麼都沒有改動。'
  };
}

/**
 * 刪走建議表。找不到不算錯——可能已經接受過或者放棄過。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {boolean} 有沒有真的刪走
 */
function discardSuggestionSheet_(quarterId, versionNo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(buildSuggestionSheetName_(quarterId, versionNo));
  if (!sheet) return false;
  ss.deleteSheet(sheet);
  return true;
}

/**
 * 供前端呼叫：這一季現在有沒有建議表。**純讀取。**
 *
 * ⚠️ 主流程要用它來決定第 2 步顯示甚麼。有建議表而畫面不講，
 * 幹事會在正式表上改，然後發現改動不見了（因為下一次調整會以建議表為起點）。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} {hasSuggestion, sheetName, url}
 */
function apiGetSuggestionState(quarterId) {
  assertWebAppRequestAllowed_();
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) return { hasSuggestion: false, sheetName: '', url: '' };
  const sheetName = buildSuggestionSheetName_(quarterId, versionNo);
  const has = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  return {
    hasSuggestion: has,
    sheetName: has ? sheetName : '',
    url: has ? buildGridSheetUrl_(sheetName) : ''
  };
}
