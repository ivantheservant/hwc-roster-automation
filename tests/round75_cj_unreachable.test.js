// 第七十五輪批次 CJ 組：寄出時列出收不到電郵的人。
// 執行方式：node tests/round75_cj_unreachable.test.js
//
// Ivan 例子：主席填了臨時幫手「ivan」，寄出時會不會提示沒有他的電郵？
//
//   CJ1　由版本紀錄數：有 PersonID 但冇電郵 ⇒ 列名；系統排嘅崗位上嘅臨時幫手 ⇒ 列名；
//        人手填崗位上唔喺名單嘅名（外請講員）⇒ 唔列名，只數
//   CJ2　寄給堂委審閱、正式發出：確認窗同完成窗嘅資料都帶住（後端）
//   CJ3　畫面：「這幾位收不到電郵」逐個列；「另有 N 個名字不在名單上（例如外請講員），不會通知」；
//        提示用第 4 步印紙本；查唔到 ⇒ 講「查不到」

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);

sc.setCell(0, D[2], 'CHAIR#1', 'ivan');                    // 臨時幫手（系統排嘅崗位）
sc.setCell(0, D[0], 'PREACH#1', 'Rev Wong');               // 外請講員（人手崗位）
sc.setCell(0, D[1], 'PREACH#1', 'Rev Wong');               // 同一個名兩次 ⇒ 都係 1 個名
sc.setCell(0, D[3], 'PREACH#1', 'Pastor Lee');
sc.setCell(0, D[1], 'CHAIR#1', sc.nameOf('P9707'));        // 名單上但冇電郵
sc.setCell(0, D[3], 'CHAIR#1', sc.nameOf('P9707'));        // 同一個人兩格 ⇒ 都係列一次
gas.apiSetCellDecisions(sc.Q, [
  { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }
]);
const plan = gas.apiSaveAndConfirmPlan(sc.Q);
if (plan.needsDecision) {
  gas.apiSetCellDecisions(sc.Q, (plan.decisionItems.rules || []).map((r) => Object.assign({}, r, { checked: true })));
}
const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）儲存成第 1 版', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 400));

console.log('\n=== CJ1：數邊幾位收唔到 ===');
{
  const u = gas.buildUnreachablePeople_(sc.Q, null);
  const names = u.people.map((p) => p.name + '／' + p.reason);
  check('★★★★★★ 臨時幫手 ivan 列出', names.indexOf('ivan／臨時幫手') !== -1, JSON.stringify(u));
  check('★★★★★★ 名單上冇電郵嘅人列出', names.indexOf(sc.nameOf('P9707') + '／沒有電郵') !== -1, JSON.stringify(u));
  check('★★★★★ 有電郵嘅人唔列', u.people.every((p) => ['ivan', sc.nameOf('P9707')].indexOf(p.name) !== -1), JSON.stringify(u));
  check('★★★★★ 同一個人唔重複列', names.length === new Set(names).size, JSON.stringify(names));
  check('★★★★★★ 外請講員唔列名，只數（兩個唔同嘅名）', u.externalNameCount === 2
    && !u.people.some((p) => /Rev Wong|Pastor Lee/.test(p.name)), JSON.stringify(u));
  check('★★★★ 冇出錯', u.error === '');
}

console.log('\n=== CJ2：確認窗／完成窗都帶住 ===');
{
  // 收件人解析唔係呢組嘅事 ⇒ 換走，淨係驗「有冇帶住 unreachable」
  gas.planStep2_ = function () { return { versionNo: 1, recipientCount: 1 }; };
  gas.planStep4SendPreview_ = function () { return { recipientCount: 1 }; };
  const preview = gas.apiStep2Preview(sc.Q, null);
  check('★★★★★★ 寄給堂委審閱：確認窗資料帶住', preview.unreachable && preview.unreachable.people.length === 2,
    JSON.stringify(preview.unreachable));
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const confirm2 = src.slice(src.indexOf('function apiStep2Confirm_locked_('), src.indexOf('function apiStep3Plan('));
  check('★★★★★ 寄給堂委審閱：完成窗資料帶住', /unreachable: buildUnreachablePeople_\(quarterId, null\)/.test(confirm2));
  const p4 = gas.apiStep4GetSendPreview(sc.Q, 1, null);
  check('★★★★★ 正式發出：確認窗資料帶住', p4.unreachable && p4.unreachable.people.length === 2, JSON.stringify(p4.unreachable));
  const confirm4 = src.slice(src.indexOf('function apiStep4Confirm_locked_('), src.indexOf('function apiStep5Plan('));
  check('★★★★★ 正式發出：完成窗資料帶住', /unreachable: buildUnreachablePeople_\(quarterId, null\)/.test(confirm4));

  const realRead = gas.readVersionAssignmentsForGrid_;
  gas.readVersionAssignmentsForGrid_ = function () { throw new Error('讀不到'); };
  const bad = gas.buildUnreachablePeople_(sc.Q, null);
  gas.readVersionAssignmentsForGrid_ = realRead;
  check('★★★★★ 讀唔到 ⇒ error（唔可以當全部收到）', bad.error === '讀不到' && bad.people.length === 0, JSON.stringify(bad));
}

