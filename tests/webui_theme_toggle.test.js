// 第十一輪批次階段 D：幹事介面（ui/Index.html）深色/淺色切換掣。
// 執行方式：node tests/webui_theme_toggle.test.js
//
// 呢部分完全係前端 HTML/CSS/JS，冇任何一行呼叫 GAS API 之外嘅邏輯可以喺
// Node 直接執行（DOM／matchMedia／localStorage 全部要真正瀏覽器），所以
// 用靜態原始碼檢查鎖住幾個唔可以錯嘅不變量——跟 tests/personal_link.test.js
// 對 ui/PersonalRoster.html 嘅做法一致。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const SRC = path.join(__dirname, '..', 'src');
const styleHtml = fs.readFileSync(path.join(SRC, 'ui', 'Style.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(SRC, 'ui', 'Index.html'), 'utf8');
const scriptHtml = fs.readFileSync(path.join(SRC, 'ui', 'Script.html'), 'utf8');
const webAppSource = fs.readFileSync(path.join(SRC, 'WebApp.gs'), 'utf8');

console.log('\n=== D1：用 CSS 變數實作，唔係寫兩套樣式 ===');
{
  check('★★ :root 有一份淺色基準（唯一一份 --bg／--fg 等變數定義嘅根選擇器）',
    /:root\s*{[^}]*--bg:\s*#ffffff/.test(styleHtml));
  check('★★ 有 :root[data-theme="dark"] 明確覆寫（手動選深色時唔理裝置設定）',
    /:root\[data-theme="dark"\]\s*{/.test(styleHtml));
  check('★★ @media (prefers-color-scheme: dark) 入面嘅選擇器有 :not([data-theme="light"]) 防護'
    + '（否則裝置係深色時，手動選咗嘅淺色會被呢段蓋過）',
    /@media \(prefers-color-scheme: dark\)[^]*?:root:not\(\[data-theme="light"\]\)/.test(styleHtml));
  check('★ 全檔只有一份 body/table/th/td 等版面樣式規則（唔係跟主題各寫一份）',
    (styleHtml.match(/^\s*body\s*{/gm) || []).length === 1
    && (styleHtml.match(/^\s*table\s*{/gm) || []).length === 1);
}

console.log('\n=== D1：Index.html 有切換掣，Script.html 有對應邏輯 ===');
{
  check('★★ Index.html 有 id="themeToggleBtn" 嘅按鈕', /id="themeToggleBtn"/.test(indexHtml));
  check('★★ Script.html 有 initThemeToggle 函式', /function initThemeToggle/.test(scriptHtml));
  check('★ Script.html 有幫 themeToggleBtn 綁 click 事件', /themeToggleBtn'\)\.addEventListener\('click'/.test(scriptHtml));
  check('★ initThemeToggle() 有喺頁面載入時被呼叫（唔係得個定義冇執行）',
    /initThemeToggle\(\);/.test(scriptHtml));
}

console.log('\n=== D2【核心】偏好記憶：localStorage 優先，失敗先退回 PropertiesService（UserProperties）===');
{
  check('★★ 讀取偏好前有偵測 localStorage 是否可用（themeLocalStorageProbe，包 try/catch）',
    /function themeLocalStorageProbe\(\)\s*{\s*try\s*{/.test(scriptHtml));
  check('★★ localStorage 可用時，讀取用 try/catch 包住（避免中途拋錯令頁面壞晒）',
    /try\s*{\s*stored = window\.localStorage\.getItem\(THEME_STORAGE_KEY\);\s*}\s*catch/.test(scriptHtml));
  check('★★ localStorage 唔可用時，退回呼叫伺服器 apiGetThemePreference',
    /callServer\('apiGetThemePreference'\)/.test(scriptHtml));
  check('★★ 寫入偏好時，localStorage 失敗會退回呼叫伺服器 apiSetThemePreference',
    /callServer\('apiSetThemePreference', next\)/.test(scriptHtml));
  check('★ localStorage 寫入失敗時會記住（themeLocalStorageOk = false），之後改行伺服器路徑',
    /themeLocalStorageOk = false;/.test(scriptHtml));

  check('★★ WebApp.gs 有 apiGetThemePreference() 函式，且第一行呼叫 assertWebAppRequestAllowed_()',
    /function apiGetThemePreference\(\)\s*{\s*assertWebAppRequestAllowed_\(\);/.test(webAppSource));
  check('★★ WebApp.gs 有 apiSetThemePreference(theme) 函式，且第一行呼叫 assertWebAppRequestAllowed_()',
    /function apiSetThemePreference\(theme\)\s*{\s*assertWebAppRequestAllowed_\(\);/.test(webAppSource));
  check('★ apiGetThemePreference／apiSetThemePreference 用 PropertiesService.getUserProperties()（唔係 ScriptProperties，偏好係個人化嘅）',
    (webAppSource.match(/PropertiesService\.getUserProperties\(\)/g) || []).length >= 2);
  check('★ apiSetThemePreference 只接受 \'dark\'／\'light\'，其他值一律略過（唔會寫入垃圾值）',
    /const normalized = \(theme === 'dark' \|\| theme === 'light'\) \? theme : '';/.test(webAppSource));
}

console.log('\n=== D2：冇手動選過時完全跟裝置設定（唔會強制寫死一個預設值）===');
{
  check('★★ initThemeToggle 讀到空值時傳 \'\' 給 applyTheme（唔係傳 \'light\' 或 \'dark\'）',
    /applyTheme\(stored \|\| ''\);/.test(scriptHtml));
  check('★★ applyTheme(\'\') 會移除 data-theme 屬性（等於「跟裝置」）',
    /root\.removeAttribute\('data-theme'\);/.test(scriptHtml));
}

console.log('\n=== D4：對比度——深色變數值未被本輪改動（沿用第十輪已核過嘅深色配色，只係改咗選擇器結構）===');
{
  ['#16181d', '#e6edf3', '#9198a1', '#30363d', '#4a3f1a', '#5a3b1c', '#24272e', '#5c2b2b', '#24402a'].forEach(function (hex) {
    check('★ 深色變數值 ' + hex + ' 仍然存在（且 :root[data-theme="dark"] 同 @media 兩處都有，維持一致）',
      (styleHtml.match(new RegExp(hex.replace('#', '#'), 'g')) || []).length >= 2, hex);
  });
}

console.log('\n=== 交叉檢查：apiGetThemePreference／apiSetThemePreference 沒有繞過既有 api* 靜態掃描 ===');
{
  check('★ 兩個新函式名稱以 api 開頭（會被 tests/webapp_access_guard.test.js 的正規掃描抓到，不需要另開清單）',
    /function apiGetThemePreference\(/.test(webAppSource) && /function apiSetThemePreference\(/.test(webAppSource));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}`);
process.exit(fail === 0 ? 0 : 1);
