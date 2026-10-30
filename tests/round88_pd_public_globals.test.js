// 第八十八輪批次 PC／PD 組：收起公開的全域函式。
// 執行方式：node tests/round88_pd_public_globals.test.js
//
// 背景：Apps Script 容許這個腳本送出的任何網頁（個人專屬連結那一頁＝任何人；幹事介面＝教會網域內的人）
// 用 google.script.run 呼叫**不以 _ 結尾的全域函式**，而且以部署者身分執行。
//
//   PD1　src/*.gs 全部頂層 function：不以 _ 結尾的，一定是白名單（doGet、onOpen、onEdit、includeHtml）
//        或者已歸類的 api*（開頭 assertWebAppRequestAllowed_／assertSpreadsheetEditorCaller_）。新加一個沒有歸類 ⇒ 紅
//   PD5　第九十輪批次 QC 組：「個人連結公開函式」一類——只限 PERSONAL_LINK_PUBLIC_APIS（PersonalUnavailable.gs）；
//        每個第一句一定是 `const person = assertPersonalLinkCaller_(token);`（用 token 認人）；頁面只呼叫這幾個
//   PD2　白名單本身的內容（不可以靜靜加名）
//   PD3　選單每一個 addItem 的目標函式都存在；每日觸發器指向的函式存在
//   PD4　第八十八輪改了名的函式：舊名稱不再是頂層函式
//   PC1　includeHtml 只准讀 ui/ 下面的檔
//   PC2　onEdit：e 是普通物件（例如經 google.script.run 傳入）⇒ 不清 Config 快取
// 下面用假資料，不涉及真實姓名。

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

/**
 * 必須保持公開的函式及理由。**加名之前要寫明為甚麼一定要公開**，並更新這裏的測試（PD2）。
 */
const PUBLIC_ALLOWLIST = {
  doGet: 'Apps Script 規定的網頁進入點（兩個部署共用；有 p ⇒ 個人頁，否則三層防護）',
  onOpen: 'Apps Script 規定的簡單觸發器（建立選單；在網頁呼叫會失敗，不會改資料）',
  onEdit: 'Apps Script 規定的簡單觸發器（只在編輯 Config 工作表時清快取；普通物件不會觸發，見 PC2）',
  includeHtml: 'ui/Index.html 模板用（只准讀 ui/ 的檔，見 PC1）'
};

const GUARD = /^(?:const \w+ = )?(?:assertWebAppRequestAllowed_\((?:'api\w+')?\)|assertSpreadsheetEditorCaller_\(\));$/;
// 第九十輪批次 QC 組：個人連結公開函式（義工的個人專屬連結頁用 google.script.run 呼叫；那個部署是任何人都打得開）。
// 理由：義工沒有教會帳戶，不可以經幹事介面的權限檢查；所以每個函式第一句一定用 token 認人，只寫這個人自己的申報。
const PERSONAL_GUARD = /^const person = assertPersonalLinkCaller_\(token\);$/;
const personalSrc = read('src/PersonalUnavailable.gs');
const PERSONAL_APIS = ((personalSrc.match(/const PERSONAL_LINK_PUBLIC_APIS = \[([^\]]*)\];/) || ['', ''])[1].match(/'([^']+)'/g) || [])
  .map((s) => s.slice(1, -1));
const personalFound = [];
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs'));
const topFns = {};
const problems = [];
files.forEach((file) => {
  const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/^function ([A-Za-z0-9_$]+)\s*\(/);
    if (!m) return;
    const name = m[1];
    topFns[name] = file;
    if (/_$/.test(name)) return;
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ALLOWLIST, name)) return;
    if (PERSONAL_APIS.indexOf(name) !== -1) {
      personalFound.push(name);
      const sig = line.match(/^function \w+\(([^)]*)\)/);
      let j = i + 1;
      while (j < lines.length && (/^\s*$/.test(lines[j]) || /^\s*\/\//.test(lines[j]))) j++;
      if (!sig || sig[1].split(',')[0].trim() !== 'token') problems.push(file + ' ' + name + '：個人連結公開函式第一個參數一定是 token');
      if (!PERSONAL_GUARD.test((lines[j] || '').trim())) problems.push(file + ' ' + name + '：個人連結公開函式第一句沒有用 token 認人（「' + (lines[j] || '').trim() + '」）');
      return;
    }
    if (/^api/.test(name)) {
      let j = i + 1;
      while (j < lines.length && (/^\s*$/.test(lines[j]) || /^\s*\/\//.test(lines[j]))) j++;
      if (!GUARD.test((lines[j] || '').trim())) problems.push(file + ' ' + name + '：api 開頭沒有權限檢查（「' + (lines[j] || '').trim() + '」）');
      return;
    }
    problems.push(file + ':' + (i + 1) + ' ' + name + '：公開的全域函式（不以 _ 結尾、不在白名單、不是已歸類的 api）');
  });
});

