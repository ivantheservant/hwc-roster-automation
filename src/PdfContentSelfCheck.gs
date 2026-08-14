/**
 * 階段 D 新增：「查看 ▸ PDF 內容自我檢查（唯讀）」。
 *
 * 目的很明確：**不產生任何 PDF**，只檢查「如果現在去匯出，PDF 會長怎樣」，
 * 報告寫進 Diagnostics，讓 Claude（或任何看得到 Diagnostics 的人）可以單靠
 * 文字報告判斷 PDF 對不對，不需要真的匯出一份、開起來用眼睛看。
 *
 * 完整版檢查：13 週是否全部出現、崗位欄是否齊全、待補／特殊主日跳過／結構性
 * 不適用三種格子的實際數量（重用階段 A／C 的分類機制，改成從已存在的 grid
 * 工作表用顏色反推，而不是重新生成一次）、版面（欄數是否會讓 A4 橫向＋
 * 縮頁寬的匯出設定把字體壓得太小）。
 *
 * 個人版檢查：直接呼叫真正匯出時用的同一個 `locatePersonCells_()`
 * （PdfExport.gs），對幾個有代表性的樣本人物（本版指派最多格的人、如果有
 * 上一版有派工但這一版變成零派工的人）做真正的定位測試，而不是只重新描述
 * 程式邏輯——這樣才能抓到「程式邏輯看起來對，但實際資料對不上」的情況
 * （例如 RosterAssignments 的 PersonID 跟 grid 內容不同步）。
 * `locatePersonCells_()`／`buildGridIndex_()` 都是純讀取，這個工具全程沒有
 * 寫入任何工作表（除了跟其他唯讀工具一樣的 Diagnostics）。
 */

/**
 * 依格子顏色反推分類（NA／特別主日跳過／待人手填寫／真正排不出），從已存在
 * 的 grid 工作表讀取，不重新生成。判斷方式：
 * - GRID_COLORS.SPECIAL_SKIP → 特別主日跳過（顏色唯一，不會混淆）
 * - GRID_COLORS.SKIPPED 且文字等於 GRID_NOT_APPLICABLE_LABEL → 結構性不適用
 * - GRID_COLORS.SKIPPED 且有批註 → 真正排不出（批註只有真正的規則警告才有）
 * - GRID_COLORS.SKIPPED 且沒有批註、文字不是 NA → 待人手填寫
 * - 其餘（有名字，或黃底但有名字）不計入
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{structuralNa: number, specialSkip: number, manualPending: number,
 *   genuineGap: Object[], totalCells: number, weekCount: number, columnCount: number}}
 */
function scanGridCellClassification_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) {
    return { structuralNa: 0, specialSkip: 0, manualPending: 0, genuineGap: [], totalCells: 0, weekCount: 0, columnCount: 0 };
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const naLabel = getConfig(CONFIG_KEYS.GRID_NOT_APPLICABLE_LABEL, DEFAULTS.GRID_NOT_APPLICABLE_LABEL);
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dateValues = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const backgrounds = sheet.getRange(3, 1, lastRow - 2, lastCol).getBackgrounds();
  const notes = sheet.getRange(3, 1, lastRow - 2, lastCol).getNotes();

  let structuralNa = 0, specialSkip = 0, manualPending = 0;
  const genuineGap = [];
  const dataColumns = keys.filter(function (k) { return String(k || '').indexOf('#') !== -1; }).length;

  for (let r = 0; r < values.length; r++) {
    const dateStr = toDateString(dateValues[r][0], timezone);
    for (let c = 3; c < keys.length; c++) {
      if (String(keys[c] || '').indexOf('#') === -1) continue;
      const bg = String(backgrounds[r][c] || '').toUpperCase();
      const text = String(values[r][c] || '').trim();
      const note = String(notes[r][c] || '').trim();

      if (bg === GRID_COLORS.SPECIAL_SKIP.toUpperCase()) { specialSkip++; continue; }
      if (bg !== GRID_COLORS.SKIPPED.toUpperCase()) continue; // 有名字或其他顏色，不是留空格
      if (text === naLabel) { structuralNa++; continue; }
      if (note) { genuineGap.push({ serviceDate: dateStr, key: String(keys[c]), note: note }); continue; }
      manualPending++;
    }
  }

  return {
    structuralNa: structuralNa, specialSkip: specialSkip, manualPending: manualPending,
    genuineGap: genuineGap, totalCells: values.length * dataColumns,
    weekCount: values.length, columnCount: dataColumns
  };
}

