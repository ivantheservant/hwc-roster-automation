/**
 * 「步驟 3：套用修改申報」的核心邏輯：讀取 Requests 的 PENDING 申報、驗證、
 * 幹事確認後套用，以現有版本為底本產生新版本（例如 v9 → v10），舊版本完全不動。
 *
 * 大量重用 FineTune.gs 已經驗證過的機制，不重寫排表或違規檢查邏輯：
 * - buildFineTuneContext_()：讀取底本版本、崗位、資格、規則等資料
 * - findStateViolations_()：套用後重跑規則檢查
 * - findReplacementPerson_()：「不能服侍」找替補，套用全部 HARD／SEMI_HARD 規則
 * - cellKey_() / nameOfPersonId_()：格子鍵與姓名查詢
 * Generator.gs／FineTune.gs 本身完全沒有被修改。
 */

/**
 * 讀取指定季度目前待處理的申報：以 RequestID 是否空白判斷（見下方函式內的註解），
 * 不是看 Status 的文字；且日期／崗位／姓名／類型四欄必須全部非空白才算一筆申報，
 * 只要其中一欄空白就整行略過，不會送進驗證、也不會寫入任何 Status／處理結果／
 * 處理時間——避免把幹事還沒填完的半成品列當成一筆申報去處理（追加階段 K，
 * 見 planCleanRequestsTampering_() 檔頭註解描述的孤兒行症狀：原本半填的列會被
 * validateRequest_() 判成 NEEDS_INPUT 並寫入系統欄位，看起來像是「系統動過的資料」，
 * 之後又被「清理 Requests 手改痕跡」正確地清掉那三欄，剩下一行只有清理備註、
 * 其餘全空的列，容易讓人誤會是另一個 bug）。
 *
 * 回傳的陣列額外掛了 skippedIncompleteCount 屬性（不影響 .length／.forEach 等
 * 陣列原生操作），記錄本次略過了幾行「有填了一些欄位、但沒填滿四欄」的半成品列，
 * 供呼叫端在報告中列出；四欄全空的列（單純的空白列）不計入這個數字。
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 每項為 {sheetRow, requestId, quarterId, serviceDateText, postNameText, personNameText, requestType}
 */
function readPendingRequests_(quarterId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.REQUESTS + '，請先執行「建立 Requests 工作表」');

  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];

  const keys = getRequestsHeaderKeys_();
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const C = COLUMNS.REQUESTS;

  const idCol = keys.indexOf(C.REQUEST_ID);
  const qCol = keys.indexOf(C.QUARTER_ID);
  const dateCol = keys.indexOf(C.SERVICE_DATE);
  const postCol = keys.indexOf(C.POST_NAME);
  const personCol = keys.indexOf(C.PERSON_NAME);
  const typeCol = keys.indexOf(C.REQUEST_TYPE);

  // 追加階段 AB：日期欄一律經 toDateString() 正規化成 yyyy-MM-dd 再往下傳。
  // 由下拉選單揀入的日期，Google 試算表會自動辨識成真正的日期值，讀出來是
  // Date 物件；原本這裡用 String() 直接轉，會得出
  // 「Sun Oct 04 2026 00:00:00 GMT+1300 (New Zealand Daylight Time)」，
  // 跟已正規化的 ServiceDates 永遠對不上，令所有申報被誤判成 NEEDS_INPUT。
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const results = [];
  let skippedIncompleteCount = 0;
  values.forEach(function (row, i) {
    if (String(row[qCol] || '').trim() !== quarterId) return;

    // 用 RequestID 是否空白判斷「系統是否已經真正處理過」，不是看 Status 的文字。
    // RequestID 只會在這裡（處理的同一次）指派，Status 是幹事看得到、也打得到的欄位，
    // 若改用 Status 當作篩選依據，手打一個合法的假值（例如 APPLIED）就能讓這一行
    // 被誤判為「已處理」而永遠跳過——那就完全繞過了「套用時整段覆寫」這道真正的防線。
    const requestId = String(row[idCol] || '').trim();
    if (requestId !== '') return;

    // 第二十一輪批次階段 C：幹事輸入嘅日期只收兩種寫法
    // （Date 物件、或者文字 yyyy-MM-dd）。詳細理由見 parseOfficerDateInput_()。
    //
    // ⚠️ 認唔到嘅日期**唔可以當成空白略過**——噉樣就變成靜靜咁吞咗
    // 一筆申報。要照樣傳落去，由 validateRequest_() 報 NEEDS_INPUT
    // 並寫明原因，令幹事喺驗證結果視窗見得到。
    const parsedDate = parseOfficerDateInput_(row[dateCol], timezone);
    const dateText = parsedDate.dateStr;
    const rawDateText = parsedDate.rawText;
    const postText = String(row[postCol] || '').trim();
    const personText = String(row[personCol] || '').trim();
    const typeText = String(row[typeCol] || '').trim();

    // 四欄都空 = 空白列，唔算申報；有內容但唔齊 = 不完整，計入略過數。
    const hasAnyDate = dateText !== '' || rawDateText !== '';
    if (!hasAnyDate || !postText || !personText || !typeText) {
      if (hasAnyDate || postText || personText || typeText) skippedIncompleteCount++;
      return;
    }

    results.push({
      sheetRow: i + 3,
      requestId: requestId,
      quarterId: quarterId,
      serviceDateText: dateText || rawDateText,
      // 格式認唔到嗰陣，validateRequest_() 要報得出「格式問題」
      // 而唔係「唔屬於呢個季度」——兩者嘅修法完全唔同。
      serviceDateParseFailed: !parsedDate.ok,
      postNameText: postText,
      personNameText: personText,
      requestType: typeText
    });
  });
  results.skippedIncompleteCount = skippedIncompleteCount;
  return results;
}

/**
 * 讀取指定版本每格的 RuleFlags（拆成陣列），供套用時延續未改動格子的顯示邏輯
 * （buildGridLayout_() 靠 ruleFlags 判斷結構性不適用 vs 待人手填寫，見 RosterWriter.gs）。
 * buildFineTuneContext_() 的 original 沒有帶這個欄位，所以另外讀一次。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object.<string, string[]>} 以 cellKey_() 為鍵的 ruleFlags 對照
 */
function readVersionRuleFlags_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const map = {};
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId || Number(row[C.VERSION_NO]) !== versionNo) return;
    const key = cellKey_(toDateString(row[C.SERVICE_DATE], timezone), row[C.POST_ID], row[C.SLOT_INDEX]);
    map[key] = splitList_(row[C.RULE_FLAGS]);
  });
  return map;
}

/**
 * 追加階段 AS 新增：找出「同一人、同一日，同時有『不能服侍』與『指定服侍』」的申報組合。
 *
 * 這兩種申報放在同一人同一日是語意矛盾的：「不能服侍」的語意是當日整日不會出席
 * （不是「只是不能做某一個崗位」，見 applyCannotServe_() 的說明），既然整日不來，
 * 就不可能同時獲指定服侍。原本沒有偵測這種組合，實際行為完全取決於兩筆申報在
 * Requests 工作表上的先後次序——先「不能服侍」後「指定服侍」會把人放回去、留下一項
 * 硬規則違反；次序反過來則當日全部清空。同一份資料兩種結果，而且都沒有提示，
 * 所以改為兩筆都攔下來，要求幹事自己澄清要保留哪一筆。
 *
 * 判斷用**解析後的 PersonID**，不是姓名原文——同一個人可能被寫成正名或別名
 * （例如異體字），用原文比對會漏掉。日期用 readPendingRequests_() 已正規化的
 * serviceDateText。姓名解析不到的申報略過不計，讓 validateRequest_() 去報它自己
 * 「不在 NameMapping」那個更根本的問題。
 *
 * 只有「兩種類型同時出現」才算矛盾。以下組合**不會**被判為矛盾，因為它們在真實
 * 職事表中完全合理：
 * - 同一人同一日兩筆「指定服侍」但崗位不同（同週兼任多個崗位很常見）
 * - 同一人同一日兩筆「不能服侍」（重複申報，applyCannotServe_() 本身已能正確處理）
 *
 * @param {Object[]} pending readPendingRequests_() 的結果
 * @returns {Object.<string, boolean>} 以 "PersonID|日期" 為鍵，值為 true 代表該組合矛盾
 */
function buildRequestConflictKeys_(pending) {
  const typesByKey = {};
  pending.forEach(function (req) {
    const personId = resolvePersonId(req.personNameText);
    if (!personId) return;
    const key = personId + '|' + req.serviceDateText;
    if (!typesByKey[key]) typesByKey[key] = {};
    typesByKey[key][req.requestType] = true;
  });

  const conflicts = {};
  Object.keys(typesByKey).forEach(function (key) {
    if (typesByKey[key][REQUEST_TYPE.CANNOT_SERVE] && typesByKey[key][REQUEST_TYPE.DESIGNATED_SERVE]) {
      conflicts[key] = true;
    }
  });
  return conflicts;
}

