/**
 * 第一百零一輪批次 ZB-12：〔更新電郵範本到最新版〕（幹事介面「進階與診斷」）。
 *
 * 試算表上現有的 `EmailTemplates` 行不會自動跟 `EMAIL_TEMPLATE_SEEDS`（EmailTemplateSeed.gs）更新。
 * 這裏逐個範本列出「現時」與「最新版」的主旨、內文（HTML、純文字）及 Placeholders 差異，幹事勾選後：
 *   1. 先把那一行的舊內容整行備份到 `EmailTemplates_Backup`（加備份時間、備份的人）；
 *   2. 再覆寫 Subject、BodyHtml、BodyPlain、Placeholders、UpdatedAt（AttachType、Active 不改）。
 * 工作表沒有那一行 ⇒ 新增（和「補齊 Email 範本」同一支 seedEmailTemplates_()）。
 *
 * ⚠️ 套用時**重新比對一次**，不信任前端傳來的內容（和〔儲存並套用名單〕同一個理由）。
 */

/** 備份工作表名稱。 */
const EMAIL_TEMPLATES_BACKUP_SHEET = 'EmailTemplates_Backup';

/** 會比對及覆寫的欄（次序＝畫面顯示次序）。 */
const EMAIL_TEMPLATE_UPDATE_FIELDS = [
  { key: 'Subject', label: '主旨', seed: 'subject' },
  { key: 'BodyHtml', label: '內文（HTML）', seed: 'bodyHtml' },
  { key: 'BodyPlain', label: '內文（純文字）', seed: 'bodyPlain' },
  { key: 'Placeholders', label: '變數清單', seed: 'placeholders' }
];

/**
 * 比對（純讀取）。
 * @returns {{items: Object[], diffCount: number, missingCount: number}}
 *   items 每項 {templateId, status: 'DIFF'|'MISSING'|'SAME', rowNo, diffs: [{field, label, current, latest}]}
 */
function planEmailTemplateUpdate_() {
  const T = COLUMNS.EMAIL_TEMPLATES;
  // ⚠️ 直接讀工作表（不用 readSheet_()）：readSheet_() 略過空白行，行號會對不上，覆寫會寫錯行。
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EMAIL_TEMPLATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.EMAIL_TEMPLATES);
  const byId = {};
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow >= 3 && lastCol > 0) {
    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    sheet.getRange(3, 1, lastRow - 2, lastCol).getValues().forEach(function (values, i) {
      const row = {};
      headers.forEach(function (h, c) { if (h) row[h] = values[c]; });
      const id = String(row[T.TEMPLATE_ID] || '').trim();
      if (id && !byId[id]) byId[id] = { row: row, rowNo: i + 3 };
    });
  }
  const items = EMAIL_TEMPLATE_SEEDS.map(function (seed) {
    const hit = byId[seed.templateId];
    if (!hit) {
      return { templateId: seed.templateId, status: 'MISSING', rowNo: 0,
        diffs: EMAIL_TEMPLATE_UPDATE_FIELDS.map(function (f) {
          return { field: f.key, label: f.label, current: '', latest: String(seed[f.seed] || '') };
        }) };
    }
    const diffs = [];
    EMAIL_TEMPLATE_UPDATE_FIELDS.forEach(function (f) {
      const current = String(hit.row[f.key] === null || hit.row[f.key] === undefined ? '' : hit.row[f.key]);
      const latest = String(seed[f.seed] || '');
      if (current !== latest) diffs.push({ field: f.key, label: f.label, current: current, latest: latest });
    });
    return { templateId: seed.templateId, status: diffs.length > 0 ? 'DIFF' : 'SAME', rowNo: hit.rowNo, diffs: diffs };
  });
  return {
    items: items,
    diffCount: items.filter(function (x) { return x.status === 'DIFF'; }).length,
    missingCount: items.filter(function (x) { return x.status === 'MISSING'; }).length
  };
}

/**
 * 備份工作表（沒有就建立）。第 1 行中文、第 2 行機器鍵。
 * @returns {Sheet}
 */
function ensureEmailTemplatesBackupSheet_() {
  const T = COLUMNS.EMAIL_TEMPLATES;
  const keys = ['BackedUpAt', 'BackedUpBy'].concat(Object.keys(T).map(function (k) { return T[k]; }));
  const headers = ['備份時間', '備份的人'].concat(Object.keys(T).map(function (k) { return T[k]; }));
  ensureSimpleSheet_(EMAIL_TEMPLATES_BACKUP_SHEET, headers, keys);
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMAIL_TEMPLATES_BACKUP_SHEET);
}

