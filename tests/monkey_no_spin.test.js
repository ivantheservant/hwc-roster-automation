// 第六十輪批次：亂行機喺沙盒度原地打轉。
// 執行方式：node tests/monkey_no_spin.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 「改 grid 幾格」寫入嘅字係 `'亂行' + (i + 1)`——「亂行1」「亂行2」，
// 一個系統一定認唔出嘅名。試算表 grid 已經見到
// `07-02 主席=亂行1、報告=亂行2`。
//
// `unresolvedCount > 0` 之後，系統嘅規矩係
// **「有認唔出嘅名就乜都唔准做」**：儲存並確認整批拒絕、寄出封鎖、
// 套用申報行唔到。於是每一步只剩「改 grid」合法，
// 亂行機一直寫更多「亂行N」，永遠出唔到個坑。
//
// 2028T3 嘅 Stage 停喺 OFFICIAL_SENT（19:27:09）一路冇變過，
// 證明**零動作成功過**——而報告一句都冇講。
//
// ⚠️⚠️ 呢個同第五十四輪 S03 嗰個 bug 完全同一種病。
// 當時嘅解法係「唔猜規則，寫入之後叫唯讀嘅 `apiSaveAndConfirmPlan()`
// 問系統」，但嗰個修正只套喺 `selfTestPickCells_()` 嘅呼叫端，
// 冇套到亂行機。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 兩件事分開驗
// ═════════════════════════════════════════════════════════════════════
//
//   A1　「改 grid」寫真名 ⇒ 唔會再種出嗰個坑
//   A3　防打轉閘 ⇒ **就算種返個坑，佢自己爬得出嚟**
//
// A3 係通用防護。亂行機嘅本質就係會撞到冇人諗過嘅狀態，
// 佢一定要有自己停手嘅能力，否則每撞一個新坑都要人手救。

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
const SRC = read('src/MonkeyRun.gs');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ⚠️ 第六十一輪批次 B 組之後，`runMonkey_()` 用到 `INVARIANT_SET`，
// 所以一定要載 `Invariants.gs`。唔載嘅話，每一步都會靜靜噉多咗一項
//「不變量算不出：INVARIANT_SET is not defined」——
// 而下面幾條斷言仍然會綠，即係一個假綠。
const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'SeasonRehearsal.gs', 'QuarterReset.gs',
  'SelfTestRunner.gs', 'Invariants.gs', 'MonkeyRun.gs'];

