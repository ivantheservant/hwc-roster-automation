// 第一百一十七輪批次 YB 組：狀態卡分成兩個同時進行的唯讀呼叫。
// 執行方式：node tests/round117_yb_dashboard_parallel.test.js
//
//   YB1 伺服器：第一部分＋第二部分合併 ＝ 單一呼叫（計時除外）——未生成、有版本未正式發出、已正式發出、只可查看四種
//   YB2 伺服器：兩部分的鍵除簽名外互不重疊；新 api 照舊權限檢查、讀表記憶、只可查看的處理；兩份唯讀名單都有
//   YB3 前端：並行 ⇒ 兩個呼叫都回來、簽名一致才合併；不一致 ⇒ 重讀一次；仍然不一致 ⇒ 當作失敗
//   YB4 前端：其中一部分失敗、超時、遲來 ⇒ 狀態快取及畫面不被部分更新
//   YB5 Config WEBAPP_DASHBOARD_PARALLEL＝FALSE（或未知）⇒ 只送一個呼叫；權限回覆帶這個值
// 用假資料（example.invalid、假季度）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { buildSendScene } = require('./helpers/send_scene.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  測試沒有跑完（有一個呼叫永遠沒有完成）'); process.exitCode = 1; } });

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const SELF = 'k@example.invalid';
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 15; i++) await tick(); }
/** 比較用：拿走計時（及人手檢查的毫秒、是否命中快取）。 */
function strip(d) {
  const x = JSON.parse(JSON.stringify(d));
  delete x.timings;
  if (x.staffing) { delete x.staffing.ms; delete x.staffing.cached; }
  return x;
}
const noCacheSvc = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };

/** 兩部分各自呼叫（各自的記憶），合併；與單一呼叫比較。 */
function compareScene(name, g, Q) {
  const single = g.apiGetDashboardState(Q);
  const a = g.apiGetDashboardStatePart(Q, 'A');
  const b = g.apiGetDashboardStatePart(Q, 'B');
  const merged = g.mergeDashboardParts_(a, b);
  const s1 = JSON.stringify(strip(single));
  const s2 = JSON.stringify(strip(merged));
  let firstDiff = '';
  if (s1 !== s2) {
    const x = strip(single); const y = strip(merged);
    firstDiff = Object.keys(Object.assign({}, x, y)).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).join('、');
  }
  check('★★★★★★ ' + name + '：兩部分合併與單一呼叫逐項相同（計時除外）', s1 === s2, '不同的項：' + firstDiff);
  const keysA = Object.keys(a).filter((k) => ['quarterId', 'stage', 'dashboardSignature', 'timings'].indexOf(k) === -1);
  const keysB = Object.keys(b).filter((k) => ['quarterId', 'stage', 'dashboardSignature', 'timings'].indexOf(k) === -1);
  const overlap = keysA.filter((k) => keysB.indexOf(k) !== -1);
  check('★★★★★ ' + name + '：兩部分的鍵除簽名外互不重疊', overlap.length === 0, overlap.join('、'));
  // YB-2：寄出警告、名單影響在第一部分（共用已建的 fine-tune context）
  check('★★★★★ ' + name + '：寄出警告、名單影響、未儲存改動、按鈕在第一部分；版本、狀態句子在第二部分',
    ['sendWarnings', 'eligibilityImpact', 'unsaved', 'buttons'].every((k) => keysA.indexOf(k) !== -1)
    && ['latestVersion', 'versionChoices', 'statusText'].every((k) => keysB.indexOf(k) !== -1), JSON.stringify([keysA, keysB]));
  check('★★★★★ ' + name + '：兩部分的簽名一致（季度、版本號、階段、SendLog 行數）',
    JSON.stringify(a.dashboardSignature) === JSON.stringify(b.dashboardSignature) && a.dashboardSignature.quarterId === Q,
    JSON.stringify([a.dashboardSignature, b.dashboardSignature]));
  const expectV = merged.latestVersion ? merged.latestVersion.versionNo : -1;
  check('★★★★★ ' + name + '：簽名的版本號就是最新版本號（未生成＝-1）、階段就是 stage',
    a.dashboardSignature.versionNo === expectV && a.dashboardSignature.stage === merged.stage, JSON.stringify(a.dashboardSignature));
  return { single: single, a: a, b: b, merged: merged };
}

