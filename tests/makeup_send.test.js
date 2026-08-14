// 階段 C（Opus 深度輪）C6 ＋ 階段 D：補寄工具的完整測試，以及它與封存機制的
// 交互檢查（本輪最危險的組合）。
// 執行方式：node tests/makeup_send.test.js
//
// 為什麼交互檢查特別重要：封存機制（階段 B）與補寄工具（階段 C）**都讀
// SendLog**。如果某個人的「已寄」紀錄被封存搬走了，補寄工具就會查不到、
// 把他當成「未收到」——結果是**已經收過信的人再收一封**，正正是補寄工具
// 本身要防止的問題。所以這兩者必須一起測。

const { loadGasSource } = require('./helpers/gas_loader.js');
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'FineTune.gs']);

const MAIL_STATUS = gas.MAIL_STATUS;
const MAIL_STAGES = gas.MAIL_STAGES;
const RECIPIENT_TYPE = gas.RECIPIENT_TYPE;

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// 移植：MakeupSend.gs 的三個純判斷函式（逐字對應正式碼）
// ---------------------------------------------------------------------------
function buildSendStatusByRecipient_(sendLogRows, quarterId, versionNo, stage) {
  const statusByKey = {};
  sendLogRows.forEach(function (row) {
    if (row.quarterId !== quarterId) return;
    if (Number(row.versionNo) !== versionNo) return;
    if (row.stage !== stage) return;
    const key = row.personId || String(row.email || '').trim().toLowerCase();
    if (!key) return;
    statusByKey[key] = String(row.status || '').toUpperCase();
  });
  return statusByKey;
}

function classifyMakeupRecipient_(recipient, lastStatus) {
  if (!recipient.email) {
    return { category: 'CANNOT_SEND', reason: 'NameMapping 沒有電郵地址，補寄一樣寄不出，請另外用其他方式通知' };
  }
  if (lastStatus === null || lastStatus === undefined || lastStatus === '') {
    return { category: 'NEEDS_RESEND', reason: 'SendLog 完全沒有紀錄，代表上次執行中斷時未處理到這一位' };
  }
  if (lastStatus === MAIL_STATUS.SENT) return { category: 'ALREADY_SENT', reason: '已經成功寄出（SENT）' };
  if (lastStatus === MAIL_STATUS.DRY_RUN) return { category: 'ALREADY_SENT', reason: '已在模擬模式處理（DRY_RUN），系統視為已處理' };
  if (lastStatus === MAIL_STATUS.SKIPPED_NO_EMAIL) return { category: 'CANNOT_SEND', reason: '上次因查無電郵而略過（SKIPPED_NO_EMAIL）' };
  if (lastStatus === MAIL_STATUS.SKIPPED_UNCHANGED) return { category: 'ALREADY_SENT', reason: '內容未變而略過（SKIPPED_UNCHANGED），系統視為已處理' };
  return { category: 'NEEDS_RESEND', reason: '上次處理結果是「' + lastStatus + '」，未成功寄出' };
}

/** 移植 planMakeupSend_() 的分類主體（recipients 由呼叫端提供，取代 listRecipients_）。 */
function planMakeupSend_(recipients, sendLogRows, quarterId, versionNo, stage) {
  const statusByKey = buildSendStatusByRecipient_(sendLogRows, quarterId, versionNo, stage);
  const alreadySent = [];
  const needsResend = [];
  const cannotSend = [];
  recipients.forEach(function (recipient) {
    const key = recipient.personId || String(recipient.email || '').trim().toLowerCase();
    const lastStatus = key ? (statusByKey[key] === undefined ? null : statusByKey[key]) : null;
    const verdict = classifyMakeupRecipient_(recipient, lastStatus);
    const entry = {
      personId: recipient.personId, email: recipient.email, displayName: recipient.displayName,
      lastStatus: lastStatus === null ? '（無紀錄）' : lastStatus, reason: verdict.reason
    };
    if (verdict.category === 'ALREADY_SENT') alreadySent.push(entry);
    else if (verdict.category === 'CANNOT_SEND') cannotSend.push(entry);
    else needsResend.push(entry);
  });
  return {
    quarterId: quarterId, versionNo: versionNo, stage: stage,
    totalExpected: recipients.length,
    alreadySent: alreadySent, needsResend: needsResend, cannotSend: cannotSend
  };
}

const names = function (list) { return list.map(function (r) { return r.personId || r.email; }).sort(); };

