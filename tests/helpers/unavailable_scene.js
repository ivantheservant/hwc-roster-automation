// 第九十四輪批次：事奉人員申報不能服侍的測試場景（由 round90_qc_personal_unavailable 的場景抽出，給 round94_* 用）。
//
// 2099T1（四個主日）＋ 2099T2（兩個）＋ 2099T3（一個）；今日固定（預設 2098-12-10）；
// NameMapping 有 PersonalLinkToken（P9701–P9707 各自一個）；生成日＝開始日前 21 日 ⇒ T1 截止日 2098-12-04。
// 下面用假 ID（P97xx）、假名、假 token、example.invalid。

const { buildRound75Scene } = require('./round75_harness.js');
const { seedSheet } = require('./mock_sheets_realistic.js');

const tok = (n) => (n.toString(16).padStart(2, '0')).repeat(16);   // 假 token（32 個十六進位字元）
const T1 = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];
const T2 = ['2099-04-05', '2099-04-12'];
const T3 = ['2099-07-05'];

function buildUnavailableScene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({
    extraFiles: ['WebAppPersonalLink.gs', 'PersonalUnavailable.gs', 'UnavailableSchedule.gs', 'UnavailableInvite.gs', 'WebAppUnavailable.gs',
      'WebAppRoster3Common.gs', 'EmailTemplateSeed.gs', 'PreseasonPack.gs', 'WebAppCombined.gs', 'WebAppPeople.gs',
      'PersonalLinkInMail.gs', 'PostSeedChoir.gs', 'WebAppChoir.gs', 'CellDecisions.gs', 'WebApp.gs'].concat(opts.extraFiles || []),
    config: Object.assign({
      WEBAPP_ENABLED: ['TRUE', 'BOOL'], LEAD_DAYS_GENERATE: ['-21', 'INT'],
      WEBAPP_VOLUNTEER_URL: ['https://example.invalid/vol/exec', 'STR'],
      MAIL_ADMIN_NOTIFY: ['clerk@example.invalid', 'STR'],
      // 第一百零一輪批次 ZE-2：這批測試測的是申報本身（第一百零一輪之前人人可以申報）⇒ 開放範圍設為 ALL；第一階段另有 round101_ze 測試
      ROLLOUT_AUDIENCE: ['ALL', 'ENUM']
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

module.exports = { buildUnavailableScene, tok, T1, T2, T3 };
