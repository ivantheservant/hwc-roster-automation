/**
 * 第二十五輪批次階段 A5：掣 0「生成初稿」嘅後端。
 *
 * 對應 `docs/幹事介面規格.md` 第 2.1 節（本輪改寫：由「自動，沒有掣」
 * 改成「區一 掣 0：生成初稿」）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個檔案，而唔係直接用 `apiGenerateRoster()`
 * ─────────────────────────────────────────────────────────────────────
 *
 * `apiGenerateRoster()`（WebApp.gs）本身冇問題，本輪冇改佢，選單版
 * 亦繼續照用。但幹事介面需要多兩樣佢冇提供嘅嘢：
 *
 * 1. **撳之前**要知會發生咩事（幾多個主日、幾多個崗位、會試幾多次）。
 *    冇呢個，確認畫面就只能寫一句「確定嗎」——而規格 1.4 要求
 *    確認畫面一定要有數字。
 * 2. **撳完之後**要知「開季前準備仲有幾多項未做」。呢個數字唔可以
 *    寫死（例如寫死「還有 3 項」），要真係去問 `apiGetPreQuarterChecklist()`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 執行時間（階段 A7 嘅量度結果）
 * ─────────────────────────────────────────────────────────────────────
 *
 * `generateBest()` **本身已經有時間預算**（`MULTIRUN_TIME_BUDGET_MS`，
 * 現時 180000 毫秒＝3 分鐘）：每跑完一次就量度平均耗時，如果再跑多一次
 * 會超出預算就停低，並且喺結果回傳 `stoppedByTime: true`。
 *
 * 即係話「靜靜跑少幾次令品質下降」**唔會靜靜發生**——次數少咗係有
 * 講明嘅。所以本輪唔需要改細 seed 數，只需要**把 `stoppedByTime`
 * 呈現出嚟**（見 `apiGenerateDraftExecute()` 嘅回傳同前端）。
 *
 * Apps Script 單次執行上限係 6 分鐘，`google.script.run` 亦係同一個配額。
 * 3 分鐘預算用喺多次生成，剩返 3 分鐘俾 `createRosterSheet()`／
 * `writeAssignments()`／`registerVersion()`——實測數字見
 * `docs/系統範圍稽核.md` 第二十五輪嘅表。
 */

/**
 * 撳掣之前：告訴幹事會發生咩事。**全程零寫入。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} 見規格 2.1 嘅確認畫面
 */
function apiGenerateDraftPlan(quarterId) {
  assertWebAppRequestAllowed_();

  const existingVersionNo = findLatestVersionNo(quarterId);
  if (existingVersionNo >= 0) {
    return {
      blocked: true,
      blockReason: 'HAS_VERSION',
      currentVersionNo: existingVersionNo,
      message: buildThreePartMessage_(
        '這一季已經有第 ' + existingVersionNo + ' 版了。',
        '沒有生成任何東西，職事表完全沒有改動。'
          + '「生成初稿」只用在完全沒有版本的時候，所以它不會重複生成。',
        [
          '如果你想改動內容，請在試算表直接改格子，改完撳「儲存並確認」',
          '如果你真的想整份重新排過（會建立新一版，舊版本仍然保留），'
            + '請去「進階功能」',
          '如果你以為這一季還沒生成過，請先重新整理這一頁看看'
        ])
    };
  }

  // 用同一個 context 建構函式，所以數字同真正生成時見到嘅一模一樣，
  // 唔會出現「確認畫面講 13 個主日、生成完變咗 12 個」。
  let context;
  try {
    context = buildGeneratorContext_(quarterId);
  } catch (err) {
    return {
      blocked: true,
      blockReason: 'CONTEXT_ERROR',
      message: buildThreePartMessage_(
        '讀取這一季的資料時出錯了（' + err.message + '）。',
        '沒有生成任何東西，職事表完全沒有改動。',
        [
          '檢查 Quarters 工作表上這一季的 StartDate／EndDate 有沒有填錯',
          '檢查 Posts 與 People 工作表有沒有資料',
          '如果看不出問題，把這句錯誤訊息交給開發者'
        ])
    };
  }

  return {
    blocked: false,
    quarterId: quarterId,
    quarterLabel: buildQuarterLabel_(quarterId),
    serviceDateCount: context.serviceDates.length,
    postCount: context.posts.length,
    attemptsPlanned: readMultiRunAttempts_(),
    timeBudgetMinutes: Math.round(MULTIRUN_TIME_BUDGET_MS / 60000)
  };
}

