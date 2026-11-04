// 第一百零一輪批次 ZF 組：字體（很多長者使用）。
// 執行方式：node tests/round101_zf_fonts.test.js
//
//   ZF1 個人連結頁：頁頂「某某 專屬連結」獨立一行大標題（人名粗體，約 32px）、說明另一行；正文約 20px；日期格、
//       〔全選這個月〕、單選、原因輸入框、〔提交〕放大（按鈕最少 48px 高）；職事表表格至少 16px，表格在自己的框內左右捲動；
//       〔字體：大／特大〕切換（localStorage，讀寫包 try/catch；讀不到 ⇒「大」）；全頁最小字 ≥ 15px
//   ZF2 幹事介面：字體預設「大」，「大」時最小的字不小於 15px；之前選了「標準」的瀏覽器回到「大」
//   ZF3 其他介面：試算表側欄（填寫講員／翻譯／獻花）最小 15px；個人連結錯誤頁 20px

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const page = read('src/ui/PersonalRoster.html');
const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));

console.log('\n=== ZF1：個人連結頁 ===');
{
  check('★★★★★★ 頁頂：「<strong>人名</strong> 專屬連結」獨立一行大標題；季度及說明另一行',
    /<h1 class="person-title"><strong><\?= data\.personName \?><\/strong> 專屬連結<\/h1>\s*<p class="subtitle"><\?= data\.quarterId \?> 職事表——這條連結不會改變/.test(page));
  const base = Number((/:root \{ --fs: (\d+)px; \}/.exec(css) || [])[1]);
  const xl = Number((/:root\[data-font="xl"\] \{ --fs: (\d+)px; \}/.exec(css) || [])[1]);
  check('★★★★★★ 正文預設約 20px（「大」）、「特大」24px', base === 20 && xl === 24 && /body \{[^}]*font-size: var\(--fs\);/.test(css), base + '／' + xl);
  const title = Number((/h1\.person-title \{ font-size: ([\d.]+)em;/.exec(css) || [])[1]);
  check('★★★★★★ 標題約 32px（1.6em × 20px）、人名粗體', Math.round(title * base) === 32 && /h1\.person-title strong \{ font-weight: 800; \}/.test(css), title);
  const tableEm = Number((/\n  table \{ border-collapse: collapse; font-size: ([\d.]+)em; \}/.exec(css) || [])[1]);
  check('★★★★★★ 職事表表格至少 16px', tableEm * base >= 16, tableEm);
  // 全頁最小字號（px 寫死的、em 換算）
  const ems = (css.match(/font-size: ([\d.]+)em/g) || []).map((s) => Number(/([\d.]+)/.exec(s)[1]));
  const pxs = (css.match(/font-size: (\d+)px/g) || []).map((s) => Number(/(\d+)/.exec(s)[1]));
  // 表格內的字以表格為基準（0.8em 再乘）
  const special = Number((/\.special-note \{[^}]*font-size: ([\d.]+)em/.exec(css) || [])[1]);
  const minPx = Math.min.apply(null, ems.map((e) => e * base).concat(pxs).concat([special * tableEm * base]));
  check('★★★★★★ 全頁最小的字 ≥ 15px（「大」）', minPx >= 15, minPx);
  check('★★★★★★ 〔提交〕等按鈕、輸入框最少 48px 高；日期格最少 48px', /\.unav button \{[^}]*min-height: 48px/.test(css) && /\.unav input\[type="text"\] \{[^}]*min-height: 48px/.test(css)
    && /\.unav button\.tile \{[^}]*min-height: (4[89]|5\d)px/.test(css) && /\.unav button\.all-month \{[^}]*min-height: 48px/.test(css));
  check('★★★★★ 單選、勾選放大', /\.unav input\[type="radio"\], \.unav input\[type="checkbox"\] \{ width: 1\.3em; height: 1\.3em;/.test(css));
  check('★★★★★★ 手機：表格在自己的框內左右捲動（.scroll overflow-x: auto）；頁頂可以換行；長字可以斷行（整頁不左右捲動）',
    /\.scroll \{ overflow-x: auto; max-width: 100%;/.test(css) && /\.toolbar \{[^}]*flex-wrap: wrap/.test(css) && /body \{[^}]*overflow-wrap: anywhere/.test(css));
  check('★★★★★ 頁頂〔字體：大／特大〕切換按鈕', /<button class="font-toggle" id="fontToggleBtn" type="button">字體：大<\/button>/.test(page));
  // 行一次字體切換的腳本
  const script = page.slice(page.indexOf('// 第一百零一輪批次 ZF 組：〔字體：大／特大〕切換'), page.indexOf('</script>\n</body>'));
  function runWith(storage) {
    const attrs = {};
    const btn = { textContent: '', listeners: [], addEventListener: function (ev, fn) { this.listeners.push(fn); } };
    const ctx = {
      document: { getElementById: () => btn, documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, getAttribute: (k) => attrs[k] } },
      window: { localStorage: storage }
    };
    vm.runInNewContext(script, ctx);
    return { attrs: attrs, btn: btn };
  }
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const r1 = runWith(throwing);
  check('★★★★★★ localStorage 讀不到 ⇒「大」（不會出錯）', r1.btn.textContent === '字體：大' && !r1.attrs['data-font']);
  r1.btn.listeners[0]();
  check('★★★★★ 按一下 ⇒ 特大（寫不到也不出錯）', r1.btn.textContent === '字體：特大' && r1.attrs['data-font'] === 'xl');
  const store = {};
  const ok = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const r2 = runWith(ok);
  r2.btn.listeners[0]();
  const r3 = runWith(ok);
  check('★★★★★ 記住選擇（下次打開仍是特大）', store.hwcRosterFont === 'xl' && r3.btn.textContent === '字體：特大');
}

console.log('\n=== ZF2：幹事介面 ===');
{
  const style = read('src/ui/Style.html');
  const rootBlock = /\n  :root \{\n    --fs-tiny[\s\S]*?\n  \}/.exec(style)[0];
  const sizes = (rootBlock.match(/--fs-[\w-]+: (\d+)px/g) || []).map((s) => Number(/(\d+)px/.exec(s)[1]));
  check('★★★★★★ 「大」（:root）最小的字 ≥ 15px', sizes.length > 10 && Math.min.apply(null, sizes) >= 15, Math.min.apply(null, sizes));
  const script = read('src/ui/Script.html');
  check('★★★★★★ 預設「大」', /const FONT_SIZE_DEFAULT = 'large';/.test(script) && /<option value="large" selected>大<\/option>/.test(read('src/ui/Index.html')));
  check('★★★★★ 換了記錄鍵：之前選了「標準」的瀏覽器回到「大」', /const FONT_SIZE_STORAGE_KEY = 'hwcRosterFontSize101';/.test(script));
}

console.log('\n=== ZF3：其他介面 ===');
{
  const side = read('src/ui/PreacherFillSidebar.html');
  const px = (side.match(/font-size: (\d+)px/g) || []).map((s) => Number(/(\d+)/.exec(s)[1]));
  check('★★★★★ 試算表側欄（填寫講員／翻譯／獻花）最小 15px', px.length >= 5 && Math.min.apply(null, px) >= 15, JSON.stringify(px));
  check('★★★★ 個人連結錯誤頁 20px', /p\{font-size:20px;/.test(read('src/WebAppPersonalLink.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
