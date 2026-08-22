/**
 * 第四十九輪批次 第 1 層：**真環境自測機。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 呢一支要解決嘅問題
 * ═════════════════════════════════════════════════════════════════════
 *
 * 由第四十輪到第四十七輪，**每一輪 Ivan 親手實測都揪到真 bug**，
 * 而每一輪之前所有測試都係全綠嘅。
 *
 * 第四十七輪嗰個最典型：第四十輪寫好嘅一整個對話框，
 * **由寫出嚟到嗰日一次都冇執行過**，而測試一直綠——
 * 因為測試直接呼叫嗰個分支，從來冇問過「真實嘅 `kind` 到得到嗰度嗎」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ 核心原則：**每一個狀態都必須由真實入口造出嚟**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 要一個「已經寄過審閱、有 2 格未儲存改動」嘅狀態，唯一合法嘅做法係：
 * 真嘅叫 `apiGenerateDraftExecute()` → 真嘅寫 grid → 真嘅 `apiStep2Confirm()`
 * → 真嘅再改 grid。
 *
 * **唔可以**直接寫 `Quarters.Stage = 'REVIEW_SENT'` 然後喺 grid 塞兩格。
 *
 * 違反咗呢一條，呢一層就退化成第 171 條假綠燈。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要行 `apiXxx` 而唔係佢哋入面嗰啲函式
 * ─────────────────────────────────────────────────────────────────────
 *
 * `apiStep2Confirm()` 第一句係 `assertWebAppRequestAllowed_()`，
 * 第二句先至係 `assertNoUnsavedChanges_()`。跳過入口去叫
 * `executeStep2_()` 嘅話，就跳過咗成串前置檢查——
 * 而第四十七輪個 bug 正正就係喺「入口嗰串前置檢查嘅次序」入面。
 *
 * ⚠️ 代價：`assertWebAppRequestAllowed_()` 要求 `WEBAPP_ENABLED === TRUE`。
 * 所以自測機開跑之前會檢查，唔係就停低並講明——
 * **唔會**靜靜退回去叫入面嗰啲函式。退回去就等於冇行過真實入口。
 */

/** 沙盒季度嘅程式內建預設值。 */
const SELFTEST_QUARTER_DEFAULT = '2028T3';

/** 自測機用嘅三張工作表。 */
const SELFTEST_SHEETS = {
  STATE: 'SelfTestState',
  REPORT: 'SelfTestReport',
  PAYLOADS: 'SelfTestPayloads'
};

/**
 * 一次執行最多用幾多毫秒。
 *
 * Apps Script 單次執行上限係 6 分鐘。留 1.5 分鐘收尾——
 * 寫報告、寫狀態、彈對話框都要時間，而**跑到一半被系統斬斷**
 * 就會冇咗狀態，下一次唔知由邊度接。
 */
const SELFTEST_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/** 一個情境嘅結果狀態。 */
const SELFTEST_STATUS = {
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  ERROR: 'ERROR',
  NOT_RUN: 'NOT_RUN',
  // ⚠️ 第五十一輪批次 D 組：**「佢依賴嗰個情境紅咗，所以佢冇跑過」。**
  //
  // 第五十輪嗰次 9 條紅，真正嘅根因只有 2 個，其餘 7 條係連環反應。
  // Ivan 要逐條睇完先知道邊幾條係雜訊。
  //
  // ⚠️ `BLOCKED` **唔等於通過**。報告摘要要清清楚楚寫住個數目，
  // 唔可以只數綠同紅令人以為情況好好。
  BLOCKED: 'BLOCKED',
  // ⚠️ 第五十輪批次 D 組：**「呢個情境喺呢個狀態下冇意義」。**
  //
  // 唔係紅。S01 驗嘅係「季度啱啱清乾淨嗰陣 dashboard 講咩」，
  // 而喺一個已經有 v0 嘅季度上面跑佢，三條斷言一定紅——
  // 而嗰三條紅**全部係自測機自己嘅問題，唔係系統嘅問題**。
  SKIPPED: 'SKIPPED'
};

/* ═════════════════════════════════════════════════════════════════════
 * 開跑之前嘅閘
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 讀沙盒季度 ID。
 * @returns {{value: string, source: string}}
 */
function readSelfTestQuarterDetail_() {
  const result = getConfigWithSourceSafe_(CONFIG_KEYS.SELFTEST_QUARTER_ID,
    SELFTEST_QUARTER_DEFAULT);
  let value = String(result.value || '').trim().toUpperCase();
  // ⚠️ 空白唔可以變成「隨便揀一季」。退回內建預設。
  if (value === '') value = SELFTEST_QUARTER_DEFAULT;
  return { value: value, source: result.source };
}

/**
 * 開跑之前逐條閘。**任何一條唔過就唔准跑。**
 *
 * ⚠️ 呢幾條閘唔係形式主義。自測機會**真嘅生成版本、真嘅走寄送流程、
 * 真嘅清季度資料**——行錯咗一季就係真係整爛咗嘢。
 *
 * @param {string} quarterId 沙盒季度
 * @returns {{ok: boolean, reasons: string[]}}
 */
function checkSelfTestPreconditions_(quarterId) {
  const reasons = [];

  // ── 閘 1　DRY_RUN ────────────────────────────────────────────
  // ⚠️ 一定要 `=== true`。讀唔到（`undefined`）**唔算通過**——
  // 「查不到」同「查到係 TRUE」係兩件事，而估錯嗰邊嘅代價係真係寄信。
  if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== true) {
    reasons.push('DRY_RUN 不是 TRUE。自測機會走完整個寄送流程，'
      + 'DRY_RUN=FALSE 時那些信會真的寄出去。'
      + '自測機不會在真實寄信模式下執行。');
  }

  // ── 閘 2　沙盒季度唔可以係受保護嗰幾季 ───────────────────────
  const upper = String(quarterId || '').trim().toUpperCase();
  if (upper === '') {
    reasons.push('沒有沙盒季度。請在 Config 的 '
      + CONFIG_KEYS.SELFTEST_QUARTER_ID + ' 填一個專用季度。');
  }
  const inList = function (list) {
    return (list || []).some(function (q) {
      return String(q || '').trim().toUpperCase() === upper;
    });
  };
  if (inList(readQuarterResetBlockedQuarters_())) {
    reasons.push('「' + quarterId + '」在 '
      + CONFIG_KEYS.QUARTER_RESET_BLOCKED_QUARTERS + ' 裡面。'
      + '自測機每次開跑都會把沙盒季度清乾淨，所以絕對不可以是受保護的季度。');
  }
  if (inList(readRehearsalProtectedQuarters_())) {
    reasons.push('「' + quarterId + '」在 '
      + CONFIG_KEYS.REHEARSAL_PROTECTED_QUARTERS + ' 裡面（演練保護清單）。'
      + '同樣不可以在上面跑自測。');
  }

  // ── 閘 3　Stage 唔可以已經正式發出 ───────────────────────────
  let stage = '';
  try {
    stage = getQuarterStage_(quarterId);
  } catch (err) {
    stage = '';
  }
  if (stage === QUARTER_STAGE.OFFICIAL_SENT) {
    reasons.push('「' + quarterId + '」的 Stage 已經是 '
      + QUARTER_STAGE.OFFICIAL_SENT + '。'
      + '那代表這一季已經正式發出給全體，不是一個沙盒季度。');
  }

  // ── 閘 4　真實入口要求 Web UI 開著 ───────────────────────────
  //
  // ⚠️ 見檔頭：自測機**只行真實入口**（`apiXxx`），而每一個入口第一句
  // 就係 `assertWebAppRequestAllowed_()`。跳過入口去叫入面嗰啲函式，
  // 就跳過咗成串前置檢查——而第四十七輪個 bug 正正就係喺嗰串檢查
  // 嘅次序入面。所以呢度停低，唔會退回去。
  if (getConfig(CONFIG_KEYS.WEBAPP_ENABLED, false) !== true) {
    reasons.push('Config 的 ' + CONFIG_KEYS.WEBAPP_ENABLED + ' 不是 TRUE。'
      + '自測機刻意只走真實入口（apiXxx），而那些入口第一句就是權限檢查，'
      + '所以要跑自測，這一格必須是 TRUE。'
      + '（不會自動改它——改 Config 是你的決定，不是測試工具的。）');
  }

  return { ok: reasons.length === 0, reasons: reasons };
}

/* ═════════════════════════════════════════════════════════════════════
 * 情境要用嘅小工具
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 一個情境入面用嘅斷言收集器。
 *
 * ⚠️ 一條斷言紅咗**唔會**即刻停低成個情境——後面嗰幾條照跑。
 * 一條紅就停嘅話，一次執行只會見到一個問題，
 * 而 Ivan 要重跑十次先見得晒。
 *
 * @param {string} scenarioId 例如 `S06`
 * @returns {Object} 有 `expect`／`equal`／`result()` 嘅收集器
 */
function selfTestCollector_(scenarioId) {
  const checks = [];
  const api = {
    /**
     * @param {string} label 講佢驗緊乜
     * @param {boolean} condition 條件
     * @param {string} expected 預期
     * @param {string} actual 實際
     * @param {string} evidence 證據
     * @returns {void}
     */
    expect: function (label, condition, expected, actual, evidence) {
      checks.push({
        label: label, ok: !!condition,
        expected: String(expected === undefined ? '' : expected),
        actual: String(actual === undefined ? '' : actual),
        evidence: String(evidence || '')
      });
    },
    equal: function (label, actual, expected, evidence) {
      api.expect(label, String(actual) === String(expected), expected, actual, evidence);
    },
    result: function () {
      const failed = checks.filter(function (c) { return !c.ok; });
      return {
        id: scenarioId,
        status: failed.length === 0 ? SELFTEST_STATUS.PASSED : SELFTEST_STATUS.FAILED,
        checks: checks,
        failedChecks: failed
      };
    },
    /**
     * 第五十三輪批次 A2 組：**造唔出呢個情境 ⇒ 跳過，唔係紅。**
     *
     * ⚠️ 一條「造唔出情境」嘅紅同一條「系統做錯咗」嘅紅擺埋一齊，
     * 就分唔出邊條要修碼。而更嚴重嘅係：紅會經 `dependsOn`
     * 把下游標成 `BLOCKED`——第五十二輪嗰次就係一條紅擋住九條。
     *
     * @param {string} note 要喺報告講嘅一句
     * @returns {Object} 一個 `SKIPPED` 嘅結果
     */
    skip: function (note) {
      return {
        id: scenarioId, status: SELFTEST_STATUS.SKIPPED,
        checks: checks, failedChecks: [], note: note
      };
    }
  };
  return api;
}

/**
 * 喺 grid 工作表真嘅寫一格。
 *
 * ⚠️ **真嘅寫張工作表**，唔係喺記憶體造一個 overlay。
 * 造一個假 overlay 就係「fixture 造到一個真實 code path 造唔出嘅狀態」
 * ——即係呢一層要擋嗰件事本身。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} serviceDate `yyyy-MM-dd`
 * @param {string} postId 崗位 ID
 * @param {number|string} slotIndex 位次
 * @param {string} text 要寫入嘅文字
 * @returns {boolean} 有冇寫到
 */
function selfTestWriteGridCell_(quarterId, versionNo, serviceDate, postId, slotIndex, text) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表：' + sheetName);

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  // 第 2 行係機器鍵（`POSTID#slot`），第 3 行起係資料，第 1 欄係日期。
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0]
    .map(function (v) { return String(v || ''); });
  const wantKey = postId + '#' + String(slotIndex);
  const col = keys.indexOf(wantKey) + 1;
  if (col <= 0) return false;

  const dates = sheet.getRange(3, 1, Math.max(0, lastRow - 2), 1).getValues();
  for (let i = 0; i < dates.length; i++) {
    if (toDateString(dates[i][0], timezone) !== serviceDate) continue;
    sheet.getRange(i + 3, col).setValue(text);
    return true;
  }
  return false;
}

/**
 * 由 `RosterAssignments` 揀頭幾格（有人嘅）出嚟改。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {number} howMany 要幾多格
 * @returns {Object[]} `{serviceDate, postId, slotIndex, personId}`
 */
function selfTestPickCells_(quarterId, versionNo, howMany) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const out = [];
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (out.length >= howMany) return;
    if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
    if (Number(row[A.VERSION_NO]) !== versionNo) return;
    const personId = String(row[A.PERSON_ID] || '').trim();
    if (!personId) return;
    out.push({
      serviceDate: toDateString(row[A.SERVICE_DATE], timezone),
      postId: String(row[A.POST_ID] || '').trim(),
      slotIndex: row[A.SLOT_INDEX],
      personId: personId
    });
  });
  return out;
}

/**
 * 揀格嗰陣最多叫幾多次 `apiSaveAndConfirmPlan()` 去搵。
 *
 * ⚠️ S03／S10 之後仲會**自己叫多一次**做最終斷言，所以總數係 5——
 * 同 Ivan 定嘅上限一樣。`apiSaveAndConfirmPlan()` 好貴
 *（`SelfTest_Payloads` 錄到嗰份回傳有成千幾字），多過噉就會食光
 * 4.5 分鐘預算，退回「時間到、原地打轉」嗰個老問題。
 */
const SELFTEST_PLAN_SEARCH_ROUNDS = 4;

/**
 * 排喺最後嗰幾個崗位。
 *
 * ⚠️ **呢個唔係規則判斷，係排序。** 呢兩個崗位實際可用嘅名單
 * 只有 `Roles` 上嗰幾位堂委，隨手揀一個人一次命中率極低，
 * 白白燒 plan 次數。就算揀咗，接受與否仍然由 plan 話事。
 *
 * ⚠️ 崗位 ID 係**資料**（`Posts` 工作表），唔係程式常數。
 * 呢張表寫錯咗或者日後改名，最壞嘅後果只係命中率低一啲，
 * **唔會令一個唔應該收嘅格被收**。
 */
const SELFTEST_SLOW_POSTS = ['ANNOUNCE', 'DUTY_CC'];

/**
 * S17 揀「一定會犯規」嗰格嗰陣，最多重算幾多次規則。
 *
 * ⚠️ 呢個係**記憶體入面**嘅規則重算（`findStateViolations_()`），
 * 唔係 `apiSaveAndConfirmPlan()`，所以上限可以大好多。
 * 見 `selfTestPickViolatingCell_()`。
 */
const SELFTEST_VIOLATING_PICK_MAX_TRIES = 60;

/**
 * 一格嘅身分證：`serviceDate|postId|slotIndex`。
 *
 * ⚠️ `slotIndex` 有時係數字有時係字串（工作表讀返嚟同 API 回嚟唔一定同型），
 * 所以一律 `String()`。唔統一嘅話兩邊永遠對唔上，
 * 而「一格都冇犯規」就會變成一個永遠成立嘅假答案。
 *
 * @param {Object} x 有 `serviceDate`／`postId`／`slotIndex` 嘅物件
 * @returns {string}
 */
function selfTestCellKey_(x) {
  return String(x.serviceDate) + '|' + String(x.postId) + '|' + String(x.slotIndex);
}

/**
 * 由 `RosterAssignments` 砌一張候選格清單。**只做粗篩，唔做規則判斷。**
 *
 * ═══════════════════════════════════════════════════════════════════
 * 第五十四輪批次 A 組：**接受條件要問被測嘅系統攞，唔好自己再寫一份。**
 * ═══════════════════════════════════════════════════════════════════
 *
 * S03 三輪紅咗三次，每次原因唔同：
 *
 *   第五十一輪　修「名字要系統認得出」　　　⇒ 下一次撞喺 Eligibility
 *   第五十三輪　修「要喺 Eligibility 合資格」⇒ 下一次撞喺 Roles 身分限制
 *   （如果再猜）修「要有堂委身分」　　　　　⇒ 下一條規則
 *
 * **每一次嘅診斷都啱，但策略錯**：測試喺度自己重新實作系統嘅接受條件，
 * 一條一條規則逐次發現。系統有幾多道閘，就會有幾多輪失敗。
 *
 * 呢一輪換策略：**唔再實作任何規則。寫入之後問系統。**
 *
 * 所以呢一支只負責兩件事：
 *   一、替代人選喺 `NameMapping` 認得出
 *   二、同該格現任嗰個唔同
 *
 * 其餘全部——崗位資格、身分要求、請假、互斥組、同日撞崗——
 * **一律唔判斷**，交畀 `apiSaveAndConfirmPlan()` 答。
 *
 * ⚠️ 下面兩項係**排序**，唔係接受條件：
 *   ・優先揀 `Eligibility` 該崗位名單內嘅人（提高一次命中率）
 *   ・`ANNOUNCE`／`DUTY_CC` 排最後（見 `SELFTEST_SLOW_POSTS`）
 * 就算揀咗，接受與否仍然由 plan 話事。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} `{serviceDate, postId, slotIndex, personId, originalName,
 *   replacement: {personId, name}, preferred: boolean}`
 */
function selfTestBuildCandidatePool_(quarterId, versionNo) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const peopleById = indexPeopleById_();
  const byPost = (readEligibility() || {}).byPost || {};
  const allIds = Object.keys(peopleById).filter(function (id) {
    return peopleById[id] && peopleById[id].nameTC;
  });

  const pool = [];
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
    if (Number(row[A.VERSION_NO]) !== versionNo) return;
    const personId = String(row[A.PERSON_ID] || '').trim();
    if (!personId) return;
    const postId = String(row[A.POST_ID] || '').trim();

    // 一、二：認得出、同現任唔同。**淨係呢兩條。**
    const eligibleHere = (byPost[postId] || []).filter(function (id) {
      return id !== personId && peopleById[id] && peopleById[id].nameTC;
    });
    const fallback = allIds.filter(function (id) { return id !== personId; });
    const chosen = eligibleHere.length > 0 ? eligibleHere[0] : fallback[0];
    if (!chosen) return;

    pool.push({
      serviceDate: toDateString(row[A.SERVICE_DATE], timezone),
      postId: postId,
      slotIndex: row[A.SLOT_INDEX],
      personId: personId,
      originalName: (peopleById[personId] || {}).nameTC || '',
      replacement: { personId: chosen, name: peopleById[chosen].nameTC },
      preferred: eligibleHere.length > 0
        && SELFTEST_SLOW_POSTS.indexOf(postId) === -1
    });
  });

  // ⚠️ 排序（唔係篩選）：容易命中嗰啲行先。
  return pool.sort(function (a, b) {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return 0;
  });
}

