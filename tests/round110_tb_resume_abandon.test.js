// 第一百一十輪批次 TB 組：續寄的兩個小修正
//   TB-1：「寄送批次」AuditLog 的寄送選項說明——值和預設相同就不寫「（幹事改過）」（續寄同樣）
//   TB-2：〔不再繼續這一批〕之後，Quarters.Stage 和狀態卡、〔給所有人〕把關、〔變動的人〕一致
// 執行方式：node tests/round110_tb_resume_abandon.test.js
// 下面用假 ID（P96xx）、example.invalid。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 800));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'Roles.gs', 'WebAppGuards.gs', 'SendOptions.gs',
  'MailRedirect.gs', 'EmailRecipientsSeed.gs', 'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'FiveStageCore.gs',
  'PersonalLinkInMail.gs', 'SendBatch.gs', 'MakeupSend.gs'
]);

const TPL = {
  REVIEW: { person: { attachType: 'FULL_PDF' }, list: null },
  OFFICIAL: { person: { attachType: 'PERSONAL_PDF' }, list: { attachType: 'FULL_PDF' } }
};
const markCount = (t) => (t.match(/（幹事改過）/g) || []).length;

console.log('\n=== TB-1 寄送選項說明：值等於預設就不寫「幹事改過」 ===');
{
  const keys = ['P9601', 'P9602', 'P9603'];
  // 寄出窗〔給所有人〕實際傳入的（見 ScriptSendPaper.html renderSendMain()：值就是後端預設）
  const dialog = { recipientScope: 'PICK', sendMode: 'ALL', pickedKeys: keys, attachType: 'PERSONAL_PDF', includeIcs: true };
  const t1 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL', dialog, TPL.OFFICIAL));
  check('★★★★★★ 〔給所有人〕用預設附件及日曆檔 ⇒ 沒有任何「（幹事改過）」', markCount(t1) === 0, t1);
  check('★★★★★ 收件範圍寫按鈕名稱及人數', t1.indexOf('收件範圍=給所有人（3 位）') !== -1, t1);
  check('★★★★ 附件、日曆檔照寫', /附件=個人版 PDF　日曆檔=有/.test(t1), t1);

  // 續寄：apiContinueSendBatch() 用批次紀錄存下的寄送選項（sanitizeSendBatchOptions_()）＋resumeBatchId
  const stored = gas.sanitizeSendBatchOptions_(Object.assign({}, dialog, { resumeBatchId: 'SB-X' }));
  const t2 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL',
    Object.assign({}, stored, { resumeBatchId: 'SB-X' }), TPL.OFFICIAL));
  check('★★★★★★ 續寄完成時的說明和第一次寄出時一字不差（第一次是預設就寫預設）', t2 === t1, t1 + '\n' + t2);

  const t3 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL',
    Object.assign({}, dialog, { attachType: 'NONE' }), TPL.OFFICIAL));
  check('★★★★★ 幹事真的改了附件 ⇒ 只有附件寫「（幹事改過）」', markCount(t3) === 1 && /附件=不附（幹事改過）/.test(t3), t3);
  const t4 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL',
    Object.assign({}, dialog, { includeIcs: false }), TPL.OFFICIAL));
  check('★★★★★ 幹事真的拿走日曆檔 ⇒ 只有日曆檔寫「（幹事改過）」', markCount(t4) === 1 && /日曆檔=沒有（幹事改過）/.test(t4), t4);

  const t5 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL',
    { recipientScope: 'PICK', sendMode: 'PICK', pickedKeys: ['P9601'], attachType: 'PERSONAL_PDF', includeIcs: true }, TPL.OFFICIAL));
  check('★★★★ 〔選擇其他〕＝幹事自己選人 ⇒ 收件範圍仍然標明', /收件範圍=自己選擇（1 位）（幹事改過）/.test(t5) && markCount(t5) === 1, t5);

  const t6 = gas.describeSendDecision_(gas.resolveSendOptions_('REVIEW',
    { recipientScope: 'PICK', sendMode: 'COMMITTEE', pickedKeys: keys, attachType: 'FULL_PDF', includeIcs: false }, TPL.REVIEW));
  check('★★★★ 〔寄給堂委／執事〕用預設 ⇒ 沒有「幹事改過」', markCount(t6) === 0 && t6.indexOf('寄給堂委／執事（3 位）') !== -1, t6);

  const t7 = gas.describeSendDecision_(gas.resolveSendOptions_('OFFICIAL', null, TPL.OFFICIAL));
  check('★★★★ 沒有傳入任何選項（自動排程等）⇒ 照舊寫「全部應收的人」、沒有「幹事改過」',
    markCount(t7) === 0 && t7.indexOf('收件範圍=全部應收的人') !== -1, t7);
}