// =====================================================================
console.log('\n=== A1【核心】「改 grid」唔再寫認唔出嘅字 ===');
{
  check('★★★★★★ **`\'亂行\' + (i + 1)` 已經冇咗**'
    + '——寫一個系統認唔出嘅名，之後每一步都會被擋，'
    + '而亂行機就困喺「只剩改 grid 合法」嗰個坑入面',
    !/'亂行' \+ \(i \+ 1\)/.test(CODE), '');
  check('★★★★★★ 而家重用第五十四輪 S03 嗰一支'
    + '——另寫一份嘅話兩份邏輯必定分岔，'
    + '而分岔之後冇人分得出邊一份答錯',
    /selfTestPickAcceptedCells_\(\s*[\s\S]{0,120}MONKEY_SCENARIO_ID\)/.test(CODE),
    CODE.slice(CODE.indexOf("id: '改 grid 幾格'"),
      CODE.indexOf("id: '改 grid 幾格'") + 900));
  check('★★★★★ 而且冇喺亂行機度自己再寫一份揀格邏輯',
    !/selfTestBuildCandidatePool_\(/.test(CODE), '');
}

// =====================================================================
console.log('\n=== A1【核心】寫完仲有認唔出嘅名 ⇒ 即刻報 ===');
{
  const gas = loadGasSource(FILES);
  const grid = gas.monkeyActions_().filter(function (a) {
    return a.id === '改 grid 幾格';
  })[0];
  check('★★★★★★ 呢個動作存在', !!grid, '');

  const before = { stage: 'DRAFT', latestVersionNo: 3,
    gridChangeCount: 0, unresolvedCount: 0 };
  const complaint = grid.expect(
    { changedCells: 2, wanted: 2, planCalls: 1, preExisting: [], cells: [] },
    before, { stage: 'DRAFT', latestVersionNo: 3,
      gridChangeCount: 2, unresolvedCount: 2 });
  check('★★★★★★ **寫完之後仲有 2 格認唔出 ⇒ 報**'
    + '——呢一條先係防止今輪個 bug 翻生嗰一條。'
    + '系統嘅規矩係「有認唔出嘅名就乜都唔准做」，'
    + '之後每一步都會被擋，而亂行機會困喺原地',
    /困在原地/.test(complaint), complaint);

  checkEqual('★★★★★ 一格認唔出都冇 ⇒ 收貨',
    grid.expect({ changedCells: 2, wanted: 2, planCalls: 1,
      preExisting: [], cells: [] }, before,
    { stage: 'DRAFT', latestVersionNo: 3,
      gridChangeCount: 2, unresolvedCount: 0 }), '');

  check('★★★★★ 一格都寫唔到 ⇒ 報（呢一步實際上乜都冇做）',
    /一格都沒有寫到/.test(grid.expect(
      { changedCells: 0, wanted: 3, planCalls: 4, preExisting: [],
        noCandidate: '找不到有合資格替代人選的格' },
      before, { stage: 'DRAFT', latestVersionNo: 3,
        gridChangeCount: 0, unresolvedCount: 0 })), '');
}

// =====================================================================
console.log('\n=== A1 `unresolvedCount` 要真係由主畫面讀返嚟 ===');
{
  // ⚠️ 寫死 0 嘅話，上面嗰條斷言就永遠唔會 fire——
  // 一條永遠 true 嘅斷言同冇斷言係同一件事。
  const gas = loadGasSource(FILES);
  gas.buildDashboardState_ = function () {
    return { stage: 'OFFICIAL_SENT',
      unsaved: { gridChangeCount: 7, unresolvedCount: 2 }, buttons: {} };
  };
  gas.findLatestVersionNo_ = function () { return 3; };
  const facts = gas.monkeyReadFacts_('2028T3');
  checkEqual('★★★★★★ **`unresolvedCount` 由主畫面讀返嚟，唔係寫死 0**',
    facts.unresolvedCount, 2);
  checkEqual('★★★★★ 主畫面冇畀就當 0',
    (function () {
      gas.buildDashboardState_ = function () {
        return { stage: 'DRAFT', buttons: {} };
      };
      return gas.monkeyReadFacts_('2028T3').unresolvedCount;
    })(), 0);
}

// =====================================================================
console.log('\n=== A2 收唔乾淨 ⇒ `monkeyExpectNoChange_` 要捉到 ===');
{
  // ⚠️ 「改返原值」同「認唔出嘅格數打返和」係兩件事。
  // 只睇未儲存格數嘅話，一格改返個字但系統仍然認唔出嗰種情況會漏網。
  const gas = loadGasSource(FILES);
  const moved = gas.monkeyExpectNoChange_(
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 2, unresolvedCount: 0 },
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 2, unresolvedCount: 1 });
  check('★★★★★★ 認唔出嘅格數由 0 變 1 ⇒ 捉到',
    /認不出的格數由 0 變成 1/.test(moved), moved);
  checkEqual('★★★★★ 三樣都打返和 ⇒ 收貨',
    gas.monkeyExpectNoChange_(
      { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 2, unresolvedCount: 0 },
      { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 2, unresolvedCount: 0 }), '');
}

/**
 * 跑一部亂行機，每一步嘅狀態由測試話事。
 *
 * @param {Object} opts `{actions, facts, steps}`
 * @returns {Object} `{gas, report}`
 */
function machine(opts) {
  const gas = loadGasSource(FILES);
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.assertMonkeyDryRunStillOn_ = function () {};
  // ⚠️ 迴圈入面有嘢會讀 Config，而 Config 行 `CacheService`——
  // 沙箱唔提供。一律短路。
  gas.readConfig_ = function () { return {}; };
  gas.getConfig_ = function (key, dflt) { return dflt; };
  gas.writeMonkeyLog_ = function () {};
  gas.runAllInvariants_ = function () {
    return { results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0 };
  };
  gas.monkeyReadFacts_ = function () { return opts.facts(); };
  if (opts.actions) gas.monkeyActions_ = function () { return opts.actions(gas); };
  return { gas: gas, report: gas.runMonkey_(opts.steps || 50, 7, 0) };
}

