// 第七十六輪批次 DC 組：臨時幫手列為「收不到電郵」，第 4 步都要選得到佢。
// 執行方式：node tests/round76_dc_temp_helper_paper.test.js
//
// 第七十五輪回歸 R10：「收不到電郵」有 9 位（包括臨時幫手 ivan），但第 4 步名單只有 8 位、選不到 ivan。
//
//   DC1　第 4 步名單有這一季臨時幫手，預設勾選，標明「臨時幫手」
//   DC2　個人 PDF：臨時幫手按名字標示佢嗰幾格（冇 PersonID）；檔名用佢個名
//   DC3　外請講員（人手崗位、唔喺名單）照舊唔列入第 4 步、唔列入「收不到電郵」
//   DC4　寄出窗「收不到電郵」人數＝第 4 步預設勾選人數（同一份名單）

const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppMainFlow.gs', 'PdfExport.gs', 'PaperPack.gs'] });
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);
sc.setCell(0, D[2], 'CHAIR#1', 'ivan');                  // 臨時幫手
sc.setCell(0, D[3], 'CHAIR#1', 'ivan');                  // 同一個臨時幫手第二格
sc.setCell(0, D[1], 'CHAIR#1', sc.nameOf('P9707'));      // 名單上冇電郵
sc.setCell(0, D[0], 'PREACH#1', 'Rev Wong');             // 外請講員
gas.apiSetCellDecisions(sc.Q, [
  { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true },
  { serviceDate: D[3], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }
]);
let plan = gas.apiSaveAndConfirmPlan(sc.Q);
if (plan.needsDecision) {
  gas.apiSetCellDecisions(sc.Q, (plan.decisionItems.rules || []).map((r) => Object.assign({}, r, { checked: true })));
}
const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）第 1 版', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 300));

console.log('\n=== DC1／DC3：第 4 步名單 ===');
const state = gas.apiGetPaperListState(sc.Q);
{
  const temps = state.tempHelpers || [];
  check('★★★★★★ 有臨時幫手 ivan（鍵 NAME:ivan，2 格）', temps.length === 1 && temps[0].personId === 'NAME:ivan'
    && temps[0].nameTC === 'ivan' && temps[0].cellCount === 2 && temps[0].tempHelper === true, JSON.stringify(temps));
  check('★★★★★ 名單上冇電郵嘅人照列', state.noEmail.some((p) => p.personId === 'P9707'), JSON.stringify(state.noEmail));
  const all = state.noEmail.concat(state.withEmail).concat(temps).map((p) => p.nameTC);
  check('★★★★★★ 外請講員唔列入第 4 步', all.indexOf('Rev Wong') === -1, JSON.stringify(all));
}

console.log('\n=== DC4：人數一致 ===');
{
  const u = gas.buildUnreachablePeople_(sc.Q, null);
  check('★★★★★★ 「收不到電郵」人數＝第 4 步預設勾選人數（冇電郵＋臨時幫手）',
    u.people.length === state.noEmail.length + state.tempHelpers.length, JSON.stringify([u.people, state.noEmail.length, state.tempHelpers.length]));
  check('★★★★★ 「收不到電郵」唔包外請講員，只數', !u.people.some((p) => p.name === 'Rev Wong') && u.externalNameCount === 1,
    JSON.stringify(u));
}

console.log('\n=== DC2：個人 PDF 按名字標示 ===');
{
  check('★★★★★ 臨時幫手嘅名＝鍵入面個名（檔名用佢）', gas.lookupPersonName_('NAME:ivan') === 'ivan');
  check('★★★★ 普通 PersonID 照舊', gas.lookupPersonName_('P9701') === sc.nameOf('P9701'));
  const sheet = sc.gridSheet(1);
  const located = gas.locatePersonCells_(sheet, sc.Q, 1, 'NAME:ivan');
  const keys = located.matched.map((m) => m.key).sort();
  check('★★★★★★ 按名字搵到佢嗰兩格（唔靠 PersonID）', located.method === 'PERSON_ID' && keys.length === 2
    && keys.every((k) => k === 'CHAIR#1'), JSON.stringify(located));
  gas.getOrCreateRosterSubfolder_ = function () {
    return { getUrl: () => 'https://example.invalid/folder', getFilesByName: () => ({ hasNext: () => false }) };
  };
  const files = gas.listPaperPackFiles_(sc.Q, 1, ['NAME:ivan']);
  const split = gas.splitPaperPackMissing_(files.missing);
  check('★★★★★ 未產生嘅臨時幫手 PDF 屬「產生得返」（唔係「NameMapping 查不到」）',
    split.generatable.length === 1 && split.generatable[0].nameTC === 'ivan' && split.unfixable.length === 0, JSON.stringify(files));
}

console.log('\n=== DC1：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.callServer = async () => ({
    versionNo: 1,
    noEmail: [{ personId: 'P9707', nameTC: '假庚', cellCount: 1 }],
    withEmail: [{ personId: 'P9701', nameTC: '假甲', cellCount: 3 }],
    tempHelpers: [{ personId: 'NAME:ivan', nameTC: 'ivan', cellCount: 2, tempHelper: true }],
    message: ''
  });
  ui.openPaperDialog();
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  const body = ui.document.getElementById('modalBody');
  const t = body.textContent;
  check('★★★★★★ 名單有 ivan，標明臨時幫手', /ivan/.test(t) && t.indexOf('臨時幫手，收不到電郵') !== -1, t.slice(0, 600));
  check('★★★★★ 標題人數包括臨時幫手', /查不到電郵的有 2 位（包括 1 位臨時幫手）/.test(t), t.slice(0, 600));
  const ids = vm.runInContext('selectedPaperIds()', ui);
  check('★★★★★★ 預設勾選＝冇電郵＋臨時幫手（2 位），有電郵嘅唔勾', JSON.stringify(ids.slice().sort())
    === JSON.stringify(['NAME:ivan', 'P9707']), JSON.stringify(ids));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
