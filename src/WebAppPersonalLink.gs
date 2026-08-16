/**
 * 「個人專屬連結」：每位義工收到一條專屬連結，打開係完整職事表，自己嘅
 * 名字用底色標示；同樣係一季一條、永遠最新（因為讀嘅係即時資料，唔係
 * 快照）。
 *
 * ## 點解需要兩個部署、doGet() 要嚴格分流
 *
 * 現有 Web App（`WebApp.gs` 嘅 `doGet()`）係幹事操作介面，部署權限係
 * `access=MYSELF`——淨係部署嗰個 Google 帳戶（幹事本人）先打得開。義工唔可能
 * 有嗰個帳戶，所以個人連結需要一個**唔同嘅部署**，`access=ANYONE`。
 *
 * 同一個 script project 可以有多個部署，各自嘅 access 獨立設定，但**全部
 * 部署共用同一份程式碼、同一個 `doGet()` 入口**。即係話：`access=ANYONE`
 * 嗰個部署一樣會行到 `doGet()`，如果 `doGet()` 冇分流，任何人都可以攞住
 * 個 ANYONE 連結、去掉 `p` 參數，直接打開幹事操作介面（雖然入面嘅 `api*`
 * 函式仲有 `assertApiCallerAuthorized_()` 嗰層會擋住冇資格嘅人真正操作，
 * 但連介面本身都唔應該畀陌生人睇到）。
 *
 * ⚠️ **`doGet()` 本身必須假設呼叫者未經任何權限檢查**——見 `WebApp.gs` 嘅
 * `doGet()` 現在嘅分流邏輯：有 `p` 參數就**只**走呢個檔案嘅唯讀渲染路徑，
 * 完全唔會touch任何 `api*` 函式或者操作介面；冇 `p` 就行返原本三層防護。
 *
 * ## 安全模型（同幹事介面完全唔同一套）
 *
 * 幹事介面靠 `Session.getActiveUser().getEmail()` 讀身分，義工連結**冇身分
 * 可讀**（ANYONE 部署，訪客好可能連 Google 都未登入）——安全性完全靠
 * `token` 本身唔可猜（32 字元隨機十六進位，122 bit 隨機性，見
 * `generatePersonalLinkToken_()`）。所以：
 * - token 錯、query 有問題、季度唔存在——一律顯示**中性錯誤訊息**
 *   （「連結無效或已失效」），唔可以透露邊一部分錯（唔可以講「呢個 token
 *   唔存在」，會俾人知道 token 系統本身嘅存在同格式，方便暴力嘗試）。
 * - 呢個頁面**完全唔可以有任何寫入路徑**——冇表單、冇按鈕會改動資料、
 *   冇 `google.script.run` 呼叫（連讀取都冇，全部資料伺服器端渲染好先送出）。
 * - token 外洩點算：`runReissuePersonalLinkToken_()` 可以幫單一個人重新
 *   產生一個新 token，舊連結即時失效。
 */

/** 個人連結 token 嘅長度（十六進位字元數，去掉 UUID 嘅連字號之後）。 */
const PERSONAL_LINK_TOKEN_LENGTH = 32;

/** 個人連結／公開連結都搵唔到時，統一顯示嘅中性錯誤訊息。唔透露邊一部分錯。 */
const PERSONAL_LINK_INVALID_MESSAGE = '連結無效或已失效，請聯絡幹事重新發送。';

/**
 * 產生一個新嘅個人連結 token：32 字元十六進位隨機字串（122 bit 隨機性），
 * 用 `Utilities.getUuid()` 去掉連字號。冇用自己手寫嘅隨機數產生器——
 * `Utilities.getUuid()` 係 Apps Script 內建、密碼學等級嘅隨機來源，
 * 冇理由自己再砌一套。
 * @returns {string} 32 字元嘅 token
 */
function generatePersonalLinkToken_() {
  return Utilities.getUuid().split('-').join('');
}

/**
 * 掃描 `NameMapping`，列出邊幾位 `Active=TRUE` 但仲未有個人連結 token 嘅人。
 * 只讀取，唔寫入。
 * @returns {Object[]} 缺 token 嘅人，{personId, nameTC}
 */
