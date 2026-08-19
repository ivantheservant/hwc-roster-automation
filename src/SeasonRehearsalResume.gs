/**
 * 全季流程演練——接續模式（第三十二輪批次階段 B 新增）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個
 * ─────────────────────────────────────────────────────────────────────
 *
 * 第一段（`runSeasonRehearsal_()`）會喺 3.5 分鐘死線內盡力產生個人 PDF，
 * 然後步驟 4 被缺件閘門攔住。**呢個係正確嘅行為**——實測 58 份要分
 * 3 次執行、共 552 秒，而單次 Apps Script 執行上限係 6 分鐘。
 *
 * 但後果係：**步驟 4（正式發出）同步驟 5（改動後重發）至今冇喺演練
 * 入面行過一次。** 而嗰兩步正正係 12 月 4 日最重要嗰兩步。
 *
 * 呢個工具就係嗰條路：撳多一兩次，把同一次演練行完。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 點解係「人手接續」而唔係「另開一個低人數沙盒季度」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 真正上線嗰陣，幹事本身就要為約 58 位義工分約 3 次撳「產生個人 PDF」。
 * 沙盒季度會把**培訓最需要幹事親身見到嗰件事**藏起嚟，
 * 令演練「行得完」但教錯咗嘢。
 *
 * 演練嘅用途係排練真實流程，唔係追求一次執行內走完。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 整個檔案最重要嗰一條守則
 * ─────────────────────────────────────────────────────────────────────
 *
 * **接續一個已經過時嘅狀態，比唔能夠接續更差。**
 *
 * 如果嗰一季喺演練之後又生成過新版本，`BaseVersionNo` 就同現實對唔上。
 * 照接續落去會排練一件**唔存在嘅事**——寄嘅係舊版本、對照嘅係新版本，
 * 而報告會理直氣壯咁話「全部成功」。所以版本號對唔上就一律拒絕，
 * 而且清走狀態。
 */

/* ============================================================
 * RehearsalState 工作表（最多一行）
 * ============================================================ */

/**
 * 取得（必要時建立）RehearsalState 工作表。
 * 沿用全專案慣例：第 1 行中文標題、第 2 行機器鍵、資料由第 3 行開始。
 * @returns {Sheet}
 */
function ensureRehearsalStateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.REHEARSAL_STATE);
  if (!sheet) sheet = ss.insertSheet(SHEETS.REHEARSAL_STATE);

  const C = COLUMNS.REHEARSAL_STATE;
  const keys = [C.QUARTER_ID, C.STARTED_AT, C.SEGMENT, C.BASE_VERSION_NO, C.STEPS_DONE,
    C.PDF_ROUNDS_DONE, C.PDF_DONE, C.STOPPED_BY, C.UPDATED_AT, C.NOTES];
  const titles = ['季度', '第一段開始時間', '已完成第幾段', '演練用的版本號', '已完成步驟',
    '累計已跑批數', 'PDF 是否產生完', '上一段為何停', '最後更新時間', '備註'];

  const existingKeys = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0]
    : [];
  const headerOk = keys.every(function (k, i) { return existingKeys[i] === k; });

  if (!headerOk) {
    sheet.getRange(1, 1, 1, titles.length).setValues([titles])
      .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]).setFontWeight('bold');
    sheet.setFrozenRows(2);
  }
  return sheet;
}

/**
 * 讀演練狀態。**冇紀錄回 `null`，唔係回一個空物件。**
 *
 * ⚠️ 回空物件嘅話，呼叫端寫 `if (state)` 會當成有紀錄，
 * 然後 `state.quarterId` 係 `undefined` ⇒ 接住去做一件冇季度嘅演練。
 * 呢個就係本專案第 2 條 bug class。
 *
 * @returns {?Object}
 */
function readRehearsalState_() {
  let rows;
  try {
    rows = readSheet(SHEETS.REHEARSAL_STATE);
  } catch (err) {
    return null;   // 張表未建過 ＝ 從來未演練過
  }
  const C = COLUMNS.REHEARSAL_STATE;
  const live = (rows || []).filter(function (r) {
    return String(r[C.QUARTER_ID] || '').trim() !== '';
  });
  if (live.length === 0) return null;

  // ⚠️ 理論上最多一行。真係多過一行就代表出過事，
  // **唔可以靜靜取第一行當冇事**——取最後一行（最新寫入），並且記低。
  const row = live[live.length - 1];
  return {
    quarterId: String(row[C.QUARTER_ID]).trim(),
    startedAt: String(row[C.STARTED_AT] || ''),
    segment: Number(row[C.SEGMENT]) || 0,
    baseVersionNo: Number(row[C.BASE_VERSION_NO]),
    stepsDone: String(row[C.STEPS_DONE] || ''),
    pdfRoundsDone: Number(row[C.PDF_ROUNDS_DONE]) || 0,
    // ⚠️ 工作表讀出嚟可能係 boolean 也可能係文字。兩者都要認。
    pdfDone: String(row[C.PDF_DONE]).trim().toUpperCase() === 'TRUE',
    stoppedBy: String(row[C.STOPPED_BY] || ''),
    updatedAt: String(row[C.UPDATED_AT] || ''),
    notes: String(row[C.NOTES] || ''),
    extraRows: live.length - 1
  };
}