// ── TB-2 用的模擬環境（照 round109_sa_send_budget.test.js）──
const Q = '2028T3';
const C = gas.COLUMNS.SEND_LOG;
let LOG = [];
let AUDIT = [];
let budget = 120;
let stage = 'DRAFT';
let stageCalls = [];
let recipients = [];
let stamp = 0;

function busyWait(ms) { const t = Date.now(); while (Date.now() - t < ms) { /* 模擬每封的時間 */ } }

function setup(n) {
  LOG = []; AUDIT = []; budget = 120; stamp = 0; stage = 'DRAFT'; stageCalls = [];
  gas.SEND_BATCH_MEMORY_STORE_ = null;
  recipients = [];
  for (let i = 1; i <= n; i++) {
    recipients.push({ type: 'PERSON', personId: 'P96' + String(i).padStart(2, '0'), email: 'p' + i + '@example.invalid', displayName: '測試' + i });
  }
  gas.getConfig_ = function (k, d) {
    if (k === gas.CONFIG_KEYS.SEND_TIME_BUDGET_MS) return budget;
    if (k === gas.CONFIG_KEYS.DRY_RUN) return true;
    return d;
  };
  gas.compactTimestamp_ = function () { stamp++; return '20281117' + String(stamp).padStart(6, '0'); };
  gas.assertNotPreviewMode_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.withMutationLock_ = function (label, fn) { return fn(); };
  gas.clearDashboardCountsCache_ = function () {};
  gas.ensurePublicLinkFreshBeforeSend_ = function () { return { republished: false }; };
  gas.resolveMailAttachmentFolder_ = function () {};
  gas.assertPublicRosterUrlAvailableForStage_ = function () {};
  gas.resolveStageTemplates_ = function () { return { person: { attachType: 'NONE' }, list: null }; };
  gas.buildMailContext_ = function (q, v, st) { return { quarterId: q, versionNo: v, stage: st, placeholders: {} }; };
  gas.resolveSendRecipientPool_ = function () { return recipients.slice(); };
  gas.filterRecipientsByScope_ = function (p) { return p; };
  gas.listRecipients_ = function () { return recipients.slice(); };
  gas.findEmailTemplate_ = function () { return { attachType: 'NONE' }; };
  gas.deliverOne_ = function (r) {
    busyWait(25);
    return { personId: r.personId, email: r.email, displayName: r.displayName, status: 'DRY_RUN', recipientType: 'PERSON' };
  };
  gas.writeSendLogRows_ = function (outs, ctx) {
    outs.forEach(function (o) {
      const row = {};
      row[C.QUARTER_ID] = ctx.quarterId; row[C.VERSION_NO] = ctx.versionNo; row[C.STAGE] = ctx.stage;
      row[C.PERSON_ID] = o.personId; row[C.EMAIL] = o.email; row[C.DISPLAY_NAME] = o.displayName;
      row[C.STATUS] = o.status; row[C.SENT_AT] = new Date(); row[C.SEND_BATCH_ID] = ctx.sendBatchId || '';
      LOG.push(row);
    });
    return outs.length;
  };
  gas.readSheet_ = function (name) { return name === gas.SHEETS.SEND_LOG ? LOG : []; };
  gas.planSendLogColumnBackfill_ = function () { return { sheetExists: true, missing: [] }; };
  gas.writeAuditLog_ = function (e) { AUDIT.push(e); };
  gas.notifyAdminNoEmailIfEnabled_ = function () {};
  gas.log_ = function () {};
  gas.findLatestVersionNo_ = function () { return 0; };
  gas.requireQuarterStage_ = function () {};
  gas.checkMissingPersonalPdfs_ = function () { return {}; };
  gas.evaluateStep4MissingPdfGate_ = function () { return { blocked: false }; };
  gas.countOfficialReach_ = function () { return null; };
  gas.getQuarterStage_ = function () { return stage; };
  gas.advanceQuarterStage_ = function (q, s) { stageCalls.push('advance:' + s); stage = s; };
  gas.setQuarterStage_ = function (q, s) { stageCalls.push('set:' + s); stage = s; };
  gas.tryCreateEditableCopyAfterSend_ = function () { return null; };
  gas.AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;
  gas.assertOfficialNotFromAutomationTrigger_ = function () {};
}

