// 第十輪批次階段 C：epsilon 試算工具嘅「建議值」判斷邏輯。
// 執行方式：node tests/epsilon_recommendation.test.js
//
// 背景：上一輪加咗「試算不同 epsilon 的效果（唯讀）」，但輸出係一堆指標，
// 要幹事自己睇住去判斷用邊個值。Ivan 唔熟程式，睇住 50 行數字係做唔到決定嘅。
// 本輪把判斷邏輯搬入程式（recommendEpsilon_()），輸出一句「建議值：X，理由：……」。
//
// 呢份測試就係鎖住嗰個判斷邏輯——佢係一個純函式，餵假嘅試算結果入去，
// 斷言佢揀啱值同埋講得出理由。測試對象係真正嘅 EpsilonTrial.gs 原始碼。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs',
  'FineTune.gs', 'Debug.gs', 'Tune.gs', 'Verify.gs', 'MultiRun.gs', 'EpsilonTrial.gs'
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

/** 造一個試算結果。deviationMin 係「最好嗰份嘅總偏差」，越細越好。 */
function trial(epsilon, opts) {
  const o = opts || {};
  return {
    epsilon: epsilon,
    seedCount: o.seedCount === undefined ? 10 : o.seedCount,
    distinctRosters: o.distinct === undefined ? (epsilon > 0 ? 10 : 1) : o.distinct,
    hardViolationTotal: o.hard || 0,
    worstHardViolations: o.hard ? 1 : 0,
    deviation: { min: o.deviationMin, max: o.deviationMin + 0.5, mean: o.deviationMin + 0.2, spread: 0.5 },
    semiHardWarnings: { min: o.semiMin === undefined ? 0 : o.semiMin, max: 2, mean: 1, spread: 2 },
    chairEq: { min: 0.3, max: 0.5, mean: 0.4, spread: 0.2 },
    announce: { min: 0.25, max: 0.4, mean: 0.3, spread: 0.15 },
    peopleCount: { min: 55, max: 61, mean: 58, spread: 6 },
    average: { min: 3.0, max: 3.4, mean: 3.2, spread: 0.4 },
    maxCount: { min: 7, max: 7, mean: 7, spread: 0 },
    chiSquare: { min: 10, max: 20, mean: 15, spread: 10 },
    records: []
  };
}

const BONUS = 50; // SCORE_PREFERENCE_BONUS 預設值

console.log('\n=== C2：有明顯改善時，要揀得出邊個值 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(1, { deviationMin: 0.9 }),
    trial(5, { deviationMin: 0.5 }),   // 最好
    trial(10, { deviationMin: 0.6 })
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★★ 揀到總偏差最細嗰個（epsilon = 5）', rec.value, 5);
  check('★ 理由有講出實際數字（唔係空泛講「比較好」）',
    rec.reason.indexOf('0.5000') !== -1 && rec.reason.indexOf('1.0000') !== -1,
    rec.reason);
  check('★ 理由有講出改善幅度', /改善 \d+\.\d%/.test(rec.reason), rec.reason);
  check('★ 有記低改善比率供程式判斷', Math.abs(rec.improvementRatio - 0.5) < 1e-9);
}

console.log('\n=== C2：改善太少就唔值得改設定，一律建議維持 0 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(1, { deviationMin: 0.99 }),   // 只改善 1%
    trial(5, { deviationMin: 0.98 })    // 只改善 2%
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★★ 改善低於門檻 → 建議維持 0', rec.value, 0);
  check('★ 理由有明確講「唔值得改」而唔係含糊帶過',
    /不划算|低於.*門檻/.test(rec.reason), rec.reason);
  check('★ 仍然有講出最好嗰個非零值係邊個（資訊唔會消失）',
    rec.reason.indexOf('5') !== -1, rec.reason);
}

console.log('\n=== C2【安全】有硬規則違反嘅值一律出局，冇得商量 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(5, { deviationMin: 0.1, hard: 3 }),  // 偏差最細，但有硬規則違反
    trial(2, { deviationMin: 0.8 })
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  check('★★ 有硬規則違反嗰個絕對唔會被建議，即使佢偏差最細', rec.value !== 5,
    '建議咗 ' + rec.value + '，但 epsilon=5 有 3 項硬規則違反');
  checkEqual('★ 改為建議次好而且乾淨嗰個（epsilon = 2）', rec.value, 2);
  check('★★ 有硬規則違反時一定要出警告', rec.warnings.length > 0);
  check('★ 警告有指名邊個值出事', rec.warnings[0].indexOf('5') !== -1, rec.warnings[0]);
}

