/**
 * 全季流程演練（第二十九輪批次階段 D 新增）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個工具
 * ─────────────────────────────────────────────────────────────────────
 *
 * 到今日為止，**成套系統從來未由頭到尾行足一次。**
 * 單獨嘅步驟全部試過，但「串起嚟」嗰一層完全未驗證過——
 * 而過往每一次真正撞到嘅問題（Stage 鎖死、PDF 版本號對唔上、
 * 資料夾冇建到、ICS 時間變成 NaN）都係喺「串起嚟」嗰一層先浮現。
 *
 * 呢個工具喺一個沙盒季度自動行足五步，然後輸出一份報告，
 * 講每一步做咗乜、狀態變成點、產生咗幾多檔案、有冇出錯。
 *
 * ⚠️ **使用者係 Ivan，唔係幹事。** 所以放試算表選單（測試工具），
 * 唔搬上 Web——搬上去只會令幹事喺一堆佢一世都唔會撳嘅嘢入面
 * 搵佢真正要撳嗰一粒。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 四道安全閘，缺一不可
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. `DRY_RUN` 一定要係 `TRUE`。`FALSE` 即刻拒絕。
 * 2. 唔可以喺受保護嘅季度執行（預設 2027T1 ＝ 真正上線嗰季）。
 * 3. 要打字確認，而且確認畫面要寫明會建立幾多個版本、幾多份 PDF、
 *    幾多行 SendLog、**同埋唔會真正寄出任何電郵**。
 * 4. 目標季度必須由使用者揀，**冇預設值**。
 *
 * ⚠️ **工具本身唔會自動清理。** 報告最後一段列出呢次演練建立咗乜
 *（版本號、PDF 檔案、SendLog 行數），由使用者自己決定用
 * 「⚠️⚠️ 重設季度測試資料」清走。
 * 自動清理係不可逆動作，唔可以由一個測試工具代做。
 */

/** Diagnostics 報告名。同名會覆蓋上一次，唔會累積。 */
const SEASON_REHEARSAL_REPORT = '全季流程演練';

/** 打字確認要打嘅字。 */
const SEASON_REHEARSAL_CONFIRM_WORD = '演練';

/**
 * 步驟 3.5 最多行幾多批個人 PDF。
 * ⚠️ 呢個係第二道保險。真正管住時間嘅係下面嗰個死線。
 */
const SEASON_REHEARSAL_PDF_MAX_ROUNDS = 6;

/**
 * 由**演練開始**計，行到幾多毫秒之後就唔再開新一批個人 PDF。
 *
 * Apps Script 單次執行上限係 6 分鐘（360 秒）。實測步驟 1～3 用咗
 * 114 秒，而步驟 4、5 仲要寄兩輪信。留 210 秒（3.5 分鐘）做死線，
 * 即係最壞情況都仲有成兩分鐘俾後面兩步同埋寫報告。
 *
 * ⚠️ **寧願 PDF 產生唔晒，都唔可以令成份報告寫唔出。**
 * 報告寫唔出嘅話，連步驟 1～3 嗰啲已經行完嘅結果都一齊冇埋。
 */
const SEASON_REHEARSAL_PDF_DEADLINE_MS = 210000;

/**
 * 預設受保護（唔准演練）嘅季度。
 *
 * ⚠️ **寫喺程式碼做預設值，唔係只靠 Config。**
 * 只靠 Config 嘅話，一個未補建／被人清走嘅 key 就等於保護消失，
 * 而畫面上完全睇唔出——即係「缺失被當成正常值靜靜過」。
 * Config 有 `REHEARSAL_PROTECTED_QUARTERS` 就用 Config 嗰個（可以加），
 * 冇就用呢個。
 */
const SEASON_REHEARSAL_PROTECTED_DEFAULT = '2027T1';

/* ============================================================
 * 安全閘（純函式，可離線測試）
 * ============================================================ */

/**
 * 四道閘一次過判斷。**純函式**——所有輸入都由呼叫端讀好傳入。
 *
 * ⚠️ 回傳 `blocked` 同 `reasons`，唔係拋錯：四個原因要一次過講晒。
 * 逐個拋嘅話，使用者改完一個再撳，先發現仲有第二個。
 *
 * @param {Object} input
 *   `isDryRun` Config 嘅 DRY_RUN 係咪 TRUE／
 *   `quarterId` 使用者揀嘅季度（空字串 ＝ 冇揀）／
 *   `protectedQuarters` 受保護季度清單（字串陣列）／
 *   `typedText` 打字確認嗰格（`null` ＝ 仲未問到嗰一步）
 * @returns {{blocked: boolean, reasons: string[]}}
 */
function evaluateSeasonRehearsalGuards_(input) {
  const opts = input || {};
  const reasons = [];

  // ── 閘 1　DRY_RUN ────────────────────────────────────────
  // ⚠️ 一定要 `=== true`。`undefined`（讀唔到 Config）**唔算通過**——
  // 「查不到」同「查到係 TRUE」係兩件事，而估錯嗰邊嘅代價係真係寄信。
  if (opts.isDryRun !== true) {
    reasons.push('DRY_RUN 不是 TRUE。這個工具會走完整個寄送流程，'
      + 'DRY_RUN=FALSE 時那些信會真的寄出去給全體義工。'
      + '請先在 Config 把 DRY_RUN 設成 TRUE。');
  }

  // ── 閘 2　目標季度一定要由使用者揀 ────────────────────────
  const quarterId = String(opts.quarterId || '').trim();
  if (quarterId === '') {
    reasons.push('沒有選季度。這個工具刻意沒有預設值——'
      + '一個會建立版本、產生 PDF、寫 SendLog 的工具，'
      + '不應該在你沒有講明的情況下自己揀一季來動。');
  }

  // ── 閘 3　受保護季度 ─────────────────────────────────────
  const protectedList = (opts.protectedQuarters || []).map(function (q) {
    return String(q || '').trim().toUpperCase();
  }).filter(function (q) { return q !== ''; });
  if (quarterId !== '' && protectedList.indexOf(quarterId.toUpperCase()) !== -1) {
    reasons.push('「' + quarterId + '」是受保護的季度（真正上線那一季），'
      + '不可以在上面做演練。演練會建立新版本、產生 PDF、寫 SendLog，'
      + '把真正的資料弄髒之後很難分辨哪些是演練留下的。');
  }

  // ── 閘 4　打字確認 ───────────────────────────────────────
  // `null` ＝ 仲未行到問嗰一步（第一次算閘嗰陣），唔當成失敗。
  if (opts.typedText !== null && opts.typedText !== undefined) {
    if (String(opts.typedText).trim() !== SEASON_REHEARSAL_CONFIRM_WORD) {
      reasons.push('沒有輸入「' + SEASON_REHEARSAL_CONFIRM_WORD + '」，已取消，'
        + '什麼都沒有做。');
    }
  }

  return { blocked: reasons.length > 0, reasons: reasons };
}

/**
 * 讀受保護季度清單。Config 有就用 Config，冇就用寫死嘅預設。
 * @returns {string[]}
 */
