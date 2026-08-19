// 第三十二輪批次階段 C′：相鄰對分母——**characterisation test（釘死現狀）**。
// 執行方式：node tests/announce_pair_denominator_impact.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢條測試唔係「證明啱」，係「釘死一個刻意嘅唔一致，同埋佢嘅代價」
// ═════════════════════════════════════════════════════════════════════
//
// 「報告連續」量嘅係**相鄰兩週同一人**。13 個主日之間只有 12 對相鄰。
//
//   `Verify.gs` 品質統計（目標嗰邊）　　`adjacentPairCount_()` ⇒ 12 對
//   `RuleReview.gs` 規則審閱表　　　　　`adjacentPairCount_()` ⇒ 12 對
//   `Generator.gs` `isBehindTargetPace_()`　`weeksCounted`　　 ⇒ 13
//
// 頭兩個（**量度介面**）一致。第三個（**引擎內部節流參數**）刻意唔跟。
//
// ─────────────────────────────────────────────────────────────────────
// 第三十二輪嘅實測數字（拍板依據）
// ─────────────────────────────────────────────────────────────────────
//
// 離線（13 個主日、89 人、目標 0.27、15 個 seed，逐個 seed 跑新舊分母）：
//
//   seed 1–15 全部一樣
//     舊分母 13 ⇒ 排到 4 對（4/12 = 33.3%）
//     新分母 12 ⇒ 排到 4 對（4/12 = 33.3%）
//     硬規則違反：舊 0 項 ／ 新 0 項
//
//   ⇒ 目標指標**零改善**。
//   ⇒ 但 **15 個 seed 嘅整張職事表全部改變**，
//      而且 `chairEqAnnounce` 15 個 seed 全部郁（seed 1：30.8% → 38.5%）。
//
// 原因（13 週逐週比較 `count < target × denom`，count 係整數）：
//   只有第 1、4、8、12 週兩邊判斷唔同，而嗰四週實際 count 都唔喺邊界上。
//
// 現場（所有已生成版本）：
//   報告連續 **25.0% 出現 20 次、33.3% 出現 3 次**，平均 3.13 對。
//   目標 `0.27 × 12 = 3.24` 對 ⇒ **引擎現場已經命中目標。**
//   12 對之下 3.24 對只能實現為 3 對或 4 對——25% 同 33% 嘅分別就係一對，
//   即係量化雜訊，任何分母微調都不可能排出 27%。
//
// ─────────────────────────────────────────────────────────────────────
// 拍板結論（第三十二輪，Ivan）
// ─────────────────────────────────────────────────────────────────────
//
// **引擎一行都唔改。** 用「每一季排表結果全部改變」換一個寫法一致，
// 唔划算；而郁 `TARGET_VALUE` 更差——27% 係堂委會喺審閱表見到並批准
// 嘅歷史基準，為咗遷就雜訊去改佢，等於製造第二個
// 「顯示嘅數同真正意思唔同」。
//
// 改嘅只有顯示：對數做主角、百分比放括號、並且明講
// 「3 對或 4 對兩者都算命中」。
//
// ⚠️ 下面嘅斷言係**釘死現狀**。有人改咗引擎分母，呢度會紅，
// 而佢會喺呢個檔頭見到代價係咩。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');
const A = require('./helpers/roster_assertions.js');

const POST = mock.POST;

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
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}

