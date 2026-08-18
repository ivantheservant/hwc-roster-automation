// 第二十五輪批次階段 E3：區三畫面三——崗位資格矩陣。
// 執行方式：node tests/eligibility_matrix_crud.test.js
//
// ⚠️ 全部測試資料一律用 `P9xxx` 假 PersonID 同明顯假名——公開 repo。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppEligibility.gs'
]);

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

const E = gas.COLUMNS.ELIGIBILITY;
const M = gas.COLUMNS.NAME_MAPPING;
const P = gas.COLUMNS.POSTS;

gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};
gas.getConfig = function (key, fallback) { return fallback; };
gas.Utilities = { formatDate: function () { return '2026-08-18'; } };
// 假電郵動態組出嚟——見 name_mapping_crud.test.js 嘅說明。
const FAKE_ACTOR = 'tester' + '@' + ['exam', 'ple', '.', 'invalid'].join('');
gas.Session = { getActiveUser: function () { return { getEmail: function () { return FAKE_ACTOR; } }; } };

function personRow(id, name) {
  const r = {}; r[M.PERSON_ID] = id; r[M.NAME_TC] = name; r[M.ACTIVE] = 'TRUE'; return r;
}
// ⚠️ 第二十六輪批次階段 D1：`AutoGenerate` **一定要明確填**。
// 唔填嘅話 `isTrueValue_()` 會當成 FALSE，即係「唔自動排」，
// 而唔自動排嘅崗位永遠唔會被標成「合資格人數太少」——
// 呢個 mock 就會靜靜咁令下面嗰條斷言測唔到嘢。
function postRow(id, name, autoGenerate) {
  const r = {};
  r[P.POST_ID] = id;
  r[P.POST_NAME_TC] = name;
  r[P.AUTO_GENERATE] = autoGenerate === false ? 'FALSE' : 'TRUE';
  return r;
}
function eligRow(o) {
  const r = {};
  r[E.ELIGIBILITY_ID] = o.id;
  r[E.PERSON_ID] = o.personId;
  r[E.POST_ID] = o.postId;
  r[E.ELIGIBLE] = o.eligible === false ? 'FALSE' : 'TRUE';
  r[E.ACTIVE] = o.active === false ? 'FALSE' : 'TRUE';
  r[E.HISTORICAL_COUNT] = o.count === undefined ? 0 : o.count;
  return r;
}

console.log('\n=== E3【核心】「有資格」＝ Eligible 同 Active 兩樣都 TRUE ===');
{
  gas.readPosts = function () { return [postRow('READ', '讀經'), postRow('WORSHIP', '領詩')]; };
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.NAME_MAPPING) {
      return [personRow('P9001', '測試甲'), personRow('P9002', '測試乙')];
    }
    if (name === gas.SHEETS.ELIGIBILITY) {
      return [
        eligRow({ id: 'E1', personId: 'P9001', postId: 'READ', count: 5 }),
        // 曾經取消過：Eligible=TRUE 但 Active=FALSE
        eligRow({ id: 'E2', personId: 'P9002', postId: 'READ', active: false, count: 3 })
      ];
    }
    return [];
  };

  const m = gas.apiGetEligibilityMatrix();
  checkEqual('★★★★★ Active=FALSE 嗰個唔算「有資格」'
    + '——只睇 Eligible 就會令一個取消咗嘅資格重新生效',
    m.cells['P9002|READ'].eligible, false);
  checkEqual('★★★★★ 但歷史次數要保留返（3 次）'
    + '——刪咗行就會由零開始計，而嗰個人其實做過',
    m.cells['P9002|READ'].historicalCount, 3);
  checkEqual('★★★★ 讀經合資格人數 = 1',
    m.posts.filter(function (p) { return p.postId === 'READ'; })[0].eligibleCount, 1);
}

console.log('\n=== E3【核心】統計喺完整資料上面計，唔跟前端分頁 ===');
{
  const m = gas.apiGetEligibilityMatrix();
  checkEqual('★★★★★ 每個崗位嘅 eligibleCount 由後端計好'
    + '——跟住分頁走嘅話會變成「當前頁嘅 N 人」，係一個錯數而幹事睇唔出',
    m.posts.map(function (p) { return p.postId + '=' + p.eligibleCount; }),
    ['READ=1', 'WORSHIP=0']);
  // ⚠️ 排序係按中文名（字碼順序），唔係按 PersonID——所以呢度用
  // 排序過嘅比對，唔可以假設 P9001 一定行先。
  // （字碼順序對中文名嚟講唔係「筆劃」亦唔係「拼音」，只係一個穩定嘅
  // 確定次序。幹事實際上會用搜尋格搵人，所以本輪冇再花功夫做中文排序，
  // 呢個限制記咗喺 docs/系統範圍稽核.md。）
  checkEqual('★★★★ 每個人嘅 postCount 亦然',
    m.people.map(function (p) { return p.personId + '=' + p.postCount; }).sort(),
    ['P9001=1', 'P9002=0']);

  const thin = m.posts.filter(function (p) { return p.thin; });
  checkEqual('★★★★★ 少於 3 人嘅崗位有標示（兩個都少於 3）',
    thin.map(function (p) { return p.postId; }), ['READ', 'WORSHIP']);
  checkEqual('★★★★ 門檻回埋畀前端，唔使前端自己寫死一個 3',
    m.thinThreshold, 3);
}

