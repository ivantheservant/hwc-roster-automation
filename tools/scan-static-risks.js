#!/usr/bin/env node
/**
 * 靜態風險掃描——補離線測試捉唔到嘅東西。
 *
 * 執行：node tools/scan-static-risks.js [--json] [--out <路徑>]
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個 script
 * ─────────────────────────────────────────────────────────────────────
 *
 * 離線測試套件 60 個檔案全部 PASS，但真實環境一撳就爆，已經發生過至少
 * 五次（第十九輪批次一次就撞到五個）。原因唔係測試寫得差，係**有成類
 * 問題離線根本測唔到**：
 *
 *   • HtmlService 樣板要 Google 嘅樣板引擎先跑得到，Node 冇
 *   • 「工作表已經存在」呢條路要有一個真試算表先行得到
 *   • 「兩份資料唔一致」要有真人喺 grid 度改過先出現
 *
 * 測試補唔到嘅部分，用靜態掃描補。掃描一定有 false positive，
 * 所以**呢個 script 只警告、唔擋 commit**——敏感資料嗰個
 * （`tools/scan-staged-secrets.js`）先擋。理由同嗰邊嘅中文姓名一樣：
 * 關卡越容易誤判，被人養成無視習慣嘅機會越大，而敏感資料嗰道閘
 * 係唔可以被無視嘅，唔應該同一堆靜態分析噪音擺埋一齊。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 掃五類（每一類都對應一個真實撞過嘅 bug）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. HtmlService 樣板逃逸 —— 第十九輪喺 `PreacherFillSidebar.html` 撳到
 * 2. 建表／改結構冇處理「已存在」 —— 第十四輪合併凍結衝突
 * 3. 讀工作表欄位冇處理「欄唔存在」 —— 第十三輪 first-run 缺欄
 * 4. 手砌 context 傳入規則函式 —— 第十八輪嗰個 bug class 嘅殘餘
 * 5. 同時攞到兩個真相來源但只用其中一個 —— 第十九輪階段 B
 * 6. 由渲染輸出反推資料 —— 第二十輪階段 A（合堂令新功能完全用唔到）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const UI_DIR = path.join(SRC_DIR, 'ui');

// =====================================================================
// 工具
// =====================================================================

/** 讀一個資料夾入面指定副檔名嘅檔案。 */
function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith(ext); })
    .map(function (f) { return { name: f, full: path.join(dir, f) }; });
}

/** 逐行掃，回傳 {file, line, text} 陣列。 */
function eachLine(file, fn) {
  const text = fs.readFileSync(file.full, 'utf8');
  text.split('\n').forEach(function (line, i) { fn(line, i + 1, text); });
}

/**
 * 判斷某一行係咪處於註釋入面（粗略）。
 * 唔追求完美——目的只係唔好因為註釋度寫住個樣式就報一次。
 */
function looksLikeComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

/** 由某一行向上搵最近嘅頂層 `function` 宣告。 */
function findEnclosingFunctionStart(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    if (/^function\s+[A-Za-z_$][\w$]*/.test(lines[i])) return i;
  }
  return 0;
}

/** 由某一行向下搵下一個頂層 `function` 宣告。 */
function findNextFunctionStart(lines, idx) {
  for (let i = idx; i < lines.length; i++) {
    if (/^function\s+[A-Za-z_$][\w$]*/.test(lines[i])) return i;
  }
  return lines.length;
}

const findings = [];
function report(kind, file, line, text, note) {
  findings.push({
    kind: kind, file: file, line: line,
    text: String(text).trim().slice(0, 160), note: note
  });
}

// =====================================================================
// 1. HtmlService 樣板逃逸
// =====================================================================

/**
 * `<?= ?>` 會做 HTML 轉義，`<?!= ?>` 唔會。
 *
 * 喺 `<script>` 區塊入面注入 JSON 一定要用 `<?!= ?>`——用 `<?= ?>` 嘅話
 * `"2026T4"` 會變成 `&quot;2026T4&quot;`，成個 script 區塊 JS 語法錯誤、
 * 完全唔會執行。
 *
 * 第十九輪批次實測撳到：`ui/PreacherFillSidebar.html` 就係噉，
 * 而呢個選單項一路喺「未實測」名單入面，所以一直冇人發現。
 *
 * 反方向亦要留意：喺 HTML 內文（唔係 script）用 `<?!= ?>` 注入使用者
 * 資料 = XSS 風險。呢度一併報出嚟畀人肉眼判斷。
 */
