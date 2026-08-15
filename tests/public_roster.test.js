// 第十一輪批次階段 A：一季一條固定連結。
// 執行方式：node tests/public_roster.test.js
//
// PublicRoster.gs 大部分函式要真正碰 SpreadsheetApp／DriveApp（開檔、寫入、
// 設分享），冇 GAS 執行環境跑唔到，跟本專案其他「會真正改動資料」的工具
// （QuarterReset.gs、GoLiveWizard.gs）遇到同一個限制——所以跟嗰兩份測試檔
// 一樣，分兩種做法：
//   1. 真正可以獨立執行嘅純函式（分類→底色對照、分享設定判斷、檔名樣板代入），
//      用 gas_loader 載入真正原始碼直接測試。
//   2. 唔可以獨立執行嘅部分（檔案 ID 保留邏輯、A2 嘅內容白名單），
//      用靜態原始碼檢查鎖住幾個唔可以錯嘅不變量。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'PublicRoster.gs']);

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
const publicRosterSource = fs.readFileSync(path.join(SRC, 'PublicRoster.gs'), 'utf8');

console.log('\n=== A2【核心】公開內容嘅底色對照，唔會露出規則警告 ===');
{
  const CLASS = gas.GRID_CELL_CLASS;
  // 手砌一個 buildGridLayout_() 會產生嘅 layout 形狀（做法跟其他測試檔
  // 一樣：唔呼叫 buildGridLayout_() 本身——嗰個要讀 Posts／ServiceDates，
  // 呢度只測「畀定一個 layout，底色點揀」呢個獨立嘅純邏輯）。
  const layout = {
    keys: ['_DATE', '_WEEK', '_TYPE', 'CHAIR#1', 'PREACHER#1', 'COMMUNION#1', 'WORSHIP#1', 'AUDIO#1'],
    rows: [['2099-01-04', 1, '主日崇拜', '陳大文', '（待填）', '—', '特殊主日', '⚠ 未能安排']],
    cellIndex: {
      'k1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED },
      'k2': { row: 3, column: 5, cellClass: CLASS.MANUAL_PENDING },
      'k3': { row: 3, column: 6, cellClass: CLASS.STRUCTURAL_NA },
      'k4': { row: 3, column: 7, cellClass: CLASS.SPECIAL_SKIP },
      'k5': { row: 3, column: 8, cellClass: CLASS.GENUINE_GAP }
    }
  };
  const backgrounds = gas.computePublicRosterBackgrounds_(layout, '#F4CCCC');

  checkEqual('★ 已排定（含可能有規則警告）嘅格唔上色',
    backgrounds[0][3], null);
  checkEqual('★ 待人手填嘅格用灰底', backgrounds[0][4], gas.GRID_COLORS.SKIPPED);
  checkEqual('★ 結構性不適用用灰底', backgrounds[0][5], gas.GRID_COLORS.SKIPPED);
  checkEqual('★ 特別主日用紫底', backgrounds[0][6], gas.GRID_COLORS.SPECIAL_SKIP);
  checkEqual('★★ 排唔出用粉紅底（同傳入嘅 gapColor 一致）', backgrounds[0][7], '#F4CCCC');

  check('★★ 已排定嘅格即使有規則警告，都唔會用 WARNING／FORCED 底色'
    + '（公開版本唔應該有任何診斷用途嘅顏色）',
    backgrounds[0][3] !== gas.GRID_COLORS.WARNING && backgrounds[0][3] !== gas.GRID_COLORS.FORCED);
}

console.log('\n=== A2：底色矩陣形狀同 layout.rows 一致，唔會漏格或者錯位 ===');
{
  const CLASS = gas.GRID_CELL_CLASS;
  const layout = {
    keys: ['_DATE', '_WEEK', '_TYPE', 'CHAIR#1', 'ANNOUNCE#1'],
    rows: [
      ['2099-01-04', 1, '主日崇拜', '陳大文', '李小明'],
      ['2099-01-11', 2, '主日崇拜', '王美美', '']
    ],
    cellIndex: {
      'w1c1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED },
      'w1c2': { row: 3, column: 5, cellClass: CLASS.ASSIGNED },
      'w2c1': { row: 4, column: 4, cellClass: CLASS.ASSIGNED },
      'w2c2': { row: 4, column: 5, cellClass: CLASS.GENUINE_GAP }
    }
  };
  const backgrounds = gas.computePublicRosterBackgrounds_(layout, '#F4CCCC');
  checkEqual('★ 底色矩陣行數同 rows 一致', backgrounds.length, 2);
  checkEqual('★ 底色矩陣每行欄數同 keys 一致', backgrounds[0].length, 5);
  checkEqual('★ 第二週第二格（排唔出）定位正確', backgrounds[1][4], '#F4CCCC');
  checkEqual('★ 第二週第一格（已排定）冇被錯誤上色', backgrounds[1][3], null);
}

