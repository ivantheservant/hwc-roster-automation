// 第十三輪批次階段 B：全面稽核「重寫已存在工作表」嘅寫入點。
// 執行方式：node tests/sheet_write_patterns.test.js
//
// 結論（完整說明見 docs/系統範圍稽核.md 第十三輪批次階段 B）：全專案
// 逐一檢查會設定版面（merge／setFrozenRows／setFrozenColumns／
// setColumnWidth／setDataValidation 等）嘅寫入點之後，發現**風險只集中
// 喺一個地方**——`PublicRoster.gs`（`.merge()` 全專案得呢一個檔案用到），
// 已經修正（改用 `resetSheetToBlankSlate_()`，見 tests/public_roster_write.test.js）。
// 其餘寫入點全部屬於下面兩種本身就安全嘅模式，唔需要（亦唔應該）強行
// 套用 resetSheetToBlankSlate_()：
//
//   模式一「刪除重建」（SelfTest.gs／Tune.gs／MultiRun.gs／Verify.gs／
//   HwcasSync.gs）：`if (existing) ss.deleteSheet(existing); ss.insertSheet(name)`
//   ——insertSheet() 每次都係真正全新嘅工作表物件，完全冇合併／凍結
//   歷史可以殘留，比 resetSheetToBlankSlate_() 更徹底。
//
//   模式二「只喺第一次建立時設定版面，之後只 append／只改資料驗證」
//   （Archive.gs／FineTune.gs 嘅提案封存表／Diagnostics.gs／
//   SpecialSundaysSeed.gs／RequestsSheet.gs）：`setFrozenRows()`／
//   `setColumnWidth()` 呢類版面設定用 `if (!existing)` 或者
//   `if (!headerOk)` 卡住，只會執行一次；之後嘅寫入只 append 新資料列
//   或者用 `setDataValidation()`（本身冪等、冇跨界限制），完全唔會
//   再次觸發版面設定，所以冇重複合併／凍結嘅衝突可能。
//
// 呢個測試檔用靜態檢查鎖住呢個結論，確保之後有人改呢幾個檔案時，如果
// 令佢哋離開咗上面兩種安全模式（例如加咗 .merge() 但冇改用
// resetSheetToBlankSlate_()），測試會提醒去覆核。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const SRC = path.join(__dirname, '..', 'src');
function readSrc(name) { return fs.readFileSync(path.join(SRC, name), 'utf8'); }

console.log('\n=== B【核心】全專案 .merge() 只出現喺 PublicRoster.gs，而且一定經 resetSheetToBlankSlate_() ===');
{
  const gsFiles = fs.readdirSync(SRC).filter(function (f) { return f.endsWith('.gs'); });
  const filesUsingMerge = gsFiles.filter(function (f) { return readSrc(f).indexOf('.merge()') !== -1; });
  check('★★★ 全專案得 PublicRoster.gs 一個檔案用到 .merge()（風險集中喺單一位置，容易審核）',
    filesUsingMerge.length === 1 && filesUsingMerge[0] === 'PublicRoster.gs',
    '實際用到 .merge() 嘅檔案：' + filesUsingMerge.join('、'));

  const publicRosterSource = readSrc('PublicRoster.gs');
  const writeStart = publicRosterSource.indexOf('function writePublicRosterContent_');
  const writeEnd = publicRosterSource.indexOf('\nfunction ', writeStart + 1);
  const writeBody = publicRosterSource.slice(writeStart, writeEnd);
  check('★★★ writePublicRosterContent_() 第一步就係 resetSheetToBlankSlate_()',
    /resetSheetToBlankSlate_\(sheet\)/.test(writeBody));

  const clearStart = publicRosterSource.indexOf('function clearPublicRosterOnQuarterReset_');
  const clearEnd = publicRosterSource.indexOf('\nfunction ', clearStart + 1);
  const clearBody = publicRosterSource.slice(clearStart, clearEnd);
  check('★ clearPublicRosterOnQuarterReset_() 同樣用 resetSheetToBlankSlate_()（一致性）',
    /resetSheetToBlankSlate_\(sheet\)/.test(clearBody));
}

