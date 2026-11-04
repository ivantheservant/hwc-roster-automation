// 第一百零四輪批次 PA 組：〔儲存〕確認窗的勾選不會遺失。
// 執行方式：node tests/round104_pa_decisions_save.test.js
//
// 現場（週報測試季度）：確認窗列出 41 格「違反規則的格」，每勾一格即時呼叫 apiSetCellDecisions（全域鎖、
// 每次幾秒、排隊逐個寫）。連續快速勾 ⇒ 大部分停在「記錄中……」；按〔儲存〕⇒「還有 31 格……你還沒有決定」；
// 〔儲存〕進行中再勾 ⇒ 撞鎖「記不住你的選擇」。
//
// 做法：確認窗的勾選只改畫面（deferred），按〔儲存〕時把全部決定連同儲存請求一次過送；
// 後端 apiSaveAndConfirmExecute 在同一個鎖之內先記錄決定（recordCellDecisions_）再重新 plan、儲存。
// 〔檢查我的改動〕仍然即時記住，但排緊隊的合併成一批送（連續勾 40 格最多兩、三次呼叫）。
//
//   PA1　後端：決定連同儲存一次過送 ⇒ 一次成功；決定寫入 CellDecisions（AuditLog 來源 apiSaveAndConfirmExecute）
//   PA2　後端：只送一部分 ⇒ 照舊擋住、一格都唔寫（版本冇增加）
//   PA3　確認窗（deferred）：快速勾 40 格 ⇒ 一次都冇呼叫伺服器；全部決定咗〔儲存〕先著
//   PA4　確認窗：頂部〔全部勾選〕→ 取消 3 格 → 快速勾返 ⇒〔儲存〕一次過送齊 40 格＋臨時幫手
//   PA5　〔全部勾選〕頂部、底部各一粒；全部已勾 ⇒ 兩粒都變〔全部取消〕，撳落去全部取消（唔使確認）
//   PA6　〔檢查我的改動〕（即時）：快速勾 40 格 ⇒ 合併成少數幾次呼叫、全部記住、旁邊寫「已記錄」，冇停喺「記錄中」
//   PA7　即時記住失敗 ⇒ 嗰一格旁邊紅字、保持未勾
//   PA8　Esc：焦點喺下拉選單／輸入框 ⇒ 唔關窗；勾選框、其他 ⇒ 照舊關

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

// ─────────────────────────── 後端 ───────────────────────────
console.log('\n=== PA1／PA2：決定連同儲存一次過送 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const gas = sc.gas;
  const D = sc.DATES;
  gas.apiGenerateDraftExecute(sc.Q);
  sc.setCell(0, D[2], 'CHAIR#1', 'ivan');                 // 名單上找不到（臨時幫手）
  sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));   // 唔喺領詩名單（一定要遵守）
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（前置）needsDecision：1 個名＋至少 1 格一定要遵守', plan.needsDecision === true
    && plan.decisionItems.names.length === 1 && plan.decisionItems.rules.length >= 1, JSON.stringify(plan.decisionItems));
  const toPayload = (it) => ({ serviceDate: it.serviceDate, postId: it.postId, slotIndex: it.slotIndex,
    kind: it.kind, cellText: it.cellText, ruleId: it.ruleId || '', checked: true });
  const all = plan.decisionItems.names.concat(plan.decisionItems.rules).map(toPayload);

  // PA2：只送名，唔送一定要遵守 ⇒ 擋
  let threw = null;
  try {
    gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [], cellDecisions: all.slice(0, 1) });
  } catch (e) { threw = e; }
  check('★★★★★★ PA2：只送一部分 ⇒ 照舊擋住（還沒有決定）', threw && /你還沒有決定/.test(threw.message), threw && threw.message);
  check('★★★★★ PA2：冇建立版本', gas.findLatestVersionNo_(sc.Q) === 0);

  // PA1：全部一次過送
  const auditBefore = gas.readSheet_(sc.S.AUDIT_LOG).length;
  const res = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [], cellDecisions: all });
  check('★★★★★★ PA1：一次成功成為第 1 版', res.ok === true && res.versionNo === 1, JSON.stringify(res).slice(0, 300));
  const audit = gas.readSheet_(sc.S.AUDIT_LOG).slice(auditBefore)
    .filter((x) => x[sc.C.AUDIT_LOG.ACTION] === 'CELL_DECISIONS_SET');
  check('★★★★★ PA1：決定寫入紀錄，來源是〔儲存〕那一次', audit.length === 1
    && audit[0][sc.C.AUDIT_LOG.SOURCE] === 'apiSaveAndConfirmExecute', JSON.stringify(audit));
  const chair = sc.cellRow(1, D[2], 'CHAIR');
  check('★★★★★★ PA1：臨時幫手只存名字', !chair[sc.A.PERSON_ID] && chair[sc.A.PERSON_NAME_SNAPSHOT] === 'ivan', JSON.stringify(chair));
  check('★★★★★ PA1：放行紀錄照舊寫（整季記住）', res.releasedViolationCount >= 1, String(res.releasedViolationCount));
}

