/**
 * 把 NameMapping_Draft 的核對結果寫入 NameMapping。
 *
 * 只處理配對結果為 EXACT 或 ALIAS、且 HWCAS 電郵非空白的行；
 * 只覆寫 Email、MemberNo、EmailSource、EmailVerifiedAt、LastAttendance、
 * MeetingPoint、SyncedAt、Congregation、MemberType 這幾欄，其餘欄位一概不動。
 *
 * @param {{overwriteExisting: boolean}} options 已有電郵的行是否覆蓋
 * @returns {{written: number, skipped: number, skippedReasons: Object,
 *   pendingEmail: Object[], updatedPeople: Object[]}} 執行結果
 */
function applyHwcasDraft(options) {
  const plan = planHwcasApply();
  const overwrite = !!(options && options.overwriteExisting);
  const targets = overwrite ? plan.applicable : plan.newOnly;

  // 選擇不覆蓋時，電郵不一致的行也算作略過，要一併列入原因分類
  const skippedReasons = {};
  Object.keys(plan.skippedReasons).forEach(function (key) {
    skippedReasons[key] = plan.skippedReasons[key];
  });
  if (!overwrite && plan.conflicts.length > 0) {
    skippedReasons['已有電郵且與 HWCAS 不同，選擇了不覆蓋'] = plan.conflicts.length;
  }
  const skipped = plan.skipped.length + (overwrite ? 0 : plan.conflicts.length);

  if (targets.length === 0) {
    return {
      written: 0,
      skipped: skipped,
      skippedReasons: skippedReasons,
      pendingEmail: plan.pendingEmail,
      updatedPeople: []
    };
  }

  const written = writeNameMappingFields_(targets);
  return {
    written: written,
    skipped: skipped,
    skippedReasons: skippedReasons,
    pendingEmail: plan.pendingEmail,
    updatedPeople: targets.map(function (t) {
      return { personId: t.personId, nameTC: t.nameTC, email: t.email };
    })
  };
}

/**
 * 分析 NameMapping_Draft，整理出可套用、有衝突、被略過與仍待補電郵的名單。
 * 本函式只讀取，不做任何寫入，供確認視窗預覽使用。
 * @returns {{applicable: Object[], newOnly: Object[], conflicts: Object[],
 *   skipped: Object[], skippedReasons: Object, pendingEmail: Object[], totalRows: number}} 分析結果
 */
function planHwcasApply() {
  const rows = readDraftRows_();
  if (rows.length === 0) {
    throw new Error('找不到 ' + SHEETS.NAME_MAPPING_DRAFT + ' 的資料，請先執行「從 HWCAS 取電郵（產生初稿）」');
  }

  const prefixMap = readCongregationPrefixMap_();
  const applicable = [];
  const skipped = [];
  const skippedReasons = {};

  // 記錄哪些 PersonID 在 HWCAS 有對應紀錄（不論電郵是否空白），供分類待補名單使用
  const matchedInHwcas = {};

  const addSkip = function (row, reason) {
    skipped.push(row);
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  };

  rows.forEach(function (row) {
    const matchType = String(row[DRAFT_COLUMNS.MATCH_TYPE] || '').toUpperCase();
    const personId = String(row[DRAFT_COLUMNS.PERSON_ID] || '').trim();
    const email = String(row[DRAFT_COLUMNS.HWCAS_EMAIL] || '').trim();
    const nameTC = row[DRAFT_COLUMNS.NAME_TC] || row[DRAFT_COLUMNS.HWCAS_NAME] || personId;

    if (matchType !== HWCAS_MATCH.EXACT && matchType !== HWCAS_MATCH.ALIAS) {
      addSkip(row, describeSkipReason_(matchType));
      return;
    }
    if (!personId) {
      addSkip(row, '沒有 PersonID');
      return;
    }

    matchedInHwcas[personId] = true;

    if (!email) {
      addSkip(row, 'HWCAS 有此人但電郵欄空白');
      return;
    }

    const memberNo = row[DRAFT_COLUMNS.MEMBER_NO];
    const derived = deriveCongregationAndType_(memberNo, prefixMap);
    applicable.push({
      personId: personId,
      nameTC: nameTC,
      email: email,
      existingEmail: String(row[DRAFT_COLUMNS.EXISTING_EMAIL] || '').trim(),
      memberNo: memberNo,
      lastAttendance: row[DRAFT_COLUMNS.LAST_ATTENDANCE],
      meetingPoint: row[DRAFT_COLUMNS.MEETING_POINT],
      congregation: derived.congregation,
      memberType: derived.memberType
    });
  });

  const conflicts = applicable.filter(function (a) {
    return a.existingEmail && a.existingEmail.toLowerCase() !== a.email.toLowerCase();
  });
  const conflictIds = {};
  conflicts.forEach(function (c) { conflictIds[c.personId] = true; });

  return {
    applicable: applicable,
    newOnly: applicable.filter(function (a) { return !conflictIds[a.personId]; }),
    conflicts: conflicts,
    skipped: skipped,
    skippedReasons: skippedReasons,
    pendingEmail: buildPendingEmailList_(applicable, matchedInHwcas),
    totalRows: rows.length
  };
}

