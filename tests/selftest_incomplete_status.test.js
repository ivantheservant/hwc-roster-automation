// 第五十八輪批次：S08 做咗 7 份就報綠，缺件丟畀下游 S09 撞。
// 執行方式：node tests/selftest_incomplete_status.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-08-24 16:50）
// ═════════════════════════════════════════════════════════════════════
//
// 14 綠、0 紅、1 ERROR、2 被擋、1 跳過。
// S08「產生個人 PDF」PASSED，而 S09「正式發出」ERROR：
//
//     步驟 4：正式發出——因為個人 PDF 缺件太多而中止。
//     缺個人 PDF 的人數是 51 / 58（87.9%），超過容許上限 20%。
//
// **系統攔得完全正確。** 問題喺 S08 嗰條斷言：
//
//     done.done === true || Number(done.totalPeople) > Number(done.doneCount)
//
// 「做完」同「未做完」兩樣都收貨 ⇒ 做咗 7 份就報綠收工。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 「做唔完」係第三種狀態
// ═════════════════════════════════════════════════════════════════════
//
// 唔可以當「做完」——缺件會丟畀下游。
// 亦**唔可以當「失敗」**——`settled` 把 `FAILED` 當「已有結論」而跳過，
// 於是續跑會永遠跳過 S08，PDF 永遠補唔齊。嗰個係第五十輪嗰種死鎖。
//
// 有進度、未完成、要接住做 ⇒ 自己一個狀態 `INCOMPLETE`。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CODE = read('src/SelfTestRunner.gs')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Invariants.gs', 'SelfTestRunner.gs'];

/**
 * 跑 S08，`apiGeneratePersonalPdfBatch` 同「時間到」都由測試話事。
 *
 * @param {Object} opts `{batches, outOfTimeAfter}`
 * @returns {Object} `{gas, out, calls}`
 */
function runS08(opts) {
  const gas = loadGasSource(FILES);
  let n = 0;
  const payloads = [];
  gas.log_ = function () {};
  gas.selfTestRecordPayload_ = function (id, api, value) {
    payloads.push({ api: api, value: value });
  };
  gas.findLatestVersionNo = function () { return 3; };
  gas.apiGeneratePersonalPdfBatch = function () {
    const b = opts.batches[Math.min(n, opts.batches.length - 1)];
    n++;
    return b;
  };
  gas.selfTestOutOfTime_ = function () {
    return opts.outOfTimeAfter !== undefined && n >= opts.outOfTimeAfter;
  };
  return { gas: gas, out: gas.selfTestS08_('2028T3'),
    rounds: n, payloads: payloads };
}

function batch(doneCount, totalPeople, done) {
  return { ok: true, done: !!done, doneCount: doneCount,
    totalPeople: totalPeople, generatedCount: doneCount,
    skippedExistingCount: 0, totalRetries: 0 };
}

// =====================================================================
console.log('\n=== A1【核心】`INCOMPLETE` 唔可以喺 `settled` 清單裡面 ===');
{
  // ⚠️⚠️ **呢一條係整組最重要嘅一條。**
  //
  // 加落 `settled` 嘅話，續跑會永遠跳過 S08，PDF 永遠補唔齊，
  // S09 永遠被擋——即係第五十輪嗰種死鎖翻生。
  const settled = CODE.slice(CODE.indexOf('const settled = previous && ('),
    CODE.indexOf('if (resume && settled) {'));
  check('★★★★★★ **`settled` 冇包 `INCOMPLETE`**'
    + '——包咗就係第五十輪嗰種死鎖：續跑永遠跳過佢，PDF 永遠補唔齊',
    !/SELFTEST_STATUS\.INCOMPLETE/.test(settled), settled);
  check('★★★★★ 而且 `INCOMPLETE` 真係存在（唔係打錯字）',
    loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
      'QuarterStage.gs', 'Invariants.gs', 'SelfTestRunner.gs'])
      .SELFTEST_STATUS.INCOMPLETE === 'INCOMPLETE', '');
}

