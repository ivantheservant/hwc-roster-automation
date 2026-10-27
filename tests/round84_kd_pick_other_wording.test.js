// 第八十四輪批次 KD 組：〔選擇其他〕嘅窗標題同摘要字眼。
// 執行方式：node tests/round84_kd_pick_other_wording.test.js
//
// 現場（第八十三輪 G15）：〔選擇其他〕窗標題仍寫「寄出：寄給堂委審閱」；只勾「堂委」之後摘要寫
// 「這一次會寄給 6 位：職事表上全部人 6 位」（堂委全部都喺職事表上）。
//
//   KD1　標題：正式發出之前「寄出：選擇其他（審閱本）」；之後「寄出：選擇其他（改動通知）」
//   KD2　只勾堂委 ⇒「堂委 6 位」，冇「職事表上全部人」
//   KD3　組別＋逐個勾 ⇒「堂委 N 位、另外自選 M 位」
//   KD4　自行輸入 ⇒「另外 N 個電郵地址」；同一個人只算一次
//   KD5　真係勾咗「職事表上全部人」先寫「職事表上全部人」
// 下面用假 key，唔涉及真實姓名。

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const ui = loadUiScripts(['Script.html', 'ScriptSendPaper.html']);
const GROUPS = [
  { key: 'ROSTER', label: '職事表上全部人' }, { key: 'COMMITTEE', label: '堂委' },
  { key: 'DEACON', label: '執事' }, { key: 'IT', label: 'IT' },
  { key: 'CLERK', label: '幹事' }, { key: 'CHANGED', label: '只寄給安排有改動的人' }
];
// 職事表上 10 位（r1–r10）；堂委 6 位全部都喺職事表上（r1–r6）；執事 2 位（r5、d1）
const POOL = [];
for (let i = 1; i <= 10; i++) {
  POOL.push({ key: 'r' + i, selectable: true, sources: ['ROSTER'].concat(i <= 6 ? ['COMMITTEE'] : []).concat(i === 5 ? ['DEACON'] : []) });
}
POOL.push({ key: 'd1', selectable: true, sources: ['DEACON'] });
POOL.push({ key: 'nomail', selectable: false, sources: ['ROSTER'] });
const committee = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
function sentence(picked, extraEmails) {
  ui.__pool = POOL; ui.__picked = picked; ui.__extra = extraEmails || []; ui.__groups = GROUPS;
  vm.runInContext('sendPool_ = __pool; sendPoolGroups_ = __groups; sendOptions_ = { pickedKeys: __picked, extraEmails: __extra };', ui);
  return vm.runInContext('describeSendSelection()', ui);
}

console.log('\n=== KD1：〔選擇其他〕窗標題 ===');
check('★★★★★★ KD1 正式發出之前「寄出：選擇其他（審閱本）」', ui.pickOtherSendTitle('REVIEW') === '寄出：選擇其他（審閱本）', ui.pickOtherSendTitle('REVIEW'));
check('★★★★★★ KD1 正式發出之後「寄出：選擇其他（改動通知）」', ui.pickOtherSendTitle('RESEND') === '寄出：選擇其他（改動通知）', ui.pickOtherSendTitle('RESEND'));
{
  // 真係畫出嚟：PICK 模式寄出窗
  const s = { kind: 'REVIEW', latestVersion: { versionNo: 1 }, sendHistory: { batches: [] }, permanentLink: { hasLink: true }, attachOptionNotes: {} };
  vm.runInContext("sendMode_ = 'PICK'; sendPool_ = []; sendPoolGroups_ = []; sendOptions_ = { pickedKeys: [], extraEmails: [], attachType: 'NONE', includeIcs: false };", ui);
  ui.drawSendMain(s);
  check('★★★★★ KD1 PICK 寄出窗標題（審閱本）', ui.document.getElementById('modalTitle').textContent === '寄出：選擇其他（審閱本）',
    ui.document.getElementById('modalTitle').textContent);
  ui.drawSendMain(Object.assign({}, s, { kind: 'RESEND' }));
  check('★★★★★ KD1 PICK 寄出窗標題（改動通知）', ui.document.getElementById('modalTitle').textContent === '寄出：選擇其他（改動通知）',
    ui.document.getElementById('modalTitle').textContent);
  vm.runInContext("sendMode_ = 'ALL';", ui);
  ui.drawSendMain(Object.assign({}, s, { kind: 'OFFICIAL' }));
  check('★★★★ 其他掣照舊（〔給所有人〕＝「寄出：正式發出給全體」）', ui.document.getElementById('modalTitle').textContent === '寄出：正式發出給全體',
    ui.document.getElementById('modalTitle').textContent);
}

console.log('\n=== KD2–KD5：摘要按實際勾選嘅來源 ===');
{
  const t = sentence(committee.slice());
  check('★★★★★★ KD2 只勾堂委 ⇒「這一次會寄給 6 位：堂委 6 位。」', t === '這一次會寄給 6 位：堂委 6 位。', t);
  check('★★★★★★ KD2 冇「職事表上全部人」', t.indexOf('職事表上全部人') === -1, t);
  const t3 = sentence(committee.concat(['r9', 'r10']));
  check('★★★★★★ KD3 組別＋逐個勾 ⇒「堂委 6 位、另外自選 2 位」', t3 === '這一次會寄給 8 位：堂委 6 位、另外自選 2 位。', t3);
  const t4 = sentence(committee.concat(['d1']), ['a@example.invalid', 'b@example.invalid']);
  check('★★★★★★ KD4 自行輸入 ⇒「另外 2 個電郵地址」；同一個人只算一次（r5 又係執事）',
    t4 === '這一次會寄給 9 位：堂委 6 位、另外執事 1 位、另外 2 個電郵地址。', t4);
  const all = POOL.filter((c) => c.selectable && c.sources.indexOf('ROSTER') !== -1).map((c) => c.key);
  const t5 = sentence(all.concat(['d1']));
  check('★★★★★ KD5 真係勾咗「職事表上全部人」先寫佢', t5 === '這一次會寄給 11 位：職事表上全部人 10 位、另外執事 1 位。', t5);
  const t6 = sentence(['r1', 'r7']);
  check('★★★★★ 逐個勾兩位（冇一組全勾）⇒「自選 2 位」', t6 === '這一次會寄給 2 位：自選 2 位。', t6);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
