// 第五十七輪批次：自測機讀緊一個 API 根本冇嘅欄位。
// 執行方式：node tests/selftest_reads_real_api_fields.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// S07 紅，唯一一條斷言係：
//
//     label「系統看得到剛才那幾筆申報」
//     expected「≥ 3 筆」　actual「0 筆」
//     evidence「apiStep3Plan().results」
//
// 而系統本身**完全正確**：`apiStep3Plan()` 回嘅 `applyList` 有 3 筆
//（`postNameText` 係中文「報告」「主席」）、`needsInputList` 空；
// `apiStep3Apply()` 回 `{"appliedCount":3,"violations":[],"advanced":true}`，
// 造咗 v3。
//
// **`apiStep3Plan()` 根本冇 `results` 呢個欄位。**
// `results` 係內部嗰個 `planApplyRequests_()` 嘅；
// `mapPendingPlanForClient_()` 把佢拆成三個陣列先至交出嚟。
//
// ⇒ `plan.results` 永遠 `undefined`，個數永遠 0。**測試讀錯欄位。**
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 同一個病，第二處：S10
// ═════════════════════════════════════════════════════════════════════
//
// `apiStep5Plan()` 回嘅係 `changed`，而 S10 讀緊 `changedList`
//（嗰個係 `planStep5ChangedList_()` 嘅內部欄位，冇交出嚟）。
//
// 後果比 S07 嗰個更難察覺：
//   ・「名單裡面沒有我沒有碰過的人」⇒ 空陣列，**永遠綠**（假綠）
//   ・「而且真的有人被算進去」　　　⇒ 空陣列，**永遠紅**
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 點解上一輪嘅離線測試捉唔到
// ═════════════════════════════════════════════════════════════════════
//
// 因為 stub 自己都寫錯咗：`selftest_request_rows.test.js` 嗰個
// `apiStep3Plan` stub 回 `{results: […]}`。
//
// **fixture 照自己嘅想像砌，就只驗到自己嘅想像。**
//
// 所以呢一份第一節就係「欄位名同真嗰個 return 一樣」——
// 由**原始碼**抽出嚟比對，唔係由我手寫。

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
const FLOW = read('src/WebAppFlow.gs');
const RUNNER = read('src/SelfTestRunner.gs');
const CODE = RUNNER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// =====================================================================
console.log('\n=== 0【前提】兩個 API 真正回嘅欄位名 ===');
{
  // ⚠️ 由原始碼抽，唔係由我手寫——手寫嘅話就同上一輪個 stub 一樣，
  // 只驗到自己嘅想像。
  // ⚠️ `mapRequestForClient_()` 喺檔案入面排喺 `mapPendingPlanForClient_()`
  // **前面**，所以唔可以攞佢做終點——攞咗就切出一段空字串，
  // 而一條「空對空」嘅斷言永遠綠。一律切到佢自己嗰個收掣。
  const mappedAt = FLOW.indexOf('function mapPendingPlanForClient_(');
  const mapped = FLOW.slice(mappedAt, FLOW.indexOf('\n}', mappedAt));
  const step3Keys = (mapped.match(/^    (\w+):/gm) || [])
    .map(function (m) { return m.trim().replace(':', ''); }).sort();
  checkEqual('★★★★★★ `apiStep3Plan()` 嘅三個陣列叫呢三個名'
    + '——**冇 `results`**。`results` 係內部嗰個 `planApplyRequests_()` 嘅',
    step3Keys.join(','), 'applyList,confirmList,needsInputList');

  const step5 = FLOW.slice(FLOW.indexOf('function apiStep5Plan('));
  const step5Ret = step5.slice(step5.indexOf('  return {'), step5.indexOf('\n  };'));
  const step5Keys = (step5Ret.match(/^    (\w+):/gm) || [])
    .map(function (m) { return m.trim().replace(':', ''); });
  check('★★★★★★ `apiStep5Plan()` 回嘅係 `changed`，**唔係 `changedList`**',
    step5Keys.indexOf('changed') >= 0 && step5Keys.indexOf('changedList') === -1,
    step5Keys.join('、'));

  // 逐筆申報嘅欄位名——S07 嘅證據行要用。
  // ⚠️ 一樣要切清楚——切咗 500 字嘅話會跨到
  // `mapViolationForClient_()`，而佢真係有一條 `serviceDate:`。
  const oneAt = FLOW.indexOf('function mapRequestForClient_(');
  const one = FLOW.slice(oneAt, FLOW.indexOf('\n}', oneAt));
  check('★★★★★★ 逐筆申報係 `serviceDateText`，**唔係 `serviceDate`**'
    + '——我自己寫證據行嗰陣都差啲踩同一個坑',
    /serviceDateText: r\.serviceDateText/.test(one)
      && !/^\s+serviceDate:/m.test(one), one.slice(0, 300));
}

