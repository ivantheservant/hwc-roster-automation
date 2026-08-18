// 第二十二輪批次階段 B：QuarterReset.gs 顯示與清理邏輯三個修正的回歸測試。
// 執行方式：node tests/quarter_reset_display_fixes.test.js
//
// B1：Eligibility.Active 是 boolean，`String(x || '').trim()` 會把 `false`
//     吞成空字串，畫面印出「Active=」睇落好似冇值——改用 displayCellValue_()。
// B2：Eligibility.AddedAt 是 Date 物件，直接 String() 會印出完整帶時區嘅
//     英文長格式——改用 toDateString() 輸出 yyyy-MM-dd。
// B3：受保護版本（Protected=TRUE）嘅 PDF 之前唔會受保護——版本登記行／grid／
//     RosterAssignments 三樣都保得住，但 PDF 冇睇 Protected，照樣被清走。
//     現在改成 PDF 清理直接重用 planQuarterReset_() 已經算好嘅
//     `versionNosToClear`，唔再自己重寫一次判斷。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs']);

// Date 物件經 toDateString() 要用 Utilities.formatDate；測試沙箱嘅 GAS stub
// 一被呼叫就拋錯，所以換一個確定性替身（做法同 officer_date_input.test.js）。
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    if (format !== 'yyyy-MM-dd') throw new Error('測試替身只支援 yyyy-MM-dd');
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }
};

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

console.log('\n=== B1【核心】displayCellValue_：boolean false／數字 0 唔可以同「冇值」混埋 ===');
{
  checkEqual('★★★★★ boolean false ⇒ 顯示 "FALSE"，唔係空字串'
    + '（實測撞到：Eligibility.Active=FALSE 畫面印出「Active=」，睇落好似冇值）'
    + '。第二十四輪再改成全大楷，同幹事喺試算表格入面睇到嘅一致',
    gas.displayCellValue_(false), 'FALSE');
  checkEqual('★★★★ 數字 0 ⇒ 顯示 "0"，唔係空字串（同一個 bug class：0 都係有意義嘅假值）',
    gas.displayCellValue_(0), '0');
  checkEqual('★★★★★ 空字串 ⇒ 用 fallback（呢個先係真係「冇值」）',
    gas.displayCellValue_(''), '（空白）');
  checkEqual('★★★★ null ⇒ 用 fallback', gas.displayCellValue_(null), '（空白）');
  checkEqual('★★★ undefined ⇒ 用 fallback', gas.displayCellValue_(undefined), '（空白）');
  checkEqual('★★★ boolean true ⇒ 顯示 "TRUE"（反向：唔可以因為修 false 而搞埋 true）',
    gas.displayCellValue_(true), 'TRUE');
  checkEqual('★★★ 自訂 fallback 文字', gas.displayCellValue_(null, '（未設定）'), '（未設定）');
  checkEqual('★★ 非空字串照原樣顯示', gas.displayCellValue_('COMMITTEE'), 'COMMITTEE');
}

console.log('\n=== B2【核心】Eligibility.AddedAt：Date 物件要轉成 yyyy-MM-dd，唔係英文長格式 ===');
{
  const asDate = new Date(Date.UTC(2026, 7, 13));   // 2026-08-13
  checkEqual('★★★★★ Date 物件 ⇒ yyyy-MM-dd'
    + '（實測撞到：直接 String(dateObj) 印出 "Thu Aug 13 2026 00:00:00 GMT+1200 …"）',
    gas.toDateString(asDate, 'Pacific/Auckland'), '2026-08-13');
  checkEqual('★★★ 空字串 ⇒ 空字串（冇加入時間就唔顯示，唔係印 fallback 文字——'
    + '呢個欄位喺 Menu.gs 自己用 `e.addedAt ? … : \'\'` 判斷有冇值）',
    gas.toDateString('', 'Pacific/Auckland'), '');
}

console.log('\n=== B1／B2：正式碼真係改用咗新寫法，唔係淨係測一份移植版本 ===');
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'QuarterReset.gs'), 'utf8');
  check('★★★★★ Active 欄位用 displayCellValue_()，唔再用 `|| \'\'`',
    /active:\s*displayCellValue_\(row\[E\.ACTIVE\]\)/.test(source), source);
  check('★★★★★ AddedAt 欄位用 toDateString()，唔再直接 String()',
    /addedAt:\s*toDateString\(row\[E\.ADDED_AT\],\s*timezone\)/.test(source), source);
}

