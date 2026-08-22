/**
 * 階段 F（第五輪批次）新增：「維護 ▸ 🩺 全面體檢（唯讀）」。
 *
 * 背景（F1 盤點）：本專案累積了 17 個各自獨立的唯讀檢查／自我檢查選單項目
 * （上線前檢查、檢查設定、匯出關鍵狀態、PDF 內容自我檢查、電郵範本自我
 * 檢查、AuditLog 摘要、檢查設定、重新載入設定、檢查 Config 行數、檢查各版本
 * 派工紀錄、檢查個人 PDF 完整性、SOFT 規則與選人加權、欄標題對照、個人版
 * highlight 定位、查看自動排程狀態、檢查自動排程條件、列出待補格子），
 * 幹事要記得逐一點開才能看到全貌，容易漏掉。
 *
 * F2 評估結論：**部分可以整合，部分不適合勉強塞進來**——
 *
 * 這次整合進「全面體檢」的 9 項（全部不需要幹事另外輸入季度／版本，可以
 * 完全自動跑完）：
 *   1. 檢查設定（validateSetup()）
 *   2. 檢查 Config 行數（planConfigRowAudit_()）
 *   3. 檢查各版本派工紀錄（summariseAssignmentVersions_()，純資訊）
 *   4. 電郵範本自我檢查（buildEmailTemplateSelfCheckReport_()）
 *   5. AuditLog 摘要（buildAuditLogSummaryReport_()，純資訊）
 *   6. 查看自動排程狀態（純資訊）
 *   7. 檢查自動排程條件（buildAutomationCheckReport_()，純資訊）
 *   8. 全部季度的待處理 Requests 殘留＋矛盾組合（scanPendingRequestsAllQuarters_()，
 *      階段 B 新增）
 *   9. 上線前檢查（buildPreLaunchChecklist_()）——**唯一需要輸入的部分**，
 *      執行「全面體檢」時會先問一次「要一併檢查哪個季度？」（可留空跳過）。
 *
 * **刻意不整合**的 4 個工具，維持獨立選單項目（原因見各自小節）：
 *   - **PDF 內容自我檢查**／**檢查個人 PDF 完整性**／**列出待補格子**：都需要
 *     幹事明確指定「季度＋版本」才有意義，本質是「我已經知道要查哪一版，
 *     幫我核對細節」的除錯工具，不是「幫我巡查全系統有沒有問題」的健檢——
 *     如果要塞進全面體檢，等於要對每個季度的每個版本各跑一次，既沒有
 *     「一次過」的效果，也會讓報告長度暴增到失焦。
 *   - **SOFT 規則與選人加權**／**欄標題對照**／**個人版 highlight 定位**：
 *     這三個是開發除錯工具（給協助排查生成邏輯或版面問題時用），輸出的是
 *     原始參數與座標，沒有「正常／異常」這種可以分級的健康狀態，硬套上
 *     必須處理／建議處理／資訊三級分類沒有意義。
 *   - **匯出關鍵狀態**：本身已經是一個內容豐富、涵蓋 Quarters／RosterVersions／
 *     SendLog／Requests／RosterPDF／EmailRecipients／trigger／Config 的
 *     綜合報告，但它是「原始統計資料的完整匯出」，不是「health check」——
 *     大部分欄位沒有天然的「有沒有問題」語意（例如「RosterVersions 最新
 *     五個版本」單純是事實陳述，不是需要幹事處理的項目）。而且它會掃
 *     RosterPDF 整個 Drive 資料夾（真實 API 呼叫，有實際耗時），如果每次
 *     「全面體檢」都連帶跑一次，會讓這個工具變慢又浪費 API 配額，跟
 *     階段 E 剛修正的「不做不需要的查詢」精神衝突。維持獨立選單項目，
 *     全面體檢的結尾會提示「如需完整原始狀態明細，另外執行『匯出關鍵狀態』」。
 *
 * 全部 17 個既有選單項目**原封不動保留**——這個工具是額外多一個「一次過
 * 看全貌」的入口，不是取代任何一個。
 *
 * 跟其他「唯讀」工具一樣：只讀取，唯一的寫入是把統一報告寫進 Diagnostics
 * 的「全面體檢」分區（覆蓋上一次），不改動任何其他工作表、不產生版本、
 * 不寄電郵。
 */

