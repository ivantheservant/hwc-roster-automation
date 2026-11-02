// 第九十五輪批次 VB 組：出席系統同步不再拖慢載入。
// 執行方式：node tests/round95_vb_hwcas_sync.test.js
//
//   VB1 打開時同步不再 force：10 分鐘內同步過 ⇒ 略過（不讀出席系統、不寫名單）；超過 ⇒ 照舊同步
//   VB2 回傳「有沒有更新任何人」（updated／emailChanged）及狀態卡那一行（dashboardSync）
//   VB3 只有有更新時才重新載入狀態卡；電郵有改才連主流程資料一起重讀；沒有更新 ⇒ 只換狀態卡那一行
//   VB4 同步在背景：頁頂細字「正在同步出席系統……」，介面不鎖；完成後收起
//   VB5 同步中按改動按鈕被鎖拒絕 ⇒「出席系統正在同步（約十秒），請稍後再按。」（只改這一種情況）
//   VB6 依賴「打開時一定同步」的地方改為動作開始時同步：〔名單檢查〕、〔寄出季前資料〕、〔邀請義工申報〕
//   VB7 背景同步沒有更新任何人 ⇒ 不標記狀態過期（不會引起多一次載入）
// 用假資料。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
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
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
// 有 Promise 一直沒有完成時 Node 會靜靜以 0 結束——一定要當失敗
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  測試沒有跑完（有 Promise 一直沒有完成）'); process.exitCode = 1; } });

function serverScene() {
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs', 'MutationLock.gs', 'WebAppHwcas.gs']);
  g.log_ = function () {};
  g.assertWebAppRequestAllowed_ = function () {};
  g.getConfig_ = (k, fb) => (k === 'SYS_TIMEZONE' ? 'Pacific/Auckland' : fb);
  g.Utilities = { formatDate: () => '2099-01-01' };
  const props = {};
  g.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (props[k] === undefined ? null : props[k]),
    setProperty: (k, v) => { props[k] = String(v); }
  }) };
  const cache = {};
  g.CacheService = { getScriptCache: () => ({
    get: (k) => (cache[k] === undefined ? null : cache[k]),
    put: (k, v) => { cache[k] = String(v); },
    remove: (k) => { delete cache[k]; }
  }) };
  const lockState = { held: false, tries: 0 };
  g.LockService = { getDocumentLock: () => ({
    tryLock: () => { lockState.tries++; if (lockState.held) return false; lockState.held = true; return true; },
    releaseLock: () => { lockState.held = false; }
  }) };
  const syncCalls = [];
  g.syncPeopleFromHwcasByMemberNo_ = () => {
    syncCalls.push({ runningMarker: g.isHwcasSyncRunning_() });
    return { updated: 2, emailChanged: 1, notFound: [], duplicates: [], unlinkedCount: 0, noEmailInHwcasCount: 0, syncedAtText: '2099-01-01 09:00:00' };
  };
  return { g, props, cache, lockState, syncCalls };
}

console.log('\n=== VB1／VB2：伺服器 ===');
{
  const s = serverScene();
  const g = s.g;
  s.props.HWCAS_SYNC_LAST_AT = String(Date.now() - 60 * 1000);   // 一分鐘前同步過
  s.props.HWCAS_SYNC_LAST_TEXT = '2099-01-01 08:59:00';
  let r = g.apiSyncPeopleFromHwcas({});
  check('★★★★★★ VB1 打開時（不 force）10 分鐘內同步過 ⇒ 略過，不讀出席系統', r.skipped === 'recent' && s.syncCalls.length === 0 && r.updated === 0, JSON.stringify(r));
  check('★★★★★ VB2 略過時也回傳狀態卡那一行（dashboardSync）', r.dashboardSync && /電郵已由出席系統更新/.test(r.dashboardSync.line), JSON.stringify(r.dashboardSync));
  r = g.apiSyncPeopleFromHwcas({ force: true });
  check('★★★★ force 照舊不理 10 分鐘（〔連結勾了的人〕之後即時同步用）', s.syncCalls.length === 1 && r.updated === 2);
  s.props.HWCAS_SYNC_LAST_AT = String(Date.now() - 11 * 60 * 1000);
  r = g.apiSyncPeopleFromHwcas({});
  check('★★★★★★ VB1 超過 10 分鐘 ⇒ 照舊同步', s.syncCalls.length === 2 && r.ok === true && r.skipped === '', JSON.stringify(r));
  check('★★★★★★ VB2 回傳有沒有更新任何人（updated、emailChanged）', r.updated === 2 && r.emailChanged === 1);
  check('★★★★ VB2 回傳 dashboardSync（同 describeHwcasSyncForDashboard_）', JSON.stringify(r.dashboardSync) === JSON.stringify(g.describeHwcasSyncForDashboard_()));
  check('★★★★★ HWCAS_SYNC_MIN_INTERVAL_MS 仍然是 10 分鐘（Config 沒有這一項）', g.HWCAS_SYNC_MIN_INTERVAL_MS === 10 * 60 * 1000);
}

