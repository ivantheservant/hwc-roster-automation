// 第六十五輪批次 AB 組（低優先）：四個細位。
// 執行方式：node tests/ab_ui_details.test.js
//
// ① 儲存確認畫面「會自動套用的修改申報」：QuarterID 空白、按日期認出嗰筆，
//    後面加「（QuarterID 空白，按日期判斷為 2028T2）」——之前淨係 `Requests` H 欄先有。
// ② 講員、翻譯（AutoGenerate=FALSE）對唔上名單用中性灰色；獻花維持橙色。
// ③ 主流程第 1 步「現時有 N 個版本」儲存新版本之後唔更新——版本數嚟自
//    `mainFlowState_` 快取，寫入之後只有 dashboard 重讀。改用 dashboard 嘅最新版本號。
// ④ 補寄完成窗出現之後，後面仲疊住「寄送中，請稍候」處理中牌約 1 分鐘——
//    `runAction()` 等刷新完先收牌。已經開咗結果窗就即刻收。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sliceFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
}

// =====================================================================
console.log('\n=== AB①：按日期認出季度嗰筆，儲存確認畫面講明 ===');
{
  const flow = read('src/WebAppFlow.gs');
  const ctx = vm.createContext({});
  vm.runInContext(sliceFn(flow, 'mapRequestForClient_'), ctx);
  const mapped = ctx.mapRequestForClient_({ sheetRow: 7, serviceDateText: '2099-04-05', postNameText: '司事',
    personNameText: '假一', requestType: 'UNAVAILABLE', reason: '', quarterNote: 'QuarterID 空白，按日期判斷為 2099T2' });
  check('★★★★★ mapRequestForClient_() 把 quarterNote 帶去前端', mapped.quarterNote === 'QuarterID 空白，按日期判斷為 2099T2',
    JSON.stringify(mapped));
  check('★★★ 冇 quarterNote ⇒ 空字串', ctx.mapRequestForClient_({ sheetRow: 1 }).quarterNote === '');

  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const row = ui.requestRow(mapped);
  check('★★★★★★ 「會自動套用的修改申報」嗰行後面有「（QuarterID 空白，按日期判斷為 2099T2）」',
    /假一（QuarterID 空白，按日期判斷為 2099T2）$/.test(row.textContent), row.textContent);
  const plain = ui.requestRow(Object.assign({}, mapped, { quarterNote: '' }));
  check('★★★★ 一般嗰筆唔加括號', !/（/.test(plain.textContent), plain.textContent);
}

console.log('\n=== AB②：講員、翻譯對唔上名單 ⇒ 中性灰色 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone2.html']);
  const n1 = new ui.__StubNode('div');
  ui.renderLinkFeedback(n1, { linkedToNameMapping: false }, '外請', true);
  check('★★★★★ 講員／翻譯：灰色（muted），唔係橙色警告', n1.className === 'muted', n1.className);
  check('★★★★ 句子照舊（外請講員屬正常）', /外請講員屬正常/.test(n1.textContent));
  const n2 = new ui.__StubNode('div');
  ui.renderLinkFeedback(n2, { linkedToNameMapping: false }, '打錯', false);
  check('★★★★★ 獻花（optional）維持橙色', n2.className === 'link-warn', n2.className);
  const n3 = new ui.__StubNode('div');
  ui.renderLinkFeedback(n3, { linkedToNameMapping: true }, '假一', true);
  check('★★★★ 對得上照舊綠色', n3.className === 'link-ok', n3.className);
  check('★★★★★ 呼叫點按 c.optional 分：必填（講員、翻譯）⇒ 中性',
    /renderLinkFeedback\(linkNote, res, name, !c\.optional\);/.test(read('src/ui/ScriptZone2.html')));
}

console.log('\n=== AB③：第 1 步「現時有 N 個版本」跟住 dashboard ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptMainFlow.html']);
  vm.runInContext("currentQuarterId = '2099T2';", ui);
  const cached = { quarterId: '2099T2', found: true, alreadyGenerated: true, versionCount: 2, label: '2099 年第 2 季' };
  const t = ui.withFreshVersionCount(cached, { latestVersion: { versionNo: 3 } });
  check('★★★★★★ 儲存成 v3 之後：現時有 4 個版本（唔再係快取嘅 2）', t.versionCount === 4, JSON.stringify(t));
  check('★★★★ 唔改快取本身', cached.versionCount === 2);
  const other = ui.withFreshVersionCount(Object.assign({}, cached, { quarterId: '2099T3' }), { latestVersion: { versionNo: 3 } });
  check('★★★★★ 目標季度唔係而家睇緊嗰季 ⇒ 唔借用 dashboard 嘅版本號', other.versionCount === 2, JSON.stringify(other));
  check('★★★ dashboard 冇版本 ⇒ 照用快取', ui.withFreshVersionCount(cached, { latestVersion: null }).versionCount === 2);
  const mf = read('src/ui/ScriptMainFlow.html');
  check('★★★★★ renderStep1() 真係用佢',
    /function renderStep1\(d, flow\) \{\s*const t = withFreshVersionCount\(flow && flow\.generateTarget, d\);/.test(mf));
}

console.log('\n=== AB④：已經開咗結果窗 ⇒ 處理中牌即刻收 ===');
{
  const ui = loadUiScripts(['Script.html']);
  const order = [];
  vm.runInContext(`
    busyShow = function () { __order.push('show'); };
    busyHide = function (o) { __order.push('hide:' + (o || '')); };
    setBusy = function () {};
    setStatus = function () {};
    dashboardStale_ = true;
    loadDashboard = async function () { __order.push('refresh'); };
  `, Object.assign(ui, { __order: order }));
  (async function () {
    await ui.runAction('補寄', async function () { vm.runInContext('modalOpen = true;', ui); });
    check('★★★★★★ 有結果窗：先收牌，再刷新（唔會疊住完成窗等成分鐘）',
      order.join(',') === 'show,hide:,refresh', order.join(','));
    order.length = 0;
    vm.runInContext('modalOpen = false; dashboardStale_ = true;', ui);
    await ui.runAction('儲存', async function () {});
    check('★★★★★ 冇結果窗：照舊刷新完先收（「已完成」牌）',
      order.join(',') === 'show,refresh,hide:done', order.join(','));
    order.length = 0;
    vm.runInContext('modalOpen = true; dashboardStale_ = false;', ui);
    vm.runInContext('showErrorModal = function () { __order.push("error"); };', ui);
    await ui.runAction('補寄', async function () { throw new Error('x'); });
    check('★★★★ 失敗照舊（失敗牌）', order.indexOf('hide:fail') !== -1 && order.indexOf('hide:') === -1, order.join(','));

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exit(fail === 0 ? 0 : 1);
  })().catch(function (e) { console.log('FAIL  crashed: ' + e.stack); process.exit(1); });
}