/** 全面體檢三級嚴重度常數。 */
const HEALTH_SEVERITY = {
  MUST: '必須處理',
  SHOULD: '建議處理',
  INFO: '資訊'
};

/**
 * 建構單一健檢區塊的資料。純資料物件，不涉及 UI／工作表。
 * @param {string} section 區塊名稱（對應 Diagnostics 的 item 前綴）
 * @param {string} severity HEALTH_SEVERITY 三者之一
 * @param {string} label 這個區塊在報告中顯示的標題
 * @param {string} summary 一行摘要
 * @param {string} note 說明文字
 * @param {string[]=} details 詳細清單，可省略
 * @returns {Object}
 */
function healthItem_(section, severity, label, summary, note, details) {
  return { section: section, severity: severity, label: label, summary: summary, note: note, details: details || [] };
}

/**
 * 1. 檢查設定——純函式包裝，把既有 validateSetup() 的結果轉成健檢分級。
 * 有問題一律 MUST：這些是會直接影響核心功能（生成／寄送／規則判斷）的
 * 設定缺陷，不像上線前檢查裡有些項目「兩種狀態都可能是有意的選擇」。
 * @param {string[]} issues validateSetup() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifySetupHealth_(issues) {
  return healthItem_('檢查設定', issues.length > 0 ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.INFO,
    '基本設定檢查', issues.length + ' 個問題',
    issues.length === 0 ? '沒有發現問題。' : '以下設定問題會直接影響核心功能，建議優先處理：',
    issues.map(String));
}

/**
 * 2. Config 行數——空白 Key／重複 Key／CONFIG_KEYS 有但工作表無，都是資料
 * 整潔問題，不一定立即影響運作（例如重複 Key 時系統一律取最後一行的值，
 * 不會拋錯），所以分級為 SHOULD，不是 MUST。
 * @param {Object} audit planConfigRowAudit_() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifyConfigRowHealth_(audit) {
  const dupKeys = Object.keys(audit.duplicateKeys);
  const problems = audit.blankKeyRows.length + dupKeys.length + audit.missingFromSheet.length;
  const details = [];
  if (audit.blankKeyRows.length > 0) details.push('Key 完全空白的列：行號 ' + audit.blankKeyRows.join(', '));
  dupKeys.forEach(function (k) { details.push('重複 Key：' + k + '　行號 ' + audit.duplicateKeys[k].join(', ')); });
  if (audit.missingFromSheet.length > 0) {
    details.push('CONFIG_KEYS 已登記但工作表沒有這個 Key：' + audit.missingFromSheet.join('、')
      + '（可到「維護 ▸ 補建 Config 參數」補上）');
  }
  if (audit.extraInSheet.length > 0) {
    details.push('（僅供參考）工作表有但 CONFIG_KEYS 沒有登記：' + audit.extraInSheet.join('、'));
  }
  return healthItem_('Config 行數', problems > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO,
    'Config 工作表資料整潔度', problems + ' 項整潔問題',
    problems === 0 ? 'Config 工作表資料整潔，沒有空白 Key、重複 Key、或缺 Key。'
      : '以下是資料整潔問題（不一定立即影響運作，建議找時間清理）：',
    details);
}

/**
 * 2b. Config 值型別檢查（第三十二輪批次階段 A4 新增）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢一節
 * ─────────────────────────────────────────────────────────────────────
 *
 * 階段 A1 令 `convertConfigValue_()` 認唔出就拋錯。但拋錯**只喺嗰個
 * 功能真係被叫到嗰陣**先出現——即係幹事可能喺 12 月 4 日撳「正式發出」
 * 嗰一刻先發現 `DRY_RUN` 嗰格壞咗。
 *
 * 呢一節就係要喺上線之前，一次過見晒全部問題。
 *
 * ⚠️ **分級刻意唔一致**：`BOOL` 出事一律 MUST，其餘 SHOULD。
 * 因為 `DRY_RUN` 係 BOOL，而佢壞咗嘅後果（真係寄信）同其他參數
 * 唔係同一個量級。
 *
 * @param {Object[]} rows Config 工作表的原始列（`readSheet(SHEETS.CONFIG)`）
 * @returns {Object} healthItem_() 的結果
 */