/**
 * 階段 B（第五輪批次）新增：掃描 Requests 全表（不限單一季度），列出每個
 * 出現過的 QuarterID 有幾多筆待處理（RequestID 空白）申報，附上該季度目前
 * 的 Stage，以及矛盾組合（同一人同一日「不能服侍」＋「指定服侍」）的偵測
 * 結果——重用 readPendingRequests_()／buildRequestConflictKeys_()，不是
 * 另外寫一套判斷邏輯，保證跟步驟 3／5 實際套用時看到的結果一致。純讀取，
 * 不改動任何資料，也不要求這一季已經生成過版本（矛盾組合偵測只需要
 * Requests 本身的內容，不需要底本版本）。
 *
 * 特別標示「季度已經是 OFFICIAL_SENT 但仍有待處理申報」——這種殘留申報會在
 * 下次對該季度執行「步驟 5：改動後重發」時被撈起，屆時如果矛盾組合還在，
 * 一樣會被判 NEEDS_INPUT、不會自動處理掉。及早在「上線前檢查」發現，比
 * 等到真正執行步驟 5 才發現更好——尤其是幹事可能以為「這一季已經正式發出，
 * 應該沒事了」，其實 Requests 裡還有沒處理完的殘留。
 *
 * @returns {Object[]} 只列出有待處理申報的季度，每項為 {quarterId, stage,
 *   pendingCount, conflictCount, conflictDetails, isOfficialSentWithPending}；
 *   conflictDetails 每項為 {personId, date, requests}
 */
function scanPendingRequestsAllQuarters_() {
  let allQuarterIds = [];
  try {
    const R = COLUMNS.REQUESTS;
    const seen = {};
    readSheet(SHEETS.REQUESTS).forEach(function (row) {
      const qid = String(row[R.QUARTER_ID] || '').trim();
      if (qid && !seen[qid]) { seen[qid] = true; allQuarterIds.push(qid); }
    });
  } catch (err) {
    return []; // Requests 工作表不存在，沒有東西可以掃，不當作錯誤
  }

  return allQuarterIds.map(function (quarterId) {
    const pending = readPendingRequests_(quarterId);
    const conflictKeys = buildRequestConflictKeys_(pending);
    const conflictDetails = Object.keys(conflictKeys).map(function (key) {
      const sep = key.indexOf('|');
      const personId = key.slice(0, sep);
      const date = key.slice(sep + 1);
      const requests = pending.filter(function (r) {
        return resolvePersonId(r.personNameText) === personId && r.serviceDateText === date;
      });
      return { personId: personId, date: date, requests: requests };
    });
    let stage = '';
    try { stage = getQuarterStage_(quarterId); } catch (err) { stage = '（讀取失敗：' + err.message + '）'; }
    return {
      quarterId: quarterId,
      stage: stage,
      pendingCount: pending.length,
      conflictCount: conflictDetails.length,
      conflictDetails: conflictDetails,
      isOfficialSentWithPending: stage === QUARTER_STAGE.OFFICIAL_SENT && pending.length > 0
    };
  }).filter(function (r) { return r.pendingCount > 0; });
}

/**
 * 驗證單一申報，分成三類：APPLY（可直接套用）、CONFIRM（需要幹事確認）、
 * NEEDS_INPUT（無法套用）。只判斷，不改動任何資料。
 * @param {Object} req readPendingRequests_() 的單一項目
 * @param {Object} context buildFineTuneContext_() 的結果
 * @param {Object.<string, Object>} assignByKey 底本版本的派工，以 cellKey_() 為鍵
 * @param {Object.<string, boolean>=} conflictKeys 選填，buildRequestConflictKeys_() 的結果；
 *   不傳時不做矛盾組合偵測（維持舊行為，方便單獨驗證一筆申報）
 * @returns {Object} 驗證結果，至少含 category；APPLY／CONFIRM 另含 personId/post/serviceDate 等
 */
function validateRequest_(req, context, assignByKey, conflictKeys) {
  const dateText = req.serviceDateText;
  const dateInfo = context.serviceDates.filter(function (d) { return d.serviceDate === dateText; })[0];
  if (!dateInfo) {
    // 第十九輪批次階段 F3：本來兩種完全唔同嘅原因共用同一句，
    // 幹事睇完唔知係「打錯格式」定係「揀錯季度」。分開講。
    //
    // （順帶確認：呢個情況**唔會**被靜靜略過——一律回 NEEDS_INPUT，
    //  會出現喺步驟 3 嘅驗證結果視窗，亦會寫入 Requests 嘅處理結果欄。）
    return {
      category: 'NEEDS_INPUT',
      reason: describeUnknownRequestDate_(dateText, context.quarterId)
    };
  }

  const post = context.posts.filter(function (p) { return p.postNameTC === req.postNameText; })[0];
  if (!post) {
    return { category: 'NEEDS_INPUT', reason: '找不到崗位「' + req.postNameText + '」（Posts 沒有這個中文名稱，或該崗位 Active=FALSE）' };
  }

  // 該崗位該日是否結構性不適用：直接看底本版本第 1 個 slot 的記錄，
  // 沿用 Generator.gs 產生版本時已經算好的結果，不在這裡重新推導 getSkipReason_ 的邏輯。
  const slot1 = assignByKey[cellKey_(dateText, post.postId, 1)];
  if (slot1 && slot1.assignSource === ASSIGN_SOURCE.SKIPPED
      && (slot1.ruleFlags || []).indexOf(RULE_IDS.COMMUNION_FIRST_SUNDAY) !== -1) {
    return { category: 'NEEDS_INPUT', reason: '崗位「' + post.postNameTC + '」在 ' + dateText + ' 結構性不適用（例如非首主日的聖餐襄禮）' };
  }
  // AutoGenerate=FALSE 的崗位（講員／翻譯／獻花等）不會落入上面那個判斷式——
  // 那是「留給人手安排」，不是「崗位不存在」，本來就應該仍可申報，不需要額外處理。

  const personId = resolvePersonId(req.personNameText);
  if (!personId) {
    return { category: 'NEEDS_INPUT', reason: '「' + req.personNameText + '」不在 NameMapping，請先用「新增人員」加入' };
  }

  // 追加階段 AS：矛盾組合一律攔下，兩筆都不套用（見 buildRequestConflictKeys_()）。
  // 放在姓名解析之後、崗位與類型的細節判斷之前——既然這兩筆本身就互相矛盾，
  // 再去談個別崗位是否合資格並無意義，先請幹事澄清要保留哪一筆才是正題。
  if (conflictKeys && conflictKeys[personId + '|' + dateText]) {
    return {
      category: 'NEEDS_INPUT',
      reason: req.personNameText + ' 在 ' + dateText + ' 同時有「' + REQUEST_TYPE.CANNOT_SERVE
        + '」與「' + REQUEST_TYPE.DESIGNATED_SERVE + '」兩筆申報，語意互相矛盾：'
        + '「' + REQUEST_TYPE.CANNOT_SERVE + '」的意思是當日整日不會出席，'
        + '不可能同時獲指定服侍。系統不會自行揀選保留哪一筆，'
        + '請刪除其中一筆（或修正寫錯了的日期／姓名），再重新執行本步驟。'
    };
  }

  const eligiblePool = context.eligibility.byPost[post.postId] || [];
  const eligible = eligiblePool.indexOf(personId) !== -1;

  if (req.requestType === REQUEST_TYPE.CANNOT_SERVE) {
    const existingSlot = findAssignedSlotForPerson_(assignByKey, dateText, post.postId, personId, post.slotCount);
    if (!existingSlot) {
      return {
        category: 'NEEDS_INPUT',
        reason: '查無「' + req.personNameText + '」在 ' + dateText + ' ' + post.postNameTC + ' 的派工紀錄，請確認資料是否正確'
      };
    }
    return { category: 'APPLY', personId: personId, post: post, serviceDate: dateText, slotIndex: existingSlot };
  }

  if (req.requestType !== REQUEST_TYPE.DESIGNATED_SERVE) {
    return { category: 'NEEDS_INPUT', reason: '類型「' + req.requestType + '」不是「' + REQUEST_TYPE.CANNOT_SERVE + '」或「' + REQUEST_TYPE.DESIGNATED_SERVE + '」' };
  }

  if (!eligible) {
    return {
      category: 'CONFIRM',
      reason: req.personNameText + ' 未曾任 ' + post.postNameTC + '，屬硬規則',
      personId: personId, post: post, serviceDate: dateText, needsEligibilityInsert: true
    };
  }
  return { category: 'APPLY', personId: personId, post: post, serviceDate: dateText };
}

