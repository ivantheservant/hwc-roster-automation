// 第九十五輪批次 VC／VD 組：季度清單、建立未來季度、載入次序。
// 執行方式：node tests/round95_vc_vd_quarters_load.test.js
//
//   VC1 apiListQuarters：RosterVersions 只讀一次；回傳值和以前（每季各讀一次）完全相同
//   VC2 apiEnsureFutureQuarters：先唯讀檢查；不欠缺 ⇒ 不取 DocumentLock、不寫 AuditLog，回傳值相同
//   VC3 欠缺 ⇒ 照舊取鎖建立（每季一行 AuditLog），回傳值相同
//   VD1 載入次序：權限 → 季度清單（建立未來季度在背景，不用等）→ 狀態卡和主流程同時請求；畫面仍然先狀態卡、後主流程
//   VD2 主流程資料只請求一次（等同時請求的那一個）；請求出錯照舊在主流程那一格寫「主流程畫不出來」
//   VD3 背景建立了季度 ⇒ 只重填季度選單（保留現在的季度），不重新載入狀態卡
//   VD4 頁底細字第二行「伺服器：讀工作表 a、fine-tune context N 次 b、寄出警告 c、人手檢查 d（合計 e）」
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
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
// 有 Promise 一直沒有完成時 Node 會靜靜以 0 結束——一定要當失敗
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  測試沒有跑完（有 Promise 一直沒有完成）'); process.exitCode = 1; } });

