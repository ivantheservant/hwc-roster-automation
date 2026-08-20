// 第三十四輪批次乙組：「不能服侍的日期」畫面三項。
// 執行方式：node tests/unavailable_cancel_and_scope.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 三項係同一個成因：**顯示層同資料層各有一套「什麼算生效」。**
// ═════════════════════════════════════════════════════════════════════
//
// 乙1　「適用於＝全部崗位」時，崗位勾選仍然撳得到但會被靜靜忽略。
//      成因唔喺 JS——`postBox.hidden = true` 一直都有寫，
//      但 `.prop-opts { display: flex }`（class 選擇器）蓋過咗瀏覽器嘅
//      `[hidden] { display: none }`（UA stylesheet），所以**完全冇收起過**。
//
// 乙2　`apiSaveUnavailable()` 一直支援 `active: false` ⇒ 寫 CANCELLED，
//      但畫面冇任何方法送 `false` 出去——後端有能力，介面上到唔到。
//
// 乙3　列表完全冇睇 `Status`，`CANCELLED` 照樣列喺「生效中」。
//      而排表引擎（`readUnavailableNormalized()`）係啱嘅。
//      ⚠️ **危險嘅方向**：幹事會以為一條已經取消嘅限制仍然生效。
//
// 呢份測試最重要嗰一條係最後嗰個：**引擎讀到嘅生效筆數，
// 一定要等於畫面「生效中」嗰個數。** 兩層用同一個判斷函式。

const { loadGasSource } = require('./helpers/gas_loader');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic');
const fs = require('fs');
const path = require('path');

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

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'PersonPostWeight.gs',
  'Generator.gs', 'FineTune.gs', 'StateSource.gs',
  'RosterWriter.gs', 'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppUnavailable.gs'
]);

const Q = '2027T3';
const TZ = 'Pacific/Auckland';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'yi-test@example.invalid'; } }; } };
gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    if (fmt === 'yyyy-MM-dd HH:mm:ss') {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
      const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(date);
      return d + ' ' + t;
    }
    return date.toISOString();
  },
  getUuid: function () { return 'uuid-' + Math.abs(Date.now() % 1000000); },
  sleep: function () {}
};
gas.log_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};