/**
 * 在底本版本的派工中，找出指定人員在指定日期／崗位所在的 slot。
 * @param {Object.<string, Object>} assignByKey 底本版本的派工，以 cellKey_() 為鍵
 * @param {string} serviceDate 日期
 * @param {string} postId 崗位 ID
 * @param {string} personId 對象的 PersonID
 * @param {number} slotCount 該崗位的 slot 數
 * @returns {?number} 找到的 slot；找不到回傳 null
 */
function findAssignedSlotForPerson_(assignByKey, serviceDate, postId, personId, slotCount) {
  for (let slot = 1; slot <= slotCount; slot++) {
    const a = assignByKey[cellKey_(serviceDate, postId, slot)];
    if (a && a.personId === personId) return slot;
  }
  return null;
}

/**
 * 決定「指定服侍」要放進哪個 slot：若該人已經在其中一個 slot，就是那個 slot（no-op）；
 * 否則一律指定到第一個 slot（多 slot 崗位的簡化處理，見追加階段 M 說明）。
 * @param {Object.<string, Object>} workingByKey 目前的工作狀態，以 cellKey_() 為鍵
 * @param {string} serviceDate 日期
 * @param {Object} post 崗位（正規化後）
 * @param {string} personId 要指定的 PersonID
 * @returns {number} 目標 slot
 */
function resolveDesignatedSlot_(workingByKey, serviceDate, post, personId) {
  for (let slot = 1; slot <= post.slotCount; slot++) {
    const a = workingByKey[cellKey_(serviceDate, post.postId, slot)];
    if (a && a.personId === personId) return slot;
  }
  return 1;
}

/**
 * 讀取並驗證指定季度目前全部 PENDING 的申報，只讀不寫。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, baseVersionNo: number, context: Object,
 *   assignByKey: Object, results: Object[], skippedIncompleteCount: number}} results 每項為
 *   readPendingRequests_() 的項目再加上 validateRequest_() 的驗證結果；
 *   skippedIncompleteCount 為日期／崗位／姓名／類型未填滿四欄而被整行略過的申報數
 */
