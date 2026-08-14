/**
 * 自動排程：每日檢查一次。追加階段 N 重新設計——四階段流程之下，
 * 只有「步驟 1：生成初稿」應該自動執行，步驟 2／3／4 一律要幹事人手覆核後按掣，
 * 所以這裡的自動化範圍縮小成只有兩件事：
 *
 * 1. GENERATE：季度到達 GenerateOn 日期、Stage 仍是 DRAFT、且未有任何已生成版本時，
 *    自動生成一份初稿，並且只通知幹事（Config 的 MAIL_ADMIN_NOTIFY）「初稿已生成，
 *    請登入覆核後執行步驟 2」，不寄給堂委、不寄給義工——寄給堂委審閱是步驟 2 的責任，
 *    要幹事看過初稿、決定沒問題了才手動執行。
 * 2. REMIND（追加階段 N 重新定義，不再是「到了某個日期就寄一次給義工」）：
 *    Stage 停留在 REVIEW_SENT（已寄給堂委審閱、但還沒套用修改申報）超過
 *    REMIND_STUCK_DAYS 日（Config，預設 3）未前進時，每日提醒幹事一次
 *    （同樣只寄給幹事），最多提醒 REMIND_STUCK_MAX_COUNT 次（Config，預設 3），
 *    避免幹事忘記查看，也避免無限期一直洗版。
 *
 * OFFICIAL（正式發出）永遠不會由這裡觸發——四階段流程的步驟 4 一定要幹事在
 * 選單或 Web UI 手動執行，因為那是真正寄給全部義工、不可逆的動作。
 * Mailer.gs 的 sendStage() 有一道結構性防護（assertOfficialNotFromAutomationTrigger_()）：
 * 只要偵測到目前是在這個函式的執行期間（AUTOMATION_TRIGGER_CONTEXT_ACTIVE），
 * OFFICIAL 階段一律直接拒絕並記入 AuditLog，即使日後不小心在這裡加了一行呼叫
 * sendStage(..., MAIL_STAGES.OFFICIAL) 也會被擋下來，不是只靠「這裡沒寫」這種
 * 容易被以後的修改破壞的保證。
 *
 * 安全設計：
 * - 本檔案完全不會自己呼叫 ScriptApp.newTrigger()——那只發生在
 *   installAutomationTrigger()，而它只被選單「安裝自動排程」呼叫，
 *   需要人手點擊並在確認視窗打字輸入「確認安裝」才會執行。
 * - DRY_RUN=TRUE 時，生成職事表版本這一步仍會真實發生（那本來就不是電郵），
 *   只有「真正寄出電郵」這一步會被攔截（notifyAdmin_() 內建的機制，見 Mailer.gs）。
 * - GENERATE 用「Stage 是否仍為 DRAFT」＋「是否已有版本」判斷有沒有執行過，
 *   比單純查 AuditLog 更可靠（就算幹事自己手動生成過，也會被正確偵測到，
 *   不會又自動生成一次）。REMIND-stuck 用 AuditLog 記錄判斷提醒過幾次、
 *   今天有沒有提醒過。
 */

/** 每日檢查觸發器綁定的函式名稱，安裝／查詢／移除都以此為準。 */
const AUTOMATION_TRIGGER_FUNCTION = 'dailyAutomationCheck_';

/**
 * 追加階段 N：dailyAutomationCheck_() 執行期間設為 true，讓 sendStage() 能判斷
 * 目前是不是由自動排程觸發呼叫，藉此擋掉 OFFICIAL 階段（結構性防護，見
 * assertOfficialNotFromAutomationTrigger_()，Mailer.gs）。用 try/finally 確保
 * 無論成功或拋錯都會重設，手法跟 TemplatePreview.gs 的 PREVIEW_MODE_ACTIVE 一致。
 */
var AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;