function classifyConfigValueTypeHealth_(rows) {
  const results = auditConfigValueTypes_(rows);
  const bad = results.problems;
  const hasBool = bad.some(function (p) { return p.type === CONFIG_TYPES.BOOL; });

  if (bad.length === 0) {
    return healthItem_('Config 值型別', HEALTH_SEVERITY.INFO, 'Config 值型別檢查',
      results.checked + ' 個參數全部正常',
      '每個參數都照它宣告的型別試轉了一次，全部認得出來。', []);
  }

  const details = bad.map(function (p) {
    return p.key + '（' + p.type + '）：讀到「' + p.rawText + '」\n'
      + '　　修法：Config 工作表選中這一格 ▸ 格式 ▸ 數字 ▸ 純文字 ▸ 重新輸入一次'
      + (p.type === CONFIG_TYPES.BOOL
        ? '\n　　⚠️ 這是 BOOL。DRY_RUN 也是 BOOL——BOOL 認不出時舊版會靜靜當成 FALSE，'
          + '而 DRY_RUN=FALSE 代表信會真的寄出去。'
        : '');
  });

  return healthItem_('Config 值型別',
    hasBool ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.SHOULD,
    'Config 值型別檢查', bad.length + ' 個參數的值認不出來',
    hasBool
      ? '⚠️ 其中有 BOOL 型別的參數。BOOL 控制的是開關（例如 DRY_RUN 決定信會不會'
        + '真的寄出去），必須先處理再做任何寄送動作。'
      : '以下參數的值認不出來，它們設定的東西目前沒有生效（系統會用程式碼的預設值）：',
    details);
}

/**
 * 逐個 Config 參數試轉一次型，回報邊啲會拋錯。**純函式**，可離線測。
 *
 * ⚠️ 特登唔用 `readConfig()`——嗰邊會把失敗變成 marker 然後快取。
 * 呢度要見到「試轉」嘅原始結果，而且要連原值一齊報返出嚟。
 *
 * @param {Object[]} rows `readSheet(SHEETS.CONFIG)` 的結果
 * @returns {{checked: number, problems: Object[]}}
 */
function auditConfigValueTypes_(rows) {
  const C = COLUMNS.CONFIG;
  const problems = [];
  let checked = 0;

  (rows || []).forEach(function (row) {
    const key = row[C.KEY];
    if (!key) return;
    checked++;
    const raw = row[C.VALUE];
    try {
      convertConfigValue_(raw, row[C.TYPE], key);
    } catch (err) {
      problems.push({
        key: String(key),
        type: String(row[C.TYPE]),
        // ⚠️ 原值要逐字報返出嚟。淨係講「認不出」，幹事望住個格
        // 見到「10:45」會完全唔明發生咩事。
        rawText: (raw === null || raw === undefined) ? '（空白）' : String(raw),
        message: err.message
      });
    }
  });
  return { checked: checked, problems: problems };
}

