/**
 * 「一季一條固定連結」：事奉人員收到的連結一季只有一條，之後排表改幾多次都係
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
 * 第七十五輪批次 CL 組：公開職事表嘅**唯讀顯示網址**格式。
 *
 * Ivan 手動測試 A：狀態卡〔開啟看看〕開出嚟係 `/edit`——佢自己（檔案擁有人）可以直接改公開版。
 * 「任何人都不應該可以直接改公開版。」
 *
 * 揀 `/preview`：唔出編輯工具列、唔出選單，連擁有人開都係純睇；
 * 寄出嘅電郵、個人頁、狀態卡、補寄全部用同一個（經 `findPublicLinkRow_()`）。
 * 舊信入面嘅 `/edit` 連結照樣有效（同一個檔案；其他人本來就只有檢視權）。
 */
const PUBLIC_LINK_VIEW_SUFFIX = '/preview';

/**
 * 由檔案 ID 砌唯讀顯示網址；冇 ID 就嘗試由舊網址（`/edit…`）轉換。
 * 兩樣都冇 ⇒ 空字串（唔會砌一條唔知去邊嘅連結）。
 * @param {string} fileId 公開檔案 ID
 * @param {string=} storedUrl `PublicLinks` 記低嘅網址（舊紀錄可能係 `/edit`）
 * @returns {string}
 */
