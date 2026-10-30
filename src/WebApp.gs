/**
 * 追加階段 AV：Web UI 的安全模型，共三層，全部要同時成立才會真正執行任何動作：
 *
 * 1. **`appsscript.json` 的部署權限**（`webapp.access = "DOMAIN"`，
 *    `executeAs = "USER_DEPLOYING"`）——這是 Google 平台層級的第一道關卡。
 *    第八十七輪批次 NC 組（Ivan 決定）：由 `MYSELF` 改為 `DOMAIN`，令教會網域
 *    內**名單上**的人都可以使用（有些人可以修改，有些人只可以查看）。`DOMAIN` 只代表
 *    「已登入教會帳戶的人才到達得到這個腳本」，**不代表**他們可以用——真正決定誰可以用的
 *    是第 3 層名單。義工個人專屬連結是另一個部署（`ANYONE_ANONYMOUS`），由
 *    `deploy/push_and_deploy.ps1` 臨時改設定另建版本，不受這裏影響。
 * 2. **Config 的 `WEBAPP_ENABLED` 總開關**（預設 FALSE）——即使 Web App 已經
 *    deploy、部署權限也設對了，這一關沒開，`doGet()` 與全部 `api*` 函式一律
 *    拒絕執行。存在的理由：deploy 這個動作本身不代表幹事已經準備好啟用它，
 *    這一關讓「已部署」與「已啟用」分開，幹事要主動多做一步才會真正生效。
 * 3. **使用名單**——`Session.getActiveUser()` 讀到的呼叫者電郵要在名單內：
 *    - `WEBAPP_ALLOWED_EMAILS`：可以修改的人（留空時只允許 `SCRIPT_ACCOUNT_EMAIL`）。
 *    - `WEBAPP_VIEWER_EMAILS`（第八十七輪批次 NB 組）：只可以查看的人。兩個名單都有 ⇒ 當作可以修改。
 *    不在任何一個名單 ⇒ 中性頁。這一層不依賴第 1 關繼續生效。
 *
 * 三層獨立生效，不是「隨便一關過了就算」，見 `assertWebAppRequestAllowed_()`。
 *
 * ── 第八十七輪批次 NB 組：查看／修改兩種權限 ────────────────────────────
 * 每一個 `api*` 開頭呼叫 `assertWebAppRequestAllowed_()`：
 *   - **不傳參數 ⇒ 當作改動**，只有可以修改的人可以用（新加的 api 忘記歸類也不會漏）。
 *   - 唯讀的 api 傳入**自己的名字**（例如 `assertWebAppRequestAllowed_('apiListQuarters')`），
 *     而且名字要在 `WEBAPP_READ_ONLY_APIS` 內，只可查看的人才可以用。名字不在清單 ⇒ 照樣當作改動。
 * 只可查看的人呼叫改動的 api ⇒ 拒絕（「你只有查看權限，不可以改動。」）並寫 AuditLog。
 * 前端灰色按鈕只是方便，**這裏才是真正的防線**。
 */

/** 第八十七輪批次 NB 組：兩種權限。 */
const WEBAPP_ROLE = { EDITOR: 'EDITOR', VIEWER: 'VIEWER' };

/** 只可查看的人呼叫改動的 api 時的訊息（前端顯示同一句）。 */
const WEBAPP_VIEW_ONLY_MESSAGE = '你只有查看權限，不可以改動。';

/**
 * 第八十七輪批次 NB 組：**伺服器端唯讀 api 清單**——只可查看的人可以呼叫的 api。
 *
 * ⚠️ 和前端 `READ_ONLY_APIS`（ui/Script.html）對照：兩份要一致，只有下面 `WEBAPP_READ_ONLY_EXCEPTIONS`
 * 列明的例外（前端當唯讀、但伺服器端當改動）。測試 `round87_nb_api_permission.test.js` 逐個核對。
 * 加入之前請確認那個函式真的一格都不寫（包括它呼叫的其他 api）。
 */
