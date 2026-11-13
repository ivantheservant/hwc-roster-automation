// 第一百零五輪批次 RH 組：PersonID 統一為 P＋四位數字。
// 執行方式：node tests/round105_rh_person_id.test.js
//
// 新人編號變成 P90、P91（舊的是 P0089 四位數字）。
//   RH1 新編號：allocatePersonId_() ⇒ P＋四位數字；新舊兩種寫法都當已用
//   RH2 一次性修正（〔補建設定及範本〕）：名單及所有欄名含 PersonID 的欄一併改（逗號清單逐個換）；
//       歷史紀錄（RosterAssignments 等）用過的 ID 整個不改並列出原因；新 ID 已被用 ⇒ 不改
//   RH3 每格寫 AuditLog；再執行一次沒有東西要改
//   RH4 〔補建設定及範本〕的計劃及執行都包括這一項；畫面列出
// 用假資料（P97xx、P9x、假名）。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

console.log('\n=== RH1：新編號 ===');
{
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PersonIdFormat.gs', 'WebAppPeople.gs']);
  check('★★★★★★ 接着 P0089 ⇒ P0090', g.allocatePersonId_({ P0089: true }) === 'P0090');
  check('★★★★★★ 已有 P90、P91（短寫法）⇒ P0092', g.allocatePersonId_({ P0089: true, P90: true, P91: true }) === 'P0092');
  check('★★★★★ 已有 P0090（新寫法）⇒ 跳過', g.allocatePersonId_({ P0089: true, P0090: true }) === 'P0091');
  check('★★★★ 五位數字照寫', g.formatPersonIdNumber_(12345) === 'P12345' && g.formatPersonIdNumber_(7) === 'P0007');
  check('★★★★ 逗號清單逐個換', g.replacePersonIdInCell_('P0001, P90', 'P90', 'P0090') === 'P0001, P0090'
    && g.replacePersonIdInCell_('P900', 'P90', 'P0090') === 'P900' && g.replacePersonIdInCell_(' P90 ', 'P90', 'P0090') === 'P0090');
}

function appendByHeader(sc, sheetName, obj) {
  const sh = sc.ss.getSheetByName(sheetName);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, keys.length).setValues([keys.map((k) => (obj[k] === undefined ? '' : obj[k]))]);
}
function colValues(sc, sheetName, key) {
  const sh = sc.ss.getSheetByName(sheetName);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const c = keys.indexOf(key);
  if (sh.getLastRow() < 3) return [];
  return sh.getRange(3, 1, sh.getLastRow() - 2, keys.length).getValues().map((row) => row[c]);
}

console.log('\n=== RH2／RH3：一次性修正 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['PersonIdFormat.gs'] });
  const g = sc.gas;
  const M = sc.C.NAME_MAPPING;
  const E = sc.C.ELIGIBILITY;
  const A = sc.A;
  appendByHeader(sc, sc.S.NAME_MAPPING, { [M.PERSON_ID]: 'P90', [M.NAME_TC]: '假新甲', [M.ACTIVE]: true });
  appendByHeader(sc, sc.S.NAME_MAPPING, { [M.PERSON_ID]: 'P91', [M.NAME_TC]: '假新乙', [M.ACTIVE]: true });
  appendByHeader(sc, sc.S.ELIGIBILITY, { [E.ELIGIBILITY_ID]: 'EX1', [E.POST_ID]: 'READ', [E.PERSON_ID]: 'P90', [E.ELIGIBLE]: true, [E.ACTIVE]: true });
  appendByHeader(sc, sc.S.ELIGIBILITY, { [E.ELIGIBILITY_ID]: 'EX2', [E.POST_ID]: 'READ', [E.PERSON_ID]: 'P91', [E.ELIGIBLE]: true, [E.ACTIVE]: true });
  // 一張有逗號清單的工作表（例如將來的 PostTeams）
  const t = sc.ss.insertSheet('TeamsX');
  t.getRange(1, 1, 1, 2).setValues([['組', '成員']]);
  t.getRange(2, 1, 1, 2).setValues([['TeamID', 'MemberPersonIDs']]);
  t.getRange(3, 1, 1, 2).setValues([['T1', 'P9701,P90']]);
  // P91 已經在職事表版本（歷史紀錄）出現
  appendByHeader(sc, sc.S.ROSTER_ASSIGNMENTS, { [A.QUARTER_ID]: '2099T9', [A.VERSION_NO]: 0, [A.POST_ID]: 'READ', [A.PERSON_ID]: 'P91' });

  const plan = g.planPersonIdNormalize_();
  const r90 = plan.renames.filter((r) => r.fromId === 'P90')[0];
  check('★★★★★★ P90 ⇒ P0090：名單、Eligibility、逗號清單都在計劃內', r90 && r90.toId === 'P0090'
    && ['NameMapping', 'Eligibility', 'TeamsX'].every((s) => r90.cells.some((c) => c.sheet === s)), JSON.stringify(plan));
  const s91 = plan.skipped.filter((s) => s.fromId === 'P91')[0];
  check('★★★★★★ P91 已在職事表版本出現 ⇒ 不改，寫明原因', s91 && /歷史紀錄/.test(s91.reason) && /RosterAssignments/.test(s91.reason)
    && !plan.renames.some((r) => r.fromId === 'P91'), JSON.stringify(plan.skipped));
  const n = g.applyPersonIdNormalize_(plan);
  check('★★★★★★ 執行：改了 3 格', n === 3, String(n));
  check('★★★★★★ NameMapping、Eligibility 已改', colValues(sc, sc.S.NAME_MAPPING, M.PERSON_ID).indexOf('P0090') !== -1
    && colValues(sc, sc.S.NAME_MAPPING, M.PERSON_ID).indexOf('P90') === -1
    && colValues(sc, sc.S.ELIGIBILITY, E.PERSON_ID).indexOf('P0090') !== -1);
  check('★★★★★ 逗號清單只換那一個', t.getRange(3, 2).getValue() === 'P9701,P0090', t.getRange(3, 2).getValue());
  check('★★★★★★ 歷史紀錄沒有改', colValues(sc, sc.S.ROSTER_ASSIGNMENTS, A.PERSON_ID).indexOf('P91') !== -1);
  const audits = g.readSheet_(sc.S.AUDIT_LOG).filter((x) => x[sc.C.AUDIT_LOG.ACTION] === 'PERSON_ID_NORMALIZED');
  check('★★★★★ 每格一行 AuditLog', audits.length === 3, String(audits.length));
  const again = g.planPersonIdNormalize_();
  check('★★★★★★ 再執行：P90 沒有東西要改（P91 照舊列為不改）', again.renames.length === 0 && again.skipped.length === 1, JSON.stringify(again));
}

console.log('\n=== RH4：〔補建設定及範本〕 ===');
{
  const a = read('src/AdminTools.gs');
  check('★★★★★ 計劃列出要改、不改的 PersonID', /personIdRenames: pid\.renames\.map/.test(a) && /personIdSkipped: pid\.skipped\.map/.test(a));
  check('★★★★★★ 執行時一併修正', /const npid = pid\.renames\.length \? applyPersonIdNormalize_\(pid\) : 0;/.test(a));
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★ 畫面列出，並算入「有東西要補建」', /PersonID 統一為四位數字/.test(z5) && /outOrder\.length \+ pidRenames\.length;/.test(z5));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