/**
 * 3. 各版本派工紀錄——純資訊，沒有「異常」的判斷標準（哪個版本該有幾多行
 * 完全視實際排班情況而定，無法憑空判斷合理與否），一律 INFO。
 * @param {Object} result summariseAssignmentVersions_() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifyAssignmentVersionsHealth_(result) {
  return healthItem_('各版本派工紀錄', HEALTH_SEVERITY.INFO,
    'RosterAssignments 各版本統計', result.totalRows + ' 行，' + result.groups.length + ' 個版本',
    '純資訊，供核對「哪個版本有多少派工紀錄」使用：',
    result.groups.map(function (g) {
      return g.quarterId + ' v' + g.versionNo + '　共 ' + g.rowCount + ' 行　有派人 ' + g.assignedCount
        + ' 行　涉及 ' + g.personCount + ' 人';
    }));
}

/**
 * 4. 電郵範本自我檢查——有變數沒真的代入（unresolvedAfterRender）是最嚴重
 * 的問題（收件人會直接看到未代入的花括號文字），只有 Active=TRUE 的範本
 * 才升級為 MUST（未啟用的範本目前不會被任何流程使用，先降為 SHOULD）；
 * 兩個內容都空白、主旨疑似測試字眼，一律 SHOULD（會寄出空白信或帶測試
 * 字眼的信，但不像未代入變數那樣「絕對錯誤」，也可能是幹事還沒填完）。
 * @param {Object[]} results buildEmailTemplateSelfCheckReport_() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifyEmailTemplatesHealth_(results) {
  const details = [];
  let mustCount = 0, shouldCount = 0;
  results.forEach(function (r) {
    const problems = [];
    if (r.unresolvedAfterRender.length > 0) {
      problems.push('有變數沒有真的代入：' + r.unresolvedAfterRender.join('、'));
      if (r.active) mustCount++; else shouldCount++;
    }
    if (r.bothBodiesEmpty) {
      problems.push('BodyHtml／BodyPlain 都是空白');
      shouldCount++;
    }
    if (r.looksLikeTestSubject) {
      problems.push('完整主旨含測試字眼');
      shouldCount++;
    }
    if (problems.length > 0) {
      details.push(r.templateId + '（' + r.stage + '／' + (r.active ? 'Active' : '未啟用') + '）：' + problems.join('；'));
    }
  });
  const severity = mustCount > 0 ? HEALTH_SEVERITY.MUST : (shouldCount > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO);
  return healthItem_('電郵範本自我檢查', severity,
    'EmailTemplates 逐一自我檢查', results.length + ' 個範本，' + details.length + ' 個有問題',
    details.length === 0 ? '全部範本代入後都沒有殘留未代入的變數，內容不是空白，主旨也沒有測試字眼。'
      : '以下範本自我檢查發現問題：',
    details);
}

/**
 * 5. AuditLog 摘要——純資訊統計，沒有「異常」的判斷標準。
 * @param {Object} report buildAuditLogSummaryReport_() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifyAuditLogHealth_(report) {
  const topActions = Object.keys(report.byAction).sort(function (a, b) { return report.byAction[b] - report.byAction[a]; });
  return healthItem_('AuditLog 摘要', HEALTH_SEVERITY.INFO,
    '最近操作紀錄統計', 'AuditLog 共 ' + report.totalRows + ' 筆，統計最近 ' + report.sampledRows + ' 筆',
    '純資訊，按事件類型統計（如需逐筆明細，另外執行「AuditLog 摘要」）：',
    topActions.map(function (a) { return a + '：' + report.byAction[a] + ' 筆'; }));
}

/**
 * 8. 全部季度的待處理 Requests 殘留＋矛盾組合——重用階段 B 新增的
 * scanPendingRequestsAllQuarters_()，跟 PreLaunchChecklist 第 12 項用的
 * 是同一份邏輯。矛盾組合或「已 OFFICIAL_SENT 仍有殘留」都是會被下一次
 * 流程動作直接卡住或需要人手澄清的情況，升級為 MUST；單純待處理（還沒
 * 排到套用時機）只是提醒，SHOULD。
 * @param {Object[]} pendingAcrossQuarters scanPendingRequestsAllQuarters_() 的回傳值
 * @returns {Object} healthItem_() 的結果
 */
function classifyRequestsHealth_(pendingAcrossQuarters) {
  const officialSentWithPending = pendingAcrossQuarters.filter(function (r) { return r.isOfficialSentWithPending; });
  const totalConflicts = pendingAcrossQuarters.reduce(function (sum, r) { return sum + r.conflictCount; }, 0);
  const severity = (officialSentWithPending.length > 0 || totalConflicts > 0) ? HEALTH_SEVERITY.MUST
    : (pendingAcrossQuarters.length > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO);
  return healthItem_('Requests 殘留', severity,
    '全部季度的待處理 Requests 殘留（不限本次輸入的季度）',
    pendingAcrossQuarters.length === 0 ? '沒有任何季度有待處理申報'
      : pendingAcrossQuarters.length + ' 個季度有待處理申報',
    pendingAcrossQuarters.length === 0 ? '目前沒有任何季度殘留未處理的申報。'
      : '待處理申報本身不一定是問題，但已 OFFICIAL_SENT 仍有殘留、或同一人同日矛盾組合'
        + '（不能服侍＋指定服侍）這兩種情況會在下一次相關流程被卡住，建議優先處理：',
    pendingAcrossQuarters.map(function (r) {
      const flags = [];
      if (r.isOfficialSentWithPending) flags.push('⚠️ 已 OFFICIAL_SENT 仍有殘留');
      if (r.conflictCount > 0) flags.push('⚠️ ' + r.conflictCount + ' 組矛盾組合');
      return r.quarterId + '　Stage=' + r.stage + '　待處理=' + r.pendingCount + ' 筆'
        + (flags.length > 0 ? '　' + flags.join('　') : '');
    }));
}

