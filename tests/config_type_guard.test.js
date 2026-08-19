// 第三十二輪批次階段 A：Config 的 INT／DEC／BOOL／LIST 認不出就要嘈。
// 執行方式：node tests/config_type_guard.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解呢個係整套系統最貴嘅一個靜默失敗
// ─────────────────────────────────────────────────────────────────────
//
// 舊 `convertConfigValue_()`：
//   INT / DEC ⇒ `Number('Sat Dec 30 1899 …')` ＝ `NaN`
//              ⇒ 下游多數寫 `Number(x) || DEFAULT` ⇒ 靜靜退回預設值
//              ⇒ 即係「你喺 Config 改嗰個數字完全冇生效」，而畫面上冇任何提示
//   BOOL      ⇒ 長字串 `.toUpperCase() !== 'TRUE'` ⇒ `false`
//              ⇒ **而 `DRY_RUN` 就係 BOOL。**嗰格一旦被試算表轉成非文字，
//                 `DRY_RUN` 靜靜變 `false` ＝ 真係寄信俾全體義工。
//
// ⚠️ 而呢一份**每一段都由 `getConfig()` 呢個真入口叫落去**。
// 第三十一輪階段 A 就係被呢一點燒過：測試直接餵純函式，
// 「證明」咗一個由頭到尾冇生效過嘅修正。

const { loadGasSource } = require('./helpers/gas_loader.js');

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
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}
function threw(fn) {
  try { fn(); return null; } catch (err) { return err.message; }
}

/** 試算表把格自動轉成 Date 之後，`String()` 出嚟就係呢個形狀。 */
const SHEETS_DATE = 'Sat Dec 30 1899 10:45:00 GMT+1130 (New Zealand Daylight Time)';

/**
 * 砌一個載好 Config.gs 嘅沙箱，並且**由 `getConfig()` 入口攞值**。
 * @param {Array<[string, string, *]>} triples `[key, type, value]`
 */
function makeGas(triples) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Config.gs']);
  gas.CacheService = {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {}, remove: function () {} };
    }
  };
  const C = gas.COLUMNS.CONFIG;
  const rows = triples.map(function (t) {
    const row = {};
    row[C.KEY] = t[0];
    row[C.TYPE] = t[1];
    row[C.VALUE] = t[2];
    return row;
  });
  gas.readSheet = function () { return rows; };
  return gas;
}

