// 第五十三輪批次 B 組：「有硬規則違反、要打字放行」嗰條路。
// 執行方式：node tests/selftest_release_scenario.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 兩件事
// ═════════════════════════════════════════════════════════════════════
//
// 一、S05 現在驗的是「乾淨儲存」。「打字放行」那條路同樣重要
// 　　（幹事真實會遇到——名單未更新的時候就會撞到），
// 　　但它**不可以擋住主流程**。所以它自己一條 S17，排在最後，自己收拾。
//
// 二、⚠️ 順手查出來的：一次「打字放行硬規則違反」在 `AuditLog` 裡面
// 　　**沒有任何紀錄**。`RosterVersions` 那句 note 只寫「人手改動 N 格」，
// 　　看起來同一次乾淨儲存一模一樣。
//
// 　　即是說：一個違反了硬規則、由人手放行的版本，事後**沒有任何方法
// 　　分得出它同一個乾淨版本的分別**。而放行這個動作的意思就是
// 　　「我知道這裡違規，我照樣要」——那句話不留低，就等於沒有講過。

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

const FILES = [
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'ArgShape.gs',
  'StateSource.gs', 'Roles.gs', 'Generator.gs', 'FineTune.gs', 'SelfTestRunner.gs'
];

/** 同 A 組嗰份一樣嘅最小 context。 */
function makeContext(gas, byPost, state, people, unavailable) {
  const C = gas.COLUMNS.RULE_SETTINGS;
  const makeRule = function (id) {
    const r = {};
    r[C.RULE_ID] = id;
    r[C.ENABLED] = 'TRUE';
    r[C.LEVEL] = gas.RULE_LEVELS.HARD;
    return r;
  };
  const peopleById = {};
  people.forEach(function (id) {
    peopleById[id] = { personId: id, nameTC: '假' + id, email: '', maxPerQuarter: null };
  });
  return {
    quarterId: '2028T3', versionNo: 0, timezone: 'Asia/Hong_Kong',
    original: state, gridValues: {},
    gridRender: { labels: {}, autoGenerateByPostId: { CHAIR: true, USHER: true } },
    serviceDates: ['2028-07-02', '2028-07-09', '2028-07-16'].map(function (d, i) {
      return { serviceDateId: 'D' + i, serviceDate: d, isFirstSundayOfMonth: i === 0 };
    }),
    posts: [
      { postId: 'CHAIR', postNameTC: '主席', autoGenerate: true, frequency: 'WEEKLY' },
      { postId: 'USHER', postNameTC: '司事', autoGenerate: true, frequency: 'WEEKLY' }
    ],
    eligibility: { byPost: byPost },
    roles: [], personPostExclusions: [],
    peopleById: peopleById, unavailable: unavailable || [],
    rules: (function () {
      const r = {};
      r[gas.RULE_IDS.ELIGIBILITY] = makeRule(gas.RULE_IDS.ELIGIBILITY);
      r[gas.RULE_IDS.UNAVAILABLE] = makeRule(gas.RULE_IDS.UNAVAILABLE);
      return r;
    })(),
    maxMoves: 5, maxPerQuarterDefault: 8, warnOnSemiHard: false
  };
}

function cell(dateIdx, postId, slotIndex, personId) {
  return {
    serviceDateId: 'D' + dateIdx,
    serviceDate: ['2028-07-02', '2028-07-09', '2028-07-16'][dateIdx],
    postId: postId, slotIndex: slotIndex, personId: personId, isManual: false
  };
}

