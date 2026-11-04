/**
 * PDF／公開職事表內容自我檢查（唯讀）。
 *
 * 第一百零二輪批次 OC 組：改為檢查**共用輸出版面**（`RosterOutput.gs`）——寄出／公開的職事表
 * 全部由同一個 model 產生，所以檢查 model 就等於檢查每一份輸出：
 *   1. 沒有狀態字（「待確認」「—」「特殊主日」「⚠ 未能安排」等）、沒有 PersonID；
 *   2. 月份顏色（月份列、日子列、內容格）按季內第幾個月；
 *   3. 崗位次序跟 `Posts.OutputOrder`（留空用 DisplayOrder）；
 *   4. 應該有人但未有人的格是黃色，其他格不是黃色；
 *   5. 個人 highlight 只落在那個人的格（樣本：這一版服侍最多的人），格數等於他這一版的派工數。
 * 不產生 PDF、不寫任何工作表（選單版本照舊寫 Diagnostics）。
 */

/**
 * 檢查一個輸出 model（純函式）。
 * @param {Object} model `buildRosterOutputModel_()` 的結果
 * @param {{statusWords: string[], personIds: string[], expectedPostOrder: string[],
 *   samplePersonId: ?string, samplePersonCellCount: number, samplePersonName: string}} expect
 * @returns {{ok: boolean, items: {label: string, ok: boolean, detail: string}[]}}
 */
function checkRosterOutputModel_(model, expect) {
  const sm = model.sheets[0];
  const items = [];
  const add = function (label, ok, detail) { items.push({ label: label, ok: !!ok, detail: detail || '' }); };
  const dataStart = 4;
  const dataEnd = sm.numRows - 1; // 最後一行是頁腳

  // 1. 狀態字、PersonID
  const words = (expect.statusWords || []).filter(function (w) { return String(w || '').trim(); });
  const ids = expect.personIds || [];
  const badText = [];
  for (let r = 2; r <= dataEnd; r++) {
    for (let c = 1; c <= sm.numCols; c++) {
      const v = String(sm.values[r - 1][c - 1] || '');
      if (!v) continue;
      if (words.some(function (w) { return v.indexOf(w) !== -1; }) || ids.indexOf(v.trim()) !== -1) badText.push(rosterOutputCellA1_({ row: r, col: c }) + '「' + v + '」');
    }
  }
  const allText = sm.values.map(function (row) { return row.join('|'); }).join('\n');
  const idInText = ids.filter(function (id) { return id && allText.indexOf(id) !== -1; });
  add('沒有狀態字（待確認、—、特殊主日、未能安排等）', badText.length === 0, badText.slice(0, 5).join('、'));
  add('沒有 PersonID', idInText.length === 0, idInText.slice(0, 5).join('、'));

  // 2. 月份顏色
  const colorErrs = [];
  model.dateColumns.forEach(function (dc, i) {
    const pal = ROSTER_OUTPUT_MONTH_PALETTE[dc.paletteIndex];
    const c = i + 1;
    if (sm.backgrounds[1][c] !== pal.month) colorErrs.push('月份列第 ' + (c + 1) + ' 欄');
    if (sm.backgrounds[2][c] !== pal.day) colorErrs.push('日子列第 ' + (c + 1) + ' 欄');
    for (let r = dataStart; r <= dataEnd; r++) {
      const bg = sm.backgrounds[r - 1][c];
      if (bg !== pal.cell && bg !== ROSTER_OUTPUT_MISSING_FILL) { colorErrs.push(rosterOutputCellA1_({ row: r, col: c + 1 })); break; }
    }
  });
  const paletteSeq = model.monthGroups.map(function (g) { return g.paletteIndex; }).join(',');
  const expectedSeq = model.monthGroups.map(function (g, i) { return i % ROSTER_OUTPUT_MONTH_PALETTE.length; }).join(',');
  add('月份顏色按季內第幾個月', colorErrs.length === 0 && paletteSeq === expectedSeq, colorErrs.slice(0, 5).join('、'));

  // 3. 崗位次序
  const order = (expect.expectedPostOrder || []).join(',');
  add('崗位次序跟 OutputOrder', model.postOrder.join(',') === order, '輸出：' + model.postOrder.join(',') + '；應該：' + order);

  // 4. 黃色
  const yellow = [];
  for (let r = dataStart; r <= dataEnd; r++) {
    for (let c = 2; c <= sm.numCols; c++) {
      const isMissing = sm.kinds[r - 1][c - 1] === ROSTER_OUTPUT_CELL_KIND.MISSING;
      const isYellow = sm.backgrounds[r - 1][c - 1] === ROSTER_OUTPUT_MISSING_FILL;
      if (isMissing !== isYellow || (isMissing && String(sm.values[r - 1][c - 1] || '') !== '')) yellow.push(rosterOutputCellA1_({ row: r, col: c }));
    }
  }
  add('未有人的格是黃色（' + model.missingCells.length + ' 格），其他格不是', yellow.length === 0, yellow.slice(0, 5).join('、'));

  // 5. 個人 highlight
  if (expect.samplePersonId) {
    const cells = locateRosterOutputPersonCells_(model, expect.samplePersonId);
    const wrong = cells.filter(function (c) { return String(sm.values[c.row - 1][c.col - 1] || '').trim() === ''; });
    add('個人 highlight 只落在那個人的格（' + (expect.samplePersonName || expect.samplePersonId) + '）',
      cells.length === expect.samplePersonCellCount && wrong.length === 0,
      '標示 ' + cells.length + ' 格；這一版派工 ' + expect.samplePersonCellCount + ' 格');
  }
  return { ok: items.every(function (i) { return i.ok; }), items: items };
}

