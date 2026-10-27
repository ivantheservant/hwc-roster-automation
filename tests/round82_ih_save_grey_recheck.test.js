// 第八十二輪批次 IH 組：沒有改動時〔儲存〕變灰；切回幹事介面自動輕量重新檢查。
// 執行方式：node tests/round82_ih_save_grey_recheck.test.js
//
//   IH1　純函式 computeSaveButton_()：冇改動 ⇒ 灰＋「表上沒有未儲存的改動」；表上改動／修改申報／認唔出嘅名／
//        用舊版本作起點未儲存 ⇒ 亮；讀唔到未儲存狀態 ⇒ 亮（唔當成冇嘢）；冇版本 ⇒ 灰
//   IH2　真入口 apiGetSaveButtonState()：生成後灰；改一格 ⇒ 亮、「偵測到你在表上改了 1 格」；儲存後灰；
//        有修改申報 ⇒ 亮；主畫面 apiGetDashboardState() 同一個答案
//   IH3　前端：切返嚟 ⇒ 叫輕量呼叫、更新〔儲存〕同第 2 步嗰句；10 秒內唔重覆；彈窗開住唔做

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
const D = sc.DATES;

console.log('\n=== IH1：純函式 ===');
{
  const none = { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, needsInputCount: 0, hasAny: false };
  const b = (over, unsaved) => gas.computeSaveButton_(Object.assign({ versionExists: true, stage: 'DRAFT',
    unsaved: Object.assign({}, none, unsaved || {}), startPointPending: false }, over || {}));
  const off = b();
  check('★★★★★★ 冇改動 ⇒ 灰', off.enabled === false, JSON.stringify(off));
  check('★★★★★ 原因「表上沒有未儲存的改動」', off.disabledReason === '表上沒有未儲存的改動', off.disabledReason);
  check('★★★★★★ 表上改動 ⇒ 亮', b({}, { gridChangeCount: 1, hasAny: true }).enabled === true);
  check('★★★★★★ 修改申報 ⇒ 亮', b({}, { pendingRequestCount: 2, hasAny: true }).enabled === true);
  check('★★★★★ 認唔出嘅名 ⇒ 亮', b({}, { unresolvedCount: 1 }).enabled === true);
  check('★★★★★★ 用舊版本作起點未儲存 ⇒ 亮', b({ startPointPending: true }).enabled === true);
  check('★★★★★ 起點未儲存嗰句', /用了舊版本作起點，還未儲存/.test(b({ startPointPending: true }).dynamicText), b({ startPointPending: true }).dynamicText);
  check('★★★★★ 讀唔到未儲存狀態（-1、hasAny）⇒ 亮', b({}, { gridChangeCount: -1, unresolvedCount: -1, pendingRequestCount: -1, hasAny: true }).enabled === true);
  check('★★★★ 冇版本 ⇒ 灰、原因係生成', b({ versionExists: false }).enabled === false && /要先生成初稿/.test(b({ versionExists: false }).disabledReason));
}

