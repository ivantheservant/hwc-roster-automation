// 第八十四輪批次 KC 組：結果窗「排表偏好」一段——**每一項**生效中的偏好都有一句。
// 執行方式：node tests/round84_kc_weight_outcome_each.test.js
//
// 現場（第八十三輪 G10）：那一位人手改過一格之後，次數剛好等於目標 ⇒ 冇微調，結果窗完全冇偏好嗰一段。
//
//   KC1　已達到目標 ⇒「某某的報告：目標 N 次，現時 N 次，已達到目標，不用微調」
//   KC2　微調 ⇒「某某的報告：微調了 N 格（目標…）」＋逐格（照現有）
//   KC3　做不到 ⇒ 原因（照現有）；算不到目標都要有一句
//   KC4　真入口：已達到目標嗰項喺 apiBuildSuggestion 嘅 weightTune.outcomes
//   KC5　前端：三種都畫；冇生效中嘅偏好就冇呢一段

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
sc.weights = [];
gas.readWeightsForQuarterTune_ = () => ({ rows: sc.weights.slice() });
gas.apiGenerateDraftExecute(sc.Q);
const ctx = gas.buildFineTuneContext_(sc.Q, 0);
const state = gas.resolveAuthoritativeState_(ctx, gas.STATE_SOURCE.GRID_OVERLAY, 'test').state;
const count = (p, post) => state.filter((s) => s.personId === p && s.postId === post).length;
const eligibleChair = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9707'];
const zero = eligibleChair.filter((p) => count(p, 'CHAIR') === 0)[0];
const some = eligibleChair.filter((p) => count(p, 'CHAIR') >= 1)[0];
const nm = (id) => sc.PEOPLE[id];
check('（準備）有人主席 0 次、有人 ≥1 次', !!zero && !!some, JSON.stringify([zero, some]));

console.log('\n=== KC1–KC3：純函式，每項一句 ===');
const tune = (rows) => gas.proposeWeightFineTune_(ctx, state, { weights: { rows: rows }, protectedKeys: {} });
{
  const n = count(some, 'CHAIR');
  const met = tune([{ personId: some, postId: 'CHAIR', adjust: 1, target: n }]);
  const o = (met.outcomes || [])[0] || {};
  check('★★★★★★ KC1 已達到目標 ⇒ 一句「已達到目標，不用微調」', met.moves.length === 0 && met.outcomes.length === 1 && o.kind === 'MET'
    && o.text === nm(some) + '的主席：目標 ' + n + ' 次，現時 ' + n + ' 次，已達到目標，不用微調', JSON.stringify(met));
  const up = tune([{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 }]);
  const u = (up.outcomes || [])[0] || {};
  check('★★★★★★ KC2 微調 ⇒「微調了 1 格」', up.moves.length === 1 && u.kind === 'TUNED' && u.moveCount === 1
    && u.text === nm(zero) + '的主席：微調了 1 格（目標 1 次，現時 1 次）', JSON.stringify(up.outcomes));
  const no = tune([{ personId: 'P9706', postId: 'CHAIR', adjust: 1, target: 1 }]);
  const x = (no.outcomes || [])[0] || {};
  check('★★★★★★ KC3 做不到 ⇒ 原因照現有（同 unmet 同一句）', x.kind === 'UNMET' && x.text === no.unmet[0].text
    && /他不在這個崗位的事奉人員名單上/.test(x.text), JSON.stringify(no));
  const noTarget = tune([{ personId: zero, postId: 'CHAIR', adjust: 1, target: null }]);
  check('★★★★★ KC3 算不到目標都有一句（唔會靜靜冇咗）', noTarget.moves.length === 0 && noTarget.outcomes.length === 1
    && noTarget.outcomes[0].kind === 'UNMET' && /算不到這一季的目標次數/.test(noTarget.outcomes[0].text), JSON.stringify(noTarget));
  const mix = tune([{ personId: zero, postId: 'CHAIR', adjust: 1, target: 1 },
    { personId: some, postId: 'CHAIR', adjust: 1, target: count(some, 'CHAIR') },
    { personId: 'P9706', postId: 'CHAIR', adjust: 1, target: 1 }]);
  check('★★★★★★ KC 三項偏好 ⇒ 三句（每項一句）', (mix.outcomes || []).length === 3
    && mix.outcomes.map((oc) => oc.kind).sort().join(',') === 'MET,TUNED,UNMET', JSON.stringify(mix.outcomes));
  check('★★★★ 冇偏好 ⇒ 冇句', tune([]).outcomes.length === 0);
}