function scanTemplateEscaping() {
  listFiles(UI_DIR, '.html').forEach(function (file) {
    let inScript = false;
    eachLine(file, function (line, no) {
      const lower = line.toLowerCase();
      if (lower.indexOf('<script') !== -1) inScript = true;
      if (lower.indexOf('</script') !== -1) {
        // 同一行開又關嘅情況照計入 script
        checkTemplateLine(file, line, no, true);
        inScript = false;
        return;
      }
      checkTemplateLine(file, line, no, inScript);
    });
  });
}

function checkTemplateLine(file, line, no, inScript) {
  if (looksLikeComment(line)) return;

  // `<?= ... ?>`（會轉義）
  const escaped = /<\?=\s*([^?]*)\?>/g;
  let m;
  while ((m = escaped.exec(line)) !== null) {
    const expr = m[1].trim();
    if (!inScript) continue;
    report('樣板逃逸', 'src/ui/' + file.name, no, line,
      '在 <script> 區塊裡用 `<?= ?>`（會 HTML 轉義）注入 `' + expr + '`。\n'
      + '      如果這個值是 JSON／字串，轉義之後引號會變成 &quot;，'
      + '整個 script 區塊會 JS 語法錯誤、完全不執行。\n'
      + '      在 script 裡注入資料應該用 `<?!= ?>`（不轉義）。');
  }

  // `<?!= ... ?>`（唔轉義）出現喺 HTML 內文 = 可能 XSS
  const raw = /<\?!=\s*([^?]*)\?>/g;
  while ((m = raw.exec(line)) !== null) {
    if (inScript) continue;
    const expr = m[1].trim();
    // 純粹拼 class／style 屬性嘅慣用寫法唔報（PersonalRoster.html 有幾處）
    if (/class=|style=/.test(expr)) continue;
    // `includeHtml('ui/Style')` 係 GAS 內嵌子樣板嘅標準寫法——內容係
    // 我哋自己嘅 HTML 檔案，本來就係要原樣插入，唔轉義先係啱。
    // 唔喺呢度豁免嘅話，每個 Web UI 頁面都會報一次，噪音蓋過真問題。
    if (/^includeHtml\(/.test(expr)) continue;
    report('樣板逃逸', 'src/ui/' + file.name, no, line,
      '在 HTML 內文（不是 <script>）用 `<?!= ?>`（不轉義）注入 `' + expr + '`。\n'
      + '      如果這個值來自使用者輸入或試算表內容，就是 XSS 風險。\n'
      + '      內文注入應該用 `<?= ?>`（會轉義）。');
  }
}

// =====================================================================
// 2. 建表／改結構冇處理「已存在」
// =====================================================================

/**
 * `insertSheet()` 撞到同名工作表會拋錯；`setFrozenColumns()` 撞到
 * 跨越凍結界線嘅合併格會拋錯（第十四輪實測）。
 *
 * 呢度嘅判斷好簡單：同一個函式入面有 `insertSheet(` 但冇任何
 * `getSheetByName(`／`deleteSheet(`／`existsSheet` 之類嘅前置判斷。
 */
const STRUCTURE_CALLS = ['insertSheet(', 'setFrozenColumns(', 'setFrozenRows(', 'merge('];
const EXISTENCE_HINTS = ['getSheetByName(', 'deleteSheet(', 'breakApart(', 'clearContents(', 'clear('];

function scanFirstRunAsymmetry() {
  listFiles(SRC_DIR, '.gs').forEach(function (file) {
    const text = fs.readFileSync(file.full, 'utf8');
    const lines = text.split('\n');

    // 用「function 到下一個 function」做粗略切分——GAS 專案慣例係全部
    // 頂層宣告都唔縮排，所以呢個切法夠準。
    let start = -1;
    let fnName = '';
    for (let i = 0; i < lines.length; i++) {
      if (/^function\s+([A-Za-z_$][\w$]*)/.test(lines[i])) {
        if (start >= 0) checkFunctionBlock(file, fnName, lines.slice(start, i), start, text);
        start = i;
        fnName = /^function\s+([A-Za-z_$][\w$]*)/.exec(lines[i])[1];
      }
    }
    if (start >= 0) checkFunctionBlock(file, fnName, lines.slice(start), start, text);
  });
}

function checkFunctionBlock(file, fnName, blockLines, offset, fileBody) {
  const body = blockLines.filter(function (l) { return !looksLikeComment(l); }).join('\n');
  const hasStructureCall = STRUCTURE_CALLS.some(function (c) { return body.indexOf(c) !== -1; });
  if (!hasStructureCall) return;

  // ⚠️ 存在性判斷要睇**成個檔案**，唔可以淨係睇呢個函式。
  //
  // 專案慣例係把「檢查」同「建立」分開兩個函式：
  //   createOrRefreshRequestsSheet_()  ← 呢度 getSheetByName() 判斷
  //   buildRequestsSheetStructure_()   ← 呢度先 insertSheet()
  // 只睇函式範圍嘅話，第二個函式一定會被誤報。實測第一版就係噉，
  // 兩項「first-run 不對稱」全部係呢種正常分工。
  //
  // 代價：如果一個檔案入面有一處啱、另一處漏咗，會漏報。
  // 接受——呢個掃描本來就係「縮窄人手檢查範圍」，唔係保證。
  const scope = fileBody || body;
  const hasExistenceHint = EXISTENCE_HINTS.some(function (c) { return scope.indexOf(c) !== -1; });
  if (hasExistenceHint) return;

  const idx = blockLines.findIndex(function (l) {
    return !looksLikeComment(l) && STRUCTURE_CALLS.some(function (c) { return l.indexOf(c) !== -1; });
  });
  report('first-run 不對稱', 'src/' + file.name, offset + idx + 1, blockLines[idx],
    '`' + fnName + '()` 會建立／改動工作表結構，但整個函式裡看不到任何'
    + '「已經存在的話怎麼辦」的判斷。\n'
    + '      第一次跑（工作表不存在）與第二次跑（已經存在）是兩條不同的路，'
    + '兩條都要處理。\n'
    + '      實測撞過：重複發佈公開職事表時，`insertSheet()` 撞同名而拋錯；'
    + '合併格跨越凍結欄界線令 `setFrozenColumns()` 拋錯。');
}

// =====================================================================
// 3. 讀工作表欄位冇處理「欄唔存在」
// =====================================================================

/**
 * `row[COLUMNS.X.Y]` 喺欄唔存在嗰陣會攞到 `undefined`，跟住靜靜咁
 * 當成空值用落去——第十三輪 first-run 撞過（NameMapping 缺欄）。
 *
 * 呢一項噪音特別大（正常讀欄都係噉寫），所以只報**明顯高風險**嘅樣式：
 * 直接把 `row[COLUMNS...]` 攞去做算術或者 `.` 存取。
 */
function scanUncheckedColumnAccess() {
  listFiles(SRC_DIR, '.gs').forEach(function (file) {
    eachLine(file, function (line, no) {
      if (looksLikeComment(line)) return;
      // row[COLUMNS.A.B].something  或  row[COLUMNS.A.B] +
      if (/\[COLUMNS\.[A-Z_]+\.[A-Z_]+\]\s*\./.test(line)) {
        report('欄位假設', 'src/' + file.name, no, line,
          '直接對 `row[COLUMNS...]` 做屬性存取。欄位不存在時這裡會是 '
          + '`undefined`，屬性存取會拋 TypeError。\n'
          + '      第一次使用的環境（工作表還沒補欄）就會踩到。'
          + '建議先取值、判斷過再用。');
      }
    });
  });
}

// =====================================================================
// 4. 手砌 context 傳入規則函式（第十八輪 bug class 嘅殘餘）
// =====================================================================

const RULE_FUNCTIONS = [
  'checkHardRuleViolations_(', 'findStateViolations_(', 'evaluateViolations_('
];

function scanHandBuiltContext() {
  listFiles(SRC_DIR, '.gs').forEach(function (file) {
    const text = fs.readFileSync(file.full, 'utf8');
    const lines = text.split('\n');
    lines.forEach(function (line, i) {
      if (looksLikeComment(line)) return;
      const hit = RULE_FUNCTIONS.filter(function (f) { return line.indexOf(f) !== -1; })[0];
      if (!hit) return;
      // 睇前 25 行有冇一個 `{` 開頭嘅物件字面量同時提到 assignments／posts
      const before = lines.slice(Math.max(0, i - 25), i).join('\n');
      if (!/\bposts\s*:/.test(before) || !/\bserviceDates\s*:/.test(before)) return;
      if (/roles\s*:/.test(before) && /personPostExclusions\s*:/.test(before)) return;
      report('手砌 context', 'src/' + file.name, i + 1, line,
        '呼叫 `' + hit + '...)` 之前像是自己組了一個 context 物件，'
        + '但看不到 `roles` 與 `personPostExclusions` 兩個欄位。\n'
        + '      第十八輪批次的 bug 就是這樣：漏傳被當成「沒有人有任何身分」，'
        + '參數掃描 12 組全部誤報 26 項違反。\n'
        + '      應該從 `buildRoleContext_()` 取，不要另外讀一次工作表。');
    });
  });
}

// =====================================================================
// 5. 同時攞到兩個真相來源但只用其中一個（第十九輪階段 B）
// =====================================================================

/**
 * `buildFineTuneContext_()` 出嚟嘅 context 同時有 `original`
 * （RosterAssignments 長表）同 `gridValues`（grid 工作表）。
 * 直接 `context.original.map(...)` 就係靜靜咁揀咗其中一份——
 * 呢個就係第十九輪嗰個 bug：幹事改 grid 改極都冇用，硬規則閘形同虛設。
 *
 * 正確做法：`resolveAuthoritativeState_(context, mode)`，mode 要明確傳。
 */
function scanDualSourceAmbiguity() {
  const ALLOWED = ['StateSource.gs', 'FineTune.gs'];  // resolver 同疊加實作本身
  listFiles(SRC_DIR, '.gs').forEach(function (file) {
    if (ALLOWED.indexOf(file.name) !== -1) return;
    const fileText = fs.readFileSync(file.full, 'utf8');
    const fileLines = fileText.split('\n');

    eachLine(file, function (line, no) {
      if (looksLikeComment(line)) return;
      if (!/(?:context|plan\.context)\.original\s*\./.test(line)) return;

      // ⚠️ 唔報「已經明確表過態」嘅函式。
      //
      // 已經呼叫過 `resolveAuthoritativeState_()` 之後，再讀一次
      // `context.original` 攞補充資料（例如某格原本嘅 `assignSource`）
      // 係合法嘅——呢個時候 `original` 唔係「兩份真相入面求其揀一份」，
      // 而係「明確咁攞舊值嚟對比」。
      //
      // 實測：`planApplyRequests_()` 就係噉——先 resolve 攞疊加後嘅狀態，
      // 再讀 original 攞返每格原本嘅 assignSource。呢個係啱嘅。
      const fnStart = findEnclosingFunctionStart(fileLines, no - 1);
      const fnEnd = findNextFunctionStart(fileLines, no);
      const fnBody = fileLines.slice(fnStart, fnEnd).join('\n');
      if (fnBody.indexOf('resolveAuthoritativeState_(') !== -1) return;

      report('雙來源歧義', 'src/' + file.name, no, line,
        '直接讀 `context.original`。這個 context 同時有 `original`'
        + '（RosterAssignments 長表）與 `gridValues`（grid 工作表），\n'
        + '      兩者在「幹事剛改過 grid」的時候並不相同。\n'
        + '      請改用 `resolveAuthoritativeState_(context, mode)` 並明確傳 mode——'
        + '見 src/StateSource.gs。');
    });
  });
}

// =====================================================================
// 6. 由「渲染輸出」反推資料（第二十輪批次階段 B）
// =====================================================================

/**
 * 系統自己寫出嚟畀人睇嘅嘢（grid 格文字），如果又要反推返做資料，
 * **一定要行渲染器**——唔可以直接攞文字去查表。
 *
 * 第二十輪撞到嘅 bug：`buildGridOverlayState_()` 由 grid 文字反推
 * PersonID，於是「特殊主日」「英語堂」呢類**顯示用**文字全部被當成
 * 「認唔出嘅人手改動」。後果：只要季度入面有合堂，
 * 「把人手改動寫成新版本」就完全用唔到。
 *
 * ⚠️ 要分清楚兩種情況：
 *
 * | 情況 | 反推合唔合法 |
 * |---|---|
 * | **表單輸入**（`Requests` 姓名欄、側邊欄輸入框）——人手打入去嘅 | ✅ 合法。反推本來就係佢嘅工作，認唔出就報錯 |
 * | **渲染輸出**（grid 格文字）——系統寫出嚟畀人睇嘅 | ❌ 一定要經 `renderExpectedGridText_()` 比對，唔可以直接查表 |
 *
 * 所以呢條規則只掃「讀 grid 之後攞去 `resolvePersonId()`」，
 * 唔會掃表單輸入嗰啲。
 */
/**
 * 判斷一句 `resolvePersonId(...)` 算唔算「由渲染輸出反推資料」。
 * 抽做純函式係為咗**測得到**——一條掃全專案掃出 0 項嘅規則，
 * 可以係「真係冇問題」，亦可以係「寫壞咗乜都捉唔到」，淨係睇個 0 分唔出。
 *
 * @param {string} line 該行原始碼
 * @param {string} fnBody 所屬函式嘅完整內容
 * @returns {boolean} true = 要報
 */
function shouldFlagReversal(line, fnBody) {
  const argMatch = /resolvePersonId\(\s*([A-Za-z_$][\w$.]*)/.exec(line);
  const argName = argMatch ? argMatch[1] : '';
  const fromGrid = fnBody.indexOf('gridValues') !== -1
    || /grid|cell|display|rendered/i.test(argName);
  if (!fromGrid) return false;
  // 已經行渲染器比對 ⇒ 唔係「直接反推」
  return fnBody.indexOf('renderExpectedGridText_(') === -1;
}

function scanDisplayToDataReversal() {
  const ALLOWED = ['FineTune.gs'];   // 疊加實作本身（已經行渲染器比對）
  listFiles(SRC_DIR, '.gs').forEach(function (file) {
    if (ALLOWED.indexOf(file.name) !== -1) return;
    const text = fs.readFileSync(file.full, 'utf8');
    const lines = text.split('\n');

    lines.forEach(function (line, i) {
      if (looksLikeComment(line)) return;
      if (line.indexOf('resolvePersonId(') === -1) return;

      // ⚠️ 判斷要睇「反推嘅輸入係咪由 grid **讀返嚟**」，
      // 唔可以睇「呢個函式有冇掂過 grid」。
      //
      // 實測：第一版用 `buildRosterSheetName_(` 做訊號，結果報咗
      // `PreacherTranslationFill.gs`——嗰度 `resolvePersonId(trimmedName)`
      // 嘅 `trimmedName` 係側邊欄**表單輸入**，個函式只係之後會**寫入**
      // grid。寫入唔係反推，係誤報。
      //
      // 兩個訊號（符合任何一個）：
      //   1. 函式入面有 `gridValues`——專案入面唯一「grid 格文字讀返嚟」
      //      嘅表示法
      //   2. 傳畀 resolvePersonId 嘅變數名本身就講明係 grid／格內容
      const fnStart = findEnclosingFunctionStart(lines, i);
      const fnEnd = findNextFunctionStart(lines, i + 1);
      const fnBody = lines.slice(fnStart, fnEnd).join('\n');
      if (!shouldFlagReversal(line, fnBody)) return;

      report('顯示層反推', 'src/' + file.name, i + 1, line,
        '在讀 grid 工作表的函式裡直接用 `resolvePersonId()` 反推人名。\n'
        + '      grid 上面不是只有人名——還有「特殊主日」、外部負責單位'
        + '（`ExternalOwner`）、\n'
        + '      「待確認」、「⚠ 未能安排」這些**顯示用**文字，'
        + '會全部被當成認不出的人手改動。\n'
        + '      要比對的話請用 `renderExpectedGridText_()`'
        + '（RosterWriter.gs）算出「本來應該渲染成什麼」再比，\n'
        + '      不要加白名單——顯示文字列不完（`ExternalOwner` 是幹事自由輸入的）。');
    });
  });
}

// =====================================================================
// 輸出
// =====================================================================

function buildReportMarkdown(byKind, total) {
  const lines = [
    '# 靜態風險掃描結果',
    '',
    '由 `tools/scan-static-risks.js` 自動產生——**不要手改這個檔案**，',
    '改了下次執行就會被覆寫。要調整判斷準則請改那個 script。',
    '',
    '這一份補的是**離線測試捉不到的那一類問題**：HtmlService 樣板要 Google 的',
    '樣板引擎才跑得到、「工作表已經存在」要有真試算表才走得到、「兩份資料不一致」',
    '要有真人在 grid 改過才出現。60 個測試檔全部 PASS 但真實環境一按就爆，',
    '已經發生過至少五次。',
    '',
    '⚠️ 靜態分析一定有 false positive，所以這個掃描**只警告、不擋 commit**',
    '（擋 commit 的是敏感資料掃描 `tools/scan-staged-secrets.js`）。',
    '每一項都要人親眼判斷是不是真問題。',
    '',
    '目前合計 **' + total + '** 項。',
    ''
  ];

  Object.keys(byKind).sort().forEach(function (kind) {
    const items = byKind[kind];
    lines.push('## ' + kind + '（' + items.length + ' 項）');
    lines.push('');
    items.forEach(function (f) {
      lines.push('- **`' + f.file + ':' + f.line + '`**');
      lines.push('  ```');
      lines.push('  ' + f.text);
      lines.push('  ```');
      f.note.split('\n').forEach(function (l) { lines.push('  ' + l.trim()); });
      lines.push('');
    });
  });

  if (total === 0) {
    lines.push('目前沒有任何項目。');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  scanTemplateEscaping();
  scanFirstRunAsymmetry();
  scanUncheckedColumnAccess();
  scanHandBuiltContext();
  scanDualSourceAmbiguity();
  scanDisplayToDataReversal();

  const byKind = {};
  findings.forEach(function (f) {
    if (!byKind[f.kind]) byKind[f.kind] = [];
    byKind[f.kind].push(f);
  });

  const args = process.argv.slice(2);
  if (args.indexOf('--json') !== -1) {
    console.log(JSON.stringify({ total: findings.length, findings: findings }, null, 2));
    return;
  }

  const outIdx = args.indexOf('--out');
  if (outIdx !== -1 && args[outIdx + 1]) {
    fs.writeFileSync(args[outIdx + 1], buildReportMarkdown(byKind, findings.length), 'utf8');
    console.log('已寫入 ' + args[outIdx + 1] + '（' + findings.length + ' 項）');
    return;
  }

  console.log('靜態風險掃描：' + findings.length + ' 項（只警告，不擋 commit）\n');
  Object.keys(byKind).sort().forEach(function (kind) {
    console.log('【' + kind + '】' + byKind[kind].length + ' 項');
    byKind[kind].forEach(function (f) {
      console.log('  ' + f.file + ':' + f.line);
      console.log('      ' + f.text);
    });
    console.log('');
  });
  if (findings.length === 0) console.log('沒有發現任何項目。');
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    scanTemplateEscaping, scanFirstRunAsymmetry, scanUncheckedColumnAccess,
    scanHandBuiltContext, scanDualSourceAmbiguity, scanDisplayToDataReversal, shouldFlagReversal,
    checkTemplateLine, buildReportMarkdown,
    _findings: findings, _report: report
  };
}
