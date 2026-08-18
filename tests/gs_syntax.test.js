// 第二十一輪批次補漏：全部 `.gs` 檔案嘅語法檢查。
// 執行方式：node tests/gs_syntax.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有呢個測試（實測撞到）
// ─────────────────────────────────────────────────────────────────────
//
// 第二十一輪 commit 完、push 完之後，`clasp push` 先報：
//
//     Syntax error: SyntaxError: Invalid or unexpected token
//     line: 326 file: SelfTest.gs
//
// 成因：批次編輯嗰陣一個 `\n` escape 變成咗真嘅換行，把一句字串斷開。
//
// **點解 65 個測試全部 PASS 都捉唔到**：每個測試檔只用
// `loadGasSource([...])` 載入自己需要嗰幾個檔案。`SelfTest.gs` 唔喺
// 任何一個測試嘅載入清單入面，所以佢嘅語法錯誤**冇任何測試碰得到**。
//
// 即係話：測試套件嘅覆蓋範圍係「有邊幾個檔案被載入」，唔係「全部檔案」。
// 呢個測試補返呢個缺口——**唔驗行為，淨係驗每個檔案 parse 得到**。
// 成本極低（一次 parse），但係擋住咗「推上去先發現」呢一類最貴嘅錯。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', 'src');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

console.log('\n=== 全部 src/*.gs 都要 parse 得到 ===');
{
  const files = fs.readdirSync(SRC_DIR).filter(function (f) { return f.endsWith('.gs'); });
  check('★★★ 至少載入到一批 .gs 檔案（防止路徑寫錯令測試變成空跑）',
    files.length > 30, '只搵到 ' + files.length + ' 個檔案');

  const broken = [];
  files.forEach(function (f) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
    try {
      // 只 parse，唔執行——`new vm.Script()` 會做完整語法檢查但唔會跑任何嘢。
      // 所以就算檔案入面有 SpreadsheetApp 呢類 GAS 專有 API 都冇問題。
      new vm.Script(text, { filename: f });
    } catch (e) {
      broken.push(f + '：' + e.message);
    }
  });

  check('★★★★★ 每一個 .gs 都 parse 得到'
    + '——測試套件只載入自己需要嘅檔案，冇被載入嘅檔案有語法錯誤'
    + '係完全捉唔到嘅，要等到 clasp push 先爆',
    broken.length === 0, broken.join('\n      '));
}

console.log('\n=== 正向驗證：真係有語法錯誤嘅話一定要捉到 ===');
{
  // 一條掃出 0 項嘅規則，可以係「真係冇問題」，亦可以係「規則寫壞咗」。
  // 用一個特登整壞嘅樣本證明佢真係 parse 得出錯。
  let threw = null;
  try {
    // 就係實測撞到嗰種：字串被真換行斷開
    new vm.Script("const x = 'abc\ndef';", { filename: '__probe__.gs' });
  } catch (e) {
    threw = e;
  }
  check('★★★★★ 字串被真換行斷開 ⇒ parse 一定失敗'
    + '（實測撞到嘅就係呢種：批次編輯令 \\n escape 變成真換行）',
    threw !== null);

  let ok = true;
  try {
    new vm.Script("const x = 'abc\\ndef';", { filename: '__probe2__.gs' });
  } catch (e) {
    ok = false;
  }
  check('★★★★ 反向：正常嘅 \\n escape 唔會被誤報', ok);
}

console.log('\n=== 順帶：ui/*.html 入面嘅 <script> 唔喺呢個測試範圍 ===');
{
  // 講清楚界線，唔好令人以為呢個測試覆蓋咗 HTML。
  // HTML 樣板要 Google 嘅樣板引擎先跑得到，離線 parse 唔到——
  // 嗰邊靠 tools/scan-static-risks.js 嘅規則 1（樣板逃逸）。
  const uiDir = path.join(SRC_DIR, 'ui');
  check('★★★ ui/ 存在（提醒：HTML 由靜態掃描規則 1 負責，唔喺呢度）',
    fs.existsSync(uiDir));
}

