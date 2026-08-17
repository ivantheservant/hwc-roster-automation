/**
 * 階段 B（Opus 深度輪）新增：SendLog 與 RosterAssignments 的歸檔（封存）機制。
 *
 * ============================================================
 * 為什麼需要（背景）
 * ============================================================
 * 這兩張表只增不減，而 readSheet()（SheetReader.gs）每次都是整表讀取——
 * 沒有伺服器端篩選這回事，Google Sheets 的 getValues() 一定把整個範圍取回來。
 * 每生成一個版本就多約 195 行 RosterAssignments、每寄一次信就多幾十行
 * SendLog，用幾年之後這兩張表會漲到幾萬行，令步驟 3／5 與生成初稿越來越慢。
 * 完整的規模評估見 docs/系統範圍稽核.md 第六輪批次階段 D。
 *
 * ============================================================
 * 採用哪一個設計方向，以及為什麼（B1）
 * ============================================================
 * 上一輪列了三個方向，本輪重新評估後採用 **方向一（按季度封存到獨立工作表）
 * ＋ 方向三（在全面體檢加規模提示）**，不採用方向二。逐一說明：
 *
 * - **採用方向一**：封存單位是「整個季度」，搬到 SendLog_Archive／
 *   RosterAssignments_Archive 兩張新表。優點是 readSheet() 與全部讀取邏輯
 *   一行都不用改——正在用的資料仍然在原本那張表、格式完全一樣。這正好符合
 *   本輪「執行部分必須是最保守的做法」的要求。
 *
 * - **不採用方向二（另建 SendLogSummary 小表，hash 比對改讀它）**：那會把
 *   步驟 5 hash 比對的**資料來源**由「實際寄送紀錄」換成「另一張要靠寫入時
 *   同步維護的摘要表」。一旦同步漏寫（最容易發生的正是中斷復原情境，見
 *   docs/中斷復原指引.md），後果是**重複寄信給幾十位義工**——不可逆、而且
 *   對外。用「換掉關鍵資料的來源」去換取效能，跟本輪的保守要求相反，所以
 *   放棄。這是評估後主動否決原方向的決定，不是漏做。
 *
 * - **同時採用方向三**：封存是有風險的動作，不應該變成例行公事。全面體檢
 *   加一項規模提示（見 FullHealthCheck.gs 的 classifyTableSizeHealth_()），
 *   等 Ivan 在資料真的大到值得處理時才收到提示，而不是現在就急著封存。
 *
 * ============================================================
 * 封存資格：三重條件 + 一條保命規則（B3 的核心）
 * ============================================================
 * 一個季度**同時滿足以下三項**才可以封存：
 *   1. `EndDate` 已經完全過去（季度真的結束了）
 *   2. `Stage` 是 `OFFICIAL_SENT`（流程正常走完，不是中途卡住的季度）
 *   3. 不屬於最近 ARCHIVE_KEEP_RECENT_QUARTERS 個季度（保護
 *      `readPriorWeeks_()` 的跨季界「連續兩週」判斷，見該常數說明）
 *
 * 第 1 條是最關鍵的：**步驟 5「改動後重發」的前置條件正是 Stage=OFFICIAL_SENT**，
 * 所以單靠第 2 條完全擋不住「封存了還可能要重發」的季度。加上「季度已經
 * 結束」才能確定不會再有人要為那一季重發職事表。
 *
 * 【保命規則】即使一個季度符合全部條件，SendLog 仍然會**保留每人在該季度
 * 最後一次「已確實處理」的紀錄**（Status 屬於 SENT／DRY_RUN／
 * SKIPPED_NO_EMAIL，跟 readLastSendRecordByPerson_() 的白名單逐字一致）。
 * 理由：萬一有人真的對一個已封存的季度執行步驟 5，`lastHashByPerson` 仍然
 * 查得到基準，不會把每一個人都當成「內容有改動」而重複寄信。這是 B3 明確
 * 建議的做法（「每人最後一次寄送紀錄永不封存」），以防守換取正確性。
 * 代價只是每個封存季度留低約 89 行（相對於整季約 700 行），微不足道。
 *
 * ============================================================
 * 安全設計
 * ============================================================
 * - **plan-only 優先**：planArchive_() 完全唯讀，列出將封存什麼、封存後剩多少。
 * - **打字確認**：executeArchive_() 只由 runArchiveExecute_() 呼叫，要逐字
 *   輸入 ARCHIVE_CONFIRM_TEXT。
 * - **搬移不是刪除**：原始列先完整寫入封存表，確認寫入成功之後才從原表刪除。
 *   任何一步失敗都會拋錯並講清楚現況（可能出現「兩邊都有」的重複狀態，
 *   那是刻意選擇——寧可重複也不要遺失）。
 */

