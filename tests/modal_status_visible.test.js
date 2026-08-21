// 第四十四輪批次 C 組：撳一粒掣**一定要有反應**。
// 執行方式：node tests/modal_status_visible.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// Ivan：「click 寄出 沒有反應。」
//
// 查到嘅成因**唔係**掣冇綁 handler，亦都唔係後端拋咗錯冇人接。
// 係：
//
//   `#status`（畫面最頂嗰條訊息列）住喺 `.modal-backdrop` **下面**。
//   `.modal-backdrop` 係 `position: fixed; inset: 0; z-index: 100`，
//   仲有一層半透明黑。彈窗一開，寫入 `#status` 嘅字**一個像素都見唔到**。
//
// 而「寄出 ▸ 揀咗自己選擇 ▸ 一個都冇勾 ▸ 撳〔寄出〕」呢一條路，
// 做嘅正正就係 `setStatus(…, true)` 然後 `return`。
// 訊息一直都有，只係被塊黑布蓋住。幹事見到嘅係：**撳落去乜都冇發生。**
//
// ⚠️ 呢個唔係得一個位。任何一句喺彈窗開住時講嘅話都一樣消失——
// 包括「請輸入『確定』兩個字才可以繼續」同埋「這 2 個看起來不是電郵
// 地址」。所以修喺 `setStatus()`（唯一入口），唔係逐個呼叫端補。
//
// 呢一份守：**彈窗開住嗰陣講嘅每一句，都要落喺彈窗入面而且睇得見。**

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const indexHtml = read('src/ui/Index.html');
const styleHtml = read('src/ui/Style.html');
const scriptHtml = read('src/ui/Script.html');
const sendPaperUi = read('src/ui/ScriptSendPaper.html');

// =====================================================================
console.log('\n=== C【核心】成因本身：`#status` 真係喺彈窗下面 ===');
{
  // 呢一節唔係測新功能，係**把成因釘住**。將來有人把 `#status`
  // 搬入彈窗、或者拆走 `z-index`，呢幾條要即刻話返畀佢知格局變咗。
  const statusPos = indexHtml.indexOf('id="status"');
  const backdropPos = indexHtml.indexOf('id="modalBackdrop"');
  check('★★★★★ `#status` 喺 `#modalBackdrop` 外面（唔係彈窗嘅一部分）',
    statusPos !== -1 && backdropPos !== -1 && statusPos < backdropPos,
    'status=' + statusPos + ' backdrop=' + backdropPos);
  check('★★★★★ `.modal-backdrop` 係 `position: fixed; inset: 0`'
    + ' ＋ 有 `z-index`——即係佢真係會蓋住成版嘢',
    /\.modal-backdrop \{[^}]*position: fixed; inset: 0[^}]*z-index: \d+/
      .test(styleHtml.replace(/\s+/g, ' ')), '');
}

