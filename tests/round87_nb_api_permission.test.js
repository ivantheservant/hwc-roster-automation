// 第八十七輪批次 NB 組：只可查看的使用者——伺服器端（真正的防線）。
// 執行方式：node tests/round87_nb_api_permission.test.js
//
//   NB1　靜態：src/ 全部 api* 函式逐個歸類。開頭一定是
//        assertWebAppRequestAllowed_()（改動）、assertWebAppRequestAllowed_('<自己的名字>')（唯讀，名字要在清單內）、
//        或者 assertSpreadsheetEditorCaller_()（試算表側邊欄用）。新加的 api 沒有歸類 ⇒ 這裏紅。
//   NB2　伺服器端唯讀清單和前端 READ_ONLY_APIS 對照（只有列明的例外）；清單上每一個都真的用了
//   NB3　兩種權限：可以修改／只可查看；兩個名單都有 ⇒ 可以修改；空白名單退回 SCRIPT_ACCOUNT_EMAIL；全部空白 ⇒ 拒絕
//   NB4　只可查看的人呼叫改動 ⇒ 拒絕「你只有查看權限，不可以改動。」並寫 AuditLog；唯讀可以；名字不在清單 ⇒ 當改動
//   NB5　doGet：只可查看的人照樣打開介面；不在名單 ⇒ 中性頁；apiGetMyPermission
//   NB6　試算表側邊欄的 api：只有試算表編輯者／擁有人可以呼叫
// 下面用假資料（example.invalid），不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 1200));
}
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const listOf = (src, re) => (src.match(re) || ['', ''])[1].match(/'(api\w+)'/g).map((s) => s.slice(1, -1));

const webApp = read('src/WebApp.gs');
const serverRO = listOf(webApp, /const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/);
const exceptions = listOf(webApp, /const WEBAPP_READ_ONLY_EXCEPTIONS = \[([\s\S]*?)\];/);
const frontRO = listOf(read('src/ui/Script.html'), /const READ_ONLY_APIS = \[([\s\S]*?)\];/);
const SHEET_TOOLS = ['apiListPreacherTranslationPending', 'apiSavePreacherTranslationEntry', 'apiApplySheetTextUpdate'];

console.log('\n=== NB1：全部 api* 函式逐個歸類 ===');
const table = [];
const problems = [];
fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).forEach((file) => {
  const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^function (api[A-Za-z0-9_]*)\s*\(/);
    if (!m) return;
    const name = m[1];
    if (/_$/.test(name)) return;  // 以 _ 結尾＝私有（google.script.run 叫不到），例如 apiX_locked_
    let j = i + 1;
    while (j < lines.length && (/^\s*$/.test(lines[j]) || /^\s*\/\//.test(lines[j]))) j++;
    const first = (lines[j] || '').trim();
    let kind = '';
    const ro = first.match(/^(?:const \w+ = )?assertWebAppRequestAllowed_\('(api\w+)'\);$/);
    if (/^assertWebAppRequestAllowed_\(\);$/.test(first)) kind = '改動';
    else if (ro) {
      if (ro[1] !== name) problems.push(file + ' ' + name + '：傳入的名字是 ' + ro[1]);
      else if (serverRO.indexOf(name) === -1) problems.push(file + ' ' + name + '：傳了名字但不在 WEBAPP_READ_ONLY_APIS');
      else kind = '唯讀';
    } else if (/^assertSpreadsheetEditorCaller_\(\);$/.test(first)) {
      if (SHEET_TOOLS.indexOf(name) === -1) problems.push(file + ' ' + name + '：試算表編輯者檢查只限試算表側邊欄用的 api');
      else kind = '試算表側邊欄（改動，試算表編輯者）';
    } else problems.push(file + ':' + (j + 1) + ' ' + name + '：開頭是「' + first + '」');
    table.push({ name: name, file: file, kind: kind });
  });
});
check('★★★★★★ 每一個 api* 開頭都有權限檢查並已歸類（沒有歸類 ⇒ 紅）', problems.length === 0, problems.join('\n'));
check('★★★★ 掃描得到的數量合理（> 130）', table.length > 130, table.length);
const counts = {};
table.forEach((t) => { counts[t.kind] = (counts[t.kind] || 0) + 1; });
console.log('      歸類：' + JSON.stringify(counts));
if (process.env.PRINT_API_TABLE) table.forEach((t) => console.log(t.kind + '\t' + t.name + '\t' + t.file));

console.log('\n=== NB2：伺服器端唯讀清單 ↔ 前端 READ_ONLY_APIS ===');
const notInServer = frontRO.filter((n) => serverRO.indexOf(n) === -1 && exceptions.indexOf(n) === -1);
const notInFront = serverRO.filter((n) => frontRO.indexOf(n) === -1);
check('★★★★★★ 兩份一致（只有 WEBAPP_READ_ONLY_EXCEPTIONS 列明的例外）', notInServer.length === 0 && notInFront.length === 0,
  '前端有、伺服器沒有：' + notInServer.join('、') + '／伺服器有、前端沒有：' + notInFront.join('、'));
