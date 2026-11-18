// 第一百一十六輪批次 XA／XB 組：狀態卡載入失敗之後的畫面保護，及超時訊息的字眼。
// 執行方式：node tests/round116_xa_xb_load_failure.test.js
//
//   XA1 換季度 A → B 失敗（超時、伺服器錯誤）⇒ 狀態快取清除、畫面收起 A 的內容、頁頂通知＋〔再試一次〕；再試成功 ⇒ 畫出 B、通知收起
//   XA2 同一季重新整理失敗 ⇒ 舊狀態留下但標記過時、頁頂通知；下一次 getDashboard() 重讀；動作完成之後不會自動再載入
//   XA3 遲來的回覆（超時之後、或者較新的載入已完成）不會蓋過較新的狀態；主流程同樣
//   XA4 換季度失敗之後沒有上一季的主流程預讀；深連結不打開畫面
//   XB1 超時錯誤本身不寫按鈕名稱；錯誤視窗用專屬三段（沒有「再試一次」「職事表有沒有被改動」）；送出過改動 ⇒ 另一句
//   XB2 頁頂已有通知 ⇒ runAction() 不再開錯誤視窗（技術詳情在通知內）
//   XB3 src/ui 每一處寫「〔再試一次〕」的函式，都畫出文字為「再試一次」的按鈕
// 用假季度（2099T1／2099T2）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
// 一個 Promise 永遠不完成 ⇒ node 會靜靜以 0 結束；沒有跑到最後一律當作失敗
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  測試沒有跑完（有一個呼叫永遠沒有完成）'); process.exitCode = 1; } });

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 15; i++) await tick(); }
const FILES = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html', 'ScriptZone5.html',
  'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];

/**
 * 一個前端沙箱：計時器由測試觸發；伺服器回覆由 `serve` 決定；畫面各部分的畫法換成記錄（只測狀態快取及收起）。
 */
function makeUi() {
  const ui = loadUiScripts(FILES);
  const timers = [];
  ui.setTimeout = (cb, ms) => { timers.push({ cb: cb, ms: ms }); return timers.length; };
  ui.clearTimeout = () => {};
  ui.setInterval = () => 0;
  ui.clearInterval = () => {};
  const calls = [];
  const env = { ui: ui, timers: timers, calls: calls, serve: null, rendered: [] };
  ui.callServerRaw_ = (fn, ...args) => { calls.push(fn + ':' + (args[0] || '')); return env.serve(fn, ...args); };
  // 畫面：每一部分畫的時候放一個標記節點（之後看有沒有被收起）
  const mark = (id, text) => { const n = ui.document.createElement('div'); n.textContent = text; ui.clear(ui.document.getElementById(id)).appendChild(n); };
  ui.renderTop = (d) => { ui.document.getElementById('statusCard').hidden = false; env.rendered.push('top:' + d.quarterId); mark('statusText', '狀態卡 ' + d.quarterId); };
  ui.renderMainFlow = async (d) => { mark('mainFlowBody', '主流程 ' + d.quarterId); ui.document.getElementById('flowHeadSub').textContent = '四步 ' + d.quarterId; };
  ui.renderZone1 = (d) => mark('zone1Body', '區一 ' + d.quarterId);
  ui.renderZone2Head = (d) => { ui.document.getElementById('zone2Count').textContent = '還有 3 項 ' + d.quarterId; mark('zone2Body', '這一季還要做的 ' + d.quarterId); };
  ui.renderZone3Always = (d) => mark('zone3Body', '常用設定 ' + d.quarterId);
  ui.renderZone4 = (d) => mark('zone4Body', '進階 ' + d.quarterId);
  env.fire = () => { const t = timers.splice(0); t.forEach((x) => { if (x.ms >= 10000) x.cb(); }); };
  env.q = (expr) => vm.runInContext(expr, ui);
  env.text = (id) => ui.document.getElementById(id).textContent;
  env.notice = () => ui.document.getElementById('loadFailureNotice');
  env.retryBtn = () => env.notice().flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '再試一次')[0];
  return env;
}
const stateOf = (q) => ({ quarterId: q, statusText: '狀態 ' + q, loadTimeoutSeconds: 150 });
/** 先成功載入季度 A，畫面上有 A 的內容。 */
async function loadA(env) {
  env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(stateOf(q)) : Promise.resolve({ q: q }));
  env.q("currentQuarterId = '2099T1';");
  await env.ui.loadDashboard();
  env.notice().hidden = true;
}
const SCREEN_IDS = ['mainFlowBody', 'zone1Body', 'zone2Body', 'zone3Body', 'zone4Body'];