function planApplyRequests_(quarterId) {
  const baseVersionNo = findLatestVersionNo(quarterId);
  if (baseVersionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」');

  const context = buildFineTuneContext_(quarterId, baseVersionNo);
  const ruleFlagsByKey = readVersionRuleFlags_(quarterId, baseVersionNo);

  // ⚠️ 第十九輪批次階段 A：呢度**唔可以**淨係讀 `context.original`。
  //
  // 修正之前係讀長表，即係幹事喺 grid 上嘅人手改動會被完全忽略——
  // 唔單止驗證會用舊人名（例如「指定某人服侍」會拎錯目前係邊個），
  // 而且下面寫新版本嗰陣係由 `workingByKey` 出嚟，等於**靜靜咁將
  // 幹事嘅人手改動丟棄**。呢個比 Ivan 報告嗰個症狀更嚴重：改咗、
  // 跑完步驟 3，改動就冇咗，而且冇任何提示。
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'planApplyRequests_');
  const originalByKey = {};
  context.original.forEach(function (a) {
    originalByKey[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a;
  });

  const assignByKey = {};
  resolved.state.forEach(function (s) {
    const key = cellKey_(s.serviceDate, s.postId, s.slotIndex);
    const originalRow = originalByKey[key] || {};
    const person = context.peopleById[s.personId];
    assignByKey[key] = {
      serviceDateId: s.serviceDateId,
      serviceDate: s.serviceDate,
      postId: s.postId,
      slotIndex: s.slotIndex,
      personId: s.personId,
      personName: person ? person.nameTC : (s.isManual ? '' : originalRow.personName),
      // 人手改過嘅格記成 MANUAL，令新版本嘅來源欄講得出真相
      assignSource: s.isManual
        ? ASSIGN_SOURCE.MANUAL
        : (originalRow.assignSource || ASSIGN_SOURCE.AUTO),
      isManual: !!s.isManual,
      ruleFlags: ruleFlagsByKey[key] || []
    };
  });

  const pending = readPendingRequests_(quarterId);
  // 追加階段 AS：矛盾組合要看過全部待處理申報才判斷得出，所以先掃一次，
  // 再把結果交給逐筆驗證的 validateRequest_()。
  const conflictKeys = buildRequestConflictKeys_(pending);
  const results = pending.map(function (req) {
    return Object.assign({}, req, validateRequest_(req, context, assignByKey, conflictKeys));
  });

  return {
    quarterId: quarterId, baseVersionNo: baseVersionNo, context: context, assignByKey: assignByKey,
    results: results, skippedIncompleteCount: pending.skippedIncompleteCount,
    // 幹事喺 grid 上嘅人手改動。套用申報建立新版本嗰陣會一併帶落去，
    // 並且逐格記入 AuditLog（第十九輪批次階段 A2）。
    manualChanges: resolved.changes,
    manualUnresolved: resolved.unresolved
  };
}

/**
 * 套用申報，建立新版本。confirmedSheetRows 是幹事已同意套用的 CONFIRM 類別申報
 * （用 Requests 的列號識別，來自 planApplyRequests_() 的 results[].sheetRow）。
 *
 * Status／處理結果／處理時間三欄一律由這裡的判斷結果整段覆寫（見 writeRequestOutcomes_()），
 * 完全不讀取這三欄目前任何既有值——這是 P-6 修正後真正的把關防線，不是 UI 保護。
 *
 * 步驟 5「改動後重發」：整套套用邏輯（含「不能服侍」AppliesTo=ALL 的同日其他崗位
 * 掃描、各自替補、套用後才重跑規則檢查）完全重用，不是另一套平行實作，差別只在
 * RosterVersions 的 Basis 欄要寫 RESEND 而不是 REQUESTS_APPLIED，所以加一個選填的
 * basis 參數，不傳時維持原本行為（步驟 3 的既有呼叫端不用改）。
 *
 * @param {Object} plan planApplyRequests_() 的結果
 * @param {number[]} confirmedSheetRows 幹事同意套用的 CONFIRM 類別申報列號
 * @param {string=} basis 選填，RosterVersions 的 Basis 值；不傳時預設
 *   VERSION_VALUES.BASIS_REQUESTS_APPLIED（步驟 3 的行為）
 * @param {string=} versionNote 選填，寫入 RosterVersions 備註欄的文字。
 *   第三十四輪批次甲2 新增：掣 1「儲存並確認」而家會經呢條路建立版本
 *   （見 `apiSaveAndConfirmExecute()`），而佢要喺備註講得出「人手改動幾多格、
 *   申報幾多筆」。不傳時維持原本行為（備註留空）。
 * @param {number[]=} gridOverriddenSheetRows 選填，**幹事已經喺 grid 親手改咗
 *   同一格**的申報列號。呢啲申報唔會套用，而係記成 REJECTED 並寫明原因。
 *
 *   ⚠️ 第三十四輪批次甲2：呢個係規格 1.4「同一格既有 grid 改動又有申報 ⇒
 *   grid 贏」嘅實作。之前呢條規則**只存在於一段註解同一個永遠係空嘅
 *   `overlaps` 陣列**——偵測用咗一個唔存在嘅欄位（`r.postId`），
 *   而執行階段根本冇套用過任何申報，所以兩邊都冇人發現。
 *
 *   不傳時維持原本行為（步驟 3／5 嘅既有呼叫端不用改）。
 * @returns {Object} 套用結果摘要
 */
function applyRequests_(plan, confirmedSheetRows, basis, versionNote, gridOverriddenSheetRows) {
  const confirmedSet = {};
  (confirmedSheetRows || []).forEach(function (r) { confirmedSet[r] = true; });
  const gridOverriddenSet = {};
  (gridOverriddenSheetRows || []).forEach(function (r) { gridOverriddenSet[r] = true; });

  const workingByKey = {};
  Object.keys(plan.assignByKey).forEach(function (key) {
    const a = plan.assignByKey[key];
    workingByKey[key] = {
      serviceDateId: a.serviceDateId,
      serviceDate: a.serviceDate,
      postId: a.postId,
      slotIndex: a.slotIndex,
      personId: a.personId,
      personName: a.personName,
      assignSource: a.assignSource,
      ruleFlags: a.ruleFlags.slice()
    };
  });

  const outcomes = [];
  const newEligibilityRows = [];
  const newUnavailableRows = [];
  const pendingBackfillCells = [];

  plan.results.forEach(function (r) {
    if (r.category === 'NEEDS_INPUT') {
      outcomes.push({ sheetRow: r.sheetRow, status: REQUEST_STATUS.NEEDS_INPUT, resultNote: r.reason });
      return;
    }

    // 規格 1.4：同一格幹事已經親手改咗 ⇒ **grid 贏**，呢筆申報唔套用。
    // ⚠️ 但一定要記低，唔可以靜靜咁唔理——幹事要知道佢親手改嗰下
    // 蓋過咗一筆義工提交嘅申報，否則嗰位義工嘅要求就無聲無息消失咗。
    if (gridOverriddenSet[r.sheetRow]) {
      outcomes.push({
        sheetRow: r.sheetRow,
        status: REQUEST_STATUS.REJECTED,
        resultNote: '同一格你已經在職事表上親手改過，以你改的為準，這一筆沒有套用'
      });
      return;
    }

    if (r.category === 'CONFIRM' && !confirmedSet[r.sheetRow]) {
      outcomes.push({ sheetRow: r.sheetRow, status: REQUEST_STATUS.REJECTED, resultNote: '幹事未確認「' + r.reason + '」，已略過' });
      return;
    }
    if (r.category === 'CONFIRM' && r.needsEligibilityInsert) {
      newEligibilityRows.push({ personId: r.personId, postId: r.post.postId });
    }

    if (r.requestType === REQUEST_TYPE.CANNOT_SERVE) {
      applyCannotServe_(r, plan.context, workingByKey, outcomes, newUnavailableRows, pendingBackfillCells);
    } else {
      applyDesignatedServe_(r, plan.context, workingByKey, outcomes);
    }
  });

  // 被頂走的人若因此本季完全沒有服侍，附加提示在對應那筆申報的處理結果
  const countByPerson = {};
  Object.keys(workingByKey).forEach(function (k) {
    const a = workingByKey[k];
    if (a.personId) countByPerson[a.personId] = (countByPerson[a.personId] || 0) + 1;
  });
  outcomes.forEach(function (o) {
    if (o.dislodgedPersonId && !countByPerson[o.dislodgedPersonId]) {
      o.resultNote += '；' + o.dislodgedPersonName + ' 因此本季已完全沒有服侍';
    }
  });

  // 追加階段 AD：plan.context.eligibility 是 buildFineTuneContext_() 在這次執行
  // 一開始讀到的舊快照，不會因為 newEligibilityRows 稍後才寫入工作表而自動更新。
  // 如果不在這裡同步更新，下面 findStateViolations_() 用的還是套用前的舊資料，
  // 會把「這次申報剛剛解決的問題」誤判成未解決的違規（實測：CHAIR 剛靠這次
  // 申報加入 Eligibility，最終檢查卻報 HARD_ELIGIBILITY 違反，因為
  // context.eligibility.byPost 還沒反映這筆新增）。
  //
  // 追加階段 AR：原本這裡還有一段對稱地把 newUnavailableRows 補進
  // plan.context.unavailable 的程式碼，現已移除——不是不再需要同步，而是改成
  // 由 registerUnavailableForDay_() 在「套用當下」就立即同步（見 applyCannotServe_()）。
  // 等到這裡才補太遲了：迴圈內的替補搜尋看不見，申報人會被揀成自己的替補。
  // 保留在這裡反而會變成重複 push 同一筆記錄，所以一併移除。
  newEligibilityRows.forEach(function (row) {
    if (!plan.context.eligibility.byPost[row.postId]) plan.context.eligibility.byPost[row.postId] = [];
    if (plan.context.eligibility.byPost[row.postId].indexOf(row.personId) === -1) {
      plan.context.eligibility.byPost[row.postId].push(row.personId);
    }
  });

  const newVersionNo = findLatestVersionNo(plan.quarterId) + 1;
  const assignments = Object.keys(workingByKey).map(function (k) { return workingByKey[k]; });

  // 第十九輪批次階段 A2：幹事喺 grid 上嘅人手改動而家會跟住新版本一齊
  // 寫落 `RosterAssignments`（之前係靜靜咁丟棄）。既然改動會進入
  // version of record，就一定要有審計軌跡——逐格記低邊格、由邊個變邊個。
  (plan.manualChanges || []).forEach(function (c) {
    writeAuditLog_({
      action: 'MANUAL_GRID_EDIT_CARRIED',
      targetSheet: buildRosterSheetName_(plan.quarterId, plan.baseVersionNo),
      targetKey: cellKey_(c.serviceDate, c.postId, c.slotIndex),
      oldValue: c.originalName || c.originalPersonId || '（空白）',
      newValue: c.manualText || '（空白）',
      source: 'applyRequests',
      notes: '幹事在 grid 人手改動，已隨套用申報帶入 v' + newVersionNo
        + '（原版本 v' + plan.baseVersionNo + ' 保持不變）'
    });
  });

  const violationCheckState = assignments.map(function (a) {
    return {
      serviceDateId: a.serviceDateId, serviceDate: a.serviceDate, postId: a.postId,
      slotIndex: a.slotIndex, personId: a.personId, isManual: false
    };
  });
  const violations = decorateViolations_(
    findStateViolations_(violationCheckState, plan.context), plan.context);
  const warnings = violations.map(function (v) { return makeWarning_(v, v.ruleId, v.reason); });

  // 先建 grid 工作表：若名稱衝突會在寫入長表之前就中止，避免留下孤兒資料列
  // （同 MultiRun.gs 的 performRosterGeneration_() 既有慣例）。
  const sheetName = createRosterSheet(plan.quarterId, newVersionNo, assignments, warnings);
  writeAssignments(plan.quarterId, newVersionNo, assignments);

  // 階段 A（收尾輪）新增：這裡的道理跟 performRosterGeneration_() 的
  // registerVersion() 那段完全一樣——Apps Script 沒有交易機制，grid 工作表與
  // RosterAssignments 這時已經真正寫入了。原本這裡之後的五個寫入
  // （registerVersion／markPendingBackfillCells_／writeNewEligibilityRows_／
  // writeNewUnavailableRows_／writeRequestOutcomes_）完全沒有保護，任何一個
  // 中途失敗（配額錯誤、Apps Script 執行逾時等）都會留下「有 grid 工作表、有
  // RosterAssignments 列，但 RosterVersions 沒有登記」的孤兒版本，而且 Requests
  // 那批申報的 RequestID 仍然空白（writeRequestOutcomes_ 是最後一步）——幹事
  // 完全不知道發生過什麼事，重新執行本步驟時，如果孤兒版本連 RosterVersions
  // 都沒登記，findLatestVersionNo() 還是會算出同一個版本號，createRosterSheet()
  // 會直接因為「工作表已存在」而失敗，卡住整個流程。
  // 這裡跟步驟 1 一樣不嘗試自動回滾，只把已經寫了什麼、需要人手怎麼處理講清楚。
  let newEligibilityCount = 0;
  let newUnavailableCount = 0;
  try {
    registerVersion(plan.quarterId, newVersionNo, sheetName, basis || VERSION_VALUES.BASIS_REQUESTS_APPLIED, plan.baseVersionNo, warnings.length, false, versionNote || '');
    markPendingBackfillCells_(sheetName, pendingBackfillCells);
    newEligibilityCount = writeNewEligibilityRows_(newEligibilityRows);
    newUnavailableCount = writeNewUnavailableRows_(newUnavailableRows);
    writeRequestOutcomes_(outcomes, plan.quarterId);
  } catch (err) {
    throw new Error(
      '套用申報時，工作表 ' + sheetName + ' 與 RosterAssignments 的派工紀錄已經寫入成功，'
        + '但後續登記（RosterVersions／待補格子底色／Eligibility／Unavailable／'
        + 'Requests 處理結果其中一步）失敗（' + err.message + '），流程中途停住了。\n\n'
        + '需要人手處理，建議：\n'
        + '1. 打開 Requests 工作表，檢查這批申報的 RequestID 欄是否已填上——'
        + '仍是空白代表系統還沒把這批標記為「已處理」，重新執行本步驟會再處理一次；\n'
        + '2. 打開 RosterVersions，檢查有沒有 ' + plan.quarterId + '-v' + newVersionNo + ' 這一行——'
        + '沒有的話，' + sheetName + ' 是系統找不到的孤兒版本，重新執行本步驟前'
        + '建議先人手刪除它（連同 RosterAssignments 中 QuarterID=' + plan.quarterId
        + '、VersionNo=' + newVersionNo + ' 的所有列），否則下次執行會因為工作表名稱'
        + '衝突而立即失敗；\n'
        + '3. 完整症狀對照與復原步驟見 docs/中斷復原指引.md「步驟 3／5：套用修改申報'
        + '中途失敗」一節。'
    );
  }

  return {
    sheetName: sheetName,
    versionNo: newVersionNo,
    baseVersionNo: plan.baseVersionNo,
    appliedCount: outcomes.filter(function (o) { return o.status === REQUEST_STATUS.APPLIED; }).length,
    rejectedCount: outcomes.filter(function (o) { return o.status === REQUEST_STATUS.REJECTED; }).length,
    needsInputCount: outcomes.filter(function (o) { return o.status === REQUEST_STATUS.NEEDS_INPUT; }).length,
    pendingBackfillCount: pendingBackfillCells.length,
    newEligibilityCount: newEligibilityCount,
    newUnavailableCount: newUnavailableCount,
    violations: violations
  };
}

/**
 * 追加階段 AR 新增：把 findStateViolations_() 回傳的違規補上中文崗位名與人名，
 * 供對話框逐項顯示。原本對話框只印得出 `postId#slotIndex` 這種機器鍵、
 * 完全沒有涉事人的名字，幹事看見也判斷不了嚴重性。
 *
 * 只加欄位，不改動任何既有欄位（ruleId／severity／reason／serviceDate 等原樣保留），
 * 所以 makeWarning_() 與其他既有讀取方式完全不受影響。
 *
 * @param {Object[]} violations findStateViolations_() 的結果
 * @param {Object} context buildFineTuneContext_() 的結果
 * @returns {Object[]} 每項額外含 postNameTC 與 personName
 */
function decorateViolations_(violations, context) {
  const postNameById = {};
  context.posts.forEach(function (p) { postNameById[p.postId] = p.postNameTC; });

  return violations.map(function (v) {
    const person = context.peopleById[v.personId];
    return Object.assign({}, v, {
      postNameTC: postNameById[v.postId] || v.postId,
      personName: person ? person.nameTC : (v.personId || '（空格）')
    });
  });
}

/**
 * 追加階段 AW 新增：重新讀取指定版本目前的規則檢查結果（已補上人名與崗位名，
 * 供對話框／前端直接顯示）。純讀取，不改動任何工作表。
 *
 * 抽出來的理由：原本這段邏輯只寫在 `handleStep3NoPendingRequests_()`
 * （`FourStageFlow.gs`）裡面一次，Web UI 的步驟 3、5 需要在好幾個時間點
 * （沒有待處理申報時重新檢查、套用申報之後、實際寄送之前）重新確認「這一版
 * 現在還有沒有硬規則違反」，不應該各自重寫一次同一段邏輯。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} decorateViolations_() 過的違規清單
 */
function recomputeLatestVersionViolations_(quarterId, versionNo) {
  return recomputeLatestVersionState_(quarterId, versionNo).violations;
}

/**
 * 第十九輪批次階段 A1：同上，但連「有冇人手改動」一齊回傳。
 *
 * ⚠️ **呢度一定要用 `GRID_OVERLAY`。** 修正之前呢個函式讀
 * `context.original`（`RosterAssignments` 長表），而 UI 就叫幹事去
 * grid 工作表人手修正——兩者係唔同嘅資料。實測後果：幹事改咗 grid、
 * 重跑步驟 3，仍然報同一項違反，人名仍然係改之前嗰個；再改再跑都一樣，
 * 唯一出路變成打「確認放行」，**硬規則閘實際上形同虛設**。
 *
 * 呢個函式係「幹事可能啱啱改咗 grid」嘅典型時刻——步驟 3／5 重新檢查、
 * 寄送之前最後確認——所以權威來源係 grid 疊加後嘅狀態。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{violations: Object[], changes: Object[], unresolved: Object[],
 *   state: Object[], context: Object}}
 */
function recomputeLatestVersionState_(quarterId, versionNo) {
  const context = buildFineTuneContext_(quarterId, versionNo);
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'recomputeLatestVersionState_');
  return {
    violations: decorateViolations_(
      findStateViolations_(resolved.state, context), context),
    changes: resolved.changes,
    unresolved: resolved.unresolved,
    state: resolved.state,
    context: context
  };
}