// =====================================================================
console.log('\n=== A6(a)【核心】做唔完 ＋ 時間到 ⇒ `INCOMPLETE`，唔係 `PASSED` ===');
{
  // 58 份，每批 7 份，第 1 批之後時間到。
  const box = runS08({
    batches: [batch(7, 58, false), batch(14, 58, false)],
    outOfTimeAfter: 1
  });
  const S = box.gas.SELFTEST_STATUS;

  checkEqual('★★★★★★ **回 `INCOMPLETE`**'
    + '——舊寫法喺呢個現場報 PASSED，於是缺件丟畀 S09 撞，'
    + '而 S09 ERROR：「缺個人 PDF 的人數是 51 / 58（87.9%）」',
    box.out.status, S.INCOMPLETE);
  checkEqual('★★★★★★ **唔係 `PASSED`**', box.out.status === S.PASSED, false);
  checkEqual('★★★★★★ **亦唔係 `FAILED`**'
    + '——報 FAILED 嘅話續跑會永遠跳過佢（見上面 `settled` 嗰條）',
    box.out.status === S.FAILED, false);
  check('★★★★★★ 摘要講得出「已產生 X / Y 份，還差 Z 份」',
    /已產生 7 \/ 58 份，還差 51 份/.test(box.out.note || ''), box.out.note);
  check('★★★★★★ 而且講得出撳邊粒接住做',
    /繼續跑自測/.test(box.out.note || '')
      && !/只重跑紅色情境/.test(box.out.note || ''), box.out.note);
  check('★★★★★ 順手講明 S09 會被攔住，而嗰個攔截係啱嘅'
    + '——唔講嘅話，Ivan 見到 S09 被擋會去搵一個唔存在嘅 bug',
    /S09/.test(box.out.note || '') && /正確的攔截/.test(box.out.note || ''),
    box.out.note);
}

// =====================================================================
console.log('\n=== A2【核心】真嘅做完 ⇒ `PASSED` ===');
{
  const box = runS08({
    batches: [batch(20, 58, false), batch(40, 58, false), batch(58, 58, true)]
  });
  checkEqual('★★★★★★ 做完 58 份 ⇒ 綠',
    box.out.status, box.gas.SELFTEST_STATUS.PASSED);
  checkEqual('★★★★★★ 而且真係跑咗 3 批'
    + '——舊寫法有個 `rounds < 20` 硬上限，58 份分批做唔一定夠',
    box.rounds, 3);
  const labels = box.out.checks.map(function (c) { return c.label; }).join('\n');
  check('★★★★★ 有一條驗 `done === true`',
    /批次做完了（done = true）/.test(labels), labels);
  check('★★★★★ 仲有一條驗「一份都不差」',
    /一份都不差/.test(labels), labels);
}

// =====================================================================
console.log('\n=== A2 冇 `rounds < 20` 硬上限 ===');
{
  // 30 批先做完。舊寫法 20 批就停，然後報綠。
  const many = [];
  for (let i = 1; i <= 30; i++) many.push(batch(i * 2, 58, i === 30));
  const box = runS08({ batches: many });
  checkEqual('★★★★★★ 跑咗 30 批，做完先停',
    box.rounds, 30);
  checkEqual('★★★★★ 而且係綠', box.out.status, box.gas.SELFTEST_STATUS.PASSED);
  check('★★★★★★ 原始碼冇 `rounds < 20` 呢個上限',
    !/rounds < 20/.test(CODE), '');
}