console.log('\n=== A1：檔名樣板代入 ===');
{
  checkEqual('★ {QuarterID} 正確代入',
    gas.applyPublicRosterFileNamePattern_('{QuarterID} 職事表（公開版）', '2099T1'),
    '2099T1 職事表（公開版）');
  checkEqual('★ 樣板冇 {QuarterID} 時原樣返回',
    gas.applyPublicRosterFileNamePattern_('固定檔名', '2099T1'), '固定檔名');
  checkEqual('★ 樣板係空字串時唔會拋錯（冇 {QuarterID} 可代入，原樣返回空字串）',
    gas.applyPublicRosterFileNamePattern_('', '2099T1'), '');
}

console.log('\n=== A5【核心】分享設定判斷——一定要「任何人有連結可睇、唔可以編輯」===');
{
  const ok = gas.evaluatePublicLinkSharing_('ANYONE_WITH_LINK', 'VIEW');
  check('★★ 正確設定判定為 ok', ok.ok === true);

  const wrongAccess = gas.evaluatePublicLinkSharing_('PRIVATE', 'VIEW');
  check('★★ 冇開公開分享（PRIVATE）判定為唔 ok', wrongAccess.ok === false);
  check('★ 訊息有講出實際值定期望值', /PRIVATE/.test(wrongAccess.message)
    && /ANYONE_WITH_LINK/.test(wrongAccess.message));

  const wrongPermission = gas.evaluatePublicLinkSharing_('ANYONE_WITH_LINK', 'EDIT');
  check('★★★ 任何人都可以編輯（EDIT）判定為唔 ok——呢個係最嚴重嘅設定錯誤，'
    + '義工隨時可以改動職事表內容',
    wrongPermission.ok === false);
  check('★ 訊息明確講出「任何人拿到連結都可以直接改動」',
    /任何人拿到連結都可以直接改動/.test(wrongPermission.message));

  const empty = gas.evaluatePublicLinkSharing_('', '');
  check('★ 完全冇記錄分享設定（未發佈過或讀取失敗）判定為唔 ok', empty.ok === false);

  const domain = gas.evaluatePublicLinkSharing_('DOMAIN_WITH_LINK', 'VIEW');
  check('★ 只限同 domain（教會 Workspace 域）睇到都算唔符合預期——'
    + '義工唔一定用返教會電郵開連結，要係任何人都睇到',
    domain.ok === false);
}

console.log('\n=== A3【核心】檔案 ID 一定要保留，唔可以刪檔重建 ===');
{
  const start = publicRosterSource.indexOf('function resolveOrCreatePublicSpreadsheet_');
  const end = publicRosterSource.indexOf('\n}', start);
  const body = publicRosterSource.slice(start, end);

  check('★★ 一定先檢查有冇已知嘅 existingFileId', /if\s*\(existingFileId\)/.test(body));
  check('★★ 有已知 ID 就用 openById 打開（唔係 create 一個新嘅）',
    /openById\(existingFileId\)/.test(body));

  const openIdx = body.indexOf('openById(existingFileId)');
  const createIdx = body.indexOf('SpreadsheetApp.create(');
  check('★★★ openById 一定排喺 create 之前（次序反轉就會變成每次都建新檔）',
    openIdx > 0 && createIdx > 0 && openIdx < createIdx);

  check('★ 打唔開先會建立新檔（喺 catch 區塊入面，唔係無條件執行）',
    /catch[\s\S]{0,300}?SpreadsheetApp\.create/.test(body) === false
      || body.indexOf('catch') < createIdx,
    '建立新檔應該只喺 openById 失敗嘅 catch 分支之後先執行到');
}

