// 第三十二輪批次 Prompt N：一個「形狀貼近真實 Google 試算表」嘅
// `SpreadsheetApp` mock，專門俾 `tests/e2e_five_stage_flow.test.js` 用。
//
// ─────────────────────────────────────────────────────────────────────
// 點解要新開一個檔案，唔改 `mock_roster_data.js` 或者 `sheet_mock.js`
// ─────────────────────────────────────────────────────────────────────
//
// `mock_roster_data.js` 組出嚟嘅係**已經正規化**嘅 `context` 物件（即係
// `buildGeneratorContext_()` 執行完之後嗰個形狀），唔係試算表原始儲存格
// ——用嚟直接餵生成器，跳過咗 `readSheet()` 呢一層。呢份 e2e 測試嘅重點
// 正正係唔可以跳過呢一層。
//
// `sheet_mock.js` 有 `getRange().setValues()`／合併／格式化，但冇
// `getLastRow()`／`getLastColumn()`（佢係為咗測公開試算表版面轉置嗰類
// 「畫面點render」而寫嘅，唔係為咗俾 `readSheet()` 用）。
//
// ⚠️ 本專案燒過三次嘅 bug class：**mock 餵乾淨字串，真正嘅
// `SpreadsheetApp` 餵 JS 物件。** 第三十一輪嗰個「ICS 時間治本從來冇生效
// 過」就係呢個形狀——測試直接餵一個 Date 物件落純函式，而真實環境經
// `convertConfigValue_()` 之後餵落嚟嘅係一個字串（`String(Date)`）。
// 所以呢個 mock 刻意喺寫入嗰一刻做「睇落似日期／時間就自動轉成 Date
// 物件」嘅正規化，模擬 Google 試算表自己嘅行為，唔係凈係一個死板嘅
// key-value store。
//
// ─────────────────────────────────────────────────────────────────────
// 呢個 mock 做得到、做唔到嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// 做得到：`getLastRow()`／`getLastColumn()`／`getRange(row,col,numRows,
// numCols).getValues()/.setValues()/.getValue()/.setValue()`、
// `insertSheet()`／`getSheetByName()`——即係 `readSheet()`／
// `findQuarterRowInfo_()`／`registerVersion()`／`advanceQuarterStage_()`
// 呢類「讀寫一定範圍嘅儲存格」嘅函式，可以喺 Node 度真正執行一次。
//
// 做唔到：合併格、底色、字型呢類版面格式化——呢類方法一律做成
// no-op（回 `this` 就算，唔會拋錯），因為呢份測試嘅重點係「五個步驟
// 銜接、Stage 前唔前進」，唔係「grid 畫出嚟靚唔靚」（嗰個由
// `grid_cell_presentation.test.js` 呢類測試用 `sheet_mock.js` 覆蓋）。

/**
 * 一個儲存格範圍。
 */
class RealisticMockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
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

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        this.sheet._setCell(this.row + r, this.col + c, values[r][c]);
      }
    }
    return this;
  }

  setValue(v) { this.sheet._setCell(this.row, this.col, v); return this; }

  // ── 版面格式化 ────────────────────────────────────────────
  //
  // ⚠️ 第四十三輪批次 C1：**底色同格註而家會記低。**
  //
  // 之前兩樣都係 no-op，理由係「格式唔喺任何測試嘅斷言範圍內」。
  // 而第四十三輪現場撞到嘅正正就係格式：對話框報「黃色格 1 格」，
  // 而張表上一格黃色都冇。冇一條測試睇得到底色，所以冇一條測試捉得到。
  //
  // 由呢一輪起嘅規矩：**對話框報告嘅每一個數字，
  // 都要有一條測試證明表上真係有對應嘅嘢。** 要做到就要睇得到格式。
  setBackground(color) { this._eachCell((r, c) => this.sheet._setBg(r, c, color)); return this; }
  setBackgrounds(colors) {
    for (let r = 0; r < colors.length; r++) {
      for (let c = 0; c < colors[r].length; c++) {
        this.sheet._setBg(this.row + r, this.col + c, colors[r][c]);
      }
    }
    return this;
  }
  getBackground() { return this.sheet._getBg(this.row, this.col); }
  getBackgrounds() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(this.sheet._getBg(this.row + r, this.col + c));
      out.push(rowArr);
    }
    return out;
  }
  _eachCell(fn) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) fn(this.row + r, this.col + c);
    }
  }
  setFontWeight() { return this; }
  setFontWeights() { return this; }
  setFontStyle() { return this; }
  setFontColor() { return this; }
  setFontColors() { return this; }
  setFontSize() { return this; }
  setWrap() { return this; }
  setWraps() { return this; }
  setVerticalAlignment() { return this; }
  setHorizontalAlignment() { return this; }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setBorder() { return this; }
  clearDataValidations() { return this; }
  setDataValidation() { return this; }
  merge() { return this; }
  mergeAcross() { return this; }
  breakApart() { return this; }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet._setCell(this.row + r, this.col + c, '');
    }
    return this;
  }
  clearFormat() { return this; }
  setNote(note) { this.sheet._setNote(this.row, this.col, note); return this; }
  // 第三十三輪批次階段 F1：`RosterWriter.gs` 嘅 `applyCellMarks_()` 用
  // `setNotes()`（複數）批次寫格註。同其餘格式方法一樣係 no-op——
  // 呢個 mock 只保留「值」，格式／註解唔喺任何測試嘅斷言範圍內。
  setNotes(notes) {
    for (let r = 0; r < notes.length; r++) {
      for (let c = 0; c < notes[r].length; c++) {
        this.sheet._setNote(this.row + r, this.col + c, notes[r][c]);
      }
    }
    return this;
  }
  getNote() { return this.sheet._getNote(this.row, this.col); }
  getNotes() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(this.sheet._getNote(this.row + r, this.col + c));
      out.push(rowArr);
    }
    return out;
  }
  setFontFamily() { return this; }
  setTextRotation() { return this; }
  setShowHyperlink() { return this; }
  protect() {
    return {
      setDescription: function () { return this; },
      removeEditors: function () { return this; },
      addEditors: function () { return this; },
      setWarningOnly: function () { return this; },
      getRange: function () { return null; }
    };
  }
  copyTo() { return this; }
  getA1Notation() {
    const colName = function (n) {
      let s = '';
      while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    return colName(this.col) + this.row
      + ':' + colName(this.col + this.numCols - 1) + (this.row + this.numRows - 1);
  }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
}

/**
 * 一格值睇落似唔似「試算表會自動正規化成 Date」嘅形狀。
 *
 * ⚠️ 判斷特登收窄（同 `normalizeTimeOfDay_()` 一樣嘅原則）：淨係認
 * `YYYY-MM-DD`（本專案內部一律用呢個格式）同 `HH:mm`／`HH:mm:ss`。
 * 收得闊會把唔應該轉嘅字串（例如人名、備註）誤轉做 Date。
 *
 * @param {*} v
 * @returns {?Date} 轉到就回 Date 物件；轉唔到回 `null`
 */
function looksLikeSheetsAutoDate_(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const d = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
    return isNaN(d.getTime()) ? null : d;
  }
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    // 試算表把純時間存做 1899-12-30 當日嘅 Date（同 Config 時間格一樣嘅形狀，
    // 見第三十一輪批次階段 A 嘅治本）。
    const d = new Date(1899, 11, 30, Number(timeMatch[1]), Number(timeMatch[2]), Number(timeMatch[3] || 0));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * 一張工作表。
 */
class RealisticMockSheet {
  constructor(name) {
    this._name = name;
    this._cells = new Map();   // 'r,c' -> value
    this._bg = new Map();      // 'r,c' -> 底色（第四十三輪 C1）
    this._notes = new Map();   // 'r,c' -> 格註
    this._maxRow = 0;
    this._maxCol = 0;
    this._frozenRows = 0;
    this._frozenCols = 0;
  }

  getName() { return this._name; }
  setName(n) { this._name = n; return this; }

  // ⚠️ `readSheet()`／`findQuarterRowInfo_()` 全部靠呢兩個方法決定
  // 「有幾多行／欄有資料」——呢個 mock 嘅核心就係要令佢哋答得啱。
  getLastRow() { return this._maxRow; }
  getLastColumn() { return this._maxCol; }
  getMaxRows() { return Math.max(this._maxRow, 1000); }
  getMaxColumns() { return Math.max(this._maxCol, 26); }