(async function () {
  console.log('\n=== XA1：換季度 A → B，狀態卡超時 ===');
  {
    const env = makeUi();
    await loadA(env);
    check('★★★★ 前提：畫面上是 A（狀態卡、主流程、這一季還要做的）', env.q('dashboardState_.quarterId') === '2099T1'
      && /主流程 2099T1/.test(env.text('mainFlowBody')) && /2099T1/.test(env.text('zone2Count')));
    env.q("zoneLoadState = { zone2Body: true, zone3Body: true };");
    env.serve = () => new Promise(() => {});   // 伺服器一直不回覆
    env.q("currentQuarterId = '2099T2';");
    let err = null;
    const p = env.ui.loadDashboard().catch((e) => { err = e; });
    await settle();
    env.fire();
    await p;
    check('★★★★★★ 錯誤是超時，而且標記了「頁頂已寫明」', err && err.loadTimeout === true && err.shownInNotice === true, err && err.message);
    check('★★★★★★ 狀態快取已清除（不再是 A）', env.q('dashboardState_') === null);
    check('★★★★★★ 畫面沒有 A：狀態卡收起；主流程、這一季還要做的、各區已畫的內容清空',
      env.ui.document.getElementById('statusCard').hidden === true && SCREEN_IDS.every((id) => env.text(id) === '')
      && env.text('zone2Count') === '' && env.text('flowHeadSub') === '', SCREEN_IDS.map((id) => id + '=' + env.text(id)).join('；'));
    check('★★★★★ 之後展開的摺疊區要重新讀（區的載入狀態已清走）', JSON.stringify(env.q('zoneLoadState')) === '{}');
    check('★★★★★★ 頁頂：「「狀態卡」載入太久（伺服器超過 150 秒還沒有回覆）。這一季的狀態卡、主流程及各區暫時不顯示…請按〔再試一次〕。」＋按鈕',
      env.notice().hidden === false && env.text('loadFailureNotice').indexOf('「狀態卡」載入太久（伺服器超過 150 秒還沒有回覆）。這一季的狀態卡、主流程及各區暫時不顯示，要等狀態卡載入成功才可以用。請按〔再試一次〕。') === 0
      && !!env.retryBtn(), env.text('loadFailureNotice'));
    check('★★★★★ 換季度失敗之後沒有上一季（或失敗）的主流程預讀', env.q('mainFlowPending_') === null && env.q('mainFlowState_') === null);
    // 深連結：載入失敗 ⇒ 不打開畫面
    env.q('__opened = []; openCombinedServices = function () { __opened.push("combined"); };');
    const notes = env.ui.applyDeepLink_(env.ui.parseDeepLink_({ view: 'combined', quarter: '2099T2' }));
    check('★★★★★ 深連結：載入失敗 ⇒ 不打開畫面，頁頂寫「畫面還未載入成功，所以沒有打開網址指定的畫面。」（不講找不到季度）',
      env.q('__opened').length === 0 && JSON.stringify(notes) === JSON.stringify(['畫面還未載入成功，所以沒有打開網址指定的畫面。']), JSON.stringify(notes));
    // 再試一次：只重做 loadDashboard()（唯讀），成功 ⇒ 畫出 B、通知收起
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(stateOf(q)) : Promise.resolve({ q: q }));
    env.calls.length = 0;
    env.retryBtn().fire('click');
    await settle();
    check('★★★★★★ 按〔再試一次〕⇒ 只讀 B 的狀態卡（及主流程），畫出 B，通知收起',
      env.calls.every((c) => /^apiGet(DashboardState|MainFlowState):2099T2$/.test(c)) && env.calls.indexOf('apiGetDashboardState:2099T2') !== -1
      && env.q('dashboardState_.quarterId') === '2099T2' && /主流程 2099T2/.test(env.text('mainFlowBody')) && env.notice().hidden === true
      && env.q('dashboardLoadFailed_') === false, env.calls.join(','));
  }

  console.log('\n=== XA1：換季度 A → B，伺服器錯誤 ===');
  {
    const env = makeUi();
    await loadA(env);
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? Promise.reject(new Error('找不到工作表：Quarters')) : Promise.resolve({}));
    env.q("currentQuarterId = '2099T2';");
    let err = null;
    await env.ui.loadDashboard().catch((e) => { err = e; });
    check('★★★★★★ 伺服器錯誤 ⇒ 一樣清走 A、收起畫面、頁頂「「狀態卡」載入失敗。」＋〔再試一次〕、技術詳情拿得到',
      err && !err.loadTimeout && err.shownInNotice === true && env.q('dashboardState_') === null
      && env.ui.document.getElementById('statusCard').hidden === true && SCREEN_IDS.every((id) => env.text(id) === '')
      && env.text('loadFailureNotice').indexOf('「狀態卡」載入失敗。') === 0 && !!env.retryBtn() && /複製技術詳情/.test(env.text('loadFailureNotice'))
      && /找不到工作表：Quarters/.test(env.text('loadFailureNotice')), env.text('loadFailureNotice'));
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(stateOf(q)) : Promise.resolve({ q: q }));
    env.calls.length = 0;
    const d = await env.ui.getDashboard();
    check('★★★★★★ 之後 getDashboard() 一定重讀（不會回傳 A）', d && d.quarterId === '2099T2' && env.calls.indexOf('apiGetDashboardState:2099T2') !== -1, env.calls.join(','));
  }

  console.log('\n=== XA2：同一季重新整理失敗 ===');
  {
    const env = makeUi();
    await loadA(env);
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? Promise.reject(new Error('Exception: 讀不到')) : Promise.resolve({}));
    let err = null;
    await env.ui.loadDashboard().catch((e) => { err = e; });
    check('★★★★★★ 舊狀態留在畫面（同一季），但標記為過時', err && env.q('dashboardState_.quarterId') === '2099T1' && env.q('dashboardLoadFailed_') === true
      && env.ui.document.getElementById('statusCard').hidden === false && /主流程 2099T1/.test(env.text('mainFlowBody')));
    check('★★★★★★ 頁頂：「「狀態卡」載入失敗。畫面上的數字可能不是最新的。請按〔再試一次〕。」＋按鈕',
      env.text('loadFailureNotice').indexOf('「狀態卡」載入失敗。畫面上的數字可能不是最新的。請按〔再試一次〕。') === 0 && !!env.retryBtn(), env.text('loadFailureNotice'));
    env.calls.length = 0;
    await env.ui.runAction('只看', async () => {});
    check('★★★★★ 一個沒有寫入的動作完成之後，不會因為載入失敗而自動再載入（不會每次都再等一整段時限）', env.calls.length === 0, env.calls.join(','));
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(Object.assign(stateOf(q), { statusText: '新' })) : Promise.resolve({ q: q }));
    const d = await env.ui.getDashboard();
    check('★★★★★★ 下一次 getDashboard() 重讀', d && d.statusText === '新' && env.calls.indexOf('apiGetDashboardState:2099T1') !== -1 && env.q('dashboardLoadFailed_') === false, env.calls.join(','));
  }

  console.log('\n=== XA3：遲來的回覆 ===');
  {
    const env = makeUi();
    await loadA(env);
    // (a) 超時之後才回來
    let release1 = null;
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? new Promise((r) => { release1 = r; }) : Promise.resolve({}));
    const p1 = env.ui.loadDashboard().catch(() => {});
    await settle();
    env.fire();
    await p1;
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(Object.assign(stateOf(q), { statusText: '較新' })) : Promise.resolve({ q: q }));
    await env.ui.loadDashboard();
    release1(Object.assign(stateOf('2099T1'), { statusText: '舊（超時那一次）' }));
    await settle();
    check('★★★★★★ 已超時的 apiGetDashboardState 遲來的結果不寫入狀態快取、不畫到畫面', env.q('dashboardState_.statusText') === '較新'
      && env.rendered.filter((r) => r === 'top:2099T1').length === 2, env.q('dashboardState_.statusText'));
    // (b) 未超時，但較新的一次已經完成
    let release2 = null; let reject3 = null;
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? new Promise((r) => { release2 = r; }) : Promise.resolve({}));
    const p2 = env.ui.loadDashboard();
    await settle();
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(Object.assign(stateOf(q), { statusText: '第三次' })) : Promise.resolve({ q: q }));
    await env.ui.loadDashboard();
    release2(Object.assign(stateOf('2099T1'), { statusText: '第二次（較舊）' }));
    await p2;
    check('★★★★★★ 較舊的一次遲來 ⇒ 不蓋過較新的狀態', env.q('dashboardState_.statusText') === '第三次', env.q('dashboardState_.statusText'));
    // (c) 較舊的一次遲來而且失敗 ⇒ 不清走、不寫通知
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? new Promise((r, j) => { reject3 = j; }) : Promise.resolve({}));
    const p3 = env.ui.loadDashboard().catch((e) => e);
    await settle();
    env.serve = (fn, q) => (fn === 'apiGetDashboardState' ? Promise.resolve(Object.assign(stateOf(q), { statusText: '第五次' })) : Promise.resolve({ q: q }));
    await env.ui.loadDashboard();
    reject3(new Error('遲來的錯誤'));
    await p3;
    check('★★★★★ 較舊的一次遲來失敗 ⇒ 不碰畫面（狀態、通知都是較新那一次的）', env.q('dashboardState_.statusText') === '第五次'
      && env.notice().hidden === true && env.q('dashboardLoadFailed_') === false, env.text('loadFailureNotice'));
    // (d) 主流程：已超時的預讀，遲來的結果不放入快取
    env.q('resetMainFlowState();');
    let releaseMf = null;
    env.serve = (fn) => (fn === 'apiGetMainFlowState' ? new Promise((r) => { releaseMf = r; }) : Promise.resolve({}));
    env.ui.prefetchMainFlowState_();
    await settle();
    env.fire();
    await settle();
    releaseMf({ q: '遲來' });
    await settle();
    check('★★★★★★ 已超時的 apiGetMainFlowState 遲來的結果不放入主流程快取', env.q('mainFlowState_') === null);
    // (e) 主流程：等候期間換了季度 ⇒ 不以新季度的名義放入快取
    env.q('resetMainFlowState();');
    let releaseMf2 = null;
    env.serve = (fn) => (fn === 'apiGetMainFlowState' ? new Promise((r) => { releaseMf2 = r; }) : Promise.resolve({}));
    const pm = env.ui.getMainFlowState();
    await settle();
    env.q("currentQuarterId = '2099T2';");
    releaseMf2({ q: '2099T1 的資料' });
    await pm;
    check('★★★★★★ 主流程：等候期間換了季度 ⇒ 舊季度的資料不放入快取', env.q('mainFlowState_') === null && env.q('mainFlowStaleQuarter_') === null);
  }

  console.log('\n=== XB1：超時的字眼 ===');
  {
    const src = read('src/ui/Script.html');
    const wlt = src.slice(src.indexOf('function withLoadTimeout_('), src.indexOf('function showLoadFailureNotice_('));
    check('★★★★★★ 超時錯誤本身不寫任何按鈕名稱（沒有〔〕）', wlt.indexOf("這一部分' + LOAD_TIMEOUT_MARK + '（伺服器超過 '") !== -1 && !/new Error\([^;]*〔/.test(wlt));
    const env = makeUi();
    await loadA(env);
    env.serve = () => new Promise(() => {});
    const p = env.ui.runAction('讀取資料', async () => { await env.ui.callServer('apiGetDashboardState', '2099T1'); });
    await settle();
    env.fire();
    await p;
    const t = env.text('modalBody');
    check('★★★★★★ 只讀的超時 ⇒ 錯誤視窗：「伺服器超過 150 秒還沒有回覆…」「剛才只是讀取資料，沒有改動任何資料，亦沒有寄出任何電郵。」',
      /伺服器超過 150 秒還沒有回覆，畫面沒有再等下去。/.test(t) && /剛才只是讀取資料，沒有改動任何資料，亦沒有寄出任何電郵。/.test(t), t);
    check('★★★★★★ 你可以怎樣做：再按一次剛才的按鈕；仍然這樣就按頁頂的「重新整理」；一直這樣就把技術詳情交給開發者',
      /再按一次剛才的按鈕/.test(t) && /仍然這樣，就按頁頂的「重新整理」/.test(t) && /把下面的技術詳情複製給開發者/.test(t), t);
    check('★★★★★★ 錯誤視窗沒有「再試一次」，亦沒有「職事表有沒有被改動」', t.indexOf('再試一次') === -1 && t.indexOf('職事表有沒有被改動') === -1, t);
    check('★★★★ 頁頂的〔重新整理〕按鈕真的存在（字眼與畫面一致）', /<button id="btnRefresh"[^>]*>重新整理<\/button>/.test(read('src/ui/Index.html')));
    check('★★★★ 技術詳情寫明是哪一支伺服器函式', /apiGetDashboardState/.test(t), t);
    env.ui.closeModal();
    // 送出過改動之後才超時 ⇒ 不可以講「沒有改動任何資料」
    env.serve = (fn) => (fn === 'apiWriteSomething' ? Promise.resolve({ ok: true }) : new Promise(() => {}));
    const p2 = env.ui.runAction('儲存', async () => {
      await env.ui.callServerMutating('apiWriteSomething');
      await env.ui.callServer('apiGetDashboardState', '2099T1');
    });
    await settle();
    env.fire();
    await settle();
    env.fire();   // finally 的自動刷新（寫入之後）同樣超時
    await p2;
    const t2 = env.text('modalBody');
    check('★★★★★★ 送出過改動才超時 ⇒「剛才的動作已經送出了改動…請按頁頂的「重新整理」，看狀態卡及版本號。」，不講「沒有改動任何資料」',
      /剛才的動作已經送出了改動，之後讀取資料時伺服器沒有回覆。/.test(t2) && t2.indexOf('沒有改動任何資料') === -1 && t2.indexOf('再試一次') === -1, t2);
    env.ui.closeModal();
    // 下一個只讀動作重新計算
    env.serve = () => new Promise(() => {});
    const p3 = env.ui.runAction('讀取資料', async () => { await env.ui.callServer('apiGetDashboardState', '2099T1'); });
    await settle();
    env.fire();
    await settle();
    env.fire();   // 上一個動作寫過、刷新又失敗 ⇒ 這一個動作完成後仍然會自動刷新一次（寫入之後的規則，照舊）
    await p3;
    check('★★★★★ 下一個只讀的動作重新計算（又寫「剛才只是讀取資料」）', /剛才只是讀取資料/.test(env.text('modalBody')), env.text('modalBody'));
  }

  console.log('\n=== XB2：頁頂已有通知 ⇒ 不再開錯誤視窗 ===');
  {
    const env = makeUi();
    await loadA(env);
    env.ui.closeModal();
    env.serve = (fn) => (fn === 'apiGetDashboardState' ? Promise.reject(new Error('讀不到')) : Promise.resolve({}));
    await env.ui.runAction('重新整理', env.ui.loadDashboard);
    check('★★★★★★ 〔重新整理〕失敗 ⇒ 只有頁頂通知（連技術詳情），沒有錯誤視窗',
      env.ui.document.getElementById('modalBackdrop').hidden === true && env.notice().hidden === false && /複製技術詳情/.test(env.text('loadFailureNotice')));
    env.serve = () => Promise.reject(new Error('另一種錯'));
    await env.ui.runAction('讀取資料', async () => { await env.ui.callServer('apiGetMainFlowState', '2099T1'); });
    check('★★★★★ 其他失敗（頁頂沒有寫）⇒ 照舊開錯誤視窗', env.ui.document.getElementById('modalBackdrop').hidden === false);
    const boot = read('src/ui/ScriptBoot.html');
    check('★★★★★ 啟動：季度清單失敗也標記「頁頂已寫明」', /showLoadFailureNotice_\('季度清單', err,[^\n]*\n\s*if \(err && typeof err === 'object'\) err\.shownInNotice = true;/.test(boot));
  }

  console.log('\n=== XB3：寫「〔再試一次〕」的地方一定畫出那個按鈕 ===');
  {
    const hits = [];
    fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => /\.html$/.test(f)).forEach((f) => {
      const text = read('src/ui/' + f);
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (code.indexOf('〔再試一次〕') === -1) return;
        if (/^\s*\*/.test(line) || /<!--/.test(line)) return;   // JSDoc、HTML 註解
        // 所在函式：往上找最近的函式宣告，往下到下一個同層函式
        let s = i; while (s > 0 && !/^\s{2}(async )?function /.test(lines[s])) s--;
        let e = i + 1; while (e < lines.length && !/^\s{2}(async )?function /.test(lines[e])) e++;
        const body = lines.slice(s, e).join('\n');
        hits.push({ at: f + ':' + (i + 1), ok: /button\('再試一次'/.test(body) });
      });
    });
    check('★★★★★★ 每一處（' + hits.length + ' 處）同一個函式都畫出〔再試一次〕按鈕', hits.length >= 1 && hits.every((h) => h.ok),
      hits.filter((h) => !h.ok).map((h) => h.at).join('、') + ' 共 ' + hits.length);
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  finished = true;
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  測試本身出錯：' + (e && e.stack)); finished = true; process.exit(1); });
