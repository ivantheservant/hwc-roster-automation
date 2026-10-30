// 第八十六輪批次 MA 組：季前資料——模擬寄出不可以當成已經寄出。
// 執行方式：node tests/round86_ma_preseason_sim.test.js
//
//   MA1　紀錄分「真正寄出」和「模擬」；舊紀錄沒有第三段時按備註判斷（再沒有 ⇒ 當作真正寄出）
//   MA2　自動寄出：真正模式只認真正寄出；測試模式任何紀錄都算
//   MA3　「這一季還要做的」：模擬寄出（日期，人手／自動）；正式使用時建議 <日期> 寄出；真正寄出照舊
//   MA4　預覽窗寫明之前是模擬還是真正寄出
// 下面用假資料（P97xx、example.invalid），不涉及真實姓名。

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
const fs = require('fs');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

function scene(config) {
  const sc = buildRound75Scene({ extraFiles: ['WebAppCombined.gs', 'PreseasonPack.gs', 'EmailTemplateSeed.gs', 'WebAppPeople.gs'],
    config: Object.assign({ MAIL_ADMIN_NOTIFY: ['clerk@example.invalid', 'STR'],
      PRESEASON_EXTRA_RECIPIENTS: ['extra@example.invalid、p9701@example.invalid', 'STR'] }, config || {}) });
  const g = sc.gas; const C = sc.C; const S = sc.S; const D = sc.DATES;
  const R = C.ROLES;
  seedSheet(sc.ss, S.ROLES, ['R'], Object.keys(R).map((k) => R[k]), [
    { [R.PERSON_ID]: 'P9701', [R.ROLE_CODE]: 'COMMITTEE', [R.EFFECTIVE_FROM]: '2098-01-01', [R.ACTIVE]: true },
    { [R.PERSON_ID]: 'P9707', [R.ROLE_CODE]: 'COMMITTEE', [R.EFFECTIVE_FROM]: '2098-01-01', [R.ACTIVE]: true },
    { [R.PERSON_ID]: 'P9702', [R.ROLE_CODE]: 'DEACON', [R.EFFECTIVE_FROM]: '2098-01-01', [R.ACTIVE]: true }]);
  const E = C.ELIGIBILITY;
  sc.appendRows(sc.ss, S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
    [{ [E.ELIGIBILITY_ID]: 'ER', [E.PERSON_ID]: 'ROLE:COMMITTEE', [E.POST_ID]: 'WORSHIP', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
  const X = C.PERSON_POST_EXCLUSIONS;
  seedSheet(sc.ss, S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]),
    [{ [X.PERSON_ID]: 'P9703', [X.POST_ID]: 'CHAIR', [X.REASON]: '堂委會決定', [X.ACTIVE]: true }]);
  const W = C.PERSON_POST_WEIGHT;
  seedSheet(sc.ss, S.PERSON_POST_WEIGHT, ['W'], Object.keys(W).map((k) => W[k]),
    [{ [W.WEIGHT_ID]: 'W1', [W.PERSON_ID]: 'P9704', [W.POST_ID]: 'READ', [W.ADJUST]: 1, [W.REASON]: '想多讀',
      [W.EFFECTIVE_FROM]: '2098-01-01', [W.ACTIVE]: true }]);
  const U = C.UNAVAILABLE;
  sc.appendRows(sc.ss, S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [
    { [U.UNAVAILABLE_ID]: 'U1', [U.PERSON_ID]: 'P9705', [U.DATE_FROM]: D[2], [U.DATE_TO]: D[2], [U.APPLIES_TO]: 'ALL',
      [U.REASON]: '出外', [U.SOURCE]: 'MANUAL', [U.STATUS]: 'ACTIVE' },
    { [U.UNAVAILABLE_ID]: 'U2', [U.PERSON_ID]: 'P9705', [U.DATE_FROM]: '2099-06-01', [U.DATE_TO]: '2099-06-01', [U.APPLIES_TO]: 'ALL',
      [U.REASON]: '下季', [U.SOURCE]: 'MANUAL', [U.STATUS]: 'ACTIVE' }]);
  g.apiSaveCombinedServices(sc.Q, [{ serviceDate: D[1], kind: 'BAPTISM', name: '' }]);
  // 「今日」固定為 2098-12-10（只替換 new Date() 那一次；其餘日期照常格式化）
  const origFormat = g.Utilities.formatDate;
  g.Utilities.formatDate = function (d, tz, f) {
    return Math.abs(d.getTime() - Date.now()) < 600000 ? '2098-12-10' : origFormat(d, tz, f);
  };
  g.computeAutomationSchedule_ = function () { return { generateDate: '2098-12-20', officialDate: '' }; };
  return sc;
}

function audit(g, sc, newValue, notes) {
  g.writeAuditLog_({ action: 'PRESEASON_SENT', targetSheet: sc.S.QUARTERS, targetKey: sc.Q, newValue: newValue, notes: notes || '' });
}

console.log('\n=== MA1：紀錄分真正寄出／模擬 ===');
{
  const sc = scene(); const g = sc.gas;
  check('★★★★★ 沒有紀錄 ⇒ null', g.readPreseasonSentRecord_(sc.Q) === null);
  audit(g, sc, 'MANUAL|2098-12-08|DRY_RUN', '模擬 4 封');
  let r = g.readPreseasonSentRecord_(sc.Q);
  check('★★★★★★ 只有 DRY_RUN ⇒ simulated，沒有 real', r && r.simulated === true && r.real === null && r.date === '2098-12-08' && r.mode === 'MANUAL', JSON.stringify(r));
  audit(g, sc, 'AUTO|2098-12-09|SENT', '寄出 4 封');
  r = g.readPreseasonSentRecord_(sc.Q);
  check('★★★★★★ 之後有 SENT ⇒ real 是 SENT 那筆', r && r.real && r.real.date === '2098-12-09' && r.real.mode === 'AUTO', JSON.stringify(r));
  audit(g, sc, 'MANUAL|2098-12-10|DRY_RUN', '模擬 4 封');
  r = g.readPreseasonSentRecord_(sc.Q);
  check('★★★★★ 最後一筆是模擬 ⇒ 最新＝模擬，但 real 仍是 12-09', r.simulated === true && r.date === '2098-12-10' && r.real.date === '2098-12-09', JSON.stringify(r));
  const f = g.isPreseasonRecordSimulated_;
  check('★★★★★ 舊紀錄沒有第三段：備註「模擬」⇒ 模擬；「寄出」或空白 ⇒ 真正寄出',
    f('', '模擬 4 封') === true && f(undefined, '寄出 4 封') === false && f('', '') === false);
}

console.log('\n=== MA2：自動寄出判斷 ===');
{
  const sc = scene(); const j = sc.gas.judgePreseasonAutoSend_;
  const base = { enabled: true, daysBefore: 14, generateDate: '2098-12-20', today: '2098-12-10', stage: 'DRAFT', versionNo: -1 };
  const simOnly = { date: '2098-12-08', mode: 'MANUAL', simulated: true, real: null };
  const realRec = { date: '2098-12-08', mode: 'MANUAL', simulated: false, real: { date: '2098-12-08', mode: 'MANUAL' } };
  check('★★★★★★ 真正模式＋只有模擬紀錄 ⇒ 會寄', j(Object.assign({}, base, { dryRun: false, sent: simOnly })).send === true);
  check('★★★★★★ 測試模式＋模擬紀錄 ⇒ 不再寄', j(Object.assign({}, base, { dryRun: true, sent: simOnly })).reason === 'ALREADY_SENT');
  check('★★★★★★ 真正紀錄 ⇒ 兩種模式都不寄', j(Object.assign({}, base, { dryRun: false, sent: realRec })).reason === 'ALREADY_SENT'
    && j(Object.assign({}, base, { dryRun: true, sent: realRec })).reason === 'ALREADY_SENT');
  check('★★★★★ 沒有紀錄 ⇒ 兩種模式都寄', j(Object.assign({}, base, { dryRun: false, sent: null })).send === true
    && j(Object.assign({}, base, { dryRun: true, sent: null })).send === true);
  // 整條路：runPreseasonAutoSend_ 讀 Config DRY_RUN
  const real = scene({ DRY_RUN: ['FALSE', 'BOOL'] });
  real.gas.MailApp = { sendEmail: function () {} };
  real.gas.assertNotPreviewMode_ = function () {};
  audit(real.gas, real, 'MANUAL|2098-12-08|DRY_RUN', '模擬 4 封');
  const out = real.gas.runPreseasonAutoSend_(real.gas.readSheet_(real.S.QUARTERS)[0], '2098-12-10', real.gas.readConfig_());
  check('★★★★★★ 整條路：真正模式、只有模擬紀錄 ⇒ 自動寄出', out.outcome === 'SENT' && /寄出 4 封/.test(out.detail), JSON.stringify(out));
  const test = scene();
  audit(test.gas, test, 'MANUAL|2098-12-08|DRY_RUN', '模擬 4 封');
  const out2 = test.gas.runPreseasonAutoSend_(test.gas.readSheet_(test.S.QUARTERS)[0], '2098-12-10', test.gas.readConfig_());
  check('★★★★★★ 整條路：測試模式、有模擬紀錄 ⇒ 略過', out2.outcome === 'SKIP' && out2.detail === 'ALREADY_SENT', JSON.stringify(out2));
}

console.log('\n=== MA3：狀態句 ===');
{
  const sc = scene(); const g = sc.gas;
  check('★★★★★ 未寄：建議 2098-12-06 寄出（未寄）', g.readPreseasonStatusText_(sc.Q) === '季前資料：建議 2098-12-06 寄出（未寄）');
  audit(g, sc, 'MANUAL|2098-12-08|DRY_RUN', '模擬 4 封');
  check('★★★★★★ 只有模擬 ⇒ 模擬寄出（日期，人手）；正式使用時建議 2098-12-06 寄出',
    g.readPreseasonStatusText_(sc.Q) === '季前資料：模擬寄出（2098-12-08，人手）；正式使用時建議 2098-12-06 寄出', g.readPreseasonStatusText_(sc.Q));
  audit(g, sc, 'AUTO|2098-12-09|SENT', '寄出 4 封');
  check('★★★★★★ 有真正寄出 ⇒ 已寄出（日期，自動）', g.readPreseasonStatusText_(sc.Q) === '季前資料：已寄出（2098-12-09，自動）', g.readPreseasonStatusText_(sc.Q));
  const d = g.describePreseasonStatus_({ date: '2098-12-08', mode: 'AUTO', simulated: true, real: null }, '', 14);
  check('★★★★ 模擬寄出而沒有生成日 ⇒ 不會自動寄出', d === '季前資料：模擬寄出（2098-12-08，自動）；這一季沒有生成日期，不會自動寄出', d);
}

console.log('\n=== MA4：預覽窗 ===');
{
  const sc = scene(); const g = sc.gas;
  audit(g, sc, 'MANUAL|2098-12-08|DRY_RUN', '模擬 4 封');
  const p = g.apiPreseasonPreview(sc.Q);
  check('★★★★★ 預覽回傳 sentRecord：simulated、real＝null', p.sentRecord && p.sentRecord.real === null && p.sentRecord.simulated === true, JSON.stringify(p.sentRecord));
  const z2 = fs.readFileSync('src/ui/ScriptZone2.html', 'utf8');
  check('★★★★★★ 預覽窗：只有模擬 ⇒ 「只有模擬寄出…模擬不算已寄出」；有真正 ⇒ 「真正寄出過一次」',
    /只有模擬寄出/.test(z2) && /模擬不算已寄出/.test(z2) && /真正寄出過一次/.test(z2));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