/**
 * 第五十四輪批次 A 組：**寫三格、問一次、換走犯規嗰幾格。**
 *
 * ═══════════════════════════════════════════════════════════════════
 * 點解要批量
 * ═══════════════════════════════════════════════════════════════════
 *
 * `apiSaveAndConfirmPlan()` **好貴**——佢要砌成個 fine-tune context。
 * 逐格逐個候選試、每試一次叫一次 plan 嘅話，一個情境就會食光
 * 4.5 分鐘預算，退回「時間到、原地打轉」嗰個老問題。
 *
 * 所以：三格一次過寫，一次過問，只換走犯規嗰幾格。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ⚠️ 接受條件**只有一條**
 * ═══════════════════════════════════════════════════════════════════
 *
 *     `needsRelease === false` 而且 `violations.real` 係空陣列
 *
 * 唔好自己再解讀任何規則、唔好睇 `semiHard`／`structural`
 *（嗰兩樣唔攔儲存）。呢一句就係攔住 S05 嗰道閘自己用嘅判斷。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {number} howMany 想要幾多格
 * @param {string} scenarioId 情境 ID（錄回傳值用）
 * @returns {Object} `{cells, attempts, planCalls, plan, planError, preExisting}`
 */
function selfTestPickAcceptedCells_(quarterId, versionNo, howMany, scenarioId) {
  const pool = selfTestBuildCandidatePool_(quarterId, versionNo);
  const attempts = [];
  const usedDates = {};
  let written = [];
  let planCalls = 0;
  let lastPlan = null;
  let planError = '';
  let preExisting = [];
  let nextIdx = 0;

  const revert = function (cell, originalByKey) {
    // ⚠️ 用 plan 回傳嘅 `originalName`，唔自己再讀一次版本——
    // 同一件事用同一個來源。
    let text = originalByKey[selfTestCellKey_(cell)];
    if (text === undefined) text = cell.originalName;
    selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate, cell.postId,
      cell.slotIndex, text === '（空白）' ? '' : text);
  };

  const fill = function () {
    while (written.length < howMany && nextIdx < pool.length) {
      const c = pool[nextIdx];
      nextIdx++;
      // 幾格要分散喺唔同主日——同一日改幾格會順手撞到同週規則。
      if (usedDates[c.serviceDate]) continue;
      if (!selfTestWriteGridCell_(quarterId, versionNo, c.serviceDate, c.postId,
        c.slotIndex, c.replacement.name)) continue;
      usedDates[c.serviceDate] = true;
      written.push(c);
    }
  };

  fill();
  if (written.length === 0) {
    return { cells: [], attempts: attempts, planCalls: 0, plan: null,
      planError: '', preExisting: [], confirmed: false,
      noCandidate: '一格候選都砌不出來（RosterAssignments 沒有一格有人，'
        + '或者 NameMapping 沒有第二個認得出的人）。' };
  }

  for (let round = 1; round <= SELFTEST_PLAN_SEARCH_ROUNDS; round++) {
    let plan;
    try {
      plan = selfTestCall_(scenarioId, 'apiSaveAndConfirmPlan（第 ' + round + ' 次）',
        function () { return apiSaveAndConfirmPlan(quarterId); });
    } catch (err) {
      // ⚠️ plan 拋錯 ⇒ **要報，唔可以靜靜過**。
      planError = 'apiSaveAndConfirmPlan() 拋錯：' + err.message;
      break;
    }
    planCalls++;
    lastPlan = plan;

    if (plan.blocked) {
      planError = '計劃被擋住（' + (plan.blockReason || '沒有寫原因') + '）：'
        + String(plan.message || '').slice(0, 300);
      break;
    }

    const real = (plan.violations || {}).real || [];
    const offending = {};
    real.forEach(function (v) { offending[selfTestCellKey_(v)] = v; });
    const bad = written.filter(function (c) { return offending[selfTestCellKey_(c)]; });
    const good = written.filter(function (c) { return !offending[selfTestCellKey_(c)]; });
    // ⚠️ 有違反落喺**我哋冇掂過嘅格**上面 ⇒ 呢一版本身就帶住佢。
    // 點換格都改變唔到，換落去只係燒清四次好貴嘅 plan，
    // 而最後 S03 一樣紅、S04–S13 一樣被擋住。
    const mine = {};
    written.forEach(function (c) { mine[selfTestCellKey_(c)] = true; });
    const foreign = real.filter(function (v) { return !mine[selfTestCellKey_(v)]; });

    attempts.push({
      round: round,
      written: written.map(function (c) {
        return c.serviceDate + ' ' + c.postId + '#' + c.slotIndex
          + ' ← ' + c.replacement.name;
      }),
      offending: bad.map(function (c) {
        const v = offending[selfTestCellKey_(c)];
        return c.serviceDate + ' ' + c.postId + '#' + c.slotIndex
          + ' ← ' + c.replacement.name + '（' + v.ruleId + '）';
      }),
      needsRelease: plan.needsRelease === true
    });

    if (bad.length === 0 && plan.needsRelease === false) {
      // ⚠️ `confirmed` ＝「呢一份 plan 講嘅就係最終格局」。
      // 呼叫嗰邊唔使再叫多一次，慳返一次好貴嘅呼叫。
      return { cells: written, attempts: attempts, planCalls: planCalls,
        plan: plan, planError: '', preExisting: [], confirmed: true };
    }

    const originalByKey = {};
    (plan.gridChanges || []).forEach(function (g) {
      originalByKey[selfTestCellKey_(g)] = g.originalName;
    });

    if (foreign.length > 0) {
      // ⚠️ 唔關呢一次改動事。全部改返原本嘅字，然後由呼叫嗰邊
      // 報成「跳過」——報紅嘅話，S04–S13 會被 `dependsOn` 一齊擋住，
      // 而嗰九條先係呢部機器存在嘅理由。
      preExisting = foreign.map(function (v) {
        return v.serviceDate + ' ' + v.postId + '#' + v.slotIndex + '　' + v.ruleId;
      });
      written.forEach(function (c) { revert(c, originalByKey); });
      return { cells: [], attempts: attempts, planCalls: planCalls, plan: plan,
        planError: '', preExisting: preExisting, confirmed: false };
    }

    // ⚠️ 只把犯規嗰幾格改返原本嘅字，乾淨嗰幾格留低。
    bad.forEach(function (c) { revert(c, originalByKey); });
    written = good;

    // ⚠️ 最後一 round 唔再補新格——補咗就冇 plan 確認過佢，
    // 而一格冇確認過嘅格會令 S05 拋錯。
    if (round >= SELFTEST_PLAN_SEARCH_ROUNDS) break;
    const before = written.length;
    fill();
    // 冇新候選可以補 ⇒ 再叫一次 plan 都係同一個答案，唔好燒。
    if (written.length === before) break;
  }

  return { cells: written, attempts: attempts, planCalls: planCalls,
    plan: lastPlan, planError: planError, preExisting: preExisting,
    confirmed: false };
}

/**
 * 把「試咗幾多次、邊幾格犯規」寫成報告嗰幾行。
 *
 * ⚠️ 唔寫嘅話，S03 淨係報「找到 2 格」，而冇人知佢試過乜。
 *
 * @param {Object} picked `selfTestPickAcceptedCells_()` 嘅結果
 * @returns {string}
 */
function describeAcceptedPickAttempts_(picked) {
  const lines = ['plan 叫了 ' + picked.planCalls + ' 次'];
  (picked.attempts || []).forEach(function (a) {
    lines.push('第 ' + a.round + ' 次：' + a.written.length + ' 格寫入 ⇒ '
      + (a.offending.length === 0 ? '0 格犯規 ✓' : a.offending.length + ' 格犯規'));
    a.offending.forEach(function (o) { lines.push('　 ✗ ' + o + ' 已改回原本的字'); });
  });
  if (picked.planError) lines.push('⚠️ ' + picked.planError);
  if ((picked.preExisting || []).length > 0) {
    lines.push('⚠️ 這一版本身就帶著 ' + picked.preExisting.length + ' 格硬規則違反，'
      + '不是這一次改動造成的：' + picked.preExisting.join('；'));
  }
  lines.push('最終選到 ' + picked.cells.length + ' 格：'
    + (picked.cells.map(function (c) {
      return c.serviceDate + ' ' + c.postId + '#' + c.slotIndex
        + ' ← ' + c.replacement.name;
    }).join('／') || '（一格都沒有）'));
  return lines.join('\n　 ');
}

/**
 * 一條違反嘅身分證。**唔包 `personId`**。
 *
 * ⚠️ 包咗 `personId` 嘅話，一格本來就違反緊嘅嘢換咗個人之後
 * 會被當成「新違反」，於是嗰一格永遠揀唔到。
 * 我哋要問嘅係「換完之後有冇**多咗**一個問題」，唔係「有冇問題」。
 *
 * @param {Object} v `findStateViolations_()` 出嚟嗰一條
 * @returns {string}
 */
function selfTestViolationKey_(v) {
  return [v.ruleId, v.serviceDate, v.postId, v.slotIndex].join('|');
}

/**
 * 第五十三輪批次 C 組：**一次執行結果嘅指紋。**
 *
 * ═══════════════════════════════════════════════════════════════════
 * 點解要有呢樣嘢
 * ═══════════════════════════════════════════════════════════════════
 *
 * 呢個已經係第四次「Ivan 撳同一粒掣三次以上，三份報告一字不差」：
 *
 *   第五十輪　續跑只跳過通過嗰啲　　⇒ 撳三次，三次一樣
 *   第五十輪　不變量太貴　　　　　　⇒ 撳三次，三次一樣
 *   第五十二輪　既有失敗污染下游　　⇒ 撳三次，三次一樣
 *   第五十三輪　一條真嘅紅　　　　　⇒ 撳三次，三次一樣
 *
 * 每一次都要 Ivan 自己察覺「咦，三份一樣」然後停手問。
 *
 * ⚠️⚠️ 而 Ivan 十月返嚟嗰陣係**一個人**。到時冇人喺旁邊幫佢數
 *「你已經撳咗三次」。所以呢件事要由報告自己講。
 *
 * ⚠️ 指紋要包住**證據**，唔係淨係包住狀態。淨係比對「紅唔紅」嘅話，
 * 一條由「A 斷言紅」變成「B 斷言紅」嘅情境會被當成「同一個結果」，
 * 而嗰個其實係有進展。
 *
 * @param {Object} outcome 一個情境嘅結果
 * @returns {string} 內容一樣就一樣嘅一串字
 */
function selfTestOutcomeFingerprint_(outcome) {
  if (!outcome) return '';
  const parts = [String(outcome.status || '')];
  if (outcome.error) parts.push('ERR｜' + outcome.error);
  (outcome.failedChecks || []).forEach(function (c) {
    parts.push('CHK｜' + c.label + '｜' + c.expected + '｜' + c.actual);
  });
  (outcome.invariantDetail || []).forEach(function (d) { parts.push('INV｜' + d); });
  return parts.join('\n');
}

/**
 * 「唔好再撳」嗰一句。
 *
 * @param {Object} repeat `{runCount, sameStreak}`
 * @returns {string} 唔使講就回空字串
 */
function describeSelfTestRepeat_(repeat) {
  if (!repeat || Number(repeat.sameStreak) < 2) return '';
  return '⛔ 這一條已經重跑 ' + Number(repeat.runCount) + ' 次，每次都是同一個結果。';
}

/**
 * 第 2 層 2A：把一個真實 API 回傳值錄低。
 *
 * ⚠️ **錄真實回傳值**，唔係錄一個我以為佢會係嘅樣。
 * 前端測試一直用人手砌嘅 `s`，而嗰個 `s` 同真嘅唔一樣——
 * 第四十七輪嗰個死碼就係噉樣由頭綠到尾。
 *
 * ⚠️ 錄影本身**唔可以令情境失敗**。錄唔到就記一句，繼續跑。
 *
 * @param {string} scenarioId 情境 ID
 * @param {string} apiName API 名
 * @param {*} value 回傳值
 * @returns {void}
 */
function selfTestRecordPayload_(scenarioId, apiName, value) {
  // ── 第五十三輪批次：**同一份原文亦都要入報告。** ─────────────
  //
  // ⚠️ 之前只入 `SelfTest_Payloads` 工作表。而下一輪落手查嗰個
  // 淨係睇得到 Ivan 貼上嚟嗰份報告——工作表佢睇唔到。
  //
  // S05 到 S13 係一段**從來冇執行過**嘅路。高機率各有各嘅問題，
  // 而每一個問題嘅第一個問句都係「呢個 API 到底回咗乜」。
  // 冇原文就答唔到，而答唔到就要 Ivan 再撳一次——
  // 即係 C 組要修嗰件事。
  try {
    if (!selfTestPayloads_[scenarioId]) selfTestPayloads_[scenarioId] = [];
    // 每條情境最多留 12 筆——多過噉份報告會變到冇人睇得落去。
    if (selfTestPayloads_[scenarioId].length < 12) {
      let text;
      try {
        text = JSON.stringify(value);
      } catch (err) {
        text = '（寫不成 JSON：' + err.message + '）';
      }
      text = String(text === undefined ? 'undefined' : text);
      selfTestPayloads_[scenarioId].push({
        api: apiName,
        // ⚠️ 截**頭** 500 字，而且要標明截過——
        // 一段被截而冇標明嘅 JSON 會被當成完整嘅嚟讀。
        text: text.length > 500 ? (text.slice(0, 500) + '……（還有 '
          + (text.length - 500) + ' 字，全文在 SelfTest_Payloads 工作表）') : text
      });
    }
  } catch (err) {
    log_('WARN', '回傳值記不進報告（' + scenarioId + '）：' + err.message);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SELFTEST_SHEETS.PAYLOADS);
    if (!sheet) {
      sheet = ss.insertSheet(SELFTEST_SHEETS.PAYLOADS);
      sheet.appendRow(['情境', 'API', '回傳值（JSON）', '錄於']);
      sheet.setFrozenRows(1);
    }
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    sheet.appendRow([scenarioId, apiName, JSON.stringify(value),
      Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss')]);
  } catch (err) {
    log_('WARN', 'selfTestRecordPayload_ 失敗（' + scenarioId + '／' + apiName
      + '）：' + err.message);
  }
}

/**
 * 叫一個 API，順手錄低佢嘅回傳值。
 *
 * @param {string} scenarioId 情境 ID
 * @param {string} apiName API 名（錄影用）
 * @param {Function} fn 真正嘅呼叫
 * @returns {*} API 嘅回傳值
 */
function selfTestCall_(scenarioId, apiName, fn) {
  const value = fn();
  selfTestRecordPayload_(scenarioId, apiName, value);
  return value;
}

/* ═════════════════════════════════════════════════════════════════════
 * 情境　S01 – S10
 * ═════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 每一個係一個**獨立、可以單獨重跑**嘅函式。
 * 唔可以寫成一條長函式——中間一個爆咗，後面嗰啲要照跑，
 * 最後一次過報。
 */

/* ═════════════════════════════════════════════════════════════════════
 * 第五十四輪批次 A 組：**兩支「自己揀替代人選」嘅函式已經拆走。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 拆走咗嘅係 `selfTestPickReplacementName_()` 同 `selfTestWriteRealNames_()`。
 *
 * ⚠️ 佢哋入面嗰句「**優先揀合資格嘅，揀唔到就退而求其次**」
 * 正正就係三輪紅嘅根源：
 *
 *   第五十一輪　修「名字要系統認得出」　　　⇒ 下一次撞喺 Eligibility
 *   第五十三輪　修「要喺 Eligibility 合資格」⇒ 下一次撞喺 Roles 身分限制
 *   （如果再猜）修「要有堂委身分」　　　　　⇒ 下一條規則
 *
 * 每一次嘅診斷都啱，但策略錯：**測試喺度自己重新實作系統嘅接受條件。**
 * 系統有幾多道閘，就會有幾多輪失敗。
 *
 * 而家換成 `selfTestPickAcceptedCells_()`：寫入之後問
 * `apiSaveAndConfirmPlan()`，接受條件只有一條——
 * `needsRelease === false` 而且 `violations.real` 係空陣列。
 *
 * ⚠️ 留低嗰兩支就係留低第二個算法。所以拆走，唔係「留住以防萬一」。
 */

/** S01：空季度，generate 之前，dashboard 講咩。 */
function selfTestS01_(quarterId) {
  const t = selfTestCollector_('S01');
  const d = selfTestCall_('S01', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });

  t.equal('清乾淨之後，最新版本應該係「沒有」',
    d.latestVersion === null ? 'null' : JSON.stringify(d.latestVersion), 'null',
    'apiGetDashboardState().latestVersion');
  t.expect('「生成初稿」那一粒掣是亮的',
    !!(d.buttons && d.buttons.generate && d.buttons.generate.enabled),
    'enabled=true', JSON.stringify(d.buttons && d.buttons.generate),
    'apiGetDashboardState().buttons.generate');
  t.expect('三粒寄出掣全部是灰的（還沒有東西可以寄）',
    ['review', 'official', 'resend'].every(function (k) {
      return !(d.buttons && d.buttons[k] && d.buttons[k].enabled);
    }), '全部 enabled=false',
    JSON.stringify(['review', 'official', 'resend'].map(function (k) {
      return k + '=' + !!(d.buttons && d.buttons[k] && d.buttons[k].enabled);
    })), 'apiGetDashboardState().buttons');
  t.equal('未儲存改動應該係 0', (d.unsaved || {}).gridChangeCount, 0,
    'apiGetDashboardState().unsaved');
  return t.result();
}

