// 第四十一輪批次 D 組：崗位名單——逐項確認 ＋ 一併加入新人。
// 執行方式：node tests/eligibility_sheet_item_pick.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 實測第 3 步嗰陣撞到四件事：
//
//   一、佢喺「音響」欄打咗一個新人嘅名 ⇒ **成張表都套用唔到**，
//       而畫面淨係叫佢「去第二個地方加呢個人」。
//   二、佢改一欄嗰陣順手碰到咗另一欄，預覽一出嚟先發現，
//       而當時得「全部套用」同「取消」兩個出口。
//   三、「會移走」嗰段淨係講咗「停用不是刪除」，
//       冇答到佢真正想知嘅「噉現有嗰幾格點算」。
//   四、字太細。
//
// ⚠️ 呢一份最核心嗰幾條係關於**篩選之後仲有冇第二個來源**：
// 呢個專案最常出現嗰類 bug 就係「兩個來源，只更新咗一個」。
// 篩走咗嘅項如果仲有任何一段碼讀返 `plan.added`，
// 畫面會話「略過咗 2 項」而系統照樣寫入——而嗰種錯完全睇唔出。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'EligibilitySheetEditor.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'EligibilitySheetEditor.gs'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScriptMainFlow.html'), 'utf8');
const zone1 = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScriptZone1.html'), 'utf8');
const style = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'Style.html'), 'utf8');

// 剝走註解先做比對——斷言撞正註解入面嗰句就會綠燈，而實際嗰行碼可以係壞嘅。
const bare = function (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};
const srcBare = bare(src);
const uiBare = bare(ui);
const zone1Bare = bare(zone1);

// 一份**由真入口嘅形狀**砌出嚟嘅 plan：每一項都自己帶住 `key`，
// 而 `key` 一定係 `buildEligibilityChangeKey_()` 出嘅。
// FIXTURE-OK：呢個唔係「系統寫入嘅資料」，係一個純函式嘅輸入；
// 而且下面第一條斷言就係驗佢嘅 key 同真正嗰個產生器一致。
function makePlan() {
  return {
    added: [
      { postId: 'P1', postNameTC: '音響', personId: 'X1', nameTC: '測試甲',
        key: gas.buildEligibilityChangeKey_('ADD', 'X1', 'P1') },
      { postId: 'P2', postNameTC: '司事', personId: 'X2', nameTC: '測試乙',
        key: gas.buildEligibilityChangeKey_('ADD', 'X2', 'P2') }
    ],
    removed: [
      { postId: 'P1', postNameTC: '音響', personId: 'X3', nameTC: '測試丙',
        assignedCount: 3, assignedDates: ['2027-01-03', '2027-02-07', '2027-03-07'],
        key: gas.buildEligibilityChangeKey_('REMOVE', 'X3', 'P1') }
    ]
  };
}

// =====================================================================
console.log('\n=== D【核心】冇傳勾選 ⇒ 同今日一模一樣 ===');
{
  const plan = makePlan();
  [undefined, null].forEach(function (nothing) {
    const r = gas.filterEligibilityPlanBySelection_(plan, nothing);
    checkEqual('★★★★★ ' + JSON.stringify(nothing) + ' ⇒ 全部保留'
      + '（選單、舊畫面、診斷工具都可能唔傳，唔可以變成「乜都唔做」）',
      [r.added.length, r.removed.length, r.skipped.length], [2, 1, 0]);
  });
}

console.log('\n=== D【核心】傳咗勾選 ⇒ 只做勾住嗰啲 ===');
{
  const plan = makePlan();
  const r = gas.filterEligibilityPlanBySelection_(plan, [plan.added[0].key]);
  checkEqual('★★★★★ 淨係勾咗一項 ⇒ 只留低嗰一項',
    r.added.map(function (a) { return a.nameTC; }), ['測試甲']);
  checkEqual('★★★★★ 冇勾嗰啲一項都唔會做', r.removed.length, 0);
  checkEqual('★★★★★ 而且**略過咗幾多項要數返出嚟**'
    + '——畫面淨係話「已經加入 1 項」嘅話，幹事分唔出係照佢意思略過咗，'
    + '定係連佢勾咗嗰啲都漏做',
    r.skipped.length, 2);
}

console.log('\n=== D【核心】一項都冇勾 ⇒ 唔可以變成「全部做」 ===');
{
  // ⚠️ 呢一條係整組最重要嘅。空陣列同「冇傳」喺 JavaScript 入面
  // 好易被同一句 `if (!selectedKeys)` 一齊當成 falsy——
  // 噉樣佢逐項揀走晒之後撳確定，會**全部套用**。
  const plan = makePlan();
  const r = gas.filterEligibilityPlanBySelection_(plan, []);
  checkEqual('★★★★★ 空陣列 ⇒ 一項都唔做（唔係全部做）',
    [r.added.length, r.removed.length], [0, 0]);
  checkEqual('★★★★★ 而且三項全部算入「略過」', r.skipped.length, 3);
  check('★★★★★ 實作上唔可以用 `if (!selectedKeys)` 咁樣判斷'
    + '——空陣列會被當成 falsy，而空陣列嘅意思係「一項都唔要」',
    /selectedKeys === null \|\| selectedKeys === undefined/.test(srcBare), '');
}

