/**
 * 階段 B 新增（第十四輪批次階段 C 加入獻花）：「準備工作 ▸ 填寫講員／翻譯／獻花」。
 *
 * 講員、翻譯、獻花呢三個崗位（見 roster_patterns_rules.md 第四節）由
 * `Posts.AutoGenerate=FALSE` 控制，系統從不自動派人，一直以來幹事只能直接打開
 * grid 工作表、在最右邊嗰幾欄手動輸入——呢個工具提供一個側邊欄，一次列晒目前
 * 最新版本全部三個崗位仲空著嘅格子（唔使逐個崗位開一次工具），逐格填寫，唔需要
 * 直接編輯工作表，填寫後同時寫入 grid 工作表、`RosterAssignments` 與 `AuditLog`。
 *
 * 呢三個崗位都唔受 Eligibility 限制（跟其他崗位不同，見 `getSkipReason_()` 完全
 * 唔檢查 `NameMapping`／`Eligibility`），輸入嘅名字都唔強制對應到 `NameMapping`
 * 裡面嘅人——常任講員通常係牧師，客席講員可能每季度都唔同、系統從未見過嘅名字；
 * 獻花係由會友自行認獻，未必每次都係同一班人。呢個係刻意嘅設計，唔係漏做驗證。
 * 如果輸入嘅名字啱啱好完全符合 `NameMapping.NameTC`，會自動連結 `PersonID`
 * （供日後統計使用）；對唔上就 `PersonID` 留空、只記文字快照，兩種情況功能上
 * 完全一樣，都能正常顯示在職事表與 PDF 上。
 *
 * **獻花嘅特性同講員／翻譯唔同：由會友認獻，唔係每週都有人**——呢個工具刻意
 * **唔強制**成個季度嘅獻花格都要填。留空唔撳「儲存」就得（同 `PublicRoster.gs`
 * 嘅 `blankNote` 一致：`EmptyDisplay=BLANK` 嘅格喺對外版面本身就會顯示做完全
 * 空白，唔係一個「錯漏」訊號，見 `docs/GoogleSheetsAPI限制.md` 同期加入嘅
 * 圖例「（空白）」一行解釋）。呢個工具冇提供「明確標記呢一週冇人認獻」呢個
 * 額外動作——同「乜都唔做」效果完全一樣，加多一個動作只會增加操作步驟，冇
 * 實質分別。
 *
 * 「歷史上出現過嘅名單」唔係寫死喺程式碼入面嘅名字清單（噉樣真實姓名會出現
 * 喺公開嘅原始碼入面，亦都會喺人選異動之後過時）——而係即時由 `RosterAssignments`
 * 統計呢個崗位過去實際出現過嘅姓名快照，依次數排序攞前幾位，資料自然跟住
 * 季度更新。
 *
 * ## C4：點解填寫之後直接寫入最新版本，唔建立新版本
 *
 * 三個理由：
 * 1. **唔應該觸發規則重檢**——講員／翻譯／獻花完全唔受 `Eligibility`／硬規則
 *    約束（見上面），建新版本本身就係為咗重新跑一次 `Generator.gs` 嘅規則
 *    判斷，呢度完全用唔著。
 * 2. **唔應該影響 `QuarterStage`**——建新版本係「步驟 1：生成初稿」／「步驟 3：
 *    套用申報」呢類會推進流程狀態嘅動作，填寫講員呢類補充資料唔屬於流程推進
 *    嘅其中一步，唔應該連帶推咗 Stage。
 * 3. **唔應該令已寄出嘅通知變成「有改動」**——`ResendFlow.gs` 嘅
 *    `computeResendDiff_()` 係按「呢個人自己嘅派工組合」計 hash 嚟判斷邊個人
 *    嘅內容變咗，唔係按版本號整個比對。直接寫入現有版本嘅
 *    `RosterAssignments`，對「呢個崗位嘅人自己」嚟講，佢由「冇派工」變成
 *    「有一格派工」，hash 本來就應該變（佢應該收到通知，呢個係啱嘅）；但對
 *    其他完全冇被呢次填寫觸及嘅人嚟講，佢哋自己嗰組派工完全冇被寫入動過，
 *    hash 一樣冇變，唔會被誤判成「內容改咗」而收到唔必要嘅重發通知。如果
 *    改成建新版本，會令**成個版本號**都變咗，容易誤導成「呢一版全部人嘅內容
 *    都可能唔同咗」，反而模糊咗「其實淨係填咗幾個崗位」呢件事嘅範圍。
 */

