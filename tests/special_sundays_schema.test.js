// 第四十七輪批次 C 組：`SpecialSundays` 根本冇 `Confirmed` 欄。
// 執行方式：node tests/special_sundays_schema.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（用 Google Drive connector 讀真實試算表查到）
// ═════════════════════════════════════════════════════════════════════
//
// 試算表 `SpecialSundays` 第 2 行實際係 12 欄，**冇 `Confirmed`**。
//
// 而程式碼呢邊：
//   ・`Constants.gs` 有 `COLUMNS.SPECIAL_SUNDAYS.CONFIRMED`
//   ・`AnnualCombined.gs` 會 `setCell(C.CONFIRMED, …)`
//   ・`isUnconfirmedSpecialSunday_()` 會讀 `row[C.CONFIRMED]`
//   ・`WebAppPreQuarterEdit.gs` 會寫 `updates[S.CONFIRMED]`
//   ・`ConfigSeed.gs` 嘅說明文字寫住「Confirmed 欄明確填了 FALSE 的列」
//
// **但** `SpecialSundaysSeed.gs` 兩個 header 陣列都只有 12 項。
// 所以建表路徑由頭到尾冇造過呢一欄。
//
// ─────────────────────────────────────────────────────────────────────
// 三個後果（全部已經喺真實資料上證實）
// ─────────────────────────────────────────────────────────────────────
//
// 一、`setCell()` 有 `if (col > 0)` 守衛 ⇒ 欄唔存在就**靜靜唔寫**。
//     年度合堂工具本來要把五月嗰行標 `Confirmed=FALSE`，實際係空白。
// 二、`isUnconfirmedSpecialSunday_()` 讀到 `undefined` ⇒ 走「空白＝已確認」
//     ⇒ 「未確認的特殊主日」**永遠係 0**。全面體檢報告現時就係
//     「未確認的特殊主日 0 個（已提醒 0 / 3 次）」。
// 三、`tests/unconfirmed_special_reminder.test.js` 嘅 fixture header
//     **手砌咗** `'Confirmed'`，所以整套測試全綠。
//
// ⚠️ 第三點就係呢個專案由第一輪殺到而家嗰一種錯：
// **fixture 造咗一個真實 code path 造唔出嘅狀態。**
//
// 所以呢一份守嘅係：**header 陣列同 `COLUMNS` 對得上**，
// 而且 fixture 一律由 `getSpecialSundaysHeaderKeys_()` 出。

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

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SpecialSundaysSeed.gs',
  'AnnualCombined.gs'
]);

// =====================================================================
console.log('\n=== C1【核心】header 陣列一定要有 `Confirmed` ===');
{
  const keys = gas.getSpecialSundaysHeaderKeys_();
  check('★★★★★★ `getSpecialSundaysHeaderKeys_()` 有 `Confirmed`'
    + '——冇嘅話建表路徑永遠造唔出呢一欄，'
    + '而全專案有五處程式碼讀寫佢',
    keys.indexOf(gas.COLUMNS.SPECIAL_SUNDAYS.CONFIRMED) !== -1,
    JSON.stringify(keys));
  check('★★★★★★ 而且加咗喺**最後**'
    + '——插喺中間會令既有試算表所有列嘅資料整排移位',
    keys[keys.length - 1] === gas.COLUMNS.SPECIAL_SUNDAYS.CONFIRMED,
    JSON.stringify(keys));
  check('★★★★★ 中文標題同機器鍵一一對應（長度一樣）',
    gas.SPECIAL_SUNDAYS_HEADERS_TC.length === keys.length,
    gas.SPECIAL_SUNDAYS_HEADERS_TC.length + ' vs ' + keys.length);
  check('★★★★★ 中文標題講得出方向（留空＝已確認）'
    + '——唔講嘅話，幹事見到一個空欄會以為「全部都未確認」',
    /留空＝已確認/.test(gas.SPECIAL_SUNDAYS_HEADERS_TC[keys.length - 1]),
    gas.SPECIAL_SUNDAYS_HEADERS_TC[keys.length - 1]);

  // ⚠️ 全部喺 `COLUMNS.SPECIAL_SUNDAYS` 定義過嘅鍵都要喺 header 入面。
  const defined = Object.keys(gas.COLUMNS.SPECIAL_SUNDAYS)
    .map(function (k) { return gas.COLUMNS.SPECIAL_SUNDAYS[k]; });
  const missing = defined.filter(function (v) { return keys.indexOf(v) === -1; });
  check('★★★★★★ **`COLUMNS.SPECIAL_SUNDAYS` 冇一個鍵漏喺 header 外面**'
    + '——漏一個就係一條「程式碼讀寫、而張表根本冇」嘅死路',
    missing.length === 0, JSON.stringify(missing));
}