/**
 * 套用一筆「不能服侍」申報：語意是當日整日不能服侍（不是只擋申報指定的那個崗位）
 * ——所以除了清空申報指定的格，還要找出這個人當天在 workingByKey 裡是否還兼任
 * 其他崗位，一併清空。每一格用 findReplacementPerson_()（FineTune.gs，未改動）
 * 套用全部 HARD／SEMI_HARD 規則找替補；找不到就留空並記入待補清單。
 * 同時登記 Unavailable（AppliesTo=ALL），供下季自動避開整日，不限單一崗位。
 *
 * 追加階段 AC：多格依序（不是同時）處理——每清一格、找到替補就先套用到
 * workingByKey，才處理下一格。這樣下一格呼叫 findReplacementPerson_() 內部的
 * findStateViolations_() 時，會看到上一格剛套用的結果，兩格才不會意外被同一個人
 * 補上而違反「同週同崗位不可重複」（DISTINCT_SLOT，只在該崗位 Posts.DistinctWithinPost
 * =TRUE 時生效）。如果兩格是各自獨立、對同一份「兩格都還空著」的狀態計算替補，
 * 就有可能各自選中同一個候選人，變成新的違規卻沒有任何機制發現——依序處理正是
 * 為了避免這種情況，這是刻意的設計，不是可以省略的細節。
 *
 * @param {Object} r 已驗證的申報（category=APPLY，requestType=不能服侍）
 * @param {Object} context buildFineTuneContext_() 的結果
 * @param {Object.<string, Object>} workingByKey 目前的工作狀態，會就地更新
 * @param {Object[]} outcomes 累積的處理結果，會就地 push
 * @param {Object[]} newUnavailableRows 累積要新增的 Unavailable 列，會就地 push
 * @param {Object[]} pendingBackfillCells 累積要標黃底的格子，會就地 push
 * @returns {void}
 */
function applyCannotServe_(r, context, workingByKey, outcomes, newUnavailableRows, pendingBackfillCells) {
  const personName = nameOfPersonId_(context, r.personId);
  const primaryKey = cellKey_(r.serviceDate, r.post.postId, r.slotIndex);

  // 追加階段 AR 修正 1：先把「這個人這一日不能服侍」登記進 context.unavailable，
  // 才開始找替補。原本這個同步動作要等整個 plan.results.forEach 跑完才做
  // （追加階段 AD 只補了「最終檢查」那一段，當時判斷「不影響套用過程中的替補搜尋」
  // ——這個判斷是錯的）。後果：替補搜尋期間 findStateViolations_() 完全不知道
  // 申報人今日不可服侍，而下面 syntheticViolation 原本又把 personId 填成空字串，
  // 令 findReplacementPerson_() 唯一那道「不可揀回原本那個人」的防線
  // （candidate === violation.personId）形同虛設——結果申報人自己成為自己的替補，
  // 清空之後原封不動放回去，整筆申報等於無效，而且事後最終檢查才發現一堆
  // HARD_UNAVAILABLE 違反。候選池是排序過的（見 findReplacementPerson_()），
  // PersonID 排前的人必定第一個被試中，所以這不是偶發，是必然。
  registerUnavailableForDay_(context, newUnavailableRows, r.personId, r.serviceDate);

  // 追加階段 AR 修正 2：只清「這個人現時真的還在」的格。
  // 原本無條件把 primaryKey 排在第一個清掉，沒有核對那一格現時是不是還是申報人。
  // 同一人同一日有多筆申報時，第 2 筆的 primaryKey 那一格很可能已經由第 1 筆
  // 處理完、換上了一位無辜的替補——無條件清掉等於把剛剛安排好的替補又趕走，
  // 再重新找一次（前一筆的結果被後一筆覆蓋）。
  const cellsToClear = [];
  if (workingByKey[primaryKey] && workingByKey[primaryKey].personId === r.personId) {
    cellsToClear.push(primaryKey);
  }
  Object.keys(workingByKey).forEach(function (key) {
    if (key === primaryKey) return;
    const a = workingByKey[key];
    if (a.serviceDate === r.serviceDate && a.personId === r.personId) cellsToClear.push(key);
  });

  // 沒有任何格要清：代表同一批次較早的申報已經把這個人當日的服侍全部處理完
  // （例如同一人同一日重複申報、或申報兩個崗位而第一筆已經一併清走同日全部崗位）。
  // 這仍然算成功套用——目的已經達成，只是這一筆沒有額外動作，據實說明即可，
  // 不當成失敗、也不再重跑一次替補搜尋。
  if (cellsToClear.length === 0) {
    outcomes.push({
      sheetRow: r.sheetRow, status: REQUEST_STATUS.APPLIED,
      resultNote: personName + ' 不能服侍 ' + r.serviceDate
        + '：該日的服侍已由同一批次較早的申報一併處理，這一筆沒有額外需要清空的格子'
    });
    return;
  }

  const clearedNotes = [];
  cellsToClear.forEach(function (key) {
    const cell = workingByKey[key];
    const postInfo = context.posts.filter(function (p) { return p.postId === cell.postId; })[0];
    const postLabel = (postInfo ? postInfo.postNameTC : cell.postId) + (key === primaryKey ? '' : '（同日兼任）');

    workingByKey[key].personId = '';
    workingByKey[key].personName = '';

    const stateArray = Object.keys(workingByKey).map(function (k) {
      const a = workingByKey[k];
      return {
        serviceDateId: a.serviceDateId, serviceDate: a.serviceDate, postId: a.postId,
        slotIndex: a.slotIndex, personId: a.personId, isManual: false
      };
    });
    // 追加階段 AR 修正 3：personId 填回申報人本人，讓 findReplacementPerson_() 的
    // 「不可揀回原本那個人」防線真正生效。這一道跟上面的 registerUnavailableForDay_()
    // 是互相獨立的兩重保險：即使日後有人改動 Unavailable 的同步時機，
    // 申報人依然不可能成為自己的替補。
    const syntheticViolation = {
      serviceDate: cell.serviceDate, serviceDateId: cell.serviceDateId,
      postId: cell.postId, slotIndex: cell.slotIndex, personId: r.personId
    };
    const replacement = findReplacementPerson_(syntheticViolation, stateArray, context);

    if (replacement.personId) {
      const rPerson = context.peopleById[replacement.personId];
      const rName = rPerson ? rPerson.nameTC : replacement.personId;
      workingByKey[key].personId = replacement.personId;
      workingByKey[key].personName = rName;
      workingByKey[key].assignSource = ASSIGN_SOURCE.MANUAL;
      workingByKey[key].ruleFlags = [];
      clearedNotes.push(postLabel + ' 已由 ' + rName + ' 替補');
    } else {
      workingByKey[key].assignSource = ASSIGN_SOURCE.SKIPPED;
      workingByKey[key].ruleFlags = [RULE_IDS.ELIGIBILITY];
      pendingBackfillCells.push({
        serviceDate: cell.serviceDate, postId: cell.postId, slotIndex: cell.slotIndex,
        reason: personName + ' 於 ' + r.serviceDate + ' 不能服侍，' + postLabel + '（' + replacement.reason + '）'
      });
      clearedNotes.push(postLabel + ' 找不到合資格替補，請人手處理');
    }
  });

  outcomes.push({
    sheetRow: r.sheetRow, status: REQUEST_STATUS.APPLIED,
    resultNote: personName + ' 不能服侍 ' + r.serviceDate + '（' + clearedNotes.join('；') + '）'
  });
}

