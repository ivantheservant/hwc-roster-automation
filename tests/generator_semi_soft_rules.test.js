// 階段 A（Opus 深度輪）A4／A5：準硬規則與軟規則的量度測試。
// 執行方式：node tests/generator_semi_soft_rules.test.js
//
// 跟 tests/generator_hard_rules.test.js 的定位完全不同，不要混淆：
// - 硬規則測試是**保證**：任何一次違反都是嚴重 bug，門檻是「零」。
// - 這個檔案測的是**傾向**：準硬規則在資源足夠時應該接近零違反，軟規則
//   本來就容許讓步。所以這裡的斷言用的是**寬鬆的區間**，目的只有一個
//   ——偵測「演算法被改壞了」這種迴歸，不是強制達標。
//
// 區間怎麼定的：每一項都先用「刻意關掉對應規則」的對照組實測出「壞掉會是
// 什麼數值」，再把門檻定在正常值與壞掉值之間，並且刻意留很寬的餘裕。
// 每一節都附上實測到的對照數字，日後調整區間時有依據，不用重新摸索。

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
function inRange(label, value, min, max, note) {
  const ok = value >= min && value <= max;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}：實測 ${typeof value === 'number' ? value.toFixed(3) : value}`
    + `（容許 ${min}–${max}）`);
  if (note) console.log('      ' + note);
}

function generate(options) {
  const ctx = mock.buildGeneratorContextMock(Object.assign({ gas: gas }, options || {}));
  const roster = gas.buildRoster_(ctx);
  return {
    ctx: ctx,
    roster: roster,
    hard: A.checkAllHardRules(gas, roster.assignments, ctx),
    semi: A.findSemiHardViolationsViaEngine(gas, roster.assignments, ctx),
    soft: A.measureSoftRules(roster.assignments, ctx, POST.CHAIR, POST.ANNOUNCE)
  };
}

console.log('\n=== A4：準硬規則（同一崗位不可連續兩週用同一人）===');
{
  // 正常資源（貼近真實教會規模：13 週、89 人、技術崗位約 6 人）
  const normal = generate({});

  // 只計「AllowConsecutive ≠ ALLOW」的崗位——報告崗位刻意設成 ALLOW
  // （真實規則書把它列為「整個系統的洩壓閥」，容許約 27% 相鄰重複），
  // 把它算進違反率會令這一項永遠不合格，而那不是 bug。
  const blockingPosts = normal.ctx.posts.filter(function (p) {
    return p.autoGenerate && p.allowConsecutive !== 'ALLOW' && p.frequency === 'WEEKLY';
  });
  const adjacentPairs = blockingPosts.reduce(function (sum, p) {
    return sum + (normal.ctx.serviceDates.length - 1) * p.slotCount;
  }, 0);
  const rate = adjacentPairs === 0 ? 0 : normal.semi.length / adjacentPairs;

  console.log('      （' + blockingPosts.length + ' 個不容許連續的崗位，'
    + adjacentPairs + ' 組相鄰 pair，實測違反 ' + normal.semi.length + ' 項）');
  inRange('★ 正常資源下，準硬規則違反率接近 0%', rate, 0, 0.02,
    '真實規則書實測 78 週的相鄰重複率為 0–5%，2026T3 人手版為 0%；'
    + '這裡容許 2% 是給演算法一點餘裕，超過就代表選人邏輯出了問題。');

  checkEqual('★ 正常資源下硬規則仍然零違反（準硬規則不應該以犧牲硬規則換取）', normal.hard.total, 0);

  // 「違反時一定有警告」——用資源不足的情境逼出違反再驗證
  const people = mock.buildPeople(89);
  const pools = mock.defaultPoolSizes();
  pools[POST.TRAFFIC] = 1; // 1 個人排 13 週，第 2 週起必然連續
  const eligibility = mock.buildEligibility(people, pools);
  const forced = generate({ peopleById: people, eligibility: eligibility });
  const trafficSemi = forced.semi.filter(function (v) { return v.postId === POST.TRAFFIC; });

  check('★ 資源不足逼出準硬規則違反時，確實有違反被記錄（' + trafficSemi.length + ' 項）',
    trafficSemi.length > 0);
  check('★ 每一項準硬規則違反都有對應警告——不會靜靜地違反',
    trafficSemi.every(function (v) {
      return forced.roster.warnings.some(function (w) {
        return w.serviceDate === v.serviceDate && w.postId === v.postId && w.ruleId === v.ruleId;
      });
    }));
  checkEqual('★ 即使被逼違反準硬規則，硬規則依然零違反', forced.hard.total, 0);

  // 對照組：把 SEMI_NO_CONSECUTIVE 關掉，違反率應該明顯上升——證明上面的
  // 「接近 0%」是規則真的在生效，不是碰巧。
  const off = generate({ ruleOverrides: { SEMI_NO_CONSECUTIVE: { Enabled: 'FALSE' } } });
  const offAdjacent = blockingPosts.reduce(function (sum, p) {
    return sum + (off.ctx.serviceDates.length - 1) * p.slotCount;
  }, 0);
  // 規則關掉之後 findStateViolations_ 不再回報，改用獨立計算實際的相鄰重複
  let offRepeats = 0;
  blockingPosts.forEach(function (p) {
    const byDate = {};
    off.roster.assignments.forEach(function (a) {
      if (a.postId !== p.postId || !a.personId) return;
      if (!byDate[a.serviceDate]) byDate[a.serviceDate] = [];
      byDate[a.serviceDate].push(a.personId);
    });
    const dates = off.ctx.serviceDates.map(function (d) { return d.serviceDate; });
    for (let i = 1; i < dates.length; i++) {
      const prev = byDate[dates[i - 1]] || [];
      (byDate[dates[i]] || []).forEach(function (id) { if (prev.indexOf(id) !== -1) offRepeats++; });
    }
  });
  const offRate = offAdjacent === 0 ? 0 : offRepeats / offAdjacent;
  check('★ 對照組：關掉 SEMI_NO_CONSECUTIVE 後相鄰重複率明顯上升（'
    + (rate * 100).toFixed(1) + '% → ' + (offRate * 100).toFixed(1) + '%），'
    + '證明正常情況下的低違反率是規則真的在生效',
    offRate > rate, '若兩者一樣，代表這條規則其實沒有影響選人，需要調查');
}

console.log('\n=== A5：軟規則的實際數值是否落在合理範圍 ===');
{
  const normal = generate({});
  const s = normal.soft;

  // ---- 軟規則 1：主席兼報告的比例 ----
  // 真實規則書目標 62–64%。假資料的 CHAIR pool（13 人）與 ANNOUNCE pool（8 人）
  // 只重疊 7 人，理論上限本來就低於真實情況，所以**不能**直接套 62–64% 當門檻。
  // 對照組實測：關掉 SOFT_CHAIR_EQ_ANNOUNCE + SOFT_CHAIR_PREFER_DUAL 之後
  // 這個比例會跌到 0.000；正常設定下是 0.308。門檻定在 0.10 以上即可清楚
  // 分辨「機制還在」與「機制壞了」。上限 0.95 是防另一個方向的失控
  // （例如變成永遠讓主席兼報告，令報告崗位失去輪替）。
  inRange('★ 主席兼報告比例在合理範圍', s.chairEqAnnounceRatio, 0.10, 0.95,
    '對照組（關掉相關 SOFT 規則）實測為 0.000；正常設定實測 0.308。'
    + '真實資料的目標值是 62–64%，但假資料的兩個崗位人選池重疊度不同，'
    + '不能直接套用，所以這裡只驗證「機制有在運作」。');

  // ---- 軟規則 2：報告連續兩週同一人的比例 ----
  // 真實規則書目標約 27%（洩壓閥）。對照組實測：關掉 SOFT_ANNOUNCE_RELIEF
  // 之後跌到 0.000；正常設定下是 0.333。
  inRange('★ 報告連續兩週的比例在合理範圍', s.announceConsecutiveRatio, 0.05, 0.60,
    '對照組（關掉 SOFT_ANNOUNCE_RELIEF）實測為 0.000；正常設定實測 0.333。'
    + '真實目標約 0.27，這裡容許 0.05–0.60 的寬區間。');

  // ---- 軟規則 3：每人每季服侍次數貼近歷史分佈 ----
  // 真實規則書：2026T3 人手版 62 人服侍，平均 3.3 次，最高 8 次。
  inRange('★ 每人每季平均服侍次數貼近歷史（歷史平均 3.3）', s.avgCount, 2.0, 5.5);
  inRange('★ 單人最高服侍次數在合理範圍（歷史最高 8）', s.maxCount, 4, 10,
    '太低代表核心義工被過度壓制、分佈變得過於平均；太高代表負荷集中在少數人。');
  check('★ 有相當數量的人參與服侍（實測 ' + s.peopleServed + ' 人），不是集中在小圈子',
    s.peopleServed >= 30, '歷史上 2026T3 有 62 人服侍');

  console.log('      （實測摘要：' + s.weeks + ' 週　主席兼報告 '
    + (s.chairEqAnnounceRatio * 100).toFixed(1) + '%　報告連續 '
    + (s.announceConsecutiveRatio * 100).toFixed(1) + '%　'
    + s.peopleServed + ' 人服侍　平均 ' + s.avgCount.toFixed(2) + ' 次　最高 ' + s.maxCount + ' 次）');
}

console.log('\n=== A5 補充：軟規則讓步時，硬規則與準硬規則依然守得住 ===');
{
  // 把三條比例型 SOFT 規則的目標值調到極端，逼演算法用力偏向某一邊，
  // 確認即使軟規則被推到極限，硬規則仍然零違反。
  const extreme = generate({
    ruleOverrides: {
      SOFT_CHAIR_EQ_ANNOUNCE: { TargetValue: 1 },
      SOFT_ANNOUNCE_RELIEF: { TargetValue: 1 },
      SOFT_PERSONAL_QUOTA: { TargetValue: 0.1 }
    }
  });
  checkEqual('★ 軟規則目標推到極端時，硬規則依然零違反', extreme.hard.total, 0);
  console.log('      （極端設定下：主席兼報告 '
    + (extreme.soft.chairEqAnnounceRatio * 100).toFixed(1) + '%　報告連續 '
    + (extreme.soft.announceConsecutiveRatio * 100).toFixed(1) + '%　準硬規則違反 '
    + extreme.semi.length + ' 項）');
}

console.log('\n=== A2 附帶發現：RANDOM_SEED 對生成結果沒有影響（已記入 docs/系統範圍稽核.md）===');
{
  // 這一節不是在測「應該怎樣」，而是把一個實測到的事實鎖定成回歸測試：
  // 目前 seed 唯一的用途是 pickPerson_() 的 tieBreak，而它只在兩位候選人的
  // score 與 selectionScore 完全相等時才會被比較——selectionScore 是連續
  // 浮點數，實務上幾乎不會完全相等，所以換 seed 產生的職事表逐格一樣。
  //
  // 影響：generateBest()（MultiRun.gs）原本設計為「跑 N 次揀最好」，在這種
  // 資料下等於把同一份表算 N 次。本輪已經在 generateBest() 加了偵測與提早
  // 停止（見 MULTIRUN_SEED_PROBE_ATTEMPTS），輸出不變、時間大幅節省。
  //
  // 這個測試刻意寫成「記錄現況」而不是「斷言必須如此」：如果日後有人改動
  // 選人邏輯令 seed 真的產生分別，這一項會失敗，那時應該同步更新這裡的
  // 說明與 generateBest() 的偵測邏輯，而不是當成 bug。
  const signatures = {};
  for (let seed = 1; seed <= 10; seed++) {
    const ctx = mock.buildGeneratorContextMock({ gas: gas, randomSeed: seed });
    const roster = gas.buildRoster_(ctx);
    signatures[roster.assignments.map(function (a) { return a.personId || ''; }).join('|')] = true;
  }
  const distinct = Object.keys(signatures).length;
  checkEqual('★ 10 個不同 seed 只產生 1 份不同的職事表（記錄現況，見上方說明）', distinct, 1);
}

console.log('\n=== generateBest() 的「seed 無效就提早停止」偵測（本輪新增）===');
{
  // 載入 MultiRun.gs 取得真正的 buildRosterSignature_()／isBetterCandidate_()。
  // generateBest() 本身要讀試算表（buildGeneratorContext_），沒辦法在這裡直接
  // 呼叫，所以這一節移植它的迴圈停止條件（5 行），但簽名計算與「哪個候選較好」
  // 這兩個關鍵判斷都用正式碼真正那兩個函式，不是另寫一份。
  const gasMulti = loadGasSource(
    ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'FineTune.gs', 'MultiRun.gs']);

  /** 移植 generateBest() 的迴圈停止條件（逐字對應正式碼）。 */
  function simulateGenerateBest(planned, rosterForAttempt, evaluationForAttempt) {
    let best = null;
    let attemptsRun = 0;
    let stoppedBySeedInert = false;
    let firstSignature = null;
    let allIdenticalSoFar = true;

    for (let i = 0; i < planned; i++) {
      const roster = rosterForAttempt(i);
      const signature = gasMulti.buildRosterSignature_(roster);
      if (i === 0) firstSignature = signature;
      else if (signature !== firstSignature) allIdenticalSoFar = false;

      const record = Object.assign({ attemptIndex: i + 1 }, evaluationForAttempt(i));
      attemptsRun++;
      if (gasMulti.isBetterCandidate_(record, best)) { best = record; best.roster = roster; }

      if (allIdenticalSoFar && attemptsRun >= gasMulti.MULTIRUN_SEED_PROBE_ATTEMPTS && attemptsRun < planned) {
        stoppedBySeedInert = true;
        break;
      }
    }
    return { best: best, attemptsRun: attemptsRun, stoppedBySeedInert: stoppedBySeedInert };
  }

  // 情境 1：每次都產生同一份職事表（就是目前真實的行為）
  const sameRoster = { assignments: [{ personId: 'P001' }, { personId: 'P002' }] };
  const identical = simulateGenerateBest(20,
    function () { return sameRoster; },
    function () { return { hardViolations: 0, deviation: 5 }; });
  checkEqual('★ 20 次全部相同時，只跑 3 次就停（省下 17 次重複計算）', identical.attemptsRun, 3);
  checkEqual('★ 有標記 stoppedBySeedInert，UI 可以據此解釋原因', identical.stoppedBySeedInert, true);
  checkEqual('★ 選中的仍然是第 1 次（跟跑足 20 次的結果一樣）', identical.best.attemptIndex, 1);

  // 情境 2：seed 真的會產生不同結果時，不可以提早停——要跑足設定的次數，
  // 而且要正確揀出 deviation 最小的那一次。
  const deviations = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5];
  const varied = simulateGenerateBest(10,
    function (i) { return { assignments: [{ personId: 'P' + i }] }; },
    function (i) { return { hardViolations: 0, deviation: deviations[i] }; });
  checkEqual('★ 每次結果都不同時，跑足全部 10 次，不會提早停', varied.attemptsRun, 10);
  checkEqual('★ 沒有標記 stoppedBySeedInert', varied.stoppedBySeedInert, false);
  checkEqual('★ 正確揀出 deviation 最小的那一次（第 10 次）', varied.best.attemptIndex, 10);

  // 情境 3：頭 3 次相同、第 4 次才不同——因為第 3 次就停了，第 4 次跑不到。
  // 這是這個偵測機制唯一的取捨：理論上有可能錯過「頭幾次碰巧相同、後面才
  // 分岔」的資料。實測 30 個 seed 全部相同，代表現實中 seed 根本不參與決策，
  // 這個取捨的實際風險極低；而換來的是省掉 17/20 的重複計算。
  const lateDiverge = simulateGenerateBest(10,
    function (i) { return i < 3 ? sameRoster : { assignments: [{ personId: 'X' + i }] }; },
    function (i) { return { hardViolations: 0, deviation: i === 5 ? 0.1 : 5 }; });
  checkEqual('★ 已知取捨：頭 3 次相同就停，之後即使會分岔也跑不到', lateDiverge.attemptsRun, 3);

  // 情境 4：偵測不可以蓋過「有硬規則違反的一律排在後面」這條既有原則
  const withViolations = simulateGenerateBest(10,
    function (i) { return { assignments: [{ personId: 'P' + i }] }; },
    function (i) { return { hardViolations: i === 0 ? 3 : 0, deviation: i === 0 ? 0 : 9 }; });
  checkEqual('★ 有硬規則違反的候選即使 deviation 最低也不會被選中',
    withViolations.best.hardViolations, 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