const WEBAPP_READ_ONLY_APIS = [
  'apiListQuarters', 'apiGetMainFlowState', 'apiGetSendPlanSummary', 'apiGetSendRecipientPool',
  'apiGetLastReviewSendOptions', 'apiCheckMyChanges', 'apiGetSuggestionState', 'apiGetPaperListState',
  'apiGetRecoveryLinks', 'apiCheckImportSheet', 'apiPlanEligibilitySheetApply', 'apiGetDashboardState',
  'apiGetThemePreference', 'apiGenerateDraftPlan', 'apiSaveAndConfirmPlan', 'apiGetSaveButtonState',
  'apiQuarterResetPlan', 'apiGetSendCommitteeRecipients', 'apiStep2Preview', 'apiStep4GetPendingWarnings',
  'apiStep4GetMissingPdfWarnings', 'apiStep4GetSendPreview', 'apiStep5Plan', 'apiListVersionsForRollback',
  'apiRollbackPlan', 'apiListSpecialSundays', 'apiWebListPreacherPending', 'apiGetPreQuarterChecklist',
  'apiGetStaffingCheck', 'apiGetStaffingChangeNote', 'apiGetCombinedServices', 'apiPreseasonPreview',
  // 第九十輪批次 QB 組：〔詩班獻詩〕讀取
  'apiGetChoirSinging',
  // 第九十輪批次 QC 組：〔寄出申報邀請〕預覽
  'apiUnavailableInvitePreview',
  'apiListUnavailable', 'apiPreviewUnavailableImpact', 'apiListPeople', 'apiListAliases',
  'apiGetEligibilityMatrix', 'apiGetPersonPostWeightMatrix', 'apiGetSendAllRecipients',
  'apiGetSendChangedRecipients', 'apiListRoles', 'apiRolesTermChangePlan', 'apiRoleOverview',
  'apiListExclusions', 'apiHwcasPreview', 'apiHwcasLinkPreview', 'apiHwcasSearchPeople',
  'apiListVersionsForZone4', 'apiListPendingBackfillCellsForZone4', 'apiDraftReviewReportForZone4',
  'apiMakeupSendStages', 'apiMakeupSendPlan', 'apiAnnualQuartersPlan', 'apiAnnualCombinedPlan',
  'apiListRuleReviewSheets', 'apiRuleReviewImportPlan',
  // 第八十七輪批次 NB 組：自己的權限；唯讀崗位名單視窗
  'apiGetMyPermission', 'apiGetEligibilityViewOnly'
];

/**
 * 前端當唯讀（不用刷新狀態快取）、但伺服器端當改動的 api，及原因。
 * - `apiVerifyRosterForZone4`：〔核對職事表〕會寫一張新的 `Verify_` 工作表（經 `apiVerifyRoster()`）。
 */
const WEBAPP_READ_ONLY_EXCEPTIONS = ['apiVerifyRosterForZone4'];

/**
 * 檢查 Web UI 總開關（Config 的 `WEBAPP_ENABLED`）。沒開就拋錯。
 * @returns {void}
 */
function assertWebAppEnabled_() {
  if (getConfig_(CONFIG_KEYS.WEBAPP_ENABLED, false) !== true) {
    throw new Error('Web UI 目前已停用（Config 的 WEBAPP_ENABLED 不是 TRUE）。');
  }
}

/**
 * 讀一個電郵名單（Config LIST），全部小寫、去空白。
 * @param {string} key CONFIG_KEYS
 * @returns {string[]}
 */
function readWebAppEmailList_(key) {
  const configured = getConfig_(key, []);
  return (Array.isArray(configured) ? configured : String(configured || '').split(','))
    .map(function (e) { return String(e).trim().toLowerCase(); })
    .filter(Boolean);
}

/**
 * 第八十七輪批次 NB 組：一個電郵的權限。
 * 可以修改＝`WEBAPP_ALLOWED_EMAILS`（留空時退回 `SCRIPT_ACCOUNT_EMAIL`）；只可查看＝`WEBAPP_VIEWER_EMAILS`。
 * 兩個名單都有 ⇒ 可以修改。
 * @param {string} email 已小寫
 * @returns {{role: string, allListsEmpty: boolean}} role＝WEBAPP_ROLE 之一，或空字串（不在名單）
 */
