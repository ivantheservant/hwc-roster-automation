// 第九十輪批次 QC 組：義工在個人專屬連結申報不能服侍。
// 執行方式：node tests/round90_qc_personal_unavailable.test.js
//
// Ivan 2026-10-30 決定：義工在自己的個人專屬連結勾選不能服侍的主日，幹事確認後才生效（取代共用試算表）。
//
//   QC1 token：錯、格式不對、停用 ⇒ 中性錯誤，甚麼都沒有寫；AuditLog 不寫 token
//   QC2 提交：只寫自己的行；日期範圍（未完結的最近 N 季）；過去的日子；每次最多 20 個；每人每日最多 10 次；
//       原因去掉 HTML、最多 100 字；已申報的日子不重複；截止日之後標「截止日之後」；不直接寫 Unavailable
//   QC3 撤回：只可以撤回自己的、等候確認的；已確認的寫「如需取消，請聯絡幹事」
//   QC4 幹事：〔接受〕建立 Unavailable（Source=PERSONAL_LINK、原因照填）並記 UnavailableID；〔不接受〕；〔全部接受〕；
//       已生成的季度之後走「之後才申報不能服侍」那一套
//   QC5 個人頁：這一季還沒有職事表 ⇒ token 正確照樣打開（「這一季的職事表還未發出」＋申報一段）；token 錯 ⇒ 中性頁；
//       頁面嵌入的資料只有這個人自己的、而且 < > & 已轉義
//   QC6 每日檢查通知幹事：有新的才寄、同一日最多一封、DRY_RUN、Config 可關
//   QC7 〔寄出申報邀請〕：收件人（自動排的崗位、領詩／司琴、詩班、展開身分；沒有電郵的人列出）；DRY_RUN；
//       模擬和真正寄出分開記；每人自己的連結；AuditLog 不寫連結
//   QC8 主畫面「義工申報待確認：N 項」、季前資料第四段一句、畫面（只可查看 ⇒ 按鈕灰色）、Config
// 下面用假 ID（P97xx）、假名、假 token。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const tok = (n) => (n.toString(16).padStart(2, '0')).repeat(16);   // 假 token（32 個十六進位字元）
const T1 = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];
const T2 = ['2099-04-05', '2099-04-12'];
const T3 = ['2099-07-05'];