check('★★★★★ 例外 apiVerifyRosterForZone4（會寫 Verify_ 工作表）⇒ 伺服器當改動', exceptions.join() === 'apiVerifyRosterForZone4'
  && serverRO.indexOf('apiVerifyRosterForZone4') === -1);
const unused = serverRO.filter((n) => !table.some((t) => t.name === n && t.kind === '唯讀'));
check('★★★★★ 唯讀清單上每一個都真的用了自己的名字呼叫檢查', unused.length === 0, unused.join('、'));
check('★★★★★ 會建立季度、由出席系統更新電郵、改主題偏好的 api 當作改動',
  ['apiEnsureFutureQuarters', 'apiSyncPeopleFromHwcas', 'apiSetThemePreference', 'apiOpenEligibilitySheet', 'apiOpenVersionForViewing']
    .every((n) => (table.find((t) => t.name === n) || {}).kind === '改動'));

console.log('\n=== NB3／NB4：兩種權限 ===');
function sandbox(opts) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  const audits = [];
  gas.Session = { getActiveUser: () => ({ getEmail: () => opts.email || '' }) };
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return opts.enabled !== false;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return opts.editors || [];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return opts.viewers || [];
    if (key === gas.CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL) return opts.scriptAccount || '';
    return d;
  };
  gas.writeAuditLog_ = (e) => audits.push(e);
  gas.log_ = () => {};
  return { gas: gas, audits: audits };
}
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
{
  const base = { editors: ['Editor@Example.invalid'], viewers: ['viewer@example.invalid', 'both@example.invalid'] };
  const ed = sandbox(Object.assign({ email: 'editor@example.invalid' }, base));
  check('★★★★★★ 可以修改的人：改動和唯讀都可以', ed.gas.assertWebAppRequestAllowed_() === 'EDITOR'
    && ed.gas.assertWebAppRequestAllowed_('apiListQuarters') === 'EDITOR');
  const vw = sandbox(Object.assign({ email: 'viewer@example.invalid' }, base));
  check('★★★★★★ 只可查看的人：唯讀 api 可以', vw.gas.assertWebAppRequestAllowed_('apiListQuarters') === 'VIEWER');
  const msg = throwsMsg(() => vw.gas.assertWebAppRequestAllowed_());
  check('★★★★★★ 只可查看的人：改動 ⇒ 拒絕「你只有查看權限，不可以改動。」', msg === '你只有查看權限，不可以改動。', msg);
  check('★★★★★★ 拒絕時寫 AuditLog', vw.audits.length === 1 && vw.audits[0].action === 'WEBAPP_VIEW_ONLY_DENIED'
    && vw.audits[0].targetKey === 'viewer@example.invalid', JSON.stringify(vw.audits));
  check('★★★★★★ 傳了名字但不在唯讀清單 ⇒ 照樣當作改動', throwsMsg(() => vw.gas.assertWebAppRequestAllowed_('apiSaveCombinedServices')) === '你只有查看權限，不可以改動。'
    && vw.audits[1].newValue === 'apiSaveCombinedServices');
  check('★★★★★ apiVerifyRosterForZone4（例外）⇒ 只可查看的人不可以', throwsMsg(() => vw.gas.assertWebAppRequestAllowed_('apiVerifyRosterForZone4')) !== '');
  const both = sandbox(Object.assign({ email: 'both@example.invalid' }, { editors: ['both@example.invalid'], viewers: ['both@example.invalid'] }));
  check('★★★★★★ 兩個名單都有 ⇒ 可以修改', both.gas.assertWebAppRequestAllowed_() === 'EDITOR');
  const out = sandbox(Object.assign({ email: 'stranger@example.invalid' }, base));
  check('★★★★★★ 不在任何名單 ⇒ 拒絕（不是查看權限那一句）', /不在 Web UI 允許名單內/.test(throwsMsg(() => out.gas.assertWebAppRequestAllowed_('apiListQuarters'))));
  const fb = sandbox({ email: 'owner@example.invalid', editors: [], viewers: [], scriptAccount: 'owner@example.invalid' });
  check('★★★★★ WEBAPP_ALLOWED_EMAILS 空白 ⇒ 退回 SCRIPT_ACCOUNT_EMAIL（可以修改）', fb.gas.assertWebAppRequestAllowed_() === 'EDITOR');
  const fbv = sandbox({ email: 'viewer@example.invalid', editors: [], viewers: ['viewer@example.invalid'], scriptAccount: 'owner@example.invalid' });
  check('★★★★★ 可以修改的名單空白時，查看名單照樣生效', fbv.gas.assertWebAppRequestAllowed_('apiListQuarters') === 'VIEWER'
    && throwsMsg(() => fbv.gas.assertWebAppRequestAllowed_()) === '你只有查看權限，不可以改動。');
  const empty = sandbox({ email: 'a@example.invalid' });
  check('★★★★★ 全部名單空白 ⇒ 拒絕（空白不代表任何人）', /允許名單是空的/.test(throwsMsg(() => empty.gas.assertWebAppRequestAllowed_('apiListQuarters'))));
  const anon = sandbox(Object.assign({ email: '' }, base));
  check('★★★★★ 讀不到電郵 ⇒ 拒絕', /無法識別呼叫者身分/.test(throwsMsg(() => anon.gas.assertWebAppRequestAllowed_('apiListQuarters'))));
  const off = sandbox(Object.assign({ email: 'editor@example.invalid', enabled: false }, base));
  check('★★★★★ WEBAPP_ENABLED 關閉 ⇒ 連可以修改的人也拒絕', /已停用/.test(throwsMsg(() => off.gas.assertWebAppRequestAllowed_())));
  check('★★★★★ Config 有 WEBAPP_VIEWER_EMAILS（種子、說明、預設空白）', /key: CONFIG_KEYS\.WEBAPP_VIEWER_EMAILS, type: CONFIG_TYPES\.LIST, group: 'WEBAPP',\s*defaultValue: '',\s*description: '只可以查看幹事介面的人。名單上的人可以打開所有畫面，但不可以儲存、生成、寄出或改動任何資料。'\s*\+ '可以修改的人填在 WEBAPP_ALLOWED_EMAILS。'/.test(read('src/ConfigSeed.gs'))
    && /名單上的人可以修改。/.test(read('src/ConfigSeed.gs')) && /"WEBAPP_VIEWER_EMAILS"/.test(read('docs/config_baseline_上線值.json'))
    && /WEBAPP_VIEWER_EMAILS: \{ launchTargetValue: ''/.test(read('src/ConfigBaselineCheck.gs')));
}

console.log('\n=== NB5：doGet、apiGetMyPermission ===');
{
  const mk = (email) => {
    const s = sandbox({ email: email, editors: ['editor@example.invalid'], viewers: ['viewer@example.invalid'] });
    const rendered = [];
    s.gas.HtmlService = {
      createTemplateFromFile: () => ({ evaluate: () => { const o = { setTitle: () => o, addMetaTag: () => o, kind: 'INDEX' }; rendered.push(o); return o; } }),
      createHtmlOutput: (html) => { const o = { html: html, setTitle: () => o }; rendered.push(o); return o; }
    };
    return { s: s, rendered: rendered };
  };
  const v = mk('viewer@example.invalid');
  check('★★★★★★ 只可查看的人：doGet 照樣打開介面', v.s.gas.doGet({ parameter: {} }).kind === 'INDEX');
  check('★★★★★★ apiGetMyPermission：只可查看', JSON.stringify(v.s.gas.apiGetMyPermission()) === '{"role":"VIEWER","canModify":false}');
  const e = mk('editor@example.invalid');
  check('★★★★★ apiGetMyPermission：可以修改', JSON.stringify(e.s.gas.apiGetMyPermission()) === '{"role":"EDITOR","canModify":true}');
  const x = mk('stranger@example.invalid');
  const page = x.s.gas.doGet({ parameter: {} });
  check('★★★★★★ 不在名單 ⇒ 中性頁「這個網址只供幹事使用」', /這個網址只供幹事使用/.test(page.html || ''), page.html);
}

console.log('\n=== NB6：試算表側邊欄的 api ===');
{
  const mk = (email) => {
    const s = sandbox({ email: email, editors: ['editor@example.invalid'], viewers: ['viewer@example.invalid'] });
    s.gas.SpreadsheetApp = { getActiveSpreadsheet: () => ({
      getEditors: () => [{ getEmail: () => 'Sheet.Editor@example.invalid' }],
      getOwner: () => ({ getEmail: () => 'owner@example.invalid' }) }) };
    return s.gas;
  };
  check('★★★★★ 試算表編輯者 ⇒ 可以', throwsMsg(() => mk('sheet.editor@example.invalid').assertSpreadsheetEditorCaller_()) === '');
  check('★★★★★ 試算表擁有人 ⇒ 可以', throwsMsg(() => mk('owner@example.invalid').assertSpreadsheetEditorCaller_()) === '');
  check('★★★★★ 幹事介面可以修改的人 ⇒ 可以', throwsMsg(() => mk('editor@example.invalid').assertSpreadsheetEditorCaller_()) === '');
  check('★★★★★★ 只可查看的人／陌生人／讀不到電郵 ⇒ 拒絕',
    /不是這份試算表的編輯者/.test(throwsMsg(() => mk('viewer@example.invalid').assertSpreadsheetEditorCaller_()))
    && /不是這份試算表的編輯者/.test(throwsMsg(() => mk('stranger@example.invalid').assertSpreadsheetEditorCaller_()))
    && /無法識別/.test(throwsMsg(() => mk('').assertSpreadsheetEditorCaller_())));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
