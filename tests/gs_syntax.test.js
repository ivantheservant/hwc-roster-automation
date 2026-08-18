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

console.log('\n=== 第二十七輪批次階段 H4：ui/*.html 嘅 <script> 要 parse 得到 ===');
{
  /*
   * 呢一段本來寫住「HTML 唔喺呢個測試範圍」。第二十七輪批次改咗。
   *
   * 點解改：第二十五輪有一次 `Index.html` 出問題，令**整個幹事介面
   * 完全開唔到**（SyntaxError，一片白）。而本輪一次過改咗六個
   * `src/ui/*.html`、新增咗兩個，同類問題只會更難定位。
   *
   * 可以離線 parse 嘅前提：`<script>` 入面係純 JavaScript，
   * 樣板標籤（`<? … ?>`）只出現喺 `<script>` 之外——嗰一點由下面
   * 「非法 scriptlet」嗰節守住。所以抽出 `<script>` 內容之後
   * 直接 `new vm.Script()` 就試得到。
   */
  const uiDir = path.join(SRC_DIR, 'ui');
  check('★★★ ui/ 存在', fs.existsSync(uiDir));

  fs.readdirSync(uiDir).filter((f) => f.endsWith('.html')).forEach((name) => {
    const text = fs.readFileSync(path.join(uiDir, name), 'utf8');
    const opens = (text.match(/<script>/g) || []).length;
    const closes = (text.match(/<\/script>/g) || []).length;
    check('★★★★★ ' + name + ' 嘅 <script> 開合對稱（' + opens + ' 開 / ' + closes + ' 閉）',
      opens === closes);
    if (opens === 0) return;

    const m = text.match(/<script>([\s\S]*)<\/script>/);
    // ⚠️ 有樣板標籤嘅 HTML（例如個人專屬連結頁）唔試 parse——
    // 嗰啲要 Google 嘅樣板引擎行完先係合法 JS。
    if (!m || /<\?/.test(m[1])) return;
    let ok = true;
    let err = '';
    try { new vm.Script(m[1], { filename: name }); }
    catch (e) { ok = false; err = e.message; }
    check('★★★★★ ' + name + ' 嘅 <script> 內容 parse 得到'
      + '——上一次一個檔案出問題，令整個幹事介面一片白',
      ok, err);
  });
}

console.log('\n=== 階段 H4：Index.html 每個 includeHtml 引用嘅檔案都要存在 ===');
{
  // 引用一個唔存在嘅檔案，HtmlService 會喺**執行時**先至爆，
  // 而爆嘅時候係整頁開唔到——同上面嗰種失敗一模一樣咁難查。
  const uiDir = path.join(SRC_DIR, 'ui');
  const index = fs.readFileSync(path.join(uiDir, 'Index.html'), 'utf8');
  const refs = (index.match(/includeHtml\('ui\/([A-Za-z0-9]+)'\)/g) || [])
    .map((s) => s.replace(/.*'ui\//, '').replace(/'\)/, ''));
  check('★★★★ Index.html 真係有 includeHtml 引用', refs.length >= 6, refs.join('、'));
  refs.forEach((name) => {
    check('★★★★★ ui/' + name + '.html 存在',
      fs.existsSync(path.join(uiDir, name + '.html')));
  });
}