/**
 * 判斷一個 SendLog 的 Status 是否屬於「已確實處理」——跟 Mailer.gs 的
 * readLastSendRecordByPerson_() 用同一份白名單。刻意不共用一個常數陣列而是
 * 各自寫一次的話會走樣，所以這裡直接引用同樣三個 MAIL_STATUS 常數，日後
 * 如果那邊的白名單改了，這裡的註解會提醒要同步。
 * @param {string} status SendLog 的 Status 欄值
 * @returns {boolean}
 */
function isBaselineSendStatus_(status) {
  const normalized = String(status || '').toUpperCase();
  return normalized === MAIL_STATUS.SENT
    || normalized === MAIL_STATUS.DRY_RUN
    || normalized === MAIL_STATUS.SKIPPED_NO_EMAIL;
}

/**
 * 找出目前全部季度，按 StartDate 由新到舊排序，並標示每一季是否可以封存。
 * 純讀取。
 * @param {string} today 今天的日期字串（yyyy-MM-dd），由呼叫端提供方便測試
 * @param {string} timezone 時區
 * @returns {Object[]} 每項為 {quarterId, startDate, endDate, stage, archivable, reason}
 */
function classifyQuartersForArchive_(today, timezone) {
  const C = COLUMNS.QUARTERS;
  const rows = readSheet(SHEETS.QUARTERS).filter(function (row) { return !!row[C.QUARTER_ID]; });

  const quarters = rows.map(function (row) {
    const quarterId = row[C.QUARTER_ID];
    let stage = '';
    try { stage = getQuarterStage_(quarterId); } catch (err) { stage = ''; }
    return {
      quarterId: quarterId,
      startDate: toDateString(row[C.START_DATE], timezone),
      endDate: toDateString(row[C.END_DATE], timezone),
      stage: stage
    };
  });

  // 由新到舊：StartDate 大的排前面。StartDate 空白的一律當成「最新」排最前，
  // 確保資料不完整的季度絕不會因為排序而被誤判成「舊到可以封存」。
  quarters.sort(function (a, b) {
    if (!a.startDate) return -1;
    if (!b.startDate) return 1;
    return a.startDate < b.startDate ? 1 : (a.startDate > b.startDate ? -1 : 0);
  });

  return quarters.map(function (q, index) {
    const reasons = [];
    if (index < ARCHIVE_KEEP_RECENT_QUARTERS) {
      reasons.push('屬於最近 ' + ARCHIVE_KEEP_RECENT_QUARTERS
        + ' 個季度，一律保留（保護跨季界的「連續兩週」判斷）');
    }
    if (!q.endDate) {
      reasons.push('EndDate 空白，無法確認季度是否已經結束');
    } else if (q.endDate >= today) {
      reasons.push('季度尚未結束（EndDate ' + q.endDate + '）');
    }
    if (q.stage !== QUARTER_STAGE.OFFICIAL_SENT) {
      reasons.push('Stage 是「' + (q.stage || '（讀不到）') + '」，不是 OFFICIAL_SENT');
    }
    return Object.assign({}, q, {
      archivable: reasons.length === 0,
      reason: reasons.join('；')
    });
  });
}

/**
 * 封存計畫（plan-only，完全唯讀，不改動任何工作表）。
 *
 * @param {string=} today 今天的日期字串；省略時由 Config 的時區即時計算
 * @returns {Object} 計畫內容，見下方回傳欄位說明
 */
