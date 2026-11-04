/**
 * 第一百零二輪批次 OA 組：**所有寄出／公開的職事表共用一個輸出版面（renderer）。**
 *
 * Ivan（測試結果 D）：「不只是最後正式發出的版本，每一個寄出的版本都要和以前一樣。」
 * 參考樣本：`browser-test/reference/2026 T2 update_20260422.pdf`、`2026 T3 00.pdf`。
 *
 * 用這個 renderer 的地方（全部經這裏，不再由 `Roster_*` 工作表直接匯出）：
 *   - 公開連結檔（`PublicRoster.gs`：第一張「職事表」、第二張「服侍次數」）
 *   - 整季 PDF（`buildFullRosterPdfBlob_()`：寄給堂委、審閱、名單信、紙本）
 *   - 個人 PDF（`openPersonalPdfRenderContext_()`／`buildPersonalPdfBlob_()`：highlight 版）
 * 主試算表內幹事編輯用的 `Roster_*` 工作表**不改**（那是幹事的工作區）。
 *
 * 分三層：
 *   1. `buildRosterOutputModel_()`：**純函式**——輸入資料，輸出「每一格寫甚麼、甚麼顏色、
 *      合併哪裏」的完整描述（`sheets[]`）。所有版面規則都在這裏，測試直接測這一支。
 *   2. `writeRosterOutputSheet_()`：把一張 sheet 描述寫入真正的工作表（批次寫入，次序：
 *      內容 → 格式 → 合併 → 欄闊列高 → 凍結）。公開檔和 PDF 暫存檔共用。
 *   3. PDF：`openRosterOutputPdfContext_()` 開一個暫存試算表（獨立檔案，用完移到垃圾桶），
 *      整份匯出 ⇒ 第 1 頁職事表、第 2 頁服侍次數；個人版只改那個人的格的字型及框線。
 */

/** 按季內第幾個月（不按月份）：月份列、日子列、內容格。由樣本 PDF 取色。 */
const ROSTER_OUTPUT_MONTH_PALETTE = [
  { month: '#A8D08D', day: '#C5E0B3', cell: '#E2EFD9' },
  { month: '#F4B083', day: '#F7CAAC', cell: '#FBE4D5' },
  { month: '#9CC2E5', day: '#BDD6EE', cell: '#DEEAF6' }
];

/** 崗位欄：左上角、「崗位」表頭、崗位名稱。 */
const ROSTER_OUTPUT_POST_COLORS = { corner: '#A6A6A6', header: '#BFBFBF', name: '#D9D9D9' };

/** 應該有人但未有人的格（樣本 2025T4 的做法）。 */
const ROSTER_OUTPUT_MISSING_FILL = '#FFFF00';

/**
 * 字型：Google 試算表可用的繁體中文字型之中，最接近樣本「微軟正黑體」的是 Noto Sans TC
 * （同屬黑體、無襯線，筆畫粗細均勻）。標題「粵語堂」樣本用較粗的明體，用 Noto Serif TC 粗體。
 */
const ROSTER_OUTPUT_FONT = 'Noto Sans TC';
const ROSTER_OUTPUT_TITLE_FONT = 'Noto Serif TC';

/** 公開檔／PDF 暫存檔的兩張工作表名稱。 */
const ROSTER_OUTPUT_SHEET_NAMES = { ROSTER: '職事表', COUNTS: '服侍次數' };

/**
 * `Posts.OutputOrder` 的種子次序（樣本的崗位次序）。只用於：
 * 〔補建設定及範本〕第一次補 `OutputOrder` 欄時填值；以及欄還未補建時的輸出次序。
 * 補建之後一律讀試算表（這是資料，可以在 Posts 改）。名稱比對時不理空格。
 */
const ROSTER_OUTPUT_SEED_POST_ORDER = [
  '主席', '報告', '講員', '翻譯', '讀經', '領詩', '司琴', '司事', '音響', 'PPT控制',
  '錄影', '交通指揮', '司數', '當值堂委', '獻花', '聖餐襄禮'
];

/** 欄闊（px）：崗位欄、每個主日一欄；服侍次數頁三欄合共等於職事表闊度（兩頁縮放一樣）。 */
const ROSTER_OUTPUT_POST_COL_WIDTH = 82;
const ROSTER_OUTPUT_DATE_COL_WIDTH = 104;   // 11pt 一個中文字約 15px：6 字的姓名（例如四字姓氏加「師母」）＋邊界

/** 格的種類。 */
const ROSTER_OUTPUT_CELL_KIND = {
  NAME: 'NAME',       // 有人（或外請講員等自由文字）
  OWNER: 'OWNER',     // 合堂由另一堂負責（SpecialSundays.ExternalOwner，例如「英語堂」）
  BLANK: 'BLANK',     // 不適用／刻意留空：空白，只有月份底色
  MISSING: 'MISSING'  // 應該有人但未有人：空白＋黃色
};

/**
 * 崗位名稱正規化（比對種子次序用）：去掉全部空白。
 * @param {*} name
 * @returns {string}
 */
function normalizeOutputPostName_(name) {
  return String(name === null || name === undefined ? '' : name).replace(/\s+/g, '');
}

/**
 * 崗位輸出次序的排序值：`OutputOrder` 有數字 ⇒ 用它；留空 ⇒ `DisplayOrder`。
 * `hasOutputOrderColumn=false`（Posts 還沒有這一欄）⇒ 用種子次序（名稱比對），找不到的排最後（按 DisplayOrder）。
 * @param {{postNameTC: string, displayOrder: number, outputOrder: *}} post
 * @param {boolean} hasOutputOrderColumn
 * @returns {number}
 */