/**
 * 依 PostName_TC 精確比對，找出「講員」「翻譯」「獻花」三個崗位的 PostID。
 * 找不到時對應欄位回傳 null（呼叫端要處理，不強制要求三個都存在）。
 * @returns {{preacherPostId: ?string, translationPostId: ?string, flowerPostId: ?string}}
 */
function findPreacherTranslationPostIds_() {
  const posts = readPosts();
  let preacherPostId = null;
  let translationPostId = null;
  let flowerPostId = null;
  posts.forEach(function (row) {
    const name = String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim();
    if (name === '講員') preacherPostId = row[COLUMNS.POSTS.POST_ID];
    if (name === '翻譯') translationPostId = row[COLUMNS.POSTS.POST_ID];
    if (name === '獻花') flowerPostId = row[COLUMNS.POSTS.POST_ID];
  });
  return { preacherPostId: preacherPostId, translationPostId: translationPostId, flowerPostId: flowerPostId };
}

/**
 * 統計某崗位歷史上（全部季度）出現過的姓名快照，依次數由多到少排序。
 * 用 RosterAssignments 的 PersonNameSnapshot，不要求對應到 NameMapping——
 * 講員可能從來不在 NameMapping 裡。
 * @param {string} postId 崗位 ID
 * @param {number} limit 最多回傳幾個建議
 * @returns {string[]} 建議名單，由常見到罕見排序
 */
function suggestHistoricalNames_(postId, limit) {
  if (!postId) return [];
  const counts = {};
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID] !== postId) return;
    const name = String(row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT] || '').trim();
    if (!name) return;
    counts[name] = (counts[name] || 0) + 1;
  });
  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, limit || 8);
}

/**
 * 側邊欄用：列出指定季度最新版本目前還空著的講員／翻譯／獻花格子，附上建議
 * 名單與 Stage 提示。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, stage: string,
 *   officialSentHint: boolean, preacherSuggestions: string[],
 *   translationSuggestions: string[], flowerSuggestions: string[],
 *   pending: Object[]}} `pending` 每項另有 `optional: boolean`（獻花為
 *   `true`——留空唔填係正常情況，唔係漏做）
 */