  getRange(row, col, numRows, numCols) {
    return new RealisticMockRange(this, row, col, numRows || 1, numCols || 1);
  }

  _key(r, c) { return r + ',' + c; }

  _getCell(r, c) {
    const v = this._cells.get(this._key(r, c));
    return v === undefined ? '' : v;
  }

  _setCell(r, c, v) {
    // ⚠️ 呢一步就係整個 mock 嘅重點：模擬 Google 試算表寫入時嘅自動正規化。
    // 見 `looksLikeSheetsAutoDate_()` 嘅收窄準則。
    const auto = looksLikeSheetsAutoDate_(v);
    this._cells.set(this._key(r, c), auto !== null ? auto : v);
    if (r > this._maxRow) this._maxRow = r;
    if (c > this._maxCol) this._maxCol = c;
  }

  // 第四十三輪批次 C1：底色同格註。⚠️ **只記低，冇任何自動正規化**——
  // 真 Sheets 會把 `#FFF3C4` 正規化成小階，所以斷言嗰邊要自己
  // 用小階比對（`String(bg).toLowerCase()`）。呢個 mock 唔扮嗰一步，
  // 扮錯咗會令測試對住一個唔存在嘅行為綠燈。
  _setBg(r, c, color) { this._bg.set(this._key(r, c), color); }
  _getBg(r, c) {
    const v = this._bg.get(this._key(r, c));
    return v === undefined ? '#ffffff' : v;
  }
  _setNote(r, c, note) { this._notes.set(this._key(r, c), note === undefined ? '' : note); }
  _getNote(r, c) {
    const v = this._notes.get(this._key(r, c));
    return v === undefined ? '' : v;
  }

  setFrozenRows(n) { this._frozenRows = n; return this; }
  setFrozenColumns(n) { this._frozenCols = n; return this; }
  getFrozenRows() { return this._frozenRows; }
  getFrozenColumns() { return this._frozenCols; }
  setColumnWidth() { return this; }
  setColumnWidths() { return this; }
  setRowHeight() { return this; }
  autoResizeColumns() { return this; }
  clear() { this._cells.clear(); this._maxRow = 0; this._maxCol = 0; return this; }
  clearContents() { return this.clear(); }
  clearFormats() { return this; }
  deleteColumns() { return this; }
  deleteRows() { return this; }
  insertColumnsAfter() { return this; }
  insertRowsAfter() { return this; }
  getSheetId() { return Math.abs(hashString_(this._name)); }
  activate() { return this; }
  hideSheet() { return this; }
  showSheet() { return this; }
  // 第三十三輪批次階段 F1：`createRosterSheet()` 會 `hideRows(2)`
  //（機器鍵嗰行）。隱藏與否唔影響 `getValues()`，所以係 no-op——
  // 但一定要存在，唔係 `createRosterSheet()` 會中途拋錯，
  // 而**工作表已經建立咗**，變成一張半成品 grid。
  hideRows() { return this; }

  // 第三十九輪批次：writeToPossiblyProtectedGridSheet_() 會問工作表有冇保護。
  // 回一個空陣列 ＝「冇保護」，於是嗰個包裝會直接跑 writeFn()。
  // ⚠️ 呢個 mock **唔模擬保護**，所以任何一份測試都唔可以用佢去證明
  // 「寫入受保護工作表」嗰條路行得通——嗰件事要喺真實環境驗。
  getProtections() { return []; }
  showRows() { return this; }
  hideColumns() { return this; }
  showColumns() { return this; }
  getDataRange() { return this.getRange(1, 1, Math.max(this._maxRow, 1), Math.max(this._maxCol, 1)); }
  setHiddenGridlines() { return this; }
  setTabColor() { return this; }
  protect() {
    return {
      setDescription: function () { return this; },
      removeEditors: function () { return this; },
      addEditors: function () { return this; },
      setWarningOnly: function () { return this; }
    };
  }
}

function hashString_(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}

/**
 * 整份試算表。
 */