function readRehearsalProtectedQuarters_() {
  let raw = '';
  try {
    raw = String(getConfig(CONFIG_KEYS.REHEARSAL_PROTECTED_QUARTERS,
      SEASON_REHEARSAL_PROTECTED_DEFAULT) || '').trim();
  } catch (err) {
    raw = SEASON_REHEARSAL_PROTECTED_DEFAULT;
  }
  // ⚠️ Config 明確填成空白 ⇒ **仍然用預設**，唔會變成「乜都唔保護」。
  // 想解除保護就要改程式碼，唔係喺 Config 打一格空白。
  if (raw === '') raw = SEASON_REHEARSAL_PROTECTED_DEFAULT;
  return splitList_(raw);
}

/* ============================================================
 * 起點狀態（步 0）
 * ============================================================ */

/**
 * 演練開始前嘅狀態，用嚟同做完之後對照。
 * @param {string} quarterId
 * @returns {Object}
 */
function readSeasonRehearsalBaseline_(quarterId) {
  const safe = function (label, fn) {
    try { return fn(); } catch (err) { return '（查不到：' + err.message + '）'; }
  };
  return {
    stage: safe('stage', function () { return getQuarterStage_(quarterId); }),
    latestVersionNo: safe('version', function () { return findLatestVersionNo(quarterId); }),
    sendLogRows: safe('sendlog', function () {
      return readSheet(SHEETS.SEND_LOG).filter(function (row) {
        return String(row[COLUMNS.SEND_LOG.QUARTER_ID] || '').trim() === quarterId;
      }).length;
    }),
    pdfFileCount: safe('pdf', function () {
      return listRosterPdfFilesForQuarter_(quarterId).length;
    })
  };
}

/* ============================================================
 * 逐步執行
 * ============================================================ */

/**
 * 行一步，記低耗時同結果。**唔會拋錯出去**——
 *
 * ⚠️ 每一步失敗都要繼續記錄然後行落去。
 * 中途 `throw` 就見唔到後面幾步嘅問題，而「串起嚟」嗰一層嘅問題
 * 好多時就係喺後面幾步先浮現。
 *
 * @param {Object[]} log 累積用嘅陣列，會就地 push
 * @param {string} name 步驟名
 * @param {function(): Object} fn 實際做嘅嘢，回一個 `{}` 記落報告
 * @returns {?Object} 成功回 fn 嘅結果，失敗回 null
 */
function runRehearsalStep_(log, name, opts, fn) {
  const o = opts || {};
  // ⚠️ 第三十輪批次階段 C1：**每一步都要記低前置條件同有冇滿足。**
  //
  // 上一版嘅次序排錯咗（儲存並確認排咗喺寄審閱之前），結果係
  // 步驟 4 因為 Stage 停喺 `REVIEW_SENT` 而失敗——但報告只寫住
  // 「步驟 4 失敗」，睇唔出係「真失敗」定係「前一步冇行到所以連鎖」。
  //
  // 記低之後，下次一眼睇得出。
  //
  // ⚠️ 第三十一輪批次階段 B2：**由 `describeFlowStepPrecondition_()` 問**
  //（FiveStageCore.gs），唔喺演練工具入面另寫一套。
  //
  // 上一輪就係另寫咗一套，結果報告寫住
  //   `步驟 1：生成初稿　　Stage 要係 DRAFT，實際係 REVIEW_SENT ⚠️ 不符合`
  //   `步驟 2：寄給堂委審閱　Stage 要係 DRAFT，實際係 REVIEW_SENT ⚠️ 不符合`
  // 但**兩步都成功**——因為步驟 2 早就放寬到三個 Stage，
  // 而步驟 1 根本冇 Stage 限制。
  //
  // 一個講錯嘅前置條件，比冇前置條件更差：佢會令人去查一件冇發生嘅事。
  let preconditionText = '（沒有前置條件）';
  let preconditionMet = true;
  if (o.stepKey) {
    const pre = describeFlowStepPrecondition_(o.stepKey, o.quarterId);
    preconditionText = pre.text;
    preconditionMet = pre.met;
  }

  const startedAt = Date.now();
  try {
    const detail = fn();
    log.push({
      name: name, ok: true, seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      preconditionText: preconditionText, preconditionMet: preconditionMet,
      detail: detail || {}, error: ''
    });
    return detail;
  } catch (err) {
    log.push({
      name: name, ok: false, seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      preconditionText: preconditionText, preconditionMet: preconditionMet,
      detail: {}, error: err.message
    });
    log_('WARN', '全季流程演練「' + name + '」失敗：' + err.message);
    return null;
  }
}

/**
 * 產生個人 PDF：跑到時間死線或者批次上限為止。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ 一次執行做唔晒 58 份，呢個係設計，唔係意外
 * ─────────────────────────────────────────────────────────────────────
 *
 * 實測（見稽核文件「個人 PDF 匯出重試效能分析」）：
 *   58 人 ／ 3 批 ／ 552.6 秒 ／ 重試 81 次
 * 而 `PDF_BATCH_TIME_BUDGET_MS` ＝ 4 分鐘，就係為咗確保**單次
 * Apps Script 執行唔會撞六分鐘上限**——每批之間要幹事重新撳一次。
 *
 * 所以呢度唔可以 loop 到 `done` 為止：噉樣一定撞上限，而撞咗之後
 * **成份報告都唔會寫到**，連前面幾步嘅結果都冇埋。
 *
 * ⚠️ 第三十二輪批次階段 B：**呢個函式係第一段同接續段共用嘅。**
 * 兩邊各寫一次就係「同一個算法兩個真相來源」——而呢個算法入面
 * 有時間死線同上限，兩邊漂移嘅後果係其中一條路會撞六分鐘上限。
 *
 * @param {string} quarterId
 * @param {number} versionNo
 * @param {number} segmentStartedAtMs **呢一段**開始嘅時間（唔係成次演練）
 * @param {number=} roundsAlready 之前幾段已經跑咗幾多批（純粹累計顯示用）
 * @returns {Object} 記落報告嘅明細
 */
