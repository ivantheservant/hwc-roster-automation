// 第五十二輪批次 C 組：亂行機叫完真實入口，冇睇回傳值。
// 執行方式：node tests/monkey_checks_return_value.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// `MonkeyRun.gs` 嘅「生成初稿」叫 `apiGenerateDraftExecute()`，
// 然後把回傳值 `JSON.stringify` 落 `MonkeyLog` 就算數——**冇人睇**。
//
// 而嗰一支喺已經有版本嘅季度上面回：
//
//     { ok: false, versionCreated: false,
//       message: '這一季已經有第 0 版，不會重複生成。…' }
//
// **佢唔拋錯。** 所以亂行機會照樣行落去，行足 50 步，
// 然後交一份「冇發現任何問題」嘅報告。
//
// 自測機 S14 第五十一輪就係噉行過咗頭：攞住舊嘅 v0 去驗，
// 報咗一句完全誤導嘅結論。
//
// ⚠️ **一個真實入口靜靜地冇做事，而測試照樣往下走**
// ——呢個係呢個專案由第一輪殺到而家嗰種病。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════
//
// 佢真正叫落 `runMonkey_()`，把真實入口換成一個「唔拋錯、但乜都冇做」
// 嘅 stub，然後睇**亂行機報告入面有冇記低呢一件事**。

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

/**
 * 造一部只行一步、而且指定行邊個動作嘅亂行機。
 *
 * @param {Object} opts `{facts, factsAfter, run}`
 * @returns {Object} `{gas, report, failures}`
 */
function runOneStep(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs', 'MonkeyRun.gs'
  ]);
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.runAllInvariants_ = function () {
    return {
      results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0
    };
  };
  gas.assertMonkeyDryRunStillOn_ = function () {};

  // ⚠️ **唔換 `monkeyActions_()`**——要驗嘅正正係真嗰張表上面
  // 嗰個 `expect`。淨係換佢底下嗰個真實入口。
  let phase = 0;
  gas.monkeyReadFacts_ = function () {
    const f = phase === 0 ? opts.facts : (opts.factsAfter || opts.facts);
    phase++;
    return JSON.parse(JSON.stringify(f));
  };
  Object.keys(opts.stubs || {}).forEach(function (name) {
    gas[name] = opts.stubs[name];
  });

  const report = gas.runMonkey_(1, 7, 0);
  return { gas: gas, report: report, failures: report.failures || [] };
}

const NO_BUTTONS = { review: { enabled: false }, official: { enabled: false },
  resend: { enabled: false } };