function apiListPreacherTranslationPending(quarterId) {
  const ids = findPreacherTranslationPostIds_();
  if (!ids.preacherPostId && !ids.translationPostId && !ids.flowerPostId) {
    throw new Error('Posts 工作表找不到名稱為「講員」「翻譯」或「獻花」的崗位，無法使用這個工具。'
      + '請檢查 Posts.PostName_TC 是否跟這幾個字完全一致。');
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error(buildQuarterNotFoundMessage_(quarterId));

  const postNameById = {};
  readPosts().forEach(function (row) {
    postNameById[row[COLUMNS.POSTS.POST_ID]] = row[COLUMNS.POSTS.POST_NAME_TC];
  });
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const weekIndexByDate = {};
  readServiceDates(quarterId).forEach(function (row) {
    weekIndexByDate[toDateString(row[COLUMNS.SERVICE_DATES.SERVICE_DATE], timezone)] =
      Number(row[COLUMNS.SERVICE_DATES.WEEK_INDEX]);
  });

  const targetPostIds = [ids.preacherPostId, ids.translationPostId, ids.flowerPostId].filter(Boolean);
  const pending = [];
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] !== quarterId) return;
    if (Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) !== versionNo) return;
    const postId = row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID];
    if (targetPostIds.indexOf(postId) === -1) return;
    if (row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] || row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT]) return;

    const serviceDate = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    pending.push({
      serviceDate: serviceDate,
      weekIndex: weekIndexByDate[serviceDate] || 0,
      postId: postId,
      postName: postNameById[postId] || postId,
      slotIndex: Number(row[COLUMNS.ROSTER_ASSIGNMENTS.SLOT_INDEX]),
      // 獻花由會友認獻、不是每週都有人——留空是正常情況，UI 據此顯示唔同嘅
      // 提示文字，唔會令幹事誤以為每一格都一定要填先算完成。
      optional: postId === ids.flowerPostId
    });
  });
  pending.sort(function (a, b) {
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
    return a.postId < b.postId ? -1 : 1;
  });

  const preacherSuggestions = suggestHistoricalNames_(ids.preacherPostId, 8);
  const translationSuggestions = suggestHistoricalNames_(ids.translationPostId, 8);
  const flowerSuggestions = suggestHistoricalNames_(ids.flowerPostId, 8);

  // 第二十五輪批次階段 C：**逐個 PostID 索引嘅建議名單。**
  //
  // 點解要加呢個：三條建議名單本來只喺頂層，用三個唔同嘅欄名。前端要
  // 知道「呢一格屬於邊條名單」就只能靠崗位名稱做字串比對
  // （`postName === '講員'` 之類）——而崗位名稱係幹事可以喺 Posts
  // 工作表自由改嘅，改一次就會靜靜咁令全部建議下拉變空白，
  // **而且畫面唔會報錯**，只係「冇建議」，睇落好似本來就係噉。
  //
  // 用 PostID 做 key 就冇呢個問題：前端寫 `suggestionsByPostId[cell.postId]`，
  // 而 `postId` 本身就係後端逐格畀嘅，兩邊講緊同一樣嘢。
  //
  // 三個舊欄位冇刪——側邊欄（PreacherFillSidebar.html）仲用緊。
  const suggestionsByPostId = {};
  if (ids.preacherPostId) suggestionsByPostId[ids.preacherPostId] = preacherSuggestions;
  if (ids.translationPostId) suggestionsByPostId[ids.translationPostId] = translationSuggestions;
  if (ids.flowerPostId) suggestionsByPostId[ids.flowerPostId] = flowerSuggestions;

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    stage: getQuarterStage_(quarterId),
    officialSentHint: getQuarterStage_(quarterId) === QUARTER_STAGE.OFFICIAL_SENT,
    preacherSuggestions: preacherSuggestions,
    translationSuggestions: translationSuggestions,
    flowerSuggestions: flowerSuggestions,
    suggestionsByPostId: suggestionsByPostId,
    pending: pending
  };
}

/**
 * 側邊欄用：儲存單一格的講員／翻譯姓名。同時更新 RosterAssignments 長表、
 * grid 工作表對應儲存格、寫一筆 AuditLog。
 * @param {string} quarterId 季度 ID
 * @param {string} serviceDate 主日日期（yyyy-MM-dd）
 * @param {string} postId 崗位 ID
 * @param {number} slotIndex slot 編號
 * @param {string} name 要填入的姓名（自由文字，不強制對應 NameMapping）
 * @returns {{personId: string, linkedToNameMapping: boolean}}
 */
