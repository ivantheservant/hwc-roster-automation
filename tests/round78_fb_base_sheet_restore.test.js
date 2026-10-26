// 第七十八輪批次 FB 組：儲存新版本時還原舊表；〔查看這一版〕先準備、後開啟。
// 執行方式：node tests/round78_fb_base_sheet_restore.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十七輪回歸 G12）
// ═════════════════════════════════════════════════════════════════════
//
//   生成第 0 版 → 喺 `Roster_…_v0` 上直接改 5 格 → 儲存成第 1 版（新表 `_v1`）。
//   版本下拉揀第 0 版 →〔查看這一版〕→ 見到嘅仍然係嗰 5 格人手改動，唔係第 0 版原樣；
//   第 1 版完成窗卻寫「第 0 版原封不動保留」。
//
//   FB1　〔儲存〕：新版本建立之後，舊表還原成佢自己嗰一版（包括「類型」）
//   FB2　〔接受這個建議版本〕：同上
//   FB3　所有建立新版本、以舊表作起點嘅路都叫同一支（生成除外）
//   FB4　還原失敗唔可以令儲存失敗：記 AuditLog、完成窗黃框一句
//   FB5　畫面：〔查看這一版〕係一粒掣，等後端完成先出〔開啟第 N 版〕；還原失敗 ⇒ 黃框
//
// 用 mock 試算表（round75 harness），唔碰真實試算表。

const fs = require('fs');
const path = require('path');
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
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppZone4.gs'] });
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);
const others = (v, post, d) => ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf)
  .filter((n) => n !== sc.getCell(v, d, post))[0];
const sheetText = (v) => JSON.stringify(sc.gridSheet(v).getDataRange().getValues());

console.log('\n=== FB1【核心】〔儲存〕：舊表還原成第 0 版（包括類型）===');
const v0Sheet = sheetText(0);
const v0Chair = sc.getCell(0, D[0], 'CHAIR#1');
const v0Title = sc.getCell(0, D[1], '_TYPE');
{
  const newChair = others(0, 'CHAIR#1', D[0]);
  sc.setCell(0, D[0], 'CHAIR#1', newChair);
  sc.setCell(0, D[1], '_TYPE', 'Baptism Service');
  const r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 1 版建立', r && r.versionNo === 1 && r.baseVersionNo === 0, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 第 0 版嗰張表還原：主席返返第 0 版嘅人', sc.getCell(0, D[0], 'CHAIR#1') === v0Chair,
    sc.getCell(0, D[0], 'CHAIR#1'));
  check('★★★★★★ 「類型」都還原（第 2 週返返原本嘅標題）', sc.getCell(0, D[1], '_TYPE') === v0Title,
    sc.getCell(0, D[1], '_TYPE'));
  check('★★★★★ 整張第 0 版表同生成嗰陣一樣', sheetText(0) === v0Sheet);
  check('★★★★★ 第 1 版表有人手改動（主席、類型）', sc.getCell(1, D[0], 'CHAIR#1') === newChair
    && sc.getCell(1, D[1], '_TYPE') === 'Baptism Service', JSON.stringify([sc.getCell(1, D[0], 'CHAIR#1'), sc.getCell(1, D[1], '_TYPE')]));
  check('★★★★ 冇失敗 ⇒ baseSheetRestoreFailed 空', r.baseSheetRestoreFailed === '', r.baseSheetRestoreFailed);
}

console.log('\n=== FB2【核心】〔接受這個建議版本〕：舊表還原成第 1 版 ===');
{
  const v1Sheet = sheetText(1);
  const read1 = sc.getCell(1, D[0], 'READ#1');
  sc.setCell(1, D[0], 'READ#1', others(1, 'READ#1', D[0]));
  sc.setCell(1, D[3], 'WORSHIP#1', sc.nameOf('P9704'));   // 系統要改嘅違反
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（準備）建議表建立', sug.ok === true, JSON.stringify(sug).slice(0, 300));
  const acc = gas.apiAcceptSuggestion(sc.Q);
  check('（準備）第 2 版建立', acc.ok === true && acc.versionNo === 2, JSON.stringify(acc).slice(0, 300));
  check('★★★★★★ 第 1 版嗰張表還原（讀經返返原本嘅人）', sc.getCell(1, D[0], 'READ#1') === read1,
    sc.getCell(1, D[0], 'READ#1'));
  check('★★★★★ 整張第 1 版表同儲存嗰陣一樣', sheetText(1) === v1Sheet);
  check('★★★★ 冇失敗 ⇒ baseSheetRestoreFailed 空', acc.baseSheetRestoreFailed === '', acc.baseSheetRestoreFailed);
}

