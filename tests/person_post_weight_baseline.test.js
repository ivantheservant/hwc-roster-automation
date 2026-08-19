// 第二十八輪批次階段 A：排表偏好 `+N` 由「地板」改成「增量」。
// 執行方式：node tests/person_post_weight_baseline.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測（2027T4）：`+1` 完全冇效果
// ─────────────────────────────────────────────────────────────────────
//
// 設咗一行 `+1`（某人／當值堂委），重新生成之後：
//   該崗位次數 1 → **1**（冇變）
//   全崗位總數 6 → 6（上限 8，**未撞頂**）
//
// 排除咗「撞每季上限」。根因係語意：舊寫法係「排夠 `adjust` 次就停止加分」
// ——即係 `+1` 嘅實際意思係「**至少排到 1 次**」（一個地板），
// 唔係「**比原本多 1 次**」（一個增量）。
// 嗰位本身自然就排到 1 次，所以加分由頭到尾冇機會生效。
//
// ⚠️ 而畫面寫嘅係「這一季比系統原本會派的多大約一次」。
// **機制同承諾唔一致，而且冇量度，所以過咗一整輪都冇人發現。**
//
// 呢份測試就係嗰個「量度」嘅離線版本。

const { loadGasSource } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');

const gas = loadGasSource();

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const SRC = gas.WEIGHT_BASELINE_SOURCE;

/* ══════════════════════════════════════════════════════════════
 * A2　基準來源（純函式，離線測得到）
 * ══════════════════════════════════════════════════════════════ */

// ⚠️ 假 PersonID 一律 P9xxx，假名一律明顯係假。
const PREV = {
  prev: {
    quarterId: '2026T4',
    versionNo: 1,
    label: '2026年10-12月',
    byKey: { 'P9001|DEACON': 1, 'P9002|CHAIR': 3 }
  },
  historicalByKey: { 'P9003|USHER': 6 },
  pastQuarterCount: 4
};

console.log('\n=== A2【核心】基準來源三種，而且「查不到」同「0 次」分得開 ===');
{
  const hit = gas.resolveWeightBaseline_('P9001', 'DEACON', PREV);
  checkEqual('★★★★★ 上一季有排過 ⇒ 用實際次數，來源 PREV_QUARTER',
    { baseline: hit.baseline, source: hit.source }, { baseline: 1, source: SRC.PREV_QUARTER });

  const zero = gas.resolveWeightBaseline_('P9009', 'DEACON', PREV);
  checkEqual('★★★★★ 上一季**有版本**但佢冇排過 ⇒ 基準係一個**真實嘅 0**'
    + '（唔係「查不到」——兩者喺畫面上都印 0，但意思完全相反）',
    { baseline: zero.baseline, source: zero.source },
    { baseline: 0, source: SRC.PREV_QUARTER });

  const noPrev = { prev: null, historicalByKey: { 'P9003|USHER': 6 }, pastQuarterCount: 4 };
  const avg = gas.resolveWeightBaseline_('P9003', 'USHER', noPrev);
  checkEqual('★★★★ 冇上一季 ⇒ 用歷史平均（6 ÷ 4 季）',
    { baseline: avg.baseline, source: avg.source },
    { baseline: 1.5, source: SRC.HISTORICAL_AVERAGE });

  const none = gas.resolveWeightBaseline_('P9099', 'USHER', noPrev);
  checkEqual('★★★★★ 兩樣都冇 ⇒ 標示 NONE，**唔可以扮成 PREV_QUARTER 嘅 0 次**',
    { baseline: none.baseline, source: none.source },
    { baseline: 0, source: SRC.NONE });

  const notComputed = gas.resolveWeightBaseline_('P9001', 'DEACON', null);
  checkEqual('★★★★★ 完全冇準備基準資料 ⇒ NOT_COMPUTED'
    + '（同「查過，冇資料」都要分得開）',
    notComputed.source, SRC.NOT_COMPUTED);
}

console.log('\n=== A2 目標 ＝ 基準 ＋ 偏好，下限 0 ===');
{
  checkEqual('★★★★★ 基準 1 ＋ 多一次 ⇒ 目標 2', gas.computeWeightTarget_(1, 1), 2);
  checkEqual('★★★★★ 基準 3 ＋ 少兩次 ⇒ 目標 1', gas.computeWeightTarget_(3, -2), 1);
  checkEqual('★★★★★ 基準 1 ＋ 少兩次 ⇒ 目標 0（唔會變負數）',
    gas.computeWeightTarget_(1, -2), 0);
  checkEqual('★★★★ 小數基準先四捨五入再加（1.4 ＋ 一次 ＝ 2，唔係 2.4）'
    + '——「2.4 次」對幹事嚟講唔係一個意思',
    gas.computeWeightTarget_(1.4, 1), 2);
  checkEqual('★★★★★ 偏好 0 ⇒ 目標 ＝ 基準（零影響）',
    gas.computeWeightTarget_(3, 0), 3);
}

