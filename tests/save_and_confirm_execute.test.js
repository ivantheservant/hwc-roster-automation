// 第二十三輪批次階段 D：掣 1「儲存並確認」嘅 execute（步 1.7–1.9）。
// 執行方式：node tests/save_and_confirm_execute.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試最關心嘅三件事
// ─────────────────────────────────────────────────────────────────────
//
// 1. **預覽過期偵測**——幹事由睇預覽到撳確認之間可能過咗幾分鐘，
//    期間 grid 可能被改過。照住一份過時預覽寫入，結果就係寫入咗一個
//    **冇人審視過**嘅版本，而畫面會顯示「成功」。
// 2. **放行文字檢查**——有真違反而冇打「確認」一律拒絕。
// 3. **發佈失敗唔算全盤失敗**——版本已經寫好咗，如果當成失敗，
//    幹事會以為要重做，噉就會建立第二個內容一樣嘅版本。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppSaveConfirm.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkThrows(label, fn, mustContain) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ok = threw !== null && (!mustContain || String(threw.message).indexOf(mustContain) !== -1);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log('      ' + (threw ? '訊息缺「' + mustContain + '」：' + threw.message : '完全冇拋錯'));
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppSaveConfirm.gs'), 'utf8');

function planWith(cells) {
  return {
    proposals: cells.map(function (c) {
      return { serviceDate: c[0], postId: c[1], slotIndex: c[2] };
    }),
    gridChanges: []
  };
}

console.log('\n=== D-2 步 2【核心】預覽過期偵測 ===');
{
  const plan = planWith([['2026-11-08', 'ANNOUNCE', 1], ['2026-11-15', 'CHAIR', 1]]);

  let ok = true;
  try {
    gas.assertSaveConfirmPlanStillFresh_(plan, [
      { serviceDate: '2026-11-08', postId: 'ANNOUNCE', slotIndex: 1 }
    ]);
  } catch (e) { ok = false; }
  check('★★★★★ 決定對應得返同一批格 ⇒ 放行', ok);

  checkThrows('★★★★★ 決定入面有一格而家已經唔喺 plan 入面 ⇒ 拒絕'
    + '（代表中間有人改過 grid，剛才嗰份預覽已經過期）',
    function () {
      gas.assertSaveConfirmPlanStillFresh_(plan, [
        { serviceDate: '2026-11-08', postId: 'ANNOUNCE', slotIndex: 1 },
        { serviceDate: '2026-12-06', postId: 'AUDIO', slotIndex: 1 }   // 已經唔喺度
      ]);
    }, '剛才的預覽已經過期');

  checkThrows('★★★★ 訊息要講得出下一步做咩（關掉重撳），唔係淨係話「過期」',
    function () {
      gas.assertSaveConfirmPlanStillFresh_(plan, [
        { serviceDate: '2099-01-01', postId: 'X', slotIndex: 1 }
      ]);
    }, '重新撳一次「儲存並確認」');

  let noDecisions = true;
  try { gas.assertSaveConfirmPlanStillFresh_(plan, []); } catch (e) { noDecisions = false; }
  check('★★★★ 冇送決定（例如純申報、冇 grid 改動）⇒ 冇嘢要比對，唔應該誤擋',
    noDecisions);

  // slotIndex 唔同 = 唔同格，唔可以當成同一格
  checkThrows('★★★★★ slotIndex 唔同就係另一格，唔可以模糊比對',
    function () {
      gas.assertSaveConfirmPlanStillFresh_(plan, [
        { serviceDate: '2026-11-08', postId: 'ANNOUNCE', slotIndex: 2 }
      ]);
    }, '已經過期');
}

