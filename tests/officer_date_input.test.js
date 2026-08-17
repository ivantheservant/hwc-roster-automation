// 第二十一輪批次階段 C：幹事輸入嘅日期只收兩種寫法。
// 執行方式：node tests/officer_date_input.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要收窄
// ─────────────────────────────────────────────────────────────────────
//
// `toDateString()` 接受 `dd/MM/yyyy`，即係 `05/06/2027` 一律當**6 月 5 日**。
// 呢個係**無聲噉猜**——猜錯就係把人排錯主日，而且冇任何提示。
//
// 而且原本嘅錯誤訊息寫「斜線、句點、日月倒轉、全形數字都認不出來」，
// 但實際上斜線同日月倒轉係收嘅——**訊息同行為唔一致**。
// 幹事照住訊息改，反而改到一個系統會靜靜猜錯嘅寫法。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  'Roles.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs', 'RequestsApply.gs'
]);

// `parseOfficerDateInput_()` 對 Date 物件會用 Utilities.formatDate；
// 測試沙箱嘅 GAS stub 一被呼叫就拋錯，所以喺呢度換一個確定性替身。
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

const TZ = 'Pacific/Auckland';

console.log('\n=== C1【核心】只收兩種寫法 ===');
{
  // 一：儲存格本身係 Date 物件（由下拉選單揀嘅一定係噉）
  const asDate = gas.parseOfficerDateInput_(new Date(Date.UTC(2027, 4, 16)), TZ);
  checkEqual('★★★★★ Date 物件 ⇒ 收，轉成 yyyy-MM-dd'
    + '（下拉選單揀嘅就係呢種，最穩陣）',
    [asDate.ok, asDate.dateStr], [true, '2027-05-16']);

  // 二：文字 yyyy-MM-dd
  const asText = gas.parseOfficerDateInput_('2027-05-16', TZ);
  checkEqual('★★★★★ 文字 yyyy-MM-dd ⇒ 收', [asText.ok, asText.dateStr], [true, '2027-05-16']);
}

console.log('\n=== C1【核心】其餘一律唔收 ===');
{
  const rejected = [
    ['2027/05/16', '斜線——同 dd/MM/yyyy 撞，要靠估'],
    ['16/05/2027', '日月倒轉——次序靠估'],
    ['05/06/2027', '⚠️ 呢個最危險：舊邏輯一律當 6 月 5 日，猜錯就排錯主日'],
    ['2027.05.16', '句點'],
    ['2027年5月16日', '中文年月日'],
    ['２０２７-０５-１６', '全形數字'],
    ['2027-5-16', '月份一位數——同下拉選單出嚟嘅格式唔一致'],
    ['16-05-2027', '日在前']
  ];

  rejected.forEach(function (pair) {
    const r = gas.parseOfficerDateInput_(pair[0], TZ);
    checkEqual('★★★★★ 「' + pair[0] + '」⇒ 唔收（' + pair[1] + '）',
      [r.ok, r.dateStr], [false, '']);
    check('　　↳ 保留原文供錯誤訊息回顯', r.rawText === pair[0]);
  });
}

