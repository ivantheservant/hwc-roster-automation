// 第六十三輪批次 P 組：改動後重發漏咗「被整個換走」嘅人。
// 執行方式：node tests/resend_dropped_person.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 瀏覽器實測，`2028T2`）
// ═════════════════════════════════════════════════════════════════════
//
//   第 2 版　正式發出（模擬）給 P0005、P0011
//   第 3 版　P0011 嘅兩格（05-14、06-11 領詩）換咗畀 P0028、P0050
//           ⇒ P0011 呢一版 0 格
//
// 寄出彈窗 ▸ 選擇收件人：
//
//   「同 第 2 版……比較，有 **3** 位的安排改過」
//   「只寄給安排有改動的人（**2** 位）」
//
// P0011 唔喺名單入面，揀都揀唔到——佢永遠收唔到「你嗰兩格已經改由
// 別人負責」，當日照樣出現。
//
// 下面用假 ID（P91xx），唔用真資料。

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
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'FineTune.gs',
  'WebAppGuards.gs', 'SendOptions.gs', 'SendRecipients.gs', 'Mailer.gs',
  'RosterWriter.gs', 'WebAppSendPlan.gs', 'ResendFlow.gs'
]);

const Q = '2099T2';
const TZ = 'Pacific/Auckland';
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const L = gas.COLUMNS.SEND_LOG;

const PEOPLE = {
  P9105: { personId: 'P9105', nameTC: '假甲', email: 'p9105@example.invalid' },
  P9111: { personId: 'P9111', nameTC: '假乙', email: 'p9111@example.invalid' },
  P9128: { personId: 'P9128', nameTC: '假丙', email: 'p9128@example.invalid' },
  P9150: { personId: 'P9150', nameTC: '假丁', email: 'p9150@example.invalid' }
};

function cell(v, date, post, personId) {
  const r = {};
  r[A.QUARTER_ID] = Q; r[A.VERSION_NO] = v; r[A.SERVICE_DATE] = date;
  r[A.POST_ID] = post; r[A.SLOT_INDEX] = 1; r[A.PERSON_ID] = personId;
  r[A.PERSON_NAME_SNAPSHOT] = PEOPLE[personId].nameTC;
  return r;
}
const ASSIGNMENTS = [
  cell(2, '2099-04-05', 'CHAIR', 'P9105'),
  cell(2, '2099-05-10', 'WORSHIP', 'P9111'),
  cell(2, '2099-06-07', 'WORSHIP', 'P9111'),
  cell(3, '2099-04-05', 'CHAIR', 'P9105'),
  cell(3, '2099-05-10', 'WORSHIP', 'P9128'),
  cell(3, '2099-06-07', 'WORSHIP', 'P9150')
];
function logRow(personId) {
  const r = {};
  r[L.QUARTER_ID] = Q; r[L.STAGE] = gas.MAIL_STAGES.OFFICIAL; r[L.VERSION_NO] = 2;
  r[L.SENT_AT] = '2099-03-01T08:14:00Z'; r[L.STATUS] = gas.MAIL_STATUS.DRY_RUN;
  r[L.PERSON_ID] = personId;
  return r;
}

gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};
gas.readRolesSafe_ = function () { return []; };
gas.getConfig = function (_k, d) { return d; };
gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    return fmt === 'yyyy-MM-dd' ? d : d + ' 08:14';
  },
  computeDigest: function (algo, input) {
    return Array.from(require('crypto').createHash('sha256').update(String(input), 'utf8').digest());
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' }
};
gas.toDateString = function (v) { return String(v); };
gas.findLatestVersionNo = function () { return 3; };
gas.indexPeopleById_ = function () { return PEOPLE; };
gas.readSheet = function (name) {
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return ASSIGNMENTS;
  if (name === gas.SHEETS.SEND_LOG) return [logRow('P9105'), logRow('P9111')];
  return [];
};
// 第 3 版嘅 context：P9111 一格都冇
function v3Context() {
  return {
    quarterId: Q, versionNo: 3, stage: gas.MAIL_STAGES.RESEND, timezone: TZ,
    peopleById: PEOPLE,
    assignmentsByPerson: {
      P9105: [{ serviceDate: '2099-04-05', postId: 'CHAIR' }],
      P9128: [{ serviceDate: '2099-05-10', postId: 'WORSHIP' }],
      P9150: [{ serviceDate: '2099-06-07', postId: 'WORSHIP' }]
    },
    lastHashByPerson: { P9105: 'h-a', P9111: 'h-b' },
    lastSummaryByPerson: { P9111: '10/05 領詩；07/06 領詩' },
    notifyReasonByPerson: {}
  };
}
gas.buildMailContext_ = function () { return v3Context(); };

