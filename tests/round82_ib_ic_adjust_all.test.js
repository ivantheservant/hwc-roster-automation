// 第八十二輪批次 IB／IC 組：〔請系統幫我調整〕一個掣處理全部（人手改動、不能服侍、排表偏好、空格），並按排表偏好微調。
// 執行方式：node tests/round82_ib_ic_adjust_all.test.js
//
// Ivan（手動測試 C）：唔使先撳〔檢查我的改動〕，直接撳〔請系統幫我調整〕都要出同樣嘅勾選；
// 結果要列出**全部**人手改過嘅格；生成之後改咗「不能服侍的日期」同「排表偏好」，再人手改格，全部累積改動都要處理。
//
//   IB1　未決定（未勾嘅違反規則格、名單上找不到嘅名）⇒ apiCheckMyChanges.undecidedCount＞0；「這一次會處理」列出改動、
//        不能服侍、偏好、空格
//   IB2　前端：直接撳〔請系統幫我調整〕⇒ 有未決定 ⇒ 先出「調整之前」（同一個勾選元件、〔開始調整〕〔取消〕）；
//        全部已決定 ⇒ 直接調整
//   IB3　結果窗「你人手改過的格」逐格：冇違規不動／臨時幫手不動／系統再改（原因）
//   IB4　新加嘅不能服侍日期 ⇒ 列入「這一次會處理」而且被換走
//   IC1　偏好 +1（目標比現時多）⇒ 多一格；只換系統排嘅格；冇新違規
//   IC2　偏好 −1 ⇒ 少一格，換畀合資格嘅人
//   IC3　做唔到 ⇒ 列出原因、唔郁（唔喺名單上／全部格都係人手）
//   IC4　人手改過／已保留／臨時幫手嘅格一律唔郁；結果穩定（同一個輸入同一個結果）
//   IC5　建議表綠色格；結果窗「按排表偏好微調了 M 格」

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

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const gas = sc.gas;
  sc.weights = [];
  gas.readWeightsForQuarterTune_ = () => ({ rows: sc.weights.slice() });
  // 開「不能服侍」規則
  const RS = sc.C.RULE_SETTINGS;
  sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
    [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
  gas.apiGenerateDraftExecute(sc.Q);
  sc.addUnavailable = (personId, date) => {
    const U = sc.C.UNAVAILABLE;
    sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [{ [U.UNAVAILABLE_ID]: 'U' + date + personId,
      [U.PERSON_ID]: personId, [U.DATE_FROM]: date, [U.DATE_TO]: date, [U.SOURCE]: 'WEB', [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL' }]);
  };
  sc.idOf = (name) => Object.keys(sc.PEOPLE).filter((id) => sc.PEOPLE[id] === name)[0];
  return sc;
}
const D = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];

console.log('\n=== IB1／IB3／IB4 ===');
{
  const sc = scene();
  const gas = sc.gas;
  // 第 1 週主席嗰個人第 1 週不能服侍（生成之後先加）
  const chair0 = sc.idOf(sc.getCell(0, D[0], 'CHAIR#1'));
  sc.addUnavailable(chair0, D[0]);
  // 人手改三格：第 2 週讀經＝第 1 週讀經（連續兩週，未勾）、第 3 週主席打 ivan（臨時幫手）、第 4 週主席換一個冇問題嘅人
  sc.setCell(0, D[1], 'READ#1', sc.getCell(0, D[0], 'READ#1'));
  sc.setCell(0, D[2], 'CHAIR#1', 'ivan');
  const usedD3 = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((p) => sc.getCell(0, D[3], p));
  const usedD2 = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((p) => sc.getCell(0, D[2], p));
  const okPerson = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf)
    .filter((n) => usedD3.indexOf(n) === -1 && usedD2.indexOf(n) === -1 && n !== sc.getCell(0, D[3], 'CHAIR#1'))[0];
  sc.setCell(0, D[3], 'CHAIR#1', okPerson);
  sc.weights = [{ personId: 'P9705', postId: 'READ', adjust: 1, target: 9 }];

  const pre = gas.apiCheckMyChanges(sc.Q);
  check('★★★★★★ IB1 未決定（連續兩週未勾＋ivan 未決定）⇒ undecidedCount ≥ 2', pre.ok && pre.undecidedCount >= 2, JSON.stringify(pre.undecidedCount));
  const w = pre.willHandle || {};
  check('★★★★★ 「這一次會處理」：你在表上改了 3 格（逐格）', (w.gridChanges || []).length === 3, JSON.stringify(w.gridChanges));
  check('★★★★★★ IB4 不能服侍：第 1 週主席那一格列出', (w.unavailableCells || []).some((c) => c.serviceDate === D[0] && c.postNameTC === '主席'),
    JSON.stringify(w.unavailableCells));
  check('★★★★★ 排表偏好：1 項生效中', w.weights && w.weights.count === 1, JSON.stringify(w.weights));
  check('★★★★ 空格數目有計', typeof w.blankCount === 'number');

  // 決定：ivan 臨時幫手；連續兩週唔勾
  gas.apiSetCellDecisions(sc.Q, [{ serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }]);
  const r = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（準備）建議表 ok', r.ok === true, JSON.stringify(r).slice(0, 300));
  const outcomeOf = (d, post) => (r.manualOutcomes || []).filter((o) => o.serviceDate === d && o.postNameTC === post)[0] || {};
  check('★★★★★★ IB3「你人手改過的格」列出全部 3 格', (r.manualOutcomes || []).length === 3, JSON.stringify(r.manualOutcomes));
  check('★★★★★★ 第 2 週讀經（連續兩週、未勾）⇒ 系統再改（寫原因）', outcomeOf(D[1], '讀經').outcome === 'SYSTEM_CHANGED'
    && /系統再改成「.+」（/.test(outcomeOf(D[1], '讀經').text), JSON.stringify(outcomeOf(D[1], '讀經')));
  check('★★★★★★ ivan ⇒ 系統沒有動（臨時幫手）', outcomeOf(D[2], '主席').outcome === 'TEMP_HELPER'
    && outcomeOf(D[2], '主席').text === '系統沒有動（臨時幫手）', JSON.stringify(outcomeOf(D[2], '主席')));
  check('★★★★★★ 冇違規嘅那一格 ⇒ 系統沒有動（沒有違反規則）', outcomeOf(D[3], '主席').outcome === 'NO_VIOLATION'
    && outcomeOf(D[3], '主席').text === '系統沒有動（沒有違反規則）', JSON.stringify(outcomeOf(D[3], '主席')));
  const sugSheet = gas.buildSuggestionSheetName_(sc.Q, 0);
  const sugText = gas.readGridTextFromSheet_(sugSheet, sc.TZ);
  check('★★★★★★ IB4 第 1 週主席（不能服侍）在建議表被換走', sugText[D[0] + '|CHAIR|1'] && sugText[D[0] + '|CHAIR|1'] !== sc.nameOf(chair0),
    sugText[D[0] + '|CHAIR|1']);
  check('★★★★ 結果亦帶「這一次會處理」', r.willHandle && (r.willHandle.gridChanges || []).length === 3);
}

console.log('\n=== IC1–IC4：按排表偏好微調（純函式＋真入口）===');
{
  const sc = scene();
  const gas = sc.gas;
  const ctx = gas.buildFineTuneContext_(sc.Q, 0);
  const state = gas.resolveAuthoritativeState_(ctx, gas.STATE_SOURCE.GRID_OVERLAY, 'test').state;
  const count = (st, p, post) => st.filter((s) => s.personId === p && s.postId === post).length;
  const viol = (st) => gas.findStateViolations_(st, ctx).length;
  const eligibleChair = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9707'];
  const zero = eligibleChair.filter((p) => count(state, p, 'CHAIR') === 0)[0];
  const many = eligibleChair.slice().sort((a, b) => count(state, b, 'CHAIR') - count(state, a, 'CHAIR'))[0];
  check('（準備）有人主席 0 次、有人 ≥1 次', !!zero && count(state, many, 'CHAIR') >= 1, JSON.stringify([zero, many]));

  // IC1 +1
  const up = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 }] }, protectedKeys: {} });
  check('★★★★★★ IC1 偏好 +1 ⇒ 多一格（換成佢）', up.moves.length === 1 && up.moves[0].toPersonId === zero && up.unmet.length === 0, JSON.stringify(up));
  const applied = state.map((s) => Object.assign({}, s));
  up.moves.forEach((m) => applied.forEach((s) => { if (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === m.key) s.personId = m.toPersonId; }));
  check('★★★★★ 冇新違規', viol(applied) <= viol(state), [viol(state), viol(applied)].join('→'));
  check('★★★★ 唔改傳入嘅 state', count(state, zero, 'CHAIR') === 0);

  // IC2 −1
  const n = count(state, many, 'CHAIR');
  const down = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: many, postId: 'CHAIR', adjust: -1, target: n - 1 }] }, protectedKeys: {} });
  check('★★★★★★ IC2 偏好 −1 ⇒ 少一格，換畀另一位合資格嘅人', down.moves.length === 1 && down.moves[0].fromPersonId === many
    && down.moves[0].toPersonId !== many && eligibleChair.indexOf(down.moves[0].toPersonId) !== -1, JSON.stringify(down));

  // IC3 做唔到：唔喺名單上（P9706 唔喺任何自動崗位名單）
  const notEl = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: 'P9706', postId: 'CHAIR', adjust: 1, target: 1 }] }, protectedKeys: {} });
  check('★★★★★★ IC3 唔喺名單上 ⇒ 唔郁、寫原因', notEl.moves.length === 0 && notEl.unmet.length === 1
    && /目標 1 次，現時 0 次，他不在這個崗位的事奉人員名單上/.test(notEl.unmet[0].text), JSON.stringify(notEl.unmet));
  // IC3／IC4：全部主席格都係保護格 ⇒ 找不到
  const allProtected = {};
  state.filter((s) => s.postId === 'CHAIR').forEach((s) => { allProtected[gas.cellKey_(s.serviceDate, s.postId, s.slotIndex)] = true; });
  const blocked = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 }] }, protectedKeys: allProtected });
  check('★★★★★★ IC4 人手／保留／臨時幫手嘅格一律唔郁 ⇒ 找不到可以換的格', blocked.moves.length === 0
    && /找不到可以換而不違反規則的格/.test((blocked.unmet[0] || {}).text || ''), JSON.stringify(blocked));
  const again = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 }] }, protectedKeys: {} });
  check('★★★★★ 結果穩定（同一個輸入同一個結果）', JSON.stringify(again.moves) === JSON.stringify(up.moves));
  // 唯一可以換嘅格會令佢連續兩週讀經 ⇒ 唔可以換（新違規）
  {
    const keyOf = (s) => gas.cellKey_(s.serviceDate, s.postId, s.slotIndex);
    const onDay = (st, p, d) => st.some((s) => s.serviceDate === d && s.personId === p);
    const X = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9707'].filter((p) => !onDay(state, p, D[0]) && !onDay(state, p, D[1]))[0];
    const st2 = state.map((s) => Object.assign({}, s));
    st2.forEach((s) => { if (s.serviceDate === D[0] && s.postId === 'READ') s.personId = X; });
    const prot = {};
    st2.filter((s) => s.postId === 'READ' && s.serviceDate !== D[1]).forEach((s) => { prot[keyOf(s)] = true; });
    const res = gas.proposeWeightFineTune_(ctx, st2, { weights: { rows: [{ personId: X, postId: 'READ', adjust: 1, target: 2 }] }, protectedKeys: prot });
    check('★★★★★★ 唯一可以換嘅格會令佢連續兩週 ⇒ 唔換（唔可以製造新違規）、寫原因', !!X && res.moves.length === 0
      && /找不到可以換而不違反規則的格/.test((res.unmet[0] || {}).text || ''), JSON.stringify([X, res]));
  }
  const tooMany = gas.proposeWeightFineTune_(ctx, state, { weights: { rows: [{ personId: zero, postId: 'CHAIR', adjust: 9, target: 9 }] }, protectedKeys: {} });
  check('★★★★ 換到做唔到為止就停、寫明', tooMany.unmet.length === 1 && /目標 9 次/.test(tooMany.unmet[0].text), JSON.stringify(tooMany.unmet));

  // 真入口：人手改過嘅格唔郁
  const manualKey = D[0] + '|CHAIR|1';
  const manualName = sc.nameOf(eligibleChair.filter((p) => p !== zero && p !== sc.idOf(sc.getCell(0, D[0], 'CHAIR#1')))[0]);
  sc.setCell(0, D[0], 'CHAIR#1', manualName);
  sc.weights = [{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 }];
  const r = gas.apiBuildSuggestion(sc.Q, '', []);
  const sug = gas.readGridTextFromSheet_(gas.buildSuggestionSheetName_(sc.Q, 0), sc.TZ);
  check('★★★★★★ 真入口：人手改過嗰格冇被偏好改走', sug[manualKey] === manualName, sug[manualKey]);
  check('★★★★★★ IC5 結果窗「按排表偏好微調了 M 格」資料＋綠色格', r.ok && r.weightTune && (r.weightTune.moves.length + r.weightTune.unmet.length) >= 1
    && (r.weightTune.moves.length === 0 || (r.colourCounts && r.colourCounts.weight === r.weightTune.moves.length)), JSON.stringify([r.weightTune, r.colourCounts]));
}

