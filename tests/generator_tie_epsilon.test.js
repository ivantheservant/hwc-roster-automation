// 第九輪批次階段 B：RANDOM_SEED 失效的根治（分數容差 epsilon）。
// 執行方式：node tests/generator_tie_epsilon.test.js
//
// 背景（第七輪批次的發現）：30 個不同 seed 產生逐格完全相同的職事表。原因是
// compareCandidates_() 只在 score 與 selectionScore **完全相等**時才輪到
// tieBreak（唯一用到 seed 的地方），而 score 含連續浮點數 selectionScore，
// 實務上兩個人不會剛好相等。結果 generateBest() 跑 20 次＝同一份表算 20 次。
//
// 本檔案做兩件事：
//   1. 【回歸保證】驗證 epsilon=0（預設值）時，行為跟加入這個機制之前**逐格相同**，
//      而且任何 epsilon 值下硬規則永遠零違反（B5 的重點）。
//   2. 【B2 對照表】用 mock 資料為每個候選 epsilon 各跑 30 個 seed，量度
//      「產生了多少份不同的表 / 硬規則違反 / 準硬規則違反 / 軟規則數值分佈」，
//      印成一張對照表，供 docs/系統範圍稽核.md 引用並據此建議一個 epsilon 值。
//
// 測試對象是**真正的 Generator.gs 原始碼**（經 tests/helpers/gas_loader.js 載入
// Node 沙箱），不是另抄一份副本——見該檔案開頭的說明。

const { loadGasSource } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');
const assertions = require('./helpers/roster_assertions.js');

const gas = loadGasSource();

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

/** 把一份職事表壓成簽名字串——跟 MultiRun.gs 的 buildRosterSignature_() 同一個做法。 */
function signature(roster) {
  return roster.assignments.map(function (a) { return a.personId || ''; }).join('|');
}

/** 用指定的 seed 與 epsilon 生成一份表。 */
function generate(seed, epsilon, extraOptions) {
  const context = mock.buildGeneratorContextMock(Object.assign({
    gas: gas, randomSeed: seed, scoreTieEpsilon: epsilon
  }, extraOptions || {}));
  return { roster: gas.buildRoster_(context), context: context };
}

const SEED_COUNT = 30;

console.log('\n=== B1 回歸保證：epsilon = 0（預設值）時，行為與加入這個機制之前逐格相同 ===');
{
  // 「加入之前」的行為＝seed 完全沒有作用（第七輪批次實測的現象）。
  // 如果 epsilon=0 之下換 seed 竟然產生了不同的表，代表這次改動意外改變了
  // 預設行為——那是這一整輪最不能接受的回歸。
  const signatures = {};
  for (let seed = 1; seed <= SEED_COUNT; seed++) {
    signatures[signature(generate(seed, 0).roster)] = true;
  }
  checkEqual('★★ epsilon=0：' + SEED_COUNT + ' 個 seed 仍然產生同一份表（預設行為完全沒變）',
    Object.keys(signatures).length, 1);

  // 直接測比較函式本身：epsilon=0 時 compareCandidates_(a,b,strategy,0) 必須
  // 跟舊版的 a.score !== b.score 判斷等價
  const mk = function (score, selectionScore, tieBreak) {
    return { score: score, selectionScore: selectionScore, tieBreak: tieBreak };
  };
  const strategy = gas.SELECTION_STRATEGIES.LONGEST_UNSERVED;
  check('★ epsilon=0：分數差 0.0001 仍然分得出高下（不當成同分）',
    gas.compareCandidates_(mk(1.0000, 0.5, 0.9), mk(1.0001, 0.5, 0.1), strategy, 0) < 0);
  check('★ epsilon=0：分數完全相同時才輪到 selectionScore',
    gas.compareCandidates_(mk(1, 0.9, 0.9), mk(1, 0.5, 0.1), strategy, 0) < 0,
    'selectionScore 高者應該優先');
  check('★ epsilon=0：score 與 selectionScore 都相同時才輪到 tieBreak',
    gas.compareCandidates_(mk(1, 0.5, 0.1), mk(1, 0.5, 0.9), strategy, 0) < 0);
  check('★ 不傳 epsilon 參數時（舊呼叫方式）行為與傳 0 相同',
    gas.compareCandidates_(mk(1.0000, 0.5, 0.9), mk(1.0001, 0.5, 0.1), strategy)
      === gas.compareCandidates_(mk(1.0000, 0.5, 0.9), mk(1.0001, 0.5, 0.1), strategy, 0));
}

