// 第二十輪批次階段 A／B：顯示層 ↔ 資料層轉換必須對稱。
// 執行方式：node tests/grid_placeholder_roundtrip.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住嘅係一個令新功能完全用唔到嘅 bug
// ─────────────────────────────────────────────────────────────────────
//
// 第十九輪新增咗「把工作表的人手改動寫成新版本」。Ivan 實測：
//   • 真係改咗一格（SCRIPTURE），偵測器準確捉到 ✅
//   • 但總數變成 **3 格**——2026-10-04 合堂，領詩／司琴顯示「特殊主日」，
//     兩格被當成「認唔出嘅人手改動」
//   • 於是整批被拒絕：「在認得出全部改動之前不會建立新版本」
//
// 即係話：**只要季度入面有任何合堂，整個功能就完全用唔到。**
// 每年四次合堂，實際上每季都有機會中。
//
// 根因：偵測方向係「由 grid 文字反推 PersonID」，而 grid 上面根本
// 唔係淨係得人名。修正：改成「由資料算出應該渲染成咩，再同 grid 比對」。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  'Roles.gs', 'Generator.gs', 'RosterWriter.gs', 'FineTune.gs', 'StateSource.gs'
]);

// 姓名解析替身（一定要喺載入之後先設，理由見 state_source_authority.test.js）
const PEOPLE = { 假甲: 'P9001', 假乙: 'P9002', 假丙: 'P9003', 假丁: 'P9004' };
gas.resolvePersonId = function (name) { return PEOPLE[name] || null; };

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

const LABELS = {
  pending: gas.DEFAULTS.GRID_PENDING_LABEL,
  na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
  specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
  gap: gas.DEFAULTS.GRID_GAP_LABEL
};

/**
 * 造一個貼近 2026T4 真實情況嘅 fixture：
 *   • 2026-10-04 係合堂，領詩／司琴由英語堂負責（SPECIAL_SKIP ＋ ExternalOwner）
 *   • 2026-11-15 有正常派工（就係 Ivan 真係改嗰格）
 *   • 另外覆蓋結構性不適用、留待人手填、排唔出、EmptyDisplay 兩種
 */
function buildFixture() {
  const R = gas.RULE_IDS;
  const S = gas.ASSIGN_SOURCE;

  const original = [
    // ── 2026-10-04 合堂：兩格 SPECIAL_SKIP（就係造成誤報嗰兩格）
    { serviceDateId: 'D1', serviceDate: '2026-10-04', postId: 'WORSHIP', slotIndex: 1,
      personId: '', personName: '', assignSource: S.SKIPPED,
      ruleFlags: [gas.SPECIAL_SKIP_RULE_IDS[0]] },
    { serviceDateId: 'D1', serviceDate: '2026-10-04', postId: 'PIANO', slotIndex: 1,
      personId: '', personName: '', assignSource: S.SKIPPED,
      ruleFlags: [gas.SPECIAL_SKIP_RULE_IDS[0]] },
    // ── 2026-11-15 正常派工（Ivan 真係改嗰格）
    { serviceDateId: 'D2', serviceDate: '2026-11-15', postId: 'SCRIPTURE', slotIndex: 1,
      personId: 'P9001', personName: '假甲', assignSource: S.AUTO, ruleFlags: [] },
    // ── 結構性不適用（聖餐襄禮喺非首主日）
    { serviceDateId: 'D2', serviceDate: '2026-11-15', postId: 'COMMUNION', slotIndex: 1,
      personId: '', personName: '', assignSource: S.SKIPPED,
      ruleFlags: [gas.STRUCTURAL_NA_RULE_IDS[0]] },
    // ── 留待人手填寫（講員）
    { serviceDateId: 'D2', serviceDate: '2026-11-15', postId: 'PREACHER', slotIndex: 1,
      personId: '', personName: '', assignSource: S.SKIPPED,
      ruleFlags: [R.NO_AUTO_GENERATE] },
    // ── 真正排唔出（GENUINE_GAP）
    { serviceDateId: 'D2', serviceDate: '2026-11-15', postId: 'USHER', slotIndex: 1,
      personId: '', personName: '', assignSource: S.SKIPPED,
      ruleFlags: [R.HARD_ELIGIBILITY] }
  ];

  const gridRender = {
    labels: LABELS,
    emptyDisplayByPostId: {
      WORSHIP: 'PENDING', PIANO: 'PENDING', SCRIPTURE: 'PENDING',
      COMMUNION: 'PENDING', PREACHER: 'PENDING', USHER: 'PENDING',
      FLOWER: 'BLANK'
    },
    // 合堂日由英語堂負責——呢個字串係幹事喺 SpecialSundays.ExternalOwner 填嘅
    externalOwnerByDate: { '2026-10-04': '英語堂' }
  };

  // grid 內容 ＝ 完全按照渲染結果（即係「冇人改過」嘅狀態）
  const gridValues = {};
  original.forEach(function (a) {
    gridValues[a.serviceDate + '|' + a.postId + '|' + a.slotIndex] =
      gas.renderExpectedGridText_(a, a.postId, a.serviceDate, gridRender);
  });

  return {
    quarterId: '2026T4', versionNo: 1,
    original: original, gridValues: gridValues, gridRender: gridRender,
    peopleById: { P9001: { nameTC: '假甲' }, P9002: { nameTC: '假乙' } }
  };
}

