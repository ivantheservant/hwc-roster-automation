// 第二十三輪批次階段 D：掣 1「儲存並確認」嘅 plan（步 1.1–1.6）。
// 執行方式：node tests/save_and_confirm_plan.test.js
//
// `buildSaveAndConfirmPlan_()` 本身要讀試算表，離線跑唔到；呢度測嘅係
// 佢入面抽得出嚟嘅純判斷，加上鎖住幾個**唔可以退化**嘅結構性要求。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppSaveConfirm.gs'
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

const S = gas.QUARTER_STAGE;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppSaveConfirm.gs'), 'utf8');

console.log('\n=== 決定 D4【核心】零改動路徑：邊個 Stage 做咩 ===');
{
  checkEqual('★★★★★ DRAFT ⇒ 乜都唔做', gas.resolveZeroChangeAction_(S.DRAFT), 'NOTHING');
  // 第八十二輪批次 IG 組（刻意改動）：正式發出唔再要求「意見已收齊」⇒ 審閱階段零改動都乜都唔做
  checkEqual('★★★★★ REVIEW_SENT ⇒ 乜都唔做（第八十二輪 IG 組）', gas.resolveZeroChangeAction_(S.REVIEW_SENT), 'NOTHING');
  checkEqual('★★★★ REQUESTS_APPLIED ⇒ 乜都唔做',
    gas.resolveZeroChangeAction_(S.REQUESTS_APPLIED), 'NOTHING');
  checkEqual('★★★★ OFFICIAL_SENT ⇒ 乜都唔做',
    gas.resolveZeroChangeAction_(S.OFFICIAL_SENT), 'NOTHING');
  check('★★★★★ **冇任何 Stage 會因為零改動而前進**（第八十二輪 IG 組）',
    [S.DRAFT, S.REVIEW_SENT, S.REQUESTS_APPLIED, S.OFFICIAL_SENT]
      .filter(function (st) { return gas.resolveZeroChangeAction_(st) === 'ADVANCE_STAGE_ONLY'; })
      .length === 0);
}