// =====================================================================
console.log('\n=== A1【核心】S07 唔再讀 `results` ===');
{
  check('★★★★★★ **`plan.results` 已經冇咗**'
    + '——嗰個欄位唔存在，讀佢永遠係 0，而系統其實完全正確',
    !/\(plan\.results \|\| \[\]\)/.test(CODE), '');
  check('★★★★★★ 而家讀 `applyList`',
    /const applyList = plan\.applyList \|\| \[\];/.test(CODE), '');
  check('★★★★★★ 而且先驗 `mode === HAS_PENDING`'
    + '——唔係呢個 mode 嘅話，三個陣列根本唔會出現喺回傳入面，'
    + '下面驗幾多都係喺度數一個 undefined',
    /t\.equal\('步驟 3 看到有待處理的申報（mode = HAS_PENDING）'/.test(CODE), '');
}

/**
 * 真正叫落 `selfTestS07_()`，`apiStep3Plan` 由測試餵。
 *
 * @param {Object} planReturn `apiStep3Plan()` 要回嘅嘢
 * @returns {Object} S07 嘅結果
 */
function runS07(planReturn) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SelfTestRunner.gs'
  ]);
  const R = gas.COLUMNS.REQUESTS;
  const headers = [R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME, R.PERSON_NAME,
    R.REQUEST_TYPE, R.STATUS, R.CREATED_AT];
  gas.log_ = function () {};
  gas.selfTestRecordPayload_ = function () {};
  gas.getConfig_ = function () { return 'Asia/Hong_Kong'; };
  gas.findLatestVersionNo_ = function () { return 2; };
  gas.Utilities = { formatDate: function () { return '2028-06-01 00:00:00'; } };
  gas.indexPeopleById_ = function () {
    return { P1: { personId: 'P1', nameTC: '假甲乙' },
      P2: { personId: 'P2', nameTC: '假丙丁' },
      P3: { personId: 'P3', nameTC: '假戊己' } };
  };
  gas.readPostsNormalized_ = function () {
    return [{ postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1 },
      { postId: 'CHAIR', postNameTC: '主席', slotCount: 1 },
      { postId: 'USHER', postNameTC: '司事', slotCount: 1 }];
  };
  gas.selfTestPickCells_ = function () {
    return [
      { serviceDate: '2028-07-02', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P1' },
      { serviceDate: '2028-07-09', postId: 'CHAIR', slotIndex: 1, personId: 'P2' },
      { serviceDate: '2028-07-16', postId: 'USHER', slotIndex: 1, personId: 'P3' }
    ];
  };
  gas.readSheet_ = function () { return []; };
  gas.apiStep3Plan = function () { return planReturn; };
  gas.apiStep3Apply = function () {
    return { appliedCount: 3, rejectedCount: 0, needsInputCount: 0, advanced: true };
  };
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () {
    return { getSheetByName: function () {
      return {
        getLastColumn: function () { return headers.length; },
        getRange: function () { return { getValues: function () { return [headers]; } }; },
        appendRow: function () {}
      };
    } };
  } };
  return { gas: gas, out: gas.selfTestS07_('2028T3') };
}

/** 一份**真形狀**嘅 `apiStep3Plan()` 回傳。 */
function realPlan(opts) {
  const o = opts || {};
  const one = function (d, post) {
    return { sheetRow: 3, serviceDateText: d, postNameText: post,
      personNameText: '假甲乙', requestType: '不能服侍', reason: o.reason || '' };
  };
  return {
    mode: o.mode || 'HAS_PENDING',
    stage: 'REVIEW_SENT',
    skippedIncompleteCount: 0,
    applyList: (o.apply === undefined ? 3 : o.apply) === 0 ? []
      : [one('2028-07-02', '報告'), one('2028-07-09', '主席'),
        one('2028-07-16', '司事')].slice(0, o.apply === undefined ? 3 : o.apply),
    confirmList: [],
    needsInputList: (o.needsInput || []).map(function (r) {
      return one(r.date, r.post);
    })
  };
}

