// 第七十五輪批次 CE／CF／CG 組：逐格決定（臨時幫手、保留我的安排）＋〔儲存〕確認簡化。
// 執行方式：node tests/round75_cefg_decisions_save.test.js
//
// Ivan 手動測試 A 嘅例子：主席填咗「ivan」（唔喺名單）；讀經連續兩週；領詩填咗唔喺領詩名單嘅人。
//
//   CE1　名單上搵唔到嘅名：〔檢查我的改動〕列出、預設未勾；勾「這一季臨時幫手」即時記住
//   CE2　〔請系統幫我調整〕唔會因為未決定嘅名而整個拒絕；嗰格唔郁並列出
//   CE3　臨時幫手：只存名字（冇 PersonID）、唔算空格、整季記住；換咗名就失效
//   CF1　違反規則嘅格逐格有「保留我的安排」（預設未勾）；一定要遵守嘅標明 mustFollow
//   CF2　勾咗即時記住（重新讀仲喺度）；換咗人就失效
//   CF3　〔請系統幫我調整〕只調整冇勾嘅格；勾咗嘅唔郁
//   CG1　儲存計劃：唔再即時擋認唔出嘅名；打字放行拿走（needsRelease=false）；
//        未決定嘅一定要遵守違反／名 ⇒ needsDecision，execute 拋錯、一格都唔寫
//   CG2　全部決定咗 ⇒ 儲存成功；勾咗嘅一定要遵守違反轉成放行紀錄（整季記住，下一次唔使再確認）
//   CG3　「盡量避免」冇勾 ⇒ 只一句提示，唔擋

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
const gas = sc.gas;
const A = sc.A;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);

const read1 = sc.getCell(0, D[0], 'READ#1');
// R4 嘅材料
sc.setCell(0, D[0], 'PREACH#1', 'Rev Wong');            // 外請講員（人手崗位，唔喺名單）
sc.setCell(0, D[2], 'CHAIR#1', 'ivan');                 // 臨時幫手（系統排嘅崗位，唔喺名單）
sc.setCell(0, D[1], 'READ#1', read1);                   // 製造「連續兩週」（盡量避免）
sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));   // 唔喺領詩名單（一定要遵守）

const KEY_IVAN = D[2] + '|CHAIR|1';
const KEY_WORSHIP = D[3] + '|WORSHIP|1';
const KEY_READ = D[1] + '|READ|1';

console.log('\n=== CE1／CF1：檢查我的改動 ===');
let chk = gas.apiCheckMyChanges(sc.Q);
{
  check('★★★★★ 你改了這 4 格', chk.changes.length === 4, JSON.stringify(chk.changes));
  const ivan = chk.unresolved.filter((u) => u.key === KEY_IVAN)[0];
  check('★★★★★★ 名單上找不到：只有 ivan（Rev Wong 係人手崗位，唔算問題）',
    chk.unresolved.length === 1 && ivan && ivan.text === 'ivan' && ivan.checked === false, JSON.stringify(chk.unresolved));
  const worship = chk.violations.filter((v) => v.key === KEY_WORSHIP)[0];
  const readV = chk.violations.filter((v) => v.key === KEY_READ)[0];
  check('★★★★★★ 領詩：一定要遵守（mustFollow），未勾', worship && worship.mustFollow === true && worship.checked === false, JSON.stringify(chk.violations));
  check('★★★★★★ 讀經連續兩週：盡量避免（mustFollow=false），未勾', readV && readV.mustFollow === false && readV.checked === false, JSON.stringify(chk.violations));
  check('★★★★★ Rev Wong 嗰格冇被列為問題', !chk.violations.some((v) => v.postId === 'PREACH') && !chk.unresolved.some((u) => u.postId === 'PREACH'));
  check('★★★★ 未全部處理好', chk.allClear === false);
  check('★★★★★ ivan 嗰格唔算「還沒有人」', !chk.blanks.some((b) => b.serviceDate === D[2] && b.postNameTC === '主席'), JSON.stringify(chk.blanks));
}

