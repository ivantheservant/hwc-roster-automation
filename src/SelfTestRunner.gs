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
  NOT_RUN: 'NOT_RUN'
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

/** S03：真嘅改 grid 3 格。 */
function selfTestS03_(quarterId) {
  const t = selfTestCollector_('S03');
  const versionNo = findLatestVersionNo(quarterId);
  const cells = selfTestPickCells_(quarterId, versionNo, 3);
  t.equal('找得到 3 格有人的來改', cells.length, 3,
    'selfTestPickCells_() 由 RosterAssignments 選出來');

  let written = 0;
  cells.forEach(function (c, i) {
    // ⚠️ 寫一個**一定唔會解析成真人**嘅字。寫一個真名嘅話，
    // 系統會認得佢，而個改動就會變成「換咗另一個人」——
    // 嗰個係另一種情境，唔係呢一條要驗嘅嘢。
    if (selfTestWriteGridCell_(quarterId, versionNo, c.serviceDate, c.postId,
      c.slotIndex, '自測改動' + (i + 1))) written++;
  });
  t.equal('3 格都真的寫進 grid 工作表', written, 3,
    'selfTestWriteGridCell_()');

  const d = selfTestCall_('S03', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('dashboard 數到 3 格未儲存', (d.unsaved || {}).gridChangeCount, 3,
    'apiGetDashboardState().unsaved＝' + JSON.stringify(d.unsaved));
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

  // 第四十八輪 A 組：〔寄出但不儲存〕那一粒的出現條件。
  t.expect('〔寄出但不儲存〕在這個狀態下應該畫得出'
    + '（只有 grid 改動、沒有認不出的字、沒有待處理申報）',
    s.canSendUnsaved === true, 'true',
    String(s.canSendUnsaved) + '｜' + String(s.canSendUnsavedReason),
    'apiGetSendPlanSummary().canSendUnsaved');
  t.equal('而且那個確認畫面拿得到 3 格明細',
    (s.unsavedSendPreview || {}).total, 3,
    JSON.stringify(s.unsavedSendPreview || {}));
  return t.result();
}

/** S05：儲存並確認。 */
function selfTestS05_(quarterId) {
  const t = selfTestCollector_('S05');
  const plan = selfTestCall_('S05', 'apiSaveAndConfirmPlan',
    function () { return apiSaveAndConfirmPlan(quarterId); });
  t.equal('plan 看到 3 格 grid 改動', (plan.gridChanges || []).length, 3,
    'apiSaveAndConfirmPlan().gridChanges');

  selfTestCall_('S05', 'apiSaveAndConfirmExecute',
    function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });

  t.equal('儲存之後最新版本是 v1', findLatestVersionNo(quarterId), 1,
    'findLatestVersionNo()');
  const d = selfTestCall_('S05', 'apiGetDashboardState',
    function () { return apiGetDashboardState(quarterId); });
  t.equal('未儲存改動歸零', (d.unsaved || {}).gridChangeCount, 0,
    JSON.stringify(d.unsaved));

  // I09 講嘅係同一件事，呢度順手驗一次（公開連結指向 v1）。
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
  const versionNo = findLatestVersionNo(quarterId);
  const cells = selfTestPickCells_(quarterId, versionNo, 2);

  let written = 0;
  cells.forEach(function (c, i) {
    if (selfTestWriteGridCell_(quarterId, versionNo, c.serviceDate, c.postId,
      c.slotIndex, '自測重發' + (i + 1))) written++;
  });
  t.equal('2 格真的寫進 grid', written, 2, 'selfTestWriteGridCell_()');

  selfTestCall_('S10', 'apiSaveAndConfirmExecute',
    function () { return apiSaveAndConfirmExecute(quarterId, { decisions: [] }); });

  const plan = selfTestCall_('S10', 'apiStep5Plan',
    function () { return apiStep5Plan(quarterId, null); });
  const changedIds = (plan.changedList || []).map(function (c) { return c.personId; });

  // ⚠️ 「只寄給那 2 格涉及的人」——**唔可以淨係驗「大過 0」**。
  // 改咗嗰兩格會令**兩個人**受影響（本來嗰個冇咗一格、
  // 而新填嗰個文字系統認唔出，所以只係「本來嗰個少咗」）。
  // 所以驗嘅係：受影響嘅人**全部都喺我啱啱改嗰兩格入面**。
  const touched = cells.map(function (c) { return c.personId; });
  const unexpected = changedIds.filter(function (id) { return touched.indexOf(id) === -1; });
  t.equal('改動後重發的名單裡面沒有「我沒有碰過的人」',
    unexpected.length, 0,
    '改了 ' + JSON.stringify(touched) + '；系統算出有改動的是 '
      + JSON.stringify(changedIds));
  t.expect('而且真的有人被算進去（不是空的）',
    changedIds.length > 0, '> 0 人', changedIds.length + ' 人',
    JSON.stringify(changedIds));
  return t.result();
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
    { id: 'S01', title: '空季度：generate 之前 dashboard 講什麼', run: selfTestS01_ },
    { id: 'S02', title: '生成初稿', run: selfTestS02_ },
    { id: 'S03', title: '改 grid 3 格（真的寫工作表）', run: selfTestS03_ },
    { id: 'S04', title: '有未儲存改動之下開寄出（第四十七輪那個死碼）', run: selfTestS04_ },
    { id: 'S05', title: '儲存並確認', run: selfTestS05_ },
    { id: 'S06', title: '寄給堂委審閱（DRY_RUN）', run: selfTestS06_ },
    { id: 'S07', title: '寫 3 筆申報 → 套用', run: selfTestS07_ },
    { id: 'S08', title: '產生個人 PDF', run: selfTestS08_ },
    { id: 'S09', title: '正式發出（DRY_RUN）', run: selfTestS09_ },
    { id: 'S10', title: '改 2 格 → 儲存 → 改動後重發', run: selfTestS10_ }
  ];
}

