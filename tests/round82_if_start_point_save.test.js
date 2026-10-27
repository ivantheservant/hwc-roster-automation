// 第八十二輪批次 IF 組：用舊版本作起點再〔儲存〕，一定要建立新一版。
// 執行方式：node tests/round82_if_start_point_save.test.js
//
// 手動測試 C：本來有第 0–3 版；以第 2 版作起點（「已把第 2 版寫入最新那一張職事表：5 格」）→〔儲存〕，
// 冇建立第 4 版。原因：儲存只靠 grid 偵測「人手改動」；起點標記本身唔算改動 ⇒ 偵測唔到差異嗰陣
// （例如兩版只係顯示字唔同，或者起點同最新一版內容一樣）就行零改動路徑——
// 初稿／審閱階段變成「沒有偵測到任何改動」或者「堂委沒有提出改動，當作意見已收齊」，冇新一版。
//
//   IF1　第 0–3 版；以第 1 版作起點（同第 3 版有幾格唔同）→ 唔再改 →〔儲存〕⇒ 第 4 版，來源「以第 1 版作起點」，列出嗰幾格
//   IF2　起點之後再改一格 ⇒ 新一版；人手格數只計之後改嘅
//   IF3　起點同最新一版內容一樣（grid 冇差異）⇒ 唔係零改動、照樣建立新一版、來源「以第 M 版作起點」
//   IF4　審閱階段（REVIEW_SENT）同一情況 ⇒ 唔會行「意見已收齊」嗰條零改動路
//   IF5　儲存窗「為甚麼要你看一看」有「你用了第 M 版作起點」；前端兩個窗都顯示起點一段

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

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
  const names = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf);
  sc.other = (v, d, p) => names.filter((n) => n !== sc.getCell(v, d, p))[0];
  sc.save = () => gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  sc.sourceOf = (no) => gas.listQuarterVersionChoices_(sc.Q, sc.TZ).filter((v) => v.versionNo === no)[0].sourceText;
  gas.apiGenerateDraftExecute(sc.Q);
  return sc;
}

console.log('\n=== IF1／IF2：以第 1 版作起點 ===');
{
  const sc = scene();
  const gas = sc.gas;
  const D = sc.DATES;
  sc.setCell(0, D[0], 'CHAIR#1', sc.other(0, D[0], 'CHAIR#1'));
  check('（準備）第 1 版', sc.save().versionNo === 1);
  sc.setCell(1, D[1], 'CHAIR#1', sc.other(1, D[1], 'CHAIR#1'));
  sc.setCell(1, D[2], 'CHAIR#1', sc.other(1, D[2], 'CHAIR#1'));
  check('（準備）第 2 版', sc.save().versionNo === 2);
  sc.setCell(2, D[3], 'CHAIR#1', sc.other(2, D[3], 'CHAIR#1'));
  check('（準備）第 3 版', sc.save().versionNo === 3);

  const sp = gas.apiUseVersionAsStartPoint(sc.Q, 1);
  check('（準備）以第 1 版作起點寫入 3 格', sp.cellCount === 3, JSON.stringify(sp));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ plan 唔係零改動', plan.zeroChange === false, JSON.stringify(plan).slice(0, 300));
  check('★★★★★ plan.startPoint：第 1 版、同第 3 版唔同嘅 3 格（主席，第 2–4 週）',
    plan.startPoint && plan.startPoint.versionNo === 1 && plan.startPoint.cells.length === 3
      && plan.startPoint.cells.every((c) => c.postId === 'CHAIR' && c.baseName && c.startName),
    JSON.stringify(plan.startPoint));
  check('★★★★★ 為甚麼要你看一看：START_POINT「你用了第 1 版作起點（與第 3 版不同的有 3 格）」',
    (plan.confirmReasons || []).some((r) => r.code === 'START_POINT' && r.text === '你用了第 1 版作起點（與第 3 版不同的有 3 格）'),
    JSON.stringify(plan.confirmReasons));
  const r = sc.save();
  check('★★★★★★ 建立第 4 版', r.ok === true && r.versionNo === 4, JSON.stringify(r).slice(0, 300));
  check('★★★★★ 來源「以第 1 版作起點」', sc.sourceOf(4) === '以第 1 版作起點', sc.sourceOf(4));
  check('★★★★★ 完成窗資料：startPointVersionNo＝1、3 格', r.startPointVersionNo === 1 && (r.startPointCells || []).length === 3,
    JSON.stringify([r.startPointVersionNo, r.startPointCells]));
  check('★★★★ 第 4 版＝第 1 版（三格都返返第 1 版個人）', [1, 2, 3].every((i) =>
    sc.getCell(4, D[i], 'CHAIR#1') === sc.getCell(1, D[i], 'CHAIR#1')));
  check('★★★★ 儲存之後冇未儲存改動、冇起點', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true
    && gas.apiSaveAndConfirmPlan(sc.Q).startPoint === null);

  // IF2：起點之後再改一格
  gas.apiUseVersionAsStartPoint(sc.Q, 2);
  sc.setCell(4, D[0], 'CHAIR#1', sc.other(4, D[0], 'CHAIR#1'));
  const r5 = sc.save();
  check('★★★★★★ IF2：起點之後再改一格 ⇒ 第 5 版、來源「以第 2 版作起點＋人手改動 1 格」',
    r5.versionNo === 5 && sc.sourceOf(5) === '以第 2 版作起點＋人手改動 1 格', [r5.versionNo, sc.sourceOf(5)].join('/'));
}

