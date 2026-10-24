// 第七十輪批次 AX 組：審閱階段「寄出」窗最上面講明點樣進入正式發出。
// 執行方式：node tests/review_sent_hint.test.js
//
// 現場（截圖 s_stage_note）：寄了審閱本之後（進度「已寄給堂委，等他們的意見」），第 3 步〔寄出〕開出的
// 仍然是「寄給堂委審閱」。要先在第 2 步撳〔儲存〕（沒有改動也可以）把進度推到「意見已收齊」，
// 〔寄出〕才會變成正式發出。只改顯示，不改流程。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EXPECTED = '堂委的意見收齊、要正式發出給全體？請先在第 2 步撳〔儲存〕（沒有改動也可以撳），之後再撳〔寄出〕，這裡就會變成「正式發出給全體」。';

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SendOptions.gs', 'SendRecipients.gs', 'WebAppSendPlan.gs']);

console.log('\n=== AX1 後端：只有「已寄給堂委」這個進度才出提示 ===');
{
  check('★★★★★★ REVIEW_SENT ⇒ 有提示，而且字句同規格一致', gas.buildReviewSentHint_(gas.QUARTER_STAGE.REVIEW_SENT) === EXPECTED,
    gas.buildReviewSentHint_(gas.QUARTER_STAGE.REVIEW_SENT));
  [gas.QUARTER_STAGE.DRAFT, gas.QUARTER_STAGE.REQUESTS_APPLIED, gas.QUARTER_STAGE.OFFICIAL_SENT, '', undefined].forEach((st) => {
    check('★★★★★ 進度 ' + String(st) + ' ⇒ 不出提示', gas.buildReviewSentHint_(st) === '', gas.buildReviewSentHint_(st));
  });
  check('★★★★★ 寄出窗資料帶 reviewSentHint，來源是 state.stage',
    /reviewSentHint: buildReviewSentHint_\(state\.stage\)/.test(read('src/WebAppSendPlan.gs')), '');
  check('★★★★ 只改顯示：沒有動 resolveSendKind_ 的流程（正式發出仍然要先到「意見已收齊」）',
    /if \(b\.official && b\.official\.enabled\) return SEND_KIND\.OFFICIAL;/.test(read('src/WebAppSendPlan.gs')), '');
}

console.log('\n=== AX2 畫面：有提示就畫在最上面；沒有就不畫 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptSendPaper.html']);
  const baseS = {
    kind: 'REVIEW', latestVersion: { versionNo: 2 }, sendHistory: { batches: [], warnSentence: '' },
    isDryRun: true, permanentLink: { hasLink: true, url: 'x' }, attachOptionNotes: {},
    sendOptionDefaults: { attachType: 'NONE', includeIcs: false }, alsoReview: false
  };
  const bodyText = (s) => {
    ui.__s = s;
    vm.runInContext('renderSendMain(__s)', ui);
    const walk = (n) => String(n._text || '') + '\n' + (n.children || []).map(walk).join('\n');
    return walk(vm.runInContext('document.getElementById("modalBody")', ui));
  };
  const withHint = bodyText(Object.assign({}, baseS, { reviewSentHint: EXPECTED }));
  check('★★★★★★ 有提示 ⇒ 寄出窗有那一句', withHint.indexOf(EXPECTED) !== -1, withHint.slice(0, 400));
  check('★★★★★★ 提示在最上面（排在「系統只會寄你已經儲存確認的版本」之前）',
    withHint.indexOf(EXPECTED) !== -1 && withHint.indexOf(EXPECTED) < withHint.indexOf('系統只會寄你已經儲存確認的版本'), withHint.slice(0, 400));
  const without = bodyText(Object.assign({}, baseS, { reviewSentHint: '' }));
  check('★★★★★★ 沒有提示（其他進度）⇒ 不畫', without.indexOf('意見收齊') === -1, without.slice(0, 300));
  check('★★★★ 前端沒有自己寫提示文字（由後端出）', read('src/ui/ScriptSendPaper.html').indexOf('堂委的意見收齊') === -1, '');
}

console.log(fail === 0 ? '\nOK' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
