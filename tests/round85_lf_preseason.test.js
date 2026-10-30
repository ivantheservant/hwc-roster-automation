// 第八十五輪批次 LF 組：季前資料（自動寄出＋〔寄出季前資料〕）。
// 執行方式：node tests/round85_lf_preseason.test.js
//
//   LF1　日期判斷：生成日 − N 日 ≤ 今日 < 生成日；未寄過（自動或人手）；Stage DRAFT、沒有版本；開關；沒有生成日 ⇒ 不寄
//   LF2　內容六段：事奉人員表（「堂委」寫明現任）、暫時不做、排表偏好、不能服侍、合堂主日、人手檢查；結尾提醒
//   LF3　收件人：現任堂委、執事、幹事、額外收件人；同一地址只一封；沒有電郵的人列出
//   LF4　DRY_RUN ⇒ 模擬 N 封；只寫 AuditLog（不寫 SendLog、不改 Stage）；寄過之後自動不再寄
//   LF5　真正寄出：轉寄測試地址生效、主旨加測試前綴
//   LF6　畫面：〔寄出季前資料〕；「這一季還要做的」一行
// 下面用假資料（P97xx、example.invalid），不涉及真實姓名。

const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
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

console.log('\n=== LF1：日期判斷 ===');
{
  const sc = scene();
  const j = sc.gas.judgePreseasonAutoSend_;
  const base = { enabled: true, daysBefore: 14, generateDate: '2098-12-20', sent: null, stage: 'DRAFT', versionNo: -1 };
  check('★★★★★★ 生成日前 14 日當日 ⇒ 寄', j(Object.assign({}, base, { today: '2098-12-06' })).send === true);
  check('★★★★★ 前 15 日 ⇒ 未到', j(Object.assign({}, base, { today: '2098-12-05' })).reason === 'TOO_EARLY');
  check('★★★★★ 生成日前一日 ⇒ 寄；生成日當日 ⇒ 不寄', j(Object.assign({}, base, { today: '2098-12-19' })).send === true
    && j(Object.assign({}, base, { today: '2098-12-20' })).reason === 'TOO_LATE');
  check('★★★★★★ 已寄過（自動或人手）⇒ 不寄', j(Object.assign({}, base, { today: '2098-12-10', sent: { mode: 'MANUAL' } })).reason === 'ALREADY_SENT');
  check('★★★★★ 已有版本／不是 DRAFT ⇒ 不寄', j(Object.assign({}, base, { today: '2098-12-10', versionNo: 0 })).reason === 'HAS_VERSION'
    && j(Object.assign({}, base, { today: '2098-12-10', stage: 'OFFICIAL_SENT' })).reason === 'NOT_DRAFT');
  check('★★★★★ 開關關掉 ⇒ 不寄；沒有生成日 ⇒ 不寄', j(Object.assign({}, base, { today: '2098-12-10', enabled: false })).reason === 'DISABLED'
    && j(Object.assign({}, base, { today: '2098-12-10', generateDate: '' })).reason === 'NO_GENERATE_DATE');
  check('★★★★ Config：預設開、14 日、額外收件人空白', /PRESEASON_DAYS_BEFORE[\s\S]{0,200}defaultValue: '14'/.test(require('fs').readFileSync('src/ConfigSeed.gs', 'utf8'))
    && sc.gas.CONFIG_KEYS.PRESEASON_AUTO_SEND === 'PRESEASON_AUTO_SEND');
}

console.log('\n=== LF2：內容六段 ===');
{
  const sc = scene();
  const pack = sc.gas.buildPreseasonPack_(sc.Q, '2098-12-10', '2098-12-20');
  const t = (i) => pack.sections[i].lines.join('\n');
  check('★★★★★ 六段，次序照規格', pack.sections.map((s) => s.title).join('／') === '一、事奉人員表／二、暫時不做某崗位／三、排表偏好／四、不能服侍的日期／五、合堂主日／六、人手檢查',
    pack.sections.map((s) => s.title).join('／'));
  check('★★★★★★ ① 每個自動排的崗位一行；「堂委」寫明現任；人數', /^主席（6 人）：/.test(t(0)) && /領詩（4 人）：堂委（現任 2 位：假甲、假庚）、假丙、假乙、假甲/.test(t(0)), t(0));
  check('★★★★★ ② 暫時不做某崗位', /假丙　主席　原因：堂委會決定/.test(t(1)), t(1));
  check('★★★★★ ③ 排表偏好（多 1 次、原因、之後各季都用）', /假丁　讀經　多 1 次　原因：想多讀　之後各季都用/.test(t(2)), t(2));
  check('★★★★★★ ④ 不能服侍的日期：只列落在這一季的', /假戊　2099-01-18　原因：出外/.test(t(3)) && !/下季/.test(t(3)), t(3));
  check('★★★★★ ⑤ 合堂主日', /2099-01-11　浸禮/.test(t(4)), t(4));
  check('★★★★★ ⑥ 人手檢查（人手足夠）', t(5) === '人手足夠', t(5));
  const tpl = sc.gas.preseasonTemplateDefault_();
  check('★★★★★ 範本結尾「如需更改，請在 {GenerateDate} 之前通知幹事」；可以在 EmailTemplates 改（有種子）',
    /如需更改，請在 \{GenerateDate\} 之前通知幹事。/.test(tpl.bodyHtml) && tpl.templateId === 'TPL_PRESEASON_TC');
}

