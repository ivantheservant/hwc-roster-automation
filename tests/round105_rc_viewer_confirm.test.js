// 第一百零五輪批次 RC 組：只可查看的人看申報（不可以確認）；可以修改的人（例如辦公室帳戶）可以確認。
// 執行方式：node tests/round105_rc_viewer_confirm.test.js
//
// Ivan：「幹事介面、事奉人員表和申報確認：只可查看＝堂委、執事、同工；可以修改＝辦公室帳戶（幹事）」。
//
//   RC1 伺服器：只可查看的人讀得到確認畫面；決定一律拒絕（「你只有查看權限」）；可以修改的人讀、決定都可以，而且算確認者
//   RC2 確認畫面資料：只可查看 ⇒ canDecide=false；可以修改 ⇒ true
//   RC3 介面：只可查看的人打開〔不能服侍的日期〕（不是灰色），最上面列出待確認的申報；〔確認申請〕〔不確認〕〔全部確認〕灰色
//   RC4〔使用權限〕說明句寫明誰可以確認、只可查看的人看得到申報
// 用假資料（example.invalid）。

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
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

function sandbox(email) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  gas.Session = { getActiveUser: () => ({ getEmail: () => email }) };
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['office@example.invalid', 'admin@example.invalid'];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['leader1@example.invalid', 'staff1@example.invalid'];
    if (key === gas.CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS) return [];
    return d;
  };
  gas.writeAuditLog_ = () => {};
  gas.log_ = () => {};
  return gas;
}

console.log('\n=== RC1：伺服器 ===');
{
  const v = sandbox('leader1@example.invalid');
  check('★★★★★★ 只可查看（堂委、執事、同工）：讀得到確認畫面', v.assertWebAppRequestAllowed_('apiGetUnavailableConfirmView') === 'VIEWER');
  check('★★★★★★ 只可查看：讀得到〔不能服侍的日期〕', v.assertWebAppRequestAllowed_('apiListUnavailable') === 'VIEWER');
  check('★★★★★★ 只可查看：決定一律拒絕', /你只有查看權限/.test(throwsMsg(() => v.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions'))));
  check('★★★★★ 只可查看：不算確認者', v.resolveWebAppRole_('leader1@example.invalid').isConfirmer === false);
  const o = sandbox('office@example.invalid');
  check('★★★★★★ 可以修改（辦公室帳戶）：讀、決定都可以', o.assertWebAppRequestAllowed_('apiGetUnavailableConfirmView') === 'EDITOR'
    && o.assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions') === 'EDITOR');
  check('★★★★★★ 可以修改的人就是確認者（確認者名單空白也可以）', o.resolveWebAppRole_('office@example.invalid').isConfirmer === true);
}

console.log('\n=== RC2：確認畫面資料 ===');
{
  const pu = read('src/PersonalUnavailable.gs');
  check('★★★★★★ canDecide 由「是不是確認者」決定（可以修改的人或確認者名單）',
    /function apiGetUnavailableConfirmView\(quarterId\) \{[\s\S]{0,1500}isUnavailableConfirmerCaller_\(\)/.test(pu), '');
}

console.log('\n=== RC3：介面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1'; setViewOnly_(true);", ui);
  const data = { pendingCount: 1, canDecide: false, history: [],
    pending: [{ personName: '假甲', items: [{ submissionId: 'S1', serviceDate: '2099-01-04', postsText: '全部崗位', reason: '', submittedAt: '2099-01-01' }] }] };
  const nodes = ui.buildUnavailableConfirmNodes(data, async () => {}, { withHistory: false });
  const root = ui.document.createElement('div');
  nodes.forEach((n) => root.appendChild(n));
  const btns = root.flatten().filter((n) => n.tagName === 'BUTTON');
  const named = (t) => btns.filter((b) => b.textContent === t)[0];
  check('★★★★★★ 只可查看：看得到待確認的申報', /假甲/.test(root.textContent) && /待確認（1 項）/.test(root.textContent));
  check('★★★★★★ 只可查看：〔確認申請〕〔不確認〕〔全部確認〕灰色', ['確認申請', '不確認', '全部確認'].every((t) => named(t) && named(t).disabled === true),
    btns.map((b) => b.textContent + ':' + b.disabled).join(','));
  check('★★★★★ 寫明可以看但不可以確認', /可以看，但不可以確認/.test(root.textContent));
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★ 〔不能服侍的日期〕按鈕沒有被只可查看擋住（打開是唯讀）', /button\('不能服侍的日期', \(\) => openUnavailable\(\), ''\)/.test(z2));
}

console.log('\n=== RC4：〔使用權限〕說明句 ===');
{
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs', 'AdminTools.gs']);
  const t = g.PERMISSION_CATEGORY_TEXT;
  check('★★★★★ 可以修改：寫明可以確認事奉人員申報', /確認事奉人員申報/.test(t.editors), t.editors);
  check('★★★★★ 只可查看：寫明看得到事奉人員申報、〔確認申請〕〔不確認〕灰色', /事奉人員申報/.test(t.viewers) && /〔確認申請〕〔不確認〕/.test(t.viewers), t.viewers);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