/**
 * 套用（勾選了的範本）。先備份、再覆寫。
 * @param {string[]} selectedIds 要更新的 TemplateID
 * @returns {{updated: string[], added: string[], backedUp: number, message: string}}
 */
function applyEmailTemplateUpdate_(selectedIds) {
  const wanted = {};
  (Array.isArray(selectedIds) ? selectedIds : []).forEach(function (id) { wanted[String(id || '').trim()] = true; });
  const plan = planEmailTemplateUpdate_();
  const pick = plan.items.filter(function (x) { return wanted[x.templateId] && x.status !== 'SAME'; });
  if (pick.length === 0) {
    return { updated: [], added: [], backedUp: 0, message: '沒有選擇任何有差異的範本，一個都沒有改。' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.EMAIL_TEMPLATES);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.EMAIL_TEMPLATES);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const T = COLUMNS.EMAIL_TEMPLATES;
  const now = nowTimestamp_();
  let who = '';
  try { who = String(Session.getActiveUser().getEmail() || ''); } catch (err) { who = ''; }

  const diffItems = pick.filter(function (x) { return x.status === 'DIFF'; });
  let backedUp = 0;
  if (diffItems.length > 0) {
    // ① 先備份（整行舊內容）。備份寫不到 ⇒ 拋錯，一個都不覆寫。
    const backup = ensureEmailTemplatesBackupSheet_();
    const bKeys = backup.getRange(2, 1, 1, backup.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
    const bRows = diffItems.map(function (x) {
      const old = sheet.getRange(x.rowNo, 1, 1, headers.length).getValues()[0];
      const rec = { BackedUpAt: now, BackedUpBy: who };
      headers.forEach(function (h, i) { if (h) rec[h] = old[i]; });
      return bKeys.map(function (k) { return rec[k] === undefined ? '' : rec[k]; });
    });
    backup.getRange(backup.getLastRow() + 1, 1, bRows.length, bKeys.length).setValues(bRows);
    backedUp = bRows.length;
  }
  // ② 覆寫
  const seedById = {};
  EMAIL_TEMPLATE_SEEDS.forEach(function (s) { seedById[s.templateId] = s; });
  diffItems.forEach(function (x) {
    const seed = seedById[x.templateId];
    EMAIL_TEMPLATE_UPDATE_FIELDS.concat([{ key: T.UPDATED_AT }]).forEach(function (f) {
      const col = headers.indexOf(f.key) + 1;
      if (col <= 0) return;
      sheet.getRange(x.rowNo, col).setValue(f.key === T.UPDATED_AT ? now : String(seed[f.seed] || ''));
    });
  });
  const missing = pick.filter(function (x) { return x.status === 'MISSING'; }).map(function (x) { return seedById[x.templateId]; });
  if (missing.length > 0) seedEmailTemplates_(missing);

  const updated = diffItems.map(function (x) { return x.templateId; });
  const added = missing.map(function (s) { return s.templateId; });
  writeAuditLog_({
    action: 'EMAIL_TEMPLATES_UPDATED', targetSheet: SHEETS.EMAIL_TEMPLATES, targetKey: updated.concat(added).join(','),
    newValue: '更新 ' + updated.length + ' 個、新增 ' + added.length + ' 個', source: 'apiApplyEmailTemplateUpdate',
    notes: '舊內容已備份到 ' + EMAIL_TEMPLATES_BACKUP_SHEET + '（' + backedUp + ' 行）'
  });
  return {
    updated: updated, added: added, backedUp: backedUp,
    message: '已更新 ' + updated.length + ' 個範本' + (added.length ? '、新增 ' + added.length + ' 個' : '')
      + '。舊內容已備份到「' + EMAIL_TEMPLATES_BACKUP_SHEET + '」（' + backedUp + ' 行）。'
  };
}

/**
 * 供前端呼叫：比對（唯讀）。
 * @returns {Object}
 */
function apiPlanEmailTemplateUpdate() {
  assertWebAppRequestAllowed_('apiPlanEmailTemplateUpdate');
  return planEmailTemplateUpdate_();
}

/**
 * 供前端呼叫：套用（改動；只限可以修改的人）。
 * @param {string[]} selectedIds
 * @returns {Object}
 */
function apiApplyEmailTemplateUpdate(selectedIds) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('更新電郵範本到最新版', function () {
    return applyEmailTemplateUpdate_(selectedIds);
  });
}
