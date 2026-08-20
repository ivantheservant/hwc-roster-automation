// 第三十四輪批次丙組：顯示一致性四項 ＋ 丙5 核實。
// 執行方式：node tests/display_consistency_r34.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 四項全部係同一條 bug class：**同一件事有兩個真相來源，而我只更新咗其中一個。**
// ═════════════════════════════════════════════════════════════════════
//
// 丙1　「核對職事表」仍然跟 63% 歷史基準比。拍板要改係第 3265 行嗰次，
//      但當時只改咗「軟規則實測量度」——**而幹事日常會撳嗰個係核對職事表**。
// 丙2　相鄰對嘅措辭：規則審閱表主句冇百分比、但補充句有 ⇒ 自己同自己唔一致。
// 丙3　重發確認畫面兩種日期格式並排（`26/12` vs `2027-12-26`）⇒ 幹事以為改咗。
// 丙4　補寄工具兩個輸入框易填反，而訊息冇指出真正原因。
// 丙5　核實第三十三輪 D3 兩個演練標籤真係改咗。

const { loadGasSource } = require('./helpers/gas_loader');
const fs = require('fs');
const path = require('path');

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

const gas = loadGasSource(['Constants.gs', 'Utils.gs']);
const SRC = function (f) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
};

console.log('\n=== 丙1：核對職事表要跟「本季理論上限」比，唔係跟 63% 基準 ===');
{
  const verify = SRC('Verify.gs');
  const metrics = SRC('SoftRuleMetrics.gs');

  check('★★★★★ Verify.gs 叫 resolveChairEqReference_()'
    + '（修正之前直接印 chairEq.target，即 63% 歷史基準）',
    /resolveChairEqReference_\(/.test(verify));
  check('★★★★★ 而且措辭由 describeChairEqReference_() 出，唔係喺 Verify.gs 自己砌',
    /describeChairEqReference_\(/.test(verify));
  check('★★★★★ 判斷（deviates）都改成跟 reference 比，唔係跟 target 比'
    + '——只改咗顯示、判斷仍然跟舊基準嘅話，個 TRUE/FALSE 仍然係錯',
    /ref\.deviates/.test(verify));

  const bare = verify.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ Verify.gs 嘅「同一人週數比例」嗰行唔再直接印 chairEq.target',
    !/同一人週數比例[\s\S]{0,220}formatPercent_\(chairEq\.target\)/.test(bare),
    '（睇 buildVerifyRows_）');

  check('★★★★★ SoftRuleMetrics.gs 都係叫同一個函式'
    + '——兩邊各寫一份就會再漂移一次，而呢個 bug 本身就係噉嚟',
    /resolveChairEqReference_\(/.test(metrics));
  check('★★★★ 而且冇留低第二份「有上限就用上限、冇就退回基準」嘅判斷',
    !/boundRatio !== null\)\s*\n?\s*\?\s*chairEqCeiling\.boundRatio/.test(metrics));

  check('★★★★★ 算唔到上限就退回同歷史基準比（維持既有行為，唔可以變成唔判斷）',
    /hasCeiling \? ceiling\.boundRatio : baseline/.test(metrics));
}

console.log('\n=== 丙2：相鄰對措辭——百分比出唔出由呼叫端決定，措辭只有一份 ===');
{
  const withPct = gas.describeAdjacentPairTarget_(0.27, 13);
  const noPct = gas.describeAdjacentPairTarget_(0.27, 13, { withPercent: false });

  check('★★★★ 預設仍然有百分比（Verify.gs 既有寫法不變）',
    withPct.text.indexOf('27%') !== -1 && /25\.0%/.test(withPct.note),
    withPct.text + ' / ' + withPct.note);

  check('★★★★★ withPercent:false 嗰陣，**主句同補充句都冇百分比**'
    + '——修正之前主句冇、補充句有，令規則審閱表自己同自己唔一致',
    noPct.text.indexOf('%') === -1 && noPct.note.indexOf('%') === -1,
    noPct.text + ' / ' + noPct.note);
  check('★★★★ 而且唔會留低一對空括號',
    noPct.note.indexOf('（）') === -1, noPct.note);
  check('★★★★★ 兩者嘅對數完全一樣（措辭只有一份，開關只影響百唔百分比）',
    noPct.pairs === withPct.pairs
    && noPct.note.indexOf('3 對') !== -1 && noPct.note.indexOf('4 對') !== -1,
    noPct.note);

  // 剛好整除嗰條路都要跟開關走。
  const exactNoPct = gas.describeAdjacentPairTarget_(0.25, 13, { withPercent: false });
  check('★★★★ 剛好整除嗰條路一樣冇百分比',
    exactNoPct.note.indexOf('%') === -1, exactNoPct.note);

  const review = SRC('RuleReview.gs');
  check('★★★★★ 規則審閱表傳 withPercent:false（佢整體唔放百分比，'
    + '因為堂委揀嘅係選項，而選項本身用對數）',
    /describeAdjacentPairTarget_\(target, weeks, \{ withPercent: false \}\)/.test(review));
  const verifySrc = SRC('Verify.gs');
  check('★★★★ 核對職事表照舊有百分比',
    /describeAdjacentPairTarget_\(announce\.target, context\.serviceDates\.length\)/.test(verifySrc));
}

console.log('\n=== 丙3：重發確認畫面兩邊用同一個日期 formatter ===');
{
  const guards = SRC('WebAppGuards.gs');
  check('★★★★★ currentSummary 直接叫 buildAssignmentSummary_()'
    + '（同 previousSummary 嘅來源——SendLog 嘅 AssignmentSummary——同一個函式）',
    /currentSummary: buildAssignmentSummary_\(/.test(guards));

  const bare = guards.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 唔再喺呢度用原始 serviceDate 自己砌一句'
    + '（嗰個就係 `2027-12-26` 對住 `26/12` 嘅來源）',
    !/currentSummary:[\s\S]{0,120}a\.serviceDate \+/.test(bare));
  check('★★★★ 而且傳埋 timezone（buildAssignmentSummary_ 要靠佢格式化）',
    /buildAssignmentSummary_\([\s\S]{0,120}context\.timezone/.test(guards));
}

console.log('\n=== 丙4：補寄工具兩個輸入框 ===');
{
  check('★★★★★ looksLikeMailStageValue_() 認得出階段名',
    gas.looksLikeMailStageValue_('OFFICIAL') === true
    && gas.looksLikeMailStageValue_('official') === true
    && gas.looksLikeMailStageValue_(' REVIEW ') === true);
  check('★★★★★ 但唔會誤中真正嘅季度（猜錯會令一個真係打錯咗嘅 QuarterID '
    + '收到一句完全唔啱嘅指引，比原本嗰句更難查）',
    gas.looksLikeMailStageValue_('2027T3') === false
    && gas.looksLikeMailStageValue_('2026T4') === false
    && gas.looksLikeMailStageValue_('') === false
    && gas.looksLikeMailStageValue_(null) === false);
  check('★★★★ 唔做模糊比對：`OFFICIALS` 唔算',
    gas.looksLikeMailStageValue_('OFFICIALS') === false);

  const menu = SRC('Menu.gs');
  check('★★★★★ 季度嗰格收到階段名時，直接講「你好像把階段填在季度那一格了」'
    + '——原本嗰句叫幹事去查 RosterVersions，即係去查一件根本冇問題嘅嘢',
    /looksLikeMailStageValue_\(quarterId\)/.test(menu)
    && /把「階段」填在「季度」那一格/.test(menu));
  check('★★★★ 而且講返季度應該點寫', /2027T3 這種/.test(menu));
  check('★★★★★ 兩個提示框各自寫明而家問緊邊一樣',
    /第 1 個問題：季度/.test(menu) && /第 2 個問題：版本號/.test(menu));

  const makeup = SRC('MakeupSend.gs');
  check('★★★★★ 補寄工具第一個框都寫明係問階段', /先問：階段/.test(makeup));
}

console.log('\n=== 丙5：核實第三十三輪 D3 兩個演練標籤 ===');
{
  const menu = SRC('Menu.gs');
  const items = (menu.match(/\.addItem\('([^']*全季流程演練[^']*)'/g) || [])
    .map(function (s) { return s.replace(/\.addItem\('/, '').replace(/'$/, ''); });
  checkEqual('★★★★ 剛好兩項演練', items.length, 2);
  if (items.length === 2) {
    check('★★★★★ 字頭唔同（實測撳錯就係因為字頭一模一樣）',
      items[0].slice(0, 3) !== items[1].slice(0, 3), JSON.stringify(items));
    check('★★★★★ 圖示唔同', items[0].charAt(0) !== items[1].charAt(0), JSON.stringify(items));
    check('★★★★ 一項講「第一段／由頭開始」',
      items.some(function (i) { return /第一段|由頭開始/.test(i); }), JSON.stringify(items));
    check('★★★★ 一項講「接續上一段」',
      items.some(function (i) { return /接續上一段/.test(i); }), JSON.stringify(items));
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