// ─────────────────────────── 前端 ───────────────────────────
const UI_FILES = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];
const tick = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const inputsOf = (node) => node.flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
const buttonsOf = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON');
const btns = (node, re) => buttonsOf(node).filter((b) => re.test(b.textContent));
const btn = (node, text) => buttonsOf(node).filter((b) => b.textContent === text)[0];

function rule(i) {
  const d = '2099-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0');
  return { kind: 'KEEP', key: d + '|CHAIR|1', serviceDate: d, postId: 'CHAIR', postNameTC: '主席', slotIndex: 1,
    cellText: '假' + i, personName: '假' + i, ruleId: 'HARD_ELIGIBILITY', severity: 'HARD', mustFollow: true,
    reason: '不在名單', released: false, checked: false };
}
const NAME = { kind: 'TEMP_HELPER', key: '2099-12-27|READ|1', serviceDate: '2099-12-27', postId: 'READ',
  postNameTC: '讀經', slotIndex: 1, cellText: 'ivan', text: 'ivan', checked: false };
const RULES40 = Array.from({ length: 40 }, (_, i) => rule(i));

function newUi(behaviour) {
  const ui = loadUiScripts(UI_FILES);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  const log = { calls: [], active: 0, maxActive: 0 };
  ui.waitMs = () => Promise.resolve();
  ui.setInterval = () => 0;      // 忙碌牌嘅計時（唔影響結果）
  ui.clearInterval = () => {};
  ui.callServerMutating = async (name, q, payload) => {
    log.active++;
    log.maxActive = Math.max(log.maxActive, log.active);
    log.calls.push({ name, payload: JSON.parse(JSON.stringify(payload || null)) });
    await new Promise((r) => setImmediate(r));
    log.active--;
    const r = behaviour ? behaviour(name, payload, log.calls.length) : null;
    if (r instanceof Error) throw r;
    if (name === 'apiSaveAndConfirmExecute') return { ok: true, zeroChange: true, message: '已儲存' };
    return { ok: true, written: (payload || []).length };
  };
  return { ui, log };
}

function savePlan(rules, names) {
  return {
    blocked: false, zeroChange: false, targetVersionNo: 2, baseVersionNo: 1, stage: 'DRAFT',
    gridChanges: [], requests: { apply: [], confirm: [], needsInput: [] }, overlaps: [], blankCells: [],
    violations: { real: rules, kept: [], released: [], structural: [], semiHard: [], semiKept: [] },
    unresolved: names, tempHelpers: [],
    decisionItems: { names: names, rules: rules },
    needsDecision: true, keptCount: 0, needsRelease: false, proposals: []
  };
}