/**
 * 讀資料、建 model、跑檢查（唯讀）。
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {{quarterId: string, versionNo: number, ok: boolean, items: Object[], model: Object,
 *   samplePersonId: ?string, samplePersonName: string}}
 */
function buildPdfContentSelfCheckReport_(quarterId, versionNo) {
  const model = buildRosterOutputForVersion_(quarterId, versionNo);
  const assignments = readVersionAssignmentsForGrid_(quarterId, versionNo);
  const countById = {};
  assignments.forEach(function (a) { if (a.personId) countById[a.personId] = (countById[a.personId] || 0) + 1; });
  const sample = Object.keys(countById).sort(function (a, b) { return countById[b] - countById[a] || (a < b ? -1 : 1); })[0] || null;
  const labels = readGridCellLabels_();
  const postInfo = readPostsForOutput_();
  const result = checkRosterOutputModel_(model, {
    statusWords: [labels.pending, labels.na, labels.specialSkip, labels.gap, '待確認', '未能安排', '特殊主日'],
    personIds: Object.keys(countById),
    expectedPostOrder: sortPostsForOutput_(postInfo.posts, postInfo.hasOutputOrderColumn).map(function (p) { return p.postId; }),
    samplePersonId: sample,
    samplePersonCellCount: sample ? countById[sample] : 0,
    samplePersonName: sample ? lookupPersonName_(sample) : ''
  });
  return {
    quarterId: quarterId, versionNo: versionNo, ok: result.ok, items: result.items, model: model,
    samplePersonId: sample, samplePersonName: sample ? lookupPersonName_(sample) : ''
  };
}

/**
 * 供前端呼叫：〔核對寄出版面〕。跑自我檢查，並產生一份整季 PDF 及一份個人 PDF（這一版服侍最多的人）
 * 存到 Drive「版面樣本」資料夾，**不寄出、不寫任何工作表、不發佈公開連結**。
 * ⚠️ 會產生檔案（Drive），前端用 `callServerMutating()`。
 * @param {string} quarterId
 * @returns {Object}
 */
function apiRosterOutputSample(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('核對寄出版面', function () {
    const q = String(quarterId || '').trim();
    const versionNo = findLatestVersionNo_(q);
    if (versionNo < 0) {
      throw new Error(buildThreePartMessage_('這一季還沒有任何版本。', '甚麼都沒有產生。', ['先在第 1 步生成職事表']));
    }
    const started = Date.now();
    const report = buildPdfContentSelfCheckReport_(q, versionNo);
    const folder = getOrCreateRosterOutputSampleFolder_();
    const files = [];
    const fullStart = Date.now();
    const full = buildFullRosterPdfBlob_(q, versionNo);
    const fullFile = saveOrOverwriteFile_(folder, '樣本_' + full.fileName, full.blob);
    files.push({ label: '整季', name: fullFile.getName(), url: fullFile.getUrl(), ms: Date.now() - fullStart });
    if (report.samplePersonId) {
      const pStart = Date.now();
      const ctx = openRosterOutputPdfContext_(q, versionNo, { wantHighlight: true });
      try {
        const built = buildPersonalPdfBlob_(q, versionNo, report.samplePersonId, null, ctx);
        const pf = saveOrOverwriteFile_(folder, '樣本_' + built.fileName, built.blob);
        files.push({ label: '個人（' + report.samplePersonName + '）', name: pf.getName(), url: pf.getUrl(), ms: Date.now() - pStart });
      } finally {
        ctx.close();
      }
    }
    writeAuditLog_({ action: 'ROSTER_OUTPUT_SAMPLE', targetSheet: '', targetKey: q + ' v' + versionNo,
      newValue: files.map(function (f) { return f.name; }).join('、'), source: 'apiRosterOutputSample',
      notes: '版面樣本（不寄出）；自我檢查 ' + (report.ok ? '全部通過' : '有問題') });
    return {
      quarterId: q, versionNo: versionNo, ok: report.ok, items: report.items, files: files,
      folderUrl: folder.getUrl(), elapsedMs: Date.now() - started,
      title: report.model.title, updatedText: report.model.updatedText
    };
  });
}

/**
 * 「版面樣本」資料夾（在 ROSTER_DRIVE_FOLDER_ID 之下；沒有就建立）。
 * @returns {Folder}
 */
function getOrCreateRosterOutputSampleFolder_() {
  const root = resolveRosterFolder_();
  const name = '版面樣本';
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
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
  const lines = [report.quarterId + ' v' + report.versionNo + '（寄出／公開職事表共用版面）', ''];
  const rows = [diagRow_('PDF內容自我檢查', '（季度／版本）', report.quarterId + ' v' + report.versionNo, '')];
  report.items.forEach(function (i) {
    lines.push((i.ok ? '✓ ' : '⚠ ') + i.label + (i.ok || !i.detail ? '' : '：' + i.detail));
    rows.push(diagRow_('PDF內容自我檢查', i.label, i.ok ? 'OK' : '有問題', i.detail));
  });
  tryWriteDiagnostics_('PDF內容自我檢查', rows);
  lines.push('', DIAGNOSTICS_WRITTEN_NOTE);
  ui.alert('PDF 內容自我檢查（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}
