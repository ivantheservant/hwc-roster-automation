// 第八十二輪批次 ID 組：儲存排表偏好之後，拿走「要不要重新生成」（Ivan：不用這個功能——重新生成會蓋過人手改動）。
// 執行方式：node tests/round82_id_weights_saved_notice.test.js
//
//   ID1　有版本：儲存之後只出完成訊息「已儲存排表偏好（只限 …）。要用新偏好調整現有的職事表，
//        撳第 2 步〔請系統幫我調整〕；還未生成的話，生成時會自動用。」〔知道了〕；冇〔重新生成〕〔之後再說〕；冇生成
//   ID2　未有版本：同一句（唔分兩種）
//   ID3　前端冇「要現在用新偏好重新生成這一季嗎」呢句、冇 askRegenerateAfterWeights

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const NOTICE = '已儲存排表偏好（只限 2099年1-3月）。要用新偏好調整現有的職事表，撳第 2 步〔請系統幫我調整〕；'
  + '還未生成的話，生成時會自動用。';

function setup(hasVersion) {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  vm.runInContext('closeModalAndRefresh = async function () { closeModal(); };', ui);
  const calls = [];
  ui.callServerMutating = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'apiSavePersonPostWeightBatch') return { ok: true, added: 1, released: 0, scopeText: '只限 2099年1-3月' };
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

async function saveOnce(hasVersion) {
  const { ui, calls } = setup(hasVersion);
  await ui.openWeights();
  await tick();
  vm.runInContext("weightChanges = { 'P9701|CHAIR': { adjust: 1, reason: '想多做' } };", ui);
  ui.confirmWeightBatch();
  btnIn(ui.document.getElementById('modalActions'), '確定儲存').fire('click');
  await tick();
  return { ui, calls, body: ui.document.getElementById('modalBody').textContent, acts: ui.document.getElementById('modalActions') };
}

(async () => {
  console.log('\n=== ID1：有版本 ===');
  {
    const r = await saveOnce(true);
    check('（準備）偏好儲存咗', r.calls.some((c) => c.name === 'apiSavePersonPostWeightBatch'));
    check('★★★★★★ 只出完成訊息：' + NOTICE, r.body.indexOf(NOTICE) !== -1, r.body);
    check('★★★★★★ 冇〔重新生成〕〔之後再說〕，只有〔知道了〕', !btnIn(r.acts, '重新生成') && !btnIn(r.acts, '之後再說')
      && !!btnIn(r.acts, '知道了'));
    check('★★★★★ 冇問要唔要重新生成', !/要現在用新偏好重新生成/.test(r.body), r.body);
    check('★★★★★ 冇生成', !r.calls.some((c) => /Generate/.test(c.name)), JSON.stringify(r.calls.map((c) => c.name)));
  }

  console.log('\n=== ID2：未有版本 ===');
  {
    const r = await saveOnce(false);
    check('★★★★★ 同一句', r.body.indexOf(NOTICE) !== -1, r.body);
  }

  console.log('\n=== ID3：原始碼 ===');
  {
    const z3 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
    check('★★★★★ 冇「要現在用新偏好重新生成這一季嗎」', z3.indexOf('要現在用新偏好重新生成這一季嗎') === -1);
    check('★★★★ 冇 askRegenerateAfterWeights', z3.indexOf('askRegenerateAfterWeights') === -1);
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
