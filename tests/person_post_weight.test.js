// 第二十六輪批次階段 C：排表偏好 PersonPostWeight。
// 執行方式：node tests/person_post_weight.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 背景：堂委實際改咗乜
// ─────────────────────────────────────────────────────────────────────
//
// 堂委收到 2026T4 系統初稿之後改咗 23 格，**全部集中喺四個崗位**
// （主席、報告、當值堂委、聖餐襄禮），其餘十二個崗位一格都冇改。
//
// 三條意見形狀完全一樣：某人 × 某崗位 → 比平均多／少 N 次。
//
// ⚠️ 測試資料一律用 `P9xxx` 假 PersonID——真名唔可以入呢個公開 repo。
// （堂委嗰四行真實修訂嘅**形狀**照搬，只係換咗人。）

const { loadGasSource } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');
const A = require('./helpers/roster_assertions.js');

const gas = loadGasSource();
const POST = mock.POST;

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

/** 把幾行偏好砌成 context 要嘅形狀。 */
function weights(rows) {
  const byKey = {};
  rows.forEach(function (r) { byKey[r.personId + '|' + r.postId] = r; });
  return { byKey: byKey, rows: rows, invalid: [] };
}

function generate(options) {
  const ctx = mock.buildGeneratorContextMock(Object.assign({ gas: gas }, options || {}));
  const roster = gas.buildRoster_(ctx);
  return { ctx: ctx, roster: roster, hard: A.checkAllHardRules(gas, roster.assignments, ctx) };
}

/** 數某人喺某崗位排咗幾多次。 */
function countFor(assignments, personId, postId) {
  return assignments.filter(function (a) {
    return a.personId === personId && a.postId === postId;
  }).length;
}

/** 逐個崗位嘅用人分佈（PersonID → 次數），用嚟比較「有冇大變化」。 */
function distributionFor(assignments, postId) {
  const out = {};
  assignments.forEach(function (a) {
    if (a.postId !== postId || !a.personId) return;
    out[a.personId] = (out[a.personId] || 0) + 1;
  });
  return out;
}

console.log('\n=== C2【最重要】張表空嘅時候，結果同以前一模一樣 ===');
{
  // 呢個性質令新機制可以安全上線：堂委未開會之前，張表係空嘅，
  // 系統行為完全不變。
  const base = generate({ randomSeed: 7 });
  const withEmpty = generate({ randomSeed: 7, personPostWeights: weights([]) });

  checkEqual('★★★★★ 逐格完全一樣（唔止「差唔多」——係逐個位元一樣）'
    + '——0 加落 bonus 係恆等元，而且冇多抽任何一個亂數，'
    + '所以連 tie-break 序列都唔會偏移',
    withEmpty.roster.assignments.map(function (a) { return a.personId; }),
    base.roster.assignments.map(function (a) { return a.personId; }));

  // 連「完全冇 personPostWeights 呢個欄位」都要一樣——舊 context 唔會爆。
  const ctxNoField = mock.buildGeneratorContextMock({ gas: gas, randomSeed: 7 });
  delete ctxNoField.personPostWeights;
  const noField = gas.buildRoster_(ctxNoField);
  checkEqual('★★★★★ context 完全冇呢個欄位都唔會爆，而且結果一樣'
    + '（舊資料／舊呼叫端唔會因為新功能而壞）',
    noField.assignments.map(function (a) { return a.personId; }),
    base.roster.assignments.map(function (a) { return a.personId; }));
}

