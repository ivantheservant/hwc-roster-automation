// 第二十九輪批次階段 A3：每個選項換算來回一致。
// 執行方式：node tests/rule_review_roundtrip.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 要鎖死嘅性質
// ─────────────────────────────────────────────────────────────────────
//
// 一個選項寫住「12 對相鄰的主日之中約 3 對」，佢帶嘅 `value` 會寫入
// `RuleSettings.TargetValue`。下一次匯出嗰陣，同一個 `TargetValue`
// 一定要換算返「約 3 對」。
//
// 唔一致嘅話會出現一種**冇人捉得到**嘅漂移：
//   堂委揀「約 3 對」→ 寫入 0.23 → 下次匯出顯示「約 3 對」…
//   但如果換算兩邊用唔同分母，就會變成
//   堂委揀「約 3 對」→ 寫入 0.23 → 下次匯出顯示「約 4 對」，
//   而冇人改過任何嘢。
//
// ⚠️ 「維持現狀」嗰個選項特別重要：佢帶嘅係**原值**，
// 唔經過任何換算。上一輪就係因為 8 ÷ 13 反推回 0.62，
// 令「維持現狀」靜靜把 0.63 改成 0.62。

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

const UNIT_IDS = Object.keys(gas.RULE_REVIEW_UNITS);
// 一季由 10 到 16 個主日都要成立——分母寫死 13 係上一輪捉到嘅 bug。
const WEEKS = [10, 11, 12, 13, 14, 15, 16];
// 由 0.01 到 0.99，逐 0.01 行——0–1 之間全部合法嘅 TargetValue。
const TARGETS = [];
for (let t = 1; t <= 99; t++) TARGETS.push(Math.round(t) / 100);

/** 由一個 label 抽返嗰個次數出嚟（**只喺測試入面反推，正式程式碼永遠唔反推**）。 */
function countInLabel(label) {
  const m = label.match(/約 (\d+) [個對]/);
  return m ? Number(m[1]) : null;
}

console.log('\n=== A3【核心】每個選項：值 → 顯示 → 同一個選項 ===');
{
  const broken = [];
  let checked = 0;
  UNIT_IDS.forEach(function (unitId) {
    WEEKS.forEach(function (weeks) {
      TARGETS.forEach(function (target) {
        const choices = gas.buildRuleReviewRatioChoices_(target, weeks, unitId);
        choices.forEach(function (c) {
          const wanted = countInLabel(c.label);
          if (wanted === null) return;   // 「維持現狀」（換算唔到嗰個 fallback）
          checked++;
          // 把選項嘅值當成新嘅 TargetValue 再換算一次。
          const again = countInLabel(gas.describeRuleValue_(c.value, weeks, unitId));
          if (again !== wanted) {
            broken.push(unitId + ' weeks=' + weeks + ' target=' + target
              + ' 「' + c.label + '」→ 存 ' + c.value + ' → 再顯示變咗 ' + again);
          }
        });
      });
    });
  });
  check('★★★★★ 全部組合來回一致（共 ' + checked + ' 個選項）'
    + '——唔一致嘅話，堂委揀完之後下次匯出會見到另一個數字，而冇人改過嘢',
    broken.length === 0, broken.slice(0, 5).join('\n      '));
}

console.log('\n=== A3【核心】「維持現狀」永遠唔會改動個值 ===');
{
  const drifted = [];
  UNIT_IDS.forEach(function (unitId) {
    WEEKS.forEach(function (weeks) {
      TARGETS.forEach(function (target) {
        const keep = gas.buildRuleReviewRatioChoices_(target, weeks, unitId)
          .filter(function (c) { return c.label.indexOf('（維持現狀）') !== -1; })[0];
        if (!keep) return;
        if (keep.value !== target) {
          drifted.push(unitId + ' weeks=' + weeks + ' ' + target + ' → ' + keep.value);
        }
      });
    });
  });
  check('★★★★★ 「維持現狀」帶嘅一定係**原值本身**，一個組合都冇漂移'
    + '——0.63 顯示成「約 8 個」，而 8 ÷ 13 反推回去係 0.62',
    drifted.length === 0, drifted.slice(0, 5).join('\n      '));
}

console.log('\n=== A3 選項本身要合理 ===');
{
  const bad = [];
  UNIT_IDS.forEach(function (unitId) {
    const unit = gas.RULE_REVIEW_UNITS[unitId];
    WEEKS.forEach(function (weeks) {
      const population = unit.population(weeks);
      TARGETS.forEach(function (target) {
        const choices = gas.buildRuleReviewRatioChoices_(target, weeks, unitId);
        const counts = choices.map(function (c) { return countInLabel(c.label); })
          .filter(function (n) { return n !== null; });
        if (counts.length === 0) return;
        // 唔可以有重複選項——兩個一模一樣嘅選項喺下拉入面係一個陷阱。
        if (new Set(counts).size !== counts.length) {
          bad.push('重複：' + unitId + ' weeks=' + weeks + ' target=' + target);
        }
        // 唔可以超出母體，亦唔可以係負數。
        counts.forEach(function (n) {
          if (n < 0 || n > population) {
            bad.push('超界：' + unitId + ' weeks=' + weeks + ' target=' + target + ' → ' + n);
          }
        });
        // 一個選項嘅下拉等於冇得揀。
        if (counts.length < 2) {
          bad.push('得一個選項：' + unitId + ' weeks=' + weeks + ' target=' + target);
        }
      });
    });
  });
  check('★★★★★ 冇重複、冇超出母體、每條至少兩個選項',
    bad.length === 0, bad.slice(0, 5).join('\n      '));
}

console.log('\n=== A3 換算唔到嘅時候：一個選項，而且係原值 ===');
{
  UNIT_IDS.forEach(function (unitId) {
    const c = gas.buildRuleReviewRatioChoices_(0.63, null, unitId);
    check('★★★★★ ' + unitId + '：查不到主日數 ⇒ 只有「維持現狀」，'
      + '而且帶原值——**唔可以估一個 13 出嚟畀堂委揀**',
      c.length === 1 && c[0].label === '維持現狀' && c[0].value === 0.63,
      JSON.stringify(c));
  });
  const pair = gas.buildRuleReviewRatioChoices_(0.27, 1, 'ADJACENT_PAIR');
  check('★★★★★ 一個主日嘅季度冇相鄰對 ⇒ 同樣只得「維持現狀」',
    pair.length === 1 && pair[0].label === '維持現狀' && pair[0].value === 0.27,
    JSON.stringify(pair));
}

console.log('\n=== A3 非比例值原樣顯示，唔會被當成比例換算 ===');
{
  check('★★★★★ 8（每季上限）唔係 0–1 之間 ⇒ 原樣「8」，'
    + '唔會變成「13 個主日之中約 104 個」',
    gas.describeRuleValue_(8, 13, 'PER_SUNDAY') === '8');
  check('★★★★ 1 同 0 都唔當比例（邊界）',
    gas.describeRuleValue_(1, 13, 'PER_SUNDAY') === '1'
    && gas.describeRuleValue_(0, 13, 'PER_SUNDAY') === '0');
  check('★★★★ 冇設定 ⇒ 講「（沒有設定）」，唔會當成 0',
    gas.describeRuleValue_('', 13, 'PER_SUNDAY') === '（沒有設定）'
    && gas.describeRuleValue_(null, 13, 'PER_SUNDAY') === '（沒有設定）');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