function buildPublicViewUrl_(fileId, storedUrl) {
  const id = String(fileId || '').trim();
  if (id) return 'https://docs.google.com/spreadsheets/d/' + id + PUBLIC_LINK_VIEW_SUFFIX;
  const url = String(storedUrl || '').trim();
  const m = url.match(/^(https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\/?#]+)/);
  return m ? m[1] + PUBLIC_LINK_VIEW_SUFFIX : url;
}

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
 *
 * 第十二輪批次階段 B【first-run 修正】：實測發現全新環境（`PublicLinks`
 * 工作表仲未存在）第一次執行「發佈公開職事表」會喺呢度就拋出「找不到
 * 工作表: PublicLinks」——因為 `publishPublicRoster_()` 一開始就會呼叫呢個
 * 函式，而當時 `upsertPublicLinkRow_()`（入面有 `ensurePublicLinksSheet_()`）
 * 仲未行到。改為讀取前先 `ensurePublicLinksSheet_()`（冪等：工作表已存在
 * 就淨係驗證標題，唔會清空重寫），令呢個讀取函式喺任何時候呼叫都安全，
 * 唔使呼叫端自己記得「一定要先建表先可以讀」。
 * @param {string} quarterId 季度 ID
 * @returns {?Object} 找到就回傳整理過嘅物件；冇紀錄回傳 `null`
 */
function findPublicLinkRow_(quarterId) {
  ensurePublicLinksSheet_();
  const C = COLUMNS.PUBLIC_LINKS;
  const rows = readSheet_(SHEETS.PUBLIC_LINKS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][C.QUARTER_ID] || '').trim() === quarterId) {
      return {
        quarterId: quarterId,
        fileId: String(rows[i][C.FILE_ID] || '').trim(),
        // 第七十五輪批次 CL 組：一律回唯讀顯示網址（舊紀錄嘅 `/edit` 喺呢度轉換）
        fileUrl: buildPublicViewUrl_(rows[i][C.FILE_ID], rows[i][C.FILE_URL]),
        lastPublishedAt: String(rows[i][C.LAST_PUBLISHED_AT] || '').trim(),
        // 第六十三輪批次 A 組：判斷「過期」要比時間，唔可以用 String() 之後嘅值
        //（Date 轉字串係英文長句）。見 `normalizeSheetTimestamp_()`。
        lastPublishedAtRaw: rows[i][C.LAST_PUBLISHED_AT],
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
  const pattern = String(getConfig_(
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
 * 組出公開試算表要寫入的內容。
 *
 * 第一百零二輪批次 OA 組：**改用共用輸出版面**（`RosterOutput.gs` 的 `buildRosterOutputForVersion_()`）——
 * 公開連結、整季 PDF、個人 PDF、紙本全部同一個版面（樣本：以前人手做的職事表）。
 * 不再有圖例、狀態字（「待確認」「—」「特殊主日」）、PersonID；未有人的格是黃色。
 * 第二張工作表「服侍次數」（`ROSTER_OUTPUT_SHOW_COUNTS`）。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} `buildRosterOutputModel_()` 的結果，另加 `versionNo`、`publishedAt`
 */
function buildPublicRosterContent_(quarterId, versionNo) {
  const model = buildRosterOutputForVersion_(quarterId, versionNo);
  model.versionNo = versionNo;
  model.publishedAt = nowTimestamp_();
  return model;
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
 * 唔會刪除／重建檔案本身（一季一條固定連結）。
 *
 * 第一百零二輪批次 OA 組：版面由共用輸出版面決定（`writeRosterOutputToSpreadsheet_()`）：
 * 第一張「職事表」、第二張「服侍次數」（開關關掉就只有一張），其他工作表一律刪走。
 * 第十三輪批次的教訓照舊：重寫前先 `resetSheetToBlankSlate_()`，合併一定排喺凍結之前。
 *
 * @param {Spreadsheet} spreadsheet 目標公開試算表
 * @param {Object} content `buildPublicRosterContent_()` 的結果
 * @returns {void}
 */
function writePublicRosterContent_(spreadsheet, content) {
  writeRosterOutputToSpreadsheet_(spreadsheet, content);
}

/**
 * 第十二輪批次階段 D：季度重設（`QuarterReset.gs` 的 `executeQuarterReset_()`）
 * 執行時，如果呢一季曾經發佈過公開職事表，喺呢度清空檔案內容做「已重設、
 * 等候重新發佈」提示。
 *
 * **決策：檔案／`PublicLinks` 紀錄都唔刪除**，只清空內容。理由三點：
 * 1. 公開試算表檔案本身唔屬於 `executeQuarterReset_()` 原本嘅刪除範圍
 *    （嗰個函式只清 `RosterAssignments`／`RosterVersions`／`SendLog`／
 *    `Requests`／部分 `Unavailable` 呢類「本季派工資料」）；
 * 2. 如果連檔案都刪咗，下次「發佈公開職事表」會因為搵唔到已知嘅
 *    `fileId` 而建立一個全新檔案（見 `resolveOrCreatePublicSpreadsheet_()`），
 *    令呢一季嘅公開連結**變咗**——直接違反「一季一條固定連結」嘅核心
 *    承諾。如果呢條連結之前已經派咗出去（例如呢一季雖然係測試，但幹事
 *    都手多手發咗俾人試睇），連結一變事奉人員就會撞到 404；
 * 3. 但**乜都唔做**又會令重設之後、重新發佈之前，公開連結一直顯示緊
 *    「已經被刪走嘅舊派工資料」——睇落好似仲有效，其實已經係假資料，
 *    比起清楚寫明「已重設」更危險（有人可能真係會照住嗰份假資料嚟服侍）。
 *
 * 所以做法係：保留檔案 ID／連結，但覆寫內容做一句清楚嘅提示，等下次
 * 「發佈公開職事表」自然覆寫返正確內容。
 *
 * @param {string} quarterId 季度 ID
 * @returns {boolean} 是否有實際清空（呢一季從未發佈過公開職事表、或者
 *   已知嘅檔案打唔開時回傳 `false`，唔算錯誤）
 */
function clearPublicRosterOnQuarterReset_(quarterId) {
  const link = findPublicLinkRow_(quarterId);
  if (!link || !link.fileId) return false;

  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(link.fileId);
  } catch (err) {
    log_('WARN', '季度重設：公開試算表 ' + link.fileId + '（' + quarterId + '）打不開，'
      + '略過清空（可能已被人手刪除）：' + err.message);
    return false;
  }

  // 第十三輪批次階段 B：同 writePublicRosterContent_() 一致，重寫前一定
  // 先完全還原（唔淨係 clear()——嗰個唔會解除合併／歸零凍結，見
  // resetSheetToBlankSlate_() 檔頭說明），先唔會同上一次發佈留低嘅
  // 合併／凍結狀態衝突。
  const sheet = spreadsheet.getSheets()[0];
  resetSheetToBlankSlate_(sheet);
  sheet.setName(ROSTER_OUTPUT_SHEET_NAMES.ROSTER);
  // 第一百零二輪批次 OA 組：「服侍次數」那一張一併刪走（只留一句「已重設」）
  spreadsheet.getSheets().slice(1).forEach(function (s) { spreadsheet.deleteSheet(s); });
  sheet.getRange(1, 1).setValue(
    quarterId + ' 職事表已重設，尚未重新發佈——如有疑問請聯絡幹事查詢最新安排。'
  ).setFontWeight('bold');

  writeAuditLog_({
    action: '季度重設：清空公開職事表',
    targetSheet: SHEETS.PUBLIC_LINKS,
    targetKey: quarterId,
    newValue: '內容清空並顯示「已重設」提示；檔案 ID 與連結維持不變',
    source: 'clearPublicRosterOnQuarterReset_'
  });
  return true;
}

/**
 * 發佈（或重新發佈）指定季度的公開職事表。輸入 QuarterID，自動取最新版本。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, fileId: string, fileUrl: string,
 *   created: boolean, recreated: boolean}}
 */
function publishPublicRoster_(quarterId) {
  const versionNo = findLatestVersionNo_(quarterId);
  if (versionNo < 0) {
    throw new Error('季度 ' + quarterId + ' 還沒有任何版本，請先執行「步驟 1：生成初稿」。');
  }

  const content = buildPublicRosterContent_(quarterId, versionNo);
  const existing = findPublicLinkRow_(quarterId);
  const resolved = resolveOrCreatePublicSpreadsheet_(quarterId, existing ? existing.fileId : '');
  writePublicRosterContent_(resolved.spreadsheet, content);
  // 第七十五輪批次 CL 組：每次發佈都確保「知道連結的人可以檢視」＋所有工作表受保護。
  enforcePublicRosterReadOnly_(resolved.spreadsheet);

  const fileId = resolved.spreadsheet.getId();
  // 第七十五輪批次 CL 組：記低嘅係唯讀顯示網址，唔係 `getUrl()`（`/edit`）
  const fileUrl = buildPublicViewUrl_(fileId, resolved.spreadsheet.getUrl());
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
    fields[C.LAST_PUBLISHED_AT] = content.publishedAt;
    fields[C.LAST_PUBLISHED_VERSION] = versionNo;
    fields[C.SHARING_ACCESS] = sharing.access;
    fields[C.SHARING_PERMISSION] = sharing.permission;
    fields[C.CREATED_AT] = (existing && existing.createdAt) || content.publishedAt;
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
 *
 * 第十二輪批次階段 B【first-run 修正】：同 `findPublicLinkRow_()` 同一個
 * 理由——全新環境從未發佈過任何一季時，`PublicLinks` 工作表可能仲未存在，
 * 讀取前先 `ensurePublicLinksSheet_()`，令呢個唯讀工具喺任何時候執行都
 * 唔會拋錯，冇資料就自然回傳空陣列（呼叫端已經有處理「共 0 個季度」的
 * 顯示邏輯）。
 * @returns {Object[]} 每季一項，{quarterId, fileId, fileUrl, lastPublishedAt,
 *   lastPublishedVersion, access, permission, ok, message}
 */
function checkPublicLinksSharing_() {
  ensurePublicLinksSheet_();
  return readSheet_(SHEETS.PUBLIC_LINKS).map(function (row) {
    const C = COLUMNS.PUBLIC_LINKS;
    const quarterId = String(row[C.QUARTER_ID] || '').trim();
    const fileId = String(row[C.FILE_ID] || '').trim();
    const result = {
      quarterId: quarterId,
      fileId: fileId,
      fileUrl: buildPublicViewUrl_(fileId, row[C.FILE_URL]),
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
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) {
    ui.alert(title, '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return;
  }

  const existing = findPublicLinkRow_(quarterId);
  const confirmLines = existing && existing.fileId
    ? ['將覆寫既有的公開檔案（連結不變）：', '　' + (existing.fileUrl || existing.fileId), '']
    : ['這一季還沒有公開檔案，將建立一個新的：', ''];
  confirmLines.push('公開檔案只會包含：職事表格本身、更新日期、本季服侍次數。');
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
      lines.push('如果之前已經把舊連結寄給事奉人員，需要重新發送這個新連結。');
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
  // 第十二輪批次階段 C【bug 修正】：tryWriteDiagnostics_() 回傳嘅係
  // 「有冇成功寫入」嘅布林值，唔係寫入行數——原本呢度直接將個布林值當
  // 行數用，完成畫面會顯示「共 true 行」。行數應該係 rows.length。
  tryWriteDiagnostics_('公開連結狀態', rows);
  const written = rows.length;

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

/**
 * 第七十五輪批次 CL 組：公開版**一律唯讀**。
 *
 * 1. 分享設定：「知道連結的人可以檢視」（`ANYONE_WITH_LINK`＋`VIEW`）。
 *    ⚠️ 以前只喺建立新檔時設一次（怕改返幹事手動放寬過嘅設定）；Ivan 已決定
 *    「任何人都不應該可以直接改公開版」，所以每次發佈都收返窄。
 * 2. 每一張工作表加保護，只留 `SCRIPT_ACCOUNT_EMAIL`（同埋檔案擁有人——Google 規定移唔走）。
 *
 * 做唔到唔可以令發佈失敗（內容已經寫好）——記 WARN，`檢查公開連結` 會報分享設定唔啱。
 * @param {Spreadsheet} spreadsheet 公開試算表
 * @returns {{sharingSet: boolean, protectedSheets: number}}
 */
function enforcePublicRosterReadOnly_(spreadsheet) {
  const out = { sharingSet: false, protectedSheets: 0 };
  try {
    DriveApp.getFileById(spreadsheet.getId())
      .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    out.sharingSet = true;
  } catch (err) {
    log_('WARN', '公開職事表設定分享（只可檢視）失敗：' + err.message);
  }
  const scriptAccount = String(getConfig_(CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, '') || '').trim();
  spreadsheet.getSheets().forEach(function (sheet) {
    try {
      const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      const protection = (existing && existing.length > 0) ? existing[0] : sheet.protect();
      protection.setDescription('公開版唯讀（只有系統可以改）');
      protection.removeEditors(protection.getEditors());
      if (scriptAccount) protection.addEditor(scriptAccount);
      if (protection.canDomainEdit()) protection.setDomainEdit(false);
      out.protectedSheets++;
    } catch (err) {
      log_('WARN', '公開職事表工作表「' + sheet.getName() + '」加保護失敗：' + err.message);
    }
  });
  return out;
}