console.log('\n=== CE2／CF3：未決定都照樣調整（唔整個拒絕）===');
{
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('★★★★★★ 唔會因為 ivan 而整個拒絕', sug.ok === true && !sug.blocked, JSON.stringify(sug).slice(0, 300));
  check('★★★★★ 未決定嘅名列出（ivan）', (sug.undecidedNames || []).some((u) => u.key === KEY_IVAN), JSON.stringify(sug.undecidedNames));
  const sugSheet = sc.ss.getSheetByName('Roster_' + sc.Q + '_v0_建議');
  const sugCell = (dateStr, key) => {
    const keys = sugSheet.getRange(2, 1, 1, sugSheet.getLastColumn()).getValues()[0];
    let r0 = -1;
    for (let r = 1; r <= sugSheet.getLastRow(); r++) {
      if (gas.toDateString(sugSheet.getRange(r, 1).getValue(), sc.TZ) === dateStr) { r0 = r; break; }
    }
    // 建議表頂有圖例；用第 1 欄日期定位，機器鍵行自己搵
    let keyRow = 2;
    for (let r = 1; r <= 12; r++) {
      const row = sugSheet.getRange(r, 1, 1, sugSheet.getLastColumn()).getValues()[0];
      if (row.indexOf(key) !== -1) { keyRow = r; break; }
    }
    const k2 = sugSheet.getRange(keyRow, 1, 1, sugSheet.getLastColumn()).getValues()[0];
    return String(sugSheet.getRange(r0, k2.indexOf(key) + 1).getValue());
  };
  check('★★★★★★ 建議表：ivan 嗰格照寫「ivan」（冇郁、冇蒸發）', sugCell(D[2], 'CHAIR#1') === 'ivan', sugCell(D[2], 'CHAIR#1'));
  check('★★★★★ 冇勾保留嘅領詩（一定要遵守）系統會試住調整（唔再係「親手改過一律唔動」）',
    sugCell(D[3], 'WORSHIP#1') !== sc.nameOf('P9704'), sugCell(D[3], 'WORSHIP#1'));
  gas.apiDiscardSuggestion(sc.Q);
}

console.log('\n=== CG1：未決定 ⇒ 未可以儲存 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 唔再即時擋認唔出嘅名（blocked=false）', plan.blocked === false, plan.blockReason);
  check('★★★★★★ 打字放行拿走（needsRelease=false）', plan.needsRelease === false);
  check('★★★★★★ needsDecision：1 個名＋1 格一定要遵守',
    plan.needsDecision === true && plan.decisionItems.names.length === 1 && plan.decisionItems.rules.length === 1,
    JSON.stringify(plan.decisionItems).slice(0, 400));
  check('★★★★★ 「盡量避免」唔喺要決定嘅清單（只係提示）', !plan.decisionItems.rules.some((r) => r.mustFollow === false)
    && plan.violations.semiHard.some((v) => v.serviceDate === D[1] && v.postId === 'READ'));
  let threw = null;
  try { gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] }); } catch (e) { threw = e; }
  check('★★★★★★ execute 拋錯、冇建立版本', threw && gas.findLatestVersionNo(sc.Q) === 0, threw && threw.message);
}

console.log('\n=== CE1／CF2：勾選即時記住 ===');
{
  const r = gas.apiSetCellDecisions(sc.Q, [
    { serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true },
    { serviceDate: D[3], postId: 'WORSHIP', slotIndex: 1, kind: 'KEEP', cellText: sc.nameOf('P9704'), ruleId: 'HARD_ELIGIBILITY', checked: true }
  ]);
  check('（前置）記住兩項', r.ok && r.written === 2, JSON.stringify(r));
  chk = gas.apiCheckMyChanges(sc.Q);
  check('★★★★★★ 重新讀：ivan 已勾臨時幫手', chk.unresolved.filter((u) => u.key === KEY_IVAN)[0].checked === true);
  check('★★★★★★ 重新讀：領詩已勾保留', chk.violations.filter((v) => v.key === KEY_WORSHIP)[0].checked === true);
  check('★★★★ 讀經冇勾（預設唔勾）', chk.violations.filter((v) => v.key === KEY_READ)[0].checked === false);
  const audit = gas.readSheet(sc.S.AUDIT_LOG).filter((x) => x[sc.C.AUDIT_LOG.ACTION] === 'CELL_DECISIONS_SET');
  check('★★★★ AuditLog 記一行', audit.length === 1);

  // 取消再勾返：CANCELLED ⇒ 唔算
  gas.apiSetCellDecisions(sc.Q, [{ serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: false }]);
  check('★★★★★ 取消勾選 ⇒ 未決定', gas.apiCheckMyChanges(sc.Q).unresolved[0].checked === false);
  gas.apiSetCellDecisions(sc.Q, [{ serviceDate: D[2], postId: 'CHAIR', slotIndex: 1, kind: 'TEMP_HELPER', cellText: 'ivan', checked: true }]);
}

