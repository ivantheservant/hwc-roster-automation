// 第九十三輪批次 TF 組：幹事介面載入時間（只計時，不改任何判斷、次序或結果）。
// 執行方式：node tests/round93_tf_load_timings.test.js
//
//   TF1 伺服器 apiGetDashboardState：回傳 timings（讀工作表、寄出警告、人手檢查等分段毫秒＋合計；fine-tune context 次數及毫秒）
//   TF2 Config WEBAPP_SHOW_LOAD_TIMINGS：預設 TRUE（程式預設值，不用寫入工作表）；FALSE ⇒ showLoadTimings=false
//   TF3 不改結果：除了 timings／showLoadTimings 兩個新欄位，其餘回傳內容和沒有計時時一樣
//   TF4 前端：每一步的毫秒數；頁底細字「載入 X 秒（權限 a、季度 b、狀態卡 c、主流程 d、出席系統同步 e、再載入 f）」；
//       關掉時不顯示；console 有分段時間
// 用假資料。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\n=== TF1／TF2／TF3：伺服器 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.assertWebAppRequestAllowed_ = function () {};
  const d = g.apiGetDashboardState(sc.Q);
  const t = d.timings;
  check('★★★★★★ 回傳有 timings.phases，最後一項是「合計」', t && Array.isArray(t.phases) && t.phases.length >= 7 && t.phases[t.phases.length - 1].label === '合計', JSON.stringify(t));
  const labels = t.phases.map((p) => p.label);
  ['讀工作表（版本、未儲存）', '寄出警告', '人手檢查', '開季前準備'].forEach((l) => {
    check('★★★★★ 分段有「' + l + '」', labels.indexOf(l) !== -1, JSON.stringify(labels));
  });
  check('★★★★★ 每一段是數字（毫秒），不是 NaN／負數', t.phases.every((p) => typeof p.ms === 'number' && p.ms >= 0 && !isNaN(p.ms)));
  check('★★★★★★ fine-tune context 的次數及毫秒（次數是整數，≥ 1：寄出警告會建一次）', Number.isInteger(t.fineTuneContextCount) && t.fineTuneContextCount >= 1
    && typeof t.fineTuneContextMs === 'number' && t.fineTuneContextMs >= 0, JSON.stringify(t));
  check('★★★★★ 每一次載入重新計數（再叫一次，次數不會累加）', g.apiGetDashboardState(sc.Q).timings.fineTuneContextCount === t.fineTuneContextCount);
  check('★★★★★★ 預設顯示：showLoadTimings＝true（Config 沒有這一行也照 TRUE）', d.showLoadTimings === true);
  const real = g.getConfig_;
  g.getConfig_ = function (k, def) { return k === 'WEBAPP_SHOW_LOAD_TIMINGS' ? false : real(k, def); };
  check('★★★★★★ Config WEBAPP_SHOW_LOAD_TIMINGS＝FALSE ⇒ showLoadTimings＝false', g.apiGetDashboardState(sc.Q).showLoadTimings === false);
  g.getConfig_ = real;
  const seed = read('src/ConfigSeed.gs');
  check('★★★★ Config 有種子行（BOOL、預設 TRUE），沒有寫入工作表的動作', /key: CONFIG_KEYS\.WEBAPP_SHOW_LOAD_TIMINGS, type: CONFIG_TYPES\.BOOL[\s\S]{0,120}defaultValue: 'TRUE'/.test(seed)
    && /getConfig_\(CONFIG_KEYS\.WEBAPP_SHOW_LOAD_TIMINGS, true\)/.test(read('src/WebAppDashboard.gs')));
  // 不改結果：把計時欄位拿走之後，兩次回傳一樣
  const a = JSON.parse(JSON.stringify(g.apiGetDashboardState(sc.Q)));
  const b = JSON.parse(JSON.stringify(g.apiGetDashboardState(sc.Q)));
  delete a.timings; delete b.timings; delete a.staffing.ms; delete b.staffing.ms; delete a.staffing.cached; delete b.staffing.cached; // staffing.ms 是人手檢查本來就有的計時
  check('★★★★★★ 除 timings 外其餘內容連續兩次載入完全一樣（計時沒有改結果）', JSON.stringify(a) === JSON.stringify(b));
  const src = read('src/WebAppDashboard.gs');
  const fn = src.slice(src.indexOf('function buildDashboardState_'), src.indexOf('function buildSettingsSheetLinks_'));
  check('★★★★ 計時只加 timer.mark(…)，沒有改判斷：sendWarnings／eligibilityImpact 仍然用同一個函式及條件',
    /const sendWarnings = versionExists \? summariseVersionSendWarnings_\(quarterId, versionNo\)/.test(fn) && /const eligibilityImpact = versionExists \? summariseEligibilityImpact_\(quarterId\)/.test(fn));
  check('★★★★ FineTune：buildFineTuneContext_ 只是包一層計次，核心不變', /function buildFineTuneContext_\(quarterId, versionNo, opts\) \{[\s\S]{0,200}return buildFineTuneContextCore_\(quarterId, versionNo, opts\);/.test(read('src/FineTune.gs')));
}

