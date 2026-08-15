// 第十二輪批次階段 B：first-run（全新環境）路徑稽核與修正。
// 執行方式：node tests/fresh_environment_check.test.js
//
// 呢個檔案測三樣嘢：
//   1. 新增嘅「全新環境自我檢查」工具本身嘅純函式邏輯
//   2. 實測發現嘅兩個 first-run bug 嘅修正（PublicLinks 工作表、
//      NameMapping.PersonalLinkToken 欄），用靜態原始碼檢查鎖住
//   3. 順手鎖住呢一輪自己喺 FreshEnvironmentCheck.gs 入面差啲重蹈覆轍嘅
//      tryWriteDiagnostics_() 型別錯誤（見階段 C 對 PublicRoster.gs 嘅修正）

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'FreshEnvironmentCheck.gs']);

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
const freshEnvSource = fs.readFileSync(path.join(SRC, 'FreshEnvironmentCheck.gs'), 'utf8');
const publicRosterSource = fs.readFileSync(path.join(SRC, 'PublicRoster.gs'), 'utf8');
const personalLinkSource = fs.readFileSync(path.join(SRC, 'WebAppPersonalLink.gs'), 'utf8');
const menuSource = fs.readFileSync(path.join(SRC, 'Menu.gs'), 'utf8');

console.log('\n=== B4【核心】evaluateFreshEnvSheets_：純函式判斷工作表存在與否 ===');
{
  const required = [
    { sheet: 'PublicLinks', note: 'n1' },
    { sheet: 'NotThere', note: 'n2' }
  ];
  const result = gas.evaluateFreshEnvSheets_(required, ['Config', 'PublicLinks', 'Posts']);
  checkEqual('★★ 存在嘅工作表標 exists=true', result[0], { sheet: 'PublicLinks', note: 'n1', exists: true });
  checkEqual('★★ 不存在嘅工作表標 exists=false', result[1], { sheet: 'NotThere', note: 'n2', exists: false });
}

console.log('\n=== B4【核心】evaluateFreshEnvColumns_：純函式判斷欄位存在與否，分清「工作表都未存在」同「工作表存在但冇呢個欄」===');
{
  const required = [
    { sheet: 'NameMapping', column: 'PersonalLinkToken', tool: 'T1' },
    { sheet: 'Posts', column: 'EarlyArrivalMinutes', tool: 'T2' },
    { sheet: 'Ghost', column: 'AnyCol', tool: 'T3' }
  ];
  const sheetInfo = {
    NameMapping: { exists: true, headers: ['PersonID', 'NameTC', 'PersonalLinkToken'] },
    Posts: { exists: true, headers: ['PostID', 'PostNameTC'] }
    // Ghost 唔喺 sheetInfo 入面，模擬工作表本身都未存在
  };
  const result = gas.evaluateFreshEnvColumns_(required, sheetInfo);
  checkEqual('★★★ 工作表存在、欄都存在', result[0],
    { sheet: 'NameMapping', column: 'PersonalLinkToken', tool: 'T1', sheetExists: true, columnExists: true });
  checkEqual('★★★ 工作表存在、但欄唔存在', result[1],
    { sheet: 'Posts', column: 'EarlyArrivalMinutes', tool: 'T2', sheetExists: true, columnExists: false });
  checkEqual('★★ 工作表本身都未存在（唔可以話「欄唔存在」，要清楚分開兩種情況）', result[2],
    { sheet: 'Ghost', column: 'AnyCol', tool: 'T3', sheetExists: false, columnExists: false });
}

console.log('\n=== B4：必檢清單有涵蓋本輪同上一輪新增嘅系統管理資源 ===');
{
  check('★★ FRESH_ENV_REQUIRED_SHEETS 有 PublicLinks（第十一輪新增，實測發現嘅 first-run bug 對象）',
    gas.FRESH_ENV_REQUIRED_SHEETS.some(function (s) { return s.sheet === 'PublicLinks'; }));
  check('★★ FRESH_ENV_REQUIRED_COLUMNS 有 NameMapping.PersonalLinkToken（實測發現嘅另一個 first-run bug 對象）',
    gas.FRESH_ENV_REQUIRED_COLUMNS.some(function (c) { return c.sheet === 'NameMapping' && c.column === 'PersonalLinkToken'; }));
  check('★ FRESH_ENV_REQUIRED_COLUMNS 有 Posts.EarlyArrivalMinutes（本輪新增）',
    gas.FRESH_ENV_REQUIRED_COLUMNS.some(function (c) { return c.sheet === 'Posts' && c.column === 'EarlyArrivalMinutes'; }));
  check('★ 每個必檢欄位都有列明對應嘅補建工具名稱（唔可以得個結論冇下一步）',
    gas.FRESH_ENV_REQUIRED_COLUMNS.every(function (c) { return typeof c.tool === 'string' && c.tool.length > 0; }));
}