// =====================================================================
console.log('\n=== B1【核心】揀一格「啱啱多咗一條硬規則違反」的 ===');
{
  const gas = loadGasSource(FILES);
  // P1 CHAIR、P2 USHER。P3 邊個崗位都唔合資格 ⇒ 換佢入去一定違反。
  const context = makeContext(gas,
    { CHAIR: ['P1'], USHER: ['P2'] },
    [cell(0, 'CHAIR', 1, 'P1'), cell(1, 'USHER', 1, 'P2')],
    ['P1', 'P2', 'P3']);
  gas.buildFineTuneContext_ = function () { return context; };
  gas.log_ = function () {};

  const target = gas.selfTestPickViolatingCell_('2028T3', 0);
  check('★★★★★★ 揀得到一格', !!target, JSON.stringify(target));
  // ⚠️ 驗「唔喺呢個崗位嘅名單上面」，唔係寫死一個 ID——
  // 寫死嘅話，一個揀咗 P2 去做 CHAIR（一樣唔合資格）嘅實作會被報成錯，
  // 而佢其實完全對。
  const pool = context.eligibility.byPost[target.postId] || [];
  check('★★★★★★ 而且揀嘅係一個該崗位**唔合資格**嘅人'
    + '——呢一支係 `selfTestPickSafeCells_()` 嘅反面，而且係特登嘅',
    pool.indexOf(target.replacement.personId) === -1,
    target.postId + ' 嘅名單：' + pool.join('、')
      + '　揀咗：' + target.replacement.personId);
  checkEqual('★★★★★★ 而且講得出撞到邊一條規則'
    + '——唔講嘅話，S17 報「被拒絕」之後冇人知係邊條規則攔住',
    target.ruleId, gas.RULE_IDS.ELIGIBILITY);
  check('★★★★★★ 而且記低原本嗰個人嘅名——收拾嗰陣要寫返',
    target.originalName === '假P1' || target.originalName === '假P2',
    JSON.stringify(target));
}

// =====================================================================
console.log('\n=== B1【核心】多過一條違反嘅候選人 ⇒ 唔要，揀啱啱一條嗰個 ===');
{
  // ⚠️ P3 排喺前面，但佢**同時**唔合資格 ＋ 嗰一日請咗假 ⇒ **兩條**違反。
  // 　 P4 只係唔合資格 ⇒ **一條**。
  //
  // 收咗 P3 嘅話，S17 見到「被拒絕」之後就分唔出係邊條規則攔住佢——
  // 而 S17 存在嘅理由就係要驗「系統講唔講得出係邊一條」。
  const gas = loadGasSource(FILES);
  // ⚠️ P3 要排喺 P4 前面——排喺後面嘅話，P4 會先被收咗，
  // 而「有冇跳過 P3」就完全驗唔到。
  const context = makeContext(gas,
    { CHAIR: ['P1'], USHER: ['P1'] },
    [cell(0, 'CHAIR', 1, 'P1')],
    ['P1', 'P3', 'P4'],
    [{ personId: 'P3', dateFrom: '2028-07-02', dateTo: '2028-07-02',
      appliesTo: 'ALL', postIds: [] }]);
  gas.buildFineTuneContext_ = function () { return context; };
  gas.log_ = function () {};

  const target = gas.selfTestPickViolatingCell_('2028T3', 0);
  check('★★★★★★ 揀得到', !!target, JSON.stringify(target));
  checkEqual('★★★★★★ **跳過 P3（兩條違反），揀 P4（啱啱一條）**'
    + '——收咗兩條嘅話，S17 報「被拒絕」之後就分唔出係邊條規則攔住',
    target ? target.replacement.personId : '（冇）', 'P4');
  checkEqual('★★★★★ 而且報得出係邊一條', target ? target.ruleId : '',
    gas.RULE_IDS.ELIGIBILITY);
}

// =====================================================================
console.log('\n=== B1 冇一個人會令佢啱啱多一條 ⇒ 回 null，唔好硬揀 ===');
{
  const gas = loadGasSource(FILES);
  // 全部人喺兩個崗位都合資格 ⇒ 換邊個都唔會違反。
  const context = makeContext(gas,
    { CHAIR: ['P1', 'P2', 'P3'], USHER: ['P1', 'P2', 'P3'] },
    [cell(0, 'CHAIR', 1, 'P1'), cell(1, 'USHER', 1, 'P2')],
    ['P1', 'P2', 'P3']);
  gas.buildFineTuneContext_ = function () { return context; };
  gas.log_ = function () {};
  checkEqual('★★★★★★ 揀唔到就回 `null`'
    + '——硬揀一個「多咗兩條違反」嘅格，S17 就會分唔出係邊條攔住',
    gas.selfTestPickViolatingCell_('2028T3', 0), null);
}