/** S02：生成初稿。 */
function selfTestS02_(quarterId) {
  const t = selfTestCollector_('S02');
  selfTestCall_('S02', 'apiGenerateDraftExecute',
    function () { return apiGenerateDraftExecute(quarterId); });

  const versionNo = findLatestVersionNo(quarterId);
  t.equal('生成之後最新版本是 v0', versionNo, 0, 'findLatestVersionNo()');
  t.equal('Stage 是 ' + QUARTER_STAGE.DRAFT, getQuarterStage_(quarterId),
    QUARTER_STAGE.DRAFT, 'getQuarterStage_()');

  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return String(r[A.QUARTER_ID] || '').trim() === quarterId
      && Number(r[A.VERSION_NO]) === 0;
  });
  t.expect('RosterAssignments 真的寫了東西進去',
    rows.length > 0, '> 0 行', rows.length + ' 行',
    'RosterAssignments 裡面 ' + quarterId + ' v0 的行數');

  // ⚠️ 行數要對得上「主日數 × 崗位 slot 數」——唔可以淨係驗「大過 0」。
  // 「大過 0」呢種斷言，喺一個只生成咗一日嘅壞結果下面一樣會綠。
  const dates = readServiceDatesNormalized(quarterId,
    getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE));
  t.expect('每一個主日都有派工',
    dates.length > 0 && dates.every(function (d) {
      return rows.some(function (r) {
        return toDateString(r[A.SERVICE_DATE],
          getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE)) === d.serviceDate;
      });
    }),
    dates.length + ' 個主日全部有派工',
    dates.filter(function (d) {
      return !rows.some(function (r) {
        return toDateString(r[A.SERVICE_DATE],
          getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE)) === d.serviceDate;
      });
    }).map(function (d) { return d.serviceDate; }).join('、') || '（全部都有）',
    'ServiceDates ' + dates.length + ' 個主日對 RosterAssignments');
  return t.result();
}

/**
 * S03：真嘅改 grid 3 格。
 *
 * ⚠️ 第五十一輪批次 A 組：改成寫**系統認得出嘅名**。
 * 見 `selfTestPickReplacementName_()` 檔頭嗰段。
 */
