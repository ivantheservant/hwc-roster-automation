/**
 * 第二十三輪批次階段 E：掣 2／3／4 嘅共用前置檢查同內容閘。
 *
 * 對應 `docs/幹事介面規格_可入repo版.md` 第 1.5／1.7／2.6／2.7 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 一條總原則（規格 1.7）
 * ─────────────────────────────────────────────────────────────────────
 *
 * > **掣 1 係唯一會改動職事表內容嘅掣。掣 2／3／4 只寄信，永不改內容。**
 *
 * 所以掣 2／3／4 執行之前一律先檢查「有冇未儲存嘅改動」，有就拒絕並指去
 * 掣 1（決定 D5）。
 *
 * 點解要噉：如果掣 2 可以喺「grid 已經改咗但未儲存」嘅情況下寄出，
 * 堂委收到嘅係**舊版本嘅連結**，而幹事以為佢哋睇緊自己啱啱改完嗰版——
 * 呢種「以為寄咗新嘢、其實寄咗舊嘢」係最難察覺嘅一類錯，
 * 因為每一步睇落都成功咗。
 */

/**
 * 規格 1.5：三段式錯誤訊息。**缺一不可。**
 *
 * 只寫技術原因（例如「Stage 不符」）對幹事完全冇用——佢知道出咗事，
 * 但唔知而家個表係咩狀態，亦唔知下一步做咩。
 *
 * @param {string} whatHappened 發生了什麼
 * @param {string} currentState 現在的情況
 * @param {string[]} whatYouCanDo 你可以怎樣做（逐條）
 * @returns {string}
 */
function buildThreePartMessage_(whatHappened, currentState, whatYouCanDo) {
  return '發生了什麼：' + whatHappened + '\n'
    + '現在的情況：' + currentState + '\n'
    + '你可以怎樣做：\n'
    + (whatYouCanDo || []).map(function (s) { return '　・' + s; }).join('\n');
}

/**
 * 掣 2／3／4 嘅共用前置檢查（決定 D5）。三項任一成立即拋錯。
 *
 * 三項係：
 * 1. grid 上有系統認得出嘅人手改動
 * 2. grid 上有系統認不出嘅文字
 * 3. `Requests` 有待處理申報
 *
 * @param {string} quarterId 季度 ID
 * @param {string} actionName 動作名（訊息用），例如「寄給堂委審閱」
 * @returns {void}
 * @throws {Error} 有未儲存改動時拋三段式訊息
 */
function assertNoUnsavedChanges_(quarterId, actionName) {
  const versionNo = findLatestVersionNo(quarterId);
  const state = readDashboardUnsavedState_(quarterId, versionNo);
  if (!state.hasAny) return;

  const bits = [];
  if (state.gridChangeCount > 0) bits.push('你在表上改了 ' + state.gridChangeCount + ' 格');
  if (state.unresolvedCount > 0) bits.push('有 ' + state.unresolvedCount + ' 格的文字系統認不出');
  if (state.pendingRequestCount > 0) bits.push('有 ' + state.pendingRequestCount + ' 筆修改申報未處理');
  // 讀唔到（-1）嗰種情況：唔可以講「零改動」，要誠實講「查不到」。
  if (bits.length === 0) bits.push('系統查不到目前有沒有未儲存的改動（' + (state.error || '原因不明') + '）');

  throw new Error(buildThreePartMessage_(
    bits.join('，') + '，未儲存。',
    '職事表沒有任何改動，第 ' + (versionNo < 0 ? '—' : versionNo)
      + ' 版仍然是最新一版。「' + actionName + '」沒有執行，沒有寄出任何電郵。',
    [
      '先撳「儲存並確認」，把改動儲存成新一版，之後再撳「' + actionName + '」',
      '如果那些改動是打錯的，把那幾格改回原樣，這一粒掣就會重新亮起'
    ]
  ));
}