// =====================================================================
console.log('\n=== A2【核心】一批都冇前進 ⇒ 紅，唔係 `INCOMPLETE` ===');
{
  // ⚠️ 冇呢一道，一個「永遠唔 done、又永遠唔前進」嘅批次入口
  // 會食光成個時間預算，然後報 INCOMPLETE；下一次續跑一樣。
  // 嗰個係死循環，唔係進度。
  const box = runS08({ batches: [batch(7, 58, false), batch(7, 58, false)] });
  checkEqual('★★★★★★ **報紅**'
    + '——「再撳都唔會前進」係一個真問題，唔係「仲未做完」',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★★ 而且講明「再撳繼續跑自測也不會有分別」',
    box.out.failedChecks.some(function (c) {
      return /不會有分別/.test(c.evidence || '');
    }), JSON.stringify(box.out.failedChecks));
  checkEqual('★★★★★ 而且唔會無止境跑落去', box.rounds <= 3, true);
}

// =====================================================================
console.log('\n=== A2 一份都產唔到 ⇒ 紅（唔係 `INCOMPLETE`）===');
{
  const box = runS08({ batches: [batch(0, 58, false)] });
  checkEqual('★★★★★★ **報紅**'
    + '——已經紅咗嘅斷言優先。一條「有真問題 ＋ 順便未做完」嘅情境'
    + '報成 INCOMPLETE，就會令嗰個真問題被一句「下次接住做」蓋住',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
}

// =====================================================================
console.log('\n=== A2 最終數字要入 payload ===');
{
  const box = runS08({
    batches: [batch(7, 58, false), batch(14, 58, false)], outOfTimeAfter: 1
  });
  const summary = box.payloads.filter(function (p) {
    return p.api === 'S08 總結';
  })[0];
  check('★★★★★★ 有一筆「總結」payload'
    + '——逐批嘅回傳雖然錄咗，但下一輪落手查嗰個唔應該要'
    + '自己由 N 批回傳裡面拼返個最終數字出嚟',
    !!summary, JSON.stringify(box.payloads.map(function (p) { return p.api; })));
  checkEqual('★★★★★★ 而且帶住 doneCount／totalPeople／remaining',
    summary && (summary.value.doneCount + '/' + summary.value.totalPeople
      + '/' + summary.value.remaining), '7/58/51');
  checkEqual('★★★★★ 同埋 `done: false`', summary && summary.value.done, false);
}

// =====================================================================
// 下面幾條要一部真嘅自測機。
// =====================================================================

/**
 * 造一部只有假情境嘅自測機，`SelfTestState` 係記憶體物件。
 *
 * @param {Function} scenariosOf `function (runIndex) => [{id, status, dependsOn}]`
 * @returns {Object}
 */
function machine(scenariosOf) {
  const gas = loadGasSource(FILES);
  let store = {};
  let runIndex = 0;
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () { return { value: '2028T3', source: 'x' }; };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    return { versionRowsDeleted: 0, assignmentRowsDeleted: 0, sendLogRowsDeleted: 0 };
  };
  gas.selfTestResetOwnSheets_ = function () {
    return { specialSundayRowsDeleted: 0, payloadRowsDeleted: 0 };
  };
  gas.runAllInvariants_ = function () {
    return { results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0 };
  };
  gas.selfTestOutOfTime_ = function () { return false; };
  gas.readSelfTestState_ = function () { return JSON.parse(JSON.stringify(store)); };
  gas.writeSelfTestState_ = function (st) { store = JSON.parse(JSON.stringify(st)); };
  gas.selfTestScenarios_ = function () {
    return scenariosOf(runIndex).map(function (sc) {
      return {
        id: sc.id, title: sc.id, dependsOn: sc.dependsOn || [],
        run: function () {
          return { id: sc.id, status: sc.status, checks: [],
            failedChecks: sc.status === gas.SELFTEST_STATUS.PASSED ? []
              : [{ label: 'x', expected: 'a', actual: 'b', evidence: '' }],
            note: sc.note || '' };
        }
      };
    });
  };
  return {
    gas: gas,
    run: function (resume) {
      runIndex++;
      const report = gas.runSelfTestMachine_(!!resume, false);
      const m = {};
      report.results.forEach(function (r) { m[r.id] = r; });
      return { report: report, byId: m,
        lines: gas.describeSelfTestReport_(report).join('\n') };
    },
    peek: function () { return store; }
  };
}

