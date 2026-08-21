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
 * 幹事改過、而系統又再改一次那些格的底色（第四十三輪批次 C1）。
 *
 * ⚠️ 這一種**一定要有自己的顏色**。之前是「藍色蓋過黃色」，
 * 結果對話框報「黃色 1 格」而表上一格黃色都沒有——
 * 幹事去表上找那一格，永遠找不到。
 */
const SUGGESTION_COLOR_BOTH = '#e2d3f5';

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
    // ⚠️ 第四十三輪批次 D／G 組：用返共用嗰個定義（`listGenuineBlankCells_`）。
    // 呢一段本來喺呢度自己寫一次，而〔請系統幫我調整〕同儲存前嘅提醒
    // 各自又要一份——三份會慢慢唔一樣，而幹事會見到三個唔同嘅數字。
    const blanks = listGenuineBlankCells_(analysis.manualState || [], context)
      .map(function (b) {
        return {
          serviceDate: b.serviceDate,
          postNameTC: postNames[b.postId] || b.postId,
          slotIndex: b.slotIndex
        };
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
    // ⚠️ 第四十二輪批次 A 組：**一定要嚴格**。
    //
    // `toDateString()` 認不出的時候會**原樣回傳**（那是它刻意的，
    // 為了讀得返歷史資料）。所以「不是空字串」不等於「是一個日期」——
    // 圖例那幾行、最底那行指紋，全部都會變成一個看起來合法的 key，
    // 而那些假 key 會令兩次指紋比對永遠對不上。
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
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
 * ⚠️ 第四十二輪批次 A 組：起點**由呼叫端明確傳入**，
 * 不再在這裡靠「建議表在不在」猜（那個猜法就是現場那個 bug——
 * 幹事在正式表上改的兩格被當成不存在）。
 *
 * ⚠️ **每一次叫都重新讀當下那一張表**，不重用任何快照。
 * `buildFineTuneContext_()` 每次都重讀正式那一張；起點是建議表的時候，
 * `readGridTextFromSheet_()` 每次都重讀建議表。
 *
 * @param {string} quarterId 季度 ID
 * @param {Object} start `resolveSuggestionStartPoint_()` 的結果
 * @returns {Object} {versionNo, rows, manualKeys, systemKeys, notes, ...}
 */
function buildSuggestionState_(quarterId, start) {
  const versionNo = start.versionNo;

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const context = buildFineTuneContext_(quarterId, versionNo);

  if (start.source === SUGGESTION_START.SUGGESTION) {
    context.gridValues = readGridTextFromSheet_(start.suggestionSheetName, timezone);
  }
  // `SUGGESTION_START.GRID` ⇒ 原封不動用 `buildFineTuneContext_()` 讀返嚟那一份，
  // 即是正式那一張職事表當下的內容。

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
    // ⚠️ 第四十三輪批次 D 組：填空格同修違反嘅備註要寫得唔同。
    // 兩者對幹事嚟講係兩件事：一個係「系統動咗你改嘅嘢」，
    // 另一個係「系統幫你補返一格本來冇人嘅」。寫同一句就分唔出。
    notes[key] = p.kind === 'FILL_GAP'
      ? ('這一格本來排不出（⚠ 未能安排）。系統建議派 「'
        + (p.suggestedName || '（空白）') + '」。')
      : ('系統改了這一格。原因：' + (p.reason || p.brokenRuleId)
        + '。原本是「' + (p.manualName || '（空白）') + '」，改成「'
        + (p.suggestedName || '（空白）') + '」。');
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
    unfillable: fix.unfillable || [],
    gapCapped: !!fix.gapCapped,
    gapCount: fix.gapCount || 0,
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

  // ── 第四十三輪批次 D 組：順埋手處理「⚠ 未能安排」嗰啲格 ──────
  //
  // ⚠️ 一定要排喺修違反**之後**：先修好壞嘅，再填空嘅。
  // 倒轉做嘅話，填空嗰陣會參考住一個仲有違反嘅狀態，
  // 而填落去嗰個人有機會啱啱好令嗰個違反更難修。
  const gap = proposeGapFills_(context, workingState);

  return {
    proposals: proposals.concat(gap.proposals),
    unfixable: unfixable,
    unfillable: gap.unfillable,
    gapCapped: gap.capped,
    gapCount: gap.gapCount
  };
}

/**
 * 供前端呼叫：〔請系統幫我調整〕。**會寫入（建立／重建那一張建議表）。**
 *
 * ⚠️ 它**不會**碰 `RosterAssignments`。建議表是一張獨立的工作表，
 * 幹事撳〔接受這個建議版本〕之前，正式資料一格都沒有變。
 *
 * ⚠️ 第四十二輪批次 A 組：起點每次重新判斷。兩張表都改過的時候
 * **回一個 `needsChoice`，由幹事揀**——不自己靜靜揀一張。
 *
 * @param {string} quarterId 季度 ID
 * @param {string=} startFrom `GRID` 或者 `SUGGESTION`（幹事在小窗揀的答案）
 * @returns {Object} {ok, sheetName, url, manualCount, systemCount, ...}
 */
/**
 * ⚠️ 第四十三輪批次 A 組：**同一時間只可以有一個會改動資料的動作在跑。**
 *
 * 這個薄殼只做兩件事：檢查權限、拿鎖。真正的內容在下面那一個
 * `apiBuildSuggestion_locked_()`。分開兩層是刻意的——把 `withMutationLock_()`
 * 塞進原本那個函式裡面，就要在它每一個 `return` 前面記得放鎖，
 * 而漏一個就會令整份試算表卡死到下一次執行為止。
 *
 * 理由的全文在 `src/MutationLock.gs` 檔頭。
 */
function apiBuildSuggestion(quarterId, startFrom) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('請系統幫我調整', function () {
    return apiBuildSuggestion_locked_(quarterId, startFrom);
  });
}

function apiBuildSuggestion_locked_(quarterId, startFrom) {

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。', '什麼都沒有改動。', ['先在第 1 步生成職事表']));
  }

  const start = resolveSuggestionStartPoint_(quarterId, versionNo, startFrom);
  if (start.needsChoice) {
    return {
      ok: false,
      needsChoice: true,
      versionNo: versionNo,
      gridSheetName: start.gridSheetName,
      suggestionSheetName: start.suggestionSheetName,
      reason: start.reason,
      message: start.reason === 'NO_FINGERPRINT'
        ? '系統看不出上一次的建議表是由哪一版算出來的（那一張可能是舊版本，'
          + '或者最底那一行被刪掉了）。要用哪一張做起點，請你決定。'
        : '你在兩張表上都改過。要用哪一張做起點，請你決定——'
          + '選了其中一張，另一張上面的改動這一次不會計算在內。'
    };
  }

  const built = buildSuggestionState_(quarterId, start);
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

  // ═════════════════════════════════════════════════════════════════
  // ⚠️ 第四十三輪批次 B 組：**建議表同現況一模一樣就不要建立。**
  // ═════════════════════════════════════════════════════════════════
  //
  // 現場（Ivan 找出的重現條件）：撳〔儲存我的修改〕之後**即刻**撳
  // 〔請系統幫我調整〕⇒ 出錯。
  //
  // 重現出來的形狀是這樣：剛剛儲存完，grid 同版本紀錄已經一致，
  // 所以幹事改動是 0 格；那一版又沒有任何規則違反，所以系統建議也是 0 格。
  // 但系統**照樣建立一張建議表**——一張同正式表一模一樣的表。
  // 然後幹事撳〔接受這個建議版本〕，下游就拋：
  //
  //     materialiseManualEdits_() 沒有收到任何人手改動，不應該建立新版本
  //
  // 即是：介面給了他一張表同一粒〔接受〕，而那粒掣**一定會失敗**。
  // 那正正是這幾輪一直在殺的東西——一個接了一半的介面。
  //
  // ⚠️ 判斷用「兩邊都是 0」，不是「幹事改動是 0」：
  // 第四十三輪 D 組之後，幹事一格都沒有改，系統仍然可能為
  //「⚠ 未能安排」那些格提出建議——那一種是有內容的，要照樣建立。
  const manualCount = Object.keys(built.manualKeys).length;
  const systemCount = Object.keys(built.systemKeys).length;
  if (manualCount === 0 && systemCount === 0) {
    return {
      ok: false,
      nothingToDo: true,
      versionNo: built.versionNo,
      remaining: [],
      message: '你現在看著的第 ' + built.versionNo + ' 版，同版本紀錄完全一樣'
        + '（沒有未儲存的改動），系統也找不到任何需要調整的地方。'
        + '所以沒有建立建議表——建立一張同正式表一模一樣的表，'
        + '接受它的時候一定會失敗。'
    };
  }

  const sheetName = buildSuggestionSheetName_(quarterId, built.versionNo);
  const written = writeSuggestionSheet_(quarterId, built, sheetName);

  // ── 記低這一次的兩個指紋 ────────────────────────────────────
  //
  // ⚠️ 建議表那一個指紋要**讀返出嚟先算**，不可以用寫入之前那份資料算。
  // 用同一個 `readGridTextFromSheet_()` 讀，下一次比對才會是同一把尺；
  // 兩把尺的話，幹事一格都沒有改，系統都會以為他改過。
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const gridFp = fingerprintGridText_(
    readGridTextFromSheet_(start.gridSheetName, timezone));
  const suggestionFp = fingerprintGridText_(
    readGridTextFromSheet_(sheetName, timezone));
  writeSuggestionFingerprints_(
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName), gridFp, suggestionFp);

  writeAuditLog_({
    action: 'SUGGESTION_BUILT',
    targetSheet: sheetName,
    targetCell: '',
    oldValue: '起點：' + (start.source === SUGGESTION_START.SUGGESTION
      ? start.suggestionSheetName : start.gridSheetName),
    newValue: '幹事改了 ' + Object.keys(built.manualKeys).length + ' 格，系統再改了 '
      + Object.keys(built.systemKeys).length + ' 格'
  });

  return {
    ok: true,
    versionNo: built.versionNo,
    sheetName: sheetName,
    url: buildGridSheetUrl_(sheetName),
    // ⚠️ 畫面上一定要講明起點——讓幹事一眼核對得到。
    // 不講的話，「系統有沒有計算我剛才改的那幾格」這條問題他答不出。
    startSource: start.source,
    startSheetName: start.source === SUGGESTION_START.SUGGESTION
      ? start.suggestionSheetName : start.gridSheetName,
    startNote: describeSuggestionStart_(start),
    manualCount: Object.keys(built.manualKeys).length,
    systemCount: Object.keys(built.systemKeys).length,
    // ⚠️ 第四十三輪批次 C1：畫面那三個數字**由實際上了色的格數出來**。
    // `manualCount`／`systemCount` 是「幹事改過幾多格」「系統動過幾多格」
    // ——那兩個仍然有用（A 組那條「第二次要認到 4 格」就是靠它），
    // 但它們**不等於表上有幾多格黃、幾多格藍**：同一格兩邊都算一次。
    // 畫面只可以讀 `colourCounts`，否則又是兩個真相來源。
    colourCounts: written.colourCounts,
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
    unfixableCount: (built.unfixable || []).length,
    // ⚠️ 第四十三輪批次 D 組：填唔到嗰啲格**一定要逐格講**，
    // 而且要講原因——「仲有 N 格填唔到」對幹事嚟講唔知下一步做乜。
    unfillable: (built.unfillable || []).map(function (u) {
      return {
        serviceDate: u.serviceDate,
        postNameTC: u.postNameTC,
        slotIndex: u.slotIndex,
        reason: u.reason
      };
    }),
    gapCapped: !!built.gapCapped,
    gapCount: built.gapCount || 0
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
    // ⚠️ 第四十三輪批次 C1：**三種顏色，不是兩種。**
    //
    // 現場：對話框報「黃色格 1 格／藍色格 1 格」，而張表上一格黃色都沒有。
    // 成因是同一格既被幹事改過、又被系統再改一次——兩個數字各自算對了，
    // 而上色那一段只上得到一種，藍色蓋過黃色。
    //
    // 即是**對話框報告了一個表上沒有的數字**。這是第二次
    //（上一次是第四十二輪那句「系統會用你改完那一版做起點」）。
    // 修法不是改上色次序（那樣只會反過來蓋走藍色），是**開多一種顏色**，
    // 令每一個數字都對得住表上一種真正存在的東西。
    ['黃色格 ＝ 你自己改過的', '藍色格 ＝ 系統建議改的',
      '紫色格 ＝ 你改過，而系統又再改了一次'],
    ['系統改過的格，把滑鼠停在上面會見到它為甚麼改。'],
    // ⚠️ 第四十二輪批次 A 組：這一句以前是**假的**——系統當時只會用
    // 第一次那個快照。現在真的做得到（見 `resolveSuggestionStartPoint_()`），
    // 而且有測試釘住。任何一句「系統會…」都要有一條測試證明它真的會。
    ['改完可以回介面再撳一次「請系統幫我調整」，'
      + '系統會重新讀這一張表做起點再算一次。'],
    ['如果你改的是正式那一張職事表（不是這一張），'
      + '系統就會用正式那一張做起點。兩張都改過的話，它會問你要用哪一張。']
  ];
  legend.forEach(function (line, i) {
    sheet.getRange(i + 1, 1, 1, Math.max(2, line.length)).setValues(
      [line.concat(new Array(Math.max(0, Math.max(2, line.length) - line.length)).fill(''))]);
  });
  sheet.getRange(2, 1).setBackground(SUGGESTION_COLOR_MANUAL);
  sheet.getRange(2, 2).setBackground(SUGGESTION_COLOR_SYSTEM);
  sheet.getRange(2, 3).setBackground(SUGGESTION_COLOR_BOTH);
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
  // ⚠️ 第四十三輪批次 C1：**上色的時候順手數。**
  //
  // 對話框那三個數字一定要由「實際上了色的格」數出來，
  // 不可以由 `manualKeys`／`systemKeys` 各自 `Object.keys().length` 算——
  // 那樣就是兩個真相來源，而現場那個 bug 正正是兩邊對不上。
  const colourCounts = { manual: 0, system: 0, both: 0 };
  layout.rows.forEach(function (row, r) {
    const dateStr = String(row[0]);
    for (let c = 3; c < layout.keys.length; c++) {
      const key = String(layout.keys[c] || '');
      if (key.indexOf('#') === -1) continue;
      const parts = key.split('#');
      const cellKey = cellKey_(dateStr, parts[0], Number(parts[1]));
      const cell = sheet.getRange(dataStart + r, c + 1);
      // ⚠️ 第四十三輪批次 C1：**三種情況，三種顏色，一個都不可以蓋走。**
      //
      // 舊寫法是「系統改過的蓋過幹事改過的」。理由當時寫得很順：
      // 「對他來講最重要的資訊是『系統動過我改的那一格』」。
      // 但後果是對話框報的「黃色 N 格」在表上根本找不到——
      // 而幹事第一件事就是去表上找那 N 格。
      const isManual = built.manualKeys[cellKey] === true;
      const isSystem = built.systemKeys[cellKey] === true;
      if (isManual && isSystem) {
        cell.setBackground(SUGGESTION_COLOR_BOTH);
        colourCounts.both++;
      } else if (isSystem) {
        cell.setBackground(SUGGESTION_COLOR_SYSTEM);
        colourCounts.system++;
      } else if (isManual) {
        cell.setBackground(SUGGESTION_COLOR_MANUAL);
        colourCounts.manual++;
      }
      if (built.notes[cellKey]) cell.setNote(built.notes[cellKey]);
    }
  });

  sheet.autoResizeColumns(1, layout.keys.length);

  // ⚠️ 第四十三輪批次 C3：欄闊同正式表一樣，用**同一個函式**。
  // 建議表就是要幹事在上面改，兩張表看起來不同會令他覺得是兩件事。
  try {
    applyGridColumnWidthsForA4_(sheet, layout, dataStart);
  } catch (err) {
    log_('WARN', 'writeSuggestionSheet_：欄寬設定唔到（建議表本身已經建立好）：' + err.message);
  }

  // ⚠️ 第四十三輪批次 C2：**建議表都要有下拉選單。**
  // Ivan 就是要在這一張上面直接再改——正式表有選單而這一張沒有，
  // 他改到一半就會發現「這一張難用過那一張」。
  //
  // ⚠️ 機器鍵行**不是第 2 行**（表頂有圖例），所以要明確傳行號。
  // 失敗不可以令建議表建立失敗——選單是輔助。
  let dropdownResult = null;
  try {
    dropdownResult = applyNameDropdownsToSheet_(sheet, sheetName, headerRow + 1);
  } catch (err) {
    log_('WARN', 'writeSuggestionSheet_：名單下拉選單套用不到（建議表本身已經建立好）：'
      + err.message);
    dropdownResult = { failed: true, error: err.message, columns: [], skipped: [] };
  }

  return { postNames: postNames, colourCounts: colourCounts, dropdownResult: dropdownResult };
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
/**
 * ⚠️ 第四十三輪批次 A 組：**同一時間只可以有一個會改動資料的動作在跑。**
 *
 * 這個薄殼只做兩件事：檢查權限、拿鎖。真正的內容在下面那一個
 * `apiAcceptSuggestion_locked_()`。分開兩層是刻意的——把 `withMutationLock_()`
 * 塞進原本那個函式裡面，就要在它每一個 `return` 前面記得放鎖，
 * 而漏一個就會令整份試算表卡死到下一次執行為止。
 *
 * 理由的全文在 `src/MutationLock.gs` 檔頭。
 */
