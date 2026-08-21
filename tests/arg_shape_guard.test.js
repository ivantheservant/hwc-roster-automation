// 第三十輪批次階段 A2：參數次序調轉要拋一個講得清楚嘅錯，**唔可以自動糾正**。
// 執行方式：node tests/arg_shape_guard.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有
// ─────────────────────────────────────────────────────────────────────
//
// `findStateViolations_(state, context)` 兩個參數都係「一個物件」，
// 傳反咗 JS 唔會投訴。錯誤要行到第 5 行讀 `context.posts.forEach` 先爆，
// 而個訊息係 `Cannot read properties of undefined (reading 'forEach')`
// ——完全講唔出真正嘅原因。
//
// ⚠️ **唔可以自動糾正。**
// 「見到第一個係物件就自己調轉」會令錯誤靜靜消失，
// 下一個人照樣寫錯，而且下一次調轉嘅可能係另一對參數。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RoleImpact.gs',
  'Generator.gs', 'FineTune.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const argShapeSrc = read('src/ArgShape.gs');

/** 收集一次拋錯。 */
function caught(fn) {
  try { fn(); return null; } catch (err) { return err.message; }
}

const CONTEXT = {
  posts: [], serviceDates: [], rules: {}, eligibility: { byPost: {} },
  peopleById: {}, roles: { rows: [] }, personPostExclusions: []
};
const STATE = [];

console.log('\n=== A2【核心】次序調轉 ⇒ 拋錯，而且講得出係次序問題 ===');
{
  const msg = caught(function () { gas.findStateViolations_(CONTEXT, STATE); });
  check('★★★★★ 有拋錯（唔會行到深處先爆一個講唔出原因嘅 TypeError）',
    msg !== null, String(msg));
  check('★★★★★ 訊息指名邊個函式',
    msg && msg.indexOf('findStateViolations_()') === 0, msg);
  check('★★★★★ 明講「次序似乎調轉了」'
    + '——一句「參數不對」唔夠：呢個錯嘅正解就係把兩個參數掉轉',
    msg && msg.indexOf('次序似乎調轉了') !== -1, msg);
  check('★★★★★ 講得出邊個位應該係咩'
    + '（第 1 個係 state、第 2 個先係 context）',
    msg && msg.indexOf('第 1 個參數應該是派工狀態陣列（state）') !== -1
    && msg.indexOf('第 2 個才是 context') !== -1, msg);
  check('★★★★★ 講得出**收到嘅係咩**（型別／有邊幾個欄位）'
    + '——冇呢一句就要自己去 log 印一次先知',
    msg && /收到的第 1 個參數：物件（有 \.posts/.test(msg), msg);
}

console.log('\n=== A2【核心】**唔會自動糾正** ===');
{
  const before = JSON.stringify(CONTEXT);
  const msg = caught(function () { gas.findStateViolations_(CONTEXT, STATE); });
  check('★★★★★ 傳反咗一定拋錯，唔會「自己掉轉然後扮冇事」'
    + '——自動糾正會令錯誤靜靜消失，下一個人照樣寫錯',
    msg !== null);
  check('★★★★ 而且冇改動傳入嘅物件', JSON.stringify(CONTEXT) === before);

  // 反面：原始碼入面唔應該有任何「調轉返」嘅邏輯。
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  const code = stripComments(argShapeSrc);
  check('★★★★★ `ArgShape.gs` 冇任何 swap／交換／重排參數嘅程式碼',
    !/\[a, ?b\] = \[b, ?a\]|swapArgs|arguments\[0\] = /.test(code)
    && !/return requireStateArg_\([^)]*context/.test(code));
}

console.log('\n=== A2 正確次序照樣行得過（防線唔可以擋住正常呼叫）===');
{
  check('★★★★★ `(state, context)` 正常回一個陣列',
    Array.isArray(gas.findStateViolations_(STATE, CONTEXT)));
  check('★★★★ 有內容嘅 state 一樣行得過',
    Array.isArray(gas.findStateViolations_(
      [{ serviceDateId: 'SD1', serviceDate: '2027-10-03', postId: 'CHAIR',
        slotIndex: 1, personId: 'P9001' }], CONTEXT)));
}

