// 第四十一輪批次 I 組：幹事見到嘅字要一致、要書面語。
// 執行方式：node tests/operator_wording.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 實測之後兩件事：
//
//   一、「發生了什麼」呢個標籤**讀起嚟好似報告一件已經發生咗嘅事**。
//       而好多時嗰一段講嘅係「呢一季仲未有公開連結」呢種
//       前置條件未夠，根本冇嘢發生過——佢見到嗰四個字會以為系統壞咗。
//
//   二、全介面「揀」要改成「選擇」／「選」；順便check埋口語詞。
//
// ⚠️ 一件要講清楚嘅事：**註解仍然係粵語，呢個係刻意嘅。**
// 呢一份只掃**字串文字**（即係幹事真係會見到嗰啲），
// 唔會掃註解。連註解一齊掃嘅話，呢個專案成套解釋為什麼咁做嘅語氣
// 就會被慢慢磨走，而嗰啲解釋先係最難重寫嘅嘢。
//
// ⚠️ log_() 訊息**唔算**幹事見到嘅字——嗰啲入 Apps Script 執行紀錄，
// 只有開發嗰陣先會睇。所以呢一份特登唔掃 log_()。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── 收集全部字串文字（剝走註解同 log_() 嗰行）──────────────────
const files = [];
[SRC, path.join(SRC, 'ui')].forEach(function (d) {
  fs.readdirSync(d).forEach(function (f) {
    const p = path.join(d, f);
    if (fs.statSync(p).isFile() && /\.(gs|html)$/.test(f)) files.push(p);
  });
});

const STR_RE = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;

/**
 * 逐行掃：跳過整段註解、單行註解、同埋 `log_(` 嗰一行。
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function collectUserStrings() {
  const out = [];
  files.forEach(function (p) {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    let inBlock = false;
    fs.readFileSync(p, 'utf8').split('\n').forEach(function (line, i) {
      const t = line.trim();
      if (inBlock) { if (t.indexOf('*/') !== -1) inBlock = false; return; }
      if (t.indexOf('/*') === 0) { if (t.indexOf('*/') === -1) inBlock = true; return; }
      if (t.indexOf('//') === 0) return;
      if (t.indexOf('log_(') !== -1) return;
      let m; STR_RE.lastIndex = 0;
      while ((m = STR_RE.exec(line))) {
        const s = m[1] !== undefined ? m[1] : m[2];
        if (s) out.push({ file: rel, line: i + 1, text: s });
      }
    });
  });
  return out;
}

const strings = collectUserStrings();

function hits(needle) {
  return strings.filter(function (s) { return s.text.indexOf(needle) !== -1; })
    .map(function (s) { return s.file + ':' + s.line + '  ' + s.text.slice(0, 80); });
}

// =====================================================================
console.log('\n=== I【核心】「揀」全部改晒 ===');
{
  const found = hits('揀');
  check('★★★★★ 幹事見到嘅字入面一個「揀」都冇（' + strings.length + ' 段字串掃過）'
    + '——「揀」係口語，而畫面上一半寫「揀」一半寫「選擇」，'
    + '幹事會以為係兩件唔同嘅事',
    found.length === 0, found.join('\n'));
}

console.log('\n=== I：而且真係用返「選擇」／「選」 ===');
{
  // 反證：唔可以係「全部刪走咗」。呢幾句係實際存在嘅畫面文字。
  check('★★★★★ 「自己選擇」呢個收件範圍選項仲喺度',
    hits('自己選擇').length >= 2, '');
  check('★★★★ 共用名單元件仲有「搜尋姓名」',
    hits('搜尋姓名').length >= 1, '');
}