function apiAcceptSuggestion(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('接受建議版本', function () {
    return apiAcceptSuggestion_locked_(quarterId);
  });
}

function apiAcceptSuggestion_locked_(quarterId) {
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

  // ⚠️ 第四十三輪批次 B 組：零改動要**在這裡擋住並且講人話**。
  // 不擋的話，下游 `materialiseManualEdits_()` 會拋一句寫給開發者看的
  // 「沒有收到任何人手改動，不應該建立新版本」——幹事看見那一句
  // 只會以為系統壞了，而其實是他沒有東西可以儲存。
  if (resolved.changes.length === 0) {
    discardSuggestionSheet_(quarterId, versionNo);
    return {
      ok: false,
      nothingToDo: true,
      versionNo: versionNo,
      baseVersionNo: versionNo,
      cellCount: 0,
      savedChanges: [],
      message: '建議表的內容同第 ' + versionNo + ' 版一模一樣，沒有東西可以儲存。'
        + '那一張建議表已經清走，職事表一格都沒有改動。'
    };
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

  // ⚠️ 第四十二輪批次 D 組：**逐格列出來**，不是只給一個數字。
  // 「已經接受建議，儲存成第 10 版（2 格改動）」證明不到系統動的
  // 就是他改的那兩格。三個儲存出口共用 `buildSavedChangeRows_()`。
  const acceptPostNames = {};
  (context.posts || []).forEach(function (p) { acceptPostNames[p.postId] = p.postNameTC; });

  return {
    ok: true,
    versionNo: created.versionNo,
    baseVersionNo: versionNo,
    cellCount: resolved.changes.length,
    savedChanges: buildSavedChangeRows_(
      (resolved.changes || []).map(function (c) {
        return {
          serviceDate: c.serviceDate, postId: c.postId, slotIndex: c.slotIndex,
          fromName: c.originalName, toName: c.manualText
        };
      }), acceptPostNames, 'MANUAL'),
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

/* ═════════════════════════════════════════════════════════════════════
 * 第四十二輪批次 A 組：**每一次撳〔請系統幫我調整〕都要重新讀當下的表。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * ─────────────────────────────────────────────────────────────────────
 * 現場（2026-08-21 晚）
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. 改兩格 → 撳調整 → 建議表出現，報「你自己改過的（2 格）」
 *   2. 撳〔稍後再決定〕
 *   3. **在正式那一張職事表再改另外兩格**
 *   4. 再撳調整 ⇒ 系統仍然報 2 格，把第 3 步那兩格當成不存在
 *
 * 成因：上一輪寫成「建議表存在 ⇒ 一律以建議表做起點」。
 * 而建議表是第 1 步那一刻的**快照**——幹事之後在正式表上改的東西
 * 完全不在裡面。
 *
 * ⚠️ 但真正嚴重的不是漏了兩格，是**建議表上面自己寫住**：
 *
 *   「改完可以回介面再撳一次『請系統幫我調整』，
 *     系統會用你改完之後這一版做起點再算一次。」
 *
 * 介面明文承諾了一件系統不會做的事。**這比沒有這個功能更差**——
 * 沒有功能他會自己想辦法，有一句假承諾他會相信它，然後照著做，
 * 而系統靜靜地做另一件事。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 這一輪的做法
 * ─────────────────────────────────────────────────────────────────────
 *
 * 起點不再靠「建議表在不在」猜，改成**逐張表比對指紋**：
 *
 * | 正式表改過 | 建議表改過 | 起點 |
 * |---|---|---|
 * | ✗ | ✗ | 建議表（重撳一次結果一樣，這樣最穩定） |
 * | ✓ | ✗ | **正式表**（就是現場那個情況） |
 * | ✗ | ✓ | 建議表 |
 * | ✓ | ✓ | **問幹事**，不自己揀 |
 *
 * ⚠️ 最後那一行是刻意的。兩張表都改過的時候，任何一個自動選擇都會
 * 靜靜丟掉他其中一批改動——而他不會知道。**寧可多問一次。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 指紋放在哪裡，為什麼
 * ─────────────────────────────────────────────────────────────────────
 *
 * 放在**建議表自己最底那一行**（`[起點指紋]` 開頭），不是
 * `PropertiesService`。理由：
 *
 *   • Properties 是一份**離開了那張表的**狀態。幹事手動刪走建議表之後，
 *     Properties 仍然留著一組指向一張不存在的表的指紋——
 *     那正正是這個專案一直在殺的「兩個真相來源」。
 *   • 指紋跟表一齊生、一齊死，就不可能對不上。
 *
 * ⚠️ 那一行讀不到（舊的建議表、或者被人刪走了）⇒ **當成兩張都改過**，
 * 即是問幹事。不可以猜——猜錯的代價是靜靜丟掉他的改動。
 */

/**
 * 一份 grid 文字的指紋。**同一份內容一定出同一個字串。**
 *
 * ⚠️ 一定要排序。`Object.keys()` 的次序在規格上沒有保證，
 * 靠它的話，同一份內容有機會算出兩個指紋 ⇒ 系統會以為幹事改過，
 * 然後每次都問他一條沒有意義的問題。
 *
 * @param {Object.<string, string>} map `readGridTextFromSheet_()` 的結果
 * @returns {string} 指紋
 */
function fingerprintGridText_(map) {
  const keys = Object.keys(map || {}).sort();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  keys.forEach(function (k) {
    const s = k + ' ' + String(map[k] === undefined ? '' : map[k]) + '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = (h1 ^ c) * 16777619 >>> 0;
      h2 = (h2 + c * 31 + (h2 << 5)) >>> 0;
    }
  });
  return keys.length + '-' + h1.toString(16) + h2.toString(16);
}

/** 建議表最底那一行的標記。 */
const SUGGESTION_FINGERPRINT_MARK = '[起點指紋]';

/**
 * 把這一次的兩個指紋寫落建議表最底。
 *
 * ⚠️ `readGridTextFromSheet_()` 只收「第一欄係嚴格 `yyyy-MM-dd`」那些行，
 * 所以這一行不可能被當成資料讀入去。
 *
 * @param {Sheet} sheet 建議表
 * @param {string} gridFp 產生這一次建議的時候，正式表的指紋
 * @param {string} suggestionFp 剛剛寫好的建議表本身的指紋
 */
function writeSuggestionFingerprints_(sheet, gridFp, suggestionFp) {
  const row = sheet.getLastRow() + 2;
  sheet.getRange(row, 1, 1, 3).setValues([[SUGGESTION_FINGERPRINT_MARK, gridFp, suggestionFp]]);
  sheet.hideRows(row);
}

/**
 * 讀返那兩個指紋。**讀不到就回 `null`，不猜。**
 *
 * @param {string} sheetName 建議表名稱
 * @returns {{gridFp: string, suggestionFp: string}|null}
 */
function readSuggestionFingerprints_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  for (let r = lastRow; r >= 1 && r > lastRow - 6; r--) {
    const row = sheet.getRange(r, 1, 1, 3).getValues()[0];
    if (String(row[0] || '').trim() !== SUGGESTION_FINGERPRINT_MARK) continue;
    const gridFp = String(row[1] || '').trim();
    const suggestionFp = String(row[2] || '').trim();
    if (!gridFp || !suggestionFp) return null;
    return { gridFp: gridFp, suggestionFp: suggestionFp };
  }
  return null;
}

/** 起點的兩種來源。 */
const SUGGESTION_START = { GRID: 'GRID', SUGGESTION: 'SUGGESTION' };

/**
 * 這一次要以哪一張表做起點。**每一次撳都重新讀，不重用任何快照。**
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string=} requested 幹事在「兩張都改過」的小窗揀了哪一張
 * @returns {Object} {source, needsChoice, gridChanged, suggestionChanged, ...}
 */
function resolveSuggestionStartPoint_(quarterId, versionNo, requested) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const gridName = buildRosterSheetName_(quarterId, versionNo);
  const suggestionName = buildSuggestionSheetName_(quarterId, versionNo);
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const base = {
    gridSheetName: gridName,
    suggestionSheetName: suggestionName,
    versionNo: versionNo
  };

  if (!ss.getSheetByName(suggestionName)) {
    // 冇建議表 ⇒ 起點一定係正式表。冇任何歧義。
    return Object.assign({}, base, {
      source: SUGGESTION_START.GRID,
      hasSuggestion: false,
      needsChoice: false,
      gridChanged: false,
      suggestionChanged: false,
      reason: 'NO_SUGGESTION'
    });
  }

  const gridFpNow = fingerprintGridText_(readGridTextFromSheet_(gridName, timezone));
  const suggestionFpNow = fingerprintGridText_(readGridTextFromSheet_(suggestionName, timezone));
  const stored = readSuggestionFingerprints_(suggestionName);

  // ⚠️ 幹事明確揀過就照佢揀嗰個。呢個係「兩張都改過」嗰個小窗嘅答案。
  if (requested === SUGGESTION_START.GRID || requested === SUGGESTION_START.SUGGESTION) {
    return Object.assign({}, base, {
      source: requested,
      hasSuggestion: true,
      needsChoice: false,
      gridChanged: !stored || stored.gridFp !== gridFpNow,
      suggestionChanged: !stored || stored.suggestionFp !== suggestionFpNow,
      reason: 'OPERATOR_CHOSE'
    });
  }

  if (!stored) {
    // ⚠️ 讀唔到指紋（舊嘅建議表、或者最底嗰行俾人刪咗）
    // ⇒ 唔可以猜。問返幹事。
    return Object.assign({}, base, {
      source: '',
      hasSuggestion: true,
      needsChoice: true,
      gridChanged: true,
      suggestionChanged: true,
      reason: 'NO_FINGERPRINT'
    });
  }

  const gridChanged = stored.gridFp !== gridFpNow;
  const suggestionChanged = stored.suggestionFp !== suggestionFpNow;

  if (gridChanged && suggestionChanged) {
    return Object.assign({}, base, {
      source: '',
      hasSuggestion: true,
      needsChoice: true,
      gridChanged: true,
      suggestionChanged: true,
      reason: 'BOTH_CHANGED'
    });
  }

  return Object.assign({}, base, {
    // 兩張都冇改過 ⇒ 用建議表（重撳一次結果一樣，最穩定）。
    // 只有正式表改過 ⇒ 用正式表（就係現場嗰個情況）。
    source: gridChanged ? SUGGESTION_START.GRID : SUGGESTION_START.SUGGESTION,
    hasSuggestion: true,
    needsChoice: false,
    gridChanged: gridChanged,
    suggestionChanged: suggestionChanged,
    reason: gridChanged ? 'GRID_CHANGED'
      : (suggestionChanged ? 'SUGGESTION_CHANGED' : 'NEITHER_CHANGED')
  });
}