function buildFixture() {
  const C = gas.COLUMNS;
  const S = gas.SHEETS;

  seedSheet(ss, S.CONFIG, ['Key', 'Value', 'Type'],
    [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
      { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }
    ]);

  seedSheet(ss, S.QUARTERS, ['季度'],
    [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
      C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
      { [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 3,
        [C.QUARTERS.START_DATE]: '2027-07-04', [C.QUARTERS.END_DATE]: '2027-09-26',
        [C.QUARTERS.STAGE]: 'DRAFT' }
    ]);

  seedSheet(ss, S.SERVICE_DATES, ['主日'],
    [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID, C.SERVICE_DATES.SERVICE_DATE,
      C.SERVICE_DATES.WEEK_INDEX, C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    [0, 1, 2, 3].map(function (i) {
      const d = new Date(Date.UTC(2027, 6, 4 + i * 7));
      const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
      const s = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
      return { [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: s, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true };
    }));

  seedSheet(ss, S.POSTS, ['崗位'],
    [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT, C.POSTS.DISTINCT_WITHIN_POST,
      C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE, C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP,
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY],
    [['CHAIR', '主席'], ['READ', '讀經']].map(function (p, i) {
      return { [C.POSTS.POST_ID]: p[0], [C.POSTS.POST_NAME_TC]: p[1], [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'ALLOW', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: i + 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING' };
    }));

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.NAME_EN,
      C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE], [
      { [C.NAME_MAPPING.PERSON_ID]: 'P9401', [C.NAME_MAPPING.NAME_TC]: '測試甲01',
        [C.NAME_MAPPING.NAME_EN]: 'Test A01', [C.NAME_MAPPING.EMAIL]: 'a@example.invalid',
        [C.NAME_MAPPING.ACTIVE]: true },
      { [C.NAME_MAPPING.PERSON_ID]: 'P9402', [C.NAME_MAPPING.NAME_TC]: '測試甲02',
        [C.NAME_MAPPING.NAME_EN]: 'Test A02', [C.NAME_MAPPING.EMAIL]: 'b@example.invalid',
        [C.NAME_MAPPING.ACTIVE]: true }
    ]);

  ['ROSTER_VERSIONS', 'ROSTER_ASSIGNMENTS', 'AUDIT_LOG', 'ELIGIBILITY', 'RULE_SETTINGS'].forEach(function (key) {
    const cols = Object.keys(C[key]).map(function (k2) { return C[key][k2]; });
    seedSheet(ss, S[key], [key], cols, []);
  });

  seedSheet(ss, S.UNAVAILABLE, ['不可用'],
    [C.UNAVAILABLE.UNAVAILABLE_ID, C.UNAVAILABLE.PERSON_ID, C.UNAVAILABLE.DATE_FROM,
      C.UNAVAILABLE.DATE_TO, C.UNAVAILABLE.APPLIES_TO, C.UNAVAILABLE.POST_IDS,
      C.UNAVAILABLE.STATUS, C.UNAVAILABLE.REASON, C.UNAVAILABLE.SOURCE,
      C.UNAVAILABLE.CREATED_AT, C.UNAVAILABLE.CREATED_BY], []);
}

buildFixture();

/** 由畫面入口讀返個列表。 */
function listView() {
  return gas.apiListUnavailable(Q, '');
}
/** 排表引擎見到嘅生效筆數。 */
function engineActiveCount() {
  return gas.readUnavailableNormalized(TZ).length;
}

console.log('\n=== 乙3 前置：兩層對「生效」用同一個判斷函式 ===');
{
  check('★★★★★ `isUnavailableRowActive_()` 存在（唯一嘅判斷）',
    typeof gas.isUnavailableRowActive_ === 'function');

  const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppUnavailable.gs'), 'utf8');
  check('★★★★★ 畫面嗰邊叫佢——唔可以自己再寫一次 Status 比較',
    /isUnavailableRowActive_\(/.test(SRC), '（睇 apiListUnavailable）');
  const READER = fs.readFileSync(path.join(__dirname, '..', 'src', 'SheetReader.gs'), 'utf8');
  check('★★★★★ 引擎嗰邊都係叫佢', /\.filter\(isUnavailableRowActive_\)/.test(READER));

  // ⚠️ 只可以擋「**比較**」，唔可以連寫入都擋——
  // `apiSaveUnavailable()` 一定要寫得到 `STATUS_ACTIVE` 落去，
  // 嗰個係設定值，唔係第二份判斷。
  const bare = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 畫面嗰邊冇留低第二份「Status === ACTIVE」嘅**比較**'
    + '（留住就係兩個真相來源，而呢個 bug 本身就係噉嚟）',
    !/[=!]==\s*UNAVAILABLE_VALUES\.STATUS_ACTIVE/.test(bare)
    && !/UNAVAILABLE_VALUES\.STATUS_ACTIVE\s*[=!]==/.test(bare),
    bare.split('\n').filter(function (l) { return /STATUS_ACTIVE/.test(l); }).join(' / '));
}

console.log('\n=== 乙1：AppliesTo=ALL 一定要寫入空 PostIDs ===');
{
  const res = gas.apiSaveUnavailable({
    quarterId: Q, personId: 'P9401',
    dateFrom: '2027-07-11', dateTo: '2027-07-11',
    appliesTo: 'ALL',
    // 幹事勾咗「讀經」——AppliesTo=ALL 之下呢個勾冇意思。
    postIds: ['READ'],
    reason: '外遊'
  });
  check('★★★★ 儲存成功', res.ok === true, JSON.stringify(res));

  const U = gas.COLUMNS.UNAVAILABLE;
  const rows = gas.readSheet(gas.SHEETS.UNAVAILABLE);
  checkEqual('★★★★ 寫咗一行', rows.length, 1);
  checkEqual('★★★★★ AppliesTo ＝ ALL', String(rows[0][U.APPLIES_TO]), 'ALL');
  checkEqual('★★★★★ **PostIDs 一定係空**——ALL 之下嗰個勾唔應該留低任何痕跡，'
    + '留低就會變成「表上寫住讀經、但實際係全部崗位」嘅第二個真相來源',
    String(rows[0][U.POST_IDS] || ''), '');
}

console.log('\n=== 乙1：前端揀 ALL 嗰陣唔會送 postIds 上嚟，而且個勾撳唔到 ===');
{
  const UI = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ collect() 揀 ALL 時送空陣列'
    + '（送一份會被靜靜丟棄嘅資料上去，「先看影響」就會照住一份唔會生效嘅資料去算）',
    /appliesSel\.value === 'POSTS'[\s\S]{0,160}: \[\]/.test(UI));
  check('★★★★★ 除咗 hidden，仲會逐個 checkbox `disabled`'
    + '——CSS 嗰層日後再被蓋過嘅話，disabled 仍然令佢撳唔到而且明顯係灰色',
    /postInputs\.forEach\(\(cb\) => \{ cb\.disabled = off; \}\)/.test(UI));

  const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'Style.html'), 'utf8');
  check('★★★★★ Style.html 有一條總規則令 `[hidden]` 真係收起'
    + '——本來要逐個元件補（.zone-body／.modal-backdrop 已經補過兩次），'
    + '而唔記得補嘅代價就係一個「睇得見、撳得到、但會被靜靜忽略」嘅控制項',
    /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/.test(CSS));
}