function apiSavePreacherTranslationEntry(quarterId, serviceDate, postId, slotIndex, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('姓名不可留空。');

  // 階段 B3 補強（第十四輪批次階段 C 擴展到獻花）：這個工具的檔頭說明明確
  // 表示只服務「講員」「翻譯」「獻花」三個崗位，但原本這裡完全沒有檢查傳入的
  // postId 是不是呢幾個崗位之一——只要 RosterAssignments 剛好有對應的格子，
  // 就會照樣寫入，等於這個本來設計上限定幾個崗位的入口，實際上可以覆寫任何
  // 崗位的任何格子。加這道檢查作縱深防禦（側邊欄本身只會送出呢三個崗位的
  // postId，正常操作不會觸發這裡的錯誤）。
  const ids = findPreacherTranslationPostIds_();
  const allowedPostIds = [ids.preacherPostId, ids.translationPostId, ids.flowerPostId].filter(Boolean);
  if (allowedPostIds.indexOf(postId) === -1) {
    throw new Error('這個工具只能填寫「講員」「翻譯」或「獻花」崗位的格子，收到的 PostID「' + postId + '」不屬於這三個崗位。');
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error(buildQuarterNotFoundMessage_(quarterId));

  const personId = resolvePersonId(trimmedName) || '';
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  // ---- 1. 更新 RosterAssignments 長表 ----
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ROSTER_ASSIGNMENTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.ROSTER_ASSIGNMENTS);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const colIndex = {};
  headers.forEach(function (h, i) { colIndex[h] = i + 1; });

  const values = lastRow >= 3 ? sheet.getRange(3, 1, lastRow - 2, lastCol).getValues() : [];
  let targetSheetRow = -1;
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row[colIndex[C.QUARTER_ID] - 1] !== quarterId) continue;
    if (Number(row[colIndex[C.VERSION_NO] - 1]) !== versionNo) continue;
    if (toDateString(row[colIndex[C.SERVICE_DATE] - 1], timezone) !== serviceDate) continue;
    if (row[colIndex[C.POST_ID] - 1] !== postId) continue;
    if (Number(row[colIndex[C.SLOT_INDEX] - 1]) !== Number(slotIndex)) continue;
    targetSheetRow = i + 3;
    break;
  }
  if (targetSheetRow === -1) {
    throw new Error('在 RosterAssignments 找不到對應的格子（' + serviceDate + ' ' + postId + '#' + slotIndex + '），'
      + '可能版本已經改變，請重新整理側邊欄。');
  }

  if (colIndex[C.PERSON_ID]) sheet.getRange(targetSheetRow, colIndex[C.PERSON_ID]).setValue(personId);
  if (colIndex[C.PERSON_NAME_SNAPSHOT]) sheet.getRange(targetSheetRow, colIndex[C.PERSON_NAME_SNAPSHOT]).setValue(trimmedName);
  if (colIndex[C.ASSIGN_SOURCE]) sheet.getRange(targetSheetRow, colIndex[C.ASSIGN_SOURCE]).setValue(ASSIGN_SOURCE.MANUAL);
  if (colIndex[C.UPDATED_AT]) {
    sheet.getRange(targetSheetRow, colIndex[C.UPDATED_AT]).setValue(nowTimestamp_());
    applyTimestampFormat_(sheet, headers, [C.UPDATED_AT], targetSheetRow, 1);
  }
  if (colIndex[C.UPDATED_BY]) sheet.getRange(targetSheetRow, colIndex[C.UPDATED_BY]).setValue(Session.getActiveUser().getEmail());

  // ---- 2. 更新 grid 工作表對應儲存格：填入姓名、清掉「待人手填寫」的底色與備註 ----
  // ⚠️ 第十五輪批次階段 A3：講員／翻譯／獻花一定係喺 v0 剛生成之後就要填，
  // 而 v0 一定會被 protectV0() 保護（只留 Config 嘅 SCRIPT_ACCOUNT_EMAIL
  // 可編輯）——「寫入受保護版本」係呢個工具嘅正常路徑，唔係例外情況。
  // 試算表擁有者本身唔會被保護擋住（Google 嘅限制：擁有者永遠可編輯），
  // 但為咗俾任何有權限執行呢個選單嘅人（唔止擁有者）都用得到，呢度做法係
  // 「暫時解除保護 → 寫入 → 用返原本嘅設定重新保護」，唔會削弱 v0 保護
  // 本身嘅意義（寫完之後保護狀態同之前一模一樣）。
  const gridSheetName = buildRosterSheetName_(quarterId, versionNo);
  const gridSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(gridSheetName);
  let wasProtected = false;
  if (gridSheet) {
    wasProtected = writeToPossiblyProtectedGridSheet_(gridSheet, function () {
      const gridLastRow = gridSheet.getLastRow();
      const gridLastCol = gridSheet.getLastColumn();
      const gridKeys = gridSheet.getRange(2, 1, 1, gridLastCol).getValues()[0];
      const gridDates = gridSheet.getRange(3, 1, Math.max(0, gridLastRow - 2), 1).getValues();
      let gridRow = -1;
      for (let i = 0; i < gridDates.length; i++) {
        if (toDateString(gridDates[i][0], timezone) === serviceDate) { gridRow = i + 3; break; }
      }
      const gridCol = gridKeys.indexOf(postId + '#' + slotIndex) + 1;
      if (gridRow !== -1 && gridCol !== 0) {
        const range = gridSheet.getRange(gridRow, gridCol);
        range.setValue(trimmedName);
        range.setBackground(null);
        range.setNote('');
      }
    });
  }

  // ---- 3. AuditLog ----
  writeAuditLog_({
    action: 'FILL_PREACHER_TRANSLATION',
    targetSheet: SHEETS.ROSTER_ASSIGNMENTS,
    targetKey: quarterId + '|v' + versionNo + '|' + serviceDate + '|' + postId + '#' + slotIndex,
    oldValue: '',
    newValue: trimmedName,
    source: 'runOpenPreacherTranslationFill_',
    notes: (personId ? '已連結 NameMapping PersonID=' + personId : '文字快照，未連結 NameMapping')
      + (wasProtected ? '（grid 工作表受保護，已暫時解除並用原設定重新保護）' : '')
  });

  return { personId: personId, linkedToNameMapping: !!personId };
}