function selfTestS03_(quarterId) {
  const t = selfTestCollector_('S03');
  const versionNo = findLatestVersionNo(quarterId);

  // ⚠️⚠️ 第五十四輪批次 A 組：**寫入之後問系統，唔再自己實作接受條件。**
  // 見 `selfTestBuildCandidatePool_()` 檔頭嗰段。
  const picked = selfTestPickAcceptedCells_(quarterId, versionNo, 3, 'S03');

  // ── A3：試嘅過程要入報告 ────────────────────────────────────
  //
  // ⚠️ 唔寫嘅話，一句「找到 2 格」冇人知佢試過乜、換過邊格、
  // 撞過邊條規則——而嗰啲正正係下一輪要靠嘅資料。
  t.expect('（過程）' + describeAcceptedPickAttempts_(picked),
    true, '（過程紀錄，不是斷言）',
    'plan ' + picked.planCalls + ' 次',
    '接受條件只有一條：needsRelease === false 而且 violations.real 是空的。');

  // ── plan 拋錯／被擋住 ⇒ **拋出去，令它報 ERROR 帶住原文** ────
  //
  // ⚠️ 靜靜過嘅話，後面每一條都會喺一個唔知咩狀態嘅季度上面跑。
  if (picked.planError) throw new Error('S03 選格時：' + picked.planError);

  if ((picked.preExisting || []).length > 0) {
    return t.skip('（跳過）第 ' + versionNo + ' 版本身就帶著 '
      + picked.preExisting.length + ' 格硬規則違反，不是這一次改動造成的：'
      + picked.preExisting.join('；')
      + '。這一條造不出「改一格而不被攔」的情境。'
      + 'S05 會在同一個地方被攔——那一條的訊息才是要看的。');
  }
  if (picked.noCandidate) return t.skip('（跳過）' + picked.noCandidate);
  if (picked.cells.length === 0) {
    return t.skip('（跳過）試了 ' + picked.planCalls
      + ' 次都湊不到一格「改了不會被攔」的。'
      + 'S04–S13 會照樣跑，但用的是原本那一版，沒有未儲存改動。');
  }

  const want = picked.cells.length;
  if (want < 3) {
    t.expect('（提示）只湊到 ' + want + ' 格（想要 3 格）'
      + '——下面幾條斷言按實際那 ' + want + ' 格算',
      true, '（提示，不是失敗）', String(want),
      'plan 上限 ' + SELFTEST_PLAN_SEARCH_ROUNDS + ' 次，每次都很貴。');
  }

  const d = selfTestCall_('S03', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('dashboard 數到 ' + want + ' 格未儲存',
    (d.unsaved || {}).gridChangeCount, want,
    'apiGetDashboardState().unsaved＝' + JSON.stringify(d.unsaved));

  // ⚠️ 第五十一輪批次 A2 組：認不出的話系統會整批擋住。
  t.equal('而且 ' + want + ' 格全部認得出（unresolvedCount = 0）'
    + '——認不出的話，系統會整批擋住，後面七條情境全部連環倒',
    (d.unsaved || {}).unresolvedCount, 0,
    'apiGetDashboardState().unsaved＝' + JSON.stringify(d.unsaved));

  // ⚠️⚠️ 第五十四輪批次 A4 組：**最後兩條就是攔住 S05 那道閘自己的判斷。**
  //
  // `picked.confirmed` ＝ 揀格那一支最後一次 plan 講的就是現在這個格局，
  // 不用再叫一次（apiSaveAndConfirmPlan() 很貴）。
  const plan = picked.confirmed ? picked.plan
    : selfTestCall_('S03', 'apiSaveAndConfirmPlan（最終確認）',
      function () { return apiSaveAndConfirmPlan(quarterId); });
  const real = ((plan.violations || {}).real || []);
  t.equal('不需要打字放行（needsRelease = false）'
    + '——要放行的話，S05 會拋錯，而 S06 之後全部被擋住',
    plan.needsRelease, false, 'apiSaveAndConfirmPlan().needsRelease');
  t.equal('而且一格硬規則違反都沒有（violations.real 是空的）',
    real.length, 0,
    real.map(function (v) {
      return v.serviceDate + '　' + v.postId + '#' + v.slotIndex + '　' + v.ruleId
        + '（' + (v.reason || '') + '）';
    }).join('；') || 'apiSaveAndConfirmPlan().violations.real＝[]');
  return t.result();
}

/**
 * S04：喺有未儲存改動之下開寄出。
 *
 * ⚠️⚠️ **呢一條就係第四十七輪嗰個死碼。**
 *
 * 佢一定要由**真實嘅 `kind`** 決定，唔係由測試直接呼叫嗰個分支。
 * 第四十輪寫好嘅嗰個「未儲存」對話框，由寫出嚟到第四十七輪
 * 一次都冇執行過——因為 `resolveSendKind_()` 見三粒掣全灰就回 `NONE`，
 * 而 `NONE` 嗰段排喺「未儲存」嗰段前面。
 *
 * 所以呢一條驗嘅係：`apiGetSendPlanSummary()` 真係回一份
 * 「前端會行到未儲存嗰段」嘅資料。
 */
function selfTestS04_(quarterId) {
  const t = selfTestCollector_('S04');
  const s = selfTestCall_('S04', 'apiGetSendPlanSummary',
    function () { return apiGetSendPlanSummary(quarterId); });

  t.equal('真實的 kind 是 NONE（三粒掣被未儲存改動擋住）', s.kind, 'NONE',
    'apiGetSendPlanSummary().kind');
  t.expect('而且 blockedByUnsavedOnly 是 true'
    + '——沒有它，前端會走去「現在沒有可以寄的東西」那一段，'
    + '而「你有 N 格改動還未儲存」那一整段永遠跑不到',
    s.blockedByUnsavedOnly === true, 'true', String(s.blockedByUnsavedOnly),
    'apiGetSendPlanSummary().blockedByUnsavedOnly');
  t.equal('未儲存格數仍然是 3', (s.unsaved || {}).gridChangeCount, 3,
    JSON.stringify(s.unsaved));

  // ── 第四十八輪 A 組：〔寄出但不儲存〕那一粒的出現條件 ──────────
  //
  // ⚠️ 第五十一輪批次 B1 組：**先驗前置條件，不成立就不驗後面那一條。**
  //
  // `buildUnsavedSendPreview_()` 在 `canSendUnsaved=false` 之下回傳空預覽
  // ——那是**對的**（那個畫面根本不會出現）。所以「拿得到 3 格明細」
  // 在那個前提下本來就不可能成立。
  //
  // 兩條一起報的話，一個根因會看起來像兩條獨立失敗。
  // 上一輪 9 條紅裡面，真正的根因只有 2 個——而 Ivan 要逐條看完才知道。
  t.expect('〔寄出但不儲存〕在這個狀態下應該畫得出'
    + '（只有 grid 改動、沒有認不出的字、沒有待處理申報）',
    s.canSendUnsaved === true, 'true',
    String(s.canSendUnsaved) + '｜' + String(s.canSendUnsavedReason),
    'apiGetSendPlanSummary().canSendUnsaved');
  if (s.canSendUnsaved !== true) {
    t.expect('（前置條件不成立，下面那一條不驗）', true, '（不驗）',
      'canSendUnsaved=false，unresolvedCount='
        + String((s.unsaved || {}).unresolvedCount),
      '確認畫面在 canSendUnsaved=false 之下本來就回傳空預覽——'
        + '那是對的。這裡只有一個根因，不是兩條獨立失敗。');
    return t.result();
  }
  t.equal('而且那個確認畫面拿得到 3 格明細',
    (s.unsavedSendPreview || {}).total, 3,
    'apiGetSendPlanSummary().unsavedSendPreview');
  return t.result();
}

/** S05：儲存並確認。 */
function selfTestS05_(quarterId) {
  const t = selfTestCollector_('S05');
  // ⚠️ 第五十一輪批次：版本號**相對**，唔再寫死 `v1`。
  // S14 而家排喺 S02 之後（見登記表嗰段），所以到咗呢度可能已經係 v1。
  // 寫死一個數字嘅話，日後任何一個情境多建一個版本，
  // 呢一條就會紅——而佢紅嗰陣講嘅唔係真問題。
  const before = findLatestVersionNo(quarterId);
  const plan = selfTestCall_('S05', 'apiSaveAndConfirmPlan',
    function () { return apiSaveAndConfirmPlan(quarterId); });
  t.equal('plan 看到 3 格 grid 改動', (plan.gridChanges || []).length, 3,
    'apiSaveAndConfirmPlan().gridChanges');

  const saved = selfTestCall_('S05', 'apiSaveAndConfirmExecute',
    function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });

  t.equal('儲存之後多了一個版本（v' + before + ' ⇒ v' + (before + 1) + '）',
    findLatestVersionNo(quarterId), before + 1,
    'findLatestVersionNo()：儲存前 v' + before
      + '；apiSaveAndConfirmExecute() 回傳 ' + JSON.stringify(saved).slice(0, 200));
  const d = selfTestCall_('S05', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('未儲存改動歸零', (d.unsaved || {}).gridChangeCount, 0,
    JSON.stringify(d.unsaved));

  // I09 講嘅係同一件事，呢度順手驗一次（公開連結指向最新嗰一版）。
  const link = invariantPublicLinkVersion_(quarterId);
  t.expect('公開連結指向最新那一版', link.status !== INVARIANT_STATUS.FAILED,
    link.expected, link.actual, link.evidence);
  return t.result();
}

/**
 * S06：寄給堂委審閱（DRY_RUN）。
 *
 * ⚠️ **preview 的人數 === 實際寄出的封數。**
 * 呢一條就係第四十六輪嗰個「會寄給這 3 位／已模擬寄出 9 封」。
 */
function selfTestS06_(quarterId) {
  const t = selfTestCollector_('S06');
  // ⚠️ 用一份**有揀人**嘅 `sendOptions` 跑。
  // 唔傳 `sendOptions` 嘅話，兩個算法啱啱好重合——
  // 而第四十七輪 `e2e_five_stage_flow.test.js` 就係噉樣由頭綠到尾。
  const pool = selfTestCall_('S06', 'apiGetSendRecipientPool',
    function () { return apiGetSendRecipientPool(quarterId); });
  const keys = [];
  (pool.groups || []).forEach(function (g) {
    (g.items || []).forEach(function (item) {
      if (keys.length < 2 && item.key) keys.push(item.key);
    });
  });
  const sendOptions = keys.length > 0
    ? { recipientScope: 'PICK', pickedKeys: keys }
    : null;

  const preview = selfTestCall_('S06', 'apiStep2Preview',
    function () { return apiStep2Preview(quarterId, sendOptions); });
  const result = selfTestCall_('S06', 'apiStep2Confirm',
    function () { return apiStep2Confirm(quarterId, sendOptions); });

  const actual = Number(result.sent || 0) + Number(result.dryRun || 0)
    + Number(result.skipped || 0) + Number(result.failed || 0);
  t.equal('preview 的人數 === 實際處理的封數',
    actual, preview.recipientCount,
    'apiStep2Preview 回 recipientCount=' + preview.recipientCount
      + '；apiStep2Confirm 回 ' + JSON.stringify(result)
      + '（sendOptions=' + JSON.stringify(sendOptions) + '）');
  t.expect('DRY_RUN 之下不可以有真實寄出',
    Number(result.sent || 0) === 0, 'sent=0', 'sent=' + result.sent,
    JSON.stringify(result));
  t.equal('Stage 前進到 ' + QUARTER_STAGE.REVIEW_SENT,
    getQuarterStage_(quarterId), QUARTER_STAGE.REVIEW_SENT, 'getQuarterStage_()');
  return t.result();
}

/** S07：真嘅寫 3 筆 Requests，然後套用。 */
function selfTestS07_(quarterId) {
  const t = selfTestCollector_('S07');
  const versionNo = findLatestVersionNo(quarterId);
  const cells = selfTestPickCells_(quarterId, versionNo, 3);
  const R = COLUMNS.REQUESTS;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.REQUESTS);
  if (!sheet) {
    t.expect('Requests 工作表存在', false, '存在', '找不到',
      '這一季用不到申報流程時可以先建立它：維護 ▸ 建立 Requests 工作表');
    return t.result();
  }

  // ⚠️ **真嘅 append 落張工作表**，唔係喺記憶體造。
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const peopleById = indexPeopleById_();
  let appended = 0;
  cells.forEach(function (c) {
    const row = new Array(headers.length).fill('');
    const put = function (key, value) {
      const idx = headers.indexOf(key);
      if (idx >= 0) row[idx] = value;
    };
    put(R.QUARTER_ID, quarterId);
    put(R.SERVICE_DATE, c.serviceDate);
    put(R.POST_NAME, c.postId);
    const person = peopleById[c.personId];
    put(R.PERSON_NAME, person ? person.nameTC : c.personId);
    put(R.REQUEST_TYPE, '不能服侍');
    put(R.CREATED_AT, Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss'));
    sheet.appendRow(row);
    appended++;
  });
  t.equal('3 筆申報真的寫進 Requests 工作表', appended, 3, 'sheet.appendRow()');

  const plan = selfTestCall_('S07', 'apiStep3Plan',
    function () { return apiStep3Plan(quarterId); });
  t.expect('系統看得到剛才那幾筆申報',
    (plan.results || []).length >= 3, '≥ 3 筆',
    (plan.results || []).length + ' 筆', 'apiStep3Plan().results');

  selfTestCall_('S07', 'apiStep3Apply',
    function () { return apiStep3Apply(quarterId, []); });

  // 套用之後，Status 一定要寫返落張表——唔寫嘅話，
  // 同一批申報下次會再被當成「未處理」。
  const stillPending = readSheet(SHEETS.REQUESTS).filter(function (r) {
    return String(r[R.QUARTER_ID] || '').trim() === quarterId
      && String(r[R.STATUS] || '').trim() === '';
  });
  t.equal('套用之後沒有一筆的 Status 還是空白', stillPending.length, 0,
    'Requests 裡面 ' + quarterId + ' 而 Status 空白的行數');
  return t.result();
}

/** S08：產生個人 PDF。 */
function selfTestS08_(quarterId) {
  const t = selfTestCollector_('S08');
  const versionNo = findLatestVersionNo(quarterId);

  // ⚠️ 分批。一次執行做唔晒 59 份——既有嘅批次入口本來就係為咗呢件事。
  let done = null;
  let rounds = 0;
  while (rounds < 20) {
    done = selfTestCall_('S08', 'apiGeneratePersonalPdfBatch',
      function () { return apiGeneratePersonalPdfBatch(quarterId, versionNo); });
    rounds++;
    if (done && done.done) break;
    if (selfTestOutOfTime_()) break;
  }
  t.expect('個人 PDF 有真的產生出來',
    !!done && Number(done.doneCount || 0) > 0, '> 0 份',
    JSON.stringify(done), 'apiGeneratePersonalPdfBatch()');
  // ⚠️ 做唔晒**唔可以**報成完成。
  t.expect('批次要嘛做完，要嘛明確講還有幾多份未做',
    !!done && (done.done === true || Number(done.totalPeople || 0) > Number(done.doneCount || 0)),
    'done=true 或者講得出還差多少', JSON.stringify(done),
    '跑了 ' + rounds + ' 批');
  return t.result();
}

/** S09：正式發出（DRY_RUN）。 */
function selfTestS09_(quarterId) {
  const t = selfTestCollector_('S09');
  const versionNo = findLatestVersionNo(quarterId);
  const preview = selfTestCall_('S09', 'apiStep4GetSendPreview',
    function () { return apiStep4GetSendPreview(quarterId, versionNo, null); });
  const result = selfTestCall_('S09', 'apiStep4Confirm',
    function () { return apiStep4Confirm(quarterId, null); });

  const actual = Number(result.sent || 0) + Number(result.dryRun || 0)
    + Number(result.skipped || 0) + Number(result.failed || 0)
    + Number(result.unchanged || 0);
  t.equal('preview 的人數 === 實際處理的封數', actual, preview.recipientCount,
    'apiStep4GetSendPreview 回 recipientCount=' + preview.recipientCount
      + '；apiStep4Confirm 回 ' + JSON.stringify(result));
  t.expect('DRY_RUN 之下不可以有真實寄出',
    Number(result.sent || 0) === 0, 'sent=0', 'sent=' + result.sent,
    JSON.stringify(result));
  t.equal('Stage 前進到 ' + QUARTER_STAGE.OFFICIAL_SENT,
    getQuarterStage_(quarterId), QUARTER_STAGE.OFFICIAL_SENT, 'getQuarterStage_()');
  return t.result();
}

/** S10：改 2 格 → 儲存 → 改動後重發。 */
function selfTestS10_(quarterId) {
  const t = selfTestCollector_('S10');

  // ⚠️ 第五十一輪批次 A4 組：**開始之前先驗前置狀態。**
  //
  // 第五十輪嗰次，S10 見到「自測改動3」仍然留喺表上——即係 S03 嘅殘留
  // 冇清走。而 S10 冇察覺，繼續硬跑落去，於是佢報嘅嘢同真正嘅問題無關。
  //
  // 一個喺污染狀態下硬跑嘅情境，佢嘅紅同綠都冇意思。
  const before = selfTestCall_('S10', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  const beforeUnsaved = before.unsaved || {};
  if (beforeUnsaved.unresolvedCount > 0 || beforeUnsaved.gridChangeCount > 0) {
    t.expect('（前置）開始之前表上應該是乾淨的', false,
      'gridChangeCount=0、unresolvedCount=0',
      'gridChangeCount=' + beforeUnsaved.gridChangeCount
        + '、unresolvedCount=' + beforeUnsaved.unresolvedCount,
      '上一個情境留下了未清理的格。這一條不再往下跑——'
        + '在一個污染狀態下硬跑出來的紅或綠都沒有意思。');
    return t.result();
  }

  const versionNo = findLatestVersionNo(quarterId);
  // ⚠️ 第五十四輪批次 A2 組：同 S03 行**同一條批量路**——
  // 寫入之後問系統，唔自己實作接受條件。
  // S10 一樣係改格，所以一樣會撞到同一堆閘。一齊修，唔可以只修 S03。
  const picked = selfTestPickAcceptedCells_(quarterId, versionNo, 2, 'S10');
  t.expect('（過程）' + describeAcceptedPickAttempts_(picked),
    true, '（過程紀錄，不是斷言）',
    'plan ' + picked.planCalls + ' 次',
    '接受條件只有一條：needsRelease === false 而且 violations.real 是空的。');

  if (picked.planError) throw new Error('S10 選格時：' + picked.planError);
  if ((picked.preExisting || []).length > 0) {
    return t.skip('（跳過）這一版本身就帶著 ' + picked.preExisting.length
      + ' 格硬規則違反，不是這一次改動造成的：' + picked.preExisting.join('；'));
  }
  if (picked.noCandidate) return t.skip('（跳過）' + picked.noCandidate);
  if (picked.cells.length === 0) {
    return t.skip('（跳過）試了 ' + picked.planCalls
      + ' 次都湊不到一格「改了不會被攔」的，改動後重發這一條造不出來。');
  }
  const want = picked.cells.length;
  const result = { picks: picked.cells.map(function (c) {
    return { cell: c, pick: { personId: c.replacement.personId, name: c.replacement.name } };
  }) };

  const midway = selfTestCall_('S10', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal(want + ' 格真的寫進 grid',
    (midway.unsaved || {}).gridChangeCount, want,
    picked.cells.map(function (c) {
      return c.serviceDate + '　' + c.postId + '　' + c.personId
        + ' ⇒ ' + c.replacement.name;
    }).join('；'));
  t.equal(want + ' 格全部認得出（unresolvedCount = 0）',
    (midway.unsaved || {}).unresolvedCount, 0,
    JSON.stringify(midway.unsaved));

  // ⚠️ A2：同 S03 一樣，最後一句由系統本身答。S10 撞到嘅話，S11／S12 會連環倒。
  const midPlan = picked.confirmed ? picked.plan
    : selfTestCall_('S10', 'apiSaveAndConfirmPlan（最終確認）',
      function () { return apiSaveAndConfirmPlan(quarterId); });
  const midReal = ((midPlan.violations || {}).real || []);
  t.equal('不需要打字放行（needsRelease = false）'
    + '——要放行的話，下面那一句「儲存並確認」會拋錯',
    midPlan.needsRelease, false, 'apiSaveAndConfirmPlan().needsRelease');
  t.equal('而且一格硬規則違反都沒有（violations.real 是空的）',
    midReal.length, 0,
    midReal.map(function (v) {
      return v.serviceDate + '　' + v.postId + '　' + v.ruleId;
    }).join('；') || 'apiSaveAndConfirmPlan().violations.real＝[]');

  selfTestCall_('S10', 'apiSaveAndConfirmExecute',
    function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });

  const plan = selfTestCall_('S10', 'apiStep5Plan',
    function () { return apiStep5Plan(quarterId, null); });
  const changedIds = (plan.changedList || []).map(function (c) { return c.personId; });

  // ⚠️ 「只寄給那 2 格涉及的人」——**唔可以淨係驗「大過 0」**。
  //
  // 改咗兩格會令**最多四個人**受影響：本來嗰兩個少咗一格，
  // 而新填嗰兩個多咗一格。所以驗嘅係：受影響嘅人**全部都喺
  // 我啱啱碰過嗰幾個人裡面**。
  const touched = picked.cells.map(function (c) { return c.personId; })
    .concat(result.picks.map(function (p) { return p.pick.personId; }));
  const unexpected = changedIds.filter(function (id) { return touched.indexOf(id) === -1; });
  t.equal('改動後重發的名單裡面沒有「我沒有碰過的人」',
    unexpected.length, 0,
    '碰過的是 ' + JSON.stringify(touched) + '；系統算出有改動的是 '
      + JSON.stringify(changedIds) + '；多出來的是 ' + JSON.stringify(unexpected));
  t.expect('而且真的有人被算進去（不是空的）',
    changedIds.length > 0, '> 0 人', changedIds.length + ' 人',
    'apiStep5Plan().changedList');
  return t.result();
}

/* ═════════════════════════════════════════════════════════════════════
 * 情境　S11 – S15
 * ═════════════════════════════════════════════════════════════════════ */

/** S11：再撳一次正式發出 ⇒ 要被防重複擋住，而且講得出原因。 */
function selfTestS11_(quarterId) {
  const t = selfTestCollector_('S11');
  let threw = '';
  try {
    selfTestCall_('S11', 'apiStep4Confirm',
      function () { return apiStep4Confirm(quarterId, null); });
  } catch (err) {
    threw = err.message;
  }
  t.expect('第二次「正式發出」被擋住',
    threw !== '', '拋錯', threw || '（沒有拋錯，即是又寄了一次）',
    '正式發出是一季一次的動作。擋不住的話，全體義工會收到第二封'
      + '「正式」通知——對他們來說就是「究竟哪一封才算數」。');
  // ⚠️ 「被擋住」唔夠。**要講得出點解**——
  // 一句「不能執行」對幹事完全冇用。
  t.expect('而且訊息講得出是因為已經發出過',
    /已經.*發出|已經.*正式/.test(threw), '訊息提到已經發出過', threw, threw);
  t.expect('訊息是三段式（發生了什麼／現在的情況／你可以怎樣做）',
    threw.indexOf('發生了什麼') !== -1 && threw.indexOf('你可以怎樣做') !== -1,
    '三段都有', threw.slice(0, 120), threw);
  return t.result();
}

/** S12：回到上一個版本。 */
function selfTestS12_(quarterId) {
  const t = selfTestCollector_('S12');
  const before = findLatestVersionNo(quarterId);
  if (before < 1) {
    t.expect('這一季有多過一個版本才回退得到', false, '≥ v1', 'v' + before,
      '前面的情境沒有造出第二個版本。這一批要由 S01 順住跑。');
    return t.result();
  }

  const target = before - 1;
  const plan = selfTestCall_('S12', 'apiRollbackPlan',
    function () { return apiRollbackPlan(quarterId, target); });

  // ⚠️ 回退係一個**會蓋走現況**嘅動作，所以個 plan 一定要有警告。
  // 冇警告嘅回退，幹事會當成「睇一睇」噉撳落去。
  t.expect('回退的預覽有警告，不是靜靜就做',
    JSON.stringify(plan).indexOf('警告') !== -1
      || (plan.warnings && plan.warnings.length > 0)
      || plan.needsRelease === true
      || String(plan.confirmText || '') !== '',
    '有警告／要打字確認', JSON.stringify(plan).slice(0, 300),
    'apiRollbackPlan() 的回傳');
  t.expect('而且預覽本身沒有動到版本'
    + '——「先算後做」：看一眼不應該改任何東西',
    findLatestVersionNo(quarterId) === before,
    'v' + before, 'v' + findLatestVersionNo(quarterId),
    '叫過 apiRollbackPlan() 之後最新版本號');
  return t.result();
}

/** S13：下載及匯出——整季 PDF。 */
function selfTestS13_(quarterId) {
  const t = selfTestCollector_('S13');
  const versionNo = findLatestVersionNo(quarterId);
  let result = null;
  let threw = '';
  try {
    result = selfTestCall_('S13', 'apiExportRosterPdf',
      function () { return apiExportRosterPdf(quarterId, versionNo); });
  } catch (err) {
    threw = err.message;
  }
  t.expect('整季 PDF 真的產生出來', threw === '' && !!result,
    '產生得到', threw || JSON.stringify(result),
    'apiExportRosterPdf()');
  // ⚠️ 「有回傳」唔等於「有檔案」。要拎得到 URL 先算數。
  t.expect('而且拿得到檔案連結（不是只回一個空物件）',
    !!(result && (result.url || result.fileUrl)),
    '有 url', JSON.stringify(result || {}).slice(0, 200),
    '回傳裡面找不到 url／fileUrl 就代表「報告說做好了，而檔案不知在哪」');
  return t.result();
}

/**
 * S14：特殊主日——`SkipPostIDs` 填上之後，重新生成，嗰幾格要真係空住。
 *
 * ⚠️ 而且標籤要係「特殊主日」（或者 `ExternalOwner` 嗰句），
 * **唔可以**係「待確認」——後者係「未派到人」嘅意思，
 * 而呢一格係「特登唔派」。兩者對幹事嚟講差好遠。
 */
function selfTestS14_(quarterId) {
  const t = selfTestCollector_('S14');
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const dates = readServiceDatesNormalized(quarterId, timezone);
  if (dates.length === 0) {
    t.expect('這一季有主日', false, '≥ 1 個', '0 個', 'readServiceDatesNormalized()');
    return t.result();
  }
  const targetDate = dates[0].serviceDate;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) {
    t.expect('SpecialSundays 工作表存在', false, '存在', '找不到',
      '維護 ▸ 補建 SpecialSundays 工作表');
    return t.result();
  }

  // ⚠️ **真嘅 append 一行落張工作表**，唔係喺記憶體造。
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const row = new Array(headers.length).fill('');
  const put = function (key, value) {
    const idx = headers.indexOf(key);
    if (idx >= 0) row[idx] = value;
  };
  put(S.SPECIAL_ID, quarterId + '-SELFTEST');
  put(S.QUARTER_ID, quarterId);
  put(S.SERVICE_DATE, targetDate);
  put(S.TYPE, '合堂');
  put(S.TITLE, '自測用合堂');
  put(S.SKIP_POST_IDS, 'CHAIR');
  put(S.ACTIVE, 'TRUE');
  // ⚠️ S15 要用：明確填 FALSE 先至算「未確認」。
  put(S.CONFIRMED, 'FALSE');
  sheet.appendRow(row);
  t.expect('特殊主日那一行真的寫進工作表', true, '寫得到', '寫得到',
    quarterId + '-SELFTEST　' + targetDate + '　SkipPostIDs=CHAIR');

  // ── 重新生成 ──────────────────────────────────────────────────
  //
  // ⚠️⚠️ 第五十一輪批次 C 組：**上一次呢度靜靜噉乜都冇做過。**
  //
  // 第五十輪嗰次叫嘅係 `apiGenerateDraftExecute()`。而嗰一支喺一個
  // 已經有版本嘅季度上面會回：
  //
  //     { ok: false, versionCreated: false,
  //       message: '這一季已經有第 N 版，不會重複生成。…' }
  //
  // **佢唔會拋錯、亦唔會覆寫 v0**（查證過，見 `WebAppGenerate.gs`
  // 嘅 `apiGenerateDraftExecute_locked_()`）。所以係一個乾淨嘅拒絕。
  //
  // 而 S14 冇睇個回傳值，繼續攞舊嗰個 v0 去驗，於是報
  //「那一天的 CHAIR 在 v0 有 1 個有人的格」——一句完全誤導嘅結論。
  //
  // ⚠️ 「一個真實入口靜靜噉冇做嘢，而測試照樣往下走」——
  // 呢個正正就係呢個專案由第一輪殺到而家嗰種病。
  //
  // ── 用邊一支？ ────────────────────────────────────────────────
  //
  // 「進階功能 ▸ 重新生成初稿（覆蓋式）」嗰條路係 `apiGenerateRoster()`。
  // ⚠️ 佢有 `requireQuarterStage_(quarterId, [DRAFT])`——即係**Stage 一定
  // 要仲係 DRAFT**。所以 S14 而家排喺 S02 之後（見登記表嗰段），
  // 唔再排喺 S13 之後：跑到 S09 之後 Stage 係 OFFICIAL_SENT，
  // 嗰陣呢一支一定會被擋。
  //
  // ⚠️ **冇繞過保護直接叫 `performRosterGeneration_()`。**
  // 繞過去就等於冇行過真實入口，而呢一層嘅價值就係嗰件事。
  const versionBefore = findLatestVersionNo(quarterId);
  let regenerated = null;
  let regenerateError = '';
  try {
    regenerated = selfTestCall_('S14', 'apiGenerateRoster',
      function () { return apiGenerateRoster(quarterId); });
  } catch (err) {
    regenerateError = err.message;
  }

  const versionNo = findLatestVersionNo(quarterId);

  // ⚠️⚠️ 第五十一輪批次 C2 組：**先驗「重新生成真係發生咗」。**
  //
  // 冇呢一條，一個「乜都冇做」嘅呼叫會令後面每一條斷言
  // 攞住一個舊版本去驗，而報出嚟嘅結論同真正發生嘅事無關。
  t.equal('重新生成真的產生了新版本（v' + versionBefore + ' ⇒ v' + versionNo + '）',
    versionNo, versionBefore + 1,
    regenerateError
      ? 'apiGenerateRoster() 拋錯：' + regenerateError
      : 'apiGenerateRoster() 回傳：' + JSON.stringify(regenerated).slice(0, 300));
  if (versionNo !== versionBefore + 1) {
    // 冇新版本 ⇒ 下面全部唔驗。攞住舊版本去驗只會報一個誤導嘅結論。
    t.expect('（沒有新版本，下面幾條不驗）', true, '（不驗）',
      '仍然是 v' + versionNo,
      '拿舊版本去驗會報出一個跟實際無關的結論——第五十輪就是這樣'
        + '報了「那一天的 CHAIR 在 v0 有 1 個有人的格」。');
    return t.result();
  }
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const chairOnThatDay = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return String(r[A.QUARTER_ID] || '').trim() === quarterId
      && Number(r[A.VERSION_NO]) === versionNo
      && toDateString(r[A.SERVICE_DATE], timezone) === targetDate
      && String(r[A.POST_ID] || '').trim() === 'CHAIR'
      && String(r[A.PERSON_ID] || '').trim() !== '';
  });
  t.equal('那一天的主席沒有被派人（SkipPostIDs 生效）',
    chairOnThatDay.length, 0,
    targetDate + ' 的 CHAIR 在 v' + versionNo + ' 有 '
      + chairOnThatDay.length + ' 個有人的格');

  // ⚠️ 標籤要講「特殊主日」，唔可以係「待確認」。
  const gridName = buildRosterSheetName_(quarterId, versionNo);
  const grid = ss.getSheetByName(gridName);
  if (grid) {
    const keys = grid.getRange(2, 1, 1, grid.getLastColumn()).getValues()[0]
      .map(function (v) { return String(v || ''); });
    const col = keys.indexOf('CHAIR#1') + 1;
    const rows = grid.getRange(3, 1, Math.max(0, grid.getLastRow() - 2), 1).getValues();
    let text = '（找不到那一格）';
    for (let i = 0; i < rows.length; i++) {
      if (toDateString(rows[i][0], timezone) !== targetDate) continue;
      if (col > 0) text = String(grid.getRange(i + 3, col).getValue() || '');
      break;
    }
    t.expect('而且那一格的字不是「待確認」'
      + '——「待確認」的意思是「還沒有派到人」，'
      + '而這一格是「特意不派」。兩者對幹事來說差很遠',
      text.indexOf('待確認') === -1, '不是「待確認」', text,
      gridName + ' 的 ' + targetDate + '　CHAIR#1');
  }
  return t.result();
}

/** S15：合堂 ＋ `Confirmed=FALSE` ⇒ 體檢要報「未確認的特殊主日 1 個」。 */
function selfTestS15_(quarterId) {
  const t = selfTestCollector_('S15');
  // S14 已經寫咗一行 `Confirmed=FALSE`。
  const rows = readSpecialSundays(quarterId).filter(function (r) {
    return isUnconfirmedSpecialSunday_(r);
  });
  t.expect('系統數得到那一個未確認的特殊主日',
    rows.length >= 1, '≥ 1 個', rows.length + ' 個',
    '第四十七輪 C 組之前，這個數字永遠是 0——'
      + '因為 SpecialSundays 根本沒有 Confirmed 欄，'
      + 'isUnconfirmedSpecialSunday_() 永遠讀到 undefined。'
      + '這一條就是那個 bug 的真環境防線。');

  // ⚠️ 順手驗埋 I01：張表真係有 `Confirmed` 呢一欄。
  const inv = invariantSheetHeaders_();
  t.expect('而且 SpecialSundays 真的有 Confirmed 這一欄',
    inv.status === INVARIANT_STATUS.OK
      || inv.evidence.indexOf(COLUMNS.SPECIAL_SUNDAYS.CONFIRMED) === -1,
    '沒有缺欄', inv.actual, inv.evidence);

  // ── 第五十一輪批次 C4 組：**收拾。** ──────────────────────────
  //
  // ⚠️ 收拾放喺 S15 而唔係 S14，因為 **S15 要用 S14 種落嗰一行**
  //（佢驗「未確認的特殊主日數得到」）。S14 自己收拾嘅話，
  // S15 就會冇嘢可以數，而佢會報一個同系統無關嘅紅。
  //
  // ⚠️ **設成 `Active=FALSE`，唔刪行。** 留住做證據——
  // 日後想知「上一次自測到底種咗啲乜」，睇得返。
  const cleanup = selfTestDeactivateSpecialSunday_(quarterId + '-SELFTEST');
  t.expect('跑完把自測種下的那一行設成 Active=FALSE（不刪行，留住做證據）',
    cleanup.done, '已停用', cleanup.detail, cleanup.detail);
  return t.result();
}

