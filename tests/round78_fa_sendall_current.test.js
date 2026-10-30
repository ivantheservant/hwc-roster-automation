// 第七十八輪批次 FA 組：正式發出之後〔給所有人〕確認窗，每一位都要寫佢現時嘅安排。
// 執行方式：node tests/round78_fa_sendall_current.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十七輪回歸 G23）
// ═════════════════════════════════════════════════════════════════════
//
//   正式發出之後〔給所有人〕→〔寄出〕→「改動後重發（不可逆）」確認窗：「這一次會寄給的
//   54 位」逐人一行，**每一位（包括明明有崗位嘅）都寫「現在：（這一季沒有安排）」**。
//   成因：只有改動名單入面嗰幾位有 `currentSummary`，其餘收件人落空。
//
//   ①〔給所有人〕組出嚟嘅每一位都有 `currentSummary`
//   ② 有崗位嘅人唔會出現「這一季沒有安排」
//   ③ 真係冇崗位嘅人先出現
//   ④〔變動的人〕嗰條路（改動名單）原有行為不變
//   ⑤ 攞唔到資料 ⇒「現在的安排沒有記錄」，唔可以扮冇安排
//
// 下面用假 ID（P97xx）同假名。

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

// 摘要格式用正式嘅 `buildAssignmentSummary_()`；只係 Utilities.formatDate 要有替身
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Mailer.gs', 'WebAppGuards.gs'], {
  Utilities: {
    parseDate: function (s) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    },
    formatDate: function (d) {
      const pad = (n) => String(n).padStart(2, '0');
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
    }
  }
});
gas.getConfig_ = function (key, fallback) { return fallback; };

const context = {
  postNames: { READ: '讀經', USHER1: '司事1' },
  timezone: 'Pacific/Auckland',
  assignmentsByPerson: {
    P9701: [{ serviceDate: '2028-08-13', postId: 'READ' }],
    P9702: [{ serviceDate: '2028-08-06', postId: 'READ' }, { serviceDate: '2028-08-27', postId: 'READ' }],
    P9703: [{ serviceDate: '2028-07-16', postId: 'USHER1' }],
    P9705: []
  }
};

console.log('\n=== FA【核心】這一版每一位嘅現時安排，用同一個 buildAssignmentSummary_() ===');
const now = gas.buildCurrentArrangementByPerson_(context);
{
  check('★★★★★★ 有崗位嘅人都有摘要（同 buildAssignmentSummary_() 一字不差）',
    now.P9702 && now.P9702.hasAssignments === true
      && now.P9702.currentSummary === gas.buildAssignmentSummary_(context.assignmentsByPerson.P9702, context.postNames, context.timezone)
      && /06\/08 讀經/.test(now.P9702.currentSummary) && /27\/08 讀經/.test(now.P9702.currentSummary),
    JSON.stringify(now));
  check('★★★★★ 這一版冇崗位（空陣列）⇒ 唔喺回傳入面', !now.P9705 && !now.P9704, JSON.stringify(now));
}

// 正式發出之後再改咗 1 格：P9701 原本第 9 週讀經，而家換咗人（P9701 改咗；P9704 被整個換走）
const changed = [{
  personId: 'P9701', nameTC: '假一', hasAssignments: true, arrangementChanged: true, hasEmail: true,
  previousSummary: '03/09 讀經', currentSummary: '13/08 讀經'
}, {
  personId: 'P9704', nameTC: '假四', hasAssignments: false, arrangementChanged: true, hasEmail: true,
  previousSummary: '10/09 讀經', currentSummary: ''
}];
const recipients = ['P9701', 'P9702', 'P9703', 'P9704', 'P9706'].map(function (id) {
  return { type: 'PERSON', personId: id, email: id + '@example.invalid', displayName: '名' + id };
}).concat([{ type: 'LIST', personId: '', email: 'office@example.invalid', displayName: '辦公室' }]);