function resolveOutputPostSortKey_(post, hasOutputOrderColumn) {
  if (hasOutputOrderColumn) {
    const raw = post.outputOrder;
    if (raw !== '' && raw !== null && raw !== undefined && !isNaN(Number(raw))) return Number(raw);
    return Number(post.displayOrder) || 0;
  }
  const idx = ROSTER_OUTPUT_SEED_POST_ORDER.indexOf(normalizeOutputPostName_(post.postNameTC));
  return idx >= 0 ? idx + 1 : 1000 + (Number(post.displayOrder) || 0);
}

/**
 * 按輸出次序排崗位（穩定排序：同值保持原本 DisplayOrder 次序）。
 * @param {Object[]} posts `{postId, postNameTC, slotCount, displayOrder, outputOrder, emptyDisplay}`
 * @param {boolean} hasOutputOrderColumn
 * @returns {Object[]}
 */
function sortPostsForOutput_(posts, hasOutputOrderColumn) {
  return (posts || []).map(function (p, i) { return { p: p, i: i, k: resolveOutputPostSortKey_(p, hasOutputOrderColumn) }; })
    .sort(function (a, b) { return a.k !== b.k ? a.k - b.k : a.i - b.i; })
    .map(function (x) { return x.p; });
}

/**
 * 一格屬於哪一種（見 `ROSTER_OUTPUT_CELL_KIND`）。分類沿用 `classifyGridCell_()`，
 * 只把「待確認／未能安排／—／特殊主日」這些狀態字換成空白或黃色。
 * @param {?Object} assignment `{personId, personName, assignSource, ruleFlags}`
 * @param {*} emptyDisplay 該崗位 `Posts.EmptyDisplay`
 * @param {string=} externalOwner 該主日 `SpecialSundays.ExternalOwner`
 * @returns {{kind: string, text: string}}
 */
function classifyRosterOutputCell_(assignment, emptyDisplay, externalOwner) {
  const cls = classifyGridCell_(assignment);
  if (cls === GRID_CELL_CLASS.ASSIGNED) {
    return { kind: ROSTER_OUTPUT_CELL_KIND.NAME, text: String((assignment && assignment.personName) || '').trim() };
  }
  if (cls === GRID_CELL_CLASS.SPECIAL_SKIP) {
    const owner = String(externalOwner || '').trim();
    return owner ? { kind: ROSTER_OUTPUT_CELL_KIND.OWNER, text: owner } : { kind: ROSTER_OUTPUT_CELL_KIND.BLANK, text: '' };
  }
  if (cls === GRID_CELL_CLASS.STRUCTURAL_NA) return { kind: ROSTER_OUTPUT_CELL_KIND.BLANK, text: '' };
  if (cls === GRID_CELL_CLASS.MANUAL_PENDING) {
    const v = String(emptyDisplay || '').trim().toUpperCase();
    if (v === POST_EMPTY_DISPLAY.BLANK || v === POST_EMPTY_DISPLAY.NA) return { kind: ROSTER_OUTPUT_CELL_KIND.BLANK, text: '' };
    return { kind: ROSTER_OUTPUT_CELL_KIND.MISSING, text: '' };
  }
  return { kind: ROSTER_OUTPUT_CELL_KIND.MISSING, text: '' };
}

/**
 * 標題：代入 `{Year}`、`{StartMonth}`、`{EndMonth}`、`{QuarterID}`。
 * @param {string} pattern
 * @param {string[]} serviceDates 已排序 yyyy-MM-dd
 * @param {string} quarterId
 * @returns {string}
 */
function buildRosterOutputTitle_(pattern, serviceDates, quarterId) {
  const first = String(serviceDates[0] || '').split('-');
  const last = String(serviceDates[serviceDates.length - 1] || '').split('-');
  return String(pattern || DEFAULTS.ROSTER_OUTPUT_TITLE_PATTERN)
    .split('{Year}').join(first[0] || '')
    .split('{StartMonth}').join(first[1] ? String(Number(first[1])) : '')
    .split('{EndMonth}').join(last[1] ? String(Number(last[1])) : '')
    .split('{QuarterID}').join(String(quarterId || ''));
}

/**
 * 「更新日期」：yyyy-MM-dd… ⇒ dd/MM/yyyy。認不出 ⇒ 原樣。
 * @param {string} stamp
 * @returns {string}
 */