console.log('\n=== A1：先確認「特殊主日」四個字係邊度嚟 ===');
{
  // 證據一：GRID_PLACEHOLDER_TEXTS **冇包含**「特殊主日」，
  //         所以 normalizeCellText_() 唔會把佢當成空白 ⇒ 一定被當成改動
  check('★★★★★ GRID_PLACEHOLDER_TEXTS 冇包含「特殊主日」'
    + '——呢個就係誤報嘅直接原因（舊做法靠呢個清單過濾）',
    gas.GRID_PLACEHOLDER_TEXTS.indexOf(gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL) === -1,
    JSON.stringify(gas.GRID_PLACEHOLDER_TEXTS));
  checkEqual('★★★★ 「特殊主日」嚟自 DEFAULTS.GRID_SPECIAL_SKIP_LABEL',
    gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL, '特殊主日');

  // 證據二：ExternalOwner 有填就用佢，冇填先退回「特殊主日」
  const skipClass = gas.GRID_CELL_CLASS.SPECIAL_SKIP;
  checkEqual('★★★★★ 合堂格有填 ExternalOwner ⇒ 顯示「英語堂」'
    + '（呢個係幹事自由輸入嘅，所以白名單根本列唔完）',
    gas.resolveGridCellText_({}, skipClass, 'PENDING', LABELS, '英語堂'), '英語堂');
  checkEqual('★★★★ 冇填 ExternalOwner ⇒ 退回「特殊主日」',
    gas.resolveGridCellText_({}, skipClass, 'PENDING', LABELS, ''), '特殊主日');
}

console.log('\n=== A4【核心】冇人改過 grid ⇒ 必須報 0 格 ===');
{
  const context = buildFixture();
  const overlay = gas.buildGridOverlayState_(context);

  checkEqual('★★★★★ 人手改動 0 格'
    + '（修正之前：合堂兩格會被報成「認唔出嘅人手改動」，'
    + '令整批被拒絕、功能完全用唔到）',
    overlay.changes.map(function (c) { return c.postId; }), []);
  checkEqual('★★★★★ 認唔出 0 格', overlay.unresolved, []);
  check('★★★★ 全部格 isManual = false',
    overlay.manualState.every(function (s) { return s.isManual === false; }));
  checkEqual('★★★★ 派工內容完全保留（唔會因為比對而洗走人名）',
    overlay.manualState.filter(function (s) { return s.personId; })
      .map(function (s) { return s.postId + ':' + s.personId; }),
    ['SCRIPTURE:P9001']);
}