function planArchive_(today) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const asOf = today || Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

  const quarters = classifyQuartersForArchive_(asOf, timezone);
  const archivableIds = {};
  quarters.forEach(function (q) { if (q.archivable) archivableIds[q.quarterId] = true; });

  const sendLog = planSendLogArchive_(archivableIds);
  const assignments = planAssignmentsArchive_(archivableIds, timezone);

  // 安全檢查：CARRY_OVER_WEEKS 有沒有大到「保留的季度都不夠用」
  const carryOverWeeks = Number(getConfig(CONFIG_KEYS.CARRY_OVER_WEEKS, 0)) || 0;
  const keptQuarters = quarters.slice(0, ARCHIVE_KEEP_RECENT_QUARTERS);
  const warnings = [];
  if (carryOverWeeks > 13 * ARCHIVE_KEEP_RECENT_QUARTERS) {
    warnings.push('Config 的 CARRY_OVER_WEEKS＝' + carryOverWeeks + ' 週，超過保留的 '
      + ARCHIVE_KEEP_RECENT_QUARTERS + ' 個季度（約 ' + (13 * ARCHIVE_KEEP_RECENT_QUARTERS)
      + ' 週）所能覆蓋的範圍。封存之後，生成新一季時的跨季界「連續兩週」判斷'
      + '可能會少了最早那幾週的基準。建議先調低 CARRY_OVER_WEEKS，或不要封存。');
  }

  return {
    asOf: asOf,
    quarters: quarters,
    keptQuarters: keptQuarters,
    archivableQuarterIds: Object.keys(archivableIds).sort(),
    sendLog: sendLog,
    assignments: assignments,
    warnings: warnings,
    totalRowsToArchive: sendLog.rowsToArchive.length + assignments.rowsToArchive.length
  };
}

/**
 * 計算 SendLog 的封存內容。純讀取。
 *
 * 保命規則在這裡實作：屬於可封存季度的列**大部分**會搬走，但每個
 * 「季度＋PersonID」組合最後一次「已確實處理」的那一列會留在原表——
 * 詳見本檔案檔頭「保命規則」一段。
 *
 * @param {Object.<string, boolean>} archivableIds 可封存的季度 ID
 * @returns {{totalRows: number, rowsToArchive: Object[], keptBaselineRows: Object[],
 *   remainingRows: number}}
 */
function planSendLogArchive_(archivableIds) {
  const C = COLUMNS.SEND_LOG;
  const rows = readSheet(SHEETS.SEND_LOG);

  // 先找出每個「季度＋PersonID」最後一次已確實處理的列。readSheet() 依工作表
  // 由上至下回傳，而 SendLog 一律 append，所以後出現的就是較新的——這跟
  // readLastSendRecordByPerson_() 用同一個假設（它也是逐行覆寫、取最後一個）。
  const baselineIndexByKey = {};
  rows.forEach(function (row, index) {
    if (!archivableIds[row[C.QUARTER_ID]]) return;
    const personId = row[C.PERSON_ID];
    if (!personId) return;
    if (!isBaselineSendStatus_(row[C.STATUS])) return;
    baselineIndexByKey[row[C.QUARTER_ID] + '|' + personId] = index;
  });
  const keepIndexes = {};
  Object.keys(baselineIndexByKey).forEach(function (key) { keepIndexes[baselineIndexByKey[key]] = true; });

  const rowsToArchive = [];
  const keptBaselineRows = [];
  rows.forEach(function (row, index) {
    if (!archivableIds[row[C.QUARTER_ID]]) return;
    if (keepIndexes[index]) {
      keptBaselineRows.push({ rowIndex: index, quarterId: row[C.QUARTER_ID], personId: row[C.PERSON_ID] });
      return;
    }
    rowsToArchive.push({ rowIndex: index, quarterId: row[C.QUARTER_ID], sendId: row[C.SEND_ID] });
  });

  return {
    totalRows: rows.length,
    rowsToArchive: rowsToArchive,
    keptBaselineRows: keptBaselineRows,
    remainingRows: rows.length - rowsToArchive.length
  };
}

/**
 * 計算 RosterAssignments 的封存內容。純讀取。
 *
 * 這一張表不需要 SendLog 那條保命規則：讀取它的函式全部都是「指定季度＋
 * 指定版本」（buildMailContext_／buildFineTuneContext_／apiGetRosterGrid 等），
 * 唯一跨季度的是 readPriorWeeks_()，而那個已經由「保留最近 N 個季度」保護。
 *
 * @param {Object.<string, boolean>} archivableIds 可封存的季度 ID
 * @param {string} timezone 時區
 * @returns {{totalRows: number, rowsToArchive: Object[], remainingRows: number,
 *   byQuarter: Object.<string, number>}}
 */