/**
 * 規格 2.6 第 2 層：掣 3 防重複。
 *
 * `SendLog` 內呢個季度**不論版本、不論 `DRY_RUN`** 只要有任何 `OFFICIAL`
 * 紀錄即拒絕。
 *
 * ⚠️ 點解要「不論版本」：正式發出係一季一次嘅動作。如果按版本判斷，
 * 幹事只要建多一個版本就可以再「正式發出」一次，全體義工會收到第二封
 * 「正式」通知——對佢哋嚟講就係「究竟邊封先算數」。
 *
 * ⚠️ 點解要「不論 DRY_RUN」：DRY_RUN 紀錄代表呢個動作**已經行過一次**。
 * 測試模式下行過，之後轉真實模式再行，中間如果冇人記得清 SendLog，
 * 系統應該提出嚟俾人知，而唔係靜靜再寄一次。
 *
 * @param {string} quarterId 季度 ID
 * @returns {void}
 * @throws {Error} 已經有 OFFICIAL 紀錄時拋三段式訊息
 */
function assertNeverOfficiallySent_(quarterId) {
  const C = COLUMNS.SEND_LOG;
  let lastSentAt = '';
  let count = 0;
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[C.QUARTER_ID] || '').trim() !== quarterId) return;
    if (String(row[C.STAGE] || '').trim() !== MAIL_STAGES.OFFICIAL) return;
    count++;
    const sentAt = String(row[C.SENT_AT] || '');
    if (sentAt && sentAt > lastSentAt) lastSentAt = sentAt;
  });
  if (count === 0) return;

  throw new Error(buildThreePartMessage_(
    '這一季已經正式發出過了（寄出記錄有 ' + count + ' 筆'
      + (lastSentAt ? '，最後一次是 ' + lastSentAt : '') + '）。',
    '沒有寄出任何電郵，職事表沒有任何改動。',
    [
      '如果之後有改動要通知義工，用「改動後重發」——只會寄給安排真的改過的人',
      '如果你認為這是誤判（例如之前只是測試模式試跑），'
        + '要先去「維護 ▸ 清除一批寄出記錄」處理那些紀錄，這一粒才會重新亮起'
    ]
  ));
}

/**
 * 規格 2.7 內容閘：比對最新版本每人嘅派工摘要與上次寄出時記錄嘅
 * `AssignmentHash`，回傳逐個有改動嘅人。
 *
 * 沿用 `computeResendDiff_()`（`ResendFlow.gs`）——**唔喺呢度重寫一次比對
 * 邏輯**。第十八輪就係因為「兩個工具各自實作同一個判斷」而分岔咗。
 *
 * 呢度加嘅係「改咗邊幾格、原本／而家」——規格 2.7 明確要求確認畫面
 * 唔可以只寫數字：`這是幹事唯一一次可以人眼看出「係咪真係想改咁多人」
 * 的關口`。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{versionNo: number, changed: Object[], context: Object}}
 */
function planResendChangedPersons_(quarterId) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');

  const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.RESEND);
  const changed = computeResendDiff_(context).map(function (c) {
    return {
      personId: c.personId,
      nameTC: c.nameTC,
      hasAssignments: c.hasAssignments,
      firstNotifyDueToEmail: !!c.firstNotifyDueToEmail,
      hasEmail: !!(context.peopleById[c.personId] && context.peopleById[c.personId].email),
      // 規格 2.7：確認畫面要列得出「改了哪幾格」，唔可以只寫數字——
      // 呢個係幹事唯一一次可以人眼睇出「係咪真係想改咁多人」嘅關口。
      //
      // ⚠️ **「原本係咩」目前攞唔到。** `buildMailContext_()` 只保留咗
      // 上次寄出嘅 `AssignmentHash`（`lastHashByPerson`），冇保留當時嘅
      // 摘要文字——hash 係單向嘅，還原唔到內容。SendLog 本身有
      // `AssignmentSummary` 欄，但 mail context 冇讀入嚟。
      //
      // 所以呢度只回傳「而家係咩」，`previousSummary` 一律空字串，
      // **而唔係靜靜擺一個似層層嘅值落去**。前端應該顯示「（上次的安排
      // 未有記錄）」而唔係扮到有得比較。
      // 要真正做到並排比較，下一輪要喺 `buildMailContext_()` 加一個
      // `lastSummaryByPerson`（讀 SendLog 嘅 `AssignmentSummary`）。
      previousSummary: '',
      currentSummary: (c.assignments || []).map(function (a) {
        return a.serviceDate + '　' + (context.postNames[a.postId] || a.postId);
      }).join('；')
    };
  });

  return { versionNo: versionNo, changed: changed, context: context };
}
