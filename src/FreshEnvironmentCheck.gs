/**
 * 第十二輪批次階段 B4：「全新環境自我檢查（唯讀）」。
 *
 * 背景：實測發現兩個 first-run 問題（見 `docs/系統範圍稽核.md` 第十二輪批次
 * 階段 B）——`PublicLinks` 工作表、`NameMapping.PersonalLinkToken` 欄，
 * 喺完全冇人行過嗰條路徑之前，冇任何辦法唔撞到錯先知道缺咗啲乜。
 *
 * 呢個工具嘅目的：畀第一次喺全新試算表（或者換咗一部機、幫手接手）用呢個
 * 系統嘅人，一次過睇晒「系統需要嘅全部工作表／幾個系統自己管理嘅欄位」
 * 存唔存在，唔使逐個功能撞到「找不到工作表」先知道要處理。**完全唯讀**，
 * 唔會建立任何工作表或欄位——真係要建立就跟報告入面列出嘅工具名去執行。
 *
 * 分兩類（跟 `WebAppPersonalLink.gs` 檔頭「B2：統一處理原則」一致）：
 * 1. 工作表本身——大部分要人手建立內容（例如 Posts／NameMapping 要人手
 *    輸入真實資料），呢度只負責話畀你知「有冇」，唔負責建立內容。
 * 2. 系統自己管理嘅欄位——呢類有對應嘅「補建 XXX」工具可以一鍵補建
 *    （欄位本身，唔係內容），報告會直接列出要用邊個工具。
 */

/** 系統運作需要嘅全部工作表，連同簡短用途說明。 */
const FRESH_ENV_REQUIRED_SHEETS = [
  { sheet: SHEETS.CONFIG, note: '系統參數設定（需要人手／「補建 Config 參數」建立內容）' },
  { sheet: SHEETS.POSTS, note: '崗位清單（需要人手建立內容）' },
  { sheet: SHEETS.NAME_MAPPING, note: '義工名冊（需要人手建立內容）' },
  { sheet: SHEETS.NAME_ALIAS, note: '姓名別名對照（選填，需要時人手建立內容）' },
  { sheet: SHEETS.ELIGIBILITY, note: '合資格對照（需要人手建立內容）' },
  { sheet: SHEETS.SERVICE_DATES, note: '每季主日日期（由「新增季度」精靈自動產生）' },
  { sheet: SHEETS.SPECIAL_SUNDAYS, note: '特別主日標記（「補建 SpecialSundays 工作表」建立，之後人手逐一標記）' },
  { sheet: SHEETS.UNAVAILABLE, note: '不能服侍申報（由 Requests 套用申報自動寫入）' },
  { sheet: SHEETS.RULE_SETTINGS, note: '排表規則設定（需要人手建立內容）' },
  { sheet: SHEETS.QUARTERS, note: '季度清單（由「新增季度」精靈自動產生）' },
  { sheet: SHEETS.ROSTER_VERSIONS, note: '版本紀錄（生成職事表時自動建立）' },
  { sheet: SHEETS.ROSTER_ASSIGNMENTS, note: '派工紀錄（生成職事表時自動建立）' },
  { sheet: SHEETS.EMAIL_RECIPIENTS, note: '寄信收件人名單（需要人手建立內容）' },
  { sheet: SHEETS.EMAIL_TEMPLATES, note: '電郵範本（「補齊 Email 範本」自動建立內容）' },
  { sheet: SHEETS.SEND_LOG, note: '寄信紀錄（寄送時自動建立）' },
  { sheet: SHEETS.AUDIT_LOG, note: '稽核紀錄（任何寫入動作時自動建立）' },
  { sheet: SHEETS.REQUESTS, note: '申報表（「建立 Requests 工作表」建立）' },
  { sheet: SHEETS.DIAGNOSTICS, note: '唯讀報告輸出（任何「唯讀」工具首次執行時自動建立）' },
  { sheet: SHEETS.PUBLIC_LINKS, note: '公開連結紀錄（「發佈公開職事表」首次執行時自動建立）' },
  // 第十六輪批次階段 A：兩張表都係**可選**嘅——未建立時全部身分規則
  // 自動失效，系統行為同加入呢啲規則之前一模一樣（見 Roles.gs 檔頭）。
  // 所以呢度標明「缺咗唔會壞，但教會新規則 1／2／3 唔會生效」。
  {
    sheet: SHEETS.ROLES,
    note: '身分名單／堂委執事（「補建身分名單工作表」建立，之後人手填名單）'
      + '——缺少時不會出錯，但教會規則 1／2（報告限堂委、當值堂委限堂委或執事）不會生效'
  },
  {
    sheet: SHEETS.PERSON_POST_EXCLUSIONS,
    note: '個人崗位排除（同上工具一併建立）'
      + '——缺少時不會出錯，但教會規則 3（個別人士的崗位限制）不會生效'
  },
  // 第二十七輪批次階段 B1：排表偏好同樣係**可選**嘅。
  // 未建立時 readActivePersonPostWeights_() 回空白，排表結果同以前
  // 一模一樣（見 PersonPostWeight.gs 檔頭嗰條安全性質）。
  {
    sheet: SHEETS.PERSON_POST_WEIGHT,
    note: '排表偏好／誰多做誰少做（「補建排表偏好工作表」建立，'
      + '之後用幹事介面「名單維護 ▸ 排表偏好」填）'
      + '——缺少時不會出錯，但堂委決定的「某人多做／少做幾次」不會生效'
  }
];