class RealisticMockSpreadsheet {
  constructor() {
    this._sheets = [];
    this._auditRows = [];
  }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(name) {
    return this._sheets.find(function (s) { return s.getName() === name; }) || null;
  }
  insertSheet(name) {
    if (this.getSheetByName(name)) {
      throw new Error('A sheet with the name "' + name + '" already exists. Please enter another name. (mock)');
    }
    const s = new RealisticMockSheet(name);
    this._sheets.push(s);
    return s;
  }
  deleteSheet(sheet) {
    this._sheets = this._sheets.filter(function (s) { return s !== sheet; });
  }
  getId() { return 'mock-e2e-spreadsheet-id'; }
  getUrl() { return 'https://example.invalid/mock-e2e-spreadsheet'; }
  toast() {}
}

/**
 * 喺一個 `RealisticMockSpreadsheet` 度建立（或者覆寫）一張表，並且用
 * 「第 1 行中文標題、第 2 行機器鍵、第 3 行起資料」呢個全專案通用嘅
 * 慣例寫入。
 *
 * @param {RealisticMockSpreadsheet} spreadsheet
 * @param {string} sheetName SHEETS.* 嘅值
 * @param {string[]} titles 第 1 行（人睇嘅中文標題，內容唔重要，齊列數就得）
 * @param {string[]} keys 第 2 行（COLUMNS.* 嘅機器鍵，`readSheet()` 靠呢一行）
 * @param {Object[]} rows 資料列，每項一個 `{key: value}` 物件，缺嘅 key 當空字串
 * @returns {RealisticMockSheet}
 */
function seedSheet(spreadsheet, sheetName, titles, keys, rows) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, titles.length).setValues([titles]);
  sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  if (rows.length > 0) {
    const grid = rows.map(function (row) {
      return keys.map(function (k) {
        const v = row[k];
        return (v === undefined || v === null) ? '' : v;
      });
    });
    sheet.getRange(3, 1, grid.length, keys.length).setValues(grid);
  }
  return sheet;
}

/**
 * 追加資料列到一張已經存在嘅表（唔重寫標題）。
 * @param {RealisticMockSpreadsheet} spreadsheet
 * @param {string} sheetName
 * @param {string[]} keys 同 `seedSheet()` 嗰次要一致嘅次序
 * @param {Object[]} rows
 */
function appendRows(spreadsheet, sheetName, keys, rows) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('appendRows()：找不到工作表 ' + sheetName + '（測試 fixture 寫錯）');

  // ⚠️ 第三十八輪批次 F 組：**呢個函式係由第 1 欄開始逐個位寫落去嘅**，
  // 唔係按欄名對號入座。所以 `keys` 一定要同工作表第 2 行嘅機器鍵
  // **由頭開始逐個對齊**。
  //
  // 唔檢查嘅後果（實測撞到）：喺 `keys` 中間漏咗一個鍵，成行資料靜靜咁
  // 向左移一格——`QuarterID` 寫咗入 `RequestID` 欄、`ServiceDate` 寫咗入
  // `QuarterID` 欄……然後測試報「搵唔到待處理申報」，
  // 而真正嘅成因喺 fixture 度，同被測嘅程式一啲關係都冇。
  // 呢種錯要即刻大聲講出嚟，唔可以由得佢變成一個查半日嘅假 bug。
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const header = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(String);
    const bad = [];
    keys.forEach(function (k, i) {
      if (String(header[i]) !== String(k)) {
        bad.push('第 ' + (i + 1) + ' 欄：keys 寫住「' + k + '」，但表上係「' + header[i] + '」');
      }
    });
    if (bad.length > 0) {
      throw new Error('appendRows()：`keys` 同 ' + sheetName + ' 嘅欄位次序對唔上。\n'
        + bad.join('\n')
        + '\n呢個函式由第 1 欄開始逐個位寫，所以 keys 要由第 1 欄開始逐個對齊'
        + '（可以短過表，但唔可以跳欄、唔可以換次序）。\n'
        + '表上嘅次序：' + JSON.stringify(header));
    }
  }

  const startRow = Math.max(3, sheet.getLastRow() + 1);
  const grid = rows.map(function (row) {
    return keys.map(function (k) {
      const v = row[k];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  if (grid.length > 0) sheet.getRange(startRow, 1, grid.length, keys.length).setValues(grid);
}

module.exports = {
  RealisticMockRange,
  RealisticMockSheet,
  RealisticMockSpreadsheet,
  looksLikeSheetsAutoDate_,
  seedSheet,
  appendRows
};