function planPersonalLinkTokenSeed_() {
  const C = COLUMNS.NAME_MAPPING;
  return readPeople()
    .filter(function (row) { return !String(row[C.PERSONAL_LINK_TOKEN] || '').trim(); })
    .map(function (row) { return { personId: row[C.PERSON_ID], nameTC: row[C.NAME_TC] }; });
}

/**
 * 第十二輪批次階段 B【first-run 修正】：確保 `NameMapping` 有
 * `PersonalLinkToken` 欄——欄不存在就喺最後一欄之後新增（第 1 行寫中文
 * 標題方便肉眼辨識、第 2 行寫機器鍵），已存在就乜都唔做、直接回傳現有欄號。
 * 唔會覆寫任何現有欄位／資料，同「補建 Posts 欄位」（PostSeed.gs）一致嘅
 * append-only 原則。
 *
 * 實測發現：改用呢個函式之前，`seedPersonalLinkTokens_()` 喺全新環境（欄
 * 仲未存在）會直接拋錯，要求幹事自己手動去工作表加一欄先可以繼續——但
 * PersonalLinkToken 完全係系統自己管理嘅欄位（唔需要人手決定填咩內容），
 * 冇理由要人手介入先可以補建。`runEnsureNameMappingTokenColumn_()`
 * （選單「補建 NameMapping 欄位」）可以喺補發 token 之前先執行呢個函式，
 * `seedPersonalLinkTokens_()` 本身亦已經改為自動呼叫，兩條路徑都唔會再拋錯。
 * @returns {number} `PersonalLinkToken` 欄嘅 1-based 欄號
 */
function ensureNameMappingPersonalLinkTokenColumn_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);

  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.NAME_MAPPING.PERSONAL_LINK_TOKEN);
  if (existingIndex !== -1) return existingIndex + 1;

  const columnIndex = lastCol + 1;
  sheet.getRange(1, columnIndex).setValue('個人專屬連結 Token');
  sheet.getRange(2, columnIndex).setValue(COLUMNS.NAME_MAPPING.PERSONAL_LINK_TOKEN);
  return columnIndex;
}

/**
 * 把缺 token 嘅人補上新 token（逐個 `generatePersonalLinkToken_()`）。
 * **只填空白嘅格**，已經有 token 嘅人一個都唔會動——同「補建 XXX 欄位」
 * 嗰批工具同一個保守原則。
 *
 * 第十二輪批次階段 B：欄唔存在時自動先建欄（`ensureNameMappingPersonalLinkTokenColumn_()`），
 * 唔再要求幹事自己手動加欄先可以執行。
 *
 * @param {Object[]} missing `planPersonalLinkTokenSeed_()` 嘅結果
 * @returns {number} 實際補上 token 嘅人數
 */
function seedPersonalLinkTokens_(missing) {
  if (missing.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);

  const tokenCol = ensureNameMappingPersonalLinkTokenColumn_();
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.NAME_MAPPING;
  const idCol = headers.indexOf(C.PERSON_ID) + 1;
  if (idCol === 0) {
    throw new Error('NameMapping 缺少 ' + C.PERSON_ID + ' 欄（系統核心欄位，需要人手檢查工作表結構）。');
  }

  const lastRow = sheet.getLastRow();
  const ids = sheet.getRange(3, idCol, lastRow - 2, 1).getValues();
  const missingIds = {};
  missing.forEach(function (m) { missingIds[m.personId] = true; });

  let written = 0;
  for (let i = 0; i < ids.length; i++) {
    const personId = String(ids[i][0] || '').trim();
    if (!missingIds[personId]) continue;
    sheet.getRange(i + 3, tokenCol).setValue(generatePersonalLinkToken_());
    written++;
  }
  return written;
}

