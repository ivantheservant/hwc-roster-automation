/**
 * 第九十七輪批次 XA 組：開季前準備〔補填電郵〕——幹事補填電郵（不寫回出席系統）。
 *
 * ── 為甚麼要另一欄 ────────────────────────────────────────────────
 * 出席系統同步（`syncPeopleFromHwcasByMemberNo_()`）對已連結的人**一定**用出席系統的電郵覆寫
 * `NameMapping.Email`（出席系統沒有電郵就清空），所以幹事不可以直接改 `Email` 欄——改了下一次同步就會被洗走。
 * 這裏填的寫入 `ManualEmail`；出席系統同步、連結、套用永遠不讀不寫這一欄。
 *
 * ── 實際電郵 ──────────────────────────────────────────────────────
 * `Email` 有值就用 `Email`，否則用 `ManualEmail`（`effectivePersonEmail_()`，SheetReader.gs）。
 * 所以出席系統之後有了電郵，會自動改用出席系統的；`ManualEmail` 留着不刪（畫面寫明現時用出席系統的）。
 *
 * ── 列出誰 ────────────────────────────────────────────────────────
 * 這一季可能用到但沒有實際電郵的人：申報邀請的對象＋最新版本表上的人＋現任堂委、執事（去重）。
 * 已有 `ManualEmail` 的人另列一組「已補填」，可以修改或清除。
 *
 * ── 紀錄 ──────────────────────────────────────────────────────────
 * 每改一位寫一行 AuditLog（`MANUAL_EMAIL_SET`），電郵遮蔽（`maskEmailForPreview_()`）。
 */

const MANUAL_EMAIL_AUDIT_ACTION = 'MANUAL_EMAIL_SET';

/** 畫面上的說明句（前端同一句）。 */
const MANUAL_EMAIL_EXPLANATION = '這裏填的電郵只供職事表寄信用，不會寫入出席系統。出席系統之後有了電郵，會改用出席系統的。';

/** 「已補填」組裏，出席系統已經有電郵的那一行要寫的一句。 */
const MANUAL_EMAIL_SUPERSEDED_NOTE = '出席系統已有電郵，現時用出席系統的';

/**
 * 第一百零五輪批次 RA 組：「指定寄信電郵（優先）」——例如堂委、執事的教會電郵。有值就優先用來寄信
 * （其次出席系統，最後補填的）。寫入 `NameMapping.PreferredEmail`；出席系統同步永遠不讀不寫這一欄。
 */
const PREFERRED_EMAIL_AUDIT_ACTION = 'PREFERRED_EMAIL_SET';
const PREFERRED_EMAIL_EXPLANATION = '指定寄信電郵（優先）：設定了就一定用這個地址寄信（例如堂委、執事的教會電郵），'
  + '不理出席系統或補填的電郵；清除之後回復用出席系統的。不會寫入出席系統。';
/** 「已補填」組裏，用了指定寄信電郵的那一行要寫的一句。 */
const MANUAL_EMAIL_PREFERRED_NOTE = '已設定指定寄信電郵，現時用指定的';

/**
 * `NameMapping` 沒有 `PreferredEmail` 欄就在最右邊補一欄（同 `ensureNameMappingManualEmailColumn_()`）。
 * @returns {number} 欄號（1-based）
 */
function ensureNameMappingPreferredEmailColumn_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.NAME_MAPPING.PREFERRED_EMAIL);
  if (existingIndex !== -1) return existingIndex + 1;
  const columnIndex = lastCol + 1;
  sheet.getRange(1, columnIndex).setValue('指定寄信電郵（優先，只供職事表寄信用）');
  sheet.getRange(2, columnIndex).setValue(COLUMNS.NAME_MAPPING.PREFERRED_EMAIL);
  return columnIndex;
}

/**
 * `NameMapping` 沒有 `ManualEmail` 欄就在最右邊補一欄（照 `ensureNameMappingPersonalLinkTokenColumn_()` 的做法）。
 * @returns {number} 欄號（1-based）
 */
function ensureNameMappingManualEmailColumn_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.NAME_MAPPING.MANUAL_EMAIL);
  if (existingIndex !== -1) return existingIndex + 1;
  const columnIndex = lastCol + 1;
  sheet.getRange(1, columnIndex).setValue('幹事補填的電郵（只供職事表寄信用）');
  sheet.getRange(2, columnIndex).setValue(COLUMNS.NAME_MAPPING.MANUAL_EMAIL);
  return columnIndex;
}

/**
 * 〔補填電郵〕要列出的人（這一季可能用到的人）。**只讀。**
 * @param {string} quarterId 季度 ID
 * @param {string} todayStr 今日
 * @returns {Object.<string, string[]>} PersonID → 為甚麼在名單上（「申報邀請」「職事表」「堂委」「執事」）
 */