console.log('\n=== KC4：真入口 ===');
{
  const n = count(some, 'CHAIR');
  sc.weights = [{ personId: some, postId: 'CHAIR', adjust: 1, target: n }];
  // 要有改動先會出建議表（同 G10：人手改咗格）——第 2 週讀經＝第 1 週讀經（連續兩週，系統會再改）
  sc.setCell(0, sc.DATES[1], 'READ#1', sc.getCell(0, sc.DATES[0], 'READ#1'));
  const r = gas.apiBuildSuggestion(sc.Q, '', []);
  const oc = (((r.weightTune || {}).outcomes) || [])[0] || {};
  check('★★★★★★ KC4 已達到目標嗰項喺結果（冇微調都有一句）', r.ok && r.weightTune.moves.length === 0 && oc.kind === 'MET'
    && /已達到目標，不用微調/.test(oc.text) && oc.weightKey === some + '|CHAIR', JSON.stringify(r).slice(0, 600));
}

console.log('\n=== KC5：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptSuggestion.html']);
  const base = { ok: true, startNote: '', url: '', sheetName: 's', colourCounts: {}, manualOutcomes: [], systemFixes: [],
    untouchedManual: [], remaining: [], unfillable: [], undecidedNames: [] };
  const body = () => ui.document.getElementById('modalBody').textContent;
  ui.renderSuggestionResult(Object.assign({}, base, { weightTune: {
    moves: [{ serviceDate: '2099-01-18', postNameTC: '報告', slotIndex: 1, fromName: '假丙', toName: '假戊', label: '假戊的報告（排表偏好多1次，目標 3 次）', weightKey: 'A|REPORT' }],
    unmet: ['假己的主席：目標 2 次，現時 1 次，找不到可以換而不違反規則的格。'],
    outcomes: [
      { kind: 'TUNED', text: '假戊的報告：微調了 1 格（目標 3 次，現時 3 次）', moveCount: 1, weightKey: 'A|REPORT' },
      { kind: 'MET', text: '假庚的報告：目標 6 次，現時 6 次，已達到目標，不用微調', moveCount: 0, weightKey: 'B|REPORT' },
      { kind: 'UNMET', text: '假己的主席：目標 2 次，現時 1 次，找不到可以換而不違反規則的格。', moveCount: 0, weightKey: 'C|CHAIR' }],
    error: '' } }), false);
  const t = body();
  check('★★★★★★ KC5 一段「排表偏好（3 項…）」', t.indexOf('排表偏好（3 項，按排表偏好微調了 1 格）') !== -1, t);
  check('★★★★★★ KC5 已達到目標嗰句', t.indexOf('假庚的報告：目標 6 次，現時 6 次，已達到目標，不用微調') !== -1, t);
  check('★★★★★ KC5 微調嗰句＋逐格', t.indexOf('假戊的報告：微調了 1 格') !== -1 && t.indexOf('假丙 → 假戊（假戊的報告（排表偏好多1次，目標 3 次））') !== -1, t);
  check('★★★★★ KC5 做不到嗰句', t.indexOf('做不到：假己的主席：目標 2 次，現時 1 次') !== -1, t);
  ui.renderSuggestionResult(Object.assign({}, base, { weightTune: { moves: [], unmet: [], outcomes: [], error: '' } }), false);
  check('★★★★★ KC5 冇生效中嘅偏好 ⇒ 冇呢一段', body().indexOf('排表偏好') === -1, body());
  ui.renderSuggestionResult(Object.assign({}, base, { weightTune: { moves: [], unmet: [],
    outcomes: [{ kind: 'MET', text: '假庚的報告：目標 6 次，現時 6 次，已達到目標，不用微調', moveCount: 0, weightKey: 'B|REPORT' }], error: '' } }), false);
  check('★★★★★★ KC5 只有一項已達到目標 ⇒ 都出一段（第八十三輪 G10 正正係呢個情況）',
    body().indexOf('排表偏好（1 項）') !== -1 && body().indexOf('已達到目標，不用微調') !== -1, body());
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
