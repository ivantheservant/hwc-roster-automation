// 第六十一輪批次：亂行機跑得郁，但太慢。
// 執行方式：node tests/monkey_speed.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 2028T3 上面跑得動、零失敗，但**一批 4.5 分鐘只跑得 2 步**。
// 照呢個速度，50 步要撳 25 次、超過一個鐘——冇人會跑。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 樽頸唔喺「抽動作」度
// ─────────────────────────────────────────────────────────────────────
//
// `MonkeyState` 嗰兩格係「已抽次數 10、已跑步數 2」。
// 「已抽次數」＝ `rnd.drawnCount()`，即係**用咗幾多個亂數**
//（續跑快轉果陣嗰啲都計埋），唔係「試咗幾多次先抽到一個合法動作」。
//
// 亂行機由第一日（`ccd6cc2`）開始就係**先篩後抽**：
//   const legal = actions.filter(a => a.legal(facts));
//   const picked = legal[...];
// 佢從來冇「抽完先問合法、唔合法就重抽」嗰一段。
//
// 真正嘅樽頸係**每一步都跑全套不變量**——入面有 I04
//（`RosterAssignments` 成萬行）同 I08（每條要行一次完整 plan）。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 慳時間唔可以變成唔驗
// ─────────────────────────────────────────────────────────────────────
//
// 所以呢一組每一條「慳咗」嘅斷言，旁邊都有一條「仍然驗」嘅斷言：
//
//   B　逐步跑快嗰批　⇔　每 10 步 ＋ 收尾一定跑全套
//   C　跳過慢動作　　⇔　報告開頭一定印明跳咗邊幾個
//   A　冇合法動作停手　⇔　停手一定記成失敗 ＋ 印完整路徑

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

const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'SeasonRehearsal.gs', 'QuarterReset.gs',
  'SelfTestRunner.gs', 'Invariants.gs', 'MonkeyRun.gs'];

/**
 * 跑一部亂行機，每一步嘅狀態同動作清單由測試話事。
 *
 * @param {Object} opts `{facts, actions, steps, seed, skipSlow, invariant}`
 * @returns {Object} `{gas, report, invCalls}`
 */
function machine(opts) {
  const gas = loadGasSource(FILES);
  const invCalls = [];
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.assertMonkeyDryRunStillOn_ = function () {};
  gas.writeMonkeyLog_ = function () {};
  gas.readConfig = function () { return {}; };
  gas.getConfig = function (key, dflt) {
    if (key === gas.CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS) {
      return opts.skipSlow === undefined ? true : opts.skipSlow;
    }
    return dflt;
  };
  gas.runAllInvariants_ = function (quarterId, set) {
    invCalls.push(set);
    if (opts.invariant) return opts.invariant(set, invCalls.length);
    return { results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0 };
  };
  gas.monkeyReadFacts_ = function () { return opts.facts(); };
  if (opts.actions) gas.monkeyActions_ = function () { return opts.actions(gas); };
  return { gas: gas, invCalls: invCalls,
    report: gas.runMonkey_(opts.steps || 12, opts.seed || 7, 0) };
}

/** 一部乜都合法、狀態每步都郁嘅機器（唔會撞到防打轉閘）。 */
function movingFacts() {
  let n = 0;
  return function () {
    n++;
    return { hasVersion: true, latestVersionNo: n, stage: 'DRAFT',
      gridChangeCount: 0, unresolvedCount: 0,
      buttons: { review: { enabled: true }, official: { enabled: true },
        resend: { enabled: true } } };
  };
}

