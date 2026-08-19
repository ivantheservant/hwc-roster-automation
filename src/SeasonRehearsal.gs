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
function runRehearsalStep_(log, name, fn) {
  const startedAt = Date.now();
  try {
    const detail = fn();
    log.push({
      name: name, ok: true, seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      detail: detail || {}, error: ''
    });
    return detail;
  } catch (err) {
    log.push({
      name: name, ok: false, seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      detail: {}, error: err.message
    });
    log_('WARN', '全季流程演練「' + name + '」失敗：' + err.message);
    return null;
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

  // ── 步 1　生成初稿 ───────────────────────────────────────
  const gen = runRehearsalStep_(steps, '步驟 1：生成初稿', function () {
    const result = performRosterGeneration_(quarterId);
    let publicLink = '（沒有嘗試）';
    try {
      const pub = publishPublicRoster_(quarterId);
      publicLink = pub && pub.url ? '已建立' : '（回傳沒有連結）';
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

  // ── 步 2　儲存並確認（零改動路徑）────────────────────────
  const versionBefore = gen ? gen.versionNo : findLatestVersionNo(quarterId);
  runRehearsalStep_(steps, '步驟 2：儲存並確認（零改動）', function () {
    const stageBefore = getQuarterStage_(quarterId);
    // ⚠️ 叫 `buildSaveAndConfirmPlan_()` 而唔係 `apiSaveAndConfirmPlan()`：
    // 後者第一行係 `assertWebAppRequestAllowed_()`，而呢個工具由試算表選單
    // 行，唔係一個 Web 請求。行 `api*` 嘅話，Web UI 一關就會拋一個
    // 同演練完全無關嘅錯，令人以為係流程本身出事。
    const plan = buildSaveAndConfirmPlan_(quarterId);
    const stageAfter = getQuarterStage_(quarterId);
    const versionAfter = findLatestVersionNo(quarterId);
    // ⚠️ `plan.requests` 係一個 `{apply, confirm, needsInput}` 物件，
    // **唔係陣列**。當佢係陣列讀 `.length` 會靜靜得出 `undefined`，
    // 而報告會印一格空白——即係「零申報」同「讀錯欄」睇落一樣。
    const req = plan.requests || { apply: [], confirm: [], needsInput: [] };
    return {
      stageBefore: stageBefore,
      stageAfter: stageAfter,
      // 零改動路徑嘅重點就係「乜都唔應該變」，所以兩樣都要記。
      stageAdvanced: stageBefore !== stageAfter,
      versionCreated: versionAfter !== versionBefore,
      blocked: plan.blocked ? ('是：' + plan.blockReason) : '否',
      zeroChange: plan.zeroChange,
      zeroChangeAction: plan.zeroChangeAction === null ? '（沒有）' : plan.zeroChangeAction,
      gridChanges: (plan.gridChanges || []).length,
      pendingRequests: req.apply.length + req.confirm.length + req.needsInput.length,
      realViolations: ((plan.violations || {}).real || []).length
    };
  });

  // ── 步 3　寄給堂委審閱 ───────────────────────────────────
  runRehearsalStep_(steps, '步驟 3：寄給堂委審閱', function () {
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

  // ── 步 3.5　套用申報（零申報路徑）——為咗行到步驟 4 ─────────
  runRehearsalStep_(steps, '步驟 3.5：套用修改申報（零申報）', function () {
    const plan = planApplyRequests_(quarterId);
    const applied = applyRequests_(plan, [], VERSION_VALUES.BASIS_REQUESTS_APPLIED);
    return {
      requestCount: plan.results.length,
      versionNo: applied && applied.versionNo !== undefined ? applied.versionNo : '（回傳沒有這一欄）',
      stageAfter: getQuarterStage_(quarterId)
    };
  });

  // ── 步 4　正式發出給全體 ─────────────────────────────────
  runRehearsalStep_(steps, '步驟 4：正式發出給全體', function () {
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
  runRehearsalStep_(steps, '步驟 5：改動後重發', function () {
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

  return {
    quarterId: quarterId,
    baseline: baseline,
    steps: steps,
    after: readSeasonRehearsalBaseline_(quarterId),
    pdfFiles: readRehearsalPdfPaths_(quarterId),
    ics: readRehearsalIcsSample_(quarterId),
    highlight: readRehearsalHighlightSample_(quarterId)
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
 * @returns {{available: boolean, reason: string, rootName: string, files: Object[]}}
 */
function readRehearsalPdfPaths_(quarterId) {
  try {
    const rootName = resolveMailAttachmentFolder_().getName();
    const files = listRosterPdfFilesForQuarter_(quarterId).map(function (f) {
      return {
        name: f.name,
        sizeBytes: f.sizeBytes,
        // 根資料夾嘅檔案 ＝ 舊式平舖；子資料夾嘅先係分季分版。
        path: f.inSubfolder
          ? (rootName + ' / ' + quarterId + ' / ' + f.folderName + ' / ' + f.name)
          : (rootName + ' / ' + f.name),
        inSubfolder: f.inSubfolder
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

  rows.push(diagRow_('0. 起點', '季度', r.quarterId || '（沒有）', ''));
  rows.push(diagRow_('0. 起點', 'Stage', base.stage, '演練開始前'));
  rows.push(diagRow_('0. 起點', '最新版本號', base.latestVersionNo,
    '-1 代表這一季還沒有生成過任何版本'));
  rows.push(diagRow_('0. 起點', 'SendLog 行數', base.sendLogRows, ''));
  rows.push(diagRow_('0. 起點', 'PDF 檔案數', base.pdfFileCount, ''));

  // ── 逐步 ───────────────────────────────────────────────
  (r.steps || []).forEach(function (s, i) {
    const section = (i + 1) + '. ' + s.name;
    rows.push(diagRow_(section, '結果', s.ok ? '成功' : '失敗',
      s.ok ? '' : s.error));
    rows.push(diagRow_(section, '耗時', s.seconds + ' 秒',
      'B 段要知道整個流程要多久'));
    Object.keys(s.detail || {}).forEach(function (k) {
      rows.push(diagRow_(section, k, s.detail[k], ''));
    });
  });

  // ── PDF 資料夾結構 ─────────────────────────────────────
  const pdf = r.pdfFiles || { available: false, reason: '（沒有資料）', files: [] };
  if (!pdf.available) {
    // ⚠️ 查不到就講查不到。回一個 0 會令人以為「確認過，一份都沒有」。
    rows.push(diagRow_('PDF 資料夾', '查不到', pdf.reason,
      '不是「一份都沒有」——是根本讀不到資料夾'));
  } else {
    const inSub = pdf.files.filter(function (f) { return f.inSubfolder; }).length;
    rows.push(diagRow_('PDF 資料夾', '檔案總數', pdf.files.length, ''));
    rows.push(diagRow_('PDF 資料夾', '在「季度／版本」子資料夾裡', inSub,
      inSub === 0
        ? '⚠️ 一個都沒有——分季分版資料夾可能根本沒有建到，這是目前風險最高的未驗證項'
        : ''));
    rows.push(diagRow_('PDF 資料夾', '仍然平鋪在根資料夾', pdf.files.length - inSub, ''));
    pdf.files.forEach(function (f) {
      rows.push(diagRow_('PDF 逐個檔案', f.path, f.sizeBytes + ' bytes', ''));
    });
  }

  // ── ICS ───────────────────────────────────────────────
  const ics = r.ics || { available: false, reason: '（沒有資料）', lines: [] };
  if (!ics.available) {
    rows.push(diagRow_('ICS 附件', '查不到', ics.reason, ''));
  } else {
    ics.lines.forEach(function (line, i) {
      rows.push(diagRow_('ICS 附件', '第 ' + (i + 1) + ' 行', line,
        line.indexOf('NaN') !== -1
          ? '⚠️ 含 NaN——日期／時間沒有正規化，收件人的日曆會加不到這一項'
          : ''));
    });
    if (ics.lines.length === 0) {
      rows.push(diagRow_('ICS 附件', 'DTSTART／DTEND', '（一行都沒有）',
        '⚠️ 有產生檔案但找不到時間行'));
    }
  }

  // ── 個人 highlight ─────────────────────────────────────
  const hl = r.highlight || { available: false, reason: '（沒有資料）' };
  if (!hl.available) {
    rows.push(diagRow_('個人 highlight', '查不到', hl.reason, ''));
  } else {
    rows.push(diagRow_('個人 highlight', '抽樣的 PersonID', hl.personId,
      '選了這一季排得最多的那一位'));
    rows.push(diagRow_('個人 highlight', '應該被標示的格數', hl.cellCount,
      '這是按派工紀錄算出來的應有格數，沒有真的開啟 PDF 數過'));
  }

  // ── 收尾狀態 ───────────────────────────────────────────
  rows.push(diagRow_('完結', 'Stage', after.stage,
    '起點是 ' + base.stage));
  rows.push(diagRow_('完結', '最新版本號', after.latestVersionNo,
    '起點是 ' + base.latestVersionNo));
  rows.push(diagRow_('完結', 'SendLog 行數', after.sendLogRows,
    '起點是 ' + base.sendLogRows));
  rows.push(diagRow_('完結', 'PDF 檔案數', after.pdfFileCount,
    '起點是 ' + base.pdfFileCount));

  const failed = (r.steps || []).filter(function (s) { return !s.ok; });
  rows.push(diagRow_('完結', '失敗的步驟', failed.length,
    failed.length === 0 ? '' : failed.map(function (s) { return s.name; }).join('；')));

  // ── 清理（**工具唔會自己做**）───────────────────────────
  rows.push(diagRow_('清理', '這次演練建立了什麼',
    '版本 ' + base.latestVersionNo + ' → ' + after.latestVersionNo
    + '；SendLog ' + base.sendLogRows + ' → ' + after.sendLogRows
    + ' 行；PDF ' + base.pdfFileCount + ' → ' + after.pdfFileCount + ' 個檔案',
    ''));
  rows.push(diagRow_('清理', '要怎樣清走',
    '選單 ▸ 維護 ▸ ⚠️⚠️ 重設季度測試資料',
    '⚠️ 這個工具刻意不會自動清理——自動清理是不可逆動作，'
    + '不應該由一個測試工具代你決定。'));

  return rows;
}

/* ============================================================
 * 選單入口
 * ============================================================ */

/**
 * 選單「測試工具 ▸ ⚠️⚠️ 全季流程演練」。
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
    + '・為全體義工產生個人 PDF（每人一份，約幾十份）\n'
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
  // ⚠️ **唔捕捉回傳值。** 佢回嘅係「有冇成功寫入」嘅 boolean 值，唔係行數，
  // 而捕捉咗就一定有人會把佢當行數印出嚟（「共 true 行」實測撞過）。
  // 行數一律用 `rows.length`。
  tryWriteDiagnostics_(SEASON_REHEARSAL_REPORT, rows);

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
    + SEASON_REHEARSAL_REPORT + '」，共 ' + rows.length + ' 行'
    + (written ? '' : '（⚠️ 寫入失敗，見執行記錄）') + '。\n\n'
    + '⚠️ 演練留下的版本、PDF、SendLog 沒有自動清走，'
    + '報告最後一段列出了建立了什麼。',
    ui.ButtonSet.OK);
}