console.log('\n=== CJ3：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  vm.runInContext('closeModalAndRefresh = async function () { closeModal(); };', ui);
  const U = { people: [{ name: 'ivan', reason: '臨時幫手' }, { name: '假庚', reason: '沒有電郵' }], externalNameCount: 2, error: '' };
  const root = new ui.__StubNode('div');
  ui.buildUnreachableNodes(U).forEach((n) => root.appendChild(n));
  const t = root.textContent;
  check('★★★★★★ 「這幾位收不到電郵」逐個列（連原因）', /這幾位收不到電郵/.test(t) && /ivan（臨時幫手）/.test(t) && /假庚（沒有電郵）/.test(t), t);
  check('★★★★★★ 「另有 2 個名字不在名單上（例如外請講員），不會通知」',
    t.indexOf('另有 2 個名字不在名單上（例如外請講員），不會通知') !== -1, t);
  check('★★★★★ 提示用第 4 步印紙本', /第 4 步〔下載及匯出〕印紙本/.test(t), t);
  const empty = new ui.__StubNode('div');
  ui.buildUnreachableNodes({ people: [], externalNameCount: 0, error: '' }).forEach((n) => empty.appendChild(n));
  check('★★★★ 全部收到 ⇒ 乜都唔顯示', empty.textContent === '', empty.textContent);
  const err = new ui.__StubNode('div');
  ui.buildUnreachableNodes({ people: [], externalNameCount: 0, error: 'x' }).forEach((n) => err.appendChild(n));
  check('★★★★★ 查唔到 ⇒ 講「查不到」', /查不到/.test(err.textContent), err.textContent);

  // 寄給堂委審閱：確認窗＋完成窗都顯示
  const calls = [];
  vm.runInContext('getDashboard = async function () { return { publicLink: { hasLink: true }, isDryRun: true, '
    + 'buttons: { review: { lastSentAt: "" } }, preQuarter: { undoneItemCount: 0, items: [] } }; };', ui);
  ui.callServer = async (name) => {
    calls.push(name);
    return { recipientCount: 1, recipientPreview: { total: 1, shown: [{ displayName: '堂委甲', hasEmail: true }], moreCount: 0 }, versionNo: 1, unreachable: U, sendWarnings: null };
  };
  ui.callServerMutating = async (name) => {
    calls.push(name);
    return { isDryRun: true, sent: 0, dryRun: 1, skipped: 0, unreachable: U };
  };
  ui.openReview(null, null);
  const tick = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  await tick();
  const body = () => ui.document.getElementById('modalBody').textContent;
  check('★★★★★★ 寄給堂委審閱確認窗列出 ivan', /這幾位收不到電郵/.test(body()) && /ivan（臨時幫手）/.test(body())
    && /另有 2 個名字不在名單上/.test(body()), body().slice(0, 500));
  const ok = ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '確定寄出')[0];
  ok.fire('click');
  await tick();
  check('★★★★★★ 完成窗同樣列出', ui.document.getElementById('modalTitle').textContent === '寄給堂委審閱：完成'
    && /這幾位收不到電郵/.test(body()) && /ivan（臨時幫手）/.test(body()), body().slice(0, 500));

  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  check('★★★★★ 正式發出確認窗＋完成窗都用同一個元件',
    (z1.match(/buildUnreachableNodes\(preview\.unreachable\)/g) || []).length === 2
      && (z1.match(/buildUnreachableNodes\(r\.unreachable\)/g) || []).length === 2);

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
