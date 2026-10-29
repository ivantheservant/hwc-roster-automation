/**
 * 第八十五輪批次 LE 組：合堂主日（開季前準備〔不能服侍的日期〕〔排表偏好〕旁邊的〔合堂主日〕）。
 *
 * Ivan：「user 要可以定義哪個崇拜是合堂，選擇種類：浸禮、堂慶、合堂（可以自行輸入，例如宣教月）。
 * 這個不一定在職事表上顯示，但要傳給週報系統。」
 *
 * ── 資料 ─────────────────────────────────────────────────────────
 *   ServiceDates.CombinedKind＝代號（Config COMBINED_SERVICE_KINDS，預設 COMBINED／BAPTISM／ANNIVERSARY）
 *   ServiceDates.CombinedName＝名稱（自行輸入，可以留空；選了種類才可以填）
 *   兩欄空白＝不是合堂。舊試算表沒有這兩欄 ⇒ 第一次儲存時自動加（和每週標題同一做法）。
 *
 * ── 不改動職事表 ─────────────────────────────────────────────────
 * 不清空任何崗位、不改每週標題、不影響生成和規則；整季重設保留（LB）；季前資料列出（LF）。
 */

/** 預設種類（Config 留空或格式不對時用）。 */
const COMBINED_SERVICE_KINDS_DEFAULT = 'COMBINED=合堂,BAPTISM=浸禮,ANNIVERSARY=堂慶';

/** 視窗上的一句說明。 */
const COMBINED_SERVICE_NOTE_TC = '這個設定會傳給週報系統，不會改動職事表；合堂時不需要的崗位，請在職事表自行清空。';

/**
 * 解析種類設定「代號=名稱,代號=名稱」。**純函式。**格式不對的項目略過；一項都沒有 ⇒ 預設。
 * @param {string} raw Config 值
 * @returns {Object[]} [{code, label}]
 */
function parseCombinedServiceKinds_(raw) {
  const parse = function (text) {
    return String(text || '').split(/[,，]/).map(function (part) {
      const m = /^\s*([A-Za-z0-9_]+)\s*[=＝]\s*(.+?)\s*$/.exec(part);
      return m ? { code: m[1].toUpperCase(), label: m[2] } : null;
    }).filter(function (k) { return !!k; });
  };
  const list = parse(raw);
  return list.length > 0 ? list : parse(COMBINED_SERVICE_KINDS_DEFAULT);
}

/**
 * Config 的種類清單。
 * @returns {Object[]} [{code, label}]
 */
function readCombinedServiceKinds_() {
  return parseCombinedServiceKinds_(getConfig(CONFIG_KEYS.COMBINED_SERVICE_KINDS, COMBINED_SERVICE_KINDS_DEFAULT));
}

/**
 * 這一季每個主日的合堂設定（週報系統、季前資料、整季重設計數都用這一支）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object[]} [{serviceDate, kind, kindLabel, name}]（按日期；沒有設定的主日 kind＝''）
 */
function readCombinedServices_(quarterId, timezone) {
  const kinds = readCombinedServiceKinds_();
  const labelOf = {};
  kinds.forEach(function (k) { labelOf[k.code] = k.label; });
  const D = COLUMNS.SERVICE_DATES;
  return readSheet(SHEETS.SERVICE_DATES)
    .filter(function (r) { return String(r[D.QUARTER_ID] || '').trim() === quarterId; })
    .map(function (r) {
      const kind = String(r[D.COMBINED_KIND] === undefined || r[D.COMBINED_KIND] === null ? '' : r[D.COMBINED_KIND]).trim().toUpperCase();
      return {
        serviceDate: toDateString(r[D.SERVICE_DATE], timezone),
        kind: kind,
        kindLabel: kind ? (labelOf[kind] || kind) : '',
        name: kind ? String(r[D.COMBINED_NAME] === undefined || r[D.COMBINED_NAME] === null ? '' : r[D.COMBINED_NAME]).trim() : ''
      };
    })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); });
}

/**
 * 顯示用：「浸禮」「合堂：Mission Month」。
 * @param {Object} c readCombinedServices_() 的一項
 * @returns {string}
 */
function describeCombinedService_(c) {
  if (!c || !c.kind) return '';
  return c.kindLabel + (c.name ? '：' + c.name : '');
}

/**
 * 確保 ServiceDates 有 CombinedKind、CombinedName 兩欄（沒有就加在最後）。
 * @param {Object} sheet ServiceDates 工作表
 * @returns {{kindCol: number, nameCol: number}} 欄號（1 起計）
 */
