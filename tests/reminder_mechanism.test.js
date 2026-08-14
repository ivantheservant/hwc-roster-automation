// 第三輪批次下一輪（新一批階段 B）：REMIND 提醒機制擴大範圍（DRAFT／
// REVIEW_SENT／REQUESTS_APPLIED 三種停滯情境、兩個獨立觸發維度）的回歸測試。
// 執行方式：node tests/reminder_mechanism.test.js
// 移植 Trigger.gs 的 judgeRemindAction_()／resolveRemindReferenceDate_()／
// readReminderLog_() 邏輯，去掉試算表存取，逐字比對正式碼的判斷順序。

const QUARTER_STAGE = { DRAFT: 'DRAFT', REVIEW_SENT: 'REVIEW_SENT', REQUESTS_APPLIED: 'REQUESTS_APPLIED', OFFICIAL_SENT: 'OFFICIAL_SENT' };
const AUTOMATION_ACTIONS = { GENERATE: 'TRIGGER_GENERATE', REMIND: 'TRIGGER_REMIND', OFFICIAL: 'TRIGGER_OFFICIAL' };
const DEFAULTS = { REMIND_STUCK_DAYS: 3, REMIND_STUCK_MAX_COUNT: 3, REMIND_DEADLINE_DAYS: 7 };

function daysBetween_(fromDateStr, toDateStr) {
  const from = Date.UTC(Number(fromDateStr.slice(0, 4)), Number(fromDateStr.slice(5, 7)) - 1, Number(fromDateStr.slice(8, 10)));
  const to = Date.UTC(Number(toDateStr.slice(0, 4)), Number(toDateStr.slice(5, 7)) - 1, Number(toDateStr.slice(8, 10)));
  return Math.round((to - from) / 86400000);
}
function shiftDateString_(dateStr, days) {
  const base = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
  const shifted = new Date(base + days * 86400000);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth() + 1, d = shifted.getUTCDate();
  const p = n => (n < 10 ? '0' + n : String(n));
  return y + '-' + p(m) + '-' + p(d);
}

// =====================================================================
// 假「資料庫」：Quarters／RosterVersions／AuditLog，操作介面模仿 readSheet()
// 回傳物件陣列的形狀。
// =====================================================================
function makeDb() {
  return { quarters: {}, versions: [], auditLog: [] };
}
function getConfig_(config, key, fallback) {
  const v = config[key];
  return (v === undefined || v === null || v === '') ? fallback : v;
}
function getQuarterStage_(db, quarterId) {
  const q = db.quarters[quarterId];
  if (!q) throw new Error('找不到季度: ' + quarterId);
  const order = [QUARTER_STAGE.DRAFT, QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED, QUARTER_STAGE.OFFICIAL_SENT];
  return order.indexOf(q.stage) !== -1 ? q.stage : QUARTER_STAGE.DRAFT;
}
function findLatestVersionNo_(db, quarterId) {
  const rows = db.versions.filter(v => v.quarterId === quarterId);
  if (rows.length === 0) return -1;
  return Math.max(...rows.map(v => v.versionNo));
}
function findLatestVersionCreatedDate_(db, quarterId, versionNo) {
  const row = db.versions.find(v => v.quarterId === quarterId && v.versionNo === versionNo);
  return row ? row.createdAt : '';
}
function computeAutomationSchedule_(quarterRow) {
  // 簡化移植：只需要 officialDate，直接讀 quarterRow.officialSendOn（測試中一律
  // 直接給出算好的值，不需要重現 LEAD_DAYS_OFFICIAL 推算與 weekday guard，
  // 那部分已經在 Trigger.gs 既有邏輯中，這裡專注測 REMIND 本身的判斷）。
  return { officialDate: quarterRow.officialSendOn || '' };
}

