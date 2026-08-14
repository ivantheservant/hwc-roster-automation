/**
 * 從 HWCAS 出席系統試算表讀取會友資料，與 NameMapping 比對後產生配對初稿。
 *
 * 安全機制：本檔案對 HWCAS 試算表**一律唯讀**，不含任何寫入呼叫；
 * 結果只寫入本試算表的 NameMapping_Draft 工作表，**絕不自動寫入 NameMapping**。
 *
 * @returns {{sheetName: string, matched: number, ambiguous: number, unmatched: number,
 *   missingInHwcas: number, total: number}} 配對統計
 */
function syncHwcasEmails() {
  const config = readConfig();
  const source = readHwcasMembers_(config);
  source.fieldColumns = readHwcasFieldColumns_(config);
  const draft = buildHwcasDraft_(source.records, source.fieldColumns, source.headers);
  const sheetName = writeHwcasDraftSheet_(draft, source);

  return {
    sheetName: sheetName,
    matched: draft.filter(function (d) { return d.matchType === HWCAS_MATCH.EXACT || d.matchType === HWCAS_MATCH.ALIAS; }).length,
    ambiguous: draft.filter(function (d) { return d.matchType === HWCAS_MATCH.AMBIGUOUS; }).length,
    unmatched: draft.filter(function (d) { return d.matchType === HWCAS_MATCH.NONE; }).length,
    missingInHwcas: draft.filter(function (d) { return d.matchType === HWCAS_MATCH.MISSING_IN_HWCAS; }).length,
    total: draft.length
  };
}

/**
 * 唯讀開啟 HWCAS 試算表，只讀取 Config 的 HWCAS_READ_COLUMNS 指定的欄位。
 * 明確排除任何未列出的欄位（例如密碼欄），並且不做任何寫入。
 * @param {Object.<string, *>} config readConfig() 的結果
 * @returns {{records: Object[], headers: Object.<string, string>, columns: string[]}} 讀到的資料
 */
function readHwcasMembers_(config) {
  const spreadsheetId = String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim();
  const sheetName = String(config[CONFIG_KEYS.HWCAS_MEMBERS_SHEET] || DEFAULTS.HWCAS_MEMBERS_SHEET).trim();
  const columns = (config[CONFIG_KEYS.HWCAS_READ_COLUMNS] || []).map(function (c) { return String(c).trim().toUpperCase(); });

  if (!spreadsheetId) throw new Error('Config 的 HWCAS_SPREADSHEET_ID 未設定');
  if (columns.length === 0) throw new Error('Config 的 HWCAS_READ_COLUMNS 未設定');

  let sheet;
  try {
    sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  } catch (err) {
    throw new Error('無法開啟 HWCAS 試算表（可能是未授權或沒有存取權）：' + err.message);
  }
  if (!sheet) throw new Error('HWCAS 試算表中找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { records: [], headers: {}, columns: columns };

  // 逐欄讀取，確保只碰 HWCAS_READ_COLUMNS 列出的欄
  const headers = {};
  const columnData = {};
  columns.forEach(function (letter) {
    const index = columnLetterToIndex_(letter);
    if (index < 1) return;
    const values = sheet.getRange(1, index, lastRow, 1).getValues();
    headers[letter] = String(values[0][0] || '').trim();
    columnData[letter] = values.slice(1).map(function (r) { return r[0]; });
  });

  const rowCount = lastRow - 1;
  const records = [];
  for (let i = 0; i < rowCount; i++) {
    const record = { _rowNumber: i + 2 };
    columns.forEach(function (letter) {
      record[letter] = columnData[letter] ? columnData[letter][i] : '';
    });
    records.push(record);
  }

  return { records: records, headers: headers, columns: columns };
}

/**
 * 讀取 Config 的 HWCAS_COL_* 欄位對應。每項都是選填：
 * 姓名與電郵未設定時退回啟發式偵測，其餘三項未設定時該欄留空不寫入。
 * @param {Object.<string, *>} config readConfig() 的結果
 * @returns {{name: string, email: string, memberNo: string, lastAttendance: string, meetingPoint: string}}
 *   各欄對應的 HWCAS 欄位字母；未設定者為空字串
 */
function readHwcasFieldColumns_(config) {
  const pick = function (key) {
    return String(config[key] || '').trim().toUpperCase();
  };
  return {
    // HWCAS_COL_NAME 可以是單一欄（"B"）或多欄（"B,C,D"）。
    // 英語堂的「姓名1」是英文名、「姓名2」才是中文名，所以必須容許多欄比對。
    nameColumns: splitList_(config[CONFIG_KEYS.HWCAS_COL_NAME]).map(function (s) {
      return s.toUpperCase();
    }),
    email: pick(CONFIG_KEYS.HWCAS_COL_EMAIL),
    memberNo: pick(CONFIG_KEYS.HWCAS_COL_MEMBER_NO),
    lastAttendance: pick(CONFIG_KEYS.HWCAS_COL_LAST_ATTENDANCE),
    meetingPoint: pick(CONFIG_KEYS.HWCAS_COL_MEETING_POINT)
  };
}

/**
 * 把 Excel 欄位字母（A、B、AC…）轉為 1 起始的欄號。
 * @param {string} letter 欄位字母
 * @returns {number} 欄號；輸入無效時回傳 0
 */
function columnLetterToIndex_(letter) {
  const clean = String(letter || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!clean) return 0;
  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    index = index * 26 + (clean.charCodeAt(i) - 64);
  }
  return index;
}

