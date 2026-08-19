// 第二十九輪批次階段 A：規則審閱表第 9 條（洩壓閥）嘅三個問題。
// 執行方式：node tests/rule_review_units.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測
// ─────────────────────────────────────────────────────────────────────
//
// 匯出結果：`現時設定：13 個主日之中約 4 個`
//
// A1　**語意反咗。** 舊文字寫「報告盡量**不要**連續兩週」＋
//     「連兩週會比較辛苦」。但呢條規則喺系統入面係**洩壓閥**：
//     排唔出人嗰陣，系統靠容許報告連續嚟解開嗰一週。
//     如果堂委好心揀「約 2 對」，佢實際上係封咗系統唯一嘅逃生口。
//     ⚠️ 呢個唔係文案問題——**系統會忠實執行嗰個錯決定。**
//
// A2　**分母同量詞。** 13 個主日之間只有 12 對相鄰。
//     「13 個主日之中約 4 個」——「個」乜嘢？
//     而且唔可以寫死邊條規則用邊個分母：單位要係規則自己嘅屬性。
//
// A3　**選項換算要來回一致。**

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
const R = gas.COLUMNS.RULE_SETTINGS;
const IDS = gas.RULE_IDS;

console.log('\n=== A1【核心】洩壓閥嗰句唔可以講反 ===');
{
  const entry = gas.ruleReviewPlainEntry_(IDS.ANNOUNCE_RELIEF);
  check('★★★★★ 規則一句話改成「報告**可以**連續兩週由同一個人擔任」',
    entry.text === '報告可以連續兩週由同一個人擔任', entry.text);
  check('★★★★★ **完全冇咗「不要連續」呢個講法**'
    + '——舊嗰句係叫堂委收緊佢，而收緊佢會令某些週完全排不出來',
    entry.text.indexOf('不要連續') === -1
    && entry.what.indexOf('不要連續') === -1);
  check('★★★★★ 講明佢係洩壓閥',
    entry.what.indexOf('洩壓閥') !== -1, entry.what);
  check('★★★★★ 而且講明收得太緊嘅後果'
    + '——「呢個係洩壓閥」對堂委嚟講唔係一個可以據以決定嘅講法',
    entry.what.indexOf('收得太緊會令某些週排不出來') !== -1, entry.what);
  check('★★★★★ 亦冇咗「連兩週會比較辛苦」——嗰句係喺講反面理由',
    entry.what.indexOf('辛苦') === -1);
}

