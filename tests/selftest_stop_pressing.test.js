// 第五十三輪批次 C 組：撳咗三次，三份報告一字不差。
// 執行方式：node tests/selftest_stop_pressing.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 呢個已經係**第四次**「Ivan 撳同一粒掣三次以上，三份報告一字不差」：
//
//   第五十輪　　續跑只跳過通過嗰啲　　⇒ 撳三次，三次一樣
//   第五十輪　　不變量太貴　　　　　　⇒ 撳三次，三次一樣
//   第五十二輪　既有失敗污染下游　　　⇒ 撳三次，三次一樣
//   第五十三輪　一條真嘅紅　　　　　　⇒ 撳三次，三次一樣
//
// 每一次都要 Ivan 自己察覺「咦，三份一樣」然後停手問。
//
// ⚠️⚠️ 而 Ivan 十月返嚟嗰陣係**一個人**。
// 到時冇人喺旁邊幫佢數「你已經撳咗三次」。
// 所以呢件事要由報告自己講。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════
//
// 佢真正叫落 `runSelfTestMachine_()` **三次**，
// 中間用一個記憶體版嘅 `SelfTestState` 頂住，
// 然後睇第三份報告有冇自己講「唔好再撳」。

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

/**
 * 造一部只有假情境嘅自測機，而 `SelfTestState` 係一個記憶體物件。
 *
 * ⚠️ 狀態要**真嘅過得到一次執行去下一次執行**——
 * 唔係噉嘅話，「跑過幾次」永遠係 1，而呢一組驗嘅正正就係嗰個數。
 *
 * @param {Function} outcomeOf `function (scenarioId, runIndex) => outcome`
 * @returns {Object} `{gas, run, store}`
 */
function makeMachine(outcomeOf) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  const S = gas.SELFTEST_STATUS;
  let store = {};
  let runIndex = 0;

  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    return { versionRowsDeleted: 0, assignmentRowsDeleted: 0, sendLogRowsDeleted: 0 };
  };
  gas.runAllInvariants_ = function () {
    return {
      results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0
    };
  };
  gas.selfTestOutOfTime_ = function () { return false; };
  gas.isSelfTestQuarterFresh_ = function () { return { fresh: true, reason: '' }; };

  // ── 記憶體版 `SelfTestState`。⚠️ 要**真嘅來回一轉**。 ────────
  gas.readSelfTestState_ = function () {
    return JSON.parse(JSON.stringify(store));
  };
  gas.writeSelfTestState_ = function (state) {
    store = JSON.parse(JSON.stringify(state));
  };

  gas.selfTestScenarios_ = function () {
    return [
      { id: 'X1', title: '會紅嗰個', run: function () { return outcomeOf('X1', runIndex); } },
      { id: 'X2', title: '一路綠', run: function () {
        return { id: 'X2', status: S.PASSED, checks: [], failedChecks: [] };
      } }
    ];
  };

  return {
    gas: gas,
    run: function (rerunFailedOnly) {
      runIndex++;
      const report = gas.runSelfTestMachine_(!!rerunFailedOnly, !!rerunFailedOnly);
      return {
        report: report,
        lines: gas.describeSelfTestReport_(report).join('\n'),
        byId: (function () {
          const m = {};
          report.results.forEach(function (r) { m[r.id] = r; });
          return m;
        })()
      };
    },
    peek: function () { return store; }
  };
}

/** 一個「永遠同一個結果」嘅紅。 */
function sameRedEveryTime(gas) {
  return function (id) {
    return {
      id: id, status: gas.SELFTEST_STATUS.FAILED, checks: [],
      failedChecks: [{ label: '儲存並確認', expected: 'ok=true', actual: 'ok=false',
        evidence: '有 1 格違反了一定要遵守的規則' }]
    };
  };
}