console.log('\n=== PD1：公開的全域函式 ===');
check('★★★★★★ 不以 _ 結尾的頂層函式只有白名單和已歸類的 api*', problems.length === 0, problems.join('\n'));
const publicNonApi = Object.keys(topFns).filter((n) => !/_$/.test(n) && !/^api/.test(n) && PERSONAL_APIS.indexOf(n) === -1).sort();
check('★★★★★ 公開的非 api 函式正好是 doGet、includeHtml、onEdit、onOpen', publicNonApi.join(',') === 'doGet,includeHtml,onEdit,onOpen', publicNonApi.join(','));

console.log('\n=== PD2：白名單本身 ===');
check('★★★★★★ 白名單只有 4 個，每個都寫明理由', Object.keys(PUBLIC_ALLOWLIST).sort().join(',') === 'doGet,includeHtml,onEdit,onOpen'
  && Object.keys(PUBLIC_ALLOWLIST).every((k) => PUBLIC_ALLOWLIST[k].length > 10));

console.log('\n=== PD5：個人連結公開函式（第九十輪批次 QC 組）===');
check('★★★★★★ 只有兩個：personalSubmitUnavailable、personalWithdrawUnavailable（加名要寫理由並改這裏）',
  PERSONAL_APIS.slice().sort().join(',') === 'personalSubmitUnavailable,personalWithdrawUnavailable', PERSONAL_APIS.join(','));
check('★★★★★ 清單上每一個都真的存在（而且只在 PersonalUnavailable.gs）',
  personalFound.slice().sort().join(',') === PERSONAL_APIS.slice().sort().join(',')
  && PERSONAL_APIS.every((n) => topFns[n] === 'PersonalUnavailable.gs'), personalFound.join(','));
{
  const page = read('src/ui/PersonalRoster.html');
  const called = (page.match(/\.(\w+)\(token/g) || []).map((s) => s.slice(1, -6));
  const runs = (page.match(/google\.script\.run/g) || []).length;
  check('★★★★★★ 個人頁只呼叫這兩個函式（每次都帶 token）', runs === 1 && called.slice().sort().join(',') === PERSONAL_APIS.slice().sort().join(','),
    runs + '｜' + called.join(','));
  const staffUi = fs.readdirSync(path.join(SRC, 'ui')).filter((f) => f !== 'PersonalRoster.html')
    .map((f) => fs.readFileSync(path.join(SRC, 'ui', f), 'utf8')).join('\n');
  check('★★★★ 幹事介面不呼叫個人連結公開函式', PERSONAL_APIS.every((n) => staffUi.indexOf(n) === -1));
}
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppPersonalLink.gs', 'PersonalUnavailable.gs']);
  let enabled = true;
  let lookups = 0;
  const writes = [];
  gas.assertWebAppEnabled_ = () => { if (!enabled) throw new Error('WEBAPP_ENABLED=FALSE'); };
  gas.findPersonByToken_ = (t) => { lookups++; return t === 'a'.repeat(32) ? { personId: 'P9701', nameTC: '假一' } : null; };
  gas.submitPersonalUnavailable_ = () => { writes.push('submit'); return { ok: true }; };
  gas.withdrawPersonalUnavailable_ = () => { writes.push('withdraw'); return { ok: true }; };
  gas.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  const msg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  const neutral = gas.PERSONAL_LINK_INVALID_MESSAGE;
  const bad = ['', null, undefined, 'b'.repeat(32), 'a'.repeat(31), 'a'.repeat(32) + ' x', { toString: () => 'a'.repeat(32) }, ['a'.repeat(32)]];
  check('★★★★★★ token 錯、格式不對、不是字串 ⇒ 兩個函式都是同一句中性錯誤，甚麼都沒有寫',
    bad.every((t) => msg(() => gas.personalSubmitUnavailable(t, '', ['2099-01-04'], '')) === neutral
      && msg(() => gas.personalWithdrawUnavailable(t, '', 'SUB-1')) === neutral) && writes.length === 0, writes.join(','));
  check('★★★★★ 格式不對的 token 不用讀表', (() => { lookups = 0; msg(() => gas.personalSubmitUnavailable('x', '', [], '')); return lookups === 0; })());
  enabled = false;
  check('★★★★★ Web UI 停用 ⇒ 正確的 token 也只得中性錯誤', msg(() => gas.personalSubmitUnavailable('a'.repeat(32), '', [], '')) === neutral && writes.length === 0);
  enabled = true;
  gas.personalSubmitUnavailable('a'.repeat(32), '', [], '');
  gas.personalWithdrawUnavailable('a'.repeat(32), '', 'SUB-1');
  check('★★★★ 正確的 token ⇒ 才會做', writes.join(',') === 'submit,withdraw', writes.join(','));
}

