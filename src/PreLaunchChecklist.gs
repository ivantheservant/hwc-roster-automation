/**
 * 階段 D 新增：「維護 ▸ 上線前檢查（唯讀）」。
 *
 * 目的：幹事準備好要正式使用系統（不再只是測試）之前，一次過檢查一批
 * 容易忘記的設定與資料狀態，不用逐個選單工具分開跑。**零寫入**——除了
 * 跟其他「唯讀」工具一樣把報告同時寫進 Diagnostics 工作表之外，不改動
 * 任何工作表、不產生版本、不寄電郵。發現問題只列出來、給建議，
 * 不會自動修正任何東西（自動修正的風險由幹事自己判斷，不是這個工具的責任）。
 *
 * 十個檢查項目對應階段 D 指示逐項列出：DRY_RUN、MAIL_SUBJECT_PREFIX、
 * Web UI 總開關、trigger 是否已安裝、職事表上的人是否都在 NameMapping
 * 有電郵、Eligibility 是否有明顯測試用的行、Unavailable 是否有過期或
 * 語意不清的行、這一季是否有未處理的 Requests、v0 是否受保護、
 * 最新版本是否仍有未解決的硬規則違反。階段 C 追加第十一項：最新版本是否有
 * 「系統應該排但排不出」的格子（真正的排班問題，跟「結構性不適用」「待人手
 * 填寫」這兩種正常留空的情況分開判斷，見 Generator.gs 的
 * summariseBlankAssignments_() 與這裡的 scanGenuineGapCells_()）。
 *
 * 每一項都標「已就緒」或「需要處理」，並附建議文字。有幾項（Web UI 總開關、
 * trigger 是否安裝）本質上兩種狀態都可能是幹事有意的選擇，不是非黑即白的
 * 缺失，所以只有在明顯不一致（例如開關開了但白名單等於沒有人能用）時才
 * 標「需要處理」，其餘情況一律「已就緒」但把目前狀態完整列出，由幹事自行
 * 判斷是否符合預期。
 */

/**
 * 建構單一檢查項目的資料。純資料物件，不涉及 UI。
 * @param {string} label 檢查項目名稱
 * @param {boolean} ready true＝已就緒，false＝需要處理
 * @param {string} value 目前狀態的簡短描述
 * @param {string} guidance 建議文字（已就緒與需要處理都會有，內容不同）
 * @param {string[]=} details 詳細清單（例如缺電郵的人名），可省略
 * @returns {Object}
 */
function buildChecklistItem_(label, ready, value, guidance, details) {
  return { label: label, ready: ready, value: value, guidance: guidance, details: details || [] };
}

/**
 * 階段 C 新增：掃描指定版本的 grid 工作表，找出「有批註但沒有名字」的格子——
 * 這是唯一可靠代表「系統應該排但排不出」的訊號（見 RosterWriter.gs 的
 * applyCellMarks_()：只有真正的規則警告才加批註，「結構性不適用」與「本來就
 * 永遠不自動生成」這兩類正常留空的格子刻意不加批註，避免 PDF 產生大量無意義
 * 註腳）。跟 listPendingBackfillCells_()（RequestsApply.gs）不同——那個掃描的
 * 是「套用修改申報」找不到替補時特地上色的格子，這裡掃描的是**生成當下**
 * 就排不出人的格子，兩者是不同時間點、不同來源的問題，不可以混用同一個掃描。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 每項為 {serviceDate, key, note}
 */
function scanGenuineGapCells_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) return [];

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const dateValues = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const notes = sheet.getRange(3, 1, lastRow - 2, lastCol).getNotes();

  const results = [];
  for (let r = 0; r < values.length; r++) {
    const dateStr = toDateString(dateValues[r][0], timezone);
    for (let c = 3; c < keys.length; c++) {
      if (String(keys[c] || '').indexOf('#') === -1) continue;
      const note = String(notes[r][c] || '').trim();
      if (!note) continue;
      const cellValue = String(values[r][c] || '').trim();
      if (cellValue) continue; // 已經有名字（例如自動指派但有警告），不算留空的問題
      results.push({ serviceDate: dateStr, key: String(keys[c]), note: note });
    }
  }
  return results;
}

/**
 * 上線前檢查的核心邏輯：純讀取，回傳結構化的檢查結果，不呼叫任何 UI。
 * @param {string} quarterId 要檢查的季度 ID
 * @returns {{quarterId: string, items: Object[], readyCount: number, needsAttentionCount: number}}
 */
