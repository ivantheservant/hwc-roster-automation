// 第五十一輪批次：自測機主流程仍然一步都未行過。
// 執行方式：node tests/selftest_mainflow.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場：第五十輪修好之後，自測機終於行得完——6 綠 9 紅 0 未跑
// ═════════════════════════════════════════════════════════════════════
//
// 逐條對過嗰九條紅：
//
//   S04  canSendUnsaved=false，因為有 3 格認唔出　⇒ 自測機（S03 種落）
//   S05  儲存被整批拒絕，因為有 3 格認唔出　　　　⇒ 自測機（S03 種落）
//   S06  未儲存 ＋ 認唔出 ⇒ 擋住　　　　　　　　　⇒ 連環
//   S07  Stage 仍然係 DRAFT　　　　　　　　　　　⇒ 連環
//   S09  Stage 仍然係 DRAFT　　　　　　　　　　　⇒ 連環
//   S10  自己又寫多 2 格認唔出嘅字　　　　　　　　⇒ 自測機（同 S03）
//   S11  訊息講「未儲存」而唔係「已經發出過」　　⇒ 連環
//   S12  只有 v0，回退唔到　　　　　　　　　　　　⇒ 連環
//   S14  嗰一日嘅 CHAIR 仍然有人　　　　　　　　　⇒ 見 C 組
//
// **系統本身喺嗰九條裡面一次都冇做錯過。**
// 每一次攔截都正確，每一段錯誤訊息都講得出三段。
//
// **但主流程 S05 → S13 到嗰日一步都冇真正執行過。**
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 要記住嘅一句
// ─────────────────────────────────────────────────────────────────────
//
// **測試揀「對系統影響最小」嘅做法，可能正好觸發系統最嚴厲嘅一道閘。**
//
// S03 想驗「未儲存格數數得對」，於是揀咗一個系統一定認唔出嘅字，
// 以為噉樣最乾淨。結果 `unresolvedCount` 變成 3，
// 而系統嘅規矩係「有認唔出嘅名就乜都唔准做」——
// 後面七條情境連環倒，主流程一步都冇跑過。
//
// 錯嘅唔係系統，係測試對系統嘅理解。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('src/SelfTestRunner.gs');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SeasonRehearsal.gs', 'QuarterReset.gs', 'Invariants.gs', 'SelfTestRunner.gs'
]);

