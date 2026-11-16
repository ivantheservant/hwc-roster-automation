// 第一百零九輪批次 SA 組：寄出的時間預算及續寄（SendBatch.gs、Mailer.gs、ResendFlow.gs、MakeupSend.gs、FiveStageCore.gs）
// 執行方式：node tests/round109_sa_send_budget.test.js
// 下面用假 ID（P97xx）、example.invalid。

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
  'PersonalLinkInMail.gs', 'SendBatch.gs'
]);

const Q = '2028T3';
const C = gas.COLUMNS.SEND_LOG;
let LOG = [];
let AUDIT = [];
let budget = 120;
let version = 4;
let recipients = [];
let stamp = 0;
let advanced = 0;

function busyWait(ms) { const t = Date.now(); while (Date.now() - t < ms) { /* 模擬每封的時間 */ } }

function setup(n) {
  LOG = []; AUDIT = []; budget = 120; version = 4; stamp = 0; advanced = 0;
  gas.SEND_BATCH_MEMORY_STORE_ = null;
  recipients = [];
  for (let i = 1; i <= n; i++) {
    recipients.push({ type: 'PERSON', personId: 'P97' + String(i).padStart(2, '0'), email: 'p' + i + '@example.invalid', displayName: '測試' + i });
  }
  gas.getConfig_ = function (k, d) {
    if (k === gas.CONFIG_KEYS.SEND_TIME_BUDGET_MS) return budget;
    if (k === gas.CONFIG_KEYS.DRY_RUN) return true;
    return d;
  };
  gas.compactTimestamp_ = function () { stamp++; return '20281113' + String(stamp).padStart(6, '0'); };
  gas.assertNotPreviewMode_ = function () {};
  gas.clearDashboardCountsCache_ = function () {};
  gas.ensurePublicLinkFreshBeforeSend_ = function () { return { republished: false }; };
  gas.resolveMailAttachmentFolder_ = function () {};
  gas.assertPublicRosterUrlAvailableForStage_ = function () {};
  gas.resolveStageTemplates_ = function () { return { person: { attachType: 'NONE' }, list: null }; };
  gas.buildMailContext_ = function (q, v, stage) { return { quarterId: q, versionNo: v, stage: stage, placeholders: {} }; };
  gas.resolveSendOptions_ = function () { return {}; };
  gas.describeSendDecision_ = function () { return ''; };
  gas.resolveSendRecipientPool_ = function () { return recipients.slice(); };
  gas.filterRecipientsByScope_ = function (p) { return p; };
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
  gas.findLatestVersionNo_ = function () { return version; };
  gas.requireQuarterStage_ = function () {};
  gas.checkMissingPersonalPdfs_ = function () { return {}; };
  gas.evaluateStep4MissingPdfGate_ = function () { return { blocked: false }; };
  gas.countOfficialReach_ = function () { return null; };
  gas.advanceQuarterStage_ = function () { advanced++; };
  gas.tryCreateEditableCopyAfterSend_ = function () { return null; };
  gas.AUTOMATION_TRIGGER_CONTEXT_ACTIVE = false;
  gas.assertOfficialNotFromAutomationTrigger_ = function () {};
  gas.buildStep4OutcomeSentence_ = gas.buildStep4OutcomeSentence_ || function () { return ''; };
}

console.log('\n=== SA1 純函式：到了預算就停 ===');
{
  check('★★★★★ 一位都未處理 ⇒ 不停（每段最少一位）', gas.shouldStopForSendBudget_(0, 0, 0, 999999, 1) === false);
  check('★★★★★ 已用 200＋平均 50 > 240 ⇒ 停', gas.shouldStopForSendBudget_(0, 0, 4, 200, 240) === true);
  check('★★★★ 已用 100＋平均 25 < 240 ⇒ 繼續', gas.shouldStopForSendBudget_(0, 0, 4, 100, 240) === false);
  const cmp = gas.compareSendBatchRecipients_(['A', 'B', 'C'], ['B', 'C', 'D'], { A: true });
  check('★★★★★ 名單核對：扣除已處理之後多了一位 ⇒ 不同', !cmp.same && cmp.added.join() === 'D', JSON.stringify(cmp));
  check('★★★★★ 名單核對：已處理的人從現時名單消失（例如重發後 hash 已更新）⇒ 仍然相同',
    gas.compareSendBatchRecipients_(['A', 'B'], ['B'], { A: true }).same === true);
  check('★★★ 分段說明', /分 2 段：第 1 段 3 位 61 秒；第 2 段 2 位 30 秒/.test(gas.describeSendSegments_([{ count: 3, ms: 61000 }, { count: 2, ms: 30000 }])));
}