console.log('\n=== C3【驗收】用堂委真實修訂嘅形狀做基準 ===');
{
  // 揀四個真係喺對應崗位有資格嘅人做主角。
  const baseCtx = mock.buildGeneratorContextMock({ gas: gas, randomSeed: 11 });
  const chairPool = baseCtx.eligibility.byPost[POST.CHAIR] || [];
  const announcePool = baseCtx.eligibility.byPost[POST.ANNOUNCE] || [];
  const deaconPool = baseCtx.eligibility.byPost[POST.DEACON] || [];

  check('★★★ 前置：三個崗位都有足夠合資格人選（否則呢個測試冇意義）',
    chairPool.length >= 3 && announcePool.length >= 2 && deaconPool.length >= 2,
    'chair=' + chairPool.length + ' announce=' + announcePool.length + ' deacon=' + deaconPool.length);

  const base = generate({ randomSeed: 11 });
  const baseA = base.roster.assignments;

  // 揀「基準排最多主席」嗰個做「要減少」嘅人——最能睇出效果。
  const chairCounts = distributionFor(baseA, POST.CHAIR);
  const chairSorted = Object.keys(chairCounts).sort(function (a, b) {
    return chairCounts[b] - chairCounts[a] || (a < b ? -1 : 1);
  });
  const heavyChair = chairSorted[0];
  // 「要增加」嗰個：喺 chair pool 但基準排得最少（或者零次）。
  const lightChair = chairPool.filter(function (id) {
    return id !== heavyChair;
  }).sort(function (a, b) {
    return (chairCounts[a] || 0) - (chairCounts[b] || 0) || (a < b ? -1 : 1);
  })[0];
  const announcePerson = announcePool.filter(function (id) { return id !== heavyChair; })[0];
  const deaconPerson = deaconPool.indexOf(heavyChair) !== -1
    ? heavyChair : deaconPool[0];

  const rows = [
    { personId: heavyChair, postId: POST.CHAIR, adjust: -2, reason: '測試：少做主席' },
    { personId: lightChair, postId: POST.CHAIR, adjust: 1, reason: '測試：多做主席' },
    { personId: announcePerson, postId: POST.ANNOUNCE, adjust: 1, reason: '測試：多做報告' },
    { personId: deaconPerson, postId: POST.DEACON, adjust: 1, reason: '測試：多做當值堂委' }
  ];
  const tuned = generate({ randomSeed: 11, personPostWeights: weights(rows) });
  const tunedA = tuned.roster.assignments;

  const before = {
    heavyChair: countFor(baseA, heavyChair, POST.CHAIR),
    lightChair: countFor(baseA, lightChair, POST.CHAIR),
    announce: countFor(baseA, announcePerson, POST.ANNOUNCE),
    deacon: countFor(baseA, deaconPerson, POST.DEACON)
  };
  const after = {
    heavyChair: countFor(tunedA, heavyChair, POST.CHAIR),
    lightChair: countFor(tunedA, lightChair, POST.CHAIR),
    announce: countFor(tunedA, announcePerson, POST.ANNOUNCE),
    deacon: countFor(tunedA, deaconPerson, POST.DEACON)
  };
  console.log('      基準 → 加咗偏好：'
    + ' 主席(-2) ' + before.heavyChair + '→' + after.heavyChair
    + '｜主席(+1) ' + before.lightChair + '→' + after.lightChair
    + '｜報告(+1) ' + before.announce + '→' + after.announce
    + '｜當值堂委(+1) ' + before.deacon + '→' + after.deacon);

  check('★★★★★ 主席 -2 ⇒ 次數**下降**', after.heavyChair < before.heavyChair,
    before.heavyChair + ' → ' + after.heavyChair);
  check('★★★★★ 主席 +1 ⇒ 次數**上升**', after.lightChair > before.lightChair,
    before.lightChair + ' → ' + after.lightChair);
  check('★★★★★ 報告 +1 ⇒ 次數**唔會下降**（可能已經到上限）',
    after.announce >= before.announce, before.announce + ' → ' + after.announce);
  check('★★★★★ 當值堂委 +1 ⇒ 次數**唔會下降**',
    after.deacon >= before.deacon, before.deacon + ' → ' + after.deacon);

  // 「多大約一次」——唔可以由 1 次跳到 5 次。
  check('★★★★★ +1 嘅升幅係「大約一次」，唔會霸晒'
    + '（遞減加分：排夠 adjust 次就停）',
    after.lightChair - before.lightChair <= 3,
    '升咗 ' + (after.lightChair - before.lightChair) + ' 次');
}

