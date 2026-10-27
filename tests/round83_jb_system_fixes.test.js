// 第八十三輪批次 JB 組：調整結果窗用文字列出「系統修好的格」。
// 執行方式：node tests/round83_jb_system_fixes.test.js
//
// 現場（第八十二輪 Q2）：結果窗冇用文字列出「7月16日 讀經 甲 → 乙」嗰一格，只喺顏色寫
// 「藍色格＝系統建議改的（1 格）」，要開建議表先見到。
//
//   JB1　`systemFixes` 逐格：日期 崗位：原本 → 改成（原因），原因「某某 該日不能服侍」
//   JB2　只列**唔係你人手改過**嘅格（人手改過而被系統再改嘅喺「你人手改過的格」，唔重覆）
//   JB3　三段加起來＝系統動過嘅全部格（人手再改＋系統修好＋偏好微調＝systemCount）
//   JB4　「調整之前」（這一次會處理）同結果窗用同一套原因字眼
//   JB5　前端：結果窗有「系統修好的格（N 格）」一段

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
gas.readWeightsForQuarterTune_ = () => ({ rows: [] });
const RS = sc.C.RULE_SETTINGS;
sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
  [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
gas.apiGenerateDraftExecute(sc.Q);
const D = sc.DATES;
const idOf = (name) => Object.keys(sc.PEOPLE).filter((id) => sc.PEOPLE[id] === name)[0];
const chairName = sc.getCell(0, D[0], 'CHAIR#1');
const chair0 = idOf(chairName);
const U = sc.C.UNAVAILABLE;
sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [{ [U.UNAVAILABLE_ID]: 'U1', [U.PERSON_ID]: chair0,
  [U.DATE_FROM]: D[0], [U.DATE_TO]: D[0], [U.SOURCE]: 'WEB', [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL' }]);
// 人手：第 2 週讀經＝第 1 週讀經（連續兩週，冇勾）⇒ 系統會再改（喺「你人手改過的格」）
sc.setCell(0, D[1], 'READ#1', sc.getCell(0, D[0], 'READ#1'));

const pre = gas.apiCheckMyChanges(sc.Q);
const r = gas.apiBuildSuggestion(sc.Q, '', []);
check('（前置）建議表 ok', r.ok === true, JSON.stringify(r).slice(0, 300));

console.log('\n=== JB1／JB2 ===');
const fixes = r.systemFixes || [];
const fixOf = (d, post) => fixes.filter((f) => f.serviceDate === d && f.postNameTC === post)[0];
const chairFix = fixOf(D[0], '主席');
check('★★★★★★ JB1 第 1 週主席（不能服侍）列入「系統修好的格」', !!chairFix, JSON.stringify(fixes));
check('★★★★★★ JB1 逐格：原本 → 改成（原因「某某 該日不能服侍」）', chairFix && chairFix.fromName === chairName
  && chairFix.toName && chairFix.toName !== chairName && chairFix.reason === chairName + ' 該日不能服侍', JSON.stringify(chairFix));
check('★★★★★★ JB2 人手改過嘅第 2 週讀經唔重覆喺呢一段', !fixOf(D[1], '讀經'), JSON.stringify(fixes));
const readOutcome = (r.manualOutcomes || []).filter((o) => o.serviceDate === D[1] && o.postNameTC === '讀經')[0] || {};
check('★★★★★ JB2 第 2 週讀經喺「你人手改過的格」寫「系統再改成 X（連續兩週）」',
  readOutcome.outcome === 'SYSTEM_CHANGED' && /系統再改成「.+」（連續兩週）/.test(readOutcome.text), JSON.stringify(readOutcome));

console.log('\n=== JB3：三段加起來＝系統動過嘅全部格 ===');
const reChanged = (r.manualOutcomes || []).filter((o) => o.outcome === 'SYSTEM_CHANGED').length;
const weightMoves = ((r.weightTune || {}).moves || []).length;
check('★★★★★★ JB3 人手再改＋系統修好＋偏好微調＝systemCount', reChanged + fixes.length + weightMoves === r.systemCount,
  JSON.stringify({ reChanged, fixes: fixes.length, weightMoves, systemCount: r.systemCount }));

console.log('\n=== JB4：同一套原因字眼 ===');
const un = ((pre.willHandle || {}).unavailableCells || []).filter((c) => c.serviceDate === D[0])[0];
check('★★★★★ JB4「這一次會處理」不能服侍嗰格嘅原因＝結果窗嗰句', un && chairFix && un.reason === chairFix.reason,
  JSON.stringify([un, chairFix]));
check('★★★★ JB4 原因字眼：空格／連續兩週／唔喺名單', gas.systemFixReasonText_('', 'FILL_GAP', '', '') === '空格，系統填上'
  && gas.systemFixReasonText_('SEMI_NO_CONSECUTIVE', '', '甲', '') === '連續兩週'
  && gas.systemFixReasonText_('HARD_ELIGIBILITY', '', '甲', '') === '不在這個崗位的名單上');

console.log('\n=== JB5：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptSuggestion.html']);
  ui.renderSuggestionResult({ ok: true, startNote: '', url: '', sheetName: 's', colourCounts: {}, manualOutcomes: [],
    systemFixes: [{ serviceDate: '2028-07-16', postNameTC: '讀經', slotIndex: 1, fromName: '甲', toName: '乙', reason: '甲 該日不能服侍' }],
    weightTune: { moves: [], unmet: [] }, untouchedManual: [], remaining: [], unfillable: [], undecidedNames: [] }, false);
  const text = ui.document.getElementById('modalBody').textContent;
  check('★★★★★★ JB5 結果窗「系統修好的格（1 格）」逐格寫', text.indexOf('系統修好的格（1 格）') !== -1
    && text.indexOf('：甲 → 乙（甲 該日不能服侍）') !== -1, text.slice(0, 500));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