function formatOutputUpdatedDate_(stamp) {
  const m = String(stamp || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : String(stamp || '');
}

/**
 * 解析 `ROSTER_OUTPUT_HIGHLIGHT_STYLE`（逗號分隔）：`BOLD`＝粗體；`#RRGGBB`＝字色；
 * `BORDER`＝粗框；`BG:#RRGGBB`＝底色。全部認不出 ⇒ 用預設。
 * @param {*} raw
 * @returns {{bold: boolean, fontColor: string, border: boolean, background: string}}
 */
function parseRosterOutputHighlightStyle_(raw) {
  const out = { bold: false, fontColor: '', border: false, background: '' };
  let recognised = 0;
  String(raw === null || raw === undefined ? '' : raw).split(/[,，]/).forEach(function (t) {
    const s = t.trim();
    const u = s.toUpperCase();
    if (!s) return;
    if (u === 'BOLD') { out.bold = true; recognised++; return; }
    if (u === 'BORDER') { out.border = true; recognised++; return; }
    if (/^BG:#[0-9A-F]{6}$/.test(u)) { out.background = '#' + u.slice(4); recognised++; return; }
    if (/^#[0-9A-F]{6}$/.test(u)) { out.fontColor = u; recognised++; }
  });
  if (recognised === 0) return parseRosterOutputHighlightStyle_(DEFAULTS.ROSTER_OUTPUT_HIGHLIGHT_STYLE);
  return out;
}

/**
 * 服侍次數頁的一行文字：「英文名 中文名 (次數)」（沒有英文名就只有中文名）。
 * @param {{nameEN: string, nameTC: string, count: number}} e
 * @returns {string}
 */
function formatServiceCountLine_(e) {
  const en = String(e.nameEN || '').trim();
  return (en ? en + ' ' : '') + String(e.nameTC || '').trim() + ' (' + e.count + ')';
}

/**
 * 服侍次數排序：先列有英文名的人（英文名字母，不分大小寫），再列只有中文名的人（中文名，按字碼）。
 * 樣本 `2026 T3 00.pdf` 第 2 頁就是這個次序。
 * @param {Object[]} entries `{nameEN, nameTC, count}`
 * @returns {Object[]}
 */
function sortServiceCountEntries_(entries) {
  const cmp = function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); };
  const withEn = entries.filter(function (e) { return String(e.nameEN || '').trim(); });
  const tcOnly = entries.filter(function (e) { return !String(e.nameEN || '').trim(); });
  withEn.sort(function (a, b) {
    return cmp(String(a.nameEN).trim().toLowerCase(), String(b.nameEN).trim().toLowerCase()) || cmp(a.nameTC, b.nameTC);
  });
  tcOnly.sort(function (a, b) { return cmp(String(a.nameTC), String(b.nameTC)); });
  return withEn.concat(tcOnly);
}

/**
 * 服侍次數：這一版本內有 `PersonID` 的格數（和 `Roster_*` 工作表「本季服侍次數統計」同一定義，
 * 包括聖餐襄禮、獻花——樣本第 2 頁核對過）。臨時幫手、外請講員沒有 PersonID，不計。
 * @param {Object[]} assignments
 * @param {Object.<string, {nameTC: string, nameEN: string}>} people
 * @returns {Object[]} 已排序 `{personId, nameEN, nameTC, count}`
 */
function buildServiceCountEntries_(assignments, people) {
  const byId = {};
  (assignments || []).forEach(function (a) {
    const id = String(a.personId || '').trim();
    if (!id) return;
    if (!byId[id]) {
      const p = (people || {})[id] || {};
      byId[id] = { personId: id, nameEN: String(p.nameEN || '').trim(), nameTC: String(p.nameTC || a.personName || id).trim(), count: 0 };
    }
    byId[id].count++;
  });
  return sortServiceCountEntries_(Object.keys(byId).map(function (k) { return byId[k]; }));
}

/** 空白的二維陣列。 */
function makeOutputMatrix_(rows, cols, fill) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(fill);
    out.push(row);
  }
  return out;
}

/**
 * **輸出版面本身（純函式）。** 所有寄出／公開的職事表都由這裏決定每一格。
 *
 * @param {Object} input
 * @param {string} input.quarterId
 * @param {string[]} input.serviceDates 已排序 yyyy-MM-dd
 * @param {Object.<string, string>} input.specialTitleByDate 日子下面的括號標題
 * @param {Object.<string, string>} input.externalOwnerByDate 合堂由哪一堂負責
 * @param {Object[]} input.posts `{postId, postNameTC, slotCount, displayOrder, outputOrder, emptyDisplay}`（已篩 ShowInRoster）
 * @param {boolean} input.hasOutputOrderColumn
 * @param {Object[]} input.assignments `{serviceDate, postId, slotIndex, personId, personName, assignSource, ruleFlags}`
 * @param {Object.<string, {nameTC: string, nameEN: string}>} input.people
 * @param {string} input.updatedDate dd/MM/yyyy
 * @param {string} input.titlePattern
 * @param {string} input.footerText 已代入 {ContactName}
 * @param {boolean} input.showCounts
 * @returns {Object} `{title, updatedText, sheets: [rosterSheet, countsSheet?], personCells, missingCells, postOrder, monthGroups, dateColumns}`
 */
