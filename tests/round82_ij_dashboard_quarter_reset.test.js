// 第八十二輪批次 IJ 組：幹事介面〔整季清走重來〕（重用試算表選單「重設季度測試資料」同一支後端）。
// 執行方式：node tests/round82_ij_dashboard_quarter_reset.test.js
//
//   IJ1　確認清單＝選單版同一份（describeQuarterResetPlanLines_(planQuarterReset_(季度, 連 v0))）
//   IJ2　受保護季度（QUARTER_RESET_BLOCKED_QUARTERS）：清單回 blocked、執行拋錯、乜都冇清；主畫面掣灰＋原因
//   IJ3　打錯字 ⇒ 唔執行、乜都冇清
//   IJ4　已正式發出 ⇒ 清單最上面紅框「這一季已經正式發出給全體，清走之後寄出紀錄亦會清走。」
//   IJ5　打「確認重設」⇒ 連第 0 版清走、0 個版本、Stage 回 DRAFT；AuditLog 有做之前／之後兩筆
//   IJ6　前端：常用設定有〔整季清走重來〕（紅色）；封鎖 ⇒ 灰掣＋原因；打字框要「確認重設」

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

function scene(config) {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'QuarterReset.gs', 'Menu.gs', 'WebAppQuarterReset.gs'],
    config: config });
  const gas = sc.gas;
  gas.listRosterPdfFilesForQuarter_ = function () { return []; };
  gas.listEditableCopyFilesForQuarter_ = function () { return []; };
  gas.listEmptyVersionFoldersForReset_ = function () { return []; };
  gas.apiGenerateDraftExecute(sc.Q);
  const D = sc.DATES;
  const now = sc.getCell(0, D[1], 'CHAIR#1');
  sc.setCell(0, D[1], 'CHAIR#1', ['P9701', 'P9702', 'P9703'].map(sc.nameOf).filter((n) => n !== now)[0]);
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  return sc;
}
const versions = (sc) => sc.gas.readSheet(sc.S.ROSTER_VERSIONS).filter((r) => r[sc.C.ROSTER_VERSIONS.QUARTER_ID] === sc.Q).length;

console.log('\n=== IJ1／IJ3／IJ4／IJ5 ===');
{
  const sc = scene();
  const gas = sc.gas;
  check('（準備）兩個版本', versions(sc) === 2);
  const p = gas.apiQuarterResetPlan(sc.Q);
  // 第八十五輪批次 LB 組（刻意改動）：幹事介面版保留人手資料（keepManual），清單仍由同一支函式砌
  const menuLines = gas.describeQuarterResetPlanLines_(sc.Q, gas.planQuarterReset_(sc.Q, true, { keepManual: true }));
  check('★★★★★★ IJ1 清單同選單版一致（同一支 describeQuarterResetPlanLines_，連 v0）',
    JSON.stringify(p.lines) === JSON.stringify(menuLines) && p.lines.some((l) => /連 v0 一併清除：YES/.test(l)),
    JSON.stringify(p.lines).slice(0, 300));
  check('★★★★ 未發出 ⇒ 冇紅框', p.officialSent === false && p.officialSentWarning === '' && p.blocked === false);
  check('★★★★ 要打嘅字＝確認重設', p.confirmText === '確認重設');

  let threw = null;
  try { gas.apiQuarterResetExecute(sc.Q, '確認'); } catch (e) { threw = e; }
  check('★★★★★★ IJ3 打錯字 ⇒ 拋錯、乜都冇清', threw && /不是「確認重設」/.test(threw.message) && versions(sc) === 2,
    threw && threw.message);

  gas.advanceQuarterStage_(sc.Q, gas.QUARTER_STAGE.OFFICIAL_SENT);
  const p2 = gas.apiQuarterResetPlan(sc.Q);
  check('★★★★★★ IJ4 已正式發出 ⇒ 紅框字', p2.officialSent === true
    && p2.officialSentWarning === '這一季已經正式發出給全體，重設之後寄出紀錄亦會清除。', JSON.stringify(p2).slice(0, 300));

  const r = gas.apiQuarterResetExecute(sc.Q, '確認重設');
  check('★★★★★★ IJ5 清走：ok、0 個版本', r.ok === true && versions(sc) === 0, JSON.stringify(r).slice(0, 300));
  check('★★★★★ Stage 回 DRAFT', gas.getQuarterStage_(sc.Q) === gas.QUARTER_STAGE.DRAFT, gas.getQuarterStage_(sc.Q));
  const audit = gas.readSheet(sc.S.AUDIT_LOG).map((row) => String(row[sc.C.AUDIT_LOG.ACTION]));
  check('★★★★★ AuditLog 做之前／之後兩筆（同選單同一支 executeQuarterResetBatch_）',
    audit.indexOf('QUARTER_RESET_BATCH_BEFORE') !== -1 && audit.indexOf('QUARTER_RESET_BATCH_AFTER') !== -1);
  check('★★★★ 主畫面：還未生成（0 個版本）', gas.apiGetDashboardState(sc.Q).latestVersion === null);
}