// =====================================================================
console.log('\n=== C3【核心】欄唔存在 ⇒ **大聲失敗**，唔可以靜靜唔寫 ===');
{
  const src = read('src/AnnualCombined.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ `setCell()` 見到欄唔存在會 `throw`'
    + '——本來係 `if (col > 0)`，即係靜靜略過。'
    + '而靜靜略過嘅後果係：工具報告「已經標咗未確認」，而表上係空白',
    /throw new Error\(/.test(
      src.slice(src.indexOf('const setCell ='), src.indexOf('const setCell =') + 900)),
    src.slice(src.indexOf('const setCell ='), src.indexOf('const setCell =') + 500));
  check('★★★★★★ 而且訊息講得出**係邊一欄**同**去邊度補**',
    /補建 SpecialSundays 缺欄/.test(src), '');
}

// =====================================================================
console.log('\n=== C2【核心】遷移工具：只補喺最後，唔重排、唔改既有資料 ===');
{
  const src = read('src/SpecialSundaysSeed.gs');
  check('★★★★★ 有 `planSpecialSundaysColumnBackfill_()`',
    /function planSpecialSundaysColumnBackfill_\(/.test(src), '');
  check('★★★★★★ 已經有嗰一欄 ⇒ **乜都唔做**，而且明確報「已經有了」'
    + '——靜靜做多次會令幹事以為佢做漏咗',
    /已經有了，沒有改動/.test(src), '');
  check('★★★★★★ **唔會順手替既有列填值**'
    + '——邊一行嘅日期真係未確認，只有幹事知；'
    + '程式猜一個 `FALSE` 上去就會即刻噴一堆假警報',
    /不會替任何一列填值/.test(src), '');
  check('★★★★★ 補完之後逐行印出現時嘅 `Confirmed` 值',
    /function describeSpecialSundaysConfirmedRows_\(/.test(src), '');
  check('★★★★★ 而且提醒幹事邊幾行要人手填 `FALSE`',
    /要人手填/.test(src), '');
  check('★★★★★ 有寫 `AuditLog`', /writeAuditLog_\(/.test(src), '');
}

// =====================================================================
console.log('\n=== C4【核心】fixture 唔准再手砌 header ===');
{
  // ⚠️ 呢一條就係整組 C 嘅根源：測試造咗一個真實 code path 造唔出嘅狀態，
  // 所以個 bug 由頭到尾冇一條測試捉得到。
  //
  // 判斷準則：`addSheet('SpecialSundays', [ … ])` —— 第二個參數係一個
  // **字面陣列**，即係手砌。合格嘅寫法係傳一個由
  // `getSpecialSundaysHeaderKeys_()` 出嘅值。
  //
  // ⚠️ 唔可以淨係搵 `'Confirmed'` 呢個字串：`annual_combined.test.js`
  // 有兩處 `indexOf('Confirmed')`，嗰兩處係喺斷言提示文字入面提到欄名，
  // 唔係手砌 header。用字串比對會誤報，而誤報一多就冇人再信呢條測試。
  const testFiles = fs.readdirSync(path.join(ROOT, 'tests'))
    .filter(function (fn) { return /\.test\.js$/.test(fn); });
  const handRolled = [];
  testFiles.forEach(function (fn) {
    if (fn === 'special_sundays_schema.test.js') return;
    const body = read('tests/' + fn);
    if (/addSheet\(\s*'SpecialSundays'\s*,\s*\[/.test(body)) {
      handRolled.push(fn);
    }
  });
  check('★★★★★★ 全 `tests/` 冇一個 '
    + '`addSheet(\'SpecialSundays\', [ … ])` 字面陣列'
    + '——手砌就會造出一個真實建表路徑造唔出嘅狀態，'
    + '而個 bug 會由頭到尾綠燈',
    handRolled.length === 0, JSON.stringify(handRolled));

  // 而且真正嗰個 fixture 一定要**確實叫過** `getSpecialSundaysHeaderKeys_()`。
  const fixture = read('tests/unconfirmed_special_reminder.test.js');
  check('★★★★★★ `unconfirmed_special_reminder.test.js` 嘅 header '
    + '真係由 `getSpecialSundaysHeaderKeys_()` 出'
    + '——淨係刪走手砌嗰行、改成另一份寫死清單，等於冇修過',
    /getSpecialSundaysHeaderKeys_\(\)/.test(fixture), '');
}

// =====================================================================
console.log('\n=== C5 schema drift 掃描器 ===');
{
  check('★★★★★ 有 `tools/lint-schema-drift.js`',
    fs.existsSync(path.join(ROOT, 'tools', 'lint-schema-drift.js')), '');
  const lint = read('tools/lint-schema-drift.js');
  check('★★★★★ 佢比對 `COLUMNS.<SHEET>` 同 header 陣列',
    /COLUMNS/.test(lint) && /HEADERS_TC/.test(lint), '');
  check('★★★★★★ **搵到嘅嘢逐個列出，唔會順手全部修**'
    + '——呢一輪只修 `SpecialSundays`，其餘要 Ivan 拍板',
    /只報告，不修改/.test(lint), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
