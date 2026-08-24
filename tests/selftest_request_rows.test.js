// 第五十五輪批次 B 組：S07 寫申報用咗 PostID，張表收嘅係中文名稱。
// 執行方式：node tests/selftest_request_rows.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第五十四輪實測）
// ═════════════════════════════════════════════════════════════════════
//
//     "postNameText":"ANNOUNCE" … reason:"找不到崗位「ANNOUNCE」
//     （Posts 沒有這個中文名稱，或該崗位 Active=FALSE）"
//
// S07 寫 `Requests` 嗰陣，「崗位」欄填咗 `ANNOUNCE`／`SCRIPTURE`（PostID），
// 而張表收嘅係中文名稱（報告／讀經）。
//
// **系統冇錯，仲畀咗一段完美嘅錯誤訊息。** 錯嘅係測試寫錯格式。
//
// 後果：三筆申報全部跌落 `needsInputList`，`appliedCount=0`——
// 「套用申報」呢條路由頭到尾一格都冇真正套用過，而 S07 當時係綠嘅。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════
//
// 佢真正叫落 `selfTestS07_()`，攔住 `sheet.appendRow()`，
// 睇**真正寫咗落張表嗰幾行**。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DATES = ['2028-07-02', '2028-07-09', '2028-07-16', '2028-07-23'];

/**
 * 造一個沙箱，攔住 `Requests` 嗰張表嘅 `appendRow()`。
 *
 * @param {Object} opts `{posts, cells, applied}`
 * @returns {Object} `{gas, appended, headers}`
 */
function sandbox(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SelfTestRunner.gs'
  ]);
  const R = gas.COLUMNS.REQUESTS;
  const headers = [R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME,
    R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS, R.RESULT_NOTE, R.CREATED_AT];
  const appended = [];

  gas.log_ = function () {};
  gas.selfTestRecordPayload_ = function () {};
  gas.getConfig = function () { return 'Asia/Hong_Kong'; };
  gas.findLatestVersionNo = function () { return 2; };
  gas.Utilities = { formatDate: function () { return '2028-06-01 00:00:00'; } };
  gas.indexPeopleById_ = function () {
    return {
      P1: { personId: 'P1', nameTC: '假甲乙' },
      P2: { personId: 'P2', nameTC: '假丙丁' },
      P3: { personId: 'P3', nameTC: '假戊己' }
    };
  };
  gas.readPostsNormalized = function () { return opts.posts; };
  gas.selfTestPickCells_ = function () { return opts.cells; };
  gas.readSheet = function () { return []; };
  // ⚠️⚠️ 第五十七輪批次：**呢個 stub 本來寫錯咗。**
  //
  // 舊寫法回 `{results: […]}`——而 `apiStep3Plan()` 根本冇嗰個欄位。
  // 於是離線測試一直綠，而實機永遠數到 0 筆。
  //
  // **fixture 照自己嘅想像砌，就只驗到自己嘅想像。**
  // 見 `tests/selftest_reads_real_api_fields.test.js`——嗰度有一條
  // 斷言守住「欄位名同真嗰個 return 一樣」。
  gas.apiStep3Plan = function () {
    return {
      mode: 'HAS_PENDING',
      stage: 'REVIEW_SENT',
      skippedIncompleteCount: 0,
      applyList: [{ sheetRow: 3, serviceDateText: '2028-07-02',
        postNameText: '報告', personNameText: '假甲乙',
        requestType: '不能服侍', reason: '' },
      { sheetRow: 4, serviceDateText: '2028-07-09',
        postNameText: '讀經', personNameText: '假丙丁',
        requestType: '不能服侍', reason: '' },
      { sheetRow: 5, serviceDateText: '2028-07-16',
        postNameText: '司事', personNameText: '假戊己',
        requestType: '不能服侍', reason: '' }],
      confirmList: [],
      needsInputList: []
    };
  };
  gas.apiStep3Apply = function () {
    return Object.assign({ appliedCount: 3, rejectedCount: 0, needsInputCount: 0,
      advanced: true }, opts.applied || {});
  };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function () {
          return {
            getLastColumn: function () { return headers.length; },
            getRange: function () {
              return { getValues: function () { return [headers]; } };
            },
            appendRow: function (row) {
              const o = {};
              headers.forEach(function (h, i) { o[h] = row[i]; });
              appended.push(o);
            }
          };
        }
      };
    }
  };
  return { gas: gas, appended: appended, headers: headers, R: R };
}