// ---- 移植：resolveRemindReferenceDate_() ----
function resolveRemindReferenceDate_(db, quarterId, stage, quarterRow) {
  if (stage === QUARTER_STAGE.DRAFT) {
    const versionNo = findLatestVersionNo_(db, quarterId);
    if (versionNo < 0) return '';
    return findLatestVersionCreatedDate_(db, quarterId, versionNo);
  }
  return quarterRow.stageUpdatedAt || '';
}

// ---- 移植：readReminderLog_() ----
function readReminderLog_(db, quarterId, stage) {
  const key = quarterId + '|' + stage;
  return db.auditLog
    .filter(row => row.action === AUTOMATION_ACTIONS.REMIND && row.targetKey === key)
    .map(row => row.newValue)
    .filter(Boolean);
}

// ---- 移植：judgeRemindAction_()（逐字比對正式碼的判斷順序）----
function judgeRemindAction_(db, quarterId, quarterRow, today, config) {
  const action = AUTOMATION_ACTIONS.REMIND;
  const stage = getQuarterStage_(db, quarterId);
  const targetKey = quarterId + '|' + stage;
  const base = { quarterId, action, targetKey, stage, targetDate: '' };
  const maxCount = getConfig_(config, 'REMIND_STUCK_MAX_COUNT', DEFAULTS.REMIND_STUCK_MAX_COUNT);

  if (stage === QUARTER_STAGE.OFFICIAL_SENT) {
    return Object.assign({}, base, { outcome: 'SKIPPED_NOT_STUCK', detail: 'Stage 已經是 OFFICIAL_SENT，這一季不需要提醒', reasons: [], reminderCount: 0, maxCount, daysStuck: null, daysUntilDeadline: null });
  }

  const reminderLog = readReminderLog_(db, quarterId, stage);
  const reminderCount = reminderLog.length;

  if (reminderCount >= maxCount) {
    return Object.assign({}, base, { outcome: 'SKIPPED_MAX_REACHED', detail: '達到上限', reasons: [], reminderCount, maxCount, daysStuck: null, daysUntilDeadline: null });
  }
  if (reminderLog.indexOf(today) !== -1) {
    return Object.assign({}, base, { outcome: 'SKIPPED_DONE', detail: '今天已經提醒過', reasons: [], reminderCount, maxCount, daysStuck: null, daysUntilDeadline: null });
  }

  const stuckDays = getConfig_(config, 'REMIND_STUCK_DAYS', DEFAULTS.REMIND_STUCK_DAYS);
  const referenceDate = resolveRemindReferenceDate_(db, quarterId, stage, quarterRow);
  let daysStuck = null, stuckTriggered = false;
  if (referenceDate) {
    daysStuck = daysBetween_(referenceDate, today);
    stuckTriggered = daysStuck >= stuckDays;
  }

  const deadlineDays = getConfig_(config, 'REMIND_DEADLINE_DAYS', DEFAULTS.REMIND_DEADLINE_DAYS);
  const schedule = computeAutomationSchedule_(quarterRow);
  let daysUntilDeadline = null, deadlineTriggered = false;
  if (schedule.officialDate) {
    daysUntilDeadline = daysBetween_(today, schedule.officialDate);
    deadlineTriggered = daysUntilDeadline <= deadlineDays;
  }

  const reasons = [];
  if (stuckTriggered) reasons.push('STUCK');
  if (deadlineTriggered) reasons.push('DEADLINE');

  if (reasons.length === 0) {
    return Object.assign({}, base, { outcome: 'SKIPPED_NOT_DUE', detail: '未達門檻', reasons: [], reminderCount, maxCount, daysStuck, daysUntilDeadline });
  }
  return Object.assign({}, base, { outcome: 'WOULD_RUN', detail: '第 ' + (reminderCount + 1) + ' / ' + maxCount + ' 次提醒', reasons, reminderCount, maxCount, daysStuck, daysUntilDeadline, stuckDays, deadlineDays });
}