function planAssignmentsArchive_(archivableIds, timezone) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const rows = readSheet(SHEETS.ROSTER_ASSIGNMENTS);
  const rowsToArchive = [];
  const byQuarter = {};

  rows.forEach(function (row, index) {
    const quarterId = row[C.QUARTER_ID];
    if (!archivableIds[quarterId]) return;
    rowsToArchive.push({ rowIndex: index, quarterId: quarterId, versionNo: Number(row[C.VERSION_NO]) });
    byQuarter[quarterId] = (byQuarter[quarterId] || 0) + 1;
  });

  return {
    totalRows: rows.length,
    rowsToArchive: rowsToArchive,
    remainingRows: rows.length - rowsToArchive.length,
    byQuarter: byQuarter
  };
}

/**
 * 依計畫實際執行封存：**搬移，不是刪除**。
 *
 * 執行順序刻意設計成「先複製到封存表、確認寫入成功，才從原表刪除」——
 * 中途失敗時最壞的情況是「兩邊都有同一筆資料」（重複），而不是「兩邊都無」
 * （遺失）。重複可以人手清理，遺失不能。
 *
 * ⚠️ 只可以由 runArchiveExecute_() 在打字確認之後呼叫。
 *
 * @param {Object} plan planArchive_() 的結果
 * @returns {{sendLogArchived: number, assignmentsArchived: number}}
 */
function executeArchive_(plan) {
  const sendLogArchived = moveRowsToArchive_(
    SHEETS.SEND_LOG, SHEETS.SEND_LOG_ARCHIVE,
    plan.sendLog.rowsToArchive.map(function (r) { return r.rowIndex; }));

  const assignmentsArchived = moveRowsToArchive_(
    SHEETS.ROSTER_ASSIGNMENTS, SHEETS.ROSTER_ASSIGNMENTS_ARCHIVE,
    plan.assignments.rowsToArchive.map(function (r) { return r.rowIndex; }));

  return { sendLogArchived: sendLogArchived, assignmentsArchived: assignmentsArchived };
}

/**
 * 把來源表指定的資料列搬到封存表：先複製、後刪除。
 *
 * rowIndexes 是 readSheet() 回傳陣列的索引（0-based，已略過第 1、2 行的
 * 說明列與標題列，也已經略過整行全空的列）——所以**不可以**直接當成工作表
 * 列號用。這裡重新讀一次原始範圍、按同一套「略過全空列」的規則對齊，
 * 確保搬的是同一批列。
 *
 * @param {string} sourceName 來源工作表名稱
 * @param {string} archiveName 封存工作表名稱
 * @param {number[]} rowIndexes readSheet() 索引清單
 * @returns {number} 實際搬移的列數
 */
function moveRowsToArchive_(sourceName, archiveName, rowIndexes) {
  if (rowIndexes.length === 0) return 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(sourceName);
  if (!source) throw new Error('找不到工作表: ' + sourceName);

  const lastRow = source.getLastRow();
  const lastCol = source.getLastColumn();
  if (lastRow < 3) return 0;

  const titleRow = source.getRange(1, 1, 1, lastCol).getValues()[0];
  const headerRow = source.getRange(2, 1, 1, lastCol).getValues()[0];
  const dataRows = source.getRange(3, 1, lastRow - 2, lastCol).getValues();

  // 依 readSheet() 的規則重建「索引 → 實際工作表列號」的對照：
  // readSheet() 會略過整行全空的列，所以兩者不是簡單的 +3。
  const sheetRowByIndex = [];
  dataRows.forEach(function (row, i) {
    const isEmpty = row.every(function (v) { return v === '' || v === null; });
    if (!isEmpty) sheetRowByIndex.push(i + 3);
  });

  const wanted = {};
  rowIndexes.forEach(function (idx) { wanted[idx] = true; });
  const targets = [];
  sheetRowByIndex.forEach(function (sheetRow, idx) {
    if (wanted[idx]) targets.push({ sheetRow: sheetRow, values: dataRows[sheetRow - 3] });
  });
  if (targets.length === 0) return 0;

  // ---- 第一步：寫入封存表（先確保資料安全落地）----
  let archive = ss.getSheetByName(archiveName);
  if (!archive) {
    archive = ss.insertSheet(archiveName);
    archive.getRange(1, 1, 1, titleRow.length).setValues([titleRow])
      .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
    archive.getRange(2, 1, 1, headerRow.length).setValues([headerRow]).setFontWeight('bold');
    archive.setFrozenRows(2);
  }
  const archiveTarget = Math.max(3, archive.getLastRow() + 1);
  archive.getRange(archiveTarget, 1, targets.length, lastCol)
    .setValues(targets.map(function (t) { return t.values; }));
  SpreadsheetApp.flush();

  // ---- 第二步：確認真的寫入了，才從原表刪除 ----
  const writtenRows = archive.getLastRow() - archiveTarget + 1;
  if (writtenRows < targets.length) {
    throw new Error('封存 ' + sourceName + ' 時，寫入 ' + archiveName + ' 的列數（' + writtenRows
      + '）少於預期（' + targets.length + '），為安全起見已中止——原表任何資料都沒有刪除。'
      + '請檢查 ' + archiveName + ' 的內容，人手清理之後再重新執行。');
  }

  // 由下而上刪除，避免刪除過程中列號位移
  targets.sort(function (a, b) { return b.sheetRow - a.sheetRow; });
  targets.forEach(function (t) { source.deleteRow(t.sheetRow); });

  return targets.length;
}