console.log('\n=== A3：逐個 placeholder 情境都唔可以誤報 ===');
{
  const context = buildFixture();
  const cases = [
    ['SPECIAL_SKIP（合堂，有 ExternalOwner）', '2026-10-04', 'WORSHIP', '英語堂'],
    ['SPECIAL_SKIP（合堂，第二格）', '2026-10-04', 'PIANO', '英語堂'],
    ['STRUCTURAL_NA（聖餐襄禮非首主日）', '2026-11-15', 'COMMUNION', LABELS.na],
    ['MANUAL_PENDING（講員留待人手填）', '2026-11-15', 'PREACHER', LABELS.pending],
    ['GENUINE_GAP（真係排唔出）', '2026-11-15', 'USHER', LABELS.gap]
  ];

  cases.forEach(function (c) {
    const label = c[0], date = c[1], post = c[2], expectText = c[3];
    const assignment = context.original.filter(function (a) {
      return a.serviceDate === date && a.postId === post;
    })[0];
    const rendered = gas.renderExpectedGridText_(assignment, post, date, context.gridRender);
    checkEqual('★★★★ ' + label + ' 渲染成「' + expectText + '」', rendered, expectText);

    // 而且用呢個文字去比對，一定唔算改動
    const one = Object.assign({}, context, {
      original: [assignment],
      gridValues: (function () {
        const g = {}; g[date + '|' + post + '|1'] = rendered; return g;
      })()
    });
    checkEqual('　　↳ 同一段文字比對 ⇒ 0 格改動',
      gas.buildGridOverlayState_(one).changes.length, 0);
  });

  // EmptyDisplay = BLANK 嗰種（獻花）
  const blankAssignment = {
    serviceDateId: 'D2', serviceDate: '2026-11-15', postId: 'FLOWER', slotIndex: 1,
    personId: '', personName: '', assignSource: gas.ASSIGN_SOURCE.SKIPPED, ruleFlags: []
  };
  const blankText = gas.renderExpectedGridText_(
    blankAssignment, 'FLOWER', '2026-11-15', context.gridRender);
  const blankCtx = Object.assign({}, context, {
    original: [blankAssignment],
    gridValues: { '2026-11-15|FLOWER|1': blankText }
  });
  checkEqual('★★★★ EmptyDisplay=BLANK（獻花）⇒ 0 格改動',
    gas.buildGridOverlayState_(blankCtx).changes.length, 0);
}

console.log('\n=== A【核心】真嘅人手改動仍然要準確捉到（唔可以矯枉過正）===');
{
  const context = buildFixture();
  // 重現 Ivan 實際做嘅事：2026-11-15 SCRIPTURE 由 假甲 改成 假乙
  context.gridValues['2026-11-15|SCRIPTURE|1'] = '假乙';

  const overlay = gas.buildGridOverlayState_(context);
  checkEqual('★★★★★ 準確報 1 格——唔係 3 格'
    + '（Ivan 實測就係報咗 3 格：真 1 格 ＋ 合堂誤報 2 格）',
    overlay.changes.length, 1);
  checkEqual('★★★★★ 而且係啱嗰格、由邊個變邊個都啱',
    overlay.changes.map(function (c) {
      return c.serviceDate + ' ' + c.postId + ' ' + c.originalName + '→' + c.manualText;
    }), ['2026-11-15 SCRIPTURE 假甲→假乙']);
  checkEqual('★★★★ 解析到新嗰位嘅 PersonID',
    overlay.changes[0].manualPersonId, 'P9002');
  checkEqual('★★★★ 認唔出 0 格 ⇒ 唔會再被整批拒絕', overlay.unresolved, []);
}

console.log('\n=== A：合堂格被幹事真係改成一個人名 ⇒ 要捉到 ===');
{
  const context = buildFixture();
  context.gridValues['2026-10-04|WORSHIP|1'] = '假丙';
  const overlay = gas.buildGridOverlayState_(context);
  checkEqual('★★★★★ 合堂格被填咗人名 ⇒ 算改動（唔可以因為係合堂就一律無視）',
    overlay.changes.map(function (c) { return c.postId + '→' + c.manualText; }),
    ['WORSHIP→假丙']);
  checkEqual('★★★★ 解析到 P9003', overlay.changes[0].manualPersonId, 'P9003');
}

console.log('\n=== A：空格打錯字唔可以靜靜咁被當成「冇改動」===');
{
  const context = buildFixture();
  // PREACHER 本來係「待確認」，幹事打咗一個唔存在嘅名
  context.gridValues['2026-11-15|PREACHER|1'] = '唔存在嘅人';
  const overlay = gas.buildGridOverlayState_(context);

  checkEqual('★★★★★ 空格打錯字要報 unresolved'
    + '——第二道防線寫成 `resolvedId === (a.personId || \'\')` 嘅話，'
    + '解析唔到（\'\'）同原本空白（\'\'）會相等，'
    + '幹事打咗嘅嘢就會憑空消失而且冇提示',
    overlay.unresolved.map(function (u) { return u.postId + ':' + u.text; }),
    ['PREACHER:唔存在嘅人']);
  check('★★★★ unresolved 有帶「本來應該係咩」（階段 C1 訊息要用）',
    overlay.unresolved[0].expectedText === LABELS.pending,
    JSON.stringify(overlay.unresolved[0]));
}