function buildRosterOutputModel_(input) {
  const dates = (input.serviceDates || []).slice();
  const nDates = dates.length;
  const posts = sortPostsForOutput_(input.posts || [], input.hasOutputOrderColumn === true);
  const assignmentIndex = {};
  (input.assignments || []).forEach(function (a) {
    assignmentIndex[a.serviceDate + '|' + a.postId + '|' + Number(a.slotIndex)] = a;
  });

  // ---- 日子及月份（顏色按季內第幾個月）----
  const dateColumns = [];
  const monthGroups = [];
  dates.forEach(function (d) {
    const month = Number(String(d).split('-')[1]);
    let g = monthGroups[monthGroups.length - 1];
    if (!g || g.month !== month) {
      g = { month: month, label: month + ' 月', span: 0, paletteIndex: monthGroups.length % ROSTER_OUTPUT_MONTH_PALETTE.length };
      monthGroups.push(g);
    }
    g.span++;
    const special = String((input.specialTitleByDate || {})[d] || '').trim();
    dateColumns.push({
      serviceDate: d, day: Number(String(d).split('-')[2]), special: special,
      label: String(Number(String(d).split('-')[2])) + (special ? '\n(' + special + ')' : ''),
      paletteIndex: g.paletteIndex
    });
  });

  // ---- 職事表（第 1 頁）----
  const dataStartRow = 4;
  let postRowCount = 0;
  posts.forEach(function (p) { postRowCount += Math.max(1, Number(p.slotCount) || 1); });
  const numCols = 1 + nDates;
  const footerRow = dataStartRow + postRowCount;
  const numRows = footerRow;
  const values = makeOutputMatrix_(numRows, numCols, '');
  const bgs = makeOutputMatrix_(numRows, numCols, null);
  const weights = makeOutputMatrix_(numRows, numCols, 'normal');
  const sizes = makeOutputMatrix_(numRows, numCols, 11);
  const colors = makeOutputMatrix_(numRows, numCols, '#000000');
  const hAligns = makeOutputMatrix_(numRows, numCols, 'center');
  const merges = [];
  const rowHeights = {};
  const personCells = {};
  const nameCells = {};
  const missingCells = [];
  const kinds = makeOutputMatrix_(numRows, numCols, '');

  const title = buildRosterOutputTitle_(input.titlePattern, dates, input.quarterId);
  const updatedText = '更新日期：' + String(input.updatedDate || '');
  values[0][0] = title; weights[0][0] = 'bold'; sizes[0][0] = 20; hAligns[0][0] = 'left';
  // 第一百零二輪部署實測：公開連結 `/preview` 不讓文字溢出到隔壁格（標題被截成「…7-9 月職」），
  // 所以標題、更新日期、頁腳都用合併格。崗位欄不凍結，第 1 行又在凍結的頂 3 行之內，合併不會跨凍結分界。
  const dateSpan = numCols >= 5 ? 3 : (numCols > 1 ? 1 : 0);
  const titleSpan = numCols - dateSpan;
  if (titleSpan > 1) merges.push({ row: 1, col: 1, numRows: 1, numCols: titleSpan });
  if (dateSpan > 0) {
    const dc0 = titleSpan; // 0-based：更新日期合併格的第一格
    values[0][dc0] = updatedText; sizes[0][dc0] = 10; hAligns[0][dc0] = 'right';
    if (dateSpan > 1) merges.push({ row: 1, col: dc0 + 1, numRows: 1, numCols: dateSpan });
  }
  rowHeights[1] = 50;

  // 第 2 行：左上角灰、月份合併
  bgs[1][0] = ROSTER_OUTPUT_POST_COLORS.corner;
  let col = 2;
  monthGroups.forEach(function (g) {
    const pal = ROSTER_OUTPUT_MONTH_PALETTE[g.paletteIndex];
    values[1][col - 1] = g.label;
    for (let c = col; c < col + g.span; c++) { bgs[1][c - 1] = pal.month; weights[1][c - 1] = 'bold'; }
    if (g.span > 1) merges.push({ row: 2, col: col, numRows: 1, numCols: g.span });
    col += g.span;
  });
  rowHeights[2] = 26;

  // 第 3 行：「崗位」＋日子
  values[2][0] = GRID_LABELS.POST_COLUMN; bgs[2][0] = ROSTER_OUTPUT_POST_COLORS.header; weights[2][0] = 'bold'; sizes[2][0] = 14;
  let anySpecial = false;
  dateColumns.forEach(function (dc, i) {
    values[2][i + 1] = dc.label;
    bgs[2][i + 1] = ROSTER_OUTPUT_MONTH_PALETTE[dc.paletteIndex].day;
    weights[2][i + 1] = 'bold';
    if (dc.special) { anySpecial = true; sizes[2][i + 1] = 10; }
  });
  rowHeights[3] = anySpecial ? 48 : 34;

  // 第 4 行起：崗位
  let r = dataStartRow;
  const postOrder = [];
  posts.forEach(function (post) {
    const slotCount = Math.max(1, Number(post.slotCount) || 1);
    postOrder.push(post.postId);
    for (let slot = 1; slot <= slotCount; slot++) {
      const ri = r - 1;
      values[ri][0] = slot === 1 ? String(post.postNameTC || '') : '';
      bgs[ri][0] = ROSTER_OUTPUT_POST_COLORS.name;
      weights[ri][0] = 'bold';
      let multiLine = false;
      dateColumns.forEach(function (dc, i) {
        const a = assignmentIndex[dc.serviceDate + '|' + post.postId + '|' + slot];
        const cell = classifyRosterOutputCell_(a, post.emptyDisplay, (input.externalOwnerByDate || {})[dc.serviceDate]);
        const ci = i + 1;
        values[ri][ci] = cell.text;
        kinds[ri][ci] = cell.kind;
        bgs[ri][ci] = cell.kind === ROSTER_OUTPUT_CELL_KIND.MISSING
          ? ROSTER_OUTPUT_MISSING_FILL : ROSTER_OUTPUT_MONTH_PALETTE[dc.paletteIndex].cell;
        if (cell.text.indexOf('\n') !== -1) multiLine = true;
        if (cell.kind === ROSTER_OUTPUT_CELL_KIND.MISSING) missingCells.push({ row: r, col: ci + 1 });
        if (cell.kind === ROSTER_OUTPUT_CELL_KIND.NAME) {
          const pid = String((a && a.personId) || '').trim();
          if (pid) (personCells[pid] = personCells[pid] || []).push({ row: r, col: ci + 1 });
          else if (cell.text) (nameCells[cell.text] = nameCells[cell.text] || []).push({ row: r, col: ci + 1 });
        }
      });
      rowHeights[r] = multiLine ? 46 : 32;   // 第一百零二輪部署實測：24px 只佔半頁，樣本的表佔滿大半頁
      r++;
    }
    if (slotCount > 1) merges.push({ row: r - slotCount, col: 1, numRows: slotCount, numCols: 1 });
  });

  // 頁腳
  values[footerRow - 1][0] = String(input.footerText || '');
  sizes[footerRow - 1][0] = 10; hAligns[footerRow - 1][0] = 'left';
  if (numCols > 1) merges.push({ row: footerRow, col: 1, numRows: 1, numCols: numCols });
  rowHeights[footerRow] = 28;

  const columnWidths = [ROSTER_OUTPUT_POST_COL_WIDTH];
  for (let i = 0; i < nDates; i++) columnWidths.push(ROSTER_OUTPUT_DATE_COL_WIDTH);

  const titlePrefixMatch = title.match(/^(\S+)\s/);
  const rosterSheet = {
    name: ROSTER_OUTPUT_SHEET_NAMES.ROSTER,
    numRows: numRows, numCols: numCols,
    values: values, backgrounds: bgs, fontWeights: weights, fontSizes: sizes, fontColors: colors,
    horizontalAlignments: hAligns, kinds: kinds,
    wrapRange: { row: 2, col: 1, numRows: Math.max(1, footerRow - 2), numCols: numCols },
    borderRange: { row: 2, col: 1, numRows: Math.max(1, footerRow - 2), numCols: numCols },
    merges: merges, columnWidths: columnWidths, rowHeights: rowHeights,
    // 只凍結頂 3 行（標題、月份、日子）。不凍結崗位欄：凍結欄會截斷 A1 標題向右溢出的文字。
    frozenRows: 3, frozenColumns: 0,
    titleRich: titlePrefixMatch ? { text: title, prefixLength: titlePrefixMatch[1].length } : null
  };

  const sheets = [rosterSheet];
  let countEntries = [];
  if (input.showCounts !== false) {
    countEntries = buildServiceCountEntries_(input.assignments, input.people);
    sheets.push(buildServiceCountSheetModel_(countEntries, columnWidths.reduce(function (s, w) { return s + w; }, 0)));
  }

  return {
    quarterId: input.quarterId, title: title, updatedText: updatedText,
    sheets: sheets, personCells: personCells, nameCells: nameCells, missingCells: missingCells,
    postOrder: postOrder, monthGroups: monthGroups, dateColumns: dateColumns, countEntries: countEntries
  };
}