/**
 * 真正生成。**會寫入**：建 grid 工作表、寫長表、登記版本。
 *
 * ⚠️ 呢度**唔會**開 `beginSheetReadMemo_()`——呢個函式有寫入，
 * 開快取會令寫完之後讀返舊值（見 `SheetReader.gs` 檔頭嘅警告）。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 生成結果；`ok:false` 時附三段式訊息
 */
function apiGenerateDraftExecute(quarterId) {
  assertWebAppRequestAllowed_();

  // 再檢查一次。前端撳掣同後端執行之間可能有人（或者另一個分頁）
  // 已經生成咗——只信 plan 嗰次嘅檢查就會建立兩個版本。
  const existingVersionNo = findLatestVersionNo(quarterId);
  if (existingVersionNo >= 0) {
    return {
      ok: false,
      versionCreated: false,
      message: buildThreePartMessage_(
        '這一季已經有第 ' + existingVersionNo + ' 版，不會重複生成。',
        '沒有生成任何東西，職事表完全沒有改動。'
          + '（可能是你在另一個分頁已經生成過，或者剛剛撳了兩次。）',
        [
          '重新整理這一頁，就會看到已經生成好的初稿',
          '如果想重新生成，請去「進階功能」'
        ])
    };
  }

  let result;
  try {
    result = performRosterGeneration_(quarterId);
  } catch (err) {
    return {
      ok: false,
      versionCreated: false,
      // `performRosterGeneration_()` 對「寫到一半失敗」嗰種情況已經
      // 拋一段寫得好清楚嘅訊息（連人手補救步驟都有），所以呢度**唔會
      // 蓋走佢**，只係包成三段式嘅第一段。
      message: buildThreePartMessage_(
        '生成初稿失敗了。',
        err.message,
        [
          '重新整理這一頁，看看有沒有建立到版本',
          '如果一直失敗，把上面整段文字交給開發者'
        ])
    };
  }

  // ⚠️ 第二十六輪批次階段 A2-1：生成成功之後**順手發佈公開連結**。
  //
  // 點解要喺呢度加：舊選單流程有一步「準備工作 ▸ 發佈公開職事表」，
  // 由幹事自己撳。改成四粒掣之後，**嗰一步冇人接手**——
  // 生成初稿唔發佈、掣 1 喺零改動時唔發佈、掣 2 唔發佈亦唔檢查。
  // 結果就係最自然嗰個次序（生成 → 寄給堂委）會寄出一封冇連結嘅信。
  //
  // 教訓：**每次拆走一個人手步驟，都要問一句「嗰一步本來做緊乜？
  // 而家邊個做？」**
  //
  // 發佈失敗**唔可以**當成生成失敗——版本已經真係建立咗。
  // 照掣 1 嘅做法分開報（見下面 `publishFailed`）。
  const publish = tryPublishPublicRoster_(quarterId);

  // 生成之後嘅「還有 N 項未做」——**一定要真係去問**，唔可以寫死。
  let preQuarter = { undoneItemCount: -1, items: [] };
  try {
    preQuarter = planPreQuarterChecklist_(buildPreQuarterChecklistInputs_(quarterId));
  } catch (err) {
    // 算唔到就報 -1，前端會顯示「（暫時查不到）」。
    // **唔可以當成 0**——嗰個等於話「檢查過，冇嘢要做」。
    log_('WARN', 'apiGenerateDraftExecute：開季前準備算不到：' + err.message);
    preQuarter = { undoneItemCount: -1, items: [], error: err.message };
  }

  const versionRow = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (r) {
    return String(r[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] || '').trim() === quarterId
      && Number(r[COLUMNS.ROSTER_VERSIONS.VERSION_NO]) === result.versionNo;
  })[0];

  return {
    ok: true,
    versionCreated: true,
    versionNo: result.versionNo,
    sheetName: result.sheetName,
    sheetUrl: buildGridSheetUrl_(result.sheetName),
    serviceDateCount: countDistinctServiceDates_(quarterId, result.versionNo),
    postCount: countDistinctPosts_(quarterId, result.versionNo),
    // 「有 N 格未能安排」只計真正排唔到嗰種，唔計「這一週不用排」
    // 同「要人手填」——後兩者唔係問題，混埋一齊報會嚇親幹事。
    genuineGapCount: result.blankBreakdown ? result.blankBreakdown.genuineGapCount : result.blank,
    // ⚠️ 第二十五輪批次階段 C：**呢個數字要同區二用同一個判斷。**
    //
    // 本來用生成結果嗰個 blank 分類統計入面嘅「要人手填」數，
    // 即係「三個崗位全部空格」＝ 13×3 = 39。但區二寫「翻譯未填：0 項（做好了）」，
    // 因為嗰一季根本冇一日需要翻譯。**兩個數字用緊兩套定義**，
    // 幹事見到「39 格要人手填」但區二話做好晒，就會撞板。
    //
    // 而家改為直接由 `planPreQuarterChecklist_()` 嘅結果加總——
    // 即係**同一個函式**，唔係「兩邊各寫一次一樣嘅判斷」。
    // 兩邊各寫一次就一定會有一日分岔（本專案燒過好多次）。
    manualPendingCount: sumManualFillItems_(preQuarter),
    attemptsRun: result.attemptsRun,
    attemptsPlanned: result.attemptsPlanned,
    // 階段 A7：跑少咗次數一定要講出嚟，唔可以靜靜接受一個較差嘅結果。
    stoppedByTime: !!result.stoppedByTime,
    preQuarter: preQuarter,
    unconfirmedSpecials: result.unconfirmedSpecials || [],
    versionExistsInRegistry: !!versionRow,
    // 階段 A2-1：發佈失敗係**黃色警告**，唔係紅色錯誤——版本真係建立咗。
    publishFailed: publish.failed,
    publishFailMessage: publish.message
  };
}