/**
 * 追加階段 AR 新增：登記「某人某一日整日不能服侍」。
 *
 * 同時做兩件事，而且兩者都會去重（同一人同一日只會有一筆）：
 * 1. 加入 newUnavailableRows，稍後由 writeNewUnavailableRows_() 寫入 Unavailable 工作表
 * 2. **立即**加入 context.unavailable（記憶體中的快照），令緊接著的替補搜尋
 *    （findReplacementPerson_() → findStateViolations_()）馬上就知道這個人當日不可用
 *
 * 第 2 點是修正「申報人成為自己的替補」的關鍵；去重則修正「同一人同一日有多筆申報時，
 * Unavailable 工作表會被寫入多行完全相同的記錄」（實測兩筆申報寫了 2 行重複資料）。
 *
 * 追加階段 AC：語意是整日不能服侍，AppliesTo=ALL、不限定 PostIds，
 * 令下一季自動排表全日避開，不是只避開申報指定的那一個崗位。
 *
 * @param {Object} context buildFineTuneContext_() 的結果，context.unavailable 會就地更新
 * @param {Object[]} newUnavailableRows 累積要新增的 Unavailable 列，會就地 push
 * @param {string} personId 申報人的 PersonID
 * @param {string} serviceDate 不能服侍的日期
 * @returns {void}
 */
function registerUnavailableForDay_(context, newUnavailableRows, personId, serviceDate) {
  const isSameDayRow = function (row) {
    return row.personId === personId && row.dateFrom === serviceDate && row.dateTo === serviceDate;
  };

  if (!newUnavailableRows.some(isSameDayRow)) {
    newUnavailableRows.push({
      personId: personId, dateFrom: serviceDate, dateTo: serviceDate,
      appliesTo: UNAVAILABLE_VALUES.APPLIES_TO_ALL
    });
  }

  if (!context.unavailable.some(isSameDayRow)) {
    context.unavailable.push({
      personId: personId, dateFrom: serviceDate, dateTo: serviceDate,
      appliesTo: UNAVAILABLE_VALUES.APPLIES_TO_ALL, postIds: []
    });
  }
}

/**
 * 套用一筆「指定服侍」申報：把該人放入該格，原本在該格的人被頂走
 * （不自動調去其他週）。已在該格則視為無需改動。
 *
 * 追加階段 AE：處理結果的措辭原本寫「已被頂走」，跟同一份報告另外顯示的
 * 「待補格子：0 格」放在一起看容易誤會成矛盾——實際上被頂走的人本來就是
 * 那一格的人，頂走之後那格立即由新指定的人填上，沒有格子懸空，所以沒有黃格，
 * 這是正確行為，不是 bug。改為講清楚「已從該格移除」，並且視乎被頂走的人
 * 當週（即這個 serviceDate）是否還兼任其他崗位，區分兩種說法。
 *
 * @param {Object} r 已驗證的申報（category=APPLY 或已確認的 CONFIRM，requestType=指定服侍）
 * @param {Object} context buildFineTuneContext_() 的結果
 * @param {Object.<string, Object>} workingByKey 目前的工作狀態，會就地更新
 * @param {Object[]} outcomes 累積的處理結果，會就地 push
 * @returns {void}
 */
function applyDesignatedServe_(r, context, workingByKey, outcomes) {
  const targetSlot = resolveDesignatedSlot_(workingByKey, r.serviceDate, r.post, r.personId);
  const key = cellKey_(r.serviceDate, r.post.postId, targetSlot);
  const previousPersonId = workingByKey[key].personId;
  const personName = nameOfPersonId_(context, r.personId);

  if (previousPersonId === r.personId) {
    outcomes.push({
      sheetRow: r.sheetRow, status: REQUEST_STATUS.APPLIED,
      resultNote: personName + ' 已在 ' + r.serviceDate + ' ' + r.post.postNameTC + '，無需改動'
    });
    return;
  }

  workingByKey[key].personId = r.personId;
  workingByKey[key].personName = personName;
  workingByKey[key].assignSource = ASSIGN_SOURCE.MANUAL;
  workingByKey[key].ruleFlags = [];

  const note = '已指定 ' + personName + ' 服侍 ' + r.serviceDate + ' ' + r.post.postNameTC;
  const outcome = { sheetRow: r.sheetRow, status: REQUEST_STATUS.APPLIED, resultNote: note };
  if (previousPersonId) {
    const dislodgedName = nameOfPersonId_(context, previousPersonId);
    const stillServingPosts = [];
    Object.keys(workingByKey).forEach(function (k) {
      const a = workingByKey[k];
      if (a.serviceDate === r.serviceDate && a.personId === previousPersonId) {
        const postInfo = context.posts.filter(function (p) { return p.postId === a.postId; })[0];
        stillServingPosts.push(postInfo ? postInfo.postNameTC : a.postId);
      }
    });
    outcome.resultNote += '；原本的 ' + dislodgedName + ' 已從該格移除，'
      + (stillServingPosts.length > 0
        ? '該週仍擔任 ' + stillServingPosts.join('、')
        : '該週不再擔任其他崗位');
    outcome.dislodgedPersonId = previousPersonId;
    outcome.dislodgedPersonName = dislodgedName;
  }
  outcomes.push(outcome);
}

/**
 * 把找不到替補的格子標成待補：底色改成 Config 的 GRID_PENDING_FILL_COLOR，
 * 並在格子加 Note 寫明原因。用機器鍵（第 2 行）與日期（第 1 欄）定位，
 * 跟 PdfExport.gs 的 locatePersonCells_() 同一套定位手法。
 * @param {string} sheetName 新版本的工作表名稱
 * @param {Object[]} cells 要標記的格子，每項為 {serviceDate, postId, slotIndex, reason}
 * @returns {void}
 */
