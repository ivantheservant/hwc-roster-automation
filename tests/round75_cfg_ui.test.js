// 第七十五輪批次 CE／CF／CG 組：畫面（真係執行前端碼，ui_loader）。
// 執行方式：node tests/round75_cfg_ui.test.js
//
//   UI1　逐格決定元件：名一個勾選＋〔加入名單〕；違反每格一個「保留我的安排」，一定要遵守標紅；已放行冇勾選框
//   UI2　每勾一格即時記住（apiSetCellDecisions）；記唔到 ⇒ 勾選還原
//   UI3　〔全部勾選〕先彈一句「確定全部保留你的安排？系統不會調整這些格。」〔確定〕先一次過勾
//   UI4　儲存確認：冇逐格「用我改的／改回原本」、冇打字放行、冇「儲存之後直接去寄出」；
//        未決定 ⇒〔儲存〕灰；全部勾咗 ⇒ 著；「盡量避免」只一句提示；已確認保留只講數目
//   UI5　儲存完成窗有〔請系統幫我調整〕
//   UI6　〔檢查我的改動〕用同一個元件

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
vm.runInContext("currentQuarterId = '2099T1';", ui);
const calls = [];
let failNext = false;
ui.callServerMutating = async (name, q, payload) => {
  calls.push({ name, payload });
  if (failNext) { failNext = false; throw new Error('網絡問題'); }
  return { ok: true, written: (payload || []).length };
};
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const inputsOf = (node) => node.flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
const buttonsOf = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON');
const btn = (node, text) => buttonsOf(node).filter((b) => b.textContent === text)[0];

const ITEMS = {
  names: [{ kind: 'TEMP_HELPER', key: '2099-01-18|CHAIR|1', serviceDate: '2099-01-18', postId: 'CHAIR',
    postNameTC: '主席', slotIndex: 1, cellText: 'ivan', text: 'ivan', checked: false }],
  rules: [
    { kind: 'KEEP', key: '2099-01-25|WORSHIP|1', serviceDate: '2099-01-25', postId: 'WORSHIP', postNameTC: '領詩',
      slotIndex: 1, cellText: '假丁', personName: '假丁', ruleId: 'HARD_ELIGIBILITY', severity: 'HARD',
      mustFollow: true, reason: '不在名單', released: false, checked: false },
    { kind: 'KEEP', key: '2099-01-11|READ|1', serviceDate: '2099-01-11', postId: 'READ', postNameTC: '讀經',
      slotIndex: 1, cellText: '假丙', personName: '假丙', ruleId: 'SEMI_NO_CONSECUTIVE', severity: 'SEMI_HARD',
      mustFollow: false, reason: '連續兩週', released: false, checked: false },
    { kind: 'KEEP', key: '2099-01-04|CHAIR|1', serviceDate: '2099-01-04', postId: 'CHAIR', postNameTC: '主席',
      slotIndex: 1, cellText: '假乙', personName: '假乙', ruleId: 'HARD_ELIGIBILITY', severity: 'HARD',
      mustFollow: true, reason: '不在名單', released: true, releasedVersionNo: 1, checked: false }
  ]
};

