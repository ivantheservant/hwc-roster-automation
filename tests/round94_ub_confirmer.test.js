// 第九十四輪批次 UB 組：確認者名單及「義工申報，確認」畫面。
// 執行方式：node tests/round94_ub_confirmer.test.js
//
//   UB1 權限：只在 UNAVAILABLE_CONFIRMER_EMAILS 的人 ⇒ CONFIRMER，只准呼叫確認畫面的讀取及決定（及自己的權限），
//       其他一律拒絕並寫 AuditLog；只可查看的人看得到（讀取在唯讀清單）但不可以決定，除非同時是確認者；可以修改的人全部可以
//   UB2 doGet：確認者照樣打開介面；apiGetMyPermission 帶 canConfirm
//   UB3 確認畫面資料：待確認按人分組（主日、崗位、原因、提交時間、截止日之後）；已處理最近 50 項（結果、確認者、時間；系統自動的照寫）
//   UB4 前端：只是確認者 ⇒ 只顯示確認畫面（其他區收起、不載入季度）；只可查看 ⇒ 按鈕灰色；深連結 unavailable-confirm
//   UB5 Config 種子、說明、基線；決定寫 DecidedBy（登入電郵）及 AuditLog
// 用假資料（example.invalid、P97xx、假名）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { buildUnavailableScene, tok, T1 } = require('./helpers/unavailable_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

function sandbox(email) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  const audits = [];
  gas.Session = { getActiveUser: () => ({ getEmail: () => email }) };
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['editor@example.invalid'];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid', 'viewer.confirm@example.invalid'];
    if (key === gas.CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS) return ['confirm@example.invalid', 'viewer.confirm@example.invalid'];
    return d;
  };
  gas.writeAuditLog_ = (e) => audits.push(e);
  gas.log_ = () => {};
  return { gas: gas, audits: audits };
}

