// 第八十七輪批次 NA 組：直接開某個畫面的網址（深連結）。
// 執行方式：node tests/round87_na_deep_link.test.js
//
//   NA1　參數解析：只讀 view、quarter（不理 p、q）；大小寫、空白、控制字元；不認得的 view
//   NA2　主畫面載入完成後：quarter 存在 ⇒ 選定那一季；不存在 ⇒ 預設季度＋頁頂一句；view 不認得 ⇒ 不打開、寫一句
//   NA3　打開的畫面和人手按按鈕的是同一個函式（五個畫面）
//   NA4　開機次序：先權限、再讀網址、loadQuarters(quarter)、載入完成後才打開畫面
//   NA5　和個人專屬連結互不干擾：有 p ⇒ doGet 照舊走個人頁；幹事介面的 doGet 不讀 view／quarter
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const UI = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];

(async () => {
  console.log('\n=== NA1：參數解析 ===');
  const ui = loadUiScripts(UI);
  const parse = (p) => JSON.parse(JSON.stringify(ui.parseDeepLink_(p)));
  let r = parse({ view: 'combined', quarter: '2027T1' });
  check('★★★★★★ view=combined&quarter=2027T1', r.view === 'combined' && r.quarter === '2027T1' && r.viewKnown === true, JSON.stringify(r));
  r = parse({ view: ' Staffing ', quarter: ' 2028T3 ' });
  check('★★★★★ 大小寫、前後空白', r.view === 'staffing' && r.quarter === '2028T3' && r.viewKnown, JSON.stringify(r));
  r = parse({ view: 'xyz', quarter: '2099T9' });
  check('★★★★★★ 不認得的 view ⇒ viewKnown=false', r.view === 'xyz' && r.viewKnown === false, JSON.stringify(r));
  r = parse({ p: 'TOKEN', q: '2027T1' });
  check('★★★★★★ 只有 p、q（個人專屬連結的參數）⇒ 不當成 view／quarter', r.view === '' && r.quarter === '' && r.viewKnown === true, JSON.stringify(r));
  r = parse({});
  check('★★★★ 沒有參數 ⇒ 全部空白', r.view === '' && r.quarter === '', JSON.stringify(r));
  r = parse({ view: 'combined\n', quarter: '2027T1\u0000<b>' + 'x'.repeat(80) });
  check('★★★★ 控制字元去掉、最多 40 字', r.view === 'combined' && r.quarter.indexOf('\u0000') === -1 && r.quarter.length === 40, JSON.stringify(r));
  const views = Object.keys(vm.runInContext('DEEP_LINK_VIEWS', ui)).sort().join(',');
  check('★★★★★★ view 可用值：combined、preseason、staffing、unavailable、weights（常數表）', views === 'combined,preseason,staffing,unavailable,weights', views);
  check('★★★★★ 參數名稱是 view、quarter（不是 p、q）', JSON.stringify(vm.runInContext('DEEP_LINK_PARAMS', ui)) === '{"VIEW":"view","QUARTER":"quarter"}');

  console.log('\n=== NA2：主畫面載入完成後 ===');
  vm.runInContext('__opened = []; openCombinedServices = function () { __opened.push("combined"); };'
    + ' openUnavailable = function () { __opened.push("unavailable"); }; openWeights = function () { __opened.push("weights"); };'
    + ' openStaffingCheck = function () { __opened.push("staffing"); }; openPreseasonSend = function () { __opened.push("preseason"); };'
    + ' loadDashboard = async function () {};', ui);
  const quarters = [{ quarterId: '2028T2', label: '2028年4-6月' }, { quarterId: '2028T3', label: '2028年7-9月' }];
  ui.callServer = async (name) => (name === 'apiListQuarters' ? quarters : {});
  ui.callServerMutating = async () => ({});
  const opened = () => vm.runInContext('__opened', ui).slice();
  const notice = () => ui.document.getElementById('deepLinkNotice');

  await ui.loadQuarters('2028T3');
  check('★★★★★★ quarter=2028T3 存在 ⇒ 選定那一季', vm.runInContext('currentQuarterId', ui) === '2028T3', vm.runInContext('currentQuarterId', ui));
  let notes = ui.applyDeepLink_(ui.parseDeepLink_({ view: 'combined', quarter: '2028T3' }));
  check('★★★★★★ 載入完成後打開〔合堂主日〕，沒有提示', JSON.stringify(opened()) === '["combined"]' && notes.length === 0 && notice().hidden === true, JSON.stringify(opened()));

  vm.runInContext('__opened = [];', ui);
  // 瀏覽器的 <select> 預設是第一個選項；假 DOM 沒有這個行為，先設好
  ui.document.getElementById('quarter').value = '2028T2';
  await ui.loadQuarters('2099T9');
  check('★★★★★★ quarter 不存在 ⇒ 預設季度（第一個）', vm.runInContext('currentQuarterId', ui) === '2028T2');
  notes = ui.applyDeepLink_(ui.parseDeepLink_({ view: 'xyz', quarter: '2099T9' }));
  check('★★★★★★ 兩句提示：找不到季度 2099T9，已顯示預設季度；畫面「xyz」不認得',
    notes[0] === '找不到季度 2099T9，已顯示預設季度。' && notes[1] === '網址指定的畫面「xyz」不認得，沒有打開任何畫面。'
    && notice().hidden === false && /找不到季度 2099T9/.test(notice().textContent), JSON.stringify(notes));
  check('★★★★★★ view 不認得 ⇒ 不打開任何畫面', opened().length === 0, JSON.stringify(opened()));

  vm.runInContext('__opened = [];', ui);
  await ui.loadQuarters('');
  notes = ui.applyDeepLink_(ui.parseDeepLink_({}));
  check('★★★★★ 沒有參數 ⇒ 照舊，不打開、不提示', opened().length === 0 && notes.length === 0 && notice().hidden === true);

  console.log('\n=== NA3：和人手按按鈕的是同一個函式 ===');
  ['unavailable', 'weights', 'staffing', 'preseason'].forEach((v) => {
    vm.runInContext('__opened = [];', ui);
    ui.applyDeepLink_(ui.parseDeepLink_({ view: v }));
    check('★★★★★ view=' + v + ' ⇒ 打開對應畫面', JSON.stringify(opened()) === JSON.stringify([v]), JSON.stringify(opened()));
  });
  const script = read('src/ui/Script.html');
  const zone2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 常數表直接呼叫按鈕用的函式（不另寫一份）',
    /combined: \(\) => openCombinedServices\(\)/.test(script) && /unavailable: \(\) => openUnavailable\(\)/.test(script)
    && /weights: \(\) => openWeights\(\)/.test(script) && /staffing: \(\) => openStaffingCheck\(\)/.test(script)
    && /preseason: \(\) => openPreseasonSend\(\)/.test(script)
    && /button\('合堂主日', \(\) => openCombinedServices\(\)/.test(zone2) && /button\('寄出季前資料', \(\) => openPreseasonSend\(\)/.test(zone2));
  check('★★★★★ 〔寄出季前資料〕深連結只打開預覽（openPreseasonSend 只呼叫 apiPreseasonPreview，寄出要再按〔寄出〕）',
    /function openPreseasonSend\(\) \{\s*runAction\('讀取季前資料', async \(\) => \{\s*const p = await callServer\('apiPreseasonPreview'/.test(zone2));

  console.log('\n=== NA4：開機次序 ===');
  const boot = read('src/ui/ScriptBoot.html');
  check('★★★★★★ 先權限 → 讀網址 → loadQuarters(quarter) → 載入完成後才 applyDeepLink_',
    /await loadMyPermission_\(\);\s*deepLink_ = parseDeepLink_\(await readDeepLinkParams_\(\)\);\s*await loadQuarters\(deepLink_\.quarter\);[\s\S]*?\}\)\.then\(\(\) => applyDeepLink_\(deepLink_\)\);/.test(boot));
  const r2 = await ui.readDeepLinkParams_();
  check('★★★★ 讀不到 google.script.url（例如測試環境）⇒ 當沒有參數', JSON.stringify(r2) === '{}');
  ui.google.script.url = { getLocation: (cb) => cb({ parameter: { view: 'combined', quarter: '2027T1', p: 'x' } }) };
  const r3 = ui.parseDeepLink_(await ui.readDeepLinkParams_());
  check('★★★★★ google.script.url.getLocation 的 parameter', r3.view === 'combined' && r3.quarter === '2027T1');
  // 部署後核對發現：開機時由出席系統更新電郵（背景）完成後會重讀主畫面——不可以把深連結打開的畫面關掉
  vm.runInContext('__ld = []; loadDashboard = async function (o) { __ld.push(o || null); }; hwcasSyncedOnLoad_ = false;'
    + ' runAction = async function (l, fn) { await fn(); };', ui);
  ui.callServerMutating = async () => ({ ok: true, updated: 0 });
  ui.syncHwcasOnLoad();
  await tick();
  const ld = vm.runInContext('__ld', ui);
  check('★★★★★★ 出席系統更新完成後重讀主畫面 ⇒ 保留已開的視窗（keepModal）', ld.length === 1 && ld[0] && ld[0].keepModal === true, JSON.stringify(ld));

  console.log('\n=== NA5：和個人專屬連結互不干擾 ===');
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  let personal = 0;
  gas.renderPersonalRosterPage_ = function () { personal++; return 'PERSONAL'; };
  const out = gas.doGet({ parameter: { p: 'TOKEN', q: '2027T1', view: 'combined', quarter: '2027T1' } });
  check('★★★★★★ 有 p（同時有 view／quarter）⇒ 照舊走個人專屬連結，不碰幹事介面', out === 'PERSONAL' && personal === 1);
  const web = read('src/WebApp.gs');
  const doGetBody = web.slice(web.indexOf('function doGet('), web.indexOf('function renderWebAppDisabledPage_('));
  check('★★★★★ 幹事介面的 doGet 不讀 view／quarter（深連結只在前端，不影響存取檢查）', !/parameter\.(view|quarter)/.test(doGetBody));
  check('★★★★★ 個人專屬連結那一頁不讀 view／quarter', !/parameter\.(view|quarter)|'view'|'quarter'/.test(read('src/WebAppPersonalLink.gs')));

  console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
  process.exitCode = fail === 0 ? 0 : 1;
})();
