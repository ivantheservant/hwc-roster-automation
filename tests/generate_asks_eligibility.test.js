// 第四十四輪批次 F 組：生成之前**一定**問一次「使唔使先改名單」。
// 執行方式：node tests/generate_asks_eligibility.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// 第四十三輪批次 H 組做咗呢一問，而且有測試釘住：
//
//     check('★★★★★ 生成之前會問「使唔使先改名單」⋯⋯',
//       /askEligibilityFirst/.test(flow) && /openEligibilitySheet\(\);/.test(flow));
//
// 綠燈。但 Ivan 實測話**冇問過**。
//
// 查落佢係啱嘅。上面嗰條測試證明嘅只係「檔案入面有呢個名」，
// 而唔係「每一條去生成嘅路都會經過佢」。實際上有三條路：
//
//   一、`openGenerateForTarget()`，目標就係而家睇緊嗰季 ⇒ 包咗（會問）
//   二、`openGenerateForTarget()`，目標係另一季 ⇒ 先切季度，
//       然後**直接**叫 `openGenerateDraft()`——冇問過
//   三、區一嗰粒「生成初稿」（`ScriptZone1.html`）⇒ 直接叫——冇問過
//
// 而「下一個未生成嘅季度」好多時**就係**另一季，所以佢日常撳嗰粒掣
// 行嘅正正係第二條。
//
// ⚠️ 所以呢一份**唔用**「原始碼入面有冇呢個名」嚟斷言。
// 佢真係行嗰幾個函式，逐條路睇「彈窗有冇出現喺讀資料之前」。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const zone1 = read('src/ui/ScriptZone1.html');
const flow = read('src/ui/ScriptMainFlow.html');
const zone4 = read('src/ui/ScriptZone4.html');

/** 由一份 UI 檔抽一個 top-level 函式（縮排兩格、以 `\n  }` 收尾）。 */
function grabFn(src, header) {
  const a = src.indexOf(header);
  if (a === -1) return '';
  const b = src.indexOf('\n  }\n', a);
  return src.slice(a, b + 5);
}

/**
 * 砌一個沙箱，載入**真正嗰幾個函式**，然後記低發生咗啲乜。
 * @returns {Object} 沙箱
 */
function buildSandbox() {
  const trace = { confirms: [], serverCalls: [], opened: [] };
  const sandbox = {
    trace: trace,
    console: console,
    currentQuarterId: '2027T3',
    // 彈窗：記低標題同兩粒掣，唔真係畫。
    openConfirm: function (opts) {
      trace.confirms.push(opts);
    },
    openModal: function (title) { trace.opened.push(title); },
    closeModal: function () {},
    // `runAction()` 真係行嗰個 async 函式（唔行就永遠見唔到後面嘅呼叫）。
    runAction: function (_label, fn) { return fn(); },
    callServer: function (name) {
      trace.serverCalls.push(name);
      return Promise.resolve({ blocked: false });
    },
    callServerMutating: function (name) {
      trace.serverCalls.push(name);
      return Promise.resolve({});
    },
    showErrorModal: function () {},
    renderGenerateConfirm: function () { trace.opened.push('生成確認'); },
    openEligibilitySheet: function () { trace.opened.push('名單工作表'); },
    para: function (t) { return { text: t }; },
    make: function (_tag, o) { return { text: (o || {}).text || '' }; },
    threePartNodes: function () { return []; },
    el: function () { return { value: '' }; },
    resetAllZoneLoadState: function () {},
    resetMainFlowState: function () {},
    loadDashboard: function () { return Promise.resolve(); },
    openGenerateDraftForTest_: null
  };
  const src = [
    grabFn(zone1, '  function openGenerateDraft() {'),
    grabFn(zone1, '  function openGenerateDraftAfterAsking_() {'),
    grabFn(flow, '  function askEligibilityFirst(onGenerate) {'),
    grabFn(flow, '  function openGenerateForTarget(t) {')
  ].join('\n');
  vm.createContext(sandbox);
  vm.runInContext(src
    + '\nthis.openGenerateDraft = openGenerateDraft;'
    + '\nthis.openGenerateForTarget = openGenerateForTarget;'
    + '\nthis.askEligibilityFirst = askEligibilityFirst;',
    sandbox, { filename: 'generate-paths.js' });
  return sandbox;
}