function startPartialOfficial(n) {
  setup(n);
  const r = gas.sendStage_(Q, 0, gas.MAIL_STAGES.OFFICIAL, {}, true);
  return r;
}

console.log('\n=== TB-2 純函式：放棄之後的進度 ===');
{
  const S = gas.QUARTER_STAGE;
  const K = gas.SEND_BATCH_KIND;
  const off = { kind: K.STAGE, stage: gas.MAIL_STAGES.OFFICIAL };
  const p0 = gas.planStageAfterAbandonedBatch_(off, S.DRAFT, 0, 0);
  check('★★★★★★ 正式發出一位都未寄就放棄 ⇒ 進度不變', p0.newStage === '', JSON.stringify(p0));
  check('★★★★★ 而且說明可以再按〔給所有人〕', /可以再按第 3 步〔給所有人〕/.test(p0.message), p0.message);
  const p1 = gas.planStageAfterAbandonedBatch_(off, S.REVIEW_SENT, 15, 15);
  check('★★★★★★ 正式發出部分寄出後放棄 ⇒ 推進到 OFFICIAL_SENT', p1.newStage === S.OFFICIAL_SENT, JSON.stringify(p1));
  check('★★★★★ AuditLog 寫明「部分寄出後放棄，餘下 N 位請用〔補寄未收到的人〕」',
    p1.auditText === '部分寄出後放棄，餘下 {N} 位請用〔補寄未收到的人〕', p1.auditText);
  check('★★★★★ 說明告訴幹事下一步：補寄未收到的人', /補寄未收到的人/.test(p1.message), p1.message);
  check('★★★★ 已經是 OFFICIAL_SENT ⇒ 不再寫一次', gas.planStageAfterAbandonedBatch_(off, S.OFFICIAL_SENT, 3, 3).newStage === '');
  const rev = { kind: K.STAGE, stage: gas.MAIL_STAGES.REVIEW };
  check('★★★★ 審閱本部分寄出後放棄 ⇒ REVIEW_SENT（和全部寄完一樣）',
    gas.planStageAfterAbandonedBatch_(rev, S.DRAFT, 0, 4).newStage === S.REVIEW_SENT);
  check('★★★★ 審閱本：已正式發出 ⇒ 不退回', gas.planStageAfterAbandonedBatch_(rev, S.OFFICIAL_SENT, 9, 4).newStage === '');
  check('★★★★ 審閱本一位都未寄 ⇒ 不變', gas.planStageAfterAbandonedBatch_(rev, S.DRAFT, 0, 0).newStage === '');
  check('★★★★ 改動後重發本來就在 OFFICIAL_SENT ⇒ 不變',
    gas.planStageAfterAbandonedBatch_({ kind: K.RESEND, stage: gas.MAIL_STAGES.RESEND }, S.OFFICIAL_SENT, 9, 4).newStage === '');
}

