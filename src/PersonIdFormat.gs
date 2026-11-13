/**
 * 第一百零五輪批次 RH 組：PersonID 統一為「P＋四位數字」（例如 P0090）。
 *
 * ── 問題 ──────────────────────────────────────────────────────────────
 * 舊的 PersonID 是 `P0001`…`P0089`（四位數字）。〔加入名單〕（`allocatePersonId_()`，WebAppPeople.gs）
 * 用 `'P' + 數字` 編號，沒有補零 ⇒ 新人變成 `P90`、`P91`。試算表按 ID 排序、幹事肉眼對 ID 都會亂。
 *
 * ── 改法 ──────────────────────────────────────────────────────────────
 * 1. 新編號一律 `formatPersonIdNumber_()`：P＋至少四位數字（P0090；超過 9999 就照數字寫）。
 * 2. 已存在的短 ID（`P` 後面一至三位數字）：一次性、可重複執行的修正，放在〔補建設定及範本〕
 *    （部署之後本來就要按一次）：
 *    - 對象：`NameMapping` 的 PersonID，以及**所有**工作表第 2 行欄名含「PersonID」的欄
 *      （Eligibility、Unavailable、Roles、PersonPostWeight、PersonPostExclusions、PreAssignments、
 *      UnavailableSubmissions、NameAlias、PostTeams、WorshipBackingSingers……；逗號分隔的清單亦會逐個換）。
 *    - **歷史紀錄不改**：`RosterAssignments`、`SendLog`、`AuditLog` 及封存表。某個短 ID 已經在歷史紀錄出現
 *      ⇒ 那一個 ID 整個不改（不然舊版本會對不到人），列出原因，交幹事決定。
 *    - 新 ID 已經被另一個人用了 ⇒ 不改，列出。
 *    - 每改一格寫 AuditLog（`PERSON_ID_NORMALIZED`）。再執行一次 ⇒ 沒有東西要改。
 */

/** 不改的工作表（歷史紀錄）。 */
const PERSON_ID_HISTORY_SHEETS = [SHEETS.ROSTER_ASSIGNMENTS, SHEETS.SEND_LOG, SHEETS.AUDIT_LOG,
  SHEETS.SEND_LOG_ARCHIVE, SHEETS.ROSTER_ASSIGNMENTS_ARCHIVE];

/** 短 ID：P＋一至三位數字。 */
const PERSON_ID_SHORT_RE = /^P(\d{1,3})$/;

/**
 * P＋至少四位數字。
 * @param {number} n
 * @returns {string}
 */
function formatPersonIdNumber_(n) {
  const s = String(Math.floor(Number(n)));
  return 'P' + (s.length >= 4 ? s : ('0000' + s).slice(-4));
}

/**
 * 一格的值換 ID（單一值或逗號分隔的清單）。沒有改 ⇒ 原值。
 * @param {*} value
 * @param {string} fromId
 * @param {string} toId
 * @returns {*}
 */
function replacePersonIdInCell_(value, fromId, toId) {
  const s = String(value === null || value === undefined ? '' : value);
  if (s.trim() === fromId) return toId;
  if (s.indexOf(',') === -1 && s.indexOf('，') === -1) return value;
  const parts = s.split(/([,，])/);
  let changed = false;
  const out = parts.map(function (p) {
    if (p === ',' || p === '，') return p;
    if (p.trim() === fromId) { changed = true; return p.replace(fromId, toId); }
    return p;
  });
  return changed ? out.join('') : value;
}

/**
 * 計劃（**只讀**）：要改哪些 ID、哪幾格；哪些不改及原因。
 * @returns {{renames: Object[], skipped: Object[]}}
 *   renames：{fromId, toId, nameTC, cells: [{sheet, row, col, header}]}
 *   skipped：{fromId, toId, nameTC, reason}
 */
function planPersonIdNormalize_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const M = COLUMNS.NAME_MAPPING;
  const people = readSheet_(SHEETS.NAME_MAPPING);
  const existing = {};
  people.forEach(function (r) { existing[String(r[M.PERSON_ID] || '').trim()] = true; });
  const shorts = [];
  people.forEach(function (r) {
    const id = String(r[M.PERSON_ID] || '').trim();
    const m = PERSON_ID_SHORT_RE.exec(id);
    if (m) shorts.push({ fromId: id, toId: formatPersonIdNumber_(Number(m[1])), nameTC: String(r[M.NAME_TC] || '').trim() });
  });
  if (shorts.length === 0) return { renames: [], skipped: [] };

  const byFrom = {};
  shorts.forEach(function (s) { byFrom[s.fromId] = { cells: [], history: [] }; });
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 3 || lastCol < 1) return;
    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    const cols = [];
    headers.forEach(function (h, i) { if (/PersonID/i.test(String(h || ''))) cols.push(i); });
    if (cols.length === 0) return;
    const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
    const isHistory = PERSON_ID_HISTORY_SHEETS.indexOf(name) !== -1;
    values.forEach(function (row, ri) {
      cols.forEach(function (ci) {
        shorts.forEach(function (s) {
          if (replacePersonIdInCell_(row[ci], s.fromId, s.toId) === row[ci]) return;
          const cell = { sheet: name, row: ri + 3, col: ci + 1, header: String(headers[ci]) };
          (isHistory ? byFrom[s.fromId].history : byFrom[s.fromId].cells).push(cell);
        });
      });
    });
  });

  const renames = [];
  const skipped = [];
  shorts.forEach(function (s) {
    const f = byFrom[s.fromId];
    if (existing[s.toId]) {
      skipped.push({ fromId: s.fromId, toId: s.toId, nameTC: s.nameTC, reason: s.toId + ' 已經被另一個人用了' });
    } else if (f.history.length > 0) {
      skipped.push({ fromId: s.fromId, toId: s.toId, nameTC: s.nameTC,
        reason: '已經在歷史紀錄出現（' + f.history.map(function (c) { return c.sheet; })
          .filter(function (n, i, a) { return a.indexOf(n) === i; }).join('、') + '），改了會令舊紀錄對不到人' });
    } else {
      renames.push({ fromId: s.fromId, toId: s.toId, nameTC: s.nameTC, cells: f.cells });
    }
  });
  return { renames: renames, skipped: skipped };
}

/**
 * 執行（**會寫入**）。呼叫者要已經拿着鎖。
 * @param {{renames: Object[]}} plan `planPersonIdNormalize_()` 的結果
 * @returns {number} 改了幾多格
 */
function applyPersonIdNormalize_(plan) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let n = 0;
  (plan.renames || []).forEach(function (r) {
    r.cells.forEach(function (c) {
      const range = ss.getSheetByName(c.sheet).getRange(c.row, c.col);
      const before = range.getValue();
      const after = replacePersonIdInCell_(before, r.fromId, r.toId);
      if (after === before) return;
      range.setValue(after);
      n++;
      writeAuditLog_({ action: 'PERSON_ID_NORMALIZED', targetSheet: c.sheet, targetKey: r.fromId + '→' + r.toId,
        oldValue: String(before), newValue: String(after), source: 'applyPersonIdNormalize_',
        notes: c.sheet + ' 第 ' + c.row + ' 行「' + c.header + '」欄：PersonID 統一為四位數字' });
    });
  });
  return n;
}
