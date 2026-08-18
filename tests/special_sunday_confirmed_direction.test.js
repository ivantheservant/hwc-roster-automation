// 第二十四輪批次階段 F1：`SpecialSundays.Confirmed` 欄嘅方向。
// 執行方式：node tests/special_sunday_confirmed_direction.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要專門為一個 checkbox 寫一個測試檔
// ─────────────────────────────────────────────────────────────────────
//
// `isUnconfirmedSpecialSunday_()` 嘅定義係：
//
//   **空白＝已確認，只有明確 FALSE 先算未確認。**
//
// 呢個方向**同直覺相反**（一般會以為「已確認」寫 TRUE）。刻意噉揀嘅理由：
// 呢一欄係後加嘅，如果空白當「未確認」，全部既有列一開機就會變成未確認，
// 提醒機制即刻噴一堆假警報。
//
// ⚠️ **搞反嘅後果特別陰濕**：全季嘅特別主日會由「已確認」變成「未確認」
// （或者相反），而**畫面上睇落完全正常**——checkbox 顯示嘅係你啱啱勾嗰個
// 狀態，唔係試算表真正存咗咩。要等到下一次開頁、或者提醒機制噴警報，
// 先會發現。
//
// 所以呢個方向要有一個**單一入口**（`toConfirmedCellValue_()`／
// `isConfirmedCheckboxOn_()`）＋一個專門嘅測試鎖死。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'AnnualCombined.gs',
  'WebAppPreQuarter.gs', 'WebAppPreQuarterEdit.gs'
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

const S = gas.COLUMNS.SPECIAL_SUNDAYS;
function rowWithConfirmed(value) {
  const r = {};
  r[S.CONFIRMED] = value;
  return r;
}

console.log('\n=== F1【核心】寫入方向：勾咗＝空白，未勾＝FALSE ===');
{
  checkEqual('★★★★★ 幹事**勾咗**「日期已確認」⇒ 寫入**空白**'
    + '（唔係 TRUE！空白先係「已確認」）',
    gas.toConfirmedCellValue_(true), '');

  checkEqual('★★★★★ 幹事**未勾** ⇒ 寫入 `FALSE`',
    gas.toConfirmedCellValue_(false), 'FALSE');

  checkEqual('★★★★ 傳咗個唔係 true 嘅值（undefined）⇒ 當成未勾，寫 FALSE'
    + '（保守方向：寧可多提醒一次，都好過靜靜當成已確認）',
    gas.toConfirmedCellValue_(undefined), 'FALSE');
  checkEqual('★★★★ 傳 null ⇒ 同樣當成未勾', gas.toConfirmedCellValue_(null), 'FALSE');
}

console.log('\n=== F1【核心】讀取方向：同 isUnconfirmedSpecialSunday_ 完全相反 ===');
{
  checkEqual('★★★★★ Confirmed 空白 ⇒ checkbox **勾住**（已確認）',
    gas.isConfirmedCheckboxOn_(rowWithConfirmed('')), true);
  checkEqual('★★★★★ Confirmed = FALSE ⇒ checkbox **唔勾**（未確認）',
    gas.isConfirmedCheckboxOn_(rowWithConfirmed('FALSE')), false);
  checkEqual('★★★★ Confirmed = TRUE ⇒ checkbox 勾住',
    gas.isConfirmedCheckboxOn_(rowWithConfirmed('TRUE')), true);
  checkEqual('★★★ Confirmed 係 null ⇒ 當成空白 ⇒ 勾住',
    gas.isConfirmedCheckboxOn_(rowWithConfirmed(null)), true);
}

console.log('\n=== F1【核心】來回一轉（round-trip）：讀出嚟 → 寫返入去 → 意思唔可以變 ===');
{
  // 呢個係最實際嘅情境：幹事開個畫面、乜都唔改、撳「儲存這一行」。
  // 如果方向搞反，呢個「乜都冇做」嘅動作就會靜靜改變狀態。
  [
    { cell: '', desc: '空白（已確認）' },
    { cell: 'FALSE', desc: 'FALSE（未確認）' },
    { cell: 'TRUE', desc: 'TRUE（已確認）' }
  ].forEach(function (c) {
    const checkboxState = gas.isConfirmedCheckboxOn_(rowWithConfirmed(c.cell));
    const writtenBack = gas.toConfirmedCellValue_(checkboxState);
    const meaningBefore = gas.isUnconfirmedSpecialSunday_(rowWithConfirmed(c.cell));
    const meaningAfter = gas.isUnconfirmedSpecialSunday_(rowWithConfirmed(writtenBack));

    checkEqual('★★★★★ ' + c.desc + '：開畫面乜都唔改再儲存，'
      + '「未確認」嘅判斷唔可以變（否則等於靜靜改咗資料）',
      meaningAfter, meaningBefore);
  });
}

console.log('\n=== F1：同 planPreQuarterChecklist_ 嘅計數一致 ===');
{
  // 方向如果同區二嘅計數對唔上，就會出現「畫面勾咗，但上面仍然話未做」
  // 呢種令人完全唔知信邊個嘅情況。
  const makeRow = function (confirmed) {
    const r = {};
    r[S.ACTIVE] = 'TRUE';
    r[S.CONFIRMED] = confirmed;
    r[S.TYPE] = '浸禮';
    r[S.SKIP_POST_IDS] = 'WORSHIP';
    return r;
  };
  const countUnconfirmed = function (confirmed) {
    return gas.planPreQuarterChecklist_({
      specialRows: [makeRow(confirmed)],
      serviceDates: [], filledByDatePost: {},
      preacherPostId: null, translationPostId: null, flowerPostId: null
    }).items.filter(function (i) { return i.id === 'specialUnconfirmed'; })[0].count;
  };

  checkEqual('★★★★★ 幹事勾咗 ⇒ 寫空白 ⇒ 區二計數 0（唔會再顯示「未做」）',
    countUnconfirmed(gas.toConfirmedCellValue_(true)), 0);
  checkEqual('★★★★★ 幹事未勾 ⇒ 寫 FALSE ⇒ 區二計數 1（會顯示「未做」）',
    countUnconfirmed(gas.toConfirmedCellValue_(false)), 1);
}

console.log('\n=== F1：前端唔可以自己另做一次轉換 ===');
{
  const front = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8');

  check('★★★★★ 前端只傳 checkbox 狀態（confirmedChecked），'
    + '**唔喺前端自己轉成 TRUE／FALSE／空白**'
    + '——兩邊各有一套轉換，遲早有一邊搞反',
    /confirmedChecked: confirmedCb\.checked/.test(front));
  check('★★★★★ 前端完全冇出現 Confirmed 欄嘅字面值轉換',
    !/Confirmed['"]?\s*[:=]\s*['"](TRUE|FALSE)['"]/.test(front));

  const back = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppPreQuarterEdit.gs'), 'utf8');
  check('★★★★★ 後端寫入一律經 toConfirmedCellValue_()，冇第二條路',
    (back.match(/toConfirmedCellValue_\(/g) || []).length >= 3);
  check('★★★★ 讀取一律經 isConfirmedCheckboxOn_()，'
    + '而佢自己行返 isUnconfirmedSpecialSunday_() 呢個唯一判斷入口',
    /function isConfirmedCheckboxOn_[\s\S]{0,200}?isUnconfirmedSpecialSunday_\(row\)/.test(back));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