// =====================================================================
console.log('\n=== P1【核心】被整個換走嘅人喺收件人池入面 ===');
const res = gas.apiGetSendRecipientPool(Q);
const byKey = {};
(res.items || []).forEach(function (p) { byKey[p.key] = p; });
{
  check('（前置）有基準（第 2 版正式發出）', res.ok && res.changed.hasBaseline
    && res.changed.baselineVersionNo === 2, JSON.stringify(res.changed || res).slice(0, 300));
  check('（前置）句子講「有 3 位的安排改過」', res.changed.changedCount === 3, res.changed.sentence);
  check('★★★★★★ P9111（呢一版 0 格）喺池入面'
    + '——現場就係揀都揀唔到，佢永遠收唔到「你嗰兩格已經改由別人負責」',
    !!byKey.P9111, JSON.stringify(Object.keys(byKey)));
  check('★★★★★ 而且帶住 CHANGED 標記同改咗乜',
    byKey.P9111 && byKey.P9111.sources.indexOf('CHANGED') !== -1
    && (byKey.P9111.changeNotes || []).length === 2, JSON.stringify(byKey.P9111));
  check('★★★★ 格數係 0，畫面要寫「這一版沒有任何安排」',
    byKey.P9111 && byKey.P9111.cellCount === 0 && byKey.P9111.noAssignmentThisVersion === true);
  check('★★★★ 有電郵 ⇒ 勾得到', byKey.P9111 && byKey.P9111.selectable === true);
  const g = res.groups.filter(function (x) { return x.key === 'CHANGED'; })[0];
  check('★★★★★★ 「只寄給安排有改動的人」嗰組有 3 位，同句子嘅「3 位」一致',
    g && g.total === 3 && g.selectable === 3, JSON.stringify(g));
  check('★★★★ 一個人唔會出現兩次',
    res.items.filter(function (p) { return p.key === 'P9111'; }).length === 1);
}

console.log('\n=== P1：冇電郵 ⇒ 照現有規則勾唔到 ===');
{
  const pool = [];
  const added = gas.addChangedPersonsMissingFromPool_(pool,
    { P9199: ['5 月 10 日　領詩（換走了，改為 假丙）'] },
    { P9199: { personId: 'P9199', nameTC: '假戊', email: '' } });
  check('★★★★ 加咗入池', added.length === 1 && pool.length === 1);
  check('★★★★★ 但勾唔到（selectable: false）',
    pool[0].selectable === false && pool[0].hasEmail === false);
  check('★★★★ 已經喺池入面嘅人唔會再加',
    gas.addChangedPersonsMissingFromPool_([{ personId: 'P9199', key: 'P9199' }],
      { P9199: ['x'] }, {}).length === 0);
}

console.log('\n=== P1【核心】揀「只寄給安排有改動的人」⇒ 真正寄嘅名單有佢 ===');
{
  // 畫面勾一組嘅做法：把嗰組勾得到嘅人全部放入 pickedKeys
  const picked = {};
  res.items.forEach(function (p) {
    if (p.selectable && p.sources.indexOf('CHANGED') !== -1) picked[p.key] = true;
  });
  const decision = { recipientScope: gas.SEND_RECIPIENT_SCOPE.PICK, pickedKeys: picked, extraEmails: [] };
  const changedIds = gas.computeResendDiff_(v3Context()).map(function (c) { return c.personId; });
  check('（前置）computeResendDiff_() 本來就認到 P9111（後端一直支持）',
    changedIds.indexOf('P9111') !== -1, JSON.stringify(changedIds));
  const targets = gas.resolveResendTargetPersonIds_(v3Context(), decision, changedIds, true);
  check('★★★★★★ resolveResendTargetPersonIds_() 結果包括 P9111',
    targets.indexOf('P9111') !== -1, JSON.stringify(targets));
}

console.log('\n=== P2：完成訊息列出零派工而又收到通知嘅人 ===');
{
  const ctx = v3Context();
  const changedList = gas.computeResendDiff_(ctx);
  const listed = gas.listZeroAssignmentResendTargets_(changedList, ['P9111', 'P9128'], ctx);
  check('★★★★★ 會寄 ⇒ 列出，而且帶住原本嘅安排',
    listed.length === 1 && listed[0].personId === 'P9111'
    && listed[0].previousSummary === '10/05 領詩；07/06 領詩', JSON.stringify(listed));
  check('★★★★★ 冇揀佢（唔會寄）⇒ **唔列**——唔可以話「已通知」一個冇寄過嘅人',
    gas.listZeroAssignmentResendTargets_(changedList, ['P9128'], ctx).length === 0);

  const flow = read('src/WebAppFlow.gs');
  check('★★★★ apiStep5SendConfirm() 回傳 zeroAssignmentPeople',
    /zeroAssignmentPeople: zeroAssignmentPeople/.test(flow));
  check('★★★★ 而且係喺寄之前、用同一個收件人解析器計',
    /resolveActualRecipientsFromContext_\(\s*changed\.context, MAIL_STAGES\.RESEND/.test(flow)
    && flow.indexOf('listZeroAssignmentResendTargets_(') < flow.indexOf('const sendResult = executeStep5Send_('));
}

console.log('\n=== P：畫面文字 ===');
{
  const send = read('src/ui/ScriptSendPaper.html');
  const zone1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 揀人畫面：名字旁邊寫「這一版沒有任何安排」',
    /c\.noAssignmentThisVersion \? '（這一版沒有任何安排）'/.test(send));
  // ⚠️ 收窄到「安排有改動」嗰段嘅 `text: '現在：' + (…)`——第六十三輪批次 R 組
  // 第二段（上次冇收到）都有一句類似嘅字，闊鬆嘅寫法會被嗰句配中而永遠綠。
  check('★★★★★ 確認框：零派工嘅人「現在：這一季沒有安排」',
    /text: '現在：' \+ \(c\.hasAssignments === false\s*\? '這一季沒有安排'/.test(zone1));
  check('★★★★★ 完成訊息：逐個列出「原本：…／現在：這一季沒有安排」',
    /result\.zeroAssignmentPeople/.test(zone1) && /'／現在：這一季沒有安排'/.test(zone1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
