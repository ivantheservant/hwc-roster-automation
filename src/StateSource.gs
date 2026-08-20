/**
 * 第十九輪批次階段 B：派工狀態嘅**權威來源**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個檔案
 * ─────────────────────────────────────────────────────────────────────
 *
 * 同一個季度嘅同一個版本，系統入面有**兩份**派工資料：
 *
 *   1. `RosterAssignments` 長表 —— 程式讀嘅嗰份（`context.original`）
 *   2. `Roster_XXXXTX_vN` grid 工作表 —— 幹事睇同改嘅嗰份
 *      （`context.gridValues`，由 `readGridPersonIds_()` 讀入）
 *
 * 第十九輪批次撞到嘅 bug：`recomputeLatestVersionViolations_()` 明明拎到
 * 一個同時有 `original` 同 `gridValues` 嘅 context，但寫住
 * `context.original.map(...)` 就算，**靜靜咁揀咗其中一份**。
 *
 * 實際後果（Ivan 喺真實環境行過三次）：
 *   • 步驟 3 報 HARD_ROLE_REQUIRED，訊息叫幹事去 grid 人手修正
 *   • 幹事改咗，grid 顯示新人名
 *   • 重跑步驟 3 —— **仍然報同一項違反，人名仍然係改之前嗰個**
 *   • 再改再跑都一樣，唯一出路變成打「確認放行」
 *
 * 即係話：**硬規則閘實際上形同虛設**——佢淨係得「放行」一個出口，
 * 而閘本身係為咗防止硬規則違反流出去而設嘅。
 *
 * 呢個係第十八輪嗰個 bug class（「缺失被當成有意義嘅值」）嘅第二個
 * 變種：**「兩個真相來源，靜靜噉揀錯咗一個」**。兩者嘅共通點都係
 * ——一個本應該由呼叫端明確表態嘅決定，被一句求其嘅程式碼默默替佢答咗。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 權威來源規則（階段 B1）
 * ─────────────────────────────────────────────────────────────────────
 *
 * **`RosterAssignments` 係唯一嘅 version of record。**
 * grid 唔係第二個資料庫，佢係一個**人手改動嘅輸入緩衝區**。
 *
 * 由呢個定位推出三條規則：
 *
 * | 情境 | 用邊份 | 理由 |
 * |---|---|---|
 * | 幹事可能啱啱改咗 grid 之後嘅規則檢查／驗證 | `GRID_OVERLAY` | 幹事嘅人手決定係最新真相，唔睇就等於叫人做無用功 |
 * | 描述「已經發出咗嘅嘢」（PDF、電郵、公開職事表、ICS、AssignmentHash） | `VERSION_OF_RECORD` | 呢啲嘢對應嘅係一個已定案版本，唔應該被一個未 materialise 嘅草稿改動影響 |
 * | 歷史統計（`quarterCount`、`lastServed`、歸檔） | `VERSION_OF_RECORD` | 同上 |
 *
 * 第三條、亦係最重要嗰條：
 *
 * > **人手改動一經被規則檢查採用，就必須喺同一個流程入面
 * > materialise 成一個新版本。**
 *
 * 唔可以出現「規則檢查睇到新人名、但 `RosterAssignments` 仲係舊人名」
 * 呢個中間狀態——全專案有 26 個地方讀 `RosterAssignments`（個人 PDF、
 * AssignmentSummary、AssignmentHash、公開職事表、ICS……），留低唔一致
 * 嘅話，幹事見到嘅同義工收到嘅會唔同，比原本個 bug 更嚴重。
 * 見 `materialiseManualEdits_()`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點樣令呢種錯誤日後唔可以靜靜發生（階段 B2）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 規矩：**凡是 context 同時有 `original` 同 `gridValues`，攞派工狀態
 * 一律要行 `resolveAuthoritativeState_(context, mode)`，`mode` 一定要
 * 明確傳。** 唔可以再 `context.original.map(...)` 就算。
 *
 * `mode` 冇傳／傳錯 ⇒ **拋錯**，唔會靜靜噉揀一個。呢個同第十八輪嘅
 * `requireRoleContextField_()` 係同一套做法：令「冇表態」變成大聲失敗，
 * 而唔係悄悄選一個最方便嘅答案。
 *
 * `tools/scan-static-risks.js` 會掃全專案，搵返「拎到兩個來源但直接
 * 攞其中一個」嘅寫法。
 */