console.log('\n=== FB3：所有建立新版本、以舊表作起點嘅路都叫同一支 ===');
{
  const callers = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f))
    .filter((f) => /\bregisterVersion\(/.test(read('src/' + f).replace(/^\s*(\/\/|\*).*$/gm, '')))
    .filter((f) => f !== 'RosterWriter.gs');
  const missing = callers.filter((f) => f !== 'MultiRun.gs'
    && !/restoreBaseSheetAfterNewVersion_\(/.test(read('src/' + f)));
  check('★★★★★★ 每個建立新版本嘅檔（生成 MultiRun.gs 除外）都叫 restoreBaseSheetAfterNewVersion_()',
    callers.length >= 6 && missing.length === 0, 'callers=' + callers.join(',') + ' missing=' + missing.join(','));
  check('★★★★★ 套用修改申報（步驟 3、5、〔儲存〕有申報）喺 applyRequests_() 還原一次',
    /restoreBaseSheetAfterNewVersion_\(plan\.quarterId, plan\.baseVersionNo, 'applyRequests_'\)/.test(read('src/RequestsApply.gs')));
  check('★★★★★ 〔儲存〕有申報嗰條路唔還原兩次（用 applyRequests_() 嘅結果）',
    /requestResult\s*\n?\s*\? \(requestResult\.baseSheetRestoreFailed \|\| ''\)/.test(read('src/WebAppSaveConfirm.gs')));
}

console.log('\n=== FB4【核心】還原失敗唔可以令儲存失敗 ===');
{
  const realWrite = gas.writeVersionContentIntoSheet_;
  gas.writeVersionContentIntoSheet_ = function () { throw new Error('受保護，寫不到'); };
  const v2Chair = sc.getCell(2, D[2], 'CHAIR#1');
  sc.setCell(2, D[2], 'CHAIR#1', others(2, 'CHAIR#1', D[2]));
  let r = null;
  let threw = '';
  try { r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] }); } catch (e) { threw = e.message; }
  gas.writeVersionContentIntoSheet_ = realWrite;
  check('★★★★★★ 儲存照樣成功（第 3 版）', !threw && r && r.ok === true && r.versionNo === 3, threw || JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 結果帶住原因', r && /受保護，寫不到/.test(r.baseSheetRestoreFailed || ''), r && r.baseSheetRestoreFailed);
  const A = sc.C.AUDIT_LOG;
  const logged = gas.readSheet(sc.S.AUDIT_LOG).filter((a) => a[A.ACTION] === 'BASE_SHEET_RESTORE_FAILED');
  check('★★★★★ AuditLog 記低（第 2 版、原因、查看時會再試）', logged.length === 1
    && logged[0][A.TARGET_KEY] === sc.Q + '-v2' && /受保護，寫不到/.test(logged[0][A.NOTES]) && /查看時系統會再試/.test(logged[0][A.NOTES]),
    JSON.stringify(logged));
  check('（準備）第 2 版嗰張表仲係人手改過嘅字', sc.getCell(2, D[2], 'CHAIR#1') !== v2Chair);
  const view = gas.apiOpenVersionForViewing(sc.Q, 2);
  check('★★★★★★ 〔查看這一版〕嗰陣再試一次：第 2 版嗰張表還原', sc.getCell(2, D[2], 'CHAIR#1') === v2Chair
    && view.restoredCells >= 1 && view.restoreFailed === '', JSON.stringify([sc.getCell(2, D[2], 'CHAIR#1'), view]));

  const ui = loadUiScripts(['Script.html']);
  const box = ui.baseSheetRestoreWarning({ baseVersionNo: 2, baseSheetRestoreFailed: '受保護，寫不到' });
  check('★★★★★★ 完成窗黃框：「第 2 版的工作表未能還原，查看時系統會再試」',
    box && box.className === 'warnbox' && /第 2 版的工作表未能還原，查看時系統會再試/.test(box.textContent), box && box.textContent);
  check('★★★★ 冇失敗 ⇒ 唔出黃框', ui.baseSheetRestoreWarning({ baseVersionNo: 2, baseSheetRestoreFailed: '' }) === null);
  const z1 = read('src/ui/ScriptZone1.html');
  const sg = read('src/ui/ScriptSuggestion.html');
  check('★★★★★ 〔儲存〕同〔接受這個建議版本〕兩個完成窗都用佢',
    /baseSheetRestoreWarning\(result\)/.test(z1) && /baseSheetRestoreWarning\(r\)/.test(sg));
  check('★★★★ 「第 K 版原封不動保留」嗰句保留', /版原封不動保留，可以隨時對照/.test(z1) && /版原封不動保留，可以隨時對照/.test(sg));
}

