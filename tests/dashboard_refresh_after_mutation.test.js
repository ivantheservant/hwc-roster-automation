// 第二十七輪批次階段 A：寫入動作之後，狀態快取一定要跟住更新。
// 執行方式：node tests/dashboard_refresh_after_mutation.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測撞到嘅嘢（2027T3）
// ─────────────────────────────────────────────────────────────────────
//
// 撳「寄給堂委審閱」→ 正確彈出「還沒有公開連結」→ 撳「立即發佈」
// → 掣暗一陣 → **彈返同一個畫面**。
// 用 connector 核實過：`PublicLinks` 真係加咗 2027T3 嗰一行，後端成功咗。
//
// 成因：「立即發佈」成功之後即刻叫 `openReview()`，而佢讀嘅係
// **發佈之前攞落嚟嘅狀態快取**——入面仲寫住「冇連結」。
//
// 呢個 bug class（同一個狀態有兩個真相來源，只更新咗其中一個）已經第三次：
//   1. `wireZoneToggle` 兩個載入旗標 ⇒ 換季度顯示上一季數字
//   2. 掣 1 預覽過期
//   3. 狀態快取 vs 伺服器真實狀態 ⇒ 今次
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試分兩半，兩半都要有
// ─────────────────────────────────────────────────────────────────────
//
// **上半（行為）**：真係把 `Script.html` 嘅 script 內容載入 Node 沙箱行一次，
// 用假伺服器重演 Ivan 嗰個情境。淨靠靜態掃描嘅話，只證明到「字面上寫咗
// 刷新」，證明唔到「刷新之後真係攞到新值」。
//
// **下半（結構）**：靜態掃描，確保將來加一個新嘅寫入動作**唔會**再中同一個陷阱。
// 關鍵係方向——白名單係「唯讀」而唔係「會寫入」，所以漏咗登記嘅新 api
// 會被當成會寫入（多刷一次，冇害），而唔係被當成唯讀（就係今次呢個 bug）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const UI_DIR = path.join(__dirname, '..', 'src', 'ui');
const readUi = (name) => fs.readFileSync(path.join(UI_DIR, name), 'utf8');

/** 抽出 `<script>` … `</script>` 之間嘅 JS。 */
function scriptBodyOf(html) {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('找不到 script 區塊');
  return m[1];
}

function bodyOf(src, fnName) {
  const start = src.search(new RegExp('(async\\s+)?function\\s+' + fnName + '\\b'));
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n  }\n');
  return end === -1 ? rest : rest.slice(0, end + 5);
}

const scriptHtml = readUi('Script.html');
const scriptJs = scriptBodyOf(scriptHtml);

/* ══════════════════════════════════════════════════════════════
 * 上半：行為——真係跑一次，重演 Ivan 嗰個情境
 * ══════════════════════════════════════════════════════════════ */

/**
 * 把 `Script.html` 載入一個 Node 沙箱。
 *
 * 可以噉做嘅前提（逐一查證過）：`Script.html` 嘅頂層**只有宣告**，
 * 冇任何會即刻執行嘅嘢。而 `loadDashboard()` 用到嘅四個 render 函式
 * （renderTop／renderZone1／renderZone2Head／renderZone4）全部住喺
 * **其他檔案**，所以喺沙箱度先定義佢哋做空函式就掂——唔使砌成個 DOM。
 *
 * @param {Object} serverImpl `{apiName: (…args) => 回傳值}`
 * @returns {Object} 沙箱（可以直接讀 `callServerMutating` 等）
 */
/** 最細嘅假 DOM 節點：夠渲染路徑行完就算，唔記錄任何嘢。 */
function fakeNode() {
  return {
    hidden: false, firstChild: null, textContent: '', className: '',
    type: '', value: '', disabled: false, dataset: {},
    appendChild: function () {}, removeChild: function () {},
    setAttribute: function () {}, addEventListener: function () {}
  };
}