/**
 * 追加階段 N 的結構性防護：OFFICIAL 階段永遠不可以由自動排程的每日檢查觸發，
 * 一定要幹事在選單或 Web UI 按掣才能執行。呼叫端（Mailer.gs 的 sendStage()）
 * 在 stage === MAIL_STAGES.OFFICIAL 時呼叫這裡；只要偵測到目前是在
 * dailyAutomationCheck_() 的執行期間就直接拒絕並記入 AuditLog，留下「曾經有
 * 東西嘗試從自動排程觸發正式發出」的紀錄，方便日後追查是不是程式碼哪裡不小心接錯。
 * @param {string} quarterId 季度 ID，供 AuditLog 記錄
 * @returns {void}
 */
function assertOfficialNotFromAutomationTrigger_(quarterId) {
  if (!AUTOMATION_TRIGGER_CONTEXT_ACTIVE) return;
  writeAuditLog_({
    action: 'OFFICIAL_BLOCKED_FROM_TRIGGER',
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    source: 'dailyAutomationCheck_',
    notes: '偵測到 OFFICIAL 階段被自動排程呼叫，已拒絕執行——OFFICIAL 一律只能由選單或 Web UI 手動觸發'
  });
  throw new Error('OFFICIAL 階段不可以由自動排程觸發，必須由幹事手動執行「步驟 4：正式發出」');
}

/**
 * 每日檢查的真正入口。由時間驅動觸發器呼叫，也可以在 Apps Script 編輯器手動執行，
 * 或透過選單「⚠️⚠️ 立即執行自動排程檢查」執行（用來在不等到真正的到期日之前，
 * 確認邏輯有沒有跑錯）。
 *
 * 對每個季度逐一檢查 GENERATE 與 REMIND-stuck 兩件事；任何一項失敗都只影響那一項，
 * 不會連累同一季或其他季度的其餘檢查。OFFICIAL 完全不在這個函式的邏輯裡。
 *
 * @returns {Object[]} 本次檢查的逐項結果，每項為 {quarterId, action, outcome, detail}；
 *   outcome 為 'RAN'（本次執行了）、'RAN_ERROR'（執行失敗）、
 *   'SKIPPED_*'（各種略過原因，見 judgeGenerateAction_()／judgeRemindStuckAction_()）
 */
function dailyAutomationCheck_() {
  AUTOMATION_TRIGGER_CONTEXT_ACTIVE = true;
  try {
    const config = readConfig();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
    const report = [];

    readSheet(SHEETS.QUARTERS).forEach(function (row) {
      const quarterId = row[COLUMNS.QUARTERS.QUARTER_ID];
      if (!quarterId) return;

      const schedule = computeAutomationSchedule_(row, config);

      const generateJudgment = judgeGenerateAction_(quarterId, schedule.generateDate, today);
      report.push(executeAutomationAction_(generateJudgment, today, function () {
        const gen = performRosterGeneration_(quarterId);
        notifyAdminGenerateDone_(quarterId, gen, config, isDryRun);
        return '已生成 ' + gen.sheetName + '（試 ' + gen.attemptsRun + ' 次，seed=' + gen.seed + '）；已通知幹事覆核';
      }));

      const remindJudgment = judgeRemindStuckAction_(quarterId, row, today, config);
      report.push(executeAutomationAction_(remindJudgment, today, function () {
        notifyAdminStuckReminder_(quarterId, remindJudgment, config, isDryRun);
        return '第 ' + (remindJudgment.reminderCount + 1) + ' / ' + remindJudgment.maxCount
          + ' 次提醒幹事：' + quarterId + ' 卡在 REVIEW_SENT';
      }));
    });

    return report;
  } finally {
    AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;
  }
}

