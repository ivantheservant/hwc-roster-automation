/**
 * 「一季一條固定連結」：義工收到的連結一季只有一條，之後排表改幾多次都係
 * 同一條，永遠顯示最新版本，唔需要重新分發連結。
 *
 * ⚠️ **主試算表絕對不可以對外分享**——裡面有 `NameMapping` 的全部電郵、
 * `Config`、`SendLog` 等，分享其中一張分頁等於分享整個檔案。所以做法唔係
 * 喺主試算表加一個「公開分頁」，而係**另外開一個獨立嘅公開試算表檔案**，
 * 一季一個檔案，只放職事表格本身。
 *
 * ## 一季一條固定連結係點做到嘅
 *
 * Google 試算表嘅網址包含檔案 ID（例如
 * `https://docs.google.com/spreadsheets/d/<檔案ID>/edit`），只要**同一個檔案 ID
 * 永遠唔變**，連結就永遠一樣。所以每次「發佈」都係：
 *
 * 1. 睇下 `PublicLinks` 呢張表有冇呢一季嘅紀錄、有冇記低檔案 ID；
 * 2. 有嘅話就 `SpreadsheetApp.openById()` 打開嗰個**同一個**檔案，
 *    **清空內容之後重新寫入**（唔係刪咗佢再開一個新嘅）；
 * 3. 冇（第一次發佈，或者上次記低嘅檔案已經俾人刪咗）先至用
 *    `SpreadsheetApp.create()` 開一個新檔案，設定分享權限，記低檔案 ID。
 *
 * `resolveOrCreatePublicSpreadsheet_()` 就係做呢個判斷；`writePublicRosterContent_()`
 * 淨係清空同重寫內容，唔會動檔案 ID 本身。
 *
 * ## 公開檔案入面淨係可以有咩
 *
 * 職事表格本身（姓名、日期、崗位）、圖例、更新時間。**唔可以有**：`PersonID`、
 * 電郵、規則違反標示（例如警告底色）、任何診斷資訊、`Notes`。做法係完全
 * 重用 `buildGridLayout_()` 產生嘅顯示文字（本來就已經係「排出嚟俾人睇」嘅
 * 文字，唔含內部代號），底色亦只用 `classifyGridCell_()` 嘅五種分類重新上色，
 * 唔會沿用 grid 工作表原本嘅規則警告黃底／FORCED 橙底（嗰兩種係診斷用途，
 * 見 `buildPublicRosterContent_()` 嘅說明）。
 */

/** `PublicLinks` 工作表嘅中文標題，對應 `COLUMNS.PUBLIC_LINKS` 嘅次序。 */
const PUBLIC_LINKS_TITLES_TC = [
  '季度', '公開檔案 ID', '公開連結', '最後發佈時間', '最後發佈版本',
  '分享範圍', '分享權限', '建立時間'
];

/** 公開試算表應有嘅分享設定——任何人有連結就睇得到，唔可以編輯。 */
const PUBLIC_LINK_EXPECTED_ACCESS = 'ANYONE_WITH_LINK';
const PUBLIC_LINK_EXPECTED_PERMISSION = 'VIEW';

/**
 * 取得（必要時建立）`PublicLinks` 工作表，確保第 1、2 行標題正確。
 * 沿用全專案慣例：第 1 行中文標題、第 2 行機器鍵、資料由第 3 行開始。
 * @returns {Sheet} `PublicLinks` 工作表
 */
function ensurePublicLinksSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.PUBLIC_LINKS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.PUBLIC_LINKS);

  const C = COLUMNS.PUBLIC_LINKS;
  const keys = [
    C.QUARTER_ID, C.FILE_ID, C.FILE_URL, C.LAST_PUBLISHED_AT, C.LAST_PUBLISHED_VERSION,
    C.SHARING_ACCESS, C.SHARING_PERMISSION, C.CREATED_AT
  ];

  const existingKeys = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0]
    : [];
  const headerOk = keys.every(function (k, i) { return existingKeys[i] === k; });

  if (!headerOk) {
    sheet.getRange(1, 1, 1, PUBLIC_LINKS_TITLES_TC.length).setValues([PUBLIC_LINKS_TITLES_TC])
      .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]).setFontWeight('bold');
    sheet.setFrozenRows(2);
  }
  return sheet;
}

