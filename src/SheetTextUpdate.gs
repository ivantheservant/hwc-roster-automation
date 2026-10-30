/**
 * 第八十五輪批次 LA 組：一次性更新試算表說明文字（改用香港書面語）。
 *
 * 選單「維護 ▸ 更新說明文字（一次性）」：
 *   一、先列出每一格會改／略過（只讀）；按〔更新〕才寫入。
 *   二、只在格子現時內容**完全等於**舊文字時才改；不相等就略過並列出（不猜）。
 *   三、每改一格寫一筆 AuditLog。
 *   四、可以重複執行：第二次全部是「已是新內容」。
 *
 * 對象：Config 的 Description（按 Key 找行，不用固定行號）、Unavailable!A1、
 * RuleSettings「HARD_MUTEX_GROUP」的 Description。
 *
 * ⚠️ 下面 `old:` 的文字是試算表**現時**的內容，刻意保留原文（包括口語字），
 * 用來核對「完全等於」；用字檢查測試會略過這些行。
 */

const SHEET_TEXT_UPDATE_TITLE = '更新說明文字（一次性）';

const SHEET_TEXT_UPDATES_R85 = [
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'CARRY_OVER_WEEKS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '生成新季時往前看幾多週，避免跨季連續',
    new: '生成新季時往前看多少週，避免跨季連續' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'FINETUNE_MAX_MOVES', column: COLUMNS.CONFIG.DESCRIPTION,
    old: 'fine-tune 一次最多建議改幾多格',
    new: 'fine-tune 一次最多建議改多少格' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'MAIL_SUMMARY_DATE_FORMAT', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '個人派工摘要（{AssignmentSummary}）裡日期的顯示格式。',
    new: '個人派工摘要（{AssignmentSummary}）裏日期的顯示格式。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'MAIL_SUMMARY_SEPARATOR', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '個人派工摘要裡多筆派工之間的分隔符號。',
    new: '個人派工摘要裏多筆派工之間的分隔符號。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'MULTIRUN_ATTEMPTS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '「生成職事表」／「多次生成比較」預設嘗試幾次、揀最貼近歷史基準的一份。',
    new: '「生成職事表」／「多次生成比較」預設嘗試幾次、選最貼近歷史基準的一份。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'ICS_SERVICE_START_TIME', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '崇拜預設開始時間（HH:mm，24 小時制）。個別崗位的提早到場時間見 Posts 的 EarlyArrivalMinutes 欄，不在這裡設定。',
    new: '崇拜預設開始時間（HH:mm，24 小時制）。個別崗位的提早到場時間見 Posts 的 EarlyArrivalMinutes 欄，不在這裏設定。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'STEP4_MAX_MISSING_PDF_RATIO', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '第十九輪批次新增。步驟 4「正式發出」容許的個人 PDF 缺件比例上限（0–1，預設 0.2）。缺件人數 ÷ 應收人數超過這個比例就直接中止，不會再提供「現在繼續」的選擇。實測背景：曾經在 57／57 人全部缺件的情況下仍然可以按「繼續」，結果全體義工一個都沒有收到，而 Stage 已經前進到 OFFICIAL_SENT、鎖住了重跑步驟 4 的路。',
    new: '第十九輪批次新增。步驟 4「正式發出」容許的個人 PDF 缺件比例上限（0–1，預設 0.2）。缺件人數 ÷ 應收人數超過這個比例就直接中止，不會再提供「現在繼續」的選擇。實測背景：曾經在 57／57 人全部缺件的情況下仍然可以按「繼續」，結果全體義工一個都沒有收到，而 Stage 已經前進到 OFFICIAL_SENT，令步驟 4 無法重新執行。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'QUARTER_TERM_START_MONTHS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '第十七輪批次新增：T1～T4 各自由哪一個月開始，逗號分隔的四個月份數字。預設 1,4,7,10 就是日曆季度（T1=1-3月、T2=4-6月、T3=7-9月、T4=10-12月），跟這個 Key 加入之前寫死在程式裡的一樣，所以不改也不會有任何行為變化。教會如果用學期制或財政年度等其他劃分，改這裡就可以，不需要改程式。「⚠️ 新增季度」與「⚠️ 產生下一年度四個季度」兩個工具都讀這個值。格式不正確（不是四項、或有值不在 1-12）時會整組退回預設值並記一句 WARN。',
    new: '第十七輪批次新增：T1～T4 各自由哪一個月開始，逗號分隔的四個月份數字。預設 1,4,7,10 就是日曆季度（T1=1-3月、T2=4-6月、T3=7-9月、T4=10-12月），跟這個 Key 加入之前寫死在程式裏的一樣，所以不改也不會有任何行為變化。教會如果用學期制或財政年度等其他劃分，改這裏就可以，不需要改程式。「⚠️ 新增季度」與「⚠️ 產生下一年度四個季度」兩個工具都讀這個值。格式不正確（不是四項、或有值不在 1-12）時會整組退回預設值並記一句 WARN。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'PUBLIC_ROSTER_DATE_FORMAT', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '公開/個人頁面日期欄嘅顯示格式，支援 {M}（月）與 {d}（日）。',
    new: '公開/個人頁面日期欄的顯示格式，支援 {M}（月）與 {d}（日）。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'PUBLIC_ROSTER_BLANK_NOTE', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '公開/個人頁面代替「EmptyDisplay=BLANK」崗位空白格嘅通用說明文字（例如獻花、翻譯）。留空則維持顯示空白。',
    new: '公開/個人頁面代替「EmptyDisplay=BLANK」崗位空白格的通用說明文字（例如獻花、翻譯）。留空則維持顯示空白。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'TRIGGER_AUTO_GENERATE', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '到期自動生成初稿。預設關閉——初稿一律由幹事在網頁上自己撳掣生成。關閉之後系統不會自己動任何東西，全部行動由幹事發起；「到期了還沒生成」改為由提醒信通知幹事，不會代替幹事生成。改成 TRUE 就會回復成到期自動生成（那條程式碼路徑一直保留著）。',
    new: '到期自動生成初稿。預設關閉——初稿一律由幹事在網頁上自己按〔生成初稿〕。關閉之後系統不會自己動任何東西，全部行動由幹事發起；「到期了還沒生成」改為由提醒信通知幹事，不會代替幹事生成。改成 TRUE 就會回復成到期自動生成（那條程式碼路徑一直保留着）。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'REHEARSAL_PROTECTED_QUARTERS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '「⚠️⚠️ 全季流程演練」絕對不可以碰的季度清單，逗號分隔（例如「2027T1,2026T4」）。演練會真正產生版本、寄 DRY_RUN 信、改動 Stage，所以正式上線那一季、以及培訓要用的季度都必須列在這裡。要加季度就在這一格加上去，用逗號分隔。⚠️ 填成空白並不會變成「什麼都不保護」——空白時系統仍然退回程式內建的預設值（2027T1）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。',
    new: '「⚠️⚠️ 全季流程演練」絕對不可以碰的季度清單，逗號分隔（例如「2027T1,2026T4」）。演練會真正產生版本、寄 DRY_RUN 信、改動 Stage，所以正式上線那一季、以及培訓要用的季度都必須列在這裏。要加季度就在這一格加上去，用逗號分隔。⚠️ 填成空白並不會變成「甚麼都不保護」——空白時系統仍然退回程式內建的預設值（2027T1）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'GO_LIVE_QUARTER_ID', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '哪一個季度是真正要上線那一季（例如 2027T1）。第 1 步指向這一季的時候，確認畫面會額外講一句「這一季是實際要上線的季度」，讓你撳之前知道自己動的是那一季。留空 ＝ 不會出現那一句。',
    new: '哪一個季度是真正要上線那一季（例如 2027T1）。第 1 步指向這一季的時候，確認畫面會額外加一句「這一季是實際要上線的季度」，讓你按之前知道自己動的是那一季。留空 ＝ 不會出現那一句。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'MAIL_REDIRECT_ALL_TO', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '【測試用，上線前一定要清空】填一個電郵地址，之後每一封信都會改寄到那個地址，不理 DRY_RUN 是甚麼。主旨會加上「[原收件人：XXX]」，內文頂部會有一段紅色橫幅。用途：把 DRY_RUN 改成 FALSE 之後真正走完整條寄信路（真的產生附件、真的收到信），而不會有任何一封去到義工手上。留空＝正常寄給收件人本人。',
    new: '【測試用，上線前一定要清空】填一個電郵地址，之後每一封信都會改寄到那個地址，不論 DRY_RUN 是甚麼。主旨會加上「[原收件人：XXX]」，內文頂部會有一段紅色橫幅。用途：把 DRY_RUN 改成 FALSE 之後真正走完整條寄信路（真的產生附件、真的收到信），而不會有任何一封寄到義工手上。留空＝正常寄給收件人本人。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'COMBINED_DEFAULT_SKIP_POST_IDS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '合堂主日預設不排的崗位（PostID，逗號分隔）。合堂那一天，主席／講員／傳譯／領詩／司琴由另一堂帶領，所以這五個崗位不應該由本堂排。「維護 ▸ 補填合堂跳過崗位」會把這一格的內容填進 SpecialSundays 的 SkipPostIDs；「準備工作 ▸ ⚠️ 產生年度合堂建議」新寫入的那幾行也會帶著它。⚠️ 這一格填成空白就是空白——系統當成你的決定（「我不要任何合堂自動跳崗位」），不會自動退回程式內建的那五個崗位。某一次合堂實際上不只跳這五個（例如堂慶連司事都由英語堂負責），在 SpecialSundays 那一行自己加上去就可以，補填工具不會覆寫已填的值。',
    new: '合堂主日預設不排的崗位（PostID，逗號分隔）。合堂那一天，主席／講員／傳譯／領詩／司琴由另一堂帶領，所以這五個崗位不應該由本堂排。「維護 ▸ 補填合堂跳過崗位」會把這一格的內容填進 SpecialSundays 的 SkipPostIDs；「準備工作 ▸ ⚠️ 產生年度合堂建議」新寫入的那幾行也會帶着它。⚠️ 這一格填成空白就是空白——系統當成你的決定（「我不要任何合堂自動跳崗位」），不會自動退回程式內建的那五個崗位。某一次合堂實際上不只跳這五個（例如堂慶連司事都由英語堂負責），在 SpecialSundays 那一行自己加上去就可以，補填工具不會覆寫已填的值。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'COMBINED_BACKFILL_BLOCKED_QUARTERS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '「維護 ▸ 補填合堂跳過崗位」絕對不可以改動的季度清單，逗號分隔。正式上線那一季必須列在這裡。⚠️ 這一格跟「REHEARSAL_PROTECTED_QUARTERS」是兩件事，故意分開兩格：那一個守的是「演練不可以碰哪幾季」，這一個守的是「補填工具不可以改哪幾季的資料」。共用一格的話，日後為了演練而加減一季，就會連補填工具的保護範圍都一起改掉。⚠️ 填成空白並不會變成「什麼都不保護」——空白時系統仍然退回程式內建的預設值（2026T4）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。',
    new: '「維護 ▸ 補填合堂跳過崗位」絕對不可以改動的季度清單，逗號分隔。正式上線那一季必須列在這裏。⚠️ 這一格跟「REHEARSAL_PROTECTED_QUARTERS」是兩件事，故意分開兩格：那一個守的是「演練不可以碰哪幾季」，這一個守的是「補填工具不可以改哪幾季的資料」。共用一格的話，日後為了演練而加減一季，就會連補填工具的保護範圍都一起改掉。⚠️ 填成空白並不會變成「甚麼都不保護」——空白時系統仍然退回程式內建的預設值（2026T4）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'QUARTER_RESET_BLOCKED_QUARTERS', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '「維護 ▸ ⚠️⚠️ 重設季度測試資料」絕對不可以清的季度清單，逗號分隔。正式上線那一季必須列在這裡。⚠️ 這是全系統最危險的功能之一，清走了就是真的清走了。⚠️ 這一格跟「REHEARSAL_PROTECTED_QUARTERS」和「COMBINED_BACKFILL_BLOCKED_QUARTERS」是三件事，故意分開三格：一個守「演練不可以碰哪幾季」，一個守「補填工具不可以改哪幾季」，這一個守「清理不可以清哪幾季」。共用一格的話，日後改其中一邊就會連另外兩件事的保護範圍都一起改掉。⚠️ 填成空白並不會變成「什麼都不保護」——空白時系統仍然退回程式內建的預設值（2026T4）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。',
    new: '「維護 ▸ ⚠️⚠️ 重設季度測試資料」絕對不可以清的季度清單，逗號分隔。正式上線那一季必須列在這裏。⚠️ 這是全系統最危險的功能之一，清除了就無法還原。⚠️ 這一格跟「REHEARSAL_PROTECTED_QUARTERS」和「COMBINED_BACKFILL_BLOCKED_QUARTERS」是三件事，故意分開三格：一個守「演練不可以碰哪幾季」，一個守「補填工具不可以改哪幾季」，這一個守「清理不可以清哪幾季」。共用一格的話，日後改其中一邊就會連另外兩件事的保護範圍都一起改掉。⚠️ 填成空白並不會變成「甚麼都不保護」——空白時系統仍然退回程式內建的預設值（2026T4）。想真正解除某一季的保護，只能把它從這一格移走，不能靠清空整格。' },
  { sheet: SHEETS.CONFIG, keyColumn: COLUMNS.CONFIG.KEY, key: 'SELFTEST_QUARTER_ID', column: COLUMNS.CONFIG.DESCRIPTION,
    old: '「測試工具 ▸ ⚠️ 跑自測（沙盒季度，DRY_RUN）」專用的沙盒季度。⚠️ 自測機每一次開跑都會把這一季整季清乾淨（連 v0），然後由頭走一次完整流程，所以這一格一定要填一個沒有真實資料的季度。開跑之前有三道閘擋住（不可以在 QUARTER_RESET_BLOCKED_QUARTERS 或 REHEARSAL_PROTECTED_QUARTERS 裡面、Stage 不可以是已正式發出），但最後一道防線仍然是這一格填得對。⚠️ 填成空白會退回程式內建的預設值（2028T3），不會變成「隨便挑一季」。',
    new: '「測試工具 ▸ ⚠️ 執行自測（沙盒季度，DRY_RUN）」專用的沙盒季度。⚠️ 自測機每一次開始執行都會把這一季整季清空（連 v0），然後從頭走一次完整流程，所以這一格一定要填一個沒有真實資料的季度。開始執行之前有三道關卡（不可以在 QUARTER_RESET_BLOCKED_QUARTERS 或 REHEARSAL_PROTECTED_QUARTERS 裏面、Stage 不可以是已正式發出），但最後一道防線仍然是這一格填得對。⚠️ 填成空白會退回程式內建的預設值（2028T3），不會變成「隨便挑一季」。' },
  { sheet: SHEETS.UNAVAILABLE, cell: 'A1',
    old: '範例行一條，請按需要改或刪。長期離開的人不要用這裡，改在 NameMapping 把 Active 設 FALSE。',
    new: '範例行一條，請按需要改或刪。長期離開的人不要用這裏，改在 NameMapping 把 Active 設 FALSE。' },
  { sheet: SHEETS.RULE_SETTINGS, keyColumn: COLUMNS.RULE_SETTINGS.RULE_ID, key: 'HARD_MUTEX_GROUP',
    column: COLUMNS.RULE_SETTINGS.DESCRIPTION,
    old: '由 Posts 的 MutexGroup 驅動，現時無任何組',
    new: '由 Posts 的 MutexGroup 驅動；現時主席與聖餐襄禮為同一組（CHAIR_COMMUNION）' }
];

