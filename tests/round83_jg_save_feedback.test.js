// 第八十三輪批次 JG 組：〔儲存〕撳下去即時有反應；伺服器成功（遲到都好）一定畫完成窗。
// 執行方式：node tests/round83_jg_save_feedback.test.js
//
// 現場（第八十二輪 Q7）：正式發出之後改一格 →〔儲存〕⇒ 80 秒畫面冇任何變化（冇忙碌牌）；
// 其實已經存成第 3 版，但完成窗冇出現，再撳一次先出「沒有偵測到任何改動」。
// 原因：〔儲存〕嘅「讀取改動」入面叫 `executeCleanSave()` 開第二個 `runAction()` 而冇 `return`
// ⇒ 外層即刻完成（閃「已完成」、收牌、解鎖），後台仲儲存緊。〔請系統幫我調整〕同一個形狀。
//
//   JG1　巢狀 runAction（內層冇被 await）：外層完成而內層未完 ⇒ 仍然忙碌、牌仲喺度、唔講「已完成」
//   JG2　快路儲存：成功結果遲到 ⇒ 照樣畫「儲存完成」窗；失敗 ⇒ 錯誤窗
//   JG3　完成窗喺 OFFICIAL_SENT（正式發出之後）嘅結果形狀唔會拋例外
//   JG4　撳〔儲存〕即刻變灰＋「儲存中……」；完成後還原；儲存緊切返嚟唔會著返粒掣
//   JG5　〔請系統幫我調整〕同樣等埋調整先算完成
//   JG6　後端：儲存結果帶分段時間（`timings`，最後一項「合計」）

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

