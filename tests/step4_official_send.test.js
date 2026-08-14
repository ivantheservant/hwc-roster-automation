// 階段 D（第五輪批次）：「步驟 4：正式發出」的離線回歸測試——這是唯一一個
// 尚未在 2027T1 實測的階段，一次過會寄給約 60 人、產生 60 個個人 PDF，
// 是全系統最重的操作，先用離線測試把邏輯釘死。
// 執行方式：node tests/step4_official_send.test.js
// 移植 Mailer.gs 的 listRecipients_()／deliverOne_()／generateMailAttachment_()
// 精簡版本，以及 QuarterStage.gs 的 requireQuarterStage_()／
// advanceQuarterStage_()，Trigger.gs 的結構性防護。全部姓名虛構、電郵用
// x.com／example.invalid。

const MAIL_STAGES = { GENERATE: 'GENERATE', REMIND: 'REMIND', OFFICIAL: 'OFFICIAL', RESEND: 'RESEND', REVIEW: 'REVIEW' };
const RECIPIENT_TYPE = { LIST: 'LIST', PERSON: 'PERSON' };
const SEND_AS = { TO: 'TO', CC: 'CC', BCC: 'BCC' };
const MAIL_STATUS = {
  SENT: 'SENT', DRY_RUN: 'DRY_RUN', SKIPPED_NO_EMAIL: 'SKIPPED_NO_EMAIL',
  SKIPPED_UNCHANGED: 'SKIPPED_UNCHANGED', FAILED: 'FAILED', ERROR_PDF: 'ERROR_PDF', ERROR_PDF_MISSING: 'ERROR_PDF_MISSING'
};
const QUARTER_STAGE = { DRAFT: 'DRAFT', REVIEW_SENT: 'REVIEW_SENT', REQUESTS_APPLIED: 'REQUESTS_APPLIED', OFFICIAL_SENT: 'OFFICIAL_SENT' };
const QUARTER_STAGE_ORDER = [QUARTER_STAGE.DRAFT, QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED, QUARTER_STAGE.OFFICIAL_SENT];

function splitList_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function isTrueValue_(v) { return String(v).trim().toUpperCase() === 'TRUE'; }

// =====================================================================
// 假「資料庫」
// =====================================================================
function makeDb() {
  return {
    assignments: [], // {personId, postId, slotIndex, serviceDate}
    people: {},      // personId -> {nameTC, email}
    emailRecipients: [], // {email, displayName, stage, sendAs, active}
    personalPdfExists: {}, // personId -> boolean（模擬 Shared Drive 已有該人個人 PDF 且大小正常）
    quarterStage: QUARTER_STAGE.REQUESTS_APPLIED
  };
}

function groupAssignmentsByPerson_(assignments) {
  const byPerson = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!byPerson[a.personId]) byPerson[a.personId] = [];
    byPerson[a.personId].push(a);
  });
  return byPerson;
}

// ---- 移植：Mailer.gs 的 listRecipients_()（OFFICIAL／RESEND 才有 PERSON 類別，
//      這裡只測 OFFICIAL，RESEND 分支保留但用不到）----
function listRecipients_(db, stage) {
  const recipients = [];
  db.emailRecipients.forEach(function (row) {
    if (!isTrueValue_(row.active)) return;
    if (stage === MAIL_STAGES.REVIEW) {
      if (String(row.role || '').toUpperCase() !== 'REVIEWER') return;
    } else {
      const stages = splitList_(row.stage);
      if (stages.indexOf(stage) === -1) return;
    }
    recipients.push({ type: RECIPIENT_TYPE.LIST, personId: '', email: row.email, displayName: row.displayName, sendAs: row.sendAs || SEND_AS.TO });
  });

  if (stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND) {
    const assignmentsByPerson = groupAssignmentsByPerson_(db.assignments);
    const personIds = {};
    Object.keys(assignmentsByPerson).forEach(function (id) { personIds[id] = true; });
    // OFFICIAL 刻意不納入 lastHashByPerson（零派工被頂走者）——那是 RESEND 專屬
    // 的行為（見 Mailer.gs listRecipients_() 的說明：「OFFICIAL 從來不會有
    // 『上次寄送紀錄』這種情況，因為 OFFICIAL 是這一季第一次正式寄送」）。
    Object.keys(personIds).sort().forEach(function (personId) {
      const person = db.people[personId];
      recipients.push({
        type: RECIPIENT_TYPE.PERSON, personId: personId,
        email: person ? person.email : '', displayName: person ? person.nameTC : personId, sendAs: SEND_AS.TO
      });
    });
  }
  return recipients;
}