function markPendingBackfillCells_(sheetName, cells) {
  if (cells.length === 0) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const fillColor = getConfig(CONFIG_KEYS.GRID_PENDING_FILL_COLOR, DEFAULTS.GRID_PENDING_FILL_COLOR);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dateValues = sheet.getRange(3, 1, lastRow - 2, 1).getValues();

  const rowByDate = {};
  dateValues.forEach(function (row, i) {
    const d = toDateString(row[0], timezone);
    if (d) rowByDate[d] = i + 3;
  });
  const colByKey = {};
  keys.forEach(function (k, i) { if (String(k || '').indexOf('#') !== -1) colByKey[String(k)] = i + 1; });

  cells.forEach(function (c) {
    const r = rowByDate[c.serviceDate];
    const col = colByKey[c.postId + '#' + c.slotIndex];
    if (!r || !col) return;
    const range = sheet.getRange(r, col);
    range.setBackground(fillColor);
    const existingNote = range.getNote();
    range.setNote(existingNote ? existingNote + '\n' + c.reason : c.reason);
  });
}

/**
 * 掃描指定版本，找出所有「待補格」——語意一律以資料層判斷：PersonID 是空、
 * AssignSource 是 SKIPPED、RuleFlags 含 HARD_ELIGIBILITY，這是 Generator.gs
 * 留空格（buildRoster_() 呼叫 pickPerson_() 找不到不違反硬規則的人選時）與
 * applyCannotServe_() 找不到替補時共同寫入的訊號，兩處已經一致（見
 * makeAssignment_() 呼叫點）。
 *
 * 不可用底色判斷格子語意：GRID_COLORS.WARNING 與 DEFAULTS.GRID_PENDING_FILL_COLOR
 * 預設同為 #FFF2CC，applyCellMarks_()（RosterWriter.gs）在「有人但觸發規則警告」
 * 的格子（例如指定服侍申報套用後觸發 SEMI_NO_CONSECUTIVE）也塗上同一種底色，
 * 純靠底色比對會把這種格子誤判成待補格——這正是 2027T1 步驟 4 前置檢查
 * 誤報「仍有 2 格待補」的真正原因（該 2 格其實有人，只是有規則警告）。
 * 詳見 docs/系統範圍稽核.md「底色語意撞車」一節。
 *
 * 格子的 Note 文字仍然從 grid 讀出，但只用來組成回傳結果的顯示內容，
 * 不參與「是不是待補格」的判斷。
 *
 * 供「列出待補格子」選單與「步驟 4：正式發出」的前置檢查共用。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 每項為 {serviceDate, key, note}
 */
function listPendingBackfillCells_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) return [];

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const pendingKeys = {};
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId || Number(row[C.VERSION_NO]) !== versionNo) return;
    if (row[C.PERSON_ID] || row[C.ASSIGN_SOURCE] !== ASSIGN_SOURCE.SKIPPED) return;
    if (splitList_(row[C.RULE_FLAGS]).indexOf(RULE_IDS.ELIGIBILITY) === -1) return;
    const key = cellKey_(toDateString(row[C.SERVICE_DATE], timezone), row[C.POST_ID], row[C.SLOT_INDEX]);
    pendingKeys[key] = true;
  });
  if (Object.keys(pendingKeys).length === 0) return [];

  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dateValues = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
  const notes = sheet.getRange(3, 1, lastRow - 2, lastCol).getNotes();

  const results = [];
  for (let r = 0; r < dateValues.length; r++) {
    const dateStr = toDateString(dateValues[r][0], timezone);
    for (let c = 3; c < keys.length; c++) {
      const rawKey = String(keys[c] || '');
      const hashIdx = rawKey.indexOf('#');
      if (hashIdx === -1) continue;
      const postId = rawKey.slice(0, hashIdx);
      const slotIndex = rawKey.slice(hashIdx + 1);
      if (!pendingKeys[cellKey_(dateStr, postId, slotIndex)]) continue;
      results.push({ serviceDate: dateStr, key: rawKey, note: notes[r][c] || '' });
    }
  }
  return results;
}

/**
 * 把「指定服侍但 Eligibility 沒有此人」且已由幹事確認的申報，新增到 Eligibility
 * （歷史次數 0）。永遠是新增一行，不檢查是否已有類似紀錄——維持「新增」語意單純。
 * @param {Object[]} rows 要新增的資料，每項為 {personId, postId}
 * @returns {number} 實際新增的行數
 */
function writeNewEligibilityRows_(rows) {
  if (rows.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ELIGIBILITY);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.ELIGIBILITY);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.ELIGIBILITY;
  const now = nowTimestamp_();
  const actor = Session.getActiveUser().getEmail();
  const stamp = compactTimestamp_();

  const out = rows.map(function (r, i) {
    const record = {};
    record[C.ELIGIBILITY_ID] = 'REQ-' + stamp + '-' + (i + 1);
    record[C.PERSON_ID] = r.personId;
    record[C.POST_ID] = r.postId;
    record[C.ELIGIBLE] = BOOLEAN_TEXT.TRUE;
    record[C.HISTORICAL_COUNT] = 0;
    record[C.SOURCE] = 'REQUEST';
    record[C.ADDED_BY] = actor;
    record[C.ADDED_AT] = now;
    record[C.ACTIVE] = BOOLEAN_TEXT.TRUE;
    record[C.NOTES] = '由「套用修改申報」的指定服侍申報自動加入';
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, out.length, headers.length).setValues(out);
  applyTimestampFormat_(sheet, headers, [C.ADDED_AT], targetRow, out.length);
  return out.length;
}

/**
 * 把「不能服侍」申報登記到 Unavailable，供下季自動避開。
 *
 * 追加階段 AC：申報的語意是「當日整日不能服侍」（堂委的回覆通常是「某人去了外地」，
 * 不是「某人那日不想做讀經但可以做司事」），所以一律 AppliesTo=ALL、PostIds 留空，
 * 不再限定單一崗位。`readUnavailableNormalized()` 本來就把 AppliesTo 留空的情況
 * 預設成 APPLIES_TO_ALL，這裡明確填 'ALL' 是同一個意思，寫清楚而已。
 *
 * @param {Object[]} rows 要新增的資料，每項為 {personId, dateFrom, dateTo,
 *   appliesTo: (string|undefined), postIds: (string[]|undefined)}——appliesTo 預設 'ALL'，
 *   postIds 只在 appliesTo='POSTS' 時才有意義（目前呼叫端一律傳 'ALL'，
 *   保留 POSTS 選項是給未來可能的其他呼叫端用，不是這次的行為）
 * @returns {number} 實際新增的行數
 */
function writeNewUnavailableRows_(rows) {
  if (rows.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.UNAVAILABLE);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.UNAVAILABLE);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.UNAVAILABLE;
  const now = nowTimestamp_();
  const actor = Session.getActiveUser().getEmail();
  const stamp = compactTimestamp_();

  const out = rows.map(function (r, i) {
    const record = {};
    record[C.UNAVAILABLE_ID] = 'REQ-' + stamp + '-' + (i + 1);
    record[C.PERSON_ID] = r.personId;
    record[C.DATE_FROM] = r.dateFrom;
    record[C.DATE_TO] = r.dateTo;
    record[C.APPLIES_TO] = r.appliesTo || UNAVAILABLE_VALUES.APPLIES_TO_ALL;
    record[C.POST_IDS] = (r.postIds || []).join(',');
    record[C.REASON] = '由 Requests 申報自動加入（不能服侍）';
    record[C.SOURCE] = 'REQUEST';
    record[C.STATUS] = UNAVAILABLE_VALUES.STATUS_ACTIVE;
    record[C.CREATED_AT] = now;
    record[C.CREATED_BY] = actor;
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, out.length, headers.length).setValues(out);
  applyTimestampFormat_(sheet, headers, [C.CREATED_AT], targetRow, out.length);
  return out.length;
}

/**
 * 把處理結果寫回 Requests：RequestID／建立時間為空才補上（維持原值），
 * Status／處理結果／處理時間一律整段覆寫（真正的把關防線，見 RequestsSheet.gs 檔頭註解）。
 *
 * 追加階段 AT：**NEEDS_INPUT 的行不指派 RequestID，也不寫建立時間。**
 * `readPendingRequests_()` 是用「RequestID 是否空白」判斷一行有沒有被系統真正處理過，
 * 而 NEEDS_INPUT 的意思正正是「這一筆什麼都沒有做」——沒有清空任何格、沒有派任何人、
 * 沒有寫任何 Eligibility／Unavailable。給它一個 RequestID 會令它從此不再是待處理，
 * 幹事修正了日期或姓名之後也永遠不會被重新驗證，等於默默丟棄了一筆有效申報。
 * 保持 RequestID 空白，它下次執行會照樣被讀出來重新驗證；而 Status 與處理結果照寫，
 * 幹事在工作表上就看得到系統為什麼攔住它。
 *
 * 這樣做不會削弱 RequestID 那道防篡改防線：防線要防的是「已經真正套用過的申報被重複
 * 套用」，對象是 APPLIED 與 REJECTED——這兩種仍然照舊指派 RequestID。
 *
 * @param {Object[]} outcomes 每項至少含 {sheetRow, status, resultNote}
 * @param {string} quarterId 季度 ID，用於組 RequestID
 * @returns {void}
 */