/**
 * 寫演練狀態。**永遠只有一行**——先清空資料區再寫。
 * @param {Object} state
 * @returns {void}
 */
function writeRehearsalState_(state) {
  const sheet = ensureRehearsalStateSheet_();
  const C = COLUMNS.REHEARSAL_STATE;
  const keys = [C.QUARTER_ID, C.STARTED_AT, C.SEGMENT, C.BASE_VERSION_NO, C.STEPS_DONE,
    C.PDF_ROUNDS_DONE, C.PDF_DONE, C.STOPPED_BY, C.UPDATED_AT, C.NOTES];

  const lastRow = sheet.getLastRow();
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, keys.length).clearContent();

  sheet.getRange(3, 1, 1, keys.length).setValues([[
    String(state.quarterId || ''),
    String(state.startedAt || ''),
    Number(state.segment) || 0,
    Number(state.baseVersionNo),
    String(state.stepsDone || ''),
    Number(state.pdfRoundsDone) || 0,
    // ⚠️ 寫文字 `'TRUE'`／`'FALSE'`，唔寫 boolean——
    // 試算表會把 boolean 顯示成 `TRUE`，但讀返出嚟嘅型別唔穩定。
    state.pdfDone ? 'TRUE' : 'FALSE',
    String(state.stoppedBy || ''),
    nowTimestamp_(),
    String(state.notes || '')
  ]]);
}

/**
 * 清走演練狀態。演練全部行完之後一定要叫——
 * 留低一行舊狀態會令下一次「接續」接住一個唔存在嘅演練。
 * @returns {void}
 */
function clearRehearsalState_() {
  const sheet = ensureRehearsalStateSheet_();
  const lastRow = sheet.getLastRow();
  const width = Object.keys(COLUMNS.REHEARSAL_STATE).length;
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, width).clearContent();
}

/* ============================================================
 * 可唔可以接續（純函式，可離線測）
 * ============================================================ */

/**
 * 判斷可唔可以接續。**純函式**——所有輸入由呼叫端讀好傳入。
 *
 * @param {?Object} state `readRehearsalState_()` 的結果
 * @param {number} currentLatestVersionNo 該季度現時最新版本號
 * @returns {{ok: boolean, clearState: boolean, reason: string}}
 *   `clearState` ＝ 拒絕之餘要唔要順手清走狀態
 */
function evaluateRehearsalResume_(state, currentLatestVersionNo) {
  if (!state) {
    return {
      ok: false, clearState: false,
      reason: '現時沒有未完成的演練，請先執行「全季流程演練」。\n\n'
        + '（這個工具只負責把一次已經開始、但因為時間不夠而停在半路的演練行完，'
        + '它不會自己開始一次新的演練。）'
    };
  }

  // ⚠️ **一定要用 `toFiniteNumberOrNull_()`，唔可以用 `Number()`。**
  //
  // `Number(null)` ＝ 0、`Number('')` ＝ 0。即係「查唔到版本號」會靜靜
  // 變成「現時係 v0」，然後同 v7 一比就報「這一季又生成過新版本」，
  // **而且順手清走演練狀態**——一個讀唔到嘅瞬間會毀咗一次演練。
  // 呢條係先寫測試（餵 `null`）先發現嘅。
  const current = toFiniteNumberOrNull_(currentLatestVersionNo);
  const base = toFiniteNumberOrNull_(state.baseVersionNo);

  // ⚠️ 讀唔到版本號 ⇒ **唔可以當成對得上**。
  //「查不到」同「查到係啱」係兩件事，而估錯嗰邊嘅代價係排練一件冇發生嘅事。
  if (current === null || base === null) {
    return {
      ok: false, clearState: false,
      reason: '查不到版本號（演練狀態記的是「' + state.baseVersionNo
        + '」，現時查到的是「' + currentLatestVersionNo + '」），不敢接續下去。\n\n'
        + '請確認 Quarters／RosterAssignments 沒有問題，或者重新由第一段開始。'
    };
  }

  if (current !== base) {
    return {
      ok: false, clearState: true,
      reason: '這一季在演練之後又生成過新版本（現時 v' + current
        + '，演練用的是 v' + base + '），接續下去會排練一件不存在的事。\n\n'
        + '演練狀態已經清走，請重新由「全季流程演練」第一段開始。'
    };
  }

  return { ok: true, clearState: false, reason: '' };
}