console.log('\n=== 第二十四輪紅線（第二十五輪改寫）：ui/*.html 唔可以有非法嘅 <? …scriptlet ===');
{
  // ─────────────────────────────────────────────────────────────
  // 點解由「剝註解再掃 JSON.stringify」改成「白名單制」
  // ─────────────────────────────────────────────────────────────
  //
  // 第二十四輪嘅版本用「剝走 HTML/JS 註解，先喺剩低嘅文字度搵
  // `<?= …JSON.stringify` 」嚟捉。前提係「註解入面嘅嘢係死嘅」。
  //
  // 呢個前提喺 HtmlService **唔成立**：樣板引擎編譯成個檔案
  // 嗰陣，完全唔知道、亦唔理會咩係 HTML 註解——`<!-- <?= x ?> -->`
  // 一樣會編譯，`<?= ?>` 呢種空運算式一樣會變成語法錯誤。
  //
  // 第二十五輪實測撞到：Index.html 第 12 行嘅 HTML 註解入面寫住
  // 字面上嘅 `<?= ?>` 同 `<?= JSON.stringify(x) ?>` 做警告文字，
  // 令成個樣板編譯失敗——`WebApp.gs` 嘅 `.evaluate()` 拋
  // `SyntaxError: Unexpected token ';'`，幹事介面完全開唔到。
  //
  // 所以呢度改成**白名單制**：唔理係咪註解，掃全個檔案入面
  // **任何**一個 `<?` scriptlet，逐個同「已知安全嘅形狀」比對，
  // 唔喺白名單入面就算違反。呢個做法唔會有「前提喺呢個環境唔成立」
  // 嘅問題——因為佢冇假設邊度嘅文字係死嘅。
  const uiDir = path.join(SRC_DIR, 'ui');
  const htmlFiles = fs.existsSync(uiDir)
    ? fs.readdirSync(uiDir).filter(function (f) { return f.endsWith('.html'); })
    : [];

  check('★★★ 搵到一批 ui/*.html（防止路徑寫錯令測試變成空跑）',
    htmlFiles.length >= 3, '只搵到 ' + htmlFiles.length + ' 個');

  // PersonalRoster.html 係真正嘅資料樣板（義工個人專屬連結頁面），
  // 大量合法 scriptlet（迴圈、if、輸出欄位），唔喺呢條紅線範圍內。
  const REAL_TEMPLATE_FILES = ['PersonalRoster.html'];

  // 幹事介面呢批檔案（Index/Script/ScriptZone1/ScriptZone2/
  // ScriptRollback/ScriptBoot）淨係容許用嚟拆檔嘅 includeHtml()，
  // 同 PreacherFillSidebar.html 淨係容許一個固定嘅 quarterId 注入。
  // 呢兩種以外嘅任何 `<?` 都算違反——包括出現喺 HTML/JS 註解入面。
  const isAllowed = function (snippet) {
    if (/^<\?!=\s*includeHtml\('ui\/[A-Za-z0-9]+'\)\s*\?>$/.test(snippet)) return true;
    if (/^<\?!=\s*JSON\.stringify\(quarterId\)\s*\?>$/.test(snippet)) return true;
    return false;
  };

  const offenders = [];
  htmlFiles.forEach(function (f) {
    if (REAL_TEMPLATE_FILES.indexOf(f) !== -1) return;
    const text = fs.readFileSync(path.join(uiDir, f), 'utf8');
    const scriptlets = text.match(/<\?[\s\S]*?\?>/g) || [];
    scriptlets.forEach(function (snippet) {
      if (!isAllowed(snippet)) {
        const lineNo = text.slice(0, text.indexOf(snippet)).split('\n').length;
        offenders.push(f + ':' + lineNo + '　' + snippet.replace(/\s+/g, ' ').slice(0, 90));
      }
    });
  });

  check('★★★★★ 冇任何一個 <? scriptlet 唔喺白名單入面'
    + '——**唔理係咪出現喺 HTML／JS 註解入面**，HtmlService 一律照樣編譯。'
    + '要注入資料一律用 google.script.run，唔可以喺呢批檔案寫任何字面上嘅 <? ?>'
    + '（包括喺註解入面解釋呢條規則），連空運算式 <?= ?> 都會令成個樣板編譯失敗',
    offenders.length === 0, offenders.join('\n      '));

  // 正向驗證：規則真係捉得到，唔係寫壞咗永遠 0 項。三個必中樣本：
  //   1. 會轉義嗰個標籤配 JSON.stringify（第十九輪撞過）
  //   2. 空運算式（第二十五輪撞過，會令整個樣板 SyntaxError）
  //   3. 藏喺 HTML 註解入面（第二十五輪撞過嘅正正係呢種）
  check('★★★★★ 正向樣本一：`<?= JSON.stringify(x) ?>` 一定捉得到',
    !isAllowed('<?= JSON.stringify(x) ?>'));
  check('★★★★★ 正向樣本二：空運算式 `<?= ?>` 一定捉得到',
    !isAllowed('<?= ?>'));
  {
    const probeCommented = '<!-- 唔好用 <?= ?> -->';
    const found = (probeCommented.match(/<\?[\s\S]*?\?>/g) || []);
    check('★★★★★ 正向樣本三：藏喺 HTML 註解入面一樣捉得到'
      + '（呢個測試本身唔剝註解，所以正則直接喺原文掃到）',
      found.length === 1 && !isAllowed(found[0]));
  }
  check('★★★★ 反向樣本：白名單入面嘅 includeHtml() 唔會被誤報',
    isAllowed("<?!= includeHtml('ui/Style') ?>"));
  check('★★★★ 反向樣本：白名單入面嘅 quarterId 注入唔會被誤報',
    isAllowed('<?!= JSON.stringify(quarterId) ?>'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
