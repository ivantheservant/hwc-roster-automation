// 第十三輪批次階段 C：輕量版 Google 試算表 mock，模擬本專案實測撞到嘅
// 幾個結構性行為/限制（完整清單見 docs/GoogleSheetsAPI限制.md）：
//   - `Range.clear()`／`Sheet.clear()` 唔會解除合併、唔會歸零凍結列／欄；
//   - 合併格唔可以跨越凍結／非凍結分界線（列同欄都係）；
//   - 合併格之間唔可以部分重疊。
//
// 存在嘅理由：第十二輪批次 38 個測試檔全部 PASS，但真實試算表連續兩次
// 發佈都拋錯——因為之前嘅測試全部係「靜態字串檢查」（讀原始碼文字有冇
// 出現某個函式名），完全冇真正執行過會寫試算表嘅函式，捉唔到「呢個
// 呼叫喺呢個狀態下會唔會拋錯」呢類行為錯誤。呢個 mock 令
// `writePublicRosterContent_()`／`resetSheetToBlankSlate_()` 呢類函式
// 可以喺 Node 環境**真正執行一次**，包括模擬「工作表已經被上一次執行
// 寫過、留低合併/凍結殘留」嘅情況（`_seedResidualState()`）。
//
// ⚠️ 呢個 mock 唔係完整重現 Google Sheets API——只實作咗本專案會用到嘅
// 方法，而且部分方法係簡化模擬（見下面 `deleteColumns()`／`deleteRows()`
// 嘅註解）。詳細取捨記錄喺 docs/GoogleSheetsAPI限制.md「mock 層做得到
// 幾多」一節。

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  _cells() {
    const cells = [];
    for (let r = this.row; r < this.row + this.numRows; r++) {
      for (let c = this.col; c < this.col + this.numCols; c++) cells.push([r, c]);
    }
    return cells;
  }

  setValue(v) {
    this.sheet._checkBounds(this.row + this.numRows - 1, this.col + this.numCols - 1);
    this.sheet._setCell(this.row, this.col, v);
    return this;
  }

  setValues(values) {
    this.sheet._checkBounds(this.row + this.numRows - 1, this.col + this.numCols - 1);
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) this.sheet._setCell(this.row + r, this.col + c, values[r][c]);
    }
    return this;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(this.sheet._getCell(this.row + r, this.col + c));
      out.push(rowArr);
    }
    return out;
  }

  getValue() { return this.sheet._getCell(this.row, this.col); }

  setBackground(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'background', v); }); return this; }
  setBackgrounds(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) this.sheet._setFormat(this.row + r, this.col + c, 'background', values[r][c]);
    }
    return this;
  }
  setFontWeight(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'fontWeight', v); }); return this; }
  setFontStyle(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'fontStyle', v); }); return this; }
  setWrap(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'wrap', v); }); return this; }
  setVerticalAlignment(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'valign', v); }); return this; }
  setHorizontalAlignment(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'halign', v); }); return this; }
  setNumberFormat(v) { this._forEachCell(function (r, c, s) { s._setFormat(r, c, 'numberFormat', v); }); return this; }
  clearDataValidations() { return this; }

  _forEachCell(fn) {
    const sheet = this.sheet;
    this._cells().forEach(function (pair) { fn(pair[0], pair[1], sheet); });
  }

  /**
   * 模擬 Google 試算表嘅合併限制：唔可以跨越凍結／非凍結分界線，
   * 唔可以同其他合併格部分重疊。錯誤訊息刻意抄返 Google 實際嘅原文
   * （Ivan 實測時見到嗰兩句），令測試斷言可以直接對訊息文字。
   */
  merge() {
    const frozenRows = this.sheet._frozenRows;
    const frozenCols = this.sheet._frozenCols;
    const rowStart = this.row, rowEnd = this.row + this.numRows - 1;
    const colStart = this.col, colEnd = this.col + this.numCols - 1;

    if (frozenRows > 0 && rowStart <= frozenRows && rowEnd > frozenRows) {
      throw new Error("You can't merge frozen and non-frozen rows.");
    }
    if (frozenCols > 0 && colStart <= frozenCols && colEnd > frozenCols) {
      throw new Error("Sorry, you can't freeze columns which contain only part of a merged cell.");
    }

    const self = this;
    this.sheet._merges.forEach(function (m) {
      const overlap = !(colEnd < m.col || m.col + m.numCols - 1 < colStart
        || rowEnd < m.row || m.row + m.numRows - 1 < rowStart);
      if (!overlap) return;
      const sameRange = m.row === self.row && m.col === self.col
        && m.numRows === self.numRows && m.numCols === self.numCols;
      if (!sameRange) throw new Error('You can\'t merge cells that overlap another merged cell.');
    });

    this.sheet._merges = this.sheet._merges.filter(function (m) {
      return !(m.row === self.row && m.col === self.col && m.numRows === self.numRows && m.numCols === self.numCols);
    });
    this.sheet._merges.push({ row: this.row, col: this.col, numRows: this.numRows, numCols: this.numCols });
    return this;
  }

  breakApart() {
    const rowEnd = this.row + this.numRows - 1;
    const colEnd = this.col + this.numCols - 1;
    const self = this;
    this.sheet._merges = this.sheet._merges.filter(function (m) {
      const overlap = !(colEnd < m.col || m.col + m.numCols - 1 < self.col
        || rowEnd < m.row || m.row + m.numRows - 1 < self.row);
      return !overlap;
    });
    return this;
  }
}