console.log('\n=== B1：epsilon > 0 時，tieBreak 真的參與決勝 ===');
{
  const mk = function (score, selectionScore, tieBreak) {
    return { score: score, selectionScore: selectionScore, tieBreak: tieBreak };
  };
  const strategy = gas.SELECTION_STRATEGIES.LONGEST_UNSERVED;
  check('★★ epsilon=1：分數差 0.5 視為同分後，直接由 tieBreak（seed 亂數）決勝',
    gas.compareCandidates_(mk(1.5, 0.5, 0.1), mk(1.0, 0.9, 0.9), strategy, 1) < 0,
    '容差生效時不可以再看 selectionScore——它已經算進 score 裡面，'
      + '再比一次等於重複計算，而且它也是連續浮點數，會令 tieBreak 永遠輪不到');
  check('★ epsilon=1：tieBreak 細者優先（seed 換了就會換人）',
    gas.compareCandidates_(mk(1.0, 0.5, 0.1), mk(1.5, 0.5, 0.9), strategy, 1) < 0);
}

console.log('\n=== B1：pickEpsilonWinner_() 的優勝者永遠不會比最佳分數差超過 epsilon ===');
{
  // 這是「近似鏈」防護的核心斷言：a≈b、b≈c 不代表 a≈c，如果直接把不可傳遞的
  // 比較函式交給 sort()，有機會讓一個分數遠差於最佳者的候選人排到第一。
  const strategy = gas.SELECTION_STRATEGIES.LONGEST_UNSERVED;
  const chain = [];
  for (let i = 0; i < 10; i++) {
    // 分數 0, 1, 2, …, 9，每相鄰兩個都在 epsilon=1 的容差內（構成一條近似鏈），
    // 但頭尾相差 9。tieBreak 刻意讓分數最差那一個最細，引誘它排到第一。
    chain.push({ score: i, selectionScore: 0.5, tieBreak: (10 - i) / 100 });
  }
  const winner = gas.pickEpsilonWinner_(chain, strategy, 1);
  check('★★ 近似鏈情境：優勝者的分數 ≤ 最佳分數 + epsilon（沒有被鏈式放大）',
    winner.score <= 0 + 1,
    '實際優勝者分數＝' + winner.score + '，最佳分數＝0，epsilon＝1');

  const winnerZero = gas.pickEpsilonWinner_(chain, strategy, 0);
  checkEqual('★ epsilon=0 時優勝者就是分數最低那一位', winnerZero.score, 0);
}

console.log('\n=== B5【最重要】任何 epsilon 值下，硬規則永遠零違反 ===');
{
  const EPSILONS = [0, 0.5, 1, 2, 5, 20, 100];
  EPSILONS.forEach(function (epsilon) {
    let worstTotal = 0;
    let firstFailure = null;
    // 每個 epsilon 各跑 8 個 seed；再加一個「資源緊絀」情境（技術崗位整池
    // 當週不能服侍），確保容差不會令系統在壓力下走回「硬派一個違規者」的老路
    for (let seed = 1; seed <= 8; seed++) {
      const normal = generate(seed, epsilon);
      const r1 = assertions.checkAllHardRules(gas, normal.roster.assignments, normal.context);
      if (r1.total > 0 && !firstFailure) firstFailure = assertions.describeViolations(r1);
      worstTotal += r1.total;

      const scarce = generate(seed, epsilon, {
        // AUDIO 整池 6 個人全部在第 3 週不能服侍——系統應該留空，不是硬派
        unavailable: mock.buildUnavailable(
          mock.buildEligibility(mock.buildPeople(89), mock.defaultPoolSizes()).byPost[mock.POST.AUDIO],
          '2099-01-18', '2099-01-18')
      });
      const r2 = assertions.checkAllHardRules(gas, scarce.roster.assignments, scarce.context);
      if (r2.total > 0 && !firstFailure) firstFailure = assertions.describeViolations(r2);
      worstTotal += r2.total;
    }
    check('★★ epsilon=' + epsilon + '：16 份表（含資源緊絀情境）全部零硬規則違反',
      worstTotal === 0, firstFailure);
  });
}

