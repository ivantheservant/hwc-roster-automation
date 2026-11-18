// 第一百一十五輪批次 WB／WC 組：載入提速及「載入中」卡住的保護。
// 執行方式：node tests/round115_wb_wc_load.test.js
//
//   WB-0 伺服器量度：readSheet_ 記下每張表讀了多久（只在快取期間）；空表也記住，不再重讀；
//        頁底第三行「各段：…、其餘…；最慢的表：…」
//   WB-1 權限回覆順帶季度清單（可以修改／只可查看的人；確認者不給）；前端第一次載入只用一次，之後照舊另外讀
//   WC   唯讀呼叫有時限（Config WEBAPP_LOAD_TIMEOUT_SECONDS，預設 150 秒）；逾時／失敗 ⇒ 寫明哪一部分，有〔再試一次〕；
//        〔再試一次〕只重做唯讀的讀取；會寫入的呼叫有時限但不重試；所有 google.script.run 都有 withFailureHandler
// 用假名、假電郵（example.invalid）。

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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise((r) => setImmediate(r));
// 一個 Promise 永遠不完成（例如時限被拿走）⇒ node 會靜靜以 0 結束；沒有跑到最後一律當作失敗
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL  測試沒有跑完（有一個呼叫永遠沒有完成）'); process.exitCode = 1; } });
async function settle() { for (let i = 0; i < 12; i++) await tick(); }

/** 假試算表：每次 getSheetByName 時鐘向前走（毫秒），記下讀了幾次。 */
function fakeSpreadsheet(gas, sheets) {
  const clock = { now: 1000000 };
  const opened = [];
  vm.runInContext('Date', gas).now = () => clock.now;
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => {
        const s = sheets[name];
        if (!s) return null;
        opened.push(name);
        clock.now += s.cost;
        const rows = s.rows;
        return {
          getLastRow: () => rows.length,
          getLastColumn: () => (rows[1] ? rows[1].length : 0),
          getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map((x) => x.slice(c - 1, c - 1 + nc)) })
        };
      }
    })
  };
  return { clock: clock, opened: opened };
}

