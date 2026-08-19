#!/usr/bin/env node
// 第三十輪批次階段 B1：未宣告變數掃描（`no-undef` 嘅自己寫版本）。
// 執行方式：node tools/lint-undeclared.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要自己寫
// ─────────────────────────────────────────────────────────────────────
//
// `SeasonRehearsal.gs` 曾經有一個 `written` 用咗但冇宣告——重構嗰陣
// 拆走咗賦值，漏咗清走引用。語法完全合法，`gs_syntax.test.js` 只 parse
// 唔執行，所以捉唔到；要行到嗰一行先爆。
//
// 呢個 repo **冇 package.json、冇 node_modules**，唔想為咗一條 lint
// 規則引入一整套 npm 依賴（而且 Apps Script 唔係一個 eslint 開箱就
// 認得嘅環境）。所以自己寫，重點係做到 eslint 做唔到嗰一半：
//
// ⚠️ **全部 `src/*.gs` 當成同一個全域範圍。** Apps Script 就係噉——
// 跨檔案共用全域。逐個檔案獨立掃嘅話，會滿屏假警報。
//
// ─────────────────────────────────────────────────────────────────────
// 刻意嘅取捨
// ─────────────────────────────────────────────────────────────────────
//
// 函式入面**唔分 block scope**：一個函式嘅全部 `const`／`let`／`var`／
// 參數／內層函式名，一律當成同一個平面範圍。
//
// 後果：捉唔到「喺 block 外面用一個 block 入面宣告嘅 `let`」。
// 換返嚟：**零假警報**。一個會嘈假警報嘅 lint，三日之後就會有人
// 加一堆豁免令佢閉嘴，然後佢就永遠捉唔到嘢——嗰個結果比冇好唔到去邊。
// 呢度揀「少報但準」。

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

/* ============================================================
 * 1　把字串／樣板／正則／註解嘅內容換成同長度嘅空白
 *    （保留長度同換行，令括號配對同行號都仍然啱）
 * ============================================================ */

function blankLiterals(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = function (from, to) {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  // 判斷一個 `/` 係除號定正則開頭：睇前一個非空白字元。
  const regexAllowedBefore = /[(,=:[!&|?{};+\-*%~^<>]/;

  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '/') {
      // 向後搵最近嘅非空白字元，決定係咪正則
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      if (k < 0 || regexAllowedBefore.test(src[k])) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          else if (src[j] === '\n') break;   // 唔應該跨行，當唔係正則
          j++;
        }
        if (j < n && src[j] === '/') {
          blank(i + 1, j);
          // ⚠️ 旗標亦要一齊清走。唔清嘅話 `/x/g` 嗰個 `g` 會變成一個
          // 「未宣告變數」——一堆假警報，而假警報係呢類 lint 嘅死因。
          let f = j + 1;
          while (f < n && /[dgimsuvy]/.test(src[f])) f++;
          blank(j + 1, f);
          i = f; continue;
        }
      }
    }
    i++;
  }
  return out.join('');
}

/* ============================================================
 * 2　可以用嘅全域
 * ============================================================ */

/**
 * Apps Script 內建全域。
 *
 * ⚠️ **唔好為咗令佢過而亂加。** 報咗一個唔認得嘅名，多數係真嘅錯字，
 * 唔係漏咗配置。加之前先 grep 一次個名喺 `src/` 出現過幾多次——
 * 一個真嘅 GAS API 會出現好多次而且有 `.something()` 跟住。
 */
const GAS_GLOBALS = [
  'SpreadsheetApp', 'DriveApp', 'DocumentApp', 'FormApp', 'SlidesApp',
  'GmailApp', 'MailApp', 'CalendarApp', 'ContactsApp', 'GroupsApp',
  'Logger', 'console', 'Utilities', 'HtmlService', 'ScriptApp',
  'PropertiesService', 'LockService', 'CacheService', 'Session',
  'UrlFetchApp', 'Browser', 'Charts', 'XmlService', 'Maps', 'Jdbc',
  'LanguageApp', 'ContentService', 'BigQuery', 'Drive', 'Sheets'
];

/** JS 語言內建（Node 同 GAS 都有）。 */
const JS_GLOBALS = [
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect', 'BigInt',
  'Function', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'NaN', 'Infinity', 'undefined',
  'globalThis', 'arguments', 'this'
];