// =====================================================================
console.log('\n=== A3【核心】原地打轉 ⇒ 停手，唔好跑足 50 步 ===');
{
  // ⚠️ 重演現場：只剩一個動作合法，而佢每一步都改變唔到系統狀態。
  //（舊寫法就係噉：寫多一個「亂行N」，Stage／版本號／認唔出格數
  // 三樣都冇郁——唯一會加嘅係 `gridChangeCount`。）
  let unresolved = 2;
  const box = machine({
    steps: 50,
    facts: function () {
      // ⚠️ `gridChangeCount` 每步加一——**指紋唔可以包佢**，
      // 包咗嘅話每步指紋都唔同，防打轉閘永遠唔會 fire。
      unresolved += 0;
      return { hasVersion: true, latestVersionNo: 3, stage: 'OFFICIAL_SENT',
        gridChangeCount: 10 + (unresolved += 1), unresolvedCount: 2,
        buttons: { review: { enabled: false }, official: { enabled: false },
          resend: { enabled: false } } };
    },
    actions: function () {
      return [{
        id: '改 grid 幾格',
        legal: function () { return true; },
        run: function () { return { changedCells: 1 }; }
      }];
    }
  });

  check('★★★★★★ **停咗手，冇跑足 50 步**'
    + '——舊寫法會一路寫更多「亂行N」跑足 50 步，'
    + '然後交一份「冇發現任何問題」嘅報告',
    box.report.ranSteps <= 6, '跑咗 ' + box.report.ranSteps + ' 步');
  check('★★★★★★ 而且報告帶住 `spinning`',
    !!box.report.spinning, JSON.stringify(box.report.spinning));
  checkEqual('★★★★★★ 說得出係邊個動作',
    box.report.spinning && box.report.spinning.actionId, '改 grid 幾格');
  checkEqual('★★★★★ 連續步數係 5', box.report.spinning
    && box.report.spinning.steps, 5);
  check('★★★★★★ 而且記成一項失敗（唔係靜靜停低）'
    + '——靜靜停低嘅話，一份「跑咗 5 步、0 項失敗」嘅報告'
    + '睇落好似冇事',
    (box.report.failures || []).some(function (f) {
      return f.kind === '偵測到原地打轉，已停止';
    }), JSON.stringify(box.report.failures));
  check('★★★★★★ 失敗帶住完整重現路徑',
    (box.report.failures || []).some(function (f) {
      return (f.path || []).length >= 5;
    }), JSON.stringify(box.report.failures));

  const lines = box.gas.describeMonkeyReport_(box.report).join('\n');
  check('★★★★★★ 報告最頂大聲講「偵測到原地打轉，已停止」'
    + '——排喺失敗清單前面：佢係「點解跑到一半就停」嘅答案',
    /⛔ 偵測到原地打轉，已停止。/.test(lines), lines.slice(0, 700));
  check('★★★★★ 而且印埋完整重現路徑同種子',
    /完整重現路徑：/.test(lines) && /用同一個種子（7）重新執行會走同一條路/.test(lines),
    lines.slice(0, 900));
}

// =====================================================================
console.log('\n=== A3【核心】狀態有郁 ⇒ 唔算打轉，照跑 ===');
{
  // ⚠️ 一部乜都當打轉嘅機器同一部乜都唔停嘅機器一樣冇用。
  let version = 0;
  const box = machine({
    steps: 12,
    facts: function () {
      return { hasVersion: true, latestVersionNo: version, stage: 'DRAFT',
        gridChangeCount: 0, unresolvedCount: 0,
        buttons: { review: { enabled: false }, official: { enabled: false },
          resend: { enabled: false } } };
    },
    actions: function () {
      return [{
        id: '生成初稿',
        legal: function () { return true; },
        run: function () { version++; return { ok: true }; }
      }];
    }
  });
  checkEqual('★★★★★★ 執行足 12 步'
    + '——每一步版本號都加一，係真進度，唔可以當打轉',
    box.report.ranSteps, 12);
  checkEqual('★★★★★ 冇 `spinning`', box.report.spinning, null);
}