/**
 * 由 `planPreQuarterChecklist_()` 嘅結果加總「真正仲要人手填幾多格」。
 *
 * 只計講員／翻譯／獻花三項——特別主日確認、合堂跳過崗位嗰兩項唔係「格」，
 * 加埋落去個數字就會冇意思。
 *
 * 算唔到（`undoneItemCount === -1`）時回 -1，呼叫端要當成「查不到」
 * 而唔係 0。**唔可以回 0**——0 等於話「檢查過，冇嘢要填」。
 * @param {Object} preQuarter `planPreQuarterChecklist_()` 嘅結果
 * @returns {number} 待填格數；算唔到時 -1
 */
function sumManualFillItems_(preQuarter) {
  if (!preQuarter || preQuarter.undoneItemCount === -1) return -1;
  const MANUAL_FILL_ITEM_IDS = ['preacherEmpty', 'translationEmpty', 'flowerEmpty'];
  return (preQuarter.items || []).reduce(function (sum, item) {
    return MANUAL_FILL_ITEM_IDS.indexOf(item.id) === -1 ? sum : sum + (item.count || 0);
  }, 0);
}

/**
 * 數一數某一版實際排咗幾多個主日。
 *
 * ⚠️ 數字取自**已經寫入嘅長表**，唔係重新算一次 context——
 * 完成畫面應該報「實際做咗啲乜」，唔係「本來打算做啲乜」。
 * 兩者理應一樣，但如果唔一樣，幹事應該見到真嗰個。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {number}
 */
function countDistinctServiceDates_(quarterId, versionNo) {
  return countDistinctAssignmentField_(quarterId, versionNo, COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE);
}

/**
 * 數一數某一版實際涉及幾多個崗位。見 `countDistinctServiceDates_()` 嘅說明。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {number}
 */
function countDistinctPosts_(quarterId, versionNo) {
  return countDistinctAssignmentField_(quarterId, versionNo, COLUMNS.ROSTER_ASSIGNMENTS.POST_ID);
}

/**
 * `countDistinctServiceDates_()`／`countDistinctPosts_()` 嘅共用實作。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} columnKey 要數嘅欄
 * @returns {number} 相異值嘅數目；讀唔到時回 0
 */
function countDistinctAssignmentField_(quarterId, versionNo, columnKey) {
  try {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    const seen = {};
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      const value = String(row[columnKey] === null || row[columnKey] === undefined
        ? '' : row[columnKey]).trim();
      if (value) seen[value] = true;
    });
    return Object.keys(seen).length;
  } catch (err) {
    log_('WARN', 'countDistinctAssignmentField_ 失敗：' + err.message);
    return 0;
  }
}