console.log('\n=== SA2 sendStage_：分段、續寄不重複、SendLog 完整、AuditLog 只寫一次 ===');
{
  setup(10);
  let r = gas.sendStage_(Q, version, gas.MAIL_STAGES.REVIEW, {}, true);
  check('★★★★★★ 到了預算就停：第一段未寄完', r.incomplete === true && r.processedTotal > 0 && r.processedTotal < 10, JSON.stringify(r));
  check('★★★★★ 停下來時已處理的全部寫入 SendLog', LOG.length === r.processedTotal, LOG.length + ' vs ' + r.processedTotal);
  check('★★★★★ 未寄完不寫「寄送批次」AuditLog', AUDIT.filter((a) => a.action === '寄送批次').length === 0);
  const batchId = r.batchId;
  check('★★★★ SendLog 每行都有批次鍵', LOG.every((row) => row[C.SEND_BATCH_ID] === batchId));
  let guard = 0;
  while (r.incomplete && guard++ < 20) r = gas.sendStage_(Q, version, gas.MAIL_STAGES.REVIEW, { resumeBatchId: batchId }, true);
  const keys = LOG.map((row) => row[C.PERSON_ID]);
  check('★★★★★★ 續寄不重複：SendLog 行數＝收件人數，每人一行', LOG.length === 10 && new Set(keys).size === 10, keys.join());
  check('★★★★★★ 完成時數字是各段合計', r.incomplete !== true && r.dryRun === 10, JSON.stringify(r));
  const audits = AUDIT.filter((a) => a.action === '寄送批次');
  check('★★★★★ 「寄送批次」只寫一次，寫明分了幾段', audits.length === 1 && /分 \d+ 段/.test(audits[0].notes), JSON.stringify(audits));
  check('★★★★★ 完成後清除未完成紀錄', gas.readPendingSendBatch_() === null);
}

console.log('\n=== SA3 未完成期間不可以另開一批；版本或名單中途有變 ⇒ 停 ===');
{
  setup(10);
  const r = gas.sendStage_(Q, version, gas.MAIL_STAGES.REVIEW, {}, true);
  let msg = '';
  try { gas.sendStage_(Q, version, gas.MAIL_STAGES.REVIEW, {}, true); } catch (e) { msg = e.message; }
  check('★★★★★★ 另開一批 ⇒ 拒絕，講明上一次未完成及〔繼續寄出〕', /上一次寄出還未完成/.test(msg) && /繼續寄出/.test(msg), msg);
  const before = LOG.length;
  version = 5;
  msg = '';
  try { gas.sendStage_(Q, 5, gas.MAIL_STAGES.REVIEW, { resumeBatchId: r.batchId }, true); } catch (e) { msg = e.message; }
  check('★★★★★★ 版本中途有變 ⇒ 停，一封都不寄', /第 4 版/.test(msg) && /第 5 版/.test(msg) && LOG.length === before, msg);
  version = 4;
  recipients.push({ type: 'PERSON', personId: 'P9799', email: 'x@example.invalid', displayName: '新人' });
  msg = '';
  try { gas.sendStage_(Q, 4, gas.MAIL_STAGES.REVIEW, { resumeBatchId: r.batchId }, true); } catch (e) { msg = e.message; }
  check('★★★★★★ 名單中途有變 ⇒ 停，不多寄不少寄', /多了 1 位/.test(msg) && LOG.length === before, msg);
  gas.AUTOMATION_TRIGGER_CONTEXT_ACTIVE = true;
  recipients.pop();
  msg = '';
  try { gas.sendStage_(Q, 4, gas.MAIL_STAGES.REVIEW, { resumeBatchId: r.batchId }, true); } catch (e) { msg = e.message; }
  check('★★★★★ 續寄不可以由自動排程觸發', /自動排程/.test(msg), msg);
}

console.log('\n=== SA4 正式發出：Stage 只在全部寄完之後推進 ===');
{
  setup(10);
  let r = gas.executeStep4Send_(Q, {});
  check('★★★★★★ 未寄完 ⇒ 不推進 Stage', r.incomplete === true && advanced === 0, JSON.stringify(r));
  let guard = 0;
  while (r.incomplete && guard++ < 20) r = gas.executeStep4Send_(Q, { resumeBatchId: r.batchId });
  check('★★★★★★ 全部寄完那一段才推進 Stage（只推進一次）', !r.incomplete && advanced === 1 && LOG.length === 10, 'advanced=' + advanced + ' log=' + LOG.length);
}

console.log('\n=== SA5 DRY_RUN 一樣分段；補寄中途寄了的人續寄時不再寄 ===');
{
  setup(6);
  const r = gas.sendStage_(Q, 4, gas.MAIL_STAGES.OFFICIAL, {}, true);
  check('★★★★ DRY_RUN 一樣分段', r.incomplete === true && r.isDryRun === true);
  // 模擬：中途用〔補寄未收到的人〕寄了餘下其中一位（同一季同一版同一階段、批次開始之後）
  const restKey = recipients.map((x) => x.personId).find((k) => !LOG.some((row) => row[C.PERSON_ID] === k));
  const row = {};
  row[C.QUARTER_ID] = Q; row[C.VERSION_NO] = 4; row[C.STAGE] = gas.MAIL_STAGES.OFFICIAL;
  row[C.PERSON_ID] = restKey; row[C.STATUS] = 'DRY_RUN'; row[C.SENT_AT] = new Date(); row[C.SEND_BATCH_ID] = '';
  LOG.push(row);
  budget = 100000;
  const r2 = gas.sendStage_(Q, 4, gas.MAIL_STAGES.OFFICIAL, { resumeBatchId: r.batchId }, true);
  const n = LOG.filter((x) => x[C.PERSON_ID] === restKey).length;
  check('★★★★★★ 補寄認得未完成的批次：補寄過的人續寄時不再寄', n === 1 && r2.incomplete !== true, 'rows=' + n);
}