/**
 * 讀取指定季度喺 `PublicLinks` 嘅紀錄。
 * @param {string} quarterId 季度 ID
 * @returns {?Object} 找到就回傳整理過嘅物件；冇紀錄回傳 `null`
 */
function findPublicLinkRow_(quarterId) {
  const C = COLUMNS.PUBLIC_LINKS;
  const rows = readSheet(SHEETS.PUBLIC_LINKS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][C.QUARTER_ID] || '').trim() === quarterId) {
      return {
        quarterId: quarterId,
        fileId: String(rows[i][C.FILE_ID] || '').trim(),
        fileUrl: String(rows[i][C.FILE_URL] || '').trim(),
        lastPublishedAt: String(rows[i][C.LAST_PUBLISHED_AT] || '').trim(),
        lastPublishedVersion: rows[i][C.LAST_PUBLISHED_VERSION],
        sharingAccess: String(rows[i][C.SHARING_ACCESS] || '').trim(),
        sharingPermission: String(rows[i][C.SHARING_PERMISSION] || '').trim(),
        createdAt: String(rows[i][C.CREATED_AT] || '').trim()
      };
    }
  }
  return null;
}

/**
 * 新增或更新 `PublicLinks` 的一列。用 `QuarterID` 判斷是新增還是更新，
 * 跟專案裡其他「一個實體一列」的表（例如 `RosterVersions`）同一個做法。
 * @param {string} quarterId 季度 ID
 * @param {Object} fields 要寫入的欄位（鍵為 `COLUMNS.PUBLIC_LINKS` 的值）
 * @returns {void}
 */
function upsertPublicLinkRow_(quarterId, fields) {
  const sheet = ensurePublicLinksSheet_();
  const C = COLUMNS.PUBLIC_LINKS;
  const keys = [
    C.QUARTER_ID, C.FILE_ID, C.FILE_URL, C.LAST_PUBLISHED_AT, C.LAST_PUBLISHED_VERSION,
    C.SHARING_ACCESS, C.SHARING_PERMISSION, C.CREATED_AT
  ];

  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  if (lastRow >= 3) {
    const existingIds = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
    for (let i = 0; i < existingIds.length; i++) {
      if (String(existingIds[i][0] || '').trim() === quarterId) { targetRow = i + 3; break; }
    }
  }

  const record = Object.assign({}, fields);
  record[C.QUARTER_ID] = quarterId;
  const row = keys.map(function (k) { return record[k] === undefined ? '' : record[k]; });

  if (targetRow === -1) {
    targetRow = Math.max(lastRow + 1, 3);
  }
  sheet.getRange(targetRow, 1, 1, keys.length).setValues([row]);
}

/**
 * 組出公開試算表檔案要用的名稱。
 * @param {string} quarterId 季度 ID
 * @returns {string} 檔案名稱
 */
function buildPublicRosterFileName_(quarterId) {
  const pattern = String(getConfig(
    CONFIG_KEYS.PUBLIC_ROSTER_FILE_NAME_PATTERN, DEFAULTS.PUBLIC_ROSTER_FILE_NAME_PATTERN));
  return applyPublicRosterFileNamePattern_(pattern, quarterId);
}

/**
 * `buildPublicRosterFileName_()` 的純函式部分，讀 Config 同代入變數分開，
 * 方便獨立測試（不需要真正嘅 GAS 環境）。
 * @param {string} pattern 命名樣板
 * @param {string} quarterId 季度 ID
 * @returns {string} 代入後嘅檔案名稱
 */
function applyPublicRosterFileNamePattern_(pattern, quarterId) {
  return String(pattern || '').split('{QuarterID}').join(quarterId);
}

/**
 * `buildPublicRosterContent_()` 底色計算嘅純函式部分——輸入
 * `buildGridLayout_()` 產生嘅 `layout`（含 `cellIndex`／`rows`／`keys`），
 * 輸出底色矩陣。分開一個獨立函式係為咗方便直接測試「邊幾種分類上邊種色」
 * 呢個對照，唔使成個 `buildPublicRosterContent_()` 一齊測（嗰個要讀試算表）。
 * @param {Object} layout `buildGridLayout_()` 的結果
 * @param {string} gapColor 「排唔出」格要用嘅底色
 * @returns {Array[]} 底色矩陣，形狀同 `layout.rows` 一致
 */