// =====================================================================
console.log('\n=== A1【核心】真形狀 ⇒ S07 綠 ===');
{
  const box = runS07(realPlan({}));
  checkEqual('★★★★★★ **S07 綠**'
    + '——現場係：系統完全正確而 S07 紅，'
    + '因為斷言讀緊一個唔存在嘅欄位',
    box.out.status, box.gas.SELFTEST_STATUS.PASSED);
  const labels = box.out.checks.map(function (c) { return c.label; }).join('\n');
  check('★★★★★ 而且真係驗過 applyList',
    /全部落在「可以套用」那一批/.test(labels), labels.slice(0, 600));
}

// =====================================================================
console.log('\n=== A4【反證】改回讀 `results` ⇒ 一定紅 ===');
{
  // ⚠️ 一份**只有 `results`**（即係舊 stub 嗰個假形狀）嘅回傳。
  // 讀 `applyList` 嘅話會見到 undefined ⇒ 紅。
  // 讀 `results` 嘅話會見到 3 筆 ⇒ 綠。
  // 所以呢一條分得出兩種寫法。
  const box = runS07({ results: [{}, {}, {}] });
  checkEqual('★★★★★★ **S07 紅**'
    + '——舊 stub 就係噉，於是離線一直綠而實機永遠 0 筆',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★ 而且紅嘅係 `mode` 嗰一條（連 mode 都冇）',
    box.out.failedChecks.some(function (c) {
      return /mode = HAS_PENDING/.test(c.label);
    }), JSON.stringify(box.out.failedChecks.map(function (c) { return c.label; })));
}

// =====================================================================
console.log('\n=== A1 一筆跌落 needsInput ⇒ 要紅，而且講得出係邊一筆 ===');
{
  // ⚠️ 驗 `applyList` 而唔係「總數」嘅理由就喺呢度：
  // 總數照樣夠 3，但其中一筆套用唔到。
  const box = runS07(realPlan({
    apply: 2,
    needsInput: [{ date: '2028-07-16', post: '司事' }],
    reason: '查無「假戊己」在 2028-07-16 司事 的派工紀錄'
  }));
  checkEqual('★★★★★★ **S07 紅**'
    + '——驗「總數 ≥ 3」嘅話呢個現場照樣綠，'
    + '而問題要等到下面 `appliedCount` 先爆，'
    + '嗰陣就分唔出係「寫錯格式」定係「套用邏輯壞咗」',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  const bad = box.out.failedChecks.filter(function (c) {
    return /全部落在「可以套用」那一批/.test(c.label);
  })[0];
  check('★★★★★★ 而且三個數都印晒出嚟',
    bad && /applyList 2 筆/.test(bad.actual)
      && /needsInputList 1 筆/.test(bad.actual), JSON.stringify(bad));
  check('★★★★★★ 而且證據講得出係邊一筆、點解跌落去'
    + '——冇原文嘅話，十月落手查嗰個要由零查一次',
    bad && /2028-07-16　司事/.test(bad.evidence)
      && /查無/.test(bad.evidence), JSON.stringify(bad));
}

// =====================================================================
console.log('\n=== A1 唔係 HAS_PENDING ⇒ 要紅，唔可以數一個 undefined ===');
{
  const box = runS07(realPlan({ mode: 'NO_PENDING_DONE' }));
  checkEqual('★★★★★★ **S07 紅**'
    + '——其餘 mode 之下三個陣列根本唔會出現喺回傳入面',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★ 而且證據列得出其餘幾個 mode 叫咩',
    box.out.failedChecks.some(function (c) {
      return /NO_PENDING_DONE/.test(c.evidence || '');
    }), JSON.stringify(box.out.failedChecks));
}

// =====================================================================
console.log('\n=== A2【核心】S10 唔再讀 `changedList` ===');
{
  check('★★★★★★ **`plan.changedList` 已經冇咗**'
    + '——同一個病，第二處。而佢仲毒啲：'
    + '「名單裡面沒有我沒有碰過的人」喺空陣列之下**永遠綠**',
    !/\(plan\.changedList \|\| \[\]\)/.test(CODE), '');
  check('★★★★★★ 而家讀 `plan.changed`',
    /const changedIds = \(plan\.changed \|\| \[\]\)\.map/.test(CODE), '');
  check('★★★★★ 證據行都改埋，唔會再指去一個唔存在嘅欄位',
    !/'apiStep5Plan\(\)\.changedList'/.test(CODE), '');
}

/**
 * 真正叫落 `selfTestS10_()`，`apiStep5Plan` 由測試餵。
 *
 * @param {Object} planReturn `apiStep5Plan()` 要回嘅嘢
 * @returns {Object}
 */
function runS10(planReturn) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SelfTestRunner.gs'
  ]);
  gas.log_ = function () {};
  gas.selfTestRecordPayload_ = function () {};
  gas.findLatestVersionNo_ = function () { return 2; };
  gas.apiGetDashboardState = function () {
    return { unsaved: { gridChangeCount: 0, unresolvedCount: 0 } };
  };
  gas.selfTestPickAcceptedCells_ = function () {
    return {
      cells: [
        { serviceDate: '2028-07-02', postId: 'USHER', slotIndex: 1, personId: 'P1',
          replacement: { personId: 'P3', name: '假戊己' } },
        { serviceDate: '2028-07-09', postId: 'USHER', slotIndex: 1, personId: 'P2',
          replacement: { personId: 'P4', name: '假庚辛' } }
      ],
      attempts: [], planCalls: 1, plan: { needsRelease: false, violations: { real: [] } },
      planError: '', preExisting: [], confirmed: true
    };
  };
  gas.describeAcceptedPickAttempts_ = function () { return '（測試）'; };
  gas.apiSaveAndConfirmExecute = function () { return {}; };
  gas.apiStep5Plan = function () { return planReturn; };
  // 中途嗰兩次 dashboard 要見到 2 格未儲存。
  let calls = 0;
  gas.apiGetDashboardState = function () {
    calls++;
    return calls === 1
      ? { unsaved: { gridChangeCount: 0, unresolvedCount: 0 } }
      : { unsaved: { gridChangeCount: 2, unresolvedCount: 0 } };
  };
  return { gas: gas, out: gas.selfTestS10_('2028T3') };
}