// =====================================================================
console.log('\n=== C【核心】彈窗有自己嗰條訊息列，而且喺彈窗入面 ===');
{
  const modalStart = indexHtml.indexOf('<div class="modal" role="dialog"');
  const modalEnd = indexHtml.indexOf('</div>', indexHtml.indexOf('id="modalActions"'));
  const inside = indexHtml.slice(modalStart, modalEnd);
  check('★★★★★ `#modalStatus` 存在，而且喺 `.modal` 裡面',
    inside.indexOf('id="modalStatus"') !== -1, inside.slice(0, 200));
  check('★★★★★ 預設係 `hidden`——冇嘢講嗰陣唔應該有一格空白框',
    /id="modalStatus" hidden/.test(indexHtml), '');
  check('★★★★ 有樣式，而且**唔係細灰字**'
    + '——佢出現嘅時候，幹事啱啱撳完一粒掣而件事冇發生，要一眼睇得到',
    /\.modal-status \{/.test(styleHtml)
    && /\.modal-status \{[^}]*background:/.test(styleHtml.replace(/\s+/g, ' ')), '');
}

// =====================================================================
console.log('\n=== C【核心】行真正嗰份 `setStatus()`：彈窗開住 ⇒ 睇得見 ===');
{
  // 由 `Script.html` 抽出真正嗰四個函式嚟行。抄一份出嚟測只會證明副本冇事。
  function slice(name, endMark) {
    const a = scriptHtml.indexOf(name);
    if (a === -1) return '';
    const b = scriptHtml.indexOf(endMark, a);
    return scriptHtml.slice(a, b + endMark.length);
  }
  const src = [
    slice('function setStatus(message, isError) {', '\n  }\n'),
    slice('function clearModalStatus_() {', '\n  }\n'),
    slice('function openModal(title, bodyNodes, actionNodes) {', '\n  }\n'),
    slice('function closeModal() {', '\n  }\n')
  ].join('\n');
  check('★★★★★ 四個函式都抽得到',
    /function setStatus/.test(src) && /function clearModalStatus_/.test(src)
    && /function openModal/.test(src) && /function closeModal/.test(src), '');

  const nodes = {
    status: { textContent: '', className: '', hidden: false },
    modalStatus: { textContent: '', className: '', hidden: true },
    modalTitle: { textContent: '' },
    modalBody: { children: [], scrollTop: 0,
      appendChild: function (c) { this.children.push(c); } },
    modalActions: { children: [],
      appendChild: function (c) { this.children.push(c); } },
    modalBackdrop: { hidden: true }
  };
  const sandbox = {
    el: function (id) { return nodes[id]; },
    clear: function (n) { n.children = []; return n; },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext('let modalOpen = false;\n' + src
    + '\nthis.setStatus = setStatus;\nthis.openModal = openModal;'
    + '\nthis.closeModal = closeModal;'
    + '\nthis.isModalOpen = function () { return modalOpen; };',
    sandbox, { filename: 'modal-status.js' });

  // ── 重現：彈窗開住，講一句錯 ────────────────────────────
  sandbox.openModal('寄出', [], []);
  check('★★★★ 彈窗開咗', sandbox.isModalOpen() === true);
  sandbox.setStatus('你選了「自己選擇」，但一位都沒有選。', true);

  check('★★★★★ **嗰句話落咗喺彈窗入面**'
    + '——修正之前佢只會落喺 `#status`，而 `#status` 喺塊黑布下面',
    nodes.modalStatus.textContent === '你選了「自己選擇」，但一位都沒有選。',
    JSON.stringify(nodes.modalStatus));
  check('★★★★★ 而且**真係顯示出嚟**（`hidden === false`）'
    + '——寫咗字但仲係 hidden，等於冇修過',
    nodes.modalStatus.hidden === false);
  check('★★★★ 錯誤唔可以用「成功」嗰個綠色',
    nodes.modalStatus.className.indexOf('ok') === -1,
    nodes.modalStatus.className);
  check('★★★★ 頂嗰條照樣寫（彈窗關咗之後仲喺度俾佢對返）',
    nodes.status.textContent === '你選了「自己選擇」，但一位都沒有選。');

  // ── 清走：空字串 ⇒ 收返 ────────────────────────────────
  sandbox.setStatus('');
  check('★★★★ 講空字串 ⇒ 彈窗嗰條收返（唔會留一格空白紅框）',
    nodes.modalStatus.hidden === true && nodes.modalStatus.textContent === '');

  // ── 換一個彈窗 ⇒ 上一個嘅紅字唔可以跟住入嚟 ─────────────
  sandbox.setStatus('舊訊息', true);
  check('★★★★ （先確認舊訊息顯示緊）', nodes.modalStatus.hidden === false);
  sandbox.openModal('另一個彈窗', [], []);
  check('★★★★★ 開新彈窗 ⇒ 上一個嘅訊息清走'
    + '——留住嘅話，幹事會喺一個全新彈窗上面見到一句同佢無關嘅紅字',
    nodes.modalStatus.hidden === true && nodes.modalStatus.textContent === '');

  // ── 關窗 ⇒ 一定清走 ──────────────────────────────────
  sandbox.setStatus('再一句', true);
  sandbox.closeModal();
  check('★★★★ 關窗 ⇒ 清走', nodes.modalStatus.hidden === true);

  // ── 冇彈窗嗰陣 ⇒ 完全唔郁彈窗嗰條（行為同以前一模一樣）─────
  nodes.modalStatus.textContent = '';
  nodes.modalStatus.hidden = true;
  sandbox.setStatus('平時嗰句', false);
  check('★★★★★ 冇彈窗開住嗰陣，行為同修正之前一模一樣'
    + '——只寫 `#status`，唔會靜靜多咗一格嘢喺個關咗嘅彈窗入面',
    nodes.status.textContent === '平時嗰句'
    && nodes.modalStatus.hidden === true
    && nodes.modalStatus.textContent === '');
}

// =====================================================================
console.log('\n=== C 撳〔寄出〕嗰幾條「靜靜 return」都行呢個入口 ===');
{
  // 呢幾條就係 Ivan 撞到嗰幾條。逐條釘住：撳落去一定講一句。
  const onConfirm = sendPaperUi.slice(
    sendPaperUi.indexOf("confirmLabel: '寄出',"),
    sendPaperUi.indexOf("confirmLabel: '寄出',") + 1200);
  check('★★★★★ 「揀咗自己選擇但一個都冇揀」有講一句先 return',
    /setStatus\('你選了「自己選擇」，但一位都沒有選。', true\);\s*\n\s*return;/
      .test(onConfirm), onConfirm.slice(0, 600));
  check('★★★★★ 電郵格式唔啱嗰條經 `commitExtraEmails()`'
    + '（佢入面一樣係 `setStatus(…, true)` 然後回 false）',
    /if \(!commitExtraEmails\(sendOptions_\)\) return;/.test(onConfirm), '');
  check('★★★★★ `commitExtraEmails()` 真係有講嗰句先回 false',
    /setStatus\('這 ' \+ r\.invalid\.length \+ ' 個看起來不是電郵地址：/
      .test(scriptHtml), '');
  check('★★★★★ 打字確認唔啱嗰條一樣（`openConfirm` 入面）',
    /setStatus\('請輸入「' \+ CONFIRM_PHRASE \+ '」兩個字才可以繼續。', true\);/
      .test(scriptHtml), '');
}

// =====================================================================
console.log('\n=== C 全前端只有一個 `google.script.run` 入口，而且一定接 failure ===');
{
  // 「撳落去冇反應」嘅另一種成因：後端拋咗錯而冇人接。
  // 呢個專案早就收窄到一個入口，呢度釘住佢唔好散返開。
  // 只數**真正嘅呼叫**——註解入面提到佢係應該嘅（成段說明都喺講佢）。
  const codeOnly = scriptHtml
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const rawCalls = (codeOnly.match(/google\.script\.run/g) || []).length;
  const inRaw = /function callServerRaw_[\s\S]{0,400}?google\.script\.run\s*\n\s*\.withSuccessHandler\(resolve\)\s*\n\s*\.withFailureHandler\(/
    .test(scriptHtml);
  check('★★★★★ `callServerRaw_()` 同時綁 success 同 failure', inRaw, '');
  const otherFiles = ['src/ui/ScriptSendPaper.html', 'src/ui/ScriptMainFlow.html',
    'src/ui/ScriptZone1.html', 'src/ui/ScriptZone2.html', 'src/ui/ScriptZone3.html'];
  otherFiles.forEach(function (rel) {
    if (!fs.existsSync(path.join(ROOT, rel))) return;
    const body = read(rel);
    check('★★★★ `' + rel.split('/').pop() + '` 冇自己直接叫 `google.script.run`',
      body.indexOf('google.script.run') === -1, '');
  });
  check('★★★★★ 全前端**只有一個**真正嘅 `google.script.run` 呼叫'
    + '——散返開嘅話，總會有一個位漏咗 `withFailureHandler`，'
    + '而漏咗嗰個就係下一次「撳落去冇反應」',
    rawCalls === 1, 'count=' + rawCalls);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
