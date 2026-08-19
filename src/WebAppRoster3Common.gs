/**
 * 第二十五輪批次階段 E：區三「名單維護」嘅**共用寫入層**。
 *
 * 對應 `docs/幹事介面規格.md` 第四節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 呢一輪係第一次由 Web 介面寫入**真實會友資料**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 之前全部寫入都只碰職事表——嗰啲可以重新生成。名單改壞咗係**改壞真人
 * 資料**：一個電郵打錯、一個 Active 撳錯，就會有人永遠收唔到通知，
 * 而畫面上完全睇唔出。
 *
 * 所以呢個檔案定死四條規矩，區三全部畫面共用：
 *
 *   1. **唔刪行。** 只有 `Active` 開關或者 `EffectiveTo`。介面上冇「刪除」掣。
 *   2. **只改該行該欄。** 用 `writeRowFields_()`，永遠唔整行覆寫——
 *      整行覆寫會靜靜咁清空啲你冇顯示喺畫面上嘅欄（例如 `Phone`、
 *      `Congregation`、`SyncedAt`），而幹事完全唔知發生咗。
 *   3. **每次寫入都寫 `AuditLog`**（含 `oldValue`／`newValue`）。
 *   4. **儲存前確認。** 呢個喺前端做，但後端唔靠前端——所有寫入 API
 *      都會自己再驗一次先寫。
 *
 * 「寧可多一個確認畫面，都好過靜靜改咗一行冇人知。」
 */

/** 區三全部寫入嘅 AuditLog `source`。方便日後一句 filter 就查得晒。 */
const WEBUI_AUDIT_SOURCE = 'WEBUI';

/**
 * 讀一張表嘅 sheet 物件同標題列。區三全部寫入都由呢度攞。
 * @param {string} sheetName 工作表名
 * @returns {{sheet: Object, headers: string[]}}
 */
function openSheetForEdit_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '找不到「' + sheetName + '」這張工作表。',
      '什麼都沒有改動。',
      [
        '檢查試算表下面的分頁有沒有被改名或者刪掉',
        '如果是新環境，先執行選單的「維護 ▸ 全新環境自我檢查」'
      ]));
  }
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  return { sheet: sheet, headers: headers };
}

/**
 * **只寫指定嘅欄，唔掂其他欄。**
 *
 * ⚠️ 呢個係區三最重要嗰條規矩嘅實作。反面例子係「讀成行 → 改幾個值 →
 * 成行寫返」——嗰種寫法會把畫面上冇顯示嘅欄（`Phone`、`Congregation`、
 * `LastAttendance`、`SyncedAt`…）一併寫返落去，而如果讀嗰陣有任何一欄
 * 讀成咗空白（例如新 schema 加咗欄），就會**靜靜清空真實資料**。
 *
 * @param {Object} sheet 工作表
 * @param {string[]} headers 標題列
 * @param {number} sheetRow 實際列號（1-based）
 * @param {Object.<string, *>} updates {欄名: 新值}
 * @returns {string[]} 實際寫咗嘅欄名（表上冇嗰啲會被略過）
 */
function writeRowFields_(sheet, headers, sheetRow, updates) {
  const written = [];
  Object.keys(updates).forEach(function (key) {
    const col = headers.indexOf(key) + 1;
    if (col === 0) return;   // 呢張表冇呢一欄（舊 schema），略過，唔好拋錯
    sheet.getRange(sheetRow, col).setValue(updates[key]);
    written.push(key);
  });
  return written;
}

/**
 * 喺表尾加一行。同 `writeRowFields_()` 一樣，只按標題列擺位。
 * @param {Object} sheet 工作表
 * @param {string[]} headers 標題列
 * @param {Object.<string, *>} record {欄名: 值}
 * @returns {number} 新那一行嘅列號
 */
function appendRowFields_(sheet, headers, record) {
  const row = headers.map(function (h) {
    return record[h] === undefined || record[h] === null ? '' : record[h];
  });
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  return targetRow;
}

/**
 * 區三專用嘅 AuditLog 寫入。統一 `source`，並且**強制要求 old／new 兩邊都有**
 * ——只記新值嘅話，日後查「究竟改咗啲乜」就要靠估。
 * @param {Object} entry {action, targetSheet, targetKey, oldValue, newValue, notes}
 */
