// 自我測試 S17 揀「一定違反硬規則」嗰一格：違反嘅身分證**唔包 personId**。
// 執行方式：node tests/selftest_violating_pick_key.test.js
//
// 取代已刪除嘅 tests/selftest_safe_cell_pick.test.js（第五十四輪刪走）——
// 舊突變 `pick-key-person` 一直指住嗰個檔，變成永遠 RED OK 嘅空心防線（第七十五輪交接發現）。
//
// 原理：一格本來就違反緊（已知），換咗個同樣唔合資格嘅人，違反依然係「同一條」。
// 身分證如果包 personId，就會被當成「新違反」，於是一格本來已經違規嘅格都會被揀中——
// 而 S17 要驗嘅係「換完之後多咗一條 HARD」，唔係「有冇問題」。

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'SelfTestRunner.gs'] });
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);

console.log('\n=== 身分證唔包 personId ===');
{
  const a = gas.selfTestViolationKey_({ ruleId: 'HARD_ELIGIBILITY', serviceDate: D[0], postId: 'WORSHIP', slotIndex: 1, personId: 'P9704' });
  const b = gas.selfTestViolationKey_({ ruleId: 'HARD_ELIGIBILITY', serviceDate: D[0], postId: 'WORSHIP', slotIndex: 1, personId: 'P9705' });
  check('★★★★★ 同一格同一條規則、換咗人 ⇒ 同一個身分證', a === b, a + ' / ' + b);
}

console.log('\n=== 揀格：本來已經違規嘅格唔會被揀中 ===');
{
  // 第 1 週：主席、讀經放一個唔喺任何名單嘅人（P9706）⇒ 已違規而且冇其他「唔合資格」嘅人可以換；
  // 領詩放 P9704（唔喺領詩名單）⇒ 已違規，但仲有 P9705、P9706、P9707 可以換。
  const bad = sc.nameOf('P9706');
  sc.setCell(0, D[0], 'CHAIR#1', bad);
  sc.setCell(0, D[0], 'READ#1', bad);
  sc.setCell(0, D[0], 'WORSHIP#1', sc.nameOf('P9704'));
  const picked = gas.selfTestPickViolatingCell_(sc.Q, 0);
  check('（準備）揀得到一格', picked && picked.ruleId === 'HARD_ELIGIBILITY', JSON.stringify(picked));
  check('★★★★★★ 本來已經違規嘅領詩格（第 1 週）唔會被揀中——要揀「換完多咗一條」嘅格',
    picked && !(picked.serviceDate === D[0] && picked.postId === 'WORSHIP'), JSON.stringify(picked));
  check('★★★★★ 揀中嘅格本來冇違規（換咗先違）', picked && picked.serviceDate !== D[0], JSON.stringify(picked));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
