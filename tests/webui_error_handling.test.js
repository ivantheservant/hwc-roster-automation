// 階段 B（收尾輪）／第二十四輪批次改寫：Web UI 前端錯誤處理嘅靜態原始碼稽核。
// 執行方式：node tests/webui_error_handling.test.js
//
// `src/ui/*.html` 係純前端 HTML/JS，冇 DOM／jsdom 可以真正執行渲染，
// 所以跟 tests/webapp_access_guard.test.js 同一套手法——直接讀原始碼文字，
// 用樣式比對驗證「呢一類問題唔會再發生」，唔係真正執行畫面互動。
//
// ─────────────────────────────────────────────────────────────────────
// 第二十四輪點解要改寫呢個檔案
// ─────────────────────────────────────────────────────────────────────
//
// 原本嘅斷言鎖死喺**五步精靈**嘅具體函式名（`closeWizardAndRefresh()`、
// `step4CheckMissingPdf`…）。第二十四輪把 Web UI 由「五個步驟」改成
// 「四粒掣」，嗰啲函式已經唔存在。
//
// ⚠️ **冇刪走呢個檔案，而係逐條保留返原本嘅「意圖」**：
//
// | 原本鎖住嘅意圖 | 而家點驗 |
// |---|---|
// | 每個 async 動作都要包 runAction()，唔可以有裸露嘅 rejected promise | 掃全部 `callServer(` 呼叫點 |
// | 「冇季度」時要顯示說明，唔可以靜靜白畫面 | 查 `loadQuarters()` 嘅 else 分支 |
// | 「上次寄到一半」嘅警告兩處都要有 | 查掣 2／掣 3 都讀 `alreadySentCount` |
// | 側邊欄 save() 要停用掣防連撳 | 原樣保留 |
//
// 刪走測試等於刪走呢啲教訓——重寫先係啱嘅做法。

const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui');
const readUi = (f) => fs.readFileSync(path.join(UI, f), 'utf8');

const common = readUi('Script.html');
const zone1 = readUi('ScriptZone1.html');
const zone2 = readUi('ScriptZone2.html');
const rollback = readUi('ScriptRollback.html');
const boot = readUi('ScriptBoot.html');
const sidebarHtml = readUi('PreacherFillSidebar.html');
const allFrontend = [common, zone1, zone2, rollback, boot].join('\n');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/** 剝走註解——註解入面提到嘅函式名唔算真正呼叫。 */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