/**
 * 為單一個人重新產生 token（token 外洩時用）。**一定要傳現有嘅
 * PersonID**，搵唔到就拋錯——呢個函式會覆寫（唔係補空白），冇確認過對象
 * 就唔應該執行。
 *
 * ⚠️ **本輪唔可以寫入試算表，呢個函式本輪唔會被執行**，只實作好俾之後用。
 *
 * @param {string} personId 要重新產生 token 嘅人。呼叫端（`runReissuePersonalLinkToken_()`）
 *   已經用 `normalizeIdInput_()` 處理過全形／零闊度字元，呢個函式內部只再做
 *   `.trim()`（同 `findLatestVersionNo()` 等 QuarterID 查詢一致嘅做法——
 *   正規化喺輸入捕捉點做一次就夠，唔需要每個讀表比對點都重複做）。
 * @returns {{personId: string, nameTC: string, newToken: string}}
 */
function reissuePersonalLinkToken_(personId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.NAME_MAPPING);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.NAME_MAPPING;
  const tokenCol = headers.indexOf(C.PERSONAL_LINK_TOKEN) + 1;
  const idCol = headers.indexOf(C.PERSON_ID) + 1;
  const nameCol = headers.indexOf(C.NAME_TC) + 1;
  // 第十二輪批次階段 B：呢度刻意唔自動建欄——「重新產生」係針對某個人
  // 覆寫現有 token，如果欄仲未存在，代表全體都仲未有任何 token，
  // 應該用「補發個人專屬連結 token」畀全體，唔係喺呢度為一個人補建成欄。
  if (tokenCol === 0 || idCol === 0) {
    throw new Error('NameMapping 缺少 ' + C.PERSONAL_LINK_TOKEN + ' 或 ' + C.PERSON_ID
      + ' 欄。如果係第一次使用個人專屬連結功能，請先執行「補發個人專屬連結 token」'
      + '（會自動建立欄位並為全體補上 token），唔好用呢個工具開始。');
  }

  const lastRow = sheet.getLastRow();
  const ids = sheet.getRange(3, idCol, lastRow - 2, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() !== personId) continue;
    const newToken = generatePersonalLinkToken_();
    sheet.getRange(i + 3, tokenCol).setValue(newToken);
    return {
      personId: personId,
      nameTC: nameCol > 0 ? String(sheet.getRange(i + 3, nameCol).getValue() || '') : '',
      newToken: newToken
    };
  }
  throw new Error('NameMapping 找不到 PersonID=' + personId + '（或者呢個人 Active 唔係 TRUE）。');
}

/**
 * 用 token 搵返係邊個人。搵唔到、或者搵到但 `Active` 唔係 `TRUE`，
 * 一律回傳 `null`——呼叫端一律顯示中性錯誤訊息，唔會透露邊一種原因。
 * @param {string} token 32 字元 token
 * @returns {?{personId: string, nameTC: string}}
 */
function findPersonByToken_(token) {
  return matchPersonByToken_(readPeople(), token); // readPeople() 已經只含 Active=TRUE
}

/**
 * `findPersonByToken_()` 嘅純函式部分——搵人邏輯同讀工作表分開，方便獨立測試
 * （唔使真正嘅 GAS 環境）。**呢個係全個個人連結功能安全性最關鍵嘅一段**，
 * 一定要有直接測試證明：token 一定要完全相等先算搵到，唔可以係前綴／子字串
 * 命中，亦唔可以空 token 就撞正某一行 token 剛好都係空白。
 * @param {Object[]} rows 已經篩過 Active=TRUE 嘅 NameMapping 資料列
 * @param {string} token 訪客提供嘅 token
 * @returns {?{personId: string, nameTC: string}}
 */
function matchPersonByToken_(rows, token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;

  const C = COLUMNS.NAME_MAPPING;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][C.PERSONAL_LINK_TOKEN] || '').trim() === cleanToken) {
      return { personId: rows[i][C.PERSON_ID], nameTC: rows[i][C.NAME_TC] };
    }
  }
  return null;
}

