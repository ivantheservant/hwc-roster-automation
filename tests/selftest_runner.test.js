// 第四十九輪批次 第 1 層：真環境自測機。
// 執行方式：node tests/selftest_runner.test.js
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份**證明唔到**自測機捉得到 bug
// ═════════════════════════════════════════════════════════════════════
//
// 自測機嘅價值喺真試算表——佢真嘅生成版本、真嘅寫 grid、真嘅走寄送流程。
// 喺 Node 沙箱入面冇試算表，所以呢一份驗唔到嗰件事。
//
// 佢守嘅係**自測機自己嗰幾條規矩唔可以被破**：
//
//   一、開跑之前嗰四道閘，任何一道都唔可以被繞過
//   二、狀態一定要由**真實入口**（`apiXxx`）造出嚟，
//       唔可以直接寫 `Quarters.Stage` 或者喺記憶體造 overlay
//   三、時間到要**乾淨停低並講明**，唔可以靜靜停
//   四、一個情境爆咗，後面嗰啲要照跑
//   五、每一個情境跑完都要叫一次不變量
//
// ⚠️ 第二條係整層嘅根。破咗佢，呢一層就退化成第 171 條假綠燈。

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
const SRC = read('src/SelfTestRunner.gs');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs'
]);

// =====================================================================
console.log('\n=== 一【核心】開跑之前四道閘，一道都唔可以繞過 ===');
{
  // ⚠️ 自測機會**真嘅清一整季**。行錯咗一季就係真係整爛咗嘢。
  const base = {
    DRY_RUN: true,
    WEBAPP_ENABLED: true,
    QUARTER_RESET_BLOCKED_QUARTERS: '2026T4',
    REHEARSAL_PROTECTED_QUARTERS: '2027T1'
  };
  const withConfig = function (over) {
    const c = Object.assign({}, base, over || {});
    gas.getConfig = function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(c, key) ? c[key] : fallback;
    };
    // ⚠️ **`readConfig()` 都要頂替。**
    //
    // `readQuarterResetBlockedQuarters_()` 同 `readSelfTestQuarterDetail_()`
    // 行嘅係 `getConfigWithSourceSafe_()` → `getConfigWithSource()` →
    // `readConfig()`，唔經 `getConfig()`。淨係頂替 `getConfig()` 嘅話，
    // `readConfig()` 會喺沙箱度撞到 `CacheService` 個 trap 而拋錯，
    // 然後 `…Safe_()` 靜靜退回程式內建預設值。
    //
    // 結果：斷言仍然綠，但佢**驗緊嘅唔係我以為嗰件事**——
    // 佢驗緊「內建預設值啱唔啱」，而唔係「Config 嗰一格生唔生效」。
    // 呢個就係本輪要處理嗰種假綠燈嘅最細一個樣。
    gas.readConfig = function () { return c; };
  };
  gas.getQuarterStage_ = function () { return 'DRAFT'; };

  withConfig({});
  checkEqual('★★★★★ 一切正常 ⇒ 過閘',
    gas.checkSelfTestPreconditions_('2028T3').ok, true);

  // ── 閘 1　DRY_RUN ────────────────────────────────────────────
  withConfig({ DRY_RUN: false });
  let gate = gas.checkSelfTestPreconditions_('2028T3');
  checkEqual('★★★★★★ `DRY_RUN=FALSE` ⇒ **唔准跑**'
    + '——自測機會走完整個寄送流程，'
    + 'DRY_RUN=FALSE 嗰陣嗰啲信會真係寄出去', gate.ok, false);
  check('★★★★★ 而且要講得出係因為呢個',
    /DRY_RUN/.test(gate.reasons.join('')), JSON.stringify(gate.reasons));

  // ⚠️ 讀唔到（`undefined`）**唔算通過**。
  withConfig({ DRY_RUN: undefined });
  checkEqual('★★★★★★ `DRY_RUN` 讀唔到 ⇒ **一樣唔准跑**'
    + '——「查不到」同「查到係 TRUE」係兩件事，'
    + '而估錯嗰邊嘅代價係真係寄信',
    gas.checkSelfTestPreconditions_('2028T3').ok, false);

  // ── 閘 2　受保護季度 ─────────────────────────────────────────
  withConfig({});
  gate = gas.checkSelfTestPreconditions_('2026T4');
  checkEqual('★★★★★★ 沙盒季度落喺 `QUARTER_RESET_BLOCKED_QUARTERS` ⇒ 唔准跑'
    + '——自測機每次開跑都會把佢清乾淨', gate.ok, false);
  gate = gas.checkSelfTestPreconditions_('2027T1');
  checkEqual('★★★★★★ 落喺 `REHEARSAL_PROTECTED_QUARTERS` ⇒ 一樣唔准跑',
    gate.ok, false);
  checkEqual('★★★★★ 大細楷唔理',
    gas.checkSelfTestPreconditions_('2026t4').ok, false);

  // ── 閘 3　Stage ──────────────────────────────────────────────
  gas.getQuarterStage_ = function () { return 'OFFICIAL_SENT'; };
  gate = gas.checkSelfTestPreconditions_('2028T3');
  checkEqual('★★★★★★ Stage 已經係 `OFFICIAL_SENT` ⇒ 唔准跑'
    + '——嗰個代表已經正式發出畀全體，唔係一個沙盒季度', gate.ok, false);
  gas.getQuarterStage_ = function () { return 'DRAFT'; };

  // ── 閘 4　真實入口要求 Web UI 開著 ───────────────────────────
  withConfig({ WEBAPP_ENABLED: false });
  gate = gas.checkSelfTestPreconditions_('2028T3');
  checkEqual('★★★★★★ `WEBAPP_ENABLED` 唔係 TRUE ⇒ **停低，唔會退回去叫入面嗰啲函式**'
    + '——退回去就等於冇行過真實入口，'
    + '而第四十七輪個 bug 正正就係喺入口嗰串前置檢查嘅次序入面',
    gate.ok, false);
  check('★★★★★ 而且講明唔會自動改 Config',
    /不會自動改它/.test(gate.reasons.join('')), JSON.stringify(gate.reasons));

  // ── 沙盒季度空白 ⇒ 退回內建預設，唔係「隨便揀一季」 ──────────
  withConfig({ SELFTEST_QUARTER_ID: '' });
  checkEqual('★★★★★★ Config 填成空白 ⇒ 退回內建預設，唔會變成隨便一季',
    gas.readSelfTestQuarterDetail_().value, '2028T3');
}