const POSTS = [
  { postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1 },
  { postId: 'SCRIPTURE', postNameTC: '讀經', slotCount: 1 },
  { postId: 'USHER', postNameTC: '司事', slotCount: 2 }
];
const CELLS = [
  { serviceDate: DATES[0], postId: 'ANNOUNCE', slotIndex: 1, personId: 'P1' },
  { serviceDate: DATES[1], postId: 'SCRIPTURE', slotIndex: 1, personId: 'P2' },
  { serviceDate: DATES[2], postId: 'USHER', slotIndex: 1, personId: 'P3' }
];

// =====================================================================
console.log('\n=== B1【核心】崗位欄要中文名稱，唔係 PostID ===');
{
  const box = sandbox({ posts: POSTS, cells: CELLS });
  const out = box.gas.selfTestS07_('2028T3');
  const R = box.R;

  checkEqual('★★★★★ 寫咗 3 行', box.appended.length, 3);
  checkEqual('★★★★★★ **崗位欄係中文名稱**'
    + '——填 PostID 嘅話，`validateRequest_()` 嗰句'
    + '`p.postNameTC === req.postNameText` 永遠對唔上，'
    + '三筆會全部跌落 needsInput，而「套用申報」一格都冇走過',
    box.appended.map(function (r) { return r[R.POST_NAME]; }).join('、'),
    '報告、讀經、司事');
  check('★★★★★★ 而且一個 PostID 都冇漏出去',
    box.appended.every(function (r) {
      return ['ANNOUNCE', 'SCRIPTURE', 'USHER'].indexOf(r[R.POST_NAME]) === -1;
    }), JSON.stringify(box.appended));
  checkEqual('★★★★★ 人名欄係中文名',
    box.appended.map(function (r) { return r[R.PERSON_NAME]; }).join('、'),
    '假甲乙、假丙丁、假戊己');
  checkEqual('★★★★★ 類型用 `REQUEST_TYPE.CANNOT_SERVE`',
    box.appended.map(function (r) { return r[R.REQUEST_TYPE]; }).join('、'),
    '不能服侍、不能服侍、不能服侍');
  checkEqual('★★★★★★ 三筆分散喺三個唔同主日'
    + '——同一日抽三個崗位會令替補人選重疊，一次過走三筆嘅成功率低好多',
    box.appended.map(function (r) { return r[R.SERVICE_DATE]; }).join('、'),
    DATES.slice(0, 3).join('、'));
  checkEqual('★★★★★ S07 綠', out.status, box.gas.SELFTEST_STATUS.PASSED);
}

// =====================================================================
console.log('\n=== B3【核心】三筆要落喺三個唔同主日 ===');
{
  // ⚠️ 上面嗰個 fixture 本來就係三個唔同日，所以驗唔到嗰道防線。
  // 呢一個特登喺同一日擺三格——冇防線嘅話，三筆會全部落喺 07-02。
  const crowded = [
    { serviceDate: DATES[0], postId: 'ANNOUNCE', slotIndex: 1, personId: 'P1' },
    { serviceDate: DATES[0], postId: 'SCRIPTURE', slotIndex: 1, personId: 'P2' },
    { serviceDate: DATES[0], postId: 'USHER', slotIndex: 1, personId: 'P3' },
    { serviceDate: DATES[1], postId: 'USHER', slotIndex: 1, personId: 'P1' },
    { serviceDate: DATES[2], postId: 'USHER', slotIndex: 1, personId: 'P2' }
  ];
  const box = sandbox({ posts: POSTS, cells: crowded });
  box.gas.selfTestS07_('2028T3');
  const dates = box.appended.map(function (r) { return r[box.R.SERVICE_DATE]; });
  checkEqual('★★★★★★ **三筆落喺三個唔同主日**'
    + '——同一日抽三個崗位會令替補人選重疊，'
    + '一次過走三筆嘅成功率低好多',
    dates.join('、'), DATES.slice(0, 3).join('、'));
  checkEqual('★★★★★ 而且真係三筆', box.appended.length, 3);
}

// =====================================================================
console.log('\n=== B1 崗位冇中文名 ⇒ 唔好揀嗰一格 ===');
{
  // ⚠️ `Posts` 上面冇中文名（或者 `Active=FALSE`）嘅崗位申報唔到。
  // 揀咗就一定跌落 needsInput——即係第五十四輪嗰個現場。
  const box = sandbox({
    posts: [{ postId: 'USHER', postNameTC: '司事', slotCount: 2 }],
    cells: CELLS
  });
  box.gas.selfTestS07_('2028T3');
  checkEqual('★★★★★★ 只寫得出嗰一格有中文名嘅',
    box.appended.map(function (r) { return r[box.R.POST_NAME]; }).join('、'),
    '司事');
}