function computePublicRosterBackgrounds_(layout, gapColor) {
  const backgrounds = layout.rows.map(function () { return new Array(layout.keys.length).fill(null); });
  Object.keys(layout.cellIndex).forEach(function (key) {
    const cell = layout.cellIndex[key];
    const r = cell.row - 3;
    const c = cell.column - 1;
    if (cell.cellClass === GRID_CELL_CLASS.GENUINE_GAP) {
      backgrounds[r][c] = gapColor;
    } else if (cell.cellClass === GRID_CELL_CLASS.SPECIAL_SKIP) {
      backgrounds[r][c] = GRID_COLORS.SPECIAL_SKIP;
    } else if (cell.cellClass === GRID_CELL_CLASS.STRUCTURAL_NA
      || cell.cellClass === GRID_CELL_CLASS.MANUAL_PENDING) {
      backgrounds[r][c] = GRID_COLORS.SKIPPED;
    }
    // ASSIGNED 一律唔上色（包括有規則警告嘅格）——公開版本唔顯示診斷資訊
  });
  return backgrounds;
}

/**
 * 組出公開試算表要寫入的內容。**這是全個功能唯一決定「公開檔案入面有咩」
 * 的地方**——刻意寫成一個唔碰 `SpreadsheetApp`／`DriveApp` 的純函式（只用
 * `readSheet()`／`getConfig()` 呢類讀取），方便用真正嘅原始碼直接測試
 * 「絕對唔會漏咗啲乜嘢出去」。
 *
 * 底色刻意**唔沿用** grid 工作表原本嘅底色邏輯（`applyCellMarks_()`）——
 * 嗰個邏輯會將「有人但觸發規則警告」嘅格畫成黃色、`FORCED`（已淘汰嘅舊值，
 * 現在生成器唔會再產生，但長表可能有歷史資料）畫成橙色，兩者都係**診斷
 * 用途**，唔應該出現喺對外公開嘅版本。公開版本只用五種語意分類本身嘅
 * 顏色（已排定＝白、其餘四種留空類別），跟 `docs/幹事操作說明.md`「職事表上
 * 嘅空格分四種」嗰段講嘅完全一致——義工睇到嘅同幹事睇到嘅係同一套語言，
 * 唔會多一種佢哋唔識嘅顏色。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{quarterId: string, versionNo: number, headers: string[], rows: Array[],
 *   backgrounds: Array[], legendRows: Array[], footerNote: string, updatedAt: string}}
 */
function buildPublicRosterContent_(quarterId, versionNo) {
  const assignments = readVersionAssignmentsForGrid_(quarterId, versionNo);
  if (assignments.length === 0) {
    throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄，無法發佈。');
  }
  const layout = buildGridLayout_(quarterId, assignments);

  const gapColor = getConfig(CONFIG_KEYS.GRID_PENDING_FILL_COLOR, DEFAULTS.GRID_PENDING_FILL_COLOR);
  const backgrounds = computePublicRosterBackgrounds_(layout, gapColor);

  const showLegend = getConfig(CONFIG_KEYS.GRID_SHOW_LEGEND, DEFAULTS.GRID_SHOW_LEGEND) === true;
  const footerNote = String(getConfig(CONFIG_KEYS.GRID_FOOTER_NOTE, DEFAULTS.GRID_FOOTER_NOTE) || '');

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    headers: layout.headers,
    rows: layout.rows,
    backgrounds: backgrounds,
    legendRows: showLegend ? buildLegendRows_(layout) : [],
    footerNote: footerNote,
    updatedAt: nowTimestamp_()
  };
}

/**
 * 打開（或建立）指定季度嘅公開試算表檔案。
 *
 * **A3 的核心**：有記低嘅檔案 ID 就一定試住打開嗰一個，唔會因為想「乾淨啲」
 * 而刪咗重開——刪咗重開會令檔案 ID 變、之前分發出去嘅連結全部失效。
 * 只有喺記低嘅檔案打唔開（例如俾人手動刪咗）先會建一個新嘅，並且喺結果
 * 標明 `recreated: true`，等發佈流程可以喺完成訊息提醒幹事連結變咗。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} existingFileId 已知嘅檔案 ID；冇就傳空字串
 * @returns {{spreadsheet: Spreadsheet, created: boolean, recreated: boolean}}
 */
