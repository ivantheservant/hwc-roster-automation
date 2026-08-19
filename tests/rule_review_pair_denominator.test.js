// 第三十輪批次階段 D2：相鄰對嘅分母，要同 `Verify.gs` 嘅品質統計一致。
// 執行方式：node tests/rule_review_pair_denominator.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解
// ─────────────────────────────────────────────────────────────────────
//
// 上一輪把 `ADJACENT_PAIR.ratioDenominator` 設成 `weeks`（13），
// 理由係「跟排表引擎」（`isBehindTargetPace_()` 嘅 `weeksCounted` 數埋第一週）。
//
// **嗰個決定係錯嘅。** 系統自己嘅品質統計用嘅係 `weeks - 1`：
//
//   `Verify.gs` 嘅 `measureAnnounceRelief_()`：
//     `for (let i = 1; i < dates.length; i++) pairs++;`   ⇒ 12 對
//   出嚟嘅報告就係 `報告（ANNOUNCE）洩壓閥　25.0%　3/12 對`
//
// 堂委喺審閱表見到嘅數字，同幹事事後喺品質統計見到嘅數字，
// **一定要同一個分母**。兩個唔同就係「同一件事兩個真相來源」
// 嘅另一個形狀，而今次錯嗰邊係俾堂委睇嗰一份。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RuleReview.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const unit = gas.RULE_REVIEW_UNITS.ADJACENT_PAIR;

/** 用 `Verify.gs` 同一條式數對數：`dates.length - 1`。 */
function verifyPairCount(weeks) {
  const dates = [];
  for (let i = 0; i < weeks; i++) dates.push('d' + i);
  let pairs = 0;
  for (let i = 1; i < dates.length; i++) pairs++;
  return pairs;
}

console.log('\n=== D2【核心】審閱表同 Verify.gs 用同一個分母 ===');
{
  [10, 11, 12, 13, 14, 15, 16].forEach(function (weeks) {
    check('★★★★★ ' + weeks + ' 個主日 ⇒ 兩邊都係 ' + verifyPairCount(weeks) + ' 對',
      unit.ratioDenominator(weeks) === verifyPairCount(weeks)
      && unit.population(weeks) === verifyPairCount(weeks),
      '審閱表分母 ' + unit.ratioDenominator(weeks)
      + '／母體 ' + unit.population(weeks)
      + '／Verify ' + verifyPairCount(weeks));
  });
}

console.log('\n=== D2【核心】Ivan 實測嗰個數字 ===');
{
  check('★★★★★ 13 個主日、目標 0.27 ⇒ 「12 對相鄰的主日之中約 3 對」'
    + '——上一輪寫住「約 4 對」（分母用咗 13），同品質統計嗰個 `3/12 對` 對唔上',
    gas.describeRuleValue_(0.27, 13, 'ADJACENT_PAIR') === '12 對相鄰的主日之中約 3 對',
    gas.describeRuleValue_(0.27, 13, 'ADJACENT_PAIR'));
  check('★★★★★ 0.27 × 12 = 3.24 ⇒ 3（唔係 0.27 × 13 = 3.51 ⇒ 4）',
    Math.round(0.27 * 12) === 3 && Math.round(0.27 * 13) === 4);
}

console.log('\n=== D2 反面：Verify.gs 真係由 i = 1 開始數 ===');
{
  const verify = read('src/Verify.gs');
  check('★★★★★ `measureAnnounceRelief_()` 嘅迴圈由 `i = 1` 開始'
    + '——即係 `dates.length - 1` 對，13 個主日 12 對',
    /for \(let i = 1; i < dates\.length; i\+\+\) \{[\s\S]{0,300}?pairs\+\+;/.test(verify));
  check('★★★★ 而且報告真係印「N/M 對」',
    /repeats \+ '\/' \+ (?:item|announce)\.pairs \+ ' 對'/.test(verify));
}

console.log('\n=== D2 逐個主日嗰個單位冇改（分母仍然係 weeks）===');
{
  const perSunday = gas.RULE_REVIEW_UNITS.PER_SUNDAY;
  check('★★★★★ 逐個主日：分母同母體都係 weeks'
    + '——`SOFT_CHAIR_EQ_ANNOUNCE` 嘅 `ratioState.weeksCounted` 就係全部主日',
    perSunday.ratioDenominator(13) === 13 && perSunday.population(13) === 13);
  check('★★★★ 而且顯示唔變：13 個主日之中約 8 個',
    gas.describeRuleValue_(0.63, 13, 'PER_SUNDAY') === '13 個主日之中約 8 個');
}

console.log('\n=== D2 選項亦跟新分母 ===');
{
  const choices = gas.buildRuleReviewRatioChoices_(0.27, 13, 'ADJACENT_PAIR');
  const keep = choices.filter(function (c) {
    return c.label.indexOf('（維持現狀）') !== -1;
  })[0];
  check('★★★★★ 「維持現狀」落喺「約 3 對」（唔再係 4 對）',
    keep && keep.label.indexOf('約 3 對') !== -1,
    choices.map(function (c) { return c.label; }).join(' ｜ '));
  check('★★★★★ 而且仍然帶原值 0.27，冇經過來回換算', keep && keep.value === 0.27);
  check('★★★★★ 每個選項換算返顯示都對得返（來回一致）',
    choices.every(function (c) {
      const want = (c.label.match(/約 (\d+) 對/) || [])[1];
      const again = (gas.describeRuleValue_(c.value, 13, 'ADJACENT_PAIR')
        .match(/約 (\d+) 對/) || [])[1];
      return want === again;
    }), choices.map(function (c) { return c.label + '=' + c.value; }).join(' ｜ '));
}

console.log('\n=== C′3【核心】嗰個分歧已經拍板，唔可以再留「未解決」 ===');
{
  // ⚠️ 第三十二輪批次階段 C′：第三十輪留低嘅「未解決分歧」已經拍板。
  //
  // 引擎嘅進度控制（`isBehindTargetPace_()`）繼續用 `weeksCounted`，
  // **呢個係決定，唔係遺漏**：實測改咗會令每一季排表結果全部改變
  // 而目標指標零改善，而現場 20/23 個版本已經排到 3 對（25%），
  // 目標 3.24 對——已經命中。
  //
  // 舊版斷言要求註解寫住「未解決」。而家反過嚟：**唔准再有**
  // ——留住嘅話下一輪一定有人再提一次。
  const src = read('src/RuleReview.gs');
  check('★★★★★ **冇「未解決」／「等 Ivan 拍板」呢類字眼**',
    src.indexOf('未解決') === -1 && src.indexOf('等 Ivan 拍板') === -1);
  check('★★★★★ 改成明寫「已經拍板」，而且指返去 `isBehindTargetPace_()`',
    src.indexOf('已經拍板') !== -1 && src.indexOf('isBehindTargetPace_()') !== -1);
  check('★★★★★ 而引擎嗰邊真係有寫低理由'
    + '——一個冇解釋嘅刻意唔一致，下一輪一定有人「順手修好」',
    read('src/Generator.gs').indexOf('greedy pass 內部的「節流參數」，不是量度') !== -1);
  check('★★★★ 稽核文件亦有寫',
    read('docs/系統範圍稽核.md').indexOf('measureAnnounceRelief_') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
