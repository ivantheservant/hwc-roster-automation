// 第九十七輪批次 XC／XD 組：日曆檔只在定稿寄出時附上——提醒；刪除季前資料「正式使用時建議」那一句。
// 執行方式：node tests/round97_xc_xd_hints.test.js
//
//   XC1 〔寄給堂委／執事〕（審閱）確認窗加一句：「審閱版不附日曆檔；正式發出（定稿）時，每人才會收到自己的日曆檔。」
//   XC2 〔給所有人〕〔變動的人〕「附 .ics 日曆檔」旁說明加：「只在定稿寄出時附上；請確認這一版是最後定稿。」
//       （其他模式不加；只是提示，不改行為）
//   XD1 只有模擬寄出 ⇒「季前資料：模擬寄出（日期，人手）」（不再有「；正式使用時建議 … 寄出」）；其他情況不變
// 用假資料。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const REVIEW = '審閱版不附日曆檔；正式發出（定稿）時，每人才會收到自己的日曆檔。';
const FINAL = '只在定稿寄出時附上；請確認這一版是最後定稿。';

console.log('\n=== XC1：審閱確認窗 ===');
{
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★★★ 句子原文', z1.indexOf("const REVIEW_NO_ICS_TEXT = '" + REVIEW + "';") !== -1);
  const review = z1.slice(z1.indexOf('function openReview('), z1.indexOf('async function renderReviewDone('));
  check('★★★★★★ 在〔寄給堂委／執事〕（審閱）確認窗裏（openReview），緊接附件／日曆檔一段', /if \(preview\.contents\) nodes\.push\(sendContentsBox\(preview\.contents\)\);\s*\/\/[^\n]*\n\s*nodes\.push\(para\(REVIEW_NO_ICS_TEXT, 'muted'\)\);/.test(review));
  const official = z1.slice(z1.indexOf('function openOfficial('), z1.indexOf('function renderOfficialDone('));
  check('★★★★ 正式發出確認窗沒有這一句', official.indexOf('REVIEW_NO_ICS_TEXT') === -1);
}

console.log('\n=== XC2：〔給所有人〕〔變動的人〕日曆檔說明 ===');
{
  const sp = read('src/ui/ScriptSendPaper.html');
  check('★★★★★★ 句子原文', sp.indexOf("const ICS_FINAL_ONLY_TEXT = '" + FINAL + "';") !== -1);
  check('★★★★★★ 只在〔給所有人〕（ALL）〔變動的人〕（CHANGED）加在日曆檔一段', /if \(sendMode_ === 'ALL' \|\| sendMode_ === 'CHANGED'\) \{\s*icsBox\.appendChild\(make\('div', \{ text: ICS_FINAL_ONLY_TEXT, className: 'muted' \}\)\);\s*\}/.test(sp));
  check('★★★★ 沒有改日曆檔的選項（只加提示）', /icsCb\.checked = sendOptions_\.includeIcs;/.test(sp) && /text: '附 \.ics 日曆檔（iPhone 和 Google 日曆都可以開啟）'/.test(sp));
}

console.log('\n=== XD1：季前資料那一行 ===');
{
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PreseasonPack.gs']);
  g.Utilities = { formatDate: (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d) };
  const MANUAL = g.PRESEASON_SEND_MODE.MANUAL;
  check('★★★★★★ 只有模擬寄出 ⇒「季前資料：模擬寄出（日期，人手）」，沒有「正式使用時建議」',
    g.describePreseasonStatus_({ date: '2026-10-30', mode: MANUAL, real: null }, '2028-05-27', 14) === '季前資料：模擬寄出（2026-10-30，人手）');
  check('★★★★★ 沒有生成日期的模擬寄出照舊', g.describePreseasonStatus_({ date: '2026-10-30', mode: MANUAL, real: null }, '', 14)
    === '季前資料：模擬寄出（2026-10-30，人手）；這一季沒有生成日期，不會自動寄出');
  check('★★★★★ 真正寄出照舊', g.describePreseasonStatus_({ date: '2026-10-30', mode: MANUAL, real: { date: '2026-10-31', mode: MANUAL } }, '2028-05-27', 14)
    === '季前資料：已寄出（2026-10-31，人手）');
  check('★★★★★ 未寄照舊（建議日期）', g.describePreseasonStatus_(null, '2028-05-27', 14) === '季前資料：建議 2028-05-13 寄出（未寄）');
  check('★★★★ src/ 不再有「正式使用時建議」字眼（只剩註解）', !/['"][^'"\n]*正式使用時建議/.test(read('src/PreseasonPack.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