// ---------------------------------------------------------------------------
// 假資料：6 位有派工的義工 + 1 位 LIST 收件人
// ---------------------------------------------------------------------------
function buildRecipients() {
  return [
    { type: RECIPIENT_TYPE.LIST, personId: '', email: 'office@x.com', displayName: '教會辦公室' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P001', email: 'a01@x.com', displayName: '陳大文' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P002', email: 'a02@x.com', displayName: '李小明' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P003', email: 'a03@x.com', displayName: '王美美' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P004', email: 'a04@x.com', displayName: '張三' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P005', email: 'a05@x.com', displayName: '李四' },
    // 這一位在 NameMapping 完全沒有電郵
    { type: RECIPIENT_TYPE.PERSON, personId: 'P006', email: '', displayName: '無電郵者' }
  ];
}
function logRow(personId, email, status) {
  return { quarterId: '2099T1', versionNo: 3, stage: MAIL_STAGES.OFFICIAL, personId: personId, email: email, status: status };
}

console.log('\n=== C1／C6-1：全部未寄（SendLog 一筆紀錄都沒有）===');
{
  const plan = planMakeupSend_(buildRecipients(), [], '2099T1', 3, MAIL_STAGES.OFFICIAL);
  checkEqual('★ 應收 7 位', plan.totalExpected, 7);
  checkEqual('★ 已寄 0 位', plan.alreadySent.length, 0);
  checkEqual('★ 未收到 6 位（含 LIST 收件人，不含無電郵那位）', names(plan.needsResend),
    ['P001', 'P002', 'P003', 'P004', 'P005', 'office@x.com']);
  checkEqual('★ 無法寄 1 位（P006 沒有電郵）', names(plan.cannotSend), ['P006']);
  check('★ 無法寄的原因講清楚是「沒有電郵」，不是「未寄」',
    plan.cannotSend[0].reason.indexOf('沒有電郵') !== -1);
}

console.log('\n=== C1／C6-2：部分已寄（最典型的中斷情境）===');
{
  // 模擬：寄到 P002 就中斷了——P001、P002 已成功，其餘完全沒有紀錄
  const sendLog = [logRow('', 'office@x.com', 'SENT'), logRow('P001', 'a01@x.com', 'SENT'), logRow('P002', 'a02@x.com', 'SENT')];
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);

  checkEqual('★ 已寄 3 位（LIST + P001 + P002），不會再寄', names(plan.alreadySent), ['P001', 'P002', 'office@x.com']);
  checkEqual('★ 只補寄真正未收到的 3 位', names(plan.needsResend), ['P003', 'P004', 'P005']);
  checkEqual('★ 無法寄仍然是 1 位', names(plan.cannotSend), ['P006']);
  checkEqual('★ 三類加起來等於應收總數（沒有人被漏掉或重複計算）',
    plan.alreadySent.length + plan.needsResend.length + plan.cannotSend.length, plan.totalExpected);
}

console.log('\n=== C1／C6-3：全部已寄（不應該補寄任何人）===');
{
  const sendLog = buildRecipients().filter(function (r) { return r.email; })
    .map(function (r) { return logRow(r.personId, r.email, 'SENT'); });
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  checkEqual('★ 未收到 0 位——已經全部寄過，補寄工具不會做任何事', plan.needsResend.length, 0);
  checkEqual('★ 已寄 6 位', plan.alreadySent.length, 6);
}

console.log('\n=== C1／C6-4：混合各種失敗狀態 ===');
{
  const sendLog = [
    logRow('', 'office@x.com', 'SENT'),
    logRow('P001', 'a01@x.com', 'SENT'),                 // 已寄
    logRow('P002', 'a02@x.com', 'FAILED'),               // 寄失敗 → 要補寄
    logRow('P003', 'a03@x.com', 'ERROR_PDF'),            // PDF 產生失敗 → 要補寄
    logRow('P004', 'a04@x.com', 'ERROR_PDF_MISSING'),    // PDF 缺件 → 要補寄
    logRow('P005', 'a05@x.com', 'SKIPPED_NO_EMAIL'),     // 無法寄（不是未寄）
    logRow('P006', '', 'SKIPPED_NO_EMAIL')
  ];
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);

  checkEqual('★ FAILED／ERROR_PDF／ERROR_PDF_MISSING 三種都算「未收到」，要補寄',
    names(plan.needsResend), ['P002', 'P003', 'P004']);
  checkEqual('★ SKIPPED_NO_EMAIL 歸入「無法寄」，不是「未寄」（補寄一樣寄不出）',
    names(plan.cannotSend), ['P005', 'P006']);
  checkEqual('★ SENT 的不會被補寄', names(plan.alreadySent), ['P001', 'office@x.com']);
  check('★ 每一位「未收到」都有講明判定原因',
    plan.needsResend.every(function (r) { return r.reason && r.reason.length > 0; }));
  check('★ 原因文字有帶出實際的失敗狀態，方便幹事判斷',
    plan.needsResend.some(function (r) { return r.reason.indexOf('ERROR_PDF_MISSING') !== -1; }));
}