function resolveWebAppRole_(email) {
  const explicitList = readWebAppEmailList_(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS);
  const editors = explicitList.length > 0
    ? explicitList
    : [String(getConfig_(CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, '')).trim().toLowerCase()].filter(Boolean);
  const viewers = readWebAppEmailList_(CONFIG_KEYS.WEBAPP_VIEWER_EMAILS);
  let role = '';
  if (email && editors.indexOf(email) !== -1) role = WEBAPP_ROLE.EDITOR;
  else if (email && viewers.indexOf(email) !== -1) role = WEBAPP_ROLE.VIEWER;
  return { role: role, allListsEmpty: editors.length === 0 && viewers.length === 0 };
}

/**
 * 檢查呼叫者是否在使用名單內（可以修改或只可查看）。`WEBAPP_ALLOWED_EMAILS` 留空時，退回只允許
 * `SCRIPT_ACCOUNT_EMAIL` 那一個人——空白絕對不代表「任何人皆可」，名單全部空白時
 * 直接拒絕（等同名單是空集合，沒有人在內）。
 * @returns {string} WEBAPP_ROLE.EDITOR／WEBAPP_ROLE.VIEWER
 */
function assertApiCallerAuthorized_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error('無法識別呼叫者身分（Session.getActiveUser() 讀不到電郵），拒絕執行。');
  }
  const r = resolveWebAppRole_(email);
  if (r.allListsEmpty) {
    throw new Error('Web UI 允許名單是空的（WEBAPP_ALLOWED_EMAILS、WEBAPP_VIEWER_EMAILS 與 SCRIPT_ACCOUNT_EMAIL 都未設定），拒絕執行。');
  }
  if (!r.role) {
    throw new Error('（' + email + '）不在 Web UI 允許名單內，拒絕執行。');
  }
  return r.role;
}

/**
 * 合併第 2、3 層檢查，供每一個 `api*` 函式開頭呼叫。第 1 層（部署權限）由
 * Google 平台在請求到達這個腳本之前就把關，程式碼裡沒有東西可以額外檢查。
 *
 * 第八十七輪批次 NB 組：**不傳參數 ⇒ 當作改動**，要可以修改的權限。唯讀的 api 傳入自己的名字，
 * 而且名字在 `WEBAPP_READ_ONLY_APIS` 內，只可查看的人才可以用。
 * @param {string=} readOnlyApiName 唯讀 api 自己的名字
 * @returns {string} 呼叫者的權限（WEBAPP_ROLE）
 */
function assertWebAppRequestAllowed_(readOnlyApiName) {
  assertWebAppEnabled_();
  const role = assertApiCallerAuthorized_();
  if (role === WEBAPP_ROLE.EDITOR) return role;
  if (readOnlyApiName && WEBAPP_READ_ONLY_APIS.indexOf(readOnlyApiName) !== -1) return role;
  denyViewOnlyCaller_(readOnlyApiName);
  return role;
}

/**
 * 只可查看的人呼叫改動的 api：寫 AuditLog，然後拒絕。
 * @param {string=} apiName 有傳就記下（不傳的是改動的 api）
 * @returns {void} 一定拋錯
 */
function denyViewOnlyCaller_(apiName) {
  let email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').trim(); } catch (err) { email = ''; }
  try {
    writeAuditLog_({
      action: 'WEBAPP_VIEW_ONLY_DENIED',
      targetSheet: '',
      targetKey: email,
      newValue: apiName || '',
      source: 'assertWebAppRequestAllowed_',
      notes: '只可查看的人嘗試改動，已拒絕'
    });
  } catch (err) {
    log_('WARN', '只可查看的人嘗試改動，AuditLog 寫不到：' + err.message);
  }
  throw new Error(WEBAPP_VIEW_ONLY_MESSAGE);
}

/**
 * 第八十七輪批次 NB 組：試算表內的側邊欄／對話框呼叫的 `api*`（不經幹事介面）。
 * 這幾個 api 一樣可以被這個腳本送出的任何網頁用 `google.script.run` 呼叫，
 * 所以都要檢查：呼叫者要是主試算表的編輯者或擁有人（或者可以修改幹事介面的人）。
 * 不檢查 `WEBAPP_ENABLED`——試算表內的工具在 Web UI 停用時仍然要用得到。
 * @returns {void}
 */