console.log('\n=== LF3：收件人 ===');
{
  const sc = scene();
  const who = sc.gas.buildPreseasonRecipients_('2098-12-10');
  const emails = who.recipients.map((r) => r.email.toLowerCase()).sort();
  check('★★★★★★ 堂委 P9701、執事 P9702、幹事、額外收件人；P9701 同一地址只一封',
    JSON.stringify(emails) === JSON.stringify(['clerk@example.invalid', 'extra@example.invalid', 'p9701@example.invalid', 'p9702@example.invalid']), JSON.stringify(emails));
  check('★★★★★ 沒有電郵的人列出（假庚）', JSON.stringify(who.noEmail) === '["假庚"]', JSON.stringify(who.noEmail));
}

console.log('\n=== LF4：DRY_RUN、只寫 AuditLog、只寄一次 ===');
{
  const sc = scene();
  const g = sc.gas; const S = sc.S; const C = sc.C;
  const sendLogBefore = g.readSheet_(S.SEND_LOG).length;
  const r = g.apiPreseasonSend(sc.Q);
  check('★★★★★★ 測試模式 ⇒ 模擬 4 封', r.dryRun === true && r.simulated === 4 && r.sent === 0, JSON.stringify(r));
  check('★★★★★★ 不寫 SendLog、不改 Stage', g.readSheet_(S.SEND_LOG).length === sendLogBefore && g.getQuarterStage_(sc.Q) === 'DRAFT');
  const rec = g.readPreseasonSentRecord_(sc.Q);
  check('★★★★★ AuditLog 記錄（人手、今日）', rec && rec.mode === 'MANUAL' && rec.date === '2098-12-10', JSON.stringify(rec));
  const qrow = g.readSheet_(S.QUARTERS)[0];
  const auto = g.runPreseasonAutoSend_(qrow, '2098-12-10', g.readConfig_());
  check('★★★★★★ 人手寄過 ⇒ 自動不再寄', auto.outcome === 'SKIP' && auto.detail === 'ALREADY_SENT', JSON.stringify(auto));
  // 第八十六輪批次 MA 組（刻意改動）：測試模式只留下模擬紀錄 ⇒ 寫「模擬寄出」，不算已寄出
  check('★★★★★ 「這一季還要做的」：模擬寄出（2098-12-10，人手）；正式使用時建議 2098-12-06 寄出',
    g.readPreseasonStatusText_(sc.Q) === '季前資料：模擬寄出（2098-12-10，人手）；正式使用時建議 2098-12-06 寄出', g.readPreseasonStatusText_(sc.Q));
  const sc2 = scene();
  check('★★★★★ 未寄：建議 2098-12-06 寄出', sc2.gas.readPreseasonStatusText_(sc2.Q) === '季前資料：建議 2098-12-06 寄出（未寄）');
  const auto2 = sc2.gas.runPreseasonAutoSend_(sc2.gas.readSheet_(sc2.S.QUARTERS)[0], '2098-12-10', sc2.gas.readConfig_());
  check('★★★★★★ 時間到、未寄過 ⇒ 自動寄（模擬）並記錄自動', auto2.outcome === 'SENT' && sc2.gas.readPreseasonSentRecord_(sc2.Q).mode === 'AUTO', JSON.stringify(auto2));
}

console.log('\n=== LF5：真正寄出（轉寄、主旨前綴）===');
{
  const sc = scene({ DRY_RUN: ['FALSE', 'BOOL'], MAIL_REDIRECT_ALL_TO: ['tester@example.invalid', 'STR'], MAIL_SUBJECT_PREFIX: ['[測試] ', 'STR'] });
  const sent = [];
  sc.gas.MailApp = { sendEmail: function (to, subject) { sent.push({ to: to, subject: subject }); } };
  sc.gas.assertNotPreviewMode_ = function () {};
  const r = sc.gas.sendPreseasonPack_(sc.Q, 'MANUAL');
  check('★★★★★ 寄出 4 封', r.dryRun === false && r.sent === 4, JSON.stringify(r));
  check('★★★★★★ 轉寄測試地址生效（全部寄去測試地址）', sent.length === 4 && sent.every((m) => m.to === 'tester@example.invalid'), JSON.stringify(sent));
  check('★★★★★ 主旨有測試前綴和季度名稱', sent.every((m) => m.subject.indexOf('[測試]') !== -1 && /季前資料/.test(m.subject)), JSON.stringify(sent[0]));
}

console.log('\n=== LF6：畫面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T3';", ui);
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: [] }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] },
    preseasonStatus: '季前資料：已寄出（2099-06-01，人手）' });
  const body = ui.document.getElementById('zone2Body');
  check('★★★★★ 開季前準備有〔寄出季前資料〕', body.flatten().some((n) => n.tagName === 'BUTTON' && n.textContent === '寄出季前資料'));
  check('★★★★★ 「這一季還要做的」寫「季前資料：已寄出（2099-06-01，人手）」', /季前資料：已寄出（2099-06-01，人手）/.test(body.textContent));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