console.log('\n=== PD3：選單、觸發器的目標函式都存在 ===');
const menu = read('src/Menu.gs');
const targets = (menu.match(/addItem\([^)]*?,\s*'([A-Za-z0-9_$]+)'\)/g) || []).map((s) => s.match(/'([A-Za-z0-9_$]+)'\)$/)[1]);
const missing = targets.filter((t) => !topFns[t]);
check('★★★★★★ 選單每一個 addItem 的目標函式都存在（改名之後不可以斷）', targets.length > 50 && missing.length === 0, '找不到：' + missing.join('、') + '（共 ' + targets.length + ' 項）');
const trig = read('src/Trigger.gs').match(/const AUTOMATION_TRIGGER_FUNCTION = '([A-Za-z0-9_$]+)';/);
check('★★★★★★ 每日觸發器指向的函式存在', trig && !!topFns[trig[1]], trig && trig[1]);
const newTriggers = (files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n').match(/ScriptApp\.newTrigger\(([^)]+)\)/g) || []);  // 註解內的「newTrigger()」不算
check('★★★★★ 只有一處 newTrigger，用 AUTOMATION_TRIGGER_FUNCTION', newTriggers.length === 1 && /AUTOMATION_TRIGGER_FUNCTION/.test(newTriggers[0]), newTriggers.join(' | '));

console.log('\n=== PD4：第八十八輪改了名的函式 ===');
const RENAMED = ['readSheet', 'getConfig', 'readConfig', 'sendStage', 'writeAssignments', 'registerVersion', 'createRosterSheet',
  'applyDecisions', 'protectV0', 'installAutomationTrigger', 'findLatestVersionNo', 'readPeople', 'resolvePersonId', 'toDateString',
  'formatDate', 'parseDate', 'verifyRoster', 'exportRosterPdf', 'syncHwcasEmails', 'applyHwcasDraft', 'generateBest', 'tuneParameters'];
check('★★★★★★ 舊名稱不再是頂層函式（已改名加 _）', RENAMED.every((n) => !topFns[n] && topFns[n + '_']), RENAMED.filter((n) => topFns[n] || !topFns[n + '_']).join('、'));
check('★★★★★ runSelfTest（撞名）⇒ runSelfTestChecks_；選單入口 runSelfTest_ 照舊', !topFns.runSelfTest && topFns.runSelfTestChecks_ && topFns.runSelfTest_
  && /runSelfTestChecks_\(\)/.test(read('src/Menu.gs')));

console.log('\n=== PC1：includeHtml 只准讀 ui/ ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  const opened = [];
  gas.HtmlService = { createHtmlOutputFromFile: (n) => { opened.push(n); return { getContent: () => '<' + n + '>' }; } };
  check('★★★★★ ui/Style ⇒ 讀得到', gas.includeHtml('ui/Style') === '<ui/Style>');
  const bad = ['Config', 'appsscript', 'ui/../Config', '../ui/Style', 'ui/Style.html?x', 'UI/Style', '', null, undefined, 'ui/ Style'];
  const leaked = bad.filter((n) => { try { gas.includeHtml(n); return true; } catch (e) { return !/只可以讀 ui\//.test(e.message); } });
  check('★★★★★★ 不是 ui/ 的檔、有 .. 或特殊字元 ⇒ 拒絕，而且沒有讀檔', leaked.length === 0 && opened.length === 1, leaked.join(' | ') + '｜讀過：' + opened.join(','));
  check('★★★★ 模板用的名稱全部合格', (read('src/ui/Index.html').match(/includeHtml\('([^']+)'\)/g) || []).every((s) => /^includeHtml\('ui\/[A-Za-z0-9_\-\/]+'\)$/.test(s)));
}

console.log('\n=== PC2：onEdit ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs']);
  let reloads = 0;
  gas.reloadConfigCache_ = () => { reloads++; };
  gas.log_ = () => {};
  gas.onEdit({ range: { getSheet: 'x' } });
  gas.onEdit({ range: { a: 1 } });
  gas.onEdit({});
  gas.onEdit(null);
  gas.onEdit(JSON.parse(JSON.stringify({ range: { getSheet: () => ({ getName: () => 'Config' }) } })));
  check('★★★★★★ e 是普通物件（經 google.script.run 傳入的只可以是資料）⇒ 不清 Config 快取', reloads === 0, reloads);
  gas.onEdit({ range: { getSheet: () => ({ getName: () => gas.SHEETS.CONFIG }) } });
  check('★★★★ 真的編輯 Config 工作表 ⇒ 清快取（行為照舊）', reloads === 1, reloads);
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