/**
 * 把一行 `SpecialSundays` 設成 `Active=FALSE`。**唔刪行。**
 *
 * @param {string} specialId 要停用嗰一行嘅 `SpecialID`
 * @returns {{done: boolean, detail: string}}
 */
function selfTestDeactivateSpecialSunday_(specialId) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) return { done: false, detail: '找不到 SpecialSundays 工作表' };

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const idCol = headers.indexOf(S.SPECIAL_ID) + 1;
  const activeCol = headers.indexOf(S.ACTIVE) + 1;
  if (idCol <= 0 || activeCol <= 0) {
    return { done: false, detail: '找不到 SpecialID 或 Active 欄' };
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return { done: false, detail: 'SpecialSundays 沒有資料行' };
  const ids = sheet.getRange(3, idCol, lastRow - 2, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() !== specialId) continue;
    sheet.getRange(i + 3, activeCol).setValue('FALSE');
    return { done: true, detail: specialId + ' 已設成 Active=FALSE（第 ' + (i + 3) + ' 行，沒有刪除）' };
  }
  return { done: false, detail: '找不到 ' + specialId + ' 這一行' };
}

/**
 * S16：認唔出嘅名 ⇒ 整批拒絕，而且講得出係邊幾格。
 *
 * ⚠️ 第五十一輪批次 A3 組：**呢一條一定要排喺最後，而且一定要自己收拾。**
 *
 * 第五十輪嗰次，S03 順手種咗三格認唔出嘅字，而系統嘅規矩係
 *「有認唔出嘅名就乜都唔准做」——於是 S04 到 S13 九條連環倒。
 *
 * 「認唔出嘅名點處理」本身係一個**值得驗**嘅情境，但佢要獨立跑，
 * 而且跑完要把現場還原。放喺中間就會污染後面每一條。
 */
function selfTestS16_(quarterId) {
  const t = selfTestCollector_('S16');
  const versionNo = findLatestVersionNo(quarterId);
  const cells = selfTestPickCells_(quarterId, versionNo, 1);
  if (cells.length === 0) {
    t.expect('找得到一格有人的來改', false, '≥ 1 格', '0 格',
      'selfTestPickCells_()');
    return t.result();
  }
  const cell = cells[0];

  // 記低原本嗰格係咩，收拾嗰陣要寫返。
  const peopleById = indexPeopleById_();
  const originalName = (peopleById[cell.personId] || {}).nameTC || '';
  t.expect('（前置）拿得到那一格原本的人名，收拾時要寫回去',
    originalName !== '', '有人名', originalName || '（查不到）',
    'indexPeopleById_()[' + cell.personId + ']');

  const versionsBefore = findLatestVersionNo(quarterId);
  const wrote = selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate,
    cell.postId, cell.slotIndex, '一個系統認不出的名字');
  t.expect('那一格真的寫進 grid', wrote, '寫得到', String(wrote),
    cell.serviceDate + '　' + cell.postId);

  const d = selfTestCall_('S16', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.expect('系統認得出這一格是「認不出」的',
    (d.unsaved || {}).unresolvedCount > 0, '> 0',
    String((d.unsaved || {}).unresolvedCount), JSON.stringify(d.unsaved));

  // ── 叫儲存 ⇒ 要被整批拒絕 ──────────────────────────────────
  let threw = '';
  let planBlocked = null;
  try {
    planBlocked = selfTestCall_('S16', 'apiSaveAndConfirmPlan',
      function () { return apiSaveAndConfirmPlan(quarterId); });
    selfTestCall_('S16', 'apiSaveAndConfirmExecute',
      function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });
  } catch (err) {
    threw = err.message;
  }

  t.expect('儲存被拒絕（整批，不是只跳過那一格）'
    + '——只跳過那一格的話，幹事會以為那一格儲存好了',
    threw !== '' || (planBlocked && planBlocked.blocked === true),
    '被拒絕', threw || JSON.stringify(planBlocked).slice(0, 200),
    'apiSaveAndConfirmPlan()／apiSaveAndConfirmExecute()');

  const message = threw || String((planBlocked || {}).message || '');
  t.expect('訊息講得出是哪一格',
    message.indexOf(cell.serviceDate) !== -1 || message.indexOf(cell.postId) !== -1,
    '提到日期或崗位', message.slice(0, 200),
    '拒絕的訊息本身');
  t.expect('訊息講得出那一格現在是什麼字',
    message.indexOf('一個系統認不出的名字') !== -1,
    '提到格內現在的字', message.slice(0, 300),
    '拒絕的訊息本身');

  t.equal('職事表沒有任何改動（版本數沒有增加）',
    findLatestVersionNo(quarterId), versionsBefore,
    'findLatestVersionNo()：拒絕之前 v' + versionsBefore);

  // ── ⚠️ 自己收拾 ────────────────────────────────────────────
  //
  // 唔收拾嘅話，下一次「只重跑紅色情境」就會喺一個污染狀態下開始，
  // 而嗰種紅同系統無關。
  selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate,
    cell.postId, cell.slotIndex, originalName);
  const after = selfTestCall_('S16', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('收拾之後 unresolvedCount 回到 0'
    + '——這一條不通過的話，下一次執行會在一個污染狀態下開始',
    (after.unsaved || {}).unresolvedCount, 0,
    JSON.stringify(after.unsaved));
  return t.result();
}

/**
 * 第五十輪批次 D2 組：**呢一季而家係咪「全新」？**
 *
 * ⚠️ **直接查，唔可以用一個 flag 記住「今次有冇重設過」。**
 *
 * 記住嘅嘢會同真實狀態分岔——呢個專案已經因為呢一類問題食過幾次虧
 *（第十九輪讀錯來源、第四十六輪兩個算法、第四十七輪 header 同表分家）。
 * 而且「重設過」同「而家係全新」根本唔係同一件事：
 * 重設完之後跑咗 S02，個季度就唔再全新，而 flag 仲係話「重設過」。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{fresh: boolean, reason: string}}
 */
function isSelfTestQuarterFresh_(quarterId) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo >= 0) {
    return { fresh: false, reason: '這一季已經有 v' + versionNo + '。' };
  }
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return String(r[A.QUARTER_ID] || '').trim() === quarterId;
  });
  if (rows.length > 0) {
    return { fresh: false, reason: '這一季還有 ' + rows.length + ' 行派工紀錄。' };
  }
  return { fresh: true, reason: '' };
}

/**
 * 全部情境嘅登記表。
 *
 * ⚠️ 次序有意思：後面嗰個情境靠前面嗰個造出嚟嘅狀態。
 * 所以 `S05` 單獨重跑會失敗——嗰個係**預期之內**，
 * 而報告上面會講明「呢一批要由 S01 順住跑」。
 *
 * @returns {Array<{id: string, title: string, run: Function}>}
 */
function selfTestScenarios_() {
  return [
    // ⚠️ 第五十一輪批次 D1 組：`dependsOn` ——依賴嗰個紅咗，
    // 呢一個標 `BLOCKED`（唔係紅），註記寫「被 SXX 擋住，沒有跑」。
    //
    // ⚠️ 第五十一輪批次 C3 組：**次序 ≠ 編號。**
    //
    // S14／S15 排咗上嚟 S02 之後。理由：S14 要重新生成，而「進階功能 ▸
    // 重新生成初稿（覆蓋式）」嗰條路（`apiGenerateRoster()`）有
    // `requireQuarterStage_([DRAFT])`——跑到 S09 之後 Stage 係
    // `OFFICIAL_SENT`，嗰陣一定被擋。
    //
    // 編號冇改，因為 `SelfTestState` 同前幾輪嘅文件都用緊嗰幾個編號。
    // 報告會按**執行次序**印，並且喺開頭講明呢一點。
    { id: 'S01', title: '空季度：generate 之前 dashboard 講什麼', run: selfTestS01_,
      requiresFreshQuarter: true },
    { id: 'S02', title: '生成初稿', run: selfTestS02_ },
    { id: 'S14', title: '特殊主日 SkipPostIDs 生效（要 Stage=DRAFT，所以排在這裡）',
      run: selfTestS14_, dependsOn: ['S02'] },
    { id: 'S15', title: '未確認的特殊主日數得到（並且收拾 S14 種下的那一行）',
      run: selfTestS15_, dependsOn: ['S14'] },
    { id: 'S03', title: '改 grid 3 格（真的寫工作表，寫系統認得出的名）',
      run: selfTestS03_, dependsOn: ['S02'] },
    { id: 'S04', title: '有未儲存改動之下開寄出（第四十七輪那個死碼）',
      run: selfTestS04_, dependsOn: ['S03'] },
    { id: 'S05', title: '儲存並確認', run: selfTestS05_, dependsOn: ['S03'] },
    { id: 'S06', title: '寄給堂委審閱（DRY_RUN）', run: selfTestS06_,
      dependsOn: ['S05'] },
    { id: 'S07', title: '寫 3 筆申報 → 套用', run: selfTestS07_,
      dependsOn: ['S06'] },
    { id: 'S08', title: '產生個人 PDF', run: selfTestS08_, dependsOn: ['S05'] },
    { id: 'S09', title: '正式發出（DRY_RUN）', run: selfTestS09_,
      dependsOn: ['S07', 'S08'] },
    { id: 'S10', title: '改 2 格 → 儲存 → 改動後重發', run: selfTestS10_,
      dependsOn: ['S09'] },
    { id: 'S11', title: '再撳一次正式發出 ⇒ 要被擋住，而且講得出原因',
      run: selfTestS11_, dependsOn: ['S09'] },
    { id: 'S12', title: '回到上一個儲存版本（只看預覽，不執行）',
      run: selfTestS12_, dependsOn: ['S05'] },
    { id: 'S13', title: '下載及匯出：整季 PDF', run: selfTestS13_,
      dependsOn: ['S05'] },
    // ⚠️ S16 一定要排喺最後，而且佢自己收拾。放中間會污染後面每一條。
    { id: 'S16', title: '認不出的名字：整批拒絕，而且講得出是哪幾格',
      run: selfTestS16_, dependsOn: ['S05'] },
    // ⚠️ 第五十三輪批次 B 組：S17 排喺 S16 之後，一樣自己收拾。
    //
    // 「有硬規則違反、要打字放行」嗰條路同「乾淨儲存」一樣重要
    //（幹事真實會遇到——名單未更新嗰陣就會撞到），
    // 但佢**唔可以擋住主流程**。所以佢自己一條，排喺最後。
    { id: 'S17', title: '硬規則違反：要打字放行才儲存得到（自己收拾）',
      run: selfTestS17_, dependsOn: ['S05'] }
  ];
}

/**
 * 第五十三輪批次 B 組：揀一格，**而且揀一個一定會違反硬規則嘅人**。
 *
 * ⚠️ 呢一支係 `selfTestPickSafeCells_()` 嘅反面，而且**特登**噉樣做。
 *
 * 「有硬規則違反、要打字放行」嗰條路同「乾淨儲存」一樣重要——
 * 幹事真實會遇到（名單未更新嗰陣就會撞到）。
 * 但佢**唔可以擋住主流程**，所以佢自己一條情境，排喺最後，
 * 而且跑完自己收拾。
 *
 * ⚠️ 同樣唔自己判斷「合唔合資格」——問系統本身嗰一支
 * `findStateViolations_()`：換咗個人之後，係咪**啱啱多咗一條 HARD**？
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object|null} `{serviceDate, postId, slotIndex, personId,
 *   originalName, replacement: {personId, name}, ruleId}`；揀唔到就 null
 */
function selfTestPickViolatingCell_(quarterId, versionNo) {
  const context = buildFineTuneContext_(quarterId, versionNo);
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'selfTestPickViolatingCell_');
  const baseState = resolved.state;

  const known = {};
  findStateViolations_(baseState, context).forEach(function (v) {
    known[selfTestViolationKey_(v)] = true;
  });

  const byPost = (context.eligibility || {}).byPost || {};
  const peopleById = context.peopleById || {};
  let tries = 0;

  for (let i = 0; i < baseState.length; i++) {
    const cell = baseState[i];
    if (!cell.personId) continue;
    const pool = byPost[cell.postId] || [];
    // 揀一個**唔喺呢個崗位名單上面**嘅人 ⇒ HARD_ELIGIBILITY。
    const candidates = Object.keys(peopleById).filter(function (id) {
      return id !== cell.personId && peopleById[id].nameTC && pool.indexOf(id) === -1;
    });

    for (let j = 0; j < candidates.length; j++) {
      if (tries >= SELFTEST_VIOLATING_PICK_MAX_TRIES) return null;
      tries++;
      const candidateId = candidates[j];
      const next = baseState.map(function (sc) {
        if (sc.serviceDate !== cell.serviceDate || sc.postId !== cell.postId
          || String(sc.slotIndex) !== String(cell.slotIndex)) return sc;
        return {
          serviceDateId: sc.serviceDateId, serviceDate: sc.serviceDate,
          postId: sc.postId, slotIndex: sc.slotIndex,
          personId: candidateId, isManual: true
        };
      });
      const added = findStateViolations_(next, context).filter(function (v) {
        return !known[selfTestViolationKey_(v)];
      });
      // ⚠️ 要**啱啱一條**，而且要係 HARD。多過一條就唔知係邊條攔住，
      // 而一條 SEMI_HARD 根本唔會要求打字放行。
      if (added.length === 1 && added[0].severity === RULE_LEVELS.HARD
        && added[0].serviceDate === cell.serviceDate
        && added[0].postId === cell.postId) {
        return {
          serviceDate: cell.serviceDate, postId: cell.postId,
          slotIndex: cell.slotIndex, personId: cell.personId,
          originalName: (peopleById[cell.personId] || {}).nameTC || '',
          replacement: { personId: candidateId, name: peopleById[candidateId].nameTC },
          ruleId: added[0].ruleId
        };
      }
    }
  }
  return null;
}

/**
 * S17：硬規則違反——要打字放行先儲存得到。
 *
 * ⚠️ **排喺最後，而且自己收拾。** 放中間又會污染後面——
 * S16 已經因為同一個道理排到最後。
 *
 * 現場（第五十二輪）：S03 揀咗一格唔合資格嘅人，S05 就係喺呢一句拋錯：
 *
 *     有 1 格違反了一定要遵守的規則，需要你打字放行才能儲存。
 *
 * 嗰次系統攔得啱，錯嘅係測試。而「攔得啱」本身值得有一條情境守住。
 */
