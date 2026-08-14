// 階段 D：Web UI 三層防護（appsscript.json 部署權限／WEBAPP_ENABLED／
// WEBAPP_ALLOWED_EMAILS）的回歸測試。
// 執行方式：node tests/webapp_access_guard.test.js
// 兩部分：(1) 移植 WebApp.gs 的 assertWebAppEnabled_()／assertApiCallerAuthorized_()／
// assertWebAppRequestAllowed_() 邏輯，驗證 WEBAPP_ENABLED=FALSE 時一定拒絕；
// (2) 直接讀取 src/WebApp.gs／src/WebAppFlow.gs 原始碼，靜態驗證每一個 api*
// 函式的第一行都呼叫 assertWebAppRequestAllowed_()——這是這次程式碼稽核
// （見 docs/系統範圍稽核.md 階段 D）結論的永久回歸版本，日後有人新增 api*
// 函式卻忘記加這行防護，這個測試會直接抓到。

const fs = require('fs');
const path = require('path');

// ---- 移植：WebApp.gs 的 assertWebAppEnabled_()／assertApiCallerAuthorized_() ----
function assertWebAppEnabled_(config) {
  if (config.WEBAPP_ENABLED !== true) {
    throw new Error('Web UI 目前已停用（Config 的 WEBAPP_ENABLED 不是 TRUE）。');
  }
}
function assertApiCallerAuthorized_(config, callerEmail) {
  const email = String(callerEmail || '').trim().toLowerCase();
  if (!email) throw new Error('無法識別呼叫者身分，拒絕執行。');

  const explicitList = (Array.isArray(config.WEBAPP_ALLOWED_EMAILS) ? config.WEBAPP_ALLOWED_EMAILS : [])
    .map(function (e) { return String(e).trim().toLowerCase(); })
    .filter(Boolean);
  const allowList = explicitList.length > 0
    ? explicitList
    : [String(config.SCRIPT_ACCOUNT_EMAIL || '').trim().toLowerCase()].filter(Boolean);

  if (allowList.length === 0) throw new Error('Web UI 允許名單是空的，拒絕執行。');
  if (allowList.indexOf(email) === -1) throw new Error('（' + email + '）不在 Web UI 允許名單內，拒絕執行。');
}
function assertWebAppRequestAllowed_(config, callerEmail) {
  assertWebAppEnabled_(config);
  assertApiCallerAuthorized_(config, callerEmail);
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkThrows(label, fn) {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label}\n      沒有拋出錯誤`);
  } catch (err) {
    console.log(`PASS  ${label}`);
  }
}
function checkNotThrows(label, fn) {
  try {
    fn();
    console.log(`PASS  ${label}`);
  } catch (err) {
    fail++;
    console.log(`FAIL  ${label}\n      不應該拋錯，但拋了：${err.message}`);
  }
}

console.log('\n=== D3：WEBAPP_ENABLED=FALSE 時，任何 api 函式的防護關卡都必須拒絕 ===');
{
  const disabledConfig = { WEBAPP_ENABLED: false, WEBAPP_ALLOWED_EMAILS: ['admin@example.invalid'], SCRIPT_ACCOUNT_EMAIL: 'admin@example.invalid' };
  checkThrows('★ WEBAPP_ENABLED=FALSE → assertWebAppEnabled_ 拒絕（即使白名單設好了也一樣）',
    () => assertWebAppEnabled_(disabledConfig));
  checkThrows('★ WEBAPP_ENABLED=FALSE → assertWebAppRequestAllowed_ 整體拒絕（呼叫者是白名單內的人也一樣）',
    () => assertWebAppRequestAllowed_(disabledConfig, 'admin@example.invalid'));

  // Config 值不是嚴格 boolean true（例如字串 'TRUE'、1、undefined）也一律視為未啟用——
  // 呼叫端已經用 getConfig(...) 轉換成正確的布林值，這裡測的是「非嚴格 true 一律擋」
  // 這個防呆本身沒有被弱化。
  ['TRUE', 1, undefined, null, ''].forEach(function (v) {
    checkThrows('★ WEBAPP_ENABLED=' + JSON.stringify(v) + '（非嚴格 boolean true）→ 一律拒絕',
      () => assertWebAppEnabled_({ WEBAPP_ENABLED: v }));
  });
}

console.log('\n=== 三層防護各自獨立生效 ===');
{
  const enabledNoWhitelist = { WEBAPP_ENABLED: true, WEBAPP_ALLOWED_EMAILS: [], SCRIPT_ACCOUNT_EMAIL: '' };
  checkThrows('★ WEBAPP_ENABLED=TRUE 但白名單與 SCRIPT_ACCOUNT_EMAIL 都空白 → 拒絕（空白絕不代表任何人皆可）',
    () => assertApiCallerAuthorized_(enabledNoWhitelist, 'anyone@example.invalid'));

  const enabledEmptyListFallback = { WEBAPP_ENABLED: true, WEBAPP_ALLOWED_EMAILS: [], SCRIPT_ACCOUNT_EMAIL: 'admin@example.invalid' };
  checkNotThrows('★ 白名單空白但 SCRIPT_ACCOUNT_EMAIL 有值 → 退回只允許那一人',
    () => assertApiCallerAuthorized_(enabledEmptyListFallback, 'admin@example.invalid'));
  checkThrows('★ 白名單空白、退回 SCRIPT_ACCOUNT_EMAIL，但呼叫者不是那個人 → 拒絕',
    () => assertApiCallerAuthorized_(enabledEmptyListFallback, 'someone-else@example.invalid'));

  const withList = { WEBAPP_ENABLED: true, WEBAPP_ALLOWED_EMAILS: ['a@example.invalid', 'B@Example.Invalid'], SCRIPT_ACCOUNT_EMAIL: '' };
  checkNotThrows('★ 呼叫者在白名單內 → 放行', () => assertApiCallerAuthorized_(withList, 'a@example.invalid'));
  checkNotThrows('★ 白名單比對大小寫不敏感', () => assertApiCallerAuthorized_(withList, 'b@example.invalid'));
  checkThrows('★ 呼叫者不在白名單內 → 拒絕', () => assertApiCallerAuthorized_(withList, 'stranger@example.invalid'));
  checkThrows('★ 呼叫者身分是空字串（讀不到）→ 拒絕', () => assertApiCallerAuthorized_(withList, ''));

  const fullyOpen = { WEBAPP_ENABLED: true, WEBAPP_ALLOWED_EMAILS: ['a@example.invalid'], SCRIPT_ACCOUNT_EMAIL: '' };
  checkNotThrows('★ 三層全部通過 → assertWebAppRequestAllowed_ 不拋錯', () => assertWebAppRequestAllowed_(fullyOpen, 'a@example.invalid'));
}

console.log('\n=== 靜態原始碼稽核：每一個 api* 函式的第一行都必須呼叫 assertWebAppRequestAllowed_() ===');
{
  const SRC_DIR = path.resolve(__dirname, '..', 'src');
  const files = ['WebApp.gs', 'WebAppFlow.gs'];
  let totalApiFunctions = 0;
  let missingGuard = [];

  files.forEach(function (fileName) {
    const filePath = path.join(SRC_DIR, fileName);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^function (api[A-Za-z0-9_]*)\s*\(/);
      if (!m) continue;
      totalApiFunctions++;
      // 找函式定義後第一行「非空白」的程式碼（跳過空行，範本裡目前每個 api*
      // 函式的防護呼叫都緊接在宣告下一行，沒有中間插空行，但這裡故意容許
      // 空行，只認第一行有實際內容的程式碼）。
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const firstStatement = lines[j] ? lines[j].trim() : '';
      if (firstStatement.indexOf('assertWebAppRequestAllowed_()') === -1) {
        missingGuard.push(fileName + ':' + (i + 1) + ' ' + m[1] + '() → 第一行是「' + firstStatement + '」');
      }
    }
  });

  check('★ 找到的 api* 函式數量合理（> 0，確認掃描邏輯本身有在運作）', totalApiFunctions > 0, true);
  console.log(`      （共找到 ${totalApiFunctions} 個 api* 函式）`);
  check('★ 全部 api* 函式的第一行都是 assertWebAppRequestAllowed_()，沒有任何一個繞過', missingGuard, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