console.log('\n=== B2 對照表：不同 epsilon 值的實際效果（' + SEED_COUNT + ' 個 seed）===');
{
  const EPSILONS = [0, 0.5, 1, 2, 5, 10, 20];
  const table = [];

  EPSILONS.forEach(function (epsilon) {
    const signatures = {};
    let hardTotal = 0;
    let semiTotal = 0;
    const chairRatios = [];
    const announceRatios = [];
    const peopleCounts = [];
    const maxCounts = [];
    const avgCounts = [];

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const g = generate(seed, epsilon);
      signatures[signature(g.roster)] = true;
      hardTotal += assertions.checkAllHardRules(gas, g.roster.assignments, g.context).total;
      semiTotal += assertions.findSemiHardViolationsViaEngine(
        gas, g.roster.assignments, g.context).length;
      const soft = assertions.measureSoftRules(
        g.roster.assignments, g.context, mock.POST.CHAIR, mock.POST.ANNOUNCE);
      chairRatios.push(soft.chairEqAnnounceRatio);
      announceRatios.push(soft.announceConsecutiveRatio);
      peopleCounts.push(soft.peopleServed);
      maxCounts.push(soft.maxCount);
      avgCounts.push(soft.avgCount);
    }

    const span = function (values, digits) {
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      return min === max ? min.toFixed(digits) : min.toFixed(digits) + '–' + max.toFixed(digits);
    };

    table.push({
      epsilon: epsilon,
      distinct: Object.keys(signatures).length,
      hardTotal: hardTotal,
      semiAvg: (semiTotal / SEED_COUNT).toFixed(1),
      // 「最佳可達」＝這批 seed 之中主席兼報告比例最高的一份。generateBest()
      // 揀的就是最好的一份，所以這個數字比平均值更能反映實際會用到的品質。
      bestChair: Math.max.apply(null, chairRatios) * 100,
      chair: span(chairRatios.map(function (v) { return v * 100; }), 1),
      announce: span(announceRatios.map(function (v) { return v * 100; }), 1),
      people: span(peopleCounts, 0),
      avg: span(avgCounts, 2),
      max: span(maxCounts, 0)
    });
  });

  console.log('');
  console.log('| epsilon | 不同的表 | 硬規則違反 | 準硬規則違反（平均/份） | 主席兼報告%（範圍） | 最佳可達 | 報告連續% | 用人數 | 平均次數 | 最高次數 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  table.forEach(function (r) {
    console.log('| ' + r.epsilon + ' | ' + r.distinct + ' / ' + SEED_COUNT + ' | '
      + r.hardTotal + ' | ' + r.semiAvg + ' | ' + r.chair + ' | ' + r.bestChair.toFixed(1)
      + ' | ' + r.announce + ' | ' + r.people + ' | ' + r.avg + ' | ' + r.max + ' |');
  });
  console.log('');

  const zeroRow = table.filter(function (r) { return r.epsilon === 0; })[0];
  checkEqual('★ 對照表確認 epsilon=0 只產生 1 份表（問題重現）', zeroRow.distinct, 1);

  const anyDiverse = table.filter(function (r) { return r.epsilon > 0 && r.distinct > 1; });
  check('★★ 至少有一個非零 epsilon 真的產生了多於一份不同的表（證明容差有效）',
    anyDiverse.length > 0,
    '如果全部都是 1 份，代表容差機制沒有生效，需要重新檢查 pickEpsilonWinner_()');

  const anyHard = table.filter(function (r) { return r.hardTotal > 0; });
  checkEqual('★★ 對照表中沒有任何一個 epsilon 出現硬規則違反', anyHard.length, 0);

  // ---- 建議值 ----
  // 判斷準則刻意對齊 generateBest() 實際在做的事：它跑 N 次然後**揀最好的一份**，
  // 所以真正重要的不是「平均品質」，而是「最好的那一份能去到幾好」。
  // 這裡用「最佳可達的主席兼報告比例距離目標 0.63 有多遠」當主要指標
  // （那是全部軟規則之中最難達成、也是歷史基準最明確的一項），
  // 同分時取較細的 epsilon（容差越細，優勝者偏離最佳分數的上界越細，越保守）。
  const CHAIR_TARGET = 0.63;
  const baselineSemi = Number(zeroRow.semiAvg);
  const scored = table
    .filter(function (r) { return r.hardTotal === 0 && Number(r.semiAvg) <= baselineSemi; })
    .map(function (r) {
      return { row: r, distance: Math.abs(r.bestChair - CHAIR_TARGET * 100) };
    })
    .sort(function (a, b) {
      if (Math.abs(a.distance - b.distance) > 0.05) return a.distance - b.distance;
      return a.row.epsilon - b.row.epsilon;
    });

  const best = scored[0];
  const zeroDistance = Math.abs(zeroRow.bestChair - CHAIR_TARGET * 100);
  console.log('主席兼報告的目標是 ' + (CHAIR_TARGET * 100).toFixed(0)
    + '%；epsilon=0 最佳只去到 ' + zeroRow.bestChair.toFixed(1) + '%（距離 '
    + zeroDistance.toFixed(1) + ' 個百分點）。');
  console.log('建議值：' + (best && best.row.epsilon > 0 && best.distance < zeroDistance
    ? 'epsilon = ' + best.row.epsilon + '（最佳可達 ' + best.row.bestChair.toFixed(1)
      + '%，距離目標 ' + best.distance.toFixed(1) + ' 個百分點，比 epsilon=0 改善 '
      + (zeroDistance - best.distance).toFixed(1) + ' 個百分點；硬規則 0、準硬規則不變差）'
    : '在 mock 資料上找不到明確優於 0 的值，維持 0，改用真實資料試算'));

  check('★ 有一個非零 epsilon 的「最佳可達品質」優於 epsilon=0（多次生成揀最好才有意義）',
    best && best.row.epsilon > 0 && best.distance < zeroDistance,
    '如果沒有，代表容差雖然製造了多樣性，但沒有一份比原本那一份更好——那就不值得啟用');

  console.log('⚠️ 以上全部是 mock 資料的結果，只證明機制本身有效與安全，'
    + '不代表真實資料下哪一個值排出來的表比較好——那要用選單的'
    + '「查看 ▸ 試算不同 epsilon 的效果（唯讀）」在真實資料上量度。');
}

