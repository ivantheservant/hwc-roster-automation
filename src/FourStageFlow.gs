/**
 * 四階段流程的選單入口：生成初稿 → 寄給堂委審閱 → 套用修改申報 → 正式發出。
 * 每步開始前都用 requireQuarterStage_()（QuarterStage.gs）檢查 Stage，成功後才呼叫
 * advanceQuarterStage_() 前進——這是全專案唯一會呼叫 advanceQuarterStage_() 的地方。
 *
 * 步驟 2、4 直接重用既有的 sendStage()（Mailer.gs）寄送管線，不重寫寄信邏輯：
 * 步驟 2 用新增的 MAIL_STAGES.REVIEW（收件人＝EmailRecipients.Role=REVIEWER，
 * 附件＝完整版 PDF，沿用 FULL_PDF 既有的「不存在就自動匯出一次」機制）；
 * 步驟 4 就是既有的 MAIL_STAGES.OFFICIAL（收件人＝表內所有人，附件＝已產生的個人 PDF，
 * 沿用既有的缺件檢查 checkMissingPersonalPdfs_()）。
 *
 * 這個檔案還多放了「步驟 5：改動後重發」（runFourStageStep5_()）——正式發出
 * （OFFICIAL_SENT）之後如果人手有變動，用這一步補救。它不算四階段流程新增的
 * 第五個階段：完成後 Stage 維持 OFFICIAL_SENT，不會呼叫 advanceQuarterStage_()，
 * 語意上是「已經正式發出之後的後續補救」，可重複執行、沒有次數限制。
 * 套用 Requests 完全重用步驟 3 的邏輯（RequestsApply.gs 不修改），比對改動者、
 * 產生個人 PDF、寄送則是新邏輯，分別見 ResendFlow.gs／PdfBatch.gs。
 */

/**
 * 追加階段 AT：步驟 3 放行硬規則違反時要顯示的後果說明。
 * 步驟 3 之後還有步驟 4 才會寄信，所以「繼續」的後果不是立即寄出，
 * 而是解鎖步驟 4——講清楚這個時間差，幹事才知道自己還有一次補救機會。
 */
const STEP3_HARD_VIOLATION_CONSEQUENCE =
  '繼續下去不會立即寄出任何電郵——步驟 3 只是把這一版定案。\n'
  + '但 Stage 會前進到 REQUESTS_APPLIED，「步驟 4：正式發出」就會解鎖，\n'
  + '屆時這些違反規則的安排會原封不動寄給各位義工。\n\n'
  + '建議先取消，到新版本的工作表人手修正之後再執行一次本步驟\n'
  + '（新版本已經建立並保留，取消只是令 Stage 不前進，不會令你損失任何東西）。';

/**
 * 追加階段 AR／AT：步驟 5 放行硬規則違反時要顯示的後果說明。
 * 步驟 5 的下一步就是寄信，後果比步驟 3 直接得多。
 */
const STEP5_HARD_VIOLATION_CONSEQUENCE =
  '繼續下去代表你知情並且決定照樣寄出，\n'
  + '收信人收到的職事表會包含這些違反規則的安排。\n\n'
  + '建議先取消，到新版本的工作表人手修正之後再執行一次本步驟\n'
  + '（新版本已經建立、不會消失，取消不會令你損失任何東西）。';

/**
 * 步驟 1：生成初稿。要求 Stage = DRAFT 或不存在（getQuarterStage_() 已把「不存在」
 * 正規化為 DRAFT，見 QuarterStage.gs）。完成後 Stage 保持 DRAFT，不前進。
 * @returns {void}
 */