// =====================================================================
console.log('\n=== A3 同一個動作但狀態有郁 ⇒ 一樣唔算打轉 ===');
{
  // 每 3 步先郁一次——連續 5 步「同一動作 ＋ 狀態冇變」先算。
  let n = 0;
  const box = machine({
    steps: 12,
    facts: function () {
      n++;
      return { hasVersion: true, latestVersionNo: Math.floor(n / 3), stage: 'DRAFT',
        gridChangeCount: 0, unresolvedCount: 0,
        buttons: { review: { enabled: false }, official: { enabled: false },
          resend: { enabled: false } } };
    },
    actions: function () {
      return [{ id: 'X', legal: function () { return true; },
        run: function () { return {}; } }];
    }
  });
  checkEqual('★★★★★★ 執行足 12 步——狀態每幾步就郁一次，唔係打轉',
    box.report.ranSteps, 12);
}

// =====================================================================
console.log('\n=== A3 指紋唔可以包 `gridChangeCount` ===');
{
  // ⚠️⚠️ **呢一條係整組最重要嗰一條。**
  //
  // 現場嗰個坑就係「一路寫更多亂行N」——`gridChangeCount` 每步加一。
  // 指紋包住佢嘅話，每步指紋都唔同，防打轉閘**永遠唔會 fire**，
  // 而今輪個 bug 原封不動。
  const gas = loadGasSource(FILES);
  const a = gas.monkeyStateFingerprint_({ stage: 'OFFICIAL_SENT',
    latestVersionNo: 3, unresolvedCount: 2, gridChangeCount: 10 });
  const b = gas.monkeyStateFingerprint_({ stage: 'OFFICIAL_SENT',
    latestVersionNo: 3, unresolvedCount: 2, gridChangeCount: 99 });
  checkEqual('★★★★★★ **`gridChangeCount` 唔影響指紋**'
    + '——包咗嘅話，一部一路寫更多亂行N 嘅機器每步指紋都唔同，'
    + '防打轉閘永遠唔會 fire',
    a, b);
  check('★★★★★★ 但 Stage／版本號／認唔出格數三樣都要影響指紋',
    gas.monkeyStateFingerprint_({ stage: 'DRAFT', latestVersionNo: 3, unresolvedCount: 2 }) !== a
      && gas.monkeyStateFingerprint_({ stage: 'OFFICIAL_SENT', latestVersionNo: 4, unresolvedCount: 2 }) !== a
      && gas.monkeyStateFingerprint_({ stage: 'OFFICIAL_SENT', latestVersionNo: 3, unresolvedCount: 0 }) !== a,
    a);
}

// =====================================================================
console.log('\n=== A2【核心】「寫一格認不出的名字」自己收拾 ===');
{
  const gas = loadGasSource(FILES);
  const writes = [];
  gas.log_ = function () {};
  gas.findLatestVersionNo_ = function () { return 3; };
  gas.selfTestPickCells_ = function () {
    return [{ serviceDate: '2028-07-02', postId: 'CHAIR', slotIndex: 1,
      personId: 'P1' }];
  };
  gas.indexPeopleById_ = function () {
    return { P1: { personId: 'P1', nameTC: '假甲乙' } };
  };
  gas.selfTestWriteGridCell_ = function (q, v, d, p, s, text) {
    writes.push(text); return true;
  };
  // 第七十五輪批次 CE 組：認唔出嘅名唔再擋（blockReason），改為要逐個決定（needsDecision＋names）
  gas.apiSaveAndConfirmPlan = function () {
    return { blocked: false, needsDecision: true,
      decisionItems: { names: [{ text: '一個系統認不出的名字' }], rules: [] }, message: '' };
  };

  const action = gas.monkeyActions_().filter(function (a) {
    return a.id === '寫一格認不出的名字（立即改回）';
  })[0];
  check('★★★★★★ 呢個動作存在', !!action, '');
  const result = action.run('2028T3', function () { return 0.5; });

  checkEqual('★★★★★★ **寫完立即改回原值**'
    + '——唔收拾嘅話就等於種一個坑：'
    + '下一步開始系統乜都唔准做，而亂行機會困喺入面',
    writes.join(' → '), '一個系統認不出的名字 → 假甲乙');
  checkEqual('★★★★★★ 而且驗到儲存要求逐個決定（NEEDS_NAME_DECISION）',
    result.blockReason, 'NEEDS_NAME_DECISION');
  checkEqual('★★★★★ `expect` 收貨',
    action.expect(result,
      { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 },
      { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 }),
    '');
}

