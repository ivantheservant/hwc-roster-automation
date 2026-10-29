// 第六十三輪批次 C／D 組：會改資料嘅入口有一半冇攞鎖；側邊欄「一次過儲存全部」係並發嘅。
// 執行方式：node tests/mutation_lock_coverage.test.js
//
// ═════════════════════════════════════════════════════════════════════
// C 組
// ═════════════════════════════════════════════════════════════════════
//
// `MutationLock.gs` 檔頭寫明「同一時間只可以有一個會改動資料的動作在跑」，
// 但之前只有 9 處用 `withMutationLock_()`。步驟 2／3／4／5（網頁同選單）、
// 填講員、產生個人 PDF、補寄、重設測試資料全部冇鎖。
//
// 其中步驟 3／5 套用會造版本——正正係鎖嘅檔頭描述嗰個撞版本號情況；
// 步驟 4 並發兩次 ⇒ 真寄時全體收兩封。
//
// ═════════════════════════════════════════════════════════════════════
// D 組
// ═════════════════════════════════════════════════════════════════════
//
// 側邊欄 `saveAll()` 用 `forEach` 一次過發晒（最多 39 個並發執行）。
// 而家填講員有鎖（攞唔到即刻拒絕），並發嘅話大半格會被擋——所以一定要
// 同 C 組一齊做：改成逐格依次。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const TARGETS = [
  ['src/WebAppFlow.gs', 'apiStep2Confirm'],
  ['src/WebAppFlow.gs', 'apiStep3Apply'],
  ['src/WebAppFlow.gs', 'apiStep3Release'],
  ['src/WebAppFlow.gs', 'apiStep4Confirm'],
  ['src/WebAppFlow.gs', 'apiStep5Apply'],
  ['src/WebAppFlow.gs', 'apiStep5GeneratePdfs'],
  ['src/WebAppFlow.gs', 'apiStep5SendConfirm'],
  ['src/FourStageFlow.gs', 'runFourStageStep2_'],
  ['src/FourStageFlow.gs', 'runFourStageStep3_'],
  ['src/FourStageFlow.gs', 'runFourStageStep4_'],
  ['src/FourStageFlow.gs', 'runFourStageStep5_'],
  ['src/MakeupSend.gs', 'runMakeupSendExecute_'],
  ['src/Menu.gs', 'runResetQuarterTestData_'],
  ['src/PreacherTranslationFill.gs', 'apiSavePreacherTranslationEntry'],
  ['src/WebAppPreQuarterEdit.gs', 'apiWebSavePreacherEntry'],
  ['src/WebAppZone4.gs', 'apiGeneratePersonalPdfBatch'],
  ['src/Menu.gs', 'runGeneratePersonalPdfBatch_'],
  ['src/WebAppZone4.gs', 'apiMakeupSendExecute']
];

function lockedName(n) { return n.endsWith('_') ? n.slice(0, -1) + '_locked_' : n + '_locked_'; }
function shellOf(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  return src.slice(start, src.indexOf('\n}', start) + 2);
}

// =====================================================================
console.log('\n=== C【核心】逐個入口都包咗鎖（薄殼 ＋ _locked_）===');
TARGETS.forEach(function (t) {
  const src = read(t[0]);
  const shell = shellOf(src, t[1]);
  const locked = lockedName(t[1]);
  check('★★★★★ ' + t[1] + ' 包咗 withMutationLock_，內容喺 ' + locked + '()',
    shell !== null && /withMutationLock_\('[^']+', function \(\) \{/.test(shell)
    && shell.indexOf('return ' + locked + '(') !== -1
    && src.indexOf('function ' + locked + '(') !== -1, shell);
});