// ---------------------------------------------------------------------
// B3：PDF 清理要重用 versionNosToClear，唔可以自己再判斷一次
// ---------------------------------------------------------------------

/** 移植：PDF 篩選邏輯（QuarterReset.gs 的 RosterPDF 段落，改用 versionNosToClear 之後）。 */
function planPdfSelection(files, versionNosToClear) {
  return files.filter(function (f) { return versionNosToClear[f.versionNo] === true; });
}

console.log('\n=== B3【核心】受保護版本（Protected=TRUE）嘅 PDF 唔會被清 ===');
{
  // 同 quarter_reset_plan.test.js 一致的版本篩選結果：v1（受保護）唔喺
  // versionNosToClear 入面，v2（唔受保護）先喺。
  const versionNosToClear = { 2: true };   // v0 唔選、v1 受保護 → 淨係 v2 入面
  const files = [
    { name: '2027T1_v0_張三.pdf', versionNo: 0 },
    { name: '2027T1_v1_李四.pdf', versionNo: 1 },   // 受保護，唔應該入清單
    { name: '2027T1_v2_王五.pdf', versionNo: 2 }
  ];
  const toDelete = planPdfSelection(files, versionNosToClear);
  checkEqual('★★★★★ 只有 v2 嘅 PDF 入清理清單，v0（未選）同 v1（受保護）都唔會'
    + '（之前 v1 受保護但 PDF 冇睇 Protected，一樣會被清——保護做咗一半）',
    toDelete.map(function (f) { return f.name; }), ['2027T1_v2_王五.pdf']);
}

console.log('\n=== B3：正式碼 PDF 段落真係改用 versionNosToClear，唔再自己重寫一次判斷 ===');
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'QuarterReset.gs'), 'utf8');

  // 第二十六輪批次階段 B：迴圈由 `while + continue` 改成
  // `listRosterPdfFilesForQuarter_().forEach + return`（要掃埋子資料夾）。
  // 保留嘅意圖係「用同一個 versionNosToClear，唔自己再判斷一次」，
  // 唔係「一定要用 continue」——所以斷言唔再鎖死跳出方式。
  check('★★★★★ PDF 篩選改用 versionNosToClear[versionNo]',
    /if \(!versionNosToClear\[versionNo\]\) (continue|return);/.test(source), source);
  check('★★★★★ 而且經共用入口掃檔（根資料夾＋季度/版本子資料夾都要計）'
    + '——自己 getFiles() 就會漏掉子資料夾嗰批，重設之後舊 PDF 會留低',
    /listRosterPdfFilesForQuarter_\(quarterId\)/.test(source));

  // versionNosToClear 喺 PDF 段落之前已經宣告過一次（版本篩選果度），
  // 呢個 regex 確保成個函式入面淨係得一句 `const versionNosToClear = {}`——
  // 如果 PDF 段落自己又宣告多一次，就代表冇真正重用，係抄咗一份。
  const planFnMatch = source.match(/function planQuarterReset_[\s\S]*?\n}\n/);
  check('★★★★ planQuarterReset_() 入面 versionNosToClear 淨係宣告一次（唔係抄多份）',
    !!planFnMatch && (planFnMatch[0].match(/const versionNosToClear = \{\}/g) || []).length === 1,
    planFnMatch ? (planFnMatch[0].match(/const versionNosToClear = \{\}/g) || []).length : 'no match');
}

// ---------------------------------------------------------------------
// 階段 C 掃描時喺 Diagnostics.gs 搵到同一個 bug class 嘅另外兩個位
// （Protected 同 ParentVersionNo），一併鎖住。
// ---------------------------------------------------------------------

console.log('\n=== 階段 C 順帶發現：Diagnostics.gs 嘅 RosterVersions 報告同一個 bug class ===');
{
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'Diagnostics.gs'), 'utf8');
  check('★★★★ Protected 欄位用 displayCellValue_()'
    + '（之前 `String(v[V.PROTECTED] || \'\')`，受保護版本會印成 "Protected="）',
    /displayCellValue_\(v\[V\.PROTECTED\]\)/.test(source), source);
  check('★★★★ ParentVersionNo 欄位用 displayCellValue_()'
    + '（之前 v0 做 Parent 時，`0 || \'\'` 會印成 "Parent=v" 冇個位）',
    /displayCellValue_\(v\[V\.PARENT_VERSION_NO\]\)/.test(source), source);
  check('★★★ CreatedAt 欄位用 toDateString()，唔再直接 String(Date)',
    /toDateString\(v\[V\.CREATED_AT\], timezone\)/.test(source), source);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