/**
 * 計算一個季度的自動生成有效觸發日期（generateDate，實際驅動 judgeGenerateAction_()），
 * 以及（僅供參考，追加階段 Q 查證後確認目前沒有任何畫面在用）正式寄送的名義日期
 * officialDate。
 *
 * 優先採用 Quarters 工作表自己的 GenerateOn／OfficialSendOn 欄——該表的說明列本來就
 * 寫明這些欄「由 Config 的日數自動算出，可人手改寫」，所以若幹事已經手動調整過
 * 某季的日期（例如避開假期），這裡必須尊重那個調整，不能自作主張重新計算蓋過去。
 * 只有在該欄留空時，才用 Config 的 LEAD_DAYS_GENERATE／OFFICIAL 從 StartDate 推算。
 *
 * 算出後再套用 SEND_WEEKDAY_GUARD：如果剛好落在星期日，依設定順延或提前。
 *
 * 追加階段 N：officialDate 這個名義日期不再用於判斷是否自動觸發（OFFICIAL 永遠不
 * 自動觸發）。追加階段 Q 查證：officialDate／LEAD_DAYS_OFFICIAL 目前全專案沒有任何
 * 呼叫端讀取——`{OfficialSendDate}` 這個郵件 placeholder 走的是完全不同的路徑
 * （Mailer.gs 的 buildMailContext_() 直接讀 Quarters 的 OfficialSendOn 原始欄位，
 * 不經過這裡、也不會退回用 LEAD_DAYS_OFFICIAL 推算），所以雖然 OfficialSendOn
 * 這個欄位還活著，這裡算出來的 officialDate／LEAD_DAYS_OFFICIAL 其實已經是死值，
 * 是否要一併清除待你決定，這次沒有動（remindDate／LEAD_DAYS_REMIND 已依你的指示
 * 移除，見下方）。
 *
 * 原本這裡還會算 remindDate（REMIND 的名義日期），追加階段 Q 查證後確認全專案
 * 沒有任何呼叫端讀取（REMIND 已經完全由 REMIND_STUCK_DAYS 驅動，不再是日期概念），
 * 已依你的指示移除這段計算，連同 LEAD_DAYS_REMIND／RemindOn 一併從註冊移除。
 *
 * @param {Object} quarterRow Quarters 的一列資料（readSheet 的物件格式）
 * @param {Object.<string, *>} config readConfig() 的結果
 * @returns {{generateDate: string, officialDate: string}} 生成的有效日期、正式寄送的名義日期
 */
function computeAutomationSchedule_(quarterRow, config) {
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const startDate = toDateString(quarterRow[COLUMNS.QUARTERS.START_DATE], timezone);
  const guardMode = String(config[CONFIG_KEYS.SEND_WEEKDAY_GUARD] || 'NONE').toUpperCase();

  const resolve = function (storedValue, leadDaysKey) {
    const stored = toDateString(storedValue, timezone);
    if (stored) return stored;
    const leadDays = Number(config[leadDaysKey]);
    if (!startDate || isNaN(leadDays)) return '';
    return shiftDateString_(startDate, leadDays);
  };

  const nominalGenerate = resolve(quarterRow[COLUMNS.QUARTERS.GENERATE_ON], CONFIG_KEYS.LEAD_DAYS_GENERATE);
  const nominalOfficial = resolve(quarterRow[COLUMNS.QUARTERS.OFFICIAL_SEND_ON], CONFIG_KEYS.LEAD_DAYS_OFFICIAL);

  return {
    generateDate: nominalGenerate ? applyWeekdayGuard_(nominalGenerate, guardMode) : '',
    officialDate: nominalOfficial ? applyWeekdayGuard_(nominalOfficial, guardMode) : ''
  };
}

/**
 * 依 Config 的 SEND_WEEKDAY_GUARD 調整落在星期日的日期。
 *
 * 這是對「NONE / SKIP_SUNDAY / NEXT_WEEKDAY」三個列舉值的具體解讀（Config 的
 * Description 只寫「撞正主日時的處理」，沒有進一步定義方向）：
 *   NONE         — 不調整，星期日照常執行
 *   SKIP_SUNDAY  — 提前一天（星期六），即「跳過」星期日本身
 *   NEXT_WEEKDAY — 順延一天（星期一），即取「下一個平日」
 * 若這個解讀跟你的原意不同，只需要改這個函式，不影響其他任何邏輯。
 *
 * @param {string} dateStr 原始日期，格式 yyyy-MM-dd
 * @param {string} guardMode SEND_WEEKDAY_GUARD 的值
 * @returns {string} 調整後的日期
 */