console.log('\n=== A3 畫面文字：三種來源講唔同嘅話 ===');
{
  const prev = gas.resolveWeightBaseline_('P9001', 'DEACON', PREV);
  const text = gas.describeWeightBaseline_(prev, '當值堂委', 2);
  check('★★★★★ 有上一季 ⇒ 講得出邊一季、幾多次、今季目標幾多次',
    text.indexOf('上一季（2026年10-12月）當值堂委 1 次') === 0
    && text.indexOf('今季目標 2 次') !== -1, text);

  const same = gas.describeWeightBaseline_(prev, '當值堂委', 1);
  check('★★★★ 目標同上一季一樣 ⇒ 明講「與上一季相同」'
    + '（否則幹事會以為個機制冇讀到嘢）',
    same.indexOf('（與上一季相同）') !== -1, same);

  const noPrev = { prev: null, historicalByKey: {}, pastQuarterCount: 4 };
  const none = gas.describeWeightBaseline_(
    gas.resolveWeightBaseline_('P9099', 'USHER', noPrev), '司事', 1);
  check('★★★★★ 冇基準 ⇒ **明講「沒有上一季的記錄，基準當作 0 次」**'
    + '——唔可以靜靜寫成「上一季 0 次」，後者係一個肯定句',
    none.indexOf('沒有上一季的記錄，基準當作 0 次') === 0, none);

  const avg = gas.describeWeightBaseline_(
    gas.resolveWeightBaseline_('P9003', 'USHER',
      { prev: null, historicalByKey: { 'P9003|USHER': 6 }, pastQuarterCount: 4 }),
    '司事', 3);
  check('★★★★ 用歷史平均 ⇒ 講明係歷史平均，唔會扮成上一季實數',
    avg.indexOf('用歷史平均每季 1.5 次做基準') !== -1, avg);
}

/* ══════════════════════════════════════════════════════════════
 * A5　驗收：真係跑一次排表
 * ══════════════════════════════════════════════════════════════ */

const POST = { CHAIR: 'CHAIR', ANNOUNCE: 'ANNOUNCE', DEACON: 'DEACON' };

function weightsWithBaseline(rows) {
  const byKey = {};
  const built = rows.map(function (r) {
    const entry = Object.assign({}, r, {
      baselineSource: SRC.PREV_QUARTER,
      baselineLabel: '2026年10-12月',
      target: gas.computeWeightTarget_(r.baseline, r.adjust)
    });
    byKey[entry.personId + '|' + entry.postId] = entry;
    return entry;
  });
  return { byKey: byKey, rows: built, invalid: [] };
}

function generate(options) {
  const ctx = mock.buildGeneratorContextMock(Object.assign({ gas: gas }, options || {}));
  return gas.buildRoster_(ctx);
}
function countFor(assignments, personId, postId) {
  return assignments.filter(function (a) {
    return a.personId === personId && a.postId === postId;
  }).length;
}

console.log('\n=== A5【最重要】空表 ⇒ 逐個位元一樣（安全性質不變）===');
{
  const plain = generate({ randomSeed: 7 });
  const withEmpty = generate({ randomSeed: 7, personPostWeights: weightsWithBaseline([]) });
  checkEqual('★★★★★ 逐格完全一樣——0 加落 bonus 係恆等元，'
    + '而且冇多抽任何一個亂數，所以連 tie-break 序列都唔會偏移',
    withEmpty.assignments.map(function (a) { return a.personId; }),
    plain.assignments.map(function (a) { return a.personId; }));
}