// =====================================================================
console.log('\n=== C1【核心】跑過幾次要記低，而且過得到下一次執行 ===');
{
  let gasRef = null;
  const machine = makeMachine(function (id) {
    return {
      id: id, status: gasRef.SELFTEST_STATUS.FAILED, checks: [],
      failedChecks: [{ label: '儲存並確認', expected: 'ok=true', actual: 'ok=false',
        evidence: '有 1 格違反了一定要遵守的規則' }]
    };
  });
  gasRef = machine.gas;

  const first = machine.run(false);
  checkEqual('★★★★★★ 第一次：跑過 1 次',
    (first.byId.X1.repeat || {}).runCount, 1);
  checkEqual('★★★★★★ 連續相同結果 1 次', (first.byId.X1.repeat || {}).sameStreak, 1);
  check('★★★★★★ 第一次唔可以講「唔好再撳」'
    + '——一次就叫人唔好再撳，就等於冇咗續跑呢個功能',
    !/不要再撳/.test(first.lines) && !/已經重跑/.test(first.lines),
    first.lines.slice(0, 800));

  const second = machine.run(true);
  checkEqual('★★★★★★ 第二次：跑過 2 次', (second.byId.X1.repeat || {}).runCount, 2);
  checkEqual('★★★★★★ **連續相同結果 2 次**'
    + '——⚠️ 「只重跑紅色情境」會把紅嗰幾條由狀態表清走，'
    + '而嗰幾條正正就係要數次數嗰幾條。清走咗仲要數得返先算數',
    (second.byId.X1.repeat || {}).sameStreak, 2);

  const third = machine.run(true);
  checkEqual('★★★★★★ 第三次：跑過 3 次', (third.byId.X1.repeat || {}).runCount, 3);

  // ── C2：報告自己講 ────────────────────────────────────────
  check('★★★★★★ **報告自己講「已經重跑 3 次」**'
    + '——之前每一次都要 Ivan 自己察覺「咦，三份一樣」然後停手問。'
    + '而佢十月返嚟嗰陣係一個人，冇人喺旁邊幫佢數',
    /⛔ 這一條已經重跑 3 次，每次都是同一個結果。/.test(third.lines),
    third.lines.slice(0, 1200));
  check('★★★★★★ 而且講明「再撳唔會有分別」',
    /再撳「▶️ 只重跑紅色情境」不會有分別——要修碼才會變。/.test(third.lines),
    third.lines.slice(0, 1200));

  // ── C3：最尾嗰句 ──────────────────────────────────────────
  check('★★★★★★ 最尾「下一步」嗰句改成「不要再撳」'
    + '——舊嗰句係「修好之後撳只重跑紅色情境」，'
    + '而 Ivan 就係照住嗰句撳咗三次',
    /不要再撳——/.test(third.lines) && /把這份報告交給 Claude，要修碼。/.test(third.lines),
    third.lines.slice(-700));
  check('★★★★★★ 而且唔再叫佢撳「只重跑紅色情境」',
    !/修好之後撳「測試工具 ▸ ▶️ 只重跑紅色情境」/.test(third.lines),
    third.lines.slice(-700));
  checkEqual('★★★★★ 綠嗰條唔會被講「唔好再撳」',
    /X2[\s\S]{0,200}已經重跑/.test(third.lines), 'false');
}

