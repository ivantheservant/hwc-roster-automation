// 第六十五輪批次 Y 組：改動後重發確認框把全部「上次沒有收到」的人逐個列出。
// 執行方式：node tests/resend_confirm_groups.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 回歸測試 R1.2、R4.20）
// ═════════════════════════════════════════════════════════════════════
//
//   確認框「上次正式發出時沒有收到的 54 位」逐人一行「現在：……」，整個框要捲好長
//   先見到輸入格；真正會收到信嘅兩個接手人藏喺嗰 54 人入面；「安排有改動」一段
//   只得失去兩格嗰一位。
//
// 場景：部分寄出 → 改 2 格 → 只揀 3 位（失去兩格嗰位＋兩個接手人）。
// 下面用假 ID（P96xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
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

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'WebAppGuards.gs']);

// 失去兩格嗰位（有舊 hash、零派工）
const changed = [{
  personId: 'P9601', nameTC: '假一', hasAssignments: false, arrangementChanged: true, hasEmail: true,
  previousSummary: '14/05 領詩；11/06 領詩', currentSummary: ''
}, {
  personId: 'P9602', nameTC: '假二', hasAssignments: true, arrangementChanged: false, hasEmail: true,
  previousSummary: '', currentSummary: '14/05 領詩'
}, {
  personId: 'P9603', nameTC: '假三', hasAssignments: true, arrangementChanged: false, hasEmail: true,
  previousSummary: '', currentSummary: '11/06 領詩'
}, {
  // 安排真係改咗，但這一次冇揀
  personId: 'P9690', nameTC: '假九十', hasAssignments: true, arrangementChanged: true, hasEmail: true,
  previousSummary: '02/04 讀經', currentSummary: '09/04 讀經'
}];
for (let i = 4; i < 54; i++) {
  const id = 'P96' + String(i).padStart(2, '0');
  changed.push({ personId: id, nameTC: '未收' + i, hasAssignments: true, arrangementChanged: false,
    hasEmail: true, previousSummary: '', currentSummary: '01/01 司事' });
}
const recipients = ['P9601', 'P9602', 'P9603'].map(function (id) {
  return { type: 'PERSON', personId: id, email: id + '@example.invalid', displayName: '' };
});
const notes = {
  P9601: ['5 月 14 日　領詩（換走了，改為 假二）', '6 月 11 日　領詩（換走了，改為 假三）'],
  P9602: ['5 月 14 日　領詩（新增，本來是 假一）'],
  P9603: ['6 月 11 日　領詩（新增，本來是 假一）']
};

// =====================================================================
console.log('\n=== Y【核心】後端分組：會寄 3 位逐個；唔寄嘅未收人只有計數 ===');
const g = gas.buildResendConfirmGroups_(changed, recipients, notes);
{
  check('★★★★★★ 會寄嘅 ＝ 3 位（同收件人解析器一樣）',
    g.willSend.length === 3 && g.willSend.map(function (c) { return c.personId; }).join() === 'P9601,P9602,P9603',
    JSON.stringify(g.willSend.map(function (c) { return c.personId; })));
  check('★★★★★★ 上次冇收到、這一次都唔寄 ⇒ 只係人數 50（唔逐個列入任何一段）',
    g.notReceivedNotSentCount === 50 && g.changedNotSent.every(function (c) { return !/^未收/.test(c.nameTC); }),
    g.notReceivedNotSentCount);
  check('★★★★★ 安排改咗但冇揀嘅（P9690）獨立一段', g.changedNotSent.length === 1 && g.changedNotSent[0].personId === 'P9690',
    JSON.stringify(g.changedNotSent));
  const two = g.willSend[1];
  check('★★★★★ 接手人（冇舊 hash）帶收件人頁同一份 changeNotes',
    two.arrangementChanged === false && two.changeNotes[0] === '5 月 14 日　領詩（新增，本來是 假一）', JSON.stringify(two));
  check('★★★★ 失去兩格嗰位係「安排改了」、零派工', g.willSend[0].arrangementChanged === true && g.willSend[0].hasAssignments === false);
  check('★★★★ 名單收件人標明', gas.buildResendConfirmGroups_(changed,
    [{ type: 'LIST', personId: '', email: 'office@example.invalid', displayName: '教會辦公室' }], {}).willSend[0].isListRecipient === true);
}

