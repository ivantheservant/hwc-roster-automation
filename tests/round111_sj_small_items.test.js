// 第一百一十一輪批次 SJ 組：小問題
//   SJ1　Config SELF_TEST_QUARTER_ID 與 SELFTEST_QUARTER_ID 不是重複：前者是〔自我測試〕（只讀）要驗的季度（留空＝最近生成過的一季），
//        後者是自測機的沙盒季度（每次執行整季清空）。合併會令只讀檢查指去沙盒，或者沙盒指去真實季度——所以分開，並鎖住各自的用途。
//   SJ3　第六十七至六十九輪的三個舊問題：只讀碼及現有測試核對（hard_release_remembered、round75_ch_version_picker、round77_ec_version_source_counts）。
// 執行方式：node tests/round111_sj_small_items.test.js

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const users = (key) => fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.gs'))
  .filter((f) => new RegExp('CONFIG_KEYS\\.' + key + '\\b').test(read('src/' + f))).sort();

console.log('\n=== SJ1：兩個自測季度鍵各有用途 ===');
{
  check('★★★★★★ SELF_TEST_QUARTER_ID 只由〔自我測試〕（SelfTest.gs，只讀）讀；種子、常數另計', users('SELF_TEST_QUARTER_ID').join() === 'ConfigSeed.gs,SelfTest.gs', users('SELF_TEST_QUARTER_ID').join());
  check('★★★★★★ SELFTEST_QUARTER_ID 只由自測機（SelfTestRunner.gs，沙盒）讀', users('SELFTEST_QUARTER_ID').join() === 'ConfigSeed.gs,SelfTestRunner.gs', users('SELFTEST_QUARTER_ID').join());
  const st = read('src/SelfTest.gs');
  check('★★★★★ 〔自我測試〕留空 ⇒ 用最近一個有生成過版本的季度（不是沙盒）', /const configured = String\(getConfig_\(CONFIG_KEYS\.SELF_TEST_QUARTER_ID, ''\) \|\| ''\)\.trim\(\);/.test(st));
  check('★★★★★ 〔自我測試〕只讀（不寄電郵、不改資料表）', /只讀取與驗算，不寄電郵、不改資料表、不建立版本/.test(st));
}

console.log('\n=== SJ3：三個舊問題仍然有測試鎖住 ===');
{
  const hr = read('tests/hard_release_remembered.test.js');
  check('★★★★★ (a)〔請系統幫我調整〕「仍然違反」不計已放行的格（SuggestionSheet.gs AQ 組）',
    /return !releasedCellKeys\[k\] && !keptKeys\[k\];/.test(read('src/SuggestionSheet.gs')) && /第六十九輪批次 AQ 組/.test(hr));
  check('★★★★★ (b) 再儲存時「已放行」寫第幾版放行', /已放行嗰行寫「（第 ' \+ V1 \+ ' 版放行）」/.test(hr));
  check('★★★★★ (c) 系統調整（SUGGESTION）的版本來源寫「系統調整」，不是「由人手職事表匯入」',
    /src\('SUGGESTION', 1\) === '系統調整'/.test(read('tests/round75_ch_version_picker.test.js')) && /IMPORT: '由人手職事表匯入'/.test(read('src/WebAppDashboard.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