/**
 * 以 NameTC 加 NameAlias 比對 HWCAS 資料與 NameMapping，產生配對初稿。
 * 同名多筆時標記為 AMBIGUOUS，交由人手決定。
 * @param {Object[]} hwcasRecords 從 HWCAS 讀到的資料列
 * @returns {Object[]} 配對初稿陣列
 */
function buildHwcasDraft_(hwcasRecords, fieldColumns, headers) {
  const people = readPeople();
  const aliasMap = readNameAlias();
  const columns = fieldColumns || {};
  const columnHeaders = headers || {};

  const byName = {};
  people.forEach(function (row) {
    const name = String(row[COLUMNS.NAME_MAPPING.NAME_TC] || '').trim();
    if (!name) return;
    if (!byName[name]) byName[name] = [];
    byName[name].push(row);
  });

  const draft = [];
  const usedPersonIds = {};

  const nameColumns = (columns.nameColumns && columns.nameColumns.length > 0)
    ? columns.nameColumns : [];

  hwcasRecords.forEach(function (record) {
    const displayName = nameColumns.length > 0
      ? nameColumns.map(function (col) { return String(record[col] || '').trim(); }).join(' / ')
      : extractHwcasName_(record);
    const email = columns.email ? String(record[columns.email] || '').trim() : extractHwcasEmail_(record);
    const hasAnyName = nameColumns.some(function (col) { return String(record[col] || '').trim(); });
    if (!hasAnyName && !displayName && !email) return;

    const memberNo = columns.memberNo ? record[columns.memberNo] : '';
    const lastAttendance = columns.lastAttendance ? record[columns.lastAttendance] : '';
    const meetingPoint = columns.meetingPoint ? record[columns.meetingPoint] : '';

    const matched = nameColumns.length > 0
      ? matchAcrossNameColumns_(record, nameColumns, columnHeaders, byName, aliasMap)
      : matchSingleName_(extractHwcasName_(record), byName, aliasMap);

    const personId = matched.personId;
    const matchType = matched.matchType;
    const note = matched.note;

    if (personId) usedPersonIds[personId] = true;

    const existing = personId ? findPersonRow_(people, personId) : null;
    const existingEmail = existing ? String(existing[COLUMNS.NAME_MAPPING.EMAIL] || '').trim() : '';

    draft.push({
      hwcasRow: record._rowNumber,
      hwcasName: displayName,
      hwcasEmail: email,
      memberNo: memberNo,
      lastAttendance: lastAttendance,
      meetingPoint: meetingPoint,
      personId: personId,
      nameTC: existing ? existing[COLUMNS.NAME_MAPPING.NAME_TC] : '',
      existingEmail: existingEmail,
      matchType: matchType,
      action: decideDraftAction_(matchType, existingEmail, email),
      note: note
    });
  });

  // 補上 NameMapping 有、但 HWCAS 沒有對應的人，方便人手檢查
  people.forEach(function (row) {
    const personId = row[COLUMNS.NAME_MAPPING.PERSON_ID];
    if (usedPersonIds[personId]) return;
    draft.push({
      hwcasRow: '',
      hwcasName: '',
      hwcasEmail: '',
      memberNo: '',
      lastAttendance: '',
      meetingPoint: '',
      personId: personId,
      nameTC: row[COLUMNS.NAME_MAPPING.NAME_TC],
      existingEmail: String(row[COLUMNS.NAME_MAPPING.EMAIL] || '').trim(),
      matchType: HWCAS_MATCH.MISSING_IN_HWCAS,
      action: '無需處理',
      note: 'HWCAS 名單中找不到此人'
    });
  });

  return draft;
}