// ---- 移植：executeAutomationAction_() 的 REMIND 執行分支（只驗證「會不會真的
//      寄信」跟「會不會寫 AuditLog」，不重複整個函式）----
function executeRemind_(db, judgment, today, isDryRun, adminEmail) {
  if (judgment.outcome !== 'WOULD_RUN') return { ran: false, sentReal: false, recipients: [] };
  // 移植 notifyAdmin_() 的 DRY_RUN 防呆：DRY_RUN 或沒有 adminEmail 都不真正寄出。
  const sentReal = !isDryRun && !!adminEmail;
  db.auditLog.push({ action: judgment.action, targetKey: judgment.targetKey, newValue: today, notes: judgment.reasons.join('+') });
  // 「只寄給幹事」的驗證重點：這裡的收件人清單只可能是 [adminEmail]，不會有任何
  // 來自 EmailRecipients／RosterAssignments 的義工／堂委地址混進來——移植版本
  // 刻意不去讀那兩張表，結構上就不可能出現義工電郵，跟正式碼的
  // notifyAdminStageReminder_() 只呼叫 notifyAdmin_(subject, body, adminEmail, ...)
  // 是同一個道理。
  return { ran: true, sentReal: sentReal, recipients: adminEmail ? [adminEmail] : [] };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const ADMIN_EMAIL = 'admin@example.invalid';
const VOLUNTEER_EMAILS = ['p1@x.com', 'p2@x.com']; // 用來確認「絕不出現在收件人清單」

console.log('\n=== 三種停滯 Stage：DRAFT／REVIEW_SENT／REQUESTS_APPLIED 都可能觸發 ===');
{
  const today = '2027-02-01';
  const config = {};

  // DRAFT：已有版本，版本建立於 5 天前（超過 REMIND_STUCK_DAYS=3）
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.DRAFT, officialSendOn: '2027-06-01' };
    db.versions.push({ quarterId: '2027T1', versionNo: 0, createdAt: shiftDateString_(today, -5) });
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ DRAFT 且已有版本、停滯超過門檻 → WOULD_RUN', j.outcome, 'WOULD_RUN');
    check('★ DRAFT 觸發原因是 STUCK', j.reasons, ['STUCK']);
  }
  // DRAFT：完全沒有版本 → 停滯維度無法判斷，不會誤判觸發
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.DRAFT, officialSendOn: '2027-06-01' };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ DRAFT 但沒有任何版本 → 停滯維度不觸發（不是誤判成「剛好卡住」）', j.reasons.indexOf('STUCK'), -1);
  }
  // REVIEW_SENT：StageUpdatedAt 4 天前
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -4), officialSendOn: '2027-06-01' };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ REVIEW_SENT 停滯超過門檻 → WOULD_RUN', j.outcome, 'WOULD_RUN');
  }
  // REQUESTS_APPLIED：StageUpdatedAt 4 天前
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -4), officialSendOn: '2027-06-01' };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ REQUESTS_APPLIED 停滯超過門檻 → WOULD_RUN', j.outcome, 'WOULD_RUN');
  }
  // OFFICIAL_SENT：永遠不提醒
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.OFFICIAL_SENT, stageUpdatedAt: shiftDateString_(today, -30), officialSendOn: shiftDateString_(today, -20) };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ OFFICIAL_SENT → 一律不提醒（即使停滯很久、即使已過死線）', j.outcome, 'SKIPPED_NOT_STUCK');
  }
}