console.log('\n=== B：模式一「刪除重建」嘅 5 個檔案，設定版面前一定先刪走舊工作表 ===');
{
  const deleteRecreateFiles = [
    { file: 'SelfTest.gs', fn: 'writeSelfTestSheet_' },
    { file: 'Tune.gs', fn: 'writeTuneSheet_' },
    { file: 'MultiRun.gs', fn: 'writeMultiRunSheet_' },
    { file: 'Verify.gs', fn: 'writeVerifySheet_' },
    { file: 'HwcasSync.gs', fn: 'writeHwcasDraftSheet_' }
  ];
  deleteRecreateFiles.forEach(function (item) {
    const source = readSrc(item.file);
    const start = source.indexOf('function ' + item.fn);
    const end = source.indexOf('\nfunction ', start + 1);
    const body = source.slice(start, end === -1 ? source.length : end);

    check('★★ ' + item.file + '/' + item.fn + '()：先 deleteSheet(existing) 先至 insertSheet()（保證每次都係全新工作表）',
      /if \(existing\) ss\.deleteSheet\(existing\);/.test(body) && /ss\.insertSheet\(/.test(body));

    const deleteIdx = body.indexOf('deleteSheet(existing)');
    const insertIdx = body.indexOf('insertSheet(');
    check('★ ' + item.file + '：deleteSheet 一定排喺 insertSheet 之前',
      deleteIdx !== -1 && insertIdx !== -1 && deleteIdx < insertIdx);
  });
}

console.log('\n=== B：模式二「只喺第一次建立時設定版面」嘅 4 個檔案 ===');
{
  const source1 = readSrc('SpecialSundaysSeed.gs');
  const ensureStart = source1.indexOf('function ensureSpecialSundaysSheet_');
  const ensureEnd = source1.indexOf('\nfunction ', ensureStart + 1);
  const ensureBody = source1.slice(ensureStart, ensureEnd);
  check('★★ SpecialSundaysSeed.gs：工作表已存在時直接 return，完全唔再掂版面',
    /if \(existing\) return \{ isNew: false \};/.test(ensureBody));

  const source2 = readSrc('Diagnostics.gs');
  const diagStart = source2.indexOf('function ensureDiagnosticsSheet_');
  const diagEnd = source2.indexOf('\nfunction ', diagStart + 1);
  const diagBody = source2.slice(diagStart, diagEnd);
  check('★★ Diagnostics.gs：setFrozenRows／setColumnWidth 淨係喺 !headerOk 嗰個分支入面（唔會喺已經正確嗰陣重複執行）',
    /if \(!headerOk\) \{[\s\S]*?setFrozenRows\(2\)[\s\S]*?\}/.test(diagBody));

  const source3 = readSrc('Archive.gs');
  const moveStart = source3.indexOf('function moveRowsToArchive_');
  const moveEnd = source3.indexOf('\nfunction ', moveStart + 1);
  const moveBody = source3.slice(moveStart, moveEnd);
  check('★★ Archive.gs：setFrozenRows 淨係喺 !archive（第一次建立）嗰個分支入面',
    /if \(!archive\) \{[\s\S]*?setFrozenRows\(2\)[\s\S]*?\}/.test(moveBody));

  const source4 = readSrc('RequestsSheet.gs');
  const buildStart = source4.indexOf('function buildRequestsSheetStructure_');
  const buildEnd = source4.indexOf('\nfunction ', buildStart + 1);
  const buildBody = source4.slice(buildStart, buildEnd);
  check('★ RequestsSheet.gs：setFrozenRows 喺 buildRequestsSheetStructure_()（只喺 isNew 分支先會被呼叫）',
    /setFrozenRows\(2\)/.test(buildBody));
  const refreshStart = source4.indexOf('function createOrRefreshRequestsSheet_');
  const refreshEnd = source4.indexOf('\nfunction ', refreshStart + 1);
  const refreshBody = source4.slice(refreshStart, refreshEnd);
  check('★★ RequestsSheet.gs：createOrRefreshRequestsSheet_() 只喺 isNew 時先建立骨架（setFrozenRows 唔會重複執行）',
    /if \(isNew\) \{\s*sheet = buildRequestsSheetStructure_\(ss\);\s*\}/.test(refreshBody));
  check('★ RequestsSheet.gs 完全冇 .merge()（refresh 路徑只用 setDataValidation，本身冪等冇跨界限制）',
    refreshBody.indexOf('.merge()') === -1);
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