function writeZone3Audit_(entry) {
  writeAuditLog_({
    action: entry.action,
    targetSheet: entry.targetSheet,
    targetKey: entry.targetKey,
    oldValue: entry.oldValue === undefined ? '' : String(entry.oldValue),
    newValue: entry.newValue === undefined ? '' : String(entry.newValue),
    source: WEBUI_AUDIT_SOURCE,
    notes: entry.notes || ''
  });
}

/**
 * 由一組 {欄名: 值} 砌一句人睇得明嘅摘要，供 AuditLog 嘅 old／new 用。
 * @param {Object.<string, *>} byField 欄名 → 值
 * @param {string[]} fieldOrder 要出現嘅欄同次序
 * @returns {string}
 */
function describeFields_(byField, fieldOrder) {
  return fieldOrder.map(function (f) {
    return f + '=' + displayCellValue_(byField[f], '（空白）');
  }).join('　');
}

/**
 * 搵一行嘅實際列號。
 *
 * ⚠️ **唔可以靠前端傳返嚟嘅列號就直接寫。** 前端攞到列號之後，
 * 幹事可能喺試算表插咗一行，個列號就會指去第二行——寫落去就係改錯人。
 * 所以每個寫入 API 都會用呢個函式**用 ID 重新搵一次**，
 * 而且會核對前端傳嘅列號同搵返嚟嗰個一唔一致。
 *
 * @param {string} sheetName 工作表名
 * @param {string} idColumn ID 欄名
 * @param {string} idValue 要搵嘅 ID
 * @returns {{sheetRow: number, record: Object}} 搵唔到時 sheetRow = -1
 */
function findRowById_(sheetName, idColumn, idValue) {
  const rows = readSheet(sheetName);
  const target = String(idValue || '').trim();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][idColumn] || '').trim() === target) {
      // readSheet 由第 3 行開始（第 1 行係說明、第 2 行係標題），所以 +3。
      return { sheetRow: i + 3, record: rows[i] };
    }
  }
  return { sheetRow: -1, record: null };
}

/**
 * 區三共用：`PersonID` → 中文名。畫面上一律顯示人名，唔顯示 ID。
 * @returns {Object.<string, string>}
 */
function buildPersonNameIndex_() {
  const C = COLUMNS.NAME_MAPPING;
  const index = {};
  readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
    const id = String(row[C.PERSON_ID] || '').trim();
    if (id) index[id] = String(row[C.NAME_TC] || '').trim() || id;
  });
  return index;
}

/**
 * 區三共用：搜尋比對（中文名、英文名、PersonID）。
 * @param {string} keyword 搜尋字
 * @param {string[]} haystack 要比對嘅欄值
 * @returns {boolean} 空白關鍵字一律回 true（＝唔過濾）
 */
function matchesPeopleSearch_(keyword, haystack) {
  const k = String(keyword || '').trim().toLowerCase();
  if (k === '') return true;
  return haystack.some(function (v) {
    return String(v === null || v === undefined ? '' : v).toLowerCase().indexOf(k) !== -1;
  });
}

/**
 * 區三共用：一個備註值值唔值得顯示。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 第二十八輪批次階段 E1：Ivan 實測
 * ─────────────────────────────────────────────────────────────────────
 *
 * `Roles` 同 `PersonPostExclusions` 好多行嘅 `Notes` 就係嗰個人自己個名
 *（當初匯入資料嗰陣順手填落去嘅）。畫面上就會變成
 *
 *   當值堂委　2026-01-01 至 現在　在任
 *   備註：（同一個名，而個名已經喺上面一行）
 *
 * 每一行都多一行冇資訊嘅字。
 *
 * ⚠️ **呢度只改顯示，唔改試算表。** 試算表入面嗰啲值照舊——
 * 一個「順手幫你清理資料」嘅動作，係喺幹事冇要求、冇確認、
 * 冇得反悔嘅情況下改人哋啲資料。
 *
 * 判斷特登收窄：**淨係**個備註剝走前後空白之後同個名一模一樣先當成雜訊。
 * 「陳大文（暫代）」呢類含住名但另有資訊嘅，照樣顯示。
 *
 * @param {*} notes 試算表讀出嚟嗰個 Notes 值
 * @param {string} nameTC 同一行嗰個人嘅中文名
 * @returns {string} 值得顯示就回原值（已剝走前後空白），否則回空字串
 */
function displayableNote_(notes, nameTC) {
  const text = String(notes === null || notes === undefined ? '' : notes).trim();
  if (text === '') return '';
  const name = String(nameTC === null || nameTC === undefined ? '' : nameTC).trim();
  if (name !== '' && text === name) return '';
  return text;
}