/* ═════════════════════════════════════════════════════════════════════
 * 執行時間、狀態、續跑
 * ═════════════════════════════════════════════════════════════════════ */

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
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const out = {};
  values.forEach(function (row) {
    const id = String(row[0] || '').trim();
    if (!id) return;
    out[id] = { id: id, status: String(row[1] || ''), summary: String(row[2] || '') };
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
  sheet.appendRow(['情境', '結果', '摘要', '更新於']);
  sheet.setFrozenRows(1);
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const now = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm:ss');
  Object.keys(state).sort().forEach(function (id) {
    sheet.appendRow([id, state[id].status, state[id].summary, now]);
  });
}

/* ═════════════════════════════════════════════════════════════════════
 * 主流程
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 跑自測機。
 *
 * @param {boolean} resume true ＝ 由上一次停低嘅地方接住；
 *   false ＝ 由頭開始（會先清乾淨沙盒季度）
 * @returns {Object} 報告
 */
function runSelfTestMachine_(resume) {
  selfTestStartedAt_ = new Date().getTime();

  const quarter = readSelfTestQuarterDetail_();
  const quarterId = quarter.value;

  const gate = checkSelfTestPreconditions_(quarterId);
  if (!gate.ok) {
    return {
      blocked: true, quarterId: quarterId, quarterSource: quarter.source,
      reasons: gate.reasons, results: [], invariants: null
    };
  }

  const state = resume ? readSelfTestState_() : {};

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

  // ── 逐個情境 ────────────────────────────────────────────────
  const results = [];
  let stoppedForTime = false;
  selfTestScenarios_().forEach(function (scenario) {
    const previous = state[scenario.id];
    if (resume && previous && previous.status === SELFTEST_STATUS.PASSED) {
      results.push({ id: scenario.id, title: scenario.title,
        status: SELFTEST_STATUS.PASSED, checks: [], failedChecks: [],
        note: '（上一次已經通過，這一次跳過）' });
      return;
    }
    if (stoppedForTime || selfTestOutOfTime_()) {
      stoppedForTime = true;
      results.push({ id: scenario.id, title: scenario.title,
        status: SELFTEST_STATUS.NOT_RUN, checks: [], failedChecks: [],
        note: '（上一次執行時間到，已停低）' });
      state[scenario.id] = { id: scenario.id, status: SELFTEST_STATUS.NOT_RUN, summary: '未跑' };
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

    // ⚠️ 每一個情境跑完，都要叫一次不變量。
    try {
      const inv = runAllInvariants_(quarterId);
      outcome.invariantFailed = inv.failedCount + inv.errorCount;
      outcome.invariantDetail = inv.results.filter(function (r) {
        return r.status === INVARIANT_STATUS.FAILED || r.status === INVARIANT_STATUS.ERROR;
      }).map(function (r) {
        return r.id + '｜預期 ' + r.expected + '｜實際 ' + r.actual + '｜' + r.evidence;
      });
      if (outcome.invariantFailed > 0 && outcome.status === SELFTEST_STATUS.PASSED) {
        // 情境自己嘅斷言全綠，而不變量紅咗 ⇒ **整體算紅**。
        outcome.status = SELFTEST_STATUS.FAILED;
      }
    } catch (err) {
      outcome.invariantFailed = -1;
      outcome.invariantDetail = ['不變量算不出來：' + err.message];
      outcome.status = SELFTEST_STATUS.ERROR;
    }

    results.push(outcome);
    state[scenario.id] = {
      id: scenario.id, status: outcome.status,
      summary: outcome.status === SELFTEST_STATUS.PASSED ? '通過'
        : (outcome.error || ((outcome.failedChecks || []).length + ' 條斷言失敗'))
    };
    // ⚠️ 逐個寫，唔可以等成批完。
    try { writeSelfTestState_(state); } catch (err) {
      log_('WARN', '寫 SelfTestState 失敗：' + err.message);
    }
  });

  return {
    blocked: false,
    quarterId: quarterId,
    quarterSource: quarter.source,
    resetSummary: resetSummary,
    results: results,
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
  const lines = ['自測機：' + report.results.length + ' 個情境，'
    + report.passedCount + ' 綠 '
    + (report.failedCount + report.errorCount) + ' 紅 '
    + report.notRunCount + ' 未跑'];
  lines.push('沙盒季度：' + report.quarterId + '　' + report.resetSummary);
  lines.push('');

  report.results.forEach(function (r) {
    if (r.status === SELFTEST_STATUS.PASSED) return;
    const icon = r.status === SELFTEST_STATUS.NOT_RUN ? '⚪' : '🔴';
    lines.push(icon + ' ' + r.id + '　' + (r.title || ''));
    if (r.note) lines.push('　 ' + r.note);
    if (r.error) lines.push('　 執行時拋錯：' + r.error);
    (r.failedChecks || []).forEach(function (c) {
      lines.push('　 ' + c.label);
      lines.push('　　 預期：' + c.expected);
      lines.push('　　 實際：' + c.actual);
      if (c.evidence) lines.push('　　 證據：' + c.evidence);
    });
    (r.invariantDetail || []).forEach(function (d) {
      lines.push('　 ⚠️ 不變量：' + d);
    });
    lines.push('');
  });

  if (report.stoppedForTime) {
    lines.push('⚠️ 執行時間到，已經乾淨停低。');
    lines.push('　 撳「測試工具 ▸ ▶️ 繼續跑自測」由停低的地方接住。');
    lines.push('');
  }
  if (report.failedCount + report.errorCount === 0 && report.notRunCount === 0) {
    lines.push('全部情境通過。');
  }
  return lines;
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
 * 兩個選單入口嘅共用本體。
 * @param {boolean} resume 續跑
 * @param {string} title 對話框標題
 * @returns {void}
 */
function selfTestMenuEntry_(resume, title) {
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
    report = runSelfTestMachine_(resume);
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