function listManualEmailCandidates_(quarterId, todayStr) {
  const out = {};
  const add = function (id, why) {
    const key = String(id || '').trim();
    if (!key) return;
    if (!out[key]) out[key] = [];
    if (out[key].indexOf(why) === -1) out[key].push(why);
  };
  Object.keys(listUnavailableInviteCandidateIds_(todayStr)).forEach(function (id) { add(id, '申報邀請'); });
  const versionNo = findLatestVersionNo_(quarterId);
  if (versionNo >= 0) {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    readSheet_(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId || Number(row[A.VERSION_NO]) !== versionNo) return;
      add(row[A.PERSON_ID], '職事表');
    });
  }
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const roles = readRolesSafe_(timezone);
  [ROLE_CODES.COMMITTEE, ROLE_CODES.DEACON].forEach(function (code) {
    roleHoldersOn_(roles, code, todayStr).forEach(function (id) { add(id, ROLE_LABELS_TC[code] || code); });
  });
  return out;
}

/**
 * 每人的崗位摘要：最新版本表上的崗位（及格數）；表上沒有就寫名單上的崗位。
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, string>} PersonID → 摘要
 */
function buildManualEmailPostSummaries_(quarterId) {
  const names = readPostNameIndexAll_();
  const fromRoster = {};
  const versionNo = findLatestVersionNo_(quarterId);
  if (versionNo >= 0) {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    readSheet_(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId || Number(row[A.VERSION_NO]) !== versionNo) return;
      const id = String(row[A.PERSON_ID] || '').trim();
      if (!id) return;
      if (!fromRoster[id]) fromRoster[id] = {};
      const name = names[row[A.POST_ID]] || row[A.POST_ID];
      fromRoster[id][name] = (fromRoster[id][name] || 0) + 1;
    });
  }
  const fromList = {};
  const byPost = readEligibility_().byPost || {};
  Object.keys(byPost).forEach(function (postId) {
    (byPost[postId] || []).forEach(function (id) {
      if (!fromList[id]) fromList[id] = [];
      const name = names[postId] || postId;
      if (fromList[id].indexOf(name) === -1) fromList[id].push(name);
    });
  });
  const out = {};
  Object.keys(fromRoster).forEach(function (id) {
    out[id] = Object.keys(fromRoster[id]).map(function (n) { return n + ' ' + fromRoster[id][n] + ' 次'; }).join('、');
  });
  Object.keys(fromList).forEach(function (id) {
    if (!out[id]) out[id] = fromList[id].join('、') + '（名單）';
  });
  return out;
}

/**
 * 供前端呼叫：〔補填電郵〕畫面。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, quarterLabel: string, explanation: string, missing: Object[], filled: Object[]}}
 *   missing：這一季可能用到、沒有實際電郵的人 {personId, nameTC, posts, why}
 *   filled：已有 ManualEmail 的人 {personId, nameTC, manualEmail, posts, superseded, note}
 *   preferred：第一百零五輪批次 RA 組——已設定指定寄信電郵的人 {personId, nameTC, preferredEmail, posts}
 *   people：可以設定指定寄信電郵的人（這一季可能用到的人＋已設定的人）{personId, nameTC}
 */
function apiGetManualEmailView(quarterId) {
  assertWebAppRequestAllowed_('apiGetManualEmailView');
  const id = String(quarterId || '').trim();
  beginSheetReadMemo_();
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const candidates = listManualEmailCandidates_(id, today);
    const posts = buildManualEmailPostSummaries_(id);
    const M = COLUMNS.NAME_MAPPING;
    const missing = [];
    const filled = [];
    const preferredList = [];
    const people = [];
    readPeople_().forEach(function (row) {
      const personId = String(row[M.PERSON_ID] || '').trim();
      if (!personId) return;
      const nameTC = String(row[M.NAME_TC] || '').trim() || personId;
      const preferred = preferredPersonEmail_(row);
      if (preferred) {
        preferredList.push({ personId: personId, nameTC: nameTC, preferredEmail: preferred, posts: posts[personId] || '' });
      }
      if (preferred || candidates[personId]) people.push({ personId: personId, nameTC: nameTC });
      const manual = String(row[M.MANUAL_EMAIL] === null || row[M.MANUAL_EMAIL] === undefined ? '' : row[M.MANUAL_EMAIL]).trim();
      if (manual) {
        const superseded = effectivePersonEmail_(row) !== manual;
        filled.push({ personId: personId, nameTC: nameTC, manualEmail: manual, posts: posts[personId] || '',
          superseded: superseded,
          note: superseded ? (preferred ? MANUAL_EMAIL_PREFERRED_NOTE : MANUAL_EMAIL_SUPERSEDED_NOTE) : '' });
        return;
      }
      if (!candidates[personId] || effectivePersonEmail_(row)) return;
      missing.push({ personId: personId, nameTC: nameTC, posts: posts[personId] || '', why: candidates[personId].join('、') });
    });
    const byName = function (a, b) { return a.nameTC < b.nameTC ? -1 : (a.nameTC > b.nameTC ? 1 : 0); };
    return { quarterId: id, quarterLabel: buildQuarterLabel_(id), explanation: MANUAL_EMAIL_EXPLANATION,
      missing: missing.sort(byName), filled: filled.sort(byName),
      preferredExplanation: PREFERRED_EMAIL_EXPLANATION, preferred: preferredList.sort(byName), people: people.sort(byName) };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：〔儲存〕補填的電郵。**會寫入 NameMapping（只寫 ManualEmail 欄）＋AuditLog。**
 * @param {string} quarterId 季度 ID（只用來刷新畫面）
 * @param {Object[]} entries 每項 {personId, email, kind}；email 空白＝清除；
 *   kind：第一百零五輪批次 RA 組——'PREFERRED'＝指定寄信電郵（PreferredEmail），其他／不填＝補填（ManualEmail）
 * @returns {{ok: boolean, saved: number, cleared: number, message: string, view: Object}}
 */
function apiSaveManualEmails(quarterId, entries) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('補填電郵', function () {
    return saveManualEmails_locked_(quarterId, entries);
  });
}