/**
 * 估算版面：A4 橫向、`fitw=true`（縮到頁寬）、邊界各 0.4 吋（見 PdfExport.gs 的
 * exportSheetAsPdfBlob_()），扣掉日期／週次／類型三個固定欄之後，每個崗位欄
 * 平均能分到幾吋寬。這是粗略估算，不是精確的字體渲染模擬——只能提示「欄數
 * 是不是明顯太多」，實際排版效果仍然建議人手核對一次匯出的 PDF。
 * @param {number} columnCount 崗位欄數（不含日期／週次／類型）
 * @returns {{estimatedInchesPerColumn: number, likelyCramped: boolean}}
 */
function estimatePdfColumnWidth_(columnCount) {
  const A4_LANDSCAPE_WIDTH_INCHES = 11.69;
  const MARGIN_INCHES = 0.4 * 2;
  const FIXED_COLUMNS_INCHES = 1.8; // 日期／週次／類型三欄，經驗估計約各 0.6 吋
  const usable = A4_LANDSCAPE_WIDTH_INCHES - MARGIN_INCHES - FIXED_COLUMNS_INCHES;
  const perColumn = columnCount > 0 ? usable / columnCount : usable;
  return { estimatedInchesPerColumn: Math.round(perColumn * 100) / 100, likelyCramped: perColumn < 0.45 };
}

/**
 * 上線前規劃：組出完整的 PDF 內容自我檢查報告，純讀取，不寫入任何工作表。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 報告內容，見 runPdfContentSelfCheck_() 的使用方式
 */
function buildPdfContentSelfCheckReport_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  // ---- 完整版：週數／崗位欄是否齊全 ----
  const expectedWeekCount = readServiceDates(quarterId).length;
  const expectedColumnCount = readPosts().reduce(function (sum, row) {
    return sum + (Number(row[COLUMNS.POSTS.SLOT_COUNT]) || 1);
  }, 0);
  const classification = scanGridCellClassification_(quarterId, versionNo);
  const layout = estimatePdfColumnWidth_(classification.columnCount);

  // ---- 個人版：真正呼叫 locatePersonCells_() 對樣本人物做定位測試 ----
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const allAssignments = readSheet(SHEETS.ROSTER_ASSIGNMENTS);
  const thisVersionRows = allAssignments.filter(function (row) {
    return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
  });

  const countByPerson = {};
  thisVersionRows.forEach(function (row) {
    const personId = row[C.PERSON_ID];
    if (!personId) return;
    countByPerson[personId] = (countByPerson[personId] || 0) + 1;
  });
  const mostAssignedPersonId = Object.keys(countByPerson).sort(function (a, b) {
    return countByPerson[b] - countByPerson[a];
  })[0] || null;

  const previousVersionNo = versionNo > 0 ? versionNo - 1 : -1;
  let droppedToZeroPersonId = null;
  if (previousVersionNo >= 0) {
    const prevPersonIds = {};
    allAssignments.forEach(function (row) {
      if (row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === previousVersionNo && row[C.PERSON_ID]) {
        prevPersonIds[row[C.PERSON_ID]] = true;
      }
    });
    droppedToZeroPersonId = Object.keys(prevPersonIds).filter(function (id) { return !countByPerson[id]; })[0] || null;
  }

  const samplePersonIds = [mostAssignedPersonId, droppedToZeroPersonId].filter(Boolean);
  const gridIndex = buildGridIndex_(sheet);
  const personChecks = samplePersonIds.map(function (personId) {
    const located = locatePersonCells_(sheet, quarterId, versionNo, personId, thisVersionRows, gridIndex);
    const expected = countByPerson[personId] || 0;
    return {
      personId: personId,
      role: personId === mostAssignedPersonId ? '本版指派最多格的人（測試同週多崗位是否全部命中）' : '上一版有派工、這一版變成零派工的人',
      personName: located.personName,
      expectedCells: expected,
      matchedCells: located.matched.length,
      method: located.method,
      ok: expected === 0 ? located.matched.length === 0 : located.matched.length === expected
    };
  });

  return {
    quarterId: quarterId, versionNo: versionNo,
    expectedWeekCount: expectedWeekCount, actualWeekCount: classification.weekCount,
    expectedColumnCount: expectedColumnCount, actualColumnCount: classification.columnCount,
    classification: classification, layout: layout,
    personChecks: personChecks
  };
}

/**
 * 選單項目「查看 ▸ PDF 內容自我檢查（唯讀）」的執行入口。
 * @returns {void}
 */