// =====================================================================
console.log('\n=== B1 S17 排喺登記表最後，而且 `dependsOn` 唔會擋住主流程 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SeasonRehearsal.gs', 'QuarterReset.gs', 'Invariants.gs', 'SelfTestRunner.gs'
  ]);
  const list = gas.selfTestScenarios_();
  const ids = list.map(function (x) { return x.id; });
  checkEqual('★★★★★★ S17 排喺最後'
    + '——佢會種一格違反落去，放中間就會污染後面每一條',
    ids[ids.length - 1], 'S17');
  const s17 = list.filter(function (x) { return x.id === 'S17'; })[0];
  checkEqual('★★★★★ 依賴 S05（要有一個存得到嘅底）',
    (s17.dependsOn || []).join('、'), 'S05');
  check('★★★★★★ **冇一條情境依賴 S17**'
    + '——依賴佢嘅話，一條「造唔出放行情境」嘅季度就會擋住其他嘢，'
    + '而 S17 本身係一條唔應該影響主流程嘅旁支',
    list.every(function (x) { return (x.dependsOn || []).indexOf('S17') === -1; }),
    JSON.stringify(list.map(function (x) {
      return x.id + ':' + (x.dependsOn || []).join(',');
    })));
}

// =====================================================================
console.log('\n=== B1 S17 驗嘅五件事 ===');
{
  const SRC = read('src/SelfTestRunner.gs');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const s17 = CODE.slice(CODE.indexOf('function selfTestS17_('));

  check('★★★★★★ 一、故意填一個唔合資格嘅人'
    + '——經 `selfTestPickViolatingCell_()`，唔係自己寫死一個名',
    /const target = selfTestPickViolatingCell_\(quarterId, versionNo\);/.test(s17),
    s17.slice(0, 600));
  check('★★★★★★ 二、唔帶放行字眼儲存 ⇒ 要被拒絕'
    + '——⚠️ 佢係**拋錯**，唔係回 `{ok:false}`，所以要 catch',
    /catch \(err\) \{\s*\n\s*refused = err\.message;/.test(s17)
      && /t\.expect\('不帶放行字眼就儲存 ⇒ 被拒絕'/.test(s17), s17.slice(0, 2200));
  check('★★★★★★ 而且被拒絕之後版本號唔准變'
    + '——訊息話「職事表沒有任何改動」，就真係唔可以有',
    /t\.equal\('被拒絕之後，版本號沒有變/.test(s17), '');
  check('★★★★★★ 三、帶住放行字眼再叫一次 ⇒ 存得到，而且真係多咗一版',
    /releaseText: SAVE_CONFIRM_RELEASE_TEXT/.test(s17)
      && /t\.expect\('而且真的多了一版', afterRelease > versionNo,/.test(s17),
    s17.slice(0, 3600));
  check('★★★★★★ 四、`AuditLog` 記低咗放行咗幾多格',
    /String\(r\[A\.ACTION\] \|\| ''\)\.trim\(\) === '放行硬規則違反'/.test(s17), '');
  check('★★★★★★ 五、自己收拾：改返原本嗰個人，而且驗 `gridChangeCount` 回到 0'
    + '——唔收拾嘅話，呢一季就永遠帶住一格違反，'
    + '而下一次重跑每一條情境都會見到佢',
    /target\.slotIndex, target\.originalName\);/.test(s17)
      && /t\.equal\('收拾完之後，未儲存格數回到 0'/.test(s17), s17.slice(-1400));
  check('★★★★★ 而且收拾完再驗一次「冇硬規則違反留低」',
    /t\.equal\('而且再沒有硬規則違反留低'/.test(s17), '');
}

// =====================================================================
console.log('\n=== B2【核心】放行要留低痕跡 ===');
{
  // ⚠️ 呢一條驗**行為**：真正叫落 `apiSaveAndConfirmExecute()`，
  // 睇 `writeAuditLog_()` 收到啲乜。
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs'
  ]);
  const audits = [];
  gas.writeAuditLog_ = function (entry) { audits.push(entry); };
  gas.log_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.assertSaveConfirmPlanStillFresh_ = function () {};
  gas.withMutationLock_ = function (name, fn) { return fn(); };
  gas.resolveAuthoritativeState_ = function () {
    return { state: [], unresolved: [], changes: [{ x: 1 }] };
  };
  gas.buildFineTuneContext_ = function () { return {}; };
  gas.materialiseManualEdits_ = function () {
    return { versionNo: 2, sheetName: 'Roster_2028T3_v2', cellCount: 1 };
  };
  gas.registerVersion = function () {};
  gas.readPostsNormalized = function () { return []; };
  gas.readSheet = function () { return []; };
  gas.getQuarterStage_ = function () { return gas.QUARTER_STAGE.DRAFT; };
  gas.buildSaveAndConfirmPlan_ = function () {
    return {
      blocked: false, needsRelease: true, baseVersionNo: 1, stage: gas.QUARTER_STAGE.DRAFT,
      zeroChange: false, decisions: [],
      requests: { apply: [], confirm: [], needsInput: [] },
      gridChanges: [{ x: 1 }], overlaps: [], proposals: [],
      violations: {
        real: [{ serviceDate: '2028-07-02', postId: 'CHAIR', slotIndex: 1,
          ruleId: 'HARD_ELIGIBILITY', severity: 'HARD' }],
        released: [], structural: [], semiHard: []
      }
    };
  };

  let threw = '';
  try {
    gas.apiSaveAndConfirmExecute('2028T3',
      { decisions: [], releaseText: gas.SAVE_CONFIRM_RELEASE_TEXT });
  } catch (err) { threw = err.message; }

  const release = audits.filter(function (a) { return a.action === '放行硬規則違反'; });
  checkEqual('★★★★★★ **放行咗就寫一筆 `AuditLog`**'
    + '——冇呢一筆，一個違反咗硬規則、由人手放行嘅版本，'
    + '事後冇任何方法分得出佢同一個乾淨版本嘅分別',
    release.length, 1);
  check('★★★★★★ 而且講得出放行咗幾多格',
    release.length > 0 && /放行了 1 格規則違反/.test(release[0].newValue),
    JSON.stringify(release));
  check('★★★★★ 而且指得到新嗰一版',
    release.length > 0 && /2028T3 v2/.test(release[0].targetKey),
    JSON.stringify(release));
  check('★★★★★ 而且逐格列明係邊一格、邊條規則',
    release.length > 0 && /2028-07-02/.test(release[0].notes)
      && /HARD_ELIGIBILITY/.test(release[0].notes), JSON.stringify(release));
  checkEqual('★★★★★ 冇因為記 log 而令儲存失敗', threw, '');
}

// =====================================================================
console.log('\n=== B2 冇放行嘅乾淨儲存 ⇒ 一筆都唔好寫 ===');
{
  // ⚠️ 一部乜都記嘅機器同一部乜都唔記嘅機器一樣冇用——
  // 每一版都有一筆「放行」嘅話，「放行」就唔再係一個訊號。
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs'
  ]);
  const audits = [];
  gas.writeAuditLog_ = function (entry) { audits.push(entry); };
  gas.log_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.assertSaveConfirmPlanStillFresh_ = function () {};
  gas.withMutationLock_ = function (name, fn) { return fn(); };
  gas.resolveAuthoritativeState_ = function () {
    return { state: [], unresolved: [], changes: [{ x: 1 }] };
  };
  gas.buildFineTuneContext_ = function () { return {}; };
  gas.materialiseManualEdits_ = function () {
    return { versionNo: 2, sheetName: 'Roster_2028T3_v2', cellCount: 1 };
  };
  gas.registerVersion = function () {};
  gas.readPostsNormalized = function () { return []; };
  gas.readSheet = function () { return []; };
  gas.getQuarterStage_ = function () { return gas.QUARTER_STAGE.DRAFT; };
  gas.buildSaveAndConfirmPlan_ = function () {
    return {
      blocked: false, needsRelease: false, baseVersionNo: 1, stage: gas.QUARTER_STAGE.DRAFT,
      zeroChange: false, decisions: [],
      requests: { apply: [], confirm: [], needsInput: [] },
      gridChanges: [{ x: 1 }], overlaps: [], proposals: [],
      violations: { real: [], released: [], structural: [], semiHard: [] }
    };
  };
  try { gas.apiSaveAndConfirmExecute('2028T3', { decisions: [] }); } catch (err) { /* 唔理 */ }
  checkEqual('★★★★★★ 冇放行 ⇒ 一筆「放行」都唔寫',
    audits.filter(function (a) { return a.action === '放行硬規則違反'; }).length, 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