function assertSpreadsheetEditorCaller_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw new Error('無法識別呼叫者身分（Session.getActiveUser() 讀不到電郵），拒絕執行。');
  if (resolveWebAppRole_(email).role === WEBAPP_ROLE.EDITOR) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const editors = (ss.getEditors() || []).map(function (u) { return String(u.getEmail() || '').toLowerCase(); });
  const owner = ss.getOwner();
  if (owner) editors.push(String(owner.getEmail() || '').toLowerCase());
  if (editors.indexOf(email) === -1) throw new Error('（' + email + '）不是這份試算表的編輯者，拒絕執行。');
}

/**
 * Web App 的進入點，回傳操作介面頁面。
 *
 * ⚠️ 第十一輪批次階段 B：**呢個函式而家由兩個唔同 access 設定嘅部署共用**
 * ——幹事介面本身嘅部署（`access=MYSELF`）同義工用嘅「個人專屬連結」部署
 * （`access=ANYONE`，見 `WebAppPersonalLink.gs` 檔頭說明）。**必須假設呼叫者
 * 未經任何權限檢查**，第一件事就要判斷「呢個係咪個人連結請求」，係嘅話
 * 完全唔行下面幹事介面嗰三層防護（義工冇 Google 身分可以過白名單），
 * 唔係先至行返原本嘅邏輯。呢個分流一定要排喺最頭，唔可以有任何共用邏輯
 * 排喺分流之前。
 *
 * 安全模型見上方「追加階段 AV」的說明區塊。總開關關閉、或呼叫者不在白名單內時，
 * **一律不會渲染 `ui/Index`**，只回傳一個不含任何職事表資料的說明頁——
 * 兩種情況用不同文字，方便幹事自己判斷是「未啟用」還是「無權限」。
 *
 * 注意：本專案**尚未部署**為 Web App（依指示不執行 clasp deploy）。
 * 此函式已可運作，日後在編輯器按「部署 → 新增部署 → 網頁應用程式」即可啟用，
 * 但部署之後 `WEBAPP_ENABLED` 仍然是 FALSE，要幹事自己去 Config 開啟才會真正可用。
 *
 * @param {Object} e 查詢參數（`e.parameter.p` 有值就是個人專屬連結請求）
 * @returns {HtmlOutput} 要顯示的頁面
 */
function doGet(e) {
  // 第十一輪批次階段 B：分流一定排最頭。有 p 參數＝個人專屬連結，
  // 完全唔行下面幹事介面嗰三層防護函式（renderPersonalRosterPage_() 自己
  // 有一套完全獨立嘅安全模型，見 WebAppPersonalLink.gs 檔頭說明），
  // 亦都唔會渲染 ui/Index。
  if (e && e.parameter && e.parameter.p) {
    return renderPersonalRosterPage_(e);
  }

  // ⚠️ 第六十七輪批次 AK 組：呢兩個頁面**對外**只可以講中性句子。
  //
  // 現場（2026-10-21 無痕視窗開個人連結基底、冇參數）：見到「……在 Config 工作表的
  // WEBAPP_ALLOWED_EMAILS 加入你的電郵」。義工刪走網址參數就會見到，而且叫佢搵人把自己
  // 加入白名單係錯嘅指示。詳細原因照舊寫入執行記錄（`log_()`），畫面唔提任何工作表、
  // Config 鍵或部署設定——見 `renderWebAppDisabledPage_()`／`renderWebAppForbiddenPage_()`。
  try {
    assertWebAppEnabled_();
  } catch (err) {
    log_('WARN', 'doGet：Web UI 已停用，回中性頁。原因：' + err.message);
    return renderWebAppDisabledPage_();
  }

  try {
    assertApiCallerAuthorized_();
  } catch (err) {
    log_('WARN', 'doGet：呼叫者不在允許名單，回中性頁。原因：' + err.message);
    return renderWebAppForbiddenPage_();
  }

  return HtmlService.createTemplateFromFile(UI_FILES.INDEX)
    .evaluate()
    .setTitle('粵語堂職事表系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 第六十七輪批次 AK 組：Web UI 停用時對外顯示嘅頁。**唔提工作表、Config 鍵、部署設定。**
 * @returns {HtmlOutput}
 */
function renderWebAppDisabledPage_() {
  return HtmlService.createHtmlOutput(
    '<p>系統暫時停用，請稍後再試或聯絡幹事。</p>'
  ).setTitle('粵語堂職事表系統');
}

/**
 * 第六十七輪批次 AK 組：呼叫者不在允許名單時對外顯示嘅頁。
 *
 * - 義工（多數係刪走咗網址參數先會見到）⇒ 叫佢用電郵內嘅個人專屬連結。
 * - 已登入但用錯帳戶嘅幹事 ⇒ 多一句「（目前登入：<電郵>）」方便自己發現；
 *   **仍然唔提 Config**。讀唔到電郵就唔出呢一句。
 * @returns {HtmlOutput}
 */
function renderWebAppForbiddenPage_() {
  let email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '').trim();
  } catch (err) {
    email = '';
  }
  const escaped = email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return HtmlService.createHtmlOutput(
    '<p>這個網址只供幹事使用。如果你是義工，請用電郵內的個人專屬連結。</p>'
      + (escaped ? '<p>（目前登入：' + escaped + '）</p>' : '')
  ).setTitle('粵語堂職事表系統');
}

