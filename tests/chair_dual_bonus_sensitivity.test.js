// 第十八輪批次階段 B：`CHAIR_DUAL_BONUS` 到底有冇生效。
// 執行方式：node tests/chair_dual_bonus_sensitivity.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 查到嘅真相（先攞證據，後落結論——第十五輪嘅教訓）
// ─────────────────────────────────────────────────────────────────────
//
// 現象：參數掃描 12 組，同一個 WEIGHT_HISTORICAL 之下，CHAIR_DUAL_BONUS
// 由 30 加到 75，六項指標四位小數完全一樣。
//
// **結論：參數本身有生效，只係舊 grid `[30,45,60,75]` 全部落喺飽和區。**
//
// 實測（13 週 × 60 人 fixture，同一個 seed）：
//   0–10  → 冇效果（加分太細，壓唔過選人分數差距）
//   15    → 有分別
//   20    → 有分別
//   25    → 有分別
//   30 之後（30／45／60／75／150／500）→ **完全飽和，一格都唔會變**
//
// 機制：`score = penalty − bonus − selectionScore × selectionWeight`。
// 呢個 bonus 係固定加分，一旦大過候選人之間
// `selectionScore × selectionWeight` 嘅最大差距，全部雙重合資格嘅人
// 已經穩定排喺前面，再加大改變唔到次序——**門檻型參數，唔係連續型**。
//
// 所以呢個測試檔嘅斷言係對應「查到嘅真相」：
//   • 細值範圍內（0 → 20）**一定要有分別**——證明參數真係有接駁
//   • 大值範圍內（30 → 500）**一定完全冇分別**——鎖住飽和呢個事實
//   • 新 grid 一定要覆蓋到敏感區

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');

// Tune.gs：`buildTuneSaturationNotes_()`（純函式）同 `TUNE_GRID` 住喺嗰度
const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'Tune.gs']));

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

/** 用固定 fixture 跑一次，回傳可比對嘅簽章。 */
function runWithBonus(bonus) {
  const ctx = mock.buildGeneratorContextMock({ weekCount: 13, peopleCount: 60, randomSeed: 1 });
  ctx.scoreWeights = { chairDualBonus: bonus, preferenceBonus: 50, selectionWeight: 45 };
  const result = gas.buildRoster_(ctx);

  const people = {};
  const byDate = {};
  result.assignments.forEach(function (a) {
    if (!a.personId) return;
    people[a.personId] = true;
    if (!byDate[a.serviceDate]) byDate[a.serviceDate] = {};
    byDate[a.serviceDate][a.postId] = a.personId;
  });
  let dualWeeks = 0;
  Object.keys(byDate).forEach(function (d) {
    if (byDate[d].CHAIR && byDate[d].ANNOUNCE && byDate[d].CHAIR === byDate[d].ANNOUNCE) dualWeeks++;
  });

  return {
    signature: result.assignments.map(function (a) { return a.personId || ''; }).join(','),
    peopleCount: Object.keys(people).length,
    dualWeeks: dualWeeks
  };
}

console.log('\n=== B1【核心】前置：確認參數真係接駁到評分路徑（唔係死參數）===');
{
  // 呢個先係最基本嘅問題：CHAIR_DUAL_BONUS 有冇被讀到。
  // 如果 0 同 20 都一樣，代表參數根本冇接駁——嗰個先係真 bug。
  const zero = runWithBonus(0);
  const twenty = runWithBonus(20);
  check('★★★★★ bonus=0 同 bonus=20 嘅派工**唔同**——證明參數真係接駁到評分路徑',
    zero.signature !== twenty.signature,
    '兩者完全相同，代表 CHAIR_DUAL_BONUS 根本冇被讀到，係另一個 bug');
  check('★★★★ 而且兼任週數有變（bonus 嘅用途就係推高兼任）',
    zero.dualWeeks !== twenty.dualWeeks,
    'bonus=0 兼任 ' + zero.dualWeeks + ' 週　bonus=20 兼任 ' + twenty.dualWeeks + ' 週');
  check('★★★★ bonus=0 時兼任週數應該係最低（完全冇偏好雙重合資格嘅人）',
    zero.dualWeeks <= twenty.dualWeeks,
    'bonus=0 → ' + zero.dualWeeks + '　bonus=20 → ' + twenty.dualWeeks);
}