console.log('\n=== IF3：起點同最新一版內容一樣（grid 冇差異）===');
{
  const sc = scene();
  const gas = sc.gas;
  const D = sc.DATES;
  const was = sc.getCell(0, D[0], 'CHAIR#1');
  sc.setCell(0, D[0], 'CHAIR#1', sc.other(0, D[0], 'CHAIR#1'));
  sc.save();
  sc.setCell(1, D[0], 'CHAIR#1', was);
  check('（準備）第 2 版＝第 0 版內容', sc.save().versionNo === 2 && sc.getCell(2, D[0], 'CHAIR#1') === was);
  const sp = gas.apiUseVersionAsStartPoint(sc.Q, 0);
  check('（準備）起點寫入 0 格', sp.cellCount === 0, JSON.stringify(sp));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 唔係零改動（起點本身就係改動）', plan.zeroChange === false && plan.startPoint && plan.startPoint.cells.length === 0,
    JSON.stringify([plan.zeroChange, plan.startPoint]));
  const r = sc.save();
  check('★★★★★★ 照樣建立第 3 版，來源「以第 0 版作起點」', r.ok === true && r.versionNo === 3 && sc.sourceOf(3) === '以第 0 版作起點',
    JSON.stringify(r).slice(0, 300));
}

console.log('\n=== IF4：審閱階段 ===');
{
  const sc = scene();
  const gas = sc.gas;
  const D = sc.DATES;
  const was = sc.getCell(0, D[0], 'CHAIR#1');
  sc.setCell(0, D[0], 'CHAIR#1', sc.other(0, D[0], 'CHAIR#1'));
  sc.save();
  sc.setCell(1, D[0], 'CHAIR#1', was);
  sc.save();
  gas.advanceQuarterStage_(sc.Q, gas.QUARTER_STAGE.REVIEW_SENT);
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 審閱階段：唔會行「意見已收齊」零改動路', plan.zeroChange === false && plan.zeroChangeAction === null,
    JSON.stringify([plan.zeroChange, plan.zeroChangeAction]));
  const r = sc.save();
  check('★★★★★ 建立第 3 版', r.versionNo === 3 && r.zeroChange !== true, JSON.stringify(r).slice(0, 300));
}

console.log('\n=== IF5：前端 ===');
{
  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  check('★★★★★ 儲存窗顯示起點一段', /buildStartPointSection\(plan\.startPoint && plan\.startPoint\.versionNo/.test(z1));
  check('★★★★★ 完成窗顯示起點一段', /buildStartPointSection\(result\.startPointVersionNo, result\.startPointCells/.test(z1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