// ---- 移植：Mailer.gs 的 deliverOne_() 精簡版（去掉範本代入細節，保留狀態判斷邏輯）----
function deliverOne_(db, recipient, isDryRun) {
  const assignmentsByPerson = groupAssignmentsByPerson_(db.assignments);
  const personAssignments = recipient.personId ? (assignmentsByPerson[recipient.personId] || []) : [];
  const base = { recipientType: recipient.type, personId: recipient.personId, email: recipient.email };

  // 只有 PERSON 類別、OFFICIAL 階段才需要個人 PDF（LIST 類別在這個測試不需要附件）
  if (recipient.type === RECIPIENT_TYPE.PERSON) {
    const hasPdf = !!db.personalPdfExists[recipient.personId];
    if (!hasPdf) {
      return Object.assign({}, base, { status: MAIL_STATUS.ERROR_PDF_MISSING, errorMessage: '請先執行『產生個人 PDF』' });
    }
  }

  if (!recipient.email) {
    return Object.assign({}, base, { status: MAIL_STATUS.SKIPPED_NO_EMAIL });
  }
  if (isDryRun) {
    return Object.assign({}, base, { status: MAIL_STATUS.DRY_RUN });
  }
  return Object.assign({}, base, { status: MAIL_STATUS.SENT });
}

function sendStage_(db, stage, isDryRun) {
  const recipients = listRecipients_(db, stage);
  return recipients.map(function (r) { return deliverOne_(db, r, isDryRun); });
}

// ---- 移植：QuarterStage.gs 的 requireQuarterStage_()／advanceQuarterStage_() ----
function requireQuarterStage_(db, allowedStages, stepName) {
  if (allowedStages.indexOf(db.quarterStage) === -1) {
    throw new Error('「' + stepName + '」需要 Stage 為「' + allowedStages.join(' 或 ') + '」，但目前是「' + db.quarterStage + '」。');
  }
  return db.quarterStage;
}
function advanceQuarterStage_(db, newStage) {
  db.quarterStage = newStage;
}

// ---- 移植：Trigger.gs 的結構性防護 ----
let AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;
function assertOfficialNotFromAutomationTrigger_() {
  if (!AUTOMATION_TRIGGER_CONTEXT_ACTIVE) return;
  throw new Error('OFFICIAL 階段不可以由自動排程觸發，必須由幹事手動執行「步驟 4：正式發出」');
}