function saveManualEmails_locked_(quarterId, entries) {
  const list = (Array.isArray(entries) ? entries : []).map(function (e) {
    return { personId: String((e && e.personId) || '').trim(), email: String((e && e.email) || '').trim(),
      preferred: String((e && e.kind) || '').toUpperCase() === 'PREFERRED' };
  }).filter(function (e) { return e.personId; });
  if (list.length === 0) {
    return { ok: false, saved: 0, cleared: 0, message: buildThreePartMessage_('沒有任何改動。', '甚麼都沒有寫入。',
      ['在名單上填電郵（或清除已補填的），再按〔儲存〕']) };
  }
  const bad = list.filter(function (e) { return e.email && !isPlausibleEmail_(e.email); });
  if (bad.length > 0) {
    return { ok: false, saved: 0, cleared: 0, message: buildThreePartMessage_(
      '有 ' + bad.length + ' 個電郵看起來不正確：' + bad.map(function (e) { return e.email; }).join('、'),
      '甚麼都沒有寫入。', ['改正或清空那一格，再按〔儲存〕']) };
  }
  const M = COLUMNS.NAME_MAPPING;
  ensureNameMappingManualEmailColumn_();
  if (list.some(function (e) { return e.preferred; })) ensureNameMappingPreferredEmailColumn_();
  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  let saved = 0;
  let cleared = 0;
  const notFound = [];
  list.forEach(function (e) {
    const found = findRowById_(SHEETS.NAME_MAPPING, M.PERSON_ID, e.personId);
    if (found.sheetRow === -1) { notFound.push(e.personId); return; }
    // 第一百零五輪批次 RA 組：kind=PREFERRED ⇒ 寫 PreferredEmail（指定寄信電郵），否則照舊寫 ManualEmail
    const column = e.preferred ? M.PREFERRED_EMAIL : M.MANUAL_EMAIL;
    const old = String(found.record[column] === null || found.record[column] === undefined
      ? '' : found.record[column]).trim();
    if (old === e.email) return;
    const updates = {};
    updates[column] = e.email;
    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
    if (e.email) saved++; else cleared++;
    writeZone3Audit_({
      action: e.preferred ? PREFERRED_EMAIL_AUDIT_ACTION : MANUAL_EMAIL_AUDIT_ACTION,
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: e.personId,
      oldValue: column + '=' + (maskEmailForPreview_(old) || '（空白）'),
      newValue: column + '=' + (maskEmailForPreview_(e.email) || '（空白）'),
      notes: e.preferred ? '〔補填電郵〕指定寄信電郵（優先；不寫入出席系統）' : '〔補填電郵〕（只供職事表寄信用，不寫入出席系統）'
    });
  });
  // 第九十六輪批次 WA 組：「沒有電郵」人數改了 ⇒ 狀態卡人數的快取要清除（簽名亦會變）
  clearDashboardCountsCache_(String(quarterId || '').trim());
  const parts = [];
  if (saved) parts.push('補填了 ' + saved + ' 位');
  if (cleared) parts.push('清除了 ' + cleared + ' 位');
  return {
    ok: true, saved: saved, cleared: cleared, notFound: notFound,
    message: (parts.length ? parts.join('，') : '沒有改動') + '。'
      + (notFound.length ? '名單上找不到 ' + notFound.join('、') + '。' : ''),
    view: apiGetManualEmailView(quarterId)
  };
}