function applyWeekdayGuard_(dateStr, guardMode) {
  if (guardMode !== 'SKIP_SUNDAY' && guardMode !== 'NEXT_WEEKDAY') return dateStr;
  if (!isSundayDate_(dateStr)) return dateStr;
  return shiftDateString_(dateStr, guardMode === 'NEXT_WEEKDAY' ? 1 : -1);
}

/**
 * 純判斷：GENERATE（自動生成初稿）今天要不要觸發，不執行任何動作、不寫入任何東西。
 * 追加階段 N：條件除了到期日之外，還要求 Stage 仍是 DRAFT（代表幹事還沒手動生成過、
 * 也還沒進入審閱），且這一季目前完全沒有已生成的版本——避免跟幹事手動執行
 * 「步驟 1」或選單「生成職事表」的結果衝突、重複生成。用實際狀態（Stage／版本）
 * 判斷「有沒有做過」，比單純查 AuditLog 更可靠。
 * @param {string} quarterId 季度 ID
 * @param {string} targetDate 有效的 GenerateOn 日期；空字串代表無法判斷
 * @param {string} today 今天的日期字串
 * @returns {{quarterId: string, action: string, targetDate: string, outcome: string, detail: string}}
 *   outcome 為 'SKIPPED_NO_DATE'／'SKIPPED_NOT_DUE'／'SKIPPED_STAGE'／'SKIPPED_HAS_VERSION'／'WOULD_RUN'
 */
function judgeGenerateAction_(quarterId, targetDate, today) {
  const action = AUTOMATION_ACTIONS.GENERATE;
  const base = { quarterId: quarterId, action: action, targetDate: targetDate || '' };

  if (!targetDate) {
    return Object.assign({}, base, { outcome: 'SKIPPED_NO_DATE', detail: '沒有可用的日期（Quarters 未填且 Config 的 LEAD_DAYS_GENERATE 推算不出來）' });
  }
  if (today < targetDate) {
    return Object.assign({}, base, { outcome: 'SKIPPED_NOT_DUE', detail: '有效日期 ' + targetDate + '，尚未到期' });
  }
  const stage = getQuarterStage_(quarterId);
  if (stage !== QUARTER_STAGE.DRAFT) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_STAGE',
      detail: 'Stage 目前是「' + stage + '」，不是 DRAFT，代表已經生成過或已進入後續流程，不會重複生成'
    });
  }
  if (findLatestVersionNo(quarterId) >= 0) {
    return Object.assign({}, base, { outcome: 'SKIPPED_HAS_VERSION', detail: '已經有生成過的版本，不會重複生成' });
  }
  return Object.assign({}, base, {
    outcome: 'WOULD_RUN',
    detail: '有效日期 ' + targetDate + '，Stage=DRAFT 且尚未有版本，今天執行檢查會觸發生成初稿'
  });
}

/**
 * 純判斷：REMIND（卡在 REVIEW_SENT 太久的提醒）今天要不要對這個季度提醒幹事，
 * 不執行任何動作、不寫入任何東西。追加階段 N 重新定義：不再是「到了某個日期
 * 就寄一次」，改成「Stage 停留在 REVIEW_SENT 超過 REMIND_STUCK_DAYS 日而未前進時，
 * 每日提醒一次，最多提醒 REMIND_STUCK_MAX_COUNT 次」——用 Quarters.StageUpdatedAt
 * 判斷停留了幾日，用 AuditLog 裡 action=TRIGGER_REMIND 的紀錄判斷提醒過幾次、
 * 今天有沒有提醒過（見 readStuckReminderLog_()）。
 * @param {string} quarterId 季度 ID
 * @param {Object} quarterRow Quarters 的一列資料（readSheet 的物件格式）
 * @param {string} today 今天的日期字串
 * @param {Object} config readConfig() 的結果
 * @returns {{quarterId: string, action: string, targetDate: string, outcome: string, detail: string,
 *   reminderCount: number, maxCount: number}}
 *   outcome 為 'SKIPPED_NOT_STUCK'／'SKIPPED_NO_DATE'／'SKIPPED_NOT_DUE'／
 *   'SKIPPED_MAX_REACHED'／'SKIPPED_DONE'／'WOULD_RUN'
 */