console.log('\n=== 兩個觸發維度：各自獨立成立，同時成立不重複寄兩封 ===');
{
  const today = '2027-02-01';
  const config = {};

  // 只有「死線接近」成立（停滯時間未到，剛前進到這個 Stage 不久）
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -1), officialSendOn: shiftDateString_(today, 3) };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ 只有死線接近成立 → reasons 只有 DEADLINE', j.reasons, ['DEADLINE']);
    check('★ 仍然是 WOULD_RUN（任一維度成立即可）', j.outcome, 'WOULD_RUN');
  }
  // 只有「停滯時間」成立（死線還很遠）
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -5), officialSendOn: shiftDateString_(today, 60) };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ 只有停滯時間成立 → reasons 只有 STUCK', j.reasons, ['STUCK']);
  }
  // 兩者同時成立
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -5), officialSendOn: shiftDateString_(today, 3) };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ 兩者同時成立 → reasons 同時包含 STUCK 與 DEADLINE', j.reasons, ['STUCK', 'DEADLINE']);
    check('★ 但仍然只是「一次」WOULD_RUN 判斷（呼叫端只會執行一次 workFn，只寄一封）', j.outcome, 'WOULD_RUN');
    // 直接驗證：整個判斷過程只產生一個 judgment 物件，不是兩個各自獨立的
    // WOULD_RUN——呼叫端（dailyAutomationCheck_）對每個季度只呼叫一次
    // judgeRemindAction_()，結構上就不可能寄兩封。
  }
  // 都不成立
  {
    const db = makeDb();
    db.quarters['2027T1'] = { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -1), officialSendOn: shiftDateString_(today, 60) };
    const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
    check('★ 都不成立 → SKIPPED_NOT_DUE', j.outcome, 'SKIPPED_NOT_DUE');
  }
}

console.log('\n=== 提醒次數上限：每個「季度＋Stage」各自獨立計算，Stage 前進後重置 ===');
{
  const today = '2027-02-10';
  const config = { REMIND_STUCK_MAX_COUNT: 2 };
  const db = makeDb();
  db.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) };

  // 已經提醒過 2 次（達到上限 2）
  db.auditLog.push({ action: AUTOMATION_ACTIONS.REMIND, targetKey: '2027T1|REVIEW_SENT', newValue: shiftDateString_(today, -2) });
  db.auditLog.push({ action: AUTOMATION_ACTIONS.REMIND, targetKey: '2027T1|REVIEW_SENT', newValue: shiftDateString_(today, -1) });
  const j1 = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
  check('★ 已達上限 → SKIPPED_MAX_REACHED，不再提醒', j1.outcome, 'SKIPPED_MAX_REACHED');

  // Stage 前進到 REQUESTS_APPLIED 之後，同一季度的提醒次數應該重新從零開始
  db.quarters['2027T1'].stage = QUARTER_STAGE.REQUESTS_APPLIED;
  db.quarters['2027T1'].stageUpdatedAt = shiftDateString_(today, -10);
  const j2 = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, config);
  check('★ Stage 前進後（REQUESTS_APPLIED），舊 Stage 用剩的提醒次數不會拖累新 Stage', j2.outcome, 'WOULD_RUN');
  check('★ 新 Stage 的 reminderCount 從 0 開始（不是承接 REVIEW_SENT 的 2）', j2.reminderCount, 0);

  // 今天已經提醒過（同一個 Stage）就不重複
  const db2 = makeDb();
  db2.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) };
  db2.auditLog.push({ action: AUTOMATION_ACTIONS.REMIND, targetKey: '2027T1|REVIEW_SENT', newValue: today });
  const j3 = judgeRemindAction_(db2, '2027T1', db2.quarters['2027T1'], today, {});
  check('★ 今天已經提醒過 → SKIPPED_DONE', j3.outcome, 'SKIPPED_DONE');
}

console.log('\n=== 一律只寄給幹事，絕不寄給義工 ===');
{
  const today = '2027-02-01';
  const db = makeDb();
  db.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) };
  const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, {});
  check('★ 判斷結果是 WOULD_RUN（前提成立才繼續驗證收件人）', j.outcome, 'WOULD_RUN');

  const result = executeRemind_(db, j, today, false, ADMIN_EMAIL);
  check('★ 收件人清單只有幹事一人', result.recipients, [ADMIN_EMAIL]);
  VOLUNTEER_EMAILS.forEach(function (v) {
    check('★ 義工電郵（' + v + '）絕不在收件人清單內', result.recipients.indexOf(v), -1);
  });
}

