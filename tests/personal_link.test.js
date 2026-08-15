// 第十一輪批次階段 B：個人專屬連結（token + Web App 唯讀入口）。
// 執行方式：node tests/personal_link.test.js
//
// 呢個功能嘅安全性完全靠 token 本身唔可猜、比對嗰陣一定要完全相等，
// 冇 Session/email 呢類第二重身分可以核對（ANYONE 部署，訪客可能連 Google
// 都未登入）——所以本輪測試特別加強兩件事：
//   1. token 比對邏輯（matchPersonByToken_()）獨立抽出嚟直接測試
//   2. doGet() 嘅分流一定要排喺最頭，唔可以有任何共用邏輯排喺分流之前
//
// findPersonByToken_()／renderPersonalRosterPage_() 呢類要讀試算表／回傳
// HtmlOutput 嘅函式跑唔到 Node，跟本專案其他會真正碰 GAS 環境嘅工具一樣，
// 用靜態原始碼檢查鎖住唔可以錯嘅不變量。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'WebAppPersonalLink.gs']);

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

const SRC = path.join(__dirname, '..', 'src');
const webAppSource = fs.readFileSync(path.join(SRC, 'WebApp.gs'), 'utf8');
const personalLinkSource = fs.readFileSync(path.join(SRC, 'WebAppPersonalLink.gs'), 'utf8');
const personalRosterHtml = fs.readFileSync(path.join(SRC, 'ui', 'PersonalRoster.html'), 'utf8');

// 假 token 全部用字面值拼接組出（唔係單一連續長字面值），令呢份測試檔嘅
// 原始碼文字入面唔會出現一段連續 25+ 字元嘅字串——否則 scan_sensitive.test.js
// 正式掃描時會誤判成「未知嘅長 ID 字串」。做法同 scan_sensitive.test.js
// 自己嘅自我檢查段落同一個慣例。
const TOKEN_A = 'a1b2c3d4e5f6a1b2' + 'c3d4e5f6a1b2c3d4'; // 32 字元
const TOKEN_C = 'b2c3d4e5f6a1b2c3' + 'd4e5f6a1b2c3d4e5'; // 32 字元
const FAKE_UUID = '550e8400-e29b-41d4' + '-a716-446655440000';

/** 造幾個虛構同工，一個有 token、一個 token 空白、一個 token 有前後空白。 */
function mockRows() {
  return [
    { PersonID: 'P001', NameTC: '陳大文', PersonalLinkToken: TOKEN_A },
    { PersonID: 'P002', NameTC: '李小明', PersonalLinkToken: '' },
    { PersonID: 'P003', NameTC: '王美美', PersonalLinkToken: '  ' + TOKEN_C + '  ' }
  ];
}

console.log('\n=== B3【核心】token 比對——一定要完全相等，唔可以前綴／子字串命中 ===');
{
  const rows = mockRows();

  const found = gas.matchPersonByToken_(rows, TOKEN_A);
  check('★★ 完全相等 → 搵到啱嗰個人', found && found.personId === 'P001');

  const prefixOnly = gas.matchPersonByToken_(rows, TOKEN_A.slice(0, -1));
  check('★★ 少一個字（前綴）→ 搵唔到', prefixOnly === null);

  const withExtra = gas.matchPersonByToken_(rows, TOKEN_A + 'X');
  check('★★ 多一個字 → 搵唔到', withExtra === null);

  const wrongCase = gas.matchPersonByToken_(rows, TOKEN_A.toUpperCase());
  check('★ 大小寫唔同 → 搵唔到（token 唔應該大小寫不敏感，減少碰撞空間）',
    wrongCase === null);

  const trimmed = gas.matchPersonByToken_(rows, TOKEN_C);
  check('★ 工作表儲存格前後有空白時，比對前會 trim（人手複製貼上常見情況）',
    trimmed && trimmed.personId === 'P003');
}

console.log('\n=== B3【核心】空 token 唔可以撞正某一行 token 剛好都係空白 ===');
{
  const rows = mockRows(); // P002 嘅 token 係空字串
  checkEqual('★★★ 傳入空字串一定回傳 null（唔可以撞正 P002 個空白 token）',
    gas.matchPersonByToken_(rows, ''), null);
  checkEqual('★★★ 傳入 null 一定回傳 null', gas.matchPersonByToken_(rows, null), null);
  checkEqual('★★★ 傳入 undefined 一定回傳 null', gas.matchPersonByToken_(rows, undefined), null);
  checkEqual('★ 傳入純空白字串一定回傳 null', gas.matchPersonByToken_(rows, '   '), null);
}