function selfTestS17_(quarterId) {
  const t = selfTestCollector_('S17');
  const versionNo = findLatestVersionNo(quarterId);
  const target = selfTestPickViolatingCell_(quarterId, versionNo);
  if (!target) {
    return t.skip('（跳過）這一季找不到「改一格就剛好違反一條硬規則」的格，'
      + '所以造不出打字放行這個情境。');
  }

  // ── 1　故意填一個不合資格的人 ────────────────────────────────
  const wrote = selfTestWriteGridCell_(quarterId, versionNo, target.serviceDate,
    target.postId, target.slotIndex, target.replacement.name);
  t.expect('那一格真的寫進 grid（故意填一個該崗位不合資格的人）',
    wrote, '寫得到', String(wrote),
    target.serviceDate + '　' + target.postId + '　'
      + target.originalName + ' ⇒ ' + target.replacement.name
      + '（預期違反 ' + target.ruleId + '）');

  const plan = selfTestCall_('S17', 'apiSaveAndConfirmPlan',
    function () { return apiSaveAndConfirmPlan(quarterId); });
  t.expect('系統認得出這是一條硬規則違反，而且要求打字放行',
    plan.needsRelease === true, 'needsRelease=true', String(plan.needsRelease),
    'apiSaveAndConfirmPlan().violations.real＝'
      + JSON.stringify((plan.violations || {}).real || []).slice(0, 500));

  // ── 2　直接儲存 ⇒ 要被拒絕，而且講得出是哪一格、哪一條規則 ──
  let refused = '';
  try {
    selfTestCall_('S17', 'apiSaveAndConfirmExecute（不帶放行字眼）',
      function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });
  } catch (err) {
    refused = err.message;
  }
  t.expect('不帶放行字眼就儲存 ⇒ 被拒絕', refused !== '',
    '被拒絕', refused || '（居然存到了）',
    'apiSaveAndConfirmExecute(quarterId, {decisions: []})');
  t.expect('而且訊息講得出有幾多格違反',
    /違反了一定要遵守的規則/.test(refused), '有這一句',
    refused.slice(0, 300), '拒絕訊息原文');
  t.expect('而且講得出「職事表沒有任何改動」——'
    + '不講的話，幹事不知道現在到底存了沒有',
    /職事表沒有任何改動/.test(refused), '有這一句',
    refused.slice(0, 300), '拒絕訊息原文');
  t.expect('而且講得出要輸入什麼才放行得到',
    refused.indexOf(SAVE_CONFIRM_RELEASE_TEXT) >= 0,
    '訊息裡面有「' + SAVE_CONFIRM_RELEASE_TEXT + '」',
    refused.slice(0, 300), '拒絕訊息原文');

  const stillAt = findLatestVersionNo(quarterId);
  t.equal('被拒絕之後，版本號沒有變——說「沒有任何改動」就真的不可以有',
    stillAt, versionNo, 'findLatestVersionNo()');

  // ── 3　帶住放行字眼再叫一次 ⇒ 存得到 ────────────────────────
  let released = null;
  let releaseThrew = '';
  try {
    released = selfTestCall_('S17', 'apiSaveAndConfirmExecute（帶放行字眼）',
      function () {
        return apiSaveAndConfirmExecute(quarterId,
          { decisions: [], releaseText: SAVE_CONFIRM_RELEASE_TEXT });
      });
  } catch (err) {
    releaseThrew = err.message;
  }
  t.expect('帶住放行字眼再叫一次 ⇒ 存得到',
    releaseThrew === '' && !!released, '存得到',
    releaseThrew || JSON.stringify(released).slice(0, 400),
    'apiSaveAndConfirmExecute(quarterId, {decisions: [], releaseText: "'
      + SAVE_CONFIRM_RELEASE_TEXT + '"})');
  const afterRelease = findLatestVersionNo(quarterId);
  t.expect('而且真的多了一版', afterRelease > versionNo,
    '> ' + versionNo, String(afterRelease), 'findLatestVersionNo()');

  // ── 4　AuditLog 要記低放行了幾多格 ──────────────────────────
  //
  // ⚠️ 沒有這一筆的話，一個違反了硬規則、由人手放行的版本，
  // 事後**沒有任何方法分得出它同一個乾淨版本的分別**。
  const A = COLUMNS.AUDIT_LOG;
  const releaseRows = readSheet(SHEETS.AUDIT_LOG).filter(function (r) {
    return String(r[A.ACTION] || '').trim() === '放行硬規則違反'
      && String(r[A.TARGET_KEY] || '').indexOf(quarterId) >= 0;
  });
  t.expect('AuditLog 記低了這一次放行', releaseRows.length > 0,
    '≥ 1 筆', releaseRows.length + ' 筆',
    'AuditLog 裡面 Action=「放行硬規則違反」而且 TargetKey 有 ' + quarterId + ' 的');
  t.expect('而且講得出放行了幾多格',
    releaseRows.some(function (r) {
      // ⚠️ 用 `indexOf()` 唔用正則——`tools/lint-undeclared.js`
      // 會把 `/… \d+ …/` 讀成除法，然後報一個叫 `d` 嘅未宣告變數。
      const v = String(r[A.NEW_VALUE] || '');
      return v.indexOf('放行了 ') === 0 && v.indexOf(' 格規則違反') > 0;
    }), '有「放行了 N 格規則違反」',
    releaseRows.map(function (r) { return String(r[A.NEW_VALUE] || ''); }).join('；'),
    'AuditLog.NewValue');

  // ── 5　自己收拾 ─────────────────────────────────────────────
  //
  // ⚠️ 把那一格改回原本的人，再乾淨儲存一次。
  // 不收拾的話，這一季就永遠帶住一格違反，而下一次重跑
  // 每一條情境都會見到它。
  const newVersionNo = findLatestVersionNo(quarterId);
  let cleaned = false;
  let cleanupNote = '';
  try {
    selfTestWriteGridCell_(quarterId, newVersionNo, target.serviceDate,
      target.postId, target.slotIndex, target.originalName);
    apiSaveAndConfirmExecute(quarterId, { decisions: [] });
    cleaned = true;
  } catch (err) {
    cleanupNote = err.message;
  }
  t.expect('收拾：把那一格改回原本的人，並且乾淨儲存一次',
    cleaned, '收拾得到', cleanupNote || '收拾得到',
    target.serviceDate + '　' + target.postId + '　⇒ ' + target.originalName);

  const after = selfTestCall_('S17', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('收拾完之後，未儲存格數回到 0',
    (after.unsaved || {}).gridChangeCount, 0,
    'apiGetDashboardState().unsaved＝' + JSON.stringify(after.unsaved));

  const finalPlan = selfTestCall_('S17', 'apiSaveAndConfirmPlan（收拾之後）',
    function () { return apiSaveAndConfirmPlan(quarterId); });
  t.equal('而且再沒有硬規則違反留低',
    ((finalPlan.violations || {}).real || []).length, 0,
    'apiSaveAndConfirmPlan().violations.real');
  return t.result();
}

/* ═════════════════════════════════════════════════════════════════════
 * 執行時間、狀態、續跑
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 第五十三輪批次：呢一次執行入面，每條情境叫過嘅 API 同佢回咗乜。
 * 由 `runSelfTestMachine_()` 開跑嗰陣清空，`selfTestRecordPayload_()` 填。
 */
let selfTestPayloads_ = {};

/** 呢一次執行嘅開始時間（毫秒）。由 `runSelfTestMachine_()` 設。 */
let selfTestStartedAt_ = 0;

/**
 * 時間夠唔夠再跑一個情境？
 *
 * ⚠️ 時間到要**乾淨噉停低並講明**。靜靜停低就會變成
 * 「跑完了，全綠」嘅假象——而嗰個假象比冇跑過更差。
 *
 * @returns {boolean} 已經超出預算就 true
 */
function selfTestOutOfTime_() {
  if (!selfTestStartedAt_) return false;
  return (new Date().getTime() - selfTestStartedAt_) > SELFTEST_TIME_BUDGET_MS;
}

/**
 * 讀返上一次跑到邊。
 * @returns {Object.<string, Object>} 情境 ID → 結果摘要
 */
function readSelfTestState_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SELFTEST_SHEETS.STATE);
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  // ⚠️ 第五十三輪批次 C1 組：多咗「跑過幾次」同「連續相同結果」兩欄。
  // 舊表得 5 欄一樣讀得返（讀出嚟係 undefined，下面當 0）。
  const lastCol = Math.max(4, sheet.getLastColumn());
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = {};
  values.forEach(function (row) {
    const id = String(row[0] || '').trim();
    if (!id) return;
    // ⚠️ 第五十輪批次 A1 組：**連證據一齊讀返。**
    //
    // 跳過一個紅色情境嗰陣，報告仍然要印得出「邊一條斷言紅咗、
    // 預期幾多、實際幾多」。冇咗證據，一個「跳過」嘅紅色情境
    // 就變成一句冇內容嘅「紅」——而嗰個等於冇報告過。
    let detail = { failedChecks: [], invariantDetail: [], fingerprint: '' };
    try {
      const raw = String(row[3] || '');
      if (raw) detail = JSON.parse(raw);
    } catch (err) {
      // 讀唔返就當冇證據，唔可以令成個續跑爆。
      log_('WARN', 'SelfTestState 的證據欄讀不回來（' + id + '）：' + err.message);
    }
    out[id] = {
      id: id, status: String(row[1] || ''), summary: String(row[2] || ''),
      failedChecks: detail.failedChecks || [],
      invariantDetail: detail.invariantDetail || [],
      payloads: detail.payloads || [],
      // 第五十三輪批次 C1 組：跑過幾次、連續幾多次同一個結果。
      fingerprint: detail.fingerprint || '',
      runCount: Number(row[5]) || 0,
      sameStreak: Number(row[6]) || 0
    };
  });
  return out;
}

/**
 * 寫低跑到邊。**每一個情境跑完即刻寫一次**——
 * 唔可以等成批跑完先寫：中途被系統斬斷嘅話，就乜都冇。
 *
 * @param {Object.<string, Object>} state 全部情境嘅結果
 * @returns {void}
 */
function writeSelfTestState_(state) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SELFTEST_SHEETS.STATE);
  if (!sheet) {
    sheet = ss.insertSheet(SELFTEST_SHEETS.STATE);
  }
  sheet.clear();
  sheet.appendRow(['情境', '結果', '摘要', '證據（JSON）', '更新於',
    '跑過幾次', '連續相同結果']);
  sheet.setFrozenRows(1);
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const now = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
  Object.keys(state).sort().forEach(function (id) {
    let evidence = '';
    try {
      evidence = JSON.stringify({
        failedChecks: state[id].failedChecks || [],
        invariantDetail: state[id].invariantDetail || [],
        payloads: state[id].payloads || [],
        fingerprint: state[id].fingerprint || ''
      });
      // 一格上限 50,000 字元。爆咗就只記一句，唔好令成次寫入失敗。
      if (evidence.length > 45000) evidence = '（證據太長，已略去；見 SelfTestReport）';
    } catch (err) {
      evidence = '（證據寫不出來：' + err.message + '）';
    }
    sheet.appendRow([id, state[id].status, state[id].summary, evidence, now,
      Number(state[id].runCount) || 0, Number(state[id].sameStreak) || 0]);
  });
}

/**
 * 第五十輪批次 A2 組：把紅色情境由狀態表清走，等佢哋下一次會重跑。
 *
 * ⚠️ **唔會重設沙盒季度。** 呢個入口嘅意思就係「保留現場，只重跑嗰幾個」
 * ——修好咗一樣嘢之後，唔使把成季清晒重頭嚟。
 *
 * @param {Object.<string, Object>} state 現有狀態
 * @returns {{state: Object, clearedIds: string[]}}
 */
function clearFailedSelfTestState_(state) {
  const kept = {};
  const clearedIds = [];
  Object.keys(state || {}).forEach(function (id) {
    const status = state[id].status;
    // ⚠️ 第五十一輪批次 D3 組：**`BLOCKED` 都要清走。**
    //
    // 唔清嘅話，修好上游之後，被擋住嗰幾條仍然唔會跑——
    // 而嗰幾條先係整件事嘅重點。
    if (status === SELFTEST_STATUS.FAILED || status === SELFTEST_STATUS.ERROR
        || status === SELFTEST_STATUS.BLOCKED) {
      clearedIds.push(id);
      return;
    }
    kept[id] = state[id];
  });
  return { state: kept, clearedIds: clearedIds };
}

/* ═════════════════════════════════════════════════════════════════════
 * 主流程
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 第五十二輪批次 B 組：**影低此刻邊幾條快嘅不變量係紅嘅。**
 *
 * ⚠️ 為咩要影：舊寫法係「情境跑完，快嘅不變量有一條紅 ⇒ 呢個情境紅」。
 * 但不變量係**成個季度嘅性質**，唔係呢個情境嘅產物。
 * 一條喺開跑之前就已經紅嘅不變量，會令**之後每一個情境**都紅，
 * 而每一個紅嘅情境又會經 `dependsOn` 把下游標成 `BLOCKED`。
 *
 * 現場：一條既有嘅不變量失敗，令 13 條情境一條都跑唔到——
 * 而報告上面睇落好似有 13 個地方壞咗。
 *
 * ⚠️ 呢一支**唔判斷邊個嘅責任**，凈係影相。歸咎喺呼叫嗰邊做。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} `{map, error}`；`map` 是 `{不變量 ID: 一行證據}`，
 *   `error` 是影唔到相時的錯誤原文（此時 `map` 是空的）
 */
function snapshotFailingInvariants_(quarterId) {
  const map = {};
  try {
    const inv = runAllInvariants_(quarterId, INVARIANT_SET.PER_SCENARIO);
    inv.results.forEach(function (r) {
      if (r.status === INVARIANT_STATUS.FAILED || r.status === INVARIANT_STATUS.ERROR) {
        map[r.id] = r.id + '｜預期 ' + r.expected + '｜實際 ' + r.actual + '｜' + r.evidence;
      }
    });
    return { map: map, error: '' };
  } catch (err) {
    // ⚠️ 影唔到相 ⇒ **唔可以當成「乜都冇紅」**。當成冇紅嘅話，
    // 一條既有嘅失敗會被算落第一個情境頭上——即係呢一組要修嗰件事。
    return { map: {}, error: err.message };
  }
}

/**
 * 跑自測機。
 *
 * @param {boolean} resume true ＝ 由上一次停低嘅地方接住；
 *   false ＝ 由頭開始（會先清乾淨沙盒季度）
 * @returns {Object} 報告
 */
