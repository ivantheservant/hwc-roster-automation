// 第十五輪批次階段 A：normalizeIdInput_()（Utils.gs）嘅回歸測試。
// 執行方式：node tests/normalize_quarter_id.test.js
//
// 背景：2026T4 彩排實測撞到「填寫講員側邊欄」一開就顯示搵唔到已生成嘅
// 版本，但 RosterVersions 明明有一行完全對得上嘅資料。逐層追查（見
// docs/系統範圍稽核.md 第十五輪批次階段 A）之後，喺真實資料狀態下
// 冇重現到呢個 bug，但過程中發現一個真實、廣泛存在嘅輸入風險：全形
// 字元／零闊度字元唔會被 `.trim()` 處理，會令嚴格相等比對靜靜噉搵唔到。
// 呢個測試檔一半測 normalizeIdInput_() 本身嘅邊界情況，一半用靜態
// 掃描鎖住「全部 ui.prompt() 捕捉 QuarterID 嘅地方都要經過呢個函式」，
// 避免日後有人加新嘅入口又漏咗呢一步。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Utils.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== normalizeIdInput_()：基本情況 ===');
{
  checkEqual('★★★ 正常半形輸入原樣通過', gas.normalizeIdInput_('2026T4'), '2026T4');
  checkEqual('★★ 前後空格會被清走', gas.normalizeIdInput_('  2026T4  '), '2026T4');
  checkEqual('★ 空字串維持空字串', gas.normalizeIdInput_(''), '');
  checkEqual('★ null 當空字串', gas.normalizeIdInput_(null), '');
  checkEqual('★ undefined 當空字串', gas.normalizeIdInput_(undefined), '');
}

console.log('\n=== normalizeIdInput_()【核心】：全形字元轉返半形 ===');
{
  checkEqual('★★★★ 全形數字＋全形英文字母 → 半形（中文輸入法全形模式常見結果）',
    gas.normalizeIdInput_('２０２６Ｔ４'), '2026T4');
  checkEqual('★★★ 混合半形全形都處理得到', gas.normalizeIdInput_('2026Ｔ4'), '2026T4');
  checkEqual('★★ 全形空格（U+3000，全形模式打空格鍵嘅結果）都會被 trim 清走',
    gas.normalizeIdInput_('　2026T4　'), '2026T4');
  checkEqual('★ 全形加半形空格夾雜都處理得到',
    gas.normalizeIdInput_(' 　２０２６Ｔ４　 '), '2026T4');
}

console.log('\n=== normalizeIdInput_()【核心】：零闊度字元移除 ===');
{
  checkEqual('★★★ 零闊度空格（U+200B，複製貼上常見殘留）會被移除',
    gas.normalizeIdInput_('2026T4​'), '2026T4');
  checkEqual('★★★ BOM／零闊度不斷行空格（U+FEFF，UTF-8 檔案常見殘留）會被移除',
    gas.normalizeIdInput_('﻿2026T4'), '2026T4');
  checkEqual('★★ 零闊度非連字（U+200C）會被移除', gas.normalizeIdInput_('2026‌T4'), '2026T4');
  checkEqual('★★ 零闊度連字（U+200D）會被移除', gas.normalizeIdInput_('2026‍T4'), '2026T4');
  checkEqual('★ 零闊度字元夾喺中間都處理得到（唔止頭尾）',
    gas.normalizeIdInput_('20​26T4'), '2026T4');
}

console.log('\n=== normalizeIdInput_()：唔應該做嘅嘢（刻意唔轉大小寫、唔改變有意義嘅內容） ===');
{
  checkEqual('★★ 唔會自動轉大小寫（QuarterID 嘅 T 大寫有意義，唔應該幫使用者「猜」）',
    gas.normalizeIdInput_('2026t4'), '2026t4');
  checkEqual('★ 唔會影響完全冇問題嘅一般中文字（例如萬一打埋啲備註）',
    gas.normalizeIdInput_('2026T4 備註'), '2026T4 備註');
}