function runRehearsalPdfBatches_(quarterId, versionNo, segmentStartedAtMs, roundsAlready) {
  let rounds = 0;
  let last = null;
  let stoppedBy = '';

  while (rounds < SEASON_REHEARSAL_PDF_MAX_ROUNDS) {
    const elapsed = Date.now() - segmentStartedAtMs;
    if (elapsed > SEASON_REHEARSAL_PDF_DEADLINE_MS) {
      stoppedBy = '時間用完（這一段已經行了 ' + Math.round(elapsed / 1000)
        + ' 秒，再產生下去會撞 Apps Script 六分鐘上限，'
        + '連整份報告都寫不出來）';
      break;
    }
    rounds++;
    last = generatePersonalPdfBatch_(quarterId, versionNo);
    if (last && last.done) break;
  }
  if (!stoppedBy && rounds >= SEASON_REHEARSAL_PDF_MAX_ROUNDS && !(last && last.done)) {
    stoppedBy = '批次數到達上限 ' + SEASON_REHEARSAL_PDF_MAX_ROUNDS + ' 批';
  }

  const files = readRehearsalPdfPaths_(quarterId, [versionNo]);
  const mine = (files.files || []).filter(function (f) { return f.isNew; });
  // ⚠️ 欄名逐個對返 `buildPdfBatchResult_()`。第三十一輪 B3 就係讀錯一個
  // 唔存在嘅欄名（`pub.url`）而靜靜得出 undefined，所以呢度用
  // `!== undefined` 分開「係 0」同「根本冇呢一欄」。
  const pick = function (key) {
    return (last && last[key] !== undefined) ? last[key] : '（回傳沒有 ' + key + ' 這一欄）';
  };
  const done = !!(last && last.done);
  const before = Number(roundsAlready) || 0;

  return {
    versionNo: versionNo,
    rounds: rounds,
    roundsTotal: before + rounds,
    finished: done,
    // ⚠️ 冇行完就一定要講得出**點解**停。淨係寫 `finished: false`
    // 等於叫下一個人自己估係壞咗定係時間唔夠。
    stoppedBy: stoppedBy || (done ? '' : '（不明——請告訴開發者）'),
    nextAction: done ? ''
      : '個人 PDF 未產生完，「步驟 4」一定會被缺件保護擋住，這是預期之內。'
        + '請到選單 ▸ 測試工具 ▸ ▶️ 全季流程演練（接續上一段），'
        + '系統會續跑餘下的個人 PDF，產生完之後自動接住行步驟 4 同步驟 5。',
    totalPeople: pick('totalPeople'),
    doneCount: pick('doneCount'),
    generatedCount: pick('generatedCount'),
    skippedExistingCount: pick('skippedExistingCount'),
    errorCount: (last && last.errors) ? last.errors.length : '（回傳沒有 errors 這一欄）',
    firstErrors: (last && last.errors) ? last.errors.slice(0, 3) : [],
    // ⚠️ 要見到分季分版子資料夾——嗰個係目前風險最高嘅未驗證項。
    filesInVersionFolder: mine.filter(function (f) { return f.inSubfolder; }).length,
    filesFlatInRoot: mine.filter(function (f) { return !f.inSubfolder; }).length,
    samplePaths: mine.slice(0, 5).map(function (f) { return f.path; })
  };
}

/**
 * 把任何值變成一格可以寫入 Diagnostics 嘅字串。
 *
 * ⚠️ 第三十輪批次階段 C2-2：**每一格都要強制變成字串。**
 *
 * 實測：對話框寫「已寫入 Diagnostics…共 170 行」，但嗰張表根本
 * 冇呢份報告。其中一個原因就係 `s.detail[k]` 入面有陣列／物件
 *（例如 `warnings`），而 `Range.setValues()` 唔接受——
 * 整份報告會拋錯，然後被 `tryWriteDiagnostics_()` 食咗。
 *
 * ⚠️ **唔可以「靜靜跳過寫唔入嗰啲行」**——嗰樣係把問題藏得更深。
 * 應該喺砌報告嗰陣就展開成人話。
 *
 * @param {*} value
 * @returns {string}
 */