function resolveOrCreatePublicSpreadsheet_(quarterId, existingFileId) {
  if (existingFileId) {
    try {
      const ss = SpreadsheetApp.openById(existingFileId);
      return { spreadsheet: ss, created: false, recreated: false };
    } catch (err) {
      log_('WARN', '公開試算表 ' + existingFileId + '（' + quarterId + '）打不開，'
        + '可能已被人手刪除，將建立新檔（連結會變）：' + err.message);
    }
  }

  const name = buildPublicRosterFileName_(quarterId);
  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { spreadsheet: ss, created: true, recreated: !!existingFileId };
}

/**
 * 把 `buildPublicRosterContent_()` 的內容寫入公開試算表。清空重寫，
 * 唔會刪除／重建檔案本身，亦唔會動分享設定（分享設定只喺建立新檔時設一次，
 * 見 `resolveOrCreatePublicSpreadsheet_()`——每次發佈都重新檢查一次分享設定
 * 反而有風險，萬一幹事手動放寬過設定，系統唔應該喺佢唔知情下改返窄）。
 * @param {Spreadsheet} spreadsheet 目標公開試算表
 * @param {Object} content `buildPublicRosterContent_()` 的結果
 * @returns {void}
 */
function writePublicRosterContent_(spreadsheet, content) {
  let sheet = spreadsheet.getSheets()[0];
  sheet.clear();
  sheet.clearNotes();
  sheet.setName(GRID_LABELS.FULL_VERSION);

  const colCount = content.headers.length;
  sheet.getRange(1, 1).setValue(
    content.quarterId + ' 職事表　更新時間：' + content.updatedAt
  ).setFontWeight('bold');
  sheet.getRange(2, 1, 1, colCount).setValues([content.headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER).setWrap(true);

  if (content.rows.length > 0) {
    sheet.getRange(3, 1, content.rows.length, colCount).setValues(content.rows);
    sheet.getRange(3, 1, content.backgrounds.length, colCount).setBackgrounds(content.backgrounds);
  }

  let row = content.rows.length + 5;
  if (content.legendRows.length > 0) {
    sheet.getRange(row, 1).setValue(GRID_LABELS.LEGEND_TITLE).setFontWeight('bold')
      .setBackground(GRID_COLORS.STATS_HEADER);
    row++;
    sheet.getRange(row, 1, content.legendRows.length, 3).setValues(content.legendRows);
    row += content.legendRows.length;
  }
  if (content.footerNote) {
    row++;
    sheet.getRange(row, 1).setValue(content.footerNote).setFontStyle('italic');
  }

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, colCount);

  // 一開始 SpreadsheetApp.create() 只會有一張分頁，但如果係「重開已存在嘅
  // 檔案再覆寫」，理論上唔應該有其他分頁（呢個功能自己唔會加第二張），
  // 但為咗保險（例如幹事手動加咗一張），刪走除咗第一張以外嘅所有分頁，
  // 確保連結打開嘅永遠淨係一張、乾淨嘅職事表。
  const extraSheets = spreadsheet.getSheets().slice(1);
  extraSheets.forEach(function (s) { spreadsheet.deleteSheet(s); });
}

/**
 * 發佈（或重新發佈）指定季度的公開職事表。輸入 QuarterID，自動取最新版本。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, fileId: string, fileUrl: string,
 *   created: boolean, recreated: boolean}}
 */