const SHEET_TEXT_STATUS = {
  WILL_UPDATE: 'WILL_UPDATE',
  ALREADY_NEW: 'ALREADY_NEW',
  DIFFERENT: 'DIFFERENT',
  NOT_FOUND: 'NOT_FOUND',
  UPDATED: 'UPDATED'
};

/**
 * 每一項的顯示名稱（確認窗、完成窗用）。
 * @param {Object} item SHEET_TEXT_UPDATES_R85 其中一項
 * @returns {string}
 */
function describeSheetTextItem_(item) {
  if (item.cell) return item.sheet + '!' + item.cell;
  return item.sheet + '「' + item.key + '」的 ' + item.column;
}

/**
 * 找出某一項在試算表的位置（列、欄，1 起計）。找不到 ⇒ null。
 * 表頭在第 2 行，資料由第 3 行開始（與 readSheet_() 相同）。
 * @param {Object} ss 試算表
 * @param {Object} item 一項
 * @returns {?{sheet: Object, row: number, col: number}}
 */
function locateSheetTextItem_(ss, item) {
  const sheet = ss.getSheetByName(item.sheet);
  if (!sheet) return null;
  if (item.cell) {
    const m = /^([A-Z]+)(\d+)$/.exec(item.cell);
    if (!m) return null;
    let col = 0;
    for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return { sheet: sheet, row: Number(m[2]), col: col };
  }
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) return null;
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  const keyAt = headers.indexOf(item.keyColumn);
  const colAt = headers.indexOf(item.column);
  if (keyAt === -1 || colAt === -1) return null;
  const keys = sheet.getRange(3, keyAt + 1, lastRow - 2, 1).getValues();
  for (let r = 0; r < keys.length; r++) {
    if (String(keys[r][0] || '').trim() === item.key) return { sheet: sheet, row: r + 3, col: colAt + 1 };
  }
  return null;
}