function stringifyDiagValue_(value) {
  if (value === null || value === undefined) return '（沒有值）';
  if (Array.isArray(value)) {
    if (value.length === 0) return '（空）';
    // 陣列展開成人話，太長就截，但**明講截咗**。
    const text = value.map(function (v) {
      return (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
    }).join('、');
    return text.length > 400 ? (text.slice(0, 400) + '…（共 ' + value.length + ' 項，已截斷）') : text;
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 400 ? (text.slice(0, 400) + '…（已截斷）') : text;
  }
  return String(value);
}

/**
 * 演練報告名。**每一段一個名。**
 *
 * ⚠️ `writeDiagnosticsReport_()` 係「同名覆蓋」——兩段用同一個名嘅話，
 * 第二段會把第一段整份洗走，而第一段先係最完整嗰份。
 *
 * @param {number} segment 第幾段（由 1 開始）
 * @returns {string}
 */
function seasonRehearsalReportName_(segment) {
  const n = Number(segment);
  return SEASON_REHEARSAL_REPORT + '（第 ' + (isFinite(n) && n > 0 ? n : 1) + ' 段）';
}

/**
 * 演練用嘅「儲存並確認．執行」。
 *
 * ⚠️ 只行零改動路徑（`executeSaveConfirmZeroChange_()`）。
 * 演練中途冇改過任何格子，所以零改動係**預期路徑**；
 * 而如果唔係零改動，就代表個沙盒季度嘅 grid 有人手改動殘留——
 * 嗰種情況唔應該由一個測試工具自作主張寫落去，講返出嚟就算。
 *
 * ⚠️ 同 `buildSaveAndConfirmPlan_()` 一樣，**唔行 `api*`**——
 * 嗰邊第一行係 `assertWebAppRequestAllowed_()`。
 *
 * @param {string} quarterId
 * @returns {{ok: boolean, action: string, error: string}}
 */
function apiSaveAndConfirmExecuteForRehearsal_(quarterId) {
  try {
    const plan = buildSaveAndConfirmPlan_(quarterId);
    if (plan.blocked) {
      return { ok: false, action: '', error: '被擋住：' + plan.blockReason };
    }
    if (!plan.zeroChange) {
      return {
        ok: false, action: '',
        error: '不是零改動路徑（grid 有 ' + (plan.gridChanges || []).length
          + ' 格人手改動殘留）。演練不會替你寫入——請先自己處理那幾格。'
      };
    }
    const done = executeSaveConfirmZeroChange_(quarterId, plan);
    return {
      ok: true,
      action: (done && done.action) ? done.action : String(plan.zeroChangeAction),
      error: ''
    };
  } catch (err) {
    return { ok: false, action: '', error: err.message };
  }
}

/**
 * 演練嘅正體。**會建立版本、產生 PDF、寫 SendLog。**
 * 呼叫端一定要先行完 `evaluateSeasonRehearsalGuards_()`。
 *
 * @param {string} quarterId
 * @returns {{quarterId: string, baseline: Object, steps: Object[], after: Object}}
 */
function executeSeasonRehearsal_(quarterId) {
  const baseline = readSeasonRehearsalBaseline_(quarterId);
  const steps = [];
  // 成次演練嘅開始時間，俾步驟 3.5 計自己仲剩幾多秒可以用。
  const rehearsalStartedAtMs = Date.now();
  // 同一個開始時間嘅文字版，寫入 RehearsalState，之後幾段用嚟算總時長。
  const startedAtText = nowTimestamp_();

  // ⚠️ 第三十輪批次階段 C1：**次序改成真實流程。**
  //
  // 上一版排成「生成 → 儲存並確認 → 寄審閱 → 正式發出」，係錯嘅：
  // 「儲存並確認」只有喺 `REVIEW_SENT` 先會令 Stage 前進到
  // `REQUESTS_APPLIED`（見 `resolveZeroChangeAction_()`）。排喺寄審閱
  // 之前，佢喺 `DRAFT` 撳、零改動＝乜都唔做，之後「正式發出」
  // 需要 `REQUESTS_APPLIED` 但 Stage 停喺 `REVIEW_SENT` ⇒ 連環失敗。
  //
  //   1 生成初稿
  //   2 寄給堂委審閱        → REVIEW_SENT
  //   3 儲存並確認（零改動） → REQUESTS_APPLIED
  //   4 正式發出給全體      → OFFICIAL_SENT
  //   5 改動後重發

  // ── 步 1　生成初稿 ───────────────────────────────────────
  const gen = runRehearsalStep_(steps, '步驟 1：生成初稿',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.GENERATE }, function () {
      const result = performRosterGeneration_(quarterId);
      let publicLink = '（沒有嘗試）';
      try {
        const pub = publishPublicRoster_(quarterId);
        // ⚠️ 第三十一輪批次階段 B3：`publishPublicRoster_()` 回嘅欄位叫
      // `fileUrl`，唔係 `url`。上一輪讀錯欄名，所以每次都印
      // 「（回傳沒有連結）」——**發佈其實成功咗**，係顯示錯。
      // 讀一個唔存在嘅欄名唔會拋錯，只會靜靜得出 undefined。
      publicLink = (pub && pub.fileUrl) ? '已建立' : '（回傳沒有 fileUrl）';
      } catch (err) {
        publicLink = '失敗：' + err.message;
      }
      return {
        versionNo: result.versionNo,
        sheetName: result.sheetName,
        assigned: result.assigned,
        blank: result.blank,
        warnings: result.warnings,
        publicLink: publicLink
      };
    });

  // ── 步 2　寄給堂委審閱 ───────────────────────────────────
  runRehearsalStep_(steps, '步驟 2：寄給堂委審閱',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.REVIEW_SEND }, function () {
      const plan = planStep2_(quarterId);
      const sendLogBefore = countRehearsalSendLogRows_(quarterId);
      const result = executeStep2_(quarterId);
      return {
        recipientCount: plan.recipientCount,
        isDryRun: plan.isDryRun,
        sendLogAdded: countRehearsalSendLogRows_(quarterId) - sendLogBefore,
        sent: result && result.sent !== undefined ? result.sent : '（回傳沒有這一欄）',
        stageAfter: getQuarterStage_(quarterId)
      };
    });

  // ── 步 3　儲存並確認（零改動路徑）────────────────────────
  // 呢一步先係令 Stage 由 REVIEW_SENT 前進到 REQUESTS_APPLIED 嗰個。
  const versionBefore = gen ? gen.versionNo : findLatestVersionNo(quarterId);
  runRehearsalStep_(steps, '步驟 3：儲存並確認（零改動）',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.SAVE_CONFIRM }, function () {
      const stageBefore = getQuarterStage_(quarterId);
      // ⚠️ 叫 `buildSaveAndConfirmPlan_()` 而唔係 `apiSaveAndConfirmPlan()`：
      // 後者第一行係 `assertWebAppRequestAllowed_()`，而呢個工具由試算表選單
      // 行，唔係一個 Web 請求。行 `api*` 嘅話，Web UI 一關就會拋一個
      // 同演練完全無關嘅錯，令人以為係流程本身出事。
      const plan = buildSaveAndConfirmPlan_(quarterId);
      // ⚠️ `plan.requests` 係一個 `{apply, confirm, needsInput}` 物件，
      // **唔係陣列**。當佢係陣列讀 `.length` 會靜靜得出 `undefined`，
      // 而報告會印一格空白——即係「零申報」同「讀錯欄」睇落一樣。
      const req = plan.requests || { apply: [], confirm: [], needsInput: [] };
      // 零改動路徑要真正執行先會前進 Stage——只 plan 唔 execute 嘅話，
      // Stage 唔會郁，下一步就一定失敗。
      let executed = '（沒有執行）';
      if (!plan.blocked && plan.zeroChange) {
        const done = apiSaveAndConfirmExecuteForRehearsal_(quarterId);
        executed = done.ok ? ('已執行：' + done.action) : ('失敗：' + done.error);
      }
      const stageAfter = getQuarterStage_(quarterId);
      const versionAfter = findLatestVersionNo(quarterId);
      return {
        stageBefore: stageBefore,
        stageAfter: stageAfter,
        // 零改動路徑嘅重點就係「乜都唔應該變」，所以兩樣都要記。
        stageAdvanced: stageBefore !== stageAfter,
        versionCreated: versionAfter !== versionBefore,
        blocked: plan.blocked ? ('是：' + plan.blockReason) : '否',
        zeroChange: plan.zeroChange,
        zeroChangeAction: plan.zeroChangeAction === null ? '（沒有）' : plan.zeroChangeAction,
        executed: executed,
        gridChanges: (plan.gridChanges || []).length,
        pendingRequests: req.apply.length + req.confirm.length + req.needsInput.length,
        realViolations: ((plan.violations || {}).real || []).length
      };
    });

  // ── 步 3.5　產生個人 PDF ─────────────────────────────────
  //
  // ⚠️ 第三十一輪批次階段 B1：**冇呢一步，寄送路徑永遠測唔到。**
  //
  // 演練報告：`步驟 4：正式發出給全體 | 失敗 | 因為個人 PDF 缺件太多而中止`。
  // 呢個唔係 bug——係 `evaluateStep4MissingPdfGate_()` 正確運作。
  // 但後果係整條寄送路徑（12 月 4 日最重要嗰一步，亦即係 linter 前晚
  // 捉到嗰個 `Mailer.gs` 個人 PDF bug 嘅同一條路）由頭到尾冇行過。
  //
  // ⚠️ 叫 `generatePersonalPdfBatch_()` 而唔係 `runGeneratePersonalPdfBatch_()`
  // ——`run*_()` 會叫 `ui.alert()`。
  //
  // ⚠️ 佢係**分批**嘅（`PDF_BATCH_SIZE` ＋ 時間預算），所以要 loop 到
  // `done` 為止；只叫一次就只會產生第一批，而步驟 4 照樣會被擋。
  // ⚠️ **特登唔傳 `stepKey`。** 實測 `runGeneratePersonalPdfBatch_()`
  // 由頭到尾冇 `requireQuarterStage_()`——產生 PDF 唔屬於五階段閘門，
  // 佢只要求「有一個版本」。夾硬借用步驟 4 嗰個 `stepKey` 就會
  // 喺報告寫一個唔存在嘅前置條件，即係 B2 要修嗰個毛病嘅翻版。
  runRehearsalStep_(steps, '步驟 3.5：產生個人 PDF',
    { quarterId: quarterId }, function () {
      const versionNo = findLatestVersionNo(quarterId);
      if (versionNo < 0) throw new Error('這一季還沒有版本，產生不到個人 PDF。');

      return runRehearsalPdfBatches_(quarterId, versionNo, rehearsalStartedAtMs);
    });

  // ── 步 4　正式發出給全體 ─────────────────────────────────
  runRehearsalStep_(steps, '步驟 4：正式發出給全體',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.OFFICIAL_SEND }, function () {
      const warn = planStep4Warnings_(quarterId);
      const pdf = planStep4MissingPdf_(quarterId, warn.versionNo);
      const preview = planStep4SendPreview_(quarterId, warn.versionNo);
      const sendLogBefore = countRehearsalSendLogRows_(quarterId);
      const result = executeStep4Send_(quarterId);
      return {
        versionNo: warn.versionNo,
        pendingCells: warn.pendingCells.length,
        missingPdf: pdf.missing ? pdf.missing.length : '（回傳沒有這一欄）',
        recipientCount: preview.recipientCount,
        isDryRun: preview.isDryRun,
        sendLogAdded: countRehearsalSendLogRows_(quarterId) - sendLogBefore,
        skipped: result && result.skipped !== undefined ? result.skipped : '（回傳沒有這一欄）',
        outcomeSentence: result ? result.outcomeSentence : '',
        stageAfter: getQuarterStage_(quarterId)
      };
    });

  // ── 步 5　改動後重發（預期 0 人，因為冇改過嘢）────────────
  runRehearsalStep_(steps, '步驟 5：改動後重發',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.RESEND }, function () {
      const plan = planStep5ChangedList_(quarterId);
      return {
        versionNo: plan.versionNo,
        changedCount: plan.changedList.length,
        // ⚠️ 特登唔真係寄——冇改動嘅話本來就唔應該寄，
        // 而「有改動先寄」呢個判斷本身就係要驗證嗰樣嘢。
        note: plan.changedList.length === 0
          ? '沒有人有改動，所以沒有寄——這正是預期結果（演練中途沒有改過任何格子）'
          : '有 ' + plan.changedList.length + ' 人被判定為有改動，但演練沒有改過任何格子，請查'
      };
    });

  // ⚠️ 第三十輪批次階段 C3：2027T4 已經累積咗 9 個版本（演練跑過兩次）。
  // 只講「版本由 N 變到 M」唔夠——要逐個列出**呢一次**建立咗邊幾個，
  // 清理嗰陣先知邊啲可以動。
  const created = { versions: [], pdfPaths: [] };
  const firstNew = (Number(baseline.latestVersionNo) || -1) + 1;
  const lastNew = findLatestVersionNo(quarterId);
  for (let v = firstNew; v <= lastNew; v++) created.versions.push(v);

  // PDF：檔名開頭係 `{quarterId}_v{呢次建立嘅版本}` 嘅先算「呢次新建」。
  const pdfFiles = readRehearsalPdfPaths_(quarterId, created.versions);
  created.pdfPaths = (pdfFiles.files || [])
    .filter(function (f) { return f.isNew; })
    .map(function (f) { return f.path; });

  // ── 第三十二輪批次階段 B：寫低跨段狀態 ────────────────────
  //
  // ⚠️ 個人 PDF 未產生完 ⇒ 步驟 4、5 一定被缺件閘門擋住。
  // 冇呢個狀態，幹事就要由頭再演練一次先試到嗰兩步——
  // 而**嗰兩步至今從來冇喺演練入面行過**。
  //
  // ⚠️ 就算 PDF 產生完咗都要寫，因為步驟 4、5 可能因為其他原因失敗，
  // 而接續工具係唯一一條唔使重新生成版本就再試一次嘅路。
  const pdfStep = steps.filter(function (s) {
    return s.name.indexOf('產生個人 PDF') !== -1;
  })[0];
  const pdfDetail = (pdfStep && pdfStep.detail) || {};
  const allOk = steps.every(function (s) { return s.ok; });
  let stateWritten = false;
  let stateError = '';
  try {
    if (allOk && pdfDetail.finished) {
      // 全部行完 ⇒ 唔留狀態。
      clearRehearsalState_();
    } else {
      writeRehearsalState_({
        quarterId: quarterId,
        startedAt: startedAtText,
        segment: 1,
        baseVersionNo: lastNew,
        stepsDone: steps.filter(function (s) { return s.ok; })
          .map(function (s) { return s.name; }).join('，'),
        pdfRoundsDone: Number(pdfDetail.rounds) || 0,
        pdfDone: !!pdfDetail.finished,
        stoppedBy: String(pdfDetail.stoppedBy || ''),
        notes: '第一段由「全季流程演練（第一段：由頭開始）」建立。'
          + '接續請用「全季流程演練（接續上一段）」。'
      });
      stateWritten = true;
    }
  } catch (err) {
    // ⚠️ 狀態寫唔到唔可以令成次演練白行——前面幾步嘅結果仲有價值。
    // 但一定要講出嚟，否則幹事會撳「接續」然後見到「沒有未完成的演練」，
    // 完全唔知發生咩事。
    stateError = err.message;
  }

  return {
    quarterId: quarterId,
    baseline: baseline,
    steps: steps,
    created: created,
    after: readSeasonRehearsalBaseline_(quarterId),
    pdfFiles: pdfFiles,
    ics: readRehearsalIcsSample_(quarterId),
    highlight: readRehearsalHighlightSample_(quarterId),
    segment: 1,
    startedAt: startedAtText,
    resumeNeeded: stateWritten,
    stateError: stateError,
    pdfFinished: !!pdfDetail.finished
  };
}