console.log('\n=== VC1：季度清單 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['WebApp.gs', 'NewQuarterWizard.gs', 'AnnualQuarters.gs'] });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.apiEnsureFutureQuarters();   // 多建幾季（未來季度），每季都要找最新版本號
  const ss = sc.ss;
  const raw = ss.getSheetByName.bind(ss);
  let rv = 0;
  ss.getSheetByName = function (n) { if (n === sc.S.ROSTER_VERSIONS) rv++; return raw(n); };
  const neu = g.apiListQuarters();
  const newReads = rv;
  rv = 0;
  g.beginSheetReadMemo_ = function () {};   // 舊路徑：沒有快取
  const old = g.apiListQuarters();
  check('（前置）有多於一季、最新版本號正確', neu.length >= 3 && neu.filter((q) => q.quarterId === sc.Q)[0].latestVersionNo === 0
    && neu.filter((q) => q.quarterId !== sc.Q).every((q) => q.latestVersionNo === -1), JSON.stringify(neu).slice(0, 300));
  check('★★★★★★ VC1 回傳值和以前完全相同', JSON.stringify(neu) === JSON.stringify(old));
  check('★★★★★★ VC1 RosterVersions 只讀一次（以前每季一次）', newReads === 1 && rv === old.length, newReads + ' vs ' + rv);
  check('★★★★ VC1 快取在 finally 關掉', /beginSheetReadMemo_\(\);\s*try \{\s*return listQuartersForSelect_\(\);\s*\} finally \{\s*endSheetReadMemo_\(\);/.test(read('src/WebApp.gs')));
}

console.log('\n=== VC2／VC3：建立未來季度 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['WebApp.gs', 'NewQuarterWizard.gs', 'AnnualQuarters.gs'] });
  const g = sc.gas;
  let locks = 0;
  const audits = [];
  g.LockService = {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    getDocumentLock: () => { locks++; return { tryLock: () => true, releaseLock: () => {} }; }
  };
  const realAudit = g.writeAuditLog_;
  g.writeAuditLog_ = function (e) { audits.push(e); return realAudit ? realAudit.apply(this, arguments) : undefined; };
  const before = g.planLookaheadQuarters_();
  check('（前置）今日起 N 個月內有欠缺的季度', before.picked.plans.length > 0, JSON.stringify(before.picked.plans.map((p) => p.quarterId)));
  const r1 = g.apiEnsureFutureQuarters();
  check('★★★★★★ VC3 欠缺 ⇒ 取鎖建立', locks === 1 && r1.created.length === before.picked.plans.length, locks + ' ' + JSON.stringify(r1));
  check('★★★★★ VC3 每建一季一行 AuditLog（照舊）', audits.filter((a) => a.action === '自動建立未來季度').length === r1.created.length);
  check('★★★★ VC3 訊息照舊（已建立 N 個季度…）', /^已建立 \d+ 個季度：/.test(r1.message), r1.message);
  locks = 0;
  audits.length = 0;
  const r2 = g.apiEnsureFutureQuarters();
  check('★★★★★★ VC2 不欠缺 ⇒ 不取 DocumentLock', locks === 0, String(locks));
  check('★★★★★★ VC2 不欠缺 ⇒ 不寫 AuditLog', audits.length === 0, JSON.stringify(audits));
  // 舊路徑：取鎖再跑 ensureLookaheadQuarters_，加同一句訊息
  const old = g.withMutationLock_('建立未來季度', () => g.withEnsureQuartersMessage_(g.ensureLookaheadQuarters_('apiEnsureFutureQuarters')));
  check('★★★★★★ VC2 回傳值和以前完全相同', JSON.stringify(r2) === JSON.stringify(old), JSON.stringify(r2) + '\n      ' + JSON.stringify(old));
  check('★★★★ VC2 訊息：都已經建立好，不需要再建', /都已經建立好，不需要再建/.test(r2.message), r2.message);
  // 取鎖之後再檢查一次：唯讀檢查說欠缺，但取鎖時已經被另一個請求建好 ⇒ 不重複建立
  let first = true;
  const realPlan = g.planLookaheadQuarters_;
  g.planLookaheadQuarters_ = function () {
    const p = realPlan();
    if (first) { first = false; return { today: p.today, months: p.months, picked: { horizon: p.picked.horizon, plans: [{ quarterId: 'FAKE' }] } }; }
    return p;
  };
  audits.length = 0;
  const r3 = g.apiEnsureFutureQuarters();
  g.planLookaheadQuarters_ = realPlan;
  check('★★★★★ VC3 取鎖後再檢查一次（已經建好 ⇒ 不重複建立）', r3.created.length === 0 && audits.length === 0, JSON.stringify(r3));
  check('★★★★ 每日排程照舊用 ensureLookaheadQuarters_', /ensureLookaheadQuarters_\('dailyAutomationCheck_'\)/.test(read('src/Trigger.gs')));
}

const UI = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
  'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];

(async () => {
  console.log('\n=== VD1／VD2：狀態卡和主流程同時請求 ===');
  {
    const ui = loadUiScripts(UI);
    const started = [];
    const pending = {};
    ui.callServer = (name) => {
      started.push(name);
      return new Promise((res, rej) => { pending[name] = { res, rej }; });
    };
    const order = [];
    vm.runInContext('currentQuarterId = "2099T1"; resetMainFlowState();', ui);
    ui.renderTop = () => order.push('top');
    const realRenderMainFlow = ui.renderMainFlow;
    vm.runInContext('renderStep1 = renderStep2 = renderStepSend = renderStepPaper = function () { return document.createElement("div"); };'
      + ' renderZone1 = renderZone2Head = renderZone4 = function () {}; renderZone3Always = undefined;', ui);
    const p = ui.loadDashboard();
    await tick();
    check('★★★★★★ VD1 狀態卡還沒有回來，主流程資料已經同時請求', started.indexOf('apiGetDashboardState') !== -1
      && started.indexOf('apiGetMainFlowState') !== -1, JSON.stringify(started));
    pending.apiGetMainFlowState.res({ generateTarget: { found: false }, permanentLink: {}, suggestion: {}, paperCount: 0 });
    await tick();
    check('★★★★★ VD1 主流程資料先回來也不會先畫（畫面仍然先狀態卡）', order.length === 0);
    pending.apiGetDashboardState.res({ timings: null, latestVersion: null });
    await p;
    check('★★★★★★ VD2 主流程資料只請求一次（等同時請求的那一個）', started.filter((n) => n === 'apiGetMainFlowState').length === 1, JSON.stringify(started));
    check('★★★★ VD1 先畫狀態卡', order[0] === 'top');
    // 主流程資料已經有（同一季）⇒ 再載入不再請求
    started.length = 0;
    const p2 = ui.loadDashboard();
    await tick();
    pending.apiGetDashboardState.res({ timings: null, latestVersion: null });
    await p2;
    check('★★★★ VD2 主流程資料已有（同一季）⇒ 不再請求（和以前一樣用快取）', started.join(',') === 'apiGetDashboardState', started.join(','));
    // 出錯
    vm.runInContext('resetMainFlowState();', ui);
    ui.renderMainFlow = realRenderMainFlow;
    started.length = 0;
    const p3 = ui.loadDashboard();
    await tick();
    pending.apiGetMainFlowState.rej(new Error('讀不到'));
    await tick();
    pending.apiGetDashboardState.res({ timings: null, latestVersion: null });
    await p3;
    check('★★★★★★ VD2 主流程資料出錯 ⇒ 照舊寫「主流程畫不出來」，其餘照畫', /主流程畫不出來：讀不到/.test(ui.document.getElementById('mainFlowBody').textContent),
      ui.document.getElementById('mainFlowBody').textContent);
    // 換季度 ⇒ 舊季度那一個請求不會被用
    vm.runInContext('resetMainFlowState(); currentQuarterId = "2099T1";', ui);
    ui.prefetchMainFlowState_();
    vm.runInContext('currentQuarterId = "2099T2";', ui);
    started.length = 0;
    const flowP = ui.getMainFlowState();
    await tick();
    check('★★★★★ VD2 換了季度 ⇒ 不用舊季度的請求，重新請求', started.join(',') === 'apiGetMainFlowState', started.join(','));
    pending.apiGetMainFlowState.res({ q: 'T2' });
    check('★★★★ VD2 拿到新季度的資料', (await flowP).q === 'T2');
    const script = read('src/ui/Script.html');
    const ld = script.slice(script.indexOf('async function loadDashboard'), script.indexOf('function patchHwcasSyncLine_'));
    check('★★★★ VD1 prefetch 在 apiGetDashboardState 之前', /prefetchMainFlowState_\(\);\s*dashboardState_ = await callServer\('apiGetDashboardState'/.test(ld));
  }

  console.log('\n=== VD1／VD3：季度清單不用等建立未來季度 ===');
  {
    const ui = loadUiScripts(UI);
    let resolveEnsure;
    const mut = [];
    ui.callServerMutating = (name) => { mut.push(name); return new Promise((r) => { resolveEnsure = r; }); };
    const reads = [];
    let quarters = [{ quarterId: '2099T1', label: 'A' }, { quarterId: '2099T2', label: 'B' }];
    ui.callServer = async (name) => { reads.push(name); return quarters; };
    const loads = [];
    ui.loadDashboard = async () => { loads.push(vm.runInContext('currentQuarterId', ui)); };
    vm.runInContext('viewOnly_ = false;', ui);
    await ui.loadQuarters('2099T2');
    check('★★★★★★ VD1 建立未來季度還沒有完成，季度清單及狀態卡已經載入', mut.join(',') === 'apiEnsureFutureQuarters'
      && reads.join(',') === 'apiListQuarters' && loads.join(',') === '2099T2', mut + ' / ' + reads + ' / ' + loads);
    quarters = [{ quarterId: '2099T1', label: 'A' }, { quarterId: '2099T2', label: 'B' }, { quarterId: '2099T3', label: 'C' }];
    resolveEnsure({ created: ['2099T3'] });
    await tick();
    const sel = ui.document.getElementById('quarter');
    check('★★★★★★ VD3 建立了季度 ⇒ 重填季度選單（多了一季），保留現在的季度', sel.children.length === 3 && sel.value === '2099T2', sel.children.length + ' ' + sel.value);
    check('★★★★★★ VD3 不重新載入狀態卡', loads.length === 1, JSON.stringify(loads));
    // 沒有建立 ⇒ 不重填
    reads.length = 0;
    await ui.loadQuarters('2099T2');
    resolveEnsure({ created: [] });
    await tick();
    check('★★★★ VD3 沒有建立 ⇒ 不再讀季度清單', reads.length === 1, JSON.stringify(reads));
    // 只可查看的人不做
    mut.length = 0;
    vm.runInContext('viewOnly_ = true;', ui);
    await ui.loadQuarters('2099T2');
    check('★★★★ 只可查看的人不建立未來季度（照舊）', mut.length === 0);
    // 建立失敗不阻住
    vm.runInContext('viewOnly_ = false;', ui);
    ui.callServerMutating = () => Promise.reject(new Error('boom'));
    let threw = false;
    try { await ui.loadQuarters('2099T2'); await tick(); } catch (e) { threw = true; }
    check('★★★★★ 建立未來季度失敗不阻住載入', threw === false);
  }

  console.log('\n=== VD4：頁底伺服器分段 ===');
  {
    const ui = loadUiScripts(UI);
    const st = {
      phases: [{ label: '讀工作表（版本、未儲存）', ms: 2300 }, { label: '寄出紀錄及公開連結', ms: 400 }, { label: '開季前準備', ms: 900 },
        { label: '人手檢查', ms: 1200 }, { label: '寄出警告', ms: 700 }, { label: '合計', ms: 6100 }],
      fineTuneContextCount: 1, fineTuneContextMs: 1800, fineTuneContextReused: 3
    };
    const line = ui.buildServerTimingsLine_(st);
    check('★★★★★★ VD4 第二行：「伺服器：讀工作表 2.3、fine-tune context 1 次 1.8、寄出警告 0.7、人手檢查 1.2（合計 6.1）」',
      line === '伺服器：讀工作表 2.3、fine-tune context 1 次 1.8、寄出警告 0.7、人手檢查 1.2（合計 6.1）', line);
    vm.runInContext('dashboardState_ = { showLoadTimings: true };', ui);
    ui.markLoadTiming_('statusCard', 4200);
    ui.markServerLoadTimings_(st);
    const box = ui.document.getElementById('loadTimings');
    check('★★★★★★ VD4 頁底兩行：載入時間＋伺服器分段', /^載入 [\d.]+ 秒（.*狀態卡 4\.2.*）\n伺服器：讀工作表 2\.3/.test(box.textContent), box.textContent);
    ui.markServerLoadTimings_(Object.assign({}, st, { fineTuneContextCount: 9 }));
    check('★★★★ VD4 只記第一次載入', /fine-tune context 1 次/.test(box.textContent));
    vm.runInContext('dashboardState_ = { showLoadTimings: false };', ui);
    ui.markLoadTiming_('mainFlow', 10);
    check('★★★★★ VD4 Config 關掉 ⇒ 兩行都不顯示', box.hidden === true && box.textContent === '');
    check('★★★★ #loadTimings 兩行分開（white-space: pre-line）', /id="loadTimings" style="white-space: pre-line;"/.test(read('src/ui/Index.html')));
    check('★★★★ console 照舊寫「[載入時間：伺服器]」', /\[載入時間：伺服器\][\s\S]{0,300}fine-tune context/.test(read('src/ui/Script.html')));
  }

  finished = true;
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