(async () => {
  console.log('\n=== UI1／UI2：逐格決定元件 ===');
  {
    let changedCount = 0;
    let added = null;
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify(ITEMS)), {
      onChanged: () => { changedCount++; },
      onAddPerson: (u) => { added = u; }
    });
    const root = new ui.__StubNode('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const t = root.textContent;
    const cbs = inputsOf(root);
    check('★★★★★★ 名一個＋違反兩個（已放行嗰格冇勾選框）＝ 3 個勾選框', cbs.length === 3, String(cbs.length));
    check('★★★★★★ 全部預設唔勾', cbs.every((c) => c.checked === false));
    check('★★★★★ 字句：「這一季臨時幫手，不加入名單」「保留我的安排，系統不要調整」',
      /這一季臨時幫手，不加入名單/.test(t) && /保留我的安排，系統不要調整/.test(t));
    check('★★★★★ 一定要遵守標明；盡量避免標明', /一定要遵守/.test(t) && /盡量避免/.test(t));
    check('★★★★ 已放行嗰格標「已放行（第 1 版）」', /已放行（第 1 版）/.test(t));
    const addBtn = btn(root, '加入名單');
    addBtn.fire('click');
    check('★★★★★ 〔加入名單〕行 onAddPerson(u)', added && added.text === 'ivan');
    check('★★★★ 未決定 ⇒ allDecided=false', d.allDecided() === false);

    calls.length = 0;
    cbs[0].checked = true; cbs[0].fire('change');
    await tick();
    check('★★★★★★ 勾一格即時記住（apiSetCellDecisions，checked=true，帶住格內名）',
      calls.length === 1 && calls[0].name === 'apiSetCellDecisions'
      && calls[0].payload[0].kind === 'TEMP_HELPER' && calls[0].payload[0].cellText === 'ivan' && calls[0].payload[0].checked === true,
      JSON.stringify(calls));
    // 一定要遵守嗰格：記唔到 ⇒ 還原
    failNext = true;
    cbs[1].checked = true; cbs[1].fire('change');
    await tick();
    check('★★★★★★ 記唔到 ⇒ 勾選框還原（唔可以畫面勾咗而實際冇記住）', cbs[1].checked === false);
    cbs[1].checked = true; cbs[1].fire('change');
    await tick();
    check('★★★★★ 名＋一定要遵守都勾咗 ⇒ allDecided=true（盡量避免唔使勾）', d.allDecided() === true);
    check('★★★★ 每次改都通知（onChanged）', changedCount >= 3, String(changedCount));
  }

  console.log('\n=== UI3：〔全部勾選〕 ===');
  {
    const d = ui.buildDecisionSections(JSON.parse(JSON.stringify(ITEMS)), {});
    const root = new ui.__StubNode('div');
    d.nodes.forEach((n) => root.appendChild(n));
    const cbs = inputsOf(root);
    const confirmBox = root.flatten().filter((n) => /確定全部保留你的安排？系統不會調整這些格。/.test(n.textContent) && n.className === 'warnbox')[0];
    check('★★★★★ 確認句預設收起', confirmBox && confirmBox.hidden === true);
    btn(root, '全部勾選').fire('click');
    check('★★★★★★ 撳〔全部勾選〕先彈出確認句（未勾）', confirmBox.hidden === false && cbs.every((c) => !c.checked));
    btn(root, '取消').fire('click');
    check('★★★★ 〔取消〕⇒ 收起，乜都冇勾', confirmBox.hidden === true && cbs.every((c) => !c.checked));
    calls.length = 0;
    btn(root, '全部勾選').fire('click');
    btn(root, '確定').fire('click');
    await tick();
    check('★★★★★★ 〔確定〕⇒ 全部勾晒（名同違反都勾）', cbs.every((c) => c.checked));
    check('★★★★★ 一次過記住 3 項', calls.length === 1 && calls[0].payload.length === 3, JSON.stringify(calls).slice(0, 300));
  }

  console.log('\n=== UI4：儲存確認畫面 ===');
  {
    const plan = {
      blocked: false, zeroChange: false, targetVersionNo: 2, baseVersionNo: 1, stage: 'DRAFT',
      gridChanges: [{ serviceDate: '2099-01-18', postId: 'CHAIR', postNameTC: '主席', slotIndex: 1, originalName: '假甲', manualName: 'ivan' }],
      requests: { apply: [], confirm: [], needsInput: [] }, overlaps: [], blankCells: [],
      violations: { real: [ITEMS.rules[0]], kept: [], released: [], structural: [], semiHard: [ITEMS.rules[1]], semiKept: [] },
      unresolved: [ITEMS.names[0]], tempHelpers: [],
      decisionItems: { names: [ITEMS.names[0]], rules: [ITEMS.rules[0]] },
      needsDecision: true, keptCount: 3, needsRelease: false, proposals: []
    };
    ui.renderSaveMain(JSON.parse(JSON.stringify(plan)));
    const body = ui.document.getElementById('modalBody');
    const actions = ui.document.getElementById('modalActions');
    const t = body.textContent;
    const save = btn(actions, '儲存');
    check('★★★★★★ 標題「會儲存成第 2 版」', ui.document.getElementById('modalTitle').textContent === '會儲存成第 2 版');
    check('★★★★★★ 未決定 ⇒〔儲存〕灰', save && save.disabled === true);
    check('★★★★★ 有〔返回修改〕', !!btn(actions, '返回修改'));
    check('★★★★★★ 冇逐格「用我改的／改回原本」', !/用我改的/.test(t) && !/改回原本/.test(t));
    check('★★★★★★ 冇打字放行（冇文字輸入框、冇「輸入「確認」」）',
      body.flatten().filter((n) => n.tagName === 'INPUT' && n.type !== 'checkbox').length === 0 && !/輸入「確認」/.test(t));
    check('★★★★★★ 冇「儲存之後直接去寄出」', !/儲存之後直接去寄出/.test(t));
    check('★★★★★ 「你改了這 1 格」清單', /你改了這 1 格/.test(t) && /假甲 → ivan/.test(t));
    check('★★★★★ 已確認保留只講數目', /你已確認保留 3 格/.test(t));
    check('★★★★★ 盡量避免只一句提示，唔擋', /另有 1 格違反「盡量避免」的規則/.test(t));
    const cbs = inputsOf(body);
    check('（前置）即場有 2 個勾選框（名＋一定要遵守）', cbs.length === 2, String(cbs.length));
    cbs.forEach((c) => { c.checked = true; c.fire('change'); });
    await tick();
    check('★★★★★★ 全部勾咗 ⇒〔儲存〕著', save.disabled === false);
    check('★★★★ 有〔請系統幫我調整〕', !!btn(actions, '請系統幫我調整'));
  }

  console.log('\n=== UI5：儲存完成窗 ===');
  {
    vm.runInContext('saveThenSend_ = false;', ui);
    ui.renderSaveResult({ ok: true, versionNo: 2, baseVersionNo: 1, cellCount: 1, savedChanges: [],
      appliedRequestCount: 0, rejectedRequestCount: 0, needsInputCount: 0, releasedViolationCount: 1, stageAdvanced: false });
    const actions = ui.document.getElementById('modalActions');
    check('★★★★★★ 完成窗有〔請系統幫我調整〕', !!btn(actions, '請系統幫我調整'));
    check('★★★★ 放行講法改為「勾了保留」', /你勾了保留的 1 格/.test(ui.document.getElementById('modalBody').textContent));
  }

  console.log('\n=== UI6：〔檢查我的改動〕用同一個元件 ===');
  {
    ui.renderCheckResult({ ok: true, changes: [{ serviceDate: '2099-01-18', postNameTC: '主席', slotIndex: 1, fromName: '假甲', toName: 'ivan' }],
      unresolved: [ITEMS.names[0]], violations: ITEMS.rules, blanks: [], allClear: false });
    const body = ui.document.getElementById('modalBody');
    check('★★★★★★ 有〔加入名單〕同勾選框', !!btn(body, '加入名單') && inputsOf(body).length === 3);
    check('★★★★★ 有〔全部勾選〕', !!btn(body, '全部勾選'));
    check('★★★★ 講明系統只調整冇勾嘅格', /系統只會調整沒有勾的違反規則格和空格/.test(body.textContent));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  拋錯：' + e.stack); process.exit(1); });
