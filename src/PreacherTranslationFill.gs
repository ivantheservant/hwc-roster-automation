/**
 * 階段 B 新增：「準備工作 ▸ 填寫講員與翻譯」。
 *
 * 講員與翻譯這兩個崗位（見 roster_patterns_rules.md 第四節）由 Posts.AutoGenerate=FALSE
 * 控制，系統從不自動派人，一直以來幹事只能直接打開 grid 工作表、在最右邊那幾欄
 * 手動輸入——這個工具提供一個側邊欄，列出目前最新版本全部還空著的講員／翻譯格子，
 * 逐格填寫，不需要直接編輯工作表，填寫後同時寫入 grid 工作表、RosterAssignments
 * 與 AuditLog。
 *
 * 講員不受 Eligibility 限制（跟其他崗位不同，見 getSkipReason_() 完全不檢查
 * NameMapping／Eligibility），輸入的名字也不強制對應到 NameMapping 裡的人——
 * 常任講員通常是牧師，客席講員可能是每季度都不同、系統從未見過的名字，這是刻意
 * 的設計，不是漏做驗證。如果輸入的名字剛好完全符合 NameMapping.NameTC，會自動
 * 連結 PersonID（供日後統計使用）；對不上的話 PersonID 留空、只記文字快照，
 * 兩種情況功能上完全一樣，都能正常顯示在職事表與 PDF 上。
 *
 * 「歷史上出現過的講員名單」不是寫死在程式碼裡的名字清單（那樣真實姓名會出現在
 * 公開的原始碼中，也會在講員異動時過時）——而是即時從 RosterAssignments 統計
 * 這個崗位過去實際出現過的姓名快照，依次數排序取前幾位，資料自然跟著季度更新。
 */

/**
 * 依 PostName_TC 精確比對，找出「講員」與「翻譯」兩個崗位的 PostID。
 * 找不到時對應欄位回傳 null（呼叫端要處理，不強制要求兩者都存在）。
 * @returns {{preacherPostId: ?string, translationPostId: ?string}}
 */
function findPreacherTranslationPostIds_() {
  const posts = readPosts();
  let preacherPostId = null;
  let translationPostId = null;
  posts.forEach(function (row) {
    const name = String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim();
    if (name === '講員') preacherPostId = row[COLUMNS.POSTS.POST_ID];
    if (name === '翻譯') translationPostId = row[COLUMNS.POSTS.POST_ID];
  });
  return { preacherPostId: preacherPostId, translationPostId: translationPostId };
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
 * 側邊欄用：列出指定季度最新版本目前還空著的講員／翻譯格子，附上建議名單與
 * Stage 提示。純讀取。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, stage: string,
 *   officialSentHint: boolean, preacherSuggestions: string[],
 *   translationSuggestions: string[], pending: Object[]}}
 */
function apiListPreacherTranslationPending(quarterId) {
  const ids = findPreacherTranslationPostIds_();
  if (!ids.preacherPostId && !ids.translationPostId) {
    throw new Error('Posts 工作表找不到名稱為「講員」或「翻譯」的崗位，無法使用這個工具。'
      + '請檢查 Posts.PostName_TC 是否跟這兩個字完全一致。');
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');

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

  const targetPostIds = [ids.preacherPostId, ids.translationPostId].filter(Boolean);
  const pending = [];
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] !== quarterId) return;
    if (Number(row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) !== versionNo) return;
    if (targetPostIds.indexOf(row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID]) === -1) return;
    if (row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] || row[COLUMNS.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT]) return;

    const serviceDate = toDateString(row[COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], timezone);
    pending.push({
      serviceDate: serviceDate,
      weekIndex: weekIndexByDate[serviceDate] || 0,
      postId: row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID],
      postName: postNameById[row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID]] || row[COLUMNS.ROSTER_ASSIGNMENTS.POST_ID],
      slotIndex: Number(row[COLUMNS.ROSTER_ASSIGNMENTS.SLOT_INDEX])
    });
  });
  pending.sort(function (a, b) {
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
    return a.postId < b.postId ? -1 : 1;
  });

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    stage: getQuarterStage_(quarterId),
    officialSentHint: getQuarterStage_(quarterId) === QUARTER_STAGE.OFFICIAL_SENT,
    preacherSuggestions: suggestHistoricalNames_(ids.preacherPostId, 8),
    translationSuggestions: suggestHistoricalNames_(ids.translationPostId, 8),
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

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');

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
  const gridSheetName = buildRosterSheetName_(quarterId, versionNo);
  const gridSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(gridSheetName);
  if (gridSheet) {
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
  }

  // ---- 3. AuditLog ----
  writeAuditLog_({
    action: 'FILL_PREACHER_TRANSLATION',
    targetSheet: SHEETS.ROSTER_ASSIGNMENTS,
    targetKey: quarterId + '|v' + versionNo + '|' + serviceDate + '|' + postId + '#' + slotIndex,
    oldValue: '',
    newValue: trimmedName,
    source: 'runOpenPreacherTranslationFill_',
    notes: personId ? '已連結 NameMapping PersonID=' + personId : '文字快照，未連結 NameMapping'
  });

  return { personId: personId, linkedToNameMapping: !!personId };
}

/**
 * 選單項目「準備工作 ▸ 填寫講員與翻譯」的執行入口：開啟側邊欄。
 * @returns {void}
 */
function runOpenPreacherTranslationFill_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('填寫講員與翻譯', '請輸入 QuarterID（例如 2027T1）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = response.getResponseText().trim();
  if (!quarterId) return;

  const template = HtmlService.createTemplateFromFile('ui/PreacherFillSidebar');
  template.quarterId = quarterId;
  const html = template.evaluate().setTitle('填寫講員與翻譯').setWidth(360);
  ui.showSidebar(html);
}