/** 派工狀態嘅來源模式。 */
const STATE_SOURCE = {
  /**
   * `RosterAssignments` 長表——已定案版本嘅權威內容。
   * 用喺：已發出內容、歷史統計、任何唔應該被未確認草稿改動影響嘅地方。
   */
  VERSION_OF_RECORD: 'VERSION_OF_RECORD',

  /**
   * 以 `RosterAssignments` 為底，疊上 grid 工作表上嘅人手改動。
   * 用喺：幹事可能啱啱改完 grid 之後跑嘅規則檢查／驗證／套用申報。
   * 有人手改動嘅格 `isManual = true`。
   */
  GRID_OVERLAY: 'GRID_OVERLAY'
};

/**
 * 攞一份派工狀態，**由呼叫端明確指定要邊一個來源**。
 *
 * @param {Object} context `buildFineTuneContext_()` 嘅結果
 * @param {string} mode `STATE_SOURCE` 其中一個值（必須明確傳）
 * @param {string} callerName 呼叫者名（出錯訊息用）
 * @returns {{state: Object[], changes: Object[], unresolved: Object[]}}
 *   `state` 逐格派工；`changes`／`unresolved` 只有 GRID_OVERLAY 模式有內容
 */
function resolveAuthoritativeState_(context, mode, callerName) {
  if (mode !== STATE_SOURCE.VERSION_OF_RECORD && mode !== STATE_SOURCE.GRID_OVERLAY) {
    throw new Error(
      '取得派工狀態時必須明確指定來源（' + (callerName || '呼叫者不明') + '）。\n\n'
      + '收到的 mode 是：' + (mode === undefined ? 'undefined（完全沒有傳）' : JSON.stringify(mode)) + '\n\n'
      + '⚠️ 這個參數不可以省略，也不會有預設值。同一個版本有兩份派工資料：\n'
      + '  • `RosterAssignments` 長表（程式讀的）\n'
      + '  • `Roster_XXXXTX_vN` grid 工作表（幹事看和改的）\n\n'
      + '兩者在「幹事剛剛人手改過 grid」的時候並不相同，靜靜挑其中一份\n'
      + '就是第十九輪批次那個 bug——步驟 3 一直讀長表，所以幹事改幾多次\n'
      + 'grid 都仍然報同一項違反、人名還是改之前那個，硬規則閘變成只有\n'
      + '「放行」一個出口。\n\n'
      + '請明確傳其中一個：\n'
      + '  • `STATE_SOURCE.GRID_OVERLAY`——幹事可能剛改過 grid 之後的規則檢查／驗證／套用申報\n'
      + '  • `STATE_SOURCE.VERSION_OF_RECORD`——已發出內容（PDF／電郵／公開職事表／ICS／hash）與歷史統計\n\n'
      + '判斷準則寫在 `src/StateSource.gs` 檔案開頭，以及\n'
      + '`docs/系統範圍稽核.md` 第十九輪批次那一節。'
    );
  }

  if (mode === STATE_SOURCE.VERSION_OF_RECORD) {
    return {
      state: context.original.map(function (a) {
        return {
          serviceDateId: a.serviceDateId,
          serviceDate: a.serviceDate,
          postId: a.postId,
          slotIndex: a.slotIndex,
          personId: a.personId,
          isManual: false
        };
      }),
      changes: [],
      unresolved: []
    };
  }

  // GRID_OVERLAY：疊加邏輯只有一份實作，就係 analyseManualState_()。
  // 唔喺呢度重寫一次——第十八輪階段 C 就係因為「兩個工具各自實作同一個
  // 收窄邏輯」而分岔咗，唔應該再犯。
  const overlay = buildGridOverlayState_(context);
  return {
    state: overlay.manualState,
    changes: overlay.changes,
    unresolved: overlay.unresolved
  };
}