console.log('\n=== VB5：同步中按改動按鈕 ===');
{
  const s = serverScene();
  const g = s.g;
  s.props.HWCAS_SYNC_LAST_AT = '0';
  let during = null;
  g.syncPeopleFromHwcasByMemberNo_ = () => {
    // 同步進行中（拿着鎖）：另一個請求按了改動按鈕
    try { g.withMutationLock_('儲存我的修改', () => 'ran'); during = 'ran'; } catch (e) { during = e.message; }
    return { updated: 0, emailChanged: 0, notFound: [], duplicates: [], unlinkedCount: 0, noEmailInHwcasCount: 0, syncedAtText: 'x' };
  };
  g.apiSyncPeopleFromHwcas({});
  check('★★★★★★ VB5 同步中被鎖拒絕 ⇒「出席系統正在同步（約十秒），請稍後再按。」', during === '出席系統正在同步（約十秒），請稍後再按。', during);
  check('★★★★★ VB5 同步完成後記號清除、鎖已放', !g.isHwcasSyncRunning_() && s.lockState.held === false);
  // 其他動作拿着鎖 ⇒ 字眼照舊
  s.lockState.held = true;
  let other = '';
  try { g.withMutationLock_('儲存我的修改', () => 'ran'); } catch (e) { other = e.message; }
  check('★★★★★★ VB5 其他動作拿着鎖 ⇒ 照舊「另一個動作仍在進行」', /另一個動作仍在進行/.test(other) && other.indexOf('出席系統正在同步') === -1, other);
  s.lockState.held = false;
  // 同步出錯也要清記號
  g.runHwcasSyncSafely_ = () => { throw new Error('boom'); };
  try { g.apiSyncPeopleFromHwcas({}); } catch (e) { /* 預期 */ }
  check('★★★★★ VB5 同步中途出錯，記號照樣清除', !g.isHwcasSyncRunning_() && s.lockState.held === false);
  // 記號放 CacheService（兩分鐘自動過期）
  check('★★★★ 記號有過期時間（CacheService TTL）', /cache\.put\(HWCAS_SYNC_RUNNING_CACHE_KEY, String\(Date\.now\(\)\), HWCAS_SYNC_RUNNING_TTL_SECONDS\)/.test(read('src/SheetReader.gs')));
  const s2 = serverScene();
  s2.props.HWCAS_SYNC_LAST_AT = '0';
  s2.g.apiSyncPeopleFromHwcas({});
  check('★★★★★ 同步進行時記號是開着的', s2.syncCalls.length === 1 && s2.syncCalls[0].runningMarker === true);
}

console.log('\n=== VB6：動作開始時同步 ===');
{
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'MutationLock.gs', 'PreseasonPack.gs', 'UnavailableInvite.gs']);
  g.log_ = function () {};
  g.assertWebAppRequestAllowed_ = function () {};
  let held = 0;
  g.LockService = { getDocumentLock: () => ({ tryLock: () => { held = 1; return true; }, releaseLock: () => { held = 0; } }) };
  const order = [];
  g.syncPeopleFromHwcasBeforeSend_ = () => { order.push('sync:' + held); return {}; };
  g.sendPreseasonPack_ = () => { order.push('preseason'); return { ok: true }; };
  g.sendUnavailableInvites_ = () => { order.push('invite'); return { ok: true }; };
  g.apiPreseasonSend('2099T1');
  g.apiUnavailableInviteSend('2099T1');
  check('★★★★★★ VB6〔寄出季前資料〕先同步（在鎖內）再寄', order.slice(0, 2).join(',') === 'sync:1,preseason', order.join(','));
  check('★★★★★★ VB6〔邀請義工申報〕先同步（在鎖內）再寄', order.slice(2, 4).join(',') === 'sync:1,invite', order.join(','));
  const z2 = code(read('src/ui/ScriptZone2.html'));
  const hints = z2.slice(z2.indexOf('function openPeopleHints'), z2.indexOf("callServer('apiGetPreQuarterChecklist'", z2.indexOf('function openPeopleHints')));
  check('★★★★★★ VB6〔名單檢查〕開始時先同步（不 force；只可查看的人不做；失敗不阻住）',
    /if \(!viewOnly_\) \{\s*try \{ await callServerMutating\('apiSyncPeopleFromHwcas', \{\}\); \} catch \(err\) \{\s*\}\s*\}/.test(hints), hints.slice(0, 400));
  const flow = code(read('src/WebAppFlow.gs'));
  check('★★★★ 寄審閱、正式發出、改動後重發、補寄照舊寄之前同步', (flow.match(/syncPeopleFromHwcasBeforeSend_\(\);/g) || []).length === 3
    && /syncPeopleFromHwcasBeforeSend_\(\);/.test(code(read('src/WebAppZone4.gs'))));
}

