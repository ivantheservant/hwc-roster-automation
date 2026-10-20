// 第六十三輪批次 R 組：改動後重發確認框——「安排有改動」同「上次冇收到」分兩段。
// 執行方式：node tests/resend_partial_baseline.test.js
//
// 現場（2026-10-20）：第 2 版正式發出只寄咗 2 位。之後改咗格，撳「改動後重發」，
// 確認框寫「自上次發出之後，這 54 個人的安排改了……確認是不是真的想改這麼多人」，
// 每人一行「原本：（上次的安排沒有記錄，無法對照）」——但下面「會寄給這 2 位」。
//
// 成因：`computeResendDiff_()` 按每人 SendLog hash 比較；冇收過信嘅人冇舊 hash，
// 全部當「改咗」。修正：分兩段，標題數字只計「有舊 hash 而且唔同」嗰段。
// 下面用假 ID（P97xx）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs'
]);
gas.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: function (_a, value) {
    return Array.prototype.slice.call(require('crypto').createHash('sha256').update(String(value), 'utf8').digest());
  }
};
gas.buildAssignmentSummary_ = function (list) {
  return list.map(function (a) { return a.serviceDate + ' ' + a.postId; }).join('；');
};
gas.log_ = function () {};

const Q = '2098T2';
const cell = function (date, postId) { return { serviceDate: date, postId: postId, slotIndex: 1 }; };

// ── 情境：上次正式發出（第 2 版）只寄咗 P9701、P9702 ─────────────────
// 之後第 3 版改咗 2 格：P9701 換咗日子、P9702 多咗一格。
// P9703–P9705 上次冇收到（冇舊 hash），安排冇變過。
const oldP1 = [cell('2098-04-05', 'READ')];
const oldP2 = [cell('2098-04-12', 'USHER')];
const assignmentsByPerson = {
  P9701: [cell('2098-04-19', 'READ')],
  P9702: [cell('2098-04-12', 'USHER'), cell('2098-05-03', 'USHER')],
  P9703: [cell('2098-04-05', 'CHAIR')],
  P9704: [cell('2098-04-26', 'CHAIR')],
  P9705: [cell('2098-05-10', 'READ')]
};
const peopleById = {};
Object.keys(assignmentsByPerson).forEach(function (id) {
  peopleById[id] = { personId: id, nameTC: '假' + id.slice(-1), email: id.toLowerCase() + '@example.invalid' };
});
const context = {
  assignmentsByPerson: assignmentsByPerson,
  lastHashByPerson: {
    P9701: gas.computeAssignmentHash_(oldP1),
    P9702: gas.computeAssignmentHash_(oldP2)
  },
  lastStatusByPerson: { P9701: 'SENT', P9702: 'SENT' },
  lastSummaryByPerson: { P9701: '2098-04-05 READ', P9702: '2098-04-12 USHER' },
  peopleById: peopleById,
  postNames: {},
  timezone: 'Asia/Hong_Kong'
};
gas.findLatestVersionNo = function () { return 3; };
gas.buildMailContext_ = function () { return context; };

// =====================================================================
console.log('\n=== R1【核心】部分寄出 → 改 2 格 ⇒ 確認框標題數字＝實際改動人數 ===');
const plan = gas.planResendChangedPersons_(Q);
{
  check('（前提）computeResendDiff_ 仍然列出 5 位——寄畀邊個唔受影響',
    plan.changed.length === 5, JSON.stringify(plan.changed.map(function (c) { return c.personId; })));
  check('★★★★★★ 安排有改動嘅只有 2 位（P9701、P9702）',
    plan.arrangementChangedCount === 2
    && plan.changed.filter(function (c) { return c.arrangementChanged; })
      .map(function (c) { return c.personId; }).join(',') === 'P9701,P9702',
    JSON.stringify(plan.changed.map(function (c) { return [c.personId, c.arrangementChanged]; })));
  check('★★★★★★ 上次冇收到嘅 3 位分開數', plan.notReceivedCount === 3, 'n=' + plan.notReceivedCount);
}

console.log('\n=== R1：分類規則 ===');
{
  const f = gas.isArrangementChangedSinceLastSend_;
  check('★★★★★ 有舊 hash 而且唔同 ⇒ 有改動', f({ oldHash: 'a', newHash: 'b' }) === true);
  check('★★★★★ 冇舊 hash ⇒ 上次冇收到', f({ oldHash: '', newHash: 'b' }) === false);
  check('★★★★ hash 一樣（首次通知，之前冇電郵）⇒ 唔算改動', f({ oldHash: 'a', newHash: 'a' }) === false);
  check('★★★ 空值唔會炸', f(null) === false);
}