/**
 * 把幹事喺 grid 上嘅人手改動 materialise 成一個新版本。
 *
 * 階段 A2 嘅決定——完整推導見 `docs/系統範圍稽核.md`。簡述：
 *
 * 兩個方向都有代價。**唔寫返**會令 grid 同 `RosterAssignments` 長期
 * 唔一致，而全專案有 26 個地方讀後者（個人 PDF、AssignmentSummary、
 * AssignmentHash、公開職事表、ICS……），即係「幹事見到改咗、義工收到
 * 嘅仲係舊人名」——比原本個 bug 更嚴重、而且更難察覺。
 *
 * **寫返**嘅代價係「人手改動繞過版本機制、審計軌跡會斷」。但呢個代價
 * 可以消除：唔好就地改舊版本嗰啲列，而係**開一個新版本**。噉樣
 * 版本機制冇被繞過（改動有自己嘅版本號、舊版本原封不動、可以對比），
 * 審計軌跡亦都完整（逐格寫 AuditLog）。
 *
 * 所以揀咗寫返，而且沿用系統本身已經有嘅做法——`applyFineTuneDecisions_()`
 * 一路以嚟就係噉處理人手改動嘅（`ASSIGN_SOURCE.MANUAL`）。呢度唔係
 * 發明新機制，係補返一個一直欠咗嘅入口：「淨係有人手改動、冇提案、
 * 冇待處理申報」嗰條路之前冇人接。
 *
 * @param {Object} context `buildFineTuneContext_()` 嘅結果
 * @param {Object[]} changes `resolveAuthoritativeState_(..., GRID_OVERLAY)` 嘅 changes
 * @param {Object[]} state 疊加後嘅逐格狀態
 * @param {string} source 呼叫來源（寫入 AuditLog）
 * @returns {{versionNo: number, sheetName: string, cellCount: number}}
 */
