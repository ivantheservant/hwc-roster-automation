// 第四十七輪批次 A 組：寄出前嗰個「未儲存改動」提示，
// 由第四十輪寫出嚟到今日**一次都冇執行過**。
// 執行方式：node tests/send_unsaved_gate.test.js
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一輪最重要嗰條
// ═════════════════════════════════════════════════════════════════════
//
// **一段寫得啱嘅碼，如果上游嘅判斷令佢永遠行唔到，等於冇寫過。**
//
// 現場：Ivan 喺 2028T2 改咗 1 格、冇儲存、撳〔寄出〕，見到嘅係
//
//     現在沒有可以寄的東西。
//     原因
//     ・寄給堂委審閱：你在表上改了 1 格。先撳「儲存並確認」，這一粒才會著。
//     ・正式發出給全體：⋯⋯
//     ・改動後重發：⋯⋯
//     ［知道了］
//
// 佢嘅回饋：「叫我去撳『儲存並確認』，但這個窗裡面沒有那一粒掣。」
//
// ─────────────────────────────────────────────────────────────────────
// 成因（一條純邏輯鏈，唔使估）
// ─────────────────────────────────────────────────────────────────────
//
//   `computeDashboardButtons_()`　三粒掣全部帶 `&& !unsaved.hasAny`
//     ⇒ 有未儲存改動 ⇒ 三粒必定全部 disabled
//   `resolveSendKind_()`　三粒都唔 enabled ⇒ 回 `NONE`
//   `renderSendDialog()`　`kind === 'NONE'` 嗰段喺**第一段**，而且 `return`
//     ⇒ 第四十輪寫嘅「未儲存」嗰段（第二段）**永遠行唔到**
//
// ⚠️ 而每一輪嘅測試都係綠嘅——因為測試**直接呼叫嗰個分支**，
// 從來冇問過「真實嘅 `kind` 到得到嗰度嗎」。
//
// 所以呢一份唔測「嗰段碼寫得啱唔啱」，佢測嘅係**到唔到得到嗰度**。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ui = read('src/ui/ScriptSendPaper.html');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  // `resolveSendKind_()` 喺呢度——呢一份最核心嗰條斷言就係
  // 「`computeDashboardButtons_()` 出嚟嘅結果餵落佢會得到 `NONE`」。
  'SendOptions.gs', 'SendRecipients.gs', 'Mailer.gs', 'WebAppSendPlan.gs'
]);

/** 一份「已經生成、Stage 到咗、可以寄審閱本」嘅 facts。 */
function facts(overrides) {
  return Object.assign({
    stage: gas.QUARTER_STAGE.DRAFT,
    versionExists: true,
    generateOnText: '2028-03-01',
    daysUntilGenerateOn: -30,
    unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false },
    reviewerCount: 3,
    officialTargetCount: 20,
    officialNoEmailCount: 0,
    changedPersonCount: 0,
    hasOfficialRecord: false,
    lastSentAt: ''
  }, overrides || {});
}

/** Ivan 現場嗰個狀態：改咗 1 格、冇儲存。 */
const UNSAVED_ONE_CELL = {
  gridChangeCount: 1, unresolvedCount: 0, pendingRequestCount: 0, hasAny: true
};

// =====================================================================
console.log('\n=== A【死碼證明】有未儲存改動 ⇒ `kind` 必定係 `NONE` ===');
{
  const clean = gas.computeDashboardButtons_(facts());
  check('★★★★★ （前置）冇未儲存改動嗰陣，〔寄給堂委審閱〕係著嘅',
    clean.review.enabled === true, JSON.stringify(clean.review));
  check('★★★★★ （前置）所以 `kind` 唔係 `NONE`',
    gas.resolveSendKind_(clean) !== gas.SEND_KIND.NONE,
    gas.resolveSendKind_(clean));

  const dirty = gas.computeDashboardButtons_(facts({ unsaved: UNSAVED_ONE_CELL }));
  check('★★★★★★ **三粒掣全部因為未儲存而 disabled**'
    + '——`computeDashboardButtons_()` 三粒都帶 `&& !unsaved.hasAny`',
    dirty.review.enabled === false
    && dirty.official.enabled === false
    && dirty.resend.enabled === false,
    JSON.stringify({ r: dirty.review.enabled, o: dirty.official.enabled,
      s: dirty.resend.enabled }));
  check('★★★★★★ **所以 `resolveSendKind_()` 一定回 `NONE`**'
    + '——即係「有未儲存改動」同「`kind === NONE`」係同一件事，'
    + '而唔係兩個各自獨立嘅情況',
    gas.resolveSendKind_(dirty) === gas.SEND_KIND.NONE,
    gas.resolveSendKind_(dirty));
  check('★★★★★ 而且第一項原因就係 Ivan 見到嗰句',
    dirty.review.disabledReason.indexOf('你在表上改了 1 格') !== -1,
    dirty.review.disabledReason);
}