/* ============================================================
 * 執行一段接續
 * ============================================================ */

/**
 * 行一段接續。**唔碰 UI**，方便由測試直接叫。
 *
 * 流程：
 *   1. 續跑個人 PDF（同樣死線 ＋ 批次上限，由**這一段**開始計）
 *   2. 仲未 done ⇒ 更新狀態、回報「還要再撳一次」
 *   3. done ⇒ 行步驟 4、步驟 5，然後清走狀態
 *
 * ⚠️ 中途拋錯**唔會清走狀態**——清走等於逼人由頭再嚟一次，
 * 而佢已經行咗大半。`runRehearsalStep_()` 本身唔會把錯拋出去。
 *
 * @param {Object} state `readRehearsalState_()` 的結果（已通過 `evaluateRehearsalResume_()`）
 * @returns {Object} 記落報告嘅內容
 */
function executeSeasonRehearsalResume_(state) {
  const quarterId = state.quarterId;
  const versionNo = Number(state.baseVersionNo);
  const segment = (Number(state.segment) || 1) + 1;
  const segmentStartedAtMs = Date.now();
  const steps = [];

  // ── 續跑個人 PDF ────────────────────────────────────────
  let pdf = null;
  if (state.pdfDone) {
    // 上一段已經產生完，今段直接行步驟 4、5。
    pdf = { finished: true, rounds: 0, roundsTotal: state.pdfRoundsDone,
      note: '上一段已經產生完，這一段不用再跑。' };
    steps.push({ name: '步驟 3.5：產生個人 PDF（續跑）', ok: true, seconds: 0,
      preconditionText: '（沒有前置條件）', preconditionMet: true, detail: pdf, error: '' });
  } else {
    pdf = runRehearsalStep_(steps, '步驟 3.5：產生個人 PDF（續跑）',
      { quarterId: quarterId }, function () {
        return runRehearsalPdfBatches_(quarterId, versionNo,
          segmentStartedAtMs, state.pdfRoundsDone);
      });
  }

  const pdfDone = !!(pdf && pdf.finished);
  const roundsTotal = (pdf && pdf.roundsTotal !== undefined)
    ? pdf.roundsTotal : state.pdfRoundsDone;

  if (!pdfDone) {
    // 仲未完 ⇒ 更新狀態，等幹事再撳一次。
    writeRehearsalState_({
      quarterId: quarterId, startedAt: state.startedAt, segment: segment,
      baseVersionNo: versionNo, stepsDone: state.stepsDone,
      pdfRoundsDone: roundsTotal, pdfDone: false,
      stoppedBy: (pdf && pdf.stoppedBy) || '（這一段沒有跑到，見報告）',
      notes: state.notes
    });
    return {
      quarterId: quarterId, segment: segment, versionNo: versionNo,
      steps: steps, completed: false, stateCleared: false,
      startedAt: state.startedAt,
      nextAction: '個人 PDF 還沒有產生完，請再撳一次「全季流程演練（接續上一段）」。'
        + '產生完之後系統會自動接住行步驟 4 同步驟 5。'
    };
  }

  // ── 步驟 4　正式發出給全體 ──────────────────────────────
  runRehearsalStep_(steps, '步驟 4：正式發出給全體',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.OFFICIAL_SEND }, function () {
      const warn = planStep4Warnings_(quarterId);
      const missing = planStep4MissingPdf_(quarterId, warn.versionNo);
      const preview = planStep4SendPreview_(quarterId, warn.versionNo);
      const sendLogBefore = countRehearsalSendLogRows_(quarterId);
      const result = executeStep4Send_(quarterId);
      return {
        versionNo: warn.versionNo,
        pendingCells: warn.pendingCells.length,
        missingPdf: missing.missing ? missing.missing.length : '（回傳沒有這一欄）',
        recipientCount: preview.recipientCount,
        isDryRun: preview.isDryRun,
        sendLogAdded: countRehearsalSendLogRows_(quarterId) - sendLogBefore,
        skipped: (result && result.skipped !== undefined) ? result.skipped : '（回傳沒有這一欄）',
        outcomeSentence: result ? result.outcomeSentence : '',
        stageAfter: getQuarterStage_(quarterId)
      };
    });

  // ── 步驟 5　改動後重發 ─────────────────────────────────
  runRehearsalStep_(steps, '步驟 5：改動後重發',
    { quarterId: quarterId, stepKey: FLOW_STEP_KEYS.RESEND }, function () {
      const plan = planStep5ChangedList_(quarterId);
      return {
        versionNo: plan.versionNo,
        changedCount: plan.changedList.length,
        note: plan.changedList.length === 0
          ? '沒有人有改動，所以沒有寄——這正是預期結果（演練中途沒有改過任何格子）'
          : '有 ' + plan.changedList.length + ' 人被判定為有改動，但演練沒有改過任何格子，請查'
      };
    });

  // ⚠️ 行完先清狀態。清咗之後再拋錯嘅話，狀態已經冇咗——
  // 所以清狀態一定要係最後一步。
  clearRehearsalState_();

  return {
    quarterId: quarterId, segment: segment, versionNo: versionNo,
    steps: steps, completed: true, stateCleared: true,
    startedAt: state.startedAt, nextAction: ''
  };
}

