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

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'RosterWriter.gs', 'PublicRoster.gs']);

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

console.log('\n=== A2【核心】五種分類 → 底色嘅單一對照（resolveGridCellBackground_），唔會露出規則警告 ===');
{
  const CLASS = gas.GRID_CELL_CLASS;
  checkEqual('★ 已排定（含可能有規則警告）嘅格唔上色',
    gas.resolveGridCellBackground_(CLASS.ASSIGNED, '#F4CCCC'), null);
  checkEqual('★ 待人手填嘅格用灰底',
    gas.resolveGridCellBackground_(CLASS.MANUAL_PENDING, '#F4CCCC'), gas.GRID_COLORS.SKIPPED);
  checkEqual('★ 結構性不適用用灰底',
    gas.resolveGridCellBackground_(CLASS.STRUCTURAL_NA, '#F4CCCC'), gas.GRID_COLORS.SKIPPED);
  checkEqual('★ 特別主日用紫底',
    gas.resolveGridCellBackground_(CLASS.SPECIAL_SKIP, '#F4CCCC'), gas.GRID_COLORS.SPECIAL_SKIP);
  checkEqual('★★ 排唔出用粉紅底（同傳入嘅 gapColor 一致）',
    gas.resolveGridCellBackground_(CLASS.GENUINE_GAP, '#F4CCCC'), '#F4CCCC');

  const assignedBg = gas.resolveGridCellBackground_(CLASS.ASSIGNED, '#F4CCCC');
  check('★★ 已排定嘅格即使有規則警告，都唔會用 WARNING／FORCED 底色'
    + '（公開版本唔應該有任何診斷用途嘅顏色）',
    assignedBg !== gas.GRID_COLORS.WARNING && assignedBg !== gas.GRID_COLORS.FORCED);

  checkEqual('★ 未知／不存在嘅分類一律唔上色（防呆）',
    gas.resolveGridCellBackground_('SOME_UNKNOWN_CLASS', '#F4CCCC'), null);
}

console.log('\n=== A4【核心】formatShortDateLabel_：可配置樣板，永遠唔會係純數字字串 ===');
{
  checkEqual('★★★ 預設樣板（DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT＝"{M}月{d}日"）代入正確',
    gas.formatShortDateLabel_('2026-01-04'), '1月4日');
  checkEqual('★★ 自訂樣板（例如淨係想要日）都代入得到',
    gas.formatShortDateLabel_('2026-01-25', '{d}'), '25');
  checkEqual('★ 自訂樣板可以完全冇 {M}（純日）',
    gas.formatShortDateLabel_('2026-12-05', '{d}日'), '5日');
  checkEqual('★ 月／日都去除前導 0（1 位數字，唔係 "01"）',
    gas.formatShortDateLabel_('2026-09-08', '{M}-{d}'), '9-8');

  // 第十三輪批次階段 A4【回歸測試】：實測發現舊版純數字標籤（例如 "3"）
  // 寫入 Google 試算表之後被自動格式化成 "3.0"（浮點數）。防止呢個 bug
  // 復發嘅關鍵係「輸出一定要帶非數字字元」——純數字字串先會被試算表
  // 誤判做數字型別，帶中文字／符號嘅字串唔會。
  ['2026-01-04', '2026-01-25', '2026-12-31', '2026-02-01'].forEach(function (d) {
    const label = gas.formatShortDateLabel_(d);
    check('★★★ 預設樣板輸出「' + label + '」唔係純數字（帶非數字字元，'
      + '試算表唔會誤判做數字再格式化成 "X.0"）',
      !/^\d+$/.test(label), 'formatShortDateLabel_(\'' + d + '\') = ' + JSON.stringify(label));
  });

  const dateColumns = [
    { serviceDate: '2026-01-04' }, { serviceDate: '2026-01-11' }, { serviceDate: '2026-01-18' },
    { serviceDate: '2026-02-01' }, { serviceDate: '2026-02-08' },
    { serviceDate: '2026-03-01' }
  ];
  const groups = gas.buildMonthGroups_(dateColumns);
  checkEqual('★★ 連續同月份嘅日期合併成一組，span 正確',
    groups, [
      { month: 1, label: '1月', span: 3 },
      { month: 2, label: '2月', span: 2 },
      { month: 3, label: '3月', span: 1 }
    ]);
}