(async function () {
  console.log('\n=== YB1：伺服器——合併 ＝ 單一呼叫 ===');
  {
    // 未生成
    const sc = buildRound75Scene();
    const g = sc.gas;
    g.assertWebAppRequestAllowed_ = function () { return 'EDITOR'; };
    g.CacheService = noCacheSvc;
    const r = compareScene('未生成', g, sc.Q);
    check('★★★★ 未生成：最新版本是 null、按鈕有生成', r.merged.latestVersion === null && !!(r.merged.buttons && r.merged.buttons.generate));
  }
  {
    // 有版本、未正式發出
    const sc = buildSendScene(SELF);
    const g = sc.gas;
    g.assertWebAppRequestAllowed_ = function () { return 'EDITOR'; };
    g.CacheService = noCacheSvc;
    const r = compareScene('有版本未正式發出', g, sc.Q);
    check('★★★★ 有版本：第 0 版、版本下拉有內容', r.merged.latestVersion && r.merged.latestVersion.versionNo === 0 && Array.isArray(r.merged.versionChoices));
    // 改一格（未儲存）⇒ 仍然相同，而且偵測到
    const D = sc.DATES;
    const cur = sc.getCell(0, D[0], 'CHAIR#1');
    const other = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => n !== cur)[0];
    sc.setCell(0, D[0], 'CHAIR#1', other);
    const r2 = compareScene('有版本＋表上改了一格', g, sc.Q);
    check('★★★★ 改了一格：未儲存改動 1 格', r2.merged.unsaved && r2.merged.unsaved.gridChangeCount === 1, JSON.stringify(r2.merged.unsaved));
  }
  {
    // 已正式發出（之後改一格並儲存）
    const sc = buildSendScene(SELF);
    const g = sc.gas;
    g.assertWebAppRequestAllowed_ = function () { return 'EDITOR'; };
    g.CacheService = noCacheSvc;
    const all = g.apiGetSendAllRecipients(sc.Q, 'OFFICIAL');
    g.apiStep4Confirm(sc.Q, { recipientScope: 'PICK', pickedKeys: all.pickedKeys, sendMode: 'ALL', attachType: 'NONE', includeIcs: false });
    const D = sc.DATES;
    const cur = sc.getCell(0, D[0], 'CHAIR#1');
    const other = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => n !== cur)[0];
    sc.setCell(0, D[0], 'CHAIR#1', other);
    g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
    const r = compareScene('已正式發出', g, sc.Q);
    check('★★★★ 已正式發出：階段 OFFICIAL_SENT、第 1 版', r.merged.stage === 'OFFICIAL_SENT' && r.merged.latestVersion.versionNo === 1, r.merged.stage);
  }
  {
    // 只可查看：兩部分都經 viewerSafeState_（主試算表網址清空）
    const sc = buildSendScene(SELF);
    const g = sc.gas;
    g.assertWebAppRequestAllowed_ = function () { return 'VIEWER'; };
    g.CacheService = noCacheSvc;
    const ssId = sc.ss.getId();
    g.readBlockedSpreadsheetIds_ = function () { return [ssId]; };
    const r = compareScene('只可查看', g, sc.Q);
    const leaks = [r.a, r.b].map((x) => JSON.stringify(x).indexOf(ssId) !== -1);
    check('★★★★★★ 只可查看：兩部分都沒有主試算表的 ID', leaks.every((x) => !x) && JSON.stringify(r.single).indexOf(ssId) === -1, JSON.stringify(leaks));
  }

  console.log('\n=== YB2：新 api 的把關 ===');
  {
    const dash = read('src/WebAppDashboard.gs');
    const body = dash.slice(dash.indexOf('function apiGetDashboardStatePart('), dash.indexOf('\n}\n', dash.indexOf('function apiGetDashboardStatePart(')));
    check('★★★★★★ 第一句是自己的權限檢查', /function apiGetDashboardStatePart\(quarterId, part\) \{\s*const role = assertWebAppRequestAllowed_\('apiGetDashboardStatePart'\);/.test(dash));
    check('★★★★★ 開讀表記憶及請求記憶，finally 關掉；回傳經 viewerSafeState_',
      /beginSheetReadMemo_\(\);\s*beginRequestContextMemo_\(\);/.test(body) && /finally \{\s*endRequestContextMemo_\(\);\s*endSheetReadMemo_\(\);/.test(body)
      && /viewerSafeState_\(role, part === 'A' \? buildDashboardPartA_\(quarterId\) : buildDashboardPartB_\(quarterId\)\)/.test(body));
    check('★★★★★ part 只可以是 A 或 B', /if \(part !== 'A' && part !== 'B'\) throw new Error/.test(body));
    check('★★★★★★ 伺服器唯讀名單及前端唯讀名單都有 apiGetDashboardStatePart',
      /'apiGetDashboardState', 'apiGetDashboardStatePart',/.test(read('src/WebApp.gs')) && /\n\s*'apiGetDashboardStatePart',\n/.test(read('src/ui/Script.html')));
    check('★★★★★ 單一呼叫＝兩部分合併（同一批函式）',
      /function buildDashboardState_\(quarterId\) \{[\s\S]{0,400}?return mergeDashboardParts_\(buildDashboardPartA_\(quarterId\), buildDashboardPartB_\(quarterId\)\);/.test(dash));
    const gas = buildRound75Scene().gas;
    gas.assertWebAppRequestAllowed_ = function () { return 'EDITOR'; };
    let msg = '';
    try { gas.apiGetDashboardStatePart('2099T9', 'C'); } catch (e) { msg = e.message; }
    check('★★★★ part 不是 A／B ⇒ 拒絕', /part 只可以是 A 或 B/.test(msg), msg);
  }

  console.log('\n=== YB3／YB4／YB5：前端 ===');
  const FILES = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html', 'ScriptZone5.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];
  function makeUi() {
    const ui = loadUiScripts(FILES);
    const timers = [];
    ui.setTimeout = (cb, ms) => { timers.push({ cb: cb, ms: ms }); return timers.length; };
    ui.clearTimeout = () => {};
    ui.setInterval = () => 0;
    ui.clearInterval = () => {};
    const env = { ui: ui, timers: timers, calls: [], serve: null };
    ui.callServerRaw_ = (fn, ...args) => { env.calls.push(fn + ':' + args.join('/')); return env.serve(fn, ...args); };
    ui.renderTop = () => {};
    ui.renderMainFlow = async () => {};
    ui.renderZone1 = () => {}; ui.renderZone2Head = () => {}; ui.renderZone3Always = () => {}; ui.renderZone4 = () => {};
    env.fire = () => { timers.splice(0).forEach((x) => { if (x.ms >= 10000) x.cb(); }); };
    env.q = (expr) => vm.runInContext(expr, ui);
    env.notice = () => ui.document.getElementById('loadFailureNotice');
    vm.runInContext("currentQuarterId = '2099T1'; dashboardParallel_ = true;", ui);
    return env;
  }
  const sig = (v, extra) => Object.assign({ quarterId: '2099T1', versionNo: v, stage: 'DRAFT', sendLogRows: 0 }, extra || {});
  const partA = (v, x) => ({ quarterId: '2099T1', stage: 'DRAFT', dashboardSignature: sig(v), unsaved: { gridChangeCount: x || 0 }, buttons: { b: 1 },
    timings: { phases: [{ label: '讀工作表（未儲存）', ms: 5000 }, { label: '合計', ms: 9000 }], fineTuneContextCount: 1, fineTuneContextMs: 4000, fineTuneContextReused: 1 } });
  const partB = (v) => ({ quarterId: '2099T1', stage: 'DRAFT', dashboardSignature: sig(v), latestVersion: { versionNo: v }, statusText: '第 ' + v + ' 版',
    dashboardParallel: true, loadTimeoutSeconds: 150,
    timings: { phases: [{ label: '讀工作表（版本）', ms: 1000 }, { label: '寄出警告', ms: 2000 }, { label: '合計', ms: 7000 }], fineTuneContextCount: 1, fineTuneContextMs: 3000, fineTuneContextReused: 0 } });
  {
    const env = makeUi();
    env.serve = (fn, q, part) => Promise.resolve(fn === 'apiGetDashboardStatePart' ? (part === 'A' ? partA(2, 3) : partB(2)) : { q: q });
    await env.ui.loadDashboard();
    const parts = env.calls.filter((c) => /^apiGetDashboardState/.test(c));
    check('★★★★★★ 並行：同時送出第一部分及第二部分（沒有單一呼叫）', parts.join(',') === 'apiGetDashboardStatePart:2099T1/A,apiGetDashboardStatePart:2099T1/B', parts.join(','));
    check('★★★★★★ 合併成一個狀態物件（兩部分的內容都在）', env.q('dashboardState_.unsaved.gridChangeCount') === 3 && env.q('dashboardState_.statusText') === '第 2 版'
      && env.q('dashboardState_.buttons.b') === 1);
    check('★★★★★ 計時：第一部分在 timings，第二部分在 timings.partB（各自的 fine-tune 次數）', env.q('dashboardState_.timings.partB.phases[1].label') === '寄出警告'
      && env.q('dashboardState_.timings.fineTuneContextCount') === 1 && env.q('dashboardState_.timings.partB.fineTuneContextCount') === 1
      && env.q('dashboardState_.timings.phases[0].label') === '讀工作表（未儲存）');
    const footer = env.ui.document.getElementById('loadTimings').textContent;
    check('★★★★★ 頁底分開列出兩部分各自的合計及各段', /伺服器第一部分：讀工作表 5\.0、fine-tune context 1 次 4\.0（合計 9\.0）/.test(footer)
      && /伺服器第二部分：讀工作表 1\.0、fine-tune context 1 次 3\.0、寄出警告 2\.0（合計 7\.0）/.test(footer) && /各段：讀工作表（版本） 1\.0、寄出警告 2\.0/.test(footer), footer);
  }
  {
    // 簽名不一致一次 ⇒ 重讀；第二次一致 ⇒ 用第二次
    const env = makeUi();
    let round = 0;
    env.serve = (fn, q, part) => {
      if (fn !== 'apiGetDashboardStatePart') return Promise.resolve({});
      if (part === 'A') round++;
      return Promise.resolve(part === 'A' ? partA(round === 1 ? 3 : 4) : partB(4));
    };
    await env.ui.loadDashboard();
    check('★★★★★★ 兩部分版本號不一致 ⇒ 整個重讀一次；一致 ⇒ 用重讀的結果', round === 2 && env.q('dashboardState_.latestVersion.versionNo') === 4
      && env.calls.filter((c) => /StatePart/.test(c)).length === 4);
    // 兩次都不一致 ⇒ 當作失敗（第一次載入 ⇒ 清空、頁頂通知）
    const env2 = makeUi();
    env2.serve = (fn, q, part) => Promise.resolve(fn === 'apiGetDashboardStatePart'
      ? (part === 'A' ? partA(1) : Object.assign(partB(1), { dashboardSignature: sig(1, { stage: 'REVIEW_SENT' }) })) : {});
    let err = null;
    await env2.ui.loadDashboard().catch((e) => { err = e; });
    check('★★★★★★ 重讀之後仍然不一致 ⇒ 當作載入失敗（狀態快取沒有被寫入，頁頂通知）',
      err && /兩部分的資料不一致/.test(err.message) && env2.q('dashboardState_') === null && env2.notice().hidden === false
      && env2.calls.filter((c) => /StatePart/.test(c)).length === 4, err && err.message);
    check('★★★★ 簽名要對準請求的季度', env2.ui.dashboardPartsAgree_(partA(1), partB(1), '2099T1') === true
      && env2.ui.dashboardPartsAgree_(partA(1), partB(1), '2099T2') === false && env2.ui.dashboardPartsAgree_(partA(1), {}, '2099T1') === false);
  }
  {
    // 先成功載入一次（同一季），再：其中一部分失敗 ⇒ 舊狀態不被部分更新
    const env = makeUi();
    env.serve = (fn, q, part) => Promise.resolve(fn === 'apiGetDashboardStatePart' ? (part === 'A' ? partA(2, 0) : partB(2)) : {});
    await env.ui.loadDashboard();
    env.serve = (fn, q, part) => (fn === 'apiGetDashboardStatePart'
      ? (part === 'A' ? Promise.resolve(partA(3, 9)) : Promise.reject(new Error('第二部分讀不到'))) : Promise.resolve({}));
    let err = null;
    await env.ui.loadDashboard().catch((e) => { err = e; });
    check('★★★★★★ 第二部分失敗 ⇒ 整次失敗，不用第一部分的結果（狀態仍然是上一次的）', err && env.q('dashboardState_.unsaved.gridChangeCount') === 0
      && env.q('dashboardState_.latestVersion.versionNo') === 2 && env.q('dashboardLoadFailed_') === true && env.notice().hidden === false);
    // 其中一部分超時 ⇒ 一樣
    let releaseB = null;
    env.serve = (fn, q, part) => (fn === 'apiGetDashboardStatePart'
      ? (part === 'A' ? Promise.resolve(partA(5, 7)) : new Promise((r) => { releaseB = r; })) : Promise.resolve({}));
    let err2 = null;
    const p = env.ui.loadDashboard().catch((e) => { err2 = e; });
    await settle();
    env.fire();
    await p;
    check('★★★★★★ 第二部分超時 ⇒ 整次當作超時，狀態沒有被部分更新', err2 && err2.loadTimeout === true && env.q('dashboardState_.unsaved.gridChangeCount') === 0);
    releaseB(partB(5));
    await settle();
    check('★★★★★★ 超時的那一部分遲來 ⇒ 不理會（狀態不變）', env.q('dashboardState_.latestVersion.versionNo') === 2 && env.q('dashboardState_.unsaved.gridChangeCount') === 0);
    // 較新的一次已完成，較舊的兩部分才回來 ⇒ 不理會
    let relA = null; let relB = null;
    env.serve = (fn, q, part) => (fn === 'apiGetDashboardStatePart'
      ? new Promise((r) => { if (part === 'A') relA = r; else relB = r; }) : Promise.resolve({}));
    const old = env.ui.loadDashboard();
    await settle();
    env.serve = (fn, q, part) => Promise.resolve(fn === 'apiGetDashboardStatePart' ? (part === 'A' ? partA(8, 1) : partB(8)) : {});
    await env.ui.loadDashboard();
    relA(partA(6, 6)); relB(partB(6));
    await old;
    check('★★★★★★ 較舊的一次（兩部分）遲來 ⇒ 不蓋過較新的狀態', env.q('dashboardState_.latestVersion.versionNo') === 8 && env.q('dashboardState_.unsaved.gridChangeCount') === 1);
  }
  {
    // Config FALSE ⇒ 只送一個呼叫
    const env = makeUi();
    env.q('dashboardParallel_ = false;');
    env.serve = (fn, q) => Promise.resolve(fn === 'apiGetDashboardState' ? Object.assign(partA(2), partB(2), { dashboardParallel: false }) : {});
    await env.ui.loadDashboard();
    const parts = env.calls.filter((c) => /^apiGetDashboardState/.test(c));
    check('★★★★★★ WEBAPP_DASHBOARD_PARALLEL＝FALSE ⇒ 只送一個 apiGetDashboardState', parts.join(',') === 'apiGetDashboardState:2099T1', parts.join(','));
    // 回覆寫 TRUE ⇒ 下一次用並行
    env.serve = (fn, q, part) => Promise.resolve(fn === 'apiGetDashboardState' ? Object.assign(partA(2), partB(2), { dashboardParallel: true })
      : (fn === 'apiGetDashboardStatePart' ? (part === 'A' ? partA(2) : partB(2)) : {}));
    await env.ui.loadDashboard();
    env.calls.length = 0;
    await env.ui.loadDashboard();
    check('★★★★★ 狀態卡帶回 dashboardParallel ⇒ 之後跟它', env.calls.filter((c) => /StatePart/.test(c)).length === 2, env.calls.join(','));
    // 還未知道（沒有權限回覆）⇒ 單一呼叫
    const env3 = makeUi();
    env3.q('dashboardParallel_ = false;');
    check('★★★★★ 預設（還未收到權限回覆）是單一呼叫', /let dashboardParallel_ = false;/.test(read('src/ui/Script.html')));
    env3.serve = (fn) => Promise.resolve(fn === 'apiGetMyPermission' ? { role: 'EDITOR', canModify: true, canConfirm: true, quarters: [], dashboardParallel: true } : {});
    await env3.ui.loadMyPermission_();
    check('★★★★★★ 權限回覆帶 dashboardParallel ⇒ 第一次載入已經可以並行', env3.q('dashboardParallel_') === true);
    check('★★★★★ 伺服器：權限回覆帶 dashboardParallel（可以修改／只可查看的人）', /out\.dashboardParallel = readDashboardParallel_\(\)/.test(read('src/WebApp.gs')));
  }
  {
    const g = buildRound75Scene().gas;
    check('★★★★★ Config 預設 TRUE；FALSE ⇒ readDashboardParallel_ 回 false', g.DEFAULTS.WEBAPP_DASHBOARD_PARALLEL === true
      && (() => { g.getConfig_ = (k, d) => (k === 'WEBAPP_DASHBOARD_PARALLEL' ? false : d); return g.readDashboardParallel_() === false; })()
      && (() => { g.getConfig_ = (k, d) => d; return g.readDashboardParallel_() === true; })());
    check('★★★★ 〔補建設定及範本〕會補上；上線值清單有', /WEBAPP_DASHBOARD_PARALLEL/.test(read('src/ConfigSeed.gs'))
      && /WEBAPP_DASHBOARD_PARALLEL: \{ launchTargetValue: 'TRUE'/.test(read('src/ConfigBaselineCheck.gs')) && /"WEBAPP_DASHBOARD_PARALLEL"/.test(read('docs/config_baseline_上線值.json')));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  finished = true;
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  測試本身出錯：' + (e && e.stack)); finished = true; process.exit(1); });