const readSrc = function (f) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
};
const stripComments = function (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

/* ══════════════════════════════════════════════════════════════
 * C′1　引擎繼續用 `weeksCounted`——釘死
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== C′1【核心】引擎嘅節流參數繼續用 `weeksCounted` ===');
{
  const gen = stripComments(readSrc('Generator.gs'));

  checkEqual('★★★★★ 兩個 `announceConsecutive` 呼叫點都用 `state.ratioState.weeksCounted`'
    + '——改成 `adjacentPairCount_()` 會令每一季排表結果全部改變，'
    + '而目標指標零改善（見檔頭實測）',
    (gen.match(/isBehindTargetPace_\(state\.ratioState\.announceConsecutive, state\.ratioState\.weeksCounted,/g) || []).length,
    2);
  check('★★★★★ **`Generator.gs` 冇叫過 `adjacentPairCount_()`**'
    + '——嗰個函式係俾量度介面用嘅，唔係俾引擎用',
    gen.indexOf('adjacentPairCount_') === -1,
    '（見 isBehindTargetPace_() 註解）');
  check('★★★★★ 而且 `isBehindTargetPace_()` 嘅註解真係講咗點解刻意唔一致'
    + '——一個冇解釋嘅唔一致，下一輪一定有人「順手修好」',
    readSrc('Generator.gs').indexOf('greedy pass 內部的「節流參數」，不是量度') !== -1);
  check('★★★★★ 而且註解寫低咗現場數字（25.0% 出現 20 次）',
    readSrc('Generator.gs').indexOf('25.0% 出現 20 次') !== -1);
}

console.log('\n=== C′3【核心】唔可以再留「待 Ivan 決定」嘅字眼 ===');
{
  const rr = readSrc('RuleReview.gs');
  check('★★★★★ `RuleReview.gs` 冇「未解決」／「等 Ivan 拍板」'
    + '——留住嘅話下一輪一定有人再提一次',
    rr.indexOf('未解決') === -1 && rr.indexOf('等 Ivan 拍板') === -1,
    rr.slice(Math.max(0, rr.indexOf('未解決') - 100), rr.indexOf('未解決') + 200));
  check('★★★★★ 而且明寫咗「已經拍板」同埋指返去 `isBehindTargetPace_()`',
    rr.indexOf('已經拍板') !== -1 && rr.indexOf('isBehindTargetPace_()') !== -1);
}

/* ══════════════════════════════════════════════════════════════
 * C′2　量度介面兩邊讀同一個函式
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== C′2【核心】量度介面單一真相來源 ===');
{
  const rr = stripComments(readSrc('RuleReview.gs'));
  check('★★★★★ `RuleReview.gs` 的 `ADJACENT_PAIR` 兩個欄位都叫 `adjacentPairCount_()`',
    /population: function \(weeks\) \{ return adjacentPairCount_\(weeks\); \}/.test(rr)
    && /ratioDenominator: function \(weeks\) \{ return adjacentPairCount_\(weeks\); \}/.test(rr));
  check('★★★★★ 而且冇一處仲寫住就地嘅 `weeks - 1`', !/return weeks - 1;/.test(rr));

  const vf = stripComments(readSrc('Verify.gs'));
  check('★★★★★ `Verify.gs` 品質統計嘅**目標**嗰邊亦叫同一個函式',
    /describeAdjacentPairTarget_\(announce\.target, context\.serviceDates\.length\)/.test(vf));

  // ⚠️ 呢一條係一個**刻意嘅例外**，唔係漏咗。
  check('★★★★★ **但實測嗰邊照舊用 `announce.pairs`，唔係 `週數 − 1`**'
    + '——`computeAnnounceConsecutiveRatio_()` 數嘅係「兩邊都排到人」嗰啲 pair。'
    + '有啲週完全冇排到人嘅話，實際 pair 會少過 `週數 − 1`，'
    + '夾硬用 `週數 − 1` 做分母會令實測比例失真（分母大咗，比例細咗）',
    /describeAdjacentPairActual_\(announce\.repeats, announce\.pairs\)/.test(vf));
}

console.log('\n=== C′2 `adjacentPairCount_()` 邊界 ===');
{
  const gas = loadGasSource();
  [[13, 12], [12, 11], [2, 1], [1, 0], [0, 0]].forEach(function (c) {
    checkEqual('★★★★★ ' + c[0] + ' 個主日 ⇒ ' + c[1] + ' 對',
      gas.adjacentPairCount_(c[0]), c[1]);
  });
  check('★★★★★ **0 個主日唔可以得出 −1**'
    + '——負數分母會靜靜流落去，`count < 負數` 永遠 false，'
    + '表面上「啱」但係靠一個錯嘅中間值撞返啱',
    gas.adjacentPairCount_(0) === 0);
  [null, undefined, '', NaN, '唔係數'].forEach(function (bad) {
    checkEqual('★★★★ 算唔到（`' + String(bad) + '`）⇒ 0 對',
      gas.adjacentPairCount_(bad), 0);
  });
}

/* ══════════════════════════════════════════════════════════════
 * C′4　顯示：對數做主角
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== C′4【核心】目標講成對數，並且明講兩個值都算命中 ===');
{
  const gas = loadGasSource();
  const g = gas.describeAdjacentPairTarget_(0.27, 13);

  checkEqual('★★★★★ 換算得到', g.ok, true);
  checkEqual('★★★★★ 12 對（唔係 13）', g.pairs, 12);
  check('★★★★★ 主文寫「12 對相鄰主日之中約 3 對（27%）」'
    + '——對數係主角，百分比放括號',
    g.text === '12 對相鄰主日之中約 3 對（27%）', g.text);
  check('★★★★★ **而且明講 3 對（25.0%）或 4 對（33.3%）兩者都算命中**'
    + '——冇呢句，堂委見到審閱表寫「約 3 對」、事後品質統計見到「4 對」，'
    + '會以為系統冇跟佢哋批准嗰個數',
    g.note.indexOf('3 對（25.0%）') !== -1 && g.note.indexOf('4 對（33.3%）') !== -1
    && g.note.indexOf('兩者都算命中') !== -1, g.note);
}

console.log('\n=== C′4【核心】週數唔係 13 要自動換算，唔可以寫死 ===');
{
  const gas = loadGasSource();
  const g12 = gas.describeAdjacentPairTarget_(0.27, 12);
  check('★★★★★ 12 個主日 ⇒ 11 對（唔係寫死 12）',
    g12.pairs === 11 && g12.text.indexOf('11 對相鄰主日') === 0, g12.text);
  const g14 = gas.describeAdjacentPairTarget_(0.27, 14);
  check('★★★★★ 14 個主日 ⇒ 13 對', g14.pairs === 13, g14.text);
  check('★★★★ 而且對數跟住換算（0.27 × 13 ≈ 3.51 ⇒ 約 4 對）',
    g14.text.indexOf('約 4 對') !== -1, g14.text);

  // 剛好整除嘅情況：唔應該講「兩者都算命中」（根本冇兩者）。
  const exact = gas.describeAdjacentPairTarget_(0.25, 13);   // 0.25 × 12 = 3
  check('★★★★★ 剛好整除（0.25 × 12 ＝ 3）⇒ 講「剛好命中」，'
    + '**唔會硬砌一句「3 對或 3 對都算命中」**',
    exact.note.indexOf('剛好命中') !== -1 && exact.note.indexOf('兩者') === -1,
    exact.note);
}

console.log('\n=== C′4 換算唔到嗰陣要講，唔可以硬砌 ===');
{
  const gas = loadGasSource();
  [[0.27, 1], [0.27, 0], [0.27, null], [null, 13], ['唔係數', 13]].forEach(function (c) {
    const g = gas.describeAdjacentPairTarget_(c[0], c[1]);
    checkEqual('★★★★★ target=' + String(c[0]) + '、weeks=' + String(c[1])
      + ' ⇒ `ok` 係 false（呼叫端會改講百分比）', g.ok, false);
    checkEqual('★★★★ 而且唔會回一句半桶水嘅文字', g.text, '');
  });
}

console.log('\n=== C′4 實測嗰邊：分母用實際數到嘅 pair ===');
{
  const gas = loadGasSource();
  checkEqual('★★★★★ 3/12 ⇒ 「3 對（25.0%）」',
    gas.describeAdjacentPairActual_(3, 12), '3 對（25.0%）');
  checkEqual('★★★★★ 4/12 ⇒ 「4 對（33.3%）」',
    gas.describeAdjacentPairActual_(4, 12), '4 對（33.3%）');
  checkEqual('★★★★★ **pairs 少過 週數−1 嗰陣照樣啱**（有啲週冇排到人）'
    + '——2/8 ⇒ 25.0%，唔會硬用 12 做分母',
    gas.describeAdjacentPairActual_(2, 8), '2 對（25.0%）');
  [[3, 0], [null, 12], [3, null], [3, '唔係數']].forEach(function (c) {
    checkEqual('★★★★★ 算唔到（' + String(c[0]) + '/' + String(c[1])
      + '）⇒ 「（算不出來）」，**唔可以印「0 對（0.0%）」**'
      + '——嗰個係一個睇落完全正常但意思完全唔同嘅答案',
      gas.describeAdjacentPairActual_(c[0], c[1]), '（算不出來）');
  });
}

/* ══════════════════════════════════════════════════════════════
 * 代價：改咗引擎會點——**呢一段就係將來嗰個人要見到嘅嘢**
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 代價實測：改引擎分母 ⇒ 整張表變，目標指標零改善 ===');
{
  const run = function (mode, seed) {
    const gas = loadGasSource();
    if (mode === 'newDenominator') {
      // 模擬「有人把引擎改成用相鄰對數」。
      gas.isBehindTargetPace_ = function (count, weeksCounted, target) {
        return count < target * Math.max(0, weeksCounted - 1);
      };
    }
    const ctx = mock.buildGeneratorContextMock({ gas: gas, randomSeed: seed });
    const roster = gas.buildRoster_(ctx);
    const soft = A.measureSoftRules(roster.assignments, ctx, POST.CHAIR, POST.ANNOUNCE);
    const pairs = ctx.serviceDates.length - 1;
    return {
      consecutive: Math.round(soft.announceConsecutiveRatio * pairs),
      chair: soft.chairEqAnnounceRatio,
      hard: A.checkAllHardRules(gas, roster.assignments, ctx).total,
      signature: roster.assignments.map(function (a) { return a.personId; }).join(',')
    };
  };

  let sameConsecutive = 0;
  let differentRoster = 0;
  let differentChair = 0;
  let hardRose = 0;
  const SEEDS = 15;
  for (let s = 1; s <= SEEDS; s++) {
    const now = run('current', s);
    const changed = run('newDenominator', s);
    if (now.consecutive === changed.consecutive) sameConsecutive++;
    if (now.signature !== changed.signature) differentRoster++;
    if (now.chair !== changed.chair) differentChair++;
    if (changed.hard > now.hard) hardRose++;
  }

  checkEqual('★★★★★ **' + SEEDS + ' 個 seed 之中，「報告連續」對數完全冇分別**'
    + '——即係改咗都唔會令目標指標好啲',
    sameConsecutive, SEEDS);
  checkEqual('★★★★★ **但整張職事表 ' + SEEDS + ' 個 seed 全部改變**'
    + '——呢個先係代價：每一季排出嚟嘅人都會唔同',
    differentRoster, SEEDS);
  checkEqual('★★★★★ **而且連鎖影響主席／報告係咪同一人**'
    + '——`chairEqAnnounce` 嘅規則同分母冇改過，佢郁咗純粹因為'
    + 'announce 嗰邊嘅獎勵改變咗揀邊個。'
    + '即係「只改一條軟規則嘅分母」實際上唔係一個局部改動',
    differentChair, SEEDS);
  checkEqual('★★★★ 硬規則違反冇上升（改動唔會令排表變得不合法）', hardRose, 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