/**
 * 組出俾單一個人睇嘅職事表資料：完整表（含 highlight 標記）、呢個人自己嘅
 * 服侍摘要、更新時間。**呢個函式係 A2／B2 同一個原則嘅延伸**——回傳嘅內容
 * 只可以有職事表格、圖例、更新時間、呢個人自己嘅資料，唔可以有第二個人嘅
 * `PersonID`／電郵、規則警告標示或者任何診斷資訊。
 *
 * 第十二輪批次階段 A：版面同步 `PublicRoster.gs` 改為「崗位做列、日期做欄」
 * ——`transposeRosterForPublicView_()` 產生嘅 `postRows[].cells[]` 直接喺
 * 呢度加多一個 `mine` 布林值（呢格係咪呢個人自己嘅），唔再分開一個獨立嘅
 * `highlightMap` 矩陣——轉置之後行/列座標已經同原本嘅 date-major grid唔一樣，
 * 喺呢度直接喺同一個 cell 物件加旗標，比另外維護一個對應座標嘅矩陣簡單
 * 好多，亦唔會有兩個結構座標對唔齊嘅風險。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} personId 要 highlight 嘅人
 * @param {string} personNameTC 呢個人嘅中文名（已經喺 `findPersonByToken_()` 查過）
 * @returns {{quarterId: string, versionNo: number, personName: string,
 *   dateColumns: Object[], monthGroups: Object[], postRows: Object[], gapColor: string,
 *   mySchedule: Object[], legendRows: Array[], footerNote: string, updatedAt: string}}
 */
function buildPersonalRosterPageData_(quarterId, personId, personNameTC) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error('季度 ' + quarterId + ' 還沒有任何版本。');
  }
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const assignments = readVersionAssignmentsForGrid_(quarterId, versionNo);
  const layout = buildGridLayout_(quarterId, assignments);
  const posts = readPostsNormalized();
  const specialTitleByDate = buildSpecialSundayTitleIndex_(quarterId, timezone);
  // 第十三輪批次階段 A4：日期格式同 PublicRoster.gs 嘅
  // buildPublicRosterContent_() 共用同一套 Config Key，義工喺公開連結／
  // 個人連結見到嘅係同一套顯示邏輯。
  const displayOptions = {
    dateFormatPattern: String(getConfig(CONFIG_KEYS.PUBLIC_ROSTER_DATE_FORMAT, DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT))
  };
  const transposed = transposeRosterForPublicView_(layout, posts, specialTitleByDate, displayOptions);
  const gapColor = getConfig(CONFIG_KEYS.GRID_PENDING_FILL_COLOR, DEFAULTS.GRID_PENDING_FILL_COLOR);

  // 逐格判斷係咪呢個人自己嘅——同步喺 postRows[].cells[] 加 `mine` 旗標，
  // 亦順手收集「你的服侍安排」摘要。
  const postNameById = {};
  posts.forEach(function (p) { postNameById[p.postId] = p.postNameTC; });
  const mySchedule = [];

  transposed.postRows.forEach(function (pr) {
    pr.cells.forEach(function (cell, dateIndex) {
      const key = transposed.dateColumns[dateIndex].serviceDate + '|' + pr.postId + '|' + pr.slotIndex;
      const original = layout.cellIndex[key];
      const mine = !!(original && original.assignment && original.assignment.personId === personId);
      cell.mine = mine;
      // 底色喺呢度直接算好放落 cell.background，樣板（ui/PersonalRoster.html）
      // 唔需要自己識得 cellClass → 顏色嘅對照，維持樣板係純渲染、冇業務邏輯。
      cell.background = resolveGridCellBackground_(cell.cellClass, gapColor);
      if (mine) {
        mySchedule.push({
          serviceDate: transposed.dateColumns[dateIndex].serviceDate,
          postId: pr.postId,
          postNameTC: postNameById[pr.postId] || pr.postId
        });
      }
    });
  });
  mySchedule.sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : 1; });

  const showLegend = getConfig(CONFIG_KEYS.GRID_SHOW_LEGEND, DEFAULTS.GRID_SHOW_LEGEND) === true;
  const footerNote = String(getConfig(CONFIG_KEYS.GRID_FOOTER_NOTE, DEFAULTS.GRID_FOOTER_NOTE) || '');
  // 第十四輪批次階段 A：同 PublicRoster.gs 一致，BLANK 崗位說明改成圖例
  // 加一行，唔再逐格重複寫。
  const blankNote = String(getConfig(CONFIG_KEYS.PUBLIC_ROSTER_BLANK_NOTE, DEFAULTS.PUBLIC_ROSTER_BLANK_NOTE) || '');
  const blankLegendEntry = buildBlankRowLegendEntry_(blankNote, transposed.blankPendingCount);
  const legendRows = showLegend
    ? buildLegendRows_(layout).concat(blankLegendEntry ? [blankLegendEntry] : [])
    : [];

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    personName: personNameTC,
    dateColumns: transposed.dateColumns,
    monthGroups: transposed.monthGroups,
    postRows: transposed.postRows,
    mySchedule: mySchedule,
    legendRows: legendRows,
    footerNote: footerNote,
    updatedAt: nowTimestamp_()
  };
}