/**
 * 計劃（只讀）：逐項判斷會改、已是新內容、內容不同（略過）、找不到（略過）。
 * @returns {{items: Object[], willUpdate: number}}
 */
function planSheetTextUpdate_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const items = SHEET_TEXT_UPDATES_R85.map(function (item) {
    const at = locateSheetTextItem_(ss, item);
    const label = describeSheetTextItem_(item);
    if (!at) return { item: item, label: label, status: SHEET_TEXT_STATUS.NOT_FOUND };
    const current = String(at.sheet.getRange(at.row, at.col).getValue());
    let status = SHEET_TEXT_STATUS.DIFFERENT;
    if (current === item.old) status = SHEET_TEXT_STATUS.WILL_UPDATE;
    else if (current === item.new) status = SHEET_TEXT_STATUS.ALREADY_NEW;
    return { item: item, label: label, status: status, row: at.row, col: at.col };
  });
  return {
    items: items,
    willUpdate: items.filter(function (x) { return x.status === SHEET_TEXT_STATUS.WILL_UPDATE; }).length
  };
}

/**
 * 每種狀態的說明文字。
 * @param {string} status SHEET_TEXT_STATUS
 * @returns {string}
 */
function sheetTextStatusText_(status) {
  if (status === SHEET_TEXT_STATUS.WILL_UPDATE) return '會改';
  if (status === SHEET_TEXT_STATUS.UPDATED) return '已更新';
  if (status === SHEET_TEXT_STATUS.ALREADY_NEW) return '已是新內容';
  if (status === SHEET_TEXT_STATUS.DIFFERENT) return '略過（現時內容與舊文字不同，不會改動）';
  return '略過（找不到這一格）';
}