console.log('\n=== UB1：權限 ===');
{
  const c = sandbox('confirm@example.invalid');
  check('★★★★★★ 只在確認者名單 ⇒ 角色 CONFIRMER', c.gas.resolveWebAppRole_('confirm@example.invalid').role === 'CONFIRMER');
  check('★★★★★★ 確認者：讀取確認畫面、決定 ⇒ 可以', c.gas.assertWebAppRequestAllowed_('apiGetUnavailableConfirmView') === 'CONFIRMER'
    && c.gas.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions') === 'CONFIRMER');
  check('★★★★★ 確認者：自己的權限 ⇒ 可以', c.gas.assertWebAppRequestAllowed_('apiGetMyPermission') === 'CONFIRMER');
  const msgs = ['apiListQuarters', 'apiGetDashboardState', 'apiListUnavailable', ''].map((n) => throwsMsg(() => c.gas.assertWebAppRequestAllowed_(n || undefined)));
  check('★★★★★★ 確認者：其他（唯讀、改動、沒有名字）一律拒絕「你只可以確認義工申報（不能服侍），不可以做其他事。」',
    msgs.every((m) => m === '你只可以確認義工申報（不能服侍），不可以做其他事。'), JSON.stringify(msgs));
  check('★★★★★ 拒絕時寫 AuditLog（WEBAPP_CONFIRMER_DENIED）', c.audits.length === 4 && c.audits.every((a) => a.action === 'WEBAPP_CONFIRMER_DENIED'), JSON.stringify(c.audits));
  const v = sandbox('viewer@example.invalid');
  check('★★★★★★ 只可查看：看得到確認畫面（讀取在唯讀清單）', v.gas.assertWebAppRequestAllowed_('apiGetUnavailableConfirmView') === 'VIEWER');
  check('★★★★★★ 只可查看：不可以決定（你只有查看權限）', /你只有查看權限/.test(throwsMsg(() => v.gas.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions'))));
  const vc = sandbox('viewer.confirm@example.invalid');
  check('★★★★★ 只可查看＋確認者 ⇒ 角色 VIEWER，但可以決定', vc.gas.resolveWebAppRole_('viewer.confirm@example.invalid').role === 'VIEWER'
    && vc.gas.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions') === 'VIEWER');
  check('★★★★ 只可查看＋確認者：其他改動照樣不可以', /你只有查看權限/.test(throwsMsg(() => vc.gas.assertWebAppRequestAllowed_())));
  const e = sandbox('editor@example.invalid');
  check('★★★★★ 可以修改的人：全部可以（確認者＝確認名單＋可以修改的人）', e.gas.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions') === 'EDITOR'
    && e.gas.isUnavailableConfirmerCaller_() === true);
  const x = sandbox('stranger@example.invalid');
  check('★★★★★ 不在任何名單 ⇒ 拒絕', /不在 Web UI 允許名單內/.test(throwsMsg(() => x.gas.assertWebAppRequestAllowed_('apiGetUnavailableConfirmView'))));
  const webApp = read('src/WebApp.gs');
  check('★★★★★ 清單：UNAVAILABLE_CONFIRMER_APIS 只有讀取及決定兩個；讀取在唯讀清單、決定不在',
    /const UNAVAILABLE_CONFIRMER_APIS = \['apiGetUnavailableConfirmView', 'apiDecideUnavailableSubmissions'\];/.test(webApp)
    && /'apiGetUnavailableConfirmView'\n\];/.test(webApp) && !/WEBAPP_READ_ONLY_APIS = \[[\s\S]*?'apiDecideUnavailableSubmissions'[\s\S]*?\];/.test(webApp));
  const pu = read('src/PersonalUnavailable.gs');
  check('★★★★★ 兩支 api 第一句都是 assertWebAppRequestAllowed_(\'自己的名字\')',
    /function apiDecideUnavailableSubmissions\(submissionIds, decision\) \{\s*assertWebAppRequestAllowed_\('apiDecideUnavailableSubmissions'\);/.test(pu)
    && /function apiGetUnavailableConfirmView\(quarterId\) \{\s*const role = assertWebAppRequestAllowed_\('apiGetUnavailableConfirmView'\);/.test(pu));
}

console.log('\n=== UB2：doGet、apiGetMyPermission ===');
{
  const c = sandbox('confirm@example.invalid');
  c.gas.HtmlService = { createTemplateFromFile: () => ({ evaluate: () => { const o = { setTitle: () => o, addMetaTag: () => o, kind: 'INDEX' }; return o; } }),
    createHtmlOutput: (h) => { const o = { html: h, setTitle: () => o }; return o; } };
  check('★★★★★★ 確認者：doGet 照樣打開介面', c.gas.doGet({ parameter: {} }).kind === 'INDEX');
  check('★★★★★★ apiGetMyPermission：{"role":"CONFIRMER","canModify":false,"canConfirm":true}',
    JSON.stringify(c.gas.apiGetMyPermission()) === '{"role":"CONFIRMER","canModify":false,"canConfirm":true}', JSON.stringify(c.gas.apiGetMyPermission()));
  const vc = sandbox('viewer.confirm@example.invalid');
  check('★★★★ 只可查看＋確認者：canConfirm true', vc.gas.apiGetMyPermission().canConfirm === true && vc.gas.apiGetMyPermission().role === 'VIEWER');
}

console.log('\n=== UB3：確認畫面資料 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0], T1[1]], '出外', ['READ']);
  g.personalSubmitUnavailable(tok(3), '', [T1[2]], '', []);
  g.personalSubmitUnavailable(tok(4), '', [T1[3]], '', []);
  const s4 = sc.subs().filter((s) => s.personId === 'P9704').map((s) => s.submissionId);
  g.decideUnavailableSubmissions_(s4, 'REJECT', 'deacon@example.invalid');
  g.autoConfirmPendingSubmissionsForQuarter_ && g.decideUnavailableSubmissions_(sc.subs().filter((s) => s.personId === 'P9703').map((s) => s.submissionId), 'ACCEPT', g.UNAVAILABLE_AUTO_CONFIRM_BY.GENERATE);
  const view = g.buildUnavailableConfirmView_(g.readUnavailableSubmissions_(sc.TZ), g.buildPersonNameIndex_(), g.readPostNameIndexForUnavailable_(), true, '2099T1');
  check('★★★★★★ 待確認按人分組：一個人兩項（主日、崗位「讀經」、原因、提交時間）', view.pendingCount === 2 && view.pending.length === 1
    && view.pending[0].items.length === 2 && view.pending[0].items.every((it) => it.postsText === '讀經' && it.reason === '出外' && it.submittedAt), JSON.stringify(view.pending));
  check('★★★★ 帶姓名（不是編號）', view.pending[0].personName && view.pending[0].personName !== 'P9701');
  const hist = view.history;
  check('★★★★★★ 已處理：結果、確認者（登入電郵）、時間', hist.some((h) => h.resultText === '不確認' && h.decidedBy === 'deacon@example.invalid' && h.decidedAt), JSON.stringify(hist));
  check('★★★★★★ 已處理：系統自動的寫「系統自動（生成初稿）」', hist.some((h) => h.resultText === '已確認' && h.decidedBy === '系統自動（生成初稿）'), JSON.stringify(hist));
  check('★★★★ 季度標題', view.quarterLabel === '2099年1-3月' && view.canDecide === true);
  // 已處理只列最近 50 項
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ personId: 'P9701', serviceDate: '2099-01-04', postIds: [], reason: '', status: 'ACCEPTED', decidedBy: 'a@example.invalid', decidedAt: '2098-12-' + String(10 + (i % 18)).padStart(2, '0') + ' 09:' + String(i).padStart(2, '0') + ':00' });
  const v50 = g.buildUnavailableConfirmView_(many, {}, {}, false, '');
  check('★★★★★ 已處理最多 50 項，最新的排最先', v50.history.length === 50 && v50.history[0].decidedAt >= v50.history[49].decidedAt);
  // UB5：決定寫 DecidedBy 及 AuditLog
  const rows = g.readSheet_(sc.S.UNAVAILABLE_SUBMISSIONS);
  check('★★★★★ DecidedBy 寫登入電郵', rows.some((r) => r.DecidedBy === 'deacon@example.invalid'));
  check('★★★★ AuditLog 寫決定（PERSONAL_UNAVAILABLE_REJECTED，決定者）', sc.audits('PERSONAL_UNAVAILABLE_REJECTED').some((a) => /決定者：deacon@example\.invalid/.test(a.Notes)));
  const msg = g.decideUnavailableSubmissions_(sc.subs().filter((s) => s.status === 'PENDING').map((s) => s.submissionId), 'ACCEPT', 'clerk@example.invalid').message;
  check('★★★★★ 訊息用「已確認」（不用「接受」）', /^已確認 2 項/.test(msg) && !/接受/.test(msg), msg);
}

console.log('\n=== UB4：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const data = { pendingCount: 1, canDecide: true, quarterLabel: '2099年1-3月', history: [{ personName: '假乙', serviceDate: '2099-01-04', postsText: '全部崗位', resultText: '已確認', decidedBy: '系統自動（生成初稿）', decidedAt: '2098-12-10 09:00:00' }],
    pending: [{ personId: 'P9701', personName: '假甲', items: [{ submissionId: 'S1', serviceDate: '2099-01-11', postsText: '讀經', reason: '出外', submittedAt: '2098-12-10 09:00:00', late: true }] }] };
  const calls = [];
  ui.callServer = async (name) => { calls.push(name); return data; };
  vm.runInContext('myRole_ = "CONFIRMER"; myCanConfirm_ = true;', ui);
  ui.renderConfirmerOnly_().then(() => {
    const hidden = ['statusCard', 'zone1', 'zone2', 'zone3', 'zone4', 'mainFlow', 'quarter', 'btnRefresh'].every((id) => ui.document.getElementById(id).hidden === true);
    check('★★★★★★ 只是確認者：其他區全部收起（狀態卡、主流程、各區、季度選單）', hidden);
    check('★★★★★★ 只是確認者：只叫確認畫面的讀取（不載入其他資料）', calls.join() === 'apiGetUnavailableConfirmView', calls.join());
    const box = ui.document.getElementById('confirmOnly');
    const body = ui.document.getElementById('confirmOnlyBody');
    const btns = body.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    check('★★★★★★ 確認畫面：〔全部確認〕〔確認申請〕〔不確認〕', box.hidden === false && btns.indexOf('全部確認') !== -1 && btns.indexOf('確認申請') !== -1 && btns.indexOf('不確認') !== -1, btns.join('、'));
    check('★★★★★ 內容：姓名、主日、崗位、原因、提交時間、截止日之後；已處理寫確認者', /假甲/.test(body.textContent) && /讀經/.test(body.textContent) && /原因：出外/.test(body.textContent)
      && /提交：2098-12-10/.test(body.textContent) && /截止日之後/.test(body.textContent) && /確認者：系統自動（生成初稿）/.test(body.textContent), body.textContent.slice(0, 400));
    check('★★★★ 畫面不用「接受」「拒絕」「批准」', !/接受|拒絕|批准/.test(body.textContent));
    // 只可查看：canDecide false ⇒ 灰色
    const nodes = ui.buildUnavailableConfirmNodes(Object.assign({}, data, { canDecide: false }), async () => {});
    const holder = ui.document.createElement('div');
    nodes.forEach((n) => holder.appendChild(n));
    const gb = holder.flatten().filter((n) => n.tagName === 'BUTTON' && /確認/.test(n.textContent));
    check('★★★★★★ 只可查看（不是確認者）：〔確認申請〕〔不確認〕〔全部確認〕全部灰色', gb.length === 3 && gb.every((b) => b.disabled === true), gb.map((b) => b.textContent + ':' + b.disabled).join(','));
    check('★★★★★ 深連結 unavailable-confirm ⇒ 打開確認畫面', vm.runInContext("typeof DEEP_LINK_VIEWS['unavailable-confirm']", ui) === 'function'
      && vm.runInContext("parseDeepLink_({ view: 'unavailable-confirm', quarter: '2099T1' }).viewKnown", ui) === true);
    const boot = read('src/ui/ScriptBoot.html');
    check('★★★★★ 開機：只是確認者 ⇒ renderConfirmerOnly_，不 loadQuarters、不同步出席系統', /if \(myRole_ === 'CONFIRMER'\) \{ await renderConfirmerOnly_\(\); return; \}\s*await loadQuarters/.test(boot));
    check('★★★★★ 只可查看＋確認者：決定那一支照樣可以送出', vm.runInContext("UNAVAILABLE_CONFIRMER_CALLS.join()", ui) === 'apiDecideUnavailableSubmissions'
      && /if \(viewOnly_ && !\(myCanConfirm_ && UNAVAILABLE_CONFIRMER_CALLS\.indexOf\(fnName\) !== -1\)\)/.test(read('src/ui/Script.html')));
    check('★★★★ 〔不能服侍的日期〕最上面用同一個元件', /unavailableConfirmInlineNodes_\(keyword\)/.test(read('src/ui/ScriptZone3.html')));
    finishConfig();
  });
}

function finishConfig() {
  console.log('\n=== UB5：Config ===');
  check('★★★★★ Config 有 UNAVAILABLE_CONFIRMER_EMAILS（LIST、預設空白、說明）；基線 JSON、ConfigBaselineCheck',
    /key: CONFIG_KEYS\.UNAVAILABLE_CONFIRMER_EMAILS, type: CONFIG_TYPES\.LIST, group: 'WEBAPP',\s*defaultValue: '',/.test(read('src/ConfigSeed.gs'))
    && /"UNAVAILABLE_CONFIRMER_EMAILS"/.test(read('docs/config_baseline_上線值.json'))
    && /UNAVAILABLE_CONFIRMER_EMAILS: \{ launchTargetValue: ''/.test(read('src/ConfigBaselineCheck.gs')));
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exitCode = fail === 0 ? 0 : 1;
}