function buildPreLaunchChecklist_(quarterId) {
  const items = [];
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  // 1. DRY_RUN 是否仍是 TRUE
  const dryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  items.push(buildChecklistItem_(
    'DRY_RUN（是否仍在模擬寄信模式）',
    !dryRun,
    dryRun ? 'TRUE（模擬模式，不會真正寄出電郵）' : 'FALSE（正式寄出模式）',
    dryRun
      ? '目前所有寄信步驟都只是模擬，不會真正寄出電郵。如果你已經測試完成、準備正式使用，'
        + '記得到 Config 把 DRY_RUN 改為 FALSE；如果還在測試階段，維持 TRUE 是正確的，這項可以先不理。'
      : '所有寄信步驟都會真正寄出電郵，請確保這是你有意的決定，並且已經完成測試。'
  ));

  // 2. MAIL_SUBJECT_PREFIX 是否仍有測試字眼
  const subjectPrefix = String(getConfig(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '') || '');
  const testKeywords = ['test', '測試', 'demo', 'temp', 'sample', 'debug'];
  const prefixLower = subjectPrefix.toLowerCase();
  const looksLikeTestPrefix = subjectPrefix !== ''
    && testKeywords.some(function (k) { return prefixLower.indexOf(k) >= 0; });
  items.push(buildChecklistItem_(
    'MAIL_SUBJECT_PREFIX（電郵主旨前綴）',
    !looksLikeTestPrefix,
    subjectPrefix === '' ? '（空白，沒有前綴）' : subjectPrefix,
    looksLikeTestPrefix
      ? '目前的前綴「' + subjectPrefix + '」看起來像測試用途的字眼，正式上線前建議到 Config 檢查並清走，'
        + '避免收件人的電郵主旨出現「測試」一類字樣。'
      : (subjectPrefix === ''
        ? '沒有設定前綴，電郵主旨會直接使用範本原本的標題。'
        : '目前的前綴沒有偵測到明顯的測試字眼，正式上線前建議再親眼確認一次是否符合預期。')
  ));

  // 3. Web UI 三層防護（階段 D1 擴充：原本只顧 WEBAPP_ENABLED 一層，現在把
  // appsscript.json 的部署權限、WEBAPP_ENABLED、WEBAPP_ALLOWED_EMAILS 三層
  // 一次過列出，並附上這次程式碼稽核的結論——見 docs/系統範圍稽核.md 階段 D
  // 的完整說明。
  //
  // 第 1 層（appsscript.json 的 webapp.access）**沒有辦法在執行階段讀取**
  // ——Apps Script 沒有提供任何 API 讓程式碼在執行時讀到自己的部署清單設定，
  // 這裡只能顯示這次程式碼稽核當下的靜態事實，不是即時算出來的。
  // 第 2、3 層（WEBAPP_ENABLED／WEBAPP_ALLOWED_EMAILS）才是可以即時讀 Config 判斷的。
  //
  // 「有沒有任何路徑可以繞過」的稽核結論：逐一檢查 WebApp.gs／WebAppFlow.gs
  // 全部 24 個 api* 函式，**每一個的第一行都是 assertWebAppRequestAllowed_()**
  // （合併呼叫 assertWebAppEnabled_() 與 assertApiCallerAuthorized_()），
  // 沒有找到任何一個函式跳過這道檢查；doGet() 本身在渲染 ui/Index 之前
  // 也已經先做同樣兩項檢查，未通過只會回傳說明頁，不會渲染任何介面。
  // 這是程式碼審閱的結論，不是這裡執行時重新掃描一次原始碼——Apps Script
  // 沒有安全、通用的方式讓程式碼在執行階段讀取並解析自己的原始碼檔案。
  const webappEnabled = getConfig(CONFIG_KEYS.WEBAPP_ENABLED, false) === true;
  const allowedRaw = getConfig(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, []);
  const allowedList = (Array.isArray(allowedRaw) ? allowedRaw : []).filter(Boolean);
  const scriptAccount = String(getConfig(CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, '') || '').trim();
  let webappReady = true;
  let webappGuidance;
  if (webappEnabled) {
    if (allowedList.length === 0 && !scriptAccount) {
      webappReady = false;
      webappGuidance = '第 2 層（WEBAPP_ENABLED）已開啟，但第 3 層（WEBAPP_ALLOWED_EMAILS 與 '
        + 'SCRIPT_ACCOUNT_EMAIL）都是空白，等於沒有任何人能通過白名單——Web UI 實際上仍然'
        + '沒有人可以使用。建議至少設定其中一項。';
    } else {
      webappGuidance = '第 2 層（WEBAPP_ENABLED）已開啟。第 3 層允許名單：'
        + (allowedList.length > 0 ? allowedList.join('、') : '（空白，退回只允許 ' + scriptAccount + ' 一人）') + '。';
    }
  } else {
    webappGuidance = '第 2 層（WEBAPP_ENABLED）關閉，doGet() 只會顯示說明頁面，不會有任何人可以透過 '
      + 'Web UI 操作，第 3 層的白名單設定目前不生效。如果你打算開始使用 Web UI，記得到 Config 把 '
      + 'WEBAPP_ENABLED 改為 TRUE，並設定 WEBAPP_ALLOWED_EMAILS。';
  }
  items.push(buildChecklistItem_(
    'Web UI 三層防護（appsscript.json 部署權限／WEBAPP_ENABLED／WEBAPP_ALLOWED_EMAILS）',
    webappReady,
    '第 1 層（部署權限，本次程式碼稽核的靜態事實）：appsscript.json 的 webapp.access='
      + 'MYSELF（只有部署者本人能開啟網址，適合 Ivan 自己 deploy 自己用；日後交給幹事'
      + '操作時需要改成 DOMAIN，見 docs/系統範圍稽核.md）\n'
      + '　第 2 層：WEBAPP_ENABLED=' + (webappEnabled ? 'TRUE' : 'FALSE') + '\n'
      + '　第 3 層：WEBAPP_ALLOWED_EMAILS='
      + (allowedList.length > 0 ? allowedList.join('、') : '（空白）')
      + '　SCRIPT_ACCOUNT_EMAIL=' + (scriptAccount || '（空白）'),
    webappGuidance + '\n\n程式碼稽核結論：WebApp.gs／WebAppFlow.gs 全部 24 個 api* 函式'
      + '第一行都呼叫 assertWebAppRequestAllowed_()，doGet() 渲染介面前也做同樣檢查，'
      + '沒有發現任何繞過第 2、3 層的路徑。'
  ));

  // 4. 是否已安裝自動排程 trigger
  // 階段 C1 擴充：原本只講「裝了幾個」，現在補上「系統應該有的 trigger 長什麼樣」
  // （函式名、頻率、執行時間、時區），方便跟「目前實際存在的」直接對照，
  // 以及明確講清楚每日檢查涵蓋 GENERATE／REMIND，OFFICIAL 是刻意永遠不會由這裡
  // 觸發（見 Trigger.gs 的 assertOfficialNotFromAutomationTrigger_() 結構性防護）。
  const triggers = listAutomationTriggers_();
  const triggerSendHour = getConfig(CONFIG_KEYS.SEND_HOUR_LOCAL, null);
  const triggerTimezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const expectedTriggerDesc = '函式：' + AUTOMATION_TRIGGER_FUNCTION
    + '　頻率：每日一次　執行時間：' + (triggerSendHour === null || triggerSendHour === ''
      ? '（Config 的 SEND_HOUR_LOCAL 未設定，安裝時會退回預設 09:00）'
      : String(triggerSendHour) + ':00')
    + '　時區：' + triggerTimezone
    + '（Apps Script 只保證每 24 小時內於設定的小時觸發一次，不是精確到分鐘）';
  items.push(buildChecklistItem_(
    '自動排程 trigger 是否已安裝',
    true,
    (triggers.length === 0 ? '未安裝（0 個）' : '已安裝（' + triggers.length + ' 個）')
      + '　｜　系統應該有的樣子：' + expectedTriggerDesc,
    (triggers.length === 0
      ? '目前沒有安裝自動排程 trigger，四階段流程需要人手到選單逐步執行——這是安全的預設狀態。'
        + '如果你打算之後啟用自動排程，記得到「自動排程」子選單安裝。'
      : '已安裝 ' + triggers.length + ' 個自動排程 trigger，系統會在時間到達時自動檢查，並可能自動執行寄送。'
        + '請確認這是你有意啟用的狀態（可到「自動排程 ▸ 查看自動排程狀態」查看詳情）。')
      + ' 每日檢查只做兩件事：到期自動生成初稿（GENERATE，只通知幹事覆核）、'
      + '卡在 REVIEW_SENT 太久時提醒幹事（REMIND，同樣只通知幹事）。'
      + '正式發出（OFFICIAL）永遠不會由這裡觸發，一律要幹事在「步驟 4」手動執行——'
      + '這是結構性防護（assertOfficialNotFromAutomationTrigger_()），不是單純「這裡沒寫」。'
  ));

  // 5. 職事表上的人是否都在 NameMapping 有電郵、格式是否明顯有問題
  // 階段 G 追加格式檢查：只做最基本的「有沒有 @、@ 後面有沒有一個點」判斷，
  // 抓得到最明顯的打字錯誤（漏了 @、多打一個空格、忘記網域），不是完整的
  // Email 格式驗證——目的是在幹事按下「正式發出」之前主動抓到，而不是等
  // 真正寄送時才失敗、事後才在 SendLog 看到一筆「失敗」。
  const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const versionNo = findLatestVersionNo(quarterId);
  const peopleById = indexPeopleById_();
  let missingEmailPeople = [];
  let malformedEmailPeople = [];
  if (versionNo >= 0) {
    const seen = {};
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (row[COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] !== quarterId) return;
      if (Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) !== versionNo) return;
      const personId = row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID];
      if (!personId || seen[personId]) return;
      seen[personId] = true;
      const person = peopleById[personId];
      if (!person) {
        missingEmailPeople.push((row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT] || personId) + '（' + personId + '，NameMapping 找不到或已停用）');
      } else if (!person.email) {
        missingEmailPeople.push(person.nameTC + '（' + personId + '，沒有電郵）');
      } else if (!EMAIL_FORMAT_PATTERN.test(person.email)) {
        malformedEmailPeople.push(person.nameTC + '（' + personId + '，電郵「' + person.email + '」格式看起來有問題）');
      }
    });
  }
  const emailIssueCount = missingEmailPeople.length + malformedEmailPeople.length;
  items.push(buildChecklistItem_(
    '職事表上的人是否都在 NameMapping 有電郵、格式正常',
    versionNo >= 0 && emailIssueCount === 0,
    versionNo < 0
      ? '這一季還沒有生成任何版本，無法檢查'
      : (emailIssueCount === 0 ? '全部都有電郵、格式正常'
        : '缺電郵：' + missingEmailPeople.length + ' 人　格式可疑：' + malformedEmailPeople.length + ' 人'),
    versionNo < 0
      ? '請先執行「步驟 1：生成初稿」再回來檢查這一項。'
      : (emailIssueCount === 0
        ? '最新版本（v' + versionNo + '）上出現的所有人，都能在 NameMapping 找到、有電郵，格式也正常。'
        : '以下的人電郵有問題：沒有電郵的人寄信時會被記為「查無電郵略過」；格式可疑的人寄送時大機會'
          + '直接被 MailApp 拒絕、記為「失敗」，兩者都收不到通知，建議先到 NameMapping 修正：'),
    missingEmailPeople.concat(malformedEmailPeople)
  ));

  // 6. Eligibility 是否有明顯測試用的行
  const eligTestKeywords = ['test', '測試', 'demo', 'temp', 'sample'];
  const suspiciousEligibility = [];
  readSheet(SHEETS.ELIGIBILITY).forEach(function (row) {
    const personId = row[COLUMNS.ELIGIBILITY.PERSON_ID];
    const person = peopleById[personId];
    const haystack = (String(personId || '') + ' ' + String((person && person.nameTC) || '')).toLowerCase();
    if (eligTestKeywords.some(function (k) { return haystack.indexOf(k) >= 0; })) {
      suspiciousEligibility.push(
        (person ? person.nameTC : personId) + '（' + personId + '）× ' + row[COLUMNS.ELIGIBILITY.POST_ID]);
    }
  });
  items.push(buildChecklistItem_(
    'Eligibility 是否有明顯測試用的行',
    suspiciousEligibility.length === 0,
    suspiciousEligibility.length === 0 ? '沒有發現可疑的行' : '發現 ' + suspiciousEligibility.length + ' 行 PersonID／姓名含測試字眼',
    suspiciousEligibility.length === 0
      ? '沒有發現 PersonID 或姓名含「test／測試／demo」一類字眼的資格紀錄。'
      : '以下的資格紀錄，PersonID 或姓名含有測試字眼，建議確認是否為測試期間加入、應該在正式使用前刪除：',
    suspiciousEligibility
  ));

  // 7. Unavailable 是否有過期或語意不清的行
  const todayStr = toDateString(new Date(), timezone);
  const expiredUnavailable = [];
  const unclearUnavailable = [];
  readSheet(SHEETS.UNAVAILABLE).forEach(function (row) {
    const personId = row[COLUMNS.UNAVAILABLE.PERSON_ID];
    const dateFrom = toDateString(row[COLUMNS.UNAVAILABLE.DATE_FROM], timezone);
    const dateTo = toDateString(row[COLUMNS.UNAVAILABLE.DATE_TO], timezone);
    const statusRaw = row[COLUMNS.UNAVAILABLE.STATUS];
    const status = String(statusRaw || '').trim().toUpperCase();
    const appliesTo = String(row[COLUMNS.UNAVAILABLE.APPLIES_TO] || '').trim().toUpperCase();
    const postIds = String(row[COLUMNS.UNAVAILABLE.POST_IDS] || '').trim();
    const person = peopleById[personId];
    const who = (person ? person.nameTC : (personId || '（PersonID 空白）')) + (personId ? '（' + personId + '）' : '');

    const unclearReasons = [];
    if (!personId) unclearReasons.push('PersonID 空白');
    if (!dateFrom) unclearReasons.push('DateFrom 空白或無法辨識');
    if (dateFrom && dateTo && dateTo < dateFrom) unclearReasons.push('DateTo 早於 DateFrom');
    if (status && status !== UNAVAILABLE_VALUES.STATUS_ACTIVE) {
      unclearReasons.push('Status="' + statusRaw + '"，不是可辨識的值（只有 ACTIVE 會生效）');
    }
    if (appliesTo && appliesTo !== UNAVAILABLE_VALUES.APPLIES_TO_ALL && !postIds) {
      unclearReasons.push('AppliesTo 不是 ALL 但 PostIDs 空白');
    }
    if (unclearReasons.length > 0) unclearUnavailable.push(who + '：' + unclearReasons.join('；'));

    if (status === UNAVAILABLE_VALUES.STATUS_ACTIVE && dateFrom) {
      const effectiveEnd = dateTo || dateFrom;
      if (effectiveEnd < todayStr) expiredUnavailable.push(who + '：' + dateFrom + ' 至 ' + (dateTo || dateFrom));
    }
  });
  items.push(buildChecklistItem_(
    'Unavailable 是否有過期或語意不清的行',
    expiredUnavailable.length === 0 && unclearUnavailable.length === 0,
    '過期：' + expiredUnavailable.length + ' 行　語意不清：' + unclearUnavailable.length + ' 行',
    (expiredUnavailable.length === 0 && unclearUnavailable.length === 0)
      ? '沒有發現已過期（Status=ACTIVE 但日期範圍已完全過去）或語意不清（PersonID／日期空白、日期倒轉、'
        + 'Status 不是可辨識的值、AppliesTo 與 PostIDs 不一致）的行。'
      : '過期的行不影響排程正確性（已經過去的日期不會再被檢查），但建議整理，避免工作表越來越長不好維護；'
        + '語意不清的行建議盡快確認並修正，避免規則檢查漏判或誤判：',
    expiredUnavailable.map(function (s) { return '［過期］' + s; })
      .concat(unclearUnavailable.map(function (s) { return '［不清］' + s; }))
  ));

  // 8. 這一季是否有未處理的 Requests
  let pendingCount = 0;
  let pendingDetail = [];
  let requestsSheetMissing = false;
  try {
    const pending = readPendingRequests_(quarterId);
    pendingCount = pending.length;
    pendingDetail = pending.slice(0, 20).map(function (r) {
      return r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '（' + r.requestType + '）';
    });
    if (pending.length > 20) pendingDetail.push('……另有 ' + (pending.length - 20) + ' 筆');
    if (pending.skippedIncompleteCount > 0) {
      pendingDetail.push('（另有 ' + pending.skippedIncompleteCount + ' 行不完整申報，未計入以上數字）');
    }
  } catch (err) {
    requestsSheetMissing = true;
  }
  items.push(buildChecklistItem_(
    '這一季是否有未處理的 Requests',
    requestsSheetMissing || pendingCount === 0,
    requestsSheetMissing ? '找不到 Requests 工作表' : (pendingCount === 0 ? '沒有待處理的申報' : '待處理：' + pendingCount + ' 筆'),
    requestsSheetMissing
      ? '找不到 Requests 工作表，視為這一季沒有申報（如果你預期應該有 Requests 工作表，'
        + '可以到「維護 ▸ 建立 Requests 工作表」建立）。'
      : (pendingCount === 0
        ? '目前沒有待處理（PENDING）的申報。'
        : '以下的申報仍未套用，建議先執行「步驟 3：套用修改申報」處理完再正式發出：'),
    pendingDetail
  ));

  // 9. v0 是否仍受保護
  const v0Rows = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (row) {
    return row[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] === quarterId
      && Number(row[COLUMNS.ROSTER_VERSIONS.VERSION_NO]) === 0;
  });
  let v0Ready = false;
  let v0Value;
  let v0Guidance;
  if (v0Rows.length === 0) {
    v0Value = '找不到 v0';
    v0Guidance = '這一季還沒有 v0（初始生成的版本），請先執行「步驟 1：生成初稿」。';
  } else {
    const v0Protected = isTrueValue_(v0Rows[0][COLUMNS.ROSTER_VERSIONS.PROTECTED]);
    v0Ready = v0Protected;
    v0Value = v0Protected ? '已保護' : '未受保護';
    v0Guidance = v0Protected
      ? 'v0 工作表已受保護，一般編輯者無法直接改動它，可以放心作為原始基準。'
      : 'v0 工作表目前沒有受保護，任何有編輯權的人都可能不小心改動它，令「原始基準」失去意義。'
        + '可以到 Config 把 V0_PROTECT 設為 TRUE 之後重新生成初稿（新產生的 v0 會自動受保護），'
        + '或者直接在試算表右鍵 v0 分頁選「保護工作表」人手鎖定現有的 v0。';
  }
  items.push(buildChecklistItem_('v0 是否仍受保護', v0Ready, v0Value, v0Guidance));

  // 10. 最新版本是否仍有未解決的硬規則違反
  let hardViolations = [];
  let violationsError = null;
  if (versionNo >= 0) {
    try {
      hardViolations = recomputeLatestVersionViolations_(quarterId, versionNo)
        .filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
    } catch (err) {
      violationsError = err.message;
    }
  }
  items.push(buildChecklistItem_(
    '最新版本是否仍有未解決的硬規則違反',
    versionNo >= 0 && !violationsError && hardViolations.length === 0,
    versionNo < 0 ? '這一季還沒有生成任何版本' : (violationsError ? '檢查時失敗：' + violationsError : '硬規則違反：' + hardViolations.length + ' 項'),
    versionNo < 0
      ? '請先執行「步驟 1：生成初稿」再回來檢查這一項。'
      : (violationsError
        ? '重新檢查規則時發生錯誤，建議直接執行「步驟 3：套用修改申報」查看詳情。'
        : (hardViolations.length === 0
          ? '最新版本（v' + versionNo + '）目前沒有未解決的硬規則違反。'
          : '最新版本（v' + versionNo + '）仍有以下硬規則違反，正式發出前必須處理或明確放行：')),
    hardViolations.slice(0, 20).map(function (v) {
      return v.serviceDate + ' ' + v.postNameTC + '#' + v.slotIndex + ' ' + v.personName + ' ' + v.ruleId + '：' + v.reason;
    }).concat(hardViolations.length > 20 ? ['……另有 ' + (hardViolations.length - 20) + ' 項'] : [])
  ));

  // 11. 最新版本是否有「系統應該排但排不出」的格子（階段 C 新增）
  let genuineGapCells = [];
  let genuineGapError = null;
  if (versionNo >= 0) {
    try {
      genuineGapCells = scanGenuineGapCells_(quarterId, versionNo);
    } catch (err) {
      genuineGapError = err.message;
    }
  }
  items.push(buildChecklistItem_(
    '最新版本是否有系統應該排但排不出的格子',
    versionNo >= 0 && !genuineGapError && genuineGapCells.length === 0,
    versionNo < 0 ? '這一季還沒有生成任何版本' : (genuineGapError ? '檢查時失敗：' + genuineGapError : '排不出人的格子：' + genuineGapCells.length + ' 格'),
    versionNo < 0
      ? '請先執行「步驟 1：生成初稿」再回來檢查這一項。'
      : (genuineGapError
        ? '掃描 grid 工作表時發生錯誤，可能是最新版本的工作表找不到，建議直接打開試算表確認。'
        : (genuineGapCells.length === 0
          ? '最新版本（v' + versionNo + '）沒有「找不到合資格人選」這一類真正的問題（結構性不適用、'
            + '特別主日跳過、講員／翻譯這類本來就待人手填寫的格子不算在這裡，見步驟 1 生成初稿的完成訊息）。'
          : '最新版本（v' + versionNo + '）以下格子系統排不出人（不是講員／翻譯這類本來就待人手填的，'
            + '也不是結構性不適用），建議人手指派：')),
    genuineGapCells.slice(0, 20).map(function (c) { return c.serviceDate + ' ' + c.key + '：' + c.note; })
      .concat(genuineGapCells.length > 20 ? ['……另有 ' + (genuineGapCells.length - 20) + ' 格'] : [])
  ));

  // 12. 階段 B（第五輪批次）新增：全部季度的待處理 Requests 殘留＋矛盾組合（12、13 兩項都是「不限本次輸入季度」的全域檢查）
  // 提早偵測。跟其他項目不同，這一項**不限於你剛剛輸入的 quarterId**——
  // 掃描的是 Requests 全表，理由是「殘留申報最危險的地方就是幹事忘記自己
  // 還有別的季度沒處理完」，如果只顯示當下輸入那一季，反而看不到全貌。
  const pendingAcrossQuarters = scanPendingRequestsAllQuarters_();
  const officialSentWithPending = pendingAcrossQuarters.filter(function (r) { return r.isOfficialSentWithPending; });
  const totalConflicts = pendingAcrossQuarters.reduce(function (sum, r) { return sum + r.conflictCount; }, 0);
  items.push(buildChecklistItem_(
    '全部季度的待處理 Requests 殘留（不限本次輸入的季度）',
    officialSentWithPending.length === 0 && totalConflicts === 0,
    pendingAcrossQuarters.length === 0
      ? '沒有任何季度有待處理申報'
      : pendingAcrossQuarters.length + ' 個季度有待處理申報'
        + (officialSentWithPending.length > 0 ? '，其中 ' + officialSentWithPending.length + ' 個已經 OFFICIAL_SENT 仍有殘留' : '')
        + (totalConflicts > 0 ? '，共 ' + totalConflicts + ' 組矛盾組合（同一人同一日「不能服侍」＋「指定服侍」）' : ''),
    pendingAcrossQuarters.length === 0
      ? '目前沒有任何季度殘留未處理的申報。'
      : '待處理申報本身不一定是問題（可能只是還沒排到套用的時機），但兩種情況要特別注意：'
        + '(1) 季度已經 OFFICIAL_SENT 但仍有殘留——下次對該季度執行「步驟 5：改動後重發」時'
        + '會被撈起，如果是矛盾組合會直接判 NEEDS_INPUT，不會自動處理；'
        + '(2) 矛盾組合——同一人同一日同時有「不能服侍」與「指定服侍」，語意互相矛盾，'
        + '套用時兩筆都會被攔下、要求你自己澄清保留哪一筆，建議提早到 Requests 工作表'
        + '刪走其中一筆，不需要等到真正執行步驟 3／5 才處理。',
    pendingAcrossQuarters.map(function (r) {
      const flags = [];
      if (r.isOfficialSentWithPending) flags.push('⚠️ 已 OFFICIAL_SENT 仍有殘留');
      if (r.conflictCount > 0) flags.push('⚠️ ' + r.conflictCount + ' 組矛盾組合');
      return r.quarterId + '　Stage=' + r.stage + '　待處理=' + r.pendingCount + ' 筆'
        + (flags.length > 0 ? '　' + flags.join('　') : '');
    })
  ));

  // 13. 階段 C2 新增：EmailRecipients 每個 Active 收件人的 Role／Stage／
  // 實際會收到的階段——直接算好結論顯示，見 buildRecipientRoleStageMatrix_()
  // （EmailRecipientsSeed.gs）。純資訊性質，一律「已就緒」（沒有「錯誤狀態」
  // 這回事，只是把現況攤開來給你看，你自己判斷是否符合預期）。
  const roleMatrix = buildRecipientRoleStageMatrix_();
  const noEffectiveStages = roleMatrix.filter(function (r) { return r.effectiveStages.length === 0; });
  items.push(buildChecklistItem_(
    'EmailRecipients 每個收件人實際會收到的階段',
    true,
    roleMatrix.length + ' 個 Active 收件人'
      + (noEffectiveStages.length > 0 ? '，其中 ' + noEffectiveStages.length + ' 個目前不會收到任何階段的信' : ''),
    roleMatrix.length === 0
      ? 'EmailRecipients 目前沒有任何 Active=TRUE 的收件人。'
      : '以下逐行列出 Role、Stage 欄原始值、以及直接算好的「實際會收到哪些階段」'
        + '（REVIEW 只看 Role=REVIEWER，其餘階段只看 Stage 欄，兩者互不影響，'
        + 'detail 是「Role=X｜Stage=Y｜實際會收：Z」這個格式）。',
    roleMatrix.map(function (r) {
      return (r.displayName) + '（' + (r.recipientId || '無 ID') + '）　'
        + 'Role=' + r.role + '｜Stage=' + r.stageRaw + '｜實際會收：'
        + (r.effectiveStages.length > 0 ? r.effectiveStages.join('、') : '（不會收到任何階段的信）');
    })
  ));

  const readyCount = items.filter(function (it) { return it.ready; }).length;
  return {
    quarterId: quarterId,
    items: items,
    readyCount: readyCount,
    needsAttentionCount: items.length - readyCount,
    // 階段 C2 新增：DRY_RUN／MAIL_SUBJECT_PREFIX／WEBAPP_ENABLED／WEBAPP_ALLOWED_EMAILS
    // 四項各自的現況已經在上面的 items 逐項列出，這裡另外補一份「建議改動順序＋
    // 每一步風險」的綜合說明——四項各自獨立看都合理，但上線切換的順序本身也有風險
    // （例如：先開 DRY_RUN=FALSE 才設定 WEBAPP_ALLOWED_EMAILS，會有一段時間任何人
    // 都連不上 Web UI 卻已經在真實寄信），這是單看一項看不出來的。
    launchSequenceNotes: buildLaunchSequenceNotes_(dryRun, looksLikeTestPrefix, subjectPrefix, webappEnabled, webappReady)
  };
}