console.log('\n=== Y【核心】畫面：逐個列出嘅人 ＝ 3，未收人只有一行計數 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const plan = { mode: 'HAS_CHANGES', changed: changed, recipientCount: 3, confirmGroups: g,
    contents: { attachLine: '附件：個人版 PDF', icsLine: '日曆檔：附 .ics 日曆檔' } };
  const nodes = ui.buildResendConfirmNodes(plan);
  const top = nodes[0];
  const list = nodes[1];
  check('★★★★★★ 最上面一段係「這一次會寄給的 3 位」', /這一次會寄給的 3 位/.test(top.textContent), top.textContent);
  check('★★★★★★ 跟住嗰段逐個列 3 個人', list.children.length === 3, list.children.length);
  check('★★★★★ 接手人寫佢嘅改動（版本比較）', /改動：5 月 14 日　領詩（新增，本來是 假一）/.test(list.textContent), list.textContent);
  check('★★★★★ 失去兩格嗰位：原本／現在：這一季沒有安排',
    /原本：14\/05 領詩；11\/06 領詩/.test(list.textContent) && /現在：這一季沒有安排/.test(list.textContent), list.textContent);
  // 第六十六輪批次 AE 組：段首句嘅數字改為由下面實際列出嘅 3 位出（1 位安排改了、2 位上次沒有收到），
  // 唔再寫「這 N 個人的安排改了」同標題對唔上
  check('★★★★ 段首句同下面列出嘅 3 位對得上（1 位安排改了、2 位上次沒有收到）',
    /當中 1 位是自上次發出之後安排改了、2 位是上次正式發出時沒有收到/.test(top.textContent)
      && !/個人的安排改了/.test(top.textContent), top.textContent);

  // 收埋喺〔顯示名單〕(details) 入面嘅唔計
  function textOutsideDetails(node) {
    if (node.tagName === 'DETAILS') return '';
    if (node.children.length === 0) return node.textContent;
    return node._text + node.children.map(textOutsideDetails).join('');
  }
  const visible = nodes.map(textOutsideDetails).join('｜');
  check('★★★★★★ 未收人嘅名一個都冇攤開（只喺收埋嘅名單入面）', !/未收\d+/.test(visible), visible.slice(0, 600));
  check('★★★★★★ 只出一行計數＋指去補寄', /另外 50 位上次正式發出時沒有收到，這一次也不會寄給他們/.test(visible)
    && /補寄未收到的人/.test(visible), visible.slice(-300));
  check('★★★★★ 改咗但冇揀嘅人逐個列、寫明「這一次不會收到」',
    /這 1 位的安排改了，但這一次不會收到/.test(visible) && /假九十/.test(visible) && /這一次不會收到/.test(visible), visible);
  const all = nodes.map(function (n) { return n.textContent; }).join('');
  check('★★★★ 名單仍然睇得到（〔顯示名單〕入面）', /未收4/.test(all) && /顯示名單/.test(all));
  const sendAt = visible.indexOf('這一次會寄給的 3 位');
  const countAt = visible.indexOf('另外 50 位');
  check('★★★★★ 「會寄給這 N 位」同輸入格之間冇夾住長名單（最尾只係一行計數）',
    sendAt === 0 && countAt > sendAt && visible.length - countAt < 120, String(visible.length - countAt));
}

console.log('\n=== Y：後端接駁 ===');
{
  const flow = read('src/WebAppFlow.gs');
  const fn = flow.slice(flow.indexOf('function apiStep5Plan('), flow.indexOf('function apiStep5Decline('));
  check('★★★★★ apiStep5Plan() 用同一份收件人解析結果分組，帶 changeNotes',
    // 第七十八輪批次 FA 組：多咗第 4 個參數（每一位嘅現時安排）
    /confirmGroups = buildResendConfirmGroups_\(changedPlan\.changed, recipients,\s*\n\s*readResendChangeNotes_\(quarterId, changedPlan\.versionNo\), changedPlan\.currentByPerson\)/.test(fn)
      && /confirmGroups: confirmGroups/.test(fn), fn.slice(0, 400));
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★ openResend() 用 buildResendConfirmNodes()', /const nodes = buildResendConfirmNodes\(plan\);/.test(z1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