(async () => {
  console.log('\n=== PA3：確認窗（deferred）快速勾 40 格 ===');
  {
    const { ui, log } = newUi();
    let changed = 0;
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify({ names: [], rules: RULES40 })),
      { deferred: true, onChanged: () => { changed++; } });
    const root = ui.document.createElement('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const cbs = inputsOf(root);
    check('（前置）40 個勾選框', cbs.length === 40, String(cbs.length));
    cbs.forEach((c) => { c.checked = true; c.fire('change'); });
    await tick();
    check('★★★★★★ 一次都冇即時呼叫伺服器', log.calls.length === 0, JSON.stringify(log.calls.map((c) => c.name)));
    check('★★★★★★ 冇任何一格寫「記錄中」', !/記錄中/.test(root.textContent), root.textContent.slice(0, 200));
    check('★★★★★ 全部決定咗', d.allDecided() === true && changed >= 40);
    const p = d.pendingPayloads();
    check('★★★★★★ pendingPayloads：40 項、全部 checked', p.length === 40 && p.every((x) => x.checked === true), String(p.length));
    cbs[0].checked = false; cbs[0].fire('change');
    check('★★★★★ 取消一格 ⇒ 未全部決定、待送 39 項', d.allDecided() === false && d.pendingPayloads().length === 39);
  }

  console.log('\n=== PA4／PA5：〔儲存〕確認窗 ===');
  {
    const { ui, log } = newUi();
    ui.renderSaveMain(JSON.parse(JSON.stringify(savePlan(RULES40, [NAME]))));
    const body = ui.document.getElementById('modalBody');
    const actions = ui.document.getElementById('modalActions');
    const save = btn(actions, '儲存');
    const cbs = inputsOf(body);
    check('（前置）41 個勾選框（40 格＋臨時幫手）', cbs.length === 41, String(cbs.length));
    const toggles = btns(body, /^全部(勾選|取消)$/);
    check('★★★★★★ PA5：〔全部勾選〕有兩粒', toggles.length === 2, toggles.map((b) => b.textContent).join(','));
    const flat = body.flatten();
    const firstToggle = flat.indexOf(toggles[0]);
    const firstCb = flat.indexOf(cbs[0]);
    const lastCb = flat.indexOf(cbs[cbs.length - 1]);
    check('★★★★★★ PA5：一粒喺清單最頂（第一個勾選框之前）', firstToggle >= 0 && firstToggle < firstCb, [firstToggle, firstCb].join(','));
    check('★★★★★ PA5：另一粒喺清單最底（最後一個勾選框之後）', flat.indexOf(toggles[1]) > lastCb);
    check('（前置）〔儲存〕未決定 ⇒ 灰', save.disabled === true);

    toggles[0].fire('click');
    const confirmBtn = btn(body, '確定');
    check('★★★★★ 頂部〔全部勾選〕先問一句', confirmBtn && cbs.every((c) => !c.checked));
    confirmBtn.fire('click');
    await tick();
    check('★★★★★★ PA4：全部勾晒，冇即時呼叫伺服器', cbs.every((c) => c.checked) && log.calls.length === 0, String(log.calls.length));
    check('★★★★★★ PA5：全部已勾 ⇒ 兩粒都變〔全部取消〕', toggles.every((b) => b.textContent === '全部取消'), toggles.map((b) => b.textContent).join(','));
    // 取消 3 格，再快速勾返
    [3, 17, 29].forEach((i) => { cbs[i].checked = false; cbs[i].fire('change'); });
    check('★★★★★ 取消 3 格 ⇒〔儲存〕灰、按鈕變返〔全部勾選〕', save.disabled === true && toggles.every((b) => b.textContent === '全部勾選'));
    [3, 17, 29].forEach((i) => { cbs[i].checked = true; cbs[i].fire('change'); });
    check('★★★★★★ 快速勾返 ⇒〔儲存〕即刻著（唔使等伺服器）', save.disabled === false);
    save.fire('click');
    await tick();
    const saves = log.calls.filter((c) => c.name === 'apiSaveAndConfirmExecute');
    check('★★★★★★ PA4：只叫一次 apiSaveAndConfirmExecute', saves.length === 1 && log.calls.length === 1, JSON.stringify(log.calls.map((c) => c.name)));
    const sent = saves[0] && saves[0].payload.cellDecisions;
    check('★★★★★★ PA4：一次過送齊 41 項決定（40 格保留＋臨時幫手），全部 checked',
      Array.isArray(sent) && sent.length === 41 && sent.every((x) => x.checked === true)
      && sent.filter((x) => x.kind === 'TEMP_HELPER').length === 1, JSON.stringify(sent && sent.length));

    // PA5：〔全部取消〕
    const { ui: ui2 } = newUi();
    ui2.renderSaveMain(JSON.parse(JSON.stringify(savePlan(RULES40.slice(0, 5), []))));
    const body2 = ui2.document.getElementById('modalBody');
    const cbs2 = inputsOf(body2);
    cbs2.forEach((c) => { c.checked = true; c.fire('change'); });
    const t2 = btns(body2, /^全部(勾選|取消)$/);
    check('（前置）逐格勾晒 ⇒ 按鈕變〔全部取消〕', t2.every((b) => b.textContent === '全部取消'));
    t2[1].fire('click');
    await tick();
    check('★★★★★★ PA5：撳底部〔全部取消〕⇒ 全部取消（唔使確認）', cbs2.every((c) => !c.checked)
      && t2.every((b) => b.textContent === '全部勾選'));
  }

  console.log('\n=== PA6：〔檢查我的改動〕即時記住，快速勾 40 格 ===');
  {
    const { ui, log } = newUi();
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify({ names: [], rules: RULES40 })), {});
    const root = ui.document.createElement('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const cbs = inputsOf(root);
    const ps = cbs.map((c) => { c.checked = true; return c.fire('change'); });
    await Promise.all(ps);
    await tick();
    const written = new Set();
    log.calls.forEach((c) => (c.payload || []).forEach((x) => written.add(x.serviceDate)));
    check('★★★★★★ 40 格全部送出', written.size === 40, String(written.size));
    check('★★★★★★ 合併成少數幾次呼叫（≤ 3），唔係 40 次', log.calls.length >= 1 && log.calls.length <= 3, String(log.calls.length));
    check('★★★★★ 同一時間只有一個呼叫', log.maxActive === 1, String(log.maxActive));
    check('★★★★★★ 冇一格停喺「記錄中」', !/記錄中/.test(root.textContent));
    const notes = root.flatten().filter((n) => /decision-note/.test(n.className));
    check('★★★★★ 每格旁邊寫「已記錄」', notes.length === 40 && notes.every((n) => /已記錄/.test(n.textContent)),
      notes.slice(0, 3).map((n) => n.textContent).join('|'));
    check('★★★★★ 全部保持已勾', cbs.every((c) => c.checked));
  }

  console.log('\n=== PA6b：寫緊嗰陣再勾 ⇒ 排隊、合併成下一批 ===');
  {
    const { ui, log } = newUi();
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify({ names: [], rules: RULES40.slice(0, 3) })), {});
    const root = ui.document.createElement('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const cbs = inputsOf(root);
    cbs[0].checked = true;
    const p0 = cbs[0].fire('change');
    for (let i = 0; i < 3 && log.active === 0; i++) await Promise.resolve();
    check('（前置）第一格寫緊', log.active === 1, String(log.active));
    cbs[1].checked = true; const p1 = cbs[1].fire('change');
    cbs[2].checked = true; const p2 = cbs[2].fire('change');
    await Promise.all([p0, p1, p2]);
    await tick();
    check('★★★★★★ 同一時間只有一個呼叫', log.maxActive === 1, String(log.maxActive));
    check('★★★★★ 第二、三格合併成第二批', log.calls.length === 2 && log.calls[1].payload.length === 2,
      JSON.stringify(log.calls.map((c) => c.payload.length)));
  }

  console.log('\n=== PA7：即時記住失敗 ===');
  {
    const { ui } = newUi(() => new Error('發生了甚麼：工作表不見了'));
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify({ names: [], rules: RULES40.slice(0, 2) })), {});
    const root = ui.document.createElement('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const cbs = inputsOf(root);
    cbs[0].checked = true;
    await cbs[0].fire('change');
    await tick();
    const note = root.flatten().filter((n) => /decision-note/.test(n.className))[0];
    check('★★★★★★ 嗰一格旁邊紅字', /err-text/.test(note.className) && /未能記錄/.test(note.textContent), note.className + ' ' + note.textContent);
    check('★★★★★★ 保持未勾', cbs[0].checked === false);
    check('★★★★★ 冇停喺「記錄中」', !/記錄中/.test(root.textContent));
  }

  console.log('\n=== PA8：Esc 只關下拉，唔關窗 ===');
  {
    const { ui } = newUi();
    const ev = (tag, type) => ({ key: 'Escape', target: { tagName: tag, type: type } });
    check('★★★★★★ 下拉選單 ⇒ 唔關窗', ui.escClosesModal(ev('SELECT')) === false);
    check('★★★★★ 輸入框、多行輸入框 ⇒ 唔關窗', ui.escClosesModal(ev('INPUT', 'text')) === false
      && ui.escClosesModal(ev('INPUT', 'email')) === false && ui.escClosesModal(ev('TEXTAREA')) === false);
    check('★★★★★ 勾選框、按鈕、其他 ⇒ 照舊關窗', ui.escClosesModal(ev('INPUT', 'checkbox')) === true
      && ui.escClosesModal(ev('BUTTON')) === true && ui.escClosesModal(ev('DIV')) === true
      && ui.escClosesModal({ key: 'Escape', target: null }) === true);
    const boot = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptBoot.html'), 'utf8');
    check('★★★★★★ 全部彈窗共用的 Esc 處理有經 escClosesModal()',
      /e\.key === 'Escape' && modalOpen && escClosesModal\(e\)\) closeModal\(\);/.test(boot));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  拋錯：' + e.stack); process.exit(1); });