console.log('\n=== C【核心】攞唔到鎖嗰陣，真入口真係唔會做嘢 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs',
    'WebAppGuards.gs', 'FiveStageCore.gs', 'WebAppFlow.gs', 'PreacherTranslationFill.gs',
    'WebAppPreQuarterEdit.gs', 'WebAppZone4.gs', 'FourStageFlow.gs', 'MakeupSend.gs'
  ]);
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.log_ = function () {};
  let touched = 0;
  // 任何真正嘅內容一行到就會碰到呢幾支——攞唔到鎖就唔應該碰
  ['findLatestVersionNo', 'requireQuarterStage_', 'assertNoUnsavedChanges_',
    'findPreacherTranslationPostIds_', 'planApplyRequests_', 'planStep5ChangedList_',
    'generatePersonalPdfBatch_', 'planMakeupSend_'].forEach(function (n) {
    gas[n] = function () { touched++; throw new Error('唔應該行到 ' + n); };
  });
  gas.LockService = {
    getDocumentLock: function () {
      return { tryLock: function () { return false; }, releaseLock: function () {} };
    }
  };
  const calls = [
    ['apiStep2Confirm', ['2099T1', null]],
    ['apiStep3Apply', ['2099T1', true]],
    ['apiStep4Confirm', ['2099T1', null]],
    ['apiStep5Apply', ['2099T1', true]],
    ['apiStep5GeneratePdfs', ['2099T1', '', null]],
    ['apiStep5SendConfirm', ['2099T1', '', null]],
    ['apiSavePreacherTranslationEntry', ['2099T1', '2099-01-04', 'PREACH', 1, '某人']],
    ['apiWebSavePreacherEntry', ['2099T1', '2099-01-04', 'PREACH', 1, '某人']],
    ['apiGeneratePersonalPdfBatch', ['2099T1', 0]],
    ['apiMakeupSendExecute', ['2099T1', 'OFFICIAL']]
  ];
  calls.forEach(function (c) {
    let msg = '';
    try {
      const r = gas[c[0]].apply(null, c[1]);
      // 區四嗰兩個會把錯包成 {ok:false, message}
      msg = r && r.message ? r.message : JSON.stringify(r);
    } catch (e) { msg = e.message; }
    check('★★★★★★ ' + c[0] + '：攞唔到鎖 ⇒ 「另一個動作仍在進行」',
      msg.indexOf('另一個動作仍在進行') !== -1, msg.slice(0, 200));
  });
  check('★★★★★★ 而且一行真正嘅內容都冇行過', touched === 0, touched);
}

// =====================================================================
console.log('\n=== D【核心】側邊欄「一次過儲存全部」逐格依次 ===');
{
  const html = read('src/ui/PreacherFillSidebar.html');
  const grab = function (name) {
    const start = html.indexOf('  function ' + name + '(');
    return html.slice(start, html.indexOf('\n  }\n', start) + 4);
  };
  const code = grab('saveOne') + '\n' + grab('saveAll');

  // 夠用嘅 DOM：saveAll() 只用到 getElementById／querySelector 同幾個屬性
  const nodes = {};
  const nodeOf = function (id) {
    if (!nodes[id]) nodes[id] = { id: id, value: '', disabled: false, textContent: '', style: {} };
    return nodes[id];
  };
  const N = 6;
  const PENDING = [];
  for (let i = 0; i < N; i++) {
    PENDING.push({ serviceDate: '2099-01-' + (10 + i), postId: 'PREACH', slotIndex: 1 });
    nodeOf('cell_' + i + '_input').value = '講員' + i;
  }

  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const run = {};
  const runner = function () {
    let ok = null;
    let bad = null;
    const api = {
      withSuccessHandler: function (f) { ok = f; return api; },
      withFailureHandler: function (f) { bad = f; return api; },
      apiSavePreacherTranslationEntry: function () {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(function () { inFlight--; ok({}); }, 5);
      }
    };
    return api;
  };
  Object.defineProperty(run, 'withSuccessHandler', { get: function () { return runner().withSuccessHandler; } });
  const sandbox = {
    PENDING: PENDING,
    QUARTER_ID: '2099T1',
    Promise: Promise,
    String: String,
    document: {
      getElementById: function (id) { return nodeOf(id); },
      querySelector: function (sel) { return nodeOf('btn:' + sel); }
    },
    google: { script: { get run() { return runner(); } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.saveAll = saveAll;', sandbox);
  sandbox.saveAll();

  setTimeout(function () {
    check('★★★★★★ 同一時間最多只有 1 個儲存請求'
      + '——舊寫法一次過發晒（最多 39 個並發），而家填講員有鎖，並發會被擋走大半',
      maxInFlight === 1, 'maxInFlight=' + maxInFlight);
    check('★★★★★ 全部格都有送出', calls === N, calls);
    check('★★★★ 進度文字照舊，最後講「已儲存 N 格」',
      nodeOf('bulkStatus').textContent === '✅ 已儲存 ' + N + ' 格。', nodeOf('bulkStatus').textContent);
    check('★★★★ 掣做完之後解鎖', nodeOf('bulkSaveBtn').disabled === false);
    check('★★★★ saveAll() 入面冇再用 forEach 一次過發', !/targets\.forEach\(/.test(grab('saveAll')));

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exit(fail === 0 ? 0 : 1);
  }, 200);
}
