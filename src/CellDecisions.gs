/**
 * 第七十五輪批次 CE／CF 組：**逐格決定（寫）**。
 *
 * ═════════════════════════════════════════════════════════════════════
 * Ivan 要嘅畫面（手動測試 A）
 * ═════════════════════════════════════════════════════════════════════
 *
 * 〔檢查我的改動〕變成「逐項確認」嘅地方：
 *   ・名單上找不到的名字：〔加入名單〕或 ☐「這一季臨時幫手，不加入名單」
 *   ・違反規則的格：每一格一個 ☐「保留我的安排，系統不要調整」（預設不勾）
 *   ・〔全部勾選〕
 * 每勾一格**即時記住**（重新整理後仍在；換了那一格的人就失效）。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 存喺邊
 * ═════════════════════════════════════════════════════════════════════
 *
 * 一張獨立工作表 `CellDecisions`（第一次勾選時自動建立）。唔用 AuditLog：
 * AuditLog 唔可以刪，而重設季度測試資料要清走呢啲決定（CP 組）；
 * 而且取消勾選要改返狀態，AuditLog 只可以加行。
 *
 * 讀嘅函式喺 SheetReader.gs（`readActiveCellDecisions_()`／`buildCellDecisionIndex_()`／
 * `buildDecisionItems_()`），因為檢查、調整、儲存、寄出都要用。
 */

/** `CellDecisions` 第 1 行中文標題（對應 `COLUMNS.CELL_DECISIONS` 次序）。 */
const CELL_DECISIONS_TITLES_TC = [
  '決定編號', '季度', '主日', '崗位', '位次', '種類（KEEP＝保留我的安排／TEMP_HELPER＝臨時幫手）',
  '決定時格內的名字', '規則', '狀態', '更新時間', '更新者'
];

/**
 * 取得（必要時建立）`CellDecisions` 工作表。第 1 行中文標題、第 2 行機器鍵、資料由第 3 行起。
 * @returns {Sheet}
 */
function ensureCellDecisionsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.CELL_DECISIONS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.CELL_DECISIONS);
  const keys = cellDecisionKeys_();
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  const ok = keys.every(function (k, i) { return existing[i] === k; });
  if (!ok) {
    sheet.getRange(1, 1, 1, CELL_DECISIONS_TITLES_TC.length).setValues([CELL_DECISIONS_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/** @returns {string[]} 機器鍵（次序同中文標題一致） */
function cellDecisionKeys_() {
  const D = COLUMNS.CELL_DECISIONS;
  return [D.DECISION_ID, D.QUARTER_ID, D.SERVICE_DATE, D.POST_ID, D.SLOT_INDEX, D.KIND,
    D.CELL_TEXT, D.RULE_ID, D.STATUS, D.UPDATED_AT, D.UPDATED_BY];
}

/**
 * 驗證並正規化前端送嚟嘅一項。唔啱 ⇒ 拋錯（**唔可以靜靜略過**——幹事會以為記住咗）。
 * @param {Object} item {serviceDate, postId, slotIndex, kind, cellText, ruleId, checked}
 * @returns {Object}
 */
function normalizeCellDecisionItem_(item) {
  const it = item || {};
  const serviceDate = String(it.serviceDate || '').trim();
  const postId = String(it.postId || '').trim();
  const slotIndex = Number(it.slotIndex);
  const kind = String(it.kind || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !postId || !(slotIndex >= 1)
    || (kind !== CELL_DECISION_KIND.KEEP && kind !== CELL_DECISION_KIND.TEMP_HELPER)) {
    throw new Error('記不住這一項決定：格子資料不完整（' + JSON.stringify(it) + '）。請按「重新整理」再試。');
  }
  return {
    serviceDate: serviceDate, postId: postId, slotIndex: slotIndex, kind: kind,
    key: serviceDate + '|' + postId + '|' + slotIndex,
    cellText: normalizeDecisionText_(it.cellText),
    ruleId: String(it.ruleId || '').trim(),
    checked: it.checked === true
  };
}

/**
 * 寫入一批決定。**會寫入**。勾 ⇒ ACTIVE（記低嗰陣格內嘅名）；取消 ⇒ CANCELLED（唔刪行）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} items 決定
 * @param {string} timezone 時區
 * @returns {number} 寫咗幾多項
 */
function upsertCellDecisions_(quarterId, items, timezone) {
  const sheet = ensureCellDecisionsSheet_();
  const D = COLUMNS.CELL_DECISIONS;
  const keys = cellDecisionKeys_();
  const col = function (k) { return keys.indexOf(k); };
  const lastRow = sheet.getLastRow();
  const body = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, keys.length).getValues() : [];
  const now = nowTimestamp_();
  let actor = '';
  try { actor = Session.getActiveUser().getEmail(); } catch (err) { actor = ''; }

  let written = 0;
  items.forEach(function (it) {
    let rowIndex = -1;
    for (let i = 0; i < body.length; i++) {
      const r = body[i];
      if (String(r[col(D.QUARTER_ID)] || '').trim() === quarterId
        && toDateString(r[col(D.SERVICE_DATE)], timezone) === it.serviceDate
        && String(r[col(D.POST_ID)] || '').trim() === it.postId
        && Number(r[col(D.SLOT_INDEX)]) === it.slotIndex
        && String(r[col(D.KIND)] || '').trim() === it.kind) { rowIndex = i; break; }
    }
    if (!it.checked && rowIndex === -1) return;   // 本來就冇 ⇒ 冇嘢要取消
    const record = rowIndex === -1 ? keys.map(function () { return ''; }) : body[rowIndex].slice();
    if (rowIndex === -1) {
      record[col(D.DECISION_ID)] = quarterId + '-' + it.key + '-' + it.kind;
      record[col(D.QUARTER_ID)] = quarterId;
      record[col(D.SERVICE_DATE)] = it.serviceDate;
      record[col(D.POST_ID)] = it.postId;
      record[col(D.SLOT_INDEX)] = it.slotIndex;
      record[col(D.KIND)] = it.kind;
    }
    if (it.checked) {
      record[col(D.CELL_TEXT)] = it.cellText;
      record[col(D.RULE_ID)] = it.ruleId;
      record[col(D.STATUS)] = CELL_DECISION_STATUS.ACTIVE;
    } else {
      record[col(D.STATUS)] = CELL_DECISION_STATUS.CANCELLED;
    }
    record[col(D.UPDATED_AT)] = now;
    record[col(D.UPDATED_BY)] = actor;
    if (rowIndex === -1) {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, keys.length).setValues([record]);
      body.push(record);
    } else {
      sheet.getRange(rowIndex + 3, 1, 1, keys.length).setValues([record]);
      body[rowIndex] = record;
    }
    written++;
  });
  return written;
}

/**
 * 供前端呼叫：勾選／取消一格或幾格嘅決定（每勾一格即時記住；〔全部勾選〕一次過送）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} items 每項 {serviceDate, postId, slotIndex, kind, cellText, ruleId, checked}
 * @returns {{ok: boolean, written: number}}
 */
function apiSetCellDecisions(quarterId, items) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('記住你的決定', function () {
    const q = String(quarterId || '').trim();
    if (!q) throw new Error('無法記錄這一項決定：沒有季度。請按「重新整理」再試。');
    const list = (Array.isArray(items) ? items : []).map(normalizeCellDecisionItem_);
    if (list.length === 0) return { ok: true, written: 0 };
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const written = upsertCellDecisions_(q, list, timezone);
    writeAuditLog_({
      action: 'CELL_DECISIONS_SET',
      targetSheet: SHEETS.CELL_DECISIONS,
      targetKey: q,
      newValue: list.map(function (it) {
        return it.key + ' ' + it.kind + (it.checked ? '＝勾' : '＝取消') + (it.cellText ? '（' + it.cellText + '）' : '');
      }).join('；'),
      source: 'apiSetCellDecisions',
      notes: '幹事逐格決定（保留我的安排／這一季臨時幫手）'
    });
    return { ok: true, written: written };
  });
}

/**
 * 第七十五輪批次 CP 組：重設季度測試資料時清走呢一季嘅全部決定（**真係刪行**——呢張表係系統自己嘅，
 * 唔係人員資料）。冇工作表 ⇒ 0。
 * @param {string} quarterId 季度 ID
 * @returns {number} 刪咗幾多行
 */
function clearCellDecisionsForQuarter_(quarterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.CELL_DECISIONS);
  if (!sheet) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const qCol = keys.indexOf(COLUMNS.CELL_DECISIONS.QUARTER_ID);
  if (qCol === -1) return 0;
  const values = sheet.getRange(3, 1, lastRow - 2, sheet.getLastColumn()).getValues();
  let removed = 0;
  // 由下而上刪，行號先唔會郁
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][qCol] || '').trim() === quarterId) {
      sheet.deleteRow(i + 3);
      removed++;
    }
  }
  return removed;
}

/**
 * 第七十五輪批次 CP 組：數一季有幾多行決定（重設確認清單用，純讀取）。
 * @param {string} quarterId 季度 ID
 * @returns {number}
 */
function countCellDecisionsForQuarter_(quarterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEETS.CELL_DECISIONS)) return 0;
  return readSheet(SHEETS.CELL_DECISIONS).filter(function (r) {
    return String(r[COLUMNS.CELL_DECISIONS.QUARTER_ID] || '').trim() === quarterId;
  }).length;
}
