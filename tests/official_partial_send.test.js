// 第六十三輪批次 F 組（＋ T 組第 1 點）：正式發出只揀部分人，畫面仍然講「已正式發出給全體」。
// 執行方式：node tests/official_partial_send.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 2026-09-03（2028T3）只寄 2／57 位；2026-10-20 瀏覽器實測（2028T2 v2）只揀 2 位：
//   ・結論：「2 位義工已收到通知，沒有任何一位是因為系統出錯而漏掉。」
//   ・狀態卡：「已正式發出給全體。」，「正式發出給全體」掣從此鎖死
//   ・確認框同一個畫面先寫「會寄給表上 59 個人中的 52 人」，再寫「會寄給這 2 位」
//   ・之後儲存咗第 3 版（未寄），狀態卡仍然只寫「已正式發出給全體。目前第 3 版」
// 其餘 55 位只能靠「補寄未收到的人」，但畫面完全冇提示要去嗰度。
//
// T 組第 1 點：三種寄出嘅確認框都要列「附件：…」「日曆檔：附／不附」。
//
// ⚠️ 唔改 Stage 前進規則（Ivan 嘅決定）——呢組只改提示。

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
const Q = '2099T2';
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const L = gas.COLUMNS.SEND_LOG;

const PEOPLE = {
  P9501: { personId: 'P9501', nameTC: '假一', email: 'p1@example.invalid' },
  P9502: { personId: 'P9502', nameTC: '假二', email: 'p2@example.invalid' },
  P9503: { personId: 'P9503', nameTC: '假三', email: 'p3@example.invalid' },
  P9504: { personId: 'P9504', nameTC: '假四', email: 'p4@example.invalid' },
  P9505: { personId: 'P9505', nameTC: '假五', email: '' }
};
function cell(v, personId) {
  const r = {}; r[A.QUARTER_ID] = Q; r[A.VERSION_NO] = v; r[A.PERSON_ID] = personId; return r;
}
function log(v, personId, status) {
  const r = {}; r[L.QUARTER_ID] = Q; r[L.STAGE] = 'OFFICIAL'; r[L.VERSION_NO] = v;
  r[L.PERSON_ID] = personId; r[L.STATUS] = status; return r;
}
gas.indexPeopleById_ = function () { return PEOPLE; };
gas.log_ = function () {};
gas.getConfig_ = function (_k, d) { return d; };
gas.readSheet_ = function (name) {
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) {
    return ['P9501', 'P9502', 'P9503', 'P9504', 'P9505'].map(function (id) { return cell(2, id); })
      .concat([cell(1, 'P9599')]);
  }
  if (name === gas.SHEETS.SEND_LOG) {
    return [log(1, 'P9501', 'DRY_RUN'), log(2, 'P9502', 'SENT'), log(2, 'P9503', 'FAILED')];
  }
  return [];
};

// =====================================================================
console.log('\n=== F【核心】應收幾多位、已經收咗幾多位 ===');
const reach = gas.countOfficialReach_(Q, 2);
{
  check('★★★★★ 應收 ＝ 這一版有派工而且有電郵（4 位；冇電郵嗰位唔計）', reach.expected === 4, JSON.stringify(reach));
  check('★★★★★ 已收 ＝ 任何一個版本 SENT／DRY_RUN（2 位；FAILED 唔算）', reach.reached === 2, JSON.stringify(reach));
  check('★★★★ 未寄 ＝ 2', reach.notReached === 2);
}

console.log('\n=== F2：完成結論分開講「這次」同「應收／未寄」===');
{
  const s = gas.buildStep4OutcomeSentence_({ sent: 0, dryRun: 2, skipped: 0, isDryRun: true }, reach);
  check('★★★★★ 保留原本嗰句', /2 位義工已模擬通知/.test(s), s);
  check('★★★★★★ 加埋「應收 4 位、還有 2 位未寄」同去邊度補',
    /應收 4 位/.test(s) && /還有 2 位未寄/.test(s) && /補寄未收到的人/.test(s), s);
  const full = gas.buildStep4OutcomeSentence_({ sent: 4, dryRun: 0, skipped: 0 },
    { expected: 4, reached: 4, notReached: 0 });
  check('★★★★ 全部收齊 ⇒ 唔加嗰句', !/未寄/.test(full), full);
  check('★★★★ 數唔到（null）⇒ 同改之前一樣', !/未寄/.test(
    gas.buildStep4OutcomeSentence_({ sent: 2, dryRun: 0, skipped: 0 }, null)));
  check('★★★★★ executeStep4Send_() 有數並傳落去',
    /result\.officialReach = countOfficialReach_\(quarterId, versionNo\)/.test(read('src/FiveStageCore.gs'))
    && /buildStep4OutcomeSentence_\(result, result\.officialReach\)/.test(read('src/FiveStageCore.gs')));
}