console.log('\n=== 乙2：介面可以取消一筆（走 active:false 路徑）===');
{
  const U = gas.COLUMNS.UNAVAILABLE;
  const before = listView();
  checkEqual('★★★★ 取消之前：畫面「生效中」1 筆', before.current.length, 1);
  checkEqual('★★★★ 取消之前：引擎都係 1 筆', engineActiveCount(), 1);

  const id = before.current[0].unavailableId;
  const res = gas.apiSaveUnavailable({
    unavailableId: id, quarterId: Q, personId: 'P9401',
    dateFrom: '2027-07-11', dateTo: '2027-07-11',
    appliesTo: 'ALL', postIds: [], reason: '外遊',
    active: false
  });
  check('★★★★★ `active: false` 儲存成功', res.ok === true, JSON.stringify(res));

  const row = gas.readSheet(gas.SHEETS.UNAVAILABLE)[0];
  checkEqual('★★★★★ Status 寫成 CANCELLED（唔係刪走——一律停用不刪除）',
    String(row[U.STATUS]), gas.UNAVAILABLE_VALUES.STATUS_CANCELLED);

  const UI = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ 畫面有「取消這一筆」掣（修正之前後端有能力，介面上到唔到）',
    /取消這一筆/.test(UI));
  check('★★★★★ 而且撳之前有確認（會影響排表）',
    /function confirmCancelUnavailable/.test(UI));
  check('★★★★ 確認畫面講明「唔會刪走、之後仍然查得到」',
    /不會被刪走[\s\S]{0,40}已取消/.test(UI));
  check('★★★★★ 撳完之後重新讀列表（唔係喺前端自己刪走一行）',
    /apiListUnavailable[\s\S]{0,120}openUnavailable\('''''\)|unavailableData = await callServer\('apiListUnavailable'[\s\S]{0,80}openUnavailable/.test(UI));
}

console.log('\n=== 乙3：取消之後唔可以再列喺「生效中」 ===');
{
  const view = listView();
  checkEqual('★★★★★ 「生效中」0 筆（修正之前呢度仍然係 1——'
    + '幹事會以為一條已經取消嘅限制仍然生效）', view.current.length, 0);
  checkEqual('★★★★★ 但佢冇消失：獨立一組「已取消」1 筆', view.cancelled.length, 1);
  checkEqual('★★★★ 亦都唔會被當成「已過去」', view.past.length, 0);
}

console.log('\n=== 乙3【重點】：引擎讀到嘅生效筆數 ＝ 畫面「生效中」嘅數目 ===');
{
  // 砌多幾筆，兩種 Status 混住，再逐次比較。
  const rows = [
    { personId: 'P9402', from: '2027-07-18', to: '2027-07-18', active: true },
    { personId: 'P9402', from: '2027-07-25', to: '2027-07-25', active: true },
    { personId: 'P9401', from: '2027-08-01', to: '2027-08-01', active: false }
  ];
  rows.forEach(function (r) {
    gas.apiSaveUnavailable({
      quarterId: Q, personId: r.personId, dateFrom: r.from, dateTo: r.to,
      appliesTo: 'ALL', postIds: [], reason: '測試', active: r.active
    });
  });

  const view = listView();
  const engine = engineActiveCount();
  checkEqual('★★★★★ **兩層數字一致**（呢一條就係乙組全部三項嘅根）'
    + '——兩層對「生效」有兩套理解，就係本專案 bug class 第 3 條',
    view.current.length, engine);
  checkEqual('★★★★ 生效中 2 筆', view.current.length, 2);
  checkEqual('★★★★ 已取消 2 筆', view.cancelled.length, 2);

  // 再取消一筆，再比一次——一次啱可能係巧合。
  const id = view.current[0].unavailableId;
  gas.apiSaveUnavailable({
    unavailableId: id, quarterId: Q, personId: view.current[0].personId,
    dateFrom: view.current[0].dateFrom, dateTo: view.current[0].dateTo,
    appliesTo: 'ALL', postIds: [], reason: '測試', active: false
  });
  const view2 = listView();
  checkEqual('★★★★★ 再取消一筆之後，兩層仍然一致',
    view2.current.length, engineActiveCount());
  checkEqual('★★★★ 生效中剩 1 筆', view2.current.length, 1);
  checkEqual('★★★★ 已取消變 3 筆（全部保留，一筆都冇刪）', view2.cancelled.length, 3);
  checkEqual('★★★★★ 總數守恆：生效 ＋ 已取消 ＋ 已過去 ＝ 工作表總行數',
    view2.current.length + view2.cancelled.length + view2.past.length,
    gas.readSheet(gas.SHEETS.UNAVAILABLE).length);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