console.log('\n=== R1：apiStep5Plan 回兩個數字 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const body = src.slice(src.indexOf('function apiStep5Plan('), src.indexOf('function apiStep5Decline('));
  check('★★★★★ arrangementChangedCount／notReceivedCount 由 planResendChangedPersons_ 帶出',
    /arrangementChangedCount: changedPlan\.arrangementChangedCount/.test(body)
    && /notReceivedCount: changedPlan\.notReceivedCount/.test(body), body.slice(-900));
}

// =====================================================================
console.log('\n=== R2【核心】確認框（UI）分兩段，標題用第一段嘅數字 ===');
const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
{
  const start = ui.indexOf('function splitResendPlanGroups(');
  check('（前提）UI 有 splitResendPlanGroups()', start !== -1);
  const fnSrc = ui.slice(start, ui.indexOf('\n  }\n', start) + 4);
  const sandbox = {};
  vm.runInNewContext(fnSrc + '\nthis.split = splitResendPlanGroups;', sandbox);
  const groups = sandbox.split(plan.changed);
  check('★★★★★★ 第一段 2 位、第二段 3 位',
    groups.changed.length === 2 && groups.notReceived.length === 3,
    JSON.stringify([groups.changed.length, groups.notReceived.length]));
  const legacy = sandbox.split([{ personId: 'P9709' }]);
  check('★★★ 舊後端（冇 arrangementChanged 欄）⇒ 當有改動，同舊畫面一樣',
    legacy.changed.length === 1 && legacy.notReceived.length === 0);

  // 第六十五輪批次 Y 組：確認框內容搬咗去 buildResendConfirmNodes()
  const openResend = ui.slice(ui.indexOf('function buildResendConfirmNodes('), ui.indexOf('function openResend('));
  check('★★★★★★ 標題數字用第一段（唔再用 plan.changed.length）',
    /'自上次發出之後，這 ' \+ groups\.changed\.length \+ ' 個人的安排改了/.test(openResend)
    && !/'自上次發出之後，這 ' \+ plan\.changed\.length/.test(openResend));
  const warnAt = openResend.indexOf('確認是不是真的想改這麼多人');
  const secondAt = openResend.indexOf('上次正式發出時沒有收到');
  check('★★★★★ 第二段有自己嘅標題，而且指去「補寄未收到的人」',
    secondAt !== -1 && /要寄第一次通知給他們，用「補寄未收到的人」/.test(openResend));
  check('★★★★★ 「真的想改這麼多人」只喺第一段（第二段唔放入嗰句警告）',
    warnAt !== -1 && warnAt < secondAt
    && openResend.split('確認是不是真的想改這麼多人').length === 2);
  // 第六十五輪批次 Y 組：第一段改為「這一次會寄給的 N 位」（後端分好組）
  check('★★★★ 第一段淨係列會寄嘅人（唔係 plan.changed 全部）', /g\.willSend\.forEach\(/.test(openResend)
    && !/plan\.changed\.forEach\(/.test(openResend));
}

// =====================================================================
console.log('\n=== R3：狀態卡嘅掣 4 文字一樣只計安排有改動嘅人 ===');
{
  const t = gas.buildResendButtonText_({ changedPersonCount: 54, arrangementChangedCount: 2, notReceivedCount: 52 });
  check('★★★★★★ 講「有 2 個人的安排改了」，唔再講 54', /有 2 個人的安排改了/.test(t) && !/54 個人/.test(t), t);
  check('★★★★★ 上次冇收到嘅人分開講，指去補寄', /另外 52 位上次正式發出時沒有收到/.test(t)
    && /補寄未收到的人/.test(t), t);
  const t2 = gas.buildResendButtonText_({ changedPersonCount: 3, arrangementChangedCount: 3, notReceivedCount: 0 });
  check('★★★★ 全體都收過（正常情況）⇒ 同舊文字一樣', t2 === '自上次發出之後，有 3 個人的安排改了。只會寄給這 3 人和堂委。', t2);
  const t3 = gas.buildResendButtonText_({ changedPersonCount: 0 });
  check('★★★ 0 人 ⇒ 照舊', t3 === '自上次發出之後沒有人的安排改過，不需要重發。', t3);
  const dashSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8');
  check('★★★★ 狀態卡讀到分類（countDashboardResendBreakdown_）',
    /arrangementChangedCount: resendBreakdown\.arrangementChanged/.test(dashSrc)
    && /notReceivedCount: resendBreakdown\.notReceived/.test(dashSrc));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
