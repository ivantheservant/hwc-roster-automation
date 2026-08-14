// 階段 B6：resolveHardViolationRelease_() 的錯字／空白／全形半形回歸測試。
// 執行方式：node tests/hard_violation_release.test.js
// e2e_five_stage_flow.test.js 已經在敘事流程中間接測過這個函式的基本 PASS／FAIL
// 兩種情況，這裡專門補完整套邊界情況（打錯字一定不能放行是本系統的硬底線）。

const RULE_LEVELS = { HARD: 'HARD', SEMI_HARD: 'SEMI_HARD' };

// ---- 移植：FourStageFlow.gs 的 resolveHardViolationRelease_()（逐字相同）----
function resolveHardViolationRelease_(violations, releaseText) {
  const hard = (violations || []).filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  if (hard.length === 0) return true;
  return String(releaseText || '').trim() === '確認放行';
}

let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}

const withHard = [{ severity: RULE_LEVELS.HARD, ruleId: 'HARD_UNAVAILABLE' }];
const withSemiHardOnly = [{ severity: RULE_LEVELS.SEMI_HARD, ruleId: 'SEMI_NO_CONSECUTIVE' }];
const noViolations = [];

console.log('\n=== 沒有硬規則違反時：不論輸入什麼文字都放行（連空字串、連準硬規則都放行）===');
{
  check('★ 完全沒有違反 + 空字串 → 放行', resolveHardViolationRelease_(noViolations, ''), true);
  check('★ 只有準硬規則違反（沒有硬規則）+ 空字串 → 放行', resolveHardViolationRelease_(withSemiHardOnly, ''), true);
  check('★ 只有準硬規則違反 + 亂打文字 → 放行（準硬規則本來就不受這道關卡限制）',
    resolveHardViolationRelease_(withSemiHardOnly, '隨便打'), true);
}

console.log('\n=== 有硬規則違反時：只有逐字完全等於「確認放行」才放行 ===');
{
  check('★ 正確文字「確認放行」→ 放行', resolveHardViolationRelease_(withHard, '確認放行'), true);
  check('★ 空字串 → 不放行', resolveHardViolationRelease_(withHard, ''), false);
  check('★ undefined → 不放行（呼叫端可能傳入 undefined）', resolveHardViolationRelease_(withHard, undefined), false);
  check('★ 錯字「確定放行」→ 不放行', resolveHardViolationRelease_(withHard, '確定放行'), false);
  check('★ 錯字「確認放行了」（多字）→ 不放行', resolveHardViolationRelease_(withHard, '確認放行了'), false);
  check('★ 錯字「放行」（少字）→ 不放行', resolveHardViolationRelease_(withHard, '放行'), false);
  check('★ 前後有空格「  確認放行  」→ 放行（.trim() 會處理）', resolveHardViolationRelease_(withHard, '  確認放行  '), true);
  check('★ 中間多一個空格「確認 放行」→ 不放行（.trim() 只處理頭尾，不處理中間）',
    resolveHardViolationRelease_(withHard, '確認 放行'), false);
  check('★ 全形英文／數字混入「確認放行１」→ 不放行', resolveHardViolationRelease_(withHard, '確認放行１'), false);
  check('★ 半形逗號「確認放行,」→ 不放行', resolveHardViolationRelease_(withHard, '確認放行,'), false);
  check('★ 純小寫英文「queren fangxing」（拼音）→ 不放行', resolveHardViolationRelease_(withHard, 'queren fangxing'), false);
  check('★ 只有換行符號 "\\n" → 不放行（.trim() 後變空字串）', resolveHardViolationRelease_(withHard, '\n'), false);
  check('★ Tab／換行包住正確文字「\\t確認放行\\n」→ 放行（.trim() 也會清 tab／換行）',
    resolveHardViolationRelease_(withHard, '\t確認放行\n'), true);
}

console.log('\n=== 混合違反（硬規則＋準硬規則同時存在）：仍然只看硬規則那一組 ===');
{
  const mixed = withHard.concat(withSemiHardOnly);
  check('★ 混合違反 + 空字串 → 不放行（硬規則存在就要打字）', resolveHardViolationRelease_(mixed, ''), false);
  check('★ 混合違反 + 「確認放行」→ 放行', resolveHardViolationRelease_(mixed, '確認放行'), true);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