console.log('\n=== A：重新打同一個人（或別名）唔算改動 ===');
{
  const context = buildFixture();
  context.gridValues['2026-11-15|SCRIPTURE|1'] = '假甲';   // 同原本一樣
  checkEqual('★★★★ 打返同一個人 ⇒ 0 格改動',
    gas.buildGridOverlayState_(context).changes.length, 0);
}

// =====================================================================
// 階段 B3：round-trip
// =====================================================================
console.log('\n=== B3【核心】round-trip：渲染出嚟再解析返，必須完全還原 ===');
{
  const context = buildFixture();

  // 渲染 → 解析 → 應該同原本逐格一樣
  const overlay = gas.buildGridOverlayState_(context);
  checkEqual('★★★★★ 任何一組派工狀態，渲染成 grid 再解析返，'
    + '逐格 personId 完全還原（呢個先係「顯示層同資料層對稱」嘅定義）',
    overlay.manualState.map(function (s) { return s.postId + ':' + (s.personId || ''); }),
    context.original.map(function (a) { return a.postId + ':' + (a.personId || ''); }));

  // 反證：如果渲染同解析用兩套邏輯，round-trip 就會爆。
  // 呢度用一個「假裝渲染器改咗字」嘅情境模擬分岔。
  const drifted = Object.assign({}, context, {
    gridValues: Object.assign({}, context.gridValues, {
      '2026-10-04|WORSHIP|1': '特殊主日'   // 渲染器改成通用字，解析器唔知
    })
  });
  const driftedOverlay = gas.buildGridOverlayState_(drifted);
  check('★★★★★ 反證：只要渲染同解析對唔上（例如一邊出「英語堂」、'
    + '另一邊當「特殊主日」），round-trip 即刻會報出改動'
    + '——證明呢個測試真係測緊對稱性，唔係一個永遠通過嘅空殼',
    driftedOverlay.changes.length > 0 || driftedOverlay.unresolved.length > 0,
    '兩邊唔一致但完全冇報——代表比對根本冇做');
}

console.log('\n=== A2：gridRender 冇傳一定要拋錯（唔可以退回舊嘅反推做法）===');
{
  const context = buildFixture();
  [undefined, null, {}, { labels: null }].forEach(function (bad) {
    let threw = null;
    const broken = Object.assign({}, context, { gridRender: bad });
    try { gas.buildGridOverlayState_(broken); } catch (e) { threw = e; }
    check('★★★★★ gridRender = ' + JSON.stringify(bad) + ' 會拋錯'
      + '——如果靜靜咁退回舊做法，個 bug 會復活，'
      + '而且**淨係喺有合堂嘅季度先出現**，最難察覺嗰種',
      threw !== null);
  });

  let msg = '';
  try {
    gas.buildGridOverlayState_(Object.assign({}, context, { gridRender: undefined }));
  } catch (e) { msg = e.message; }
  check('★★★★ 錯誤訊息講得出後果（合堂 ⇒ 功能用唔到）',
    msg.indexOf('合堂') !== -1 && msg.indexOf('特殊主日') !== -1, msg);
  check('★★★★ 錯誤訊息講得出點修（用 buildGridRenderContext_）',
    msg.indexOf('buildGridRenderContext_') !== -1, msg);
}

console.log('\n=== B2：渲染同解析必須用同一份實作 ===');
{
  const fs = require('fs');
  const path = require('path');
  const fineTune = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'FineTune.gs'), 'utf8');

  check('★★★★★ buildGridOverlayState_() 用 renderExpectedGridText_() 做比對'
    + '，唔係自己 parse grid 文字',
    fineTune.indexOf('renderExpectedGridText_(') !== -1,
    '搵唔到——代表又變返「由顯示文字反推資料」');

  const writer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'RosterWriter.gs'), 'utf8');
  const renderFn = writer.slice(writer.indexOf('function renderExpectedGridText_'));
  const body = renderFn.slice(0, renderFn.indexOf('\n}\n') + 3);
  check('★★★★★ renderExpectedGridText_() 直接呼叫寫 grid 嗰兩個函式，'
    + '冇自己複製一份渲染邏輯（兩份平行邏輯遲早分岔，'
    + '分岔嗰陣呢個工具就會講大話）',
    body.indexOf('classifyGridCell_(') !== -1
      && body.indexOf('resolveGridCellText_(') !== -1,
    body);
  check('★★★★ 而且冇喺入面硬寫任何顯示文字',
    body.indexOf('特殊主日') === -1 && body.indexOf('待確認') === -1, body);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
