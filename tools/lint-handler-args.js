#!/usr/bin/env node
// 第四十五輪批次：**一個「會收參數」嘅函式，唔可以直接做點擊處理。**
// 執行方式：node tools/lint-handler-args.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢個閘
// ═════════════════════════════════════════════════════════════════════
//
// 現場錯誤：`Failed due to illegal value in property: 1`
//
// 成因：
//
//     stepButton('請系統幫我調整', openBuildSuggestion, {…})
//     function openBuildSuggestion(startFrom) { … callServerMutating(…, startFrom || '') }
//
// `button()` 做嘅係 `addEventListener('click', onClick)`，所以直接綁嘅話，
// `startFrom` 收到嘅係一個 **MouseEvent**——一個 truthy 嘅物件，
// 所以 `startFrom || ''` 攔唔住佢，佢原封不動變成第 1 個參數送去
// `google.script.run`，而嗰度序列化唔到。
//
// ⚠️ 呢個 bug 最惡嘅地方係**後端一次都冇被叫到**：
// Apps Script 執行紀錄完全冇呢一次，所以查後端查極都查唔到。
// 第四十四輪就係噉樣判錯咗成因，改咗一堆冇問題嘅地方。
//
// ─────────────────────────────────────────────────────────────────────
// 呢個閘擋咩
// ─────────────────────────────────────────────────────────────────────
//
// 任何一處把**一個有宣告參數嘅具名函式**直接交做事件處理：
//
//     button('X', doThing, …)          ✗   doThing(arg)
//     stepButton('X', doThing, …)      ✗
//     onClick: doThing                 ✗
//     addEventListener('click', doThing)  ✗
//
//     button('X', () => doThing(), …)  ✓   包一層，事件被丟走
//     button('X', doThing, …)          ✓   doThing() 冇宣告參數
//
// ⚠️ 呢個閘**唔係**用嚟代替 `sanitizeServerArgs_()`（送出前清一次）。
// 兩層都要有：lint 喺 commit 之前擋，sanitize 喺執行時擋，
// 而 sanitize 嗰句錯誤講得出邊個 API、第幾個參數、係乜嘢型別。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI_DIR = path.join(ROOT, 'src', 'ui');

/** 剝走註解——註解入面嘅例子（好似上面嗰幾行）唔算違規。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
}

const files = fs.readdirSync(UI_DIR)
  .filter(function (item) { return /\.html$/.test(item); })
  .map(function (item) { return path.join(UI_DIR, item); });

// ── 一、砌一份「函式名 → 宣告咗幾多個參數」 ────────────────────
const arity = {};
files.forEach(function (full) {
  const bare = stripComments(fs.readFileSync(full, 'utf8'));
  const re = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    const params = m[2].trim();
    arity[m[1]] = params === '' ? 0 : params.split(',').length;
  }
});

// ── 二、逐個「直接綁」嘅位置檢查 ──────────────────────────────
//
// ⚠️ 只捉**裸識別字**。`() => f()`／`function () { … }`／`f.bind(…)`
// 全部唔會 match，因為佢哋本來就把事件丟走咗。
const PATTERNS = [
  { what: 'button()／stepButton() 第 2 個參數',
    re: /\b(?:step)?[Bb]utton\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g },
  { what: 'onClick: 屬性',
    re: /\bonClick:\s*([A-Za-z_$][\w$]*)\s*(?:[,}\n])/g },
  { what: 'addEventListener()',
    re: /addEventListener\(\s*(?:'[^']*'|"[^"]*")\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g },
  // ⚠️ 第四十五輪批次：**處理器地圖**也要捉。
  //
  //     const handlers = { save: openSaveAndConfirm, review: openReview, … };
  //     … onClick: handlers[b.key]
  //
  // 第一版嘅 lint 只捉裸識別字，所以完全睇唔到呢一種——而區一四粒大掣
  // 正正就係噉寫，`openReview`／`openOfficial`／`openResend` 三個都收參數。
  // 三粒掣撳落去送出去嘅第 1 個參數都係一個 MouseEvent。
  //
  // 一個「本地具名函式 ＋ 有宣告參數」出現喺物件字面量做值，
  // 幾乎一定係一個處理器。真係要噉寫嘅話，包一層 `() => f()` 就過得到。
  { what: '物件字面量入面嘅處理器（例如 `const handlers = { … }`）',
    re: /^\s*[A-Za-z_$][\w$]*:\s*([A-Za-z_$][\w$]*)\s*,?\s*$/gm }
];

const problems = [];
files.forEach(function (full) {
  const raw = fs.readFileSync(full, 'utf8');
  const bare = stripComments(raw);
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  PATTERNS.forEach(function (p) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(bare)) !== null) {
      const name = m[1];
      const n = arity[name];
      if (n === undefined) continue;   // 唔係本地具名函式（例如參數轉發）
      if (n === 0) continue;           // 冇宣告參數 ⇒ 收到事件都冇影響
      const line = bare.slice(0, m.index).split('\n').length;
      problems.push({
        file: rel, line: line, fn: name, arity: n, what: p.what
      });
    }
  });
});

// ── 三、`callServerRaw_()` 一定要行過 `sanitizeServerArgs_()` ──────
const script = fs.readFileSync(path.join(UI_DIR, 'Script.html'), 'utf8');
const rawFn = script.slice(script.indexOf('function callServerRaw_('),
  script.indexOf('\n  }\n', script.indexOf('function callServerRaw_(')));
const sanitized = /sanitizeServerArgs_\(fnName, args\)/.test(rawFn)
  && /\[fnName\]\(\.\.\.safeArgs\)/.test(rawFn);

// ── 報告 ────────────────────────────────────────────────────────
console.log('點擊處理參數掃描：' + files.length + ' 個 UI 檔案、'
  + Object.keys(arity).length + ' 個具名函式');

let fail = 0;

if (!sanitized) {
  fail++;
  console.log('\n✗ `callServerRaw_()` 冇經 `sanitizeServerArgs_()` 清參數，'
    + '或者送出嗰行唔係用清完嗰份。');
  console.log('  冇咗呢一層，送一個事件物件上去就會由 sandbox 拋一句');
  console.log('  `Failed due to illegal value in property: N`——冇講邊個 API、冇講嗰個值係乜。');
}

if (problems.length > 0) {
  fail++;
  console.log('\n✗ 呢 ' + problems.length + ' 處直接把一個「會收參數」嘅函式交做事件處理：\n');
  problems.forEach(function (p) {
    console.log('  ' + p.file + ':' + p.line);
    console.log('      ' + p.what + ' 傳咗 `' + p.fn + '`，而 `' + p.fn
      + '()` 宣告咗 ' + p.arity + ' 個參數。');
    console.log('      事件物件會變成佢第 1 個參數，跟住好可能被原封不動送去伺服器。');
    console.log('      改成：`() => ' + p.fn + '()`');
  });
}

if (fail === 0) {
  console.log('\n沒有發現任何項目。');
}
process.exit(fail === 0 ? 0 : 1);
