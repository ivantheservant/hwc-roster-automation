// 階段 B1：步驟 2「寄給堂委審閱」收件人篩選的回歸測試。
// 執行方式：node tests/mailer_recipients.test.js
// 跟 e2e_five_stage_flow.test.js 同一種手法：移植 Mailer.gs／EmailRecipientsSeed.gs
// 的純判斷邏輯（去掉 SpreadsheetApp 存取），用假資料驗證。全部姓名／電郵均為虛構。

const RECIPIENT_ROLE = { REVIEWER: 'REVIEWER', ALL: 'ALL' };
const MAIL_STAGES = { GENERATE: 'GENERATE', REMIND: 'REMIND', OFFICIAL: 'OFFICIAL', RESEND: 'RESEND', REVIEW: 'REVIEW' };

// ---- 移植：EmailRecipientsSeed.gs 的 isReviewerRecipientRow_() ----
function isReviewerRecipientRow_(row) {
  return isTrueValue_(row.Active)
    && String(row.Role || '').trim().toUpperCase() === RECIPIENT_ROLE.REVIEWER;
}
function isTrueValue_(v) { return String(v).trim().toUpperCase() === 'TRUE'; }

// ---- 移植：EmailRecipientsSeed.gs 的 countReviewerRecipients_()（改吃陣列而非 readSheet）----
function countReviewerRecipients_(rows) {
  return rows.filter(isReviewerRecipientRow_).length;
}