/**
 * 階段 B（Opus 深度輪）新增：三張只增不減的大表的規模提示。
 *
 * 這是歸檔設計「方向三」的實作（見 Archive.gs 檔頭）：**提早提醒，不是
 * 超過就會壞**。行數超過門檻只代表「值得規劃封存了」，功能本身仍然正常。
 * 一律 SHOULD／INFO，永遠不會是 MUST——資料多本身不是錯誤。
 *
 * @param {Object.<string, number>} rowCounts {表名: 行數}
 * @returns {Object} healthItem_() 的結果
 */
function classifyTableSizeHealth_(rowCounts) {
  const checks = [
    { name: SHEETS.SEND_LOG, rows: rowCounts[SHEETS.SEND_LOG], limit: ARCHIVE_SIZE_HINT_ROWS.SEND_LOG },
    { name: SHEETS.ROSTER_ASSIGNMENTS, rows: rowCounts[SHEETS.ROSTER_ASSIGNMENTS], limit: ARCHIVE_SIZE_HINT_ROWS.ROSTER_ASSIGNMENTS },
    { name: SHEETS.AUDIT_LOG, rows: rowCounts[SHEETS.AUDIT_LOG], limit: ARCHIVE_SIZE_HINT_ROWS.AUDIT_LOG }
  ];
  const over = checks.filter(function (c) { return c.rows >= c.limit; });
  const details = checks.map(function (c) {
    return c.name + '：' + c.rows + ' 行（提示門檻 ' + c.limit + '）'
      + (c.rows >= c.limit ? '　⚠️ 建議規劃封存' : '');
  });

  return healthItem_('資料表規模', over.length > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO,
    '只增不減的大表行數', over.length === 0 ? '全部未達提示門檻' : over.length + ' 張表已達提示門檻',
    over.length === 0
      ? '這幾張表只增不減，每次讀取都是整表讀取。目前規模仍然很輕鬆，不需要做任何事。'
      : '這幾張表已經大到值得規劃封存。功能目前仍然正常，不是錯誤——'
        + '可以執行「維護 ▸ 封存舊季度資料（唯讀預覽）」看看有沒有季度符合封存資格。'
        + '封存是搬移不是刪除，詳見 docs/系統範圍稽核.md。',
    details);
}

/** 上線前檢查裡「不就緒」時無條件升級為 MUST 的項目標籤（子字串比對）。 */
const HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS = [
  '最新版本是否仍有未解決的硬規則違反',
  // ⚠️ 第四十三輪批次 I 組：**這一項一定要是紅色。**
  //
  // 第四十二輪核實的時候發現它只是黃色（SHOULD）——因為這份清單
  // 當時只有一項。而它比大部分項都嚴重：留著一個轉寄地址上線，
  // 幹事撳「正式發出」，系統報告「已寄出 51 封」、SendLog 全部成功，
  // 而全體義工一封都收不到——五十一封全部去了同一個測試信箱。
  //
  // 「看起來完全成功而實際上全錯」正正是要用紅色擋住的那一種。
  'MAIL_REDIRECT_ALL_TO'
];

/** 上線前檢查裡本質是「全域統計」而非「這一季特有」，全面體檢已有獨立區塊涵蓋，故排除避免重複。 */
const HEALTH_PRELAUNCH_EXCLUDE_LABEL_SUBSTRINGS = [
  '全部季度的待處理 Requests 殘留', // 全面體檢已有獨立的 Requests 殘留區塊，同一份邏輯不重複顯示
  'EmailRecipients 每個收件人' // 純資訊、恆為就緒，沒有分級意義，需要時直接看上線前檢查本身
];

/**
 * 9. 上線前檢查——重用既有 buildPreLaunchChecklist_(quarterId) 的結果，
 * 但不能盲目把全部「不就緒」項目都當成 MUST：例如「DRY_RUN 是否仍在模擬
 * 模式」這一項，`ready=false` 代表的是「還在安全的測試模式」，對一個
 * 仍在測試階段的系統來說完全正常，不是缺陷——上線前檢查本身的文字說明
 * 也明確講了「這一項兩種狀態都可能是幹事有意的選擇」。所以這裡採用白名單
 * 升級：只有 HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS 命中的項目才算 MUST，
 * 其餘「不就緒」一律 SHOULD（維持上線前檢查自己「需要處理」的判斷，但
 * 不武斷放大成必須馬上處理）。
 * @param {Object} checklistResult buildPreLaunchChecklist_(quarterId) 的回傳值
 * @returns {Object[]} healthItem_() 的結果陣列（每個不就緒項目各一個，已排除全域重複項目）
 */
