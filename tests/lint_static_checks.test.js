// 第三十輪批次階段 B：兩類新靜態檢查嘅回歸測試。
// 執行方式：node tests/lint_static_checks.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解呢一份係本輪最有價值嗰段
// ─────────────────────────────────────────────────────────────────────
//
// 今次兩個 bug（`written is not defined`、參數次序調轉）
// **語法完全合法**，`gs_syntax.test.js` 只 parse 唔執行，所以一個都捉唔到。
// 116 個測試全綠，真人一撳就爆。
//
// ⚠️ 一份「只檢查現時 0 項」嘅測試係唔夠嘅——佢證明唔到個掃描器
// 真係識捉嘢。所以呢度**每一個掃描器都要餵一段真嘅壞碼落去**，
// 證明佢捉得到；再餵一段容易撞假警報嘅好碼落去，證明佢唔會嘈。

const fs = require('fs');
const path = require('path');
const { lintUndeclared, blankLiterals, collectDeclared, collectUsed }
  = require('../tools/lint-undeclared.js');
const { lintArgOrder } = require('../tools/lint-arg-order.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/* ══════════════════════════════════════════════════════════════
 * B1　未宣告變數
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B1【核心】現時 src/ 一項都冇 ===');
{
  const result = lintUndeclared();
  check('★★★★★ 零項'
    + '——有項目就代表有一個「行到嗰一行先爆」嘅名，'
    + '而測試唔會捉到（實測撞過 `written is not defined`）',
    result.findings.length === 0,
    result.findings.map(function (x) {
      return x.file + ':' + x.line + ' ' + x.name + '（' + x.fn + '）';
    }).join('\n      '));
  check('★★★★ 而且真係掃咗全部檔案（80 個以上）', result.fileCount >= 80,
    String(result.fileCount));
}

console.log('\n=== B1【核心】餵一段真嘅壞碼，證明佢捉得到 ===');
{
  // 實測撞到嗰個形狀：重構拆走咗賦值，漏咗清走引用。
  const bad = 'function demo_() {\n  const rows = [1];\n'
    + '  return rows.length + wroteOk;\n}\n';
  const declared = collectDeclared(bad);
  check('★★★★★ `wroteOk` 唔喺宣告清單入面',
    !declared.has('wroteOk') && declared.has('rows'),
    JSON.stringify(Array.from(declared)));
  check('★★★★★ 而且喺「有被讀取」嘅清單入面',
    collectUsed(bad).some(function (u) { return u.name === 'wroteOk'; }));
}

console.log('\n=== B1【核心】跨檔案全域：Apps Script 就係噉 ===');
{
  // ⚠️ 逐個檔案獨立掃嘅話會滿屏假警報——`Constants.gs` 定義嘅
  // `SHEETS`／`COLUMNS` 喺其餘 80 幾個檔案都用得到。
  const constants = blankLiterals(read('src/Constants.gs'));
  check('★★★★★ `SHEETS` 喺 Constants.gs 頂層宣告',
    /^const SHEETS = /m.test(constants));
  const mailer = blankLiterals(read('src/Mailer.gs'));
  check('★★★★★ 而 Mailer.gs 有用佢（跨檔案）',
    collectUsed(mailer).some(function (u) { return u.name === 'SHEETS'; }));
  check('★★★★★ 掃描結果冇報 `SHEETS`'
    + '——報咗就代表冇做跨檔案全域，而咁樣嘅掃描器一日都用唔到',
    lintUndeclared().findings.every(function (x) { return x.name !== 'SHEETS'; }));
}

console.log('\n=== B1 唔會嘈嘅幾種常見形狀 ===');
{
  const cases = [
    ['正則旗標', 'function d_() { return String(1).replace(/a/g, "b"); }', 'g'],
    ['一句多個宣告', 'function d_() { let a = 0, b = 0; return a + b; }', 'b'],
    ['物件 key', 'function d_() { return { posts: 1, rules: 2 }; }', 'posts'],
    ['catch 參數', 'function d_() { try { return 1; } catch (err) { return err; } }', 'err'],
    ['字串入面嘅字', 'function d_() { return "someUndeclaredName"; }', 'someUndeclaredName'],
    ['註解入面嘅字', 'function d_() {\n  // anotherUndeclaredName\n  return 1;\n}', 'anotherUndeclaredName']
  ];
  cases.forEach(function (c) {
    const code = blankLiterals(c[1]);
    const declared = collectDeclared(code);
    const used = collectUsed(code).map(function (u) { return u.name; });
    const wouldWarn = used.indexOf(c[2]) !== -1 && !declared.has(c[2]);
    check('★★★★★ ' + c[0] + '：唔會報 `' + c[2] + '`'
      + '——假警報係呢類 lint 嘅死因，'
      + '嘈三日之後就會有人加一堆豁免令佢閉嘴',
      !wouldWarn, 'used=' + JSON.stringify(used));
  });
}

console.log('\n=== B1 內建全域清單唔可以亂加 ===');
{
  const src = read('tools/lint-undeclared.js');
  check('★★★★★ 有明文寫住「唔好為咗令佢過而亂加 globals」',
    src.indexOf('唔好為咗令佢過而亂加') !== -1);
  check('★★★★ GAS 內建清單有齊 prompt 點名嗰幾個',
    ['SpreadsheetApp', 'DriveApp', 'Logger', 'Utilities', 'MailApp',
      'HtmlService', 'ScriptApp', 'PropertiesService', 'LockService',
      'CacheService', 'Session', 'UrlFetchApp'].every(function (n) {
      return new RegExp("'" + n + "'").test(src);
    }));
}

/* ══════════════════════════════════════════════════════════════
 * B2　內部呼叫嘅參數次序
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B2【核心】現時 src/ 一項都冇 ===');
{
  const result = lintArgOrder();
  check('★★★★★ 零項', result.findings.length === 0,
    result.findings.map(function (x) {
      return x.file + ':' + x.line + ' ' + x.signature
        + ' 第 ' + x.gotPosition + ' 個傳咗 ' + x.arg;
    }).join('\n      '));
  check('★★★★ 掃到 700 個以上內部函式、1000 個以上呼叫點',
    result.fnCount >= 700 && result.callCount >= 1000,
    result.fnCount + ' / ' + result.callCount);
}

console.log('\n=== B2【核心】把今次嗰行改返轉頭，一定要捉到 ===');
{
  // ⚠️ 呢一段係整個掃描器嘅意義所在。
  // 一個「現時 0 項」嘅掃描器證明唔到佢識捉嘢——要真係餵一次壞碼。
  const target = path.join(__dirname, '..', 'src', 'WebAppSaveConfirm.gs');
  const original = fs.readFileSync(target, 'utf8');
  let found = null;
  try {
    fs.writeFileSync(target,
      original.replace('findStateViolations_(resolved.state, context)',
        'findStateViolations_(context, resolvedState)'), 'utf8');
    found = lintArgOrder().findings;
  } finally {
    fs.writeFileSync(target, original, 'utf8');
  }

  check('★★★★★ 捉到 `findStateViolations_(context, …)`'
    + '——呢個就係令掣 1 一撳即爆嗰一行',
    found && found.length === 1 && found[0].fn === 'findStateViolations_'
    && found[0].arg === 'context' && found[0].gotPosition === 1
    && found[0].expectPosition === 2,
    JSON.stringify(found));
  check('★★★★★ 而且講得出「第 1 個應該係 state」'
    + '——一句「參數次序有問題」唔夠，要講得出正解',
    found && found.length === 1 && found[0].shouldBe === 'state',
    JSON.stringify(found && found[0]));
  check('★★★★★ 檔案已經還原（測試唔可以改壞 repo）',
    fs.readFileSync(target, 'utf8') === original);
}

console.log('\n=== B2 唔會嘈嘅幾種形狀 ===');
{
  const src = read('tools/lint-arg-order.js');
  check('★★★★★ 只比對簡單識別字，`a.b.c` 一律略過'
    + '——分析運算式要一個真 parser，而假警報會多好多',
    /if \(!new RegExp\('\^' \+ IDENT \+ '\$'\)\.test\(id\)\) return;/.test(src));
  check('★★★★★ 傳入名同該位置參數名一樣 ⇒ 唔報',
    /if \(sig\[i\] === id\) return;/.test(src));
  check('★★★★★ 傳入名根本唔喺簽名入面 ⇒ 唔判斷'
    + '（例如 `foo_(quarterId, myLocalThing)`）',
    /if \(elsewhere === -1\) return;/.test(src));
  check('★★★★ 只掃自己定義嘅內部函式（名以 `_` 結尾）'
    + '——Apps Script API 冇參數名可以比對',
    /IDENT \+ '_\\\\s\*\\\\\('/.test(src) || src.indexOf("IDENT + '_)") !== -1);
  check('★★★★ 少過兩個參數嘅函式唔使掃（冇「次序」可言）',
    /if \(!sig \|\| sig\.length < 2\) continue;/.test(src));
}

console.log('\n=== B2 豁免要逐個寫明理由 ===');
{
  const src = read('tools/lint-arg-order.js');
  check('★★★★★ 同一行有 `arg-order-ok` 就豁免',
    /if \(lineText\.indexOf\(EXEMPT_MARK\) !== -1\) continue;/.test(src));
  check('★★★★★ 而且輸出明講豁免要寫理由',
    /逐個寫明理由/.test(src));

  // 現時應該一個豁免都冇——有嘅話要喺稽核文件寫低。
  const srcFiles = fs.readdirSync(path.join(__dirname, '..', 'src'))
    .filter(function (f) { return f.endsWith('.gs'); });
  const exemptions = [];
  srcFiles.forEach(function (f) {
    read('src/' + f).split('\n').forEach(function (line, i) {
      if (line.indexOf('arg-order-ok') !== -1) exemptions.push(f + ':' + (i + 1));
    });
  });
  check('★★★★★ 現時 src/ 一個豁免都冇'
    + '——每加一個都要喺 docs/系統範圍稽核.md 寫低理由',
    exemptions.length === 0, exemptions.join('、'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