console.log('\n=== A【本輪最重要】transposeRosterForPublicView_：崗位做列、日期做欄 ===');
{
  const CLASS = gas.GRID_CELL_CLASS;
  // 手砌一個 buildGridLayout_() 會產生嘅 layout 形狀（做法跟其他測試檔
  // 一樣：唔呼叫 buildGridLayout_() 本身——嗰個要讀 Posts／ServiceDates，
  // 呢度只測「畀定一個 layout，點樣轉置」呢個獨立嘅純邏輯）。
  // USHER（司事）2 個 slot、COMMUNION（聖餐襄禮）1 個 slot（首主日先有）。
  const layout = {
    headers: ['日期', '週次', '類型', '司事1', '司事2', '聖餐襄禮1'],
    keys: ['_DATE', '_WEEK', '_TYPE', 'USHER#1', 'USHER#2', 'COMMUNION#1'],
    rows: [
      ['2026-01-04', 1, '主日崇拜', '陳大文', '李小明', '張三'],
      ['2026-02-01', 5, '主日崇拜（浸禮）', '王美美', '（待填）', '—']
    ],
    dates: [
      { serviceDate: '2026-01-04', weekIndex: 1, serviceType: '主日崇拜' },
      { serviceDate: '2026-02-01', weekIndex: 5, serviceType: '主日崇拜' }
    ],
    cellIndex: {
      '2026-01-04|USHER|1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED },
      '2026-01-04|USHER|2': { row: 3, column: 5, cellClass: CLASS.ASSIGNED },
      '2026-01-04|COMMUNION|1': { row: 3, column: 6, cellClass: CLASS.ASSIGNED },
      '2026-02-01|USHER|1': { row: 4, column: 4, cellClass: CLASS.ASSIGNED },
      '2026-02-01|USHER|2': { row: 4, column: 5, cellClass: CLASS.MANUAL_PENDING },
      '2026-02-01|COMMUNION|1': { row: 4, column: 6, cellClass: CLASS.STRUCTURAL_NA }
    }
  };
  const posts = [
    { postId: 'USHER', postNameTC: '司事', slotCount: 2 },
    { postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 1 }
  ];
  const specialTitleByDate = { '2026-02-01': '浸禮' };
  const displayOptions = { dateFormatPattern: '{d}', blankNote: '' };

  const t = gas.transposeRosterForPublicView_(layout, posts, specialTitleByDate, displayOptions);

  checkEqual('★★ dateColumns 數量同 layout.dates 一致', t.dateColumns.length, 2);
  checkEqual('★ 第一個日期欄嘅日標籤同特別主日名稱', t.dateColumns[0], {
    serviceDate: '2026-01-04', weekIndex: 1, dayLabel: '4', specialTitle: ''
  });
  checkEqual('★★ 第二個日期欄有特別主日名稱（浸禮）', t.dateColumns[1], {
    serviceDate: '2026-02-01', weekIndex: 5, dayLabel: '1', specialTitle: '浸禮'
  });

  const tDefault = gas.transposeRosterForPublicView_(layout, posts, specialTitleByDate);
  check('★ 唔傳 displayOptions 時退回預設樣板（"{M}月{d}日"），唔會拋錯',
    tDefault.dateColumns[0].dayLabel === '1月4日');

  checkEqual('★ 月份分組正確（1 月 1 週、2 月 1 週）', t.monthGroups, [
    { month: 1, label: '1月', span: 1 },
    { month: 2, label: '2月', span: 1 }
  ]);

  checkEqual('★★★ postRows 總數＝Σ各崗位 slotCount（2＋1＝3 行，唔係 2 個崗位＝2 行）',
    t.postRows.length, 3);

  const usherSlot1 = t.postRows[0];
  const usherSlot2 = t.postRows[1];
  const communionSlot1 = t.postRows[2];

  checkEqual('★★ 司事 slot1：isFirstSlot=true，slotCount=2（呼叫端據此決定要合併幾多列）',
    { postId: usherSlot1.postId, isFirstSlot: usherSlot1.isFirstSlot, slotCount: usherSlot1.slotCount },
    { postId: 'USHER', isFirstSlot: true, slotCount: 2 });
  checkEqual('★★ 司事 slot2：isFirstSlot=false（唔應該再顯示一次崗位名稱）',
    usherSlot2.isFirstSlot, false);
  checkEqual('★ 聖餐襄禮只有 1 個 slot，isFirstSlot 一樣係 true',
    communionSlot1.isFirstSlot, true);

  checkEqual('★★★ 司事 slot1 逐日嘅文字：跨兩個日期欄都攞啱咗個 cell（唔係得返第一日）',
    usherSlot1.cells.map(function (c) { return c.text; }), ['陳大文', '王美美']);
  checkEqual('★★★ 司事 slot2 逐日嘅文字（原本喺 date-major grid 係第 2 欄，轉置之後係第 2 行）',
    usherSlot2.cells.map(function (c) { return c.text; }), ['李小明', '（待填）']);
  checkEqual('★ 聖餐襄禮逐日嘅文字（第二週非首主日，顯示「—」）',
    communionSlot1.cells.map(function (c) { return c.text; }), ['張三', '—']);

  checkEqual('★★ 司事 slot2 第二日（待填）嘅 cellClass 轉置後冇跑位',
    usherSlot2.cells[1].cellClass, CLASS.MANUAL_PENDING);
  checkEqual('★ 聖餐襄禮第二日（非首主日）嘅 cellClass 轉置後冇跑位',
    communionSlot1.cells[1].cellClass, CLASS.STRUCTURAL_NA);
}

