// 第五十二輪批次 B 組：一個既有嘅不變量失敗，令 13 條情境跑唔到。
// 執行方式：node tests/selftest_invariant_attribution.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 不變量係**成個季度嘅性質**，唔係某一個情境嘅產物。
// 但舊寫法係：
//
//     情境跑完 → 跑快嗰批不變量 → 有一條紅 ⇒ **呢個情境算紅**
//
// 於是一條喺開跑之前就已經紅嘅不變量，會令**之後每一個情境**都紅；
// 而每一個紅嘅情境又會經 `dependsOn` 把下游標成 `BLOCKED`。
//
//     一個根因　⇒　13 條情境一條都跑唔到
//
// 而報告上面睇落好似有 13 個地方壞咗。
//
// ─────────────────────────────────────────────────────────────────────
// 修正
// ─────────────────────────────────────────────────────────────────────
//
//   本來綠、而家紅　　⇒　呢個情境整嘅　　　　　⇒ 算佢頭上
//   本來紅、而家仲紅　⇒　開跑之前就已經噉　　　⇒ **唔算佢頭上**
//   本來紅、而家綠　　⇒　呢個情境順手整返好咗　⇒ 講一句
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份**唔驗字串**
// ═════════════════════════════════════════════════════════════════════
//
// 佢真正叫落 `runSelfTestMachine_()`，把 `runAllInvariants_()` 換成一個
// 逐次回不同答案嘅 stub，然後睇**機器真正判出嚟嘅狀態**。
//
// verify-red 連續四輪捉到「讀字串」呢種形式嘅假綠——
// `if (false) { … }` 之後嗰串字仲喺度，斷言照樣綠。

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
 * 造一部只有假情境嘅自測機。
 *
 * @param {Array<Object>} scenarios `[{id, title, dependsOn, outcome}]`
 * @param {Array<Array<string>>} invariantScript 每次叫快嗰批要回邊幾條紅；
 *   第 0 個係**開跑嗰張底相**，之後逐個情境一個
 * @returns {Object} `{gas, report, lines, invariantCalls}`
 */
function runMachine(scenarios, invariantScript) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  const S = gas.SELFTEST_STATUS;
  const I = gas.INVARIANT_STATUS;
  let call = 0;
  const invariantCalls = [];

  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    return { versionRowsDeleted: 0, assignmentRowsDeleted: 0, sendLogRowsDeleted: 0 };
  };
  gas.readSelfTestState_ = function () { return {}; };
  gas.writeSelfTestState_ = function () {};
  gas.selfTestOutOfTime_ = function () { return false; };
  gas.isSelfTestQuarterFresh_ = function () { return { fresh: true, reason: '' }; };

  gas.runAllInvariants_ = function (quarterId, set) {
    invariantCalls.push(set);
    if (set === gas.INVARIANT_SET.FINAL) {
      return {
        results: [], okCount: 0, failedCount: 0, errorCount: 0,
        skippedCount: 0, notApplicableCount: 0
      };
    }
    const failing = invariantScript[call] || [];
    call++;
    return {
      results: failing.map(function (id) {
        return {
          id: id, title: id, status: I.FAILED,
          expected: '0', actual: '1', evidence: id + ' 嘅證據'
        };
      }),
      okCount: 0, failedCount: failing.length, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0
    };
  };

  gas.selfTestScenarios_ = function () {
    return scenarios.map(function (sc) {
      return {
        id: sc.id, title: sc.title, dependsOn: sc.dependsOn || [],
        run: function () {
          return {
            id: sc.id, status: sc.status || S.PASSED,
            checks: [], failedChecks: sc.failedChecks || []
          };
        }
      };
    });
  };

  const report = gas.runSelfTestMachine_(false, false);
  return {
    gas: gas, report: report, invariantCalls: invariantCalls,
    lines: gas.describeSelfTestReport_(report).join('\n'),
    byId: (function () {
      const m = {};
      report.results.forEach(function (r) { m[r.id] = r; });
      return m;
    })()
  };
}

// =====================================================================
console.log('\n=== B【核心】開跑就已經紅嘅不變量，唔算落情境頭上 ===');
{
  // I01 由頭到尾都紅。三個情境自己嘅斷言全部綠。
  const box = runMachine([
    { id: 'X1', title: '第一個' },
    { id: 'X2', title: '第二個', dependsOn: ['X1'] },
    { id: 'X3', title: '第三個', dependsOn: ['X2'] }
  ], [['I01'], ['I01'], ['I01'], ['I01']]);
  const S = box.gas.SELFTEST_STATUS;

  checkEqual('★★★★★★ X1 係綠——I01 開跑就紅，唔係佢整嘅', box.byId.X1.status, S.PASSED);
  checkEqual('★★★★★★ **X2 冇被擋住，而且係綠**'
    + '——舊寫法：X1 因為 I01 被判紅 ⇒ X2 `BLOCKED` ⇒ X3 `BLOCKED`。'
    + '一個根因，成串跑唔到',
    box.byId.X2.status, S.PASSED);
  checkEqual('★★★★★★ X3 一樣', box.byId.X3.status, S.PASSED);
  checkEqual('★★★★★★ 一個 `BLOCKED` 都冇',
    box.report.results.filter(function (r) { return r.status === S.BLOCKED; }).length, 0);

  // ── 唔算佢頭上，但**要講** ─────────────────────────────────
  checkEqual('★★★★★★ X1 嘅「不變量」欄係空嘅——唔算佢頭上',
    (box.byId.X1.invariantDetail || []).length, 0);
  check('★★★★★★ 但要喺註記講明 I01 跑嗰陣仍然紅'
    + '——完全唔提嘅話，一條開跑就紅嘅不變量會靜靜噉喺成份報告度消失',
    /I01/.test(String(box.byId.X1.note || '')), String(box.byId.X1.note));

  // ── 報告最頂嗰一節 ─────────────────────────────────────────
  check('★★★★★★ 報告開頭有「開跑的時候已經存在的不變量失敗」一節',
    /開跑的時候已經存在的不變量失敗（1 條）/.test(box.lines), box.lines.slice(0, 700));
  check('★★★★★ 而且貼出證據原文',
    /I01 嘅證據/.test(box.lines), box.lines.slice(0, 700));
  check('★★★★★★ 排喺情境前面'
    + '——呢幾條係先決條件，唔清乾淨，下面每一條嘅綠同紅都要打個折扣',
    box.lines.indexOf('開跑的時候已經存在的不變量失敗')
      < box.lines.indexOf('（情境按執行次序排，不按編號。）'), '');
}

