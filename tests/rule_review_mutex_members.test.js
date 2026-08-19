// 第二十九輪批次階段 B：互斥組要逐組列出全部成員。
// 執行方式：node tests/rule_review_mutex_members.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測
// ─────────────────────────────────────────────────────────────────────
//
// 匯出寫住 `現時有 1 組：主席。`
// 應該係 `主席 ＋ 聖餐襄禮`。
//
// **一句講唔出對手係邊個嘅衝突規則，等於冇講。**
// 堂委睇到「1 組：主席」，完全唔知主席係同咩衝突，
// 亦即係佢冇辦法就呢一條做任何決定。
//
// ⚠️ 順帶捉埋一個配置錯誤：**得一個成員嘅組完全冇作用。**
// 「同一個人唔可以同一週做同一組入面兩個崗位」——組入面得一個崗位，
// 呢句話永遠成立，即係嗰條規則對嗰一組乜都冇擋過。
// 印一句睇落正常嘅「現時有 1 組：主席」會令人以為條規則喺度做緊嘢
//（bug class 2：缺失被當成正常值靜靜過）。

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

const describe = gas.describeMutexGroupsForReview_;

console.log('\n=== B【核心】一組兩個成員：兩個都要列出 ===');
{
  const text = describe([
    { group: 'G1', postNames: ['主席', '聖餐襄禮'] }
  ]);
  check('★★★★★ 兩個崗位名都出現',
    text.indexOf('主席') !== -1 && text.indexOf('聖餐襄禮') !== -1, text);
  check('★★★★★ 而且係「主席 ＋ 聖餐襄禮」一齊出現，唔係得第一個',
    text.indexOf('主席 ＋ 聖餐襄禮') !== -1, text);
  check('★★★★ 講返總共幾多組',
    text.indexOf('現時有 1 組') === 0, text);
  check('★★★★ 仍然有解釋句（同一週之內…）',
    text.indexOf('同一週之內，同一個人不會同時擔任同一組裡面的崗位。') !== -1);
}

console.log('\n=== B【核心】多過一組：逐組一行 ===');
{
  const text = describe([
    { group: 'G1', postNames: ['主席', '聖餐襄禮'] },
    { group: 'G2', postNames: ['司事', '招待', '司琴'] }
  ]);
  check('★★★★★ 兩組都完整列出（三個成員嗰組唔可以只列兩個）',
    text.indexOf('主席 ＋ 聖餐襄禮') !== -1
    && text.indexOf('司事 ＋ 招待 ＋ 司琴') !== -1, text);
  check('★★★★★ 逐組一行——串埋一行嘅話，堂委要自己數返邊個同邊個一組',
    text.split('\n').filter(function (l) {
      return l.indexOf('　・') === 0;
    }).length === 2, JSON.stringify(text));
  check('★★★★ 數目講啱',
    text.indexOf('現時有 2 組') === 0, text);
}

console.log('\n=== B【核心】得一個成員嘅組 ＝ 配置錯誤，要講出嚟 ===');
{
  const text = describe([{ group: 'G1', postNames: ['主席'] }]);
  check('★★★★★ **唔可以印一句睇落正常嘅「現時有 1 組：主席」**'
    + '——一個崗位嘅組永遠擋唔到任何嘢',
    text.indexOf('實際上不會擋住任何安排') !== -1, text);
  check('★★★★★ 而且要叫人去檢查係咪漏咗設另一個崗位'
    + '——講咗有問題但唔講點做，幹事一樣冇下一步',
    text.indexOf('請檢查是不是漏了設定另一個崗位') !== -1, text);
  check('★★★★ 個崗位名仍然要出（唔可以只講「有問題」）',
    text.indexOf('主席') !== -1);
}

console.log('\n=== B 混合：一組正常、一組得一個 ===');
{
  const text = describe([
    { group: 'G1', postNames: ['主席', '聖餐襄禮'] },
    { group: 'G2', postNames: ['司琴'] }
  ]);
  check('★★★★★ 正常嗰組照樣列全部成員',
    text.indexOf('主席 ＋ 聖餐襄禮') !== -1);
  check('★★★★★ 有問題嗰組單獨標出，唔會連正常嗰組一齊標'
    + '——一個籠統嘅警告會令幹事去改一組本來冇事嘅設定',
    (text.match(/實際上不會擋住任何安排/g) || []).length === 1, text);
}

console.log('\n=== B 零組 ===');
{
  const text = describe([]);
  check('★★★★★ 明講「現時沒有設定任何互斥組合」＋佢嘅後果',
    text.indexOf('現時沒有設定任何互斥組合') === 0
    && text.indexOf('不會擋住任何安排') !== -1, text);
  check('★★★★ `null` 同 `undefined` 都當零組，唔會拋錯'
    + '——`buildRuleReviewContext_()` 讀唔到 Posts 嗰陣就係呢個情況',
    describe(null) === text && describe(undefined) === text);
}

console.log('\n=== B 接返規則定義表 ===');
{
  const entry = gas.ruleReviewPlainEntry_(gas.RULE_IDS.MUTEX_GROUP);
  check('★★★★★ 第 6 條嘅 `what` 真係行 describeMutexGroupsForReview_()'
    + '——另寫一次就係同一件事兩個真相來源',
    typeof entry.what === 'function'
    && entry.what({}, { mutexGroups: [{ group: 'G1', postNames: ['主席', '聖餐襄禮'] }] })
      === describe([{ group: 'G1', postNames: ['主席', '聖餐襄禮'] }]));
  check('★★★★ 冇 ctx 嗰陣當零組（唔會拋錯）',
    entry.what({}, null).indexOf('現時沒有設定任何互斥組合') === 0);
}

console.log('\n=== B 資料來源：仍然係讀 Posts，唔係讀試算表 Description 欄 ===');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppRuleReview.gs'), 'utf8');
  check('★★★★★ `buildRuleReviewContext_()` 由 `readPostsNormalized()` 砌組',
    /readPostsNormalized\(\)\.forEach[\s\S]{0,400}?mutexByGroup\[group\]\.push/.test(src));
  check('★★★★★ 同一組入面**全部**崗位都 push 入去（唔係只 push 第一個）',
    /if \(!mutexByGroup\[group\]\) mutexByGroup\[group\] = \[\];\s*\n\s*mutexByGroup\[group\]\.push/
      .test(src));
  check('★★★★ 讀唔到 Posts 嗰陣有記低，唔會靜靜當「冇組」',
    /log_\('WARN', '規則審閱表讀不到 Posts/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