/**
 * `doGet()` 帶 `p` 參數時嘅唯讀渲染入口，見 `WebApp.gs` 嘅 `doGet()` 分流。
 *
 * ⚠️ **完全唔行 `assertWebAppRequestAllowed_()`**——嗰個係幹事介面專用嘅
 * 三層防護（部署權限＋`WEBAPP_ENABLED`＋電郵白名單），義工冇 Google 身分可以
 * 過白名單。呢度改用完全唔同嘅一套：token 本身就係授權憑證。
 * 但**仍然尊重 `WEBAPP_ENABLED` 總開關**——如果幹事整個 Web UI 都未啟用，
 * 個人連結都唔應該生效，見下面第一個檢查。
 *
 * @param {Object} e `doGet()` 收到嘅 `e.parameter`
 * @returns {HtmlOutput}
 */
function renderPersonalRosterPage_(e) {
  const quarterId = String((e && e.parameter && e.parameter.q) || '').trim();
  const token = String((e && e.parameter && e.parameter.p) || '').trim();

  try {
    assertWebAppEnabled_();
  } catch (err) {
    return HtmlService.createHtmlOutput('<p>此連結目前暫停服務，請稍後再試或聯絡幹事。</p>')
      .setTitle('粵語堂職事表');
  }

  if (!quarterId || !token) {
    return renderPersonalRosterError_();
  }

  const person = findPersonByToken_(token);
  if (!person) {
    return renderPersonalRosterError_();
  }

  let data;
  try {
    data = buildPersonalRosterPageData_(quarterId, person.personId, person.nameTC);
  } catch (err) {
    // 季度唔存在、仲未生成過任何版本——都算「連結無效」，唔透露細節。
    log_('WARN', 'renderPersonalRosterPage_ 查無資料（quarterId=' + quarterId + '）：' + err.message);
    return renderPersonalRosterError_();
  }

  const template = HtmlService.createTemplateFromFile(UI_FILES.PERSONAL_ROSTER);
  template.data = data;
  return template.evaluate()
    .setTitle(data.quarterId + ' 職事表')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 中性錯誤頁——token 錯、季度唔存在、查詢失敗，全部顯示呢個，
 * 唔透露邊一種原因（見檔頭「安全模型」段落）。
 * @returns {HtmlOutput}
 */
function renderPersonalRosterError_() {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<style>body{font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;'
      + 'padding:40px 20px;text-align:center;color:#1f2328;}'
      + 'p{font-size:15px;line-height:1.6;max-width:360px;margin:0 auto;}</style></head>'
      + '<body><p>' + PERSONAL_LINK_INVALID_MESSAGE + '</p></body></html>'
  ).setTitle('粵語堂職事表');
}

/**
 * 第十二輪批次階段 B3：選單項目「補建 NameMapping 欄位」的執行入口——
 * 手法跟現有「補建 Posts 欄位」一致，只係呢欄冇逐行要填嘅值（純粹新增
 * 欄位本身），所以確認訊息講清楚「只加欄，唔填任何內容」就夠，唔需要
 * 好似 Posts.EmptyDisplay 咁列一份逐行預覽。
 * @returns {void}
 */
function runEnsureNameMappingTokenColumn_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 NameMapping 欄位（個人專屬連結 token）';

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.NAME_MAPPING);
  if (!sheet) {
    ui.alert(title, '找不到工作表: ' + SHEETS.NAME_MAPPING, ui.ButtonSet.OK);
    return;
  }
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  if (headers.indexOf(COLUMNS.NAME_MAPPING.PERSONAL_LINK_TOKEN) !== -1) {
    ui.alert(title, 'PersonalLinkToken 欄已經存在，不需要補建。', ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(title,
    '將在 NameMapping 最後一欄之後新增 PersonalLinkToken 欄'
      + '（只新增欄位本身，不會填入任何內容，也不會動任何現有欄位）。\n\n'
      + '新增之後可以用「維護 ▸ 補發個人專屬連結 token」逐一補上 token。\n\n'
      + '確定要繼續嗎？', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    const columnIndex = ensureNameMappingPersonalLinkTokenColumn_();
    writeAuditLog_({
      action: '補建 NameMapping 欄位',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: COLUMNS.NAME_MAPPING.PERSONAL_LINK_TOKEN,
      newValue: '新增於第 ' + columnIndex + ' 欄',
      source: 'runEnsureNameMappingTokenColumn_'
    });
    ui.alert(title, '已新增 PersonalLinkToken 欄（第 ' + columnIndex + ' 欄）。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runEnsureNameMappingTokenColumn_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補發個人專屬連結 token」的執行入口（B1）。
 * @returns {void}
 */
function runSeedPersonalLinkTokens_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補發個人專屬連結 token';

  let missing;
  try {
    missing = planPersonalLinkTokenSeed_();
  } catch (err) {
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (missing.length === 0) {
    ui.alert(title, '全部在職人員都已經有個人連結 token，不需要補發。', ui.ButtonSet.OK);
    return;
  }

  const lines = ['將為以下 ' + missing.length + ' 位補發 token（只補缺少的，已有 token 的人不會被改動）：', ''];
  missing.slice(0, 30).forEach(function (m) { lines.push('　' + m.nameTC + '（' + m.personId + '）'); });
  if (missing.length > 30) lines.push('　……另有 ' + (missing.length - 30) + ' 位');
  lines.push('', '確定要繼續嗎？');

  if (ui.alert(title, lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedPersonalLinkTokens_(missing);
    writeAuditLog_({
      action: '補發個人專屬連結 token',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: written + ' 人',
      newValue: '（token 內容不記錄在 AuditLog——token 本身就是敏感憑證）',
      source: 'runSeedPersonalLinkTokens_',
      notes: '只補缺少 token 的人，未動任何既有 token'
    });
    ui.alert(title, '已補發 ' + written + ' 個 token。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPersonalLinkTokens_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「⚠️ 重新產生單一個人的 token（外洩時用）」的執行入口（B1）。
 * @returns {void}
 */
function runReissuePersonalLinkToken_() {
  const ui = SpreadsheetApp.getUi();
  const title = '重新產生單一個人的 token';

  const response = ui.prompt(title,
    '請輸入該人的 PersonID（不是姓名，可在 NameMapping 查到）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const personId = normalizeIdInput_(response.getResponseText());
  if (!personId) {
    ui.alert(title, '未輸入 PersonID，已取消。', ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(title,
    '將為 PersonID=' + personId + ' 產生一個全新的 token，舊的連結會立即失效。\n\n'
      + '確定要繼續嗎？', ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  try {
    const result = reissuePersonalLinkToken_(personId);
    writeAuditLog_({
      action: '重新產生個人連結 token',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: personId,
      newValue: '（token 內容不記錄在 AuditLog）',
      source: 'runReissuePersonalLinkToken_',
      notes: '舊連結已失效，需要重新發送新連結給 ' + result.nameTC
    });
    ui.alert(title,
      '已為 ' + result.nameTC + '（' + result.personId + '）產生新的 token。\n\n'
        + '⚠️ 舊連結已經失效，記得重新發送新連結給這位同工。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runReissuePersonalLinkToken_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
