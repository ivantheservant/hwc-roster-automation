// 第四十五輪批次：`Failed due to illegal value in property: 1` 嘅真正成因。
// 執行方式：node tests/client_arg_sanitize.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// 現場：撳〔請系統幫我調整〕⇒ `Failed due to illegal value in property: 1`
//
// ⚠️ 第四十四輪把呢句判成 `Range.setValues()` 收到壞值。**判錯咗。**
// 推翻佢嘅係一項現場證據：Apps Script 執行紀錄**完全冇呢一次執行**
//（只有 `apiGetMainFlowState`／`apiGetDashboardState`／`apiListQuarters`／
// `doGet`，全部 Completed）。後端一次都冇被叫到，所以成因唔可能喺後端。
//
// 真正嘅來源係 `google.script.run` 嘅參數序列化，喺 client 端、
// 喺送出之前就拋。`property: N` 嗰個 `N` 係**第幾個參數**（由 0 數起）。
//
// 而 `1` 對應嘅係：
//
//     stepButton('請系統幫我調整', openBuildSuggestion, {…})
//     function openBuildSuggestion(startFrom) {
//       callServerMutating('apiBuildSuggestion', currentQuarterId, startFrom || '')
//     }                                          ↑ 參數 0        ↑ 參數 1
//
// `button()` 用嘅係 `addEventListener('click', onClick)`，所以 `startFrom`
// 收到嘅係一個 **MouseEvent**——一個 truthy 嘅物件，`|| ''` 攔唔住。
//
// 呢一份守三層：
//   一、綁掣嗰陣唔可以直接交一個「會收參數」嘅函式（`lint-handler-args.js`）
//   二、送出之前清一次，清唔到就喺 client 端拋一句講得明嘅三段式錯
//   三、錯誤視窗嘅標題唔可以由「載入中嘅講法」直接駁一個「失敗」

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const script = read('src/ui/Script.html');
const flow = read('src/ui/ScriptMainFlow.html');
const suggestion = read('src/ui/ScriptSuggestion.html');

/** 由 UI 檔抽一個 top-level 函式（縮排兩格、以 `\n  }` 收尾）。 */
function grabFn(src, header) {
  const a = src.indexOf(header);
  if (a === -1) return '';
  const b = src.indexOf('\n  }\n', a);
  return src.slice(a, b + 5);
}

// 把真正嗰幾個函式載入一個沙箱嚟行。抄一份出嚟測只會證明副本冇事。
const sandbox = { console: console };
vm.createContext(sandbox);
vm.runInContext([
  grabFn(script, '  function isPlainObject_(v) {'),
  grabFn(script, '  function plainObjectOrNull_(v) {'),
  grabFn(script, '  function describeIllegalValue_(v) {'),
  grabFn(script, '  function findIllegalServerValue_(value, path, seen) {'),
  grabFn(script, '  function sanitizeServerArgs_(fnName, args) {'),
  grabFn(script, '  function buildClientThreePart_(what, state, howto) {'),
  grabFn(script, '  function actionErrorTitle_(label) {'),
  'this.sanitizeServerArgs_ = sanitizeServerArgs_;',
  'this.findIllegalServerValue_ = findIllegalServerValue_;',
  'this.actionErrorTitle_ = actionErrorTitle_;',
  'this.plainObjectOrNull_ = plainObjectOrNull_;',
  'this.isPlainObject_ = isPlainObject_;'
].join('\n'), sandbox, { filename: 'client-sanitize.js' });

/** 抓一次 `sanitizeServerArgs_()` 拋嘅錯。 */
function caught(fnName, args) {
  try { return { value: sandbox.sanitizeServerArgs_(fnName, args), msg: null }; }
  catch (err) { return { value: null, msg: err.message }; }
}