/**
 * 服侍次數頁：三欄，直排（第 1 欄由上而下排完再到第 2 欄），沒有標題列、沒有 PersonID。
 * @param {Object[]} entries 已排序
 * @param {number} totalWidth 職事表總闊度（三欄平分，令兩頁縮放一樣）
 * @returns {Object} sheet 描述
 */
function buildServiceCountSheetModel_(entries, totalWidth) {
  const perCol = Math.max(1, Math.ceil(entries.length / 3));
  const numRows = perCol;
  const numCols = 3;
  const values = makeOutputMatrix_(numRows, numCols, '');
  entries.forEach(function (e, i) {
    values[i % perCol][Math.floor(i / perCol)] = formatServiceCountLine_(e);
  });
  const rowHeights = {};
  for (let r = 1; r <= numRows; r++) rowHeights[r] = 24;
  const w = Math.max(200, Math.floor((Number(totalWidth) || 900) / 3));
  return {
    name: ROSTER_OUTPUT_SHEET_NAMES.COUNTS, numRows: numRows, numCols: numCols,
    values: values,
    backgrounds: makeOutputMatrix_(numRows, numCols, null),
    fontWeights: makeOutputMatrix_(numRows, numCols, 'normal'),
    fontSizes: makeOutputMatrix_(numRows, numCols, 11),
    fontColors: makeOutputMatrix_(numRows, numCols, '#000000'),
    horizontalAlignments: makeOutputMatrix_(numRows, numCols, 'left'),
    wrapRange: null, borderRange: null, merges: [],
    columnWidths: [w, w, w], rowHeights: rowHeights, frozenRows: 0, frozenColumns: 0, titleRich: null
  };
}

/**
 * 某人（或臨時幫手 `NAME:名字`）在輸出版面上的格。
 * @param {Object} model `buildRosterOutputModel_()` 的結果
 * @param {string} personKey PersonID 或 `NAME:名字`
 * @returns {{row: number, col: number}[]}
 */
function locateRosterOutputPersonCells_(model, personKey) {
  const tempName = tempHelperNameFromPaperKey_(personKey);
  if (tempName) return (model.nameCells[tempName] || []).slice();
  return (model.personCells[String(personKey || '').trim()] || []).slice();
}

/* ═════════════════════════ 讀資料（GAS） ═════════════════════════ */

/**
 * 讀 Posts（已篩 Active、ShowInRoster），帶 `OutputOrder`。
 * @returns {{posts: Object[], hasOutputOrderColumn: boolean}}
 */
function readPostsForOutput_() {
  const P = COLUMNS.POSTS;
  const rows = readPosts_();
  const hasCol = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], P.OUTPUT_ORDER);
  return {
    hasOutputOrderColumn: hasCol,
    posts: rows.map(function (row) {
      return {
        postId: row[P.POST_ID], postNameTC: row[P.POST_NAME_TC],
        slotCount: Number(row[P.SLOT_COUNT]) || 1, displayOrder: Number(row[P.DISPLAY_ORDER]),
        outputOrder: hasCol ? row[P.OUTPUT_ORDER] : '', emptyDisplay: row[P.EMPTY_DISPLAY]
      };
    })
  };
}

/**
 * 讀 NameMapping 全部人（包括已停用——舊版本可能有停用了的人）：PersonID → 中英文名。
 * @returns {Object.<string, {nameTC: string, nameEN: string}>}
 */
function readPeopleNamesForOutput_() {
  const N = COLUMNS.NAME_MAPPING;
  const out = {};
  readSheet_(SHEETS.NAME_MAPPING).forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    if (id) out[id] = { nameTC: String(row[N.NAME_TC] || '').trim(), nameEN: String(row[N.NAME_EN] || '').trim() };
  });
  return out;
}