console.log('\n=== CF3：勾咗嘅唔郁 ===');
{
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（前置）建議表有做', sug.ok === true, JSON.stringify(sug).slice(0, 200));
  const kept = (sug.untouchedManual || []).filter((u) => u.key === KEY_WORSHIP)[0];
  check('★★★★★★ 勾咗保留嘅領詩冇郁（列喺系統沒有動）', kept && kept.kept === true, JSON.stringify(sug.untouchedManual));
  check('★★★★★ 已決定嘅名唔再列做「未決定」', (sug.undecidedNames || []).length === 0);
  gas.apiDiscardSuggestion(sc.Q);
}

console.log('\n=== CG2：全部決定咗 ⇒ 儲存 ===');
{
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ needsDecision=false', plan.needsDecision === false, JSON.stringify(plan.decisionItems));
  check('★★★★★ 已確認保留 2 格（只講數目）', plan.keptCount === 2, String(plan.keptCount));
  check('★★★★★ 盡量避免冇勾 ⇒ 仍然只係提示（semiHard 有讀經嗰格）',
    plan.violations.semiHard.some((v) => v.serviceDate === D[1] && v.postId === 'READ'));
  const res = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ 儲存成第 1 版', res.ok === true && res.versionNo === 1, JSON.stringify(res).slice(0, 300));
  const chair = sc.cellRow(1, D[2], 'CHAIR');
  check('★★★★★★ 臨時幫手：只存名字、冇 PersonID、MANUAL', !chair[A.PERSON_ID] && chair[A.PERSON_NAME_SNAPSHOT] === 'ivan' && chair[A.ASSIGN_SOURCE] === 'MANUAL', JSON.stringify(chair));
  check('★★★★★ 新一版職事表照顯示 ivan', sc.getCell(1, D[2], 'CHAIR#1') === 'ivan');
  const worship = sc.cellRow(1, D[3], 'WORSHIP');
  check('★★★★★ 領詩照你嘅安排（P9704）', worship[A.PERSON_ID] === 'P9704');
  const rel = gas.readSheet(sc.S.AUDIT_LOG).filter((x) => /RELEASED_KEYS:/.test(String(x[sc.C.AUDIT_LOG.NOTES] || '')));
  check('★★★★★★ 勾咗保留嘅一定要遵守違反 ⇒ 寫咗機器可讀放行紀錄', rel.length >= 1, JSON.stringify(rel.slice(-1)));
  check('★★★★ 結果講返放行咗幾多格', res.releasedViolationCount === 1);
  check('★★★★★ 儲存後再 plan：零改動', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
  const chk2 = gas.apiCheckMyChanges(sc.Q);
  const w2 = chk2.violations.filter((v) => v.key === KEY_WORSHIP)[0];
  check('★★★★★★ 之後再檢查：領詩顯示「已放行」，唔使再勾（整季記住）', w2 && w2.released === true, JSON.stringify(chk2.violations));
  check('★★★★★ ivan 已經儲存咗，唔再係「找不到的名字」', chk2.unresolved.length === 0, JSON.stringify(chk2.unresolved));
}

console.log('\n=== CE3／CF2：換咗名／人就失效 ===');
{
  sc.setCell(1, D[2], 'CHAIR#1', 'ivan2');
  const chk3 = gas.apiCheckMyChanges(sc.Q);
  const u = chk3.unresolved.filter((x) => x.key === KEY_IVAN)[0];
  check('★★★★★★ 換咗名（ivan2）⇒ 要重新決定（未勾）', u && u.text === 'ivan2' && u.checked === false, JSON.stringify(chk3.unresolved));
  sc.setCell(1, D[2], 'CHAIR#1', 'ivan');
  check('★★★★ 改返 ivan ⇒ 冇改動', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
}

console.log('\n=== 輸入驗證 ===');
{
  let threw = false;
  try { gas.apiSetCellDecisions(sc.Q, [{ serviceDate: 'bad', postId: 'CHAIR', slotIndex: 1, kind: 'KEEP', checked: true }]); } catch (e) { threw = true; }
  check('★★★★★ 唔完整嘅決定 ⇒ 拋錯（唔可以靜靜略過）', threw);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
