// 第二十五輪批次階段 C：生成完成畫面嘅「N 格要人手填」要同區二用同一個判斷。
// 執行方式：node tests/manual_pending_count.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅矛盾
// ─────────────────────────────────────────────────────────────────────
//
// 生成完成畫面寫「另有 39 格是要你人手填的（講員、翻譯、獻花）」＝ 13×3。
// 但區二寫「翻譯未填：0 項（做好了）」，因為嗰一季**冇一日需要翻譯**。
//
// 兩個數字用緊兩套定義，幹事一定會撞板：一邊話有 39 格要填，
// 另一邊話做好晒。
//
// 修法唔係「喺生成嗰邊都寫多次 TranslationRequired 判斷」——
// 兩邊各寫一次就一定會有一日再分岔（本專案燒過好多次）。
// 而係**直接用同一個函式嘅結果**。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'AnnualCombined.gs',
  'WebAppPreQuarter.gs', 'WebAppGenerate.gs'
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

/** 砌一個 planPreQuarterChecklist_() 形狀嘅結果。 */
function pq(counts) {
  const items = [
    { id: 'specialUnconfirmed', label: '特別主日日期未確認', count: counts.special || 0 },
    { id: 'combinedNoSkip', label: '合堂未指定跳過崗位', count: counts.combined || 0 },
    { id: 'preacherEmpty', label: '講員未填', count: counts.preacher || 0 },
    { id: 'translationEmpty', label: '翻譯未填', count: counts.translation || 0 },
    { id: 'flowerEmpty', label: '獻花未填', count: counts.flower || 0 }
  ];
  return {
    undoneItemCount: items.filter(function (i) { return i.count > 0; }).length,
    items: items
  };
}

console.log('\n=== C【核心】翻譯只計真正需要嘅主日 ===');
{
  // 實測嗰一季：13 個主日，全部都唔需要翻譯。
  checkEqual('★★★★★ 13 講員 ＋ 0 翻譯 ＋ 13 獻花 ⇒ 26，**唔係 39**'
    + '——39 就係「13×3」嗰個錯定義，同區二嘅「翻譯 0 項（做好了）」矛盾',
    gas.sumManualFillItems_(pq({ preacher: 13, translation: 0, flower: 13 })), 26);

  checkEqual('★★★★ 有幾日需要翻譯就計嗰幾日',
    gas.sumManualFillItems_(pq({ preacher: 13, translation: 3, flower: 13 })), 29);

  checkEqual('★★★★★ 全部填晒 ⇒ 0',
    gas.sumManualFillItems_(pq({ preacher: 0, translation: 0, flower: 0 })), 0);
}

console.log('\n=== C【核心】唔可以把「特別主日／合堂」嗰兩項加埋落去 ===');
{
  // 嗰兩項唔係「格」，加埋落去個數字就會冇意思。
  checkEqual('★★★★★ 特別主日 2 項、合堂 1 項都唔會加入格數',
    gas.sumManualFillItems_(pq({
      special: 2, combined: 1, preacher: 13, translation: 0, flower: 13
    })), 26);
}

console.log('\n=== C 算唔到時回 -1，唔可以回 0 ===');
{
  checkEqual('★★★★★ undoneItemCount === -1（後端算唔到）⇒ -1'
    + '——回 0 就等於話「檢查過，冇嘢要填」，'
    + '而實情係我哋根本睇唔到有冇嘢要填',
    gas.sumManualFillItems_({ undoneItemCount: -1, items: [] }), -1);
  checkEqual('★★★★ 完全冇傳嘢 ⇒ -1', gas.sumManualFillItems_(null), -1);
  checkEqual('★★★★ items 唔見咗 ⇒ 0（有 undoneItemCount 但冇明細，當成冇格要填）',
    gas.sumManualFillItems_({ undoneItemCount: 0 }), 0);
}

console.log('\n=== C【核心】兩邊用同一個函式，唔係各寫一次 ===');
{
  const fs = require('fs');
  const path = require('path');
  const gen = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppGenerate.gs'), 'utf8');
  const fn = gen.slice(gen.indexOf('function apiGenerateDraftExecute_locked_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ 生成完成用 sumManualFillItems_(preQuarter)，'
    + '而 preQuarter 係 planPreQuarterChecklist_() 出嚟嗰個'
    + '——即係同區二**同一個函式嘅同一次結果**',
    /manualPendingCount: sumManualFillItems_\(preQuarter\)/.test(body)
    && /planPreQuarterChecklist_\(buildPreQuarterChecklistInputs_\(quarterId\)\)/.test(body));

  check('★★★★★ **唔再用** blankBreakdown.manualPendingCount'
    + '（嗰個係「三個崗位全部空格」，冇睇 TranslationRequired）',
    body.indexOf('blankBreakdown.manualPendingCount') === -1);

  check('★★★★★ sumManualFillItems_ 入面冇自己再寫一次翻譯判斷',
    !/translationRequired|TRANSLATION_REQUIRED/.test(
      gen.slice(gen.indexOf('function sumManualFillItems_'),
        gen.indexOf('function countDistinctServiceDates_'))));
}

console.log('\n=== C 前端：-1 唔可以當成 0 ===');
{
  const fs = require('fs');
  const path = require('path');
  const zone1 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  check('★★★★★ 前端用 `> 0` 判斷，所以 -1 唔會顯示成一句「另有 -1 格」',
    /res\.manualPendingCount > 0/.test(zone1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