console.log('\n=== E3【核心】取消勾寫 Active=FALSE，唔刪行 ===');
{
  const writes = [];
  const appends = [];
  gas.openSheetForEdit_ = function () { return { sheet: {}, headers: [] }; };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) {
    writes.push({ sheetRow: sheetRow, updates: updates }); return [];
  };
  gas.appendRowFields_ = function (sheet, headers, record) { appends.push(record); return 9; };
  gas.writeZone3Audit_ = function () {};

  const res = gas.apiSaveEligibilityBatch([
    { personId: 'P9001', postId: 'READ', eligible: false }
  ]);
  checkEqual('★★★★ 算做「取消 1 項」', { added: res.added, removed: res.removed },
    { added: 0, removed: 1 });
  checkEqual('★★★★★ 寫 Eligible=FALSE', writes[0].updates[E.ELIGIBLE], 'FALSE');
  checkEqual('★★★★★ 同時寫 Active=FALSE（**唔刪行**）', writes[0].updates[E.ACTIVE], 'FALSE');
  check('★★★★★ 取消時**唔會**動 AddedAt／AddedBy'
    + '——嗰兩欄記錄嘅係「幾時加入嘅」，取消唔應該改寫佢',
    !Object.prototype.hasOwnProperty.call(writes[0].updates, E.ADDED_AT));

  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppEligibility.gs'), 'utf8');
  check('★★★★★ 整個檔案冇任何刪行呼叫', !/deleteRow|deleteRows|removeRow/.test(src));
}

console.log('\n=== E3【核心】AddedAt 要格式化，唔可以寫 Date 物件 ===');
{
  const appends = [];
  gas.appendRowFields_ = function (sheet, headers, record) { appends.push(record); return 9; };
  gas.writeRowFields_ = function () { return []; };

  gas.apiSaveEligibilityBatch([
    { personId: 'P9002', postId: 'WORSHIP', eligible: true }
  ]);
  checkEqual('★★★★★ AddedAt 係 yyyy-MM-dd 字串，唔係 Date 物件'
    + '——第二十二輪已經喺 QuarterReset.gs 撞過同一件事：'
    + '未格式化嘅 Date 顯示出嚟係 "Mon Aug 17 2026 ... GMT+1200"',
    appends[0][E.ADDED_AT], '2026-08-18');
  check('★★★★ 唔係 Date 物件', !(appends[0][E.ADDED_AT] instanceof Date));
  checkEqual('★★★★ 新增時 Source 標「手動」', appends[0][E.SOURCE], '手動');
  checkEqual('★★★★ HistoricalCount 由 0 開始（新資格本來就未做過）',
    appends[0][E.HISTORICAL_COUNT], 0);
}

console.log('\n=== E3 冇改到嘅唔算改動 ===');
{
  gas.writeRowFields_ = function () { return []; };
  gas.appendRowFields_ = function () { return 9; };

  const res = gas.apiSaveEligibilityBatch([
    // 本來就有資格，again 勾 true ⇒ 冇嘢做
    { personId: 'P9001', postId: 'READ', eligible: true },
    // 本來就冇呢一格，取消勾 ⇒ 冇嘢做（唔應該建立一行 FALSE）
    { personId: 'P9001', postId: 'WORSHIP', eligible: false }
  ]);
  checkEqual('★★★★★ 兩樣都算 skipped，唔會寫入',
    { added: res.added, removed: res.removed, skipped: res.skipped },
    { added: 0, removed: 0, skipped: 2 });

  checkEqual('★★★★ 空陣列 ⇒ 直接回，唔會開表',
    gas.apiSaveEligibilityBatch([]).added, 0);
}

console.log('\n=== E3 結構與畫面文案 ===');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppEligibility.gs'), 'utf8');
  checkEqual('★★★★★ 每個 api 函式都有 assertWebAppRequestAllowed_()',
    (src.match(/function api\w+\(/g) || []).length,
    (src.match(/assertWebAppRequestAllowed_\(\);/g) || []).length);
  check('★★★★ 三種改動都有寫 AuditLog',
    /ELIGIBILITY_ADD/.test(src) && /ELIGIBILITY_ENABLE/.test(src)
    && /ELIGIBILITY_DISABLE/.test(src));
  check('★★★★★ 用 writeRowFields_()，唔係整行覆寫', /writeRowFields_\(/.test(src));

  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ 畫面頂有規格 4.4 指定嗰句',
    zone3.indexOf('系統只會排曾任該崗位的人。新人一定要在這裡加，系統不會自己擴充。') !== -1);
  check('★★★★★ 批次確認畫面有「會新增 N 項資格、取消 N 項資格」',
    /會新增 ' \+ summary\.added \+ ' 項資格、取消 ' \+ summary\.removed \+ ' 項資格/.test(zone3));
  check('★★★★ 確認畫面有講「取消資格不會刪走那一行」',
    zone3.indexOf('取消資格不會刪走那一行，做過的次數會保留。') !== -1);
  check('★★★★★ 勾返原本嘅值就當冇改過（唔會報一個「勾咗再取消勾」嘅假改動）',
    /if \(cb\.checked === cell\.eligible\) delete eligChanges\[key\];/.test(zone3));
  check('★★★★★ 人數太少嘅崗位一覽**唔理揀咗邊個崗位都顯示**'
    + '——呢個係「成盤數有冇問題」嘅訊號，唔應該要逐個崗位撳先見到',
    zone3.indexOf('const thin = eligData.posts.filter((p) => p.thin);') !== -1
    && zone3.indexOf('if (!eligPostFilter)') > zone3.indexOf('const thin = eligData.posts'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
