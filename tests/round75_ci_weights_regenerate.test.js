// 第七十五輪批次 CI 組：〔排表偏好〕喺第 2 步；儲存偏好之後問要唔要重新生成（Ivan 已決定）。
// 執行方式：node tests/round75_ci_weights_regenerate.test.js
//
//   CI1　〔排表偏好〕喺開季前準備（第七十七輪批次 EA 組由第 2 步搬過去）
//   CI2　儲存偏好之後彈窗：「新的偏好會用在之後生成的職事表。要現在用新偏好重新生成這一季嗎？
//        會建立新一版，舊版本全部保留；職事表上未儲存的改動會不見。」〔重新生成〕〔之後再說〕
//   CI3　〔重新生成〕走現有「重新生成初稿（覆蓋式）」同一個確認畫面（仍然要打「確認」）；
//        〔之後再說〕乜都唔做
//   CI4　未生成過 ⇒ 唔問（生成時自然用新偏好）

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const QUESTION = '新的偏好會用在之後生成的職事表。要現在用新偏好重新生成這一季嗎？'
  + '會建立新一版，舊版本全部保留；職事表上未儲存的改動會不見。';

function setup(hasVersion) {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  vm.runInContext('closeModalAndRefresh = async function () { __refreshed = (typeof __refreshed === "number" ? __refreshed : 0) + 1; closeModal(); };', ui);
  const calls = [];
  ui.callServerMutating = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'apiSavePersonPostWeightBatch') return { ok: true, added: 1, released: 0 };
    return { ok: true, versionNo: 3 };
  };
  ui.callServer = async (name) => {
    calls.push({ name });
    return { loadAvailable: true, invalid: [], posts: [], choices: [{ adjust: 1, label: '多一次' }] };
  };
  vm.runInContext('getDashboard = async function () { return ' + JSON.stringify(
    hasVersion ? { latestVersion: { versionNo: 2 } } : { latestVersion: null }) + '; };', ui);
  return { ui, calls };
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];

(async () => {
  console.log('\n=== CI1：〔排表偏好〕喺開季前準備（第七十七輪批次 EA 組由第 2 步搬過去）===');
  {
    const { ui } = setup(true);
    const card = ui.renderStep2({ latestVersion: { versionNo: 2, sheetUrl: 'https://example.invalid/v2' },
      buttons: { save: { enabled: true } }, versionChoices: [] }, {});
    check('★★★★★ 第 2 步冇〔排表偏好〕', !btnIn(card, '排表偏好'));
    ui.renderZone2Body({ preQuarter: { items: [] } });
    check('★★★★★ 開季前準備有〔排表偏好〕', !!btnIn(ui.document.getElementById('zone2Body'), '排表偏好'));
  }

  console.log('\n=== CI2／CI3：儲存偏好之後問一句 ===');
  {
    const { ui, calls } = setup(true);
    await ui.openWeights();
    await tick();
    vm.runInContext("weightChanges = { 'P9701|CHAIR': { adjust: 1, reason: '想多做' } };", ui);
    ui.confirmWeightBatch();
    const acts = () => ui.document.getElementById('modalActions');
    const body = () => ui.document.getElementById('modalBody');
    btnIn(acts(), '確定儲存').fire('click');
    await tick();
    check('（準備）偏好儲存咗', calls.some((c) => c.name === 'apiSavePersonPostWeightBatch'), JSON.stringify(calls));
    check('★★★★★★ 儲存之後彈窗問：' + QUESTION, body().textContent.indexOf(QUESTION) !== -1, body().textContent);
    check('★★★★★ 有〔重新生成〕〔之後再說〕', !!btnIn(acts(), '重新生成') && !!btnIn(acts(), '之後再說'));
    check('★★★★★ 未撳之前乜都冇生成', !calls.some((c) => c.name === 'apiGenerateRoster'));

    btnIn(acts(), '重新生成').fire('click');
    await tick();
    const title = ui.document.getElementById('modalTitle').textContent;
    const inputs = body().flatten().filter((n) => n.tagName === 'INPUT');
    check('★★★★★★ 〔重新生成〕⇒ 現有「重新生成初稿（覆蓋式）」確認畫面', title === '重新生成初稿（覆蓋式）', title);
    check('★★★★★★ 仍然要打「確認」（打字框）', inputs.length === 1 && inputs[0].placeholder === '確認',
      JSON.stringify(inputs.map((i) => i.placeholder)));
    check('★★★★★ 未打字確認之前乜都冇生成', !calls.some((c) => c.name === 'apiGenerateRoster'));
  }
  {
    const { ui, calls } = setup(true);
    await ui.openWeights();
    await tick();
    vm.runInContext("weightChanges = { 'P9701|CHAIR': { adjust: 1, reason: '想多做' } };", ui);
    ui.confirmWeightBatch();
    btnIn(ui.document.getElementById('modalActions'), '確定儲存').fire('click');
    await tick();
    btnIn(ui.document.getElementById('modalActions'), '之後再說').fire('click');
    await tick();
    check('★★★★★ 〔之後再說〕乜都唔做（冇生成）', !calls.some((c) => c.name === 'apiGenerateRoster'));
  }

  console.log('\n=== CI4：未生成過就唔問 ===');
  {
    const { ui } = setup(false);
    await ui.openWeights();
    await tick();
    vm.runInContext("weightChanges = { 'P9701|CHAIR': { adjust: 1, reason: '想多做' } };", ui);
    ui.confirmWeightBatch();
    btnIn(ui.document.getElementById('modalActions'), '確定儲存').fire('click');
    await tick();
    const t = ui.document.getElementById('modalBody').textContent;
    check('★★★★ 未生成過 ⇒ 唔問重新生成，只講生成時會用', t.indexOf(QUESTION) === -1 && /生成這一季的職事表時會用新的偏好/.test(t)
      && !btnIn(ui.document.getElementById('modalActions'), '重新生成'), t);
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