console.log('\n=== D-2 步 3：放行文字檢查（靜態）===');
{
  check('★★★★★ 有真違反而放行文字唔啱 ⇒ 拋錯',
    /if \(plan\.needsRelease && String\(input\.releaseText \|\| ''\)\.trim\(\) !== SAVE_CONFIRM_RELEASE_TEXT\)/.test(SRC));
  check('★★★★★ 拒絕時明確講「職事表沒有任何改動」'
    + '——幹事最想知嘅係「而家個表究竟點」',
    /職事表沒有任何改動，第 ' \+ plan\.baseVersionNo/.test(SRC));
  check('★★★★ 用三段式訊息', /needsRelease[\s\S]{0,300}?buildThreePartMessage_\(/.test(SRC));
  check('★★★★★ 檢查排喺「重新跑 plan」之後'
    + '——次序反轉嘅話，會用一份過時嘅 needsRelease 去判斷要唔要放行',
    SRC.indexOf('assertSaveConfirmPlanStillFresh_(plan, input.decisions)')
      < SRC.indexOf('plan.needsRelease && String(input.releaseText'));
}

console.log('\n=== D-2 步 1／2【核心】唔信前端傳嚟嘅狀態 ===');
{
  const execBody = SRC.slice(SRC.indexOf('function apiSaveAndConfirmExecute'));
  check('★★★★★ execute 開頭就重新跑一次 plan（唔信前端送嚟嗰份）',
    /const plan = buildSaveAndConfirmPlan_\(quarterId\);/.test(execBody));
  // 只數呼叫點（`= buildSaveAndConfirmPlan_(` 或 `return buildSaveAndConfirmPlan_(`），
  // 唔數函式定義本身嗰行。
  const callSites = (SRC.match(/(?:=|return)\s+buildSaveAndConfirmPlan_\(quarterId\)/g) || []).length;
  check('★★★★★ plan 同 execute 行同一份程式碼（buildSaveAndConfirmPlan_），'
    + '唔係各自實作一次',
    callSites === 2, '呼叫點數 = ' + callSites);
  check('★★★★ 而且只有一個定義（唔會有第二份走樣嘅副本）',
    (SRC.match(/function buildSaveAndConfirmPlan_/g) || []).length === 1);
  check('★★★★ 重新跑出嚟嘅 plan 如果 blocked，一樣要中止',
    /if \(plan\.blocked\) \{[\s\S]{0,150}?throw new Error/.test(execBody));
}

console.log('\n=== D-2 步 5 失敗【核心】唔前進 Stage、唔發佈公開連結 ===');
{
  const catchBlock = SRC.slice(SRC.indexOf('} catch (err) {', SRC.indexOf('materialiseManualEdits_')));
  const untilReturn = catchBlock.slice(0, catchBlock.indexOf('\n  }'));

  check('★★★★★ 寫入失敗嘅 catch 入面完全冇 advanceQuarterStage_',
    untilReturn.indexOf('advanceQuarterStage_') === -1);
  check('★★★★★ 寫入失敗嘅 catch 入面完全冇發佈公開連結'
    + '——半套資料唔應該一路推落去令堂委／義工睇到',
    untilReturn.indexOf('tryPublishPublicRoster_') === -1
    && untilReturn.indexOf('publishPublicRoster_') === -1);
  check('★★★★★ 訊息明寫「第 N 版可能只寫入了一部分」（規格步 1.8）',
    /可能只寫入了一部分/.test(untilReturn));
  check('★★★★★ 訊息俾**兩條**補救路徑（核對／回到上一個版本）',
    /檢查各版本派工紀錄/.test(untilReturn) && /回到上一個版本/.test(untilReturn));
  check('★★★★ 回傳 ok:false 同 versionCreated:false，前端分辨得出「完全失敗」',
    /ok: false/.test(untilReturn) && /versionCreated: false/.test(untilReturn));
}

console.log('\n=== D-2 步 7 失敗【核心】發佈失敗 ≠ 全盤失敗 ===');
{
  check('★★★★★ tryPublishPublicRoster_ 把失敗降級，唔會拋出去',
    /function tryPublishPublicRoster_[\s\S]{0,400}?catch \(err\) \{[\s\S]{0,200}?return \{ failed: true/.test(SRC));
  check('★★★★★ 發佈失敗時仍然回 ok:true（版本真係儲存咗）'
    + '——當成失敗嘅話，幹事會以為要重做，就會建立第二個內容一樣嘅版本',
    /ok: true,\s*\n\s*versionCreated: true/.test(SRC));
  check('★★★★★ 回傳 publishFailed 同 publishError 兩個欄位，前端分辨得出',
    /publishFailed: publish\.failed/.test(SRC) && /publishError: publish\.message/.test(SRC));
  check('★★★★★ 訊息分開講「版本已儲存好」同「連結未更新」',
    /已經儲存好了，但公開連結未能更新/.test(SRC));
  check('★★★★ 訊息提醒「唔好即刻撳寄給堂委，否則佢哋會睇到舊版本」'
    + '——呢個係最實際嘅後果',
    /否則他們會看到舊版本/.test(SRC));

  check('★★★★★ 三種結果前端分辨得到：'
    + '完全成功（ok:true, publishFailed:false）／'
    + '版本成功但發佈失敗（ok:true, publishFailed:true）／'
    + '完全失敗（ok:false）',
    /ok: false/.test(SRC) && /publishFailed: publish\.failed/.test(SRC)
    && /publishFailed: false/.test(SRC));
}

console.log('\n=== D-3【核心】零改動路徑 ===');
{
  const zeroFn = SRC.slice(SRC.indexOf('function executeSaveConfirmZeroChange_'));
  check('★★★★★ NOTHING 分支：唔建版本、唔前進 Stage、唔發佈',
    /versionCreated: false, publishFailed: false, stageAdvanced: false/.test(zeroFn));
  check('★★★★★ ADVANCE_STAGE_ONLY 分支：唔建版本，但前進 Stage 兼重發連結（D4）',
    /advanceQuarterStage_\(quarterId, QUARTER_STAGE\.REQUESTS_APPLIED\)[\s\S]{0,200}?tryPublishPublicRoster_/.test(zeroFn));
  check('★★★★★ REVIEW_SENT 零改動嘅訊息要講清楚「當作意見已收齊」'
    + '（唔係「乜都冇做」——呢個係最易誤解嘅一種）',
    /已當作意見已收齊/.test(zeroFn));
  check('★★★★ REQUESTS_APPLIED 零改動時加一句「可以撳正式發出」',
    /可以撳「正式發出給全體」了/.test(zeroFn));
  check('★★★★ OFFICIAL_SENT 零改動時加一句「已經正式發出過」',
    /這一季已經正式發出過了/.test(zeroFn));
  check('★★★★★ 零改動路徑排喺放行檢查之後'
    + '（零改動本來就唔應該有真違反，但次序寫錯會令放行檢查被繞過）',
    SRC.indexOf('plan.needsRelease && String(input.releaseText')
      < SRC.indexOf('if (plan.zeroChange) {'));
}

console.log('\n=== D-2 步 4／5：重用既有寫入路徑，唔重新抄一次 ===');
{
  check('★★★★★ 用 materialiseManualEdits_()（內含逐格 AuditLog → '
    + 'createRosterSheet() → writeAssignments()），冇喺呢度抄多次',
    /materialiseManualEdits_\(context, resolved\.changes, resolved\.state, 'apiSaveAndConfirmExecute'\)/.test(SRC));
  check('★★★★ 之後補 registerVersion()，Basis 用既有常數',
    /registerVersion\([\s\S]{0,200}?VERSION_VALUES\.BASIS_FINE_TUNE/.test(SRC));
  check('★★★★★ 只喺 REVIEW_SENT 一種情況先前進 Stage（決定 D3）',
    /if \(plan\.stage === QUARTER_STAGE\.REVIEW_SENT\) \{\s*\n\s*advanceQuarterStage_/.test(SRC));
}

console.log('\n=== 結構性要求 ===');
{
  check('★★★★★ apiSaveAndConfirmExecute 第一行 assertWebAppRequestAllowed_()',
    /function apiSaveAndConfirmExecute\(quarterId, payload\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(SRC));
  check('★★★★★ 規則狀態明確傳 GRID_OVERLAY',
    /STATE_SOURCE\.GRID_OVERLAY, 'apiSaveAndConfirmExecute'/.test(SRC));
  check('★★★★ 舊嘅 apiStep3* 四個端點保留不刪（選單版安全網）',
    ['apiStep3Plan', 'apiStep3Decline', 'apiStep3Apply', 'apiStep3Release'].every(function (fn) {
      return fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8')
        .indexOf('function ' + fn + '(') !== -1;
    }));
  check('★★★★ WebAppFlow.gs 檔頭註明 Web UI 已改用 apiSaveAndConfirm*',
    /apiSaveAndConfirmPlan\/Execute/.test(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
