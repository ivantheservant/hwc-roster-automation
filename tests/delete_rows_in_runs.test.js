// 第六十五輪批次 AA 組：重設季度／清理孤兒版本逐行刪除，有超時風險。
// 執行方式：node tests/delete_rows_in_runs.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 回歸測試）
// ═════════════════════════════════════════════════════════════════════
//
//   「⚠️⚠️ 重設季度測試資料」2028T3（RosterAssignments 2184 行）用咗 30 多分鐘，
//   2028T2（1092 行）約 11 分鐘；清理孤兒版本（273 行）約 5 分鐘。
//   行數以約每秒 2.5 行下降。
//
// 成因：`deleteRowsMatching_()`（QuarterReset.gs）收集行號之後
// `targetRows.forEach(sheet.deleteRow)`——每行一次 API 呼叫。同類寫法：
// SendLogMaintenance.gs、Archive.gs、SelfTestRunner.gs。
//
// 做法：`deleteSheetRowsInRuns_()`（Utils.gs）——去重、排序、合併成連續區段，
// 由下而上 `deleteRows(start, count)`。刪邊幾行同逐行刪完全一樣，
// 呼叫次數 ＝ 區段數。
//
// 用 mock_sheets_realistic.js：`deleteRow`／`deleteRows` 都會真係刪而且下面嘅行上移。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'QuarterReset.gs']);

/** 一張 25 行資料嘅表（第 3–27 行），第一欄係 `R<原本行號>`，方便睇刪咗邊幾行。 */
function freshSheet(name) {
  const ss = new RealisticMockSpreadsheet();
  const rows = [];
  for (let r = 3; r <= 27; r++) rows.push({ ID: 'R' + r, Q: r % 2 === 0 ? 'KEEP' : 'X' });
  const sheet = seedSheet(ss, name || 'T', ['編號', '季度'], ['ID', 'Q'], rows);
  return { ss: ss, sheet: sheet };
}
function idsOf(sheet) {
  const last = sheet.getLastRow();
  if (last < 3) return [];
  return sheet.getRange(3, 1, last - 2, 1).getValues().map(function (r) { return r[0]; });
}

// =====================================================================
console.log('\n=== AA【核心】不連續行號：結果同逐行刪完全一樣，呼叫次數 ＝ 區段數 ===');
{
  const target = [3, 4, 5, 9, 10, 20];
  const ref = freshSheet();
  target.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { ref.sheet.deleteRow(r); });

  const t = freshSheet();
  t.sheet.deleteRowsCalls = 0;
  const n = gas.deleteSheetRowsInRuns_(t.sheet, target);
  check('★★★★★★ 刪完嘅內容同「由下往上逐行刪」一模一樣',
    JSON.stringify(idsOf(t.sheet)) === JSON.stringify(idsOf(ref.sheet)), JSON.stringify(idsOf(t.sheet)));
  check('★★★★★ 刪咗 6 行', n === 6 && idsOf(t.sheet).length === 19, n);
  check('★★★★★★ deleteRows 只叫咗 3 次（3–5、9–10、20 三段）——唔係 6 次',
    t.sheet.deleteRowsCalls === 3, t.sheet.deleteRowsCalls);
  check('★★★★ 被刪嗰幾行真係唔見咗', ['R3', 'R4', 'R5', 'R9', 'R10', 'R20'].every(function (id) {
    return idsOf(t.sheet).indexOf(id) === -1;
  }));
}

console.log('\n=== AA：亂序、重複、全部連續、空名單 ===');
{
  const t = freshSheet();
  t.sheet.deleteRowsCalls = 0;
  const n = gas.deleteSheetRowsInRuns_(t.sheet, [10, 3, 9, 5, 4, 20, 4, 9]);
  check('★★★★★ 亂序加重複 ⇒ 去重後 6 行、3 段', n === 6 && t.sheet.deleteRowsCalls === 3, n + ' / ' + t.sheet.deleteRowsCalls);
  const c = freshSheet();
  c.sheet.deleteRowsCalls = 0;
  gas.deleteSheetRowsInRuns_(c.sheet, [5, 6, 7, 8, 9, 10, 11, 12]);
  check('★★★★★ 一整段連續 ⇒ 一次', c.sheet.deleteRowsCalls === 1 && idsOf(c.sheet).length === 17);
  const e = freshSheet();
  e.sheet.deleteRowsCalls = 0;
  check('★★★★ 空名單 ⇒ 0、唔叫', gas.deleteSheetRowsInRuns_(e.sheet, []) === 0 && e.sheet.deleteRowsCalls === 0);
}

console.log('\n=== AA【核心】deleteRowsMatching_()（重設季度）用一段一段刪 ===');
{
  const ref = freshSheet('Q');
  const t = freshSheet('Q');
  t.sheet.deleteRowsCalls = 0;
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return t.ss; } };
  const errors = [];
  const n = gas.deleteRowsMatching_('Q', function (rec) { return rec.Q === 'X'; }, errors);
  // 參照：逐行刪奇數行號（Q=X）
  for (let r = 27; r >= 3; r--) if (r % 2 !== 0) ref.sheet.deleteRow(r);
  check('（前置）冇錯', errors.length === 0, errors.join());
  check('★★★★★★ 刪嘅行同逐行刪一樣（只剩 KEEP）',
    JSON.stringify(idsOf(t.sheet)) === JSON.stringify(idsOf(ref.sheet)), JSON.stringify(idsOf(t.sheet)));
  check('★★★★★ 回傳刪咗幾行（13）', n === 13, n);
  check('★★★★★★ 冇用逐行 deleteRow：呼叫次數 ＝ 區段數（13 段，因為隔行）',
    t.sheet.deleteRowsCalls === 13, t.sheet.deleteRowsCalls);

  const block = freshSheet('Q');
  block.sheet.deleteRowsCalls = 0;
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return block.ss; } };
  gas.deleteRowsMatching_('Q', function (rec) { return Number(String(rec.ID).slice(1)) >= 10; }, []);
  check('★★★★★★ 同一季嘅派工通常連續 ⇒ 18 行一次刪完（唔係 18 次）',
    block.sheet.deleteRowsCalls === 1 && idsOf(block.sheet).length === 7, block.sheet.deleteRowsCalls);
}

console.log('\n=== AA：四處都改用共用函式，冇殘留逐行 deleteRow ===');
{
  ['src/QuarterReset.gs', 'src/SendLogMaintenance.gs', 'src/Archive.gs', 'src/SelfTestRunner.gs']
    .forEach(function (f) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      check('★★★★★ ' + f + '：用 deleteSheetRowsInRuns_()，冇 .deleteRow(',
        /deleteSheetRowsInRuns_\(/.test(code) && !/\.deleteRow\(/.test(code), f);
    });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