// =====================================================================
console.log('\n=== F【核心】四個函式都抽得到（抽唔到就唔係喺度測真嘢）===');
{
  ['  function openGenerateDraft() {', '  function openGenerateDraftAfterAsking_() {']
    .forEach(function (h) {
      check('★★★★★ `ScriptZone1.html` 有 `' + h.trim() + '`',
        grabFn(zone1, h) !== '', '');
    });
  check('★★★★★ `ScriptMainFlow.html` 有 `askEligibilityFirst()`',
    grabFn(flow, '  function askEligibilityFirst(onGenerate) {') !== '', '');
  check('★★★★★ `ScriptMainFlow.html` 有 `openGenerateForTarget()`',
    grabFn(flow, '  function openGenerateForTarget(t) {') !== '', '');
}

// =====================================================================
console.log('\n=== F【核心】路一：目標就係而家睇緊嗰季 ===');
{
  const s = buildSandbox();
  s.openGenerateForTarget({ quarterId: '2027T3', label: '2027 年 7-9 月', versionCount: 0 });
  check('★★★★★ 彈咗一個「生成之前」問名單',
    s.trace.confirms.length === 1
    && s.trace.confirms[0].title === '生成之前',
    JSON.stringify(s.trace.confirms.map(function (c) { return c.title; })));
  check('★★★★★ **而且未問之前一次伺服器都冇叫過**'
    + '——問完先叫先至係「問」；叫咗先問就係做完先通知',
    s.trace.serverCalls.length === 0, JSON.stringify(s.trace.serverCalls));
  check('★★★★ 兩粒掣都係真出口：〔直接生成〕同〔先去改名單〕',
    s.trace.confirms[0].confirmLabel === '直接生成'
    && s.trace.confirms[0].cancelLabel === '先去改名單', '');
}

// =====================================================================
console.log('\n=== F【核心】路二：目標係**另一季**（Ivan 撞到嗰條）===');
{
  const s = buildSandbox();
  s.openGenerateForTarget({ quarterId: '2028T1', label: '2028 年 1-3 月', versionCount: 0 });
  // 切季度嗰段係 async 嘅，等一個 tick。
  return new Promise(function (resolve) { setTimeout(resolve, 0); })
    .then(function () {
      check('★★★★★ **一樣有問**'
        + '——修正之前呢一條係直接叫 `openGenerateDraft()`，'
        + '而「下一個未生成嘅季度」好多時就係另一季，'
        + '所以佢日常撳嗰粒掣行嘅正正係呢一條',
        s.trace.confirms.some(function (c) { return c.title === '生成之前'; }),
        JSON.stringify(s.trace.confirms.map(function (c) { return c.title; })));
      check('★★★★★ 而且「讀資料」（`apiGenerateDraftPlan`）**未行過**'
        + '——問之前就讀咗，等於個彈窗只係一個裝飾',
        s.trace.serverCalls.indexOf('apiGenerateDraftPlan') === -1,
        JSON.stringify(s.trace.serverCalls));
      runRest();
    });
}

function runRest() {
// =====================================================================
console.log('\n=== F【核心】路三：區一嗰粒「生成初稿」===');
{
  const s = buildSandbox();
  s.openGenerateDraft();
  check('★★★★★ 一樣有問'
    + '——呢一粒由頭到尾都係直接叫，第四十三輪嗰個包裝完全冇蓋到佢',
    s.trace.confirms.length === 1
    && s.trace.confirms[0].title === '生成之前', '');
  check('★★★★★ 未問之前冇叫過伺服器',
    s.trace.serverCalls.length === 0, JSON.stringify(s.trace.serverCalls));
}

// =====================================================================
console.log('\n=== F【核心】揀〔直接生成〕⇒ 真係去讀資料；揀〔先去改名單〕⇒ 帶佢去 ===');
{
  const s = buildSandbox();
  s.openGenerateDraft();
  const c = s.trace.confirms[0];
  c.onConfirm();
  return new Promise(function (resolve) { setTimeout(resolve, 0); })
    .then(function () {
      check('★★★★★ 揀〔直接生成〕之後先至讀資料',
        s.trace.serverCalls.indexOf('apiGenerateDraftPlan') !== -1,
        JSON.stringify(s.trace.serverCalls));

      const s2 = buildSandbox();
      s2.openGenerateDraft();
      s2.trace.confirms[0].onCancel();
      check('★★★★★ 揀〔先去改名單〕⇒ **真係帶佢去嗰張表**'
        + '——一個叫人「請去某某地方」而唔帶佢去嘅提示，'
        + '對一個唔熟電腦嘅人嚟講等於冇提示',
        s2.trace.opened.indexOf('名單工作表') !== -1,
        JSON.stringify(s2.trace.opened));
      check('★★★★★ 而且**冇生成**',
        s2.trace.serverCalls.indexOf('apiGenerateDraftPlan') === -1,
        JSON.stringify(s2.trace.serverCalls));
      runStatic();
    });
}
}

