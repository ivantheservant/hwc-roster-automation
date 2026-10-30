// 第八十六輪批次 MB 組：附件選「不附」時，等候牌不要寫「產生 PDF」。
// 執行方式：node tests/round86_mb_wait_label.test.js
//
//   MB1　改動後重發：揀「不附」⇒ 確認後等候牌寫「寄送中，請稍候」；有附 PDF（或讀不到附件資料）⇒ 照舊「產生 PDF 並寄送，請稍候」
//   MB2　其他寄出按鈕（審閱、正式發出、補寄）的等候牌從來沒有「產生 PDF」；PDF 失敗後〔再試失敗的 N 份〕仍寫產生 PDF（那時一定有附 PDF）
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  console.log('\n=== MB1：改動後重發的等候牌 ===');
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('__labels = []; runAction = async function (l, fn) { __labels.push(l); await fn(); };'
    + ' resendGeneratePdfsThenSend = async function () {};'
    + ' getDashboard = async function () { return { isDryRun: true, buttons: {} }; };', ui);
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const labels = () => vm.runInContext('__labels', ui);
  const plan = (contents) => ({
    mode: 'HAS_CHANGES', sendMode: '', recipientCount: 2, versionNo: 3, changed: [], changedPersonCount: 0,
    confirmGroups: { willSend: [], changedNotSent: [], notReceivedNotSentCount: 0, notReceivedNotSentNames: [] },
    contents: contents, sendWarnings: null, isDryRun: true
  });
  // 取出 onConfirm：攔截 openConfirm
  vm.runInContext('__confirmArgs = null; openConfirm = function (o) { __confirmArgs = o; };', ui);
  const labelFor = async (contents) => {
    vm.runInContext('__labels = []; __confirmArgs = null;', ui);
    ui.callServer = async (name) => (name === 'apiStep5Plan' ? plan(contents) : {});
    await ui.openResend({ attachType: 'NONE' });
    await tick();
    const args = vm.runInContext('__confirmArgs', ui);
    await args.onConfirm();
    await tick();
    return labels().slice(-1)[0];
  };
  check('★★★★★★ 揀「不附」⇒ 「寄送中，請稍候」', (await labelFor({ attachType: 'NONE' })) === '寄送中，請稍候');
  check('★★★★★★ 個人版 PDF ⇒ 「產生 PDF 並寄送，請稍候」', (await labelFor({ attachType: 'PERSONAL_PDF' })) === '產生 PDF 並寄送，請稍候');
  check('★★★★★ 整季 PDF ⇒ 照現時', (await labelFor({ attachType: 'FULL_PDF' })) === '產生 PDF 並寄送，請稍候');
  check('★★★★★ 讀不到附件資料（contents＝null）⇒ 照現時', (await labelFor(null)) === '產生 PDF 並寄送，請稍候');

  console.log('\n=== MB2：其他寄出按鈕 ===');
  const z1 = read('src/ui/ScriptZone1.html');
  const z4 = read('src/ui/ScriptZone4.html');
  const sendWaits = (src) => (src.match(/runAction\('[^']*(?:寄送中|產生 PDF 並寄送)[^']*'/g) || []);
  check('★★★★★ 審閱、正式發出、補寄的等候牌是「寄送中，請稍候」，不含「產生 PDF」',
    sendWaits(z1).filter((t) => /寄送中/.test(t)).length === 2 && sendWaits(z4).every((t) => !/PDF/.test(t)) && sendWaits(z4).length === 1,
    JSON.stringify(sendWaits(z1).concat(sendWaits(z4))));
  check('★★★★★ 寫死「產生 PDF 並寄送」只剩 PDF 失敗後〔再試失敗的 N 份〕那一處（一定有附 PDF）',
    (z1.match(/runAction\('產生 PDF 並寄送，請稍候'/g) || []).length === 1);

  console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
  process.exitCode = fail === 0 ? 0 : 1;
})();