/**
 * 階段 C2 新增：把 DRY_RUN／MAIL_SUBJECT_PREFIX／WEBAPP_ENABLED／WEBAPP_ALLOWED_EMAILS
 * 綜合成一份建議的上線切換順序，附每一步的風險。純函式、不讀寫任何工作表——
 * 四個現值由呼叫端（buildPreLaunchChecklist_()）已經算好的值傳入，避免重複讀取。
 * @param {boolean} dryRun 目前 DRY_RUN 是否為 TRUE
 * @param {boolean} looksLikeTestPrefix MAIL_SUBJECT_PREFIX 是否像測試字眼
 * @param {string} subjectPrefix MAIL_SUBJECT_PREFIX 現值
 * @param {boolean} webappEnabled WEBAPP_ENABLED 是否為 TRUE
 * @param {boolean} webappReady WEBAPP_ENABLED 開啟時，白名單是否至少有一人能用
 * @returns {string[]} 建議順序，每一項已包含風險說明
 */
function buildLaunchSequenceNotes_(dryRun, looksLikeTestPrefix, subjectPrefix, webappEnabled, webappReady) {
  const notes = [];
  let step = 1;

  if (looksLikeTestPrefix) {
    notes.push('第 ' + (step++) + ' 步：先清走 MAIL_SUBJECT_PREFIX 的測試字眼「' + subjectPrefix + '」。'
      + '風險：低，只影響信件標題外觀，不影響任何收發邏輯，任何時候改都安全，'
      + '建議在還是 DRY_RUN=TRUE 的時候就先改好，不用等到最後一刻。');
  }

  if (webappEnabled && !webappReady) {
    notes.push('第 ' + (step++) + ' 步：WEBAPP_ENABLED 已經是 TRUE，但白名單目前沒有人能用，'
      + '請先設定 WEBAPP_ALLOWED_EMAILS（或確認 SCRIPT_ACCOUNT_EMAIL 有值）。'
      + '風險：低（Web UI 本身不寄信，只是操作介面），但如果你打算靠 Web UI 操作四階段流程，'
      + '這一步沒做完，屆時會沒有人能用介面。');
  } else if (!webappEnabled) {
    notes.push('第 ' + (step++) + ' 步（視你是否要用 Web UI 而定）：如果打算用 Web UI 操作，'
      + '先設定好 WEBAPP_ALLOWED_EMAILS，確認能連上、看得到正確的 Stage 之後，再把 WEBAPP_ENABLED 改成 TRUE。'
      + '風險：低，這兩格只控制「誰能用 Web UI 操作介面」，不影響選單操作，也不會自己寄信。');
  }

  notes.push('第 ' + (step++) + ' 步（最後一步，風險最高，建議放在最後）：確認以上都處理好、'
    + '也已經用 DRY_RUN=TRUE 完整測試過至少一次四階段流程之後，才把 DRY_RUN 改為 FALSE。'
    + '風險：高——這一步之後，「步驟 2」「步驟 4」「步驟 5」與自動排程的每一次寄送都會'
    + '真正寄出電郵，不能反悔已經寄出的那些封信。建議選一個非上線關鍵時期的季度先試跑一次'
    + '正式模式，確認無誤後才在真正要用的季度切換。'
    + (dryRun ? '' : '（目前 DRY_RUN 已經是 FALSE，這一步已完成。）'));

  return notes;
}

