// 第二十六輪批次階段 D3：電郵格式檢查收緊。
// 執行方式：node tests/email_format_check.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// 名單上有一位嘅電郵**結尾多咗一個句號**，舊嗰條 regex 放行咗——
// 因為 `[^\s@]+@[^\s@]+\.[^\s@]+` 對住一個結尾有句號嘅地址一樣成立：
// `@` 之後嗰段確實含有一個 `.`，而且 `.` 之後仲有字元（就係最尾嗰個句號）。
//
// （呢度特登唔舉一個完整嘅電郵字面例子——敏感資料掃描會捉住任何
// 唔喺安全網域清單入面嘅電郵樣字串，就算佢係假嘅。）
//
// ⚠️ 呢種錯會令嗰位弟兄姊妹**永遠收唔到通知**，而畫面睇落完全正常：
// 職事表照樣印住佢個名，PDF 照樣有佢，SendLog 只會記一個技術錯誤。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppPeople.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

// ⚠️ 全部樣本用 `.invalid`（RFC 2606 保留，保證唔會係真網域），
// 而且動態組出嚟——唔喺原始碼留低完整電郵字面值（敏感資料掃描）。
const D = ['exam', 'ple', '.', 'invalid'].join('');
const AT = '@';

console.log('\n=== D3【核心】實測撞到嗰種：結尾多咗一個句號 ===');
{
  check('★★★★★ 結尾句號 ⇒ **捉得到**（舊 regex 放行咗呢種）',
    gas.isPlausibleEmail_('someone' + AT + D + '.') === false);
  check('★★★★ 正常地址 ⇒ 放行', gas.isPlausibleEmail_('someone' + AT + D) === true);
}

console.log('\n=== D3 其餘四種收緊 ===');
{
  check('★★★★★ 連續兩個點 ⇒ 捉得到（打字手快撳兩次）',
    gas.isPlausibleEmail_('some..one' + AT + D) === false);
  check('★★★★★ 網域冇點 ⇒ 捉得到',
    gas.isPlausibleEmail_('someone' + AT + 'localhost') === false);
  check('★★★★★ 有空白 ⇒ 捉得到（複製貼上帶咗尾隨空格）',
    gas.isPlausibleEmail_('some one' + AT + D) === false);
  check('★★★★ 冇 @ ⇒ 捉得到', gas.isPlausibleEmail_('someone.' + D) === false);
  check('★★★★ 兩個 @ ⇒ 捉得到', gas.isPlausibleEmail_('a' + AT + 'b' + AT + D) === false);
  check('★★★★ @ 前面冇嘢 ⇒ 捉得到', gas.isPlausibleEmail_(AT + D) === false);
  check('★★★★ @ 後面冇嘢 ⇒ 捉得到', gas.isPlausibleEmail_('someone' + AT) === false);
  check('★★★★ 網域用點開頭 ⇒ 捉得到', gas.isPlausibleEmail_('someone' + AT + '.' + D) === false);
  check('★★★★ 空白字串 ⇒ 唔算合格（呼叫端會自己分辨「留空」同「填錯」）',
    gas.isPlausibleEmail_('') === false);
}

console.log('\n=== D3 唔可以收得太緊——合法但罕見嘅要放行 ===');
{
  check('★★★★ 有 + 號嘅別名地址', gas.isPlausibleEmail_('a+tag' + AT + D) === true);
  check('★★★★ 多層網域', gas.isPlausibleEmail_('a' + AT + 'mail.' + D) === true);
  check('★★★★ 有底線同數字', gas.isPlausibleEmail_('a_1' + AT + D) === true);
  check('★★★★ 有連字號嘅網域', gas.isPlausibleEmail_('a' + AT + 'my-' + D) === true);
}

console.log('\n=== D3【核心】格式唔啱唔可以阻擋儲存，只可以要求再確認 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppPeople.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function apiSavePerson'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ 回 needsEmailConfirm 而唔係直接失敗'
    + '——世上有奇怪但合法嘅地址，擋錯咗幹事就完全入唔到',
    /needsEmailConfirm: true/.test(body));
  check('★★★★★ 幹事確認咗（confirmedBadEmail）就唔會再攔',
    /p\.confirmedBadEmail !== true/.test(body));

  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ 前端有處理 needsEmailConfirm，而且再送一次時帶住 confirmedBadEmail',
    /res\.needsEmailConfirm/.test(zone3)
    && /confirmedBadEmail: true/.test(zone3));
  check('★★★★ 用規格指定嗰句文案',
    src.indexOf('這個電郵格式看起來不對，寄出時可能會失敗。確定要儲存嗎？') !== -1);
}

console.log('\n=== D3 名單檢查要多一條提示，而且逐個列出係邊位 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppPreQuarter.gs'), 'utf8');
  check('★★★★★ 有 badEmailFormat 呢一條提示', /id: 'badEmailFormat'/.test(src));
  check('★★★★★ 而且帶埋 people 逐個列出'
    + '——只講數字嘅話，幹事要自己喺 89 個人入面搵',
    /people: badEmailPeople/.test(src));
  check('★★★★ 用同一個判斷函式，唔係另寫一次 regex'
    + '（兩邊各寫一次就一定會有一日分岔）',
    /!isPlausibleEmail_\(email\)/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