/* ============================================================
 * 選單入口
 * ============================================================ */

/**
 * 選單項目「維護 ▸ 封存舊季度資料（唯讀預覽）」的執行入口。完全唯讀。
 * @returns {void}
 */
function runArchivePlan_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planArchive_();
  } catch (err) {
    log_('ERROR', 'runArchivePlan_ 失敗: ' + err.message);
    ui.alert('封存舊季度資料（唯讀預覽）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = buildArchivePlanLines_(plan);
  const rows = [
    diagRow_('封存預覽', '計算日期', plan.asOf, ''),
    diagRow_('封存預覽', '可封存季度', plan.archivableQuarterIds.join('、') || '（沒有）', ''),
    diagRow_('封存預覽', 'SendLog 將封存', plan.sendLog.rowsToArchive.length + ' 行',
      '封存後剩 ' + plan.sendLog.remainingRows + ' 行（含刻意保留的 '
      + plan.sendLog.keptBaselineRows.length + ' 行每人最後紀錄）'),
    diagRow_('封存預覽', 'RosterAssignments 將封存', plan.assignments.rowsToArchive.length + ' 行',
      '封存後剩 ' + plan.assignments.remainingRows + ' 行')
  ];
  plan.quarters.forEach(function (q) {
    rows.push(diagRow_('封存預覽', '季度 ' + q.quarterId,
      q.archivable ? '可封存' : '保留', q.reason || 'EndDate=' + q.endDate + '　Stage=' + q.stage));
  });
  tryWriteDiagnostics_('封存預覽', rows);

  lines.push('', DIAGNOSTICS_WRITTEN_NOTE);
  ui.alert('封存舊季度資料（唯讀預覽）', lines.join('\n'), ui.ButtonSet.OK);
}

/**
 * 把封存計畫整理成可讀文字，預覽與執行確認共用同一份內容——保證幹事在
 * 「預覽」看到的，跟「執行前最後確認」看到的是同一份數字。
 * @param {Object} plan planArchive_() 的結果
 * @returns {string[]}
 */
function buildArchivePlanLines_(plan) {
  const lines = ['計算日期：' + plan.asOf, ''];

  if (plan.warnings.length > 0) {
    plan.warnings.forEach(function (w) { lines.push('⚠️ ' + w); });
    lines.push('');
  }

  lines.push('各季度的封存資格：');
  plan.quarters.forEach(function (q) {
    lines.push('　' + (q.archivable ? '✅ 可封存' : '🔒 保留') + '　' + q.quarterId
      + '（' + (q.startDate || '?') + ' 至 ' + (q.endDate || '?') + '　Stage=' + (q.stage || '?') + '）'
      + (q.reason ? '\n　　　原因：' + q.reason : ''));
  });

  if (plan.archivableQuarterIds.length === 0) {
    lines.push('', '目前沒有任何季度符合封存資格，不需要做任何事。');
    return lines;
  }

  lines.push('', 'SendLog：');
  lines.push('　目前 ' + plan.sendLog.totalRows + ' 行 → 封存 ' + plan.sendLog.rowsToArchive.length
    + ' 行 → 剩 ' + plan.sendLog.remainingRows + ' 行');
  lines.push('　（其中刻意保留 ' + plan.sendLog.keptBaselineRows.length
    + ' 行「每人在該季最後一次寄送紀錄」，確保萬一有人對已封存季度執行'
    + '「步驟 5：改動後重發」，仍然查得到比對基準、不會重複寄信）');

  lines.push('', 'RosterAssignments：');
  lines.push('　目前 ' + plan.assignments.totalRows + ' 行 → 封存 '
    + plan.assignments.rowsToArchive.length + ' 行 → 剩 ' + plan.assignments.remainingRows + ' 行');
  Object.keys(plan.assignments.byQuarter).sort().forEach(function (q) {
    lines.push('　　' + q + '：' + plan.assignments.byQuarter[q] + ' 行');
  });

  const savedRatio = plan.assignments.totalRows === 0 ? 0
    : plan.assignments.rowsToArchive.length / plan.assignments.totalRows;
  lines.push('', '預計效果：步驟 3／5 與生成初稿每次讀取 RosterAssignments 的資料量'
    + '約減少 ' + Math.round(savedRatio * 100) + '%。');
  lines.push('封存是「搬移」不是「刪除」：全部原始列會完整搬到 '
    + SHEETS.SEND_LOG_ARCHIVE + '／' + SHEETS.ROSTER_ASSIGNMENTS_ARCHIVE
    + ' 兩張表，隨時可以打開查閱。');

  return lines;
}

/**
 * 選單項目「維護 ▸ ⚠️⚠️ 執行封存舊季度資料」的執行入口。
 * 先顯示跟預覽完全相同的內容，再要求逐字輸入確認文字。
 * @returns {void}
 */
function runArchiveExecute_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planArchive_();
  } catch (err) {
    log_('ERROR', 'runArchiveExecute_ 失敗: ' + err.message);
    ui.alert('執行封存舊季度資料', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.totalRowsToArchive === 0) {
    ui.alert('執行封存舊季度資料',
      buildArchivePlanLines_(plan).join('\n') + '\n\n沒有任何資料需要封存，已結束。', ui.ButtonSet.OK);
    return;
  }

  const lines = buildArchivePlanLines_(plan);
  lines.push('', '確認以上內容無誤後，請在下一步逐字輸入「' + ARCHIVE_CONFIRM_TEXT + '」。');
  const confirm = ui.prompt('⚠️⚠️ 執行封存舊季度資料（最後確認）', lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;
  if (confirm.getResponseText().trim() !== ARCHIVE_CONFIRM_TEXT) {
    ui.alert('執行封存舊季度資料',
      '輸入的文字不是「' + ARCHIVE_CONFIRM_TEXT + '」，已取消，沒有搬動任何資料。', ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('封存中，請稍候…', '封存舊季度資料', 120);
    const result = executeArchive_(plan);
    writeAuditLog_({
      action: '封存舊季度資料',
      targetSheet: SHEETS.SEND_LOG + '／' + SHEETS.ROSTER_ASSIGNMENTS,
      targetKey: plan.archivableQuarterIds.join('、'),
      oldValue: 'SendLog ' + plan.sendLog.totalRows + ' 行／RosterAssignments '
        + plan.assignments.totalRows + ' 行',
      newValue: 'SendLog ' + plan.sendLog.remainingRows + ' 行／RosterAssignments '
        + plan.assignments.remainingRows + ' 行',
      source: 'runArchiveExecute_',
      notes: '已搬移 SendLog ' + result.sendLogArchived + ' 行、RosterAssignments '
        + result.assignmentsArchived + ' 行到封存表；刻意保留每人最後一次寄送紀錄 '
        + plan.sendLog.keptBaselineRows.length + ' 行'
    });
    ui.alert('執行封存舊季度資料',
      '已完成。\n\n'
        + 'SendLog 搬移：' + result.sendLogArchived + ' 行 → ' + SHEETS.SEND_LOG_ARCHIVE + '\n'
        + 'RosterAssignments 搬移：' + result.assignmentsArchived + ' 行 → '
        + SHEETS.ROSTER_ASSIGNMENTS_ARCHIVE + '\n\n'
        + '建議立即執行「維護 ▸ 🩺 全面體檢（唯讀）」確認一切正常'
        + '（驗證步驟見 docs/系統範圍稽核.md）。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runArchiveExecute_ 執行失敗: ' + err.message);
    ui.alert('執行封存舊季度資料', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