// =====================================================================
console.log('\n=== A【死碼證明】所以第四十輪嗰段永遠行唔到 ===');
{
  // ⚠️ 呢一節唔行 UI（冇 DOM），佢驗嘅係**控制流嘅次序**：
  // `kind === 'NONE'` 嗰個 `return` 一定要喺「未儲存」嗰段**之後**，
  // 否則後者永遠拎唔到控制權。
  const bare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fnStart = bare.indexOf('function renderSendDialog(s) {');
  const fnEnd = bare.indexOf('\n  }\n', fnStart);
  const fn = bare.slice(fnStart, fnEnd);

  const noneAt = fn.indexOf("s.kind === 'NONE'");
  const unsavedAt = fn.indexOf('s.blockedByUnsavedOnly');
  check('★★★★ （前置）兩段都喺 `renderSendDialog()` 入面',
    noneAt !== -1 && unsavedAt !== -1, 'none=' + noneAt + ' unsaved=' + unsavedAt);

  check('★★★★★★ **「未儲存」嗰段要排喺 `NONE` 之前**'
    + '——排喺後面就永遠行唔到：有未儲存改動嗰陣 `kind` 一定係 `NONE`，'
    + '而 `NONE` 嗰段自己 `return` 咗。'
    + '第四十輪批次寫嘅嗰段就係噉樣由頭到尾冇執行過。',
    unsavedAt < noneAt,
    '未儲存段喺第 ' + unsavedAt + ' 個字元，NONE 段喺第 ' + noneAt + ' 個字元');
  check('★★★★★ 而且第一段係一個 early `return`'
    + '——冇 `return` 就會兩個窗一齊開',
    /if \(s\.blockedByUnsavedOnly\) \{[\s\S]{0,80}?renderUnsavedBlocksSend\(s\);[\s\S]{0,40}?return;/
      .test(fn), fn.slice(unsavedAt, unsavedAt + 200));
}

// =====================================================================
console.log('\n=== A1【核心】`blockedByUnsavedOnly`：一定要重算，唔可以淨睇 `hasAny` ===');
{
  // ⚠️ 分別喺呢度：
  //   ・只有未儲存擋住 ⇒ 儲存完就寄得到 ⇒ 應該俾佢〔立即儲存並繼續〕
  //   ・未儲存 **加上** Stage 都未到 ⇒ 儲存完一樣寄唔到 ⇒ 俾嗰粒掣係呃佢
  const onlyUnsaved = gas.computeSendBlockedByUnsavedOnly_(
    facts({ unsaved: UNSAVED_ONE_CELL }));
  check('★★★★★★ 只有未儲存擋住 ⇒ `true`',
    onlyUnsaved === true, String(onlyUnsaved));

  // 冇版本 ⇒ 就算儲存完都一樣寄唔到。
  const alsoNoVersion = gas.computeSendBlockedByUnsavedOnly_(
    facts({ unsaved: UNSAVED_ONE_CELL, versionExists: false }));
  check('★★★★★★ 未儲存 ＋ 冇版本 ⇒ `false`'
    + '——儲存完一樣寄唔到，俾佢〔立即儲存並繼續〕就係呃佢',
    alsoNoVersion === false, String(alsoNoVersion));

  // 已經正式發出過而又冇人改動 ⇒ 三粒都唔會著。
  const alsoStageDone = gas.computeSendBlockedByUnsavedOnly_(
    facts({
      unsaved: UNSAVED_ONE_CELL,
      stage: gas.QUARTER_STAGE.OFFICIAL_SENT,
      hasOfficialRecord: true,
      changedPersonCount: 0
    }));
  check('★★★★★★ 未儲存 ＋ Stage 已經行完 ⇒ `false`',
    alsoStageDone === false, String(alsoStageDone));

  check('★★★★★ 冇未儲存改動 ⇒ `false`（根本唔關佢事）',
    gas.computeSendBlockedByUnsavedOnly_(facts()) === false);

  // ⚠️ 唔可以複製一份 `computeDashboardButtons_()` 嘅邏輯。
  const dash = read('src/WebAppDashboard.gs');
  const fnSrc = dash.slice(dash.indexOf('function computeSendBlockedByUnsavedOnly_('),
    dash.indexOf('\n}\n', dash.indexOf('function computeSendBlockedByUnsavedOnly_(')));
  check('★★★★★★ 重算嗰陣叫**同一個** `computeDashboardButtons_()`'
    + '——寫兩份邏輯就一定會分岔，而分岔嘅後果係'
    + '「畫面俾咗一粒儲存完都寄唔到嘅掣」',
    /computeDashboardButtons_\(/.test(fnSrc), fnSrc.slice(0, 400));
  check('★★★★★ 而且冇喺入面重新抄一次 `&& !unsaved.hasAny` 嗰幾條',
    fnSrc.indexOf('reviewStageOk') === -1
    && fnSrc.indexOf('hasOfficialRecord &&') === -1, fnSrc.slice(0, 400));
}

// =====================================================================
console.log('\n=== A1 `apiGetSendPlanSummary()` 要把佢帶出去 ===');
{
  const plan = read('src/WebAppSendPlan.gs');
  check('★★★★★ 回傳有 `blockedByUnsavedOnly`',
    /blockedByUnsavedOnly: /.test(plan), '');
  check('★★★★★ 而且係由 `buildDashboardState_()` 嗰份算出嚟，唔係前端猜',
    /state\.blockedByUnsavedOnly/.test(plan), '');
}

// =====================================================================
console.log('\n=== A2／A3【核心】新嗰個「未儲存」窗 ===');
{
  const bare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ `blockedByUnsavedOnly` 嗰段排喺最前',
    bare.indexOf('s.blockedByUnsavedOnly') !== -1
    && bare.indexOf('s.blockedByUnsavedOnly') < bare.indexOf("s.kind === 'NONE'"), '');
  check('★★★★★★ 標題講得出改咗幾多格',
    /'寄出：你有 ' \+ n \+ ' 格改動還未儲存'/.test(bare), '');
  check('★★★★★★ **版本號真係印出嚟**'
    + '——唔講版本號，幹事分唔清寄出去嘅係咩內容，'
    + '結果只會照撳〔繼續〕（第四十輪批次 C 組已經記過呢個理由）',
    /寄出的會是「' \+ versionText \+ '」/.test(bare), '');
  check('★★★★★ 攞唔到版本號嗰陣有一句保底',
    /上一次儲存確認的版本/.test(bare), '');
  check('★★★★★★ 〔立即儲存並繼續〕係**預設掣**（第一粒）',
    /confirmLabel: '立即儲存並繼續'/.test(bare), '');
  check('★★★★★ 撳落去直接帶去儲存，唔係淨係關窗',
    /openSaveAndConfirm\(\{ thenSend: true \}\)/.test(bare), '');
  check('★★★★★★ **冇畫〔仍然寄出〕嗰粒**'
    + '——後端 `assertNoUnsavedChanges_()` 一定會擋，'
    + '畫一粒撳落去必定失敗嘅掣，比冇嗰粒差',
    bare.indexOf('仍然寄出第') === -1, '');
  check('★★★★★ 而且要明講「系統不容許」，唔可以靜靜唔畫',
    /有未儲存的改動的時候，系統不容許寄出/.test(bare), '');
}

// =====================================================================
console.log('\n=== A4 `NONE` 嗰個窗都要救得返自己 ===');
{
  const bare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const noneAt = bare.indexOf("if (s.kind === 'NONE') {");
  const noneEnd = bare.indexOf('\n    }\n', noneAt);
  const seg = bare.slice(noneAt, noneEnd);
  check('★★★★★★ 仲有未儲存改動嗰陣，多一粒〔立即儲存〕',
    /button\('立即儲存', \(\) => \{ closeModal\(\); openSaveAndConfirm\(\); \}/.test(seg),
    seg.slice(0, 800));
  check('★★★★★★ 而且嗰一句「儲存之後仲要等咩」**由實際原因算出嚟**，唔係寫死',
    /function describeAfterSaveHint_/.test(bare)
    && /describeAfterSaveHint_\(s\)/.test(seg), '');
}

// =====================================================================
console.log('\n=== A4 「儲存之後仲要等咩」嗰句（行真正嗰個函式）===');
{
  const vm = require('vm');
  const bare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const a = bare.indexOf('function describeAfterSaveHint_(s) {');
  const fnSrc = bare.slice(a, bare.indexOf('\n  }\n', a) + 4);
  // `describeAfterSaveHint_()` 用到嗰份中文名對照表，一齊抽入去行。
  const mapAt = bare.indexOf('const SEND_KIND_NAMES_TC = {');
  const mapSrc = bare.slice(mapAt, bare.indexOf('\n  };\n', mapAt) + 5);
  const sandbox = { console: console };
  vm.createContext(sandbox);
  vm.runInContext(mapSrc + '\n' + fnSrc + '\nthis.f = describeAfterSaveHint_;', sandbox,
    { filename: 'hint.js' });

  const two = sandbox.f({
    unsaved: { hasAny: true },
    blockedReasons: [
      { key: 'review', reason: '你在表上改了 1 格。先撳「儲存並確認」，這一粒才會著。' },
      { key: 'official', reason: '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存並確認」，這一粒才會著。' }
    ]
  });
  check('★★★★★★ 兩項以上 ⇒ 講得出**邊一項**會解決、邊一項仲要等'
    + '——「上面第一項」係一句要人自己數嘅話',
    two.indexOf('寄給堂委審閱') !== -1 && two.indexOf('正式發出給全體') !== -1,
    two);

  const one = sandbox.f({
    unsaved: { hasAny: true },
    blockedReasons: [
      { key: 'review', reason: '你在表上改了 1 格。先撳「儲存並確認」，這一粒才會著。' }
    ]
  });
  check('★★★★★★ 只剩一項 ⇒ **唔可以**講「上面第一項」',
    one.indexOf('第一項') === -1 && one.indexOf('寄給堂委審閱') !== -1, one);

  check('★★★★ 冇未儲存改動 ⇒ 空字串（唔會出一句無關嘅話）',
    sandbox.f({ unsaved: { hasAny: false }, blockedReasons: [] }) === '');
}

// =====================================================================
console.log('\n=== A5 由〔立即儲存並繼續〕入去 ⇒ 「儲存後直接寄出」預設勾住 ===');
{
  const zone1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ `openSaveAndConfirm()` 收得到 `{ thenSend: true }`',
    /function openSaveAndConfirm\(opts\)/.test(zone1), '');
  check('★★★★★★ 而且**只有明確傳咗先會預設勾住**'
    + '——第四十六輪 D 組定咗預設唔勾；'
    + '呢度係一個例外（佢本來就係想寄出，只係被未儲存擋住）',
    /saveThenSendDefault_ = !!\(opts && opts\.thenSend\);/.test(zone1), '');
  check('★★★★★ 平時（冇傳）仍然預設唔勾',
    /thenSendCb\.checked = saveThenSendDefault_;/.test(zone1)
    && /openSaveAndConfirm\(\)/.test(read('src/ui/ScriptMainFlow.html')), '');
  check('★★★★★★ 勾住**唔等於**跳過儲存結果畫面'
    + '——嗰個係「系統改咗你嗰幾格」嘅唯一證據',
    /button\('繼續去寄出'/.test(zone1), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