// =====================================================================
console.log('\n=== C【核心】「生成初稿」回 `versionCreated: false` ⇒ 要記低 ===');
{
  // `legal` 話得（冇版本）。入口收咗，但乜都冇造。**佢唔拋錯。**
  const box = runOneStep({
    facts: { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    factsAfter: { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    stubs: {
      apiGenerateDraftExecute: function () {
        return { ok: false, versionCreated: false,
          message: '這一季已經有第 0 版，不會重複生成。' };
      }
    }
  });

  checkEqual('★★★★★★ 亂行機真係揀咗「生成初稿」（前置）',
    (box.report.path || []).join('、'), '生成初稿');
  check('★★★★★★ **記低咗**——之前呢個回傳值只係 `JSON.stringify` 落 `MonkeyLog`，'
    + '冇人睇，亂行機會一路行到 50 步再交一份綠色報告',
    box.failures.length > 0,
    JSON.stringify(box.report.steps));
  check('★★★★★★ 而且講得出係「合法動作靜靜地沒有做事」，'
    + '唔係混埋落「拋錯」嗰一類',
    box.failures.some(function (f) { return f.kind === '合法動作靜靜地沒有做事'; }),
    JSON.stringify(box.failures));
  check('★★★★★ 貼返回傳訊息原文——冇原文就要重新查一次先知咩事',
    box.failures.some(function (f) { return /不會重複生成/.test(f.detail); }),
    JSON.stringify(box.failures));
  // ⚠️ 唔可以只驗「有記低」——版本號嗰條查證一樣會令呢一步變紅，
  // 於是「睇唔睇 `versionCreated`」嗰段就算整壞咗都測唔到。
  // 要驗**佢真係報咗嗰個旗**。
  check('★★★★★★ 而且明講係 `versionCreated: false`'
    + '——「叫咗，但冇造出版本」同「造咗但版本號冇加」係兩件事，'
    + '報錯咗嗰件，落手查嗰陣就會查錯方向',
    box.failures.some(function (f) { return /versionCreated/.test(f.detail); }),
    JSON.stringify(box.failures));
  check('★★★★★ 而且帶住行到呢一步嗰條路徑',
    (box.failures[0].path || []).join('、').indexOf('生成初稿') >= 0,
    JSON.stringify(box.failures[0]));
}

// =====================================================================
console.log('\n=== C 版本號冇加 ⇒ 一樣要記低（就算回傳值話成功）===');
{
  // ⚠️ 呢一條守嘅係「回傳值講大話」——回傳話造咗，而表上面冇多咗一版。
  const box = runOneStep({
    facts: { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    factsAfter: { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    stubs: {
      apiGenerateDraftExecute: function () {
        return { ok: true, versionCreated: true, versionNo: 0 };
      }
    }
  });
  check('★★★★★★ 回傳話造咗，而版本號冇加 ⇒ 唔可以當佢做過'
    + '——只信回傳值嘅話，一個「講咗大話」嘅入口永遠捉唔到',
    box.failures.some(function (f) { return /版本號沒有增加/.test(f.detail); }),
    JSON.stringify(box.failures));
}

// =====================================================================
console.log('\n=== C 真係造到 ⇒ 唔可以嘈 ===');
{
  // ⚠️ 一部乜都當紅嘅機器同一部乜都當綠嘅機器一樣冇用。
  const box = runOneStep({
    facts: { hasVersion: false, latestVersionNo: -1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    factsAfter: { hasVersion: true, latestVersionNo: 0, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    stubs: {
      apiGenerateDraftExecute: function () {
        return { ok: true, versionCreated: true, versionNo: 0 };
      }
    }
  });
  checkEqual('★★★★★★ 一句都唔嘈', box.failures.length, 0);
}

// =====================================================================
console.log('\n=== C 共通規則：`legal` 話得而系統回 `ok: false` ===');
{
  // ⚠️ 呢一條唔止 cover「生成初稿」——九個動作全部有。
  const box = runOneStep({
    facts: { hasVersion: true, latestVersionNo: 1, stage: 'DRAFT',
      gridChangeCount: 3, buttons: NO_BUTTONS },
    factsAfter: { hasVersion: true, latestVersionNo: 1, stage: 'DRAFT',
      gridChangeCount: 0, buttons: NO_BUTTONS },
    stubs: {
      findLatestVersionNo: function () { return 1; },
      selfTestPickCells_: function () { return []; },
      apiSaveAndConfirmExecute: function () {
        return { ok: false, message: '有 3 格的名字認不出來，整批拒絕。' };
      },
      apiGetDashboardState: function () { return { unsaved: { gridChangeCount: 0 } }; },
      apiGetSendPlanSummary: function () { return {}; },
      apiRollbackPlan: function () { return {}; }
    }
  });
  // seed 7、一步——揀邊個動作由 `makeMonkeyRandom_()` 決定。
  // 只要佢揀中一個回 `ok: false` 嘅，就要見到呢一句。
  const picked = (box.report.path || [])[0];
  if (picked === '儲存並確認') {
    check('★★★★★★ 系統回 `ok: false` ⇒ 記低「`legal()` 說做得到，而系統拒絕了」'
      + '——`legal()` 已經話咗呢個狀態下做得，'
      + '所以呢個拒絕同一個合法動作拋錯係同一級',
      box.failures.some(function (f) { return /系統拒絕了/.test(f.detail); }),
      JSON.stringify(box.failures));
    check('★★★★★ 而且貼返拒絕原因',
      box.failures.some(function (f) { return /認不出來/.test(f.detail); }),
      JSON.stringify(box.failures));
  } else {
    // ⚠️ 揀唔中就直接叫嗰一支，唔可以靜靜噉當佢過。
    const gas = box.gas;
    const action = gas.monkeyActions_().filter(function (a) {
      return a.id === '儲存並確認';
    })[0];
    const complaints = gas.monkeyCheckOutcome_(action,
      { ok: false, message: '有 3 格的名字認不出來，整批拒絕。' },
      { stage: 'DRAFT', latestVersionNo: 1, gridChangeCount: 3 },
      { stage: 'DRAFT', latestVersionNo: 1, gridChangeCount: 0 });
    check('★★★★★★ 系統回 `ok: false` ⇒ 記低「`legal()` 說做得到，而系統拒絕了」',
      complaints.some(function (c) { return /系統拒絕了/.test(c); }),
      JSON.stringify(complaints));
    check('★★★★★ 而且貼返拒絕原因',
      complaints.some(function (c) { return /認不出來/.test(c); }),
      JSON.stringify(complaints));
  }
}

// =====================================================================
console.log('\n=== C 九個動作全部有查證，一個都唔可以漏 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs', 'MonkeyRun.gs'
  ]);
  const actions = gas.monkeyActions_();
  const missing = actions.filter(function (a) {
    return typeof a.expect !== 'function';
  }).map(function (a) { return a.id; });
  checkEqual('★★★★★★ 每一個動作都寫咗 `expect`'
    + '——漏一個，就係嗰一個入口可以靜靜噉冇做嘢而冇人知',
    missing.join('、'), '');
  check('★★★★★ 而且有九個動作（加咗動作就要順手加查證）',
    actions.length === 9, '實際 ' + actions.length + ' 個');
}

// =====================================================================
console.log('\n=== C 純算／純讀嘅動作改咗嘢 ⇒ 要記低 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs', 'MonkeyRun.gs'
  ]);
  const before = { stage: 'DRAFT', latestVersionNo: 1, gridChangeCount: 0 };

  ['改動後重發（只算，不寄）', '回到上一個儲存版本', '看一次寄出彈窗'].forEach(function (id) {
    const action = gas.monkeyActions_().filter(function (a) { return a.id === id; })[0];
    checkEqual('★★★★★★ 【' + id + '】自稱只係算／只係讀，改咗版本號 ⇒ 記低'
      + '——一個純算嘅入口改咗嘢，係一個真發現',
      gas.monkeyCheckOutcome_(action, {}, before,
        { stage: 'DRAFT', latestVersionNo: 2, gridChangeCount: 0 }).length, 1);
    checkEqual('★★★★★ 【' + id + '】乜都冇改 ⇒ 唔嘈',
      gas.monkeyCheckOutcome_(action, {}, before,
        { stage: 'DRAFT', latestVersionNo: 1, gridChangeCount: 0 }).length, 0);
  });

  // ── 「看一次主畫面」嗰個 `same` ────────────────────────────
  //
  // ⚠️ 佢本來算咗 `same` 出嚟，但冇人睇——JSON 落 `MonkeyLog` 就算數。
  // 呢個動作存在嘅唯一理由就係問「連續讀兩次會唔會唔同」，
  // 而佢問完之後冇睇答案。同 C 組要修嗰件事一模一樣。
  const dash = gas.monkeyActions_().filter(function (a) {
    return a.id === '看一次主畫面';
  })[0];
  check('★★★★★★ 連續讀兩次主畫面唔一樣 ⇒ 記低'
    + '——`same` 本來就算咗出嚟，只係冇人睇',
    gas.monkeyCheckOutcome_(dash, { same: false }, before, before)
      .some(function (c) { return /連續讀兩次/.test(c); }), '');
  checkEqual('★★★★★ 一樣 ⇒ 唔嘈',
    gas.monkeyCheckOutcome_(dash, { same: true }, before, before).length, 0);

  // ── 查證本身爆咗 ───────────────────────────────────────────
  const boom = { id: '假動作', expect: function () { throw new Error('查唔到'); } };
  check('★★★★★★ 查證本身爆咗 ⇒ **要報**，唔可以靜靜噉當佢過'
    + '——靜靜噉當佢過就係呢一組要修嗰件事',
    gas.monkeyCheckOutcome_(boom, {}, before, before)
      .some(function (c) { return /查不到這一步做過什麼：查唔到/.test(c); }), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