function judgeRemindStuckAction_(quarterId, quarterRow, today, config) {
  const action = AUTOMATION_ACTIONS.REMIND;
  const base = { quarterId: quarterId, action: action, targetDate: '' };
  const maxCount = getConfig(CONFIG_KEYS.REMIND_STUCK_MAX_COUNT, DEFAULTS.REMIND_STUCK_MAX_COUNT);

  const stage = getQuarterStage_(quarterId);
  if (stage !== QUARTER_STAGE.REVIEW_SENT) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_NOT_STUCK',
      detail: 'Stage 目前是「' + stage + '」，不是 REVIEW_SENT，不需要提醒',
      reminderCount: 0, maxCount: maxCount
    });
  }

  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const stageUpdatedAt = toDateString(quarterRow[COLUMNS.QUARTERS.STAGE_UPDATED_AT], timezone);
  const stuckDays = getConfig(CONFIG_KEYS.REMIND_STUCK_DAYS, DEFAULTS.REMIND_STUCK_DAYS);
  const reminderLog = readStuckReminderLog_(quarterId, timezone);
  const reminderCount = reminderLog.length;

  if (!stageUpdatedAt) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_NO_DATE', detail: 'Quarters 沒有 StageUpdatedAt 時間，無法判斷停留了多久',
      reminderCount: reminderCount, maxCount: maxCount
    });
  }

  const daysSince = daysBetween_(stageUpdatedAt, today);
  if (daysSince < stuckDays) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_NOT_DUE', detail: '已停留 ' + daysSince + ' 天，未達 ' + stuckDays + ' 天門檻',
      reminderCount: reminderCount, maxCount: maxCount
    });
  }
  if (reminderCount >= maxCount) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_MAX_REACHED', detail: '已提醒 ' + reminderCount + ' 次，達到上限 ' + maxCount + ' 次，不再提醒',
      reminderCount: reminderCount, maxCount: maxCount
    });
  }
  if (reminderLog.indexOf(today) !== -1) {
    return Object.assign({}, base, {
      outcome: 'SKIPPED_DONE', detail: '今天已經提醒過',
      reminderCount: reminderCount, maxCount: maxCount
    });
  }

  return Object.assign({}, base, {
    outcome: 'WOULD_RUN',
    detail: '已停留 ' + daysSince + ' 天（門檻 ' + stuckDays + ' 天），這會是第 ' + (reminderCount + 1) + ' / ' + maxCount + ' 次提醒',
    reminderCount: reminderCount, maxCount: maxCount
  });
}

/**
 * 讀取這個季度過去每一次「卡在 REVIEW_SENT」提醒成功送出的日期清單，
 * 用來判斷提醒過幾次（陣列長度）與今天有沒有提醒過（indexOf(today)）。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區名稱
 * @returns {string[]} 已成功提醒的日期（yyyy-MM-dd）清單
 */
function readStuckReminderLog_(quarterId, timezone) {
  const rows = readSheet(SHEETS.AUDIT_LOG);
  const C = COLUMNS.AUDIT_LOG;
  return rows
    .filter(function (row) { return row[C.ACTION] === AUTOMATION_ACTIONS.REMIND && row[C.TARGET_KEY] === quarterId; })
    .map(function (row) { return toDateString(row[C.NEW_VALUE], timezone); })
    .filter(function (d) { return !!d; });
}

