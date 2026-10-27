// 第八十四輪批次 KB 組：「調整之前」嘅格數同〔檢查我的改動〕一致；每週標題另列一行。
// 執行方式：node tests/round84_kb_will_handle_titles.test.js
//
// 現場（第八十三輪 G10）：「調整之前」寫「你在表上改了 5 格」，〔檢查我的改動〕寫 6 格——
// 差嘅係第 2 週「類型」嗰一格（每週標題）。
//
//   KB1　「這一次會處理」：格 N 格＋每週標題 T 週＝〔檢查我的改動〕嘅 N＋T
//   KB2　每週標題逐週列（原本 → 改成）
//   KB3　〔請系統幫我調整〕結果窗嘅「這一次會處理」都一樣（同一支）
//   KB4　前端：「・每週標題改了 1 週（系統不會調整）」＋逐週一行；冇改標題就冇呢一行

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
gas.apiGenerateDraftExecute(sc.Q);
const D = sc.DATES;
// 人手改兩格：第 2 週讀經＝第 1 週讀經（連續兩週）；第 3 週主席換做第 1 週主席
sc.setCell(0, D[1], 'READ#1', sc.getCell(0, D[0], 'READ#1'));
sc.setCell(0, D[2], 'CHAIR#1', sc.getCell(0, D[0], 'CHAIR#1'));
// 第 2 週「類型」（每週標題，第 3 欄）
const sh = sc.gridSheet(0);
let row2 = -1;
for (let r = 3; r <= sh.getLastRow(); r++) {
  if (gas.toDateString(sh.getRange(r, 1).getValue(), sc.TZ) === D[1]) row2 = r;
}
const oldTitle = sh.getRange(row2, 3).getValue();
sh.getRange(row2, 3).setValue('Baptism Service');

const pre = gas.apiCheckMyChanges(sc.Q);
check('（前置）檢查 ok', pre.ok === true, JSON.stringify(pre).slice(0, 300));
const w = pre.willHandle || {};
const checkTitles = (pre.changes || []).filter((c) => c.isTitle).length;
const checkCells = (pre.changes || []).filter((c) => !c.isTitle).length;

console.log('\n=== KB1：同一個計算來源，加起來一致 ===');
check('（前置）檢查我的改動：2 格＋1 週標題', checkCells === 2 && checkTitles === 1, JSON.stringify(pre.changes));
check('★★★★★★ KB1「你在表上改了 N 格」＝檢查我的改動嘅格數（唔計標題）', (w.gridChanges || []).length === checkCells,
  JSON.stringify(w.gridChanges));
check('★★★★★★ KB1 格＋每週標題＝檢查我的改動總數', (w.gridChanges || []).length + (w.titleChanges || []).length === pre.changes.length,
  JSON.stringify({ grid: (w.gridChanges || []).length, titles: (w.titleChanges || []).length, check: pre.changes.length }));
check('★★★★★ KB1 格嘅內容同檢查我的改動一樣', JSON.stringify(w.gridChanges) === JSON.stringify(pre.changes.filter((c) => !c.isTitle)),
  JSON.stringify([w.gridChanges, pre.changes]));

console.log('\n=== KB2：每週標題逐週列 ===');
const t = (w.titleChanges || [])[0] || {};
check('★★★★★ KB2 第 2 週：原本 → Baptism Service', t.serviceDate === D[1] && t.fromName === String(oldTitle) && t.toName === 'Baptism Service',
  JSON.stringify(t));

console.log('\n=== KB3：結果窗同一支 ===');
const r = gas.apiBuildSuggestion(sc.Q, '', []);
const rw = r.willHandle || {};
check('★★★★★ KB3 結果窗「這一次會處理」都有每週標題 1 週', (rw.titleChanges || []).length === 1 && (rw.gridChanges || []).length === checkCells,
  JSON.stringify(rw).slice(0, 400));

console.log('\n=== KB4：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptSuggestion.html']);
  const text = ui.buildWillHandleSection(w).textContent;
  check('★★★★★★ KB4「・你在表上改了 2 格」', text.indexOf('・你在表上改了 2 格') !== -1, text);
  check('★★★★★★ KB4「・每週標題改了 1 週（系統不會調整）」', text.indexOf('・每週標題改了 1 週（系統不會調整）') !== -1, text);
  check('★★★★★ KB4 逐週一行（原本 → 改成）', text.indexOf(String(oldTitle) + ' → Baptism Service') !== -1, text);
  const none = ui.buildWillHandleSection({ gridChanges: [], titleChanges: [] }).textContent;
  check('★★★★ KB4 冇改標題就冇呢一行', none.indexOf('每週標題') === -1, none);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
