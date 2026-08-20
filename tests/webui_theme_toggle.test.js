// 第十一輪批次階段 D／第二十四輪批次改寫：幹事介面深色／淺色切換。
// 執行方式：node tests/webui_theme_toggle.test.js
//
// 呢部分完全係前端 HTML/CSS/JS，冇任何一行可以喺 Node 直接執行
// （DOM／matchMedia／localStorage 全部要真正瀏覽器），所以用靜態原始碼
// 檢查鎖住幾個唔可以錯嘅不變量。
//
// ─────────────────────────────────────────────────────────────────────
// 第二十四輪點解要改寫
// ─────────────────────────────────────────────────────────────────────
//
// 原本嘅斷言鎖死咗**具體嘅色碼**（`#4a3f1a` 等）同五步精靈嘅檔案結構。
// 第二十四輪換咗成套版面同色盤，嗰啲色碼已經唔存在。
//
// ⚠️ **冇刪走呢個檔案，而係保留返每一條嘅意圖**——鎖住嘅應該係
// 「架構唔可以退化」，唔係「呢個色碼唔可以改」。色碼本來就係可以改嘅，
// 鎖死佢只會令每次改版面都要改測試，測試就會變成阻力而唔係防線。
//
// 保留嘅四個意圖：
//   1. 版面規則只寫一份，唔可以跟主題各寫一份
//   2. 切換掣存在，而且 initThemeToggle() 真係有被呼叫
//   3. 偏好記憶：localStorage 優先，失敗先退回 PropertiesService
//   4. 深色色盤喺 `@media` 同 `[data-theme="dark"]` 兩處都有定義

