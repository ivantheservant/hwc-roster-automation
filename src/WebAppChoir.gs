/**
 * 第九十輪批次 QB 組：詩班獻詩（開季前準備〔合堂主日〕旁邊的〔詩班獻詩〕）。
 *
 * 音樂部意見（Ivan 2026-10-30 決定）：詩班獻詩的主日，詩班員盡量不另派崗位；詩班名單用事奉人員表維護。
 *
 * ── 資料 ─────────────────────────────────────────────────────────
 *   ServiceDates.ChoirSinging＝TRUE（這個主日詩班獻詩）／空白。舊試算表沒有這一欄 ⇒ 第一次儲存時自動加。
 *   詩班名單＝Posts 中 PostID＝Config CHOIR_GROUP_POST_ID（預設 CHOIR，ShowInRoster=FALSE）那一行在
 *   「崗位名單」工作表的名單；可以寫名字，亦可以寫「堂委」「執事」（第八十五輪 LC 組的展開照用，按當日身分）。
 *
 * ── 規則 SEMI_CHOIR_SUNDAY（準硬規則，預設開啟）────────────────────
 * 詩班獻詩的主日，詩班名單上的人盡量不擔任任何職事表崗位：生成和〔請系統幫我調整〕避開，
 * 找不到其他人才排並提醒；人手填的格（例如詩班員做領詩）照樣提醒，可以勾「保留我的安排」。
 * 人手檢查不計（準硬規則）。整季重設（幹事介面）保留，選單版清空。週報系統讀取。
 */

/** 視窗上的一句說明。 */
const CHOIR_SINGING_NOTE_TC = '勾選詩班獻詩的主日。那幾個主日，詩班名單上的人盡量不擔任其他崗位'
  + '（系統排表會避開；找不到其他人才會排並提醒）。這個設定亦會傳給週報系統。';

/**
 * 確保 ServiceDates 有 ChoirSinging 欄（沒有就加在最後）。
 * @param {Object} sheet ServiceDates 工作表
 * @returns {number} 欄號（1 起計）
 */
function ensureServiceDatesChoirColumn_(sheet) {
  const D = COLUMNS.SERVICE_DATES;
  const read = function () {
    return sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  };
  let keys = read();
  if (keys.indexOf(D.CHOIR_SINGING) === -1) {
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue('詩班獻詩（TRUE＝是；空白＝不是）');
    sheet.getRange(2, col).setValue(D.CHOIR_SINGING);
    keys = read();
  }
  return keys.indexOf(D.CHOIR_SINGING) + 1;
}

/**
 * 供前端呼叫：〔詩班獻詩〕視窗的資料。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, quarterLabel: string, weeks: Object[], note: string, choirCount: ?number}}
 */
function apiGetChoirSinging(quarterId) {
  assertWebAppRequestAllowed_('apiGetChoirSinging');
  const id = String(quarterId || '').trim();
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  beginSheetReadMemo_();
  try {
    return {
      quarterId: id,
      quarterLabel: buildQuarterLabel_(id),
      weeks: readChoirSinging_(id, timezone),
      note: CHOIR_SINGING_NOTE_TC,
      choirCount: readChoirMemberCountSafe_()
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：儲存詩班獻詩。**會寫入**（只寫 ServiceDates 這一季的 ChoirSinging；每改一週寫 AuditLog）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} items [{serviceDate, singing}]
 * @returns {{ok: boolean, changed: number, message: string}}
 */
function apiSaveChoirSinging(quarterId, items) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('儲存詩班獻詩', function () {
    return saveChoirSinging_(String(quarterId || '').trim(), items || []);
  });
}

function saveChoirSinging_(quarterId, items) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const wanted = {};
  items.forEach(function (it) {
    wanted[String(it.serviceDate || '').trim()] = it.singing === true;
  });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SERVICE_DATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.SERVICE_DATES);
  const D = COLUMNS.SERVICE_DATES;
  const keysNow = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const anySet = Object.keys(wanted).some(function (d) { return wanted[d]; });
  // 一週都沒有勾、而且本來沒有這一欄 ⇒ 不用加欄
  if (!anySet && keysNow.indexOf(D.CHOIR_SINGING) === -1) return { ok: true, changed: 0, message: '沒有改動。' };
  const col = ensureServiceDatesChoirColumn_(sheet);
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const qCol = keys.indexOf(D.QUARTER_ID);
  const dCol = keys.indexOf(D.SERVICE_DATE);
  if (sheet.getLastRow() < 3) return { ok: true, changed: 0, message: '沒有改動。' };
  const values = sheet.getRange(3, 1, sheet.getLastRow() - 2, keys.length).getValues();
  let changed = 0;
  values.forEach(function (row, i) {
    if (String(row[qCol] || '').trim() !== quarterId) return;
    const d = toDateString_(row[dCol], timezone);
    if (!Object.prototype.hasOwnProperty.call(wanted, d)) return;
    const was = isTrueValue_(row[col - 1]);
    if (was === wanted[d]) return;
    sheet.getRange(i + 3, col).setValue(wanted[d] ? true : '');
    changed++;
    writeAuditLog_({
      action: 'CHOIR_SINGING_CHANGED',
      targetSheet: SHEETS.SERVICE_DATES,
      targetKey: quarterId + '|' + d,
      oldValue: was ? '詩班獻詩' : '（不是）',
      newValue: wanted[d] ? '詩班獻詩' : '（不是）',
      source: 'apiSaveChoirSinging',
      notes: '開季前準備〔詩班獻詩〕'
    });
  });
  return { ok: true, changed: changed, message: changed > 0 ? '已儲存 ' + changed + ' 週的詩班獻詩設定。' : '沒有改動。' };
}