/** 系統自己管理嘅關鍵欄位——都有對應嘅「補建」工具可以一鍵補建欄位本身。 */
const FRESH_ENV_REQUIRED_COLUMNS = [
  {
    sheet: SHEETS.NAME_MAPPING, column: COLUMNS.NAME_MAPPING.PERSONAL_LINK_TOKEN,
    tool: '維護 ▸ 補建 NameMapping 欄位（個人專屬連結 token）'
  },
  {
    sheet: SHEETS.POSTS, column: COLUMNS.POSTS.EMPTY_DISPLAY,
    tool: '維護 ▸ 補建 Posts 欄位'
  },
  {
    sheet: SHEETS.POSTS, column: COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES,
    tool: '維護 ▸ 補建 Posts 欄位（提早到場分鐘數）'
  },
  {
    sheet: SHEETS.POSTS, column: COLUMNS.POSTS.REQUIRED_ROLES,
    tool: '維護 ▸ 補建 Posts 欄位（崗位身分要求）'
  }
];

/**
 * 純函式部分：畀定一份「工作表存在與否」清單，逐項標記。分開一個獨立函式
 * 方便測試，唔使真正嘅 GAS 環境。
 * @param {{sheet: string, note: string}[]} required 要檢查嘅清單
 * @param {string[]} existingSheetNames 試算表目前實際有嘅工作表名稱
 * @returns {{sheet: string, note: string, exists: boolean}[]}
 */
function evaluateFreshEnvSheets_(required, existingSheetNames) {
  const existingSet = {};
  existingSheetNames.forEach(function (n) { existingSet[n] = true; });
  return required.map(function (item) {
    return { sheet: item.sheet, note: item.note, exists: !!existingSet[item.sheet] };
  });
}

/**
 * 純函式部分：畀定一份「欄位存在與否」清單，逐項標記。
 * @param {{sheet: string, column: string, tool: string}[]} required 要檢查嘅清單
 * @param {Object.<string, {exists: boolean, headers: string[]}>} sheetInfo
 *   {SheetName: {exists, headers}}——headers 為第 2 行（機器鍵列）嘅值
 * @returns {{sheet: string, column: string, tool: string, sheetExists: boolean, columnExists: boolean}[]}
 */