/* ============================================================
 * 報告
 * ============================================================ */

/**
 * 接續段嘅報告行。**特登寫得短**（目標 80 行以內）——
 * 第一段已經寫過嘅嘢唔重複，否則兩三段合起嚟會迫爆
 * `DIAGNOSTICS_MAX_ROWS_TOTAL`（380）。
 *
 * @param {Object} record `executeSeasonRehearsalResume_()` 的結果
 * @returns {Object[]} `diagRow_()` 的行
 */
function buildRehearsalResumeRows_(record) {
  const rows = [];
  const seg = record.segment;

  rows.push(diagRow_('這一段是什麼', '分段',
    '本次演練由多段執行完成，這是第 ' + seg + ' 段',
    '前一段見報告「' + seasonRehearsalReportName_(seg - 1) + '」。'
    + '這一段只寫步驟 3.5 續跑、步驟 4、步驟 5，前面幾步不重複。'));
  rows.push(diagRow_('這一段是什麼', '季度', String(record.quarterId), ''));
  rows.push(diagRow_('這一段是什麼', '沿用版本', 'v' + record.versionNo,
    '接續不會生成新版本。版本號對不上時工具會拒絕接續。'));

  record.steps.forEach(function (s) {
    const label = s.name;
    rows.push(diagRow_(label, '前置條件', String(s.preconditionText),
      s.preconditionMet ? '' : '⚠️ 不符合'));
    rows.push(diagRow_(label, '結果', s.ok ? '成功' : '失敗',
      s.ok ? (s.seconds + ' 秒') : String(s.error)));
    const detail = s.detail || {};
    Object.keys(detail).forEach(function (k) {
      rows.push(diagRow_(label, k, stringifyDiagValue_(detail[k]), ''));
    });
  });

  if (!record.completed) {
    rows.push(diagRow_('接下來', '還沒有完成', '需要再撳一次接續',
      String(record.nextAction)));
    return rows;
  }

  // ── 最後一段先寫嘅總結 ─────────────────────────────────
  const failed = record.steps.filter(function (s) { return !s.ok; });
  rows.push(diagRow_('總結', '合共幾段', seg + ' 段', ''));
  rows.push(diagRow_('總結', '由開始到完成', describeRehearsalSpanMinutes_(record.startedAt),
    '由第一段開始計。'));
  rows.push(diagRow_('總結', '這一段失敗步數', String(failed.length),
    failed.length === 0 ? '' : failed.map(function (s) { return s.name; }).join('、')));
  rows.push(diagRow_('總結', '演練狀態', '已清走',
    'RehearsalState 工作表已經清空——留低一行舊狀態會令下一次接續'
    + '接住一個不存在的演練。'));
  return rows;
}

/**
 * 由第一段開始到而家經過幾多分鐘。
 * ⚠️ 算唔到就要講「算不出來」，**唔可以回 0**——
 * 0 分鐘會令人以為成件事一秒完成。
 * @param {string} startedAt
 * @returns {string}
 */
function describeRehearsalSpanMinutes_(startedAt) {
  const text = String(startedAt || '').trim();
  if (text === '') return '（算不出來——狀態裡沒有開始時間）';
  const t = new Date(text).getTime();
  if (isNaN(t)) return '（算不出來——開始時間「' + text + '」認不出格式）';
  return Math.round((Date.now() - t) / 60000) + ' 分鐘';
}

/* ============================================================
 * 選單入口
 * ============================================================ */