function loadFrontendSandbox(serverImpl) {
  const calls = [];
  const runProxy = {};
  let successHandler = null;
  let failureHandler = null;
  runProxy.withSuccessHandler = function (fn) { successHandler = fn; return runProxy; };
  runProxy.withFailureHandler = function (fn) { failureHandler = fn; return runProxy; };

  // 每一個 api 名都掛一個函式上去，行為同 google.script.run 一樣：
  // 呼叫之後非同步回呼 success／failure。
  Object.keys(serverImpl).forEach(function (name) {
    runProxy[name] = function (...args) {
      calls.push(name);
      const ok = successHandler;
      const bad = failureHandler;
      setTimeout(function () {
        try { ok(serverImpl[name].apply(null, args)); }
        catch (err) { bad(err); }
      }, 0);
    };
  });

  const sandbox = {
    google: { script: { run: runProxy } },
    setTimeout: setTimeout,
    console: console,
    // 渲染層：本測試唔關心畫面，全部做空函式。
    renderTop: function () {},
    renderZone1: function () {},
    renderZone2Head: function () {},
    renderZone4: function () {},
    renderRollbackEntry: function () { return null; },
    // `loadDashboard()` 一路行落去會掂到 DOM（closeModal／區四渲染）。
    // 所以要一個最細嘅假節點——只係夠佢哋行完，唔係砌成個 DOM。
    document: {
      getElementById: fakeNode,
      createElement: fakeNode,
      querySelectorAll: function () { return []; },
      // ⚠️ 第四十三輪批次 A 組：`loadDashboard()` 收尾會叫
      // `reapplyBusyLockIfNeeded_()`（重畫完要重新鎖一次新造嘅掣）。
      // 佢讀 `document.body.classList`，所以呢個最細嘅假 DOM 要補一個
      // `body`——唔補嘅話呢一份測試會爆一個同佢要守嗰件事完全無關嘅錯。
      body: {
        classList: {
          contains: function () { return false; },
          add: function () {}, remove: function () {}, toggle: function () {}
        },
        appendChild: function () {}
      }
    },
    __calls: calls
  };
  vm.createContext(sandbox);
  // ⚠️ `let`／`const` 喺 vm script 頂層**唔會**變成 context 物件上面嘅屬性
  // （只有 function 宣告會）。所以要喺同一份 script 尾巴掛一個小 setter
  // 上去，先至改到入面嗰個 `currentQuarterId`。
  // 直接 `sandbox.currentQuarterId = …` 只會多開一個被遮蔽咗嘅全域屬性，
  // 而測試會靜靜咁跑錯——正正係本專案最怕嗰種失敗方式。
  vm.runInContext(
    scriptJs + '\n;this.__setQuarter = function (q) { currentQuarterId = q; };',
    sandbox);
  return sandbox;
}