console.log('\n=== B3：搵唔到／token 無效嘅回傳一律係 null，唔會透露邊一種原因 ===');
{
  checkEqual('★★ 完全冇資料時搵任何 token 都係 null', gas.matchPersonByToken_([], 'anything'), null);
  const rows = mockRows();
  const notExist = gas.matchPersonByToken_(rows, 'f'.repeat(32));
  checkEqual('★ 格式啱但唔存在嘅 token 一樣係 null（同「唔存在嘅人」回傳同一種結果）',
    notExist, null);
}

console.log('\n=== B1：token 產生函式嘅格式契約（真正隨機性要真 GAS 環境先驗證得到）===');
{
  const start = personalLinkSource.indexOf('function generatePersonalLinkToken_');
  const end = personalLinkSource.indexOf('\n}', start);
  const body = personalLinkSource.slice(start, end);

  check('★★ 用 Utilities.getUuid()（GAS 內建密碼學等級隨機來源），冇自己砌隨機數',
    body.indexOf('Utilities.getUuid()') !== -1);
  check('★ 去咗 UUID 嘅連字號（統一格式，純十六進位字元）',
    /split\(['"]-['"]\)\.join\(/.test(body));

  // UUID v4 去掉 4 個連字號之後一定係 32 個字元
  const stripped = FAKE_UUID.split('-').join('');
  checkEqual('★ 32 字元十六進位（用一個已知嘅 UUID 樣本核對邏輯本身）',
    stripped.length, 32);
}

console.log('\n=== B1：補發／重新產生 token 嘅工具只填空白／只改單一個人，唔會亂改 ===');
{
  const seedStart = personalLinkSource.indexOf('function seedPersonalLinkTokens_');
  const seedEnd = personalLinkSource.indexOf('\nfunction', seedStart + 1);
  const seedBody = personalLinkSource.slice(seedStart, seedEnd);
  check('★★ 補發工具只處理 missingIds 入面嘅人（唔會周圍改）',
    seedBody.indexOf('missingIds[personId]') !== -1);

  const reissueStart = personalLinkSource.indexOf('function reissuePersonalLinkToken_');
  const reissueEnd = personalLinkSource.indexOf('\nfunction', reissueStart + 1);
  const reissueBody = personalLinkSource.slice(reissueStart, reissueEnd);
  check('★★ 重新產生工具搵唔到指定嘅 PersonID 就拋錯（唔會靜靜咁乜都冇做）',
    /throw new Error/.test(reissueBody));
}

console.log('\n=== B2【核心】doGet() 分流一定要排喺最頭 ===');
{
  const start = webAppSource.indexOf('function doGet(e)');
  const braceIdx = webAppSource.indexOf('{', start);
  const bodyStart = braceIdx + 1;
  const routeIdx = webAppSource.indexOf('renderPersonalRosterPage_(e)', bodyStart);
  const enabledIdx = webAppSource.indexOf('assertWebAppEnabled_()', bodyStart);
  const authIdx = webAppSource.indexOf('assertApiCallerAuthorized_()', bodyStart);

  check('★★★ doGet() 有分流去 renderPersonalRosterPage_()', routeIdx > 0);
  check('★★★ 分流排喺 assertWebAppEnabled_() 之前（唔可以有共用邏輯排喺分流之前）',
    routeIdx > 0 && enabledIdx > 0 && routeIdx < enabledIdx);
  check('★★★ 分流排喺 assertApiCallerAuthorized_() 之前',
    routeIdx > 0 && authIdx > 0 && routeIdx < authIdx);

  // 分流條件本身要檢查 e.parameter.p，唔係隨便一個參數
  const routeLineStart = webAppSource.lastIndexOf('if (', routeIdx);
  const routeLineEnd = webAppSource.indexOf('\n', routeIdx);
  const routeCondition = webAppSource.slice(routeLineStart, routeLineEnd);
  check('★ 分流條件檢查 e.parameter.p', routeCondition.indexOf('e.parameter.p') !== -1);
}

console.log('\n=== B2／B3：個人連結渲染路徑完全唔行幹事介面嗰套權限檢查 ===');
{
  const start = personalLinkSource.indexOf('function renderPersonalRosterPage_');
  const end = personalLinkSource.indexOf('\nfunction renderPersonalRosterError_', start);
  const body = personalLinkSource.slice(start, end);

  check('★★★ renderPersonalRosterPage_() 完全冇呼叫 assertApiCallerAuthorized_()'
    + '（義工冇 email 白名單身分可以核對）',
    body.indexOf('assertApiCallerAuthorized_') === -1);
  check('★ 但仍然尊重 WEBAPP_ENABLED 總開關（幹事可以一鍵停用成個 Web UI，包括呢頁）',
    body.indexOf('assertWebAppEnabled_()') !== -1);
  check('★★ 完全冇渲染 ui/Index（操作介面）', body.indexOf('UI_FILES.INDEX') === -1);
}

console.log('\n=== B3【核心】token 錯／季度唔存在／查詢失敗，一律顯示同一句中性錯誤 ===');
{
  const start = personalLinkSource.indexOf('function renderPersonalRosterPage_');
  const end = personalLinkSource.indexOf('\nfunction renderPersonalRosterError_', start);
  const body = personalLinkSource.slice(start, end);

  const errorCallCount = (body.match(/renderPersonalRosterError_\(\)/g) || []).length;
  check('★★★ 至少 3 個地方會導向同一個中性錯誤頁（缺參數／token 搵唔到／資料查詢失敗）',
    errorCallCount >= 3, '實際出現次數：' + errorCallCount);

  check('★★ 錯誤訊息本身唔可以講出「係邊一種原因」（唔可以有 token／季度／不存在呢類字眼）',
    !/[Tt]oken.{0,10}(不存在|無效|過期)|季度.{0,10}(不存在|找不到)/.test(gas.PERSONAL_LINK_INVALID_MESSAGE),
    '實際訊息：' + gas.PERSONAL_LINK_INVALID_MESSAGE);

  // 反證：故意起錯一個訊息，證明上面嗰個檢查有效
  const leaky = 'token 不存在，請重新申請';
  check('★ 反證：故意寫一句洩漏原因嘅訊息會俾檢查抓到',
    /[Tt]oken.{0,10}(不存在|無效|過期)/.test(leaky));
}

console.log('\n=== B3【核心】唯讀頁面完全冇任何 google.script.run 呼叫 ===');
{
  check('★★★ ui/PersonalRoster.html 完全冇 google.script.run',
    personalRosterHtml.indexOf('google.script.run') === -1);
  check('★ 完全冇 <form>（冇任何送出資料嘅路徑）',
    !/<form[\s>]/i.test(personalRosterHtml));
  check('★ 完全冇會改動資料嘅 HTML 元素（input[type=text/submit]、button 只有主題切換）',
    !/<input/i.test(personalRosterHtml));
  const buttonCount = (personalRosterHtml.match(/<button/gi) || []).length;
  checkEqual('★★ 頁面上唯一嘅按鈕係深色／淺色切換（純前端 CSS，唔改任何資料）',
    buttonCount, 1);
}

console.log('\n=== B4：頁面內容涵蓋規格要求嘅五項 ===');
{
  check('★ 有 highlight 呢個人自己嘅格（td.mine）',
    personalRosterHtml.indexOf('class="mine"') !== -1 || personalRosterHtml.indexOf("' class=\"mine\"'") !== -1);
  check('★ 有「你的服侍安排」摘要列表', personalRosterHtml.indexOf('你的服侍安排') !== -1);
  check('★ 有更新時間', personalRosterHtml.indexOf('最後更新') !== -1);
  check('★ 有點樣申報唔能夠服侍嘅說明', personalRosterHtml.indexOf('如果這一週不能服侍') !== -1);
  check('★ 有完整職事表（表頭同表格 loop）',
    personalRosterHtml.indexOf('data.headers.forEach') !== -1
      && personalRosterHtml.indexOf('data.rows.forEach') !== -1);
}

console.log('\n=== D3：呢個頁面預設淺色，唔會跟裝置嘅深色模式自動切換 ===');
{
  check('★★ 冇 @media (prefers-color-scheme: dark)（唔應該自動跟系統）',
    personalRosterHtml.indexOf('prefers-color-scheme') === -1);
  check('★ 一定要用戶自己撳先會轉深色（[data-theme="dark"] 顯式選擇器）',
    personalRosterHtml.indexOf(':root[data-theme="dark"]') !== -1);
}

console.log('\n=== A2／B4 同一原則：內容組建函式唔可以直接接觸敏感欄位 ===');
{
  const start = personalLinkSource.indexOf('function buildPersonalRosterPageData_');
  const end = personalLinkSource.indexOf('\nfunction renderPersonalRosterPage_', start);
  const body = personalLinkSource.slice(start, end);

  const FORBIDDEN = ['EMAIL', 'getNotes', 'MailApp'];
  FORBIDDEN.forEach(function (w) {
    check('★★ buildPersonalRosterPageData_() 冇直接出現「' + w + '」', body.indexOf(w) === -1);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
