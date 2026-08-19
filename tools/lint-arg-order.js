#!/usr/bin/env node
// 第三十輪批次階段 B2：內部呼叫嘅參數次序掃描。
// 執行方式：node tools/lint-arg-order.js
//
// ─────────────────────────────────────────────────────────────────────
// 規則（一句）
// ─────────────────────────────────────────────────────────────────────
//
//   呼叫一個內部函式（名以 `_` 結尾）時，如果傳入嘅**變數名**
//   同該函式**另一個位置**嘅參數名相同，就報警。
//
// 例：`findStateViolations_(context, resolved.state)`
//   第 1 個位傳咗一個叫 `context` 嘅變數，
//   但第 1 個參數叫 `state`、第 2 個先叫 `context` → 報警。
//
// ⚠️ 呢個 bug 語法完全合法：兩個參數都係「一個物件」，JS 唔會投訴，
// 要行到深處讀 `context.posts.forEach` 先爆一個
// `Cannot read properties of undefined (reading 'forEach')`。
// 116 個測試全綠，真人一撳就爆。
//
// ─────────────────────────────────────────────────────────────────────
// 刻意嘅收窄
// ─────────────────────────────────────────────────────────────────────
//
// 1. 只掃 `src/*.gs` 入面**自己定義**嘅函式（名以 `_` 結尾）。
//    Apps Script API 冇參數名可以比對。
// 2. 只比對**簡單識別字**（`context`、`state`、`quarterId`…）。
//    `a.b.c` 呢類運算式一律略過——分析佢哋要一個真 parser，
//    而且假警報會多好多。
// 3. 同一行有 `// arg-order-ok` 就豁免，**而且豁免要逐個寫明理由**
//    （理由寫喺同一行嘅註解入面）。

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const IDENT = '[A-Za-z_$][\\w$]*';
const EXEMPT_MARK = 'arg-order-ok';

const { blankLiterals } = require('./lint-undeclared.js');

/** 按最外層逗號拆。 */
function splitArgs(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** 由 `(` 開始搵配對嘅 `)`。 */
function matchParen(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * @returns {{findings: Object[], fnCount: number, callCount: number}}
 */
function lintArgOrder() {
  const files = fs.readdirSync(SRC_DIR)
    .filter(function (f) { return f.endsWith('.gs'); }).sort();

  const raw = {};
  const blanked = {};
  files.forEach(function (f) {
    raw[f] = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    blanked[f] = blankLiterals(raw[f]);
  });

  // ── 1　收集全部內部函式嘅參數名 ────────────────────────────
  const params = {};
  const defRe = new RegExp('^function\\s+(' + IDENT + '_)\\s*\\(([^)]*)\\)', 'gm');
  files.forEach(function (f) {
    let m;
    while ((m = defRe.exec(blanked[f])) !== null) {
      params[m[1]] = m[2].split(',').map(function (p) {
        return p.split('=')[0].trim();
      }).filter(function (p) { return new RegExp('^' + IDENT + '$').test(p); });
    }
  });

  // ── 2　逐個呼叫點比對 ──────────────────────────────────────
  const findings = [];
  let callCount = 0;
  files.forEach(function (f) {
    const code = blanked[f];
    const rawLines = raw[f].split('\n');
    const callRe = new RegExp('(^|[^\\w$.])(' + IDENT + '_)\\s*\\(', 'g');
    let m;
    while ((m = callRe.exec(code)) !== null) {
      const name = m[2];
      const sig = params[name];
      if (!sig || sig.length < 2) continue;
      // 定義本身唔算呼叫
      const before = code.slice(Math.max(0, m.index - 20), m.index + m[1].length);
      if (/function\s*$/.test(before)) continue;

      const openIdx = code.indexOf('(', m.index + m[1].length + name.length - 1);
      const closeIdx = matchParen(code, openIdx);
      if (closeIdx === -1) continue;
      callCount++;

      const line = code.slice(0, m.index).split('\n').length;
      const lineText = rawLines[line - 1] || '';
      if (lineText.indexOf(EXEMPT_MARK) !== -1) continue;

      splitArgs(code.slice(openIdx + 1, closeIdx)).forEach(function (arg, i) {
        const id = arg.trim();
        // 只睇簡單識別字
        if (!new RegExp('^' + IDENT + '$').test(id)) return;
        if (i >= sig.length) return;
        if (sig[i] === id) return;                 // 名一樣 ⇒ 冇問題
        const elsewhere = sig.indexOf(id);
        if (elsewhere === -1) return;              // 唔喺簽名入面 ⇒ 唔判斷
        findings.push({
          file: f, line: line, fn: name,
          arg: id, gotPosition: i + 1, expectPosition: elsewhere + 1,
          shouldBe: sig[i], signature: name + '(' + sig.join(', ') + ')'
        });
      });
    }
  });

  return { findings: findings, fnCount: Object.keys(params).length, callCount: callCount };
}

if (require.main === module) {
  const result = lintArgOrder();
  console.log('參數次序掃描：內部函式 ' + result.fnCount + ' 個，'
    + '呼叫點 ' + result.callCount + ' 處');
  if (result.findings.length === 0) {
    console.log('\n沒有發現任何項目。');
  } else {
    console.log('\n⚠ ' + result.findings.length + ' 項：\n');
    result.findings.forEach(function (x) {
      console.log('  ' + x.file + ':' + x.line);
      console.log('    ' + x.signature);
      console.log('    第 ' + x.gotPosition + ' 個位傳咗 `' + x.arg + '`，'
        + '但 `' + x.arg + '` 係第 ' + x.expectPosition + ' 個參數嘅名；'
        + '第 ' + x.gotPosition + ' 個應該係 `' + x.shouldBe + '`');
    });
    console.log('\n如果確定係假警報，喺同一行加 `// ' + EXEMPT_MARK
      + '：<逐個寫明理由>`。');
  }
  process.exit(result.findings.length === 0 ? 0 : 1);
}

module.exports = { lintArgOrder };