/**
 * 起點那一句人話。**畫面上一定要講**，讓幹事一眼核對得到。
 * @param {Object} start `resolveSuggestionStartPoint_()` 的結果
 * @returns {string} 一句
 */
function describeSuggestionStart_(start) {
  if (start.source === SUGGESTION_START.SUGGESTION) {
    return '這一次的起點是建議表「' + start.suggestionSheetName + '」'
      + (start.suggestionChanged ? '（你在上面改過）' : '（跟上一次一樣，沒有改過）') + '。';
  }
  return '這一次的起點是職事表「' + start.gridSheetName + '」（第 '
    + start.versionNo + ' 版）'
    + (start.gridChanged ? '，包括你剛才在上面改的那幾格' : '') + '。';
}

/**
 * 第四十三輪批次 B 組：清走**其他版本**那些建議表。
 *
 * ⚠️ 只清「不是這一版」那些。這一版自己那一張要留著——
 * 幹事有可能正正是在那一張上面改東西。
 *
 * ⚠️ 名字比對要**嚴格**：`Roster_<季度>_v<數字>_建議`。
 * 用 `indexOf('_建議')` 之類的寬鬆比對，會連幹事自己開的
 * 「2028T1_建議名單」這種表都刪掉——刪一張他自己的表，
 * 比留低幾張過時的建議表差得多。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} keepVersionNo 要留低那一版
 * @returns {string[]} 清走了哪幾張
 */