console.log('\n=== I【核心】三段式訊息第一段嘅標籤 ===');
{
  const script = fs.readFileSync(path.join(SRC, 'ui', 'Script.html'), 'utf8');
  const zone1 = fs.readFileSync(path.join(SRC, 'ui', 'ScriptZone1.html'), 'utf8');
  const guards = fs.readFileSync(path.join(SRC, 'WebAppGuards.gs'), 'utf8');

  check('★★★★★ 顯示標籤唔再係「發生了什麼」'
    + '——好多時嗰一段講嘅係「前置條件未夠」，根本冇嘢發生過',
    !/errorPart\('發生了什麼'/.test(script) && !/errorPart\('發生了什麼'/.test(zone1), '');
  check('★★★★★ 而且只有一個地方定義（五個呼叫點各自寫一次嘅話，'
    + '改一次字就一定會漏一兩個）',
    /const ERR_LABEL_WHAT = '要留意';/.test(script), '');
  // ⚠️ 第四十二輪批次 E 組加咗 `threePartNodes()`（確認畫面用），
  // 所以呼叫點由五個變六個。呢度斷言嘅係「**冇一個**寫死嗰四個字」，
  // 唔係一個會隨住加功能而過時嘅數字。
  const useInScript = (script.match(/errorPart\(ERR_LABEL_WHAT/g) || []).length;
  const useInZone1 = (zone1.match(/errorPart\(ERR_LABEL_WHAT/g) || []).length;
  const useCount = useInScript + useInZone1;
  check('★★★★★ 全部呼叫點都用返嗰個常數（而家有 ' + useCount + ' 個）',
    useCount >= 5, String(useCount));
  check('★★★★★ 而且冇一個 `errorPart()` 寫死咗第一段嘅標籤',
    !/errorPart\('(發生了什麼|要留意)'/.test(script)
      && !/errorPart\('(發生了什麼|要留意)'/.test(zone1), '');

  // ⚠️ 呢一條係整份最重要嘅。後端傳過嚟嗰個分隔標記係**機器格式**，
  // 唔係俾人睇嘅字。改咗佢就要同時改晒所有拋緊三段式訊息嘅地方，
  // 而漏一個就會變成「拆唔到三段」，畫面會退返去顯示原文。
  check('★★★★★ 後端嘅機器標記**冇改**（顯示標籤同機器標記係兩回事）',
    /return '發生了什麼：' \+ whatHappened/.test(guards), '');
  check('★★★★★ 而前端仍然照住嗰個機器標記拆',
    /raw\.indexOf\('發生了什麼：'\)/.test(script), '');
}

console.log('\n=== I：口語詞（幹事見到嘅字入面）===');
{
  // ⚠️ 呢個清單刻意唔包「係」「同」——嗰兩隻字喺書面中文一樣通用
  //（「係」出現喺「關係」「聯係」，「同」出現喺「同時」「相同」），
  // 掃佢哋只會製造一堆要逐個排除嘅假警報，而假警報多過真嘅時候，
  // 一條防線就冇人再理。
  const WORDS = ['嘅', '咗', '啲', '唔', '佢哋', '咁樣', '嗰個', '嗰啲', '邊個', '乜嘢', '睇落', '攞返'];
  const found = [];
  WORDS.forEach(function (w) {
    hits(w).forEach(function (h) { found.push(w + '　' + h); });
  });
  check('★★★★★ 幹事見到嘅字入面一個口語詞都冇'
    + '——佢係一個唔熟電腦嘅使用者，畫面上一句口語會令佢覺得'
    + '「呢個系統唔係做俾我用嘅」',
    found.length === 0, found.join('\n'));
}

console.log('\n=== I：反證——註解嗰邊嘅粵語冇被掃走 ===');
{
  // ⚠️ 呢一條係防住「下一個人索性把成個 repo 嘅粵語一鍵改晒」。
  // 註解用粵語係刻意嘅：嗰啲係寫俾接手嘅人睇嘅推理過程，
  // 而呢個專案成套「點解咁做」嘅解釋先係最難重寫嘅嘢。
  const writer = fs.readFileSync(path.join(SRC, 'RosterWriter.gs'), 'utf8');
  const paper = fs.readFileSync(path.join(SRC, 'ui', 'ScriptSendPaper.html'), 'utf8');
  check('★★★★★ `.gs` 註解仲有粵語',
    /\/\/[^\n]*(嘅|咗|唔|嗰)/.test(writer), '');
  check('★★★★★ `.html` 註解仲有粵語',
    /\/\/[^\n]*(嘅|咗|唔|嗰)/.test(paper), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
