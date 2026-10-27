// 第八十三輪批次 JD 組：寄出測試用嘅場景（同 tests/round82_ig_send_buttons.test.js 嗰個一樣）。
//
// 身分：P9701 堂委、P9702 執事、P9703 IT、P9704 幹事（P9704 同時都係堂委）；
// 固定收件人：審閱（Role=REVIEWER）一個、只收正式發出一個；三個階段各一個範本（附件「不附」）。

const { buildRound75Scene } = require('./round75_harness.js');
const { seedSheet } = require('./mock_sheets_realistic.js');

function buildSendScene(selfEmail) {
  const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
  const gas = sc.gas;
  gas.Session = { getActiveUser: () => ({ getEmail: () => selfEmail }) };
  gas.checkMissingPersonalPdfs_ = () => ({ applicable: false, missing: [], total: 0 });
  Object.assign(gas.Utilities, {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (algo, input) => Array.from(require('crypto').createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest()),
    parseDate: (str) => new Date(String(str).slice(0, 10) + 'T12:00:00Z')
  });
  const C = sc.C;
  const R = C.ROLES;
  if (sc.ss.getSheetByName(sc.S.ROLES)) sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.ROLES));
  const role = (id, p, code) => ({ [R.ROLE_ASSIGNMENT_ID]: id, [R.PERSON_ID]: p, [R.ROLE_CODE]: code,
    [R.EFFECTIVE_FROM]: '2000-01-01', [R.EFFECTIVE_TO]: '', [R.ACTIVE]: true });
  seedSheet(sc.ss, sc.S.ROLES, Object.keys(R).map(() => ''), Object.keys(R).map((k) => R[k]), [
    role('R1', 'P9701', 'COMMITTEE'), role('R2', 'P9702', 'DEACON'), role('R3', 'P9703', 'IT'),
    role('R4', 'P9704', 'CLERK'), role('R5', 'P9704', 'COMMITTEE')
  ]);
  const E = C.EMAIL_RECIPIENTS;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_RECIPIENTS));
  seedSheet(sc.ss, sc.S.EMAIL_RECIPIENTS, Object.keys(E).map(() => ''), Object.keys(E).map((k) => E[k]), [
    { [E.RECIPIENT_ID]: 'E1', [E.EMAIL]: 'office@example.invalid', [E.DISPLAY_NAME]: '辦公室', [E.STAGE]: 'OFFICIAL',
      [E.SEND_AS]: 'TO', [E.ACTIVE]: true, [E.ROLE]: 'REVIEWER' },
    { [E.RECIPIENT_ID]: 'E2', [E.EMAIL]: 'only-official@example.invalid', [E.DISPLAY_NAME]: '只收正式', [E.STAGE]: 'OFFICIAL',
      [E.SEND_AS]: 'TO', [E.ACTIVE]: true, [E.ROLE]: '' }
  ]);
  const T = C.EMAIL_TEMPLATES;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_TEMPLATES));
  seedSheet(sc.ss, sc.S.EMAIL_TEMPLATES, Object.keys(T).map(() => ''), Object.keys(T).map((k) => T[k]),
    ['REVIEW', 'OFFICIAL', 'RESEND'].map((st) => ({ [T.TEMPLATE_ID]: 'T_' + st, [T.STAGE]: st, [T.LANG]: 'zh',
      [T.SUBJECT]: '職事表 ' + st, [T.BODY_HTML]: '<p>{{name}}</p>', [T.BODY_PLAIN]: '{{name}}', [T.ATTACH_TYPE]: 'NONE', [T.ACTIVE]: true })));
  gas.apiGenerateDraftExecute(sc.Q);
  return sc;
}

module.exports = { buildSendScene };