console.log('\n=== 核心不變量一：runAction() 係唯一嘅錯誤出口 ===');
{
  check('★★★★★ runAction() 有 try/catch，失敗會叫 showErrorModal（唔會靜靜吞咗）',
    /async function runAction[\s\S]{0,400}?catch \(err\) \{[\s\S]{0,120}?showErrorModal\(/.test(common));
  check('★★★★★ runAction() 有 finally 解除忙碌狀態'
    + '——冇 finally 嘅話，一次失敗就會令全部掣永遠停用',
    // 第二十七輪批次階段 A：`finally` 入面而家仲有「有寫入就刷新狀態快取」
    // 一段，所以由 `finally {` 去到 `setBusy(false)` 之間長咗。
    // 關鍵斷言冇變：**解除忙碌一定要喺 finally 入面**。
    /async function runAction[\s\S]{0,500}?finally \{[\s\S]{0,600}?setBusy\(false\);/.test(common));
  check('★★★★ callServer() 有 withFailureHandler，唔會靜靜 hang 住',
    /withFailureHandler\(/.test(common));
}

console.log('\n=== 核心不變量二：唔可以有裸露嘅 callServer()（會變成冇人處理嘅 rejected promise）===');
{
  // 逐個 callServer( 呼叫點，向上搵最近嘅 `runAction(` 或者 `async function`。
  // 允許嘅形狀：
  //   (a) 喺 runAction(...) 嘅 callback 入面
  //   (b) 喺一個本身淨係俾 runAction 叫嘅 async 函式入面
  //   (c) 有自己 .catch()
  const files = [
    { name: 'Script.html', text: stripComments(common) },
    { name: 'ScriptZone1.html', text: stripComments(zone1) },
    { name: 'ScriptZone2.html', text: stripComments(zone2) },
    { name: 'ScriptRollback.html', text: stripComments(rollback) },
    { name: 'ScriptBoot.html', text: stripComments(boot) }
  ];

  // 呢幾個函式本身淨係由 runAction() 內部呼叫，所以入面嘅 callServer 安全。
  const CALLED_ONLY_INSIDE_RUNACTION = [
    'loadQuarters', 'loadDashboard', 'resendGeneratePdfsThenSend'
  ];

  const naked = [];
  files.forEach((f) => {
    const lines = f.text.split('\n');
    lines.forEach((line, i) => {
      if (line.indexOf('callServer(') === -1) return;
      if (/function callServer\(/.test(line)) return;        // 定義本身，唔係呼叫
      if (/\.catch\(/.test(line)) return;                    // (c)
      if (/try \{.*callServer\(/.test(line)) return;         // (d) 同一行有 try/catch 包住

      // 向上最多 60 行搵 context
      const before = lines.slice(Math.max(0, i - 60), i + 1).join('\n');
      if (/runAction\([^)]*,\s*async/.test(before)) return;   // (a)
      if (CALLED_ONLY_INSIDE_RUNACTION.some((fn) =>
        new RegExp('(async function|function)\\s+' + fn + '\\s*\\(').test(before))) return;   // (b)

      naked.push(f.name + ':' + (i + 1) + '　' + line.trim().slice(0, 80));
    });
  });

  checkEqual('★★★★★ 冇任何裸露嘅 callServer()'
    + '——冇包 runAction() 嘅話，失敗會變成冇人處理嘅 rejected promise：'
    + '畫面毫無反應、亦冇錯誤訊息，幹事只會見到「撳咗冇反應」',
    naked, []);
}

console.log('\n=== 核心不變量三：冇季度時要講嘢，唔可以靜靜白畫面 ===');
{
  const fn = common.slice(common.indexOf('async function loadQuarters'));
  const body = fn.slice(0, fn.indexOf('\n  }\n') + 5);
  check('★★★★★ loadQuarters() 有處理「一個季度都冇」嘅情況',
    /if \(!quarters \|\| quarters\.length === 0\)/.test(body));
  check('★★★★★ 而且會顯示說明文字（唔係靜靜留白，令人以為壞咗）',
    /setStatus\(/.test(body) && /新增季度/.test(body));
}

console.log('\n=== 核心不變量四：「上次寄到一半」嘅警告，掣 2 同掣 3 都要有 ===');
{
  const hits = (zone1.match(/alreadySentCount/g) || []).length;
  check('★★★★★ 兩處都有讀 alreadySentCount（至少出現 2 次）',
    hits >= 2, '只出現 ' + hits + ' 次');
  check('★★★★ 兩處都指去「補寄未收到的人」，唔係淨係報個數',
    (zone1.match(/補寄未收到的人/g) || []).length >= 2);
}

console.log('\n=== 第二十四輪新增：三段式錯誤 ＋ 技術詳情收埋 ===');
{
  check('★★★★★ showErrorModal 拆得出三段（規格 1.5）',
    /發生了什麼/.test(common) && /現在的情況/.test(common) && /你可以怎樣做/.test(common));
  check('★★★★★ 拆唔到三段時**唔會扮到有三段**，而係誠實顯示原文＋仍然俾出路',
    /拆唔到三段：唔好扮到有三段/.test(common) || /if \(parsed\) \{[\s\S]{0,600}?\} else \{/.test(common));
  check('★★★★★ exception 原文收埋喺「複製技術詳情」後面，唔會直接貼上畫面'
    + '——幹事睇到一串英文 stack trace 只會驚，幫唔到佢',
    /複製技術詳情/.test(common) && /pre\.hidden = true/.test(common));
}

console.log('\n=== 第二十四輪新增：確認畫面永遠有「取消」（規格 1.4.5）===');
{
  const fn = common.slice(common.indexOf('function openConfirm'));
  check('★★★★★ openConfirm() 一定會加一粒「取消」',
    /button\('取消'/.test(fn.slice(0, 2000)));
  check('★★★★ 打字確認唔啱時唔會執行，只會提示（前端只係提早回饋，'
    + '後端一樣會再驗一次）',
    /typed !== CONFIRM_PHRASE/.test(fn) && /return;/.test(fn));
}

console.log('\n=== 第二十四輪新增：setBusy 唔可以把本身應該變灰嘅掣着返 ===');
{
  const fn = common.slice(common.indexOf('function setBusy'));
  check('★★★★★ 只解除「因為忙碌而停用」嗰啲（用 dataset 記住）'
    + '——否則跑完一個動作之後，唔夠條件撳嘅掣會突然變成可撳',
    /busyDisabled/.test(fn.slice(0, 600)));
}

console.log('\n=== PreacherFillSidebar.html：save() 必須喺請求進行中停用掣，防手快連撳 ===');
{
  check('★ save() 有喺送出前停用掣', /disabled = true/.test(sidebarHtml));
  check('★ 完成之後有解除', /disabled = false/.test(sidebarHtml));
}

console.log('\n=== 換季度要即刻關掉已開嘅確認畫面（規格 1.1）===');
{
  check('★★★★★ 換季度時會 closeModal()'
    + '——唔關嘅話，彈窗入面嘅數字係上一個季度嘅，'
    + '撳落去就會對錯季度做嘢，而畫面睇落完全正常',
    /'change', \(\) => \{\s*\n\s*closeModal\(\);/.test(stripComments(boot)));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
