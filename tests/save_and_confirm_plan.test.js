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
  checkEqual('★★★★★ REVIEW_SENT ⇒ 只前進 Stage（＝堂委冇意見，'
    + '唔建版本但要令掣 3 亮起）', gas.resolveZeroChangeAction_(S.REVIEW_SENT), 'ADVANCE_STAGE_ONLY');
  checkEqual('★★★★ REQUESTS_APPLIED ⇒ 乜都唔做',
    gas.resolveZeroChangeAction_(S.REQUESTS_APPLIED), 'NOTHING');
  checkEqual('★★★★ OFFICIAL_SENT ⇒ 乜都唔做',
    gas.resolveZeroChangeAction_(S.OFFICIAL_SENT), 'NOTHING');
  check('★★★★★ **只有一個 Stage 會前進**——如果多過一個，'
    + '就會出現「零改動但 Stage 走咗兩格」呢種講唔出理由嘅行為',
    [S.DRAFT, S.REVIEW_SENT, S.REQUESTS_APPLIED, S.OFFICIAL_SENT]
      .filter(function (st) { return gas.resolveZeroChangeAction_(st) === 'ADVANCE_STAGE_ONLY'; })
      .length === 1);
}

console.log('\n=== 步 1.2【核心】認唔出姓名 ⇒ 立即阻擋，冇「略過繼續」出口 ===');
{
  check('★★★★★ unresolved.length > 0 就即刻 return blocked，'
    + '**唔做之後任何一步**（唔會走到申報、規則檢查）',
    /if \(resolved\.unresolved\.length > 0\) \{[\s\S]{0,400}?return blocked\('UNRESOLVED_NAMES'/.test(SRC));

  check('★★★★★ 完全冇提供「略過這幾格繼續」嘅選項'
    + '——認唔出就係認唔出，猜係第十九／二十輪嗰一類 bug 嘅溫床',
    SRC.indexOf('略過') === -1 || !/skipUnresolved|ignoreUnresolved|forceContinue/.test(SRC));

  // ⚠️ 第三十五輪批次 B 組：而家要送**兩個值**。
  // 原本只送一個（而且欄位名寫錯咗，永遠 fallback 到空字串），
  // 令對話框話幹事打咗空白，但 grid 上明明有字。
  check('★★★★ 阻擋時會列出日期／崗位（規格步 1.2）',
    /serviceDate: u\.serviceDate[\s\S]{0,400}?postNameTC:/.test(SRC));
  check('★★★★★ 而且**兩個值都送**：格內現在有咩 ＋ 本來應該係咩'
    + '——只送一個就永遠分唔出係邊一邊出事',
    /gridText: u\.text/.test(SRC) && /expectedText: u\.expectedText/.test(SRC));
  // ⚠️ 只查 unresolved 嗰段——`manualText` 喺 `changes` 嗰邊係**真實存在**
  // 而且要用嘅欄位（`gridChanges`／`overlaps` 都靠佢），唔可以一竹篙打一船人。
  {
    const start = SRC.indexOf('unresolved: resolved.unresolved.map');
    const block = start === -1 ? '' : SRC.slice(start, start + 700);
    check('★★★★★ unresolved 嗰段唔可以再讀 `u.manualText`／`u.rawText`'
      + '（`buildGridOverlayState_()` 推入 unresolved 嗰陣用嘅欄位名係 `text`，'
      + '嗰兩個根本唔存在，所以永遠 fallback 到空字串）',
      block !== '' && !/u\.manualText/.test(block), block.slice(0, 300));
  }

  check('★★★★ 用返第二十輪已有嘅 buildUnresolvedGuidanceText_()，'
    + '唔喺呢度另寫一套指引',
    /buildUnresolvedGuidanceText_\(resolved\.unresolved\)/.test(SRC));
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
    /function apiSaveAndConfirmPlan\(quarterId\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(SRC));
  check('★★★★★ 規則狀態明確傳 GRID_OVERLAY，mode 唔可以省略（第十九輪）',
    /resolveAuthoritativeState_\(\s*\n?\s*context, STATE_SOURCE\.GRID_OVERLAY, 'apiSaveAndConfirmPlan'\)/.test(SRC));
  check('★★★★★ plan 完全冇寫入（冇 write／setValue／advanceQuarterStage_ 之類）',
    !/function buildSaveAndConfirmPlan_[\s\S]*?\n\}/.exec(SRC)[0].match(/writeAssignments|createRosterSheet|registerVersion|setValue|advanceQuarterStage_|publishPublicRoster_/));
  check('★★★★ 三種 blockReason 都有（規格 2.4）',
    /'UNRESOLVED_NAMES'/.test(SRC) && /'NO_VERSION'/.test(SRC) && /'GRID_SHEET_MISSING'/.test(SRC));
  check('★★★★★ 三種阻擋都用三段式訊息（規格 1.5）',
    (SRC.match(/buildThreePartMessage_\(/g) || []).length >= 3);
  checkEqual('★★★★★ 打字確認字串係「確認」兩個字（規格 1.4.4），'
    + '唔係舊 Web UI 嗰個「確認放行」',
    gas.SAVE_CONFIRM_RELEASE_TEXT, '確認');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