console.log('\n=== 第二十四輪新增紅線：`<?= JSON.stringify(…) ?>` 一定唔可以出現 ===');
{
  // ─────────────────────────────────────────────────────────────
  // 點解呢個要用測試鎖死
  // ─────────────────────────────────────────────────────────────
  //
  // HtmlService 有兩個輸出標籤：
  //   `<?= x ?>`   會做 HTML 轉義
  //   `<?!= x ?>`  原樣輸出
  //
  // `JSON.stringify('2026T4')` 出嚟係 `"2026T4"`（帶雙引號）。
  // 用會轉義嗰個標籤，雙引號會變成 `&quot;`，於是
  //     var QUARTER_ID = &quot;2026T4&quot;;
  // ——**JS 語法錯誤，成個 script 區塊唔會執行，畫面直接死。**
  //
  // 呢個係第十九輪喺 PreacherFillSidebar.html 真實撞到嘅 bug，
  // 而且**離線完全睇唔到**（樣板要 Google 嘅引擎先跑得到），
  // 要喺瀏覽器開一次先知。所以用測試鎖死呢條紅線。
  const uiDir = path.join(SRC_DIR, 'ui');
  const htmlFiles = fs.existsSync(uiDir)
    ? fs.readdirSync(uiDir).filter(function (f) { return f.endsWith('.html'); })
    : [];

  check('★★★ 搵到一批 ui/*.html（防止路徑寫錯令測試變成空跑）',
    htmlFiles.length >= 3, '只搵到 ' + htmlFiles.length + ' 個');

  // ⚠️ 一定要先剝走註解先掃。呢幾個檔案嘅註解**特登**寫住
  // 「唔可以用 `<?= JSON.stringify(x) ?>`」做反面教材——
  // 唔剝註解就會捉住自己嘅警告，而真正嘅修法會變成「刪走個警告」，
  // 恰恰相反。
  const stripComments = function (text) {
    return text
      .replace(/<!--[\s\S]*?-->/g, '')          // HTML 註解
      .replace(/\/\*[\s\S]*?\*\//g, '')         // JS 區塊註解
      .split('\n')
      .map(function (l) { return l.replace(/\/\/.*$/, ''); })   // JS 行註解
      .join('\n');
  };

  const offenders = [];
  htmlFiles.forEach(function (f) {
    const lines = stripComments(fs.readFileSync(path.join(uiDir, f), 'utf8')).split('\n');
    lines.forEach(function (line, i) {
      // 只捉會轉義嗰個標籤（`<?=`），唔捉 `<?!=`。
      // `<?!=` 入面嘅 `!` 喺 `?` 之後，所以 `<\?=` 本身已經分得開。
      if (/<\?=\s*[^?]*JSON\.stringify/.test(line)) {
        offenders.push(f + ':' + (i + 1) + '　' + line.trim().slice(0, 90));
      }
    });
  });

  check('★★★★★ 冇任何一處用會轉義嘅 `<?=` 配 JSON.stringify'
    + '——會令注入嘅字串變成 &quot;…&quot;，成個 script 區塊語法錯誤而唔執行。'
    + '要注入資料一律用 `<?!= ?>`，或者索性改由 google.script.run 攞',
    offenders.length === 0, offenders.join('\n      '));

  // 正向驗證：規則真係捉得到，唔係寫壞咗永遠 0 項。
  const probeBad = 'var X = <?= JSON.stringify(quarterId) ?>;';
  const probeGood = 'var X = <?!= JSON.stringify(quarterId) ?>;';
  check('★★★★★ 正向樣本：壞寫法一定捉得到',
    /<\?=\s*[^?]*JSON\.stringify/.test(probeBad));
  check('★★★★★ 反向樣本：正確嘅 `<?!=` 唔會被誤報',
    !/<\?=\s*[^?]*JSON\.stringify/.test(probeGood));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