console.log('\n=== 迴歸：FreshEnvironmentCheck.gs 自己冇重蹈 tryWriteDiagnostics_() 嘅型別錯誤（見階段 C）===');
{
  check('★★ runFreshEnvironmentCheck_ 用 rows.length 計算行數，唔係將 tryWriteDiagnostics_() 嘅回傳值當行數用',
    /const written = rows\.length;/.test(freshEnvSource)
      && !/const written = tryWriteDiagnostics_/.test(freshEnvSource));
}

console.log('\n=== B1【核心】PublicLinks first-run 修正：讀取前一定先 ensurePublicLinksSheet_() ===');
{
  const findStart = publicRosterSource.indexOf('function findPublicLinkRow_');
  const findEnd = publicRosterSource.indexOf('\n}', findStart);
  const findBody = publicRosterSource.slice(findStart, findEnd);
  check('★★★ findPublicLinkRow_() 第一步就係 ensurePublicLinksSheet_()（唔會因為工作表未建過就拋錯）',
    /^function findPublicLinkRow_\([^)]*\)\s*\{\s*ensurePublicLinksSheet_\(\);/.test(findBody.replace(/\r\n/g, '\n')),
    findBody.slice(0, 120));

  const checkStart = publicRosterSource.indexOf('function checkPublicLinksSharing_');
  const checkEnd = publicRosterSource.indexOf('\n}', checkStart);
  const checkBody = publicRosterSource.slice(checkStart, checkEnd);
  check('★★★ checkPublicLinksSharing_() 讀取前一樣先 ensurePublicLinksSheet_()（同一個 first-run 修正）',
    /^function checkPublicLinksSharing_\(\)\s*\{\s*ensurePublicLinksSheet_\(\);/.test(checkBody.replace(/\r\n/g, '\n')),
    checkBody.slice(0, 120));
}

console.log('\n=== B3【核心】NameMapping.PersonalLinkToken first-run 修正：補發流程自動建欄，唔再拋錯要人手加 ===');
{
  check('★★★ 有 ensureNameMappingPersonalLinkTokenColumn_() 函式（append-only，唔覆寫現有內容）',
    /function ensureNameMappingPersonalLinkTokenColumn_\(\)/.test(personalLinkSource));
  check('★ ensureNameMappingPersonalLinkTokenColumn_() 已存在時直接回傳現有欄號，唔會重複新增',
    /if \(existingIndex !== -1\) return existingIndex \+ 1;/.test(personalLinkSource));

  const seedStart = personalLinkSource.indexOf('function seedPersonalLinkTokens_');
  const seedEnd = personalLinkSource.indexOf('\nfunction', seedStart + 1);
  const seedBody = personalLinkSource.slice(seedStart, seedEnd);
  check('★★★ seedPersonalLinkTokens_() 用 ensureNameMappingPersonalLinkTokenColumn_() 攞欄號（自動建欄），唔再係「搵唔到就拋錯」',
    /const tokenCol = ensureNameMappingPersonalLinkTokenColumn_\(\);/.test(seedBody));
  check('★ seedPersonalLinkTokens_() 唔再有舊版「請先在工作表手動新增」嘅拋錯文字',
    seedBody.indexOf('請先在工作表手動新增') === -1);

  check('★ 有新選單工具 runEnsureNameMappingTokenColumn_()（B3 要求嘅「補建 NameMapping 欄位」）',
    /function runEnsureNameMappingTokenColumn_\(\)/.test(personalLinkSource));
  check('★★ 新工具已登記喺 Menu.gs（唔係得個函式冇入口）',
    /runEnsureNameMappingTokenColumn_/.test(menuSource));
  check('★ 全新環境自我檢查亦已登記喺 Menu.gs',
    /runFreshEnvironmentCheck_/.test(menuSource));
}

console.log('\n=== B3：reissuePersonalLinkToken_（單一個人重新產生）刻意唔自動建欄，但錯誤訊息會指引去用「補發」===');
{
  const start = personalLinkSource.indexOf('function reissuePersonalLinkToken_');
  const end = personalLinkSource.indexOf('\nfunction', start + 1);
  const body = personalLinkSource.slice(start, end);
  check('★ 欄未存在時嘅錯誤訊息明確指引去用「補發個人專屬連結 token」（唔係淨係話「缺少欄」就完）',
    /補發個人專屬連結 token/.test(body));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
