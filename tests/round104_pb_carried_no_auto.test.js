// 第一百零四輪批次 PB 組：崗位後來才改為人手（AutoGenerate=FALSE），舊版本由系統排的格不再報「這個崗位不由系統排」。
// 執行方式：node tests/round104_pb_carried_no_auto.test.js
//
// 現場（週報測試季度）：領詩、司琴以前 AutoGenerate=TRUE，舊版本那些格 AssignSource=AUTO；
// 第九十八輪起改為人手 ⇒ 每次儲存都報 HARD_NO_AUTO_PREACHER，幹事要逐格放行。
//
//   PB1　上一版原封不動帶過來（同一個人、AUTO）⇒ 不報
//   PB2　系統今次試放（FINE_TUNED，換了人）⇒ 照報（fine-tune 不可以自己為人手崗位選人）
//   PB3　換了人但來源不是人手（例如 AUTO，不知道誰放）⇒ 照報（舊行為）
//   PB4　幹事人手換人 ⇒ 不報（第六十三輪 K 組，照舊）
//   PB5　真入口：〔檢查我的改動〕不再列出帶過來的格
//   PB6　其他規則（例如不在名單）照舊查——只有 NO_AUTO_GENERATE 這一條不報帶過來的格

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
const C = sc.C;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);

// 生成之後先把 WORSHIP 改為人手崗位（AutoGenerate=FALSE）
{
  const sh = sc.ss.getSheetByName(sc.S.POSTS);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = keys.indexOf(C.POSTS.POST_ID) + 1;
  const agCol = keys.indexOf(C.POSTS.AUTO_GENERATE) + 1;
  let done = false;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, idCol).getValue() === 'WORSHIP') { sh.getRange(r, agCol).setValue(false); done = true; }
  }
  check('（前置）WORSHIP 改做 AutoGenerate=FALSE', done);
}

const NO_AUTO = gas.RULE_IDS.NO_AUTO_GENERATE;
const worshipRows = sc.rows(0).filter((r) => r[sc.A.POST_ID] === 'WORSHIP' && r[sc.A.PERSON_ID]);
check('（前置）第 0 版有系統排的領詩（AUTO）', worshipRows.length > 0
  && worshipRows.every((r) => r[sc.A.ASSIGN_SOURCE] === 'AUTO'), JSON.stringify(worshipRows.slice(0, 1)));

const ctx = gas.buildFineTuneContext_(sc.Q, 0);
const base = gas.resolveAuthoritativeState_(ctx, gas.STATE_SOURCE.VERSION_OF_RECORD, 'test').state;
const noAuto = (state) => gas.findStateViolations_(state, ctx).filter((v) => v.ruleId === NO_AUTO);
const wCell = base.filter((s) => s.postId === 'WORSHIP' && s.personId)[0];
const wKey = gas.cellKey_(wCell.serviceDate, wCell.postId, wCell.slotIndex);
const other = ['P9701', 'P9702', 'P9703'].filter((p) => p !== wCell.personId)[0];

console.log('\n=== PB1：原封不動帶過來 ===');
check('★★★★★★ 上一版的 AUTO 領詩不報「這個崗位不由系統排」', noAuto(base).length === 0, JSON.stringify(noAuto(base)));

console.log('\n=== PB2：系統今次試放 ===');
{
  const v = noAuto(gas.substituteCell_(base, wKey, other));
  check('★★★★★★ FINE_TUNED 換人 ⇒ 照報', v.length === 1 && v[0].postId === 'WORSHIP' && v[0].personId === other, JSON.stringify(v));
  // FIXTURE-OK: 模擬系統今次試放同一個人（FINE_TUNED），真入口 substituteCell_ 只會換人，所以要手動建立
  const same = base.map((s) => (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === wKey
    ? Object.assign({}, s, { assignSource: gas.ASSIGN_SOURCE.FINE_TUNED }) : s));
  check('★★★★★ FINE_TUNED（即使同一個人）⇒ 照報（不當作帶過來）', noAuto(same).length === 1);
}

console.log('\n=== PB3：換了人、來源不是人手 ===');
{
  // FIXTURE-OK: 模擬「換了人但來源不是人手」（例如生成器錯誤排了），真入口不會產生，要手動建立
  const changed = base.map((s) => (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === wKey
    ? Object.assign({}, s, { personId: other, assignSource: 'AUTO' }) : s));
  check('★★★★★★ 同上一版不同的人 ⇒ 照報', noAuto(changed).length === 1, JSON.stringify(noAuto(changed)));
}

console.log('\n=== PB4：幹事人手換人 ===');
{
  // FIXTURE-OK: 同 GRID_OVERLAY 人手改動的形狀一樣（isManual=true、沒有 assignSource）
  const manual = base.map((s) => (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === wKey
    ? Object.assign({}, s, { personId: other, assignSource: null, isManual: true }) : s));
  check('★★★★★ 人手 ⇒ 不報', noAuto(manual).length === 0);
}

console.log('\n=== PB5：真入口〔檢查我的改動〕===');
{
  sc.setCell(0, D[0], 'CHAIR#1', sc.getCell(0, D[1], 'CHAIR#1'));   // 一格無關的改動
  const chk = gas.apiCheckMyChanges(sc.Q);
  const hits = (chk.violations || []).filter((v) => v.ruleId === NO_AUTO);
  check('★★★★★★ 沒有列出帶過來的領詩格', hits.length === 0, JSON.stringify(hits));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  const planHits = ((plan.violations || {}).real || []).filter((v) => v.ruleId === NO_AUTO)
    .concat(((plan.decisionItems || {}).rules || []).filter((v) => v.ruleId === NO_AUTO));
  check('★★★★★★ 儲存確認窗不要求逐格放行領詩', planHits.length === 0, JSON.stringify(planHits));
}

console.log('\n=== PB6：其他規則照舊 ===');
{
  const eligPost = ctx.posts.filter((p) => p.postId === 'CHAIR')[0];
  check('（前置）CHAIR 是自動崗位', eligPost && eligPost.autoGenerate === true);
  const cCell = base.filter((s) => s.postId === 'CHAIR' && s.personId)[0];
  const cKey = gas.cellKey_(cCell.serviceDate, cCell.postId, cCell.slotIndex);
  // FIXTURE-OK: 同 GRID_OVERLAY 人手改動的形狀一樣（填了一個不在名單上的人）
  const bad = base.map((s) => (gas.cellKey_(s.serviceDate, s.postId, s.slotIndex) === cKey
    ? Object.assign({}, s, { personId: 'P9799', isManual: true, assignSource: null }) : s));
  const elig = gas.findStateViolations_(bad, ctx).filter((v) => v.ruleId === gas.RULE_IDS.ELIGIBILITY);
  check('★★★★★ 不在名單照報', elig.length >= 1, JSON.stringify(elig));
  check('★★★★ isCarriedOverFromBase_：沒有上一版 ⇒ false', gas.isCarriedOverFromBase_(wCell, null) === false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