// ---- 移植：Mailer.gs 的 listRecipients_()（只留 LIST 類別的篩選部分，PERSON 類別跟本測試無關）----
function splitList_(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function listRecipients_(stage, rows) {
  const recipients = [];
  rows.forEach(function (row) {
    if (!isTrueValue_(row.Active)) return;

    if (stage === MAIL_STAGES.REVIEW) {
      if (!isReviewerRecipientRow_(row)) return;
    } else {
      const stages = splitList_(row.Stage);
      if (stages.indexOf(stage) === -1) return;
    }

    recipients.push({ email: row.Email, displayName: row.DisplayName, role: row.Role, stage: row.Stage });
  });
  return recipients;
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// ---- 假資料：全部虛構姓名／電郵（.invalid 網域）----
const rows = [
  { RecipientID: 'R1', Email: 'reviewer1@example.invalid', DisplayName: '假甲', Role: 'REVIEWER', Stage: 'GENERATE,OFFICIAL', Active: 'TRUE' },
  { RecipientID: 'R2', Email: 'reviewer2@example.invalid', DisplayName: '假乙', Role: 'REVIEWER', Stage: '', Active: 'TRUE' },
  { RecipientID: 'R3', Email: 'office@example.invalid', DisplayName: '假丙（辦公室）', Role: 'ALL', Stage: 'GENERATE,REMIND,OFFICIAL,RESEND', Active: 'TRUE' },
  { RecipientID: 'R4', Email: 'inactive-reviewer@example.invalid', DisplayName: '假丁', Role: 'REVIEWER', Stage: 'OFFICIAL', Active: 'FALSE' },
  { RecipientID: 'R5', Email: 'blank-role@example.invalid', DisplayName: '假戊', Role: '', Stage: 'OFFICIAL', Active: 'TRUE' },
  { RecipientID: 'R6', Email: 'typo-role@example.invalid', DisplayName: '假己', Role: 'reviewer', Stage: 'OFFICIAL', Active: 'TRUE' } // 小寫，應仍算 REVIEWER（.toUpperCase()）
];

console.log('\n=== REVIEW 階段：完全依 Role=REVIEWER，不理 Stage 欄 ===');
{
  const reviewRecipients = listRecipients_(MAIL_STAGES.REVIEW, rows);
  const emails = reviewRecipients.map(r => r.email).sort();
  check('★ Role=REVIEWER 且 Active=TRUE → 收（R1，Stage 欄有值也不影響）',
    emails.indexOf('reviewer1@example.invalid') !== -1, true);
  check('★ Role=REVIEWER 且 Active=TRUE → 收（R2，即使 Stage 欄完全空白）',
    emails.indexOf('reviewer2@example.invalid') !== -1, true);
  check('★ Role=ALL → 不收審閱信，即使 Stage 欄包含所有階段（R3，辦公室）',
    emails.indexOf('office@example.invalid') === -1, true);
  check('★ Role=REVIEWER 但 Active=FALSE → 不收（R4）',
    emails.indexOf('inactive-reviewer@example.invalid') === -1, true);
  check('★ Role 空白 → 不收（R5，不會拋錯，只是靜靜不收）',
    emails.indexOf('blank-role@example.invalid') === -1, true);
  check('★ Role 小寫 reviewer → 仍算 REVIEWER，會收（R6，大小寫不敏感）',
    emails.indexOf('typo-role@example.invalid') !== -1, true);
  check('★ REVIEW 階段總收件人數（R1、R2、R6 三人）', reviewRecipients.length, 3);
}

console.log('\n=== 其他階段（例如 OFFICIAL）：完全依 Stage 欄，不理 Role ===');
{
  const officialRecipients = listRecipients_(MAIL_STAGES.OFFICIAL, rows);
  const emails = officialRecipients.map(r => r.email).sort();
  check('★ Role=REVIEWER 但 Stage 欄有 OFFICIAL → 一樣收（R1，OFFICIAL 不理 Role）',
    emails.indexOf('reviewer1@example.invalid') !== -1, true);
  check('★ Role=ALL 但 Stage 欄有 OFFICIAL → 收（R3，辦公室應收 OFFICIAL）',
    emails.indexOf('office@example.invalid') !== -1, true);
  check('★ Stage 欄完全空白 → 不收任何非 REVIEW 階段（R2）',
    emails.indexOf('reviewer2@example.invalid') === -1, true);
  check('★ Active=FALSE → 不收（R4，即使 Stage 欄有 OFFICIAL）',
    emails.indexOf('inactive-reviewer@example.invalid') === -1, true);
}

console.log('\n=== countReviewerRecipients_() 與 listRecipients_(REVIEW) 結果必須一致 ===');
{
  // 這兩個函式各自獨立實作同一條篩選條件（Active=TRUE 且 Role=REVIEWER），
  // 階段 D4 已合併成共用的 isReviewerRecipientRow_()——這裡直接驗證合併後
  // 兩邊的「人數」互相對得上，防止日後有人只改其中一邊又走回頭路。
  const count = countReviewerRecipients_(rows);
  const reviewRecipients = listRecipients_(MAIL_STAGES.REVIEW, rows);
  check('★ countReviewerRecipients_() 與 listRecipients_(REVIEW).length 相等', count, reviewRecipients.length);
  check('★ 兩者都是 3（R1、R2、R6）', count, 3);
}

console.log('\n=== 邊界情況：全部略過 vs 全部收 ===');
{
  const allInactive = rows.map(r => Object.assign({}, r, { Active: 'FALSE' }));
  check('★ 全部 Active=FALSE → REVIEW 階段零收件人', listRecipients_(MAIL_STAGES.REVIEW, allInactive).length, 0);
  check('★ 全部 Active=FALSE → countReviewerRecipients_ 也是 0', countReviewerRecipients_(allInactive), 0);

  const allReviewer = [
    { RecipientID: 'X1', Email: 'x1@example.invalid', DisplayName: '假庚', Role: 'REVIEWER', Stage: '', Active: 'TRUE' },
    { RecipientID: 'X2', Email: 'x2@example.invalid', DisplayName: '假辛', Role: 'REVIEWER', Stage: '', Active: 'TRUE' }
  ];
  check('★ 全部 Role=REVIEWER 且 Active=TRUE → 全數收到', listRecipients_(MAIL_STAGES.REVIEW, allReviewer).length, 2);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