function writeRequestOutcomes_(outcomes, quarterId) {
  if (outcomes.length === 0) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.REQUESTS);

  const keys = getRequestsHeaderKeys_();
  const idCol = keys.indexOf(COLUMNS.REQUESTS.REQUEST_ID) + 1;
  const statusCol = keys.indexOf(COLUMNS.REQUESTS.STATUS) + 1;
  const resultCol = keys.indexOf(COLUMNS.REQUESTS.RESULT_NOTE) + 1;
  const createdCol = keys.indexOf(COLUMNS.REQUESTS.CREATED_AT) + 1;
  const processedCol = keys.indexOf(COLUMNS.REQUESTS.PROCESSED_AT) + 1;
  const now = nowTimestamp_();

  outcomes.forEach(function (o) {
    // 見上方說明：NEEDS_INPUT 要維持「未曾處理」的身分，才能在修正後重新驗證。
    const keepPending = o.status === REQUEST_STATUS.NEEDS_INPUT;

    if (idCol > 0 && !keepPending) {
      const existingId = String(sheet.getRange(o.sheetRow, idCol).getValue() || '').trim();
      if (!existingId) {
        sheet.getRange(o.sheetRow, idCol).setValue('REQ-' + quarterId + '-' + compactTimestamp_() + '-' + o.sheetRow);
      }
    }
    if (createdCol > 0 && !keepPending && !sheet.getRange(o.sheetRow, createdCol).getValue()) {
      sheet.getRange(o.sheetRow, createdCol).setValue(now);
      applyTimestampFormat_(sheet, keys, [COLUMNS.REQUESTS.CREATED_AT], o.sheetRow, 1);
    }
    if (statusCol > 0) sheet.getRange(o.sheetRow, statusCol).setValue(o.status);
    if (resultCol > 0) sheet.getRange(o.sheetRow, resultCol).setValue(o.resultNote);
    if (processedCol > 0) {
      sheet.getRange(o.sheetRow, processedCol).setValue(now);
      applyTimestampFormat_(sheet, keys, [COLUMNS.REQUESTS.PROCESSED_AT], o.sheetRow, 1);
    }
  });
}

/**
 * 追加階段 AT 新增：只把驗證階段判定為 NEEDS_INPUT 的申報寫回工作表。
 *
 * 用於「幹事在驗證結果視窗撳了取消」這條路徑——原本整個流程直接結束，什麼都不寫，
 * 那兩三行的 Status 仍然是空白、處理結果欄也空白，攔截原因只在對話框出現過一次，
 * 幹事事後打開工作表完全看不出系統為什麼不肯處理它們。
 *
 * 只寫 NEEDS_INPUT，不碰 APPLY／CONFIRM 類別的行——那些既然取消了就是真的沒有處理過，
 * 不應該留下任何處理痕跡。而 NEEDS_INPUT 本來無論如何都不會被套用，先寫下原因不會
 * 改變任何結果，只是把已經判斷出來的資訊留給幹事看。
 *
 * @param {Object} plan planApplyRequests_() 的結果
 * @returns {number} 實際寫回的行數
 */
function recordNeedsInputOutcomes_(plan) {
  const outcomes = plan.results
    .filter(function (r) { return r.category === 'NEEDS_INPUT'; })
    .map(function (r) {
      return { sheetRow: r.sheetRow, status: REQUEST_STATUS.NEEDS_INPUT, resultNote: r.reason };
    });
  if (outcomes.length === 0) return 0;
  writeRequestOutcomes_(outcomes, plan.quarterId);
  return outcomes.length;
}

/**
 * 第十九輪批次階段 F3：講清楚一個日期點解對唔上。
 *
 * 兩種原因要分開講：
 *   • 格式唔啱（例如打咗 `2026/11/15` 而唔係 `2026-11-15`）
 *     ⇒ 講明正確格式，唔好淨係話「無法辨識」
 *   • 格式啱但唔屬於呢個季度（例如揀錯季度）
 *     ⇒ 講明係季度唔對，唔好令人以為自己打錯字
 *
 * 純函式，測得到。
 *
 * @param {string} dateText 幹事填嘅日期文字
 * @param {string} quarterId 目前處理緊嘅季度
 * @returns {string} 具體原因
 */
function describeUnknownRequestDate_(dateText, quarterId) {
  const text = String(dateText === null || dateText === undefined ? '' : dateText).trim();

  if (text === '') {
    return '日期是空白的，請填寫（格式 yyyy-MM-dd，例如 2026-11-15）';
  }

  // ⚠️ 「係咪格式問題」直接由文字判斷，**唔靠呼叫端傳參數**。
  //
  // 呢個判斷同 `parseOfficerDateInput_()` 接受嘅格式係同一條準則
  // （嚴格 yyyy-MM-dd）。如果改成由呼叫端傳一個 flag 入嚟，
  // 就會有兩個地方各自講「乜嘢先算格式啱」——遲早分岔，
  // 而分岔嘅結果就係「訊息同行為唔一致」，正正就係本階段要修嘅嘢。
  const parseFailed = !/^\d{4}-\d{2}-\d{2}$/.test(text);

  // 第二十一輪批次階段 C2：訊息必須同**實際接受嘅格式**完全一致。
  //
  // 修正之前呢句寫「斜線、句點、日月倒轉、全形數字都認不出來」，
  // 但當時 toDateString() 其實收斜線同日月倒轉——幹事照住訊息改，
  // 反而改到一個系統會靜靜猜錯嘅寫法。而家兩邊一致：
  // 只收「儲存格本身是日期值」同「文字 yyyy-MM-dd」。
  if (parseFailed) {
    return '日期「' + text + '」的格式認不出來。只接受兩種寫法：\n'
      + '　1. 用格內的下拉選單揀（最穩陣，揀完儲存格本身就是日期值）；\n'
      + '　2. 手打成 yyyy-MM-dd，例如 2026-11-15（月、日都要兩位數）。\n'
      + '斜線（2026/11/15）、日月倒轉（15/11/2026）、句點、中文年月日、'
      + '全形數字一律不接受——\n'
      + '不是認不到，是「05/06」這種寫法沒有辦法確定是 5 月 6 日還是 6 月 5 日，'
      + '猜錯就會把人排錯主日。';
  }

  return '日期「' + text + '」格式正確，但不屬於 ' + quarterId
    + ' 的任何一個主日——請確認這一筆申報的 QuarterID 填對了沒有，'
    + '或者這一天本來就不是這一季的服侍日。';
}

/**
 * 第十九輪批次階段 G：套用摘要嘅結論句。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有
 * ─────────────────────────────────────────────────────────────────────
 *
 * 實測見到嘅摘要：
 *
 *     已套用：3 筆　已拒絕：0 筆　無法套用：0 筆
 *
 * 三個數字都啱，但讀落去似乎三筆都無事——其中一筆造成咗硬規則違反，
 * 要再往下捲先見到。之後雖然有打字閘攔住、唔會漏，但**呢兩行數字
 * 本身講緊一個誤導嘅故事**，而摘要就係畀人一眼睇完就走嘅。
 *
 * 同階段 C4 係同一個道理：數字唔會自己講故事。
 *
 * @param {Object} result `applyRequests_()` 嘅結果
 * @returns {string} 結論句；完全冇嘢好講嗰陣回傳空字串
 */
function buildApplySummarySentence_(result) {
  const applied = Number(result.appliedCount || 0);
  const violations = result.violations || [];
  const hard = violations.filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  const semi = violations.filter(function (v) { return v.severity === RULE_LEVELS.SEMI_HARD; });

  if (hard.length === 0 && semi.length === 0) {
    return applied > 0
      ? '✅ 結論：' + applied + ' 筆申報都已套用，套用之後沒有造成任何硬規則或準硬規則違反。'
      : '';
  }

  const parts = [];
  if (hard.length > 0) parts.push('硬規則違反 ' + hard.length + ' 項');
  if (semi.length > 0) parts.push('準硬規則違反 ' + semi.length + ' 項');

  return '⚠️ 結論：套用之後這一版有 ' + parts.join('、') + '（詳情見下面）。\n'
    + '　　「已套用 ' + applied + ' 筆」不代表沒有問題——'
    + '申報本身套用成功，但套用的結果違反了規則。';
}