// ---- 移植：FiveStageCore.gs 的 executeStep4Send_()（簡化，串起以上幾個函式）----
function executeStep4Send_(db, isDryRun) {
  requireQuarterStage_(db, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  assertOfficialNotFromAutomationTrigger_();
  const outcomes = sendStage_(db, MAIL_STAGES.OFFICIAL, isDryRun);
  advanceQuarterStage_(db, QUARTER_STAGE.OFFICIAL_SENT);
  return outcomes;
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkThrows(label, fn) {
  try { fn(); fail++; console.log(`FAIL  ${label}\n      沒有拋出錯誤`); }
  catch (err) { console.log(`PASS  ${label}`); }
}

function buildStandardDb() {
  const db = makeDb();
  db.emailRecipients = [
    { email: 'office@example.invalid', displayName: '假辦公室', stage: 'GENERATE,OFFICIAL,RESEND', sendAs: SEND_AS.CC, active: 'TRUE' },
    { email: 'reviewer@example.invalid', displayName: '假審閱者', stage: '', sendAs: SEND_AS.CC, active: 'TRUE' } // Role 相關欄位這裡不影響 OFFICIAL 判斷，Stage 欄空白 → 不收 OFFICIAL
  ];
  db.people = {
    P001: { nameTC: '陳大文', email: 'p1@x.com' },
    P002: { nameTC: '李小明', email: 'p2@x.com' },
    P003: { nameTC: '王美美', email: '' } // 無電郵
  };
  db.assignments = [
    { personId: 'P001', postId: 'CHAIR', slotIndex: 1, serviceDate: '2027-05-02' },
    { personId: 'P002', postId: 'READ', slotIndex: 1, serviceDate: '2027-05-02' },
    { personId: 'P003', postId: 'PPT', slotIndex: 1, serviceDate: '2027-05-02' }
  ];
  db.personalPdfExists = { P001: true, P002: true, P003: true };
  db.quarterStage = QUARTER_STAGE.REQUESTS_APPLIED;
  return db;
}

console.log('\n=== D1：收件人組成——LIST（依 Stage 欄）＋ PERSON（本季有派工者），不重複不遺漏 ===');
{
  const db = buildStandardDb();
  const recipients = listRecipients_(db, MAIL_STAGES.OFFICIAL);
  const listRecipientsOnly = recipients.filter(r => r.type === RECIPIENT_TYPE.LIST);
  const personRecipientsOnly = recipients.filter(r => r.type === RECIPIENT_TYPE.PERSON);

  check('★ LIST 只有 Stage 欄包含 OFFICIAL 的一行（office，不是 reviewer）',
    listRecipientsOnly.map(r => r.email), ['office@example.invalid']);
  check('★ PERSON 涵蓋全部 3 個有派工的人，不多不少', personRecipientsOnly.map(r => r.personId).sort(), ['P001', 'P002', 'P003']);
  check('★ 沒有重複收件人（LIST 與 PERSON 加總後每個 email／personId 只出現一次）',
    recipients.length, new Set(recipients.map(r => r.type + ':' + (r.personId || r.email))).size);

  // 有派工但無電郵者：記 SKIPPED_NO_EMAIL，不是 FAILED
  const outcomes = sendStage_(db, MAIL_STAGES.OFFICIAL, true);
  const p003Outcome = outcomes.find(o => o.personId === 'P003');
  check('★ 王美美（有派工、無電郵）→ SKIPPED_NO_EMAIL，不是 FAILED', p003Outcome.status, MAIL_STATUS.SKIPPED_NO_EMAIL);
}

console.log('\n=== D2：零派工者不會被納入 OFFICIAL（那是 RESEND 才有的行為） ===');
{
  const db = buildStandardDb();
  // P004 這一季完全沒有被派工（不在 db.assignments 裡）
  db.people.P004 = { nameTC: '假四', email: 'p4@x.com' };
  const recipients = listRecipients_(db, MAIL_STAGES.OFFICIAL);
  check('★ 完全沒有派工的人不會出現在 OFFICIAL 收件人清單', recipients.some(r => r.personId === 'P004'), false);
}

console.log('\n=== D3：個人 PDF 缺失——記 ERROR_PDF_MISSING，不會整批中斷 ===');
{
  const db = buildStandardDb();
  db.personalPdfExists.P002 = false; // 李小明的個人 PDF 缺失
  const outcomes = sendStage_(db, MAIL_STAGES.OFFICIAL, true);
  const p002Outcome = outcomes.find(o => o.personId === 'P002');
  const p001Outcome = outcomes.find(o => o.personId === 'P001');
  check('★ 李小明（PDF 缺失）→ ERROR_PDF_MISSING', p002Outcome.status, MAIL_STATUS.ERROR_PDF_MISSING);
  check('★ 陳大文（PDF 正常）不受李小明缺件影響，正常處理', p001Outcome.status, MAIL_STATUS.DRY_RUN);
  check('★ 整批仍然處理完全部收件人（沒有中途中斷）', outcomes.length, listRecipients_(db, MAIL_STAGES.OFFICIAL).length);
}

console.log('\n=== D4：Stage 前置條件——只有 REQUESTS_APPLIED 可以執行步驟 4 ===');
{
  [QUARTER_STAGE.DRAFT, QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.OFFICIAL_SENT].forEach(function (stage) {
    const db = buildStandardDb();
    db.quarterStage = stage;
    checkThrows('★ Stage=' + stage + '（不是 REQUESTS_APPLIED）→ 執行步驟 4 一定拋錯',
      () => executeStep4Send_(db, true));
  });
  const dbOk = buildStandardDb();
  dbOk.quarterStage = QUARTER_STAGE.REQUESTS_APPLIED;
  let threw = false;
  try { executeStep4Send_(dbOk, true); } catch (err) { threw = true; }
  check('★ Stage=REQUESTS_APPLIED → 不拋錯，正常執行', threw, false);
}

console.log('\n=== D5：執行後 Stage → OFFICIAL_SENT，且不可重複執行倒退 ===');
{
  const db = buildStandardDb();
  executeStep4Send_(db, true);
  check('★ 執行後 Stage 變成 OFFICIAL_SENT', db.quarterStage, QUARTER_STAGE.OFFICIAL_SENT);
  checkThrows('★ 再執行一次步驟 4（Stage 已經是 OFFICIAL_SENT）→ 拋錯，不會重複發送',
    () => executeStep4Send_(db, true));
}

console.log('\n=== D6：DRY_RUN=TRUE 時全部記 DRY_RUN，一封都不會真正寄出 ===');
{
  const db = buildStandardDb();
  const outcomes = sendStage_(db, MAIL_STAGES.OFFICIAL, true);
  const sentForReal = outcomes.filter(o => o.status === MAIL_STATUS.SENT);
  check('★ DRY_RUN=TRUE 時沒有任何一筆是 SENT（真正寄出）', sentForReal.length, 0);
  check('★ 有電郵、PDF 齊全的收件人全部記 DRY_RUN',
    outcomes.filter(o => o.status === MAIL_STATUS.DRY_RUN).length, 3); // office、陳大文、李小明（王美美無電郵另計）

  const dbReal = buildStandardDb();
  const realOutcomes = sendStage_(dbReal, MAIL_STAGES.OFFICIAL, false);
  check('★ 對照組：DRY_RUN=FALSE 時才會有 SENT', realOutcomes.some(o => o.status === MAIL_STATUS.SENT), true);
}

console.log('\n=== D7：自動排程永遠不會觸發 OFFICIAL（結構性防護未被繞過） ===');
{
  const db = buildStandardDb();
  AUTOMATION_TRIGGER_CONTEXT_ACTIVE = true;
  checkThrows('★ 在自動排程執行期間呼叫步驟 4 → 一定拋錯，即使 Stage 正確也一樣',
    () => executeStep4Send_(db, true));
  AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;

  const db2 = buildStandardDb();
  let threw = false;
  try { executeStep4Send_(db2, true); } catch (err) { threw = true; }
  check('★ 對照組：不在自動排程期間、Stage 正確 → 正常執行，不拋錯', threw, false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
