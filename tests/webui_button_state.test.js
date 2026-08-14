// 階段 B5：Web UI 五張步驟卡片可用／完成狀態的回歸測試。
// 執行方式：node tests/webui_button_state.test.js
// 測試對象是 FiveStageCore.gs 新抽出的純函式 computeFiveStepAvailability_()
// （WebAppFlow.gs 的 apiGetFlowState() 呼叫它，行為完全不變，只是抽出可測試部分）。

const QUARTER_STAGE = { DRAFT: 'DRAFT', REVIEW_SENT: 'REVIEW_SENT', REQUESTS_APPLIED: 'REQUESTS_APPLIED', OFFICIAL_SENT: 'OFFICIAL_SENT' };
const QUARTER_STAGE_ORDER = [QUARTER_STAGE.DRAFT, QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED, QUARTER_STAGE.OFFICIAL_SENT];

// ---- 移植：FiveStageCore.gs 的 computeFiveStepAvailability_()（逐字相同）----
function computeFiveStepAvailability_(stage, step1VersionExists) {
  const stageIndex = QUARTER_STAGE_ORDER.indexOf(stage);
  return {
    step2: {
      available: stage === QUARTER_STAGE.DRAFT && step1VersionExists,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.DRAFT)
    },
    step3: {
      available: stage === QUARTER_STAGE.REVIEW_SENT || stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stageIndex > QUARTER_STAGE_ORDER.indexOf(QUARTER_STAGE.REVIEW_SENT)
    },
    step4: {
      available: stage === QUARTER_STAGE.REQUESTS_APPLIED,
      done: stage === QUARTER_STAGE.OFFICIAL_SENT
    },
    step5: {
      available: stage === QUARTER_STAGE.OFFICIAL_SENT
    }
  };
}

function availableSteps(availability) {
  return ['step2', 'step3', 'step4', 'step5'].filter(k => availability[k].available);
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== DRAFT：只有步驟 2 可用（前提是步驟 1 已有版本）===');
{
  const a = computeFiveStepAvailability_(QUARTER_STAGE.DRAFT, true);
  check('★ 版本已存在 → 步驟 2 可用', a.step2.available, true);
  check('★ 恰好只有步驟 2 可用', availableSteps(a), ['step2']);
  check('★ 步驟 2／3／4 都還沒 done', [a.step2.done, a.step3.done], [false, false]);

  const b = computeFiveStepAvailability_(QUARTER_STAGE.DRAFT, false);
  check('★ 版本還不存在 → 步驟 2 也不可用（DRAFT 但沒有版本，五個步驟全部鎖）',
    availableSteps(b), []);
}

console.log('\n=== REVIEW_SENT：只有步驟 3 可用 ===');
{
  const a = computeFiveStepAvailability_(QUARTER_STAGE.REVIEW_SENT, true);
  check('★ 恰好只有步驟 3 可用', availableSteps(a), ['step3']);
  check('★ 步驟 2 已完成（done）', a.step2.done, true);
  check('★ 步驟 3 尚未完成（done=false，因為還沒前進到更後面）', a.step3.done, false);
}

console.log('\n=== REQUESTS_APPLIED：步驟 3 與步驟 4 同時可用（不是只有一個）===');
{
  // 這正是題目原本假設「任何時候最多只有一個步驟按鈕 active」不成立的地方：
  // 步驟 3「套用修改申報」的設計本來就是可重複執行（幹事收到新一輪申報還是可以
  // 再套用一次），所以即使 Stage 已經前進到 REQUESTS_APPLIED，步驟 3 仍然開著，
  // 跟已經解鎖的步驟 4 同時可用。這是既有、刻意的設計，不是這次抽函式造成的。
  const a = computeFiveStepAvailability_(QUARTER_STAGE.REQUESTS_APPLIED, true);
  check('★ 步驟 3 與步驟 4 同時可用（兩個，不是一個）', availableSteps(a), ['step3', 'step4']);
  check('★ 步驟 3 已 done（Stage 已經超過 REVIEW_SENT）', a.step3.done, true);
  check('★ 步驟 4 尚未 done（要到 OFFICIAL_SENT 才算 done）', a.step4.done, false);
}

console.log('\n=== OFFICIAL_SENT：只有步驟 5 可用（步驟 4 已完成）===');
{
  const a = computeFiveStepAvailability_(QUARTER_STAGE.OFFICIAL_SENT, true);
  check('★ 恰好只有步驟 5 可用', availableSteps(a), ['step5']);
  check('★ 步驟 4 已 done', a.step4.done, true);
  check('★ 步驟 3 也已 done（Stage 早就超過 REVIEW_SENT）', a.step3.done, true);
}

console.log('\n=== 季度不存在（或 Stage 無法辨識）：getQuarterStage_() 會拋錯，根本不會呼叫到這個純函式 ===');
{
  // computeFiveStepAvailability_() 本身只接受已經解析好的 stage 字串，不負責處理
  // 「季度存在不存在」——那一層防護在更上游的 getQuarterStage_()（QuarterStage.gs）：
  // Quarters 工作表找不到這個 QuarterID 時直接 throw，apiGetFlowState() 也就
  // 不會走到呼叫這個函式那一步。這裡改用「傳入一個不在 QUARTER_STAGE_ORDER 裡的
  // 值」模擬「Stage 值本身無法辨識」這種次一級的邊界情況，驗證此時純函式不會
  // 誤判成任何一個步驟可用，也不會拋錯（getQuarterStage_() 實際上會把這種情況
  // 正規化成 DRAFT，這裡只是確認就算收到未正規化的怪值也不會有步驟被誤判可用）。
  const a = computeFiveStepAvailability_('NOT_A_REAL_STAGE', true);
  check('★ 無法辨識的 Stage 值 → 沒有任何步驟可用', availableSteps(a), []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