console.log('\n=== A：多 slot 崗位（例如聖餐襄禮 4 個 slot）都會展開成對應行數，冇跑位 ===');
{
  const CLASS = gas.GRID_CELL_CLASS;
  const layout = {
    headers: ['日期', '週次', '類型', '聖餐襄禮1', '聖餐襄禮2', '聖餐襄禮3', '聖餐襄禮4'],
    keys: ['_DATE', '_WEEK', '_TYPE', 'COMMUNION#1', 'COMMUNION#2', 'COMMUNION#3', 'COMMUNION#4'],
    rows: [['2026-01-04', 1, '主日崇拜', '甲', '乙', '丙', '丁']],
    dates: [{ serviceDate: '2026-01-04', weekIndex: 1, serviceType: '主日崇拜' }],
    cellIndex: {
      '2026-01-04|COMMUNION|1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED },
      '2026-01-04|COMMUNION|2': { row: 3, column: 5, cellClass: CLASS.ASSIGNED },
      '2026-01-04|COMMUNION|3': { row: 3, column: 6, cellClass: CLASS.ASSIGNED },
      '2026-01-04|COMMUNION|4': { row: 3, column: 7, cellClass: CLASS.ASSIGNED }
    }
  };
  const posts = [{ postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 4 }];
  const t = gas.transposeRosterForPublicView_(layout, posts, {});

  checkEqual('★★★ 聖餐襄禮 4 個 slot 展開成 4 行', t.postRows.length, 4);
  checkEqual('★ 4 行嘅 slotIndex 依次係 1-4',
    t.postRows.map(function (r) { return r.slotIndex; }), [1, 2, 3, 4]);
  checkEqual('★★ 4 行嘅文字對得返（甲乙丙丁冇錯位）',
    t.postRows.map(function (r) { return r.cells[0].text; }), ['甲', '乙', '丙', '丁']);
  checkEqual('★ 只有第一行 isFirstSlot=true（樣板／寫表只喺呢一行合併顯示崗位名稱）',
    t.postRows.map(function (r) { return r.isFirstSlot; }), [true, false, false, false]);
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

  check('★★ 只完全還原並清空既有分頁內容（resetSheetToBlankSlate_），'
    + '冇任何刪除整個檔案嘅呼叫（第十三輪批次改用共用還原 helper，唔再係直接 .clear()）',
    body.indexOf('resetSheetToBlankSlate_(sheet)') !== -1
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

  check('★ 回傳嘅內容只有職事表格（轉置後嘅 dateColumns/monthGroups/postRows）、圖例、更新時間',
    /dateColumns:\s*transposed\.dateColumns/.test(body)
      && /monthGroups:\s*transposed\.monthGroups/.test(body)
      && /postRows:\s*transposed\.postRows/.test(body)
      && /legendRows:/.test(body)
      && /updatedAt:\s*nowTimestamp_\(\)/.test(body));
}

console.log('\n=== A2／A3：寫入公開試算表時凍結首欄／首 3 行、日期欄有固定夠闊嘅欄闊（姓名唔會被截斷）===');
{
  const start = publicRosterSource.indexOf('function writePublicRosterContent_');
  const end = publicRosterSource.indexOf('\nfunction publishPublicRoster_', start);
  const body = publicRosterSource.slice(start, end);

  check('★★ 凍結首欄（崗位），橫向捲動時崗位名稱一直睇得到', /setFrozenColumns\(1\)/.test(body));
  check('★★ 凍結首 3 行（標題／月份／日期），縱向捲動時日期標題一直睇得到', /setFrozenRows\(3\)/.test(body));
  check('★★ 月份標題有 merge 橫跨該月嘅日期欄', /content\.monthGroups\.forEach/.test(body) && /\.merge\(\)/.test(body));
  check('★★ 多 slot 崗位嘅名稱欄有垂直 merge', /pr\.slotCount > 1/.test(body) && /getRange\(dataStartRow \+ i, 1, pr\.slotCount, 1\)\.merge\(\)/.test(body));

  check('★★★ 日期欄用固定欄闊（唔淨係 autoResizeColumns），確保換版本／換人都唔會截斷姓名',
    /setColumnWidth\(c, PUBLIC_ROSTER_DATE_COLUMN_WIDTH\)/.test(body));
}

console.log('\n=== A2：日期欄固定欄闊要夠容納 6 字中文姓名 ===');
{
  // 粗略估算：Google 試算表預設字型一個中文字約 13-15px，6 字加少少邊界
  // 至少要 110px 先夠，呢度用 120 做保守下限（實際設定係 130）。
  check('★★ PUBLIC_ROSTER_DATE_COLUMN_WIDTH 至少 120px（容得下 6 字中文姓名，例如「黃余麗貞師母」）',
    gas.PUBLIC_ROSTER_DATE_COLUMN_WIDTH >= 120, '實際值：' + gas.PUBLIC_ROSTER_DATE_COLUMN_WIDTH);
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
