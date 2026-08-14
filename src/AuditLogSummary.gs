/**
 * 階段 F 新增：「查看 ▸ AuditLog 摘要（唯讀）」。
 *
 * AuditLog 本身會累積成很大的一張表，Google Drive connector 讀不到（跟
 * SendLog／RosterAssignments 太大同一個理由，見階段 A 的「匯出關鍵狀態」）。
 * 這個工具把最近 N 筆（預設 200）按事件類型（Action）與操作者（Actor）統計，
 * 寫進 Diagnostics，讓 Claude 或人可以讀到「最近系統做過什麼」的摘要，
 * 不需要打開整張 AuditLog。
 *
 * 純讀取，不寫入 AuditLog 本身，只寫 Diagnostics。
 */

/**
 * 上線前規劃：讀 AuditLog 最近 N 筆，按 Action／Actor 統計，純讀取。
 * @param {number} limit 要看最近幾筆（由新到舊）
 * @returns {{totalRows: number, sampledRows: number, byAction: Object.<string, number>,
 *   byActor: Object.<string, number>, recent: Object[]}}
 */
function buildAuditLogSummaryReport_(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.AUDIT_LOG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.AUDIT_LOG);

  const allRows = readSheet(SHEETS.AUDIT_LOG);
  const C = COLUMNS.AUDIT_LOG;
  const totalRows = allRows.length;
  const sample = allRows.slice(Math.max(0, totalRows - limit));

  const byAction = {};
  const byActor = {};
  sample.forEach(function (row) {
    const action = String(row[C.ACTION] || '（空白）');
    const actor = String(row[C.ACTOR] || '（空白）');
    byAction[action] = (byAction[action] || 0) + 1;
    byActor[actor] = (byActor[actor] || 0) + 1;
  });

  const recent = sample.slice(-30).reverse().map(function (row) {
    return {
      timestamp: row[C.TIMESTAMP], actor: row[C.ACTOR], action: row[C.ACTION],
      targetSheet: row[C.TARGET_SHEET], targetKey: row[C.TARGET_KEY],
      oldValue: row[C.OLD_VALUE], newValue: row[C.NEW_VALUE], notes: row[C.NOTES]
    };
  });

  return { totalRows: totalRows, sampledRows: sample.length, byAction: byAction, byActor: byActor, recent: recent };
}

/**
 * 選單項目「查看 ▸ AuditLog 摘要（唯讀）」的執行入口。
 * @returns {void}
 */
function runAuditLogSummary_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('AuditLog 摘要（唯讀）', '要看最近幾筆？（留空預設 200）', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const raw = response.getResponseText().trim();
  const limit = raw === '' ? 200 : parseInt(raw, 10);
  if (isNaN(limit) || limit <= 0) {
    ui.alert('AuditLog 摘要（唯讀）', '請輸入正整數，或留空使用預設值 200。', ui.ButtonSet.OK);
    return;
  }

  let report;
  try {
    report = buildAuditLogSummaryReport_(limit);
  } catch (err) {
    log_('ERROR', 'runAuditLogSummary_ 失敗: ' + err.message);
    ui.alert('AuditLog 摘要（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (report.totalRows === 0) {
    ui.alert('AuditLog 摘要（唯讀）', 'AuditLog 目前沒有任何紀錄。', ui.ButtonSet.OK);
    return;
  }

  const lines = [
    'AuditLog 共 ' + report.totalRows + ' 筆，統計最近 ' + report.sampledRows + ' 筆：',
    '',
    '按事件類型：'
  ];
  Object.keys(report.byAction).sort(function (a, b) { return report.byAction[b] - report.byAction[a]; })
    .forEach(function (action) { lines.push('　' + action + '：' + report.byAction[action] + ' 筆'); });
  lines.push('', '按操作者：');
  Object.keys(report.byActor).sort(function (a, b) { return report.byActor[b] - report.byActor[a]; })
    .forEach(function (actor) { lines.push('　' + actor + '：' + report.byActor[actor] + ' 筆'); });

  const rows = [
    diagRow_('AuditLog摘要', '總筆數', report.totalRows, ''),
    diagRow_('AuditLog摘要', '本次統計筆數', report.sampledRows, '')
  ];
  Object.keys(report.byAction).forEach(function (action) {
    rows.push(diagRow_('AuditLog摘要', '事件類型　' + action, report.byAction[action], ''));
  });
  Object.keys(report.byActor).forEach(function (actor) {
    rows.push(diagRow_('AuditLog摘要', '操作者　' + actor, report.byActor[actor], ''));
  });
  report.recent.forEach(function (r) {
    rows.push(diagRow_('AuditLog摘要', '明細　' + r.timestamp, r.action + '　' + r.actor,
      r.targetSheet + '/' + r.targetKey + '　' + r.oldValue + ' → ' + r.newValue + '　' + r.notes));
  });
  tryWriteDiagnostics_('AuditLog摘要', rows);
  lines.push('', '（最近 ' + report.recent.length + ' 筆完整明細已寫入 Diagnostics）', DIAGNOSTICS_WRITTEN_NOTE);

  ui.alert('AuditLog 摘要（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}
