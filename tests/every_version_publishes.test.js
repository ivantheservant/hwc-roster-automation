// 第五十五輪批次 A 組：造版本嘅路有六條，發佈漏咗兩條。
// 執行方式：node tests/every_version_publishes.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第五十五輪實測）
// ═════════════════════════════════════════════════════════════════════
//
//     ⚠️ I09｜預期 v3｜實際 v2｜PublicLinks.LastPublishedVersion=2；
//     findLatestVersionNo()=3。不一致代表收信的人開連結看到的，
//     不是最新那一版。
//
// v2 係「儲存並確認」造嘅（有發佈）。
// **v3 係步驟 3「套用修改申報」造嘅——冇發佈。**
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 點解第五十二輪冇捉到
// ═════════════════════════════════════════════════════════════════════
//
// 第五十二輪 A 組 audit 過同一件事，但佢**由函式數起**：
// 數晒 `performRosterGeneration_()` 嘅四個 caller，然後收工。
//
// 於是所有**唔經嗰支函式造版本**嘅路一條都冇數過。
//
// **呢一次由資料嗰邊數起：邊個會喺 `RosterVersions` 加行。**
// `registerVersion()` 一共有六個真呼叫點——查出嚟有兩條漏咗發佈，
// 而其中一條（`applyDecisions()`）連 Ivan 嗰張清單都冇。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════
//
// 佢 stub 住 `registerVersion()`（＝「加一行 `RosterVersions`」嗰個
// choke point）同 `publishPublicRoster_()`，記低呼叫次序，
// 然後真正叫落每一條路，斷言**每一次加行之後都跟住一次發佈**。

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