/**
 * 逐欄嘗試比對姓名，任何一欄對得上即算命中。
 *
 * 英語堂的「姓名1」是英文名、「姓名2」才是中文名，所以必須逐欄嘗試而非只看單一欄。
 * 若不同欄配對到不同的 PersonID，一律標為 AMBIGUOUS 交人手處理，不自動採用。
 *
 * @param {Object} record HWCAS 資料列
 * @param {string[]} nameColumns 要嘗試的欄位字母清單
 * @param {Object.<string, string>} columnHeaders 欄位字母對標題的對照，用於備註說明
 * @param {Object.<string, Object[]>} byName NameMapping 以正名為鍵的索引
 * @param {Object.<string, string>} aliasMap NameAlias 的別名對照
 * @returns {{personId: string, matchType: string, note: string}} 配對結果
 */
function matchAcrossNameColumns_(record, nameColumns, columnHeaders, byName, aliasMap) {
  const hits = [];
  const duplicateNotes = [];

  nameColumns.forEach(function (column) {
    const rawName = String(record[column] || '').trim();
    if (!rawName) return;
    const resolved = resolveNameLocally_(rawName, byName, aliasMap);
    if (!resolved) return;

    if (resolved.matchType === HWCAS_MATCH.AMBIGUOUS) {
      duplicateNotes.push(describeNameColumn_(column, columnHeaders) + '「' + rawName
        + '」在 NameMapping 有 ' + resolved.duplicates.length + ' 個同名: ' + resolved.duplicates.join(', '));
      return;
    }
    hits.push({
      column: column,
      rawName: rawName,
      personId: resolved.personId,
      matchType: resolved.matchType
    });
  });

  if (duplicateNotes.length > 0) {
    return { personId: '', matchType: HWCAS_MATCH.AMBIGUOUS, note: duplicateNotes.join('；') };
  }
  if (hits.length === 0) {
    return { personId: '', matchType: HWCAS_MATCH.NONE, note: '' };
  }

  const distinctIds = {};
  hits.forEach(function (hit) { distinctIds[hit.personId] = true; });
  const ids = Object.keys(distinctIds);

  if (ids.length > 1) {
    return {
      personId: '',
      matchType: HWCAS_MATCH.AMBIGUOUS,
      note: '不同姓名欄配對到不同的人：' + hits.map(function (hit) {
        return describeNameColumn_(hit.column, columnHeaders) + '「' + hit.rawName + '」→ ' + hit.personId;
      }).join('；')
    };
  }

  // 同一個人：優先採用 EXACT 的那一欄作為說明
  const best = hits.filter(function (h) { return h.matchType === HWCAS_MATCH.EXACT; })[0] || hits[0];
  const via = best.matchType === HWCAS_MATCH.ALIAS ? '（經 NameAlias 對應）' : '';
  return {
    personId: best.personId,
    matchType: best.matchType,
    note: '經 ' + describeNameColumn_(best.column, columnHeaders) + ' 配對' + via
  };
}

/**
 * 只用單一姓名比對（未設定 HWCAS_COL_NAME 時的舊行為）。
 * @param {string} name 姓名
 * @param {Object.<string, Object[]>} byName NameMapping 以正名為鍵的索引
 * @param {Object.<string, string>} aliasMap NameAlias 的別名對照
 * @returns {{personId: string, matchType: string, note: string}} 配對結果
 */
