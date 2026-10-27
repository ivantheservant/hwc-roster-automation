// 第八十二輪批次 IE 組：介面字體分三級（標準／大／特大，預設＝大）。
//
// Ivan：重要的提示文字（例如常用設定按鈕下面那句灰色細字）要大至少一倍。
// 守住四件事：
//   1. Style.html 不准再寫死 px 字號——一律用 CSS 變數，三級在同一處定義；
//   2. 「大」「特大」兩級，提示、說明、附註的變數不可以小於內文；
//   3. 字大之後版面撐得住：按鈕可以換行、卡片／標題列／頁頂可以換行，不會撐出橫向捲動；
//   4. 頁頂〔字體〕選單：預設＝大；記在 localStorage，讀寫失敗都不出錯。
//
// 跑法：node tests/round82_ie_font_size.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadUiScripts } = require('./helpers/ui_loader');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures++; console.log('  ✗ ' + name + '\n      ' + err.message); }
}

const style = read('src/ui/Style.html').replace(/\/\*[\s\S]*?\*\//g, '');
const index = read('src/ui/Index.html');

/** 取出一個選擇器第一個區塊裏的 --fs-* 變數。 */
function fontVars(selector) {
  const at = selector === ':root' ? style.search(/:root\s*\{\s*--fs-tiny/) : style.indexOf(selector + ' {');
  assert.ok(at >= 0, '找不到 ' + selector);
  const body = style.slice(at, style.indexOf('}', at));
  const out = {};
  body.replace(/--(fs-[a-z0-9]+):\s*(\d+)px/g, (_m, k, v) => { out[k] = Number(v); return ''; });
  return out;
}

const HINT_VARS = ['fs-tiny', 'fs-note', 'fs-hint', 'fs-body2', 'fs-xs', 'fs-sm', 'fs-md'];
const ALL_VARS = HINT_VARS.concat(['fs-name', 'fs-body', 'fs-title', 'fs-h1', 'fs-lg', 'fs-xl', 'fs-2xl']);

console.log('第八十二輪 IE 組：字體三級');

test('IE1 Style.html 沒有寫死的 px／em 字號（全部用 var(--fs-*)）', () => {
  const bad = [];
  style.replace(/font-size:\s*([^;}\n]+)/g, (_m, v) => {
    if (!/^var\(--fs-[a-z0-9]+\)\s*$/.test(v.trim())) bad.push(v.trim());
    return '';
  });
  assert.deepStrictEqual(bad, [], '寫死的字號：' + bad.join('、'));
});

test('IE2 三級都定義齊全部變數；:root 本身＝大（預設）', () => {
  const large = fontVars(':root');
  const std = fontVars(':root[data-font="standard"]');
  const xl = fontVars(':root[data-font="xlarge"]');
  ALL_VARS.forEach((k) => {
    assert.ok(large[k] > 0, '大級缺 --' + k);
    assert.ok(std[k] > 0, '標準級缺 --' + k);
    assert.ok(xl[k] > 0, '特大級缺 --' + k);
  });
  assert.strictEqual(std['fs-body'], 16, '標準＝現時內文 16px');
  assert.strictEqual(large['fs-body'], 18, '大＝內文 18px');
  assert.strictEqual(xl['fs-body'], 22, '特大＝內文 22px');
});

test('IE3 「大」「特大」：提示、說明、附註都不小於內文；而且一級比一級大', () => {
  const large = fontVars(':root');
  const std = fontVars(':root[data-font="standard"]');
  const xl = fontVars(':root[data-font="xlarge"]');
  HINT_VARS.forEach((k) => {
    assert.ok(large[k] >= large['fs-body'], '大級 --' + k + '=' + large[k] + ' 小於內文 ' + large['fs-body']);
    assert.ok(xl[k] >= xl['fs-body'], '特大級 --' + k + '=' + xl[k] + ' 小於內文 ' + xl['fs-body']);
  });
  ALL_VARS.forEach((k) => {
    assert.ok(large[k] >= std[k], '大級 --' + k + ' 比標準級小');
    assert.ok(xl[k] > large[k], '特大級 --' + k + ' 沒有比大級大');
  });
  // 原本 12–13px 的提示，特大級放大到大約 1.7 倍
  assert.ok(xl['fs-hint'] / std['fs-hint'] >= 1.6, '特大級提示不夠大');
});

test('IE4 版面撐得住：按鈕可以換行；按鈕卡／標題列／頁頂可以換行；輸入框不超出', () => {
  assert.ok(/\bbutton\s*\{[^}]*white-space:\s*normal/.test(style), 'button 要 white-space: normal');
  assert.ok(/\bbutton\s*\{[^}]*overflow-wrap:\s*anywhere/.test(style), 'button 要 overflow-wrap: anywhere');
  assert.ok(/\.act\s*\{[^}]*flex-wrap:\s*wrap/.test(style), '.act 要 flex-wrap: wrap');
  assert.ok(/\.zone-head\s*\{[^}]*flex-wrap:\s*wrap/.test(style), '.zone-head 要 flex-wrap: wrap');
  assert.ok(/\.topbar-actions\s*\{[^}]*flex-wrap:\s*wrap/.test(style), '.topbar-actions 要 flex-wrap: wrap');
  assert.ok(/\.flow-head\s*\{[^}]*flex-wrap:\s*wrap/.test(style), '.flow-head 要 flex-wrap: wrap');
  assert.ok(/select, input\[type=text\], textarea\s*\{\s*max-width:\s*100%/.test(style), '輸入框要 max-width: 100%');
  assert.ok(/body\s*\{[^}]*overflow-wrap:\s*anywhere/.test(style), 'body 要 overflow-wrap: anywhere');
  assert.ok(!/white-space:\s*nowrap/.test(style), '不可以有 nowrap');
  // 跟字號走的尺寸不可以寫死 px
  assert.ok(/\.step-num\s*\{[^}]*width:\s*1\.9em/.test(style), '.step-num 闊度要跟字號');
  assert.ok(/\.inp-date\s*\{\s*max-width:\s*10em/.test(style), '.inp-date 闊度要跟字號');
});

test('IE5 頁頂〔字體〕選單在〔深色模式〕旁邊，三個選項，預設＝大', () => {
  const at = index.indexOf('id="themeToggleBtn"');
  const sel = index.indexOf('id="fontSizeSelect"');
  assert.ok(at > 0 && sel > at, '選單要在深色模式掣之後');
  const actionsEnd = index.indexOf('</div>', index.indexOf('class="topbar-actions"'));
  assert.ok(sel < actionsEnd, '選單要在 topbar-actions 裏');
  const block = index.slice(sel, index.indexOf('</select>', sel));
  assert.ok(/value="standard">標準</.test(block));
  assert.ok(/value="large" selected>大</.test(block));
  assert.ok(/value="xlarge">特大</.test(block));
  assert.ok(/字體/.test(index.slice(index.lastIndexOf('<label', sel), sel)), '要寫明「字體」');
});

function loadWithStorage(storage) {
  const sb = loadUiScripts(['Script.html']);
  const attrs = {};
  sb.document.documentElement = {
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; }
  };
  sb.localStorage = storage;
  return { sb, attrs };
}

test('IE6 沒有記錄 ⇒ 預設「大」；記錄了「特大」⇒ 用特大；亂寫的值 ⇒ 大', () => {
  const store = {};
  const mem = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  let r = loadWithStorage(mem);
  r.sb.initFontSizePicker();
  assert.strictEqual(r.attrs['data-font'], 'large');
  assert.strictEqual(r.sb.document.getElementById('fontSizeSelect').value, 'large');

  store.hwcRosterFontSize = 'xlarge';
  r = loadWithStorage(mem);
  r.sb.initFontSizePicker();
  assert.strictEqual(r.attrs['data-font'], 'xlarge');

  store.hwcRosterFontSize = 'huge';
  r = loadWithStorage(mem);
  r.sb.initFontSizePicker();
  assert.strictEqual(r.attrs['data-font'], 'large');
});

test('IE7 轉級即時生效並記住；localStorage 讀寫都出錯也不爆', () => {
  const store = {};
  const mem = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  let r = loadWithStorage(mem);
  r.sb.initFontSizePicker();
  const sel = r.sb.document.getElementById('fontSizeSelect');
  sel.value = 'xlarge';
  sel.fire('change');
  assert.strictEqual(r.attrs['data-font'], 'xlarge');
  assert.strictEqual(store.hwcRosterFontSize, 'xlarge');
  sel.value = 'standard';
  sel.fire('change');
  assert.strictEqual(r.attrs['data-font'], 'standard');
  assert.strictEqual(store.hwcRosterFontSize, 'standard');

  const broken = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceeded'); }
  };
  r = loadWithStorage(broken);
  assert.doesNotThrow(() => r.sb.initFontSizePicker());
  assert.strictEqual(r.attrs['data-font'], 'large');
  const sel2 = r.sb.document.getElementById('fontSizeSelect');
  sel2.value = 'xlarge';
  assert.doesNotThrow(() => sel2.fire('change'));
  assert.strictEqual(r.attrs['data-font'], 'xlarge', '記不住也要即時生效');
});

test('IE8 開介面時先套用字體（ScriptBoot 叫 initFontSizePicker）', () => {
  const boot = read('src/ui/ScriptBoot.html');
  assert.ok(/initFontSizePicker\(\);\s*\n\s*initThemeToggle\(\);/.test(boot));
});

if (failures) { console.log('\n' + failures + ' 項失敗'); process.exit(1); }
console.log('\n全部通過');