function runSelfTestMachine_(resume, rerunFailedOnly) {
  selfTestStartedAt_ = new Date().getTime();
  selfTestPayloads_ = {};

  const quarter = readSelfTestQuarterDetail_();
  const quarterId = quarter.value;

  const gate = checkSelfTestPreconditions_(quarterId);
  if (!gate.ok) {
    return {
      blocked: true, quarterId: quarterId, quarterSource: quarter.source,
      reasons: gate.reasons, results: [], invariants: null
    };
  }

  // ── 第五十三輪批次 C1 組：先讀返「呢一條跑過幾次」 ──────────
  //
  // ⚠️ **唔理今次係咪續跑都要讀。** 「只重跑紅色情境」會把紅嗰幾條
  // 由 `state` 清走，而嗰幾條正正就係要數次數嗰幾條。
  // 由頭跑一次亦都要讀——一條連沙盒清乾淨都仲係紅嘅情境，
  // 係更強嘅證據，唔係更弱。
  const priorHistory = {};
  try {
    const persisted = readSelfTestState_();
    Object.keys(persisted).forEach(function (id) {
      priorHistory[id] = {
        runCount: Number(persisted[id].runCount) || 0,
        sameStreak: Number(persisted[id].sameStreak) || 0,
        fingerprint: String(persisted[id].fingerprint || '')
      };
    });
  } catch (err) {
    // 讀唔到就由零數起，唔可以令成次執行爆。
    log_('WARN', '讀不回 SelfTestState 的重跑次數：' + err.message);
  }

  /**
   * 第五十四輪批次 B 組：**次數要跨越每一條寫入路徑保留。**
   *
   * ⚠️⚠️ 現場：S05 至少紅咗四次，但報告從來冇出過
   * 「⛔ 呢一條已經重跑 N 次」嗰一句。
   *
   * 查出嚟嘅原因唔係 `clearFailedSelfTestState_()`——嗰邊已經冇事，
   * `priorHistory` 喺清除**之前**就讀咗。真正嘅漏喺下面三條路：
   *
   *   `BLOCKED`　　被上游擋住　⇒ 寫 state 嗰陣冇帶次數 ⇒ 歸零
   *   `SKIPPED`　　前置唔啱　　⇒ 同上
   *   `NOT_RUN`　　時間到　　　⇒ 同上
   *
   * 而 S05 嘅實況正正就係第一條：S03 紅咗，S05 被標 `BLOCKED`，
   * 於是佢每一次都由零數起——**永遠數唔到 2**。
   *
   * ⚠️ 清結論，唔清次數。
   *
   * @param {string} id 情境 ID
   * @returns {Object} `{runCount, sameStreak, fingerprint}`
   */
  const carryHistory = function (id) {
    const h = priorHistory[id] || {};
    return {
      runCount: Number(h.runCount) || 0,
      sameStreak: Number(h.sameStreak) || 0,
      fingerprint: String(h.fingerprint || '')
    };
  };

  let state = resume ? readSelfTestState_() : {};
  // 第五十輪批次 A2 組：只重跑紅色 ⇒ 把紅嗰幾個由狀態表清走，
  // 其餘照 resume 模式跳過。
  let rerunIds = [];
  if (resume && rerunFailedOnly) {
    const cleared = clearFailedSelfTestState_(state);
    state = cleared.state;
    rerunIds = cleared.clearedIds;
  }

  // ── 由頭開始 ⇒ 先清乾淨 ─────────────────────────────────────
  //
  // ⚠️ 每一次都由同一個起點開始，結果先至可以重覆。
  // 唔清嘅話，上一次跑剩嘅嘢會令今次嘅斷言時綠時紅，
  // 而冇人分得出係程式壞咗定係上一次留低嘅垃圾。
  let resetSummary = '（續跑，沒有重設）';
  if (!resume) {
    try {
      const plan = planQuarterReset_(quarterId, true);
      const result = executeQuarterReset_(plan);
      resetSummary = '已清乾淨：版本 ' + result.versionRowsDeleted + ' 行、'
        + '派工 ' + result.assignmentRowsDeleted + ' 行、'
        + 'SendLog ' + result.sendLogRowsDeleted + ' 行';
    } catch (err) {
      return {
        blocked: true, quarterId: quarterId, quarterSource: quarter.source,
        reasons: ['清理沙盒季度失敗，沒有跑任何情境：' + err.message],
        results: [], invariants: null
      };
    }
  }

  // ── 開跑之前，先影一次底相 ──────────────────────────────────
  //
  // 第五十二輪批次 B2 組：**要分得出「呢個情境整紅嘅」同「本來就紅」。**
  //
  // ⚠️ 呢一張底相之後唔會再重新影。每一個情境跑完會影多一次，
  // 而**上一個情境嘅事後相，就係下一個情境嘅事前相**——
  // 所以逐個情境嘅歸咎唔使額外跑多一次不變量，一蚊都唔使多畀。
  //（開跑呢一次係唯一嗰次額外開支，全程只影一次。）
  const baseline = snapshotFailingInvariants_(quarterId);
  let knownFailing = baseline.map;
  const startupFailures = Object.keys(baseline.map).map(function (id) {
    return baseline.map[id];
  });

  // ── 逐個情境 ────────────────────────────────────────────────
  const results = [];
  let stoppedForTime = false;
  // 第五十輪批次 B3 組：時間要講得出用喺邊。
  // 冇呢一行，下次再卡住又要由零查一次。
  let invariantMs = 0;
  const runStartedAt = new Date().getTime();
  // 逐條記低結果，畀 `dependsOn` 查。
  // ⚠️ 由 `state` 起頭——續跑嗰陣上一次嘅結論都算數，
  // 否則一個「上一次紅、今次跳過」嘅上游就唔會擋到下游。
  const byId = {};
  Object.keys(state).forEach(function (id) { byId[id] = state[id]; });
  selfTestScenarios_().forEach(function (scenario) {
    const previous = state[scenario.id];

    // ── 第五十輪批次 A1 組：**跳過「已經有結論」嘅，唔係只跳過通過嘅** ──
    //
    // ⚠️⚠️ 舊寫法係 `previous.status === PASSED`，即係**只有通過先跳過**。
    //
    // 後果係一個**結構性死鎖**：
    //   S01 紅 → 續跑時 S01 重新執行 → 加上每個情境跑完要跑全套不變量
    //   → 兩個情境食晒時間預算 → S03 之後又標成「未跑」
    //   → 下一次續跑再重複同一件事。
    //
    // 現場：Ivan 撳咗三次，三次報告一模一樣，S03–S15 永遠「未跑」。
    // 而後面嗰十三個先至係呢部機器存在嘅理由。
    //
    // ⚠️ 跳過嘅時候要**照樣顯示上一次嗰個結論**——
    // 紅就仍然係紅、帶住上次嘅證據。**唔可以**因為今次冇跑就顯示成
    //「通過」或者「未跑」：前者係講大話，後者會令佢再撳一次續跑，
    // 而再撳一次一樣係呢個結果。
    const settled = previous && (
      previous.status === SELFTEST_STATUS.PASSED
      || previous.status === SELFTEST_STATUS.FAILED
      || previous.status === SELFTEST_STATUS.ERROR
      // 「跳過」都算有結論——續跑再跑一次一樣會跳過。
      || previous.status === SELFTEST_STATUS.SKIPPED);
    if (resume && settled) {
      byId[scenario.id] = previous;
      results.push({
        id: scenario.id, title: scenario.title,
        status: previous.status,
        checks: [],
        // 上一次嗰幾條失敗斷言由 `SelfTestState` 讀返——
        // 冇咗佢，一個「跳過」嘅紅色情境就會冇晒證據。
        failedChecks: previous.failedChecks || [],
        invariantDetail: previous.invariantDetail || [],
        payloads: previous.payloads || [],
        // ⚠️ 上一次嗰個次數要照樣帶出嚟，否則一條「上一次紅、
        // 今次跳過」嘅情境喺報告上面就唔會有「唔好再撳」嗰一句。
        repeat: {
          runCount: Number(previous.runCount) || 0,
          sameStreak: Number(previous.sameStreak) || 0
        },
        note: '（上一次已經有結論：'
          + (previous.status === SELFTEST_STATUS.PASSED ? '綠'
            : (previous.status === SELFTEST_STATUS.SKIPPED ? '跳過' : '紅'))
          + '，這一次不再跑）'
      });
      return;
    }
    // ── 第五十一輪批次 D1 組：上游紅咗 ⇒ `BLOCKED`（唔係紅）──────
    //
    // ⚠️ 一個根因報成八條紅，會令報告睇落比實際嚴重好多，
    // 而下一次紅嘅數目一多就冇人睇得落去。
    const blockedBy = (scenario.dependsOn || []).filter(function (dep) {
      const r = byId[dep];
      return r && (r.status === SELFTEST_STATUS.FAILED
        || r.status === SELFTEST_STATUS.ERROR
        || r.status === SELFTEST_STATUS.BLOCKED);
    });
    if (blockedBy.length > 0) {
      const outcome = {
        id: scenario.id, title: scenario.title,
        status: SELFTEST_STATUS.BLOCKED, checks: [], failedChecks: [],
        note: '（被 ' + blockedBy.join('、') + ' 擋住，沒有跑。'
          + '修好上游之後撳「▶️ 只重跑紅色情境」就會跑。）'
      };
      results.push(outcome);
      byId[scenario.id] = outcome;
      // ⚠️ 第五十四輪批次 B 組：被擋住**唔可以令次數歸零**。
      // S05 就係噉：S03 紅咗、S05 被擋住，於是佢每次都由零數起。
      //
      // ⚠️ 用一個本地變數，唔喺下面直接寫屬性存取。
      // `tools/scan-staged-secrets.js` 會把「字串入面嘅 `物件.屬性`」
      // 當成一個國碼頂級網域——而 `verify-red.js` 引用呢一行嗰陣就會被擋。
      const blockedId = scenario.id;
      const blockedHistory = carryHistory(blockedId);
      state[blockedId] = Object.assign({
        id: blockedId, status: SELFTEST_STATUS.BLOCKED,
        summary: '被 ' + blockedBy.join('、') + ' 擋住',
        failedChecks: [], invariantDetail: []
      }, blockedHistory);
      outcome.repeat = {
        runCount: blockedHistory.runCount,
        sameStreak: blockedHistory.sameStreak
      };
      try { writeSelfTestState_(state); } catch (err) {
        log_('WARN', '寫 SelfTestState 失敗：' + err.message);
      }
      return;
    }

    // ── 第五十輪批次 D1 組：前置狀態唔啱 ⇒ `SKIPPED`（唔係紅）──
    if (scenario.requiresFreshQuarter) {
      let freshness = { fresh: true, reason: '' };
      try {
        freshness = isSelfTestQuarterFresh_(quarterId);
      } catch (err) {
        // 查唔到 ⇒ **唔可以當成「全新」**。當成全新就會喺一個
        // 唔知咩狀態嘅季度上面跑一個假設佢全新嘅情境。
        freshness = { fresh: false, reason: '查不到這一季的狀態：' + err.message };
      }
      if (!freshness.fresh) {
        byId[scenario.id] = { id: scenario.id, status: SELFTEST_STATUS.SKIPPED };
        results.push({
          id: scenario.id, title: scenario.title,
          status: SELFTEST_STATUS.SKIPPED, checks: [], failedChecks: [],
          note: '（這一個只在全新開跑時有意義。' + freshness.reason + '）'
        });
        state[scenario.id] = Object.assign({
          id: scenario.id, status: SELFTEST_STATUS.SKIPPED,
          summary: '跳過：' + freshness.reason,
          failedChecks: [], invariantDetail: []
        }, carryHistory(scenario.id));
        try { writeSelfTestState_(state); } catch (err) {
          log_('WARN', '寫 SelfTestState 失敗：' + err.message);
        }
        return;
      }
    }

    if (stoppedForTime || selfTestOutOfTime_()) {
      stoppedForTime = true;
      results.push({ id: scenario.id, title: scenario.title,
        status: SELFTEST_STATUS.NOT_RUN, checks: [], failedChecks: [],
        note: '（上一次執行時間到，已停低）' });
      state[scenario.id] = Object.assign(
        { id: scenario.id, status: SELFTEST_STATUS.NOT_RUN, summary: '未跑' },
        carryHistory(scenario.id));
      return;
    }

    let outcome;
    try {
      outcome = scenario.run(quarterId);
      outcome.title = scenario.title;
    } catch (err) {
      // ⚠️ 拋錯 ≠ 跳過。一個爆咗嘅情境要報 `ERROR`，
      // 而且要帶住實際錯誤原文——唔係只講一句「失敗」。
      // ⚠️ 用一個本地變數，唔喺字串拼接入面直接寫屬性存取。
      // `tools/scan-staged-secrets.js` 會把「字串入面嘅 `物件.屬性`」
      // 當成一個國碼頂級網域——而 `verify-red.js` 引用呢一行嗰陣就會被擋。
      const failedScenarioId = scenario.id;
      log_('ERROR', '自測機 ' + failedScenarioId + ' 拋錯：' + err.message);
      outcome = {
        id: scenario.id, title: scenario.title, status: SELFTEST_STATUS.ERROR,
        checks: [], failedChecks: [],
        error: err.message
      };
    }

    // ⚠️ 每一個情境跑完，都要叫一次不變量——**但只跑快嗰批**。
    //
    // 第五十輪批次 B1 組：舊寫法跑全套（I01–I10）。其中 I04 掃全表
    // 10,920 行、I08 每個登記數字要行一次完整 plan（一個情境六次）。
    // 15 個情境 × 全套 ＝ 6 分鐘內完全唔可能。
    //
    // 貴嗰幾條留到全部情境跑完之後先一次過跑（見下面 `finalInvariants`）。
    const invStartedAt = new Date().getTime();
    const after = snapshotFailingInvariants_(quarterId);
    if (after.error) {
      outcome.invariantFailed = -1;
      outcome.invariantDetail = ['不變量算不出來：' + after.error];
      outcome.status = SELFTEST_STATUS.ERROR;
    } else {
      // ── 第五十二輪批次 B3 組：**歸咎。** ──────────────────────
      //
      // 　本來綠、而家紅 ⇒ 呢個情境整嘅　　　　　　⇒ 算佢頭上
      // 　本來紅、而家仲紅 ⇒ 開跑之前就已經噉　　　⇒ **唔算佢頭上**
      // 　本來紅、而家綠 ⇒ 呢個情境順手整返好咗　　⇒ 講一句
      //
      // ⚠️ 中間嗰一行係成組嘅重點。一條既有嘅失敗會令之後
      // **每一個**情境都紅，而每一個紅嘅情境又會把下游標成 `BLOCKED`。
      // 一個根因，13 條跑唔到。
      const caused = [];
      const carried = [];
      Object.keys(after.map).forEach(function (id) {
        if (knownFailing[id]) { carried.push(id); } else { caused.push(after.map[id]); }
      });
      const healed = Object.keys(knownFailing).filter(function (id) {
        return !after.map[id];
      });

      outcome.invariantFailed = caused.length;
      outcome.invariantDetail = caused;
      outcome.invariantCarried = carried;
      if (carried.length > 0) {
        // ⚠️ 唔算佢頭上，但要講——完全唔提嘅話，一條開跑就紅嘅
        // 不變量會靜靜噉喺成份報告度消失。
        outcome.note = (outcome.note ? outcome.note + ' ' : '')
          + '（跑的時候 ' + carried.join('、') + ' 仍然是紅的，'
          + '但那是開跑之前就已經這樣，不算在這一條頭上。'
          + '詳情見報告開頭。）';
      }
      if (healed.length > 0) {
        outcome.note = (outcome.note ? outcome.note + ' ' : '')
          + '（順手修好了：' + healed.join('、') + '。）';
      }
      if (caused.length > 0 && outcome.status === SELFTEST_STATUS.PASSED) {
        // 情境自己嘅斷言全綠，而佢**整紅咗**一條本來綠嘅不變量 ⇒ 算紅。
        outcome.status = SELFTEST_STATUS.FAILED;
      }
      // ⚠️ 事後相變成下一個情境嘅事前相。
      knownFailing = after.map;
    }

    invariantMs += new Date().getTime() - invStartedAt;

    // ── 第五十三輪批次 C2 組：**同一個結果連續幾多次？** ────────
    //
    // ⚠️ 比對嘅係**指紋**，唔係「紅唔紅」。一條由「A 斷言紅」變成
    // 「B 斷言紅」嘅情境係有進展，唔應該被數成「又係同一樣」。
    // ⚠️ 只有紅／ERROR 先入報告。17 條全部入，份報告會長到冇人睇。
    if (outcome.status === SELFTEST_STATUS.FAILED
      || outcome.status === SELFTEST_STATUS.ERROR) {
      outcome.payloads = selfTestPayloads_[scenario.id] || [];
    }

    const fingerprint = selfTestOutcomeFingerprint_(outcome);
    const history = carryHistory(scenario.id);
    const runCount = history.runCount + 1;
    const sameStreak = (history.fingerprint && history.fingerprint === fingerprint)
      ? history.sameStreak + 1 : 1;
    outcome.repeat = { runCount: runCount, sameStreak: sameStreak };

    results.push(outcome);
    byId[scenario.id] = outcome;
    state[scenario.id] = {
      id: scenario.id, status: outcome.status,
      // ⚠️ `SKIPPED` 唔可以報成「0 條斷言失敗」——嗰句睇落似通過。
      summary: outcome.status === SELFTEST_STATUS.PASSED ? '通過'
        : (outcome.status === SELFTEST_STATUS.SKIPPED ? '跳過'
          : (outcome.error || ((outcome.failedChecks || []).length + ' 條斷言失敗'))),
      // 第五十輪批次 A1 組：跳過嗰陣要拎得返上一次嘅證據。
      failedChecks: outcome.failedChecks || [],
      invariantDetail: outcome.invariantDetail || [],
      // ⚠️ 一齊存落 `SelfTestState`——續跑嗰陣一條「上一次紅、今次跳過」
      // 嘅情境仲要印得返啲原文，否則要 Ivan 再由頭跑一次先攞得返。
      payloads: outcome.payloads || [],
      fingerprint: fingerprint,
      runCount: runCount, sameStreak: sameStreak
    };
    // ⚠️ 逐個寫，唔可以等成批完。
    try { writeSelfTestState_(state); } catch (err) {
      log_('WARN', '寫 SelfTestState 失敗：' + err.message);
    }
  });

  // ── 全部情境跑完之後，一次過跑貴嗰批 ────────────────────────
  //
  // ⚠️ 仲有「未跑」嘅時候**唔跑**——嗰陣本來就仲未行完，
  // 跑埋只會食埋下一次續跑嘅時間預算。
  let finalInvariants = null;
  if (!stoppedForTime) {
    const finalStartedAt = new Date().getTime();
    try {
      finalInvariants = runAllInvariants_(quarterId, INVARIANT_SET.FINAL);
    } catch (err) {
      finalInvariants = {
        results: [invariantResult_('（整體不變量）', '跑不起來',
          INVARIANT_STATUS.ERROR, '算得出結果', '拋錯', err.message)],
        okCount: 0, failedCount: 0, errorCount: 1, skippedCount: 0,
        notApplicableCount: 0
      };
    }
    invariantMs += new Date().getTime() - finalStartedAt;
  }

  const totalMs = new Date().getTime() - runStartedAt;
  return {
    blocked: false,
    quarterId: quarterId,
    quarterSource: quarter.source,
    resetSummary: resetSummary,
    rerunFailedOnly: !!rerunFailedOnly,
    rerunIds: rerunIds,
    results: results,
    // 第五十二輪批次 B4 組：開跑就已經紅嗰幾條，要排喺報告最頂。
    startupFailures: startupFailures,
    startupSnapshotError: baseline.error,
    finalInvariants: finalInvariants,
    totalMs: totalMs,
    invariantMs: invariantMs,
    scenarioMs: Math.max(0, totalMs - invariantMs),
    stoppedForTime: stoppedForTime,
    passedCount: results.filter(function (r) { return r.status === SELFTEST_STATUS.PASSED; }).length,
    failedCount: results.filter(function (r) { return r.status === SELFTEST_STATUS.FAILED; }).length,
    errorCount: results.filter(function (r) { return r.status === SELFTEST_STATUS.ERROR; }).length,
    notRunCount: results.filter(function (r) { return r.status === SELFTEST_STATUS.NOT_RUN; }).length
  };
}

/**
 * 把報告寫成人睇嘅行。
 *
 * ⚠️ 每一條紅色都要拿得出**實際嘅值**，唔係只有「失敗」。
 * 冇實際值嘅報告，等於逼下一個人由零查起——
 * 而嗰個人好可能就係兩個月之後嘅 Ivan。
 *
 * @param {Object} report `runSelfTestMachine_()` 的結果
 * @returns {string[]} 逐行
 */