function runStatic() {
// =====================================================================
console.log('\n=== F 唔可以問兩次（疊住兩個一模一樣嘅彈窗）===');
{
  const s = buildSandbox();
  s.openGenerateForTarget({ quarterId: '2027T3', label: '本季', versionCount: 0 });
  check('★★★★★ 同一次只彈一個「生成之前」'
    + '——呼叫端同入口各包一次，幹事就要連續撳兩次一模一樣嘅嘢',
    s.trace.confirms.filter(function (c) { return c.title === '生成之前'; }).length === 1,
    JSON.stringify(s.trace.confirms.map(function (c) { return c.title; })));
  check('★★★★★ `ScriptMainFlow.html` 唔再自己包一次',
    !/askEligibilityFirst\(\(\) => openGenerateDraft\(\)\)/.test(flow), '');
}

// =====================================================================
console.log('\n=== F 呢一問住喺入口本身，唔係逐個呼叫端各記一次 ===');
{
  const entry = grabFn(zone1, '  function openGenerateDraft() {');
  check('★★★★★ `openGenerateDraft()` 本身就係「問 ＋ 轉發」'
    + '——三條路各自記得包一次，就係「總有一條唔記得」，'
    + '而第四十三輪就係噉樣漏咗兩條',
    /askEligibilityFirst\(/.test(entry)
    && /openGenerateDraftAfterAsking_\(\)/.test(entry), entry);
  check('★★★★★ 入口本身**唔會**直接讀資料'
    + '——直接讀就代表繞得過嗰一問',
    entry.indexOf('apiGenerateDraftPlan') === -1, entry);

  // 全前端唔可以有第二條路直接叫 `apiGenerateDraftPlan`。
  const files = ['src/ui/Script.html', 'src/ui/ScriptZone1.html', 'src/ui/ScriptZone2.html',
    'src/ui/ScriptZone3.html', 'src/ui/ScriptZone4.html', 'src/ui/ScriptMainFlow.html',
    'src/ui/ScriptSendPaper.html', 'src/ui/ScriptRollback.html'];
  let callSites = 0;
  files.forEach(function (rel) {
    if (!fs.existsSync(path.join(ROOT, rel))) return;
    const body = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    callSites += (body.match(/callServer\('apiGenerateDraftPlan'/g) || []).length;
  });
  check('★★★★★ 全前端只有**一個**地方叫 `apiGenerateDraftPlan`'
    + '——多一個就係多一條繞得過嗰一問嘅路',
    callSites === 1, 'count=' + callSites);
}

// =====================================================================
console.log('\n=== F 區四嗰粒覆蓋式重做：唔疊多個窗，但要講同一句 ===');
{
  const bare = zone4.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 覆蓋式重做**唔會**再彈多一個「生成之前」'
    + '——佢本身已經要打字確認；喺打字確認之上再疊一個彈窗，'
    + '只會令人撳完再撳，唔會令人真係去改名單',
    !/askEligibilityFirst/.test(bare), '');
  check('★★★★★ 但要喺同一版講明「會用而家嗰份名單」'
    + '——唔講嘅話，佢重做完先發現用咗舊名單，就要再重做一次',
    /會用「現在」那一份名單來排/.test(bare), '');
  check('★★★★ 而且講得出去邊度改',
    /更改各崗位的事奉人員/.test(bare), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
}