function discardStaleSuggestionSheets_(quarterId, keepVersionNo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const prefix = SHEET_PREFIXES.ROSTER + quarterId + '_v';
  const keep = buildSuggestionSheetName_(quarterId, keepVersionNo);
  const removed = [];
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (name === keep) return;
    if (name.indexOf(prefix) !== 0) return;
    const rest = name.slice(prefix.length);
    if (!/^\d+_建議$/.test(rest)) return;
    ss.deleteSheet(sheet);
    removed.push(name);
  });
  if (removed.length > 0) {
    log_('INFO', '清走過時嘅建議表：' + removed.join('、'));
  }
  return removed;
}

/**
 * 第四十三輪批次 D 組：**「⚠ 未能安排」那些格，也試著找人填。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 的原話
 * ═════════════════════════════════════════════════════════════════════
 *
 * > 系統幫我調整 → 為什麼不安排那些「⚠ 未能安排」？它應該做得到。
 *
 * 他是對的。`proposeMinimalFix()` 本來只處理「幹事改動造成的規則違反」
 * ——一格**根本沒有人**不算違反（`findStateViolations_()` 開頭第一句就是
 * `if (!cell.personId) return;`），所以那些格由頭到尾沒有被看過一眼。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 哪些格**不算**「未能安排」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 三種留白是**正常的**，一格都不可以自動派人：
 *
 *   `NO_AUTO_GENERATE`　　講員／翻譯／獻花——本來就是人手填
 *   結構性不適用　　　　　例如非首主日的聖餐襄禮
 *   特別主日跳過　　　　　那一週那個崗位由別的單位負責
 *
 * 派人落去這三種格，是**製造**一個錯，不是修一個錯。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 找不到人的格要講出來，而且要講**為什麼**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 只講「還有 N 格填不到」，幹事下一步做什麼都不知道。
 * `findReplacementPerson_()` 本來就分得出三種原因（沒有合資格的人／
 * 全部都超出次數上限／全部都會造成新的違反），照實轉出去。
 */