console.log('\n=== B3【核心】飽和：30 之後點加都一樣（呢個就係 Ivan 見到嘅現象）===');
{
  const saturated = [30, 45, 60, 75, 150, 500].map(runWithBonus);
  const first = saturated[0];

  check('★★★★★ 30／45／60／75／150／500 六個值嘅派工**完全一樣**'
    + '——舊 grid [30,45,60,75] 全部落喺呢個範圍，所以 12 行先會一模一樣',
    saturated.every(function (r) { return r.signature === first.signature; }),
    JSON.stringify(saturated.map(function (r, i) {
      return [30, 45, 60, 75, 150, 500][i] + '→用人' + r.peopleCount + '/兼任' + r.dualWeeks;
    })));

  checkEqual('★★★★ 用人數全部一樣',
    saturated.map(function (r) { return r.peopleCount; }),
    saturated.map(function () { return first.peopleCount; }));
  checkEqual('★★★★ 兼任週數全部一樣',
    saturated.map(function (r) { return r.dualWeeks; }),
    saturated.map(function () { return first.dualWeeks; }));

  // 反證：飽和唔係因為個 fixture 死咗——細值真係有分別（上一節已證）
  check('★★★★★ 反證：飽和值同 bonus=0 嘅結果**唔同**'
    + '（證明係「加到某個位之後唔再變」，唔係「由頭到尾都冇效」）',
    first.signature !== runWithBonus(0).signature);
}

console.log('\n=== B3：過渡區逐個值都有分別（門檻型參數嘅特徵）===');
{
  const transition = [0, 10, 15, 20, 25].map(runWithBonus);
  const distinct = {};
  transition.forEach(function (r) { distinct[r.signature] = true; });
  check('★★★★★ 0／10／15／20／25 之中至少有 3 種唔同結果'
    + '——證明敏感區真係喺呢度，唔係喺 30 以上',
    Object.keys(distinct).length >= 3,
    '實際只有 ' + Object.keys(distinct).length + ' 種：'
      + JSON.stringify(transition.map(function (r, i) {
        return [0, 10, 15, 20, 25][i] + '→用人' + r.peopleCount + '/兼任' + r.dualWeeks;
      })));
}

console.log('\n=== B2【核心】新 TUNE_GRID 一定要覆蓋敏感區 ===');
{
  const grid = gas.TUNE_GRID.CHAIR_DUAL_BONUS;
  check('★★★★★ grid 有值細過 30（舊 grid 最細就係 30，全部飽和）',
    grid.some(function (v) { return v < 30; }), JSON.stringify(grid));
  check('★★★★ grid 由 0 開始（要見到「完全唔加分」係咩樣先比較得到）',
    grid.indexOf(0) !== -1, JSON.stringify(grid));
  check('★★★★★ 用新 grid 跑，結果**唔會**全部一樣（舊 grid 就係全部一樣）',
    (function () {
      const sigs = {};
      grid.forEach(function (v) { sigs[runWithBonus(v).signature] = true; });
      return Object.keys(sigs).length > 1;
    })(),
    '新 grid 跑出嚟仍然全部一樣，代表敏感區冇被覆蓋到');
  check('★★★ grid 唔會太多值（每個值都要跑一次完整生成，會撞執行時間上限）',
    grid.length <= 8, '實際 ' + grid.length + ' 個值 × 3 個 WEIGHT_HISTORICAL = '
      + (grid.length * 3) + ' 組');
}

console.log('\n=== B2：報告要識得自己講「呢個範圍飽和咗」===');
{
  // 造一組「全部指標一模一樣」嘅假結果（＝舊 grid 嘅情況）
  const identicalRows = [];
  [30, 45, 60, 75].forEach(function (bonus) {
    [0.5, 0.65].forEach(function (weight) {
      identicalRows.push({
        chairDualBonus: bonus, historicalWeight: weight,
        chairEqRatio: 0.5, announceRatio: 0.2, peopleCount: 45,
        average: 3.2, maxCount: 8, deviation: 0.1234
      });
    });
  });
  const notes = gas.buildTuneSaturationNotes_(identicalRows);
  check('★★★★★ 偵測到飽和並產生提示', notes.length > 0);
  check('★★★★ 提示講得出係邊個參數同邊個範圍',
    notes[0] && notes[0].indexOf('CHAIR_DUAL_BONUS') !== -1
      && notes[0].indexOf('30') !== -1 && notes[0].indexOf('75') !== -1, notes[0]);
  check('★★★★ 提示解釋咗機制（門檻型、唔係連續型）',
    notes.join(' ').indexOf('門檻型') !== -1);
  check('★★★★ 提示畀咗可行動嘅建議（試更細嘅值）',
    notes.join(' ').indexOf('更細') !== -1);

  // 反向：真係有分別嘅結果唔應該報飽和
  const varyingRows = identicalRows.map(function (r, i) {
    return Object.assign({}, r, { peopleCount: 45 + (i % 3) });
  });
  checkEqual('★★★★★ 反向：結果有分別時**唔會**誤報飽和',
    gas.buildTuneSaturationNotes_(varyingRows), []);

  checkEqual('★★★ 空陣列唔會爆', gas.buildTuneSaturationNotes_([]), []);
  checkEqual('★★★ 每組得一個值時唔會誤報（比較唔到就唔好亂講）',
    gas.buildTuneSaturationNotes_([identicalRows[0]]), []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