console.log('\n=== FA【核心】〔給所有人〕組出嚟嘅每一位 ===');
const g = gas.buildResendConfirmGroups_(changed, recipients, {}, now);
const byId = {};
g.willSend.forEach(function (c) { if (c.personId) byId[c.personId] = c; });
{
  check('★★★★★★ ① 有崗位嘅每一位都有 currentSummary（唔喺改動名單入面嗰啲都有）',
    ['P9701', 'P9702', 'P9703'].every(function (id) { return byId[id] && byId[id].currentSummary; }),
    JSON.stringify(g.willSend));
  check('★★★★★★ ② 冇改動、有崗位嘅人 hasAssignments=true，摘要＝這一版',
    byId.P9702.hasAssignments === true && byId.P9702.currentSummary === now.P9702.currentSummary
      && byId.P9703.hasAssignments === true && byId.P9703.inChangedList === false,
    JSON.stringify([byId.P9702, byId.P9703]));
  check('★★★★★ ③ 這一版真係冇崗位（P9706 唔喺 assignmentsByPerson）⇒ hasAssignments=false',
    byId.P9706.hasAssignments === false && byId.P9706.currentSummary === '', JSON.stringify(byId.P9706));
  check('★★★★★ ④ 改動名單嗰兩位照用佢哋自己嘅資料（原本／現在、被換走）',
    byId.P9701.arrangementChanged === true && byId.P9701.currentSummary === '13/08 讀經'
      && byId.P9701.previousSummary === '03/09 讀經'
      && byId.P9704.hasAssignments === false && byId.P9704.arrangementChanged === true,
    JSON.stringify([byId.P9701, byId.P9704]));
  const list = g.willSend.filter(function (c) { return c.isListRecipient; });
  check('★★★★ 名單收件人唔使摘要', list.length === 1 && list[0].currentSummary === '', JSON.stringify(list));
  const blind = gas.buildResendConfirmGroups_(changed, recipients, {});
  const p2 = blind.willSend.filter(function (c) { return c.personId === 'P9702'; })[0];
  check('★★★★★ ⑤ 冇傳「現在」資料 ⇒ hasAssignments=null（唔知），唔係 false',
    p2.hasAssignments === null && p2.currentSummary === '', JSON.stringify(p2));
}

console.log('\n=== FA【核心】畫面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const plan = { mode: 'HAS_CHANGES', sendMode: 'ALL', changed: changed, recipientCount: recipients.length,
    confirmGroups: g, contents: { attachLine: '附件：不附', icsLine: '日曆檔：不附' } };
  const nodes = ui.buildResendConfirmNodes(plan);
  const rows = nodes[1].children;
  const rowOf = (name) => rows.filter(function (r) { return r.textContent.indexOf(name) === 0; })[0];
  const r2 = rowOf('名P9702');
  const r3 = rowOf('名P9703');
  const r6 = rowOf('名P9706');
  const r1 = rowOf('名P9701');
  check('★★★★★★ ② 有崗位嘅人寫現時安排，唔寫「這一季沒有安排」',
    r2 && /現在：06\/08 讀經/.test(r2.textContent) && !/這一季沒有安排/.test(r2.textContent)
      && r3 && /現在：16\/07 司事1/.test(r3.textContent) && !/這一季沒有安排/.test(r3.textContent),
    r2 && r2.textContent);
  check('★★★★★ 冇改動嘅人：「安排沒有改動」＋現時安排，冇「原本」',
    /安排沒有改動/.test(r2.textContent) && !/原本：/.test(r2.textContent), r2.textContent);
  check('★★★★★ ③ 真係冇崗位嘅人先寫「這一季沒有安排」', r6 && /現在：這一季沒有安排/.test(r6.textContent),
    r6 && r6.textContent);
  check('★★★★★ ④ 改動嘅人照舊「原本／現在」',
    r1 && /原本：03\/09 讀經/.test(r1.textContent) && /現在：13\/08 讀經/.test(r1.textContent)
      && !/安排沒有改動/.test(r1.textContent), r1 && r1.textContent);
  const withAssignments = rows.filter(function (r) { return /名P970[123]/.test(r.textContent); });
  check('★★★★★★ 有崗位嘅三位，冇一位寫「這一季沒有安排」',
    withAssignments.length === 3 && withAssignments.every(function (r) { return !/這一季沒有安排/.test(r.textContent); }),
    withAssignments.map(function (r) { return r.textContent; }).join(' | '));

  const blindNodes = ui.buildResendConfirmNodes(Object.assign({}, plan,
    { confirmGroups: gas.buildResendConfirmGroups_(changed, recipients, {}) }));
  const b2 = blindNodes[1].children.filter(function (r) { return r.textContent.indexOf('名P9702') === 0; })[0];
  check('★★★★★ ⑤ 攞唔到資料 ⇒「現在的安排沒有記錄」，唔扮冇安排',
    b2 && /現在：（現在的安排沒有記錄）/.test(b2.textContent) && !/這一季沒有安排/.test(b2.textContent),
    b2 && b2.textContent);
}

console.log('\n=== FA：後端接駁 ===');
{
  const guards = read('src/WebAppGuards.gs');
  const plan = guards.slice(guards.indexOf('function planResendChangedPersons_('), guards.indexOf('function buildCurrentArrangementByPerson_('));
  check('★★★★★ planResendChangedPersons_() 回傳每一位嘅現時安排',
    /currentByPerson: buildCurrentArrangementByPerson_\(context\)/.test(plan), plan.slice(-400));
  const flow = read('src/WebAppFlow.gs');
  const fn = flow.slice(flow.indexOf('function apiStep5Plan('), flow.indexOf('function apiStep5Decline('));
  check('★★★★★★ apiStep5Plan() 把佢傳入確認窗分組',
    /buildResendConfirmGroups_\(changedPlan\.changed, recipients,\s*\n\s*readResendChangeNotes_\(quarterId, changedPlan\.versionNo\), changedPlan\.currentByPerson\)/.test(fn),
    fn.slice(0, 600));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
