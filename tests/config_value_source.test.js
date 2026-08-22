// 第四十八輪批次 B 組：畫面講「來自 Config」，而個 Key 根本唔喺 Config 工作表。
// 執行方式：node tests/config_value_source.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-08-22，同一日、同一張試算表）
// ═════════════════════════════════════════════════════════════════════
//
// 「維護 ▸ 補填合堂跳過崗位」嘅確認畫面寫住：
//
//     要填進去的值（來自 Config「COMBINED_DEFAULT_SKIP_POST_IDS」）：
//       CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO
//
// 而同一日嘅「🩺 全面體檢」寫住：
//
//     CONFIG_KEYS 已登記但工作表沒有這個 Key：COMBINED_BACKFILL_BLOCKED_QUARTERS、
//     COMBINED_DEFAULT_SKIP_POST_IDS、QUARTER_RESET_BLOCKED_QUARTERS
//     （可到「維護 ▸ 補建 Config 參數」補上）
//
// **兩句都啱，合埋就係呃人。** 畫面叫幹事「呢個值嚟自 Config」，
// 佢去 Config 工作表搵唔到嗰一格，於是佢會以為自己睇漏咗眼。
//
// ─────────────────────────────────────────────────────────────────────
// 根源：`getConfig()` 分唔到三件事
// ─────────────────────────────────────────────────────────────────────
//
//   一、張表有嗰一行、有值　　　⇒ `SHEET`
//   二、張表有嗰一行、格係空白　⇒ `DEFAULT`
//   三、張表**根本冇嗰一行**　　⇒ `MISSING`
//
// 二同三喺 `getConfig()` 眼中一模一樣，而對幹事嚟講差好遠：
// 「格係空白」佢搵得到嗰一格去填；「冇嗰一行」佢點搵都搵唔到。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'SeasonRehearsal.gs', 'CombinedSkipBackfill.gs'
]);

/**
 * 把 `readConfig()` 換成一份指定嘅假 Config。
 *
 * ⚠️ 直接換 `readConfig`，唔係換 `getConfig`——要驗嘅正正就係
 * 「`getConfigWithSource()` 點樣讀同一份資料」。
 *
 * @param {Object} config 假 Config
 * @returns {void}
 */
function useConfig(config) {
  gas.readConfig = function () { return config; };
}

// =====================================================================
console.log('\n=== B1【核心】`getConfigWithSource()` 分得出三種來源 ===');
{
  const KEY = 'COMBINED_DEFAULT_SKIP_POST_IDS';
  const DEF = 'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO';

  useConfig({ COMBINED_DEFAULT_SKIP_POST_IDS: 'CHAIR' });
  const fromSheet = gas.getConfigWithSource(KEY, DEF);
  checkEqual('★★★★★ 張表有值 ⇒ `SHEET`', fromSheet.source, 'SHEET');
  checkEqual('★★★★★ 而且用張表嗰個值', fromSheet.value, 'CHAIR');

  useConfig({ COMBINED_DEFAULT_SKIP_POST_IDS: '' });
  const blank = gas.getConfigWithSource(KEY, DEF);
  checkEqual('★★★★★★ 張表**有嗰一行、格係空白** ⇒ `DEFAULT`'
    + '——佢搵得到嗰一格去填，同「冇嗰一行」係兩件事',
    blank.source, 'DEFAULT');
  checkEqual('★★★★★ 而且退回內建預設', blank.value, DEF);

  useConfig({ SOME_OTHER_KEY: 'x' });
  const missing = gas.getConfigWithSource(KEY, DEF);
  checkEqual('★★★★★★ 張表**根本冇嗰一行** ⇒ `MISSING`'
    + '——呢個就係現場嗰個情況，而 `getConfig()` 由頭到尾分唔出',
    missing.source, 'MISSING');
  checkEqual('★★★★★ 一樣退回內建預設', missing.value, DEF);

  // ⚠️ `undefined`／`null` 都要當「有行但係空白」，唔可以扮成 SHEET。
  useConfig({ COMBINED_DEFAULT_SKIP_POST_IDS: null });
  checkEqual('★★★★★ 格入面係 `null` ⇒ `DEFAULT`',
    gas.getConfigWithSource(KEY, DEF).source, 'DEFAULT');

  // ── 型別壞格 ────────────────────────────────────────────────
  //
  // ⚠️ 壞格**唔可以**扮成 `MISSING`。叫幹事「去跑補建 Config 參數」
  // 對住一個型別壞格完全冇用——嗰一行本來就喺度，跑幾多次都一樣。
  // 呢個就係本輪要修嗰種錯（畫面講一件事、實情係另一件事）嘅另一個樣。
  useConfig({
    COMBINED_DEFAULT_SKIP_POST_IDS: { __configTypeError__: true, message: '型別認不出來' }
  });
  let threw = '';
  try { gas.getConfigWithSource(KEY, DEF); } catch (err) { threw = err.message; }
  checkEqual('★★★★★★ 型別壞格照樣拋錯（同 `getConfig()` 一致）'
    + '——靜靜回一個「用緊預設值」會令一個壞格睇落好正常',
    threw, '型別認不出來');
  checkEqual('★★★★★★ 而 `getConfigWithSourceSafe_()` 唔拋，'
    + '但要標成 `ERROR`，**唔可以扮 `MISSING`**',
    gas.getConfigWithSourceSafe_(KEY, DEF).source, 'ERROR');
  checkEqual('★★★★★ 壞格仍然退回內建預設',
    gas.getConfigWithSourceSafe_(KEY, DEF).value, DEF);
}