function describeSelfTestReport_(report) {
  if (report.blocked) {
    return ['自測機沒有執行。', ''].concat(
      report.reasons.map(function (r) { return '・' + r; }));
  }
  const countBy = function (status) {
    return (report.results || []).filter(function (r) { return r.status === status; }).length;
  };
  const skippedCount = countBy(SELFTEST_STATUS.SKIPPED);
  const blockedCount = countBy(SELFTEST_STATUS.BLOCKED);
  // ⚠️ 第五十一輪批次 D2 組：**「被擋住」要獨立數出嚟。**
  //
  // `BLOCKED` 唔等於通過。只數綠同紅嘅話，一份「6 綠 2 紅」嘅報告
  // 睇落好似情況唔錯，而實際上有七條根本冇跑過。
  const lines = ['自測機：' + report.results.length + ' 個情境　'
    + report.passedCount + ' 綠　'
    + (report.failedCount + report.errorCount) + ' 紅　'
    + blockedCount + ' 被擋住　'
    + skippedCount + ' 跳過　'
    + report.notRunCount + ' 未跑'];
  lines.push('沙盒季度：' + report.quarterId + '　' + report.resetSummary);
  if (report.rerunFailedOnly) {
    lines.push('（只重跑紅色情境：'
      + ((report.rerunIds || []).join('、') || '沒有紅色情境可以重跑')
      + '。沙盒季度沒有清掉。）');
  }
  lines.push('');

  // ── 第五十二輪批次 B4 組：開跑就已經紅嗰幾條，排喺最頂 ─────
  //
  // ⚠️ 排喺最頂係因為佢係**先決條件**：呢幾條唔清乾淨，
  // 下面每一條情境嘅綠同紅都要打個折扣。
  if (report.startupSnapshotError) {
    lines.push('⚠️ 開跑之前影不到不變量的底相：' + report.startupSnapshotError);
    lines.push('　 所以下面每一條情境的「不變量」欄都可能把一個'
      + '本來就存在的問題算了在它頭上。');
    lines.push('');
  } else if ((report.startupFailures || []).length > 0) {
    lines.push('⚠️ 開跑的時候已經存在的不變量失敗（'
      + report.startupFailures.length + ' 條）');
    lines.push('　 這幾條不是下面任何一個情境弄出來的，所以不算在它們頭上。');
    lines.push('　 但它們是先決條件：不清乾淨，下面每一條的綠和紅都要打個折扣。');
    report.startupFailures.forEach(function (d) {
      lines.push('　 ⚠️ ' + d);
    });
    lines.push('');
  }

  // ⚠️ 情境按**執行次序**印，唔係按編號——S14／S15 排咗上嚟 S02 之後
  // （見登記表嗰段：重新生成要 Stage 仍然係 DRAFT）。
  lines.push('（情境按執行次序排，不按編號。）');
  lines.push('');

  const printOne = function (r, icon) {
    lines.push(icon + ' ' + r.id + '　' + (r.title || ''));
    if (r.note) lines.push('　 ' + r.note);
    // ── 第五十三輪批次 C2 組：**唔好再撳。** ─────────────────────
    //
    // ⚠️ 呢一句排喺證據**前面**。排喺後面嘅話，Ivan 要睇完成段
    // 失敗訊息先見到——而佢已經睇過同一段三次。
    const repeatLine = describeSelfTestRepeat_(r.repeat);
    if (repeatLine && (r.status === SELFTEST_STATUS.FAILED
      || r.status === SELFTEST_STATUS.ERROR)) {
      lines.push('　 ' + repeatLine);
      lines.push('　　 再撳「▶️ 只重跑紅色情境」不會有分別——要修碼才會變。');
    }
    if (r.error) lines.push('　 執行時拋錯：' + r.error);
    (r.failedChecks || []).forEach(function (c) {
      lines.push('　 ' + c.label);
      lines.push('　　 預期：' + c.expected);
      lines.push('　　 實際：' + c.actual);
      // ⚠️ 第五十一輪批次 E2 組：**證據同實際一模一樣就唔好再印一次。**
      //
      // 上一輪 S11 嘅「實際」同「證據」係同一段長文字，印咗兩次。
      // 證據欄應該講**呢個值由邊度嚟**，唔係把個值再抄一次。
      if (c.evidence && c.evidence !== c.actual) lines.push('　　 證據：' + c.evidence);
    });
    (r.invariantDetail || []).forEach(function (d) {
      lines.push('　 ⚠️ 不變量：' + d);
    });
    // ── 第五十三輪批次：**API 回咗乜，原文貼出嚟。** ────────────
    //
    // ⚠️ 下一輪落手查嗰個淨係睇得到呢份報告。
    // 每一個問題嘅第一個問句都係「呢個 API 到底回咗乜」——
    // 冇原文就答唔到，而答唔到就要 Ivan 再撳一次。
    if ((r.payloads || []).length > 0) {
      lines.push('　 ── 這一條叫過的 API 回了什麼（原文）──');
      r.payloads.forEach(function (pl) {
        lines.push('　　 ' + pl.api + '　⇒　' + pl.text);
      });
    }
    lines.push('');
  };

  const real = report.results.filter(function (r) {
    return r.status === SELFTEST_STATUS.FAILED || r.status === SELFTEST_STATUS.ERROR;
  });
  const blocked = report.results.filter(function (r) {
    return r.status === SELFTEST_STATUS.BLOCKED;
  });
  const others = report.results.filter(function (r) {
    return r.status === SELFTEST_STATUS.SKIPPED || r.status === SELFTEST_STATUS.NOT_RUN;
  });

  if (real.length > 0) {
    lines.push('🔴 真正失敗（' + real.length + ' 條）');
    lines.push('');
    real.forEach(function (r) { printOne(r, '🔴'); });
  }
  if (blocked.length > 0) {
    // ⚠️ 分開一節，而且講明「修好上游就會重跑」——
    // 唔講嘅話，Ivan 要逐條睇完先知道呢幾條只係連環反應。
    lines.push('🚧 被上游擋住（' + blocked.length + ' 條，修好上游之後會重跑）');
    lines.push('　 ' + blocked.map(function (r) { return r.id; }).join('　'));
    lines.push('');
    blocked.forEach(function (r) { printOne(r, '🚧'); });
  }
  others.forEach(function (r) { printOne(r, '⚪'); });

  // ── 全部情境跑完之後嗰批（貴嘅）─────────────────────────────
  //
  // 第五十輪批次 B1 組：I04（全表 10,920 行）同 I08（每條要行一次
  // 完整 plan）唔可以每個情境都跑，所以留到最尾一次過跑。
  if (report.finalInvariants) {
    const fin = report.finalInvariants;
    lines.push('━━━ 全部跑完之後的整體不變量 ━━━');
    describeInvariantReport_(fin).forEach(function (l) { lines.push(l); });
    lines.push('');
  } else if (report.stoppedForTime) {
    lines.push('━━━ 全部跑完之後的整體不變量 ━━━');
    lines.push('（還有情境沒有跑完，所以這一批先不跑——'
      + '跑埋只會吃掉下一次續跑的時間。）');
    lines.push('');
  }

  // ── 時間用在哪裡（B3 組）──────────────────────────────────────
  //
  // ⚠️ 沒有這一行，下次再卡住又要重新查一次。
  if (report.totalMs !== undefined) {
    lines.push('時間：用了 ' + describeSelfTestDuration_(report.totalMs)
      + '（情境 ' + describeSelfTestDuration_(report.scenarioMs)
      + '／不變量 ' + describeSelfTestDuration_(report.invariantMs) + '）');
    lines.push('');
  }

  // ── ⚠️ 下一步該撳哪一粒 ───────────────────────────────────────
  //
  // 第五十輪批次 A3 組：以前三種情況都印同一句「撳『繼續跑自測』」，
  // 而其中一種情況撳了是沒有用的。
  //
  // 現場：Ivan 就是照着那一句撳了三次，三次報告一模一樣。
  // 一句寫錯的指示，代價是實實在在的——他白撳了三次。
  lines.push('━━━ 下一步 ━━━');
  if (report.notRunCount > 0) {
    lines.push('還有 ' + report.notRunCount + ' 個情境沒有跑。');
    lines.push('撳「測試工具 ▸ ▶️ 繼續跑自測」由停下來的地方接住。');
  } else if (report.failedCount + report.errorCount + blockedCount > 0) {
    lines.push(report.results.length + ' 個情境全部跑完了，'
      + (report.failedCount + report.errorCount) + ' 個紅、'
      + blockedCount + ' 個被擋住。');
    // ── 第五十三輪批次 C3 組：**全部紅嘅都重跑過兩次以上 ⇒ 唔好再撳。** ──
    //
    // ⚠️ 呢一句嘅價值唔喺自測機本身，喺於 Ivan 十月返嚟嗰陣係一個人。
    // 到時冇人喺旁邊幫佢數「你已經撳咗三次」。
    const stuck = real.filter(function (r) {
      return Number((r.repeat || {}).sameStreak) >= 2;
    });
    if (real.length > 0 && stuck.length === real.length) {
      const times = Math.min.apply(null, stuck.map(function (r) {
        return Number(r.repeat.runCount) || 0;
      }));
      lines.push('⛔ 那 ' + real.length + ' 條紅已經重跑過 ' + times
        + ' 次，結果沒有變。不要再撳——');
      lines.push('　 把這份報告交給 Claude，要修碼。');
    } else {
      lines.push('修好之後撳「測試工具 ▸ ▶️ 只重跑紅色情境」——'
        + '它會重跑紅的同被擋住的那幾個，不會把沙盒季度清掉重頭來。');
    }
  } else {
    lines.push('全部通過。');
  }
  return lines;
}

/**
 * 把毫秒寫成「N 分 N 秒」。
 * @param {number} ms 毫秒
 * @returns {string}
 */
function describeSelfTestDuration_(ms) {
  // ⚠️ 第五十一輪批次 E1 組：上一輪報告印過「用了 4 分 60 秒」。
  //
  // 成因：先 `Math.floor` 攞分鐘、再 `Math.round` 攞秒。
  // 299.6 秒 ⇒ 分鐘 = 4、秒 = round(59.6) = 60。
  //
  // 做法：**先把總秒數 round 一次**，再拆分鐘同秒。
  // 噉樣個秒數永遠喺 0–59。
  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes === 0) return seconds + ' 秒';
  return minutes + ' 分 ' + seconds + ' 秒';
}

/**
 * 把報告寫入 `SelfTestReport` 工作表。
 * @param {Object} report `runSelfTestMachine_()` 的結果
 * @returns {void}
 */
function writeSelfTestReport_(report) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SELFTEST_SHEETS.REPORT);
  if (!sheet) sheet = ss.insertSheet(SELFTEST_SHEETS.REPORT);
  sheet.clear();
  sheet.appendRow(['情境', '標題', '結果', '失敗的斷言', '不變量']);
  sheet.setFrozenRows(1);
  (report.results || []).forEach(function (r) {
    sheet.appendRow([
      r.id, r.title || '', r.status,
      (r.failedChecks || []).map(function (c) {
        return c.label + '｜預期 ' + c.expected + '｜實際 ' + c.actual + '｜' + c.evidence;
      }).join('\n') || (r.error || ''),
      (r.invariantDetail || []).join('\n')
    ]);
  });
}

/**
 * 選單「測試工具 ▸ ⚠️ 跑自測（沙盒季度，DRY_RUN）」。
 * @returns {void}
 */
function runSelfTestMachineFromMenu_() {
  selfTestMenuEntry_(false, '⚠️ 跑自測（沙盒季度）');
}

/**
 * 選單「測試工具 ▸ ▶️ 繼續跑自測」。
 * @returns {void}
 */
function runSelfTestMachineResumeFromMenu_() {
  selfTestMenuEntry_(true, '▶️ 繼續跑自測');
}

/**
 * 選單「測試工具 ▸ ▶️ 只重跑紅色情境」。
 *
 * 第五十輪批次 A2 組：修好一樣嘢之後，唔使把成季清晒重頭嚟。
 *
 * ⚠️ **唔會重設沙盒季度。** 呢個入口嘅意思就係「保留現場，
 * 只重跑嗰幾個」。要由頭嚟就撳「⚠️ 跑自測」。
 *
 * @returns {void}
 */
function runSelfTestRerunFailedFromMenu_() {
  selfTestMenuEntry_(true, '▶️ 只重跑紅色情境', true);
}

/**
 * 三個選單入口嘅共用本體。
 * @param {boolean} resume 續跑
 * @param {string} title 對話框標題
 * @param {boolean=} rerunFailedOnly 只重跑紅色情境
 * @returns {void}
 */
function selfTestMenuEntry_(resume, title, rerunFailedOnly) {
  const ui = SpreadsheetApp.getUi();
  const quarter = readSelfTestQuarterDetail_();

  if (!resume) {
    const confirm = ui.alert(title,
      '沙盒季度：' + quarter.value + '\n'
        + '（' + describeConfigValueOrigin_(CONFIG_KEYS.SELFTEST_QUARTER_ID,
          quarter.source) + '）\n\n'
        + '⚠️ 這個工具會把 ' + quarter.value + ' 的資料整季清乾淨（連 v0），'
        + '然後由頭走一次完整流程：生成、改格、儲存、寄審閱（模擬）、'
        + '套用申報、產生 PDF、正式發出（模擬）、改動後重發（模擬）。\n\n'
        + '全程 DRY_RUN，不會寄出任何真實電郵。\n'
        + '不會碰任何其他季度、不會改 Config、不會改人員資料。\n\n'
        + '要開始嗎？',
      ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('自測中，請稍候…', '自測機', 300);

  let report;
  try {
    report = runSelfTestMachine_(resume, rerunFailedOnly);
  } catch (err) {
    log_('ERROR', 'runSelfTestMachine_ 失敗：' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (!report.blocked) {
    try { writeSelfTestReport_(report); } catch (err) {
      log_('WARN', '寫 SelfTestReport 失敗：' + err.message);
    }
  }

  ui.alert(title, describeSelfTestReport_(report).join('\n'), ui.ButtonSet.OK);
}

/* ═════════════════════════════════════════════════════════════════════
 * 第四十九輪批次 第 2 層 2B：**匯出 payload（連洗資料）。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 自測機錄低嘅係**真實回傳值**——入面有真人姓名、真電郵、真 PersonID。
 * 呢個 repo 係公開嘅，所以匯出之前一定要洗。
 *
 * ⚠️ **洗唔乾淨就唔好匯出——寧願呢一層做唔成。**
 *
 * 一份「洗咗九成」嘅資料入咗公開 repo，就係一次真實嘅個人資料外洩，
 * 而佢換返嚟嘅只係一層測試。呢個交換完全唔值。
 *
 * ⚠️ 洗完之後**仲要跑一次** `tools/scan-staged-secrets.js` 先准入 repo
 * ——呢一支只係第一道，唔係最後一道。
 */

/**
 * 洗一份 payload。
 *
 * 三種東西要換走：
 *   ・PersonID（`P` ＋ 3-4 位數字）　⇒ `P9001`、`P9002`⋯⋯
 *   ・電郵　　　　　　　　　　　　　⇒ `p01@example.invalid`
 *   ・真人姓名（由 `NameMapping` 出）⇒ `測試人物01`
 *
 * ⚠️ 對照表**逐次執行都一致**（同一個 PersonID 永遠換成同一個代號），
 * 否則同一份資料入面兩處提到同一個人會變成兩個人，
 * 而重播出嚟嘅畫面就同真實嗰個唔一樣。
 *
 * @param {string} text 一段 JSON 文字
 * @param {Object} maps 對照表（會被就地補充）
 * @returns {string} 洗完的文字
 */
function scrubPayloadText_(text, maps) {
  let out = String(text || '');

  // ── 一、真人姓名 ────────────────────────────────────────────
  //
  // ⚠️ 由長到短換。唔排嘅話，一個兩個字嘅名會先換走，
  // 而一個包住佢嘅三個字嘅名就會剩返一截。
  (maps.names || []).forEach(function (pair) {
    if (!pair.from) return;
    out = out.split(pair.from).join(pair.to);
  });

  // ── 二、電郵 ────────────────────────────────────────────────
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, function (email) {
    if (/\.invalid$/i.test(email)) return email;
    if (!maps.emails[email]) {
      maps.emailCount = (maps.emailCount || 0) + 1;
      maps.emails[email] = 'p' + ('0' + maps.emailCount).slice(-2) + '@example.invalid';
    }
    return maps.emails[email];
  });

  // ── 三、PersonID ────────────────────────────────────────────
  //
  // ⚠️ 排喺最尾。姓名對照表入面嘅 `to` 唔會撞到 `P` ＋ 數字，
  // 而電郵換完之後亦都唔會。
  out = out.replace(/\bP\d{3,4}\b/g, function (pid) {
    if (/^P9\d{3}$/.test(pid)) return pid;   // 已經係測試 ID
    if (!maps.persons[pid]) {
      maps.personCount = (maps.personCount || 0) + 1;
      maps.persons[pid] = 'P9' + ('00' + maps.personCount).slice(-3);
    }
    return maps.persons[pid];
  });

  return out;
}

/**
 * 砌姓名對照表：由 `NameMapping` 讀真名，換成 `測試人物NN`。
 * @returns {Array<{from: string, to: string}>} 由長到短排好
 */
function buildScrubNameMap_() {
  const C = COLUMNS.NAME_MAPPING;
  const names = [];
  readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
    [row[C.NAME_TC], row[C.NAME_EN]].forEach(function (raw) {
      const name = String(raw || '').trim();
      // 一個字嘅「名」多數係雜訊，換走反而會整爛其他字。
      if (name.length < 2) return;
      if (names.indexOf(name) === -1) names.push(name);
    });
  });
  // ⚠️ 由長到短。見 `scrubPayloadText_()` 嗰段說明。
  names.sort(function (a, b) { return b.length - a.length; });
  return names.map(function (name, i) {
    return { from: name, to: '測試人物' + ('0' + (i + 1)).slice(-2) };
  });
}

/**
 * 選單「測試工具 ▸ 匯出自測 payload（已洗資料）」。
 * @returns {void}
 */
function runExportSelfTestPayloads_() {
  const ui = SpreadsheetApp.getUi();
  const title = '匯出自測 payload（已洗資料）';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SELFTEST_SHEETS.PAYLOADS);
  if (!sheet || sheet.getLastRow() < 2) {
    ui.alert(title,
      '「' + SELFTEST_SHEETS.PAYLOADS + '」工作表裡面沒有東西。\n\n'
        + '請先撳「測試工具 ▸ ⚠️ 跑自測（沙盒季度，DRY_RUN）」——'
        + '自測機一邊跑，一邊會把每一次 API 呼叫的真實回傳值錄在那裡。',
      ui.ButtonSet.OK);
    return;
  }

  const maps = { names: buildScrubNameMap_(), emails: {}, persons: {} };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const entries = [];
  const broken = [];
  rows.forEach(function (row, i) {
    const scenario = String(row[0] || '');
    const api = String(row[1] || '');
    const raw = String(row[2] || '');
    if (!api || !raw) return;
    try {
      // ⚠️ 洗**文字**，然後再 parse 一次。
      // 洗完 parse 唔返轉頭，就代表洗嗰一步整爛咗個 JSON——
      // 嗰種情況一定要報出嚟，唔可以匯出一份壞檔案。
      const scrubbed = scrubPayloadText_(raw, maps);
      entries.push({ scenario: scenario, api: api, value: JSON.parse(scrubbed) });
    } catch (err) {
      broken.push('第 ' + (i + 2) + ' 行（' + scenario + '／' + api + '）：' + err.message);
    }
  });

  if (entries.length === 0) {
    ui.alert(title, '一筆都洗不出來。\n\n' + broken.join('\n'), ui.ButtonSet.OK);
    return;
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const stamp = Utilities.formatDate(new Date(), timezone, 'yyyyMMdd-HHmmss');
  const fileName = 'selftest-payloads-' + stamp + '.json';
  let url = '';
  try {
    // ⚠️ 用兩個參數嗰個 `createFile(name, content)`——佢本來就係純文字。
    // 三個參數嗰個要 `MimeType`，而 `MimeType` 唔喺 `GAS_GLOBALS` 白名單
    // 入面（`tools/lint-undeclared.js` 會報）。加一個全域名去遷就一個
    // 唔必要嘅參數，係倒轉咗——嗰張白名單擋緊嘅正正就係打錯字。
    const file = DriveApp.createFile(fileName, JSON.stringify(entries, null, 2));
    url = file.getUrl();
  } catch (err) {
    ui.alert(title, '寫不出檔案：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = [
    '已經匯出 ' + entries.length + ' 筆（' + fileName + '）。',
    url,
    '',
    '換走了：',
    '　・真人姓名 ' + maps.names.length + ' 個 ⇒ 測試人物NN',
    '　・電郵 ' + Object.keys(maps.emails).length + ' 個 ⇒ pNN@example.invalid',
    '　・PersonID ' + Object.keys(maps.persons).length + ' 個 ⇒ P9NNN',
    ''
  ];
  if (broken.length > 0) {
    lines.push('⚠️ 以下這幾行洗完之後 JSON 讀不回來，沒有匯出：');
    broken.slice(0, 10).forEach(function (b) { lines.push('　' + b); });
    lines.push('');
  }
  lines.push('⚠️ 放進 repo 的 tests/payloads/ 之前，一定要再跑一次');
  lines.push('　 node tools/scan-staged-secrets.js。');
  lines.push('　 這一支只是第一道，不是最後一道。');
  lines.push('　 洗不乾淨就不要放進去——寧願那一層做不成。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