console.log('\n=== C2【核心】訊息同實際行為必須一致 ===');
{
  const msg = gas.describeUnknownRequestDate_('2027/05/16', '2027T2');

  check('★★★★★ 講明只接受兩種寫法', msg.indexOf('只接受兩種寫法') !== -1, msg);
  check('★★★★★ 兩種都寫出嚟（下拉選單、yyyy-MM-dd）',
    msg.indexOf('下拉選單') !== -1 && msg.indexOf('yyyy-MM-dd') !== -1, msg);

  // ★ 核心：訊息列為「不接受」嘅，實際上真係唔收
  const listedAsRejected = ['2026/11/15', '15/11/2026'];
  listedAsRejected.forEach(function (t) {
    check('★★★★★ 訊息講「' + t + '」呢類唔接受，而實際上真係唔收'
      + '——修正之前訊息噉講但實際上收，幹事照住訊息改反而改到'
      + '一個會被靜靜猜錯嘅寫法',
      msg.indexOf(t) !== -1 && !gas.parseOfficerDateInput_(t, TZ).ok);
  });

  check('★★★★ 解釋咗點解唔收（唔係認唔到，係冇得確定日月次序）',
    msg.indexOf('沒有辦法確定') !== -1 && msg.indexOf('排錯主日') !== -1, msg);

  // 反向：格式啱但唔屬於呢季 ⇒ 另一句
  const wrongQuarter = gas.describeUnknownRequestDate_('2027-01-03', '2027T2');
  check('★★★★★ 格式啱但唔屬於呢季 ⇒ 講季度問題，唔好叫人改格式',
    wrongQuarter.indexOf('格式正確') !== -1 && wrongQuarter.indexOf('認不出來') === -1,
    wrongQuarter);
}

console.log('\n=== C3【核心】兩個函式各自服務一邊，唔可以混用 ===');
{
  // `toDateString()` 服務「讀系統寫入嘅資料」——**唔可以收緊**，
  // 否則既有資料會讀唔到。
  checkEqual('★★★★★ toDateString() 仍然收斜線'
    + '（Requests 有一行歷史紀錄係 2027/05/09、已 APPLIED，'
    + '收緊嘅話讀嗰行就會出事）',
    gas.toDateString('2027/05/09', TZ), '2027-05-09');
  checkEqual('★★★★ toDateString() 仍然收 dd/MM/yyyy（既有資料相容）',
    gas.toDateString('09/05/2027', TZ), '2027-05-09');

  checkEqual('★★★★★ 但同一個字串，幹事輸入路徑唔收'
    + '——兩個函式服務唔同一邊，呢個分家就係階段 C 嘅重點',
    gas.parseOfficerDateInput_('2027/05/09', TZ).ok, false);

  // 兩個函式都要有 docstring 講明服務邊一邊
  const fs = require('fs');
  const path = require('path');
  const utils = fs.readFileSync(path.join(__dirname, '..', 'src', 'Utils.gs'), 'utf8');
  check('★★★★ toDateString() 有寫明服務「讀系統寫入嘅資料」同埋唔可以收緊',
    utils.indexOf('讀系統自己寫入嘅資料') !== -1 && utils.indexOf('唔可以收緊') !== -1);
  check('★★★★ parseOfficerDateInput_() 有寫明服務幹事輸入',
    utils.indexOf('幹事輸入**嘅日期，只收兩種寫法') !== -1
      || utils.indexOf('幹事輸入') !== -1);
}

console.log('\n=== C：空白同邊界 ===');
{
  [null, undefined, '', '   '].forEach(function (v) {
    const r = gas.parseOfficerDateInput_(v, TZ);
    checkEqual('★★★ ' + JSON.stringify(v) + ' ⇒ 唔收、rawText 空白',
      [r.ok, r.dateStr, r.rawText], [false, '', '']);
  });
  check('★★★★ 空白有自己嘅訊息（唔好同格式錯混淆）',
    gas.describeUnknownRequestDate_('', '2027T2').indexOf('空白') !== -1);
}

console.log('\n=== C：認唔到嘅日期唔可以被靜靜略過 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RequestsApply.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function readPendingRequests_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ readPendingRequests_ 用 parseOfficerDateInput_，唔再用 toDateString',
    body.indexOf('parseOfficerDateInput_(') !== -1
      && body.indexOf('toDateString(row[dateCol]') === -1, body.slice(0, 400));
  check('★★★★★ 認唔到嘅日期照樣傳落去（由 validateRequest_ 報 NEEDS_INPUT），'
    + '唔可以當成空白 return 走——噉樣就變成靜靜吞咗一筆申報',
    body.indexOf('rawDateText') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