console.log('\n=== IH2：真入口 ===');
{
  gas.apiGenerateDraftExecute(sc.Q);
  let s = gas.apiGetSaveButtonState(sc.Q);
  check('★★★★★★ 生成後冇改動 ⇒ 灰', s.save.enabled === false && s.versionNo === 0, JSON.stringify(s));
  check('★★★★★ 主畫面同一個答案', gas.apiGetDashboardState(sc.Q).buttons.save.enabled === false);
  const now = sc.getCell(0, D[1], 'CHAIR#1');
  const other = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => n !== now)[0];
  sc.setCell(0, D[1], 'CHAIR#1', other);
  s = gas.apiGetSaveButtonState(sc.Q);
  check('★★★★★★ 改一格 ⇒ 亮', s.save.enabled === true, JSON.stringify(s));
  check('★★★★★ 第 2 步「偵測到你在表上改了 1 格」', /^偵測到你在表上改了 1 格/.test(s.save.dynamicText), s.save.dynamicText);
  check('★★★★ 主畫面同一個答案', gas.apiGetDashboardState(sc.Q).buttons.save.enabled === true);
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ 儲存後 ⇒ 灰', gas.apiGetSaveButtonState(sc.Q).save.enabled === false);
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  check('★★★★★ 用舊版本作起點 ⇒ 亮', gas.apiGetSaveButtonState(sc.Q).save.enabled === true);
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  // 修改申報
  const reqSheet = sc.ss.getSheetByName(sc.S.REQUESTS);
  if (reqSheet) {
    const keys = reqSheet.getRange(2, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(String);
    const chairOn = sc.getCell(2, D[2], 'CHAIR#1');
    sc.appendRows(sc.ss, sc.S.REQUESTS, keys, [{ QuarterID: sc.Q, ServiceDate: D[2], PostName: '主席',
      PersonName: chairOn, RequestType: '不能服侍', CreatedAt: '2099-01-01 09:00:00' }]);
    const s2 = gas.apiGetSaveButtonState(sc.Q);
    const u = gas.readDashboardUnsavedState_(sc.Q, s2.versionNo);
    check('★★★★★ 有修改申報（未處理）⇒ 亮', s2.save.enabled === (u.pendingRequestCount > 0) && u.pendingRequestCount > 0,
      JSON.stringify([s2.save, u]));
  } else {
    check('（略過）冇 Requests 工作表', true);
  }
}

console.log('\n=== IH3：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptMainFlow.html']);
  const calls = [];
  let answer = { save: { enabled: true, disabledReason: '', dynamicText: '偵測到你在表上改了 1 格。' } };
  ui.callServer = async (fn, q) => { calls.push([fn, q]); return answer; };
  ui.eval = undefined;
  const vm = require('vm');
  // 設定目前季度同第 2 步節點（模擬 renderStep2 之後）
  const btn = new ui.__StubNode('button'); btn.disabled = true;
  const note = new ui.__StubNode('div'); note.textContent = '未偵測到你在表上改過任何格。';
  const why = new ui.__StubNode('div'); why.textContent = '表上沒有未儲存的改動';
  vm.runInContext("currentQuarterId = '2099T1'; modalOpen = false;", ui);
  ui.__setRefs = null;
  vm.runInContext('step2SaveRefs_ = { btn: __btn, note: __note, why: __why };', Object.assign(ui, { __btn: btn, __note: note, __why: why }));
  (async () => {
    const t0 = 1000000;
    const r1 = await ui.maybeRecheckSaveButton(t0);
    check('★★★★★★ 切返嚟 ⇒ 叫 apiGetSaveButtonState（輕量，唔係成個主畫面）', r1 === true && calls.length === 1
      && calls[0][0] === 'apiGetSaveButtonState' && calls[0][1] === '2099T1', JSON.stringify(calls));
    check('★★★★★★ 〔儲存〕變亮、第 2 步寫「偵測到你在表上改了 1 格」', btn.disabled === false && /偵測到你在表上改了 1 格/.test(note.textContent),
      JSON.stringify([btn.disabled, note.textContent]));
    check('★★★★ 亮咗之後原因隱藏', why.hidden === true);
    const r2 = await ui.maybeRecheckSaveButton(t0 + 5000);
    check('★★★★★ 10 秒內唔重覆', r2 === false && calls.length === 1);
    answer = { save: { enabled: false, disabledReason: '表上沒有未儲存的改動', dynamicText: '未偵測到你在表上改過任何格。' } };
    const r3 = await ui.maybeRecheckSaveButton(t0 + 11000);
    check('★★★★★ 10 秒後再檢查；冇改動 ⇒ 灰、寫原因', r3 === true && btn.disabled === true && why.hidden === false
      && why.textContent === '表上沒有未儲存的改動', JSON.stringify([r3, btn.disabled, why.hidden, why.textContent]));
    vm.runInContext('modalOpen = true;', ui);
    const r4 = await ui.maybeRecheckSaveButton(t0 + 30000);
    check('★★★★ 彈窗開住 ⇒ 唔做', r4 === false && calls.length === 2);
    check('★★★★ 只讀 API 名單有 apiGetSaveButtonState', /'apiGetSaveButtonState'/.test(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'ui', 'Script.html'), 'utf8')));
    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}