// =====================================================================
console.log('\n=== A1【核心】由資料嗰邊數：邊個會喺 `RosterVersions` 加行 ===');
{
  // ⚠️ **呢一條先係今輪嘅重點。** 唔係驗「某支函式嘅 caller 齊唔齊」，
  // 而係驗「加行嗰個 choke point 一共有幾多個呼叫點」——
  // 多咗一個而冇人為佢諗過發佈，呢一條就會紅。
  const files = fs.readdirSync(path.join(ROOT, 'src'))
    .filter(function (f) { return f.slice(-3) === '.gs'; });
  const sites = [];
  files.forEach(function (f) {
    const code = read('src/' + f)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    code.split('\n').forEach(function (line, i) {
      if (!/(^|[^\w.])registerVersion\s*\(/.test(line)) return;
      if (/^function registerVersion/.test(line.trim())) return;
      sites.push(f + ':' + (i + 1));
    });
  });

  // 第六十七輪批次 AF 組：第七個呼叫點——匯入人手編好的職事表（`RosterImport.gs`），
  // 佢自己發佈（見下面「A2 匯入人手編好的職事表」）。
  checkEqual('★★★★★★ **一共七個呼叫點**'
    + '——加多一個就要喺呢度改，而改嗰陣就會見到下面「每一個都要發佈」'
    + '嗰幾條。第五十二輪由函式數起，所以嗰六個入面只數過一個',
    sites.length, 7);
  const byFile = sites.map(function (s) { return s.split(':')[0]; }).sort().join('、');
  checkEqual('★★★★★★ 而且係呢七個檔案',
    byFile,
    'FineTune.gs、MultiRun.gs、RequestsApply.gs、RosterImport.gs、SuggestionSheet.gs、'
      + 'WebAppRollback.gs、WebAppSaveConfirm.gs');
}

/**
 * 造一個沙箱，記低「加行」同「發佈」嘅呼叫次序。
 *
 * @param {string[]} files 要載入嘅 `.gs`
 * @returns {Object} `{gas, calls}`
 */
function sandbox(files) {
  const gas = loadGasSource(files);
  const calls = [];
  gas.log_ = function () {};
  gas.registerVersion = function (quarterId, versionNo) {
    calls.push('register:v' + versionNo);
  };
  gas.publishPublicRoster_ = function () { calls.push('publish'); };
  gas.findPublicLinkRow_ = function () { return null; };
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.withMutationLock_ = function (name, fn) { return fn(); };
  return { gas: gas, calls: calls };
}

// =====================================================================
console.log('\n=== A2【核心】套用修改申報：加完行一定跟住發佈 ===');
{
  const box = sandbox([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs', 'RequestsApply.gs'
  ]);
  const gas = box.gas;
  // 只留住「造版本 ＋ 發佈」嗰一段，其餘寫入全部換走。
  gas.createRosterSheet = function () { return 'Roster_2028T3_v3'; };
  gas.writeAssignments = function () {};
  gas.markPendingBackfillCells_ = function () {};
  gas.writeNewEligibilityRows_ = function () { return 0; };
  gas.writeNewUnavailableRows_ = function () { return 0; };
  gas.writeRequestOutcomes_ = function () {};
  gas.markProposalsApplied_ = function () {};
  gas.findLatestVersionNo = function () { return 3; };
  gas.buildRequestApplyOutcomes_ = function () { return []; };

  // ⚠️ `applyRequests_()` 內部好長。呢一條只驗**最後嗰一段**：
  // 加完行之後有冇發佈。所以由 `registerVersion()` 嗰句開始重演。
  const SRC = read('src/RequestsApply.gs');
  const at = SRC.indexOf('    registerVersion(plan.quarterId, newVersionNo, sheetName');
  const end = SRC.indexOf('\n  return {', at);
  // ⚠️ 呢一段本來喺一個 `try {` 入面，所以要自己補返個 `try {`——
  // 唔補嘅話嗰個 `} catch` 會唔對稱。
  const tail = 'try {' + SRC.slice(at, end);
  const runTail = new Function('ctx', 'with (ctx) {'
    + 'const plan = { quarterId: "2028T3", baseVersionNo: 2 };'
    + 'const newVersionNo = 3; const sheetName = "Roster_2028T3_v3";'
    + 'const basis = null; const versionNote = ""; const warnings = []; const changeCounts = null;'
    + 'const outcomes = []; const pendingBackfillCells = [];'
    + 'const newEligibilityRows = []; const newUnavailableRows = [];'
    + 'let newEligibilityCount = 0; let newUnavailableCount = 0;'
    + tail + '}');

  let threw = '';
  try { runTail(gas); } catch (err) { threw = err.message; }
  checkEqual('★★★★★ 冇拋錯', threw, '');
  checkEqual('★★★★★★ **加完行之後跟住發佈**'
    + '——冇嘅話，步驟 3 造咗 v3 而收到連結嘅人仍然見住 v2，'
    + '而中間冇任何一個畫面提示過',
    box.calls.join(' → '), 'register:v3 → publish');
}

// =====================================================================
console.log('\n=== A2【核心】微調 ▸ 套用決定：加完行一定跟住發佈 ===');
{
  // ⚠️ 呢一條**唔喺 Ivan 嗰張清單上面**，係由資料嗰邊數出嚟嘅。
  const box = sandbox([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs', 'FineTune.gs'
  ]);
  const gas = box.gas;
  gas.createRosterSheet = function () { return 'Roster_2028T3_v4'; };
  gas.writeAssignments = function () {};
  gas.markProposalsApplied_ = function () {};
  gas.archiveOldProposals_ = function () { return 0; };
  gas.findLatestVersionNo = function () { return 4; };

  const SRC = read('src/FineTune.gs');
  const at = SRC.indexOf('  registerVersion(quarterId, newVersionNo, sheetName, VERSION_VALUES.BASIS_FINE_TUNE');
  const end = SRC.indexOf('\n  return {', at);
  const tail = SRC.slice(at, end);
  const runTail = new Function('ctx', 'with (ctx) {'
    + 'const quarterId = "2028T3"; const newVersionNo = 4;'
    + 'const sheetName = "Roster_2028T3_v4"; const baseVersionNo = 3;'
    + 'const warnings = []; const batchId = "B1";'
    + tail + ' return publish; }');

  let publish = null;
  let threw = '';
  try { publish = runTail(gas); } catch (err) { threw = err.message; }
  checkEqual('★★★★★ 冇拋錯', threw, '');
  checkEqual('★★★★★★ **加完行之後跟住發佈**'
    + '——`applyDecisions()` 係第二條漏咗嘅路，'
    + '而由「某支函式嘅 caller」數起嗰陣完全見唔到佢',
    box.calls.join(' → '), 'register:v4 → publish');
  check('★★★★★ 而且拎得返個結果出嚟畀呼叫端講',
    publish && publish.failed === false, JSON.stringify(publish));
}

// =====================================================================
console.log('\n=== A2 其餘四條：核實佢哋本來就有 ===');
{
  // ⚠️ 「查過，有」都要寫——冇寫嘅話，下一次 audit 又要由零查一次。
  const CODE = function (rel) {
    return read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  };
  const cases = [
    { id: '生成（4 個入口共用）', file: 'src/MultiRun.gs',
      note: '`performRosterGeneration_()` 自己唔發佈，四個 caller 各自發佈',
      callers: ['src/WebAppGenerate.gs', 'src/WebApp.gs', 'src/Menu.gs',
        'src/FourStageFlow.gs'] },
    { id: '儲存並確認', file: 'src/WebAppSaveConfirm.gs' },
    { id: '接受系統建議', file: 'src/SuggestionSheet.gs' },
    { id: '回退執行', file: 'src/WebAppRollback.gs' },
    // 第六十七輪批次 AF 組
    { id: '匯入人手編好的職事表', file: 'src/RosterImport.gs' }
  ];
  cases.forEach(function (c) {
    if (c.callers) {
      c.callers.forEach(function (f) {
        check('★★★★★ 【' + c.id + '】' + f.replace('src/', '')
          + ' 有 `tryPublishPublicRoster_()`',
          /tryPublishPublicRoster_\(quarterId\)/.test(CODE(f)), '');
      });
      return;
    }
    check('★★★★★ 【' + c.id + '】' + c.file.replace('src/', '')
      + ' 同一個檔案入面有 `tryPublishPublicRoster_()`',
      /tryPublishPublicRoster_\(/.test(CODE(c.file)), '');
  });
}

// =====================================================================
console.log('\n=== A2 匯入人手編好的職事表：加完行一定跟住發佈（第六十七輪批次 AF 組）===');
{
  const box = sandbox([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'WebAppGuards.gs', 'WebAppSaveConfirm.gs', 'RosterImport.gs'
  ]);
  const gas = box.gas;
  // 只留住「造版本 ＋ 發佈」嗰一段，檢查同寫入全部換走。
  gas.buildImportPlan_ = function () {
    return {
      quarterId: '2028T3', sheetName: '匯入_2028T3', blocked: false, filledCount: 5,
      hasVersion: true, latestVersionNo: 3, versionNoToCreate: 4,
      confirmText: gas.IMPORT_CONFIRM_TEXT, needsRelease: false,
      violations: { real: [], released: [], structural: [], semiHard: [] }, blankCells: [],
      assignments: []
    };
  };
  gas.getConfig = function (k, d) { return d; };
  gas.createRosterSheet = function () { return 'Roster_2028T3_v4'; };
  gas.writeAssignments = function () {};
  gas.protectV0 = function () {};
  gas.writeAuditLog_ = function () {};
  gas.getQuarterStage_ = function () { return 'DRAFT'; };
  gas.buildGridSheetUrl_ = function () { return ''; };
  const r = gas.apiImportRosterExecute('2028T3', { confirmText: gas.IMPORT_CONFIRM_TEXT, sentExternally: false });
  checkEqual('★★★★★★ 加行 → 發佈', box.calls.join(' → '), 'register:v4 → publish');
  check('★★★★★ 而且拎得返個結果出嚟畀呼叫端講', r.publishFailed === false, JSON.stringify(r));
}

// =====================================================================
console.log('\n=== A1【核心】已經發佈咗最新嗰版 ⇒ 唔使再發一次 ===');
{
  // ⚠️ `applyRequests_()` 而家自己發佈，而「儲存並確認」有申報嗰條路
  // 行過佢之後仲會自己再發一次。冇呢一道，最常撳嗰粒掣會發佈兩次，
  // 而發佈要開／寫一個外部試算表——唔係平嘢。
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs'
  ]);
  let published = 0;
  gas.log_ = function () {};
  gas.publishPublicRoster_ = function () { published++; };
  gas.findLatestVersionNo = function () { return 3; };
  gas.findPublicLinkRow_ = function () { return { lastPublishedVersion: 3 }; };
  // 第六十三輪批次 A 組：「已經係最新」而家仲要睇同一版發佈之後有冇人改過
  //（`evaluatePublicLinkFreshness_()`）。呢度嘅情境係「冇人改過」，
  // 所以長表一格都冇 UpdatedAt。
  gas.readSheet = function () { return []; };
  gas.getConfig = function (_k, d) { return d; };

  const first = gas.tryPublishPublicRoster_('2028T3');
  checkEqual('★★★★★★ 已經係第 3 版 ⇒ **唔再發一次**', published, 0);
  checkEqual('★★★★★ 而且唔算失敗', first.failed, false);
  checkEqual('★★★★★ 而且標住 `skipped`', first.skipped, true);

  gas.findPublicLinkRow_ = function () { return { lastPublishedVersion: 2 }; };
  gas.tryPublishPublicRoster_('2028T3');
  checkEqual('★★★★★★ 而家係第 2 版 ⇒ **一定要發**', published, 1);

  // ⚠️ 查唔到就照發。當成「已經發咗」係最差嗰種錯。
  published = 0;
  gas.findPublicLinkRow_ = function () { throw new Error('PublicLinks 讀不到'); };
  gas.tryPublishPublicRoster_('2028T3');
  checkEqual('★★★★★★ **查唔到就照發**'
    + '——當成「已經發咗」嘅話，收到連結嘅人會一直見住舊版，'
    + '而冇任何一個畫面提示過',
    published, 1);

  published = 0;
  gas.findPublicLinkRow_ = function () { return null; };
  gas.tryPublishPublicRoster_('2028T3');
  checkEqual('★★★★★ 未發佈過一樣要發', published, 1);
}

// =====================================================================
console.log('\n=== A1 幹事撳「重試」嗰粒一定要迫佢再發 ===');
{
  // ⚠️ `apiRepublishPublicLink()` 行 `publishPublicRoster_()`，
  // **唔經**「已經係最新就唔使再發」嗰一道——重試就係要迫佢再發一次。
  const CODE = read('src/WebAppGuards.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = CODE.slice(CODE.indexOf('function apiRepublishPublicLink('));
  check('★★★★★★ 佢叫 `publishPublicRoster_()`，唔係 `tryPublishPublicRoster_()`'
    + '——經咗嗰一道嘅話，一個「發佈失敗但版本號啱」嘅情況就永遠重試唔到',
    /publishPublicRoster_\(quarterId\);/.test(fn)
      && !/tryPublishPublicRoster_\(/.test(fn.slice(0, 900)), fn.slice(0, 500));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