// =====================================================================
console.log('\n=== A2 冇擋住 ⇒ 要報（嗰個係系統最嚴厲嗰道閘）===');
{
  const gas = loadGasSource(FILES);
  const action = gas.monkeyActions_().filter(function (a) {
    return a.id === '寫一格認不出的名字（立即改回）';
  })[0];
  const complaint = action.expect(
    { wrote: true, reverted: true, blockReason: '', cell: 'x', originalName: '假甲乙' },
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 },
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 });
  check('★★★★★★ 冇要求逐個決定 ⇒ 報'
    + '——一個認唔出嘅名靜靜噉入咗版本，'
    + '就係系統最嚴厲嗰道閘失效咗',
    /竟然沒有要求逐個決定/.test(complaint), complaint);

  const noRevert = action.expect(
    { wrote: true, reverted: false, blockReason: 'NEEDS_NAME_DECISION' },
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 },
    { stage: 'DRAFT', latestVersionNo: 3, gridChangeCount: 0, unresolvedCount: 0 });
  check('★★★★★★ 改唔返原值 ⇒ 報',
    /改不回原值/.test(noRevert), noRevert);
}

// =====================================================================
console.log('\n=== A2 權重要明顯細過一般動作 ===');
{
  const gas = loadGasSource(FILES);
  const rare = gas.monkeyActions_().filter(function (a) {
    return a.id === '寫一格認不出的名字（立即改回）';
  })[0];
  check('★★★★★★ 佢有明確權重，而且細過預設'
    + '——呢類「順手探一探」嘅動作經常做會蓋過其餘動作嘅覆蓋率。'
    + 'S16 已經有一條完整情境專門驗認唔出嘅名，呢度只係探針',
    Number(rare.weight) > 0 && Number(rare.weight) < gas.MONKEY_DEFAULT_WEIGHT,
    'weight=' + rare.weight + '　default=' + gas.MONKEY_DEFAULT_WEIGHT);
  const others = gas.monkeyActions_().filter(function (a) {
    return a.id !== '寫一格認不出的名字（立即改回）';
  });
  check('★★★★★ 其餘動作冇寫權重（用預設）'
    + '——加新動作嘅人唔使諗權重',
    others.every(function (a) { return a.weight === undefined; }),
    JSON.stringify(others.map(function (a) { return a.id + ':' + a.weight; })));
}

// =====================================================================
console.log('\n=== A2 加權揀動作：同一個種子一定行同一條路 ===');
{
  // ⚠️ 亂行機可以續跑、可以重現，全部靠呢一點。
  const gas = loadGasSource(FILES);
  const legal = [{ id: 'A' }, { id: 'B', weight: 1 }, { id: 'C' }];
  const seq = function () {
    const rnd = gas.makeMonkeyRandom_(7, 0);
    const out = [];
    for (let i = 0; i < 30; i++) out.push(gas.monkeyPickWeighted_(legal, rnd).id);
    return out.join('');
  };
  checkEqual('★★★★★★ 同一個種子，兩次揀出嚟一模一樣', seq(), seq());
  const counts = { A: 0, B: 0, C: 0 };
  const rnd = gas.makeMonkeyRandom_(11, 0);
  for (let i = 0; i < 600; i++) counts[gas.monkeyPickWeighted_(legal, rnd).id]++;
  check('★★★★★★ 而且細權重嗰個明顯少啲'
    + '——`B` 嘅權重係 1，`A`／`C` 係預設 ' + gas.MONKEY_DEFAULT_WEIGHT,
    counts.B < counts.A && counts.B < counts.C, JSON.stringify(counts));
  check('★★★★★ 但唔係零——探針要真係會撞到',
    counts.B > 0, JSON.stringify(counts));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