/** 第八十八輪批次 PC 組：`includeHtml()` 只可以讀 `ui/` 下面的檔（字母、數字、`/`、`_`、`-`，不可以有 `..`）。 */
const INCLUDE_HTML_NAME_PATTERN = /^ui\/[A-Za-z0-9_\-\/]+$/;

/**
 * 讓 HTML 檔案可以引入其他 HTML 片段（樣式、腳本）。
 *
 * 第八十八輪批次 PC 組：這是少數**必須保持公開**（不以 `_` 結尾）的函式——`ui/Index.html` 的模板用它。
 * 公開函式可以被這個腳本送出的任何網頁用 `google.script.run` 呼叫，所以只准讀 `ui/` 下面的介面檔，
 * 其他名稱一律拒絕（不讀檔）。
 * @param {string} fileName 檔案名稱，例如 "ui/Style"
 * @returns {string} 該檔案的內容
 */
function includeHtml(fileName) {
  const name = String(fileName === undefined || fileName === null ? '' : fileName);
  if (!INCLUDE_HTML_NAME_PATTERN.test(name) || name.indexOf('..') !== -1) {
    throw new Error('includeHtml 只可以讀 ui/ 下面的介面檔。');
  }
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * 第八十七輪批次 NB 組：供前端呼叫——自己的權限（載入時呼叫一次）。
 * @returns {{role: string, canModify: boolean}}
 */
function apiGetMyPermission() {
  const role = assertWebAppRequestAllowed_('apiGetMyPermission');
  return { role: role, canModify: role === WEBAPP_ROLE.EDITOR };
}

/**
 * 第十一輪批次階段 D：供前端呼叫——讀取幹事本人儲存喺 UserProperties 嘅
 * 深色/淺色偏好。前端預設用瀏覽器 localStorage（同步、免來回伺服器），
 * 只喺 localStorage 讀寫失敗（例如 HtmlService sandbox 擋咗）時先會退回
 * 呼叫呢個 function（見 ui/Script.html 嘅切換邏輯）。
 * @returns {string} 'dark'／'light'／''（未設定過，前端會改跟裝置設定）
 */
function apiGetThemePreference() {
  assertWebAppRequestAllowed_('apiGetThemePreference');
  const value = PropertiesService.getUserProperties().getProperty(WEBAPP_THEME_PROPERTY_KEY);
  return (value === 'dark' || value === 'light') ? value : '';
}

/**
 * 第十一輪批次階段 D：供前端呼叫——寫入幹事本人嘅深色/淺色偏好到
 * UserProperties（localStorage 唔可用時嘅後備路徑，見 apiGetThemePreference()）。
 * @param {string} theme 'dark'／'light'；其他值一律略過不寫入
 * @returns {void}
 */
function apiSetThemePreference(theme) {
  assertWebAppRequestAllowed_();
  const normalized = (theme === 'dark' || theme === 'light') ? theme : '';
  if (!normalized) return;
  PropertiesService.getUserProperties().setProperty(WEBAPP_THEME_PROPERTY_KEY, normalized);
}

/**
 * 供前端呼叫：列出所有季度與其最新版本號。
 * @returns {Object[]} 每個季度的 {quarterId, status, startDate, endDate, latestVersionNo}
 */
function apiListQuarters() {
  assertWebAppRequestAllowed_('apiListQuarters');
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readSheet_(SHEETS.QUARTERS).map(function (row) {
    const quarterId = row[COLUMNS.QUARTERS.QUARTER_ID];
    return {
      quarterId: quarterId,
      // 第二十四輪批次階段 B3（規格 1.1）：季度下拉一律寫人話
      // （`2026年10-12月`），**唔可以寫 `2026T4`**——`T4` 對幹事嚟講
      // 冇任何意義，佢腦入面嗰個概念係「十月至十二月嗰季」。
      label: buildQuarterLabel_(quarterId),
      status: row[COLUMNS.QUARTERS.STATUS],
      startDate: toDateString_(row[COLUMNS.QUARTERS.START_DATE], timezone),
      endDate: toDateString_(row[COLUMNS.QUARTERS.END_DATE], timezone),
      latestVersionNo: findLatestVersionNo_(quarterId)
    };
  });
}

/**
 * 供前端呼叫：列出指定季度的所有版本。
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 版本清單
 */
function apiListVersions(quarterId) {
  assertWebAppRequestAllowed_();
  const C = COLUMNS.ROSTER_VERSIONS;
  return readSheet_(SHEETS.ROSTER_VERSIONS)
    .filter(function (row) { return row[C.QUARTER_ID] === quarterId; })
    .map(function (row) {
      return {
        versionNo: Number(row[C.VERSION_NO]),
        sheetName: row[C.SHEET_NAME],
        basis: row[C.BASIS],
        status: row[C.STATUS],
        warningCount: Number(row[C.WARNING_COUNT]) || 0
      };
    })
    .sort(function (a, b) { return b.versionNo - a.versionNo; });
}

/**
 * 供前端呼叫：生成職事表並建立新版本，回傳統計摘要。
 * 與選單「生成職事表」走同一套流程（`performRosterGeneration_()`）。
 *
 * 追加階段 AV：這個函式底層跟選單「準備工作 ▸ 生成職事表」共用同一個實作，
 * 而那個選單項目本身沒有 Stage 檢查（設計上任何時候都可以手動重跑生成）。
 * 但透過 Web UI 呼叫額外加了 `Stage=DRAFT` 的檢查，是刻意比選單版本更嚴格，
 * 不是「規則不一致」：階段 E 檢視時發現的真實風險是，Web UI 可以在
 * Stage 已經前進到 `REQUESTS_APPLIED`／`OFFICIAL_SENT` 之後，繞過使用者所在的
 * 選單情境，不知不覺建立一個新版本——而步驟 3／4／5 全部用
 * `findLatestVersionNo_()` 認定「目前是哪一版」，這樣的新版本會在使用者不知情下
 * 變成之後步驟的底本。要求 `Stage=DRAFT` 正是四階段流程步驟 1 本身的前置條件
 * （`runFourStageStep1_()`），這裡是把同一個防線也套用在 Web UI 上，
 * 防止它在生成初稿的時機以外的任何時候插入一個新版本。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 生成結果摘要
 */
function apiGenerateRoster(quarterId) {
  assertWebAppRequestAllowed_();
  requireQuarterStage_(quarterId, [QUARTER_STAGE.DRAFT], '生成職事表（Web UI）');
  const result = performRosterGeneration_(quarterId);

  // ⚠️ 第五十二輪批次 A 組：**造完版本一定要更新公開連結。**
  //
  // 呢一支係「進階功能 ▸ 重新生成初稿（覆蓋式）」嗰條路。佢造出一個
  // 新版本取代原本嗰一版——而公開連結嘅承諾係「永遠指向最新嗰一版」。
  // 唔更新嘅話，幹事重新生成完同堂委講「連結已經更新」，
  // 而堂委開連結見到嘅仍然係舊版。
  //
  // ⚠️ 用**同一支** `tryPublishPublicRoster_()`——發佈失敗唔算生成失敗
  //（版本已經真係建立咗），但一定要分開報畀前端。
  const publish = tryPublishPublicRoster_(quarterId);
  return {
    publishFailed: !!publish.failed,
    publishMessage: publish.failed
      ? describePublishAfterGenerate_(publish, result.versionNo, quarterId) : '',
    sheetName: result.sheetName,
    versionNo: result.versionNo,
    assigned: result.assigned,
    blank: result.blank,
    warnings: result.warnings,
    attemptsRun: result.attemptsRun,
    attemptIndex: result.attemptIndex,
    seed: result.seed,
    deviation: result.deviation,
    // 第十六輪批次階段 D3：未確認日期的特殊主日。目前 Web UI 的步驟 1 是
    // 唯讀顯示（生成一律由選單或自動排程執行），所以前端暫時沒有畫面用到
    // 這個欄位；照樣回傳是為了讓兩個入口的回傳結構保持一致——日後如果
    // Web UI 加回生成入口，唔使再記得補呢一項。
    unconfirmedSpecials: result.unconfirmedSpecials || [],
    unconfirmedSpecialsText: describeUnconfirmedSpecialSundays_(result.unconfirmedSpecials)
  };
}

/**
 * 判斷 RosterAssignments.RuleFlags 的原始文字（逗號分隔，例如 "HARD_COMMUNION_FIRST_SUNDAY"）
 * 是否含有結構性不適用的 RuleID。與 RosterWriter.gs 的 isStructuralNotApplicable_()
 * 判斷邏輯相同，差別只在於這裡的輸入已經被 writeAssignments_() 序列化成字串，
 * 不是原始陣列。
 * @param {string} flagsText RuleFlags 欄的原始文字
 * @returns {boolean} 是否為結構性不適用
 */
function isStructuralNotApplicableFlagsText_(flagsText) {
  const ids = String(flagsText || '').split(',');
  return STRUCTURAL_NA_RULE_IDS.some(function (id) { return ids.indexOf(id) !== -1; });
}

/**
 * 供前端呼叫：取得職事表 grid 的內容，供網頁表格顯示。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{headers: string[], rows: Object[][]}} 表頭與每格的 {text, state} 資料
 */
function apiGetRosterGrid(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  // 第十輪批次階段 A：改為跟 grid／PDF 完全共用同一套分類與文字對照
  // （classifyGridCell_() ＋ resolveGridCellText_()），令三個顯示面
  // （grid 工作表、由 grid 匯出的 PDF、Web UI）永遠講同一件事。
  // 修正前 Web UI 只分得出「結構性不適用」與其餘，「排唔出」同「待人手填」
  // 一律顯示同一個 pendingLabel，跟 grid 一樣有分唔開嘅問題。
  const labels = readGridCellLabels_();
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const assignments = readSheet_(SHEETS.ROSTER_ASSIGNMENTS).filter(function (row) {
    return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
  });
  if (assignments.length === 0) throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄');

  const byKey = {};
  assignments.forEach(function (row) {
    const key = toDateString_(row[C.SERVICE_DATE], timezone) + '|' + row[C.POST_ID] + '|' + row[C.SLOT_INDEX];
    byKey[key] = {
      // classifyGridCell_() 要嘅形狀：RuleFlags 喺長表係逗號分隔字串，
      // 拆返做陣列先餵入去，判斷邏輯就同 grid 嗰邊一模一樣。
      personId: row[C.PERSON_ID],
      personName: row[C.PERSON_NAME_SNAPSHOT] || '',
      assignSource: row[C.ASSIGN_SOURCE],
      ruleFlags: splitList_(row[C.RULE_FLAGS]),
      flagsText: row[C.RULE_FLAGS]
    };
  });

  const posts = readPostsNormalized_();
  const headers = [GRID_LABELS.DATE, GRID_LABELS.WEEK];
  const cellKeys = [];
  const emptyDisplayByPostId = {};
  posts.forEach(function (post) {
    emptyDisplayByPostId[post.postId] = post.emptyDisplay;
    for (let slot = 1; slot <= post.slotCount; slot++) {
      headers.push(post.slotCount > 1 ? post.postNameTC + slot : post.postNameTC);
      cellKeys.push(post.postId + '#' + slot);
    }
  });

  const rows = readServiceDatesNormalized_(quarterId, timezone).map(function (d) {
    const row = [
      { text: d.serviceDate, state: 'meta' },
      { text: String(d.weekIndex), state: 'meta' }
    ];
    cellKeys.forEach(function (key) {
      const parts = key.split('#');
      const cell = byKey[d.serviceDate + '|' + parts[0] + '|' + parts[1]];
      if (!cell) {
        row.push({ text: '', state: 'empty' });
        return;
      }
      const cellClass = classifyGridCell_(cell);
      const text = resolveGridCellText_(cell, cellClass, emptyDisplayByPostId[parts[0]], labels);

      if (cellClass === GRID_CELL_CLASS.GENUINE_GAP) {
        // 'gap' 係本輪新增嘅狀態，前端樣式見 ui/Style.html
        row.push({ text: text, state: 'gap', title: cell.flagsText });
      } else if (cellClass !== GRID_CELL_CLASS.ASSIGNED) {
        row.push({ text: text, state: 'skipped', title: cell.flagsText });
      } else if (cell.assignSource === ASSIGN_SOURCE.FORCED) {
        row.push({ text: text, state: 'forced', title: cell.flagsText });
      } else {
        row.push({ text: text, state: cell.flagsText ? 'warning' : 'ok', title: cell.flagsText });
      }
    });
    return row;
  });

  return { headers: headers, rows: rows };
}

/**
 * 供前端呼叫：執行核對並回傳報告內容。
 *
 * 追加階段 AV：這個函式會寫入一張新的 `Verify_` 工作表，但**沒有**加 Stage 檢查
 * ——對應的選單項目「測試工具 ▸ 核對職事表」（`runVerifyRoster_()`）本身也沒有
 * Stage 限制，設計上任何 Stage、任何版本都可以核對。它不會改動
 * RosterAssignments／RosterVersions，不會影響 `findLatestVersionNo_()` 認定的
 * 「目前版本」，跟 `apiGenerateRoster()` 那種會實際改變流程狀態的風險不同，
 * 所以刻意維持與選單版本一致、不額外加限制（見 HANDOFF.md 決策 AV-2）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{sheetName: string, rows: Object[], summary: Object}} 核對報告
 */
function apiVerifyRoster(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const result = verifyRoster_(quarterId, versionNo);
  return {
    sheetName: result.sheetName,
    rows: result.report.rows,
    summary: {
      adjacentRepeats: result.report.summary.adjacentRepeats,
      hardViolationCount: result.report.summary.hardViolationCount,
      peopleCount: result.report.summary.distribution.peopleCount,
      average: result.report.summary.distribution.average,
      maxCount: result.report.summary.distribution.maxCount
    }
  };
}

/**
 * 供前端呼叫：執行 fine-tune 分析，回傳三欄對照供網頁顯示。
 * 同時把建議寫入 FineTuneProposals。
 *
 * 追加階段 AV：跟 `apiVerifyRoster()` 同一個理由，沒有加 Stage 檢查——對應的
 * 選單項目「準備工作 ▸ 檢查改動」本身也沒有 Stage 限制，而且這裡寫入的是
 * FineTuneProposals（建議清單，要幹事另外去該表填 Decision、再執行「套用決定」
 * 才會真正生效），不會直接改動 RosterAssignments 或影響「目前版本」的認定。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{batchId: string, written: number, changeCount: number, violationCount: number,
 *   proposals: Object[]}} fine-tune 結果
 */
function apiDetectChanges(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  const result = proposeMinimalFix_(quarterId, versionNo);
  const written = writeProposals_(result);
  const people = indexPeopleById_();
  const nameOf = function (personId) {
    if (!personId) return '（空白）';
    return people[personId] ? people[personId].nameTC : personId;
  };

  return {
    batchId: result.batchId,
    written: written,
    changeCount: result.changes.length,
    violationCount: result.violations.length,
    proposals: result.proposals.map(function (p) {
      return {
        serviceDateId: p.serviceDateId,
        postId: p.postId,
        slotIndex: p.slotIndex,
        original: nameOf(p.originalPersonId),
        manual: nameOf(p.manualPersonId),
        suggested: nameOf(p.suggestedPersonId),
        brokenRuleId: p.brokenRuleId,
        severity: p.severity,
        reason: p.reason
      };
    })
  };
}