function deferred() {
  let resolve; let reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

function loadUi() {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptMainFlow.html', 'ScriptSuggestion.html']);
  ui.setInterval = () => 0;
  ui.clearInterval = () => {};
  ui.loadDashboard = async () => {};
  vm.runInContext("currentQuarterId = '2028T3';", ui);
  return ui;
}
const busyTitle = (ui) => ui.document.getElementById('busyTitle').textContent;
const busyVisible = (ui) => !ui.document.getElementById('busyOverlay').hidden;
const isBusy = (ui) => ui.document.body.classList.contains('is-busy');
const modalTitle = (ui) => ui.document.getElementById('modalTitle').textContent;
const cleanPlan = { confirmReasons: [], gridChanges: [{}], violations: {}, requests: {} };
const okResult = { ok: true, versionNo: 3, baseVersionNo: 2, cellCount: 1,
  savedChanges: [{ serviceDate: '2028-08-27', postNameTC: '讀經', slotIndex: 1, fromName: '甲', toName: '乙' }],
  timings: [{ label: '合計', ms: 61000 }] };

(async () => {
  console.log('\n=== JG1：巢狀 runAction（內層冇被 await）===');
  {
    const ui = loadUi();
    const inner = deferred();
    await ui.runAction('外層', async () => {
      ui.runAction('內層', async () => { await inner.p; });   // ⚠️ 特登唔 await
    });
    check('★★★★★★ JG1 外層完成、內層未完 ⇒ 仍然忙碌（介面鎖住）', isBusy(ui) === true);
    check('★★★★★★ JG1 牌仲喺度，冇講「已完成」', busyVisible(ui) && busyTitle(ui) !== '已完成', busyTitle(ui));
    inner.resolve();
    await settle();
    check('★★★★★ JG1 內層完成 ⇒ 解鎖', isBusy(ui) === false);
  }

  console.log('\n=== JG2：快路儲存，成功結果遲到 ⇒ 照樣畫完成窗 ===');
  {
    const ui = loadUi();
    const exec = deferred();
    ui.callServer = async (fn) => (fn === 'apiSaveAndConfirmPlan' ? cleanPlan : {});
    ui.callServerMutating = async (fn) => (fn === 'apiSaveAndConfirmExecute' ? exec.p : {});
    let settled2 = false;
    const done = ui.openSaveAndConfirm();
    done.then(() => { settled2 = true; });
    await settle();
    check('★★★★★★ JG2〔儲存〕要等埋儲存先算完成（executeCleanSave 有 return）', settled2 === false);
    check('★★★★★★ JG2 讀取完、儲存未完 ⇒ 仍然忙碌、冇「已完成」', isBusy(ui) && busyTitle(ui) !== '已完成', busyTitle(ui));
    check('★★★★★ JG2 牌寫「儲存中」', /儲存中/.test(busyTitle(ui)), busyTitle(ui));
    exec.resolve(okResult);
    await done;
    await settle();
    check('★★★★★★ JG2 遲到嘅成功 ⇒ 「儲存完成」窗', modalTitle(ui) === '儲存完成', modalTitle(ui));
    check('★★★★★ JG2 完成後解鎖', isBusy(ui) === false);

    const ui2 = loadUi();
    ui2.callServer = async () => cleanPlan;
    ui2.callServerMutating = async () => { throw new Error('Service Spreadsheets failed'); };
    await ui2.openSaveAndConfirm();
    await settle();
    check('★★★★★ JG2 伺服器失敗 ⇒ 錯誤窗（唔係冇反應）', /做不到/.test(modalTitle(ui2)), modalTitle(ui2));
  }

  console.log('\n=== JG3：OFFICIAL_SENT 嘅完成窗唔會拋例外 ===');
  {
    const ui = loadUi();
    let err = null;
    try {
      ui.renderSaveResult(Object.assign({}, okResult, { stageAdvanced: false, startPointVersionNo: null,
        startPointCells: [], releasedViolationCount: 0, appliedRequestCount: 0, publishFailed: false,
        baseSheetRestoreFailed: '' }));
    } catch (e) { err = e; }
    check('★★★★★★ JG3 唔拋例外、畫「儲存完成」', !err && modalTitle(ui) === '儲存完成', err && err.message);
  }

  console.log('\n=== JG4：撳〔儲存〕即時變灰＋「儲存中……」===');
  {
    const ui = loadUi();
    const btn = ui.document.createElement('button');
    const running = ui.document.createElement('span');
    running.hidden = true;
    ui.__refs = { btn: btn, running: running, note: null, why: null };
    vm.runInContext('step2SaveRefs_ = __refs;', ui);
    const plan = deferred();
    let recheckCalls = 0;
    ui.callServer = async (fn) => {
      if (fn === 'apiGetSaveButtonState') { recheckCalls++; return { save: { enabled: true } }; }
      return fn === 'apiSaveAndConfirmPlan' ? plan.p : {};
    };
    ui.callServerMutating = async () => okResult;
    const done = ui.openSaveAndConfirm();
    check('★★★★★★ JG4 撳下即刻變灰（未等伺服器）', btn.disabled === true);
    check('★★★★★★ JG4 旁邊即刻寫「儲存中……（可能要一至兩分鐘，請不要再撳）」',
      running.hidden === false && running.textContent === '儲存中……（可能要一至兩分鐘，請不要再按）', running.textContent);
    check('★★★★★ JG4 中央處理中牌即刻出現', busyVisible(ui) && isBusy(ui));
    const rechecked = await ui.maybeRecheckSaveButton(Date.now() + 999999);
    check('★★★★★ JG4 儲存緊切返嚟唔會著返粒掣', rechecked === false && recheckCalls === 0 && btn.disabled === true);
    plan.resolve(cleanPlan);
    await done;
    await settle();
    check('★★★★★ JG4 完成後還原（文字收起）', running.hidden === true && running.textContent === '');
  }

  console.log('\n=== JG5：〔請系統幫我調整〕等埋調整先算完成 ===');
  {
    const ui = loadUi();
    const build = deferred();
    ui.callServer = async (fn) => (fn === 'apiCheckMyChanges' ? { ok: true, undecidedCount: 0 } : {});
    ui.callServerMutating = async (fn) => (fn === 'apiBuildSuggestion' ? build.p : {});
    ui.renderSuggestionResult = () => { ui.__rendered = true; };
    let settled5 = false;
    const done = ui.openBuildSuggestion();
    done.then(() => { settled5 = true; });
    await settle();
    check('★★★★★★ JG5 要等埋調整先算完成（runBuildSuggestion 有 return）', settled5 === false);
    check('★★★★★★ JG5 讀取完、調整未完 ⇒ 仍然忙碌、冇「已完成」', isBusy(ui) && busyTitle(ui) !== '已完成', busyTitle(ui));
    build.resolve({ ok: true });
    await done;
    await settle();
    check('★★★★★ JG5 調整完成 ⇒ 畫結果、解鎖', ui.__rendered === true && isBusy(ui) === false);
  }

  console.log('\n=== JG6：後端分段時間 ===');
  {
    const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
    const gas = sc.gas;
    gas.apiGenerateDraftExecute(sc.Q);
    const D = sc.DATES;
    const busy = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((k) => sc.getCell(0, D[0], k));
    const free = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
    sc.setCell(0, D[0], 'CHAIR#1', free);
    const r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
    const t = (r && r.timings) || [];
    check('（前置）儲存成第 1 版', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
    check('★★★★★ JG6 有分段時間，最後一項「合計」', t.length >= 5 && t[t.length - 1].label === '合計'
      && t.every((x) => typeof x.ms === 'number' && x.ms >= 0), JSON.stringify(t));
    check('★★★★ JG6 包括「重新檢查」「建立新版本」「重新發佈公開連結」',
      ['重新檢查', '建立新版本', '重新發佈公開連結'].every((w) => t.some((x) => x.label.indexOf(w) !== -1)), JSON.stringify(t));
  }
})().then(() => {
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}, (e) => { console.log('FAIL  未預期例外：' + e.stack); process.exit(1); });