function publishPublicRoster_(quarterId) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error('季度 ' + quarterId + ' 還沒有任何版本，請先執行「步驟 1：生成初稿」。');
  }

  const content = buildPublicRosterContent_(quarterId, versionNo);
  const existing = findPublicLinkRow_(quarterId);
  const resolved = resolveOrCreatePublicSpreadsheet_(quarterId, existing ? existing.fileId : '');
  writePublicRosterContent_(resolved.spreadsheet, content);

  const fileId = resolved.spreadsheet.getId();
  const fileUrl = resolved.spreadsheet.getUrl();
  let sharing = { access: '', permission: '' };
  try {
    sharing = readPublicFileSharing_(fileId);
  } catch (err) {
    log_('WARN', '發佈完成，但讀取分享設定失敗：' + err.message);
  }

  upsertPublicLinkRow_(quarterId, (function () {
    const C = COLUMNS.PUBLIC_LINKS;
    const fields = {};
    fields[C.FILE_ID] = fileId;
    fields[C.FILE_URL] = fileUrl;
    fields[C.LAST_PUBLISHED_AT] = content.updatedAt;
    fields[C.LAST_PUBLISHED_VERSION] = versionNo;
    fields[C.SHARING_ACCESS] = sharing.access;
    fields[C.SHARING_PERMISSION] = sharing.permission;
    fields[C.CREATED_AT] = (existing && existing.createdAt) || content.updatedAt;
    return fields;
  })());

  writeAuditLog_({
    action: '發佈公開職事表',
    targetSheet: SHEETS.PUBLIC_LINKS,
    targetKey: quarterId,
    newValue: 'v' + versionNo + '　' + fileUrl,
    source: 'publishPublicRoster_',
    notes: resolved.created ? (resolved.recreated ? '原檔案已不存在，建立了新檔案（連結已改變）' : '第一次發佈，建立新檔案')
      : '覆寫既有檔案，連結不變'
  });

  return {
    quarterId: quarterId, versionNo: versionNo, fileId: fileId, fileUrl: fileUrl,
    created: resolved.created, recreated: resolved.recreated
  };
}

/**
 * 讀取一個 Drive 檔案目前的分享設定，轉成純字串（列舉值本身不能直接比較／
 * 序列化，統一轉字串方便記錄同比對）。
 * @param {string} fileId 檔案 ID
 * @returns {{access: string, permission: string}}
 */
function readPublicFileSharing_(fileId) {
  const file = DriveApp.getFileById(fileId);
  return {
    access: String(file.getSharingAccess()),
    permission: String(file.getSharingPermission())
  };
}

/**
 * 判斷一個分享設定是否符合公開職事表應有的樣子（任何人有連結可睇，不可編輯）。
 * 純函式，不碰 `DriveApp`，供 `checkPublicLinksSharing_()` 呼叫，也方便獨立測試。
 * @param {string} access `file.getSharingAccess()` 轉字串後的值
 * @param {string} permission `file.getSharingPermission()` 轉字串後的值
 * @returns {{ok: boolean, message: string}}
 */
function evaluatePublicLinkSharing_(access, permission) {
  if (!access && !permission) {
    return { ok: false, message: '未記錄分享設定（可能從未成功發佈，或讀取失敗）' };
  }
  if (access !== PUBLIC_LINK_EXPECTED_ACCESS) {
    return {
      ok: false,
      message: '分享範圍是「' + access + '」，預期是「' + PUBLIC_LINK_EXPECTED_ACCESS
        + '」（任何人有連結即可檢視）。請自己打開檔案的「共用」設定確認、修正。'
    };
  }
  if (permission !== PUBLIC_LINK_EXPECTED_PERMISSION) {
    return {
      ok: false,
      message: '分享權限是「' + permission + '」，預期是「' + PUBLIC_LINK_EXPECTED_PERMISSION
        + '」（只可檢視，不可編輯）。任何人拿到連結都可以直接改動內容，請立即修正。'
    };
  }
  return { ok: true, message: '正常' };
}

/**
 * A5：唯讀檢查——逐一季列出公開檔案 ID、最後發佈時間、目前分享設定，
 * 分享設定不符預期就標示出來。**會即時重新查詢 Drive 的實際分享設定**
 * （不是只讀 `PublicLinks` 上次記錄的值），因為分享設定隨時可能被人手改動，
 * 只讀記錄值會漏掉「發佈之後幹事自己手動改鬆了分享」這種情況。
 * @returns {Object[]} 每季一項，{quarterId, fileId, fileUrl, lastPublishedAt,
 *   lastPublishedVersion, access, permission, ok, message}
 */