console.log('\n=== TF4：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const logs = [];
  ui.console = { log: function (m) { logs.push(String(m)); }, warn: function () {}, error: function () {} };
  const line = ui.buildLoadTimingsLine_({ permission: 1200, quarterList: 800, statusCard: 5400, mainFlow: 900, hwcasSync: 8200, reload: 6100 }, 17500);
  check('★★★★★★ 頁底那一行：「載入 X 秒（權限 a、季度 b、狀態卡 c、主流程 d、出席系統同步 e、再載入 f）」',
    /^載入 17\.5 秒（權限 1\.2、季度 0\.8、狀態卡 5\.4、主流程 0\.9、出席系統同步 8\.2、再載入 6\.1）$/.test(line.replace('建立未來季度', '')), line);
  const full = ui.buildLoadTimingsLine_({ permission: 1000, ensureQuarters: 2000, quarterList: 3000, statusCard: 4000, mainFlow: 5000, hwcasSync: 6000, reload: 7000 }, 10000);
  check('★★★★ 全部七步都在（含建立未來季度）', /權限 1\.0、建立未來季度 2\.0、季度 3\.0、狀態卡 4\.0、主流程 5\.0、出席系統同步 6\.0、再載入 7\.0/.test(full), full);
  check('★★★★ 還沒完成的步驟不會顯示（只有已經量到的）', !/再載入/.test(ui.buildLoadTimingsLine_({ permission: 500 }, 1000)));

  vm.runInContext("dashboardState_ = { showLoadTimings: true };", ui);
  ui.markLoadTiming_('statusCard', 4200);
  const box = ui.document.getElementById('loadTimings');
  check('★★★★★★ 顯示：頁底細字出現「載入 … 秒（…狀態卡 4.2…）」，並寫入 console', box.hidden === false && /^載入 [\d.]+ 秒（.*狀態卡 4\.2/.test(box.textContent) && logs.some((l) => /載入時間/.test(l)), box.textContent);
  ui.markLoadTiming_('statusCard', 9999);
  check('★★★★ 只記第一次載入（換季度、重新整理不覆蓋）', /狀態卡 4\.2/.test(ui.document.getElementById('loadTimings').textContent));
  vm.runInContext("dashboardState_ = { showLoadTimings: false };", ui);
  ui.markLoadTiming_('mainFlow', 1000);
  check('★★★★★★ Config 關掉（showLoadTimings＝false）⇒ 頁底不顯示', ui.document.getElementById('loadTimings').hidden === true && ui.document.getElementById('loadTimings').textContent === '');
  // 計時出錯不可以令載入出事
  const rawEl = ui.el;
  ui.el = function () { throw new Error('boom'); };
  let threw = false;
  try { ui.markLoadTiming_('reload', 1); } catch (e) { threw = true; }
  ui.el = rawEl;
  check('★★★★★ 計時本身出錯（例如頁面沒有那個元素）不會拋出，不影響載入', threw === false);

  const script = read('src/ui/Script.html');
  check('★★★★ 七個步驟都有量度：權限、建立未來季度、季度清單、狀態卡、主流程、出席系統同步（ScriptZone3）、再載入（ScriptZone3）',
    /markLoadTiming_\('permission'/.test(script) && /markLoadTiming_\('ensureQuarters'/.test(script) && /markLoadTiming_\('quarterList'/.test(script)
    && /markLoadTiming_\('statusCard'/.test(script) && /markLoadTiming_\('mainFlow'/.test(script)
    && /markLoadTiming_\('hwcasSync'/.test(read('src/ui/ScriptZone3.html')) && /markLoadTiming_\('reload'/.test(read('src/ui/ScriptZone3.html')));
  check('★★★★★ 伺服器分段時間寫入 console（含 fine-tune context 次數及秒數）', /\[載入時間：伺服器\][\s\S]{0,300}fine-tune context/.test(script));
  check('★★★★ Index.html 有頁底元素 #loadTimings', /id="loadTimings"/.test(read('src/ui/Index.html')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