(async function () {
  console.log('\n=== WB-0：伺服器量度（readSheet_） ===');
  {
    const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs']);
    const fx = fakeSpreadsheet(gas, {
      Big: { cost: 700, rows: [['說明'], ['personId', 'name'], ['P9701', '假甲'], ['P9702', '假乙']] },
      Small: { cost: 200, rows: [['說明'], ['personId'], ['P9703']] },
      Empty: { cost: 300, rows: [['說明'], ['personId']] }
    });
    check('★★★★ 沒有開快取 ⇒ 沒有量度（空清單）', gas.listSlowestSheetReads_(6).length === 0);
    gas.beginSheetReadMemo_();
    gas.readSheet_('Small');
    const big = gas.readSheet_('Big');
    gas.readSheet_('Big');
    gas.readSheet_('Empty');
    const empty2 = gas.readSheet_('Empty');
    const slow = gas.listSlowestSheetReads_(6);
    check('★★★★★★ 最慢的表由慢到快：Big 700、Empty 300、Small 200（同一張表第二次用快取，不另計時間）',
      JSON.stringify(slow) === JSON.stringify([{ name: 'Big', ms: 700 }, { name: 'Empty', ms: 300 }, { name: 'Small', ms: 200 }]), JSON.stringify(slow));
    check('★★★★ 只取最慢的 n 張', gas.listSlowestSheetReads_(2).length === 2 && gas.listSlowestSheetReads_(2)[1].name === 'Empty');
    check('★★★★★★ 空表在快取期間也記住：第二次不再打開工作表', fx.opened.filter((n) => n === 'Empty').length === 1 && Array.isArray(empty2) && empty2.length === 0,
      JSON.stringify(fx.opened));
    check('★★★★★ 讀到的內容不變（量度不影響結果）', big.length === 2 && big[0].personId === 'P9701' && big[1].name === '假乙', JSON.stringify(big));
    gas.endSheetReadMemo_();
    check('★★★★★ 關快取 ⇒ 量度清走', gas.listSlowestSheetReads_(6).length === 0);
    gas.readSheet_('Empty');
    gas.readSheet_('Empty');
    check('★★★★★ 沒有開快取 ⇒ 空表照舊每次都讀（記住只限快取期間）', fx.opened.filter((n) => n === 'Empty').length === 3, JSON.stringify(fx.opened));
    gas.beginSheetReadMemo_();
    check('★★★★ 再開快取 ⇒ 由零開始量', gas.listSlowestSheetReads_(6).length === 0);
    gas.endSheetReadMemo_();
  }

  console.log('\n=== WB-0：狀態卡回傳及頁底第三行 ===');
  {
    const dash = read('src/WebAppDashboard.gs');
    // 第一百一十七輪批次 YB 組（刻意改動）：狀態卡分兩部分，兩部分的計時都要帶「最慢的表」
    check('★★★★★ 狀態卡的計時帶「最慢的表」（6 張；兩部分都有）', (dash.match(/slowestSheets: typeof listSlowestSheetReads_ === 'function' \? listSlowestSheetReads_\(6\) : \[\]/g) || []).length === 2);
    const ui = loadUiScripts(['Script.html']);
    const line = ui.buildServerDetailLine_({ phases: [{ label: '讀工作表', ms: 1200 }, { label: '人手檢查', ms: 400 }, { label: '合計', ms: 2000 }],
      slowestSheets: [{ name: 'AuditLog', ms: 3100 }, { name: 'Config', ms: 250 }] });
    check('★★★★★★ 頁底第三行：「各段：讀工作表 1.2、人手檢查 0.4、其餘 0.4；最慢的表：AuditLog 3.1、Config 0.3」',
      line === '各段：讀工作表 1.2、人手檢查 0.4、其餘 0.4；最慢的表：AuditLog 3.1、Config 0.3', line);
    const line2 = ui.buildServerDetailLine_({ phases: [{ label: '甲', ms: 900 }] });
    check('★★★★ 沒有合計、沒有最慢的表 ⇒ 只寫各段', line2 === '各段：甲 0.9', line2);
    check('★★★★ 頁底只在有伺服器計時才加第三行', /const detailLine = loadServerTimings_ \? buildServerDetailLine_\(loadServerTimings_\) : '';/.test(read('src/ui/Script.html')));
  }

  console.log('\n=== WB-2：上一季提示——同一個日期只格式化一次 ===');
  {
    const { FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
    const gas = loadGasSource(FILES_FOR_GENERATOR);
    const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
    const V = gas.COLUMNS.ROSTER_VERSIONS;
    let formatCalls = 0;
    gas.Utilities = { formatDate: (d, tz, f) => { formatCalls++; return d.toISOString().slice(0, 10); } };
    const rows = [];
    const days = ['2027-03-14', '2027-03-21', '2027-03-28'];
    // 每個主日 60 行（新的 Date 物件，時間相同）、兩個版本；另加文字日期的行及沒有登記的版本
    days.forEach((d, di) => {
      for (let i = 0; i < 60; i++) {
        const r = {};
        r[A.QUARTER_ID] = 'QX'; r[A.VERSION_NO] = i % 2; r[A.SERVICE_DATE] = new Date(d + 'T00:00:00Z');
        r[A.POST_ID] = 'POST' + (i % 6); r[A.PERSON_ID] = 'P9' + di + String(i).padStart(2, '0');
        rows.push(r);
      }
    });
    const s1 = {}; s1[A.QUARTER_ID] = 'QX'; s1[A.VERSION_NO] = 1; s1[A.SERVICE_DATE] = '2027-03-28'; s1[A.POST_ID] = 'TEXT'; s1[A.PERSON_ID] = 'P9900'; rows.push(s1);
    const s2 = {}; s2[A.QUARTER_ID] = 'QX'; s2[A.VERSION_NO] = 7; s2[A.SERVICE_DATE] = new Date('2027-03-28T00:00:00Z'); s2[A.POST_ID] = 'GHOST'; s2[A.PERSON_ID] = 'P9901'; rows.push(s2);
    const after = {}; after[A.QUARTER_ID] = 'QY'; after[A.VERSION_NO] = 0; after[A.SERVICE_DATE] = new Date('2027-04-04T00:00:00Z'); after[A.POST_ID] = 'X'; after[A.PERSON_ID] = 'P9902'; rows.push(after);
    const vrs = [0, 1].map((n) => { const v = {}; v[V.QUARTER_ID] = 'QX'; v[V.VERSION_NO] = n; return v; });
    gas.readSheet_ = (name) => (name === gas.SHEETS.ROSTER_ASSIGNMENTS ? rows : name === gas.SHEETS.ROSTER_VERSIONS ? vrs : []);
    const info = gas.readPriorWeeksInfo_('2027-04-01', 2, 'Pacific/Auckland', '2027-04-04');
    check('★★★★★★ 183 行、4 個不同的 Date 值 ⇒ Utilities.formatDate 只叫 4 次（之前每行最多 3 次）', formatCalls === 4, formatCalls);
    const last = info.weeks[1] || {};
    check('★★★★★★ 結果不變：用最後兩個主日、每個主日只取最大版本；文字日期的行照樣認得；沒有登記的版本不用',
      info.dates.join() === '2027-03-21,2027-03-28' && !info.short && Object.keys(last).sort().join() === 'POST1,POST3,POST5,TEXT'
        && last.POST1.length === 10 && !last.GHOST, JSON.stringify(info.dates) + ' ' + JSON.stringify(Object.keys(last)));
  }

  console.log('\n=== WB-1：權限回覆順帶季度清單（伺服器） ===');
  {
    function permSandbox(email, listImpl) {
      const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
      const audits = [];
      const logs = [];
      gas.Session = { getActiveUser: () => ({ getEmail: () => email }) };
      gas.getConfig_ = function (key, d) {
        if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
        if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['editor@example.invalid'];
        if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid'];
        if (key === gas.CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS) return ['confirm@example.invalid'];
        return d;
      };
      gas.writeAuditLog_ = (e) => audits.push(e);
      gas.log_ = (lv, m) => logs.push(lv + ' ' + m);
      const fx = fakeSpreadsheet(gas, { Quarters: { cost: 50, rows: [['說明'], ['quarterId'], ['2099T1']] } });
      let listCalls = 0;
      gas.listQuartersForSelect_ = function () {
        listCalls++;
        return listImpl ? listImpl(gas) : (gas.readSheet_('Quarters'), gas.readSheet_('Quarters'), [{ quarterId: '2099T1', label: '2099年1-3月', isDefault: true }]);
      };
      return { gas: gas, audits: audits, logs: logs, fx: fx, calls: () => listCalls };
    }
    const e = permSandbox('editor@example.invalid');
    const r = e.gas.apiGetMyPermission();
    check('★★★★★★ 可以修改的人：權限回覆帶季度清單（和 apiListQuarters 同一支 listQuartersForSelect_）',
      r.role === 'EDITOR' && r.canModify === true && Array.isArray(r.quarters) && r.quarters[0].quarterId === '2099T1' && r.quarters[0].isDefault === true, JSON.stringify(r));
    check('★★★★★ 讀季度清單時開了 readSheet_ 快取（同一張表只打開一次），完了關掉',
      e.fx.opened.length === 1 && e.gas.listSlowestSheetReads_(6).length === 0, JSON.stringify(e.fx.opened));
    const v = permSandbox('viewer@example.invalid');
    const rv = v.gas.apiGetMyPermission();
    check('★★★★★★ 只可查看的人：一樣帶季度清單', rv.role === 'VIEWER' && Array.isArray(rv.quarters) && rv.quarters.length === 1, JSON.stringify(rv));
    const c = permSandbox('confirm@example.invalid');
    const rc = c.gas.apiGetMyPermission();
    check('★★★★★★ 只是確認者：不帶季度清單，而且根本沒有讀（不會多寫拒絕紀錄）',
      JSON.stringify(rc) === '{"role":"CONFIRMER","canModify":false,"canConfirm":true}' && c.calls() === 0 && c.audits.length === 0, JSON.stringify(rc) + ' ' + c.calls());
    const bad = permSandbox('editor@example.invalid', () => { throw new Error('Quarters 讀不到'); });
    let threw = '';
    let rb = null;
    try { rb = bad.gas.apiGetMyPermission(); } catch (err) { threw = err.message; }
    check('★★★★★★ 季度清單讀不到 ⇒ 權限照樣回覆（沒有 quarters，前端照舊另外讀），寫 WARN log，快取已關',
      !threw && rb && rb.role === 'EDITOR' && rb.quarters === undefined && bad.logs.some((l) => /^WARN /.test(l) && /季度清單讀不到/.test(l))
        && bad.gas.listSlowestSheetReads_(6).length === 0, threw || JSON.stringify(rb) + JSON.stringify(bad.logs));
  }

  console.log('\n=== WB-1：前端只用一次 ===');
  {
    const ui = loadUiScripts(['Script.html']);
    const served = [];
    let permReply = { role: 'EDITOR', canModify: true, canConfirm: true, quarters: [{ quarterId: '2099T2', label: '2099年4-6月', isDefault: true }] };
    ui.callServerRaw_ = function (fn) {
      served.push(fn);
      if (fn === 'apiGetMyPermission') return Promise.resolve(permReply);
      if (fn === 'apiListQuarters') return Promise.resolve([{ quarterId: '2099T3', label: '2099年7-9月', isDefault: true }]);
      return Promise.resolve(null);
    };
    let dashLoads = 0;
    ui.loadDashboard = async function () { dashLoads++; };
    await ui.loadMyPermission_();
    await ui.fillQuarterSelect_(null);
    check('★★★★★★ 第一次載入：用權限回覆的季度清單，不再呼叫 apiListQuarters',
      served.join(',') === 'apiGetMyPermission' && vm.runInContext('currentQuarterId', ui) === '2099T2' && dashLoads === 1, served.join(',') + ' ' + vm.runInContext('currentQuarterId', ui));
    await ui.fillQuarterSelect_(null);
    check('★★★★★★ 之後再填（例如建立了新季度）⇒ 照舊呼叫 apiListQuarters（預先讀的只用一次）',
      served.join(',') === 'apiGetMyPermission,apiListQuarters' && vm.runInContext('currentQuarterId', ui) === '2099T3', served.join(','));
    permReply = { role: 'EDITOR', canModify: true, canConfirm: true };
    served.length = 0;
    await ui.loadMyPermission_();
    await ui.fillQuarterSelect_(null);
    check('★★★★★ 權限回覆沒有季度清單（伺服器讀不到）⇒ 照舊呼叫 apiListQuarters', served.join(',') === 'apiGetMyPermission,apiListQuarters', served.join(','));
  }

  console.log('\n=== WC：唯讀呼叫的時限 ===');
  function timerUi(files) {
    const ui = loadUiScripts(files || ['Script.html']);
    const timers = [];
    const cleared = [];
    ui.setTimeout = function (cb, ms) { timers.push({ cb: cb, ms: ms }); return timers.length; };
    ui.clearTimeout = function (id) { cleared.push(id); };
    ui.setInterval = function () { return 0; };   // runAction 的計時牌
    ui.clearInterval = function () {};
    return { ui: ui, timers: timers, cleared: cleared, fire: (ms) => timers.filter((t) => t.ms === ms).forEach((t) => t.cb()) };
  }
  {
    const t = timerUi();
    let rawCalls = 0;
    t.ui.callServerRaw_ = function () { rawCalls++; return new Promise(() => {}); };   // 伺服器一直沒有回覆
    let err = null;
    const p = t.ui.callServer('apiGetDashboardState', '2099T1').catch((e) => { err = e; });
    await settle();
    check('★★★★★ 唯讀呼叫：設了 150 秒的計時器（預設）', t.timers.some((x) => x.ms === 150000) && err === null, JSON.stringify(t.timers.map((x) => x.ms)));
    t.fire(150000);
    await p;
    // 第一百一十六輪批次 XB 組（刻意改動）：訊息不再寫任何按鈕名稱
    check('★★★★★★ 超過時限 ⇒ 以「這一部分載入太久（伺服器超過 150 秒還沒有回覆）。」結束，不會永遠停住',
      err && err.loadTimeout === true && /^這一部分載入太久（伺服器超過 150 秒還沒有回覆）。$/.test(err.message) && err.fnName === 'apiGetDashboardState' && err.timeoutSeconds === 150,
      err && err.message);
    check('★★★★ 逾時不算 Google 暫時性錯誤：沒有自動再送一次', rawCalls === 1, rawCalls);

    const t2 = timerUi();
    t2.ui.callServerRaw_ = () => Promise.resolve({ ok: 1 });
    const ok = await t2.ui.callServer('apiGetDashboardState', '2099T1');
    check('★★★★★ 準時回覆 ⇒ 照常拿到結果，計時器清走', ok && ok.ok === 1 && t2.cleared.length === 1, JSON.stringify(t2.cleared));

    const t3 = timerUi();
    t3.ui.callServerRaw_ = () => new Promise(() => {});
    vm.runInContext('loadTimeoutMs_ = 90000;', t3.ui);
    t3.ui.callServer('apiGetDashboardState', '2099T1').catch(() => {});
    await settle();
    check('★★★★★ 時限跟 Config（狀態卡回覆之後）：90 秒', t3.timers.some((x) => x.ms === 90000), JSON.stringify(t3.timers.map((x) => x.ms)));
    check('★★★★★ 狀態卡回覆之後把時限換成 Config 的秒數', /if \(dashboardState_ && Number\(dashboardState_\.loadTimeoutSeconds\) > 0\) loadTimeoutMs_ = Number\(dashboardState_\.loadTimeoutSeconds\) \* 1000;/.test(read('src/ui/Script.html')));

    const t4 = timerUi();
    let mutCalls = 0;
    t4.ui.callServerRaw_ = () => { mutCalls++; return new Promise(() => {}); };
    t4.ui.callServerMutating('apiDoSomething').catch(() => {});
    await settle();
    check('★★★★★★ 會寫入的呼叫（callServerMutating）本身不加時限、不重試', t4.timers.length === 0 && mutCalls === 1, JSON.stringify(t4.timers.map((x) => x.ms)));
  }

  console.log('\n=== WC：頁頂寫明哪一部分，〔再試一次〕 ===');
  {
    const t = timerUi();
    const ui = t.ui;
    const box = ui.document.getElementById('loadFailureNotice');
    box.hidden = true;
    let retries = 0;
    let failNext = true;
    const retry = () => { retries++; if (failNext) { failNext = false; return Promise.reject(new Error('Quarters 讀不到')); } return Promise.resolve(); };
    const tmo = new Error('這一部分載入太久（伺服器超過 150 秒還沒有回覆）。');
    tmo.loadTimeout = true;
    ui.showLoadFailureNotice_('狀態卡', tmo, retry);
    const text = box.textContent;
    // 第一百一十六輪批次 XB 組（刻意改動）：通知自己寫「請按〔再試一次〕」（按鈕在同一個容器）
    check('★★★★★★ 頁頂寫「「狀態卡」載入太久（伺服器超過 150 秒還沒有回覆）。依賴這一部分的按鈕暫時不可以用。請按〔再試一次〕。」',
      !box.hidden && text.indexOf('「狀態卡」載入太久（伺服器超過 150 秒還沒有回覆）。依賴這一部分的按鈕暫時不可以用。請按〔再試一次〕。') === 0, text);
    const btn = () => box.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '再試一次')[0];
    check('★★★★★★ 有〔再試一次〕按鈕', !!btn());
    btn().fire('click');
    await settle();
    check('★★★★★★ 按〔再試一次〕⇒ 重做那一部分；再失敗 ⇒ 頁頂重新顯示「載入失敗」及按鈕', retries === 1 && !box.hidden
      && box.textContent.indexOf('「狀態卡」載入失敗。依賴這一部分的按鈕暫時不可以用。請按〔再試一次〕。') === 0
      && /Quarters 讀不到/.test(box.textContent) && !!btn(), box.textContent);
    btn().fire('click');
    await settle();
    check('★★★★★ 再按一次成功 ⇒ 頁頂收起', retries === 2 && box.hidden === true);
    check('★★★★★ 只可查看的人也可以按〔再試一次〕（只重做讀取）', /const VIEW_ONLY_ALLOWED_LABELS = \[[^\]]*'再試一次'\];/.test(read('src/ui/Script.html')));
    check('★★★★ 狀態卡成功載入 ⇒ 收起頁頂的失敗通知', /const failBox = el\('loadFailureNotice'\);\n\s+if \(failBox\) failBox\.hidden = true;/.test(read('src/ui/Script.html'))
      && /<div class="warnbox" id="loadFailureNotice" hidden><\/div>/.test(read('src/ui/Index.html')));
  }

  console.log('\n=== WC：啟動流程——重試只做唯讀的讀取 ===');
  {
    const boot = read('src/ui/ScriptBoot.html');
    const m = boot.match(/try \{\n\s+await loadQuarters\(deepLink_\.quarter\);\n\s+\} catch \(err\) \{([\s\S]*?)\n\s+throw err;\n\s+\}/);
    // 第一百一十六輪批次 XA 組（刻意改動）：狀態卡失敗改由 loadDashboard() 自己寫通知；這裏只剩季度清單
    check('★★★★★★ 季度清單失敗 ⇒ 頁頂寫明（showLoadFailureNotice_），錯誤照樣交給「載入中」收尾（不會停住）；狀態卡失敗交給 loadDashboard()',
      m && /if \(!currentQuarterId\) \{\s*showLoadFailureNotice_\('季度清單', err,/.test(m[1]) && /err\.shownInNotice = true/.test(m[1]));
    check('★★★★★★ 〔再試一次〕只重讀季度清單（fillQuarterSelect_）——不經 loadQuarters（那裏會建立未來季度＝寫入）',
      m && /\(\) => fillQuarterSelect_\(deepLink_\.quarter \|\| null\)/.test(m[1]) && !/loadQuarters\(|callServerMutating|syncHwcas/.test(m[1].replace(/\/\/.*$/gm, '')), m && m[1]);
  }

  console.log('\n=== WC：主流程那一格 ===');
  {
    const ui = loadUiScripts(['Script.html', 'ScriptMainFlow.html']);
    ui.setInterval = function () { return 0; };
    ui.clearInterval = function () {};
    let resets = 0;
    let renders = 0;
    let failRender = true;
    ui.resetMainFlowState = function () { resets++; };
    ui.renderMainFlow = async function () { renders++; if (failRender) { failRender = false; throw new Error('主流程資料讀不到'); } ui.clear(ui.document.getElementById('mainFlowBody')).appendChild(ui.document.createElement('div')); };
    const tmo = new Error('這一部分載入太久（超過 150 秒伺服器還沒有回覆）。已載入的部分照樣可以用；請按〔再試一次〕。');
    ui.renderMainFlowFailure_(tmo);
    const body = ui.document.getElementById('mainFlowBody');
    const btn = () => body.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '再試一次')[0];
    check('★★★★★★ 主流程載入太久 ⇒ 那一格寫「主流程畫不出來：這一部分載入太久…　落面的功能仍然用得到。」並有〔再試一次〕',
      body.textContent.indexOf('主流程畫不出來：這一部分載入太久') === 0 && /落面的功能仍然用得到。/.test(body.textContent) && !!btn(), body.textContent);
    btn().fire('click');
    await settle();
    check('★★★★★★ 按〔再試一次〕⇒ 清走主流程資料再畫（只讀 apiGetMainFlowState）；再失敗 ⇒ 照舊寫一句及按鈕',
      resets === 1 && renders === 1 && /主流程畫不出來：主流程資料讀不到/.test(body.textContent) && !!btn(), body.textContent);
    btn().fire('click');
    await settle();
    check('★★★★★ 第二次成功 ⇒ 不再有失敗句子', resets === 2 && renders === 2 && body.textContent.indexOf('主流程畫不出來') === -1, body.textContent);
    check('★★★★★ loadDashboard 主流程失敗走 renderMainFlowFailure_', /await renderMainFlow\(dashboardState_\);\n\s+\} catch \(err\) \{\n\s+renderMainFlowFailure_\(err\);/.test(read('src/ui/Script.html')));
  }

  console.log('\n=== WC：載入時會寫入的兩個背景呼叫——有時限、不重試 ===');
  {
    const t = timerUi(['Script.html', 'ScriptZone3.html']);
    let raw = [];
    t.ui.callServerRaw_ = (fn) => { raw.push(fn); return new Promise(() => {}); };
    t.ui.syncHwcasOnLoad();
    await settle();
    const syncing = t.ui.document.getElementById('hwcasSyncing');
    check('★★★★ 同步出席系統：進行中顯示「正在同步」', syncing.hidden === false);
    t.fire(150000);
    await settle();
    check('★★★★★★ 同步出席系統太久 ⇒ 收起「正在同步」，頁頂寫明沒有再等、不會自動再試；只送出過一次',
      syncing.hidden === true && t.ui.document.getElementById('status').textContent.indexOf('由出席系統更新電郵載入太久，畫面沒有再等（這個動作會寫入，所以不會自動再試') === 0
        && raw.join(',') === 'apiSyncPeopleFromHwcas', t.ui.document.getElementById('status').textContent + ' ' + raw.join(','));
    raw = [];
    t.timers.length = 0;
    t.ui.ensureFutureQuartersInBackground_();
    await settle();
    t.fire(150000);
    await settle();
    check('★★★★★★ 建立未來季度太久 ⇒ 不阻住載入、不重試（只送出過一次）', raw.join(',') === 'apiEnsureFutureQuarters' && t.timers.length === 1, raw.join(','));
  }

  console.log('\n=== WC：Config WEBAPP_LOAD_TIMEOUT_SECONDS ===');
  {
    const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppDashboard.gs']);
    check('★★★★★★ 預設 150 秒', gas.DEFAULTS.WEBAPP_LOAD_TIMEOUT_SECONDS === 150 && gas.CONFIG_KEYS.WEBAPP_LOAD_TIMEOUT_SECONDS === 'WEBAPP_LOAD_TIMEOUT_SECONDS');
    const cases = [[undefined, 150], [90, 90], ['120', 120], [20, 20], [600, 600], [19, 150], [601, 150], ['abc', 150], ['', 150], [45.7, 45]];
    const got = cases.map((c) => { gas.getConfig_ = (k, d) => (k === 'WEBAPP_LOAD_TIMEOUT_SECONDS' ? (c[0] === undefined ? d : c[0]) : d); return gas.readWebAppLoadTimeoutSeconds_(); });
    check('★★★★★ 讀 Config：20–600 秒照用（小數取整數）；其他（空、文字、太短、太長）⇒ 150', got.every((g, i) => g === cases[i][1]), JSON.stringify(got));
    check('★★★★★ 狀態卡回傳 loadTimeoutSeconds', /loadTimeoutSeconds: readWebAppLoadTimeoutSeconds_\(\),/.test(read('src/WebAppDashboard.gs')));
    check('★★★★★ 〔補建設定及範本〕會補上（ConfigSeed 有這一行）', /WEBAPP_LOAD_TIMEOUT_SECONDS/.test(read('src/ConfigSeed.gs')));
    check('★★★★ 上線值清單（ConfigBaselineCheck、docs/config_baseline_上線值.json）有 150',
      /WEBAPP_LOAD_TIMEOUT_SECONDS: \{ launchTargetValue: '150'/.test(read('src/ConfigBaselineCheck.gs')) && /"WEBAPP_LOAD_TIMEOUT_SECONDS"/.test(read('docs/config_baseline_上線值.json')));
  }

  console.log('\n=== WC：所有 google.script.run 都有 withFailureHandler ===');
  {
    /** 找出每一個 google.script.run 呼叫鏈（到真正呼叫的 api 為止），沒有 withFailureHandler 的列出來。 */
    function scanRunChains(text) {
      const out = [];
      const re = /google\.script\.run(?=[\s'"+]*\.(?:with|api)|\s*$|\s*\n\s*\.)/gm;
      let m;
      while ((m = re.exec(text)) !== null) {
        const rest = text.slice(m.index);
        // 呼叫鏈到真正呼叫伺服器函式為止：.apiXxx(、.personalXxx(（個人連結頁先存成 runner 再呼叫）、[fnName](...args)
        const end = rest.search(/\.(?:api|personal)\w+\s*\(|\]\s*\(\.\.\./);
        const chain = end === -1 ? rest.slice(0, 300) : rest.slice(0, end);
        out.push({ at: text.slice(0, m.index).split('\n').length, ok: /\.withFailureHandler\s*\(/.test(chain) && end !== -1 });
      }
      return out;
    }
    const self = scanRunChains("google.script.run\n  .withSuccessHandler(ok)\n  .apiListQuarters();");
    check('★★★★ 掃描器自我測試：沒有 withFailureHandler 的會被找出來', self.length === 1 && self[0].ok === false);
    const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f)).map((f) => 'src/' + f)
      .concat(fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => /\.html$/.test(f)).map((f) => 'src/ui/' + f));
    const all = [];
    files.forEach((f) => scanRunChains(read(f)).forEach((c) => all.push(Object.assign({ file: f }, c))));
    const bad = all.filter((c) => !c.ok).map((c) => c.file + ':' + c.at);
    check('★★★★★★ 所有 google.script.run 呼叫都有 withFailureHandler（' + all.length + ' 處）', all.length >= 5 && bad.length === 0, bad.join('、') + ' 共 ' + all.length);
    const front = ['Script.html', 'ScriptBoot.html', 'ScriptMainFlow.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html', 'ScriptZone5.html']
      .filter((f) => fs.existsSync(path.join(ROOT, 'src/ui', f)));
    const frontHits = all.filter((c) => front.indexOf(path.basename(c.file)) !== -1);
    check('★★★★★ 幹事介面只有 callServerRaw_ 一處直接用 google.script.run（其餘都經 callServer／callServerMutating）',
      frontHits.length === 1 && frontHits[0].file === 'src/ui/Script.html', JSON.stringify(frontHits));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  finished = true;
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  測試本身出錯：' + (e && e.stack)); finished = true; process.exit(1); });