// =====================================================================
console.log('\n=== B2【核心】畫面嗰句要跟住來源改 ===');
{
  const KEY = 'COMBINED_DEFAULT_SKIP_POST_IDS';

  checkEqual('★★★★★ `SHEET` ⇒ 簡短嗰句',
    gas.describeConfigValueOrigin_(KEY, 'SHEET'),
    '來自 Config「COMBINED_DEFAULT_SKIP_POST_IDS」');

  const missing = gas.describeConfigValueOrigin_(KEY, 'MISSING');
  check('★★★★★★ `MISSING` ⇒ **唔可以再講「來自 Config」**'
    + '——講咗，幹事就會去搵一格根本唔存在嘅嘢',
    missing.indexOf('來自 Config') === -1, missing);
  check('★★★★★★ 而且要講明「你喺嗰度搵唔到佢」',
    /還沒有加進 Config 工作表/.test(missing) && /找不到/.test(missing), missing);
  check('★★★★★★ 同埋要講返點樣補',
    /補建 Config 參數/.test(missing), missing);

  const dflt = gas.describeConfigValueOrigin_(KEY, 'DEFAULT');
  check('★★★★★★ `DEFAULT` 同 `MISSING` **講法要唔同**'
    + '——「有行但空白」叫佢喺嗰一格填，'
    + '「冇嗰一行」叫佢跑補建。講錯咗，佢就會做一件冇用嘅事',
    dflt !== missing && /那一格是空白/.test(dflt), dflt);
  check('★★★★★ 而且 `DEFAULT` 唔會叫佢去跑補建',
    /補建 Config 參數/.test(dflt) === false, dflt);

  const err = gas.describeConfigValueOrigin_(KEY, 'ERROR');
  check('★★★★★ `ERROR` 講得出係型別認唔出，唔係「冇設定」',
    /型別認不出來/.test(err), err);
}

// =====================================================================
console.log('\n=== B2 接線【核心】三個工具真係講埋來源 ===');
{
  // ⚠️ 呢一節最易假綠：`getConfigWithSource()` 寫好晒、測試全綠，
  // 而畫面上面仲寫住寫死嘅「來自 Config「X」」。
  const files = {
    'src/CombinedSkipBackfill.gs': 'COMBINED_DEFAULT_SKIP_POST_IDS',
    'src/AnnualCombined.gs': 'COMBINED_DEFAULT_SKIP_POST_IDS',
    'src/Menu.gs': 'QUARTER_RESET_BLOCKED_QUARTERS'
  };
  Object.keys(files).forEach(function (rel) {
    const body = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('★★★★★★ `' + rel.split('/').pop() + '` 用 `describeConfigValueOrigin_()`'
      + '，唔再寫死來源',
      /describeConfigValueOrigin_\(/.test(body), '');
    check('★★★★★★ `' + rel.split('/').pop() + '` 冇剩低寫死嘅'
      + '「來自 Config「」／「設定在 Config「」',
      !/來自 Config「/.test(body) && !/設定在 Config「/.test(body), '');
  });

  // 值同來源要由**同一支**函式出。
  const backfill = read('src/CombinedSkipBackfill.gs');
  check('★★★★★★ 值同來源由同一支 `…Detail_()` 出'
    + '——分開兩支嘅話，「畫面講嘅來源」同「實際採用嘅值」'
    + '可以慢慢分岔，而分岔咗之後個畫面睇落一樣正常',
    /function readCombinedDefaultSkipPostIdsDetail_\(/.test(backfill)
      && /return readCombinedDefaultSkipPostIdsDetail_\(\)\.value;/.test(backfill), '');

  // ⚠️ B3：**唔准順手替幹事補 Key。**
  check('★★★★★★ 補填工具唔會自己寫 Config'
    + '——補 Key 係「維護 ▸ 補建 Config 參數」嘅責任。'
    + '工具自己靜靜補一格，下次幹事去 Config 見到一格'
    + '唔記得自己加過嘅嘢，比搵唔到更差',
    !/setConfigValue_\(/.test(backfill) && !/SHEETS\.CONFIG/.test(backfill), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