/** JS 關鍵字／保留字——唔係識別字。 */
const KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete',
  'typeof', 'instanceof', 'in', 'of', 'void', 'throw', 'try', 'catch',
  'finally', 'class', 'extends', 'super', 'this', 'null', 'true', 'false',
  'yield', 'await', 'async', 'static', 'get', 'set', 'with', 'debugger',
  'export', 'import', 'from', 'as'
]);

/* ============================================================
 * 3　抽宣告
 * ============================================================ */

const IDENT = '[A-Za-z_$][\\w$]*';

/** 按**最外層**逗號拆（唔會拆到 `f(a, b)` 或者 `[1, 2]` 入面嗰啲）。 */
function splitTopLevelCommas(text) {
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

/** 由一段程式碼抽出全部「宣告咗嘅名」（平面，唔理 block）。 */
function collectDeclared(code) {
  const names = new Set();
  const add = function (s) { if (s) names.add(s); };

  // const/let/var —— 包括同一句多個（`let a = 1, b = 2;`）同解構
  const declRe = new RegExp('\\b(?:const|let|var)\\s+([^;\\n]+)', 'g');
  let m;
  while ((m = declRe.exec(code)) !== null) {
    // ⚠️ **先按最外層逗號拆，再各自取 `=` 之前嗰段。**
    // 反過嚟做（先取第一個 `=` 之前）就會把
    // `let mustCount = 0, shouldCount = 0;` 嘅第二個名整個丟失，
    // 然後報一個假警報。（第一版就係噉，捉到 `qb`／`shouldCount`／
    // `specialSkip`／`manualPending` 四個假貨。）
    splitTopLevelCommas(m[1]).forEach(function (part) {
      const head = part.split('=')[0];
      const cleaned = head.replace(/[{}[\]]/g, ' ').trim();
      cleaned.split(/\s+/).forEach(function (tok) {
        const id = tok.replace(/:.*$/, '').trim();
        if (new RegExp('^' + IDENT + '$').test(id) && !KEYWORDS.has(id)) add(id);
      });
    });
  }

  // function 名 ＋ 參數（具名同匿名都要）
  const fnRe = new RegExp('\\bfunction\\s*(' + IDENT + ')?\\s*\\(([^)]*)\\)', 'g');
  while ((m = fnRe.exec(code)) !== null) {
    add(m[1]);
    m[2].split(',').forEach(function (p) {
      const id = p.replace(/[{}[\]]/g, ' ').split('=')[0].trim();
      if (new RegExp('^' + IDENT + '$').test(id)) add(id);
    });
  }

  // 箭頭函式參數：`(a, b) =>` 同 `a =>`
  const arrowRe = new RegExp('\\(([^()]*)\\)\\s*=>', 'g');
  while ((m = arrowRe.exec(code)) !== null) {
    m[1].split(',').forEach(function (p) {
      const id = p.split('=')[0].trim();
      if (new RegExp('^' + IDENT + '$').test(id)) add(id);
    });
  }
  const arrow1Re = new RegExp('(?:^|[^\\w$.])(' + IDENT + ')\\s*=>', 'g');
  while ((m = arrow1Re.exec(code)) !== null) add(m[1]);

  // catch (err)
  const catchRe = new RegExp('\\bcatch\\s*\\(\\s*(' + IDENT + ')', 'g');
  while ((m = catchRe.exec(code)) !== null) add(m[1]);

  // class 名（本專案 src/ 冇，但 tools/ 有）
  const classRe = new RegExp('\\bclass\\s+(' + IDENT + ')', 'g');
  while ((m = classRe.exec(code)) !== null) add(m[1]);

  return names;
}

/** 只抽**頂層**（第 0 欄）嘅宣告——即係 Apps Script 嘅跨檔案全域。 */
function collectTopLevel(code) {
  const names = new Set();
  const re = new RegExp('^(?:function|const|let|var)\\s+(' + IDENT + ')', 'gm');
  let m;
  while ((m = re.exec(code)) !== null) names.add(m[1]);
  return names;
}

/* ============================================================
 * 4　抽「有被讀取」嘅識別字
 * ============================================================ */

/**
 * 回 `[{name, line}]`。
 *
 * 特登略過：
 *   - `a.b` 嘅 `b`（屬性）
 *   - `{ b: 1 }` 嘅 `b`（物件 key）——但 `case X:` 唔算
 *   - 關鍵字
 */
function collectUsed(code) {
  const out = [];
  const re = new RegExp('(^|[\\s\\S])(' + IDENT + ')', 'g');
  let m;
  while ((m = re.exec(code)) !== null) {
    const prev = m[1];
    const name = m[2];
    const at = m.index + m[1].length;
    if (KEYWORDS.has(name)) continue;
    // 屬性存取：前面係 `.`（或者 `?.`）
    if (prev === '.') continue;
    // 前面係識別字字元 ⇒ 呢個 match 其實係一個更長識別字嘅一部分
    if (/[\w$]/.test(prev)) continue;

    // 物件 key：後面係 `:`，而且唔係 `case X:` 或者三元 `? a : b`
    const after = code.slice(at + name.length);
    if (/^\s*:/.test(after)) {
      const before = code.slice(0, at);
      const lastWord = (before.match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1];
      const lastSym = (before.match(/([^\s])\s*$/) || [])[1];
      if (lastWord !== 'case' && lastSym !== '?') continue;
    }
    out.push({ name: name, line: code.slice(0, at).split('\n').length });
  }
  return out;
}

/* ============================================================
 * 5　主流程
 * ============================================================ */

/**
 * @returns {{findings: Object[], fileCount: number, globalCount: number}}
 */
function lintUndeclared() {
  const files = fs.readdirSync(SRC_DIR)
    .filter(function (f) { return f.endsWith('.gs'); }).sort();

  const blanked = {};
  files.forEach(function (f) {
    blanked[f] = blankLiterals(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  });

  // ⚠️ 全部檔案合埋做一個全域範圍——Apps Script 就係噉。
  const globals = new Set();
  files.forEach(function (f) {
    collectTopLevel(blanked[f]).forEach(function (n) { globals.add(n); });
  });
  GAS_GLOBALS.concat(JS_GLOBALS).forEach(function (n) { globals.add(n); });

  const findings = [];
  files.forEach(function (f) {
    const code = blanked[f];
    // 逐個頂層函式獨立算「本地宣告」；函式以外（頂層陳述式）就只有全域。
    const bodies = splitTopLevelFunctions(code);
    bodies.forEach(function (b) {
      const local = collectDeclared(b.code);
      collectUsed(b.code).forEach(function (u) {
        if (local.has(u.name) || globals.has(u.name)) return;
        findings.push({
          file: f, line: b.startLine + u.line - 1, name: u.name,
          fn: b.name
        });
      });
    });
  });

  // 同一個名喺同一個函式報一次就夠。
  const seen = {};
  const unique = findings.filter(function (x) {
    const key = x.file + '|' + x.fn + '|' + x.name;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  return { findings: unique, fileCount: files.length, globalCount: globals.size };
}

/** 把一個檔案拆成「逐個頂層函式」＋「函式以外嘅部分」。 */
function splitTopLevelFunctions(code) {
  const out = [];
  const re = new RegExp('^function\\s+(' + IDENT + ')\\s*\\([^)]*\\)\\s*\\{', 'gm');
  let m;
  let lastEnd = 0;
  const outside = [];
  while ((m = re.exec(code)) !== null) {
    const openIdx = code.indexOf('{', m.index);
    let depth = 0;
    let j = openIdx;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    outside.push(code.slice(lastEnd, m.index));
    out.push({
      name: m[1],
      code: code.slice(m.index, j + 1),
      startLine: code.slice(0, m.index).split('\n').length
    });
    lastEnd = j + 1;
    re.lastIndex = j + 1;
  }
  outside.push(code.slice(lastEnd));
  // 函式以外嗰啲（常數定義、IIFE…）合成一段
  out.push({ name: '（檔案頂層）', code: outside.join('\n'), startLine: 1 });
  return out;
}

if (require.main === module) {
  const result = lintUndeclared();
  console.log('未宣告變數掃描：' + result.fileCount + ' 個 .gs 檔案，'
    + '全域名 ' + result.globalCount + ' 個');
  if (result.findings.length === 0) {
    console.log('\n沒有發現任何項目。');
  } else {
    console.log('\n⚠ ' + result.findings.length + ' 項：\n');
    result.findings.forEach(function (x) {
      console.log('  ' + x.file + ':' + x.line + '　' + x.name
        + '　（在 ' + x.fn + '() 裡）');
    });
    console.log('\n⚠️ 不要為了令它靜下來就把名字加進 GAS_GLOBALS。'
      + '報出來的多數是真的錯字。');
  }
  process.exit(result.findings.length === 0 ? 0 : 1);
}

module.exports = { lintUndeclared, blankLiterals, collectDeclared, collectUsed };