function runPdfContentSelfCheck_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('PDF 內容自我檢查（唯讀）');
  if (!target) return;

  let report;
  try {
    report = buildPdfContentSelfCheckReport_(target.quarterId, target.versionNo);
  } catch (err) {
    log_('ERROR', 'runPdfContentSelfCheck_ 失敗: ' + err.message);
    ui.alert('PDF 內容自我檢查（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const c = report.classification;
  const lines = [
    report.quarterId + ' v' + report.versionNo,
    '',
    '=== 完整版 ===',
    '週數：實際 ' + report.actualWeekCount + ' / 預期 ' + report.expectedWeekCount
      + (report.actualWeekCount === report.expectedWeekCount ? '　✓' : '　⚠ 對不上，請檢查 ServiceDates 與 grid 是否同步'),
    '崗位欄數：實際 ' + report.actualColumnCount + ' / 預期 ' + report.expectedColumnCount
      + (report.actualColumnCount === report.expectedColumnCount ? '　✓' : '　⚠ 對不上，請檢查 Posts 與 grid 是否同步'),
    '',
    '格子分類（' + c.totalCells + ' 格）：',
    '　結構性不適用：' + c.structuralNa + ' 格（PDF 顯示「—」）',
    '　特別主日跳過：' + c.specialSkip + ' 格（PDF 顯示特殊主日標籤與獨立底色）',
    '　待人手填寫：' + c.manualPending + ' 格（PDF 顯示「待確認」等文字）',
    '　⚠ 系統排不出：' + c.genuineGap.length + ' 格'
  ];
  c.genuineGap.slice(0, 10).forEach(function (g) { lines.push('　　' + g.serviceDate + ' ' + g.key + '：' + g.note); });
  if (c.genuineGap.length > 10) lines.push('　　……另有 ' + (c.genuineGap.length - 10) + ' 格');

  lines.push(
    '',
    '版面估算（A4 橫向，縮頁寬）：崗位欄平均約 ' + report.layout.estimatedInchesPerColumn + ' 吋寬'
      + (report.layout.likelyCramped
        ? '　⚠ 偏窄，欄數較多時字體可能會被壓得很小，建議實際匯出一次確認'
        : '　看起來還算合理，但這只是粗略估算，不是精確的字體渲染模擬'),
    '',
    '=== 個人版（highlight 定位）==='
  );
  if (report.personChecks.length === 0) {
    lines.push('這一版沒有可以測試的樣本人物（可能完全沒有派工紀錄）。');
  } else {
    report.personChecks.forEach(function (p) {
      lines.push(
        (p.ok ? '✓' : '⚠') + ' ' + p.personName + '（' + p.personId + '）　' + p.role,
        '　預期 ' + p.expectedCells + ' 格，實際命中 ' + p.matchedCells + ' 格，定位方式：' + p.method
          + (p.ok ? '' : '　⚠ 對不上，個人版 PDF 的 highlight 可能不正確')
      );
    });
  }

  const rows = [
    diagRow_('PDF內容自我檢查', '（季度／版本）', report.quarterId + ' v' + report.versionNo, ''),
    diagRow_('PDF內容自我檢查', '週數', report.actualWeekCount + '/' + report.expectedWeekCount, ''),
    diagRow_('PDF內容自我檢查', '崗位欄數', report.actualColumnCount + '/' + report.expectedColumnCount, ''),
    diagRow_('PDF內容自我檢查', '結構性不適用', c.structuralNa, ''),
    diagRow_('PDF內容自我檢查', '特別主日跳過', c.specialSkip, ''),
    diagRow_('PDF內容自我檢查', '待人手填寫', c.manualPending, ''),
    diagRow_('PDF內容自我檢查', '系統排不出', c.genuineGap.length, '')
  ];
  c.genuineGap.forEach(function (g) { rows.push(diagRow_('PDF內容自我檢查', '排不出　明細', '', g.serviceDate + ' ' + g.key + '：' + g.note)); });
  rows.push(diagRow_('PDF內容自我檢查', '版面估算', report.layout.estimatedInchesPerColumn + ' 吋/欄', report.layout.likelyCramped ? '偏窄' : '合理'));
  report.personChecks.forEach(function (p) {
    rows.push(diagRow_('PDF內容自我檢查', '個人版定位　' + p.personId, (p.ok ? 'OK' : '對不上') + '　' + p.matchedCells + '/' + p.expectedCells, p.role));
  });
  tryWriteDiagnostics_('PDF內容自我檢查', rows);
  lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

  ui.alert('PDF 內容自我檢查（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}