async function runBehaviourTests() {
  console.log('\n=== A【核心】重演：發佈公開連結之後，判斷要用新狀態 ===');
  {
    let published = false;
    const box = loadFrontendSandbox({
      apiGetDashboardState: function () {
        // 伺服器嘅真相：發佈咗就有連結。
        return { publicLink: { hasLink: published, checkFailed: false } };
      },
      apiRepublishPublicLink: function () {
        published = true;
        return { ok: true, versionNo: 3 };
      }
    });
    box.__setQuarter('2027T3');

    await box.loadDashboard();
    const before = await box.getDashboard();
    check('★★★★ 起點：狀態快取話「還沒有公開連結」',
      before.publicLink.hasLink === false);

    await box.callServerMutating('apiRepublishPublicLink', '2027T3');

    const after = await box.getDashboard();
    check('★★★★★ 發佈之後 getDashboard() 攞到嘅係**新**狀態'
      + '——呢一格就係 Ivan 撞到嗰個 bug：舊快取話冇連結，'
      + '所以又彈返「還沒有公開連結」，而後端其實成功咗',
      after.publicLink.hasLink === true,
      '拿到的是：' + JSON.stringify(after));

    const fetches = box.__calls.filter((c) => c === 'apiGetDashboardState').length;
    check('★★★★ 而且只多打咗一次伺服器（唔係每次讀都重攞）',
      fetches === 2, '打了 ' + fetches + ' 次');
  }

  console.log('\n=== A 連續寫入唔會變成連續刷新 ===');
  {
    const box = loadFrontendSandbox({
      apiGetDashboardState: function () { return { ok: true }; },
      apiStep5GeneratePdfs: function () { return { done: false }; }
    });
    box.__setQuarter('2027T3');
    await box.loadDashboard();

    // 分批產生個人 PDF 會連續叫幾十次。每次都即場刷新就係幾十次多餘來回。
    for (let i = 0; i < 10; i++) await box.callServerMutating('apiStep5GeneratePdfs', 'q');
    const midway = box.__calls.filter((c) => c === 'apiGetDashboardState').length;
    check('★★★★★ 十次寫入期間**零**次刷新（標記過期，唔即場攞）',
      midway === 1, '刷新了 ' + midway + ' 次');

    await box.getDashboard();
    const after = box.__calls.filter((c) => c === 'apiGetDashboardState').length;
    check('★★★★★ 但一讀就即刻刷新一次——所以判斷永遠用新資料',
      after === 2, '刷新了 ' + after + ' 次');
  }

  console.log('\n=== A【核心】預設拒絕：唔喺唯讀白名單嘅一律擋 ===');
  {
    const box = loadFrontendSandbox({
      apiGetDashboardState: function () { return {}; },
      apiSomethingBrandNew: function () { return { ok: true }; }
    });
    let rejected = false;
    let message = '';
    try { await box.callServer('apiSomethingBrandNew'); }
    catch (err) { rejected = true; message = String(err.message); }

    check('★★★★★ 一個未登記嘅新 api 用 callServer() 會被拒絕'
      + '——方向係特登嘅：漏登記嘅新 api 當成「會寫入」（多刷一次，冇害），'
      + '而唔係當成「唯讀」（就係今次呢個 bug）',
      rejected === true);
    check('★★★★ 而且訊息講得出應該點做',
      message.indexOf('callServerMutating') !== -1
      && message.indexOf('READ_ONLY_APIS') !== -1, message);

    check('★★★★ 而唯讀白名單入面嗰個照樣行得到',
      (await box.callServer('apiGetDashboardState')) !== undefined);
  }

  console.log('\n=== A 寫入失敗唔可以標記成「已刷新」 ===');
  {
    const box = loadFrontendSandbox({
      apiGetDashboardState: function () { return { n: Math.random() }; },
      apiBlowUp: function () { throw new Error('後端爆咗'); }
    });
    box.__setQuarter('2027T3');
    await box.loadDashboard();
    const beforeCount = box.__calls.filter((c) => c === 'apiGetDashboardState').length;

    let threw = false;
    try { await box.callServerMutating('apiBlowUp'); } catch (e) { threw = true; }
    check('★★★★ 寫入拋錯會照樣拋上去（唔會靜靜吞咗）', threw === true);

    await box.getDashboard();
    const afterCount = box.__calls.filter((c) => c === 'apiGetDashboardState').length;
    check('★★★ 拋錯嘅寫入唔會標記過期（冇寫入成功，冇嘢要刷新）',
      afterCount === beforeCount, '多刷了 ' + (afterCount - beforeCount) + ' 次');
  }
}

/* ══════════════════════════════════════════════════════════════
 * 下半：結構——令將來新增一個寫入動作唔會再中同一個陷阱
 * ══════════════════════════════════════════════════════════════ */

/**
 * 幹事介面用到嘅檔案——**由 `Index.html` 嘅 includeHtml 反推**，
 * 唔係手寫一份清單。手寫嘅話，加咗新檔而漏咗更新就會靜靜漏掃。
 */