console.log('\n=== DRY_RUN=TRUE 時不真正寄出 ===');
{
  const today = '2027-02-01';
  const db = makeDb();
  db.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) };
  const j = judgeRemindAction_(db, '2027T1', db.quarters['2027T1'], today, {});

  const dryRunResult = executeRemind_(db, j, today, true, ADMIN_EMAIL);
  check('★ DRY_RUN=TRUE → sentReal=false（不會真正呼叫 MailApp.sendEmail）', dryRunResult.sentReal, false);
  check('★ DRY_RUN=TRUE 但仍然「執行了」判斷（ran=true，只是不真的寄）', dryRunResult.ran, true);

  const db2 = makeDb();
  db2.quarters['2027T1'] = { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) };
  const j2 = judgeRemindAction_(db2, '2027T1', db2.quarters['2027T1'], today, {});
  const realResult = executeRemind_(db2, j2, today, false, ADMIN_EMAIL);
  check('★ DRY_RUN=FALSE 且有 adminEmail → sentReal=true', realResult.sentReal, true);
}

console.log('\n=== OFFICIAL 永遠不會被 REMIND 機制觸發（結構性防護維持） ===');
{
  // 移植 Trigger.gs 的 AUTOMATION_TRIGGER_CONTEXT_ACTIVE ＋
  // assertOfficialNotFromAutomationTrigger_() 結構性防護：任何在自動排程
  // 執行期間嘗試呼叫 sendStage(..., OFFICIAL) 的動作都必須被拒絕。這裡直接
  // 驗證這道防護本身邏輯正確，並且確認 REMIND 的判斷／執行路徑
  // （judgeRemindAction_／executeRemind_）從頭到尾沒有任何一個分支的
  // action 字串等於 'OFFICIAL' 或呼叫任何寄送流程——REMIND 一律經
  // notifyAdmin_ 這條独立路徑，結構上不可能繞過。
  let automationContextActive = false;
  function assertOfficialNotFromAutomationTrigger_(stage) {
    if (!automationContextActive) return;
    if (stage === 'OFFICIAL') throw new Error('OFFICIAL 階段不可以由自動排程觸發，必須由幹事手動執行「步驟 4：正式發出」');
  }

  automationContextActive = true;
  let threw = false;
  try {
    assertOfficialNotFromAutomationTrigger_('OFFICIAL');
  } catch (err) {
    threw = true;
  }
  check('★ 自動排程執行期間嘗試觸發 OFFICIAL → 一定拋錯', threw, true);
  automationContextActive = false;

  // 掃描 judgeRemindAction_ 產生的所有 outcome 分支，確認沒有任何一個
  // action 值是 'TRIGGER_OFFICIAL' 或跟 OFFICIAL 相關的字串。
  const today = '2027-02-01';
  const scenarios = [
    { stage: QUARTER_STAGE.DRAFT, stageUpdatedAt: '', officialSendOn: shiftDateString_(today, 3) },
    { stage: QUARTER_STAGE.REVIEW_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 60) },
    { stage: QUARTER_STAGE.REQUESTS_APPLIED, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, 2) },
    { stage: QUARTER_STAGE.OFFICIAL_SENT, stageUpdatedAt: shiftDateString_(today, -10), officialSendOn: shiftDateString_(today, -5) }
  ];
  scenarios.forEach(function (row, i) {
    const db = makeDb();
    db.quarters['2027T' + i] = row;
    const j = judgeRemindAction_(db, '2027T' + i, row, today, {});
    check('★ 情境 ' + i + '：judgment.action 一律是 TRIGGER_REMIND，不是 TRIGGER_OFFICIAL', j.action, AUTOMATION_ACTIONS.REMIND);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