// =====================================================================
console.log('\n=== 二【核心】狀態一定要由真實入口造出嚟 ===');
{
  // ⚠️⚠️ 呢一條係整層嘅根。
  //
  // 要一個「已經寄過審閱、有 2 格未儲存改動」嘅狀態，唯一合法嘅做法係
  // 真嘅叫 `apiGenerateDraftExecute()` → 真嘅寫 grid → 真嘅 `apiStep2Confirm()`。
  // 直接寫 `Quarters.Stage = 'REVIEW_SENT'` 然後喺 grid 塞兩格，
  // 就係「fixture 造到一個真實 code path 造唔出嘅狀態」——
  // 即係呢一層要擋嗰件事本身。
  check('★★★★★★ 冇一句直接寫 `Quarters.Stage`'
    + '——直接寫就係人手砌狀態，而人手砌嘅狀態證明唔到任何嘢',
    !/setQuarterStage_\(/.test(CODE) && !/advanceQuarterStage_\(/.test(CODE),
    '找到直接改 Stage 的呼叫');

  check('★★★★★★ 冇一句直接寫 `RosterAssignments`'
    + '——派工要由 `apiGenerateDraftExecute()` 真嘅生成出嚟',
    !/SHEETS\.ROSTER_ASSIGNMENTS[\s\S]{0,80}appendRow/.test(CODE), '');

  // 每一個造狀態嘅動作，都要經過一個 `apiXxx`。
  const mustCall = [
    'apiGenerateDraftExecute(', 'apiSaveAndConfirmExecute(', 'apiStep2Confirm(',
    'apiStep3Apply(', 'apiStep4Confirm(', 'apiStep5Plan(',
    'apiGeneratePersonalPdfBatch(', 'apiGetDashboardState(', 'apiGetSendPlanSummary('
  ];
  const missing = mustCall.filter(function (fn) { return CODE.indexOf(fn) === -1; });
  checkEqual('★★★★★★ 九個真實入口全部有叫到'
    + '——跳過入口去叫入面嗰啲函式，就跳過咗成串前置檢查',
    JSON.stringify(missing), '[]');

  check('★★★★★★ grid 改動係**真嘅寫張工作表**，唔係喺記憶體造 overlay',
    /sheet\.getRange\(i \+ 3, col\)\.setValue\(text\);/.test(CODE), '');
}

// =====================================================================
console.log('\n=== 三【核心】時間到要乾淨停低並講明 ===');
{
  check('★★★★★ 有時間預算檢查',
    /function selfTestOutOfTime_\(/.test(CODE), '');
  // ⚠️ 要驗**推入 `results` 嗰個物件本身**用 `NOT_RUN`。
  // 用一個「附近 200 個字之內有冇 NOT_RUN」嘅寬鬆比對嘅話，
  // 把嗰一句改成 `PASSED` 都仍然綠——因為下一行嘅 `state[...]`
  // 一樣有 `NOT_RUN`。verify-red 嗰陣就係噉捉到。
  check('★★★★★★ 停低嗰陣**推入報告嗰個結果**要標成 `NOT_RUN`'
    + '——靜靜停低就會變成「跑完了，全綠」嘅假象，'
    + '而嗰個假象比冇跑過更差',
    /results\.push\(\{ id: scenario\.id, title: scenario\.title,\s*\n\s*status: SELFTEST_STATUS\.NOT_RUN,/
      .test(CODE), '');
  check('★★★★★★ 而且嗰一個結果要帶住一句「已停低」畀人睇',
    /status: SELFTEST_STATUS\.NOT_RUN,[\s\S]{0,160}已停低/.test(SRC), '');
  check('★★★★★★ 而且報告要講「撳繼續跑自測」',
    /繼續跑自測/.test(SRC), '');
  check('★★★★★ 有續跑入口',
    /function runSelfTestMachineResumeFromMenu_\(/.test(CODE)
      && /runSelfTestMachineResumeFromMenu_/.test(read('src/Menu.gs')), '');
  check('★★★★★★ 每一個情境跑完即刻寫狀態'
    + '——等成批完先寫嘅話，中途被系統斬斷就乜都冇',
    /writeSelfTestState_\(state\);[\s\S]{0,120}catch/.test(CODE), '');
}

// =====================================================================
console.log('\n=== 四【核心】一個爆咗，後面照跑；而且每個都叫不變量 ===');
{
  // ⚠️ 唔可以淨係搵「catch 附近有冇 ERROR」——喺 catch 第一句塞一個
  // `throw err;` 之後，個 `ERROR` 字仍然喺後面，而斷言照樣綠。
  const runnerBody = CODE.slice(CODE.indexOf('function runSelfTestMachine_('));
  const scenarioCatch = runnerBody.slice(runnerBody.indexOf('outcome = scenario.run(quarterId);'));
  const catchBody = scenarioCatch.slice(scenarioCatch.indexOf('} catch (err) {'),
    scenarioCatch.indexOf('} catch (err) {') + 500);
  check('★★★★★★ 情境拋錯要 catch 住報 `ERROR`，唔可以令成批停低',
    /SELFTEST_STATUS\.ERROR/.test(catchBody), catchBody.slice(0, 200));
  check('★★★★★★ 而且 catch 入面**冇一句** `throw`'
    + '——rethrow 咗就等於冇 catch 過，而後面九個情境全部唔會跑',
    !/throw /.test(catchBody), catchBody.slice(0, 200));
  check('★★★★★ 而且帶住實際錯誤原文',
    /error: err\.message/.test(CODE), '');
  // 第五十輪批次 B1 組：每個情境只跑**快嗰批**，貴嗰批留到最尾。
  check('★★★★★★ 每一個情境跑完都叫一次不變量（快嗰批）',
    /outcome = scenario\.run\(quarterId\);[\s\S]{0,1200}runAllInvariants_\(quarterId, INVARIANT_SET\.PER_SCENARIO\)/
      .test(CODE), '');
  check('★★★★★★ 而全部情境跑完之後一次過跑貴嗰批'
    + '——I04 掃全表 10,920 行、I08 每條要行一次完整 plan，'
    + '每個情境都跑就 6 分鐘內完全唔可能',
    /runAllInvariants_\(quarterId, INVARIANT_SET\.FINAL\)/.test(CODE), '');
  check('★★★★★★ 仲有情境未跑嗰陣**唔跑**貴嗰批'
    + '——跑埋只會食埋下一次續跑嘅時間預算',
    /if \(!stoppedForTime\) \{[\s\S]{0,300}INVARIANT_SET\.FINAL/.test(CODE), '');
  check('★★★★★★ 情境自己全綠而不變量紅咗 ⇒ **整體算紅**'
    + '——唔係噉嘅話，一個「畫面同表對唔上」會被一份綠色報告蓋住',
    /outcome\.invariantFailed > 0 && outcome\.status === SELFTEST_STATUS\.PASSED[\s\S]{0,120}SELFTEST_STATUS\.FAILED/
      .test(CODE), '');
  check('★★★★★ 不變量算唔出 ⇒ 情境算 `ERROR`，唔可以當冇事',
    /outcome\.invariantFailed = -1;[\s\S]{0,200}SELFTEST_STATUS\.ERROR/.test(CODE), '');
}

// =====================================================================
console.log('\n=== 五 情境要獨立、可以單獨重跑 ===');
{
  const ids = (CODE.match(/function selfTestS\d\d_\(/g) || []);
  check('★★★★★ S01–S15 每一個都係獨立函式',
    ids.length >= 15, JSON.stringify(ids));
  const registry = CODE.slice(CODE.indexOf('function selfTestScenarios_('));
  ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10',
    'S11', 'S12', 'S13', 'S14', 'S15']
    .forEach(function (id) {
      check('★★★★ ' + id + ' 有登記', registry.indexOf("'" + id + "'") !== -1, '');
    });

  // ── S12 唔准真係回退 ────────────────────────────────────────
  //
  // ⚠️ 回退會蓋走現況，而後面 S13–S15 全部靠住嗰個現況。
  // 一個「順手做埋佢」嘅情境，會令後面幾個情境驗緊一個
  // 佢哋以為冇變過嘅狀態——而嗰個就係最難查嗰種假紅。
  const s12 = CODE.slice(CODE.indexOf('function selfTestS12_('),
    CODE.indexOf('function selfTestS13_('));
  check('★★★★★★ S12 只叫 `apiRollbackPlan()`，唔叫 `apiRollbackExecute()`'
    + '——回退會蓋走現況，而後面幾個情境全部靠住嗰個現況',
    /apiRollbackPlan\(/.test(s12) && !/apiRollbackExecute\(/.test(s12), s12.slice(0, 300));

  // ── S14／S15 係第四十七輪兩個 bug 嘅真環境防線 ────────────────
  const s14 = CODE.slice(CODE.indexOf('function selfTestS14_('),
    CODE.indexOf('function selfTestS15_('));
  // ⚠️ 第五十一輪批次 C3 組：重新生成改咗行 `apiGenerateRoster()`
  //（「進階功能 ▸ 重新生成初稿（覆蓋式）」嗰條路）。
  // `apiGenerateDraftExecute()` 喺一個已經有版本嘅季度上面只會回
  // `{ok:false}`，乜都唔做——而第五十輪嗰次 S14 就係噉樣攞住一個
  // 舊版本去驗，報咗一句完全誤導嘅結論。
  check('★★★★★★ S14 真嘅 append 一行落 `SpecialSundays`，然後真嘅重新生成'
    + '——喺記憶體造一個 overlay 就係「fixture 造到一個'
    + '真實 code path 造唔出嘅狀態」',
    /sheet\.appendRow\(row\);/.test(s14) && /apiGenerateRoster/.test(s14),
    s14.slice(0, 200));
  check('★★★★★★ 而且驗埋「唔可以係『待確認』」'
    + '——「待確認」＝「未派到人」，而呢一格係「特登唔派」。'
    + '兩者對幹事嚟講差好遠',
    /待確認/.test(s14), '');
}

// =====================================================================
console.log('\n=== 六 S04 就係第四十七輪嗰個死碼 ===');
{
  const s04 = CODE.slice(CODE.indexOf('function selfTestS04_('),
    CODE.indexOf('function selfTestS05_('));
  check('★★★★★★ S04 由**真實嘅 `kind`** 驗，唔係直接呼叫嗰個分支'
    + '——第四十輪寫好嘅嗰個對話框，由寫出嚟到第四十七輪一次都冇執行過，'
    + '因為測試一直直接叫嗰個分支',
    /apiGetSendPlanSummary\(quarterId\)/.test(s04) && /s\.kind/.test(s04), s04.slice(0, 300));
  check('★★★★★★ 而且驗 `blockedByUnsavedOnly` 真係 true'
    + '——冇佢，前端會行去「現在沒有可以寄的東西」嗰一段',
    /blockedByUnsavedOnly === true/.test(s04), '');
}

// =====================================================================
console.log('\n=== 七 報告要拿得出證據 ===');
{
  const lines = gas.describeSelfTestReport_({
    blocked: false, quarterId: '2028T3', resetSummary: '已清乾淨',
    results: [{ id: 'S06', title: '寄給堂委審閱', status: 'FAILED',
      failedChecks: [{ label: 'preview 的人數 === 實際處理的封數',
        expected: '3', actual: '9',
        evidence: 'apiStep2Preview 回 recipientCount=3；apiStep2Confirm 回 {dryRun:9}' }],
      invariantDetail: [] }],
    passedCount: 0, failedCount: 1, errorCount: 0, notRunCount: 0,
    stoppedForTime: false
  }).join('\n');
  check('★★★★★★ 紅色嗰條要印**預期／實際／證據**三樣'
    + '——冇實際值嘅報告，等於逼下一個人由零查起，'
    + '而嗰個人好可能就係兩個月之後嘅自己',
    /預期：3/.test(lines) && /實際：9/.test(lines)
      && /證據：apiStep2Preview 回 recipientCount=3/.test(lines), lines);

  const blocked = gas.describeSelfTestReport_({
    blocked: true, quarterId: '2026T4',
    reasons: ['「2026T4」在 QUARTER_RESET_BLOCKED_QUARTERS 裡面。']
  }).join('\n');
  check('★★★★★★ 被閘擋住嗰陣要講明「沒有執行」同原因'
    + '——唔講嘅話，一份空白報告睇落同「全部通過」一模一樣',
    /自測機沒有執行/.test(blocked) && /QUARTER_RESET_BLOCKED_QUARTERS/.test(blocked),
    blocked);
}

// =====================================================================
console.log('\n=== 八 第 2 層 2A：錄影 ===');
{
  check('★★★★★ 每一次 API 呼叫都經 `selfTestCall_()` 順手錄低回傳值',
    /function selfTestCall_\(/.test(CODE)
      && /selfTestRecordPayload_\(scenarioId, apiName, value\)/.test(CODE), '');
  // ⚠️ 同上：要驗**成支函式入面冇一句 `throw`**，
  // 唔係驗「catch 後面有冇 log_」。
  const recordBody = CODE.slice(CODE.indexOf('function selfTestRecordPayload_('),
    CODE.indexOf('function selfTestCall_('));
  check('★★★★★★ 錄影失敗**唔可以**令情境失敗'
    + '——錄影係順手做嘅嘢，唔應該有權令一個情境變紅',
    /catch \(err\)/.test(recordBody) && /log_\('WARN'/.test(recordBody)
      && !/throw /.test(recordBody), recordBody.slice(-300));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