function materialiseManualEdits_(context, changes, state, source) {
  // ⚠️ 第三十輪批次階段 A2：呢個函式**同時收 context 同 state，而且
  // context 行先**——同 `findStateViolations_()` 啱啱相反。
  // 兩個次序相反嘅函式喺同一條路徑上面（`apiSaveAndConfirmExecute()`
  // 兩個都叫），係最易寫錯嗰種形狀，所以兩邊都要防線。
  requireContextArg_('materialiseManualEdits_', 1, context, ['posts', 'serviceDates']);
  requireStateArg_('materialiseManualEdits_', 3, state, 'source');

  if (!changes || changes.length === 0) {
    throw new Error('materialiseManualEdits_() 沒有收到任何人手改動，不應該建立新版本');
  }

  const originalByKey = {};
  context.original.forEach(function (a) {
    originalByKey[cellKey_(a.serviceDate, a.postId, a.slotIndex)] = a;
  });

  const assignments = state.map(function (s) {
    const originalRow = originalByKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] || {};
    const person = context.peopleById[s.personId];
    return {
      serviceDateId: s.serviceDateId,
      serviceDate: s.serviceDate,
      postId: s.postId,
      slotIndex: s.slotIndex,
      personId: s.personId || '',
      // ─────────────────────────────────────────────────────────────
      // ⚠️ 第三十六輪批次 A 組：**自由文字唔可以喺呢度蒸發。**
      // ─────────────────────────────────────────────────────────────
      //
      // 原本寫死 `person ? person.nameTC : ''`。而 `person` 係
      // `context.peopleById[s.personId]`——非自動崗位（講員／翻譯／獻花）
      // 嘅格**冇 `personId`**（外請講員唔喺 `NameMapping`，亦都唔應該喺），
      // 所以 `person` 永遠 undefined ⇒ 名字被寫成空字串。
      //
      // 現場（2027T3）：`Roster_2027T3_v2` 嘅 2027-07-04 講員係一位客席講員，
      // 撳「儲存並確認」建立新版本之後變成「⚠ 未能安排」。
      // 幹事開季前要填 13 個講員、13 個獻花，一撳就全部唔見，
      // 而且**冇任何錯誤訊息**。呢個係資料遺失，唔係顯示問題。
      //
      // ⚠️ 成因係一個滑坡：Prompt Q 把「非自動崗位**唔參與偵測**」做到了，
      // 但「唔參與偵測」被連帶做成「唔寫入新版本」——**兩件事**。
      // 佢哋唔參與偵測、唔參與規則檢查，但**一定要被複製**。
      //
      // 規則同 `applyRequests_()`（RequestsApply.gs 第 384 行）一致：
      //   認到人 ⇒ 用正式姓名（人手改動嘅格會行呢條）
      //   認唔到而且係人手改動 ⇒ 空（`unresolved` 已經擋住，行唔到呢度）
      //   認唔到而且**唔係**人手改動 ⇒ **原封不動搬上一版嗰個字**
      personName: person ? person.nameTC : (s.isManual ? '' : (originalRow.personName || '')),
      // ⚠️ 第三十七輪批次 A 組（第二處）：**唔可以淨係睇 `personId` 就當
      // 呢一格係 SKIPPED。**
      //
      // 原本寫 `s.personId ? … : ASSIGN_SOURCE.SKIPPED`。自由文字嗰啲格
      // 冇 `personId`，所以佢原本嘅 `MANUAL`（由「填講員／翻譯／獻花」
      // 寫入）會被覆寫成 `SKIPPED`——又一次「解析唔到人 ⇒ 當冇嘢」。
      //
      // 呢個係上一輪嗰條共用斷言加咗 `assignSource` 之後先揪到嘅：
      //   `2027-07-04|PREACH|1　assignSource：「MANUAL」 → 「SKIPPED」`
      //
      // 規則：冇被人手改動嘅格，**來源原封不動搬**（唔理有冇 personId）。
      assignSource: s.isManual
        ? (s.personId ? ASSIGN_SOURCE.MANUAL : ASSIGN_SOURCE.SKIPPED)
        : (originalRow.assignSource
          || (s.personId ? ASSIGN_SOURCE.AUTO : ASSIGN_SOURCE.SKIPPED)),
      // ─────────────────────────────────────────────────────────────
      // ⚠️ 第三十四輪批次甲5：**跳過原因一定要帶落去，唔可以寫死空陣列。**
      // ─────────────────────────────────────────────────────────────
      //
      // 原本呢度寫死 `ruleFlags: []`。實測後果（2027T3 v2 嘅完整版 PDF 圖例）：
      //
      //   （姓名）　系統自動安排　　194 格
      //   待確認　　此崗位不由系統自動安排　　0 格　← 應該係 39
      //   —　　　　這一週不設此崗位　　　　　0 格　← 應該係 40
      //   ⚠ 未能安排　系統找不到合資格而當日又有空的人　79 格　← 應該係 0
      //
      // 273 總格 − 194 有派人 = 79，同「未能安排」一模一樣。即係**冇做分類**，
      // 而係把所有冇派人嘅格整批倒入最後一個桶。
      //
      // 成因就係呢一行：`classifyGridCell_()`（FineTune.gs）要靠 `ruleFlags`
      // 先分得出「待確認／—／特殊主日／未能安排」。冇原因 ⇒ 分唔出 ⇒ 全部當成
      // 「系統排唔到」。呢個係本專案 bug class 第 2 條（缺失被當成正常值）
      // 同第 5 條（冇分開「系統要排」同「不自動排」）。
      //
      // ⚠️ 呢份 PDF 係寄俾每一位義工嘅附件。上線之後全體會收到一份寫住
      // 「系統有 79 格排唔到」嘅職事表，而事實係零格排唔到。
      //
      // 規則同 `applyRequests_()`（RequestsApply.gs 第 445 行）一致——
      // 嗰條路一路以嚟都係 `a.ruleFlags.slice()` 原樣帶落去，所以
      // 2027T2 v1（REQUESTS_APPLIED）嘅圖例一直都係啱嘅。
      //
      // **冇被人手改動嘅格：原因原封不動保留**（唔理佢有冇人——
      // 有人嗰啲帶住嘅係規則警告，一樣要跟住新版本行）。
      // **被人手改動嘅格：清空**——舊原因描述嘅係舊嗰個佔用者，
      // 幹事已經親手覆寫咗，留住就會變成一個講緊另一件事嘅標籤。
      ruleFlags: s.isManual ? [] : ((originalRow.ruleFlags || []).slice())
    };
  });

  const newVersionNo = findLatestVersionNo(context.quarterId) + 1;

  // 逐格寫 AuditLog：邊格、由邊個變邊個。時間同帳戶由 writeAuditLog_() 自己補。
  changes.forEach(function (c) {
    writeAuditLog_({
      action: 'MANUAL_GRID_EDIT_MATERIALISED',
      targetSheet: buildRosterSheetName_(context.quarterId, context.versionNo),
      targetKey: cellKey_(c.serviceDate, c.postId, c.slotIndex),
      oldValue: c.originalName || c.originalPersonId || '（空白）',
      newValue: c.manualText || '（空白）',
      source: source,
      notes: '幹事在 grid 人手改動，已 materialise 為 v' + newVersionNo
        + '（原版本 v' + context.versionNo + ' 保持不變）'
    });
  });

  const sheetName = createRosterSheet(context.quarterId, newVersionNo, assignments, []);
  writeAssignments(context.quarterId, newVersionNo, assignments);

  return { versionNo: newVersionNo, sheetName: sheetName, cellCount: changes.length };
}