/**
 * 讀齊一個版本要輸出的資料，組成 `buildRosterOutputModel_()` 的輸入，再建版面。**唯讀。**
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {Object} model
 */
function buildRosterOutputForVersion_(quarterId, versionNo) {
  const assignments = readVersionAssignmentsForGrid_(quarterId, versionNo);
  if (assignments.length === 0) {
    throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄，無法產生職事表。');
  }
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const S = COLUMNS.SERVICE_DATES;
  const serviceDates = readServiceDates_(quarterId)
    .map(function (row) { return { d: toDateString_(row[S.SERVICE_DATE], timezone), w: Number(row[S.WEEK_INDEX]) }; })
    .filter(function (x) { return !!x.d; })
    .sort(function (a, b) { return a.d < b.d ? -1 : (a.d > b.d ? 1 : 0); })
    .map(function (x) { return x.d; });
  const postInfo = readPostsForOutput_();
  const stamp = readLatestAssignmentUpdatedAt_(quarterId, versionNo, timezone) || nowTimestamp_();
  return buildRosterOutputModel_({
    quarterId: quarterId,
    serviceDates: serviceDates,
    specialTitleByDate: buildDisplayTitleIndex_(quarterId, timezone),
    externalOwnerByDate: buildSpecialSundayExternalOwnerIndex_(quarterId, timezone),
    posts: postInfo.posts,
    hasOutputOrderColumn: postInfo.hasOutputOrderColumn,
    assignments: assignments,
    people: readPeopleNamesForOutput_(),
    updatedDate: formatOutputUpdatedDate_(stamp),
    titlePattern: String(getConfig_(CONFIG_KEYS.ROSTER_OUTPUT_TITLE_PATTERN, DEFAULTS.ROSTER_OUTPUT_TITLE_PATTERN) || DEFAULTS.ROSTER_OUTPUT_TITLE_PATTERN),
    footerText: fillContactName_(String(getConfig_(CONFIG_KEYS.ROSTER_OUTPUT_FOOTER_TC, DEFAULTS.ROSTER_OUTPUT_FOOTER_TC) || '')),
    showCounts: getConfig_(CONFIG_KEYS.ROSTER_OUTPUT_SHOW_COUNTS, DEFAULTS.ROSTER_OUTPUT_SHOW_COUNTS) !== false
  });
}

/* ═════════════════════════ 寫入工作表（GAS） ═════════════════════════ */

/**
 * 把一張 sheet 描述寫入工作表。呼叫前工作表要已經 `resetSheetToBlankSlate_()`。
 * 次序：尺寸 → 內容 → 格式 → 框線 → 合併 → 欄闊列高 → 凍結（凍結一定最後，見 PublicRoster.gs 第十三輪說明）。
 * @param {Sheet} sheet
 * @param {Object} sm sheet 描述
 * @returns {void}
 */
function writeRosterOutputSheet_(sheet, sm) {
  ensureSheetDimensions_(sheet, sm.numRows, sm.numCols);
  sheet.setName(sm.name);
  const all = sheet.getRange(1, 1, sm.numRows, sm.numCols);
  // 先設純文字格式：日子「4」「12」寫入後不會變成數字（第十三輪試過顯示成「3.0」）
  all.setNumberFormat('@');
  all.setValues(sm.values);
  all.setFontFamily(ROSTER_OUTPUT_FONT);
  all.setBackgrounds(sm.backgrounds);
  all.setFontWeights(sm.fontWeights);
  all.setFontSizes(sm.fontSizes);
  all.setFontColors(sm.fontColors);
  all.setHorizontalAlignments(sm.horizontalAlignments);
  all.setVerticalAlignment('middle');
  if (sm.wrapRange) {
    sheet.getRange(sm.wrapRange.row, sm.wrapRange.col, sm.wrapRange.numRows, sm.wrapRange.numCols).setWrap(true);
  }
  if (sm.borderRange) {
    sheet.getRange(sm.borderRange.row, sm.borderRange.col, sm.borderRange.numRows, sm.borderRange.numCols)
      .setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  }
  if (sm.titleRich) applyRosterOutputTitleRichText_(sheet.getRange(1, 1), sm.titleRich);
  sm.merges.forEach(function (m) {
    sheet.getRange(m.row, m.col, m.numRows, m.numCols).merge();
  });
  sm.columnWidths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  Object.keys(sm.rowHeights).forEach(function (k) { sheet.setRowHeight(Number(k), sm.rowHeights[k]); });
  if (sm.frozenRows) sheet.setFrozenRows(sm.frozenRows);
  if (sm.frozenColumns) sheet.setFrozenColumns(sm.frozenColumns);
}

/**
 * 標題「粵語堂」用較粗的字型（其餘照標題字型）。做不到只記 WARN（標題文字本身已經寫好）。
 * @param {Range} range A1
 * @param {{text: string, prefixLength: number}} rich
 * @returns {void}
 */
function applyRosterOutputTitleRichText_(range, rich) {
  try {
    const base = SpreadsheetApp.newTextStyle().setFontFamily(ROSTER_OUTPUT_FONT).setBold(true).setFontSize(20).build();
    const prefix = SpreadsheetApp.newTextStyle().setFontFamily(ROSTER_OUTPUT_TITLE_FONT).setBold(true).setFontSize(24).build();
    const value = SpreadsheetApp.newRichTextValue().setText(rich.text)
      .setTextStyle(0, rich.text.length, base)
      .setTextStyle(0, rich.prefixLength, prefix)
      .build();
    range.setRichTextValue(value);
  } catch (err) {
    log_('WARN', '職事表標題字型設定不到（標題文字已寫好）：' + err.message);
  }
}