// =====================================================================
console.log('\n=== A【核心】重現現場：第 1 個參數係一個事件物件 ===');
{
  // 造一個同 MouseEvent 一樣形狀嘅嘢：一個唔係純物件嘅 instance。
  function MouseEvent() { this.type = 'click'; this.isTrusted = true; }
  const evt = new MouseEvent();

  check('★★★★★ （先確認佢係 truthy——所以 `startFrom || \'\'` 攔唔住佢）',
    !!evt === true);

  const r = caught('apiBuildSuggestion', ['2027T3', evt]);
  check('★★★★★ **送出之前就攔住咗**（後端一次都唔會被叫到）',
    r.msg !== null, JSON.stringify(r.value));
  check('★★★★★ 講得出係**邊個 API**'
    + '——sandbox 嗰句英文由頭到尾冇講過，'
    + '所以上一輪我拎住佢查咗成個後端',
    r.msg && r.msg.indexOf('apiBuildSuggestion') !== -1, r.msg);
  check('★★★★★ 講得出係**第幾個參數**（就係現場嗰個「property: 1」）',
    r.msg && r.msg.indexOf('參數 1') !== -1, r.msg);
  check('★★★★★ 講得出嗰個值係乜（`MouseEvent`）',
    r.msg && r.msg.indexOf('MouseEvent') !== -1, r.msg);
  check('★★★★★ 明講「伺服器一次都沒有被呼叫」'
    + '——唔講嘅話，幹事唔知自己啱啱嗰下有冇改到嘢',
    r.msg && r.msg.indexOf('伺服器一次都沒有被呼叫') !== -1, r.msg);
  check('★★★★ 而且係三段式（`showErrorModal()` 拆得開）',
    r.msg && r.msg.indexOf('發生了什麼：') === 0
    && r.msg.indexOf('現在的情況：') !== -1
    && r.msg.indexOf('你可以怎樣做：') !== -1, r.msg);
  check('★★★★★ 下一步講埋最常見嘅成因（直接綁一個會收參數嘅函式）'
    + '——冇呢一句，開發者拎住個錯一樣要由頭估',
    r.msg && r.msg.indexOf('滑鼠事件') !== -1, r.msg);
}

// =====================================================================
console.log('\n=== A【核心】次序：先驗後清，唔可以先清後驗 ===');
{
  // ⚠️ `JSON.stringify()` 會把函式同 `undefined` **靜靜刪走**：
  // 物件入面成條 key 消失、陣列入面變 `null`。
  // 先清後驗嘅話，呢個 bug 會由「拋一句睇唔明嘅英文」
  // 變成「靜靜傳咗個 null 上去」——更差。
  const r1 = caught('apiX', ['q', [1, undefined, 3]]);
  check('★★★★★ 陣列入面有 `undefined` ⇒ **拋錯**，唔會靜靜變成 `null`',
    r1.msg !== null, JSON.stringify(r1.value));
  check('★★★★★ 而且講得出係邊一格（`參數 1[1]`）'
    + '——一句「有嘢唔啱」要人自己由頭搵一次',
    r1.msg && r1.msg.indexOf('參數 1[1]') !== -1, r1.msg);

  const r2 = caught('apiX', [{ a: 1, b: function () {} }]);
  check('★★★★★ 物件入面有函式 ⇒ 拋錯，唔會靜靜少咗一條 key',
    r2.msg !== null && r2.msg.indexOf('參數 0.b') !== -1, r2.msg);

  const r3 = caught('apiX', ['q', undefined]);
  check('★★★★★ 直接傳 `undefined` ⇒ 拋錯'
    + '（`[quarterId, versionNo]` 而 `versionNo` 未定義就係呢一種）',
    r3.msg !== null && r3.msg.indexOf('參數 1') !== -1, r3.msg);

  const circular = { name: 'x' };
  circular.self = circular;
  const r4 = caught('apiX', [circular]);
  check('★★★★★ 循環引用 ⇒ 拋一句人話，'
    + '唔係 `Converting circular structure to JSON`',
    r4.msg !== null && r4.msg.indexOf('循環引用') !== -1, r4.msg);
}