function matchSingleName_(name, byName, aliasMap) {
  const resolved = resolveNameLocally_(name, byName, aliasMap);
  if (!resolved) return { personId: '', matchType: HWCAS_MATCH.NONE, note: '' };
  if (resolved.matchType === HWCAS_MATCH.AMBIGUOUS) {
    return {
      personId: '',
      matchType: HWCAS_MATCH.AMBIGUOUS,
      note: 'NameMapping 有 ' + resolved.duplicates.length + ' 個同名: ' + resolved.duplicates.join(', ')
    };
  }
  return {
    personId: resolved.personId,
    matchType: resolved.matchType,
    note: resolved.matchType === HWCAS_MATCH.ALIAS ? '經 NameAlias 對應' : ''
  };
}

/**
 * 用已載入的索引解析單一姓名，等同 normalizeName() 後再比對，但不重複讀取工作表。
 *
 * 直接呼叫 normalizeName() 會令每一次比對都重讀 NameMapping 與 NameAlias；
 * 529 行 × 3 欄會產生上千次讀取，執行時間無法接受。
 *
 * @param {string} rawName 原始姓名
 * @param {Object.<string, Object[]>} byName NameMapping 以正名為鍵的索引
 * @param {Object.<string, string>} aliasMap NameAlias 的別名對照
 * @returns {?{personId: string, matchType: string, duplicates: (string[]|undefined)}}
 *   配對結果；完全對不上時回傳 null
 */
function resolveNameLocally_(rawName, byName, aliasMap) {
  const name = String(rawName || '').trim();
  if (!name) return null;

  const candidates = byName[name] || [];
  if (candidates.length === 1) {
    return { personId: candidates[0][COLUMNS.NAME_MAPPING.PERSON_ID], matchType: HWCAS_MATCH.EXACT };
  }
  if (candidates.length > 1) {
    return {
      personId: '',
      matchType: HWCAS_MATCH.AMBIGUOUS,
      duplicates: candidates.map(function (c) { return c[COLUMNS.NAME_MAPPING.PERSON_ID]; })
    };
  }
  if (aliasMap[name]) {
    return { personId: aliasMap[name], matchType: HWCAS_MATCH.ALIAS };
  }
  return null;
}

/**
 * 把欄位字母連同其標題組成可讀的說明，例如 "C 欄 姓名2"。
 * @param {string} column 欄位字母
 * @param {Object.<string, string>} columnHeaders 欄位字母對標題的對照
 * @returns {string} 說明文字
 */
function describeNameColumn_(column, columnHeaders) {
  const header = columnHeaders[column];
  return column + ' 欄' + (header ? ' ' + header : '');
}

/**
 * 決定初稿中「建議動作」欄的文字，供人手快速判斷。
 * @param {string} matchType 配對結果類型
 * @param {string} existingEmail NameMapping 中現有的電郵
 * @param {string} hwcasEmail HWCAS 中的電郵
 * @returns {string} 建議動作描述
 */
function decideDraftAction_(matchType, existingEmail, hwcasEmail) {
  if (matchType === HWCAS_MATCH.NONE) return '需人手確認：找不到對應的 PersonID';
  if (matchType === HWCAS_MATCH.AMBIGUOUS) return '需人手確認：同名多人';
  if (!hwcasEmail) return '無需處理：HWCAS 沒有電郵';
  if (!existingEmail) return '建議補上電郵';
  if (existingEmail.toLowerCase() === hwcasEmail.toLowerCase()) return '無需處理：電郵相同';
  return '需人手確認：電郵不一致';
}

/**
 * 從 HWCAS 資料列中找出姓名欄位的值。
 * 逐一檢查各欄，取第一個看起來像中文姓名（非電郵、含中文字）的值。
 * @param {Object} record HWCAS 資料列
 * @returns {string} 姓名；找不到時回傳空字串
 */
function extractHwcasName_(record) {
  const keys = Object.keys(record).filter(function (k) { return k !== '_rowNumber'; });
  for (let i = 0; i < keys.length; i++) {
    const value = String(record[keys[i]] || '').trim();
    if (!value || value.indexOf('@') !== -1) continue;
    if (/[一-鿿]/.test(value)) return value;
  }
  return '';
}