/**
 * 選單：人手改動預覽（唯讀）。
 *
 * 第十九輪批次階段 A2／C3。用途：喺 grid 改咗人名之後，睇清楚系統認唔認得
 * 你嘅改動、規則檢查會唔會過，**先唔寫任何嘢**。
 * @returns {void}
 */
function runManualEditsPreview_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('人手改動預覽（唯讀）',
    '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    ui.alert('人手改動預覽（唯讀）', '找不到 ' + quarterId + ' 已生成的版本。', ui.ButtonSet.OK);
    return;
  }

  const recomputed = recomputeLatestVersionState_(quarterId, versionNo);
  ui.alert('人手改動預覽（唯讀）',
    buildManualEditsReportText_(quarterId, versionNo, recomputed)
      + '\n\n（本工具只讀取，沒有改動任何東西。）',
    ui.ButtonSet.OK);
}

/**
 * 選單：把工作表的人手改動寫成新版本。
 *
 * 第十九輪批次階段 A2／C3——「幹事喺 grid 人手改動」嘅唯一合法出口。
 *
 * **特登唔檢查 Stage。** Stage 鎖死（例如已經 OFFICIAL_SENT）嗰陣，
 * 幹事一樣有可能需要修正一格排錯咗嘅安排；如果連呢個都做唔到，
 * 就會出現第十九輪階段 C 嗰種「冇合法補救途徑、要靠副作用救返」嘅局面。
 *
 * 呢個動作本身係安全嘅：只係開一個新版本（舊版本原封不動），
 * 唔會前進 Stage、唔會產生 PDF、唔會寄任何電郵。
 * @returns {void}
 */