/**
 * 數呢一季喺 SendLog 有幾多行。
 * @param {string} quarterId
 * @returns {number} 讀唔到回 -1（**唔係 0**）
 */
function countRehearsalSendLogRows_(quarterId) {
  try {
    return readSheet(SHEETS.SEND_LOG).filter(function (row) {
      return String(row[COLUMNS.SEND_LOG.QUARTER_ID] || '').trim() === quarterId;
    }).length;
  } catch (err) {
    return -1;
  }
}

/* ============================================================
 * 報告要嘅三樣「目前最唔確定」嘅嘢
 * ============================================================ */

/**
 * D4 之一：**逐個 PDF 檔案嘅完整路徑。**
 *
 * ⚠️ 分季分版資料夾（`RosterPDF / 2027T4 / v0 /`）**從來未真正建過**，
 * 呢個係目前風險最高嘅未驗證項。所以唔可以只出一個檔案數——
 * 要逐個列出佢實際落咗喺邊。
 *
 * @param {string} quarterId
 * @param {number[]=} newVersionNos 呢一次演練建立咗嘅版本號。傳咗嘅話，
 *   檔名開頭對得上嘅會標成 `isNew`（階段 C3：清理嗰陣要知邊啲可以動）
 * @returns {{available: boolean, reason: string, rootName: string, files: Object[]}}
 */
function readRehearsalPdfPaths_(quarterId, newVersionNos) {
  try {
    const rootName = resolveMailAttachmentFolder_().getName();
    const newPrefixes = (newVersionNos || []).map(function (v) {
      return quarterId + '_v' + v;
    });
    const files = listRosterPdfFilesForQuarter_(quarterId).map(function (f) {
      return {
        name: f.name,
        sizeBytes: f.sizeBytes,
        // 根資料夾嘅檔案 ＝ 舊式平舖；子資料夾嘅先係分季分版。
        path: f.inSubfolder
          ? (rootName + ' / ' + quarterId + ' / ' + f.folderName + ' / ' + f.name)
          : (rootName + ' / ' + f.name),
        inSubfolder: f.inSubfolder,
        // ⚠️ 冇傳版本清單就一律 `false`——**唔可以猜**。
        // 猜錯嘅後果係叫人清走一份唔應該清嘅檔案。
        isNew: newPrefixes.some(function (p) { return f.name.indexOf(p) === 0; })
      };
    });
    return { available: true, reason: '', rootName: rootName, files: files };
  } catch (err) {
    return { available: false, reason: err.message, rootName: '', files: [] };
  }
}