// =====================================================================
console.log('\n=== A1【核心】第五十四輪：兩支「自己揀替代人選」已經拆走 ===');
{
  // ⚠️ 第五十一輪加咗 `selfTestPickReplacementName_()`，
  // 入面嗰句「優先揀合資格嘅，揀唔到就退而求其次」正正就係
  // 三輪紅嘅根源：**測試自己重新實作系統嘅接受條件。**
  //
  // 第五十四輪拆走咗佢，換成「寫入之後問 `apiSaveAndConfirmPlan()`」。
  // 呢一條守住佢唔會被人好心噉加返。
  check('★★★★★★ **`selfTestPickReplacementName_()` 已經冇咗**'
    + '——留低就係留低第二個算法，而系統有幾多道閘就會有幾多輪失敗',
    !/function selfTestPickReplacementName_\(/.test(SRC), '');
  check('★★★★★★ `selfTestWriteRealNames_()` 一樣冇咗',
    !/function selfTestWriteRealNames_\(/.test(SRC), '');
  check('★★★★★★ 而且冇人再叫佢哋',
    !/selfTestPickReplacementName_\(/.test(CODE)
      && !/selfTestWriteRealNames_\(/.test(CODE), '');
  check('★★★★★ 拆走嘅理由要留喺檔案入面'
    + '——冇解釋嘅話，下一個人會照樣加返一支',
    /測試喺度自己重新實作系統嘅接受條件/.test(SRC), '');
}

// =====================================================================
console.log('\n=== A2【核心】S03 要同時驗兩個數 ===');
{
  const s03 = CODE.slice(CODE.indexOf('function selfTestS03_('),
    CODE.indexOf('function selfTestS04_('));
  // 第五十三輪批次 A2 組：揀唔到三格嘅時候要照實際揀到嘅數目驗，
  // 所以唔再寫死 3。但仍然要驗——唔驗嘅話，一個「寫唔到格」
  // 嘅 S03 一樣綠。
  check('★★★★★ 仍然驗 `gridChangeCount` 對得上實際選到嘅格數',
    /gridChangeCount, want,/.test(s03), s03.slice(-900));
  // ⚠️ 唔可以淨係搵「有冇提到 unresolvedCount」——
  // `if (false) t.equal(…)` 一樣會中。要驗**佢係一句冇被關住嘅呼叫**：
  // 行首兩個空格、直接 `t.equal(`。verify-red 嗰陣就係噉捉到。
  check('★★★★★★ **而且驗 `unresolvedCount === 0`**'
    + '——冇呢一條，同一個坑下次仲會踩：'
    + '一個「最小改動」順手令系統整批擋住，'
    + '而報告上面 S03 仍然係綠嘅',
    /^  t\.equal\('而且 ' \+ want \+ ' 格全部認得出（unresolvedCount = 0）'/m.test(s03)
      && /unresolvedCount, 0,/.test(s03), s03.slice(-700));
  // ⚠️ 驗 `CODE`（剝走註釋）唔係 `SRC`——檔頭有幾句註釋喺度講返
  // 第五十輪嗰個做法點解錯，嗰幾句要留低。
  // 用 `SRC` 嘅話就係喺逼人刪走一段解釋歷史嘅註釋。
  check('★★★★★★ 而且唔再**寫入**「自測改動」呢類認唔出嘅字',
    !/自測改動/.test(CODE), '');
  // ⚠️ 「冇寫『自測改動』」唔夠——寫「認不出1」一樣係認唔出嘅字。
  // 要驗**佢真係行共用嗰支揀真名**。
  // 第五十四輪批次 A 組：S03 而家行批量路——寫入之後問系統。
  check('★★★★★★ S03 真係叫 `selfTestPickAcceptedCells_()`'
    + '——寫入之後問 `apiSaveAndConfirmPlan()`，'
    + '唔再自己實作一次「儲存會唔會被攔」',
    /const picked = selfTestPickAcceptedCells_\(quarterId, versionNo, 3, 'S03'\);/
      .test(s03), s03.slice(0, 900));
  check('★★★★★★ 而且真係驗 `needsRelease === false`'
    + '——呢一句就係攔住 S05 嗰道閘自己用嘅判斷',
    /^  t\.equal\('不需要打字放行（needsRelease = false）'/m.test(s03),
    s03.slice(-900));
  check('★★★★★★ 而且冇喺 S03 度直接叫 `selfTestWriteGridCell_()`'
    + '——直接叫就係繞過咗揀真名嗰一步',
    !/selfTestWriteGridCell_\(/.test(s03), s03.slice(0, 700));
  check('★★★★★★ S10 一樣唔再寫「自測重發」',
    !/自測重發/.test(CODE), '');
}

// =====================================================================
console.log('\n=== A4【核心】S10 開始之前先驗前置狀態 ===');
{
  const s10 = CODE.slice(CODE.indexOf('function selfTestS10_('),
    CODE.indexOf('function selfTestS11_('));
  // ⚠️ 要驗**個判斷本身**，唔係佢裡面嗰段文字——
  // `if (false) {` 之後嗰段文字仲喺度。
  check('★★★★★★ 表上唔乾淨 ⇒ **唔往下跑**'
    + '——第五十輪嗰次 S10 見到 S03 嘅殘留仍然硬跑，'
    + '而佢報嘅嘢同真正嘅問題無關',
    /if \(beforeUnsaved\.unresolvedCount > 0 \|\| beforeUnsaved\.gridChangeCount > 0\) \{/
      .test(s10) && /上一個情境留下了未清理的格/.test(SRC), s10.slice(0, 800));
  check('★★★★★ S10 行返同一條批量路',
    /const picked = selfTestPickAcceptedCells_\(quarterId, versionNo, 2, 'S10'\);/
      .test(s10), s10.slice(0, 900));
  check('★★★★★★ 「冇碰過嘅人」要連**新填嗰幾個**都算入去'
    + '——改一格會令兩個人受影響（本來嗰個少咗、新填嗰個多咗）',
    /result\.picks\.map\(function \(p\) \{ return p\.pick\.personId; \}\)/.test(s10)
      && /const touched = picked\.cells\.map/.test(s10),
    s10.slice(-800));
}

// =====================================================================
console.log('\n=== A3【核心】S16：認唔出嘅名獨立一條，而且自己收拾 ===');
{
  const registry = CODE.slice(CODE.indexOf('function selfTestScenarios_('));
  const ids = (registry.match(/id: 'S\d\d'/g) || []).map(function (m) {
    return m.replace(/id: '|'/g, '');
  });
  // 第五十三輪批次 B 組：S17（打字放行）排喺 S16 之後，一樣自己收拾。
  // 兩條都會污染現場，所以兩條都要排後面。
  checkEqual('★★★★★★ S16 同 S17 排喺**最後兩條**'
    + '——放中間又會污染後面每一條',
    ids.slice(-2).join('、'), 'S16、S17');
  check('★★★★★ 有 `selfTestS16_()`',
    /function selfTestS16_\(quarterId\) \{/.test(CODE), '');

  const s16 = CODE.slice(CODE.indexOf('function selfTestS16_('));
  check('★★★★★★ 驗「儲存被拒絕」',
    /儲存被拒絕（整批，不是只跳過那一格）/.test(SRC), '');
  check('★★★★★★ 驗「訊息講得出係邊一格、格內而家係乜」',
    /訊息講得出是哪一格/.test(SRC) && /訊息講得出那一格現在是什麼字/.test(SRC), '');
  check('★★★★★★ 驗「職事表冇任何改動（版本數冇增加）」',
    /職事表沒有任何改動（版本數沒有增加）/.test(SRC), '');
  check('★★★★★★ **佢自己收拾**：把嗰一格改返原本嘅文字',
    /selfTestWriteGridCell_\(quarterId, versionNo, cell\.serviceDate,\s*\n\s*cell\.postId, cell\.slotIndex, originalName\);/
      .test(s16), s16.slice(-900));
  check('★★★★★★ 而且收拾之後驗 `unresolvedCount` 回到 0'
    + '——唔驗嘅話，下一次執行會喺一個污染狀態下開始',
    /收拾之後 unresolvedCount 回到 0/.test(SRC), '');
}

// =====================================================================
console.log('\n=== B1【核心】S04：前置條件唔成立就唔驗後面嗰條 ===');
{
  const s04 = CODE.slice(CODE.indexOf('function selfTestS04_('),
    CODE.indexOf('function selfTestS05_('));
  check('★★★★★★ `canSendUnsaved !== true` ⇒ **直接 return，唔驗後面**'
    + '——`buildUnsavedSendPreview_()` 喺嗰個前提下回空預覽係**啱嘅**，'
    + '一個根因報成兩條紅會令報告睇落比實際嚴重',
    /if \(s\.canSendUnsaved !== true\) \{[\s\S]{0,600}return t\.result\(\);/.test(s04),
    s04.slice(-800));
  check('★★★★★ 而且講明「前置條件不成立，下面那一條不驗」',
    /前置條件不成立，下面那一條不驗/.test(SRC), '');
}

// =====================================================================
console.log('\n=== C【核心】S14：真實入口靜靜噉冇做嘢 ===');
{
  const s14 = CODE.slice(CODE.indexOf('function selfTestS14_('),
    CODE.indexOf('function selfTestS15_('));

  // C3：用返啱嗰支入口。
  check('★★★★★★ 用 `apiGenerateRoster()`（「進階功能 ▸ 重新生成初稿」嗰條路）'
    + '——`apiGenerateDraftExecute()` 喺一個已經有版本嘅季度上面'
    + '只會回 `{ok:false}`，乜都唔做',
    /apiGenerateRoster\(quarterId\)/.test(s14)
      && !/apiGenerateDraftExecute\(quarterId\)/.test(s14), s14.slice(0, 400));
  check('★★★★★★ **冇繞過保護直接叫底層**'
    + '——繞過去就等於冇行過真實入口，而呢一層嘅價值就係嗰件事',
    !/performRosterGeneration_/.test(s14), '');

  // C2：驗「重新生成真係發生咗」。
  check('★★★★★★ 叫之前記低版本號，叫完再讀一次，斷言**增加咗**'
    + '——冇呢一條，一個「乜都冇做」嘅呼叫會令後面每一條斷言'
    + '攞住舊版本去驗',
    /const versionBefore = findLatestVersionNo\(quarterId\);/.test(s14)
      && /versionNo, versionBefore \+ 1,/.test(s14), s14.slice(0, 900));
  check('★★★★★★ 冇新版本 ⇒ **唔往下驗**，而且貼出回傳值'
    + '——第五十輪就係噉報咗「那一天的 CHAIR 在 v0 有 1 個有人的格」，'
    + '一句完全誤導嘅結論',
    /if \(versionNo !== versionBefore \+ 1\) \{[\s\S]{0,500}return t\.result\(\);/.test(s14)
      && /apiGenerateRoster\(\) 回傳：/.test(s14), s14.slice(0, 1200));

  // C3：S14／S15 要排喺 Stage 仍然係 DRAFT 嗰陣。
  const ids = gas.selfTestScenarios_().map(function (x) { return x.id; });
  checkEqual('★★★★★★ 執行次序：S14／S15 排喺 S02 之後'
    + '——`apiGenerateRoster()` 要 Stage=DRAFT，'
    + '跑到 S09 之後 Stage 係 OFFICIAL_SENT，嗰陣一定被擋',
    ids.slice(0, 5).join(' '), 'S01 S02 S14 S15 S03');
  check('★★★★★★ 而且報告要講明「按執行次序排，不按編號」'
    + '——唔講嘅話，Ivan 會以為報告亂咗',
    /情境按執行次序排，不按編號/.test(SRC), '');

  // C4：收拾放喺 S15。
  const s15 = CODE.slice(CODE.indexOf('function selfTestS15_('),
    CODE.indexOf('function selfTestDeactivateSpecialSunday_('));
  check('★★★★★★ 收拾放喺 **S15**，唔係 S14'
    + '——S15 要用 S14 種落嗰一行；S14 自己收拾嘅話，'
    + 'S15 就會冇嘢可以數，而佢會報一個同系統無關嘅紅',
    /selfTestDeactivateSpecialSunday_\(quarterId \+ '-SELFTEST'\)/.test(s15), '');
  check('★★★★★★ 收拾係**設成 `Active=FALSE`，唔刪行**（留住做證據）',
    /setValue\('FALSE'\)/.test(CODE) && !/deleteRow/.test(CODE), '');
}

// =====================================================================
console.log('\n=== D【核心】連環倒要報成「被擋住」，唔係九條獨立嘅紅 ===');
{
  checkEqual('★★★★★ 有 `BLOCKED` 狀態',
    gas.SELFTEST_STATUS.BLOCKED, 'BLOCKED');

  // D1：依賴關係。
  const scenarios = gas.selfTestScenarios_();
  const byId = {};
  scenarios.forEach(function (x) { byId[x.id] = x; });
  check('★★★★★★ S06 依賴 S05',
    (byId.S06.dependsOn || []).indexOf('S05') !== -1,
    JSON.stringify(byId.S06.dependsOn));
  check('★★★★★★ S09 依賴 S07（而 S07 依賴 S06，S06 依賴 S05）',
    (byId.S09.dependsOn || []).length > 0
      && (byId.S07.dependsOn || []).indexOf('S06') !== -1,
    JSON.stringify({ S07: byId.S07.dependsOn, S09: byId.S09.dependsOn }));
  check('★★★★★ S11／S12 都有依賴',
    (byId.S11.dependsOn || []).length > 0 && (byId.S12.dependsOn || []).length > 0,
    JSON.stringify({ S11: byId.S11.dependsOn, S12: byId.S12.dependsOn }));

  // ⚠️ 依賴唔可以指住一個排喺自己後面嘅情境。
  const order = scenarios.map(function (x) { return x.id; });
  const badDeps = [];
  scenarios.forEach(function (x, i) {
    (x.dependsOn || []).forEach(function (dep) {
      if (order.indexOf(dep) === -1 || order.indexOf(dep) > i) {
        badDeps.push(x.id + ' → ' + dep);
      }
    });
  });
  checkEqual('★★★★★★ 冇一個情境依賴一個排喺佢後面嘅情境'
    + '——噉樣嘅依賴永遠唔會生效，而佢睇落好似有防護',
    JSON.stringify(badDeps), '[]');

  // D1：實作。
  // ⚠️ 同上：`if (false) {` 之後嗰段 push 仲喺度。要驗個判斷本身。
  check('★★★★★★ 上游紅／ERROR／BLOCKED ⇒ 標 `BLOCKED`（唔係紅）',
    /if \(blockedBy\.length > 0\) \{/.test(CODE)
      && /status: SELFTEST_STATUS\.BLOCKED, checks: \[\], failedChecks: \[\]/.test(CODE),
    '');
  check('★★★★★ 而且註記講明被邊個擋住',
    /'（被 ' \+ blockedBy\.join\('、'\) \+ ' 擋住，沒有跑。'/.test(CODE), '');
  check('★★★★★★ 續跑嗰陣，上一次嘅結論都算數'
    + '——否則一個「上一次紅、今次跳過」嘅上游就唔會擋到下游',
    /Object\.keys\(state\)\.forEach\(function \(id\) \{ byId\[id\] = state\[id\]; \}\);/
      .test(CODE), '');

  // D2：報告摘要。
  const report = {
    blocked: false, quarterId: '2028T3', resetSummary: '已清乾淨',
    totalMs: 60000, scenarioMs: 30000, invariantMs: 30000, finalInvariants: null,
    results: [
      { id: 'S05', title: '儲存並確認', status: 'FAILED',
        failedChecks: [{ label: 'x', expected: '1', actual: '0', evidence: '由 y 來' }] },
      { id: 'S06', title: '寄審閱', status: 'BLOCKED', failedChecks: [],
        note: '（被 S05 擋住，沒有跑。）' },
      { id: 'S07', title: '套用申報', status: 'BLOCKED', failedChecks: [] }
    ],
    passedCount: 6, failedCount: 1, errorCount: 0, notRunCount: 0,
    stoppedForTime: false
  };
  const lines = gas.describeSelfTestReport_(report).join('\n');
  check('★★★★★★ 摘要行**獨立數出「被擋住」**'
    + '——`BLOCKED` 唔等於通過。只數綠同紅嘅話，'
    + '一份「6 綠 1 紅」嘅報告睇落好似情況唔錯，'
    + '而實際上有兩條根本冇跑過',
    /2 被擋住/.test(lines), lines.split('\n')[0]);
  check('★★★★★★ 而且分開兩節印：真正失敗 ／ 被上游擋住',
    /🔴 真正失敗（1 條）/.test(lines) && /🚧 被上游擋住（2 條/.test(lines), lines);
  check('★★★★★ 被擋住嗰節列咗編號，一眼睇得晒',
    /S06　S07/.test(lines), lines);
  check('★★★★★★ 下一步要講明「紅同被擋住嘅都會重跑」',
    /會重跑紅的同被擋住的那幾個/.test(lines), lines.slice(-400));

  // D3：只重跑紅色情境要一併清走 BLOCKED。
  const cleared = gas.clearFailedSelfTestState_({
    S01: { status: 'PASSED' }, S05: { status: 'FAILED' },
    S06: { status: 'BLOCKED' }, S15: { status: 'SKIPPED' }
  });
  checkEqual('★★★★★★ 「只重跑紅色情境」連 `BLOCKED` 都清走'
    + '——唔清嘅話，修好上游之後，被擋住嗰幾條仍然唔會跑，'
    + '而嗰幾條先係整件事嘅重點',
    cleared.clearedIds.sort().join(','), 'S05,S06');
  checkEqual('★★★★★ 綠同跳過嘅保留',
    (!!cleared.state.S01) + '|' + (!!cleared.state.S15), 'true|true');
}

// =====================================================================
console.log('\n=== E1【核心】「4 分 60 秒」 ===');
{
  // 299.6 秒：舊寫法 ⇒ 分鐘 = floor(4.99) = 4、秒 = round(59.6) = 60。
  checkEqual('★★★★★★ 299.6 秒 ⇒ 「5 分 0 秒」，唔係「4 分 60 秒」',
    gas.describeSelfTestDuration_(299600), '5 分 0 秒');
  checkEqual('★★★★★ 300 秒 ⇒ 5 分 0 秒',
    gas.describeSelfTestDuration_(300000), '5 分 0 秒');
  checkEqual('★★★★★ 59.6 秒 ⇒ 1 分 0 秒（唔係「60 秒」）',
    gas.describeSelfTestDuration_(59600), '1 分 0 秒');
  checkEqual('★★★★★ 252 秒 ⇒ 4 分 12 秒',
    gas.describeSelfTestDuration_(252000), '4 分 12 秒');
  checkEqual('★★★★★ 42 秒', gas.describeSelfTestDuration_(42000), '42 秒');
  checkEqual('★★★★★ 0', gas.describeSelfTestDuration_(0), '0 秒');
}

// =====================================================================
console.log('\n=== E2【核心】證據欄唔可以把「實際」抄多一次 ===');
{
  const same = gas.describeSelfTestReport_({
    blocked: false, quarterId: '2028T3', resetSummary: '',
    results: [{ id: 'S11', title: 'x', status: 'FAILED',
      failedChecks: [{ label: '一條斷言', expected: '提到已經發出過',
        actual: '一段好長嘅訊息', evidence: '一段好長嘅訊息' }] }],
    passedCount: 0, failedCount: 1, errorCount: 0, notRunCount: 0,
    stoppedForTime: false, finalInvariants: null
  }).join('\n');
  checkEqual('★★★★★★ 「證據」同「實際」一模一樣 ⇒ **只印一次**'
    + '——證據欄應該講呢個值由邊度嚟，唔係把個值再抄一次',
    (same.match(/一段好長嘅訊息/g) || []).length, 1);

  const different = gas.describeSelfTestReport_({
    blocked: false, quarterId: '2028T3', resetSummary: '',
    results: [{ id: 'S11', title: 'x', status: 'FAILED',
      failedChecks: [{ label: '一條斷言', expected: '1', actual: '0',
        evidence: 'apiStep4Confirm() 的回傳' }] }],
    passedCount: 0, failedCount: 1, errorCount: 0, notRunCount: 0,
    stoppedForTime: false, finalInvariants: null
  }).join('\n');
  check('★★★★★ 唔一樣就照印',
    /證據：apiStep4Confirm\(\) 的回傳/.test(different), different);
}

// =====================================================================
console.log('\n=== 驗收：S05–S13 每一條都要有得跑 ===');
{
  const ids = gas.selfTestScenarios_().map(function (x) { return x.id; });
  ['S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13']
    .forEach(function (id) {
      check('★★★★★ ' + id + ' 仍然喺登記表', ids.indexOf(id) !== -1, ids.join(' '));
    });
  checkEqual('★★★★★ 一共 17 條情境（第五十三輪批次加咗 S17）', ids.length, 17);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