/**
 * 執行單一自動排程動作，附帶到期判斷與防重複執行。判斷邏輯完全委派給呼叫端傳入的
 * judgment（來自 judgeGenerateAction_() 或 judgeRemindStuckAction_()），這裡只負責
 * 在判斷結果是 WOULD_RUN 時才真正呼叫 workFn() 並寫入 AuditLog。
 * @param {Object} judgment judgeGenerateAction_() 或 judgeRemindStuckAction_() 的結果
 * @param {string} today 今天的日期字串
 * @param {function(): string} workFn 實際要執行的動作，回傳供 AuditLog 記錄的說明文字
 * @returns {{quarterId: string, action: string, outcome: string, detail: string}} 本次判斷與執行結果
 */
function executeAutomationAction_(judgment, today, workFn) {
  if (judgment.outcome !== 'WOULD_RUN') return judgment;

  try {
    const notes = workFn();
    writeAuditLog_({
      action: judgment.action,
      targetSheet: SHEETS.QUARTERS,
      targetKey: judgment.quarterId,
      newValue: today,
      source: 'dailyAutomationCheck_',
      notes: notes || ''
    });
    log_('INFO', 'dailyAutomationCheck_: ' + judgment.action + ' 完成 → ' + judgment.quarterId + '（' + notes + '）');
    return Object.assign({}, judgment, { outcome: 'RAN', detail: notes || '' });
  } catch (err) {
    // 刻意不寫入與成功時相同的 action 名稱：GENERATE 靠 Stage／版本狀態判斷、
    // REMIND-stuck 靠這裡的紀錄判斷，寫成功名稱以外的值讓兩者都不會誤判為「已完成過」，
    // 下次每日檢查會自動重試，直到成功或人手介入為止。
    writeAuditLog_({
      action: judgment.action + '_ERROR',
      targetSheet: SHEETS.QUARTERS,
      targetKey: judgment.quarterId,
      newValue: today,
      source: 'dailyAutomationCheck_',
      notes: err.message
    });
    log_('ERROR', 'dailyAutomationCheck_: ' + judgment.action + ' 失敗 → ' + judgment.quarterId + '：' + err.message);
    return Object.assign({}, judgment, { outcome: 'RAN_ERROR', detail: err.message });
  }
}

/**
 * 追加階段 M（追加階段 N 已配合新設計改寫內容）：組出「如果今天執行每日檢查
 * 會發生什麼事」的完整報告內容，供「檢查自動排程條件（唯讀）」與
 * 「⚠️⚠️ 立即執行自動排程檢查」的確認視窗共用——兩邊顯示的內容保證一字不差，
 * 因為都是呼叫這同一個函式，且底層判斷都經過 judgeGenerateAction_()／
 * judgeRemindStuckAction_()。這個函式本身只讀取，不寫入任何東西。
 * @returns {{lines: string[], anyWouldRun: boolean, today: string, isDryRun: boolean}}
 */