/**
 * D4 之二：**ICS 附件嘅 DTSTART／DTEND 實際字串。**
 *
 * ⚠️ 之前撞過 `NaNNaNNaNTNaNNaN00`（工作表讀出嚟嘅時間係 Date 物件），
 * 修咗但未真正寄過一次。所以要抽一個人出嚟，把實際嗰兩行原樣印出。
 *
 * @param {string} quarterId
 * @returns {{available: boolean, reason: string, lines: string[]}}
 */
function readRehearsalIcsSample_(quarterId) {
  try {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) return { available: false, reason: '這一季還沒有版本', lines: [] };
    const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
    const recipients = listRecipients_(MAIL_STAGES.OFFICIAL, context)
      .filter(function (r) { return r.personId; });
    if (recipients.length === 0) {
      return { available: false, reason: '這一季沒有任何收件人有派工', lines: [] };
    }
    const who = recipients[0];
    const mine = (context.assignments || []).filter(function (a) {
      return a.personId === who.personId;
    });
    if (mine.length === 0) {
      return { available: false, reason: '抽樣那一位沒有派工紀錄', lines: [] };
    }
    const blob = buildIcsAttachmentForPerson_(context, who, mine);
    if (!blob) return { available: false, reason: '沒有產生 ICS 附件', lines: [] };
    const text = blob.getDataAsString();
    // 只抽 DTSTART／DTEND 兩種行——**唔會把成個檔案（含真名）倒出嚟**。
    const lines = text.split(/\r?\n/).filter(function (l) {
      return l.indexOf('DTSTART') === 0 || l.indexOf('DTEND') === 0;
    });
    return { available: true, reason: '', lines: lines };
  } catch (err) {
    return { available: false, reason: err.message, lines: [] };
  }
}

/**
 * D4 之三：抽樣一個人，講出佢個人 PDF 入面有幾多格被標示。
 *
 * ⚠️ 呢度**唔會產生 PDF**（產生要幾秒一份）——只數「照 highlight 規則
 * 應該標幾多格」，即係 `RosterAssignments` 入面屬於佢嘅格數。
 * 報告要講清楚呢一點，唔可以令人以為已經開過個 PDF 檔睇。
 *
 * @param {string} quarterId
 * @returns {{available: boolean, reason: string, personId: string, cellCount: number}}
 */
function readRehearsalHighlightSample_(quarterId) {
  try {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) {
      return { available: false, reason: '這一季還沒有版本', personId: '', cellCount: 0 };
    }
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    const byPerson = {};
    readVersionAssignmentsRaw_(quarterId, versionNo).forEach(function (row) {
      const pid = String(row[A.PERSON_ID] || '').trim();
      if (!pid) return;
      byPerson[pid] = (byPerson[pid] || 0) + 1;
    });
    const ids = Object.keys(byPerson).sort();
    if (ids.length === 0) {
      return { available: false, reason: '這一版一格都沒有排到人', personId: '', cellCount: 0 };
    }
    // 揀排得最多嗰位——格數最多，最容易睇得出 highlight 有冇漏。
    let best = ids[0];
    ids.forEach(function (id) { if (byPerson[id] > byPerson[best]) best = id; });
    return { available: true, reason: '', personId: best, cellCount: byPerson[best] };
  } catch (err) {
    return { available: false, reason: err.message, personId: '', cellCount: 0 };
  }
}

/* ============================================================
 * 報告（純函式，可離線測試）
 * ============================================================ */

/**
 * 把演練結果砌成 Diagnostics 行。**純函式**，唔碰任何工作表。
 *
 * ⚠️ 唔可以用 `ui.alert()` 塞成份報告——一個對話框裝唔落，
 * 而且 `Diagnostics` 先係可以用 connector 讀返出嚟嗰一份表。
 *
 * @param {Object} record `executeSeasonRehearsal_()` 嘅結果
 * @returns {Object[]} `diagRow_()` 行
 */