// =====================================================================
console.log('\n=== B【核心】第五十四輪：被擋住之後，次數唔可以歸零 ===');
{
  // ═══════════════════════════════════════════════════════════════
  // 現場
  // ═══════════════════════════════════════════════════════════════
  //
  // S05 至少紅咗四次，但報告從來冇出過「⛔ 呢一條已經重跑 N 次」。
  //
  // 查出嚟嘅原因**唔係** `clearFailedSelfTestState_()`——嗰邊已經冇事，
  // `priorHistory` 喺清除**之前**就讀咗（第五十三輪 C1 已經噉做）。
  //
  // 真正嘅漏喺三條寫入路：`BLOCKED`／`SKIPPED`／`NOT_RUN`
  // 寫 `SelfTestState` 嗰陣冇帶次數 ⇒ 歸零。
  //
  // ⚠️ 而 S05 嘅實況正正就係第一條：S03 紅咗、S05 被標 `BLOCKED`，
  // 於是佢每一次都由零數起——**永遠數唔到 2**。
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  const S = gas.SELFTEST_STATUS;
  let store = {};
  let upstreamOk = true;

  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () { return { value: '2028T3', source: 'x' }; };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    return { versionRowsDeleted: 0, assignmentRowsDeleted: 0, sendLogRowsDeleted: 0 };
  };
  gas.runAllInvariants_ = function () {
    return { results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0 };
  };
  gas.selfTestOutOfTime_ = function () { return false; };
  gas.readSelfTestState_ = function () { return JSON.parse(JSON.stringify(store)); };
  gas.writeSelfTestState_ = function (st) { store = JSON.parse(JSON.stringify(st)); };
  gas.selfTestScenarios_ = function () {
    return [
      { id: 'X0', title: '上游', run: function () {
        return upstreamOk
          ? { id: 'X0', status: S.PASSED, checks: [], failedChecks: [] }
          : { id: 'X0', status: S.FAILED, checks: [],
            failedChecks: [{ label: '上游爆咗', expected: 'a', actual: 'b', evidence: '' }] };
      } },
      { id: 'X1', title: '下游（就係 S05 嗰個角色）', dependsOn: ['X0'],
        run: function () {
          return { id: 'X1', status: S.FAILED, checks: [],
            failedChecks: [{ label: '儲存並確認', expected: 'ok=true',
              actual: 'ok=false', evidence: '有 1 格違反了一定要遵守的規則' }] };
        } }
    ];
  };
  const run = function (rerun) {
    const report = gas.runSelfTestMachine_(!!rerun, !!rerun);
    const m = {};
    report.results.forEach(function (r) { m[r.id] = r; });
    return { byId: m, lines: gas.describeSelfTestReport_(report).join('\n') };
  };

  const a = run(false);
  checkEqual('★★★★★ 第一次：X1 跑咗 1 次', (a.byId.X1.repeat || {}).runCount, 1);

  const b = run(true);
  checkEqual('★★★★★ 第二次：X1 跑咗 2 次', (b.byId.X1.repeat || {}).runCount, 2);
  checkEqual('★★★★★ 連續相同結果 2 次', (b.byId.X1.repeat || {}).sameStreak, 2);

  // ── 上游爆咗 ⇒ X1 被擋住，冇跑 ─────────────────────────────
  // ⚠️ 要由頭跑，唔係「只重跑紅色情境」——後者會把 X0（上一次綠）
  // 當成「已經有結論」跳過，於是佢根本唔會重新跑，X1 也就唔會被擋住。
  upstreamOk = false;
  const c = run(false);
  checkEqual('★★★★★ 第三次：X1 被擋住', c.byId.X1.status, S.BLOCKED);
  checkEqual('★★★★★★ **被擋住之後，次數仍然係 2**'
    + '——歸零嘅話，佢下一次由頭數起，「連續兩次」永遠數唔到，'
    + '而 S05 嘅實況正正就係噉：S03 紅咗、S05 被擋住',
    Number(store.X1.runCount), 2);
  checkEqual('★★★★★★ 連續次數一樣留住', Number(store.X1.sameStreak), 2);
  check('★★★★★★ 連上一次嘅指紋都要留住'
    + '——冇咗指紋，下一次跑出同一個結果會被當成「第一次見」',
    String(store.X1.fingerprint || '').indexOf('儲存並確認') >= 0,
    JSON.stringify(store.X1).slice(0, 300));

  // ── 上游修好 ⇒ X1 重新跑，次數要接落去 ───────────────────
  upstreamOk = true;
  const d = run(false);
  checkEqual('★★★★★★ 第四次：X1 跑咗 3 次（唔係由 1 數起）',
    (d.byId.X1.repeat || {}).runCount, 3);
  checkEqual('★★★★★★ 而且連續相同結果 3 次', (d.byId.X1.repeat || {}).sameStreak, 3);
  check('★★★★★★ **所以「唔好再撳」終於出得到**'
    + '——之前佢每次被擋住就歸零，於是永遠去唔到嗰一句',
    /⛔ 這一條已經重跑 3 次，每次都是同一個結果。/.test(d.lines),
    d.lines.slice(0, 1200));
}