console.log('\n=== IB2／IC5：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  const calls = [];
  let pre = { ok: true, undecidedCount: 1, changes: [], blanks: [],
    unresolved: [], violations: [{ key: '2099-01-11|READ|1', serviceDate: '2099-01-11', postId: 'READ', postNameTC: '讀經', slotIndex: 1,
      kind: 'KEEP_RULE', cellText: '假甲', ruleId: 'SEMI_NO_CONSECUTIVE', mustFollow: false, checked: false, personName: '假甲' }],
    willHandle: { gridChanges: [{ serviceDate: '2099-01-11', postNameTC: '讀經', slotIndex: 1, fromName: '假乙', toName: '假甲' }],
      unavailableCells: [{ serviceDate: '2099-01-04', postNameTC: '主席', slotIndex: 1, personName: '假丙' }],
      weights: { count: 1, items: [{ personName: '假戊', postNameTC: '報告', adjust: 1, target: 3 }] }, blankCount: 2 } };
  const result = { ok: true, sheetName: 'S', url: 'u', startNote: '', colourCounts: { manual: 1, system: 1, both: 0, manualViolation: 0, weight: 1 },
    manualOutcomes: [{ serviceDate: '2099-01-11', postNameTC: '讀經', slotIndex: 1, fromName: '假乙', toName: '假甲', outcome: 'SYSTEM_CHANGED', text: '系統再改成「假丁」（連續兩週）' }],
    weightTune: { moves: [{ serviceDate: '2099-01-18', postNameTC: '報告', slotIndex: 1, fromName: '假丙', toName: '假戊', label: '假戊的報告（排表偏好多1次，目標 3 次）', weightKey: 'P9805|REPORT' }],
      unmet: ['假己的主席：目標 2 次，現時 1 次，找不到可以換而不違反規則的格。'],
      // 第八十四輪批次 KC 組：每一項偏好一句（結果窗由 outcomes 畫）
      outcomes: [{ kind: 'TUNED', text: '假戊的報告：微調了 1 格（目標 3 次，現時 3 次）', moveCount: 1, weightKey: 'P9805|REPORT' },
        { kind: 'UNMET', text: '假己的主席：目標 2 次，現時 1 次，找不到可以換而不違反規則的格。', moveCount: 0, weightKey: 'P9806|CHAIR' }],
      error: '' },
    willHandle: pre.willHandle, untouchedManual: [], undecidedNames: [], remaining: [], unfillable: [] };
  ui.callServer = async (name) => { calls.push(name); return pre; };
  ui.callServerMutating = async (name) => { calls.push(name); return result; };
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((res) => setImmediate(res)); };
  (async () => {
    ui.openBuildSuggestion();
    await tick();
    const title = () => ui.document.getElementById('modalTitle').textContent;
    const body = () => ui.document.getElementById('modalBody').textContent;
    const acts = () => ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    check('★★★★★★ IB2 有未決定 ⇒ 先出「調整之前」', title() === '調整之前' && calls.indexOf('apiBuildSuggestion') === -1, title() + ' ' + JSON.stringify(calls));
    check('★★★★★ 用同一個勾選元件（有「保留我的安排，系統不要調整」）', /保留我的安排，系統不要調整/.test(body()), body().slice(0, 300));
    check('★★★★★ 「這一次會處理」：改 1 格、不能服侍 1 格、偏好 1 項、空格 2 格',
      /你在表上改了 1 格/.test(body()) && /不能服侍的日期」令這一版 1 格/.test(body()) && /這一季有 1 項生效中的偏好/.test(body()) && /空格 2 格/.test(body()), body());
    check('★★★★★ 按鈕〔開始調整〕〔取消〕', JSON.stringify(acts().slice(-2)) === JSON.stringify(['開始調整', '取消']), JSON.stringify(acts()));
    ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '開始調整')[0].fire('click');
    await tick();
    check('★★★★★★ 〔開始調整〕⇒ 叫 apiBuildSuggestion、出結果窗', calls.indexOf('apiBuildSuggestion') !== -1 && title() === '系統建議版本', title());
    check('★★★★★★ 結果窗「你人手改過的格」逐格寫結果', /你人手改過的格（1 格）/.test(body()) && /系統再改成「假丁」（連續兩週）/.test(body()), body().slice(0, 400));
    check('★★★★★★ IC5 結果窗「按排表偏好微調了 1 格」＋做唔到嘅原因＋綠色格', /按排表偏好微調了 1 格/.test(body())
      && /做不到：假己的主席：目標 2 次，現時 1 次/.test(body()) && /綠色格 ＝ 系統按排表偏好微調的（1 格）/.test(body()), body());
    // 全部已決定 ⇒ 直接調整
    calls.length = 0;
    pre = Object.assign({}, pre, { undecidedCount: 0 });
    ui.openBuildSuggestion();
    await tick();
    check('★★★★★★ 全部已決定 ⇒ 唔出「調整之前」、直接調整；結果窗最上面有「這一次會處理」',
      calls.join(',') === 'apiCheckMyChanges,apiBuildSuggestion' && title() === '系統建議版本' && /這一次會處理/.test(body()), calls.join(',') + ' ' + title());
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'SuggestionSheet.gs'), 'utf8');
    check('★★★★ 建議表圖例有綠色格', /'綠色格 ＝ 系統按排表偏好微調的'/.test(src));
    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}