function buildSeasonRehearsalRows_(record) {
  const rows = [];
  const r = record || {};
  const base = r.baseline || {};
  const after = r.after || {};

  /**
   * ⚠️ 第三十輪批次階段 C2-2：**每一格都要強制變成字串。**
   *
   * 實測：對話框寫「已寫入 Diagnostics…共 170 行」，但嗰張表根本
   * 冇呢份報告。其中一個原因就係 `s.detail[k]` 入面有陣列／物件
   *（例如 `warnings`），而 `Range.setValues()` 唔接受——
   * 整份報告會拋錯，然後被 `tryWriteDiagnostics_()` 食咗。
   *
   * ⚠️ **唔可以「靜靜跳過寫唔入嗰啲行」**——嗰樣係把問題藏得更深。
   * 應該喺砌報告嗰陣就展開成人話。
   */
  // ⚠️ 第三十二輪批次階段 B：抽咗做 `stringifyDiagValue_()`，
  // 因為接續段嗰邊要用同一套規則。喺兩邊各寫一次就係
  //「同一個算法兩個真相來源」——而其中一邊漂移嘅後果，
  // 係嗰一段報告靜靜寫唔入。
  const cell = stringifyDiagValue_;
  const row = function (section, item, value, note) {
    return diagRow_(section, cell(item), cell(value), cell(note || ''));
  };

  rows.push(row('0. 起點', '季度', r.quarterId || '（沒有）', ''));
  rows.push(row('0. 起點', 'Stage', base.stage, '演練開始前'));
  rows.push(row('0. 起點', '最新版本號', base.latestVersionNo,
    '-1 代表這一季還沒有生成過任何版本'));
  rows.push(row('0. 起點', 'SendLog 行數', base.sendLogRows, ''));
  rows.push(row('0. 起點', 'PDF 檔案數', base.pdfFileCount, ''));

  // ── 逐步 ───────────────────────────────────────────────
  (r.steps || []).forEach(function (s, i) {
    const section = (i + 1) + '. ' + s.name;
    rows.push(row(section, '結果', s.ok ? '成功' : '失敗',
      s.ok ? '' : s.error));
    // ⚠️ 階段 C1：前置條件要同結果排埋一齊睇，先分得出
    // 「真失敗」同「前一步冇行到所以連鎖」。
    rows.push(row(section, '前置條件', s.preconditionText || '（沒有記錄）',
      s.preconditionMet === false ? '⚠️ 不符合' : ''));
    rows.push(row(section, '耗時', s.seconds + ' 秒',
      'B 段要知道整個流程要多久'));
    Object.keys(s.detail || {}).forEach(function (k) {
      rows.push(row(section, k, s.detail[k], ''));
    });
  });

  // ── PDF 資料夾結構 ─────────────────────────────────────
  const pdf = r.pdfFiles || { available: false, reason: '（沒有資料）', files: [] };
  if (!pdf.available) {
    // ⚠️ 查不到就講查不到。回一個 0 會令人以為「確認過，一份都沒有」。
    rows.push(row('PDF 資料夾', '查不到', pdf.reason,
      '不是「一份都沒有」——是根本讀不到資料夾'));
  } else {
    const inSub = pdf.files.filter(function (f) { return f.inSubfolder; }).length;
    rows.push(row('PDF 資料夾', '檔案總數', pdf.files.length, ''));
    rows.push(row('PDF 資料夾', '在「季度／版本」子資料夾裡', inSub,
      inSub === 0
        ? '⚠️ 一個都沒有——分季分版資料夾可能根本沒有建到，這是目前風險最高的未驗證項'
        : ''));
    rows.push(row('PDF 資料夾', '仍然平鋪在根資料夾', pdf.files.length - inSub, ''));
    pdf.files.forEach(function (f) {
      rows.push(row('PDF 逐個檔案', f.path, f.sizeBytes + ' bytes',
        f.isNew ? '⚠️ 這一次演練新建立的' : ''));
    });
  }

  // ── ICS ───────────────────────────────────────────────
  const ics = r.ics || { available: false, reason: '（沒有資料）', lines: [] };
  if (!ics.available) {
    rows.push(row('ICS 附件', '查不到', ics.reason, ''));
  } else {
    ics.lines.forEach(function (line, i) {
      rows.push(row('ICS 附件', '第 ' + (i + 1) + ' 行', line,
        String(line).indexOf('NaN') !== -1
          ? '⚠️ 含 NaN——日期／時間沒有正規化，收件人的日曆會加不到這一項'
          : ''));
    });
    if (ics.lines.length === 0) {
      rows.push(row('ICS 附件', 'DTSTART／DTEND', '（一行都沒有）',
        '⚠️ 有產生檔案但找不到時間行'));
    }
  }

  // ── 個人 highlight ─────────────────────────────────────
  const hl = r.highlight || { available: false, reason: '（沒有資料）' };
  if (!hl.available) {
    rows.push(row('個人 highlight', '查不到', hl.reason, ''));
  } else {
    rows.push(row('個人 highlight', '抽樣的 PersonID', hl.personId,
      '選了這一季排得最多的那一位'));
    rows.push(row('個人 highlight', '應該被標示的格數', hl.cellCount,
      '這是按派工紀錄算出來的應有格數，沒有真的開啟 PDF 數過'));
  }

  // ── 收尾狀態 ───────────────────────────────────────────
  rows.push(row('完結', 'Stage', after.stage, '起點是 ' + cell(base.stage)));
  rows.push(row('完結', '最新版本號', after.latestVersionNo,
    '起點是 ' + cell(base.latestVersionNo)));
  rows.push(row('完結', 'SendLog 行數', after.sendLogRows,
    '起點是 ' + cell(base.sendLogRows)));
  rows.push(row('完結', 'PDF 檔案數', after.pdfFileCount,
    '起點是 ' + cell(base.pdfFileCount)));

  const failed = (r.steps || []).filter(function (s) { return !s.ok; });
  rows.push(row('完結', '失敗的步驟', failed.length,
    failed.length === 0 ? '' : failed.map(function (s) { return s.name; }).join('；')));
  // ⚠️ 階段 C1：分開「真失敗」同「前置條件不符合而連鎖」。
  const chained = failed.filter(function (s) { return s.preconditionMet === false; });
  rows.push(row('完結', '其中因為前置條件不符合而連鎖的', chained.length,
    chained.length === 0 ? ''
      : chained.map(function (s) { return s.name; }).join('；')
        + '——這幾步很可能不是它們本身的問題，先看前一步'));

  // ── 清理（**工具唔會自己做**）───────────────────────────
  // ⚠️ 階段 C3：2027T4 已經累積咗 9 個版本（演練跑過兩次）。
  // 只講「由 N 變到 M」唔夠——要逐個列出**呢一次**建立咗邊幾個。
  const created = r.created || {};
  rows.push(row('清理', '這次演練建立的版本',
    (created.versions && created.versions.length > 0)
      ? created.versions.map(function (v) { return 'v' + v; }).join('、')
      : '（沒有建立新版本）',
    '版本 ' + cell(base.latestVersionNo) + ' → ' + cell(after.latestVersionNo)));
  rows.push(row('清理', '這次演練新增的 SendLog 行數',
    (Number(after.sendLogRows) || 0) - (Number(base.sendLogRows) || 0),
    '由 ' + cell(base.sendLogRows) + ' 變成 ' + cell(after.sendLogRows)));
  const newPdfs = (pdf.files || []).filter(function (f) { return f.isNew; });
  rows.push(row('清理', '這次演練新建立的 PDF',
    newPdfs.length === 0 ? '（查不到——只知道總數的變化）' : newPdfs.length + ' 個檔案',
    'PDF 總數 ' + cell(base.pdfFileCount) + ' → ' + cell(after.pdfFileCount)));
  newPdfs.forEach(function (f) {
    rows.push(row('清理', '新 PDF', f.path, ''));
  });
  rows.push(row('清理', '要怎樣清走',
    '選單 ▸ 維護 ▸ ⚠️⚠️ 重設季度測試資料',
    '⚠️ 這個工具刻意不會自動清理——自動清理是不可逆動作，'
    + '不應該由一個測試工具代你決定。'));

  return rows;
}

/* ============================================================
 * 選單入口
 * ============================================================ */

/**
 * 第一段做完之後嗰句「跟住點做」。
 *
 * ⚠️ 第三十二輪批次階段 B5：舊版只講「步驟 4 被擋是預期之內」。
 * 幹事知道咗係預期，但完全唔知跟住應該做乜——一句「這是預期之內」
 * 唔係一個下一步。
 *
 * @param {Object} record `executeSeasonRehearsal_()` 的結果
 * @returns {string} 已經帶好前後換行，可以直接接落對話框
 */
function buildRehearsalNextStepText_(record) {
  const r = record || {};
  if (r.stateError) {
    return '\n⚠️ 演練狀態寫不進 ' + SHEETS.REHEARSAL_STATE + ' 工作表（原因：'
      + r.stateError + '）。\n'
      + '所以「全季流程演練（接續上一段）」會說沒有未完成的演練。'
      + '要走完步驟 4、5，只能重新演練一次。\n';
  }
  if (!r.resumeNeeded) {
    return '\n這一次演練五步全部行完了，沒有需要接續的東西。\n';
  }

  const pdfStep = (r.steps || []).filter(function (s) {
    return s.name.indexOf('產生個人 PDF') !== -1;
  })[0];
  const d = (pdfStep && pdfStep.detail) || {};
  const total = Number(d.totalPeople);
  const done = Number(d.doneCount);
  const remain = (isFinite(total) && isFinite(done)) ? (total - done) : null;

  return '\n👉 跟住點做：\n'
    + '請到選單 ▸ 測試工具 ▸ ▶️ 全季流程演練（接續上一段），把餘下的 '
    // ⚠️ 數唔到就講「餘下的」，**唔可以寫 0**——0 會令人以為做完咗。
    + (remain === null ? '' : (remain + ' 份'))
    + '個人 PDF 產生完，系統會自動接住行步驟 4 同步驟 5。\n'
    + '（那兩步至今從來沒有在演練裡行過一次。）\n';
}

/**
 * 選單「測試工具 ▸ ⚠️⚠️ 全季流程演練（第一段：由頭開始）」。
 * @returns {void}
 */
