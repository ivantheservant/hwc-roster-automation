// 第七十五輪批次 CI 組：〔排表偏好〕喺第 2 步；儲存偏好之後問要唔要重新生成（Ivan 已決定）。
// 執行方式：node tests/round75_ci_weights_regenerate.test.js
//
//   CI1　〔排表偏好〕喺開季前準備（第七十七輪批次 EA 組由第 2 步搬過去）
//   CI2–CI4（儲存偏好之後問要唔要重新生成）：第八十二輪批次 ID 組拿走（Ivan：不用這個功能），
//   新行為由 tests/round82_id_weights_saved_notice.test.js 守住。

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

function setup() {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  return { ui };
}
const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];

(async () => {
  console.log('\n=== CI1：〔排表偏好〕喺開季前準備（第七十七輪批次 EA 組由第 2 步搬過去）===');
  {
    const { ui } = setup();
    const card = ui.renderStep2({ latestVersion: { versionNo: 2, sheetUrl: 'https://example.invalid/v2' },
      buttons: { save: { enabled: true } }, versionChoices: [] }, {});
    check('★★★★★ 第 2 步冇〔排表偏好〕', !btnIn(card, '排表偏好'));
    ui.renderZone2Body({ preQuarter: { items: [] } });
    check('★★★★★ 開季前準備有〔排表偏好〕', !!btnIn(ui.document.getElementById('zone2Body'), '排表偏好'));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