function classifyPreLaunchChecklistHealth_(checklistResult) {
  const items = checklistResult.items.filter(function (it) {
    return !HEALTH_PRELAUNCH_EXCLUDE_LABEL_SUBSTRINGS.some(function (sub) { return it.label.indexOf(sub) !== -1; });
  });
  const notReady = items.filter(function (it) { return !it.ready; });
  const results = notReady.map(function (it) {
    const isMust = HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS.some(function (sub) { return it.label.indexOf(sub) !== -1; });
    return healthItem_('上線前檢查', isMust ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.SHOULD,
      it.label, it.value, it.guidance, it.details);
  });
  if (results.length === 0) {
    results.push(healthItem_('上線前檢查', HEALTH_SEVERITY.INFO,
      checklistResult.quarterId + ' 上線前檢查',
      '共 ' + items.length + ' 項（已排除全域重複項目），全部已就緒', '沒有需要處理的項目。', []));
  }
  return results;
}

/**
 * 全面體檢的核心邏輯：依序執行 9 個可自動化的唯讀檢查（見檔頭說明），
 * 每個檢查各自 try/catch，單一檢查失敗不影響其餘檢查繼續執行（失敗的
 * 那一項直接列為 MUST：「執行失敗」）。純讀取，不改動任何工作表。
 * @param {string=} quarterId 選填，要一併執行「上線前檢查」的季度；留空則跳過該項
 * @returns {{sections: Object[], mustCount: number, shouldCount: number, infoCount: number,
 *   skippedPreLaunch: boolean}}
 */
function buildFullHealthCheckReport_(quarterId) {
  const sections = [];

  function run(fn) {
    try {
      sections.push(fn());
    } catch (err) {
      sections.push(healthItem_('（執行失敗）', HEALTH_SEVERITY.MUST, fn.name || '未知檢查', '執行失敗', err.message, []));
    }
  }

  run(function () { return classifySetupHealth_(validateSetup()); });
  run(function () { return classifyConfigRowHealth_(planConfigRowAudit_()); });
  run(function () { return classifyConfigValueTypeHealth_(readSheet(SHEETS.CONFIG)); });
  run(function () { return classifyAssignmentVersionsHealth_(summariseAssignmentVersions_()); });
  run(function () { return classifyEmailTemplatesHealth_(buildEmailTemplateSelfCheckReport_()); });
  run(function () { return classifyAuditLogHealth_(buildAuditLogSummaryReport_(200)); });
  run(function () {
    const triggers = listAutomationTriggers_();
    return healthItem_('自動排程狀態', HEALTH_SEVERITY.INFO, '自動排程 trigger 現況',
      triggers.length === 0 ? '未安裝（0 個）' : '已安裝（' + triggers.length + ' 個）',
      '純資訊（如需逐季判斷細節，另外執行「查看自動排程狀態」）。', []);
  });
  run(function () {
    const report = buildAutomationCheckReport_();
    return healthItem_('自動排程條件', HEALTH_SEVERITY.INFO, '若現在執行自動排程檢查會發生什麼',
      '見備註', report.lines.join('\n'), []);
  });
  run(function () { return classifyRequestsHealth_(scanPendingRequestsAllQuarters_()); });
  // 第四十九輪批次 第 3 層：不變量。
  //
  // ⚠️ 有輸入季度先驗得到 I02／I08／I09／I10（嗰四條要對住一季）。
  // 冇輸入嘅話仍然會跑其餘五條，並且喺報告入面明講「跳過咗邊幾條」——
  // 唔可以靜靜少驗四條而個報告睇落一樣係「全部通過」。
  run(function () { return classifyInvariantsHealth_(runAllInvariants_(quarterId)); });
  run(function () {
    const counts = {};
    counts[SHEETS.SEND_LOG] = readSheet(SHEETS.SEND_LOG).length;
    counts[SHEETS.ROSTER_ASSIGNMENTS] = readSheet(SHEETS.ROSTER_ASSIGNMENTS).length;
    counts[SHEETS.AUDIT_LOG] = readSheet(SHEETS.AUDIT_LOG).length;
    return classifyTableSizeHealth_(counts);
  });

  let skippedPreLaunch = true;
  if (quarterId) {
    skippedPreLaunch = false;
    try {
      classifyPreLaunchChecklistHealth_(buildPreLaunchChecklist_(quarterId)).forEach(function (r) { sections.push(r); });
    } catch (err) {
      sections.push(healthItem_('（執行失敗）', HEALTH_SEVERITY.MUST, '上線前檢查（' + quarterId + '）', '執行失敗', err.message, []));
    }
  }

  const mustCount = sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.MUST; }).length;
  const shouldCount = sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.SHOULD; }).length;
  const infoCount = sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.INFO; }).length;

  return { sections: sections, mustCount: mustCount, shouldCount: shouldCount, infoCount: infoCount, skippedPreLaunch: skippedPreLaunch };
}

