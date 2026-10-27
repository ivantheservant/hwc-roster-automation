// 第八十四輪批次 KA 組：〔稍後再決定〕之後，第 2 步即時出「現在有一張建議表未處理」。
// 執行方式：node tests/round84_ka_later_refresh.test.js
//
// 現場（第八十三輪 G10）：撳〔稍後再決定〕只係關窗，第 2 步冇變化，要撳〔重新整理〕先出
// 〔開啟建議表〕〔接受它〕〔放棄它〕。而家同頁頂〔重新整理〕同一條路（`refreshLikeButton()`）。

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptMainFlow.html', 'ScriptSuggestion.html']);
  ui.setInterval = () => 0;
  ui.clearInterval = () => {};
  let loads = 0;
  ui.loadDashboard = async () => { loads++; };
  vm.runInContext("currentQuarterId = '2028T3'; mainFlowState_ = { suggestion: { hasSuggestion: false } }; mainFlowStaleQuarter_ = '2028T3';", ui);
  ui.renderSuggestionResult({ ok: true, startNote: '', url: '', sheetName: 's', colourCounts: {}, manualOutcomes: [],
    systemFixes: [], weightTune: { moves: [], unmet: [], items: [] }, untouchedManual: [], remaining: [], unfillable: [], undecidedNames: [] }, false);
  const acts = ui.document.getElementById('modalActions').children;
  const later = acts.filter((b) => b.textContent === '稍後再決定')[0];
  check('（前置）結果窗有〔稍後再決定〕', !!later, acts.map((b) => b.textContent).join('／'));
  if (later) later.fire('click');
  await new Promise((r) => setImmediate(r));
  check('★★★★★★ KA〔稍後再決定〕清走主流程快取（第 2 步會重畫，即時見到建議表）',
    vm.runInContext('mainFlowState_ === null && mainFlowStaleQuarter_ === null', ui));
  check('★★★★★★ KA 而且重新讀 dashboard（同〔重新整理〕同一條路）', loads === 1, String(loads));
  check('★★★★ KA 窗已關', vm.runInContext('modalOpen === false', ui));
})().then(() => {
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}, (e) => { console.log('FAIL  未預期例外：' + e.stack); process.exit(1); });