const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui');
const styleHtml = fs.readFileSync(path.join(UI, 'Style.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(UI, 'Index.html'), 'utf8');
const scriptHtml = fs.readFileSync(path.join(UI, 'Script.html'), 'utf8');
const bootHtml = fs.readFileSync(path.join(UI, 'ScriptBoot.html'), 'utf8');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

console.log('\n=== D1：切換掣存在，而且真係接咗邏輯 ===');
{
  check('★★★★ Index.html 有切換掣', /id="themeToggleBtn"/.test(indexHtml));
  check('★★★★ Script.html 有 initThemeToggle() 定義', /function initThemeToggle/.test(scriptHtml));
  check('★★★★★ initThemeToggle() 喺開機時真係被呼叫'
    + '（唔係得個定義冇執行——嗰種情況掣會喺度但撳極都冇反應）',
    /^\s*initThemeToggle\(\);/m.test(bootHtml));
  check('★★★★ 掣有綁 click', /themeToggleBtn'\)\.addEventListener\('click'/.test(scriptHtml));
  check('★★★ 掣文字會隨當前主題更新（唔會永遠寫住「深色模式」）',
    /btn\.textContent = currentEffectiveTheme\(\) === 'dark'/.test(scriptHtml));
}

console.log('\n=== D2【核心】偏好記憶：localStorage 優先，失敗先退回 PropertiesService ===');
{
  check('★★★★ 有 localStorage 探測（HtmlService sandbox 可能擋咗）',
    /function themeLocalStorageProbe/.test(scriptHtml));
  check('★★★★★ localStorage 可用時唔會來回伺服器（同步、快）',
    /if \(themeLocalStorageOk\) \{[\s\S]{0,300}?localStorage\.getItem/.test(scriptHtml));
  check('★★★★★ localStorage 唔可用時先退回 apiGetThemePreference',
    /\} else \{[\s\S]{0,200}?callServer\('apiGetThemePreference'\)/.test(scriptHtml));
  check('★★★★ 寫入時一旦發現 localStorage 擋咗，之後改行伺服器路徑',
    /themeLocalStorageOk = false/.test(scriptHtml));
  check('★★★★★ 兩條路徑都失敗時 applyTheme(\'\')，即跟裝置設定'
    + '——唔可以硬套一個主題，亦唔可以白畫面',
    /catch \(e\) \{ applyTheme\(''\); \}/.test(scriptHtml));
}

console.log('\n=== D3【核心】版面規則只寫一份，唔可以跟主題各寫一份 ===');
{
  // 原本嘅意圖：唔可以「淺色一套 body/table 規則、深色再抄一套」。
  // 正確做法係同一組規則用 CSS 變數，主題只覆寫變數值。
  const darkBlocks = styleHtml.match(/:root\[data-theme="dark"\][^{]*\{[^}]*\}/g) || [];
  const mediaBlock = (styleHtml.match(/@media \(prefers-color-scheme: dark\)[\s\S]*?\n  \}/) || [''])[0];

  const layoutProps = ['padding:', 'margin:', 'display:', 'font-size:', 'border-radius:', 'flex'];
  const offenders = [];
  darkBlocks.concat([mediaBlock]).forEach(function (block) {
    layoutProps.forEach(function (p) {
      if (block.indexOf(p) !== -1) offenders.push(p + ' 出現喺主題區塊入面');
    });
  });

  check('★★★★★ 主題區塊入面只有顏色變數，冇任何版面屬性'
    + '（padding／margin／display／font-size…）'
    + '——版面跟主題各寫一份，改一次要改兩處，遲早會漏',
    offenders.length === 0, offenders.join('；'));

  // ⚠️ 第三十九輪批次 B 組：原本呢度數 `body {` 出現幾多次，要求剛好一次。
  //
  // 但呢一輪加咗一個 `@media (max-width: 700px)` 斷點（幹事會用平板同手機開），
  // 入面一定要有一條 `body {`——縮窄 padding 同放大字級。
  //
  // 淨係放寬個數字係錯嘅：噉樣原本要守嗰件事（**主題**同版面各寫一套）
  // 就冇人守。所以改成講清楚三件唔同嘅事：
  //   ・深色主題區塊入面一條 body 規則都唔可以有
  //   ・非 media query 嘅頂層 body 規則只可以有一條
  //   ・響應式斷點入面唔可以寫死顏色（顏色一律經變數）
  const themeBlocksAll = darkBlocks.concat([mediaBlock]).join('\n');
  check('★★★★★ 深色主題區塊入面一條 body 規則都冇'
    + '——一有就代表版面跟主題各寫一份，改一次要改兩處',
    (themeBlocksAll.match(/(^|\s)body\s*\{/g) || []).length === 0);

  const responsiveText = (styleHtml.match(/@media \(max-width:[\s\S]*?\n  \}/g) || []).join('\n');
  const topLevelBody = (styleHtml.replace(/@media[\s\S]*?\n  \}/g, '').match(/^\s*body \{/gm) || []);
  check('★★★★ 非 media query 嘅 body 版面規則只寫一次',
    topLevelBody.length === 1, '搵到 ' + topLevelBody.length + ' 條');

  check('★★★★★ 響應式斷點入面唔可以寫死顏色'
    + '——顏色一律經 CSS 變數，同「螢幕幾闊」完全無關；'
    + '喺呢度寫死一隻色就會喺深色模式下讀唔到',
    !/(color|background|border-color)\s*:\s*(?!var\()[^;]*;/.test(responsiveText),
    responsiveText.slice(0, 200));
  check('★★★★★ 顏色一律經 CSS 變數（--bg／--fg／--border…）',
    /--bg:/.test(styleHtml) && /background: var\(--bg\)/.test(styleHtml)
    && /color: var\(--fg\)/.test(styleHtml));
}

console.log('\n=== D4【核心】深色色盤兩處都要有，而且要一致 ===');
{
  // 用「由 @media 開始，去到 :root[data-theme="dark"] 之前」嚟切
  // ——比夾硬砌一個要數花括號嘅 regex 穩陣得多（縮排一改就會斷）。
  const mediaStart = styleHtml.indexOf('@media (prefers-color-scheme: dark)');
  const attrStart = styleHtml.indexOf(':root[data-theme="dark"] {');
  const mediaBlock = mediaStart === -1 ? ''
    : styleHtml.slice(mediaStart, attrStart === -1 ? undefined : attrStart);
  const attrBlock = attrStart === -1 ? ''
    : styleHtml.slice(attrStart, styleHtml.indexOf('}', styleHtml.indexOf('}', attrStart) + 1));

  check('★★★★ 有 @media (prefers-color-scheme: dark) 區塊（跟裝置設定）',
    mediaBlock.length > 0);
  check('★★★★ 有 :root[data-theme="dark"] 區塊（手動選擇）', attrBlock.length > 0);

  check('★★★★★ @media 區塊有 :not([data-theme="light"]) 防護'
    + '——冇呢個防護，裝置係深色時「已手動選淺色」會被 @media 蓋過而失效',
    /:root:not\(\[data-theme="light"\]\)/.test(mediaBlock));

  // 兩處嘅變數值要一模一樣，否則「跟裝置」同「手動揀深色」會出兩種深色。
  const varsOf = function (block) {
    const found = {};
    (block.match(/--[a-z-]+:\s*[^;]+;/g) || []).forEach(function (d) {
      const m = /--([a-z-]+):\s*([^;]+);/.exec(d);
      if (m) found[m[1]] = m[2].trim();
    });
    return found;
  };
  const a = varsOf(mediaBlock);
  const b = varsOf(attrBlock);
  const keys = Object.keys(a);

  check('★★★★ @media 區塊真係有定義變數', keys.length >= 5, '只有 ' + keys.length + ' 個');
  const mismatched = keys.filter(function (k) { return a[k] !== b[k]; });
  check('★★★★★ 兩處嘅深色變數值完全一致'
    + '——唔一致嘅話，「跟裝置」同「手動揀深色」會出兩種唔同嘅深色',
    mismatched.length === 0, mismatched.join('、'));
}

console.log('\n=== 個人連結頁面（義工睇嘅）刻意唔跟裝置深色 ===');
{
  const personal = fs.readFileSync(path.join(UI, 'PersonalRoster.html'), 'utf8');
  check('★★★★ 個人連結頁面冇 @media (prefers-color-scheme: dark)'
    + '——義工多數用手機睇，淺色較接近印出嚟嘅職事表',
    personal.indexOf('@media (prefers-color-scheme: dark)') === -1);
  check('★★★ 但仍然支援手動 data-theme="dark"',
    /:root\[data-theme="dark"\]/.test(personal));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