console.log('\n=== 步 1.2（第七十五輪 CE／CG 組）認唔出姓名唔再即時擋，改為逐個決定 ===');
{
  // ⚠️ 第七十五輪批次 CE 組（Ivan 決定）：名單上搵唔到嘅名每一個有〔加入名單〕或
  // ☐「這一季臨時幫手，不加入名單」。未決定嘅喺確認畫面即場列出，全部決定咗先可以儲存
  //（execute 會再驗一次——`needsDecision`）。
  check('★★★★★ plan 唔再因 unresolved 而 return blocked',
    !/return blocked\('UNRESOLVED_NAMES'/.test(SRC));
  check('★★★★★ 未決定嘅名、未決定嘅一定要遵守違反 ⇒ needsDecision',
    /needsDecision: undecidedNames\.length > 0 \|\| undecidedRuleItems\.length > 0/.test(SRC));
  check('★★★★★ 決定項目同〔檢查我的改動〕用同一支 buildDecisionItems_()',
    /buildDecisionItems_\(context, resolved\.unresolved, allViolations,/.test(SRC));
  check('★★★★ 仍然冇「略過這幾格繼續」嘅出口（要逐個決定，唔係一鍵略過）',
    !/skipUnresolved|ignoreUnresolved|forceContinue/.test(SRC));
}

console.log('\n=== 步 1.4【核心】同一格既有 grid 改動又有申報 ⇒ grid 贏 ===');
{
  check('★★★★★ 有 overlaps 一節（規格步 1.4 要求確認畫面獨立列出）',
    /overlaps/.test(SRC));
  // ⚠️ 第三十九輪批次（順手）：呢一段搬咗去共用嘅
  // `findRequestGridOverlaps_()`（RequestsApply.gs），因為
  // `applyRequests_()` 嗰邊本來寫住一段一模一樣嘅。
  // 兩個真相來源係本專案反覆出事嗰一類，所以合併。
  const OVERLAP_SRC = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'RequestsApply.gs'), 'utf8');
  check('★★★★★ overlaps 逐項講得出「申報想改成」同「你表上是」',
    /requestWants:/.test(OVERLAP_SRC) && /gridHas:/.test(OVERLAP_SRC));
  check('★★★★★ 而且空白都要講得出係空白'
    + '——寫一個空字串落畫面，幹事會以為系統壞咗',
    /gridHas: cell\.personName \|\| '（空白）'/.test(OVERLAP_SRC));
  check('★★★★★ 掣 1 嗰條路真係叫嗰個共用函式',
    /findRequestGridOverlaps_\(requestPlan/.test(SRC));
  check('★★★★★ 註解講明「grid 贏」同點解'
    + '（幹事親手改嗰個係最新真相；申報係之前提交嘅）',
    /grid 贏/.test(SRC) && /最新真相/.test(SRC));
}

console.log('\n=== 步 1.5【核心】違反三分類＋準硬，四組分開 ===');
{
  const RULE_LEVELS = gas.RULE_LEVELS;
  const v = function (severity, ruleId) {
    return { severity: severity, ruleId: ruleId, serviceDate: '2026-11-08', postId: 'ANNOUNCE', slotIndex: 1 };
  };
  const structuralRuleId = gas.STRUCTURAL_NA_RULE_IDS[0];

  // classifyHardViolations_ 要讀 AuditLog，離線會拋錯 ⇒ 走 catch 分支，
  // 全部當真違反。呢個 fallback 本身就係要測嘅重點之一。
  const result = gas.classifySaveConfirmViolations_('2026T4', 1, [
    v(RULE_LEVELS.HARD, 'HARD_ROLE_REQUIRED'),
    v(RULE_LEVELS.HARD, structuralRuleId),
    v(RULE_LEVELS.SEMI_HARD, 'SEMI_ADJACENT_WEEK')
  ]);

  checkEqual('★★★★★ 結構性不適用單獨一組（唔應該叫幹事去「處理」）',
    result.structural.length, 1);
  checkEqual('★★★★★ 準硬規則單獨一組（顯示但唔阻擋）', result.semiHard.length, 1);
  checkEqual('★★★★★ 分類失敗時 **一律當真違反**，唔可以靜靜當成「已放行」'
    + '——寧可多要一次打字確認，都好過把真違反歸類成「唔使理」',
    result.real.length, 1);
  checkEqual('★★★★ 分類失敗時 released 係空（冇證據就唔可以話已放行）',
    result.released.length, 0);

  check('★★★★★ 真違反重用第二十一輪嘅 classifyHardViolations_()，'
    + '唔喺呢度重新判斷一次',
    /classifyHardViolations_\(/.test(SRC));
  check('★★★★★ catch 分支有註解講明「一律當真違反」嘅理由',
    /一律當成真違反/.test(SRC));
}

console.log('\n=== 步 1.6：三欄對照 ===');
{
  check('★★★★★ 只有「有違反」嘅格先會有建議欄'
    + '——冇違反嘅格提建議會令幹事以為自己改錯咗',
    /if \(violation\) \{[\s\S]{0,300}?suggested = /.test(SRC));
  check('★★★★★ 建議唔可以係佢自己改嗰個，亦唔可以係原本嗰個'
    + '（否則「建議」等於冇建議）',
    /id !== c\.personId && id !== original\.personId/.test(SRC));
  check('★★★★★ 原本係空白時「改回原本」要禁用，前端靠 canRevertToOriginal'
    + '（規格步 1.6：不能改回一個從來冇存在過嘅值）',
    /canRevertToOriginal: !!original\.personId/.test(SRC));
}

console.log('\n=== 結構性要求 ===');
{
  check('★★★★★ apiSaveAndConfirmPlan 第一行 assertWebAppRequestAllowed_()',
    /function apiSaveAndConfirmPlan\(quarterId\) \{\s*\n\s*assertWebAppRequestAllowed_\('apiSaveAndConfirmPlan'\);/.test(SRC));
  check('★★★★★ 規則狀態明確傳 GRID_OVERLAY，mode 唔可以省略（第十九輪）',
    /resolveAuthoritativeState_\(\s*\n?\s*context, STATE_SOURCE\.GRID_OVERLAY, 'apiSaveAndConfirmPlan'\)/.test(SRC));
  check('★★★★★ plan 完全冇寫入（冇 write／setValue／advanceQuarterStage_ 之類）',
    !/function buildSaveAndConfirmPlan_[\s\S]*?\n\}/.exec(SRC)[0].match(/writeAssignments_|createRosterSheet_|registerVersion_|setValue|advanceQuarterStage_|publishPublicRoster_/));
  // 第七十五輪批次 CE 組：UNRESOLVED_NAMES 唔再係 blockReason（改為逐個決定）
  check('★★★★ 兩種 blockReason（NO_VERSION／GRID_SHEET_MISSING）都有',
    /'NO_VERSION'/.test(SRC) && /'GRID_SHEET_MISSING'/.test(SRC));
  check('★★★★★ 三種阻擋都用三段式訊息（規格 1.5）',
    (SRC.match(/buildThreePartMessage_\(/g) || []).length >= 3);
  checkEqual('★★★★★ 打字確認字串係「確認」兩個字（規格 1.4.4），'
    + '唔係舊 Web UI 嗰個「確認放行」',
    gas.SAVE_CONFIRM_RELEASE_TEXT, '確認');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