console.log('\n=== VB3／VB4／VB7：前端 ===');
(async () => {
  const UI = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];
  const ui = loadUiScripts(UI);
  const calls = [];
  vm.runInContext('__ld = []; __reset = 0; __top = [];'
    + ' loadDashboard = async function (o) { __ld.push(o || null); };'
    + ' resetMainFlowState = function () { __reset++; };'
    + ' renderTop = function (d) { __top.push(JSON.stringify(d.hwcasSync)); };'
    + ' runAction = async function (l, fn) { await fn(); };'
    + ' dashboardState_ = { hwcasSync: { line: "舊" } };', ui);
  let resolveSync;
  ui.callServerMutating = (name, arg) => { calls.push([name, JSON.stringify(arg)]); return new Promise((r) => { resolveSync = r; }); };
  vm.runInContext('hwcasSyncedOnLoad_ = false;', ui);
  const syncing = ui.document.getElementById('hwcasSyncing');
  syncing.hidden = true;   // Index.html 預設收起
  ui.syncHwcasOnLoad();
  await tick();
  check('★★★★★★ VB1 前端不再 force：apiSyncPeopleFromHwcas({})', calls.length === 1 && calls[0][0] === 'apiSyncPeopleFromHwcas' && calls[0][1] === '{}', JSON.stringify(calls));
  check('★★★★★★ VB4 進行中頁頂細字「正在同步出席系統……」', syncing && syncing.hidden === false);
  check('★★★★★ VB4 介面不鎖（同步本身不經 runAction）', !/runAction\([^)]*\)[\s\S]{0,40}apiSyncPeopleFromHwcas/.test(code(read('src/ui/ScriptZone3.html'))));
  resolveSync({ ok: true, skipped: '', updated: 0, emailChanged: 0, dashboardSync: { line: '電郵已由出席系統更新（今日 09:00）' } });
  await tick();
  check('★★★★★ VB4 完成後收起細字', syncing.hidden === true);
  check('★★★★★★ VB3 沒有更新任何人 ⇒ 不重新載入（loadDashboard 0 次）', vm.runInContext('__ld.length', ui) === 0);
  check('★★★★★★ VB3 只換狀態卡那一行（renderTop 用新的 hwcasSync）', vm.runInContext('__top.length', ui) === 1
    && /今日 09:00/.test(vm.runInContext('__top[0]', ui)), vm.runInContext('JSON.stringify(__top)', ui));

  // 有更新、電郵沒有改 ⇒ 只重新載入狀態卡（主流程資料用快取）
  vm.runInContext('hwcasSyncedOnLoad_ = false; __ld = []; __reset = 0;', ui);
  ui.syncHwcasOnLoad();
  resolveSync({ ok: true, skipped: '', updated: 3, emailChanged: 0 });
  await tick();
  check('★★★★★★ VB3 有更新（電郵沒有改）⇒ 重新載入狀態卡一次（保留已開的視窗），不重讀主流程資料',
    vm.runInContext('__ld.length', ui) === 1 && vm.runInContext('__ld[0].keepModal', ui) === true && vm.runInContext('__reset', ui) === 0);
  vm.runInContext('hwcasSyncedOnLoad_ = false; __ld = []; __reset = 0;', ui);
  ui.syncHwcasOnLoad();
  resolveSync({ ok: true, skipped: '', updated: 3, emailChanged: 2 });
  await tick();
  check('★★★★★★ VB3 電郵有改 ⇒ 主流程資料也重讀（第 5 步沒有電郵的人數讀 NameMapping）',
    vm.runInContext('__ld.length', ui) === 1 && vm.runInContext('__reset', ui) === 1);
  vm.runInContext('hwcasSyncedOnLoad_ = false; __ld = [];', ui);
  ui.syncHwcasOnLoad();
  resolveSync({ ok: true, skipped: 'locked', updated: 0 });
  await tick();
  check('★★★★ 拿不到鎖（另一個動作在跑）⇒ 甚麼都不做', vm.runInContext('__ld.length', ui) === 0);

  // VB7：callServerMutating 只在真的改了才標記過期
  const ui2 = loadUiScripts(UI);
  let next = null;
  ui2.callServerRaw_ = async () => next;
  vm.runInContext('dashboardStale_ = false;', ui2);
  next = { ok: true, updated: 0 };
  await ui2.callServerMutating('apiSyncPeopleFromHwcas', {});
  check('★★★★★★ VB7 同步沒有更新任何人 ⇒ 狀態不標記過期', vm.runInContext('dashboardStale_', ui2) === false);
  next = { ok: true, updated: 1 };
  await ui2.callServerMutating('apiSyncPeopleFromHwcas', {});
  check('★★★★★ VB7 有更新 ⇒ 標記過期', vm.runInContext('dashboardStale_', ui2) === true);
  vm.runInContext('dashboardStale_ = false;', ui2);
  next = { created: [] };
  await ui2.callServerMutating('apiEnsureFutureQuarters');
  check('★★★★★ VB7 建立未來季度沒有建立任何季度 ⇒ 不標記過期', vm.runInContext('dashboardStale_', ui2) === false);
  next = { ok: true };
  await ui2.callServerMutating('apiSaveUnavailable', {});
  check('★★★★★ VB7 其他改動照舊一律標記過期', vm.runInContext('dashboardStale_', ui2) === true);

  check('★★★★ Index.html 有 #hwcasSyncing（預設收起）', /<div class="muted" id="hwcasSyncing" hidden>正在同步出席系統……<\/div>/.test(read('src/ui/Index.html')));

  finished = true;
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