function runMaterialiseManualEdits_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('⚠️ 把工作表的人手改動寫成新版本',
    '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    ui.alert('把工作表的人手改動寫成新版本', '找不到 ' + quarterId + ' 已生成的版本。', ui.ButtonSet.OK);
    return;
  }

  const recomputed = recomputeLatestVersionState_(quarterId, versionNo);

  if (recomputed.unresolved.length > 0) {
    ui.alert('把工作表的人手改動寫成新版本（有格認不出姓名）',
      buildManualEditsReportText_(quarterId, versionNo, recomputed)
        + '\n\n' + buildUnresolvedGuidanceText_(recomputed.unresolved),
      ui.ButtonSet.OK);
    return;
  }
  if (recomputed.changes.length === 0) {
    ui.alert('把工作表的人手改動寫成新版本',
      buildRosterSheetName_(quarterId, versionNo)
        + ' 上沒有偵測到任何人手改動，不需要建立新版本。', ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert('⚠️ 把工作表的人手改動寫成新版本',
    buildManualEditsReportText_(quarterId, versionNo, recomputed)
      + '\n\n按「是」就會把這些改動寫成新版本 v' + (versionNo + 1) + '。\n'
      + '原版本 v' + versionNo + ' 保持不變，可以對照。\n'
      + '每一格改動都會記入 AuditLog。\n\n'
      + '這個動作不會前進 Stage、不會產生 PDF、不會寄出任何電郵。\n'
      + '⚠️ 但之後的步驟（個人 PDF、正式發出、公開職事表）一律會改用新版本。',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  const result = materialiseManualEdits_(
    recomputed.context, recomputed.changes, recomputed.state, 'manualEditsMenu');

  ui.alert('把工作表的人手改動寫成新版本（完成）',
    '已建立 ' + result.sheetName + '（v' + result.versionNo + '），'
      + '帶入 ' + result.cellCount + ' 格人手改動。\n'
      + '原版本 v' + versionNo + ' 保持不變。\n\n'
      + '如果這一季已經正式發出過，記得跑「步驟 5：改動後重發」'
      + '通知受影響的義工。', ui.ButtonSet.OK);
}

/**
 * 把人手改動的分析結果整理成人看得懂的文字。預覽與寫入前的確認共用。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} recomputed `recomputeLatestVersionState_()` 的結果
 * @returns {string} 報告文字
 */
function buildManualEditsReportText_(quarterId, versionNo, recomputed) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const lines = [sheetName + ' 目前的狀況：', ''];

  if (recomputed.changes.length === 0) {
    lines.push('　偵測到的人手改動：0 格');
  } else {
    lines.push('　偵測到的人手改動：' + recomputed.changes.length + ' 格');
    recomputed.changes.slice(0, 15).forEach(function (c) {
      lines.push('　　• ' + c.serviceDate + '　' + c.postId + '　'
        + (c.originalName || '（空白）') + ' → ' + (c.manualText || '（空白）'));
    });
    if (recomputed.changes.length > 15) {
      lines.push('　　……另有 ' + (recomputed.changes.length - 15) + ' 格');
    }
  }

  if (recomputed.unresolved.length > 0) {
    lines.push('');
    lines.push('　⚠️ 認不出是哪一位的格：' + recomputed.unresolved.length + ' 格');
    recomputed.unresolved.slice(0, 10).forEach(function (u) {
      lines.push('　　• ' + u.serviceDate + '　' + u.postId + '　填了「' + u.text + '」'
        + '（本來應該是「' + (u.expectedText || '（空白）') + '」）');
    });
  }

  lines.push('');
  const hard = recomputed.violations.filter(function (v) {
    return v.severity === RULE_LEVELS.HARD;
  });
  lines.push('　計入這些改動之後的規則檢查：硬規則違反 ' + hard.length + ' 項、'
    + '合計 ' + recomputed.violations.length + ' 項');
  return lines.join('\n');
}

/**
 * 第二十輪批次階段 C1：講清楚「認唔出」嗰幾格應該點處理。
 *
 * 修正之前得一句「請改用 People 工作表上的正式姓名（或別名）」——
 * 冇講邊一格、冇講而家格入面係咩、冇講系統喺邊度搵過、亦冇講
 * 「本來應該係咩」。幹事收到呢句其實唔知道應該做乜。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 階段 C2 嘅決定：**唔容許「跳過認唔出嘅格、只寫其餘改動」**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 考慮過三個做法：
 *
 * | 做法 | 問題 |
 * |---|---|
 * | 部分寫入（跳過認唔出嗰幾格） | 幹事以為全部改動都入咗版本，實際上有幾格冇——grid 同版本更加唔一致，而且冇人知邊幾格。呢個正正就係第十九輪要根治嘅嘢 |
 * | 把認唔出嘅格標色叫人逐個處理 | 要寫入 grid（本輪禁止），而且底色語意撞車喺第八輪已經食過一次虧 |
 * | **整批拒絕 ＋ 講清楚點修**（採用） | 幹事要多做一步，但狀態永遠一致：「全部認得出」先寫，否則乜都唔寫 |
 *
 * 揀第三個嘅理由：**呢個工具嘅賣點就係「grid 同版本會一致」**。
 * 一個會製造新不一致嘅「方便」，等於把工具本身嘅價值拆咗。
 * 而且認唔出嘅格通常只有一兩格（打錯字／用咗未登記嘅別名），
 * 修返嘅成本遠低過「日後發現有幾格冇入版本」嘅代價。
 *
 * @param {Object[]} unresolved `buildGridOverlayState_()` 嘅 unresolved
 * @returns {string} 指引文字
 */
function buildUnresolvedGuidanceText_(unresolved) {
  const lines = [
    '⚠️ 有 ' + unresolved.length + ' 格認不出是哪一位，所以整批都不會寫入：',
    ''
  ];

  unresolved.slice(0, 10).forEach(function (u) {
    lines.push('　• ' + u.serviceDate + '　' + u.postId
      + (Number(u.slotIndex) > 1 ? '（第 ' + u.slotIndex + ' 位）' : ''));
    lines.push('　　格內現在是：「' + u.text + '」');
    lines.push('　　這一格本來應該是：「' + (u.expectedText || '（空白）') + '」');
  });
  if (unresolved.length > 10) {
    lines.push('　……另有 ' + (unresolved.length - 10) + ' 格');
  }

  lines.push('');
  lines.push('系統是這樣找的：把格內文字拿去 ' + SHEETS.NAME_MAPPING
    + ' 工作表比對「姓名」與「別名」兩欄（前後空白會自動去掉，'
    + '全形字元會自動正規化），找不到就當作認不出。');
  lines.push('');
  lines.push('可以這樣修（三選一）：');
  lines.push('　1. 把那一格改成 ' + SHEETS.NAME_MAPPING + ' 上的正式姓名——最直接；');
  lines.push('　2. 如果那真的是同一個人的另一個叫法，去 ' + SHEETS.NAME_MAPPING
    + ' 的「別名」欄加上去，之後這個叫法就一直認得；');
  lines.push('　3. 如果那一格本來就不該有人（例如你想改回原狀），'
    + '把它改回上面寫的「本來應該是」那個文字。');
  lines.push('');
  lines.push('為什麼是整批拒絕、不是跳過那幾格：這個工具的用途就是'
    + '「讓 grid 跟版本一致」。');
  lines.push('如果跳過認不出的格照樣寫入，你會以為全部改動都入了版本，'
    + '實際上有幾格沒有——');
  lines.push('那就製造了一個新的、而且沒有人知道的不一致，'
    + '比多修一格的麻煩嚴重得多。');
  return lines.join('\n');
}