class MockSheet {
  constructor(name) {
    this._name = name;
    this._maxRows = 1000;
    this._maxCols = 26;
    this._values = {};
    this._formats = {};
    this._notes = {};
    this._merges = [];
    this._frozenRows = 0;
    this._frozenCols = 0;
    this._columnWidths = {};
    this._rowHeights = {};
    this._conditionalFormatRules = [];
  }

  getName() { return this._name; }
  setName(n) { this._name = n; return this; }
  getMaxRows() { return this._maxRows; }
  getMaxColumns() { return this._maxCols; }

  getRange(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    this._checkBounds(row + numRows - 1, col + numCols - 1);
    return new MockRange(this, row, col, numRows, numCols);
  }

  _checkBounds(maxRow, maxCol) {
    if (maxRow > this._maxRows || maxCol > this._maxCols) {
      throw new Error('The coordinates or dimensions of the range are invalid. (mock: maxRows='
        + this._maxRows + ', maxCols=' + this._maxCols + ', 要求到 row=' + maxRow + ', col=' + maxCol + ')');
    }
  }

  _setCell(r, c, v) { this._values[r + ',' + c] = v; }
  _getCell(r, c) { const v = this._values[r + ',' + c]; return v === undefined ? '' : v; }
  _setFormat(r, c, key, v) {
    const k = r + ',' + c;
    if (!this._formats[k]) this._formats[k] = {};
    this._formats[k][key] = v;
  }
  _getFormat(r, c, key) {
    const k = r + ',' + c;
    return this._formats[k] ? this._formats[k][key] : undefined;
  }

  setFrozenRows(n) { this._frozenRows = n; return this; }
  setFrozenColumns(n) { this._frozenCols = n; return this; }
  getFrozenRows() { return this._frozenRows; }
  getFrozenColumns() { return this._frozenCols; }

  setColumnWidth(col, width) { this._columnWidths[col] = width; return this; }
  getColumnWidth(col) { return this._columnWidths[col] || 100; }
  setRowHeight(row, height) { this._rowHeights[row] = height; return this; }
  getRowHeight(row) { return this._rowHeights[row] || 21; }

  /** 刻意**唔**清 merges／frozen——模擬 GAS 嘅真實行為，見檔頭說明。 */
  clear() { this._values = {}; this._formats = {}; return this; }
  clearNotes() { this._notes = {}; return this; }
  clearConditionalFormatRules() { this._conditionalFormatRules = []; return this; }

  /**
   * 簡化模擬：只縮細 `_maxCols`／`_maxRows`，唔會將右邊/下面嘅資料實際
   * 向左/向上移。喺本專案嘅實際呼叫序（`resetSheetToBlankSlate_()` 一定
   * 先 `clear()` 晒所有值先至 `deleteColumns()`/`deleteRows()`）之下，
   * 呢個簡化唔影響任何測試結果——但如果未來有第二個呼叫點喺仲有資料嗰陣
   * 就刪欄／刪列，呢個 mock 唔會如實反映，用之前請留意。
   */
  deleteColumns(startCol, numCols) { this._maxCols = Math.max(1, this._maxCols - numCols); return this; }
  deleteRows(startRow, numRows) { this._maxRows = Math.max(1, this._maxRows - numRows); return this; }
  insertColumnsAfter(afterCol, numCols) { this._maxCols += numCols; return this; }
  insertRowsAfter(afterRow, numRows) { this._maxRows += numRows; return this; }

  /** 測試輔助：由外部直接種入殘留狀態，模擬「上一次執行留低嘅版面」。 */
  _seedResidualState(opts) {
    opts = opts || {};
    if (opts.frozenRows !== undefined) this._frozenRows = opts.frozenRows;
    if (opts.frozenCols !== undefined) this._frozenCols = opts.frozenCols;
    if (opts.merges) this._merges = opts.merges.slice();
    if (opts.maxRows) this._maxRows = opts.maxRows;
    if (opts.maxCols) this._maxCols = opts.maxCols;
    if (opts.values) Object.keys(opts.values).forEach((k) => { this._values[k] = opts.values[k]; });
  }
}

class MockSpreadsheet {
  constructor() {
    this._sheets = [new MockSheet('Sheet1')];
  }
  getSheets() { return this._sheets; }
  getSheetByName(name) { return this._sheets.find(function (s) { return s.getName() === name; }) || null; }
  insertSheet(name) { const s = new MockSheet(name); this._sheets.push(s); return s; }
  deleteSheet(sheet) { this._sheets = this._sheets.filter(function (s) { return s !== sheet; }); }
  getId() { return 'mock-spreadsheet-id'; }
  getUrl() { return 'https://example.invalid/mock-spreadsheet'; }
}

module.exports = { MockSpreadsheet, MockSheet, MockRange };
