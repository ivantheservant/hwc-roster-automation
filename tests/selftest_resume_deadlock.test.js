// 第五十輪批次 A／B／D 組：自測機續跑死鎖。
// 執行方式：node tests/selftest_resume_deadlock.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場：Ivan 撳咗三次，三次報告一模一樣
// ═════════════════════════════════════════════════════════════════════
//
// 第一次「跑自測」：
//
//     自測機：15 個情境，0 綠 2 紅 13 未跑
//     🔴 S01 …　🔴 S02 …
//     ⚪ S03 （上一次執行時間到，已停低）
//     … S04–S15 全部「未跑」
//     ⚠️ 執行時間到，已經乾淨停低。
//     　 撳「測試工具 ▸ ▶️ 繼續跑自測」由停低的地方接住。
//
// 第二次「繼續跑自測」：**S01、S02 又跑咗一次**，S03–S15 仍然全部「未跑」。
// 第三次：同第二次一字不差。
//
// ⇒ **自測機永遠到唔到 S03。撳一百次都一樣。**
//
// ─────────────────────────────────────────────────────────────────────
// 成因：一個結構性死鎖
// ─────────────────────────────────────────────────────────────────────
//
//     if (resume && previous && previous.status === PASSED) { 跳過 }
//
// **只有 `PASSED` 先跳過。** S01／S02 係 `FAILED`，所以每次續跑都重新執行。
// 而每個情境跑完要跑一次全套不變量（好貴），兩個情境就食光時間預算。
//
// ⚠️ 即係：**任何一個早期情境一旦紅咗，後面所有情境永遠跑唔到。**
// 而自測機成個價值，就係要跑到後面嗰啲。
//
// 一部只跑得到頭兩個情境嘅自測機，價值唔係 2/15，係 0。

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
const SRC = read('src/SelfTestRunner.gs');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SeasonRehearsal.gs', 'QuarterReset.gs', 'Invariants.gs', 'SelfTestRunner.gs'
]);