/**
 * 從 HWCAS 資料列中找出電郵欄位的值。
 * @param {Object} record HWCAS 資料列
 * @returns {string} 電郵；找不到時回傳空字串
 */
function extractHwcasEmail_(record) {
  const keys = Object.keys(record).filter(function (k) { return k !== '_rowNumber'; });
  for (let i = 0; i < keys.length; i++) {
    const value = String(record[keys[i]] || '').trim();
    if (value.indexOf('@') !== -1 && value.indexOf('.') !== -1) return value;
  }
  return '';
}

/**
 * 依 PersonID 在人員清單中尋找資料列。
 * @param {Object[]} people 人員清單
 * @param {string} personId 要尋找的 PersonID
 * @returns {?Object} 資料列；找不到時回傳 null
 */
function findPersonRow_(people, personId) {
  for (let i = 0; i < people.length; i++) {
    if (people[i][COLUMNS.NAME_MAPPING.PERSON_ID] === personId) return people[i];
  }
  return null;
}

/**
 * 把配對初稿寫入本試算表的 NameMapping_Draft 工作表（同名工作表會重建）。
 * 這是一份**唯讀參考**，不會影響 NameMapping。
 * @param {Object[]} draft 配對初稿
 * @param {Object} source readHwcasMembers_() 的結果，用於標示讀取了哪些欄
 * @returns {string} 工作表名稱
 */
function writeHwcasDraftSheet_(draft, source) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = SHEETS.NAME_MAPPING_DRAFT;
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const columnNote = source.columns.map(function (letter) {
    return letter + '=' + (source.headers[letter] || '(無標題)');
  }).join('　');

  const mapping = source.fieldColumns || {};
  const nameNote = (mapping.nameColumns && mapping.nameColumns.length > 0)
    ? mapping.nameColumns.map(function (col) {
        return col + (source.headers[col] ? '(' + source.headers[col] + ')' : '');
      }).join('+')
    : '（未設定，改用自動偵測）';
  const mappingNote = 'name→' + nameNote + '　'
    + ['email', 'memberNo', 'lastAttendance', 'meetingPoint']
      .map(function (field) { return field + '→' + (mapping[field] || '（未設定）'); })
      .join('　');

  sheet.getRange(1, 1).setValue(
    '此表為 HWCAS 配對初稿，需人手核對後才用選單「套用 HWCAS 初稿」寫入 NameMapping。'
      + '　讀取的欄位：' + columnNote
      + '　│　欄位對應（Config 的 HWCAS_COL_*）：' + mappingNote
  );

  const headers = [DRAFT_COLUMNS.HWCAS_ROW, DRAFT_COLUMNS.HWCAS_NAME, DRAFT_COLUMNS.HWCAS_EMAIL,
    DRAFT_COLUMNS.MEMBER_NO, DRAFT_COLUMNS.LAST_ATTENDANCE, DRAFT_COLUMNS.MEETING_POINT,
    DRAFT_COLUMNS.PERSON_ID, DRAFT_COLUMNS.NAME_TC, DRAFT_COLUMNS.EXISTING_EMAIL,
    DRAFT_COLUMNS.MATCH_TYPE, DRAFT_COLUMNS.ACTION, DRAFT_COLUMNS.NOTE];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  if (draft.length > 0) {
    const rows = draft.map(function (d) {
      return [d.hwcasRow, d.hwcasName, d.hwcasEmail, d.memberNo, d.lastAttendance, d.meetingPoint,
        d.personId, d.nameTC, d.existingEmail, d.matchType, d.action, d.note];
    });
    sheet.getRange(3, 1, rows.length, headers.length).setValues(rows);

    const backgrounds = draft.map(function (d) {
      const needsAttention = d.action.indexOf('需人手確認') === 0;
      const color = needsAttention ? GRID_COLORS.WARNING
        : (d.action === '建議補上電郵' ? GRID_COLORS.PERSONAL_HIGHLIGHT : null);
      return new Array(headers.length).fill(color);
    });
    sheet.getRange(3, 1, backgrounds.length, headers.length).setBackgrounds(backgrounds);
  }

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, headers.length);
  return sheetName;
}