/**
 * 把整個 model 寫入一個試算表：第一張「職事表」，第二張「服侍次數」（開關關掉就刪走）。
 * 其他工作表一律刪走（公開檔只可以有這兩張）。
 * @param {Spreadsheet} spreadsheet
 * @param {Object} model
 * @returns {{rosterSheet: Sheet, countsSheet: ?Sheet}}
 */
function writeRosterOutputToSpreadsheet_(spreadsheet, model) {
  // ⚠️ 用 getSheetId() 比較：GAS 每次 getSheets()／getSheetByName() 都回一個**新的** Sheet 物件，
  // 用 === / !== 比較永遠不相等——第一次部署實測撞到「You can't remove all the sheets in a document」。
  const existing = spreadsheet.getSheets();
  const rosterSheet = existing[0];
  const rosterId = rosterSheet.getSheetId();
  const countsName = model.sheets[1] ? model.sheets[1].name : '';
  const keepCounts = countsName ? spreadsheet.getSheetByName(countsName) : null;
  const keepCountsId = (keepCounts && keepCounts.getSheetId() !== rosterId) ? keepCounts.getSheetId() : null;
  // 第一張以外、名字會撞的（例如幹事手動加了一張「職事表」）先刪走，改名時才不會撞名
  existing.slice(1).forEach(function (s) {
    if (s.getSheetId() !== keepCountsId && s.getName() === model.sheets[0].name) spreadsheet.deleteSheet(s);
  });
  resetSheetToBlankSlate_(rosterSheet);
  writeRosterOutputSheet_(rosterSheet, model.sheets[0]);
  let countsSheet = null;
  if (model.sheets[1]) {
    countsSheet = keepCountsId !== null ? keepCounts : spreadsheet.insertSheet(countsName);
    resetSheetToBlankSlate_(countsSheet);
    writeRosterOutputSheet_(countsSheet, model.sheets[1]);
  }
  const keepIds = [rosterId].concat(countsSheet ? [countsSheet.getSheetId()] : []);
  spreadsheet.getSheets().forEach(function (s) {
    if (keepIds.indexOf(s.getSheetId()) === -1) spreadsheet.deleteSheet(s);
  });
  return { rosterSheet: rosterSheet, countsSheet: countsSheet };
}

/* ═════════════════════════ PDF（GAS） ═════════════════════════ */

/** 暫存試算表檔名前綴（用完移到垃圾桶）。 */
const ROSTER_OUTPUT_TEMP_PREFIX = '_職事表輸出暫存_';

/**
 * 開一個可以連續產生多份 PDF（整季版、每人的 highlight 版）的 context：
 * 版面只寫一次，之後每人只改那個人的格。**用完一定要 `close()`**（暫存檔移到垃圾桶）。
 * @param {string} quarterId
 * @param {number} versionNo
 * @param {{wantHighlight: boolean}=} opts
 * @returns {Object}
 */
function openRosterOutputPdfContext_(quarterId, versionNo, opts) {
  const model = buildRosterOutputForVersion_(quarterId, versionNo);
  const ss = SpreadsheetApp.create(ROSTER_OUTPUT_TEMP_PREFIX + quarterId + '_v' + versionNo + '_' + Date.now());
  const ctx = {
    quarterId: quarterId, versionNo: versionNo, model: model, spreadsheet: ss,
    wantHighlight: !!(opts && opts.wantHighlight),
    highlightStyle: parseRosterOutputHighlightStyle_(getConfig_(CONFIG_KEYS.ROSTER_OUTPUT_HIGHLIGHT_STYLE, DEFAULTS.ROSTER_OUTPUT_HIGHLIGHT_STYLE)),
    rosterSheet: null, highlighted: [],
    close: function () {
      try {
        DriveApp.getFileById(ss.getId()).setTrashed(true);
      } catch (err) {
        log_('WARN', '職事表輸出暫存檔移到垃圾桶失敗：' + err.message);
      }
    }
  };
  try {
    ctx.rosterSheet = writeRosterOutputToSpreadsheet_(ss, model).rosterSheet;
    SpreadsheetApp.flush();
  } catch (err) {
    ctx.close();
    throw err;
  }
  return ctx;
}

/**
 * 格 → A1 寫法。
 * @param {{row: number, col: number}} cell
 * @returns {string}
 */
function rosterOutputCellA1_(cell) {
  let n = cell.col;
  let letters = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    letters = String.fromCharCode(65 + m) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters + cell.row;
}

/**
 * 個人版：先把上一個人的格還原，再標示這一個人的格（粗體、深紅字、粗框；可在 Config 改）。
 * 黃色只代表「未有人」，所以預設不用底色。
 * @param {Object} ctx `openRosterOutputPdfContext_()` 的結果
 * @param {{row: number, col: number}[]} cells
 * @returns {number} 標示了幾格
 */
function applyRosterOutputHighlight_(ctx, cells) {
  const sheet = ctx.rosterSheet;
  const style = ctx.highlightStyle;
  const model = ctx.model.sheets[0];
  if (ctx.highlighted.length > 0) {
    const prev = sheet.getRangeList(ctx.highlighted.map(rosterOutputCellA1_));
    prev.setFontWeight('normal').setFontColor('#000000');
    if (style.border) prev.setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    if (style.background) {
      ctx.highlighted.forEach(function (c) { sheet.getRange(c.row, c.col).setBackground(model.backgrounds[c.row - 1][c.col - 1]); });
    }
    ctx.highlighted = [];
  }
  if (!cells || cells.length === 0) return 0;
  const list = sheet.getRangeList(cells.map(rosterOutputCellA1_));
  if (style.bold) list.setFontWeight('bold');
  if (style.fontColor) list.setFontColor(style.fontColor);
  if (style.border) list.setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
  if (style.background) list.setBackground(style.background);
  ctx.highlighted = cells.slice();
  return cells.length;
}

