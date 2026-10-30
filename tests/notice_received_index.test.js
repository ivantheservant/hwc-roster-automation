// 第六十五輪批次 X 組：「收過沒有」有兩個不同定義。
// 執行方式：node tests/notice_received_index.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 回歸測試 R4.20、R4.21，`2028T2`）
// ═════════════════════════════════════════════════════════════════════
//
//   兩位剛經「改動後重發」收到第 3 版（`RESEND`，`DRY_RUN`）。
//   補寄預覽仍然把佢哋列為「還沒有收到」——預覽自己寫「任何一版收過都算已經收到」。
//   照撳的話佢哋會收到兩次第 3 版。狀態卡亦唔把佢哋算作已收。
//
// 成因：補寄（`buildSendStatusByRecipient_()`）同狀態卡（`countOfficialReach_()`）
// 各自只睇 `OFFICIAL`。改動後重發嘅信包含收件人這一季全部安排同個人 PDF，
// 所以對「正式發出」而言，收過 `RESEND` 就等於收過通知。
//
// 下面用假 ID（P94xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'WebAppGuards.gs',
  'SendOptions.gs', 'PersonalLinkInMail.gs', 'SendRecipients.gs', 'WebAppSendPlan.gs',
  'FiveStageCore.gs', 'WebAppDashboard.gs', 'MakeupSend.gs'
]);

const Q = '2099T4';
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const L = gas.COLUMNS.SEND_LOG;
const S = gas.MAIL_STAGES;

const PEOPLE = {
  P9401: { personId: 'P9401', nameTC: '假甲', email: 'a@example.invalid' },
  P9402: { personId: 'P9402', nameTC: '假乙', email: 'b@example.invalid' },
  P9403: { personId: 'P9403', nameTC: '假丙', email: 'c@example.invalid' }
};
const RECIPIENTS = Object.keys(PEOPLE).map(function (id) {
  return { type: 'PERSON', personId: id, email: PEOPLE[id].email, displayName: PEOPLE[id].nameTC };
});
function cell(personId) {
  const r = {}; r[A.QUARTER_ID] = Q; r[A.VERSION_NO] = 3; r[A.PERSON_ID] = personId; return r;
}
function log(stage, v, personId, status) {
  const r = {}; r[L.QUARTER_ID] = Q; r[L.STAGE] = stage; r[L.VERSION_NO] = v;
  r[L.PERSON_ID] = personId; r[L.STATUS] = status; r[L.EMAIL] = ''; return r;
}
let SEND_LOG = [];
gas.indexPeopleById_ = function () { return PEOPLE; };
gas.log_ = function () {};
gas.getConfig_ = function (_k, d) { return d; };
gas.buildMailContext_ = function () { return {}; };
gas.listRecipients_ = function () { return RECIPIENTS; };
gas.findEmailTemplate_ = function () { return { attachType: 'NONE' }; };
gas.readSheet_ = function (name) {
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return ['P9401', 'P9402', 'P9403'].map(cell);
  if (name === gas.SHEETS.SEND_LOG) return SEND_LOG;
  return [];
};
const keysOf = function (list) { return list.map(function (r) { return r.personId; }).sort(); };

// =====================================================================
console.log('\n=== X【核心】OFFICIAL 寄咗甲；改動後重發寄咗乙 ⇒ 補寄唔列甲、乙 ===');
{
  SEND_LOG = [log(S.OFFICIAL, 2, 'P9401', 'DRY_RUN'), log(S.RESEND, 3, 'P9402', 'DRY_RUN')];
  const plan = gas.planMakeupSend_(Q, 3, S.OFFICIAL);
  check('★★★★★★ 乙（只喺改動後重發收過）**唔喺**補寄名單'
    + '——現場就係佢都喺「還沒有收到」，照撳會收兩次第 3 版',
    keysOf(plan.needsResend).indexOf('P9402') === -1, JSON.stringify(keysOf(plan.needsResend)));
  check('★★★★★ 甲（正式發出收過）亦唔喺', keysOf(plan.needsResend).indexOf('P9401') === -1);
  check('★★★★★ 丙（從來未收過）仍然要補寄', JSON.stringify(keysOf(plan.needsResend)) === '["P9403"]',
    JSON.stringify(keysOf(plan.needsResend)));
  const b = plan.alreadySent.filter(function (r) { return r.personId === 'P9402'; })[0];
  check('★★★★★ 預覽講明係邊一次收過（「改動後重發」收到第 3 版）',
    b && /改動後重發/.test(b.reason) && /第 3 版/.test(b.reason), JSON.stringify(b));
}

console.log('\n=== X【核心】狀態卡已收 ＝ 2（同補寄同一個定義） ===');
{
  const reach = gas.countOfficialReach_(Q, 3);
  check('★★★★★★ 應收 3、已收 2（甲、乙）、未寄 1',
    reach.expected === 3 && reach.reached === 2 && reach.notReached === 1, JSON.stringify(reach));
  SEND_LOG = [log(S.OFFICIAL, 2, 'P9401', 'DRY_RUN'), log(S.RESEND, 3, 'P9402', 'SKIPPED_UNCHANGED'),
    log(S.RESEND, 3, 'P9403', 'FAILED')];
  const r2 = gas.countOfficialReach_(Q, 3);
  check('★★★★ SKIPPED_UNCHANGED 算收過；FAILED 唔算', r2.reached === 2, JSON.stringify(r2));
}

console.log('\n=== X：審閱信嘅補寄只睇審閱 ===');
{
  SEND_LOG = [log(S.RESEND, 3, 'P9401', 'DRY_RUN'), log(S.OFFICIAL, 3, 'P9402', 'DRY_RUN'),
    log(S.REVIEW, 1, 'P9403', 'SENT')];
  const plan = gas.planMakeupSend_(Q, 3, S.REVIEW);
  check('★★★★★ 改動後重發／正式發出收過，唔等於收過審閱信',
    JSON.stringify(keysOf(plan.needsResend)) === '["P9401","P9402"]', JSON.stringify(keysOf(plan.needsResend)));
  const off = gas.planMakeupSend_(Q, 3, S.OFFICIAL);
  check('★★★★★ 收過審閱信唔等於收過正式通知', keysOf(off.needsResend).indexOf('P9403') !== -1);
}

console.log('\n=== X：三處都經同一支函式 ===');
{
  const core = read('src/FiveStageCore.gs');
  const fn = core.slice(core.indexOf('function countOfficialReach_('), core.indexOf('function describeOfficialShortfall_('));
  check('★★★★★ countOfficialReach_() 用 buildQuarterNoticeReceivedIndex_()，唔再自己睇 OFFICIAL',
    /buildQuarterNoticeReceivedIndex_\(quarterId, MAIL_STAGES\.OFFICIAL\)/.test(fn)
      && fn.indexOf('L.STAGE') === -1, fn.slice(0, 400));
  const mk = read('src/MakeupSend.gs').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('★★★★★ planMakeupSend_()、executeMakeupSend_() 都用佢',
    /buildQuarterNoticeReceivedIndex_\(quarterId, stage\)/.test(mk)
      && /buildQuarterNoticeReceivedIndex_\(plan\.quarterId, plan\.stage\)/.test(mk));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