/**
 * 統計仍待補電郵的人。
 *
 * 只計 NameMapping 內 Active=TRUE 且 Email 為空的人，並扣除本次即將寫入電郵的人。
 * 刻意不從初稿的資料列統計：初稿包含 HWCAS 全部會眾（數百人），
 * 其中配不到 PersonID 的人根本不在 NameMapping、不會出現在職事表，不應計入。
 *
 * @param {Object[]} applicable 本次可寫入的清單
 * @param {Object.<string, boolean>} matchedInHwcas 在 HWCAS 有對應紀錄的 PersonID
 * @returns {{total: number, hwcasNoEmail: Object[], notInHwcas: Object[]}} 分兩類的待補名單
 */
function buildPendingEmailList_(applicable, matchedInHwcas) {
  const willReceiveEmail = {};
  applicable.forEach(function (a) { willReceiveEmail[a.personId] = true; });

  const hwcasNoEmail = [];
  const notInHwcas = [];

  readPeople().forEach(function (row) {
    const personId = row[COLUMNS.NAME_MAPPING.PERSON_ID];
    const email = String(row[COLUMNS.NAME_MAPPING.EMAIL] || '').trim();
    if (email) return;
    if (willReceiveEmail[personId]) return;

    const entry = {
      personId: personId,
      nameTC: row[COLUMNS.NAME_MAPPING.NAME_TC] || personId,
      congregation: row[COLUMNS.NAME_MAPPING.CONGREGATION] || ''
    };
    if (matchedInHwcas[personId]) {
      hwcasNoEmail.push(entry);
    } else {
      notInHwcas.push(entry);
    }
  });

  return {
    total: hwcasNoEmail.length + notInHwcas.length,
    hwcasNoEmail: hwcasNoEmail,
    notInHwcas: notInHwcas
  };
}

/**
 * 把配對結果轉成人看得懂的略過原因。
 * @param {string} matchType 配對結果類型
 * @returns {string} 原因描述
 */
function describeSkipReason_(matchType) {
  if (matchType === HWCAS_MATCH.NONE) {
    return 'NONE：HWCAS 有此人但 NameMapping 沒有（不在職事表範圍）';
  }
  if (matchType === HWCAS_MATCH.AMBIGUOUS) {
    return 'AMBIGUOUS：配對到多於一人，需人手判斷';
  }
  if (matchType === HWCAS_MATCH.MISSING_IN_HWCAS) {
    return 'MISSING_IN_HWCAS：NameMapping 有此人但 HWCAS 沒有';
  }
  return '配對結果為 ' + (matchType || '（空白）');
}

/**
 * 讀取 NameMapping_Draft 的資料列。
 * 該表第 1 行為說明、第 2 行為標題、第 3 行起為資料，與其他資料表結構相同。
 * @returns {Object[]} 以標題為屬性名稱的資料列陣列
 */
function readDraftRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING_DRAFT);
  if (!sheet) return [];
  return readSheet(SHEETS.NAME_MAPPING_DRAFT);
}

/**
 * 讀取會眾編號前綴對照。格式為「前綴:堂會:身分」，例如 "10:粵語堂:會友"。
 * Config 的 HWCAS_CONGREGATION_PREFIXES 未設定時採用 HWCAS_CONGREGATION_PREFIX_DEFAULT。
 * @returns {Object.<string, {congregation: string, memberType: string}>} 以前綴為鍵的對照表
 */