// =====================================================================
console.log('\n=== A1【核心】續跑要跳過「已經有結論」嘅，唔係只跳過通過嘅 ===');
{
  // ⚠️ 呢一條就係整個死鎖。
  // ⚠️ 唔可以淨係搵「有冇提到 FAILED」——`(false && previous.status === FAILED)`
  // 一樣會中。要驗**佢真係一個 `||` 分支**，前面冇嘢關住佢。
  // verify-red 嗰陣就係噉捉到。
  const settledBlock = CODE.slice(CODE.indexOf('const settled = previous && ('),
    CODE.indexOf('if (resume && settled)'));
  check('★★★★★★ 跳過條件包埋 `FAILED` 同 `ERROR`'
    + '——只跳過 `PASSED` 嘅話，任何一個早期情境紅咗，'
    + '後面十三個永遠跑唔到',
    /\|\| previous\.status === SELFTEST_STATUS\.FAILED\s*$/m.test(settledBlock)
      && /\|\| previous\.status === SELFTEST_STATUS\.ERROR\s*$/m.test(settledBlock),
    settledBlock);

  // ⚠️ 跳過嘅時候要照樣顯示上一次嗰個結論，唔可以扮成通過或者未跑。
  check('★★★★★★ 跳過嗰陣用**上一次嗰個 status**，唔係寫死 `PASSED`'
    + '——寫死 `PASSED` 就係講大話：一個紅色情境會變成綠',
    /status: previous\.status,/.test(CODE), '');
  check('★★★★★★ 而且帶返上一次嗰幾條失敗斷言'
    + '——冇證據嘅「紅」等於冇報告過',
    /failedChecks: previous\.failedChecks \|\| \[\]/.test(CODE), '');
  check('★★★★★ 註記講明「上一次已經有結論」',
    /上一次已經有結論/.test(SRC), '');

  // ── 證據要真係寫得入、讀得返 ────────────────────────────────
  check('★★★★★★ `SelfTestState` 有一欄記證據',
    /證據（JSON）/.test(SRC) || /'證據（JSON）'/.test(SRC), '');
  check('★★★★★ 讀返嗰陣 parse 唔到都唔會令續跑爆',
    /catch \(err\) \{[\s\S]{0,200}SelfTestState 的證據欄讀不回來/.test(SRC), '');
}

// =====================================================================
console.log('\n=== A2【核心】只重跑紅色情境 ===');
{
  const clear = gas.clearFailedSelfTestState_;
  const state = {
    S01: { id: 'S01', status: 'PASSED' },
    S02: { id: 'S02', status: 'FAILED' },
    S03: { id: 'S03', status: 'ERROR' },
    S04: { id: 'S04', status: 'SKIPPED' },
    S05: { id: 'S05', status: 'NOT_RUN' }
  };
  const out = clear(state);
  checkEqual('★★★★★★ 紅嗰兩個（FAILED／ERROR）被清走，下一次會重跑',
    out.clearedIds.sort().join(','), 'S02,S03');
  checkEqual('★★★★★ 綠嗰個保留（唔使再跑一次）',
    !!out.state.S01, true);
  checkEqual('★★★★★ 跳過嗰個保留', !!out.state.S04, true);
  checkEqual('★★★★★★ **未跑嗰個保留**'
    + '——佢本來就會跑，唔使清；清咗都係一樣，但保留先講得清楚'
    + '「呢個入口只掂紅色嗰幾個」',
    !!out.state.S05, true);
  checkEqual('★★★★★ 紅嗰兩個真係唔喺 state 入面',
    (out.state.S02 === undefined && out.state.S03 === undefined), true);

  // ⚠️ 唔准重設沙盒季度。
  const entry = CODE.slice(CODE.indexOf('function runSelfTestRerunFailedFromMenu_('),
    CODE.indexOf('function selfTestMenuEntry_('));
  check('★★★★★★ 「只重跑紅色情境」行 resume 模式（`true`），'
    + '**唔會**重設沙盒季度'
    + '——呢個入口嘅意思就係「保留現場，只重跑嗰幾個」',
    /selfTestMenuEntry_\(true, '▶️ 只重跑紅色情境', true\)/.test(entry), entry);
  check('★★★★★ 選單有呢一項',
    /runSelfTestRerunFailedFromMenu_/.test(read('src/Menu.gs')), '');
}

// =====================================================================
console.log('\n=== A3【核心】報告最尾要講得出下一步撳邊一粒 ===');
{
  // ⚠️ 以前三種情況都印同一句「撳『繼續跑自測』」，
  // 而其中一種撳咗係冇用嘅。Ivan 就係照住嗰一句撳咗三次。
  const base = {
    blocked: false, quarterId: '2028T3', resetSummary: '已清乾淨',
    totalMs: 252000, scenarioMs: 90000, invariantMs: 162000,
    finalInvariants: null
  };

  const stillNotRun = gas.describeSelfTestReport_(Object.assign({}, base, {
    results: [{ id: 'S03', title: 'x', status: 'NOT_RUN', failedChecks: [] }],
    passedCount: 0, failedCount: 0, errorCount: 0, notRunCount: 13,
    stoppedForTime: true
  })).join('\n');
  check('★★★★★★ 仲有「未跑」 ⇒ 叫佢撳〔繼續跑自測〕',
    /繼續跑自測/.test(stillNotRun) && !/只重跑紅色情境/.test(stillNotRun),
    stillNotRun.slice(-400));

  const allRanSomeRed = gas.describeSelfTestReport_(Object.assign({}, base, {
    results: [{ id: 'S01', title: 'x', status: 'FAILED', failedChecks: [] }],
    passedCount: 12, failedCount: 3, errorCount: 0, notRunCount: 0,
    stoppedForTime: false
  })).join('\n');
  check('★★★★★★ 冇「未跑」但有紅 ⇒ 叫佢撳〔只重跑紅色情境〕'
    + '——撳「繼續跑自測」係冇用嘅，而 Ivan 就係照住嗰一句白撳咗三次',
    /只重跑紅色情境/.test(allRanSomeRed)
      && !/由停下來的地方接住/.test(allRanSomeRed),
    allRanSomeRed.slice(-400));

  const allGreen = gas.describeSelfTestReport_(Object.assign({}, base, {
    results: [{ id: 'S01', title: 'x', status: 'PASSED', failedChecks: [] }],
    passedCount: 15, failedCount: 0, errorCount: 0, notRunCount: 0,
    stoppedForTime: false
  })).join('\n');
  check('★★★★★ 全綠 ⇒ 「全部通過」',
    /全部通過/.test(allGreen), allGreen.slice(-300));
}

// =====================================================================
console.log('\n=== B3【核心】時間要講得出用喺邊 ===');
{
  const lines = gas.describeSelfTestReport_({
    blocked: false, quarterId: '2028T3', resetSummary: '已清乾淨',
    results: [], passedCount: 0, failedCount: 0, errorCount: 0, notRunCount: 0,
    stoppedForTime: false, finalInvariants: null,
    totalMs: 252000, scenarioMs: 90000, invariantMs: 162000
  }).join('\n');
  check('★★★★★★ 報告有一行講「用咗幾耐、情境幾耐、不變量幾耐」'
    + '——冇呢一行，下次再卡住又要由零查一次',
    /時間：用了 4 分 12 秒（情境 1 分 30 秒／不變量 2 分 42 秒）/.test(lines),
    lines);
  checkEqual('★★★★★ 少過一分鐘就只講秒',
    gas.describeSelfTestDuration_(42000), '42 秒');
}

// =====================================================================
console.log('\n=== B1【核心】不變量分快／慢兩批 ===');
{
  check('★★★★★★ 每個情境只跑快嗰批',
    /runAllInvariants_\(quarterId, INVARIANT_SET\.PER_SCENARIO\)/.test(CODE), '');
  check('★★★★★★ 貴嗰批留到全部跑完先一次過跑',
    /runAllInvariants_\(quarterId, INVARIANT_SET\.FINAL\)/.test(CODE), '');
  check('★★★★★★ 仲有情境未跑嗰陣**唔跑**貴嗰批'
    + '——跑埋只會食埋下一次續跑嘅時間預算',
    /if \(!stoppedForTime\) \{[\s\S]{0,300}INVARIANT_SET\.FINAL/.test(CODE), '');
  check('★★★★★ 報告分兩節',
    /全部跑完之後的整體不變量/.test(SRC), '');
}

// =====================================================================
console.log('\n=== D1／D2【核心】S01 只喺全新開跑時有意義 ===');
{
  // ⚠️ 現場：第二、三次續跑嘅 S01 報三條「失敗」，
  // 而嗰三條全部係自測機自己嘅問題——S02 已經生成咗 v0，
  // 所以 v0 存在、生成掣變灰、審閱掣變亮。系統嘅行為完全正確。
  const registry = CODE.slice(CODE.indexOf('function selfTestScenarios_('));
  check('★★★★★★ S01 宣告咗 `requiresFreshQuarter`',
    /\{ id: 'S01'[\s\S]{0,200}requiresFreshQuarter: true \}/.test(registry), '');
  // ⚠️ 一樣：唔可以淨係搵嗰句 `push`——`if (false) {` 之後佢仲喺度。
  // 要驗**個判斷本身仲喺度**。
  check('★★★★★★ 季度唔乾淨 ⇒ 標成 `SKIPPED`（**唔係紅**）'
    + '——嗰三條紅係自測機自己嘅問題，唔係系統嘅問題',
    /if \(scenario\.requiresFreshQuarter\) \{/.test(CODE)
      && /status: SELFTEST_STATUS\.SKIPPED, checks: \[\], failedChecks: \[\]/.test(CODE),
    '');
  check('★★★★★ 而且講明點解',
    /這一個只在全新開跑時有意義/.test(SRC), '');

  // ── D2：直接查，唔可以用 flag 記住 ──────────────────────────
  check('★★★★★★ 「乾唔乾淨」係**直接查**（有冇版本／有冇派工），'
    + '唔係用一個 flag 記住「今次有冇重設過」'
    + '——記住嘅嘢會同真實狀態分岔，而且「重設過」同'
    + '「而家係全新」根本唔係同一件事',
    /function isSelfTestQuarterFresh_\(quarterId\) \{[\s\S]{0,600}findLatestVersionNo\(quarterId\)[\s\S]{0,600}SHEETS\.ROSTER_ASSIGNMENTS/
      .test(CODE), '');
  check('★★★★★★ 查唔到狀態 ⇒ **當成唔乾淨**，唔可以當成全新'
    + '——當成全新就會喺一個唔知咩狀態嘅季度上面'
    + '跑一個假設佢全新嘅情境',
    /fresh: false, reason: '查不到這一季的狀態：/.test(SRC), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