console.log('\n=== normalizeIdInput_()：反證——唔正規化嘅話全形／半形係兩個唔同嘅字串 ===');
{
  const fullWidth = gas.normalizeIdInput_ ? '２０２６Ｔ４' : '';
  check('★★★★ 反證：全形原始字串同半形字串直接 === 比對係 false（呢個就係 bug 嘅源頭）',
    fullWidth !== '2026T4');
  check('★★★★ 但經過 normalizeIdInput_() 之後兩者相等',
    gas.normalizeIdInput_(fullWidth) === gas.normalizeIdInput_('2026T4'));
}

console.log('\n=== 靜態掃描【核心】：全部 ui.prompt() 捕捉 QuarterID 嘅地方都經過 normalizeIdInput_() ===');
{
  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs'));
  const bareTrimSites = [];
  const normalizedSites = [];

  files.forEach((f) => {
    const content = fs.readFileSync(path.join(SRC, f), 'utf8');
    const bareMatches = content.match(/const quarterId = [A-Za-z]+\.getResponseText\(\)\.trim\(\);/g) || [];
    bareMatches.forEach((m) => bareTrimSites.push(f + ': ' + m));
    const normMatches = content.match(/const quarterId = normalizeIdInput_\([A-Za-z]+\.getResponseText\(\)\);/g) || [];
    normMatches.forEach((m) => normalizedSites.push(f + ': ' + m));
  });

  check('★★★★ 冇任何檔案仲用「裸 .trim()」捕捉 QuarterID（全部都應該經過 normalizeIdInput_）',
    bareTrimSites.length === 0, JSON.stringify(bareTrimSites, null, 2));
  check('★★★ 確實搵到超過 15 個入口已經套用咗 normalizeIdInput_（本輪逐一修正嘅全部 ui.prompt() 捕捉點）',
    normalizedSites.length >= 15, '實際搵到 ' + normalizedSites.length + ' 個：' + JSON.stringify(normalizedSites, null, 2));
}

console.log('\n=== 靜態掃描【第十五輪批次追加】：全部 ui.prompt() 捕捉 PersonID／BatchID 嘅地方都經過 normalizeIdInput_() ===');
{
  // 背景：修正 QuarterID 嘅裸 trim 之後，喺同一輪嘅階段 B 主動稽核入面，
  // 逐一檢查全部選單項目時發現同一個 bug class 仲存在喺 5 個地方——
  // reissuePersonalLinkToken_()（PersonID）、runExportPdf_()（PersonID）、
  // runApplyDecisions_()（BatchID）、runDebugPersonalHighlight_()（PersonID）、
  // runSendIcsTestEmail_()（PersonID）。呢個掃描鎖住呢五個已經修正嘅地方，
  // 同埋防止日後有人加新嘅 PersonID／BatchID 輸入點又漏咗呢一步。
  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs'));
  const bareTrimSites = [];
  const normalizedSites = [];

  files.forEach((f) => {
    const content = fs.readFileSync(path.join(SRC, f), 'utf8');
    const bareMatches = content.match(/const (?:personId|batchId) = [A-Za-z]+\.getResponseText\(\)\.trim\(\);/g) || [];
    bareMatches.forEach((m) => bareTrimSites.push(f + ': ' + m));
    const normMatches = content.match(/const (?:personId|batchId) = normalizeIdInput_\([A-Za-z]+\.getResponseText\(\)\);/g) || [];
    normMatches.forEach((m) => normalizedSites.push(f + ': ' + m));
  });

  check('★★★★ 冇任何檔案仲用「裸 .trim()」捕捉 PersonID／BatchID（全部都應該經過 normalizeIdInput_）',
    bareTrimSites.length === 0, JSON.stringify(bareTrimSites, null, 2));
  check('★★★ 確實搵到 5 個入口已經套用咗 normalizeIdInput_（reissuePersonalLinkToken_、runExportPdf_、runApplyDecisions_、runDebugPersonalHighlight_、runSendIcsTestEmail_）',
    normalizedSites.length >= 5, '實際搵到 ' + normalizedSites.length + ' 個：' + JSON.stringify(normalizedSites, null, 2));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