console.log('\n=== A5【核心】基準 N ＋ 1 ⇒ 真係排到 N+1（Ivan 撞到嗰個 case）===');
{
  const base = generate({ randomSeed: 11 });
  const baseA = base.assignments;

  // 揀一個「上一季排到 1 次」形狀嘅人：喺基準版本啱啱排到 1 次當值堂委。
  const deaconCounts = {};
  baseA.forEach(function (a) {
    if (a.postId !== POST.DEACON || !a.personId) return;
    deaconCounts[a.personId] = (deaconCounts[a.personId] || 0) + 1;
  });
  // 揀排得最少嗰個——佢就係「本身自然排到 N 次」嗰種形狀。
  // ⚠️ 唔可以寫死「排到啱啱 1 次嘅人」：mock 資料改一改就搵唔到，
  // 而搵唔到嗰陣呢個測試會靜靜咁乜都冇測到。
  const onceDeacon = Object.keys(deaconCounts).sort(function (a, b) {
    return deaconCounts[a] - deaconCounts[b] || (a < b ? -1 : 1);
  })[0];
  const baseline = deaconCounts[onceDeacon];

  check('★★★ 前置：搵到一個有排過當值堂委嘅人（基準 ' + baseline + ' 次）'
    + '——呢個就係 Ivan 實測撞到嗰個形狀：本身自然就排到嗰個數',
    !!onceDeacon, '當值堂委次數分佈：' + JSON.stringify(deaconCounts));

  const tuned = generate({
    randomSeed: 11,
    personPostWeights: weightsWithBaseline([
      { personId: onceDeacon, postId: POST.DEACON, adjust: 1, baseline: baseline, reason: 't' }
    ])
  });
  const before = countFor(baseA, onceDeacon, POST.DEACON);
  const after = countFor(tuned.assignments, onceDeacon, POST.DEACON);
  console.log('      基準 ' + baseline + ' 次 ＋ 多一次（目標 '
    + gas.computeWeightTarget_(baseline, 1) + '）⇒ ' + before + ' → ' + after);
  check('★★★★★ **次數真係升咗**'
    + '——舊語意（`+1` ＝「至少排到 1 次」）喺呢個 case 完全冇效果，'
    + '而畫面承諾嘅係「比原本多大約一次」',
    after > before, before + ' → ' + after);
}

console.log('\n=== A5 基準 3 ＋ 少兩次 ⇒ 跌到 1–2 次 ===');
{
  const base = generate({ randomSeed: 11 });
  const baseA = base.assignments;
  const chairCounts = {};
  baseA.forEach(function (a) {
    if (a.postId !== POST.CHAIR || !a.personId) return;
    chairCounts[a.personId] = (chairCounts[a.personId] || 0) + 1;
  });
  const heavy = Object.keys(chairCounts).sort(function (a, b) {
    return chairCounts[b] - chairCounts[a] || (a < b ? -1 : 1);
  })[0];
  const baseline = chairCounts[heavy];

  const tuned = generate({
    randomSeed: 11,
    personPostWeights: weightsWithBaseline([
      { personId: heavy, postId: POST.CHAIR, adjust: -2, baseline: baseline, reason: 't' }
    ])
  });
  const after = countFor(tuned.assignments, heavy, POST.CHAIR);
  console.log('      基準 ' + baseline + ' 次 ＋ 少兩次（目標 '
    + gas.computeWeightTarget_(baseline, -2) + '）⇒ ' + baseline + ' → ' + after);
  check('★★★★★ 次數**下降**', after < baseline, baseline + ' → ' + after);
  check('★★★★ 而且唔會一路跌到 0 以下（下限係 0，而且係軟規則）', after >= 0);
}

console.log('\n=== A2 目標算唔到就**拋錯**，唔可以靜靜回 0 ===');
{
  // 呢一條係本輪最重要嘅防線：上一輪個機制完全冇效果，
  // 就係因為佢**冇聲冇息**噉失效。
  //
  // ⚠️ 直接叫 `computePersonPostWeightBonus_()`，唔經 `buildRoster_()`——
  // 經排表嘅話，如果嗰個 PersonID 唔喺 mock 嘅候選人入面，
  // 呢一行根本唔會被執行到，測試就會靜靜咁「通過」而其實乜都冇測。
  const entry = { personId: 'P9001', postId: POST.CHAIR, adjust: 1 };
  const state = {
    post: { postId: POST.CHAIR },
    postCount: {},
    context: {
      personPostWeights: { rows: [entry], byKey: { 'P9001|CHAIR': entry }, invalid: [] }
    }
  };

  let threw = false;
  let message = '';
  try { gas.computePersonPostWeightBonus_('P9001', state); }
  catch (err) { threw = true; message = err.message; }

  check('★★★★★ 冇 target 嘅 entry ⇒ 拋錯，唔會靜靜當成「冇偏好」',
    threw, '冇拋錯');
  check('★★★★ 而且訊息講得出邊個呼叫端漏咗嘢',
    message.indexOf('buildGeneratorContext_') !== -1, message);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
