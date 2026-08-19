// 第三十一輪批次階段 A：ICS 時間——第二十三輪嘅修正從來冇生效過。
// 執行方式：node tests/ics_time_from_stringified_date.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測（2027T4 全季流程演練報告）
// ─────────────────────────────────────────────────────────────────────
//
//   ICS 附件 | 查不到 | 認不出這個時間值：
//   「Sat Dec 30 1899 10:45:00 GMT+1130 (New Zealand Daylight Time)」
//
// 根因：第二十三輪加咗一個 `[object Date]` 分支處理「Config 值係 Date 物件」。
// 但中間仲有一層——`Config.gs` 嘅 `convertConfigValue_()` 對 `STR` 型別
// 會做 `String(rawValue).trim()`，所以 Date 物件喺到達
// `normalizeTimeOfDay_()` 之前已經變咗文字，嗰個 `[object Date]` 檢查
// **永遠唔會中**。
//
// ⚠️ 而第二十三輪嘅測試「證明」咗修正有效，係因為佢**直接餵一個 Date 物件
// 落純函式**。同一個形狀今個星期出現咗三次：
//   掣 1 參數次序／`Mailer.gs` 個人 PDF／而家呢個。
//
// **所以呢一份每一段都由真正嘅入口叫落去。**

const { loadGasSource } = require('./helpers/gas_loader.js');

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
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}

const TZ = 'Pacific/Auckland';

/**
 * 真．時區感知嘅 `Utilities.formatDate` 替身。
 *
 * ⚠️ 唔可以用一個「直接讀 `getHours()`」嘅假替身——嗰樣會令測試喺
 * 任何機器上都「啱」，但完全冇驗證到時區轉換。呢度用 `Intl`，
 * 同 Apps Script 一樣真係按時區換算。
 */
function makeUtilities() {
  return {
    formatDate: function (date, tz, fmt) {
      if (fmt !== 'HH:mm') throw new Error('測試替身只支援 HH:mm：' + fmt);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(date);
      const get = function (t) {
        return (parts.filter(function (p) { return p.type === t; })[0] || {}).value;
      };
      return get('hour') + ':' + get('minute');
    }
  };
}