console.log('\n=== A1 反面：呢條規則喺引擎入面真係一個獎勵，唔係一個懲罰 ===');
{
  const gen = read('src/Generator.gs');
  check('★★★★★ `computeAnnounceReliefBonus_()` 係派**獎勵分**畀上週嗰位'
    + '——即係系統會主動令佢連續，唔係避免',
    /function computeAnnounceReliefBonus_[\s\S]{0,900}?scoreWeights\.preferenceBonus : 0;/
      .test(gen));
  check('★★★★★ 而且只有喺「落後於目標進度」嗰陣先派'
    + '（＝比例未夠先鼓勵連續，夠咗就停）',
    /isBehindTargetPace_\(state\.ratioState\.announceConsecutive/.test(gen));
}

console.log('\n=== A2【核心】單位係規則自己嘅屬性，唔可以寫死邊條用邊個 ===');
{
  check('★★★★★ 第 9 條標住相鄰對',
    gas.ruleReviewPlainEntry_(IDS.ANNOUNCE_RELIEF).unit === 'ADJACENT_PAIR');
  check('★★★★★ 第 8 條（主席兼報告）標住逐個主日',
    gas.ruleReviewPlainEntry_(IDS.CHAIR_EQ_ANNOUNCE).unit === 'PER_SUNDAY');
  check('★★★★★ 第 13 條（優先揀雙資格）標住逐個主日',
    gas.ruleReviewPlainEntry_(IDS.CHAIR_PREFER_DUAL).unit === 'PER_SUNDAY');

  check('★★★★★ 換算函式收單位做參數，唔係喺入面按 RuleID 判斷'
    + '——按 RuleID 判斷就係「寫死邊條用邊個」，加新規則實中同一個陷阱',
    /function describeRuleValue_\(value, weeks, unitId\)/.test(read('src/RuleReview.gs'))
    && /function buildRuleReviewRatioChoices_\(current, weeks, unitId\)/
      .test(read('src/RuleReview.gs')));
  check('★★★★★ 認唔出嘅單位代號 ⇒ **拋錯**，唔會靜靜退回預設'
    + '——靜靜退回嘅話，打錯一個字就會令一條規則用錯分母而份表睇落正常',
    (function () {
      try { gas.ruleReviewUnit_('PER_SUNDY'); return false; } catch (e) {
        return e.message.indexOf('認不出的單位代號') !== -1;
      }
    })());
}

console.log('\n=== A2【核心】量詞同母體跟單位 ===');
{
  check('★★★★★ 逐個主日：「13 個主日之中約 8 個」',
    gas.describeRuleValue_(0.63, 13, 'PER_SUNDAY') === '13 個主日之中約 8 個',
    gas.describeRuleValue_(0.63, 13, 'PER_SUNDAY'));
  check('★★★★★ 相鄰對：母體係 **12 對**，量詞係「對」，唔再係「個主日」',
    gas.describeRuleValue_(0.27, 13, 'ADJACENT_PAIR') === '12 對相鄰的主日之中約 3 對',
    gas.describeRuleValue_(0.27, 13, 'ADJACENT_PAIR'));
  check('★★★★★ **舊嗰句「13 個主日之中約 4 個」唔會再出現**'
    + '——「個」乜嘢？呢條規則數嘅係相鄰嘅一對主日',
    gas.describeRuleValue_(0.27, 13, 'ADJACENT_PAIR').indexOf('個主日之中') === -1);
  check('★★★★ 14 個主日 ⇒ 13 對',
    gas.describeRuleValue_(0.27, 14, 'ADJACENT_PAIR').indexOf('13 對相鄰的主日') === 0);
  check('★★★★ 唔傳單位 ⇒ 當逐個主日（向後相容）',
    gas.describeRuleValue_(0.63, 13) === '13 個主日之中約 8 個');
}

// ⚠️ 第三十輪批次階段 D2：「換算分母」嗰一段搬咗去
// tests/rule_review_pair_denominator.test.js——因為正確嘅對照對象
// 唔係排表引擎嘅進度控制，而係 Verify.gs 嘅品質統計（兩者分母唔同）。

console.log('\n=== A2 邊界：一個主日嘅季度冇「相鄰對」 ===');
{
  check('★★★★★ weeks = 1 ⇒ 相鄰對母體係 0 ⇒ 當查不到，改講百分比'
    + '——**唔可以印「0 對相鄰的主日之中約 0 對」**',
    gas.describeRuleValue_(0.27, 1, 'ADJACENT_PAIR').indexOf('無法換算成次數') !== -1,
    gas.describeRuleValue_(0.27, 1, 'ADJACENT_PAIR'));
  check('★★★★ 而逐個主日喺 weeks = 1 仍然換算得到',
    gas.describeRuleValue_(0.63, 1, 'PER_SUNDAY') === '1 個主日之中約 1 個');
  check('★★★★★ 查不到主日數 ⇒ 兩種單位都改講百分比',
    gas.describeRuleValue_(0.27, null, 'ADJACENT_PAIR').indexOf('％的主日') !== -1
    && gas.describeRuleValue_(0.63, null, 'PER_SUNDAY').indexOf('％的主日') !== -1);
}

console.log('\n=== A2 選項亦要跟單位 ===');
{
  const choices = gas.buildRuleReviewRatioChoices_(0.27, 13, 'ADJACENT_PAIR');
  check('★★★★★ 每個選項都用「對相鄰的主日」，冇一個講「個主日」',
    choices.length > 1
    && choices.every(function (c) {
      return /^\d+ 對相鄰的主日之中約 \d+ 對/.test(c.label);
    }),
    choices.map(function (c) { return c.label; }).join(' ｜ '));
  check('★★★★★ 上限係**母體**（12 對），唔係換算分母'
    + '——13 對相鄰喺一個 13 個主日嘅季度根本唔存在',
    choices.every(function (c) {
      return Number(c.label.match(/約 (\d+) 對/)[1]) <= 12;
    }));
  check('★★★★ 有一個而且只有一個「（維持現狀）」',
    choices.filter(function (c) {
      return c.label.indexOf('（維持現狀）') !== -1;
    }).length === 1);
  check('★★★★★ 「維持現狀」帶嘅係**原值**，唔係反推返嚟嗰個',
    choices.filter(function (c) {
      return c.label.indexOf('（維持現狀）') !== -1;
    })[0].value === 0.27);
}

console.log('\n=== A4 稽核：四條會令堂委做錯決定嘅措辭 ===');
{
  // 1. 準硬規則同洩壓閥喺同一份表上面直接打架，但冇一句講清楚。
  const noConsec = gas.ruleReviewPlainEntry_(IDS.NO_CONSECUTIVE);
  check('★★★★★ 「同一個崗位盡量不要連續」要講明報告係豁免嘅'
    + '——唔講嘅話，同一份表上面兩條規則直接矛盾，堂委唔知信邊條',
    noConsec.what.indexOf('報告就是豁免的') !== -1, noConsec.what);

  // 2. 兩條分佈規則其實係二選一。
  const dist = gas.ruleReviewPlainEntry_(IDS.QUARTER_DISTRIBUTION);
  check('★★★★★ 「每季次數分佈」要講明佢喺個人配額開住嗰陣完全冇行過'
    + '——唔講嘅話堂委會花時間調一個唔會有任何效果嘅數字',
    (dist.note || '').indexOf('那一條開着的時候，這裏改什麼都不會有分別') !== -1,
    dist.note);
  check('★★★★★ 反面：引擎的確係 `else if`（二選一）',
    /isRuleEnabled_\(rules, RULE_IDS\.PERSONAL_QUOTA\)\) \{[\s\S]{0,200}?\} else if \(isRuleEnabled_\(rules, RULE_IDS\.QUARTER_DISTRIBUTION\)\)/
      .test(read('src/Generator.gs')));

  // 3. 優先揀雙資格嗰個數字量嘅唔係主日。
  const dual = gas.ruleReviewPlainEntry_(IDS.CHAIR_PREFER_DUAL);
  check('★★★★★ 講明個數字係「排主席嗰陣揀咗雙資格嘅次數」，'
    + '唔係「有幾多個主日真係兼任咗」（嗰個係另一條規則）',
    dual.what.indexOf('不是「有多少個主日真的兼任了」') !== -1, dual.what);

  // 4. 集中崗位一個都冇填 ⇒ 規則靜靜失效，但畫面寫「有生效」。
  const focus = gas.ruleReviewPlainEntry_(IDS.ROLE_POST_FOCUS);
  const emptyRule = {};
  emptyRule[R.ENABLED] = true;
  emptyRule[R.TARGET_VALUE] = 2;
  emptyRule[R.SCOPE_POST_IDS] = '';
  check('★★★★★ 一個指定崗位都冇填 ⇒ **唔可以寫「有生效」**'
    + '——`evaluateRolePostFocus_()` 喺呢種情況直接當規則未生效',
    focus.current(emptyRule, {}).indexOf('實際上沒有作用') !== -1,
    focus.current(emptyRule, {}));
  check('★★★★★ 而且「這一條在做什麼」都要講返',
    focus.what(emptyRule, {}).indexOf('實際上完全沒有作用') !== -1);

  const filled = {};
  filled[R.ENABLED] = true;
  filled[R.TARGET_VALUE] = 2;
  filled[R.SCOPE_POST_IDS] = 'CHAIR,ANNOUNCE';
  const ctx = { postNameById: { CHAIR: '主席', ANNOUNCE: '報告' } };
  check('★★★★★ 有填 ⇒ **逐個列出中文崗位名**，唔係一句抽象嘅「指定崗位」',
    focus.what(filled, ctx).indexOf('指定崗位是：主席、報告') === 0,
    focus.what(filled, ctx));
  check('★★★★★ 譯唔到中文名嘅代號原樣顯示，唔靜靜略過'
    + '——略過嘅話，一個打錯咗嘅 PostID 就會喺份表上面完全消失',
    focus.what(filled, { postNameById: { CHAIR: '主席' } })
      .indexOf('主席、ANNOUNCE') !== -1);
  check('★★★★ 反面：引擎的確係「一個都冇填就當未生效」',
    /focusPostIds\.length === 0\) return null;/.test(read('src/Generator.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