// =====================================================================
console.log('\n=== A 乾淨嘅參數：照舊送出，而且真係清過一次 ===');
{
  const r = caught('apiSaveAndConfirmExecute',
    ['2027T3', { changes: [{ key: 'a', to: 'P9001' }], skip: [], flag: true, n: 3 }]);
  check('★★★★★ 冇拋錯', r.msg === null, r.msg);
  check('★★★★★ 內容一模一樣（清一次唔可以改變資料）',
    JSON.stringify(r.value)
      === JSON.stringify(['2027T3',
        { changes: [{ key: 'a', to: 'P9001' }], skip: [], flag: true, n: 3 }]),
    JSON.stringify(r.value));
  check('★★★★ `null` 係合法嘅（唔可以連 `null` 都擋）',
    caught('apiX', [null, 'a']).msg === null);
  check('★★★★ 空陣列、空物件都合法',
    caught('apiX', [[], {}]).msg === null);

  // 清一次要真係剝走 prototype／getter——嗰啲過唔到 sandbox。
  const withGetter = { plain: 1 };
  Object.defineProperty(withGetter, 'computed', {
    enumerable: true, get: function () { return 'v'; }
  });
  const r2 = caught('apiX', [withGetter]);
  check('★★★★★ getter 會被攤平成一個普通值'
    + '——留住 getter 嘅話，sandbox 嗰邊拎到嘅可能係另一樣嘢',
    r2.msg === null
    && Object.getOwnPropertyDescriptor(r2.value[0], 'computed').get === undefined
    && r2.value[0].computed === 'v', JSON.stringify(r2.value));
}

// =====================================================================
console.log('\n=== A `Date` 唔准直接傳（sandbox 唔會保留佢）===');
{
  const r = caught('apiX', ['q', new Date('2027-01-03T00:00:00Z')]);
  check('★★★★★ 傳 `Date` ⇒ 拋錯，唔係靜靜變成一串 ISO 字串'
    + '——靜靜變咗嘅話，後端收到嘅型別同呼叫端以為嘅唔同，'
    + '而冇任何一邊會察覺',
    r.msg !== null && r.msg.indexOf('Date') !== -1, r.msg);
}

// =====================================================================
console.log('\n=== B【核心】全前端只有一個出口，而且一定行過清洗 ===');
{
  const bare = script.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
  const calls = (bare.match(/google\.script\.run/g) || []).length;
  check('★★★★★ `Script.html` 只有一個真正嘅 `google.script.run`',
    calls === 1, 'count=' + calls);

  const rawFn = grabFn(script, '  function callServerRaw_(fnName, ...args) {');
  check('★★★★★ `callServerRaw_()` 送出之前叫 `sanitizeServerArgs_()`',
    /const safeArgs = sanitizeServerArgs_\(fnName, args\);/.test(rawFn), rawFn);
  check('★★★★★ **而且真係送清完嗰份**（`...safeArgs`，唔係 `...args`）'
    + '——清完而照樣送舊嗰份，等於成層防線白做',
    /\[fnName\]\(\.\.\.safeArgs\)/.test(rawFn)
    && !/\[fnName\]\(\.\.\.args\)/.test(rawFn), rawFn);

  ['ScriptZone1', 'ScriptZone2', 'ScriptZone3', 'ScriptZone4',
    'ScriptMainFlow', 'ScriptSendPaper', 'ScriptSuggestion', 'ScriptRollback']
    .forEach(function (name) {
      const rel = 'src/ui/' + name + '.html';
      if (!fs.existsSync(path.join(ROOT, rel))) return;
      // ⚠️ 要剝走註解先數：呢幾個檔嘅註解入面會提到呢個名
      // （解釋點解唔可以直接掂佢），而註解唔係呼叫。
      const body = read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      check('★★★★ `' + name + '.html` 冇自己掂 `google.script.run`',
        body.indexOf('google.script.run') === -1, '');
    });
}