function readCongregationPrefixMap_() {
  const raw = getConfig(CONFIG_KEYS.HWCAS_CONGREGATION_PREFIXES, null);
  const entries = (raw && raw.length > 0) ? raw : HWCAS_CONGREGATION_PREFIX_DEFAULT;

  const map = {};
  (Array.isArray(entries) ? entries : splitList_(entries)).forEach(function (entry) {
    const parts = String(entry).split(':').map(function (s) { return s.trim(); });
    if (parts.length < 3 || !parts[0]) return;
    map[parts[0]] = { congregation: parts[1], memberType: parts[2] };
  });
  return map;
}

/**
 * 依會眾編號的前綴推導堂會與會友身分。
 * 編號空白或前綴不在對照表內時，兩項都回傳空字串（該欄不會被寫入）。
 * @param {*} memberNo 會眾編號
 * @param {Object.<string, Object>} prefixMap 前綴對照表
 * @returns {{congregation: string, memberType: string}} 推導結果
 */
function deriveCongregationAndType_(memberNo, prefixMap) {
  const text = String(memberNo === null || memberNo === undefined ? '' : memberNo).trim();
  if (!text) return { congregation: '', memberType: '' };

  const prefixes = Object.keys(prefixMap).sort(function (a, b) { return b.length - a.length; });
  for (let i = 0; i < prefixes.length; i++) {
    if (text.indexOf(prefixes[i]) === 0) return prefixMap[prefixes[i]];
  }
  return { congregation: '', memberType: '' };
}

/**
 * 把套用清單寫入 NameMapping。
 *
 * 刻意逐欄寫入而不是整列覆寫：這樣可以在程式層面保證除了目標欄位以外，
 * NameMapping 的其他欄位（例如 Active、MaxPerQuarter、PreferredPosts、Notes）不會被改動。
 * 某個欄位在初稿中沒有值時，保留該格原有內容。
 *
 * @param {Object[]} targets 要寫入的清單
 * @returns {number} 實際更新的人數
 */
function writeNameMappingFields_(targets) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) return 0;

  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dataRowCount = lastRow - 2;
  const C = COLUMNS.NAME_MAPPING;

  const personIdColumn = headers.indexOf(C.PERSON_ID) + 1;
  if (personIdColumn === 0) throw new Error('NameMapping 找不到 ' + C.PERSON_ID + ' 欄');

  const personIds = sheet.getRange(3, personIdColumn, dataRowCount, 1).getValues();
  const rowByPersonId = {};
  personIds.forEach(function (row, i) {
    const id = String(row[0] || '').trim();
    if (id) rowByPersonId[id] = i;
  });

  const now = nowTimestamp_();
  const fieldPlan = [
    { column: C.EMAIL, valueOf: function (t) { return t.email; } },
    { column: C.MEMBER_NO, valueOf: function (t) { return t.memberNo; } },
    { column: C.EMAIL_SOURCE, valueOf: function () { return EMAIL_SOURCE_HWCAS; } },
    { column: C.EMAIL_VERIFIED_AT, valueOf: function () { return now; } },
    { column: C.LAST_ATTENDANCE, valueOf: function (t) { return t.lastAttendance; } },
    { column: C.MEETING_POINT, valueOf: function (t) { return t.meetingPoint; } },
    { column: C.SYNCED_AT, valueOf: function () { return now; } },
    { column: C.CONGREGATION, valueOf: function (t) { return t.congregation; } },
    { column: C.MEMBER_TYPE, valueOf: function (t) { return t.memberType; } }
  ];

  const updatedRows = {};
  fieldPlan.forEach(function (field) {
    const columnIndex = headers.indexOf(field.column) + 1;
    if (columnIndex === 0) {
      log_('WARN', 'NameMapping 沒有 ' + field.column + ' 欄，已略過該欄');
      return;
    }

    const range = sheet.getRange(3, columnIndex, dataRowCount, 1);
    const values = range.getValues();
    let changed = false;

    targets.forEach(function (target) {
      const rowOffset = rowByPersonId[target.personId];
      if (rowOffset === undefined) return;
      const value = field.valueOf(target);
      // 初稿沒有該欄資料時保留原值，不要用空白洗掉既有內容
      if (value === '' || value === null || value === undefined) return;
      values[rowOffset][0] = value;
      updatedRows[target.personId] = true;
      changed = true;
    });

    if (changed) {
      range.setValues(values);
      // 時間戳欄要一併設定格式，否則會被試算表當成純日期顯示、失去時分秒
      if (field.column === C.EMAIL_VERIFIED_AT || field.column === C.SYNCED_AT) {
        applyTimestampFormat_(sheet, headers, [field.column], 3, dataRowCount);
      }
    }
  });

  return Object.keys(updatedRows).length;
}
