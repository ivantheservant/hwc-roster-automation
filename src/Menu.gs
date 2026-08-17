/**
 * 試算表開啟時自動執行，加入「職事表系統」自訂選單。
 * @returns {void}
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('職事表系統')
    .addSubMenu(
      ui.createMenu('四階段流程')
        .addItem('⚠️ 步驟 1：生成初稿', 'runFourStageStep1_')
        .addItem('⚠️ 步驟 2：寄給堂委審閱', 'runFourStageStep2_')
        .addItem('⚠️ 步驟 3：套用修改申報', 'runFourStageStep3_')
        .addItem('⚠️ 步驟 4：正式發出', 'runFourStageStep4_')
        .addItem('⚠️ 步驟 5：改動後重發', 'runFourStageStep5_')
        .addSeparator()
        // 階段 C（Opus 深度輪）新增：步驟 2／4 寄到一半中斷之後的補救工具。
        .addItem('補寄未收到的人（唯讀預覽）', 'runMakeupSendPlan_')
        .addItem('⚠️ 執行補寄未收到的人', 'runMakeupSendExecute_')
    )
    .addSubMenu(
      // 查看 ▸：不會改動任何職事表資料、不會產生版本、不會寄電郵。
      // 階段 A 起，部分工具會把報告同時寫入 Diagnostics 工作表（只寫這一張），
      // 方便用 Google Drive connector 一次過讀到系統狀態，不必逐張截圖——
      // 所以子選單標題由「查看」改為「查看（唯讀，只寫 Diagnostics）」，
      // 避免幹事誤會這裡的工具完全不寫入任何東西。
      // 自動排程狀態原本也在這裡，Stage H 移到獨立的「自動排程」子選單。
      ui.createMenu('查看（唯讀，只寫 Diagnostics）')
        .addItem('匯出關鍵狀態 → Diagnostics', 'runExportKeyState_')
        .addSeparator()
        .addItem('預覽電郵範本（唯讀）', 'runPreviewEmailTemplate_')
        .addItem('列出待補格子（唯讀）', 'runListPendingBackfillCells_')
        .addItem('PDF 內容自我檢查（唯讀）', 'runPdfContentSelfCheck_')
        .addItem('電郵範本自我檢查（唯讀）', 'runEmailTemplateSelfCheck_')
        .addItem('AuditLog 摘要（唯讀）', 'runAuditLogSummary_')
        .addItem('檢查設定（唯讀）', 'runValidateSetup_')
        .addItem('重新載入設定（唯讀）', 'runReloadConfig_')
        .addItem('檢查 Config 行數（唯讀）', 'runCheckConfigRowCount_')
        .addItem('檢查各版本派工紀錄（唯讀）', 'runCheckAssignmentVersions_')
        .addItem('檢查個人 PDF 完整性（唯讀）', 'runCheckPersonalPdfIntegrity_')
        .addItem('草稿覆核報告（唯讀，給堂委看）', 'runDraftReviewReport_')
        .addItem('軟規則實測量度（唯讀）', 'runSoftRuleMetrics_')
        .addItem('試算不同 epsilon 的效果（唯讀）', 'runEpsilonTrial_Menu_')
        .addItem('上線狀態（唯讀）', 'runGoLiveStatus_')
        .addItem('公開連結狀態（唯讀）', 'runCheckPublicLinks_')
        .addItem('身分名單概況（唯讀）', 'runRoleOverview_')
        .addItem('身分規則影響預估（唯讀）', 'runRoleImpactForecast_')
        .addItem('SOFT 規則與選人加權（唯讀）', 'runDebugSoftRules_')
        .addItem('欄標題對照（唯讀）', 'runDebugGridHeaders_')
        .addItem('個人版 highlight 定位（唯讀）', 'runDebugPersonalHighlight_')
        .addItem('設定回復檢查（唯讀）', 'runConfigBaselineCheck_')
    )
    .addSubMenu(
      // ⚠️ 標記重新分級（Stage G）：只有 (a) 會寄出電郵、(b) 會不可復原地刪除資料／
      // 檔案、(c) 會改變流程 Stage 或產生新版本工作表 這三種才加 ⚠️，其餘一律不加，
      // 理由詳見每個函式的判定，逐項列在 HANDOFF.md「追加階段 W」。
      ui.createMenu('準備工作')
        .addItem('⚠️ 新增季度', 'runNewQuarterWizard_')
        .addItem('⚠️ 計算季度日期', 'runComputeQuarterDates_')
        .addItem('⚠️ 產生下一年度四個季度（確認後寫入）', 'runAnnualQuartersWizard_')
        .addItem('⚠️ 產生年度合堂建議', 'runAnnualCombinedWizard_')
        .addItem('填寫講員／翻譯／獻花', 'runOpenPreacherTranslationFill_')
        .addSeparator()
        .addItem('⚠️ 生成職事表', 'runGenerateRoster_')
        .addItem('匯出 PDF', 'runExportPdf_')
        .addItem('產生個人 PDF', 'runGeneratePersonalPdfBatch_')
        .addItem('⚠️ 發佈公開職事表（一季一條固定連結）', 'runPublishPublicRoster_')
        .addSeparator()
        .addItem('檢查改動', 'runDetectChanges_')
        .addItem('⚠️ 套用決定', 'runApplyDecisions_')
        // 第十九輪批次階段 A2／C3：幹事直接喺 grid 改人名之後嘅合法出口。
        // 唔受 Stage 限制——Stage 鎖死嗰陣（例如已 OFFICIAL_SENT）一樣用得，
        // 因為佢淨係開新版本、唔會前進 Stage、唔會寄任何嘢。
        .addItem('人手改動預覽（唯讀）', 'runManualEditsPreview_')
        // 第十九輪批次階段 D1：答「點解步驟 5 又要重做全部個人 PDF」——
        // 列出資料夾入面每個版本號各有幾多份，一眼睇得出係咪版本號唔同。
        .addItem('個人 PDF 版本分佈（唯讀）', 'runDiagnosePersonalPdfVersions_')
        .addItem('⚠️ 把工作表的人手改動寫成新版本', 'runMaterialiseManualEdits_')
        .addSeparator()
        .addItem('從 HWCAS 取電郵（產生初稿）', 'runHwcasSync_')
        .addItem('套用 HWCAS 初稿', 'runApplyHwcasDraft_')
    )
    .addSubMenu(
      ui.createMenu('維護')
        .addItem('補建 Config 參數', 'runSeedConfigKeys_')
        .addItem('補建 Posts 欄位', 'runSeedPostEmptyDisplay_')
        .addItem('補建 Posts 欄位（提早到場分鐘數）', 'runSeedPostEarlyArrivalMinutes_')
        .addItem('補建 Posts 欄位（崗位身分要求）', 'runSeedPostRequiredRoles_')
        .addItem('補建身分名單工作表', 'runEnsureRoleSheets_')
        .addItem('補建 Quarters 欄位', 'runSeedQuartersStage_')
        .addItem('補建 SpecialSundays 工作表', 'runEnsureSpecialSundaysSheet_')
        .addItem('建立 Requests 工作表', 'runCreateRequestsSheet_')
        .addItem('⚠️ 清理 Requests 手改痕跡', 'runCleanRequestsTampering_')
        .addItem('重設 Requests 驗證規則', 'runResetRequestsValidations_')
        .addItem('補建 EmailRecipients 欄位', 'runSeedEmailRecipientsRole_')
        .addItem('補齊 Email 範本', 'runSeedEmailTemplates_')
        .addItem('補建 NameMapping 欄位（個人專屬連結 token）', 'runEnsureNameMappingTokenColumn_')
        .addItem('補發個人專屬連結 token', 'runSeedPersonalLinkTokens_')
        .addItem('⚠️ 重新產生單一個人的 token（外洩時用）', 'runReissuePersonalLinkToken_')
        .addSeparator()
        .addItem('⚠️ 清理舊 PDF', 'runCleanupOldPdfs_')
        .addItem('⚠️⚠️ 按季度清理 PDF', 'runQuarterPdfCleanup_')
        .addItem('⚠️ 清除一批 SendLog 記錄', 'runDeleteSendLogBatch_')
        .addItem('⚠️⚠️ 重設季度測試資料', 'runResetQuarterTestData_')
        .addSeparator()
        .addItem('封存舊季度資料（唯讀預覽）', 'runArchivePlan_')
        .addItem('⚠️⚠️ 執行封存舊季度資料', 'runArchiveExecute_')
        .addSeparator()
        .addItem('修正試算表時區設定', 'runApplyTimezoneSettings_')
        .addSeparator()
        .addItem('🩺 全面體檢（唯讀）', 'runFullHealthCheck_')
        .addItem('全新環境自我檢查（唯讀）', 'runFreshEnvironmentCheck_')
        .addItem('上線前檢查（唯讀）', 'runPreLaunchChecklist_')
        .addSeparator()
        .addItem('⚠️⚠️ 上線切換嚮導（會令系統真正寄信）', 'runGoLiveWizard_')
        .addItem('⚠️ 回退到測試模式', 'runGoLiveRollback_')
    )
    .addSubMenu(
      ui.createMenu('測試工具')
        .addItem('⚠️ 寄送（測試模式）', 'runSendStage_')
        .addItem('⚠️ 寄送單一 ICS／highlight 測試信', 'runSendIcsTestEmail_')
        .addItem('核對職事表', 'runVerifyRoster_')
        .addItem('自我測試', 'runSelfTest_')
        .addItem('參數掃描', 'runTuneParameters_')
        .addItem('多次生成比較', 'runCompareMultiRun_')
    )
    .addSubMenu(
      // Stage H：安裝／移除 trigger 是全系統唯一會令它在無人看管下自動寄信的操作，
      // 獨立成一個風險級別不同的子選單，放在最底。
      // 追加階段 M：原本的「試跑自動排程檢查」拆成兩個獨立功能——
      // 「檢查自動排程條件（唯讀）」純報告，保證零寫入；
      // 「⚠️⚠️ 立即執行自動排程檢查」（原名「試跑」，改名避免誤會成模擬）
      // 才是真正會生成版本、真正進入寄送流程的那個，兩者共用同一份判斷邏輯，
      // 報告內容保證一致，見 Trigger.gs 的 buildAutomationCheckReport_()。
      ui.createMenu('⚠️⚠️ 自動排程（會令系統自動執行）')
        .addItem('查看自動排程狀態（唯讀）', 'runViewAutomationStatus_')
        .addItem('檢查自動排程條件（唯讀）', 'runCheckAutomationConditions_')
        .addItem('⚠️⚠️ 立即執行自動排程檢查', 'runDailyAutomationCheckManually_')
        .addItem('⚠️⚠️ 安裝自動排程', 'runInstallAutomation_')
        .addItem('⚠️⚠️ 移除自動排程', 'runRemoveAutomation_')
    )
    .addToUi();
}

/**
 * 選單項目「檢查設定」的執行入口：呼叫 validateSetup() 並用對話框顯示結果。
 * @returns {void}
 */
function runValidateSetup_() {
  const issues = validateSetup();
  const ui = SpreadsheetApp.getUi();

  const rows = [diagRow_('檢查設定', '問題總數', issues.length, '')];
  issues.forEach(function (issue, i) {
    rows.push(diagRow_('檢查設定', '問題 ' + (i + 1), '', String(issue)));
  });
  tryWriteDiagnostics_('檢查設定', rows);

  if (issues.length === 0) {
    ui.alert('檢查設定（唯讀）', '沒有發現問題。\n\n' + DIAGNOSTICS_WRITTEN_NOTE, ui.ButtonSet.OK);
  } else {
    ui.alert('檢查設定（唯讀）',
      '發現 ' + issues.length + ' 個問題：\n\n' + issues.join('\n') + '\n\n' + DIAGNOSTICS_WRITTEN_NOTE,
      ui.ButtonSet.OK);
  }
}

/**
 * 「查看 ▸」底下有寫入 Diagnostics 的工具，一律在對話框末尾加這一句，
 * 講清楚「除了 Diagnostics 之外什麼都沒有改動」，避免幹事誤會職事表被動過。
 */
const DIAGNOSTICS_WRITTEN_NOTE =
  '（本次報告已同時寫入 Diagnostics 工作表，覆蓋上一次的同名報告。'
  + '除此之外沒有改動任何工作表、沒有產生版本、沒有寄出電郵。）';

/**
 * 選單項目「匯出關鍵狀態 → Diagnostics」的執行入口——階段 A 新增。
 *
 * 一次過把 Quarters 的 Stage、RosterVersions 最新五個版本、SendLog 每個批次的
 * Status 統計、Requests 每行的狀態、Unavailable 全部行、RosterPDF 各版本的檔案數與
 * 最小檔案大小、以及 Config 的 DRY_RUN／MAIL_SUBJECT_PREFIX 寫入 Diagnostics 工作表。
 *
 * 存在的理由：SendLog、AuditLog、RosterAssignments 太大，用 Google Drive connector
 * 讀一定被截斷，核對狀態只能靠人手逐張截圖。這個工具把「需要核對的結論」濃縮成
 * 一張細表，connector 可以一次過完整讀到。
 *
 * 只讀取，不改動任何其他工作表；唯一會寫的就是 Diagnostics。
 * @returns {void}
 */