// =====================================================================
console.log('\n=== C【核心】綁掣：`lint-handler-args.js` 真係捉得到現場嗰個 ===');
{
  // 呢一節唔係靜態斷言——佢**真係把 bug 種返落去**，跑 lint，再還原。
  const rel = 'src/ui/ScriptMainFlow.html';
  const full = path.join(ROOT, rel);
  const before = fs.readFileSync(full, 'utf8');
  const good = "stepButton('請系統幫我調整', () => openBuildSuggestion(), {";
  const bad = "stepButton('請系統幫我調整', openBuildSuggestion, {";
  check('★★★★★ 而家綁嘅係包咗一層嗰個',
    before.indexOf(good) !== -1, '');

  function runLint() {
    try {
      execFileSync(process.execPath, ['tools/lint-handler-args.js'],
        { cwd: ROOT, stdio: 'pipe' });
      return { passed: true, out: '' };
    } catch (err) {
      return { passed: false, out: String(err.stdout || '') };
    }
  }
  check('★★★★★ 現狀 ⇒ lint 綠燈', runLint().passed);

  let mutated = null;
  try {
    fs.writeFileSync(full, before.replace(good, bad));
    mutated = runLint();
  } finally {
    fs.writeFileSync(full, before);
  }
  check('★★★★★★ **把現場嗰個 bug 種返落去 ⇒ lint 一定要紅**'
    + '——一條未見過紅燈嘅防線唔算防線',
    mutated && mutated.passed === false, JSON.stringify(mutated));
  check('★★★★★ 而且講得出係邊個函式、宣告咗幾多個參數',
    mutated && mutated.out.indexOf('openBuildSuggestion') !== -1
    && /宣告咗 [12] 個參數/.test(mutated.out), mutated && mutated.out);
  check('★★★★★ 亦都講埋點改',
    mutated && mutated.out.indexOf('() => openBuildSuggestion()') !== -1,
    mutated && mutated.out);
  check('★★★★ 跑完冇留低任何改動',
    fs.readFileSync(full, 'utf8') === before);
}

// =====================================================================
console.log('\n=== C 保底：`openBuildSuggestion()` 自己都唔會轉發一個事件 ===');
{
  // ⚠️ 第四十六輪批次 C3 組加咗第 2 個參數 `allowKeys`。
  const fn = grabFn(suggestion, '  function openBuildSuggestion(startFrom, allowKeys) {');
  check('★★★★★ 收到唔係字串嘅嘢一律當成冇揀'
    + '——三層都要有：lint 喺 commit 前擋、'
    + '`sanitizeServerArgs_()` 喺送出前擋、呢一句喺源頭擋',
    /const from = \(typeof startFrom === 'string'\) \? startFrom : '';/.test(fn), fn);
  check('★★★★★ 而且送出嗰行用嘅係清完嗰個 `from`，唔係 `startFrom || \'\'`',
    /'apiBuildSuggestion', currentQuarterId, from,/.test(fn)
    && fn.indexOf("startFrom || ''") === -1, fn);
}