console.log('\n=== F3／F5：狀態卡 ===');
{
  const S = gas.QUARTER_STAGE;
  const partial = gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, '',
    { officialReach: { expected: 57, reached: 2, notReached: 55 }, unsentWarn: '' });
  check('★★★★★★ 「已正式發出：2／57 位」＋ 指去補寄',
    /^已正式發出：2／57 位。/.test(partial) && /55 位未收到/.test(partial) && /補寄未收到的人/.test(partial), partial);
  const full = gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, '',
    { officialReach: { expected: 57, reached: 57, notReached: 0 }, unsentWarn: '' });
  check('★★★★ 收齊 ⇒「已正式發出給全體（57／57 位）。」', full === '已正式發出給全體（57／57 位）。', full);
  check('★★★★ 冇額外資料 ⇒ 同改之前一樣', gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, '') === '已正式發出給全體。');
  const unsent = gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, '',
    { officialReach: null, unsentWarn: '⚠️ 目前是第 3 版，這一版未寄過給任何人。' });
  check('★★★★★★ 最新一版未寄過 ⇒ 加嗰句（重用 buildSendHistoryView_ 嘅 warnSentence）',
    unsent === '已正式發出給全體。 ⚠️ 目前是第 3 版，這一版未寄過給任何人。', unsent);

  gas.buildSendHistoryView_ = function () {
    return { batches: [{ sent: 2 }], warnSentence: '⚠️ 目前是第 3 版，這一版未寄過給任何人。' };
  };
  const ex = gas.readDashboardStatusExtras_(Q, 3, S.OFFICIAL_SENT, true);
  check('★★★★★ readDashboardStatusExtras_() 帶出 warnSentence 同人數',
    ex.unsentWarn === '⚠️ 目前是第 3 版，這一版未寄過給任何人。' && ex.officialReach !== null, JSON.stringify(ex));
  gas.buildSendHistoryView_ = function () { return { batches: [], warnSentence: '⚠️ 目前是第 0 版，這一版未寄過給任何人。' }; };
  check('★★★★ 從來未寄過 ⇒ 唔加（唔係「最新 ＞ 最後一次寄出」）',
    gas.readDashboardStatusExtras_(Q, 0, S.DRAFT, true).unsentWarn === '');
  check('★★★★ apiGetDashboardState 用 readDashboardStatusExtras_()',
    /buildDashboardStatusText_\(stage, versionExists, generateOnText,\s*readDashboardStatusExtras_\(/.test(read('src/WebAppDashboard.gs')));
}

console.log('\n=== F1／F4／T1：正式發出確認框 ===');
{
  gas.requireQuarterStage_ = function () {};
  gas.countAlreadySentForStage_ = function () { return 0; };
  gas.buildMailContext_ = function () { return {}; };
  gas.resolveStageTemplates_ = function () { return { person: { attachType: 'PERSONAL_PDF' }, list: null }; };
  const everyone = Object.keys(PEOPLE).filter(function (id) { return PEOPLE[id].email; }).map(function (id) {
    return { type: 'PERSON', personId: id, email: PEOPLE[id].email, displayName: PEOPLE[id].nameTC };
  });
  gas.resolveActualRecipientsFromContext_ = function (ctx, stage, opts) {
    return opts && opts.recipientScope === 'PICK' ? everyone.slice(0, 2) : everyone;
  };
  const picked = gas.planStep4SendPreview_(Q, 2,
    { recipientScope: 'PICK', pickedKeys: ['P9501', 'P9502'], attachType: 'FULL_PDF', includeIcs: false });
  check('★★★★★★ 揀中 2／4 ⇒ partial，警告講明鎖住同去補寄',
    picked.partial === true && picked.partialWarning === '你只選了 2／4 位。寄出後「正式發出給全體」會鎖住，其餘 2 位要用「補寄未收到的人」。',
    JSON.stringify(picked).slice(0, 400));
  check('★★★★★ T1：附件跟幹事揀嘅（整季 PDF），唔係寫死個人版',
    /^附件：整季 PDF——/.test(picked.contents.attachLine), picked.contents.attachLine);
  check('★★★★★ T1：日曆檔「不附」', picked.contents.icsLine === '日曆檔：不附', picked.contents.icsLine);
  const all = gas.planStep4SendPreview_(Q, 2, null);
  check('★★★★ 冇揀人 ⇒ 唔係 partial', all.partial === false && all.partialWarning === '');
  check('★★★★ 預設 ⇒ 個人版 PDF ＋ 附 .ics',
    /^附件：個人版 PDF——/.test(all.contents.attachLine) && all.contents.icsLine === '日曆檔：附 .ics 日曆檔', JSON.stringify(all.contents));

  const ui = read('src/ui/ScriptZone1.html');
  check('★★★★★★ F4：partial 嗰陣唔再顯示「會寄給表上 M 個人中的 X 人」',
    /sectionTitle\(preview\.partial\s*\? '這一次寄出的內容'\s*: \('會寄給表上 '/.test(ui));
  check('★★★★★ F1：畫面顯示 partialWarning', /text: preview\.partialWarning/.test(ui));
  check('★★★★★ T1：審閱、正式、重發三個確認框都列附件同日曆檔',
    /if \(preview\.contents\) nodes\.push\(sendContentsBox\(preview\.contents\)\)/.test(ui)
    && /preview\.contents\.attachLine, preview\.contents\.icsLine/.test(ui)
    && /if \(plan\.contents\) nodes\.push\(sendContentsBox\(plan\.contents\)\)/.test(ui));
  check('★★★★ 審閱同重發嘅 plan 都帶 contents',
    /contents: describeConfirmContents_\(MAIL_STAGES\.REVIEW, sendOptions\)/.test(read('src/FiveStageCore.gs'))
    && /contents: describeConfirmContents_\(MAIL_STAGES\.RESEND, sendOptions\)/.test(read('src/WebAppFlow.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