function runFourStageStep1_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('步驟 1：生成初稿', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  try {
    requireQuarterStage_(quarterId, [QUARTER_STAGE.DRAFT], '步驟 1：生成初稿');
  } catch (err) {
    ui.alert('步驟 1：生成初稿', err.message, ui.ButtonSet.OK);
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('生成中，請稍候…', '四階段流程', 300);
    const result = performRosterGeneration_(quarterId);
    const b = result.blankBreakdown;
    const lines = [
      '已建立 ' + result.sheetName,
      '',
      '已派人：' + result.assigned + ' 格',
      '留空共 ' + result.blank + ' 格，細分如下（階段 C 起不再是一個含糊的數字）：',
      '　結構性不適用（不需要任何人處理，例如非首主日的聖餐襄禮）：' + b.structuralNaCount + ' 格',
      '　因特別主日跳過（通常不需要處理，但建議留意）：' + b.specialSkipCount + ' 格',
      '　待人手填寫（系統設計上本來就不自動生成，例如講員／翻譯／獻花）：' + b.manualPendingCount + ' 格',
      '　⚠ 系統應該排但排不出（真正的問題，建議優先處理）：' + b.genuineGapCount + ' 格'
    ];
    if (b.genuineGapCount > 0) {
      lines.push('');
      b.genuineGapCells.slice(0, 15).forEach(function (c) {
        lines.push('　　' + c.serviceDate + ' ' + c.postId + '#' + c.slotIndex + '：' + c.reason);
      });
      if (b.genuineGapCells.length > 15) lines.push('　　……另有 ' + (b.genuineGapCells.length - 15) + ' 格');
    }
    lines.push(
      '',
      '警告：' + result.warnings + ' 項',
      '',
      'Stage 維持 DRAFT。覆核無誤後可執行「步驟 2：寄給堂委審閱」。'
    );
    ui.alert('步驟 1：生成初稿', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runFourStageStep1_ 失敗: ' + err.message);
    ui.alert('步驟 1：生成初稿', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 步驟 2：寄給堂委審閱。要求 Stage = DRAFT。內容為 Google Sheet 連結 + 完整版 PDF
 * （不存在就自動匯出一次，約 9 秒，不涉及分批，不需要幹事另外執行「產生個人 PDF」）。
 * 收件人為 EmailRecipients 中 Role=REVIEWER 且 Active=TRUE 的人。成功後 Stage → REVIEW_SENT。
 * @returns {void}
 */
function runFourStageStep2_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('步驟 2：寄給堂委審閱', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  let preview;
  try {
    preview = planStep2_(quarterId);
  } catch (err) {
    ui.alert('步驟 2：寄給堂委審閱', err.message, ui.ButtonSet.OK);
    return;
  }

  const confirmLines = [
    'QuarterID：' + quarterId,
    '版本號：v' + preview.versionNo,
    '收件人數（Role=REVIEWER）：' + preview.recipientCount,
    '附件數量：1（完整版 PDF，若不存在會自動匯出一次，約 9 秒）',
    'DRY_RUN：' + (preview.isDryRun ? 'TRUE（不會真正寄出）' : 'FALSE（會真正寄出！）')
  ];
  if (preview.recipientCount === 0) {
    confirmLines.push('', '⚠ 目前沒有 Role=REVIEWER 的收件人，寄出後不會有任何人收到。'
      + '請先到 EmailRecipients 把審閱者的 Role 設為 REVIEWER（或執行「補建 EmailRecipients 欄位」）。');
  }
  confirmLines.push('', '確定要繼續嗎？');

  if (ui.alert('步驟 2：寄給堂委審閱（確認）', confirmLines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('處理中，請稍候…', '四階段流程', 60);
    const result = executeStep2_(quarterId);

    ui.alert(
      '步驟 2：寄給堂委審閱（完成）',
      (result.isDryRun ? '模式：DRY_RUN（沒有真正寄出任何電郵）' : '模式：正式寄出') + '\n\n'
        + '寄出：' + result.sent + '　模擬：' + result.dryRun + '\n'
        + '查無電郵略過：' + result.skipped + '\n'
        + '失敗：' + result.failed + '　PDF失敗：' + result.errorPdf + '\n\n'
        + 'Stage 已前進到 REVIEW_SENT。全部記錄已寫入 SendLog。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runFourStageStep2_ 失敗: ' + err.message);
    ui.alert('步驟 2：寄給堂委審閱', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 步驟 3：套用修改申報。要求 Stage = REVIEW_SENT 或 REQUESTS_APPLIED（可重複執行）。
 * 詳細邏輯見 RequestsApply.gs。分兩段確認：先顯示驗證結果（可套用／需確認／無法套用），
 * 再對「需確認」的項目問一次是否全部接受（Apps Script 內建對話框無法逐項勾選，
 * 目前是整批接受或整批拒絕；要局部調整請把該行 Status 留空後重新執行）。
 * 成功後 Stage → REQUESTS_APPLIED。
 * @returns {void}
 */
function runFourStageStep3_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('步驟 3：套用修改申報', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  let planResult;
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('驗證申報中，請稍候…', '四階段流程', 60);
    planResult = planStep3_(quarterId);
  } catch (err) {
    log_('ERROR', 'planStep3_ 失敗: ' + err.message);
    ui.alert('步驟 3：套用修改申報', err.message, ui.ButtonSet.OK);
    return;
  }

  if (planResult.mode !== 'HAS_PENDING') {
    handleStep3NoPendingRequests_(ui, quarterId, planResult);
    return;
  }

  const plan = planResult.plan;
  const applyList = plan.results.filter(function (r) { return r.category === 'APPLY'; });
  const confirmList = plan.results.filter(function (r) { return r.category === 'CONFIRM'; });
  const needsInputList = plan.results.filter(function (r) { return r.category === 'NEEDS_INPUT'; });

  const lines = ['共 ' + plan.results.length + ' 筆待處理申報：', ''];
  if (plan.skippedIncompleteCount > 0) {
    lines.push('已略過 ' + plan.skippedIncompleteCount + ' 行不完整申報（日期／崗位／姓名／類型未填滿四欄，不當成有效申報處理）', '');
  }
  lines.push('可直接套用：' + applyList.length + ' 筆');
  applyList.forEach(function (r) {
    lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '（' + r.requestType + '）');
  });
  lines.push('', '需要你確認（未曾任該崗位，屬硬規則）：' + confirmList.length + ' 筆');
  confirmList.forEach(function (r) {
    lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '：' + r.reason);
  });
  lines.push('', '無法套用（記為 NEEDS_INPUT）：' + needsInputList.length + ' 筆');
  needsInputList.forEach(function (r) {
    lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '：' + r.reason);
  });
  if (confirmList.length > 0) {
    lines.push('', '⚠ 有 ' + confirmList.length + ' 筆需要確認的項目，下一步會再問一次是否全部接受。');
  }
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('步驟 3：套用修改申報（驗證結果）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) {
    reportCancelledWithNeedsInput_(ui, '步驟 3：套用修改申報', plan);
    return;
  }

  let confirmedSheetRows = [];
  if (confirmList.length > 0) {
    const confirmLines = [
      '以下 ' + confirmList.length + ' 筆「未曾任該崗位」的申報要全部接受嗎？',
      '（選「否」則全部記為 REJECTED，之後可把該行 Status 清空重新提交）', ''
    ];
    confirmList.forEach(function (r) {
      confirmLines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText);
    });
    const acceptAll = ui.alert('確認「未曾任該崗位」的申報', confirmLines.join('\n'), ui.ButtonSet.YES_NO) === ui.Button.YES;
    if (acceptAll) confirmedSheetRows = confirmList.map(function (r) { return r.sheetRow; });
  }

  let result;
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('套用中，請稍候…', '四階段流程', 60);
    result = executeStep3Apply_(plan, confirmedSheetRows);
  } catch (err) {
    log_('ERROR', 'executeStep3Apply_ 失敗: ' + err.message);
    ui.alert('步驟 3：套用修改申報', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const resultLines = [
    '已建立新版本 ' + result.sheetName + '（底本 v' + result.baseVersionNo + '）',
    '',
    '已套用：' + result.appliedCount + ' 筆',
    '已拒絕：' + result.rejectedCount + ' 筆',
    '無法套用：' + result.needsInputCount + ' 筆',
    '',
    '待補格子（黃底）：' + result.pendingBackfillCount + ' 格',
    '新增 Eligibility：' + result.newEligibilityCount + ' 行',
    '新增 Unavailable：' + result.newUnavailableCount + ' 行',
    ''
  ].concat(buildViolationReportLines_(result.violations, result.sheetName));
  ui.alert('步驟 3：套用修改申報（套用完成）', resultLines.join('\n'), ui.ButtonSet.OK);

  // 追加階段 AT：Stage 前進 = 解鎖「步驟 4：正式發出」，所以有硬規則違反時
  // 要幹事明確放行才前進。取消的話新版本一樣保留，只是 Stage 不動，
  // 步驟 4 仍然執行不到——修正之後再執行一次本步驟即可（見
  // handleStep3NoPendingRequests_()，即使申報已經處理完也可以只做前進這一步）。
  // executeStep3Apply_() 已經在沒有硬規則違反時自動前進（result.advanced=true）；
  // 有違反時尚未前進，這裡沿用選單既有的同步打字放行流程。
  if (!result.advanced) {
    if (!confirmHardViolationOverride_(
      ui, quarterId, '步驟 3：套用修改申報', result.violations, STEP3_HARD_VIOLATION_CONSEQUENCE)) {
      ui.alert(
        '步驟 3：套用修改申報（未前進）',
        '新版本 ' + result.sheetName + ' 已建立並保留，申報也已經處理完畢。\n\n'
          + 'Stage 維持「' + planResult.stage + '」，沒有前進到 REQUESTS_APPLIED，\n'
          + '所以「步驟 4：正式發出」暫時執行不到，不會有任何電郵寄出。\n\n'
          + '請到 ' + result.sheetName + ' 人手修正硬規則違反的格子，\n'
          + '然後再執行一次本步驟——屆時即使已經沒有待處理的申報，\n'
          + '系統仍然會重新檢查一次，確認沒問題就會讓 Stage 前進。',
        ui.ButtonSet.OK
      );
      return;
    }
    advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
  }

  ui.alert(
    '步驟 3：套用修改申報（完成）',
    'Stage 已前進到 REQUESTS_APPLIED（可重複執行此步驟繼續處理新的申報）。',
    ui.ButtonSet.OK
  );
}

/**
 * 追加階段 AT 新增：步驟 3 沒有待處理申報時的處理。
 *
 * 原本一律只顯示「沒有待處理的申報」就結束。加了硬規則放行關卡之後，這樣會造成
 * 一個死局：幹事上次因為硬規則違反沒有放行，Stage 停在 REVIEW_SENT，申報卻已經
 * 全部處理完（RequestID 已指派，不再是待處理）——再執行本步驟只會被這句話擋回來，
 * 而 Stage 只可能由本步驟前進，於是永遠去不到步驟 4，也沒有任何補救途徑。
 *
 * 所以 Stage 仍未前進時，改為重新檢查最新版本目前的違反狀況（純讀取，不套用任何
 * 申報、不建立新版本），讓幹事人手修正之後可以只做「確認 + 前進 Stage」這一步。
 *
 * 階段 C：改為直接消費 `planStep3_()` 已經算好的 mode/violations，
 * 不再自己重新判斷 Stage、重新讀版本、重新算違規。
 *
 * @param {Ui} ui SpreadsheetApp.getUi() 的結果
 * @param {string} quarterId 季度 ID
 * @param {Object} planResult `planStep3_()` 的結果（`mode !== 'HAS_PENDING'`）
 * @returns {void}
 */
function handleStep3NoPendingRequests_(ui, quarterId, planResult) {
  const skippedNote = planResult.skippedIncompleteCount > 0
    ? '\n\n（另外已略過 ' + planResult.skippedIncompleteCount + ' 行日期／崗位／姓名／類型未填滿四欄的不完整申報，'
      + '不當成有效申報處理，也沒有寫入任何欄位。）'
    : '';

  if (planResult.mode === 'NO_PENDING_DONE') {
    ui.alert('步驟 3：套用修改申報',
      quarterId + ' 目前沒有待處理（PENDING）的申報。' + skippedNote, ui.ButtonSet.OK);
    return;
  }

  // Stage 仍是 REVIEW_SENT：可能是上次有硬規則違反而沒有放行，停在這裡。
  if (planResult.mode === 'NO_VERSION') {
    ui.alert('步驟 3：套用修改申報',
      quarterId + ' 目前沒有待處理（PENDING）的申報，而且找不到已生成的版本。\n\n'
        + '請先執行「步驟 1：生成初稿」。' + skippedNote, ui.ButtonSet.OK);
    return;
  }

  // planResult.mode === 'NO_PENDING_NEEDS_ADVANCE'
  const currentStage = planResult.stage;
  const sheetName = planResult.sheetName;
  const violations = planResult.violations;

  const lines = [
    quarterId + ' 目前沒有待處理（PENDING）的申報，但 Stage 仍是「' + currentStage + '」，',
    '未前進到 REQUESTS_APPLIED，所以「步驟 4：正式發出」暫時執行不到。',
    '',
    '以下是最新版本 ' + sheetName + ' 目前的規則檢查結果（只讀取，沒有改動任何東西）：',
    ''
  ].concat(buildViolationReportLines_(violations, sheetName));
  lines.push('', '確認之後就會讓 Stage 前進到 REQUESTS_APPLIED。');
  ui.alert('步驟 3：套用修改申報（重新檢查）', lines.join('\n'), ui.ButtonSet.OK);

  if (!confirmHardViolationOverride_(
    ui, quarterId, '步驟 3：套用修改申報', violations, STEP3_HARD_VIOLATION_CONSEQUENCE)) {
    ui.alert('步驟 3：套用修改申報（未前進）',
      'Stage 維持「' + currentStage + '」，「步驟 4：正式發出」仍然執行不到。\n\n'
        + '請到 ' + sheetName + ' 人手修正之後再執行一次本步驟。', ui.ButtonSet.OK);
    return;
  }

  advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
  ui.alert('步驟 3：套用修改申報（完成）',
    '沒有套用任何申報（本來就沒有待處理的），也沒有建立新版本。\n\n'
      + 'Stage 已前進到 REQUESTS_APPLIED，「步驟 4：正式發出」現在可以執行。', ui.ButtonSet.OK);
}

/**
 * 追加階段 AT 新增：幹事在驗證結果視窗撳取消時，把 NEEDS_INPUT 的原因寫回工作表，
 * 並告訴幹事寫了什麼、為什麼那些行仍然是待處理。
 * 步驟 3 與步驟 5 的取消路徑共用。
 * @param {Ui} ui SpreadsheetApp.getUi() 的結果
 * @param {string} title 對話框標題
 * @param {Object} plan planApplyRequests_() 的結果
 * @returns {void}
 */
function reportCancelledWithNeedsInput_(ui, title, plan) {
  let recorded = 0;
  try {
    recorded = recordNeedsInputOutcomes_(plan);
  } catch (err) {
    log_('ERROR', 'recordNeedsInputOutcomes_ 失敗: ' + err.message);
    ui.alert(title, '已取消，沒有套用任何申報。\n\n'
      + '（嘗試把「無法套用」的原因寫回工作表時失敗：' + err.message + '）', ui.ButtonSet.OK);
    return;
  }

  if (recorded === 0) {
    ui.alert(title, '已取消，沒有套用任何申報、沒有建立新版本。', ui.ButtonSet.OK);
    return;
  }

  ui.alert(title,
    '已取消，沒有套用任何申報、沒有建立新版本。\n\n'
      + '不過其中 ' + recorded + ' 筆「無法套用」的申報，已經把攔截原因寫回 Requests 工作表的\n'
      + 'Status 與「處理結果」兩欄，方便你日後直接在表上看到系統為什麼不處理它們。\n\n'
      + '這些行的 RequestID 仍然留空，代表系統從來沒有真正處理過它們——\n'
      + '你修正之後再執行本步驟，它們會照樣被重新驗證，不會被永久丟棄。',
    ui.ButtonSet.OK);
}

/**
 * 步驟 4：正式發出。要求 Stage = REQUESTS_APPLIED。執行前檢查是否仍有 PENDING 的
 * Requests、是否仍有待補的黃色格子，有的話列出讓幹事決定；再沿用既有的個人 PDF
 * 缺件檢查（checkMissingPersonalPdfs_()）。實際寄送直接呼叫既有的
 * sendStage(quarterId, versionNo, MAIL_STAGES.OFFICIAL)，不重寫寄信邏輯。
 * 成功後 Stage → OFFICIAL_SENT。
 * @returns {void}
 */
function runFourStageStep4_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('步驟 4：正式發出', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  let warnings;
  try {
    warnings = planStep4Warnings_(quarterId);
  } catch (err) {
    ui.alert('步驟 4：正式發出', err.message, ui.ButtonSet.OK);
    return;
  }
  const versionNo = warnings.versionNo;
  const pendingRequests = warnings.pendingRequests;
  const pendingCells = warnings.pendingCells;

  if (pendingRequests.length > 0 || pendingCells.length > 0) {
    const lines = ['發出前發現以下未完成事項：', ''];
    if (pendingRequests.length > 0) {
      lines.push('仍有 ' + pendingRequests.length + ' 筆 PENDING 的申報（建議先執行「步驟 3：套用修改申報」）：');
      pendingRequests.forEach(function (r) {
        lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText);
      });
      lines.push('');
    }
    if (pendingCells.length > 0) {
      lines.push('仍有 ' + pendingCells.length + ' 格待補（黃底，建議先人手處理）：');
      pendingCells.slice(0, 20).forEach(function (c) { lines.push('　' + c.serviceDate + ' ' + c.key); });
      if (pendingCells.length > 20) lines.push('　……另有 ' + (pendingCells.length - 20) + ' 格');
      lines.push('');
    }
    lines.push('要先取消回去處理，還是現在繼續？（是＝繼續／否＝取消）');
    if (ui.alert('有未完成事項', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }

  try {
    const missingCheck = planStep4MissingPdf_(quarterId, versionNo);
    if (missingCheck.applicable && missingCheck.missing.length > 0) {
      const names = missingCheck.missing.slice(0, 30).map(function (p) { return '　' + p.nameTC + '（' + p.personId + '）'; });
      const extra = missingCheck.missing.length > 30 ? '\n　……另有 ' + (missingCheck.missing.length - 30) + ' 人' : '';
      const proceed = ui.alert(
        '有 ' + missingCheck.missing.length + ' / ' + missingCheck.total + ' 人缺個人 PDF',
        names.join('\n') + extra + '\n\n要先取消、去執行「產生個人 PDF」補齊，還是現在繼續？（是＝繼續／否＝取消）',
        ui.ButtonSet.YES_NO
      );
      if (proceed !== ui.Button.YES) return;
    }
  } catch (err) {
    ui.alert('步驟 4：正式發出', '檢查個人 PDF 時失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  let sendPreview;
  try {
    sendPreview = planStep4SendPreview_(quarterId, versionNo);
  } catch (err) {
    ui.alert('步驟 4：正式發出', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const confirmLines = [
    'QuarterID：' + quarterId,
    '版本號：v' + versionNo,
    '收件人數：' + sendPreview.recipientCount,
    'DRY_RUN：' + (sendPreview.isDryRun ? 'TRUE（不會真正寄出）' : 'FALSE（會真正寄出！）'),
    '',
    '確定要正式發出嗎？'
  ];
  if (ui.alert('步驟 4：正式發出（確認）', confirmLines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('寄送中，請稍候…', '四階段流程', 60);
    const result = executeStep4Send_(quarterId);

    ui.alert(
      '步驟 4：正式發出（完成）',
      (result.isDryRun ? '模式：DRY_RUN（沒有真正寄出任何電郵）' : '模式：正式寄出') + '\n\n'
        + '寄出：' + result.sent + '　模擬：' + result.dryRun + '\n'
        + '查無電郵略過：' + result.skipped + '　未變略過：' + result.unchanged + '\n'
        + '失敗：' + result.failed + '　PDF失敗：' + result.errorPdf + '　PDF缺件：' + result.errorPdfMissing + '\n\n'
        + 'Stage 已前進到 OFFICIAL_SENT。全部記錄已寫入 SendLog。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runFourStageStep4_ 失敗: ' + err.message);
    ui.alert('步驟 4：正式發出', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 步驟 5：改動後重發。要求 Stage = OFFICIAL_SENT（正式發出之後才需要這一步）。
 * 完成後 Stage 維持 OFFICIAL_SENT，不前進、不新增其他 Stage 值。
 *
 * 可重複執行、沒有次數限制。分兩段確認：
 * 第一段（套用 Requests 之前，只在還有 PENDING 申報時出現）：QuarterID、目前版本號、
 * 即將建立的新版本號、待處理 Requests 筆數、DRY_RUN、是否繼續。套用邏輯完全重用
 * 步驟 3 的 planApplyRequests_()／applyRequests_()（RequestsApply.gs 不修改），
 * 包括同一套 APPLY／CONFIRM／NEEDS_INPUT 驗證結果對話框，與 CONFIRM 項目
 * 整批接受／拒絕的確認方式。
 * 第二段（新版本建立之後、寄送之前）：比對出這一輪跟上次寄出時內容不同的人
 * （computeResendDiff_()，ResendFlow.gs），列出人數與姓名、要寄出的信件數
 * （PERSON＋LIST），DRY_RUN，是否繼續。選「否」時新版本保留（已經建立，不會回滾），
 * 不寄出任何電郵。
 *
 * 支援重試：如果上次執行在第二段選「否」，或個人 PDF 分批產生尚未跑完就中斷
 * （單次執行接近 Apps Script 時間上限自動停下），再次執行這個步驟時，Requests
 * 這時已經是 APPLIED（0 筆待處理），會自動略過套用這一段，直接從「比對改動者」
 * 開始接續——不會重複套用申報，也不會重複建立版本。如果 Requests＝0 筆待處理，
 * 且這一版跟上次寄出時完全沒有 hash 差異，代表這一輪真的沒有東西要重發，
 * 會回報「沒有改動需要重發」並結束。
 *
 * @returns {void}
 */
function runFourStageStep5_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('步驟 5：改動後重發', '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  let planResult;
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('驗證申報中，請稍候…', '步驟 5：改動後重發', 60);
    planResult = planStep5_(quarterId);
  } catch (err) {
    log_('ERROR', 'planStep5_ 失敗: ' + err.message);
    ui.alert('步驟 5：改動後重發', err.message, ui.ButtonSet.OK);
    return;
  }

  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;

  // ---- 第一段：套用 Requests，完全重用步驟 3 的邏輯。Requests 已是 0 筆待處理時
  //      整段略過——這正是支援重試的關鍵：上次已經套用過的話，這次直接跳到比對改動者。
  if (planResult.mode === 'HAS_PENDING') {
    const plan = planResult.plan;
    const applyList = plan.results.filter(function (r) { return r.category === 'APPLY'; });
    const confirmList = plan.results.filter(function (r) { return r.category === 'CONFIRM'; });
    const needsInputList = plan.results.filter(function (r) { return r.category === 'NEEDS_INPUT'; });

    const lines = [
      'QuarterID：' + quarterId,
      '目前版本號：v' + plan.baseVersionNo,
      '即將建立的新版本號：v' + (plan.baseVersionNo + 1),
      '待處理 Requests：' + plan.results.length + ' 筆',
      'DRY_RUN：' + (isDryRun ? 'TRUE（不會真正寄出）' : 'FALSE（會真正寄出！）'),
      ''
    ];
    if (plan.skippedIncompleteCount > 0) {
      lines.push('另已略過 ' + plan.skippedIncompleteCount + ' 行不完整申報（日期／崗位／姓名／類型未填滿四欄）', '');
    }
    lines.push('可直接套用：' + applyList.length + ' 筆');
    applyList.forEach(function (r) {
      lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '（' + r.requestType + '）');
    });
    lines.push('', '需要你確認（未曾任該崗位，屬硬規則）：' + confirmList.length + ' 筆');
    confirmList.forEach(function (r) {
      lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '：' + r.reason);
    });
    lines.push('', '無法套用（記為 NEEDS_INPUT）：' + needsInputList.length + ' 筆');
    needsInputList.forEach(function (r) {
      lines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText + '：' + r.reason);
    });
    if (confirmList.length > 0) {
      lines.push('', '⚠ 有 ' + confirmList.length + ' 筆需要確認的項目，下一步會再問一次是否全部接受。');
    }
    lines.push('', '確定要繼續嗎？');

    if (ui.alert('步驟 5：改動後重發（套用申報，1/3）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) {
      reportCancelledWithNeedsInput_(ui, '步驟 5：改動後重發', plan);
      return;
    }

    let confirmedSheetRows = [];
    if (confirmList.length > 0) {
      const confirmLines = [
        '以下 ' + confirmList.length + ' 筆「未曾任該崗位」的申報要全部接受嗎？',
        '（選「否」則全部記為 REJECTED，之後可把該行 Status 清空重新提交）', ''
      ];
      confirmList.forEach(function (r) {
        confirmLines.push('　' + r.serviceDateText + ' ' + r.postNameText + ' ' + r.personNameText);
      });
      const acceptAll = ui.alert('確認「未曾任該崗位」的申報', confirmLines.join('\n'), ui.ButtonSet.YES_NO) === ui.Button.YES;
      if (acceptAll) confirmedSheetRows = confirmList.map(function (r) { return r.sheetRow; });
    }

    let applyResult;
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('套用中，請稍候…', '步驟 5：改動後重發', 60);
      applyResult = executeStep5Apply_(plan, confirmedSheetRows);
      // Stage 刻意維持 OFFICIAL_SENT，不呼叫 advanceQuarterStage_()——
      // 這是「正式發出之後的後續補救」，不是四階段流程新增的第五個階段。
    } catch (err) {
      log_('ERROR', 'runFourStageStep5_ 套用申報失敗: ' + err.message);
      ui.alert('步驟 5：改動後重發', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
      return;
    }

    const applyLines = [
      '已建立新版本 ' + applyResult.sheetName + '（底本 v' + applyResult.baseVersionNo + '）',
      '',
      '已套用：' + applyResult.appliedCount + ' 筆',
      '已拒絕：' + applyResult.rejectedCount + ' 筆',
      '無法套用：' + applyResult.needsInputCount + ' 筆',
      '',
      '待補格子（黃底）：' + applyResult.pendingBackfillCount + ' 格',
      ''
    ].concat(buildViolationReportLines_(applyResult.violations, applyResult.sheetName));
    applyLines.push('', '接下來會比對這一版跟上次寄出時的差異，決定要通知誰。');
    ui.alert('步驟 5：改動後重發（套用申報完成，2/3）', applyLines.join('\n'), ui.ButtonSet.OK);

    // 追加階段 AR：有硬規則違反時不可以只按一個 OK 就繼續走到寄送。
    // 取消的話新版本一樣保留（跟 3/3 選「否」的語意一致），不會白做。
    if (!confirmHardViolationOverride_(
      ui, quarterId, '步驟 5：改動後重發', applyResult.violations, STEP5_HARD_VIOLATION_CONSEQUENCE)) return;
  }

  // ---- 第二段：比對改動者、產生 PDF、確認、寄送 ----
  let changed;
  try {
    changed = planStep5ChangedList_(quarterId);
  } catch (err) {
    log_('ERROR', 'planStep5ChangedList_ 失敗: ' + err.message);
    ui.alert('步驟 5：改動後重發', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }
  const versionNo = changed.versionNo;
  const context = changed.context;
  const changedList = changed.changedList;

  if (changedList.length === 0) {
    ui.alert('步驟 5：改動後重發', quarterId + ' v' + versionNo + ' 沒有改動需要重發。', ui.ButtonSet.OK);
    return;
  }

  // 只為「這一輪有改動、而且有派工」的人產生新版個人 PDF；零派工的人不需要 PDF
  // （generateMailAttachment_() 既有的零派工略過附件邏輯會處理，見 Mailer.gs）。
  const anyoneNeedsPdf = changedList.some(function (c) { return c.hasAssignments; });
  if (anyoneNeedsPdf) {
    let pdfResult;
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('產生個人 PDF 中，請稍候…', '步驟 5：改動後重發', 300);
      pdfResult = executeStep5GeneratePdfs_(quarterId, versionNo, changedList);
    } catch (err) {
      log_('ERROR', 'runFourStageStep5_ 產生個人 PDF 失敗: ' + err.message);
      ui.alert('步驟 5：改動後重發', '產生個人 PDF 時失敗：\n\n' + err.message, ui.ButtonSet.OK);
      return;
    }
    if (!pdfResult.done) {
      ui.alert(
        '步驟 5：改動後重發（PDF 尚未完成）',
        '本次改動涉及 ' + pdfResult.totalPeople + ' 人的個人 PDF，人數較多，這次先完成了 '
          + pdfResult.doneCount + ' / ' + pdfResult.totalPeople + ' 人（接近單次執行時間上限自動停下）。\n\n'
          + '請再次執行「步驟 5：改動後重發」繼續——Requests 這時已無待處理，會自動略過套用，'
          + '直接接續產生尚未完成的 PDF。',
        ui.ButtonSet.OK
      );
      return;
    }
  }

  let sendPreview;
  try {
    sendPreview = planStep5SendPreview_(quarterId, versionNo, context, changedList);
  } catch (err) {
    ui.alert('步驟 5：改動後重發', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }
  const listRecipientCount = sendPreview.listRecipientCount;

  // 追加階段 AO：改動者當中，NameMapping 目前查無電郵的人實際上不會收到任何信
  // （deliverOne_() 會記為 SKIPPED_NO_EMAIL），但先前的版本把他們也算進「即將寄出的
  // 信件數」，令 3/3 確認視窗顯示的封數跟完成報告的「查無電郵略過」對不上。
  // 這裡先分開算好，確認視窗顯示的封數就是實際會嘗試寄出的封數。
  const noEmailList = sendPreview.noEmailList;
  const personSendableCount = sendPreview.personSendableCount;

  const confirmLines2 = [
    'QuarterID：' + quarterId + '　版本號：v' + versionNo,
    '',
    '這一輪有改動、需要通知的人共 ' + changedList.length + ' 位：'
  ];
  changedList.slice(0, 30).forEach(function (c) {
    const tags = [];
    if (!c.hasAssignments) tags.push('本季已無服侍安排');
    if (c.firstNotifyDueToEmail) tags.push('首次通知，之前無電郵');
    confirmLines2.push('　' + c.nameTC + (tags.length > 0 ? '（' + tags.join('；') + '）' : ''));
  });
  if (changedList.length > 30) confirmLines2.push('　……另有 ' + (changedList.length - 30) + ' 人');

  if (noEmailList.length > 0) {
    confirmLines2.push('', '其中無電郵無法通知：' + noEmailList.length + ' 位：');
    noEmailList.slice(0, 30).forEach(function (c) { confirmLines2.push('　' + c.nameTC); });
    if (noEmailList.length > 30) confirmLines2.push('　……另有 ' + (noEmailList.length - 30) + ' 人');
  }

  confirmLines2.push(
    '',
    '即將寄出的信件數：' + (personSendableCount + listRecipientCount)
      + '（個人通知 ' + personSendableCount + ' 封 ＋ LIST 摘要 ' + listRecipientCount + ' 封）',
    'DRY_RUN：' + (isDryRun ? 'TRUE（不會真正寄出）' : 'FALSE（會真正寄出！）'),
    '',
    '確定要繼續嗎？（選「否」新版本會保留，之後可再次執行本步驟重新確認寄送）'
  );

  if (ui.alert('步驟 5：改動後重發（確認寄送，3/3）', confirmLines2.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('寄送中，請稍候…', '步驟 5：改動後重發', 60);
    const sendResult = executeStep5Send_(quarterId, versionNo, changedList);

    ui.alert(
      '步驟 5：改動後重發（完成）',
      (sendResult.isDryRun ? '模式：DRY_RUN（沒有真正寄出任何電郵）' : '模式：正式寄出') + '\n\n'
        + '寄出：' + sendResult.sent + '　模擬：' + sendResult.dryRun + '\n'
        + '查無電郵略過：' + sendResult.skipped + '\n'
        + '失敗：' + sendResult.failed + '　PDF失敗：' + sendResult.errorPdf + '　PDF缺件：' + sendResult.errorPdfMissing + '\n\n'
        + 'Stage 維持 OFFICIAL_SENT。全部記錄已寫入 SendLog。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runFourStageStep5_ 寄送失敗: ' + err.message);
    ui.alert('步驟 5：改動後重發', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 追加階段 AR 新增：把套用申報後重跑規則檢查的結果，整理成逐項可讀的對話框內容。
 *
 * 原本只顯示「違反：N 項」一個數字，幹事看見也無從判斷應該繼續還是取消；
 * 就算列出來，用的也是 `postId#slotIndex` 這種機器鍵，而且沒有涉事人的名字。
 * 現在逐項顯示「日期　崗位　姓名　規則：原因」，並且**把硬規則與準硬規則分開**——
 * 兩者的意義完全不同：硬規則是「絕不應該自動違反」，準硬規則只是「值得留意」。
 *
 * 截斷方式：硬規則最多列 15 項、準硬規則最多列 10 項（硬規則配額較多，因為它才是
 * 需要逐項判斷的那一種），超出的部分只報數量。完整清單不需要另外開視窗——
 * 每一項違規都已經寫成新版本工作表對應格子的底色與批註（見 RosterWriter.gs 的
 * applyCellMarks_()），所以這裡直接指路去看那張表，不重複造一個新的顯示介面。
 *
 * @param {Object[]} violations applyRequests_() 回傳的 violations（已經過 decorateViolations_()）
 * @param {string} sheetName 新版本的工作表名稱，用於指示去哪裡看完整清單
 * @returns {string[]} 對話框用的文字行
 */
function buildViolationReportLines_(violations, sheetName) {
  const all = violations || [];
  if (all.length === 0) return ['重跑規則檢查：沒有發現任何違反 ✓'];

  const hard = all.filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  const others = all.filter(function (v) { return v.severity !== RULE_LEVELS.HARD; });

  const describe = function (v) {
    return '　' + v.serviceDate + '　' + v.postNameTC + '#' + v.slotIndex
      + '　' + v.personName + '　' + v.ruleId + '：' + v.reason;
  };
  const listSection = function (items, limit) {
    const lines = items.slice(0, limit).map(describe);
    if (items.length > limit) lines.push('　……另有 ' + (items.length - limit) + ' 項（見下方說明）');
    return lines;
  };

  const lines = ['重跑規則檢查，共 ' + all.length + ' 項違反：'];

  if (hard.length > 0) {
    lines.push('', '⚠️ 硬規則違反：' + hard.length + ' 項（本系統的原則是硬規則絕不自動違反）');
    listSection(hard, 15).forEach(function (l) { lines.push(l); });
  }
  if (others.length > 0) {
    lines.push('', '準硬規則／其他提示：' + others.length + ' 項');
    listSection(others, 10).forEach(function (l) { lines.push(l); });
  }

  lines.push('', '完整清單：打開 ' + sheetName + '，所有違反的格子都已標示底色並附有批註。');
  return lines;
}

/**
 * 追加階段 AW 新增：判斷「硬規則違反是否已被明確放行」的純邏輯，不涉及任何 UI。
 * 抽出來供選單版本（`confirmHardViolationOverride_()`，靠 `ui.prompt()` 取得文字）
 * 與 Web UI 版本（`WebAppFlow.gs`，靠前端表單取得文字）共用同一個判斷準則，
 * 不會出現兩邊「確認放行」四個字打法不一致的情況。
 * @param {Object[]} violations 違規清單（含 severity 欄位）
 * @param {string} releaseText 使用者輸入的文字
 * @returns {boolean} true＝可以放行（沒有硬規則違反，或文字完全等於「確認放行」）
 */
function resolveHardViolationRelease_(violations, releaseText) {
  const hard = (violations || []).filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hard.length === 0) return true;
  return String(releaseText || '').trim() === '確認放行';
}

/**
 * 追加階段 AR 新增：有硬規則違反時，要求幹事以打字方式明確放行，不可以只按一個 OK
 * 就讓流程繼續走下去。
 *
 * 為什麼用「打字確認」而不是 Yes/No：本專案的原則是「硬規則絕不自動違反」，
 * 而 Yes/No 對話框太容易被順手按過去。打字確認是本專案既有的最高強度確認手法
 * （見 Menu.gs 的「安裝自動排程」要求打「確認安裝」、「立即執行自動排程檢查」
 * 要求打「確認執行」），沿用同一套做法，幹事不可能在不知情的情況下放行。
 * 準硬規則不受這道關卡限制，維持原本「顯示出來、按 OK 繼續」的警告方式。
 *
 * 「繼續下去會發生什麼事」因步驟而異，所以由呼叫端傳入 consequenceText——
 * 步驟 5 的下一步就是寄信，步驟 4 的解鎖才是步驟 3 的實際後果，兩者的嚴重性
 * 與時間點都不同，照抄同一句話會誤導幹事。
 *
 * @param {Ui} ui SpreadsheetApp.getUi() 的結果
 * @param {string} quarterId 季度 ID，只用於階段 F 新增的 AuditLog 記錄
 * @param {string} title 對話框標題
 * @param {Object[]} violations applyRequests_() 回傳的 violations
 * @param {string} consequenceText 說明「繼續下去的後果」與「取消的後果」的文字，
 *   見 STEP3_HARD_VIOLATION_CONSEQUENCE／STEP5_HARD_VIOLATION_CONSEQUENCE
 * @returns {boolean} true＝可以繼續（沒有硬規則違反，或幹事已明確放行）
 */
function confirmHardViolationOverride_(ui, quarterId, title, violations, consequenceText) {
  const hard = (violations || []).filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hard.length === 0) return true;

  const response = ui.prompt(
    title + '：有硬規則違反，需要明確放行',
    '這一版有 ' + hard.length + ' 項硬規則違反（詳情見上一個視窗）。\n\n'
      + '本系統的原則是「硬規則絕不自動違反」。\n'
      + consequenceText + '\n\n'
      + '確定要放行的話，請輸入「確認放行」四個字：',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return false;
  if (!resolveHardViolationRelease_(violations, response.getResponseText())) {
    ui.alert(title, '輸入的文字不是「確認放行」，已當作取消，不會寄出任何電郵。\n\n'
      + '新版本已經建立並保留，你可以人手修正之後再執行一次本步驟。', ui.ButtonSet.OK);
    return false;
  }
  logHardViolationRelease_(quarterId, title, hard);
  return true;
}

/**
 * 階段 F 新增：硬規則放行是全系統風險最高的手動操作之一（「硬規則絕不自動
 * 違反」這個原則被明確打破的唯一途徑），原本完全沒有寫入 AuditLog——只有
 * 幹事自己記得曾經放行過什麼。選單版本（`confirmHardViolationOverride_()`）
 * 與 Web UI 版本（`FiveStageCore.gs` 的 `executeStep3Release_()`、
 * `WebAppFlow.gs` 的步驟 5 兩個放行關卡）在各自確認放行成功之後都呼叫這個
 * 共用函式，記錄格式統一。
 * @param {string} quarterId 季度 ID
 * @param {string} stepLabel 對話框標題／步驟名稱，用於區分是哪一步放行的
 * @param {Object[]} hardViolations 被放行的硬規則違反清單（已經篩過 severity=HARD）
 * @returns {void}
 */
function logHardViolationRelease_(quarterId, stepLabel, hardViolations) {
  writeAuditLog_({
    action: '硬規則放行',
    targetSheet: SHEETS.ROSTER_ASSIGNMENTS,
    targetKey: quarterId,
    oldValue: hardViolations.length + ' 項硬規則違反',
    newValue: '已放行（打字輸入「確認放行」）',
    source: stepLabel,
    notes: hardViolations.slice(0, 10).map(function (v) {
      return v.serviceDate + ' ' + (v.postNameTC || v.postId) + '#' + v.slotIndex + ' ' + (v.personName || '') + ' ' + v.ruleId;
    }).join('；') + (hardViolations.length > 10 ? '；……另有 ' + (hardViolations.length - 10) + ' 項' : '')
  });
}

/**
 * 選單項目「列出待補格子」的執行入口：列出指定版本目前所有黃底待補的格子。
 * @returns {void}
 */
function runListPendingBackfillCells_() {
  const ui = SpreadsheetApp.getUi();
  const target = promptQuarterAndVersion_('列出待補格子（唯讀）');
  if (!target) return;

  try {
    const cells = listPendingBackfillCells_(target.quarterId, target.versionNo);

    const rows = [
      diagRow_('待補格子', '（季度／版本）', target.quarterId + ' v' + target.versionNo, ''),
      diagRow_('待補格子', '待補格數', cells.length, '')
    ];
    cells.forEach(function (c) {
      rows.push(diagRow_('待補格子', c.serviceDate + ' ' + c.key, '', c.note));
    });
    tryWriteDiagnostics_('待補格子', rows);

    if (cells.length === 0) {
      ui.alert('列出待補格子（唯讀）',
        target.quarterId + ' v' + target.versionNo + ' 目前沒有待補格子。\n\n' + DIAGNOSTICS_WRITTEN_NOTE,
        ui.ButtonSet.OK);
      return;
    }
    const lines = ['共 ' + cells.length + ' 格待補：', ''];
    cells.forEach(function (c) { lines.push('　' + c.serviceDate + ' ' + c.key + '　' + c.note); });
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);
    ui.alert('列出待補格子（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runListPendingBackfillCells_ 失敗: ' + err.message);
    ui.alert('列出待補格子（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「補建 EmailRecipients 欄位」的執行入口：新增 Role 欄，
 * 現有列 SendAs=CC 者預設 REVIEWER，其餘預設 ALL。
 * @returns {void}
 */
function runSeedEmailRecipientsRole_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planEmailRecipientsRoleSeed_();
  } catch (err) {
    ui.alert('補建 EmailRecipients 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (plan.columnExists && plan.rows.length === 0) {
    ui.alert('補建 EmailRecipients 欄位', 'Role 欄已存在，且全部收件人都已有值，不需要新增。', ui.ButtonSet.OK);
    return;
  }

  const lines = [
    plan.columnExists ? '將在既有的 Role 欄補上以下空格：' : '將新增 Role 欄（append 在最後一欄之後），並填入：',
    ''
  ];
  plan.rows.forEach(function (r) {
    lines.push('　' + (r.displayName || '（無名稱）') + '　SendAs=' + (r.sendAs || '（空白）') + '　→　' + r.value);
  });
  lines.push('', '確定要繼續嗎？');

  if (ui.alert('補建 EmailRecipients 欄位', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const written = seedEmailRecipientsRole_(plan);
    ui.alert('補建 EmailRecipients 欄位', '已填入 ' + written + ' 個收件人的 Role。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedEmailRecipientsRole_ 失敗: ' + err.message);
    ui.alert('補建 EmailRecipients 欄位', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