/* ══════════════════════════════════════════════════════════════
 * A5-1　正常值嘅行為**一模一樣**（唔可以順手改壞現有行為）
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A5【核心】正常值：行為同改動前完全一樣 ===');
{
  const gas = makeGas([
    ['N_INT', 'INT', '3'],
    ['N_INT_NEG', 'INT', '-7'],
    ['N_INT_ZERO', 'INT', '0'],
    ['N_DEC', 'DEC', '3.5'],
    ['N_BOOL_UPPER', 'BOOL', 'TRUE'],
    ['N_BOOL_LOWER', 'BOOL', 'true'],
    ['N_BOOL_FALSE', 'BOOL', 'FALSE'],
    ['N_LIST', 'LIST', 'a, b ,c'],
    ['N_STR', 'STR', ' hello '],
    ['N_ENUM', 'ENUM', 'WEEKLY']
  ]);
  checkEqual("★★★★★ INT '3' ⇒ 3", gas.getConfig('N_INT', 999), 3);
  checkEqual('★★★★ INT 負數照舊', gas.getConfig('N_INT_NEG', 999), -7);
  checkEqual('★★★★★ INT 0 唔會被當成「冇設定」而退去 fallback'
    + '——0 係一個合法設定值',
    gas.getConfig('N_INT_ZERO', 999), 0);
  checkEqual("★★★★★ DEC '3.5' ⇒ 3.5", gas.getConfig('N_DEC', 999), 3.5);
  checkEqual("★★★★★ BOOL 'TRUE' ⇒ true", gas.getConfig('N_BOOL_UPPER', null), true);
  checkEqual("★★★★★ BOOL 'true'（細楷）⇒ true", gas.getConfig('N_BOOL_LOWER', null), true);
  checkEqual("★★★★★ BOOL 'FALSE' ⇒ false（而且唔係經 fallback 攞返嚟）",
    gas.getConfig('N_BOOL_FALSE', 'FALLBACK'), false);
  checkEqual('★★★★★ LIST 逐項 trim', gas.getConfig('N_LIST', null), ['a', 'b', 'c']);
  checkEqual('★★★★★ STR 照舊 trim，唔會被新防線攔住',
    gas.getConfig('N_STR', null), 'hello');
  checkEqual('★★★★ ENUM 照舊', gas.getConfig('N_ENUM', null), 'WEEKLY');
}

console.log('\n=== A5 空字串：三種型別各自嘅舊行為都要保住 ===');
{
  const gas = makeGas([
    ['E_INT', 'INT', ''], ['E_DEC', 'DEC', '  '],
    ['E_BOOL', 'BOOL', ''], ['E_LIST', 'LIST', '']
  ]);
  // `convertConfigValue_()` 回 `null`，而 `getConfig()` 對 `null` 會用 fallback。
  checkEqual('★★★★★ INT 空白 ⇒ 純函式回 null',
    gas.convertConfigValue_('', 'INT', 'E_INT'), null);
  checkEqual('★★★★ 由入口睇就係退去 fallback', gas.getConfig('E_INT', 42), 42);
  checkEqual('★★★★★ BOOL 空白 ⇒ false（**唔可以改成拋錯**——'
    + '幾十個呼叫點都靠住「冇設定 ＝ 唔開」）',
    gas.convertConfigValue_('', 'BOOL', 'E_BOOL'), false);
  checkEqual('★★★★★ LIST 空白 ⇒ []', gas.convertConfigValue_('', 'LIST', 'E_LIST'), []);
}

/* ══════════════════════════════════════════════════════════════
 * A5-2　認唔出就要嘈——**由入口叫落去**
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A5【核心】被 Sheets 正規化嘅值 ⇒ 由 getConfig() 拋錯 ===');
{
  [['PDF_BATCH_SIZE', 'INT'], ['SOME_RATIO', 'DEC'], ['DRY_RUN', 'BOOL'],
    ['SOME_LIST', 'LIST']].forEach(function (t) {
    const gas = makeGas([[t[0], t[1], SHEETS_DATE]]);
    const msg = threw(function () { gas.getConfig(t[0], '安全預設'); });
    check('★★★★★ ' + t[1] + '（' + t[0] + '）⇒ 拋錯，唔會靜靜回預設值',
      msg !== null, '完全冇拋錯，回咗：' + JSON.stringify(
        (function () { try { return gas.getConfig(t[0], '安全預設'); } catch (e) { return '(threw)'; } })()));
    check('★★★★★ 而且訊息含 Key 名（唔係「某個參數」）',
      (msg || '').indexOf(t[0]) !== -1, msg);
  });
}

console.log('\n=== A2【核心】錯誤訊息要講齊四件事 ===');
{
  const gas = makeGas([['PDF_BATCH_SIZE', 'INT', SHEETS_DATE]]);
  const msg = threw(function () { gas.getConfig('PDF_BATCH_SIZE', 25); }) || '';
  check('★★★★★ 1／講得出係邊個 Key 同宣告型別',
    msg.indexOf('PDF_BATCH_SIZE') !== -1 && msg.indexOf('INT') !== -1, msg);
  check('★★★★★ 2／逐字印返讀到嘅原值（加引號）',
    msg.indexOf(SHEETS_DATE) !== -1 && msg.indexOf('「') !== -1, msg);
  check('★★★★★ 3／講得出最可能嘅原因（試算表自動當成日期／數字）'
    + '——冇呢句，幹事望住個格見到原本輸入嘅嘢會完全唔明',
    msg.indexOf('自動當成日期') !== -1, msg);
  check('★★★★★ 4／講得出點樣修（格式 ▸ 數字 ▸ 純文字 ▸ 重新輸入）',
    msg.indexOf('純文字') !== -1 && msg.indexOf('重新輸入') !== -1, msg);
  check('★★★★ 而且提埋要重新載入設定（改完唔重載係睇唔到效果嘅）',
    msg.indexOf('重新載入設定') !== -1, msg);
}

console.log('\n=== A2【核心】DRY_RUN 要有專屬嗰一句 ===');
{
  const gas = makeGas([['DRY_RUN', 'BOOL', SHEETS_DATE]]);
  const msg = threw(function () { gas.getConfig('DRY_RUN', true); }) || '';
  check('★★★★★ **明講呢個參數控制會唔會真正寄出電郵**'
    + '——舊行為係靜靜變 false，即係真係寄咗俾全體義工',
    msg.indexOf('真正寄出電郵') !== -1, msg);
  check('★★★★★ 而且明講確認之前任何寄送動作都會被擋',
    msg.indexOf('任何寄送動作都會被擋住') !== -1, msg);

  const other = makeGas([['PDF_BATCH_SIZE', 'INT', SHEETS_DATE]]);
  const otherMsg = threw(function () { other.getConfig('PDF_BATCH_SIZE', 25); }) || '';
  check('★★★★ 而其他參數唔會有嗰句（唔可以句句都講寄信，講到冇人再睇）',
    otherMsg.indexOf('真正寄出電郵') === -1, otherMsg);
}

console.log('\n=== A1【核心】INT 要擋小數；DEC 唔擋 ===');
{
  const gas = makeGas([['I', 'INT', '3.5'], ['D', 'DEC', '3.5'],
    ['INF', 'INT', 'Infinity'], ['DINF', 'DEC', 'Infinity']]);
  check("★★★★★ INT '3.5' ⇒ 拋錯（INT 就係整數）",
    (threw(function () { gas.getConfig('I', 1); }) || '').indexOf('小數') !== -1,
    String(threw(function () { return gas.getConfig('I', 1); })));
  checkEqual("★★★★★ DEC '3.5' ⇒ 3.5（唔可以順手一齊擋）", gas.getConfig('D', 1), 3.5);
  check('★★★★ INT Infinity ⇒ 拋錯', threw(function () { gas.getConfig('INF', 1); }) !== null);
  check('★★★★ DEC Infinity ⇒ 一樣拋錯', threw(function () { gas.getConfig('DINF', 1); }) !== null);
}

console.log('\n=== A1 BOOL 只認 TRUE／FALSE，其餘要嘈 ===');
{
  const gas = makeGas([['B1', 'BOOL', '1'], ['B2', 'BOOL', 'yes'],
    ['B3', 'BOOL', '是'], ['B4', 'BOOL', 'False']]);
  ['B1', 'B2', 'B3'].forEach(function (k) {
    check('★★★★★ BOOL「' + k + '」認唔出 ⇒ 拋錯'
      + '（舊行為係靜靜當成 false，而 false 對 DRY_RUN 嚟講就係「真係寄」）',
      threw(function () { gas.getConfig(k, null); }) !== null);
  });
  checkEqual("★★★★ 'False' 大小寫混合仍然認得", gas.getConfig('B4', null), false);
}

console.log('\n=== A1 STR／ENUM／EMAIL 一律唔改（唔可以攔住下游嘅治本）===');
{
  const gas = makeGas([
    ['ICS_SERVICE_START_TIME', 'STR', SHEETS_DATE],
    ['SOME_ENUM', 'ENUM', SHEETS_DATE],
    ['SOME_EMAIL', 'EMAIL', SHEETS_DATE]
  ]);
  ['ICS_SERVICE_START_TIME', 'SOME_ENUM', 'SOME_EMAIL'].forEach(function (k) {
    check('★★★★★ ' + k + ' 唔會喺呢一層拋錯'
      + '——`ICS_SERVICE_START_TIME` 靠下游 `normalizeTimeOfDay_()` 處理，'
      + '喺呢度攔住會令第三十一輪嗰個治本永遠用唔著',
      threw(function () { gas.getConfig(k, ''); }) === null,
      String(threw(function () { return gas.getConfig(k, ''); })));
  });
  checkEqual('★★★★ 而且值原樣傳落去，冇被改過',
    gas.getConfig('ICS_SERVICE_START_TIME', ''), SHEETS_DATE);
}

/* ══════════════════════════════════════════════════════════════
 * A3　一個壞格唔可以令全個系統停擺
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A3【核心】一個 key 壞，其他 key 照讀得到 ===');
{
  const gas = makeGas([
    ['GOOD_INT', 'INT', '25'],
    ['BAD_INT', 'INT', SHEETS_DATE],
    ['GOOD_BOOL', 'BOOL', 'TRUE'],
    ['GOOD_STR', 'STR', 'hello']
  ]);
  checkEqual('★★★★★ 好嗰個 INT 照讀得到', gas.getConfig('GOOD_INT', 999), 25);
  checkEqual('★★★★★ 好嗰個 BOOL 照讀得到', gas.getConfig('GOOD_BOOL', null), true);
  checkEqual('★★★★★ 好嗰個 STR 照讀得到', gas.getConfig('GOOD_STR', null), 'hello');
  check('★★★★★ **只有讀壞嗰個先拋錯**'
    + '——喺 `readConfig()` 整批炸嘅話，幹事會見到每一粒掣都彈同一個錯，'
    + '完全睇唔出係邊一格出事',
    threw(function () { gas.getConfig('BAD_INT', 1); }) !== null);
  check('★★★★★ 而 `readConfig()` 自己唔會拋',
    threw(function () { gas.readConfig(); }) === null,
    String(threw(function () { return gas.readConfig(); })));
}

console.log('\n=== A3 記號要捱得住 JSON 來回（快取層）===');
{
  const gas = makeGas([['BAD_INT', 'INT', SHEETS_DATE]]);
  const marker = gas.readConfig()['BAD_INT'];
  const roundTripped = JSON.parse(JSON.stringify(marker));
  check('★★★★★ `JSON.parse(JSON.stringify())` 之後仲認得出'
    + '——`readConfig()` 會把結果 stringify 落快取。'
    + '用 Error 物件或者 Symbol 就會喺嗰一轉靜靜變成 `{}`，'
    + '然後個壞格會變成一個睇落正常嘅物件',
    gas.isConfigTypeErrorMarker_(roundTripped) === true, JSON.stringify(roundTripped));
  check('★★★★ 而且訊息保住咗', String(roundTripped.message).indexOf('BAD_INT') !== -1);
}

console.log('\n=== A3 顯示層唔可以印 [object Object] 或者扮成「用緊預設值」 ===');
{
  const gas = makeGas([['BAD_INT', 'INT', SHEETS_DATE]]);
  const d = gas.describeConfigValue_(gas.readConfig(), 'BAD_INT', 25);
  check('★★★★★ 唔會印 `[object Object]`', d.display.indexOf('[object Object]') === -1, d.display);
  check('★★★★★ **亦唔會扮成「Config 未設定，用預設值」**'
    + '——嗰句會令人以為冇事，實情係嗰格壞咗',
    d.usedFallback === false && d.display.indexOf('未設定') === -1, JSON.stringify(d));
  check('★★★★ 而且指返去邊度睇詳情', d.display.indexOf('全面體檢') !== -1, d.display);
}

/* ══════════════════════════════════════════════════════════════
 * A4　體檢一次過見晒
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== A4【核心】體檢有「Config 值型別檢查」一節 ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Config.gs', 'FullHealthCheck.gs']);
  const C = gas.COLUMNS.CONFIG;
  const mk = function (k, t, v) { const r = {}; r[C.KEY] = k; r[C.TYPE] = t; r[C.VALUE] = v; return r; };

  const clean = gas.classifyConfigValueTypeHealth_([
    mk('A', 'INT', '3'), mk('B', 'BOOL', 'TRUE'), mk('C', 'STR', 'x')
  ]);
  check('★★★★★ 全部正常 ⇒ 寫「N 個參數全部正常」',
    clean.summary.indexOf('3 個參數全部正常') !== -1, JSON.stringify(clean));
  checkEqual('★★★★ 而且分級係 INFO', clean.severity, gas.HEALTH_SEVERITY.INFO);

  const boolBad = gas.classifyConfigValueTypeHealth_([
    mk('DRY_RUN', 'BOOL', SHEETS_DATE), mk('OK', 'INT', '3')
  ]);
  checkEqual('★★★★★ **BOOL 出事 ⇒ MUST**（DRY_RUN 就係 BOOL）',
    boolBad.severity, gas.HEALTH_SEVERITY.MUST);
  check('★★★★★ 而且明講信會真嘅寄出去',
    boolBad.details.join('\n').indexOf('真的寄出去') !== -1, boolBad.details.join('\n'));

  const intBad = gas.classifyConfigValueTypeHealth_([
    mk('PDF_BATCH_SIZE', 'INT', SHEETS_DATE), mk('OK', 'BOOL', 'TRUE')
  ]);
  checkEqual('★★★★★ 淨係 INT 出事 ⇒ SHOULD（唔好樣樣都 MUST，'
    + '樣樣都緊急即係冇嘢緊急）', intBad.severity, gas.HEALTH_SEVERITY.SHOULD);
  const text = intBad.details.join('\n');
  check('★★★★★ 逐項寫齊 Key、型別、原值、修法',
    text.indexOf('PDF_BATCH_SIZE') !== -1 && text.indexOf('INT') !== -1
    && text.indexOf(SHEETS_DATE) !== -1 && text.indexOf('純文字') !== -1, text);
  check('★★★★★ 而且講明「目前沒有生效，系統會用程式碼的預設值」'
    + '——呢句先係幹事最需要知嗰件事',
    intBad.note.indexOf('沒有生效') !== -1, intBad.note);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
