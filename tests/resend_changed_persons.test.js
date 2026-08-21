// 第二十三輪批次階段 E4：掣 4 嘅內容閘。
// 執行方式：node tests/resend_changed_persons.test.js
//
// 規格 2.7：0 人有改動 ⇒ 掣 4 變灰。
// 點解要有呢道閘：重發一封內容一模一樣嘅信只會令義工困惑
// （「係咪我漏咗啲乜？」），亦都會令「重發」呢個動作失去意義——
// 收到重發信應該代表「你嘅安排真係改咗」。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

// `computeResendDiff_()` 內部會叫 `computeAssignmentHash_()`（住喺 Mailer.gs），
// 所以一定要連 Mailer.gs 一齊載入——**唔可以喺測試自己砌一個假 hash 函式**，
// 噉樣就變成測緊一份副本而唔係真正會跑嗰段。
const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs'
]);

// `computeAssignmentHash_()` 用 Utilities.computeDigest；測試沙箱嘅 stub
// 一被呼叫就拋錯，換一個確定性替身（同樣係 SHA-256，用 Node 內建）。
gas.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: function (algorithm, value) {
    const buf = require('crypto').createHash('sha256').update(String(value), 'utf8').digest();
    // GAS 回傳嘅係 signed byte 陣列，呼叫端會做 `byte & 0xFF`，
    // 所以直接回 unsigned 都得出同一個結果。
    return Array.prototype.slice.call(buf);
  }
};

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

/** 造一個 mail context（`computeResendDiff_()` 要嘅形狀）。 */
function ctx(o) {
  return {
    assignmentsByPerson: o.assignmentsByPerson || {},
    lastHashByPerson: o.lastHashByPerson || {},
    lastStatusByPerson: o.lastStatusByPerson || {},
    peopleById: o.peopleById || {},
    postNames: o.postNames || { CHAIR: '主席', AUDIO: '音響' }
  };
}
const A = function (date, postId) {
  return { serviceDate: date, postId: postId, slotIndex: 1 };
};

console.log('\n=== E4【核心】冇人改動 ⇒ 0 人（掣 4 會變灰）===');
{
  const assignments = { P901: [A('2026-11-08', 'CHAIR')] };
  const hash = gas.computeAssignmentHash_(assignments.P901);
  const changed = gas.computeResendDiff_(ctx({
    assignmentsByPerson: assignments,
    lastHashByPerson: { P901: hash },
    peopleById: { P901: { nameTC: '假甲', email: 'a@notarealchurch.invalid' } }
  }));
  checkEqual('★★★★★ 派工同上次寄出時一模一樣 ⇒ 0 人有改動', changed.length, 0);
}

console.log('\n=== E4：真係改咗 ⇒ 揀得出係邊個 ===');
{
  const oldAssignments = [A('2026-11-08', 'CHAIR')];
  const newAssignments = [A('2026-11-08', 'CHAIR'), A('2026-11-15', 'AUDIO')];
  const changed = gas.computeResendDiff_(ctx({
    assignmentsByPerson: { P901: newAssignments, P902: oldAssignments },
    lastHashByPerson: {
      P901: gas.computeAssignmentHash_(oldAssignments),   // 改咗
      P902: gas.computeAssignmentHash_(oldAssignments)    // 冇改
    },
    peopleById: {
      P901: { nameTC: '假甲', email: 'a@notarealchurch.invalid' },
      P902: { nameTC: '假乙', email: 'b@notarealchurch.invalid' }
    }
  }));
  checkEqual('★★★★★ 只有真係改咗嗰個入名單', changed.map(function (c) { return c.personId; }), ['P901']);
  check('★★★★ 有中文名（確認畫面要俾人眼睇，唔可以淨係 PersonID）',
    changed[0].nameTC === '假甲');
}

console.log('\n=== E4：本季已無服侍安排嘅人一樣要通知 ===');
{
  const oldAssignments = [A('2026-11-08', 'CHAIR')];
  const changed = gas.computeResendDiff_(ctx({
    assignmentsByPerson: {},                                    // 而家一個都冇
    lastHashByPerson: { P901: gas.computeAssignmentHash_(oldAssignments) },
    peopleById: { P901: { nameTC: '假甲', email: 'a@notarealchurch.invalid' } }
  }));
  checkEqual('★★★★★ 由「有安排」變成「冇安排」一樣算改動'
    + '——呢個人本來要返，而家唔使返，**最需要通知**；'
    + '如果漏咗，佢會照樣返到教會', changed.length, 1);
  checkEqual('★★★★ hasAssignments 標成 false，前端要顯示「本季已無服侍安排」',
    changed[0].hasAssignments, false);
}