console.log('\n=== C3【核心】堂委一格都冇改嘅十二個崗位，唔應該有大變化 ===');
{
  const base = generate({ randomSeed: 11 });
  const baseCtx = base.ctx;
  const chairPool = baseCtx.eligibility.byPost[POST.CHAIR] || [];
  const chairCounts = distributionFor(base.roster.assignments, POST.CHAIR);
  const heavyChair = Object.keys(chairCounts).sort(function (a, b) {
    return chairCounts[b] - chairCounts[a] || (a < b ? -1 : 1);
  })[0];
  const lightChair = chairPool.filter(function (id) { return id !== heavyChair; })[0];

  const tuned = generate({
    randomSeed: 11,
    personPostWeights: weights([
      { personId: heavyChair, postId: POST.CHAIR, adjust: -2, reason: 't' },
      { personId: lightChair, postId: POST.CHAIR, adjust: 1, reason: 't' }
    ])
  });

  // 堂委一格都冇改過呢十二個崗位。
  const untouched = [POST.SCRIPTURE, POST.WORSHIP, POST.PIANO, POST.USHER,
    POST.AUDIO, POST.PPT, POST.VIDEO, POST.TRAFFIC, POST.COUNTER];
  const drifted = [];
  untouched.forEach(function (postId) {
    const b = distributionFor(base.roster.assignments, postId);
    const t = distributionFor(tuned.roster.assignments, postId);
    // 「大變化」＝有人嘅次數差咗 2 次或以上。
    // 差 1 次係可接受嘅連鎖反應（主席換咗人，佢嗰週就騰咗手做第二樣）。
    Object.keys(b).concat(Object.keys(t)).forEach(function (id) {
      const diff = Math.abs((t[id] || 0) - (b[id] || 0));
      if (diff >= 2) drifted.push(postId + '/' + id + ' 差 ' + diff);
    });
  });
  checkEqual('★★★★★ 冇任何一個「堂委冇改過」嘅崗位出現 ≥2 次嘅用人變化'
    + '——偏好應該只郁到指定嗰個 (人, 崗位)，唔可以搞到成張表都唔同咗',
    drifted, []);
}

console.log('\n=== C2【核心】偏好永遠壓唔過硬規則 ===');
{
  // 用一個誇張到離譜嘅 adjust（超出容許範圍，但呢度直接餵 context，
  // 繞過 readActivePersonPostWeights_() 嘅範圍檢查）去證明：
  // **就算分數大到爆，硬規則一樣擋得住**——因為硬規則係喺比分數之前
  // 就隔走候選人（clean = scored.filter(!hasHard)）。
  const baseCtx = mock.buildGeneratorContextMock({ gas: gas, randomSeed: 3 });
  const chairPool = baseCtx.eligibility.byPost[POST.CHAIR] || [];
  const target = chairPool[0];

  const tuned = generate({
    randomSeed: 3,
    // 呢個人全季都唔能夠服侍
    unavailable: mock.buildUnavailable([target], '2099-01-01', '2099-12-31'),
    personPostWeights: weights([
      { personId: target, postId: POST.CHAIR, adjust: 999, reason: '極端測試' }
    ])
  });

  checkEqual('★★★★★ 就算 adjust=999，一個「不能服侍」嘅人一次都唔會被排'
    + '——硬規則喺比分數之前就隔走咗佢，呢個係結構保證，'
    + '唔係「數字啱啱好調到唔會壓過」',
    countFor(tuned.roster.assignments, target, POST.CHAIR), 0);
  // `checkAllHardRules()` 用兩套獨立方法各驗一次（引擎版＋獨立重算版），
  // `total` 係兩邊加埋——兩邊都要零。
  checkEqual('★★★★★ 而且全部硬規則仍然零違反（兩套獨立檢查都零）',
    tuned.hard.total, 0);
}