/**
 * 寫入：重新計劃一次（寫之前再核對現時內容仍然等於舊文字），只改「會改」的格。每格寫 AuditLog。
 * @returns {{updated: number, items: Object[]}}
 */
function executeSheetTextUpdate_() {
  return withMutationLock_(SHEET_TEXT_UPDATE_TITLE, function () {
    const plan = planSheetTextUpdate_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let updated = 0;
    plan.items.forEach(function (x) {
      if (x.status !== SHEET_TEXT_STATUS.WILL_UPDATE) return;
      ss.getSheetByName(x.item.sheet).getRange(x.row, x.col).setValue(x.item.new);
      updated++;
      x.status = SHEET_TEXT_STATUS.UPDATED;
      writeAuditLog_({
        action: 'SHEET_TEXT_UPDATED',
        targetSheet: x.item.sheet,
        targetKey: x.item.cell || x.item.key,
        oldValue: x.item.old,
        newValue: x.item.new,
        source: 'executeSheetTextUpdate_',
        notes: '第八十五輪：說明文字改用香港書面語（一次性）'
      });
    });
    return { updated: updated, items: plan.items };
  });
}

/**
 * 確認窗／完成窗的逐格清單（純函式）。
 * @param {Object[]} items plan.items 或執行結果的 items
 * @returns {string[]}
 */