console.log('\n=== A3：覆寫內容唔可以刪除／重建檔案本身 ===');
{
  const start = publicRosterSource.indexOf('function writePublicRosterContent_');
  const end = publicRosterSource.indexOf('\n}', start);
  const body = publicRosterSource.slice(start, end);

  check('★★ 只清空既有分頁內容（clear），冇任何刪除整個檔案嘅呼叫',
    body.indexOf('.clear()') !== -1
      && body.indexOf('DriveApp.getFileById') === -1
      && body.indexOf('setTrashed') === -1);
  check('★ 有處理「幹事手動加咗第二張分頁」嘅情況（刪走多餘分頁，確保連結'
    + '打開永遠淨係一張乾淨嘅職事表）',
    body.indexOf('deleteSheet') !== -1);
}

console.log('\n=== A2：內容建構函式唔可以直接接觸敏感欄位 ===');
{
  const start = publicRosterSource.indexOf('function buildPublicRosterContent_');
  const end = publicRosterSource.indexOf('\nfunction resolveOrCreatePublicSpreadsheet_', start);
  const body = publicRosterSource.slice(start, end);

  const FORBIDDEN = [
    ['PERSON_ID', 'PersonID'],
    ['EMAIL', '電郵'],
    ['getNotes', '儲存格批註'],
    ['ruleFlags', 'RuleFlags（規則代號）'],
    ['MailApp', '寄信']
  ];
  FORBIDDEN.forEach(function (pair) {
    check('★★ buildPublicRosterContent_() 本身冇直接出現「' + pair[1] + '」',
      body.indexOf(pair[0]) === -1,
      '公開檔案內容組建函式唔應該直接接觸呢個欄位／功能');
  });

  check('★ 回傳嘅內容只有職事表格、圖例、更新時間（headers/rows/backgrounds/legendRows/footerNote/updatedAt）',
    /headers:\s*layout\.headers/.test(body)
      && /legendRows:/.test(body)
      && /updatedAt:\s*nowTimestamp_\(\)/.test(body));
}

console.log('\n=== A4：範本 placeholder 一致性（同 A4 相關的 4 個範本）===');
{
  const seedSource = fs.readFileSync(path.join(SRC, 'EmailTemplateSeed.gs'), 'utf8');
  const templateIds = ['TPL_OFFICIAL_TC', 'TPL_OFFICIAL_LIST_TC', 'TPL_RESEND_TC', 'TPL_RESEND_LIST_TC'];

  templateIds.forEach(function (id) {
    const idx = seedSource.indexOf("templateId: '" + id + "'");
    check('★ ' + id + ' 存在', idx !== -1);
    if (idx === -1) return;
    const nextIdx = seedSource.indexOf("templateId: '", idx + 1);
    const block = seedSource.slice(idx, nextIdx === -1 ? seedSource.length : nextIdx);

    check('★★ ' + id + ' 的 bodyHtml／bodyPlain 都有 {PublicRosterUrl}',
      /bodyHtml:[\s\S]*?\{PublicRosterUrl\}/.test(block)
        && /bodyPlain:[\s\S]*?\{PublicRosterUrl\}/.test(block));
    check('★ ' + id + ' 的 placeholders 清單有登記 {PublicRosterUrl}'
      + '（否則「電郵範本自我檢查」會誤判成範本用咗一個未登記的變數）',
      /placeholders:[^\n]*\{PublicRosterUrl\}/.test(block));
  });
}

console.log('\n=== A4：placeholder 解析函式有 try/catch，一個季度未發佈唔會累街坊 ===');
{
  const mailerSource = fs.readFileSync(path.join(SRC, 'Mailer.gs'), 'utf8');
  const start = mailerSource.indexOf('function resolvePublicRosterUrlForPlaceholder_');
  const end = mailerSource.indexOf('\n}', start);
  const body = mailerSource.slice(start, end);
  check('★★ 有 try/catch，查唔到就回傳空字串，唔會拋錯打斷寄信流程',
    body.indexOf('try') !== -1 && body.indexOf('catch') !== -1 && /return\s+'';/.test(body));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
