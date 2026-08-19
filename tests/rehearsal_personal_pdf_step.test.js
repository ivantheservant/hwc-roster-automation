// 第三十一輪批次階段 B1：演練漏咗「產生個人 PDF」，令寄送路徑永遠測唔到。
// 執行方式：node tests/rehearsal_personal_pdf_step.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測（2027T4 全季流程演練報告）
// ─────────────────────────────────────────────────────────────────────
//
//   步驟 4：正式發出給全體 | 失敗 | 因為個人 PDF 缺件太多而中止
//
// 呢個唔係 bug——`evaluateStep4MissingPdfGate_()` 正確運作。
// 但後果係：**整條寄送路徑由頭到尾冇行過一次。**
// 而 linter 前晚喺 `Mailer.gs` 捉到嗰個個人 PDF bug，就係喺呢條路上面。
//
// ⚠️ 一個永遠行到一半就停嘅演練，唔算演練咗。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const src = read('src/SeasonRehearsal.gs');
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const bare = stripComments(src);

console.log('\n=== B1【核心】步驟 3.5 排喺步驟 3 之後、步驟 4 之前 ===');
{
  const at35 = bare.indexOf("'步驟 3.5：產生個人 PDF'");
  const at3 = bare.indexOf("'步驟 3：儲存並確認（零改動）'");
  const at4 = bare.indexOf("'步驟 4：正式發出給全體'");
  check('★★★★★ 三步都搵得到', at35 !== -1 && at3 !== -1 && at4 !== -1,
    [at3, at35, at4].join(','));
  check('★★★★★ 而且次序係 3 → 3.5 → 4'
    + '——排喺步驟 4 之後就完全冇意義，缺件保護一樣會擋',
    at3 < at35 && at35 < at4, [at3, at35, at4].join(','));
}

console.log('\n=== B1【核心】叫內部函式，唔可以叫 `run*_()` ===');
{
  check('★★★★★ 叫 `generatePersonalPdfBatch_()`',
    /generatePersonalPdfBatch_\(quarterId, versionNo\)/.test(bare));
  check('★★★★★ **冇叫 `runGeneratePersonalPdfBatch_()`**'
    + '——`run*_()` 會 `ui.alert()`，喺一個自動行五步嘅工具入面'
    + '等於中途停低等人撳 OK',
    bare.indexOf('runGeneratePersonalPdfBatch_') === -1);
  check('★★★★★ 演練工具入面一個 `ui.alert(` 都冇喺步驟入面'
    + '（確認對話框例外，嗰個係入口）',
    (bare.match(/ui\.alert\(/g) || []).length <= 3, bare.match(/ui\.alert\(/g) + '');
}

console.log('\n=== B1【核心】要 loop 到 `done`，唔可以只叫一次 ===');
{
  // `generatePersonalPdfBatch_()` 係分批嘅（`PDF_BATCH_SIZE` ＋ 時間預算）。
  // 只叫一次 ⇒ 只產生第一批 ⇒ 步驟 4 照樣被缺件保護擋住，
  // 即係加咗一步但問題原封不動。
  check('★★★★★ 有 loop 直到 `last.done`',
    /while \(rounds < MAX_ROUNDS\)/.test(bare) && /if \(last && last\.done\) break;/.test(bare));
  check('★★★★★ 而且 loop 有寫死上限'
    + '——Apps Script 六分鐘一到就乜報告都冇，'
    + '一個唔會停嘅 loop 會令成次演練白行',
    /const MAX_ROUNDS = \d+;/.test(bare));
  check('★★★★★ 冇行完（`finished` false）都會照樣記低，唔會扮成完成',
    /finished: !!\(last && last\.done\)/.test(bare));
}

console.log('\n=== B1【核心】失敗要記低然後照行落去 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Diagnostics.gs', 'SeasonRehearsal.gs'
  ]);
  const log = [];
  gas.runRehearsalStep_(log, '步驟 3.5：產生個人 PDF', {}, function () {
    throw new Error('資料夾建立不到');
  });
  check('★★★★★ 拋錯唔會傳出去（傳出去就見唔到步驟 4 嘅保護機制點反應）',
    log.length === 1 && log[0].ok === false, JSON.stringify(log));
  check('★★★★★ 而且原因記低咗', log[0].error === '資料夾建立不到', JSON.stringify(log[0]));
}

console.log('\n=== B1【核心】要見到分季分版子資料夾，唔係淨係報個數 ===');
{
  check('★★★★★ 分開數「喺版本子資料夾」同「平舖喺根目錄」'
    + '——分季分版係第二十六輪改嘅嘢，到今日未真正驗證過',
    /filesInVersionFolder/.test(bare) && /filesFlatInRoot/.test(bare));
  check('★★★★★ 而且真係印出完整路徑（唔止數量）',
    /samplePaths/.test(bare) && /f\.path/.test(bare));
  check('★★★★ 用返 `readRehearsalPdfPaths_()` 嗰個現成函式，冇另寫一套路徑組合',
    /readRehearsalPdfPaths_\(quarterId, \[versionNo\]\)/.test(bare));
}

console.log('\n=== B1【核心】欄名對得返 `buildPdfBatchResult_()` ===');
{
  // ⚠️ 呢個就係 B3 撞到嗰個形狀：讀一個唔存在嘅欄名唔會拋錯，
  // 只會靜靜得出 undefined，然後報告印一個似模似樣但完全錯嘅值。
  const pdf = read('src/PdfBatch.gs');
  const returned = (pdf.match(/function buildPdfBatchResult_[\s\S]*?\n\}/) || [''])[0];
  ['totalPeople', 'doneCount', 'generatedCount', 'skippedExistingCount', 'errors']
    .forEach(function (key) {
      check('★★★★★ `' + key + '` 真係喺 `buildPdfBatchResult_()` 嘅回傳入面',
        returned.indexOf(key + ':') !== -1);
      check('★★★★ 而演練步驟讀嘅正正係佢', bare.indexOf(key) !== -1);
    });
  check('★★★★★ 讀唔到嗰陣講「回傳沒有 X 這一欄」，唔會靜靜當成 0'
    + '——0 同「根本冇呢一欄」係兩件事',
    /回傳沒有 ' \+ key \+ ' 這一欄/.test(bare) || /回傳沒有 '/.test(bare));
}

console.log('\n=== B1 確認畫面要講埋新加嗰一步 ===');
{
  check('★★★★★ 講明會產生大約幾多份（58）'
    + '——一個會行多幾分鐘嘅步驟，唔可以無聲無息加咗落去',
    src.indexOf('58 份') !== -1, '（睇確認對話框嗰段）');
  check('★★★★★ 而且照舊講明唔會真正寄出電郵',
    src.indexOf('不會真的寄出') !== -1 || src.indexOf('唔會真正寄出') !== -1
    || src.indexOf('不會真正寄出') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