/**
 * 選單「測試工具 ▸ ▶️ 全季流程演練（接續上一段）」。
 * @returns {void}
 */
function runSeasonRehearsalResume_() {
  const ui = SpreadsheetApp.getUi();
  const title = '全季流程演練（接續上一段）';

  const state = readRehearsalState_();

  // ⚠️ 冇狀態嗰陣**乜都唔可以寫**——連建張表都唔好。
  // 「撳錯咗」係最常見嘅情況，唔應該留低任何痕跡。
  if (!state) {
    ui.alert(title, evaluateRehearsalResume_(null, -1).reason, ui.ButtonSet.OK);
    return;
  }

  let latest;
  try {
    latest = findLatestVersionNo(state.quarterId);
  } catch (err) {
    latest = NaN;
  }
  const verdict = evaluateRehearsalResume_(state, latest);
  if (!verdict.ok) {
    if (verdict.clearState) clearRehearsalState_();
    ui.alert(title, verdict.reason, ui.ButtonSet.OK);
    return;
  }

  // ── 確認畫面 ───────────────────────────────────────────
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const pdfNote = state.pdfDone
    ? '個人 PDF 上一段已經產生完，這一段直接行步驟 4 同步驟 5。'
    : '這一段會續跑個人 PDF（已經跑了 ' + state.pdfRoundsDone + ' 批），'
      + '產生完就自動接住行步驟 4 同步驟 5；還未產生完就會再停一次，'
      + '請再撳一次接續。';

  const confirm = ui.prompt(title,
    '接續中的演練：\n'
    + '　季度：' + state.quarterId + '\n'
    + '　第一段開始：' + state.startedAt + '\n'
    + '　已完成：第 ' + state.segment + ' 段\n'
    + '　上一段為何停：' + (state.stoppedBy || '（沒有記錄）') + '\n\n'
    + '這一段會做：\n'
    + '　' + pdfNote + '\n\n'
    + '⚠️ 不會再生成新版本，會沿用 v' + state.baseVersionNo + '。\n\n'
    + 'DRY_RUN 現時是 ' + (isDryRun ? 'TRUE' : 'FALSE') + '。'
    + (isDryRun
      ? '整個寄送流程會走完，但信不會離開系統。\n\n'
      : '\n\n⚠️⚠️ DRY_RUN 不是 TRUE，信會真的寄出去。請先到 Config 改回 TRUE。\n\n')
    + '確定要執行，請輸入「' + SEASON_REHEARSAL_CONFIRM_WORD + '」。',
    ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;

  // ⚠️ 打字確認同 DRY_RUN 都要重新查一次——用返第一段嗰四道閘，
  // 唔喺呢度另寫一套（第三十一輪階段 B2 就係修呢個毛病）。
  const guard = evaluateSeasonRehearsalGuards_({
    isDryRun: isDryRun,
    quarterId: state.quarterId,
    protectedQuarters: readRehearsalProtectedQuarters_(),
    typedText: confirm.getResponseText()
  });
  if (guard.blocked) {
    ui.alert(title, '不能執行：\n\n・' + guard.reasons.join('\n\n・'), ui.ButtonSet.OK);
    return;
  }

  SpreadsheetApp.getActiveSpreadsheet().toast('接續中，可能要幾分鐘…', title, 300);

  const record = executeSeasonRehearsalResume_(state);
  const rows = buildRehearsalResumeRows_(record);
  const reportName = seasonRehearsalReportName_(record.segment);
  const wrote = tryWriteDiagnosticsDetailed_(reportName, rows);

  const failed = record.steps.filter(function (s) { return !s.ok; });
  ui.alert(title,
    (record.completed ? '這一次演練已經全部行完。\n\n' : '這一段做完了，但還沒有行完。\n\n')
    + '這一段失敗 ' + failed.length + ' 步'
    + (failed.length === 0 ? '' : '：' + failed.map(function (s) { return s.name; }).join('、'))
    + '\n\n'
    + '報告已寫入 ' + SHEETS.DIAGNOSTICS + '，報告名稱「' + reportName + '」，共 '
    + rows.length + ' 行。\n'
    + (wrote.ok ? '' : ('\n⚠️ 寫入失敗，Diagnostics 裡面沒有這份報告。\n原因：'
      + wrote.error + '\n'))
    + (record.completed
      ? '\n⚠️ 演練留下的版本、PDF、SendLog 沒有自動清走。'
        + '要清理請用「⚠️⚠️ 重設季度測試資料」。'
      : '\n' + record.nextAction),
    ui.ButtonSet.OK);
}