console.log('\n=== E4：之前冇電郵、而家有 ⇒ 首次通知 ===');
{
  const assignments = [A('2026-11-08', 'CHAIR')];
  const hash = gas.computeAssignmentHash_(assignments);
  const changed = gas.computeResendDiff_(ctx({
    assignmentsByPerson: { P901: assignments },
    lastHashByPerson: { P901: hash },     // 內容冇變
    lastStatusByPerson: { P901: gas.MAIL_STATUS.SKIPPED_NO_EMAIL },
    peopleById: { P901: { nameTC: '假甲', email: 'now@notarealchurch.invalid' } }
  }));
  checkEqual('★★★★★ 內容冇變，但上次因為冇電郵而略過、而家有電郵 ⇒ 要通知'
    + '（佢由頭到尾未收過任何嘢）', changed.length, 1);
  checkEqual('★★★★ 標成 firstNotifyDueToEmail，前端要分開顯示',
    changed[0].firstNotifyDueToEmail, true);
}

console.log('\n=== E4：planResendChangedPersons_ 嘅結構性要求（靜態檢查）===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppGuards.gs'), 'utf8');
  const fnBody = src.slice(src.indexOf('function planResendChangedPersons_'));

  check('★★★★★ 重用 computeResendDiff_()，唔喺呢度重寫一次比對邏輯'
    + '（第十八輪就係因為「兩個工具各自實作同一個判斷」而分岔咗）',
    /computeResendDiff_\(context\)/.test(fnBody));
  check('★★★★ 逐個人回傳中文名同有冇電郵（規格 2.7：確認畫面唔可以只寫數字）',
    /nameTC:/.test(fnBody) && /hasEmail:/.test(fnBody));
  // 第二十五輪批次階段 D 改寫：「原本係咩」由「一律空字串」變成
  // 「真係去 SendLog 攞」。原本嗰兩條斷言鎖住嘅係「攞唔到」呢個當時嘅
  // 事實，而唔係一條該永久成立嘅規則——**要保留嘅意圖係
  // 「攞唔到就要留空，唔可以擺假值」**，而唔係「永遠攞唔到」。
  check('★★★★★ previousSummary 由 context.lastSummaryByPerson 攞（真值，唔再一律空白）',
    /previousSummary:\s*\(context\.lastSummaryByPerson \|\| \{\}\)\[c\.personId\]/.test(fnBody));
  check('★★★★★ 攞唔到時 fallback 係空字串，'
    + '**唔可以靜靜擺一個似層層嘅值落去**（例如攞現在嗰個當原本）'
    + '——擺個假值落去，幹事會以為自己核對緊真嘢',
    /\[c\.personId\] \|\| ''/.test(fnBody)
    && !/previousSummary:[^\n]*currentSummary/.test(fnBody));
  check('★★★★★ 而且要喺註解講明「攞唔到」同「上次冇安排」係兩件事',
    /冇記錄/.test(fnBody));

  const mailer = fs.readFileSync(path.join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  check('★★★★★ buildMailContext_() 有提供 lastSummaryByPerson',
    /lastSummaryByPerson: readLastSummaryByPerson_\(quarterId\)/.test(mailer));
  {
    const readerFn = mailer.slice(mailer.indexOf('function readLastSummaryByPerson_'));
    const body = readerFn.slice(0, readerFn.indexOf('\n}\n') + 3);
    check('★★★★★ 舊紀錄冇填 summary 嗰啲**唔會出現喺物件入面**'
      + '——擺個空字串入去就分唔到「上次冇安排」同「冇記錄」',
      /if \(records\[id\]\.summary !== ''\)/.test(body));
  }

  const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const step5Plan = flow.slice(flow.indexOf('function apiStep5Plan('), flow.indexOf('function apiStep5Plan(') + 1400);
  check('★★★★★ E5：apiStep5Plan 已經改用 planResendChangedPersons_',
    /planResendChangedPersons_\(quarterId\)/.test(step5Plan));
  check('★★★★★ E5：apiStep5Plan 唔再處理申報（已歸掣 1，決定 D1）',
    step5Plan.indexOf('mapPendingPlanForClient_') === -1
    && step5Plan.indexOf('planStep5_(') === -1);
  check('★★★★ 0 人改動時回 NO_CHANGES，前端據此令掣 4 變灰',
    /NO_CHANGES/.test(step5Plan));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