function runExportKeyState_() {
  const ui = SpreadsheetApp.getUi();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('收集狀態中，請稍候…', '匯出關鍵狀態', 60);
    const rows = collectKeyStateRows_();
    const written = writeDiagnosticsReport_('關鍵狀態', rows);

    const sectionCounts = {};
    rows.forEach(function (r) { sectionCounts[r.section] = (sectionCounts[r.section] || 0) + 1; });
    const summary = Object.keys(sectionCounts).map(function (s) {
      return '　' + s + '：' + sectionCounts[s] + ' 行';
    });

    ui.alert('匯出關鍵狀態',
      '已寫入 Diagnostics 工作表，共 ' + written + ' 行：\n\n' + summary.join('\n') + '\n\n'
        + '這份報告覆蓋了上一次的「關鍵狀態」報告，不會累積。\n\n'
        + '除了 Diagnostics 之外，沒有改動任何工作表、沒有產生版本、沒有寄出電郵。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runExportKeyState_ 失敗: ' + err.message);
    ui.alert('匯出關鍵狀態', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「重新載入設定」的執行入口：清除 Config 快取，讓下一次讀取直接
 * 從工作表取得最新值。改完 Config 之後想立即生效（不想等最多 5 分鐘）時使用。
 * @returns {void}
 */
function runReloadConfig_() {
  const ui = SpreadsheetApp.getUi();
  try {
    reloadConfigCache();
    const config = readConfig();
    // 階段 A（第五輪批次）修正：DRY_RUN 原本是 `config[CONFIG_KEYS.DRY_RUN]`
    // 直接接字串，Config 工作表沒有登記這個 Key 時會顯示字面文字
    // 「DRY_RUN：undefined」——改用 describeConfigValue_() 顯示實際生效值。
    const dryRun = describeConfigValue_(config, CONFIG_KEYS.DRY_RUN, true);
    ui.alert(
      '重新載入設定（唯讀）',
      '已清除 Config 快取，以下是剛從工作表重新讀取的目前值：\n\n'
        + 'ROSTER_DRIVE_FOLDER_ID：' + (config[CONFIG_KEYS.ROSTER_DRIVE_FOLDER_ID] || '（空白）') + '\n'
        + 'DRY_RUN：' + dryRun.display + '\n'
        + 'ATTACH_NAME_PATTERN：' + (config[CONFIG_KEYS.ATTACH_NAME_PATTERN] || '（空白，使用內建預設值）'),
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runReloadConfig_ 失敗: ' + err.message);
    ui.alert('重新載入設定（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「檢查 Config 行數（唯讀）」的執行入口——追加階段 P 新增。
 * 逐行核對 Config 工作表：資料列總數、有填 Key 的列數、Key 完全空白的列號、
 * 重複的 Key 與其所在列號、跟 CONFIG_KEYS 互相有落差的 Key。只讀不寫。
 * @returns {void}
 */
function runCheckConfigRowCount_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const audit = planConfigRowAudit_();
    const lines = [
      'Config 工作表資料列總數（不含第 1 行說明、第 2 行標題）：' + audit.totalDataRows,
      '其中有填 Key 的列：' + audit.keyedRowCount,
      '不重複的 Key 數：' + audit.distinctKeyCount,
      ''
    ];

    lines.push('Key 完全空白的列：' + audit.blankKeyRows.length);
    if (audit.blankKeyRows.length > 0) lines.push('　行號：' + audit.blankKeyRows.join(', '));

    const dupKeys = Object.keys(audit.duplicateKeys);
    lines.push('', '重複的 Key：' + dupKeys.length);
    dupKeys.forEach(function (key) {
      lines.push('　' + key + '　行號：' + audit.duplicateKeys[key].join(', '));
    });

    lines.push('', 'CONFIG_KEYS 有登記、但工作表沒有這個 Key：' + audit.missingFromSheet.length);
    if (audit.missingFromSheet.length > 0) lines.push('　' + audit.missingFromSheet.join(', '));

    lines.push('', '工作表有這個 Key、但 CONFIG_KEYS 沒有登記：' + audit.extraInSheet.length);
    if (audit.extraInSheet.length > 0) lines.push('　' + audit.extraInSheet.join(', '));

    const rows = [
      diagRow_('Config 行數', '資料列總數', audit.totalDataRows, ''),
      diagRow_('Config 行數', '有填 Key 的列', audit.keyedRowCount, ''),
      diagRow_('Config 行數', '不重複的 Key 數', audit.distinctKeyCount, ''),
      diagRow_('Config 行數', 'Key 完全空白的列', audit.blankKeyRows.length,
        audit.blankKeyRows.length > 0 ? '行號：' + audit.blankKeyRows.join(', ') : ''),
      diagRow_('Config 行數', '重複的 Key 數', dupKeys.length, ''),
      diagRow_('Config 行數', 'CONFIG_KEYS 有、工作表無', audit.missingFromSheet.length,
        audit.missingFromSheet.join(', ')),
      diagRow_('Config 行數', '工作表有、CONFIG_KEYS 無', audit.extraInSheet.length,
        audit.extraInSheet.join(', '))
    ];
    dupKeys.forEach(function (key) {
      rows.push(diagRow_('Config 行數', '重複 Key：' + key, audit.duplicateKeys[key].length + ' 次',
        '行號：' + audit.duplicateKeys[key].join(', ')));
    });
    tryWriteDiagnostics_('Config 行數', rows);
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

    ui.alert('檢查 Config 行數（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCheckConfigRowCount_ 失敗: ' + err.message);
    ui.alert('檢查 Config 行數（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「檢查各版本派工紀錄（唯讀）」的執行入口——追加階段 V 新增。
 * 統計 RosterAssignments 每個「季度＋版本」實際有幾多行、幾多行有派人、涉及幾多人。
 *
 * 存在的理由：寄送（`buildMailContext_`）與步驟 3（`buildFineTuneContext_`）都是靠
 * 「QuarterID＋VersionNo」在 RosterAssignments 找資料，某個版本在這張表沒有資料時，
 * 寄送會找不到義工收件人、步驟 3 會直接拋錯。人手在試算表上數行數很容易只讀到
 * 最前面一部分（例如只看到第一個版本的 175 行，就以為全表只有 175 行），
 * 用這個工具由程式完整掃一次，數字才可靠。
 * @returns {void}
 */
function runCheckAssignmentVersions_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = summariseAssignmentVersions_();
    const lines = [
      'RosterAssignments 資料列總數：' + result.totalRows,
      '（不含第 1 行說明與第 2 行標題；readSheet() 會略過整行全空的列）',
      '',
      '按季度＋版本分組：'
    ];
    if (result.groups.length === 0) {
      lines.push('　（沒有任何資料列）');
    }
    result.groups.forEach(function (g) {
      lines.push('　' + g.quarterId + '　v' + g.versionNo
        + '　共 ' + g.rowCount + ' 行'
        + '　其中有派人 ' + g.assignedCount + ' 行'
        + '　涉及 ' + g.personCount + ' 人');
    });

    const rows = [diagRow_('各版本派工紀錄', '（資料列總數）', result.totalRows, '')];
    result.groups.forEach(function (g) {
      rows.push(diagRow_('各版本派工紀錄', g.quarterId + ' v' + g.versionNo, g.rowCount + ' 行',
        '有派人 ' + g.assignedCount + ' 行　涉及 ' + g.personCount + ' 人'));
    });
    tryWriteDiagnostics_('各版本派工紀錄', rows);
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

    ui.alert('檢查各版本派工紀錄（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCheckAssignmentVersions_ 失敗: ' + err.message);
    ui.alert('檢查各版本派工紀錄（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「檢查個人 PDF 完整性（唯讀）」的執行入口——追加階段 AG 新增。
 * 輸入 QuarterID 與版本號，核對「應該有幾多人的個人 PDF」跟 Shared Drive
 * 實際找到幾多個、大小是否正常，列出缺檔與大小異常的名單。只讀，不會產生、
 * 不會刪除、不會修改任何檔案或工作表。
 * @returns {void}
 */
function runCheckPersonalPdfIntegrity_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('檢查個人 PDF 完整性（唯讀）');
  if (!target) return;

  try {
    const result = planPersonalPdfIntegrityCheck_(target.quarterId, target.versionNo);
    const lines = [
      '資料夾：' + result.folderName,
      '應有 PDF 的人數：' + result.totalPeople,
      '大小門檻（Config 的 PDF_MIN_SIZE_BYTES）：' + result.minBytes + ' bytes',
      '找到且大小正常：' + result.okCount + ' 人',
      ''
    ];

    if (result.missing.length > 0) {
      lines.push('完全缺檔：' + result.missing.length + ' 人');
      result.missing.forEach(function (p) {
        lines.push('　' + p.nameTC + '（' + p.personId + '）　' + p.fileName);
      });
      lines.push('');
    }

    if (result.tooSmall.length > 0) {
      lines.push('⚠️ 檔案存在但大小異常（低於門檻，懷疑內容空白或截斷）：' + result.tooSmall.length + ' 人');
      result.tooSmall.forEach(function (p) {
        lines.push('　' + p.nameTC + '（' + p.personId + '）　' + p.fileName + '　' + p.sizeBytes + ' bytes');
      });
      lines.push('');
    }

    if (result.missing.length === 0 && result.tooSmall.length === 0) {
      lines.push('沒有發現任何問題，全部 ' + result.totalPeople + ' 人的 PDF 都存在且大小正常。');
    } else {
      lines.push('請重新執行「產生個人 PDF」補齊（已存在但大小不足的檔案會自動重新產生，'
        + '不需要先手動刪除）。');
    }

    const rows = [
      diagRow_('個人 PDF 完整性', '（季度／版本）', target.quarterId + ' v' + target.versionNo, ''),
      diagRow_('個人 PDF 完整性', '資料夾', result.folderName, ''),
      diagRow_('個人 PDF 完整性', '應有 PDF 的人數', result.totalPeople, ''),
      diagRow_('個人 PDF 完整性', '大小門檻 bytes', result.minBytes, ''),
      diagRow_('個人 PDF 完整性', '找到且大小正常', result.okCount + ' 人', ''),
      diagRow_('個人 PDF 完整性', '完全缺檔', result.missing.length + ' 人', ''),
      diagRow_('個人 PDF 完整性', '大小異常', result.tooSmall.length + ' 人', '')
    ];
    result.missing.forEach(function (p) {
      rows.push(diagRow_('個人 PDF 完整性', '缺檔：' + p.nameTC, p.personId, p.fileName));
    });
    result.tooSmall.forEach(function (p) {
      rows.push(diagRow_('個人 PDF 完整性', '大小異常：' + p.nameTC, p.sizeBytes + ' bytes', p.fileName));
    });
    tryWriteDiagnostics_('個人 PDF 完整性', rows);
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

    ui.alert('檢查個人 PDF 完整性（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCheckPersonalPdfIntegrity_ 失敗: ' + err.message);
    ui.alert('檢查個人 PDF 完整性（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補建 Config 參數」的執行入口：把程式碼會用到、但 Config 工作表
 * 目前還沒有的 Key 補一行到工作表最底。只新增，絕不覆寫或改動任何既有行
 * （即使某個 Key 已存在、Value 跟程式碼的預設值不同，也完全不會去動它）。
 * 執行前列出將新增的 Key 與其預設值並要求確認；已存在的 Key 一律略過。
 *
 * 每次執行都會先做自我檢查（checkConfigKeyRegistryGaps_()）：比對 CONFIG_KEYS
 * 的完整登記與這個補建清單實際涵蓋的範圍，若有「未預期」的落差（代表又發生了
 * 忘記把新 Key 加進補建清單的疏漏），一律明確顯示警告，不會靜靜略過
 * ——這是實測抓到 GRID_PENDING_FILL_COLOR 漏掉之後加上的防線。
 * @returns {void}
 */
function runSeedConfigKeys_() {
  const ui = SpreadsheetApp.getUi();
  const plan = planConfigKeySeed_();
  const gaps = plan.registryGaps;

  if (gaps.unexpectedGaps.length > 0) {
    const warnLines = [
      '⚠ 自我檢查發現異常：以下 ' + gaps.unexpectedGaps.length + ' 個 Key 已在 CONFIG_KEYS 登記，'
        + '但沒有被「補建 Config 參數」的清單涵蓋（getConfigKeySeeds_()）：',
      ''
    ];
    gaps.unexpectedGaps.forEach(function (key) { warnLines.push('　' + key); });
    warnLines.push('', '這代表這些 Key 即使真的缺少，也不會被這個工具偵測到。'
      + '請跟我說一聲，把它們補進 getConfigKeySeeds_()。');
    ui.alert('補建 Config 參數 — 自我檢查警告', warnLines.join('\n'), ui.ButtonSet.OK);
  }

  if (plan.extraInSheet.length > 0) {
    const extraLines = [
      '⚠ 工作表上有 ' + plan.extraInSheet.length + ' 個 Key，但程式碼的 CONFIG_KEYS 完全沒有登記'
        + '（可能是曾經被程式碼移除、但工作表上那一行還在，或是手動加的）：',
      ''
    ];
    plan.extraInSheet.forEach(function (key) { extraLines.push('　' + key); });
    extraLines.push('', '這些 Key 目前不會被任何程式碼讀取，是否要保留或手動刪除該行，請自行決定。');
    ui.alert('補建 Config 參數 — 工作表有但程式碼無', extraLines.join('\n'), ui.ButtonSet.OK);
  }

  if (plan.missing.length === 0) {
    ui.alert(
      '補建 Config 參數',
      '補建清單涵蓋的 ' + getConfigKeySeeds_().length + ' 個 Key 都已存在於工作表，不需要新增。'
        + (gaps.knownGaps.length > 0
          ? '\n\n（另有 ' + gaps.knownGaps.length + ' 個 Key 已知未被涵蓋，但目前程式碼沒有實際讀取，不影響運作，詳見 ConfigSeed.gs 的 getConfigKeyKnownUnusedKeys_()）'
          : ''),
      ui.ButtonSet.OK
    );
    return;
  }

  const lines = [
    '將在 Config 新增 ' + plan.missing.length + ' 行參數（只 append 到最底，不會改動任何既有行）：',
    ''
  ];
  plan.missing.forEach(function (s) {
    lines.push('　' + s.key + '　＝　' + (s.defaultValue || '（空白，必填請自行填入）') + '　（Type=' + s.type + '，Group=' + s.group + '）');
  });
  lines.push('', '確定要新增嗎？');

  if (ui.alert('補建 Config 參數', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedConfigKeys_(plan.missing);
    const addedKeys = plan.missing.map(function (s) { return s.key; }).join('\n　');
    writeAuditLog_({
      action: '補建 Config 參數',
      targetSheet: SHEETS.CONFIG,
      targetKey: written + ' 個新 Key',
      newValue: plan.missing.map(function (s) { return s.key; }).join('、'),
      source: 'runSeedConfigKeys_',
      notes: '只新增缺少的 Key（append 到最底），沒有改動任何既有 Key 的值'
    });
    ui.alert('補建 Config 參數', '已新增 ' + written + ' 個 Key：\n\n　' + addedKeys, ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedConfigKeys_ 失敗: ' + err.message);
    ui.alert('補建 Config 參數', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補建 Posts 欄位」的執行入口：Posts 工作表補上 EmptyDisplay 欄
 * （決定「崗位存在但留空」的格子顯示 PENDING／NA／BLANK 中的哪一種）。
 * 欄不存在時新增在最後一欄之後（不插入中間），已存在時只填補空白的格，
 * 已有值的格完全不動。執行前列出將寫入哪些崗位與值並要求確認。
 * @returns {void}
 */
function runSeedPostEmptyDisplay_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planPostEmptyDisplaySeed_();
  } catch (err) {
    ui.alert('補建 Posts 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.rows.length === 0) {
    ui.alert(
      '補建 Posts 欄位',
      plan.columnExists
        ? 'EmptyDisplay 欄已存在，且全部崗位都已有值，不需要新增。'
        : 'Posts 沒有任何崗位資料，不需要新增。',
      ui.ButtonSet.OK
    );
    return;
  }

  const lines = [
    plan.columnExists
      ? '將在既有的 EmptyDisplay 欄補上以下空格（只填空白的格，已有值的不動）：'
      : '將新增 EmptyDisplay 欄（append 在最後一欄之後，不影響其他欄），並填入：',
    ''
  ];
  plan.rows.forEach(function (r) {
    lines.push('　' + r.postName + '（' + r.postId + '）　→　' + r.value);
  });
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('補建 Posts 欄位', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedPostEmptyDisplay_(plan);
    ui.alert('補建 Posts 欄位', '已寫入 ' + written + ' 格。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPostEmptyDisplay_ 失敗: ' + err.message);
    ui.alert('補建 Posts 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補建 Posts 欄位（提早到場分鐘數）」的執行入口：Posts 工作表補上
 * EarlyArrivalMinutes 欄，供 ICS 日曆檔計算個別崗位（例如音響、司事）需要
 * 提早到場的時間（見 IcsExport.gs／PostSeed.gs 檔頭「Config-vs-Posts 欄」
 * 架構調整說明）。欄不存在時新增在最後一欄之後，已存在時只填補空白的格
 * （一律填 0＝不提早），已有值的格完全不動。執行前列出將寫入哪些崗位並要求確認。
 * @returns {void}
 */
function runSeedPostEarlyArrivalMinutes_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planPostEarlyArrivalMinutesSeed_();
  } catch (err) {
    ui.alert('補建 Posts 欄位（提早到場分鐘數）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.rows.length === 0) {
    ui.alert(
      '補建 Posts 欄位（提早到場分鐘數）',
      plan.columnExists
        ? 'EarlyArrivalMinutes 欄已存在，且全部崗位都已有值，不需要新增。'
        : 'Posts 沒有任何崗位資料，不需要新增。',
      ui.ButtonSet.OK
    );
    return;
  }

  const lines = [
    plan.columnExists
      ? '將在既有的 EarlyArrivalMinutes 欄補上以下空格（只填空白的格，已有值的不動）：'
      : '將新增 EarlyArrivalMinutes 欄（append 在最後一欄之後，不影響其他欄），並填入：',
    ''
  ];
  plan.rows.forEach(function (r) {
    lines.push('　' + r.postName + '（' + r.postId + '）　→　0（不提早）');
  });
  lines.push('', '填 0 之後可自行到 Posts 工作表，把需要提早到場的崗位（例如音響、司事）改成需要的分鐘數。');
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('補建 Posts 欄位（提早到場分鐘數）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedPostEarlyArrivalMinutes_(plan);
    writeAuditLog_({
      action: '補建 Posts 欄位',
      targetSheet: SHEETS.POSTS,
      targetKey: COLUMNS.POSTS.EARLY_ARRIVAL_MINUTES,
      newValue: '新增/補值 ' + written + ' 格',
      source: 'runSeedPostEarlyArrivalMinutes_'
    });
    ui.alert('補建 Posts 欄位（提早到場分鐘數）', '已寫入 ' + written + ' 格。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPostEarlyArrivalMinutes_ 失敗: ' + err.message);
    ui.alert('補建 Posts 欄位（提早到場分鐘數）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補建 Quarters 欄位」的執行入口：Quarters 工作表補上 Stage／StageUpdatedAt
 * 兩欄（四階段流程的狀態機，見 QuarterStage.gs）。欄不存在時新增在最後一欄之後，
 * 現有季度的 Stage 空白者一律預設 DRAFT。執行前列出將新增的欄與要設定 DRAFT 的季度。
 * @returns {void}
 */
function runSeedQuartersStage_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planQuartersStageSeed_();
  } catch (err) {
    ui.alert('補建 Quarters 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.missingColumns.length === 0 && plan.rows.length === 0) {
    ui.alert('補建 Quarters 欄位', 'Stage／StageUpdatedAt 欄都已存在，且全部季度都已有 Stage，不需要新增。', ui.ButtonSet.OK);
    return;
  }

  const lines = [];
  if (plan.missingColumns.length > 0) {
    lines.push('將新增欄位：' + plan.missingColumns.join('、') + '（append 在最後一欄之後，不影響其他欄）');
  } else {
    lines.push('Stage／StageUpdatedAt 欄都已存在。');
  }
  if (plan.rows.length > 0) {
    lines.push('', '將把以下季度的 Stage 設為 DRAFT（只填補空白，已有值的季度不動）：');
    plan.rows.forEach(function (r) { lines.push('　' + r.quarterId); });
  } else {
    lines.push('', '全部季度都已有 Stage 值，不會改動任何季度列。');
  }
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('補建 Quarters 欄位', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedQuartersStage_(plan);
    ui.alert(
      '補建 Quarters 欄位',
      '已新增欄位：' + (plan.missingColumns.length > 0 ? plan.missingColumns.join('、') : '（無，欄本來就存在）')
        + '\n已設定 Stage=DRAFT 的季度數：' + written,
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runSeedQuartersStage_ 失敗: ' + err.message);
    ui.alert('補建 Quarters 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「建立 Requests 工作表」的執行入口：建立（或重新整理）幹事登記
 * 「不能服侍／指定服侍」申報用的 Requests 工作表。已存在時只重新整理日期／崗位／
 * 姓名三欄的下拉選單來源（改對應到你這次輸入的 QuarterID），不動任何既有申報資料。
 * @returns {void}
 */
function runCreateRequestsSheet_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('建立 Requests 工作表', '請輸入這次要開放申報的 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  try {
    const result = createOrRefreshRequestsSheet_(quarterId);
    ui.alert(
      '建立 Requests 工作表',
      (result.isNew
        ? '已建立 Requests 工作表（RequestID／Status／處理結果／處理時間欄已加保護，'
          + '幹事不能手改；Status 留空等於 PENDING，會在「套用修改申報」執行時才補上）。'
        : 'Requests 工作表已存在，只重新整理了日期／崗位／姓名的下拉選單來源，'
          + '沒有動到任何既有申報資料。')
        + '\n\n日期下拉選單現在對應季度：' + quarterId
        + '\n\n日期／崗位／姓名三欄的下拉選單是「顯示警告」而非「拒絕輸入」，'
        + '可以手打不在名單上的值，實際把關會在「套用修改申報」時進行。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runCreateRequestsSheet_ 失敗: ' + err.message);
    ui.alert('建立 Requests 工作表', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「清理 Requests 手改痕跡」的執行入口：找出 Status／處理結果／處理時間
 * 疑似被手改的資料列（Status 不屬四個合法值，或 RequestID 空白但這三欄有值），
 * 清空該三欄並在備註記錄原因與時間。執行前列出將清理哪幾行。
 * @returns {void}
 */
function runCleanRequestsTampering_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planCleanRequestsTampering_();
  } catch (err) {
    ui.alert('清理 Requests 手改痕跡', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.rows.length === 0) {
    ui.alert('清理 Requests 手改痕跡', '沒有發現手改痕跡，不需要清理。', ui.ButtonSet.OK);
    return;
  }

  const lines = ['將清理以下 ' + plan.rows.length + ' 行（清空 Status／處理結果／處理時間，並在備註記錄）：', ''];
  plan.rows.forEach(function (r) {
    lines.push('　第 ' + r.sheetRow + ' 行　RequestID=' + (r.requestId || '（空白）')
      + '　Status=' + (r.status || '（空白）') + '　原因：' + r.reason);
  });
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('清理 Requests 手改痕跡', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const cleaned = cleanRequestsTampering_(plan);
    writeAuditLog_({
      action: '清理 Requests 手改痕跡',
      targetSheet: SHEETS.REQUESTS,
      targetKey: cleaned + ' 行',
      newValue: '（已清空 Status／處理結果／處理時間，並在備註記錄原因）',
      source: 'runCleanRequestsTampering_',
      notes: plan.rows.slice(0, 20).map(function (r) { return '第' + r.sheetRow + '行：' + r.reason; }).join('；')
        + (plan.rows.length > 20 ? '；……另有 ' + (plan.rows.length - 20) + ' 行' : '')
    });
    ui.alert('清理 Requests 手改痕跡', '已清理 ' + cleaned + ' 行。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCleanRequestsTampering_ 失敗: ' + err.message);
    ui.alert('清理 Requests 手改痕跡', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「重設 Requests 驗證規則」的執行入口：重新套用日期／崗位／姓名／類型／
 * Status 五欄的資料驗證，以及處理結果／處理時間的標題註解，範圍一律是整欄，
 * 不影響任何已填入的資料。日後幹事不小心清掉某欄的驗證規則時可以直接用這個修復。
 * @returns {void}
 */
function runResetRequestsValidations_() {
  const ui = SpreadsheetApp.getUi();
  // 第十九輪批次階段 F2：日期選單而家涵蓋全部仍然有效嘅季度，
  // 所以呢度**唔再需要**指定季度先用得。但仍然保留輸入框，
  // 因為傳入嘅季度會被「一定納入」——幹事想處理一個已經過期嘅季度
  // （例如補做上一季嘅紀錄）嗰陣，就要靠呢個把佢加返入選單。
  // 所以提示要講清楚「留空會點」，唔好令人以為唔填就會出事。
  const response = ui.prompt('重設 Requests 驗證規則',
    '日期下拉選單會自動涵蓋全部仍然有效（未過期）的季度，通常直接留空就可以。\n\n'
      + '如果你要處理一個已經過期的季度（例如補做上一季的紀錄），\n'
      + '請在這裡輸入那個 QuarterID（例如 2026T4），系統會額外把它的日期加入選單：',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  // 留空係合法輸入：代表「淨係要未過期嘅季度」。
  const quarterId = normalizeIdInput_(response.getResponseText());

  try {
    const result = resetRequestsValidations_(quarterId);
    const lines = ['已重新套用以下欄位（範圍皆為整欄，不影響已填入的資料）：', ''];
    result.columns.forEach(function (c) { lines.push('　' + c); });
    ui.alert('重設 Requests 驗證規則', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runResetRequestsValidations_ 失敗: ' + err.message);
    ui.alert('重設 Requests 驗證規則', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「計算季度日期」的執行入口——追加階段 S 新增。按 Config 的
 * LEAD_DAYS_GENERATE／LEAD_DAYS_OFFICIAL 算出 GenerateOn／OfficialSendOn，執行前
 * 列出現值與算出值，讓你選擇「全部覆寫」／「只填空白格」／「取消」，不會自動蓋過
 * 人手填的值。RemindOn 追加階段 Q 已確認是死欄位，這裡不處理。
 * @returns {void}
 */
function runComputeQuarterDates_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('計算季度日期', '請輸入 QuarterID（例如 2027T1）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  let plan;
  try {
    plan = planComputeQuarterDates_(quarterId);
  } catch (err) {
    ui.alert('計算季度日期', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = ['季度：' + quarterId + '　StartDate：' + plan.startDate, ''];
  plan.fields.forEach(function (f) {
    lines.push('　' + f.label + '　現值：' + (f.currentValue || '（空白）')
      + '　算出值：' + (f.computedValue || '（無法計算，Config 的 lead days 未設定）'));
  });
  lines.push(
    '',
    '是＝全部覆寫成算出值（包括已有值的格）',
    '否＝只填目前空白的格，已有值的格保留原值',
    '取消＝不寫入任何東西'
  );

  const choice = ui.alert('計算季度日期（確認）', lines.join('\n'), ui.ButtonSet.YES_NO_CANCEL);
  if (choice === ui.Button.CANCEL) return;

  try {
    const written = writeQuarterDates_(plan, choice === ui.Button.YES);
    ui.alert('計算季度日期', '已寫入 ' + written + ' 格。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runComputeQuarterDates_ 失敗: ' + err.message);
    ui.alert('計算季度日期', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「生成職事表」的執行入口：詢問 QuarterID，依序執行
 * generateRoster → writeAssignments → createRosterSheet → registerVersion → protectV0，
 * 最後以對話框顯示警告數目。
 * @returns {void}
 */
function runGenerateRoster_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('生成職事表', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) {
    ui.alert('生成職事表', '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('多次生成中，請稍候…', '職事表系統', 300);

    // 生成多份候選揀最貼近歷史基準的一份，並建立版本；與 Web UI、自動排程共用同一入口
    const result = performRosterGeneration_(quarterId);

    // 第十六輪批次階段 D3：未確認日期的特殊主日要喺完成畫面明確標示出嚟
    // （同「四階段流程 ▸ 步驟 1」嗰個畫面一致，兩邊讀同一個回傳值）。
    const unconfirmedText = describeUnconfirmedSpecialSundays_(result.unconfirmedSpecials);
    ui.alert(
      '生成職事表',
      '已建立 ' + result.sheetName + '\n\n'
        + '已派人：' + result.assigned + ' 格\n'
        + '留空待確認：' + result.blank + ' 格\n'
        + '警告：' + result.warnings + ' 項\n'
        + (unconfirmedText ? '\n' + unconfirmedText + '\n' : '')
        + '\n'
        + '試了 ' + result.attemptsRun + ' 次'
        + (result.stoppedByTime ? '（原定 ' + result.attemptsPlanned + ' 次，因時間上限提早停止）' : '') + '\n'
        + '採用第 ' + result.attemptIndex + ' 次（seed=' + result.seed + '）\n'
        + '總偏差 ' + result.deviation.toFixed(4) + '\n'
        + (result.protected ? '\nv0 已加保護。' : ''),
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runGenerateRoster_ 失敗: ' + err.message);
    ui.alert('生成職事表', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「核對職事表」的執行入口：詢問 QuarterID 與版本號，
 * 執行 verifyRoster() 並以對話框顯示摘要。版本號留空時採用最新版本。
 * @returns {void}
 */
function runVerifyRoster_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('核對職事表');
  if (!target) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('核對中，請稍候…', '職事表系統', 60);
    const result = verifyRoster(target.quarterId, target.versionNo);
    ui.alert('核對職事表', buildVerifySummaryText_(result), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runVerifyRoster_ 失敗: ' + err.message);
    ui.alert('核對職事表', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「匯出 PDF」的執行入口：詢問季度、版本與 PersonID，
 * PersonID 留空時匯出整季完整版，否則匯出該人的個人版。
 * @returns {void}
 */
function runExportPdf_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('匯出 PDF');
  if (!target) return;

  const personResponse = ui.prompt('匯出 PDF', '請輸入 PersonID（留空 = 整季完整版）：', ui.ButtonSet.OK_CANCEL);
  if (personResponse.getSelectedButton() !== ui.Button.OK) return;
  const personId = normalizeIdInput_(personResponse.getResponseText());

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('匯出中，請稍候…', '職事表系統', 60);
    const result = personId
      ? exportPersonalPdf(target.quarterId, target.versionNo, personId)
      : exportRosterPdf(target.quarterId, target.versionNo);

    const lines = ['已產生檔案：', '', result.fileName, '', '存放資料夾：' + result.folderName];
    if (personId) {
      lines.push('', result.personName + ' 已標示 ' + result.highlighted + ' 格藍色底色');
    }
    ui.alert('匯出 PDF', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runExportPdf_ 失敗: ' + err.message);
    ui.alert('匯出 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「產生個人 PDF」的執行入口：分批產生本季全部個人版 PDF 並存入 Shared Drive，
 * 寄送階段（OFFICIAL／RESEND）之後只會讀取這裡產生好的檔案，不再即時匯出。
 *
 * 一次執行只處理一批（人數由 Config 的 PDF_BATCH_SIZE 決定，預設 25），
 * 未完成時會顯示「已完成 X / Y 人，請再按一次繼續」，用同一個季度／版本再按一次即可接續，
 * 用法與「診斷工具 → 參數掃描」相同。已存在且屬同一版本的 PDF 預設略過，
 * 除非 Config 的 PDF_REGENERATE_IF_EXISTS=TRUE。
 * @returns {void}
 */
function runGeneratePersonalPdfBatch_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('產生個人 PDF');
  if (!target) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('產生中，請稍候…', '職事表系統', 300);
    const result = generatePersonalPdfBatch_(target.quarterId, target.versionNo);

    if (!result.done) {
      ui.alert(
        '產生個人 PDF（未完成）',
        '已完成 ' + result.doneCount + ' / ' + result.totalPeople + ' 人，請再按一次「產生個人 PDF」'
          + '（輸入同一個 QuarterID 與版本號）繼續。\n\n'
          + '目前為止：新產生 ' + result.generatedCount + '　略過已存在 ' + result.skippedExistingCount
          + '　重試 ' + result.totalRetries + ' 次',
        ui.ButtonSet.OK
      );
      return;
    }

    const lines = [
      '已全部完成：' + result.totalPeople + ' 人',
      '新產生：' + result.generatedCount + ' 個',
      '略過（已存在同版本且大小正常）：' + result.skippedExistingCount + ' 個',
      '重試次數：' + result.totalRetries,
      '',
      '耗時組成（全部新產生的人加總）：',
      '　設定 highlight 格式：' + (result.totalHighlightMs / 1000).toFixed(1) + ' 秒',
      '　呼叫匯出：' + (result.totalExportMs / 1000).toFixed(1) + ' 秒',
      '總耗時（含略過與略過的等待）：' + (result.elapsedMs / 1000).toFixed(1) + ' 秒'
    ];
    // 第十九輪批次階段 E2：「重試 47 次」本身唔會令人知道超過一半嘅
    // 總時間係喺度等，更加唔會令人知道呢件事係調得郁嘅。
    const retryHint = buildPdfRetryHintText_(result);
    if (retryHint) lines.push(retryHint);
    if (result.recoveredCount > 0) {
      lines.push('', 'ℹ️ 有 ' + result.recoveredCount + ' 個檔案曾經在存檔時拋出暫時性錯誤，'
        + '但核對後確認檔案其實已經正常建立，不算失敗。');
    }
    if (result.errors.length > 0) {
      lines.push('', '⚠ 有 ' + result.errors.length + ' 人失敗：');
      result.errors.slice(0, 20).forEach(function (e) {
        lines.push('　' + e.nameTC + '（' + e.personId + '）：' + e.message);
      });
      if (result.errors.length > 20) lines.push('　……另有 ' + (result.errors.length - 20) + ' 人');
    }
    ui.alert('產生個人 PDF', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runGeneratePersonalPdfBatch_ 失敗: ' + err.message);
    ui.alert('產生個人 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「清理舊 PDF」的執行入口：把指定季度中，同一個人（或完整版）名下
 * 不是自己最新版本的 PDF 移到 Drive 垃圾桶。執行前列出確切檔案清單、確切檔案數，
 * 並明確說明垃圾桶 30 日後會被 Google 自動永久刪除——追加階段 L：即使可從垃圾桶
 * 復原，這仍是會批量刪除檔案的操作，標 ⚠️。
 *
 * 步驟 5「改動後重發」之後，資料夾內同一季度會混著不同版本（沒被改動的人停留在
 * 舊版本，被改動的人是新版本），「保留最新版」改成逐人（逐身分）各自判斷，
 * 不是看單一全域最新版本號，詳見 PdfExport.gs 的 scanNonLatestPdfs_()。
 * @returns {void}
 */
function runCleanupOldPdfs_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('清理舊 PDF', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  let scan;
  try {
    scan = scanNonLatestPdfs_(quarterId);
  } catch (err) {
    ui.alert('清理舊 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const summaryLines = [
    '資料夾共 ' + scan.totalFileCount + ' 個檔案，其中可辨識 ' + scan.recognized.length + ' 個'
      + '（屬於 ' + quarterId + '、符合命名慣例，涵蓋 ' + scan.identityCount + ' 個身分／人）',
    '資料夾：' + scan.folderName,
    ''
  ];
  if (scan.unrecognized.length > 0) {
    summaryLines.push('⚠ 有 ' + scan.unrecognized.length + ' 個檔案無法辨識（可能是其他季度、'
      + '舊格式檔名，或是孤兒檔），不會被清理：');
    scan.unrecognized.slice(0, 20).forEach(function (f) { summaryLines.push('　' + f.name); });
    if (scan.unrecognized.length > 20) summaryLines.push('　……另有 ' + (scan.unrecognized.length - 20) + ' 個');
    summaryLines.push('');
  }

  if (scan.nonLatest.length === 0) {
    summaryLines.push('在可辨識的檔案中，找不到需要清理的舊版本——每個人（含完整版）都只有自己最新的一份。');
    summaryLines.push('保留中：' + scan.latestCount + ' 個檔案');
    ui.alert('清理舊 PDF', summaryLines.join('\n'), ui.ButtonSet.OK);
    return;
  }

  const lines = summaryLines.concat([
    '將移入 Google Drive 垃圾桶：' + scan.nonLatest.length + ' 個檔案（同一人／完整版底下，非自己最新版本的舊檔）',
    '　垃圾桶內 30 日內可自行復原，30 日後 Google 會自動永久刪除，之後無法復原。',
    '保留（各自最新版本）：' + scan.latestCount + ' 個檔案',
    ''
  ]);
  scan.nonLatest.slice(0, 20).forEach(function (m) { lines.push('　' + m.name); });
  if (scan.nonLatest.length > 20) lines.push('　……另有 ' + (scan.nonLatest.length - 20) + ' 個');
  lines.push('', '確定要清理嗎？');

  if (ui.alert('清理舊 PDF', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const trashed = trashFiles_(scan.nonLatest.map(function (m) { return m.id; }));
    writeAuditLog_({
      action: '清理舊 PDF',
      targetSheet: '（Google Drive）',
      targetKey: quarterId,
      oldValue: trashed + ' 個舊版本檔案',
      newValue: '（已移入垃圾桶，30 日內可復原）',
      source: 'runCleanupOldPdfs_',
      notes: scan.nonLatest.slice(0, 20).map(function (m) { return m.name; }).join('；')
        + (scan.nonLatest.length > 20 ? '；……另有 ' + (scan.nonLatest.length - 20) + ' 個' : '')
    });
    ui.alert('清理舊 PDF', '已移到垃圾桶：' + trashed + ' 個檔案（每人／完整版各自保留自己最新版本）。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCleanupOldPdfs_ 失敗: ' + err.message);
    ui.alert('清理舊 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/** 執行「按季度清理 PDF」前必須逐字輸入的確認字串。 */
const QUARTER_PDF_CLEANUP_CONFIRM_TEXT = '確認清理';

/**
 * 階段 C（第五輪批次）新增：選單項目「⚠️⚠️ 按季度清理 PDF」的執行入口——
 * 跟「清理舊 PDF」不同，這個工具**不分版本，把指定季度資料夾內全部已辨識
 * 的檔案一次過清走**，給「整個季度已經測試完畢，不需要保留任何版本」這種
 * 情境用（例如測試季度收工後）。跟「維護 ▸ ⚠️⚠️ 重設季度測試資料」一樣
 * 是 plan-only＋打字確認：先列出將被清理的完整檔案清單（含檔名與大小），
 * 要求逐字輸入「確認清理」才會真正執行，不分版本、不判斷「是否仍在使用」
 * ——這正是為什麼跟「清理舊 PDF」是兩個獨立工具：一個安全（保留最新版），
 * 一個徹底但需要你自己確認這個季度真的不需要任何 PDF 了。
 * @returns {void}
 */
function runQuarterPdfCleanup_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('⚠️⚠️ 按季度清理 PDF',
    '請輸入要清理的 QuarterID（例如 2026T4）：\n\n'
      + '⚠️ 這個工具不分版本，會清走這個季度資料夾內的全部已辨識 PDF，'
      + '不像「清理舊 PDF」會保留每人最新一份。適合整個季度已測試完畢、'
      + '完全不需要保留任何版本的情境。',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  let plan;
  try {
    plan = planQuarterPdfCleanup_(quarterId);
  } catch (err) {
    ui.alert('按季度清理 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.files.length === 0) {
    ui.alert('按季度清理 PDF', quarterId + ' 資料夾內找不到任何已辨識的 PDF，不需要清理。', ui.ButtonSet.OK);
    return;
  }

  const lines = [
    'QuarterID：' + quarterId,
    '資料夾：' + plan.folderName,
    '將清理：' + plan.files.length + ' 個檔案，共 ' + formatFileSize_(plan.totalSizeBytes),
    '（移入 Google Drive 垃圾桶，30 日內可自行復原，之後 Google 會自動永久刪除）',
    ''
  ];
  plan.files.slice(0, 20).forEach(function (f) { lines.push('　' + f.name + '　' + formatFileSize_(f.sizeBytes)); });
  if (plan.files.length > 20) lines.push('　……另有 ' + (plan.files.length - 20) + ' 個');
  lines.push('', '這個動作不分版本，即使某個版本仍在使用中也會一併清走。'
    + '請確認要繼續，並在下一步逐字輸入「' + QUARTER_PDF_CLEANUP_CONFIRM_TEXT + '」：');

  const confirm = ui.prompt('⚠️⚠️ 按季度清理 PDF（最後確認）', lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;
  if (confirm.getResponseText().trim() !== QUARTER_PDF_CLEANUP_CONFIRM_TEXT) {
    ui.alert('按季度清理 PDF', '輸入的文字不是「' + QUARTER_PDF_CLEANUP_CONFIRM_TEXT + '」，已取消，沒有清走任何東西。', ui.ButtonSet.OK);
    return;
  }

  try {
    const trashed = executeQuarterPdfCleanup_(plan);
    writeAuditLog_({
      action: '按季度清理 PDF',
      targetSheet: '（Google Drive）',
      targetKey: quarterId,
      oldValue: trashed + ' 個檔案，共 ' + formatFileSize_(plan.totalSizeBytes),
      newValue: '（已移入垃圾桶，30 日內可復原）',
      source: 'runQuarterPdfCleanup_',
      notes: plan.files.slice(0, 20).map(function (f) { return f.name; }).join('；')
        + (plan.files.length > 20 ? '；……另有 ' + (plan.files.length - 20) + ' 個' : '')
    });
    ui.alert('按季度清理 PDF', '已移到垃圾桶：' + trashed + ' 個檔案。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runQuarterPdfCleanup_ 失敗: ' + err.message);
    ui.alert('按季度清理 PDF', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「清除一批 SendLog 記錄」的執行入口：按批次前綴（一次 sendStage()
 * 執行寫入的那一組列）整批刪除 SendLog 記錄，方便清掉測試期間累積的垃圾記錄。
 * 只操作 SendLog 工作表，不碰任何其他工作表；沒有「清除全部」的選項，
 * 一律要輸入完整的批次前綴字串才能刪除，避免手滑刪錯。
 * @returns {void}
 */
function runDeleteSendLogBatch_() {
  const ui = SpreadsheetApp.getUi();
  let batches;
  try {
    batches = groupSendLogBatches_();
  } catch (err) {
    ui.alert('清除一批 SendLog 記錄', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (batches.length === 0) {
    ui.alert('清除一批 SendLog 記錄', 'SendLog 目前沒有任何記錄，不需要清除。', ui.ButtonSet.OK);
    return;
  }

  const recent = batches.slice(0, 10);
  const listLines = ['SendLog 共 ' + batches.length + ' 批，最近 ' + recent.length + ' 批：', ''];
  recent.forEach(function (b) {
    listLines.push('　' + b.prefix);
    listLines.push('　　行數：' + b.rowCount + '　Stage：' + b.stage + '　時間：' + b.sentAt);
    listLines.push('　　狀態分佈：' + formatSendLogStatusSummary_(b.statusCounts));
    listLines.push('');
  });
  listLines.push('請完整複製其中一個批次前綴，下一步會請你貼上輸入。');
  ui.alert('清除一批 SendLog 記錄', listLines.join('\n'), ui.ButtonSet.OK);

  const response = ui.prompt('清除一批 SendLog 記錄', '請輸入要刪除的批次前綴（完整字串，不是編號）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  // 呢個係複製貼上流程（上面明確要求「請完整複製」），複製貼上正正係
  // 零闊度字元（BOM／ZWSP）最常見嘅來源，同 normalizeIdInput_() 針對嘅
  // 風險完全一致，所以呢度都要用佢，唔淨係人手打字嘅 PersonID／QuarterID。
  const prefix = normalizeIdInput_(response.getResponseText());
  if (!prefix) return;

  const match = batches.filter(function (b) { return b.prefix === prefix; })[0];
  if (!match) {
    ui.alert('清除一批 SendLog 記錄', '找不到批次前綴「' + prefix + '」，請確認完整複製，沒有多餘空白或字元。', ui.ButtonSet.OK);
    return;
  }

  const confirmLines = [
    '批次：' + match.prefix,
    '將刪除：' + match.rowCount + ' 行',
    '狀態分佈：' + formatSendLogStatusSummary_(match.statusCounts),
    '',
    '⚠️ 此動作不可復原，只會刪除這一批的行，SendLog 其餘記錄不受影響。確定要刪除嗎？'
  ];
  if (ui.alert('清除一批 SendLog 記錄（確認）', confirmLines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const deleted = deleteSendLogBatch_(prefix);
    writeAuditLog_({
      action: '清除 SendLog 批次',
      targetSheet: SHEETS.SEND_LOG,
      targetKey: prefix,
      oldValue: deleted + ' 行（' + formatSendLogStatusSummary_(match.statusCounts) + '）',
      newValue: '（已刪除，不可復原）',
      source: 'runDeleteSendLogBatch_'
    });
    ui.alert('清除一批 SendLog 記錄', '已刪除 ' + deleted + ' 行。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runDeleteSendLogBatch_ 失敗: ' + err.message);
    ui.alert('清除一批 SendLog 記錄', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「寄送（測試模式）」的執行入口：詢問季度、版本與階段，執行 sendStage()。
 * Config 的 DRY_RUN=TRUE 時不會真正寄出，只寫入 SendLog。
 * @returns {void}
 */
function runSendStage_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('寄送（測試模式）');
  if (!target) return;

  const stageResponse = ui.prompt(
    '寄送（測試模式）',
    '請輸入階段：GENERATE / REMIND / OFFICIAL / RESEND',
    ui.ButtonSet.OK_CANCEL
  );
  if (stageResponse.getSelectedButton() !== ui.Button.OK) return;

  const stage = stageResponse.getResponseText().trim().toUpperCase();
  if (!MAIL_STAGES[stage]) {
    ui.alert('寄送（測試模式）', '階段必須是 GENERATE / REMIND / OFFICIAL / RESEND 其中之一。', ui.ButtonSet.OK);
    return;
  }

  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  if (!isDryRun) {
    const confirm = ui.alert(
      '⚠️ 注意：DRY_RUN 是 FALSE',
      'Config 的 DRY_RUN 目前是 FALSE，執行下去會真正寄出電郵。\n\n確定要繼續嗎？',
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;
  }

  // 需求 2＋3：OFFICIAL／RESEND 且範本要求個人 PDF 時，先驗證資料夾、
  // 再核對有沒有人缺 PDF；資料夾無效或有人缺件都要在開始寄送前讓使用者知道並決定。
  try {
    const missingCheck = checkMissingPersonalPdfs_(target.quarterId, target.versionNo, stage);
    if (missingCheck.applicable && missingCheck.missing.length > 0) {
      const names = missingCheck.missing.slice(0, 30).map(function (p) {
        return '　' + p.nameTC + '（' + p.personId + '）';
      });
      const extra = missingCheck.missing.length > 30
        ? '\n　……另有 ' + (missingCheck.missing.length - 30) + ' 人' : '';
      const proceed = ui.alert(
        '有 ' + missingCheck.missing.length + ' / ' + missingCheck.total + ' 人缺個人 PDF',
        names.join('\n') + extra + '\n\n'
          + '這些人會記為 ERROR_PDF_MISSING，不會寄出。\n\n'
          + '要先取消、去執行「產生個人 PDF」補齊，還是現在繼續（其餘的人正常處理）？\n'
          + '（是＝繼續／否＝取消）',
        ui.ButtonSet.YES_NO
      );
      if (proceed !== ui.Button.YES) return;
    }
  } catch (err) {
    log_('ERROR', 'checkMissingPersonalPdfs_ 失敗: ' + err.message);
    ui.alert('寄送（測試模式）', '檢查缺少的 PDF 時失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('處理中，請稍候…', '職事表系統', 60);
    const result = sendStage(target.quarterId, target.versionNo, stage);

    const durationSec = result.durationMs / 1000;
    const lines = [
      result.isDryRun ? '模式：DRY_RUN（沒有真正寄出任何電郵）' : '模式：正式寄出',
      '',
      '模擬寄出：' + result.dryRun + ' 封',
      '實際寄出：' + result.sent + ' 封',
      '查無電郵略過：' + result.skipped + ' 封',
      '內容未改動略過：' + result.unchanged + ' 封',
      '失敗：' + result.failed + ' 封',
      'PDF 產生失敗：' + result.errorPdf + ' 封',
      '缺少已產生的 PDF：' + result.errorPdfMissing + ' 封',
      '',
      'PDF 匯出重試次數：' + result.retryCount + '（遇到 HTTP 429／5xx 時自動重試的總次數，累加全部收件人）',
      '本次總耗時：' + durationSec.toFixed(1) + ' 秒',
      '',
      '全部紀錄已寫入 SendLog 工作表。'
    ];

    // Apps Script 單次執行上限 6 分鐘（360 秒），超過 4 分鐘就提醒有超時風險
    if (durationSec > 240) {
      lines.push('', '⚠️ 本次耗時已接近 Apps Script 6 分鐘的單次執行上限，'
        + '人數更多或重試更多次時可能會執行到一半被中斷（中斷前已處理的人仍會正確記錄，'
        + '但未處理到的人不會有任何紀錄）。如果之後常態性超過人數上限，請跟我討論分批處理的方案。');
    }

    if (result.errorPdf > 0) {
      lines.push('', '⚠ 有 PDF 產生失敗，常見原因是 Config 的 ROSTER_DRIVE_FOLDER_ID',
        '未設定或不是 Shared Drive，詳見 SendLog 的 ErrorMessage 欄。');
    }
    if (result.errorPdfMissing > 0) {
      lines.push('', '⚠ 有 ' + result.errorPdfMissing + ' 人缺少已產生的個人 PDF，'
        + '請執行「產生個人 PDF」補齊後再用 RESEND 補寄。');
    }
    if (result.noEmailPeople.length > 0) {
      lines.push('', '查無電郵者：', result.noEmailPeople.join('\n'));
    }
    ui.alert('寄送（測試模式）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSendStage_ 失敗: ' + err.message);
    ui.alert('寄送（測試模式）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「檢查改動」的執行入口：找出幹事的人手改動與被破壞的規則，
 * 計算最小改動建議並寫入 FineTuneProposals。
 * @returns {void}
 */
function runDetectChanges_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('檢查改動');
  if (!target) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('分析中，請稍候…', '職事表系統', 60);
    const result = proposeMinimalFix(target.quarterId, target.versionNo);
    const written = writeProposals(result);

    const softCount = result.violations.filter(function (v) {
      return v.severity === RULE_LEVELS.SOFT;
    }).length;

    const lines = [
      '人手改動：' + result.changes.length + ' 格',
      '被破壞的規則：' + result.violations.length + ' 項'
        + (softCount > 0 ? '（其中 ' + softCount + ' 項為次數上限，屬軟規則）' : ''),
      '已寫入建議：' + written + ' 項',
      ''
    ];

    if (result.proposals.length > 0) {
      lines.push('提案清單（每一項都要在 FineTuneProposals 設定 Decision）：');
      result.proposals.forEach(function (p, i) {
        const slotLabel = p.slotCount > 1 ? p.postNameTC + p.slotIndex : p.postNameTC;
        const suggestion = p.suggestedPersonId
          ? p.manualName + ' → ' + p.suggestedName
          : p.manualName + ' → （找不到人選，留空）';
        lines.push('　' + (i + 1) + '. ' + formatShortDate_(p.serviceDate) + '　'
          + slotLabel + '　' + suggestion
          + (p.severityLevel === RULE_LEVELS.SOFT ? '　[軟規則]' : ''));
      });
      lines.push('');
    }
    if (result.unresolved && result.unresolved.length > 0) {
      lines.push('⚠ 有 ' + result.unresolved.length + ' 格的姓名對不上 NameMapping／NameAlias：');
      result.unresolved.slice(0, 10).forEach(function (u) {
        lines.push('　' + u.serviceDate + ' ' + u.postId + '#' + u.slotIndex + '「' + u.text + '」');
      });
      lines.push('這些格套用時會變成空白，請先修正姓名或在 NameAlias 加入別名。');
      lines.push('');
    }
    if (result.unfixable && result.unfixable.length > 0) {
      lines.push('⚠ 有 ' + result.unfixable.length + ' 項找不到不衝突的建議：');
      result.unfixable.forEach(function (u) {
        lines.push('　' + u.serviceDate + ' ' + u.postId + '#' + u.slotIndex + '　' + u.reason);
      });
      lines.push('這些提案的 SuggestedPersonID 留空，需要你人手決定。');
      lines.push('');
    }

    if (written > 0) {
      lines.push('批次 ID（套用時需要）：', result.batchId, '');
      lines.push('請到 FineTuneProposals 工作表，在每行的 Decision 欄');
      lines.push('用下拉選單選擇以下其中一項：');
      lines.push('　KEEP_MANUAL　保留你的改動');
      lines.push('　ACCEPT_SUGGESTED　採用系統建議');
      lines.push('　REVERT_ORIGINAL　還原為系統原本排的人');
      lines.push('　PENDING　未決定（等同保留你的改動）');
      lines.push('');
      lines.push('選好後執行「套用決定」。');
    } else if (result.violations.length === 0) {
      lines.push('沒有規則被破壞，不需要修復。');
    } else {
      lines.push('偵測到違規但找不到可行的替代人選，需要人手處理。');
    }
    ui.alert('檢查改動', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runDetectChanges_ 失敗: ' + err.message);
    ui.alert('檢查改動', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「套用決定」的執行入口：詢問批次 ID，按 Decision 欄產生新版本。
 * @returns {void}
 */
function runApplyDecisions_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('套用決定', '請輸入批次 ID（BatchID）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const batchId = normalizeIdInput_(response.getResponseText());
  if (!batchId) {
    ui.alert('套用決定', '未輸入批次 ID，已取消。', ui.ButtonSet.OK);
    return;
  }

  // 執行前先檢查有無未決定的行：PENDING 等同「保留現況」，
  // 幹事很容易只設定了第一行就去套用，結果其餘提案默默沒有生效
  try {
    const summary = summariseBatchDecisions(batchId);
    if (summary.total === 0) {
      ui.alert('套用決定', '找不到批次 ' + batchId + ' 的提案。', ui.ButtonSet.OK);
      return;
    }
    if (summary.pending > 0) {
      const detail = Object.keys(summary.byDecision).map(function (key) {
        return '　' + key + '：' + summary.byDecision[key] + ' 項';
      }).join('\n');
      const confirm = ui.alert(
        '有 ' + summary.pending + ' 項未決定',
        '批次共 ' + summary.total + ' 項提案：\n' + detail + '\n\n'
          + 'PENDING 的項目會保留你的現況、不作修改。\n'
          + '如果你只想修其中幾格，這是正常的；\n'
          + '如果你打算全部修，請先回 FineTuneProposals 設定 Decision。\n\n'
          + '確定要現在套用嗎？',
        ui.ButtonSet.YES_NO
      );
      if (confirm !== ui.Button.YES) return;
    }
  } catch (err) {
    log_('ERROR', 'summariseBatchDecisions 失敗: ' + err.message);
    ui.alert('套用決定', '讀取批次失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('套用中，請稍候…', '職事表系統', 60);
    const result = applyDecisions(batchId);
    const lines = [
      '已建立新版本 ' + result.sheetName,
      '',
      '提案共 ' + result.total + ' 項：',
      '　採用系統建議（ACCEPT_SUGGESTED）：' + result.accepted + ' 項',
      '　還原為原本的人（REVERT_ORIGINAL）：' + result.reverted + ' 項',
      '　沿用你的改動（KEEP_MANUAL／PENDING）：' + result.manualKept + ' 項',
      ''
    ];

    if (result.revertBlocked && result.revertBlocked.length > 0) {
      lines.push('⚠ 有 ' + result.revertBlocked.length + ' 項選了 REVERT_ORIGINAL 但無法還原：');
      result.revertBlocked.forEach(function (b) {
        lines.push('　' + b.serviceDate + ' ' + b.postId + '#' + b.slotIndex
          + '（OriginalPersonID 空白）');
      });
      lines.push('這些格已保留原狀，未寫入空值。詳情見 AuditLog。');
      lines.push('');
    }

    if (result.archived > 0) {
      lines.push('已把 ' + result.archived + ' 行舊提案搬去 '
        + FINETUNE_ARCHIVE_SHEET + '，主表只保留今次批次。');
      lines.push('');
    }

    lines.push('其他格全部照抄，沒有重新執行排表演算法。');
    lines.push('（原本的版本沒有被改動）');

    ui.alert('套用決定', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runApplyDecisions_ 失敗: ' + err.message);
    ui.alert('套用決定', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「從 HWCAS 取電郵（產生初稿）」的執行入口。
 * 只產生 NameMapping_Draft 供人手核對，絕不自動寫入 NameMapping。
 * @returns {void}
 */
function runHwcasSync_() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '從 HWCAS 取電郵',
    '將以唯讀方式讀取 HWCAS 試算表，產生配對初稿到 NameMapping_Draft 工作表。\n\n'
      + 'NameMapping 不會被改動，需要你逐個確認後自行填入。\n\n確定要繼續嗎？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('讀取 HWCAS 中，請稍候…', '職事表系統', 60);
    const result = syncHwcasEmails();
    ui.alert(
      '從 HWCAS 取電郵',
      '已產生 ' + result.sheetName + '\n\n'
        + '成功配對：' + result.matched + ' 人\n'
        + '同名待確認：' + result.ambiguous + ' 人\n'
        + '找不到對應：' + result.unmatched + ' 人\n'
        + 'HWCAS 沒有此人：' + result.missingInHwcas + ' 人\n'
        + '合計：' + result.total + ' 行\n\n'
        + 'NameMapping 未被改動。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runHwcasSync_ 失敗: ' + err.message);
    ui.alert('從 HWCAS 取電郵', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「自我測試」的執行入口：執行 runSelfTest() 並以對話框顯示逐項結果。
 * 此測試不寄電郵、不改資料表、不建立版本。
 * @returns {void}
 */
function runSelfTest_() {
  const ui = SpreadsheetApp.getUi();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('測試中，請稍候…', '職事表系統', 60);
    const result = runSelfTest();

    const lines = [
      result.failed === 0
        ? '全部 ' + result.passed + ' 項通過 ✓'
        : result.passed + ' 項通過，' + result.failed + ' 項未通過',
      ''
    ];
    result.results.forEach(function (r) {
      lines.push((r.result === SELF_TEST_RESULT.PASS ? '✓ ' : '✗ ') + r.name);
    });
    lines.push('', '詳細說明見 ' + result.sheetName + ' 工作表。');

    ui.alert('自我測試', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSelfTest_ 失敗: ' + err.message);
    ui.alert('自我測試', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「套用 HWCAS 初稿」的執行入口。
 * 先預覽將寫入的行數並要求確認；若有電郵不一致的行，另外詢問是否覆蓋。
 * @returns {void}
 */
function runApplyHwcasDraft_() {
  const ui = SpreadsheetApp.getUi();

  let plan;
  try {
    plan = planHwcasApply();
  } catch (err) {
    ui.alert('套用 HWCAS 初稿', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.applicable.length === 0) {
    ui.alert('套用 HWCAS 初稿',
      '初稿中沒有可套用的行。\n\n共 ' + plan.totalRows + ' 行，全部因下列原因略過：\n'
        + formatSkipReasons_(plan.skippedReasons),
      ui.ButtonSet.OK);
    return;
  }

  const confirmLines = [
    '將寫入 NameMapping 的行數：' + plan.newOnly.length + ' 行（電郵原本空白或相同）',
    '',
    '會寫入的欄位：Email、MemberNo、EmailSource、EmailVerifiedAt、',
    '　　LastAttendance、MeetingPoint、SyncedAt、Congregation、MemberType',
    '其他欄位一概不會改動。',
    '',
    '略過 ' + plan.skipped.length + ' 行：',
    formatSkipReasons_(plan.skippedReasons),
    '',
    '確定要繼續嗎？'
  ];
  if (ui.alert('套用 HWCAS 初稿', confirmLines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  let overwriteExisting = false;
  if (plan.conflicts.length > 0) {
    const conflictLines = plan.conflicts.slice(0, 20).map(function (c) {
      return '　' + c.nameTC + '（' + c.personId + '）\n　　現有：' + c.existingEmail + '\n　　HWCAS：' + c.email;
    });
    if (plan.conflicts.length > 20) conflictLines.push('　……另有 ' + (plan.conflicts.length - 20) + ' 人');

    const answer = ui.alert(
      '有 ' + plan.conflicts.length + ' 人的電郵不一致',
      '以下人員在 NameMapping 已有電郵，而且與 HWCAS 的不同：\n\n'
        + conflictLines.join('\n')
        + '\n\n要用 HWCAS 的電郵覆蓋嗎？\n（選「否」則只寫入其餘 ' + plan.newOnly.length + ' 行，保留這些人的現有電郵）',
      ui.ButtonSet.YES_NO
    );
    overwriteExisting = (answer === ui.Button.YES);
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('寫入中，請稍候…', '職事表系統', 60);
    const result = applyHwcasDraft({ overwriteExisting: overwriteExisting });

    const lines = [
      '已寫入：' + result.written + ' 行',
      '',
      '跳過：' + result.skipped + ' 行',
      formatSkipReasons_(result.skippedReasons),
      ''
    ];
    if (plan.conflicts.length > 0 && overwriteExisting) {
      lines.push('（已用 HWCAS 電郵覆蓋 ' + plan.conflicts.length + ' 人的現有電郵）');
      lines.push('');
    }

    const pending = result.pendingEmail;
    lines.push('仍待補電郵：' + pending.total + ' 人');
    lines.push('（只計 NameMapping 內 Active=TRUE 而 Email 仍空白的人）');
    lines.push('');

    lines.push('一、HWCAS 有記錄但電郵欄空白：' + pending.hwcasNoEmail.length + ' 人');
    lines.push('　　→ 可請當事人補交給教會辦公室');
    lines.push(formatPendingNames_(pending.hwcasNoEmail));
    lines.push('');

    lines.push('二、HWCAS 完全無記錄：' + pending.notInHwcas.length + ' 人');
    lines.push('　　→ 多數是英語堂借調或外請，需人手加入');
    lines.push(formatPendingNames_(pending.notInHwcas));

    ui.alert('套用 HWCAS 初稿', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runApplyHwcasDraft_ 失敗: ' + err.message);
    ui.alert('套用 HWCAS 初稿', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 把 yyyy-MM-dd 的日期縮短為 MM-DD，供提案清單顯示（季度已知，年份多餘）。
 * @param {string} dateStr 日期字串
 * @returns {string} 縮短後的日期
 */
function formatShortDate_(dateStr) {
  const text = String(dateStr || '');
  return text.length >= 10 ? text.substring(5) : text;
}

/**
 * 把略過原因的統計整理成可讀文字，行數多者排先。
 * @param {Object.<string, number>} reasons {原因: 行數}
 * @returns {string} 每行一項的文字
 */
function formatSkipReasons_(reasons) {
  const keys = Object.keys(reasons);
  if (keys.length === 0) return '　（無）';
  return keys
    .sort(function (a, b) { return reasons[b] - reasons[a]; })
    .map(function (reason) { return '　' + reason + '：' + reasons[reason] + ' 行'; })
    .join('\n');
}

/**
 * 把待補電郵的名單整理成可讀文字，超過 30 人時只列前 30 個。
 * @param {Object[]} people 待補名單
 * @returns {string} 每行一項的文字
 */
function formatPendingNames_(people) {
  if (people.length === 0) return '　（無）';
  const names = people.slice(0, 30).map(function (p) {
    return '　' + p.nameTC + '（' + p.personId + (p.congregation ? '，' + p.congregation : '') + '）';
  });
  if (people.length > 30) {
    names.push('　……另有 ' + (people.length - 30) + ' 人，詳見 NameMapping');
  }
  return names.join('\n');
}

/**
 * 診斷選單「修正試算表時區設定」：把試算表本身的時區與地區改為與 Config 一致。
 * @returns {void}
 */
function runApplyTimezoneSettings_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = applyTimezoneSettings();
    ui.alert(
      '修正試算表時區設定',
      (result.changed ? '已更新試算表設定：' : '設定本來已經正確：') + '\n\n'
        + '時區：' + result.before.timeZone + ' → ' + result.after.timeZone + '\n'
        + '地區：' + result.before.locale + ' → ' + result.after.locale + '\n\n'
        + '目前時間（依 Config 的 SYS_TIMEZONE）：\n' + nowTimestamp_() + '\n\n'
        + '注意：本次改動只影響日後寫入的資料。\n'
        + '已經寫錯的舊時間戳不會自動更正。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runApplyTimezoneSettings_ 失敗: ' + err.message);
    ui.alert('修正試算表時區設定', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 診斷選單「SOFT 規則與選人加權」：在記憶體重跑排表並印出逐週明細，不寫入任何工作表。
 * @returns {void}
 */
function runDebugSoftRules_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('診斷 SOFT 規則（唯讀）', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('模擬中，請稍候…', '職事表系統', 60);
    const summary = debugSoftRules(quarterId);
    ui.alert(
      '診斷 SOFT 規則（唯讀）',
      '模擬結果（未寫入任何工作表）：\n\n'
        + '主席兼報告：' + (summary.chairEqRatio * 100).toFixed(1) + '%\n'
        + '報告連續兩週：' + (summary.announceRatio * 100).toFixed(1) + '%\n'
        + '用人數：' + summary.peopleCount + '　平均：' + summary.average.toFixed(2)
        + '　最高：' + summary.maxCount + '\n\n'
        + '逐週候選人分數明細請看 Apps Script 編輯器的「執行紀錄」。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runDebugSoftRules_ 失敗: ' + err.message);
    ui.alert('診斷 SOFT 規則（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 診斷選單「欄標題對照」：印出 grid 工作表第 1、2 行的實際內容供核對。
 * @returns {void}
 */
function runDebugGridHeaders_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('診斷欄標題（唯讀）');
  if (!target) return;

  try {
    const result = debugGridHeaders(target.quarterId, target.versionNo);
    if (!result) {
      ui.alert('診斷欄標題（唯讀）', '找不到該版本的工作表。', ui.ButtonSet.OK);
      return;
    }
    ui.alert('診斷欄標題（唯讀）',
      '共 ' + result.headers.length + ' 欄。\n\n完整標題陣列：\n\n'
        + JSON.stringify(result.headers) + '\n\n逐欄對照請看「執行紀錄」。',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('診斷欄標題（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 診斷選單「個人版 highlight 定位」：印出某人在 grid 上命中哪些格，不改動工作表。
 * @returns {void}
 */
function runDebugPersonalHighlight_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('診斷 highlight（唯讀）');
  if (!target) return;

  const personResponse = ui.prompt('診斷 highlight（唯讀）', '請輸入 PersonID（例如 P0001）：', ui.ButtonSet.OK_CANCEL);
  if (personResponse.getSelectedButton() !== ui.Button.OK) return;
  const personId = normalizeIdInput_(personResponse.getResponseText());
  if (!personId) return;

  try {
    const located = debugPersonalHighlight(target.quarterId, target.versionNo, personId);
    if (!located) {
      ui.alert('診斷 highlight（唯讀）', '找不到該版本的工作表。', ui.ButtonSet.OK);
      return;
    }
    ui.alert('診斷 highlight（唯讀）',
      '姓名：' + located.personName + '\n'
        + '掃描：' + located.scanned + ' 格\n'
        + '命中：' + located.matched.length + ' 格\n'
        + '定位方式：' + located.method + '\n\n逐格明細請看「執行紀錄」。',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('診斷 highlight（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 組出寫入 RosterVersions.Notes 的備註文字，記錄採用的 seed 供日後重現。
 * @param {Object} result generateBest() 的結果
 * @returns {string} 備註文字
 */
function buildSeedNote_(result) {
  return 'seed=' + result.seed
    + '　第 ' + result.attemptIndex + ' / ' + result.attemptsRun + ' 次'
    + '　總偏差 ' + result.deviation.toFixed(4)
    + '　主席兼報告 ' + formatPercent_(result.metrics.chairEqRatio)
    + '　報告連續 ' + formatPercent_(result.metrics.announceRatio)
    + '　用人數 ' + result.metrics.peopleCount
    + '　平均 ' + result.metrics.average.toFixed(2)
    + '　最高 ' + result.metrics.maxCount;
}

/**
 * 診斷選單「多次生成比較」：跑多次生成並把全部結果寫入 MultiRun_Result，不建立任何版本。
 * @returns {void}
 */
function runCompareMultiRun_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('多次生成比較', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('多次生成中，請稍候…', '職事表系統', 300);
    const result = compareMultiRun(quarterId);

    ui.alert(
      '多次生成比較',
      '已試 ' + result.attemptsRun + ' 次'
        + (result.stoppedByTime ? '（原定 ' + result.attemptsPlanned + ' 次，因時間上限提早停止）' : '')
        + '，結果寫入 ' + result.sheetName + '\n（已按總偏差排序，最佳一行標綠色）\n\n'
        + '最佳為第 ' + result.attemptIndex + ' 次，seed=' + result.seed + '\n'
        + '　主席兼報告 ' + formatPercent_(result.metrics.chairEqRatio) + '\n'
        + '　報告連續 ' + formatPercent_(result.metrics.announceRatio) + '\n'
        + '　用人數 ' + result.metrics.peopleCount
        + '　平均 ' + result.metrics.average.toFixed(2)
        + '　最高 ' + result.metrics.maxCount + '\n'
        + '　硬規則違反 ' + result.hardViolations + '\n'
        + '　總偏差 ' + result.deviation.toFixed(4) + '\n\n'
        + '次數分佈　' + result.histogramText + '\n'
        + '歷史分佈　' + formatHistogram_(HISTORICAL_BASELINE_DISTRIBUTION) + '\n'
        + '卡方距離　' + result.chiSquare.toFixed(2) + '\n\n'
        + '（未建立任何職事表版本）',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runCompareMultiRun_ 失敗: ' + err.message);
    ui.alert('多次生成比較', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 診斷選單「參數掃描」：對各種參數組合各模擬一次排表，找出最貼近歷史基準的一組。
 * 未跑完會保存進度，再按同一項即可接續。
 * @returns {void}
 */
function runTuneParameters_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('參數掃描', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('掃描中，可能需要數分鐘…', '職事表系統', 300);
    const result = tuneParameters(quarterId);

    if (!result.done) {
      ui.alert(
        '參數掃描（未完成）',
        '已完成 ' + result.completed + ' / ' + result.total + ' 組。\n\n'
          + '為避免超過 Apps Script 的 6 分鐘上限，已暫停並記住進度。\n\n'
          + '請再按一次「診斷工具 → 參數掃描」並輸入同一個季度，\n'
          + '預計還需要按 ' + Math.ceil(result.remaining / Math.max(1, result.completed)) + ' 次。',
        ui.ButtonSet.OK
      );
      return;
    }

    const best = result.best;
    ui.alert(
      '參數掃描完成',
      '已試 ' + result.total + ' 組，結果寫入 ' + result.sheetName + '（已按總偏差排序，最佳一行標綠色）。\n\n'
        + '最佳組合：\n'
        + '　SCORE_CHAIR_DUAL_BONUS = ' + best.chairDualBonus + '\n'
        + '　SELECTION_WEIGHT_HISTORICAL = ' + best.historicalWeight + '\n\n'
        + '該組合的模擬結果：\n'
        + '　主席兼報告 ' + (best.chairEqRatio * 100).toFixed(1) + '%\n'
        + '　報告連續 ' + (best.announceRatio * 100).toFixed(1) + '%\n'
        + '　用人數 ' + best.peopleCount + '　平均 ' + best.average.toFixed(2)
        + '　最高 ' + best.maxCount + '\n'
        + '　硬規則違反 ' + best.hardViolations + '\n\n'
        + '（未寫入任何職事表版本；要採用請自行把上述兩個值填入 Config）',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runTuneParameters_ 失敗: ' + err.message);
    ui.alert('參數掃描', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 共用的輸入流程：依序詢問 QuarterID 與版本號（版本號留空 = 最新版本）。
 * @param {string} title 對話框標題
 * @returns {?{quarterId: string, versionNo: number}} 使用者的選擇；取消或輸入無效時回傳 null
 */
function promptQuarterAndVersion_(title) {
  const ui = SpreadsheetApp.getUi();
  const quarterResponse = ui.prompt(title, '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (quarterResponse.getSelectedButton() !== ui.Button.OK) return null;

  const quarterId = normalizeIdInput_(quarterResponse.getResponseText());
  if (!quarterId) {
    ui.alert(title, '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return null;
  }

  const versionResponse = ui.prompt(title, '請輸入版本號（留空 = 最新版本）：', ui.ButtonSet.OK_CANCEL);
  if (versionResponse.getSelectedButton() !== ui.Button.OK) return null;

  const versionText = versionResponse.getResponseText().trim();
  const versionNo = versionText === '' ? findLatestVersionNo(quarterId) : Number(versionText);

  // 追加階段 T：原本兩種完全不同的失敗原因共用同一句「找不到有效的版本號。」，
  // 令人以為是「這個版本不存在」，實際上更常見的原因是輸入的文字不是純數字
  // （例如打了 "v9"、全形「９」、或貼上時帶了看不見的字元）。分開兩句，
  // 並把實際收到的文字回顯出來，方便一眼看出是哪一種。
  if (versionText !== '' && isNaN(versionNo)) {
    ui.alert(
      title,
      '版本號必須是純數字，但收到的是「' + versionText + '」。\n\n'
        + '請只輸入數字（例如 9），不要輸入 "v9"、全形數字，或留有多餘字元；'
        + '留空則自動採用最新版本。',
      ui.ButtonSet.OK
    );
    return null;
  }
  if (isNaN(versionNo) || versionNo < 0) {
    ui.alert(
      title,
      'RosterVersions 中找不到 ' + quarterId + ' 的任何版本紀錄。\n\n'
        + '請確認 QuarterID 有沒有打錯，或先執行「步驟 1：生成初稿」。',
      ui.ButtonSet.OK
    );
    return null;
  }
  return { quarterId: quarterId, versionNo: versionNo };
}

/**
 * 選單項目「⚠️⚠️ 重設季度測試資料」的執行入口——階段 C 新增。
 *
 * 把一個季度累積的測試資料清走，供正式上線前重來一次。分三步：
 * 1. 掃描（`planQuarterReset_()`，只讀不刪）
 * 2. 列出將會清理的東西與數量、以及「需要人手處理」的項目，要求打字輸入
 *    「確認重設」才繼續
 * 3. 按計畫執行（`executeQuarterReset_()`）
 *
 * 危險程度與「安裝自動排程」同級，所以標 ⚠️⚠️。
 * @returns {void}
 */
function runResetQuarterTestData_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('⚠️⚠️ 重設季度測試資料',
    '請輸入要重設的 QuarterID（例如 2026T4）：\n\n'
      + '這個功能會清走該季度的版本、派工紀錄、寄送紀錄、申報，'
      + '以及由申報自動加入的不可服侍日與該季的 PDF。\n'
      + '人員資料、資格、Config、範本、崗位、規則一律不碰。',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  const v0Response = ui.alert('⚠️⚠️ 重設季度測試資料',
    'v0 是自動生成的原始版本，通常已加保護，預設「保留」。\n\n'
      + '要連 v0 一齊清走嗎？\n\n'
      + '「是」＝連 v0 一齊清（整季由零開始）\n'
      + '「否」＝保留 v0（只清 v1 之後的測試版本）',
    ui.ButtonSet.YES_NO_CANCEL);
  if (v0Response === ui.Button.CANCEL) return;
  const includeV0 = v0Response === ui.Button.YES;

  let plan;
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('掃描中，請稍候…', '重設季度測試資料', 60);
    plan = planQuarterReset_(quarterId, includeV0);
  } catch (err) {
    log_('ERROR', 'planQuarterReset_ 失敗: ' + err.message);
    ui.alert('⚠️⚠️ 重設季度測試資料', '掃描失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = [
    'QuarterID：' + quarterId,
    '目前 Stage：' + (plan.quarterStage || '（讀取不到）'),
    '連 v0 一齊清：' + (plan.includeV0 ? 'YES' : 'NO'),
    '',
    '將會清理：',
    '　RosterVersions 登記列：' + plan.versions.length + ' 個版本（'
      + (plan.versions.map(function (v) { return 'v' + v.versionNo; }).join('、') || '無') + '）',
    '　對應的 grid 工作表：' + plan.versions.filter(function (v) { return v.sheetExists; }).length + ' 張',
    '　RosterAssignments：' + plan.assignmentRows + ' 行',
    '　SendLog：' + plan.sendLogRows + ' 行',
    '　Requests：' + plan.requestRows + ' 行',
    '　Unavailable（只限 Source=REQUEST）：' + plan.unavailableRequestRows + ' 行',
    '　FineTuneProposals（主表）：' + plan.fineTuneProposalRows + ' 行',
    '　FineTuneProposals_Archive（封存表）：' + plan.fineTuneProposalArchiveRows + ' 行',
    '　RosterPDF：' + plan.pdfFiles.length + ' 個檔案（移到垃圾桶，30 日內可復原）',
    '　Quarters.Stage：重設為 ' + QUARTER_STAGE.DRAFT,
    '',
    '不會碰：Eligibility、NameMapping、NameAlias、Config、EmailTemplates、',
    '　EmailRecipients、Posts、RuleSettings、ServiceDates、SpecialSundays，',
    '　以及其他季度的任何資料。個人專屬連結 token（NameMapping.PersonalLinkToken）',
    '　跟人綁定、不跟季度，同樣不會受影響。',
    '　身分名單（Roles）與個人崗位排除（PersonPostExclusions）同樣跟人不跟季度，',
    '　不會受影響——它們用生效日期表達時間範圍，本來就不屬於任何一季。'
  ];

  // 第十二輪批次階段 D：呢一季曾經發佈過公開職事表時提醒——**唔會刪除
  // 檔案或連結**，只會清空內容顯示「已重設」提示，連結本身維持不變。
  if (plan.publicLinkFileUrl) {
    lines.push('',
      '⚠ 這一季曾經發佈過公開職事表（' + plan.publicLinkFileUrl + '）：',
      '　連結本身不會改變、檔案不會刪除，但內容會清空並顯示「已重設」提示，',
      '　等下次重新執行「發佈公開職事表」時自然覆寫回正確內容。');
  }

  if (plan.pdfFiles.length > 0) {
    lines.push('', '將移到垃圾桶的 PDF 檔案：');
    plan.pdfFiles.slice(0, 20).forEach(function (f) {
      lines.push('　' + f.name + '　' + formatFileSize_(f.sizeBytes));
    });
    if (plan.pdfFiles.length > 20) lines.push('　……另有 ' + (plan.pdfFiles.length - 20) + ' 個');
  }

  // 第十輪批次階段 B1：逐行列出「落喺呢季但唔係申報自動加入」嘅 Unavailable。
  // 以前淨係喺 manualAttention 報一個數字，幹事要自己去成張表慢慢對——
  // 實測時就係咁漏咗一行測試資料。列出嚟，但一樣唔會自動刪。
  if (plan.unavailableManualDetails && plan.unavailableManualDetails.length > 0) {
    lines.push('', '⚠ 落在這一季、但不是由申報自動加入的 Unavailable（不會清，請自己看一次）：');
    plan.unavailableManualDetails.slice(0, 20).forEach(function (u) {
      lines.push('　' + u.personId + '　' + u.dateFrom + ' → ' + u.dateTo
        + '　Source=' + u.source
        + (u.appliesTo ? '　AppliesTo=' + u.appliesTo : '')
        + (u.postIds ? '　PostIDs=' + u.postIds : '')
        + (u.status ? '　Status=' + u.status : ''));
    });
    if (plan.unavailableManualDetails.length > 20) {
      lines.push('　……另有 ' + (plan.unavailableManualDetails.length - 20) + ' 行');
    }
  }

  // 第十輪批次階段 B2：由「指定服侍」申報自動寫入 Eligibility 的行。
  // 不屬於任何季度，所以重設季度永遠碰不到，但會繼續影響之後每一次生成。
  if (plan.eligibilityRequestRows && plan.eligibilityRequestRows.length > 0) {
    lines.push('', '⚠ Eligibility 中由「指定服侍」申報自動加入的行（不會清，會影響重新生成）：');
    plan.eligibilityRequestRows.slice(0, 20).forEach(function (e) {
      lines.push('　' + e.personId + '　崗位 ' + e.postId
        + '　Active=' + e.active
        + (e.addedAt ? '　加入於 ' + e.addedAt : '')
        + (e.eligibilityId ? '　（' + e.eligibilityId + '）' : ''));
    });
    if (plan.eligibilityRequestRows.length > 20) {
      lines.push('　……另有 ' + (plan.eligibilityRequestRows.length - 20) + ' 行');
    }
  }

  if (plan.manualAttention.length > 0) {
    lines.push('', '⚠ 以下項目系統不會自動處理，需要你人手判斷：');
    plan.manualAttention.forEach(function (m) { lines.push('　• ' + m); });
  }

  if (plan.versions.length === 0 && plan.assignmentRows === 0 && plan.sendLogRows === 0
      && plan.requestRows === 0 && plan.unavailableRequestRows === 0 && plan.pdfFiles.length === 0
      && plan.fineTuneProposalRows === 0 && plan.fineTuneProposalArchiveRows === 0) {
    lines.push('', '沒有找到任何可以清理的東西，不需要執行。');
    ui.alert('⚠️⚠️ 重設季度測試資料', lines.join('\n'), ui.ButtonSet.OK);
    return;
  }

  lines.push('', '這個動作除了 PDF（移到垃圾桶）之外，全部無法復原。');
  ui.alert('⚠️⚠️ 重設季度測試資料（確認清單）', lines.join('\n'), ui.ButtonSet.OK);

  const confirm = ui.prompt('⚠️⚠️ 重設季度測試資料（最後確認）',
    '看清楚上一個視窗的清單之後，如果確定要清走 ' + quarterId + ' 的測試資料，\n'
      + '請逐字輸入「' + QUARTER_RESET_CONFIRM_TEXT + '」：\n\n'
      + '（輸入其他任何文字、或按取消，都不會清走任何東西）',
    ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;
  if (confirm.getResponseText().trim() !== QUARTER_RESET_CONFIRM_TEXT) {
    ui.alert('⚠️⚠️ 重設季度測試資料',
      '輸入的文字不是「' + QUARTER_RESET_CONFIRM_TEXT + '」，已取消，沒有清走任何東西。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('清理中，請稍候…', '重設季度測試資料', 120);
    const result = executeQuarterReset_(plan);

    const resultLines = [
      quarterId + ' 的測試資料已清理：',
      '',
      '　RosterVersions 登記列：' + result.versionRowsDeleted + ' 行',
      '　grid 工作表：' + result.versionSheetsDeleted + ' 張',
      '　RosterAssignments：' + result.assignmentRowsDeleted + ' 行',
      '　SendLog：' + result.sendLogRowsDeleted + ' 行',
      '　Requests：' + result.requestRowsDeleted + ' 行',
      '　Unavailable（Source=REQUEST）：' + result.unavailableRowsDeleted + ' 行',
      '　FineTuneProposals（主表）：' + result.fineTuneProposalRowsDeleted + ' 行',
      '　FineTuneProposals_Archive（封存表）：' + result.fineTuneProposalArchiveRowsDeleted + ' 行',
      '　RosterPDF：' + result.pdfTrashed + ' 個已移到垃圾桶',
      '　Quarters.Stage：' + (result.stageReset ? '已重設為 ' + QUARTER_STAGE.DRAFT : '⚠ 重設失敗'),
      '　公開職事表：' + (plan.publicLinkFileUrl
        ? (result.publicRosterCleared ? '已清空內容並顯示「已重設」提示（連結不變）' : '⚠ 清空失敗或檔案已不存在，請自行檢查')
        : '（這一季沒有發佈過，不適用）'),
      '',
      '清理前的摘要已寫入 AuditLog。'
    ];
    if (result.errors.length > 0) {
      resultLines.push('', '⚠ 過程中有 ' + result.errors.length + ' 項出錯：');
      result.errors.forEach(function (e) { resultLines.push('　• ' + e); });
    }
    if (plan.manualAttention.length > 0) {
      resultLines.push('', '以下項目系統沒有處理，仍然需要你人手判斷：');
      plan.manualAttention.forEach(function (m) { resultLines.push('　• ' + m); });
    }

    ui.alert('⚠️⚠️ 重設季度測試資料（完成）', resultLines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'executeQuarterReset_ 失敗: ' + err.message);
    ui.alert('⚠️⚠️ 重設季度測試資料',
      '清理途中失敗：\n\n' + err.message + '\n\n'
        + '部分內容可能已經被清走。清理前的摘要已寫入 AuditLog，請對照檢查。',
      ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補齊 Email 範本」的執行入口。
 * 只新增 EmailTemplates 目前缺少的範本（依 EMAIL_TEMPLATE_SEEDS 的 TemplateID 判斷，
 * 見 planEmailTemplateSeed_()），不會覆寫已存在的範本內容。
 * @returns {void}
 */
function runSeedEmailTemplates_() {
  const ui = SpreadsheetApp.getUi();
  const plan = planEmailTemplateSeed_();

  if (plan.missing.length === 0) {
    ui.alert('補齊 Email 範本', '全部範本都已存在，不需要新增。', ui.ButtonSet.OK);
    return;
  }

  const lines = [
    '將在 EmailTemplates 新增 ' + plan.missing.length + ' 行範本：',
    ''
  ];
  plan.missing.forEach(function (t) {
    lines.push('　' + t.templateId + '　Stage=' + t.stage + '　AttachType=' + t.attachType);
  });
  lines.push('', '內容為書面語繁體中文範本（教會幹事對義工的通知語氣），');
  lines.push('之後可以直接在 EmailTemplates 修改文字。已存在的範本不會被覆寫。');
  lines.push('', '確定要新增嗎？');

  if (ui.alert('補齊 Email 範本', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedEmailTemplates_(plan.missing);
    ui.alert('補齊 Email 範本', '已新增 ' + written + ' 行範本。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedEmailTemplates_ 失敗: ' + err.message);
    ui.alert('補齊 Email 範本', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「預覽電郵範本」的執行入口：唯讀，用跟實際寄送完全相同的 placeholder
 * 代入邏輯，產生代入後的 Subject 與 BodyPlain 供核對。不寄電郵、不改 Stage、
 * 不寫 SendLog、不產生 PDF、不改任何工作表——只呼叫既有的唯讀函式。
 * @returns {void}
 */
function runPreviewEmailTemplate_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('預覽電郵範本（唯讀）');
  if (!target) return;

  const stageResponse = ui.prompt(
    '預覽電郵範本（唯讀）',
    '請輸入 Stage（例：REVIEW／GENERATE／REMIND／OFFICIAL／RESEND）：',
    ui.ButtonSet.OK_CANCEL
  );
  if (stageResponse.getSelectedButton() !== ui.Button.OK) return;
  const stage = stageResponse.getResponseText().trim().toUpperCase();
  if (!stage) return;

  try {
    const preview = previewEmailTemplate_(target.quarterId, target.versionNo, stage);

    const lines = [];
    if (preview.notice) {
      lines.push('⚠️ ' + preview.notice);
      lines.push('');
    }
    if (preview.unresolved.length > 0) {
      lines.push('⚠️ 未代入變數：' + preview.unresolved.join('、'));
      lines.push('');
    }
    lines.push('Stage：' + preview.stage);
    lines.push('TemplateID：' + preview.templateId);
    lines.push('AttachType：' + preview.attachType);
    lines.push('個人化範本：' + (preview.personalized ? '是（內容因收件人而異）' : '否'));
    lines.push('預覽收件人：' + preview.recipientDisplayName);
    lines.push('');
    lines.push('【Subject】');
    lines.push(preview.subject);
    lines.push('');
    lines.push('【BodyPlain】');
    lines.push(preview.bodyPlain);

    ui.alert('預覽電郵範本（唯讀，不會寄出）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runPreviewEmailTemplate_ 失敗: ' + err.message);
    ui.alert('預覽電郵範本（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「安裝自動排程」的執行入口。列明將建立哪個觸發器、幾點執行，
 * 並清楚提示 DRY_RUN 只會擋住寄出電郵，不會擋住生成職事表這個真實動作。
 *
 * 追加階段 Q：這段確認文字原本還停留在 Stage N 之前「三個時點都自動寄信」的舊描述
 * （GENERATE／REMIND／OFFICIAL 各自寄一種郵件），Stage N 早已把邏輯改成只有 GENERATE
 * 會自動執行、REMIND 改成提醒幹事、OFFICIAL 永遠不自動觸發，但這個確認視窗的文字
 * 沒有跟著更新，變成會給你錯誤資訊的確認視窗——這次一併修正，改成如實描述 Stage N
 * 之後的真實行為。
 * @returns {void}
 */
function runInstallAutomation_() {
  const ui = SpreadsheetApp.getUi();
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const rawHour = Number(config[CONFIG_KEYS.SEND_HOUR_LOCAL]);
  const hour = isNaN(rawHour) ? 9 : Math.min(23, Math.max(0, Math.round(rawHour)));
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const scriptTimezone = Session.getScriptTimeZone();
  const existing = listAutomationTriggers_();
  const stuckDays = getConfig(CONFIG_KEYS.REMIND_STUCK_DAYS, DEFAULTS.REMIND_STUCK_DAYS);
  const stuckMaxCount = getConfig(CONFIG_KEYS.REMIND_STUCK_MAX_COUNT, DEFAULTS.REMIND_STUCK_MAX_COUNT);
  const adminEmail = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '');

  const lines = [
    '將建立 1 個每日觸發器：',
    '　函式：dailyAutomationCheck_',
    '　時間：每日約 ' + hour + ':00（Apps Script 只保證在該小時內觸發，非精確整點）',
    '　時區：Config 的 SYS_TIMEZONE=' + timezone
      + '　腳本目前時區=' + scriptTimezone
      + (scriptTimezone === timezone ? '　一致 ✓' : '　⚠ 不一致，請檢查 appsscript.json 的 timeZone'),
    '',
    '每天會檢查全部季度，只做兩件事：',
    '　1. 到達 GenerateOn 日期、Stage 仍是 DRAFT、且未有已生成版本 → 自動生成初稿，'
      + '只通知幹事（' + (adminEmail || '⚠ MAIL_ADMIN_NOTIFY 未設定，不會有人收到') + '）覆核，'
      + '不寄給堂委或義工',
    '　2. Stage 停留在 REVIEW_SENT（已寄審閱、未套用申報）超過 ' + stuckDays + ' 天未前進 → '
      + '每日提醒幹事一次，最多提醒 ' + stuckMaxCount + ' 次',
    '正式發出（OFFICIAL）永遠不會由這裡觸發，一律要你在「步驟 4」手動執行。',
    '同一季同一動作不會重複觸發（生成靠 Stage／版本狀態判斷，提醒靠 AuditLog 記錄，兩者都可在'
      + '「自動排程 ▸ 檢查自動排程條件（唯讀）」隨時查看目前狀態）。',
    '',
    '⚠️ 重要：DRY_RUN 目前是 ' + (isDryRun ? 'TRUE' : 'FALSE') + '。',
    isDryRun
      ? 'DRY_RUN=TRUE 只會擋住「真正寄出電郵」這一步；生成職事表版本、'
        + '寫入 RosterAssignments 等操作仍會真實發生，不是模擬。'
      : '⚠️⚠️ DRY_RUN=FALSE，觸發器一到期會真正寄出電郵！',
    ''
  ];
  if (existing.length > 0) {
    lines.push('目前已有 ' + existing.length + ' 個同名觸發器，安裝時會先移除再重建。', '');
  }
  lines.push('要繼續的話，請在下一個對話框準確輸入「確認安裝」四個字（不是按確定就好）。');

  ui.alert('安裝自動排程', lines.join('\n'), ui.ButtonSet.OK);

  // Stage H 要求：這是全系統唯一會令它在無人看管下自動寄信的操作，
  // 所以不能只按 Yes／No，要求逐字輸入「確認安裝」才會真的建立 trigger。
  const response = ui.prompt('安裝自動排程（最後確認）', '請輸入「確認安裝」以繼續：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  if (response.getResponseText().trim() !== '確認安裝') {
    ui.alert('安裝自動排程', '輸入的文字不是「確認安裝」，已取消，沒有建立任何 trigger。', ui.ButtonSet.OK);
    return;
  }

  try {
    const result = installAutomationTrigger();
    ui.alert('安裝自動排程', '已安裝，每日約 ' + result.hour + ':00 執行一次檢查。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runInstallAutomation_ 失敗: ' + err.message);
    ui.alert('安裝自動排程', '安裝失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「移除自動排程」的執行入口：移除全部綁定 dailyAutomationCheck_ 的觸發器。
 * @returns {void}
 */
function runRemoveAutomation_() {
  const ui = SpreadsheetApp.getUi();
  const existing = listAutomationTriggers_();
  if (existing.length === 0) {
    ui.alert('移除自動排程', '目前沒有已安裝的自動排程。', ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(
    '移除自動排程',
    '將移除 ' + existing.length + ' 個觸發器，之後不會再自動生成或寄送。確定嗎？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  try {
    const removed = removeAutomationTriggers_();
    ui.alert('移除自動排程', '已移除 ' + removed + ' 個觸發器。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runRemoveAutomation_ 失敗: ' + err.message);
    ui.alert('移除自動排程', '移除失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「查看自動排程狀態」的執行入口。
 * Apps Script 不提供「下次精確執行時間」的公開 API，所以這裡改為列出
 * 已安裝的觸發規則，以及每個季度目前的生成／提醒狀態。
 *
 * 追加階段 N（第三輪批次下一輪的新一批階段 B 再更新一次）：改用跟真正執行、跟
 * 「檢查自動排程條件（唯讀）」完全同一套 judgeGenerateAction_()／
 * judgeRemindAction_() 判斷，取代原本這裡自己一套簡化邏輯（describeAutomationSchedule_()，
 * 已因為跟 N 的新設計不符而移除）——避免第三份平行的判斷邏輯，也避免這裡顯示的
 * 內容跟實際行為不一致。
 * @returns {void}
 */
function runViewAutomationStatus_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const triggers = listAutomationTriggers_();
    const config = readConfig();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

    const lines = [];
    lines.push('已安裝的觸發器：' + triggers.length + ' 個');
    if (triggers.length === 0) {
      lines.push('　（未安裝，自動排程目前不會執行任何動作）');
    } else {
      lines.push('　函式：dailyAutomationCheck_，每日觸發一次');
      lines.push('　（Apps Script 不提供精確的下次執行時間，只保證每 24 小時內於設定的小時觸發一次）');
    }
    lines.push('', '今天（' + timezone + '）：' + today, '', '各季度排程：');

    readSheet(SHEETS.QUARTERS).forEach(function (row) {
      const quarterId = row[COLUMNS.QUARTERS.QUARTER_ID];
      const startDate = toDateString(row[COLUMNS.QUARTERS.START_DATE], timezone);
      if (!quarterId) return;
      const schedule = computeAutomationSchedule_(row, config);
      const generateJudgment = judgeGenerateAction_(quarterId, schedule.generateDate, today);
      const remindJudgment = judgeRemindAction_(quarterId, row, today, config);

      lines.push('', '【' + quarterId + '】季初 ' + (startDate || '?'));
      lines.push('　生成初稿：' + (schedule.generateDate || '（未設定）') + '　' + describeGenerateStatus_(generateJudgment));
      lines.push('　提醒（目前 Stage：' + remindJudgment.stage + '）：' + describeRemindStatus_(remindJudgment));
      lines.push('　正式發出：一律由幹事在「步驟 4」手動執行，不會被自動排程觸發');
    });

    ui.alert('自動排程狀態（唯讀）',lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runViewAutomationStatus_ 失敗: ' + err.message);
    ui.alert('自動排程狀態（唯讀）','執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「檢查自動排程條件（唯讀）」的執行入口——追加階段 M 新增。
 *
 * 純報告，呼叫 buildAutomationCheckReport_() 產生內容，不呼叫 dailyAutomationCheck_()、
 * 不呼叫任何寄送函式、不生成任何版本、不寫入任何工作表。報告內容跟
 * 「⚠️⚠️ 立即執行自動排程檢查」執行前顯示的內容保證一字不差（同一個函式產生），
 * 因為兩邊共用 buildAutomationCheckReport_() 與其底層的 judgeGenerateAction_()／judgeRemindStuckAction_()，
 * 不是另外複製一份平行的判斷邏輯。
 * @returns {void}
 */
function runCheckAutomationConditions_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const report = buildAutomationCheckReport_();
    ui.alert('檢查自動排程條件（唯讀）', report.lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCheckAutomationConditions_ 失敗: ' + err.message);
    ui.alert('檢查自動排程條件（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「⚠️⚠️ 立即執行自動排程檢查」的執行入口——追加階段 M 由「試跑自動排程檢查」
 * 改名而來。這個功能會真正執行 dailyAutomationCheck_()：如果剛好有季度的時點到期，
 * 會真的生成職事表版本、真的進入寄送流程（只有真正寄出電郵這一步受 DRY_RUN 攔截）。
 * 「試跑」這個舊名字容易讓人誤會只是模擬，所以改名並加上雙重確認：先顯示跟
 * 「檢查自動排程條件（唯讀）」完全同一份報告內容，再要求逐字輸入「確認執行」才會真的跑。
 *
 * dailyAutomationCheck_() 的函式名稱結尾有底線，Apps Script 編輯器的
 * Run 下拉選單不會列出私有函式，所以需要這個選單項目才能在不安裝 trigger、
 * 不等到真正的到期日之前，手動確認邏輯有沒有跑錯。
 * @returns {void}
 */
function runDailyAutomationCheckManually_() {
  const ui = SpreadsheetApp.getUi();

  let report;
  try {
    report = buildAutomationCheckReport_();
  } catch (err) {
    log_('ERROR', 'runDailyAutomationCheckManually_ 失敗: ' + err.message);
    ui.alert('立即執行自動排程檢查', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const lines = report.lines.concat([
    '════════════════════',
    '⚠️⚠️ 這不是模擬，按下面「確認執行」後會真正執行上述動作',
    '（生成職事表版本、寫入 AuditLog，'
      + (report.isDryRun ? 'DRY_RUN=TRUE，不會真正寄出電郵）。' : 'DRY_RUN=FALSE，會真正寄出電郵！）。'),
    '',
    '要繼續的話，請在下一個對話框準確輸入「確認執行」四個字（不是按確定就好）。'
  ]);
  ui.alert('⚠️⚠️ 立即執行自動排程檢查', lines.join('\n'), ui.ButtonSet.OK);

  const response = ui.prompt('立即執行自動排程檢查（最後確認）', '請輸入「確認執行」以繼續：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  if (response.getResponseText().trim() !== '確認執行') {
    ui.alert('立即執行自動排程檢查', '輸入的文字不是「確認執行」，已取消，沒有執行任何動作。', ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('檢查中，請稍候…', '職事表系統', 60);
    const result = dailyAutomationCheck_();

    if (result.length === 0) {
      ui.alert('立即執行自動排程檢查', 'Quarters 工作表沒有資料，沒有任何項目可檢查。', ui.ButtonSet.OK);
      return;
    }

    const outcomeLabel = {
      RAN: '✓ 已執行',
      RAN_ERROR: '✗ 執行失敗',
      SKIPPED_DONE: '（今天已提醒過）',
      SKIPPED_NOT_DUE: '（未到期／未達天數門檻）',
      SKIPPED_NO_DATE: '（無日期）',
      SKIPPED_STAGE: '（Stage 已不是 DRAFT）',
      SKIPPED_HAS_VERSION: '（已有版本）',
      SKIPPED_NOT_STUCK: '（Stage 已是 OFFICIAL_SENT，不適用）',
      SKIPPED_MAX_REACHED: '（已達提醒次數上限）'
    };
    const ran = result.filter(function (r) { return r.outcome === 'RAN'; }).length;
    const ranError = result.filter(function (r) { return r.outcome === 'RAN_ERROR'; }).length;

    const resultLines = ['本次執行：' + ran + ' 項　失敗：' + ranError + ' 項', ''];
    result.forEach(function (r) {
      resultLines.push(r.quarterId + '　' + r.action + '　' + (outcomeLabel[r.outcome] || r.outcome));
      if (r.outcome === 'RAN' || r.outcome === 'RAN_ERROR') {
        resultLines.push('　' + r.detail);
      }
    });

    ui.alert('立即執行自動排程檢查', resultLines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runDailyAutomationCheckManually_ 失敗: ' + err.message);
    ui.alert('立即執行自動排程檢查', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 把 judgeGenerateAction_() 的判斷結果轉成「查看自動排程狀態」用的一段文字。
 * @param {Object} judgment judgeGenerateAction_() 的結果
 * @returns {string} 描述文字
 */
function describeGenerateStatus_(judgment) {
  switch (judgment.outcome) {
    case 'WOULD_RUN': return '已到期，等下次每日檢查執行';
    case 'SKIPPED_STAGE': case 'SKIPPED_HAS_VERSION': return '已完成';
    case 'SKIPPED_NOT_DUE': return '未到期';
    default: return '（未設定日期）';
  }
}

/**
 * 把 judgeRemindAction_() 的判斷結果轉成「查看自動排程狀態」用的一段文字。
 * @param {Object} judgment judgeRemindAction_() 的結果
 * @returns {string} 描述文字
 */
function describeRemindStatus_(judgment) {
  switch (judgment.outcome) {
    case 'SKIPPED_NOT_STUCK': return '不適用（' + judgment.detail + '）';
    case 'WOULD_RUN': return '已達門檻（' + judgment.reasons.join('＋') + '），等下次每日檢查提醒（第 ' + (judgment.reminderCount + 1) + ' / ' + judgment.maxCount + ' 次）';
    case 'SKIPPED_MAX_REACHED': return '已提醒 ' + judgment.reminderCount + ' / ' + judgment.maxCount + ' 次，達到上限';
    case 'SKIPPED_DONE': return '已提醒 ' + judgment.reminderCount + ' / ' + judgment.maxCount + ' 次，今天已提醒過';
    case 'SKIPPED_NOT_DUE': return judgment.detail + '（已提醒 ' + judgment.reminderCount + ' / ' + judgment.maxCount + ' 次）';
    default: return judgment.detail || '無法判斷';
  }
}

/**
 * 把核對結果整理成對話框用的摘要文字。
 * @param {{report: Object, sheetName: string}} result verifyRoster() 的結果
 * @returns {string} 摘要文字
 */
function buildVerifySummaryText_(result) {
  const summary = result.report.summary;
  const dist = summary.distribution;
  const lines = ['已建立 ' + result.sheetName, ''];

  lines.push('相鄰週重複：' + summary.adjacentRepeats + ' 次（目標 0，不含報告）');
  lines.push('報告連續兩週：' + (summary.announce ? formatPercent_(summary.announce.ratio) : '無法計算')
    + '（目標 ' + (summary.announce ? formatPercent_(summary.announce.target) : '-') + '，洩壓閥）');
  lines.push('主席兼報告：' + (summary.chairEq ? formatPercent_(summary.chairEq.ratio) : '無法計算')
    + '（目標 ' + (summary.chairEq ? formatPercent_(summary.chairEq.target) : '-') + '）');
  lines.push('總用人數：' + dist.peopleCount + ' 人（基準 ' + HISTORICAL_BASELINE.PEOPLE_COUNT + '）');
  lines.push('平均次數：' + dist.average.toFixed(2) + '（基準 ' + dist.averageTarget + '）');
  lines.push('最高次數：' + dist.maxCount + '（基準 ' + dist.maxTarget + '）');
  lines.push('');
  // 第二十一輪批次階段 A：拿走「← 這是 bug，請查看報告」。
  //
  // 原本嗰句對三類項目一視同仁，但其中兩類根本唔係 bug：
  // 一類係幹事自己打字放行過嘅，一類係版本生成之後先出現嘅申報。
  // 一句講錯嘅結論，比冇結論更差——實測嗰次就係一項已放行嘅違反
  // 被叫做 bug，令人以為排表演算法有問題。
  lines.push(summary.hardViolationClass
    ? summary.hardViolationClass.summary
    : buildHardViolationSummary_(summary.hardViolationCount,
      summary.hardViolationCount, 0, 0));

  return lines.join('\n');
}