// =====================================================================
console.log('\n=== A6(b)【核心】續跑會重跑 `INCOMPLETE` 嗰條 ===');
{
  const gas0 = loadGasSource(FILES);
  const S = gas0.SELFTEST_STATUS;
  let ran = 0;
  const box = machine(function () {
    return [{ id: 'X1', status: S.INCOMPLETE, note: '（未做完）還差 51 份。' }];
  });
  // 攔住 run() 數佢跑咗幾次。
  const realScenarios = box.gas.selfTestScenarios_;
  box.gas.selfTestScenarios_ = function () {
    return realScenarios().map(function (sc) {
      const inner = sc.run;
      return Object.assign({}, sc, { run: function (q) { ran++; return inner(q); } });
    });
  };

  const first = box.run(false);
  checkEqual('★★★★★ 第一次跑咗，而且標 `INCOMPLETE`', first.byId.X1.status, S.INCOMPLETE);
  checkEqual('★★★★★ 跑咗 1 次', ran, 1);

  const second = box.run(true);
  checkEqual('★★★★★★ **續跑真係再跑咗一次**'
    + '——`settled` 包住 `INCOMPLETE` 嘅話呢度會係 1，'
    + '而 S08 就永遠補唔齊 58 份 PDF',
    ran, 2);
  checkEqual('★★★★★ 而且仍然係 `INCOMPLETE`（今次仲係未做完）',
    second.byId.X1.status, S.INCOMPLETE);
  check('★★★★★★ 而且唔會被報成「上一次已經有結論，這一次不再跑」',
    !/上一次已經有結論/.test(String(second.byId.X1.note || '')),
    String(second.byId.X1.note));
}

// =====================================================================
console.log('\n=== A3【核心】上游 `INCOMPLETE` ⇒ 下游 `BLOCKED`，而且講明唔係失敗 ===');
{
  const gas0 = loadGasSource(FILES);
  const S = gas0.SELFTEST_STATUS;
  const box = machine(function () {
    return [
      { id: 'X8', status: S.INCOMPLETE, note: '（未做完）還差 51 份。' },
      { id: 'X9', status: S.PASSED, dependsOn: ['X8'] }
    ];
  });
  const out = box.run(false);
  checkEqual('★★★★★★ 下游標 `BLOCKED`'
    + '——S09 喺 S08 未產齊 PDF 之下跑，系統會攔住佢，'
    + '而嗰個攔截係啱嘅，唔應該記成 S09 自己嘅紅',
    out.byId.X9.status, S.BLOCKED);
  check('★★★★★★ **註記講明「上游是未做完，不是失敗」**'
    + '——講成「修好上游」嘅話，Ivan 會去搵一個唔存在嘅 bug，'
    + '而佢真正要做嘅只係再撳一次「繼續跑自測」',
    /未做完/.test(out.byId.X9.note || '') && /不是失敗/.test(out.byId.X9.note || ''),
    out.byId.X9.note);
  check('★★★★★★ 而且叫佢撳「繼續跑自測」，唔係「只重跑紅色情境」',
    /繼續跑自測/.test(out.byId.X9.note || '')
      && !/只重跑紅色情境/.test(out.byId.X9.note || ''), out.byId.X9.note);
}

// =====================================================================
console.log('\n=== A3 上游係真紅 ⇒ 註記仍然講「修好上游」 ===');
{
  const gas0 = loadGasSource(FILES);
  const S = gas0.SELFTEST_STATUS;
  const box = machine(function () {
    return [
      { id: 'X8', status: S.FAILED },
      { id: 'X9', status: S.PASSED, dependsOn: ['X8'] }
    ];
  });
  const out = box.run(false);
  checkEqual('★★★★★ 一樣 `BLOCKED`', out.byId.X9.status, S.BLOCKED);
  check('★★★★★★ 但註記係「修好上游」，唔係「未做完」'
    + '——兩種情況要講得唔同，Ivan 要做嘅嘢完全唔一樣',
    /修好上游/.test(out.byId.X9.note || '')
      && !/未做完/.test(out.byId.X9.note || ''), out.byId.X9.note);
}

