// 第六十六輪批次 AE 組：改動後重發確認框——標題同段首句嘅數字要對得上。
// 執行方式：node tests/resend_confirm_kind_tags.test.js
//
// 現場（2026-10-21 R1.4）：確認框寫「自上次發出之後，這 1 個人的安排改了」，
// 下面標題「這一次會寄給的 2 位」，列咗 2 個人——1 位上次有收到、安排改了；
// 1 位上次沒有收到。幹事見到 1 同 2 會猶豫。
//
// 做法：每人旁邊標明「安排改了」或「上次沒有收到」；段首句嘅數字由**下面實際列出嘅人**出
// （同一份 `confirmGroups.willSend`），所以永遠同標題對得上。唔改第六十五輪 Y 組嘅分段結構。
// 下面用假 ID（P98xx）。

const fs = require('fs');
const path = require('path');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
const person = (o) => Object.assign({
  personId: '', nameTC: '', isListRecipient: false, inChangedList: false, arrangementChanged: false,
  hasAssignments: true, hasEmail: true, firstNotifyDueToEmail: false,
  previousSummary: '', currentSummary: '18/06 司事', changeNotes: []
}, o);

// 實況重現：吳（上次有收到、安排改了）＋許（上次沒有收到）會寄；另有一位改咗但冇揀
const willSend = [
  person({ personId: 'P9801', nameTC: '假一', inChangedList: true, arrangementChanged: true,
    previousSummary: '本季您暫時沒有任何服侍安排' }),
  person({ personId: 'P9802', nameTC: '假二', inChangedList: true, arrangementChanged: false,
    changeNotes: ['6 月 18 日　司事（換走了，改為 假一）'], currentSummary: '07/05 司事' })
];
const plan = {
  mode: 'HAS_CHANGES', recipientCount: 2,
  changed: [{ personId: 'P9801', arrangementChanged: true }, { personId: 'P9802', arrangementChanged: false }],
  confirmGroups: { willSend: willSend, changedNotSent: [], notReceivedNotSentCount: 0, notReceivedNotSentNames: [] },
  contents: { attachLine: '附件：個人版 PDF', icsLine: '日曆檔：附 .ics 日曆檔' }
};

console.log('\n=== AE【核心】標題同段首句對得上 ===');
{
  const nodes = ui.buildResendConfirmNodes(plan);
  const top = nodes[0].textContent;
  const list = nodes[1];
  check('★★★★★★ 標題「這一次會寄給的 2 位」', /這一次會寄給的 2 位/.test(top), top);
  check('★★★★★★ 段首句：1 位安排改了、1 位上次沒有收到（加埋 ＝ 2 位）',
    /當中 1 位是自上次發出之後安排改了、1 位是上次正式發出時沒有收到/.test(top), top);
  check('★★★★★★ 唔再寫「這 N 個人的安排改了」（舊句子，數字同標題對唔上）', !/個人的安排改了/.test(top), top);
  check('★★★★★ 列出 2 個人', list.children.length === 2, list.children.length);
  const t0 = list.children[0].textContent;
  const t1 = list.children[1].textContent;
  check('★★★★★★ 第 1 位旁邊標「安排改了」', /假一/.test(t0) && /安排改了/.test(t0) && !/上次沒有收到/.test(t0), t0);
  check('★★★★★★ 第 2 位旁邊標「上次沒有收到」', /假二/.test(t1) && /上次沒有收到/.test(t1) && !/安排改了/.test(t1), t1);
}

console.log('\n=== AE：邊界 ===');
{
  // 名單收件人、冇喺改動名單入面嘅人 ⇒ 唔標、唔計
  const p2 = JSON.parse(JSON.stringify(plan));
  p2.confirmGroups.willSend.push(person({ personId: '', nameTC: '教會辦公室', isListRecipient: true }));
  p2.confirmGroups.willSend.push(person({ personId: 'P9803', nameTC: '假三', inChangedList: false }));
  p2.recipientCount = 4;
  const nodes = ui.buildResendConfirmNodes(p2);
  const top = nodes[0].textContent;
  check('★★★★ 名單收件人／另外揀嘅人唔計入兩個數字', /當中 1 位是自上次發出之後安排改了、1 位是上次正式發出時沒有收到/.test(top), top);
  const list = nodes[1];
  check('★★★★ 名單收件人冇「安排改了」「上次沒有收到」標', !/安排改了|上次沒有收到/.test(list.children[2].textContent), list.children[2].textContent);

  // 兩位都係上次沒有收到 ⇒ 只講第二個數
  const p3 = JSON.parse(JSON.stringify(plan));
  p3.confirmGroups.willSend[0].arrangementChanged = false;
  const top3 = ui.buildResendConfirmNodes(p3)[0].textContent;
  check('★★★ 全部都係上次沒有收到 ⇒ 句子只講「2 位是上次正式發出時沒有收到」，唔出「0 位」',
    /當中 2 位是上次正式發出時沒有收到/.test(top3) && !/0 位/.test(top3), top3);

  // 改咗但呢次冇揀嗰段都標「安排改了」＋「這一次不會收到」
  const p4 = JSON.parse(JSON.stringify(plan));
  p4.confirmGroups.changedNotSent = [person({ personId: 'P9890', nameTC: '假九', inChangedList: true, arrangementChanged: true,
    previousSummary: '14/05 領詩', currentSummary: '' })];
  const n4 = ui.buildResendConfirmNodes(p4);
  const sec = n4.map((n) => n.textContent).join('|');
  check('★★★★ 「改了但這一次不會收到」嗰位標「安排改了」同「這一次不會收到」', /假九[\s\S]*安排改了[\s\S]*這一次不會收到|假九[\s\S]*這一次不會收到[\s\S]*安排改了/.test(sec), sec);
}

console.log('\n=== AE：第六十五輪 Y 組結構冇動 ===');
{
  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const body = z1.slice(z1.indexOf('function buildResendConfirmNodes('), z1.indexOf('function openResend('));
  check('★★★★ 仍然係三段（會寄／改了但不寄／未收不寄只出人數）',
    /g\.willSend\.forEach/.test(body) && /g\.changedNotSent\.length > 0/.test(body) && /g\.notReceivedNotSentCount > 0/.test(body));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