console.log('\n=== D【核心】勾咗但重算之後冇咗嘅項要講出嚟 ===');
{
  const plan = makePlan();
  const gone = gas.buildEligibilityChangeKey_('ADD', 'X9', 'P9');
  const r = gas.filterEligibilityPlanBySelection_(plan, [plan.added[0].key, gone]);
  checkEqual('★★★★★ 冇咗嘅項要回報，唔可以靜靜略過'
    + '（佢睇緊預覽嗰陣又去改咗嗰張表，係完全正常嘅事）',
    r.vanished, [gone]);
  checkEqual('★★★★ 而仲存在嗰項照做', r.added.length, 1);
  check('★★★★★ 而且畫面真係會顯示出嚟'
    + '——後端數啱咗而畫面唔講，等於冇做',
    /r\.vanished && r\.vanished\.length > 0/.test(uiBare), '');
}

console.log('\n=== D【核心】篩完之後唔可以再有第二個來源 ===');
{
  // ⚠️ 呢個專案最常出現嗰類 bug：兩個來源，只更新咗一個。
  // 具體形態：畫面話「略過咗 2 項」，而寫入嗰段讀返 `plan.added`，
  // 結果嗰兩項照樣寫入——而完全睇唔出。
  const apiAt = srcBare.indexOf('function apiApplyEligibilitySheet');
  const body = srcBare.slice(apiAt);
  const afterPick = body.slice(body.indexOf('const pick = filterEligibilityPlanBySelection_'));
  check('★★★★★ 篩選之後**一次都冇**再讀 `plan.added` ／ `plan.removed`',
    !/plan\.(added|removed)/.test(afterPick),
    (afterPick.match(/.*plan\.(added|removed).*/g) || []).join('\n'));
  check('★★★★★ 寫入用嘅係 `pick.removed`',
    /pick\.removed\.forEach/.test(afterPick), '');
  check('★★★★★ 寫入用嘅係 `pick.added`',
    /pick\.added\.forEach/.test(afterPick), '');
  check('★★★★★ 回報「仲排緊」嗰批都係由 `pick` 嚟'
    + '——由 `plan` 嚟嘅話，佢會見到幾個佢明明勾走咗嘅人',
    /stillAssigned: pick\.removed\.filter/.test(afterPick), '');
}

console.log('\n=== D：仍然重新計算預覽，唔信前端 ===');
{
  const apiAt = srcBare.indexOf('function apiApplyEligibilitySheet');
  const body = srcBare.slice(apiAt, apiAt + 1200);
  check('★★★★★ 一入嚟就自己重新算一次 `planEligibilitySheetApply_()`'
    + '——照住一份舊預覽寫入就會寫錯，而畫面上睇唔出',
    /const plan = planEligibilitySheetApply_\(quarterId\);/.test(body), '');
  check('★★★★★ 認唔出名字嗰個閘仲喺度（勾選唔可以繞過佢）',
    body.indexOf('if (plan.blocked)') !== -1
      && body.indexOf('if (plan.blocked)') < body.indexOf('filterEligibilityPlanBySelection_'),
    '');
  check('★★★★ 一項都冇勾嘅時候唔會扮成功',
    /一項都沒有勾選，所以一項都沒有寫入/.test(src), '');
}