function checkPublicLinksSharing_() {
  return readSheet(SHEETS.PUBLIC_LINKS).map(function (row) {
    const C = COLUMNS.PUBLIC_LINKS;
    const quarterId = String(row[C.QUARTER_ID] || '').trim();
    const fileId = String(row[C.FILE_ID] || '').trim();
    const result = {
      quarterId: quarterId,
      fileId: fileId,
      fileUrl: String(row[C.FILE_URL] || '').trim(),
      lastPublishedAt: String(row[C.LAST_PUBLISHED_AT] || '').trim(),
      lastPublishedVersion: row[C.LAST_PUBLISHED_VERSION],
      access: '', permission: '', ok: false, message: ''
    };
    if (!fileId) {
      result.message = '未記錄檔案 ID';
      return result;
    }
    try {
      const sharing = readPublicFileSharing_(fileId);
      result.access = sharing.access;
      result.permission = sharing.permission;
      const evaluated = evaluatePublicLinkSharing_(sharing.access, sharing.permission);
      result.ok = evaluated.ok;
      result.message = evaluated.message;
    } catch (err) {
      result.message = '無法讀取檔案（可能已被刪除）：' + err.message;
    }
    return result;
  });
}

/**
 * 選單項目「⚠️ 發佈公開職事表」的執行入口。
 * @returns {void}
 */
function runPublishPublicRoster_() {
  const ui = SpreadsheetApp.getUi();
  const title = '發佈公開職事表';

  const response = ui.prompt(title, '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) {
    ui.alert(title, '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return;
  }

  const existing = findPublicLinkRow_(quarterId);
  const confirmLines = existing && existing.fileId
    ? ['將覆寫既有的公開檔案（連結不變）：', '　' + (existing.fileUrl || existing.fileId), '']
    : ['這一季還沒有公開檔案，將建立一個新的：', ''];
  confirmLines.push('公開檔案只會包含：職事表格本身、圖例、更新時間。');
  confirmLines.push('不會包含電郵、PersonID、規則警告標示或任何診斷資訊。');
  confirmLines.push('');
  confirmLines.push('確定要發佈嗎？');
  if (ui.alert(title, confirmLines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const result = publishPublicRoster_(quarterId);
    const lines = [
      '✅ 已發佈 ' + result.quarterId + ' v' + result.versionNo,
      '',
      '公開連結：' + result.fileUrl,
      ''
    ];
    if (result.recreated) {
      lines.push('⚠️ 原本記錄的檔案已經不存在，這是一個全新的檔案，連結跟之前不一樣。');
      lines.push('如果之前已經把舊連結寄給義工，需要重新發送這個新連結。');
    } else if (result.created) {
      lines.push('這是這一季第一次發佈。之後每次重新發佈都會用同一條連結。');
    } else {
      lines.push('連結跟上次一樣，不需要重新分發。');
    }
    ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runPublishPublicRoster_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「公開連結狀態（唯讀）」的執行入口（A5）。
 * @returns {void}
 */
function runCheckPublicLinks_() {
  const ui = SpreadsheetApp.getUi();
  const title = '公開連結狀態（唯讀）';

  let results;
  try {
    results = checkPublicLinksSharing_();
  } catch (err) {
    log_('ERROR', 'runCheckPublicLinks_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (results.length === 0) {
    ui.alert(title, '目前沒有任何季度發佈過公開職事表。', ui.ButtonSet.OK);
    return;
  }

  const rows = [];
  results.forEach(function (r) {
    rows.push(diagRow_('公開連結', r.quarterId,
      (r.ok ? '✅ 正常' : '⚠️ ' + r.message),
      'v' + (r.lastPublishedVersion || '?') + '　最後發佈：' + (r.lastPublishedAt || '（未知）')
        + '　連結：' + (r.fileUrl || '（無）')));
  });
  const written = tryWriteDiagnostics_('公開連結狀態', rows);

  const problems = results.filter(function (r) { return !r.ok; });
  const lines = [
    '共 ' + results.length + ' 個季度曾經發佈過公開職事表。',
    ''
  ];
  results.forEach(function (r) {
    lines.push((r.ok ? '✅ ' : '⚠️ ') + r.quarterId + '　v' + (r.lastPublishedVersion || '?')
      + '　' + (r.ok ? '分享設定正常' : r.message));
  });
  if (problems.length > 0) {
    lines.push('', '⚠️ 有 ' + problems.length + ' 個季度的分享設定不正常，請盡快處理。');
  }
  lines.push('', '完整明細已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「公開連結狀態」，共 '
    + written + ' 行。');
  lines.push('', '本工具完全唯讀：不會改動任何連結或分享設定。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