function runSeasonRehearsal_() {
  const ui = SpreadsheetApp.getUi();
  const title = '全季流程演練';

  // ── 先問季度（冇預設值）────────────────────────────────
  const ask = ui.prompt(title,
    '這個工具會在你指定的季度由頭到尾行足五步：\n'
    + '生成初稿 → 儲存並確認 → 寄給堂委 → 正式發出 → 改動後重發。\n\n'
    + '請輸入季度 ID（例如 2027T4）。這裡刻意沒有預設值。',
    ui.ButtonSet.OK_CANCEL);
  if (ask.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = String(ask.getResponseText() || '').trim();

  // ── 四道閘 ─────────────────────────────────────────────
  const guard = evaluateSeasonRehearsalGuards_({
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false,
    quarterId: quarterId,
    protectedQuarters: readRehearsalProtectedQuarters_(),
    typedText: null
  });
  if (guard.blocked) {
    ui.alert(title, '不能執行：\n\n・' + guard.reasons.join('\n\n・'), ui.ButtonSet.OK);
    return;
  }

  // ── 確認畫面（要有數字）────────────────────────────────
  const before = readSeasonRehearsalBaseline_(quarterId);
  const confirm = ui.prompt(title,
    '目標季度：' + quarterId + '\n'
    + '現在的 Stage：' + before.stage + '\n'
    + '現在最新版本：' + before.latestVersionNo + '\n'
    + '現在 SendLog：' + before.sendLogRows + ' 行\n'
    + '現在 PDF：' + before.pdfFileCount + ' 個檔案\n\n'
    + '這次演練會：\n'
    + '・建立 2 個新版本（生成初稿一個、套用申報一個）\n'
    // ⚠️ 第三十一輪批次階段 B1：新增「步驟 3.5 產生個人 PDF」。
    // 冇呢一步，步驟 4 一定會被缺件保護擋住，寄送路徑永遠測唔到。
    + '・為全體義工產生個人 PDF（每人一份，約 58 份）\n'
    // ⚠️ 唔可以講到似乎一次就產生得晒。實測 58 人要分 3 批、共 552 秒，
    // 而單次 Apps Script 執行上限係 6 分鐘——所以演練只會盡力產生，
    // 時間到就停手，報告會寫明差幾多。講明咗，步驟 4 被擋就唔會
    // 再令人以為係壞咗。
    + '　（實測 58 份要分 3 次執行、合共約 9 分鐘，而一次執行最多只有\n'
    + '　　6 分鐘，所以演練只會在時間內盡力產生，報告會寫明產生了多少、\n'
    + '　　還差多少。產生不完時「步驟 4」會被缺件保護擋住，那是預期之內。）\n'
    + '・在 SendLog 寫入兩批紀錄（審閱一批、正式發出一批）\n\n'
    + '⚠️ 不會真的寄出任何電郵——DRY_RUN 是 TRUE，'
    + '整個寄送流程會走完，但信不會離開系統。\n\n'
    + '⚠️ 演練留下的東西不會自動清走。做完之後報告會列出建立了什麼，'
    + '由你自己決定要不要用「重設季度測試資料」清理。\n\n'
    + '確定要執行，請輸入「' + SEASON_REHEARSAL_CONFIRM_WORD + '」。',
    ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;

  const typed = evaluateSeasonRehearsalGuards_({
    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false,
    quarterId: quarterId,
    protectedQuarters: readRehearsalProtectedQuarters_(),
    typedText: confirm.getResponseText()
  });
  if (typed.blocked) {
    ui.alert(title, '不能執行：\n\n・' + typed.reasons.join('\n\n・'), ui.ButtonSet.OK);
    return;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('演練中，可能要幾分鐘…', title, 300);

  const record = executeSeasonRehearsal_(quarterId);
  const rows = buildSeasonRehearsalRows_(record);
  // ⚠️ 第三十輪批次階段 C2-1：**要接住回傳值**，但個名唔可以令人誤會成行數。
  //
  // 上一輪為咗過 `diagnostics_written_count` 呢條不變式（禁止
  // `const written = tryWriteDiagnostics_(...)`，因為有人把個 boolean
  // 當成行數印出「共 true 行」），把整個賦值拆走——**但漏咗清走下面
  // 嗰個 `written` 引用**。結果：對話框寫「已寫入 Diagnostics…共 170 行」，
  // 而 Diagnostics 入面根本冇呢份報告，因為嗰一行拋咗
  // `written is not defined`（`lint-undeclared` 掃出嚟嘅）。
  //
  // 正解係兩者都做到：接住回傳值，但改一個唔會被當成行數嘅名。
  // 行數一律用 `rows.length`；`wroteOk` 只用嚟決定顯唔顯示警告。
  //
  // ⚠️ 階段 C2-2：用 `tryWriteDiagnosticsDetailed_()` 攞埋失敗原因。
  // 舊寫法只講「見執行記錄」——而 **Ivan 讀唔到 `Logger`**，
  // 要走去 Apps Script 執行記錄先搵到。一句「失敗咗，自己去搵」
  // 同冇講差唔多。
  // ⚠️ 第三十二輪批次階段 B4：**報告名要分段。**
  // `writeDiagnosticsReport_()` 係同名覆蓋——兩段用同一個名嘅話，
  // 第二段會把第一段整份洗走，而第一段先係最完整嗰份。
  const reportName = seasonRehearsalReportName_(1);
  const wrote = tryWriteDiagnosticsDetailed_(reportName, rows);
  const wroteOk = wrote.ok;

  // ⚠️ 對話框只講「去邊度睇」同幾個關鍵數字，**唔塞成份報告**。
  const failed = record.steps.filter(function (s) { return !s.ok; });
  const total = record.steps.reduce(function (sum, s) { return sum + s.seconds; }, 0);
  ui.alert(title,
    '做完了。\n\n'
    + '五步之中失敗 ' + failed.length + ' 步'
    + (failed.length === 0 ? '' : '：' + failed.map(function (s) { return s.name; }).join('、'))
    + '\n總耗時約 ' + Math.round(total) + ' 秒\n'
    + 'Stage：' + record.baseline.stage + ' → ' + record.after.stage + '\n'
    + '版本：' + record.baseline.latestVersionNo + ' → ' + record.after.latestVersionNo + '\n\n'
    + '完整報告已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「'
    + reportName + '」，共 ' + rows.length + ' 行。\n'
    + (wroteOk ? '' : ('\n⚠️ 寫入失敗，Diagnostics 裡面沒有這份報告。\n原因：'
      + wrote.error + '\n\n'))
    // ⚠️ 第三十二輪批次階段 B5：**要有一句明確嘅下一步。**
    // 舊版只講「步驟 4 被擋是預期之內」——幹事知道咗係預期，
    // 但完全唔知跟住應該做乜。
    + buildRehearsalNextStepText_(record)
    + '\n⚠️ 演練留下的版本、PDF、SendLog 沒有自動清走。\n'
    + '這次建立了：版本 '
    + (record.created.versions.length === 0 ? '（沒有）'
      : record.created.versions.map(function (v) { return 'v' + v; }).join('、'))
    + '　新 PDF ' + record.created.pdfPaths.length + ' 個'
    + '　SendLog ＋'
    + ((Number(record.after.sendLogRows) || 0) - (Number(record.baseline.sendLogRows) || 0))
    + ' 行。',
    ui.ButtonSet.OK);
}
