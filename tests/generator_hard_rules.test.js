// 階段 A（Opus 深度輪）：排表演算法的硬規則保證測試。
// 執行方式：node tests/generator_hard_rules.test.js
//
// 這是全系統最核心、之前卻完全沒有自動化覆蓋的部分——「系統絕不自動違反
// 硬規則」這句話，在這個測試檔出現之前只有 2027T1 一次輸出的統計數字支持，
// 沒有任何可重複執行的證據。
//
// 測的是 **src/Generator.gs 真正那份程式碼**，不是移植的副本：
// tests/helpers/gas_loader.js 把 .gs 原始碼載入 Node 沙箱直接呼叫（詳見該檔
// 說明）。斷言則兩層並行——重用正式碼的 findStateViolations_()，再加一層
// 完全不看 RuleSettings 的獨立結構檢查（詳見 tests/helpers/roster_assertions.js）。
//
// ⚠️ 本輪用這個測試抓到一個真實的演算法 bug（已修正，見 A3-2 那一節與
// docs/系統範圍稽核.md）：原本 pickPerson_() 在「候選人池非空、但每個人都
// 違反至少一條 HARD 規則」時，會挑違規最輕的一個硬派下去（assignSource=
// FORCED），即場造成硬規則違反。最典型的觸發情境是「某崗位全部合資格的人
// 剛好在同一週都申報了不能服侍」——一個真實會發生的情況。

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
  if (!ok && extra) console.log(extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/** 跑一次生成，回傳 {ctx, roster, hard}。 */
function generate(options) {
  const ctx = mock.buildGeneratorContextMock(Object.assign({ gas: gas }, options || {}));
  const roster = gas.buildRoster_(ctx);
  return { ctx: ctx, roster: roster, hard: A.checkAllHardRules(gas, roster.assignments, ctx) };
}

console.log('\n=== A1 前置：確認斷言本身抓得到違反（不是永遠回傳零的空殼）===');
{
  // 刻意造一份「明知違反」的排表餵進斷言，證明兩層檢查真的會出聲。
  // 沒有這一步，「全部測試都零違反」有可能只是斷言壞了。
  const ctx = mock.buildGeneratorContextMock({ gas: gas });
  const good = gas.buildRoster_(ctx).assignments;

  // (a) 崗位資格：把某格改派一個不在該崗位 pool 的人
  const tamperedEligibility = good.map(function (a) { return Object.assign({}, a); });
  const audioCell = tamperedEligibility.filter(function (a) { return a.postId === POST.AUDIO && a.personId; })[0];
  const outsider = Object.keys(ctx.peopleById).filter(function (id) {
    return (ctx.eligibility.byPost[POST.AUDIO] || []).indexOf(id) === -1;
  })[0];
  audioCell.personId = outsider;
  const r1 = A.checkAllHardRules(gas, tamperedEligibility, ctx);
  check('★ 斷言抓得到「派了不在 Eligibility 名單的人」（兩層都要抓到）',
    r1.engine.length >= 1 && r1.independent.length >= 1, A.describeViolations(r1));

  // (b) 同週同崗位重複：把司事2 改成跟司事1 同一人
  const tamperedDistinct = good.map(function (a) { return Object.assign({}, a); });
  const usherCells = tamperedDistinct.filter(function (a) { return a.postId === POST.USHER; });
  const firstDate = usherCells[0].serviceDate;
  const sameWeek = usherCells.filter(function (a) { return a.serviceDate === firstDate; });
  sameWeek[1].personId = sameWeek[0].personId;
  const r2 = A.checkAllHardRules(gas, tamperedDistinct, ctx);
  check('★ 斷言抓得到「同週 司事1 = 司事2」（兩層都要抓到）',
    r2.engine.length >= 1 && r2.independent.length >= 1, A.describeViolations(r2));

  // (c) 講員不自動生成：把講員格塞一個人
  const tamperedPreacher = good.map(function (a) { return Object.assign({}, a); });
  const preacherCell = tamperedPreacher.filter(function (a) { return a.postId === POST.PREACHER; })[0];
  preacherCell.personId = (ctx.eligibility.byPost[POST.PREACHER] || ['P001'])[0];
  const r3 = A.checkAllHardRules(gas, tamperedPreacher, ctx);
  check('★ 斷言抓得到「講員崗位被派人」（兩層都要抓到）',
    r3.engine.length >= 1 && r3.independent.length >= 1, A.describeViolations(r3));

  // (d) 聖餐襄禮：把非首主日的聖餐格塞一個人
  const tamperedCommunion = good.map(function (a) { return Object.assign({}, a); });
  const nonFirst = ctx.serviceDates.filter(function (d) { return !d.isFirstSundayOfMonth; })[0];
  const communionCell = tamperedCommunion.filter(function (a) {
    return a.postId === POST.COMMUNION && a.serviceDate === nonFirst.serviceDate;
  })[0];
  communionCell.personId = (ctx.eligibility.byPost[POST.COMMUNION] || ['P001'])[0];
  const r4 = A.checkAllHardRules(gas, tamperedCommunion, ctx);
  check('★ 斷言抓得到「聖餐襄禮出現在非每月首主日」（兩層都要抓到）',
    r4.engine.length >= 1 && r4.independent.length >= 1, A.describeViolations(r4));

  // (e) 不能服侍：先造 Unavailable，再把該人排在該日
  const person = good.filter(function (a) { return a.postId === POST.TRAFFIC && a.personId; })[0];
  const ctxUnav = mock.buildGeneratorContextMock({
    gas: gas,
    unavailable: mock.buildUnavailable([person.personId], person.serviceDate, person.serviceDate)
  });
  const r5 = A.checkAllHardRules(gas, good, ctxUnav);
  check('★ 斷言抓得到「當事人已表明該日不能服侍卻被派」（兩層都要抓到）',
    r5.engine.length >= 1 && r5.independent.length >= 1, A.describeViolations(r5));
}

console.log('\n=== A2：正常資源下，30 種不同輸入 × 不同亂數種子，硬規則必須全部零違反 ===');
{
  // ⚠️ 重要發現（已寫入 docs/系統範圍稽核.md）：單純換 RANDOM_SEED **完全不會**
  // 改變生成結果——seed 唯一的用途是 pickPerson_() 的 tieBreak，而它只在兩位
  // 候選人的 score 與 selectionScore 完全相等時才會被比較，實務上幾乎不發生。
  // 所以這裡不只換 seed，同時逐輪改變資料形狀（週數、人數、崗位人數、歷史
  // 權重、Unavailable 密度），才是真正有意義的 30 次不同輸入。
  let violatingRuns = 0;
  let totalCells = 0;
  let totalAssigned = 0;
  const failures = [];

  for (let i = 0; i < 30; i++) {
    const weekCount = 11 + (i % 4);            // 11–14 週
    const peopleCount = 60 + (i % 5) * 10;     // 60–100 人
    const poolScale = 1 - (i % 3) * 0.15;      // 崗位人數 100%／85%／70%
    const pools = mock.defaultPoolSizes();
    Object.keys(pools).forEach(function (k) {
      pools[k] = Math.max(2, Math.round(pools[k] * poolScale));
    });

    const people = mock.buildPeople(peopleCount);
    const eligibility = mock.buildEligibility(people, pools);
    const dates = mock.buildServiceDates('2099T1', '2099-01-04', weekCount);

    // 每輪讓一批不同的人在一段不同的日期不能服侍（涵蓋 0–3 個人）
    const unavailableCount = i % 4;
    const allIds = Object.keys(people).sort();
    const targets = [];
    for (let k = 0; k < unavailableCount; k++) targets.push(allIds[(i * 7 + k * 11) % allIds.length]);
    const from = dates[i % dates.length].serviceDate;
    const to = dates[Math.min(dates.length - 1, (i % dates.length) + 1)].serviceDate;

    const out = generate({
      randomSeed: i + 1,
      weekCount: weekCount,
      peopleById: people,
      eligibility: eligibility,
      historicalWeight: [0, 0.35, 0.65, 1][i % 4],
      unavailable: targets.length > 0 ? mock.buildUnavailable(targets, from, to) : []
    });

    totalCells += out.roster.assignments.length;
    totalAssigned += out.roster.assignments.filter(function (a) { return a.personId; }).length;

    if (out.hard.total > 0) {
      violatingRuns++;
      if (failures.length < 3) {
        failures.push('  第 ' + (i + 1) + ' 輪（' + weekCount + ' 週／' + peopleCount + ' 人／pool×'
          + poolScale.toFixed(2) + '）：\n' + A.describeViolations(out.hard, 3));
      }
    }
  }

  checkEqual('★ 30 輪全部零硬規則違反（任何一輪違反都是嚴重 bug）', violatingRuns, 0);
  if (failures.length > 0) console.log(failures.join('\n'));
  console.log('      （30 輪合計 ' + totalCells + ' 格，其中 ' + totalAssigned + ' 格有派人）');
  check('★ 30 輪確實有真正派到人（不是因為全部留空才「零違反」）', totalAssigned > totalCells * 0.5);
}

console.log('\n=== A3-1：某崗位合資格人數剛好等於週數（資源剛好夠）===');
{
  const weekCount = 13;
  const people = mock.buildPeople(89);
  const pools = mock.defaultPoolSizes();
  pools[POST.AUDIO] = weekCount; // 剛好 13 個人排 13 週
  const eligibility = mock.buildEligibility(people, pools);
  const out = generate({ weekCount: weekCount, peopleById: people, eligibility: eligibility });

  checkEqual('★ 零硬規則違反', out.hard.total, 0);
  const audioFilled = out.roster.assignments.filter(function (a) {
    return a.postId === POST.AUDIO && a.personId;
  }).length;
  check('★ 資源剛好夠時，該崗位仍然全部排滿（' + audioFilled + ' / ' + weekCount + '）', audioFilled === weekCount);
}

console.log('\n=== A3-2：某崗位全部合資格的人在同一週都不能服侍（本輪抓到 bug 的情境）===');
{
  // 這正是修正前會出事的情境：候選人池非空，但當週每個人都違反 HARD_UNAVAILABLE。
  // 修正前 pickPerson_() 會挑「違規最輕」的一個硬派下去（assignSource=FORCED），
  // 即場造成 HARD_UNAVAILABLE 違反；修正後改為留空並發出警告。
  const people = mock.buildPeople(89);
  const pools = mock.defaultPoolSizes();
  const eligibility = mock.buildEligibility(people, pools);
  const audioPool = eligibility.byPost[POST.AUDIO];
  const dates = mock.buildServiceDates('2099T1', '2099-01-04', 13);
  const targetWeek = dates[2].serviceDate;

  const out = generate({
    peopleById: people,
    eligibility: eligibility,
    unavailable: mock.buildUnavailable(audioPool, targetWeek, targetWeek)
  });

  checkEqual('★ 零硬規則違反（修正前這裡會是 1 項 HARD_UNAVAILABLE）', out.hard.total, 0);

  const cell = out.roster.assignments.filter(function (a) {
    return a.postId === POST.AUDIO && a.serviceDate === targetWeek;
  })[0];
  checkEqual('★ 該格留空，不是硬派一個當日不能服侍的人', cell.personId, '');
  checkEqual('★ 該格標記為 SKIPPED（不是 FORCED）', cell.assignSource, gas.ASSIGN_SOURCE.SKIPPED);
  check('★ 有產生對應的警告，不會靜靜留空',
    out.roster.warnings.some(function (w) {
      return w.postId === POST.AUDIO && w.serviceDate === targetWeek;
    }));
  checkEqual('★ 整份職事表完全沒有 FORCED 格（FORCED 機制已移除）',
    out.roster.assignments.filter(function (a) { return a.assignSource === gas.ASSIGN_SOURCE.FORCED; }).length, 0);

  // 其餘週不受影響——留空只影響出事那一格，不是整個崗位放棄
  const otherWeeksFilled = out.roster.assignments.filter(function (a) {
    return a.postId === POST.AUDIO && a.serviceDate !== targetWeek && a.personId;
  }).length;
  checkEqual('★ 其餘 12 週的該崗位照常排滿（留空只影響出事那一格）', otherWeeksFilled, 12);
}

console.log('\n=== A3-3：某崗位合資格人數少於週數（一定要重複用人）===');
{
  const weekCount = 13;
  const people = mock.buildPeople(89);

  // (a) 3 個人排 13 週：一定要重複用人，但「連續兩週」在數學上仍然避得開
  //     （三人輪流 A,B,C,A,B,C… 永遠不會連續），所以正確的預期是
  //     **零硬規則違反、而且連準硬規則都零違反**。
  //     （設計這一項時原本以為 3 人排 13 週必定連續，是錯的——避開連續只需要
  //     2 個人就夠，跟總週數無關。這個更正本身也值得留在測試裡當說明。）
  const poolsThree = mock.defaultPoolSizes();
  poolsThree[POST.PIANO] = 3;
  const eligThree = mock.buildEligibility(people, poolsThree);
  const three = generate({ weekCount: weekCount, peopleById: people, eligibility: eligThree });

  checkEqual('★ [3 人 13 週] 零硬規則違反', three.hard.total, 0);
  checkEqual('★ [3 人 13 週] 該崗位全部排滿',
    three.roster.assignments.filter(function (a) { return a.postId === POST.PIANO && a.personId; }).length, weekCount);
  const threeSemi = A.findSemiHardViolationsViaEngine(gas, three.roster.assignments, three.ctx)
    .filter(function (v) { return v.postId === POST.PIANO; });
  checkEqual('★ [3 人 13 週] 連準硬規則都零違反（3 個人輪流足夠避開連續兩週）', threeSemi.length, 0);

  // (b) 只有 1 個人排 13 週：真正無解——除了第一週，之後每一週都必然跟上一週
  //     同一人。這正是準硬規則「無解時可違反，但一定要顯示警告」的設計意圖：
  //     硬規則仍然零違反，準硬規則違反則要每一項都有警告。
  const poolsOne = mock.defaultPoolSizes();
  poolsOne[POST.PIANO] = 1;
  const eligOne = mock.buildEligibility(people, poolsOne);
  const one = generate({ weekCount: weekCount, peopleById: people, eligibility: eligOne });

  checkEqual('★ [1 人 13 週] 零硬規則違反（人手不足只可以犧牲準硬規則，不可以犧牲硬規則）', one.hard.total, 0);
  checkEqual('★ [1 人 13 週] 該崗位仍然全部排滿',
    one.roster.assignments.filter(function (a) { return a.postId === POST.PIANO && a.personId; }).length, weekCount);

  const oneSemi = A.findSemiHardViolationsViaEngine(gas, one.roster.assignments, one.ctx)
    .filter(function (v) { return v.postId === POST.PIANO; });
  checkEqual('★ [1 人 13 週] 連續兩週的準硬規則違反被完整記錄（第 2–13 週共 12 項）',
    oneSemi.length, weekCount - 1);
  check('★ [1 人 13 週] 每一項準硬規則違反都有對應警告，不會靜靜違反',
    oneSemi.every(function (v) {
      return one.roster.warnings.some(function (w) {
        return w.serviceDate === v.serviceDate && w.postId === v.postId && w.ruleId === v.ruleId;
      });
    }));
}

console.log('\n=== A3-4：某崗位完全沒有合資格的人 ===');
{
  const people = mock.buildPeople(89);
  const pools = mock.defaultPoolSizes();
  const eligibility = mock.buildEligibility(people, pools);
  eligibility.byPost[POST.VIDEO] = []; // 錄影崗位一個合資格的人都沒有
  const out = generate({ peopleById: people, eligibility: eligibility });

  checkEqual('★ 零硬規則違反', out.hard.total, 0);
  const videoCells = out.roster.assignments.filter(function (a) { return a.postId === POST.VIDEO; });
  checkEqual('★ 該崗位每一週都留空', videoCells.filter(function (a) { return a.personId; }).length, 0);
  check('★ 每一週都有警告（不會靜靜地整個崗位空白）',
    videoCells.every(function (c) {
      return out.roster.warnings.some(function (w) {
        return w.postId === POST.VIDEO && w.serviceDate === c.serviceDate;
      });
    }));
  // 其他崗位不受影響
  const otherAssigned = out.roster.assignments.filter(function (a) {
    return a.postId !== POST.VIDEO && a.personId;
  }).length;
  check('★ 其他崗位不受影響，照常排滿（' + otherAssigned + ' 格有派人）', otherAssigned > 100);
}

console.log('\n=== A3-5：大量 Unavailable 令某一週幾乎全部崗位都無人可派 ===');
{
  const people = mock.buildPeople(89);
  const pools = mock.defaultPoolSizes();
  const eligibility = mock.buildEligibility(people, pools);
  const dates = mock.buildServiceDates('2099T1', '2099-01-04', 13);
  const badWeek = dates[5].serviceDate;
  // 全部 89 人在該週都不能服侍
  const out = generate({
    peopleById: people,
    eligibility: eligibility,
    unavailable: mock.buildUnavailable(Object.keys(people), badWeek, badWeek)
  });

  checkEqual('★ 零硬規則違反（極端情況下寧可整週留空，也絕不違反硬規則）', out.hard.total, 0);
  const thatWeek = out.roster.assignments.filter(function (a) { return a.serviceDate === badWeek; });
  checkEqual('★ 該週完全沒有派任何人', thatWeek.filter(function (a) { return a.personId; }).length, 0);
  const otherWeeksAssigned = out.roster.assignments.filter(function (a) {
    return a.serviceDate !== badWeek && a.personId;
  }).length;
  check('★ 其餘 12 週完全不受影響（' + otherWeeksAssigned + ' 格有派人）', otherWeeksAssigned > 100);
}

console.log('\n=== A3-6：合併壓力（週數多、人數少、崗位人數削半、多人不能服侍）===');
{
  const people = mock.buildPeople(30); // 只有 30 人要撐 15 個崗位
  const pools = mock.defaultPoolSizes();
  Object.keys(pools).forEach(function (k) { pools[k] = Math.max(2, Math.round(pools[k] * 0.4)); });
  const eligibility = mock.buildEligibility(people, pools);
  const dates = mock.buildServiceDates('2099T1', '2099-01-04', 14);
  const allIds = Object.keys(people).sort();
  const unav = mock.buildUnavailable(allIds.slice(0, 10), dates[3].serviceDate, dates[6].serviceDate);

  const out = generate({
    weekCount: 14, peopleById: people, eligibility: eligibility, unavailable: unav
  });
  checkEqual('★ 零硬規則違反', out.hard.total, 0);
  checkEqual('★ 完全沒有 FORCED 格',
    out.roster.assignments.filter(function (a) { return a.assignSource === gas.ASSIGN_SOURCE.FORCED; }).length, 0);
}

console.log('\n=== A3-7：特別主日（SkipPostIDs）與硬規則並存 ===');
{
  const dates = mock.buildServiceDates('2099T1', '2099-01-04', 13);
  const specialDate = dates[4].serviceDate;
  const specialByDate = {};
  specialByDate[specialDate] = { specialId: 'SP1', skipPostIds: [POST.WORSHIP, POST.PIANO], lockPostIds: [] };
  const out = generate({ specialByDate: specialByDate });

  checkEqual('★ 零硬規則違反', out.hard.total, 0);
  const skipped = out.roster.assignments.filter(function (a) {
    return a.serviceDate === specialDate && (a.postId === POST.WORSHIP || a.postId === POST.PIANO);
  });
  checkEqual('★ SkipPostIDs 指定的兩個崗位該週留空', skipped.filter(function (a) { return a.personId; }).length, 0);
  check('★ 留空原因標記為特別主日跳過（不是「排不出人」）',
    skipped.every(function (a) { return (a.ruleFlags || []).indexOf(gas.RULE_IDS.SPECIAL_SUNDAY_SKIP) !== -1; }));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