/**
 * 選單項目「維護 ▸ 🩺 全面體檢（唯讀）」的執行入口。
 * 先問一次「要一併檢查哪個季度的上線前檢查？」（可留空跳過），然後跑完
 * 全部 9 項可自動化檢查，按嚴重度分組顯示，並寫入 Diagnostics 的
 * 「全面體檢」分區（覆蓋上一次）。
 * @returns {void}
 */
function runFullHealthCheck_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('🩺 全面體檢（唯讀）',
    '要一併執行「上線前檢查」的季度是？（例如 2027T1，留空則跳過這一項，'
      + '其餘 8 項全域檢查照常執行）', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());

  SpreadsheetApp.getActiveSpreadsheet().toast('體檢中，請稍候…', '全面體檢', 60);

  let report;
  try {
    report = buildFullHealthCheckReport_(quarterId || null);
  } catch (err) {
    log_('ERROR', 'runFullHealthCheck_ 失敗: ' + err.message);
    ui.alert('🩺 全面體檢（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const bySeverity = {};
  bySeverity[HEALTH_SEVERITY.MUST] = report.sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.MUST; });
  bySeverity[HEALTH_SEVERITY.SHOULD] = report.sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.SHOULD; });
  bySeverity[HEALTH_SEVERITY.INFO] = report.sections.filter(function (s) { return s.severity === HEALTH_SEVERITY.INFO; });

  const lines = [
    // 階段 B（Opus 深度輪）新增「資料表規模」一項，基數由 8／9 改為 9／10
    '共檢查 ' + (quarterId ? 10 : 9) + ' 大項'
      + (report.skippedPreLaunch ? '（已跳過上線前檢查，未輸入季度）' : '（含 ' + quarterId + ' 的上線前檢查）') + '：',
    '　🔴 必須處理：' + report.mustCount + ' 項　🟡 建議處理：' + report.shouldCount + ' 項　⚪ 資訊：' + report.infoCount + ' 項',
    ''
  ];
  const rows = [
    diagRow_('全面體檢', '總覽', '必須處理 ' + report.mustCount + '／建議處理 ' + report.shouldCount + '／資訊 ' + report.infoCount, '')
  ];

  [HEALTH_SEVERITY.MUST, HEALTH_SEVERITY.SHOULD, HEALTH_SEVERITY.INFO].forEach(function (sev) {
    const icon = sev === HEALTH_SEVERITY.MUST ? '🔴' : (sev === HEALTH_SEVERITY.SHOULD ? '🟡' : '⚪');
    lines.push('=== ' + icon + ' ' + sev + ' ===');
    if (bySeverity[sev].length === 0) lines.push('（沒有）');
    bySeverity[sev].forEach(function (item) {
      lines.push(item.section + '　' + item.label + '：' + item.summary);
      if (item.note) lines.push('　' + item.note);
      item.details.slice(0, 10).forEach(function (d) { lines.push('　　- ' + d); });
      if (item.details.length > 10) lines.push('　　……另有 ' + (item.details.length - 10) + ' 項（見 Diagnostics）');
      lines.push('');

      rows.push(diagRow_('全面體檢', sev + '｜' + item.section + '｜' + item.label, item.summary, item.note));
      item.details.forEach(function (d) {
        rows.push(diagRow_('全面體檢', sev + '｜' + item.section + '｜' + item.label + '　明細', '', d));
      });
    });
  });

  if (!quarterId) {
    lines.push('（未輸入季度，已跳過「上線前檢查」——需要時可單獨執行「維護 ▸ 上線前檢查（唯讀）」）', '');
  }
  lines.push('如需更完整的原始狀態明細，另外執行「查看 ▸ 匯出關鍵狀態 → Diagnostics」。');

  tryWriteDiagnostics_('全面體檢', rows);
  lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

  ui.alert('🩺 全面體檢（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}