// =====================================================================
console.log('\n=== A2【核心】真形狀 ⇒ S10 數得到人 ===');
{
  const box = runS10({
    mode: 'HAS_CHANGES', versionNo: 3,
    changed: [{ personId: 'P1' }, { personId: 'P3' }],
    changedPersonCount: 2, recipientCount: 2,
    recipientPreview: { total: 2, shown: [], moreCount: 0 }, isDryRun: true
  });
  checkEqual('★★★★★★ **S10 綠**', box.out.status, box.gas.SELFTEST_STATUS.PASSED);
  const labels = box.out.checks.map(function (c) { return c.label + '｜' + c.actual; })
    .join('\n');
  check('★★★★★★ 而且真係數到 2 個人（唔係 0）'
    + '——讀 `changedList` 嘅話永遠係 0 人，'
    + '而「名單裡面沒有我沒有碰過的人」會喺空陣列之下假綠',
    /2 人/.test(labels), labels.slice(-400));
}

// =====================================================================
console.log('\n=== A4【反證】S10 改回讀 `changedList` ⇒ 一定紅 ===');
{
  // 一份**只有 `changedList`**（假形狀）嘅回傳。
  const box = runS10({
    mode: 'HAS_CHANGES', versionNo: 3,
    changedList: [{ personId: 'P1' }, { personId: 'P3' }]
  });
  checkEqual('★★★★★★ **S10 紅**——`changed` 冇嘢，數到 0 人',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★ 而且紅嘅係「真的有人被算進去」嗰一條',
    box.out.failedChecks.some(function (c) {
      return /真的有人被算進去/.test(c.label);
    }), JSON.stringify(box.out.failedChecks.map(function (c) { return c.label; })));
}

// =====================================================================
console.log('\n=== A2 反證：一個「我冇碰過嘅人」要捉得到 ===');
{
  // ⚠️ 讀錯欄位嗰陣，呢一條係**假綠**——空陣列入面梗係冇多餘嘅人。
  const box = runS10({
    mode: 'HAS_CHANGES', versionNo: 3,
    changed: [{ personId: 'P1' }, { personId: 'P9' }]
  });
  checkEqual('★★★★★★ **S10 紅**'
    + '——P9 唔喺我碰過嗰幾個人裡面。'
    + '讀錯欄位嗰陣呢一條係假綠：空陣列入面梗係冇多餘嘅人',
    box.out.status, box.gas.SELFTEST_STATUS.FAILED);
  check('★★★★★ 而且證據列得出多咗邊個',
    box.out.failedChecks.some(function (c) {
      return /P9/.test(c.evidence || '');
    }), JSON.stringify(box.out.failedChecks));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