const OFFICER_UI_FILES = ['Index.html'].concat(
  (readUi('Index.html').match(/includeHtml\('ui\/([A-Za-z0-9]+)'\)/g) || [])
    .map((s) => s.replace(/.*'ui\//, '').replace(/'\)/, '') + '.html')
    .filter((f) => f !== 'Style.html'));

function runStructureTests() {
  const uiFiles = fs.readdirSync(UI_DIR).filter((f) => f.endsWith('.html'));
  const others = uiFiles.filter((f) => f !== 'Script.html');

  console.log('\n=== A0 前提：掃描範圍真係涵蓋咗幹事介面全部檔案 ===');
  {
    check('★★★★ 由 Index.html 反推出嚟嘅檔案清單唔係空嘅（手寫清單會漏掃）',
      OFFICER_UI_FILES.length >= 6, OFFICER_UI_FILES.join('、'));
    OFFICER_UI_FILES.forEach((f) => {
      check('★★★★★ ' + f + ' 真係存在', fs.existsSync(path.join(UI_DIR, f)));
    });
  }

  console.log('\n=== A1【核心】狀態快取只有一個寫入點 ===');
  {
    check('★★★★ 個變數係 let 宣告，初值 null', /let dashboardState_ = null;/.test(scriptJs));
    // 宣告嗰句唔算——數嘅係「之後仲有幾多處改佢」。
    const assigns = (scriptJs.match(/(?<!let )dashboardState_\s*=[^=]/g) || []).length;
    check('★★★★★ 除咗宣告之外，全 Script.html 只有一句賦值畀狀態快取',
      assigns === 1, '有 ' + assigns + ' 句');

    const loadBody = bodyOf(scriptJs, 'loadDashboard');
    check('★★★★★ 而且嗰一句喺 loadDashboard() 入面',
      /dashboardState_\s*=\s*await callServer\('apiGetDashboardState'/.test(loadBody));

    others.forEach((f) => {
      check('★★★★★ ' + f + ' 完全冇掂過個變數名'
        + '——直接讀就係繞過咗「過期會自己刷新」嗰層',
        !/dashboardState_/.test(readUi(f)));
    });
  }

  console.log('\n=== A1 讀嘅入口只有一個，而且會自己刷新 ===');
  {
    const getBody = bodyOf(scriptJs, 'getDashboard');
    check('★★★★★ getDashboard() 見到過期就先 await loadDashboard()',
      /if \(dashboardStale_ \|\| !dashboardState_\) await loadDashboard\(/.test(getBody));
    check('★★★★ 刷新時唔會關掉幹事開緊嗰個畫面（keepModal）',
      /keepModal: true/.test(getBody));
  }

  console.log('\n=== A1【核心】幹事介面只有一個伺服器呼叫入口 ===');
  {
    // ⚠️ 只掃幹事介面嗰幾個檔（Index.html 載入嗰批）。
    // `PreacherFillSidebar.html` 同 `PersonalRoster.html` 係另外兩個獨立頁面
    // ——一個係試算表側邊欄、一個係唯讀個人頁，兩者都冇狀態快取呢個概念，
    // 所以呢條規則對佢哋唔適用。
    //
    // 用「呼叫鏈」而唔係淨個名去數：說明文字入面提到嗰個名唔算一個入口。
    const CALL_CHAIN = /\.script\.run\s*\n?\s*\.with/g;
    OFFICER_UI_FILES.forEach((f) => {
      const src = readUi(f);
      const hits = (src.match(CALL_CHAIN) || []).length;
      const expected = f === 'Script.html' ? 1 : 0;
      check('★★★★★ ' + f + ' 直接打伺服器嘅次數 = ' + expected
        + '——多過一個入口，白名單關卡就會被繞過',
        hits === expected, '有 ' + hits + ' 次');
    });
    check('★★★★ 而 Script.html 嗰一次喺 callServerRaw_() 入面',
      CALL_CHAIN.test(bodyOf(scriptJs, 'callServerRaw_')));
  }

  console.log('\n=== A2【核心】逐個掃：每一個 api 呼叫都行啱條路 ===');
  {
    const listMatch = scriptJs.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
    check('★★★★★ 有一份唯讀白名單', !!listMatch);
    const readOnly = listMatch
      ? (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''))
      : [];
    check('★★★★ 白名單唔係空嘅', readOnly.length > 5, '有 ' + readOnly.length + ' 個');

    const guardBody = bodyOf(scriptJs, 'callServer');
    check('★★★★★ callServer() 係**預設拒絕**（唔喺白名單就擋）',
      /READ_ONLY_APIS\.indexOf\(fnName\) === -1/.test(guardBody));

    // 逐個檔掃，兩個方向都要對。
    uiFiles.forEach((f) => {
      const src = readUi(f);
      const ro = (src.match(/callServer\('([A-Za-z0-9_]+)'/g) || [])
        .map((s) => s.replace(/callServer\('/, '').replace(/'/, ''));
      const mu = (src.match(/callServerMutating\('([A-Za-z0-9_]+)'/g) || [])
        .map((s) => s.replace(/callServerMutating\('/, '').replace(/'/, ''));

      const badRo = ro.filter((n) => readOnly.indexOf(n) === -1);
      check('★★★★★ ' + f + '：用 callServer() 嗰啲全部喺唯讀白名單',
        badRo.length === 0, '不在白名單：' + badRo.join('、'));

      const badMu = mu.filter((n) => readOnly.indexOf(n) !== -1);
      check('★★★★★ ' + f + '：用 callServerMutating() 嗰啲全部**唔喺**白名單'
        + '——兩邊都登記就等於冇登記過',
        badMu.length === 0, '同時在白名單：' + badMu.join('、'));
    });
  }

  console.log('\n=== A2 動作做完，畫面一定要跟住變 ===');
  {
    const runBody = bodyOf(scriptJs, 'runAction');
    check('★★★★★ runAction() 完成之後見到過期就刷新',
      /if \(dashboardStale_\)/.test(runBody) && /loadDashboard\(\{ keepModal: true \}\)/.test(runBody));
    check('★★★★★ 而且擺喺 finally——寫咗一半先失敗嗰種情況，'
      + '畫面更加需要係最新嘅',
      runBody.indexOf('finally') !== -1
      && runBody.indexOf('finally') < runBody.indexOf('dashboardStale_'));
    check('★★★★ 刷新自己失敗唔可以蓋過原本嗰個錯',
      /catch \(e\) \{ setStatus\(/.test(runBody));
  }

  console.log('\n=== A2 區二身：每次都重畫，唔可以「畫過就算」 ===');
  {
    const zone2 = readUi('ScriptZone2.html');
    const headBody = bodyOf(zone2, 'renderZone2Head');
    check('★★★★★ renderZone2Head() 一定會叫 renderZone2Body(d)'
      + '——區三加咗一筆之後，上面個總數同下面逐項要一齊變',
      /renderZone2Body\(d\)/.test(headBody));
    check('★★★★★ 而且冇「載入過就唔畫」嗰個分支'
      + '（純渲染，零伺服器來回，冇任何理由留住個快取）',
      !/if \(!markZoneLoaded\('zone2Body'\)\) renderZone2Body/.test(zone2));
    check('★★★★ renderZone2Body() 由參數攞資料，唔自己去讀快取',
      /function renderZone2Body\(d\)/.test(zone2));
  }

  console.log('\n=== A2 收摺區嘅 onOpen 可以係 async，而且失敗有得見 ===');
  {
    const wireBody = bodyOf(scriptJs, 'wireZoneToggle');
    check('★★★★★ onOpen 包咗 runAction()'
      + '——唔包嘅話失敗會變成冇人處理嘅 rejected promise：'
      + '區展開咗但係空白，冇任何錯誤訊息',
      /runAction\(/.test(wireBody));
  }
}

(async function () {
  await runBehaviourTests();
  runStructureTests();
  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