/**
 * 選單項目「維護 ▸ 上線前檢查（唯讀）」的執行入口。
 * 零寫入（除了跟其他「唯讀」工具一樣寫 Diagnostics）——不改動任何工作表、
 * 不產生版本、不寄電郵、不自動修正任何發現的問題。
 * @returns {void}
 */
function runPreLaunchChecklist_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('上線前檢查（唯讀）', '請輸入要檢查的 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  let result;
  try {
    result = buildPreLaunchChecklist_(quarterId);
  } catch (err) {
    log_('ERROR', 'runPreLaunchChecklist_ 失敗: ' + err.message);
    ui.alert('上線前檢查（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = [
    quarterId + '　共 ' + result.items.length + ' 項檢查，已就緒 ' + result.readyCount
      + ' 項，需要處理 ' + result.needsAttentionCount + ' 項：',
    ''
  ];
  const rows = [
    diagRow_('上線前檢查', '（季度）', quarterId, ''),
    diagRow_('上線前檢查', '總覽', '已就緒 ' + result.readyCount + '／需要處理 ' + result.needsAttentionCount, '')
  ];

  result.items.forEach(function (item) {
    lines.push((item.ready ? '✓ 已就緒' : '⚠ 需要處理') + '　' + item.label);
    lines.push('　目前狀態：' + item.value);
    lines.push('　' + item.guidance);
    item.details.slice(0, 20).forEach(function (d) { lines.push('　　- ' + d); });
    if (item.details.length > 20) lines.push('　　……另有 ' + (item.details.length - 20) + ' 項（見 Diagnostics 工作表）');
    lines.push('');

    rows.push(diagRow_(
      '上線前檢查', item.label,
      (item.ready ? '已就緒' : '需要處理') + '｜' + item.value,
      item.guidance
    ));
    item.details.forEach(function (d) {
      rows.push(diagRow_('上線前檢查', item.label + '　明細', '', d));
    });
  });

  if (result.launchSequenceNotes && result.launchSequenceNotes.length > 0) {
    lines.push('建議上線切換順序（DRY_RUN／MAIL_SUBJECT_PREFIX／WEBAPP_ENABLED／WEBAPP_ALLOWED_EMAILS）：', '');
    result.launchSequenceNotes.forEach(function (n) {
      lines.push(n);
      lines.push('');
      rows.push(diagRow_('上線前檢查', '建議上線切換順序', '', n));
    });
  } else {
    lines.push('目前的設定已經沒有明顯需要按順序處理的切換步驟。', '');
  }

  tryWriteDiagnostics_('上線前檢查', rows);
  lines.push(DIAGNOSTICS_WRITTEN_NOTE);
  ui.alert('上線前檢查（唯讀）－ ' + quarterId, lines.join('\n'), ui.ButtonSet.OK);
}
