// 第六十四輪批次 V 組：改動後重發，只為「真正會收到信」嘅人產生個人 PDF。
// 執行方式：node tests/resend_pdf_targets.test.js
//
// 現場：正式發出只寄咗 2 位（2028T2 v2），之後改 2 格存成 v3。`computeResendDiff_()`
// 把其餘沒有舊 hash 嘅人全部列入 changedList，幹事只揀 3 位寄，卻要先等系統為五十多人
// 產生 PDF（實測約 10 分鐘）。`apiStep5GeneratePdfs()` 用全部 changedList，唔理幹事揀咗邊個。
//
// 用假 ID（P97xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SendOptions.gs', 'SendRecipients.gs', 'ResendFlow.gs',
  'FiveStageCore.gs', 'MutationLock.gs', 'WebAppGuards.gs', 'WebAppFlow.gs'
]);

gas.findEmailTemplateById_ = function (id) {
  return { templateId: id, attachType: id === 'TPL_RESEND_TC' ? 'PERSONAL_PDF' : 'NONE' };
};
gas.findEmailTemplate_ = function () { return gas.findEmailTemplateById_('TPL_RESEND_TC'); };
gas.assertWebAppRequestAllowed_ = function () {};
gas.log_ = function () {};

const cell = function (d) { return [{ serviceDate: d, postId: 'READ', slotIndex: 1 }]; };
// P9701–P9706：changedList 有 6 位（只寄過 P9701、P9702，其餘冇舊 hash）。
// P9704 係零派工（被整個換走）。
const ids = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9706'];
const context = {
  assignmentsByPerson: {
    P9701: cell('2099-01-04'), P9702: cell('2099-01-11'), P9703: cell('2099-01-18'),
    P9705: cell('2099-01-25'), P9706: cell('2099-02-01'), P9707: cell('2099-02-08')
  },
  lastHashByPerson: { P9701: 'h1', P9702: 'h2', P9704: 'h4' },
  peopleById: {},
  notifyReasonByPerson: {}
};
ids.concat(['P9707']).forEach(function (id) {
  context.peopleById[id] = { personId: id, nameTC: '假' + id.slice(-1), email: id.toLowerCase() + '@example.invalid' };
});

console.log('\n=== V【核心】部分寄出 → 只揀 3 位 ⇒ 要產 PDF 嘅只係嗰 3 位當中有派工嘅 ===');
{
  const picked = { recipientScope: 'PICK', pickedKeys: ['P9703', 'P9704', 'P9705'] };
  const t = gas.listResendPdfTargetPersonIds_(context, picked, ids);
  check('★★★★★★ 只有 P9703、P9705（P9704 零派工唔使 PDF；其餘 3 位冇揀）',
    same(t, ['P9703', 'P9705']), JSON.stringify(t));
  check('★★★★★ 預覽性質：冇寫 notifyReasonByPerson（睇一眼唔可以改變寄出結果）',
    Object.keys(context.notifyReasonByPerson).length === 0, JSON.stringify(context.notifyReasonByPerson));
}

console.log('\n=== V：幹事指定一個唔喺 changedList 嘅人 ===');
{
  const t = gas.listResendPdfTargetPersonIds_(context,
    { recipientScope: 'PICK', pickedKeys: ['P9707'] }, ids);
  check('★★★★★ 照寄、所以亦要產 PDF（同 sendResendStage_ 一致）', same(t, ['P9707']), JSON.stringify(t));
  check('★★★★★ 指定咗 changedList 以外嘅人，預覽都冇寫 notifyReasonByPerson',
    Object.keys(context.notifyReasonByPerson).length === 0, JSON.stringify(context.notifyReasonByPerson));
}

console.log('\n=== V：附件選「不附」⇒ 名單為空 ===');
{
  const t = gas.listResendPdfTargetPersonIds_(context,
    { recipientScope: 'PICK', pickedKeys: ['P9703', 'P9705'], attachType: 'NONE' }, ids);
  check('★★★★★★ 一份都唔使產', same(t, []), JSON.stringify(t));
  const t2 = gas.listResendPdfTargetPersonIds_(context,
    { recipientScope: 'CHANGED_ONLY', attachType: 'FULL_PDF' }, ids);
  check('★★★★ 整季 PDF 一樣唔使個人版', same(t2, []), JSON.stringify(t2));
}

console.log('\n=== V：冇傳 sendOptions（選單／舊呼叫端）⇒ 同以前一樣 ===');
{
  const t = gas.listResendPdfTargetPersonIds_(context, null, ids);
  check('★★★★★ changedList 入面有派工嘅人（5 位，唔含零派工）',
    same(t, ['P9701', 'P9702', 'P9703', 'P9705', 'P9706']), JSON.stringify(t));
}

console.log('\n=== V：接駁（apiStep5GeneratePdfs → executeStep5GeneratePdfs_）===');
{
  let given = null;
  gas.generatePersonalPdfBatchForPeople_ = function (q, v, people) { given = people; return { done: true, doneCount: people.length, totalPeople: people.length }; };
  gas.executeStep5GeneratePdfs_('2099T1', 1, ids.map(function (id) { return { personId: id, hasAssignments: true }; }), ['P9703']);
  check('★★★★★★ 指定名單先用指定名單', same(given, ['P9703']), JSON.stringify(given));
  gas.executeStep5GeneratePdfs_('2099T1', 1, [{ personId: 'P9701', hasAssignments: true }, { personId: 'P9704', hasAssignments: false }]);
  check('★★★★ 冇指定（選單版本）⇒ 全部 changedList 有派工嘅人', same(given, ['P9701']), JSON.stringify(given));
  given = 'untouched';
  const r = gas.executeStep5GeneratePdfs_('2099T1', 1, [{ personId: 'P9701', hasAssignments: true }], []);
  check('★★★★★ 指定空名單 ⇒ 一份都唔產（唔可以退回全部）', given === 'untouched' && r.done === true && r.totalPeople === 0, JSON.stringify(r));
}

console.log('\n=== V：api 同前端有接駁 ===');
{
  const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const fn = flow.slice(flow.indexOf('function apiStep5GeneratePdfs_locked_('), flow.indexOf('function apiStep5SendPreview('));
  check('★★★★★★ api 用 listResendPdfTargetPersonIds_ 算名單並傳落去',
    /listResendPdfTargetPersonIds_\(\s*changed\.context, sendOptions,/.test(fn)
    && /executeStep5GeneratePdfs_\(\s*quarterId, changed\.versionNo, changed\.changedList, pdfTargets\)/.test(fn), fn);
  check('★★★★★ 薄殼同 locked 都收 sendOptions',
    /function apiStep5GeneratePdfs\(quarterId, releaseText, sendOptions\)/.test(flow)
    && /apiStep5GeneratePdfs_locked_\(quarterId, releaseText, sendOptions\)/.test(flow));
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const uiFn = ui.slice(ui.indexOf('async function resendGeneratePdfsThenSend('));
  const body = uiFn.slice(0, uiFn.indexOf('\n  }\n'));
  check('★★★★★★ 前端用 plainObjectOrNull_ 收好 sendOpts 先傳（兩個呼叫都用同一個變數）',
    /const sendOpts = plainObjectOrNull_\(sendOptions\);/.test(body)
    && /'apiStep5GeneratePdfs', currentQuarterId, releaseText, sendOpts\)/.test(body)
    && /'apiStep5SendConfirm', currentQuarterId, releaseText, sendOpts\)/.test(body), body.slice(0, 500));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