console.log('\n=== C1 讀表：範圍、生效期、解除方式 ===');
{
  const W = gas.COLUMNS.PERSON_POST_WEIGHT;
  const row = function (o) {
    const r = {};
    r[W.WEIGHT_ID] = o.id || 'W1';
    r[W.PERSON_ID] = o.personId || 'P9001';
    r[W.POST_ID] = o.postId || 'CHAIR';
    r[W.ADJUST] = o.adjust;
    r[W.ACTIVE] = o.active === false ? 'FALSE' : 'TRUE';
    r[W.EFFECTIVE_FROM] = o.from || '';
    r[W.EFFECTIVE_TO] = o.to || '';
    r[W.REASON] = o.reason || '堂委決議';
    return r;
  };
  const readWith = function (rows, refDate) {
    gas.readOptionalSheet_ = function () { return rows; };
    return gas.readActivePersonPostWeights_(refDate || '2027-01-01', 'Pacific/Auckland');
  };

  checkEqual('★★★★ 正常一行讀得到', readWith([row({ adjust: 1 })]).rows.length, 1);
  checkEqual('★★★★★ Active=FALSE 唔生效',
    readWith([row({ adjust: 1, active: false })]).rows.length, 0);
  checkEqual('★★★★★ **填咗 EffectiveTo（已過去）＝解除**，唔使刪行'
    + '——同 PersonPostExclusions 一致，要睇得返當時點決定',
    readWith([row({ adjust: 1, to: '2026-12-31' })]).rows.length, 0);
  checkEqual('★★★★ EffectiveTo 喺將來 ⇒ 仍然生效',
    readWith([row({ adjust: 1, to: '2099-12-31' })]).rows.length, 1);
  checkEqual('★★★★ EffectiveFrom 未到 ⇒ 未生效',
    readWith([row({ adjust: 1, from: '2099-01-01' })]).rows.length, 0);
  checkEqual('★★★★ Adjust=0 ⇒ 同冇呢一行一樣',
    readWith([row({ adjust: 0 })]).rows.length, 0);

  const outOfRange = readWith([row({ adjust: 9 })]);
  checkEqual('★★★★★ 超出 ±3 ⇒ **唔生效**', outOfRange.rows.length, 0);
  checkEqual('★★★★★ 而且列入 invalid 俾人睇'
    + '——**唔可以靜靜夾到範圍內**，嗰個等於系統擅自改咗堂委嘅決定',
    outOfRange.invalid.length, 1);

  gas.readOptionalSheet_ = function () { throw new Error('工作表未建立'); };
  const missing = gas.readActivePersonPostWeights_('2027-01-01', 'Pacific/Auckland');
  checkEqual('★★★★★ 工作表未建立 ⇒ 空結果，**唔拋錯**'
    + '（拋錯嘅話，一個未建表嘅環境連生成都做唔到）',
    { rows: missing.rows.length, keys: Object.keys(missing.byKey).length },
    { rows: 0, keys: 0 });
}

console.log('\n=== C2 品質統計一定要顯示結果 ===');
{
  // 一個「軟」機制冇量度嘅話，幹事同堂委都冇辦法知道「究竟有冇用」。
  const empty = gas.buildPersonPostWeightReport_([], { rows: [], invalid: [] }, {}, {});
  check('★★★★ 冇偏好時講明「目前沒有任何生效中的偏好」',
    /目前沒有任何生效中的偏好/.test(empty.lines[0]));

  const report = gas.buildPersonPostWeightReport_(
    [{ personId: 'P9001', postId: 'CHAIR' }, { personId: 'P9001', postId: 'CHAIR' },
      { personId: 'P9002', postId: 'CHAIR' }],
    { rows: [{ personId: 'P9001', postId: 'CHAIR', adjust: 1, reason: '堂委決議' }], invalid: [] },
    { P9001: { nameTC: '測試甲' } }, { CHAIR: '主席' });
  checkEqual('★★★★★ 逐行有：偏好、平均、目標、實際、差幾多', report.rows.length, 1);
  check('★★★★★ 實際次數係真數（P9001 排咗 2 次主席）',
    report.rows[0].actualCount === 2, JSON.stringify(report.rows[0]));
  check('★★★★ 有講明呢個係「軟」嘅，唔會剛好等於目標',
    report.lines.join('\n').indexOf('不會令系統違反任何規則') !== -1);

  const withBad = gas.buildPersonPostWeightReport_([],
    { rows: [{ personId: 'P9001', postId: 'CHAIR', adjust: 1, reason: '' }],
      invalid: [{ personId: 'P9002', postId: 'CHAIR', rawAdjust: '9' }] }, {}, {});
  check('★★★★★ 超範圍嗰啲要喺報告度列出嚟，而且講明「完全沒有生效」',
    withBad.lines.join('\n').indexOf('完全沒有生效') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