console.log('\n=== C2：準硬規則變差嘅值唔會被建議 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0, semiMin: 0 }),
    trial(5, { deviationMin: 0.3, semiMin: 4 }),  // 偏差好咗，但連續兩週多咗
    trial(2, { deviationMin: 0.7, semiMin: 0 })
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★★ 準硬規則比現狀差嗰個唔會被揀，改揀 epsilon = 2', rec.value, 2);
}

console.log('\n=== C2：冇多樣性（只排到同一份表）嘅值唔算數 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(0.5, { deviationMin: 0.2, distinct: 1 }),  // 偏差細但只有 1 種表＝其實冇生效
    trial(5, { deviationMin: 0.6, distinct: 10 })
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★★ 只排到 1 種表嘅值等於冇效果，唔會被建議', rec.value, 5);
}

console.log('\n=== C2：同分時揀較細（較保守）嗰個 epsilon ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(2, { deviationMin: 0.5 }),
    trial(10, { deviationMin: 0.5 })  // 一樣好
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★★ 兩個一樣好時揀細嗰個（容差越細，偏離最佳分數嘅上界越細）',
    rec.value, 2);
}

console.log('\n=== C2：epsilon 大到接近獎勵分量級要出提醒 ===');
{
  const trials = [
    trial(0, { deviationMin: 1.0 }),
    trial(30, { deviationMin: 0.4 })   // 30 >= 50/2
  ];
  const rec = gas.recommendEpsilon_(trials, BONUS);

  checkEqual('★ 仍然建議得出嚟（數據上真係好啲）', rec.value, 30);
  check('★★ 但要提醒佢會蓋過軟規則偏好', rec.warnings.length > 0
    && /獎勵分量級/.test(rec.warnings.join('')),
    JSON.stringify(rec.warnings));
  check('★ 提醒有叫幹事去核對次數分佈', /平均次數|最高次數/.test(rec.warnings.join('')));
}

console.log('\n=== C2：邊界情況 ===');
{
  const noBaseline = gas.recommendEpsilon_([trial(1, { deviationMin: 0.5 })], BONUS);
  checkEqual('★ 冇 epsilon=0 嗰組時唔會亂建議', noBaseline.value, 0);
  check('★ 而且會叫幹事加返 0 落去重跑', /加入 0|epsilon = 0/.test(noBaseline.reason),
    noBaseline.reason);

  const onlyZero = gas.recommendEpsilon_([trial(0, { deviationMin: 1.0 })], BONUS);
  checkEqual('★ 只試咗 0 一個值 → 維持 0', onlyZero.value, 0);
  check('★ 唔會拋錯', true);
}

console.log('\n=== C3：總量把關——唔會跑到一半撞正 6 分鐘上限 ===');
{
  check('★ 有定義單次上限常數', typeof gas.EPSILON_TRIAL_MAX_TOTAL_ROSTERS === 'number');
  check('★★ 預設設定（' + gas.EPSILON_TRIAL_DEFAULT_VALUES.length + ' 個值 × '
    + gas.EPSILON_TRIAL_DEFAULT_SEEDS + ' 個 seed）喺上限之內',
    gas.EPSILON_TRIAL_DEFAULT_VALUES.length * gas.EPSILON_TRIAL_DEFAULT_SEEDS
      <= gas.EPSILON_TRIAL_MAX_TOTAL_ROSTERS,
    '預設就超上限嘅話，工具開箱即用唔到');

  // 實測（89 人／13 週／18 個崗位欄）每份約 18 毫秒（Node）；
  // Apps Script 保守估 15–25 倍即每份 0.27–0.45 秒。
  const GAS_SECONDS_PER_ROSTER = 0.45;
  const worstCase = gas.EPSILON_TRIAL_MAX_TOTAL_ROSTERS * GAS_SECONDS_PER_ROSTER;
  check('★★ 即使跑到上限，最壞情況仍然喺 6 分鐘之內（' + worstCase.toFixed(0) + ' 秒）',
    worstCase < 360,
    '上限 ' + gas.EPSILON_TRIAL_MAX_TOTAL_ROSTERS + ' 份 × ' + GAS_SECONDS_PER_ROSTER
      + ' 秒 = ' + worstCase.toFixed(0) + ' 秒，超出 360 秒上限');

  const defaultSeconds = gas.EPSILON_TRIAL_DEFAULT_VALUES.length
    * gas.EPSILON_TRIAL_DEFAULT_SEEDS * GAS_SECONDS_PER_ROSTER;
  console.log('      預設設定最壞情況約 ' + defaultSeconds.toFixed(0) + ' 秒');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