console.log('\n=== D【核心】key 只有一個產生者 ===');
{
  check('★★★★★ 只有 `buildEligibilityChangeKey_()` 砌得出'
    + '（畫面自己再砌一次嘅話，格式一改就會「勾咗但套用唔到」）',
    /key: buildEligibilityChangeKey_\('ADD'/.test(srcBare)
      && /key: buildEligibilityChangeKey_\('REMOVE'/.test(srcBare), '');
  check('★★★★★ 畫面只係把收到嗰個 `key` 原樣送返出去，冇自己砌',
    /\.map\(\(x\) => x\.key\)/.test(uiBare) && !/'ADD\|'/.test(uiBare), '');
  checkEqual('★★★★ 格式係 `kind|personId|postId`',
    gas.buildEligibilityChangeKey_('ADD', 'P9001', 'POST1'), 'ADD|P9001|POST1');
  check('★★★★★ ADD 同 REMOVE 唔會撞'
    + '——撞咗嘅話，勾住「加入某人」會連「移走佢」都一齊做',
    gas.buildEligibilityChangeKey_('ADD', 'A', 'B')
      !== gas.buildEligibilityChangeKey_('REMOVE', 'A', 'B'), '');
}

// =====================================================================
console.log('\n=== D：〔這是新人，一併加入〕走返同一粒掣 ===');
{
  check('★★★★★ 用返 `openAddUnresolvedPerson()`（第四十輪嗰一粒），唔係另寫一份'
    + '——寫兩份嘅話，兩邊嘅撞名提示同冇電郵提示會慢慢長得唔一樣',
    /openAddUnresolvedPerson\(u, openApplyEligibilitySheet\)/.test(uiBare), '');
  check('★★★★★ 而嗰粒掣「加完之後行乜」係參數，唔係寫死',
    /function openAddUnresolvedPerson\(u, onDone\)/.test(zone1Bare)
      && /const done = onDone \|\| openSaveAndConfirm;/.test(zone1Bare), '');
  check('★★★★★ 兩條完成路徑都行返 `done()`，冇一條漏咗'
    + '（漏一條嘅話，喺第 3 步加完人會跳返去第 2 步嗰個畫面）',
    (zone1Bare.match(/\bdone\(\);/g) || []).length >= 2, '');
  check('★★★★★ 只有「認唔出嘅人名」先加得到人'
    + '——「崗位代號對唔上」多數係整欄貼錯位，加一個人解決唔到，'
    + '加咗仲會掩蓋咗真正嘅問題',
    /if \(u\.kind === 'UNKNOWN_NAME'\)/.test(uiBare), '');
  check('★★★★ 而 UNKNOWN_POST 嗰種要講返佢應該去做咩',
    /整欄貼錯了位置/.test(ui), '');
  check('★★★★★ 後端有帶 `postNameTC` 出去'
    + '——加人嗰個對話框會問「同時讓他可以做○○」，'
    + '得 postId 嘅話嗰句會變成一串代號',
    /kind: 'UNKNOWN_NAME', postId: postId, postNameTC: postNameById\[postId\]/.test(srcBare), '');
}

console.log('\n=== D：「會移走」要講齊三件事 ===');
{
  check('★★★★★ （一）以後唔會再被自動排',
    /以後重新生成，系統不會再自動排他做這個崗位/.test(ui), '');
  check('★★★★★ （二）現有格唔會被拎走',
    /現有職事表上已經排好的格不會被拿走/.test(ui), '');
  check('★★★★★ （三）停用唔係刪除',
    /這是「停用」，不是刪除/.test(ui), '');
  check('★★★★★ 而且要講**邊幾個主日**，唔係淨係一個數字'
    + '——一個佢核對唔到嘅數字，同冇講差唔多',
    /r\.assignedDates \|\| \[\]/.test(uiBare) && /humanDate\(d\)/.test(uiBare), '');
  check('★★★★★ 後端真係有出嗰批日期',
    /assignedDates\[key\]\.push\(toDateString\(row\[A\.SERVICE_DATE\], tz\)\)/.test(srcBare), '');
  check('★★★★ 日期有排序（亂序嘅話佢對唔到住職事表睇）',
    /\(assignedDates\[key\] \|\| \[\]\)\.sort\(\)/.test(srcBare), '');
}

console.log('\n=== D：逐項勾選嘅預設同計數 ===');
{
  check('★★★★★ 預設**全部勾好**'
    + '——佢嘅情況係大部分項都係佢想要嘅，得一兩項唔要。'
    + '預設唔勾嘅話，佢每次要撳幾十下先做得返今日一撳就做到嘅嘢',
    /cb\.checked = eligSkip_\[key\] !== true;/.test(uiBare), '');
  check('★★★★★ 有一行講「會套用 N 項，略過 M 項」，而且會即時更新',
    /會套用 ' \+ \(total - skipped\) \+ ' 項，略過 ' \+ skipped \+ ' 項/.test(uiBare), '');
  check('★★★★★ 每次重新讀都清走上一次嘅勾選'
    + '——留住嘅話，畫面上個勾係打咗開，而實際仲係略過緊',
    /eligSkip_ = \{\};\s*\n\s*renderEligibilitySheetPlan\(plan\)/.test(uiBare), '');
}

console.log('\n=== D：字太細 ===');
{
  check('★★★★ 有一個 `dlg-lg` scope', /\.dlg-lg \{/.test(style), '');
  check('★★★★★ 而且**冇改任何現有 selector**'
    + '（Style.html 因為改現有規則出過兩次事）——每一條都有 `.dlg-lg` 前綴',
    (style.match(/^\s*\.dlg-lg[^\n]*\{/gm) || []).length >= 1
      && !/dlg-lg[^\n]*!important/.test(style), '');
  check('★★★★ 第 3 步嗰個彈窗有用到佢',
    /className: 'dlg-lg'/.test(uiBare), '');
  check('★★★★ 勾選框本身都大咗（手指撳得中先算得上「勾得到」）',
    /\.dlg-lg \.check-row input\[type="checkbox"\]/.test(style), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