// =====================================================================
console.log('\n=== C2【核心】結果變咗 ⇒ 連續次數歸零 ===');
{
  let gasRef = null;
  const machine = makeMachine(function (id, runIndex) {
    const S = gasRef.SELFTEST_STATUS;
    // 第 3 次換咗另一條斷言紅——**嗰個係有進展**。
    return {
      id: id, status: S.FAILED, checks: [],
      failedChecks: [{
        label: runIndex >= 3 ? '寄給堂委審閱' : '儲存並確認',
        expected: 'ok=true', actual: 'ok=false', evidence: 'x'
      }]
    };
  });
  gasRef = machine.gas;

  machine.run(false);
  const second = machine.run(true);
  checkEqual('★★★★★ 頭兩次一樣 ⇒ 連續 2 次',
    (second.byId.X1.repeat || {}).sameStreak, 2);

  const third = machine.run(true);
  checkEqual('★★★★★★ 第三次換咗另一條斷言紅 ⇒ **連續次數歸零**'
    + '——⚠️ 比對嘅係指紋，唔係「紅唔紅」。'
    + '一條由「A 斷言紅」變成「B 斷言紅」嘅情境係有進展，'
    + '唔應該被數成「又係同一樣」而叫人停手',
    (third.byId.X1.repeat || {}).sameStreak, 1);
  checkEqual('★★★★★★ 但係「跑過幾次」照樣累加', (third.byId.X1.repeat || {}).runCount, 3);
  check('★★★★★★ 所以唔會叫佢停手',
    !/不要再撳/.test(third.lines), third.lines.slice(-600));
}

// =====================================================================
console.log('\n=== C3 有一條紅係新嘅 ⇒ 唔可以叫佢停手 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  const S = gas.SELFTEST_STATUS;
  // ⚠️ 「全部紅嘅都卡住」先叫停。一條卡住、一條係新嘅 ⇒ 仲有嘢可以試。
  const lines = gas.describeSelfTestReport_({
    quarterId: '2028T3', resetSummary: '（測試）', results: [
      { id: 'X1', title: '卡住嗰個', status: S.FAILED, failedChecks: [],
        repeat: { runCount: 3, sameStreak: 3 } },
      { id: 'X2', title: '新紅嗰個', status: S.FAILED, failedChecks: [],
        repeat: { runCount: 1, sameStreak: 1 } }
    ],
    passedCount: 0, failedCount: 2, errorCount: 0, notRunCount: 0,
    startupFailures: [], finalInvariants: null
  }).join('\n');
  check('★★★★★★ 只有一條卡住 ⇒ 仲係叫佢撳「只重跑紅色情境」'
    + '——另一條係新嘅，重跑有機會有分別',
    /修好之後撳「測試工具 ▸ ▶️ 只重跑紅色情境」/.test(lines) && !/不要再撳/.test(lines),
    lines.slice(-600));
  check('★★★★★ 但卡住嗰條自己嗰一節仍然要講',
    /⛔ 這一條已經重跑 3 次/.test(lines), lines.slice(0, 800));
}

// =====================================================================
console.log('\n=== C1 `SKIPPED` 唔可以報成「0 條斷言失敗」 ===');
{
  let gasRef = null;
  const machine = makeMachine(function (id) {
    return {
      id: id, status: gasRef.SELFTEST_STATUS.SKIPPED, checks: [], failedChecks: [],
      note: '（跳過）這一季造不出這個情境。'
    };
  });
  gasRef = machine.gas;
  machine.run(false);
  checkEqual('★★★★★★ `SelfTestState` 嘅摘要寫「跳過」'
    + '——寫「0 條斷言失敗」睇落似通過，而佢根本冇跑過',
    machine.peek().X1.summary, '跳過');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