console.log('\n=== A2 其餘同時收 state 同 context 嘅函式 ===');
{
  const replMsg = caught(function () {
    gas.findReplacementPerson_({ postId: 'CHAIR' }, CONTEXT, STATE);
  });
  check('★★★★★ `findReplacementPerson_(violation, state, context)` 有防線',
    replMsg && replMsg.indexOf('findReplacementPerson_()') === 0
    && replMsg.indexOf('第 2 個參數應該是派工狀態陣列') !== -1, replMsg);

  const limitMsg = caught(function () {
    gas.exceedsAssignmentLimit_('P9001', CONTEXT, STATE);
  });
  check('★★★★★ `exceedsAssignmentLimit_(personId, state, context)` 有防線',
    limitMsg && limitMsg.indexOf('exceedsAssignmentLimit_()') === 0
    && limitMsg.indexOf('第 2 個參數應該是派工狀態陣列') !== -1, limitMsg);

  const overlayMsg = caught(function () { gas.buildGridOverlayState_(STATE); });
  check('★★★★★ `buildGridOverlayState_(context)` 認得出「收到一個陣列」',
    overlayMsg && overlayMsg.indexOf('收到的是一個陣列（state？）') !== -1, overlayMsg);

  const analyseMsg = caught(function () { gas.analyseManualState_(STATE); });
  check('★★★★★ `analyseManualState_(context)` 一樣',
    analyseMsg && analyseMsg.indexOf('analyseManualState_()') === 0, analyseMsg);
}

console.log('\n=== A2 `materialiseManualEdits_()` 次序係相反嘅（context 行先）===');
{
  const stateSource = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RoleImpact.gs',
    'Generator.gs', 'FineTune.gs', 'StateSource.gs'
  ]);
  const msg = (function () {
    try {
      stateSource.materialiseManualEdits_(STATE, [{ any: 1 }], CONTEXT, 'test');
      return null;
    } catch (err) { return err.message; }
  })();
  check('★★★★★ 傳成 `(state, changes, context, …)` ⇒ 拋錯'
    + '——呢個函式同 `findStateViolations_()` **次序相反**，'
    + '而兩個都喺 `apiSaveAndConfirmExecute()` 同一條路徑上面被叫，'
    + '係最易寫錯嗰種形狀',
    msg && msg.indexOf('materialiseManualEdits_()') === 0
    && msg.indexOf('第 1 個參數應該是 context') !== -1, msg);
}

console.log('\n=== A2 錯誤訊息唔會倒出資料內容（入面有真人資料）===');
{
  const withNames = Object.assign({}, CONTEXT, {
    peopleById: { P9001: { nameTC: '測試甲' } }
  });
  const msg = caught(function () { gas.findStateViolations_(withNames, STATE); });
  check('★★★★★ 只講型別同有邊幾個欄位，**唔會 JSON.stringify 成個物件**'
    + '——錯誤訊息會入 Logger、有機會出喺畫面上',
    msg && msg.indexOf('測試甲') === -1 && msg.indexOf('P9001') === -1, msg);
  check('★★★★ `describeArgShape_()` 逐種型別都講得出',
    gas.describeArgShape_(null) === 'null'
    && gas.describeArgShape_(undefined) === 'undefined'
    && gas.describeArgShape_([1, 2]) === '陣列（長度 2）'
    && gas.describeArgShape_('x') === 'string'
    && gas.describeArgShape_({}) === '物件（沒有 .posts／.serviceDates／.rules）');
}

console.log('\n=== A2 防線一定要載入到（`ArgShape.gs` 零依賴）===');
{
  check('★★★★★ `ArgShape.gs` 冇叫任何試算表 API'
    + '——一個「參數檢查」如果自己都要讀試算表，就冇辦法喺最早期擋住',
    !/SpreadsheetApp|DriveApp|readSheet|getConfig/.test(argShapeSrc));
  check('★★★★★ 測試 loader 會自動載入佢'
    + '——唔自動載嘅話，每一份測試都要自己記得補一行，'
    + '而漏咗嘅錯誤（`requireStateArg_ is not defined`）同測試本身完全無關',
    // ⚠️ 第四十四輪批次加過 `SafeWrite.gs` 落呢個清單，第四十五輪已經移除
    // （嗰個檔係為一個判錯咗嘅成因而做嘅）。斷言守嘅係
    // 「`ArgShape.gs` 喺嗰個清單入面」，唔會貼住清單有幾多個。
    /const ALWAYS_LOADED = \[[^\]]*'ArgShape\.gs'/
      .test(read('tests/helpers/gas_loader.js')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