/* ══════════════════════════════════════════════════════════════
 * A2　純函式層：多認一種輸入
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A2【核心】已經被 String() 化嘅 Date ⇒ 認得返 ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs']);
  gas.Utilities = makeUtilities();

  // ⚠️ 呢個字串就係演練報告入面逐字嗰個。
  const real = 'Sat Dec 30 1899 10:45:00 GMT+1130 (New Zealand Daylight Time)';
  checkEqual('★★★★★ 演練報告嗰個真實壞值 ⇒ 「10:45」',
    gas.normalizeTimeOfDay_(real, '00:00', TZ), '10:45');

  const end = 'Sat Dec 30 1899 12:00:00 GMT+1130 (New Zealand Daylight Time)';
  checkEqual('★★★★★ 結束時間嗰格一樣',
    gas.normalizeTimeOfDay_(end, '00:00', TZ), '12:00');

  // 現代日期（Google 有時會用 1970 或者當日日期做基準）
  const modern = String(new Date(Date.UTC(2027, 11, 5, 21, 45)));
  checkEqual('★★★★ 現代日期嘅 String(Date) 一樣認得（Auckland ＝ UTC+13 夏令）',
    gas.normalizeTimeOfDay_(modern, '00:00', TZ), '10:45');

  checkEqual('★★★★★ Date 物件本身照舊得（第二十三輪嗰條路冇壞）',
    gas.normalizeTimeOfDay_(new Date(Date.UTC(2027, 11, 5, 21, 45)), '00:00', TZ), '10:45');
}

console.log('\n=== A2【核心】`HH:mm` 正常輸入唔會行去新嗰條路 ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs']);
  // 特登**唔**提供 `Utilities`——沙箱嘅預設 stub 一叫就拋錯。
  // 所以如果 `10:45` 行咗去 `Utilities.formatDate`，呢度就會爆。
  checkEqual('★★★★★ 「10:45」直接由正則那條路回，冇掂過 Utilities.formatDate'
    + '——次序寫反嘅話，一個正常輸入會被拉去一條完全唔需要嘅路',
    gas.normalizeTimeOfDay_('10:45', '00:00', TZ), '10:45');
  checkEqual('★★★★ 「9:05」補零', gas.normalizeTimeOfDay_('9:05', '00:00', TZ), '09:05');
  checkEqual('★★★★ 空白 ⇒ fallback', gas.normalizeTimeOfDay_('', '10:45', TZ), '10:45');
}

console.log('\n=== A2【核心】認唔出仍然要嘈，唔可以順手加返 fallback ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs']);
  gas.Utilities = makeUtilities();
  const threw = function (fn) {
    try { fn(); return null; } catch (err) { return err.message; }
  };

  check('★★★★★ 亂文字仍然拋錯',
    (threw(function () { gas.normalizeTimeOfDay_('唔知咩時間', '10:45', TZ); }) || '')
      .indexOf('認不出這個時間值') !== -1);
  check('★★★★★ **`2027` 唔可以被當成年份 parse 成功然後靜靜變 00:00**'
    + '——判斷特登收窄成「一定要有 時:分:秒 呢個形狀」，否則就係'
    + '「認唔出被當成一個有意義嘅值」嗰個 bug class',
    (threw(function () { gas.normalizeTimeOfDay_('2027', '10:45', TZ); }) || '')
      .indexOf('認不出這個時間值') !== -1,
    String(threw(function () { return gas.normalizeTimeOfDay_('2027', '10:45', TZ); })));
  check('★★★★★ `25:00`／`10:75`／`1045` 仍然拋錯——**唔會被 Date parse 撿返**'
    + '（實測 new Date("10:75") 會 parse 成 1974 年，'
    + 'new Date("1045") 會 parse 成 1045 年，兩個都會靜靜變成一個亂數時間）',
    (threw(function () { gas.normalizeTimeOfDay_('25:00', '10:45', TZ); }) || '')
      .indexOf('認不出這個時間值') !== -1
    && (threw(function () { gas.normalizeTimeOfDay_('10:75', '10:45', TZ); }) || '')
      .indexOf('認不出這個時間值') !== -1
    && (threw(function () { gas.normalizeTimeOfDay_('1045', '10:45', TZ); }) || '')
      .indexOf('認不出這個時間值') !== -1);
  check('★★★★★ 錯誤訊息照舊教人點修（純文字格式）'
    + '——嗰段字寫得好，唔好郁',
    (threw(function () { gas.normalizeTimeOfDay_('唔知咩時間', '10:45', TZ); }) || '')
      .indexOf('純文字') !== -1);
}

/* ══════════════════════════════════════════════════════════════
 * A4　**由真正嘅入口叫落去**：getConfig() → convertConfigValue_()
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A4【最重要】由 getConfig() 入口落去，唔係直接叫純函式 ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Config.gs']);
  gas.Utilities = makeUtilities();
  gas.CacheService = { getScriptCache: function () {
    return { get: function () { return null; }, put: function () {} };
  } };

  const C = gas.COLUMNS.CONFIG;
  // ⚠️ 模擬真實環境：`Config` 工作表嗰一格係一個 **Date 物件**
  //（Google 把「睇落似時間」嘅格自動轉），型別欄係 `STR`。
  const cell = new Date(Date.UTC(1899, 11, 29, 23, 15));   // 1899-12-30 10:45 NZ
  const rows = [{}, {}];
  rows[0][C.KEY] = gas.CONFIG_KEYS.ICS_SERVICE_START_TIME;
  rows[0][C.VALUE] = cell;
  rows[0][C.TYPE] = 'STR';
  rows[1][C.KEY] = gas.CONFIG_KEYS.SYS_TIMEZONE;
  rows[1][C.VALUE] = TZ;
  rows[1][C.TYPE] = 'STR';
  gas.readSheet = function () { return rows; };

  const fromConfig = gas.getConfig(gas.CONFIG_KEYS.ICS_SERVICE_START_TIME, '00:00');

  check('★★★★★ **確認中間嗰層真係把 Date 變咗文字**'
    + '——呢個就係第二十三輪漏咗嘅一層',
    typeof fromConfig === 'string' && fromConfig.indexOf('1899') !== -1,
    JSON.stringify(fromConfig));

  checkEqual('★★★★★ 而由呢個入口攞到嘅值，經 normalizeTimeOfDay_() 之後 ⇒ 「10:45」'
    + '——修正而家真係生效',
    gas.normalizeTimeOfDay_(fromConfig, '00:00', TZ), '10:45');
}

console.log('\n=== A4 Config 那一格已經係純文字時，一樣要行得通 ===');
{
  // Ivan 已經把試算表嗰兩格改成純文字（現時係 10:45／12:00）。
  // 兩條路都要行得通——治本唔等於把舊路改壞。
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Config.gs']);
  gas.CacheService = { getScriptCache: function () {
    return { get: function () { return null; }, put: function () {} };
  } };
  const C = gas.COLUMNS.CONFIG;
  const rows = [{}];
  rows[0][C.KEY] = gas.CONFIG_KEYS.ICS_SERVICE_START_TIME;
  rows[0][C.VALUE] = '10:45';
  rows[0][C.TYPE] = 'STR';
  gas.readSheet = function () { return rows; };

  const fromConfig = gas.getConfig(gas.CONFIG_KEYS.ICS_SERVICE_START_TIME, '00:00');
  checkEqual('★★★★★ 純文字格 ⇒ 「10:45」（而且冇掂過 Utilities.formatDate）',
    gas.normalizeTimeOfDay_(fromConfig, '00:00', TZ), '10:45');
}

console.log('\n=== A4 完整鏈路：ICS 檔案入面嘅 DTSTART 唔會有 NaN ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'IcsExport.gs']);
  gas.Utilities = makeUtilities();

  const real = 'Sat Dec 30 1899 10:45:00 GMT+1130 (New Zealand Daylight Time)';
  const start = gas.normalizeTimeOfDay_(real, '00:00', TZ);
  const shifted = gas.shiftIcsLocalDateTime_('2027-12-05', start, 0);

  check('★★★★★ `DTSTART` 嘅本地時間字串冇 NaN'
    + '——之前撞到嘅 `NaNNaNNaNTNaNNaN00` 就係由呢個值開始壞落去',
    String(shifted).indexOf('NaN') === -1, String(shifted));
  checkEqual('★★★★ 而且真係 2027-12-05 10:45', shifted, '20271205T104500');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
