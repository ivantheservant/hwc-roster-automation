// 第二十三輪批次階段 A：ICS 時間被 Google 試算表正規化成 Date 物件嘅 bug。
// 執行方式：node tests/ics_time_normalization.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試存在嘅理由（真實環境爆咗，62 個測試一個都捉唔到）
// ─────────────────────────────────────────────────────────────────────
//
// Config 打咗 `10:45` 落去，**Google 試算表自動當佢係時間值**，
// 儲存格實際存嘅係 Date 物件（`Sat Dec 30 1899 10:45:00 GMT+1130`）。
// `String(那個 Date)` 出嚟係成串英文長格式，`split(':')` 之後
// `.map(Number)` 得出 `[NaN, 45, NaN]`，最後 `DTSTART` 輸出
// `NaNNaNNaNTNaNNaN00`——**寄出嘅每一份個人月曆附件時間都係壞嘅。**
//
// 點解舊測試捉唔到：**佢哋全部餵乾淨字串 `'10:45'`。**
// 試算表真正俾嘅係 Date 物件。呢個測試特登餵 Date 物件。
//
// ⚠️ 寫新測試時要問自己：**呢個測試餵嘅資料，跟試算表真正會給的一樣嗎？**

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'IcsExport.gs']);

// `normalizeTimeOfDay_()` 對 Date 物件會用 Utilities.formatDate；
// 測試沙箱嘅 GAS stub 一被呼叫就拋錯，所以換一個確定性替身。
//
// 呢個替身用 `getHours()`／`getMinutes()`（即係執行環境嘅本地時間）——
// 對應真實情況：`SYS_TIMEZONE` 同試算表本身嘅時區一致，所以
// `Utilities.formatDate(cellDate, SYS_TIMEZONE, 'HH:mm')` 得出嘅
// 正正就係幹事喺格入面睇到嗰個鐘數。
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    if (format !== 'HH:mm') throw new Error('測試替身只支援 HH:mm，收到：' + format);
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
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
function checkThrows(label, fn, mustContain) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ok = threw !== null && (!mustContain || String(threw.message).indexOf(mustContain) !== -1);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log('      ' + (threw ? '訊息缺「' + mustContain + '」：' + threw.message : '完全冇拋錯'));
}

const TZ = 'Pacific/Auckland';

console.log('\n=== A1【核心】Date 物件（試算表真正會俾嘅嘢）⇒ HH:mm ===');
{
  // 試算表把「睇落似時間」嘅格存成 1899-12-30 當日嘅 Date。
  // 呢個就係實測撞到嘅真實形狀。
  const sheetsTimeCell = new Date(1899, 11, 30, 10, 45, 0);
  checkEqual('★★★★★ Date 物件 ⇒ "10:45"'
    + '（實測撞到：舊碼 String(Date) 出成串英文長格式，最後 DTSTART 變 NaN）',
    gas.normalizeTimeOfDay_(sheetsTimeCell, '00:00', TZ), '10:45');

  const endCell = new Date(1899, 11, 30, 12, 0, 0);
  checkEqual('★★★★ 12:00 嗰格一樣', gas.normalizeTimeOfDay_(endCell, '00:00', TZ), '12:00');

  const earlyCell = new Date(1899, 11, 30, 9, 5, 0);
  checkEqual('★★★★ 單位數鐘數要補零 ⇒ "09:05"',
    gas.normalizeTimeOfDay_(earlyCell, '00:00', TZ), '09:05');
}

console.log('\n=== A1：文字輸入 ===');
{
  checkEqual('★★★★★ "10:45" ⇒ 原樣', gas.normalizeTimeOfDay_('10:45', '00:00', TZ), '10:45');
  checkEqual('★★★★★ "9:05"（單位數鐘數）⇒ 補零成 "09:05"',
    gas.normalizeTimeOfDay_('9:05', '00:00', TZ), '09:05');
  checkEqual('★★★ "00:00" 係合法時間，唔可以當成空白',
    gas.normalizeTimeOfDay_('00:00', '10:45', TZ), '00:00');
  checkEqual('★★★ "23:59" 邊界', gas.normalizeTimeOfDay_('23:59', '00:00', TZ), '23:59');
  checkEqual('★★★ 前後空白會 trim', gas.normalizeTimeOfDay_('  10:45  ', '00:00', TZ), '10:45');
}

console.log('\n=== A1：空白 ⇒ 回 fallback（呢個先係合法嘅「冇設定」）===');
{
  checkEqual('★★★★ 空字串 ⇒ fallback', gas.normalizeTimeOfDay_('', '10:45', TZ), '10:45');
  checkEqual('★★★★ null ⇒ fallback', gas.normalizeTimeOfDay_(null, '10:45', TZ), '10:45');
  checkEqual('★★★★ undefined ⇒ fallback', gas.normalizeTimeOfDay_(undefined, '10:45', TZ), '10:45');
  checkEqual('★★★ 全空白字串 ⇒ fallback', gas.normalizeTimeOfDay_('   ', '10:45', TZ), '10:45');
}