/**
 * 場景：2099T1（四個主日）＋ 2099T2（兩個）＋ 2099T3（一個）；今日固定（預設 2098-12-10）；
 * NameMapping 有 PersonalLinkToken（P9701–P9707 各自一個）；生成日＝開始日前 21 日 ⇒ T1 截止日 2098-12-04。
 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({
    extraFiles: ['WebAppPersonalLink.gs', 'PersonalUnavailable.gs', 'UnavailableInvite.gs', 'WebAppUnavailable.gs',
      'WebAppRoster3Common.gs', 'EmailTemplateSeed.gs', 'PreseasonPack.gs', 'WebAppCombined.gs', 'WebAppPeople.gs',
      'PersonalLinkInMail.gs', 'PostSeedChoir.gs', 'WebAppChoir.gs', 'CellDecisions.gs', 'WebApp.gs'].concat(opts.extraFiles || []),
    config: Object.assign({
      WEBAPP_ENABLED: ['TRUE', 'BOOL'], LEAD_DAYS_GENERATE: ['-21', 'INT'],
      WEBAPP_VOLUNTEER_URL: ['https://example.invalid/vol/exec', 'STR'],
      MAIL_ADMIN_NOTIFY: ['clerk@example.invalid', 'STR']
    }, opts.config || {})
  });
  const g = sc.gas; const C = sc.C; const S = sc.S;
  sc.today = opts.today || '2098-12-10';
  const origFormat = g.Utilities.formatDate;
  g.Utilities.formatDate = function (d, tz, f) {
    if (Math.abs(d.getTime() - Date.now()) < 600000) {
      return f === 'yyyy-MM-dd' ? sc.today : origFormat(new Date(sc.today + 'T09:00:00Z'), tz, f);
    }
    return origFormat(d, tz, f);
  };
  let n = 0;
  g.nowTimestamp_ = function () { n++; return sc.today + ' 09:' + String(Math.floor(n / 60) % 60).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); };
  g.Utilities.getUuid = function () { n++; return (n.toString(16).padStart(2, '0')).repeat(4) + '-0000-0000-0000-000000000000'; };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  sc.mails = [];
  g.MailApp = { sendEmail: function (to, subject, body, options) { sc.mails.push({ to: to, subject: subject, body: body, html: options && options.htmlBody }); } };
  // 兩季多出來的季度和主日
  const Q = C.QUARTERS;
  sc.appendRows(sc.ss, S.QUARTERS, [Q.QUARTER_ID, Q.YEAR, Q.TERM, Q.START_DATE, Q.END_DATE, Q.STAGE], [
    { [Q.QUARTER_ID]: '2099T2', [Q.YEAR]: 2099, [Q.TERM]: 2, [Q.START_DATE]: '2099-04-01', [Q.END_DATE]: '2099-06-30', [Q.STAGE]: 'DRAFT' },
    { [Q.QUARTER_ID]: '2099T3', [Q.YEAR]: 2099, [Q.TERM]: 3, [Q.START_DATE]: '2099-07-01', [Q.END_DATE]: '2099-09-30', [Q.STAGE]: 'DRAFT' }]);
  const D = C.SERVICE_DATES;
  sc.appendRows(sc.ss, S.SERVICE_DATES, [D.SERVICE_DATE_ID, D.QUARTER_ID, D.SERVICE_DATE, D.WEEK_INDEX, D.IS_FIRST_SUNDAY_OF_MONTH,
    D.SERVICE_TYPE, D.AUTO_GENERATE], T2.map((d, i) => ({ [D.SERVICE_DATE_ID]: 'SD2' + i, [D.QUARTER_ID]: '2099T2', [D.SERVICE_DATE]: d,
    [D.WEEK_INDEX]: i + 1, [D.SERVICE_TYPE]: '主日崇拜', [D.AUTO_GENERATE]: true }))
    .concat(T3.map((d, i) => ({ [D.SERVICE_DATE_ID]: 'SD3' + i, [D.QUARTER_ID]: '2099T3', [D.SERVICE_DATE]: d,
      [D.WEEK_INDEX]: i + 1, [D.SERVICE_TYPE]: '主日崇拜', [D.AUTO_GENERATE]: true }))));
  // 個人連結 token
  const col = g.ensureNameMappingPersonalLinkTokenColumn_();
  const nm = sc.ss.getSheetByName(S.NAME_MAPPING);
  for (let r = 3; r <= nm.getLastRow(); r++) {
    const id = String(nm.getRange(r, 1).getValue());
    nm.getRange(r, col).setValue(tok(Number(id.slice(-2))));
  }
  const R = C.ROLES;
  seedSheet(sc.ss, S.ROLES, ['R'], Object.keys(R).map((k) => R[k]), opts.roles || []);
  sc.subs = () => g.readUnavailableSubmissions_(sc.TZ);
  sc.audits = (action) => g.readSheet_(S.AUDIT_LOG).filter((r) => !action || r[C.AUDIT_LOG.ACTION] === action);
  sc.unav = () => g.readSheet_(S.UNAVAILABLE);
  return sc;
}
const neutralOf = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

// =====================================================================
console.log('\n=== QC1：token ===');
{
  const sc = scene();
  const g = sc.gas;
  const neutral = g.PERSONAL_LINK_INVALID_MESSAGE;
  const bad = ['', 'z'.repeat(32), tok(99), tok(1).slice(1), null, 42];
  check('★★★★★★ token 錯／格式不對／不是字串 ⇒ 中性錯誤（不講原因）',
    bad.every((t) => neutralOf(() => g.personalSubmitUnavailable(t, '', [T1[1]], '')) === neutral), neutral);
  check('★★★★★★ 甚麼都沒有寫（沒有建立工作表、沒有 AuditLog）',
    !sc.ss.getSheetByName('UnavailableSubmissions') && sc.audits('PERSONAL_UNAVAILABLE_SUBMITTED').length === 0);
  // NameMapping Active=FALSE ⇒ 同樣認不到
  const nm = sc.ss.getSheetByName(sc.S.NAME_MAPPING);
  const keys = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0];
  nm.getRange(4, keys.indexOf('Active') + 1).setValue(false);   // 第 4 行＝P9702
  check('★★★★★ 停用的人（Active=FALSE）⇒ 中性錯誤', neutralOf(() => g.personalSubmitUnavailable(tok(2), '', [T1[1]], '')) === neutral);
  const cfg = sc.ss.getSheetByName(sc.S.CONFIG);
  for (let r = 3; r <= cfg.getLastRow(); r++) if (cfg.getRange(r, 1).getValue() === 'WEBAPP_ENABLED') cfg.getRange(r, 2).setValue('FALSE');
  g.reloadConfigCache_ && g.reloadConfigCache_();
  check('★★★★★ Web UI 停用 ⇒ 正確 token 也是中性錯誤', neutralOf(() => g.personalSubmitUnavailable(tok(1), '', [T1[1]], '')) === neutral);
}

// =====================================================================
console.log('\n=== QC2：提交 ===');
{
  const sc = scene();
  const g = sc.gas;
  const view0 = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
  check('★★★★★★ 可以選的：未完結的最近 2 季（T1、T2），T3 不在', view0.quarters.map((q) => q.quarterId).join() === '2099T1,2099T2',
    JSON.stringify(view0.quarters.map((q) => q.quarterId)));
  check('★★★★ 截止日＝生成日（開始日前 21 日）前 7 日', view0.quarters[0].deadline === '2098-12-04', view0.quarters[0].deadline);
  const res = g.personalSubmitUnavailable(tok(1), '', [T1[1], T1[2], T1[1]], '<b>出外</b> 旅行<script>x</script>');
  check('★★★★★★ 提交兩個日子（重複的只算一次）', res.ok && res.added === 2, JSON.stringify(res));
  const subs = sc.subs();
  check('★★★★★★ 只寫自己的行（PersonID＝P9701）、狀態 PENDING', subs.length === 2 && subs.every((s) => s.personId === 'P9701' && s.status === 'PENDING'),
    JSON.stringify(subs));
  check('★★★★★★ 原因去掉 HTML', subs[0].reason === '出外 旅行x', subs[0].reason);
  check('★★★★★ 截止日（2098-12-04）之後 ⇒ 標「截止日之後」', subs.every((s) => s.late === true));
  check('★★★★★★ 不直接寫 Unavailable', sc.unav().length === 0);
  const audit = sc.audits('PERSONAL_UNAVAILABLE_SUBMITTED');
  check('★★★★★★ AuditLog 只寫 PersonID，不寫 token', audit.length === 1 && audit[0][sc.C.AUDIT_LOG.TARGET_KEY] === 'P9701'
    && JSON.stringify(sc.audits()).indexOf(tok(1)) === -1, JSON.stringify(audit));
  check('★★★★★ 回傳最新的頁面資料：兩項「等候幹事確認」，可以撤回',
    res.view.submissions.length === 2 && res.view.submissions.every((s) => s.statusText === '等候幹事確認' && s.canWithdraw));
  check('★★★★ 那兩日在選擇清單變成「已申報」（不可以再勾）',
    res.view.quarters[0].dates.filter((d) => d.status === 'PENDING').map((d) => d.serviceDate).join() === [T1[1], T1[2]].join());
  const again = g.personalSubmitUnavailable(tok(1), '', [T1[1]], '');
  check('★★★★★ 已申報的日子再提交 ⇒ 不重複', !again.ok && sc.subs().length === 2, JSON.stringify(again));
  check('★★★★★★ 不在範圍的日子（T3）⇒ 拒絕、甚麼都沒有寫', !g.personalSubmitUnavailable(tok(1), '', [T3[0]], '').ok && sc.subs().length === 2);
  check('★★★★★ 不是主日／格式不對 ⇒ 拒絕', !g.personalSubmitUnavailable(tok(1), '', ['2099-01-05'], '').ok
    && !g.personalSubmitUnavailable(tok(1), '', ['x'], '').ok && !g.personalSubmitUnavailable(tok(1), '', '2099-01-04', '').ok && sc.subs().length === 2);
  sc.today = '2099-01-12';
  check('★★★★★★ 過去的日子 ⇒ 拒絕', !g.personalSubmitUnavailable(tok(1), '', [T1[0]], '').ok && sc.subs().length === 2);
  sc.today = '2098-12-10';
  check('★★★★★ 每次最多 20 個日子（超過 ⇒ 拒絕）', /最多可以提交 20 個/.test(g.submitPersonalUnavailable_({ personId: 'P9703' },
    Array.from({ length: 21 }, (_, i) => '2099-0' + (1 + (i % 2)) + '-' + String(i + 1).padStart(2, '0')), '').message));
  check('★★★★ 原因最多 100 字', g.sanitizePersonalUnavailableReason_('字'.repeat(150)).length === 100);
  // 每人每日最多 10 次
  const sc2 = scene();
  const dates = T1.concat(T2);
  let lastOk = true;
  for (let i = 0; i < 6; i++) lastOk = sc2.gas.personalSubmitUnavailable(tok(4), '', [dates[i]], '').ok && lastOk;
  // 撤回再提交同一日也算一次
  for (let i = 0; i < 4; i++) {
    const s = sc2.subs().filter((x) => x.personId === 'P9704' && x.status === 'PENDING')[0];
    sc2.gas.personalWithdrawUnavailable(tok(4), '', s.submissionId);
    lastOk = sc2.gas.personalSubmitUnavailable(tok(4), '', [s.serviceDate], '').ok && lastOk;
  }
  const s11 = sc2.subs().filter((x) => x.personId === 'P9704' && x.status === 'PENDING')[0];
  sc2.gas.personalWithdrawUnavailable(tok(4), '', s11.submissionId);
  const eleventh = sc2.gas.personalSubmitUnavailable(tok(4), '', [s11.serviceDate], '');
  check('★★★★★★ 每人每日最多 10 次提交（第 11 次拒絕）', lastOk && !eleventh.ok && /上限/.test(eleventh.message), JSON.stringify(eleventh));
  check('★★★★ 別人不受影響', sc2.gas.personalSubmitUnavailable(tok(5), '', [T1[0]], '').ok);
  sc2.today = '2098-12-11';
  check('★★★★ 第二日可以再提交', sc2.gas.personalSubmitUnavailable(tok(4), '', [s11.serviceDate], '').ok);
  // 已經在不能服侍名單 ⇒ 不用再申報
  const U = sc.C.UNAVAILABLE;
  sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [{ [U.UNAVAILABLE_ID]: 'U1', [U.PERSON_ID]: 'P9702',
    [U.DATE_FROM]: T1[0], [U.DATE_TO]: T1[3], [U.APPLIES_TO]: 'ALL', [U.STATUS]: 'ACTIVE', [U.SOURCE]: 'WEBUI' }]);
  const v2 = g.buildPersonalUnavailableView_('P9702', sc.today, sc.TZ);
  check('★★★★ 已在不能服侍名單的日子 ⇒「已在不能服侍名單」，不可以勾', v2.quarters[0].dates.every((d) => d.status === 'LISTED'));
  // 截止日之前提交 ⇒ 不標
  const sc3 = scene({ today: '2098-12-01' });
  sc3.gas.personalSubmitUnavailable(tok(3), '', [T1[0]], '');
  check('★★★★ 截止日之前提交 ⇒ 不標「截止日之後」', sc3.subs()[0].late === false);
  check('★★★★ UnavailableSubmissions 第 1 行中文標題、第 2 行機器鍵',
    sc3.ss.getSheetByName('UnavailableSubmissions').getRange(2, 1, 1, 10).getValues()[0].join() === sc3.gas.unavailableSubmissionKeys_().join()
    && sc3.ss.getSheetByName('UnavailableSubmissions').getRange(1, 1).getValue() === '申報編號');
}
{
  // 第九十輪回歸 V3 修正：由連結的季度（q）開始列出——邀請較後的季度時，義工要找得到那一季
  const sc = scene();
  const g = sc.gas;
  const ids = (q) => g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ, q).quarters.map((x) => x.quarterId).join();
  check('★★★★★★ 連結 q＝2099T2 ⇒ 由 T2 開始兩季（T2、T3），不是今日最近的 T1', ids('2099T2') === '2099T2,2099T3', ids('2099T2'));
  check('★★★★★ q 不存在／空白 ⇒ 由今日最近的未完結季度開始（T1、T2）', ids('2077T1') === '2099T1,2099T2' && ids('') === '2099T1,2099T2');
  const r = g.personalSubmitUnavailable(tok(1), '2099T2', [T3[0]], '');
  check('★★★★★★ 連結 q＝2099T2 ⇒ 可以申報 T3 的主日', r.ok && r.added === 1 && r.view.quarters[0].quarterId === '2099T2', JSON.stringify(r).slice(0, 300));
  check('★★★★★ 同一個日子，連結 q＝2099T1（只到 T2）⇒ 不可以申報', !g.personalSubmitUnavailable(tok(3), '2099T1', [T3[0]], '').ok);
  check('★★★★ 撤回後回傳的頁面亦由連結的季度開始', g.personalWithdrawUnavailable(tok(1), '2099T2', r.view.submissions[0].submissionId).view.quarters[0].quarterId === '2099T2');
  check('★★★★ 季度不是字串 ⇒ 當作沒有傳（由最近的季度開始）', g.personalSubmitUnavailable(tok(4), { x: 1 }, [T1[0]], '').ok);
}

// =====================================================================
console.log('\n=== QC3：撤回 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[1], T1[2]], '');
  g.personalSubmitUnavailable(tok(3), '', [T1[1]], '');
  const mine = sc.subs().filter((s) => s.personId === 'P9701');
  const other = sc.subs().filter((s) => s.personId === 'P9703')[0];
  const r1 = g.personalWithdrawUnavailable(tok(1), '', other.submissionId);
  check('★★★★★★ 不可以撤回別人的（找不到，同一句）', !r1.ok && /找不到/.test(r1.message)
    && sc.subs().filter((s) => s.submissionId === other.submissionId)[0].status === 'PENDING', JSON.stringify(r1));
  const r2 = g.personalWithdrawUnavailable(tok(1), '', mine[0].submissionId);
  check('★★★★★★ 撤回自己的 ⇒ WITHDRAWN；頁面不再列出', r2.ok && sc.subs().filter((s) => s.submissionId === mine[0].submissionId)[0].status === 'WITHDRAWN'
    && r2.view.submissions.length === 1, JSON.stringify(r2));
  check('★★★★ AuditLog 撤回（只寫 PersonID）', sc.audits('PERSONAL_UNAVAILABLE_WITHDRAWN').length === 1
    && JSON.stringify(sc.audits()).indexOf(tok(1)) === -1);
  g.decideUnavailableSubmissions_([mine[1].submissionId], 'ACCEPT', 'clerk@example.invalid');
  const r3 = g.personalWithdrawUnavailable(tok(1), '', mine[1].submissionId);
  check('★★★★★★ 已確認的不可以自己取消（「如需取消，請聯絡幹事」）', !r3.ok && /如需取消，請聯絡幹事/.test(r3.message), JSON.stringify(r3));
  const v = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
  check('★★★★★ 個人頁：已確認、不可以撤回', v.submissions.length === 1 && v.submissions[0].statusText === '已確認' && !v.submissions[0].canWithdraw);
}

// =====================================================================
console.log('\n=== QC4：幹事確認 ===');
{
  const sc = scene();
  const g = sc.gas; const U = sc.C.UNAVAILABLE;
  g.personalSubmitUnavailable(tok(1), '', [T1[1]], '出外');
  g.personalSubmitUnavailable(tok(3), '', [T1[2]], '');
  g.personalSubmitUnavailable(tok(4), '', [T1[3]], '');
  const list = g.apiListUnavailable(sc.Q, '');
  check('★★★★★★ 〔不能服侍的日期〕有「義工申報，待確認」三項（名字、日期、原因、截止日之後）',
    list.submissions.items.length === 3 && list.submissions.items[0].personName === sc.PEOPLE.P9701
    && list.submissions.items[0].reason === '出外' && list.submissions.items[0].late === true, JSON.stringify(list.submissions));
  const ids = list.submissions.items.map((i) => i.submissionId);
  const a = g.apiDecideUnavailableSubmissions([ids[0]], 'ACCEPT');
  const rows = sc.unav();
  check('★★★★★★ 〔接受〕⇒ 建立 Unavailable（Source=PERSONAL_LINK、全部崗位、原因照填、生效中）',
    a.accepted === 1 && rows.length === 1 && rows[0][U.PERSON_ID] === 'P9701' && rows[0][U.SOURCE] === 'PERSONAL_LINK'
    && rows[0][U.APPLIES_TO] === 'ALL' && rows[0][U.REASON] === '出外' && rows[0][U.STATUS] === 'ACTIVE'
    && g.toDateString_(rows[0][U.DATE_FROM], sc.TZ) === T1[1], JSON.stringify(rows));
  const acc = sc.subs().filter((s) => s.submissionId === ids[0])[0];
  check('★★★★★ 申報記 ACCEPTED 和 UnavailableID', acc.status === 'ACCEPTED' && acc.unavailableId === rows[0][U.UNAVAILABLE_ID]);
  const r = g.apiDecideUnavailableSubmissions([ids[1]], 'REJECT');
  check('★★★★★★ 〔不接受〕⇒ REJECTED，不建立 Unavailable', r.rejected === 1 && sc.unav().length === 1
    && sc.subs().filter((s) => s.submissionId === ids[1])[0].status === 'REJECTED');
  check('★★★★ 個人頁顯示「不接受」', g.buildPersonalUnavailableView_('P9703', sc.today, sc.TZ).submissions[0].statusText === '不接受');
  const all = g.apiDecideUnavailableSubmissions(ids, 'ACCEPT');
  check('★★★★★ 〔全部接受〕：已處理的略過，只接受剩下的', all.accepted === 1 && all.skipped === 2 && sc.unav().length === 2, JSON.stringify(all));
  check('★★★★ 不認得的決定 ⇒ 拋錯', /不認得/.test(neutralOf(() => g.apiDecideUnavailableSubmissions(ids, 'X'))));
  check('★★★★ 待確認變 0', g.apiListUnavailable(sc.Q, '').submissions.items.length === 0 && g.countPendingUnavailableSubmissions_(null) === 0);
  check('★★★★ AuditLog：接受、不接受', sc.audits('PERSONAL_UNAVAILABLE_ACCEPTED').length === 2 && sc.audits('PERSONAL_UNAVAILABLE_REJECTED').length === 1);
}
{
  // 已生成的季度：接受之後走「之後才申報不能服侍」
  const sc = scene();
  const g = sc.gas;
  g.readWeightsForQuarterTune_ = () => ({ rows: [] });
  const RS = sc.C.RULE_SETTINGS;
  sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
    [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
  g.apiGenerateDraftExecute(sc.Q);
  const name = sc.getCell(0, T1[1], 'READ#1');
  const pid = Object.keys(sc.PEOPLE).filter((id) => sc.PEOPLE[id] === name)[0];
  g.personalSubmitUnavailable(tok(Number(pid.slice(-2))), sc.Q, [T1[1]], '');
  sc.today = '2099-06-01';   // 接受的時間一定晚過版本
  g.apiDecideUnavailableSubmissions(g.apiListUnavailable(sc.Q, '').submissions.items.map((i) => i.submissionId), 'ACCEPT');
  const w = g.summariseVersionSendWarnings_(sc.Q, 0);
  check('★★★★★★ 已生成的季度：接受之後是「之後才申報不能服侍」（狀態卡、寄出警告）',
    w.lateUnavailable.count === 1 && w.unreleased.items.some((u) => u.serviceDate === T1[1] && u.reason === '之後才申報不能服侍'),
    JSON.stringify({ late: w.lateUnavailable, un: w.unreleased }));
}

// =====================================================================
console.log('\n=== QC5：個人頁 ===');
{
  const sc = scene();
  const g = sc.gas;
  let rendered = null;
  g.HtmlService = {
    createHtmlOutput: (h) => ({ html: h, setTitle() { return this; } }),
    createTemplateFromFile: () => ({ evaluate() { rendered = this; return { setTitle() { return this; }, addMetaTag() { return this; } }; } })
  };
  g.personalSubmitUnavailable(tok(3), '', [T1[0]], '<img src=x onerror=alert(1)>a</script>b');
  const out = g.renderPersonalRosterPage_({ parameter: { p: tok(1), q: sc.Q } });
  check('★★★★★★ 這一季還沒有職事表、token 正確 ⇒ 照樣打開（noRoster）', rendered && rendered.data.noRoster === true && !out.html, JSON.stringify(rendered && rendered.data).slice(0, 300));
  const boot = JSON.parse(rendered.data.unavailableJson);
  check('★★★★★ 頁面資料：自己的 token、連結的季度、可以申報的季度', boot.token === tok(1) && boot.quarterId === sc.Q
    && boot.view.quarters.length === 2 && boot.view.quarters[0].quarterId === sc.Q);
  check('★★★★★ 頁面提交／撤回都帶連結的季度', /runner\.personalSubmitUnavailable\(token, quarterId, /.test(read('src/ui/PersonalRoster.html'))
    && /runner\.personalWithdrawUnavailable\(token, quarterId, /.test(read('src/ui/PersonalRoster.html')));
  rendered = null;
  g.renderPersonalRosterPage_({ parameter: { p: tok(3), q: sc.Q } });
  const json3 = rendered.data.unavailableJson;
  check('★★★★★★ 頁面嵌入的資料：< > & 已轉義（不會跳出 <script>）', json3.indexOf('<') === -1 && json3.indexOf('>') === -1
    && JSON.parse(json3).view.submissions[0].reason === 'ab', json3.slice(0, 400));
  const esc = g.jsonForInlineScript_({ a: '</script><b>&\u2028' });
  check('★★★★★★ 嵌入用 JSON：< > & U+2028 一律轉義，而且讀回來不變', !/[<>&\u2028]/.test(esc) && JSON.parse(esc).a === '</script><b>&\u2028', esc);
  check('★★★★★★ 只有這個人自己的申報（沒有別人的 PersonID）', json3.indexOf('P9701') === -1 && JSON.parse(json3).view.submissions.length === 1);
  const bad1 = g.renderPersonalRosterPage_({ parameter: { p: tok(99), q: sc.Q } });
  const bad2 = g.renderPersonalRosterPage_({ parameter: { p: tok(1), q: '2077T1' } });
  check('★★★★★★ token 錯 ⇒ 中性頁；季度不存在 ⇒ 中性頁', /連結無效或已失效/.test(bad1.html) && /連結無效或已失效/.test(bad2.html));
  check('★★★★ 已有職事表 ⇒ 照舊（noRoster 不設）', (() => {
    g.apiGenerateDraftExecute(sc.Q); rendered = null;
    g.renderPersonalRosterPage_({ parameter: { p: tok(1), q: sc.Q } });
    return rendered && !rendered.data.noRoster && rendered.data.postRows.length > 0 && !!rendered.data.unavailableJson;
  })());
  const html = read('src/ui/PersonalRoster.html');
  check('★★★★★ 模板：noRoster ⇒「這一季的職事表還未發出」；有「申報不能服侍的日子」一段', /<\? if \(data\.noRoster\) \{ \?>/.test(html)
    && /這一季的職事表還未發出/.test(html) && /申報不能服侍的日子/.test(html) && /<\?!= data\.unavailableJson \?>/.test(html));
  check('★★★★ 模板：已確認的寫「如需取消，請聯絡幹事」；原因最多 100 字', /如需取消，請聯絡幹事/.test(html) && /maxLength = view\.maxReason/.test(html));
}

// =====================================================================
console.log('\n=== QC6：每日檢查通知幹事 ===');
{
  const sc = scene();
  const g = sc.gas;
  const cfg = g.readConfig_();
  const notified = [];
  g.notifyAdmin_ = (subject, body, to, dry) => notified.push({ subject, body, to, dry });
  check('★★★★ 沒有申報 ⇒ 不通知', g.runUnavailableSubmissionNotify_(sc.today, cfg, true).outcome === 'SKIP' && notified.length === 0);
  g.personalSubmitUnavailable(tok(1), '', [T1[1]], '出外');
  const r1 = g.runUnavailableSubmissionNotify_(sc.today, cfg, true);
  check('★★★★★★ 有新的申報 ⇒ 通知幹事一次（DRY_RUN 照傳）', r1.outcome === 'SENT' && notified.length === 1 && notified[0].dry === true
    && notified[0].to === 'clerk@example.invalid' && notified[0].body.indexOf(sc.PEOPLE.P9701) !== -1, JSON.stringify(notified));
  g.personalSubmitUnavailable(tok(3), '', [T1[1]], '');
  check('★★★★★★ 同一日最多一封', g.runUnavailableSubmissionNotify_(sc.today, cfg, true).detail === 'ALREADY_TODAY' && notified.length === 1);
  sc.today = '2098-12-11';
  const r3 = g.runUnavailableSubmissionNotify_(sc.today, cfg, true);
  check('★★★★★ 第二日：只講新的（1 項）', r3.outcome === 'SENT' && notified.length === 2 && /1 項新的/.test(notified[1].body), notified[1] && notified[1].body);
  sc.today = '2098-12-12';
  check('★★★★★ 沒有新的 ⇒ 不通知', g.runUnavailableSubmissionNotify_(sc.today, cfg, true).detail === 'NOTHING_NEW' && notified.length === 2);
  const sc2 = scene({ config: { PERSONAL_UNAVAILABLE_NOTIFY: ['FALSE', 'BOOL'] } });
  sc2.gas.personalSubmitUnavailable(tok(1), '', [T1[1]], '');
  check('★★★★★ Config 關掉 ⇒ 不通知', sc2.gas.runUnavailableSubmissionNotify_(sc2.today, sc2.gas.readConfig_(), true).detail === 'DISABLED');
  check('★★★★ 每日檢查有呼叫（出錯不影響其他季度）', /runUnavailableSubmissionNotify_\(today, config, isDryRun\)/.test(read('src/Trigger.gs')));
  // 真正的 notifyAdmin_：DRY_RUN ⇒ 不寄
  const sc3 = scene();
  sc3.gas.personalSubmitUnavailable(tok(1), '', [T1[1]], '');
  sc3.gas.runUnavailableSubmissionNotify_(sc3.today, sc3.gas.readConfig_(), true);
  check('★★★★★ DRY_RUN ⇒ 沒有真正寄出', sc3.mails.length === 0);
}

// =====================================================================
console.log('\n=== QC7：〔寄出申報邀請〕===');
{
  const sc = scene({ roles: [{ PersonID: 'P9706', RoleCode: 'DEACON', EffectiveFrom: '2098-01-01', EffectiveTo: '', Active: true }] });
  const g = sc.gas; const E = sc.C.ELIGIBILITY;
  // P9706 不在任何自動排的崗位 ⇒ 用「執事」放在讀經名單上（展開身分）
  sc.appendRows(sc.ss, sc.S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
    [{ [E.ELIGIBILITY_ID]: 'ED', [E.PERSON_ID]: 'ROLE:DEACON', [E.POST_ID]: 'READ', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
  const who = g.buildUnavailableInviteRecipients_(sc.today);
  const ids = who.recipients.map((r) => r.personId).sort();
  check('★★★★★★ 收件人：自動排的崗位上的人＋「執事」展開（P9706）；P9707 沒有電郵 ⇒ 列出',
    ids.join() === 'P9701,P9702,P9703,P9704,P9705,P9706' && who.noEmail.join() === sc.PEOPLE.P9707, JSON.stringify({ ids, noEmail: who.noEmail }));
  const p = g.apiUnavailableInvitePreview(sc.Q);
  check('★★★★★ 預覽：人數、截止日、沒有電郵的人；不回傳 token', p.recipientCount === 6 && p.deadline === '2098-12-04'
    && p.noEmail.length === 1 && JSON.stringify(p).indexOf(tok(1)) === -1 && p.dryRun === true, JSON.stringify(p));
  const r = g.apiUnavailableInviteSend(sc.Q);
  check('★★★★★★ DRY_RUN ⇒ 模擬 6 封、沒有真正寄出（連嘗試都沒有）', r.dryRun && r.simulated === 6 && r.sent === 0
    && r.failed.length === 0 && sc.mails.length === 0, JSON.stringify(r));
  const a1 = sc.audits('UNAVAILABLE_INVITE_SENT');
  check('★★★★★ AuditLog：模擬（第三段 DRY_RUN）', a1.length === 1 && /\|DRY_RUN$/.test(a1[0][sc.C.AUDIT_LOG.NEW_VALUE]));
  check('★★★★ 預覽講明只有模擬寄出', g.apiUnavailableInvitePreview(sc.Q).sentRecord.simulated === true
    && g.apiUnavailableInvitePreview(sc.Q).sentRecord.real === null);
  // 真正寄出
  const cfg = sc.ss.getSheetByName(sc.S.CONFIG);
  for (let row = 3; row <= cfg.getLastRow(); row++) if (cfg.getRange(row, 1).getValue() === 'DRY_RUN') cfg.getRange(row, 2).setValue('FALSE');
  g.reloadConfigCache_ && g.reloadConfigCache_();
  g.assertNotPreviewMode_ = () => {};
  g.readMailRedirectTarget_ = () => '';
  const r2 = g.apiUnavailableInviteSend(sc.Q);
  check('★★★★★★ 真正寄出：每人一封，內有他自己的個人專屬連結（q＝這一季）', r2.sent === 6 && sc.mails.length === 6
    && sc.mails.every((m) => {
      const id = m.to.split('@')[0].toUpperCase();   // 假電郵 p97xx@example.invalid
      return m.body.indexOf('p=' + tok(Number(id.slice(-2))) + '&q=' + sc.Q) !== -1;
    }), JSON.stringify(sc.mails.map((m) => m.to)));
  check('★★★★ 信內有截止日、怎樣申報', /2098-12-04/.test(sc.mails[0].subject) && /申報不能服侍的日子/.test(sc.mails[0].body));
  const a2 = sc.audits('UNAVAILABLE_INVITE_SENT');
  check('★★★★★ AuditLog：真正寄出（SENT）分開記；不寫連結／token', a2.length === 2 && /\|SENT$/.test(a2[1][sc.C.AUDIT_LOG.NEW_VALUE])
    && JSON.stringify(sc.audits()).indexOf(tok(1)) === -1 && g.readUnavailableInviteRecord_(sc.Q).real !== null);
  // 轉寄測試地址
  g.readMailRedirectTarget_ = () => 'test@example.invalid';
  sc.mails.length = 0;
  g.apiUnavailableInviteSend(sc.Q);
  check('★★★★★ MAIL_REDIRECT_ALL_TO ⇒ 全部寄去測試地址', sc.mails.length === 6 && sc.mails.every((m) => m.to === 'test@example.invalid'));
  // 沒有網址 ⇒ 拒絕
  for (let row = 3; row <= cfg.getLastRow(); row++) if (cfg.getRange(row, 1).getValue() === 'WEBAPP_VOLUNTEER_URL') cfg.getRange(row, 2).setValue('');
  g.reloadConfigCache_ && g.reloadConfigCache_();
  check('★★★★ 沒有設定個人連結網址 ⇒ 一封都不寄', /WEBAPP_VOLUNTEER_URL/.test(neutralOf(() => g.apiUnavailableInviteSend(sc.Q)))
    && g.apiUnavailableInvitePreview(sc.Q).baseUrlMissing === true);
}
{
  // 領詩／司琴（同日不兼任崗位，人手填）和詩班名單上的人也收到
  const sc = scene({ extraFiles: [] });
  const g = sc.gas; const E = sc.C.ELIGIBILITY;
  g.SpreadsheetApp.getUi = () => ({ ButtonSet: { OK: 1, YES_NO: 2 }, Button: { YES: 'YES' }, alert: () => 'YES' });
  g.runSeedPostShowInRoster_();
  g.runCreateChoirGroup_();
  // 把 P9706 放入詩班；P9707（沒有電郵）的電郵補上，放入 PIANO（不是自動排，但是同日不兼任崗位）
  const before = g.buildUnavailableInviteRecipients_(sc.today).recipients.map((r) => r.personId);
  check('★★★★★★ 不在事奉人員表上的人（P9706）不會收到', before.length === 5 && before.indexOf('P9706') === -1, before.join());
  sc.appendRows(sc.ss, sc.S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
    [{ [E.ELIGIBILITY_ID]: 'EC', [E.PERSON_ID]: 'P9706', [E.POST_ID]: 'CHOIR', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
  const ids = g.buildUnavailableInviteRecipients_(sc.today).recipients.map((r) => r.personId);
  check('★★★★★ 詩班名單上的人也收到', ids.indexOf('P9706') !== -1, ids.join());
  check('★★★★ 收件人包括 SAME_DAY_EXCLUSIVE_POST_IDS 的崗位（程式碼）', /readSameDayExclusivePostIds_\(\)/.test(read('src/UnavailableInvite.gs')));
}

// =====================================================================
console.log('\n=== QC8：主畫面、季前資料、畫面、Config ===');
{
  const sc = scene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[1]], '');
  g.personalSubmitUnavailable(tok(3), '', [T2[0]], '');
  check('★★★★★ 待確認數目：全部 2 項；落在 T1 的 1 項', g.countPendingUnavailableSubmissions_(null) === 2
    && g.countPendingUnavailableSubmissions_({ start: '2099-01-01', end: '2099-01-31' }) === 1);
  const X = sc.C.PERSON_POST_EXCLUSIONS;
  seedSheet(sc.ss, sc.S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), []);
  const W = sc.C.PERSON_POST_WEIGHT;
  seedSheet(sc.ss, sc.S.PERSON_POST_WEIGHT, ['W'], Object.keys(W).map((k) => W[k]), []);
  g.computeAutomationSchedule_ = function () { return { generateDate: '2098-12-20', officialDate: '' }; };
  const pack = g.buildPreseasonPack_(sc.Q, sc.today, '2098-12-20');
  check('★★★★★★ 季前資料第四段之後一句「另有 1 項義工申報待確認」', pack.sections[3].lines.indexOf('另有 1 項義工申報待確認') !== -1,
    JSON.stringify(pack.sections[3].lines));
  check('★★★★ 主畫面帶 pendingSubmissions', /pendingSubmissions: pendingSubmissions/.test(read('src/WebAppDashboard.gs')));
  check('★★★★ Config：三個 key 有登記（預設 2、7、TRUE）', g.CONFIG_KEYS.PERSONAL_UNAVAILABLE_QUARTERS_AHEAD && g.CONFIG_KEYS.PERSONAL_UNAVAILABLE_DEADLINE_DAYS
    && g.CONFIG_KEYS.PERSONAL_UNAVAILABLE_NOTIFY && /"PERSONAL_UNAVAILABLE_NOTIFY"/.test(read('docs/config_baseline_上線值.json')));
  check('★★★★ EmailTemplates 範本有種子（「補齊 Email 範本」會加入）', !!g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_UNAVAILABLE_INVITE_TC')[0]);
  check('★★★★ apiUnavailableInvitePreview 在前後端唯讀清單；apiDecideUnavailableSubmissions、apiUnavailableInviteSend 不在',
    /'apiUnavailableInvitePreview'/.test(read('src/WebApp.gs')) && /'apiUnavailableInvitePreview'/.test(read('src/ui/Script.html'))
    && !/'apiDecideUnavailableSubmissions'[^\n]*\n?[^\n]*READ/.test(read('src/WebApp.gs')));
}
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: [] }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] }, pendingSubmissions: 3 });
  const body = ui.document.getElementById('zone2Body');
  check('★★★★★★ 「這一季還要做的」有「義工申報待確認：3 項」', /義工申報待確認：3 項/.test(body.textContent), body.textContent.slice(0, 600));
  const btns = body.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  check('★★★★★ 開季前準備有〔寄出申報邀請〕', btns.indexOf('寄出申報邀請') !== -1, btns.join('、'));
  // 〔不能服侍的日期〕最上面
  const cur = (id, name, source) => ({ unavailableId: id, personId: 'P9701', personName: name, dateFrom: '2099-01-11', dateTo: '2099-01-11',
    appliesTo: 'ALL', postIds: [], reason: '', source: source, status: 'ACTIVE', inQuarter: true });
  const data = { quarterStart: '2099-01-01', quarterEnd: '2099-01-31', today: '2098-12-10', people: [], posts: [],
    current: [cur('U1', '假戊', 'PERSONAL_LINK'), cur('U2', '假己', 'WEBUI')], past: [], cancelled: [],
    submissions: { items: [{ submissionId: 'S1', personId: 'P9701', personName: '假甲', serviceDate: '2099-01-11', reason: '出外', late: true },
      { submissionId: 'S2', personId: 'P9703', personName: '假丙', serviceDate: '2099-01-18', reason: '', late: false }], error: '' } };
  vm.runInContext('unavailableData = ' + JSON.stringify(data) + ';', ui);
  ui.renderUnavailable('');
  const mb = ui.document.getElementById('modalBody');
  const first = mb.children[0];
  check('★★★★★★ 最上面「義工申報，待確認（2 項）」', first && /^義工申報，待確認（2 項）/.test(first.textContent), first && first.textContent);
  const mbtn = mb.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  check('★★★★★ 逐項〔接受〕〔不接受〕＋〔全部接受〕', mbtn.filter((t) => t === '接受').length === 2 && mbtn.filter((t) => t === '不接受').length === 2
    && mbtn.indexOf('全部接受') !== -1, mbtn.join('、'));
  check('★★★★ 截止日之後的標出來、原因', /假甲　2099-01-11　（截止日之後）/.test(mb.textContent) && /原因：出外/.test(mb.textContent));
  check('★★★★★ 生效清單：接受了的義工申報寫「（來源：個人連結）」；幹事自己加的不寫',
    /假戊　2099-01-11 至 2099-01-11　全部崗位　（來源：個人連結）/.test(mb.textContent) && !/假己[^假]*來源/.test(mb.textContent), mb.textContent.slice(0, 600));
  // 只可查看 ⇒ 看得到，按鈕灰色
  vm.runInContext('setViewOnly_(true);', ui);
  ui.renderUnavailable('');
  const vb = ui.document.getElementById('modalBody').flatten().filter((n) => n.tagName === 'BUTTON' && /接受/.test(n.textContent));
  check('★★★★★★ 只可查看：看得到，〔接受〕〔不接受〕〔全部接受〕全部灰色', vb.length === 5 && vb.every((b) => b.disabled === true),
    vb.map((b) => b.textContent + ':' + b.disabled).join(','));
  check('★★★★ 只可查看：〔寄出申報邀請〕可以打開預覽（不灰）', vm.runInContext("isViewOnlyBlockedLabel_('寄出申報邀請')", ui) === false
    && vm.runInContext("isViewOnlyBlockedLabel_('寄出')", ui) === true);
  vm.runInContext('setViewOnly_(false);', ui);
  // 〔接受〕經 callServerMutating
  const calls = [];
  ui.callServerMutating = async (name, ids, decision) => { calls.push([name, ids, decision]); return { message: '已接受 1 項' }; };
  ui.callServer = async () => data;
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.renderUnavailable('');
  ui.document.getElementById('modalBody').flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '全部接受')[0].fire('click');
  setTimeout(() => {
    check('★★★★★ 〔全部接受〕送出全部編號（callServerMutating）', calls.length === 1 && calls[0][0] === 'apiDecideUnavailableSubmissions'
      && calls[0][1].join() === 'S1,S2' && calls[0][2] === 'ACCEPT', JSON.stringify(calls));
    finish();
  }, 0);
}

function finish() {
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exitCode = fail === 0 ? 0 : 1;
}