function evaluateFreshEnvColumns_(required, sheetInfo) {
  return required.map(function (item) {
    const info = sheetInfo[item.sheet] || { exists: false, headers: [] };
    return {
      sheet: item.sheet,
      column: item.column,
      tool: item.tool,
      sheetExists: info.exists,
      columnExists: info.exists && info.headers.indexOf(item.column) !== -1
    };
  });
}

/**
 * GAS 包裝層：真正查詢目前試算表狀態，交俾上面兩個純函式判斷。
 * @returns {{sheets: Object[], columns: Object[]}}
 */
function checkFreshEnvironment_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existingSheetNames = ss.getSheets().map(function (s) { return s.getName(); });

  const sheetInfo = {};
  const columnSheetNames = {};
  FRESH_ENV_REQUIRED_COLUMNS.forEach(function (item) { columnSheetNames[item.sheet] = true; });
  Object.keys(columnSheetNames).forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { sheetInfo[name] = { exists: false, headers: [] }; return; }
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
    sheetInfo[name] = { exists: true, headers: headers };
  });

  return {
    sheets: evaluateFreshEnvSheets_(FRESH_ENV_REQUIRED_SHEETS, existingSheetNames),
    columns: evaluateFreshEnvColumns_(FRESH_ENV_REQUIRED_COLUMNS, sheetInfo)
  };
}

/**
 * 選單項目「全新環境自我檢查（唯讀）」的執行入口。
 * @returns {void}
 */
function runFreshEnvironmentCheck_() {
  const ui = SpreadsheetApp.getUi();
  const title = '全新環境自我檢查（唯讀）';

  let result;
  try {
    result = checkFreshEnvironment_();
  } catch (err) {
    log_('ERROR', 'runFreshEnvironmentCheck_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const missingSheets = result.sheets.filter(function (s) { return !s.exists; });
  const missingColumns = result.columns.filter(function (c) { return c.sheetExists && !c.columnExists; });

  const rows = [];
  result.sheets.forEach(function (s) {
    rows.push(diagRow_('工作表', s.sheet, s.exists ? '✅ 存在' : '⚠️ 不存在', s.note));
  });
  result.columns.forEach(function (c) {
    const value = !c.sheetExists ? '（工作表本身都未存在）'
      : (c.columnExists ? '✅ 存在' : '⚠️ 不存在');
    rows.push(diagRow_('系統管理欄位', c.sheet + '.' + c.column, value, '補建工具：' + c.tool));
  });
  // tryWriteDiagnostics_() 回傳嘅係「有冇成功寫入」嘅布林值，唔係寫入行數
  // ——行數就係 rows.length（見 docs/系統範圍稽核.md 第十二輪批次階段 C
  // 對呢個位嘅型別錯誤說明，呢度一開始就跟正確用法寫，唔重蹈覆轍）。
  tryWriteDiagnostics_('全新環境自我檢查', rows);
  const written = rows.length;

  const lines = [
    '工作表：共 ' + result.sheets.length + ' 張，' + missingSheets.length + ' 張不存在。',
    '系統管理欄位：共 ' + result.columns.length + ' 個，' + missingColumns.length + ' 個不存在（不計工作表本身都未存在的）。',
    ''
  ];
  if (missingSheets.length > 0) {
    lines.push('⚠️ 不存在的工作表：');
    missingSheets.forEach(function (s) { lines.push('　• ' + s.sheet + '　' + s.note); });
    lines.push('');
  }
  if (missingColumns.length > 0) {
    lines.push('⚠️ 不存在的系統管理欄位（可以直接用列出的工具補建）：');
    missingColumns.forEach(function (c) {
      lines.push('　• ' + c.sheet + '.' + c.column + '　→ ' + c.tool);
    });
    lines.push('');
  }
  if (missingSheets.length === 0 && missingColumns.length === 0) {
    lines.push('✅ 全部工作表與系統管理欄位都已經存在。');
  }
  lines.push('完整明細已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「全新環境自我檢查」，共 ' + written + ' 行。');
  lines.push('', '本工具完全唯讀：不會建立任何工作表或欄位。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