console.log('\n=== IJ2：受保護季度 ===');
{
  const sc = scene({ QUARTER_RESET_BLOCKED_QUARTERS: ['2026T4,2099T1', 'LIST'] });
  const gas = sc.gas;
  const p = gas.apiQuarterResetPlan(sc.Q);
  check('★★★★★★ 清單回 blocked＋原因', p.blocked === true && /受保護/.test(p.blockedReason) && p.lines.length === 0,
    JSON.stringify(p).slice(0, 300));
  let threw = null;
  try { gas.apiQuarterResetExecute(sc.Q, '確認重設'); } catch (e) { threw = e; }
  check('★★★★★★ 打啱字都唔准、乜都冇清', threw && /受保護/.test(threw.message) && versions(sc) === 2, threw && threw.message);
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 主畫面帶封鎖狀態（灰掣用）', dash.quarterReset && dash.quarterReset.blocked === true && /受保護/.test(dash.quarterReset.reason),
    JSON.stringify(dash.quarterReset));
}

console.log('\n=== IJ6：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const btnAfter = (label) => {
    const body = ui.document.getElementById('zone3Body');
    const rows = body.flatten().filter((n) => n.className === 'act' && n.textContent.indexOf(label) !== -1);
    return rows[0] ? rows[0].flatten().filter((n) => n.tagName === 'BUTTON')[0] : null;
  };
  ui.renderZone3({ settingsLinks: {}, quarterReset: { blocked: false, reason: '' } });
  const b = btnAfter('整季重設');
  check('★★★★★★ 常用設定有〔整季清走重來〕而且係紅色危險掣', !!b && /danger/.test(b.className) && b.disabled === false,
    b && b.className);
  ui.renderZone3({ settingsLinks: {}, quarterReset: { blocked: true, reason: '2026T4 受保護（Config 的 QUARTER_RESET_BLOCKED_QUARTERS），不可以清除。' } });
  const b2 = btnAfter('整季重設');
  check('★★★★★★ 封鎖 ⇒ 灰掣＋原因', !!b2 && b2.disabled === true && /受保護/.test(ui.document.getElementById('zone3Body').textContent));
  ui.renderZone3({ settingsLinks: {} });
  check('★★★★ 冇狀態（舊後端）⇒ 當封鎖', btnAfter('整季重設').disabled === true);

  // 打字框要「確認重設」
  let confirmedWith = null;
  ui.openConfirm({ title: 't', bodyNodes: [], requireTyping: true, typingPhrase: '確認重設', onConfirm: (typed) => { confirmedWith = typed; } });
  const inputs = ui.document.getElementById('modalBody').flatten().filter((n) => n.tagName === 'INPUT');
  const okBtn = ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON')[0];
  check('★★★★★ 打字框提示「確認重設」', inputs.length === 1 && inputs[0].placeholder === '確認重設'
    && /輸入「確認重設」四個字/.test(ui.document.getElementById('modalBody').textContent));
  inputs[0].value = '確認';
  okBtn.fire('click');
  check('★★★★★ 打「確認」唔得', confirmedWith === null);
  inputs[0].value = '確認重設';
  okBtn.fire('click');
  check('★★★★★ 打「確認重設」先得', confirmedWith === '確認重設');
  check('★★★★ 只讀 API 名單有 apiQuarterResetPlan、冇 apiQuarterResetExecute',
    /'apiQuarterResetPlan'/.test(vm.runInContext('READ_ONLY_APIS.join("\'")', ui) ? "'" + vm.runInContext('READ_ONLY_APIS.join("\',\'")', ui) + "'" : '')
      && vm.runInContext('READ_ONLY_APIS.indexOf("apiQuarterResetExecute")', ui) === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
