// 第二十五輪批次階段 D：掣 4「改動後重發」嘅「原本／現在」對照。
// 執行方式：node tests/resend_previous_summary.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住咩
// ─────────────────────────────────────────────────────────────────────
//
// 規格 2.7 要求確認畫面逐個列出有改動嘅人：名、改咗邊幾格、原本／現在。
// 呢個係**幹事唯一一次可以人眼睇出「係咪真係想改咁多人」嘅關口**。
//
// 之前 `previousSummary` 一律空字串，因為 `buildMailContext_()` 只保留咗
// `AssignmentHash`（單向，還原唔到內容）。但 SendLog 本身一直都有
// `AssignmentSummary` 呢一欄，只係從來冇讀返出嚟——今次補返。
//
// ⚠️ 最重要嗰條斷言：**攞唔到嗰啲要留空，唔可以擺一個似層層嘅值。**
// 最容易犯嘅錯係「攞唔到就用現在嗰個當原本」——噉樣兩欄會一模一樣，
// 幹事會以為「冇改過」而放行，但實情係我哋根本唔知原本係咩。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'SendRecipients.gs', 'Mailer.gs'
]);

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

const C = gas.COLUMNS.SEND_LOG;

function sendRow(o) {
  const r = {};
  r[C.QUARTER_ID] = o.quarterId || '2026T4';
  r[C.PERSON_ID] = o.personId;
  r[C.STATUS] = o.status || gas.MAIL_STATUS.SENT;
  r[C.ASSIGNMENT_HASH] = o.hash || 'h1';
  r[C.ASSIGNMENT_SUMMARY] = o.summary === undefined ? '' : o.summary;
  return r;
}

console.log('\n=== D【核心】真係讀到上次嘅摘要 ===');
{
  gas.readSheet = function () {
    return [
      sendRow({ personId: 'P1', summary: '2026-10-05　主席' }),
      sendRow({ personId: 'P2', summary: '2026-10-12　司琴；2026-11-02　領詩' })
    ];
  };
  const map = gas.readLastSummaryByPerson_('2026T4');
  checkEqual('★★★★★ P1 攞到上次嘅摘要', map.P1, '2026-10-05　主席');
  checkEqual('★★★★ P2 亦然', map.P2, '2026-10-12　司琴；2026-11-02　領詩');
}

console.log('\n=== D【核心】攞唔到唔可以擺空字串入去 ===');
{
  gas.readSheet = function () {
    return [
      sendRow({ personId: 'P1', summary: '2026-10-05　主席' }),
      // 舊紀錄（本輪之前寄嘅）冇填 summary
      sendRow({ personId: 'P3', summary: '' })
    ];
  };
  const map = gas.readLastSummaryByPerson_('2026T4');
  check('★★★★★ 冇 summary 嗰個**唔會出現喺物件入面**'
    + '——擺個空字串入去，呼叫端就分唔到「上次冇安排」同「冇記錄」，'
    + '而呢兩件事對幹事嚟講完全唔同',
    !Object.prototype.hasOwnProperty.call(map, 'P3'),
    JSON.stringify(map));
  checkEqual('★★★★ 有 summary 嗰個照樣攞到', map.P1, '2026-10-05　主席');
}

console.log('\n=== D 只計「已確實處理」嘅紀錄（沿用既有白名單）===');
{
  gas.readSheet = function () {
    return [
      sendRow({ personId: 'P1', summary: '舊嘅', status: gas.MAIL_STATUS.SENT }),
      sendRow({ personId: 'P1', summary: '新嘅', status: gas.MAIL_STATUS.SENT })
    ];
  };
  checkEqual('★★★★★ 同一個人有多筆時，攞最後一筆（工作表由上而下＝時間先後）',
    gas.readLastSummaryByPerson_('2026T4').P1, '新嘅');

  gas.readSheet = function () {
    return [sendRow({ personId: 'P9', summary: '唔應該計', status: 'FAILED' })];
  };
  check('★★★★★ 寄失敗嗰啲唔計'
    + '——佢哋根本冇收過信，攞佢哋做「原本」係錯嘅基準',
    !Object.prototype.hasOwnProperty.call(gas.readLastSummaryByPerson_('2026T4'), 'P9'));
}

console.log('\n=== D 只計本季（唔可以撈到第二季嘅摘要）===');
{
  gas.readSheet = function () {
    return [
      sendRow({ personId: 'P1', quarterId: '2026T3', summary: '上一季嘅' }),
      sendRow({ personId: 'P2', quarterId: '2026T4', summary: '本季嘅' })
    ];
  };
  const map = gas.readLastSummaryByPerson_('2026T4');
  check('★★★★★ 唔會撈到 2026T3 嘅紀錄',
    !Object.prototype.hasOwnProperty.call(map, 'P1'), JSON.stringify(map));
  checkEqual('★★★★ 本季嗰個攞到', map.P2, '本季嘅');
}

console.log('\n=== D 接駁：buildMailContext_ → planResendChangedPersons_ ===');
{
  const mailer = fs.readFileSync(path.join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  check('★★★★★ buildMailContext_() 有帶 lastSummaryByPerson 出去',
    /lastSummaryByPerson: readLastSummaryByPerson_\(quarterId\)/.test(mailer));

  const guards = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppGuards.gs'), 'utf8');
  const fn = guards.slice(guards.indexOf('function planResendChangedPersons_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ previousSummary 由 context.lastSummaryByPerson 攞',
    /previousSummary:\s*\(context\.lastSummaryByPerson \|\| \{\}\)\[c\.personId\] \|\| ''/.test(body));
  check('★★★★★ **唔可以**用 currentSummary 做 fallback'
    + '——兩欄一模一樣，幹事會以為「冇改過」而放行，'
    + '但實情係我哋根本唔知原本係咩',
    !/previousSummary:[^\n]*currentSummary/.test(body));
  check('★★★★ context 冇呢個欄時唔會爆（`|| {}`）',
    /\(context\.lastSummaryByPerson \|\| \{\}\)/.test(body));
}

console.log('\n=== D 前端：原本擺上面、現在擺下面，攞唔到要誠實講 ===');
{
  const zone1 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const prevAt = zone1.indexOf("'原本：'");
  const currAt = zone1.indexOf("'現在：'");

  check('★★★★ 兩行都有', prevAt !== -1 && currAt !== -1);
  check('★★★★★ 「原本」排喺「現在」之前'
    + '——人眼由上而下讀，「舊 → 新」先讀得出改咗啲乜',
    prevAt < currAt, 'prevAt=' + prevAt + ' currAt=' + currAt);
  check('★★★★★ 攞唔到時誠實講「沒有記錄」，唔會扮到有得比較',
    zone1.indexOf('（上次的安排沒有記錄，無法對照）') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
