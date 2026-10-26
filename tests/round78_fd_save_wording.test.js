// 第七十八輪批次 FD 組：一格、冇違規嘅〔儲存〕唔出確認窗——字眼要對得上。
// 執行方式：node tests/round78_fd_save_wording.test.js
//
// 現場（第七十七輪回歸 G11）：只改咗 1 格（冇違規、冇申報、冇空格）⇒ 唔出「會儲存成第 N 版」
// 確認窗，直接儲存。呢個係第三十九輪批次 A 組嘅設計（`saveIsCompletelyClean()` →
// `executeCleanSave()`），唔係新問題；但腳本、指南、規格都假設一定有確認窗。
//
//   FD1　快路行為唔改
//   FD2　畀幹事睇嘅字眼（src 非註解、使用說明、介面規格）冇「儲存前一定有確認窗」嘅講法
//   FD3　靜態檢查本身捉得到舊講法

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\n=== FD1：快路行為唔改 ===');
{
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 一切正常 ⇒ 直接儲存（saveIsCompletelyClean → executeCleanSave）',
    /if \(saveIsCompletelyClean\(savePlan\)\) return executeCleanSave\(savePlan\);/.test(z1));
}

console.log('\n=== FD2【核心】字眼 ===');
const scan = require('../tools/scan-static-risks.js');
{
  scan._findings.length = 0;
  scan.scanSaveAlwaysConfirmWording();
  const hits = scan._findings.filter((f) => f.kind === '儲存確認字眼');
  check('★★★★★★ src／使用說明／介面規格冇「儲存一定先出確認」嘅講法', hits.length === 0,
    hits.map((f) => f.file + ':' + f.line + ' ' + f.text).join('\n'));
  const spec = read('docs/幹事介面規格.md');
  check('★★★★★ 介面規格寫明「有需要你決定的事才會出確認畫面；一切正常會直接儲存」',
    /有需要你決定的事才會出「會儲存成第 N 版」確認畫面/.test(spec) && /一切正常會直接儲存/.test(spec));
}

console.log('\n=== FD3：靜態檢查捉得到舊講法 ===');
{
  const bad = [
    '  儲存前的確認窗多了一個 ☐ 儲存之後直接去寄出（**預設不勾**）。',
    '撳〔儲存〕之後會先出確認畫面，看清楚再撳。',
    '〔儲存〕每次都會出確認畫面。'
  ];
  const good = [
    '有需要你決定的事才會出確認畫面；一切正常會直接儲存。',
    '在試算表直接改格子，改完回來撳「儲存」。'
  ];
  check('★★★★★ 舊講法全部報出', bad.every(scan.checkSaveWordingLine), bad.filter((l) => !scan.checkSaveWordingLine(l)).join(' | '));
  check('★★★★ 準確講法唔報', good.every((l) => !scan.checkSaveWordingLine(l)), good.filter(scan.checkSaveWordingLine).join(' | '));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