// =====================================================================
console.log('\n=== 現場【核心】「已抽次數」唔係「試咗幾多次」 ===');
{
  // ⚠️ 呢一條係整組嘅前提。搞錯咗嘅話，就會去改一段本來冇問題嘅碼。
  const gas = loadGasSource(FILES);
  const rnd = gas.makeMonkeyRandom_(7, 8);
  checkEqual('★★★★★★ **快轉 8 抽之後，`drawnCount()` 已經係 8**'
    + '——所以「已抽次數 10、已跑步數 2」係「上一批用咗 8 抽 ＋ 呢批用咗 2 抽」，'
    + '唔係「試咗 10 次先抽到 2 個合法動作」',
    rnd.drawnCount(), 8);
  rnd(); rnd();
  checkEqual('★★★★★ 再抽兩次 ⇒ 10', rnd.drawnCount(), 10);

  const SRC = read('src/MonkeyRun.gs');
  check('★★★★★★ **亂行機係先篩後抽，冇「重抽」嗰段**'
    + '——`legal` 清單算好先至抽，所以唔存在「有 8 次抽咗但唔算數」',
    /const legal = actions\.filter\(/.test(SRC)
      && /monkeyPickWeighted_\(legal, rnd\)/.test(SRC), '');
  check('★★★★★ 而且抽嗰下唔會落去成張 `actions` 度抽',
    !/monkeyPickWeighted_\(actions, rnd\)/.test(SRC)
      && !/actions\[Math\.floor\(/.test(SRC), '');
}

// =====================================================================
console.log('\n=== B【核心】逐步跑快嗰批，每 10 步 ＋ 收尾跑全套 ===');
{
  const box = machine({ steps: 12, facts: movingFacts(),
    actions: function () {
      return [{ id: 'X', legal: function () { return true; },
        run: function () { return {}; } }];
    } });
  const gas = box.gas;
  const sets = box.invCalls;

  checkEqual('★★★★★★ 跑足 12 步', box.report.ranSteps, 12);
  checkEqual('★★★★★★ **逐步嗰批係 `PER_SCENARIO`（快嗰四條）**'
    + '——之前每步都跑 `ALL`，入面有 I04（成萬行）同 I08（每條行一次完整 plan）',
    sets.slice(0, 9).filter(function (s) {
      return s === gas.INVARIANT_SET.PER_SCENARIO;
    }).length, 9);
  checkEqual('★★★★★★ **第 10 步跑全套**——慳時間唔可以變成唔跑全套',
    sets[9], gas.INVARIANT_SET.ALL);
  checkEqual('★★★★★★ **第 12 步（最後一步）都跑全套**',
    sets[11], gas.INVARIANT_SET.ALL);
  checkEqual('★★★★★ 全套一共跑咗 2 次', box.report.fullSweepCount, 2);
  checkEqual('★★★★★ 最後一步本身已經係全套 ⇒ 唔使再補跑',
    box.report.tailSweepStep, 0);
  checkEqual('★★★★★ 12 步只叫咗 12 次不變量（唔會又快又全咁叫兩次）',
    sets.length, 12);
}

// =====================================================================
console.log('\n=== B【核心】中途 break ⇒ 收尾一定補跑一次全套 ===');
{
  // ⚠️ 迴圈會因為時間到／原地打轉／冇合法動作而中途 break。
  // 省咗收尾嗰一次，最尾嗰段改動就冇任何一次全套驗過。
  let n = 0;
  const box = machine({ steps: 50, facts: function () {
    n++;
    // 頭 3 步狀態有郁；之後凍結 ⇒ 第 7 步撞到防打轉閘。
    return { hasVersion: true, latestVersionNo: n < 4 ? n : 3, stage: 'DRAFT',
      gridChangeCount: 0, unresolvedCount: 0,
      buttons: { review: { enabled: false }, official: { enabled: false },
        resend: { enabled: false } } };
  }, actions: function () {
    return [{ id: 'X', legal: function () { return true; },
      run: function () { return {}; } }];
  } });
  const gas = box.gas;

  check('★★★★★★ 的確係中途停咗（防打轉閘）',
    !!box.report.spinning && box.report.ranSteps < 10,
    '跑咗 ' + box.report.ranSteps + ' 步');
  check('★★★★★★ **收尾補跑咗一次全套**'
    + '——冇呢一次嘅話，最尾嗰幾步改到嘅嘢一次全套都冇驗過',
    box.report.tailSweepStep === box.report.ranSteps
      && box.invCalls[box.invCalls.length - 1] === gas.INVARIANT_SET.ALL,
    'tailSweepStep=' + box.report.tailSweepStep
      + '　ranSteps=' + box.report.ranSteps
      + '　最後一次=' + box.invCalls[box.invCalls.length - 1]);
  checkEqual('★★★★★ 全套一共跑咗 1 次', box.report.fullSweepCount, 1);
}

// =====================================================================
console.log('\n=== B 只喺全套嗰次先驗到嘅失敗，要講明 ===');
{
  // ⚠️ 一條只喺全套先驗到嘅不變量紅咗，代表佢係喺前面某幾步之內壞嘅，
  // 唔一定係呢一步——唔講明嘅話會揾錯方向。
  const box = machine({ steps: 10, facts: movingFacts(),
    actions: function () {
      return [{ id: 'X', legal: function () { return true; },
        run: function () { return {}; } }];
    },
    invariant: function (set) {
      if (set === 'ALL') {
        return { results: [{ id: 'I04', label: '沒有重複的格',
          status: 'FAILED', expected: '0', actual: '3', evidence: '證據' }] };
      }
      return { results: [] };
    } });
  const f = (box.report.failures || [])[0];
  check('★★★★★★ 記低咗，而且標住係全套嗰一次驗到',
    f && f.kind === '不變量 I04' && f.sweep === '全套',
    JSON.stringify(box.report.failures));
  const lines = box.gas.describeMonkeyReport_(box.report).join('\n');
  check('★★★★★★ 報告講明「可能是前面幾步之內壞的」'
    + '——唔講嘅話，人會淨係盯住第 10 步嗰個動作',
    /可能是前面幾步之內壞的/.test(lines), lines.slice(0, 800));
  check('★★★★★ 而且照樣印完整重現路徑',
    /走到這裡的完整步驟：/.test(lines), lines.slice(0, 800));
}

// =====================================================================
console.log('\n=== C【核心】慢動作：跳得，但一定要講 ===');
{
  const gas = loadGasSource(FILES);
  const slow = gas.monkeyActions_().filter(function (a) { return !!a.slow; });
  checkEqual('★★★★★★ 有標住慢動作，而且係「正式發出給全體（模擬）」'
    + '——佢要逐個收件人砌信同查個人 PDF',
    slow.map(function (a) { return a.id; }).join('、'), '正式發出給全體（模擬）');

  const on = machine({ steps: 1, skipSlow: true, facts: movingFacts() });
  const off = machine({ steps: 1, skipSlow: false, facts: movingFacts() });
  check('★★★★★★ 開關 TRUE ⇒ 真係篩走咗',
    on.report.skipSlow === true && on.report.skippedSlow.length === 1,
    JSON.stringify(on.report.skippedSlow));
  checkEqual('★★★★★★ **開關 FALSE ⇒ 唔篩走**'
    + '——Ivan 明確講過之後要改得返，所以唔可以寫死或者刪走嗰個動作',
    off.report.skipSlow, false);

  const lines = on.gas.describeMonkeyReport_(on.report).join('\n');
  check('★★★★★★ **報告開頭印明跳咗邊幾個**'
    + '——一份「跑咗 50 步、零失敗」而冇講跳過乜嘅報告，'
    + '會令人以為嗰條路驗過',
    /已跳過的慢動作：正式發出給全體（模擬）（MONKEY_SKIP_SLOW_ACTIONS=TRUE）/
      .test(lines), lines.slice(0, 900));
  check('★★★★★★ 而且講埋連帶後果'
    + '——Stage 上唔到「已正式發出」⇒「改動後重發」亦都抽唔到',
    /改動後重發（只算，不寄）」這一步也不會被抽到/.test(lines),
    lines.slice(0, 900));
  check('★★★★★ 亦都講埋點樣改返',
    /改成 FALSE/.test(lines), lines.slice(0, 900));
  check('★★★★★ 開關 FALSE 嗰陣講一句「這一批會慢很多」',
    /慢動作沒有跳過/.test(off.gas.describeMonkeyReport_(off.report).join('\n')), '');
}

// =====================================================================
console.log('\n=== C 開關要係真 Config，唔可以寫死 ===');
{
  const gas = loadGasSource(FILES);
  const SRC = read('src/MonkeyRun.gs');
  check('★★★★★★ `CONFIG_KEYS` 有登記',
    gas.CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS === 'MONKEY_SKIP_SLOW_ACTIONS', '');
  check('★★★★★★ **真係經 `getConfig()` 讀，唔係寫死**',
    /getConfig\(CONFIG_KEYS\.MONKEY_SKIP_SLOW_ACTIONS, true\) === true/.test(SRC), '');
  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ `ConfigSeed.gs` 有 row，型別 BOOL、預設 TRUE',
    /MONKEY_SKIP_SLOW_ACTIONS, type: CONFIG_TYPES\.BOOL/.test(seed)
      && /MONKEY_SKIP_SLOW_ACTIONS[\s\S]{0,200}defaultValue: 'TRUE'/.test(seed), '');
  check('★★★★★★ 說明講明「S08 已完整驗過，不會漏測」同「想它也一起亂行，就改 FALSE」',
    /S08/.test(seed) && /改 FALSE/.test(seed), '');
  check('★★★★★★ **而且嗰個動作仲喺清單入面**（只係篩走，冇刪）'
    + '——刪走咗嘅話，兩個月之後冇人記得亂行機本來行過嗰條路',
    gas.monkeyActions_().some(function (a) {
      return a.id === '正式發出給全體（模擬）';
    }), '');
}

// =====================================================================
console.log('\n=== A【核心】冇一個動作合法 ⇒ 乾淨停手，但唔可以靜靜停 ===');
{
  const box = machine({ steps: 20, facts: function () {
    return { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, unresolvedCount: 0,
      buttons: { review: { enabled: false }, official: { enabled: false },
        resend: { enabled: false } } };
  }, actions: function () {
    return [{ id: '只喺有版本先做得', legal: function (f) { return f.hasVersion; },
      run: function () { return {}; } }];
  } });

  checkEqual('★★★★★★ 第一步就停', box.report.ranSteps, 1);
  check('★★★★★★ **記成一項失敗**'
    + '——舊寫法只係靜靜 break，報告會寫「跑了 1 / 20 步，0 項失敗」，'
    + '而冇人知道點解得 1 步',
    (box.report.failures || []).some(function (f) {
      return f.kind === '這個狀態下沒有任何合法動作';
    }), JSON.stringify(box.report.failures));
  check('★★★★★★ 而且帶住 `noLegalAction`，講得出停喺邊個狀態',
    box.report.noLegalAction
      && box.report.noLegalAction.state === 'DRAFT|-1|0'
      && box.report.noLegalAction.actionCount === 1,
    JSON.stringify(box.report.noLegalAction));

  const lines = box.gas.describeMonkeyReport_(box.report).join('\n');
  check('★★★★★★ 報告最頂大聲講',
    /⛔ 這個狀態下沒有任何合法動作，已乾淨停手。/.test(lines), lines.slice(0, 800));
  check('★★★★★★ **而且印完整重現路徑同種子**',
    /完整重現路徑：/.test(lines) && /用同一個種子（7）重跑會走同一條路/.test(lines),
    lines.slice(0, 800));
}

// =====================================================================
console.log('\n=== A 有得揀嗰陣唔可以誤報「冇合法動作」 ===');
{
  // ⚠️ 一部乜都當「冇得揀」嘅機器同一部乜都唔停嘅機器一樣冇用。
  const box = machine({ steps: 5, facts: movingFacts(),
    actions: function () {
      return [{ id: 'X', legal: function () { return true; },
        run: function () { return {}; } }];
    } });
  checkEqual('★★★★★★ 跑足 5 步', box.report.ranSteps, 5);
  checkEqual('★★★★★ 冇 `noLegalAction`', box.report.noLegalAction, null);
}

// =====================================================================
console.log('\n=== D【核心】報告要講得出時間去咗邊 ===');
{
  const gas = loadGasSource(FILES);
  const line = gas.monkeyDescribeSpeed_({
    ranSteps: 2, totalMs: 270000, actionMs: 40000, invariantMs: 225000,
    firstStepNo: 8, lastStepNo: 9
  });
  // ⚠️ 第六十二輪批次 B3 組：多咗「（第 X – Y 步）」，而且時間
  // 超過一分鐘就寫「M 分 S 秒」——`270.0 秒` 讀落要自己心算。
  checkEqual('★★★★★★ **一行講齊：幾多步／邊幾步／幾多秒／每步幾多秒／'
    + '動作同不變量各佔幾多**'
    + '——冇呢一行嘅話，「一批 4.5 分鐘得 2 步」每次都要重新估樽頸喺邊',
    line,
    '這一批：跑了 2 步（第 8 – 9 步）／用了 4 分 30 秒／平均每步 135 秒'
      + '（動作 40.0 秒／不變量 3 分 45 秒）');
  check('★★★★★ 零步都唔會爆（除零）',
    /平均每步 —/.test(gas.monkeyDescribeSpeed_(
      { ranSteps: 0, totalMs: 0, actionMs: 0, invariantMs: 0 })), '');

  const box = machine({ steps: 3, facts: movingFacts(),
    actions: function () {
      return [{ id: 'X', legal: function () { return true; },
        run: function () { return {}; } }];
    } });
  check('★★★★★★ 真跑一次，三個數都量到（唔係寫死 0）',
    typeof box.report.totalMs === 'number'
      && typeof box.report.actionMs === 'number'
      && typeof box.report.invariantMs === 'number'
      && box.report.totalMs >= box.report.actionMs,
    JSON.stringify({ totalMs: box.report.totalMs, actionMs: box.report.actionMs,
      invariantMs: box.report.invariantMs }));
  const lines = box.gas.describeMonkeyReport_(box.report).join('\n');
  check('★★★★★★ 而且真係印咗出嚟',
    /這一批：跑了 3 步（第 1 – 3 步）／用了 /.test(lines),
    lines.slice(0, 500));
  check('★★★★★★ 逐步同全套要分開講'
    + '——「跑了 50 步」唔等於「驗了 50 次全套」',
    /不變量：逐步跑快的那批（/.test(lines) && /全套跑了 /.test(lines),
    lines.slice(0, 700));
  check('★★★★★ 快嗰批嘅 id 由真正跑過嗰次攞返，唔係另寫一份清單',
    /fastInvariantIds = inv\.results\.map/.test(read('src/MonkeyRun.gs')), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