// =====================================================================
console.log('\n=== D【核心】錯誤視窗標題：唔可以係「⋯⋯請稍候失敗」 ===');
{
  check('★★★★★ `runAction()` 用 `actionErrorTitle_(label)`，'
    + '唔再係 `label + \'失敗\'`',
    /showErrorModal\(actionErrorTitle_\(label\), err\);/.test(script)
    && script.indexOf("showErrorModal(label + '失敗', err)") === -1, '');

  check('★★★★★★ **現場嗰句**：「系統調整中，請稍候」⇒「系統調整」做不到',
    sandbox.actionErrorTitle_('系統調整中，請稍候') === '「系統調整」做不到',
    sandbox.actionErrorTitle_('系統調整中，請稍候'));
  check('★★★★ 「儲存中」⇒「儲存」做不到',
    sandbox.actionErrorTitle_('儲存中') === '「儲存」做不到');
  check('★★★★ 本來就係名詞嘅唔會被改壞（「讀取資料」）',
    sandbox.actionErrorTitle_('讀取資料') === '「讀取資料」做不到');
  check('★★★★★ 剝到空嘅時候有一句保底，唔會出一個冇標題嘅視窗',
    sandbox.actionErrorTitle_('中') === '這一步做不到'
    && sandbox.actionErrorTitle_('') === '這一步做不到'
    && sandbox.actionErrorTitle_(null) === '這一步做不到');

  // ── 逐個真正嘅 label 行一次 ────────────────────────────────
  //
  // ⚠️ 唔可以淨係測幾個手揀嘅例。全專案六十幾個 `runAction()`，
  // 而呢一句嘅價值就係「每一個都讀得通」。
  const labels = {};
  ['Script', 'ScriptZone1', 'ScriptZone2', 'ScriptZone3', 'ScriptZone4',
    'ScriptMainFlow', 'ScriptSendPaper', 'ScriptSuggestion', 'ScriptRollback']
    .forEach(function (name) {
      const rel = 'src/ui/' + name + '.html';
      if (!fs.existsSync(path.join(ROOT, rel))) return;
      const re = /runAction\('([^']+)'/g;
      let m;
      const body = read(rel);
      while ((m = re.exec(body)) !== null) labels[m[1]] = true;
    });
  const all = Object.keys(labels);
  check('★★★★ 抽到全部 `runAction()` 嘅講法（應該有幾十個）',
    all.length >= 40, 'count=' + all.length);

  const bad = all.filter(function (l) {
    const t = sandbox.actionErrorTitle_(l);
    return t.indexOf('中」') !== -1 || t.indexOf('請稍候') !== -1 || t === '';
  });
  check('★★★★★★ **一個標題都唔會再出現「⋯⋯中」或者「請稍候」**'
    + '——呢個就係 Ivan 見到嗰句「系統調整中，請稍候失敗」',
    bad.length === 0, JSON.stringify(bad));

  const stillJoined = all.filter(function (l) {
    return (l + '失敗').indexOf('請稍候失敗') !== -1;
  });
  check('★★★★★ （反證：舊寫法 `label + \'失敗\'` 真係會造出'
    + stillJoined.length + ' 句「請稍候失敗」——所以呢一條唔係假綠燈）',
    stillJoined.length >= 1, JSON.stringify(stillJoined));
}

// =====================================================================
console.log('\n=== E【核心】區一四粒大掣：同一句錯嘅另外三個位 ===');
{
  // ⚠️ 呢三個係寫 lint 嗰陣先發現嘅，唔喺原本嘅追查範圍。
  //
  //     const handlers = { save: …, review: openReview,
  //                        official: openOfficial, resend: openResend };
  //     … bigButton({ …, onClick: handlers[b.key] })
  //     → button(label, opts.onClick, …) → addEventListener('click', onClick)
  //
  // 所以撳區一嘅「寄給堂委審閱」／「正式發出給全體」／「改動後重發」，
  // `sendOptions` 收到嘅係一個 MouseEvent，跟住原封不動送去
  // `apiStep2Confirm`／`apiStep4Confirm`／`apiStep5SendConfirm` 做第 1 個參數。
  // **同一句 `Failed due to illegal value in property: 1`。**
  const zone1 = read('src/ui/ScriptZone1.html');
  const bare = zone1.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ 四粒都包咗一層 `() => …`',
    /save: \(\) => openSaveAndConfirm\(\),/.test(bare)
    && /review: \(\) => openReview\(\),/.test(bare)
    && /official: \(\) => openOfficial\(\),/.test(bare)
    && /resend: \(\) => openResend\(\)/.test(bare), '');

  ['openReview', 'openOfficial', 'openResend'].forEach(function (name) {
    const fn = grabFn(zone1, '  function ' + name + '(sendOptions) {');
    check('★★★★★ `' + name + '()` 收成純物件或者 `null`'
      + '——`undefined` 一樣過唔到 `google.script.run`，'
      + '所以「完全唔傳」嗰條路本身都係壞嘅',
      /const sendOpts = plainObjectOrNull_\(sendOptions\);/.test(fn), fn.slice(0, 300));
  });
  check('★★★★★ 而且送出嗰三行用嘅係 `sendOpts`，唔係原本嗰個 `sendOptions`',
    /'apiStep2Confirm', currentQuarterId, sendOpts\)/.test(bare)
    && /'apiStep4Confirm', currentQuarterId, sendOpts\)/.test(bare)
    && /'apiStep5SendConfirm', currentQuarterId, releaseText, sendOpts\)/.test(bare), '');

  // 行真正嗰個 `plainObjectOrNull_()`。
  function MouseEvent() { this.type = 'click'; }
  check('★★★★★ MouseEvent ⇒ `null`',
    sandbox.plainObjectOrNull_(new MouseEvent()) === null);
  check('★★★★★ `undefined` ⇒ `null`（`null` 過得到，`undefined` 過唔到）',
    sandbox.plainObjectOrNull_(undefined) === null);
  check('★★★★ `Date` ⇒ `null`', sandbox.plainObjectOrNull_(new Date()) === null);
  check('★★★★ 陣列 ⇒ `null`（`sendOptions` 應該係一個物件）',
    sandbox.plainObjectOrNull_([1, 2]) === null);
  const real = { recipientScope: 'PICK', pickedKeys: ['a'] };
  check('★★★★★ 真正嘅選項原封不動回返（唔可以順手改咗人哋啲資料）',
    sandbox.plainObjectOrNull_(real) === real);
  check('★★★★★ 而且 `null` 真係過得到清洗（唔可以連 `null` 都擋）',
    caught('apiStep2Confirm', ['2027T3', sandbox.plainObjectOrNull_(undefined)]).msg === null);
}