// =====================================================================
console.log('\n=== B1 一格都揀唔到 ⇒ 跳過，唔係紅 ===');
{
  const box = sandbox({ posts: [], cells: CELLS });
  const out = box.gas.selfTestS07_('2028T3');
  checkEqual('★★★★★★ **標 `SKIPPED`，唔係紅**'
    + '——紅會經 `dependsOn` 把 S09–S11 標成 `BLOCKED`',
    out.status, box.gas.SELFTEST_STATUS.SKIPPED);
  checkEqual('★★★★★ 而且一行都冇寫', box.appended.length, 0);
}

// =====================================================================
console.log('\n=== B3【核心】`appliedCount = 0` ⇒ 要紅，唔可以扮跑過 ===');
{
  // ⚠️ 第五十四輪嗰次就係噉：`appliedCount=0`、`needsInputCount=3`，
  // 而 S07 係綠嘅。三筆全部跌落 needsInput，
  // 即係「套用申報」呢條路由頭到尾一格都冇真正套用過。
  const box = sandbox({
    posts: POSTS, cells: CELLS,
    applied: { appliedCount: 0, needsInputCount: 3, advanced: true }
  });
  const out = box.gas.selfTestS07_('2028T3');
  checkEqual('★★★★★★ S07 紅', out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★★ 而且紅嘅係「至少有 1 筆真的套用了」嗰一條',
    out.failedChecks.some(function (c) {
      return /appliedCount ≥ 1/.test(c.label);
    }), JSON.stringify(out.failedChecks.map(function (c) { return c.label; })));
  check('★★★★★ 而且證據帶住三個數',
    out.failedChecks.some(function (c) {
      return /appliedCount=0/.test(c.actual) && /needsInputCount=3/.test(c.actual);
    }), JSON.stringify(out.failedChecks));
  // ⚠️ **「記錄」嗰條唔可以順手變成斷言。**
  //
  // A3 嗰個決策點（`appliedCount = 0` 應唔應該造版本）未覆之前，
  // 判斷佢嘅對錯就係代 Ivan 拍板。
  // 而且淨係睇 S07 紅唔紅係分唔出嘅——`appliedCount = 0` 本來就
  // 已經令上面嗰條紅。所以要驗**記錄嗰條自己**仲係綠。
  const record = out.checks.filter(function (c) {
    return /（記錄，不是斷言）/.test(c.label);
  })[0];
  check('★★★★★★ 「記錄」嗰條存在', !!record,
    JSON.stringify(out.checks.map(function (c) { return c.label; })));
  checkEqual('★★★★★★ **而且就算 `appliedCount = 0`，佢自己仍然係綠**'
    + '——記錄係記錄，唔係斷言',
    record && record.ok, true);
}

// =====================================================================
console.log('\n=== B2 Stage 前進咗但 appliedCount 幾多 ⇒ 記低，唔判斷 ===');
{
  const box = sandbox({
    posts: POSTS, cells: CELLS,
    applied: { appliedCount: 2, needsInputCount: 1, advanced: true }
  });
  const out = box.gas.selfTestS07_('2028T3');
  const labels = out.checks.map(function (c) { return c.label; }).join('\n');
  check('★★★★★★ 報告記低咗 `advanced` 同 `appliedCount` 兩個值'
    + '——A3 嗰個決策點未覆之前唔判斷對錯，但要留低現場',
    /advanced=true/.test(labels) && /appliedCount=2/.test(labels),
    labels.slice(0, 600));
  check('★★★★★ 而且明講咗「有一個決策點還沒有回覆」',
    out.checks.some(function (c) {
      return /決策點還沒有回覆/.test(c.evidence || '');
    }), JSON.stringify(out.checks.map(function (c) { return c.evidence; })));
  checkEqual('★★★★★★ 而且呢一條**唔會令 S07 變紅**'
    + '——記錄係記錄，唔係斷言',
    out.status, box.gas.SELFTEST_STATUS.PASSED);
}

// =====================================================================
console.log('\n=== B1 唔准寫死中文崗位名 ===');
{
  const SRC = read('src/SelfTestRunner.gs');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const s07 = CODE.slice(CODE.indexOf('function selfTestS07_('),
    CODE.indexOf('function selfTestS08_('));
  check('★★★★★★ 由 `readPostsNormalized()` 現場查'
    + '——寫死嘅話，日後有人改咗崗位名，自測機就會無聲無息噉壞掉',
    /readPostsNormalized\(\)\.forEach/.test(s07), s07.slice(0, 900));
  // ⚠️ 唔可以用「有冇兩個中文字嘅字串」去驗——`'存在'`（工作表存在）
  // 都會中，而佢同崗位名完全無關。要驗**寫入嗰一句本身**。
  check('★★★★★ 崗位欄填嘅係查返嚟嗰個名，唔係一個字面值',
    /put\(R\.POST_NAME, postNameById\[c\.postId\]\);/.test(s07), s07.slice(0, 900));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