function buildAutomationCheckReport_() {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const triggers = listAutomationTriggers_();
  const adminEmail = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '');

  const lines = [];
  lines.push('今天（' + timezone + '）：' + today);
  lines.push('已安裝的觸發器：' + triggers.length + ' 個'
    + (triggers.length > 0
      ? '（函式：' + AUTOMATION_TRIGGER_FUNCTION + '，Apps Script 不提供精確的下次執行時間，只保證每 24 小時內於設定的小時觸發一次）'
      : '（未安裝，自動排程目前不會自己執行任何動作）'));
  lines.push('DRY_RUN：' + (isDryRun ? 'TRUE（今天若執行，不會真正寄出電郵）' : 'FALSE（今天若執行，會真正寄出電郵！）'));
  lines.push('幹事通知信箱（MAIL_ADMIN_NOTIFY）：' + (adminEmail || '⚠ 未設定，通知只會寫入 Logger，不會有人收到'));
  lines.push('');
  lines.push('自動排程只做兩件事：到期自動生成初稿（只通知幹事）、'
    + '卡在 REVIEW_SENT 太久時提醒幹事（只通知幹事）。'
    + '正式發出永遠不會由這裡觸發，一律要幹事在「步驟 4」手動執行。');
  lines.push('');

  let anyWouldRun = false;

  const quarterRows = readSheet(SHEETS.QUARTERS).filter(function (row) {
    return !!row[COLUMNS.QUARTERS.QUARTER_ID];
  });
  if (quarterRows.length === 0) {
    lines.push('Quarters 工作表沒有資料，沒有任何季度可檢查。');
  }

  quarterRows.forEach(function (row) {
    const quarterId = row[COLUMNS.QUARTERS.QUARTER_ID];
    const schedule = computeAutomationSchedule_(row, config);

    lines.push('【' + quarterId + '】');

    const generateJudgment = judgeGenerateAction_(quarterId, schedule.generateDate, today);
    let genLine = '　生成初稿：' + (schedule.generateDate || '（未設定日期）');
    if (generateJudgment.outcome === 'WOULD_RUN') {
      anyWouldRun = true;
      genLine += '　→ 今天執行檢查會觸發';
    } else if (generateJudgment.outcome === 'SKIPPED_STAGE' || generateJudgment.outcome === 'SKIPPED_HAS_VERSION') {
      genLine += '　（已生成過或已進入後續流程）';
    } else if (generateJudgment.outcome === 'SKIPPED_NOT_DUE') {
      genLine += '　（尚未到期）';
    } else {
      genLine += '　（沒有可用日期）';
    }
    lines.push(genLine);

    const remindJudgment = judgeRemindStuckAction_(quarterId, row, today, config);
    let remindLine = '　提醒（卡在 REVIEW_SENT）：';
    if (remindJudgment.outcome === 'SKIPPED_NOT_STUCK') {
      remindLine += '不適用（' + remindJudgment.detail + '）';
    } else if (remindJudgment.outcome === 'WOULD_RUN') {
      anyWouldRun = true;
      remindLine += '→ 今天執行檢查會觸發，' + remindJudgment.detail;
    } else {
      remindLine += remindJudgment.detail + '（已提醒 ' + remindJudgment.reminderCount + ' / ' + remindJudgment.maxCount + ' 次）';
    }
    lines.push(remindLine);

    lines.push('　正式發出：一律由幹事在「步驟 4」手動執行，不會被自動排程觸發');
    lines.push('');
  });

  return { lines: lines, anyWouldRun: anyWouldRun, today: today, isDryRun: isDryRun };
}

/**
 * 安裝每日自動排程觸發器。會先移除同名的舊觸發器，避免重複安裝造成一天執行兩次。
 * 本函式只應該由選單「安裝自動排程」（經過確認視窗）呼叫，不應該在其他地方自動呼叫。
 * @returns {{hour: number}} 實際採用的觸發小時
 */
function installAutomationTrigger() {
  removeAutomationTriggers_();

  const config = readConfig();
  const rawHour = Number(config[CONFIG_KEYS.SEND_HOUR_LOCAL]);
  const hour = isNaN(rawHour) ? 9 : Math.min(23, Math.max(0, Math.round(rawHour)));

  ScriptApp.newTrigger(AUTOMATION_TRIGGER_FUNCTION)
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .create();

  return { hour: hour };
}

/**
 * 移除所有綁定到 dailyAutomationCheck_ 的觸發器。
 * @returns {number} 移除的觸發器數目
 */
function removeAutomationTriggers_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === AUTOMATION_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

/**
 * 列出目前綁定到 dailyAutomationCheck_ 的觸發器。
 * @returns {Object[]} 觸發器摘要陣列
 */
function listAutomationTriggers_() {
  return ScriptApp.getProjectTriggers()
    .filter(function (trigger) { return trigger.getHandlerFunction() === AUTOMATION_TRIGGER_FUNCTION; })
    .map(function (trigger) {
      return { uniqueId: trigger.getUniqueId(), eventType: String(trigger.getEventType()) };
    });
}