console.log('\n=== TB-2 寄出部分後放棄：Stage、把關、補寄人數一致 ===');
{
  const r = startPartialOfficial(10);
  check('★★★★★ （前置）第一段未寄完', r.incomplete === true && r.processedTotal > 0 && r.processedTotal < 10, JSON.stringify(r));
  const sentCount = r.processedTotal;
  const res = gas.apiAbandonSendBatch(r.batchId);
  check('★★★★★★ 放棄之後 Stage＝OFFICIAL_SENT（用 advanceQuarterStage_，AuditLog 有「Stage 前進」）',
    stage === 'OFFICIAL_SENT' && stageCalls.join() === 'advance:OFFICIAL_SENT', stageCalls.join());
  check('★★★★★ 回傳說明有餘下人數及〔補寄未收到的人〕',
    res.ok && res.message.indexOf('餘下 ' + (10 - sentCount) + ' 位') !== -1 && /補寄未收到的人/.test(res.message), res.message);
  const ab = AUDIT.filter((a) => a.action === 'SEND_BATCH_ABANDONED');
  check('★★★★★ AuditLog：部分寄出後放棄，餘下 N 位',
    ab.length === 1 && ab[0].newValue === '部分寄出後放棄，餘下 ' + (10 - sentCount) + ' 位請用〔補寄未收到的人〕', JSON.stringify(ab));
  check('★★★★★ 未完成紀錄已清除', gas.readPendingSendBatch_() === null);
  let blocked = '';
  try { gas.assertNeverOfficiallySent_(Q); } catch (e) { blocked = e.message; }
  check('★★★★★ 〔給所有人〕把關仍然擋（和狀態卡一致：已經正式發出過）', /已經正式發出過了（寄出記錄有 \d+ 筆/.test(blocked), blocked);
  const plan = gas.planMakeupSend_(Q, 0, gas.MAIL_STAGES.OFFICIAL);
  check('★★★★★★ 〔補寄未收到的人〕列出的人數＝被放棄的餘下人數',
    plan.needsResend.length === 10 - sentCount && plan.alreadySent.length === sentCount,
    'needs=' + plan.needsResend.length + ' already=' + plan.alreadySent.length);
  const before = stage;
  budget = 600000;   // 補寄一次寄完（補寄的分段另有測試）
  gas.executeMakeupSend_(plan);
  check('★★★★★ 補寄之後每人都有紀錄，Stage 不變（補寄絕不改 Stage）',
    new Set(LOG.map((x) => x[C.PERSON_ID])).size === 10 && stage === before, LOG.length + ' ' + stage);
  check('★★★★ 補寄之後再算一次：沒有人未收到', gas.planMakeupSend_(Q, 0, gas.MAIL_STAGES.OFFICIAL).needsResend.length === 0);
}

console.log('\n=== TB-2 一位都未寄出就放棄：Stage 不變、可以再按〔給所有人〕 ===');
{
  setup(4);
  gas.setSendBatchEntry_('apiStep4Confirm');
  const b = gas.beginSendBatch_(gas.SEND_BATCH_KIND.STAGE, Q, 0, gas.MAIL_STAGES.OFFICIAL, recipients, {});
  // 第一段在寫 SendLog 之前出錯（例如逾時）⇒ 只有批次紀錄，沒有任何 SendLog
  const res = gas.apiAbandonSendBatch(b.id);
  check('★★★★★★ Stage 不變', stage === 'DRAFT' && stageCalls.length === 0, stageCalls.join());
  check('★★★★★ 說明：一位都還沒有寄出，可以再按〔給所有人〕', /一位都還沒有寄出/.test(res.message), res.message);
  let threw = '';
  try { gas.assertNeverOfficiallySent_(Q); } catch (e) { threw = e.message; }
  check('★★★★★★ 〔給所有人〕把關見 0 筆不會擋', threw === '', threw);
  const r = gas.sendStage_(Q, 0, gas.MAIL_STAGES.OFFICIAL, {}, true);
  check('★★★★★ 之後可以另開一批（沒有「上一次寄出還未完成」）', !!r && (r.incomplete === true || r.dryRun > 0), JSON.stringify(r).slice(0, 300));
}

console.log('\n=== TB-2 之後〔變動的人〕可以用（按鈕條件只看 Stage） ===');
{
  const dash = read('src/WebAppDashboard.gs');
  check('★★★★★ 〔變動的人〕的條件是 Stage＝OFFICIAL_SENT（放棄後推進了，所以可以用）',
    /const resendStageOk = s\.stage === QUARTER_STAGE\.OFFICIAL_SENT;/.test(dash));
  const src = read('src/SendBatch.gs');
  check('★★★★★ 放棄時用和把關同一個數（countOfficialSendLogRows_）',
    /planStageAfterAbandonedBatch_\(p, getQuarterStage_\(p\.quarterId\),\s*countOfficialSendLogRows_\(p\.quarterId\)/.test(src));
  const guards = read('src/WebAppGuards.gs');
  check('★★★★★ 把關本身亦用同一支（summariseOfficialSendLogRows_）',
    /function assertNeverOfficiallySent_\(quarterId\) \{\s*const info = summariseOfficialSendLogRows_\(quarterId\);/.test(guards));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