console.log('\n=== FB5【核心】畫面：〔查看這一版〕先準備、後開啟 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  let release = null;
  let reply = null;
  const calls = [];
  ui.callServerMutating = (name, q, no) => {
    calls.push({ name, q, no });
    return new Promise((resolve) => { release = () => resolve(reply); });
  };
  ui.callServer = async () => ({});
  const d = {
    latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/v1' },
    buttons: { save: { enabled: true } },
    versionChoices: [
      { versionNo: 1, label: '第 1 版', isLatest: true, sheetUrl: 'https://example.invalid/v1' },
      { versionNo: 0, label: '第 0 版', isLatest: false, sheetUrl: 'https://example.invalid/v0' }
    ]
  };
  const card = ui.renderStep2(d, {});
  const sel = card.flatten().filter((n) => n.tagName === 'SELECT')[0];
  sel.value = '0';
  sel.fire('change');
  const view = card.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '查看這一版')[0];
  const anchors = card.flatten().filter((n) => n.tagName === 'A' && n.textContent === '查看這一版');
  check('★★★★★★ 〔查看這一版〕係一粒掣，唔係直接開網址嘅連結', !!view && anchors.length === 0);
  const body = () => ui.document.getElementById('modalBody');
  const openLink = () => body().flatten().filter((n) => n.tagName === 'A' && n.textContent === '開啟第 0 版')[0];

  reply = { url: 'https://example.invalid/v0-preview', sheetName: 'Roster_2099T1_v0', restoredCells: 3, restoreFailed: '' };
  const bodyBefore = body().textContent;
  view.fire('click');
  await tick();
  check('★★★★★ 撳落去叫後端準備（還原＋唯讀）', calls.length === 1 && calls[0].name === 'apiOpenVersionForViewing' && calls[0].no === 0,
    JSON.stringify(calls));
  check('★★★★★★ 後端未完成 ⇒ 未出〔開啟第 0 版〕（唔可以射後不理）', !openLink() && body().textContent === bodyBefore, body().textContent);
  release();
  await tick();
  check('★★★★★★ 完成之後小窗「第 0 版已經準備好（只可以看）」', /第 0 版已經準備好（只可以看）/.test(body().textContent), body().textContent);
  check('★★★★★★ 〔開啟第 0 版〕用後端回嘅唯讀網址、新分頁', openLink() && openLink().href === 'https://example.invalid/v0-preview'
    && openLink().target === '_blank', openLink() && openLink().href);
  check('★★★★★ 還原成功 ⇒ 冇黃框', !body().flatten().some((n) => n.className === 'warnbox'));

  reply = { url: 'https://example.invalid/v0-preview', sheetName: 'Roster_2099T1_v0', restoredCells: 0, restoreFailed: '找不到工作表' };
  view.fire('click');
  await tick();
  release();
  await tick();
  const warn = body().flatten().filter((n) => n.className === 'warnbox')[0];
  check('★★★★★★ 還原失敗 ⇒ 小窗黃框講明（原因、可能不是第 0 版）', warn
    && /這一張表未能還原成第 0 版的內容（找不到工作表），畫面上看到的可能不是第 0 版/.test(warn.textContent),
    warn ? warn.textContent : body().textContent);
  check('★★★★ 仍然有〔開啟第 0 版〕', !!openLink());

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