/**
 * 匯出整個暫存試算表（第 1 頁職事表、第 2 頁服侍次數）。A4 橫向、縮到頁寬、沒有格線及頁碼。
 * @param {Object} ctx
 * @param {string} fileName
 * @returns {{blob: Blob, retries: number}}
 */
function exportRosterOutputPdfBlob_(ctx, fileName) {
  const params = buildRosterOutputPdfExportParams_().join('&');
  const url = 'https://docs.google.com/spreadsheets/d/' + ctx.spreadsheet.getId() + '/export?' + params;
  const minBytes = Math.max(0, Math.round(getConfig_(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
  const result = fetchWithRetry_(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  }, minBytes);
  if (result.responseCode !== 200) {
    const error = new Error('匯出 PDF 失敗，HTTP ' + result.responseCode + '（已重試 ' + result.retries + ' 次）'
      + (result.responseCode === 429 ? '——Google 試算表匯出的速率限制，連續匯出大量 PDF 時常見。' : ''));
    error.retries = result.retries;
    throw error;
  }
  if (result.blobTooSmall) {
    const error = new Error('匯出 PDF 內容過小（' + result.blob.getBytes().length + ' bytes，門檻 ' + minBytes
      + ' bytes），已重試 ' + result.retries + ' 次仍然過小，內容可能空白或截斷。');
    error.retries = result.retries;
    throw error;
  }
  return { blob: result.blob.setName(fileName), retries: result.retries };
}

/**
 * 匯出參數（不指定 gid ＝ 整份試算表，每張工作表另起一頁）。
 * @returns {string[]}
 */
function buildRosterOutputPdfExportParams_() {
  return [
    'format=pdf', 'size=A4', 'portrait=false', 'fitw=true',
    'gridlines=false', 'printtitle=false', 'sheetnames=false', 'pagenumbers=false',
    'shownotes=false', 'printnotes=false', 'fzr=false',
    'horizontal_alignment=CENTER', 'vertical_alignment=TOP',
    'top_margin=0.35', 'bottom_margin=0.35', 'left_margin=0.35', 'right_margin=0.35'
  ];
}

/* ═════════════════════════ Posts.OutputOrder 補建 ═════════════════════════ */

/**
 * 〔補建設定及範本〕：`Posts` 有沒有 `OutputOrder` 欄、要填甚麼值（唯讀）。
 * 只在欄不存在、或整欄都是空白時才填（有人填過一個值就不碰）。
 * @returns {{needed: boolean, columnExists: boolean, fills: Object[]}}
 */
function planPostOutputOrderSeed_() {
  const P = COLUMNS.POSTS;
  const rows = readSheet_(SHEETS.POSTS);
  const columnExists = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], P.OUTPUT_ORDER);
  const anyFilled = columnExists && rows.some(function (r) { return String(r[P.OUTPUT_ORDER] === undefined ? '' : r[P.OUTPUT_ORDER]).trim() !== ''; });
  if (anyFilled) return { needed: false, columnExists: true, fills: [] };
  const fills = rows.map(function (r) {
    const idx = ROSTER_OUTPUT_SEED_POST_ORDER.indexOf(normalizeOutputPostName_(r[P.POST_NAME_TC]));
    return { postId: String(r[P.POST_ID] || ''), postNameTC: String(r[P.POST_NAME_TC] || ''), value: idx >= 0 ? (idx + 1) * 10 : '' };
  }).filter(function (f) { return f.postId; });
  return { needed: true, columnExists: columnExists, fills: fills };
}

/**
 * 〔補建設定及範本〕：補 `OutputOrder` 欄並按樣本次序填好（10、20、30…；樣本沒有的崗位留空＝用 DisplayOrder）。
 * @param {Object} plan `planPostOutputOrderSeed_()` 的結果
 * @returns {number} 填了幾行
 */
function seedPostOutputOrder_(plan) {
  if (!plan || !plan.needed) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
  const lastCol = sheet.getLastColumn();
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (k) { return String(k || '').trim(); });
  let colIndex = keys.indexOf(COLUMNS.POSTS.OUTPUT_ORDER) + 1;
  if (colIndex <= 0) {
    colIndex = lastCol + 1;
    if (sheet.getMaxColumns() < colIndex) sheet.insertColumnsAfter(sheet.getMaxColumns(), colIndex - sheet.getMaxColumns());
    sheet.getRange(1, colIndex).setValue('輸出次序（寄出／公開職事表）');
    sheet.getRange(2, colIndex).setValue(COLUMNS.POSTS.OUTPUT_ORDER);
  }
  const idCol = keys.indexOf(COLUMNS.POSTS.POST_ID) + 1;
  const lastRow = sheet.getLastRow();
  if (idCol <= 0 || lastRow < 3) return 0;
  const ids = sheet.getRange(3, idCol, lastRow - 2, 1).getValues();
  const byId = {};
  plan.fills.forEach(function (f) { byId[f.postId] = f.value; });
  const out = ids.map(function (r) {
    const postId = String(r[0] || '').trim();
    return [postId && byId[postId] !== undefined ? byId[postId] : ''];
  });
  sheet.getRange(3, colIndex, out.length, 1).setValues(out);
  return out.filter(function (r) { return r[0] !== ''; }).length;
}