console.log('\n=== SA6 來源核對：三條路徑、菜單、補寄、介面 ===');
{
  const resend = read('src/ResendFlow.gs');
  const makeup = read('src/MakeupSend.gs');
  check('★★★★★ 變動的人：分段及續寄', /beginSendBatch_\(SEND_BATCH_KIND\.RESEND/.test(resend) && /shouldStopForSendBudget_/.test(resend));
  check('★★★★★ 補寄：時間預算，回傳 incomplete／remaining', /shouldStopForSendBudget_/.test(makeup) && /incomplete: makeupRemaining > 0/.test(makeup));
  const menu = read('src/Menu.gs') + read('src/FourStageFlow.gs') + read('src/SeasonRehearsal.gs');
  check('★★★★★ 菜單及彩排：未寄完不可以靜靜停', (menu.match(/describeIncompleteSendForMenu_\(/g) || []).length >= 6);
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 介面：三個寄出動作未寄完自動接着寄', (z1.match(/callSendUntilDone\('apiStep[245]/g) || []).length === 3);
  check('★★★★ 介面：補寄自動再呼叫', /callMakeupUntilDone\(currentQuarterId, stage\)/.test(read('src/ui/ScriptZone4.html')));
  check('★★★★ 狀態卡〔繼續寄出〕', /button\('繼續寄出'/.test(read('src/ui/Script.html')) && /pendingSendBatch:/.test(read('src/WebAppDashboard.gs')));
  check('★★★★ 正式發出防護沒有少', /assertOfficialNotFromAutomationTrigger_\(quarterId\)/.test(read('src/Mailer.gs')));
  const script = read('src/ui/Script.html');
  check('★★★★★ 介面：未寄完就用〔繼續寄出〕一直接着寄，等候牌寫已處理幾多位',
    /while \(r && r\.incomplete && r\.batchId\)/.test(script) && /callServerMutating\('apiContinueSendBatch', r\.batchId\)/.test(script));
  check('★★★★ 補寄：時間預算用完再呼叫同一支', /while \(r && r\.ok && r\.incomplete\)/.test(script));
}

console.log('\n=== SA9 續寄正式發出：第一段的 SendLog 不可以令續寄被當作「已經正式發出過」（部署後實測撞到）===');
{
  setup(3);
  const rec = { id: 'SB-RESUME-1', kind: gas.SEND_BATCH_KIND.STAGE, quarterId: Q, versionNo: version, stage: gas.MAIL_STAGES.OFFICIAL,
    recipientKeys: [], total: 3, segments: [], startedAtMs: Date.now(), sendOptions: {} };
  gas.writePendingSendBatch_(rec);
  const row = {}; row[C.QUARTER_ID] = Q; row[C.STAGE] = gas.MAIL_STAGES.OFFICIAL; row[C.SEND_BATCH_ID] = rec.id; row[C.SENT_AT] = 'x';
  LOG.push(row);
  let threw = '';
  try { gas.assertNeverOfficiallySent_(Q); } catch (e) { threw = e.message; }
  check('★★★★ 前提：第一段已寫 OFFICIAL 紀錄 ⇒ 舊檢查會擋', /已經正式發出過了/.test(threw));
  check('★★★★★★ 同一批、同一季、正式發出 ⇒ 認得是續寄', gas.isResumingSendBatch_(Q, gas.MAIL_STAGES.OFFICIAL, { resumeBatchId: rec.id }) === true);
  check('★★★★★★ 批次鍵不同、季度不同、階段不同、沒有批次鍵 ⇒ 不算續寄（照舊擋）',
    gas.isResumingSendBatch_(Q, gas.MAIL_STAGES.OFFICIAL, { resumeBatchId: 'SB-OTHER' }) === false
    && gas.isResumingSendBatch_('2028T2', gas.MAIL_STAGES.OFFICIAL, { resumeBatchId: rec.id }) === false
    && gas.isResumingSendBatch_(Q, gas.MAIL_STAGES.REVIEW, { resumeBatchId: rec.id }) === false
    && gas.isResumingSendBatch_(Q, gas.MAIL_STAGES.OFFICIAL, {}) === false);
  gas.clearPendingSendBatch_();
  check('★★★★★ 這一批已完成（沒有未完成紀錄）⇒ 不算續寄', gas.isResumingSendBatch_(Q, gas.MAIL_STAGES.OFFICIAL, { resumeBatchId: rec.id }) === false);
  check('★★★★★★ 正式發出入口：只有續寄才略過「已經正式發出過」檢查',
    /if \(!isResumingSendBatch_\(quarterId, MAIL_STAGES\.OFFICIAL, sendOptions\)\) assertNeverOfficiallySent_\(quarterId\);/.test(read('src/WebAppFlow.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