console.log('\n=== A1【核心】認唔出 ⇒ 拋錯，唔可以靜靜回 fallback 或 00:00 ===');
{
  // 呢個係本專案已經燒過幾次嘅 bug class：把「認唔到」當成「冇事」。
  // 時間錯咗，義工會喺錯嘅鐘數返到教會——唔可以無聲無息。
  checkThrows('★★★★★ 亂文字 ⇒ 拋錯（唔可以靜靜當成 fallback）',
    function () { gas.normalizeTimeOfDay_('唔知咩時間', '10:45', TZ); }, '認不出這個時間值');

  // ⚠️⚠️ 第三十一輪批次階段 A2：**呢一條本來寫反咗，而且就係佢鎖死咗個 bug。**
  //
  // 舊斷言要求「String(Date) 出嚟嘅英文長格式 ⇒ 拋錯」，
  // 但嗰個字串正正就係**真實環境每一次都會收到**嘅值
  //（`convertConfigValue_()` 對 STR 型別會 `String(rawValue).trim()`）。
  // 換言之：第二十三輪嘅「修正」由頭到尾冇生效過，
  // 而呢一條測試把「唔生效」寫成咗預期行為。
  //
  // 正解喺 `tests/ics_time_from_stringified_date.test.js`：
  // 呢個值要得出 `10:45`，唔係拋錯。

  checkThrows('★★★★ 鐘數超出範圍（25:00）⇒ 拋錯，唔可以當成合法',
    function () { gas.normalizeTimeOfDay_('25:00', '10:45', TZ); }, '認不出這個時間值');
  checkThrows('★★★★ 分鐘超出範圍（10:75）⇒ 拋錯',
    function () { gas.normalizeTimeOfDay_('10:75', '10:45', TZ); }, '認不出這個時間值');
  checkThrows('★★★ 冇冒號（1045）⇒ 拋錯',
    function () { gas.normalizeTimeOfDay_('1045', '10:45', TZ); }, '認不出這個時間值');
  checkThrows('★★★ 帶秒（10:45:00）⇒ 拋錯（本專案冇任何地方需要秒）',
    function () { gas.normalizeTimeOfDay_('10:45:00', '10:45', TZ); }, '認不出這個時間值');
}

console.log('\n=== A1：錯誤訊息要講得出係邊個值、預期咩格式、點解會咁 ===');
{
  let msg = '';
  try { gas.normalizeTimeOfDay_('唔知咩時間', '10:45', TZ); } catch (e) { msg = e.message; }
  check('★★★★★ 訊息含實際收到嘅值', msg.indexOf('唔知咩時間') !== -1, msg);
  check('★★★★ 訊息含預期格式 HH:mm', msg.indexOf('HH:mm') !== -1, msg);
  check('★★★★★ 訊息講到「試算表把格存成日期物件」呢個真正成因'
    + '——幹事睇住格入面明明寫住 10:45，唔講就完全唔會知發生咩事',
    msg.indexOf('純文字') !== -1, msg);
}

console.log('\n=== A3【核心】shiftIcsLocalDateTime_ 最後防線：NaN 唔可以流落去 ===');
{
  checkThrows('★★★★★ 壞時間 ⇒ 拋錯，唔可以輸出 NaN 日期'
    + '（未修之前 DTSTART 出 NaNNaNNaNTNaNNaN00，一路流到寄出嘅附件）',
    function () {
      gas.shiftIcsLocalDateTime_('2026-11-08', 'Sat Dec 30 1899 10:45:00 GMT+1130', 0);
    }, 'ICS 時間格式不正確');

  checkThrows('★★★★ 壞日期 ⇒ 一樣拋錯',
    function () { gas.shiftIcsLocalDateTime_('唔係日期', '10:45', 0); }, 'ICS 日期格式不正確');

  checkEqual('★★★★ 正常輸入照舊行得通（防線唔可以擋住合法值）',
    gas.shiftIcsLocalDateTime_('2026-11-08', '10:45', 0), '20261108T104500');
  checkEqual('★★★ 提早 45 分鐘照舊',
    gas.shiftIcsLocalDateTime_('2026-11-08', '10:45', 45), '20261108T100000');
}

console.log('\n=== A2：正式碼真係改用咗 normalizeTimeOfDay_，唔係淨係測 helper ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'IcsExport.gs'), 'utf8');

  check('★★★★★ defaultStart 用 normalizeTimeOfDay_',
    /defaultStart\s*=\s*normalizeTimeOfDay_\(/.test(src), src.slice(0, 200));
  check('★★★★★ defaultEnd 用 normalizeTimeOfDay_',
    /defaultEnd\s*=\s*normalizeTimeOfDay_\(/.test(src));
  check('★★★★★ 舊嘅 String(getConfig(…ICS_SERVICE…)) 寫法已經冇晒'
    + '——就係嗰句令 Date 物件變成英文長格式',
    !/String\(getConfig\(CONFIG_KEYS\.ICS_SERVICE_(START|END)_TIME/.test(src));
  check('★★★★ shiftIcsLocalDateTime_ 有 isNaN 防線',
    /timeParts\.some\(isNaN\)/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