console.log('\n=== E `lint-handler-args.js` 亦都捉得到「處理器地圖」嗰種 ===');
{
  // 第一版嘅 lint 只捉裸識別字，完全睇唔到 `const handlers = { … }`。
  // 呢一節把嗰一種都種返落去，證明而家捉得到。
  const rel = 'src/ui/ScriptZone1.html';
  const full = path.join(ROOT, rel);
  const before = fs.readFileSync(full, 'utf8');
  const good = '      review: () => openReview(),';
  const bad = '      review: openReview,';
  check('★★★★ （前置）而家係包咗一層嗰個', before.indexOf(good) !== -1);

  let out = null;
  let passed = null;
  try {
    fs.writeFileSync(full, before.replace(good, bad));
    try {
      execFileSync(process.execPath, ['tools/lint-handler-args.js'],
        { cwd: ROOT, stdio: 'pipe' });
      passed = true;
    } catch (err) { passed = false; out = String(err.stdout || ''); }
  } finally {
    fs.writeFileSync(full, before);
  }
  check('★★★★★★ **地圖入面嗰個都要捉得到**'
    + '——捉唔到嘅話，區一嗰三粒掣就會靜靜留住同一個 bug',
    passed === false, String(out));
  check('★★★★★ 講得出係 `openReview`',
    out && out.indexOf('openReview') !== -1, out);
  check('★★★★ 跑完冇留低任何改動',
    fs.readFileSync(full, 'utf8') === before);
}

console.log('\n=== E 「純物件」全前端只有一個定義 ===');
{
  const bare = script.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
  const protoChecks = (bare.match(/Object\.getPrototypeOf\(/g) || []).length;
  check('★★★★★ 只有一處做 prototype 判斷（`isPlainObject_()`）'
    + '——寫兩份就一定會分岔，而分岔嘅後果係'
    + '「擋得住嘅」同「清得走嘅」唔係同一批',
    protoChecks === 1, 'count=' + protoChecks);
  check('★★★★★ `findIllegalServerValue_()` 用返同一個',
    /if \(!isPlainObject_\(value\)\) \{/.test(bare), '');
  check('★★★★★ `plainObjectOrNull_()` 一樣',
    /return isPlainObject_\(v\) \? v : null;/.test(bare), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