/**
 * 第十五輪批次階段 A3 新增：喺一個「可能已經受保護」嘅 grid 工作表上安全咁
 * 執行一次寫入——如果冇任何保護，直接執行 `writeFn`；如果有（例如 v0 被
 * `protectV0()` 保護咗），暫時解除全部工作表級保護、執行 `writeFn`、再用
 * 原本一模一樣嘅設定（描述、編輯者名單、網域編輯權）重新套用返，執行完
 * 保護狀態同執行前完全一致，唔會削弱保護本身嘅意義。
 *
 * 刻意用 `try/finally`——即使 `writeFn` 中途拋錯，保護都一定會重新套用返，
 * 唔會令工作表意外變成冇保護嘅狀態遺留低。
 *
 * @param {Sheet} sheet 目標工作表
 * @param {function(): void} writeFn 要執行嘅寫入邏輯
 * @returns {boolean} 呼叫時工作表是否本身已經受保護（供呼叫端記錄用）
 */
function writeToPossiblyProtectedGridSheet_(sheet, writeFn) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!protections || protections.length === 0) {
    writeFn();
    return false;
  }

  const saved = protections.map(function (p) {
    return {
      description: p.getDescription(),
      editors: p.getEditors().map(function (e) { return e.getEmail(); }),
      domainEdit: p.canDomainEdit()
    };
  });
  protections.forEach(function (p) { p.remove(); });

  try {
    writeFn();
  } finally {
    saved.forEach(function (s) {
      const restored = sheet.protect().setDescription(s.description);
      restored.removeEditors(restored.getEditors());
      s.editors.forEach(function (email) { restored.addEditor(email); });
      if (!s.domainEdit && restored.canDomainEdit()) restored.setDomainEdit(false);
    });
  }
  return true;
}

/**
 * 選單項目「準備工作 ▸ 填寫講員／翻譯／獻花」的執行入口：開啟側邊欄。
 * @returns {void}
 */
function runOpenPreacherTranslationFill_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('填寫講員／翻譯／獻花', '請輸入 QuarterID（例如 2027T1）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(response.getResponseText());
  if (!quarterId) return;

  const template = HtmlService.createTemplateFromFile('ui/PreacherFillSidebar');
  template.quarterId = quarterId;
  const html = template.evaluate().setTitle('填寫講員／翻譯／獻花').setWidth(360);
  ui.showSidebar(html);
}