// =====================================================================
console.log('\n=== A4【核心】摘要要獨立數出「未完成」 ===');
{
  const gas0 = loadGasSource(FILES);
  const S = gas0.SELFTEST_STATUS;
  const box = machine(function () {
    return [
      { id: 'X1', status: S.PASSED },
      { id: 'X8', status: S.INCOMPLETE, note: '（未做完）還差 51 份。' },
      { id: 'X9', status: S.PASSED, dependsOn: ['X8'] }
    ];
  });
  const out = box.run(false);
  checkEqual('★★★★★★ `incompleteCount` 數到 1', out.report.incompleteCount, 1);
  check('★★★★★★ **摘要行有「1 未完成」**'
    + '——只數綠紅嘅話，一份「2 綠 0 紅」嘅報告睇落情況良好，'
    + '而實際上有一條未做完、一條被佢擋住',
    /1 未完成/.test(out.lines), out.lines.slice(0, 300));
  check('★★★★★★ 而且有一節「⏳ 未做完」',
    /⏳ 未做完（1 條，撳「▶️ 繼續跑自測」接住做）/.test(out.lines),
    out.lines.slice(0, 900));
  check('★★★★★★ 排喺「被擋住」前面'
    + '——被擋住嗰幾條通常就係佢擋住嘅，先睇到根因就唔使逐條查',
    out.lines.indexOf('⏳ 未做完') < out.lines.indexOf('🚧 被上游擋住'),
    out.lines.slice(0, 900));
}

// =====================================================================
console.log('\n=== A4【核心】尾句固定叫「繼續跑自測」 ===');
{
  const gas0 = loadGasSource(FILES);
  const S = gas0.SELFTEST_STATUS;
  const box = machine(function () {
    return [
      { id: 'X8', status: S.INCOMPLETE, note: '（未做完）還差 51 份。' },
      { id: 'X9', status: S.PASSED, dependsOn: ['X8'] }
    ];
  });
  const lines = box.run(false).lines;
  check('★★★★★★ **「還有 1 條未做完 ⇒ 撳「▶️ 繼續跑自測」接住做」**',
    /還有 1 條未做完 ⇒ 撳「▶️ 繼續跑自測」接住做（不是「只重跑紅色情境」）/
      .test(lines), lines.slice(-600));
  check('★★★★★★ 而且明講「不是只重跑紅色情境」'
    + '——「只重跑紅色情境」會把 INCOMPLETE 清走再由頭跑，'
    + '而 S08 要嘅係接住做，唔係由頭再產一次 58 份',
    /不是「只重跑紅色情境」/.test(lines), lines.slice(-600));
  check('★★★★★ 而且唔會同時印「你改過程式碼…」嗰兩行'
    + '——兩種指示一齊出，就等於冇指示',
    !/・你改過程式碼（有 clasp push 過）/.test(lines), lines.slice(-600));
}

// =====================================================================
console.log('\n=== A5【核心】「只重跑紅色情境」要一併清走 `INCOMPLETE` ===');
{
  const gas = loadGasSource(FILES);
  const S = gas.SELFTEST_STATUS;
  const cleared = gas.clearFailedSelfTestState_({
    A: { status: S.PASSED }, B: { status: S.FAILED },
    C: { status: S.BLOCKED }, D: { status: S.INCOMPLETE },
    E: { status: S.SKIPPED }
  });
  checkEqual('★★★★★★ `INCOMPLETE` 被清走'
    + '——唔清嘅話，修完碼之後佢唔會重跑，'
    + '而佢正正就係要接住做嗰條',
    cleared.clearedIds.sort().join('、'), 'B、C、D');
  checkEqual('★★★★★ 綠同跳過留住', Object.keys(cleared.state).sort().join('、'), 'A、E');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