function buildSheetTextUpdateLines_(items) {
  return items.map(function (x) { return x.label + '：' + sheetTextStatusText_(x.status); });
}

/**
 * 確認窗 HTML（〔更新〕〔取消〕）。
 * @param {{items: Object[], willUpdate: number}} plan planSheetTextUpdate_() 的結果
 * @returns {string}
 */
function buildSheetTextUpdateDialogHtml_(plan) {
  const esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  const rows = buildSheetTextUpdateLines_(plan.items)
    .map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
  const head = plan.willUpdate > 0
    ? '以下 ' + plan.items.length + ' 格之中，' + plan.willUpdate + ' 格會改為新內容。按〔更新〕才會寫入。'
    : '以下 ' + plan.items.length + ' 格都不需要改動。';
  return '<div style="font-family:sans-serif;font-size:14px">'
    + '<p>' + esc(head) + '</p><ol id="list">' + rows + '</ol>'
    + '<p id="msg"></p>'
    + (plan.willUpdate > 0 ? '<button id="go" onclick="go()">更新</button> ' : '')
    + '<button onclick="google.script.host.close()">' + (plan.willUpdate > 0 ? '取消' : '關閉') + '</button>'
    + '<script>function go(){var b=document.getElementById("go");b.disabled=true;'
    + 'document.getElementById("msg").textContent="更新中，請稍候……";'
    + 'google.script.run.withSuccessHandler(function(r){'
    + 'document.getElementById("msg").textContent="完成：已更新 "+r.updated+" 格。";'
    + 'document.getElementById("list").innerHTML=r.lines.map(function(l){'
    + 'return "<li>"+l.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</li>";}).join("");'
    + 'b.style.display="none";})'
    + '.withFailureHandler(function(e){document.getElementById("msg").textContent="未能更新："+e.message;b.disabled=false;})'
    + '.apiApplySheetTextUpdate();}</script></div>';
}

/**
 * 確認窗按〔更新〕時呼叫。
 * @returns {{updated: number, lines: string[]}}
 */
function apiApplySheetTextUpdate() {
  // 第八十七輪批次 NB 組：試算表對話框用——只有試算表編輯者可以呼叫
  assertSpreadsheetEditorCaller_();
  const result = executeSheetTextUpdate_();
  return { updated: result.updated, lines: buildSheetTextUpdateLines_(result.items) };
}

/**
 * 選單入口：維護 ▸ 更新說明文字（一次性）。
 * @returns {void}
 */
function runSheetTextUpdate_() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planSheetTextUpdate_();
  } catch (err) {
    log_('ERROR', 'runSheetTextUpdate_ 失敗: ' + err.message);
    ui.alert(SHEET_TEXT_UPDATE_TITLE, '未能讀取：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSheetTextUpdateDialogHtml_(plan)).setWidth(640).setHeight(560);
  ui.showModalDialog(html, SHEET_TEXT_UPDATE_TITLE);
}