function ensureServiceDatesCombinedColumns_(sheet) {
  const D = COLUMNS.SERVICE_DATES;
  const read = function () {
    return sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  };
  let keys = read();
  if (keys.indexOf(D.COMBINED_KIND) === -1) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('合堂種類（空白＝不是合堂）');
    sheet.getRange(2, col).setValue(D.COMBINED_KIND);
    keys = read();
  }
  if (keys.indexOf(D.COMBINED_NAME) === -1) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('合堂名稱（例如宣教月，可以留空）');
    sheet.getRange(2, col).setValue(D.COMBINED_NAME);
    keys = read();
  }
  return { kindCol: keys.indexOf(D.COMBINED_KIND) + 1, nameCol: keys.indexOf(D.COMBINED_NAME) + 1 };
}

/**
 * 供前端呼叫：〔合堂主日〕視窗的資料。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, quarterLabel: string, kinds: Object[], weeks: Object[], note: string}}
 */
function apiGetCombinedServices(quarterId) {
  assertWebAppRequestAllowed_();
  const id = String(quarterId || '').trim();
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  beginSheetReadMemo_();
  try {
    return {
      quarterId: id,
      quarterLabel: buildQuarterLabel_(id),
      kinds: readCombinedServiceKinds_(),
      weeks: readCombinedServices_(id, timezone),
      note: COMBINED_SERVICE_NOTE_TC
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：儲存合堂設定。**會寫入**（只寫 ServiceDates 這一季的 CombinedKind／CombinedName；每改一週寫 AuditLog）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} items [{serviceDate, kind, name}]（kind＝'' 代表不是合堂）
 * @returns {{ok: boolean, changed: number, message: string}}
 */
function apiSaveCombinedServices(quarterId, items) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('儲存合堂主日', function () {
    return saveCombinedServices_(String(quarterId || '').trim(), items || []);
  });
}

function saveCombinedServices_(quarterId, items) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const kinds = readCombinedServiceKinds_();
  const valid = {};
  kinds.forEach(function (k) { valid[k.code] = k.label; });
  const wanted = {};
  items.forEach(function (it) {
    const kind = String(it.kind || '').trim().toUpperCase();
    if (kind && !valid[kind]) {
      throw new Error(buildThreePartMessage_('「' + kind + '」不是可以選的合堂種類。', '甚麼都沒有儲存。',
        ['重新開啟〔合堂主日〕再選一次', '要加種類，在 Config 的 ' + CONFIG_KEYS.COMBINED_SERVICE_KINDS + ' 加']));
    }
    wanted[String(it.serviceDate || '').trim()] = { kind: kind, name: kind ? String(it['name'] || '').trim() : '' };
  });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERVICE_DATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SERVICE_DATES);
  const D = COLUMNS.SERVICE_DATES;
  const keysNow = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const anySet = Object.keys(wanted).some(function (d) { return wanted[d].kind; });
  // 一格都不是合堂、而且本來沒有這兩欄 ⇒ 不用加欄
  if (!anySet && keysNow.indexOf(D.COMBINED_KIND) === -1) return { ok: true, changed: 0, message: '沒有改動。' };
  const cols = ensureServiceDatesCombinedColumns_(sheet);
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const qCol = keys.indexOf(D.QUARTER_ID);
  const dCol = keys.indexOf(D.SERVICE_DATE);
  if (sheet.getLastRow() < 3) return { ok: true, changed: 0, message: '沒有改動。' };
  const values = sheet.getRange(3, 1, sheet.getLastRow() - 2, keys.length).getValues();
  let changed = 0;
  values.forEach(function (row, i) {
    if (String(row[qCol] || '').trim() !== quarterId) return;
    const d = toDateString(row[dCol], timezone);
    const w = wanted[d];
    if (!w) return;
    const oldKind = String(row[cols.kindCol - 1] || '').trim().toUpperCase();
    const oldName = String(row[cols.nameCol - 1] || '').trim();
    if (oldKind === w.kind && (oldKind ? oldName : '') === w.name) return;
    sheet.getRange(i + 3, cols.kindCol).setValue(w.kind);
    sheet.getRange(i + 3, cols.nameCol).setValue(w.name);
    changed++;
    writeAuditLog_({
      action: 'COMBINED_SERVICE_CHANGED',
      targetSheet: SHEETS.SERVICE_DATES,
      targetKey: quarterId + '|' + d,
      oldValue: oldKind ? (valid[oldKind] || oldKind) + (oldName ? '：' + oldName : '') : '（不是合堂）',
      newValue: w.kind ? valid[w.kind] + (w.name ? '：' + w.name : '') : '（不是合堂）',
      source: 'apiSaveCombinedServices',
      notes: '開季前準備〔合堂主日〕（只給週報系統讀，不改職事表）'
    });
  });
  return { ok: true, changed: changed, message: changed > 0 ? '已儲存 ' + changed + ' 週的合堂設定。' : '沒有改動。' };
}