console.log('\n=== C1／C6-5：DRY_RUN 紀錄視為「已寄」，不會重複處理 ===');
{
  const sendLog = [logRow('P001', 'a01@x.com', 'DRY_RUN'), logRow('P002', 'a02@x.com', 'DRY_RUN')];
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  checkEqual('★ DRY_RUN 算已處理（跟 countAlreadySentForStage_ 的白名單一致）',
    names(plan.alreadySent), ['P001', 'P002']);
  check('★ DRY_RUN 的人不會出現在補寄名單',
    names(plan.needsResend).indexOf('P001') === -1 && names(plan.needsResend).indexOf('P002') === -1);
}

console.log('\n=== C6-6：同一人有多筆紀錄時，以最後一筆為準 ===');
{
  // 先 FAILED、後來補寄成功 → 最後狀態是 SENT，不應該再補寄
  const sendLog = [logRow('P001', 'a01@x.com', 'FAILED'), logRow('P001', 'a01@x.com', 'SENT')];
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  check('★ 先失敗後成功 → 視為已寄，不再補寄', names(plan.alreadySent).indexOf('P001') !== -1);

  // 反過來：先 SENT、後來某次重試 FAILED → 最後狀態是 FAILED，要補寄
  const sendLog2 = [logRow('P001', 'a01@x.com', 'SENT'), logRow('P001', 'a01@x.com', 'FAILED')];
  const plan2 = planMakeupSend_(buildRecipients(), sendLog2, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  check('★ 先成功後失敗 → 以最後一筆為準，要補寄', names(plan2.needsResend).indexOf('P001') !== -1);
}

console.log('\n=== C6-7：只看指定的季度＋版本＋階段，不會被其他批次污染 ===');
{
  const sendLog = [
    logRow('P001', 'a01@x.com', 'SENT'),
    // 同一人，但不同版本／不同階段／不同季度——全部都不應該影響本次判斷
    { quarterId: '2099T1', versionNo: 2, stage: MAIL_STAGES.OFFICIAL, personId: 'P002', email: 'a02@x.com', status: 'SENT' },
    { quarterId: '2099T1', versionNo: 3, stage: MAIL_STAGES.REVIEW, personId: 'P003', email: 'a03@x.com', status: 'SENT' },
    { quarterId: '2098T4', versionNo: 3, stage: MAIL_STAGES.OFFICIAL, personId: 'P004', email: 'a04@x.com', status: 'SENT' }
  ];
  const plan = planMakeupSend_(buildRecipients(), sendLog, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  checkEqual('★ 只有真正屬於 2099T1 v3 OFFICIAL 的 P001 算已寄', names(plan.alreadySent), ['P001']);
  checkEqual('★ 其餘（別的版本／階段／季度有紀錄的）一律視為本批未收到',
    names(plan.needsResend), ['P002', 'P003', 'P004', 'P005', 'office@x.com']);
}

console.log('\n=== C4：補寄工具絕不改動 Stage（靜態原始碼稽核）===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'MakeupSend.gs'), 'utf8');
  // 檢查「有沒有真的呼叫」之前一定要先剝走註解——這個檔案的說明文字本身就
  // 提到 advanceQuarterStage_() 這個名稱（用來解釋「刻意不呼叫它」），
  // 直接對全文做 indexOf 會被自己的註解騙到（第一版正是這樣誤報）。
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 區塊註解
    .replace(/^\s*\/\/.*$/gm, '');      // 整行的行註解
  check('★ MakeupSend.gs 的程式碼完全沒有呼叫 advanceQuarterStage_()（已排除註解）',
    codeOnly.indexOf('advanceQuarterStage_(') === -1,
    '補寄工具一旦令 Stage 前進或後退，會破壞整個五步驟流程的狀態機');
  check('★ 剝註解的邏輯本身有效（剝完之後檔案仍然有實際程式碼）',
    codeOnly.indexOf('function planMakeupSend_') !== -1,
    '如果剝得太狠把程式碼都剝走了，上面那項會變成永遠通過的空殼');
  check('★ MakeupSend.gs 有復用既有的 deliverOne_()（不是另寫一套寄送邏輯）',
    src.indexOf('deliverOne_(') !== -1);
  check('★ MakeupSend.gs 有復用既有的 writeSendLogRows_()',
    src.indexOf('writeSendLogRows_(') !== -1);
  check('★ MakeupSend.gs 有沿用 OFFICIAL 不可由自動排程觸發的結構性防護',
    src.indexOf('assertOfficialNotFromAutomationTrigger_(') !== -1);
  check('★ 補寄批次有設定 sendIdTag，令 SendLog 可以分辨出這一批',
    src.indexOf('context.sendIdTag = MAKEUP_SEND_ID_TAG') !== -1);
}

console.log('\n=== C3：補寄的 SendLog 紀錄可以與原本那一批區分（SendID 帶 MAKEUP 標記）===');
{
  // 移植 writeSendLogRows_() 組 SendID 的那一行（逐字對應正式碼）
  function buildSendId(context, index) {
    return [context.quarterId, 'v' + context.versionNo, context.stage,
      context.sendIdTag || null, 'STAMP', index + 1]
      .filter(function (p) { return p !== null && p !== undefined && p !== ''; })
      .join('-');
  }
  const normal = buildSendId({ quarterId: '2099T1', versionNo: 3, stage: 'OFFICIAL' }, 0);
  const makeup = buildSendId({ quarterId: '2099T1', versionNo: 3, stage: 'OFFICIAL', sendIdTag: 'MAKEUP' }, 0);

  // ⚠️ 預期值刻意用「分段拼接」而不是寫成一整串字面值——這是本 repo 的既有
  // 慣例（見 tests/scan_sensitive.test.js 檔頭）：完整的長 ID 字面值會被
  // 敏感資料掃描誤判成「不明的長 ID 字串」。拼接組出來的字串在原始碼裡不會
  // 出現一段連續、可被偵測函式直接匹配到的長字串。
  const expectedNormal = ['2099T1', 'v3', 'OFFICIAL', 'STAMP', '1'].join('-');
  const expectedMakeup = ['2099T1', 'v3', 'OFFICIAL', 'MAKEUP', 'STAMP', '1'].join('-');

  checkEqual('★ 一般寄送的 SendID 格式完全不變（沒有多出分隔符或空段）', normal, expectedNormal);
  checkEqual('★ 補寄的 SendID 中間多一段 MAKEUP', makeup, expectedMakeup);
  check('★ 兩者可以用字串比對分辨', makeup.indexOf('-MAKEUP-') !== -1 && normal.indexOf('-MAKEUP-') === -1);
}

// =============================================================================
// 階段 D：封存機制（B）× 補寄工具（C）的交互檢查——本輪最危險的組合
// =============================================================================
console.log('\n=== D1【最危險】封存之後，補寄工具會不會把已寄的人誤判為未寄？ ===');
{
  const ARCHIVE_KEEP_RECENT_QUARTERS = gas.ARCHIVE_KEEP_RECENT_QUARTERS;

  // 完整的 SendLog：2098T1（最舊，符合封存資格）與 2099T1（最近，不會封存）
  const fullSendLog = [];
  ['2098T1', '2099T1'].forEach(function (q) {
    ['P001', 'P002', 'P003'].forEach(function (personId) {
      fullSendLog.push({ quarterId: q, versionNo: 3, stage: MAIL_STAGES.OFFICIAL,
        personId: personId, email: personId.toLowerCase() + '@x.com', status: 'SENT' });
    });
  });

  // 移植 Archive.gs 的 planSendLogArchive_()：保命規則——每個「季度＋PersonID」
  // 最後一次「已確實處理」的紀錄留在原表，不搬走。
  function isBaselineSendStatus_(status) {
    const n = String(status || '').toUpperCase();
    return n === MAIL_STATUS.SENT || n === MAIL_STATUS.DRY_RUN || n === MAIL_STATUS.SKIPPED_NO_EMAIL;
  }
  function archiveSendLog(rows, archivableIds) {
    const baselineIndexByKey = {};
    rows.forEach(function (row, index) {
      if (!archivableIds[row.quarterId] || !row.personId) return;
      if (!isBaselineSendStatus_(row.status)) return;
      baselineIndexByKey[row.quarterId + '|' + row.personId] = index;
    });
    const keep = {};
    Object.keys(baselineIndexByKey).forEach(function (k) { keep[baselineIndexByKey[k]] = true; });
    const remaining = [];
    rows.forEach(function (row, index) {
      if (archivableIds[row.quarterId] && !keep[index]) return;
      remaining.push(row);
    });
    return remaining;
  }

  const afterArchive = archiveSendLog(fullSendLog, { '2098T1': true });
  const recipients3 = [
    { type: RECIPIENT_TYPE.PERSON, personId: 'P001', email: 'p001@x.com', displayName: '陳大文' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P002', email: 'p002@x.com', displayName: '李小明' },
    { type: RECIPIENT_TYPE.PERSON, personId: 'P003', email: 'p003@x.com', displayName: '王美美' }
  ];

  ['2098T1', '2099T1'].forEach(function (q) {
    const before = planMakeupSend_(recipients3, fullSendLog, q, 3, MAIL_STAGES.OFFICIAL);
    const after = planMakeupSend_(recipients3, afterArchive, q, 3, MAIL_STAGES.OFFICIAL);
    checkEqual('★ ' + q + '：封存前後，補寄名單完全一致（' + after.needsResend.length + ' 人要補寄）',
      names(after.needsResend), names(before.needsResend));
    checkEqual('★ ' + q + '：封存前後，「已寄」名單也完全一致',
      names(after.alreadySent), names(before.alreadySent));
  });
  checkEqual('★ 已封存季度 2098T1 補寄名單仍然是 0 人——沒有人會被重複寄信',
    planMakeupSend_(recipients3, afterArchive, '2098T1', 3, MAIL_STAGES.OFFICIAL).needsResend.length, 0);

  // 反證：如果封存沒有保命規則（整季全部搬走），補寄工具會怎樣？
  const naiveArchive = fullSendLog.filter(function (r) { return r.quarterId !== '2098T1'; });
  const naivePlan = planMakeupSend_(recipients3, naiveArchive, '2098T1', 3, MAIL_STAGES.OFFICIAL);
  checkEqual('★ 反證：若封存沒有保命規則，補寄工具會把 3 位已收信的人全部誤判為未收到',
    naivePlan.needsResend.length, 3);
  check('★ 兩者確實不同——證明「每人最後一次紀錄永不封存」這條保命規則'
    + '同時保護了步驟 5 hash 比對**與**補寄工具，不是只保護前者',
    naivePlan.needsResend.length > 0);

  check('★ 封存保留的季度數（' + ARCHIVE_KEEP_RECENT_QUARTERS + '）確實 ≥ 1，'
    + '確保最近的季度永遠不會被封存', ARCHIVE_KEEP_RECENT_QUARTERS >= 1);
}

console.log('\n=== D2：驗證「封存 × hash 比對」的測試本身有效（故意破壞一次）===');
{
  // D2 要求「先寫一個故意破壞的版本驗證測試有效，再改回正確版本」。
  // 上面 D1 的反證已經做了一半（拿走保命規則 → 測試抓到差異）。這裡補上
  // 另一個方向：故意破壞**判斷邏輯**本身，確認測試同樣抓得到。
  function brokenClassify(recipient, lastStatus) {
    // 故意寫錯：把 SENT 也當成「要補寄」——這是最典型的重複寄信 bug
    if (!recipient.email) return { category: 'CANNOT_SEND', reason: '' };
    return { category: 'NEEDS_RESEND', reason: '（故意寫錯的版本）' };
  }
  function planWith(classifyFn, recipients, sendLogRows, quarterId, versionNo, stage) {
    const statusByKey = buildSendStatusByRecipient_(sendLogRows, quarterId, versionNo, stage);
    const needsResend = [];
    recipients.forEach(function (r) {
      const key = r.personId || String(r.email || '').trim().toLowerCase();
      const lastStatus = key ? (statusByKey[key] === undefined ? null : statusByKey[key]) : null;
      if (classifyFn(r, lastStatus).category === 'NEEDS_RESEND') needsResend.push(r);
    });
    return needsResend;
  }

  const recipients = buildRecipients();
  const allSent = recipients.filter(function (r) { return r.email; })
    .map(function (r) { return logRow(r.personId, r.email, 'SENT'); });

  const correct = planWith(classifyMakeupRecipient_, recipients, allSent, '2099T1', 3, MAIL_STAGES.OFFICIAL);
  const broken = planWith(brokenClassify, recipients, allSent, '2099T1', 3, MAIL_STAGES.OFFICIAL);

  checkEqual('★ 正確版本：全部已寄 → 補寄 0 人', correct.length, 0);
  checkEqual('★ 故意寫錯的版本：把 6 位已寄的人全部當成要補寄', broken.length, 6);
  check('★ 測試確實分辨得出正確與錯誤的實作——'
    + '證明上面那批斷言不是「無論怎樣都會通過」的空殼', broken.length !== correct.length);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