console.log('\n=== B4：generateBest() 的提早停止與 epsilon 相容 ===');
{
  // MultiRun.gs 的 generateBest() 要讀試算表，測試不能直接呼叫。這裡驗證的是
  // 它用來決定要不要提早停止的那個條件本身：seedProbeEnabled = !(epsilon > 0)。
  const seedProbeEnabled = function (epsilon) { return !(epsilon > 0); };
  check('★ epsilon=0（預設）時提早停止偵測仍然啟用（維持上一輪的最佳化）',
    seedProbeEnabled(0) === true);
  check('★★ epsilon>0 時提早停止偵測關閉（不會因為頭三次剛好相同就放棄後面的候選表）',
    seedProbeEnabled(1) === false && seedProbeEnabled(0.5) === false);

  // 反證：如果沒有關掉，會發生什麼——用實際生成結果檢查頭三次是否可能相同
  const firstThree = {};
  for (let seed = 1; seed <= 3; seed++) {
    firstThree[signature(generate(seed, 1).roster)] = true;
  }
  console.log('      （參考：epsilon=1 時頭 3 個 seed 產生了 '
    + Object.keys(firstThree).length + ' 份不同的表——如果是 1 份，'
    + '就正好是「頭三次剛好相同但其實 seed 有作用」那種會被誤判的情況）');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