// =====================================================================
console.log('\n=== B【核心】情境**整紅咗**一條本來綠嘅，仍然要算佢頭上 ===');
{
  // 底相：I01 紅。X1 跑完：仲係得 I01（carried）。
  // X2 跑完：I01 ＋ I05 ⇒ **I05 係 X2 整嘅**。
  const box = runMachine([
    { id: 'X1', title: '第一個' },
    { id: 'X2', title: '第二個' },
    { id: 'X3', title: '第三個', dependsOn: ['X2'] }
  ], [['I01'], ['I01'], ['I01', 'I05'], ['I01', 'I05']]);
  const S = box.gas.SELFTEST_STATUS;

  checkEqual('★★★★★★ **X2 算紅**——佢整紅咗一條本來綠嘅不變量。'
    + '呢一條唔可以連埋一齊放鬆，放鬆咗就等於冇咗不變量',
    box.byId.X2.status, S.FAILED);
  checkEqual('★★★★★★ 而且「不變量」欄只列 I05，唔列 I01',
    (box.byId.X2.invariantDetail || []).join(' ‖ '),
    'I05｜預期 0｜實際 1｜I05 嘅證據');
  checkEqual('★★★★★★ X3 被 X2 擋住——呢一次係真嘅上游失敗',
    box.byId.X3.status, S.BLOCKED);
  checkEqual('★★★★★ X1 仍然係綠', box.byId.X1.status, S.PASSED);

  // ⚠️ I05 之後一直紅，但**唔會再算落 X3 頭上**（X3 已經 BLOCKED，
  // 而就算佢跑得到，I05 已經入咗 `knownFailing`）。
  check('★★★★★★ I05 唔會由 X2 起一路傳落去每一個下游'
    + '——一個情境整紅嘅嘢，只算佢一次',
    (box.byId.X3.invariantDetail || []).length === 0, '');
}

// =====================================================================
console.log('\n=== B 順手修好咗一條，要講一句 ===');
{
  const box = runMachine([
    { id: 'X1', title: '第一個' },
    { id: 'X2', title: '第二個' }
  ], [['I01'], [], []]);
  checkEqual('★★★★★ X1 把 I01 整返好咗 ⇒ 講一句',
    /順手修好了：I01/.test(String(box.byId.X1.note || '')), 'true');
  checkEqual('★★★★★ X1 仍然係綠', box.byId.X1.status, box.gas.SELFTEST_STATUS.PASSED);
}

// =====================================================================
console.log('\n=== B 底相影唔到 ⇒ 要講，唔可以當成「乜都冇紅」 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () { return { value: '2028T3', source: 'x' }; };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    return { versionRowsDeleted: 0, assignmentRowsDeleted: 0, sendLogRowsDeleted: 0 };
  };
  gas.readSelfTestState_ = function () { return {}; };
  gas.writeSelfTestState_ = function () {};
  gas.selfTestOutOfTime_ = function () { return false; };
  gas.runAllInvariants_ = function () { throw new Error('不變量表讀唔到'); };
  gas.selfTestScenarios_ = function () { return []; };

  const report = gas.runSelfTestMachine_(false, false);
  const lines = gas.describeSelfTestReport_(report).join('\n');
  checkEqual('★★★★★★ 影唔到相唔可以當成「乜都冇紅」'
    + '——當成冇紅嘅話，一條既有嘅失敗會被算落第一個情境頭上，'
    + '即係呢一組要修嗰件事',
    report.startupSnapshotError, '不變量表讀唔到');
  check('★★★★★★ 而且要喺報告講明後面嘅歸咎可能唔準',
    /開跑之前影不到不變量的底相/.test(lines) && /算了在它頭上/.test(lines),
    lines.slice(0, 600));
}

// =====================================================================
console.log('\n=== B 底相只影一次，唔可以每個情境影多一次 ===');
{
  const box = runMachine([
    { id: 'X1', title: '一' }, { id: 'X2', title: '二' }, { id: 'X3', title: '三' }
  ], [[], [], [], []]);
  const fast = box.invariantCalls.filter(function (set) {
    return set === box.gas.INVARIANT_SET.PER_SCENARIO;
  }).length;
  checkEqual('★★★★★★ 3 個情境 ⇒ 快嗰批只跑 4 次（1 張底相 ＋ 每個情境 1 次）'
    + '——上一個情境嘅事後相就係下一個情境嘅事前相，'
    + '所以歸咎一蚊都唔使多畀。第五十輪批次嗰個時間預算問題唔可以走回頭路',
    fast, 4);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