/** 一次最多為幾多格空格找人。理由見下面。 */
const GAP_FILL_MAX_CELLS = 40;


/**
 * 為「系統應該排但排不出」那些格找人。
 *
 * ⚠️ 每找到一個人就**當成已經生效**再算下一格——否則逐格獨立計算，
 * 兩格會指向同一個人而製造出新的違反。這跟
 * `proposeMinimalFixFromState_()` 修違反那一段是同一個做法。
 *
 * @param {Object} context fine-tune context
 * @param {Object[]} workingState 已經套用完「修違反」那一批的狀態
 * @returns {{proposals: Object[], unfillable: Object[], capped: boolean}}
 */
function proposeGapFills_(context, workingState) {
  // ⚠️ 用共用嗰個定義（FineTune.gs）。三個地方各寫一次嘅話，
  // 三個數字會慢慢唔一樣，而幹事會以為系統時好時壞。
  const gaps = listGenuineBlankCells_(workingState, context);

  const proposals = [];
  const unfillable = [];
  // ⚠️ 有上限，而且**一定要講出來**。`findReplacementPerson_()` 每個候選人
  // 都會重跑一次整張表的規則檢查，幾十格 × 幾十個人就會撞爆
  // Apps Script 的六分鐘上限——而撞爆的樣子是「撳完之後什麼都沒有發生」。
  const capped = gaps.length > GAP_FILL_MAX_CELLS;
  const todo = capped ? gaps.slice(0, GAP_FILL_MAX_CELLS) : gaps;

  todo.forEach(function (cell) {
    const key = cellKey_(cell.serviceDate, cell.postId, cell.slotIndex);
    const post = findPostById_(context.posts, cell.postId);
    const found = findReplacementPerson_({
      serviceDate: cell.serviceDate,
      postId: cell.postId,
      slotIndex: cell.slotIndex,
      personId: ''
    }, workingState, context);

    if (!found.personId) {
      unfillable.push({
        serviceDate: cell.serviceDate,
        postId: cell.postId,
        postNameTC: post ? post.postNameTC : cell.postId,
        slotIndex: cell.slotIndex,
        // ⚠️ 原因照實轉出去。「填不到」三個字對幹事完全沒有用——
        // 他要知道的是「去加一個人」還是「去改一改不能服侍的日期」。
        reason: found.reason || '系統找不到合資格而當日又排得到的人。'
      });
      return;
    }

    proposals.push({
      serviceDate: cell.serviceDate,
      postId: cell.postId,
      postNameTC: post ? post.postNameTC : cell.postId,
      slotIndex: cell.slotIndex,
      manualName: '',
      suggestedPersonId: found.personId,
      suggestedName: nameOfPersonId_(context, found.personId),
      brokenRuleId: '',
      kind: 'FILL_GAP',
      reason: '這一格本來排不出（⚠ 未能安排），系統找到 '
        + nameOfPersonId_(context, found.personId) + ' 可以做。'
    });

    workingState.forEach(function (s) {
      if (cellKey_(s.serviceDate, s.postId, s.slotIndex) !== key) return;
      s.personId = found.personId;
    });
  });

  return {
    proposals: proposals,
    unfillable: unfillable,
    capped: capped,
    gapCount: gaps.length,
    triedCount: todo.length
  };
}
