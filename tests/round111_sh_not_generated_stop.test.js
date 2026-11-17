// 第一百一十一輪批次 SH 組：「未生成」提醒的停止條件
// 執行方式：node tests/round111_sh_not_generated_stop.test.js
// 下面用 2099 年的假季度。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Trigger.gs']);
const A = gas.COLUMNS.AUDIT_LOG;
const Q = '2099T1';
let AUDIT = [];
let CONFIG = {};
function setup(o) {
  AUDIT = []; CONFIG = Object.assign({ ADMIN_NOTIFY_STAGE_REMINDERS: false }, (o && o.config) || {});
  gas.getConfig_ = (k, d) => (k in CONFIG ? CONFIG[k] : d);
  gas.getQuarterStage_ = () => 'DRAFT';
  gas.findLatestVersionNo_ = () => (o && o.hasVersion ? 0 : -1);
  gas.computeAutomationSchedule_ = () => ({ generateDate: '2098-11-27', officialDate: '2098-12-04' });
  gas.resolveRemindReferenceDate_ = () => '';
  gas.listUnconfirmedSpecialSundays_ = () => [];
  gas.readServiceDatesNormalized_ = () => [{ serviceDate: '2099-01-04' }, { serviceDate: '2099-01-11' }];
  gas.toDateString_ = (v) => (v ? String(v).slice(0, 10) : '');
  gas.readSheet_ = (name) => (name === gas.SHEETS.AUDIT_LOG ? AUDIT : []);
  gas.log_ = () => {};
}
const ROW = { QuarterID: Q, StartDate: '2099-01-01', EndDate: '2099-03-31' };
const remindRow = (date, notes) => ({ [A.ACTION]: gas.AUTOMATION_ACTIONS.REMIND, [A.TARGET_KEY]: Q + '|DRAFT', [A.NEW_VALUE]: date, [A.NOTES]: notes || '' });
const judge = (today) => gas.judgeRemindAction_(Q, ROW, today, {});

console.log('\n=== SH1：第一個主日之前——每日一次（不變） ===');
{
  setup();
  let j = judge('2098-11-28');
  check('★★★★★★ 生成日之後、第一個主日之前 ⇒ 提醒（NOT_GENERATED，未開始）', j.outcome === 'WOULD_RUN' && j.reasons.indexOf('NOT_GENERATED') !== -1 && !j.quarterStarted, JSON.stringify(j));
  AUDIT.push(remindRow('2098-12-20'));
  j = judge('2098-12-21');
  check('★★★★★★ 昨日提醒過，今日照樣提醒（每日一次，沒有次數上限）', j.outcome === 'WOULD_RUN', j.detail);
  check('★★★★★ 今日提醒過 ⇒ 今日不再提醒', (AUDIT.push(remindRow('2098-12-21')), judge('2098-12-21').outcome === 'SKIPPED_DONE'));
}

console.log('\n=== SH2：第一個主日已過——每 7 日一次，內容改為「已經開始……請匯入」 ===');
{
  setup();
  let j = judge('2099-01-04');
  check('★★★★★★ 第一個主日當日 ⇒ quarterStarted、提醒', j.outcome === 'WOULD_RUN' && j.quarterStarted === true && j.firstServiceDate === '2099-01-04', JSON.stringify(j));
  check('★★★★★ 說明寫「這一季已經開始……每 7 日提醒一次」', /這一季已經開始（第一個主日 2099-01-04）而系統內沒有職事表，每 7 日提醒一次/.test(j.detail), j.detail);
  AUDIT.push(remindRow('2099-01-04'));
  j = judge('2099-01-08');
  check('★★★★★★ 上一次提醒之後未夠 7 日 ⇒ 不提醒', j.outcome === 'SKIPPED_NOT_DUE' && /每 7 日提醒一次，上一次是 2099-01-04/.test(j.detail), j.detail);
  j = judge('2099-01-11');
  check('★★★★★★ 滿 7 日 ⇒ 再提醒', j.outcome === 'WOULD_RUN' && j.quarterStarted, j.detail);
  setup({ hasVersion: true });
  check('★★★★★ 有版本 ⇒ 不是「未生成」', judge('2099-01-11').reasons.indexOf('NOT_GENERATED') === -1);
}

console.log('\n=== SH3：季度結束日已過 ⇒ 不再提醒 ===');
{
  setup();
  const j = judge('2099-04-01');
  check('★★★★★★ 結束日之後 ⇒ SKIPPED_QUARTER_ENDED', j.outcome === 'SKIPPED_QUARTER_ENDED' && /2099-03-31 結束/.test(j.detail), JSON.stringify(j));
  check('★★★★ 結束日當日仍然判斷（照每 7 日）', judge('2099-03-31').outcome !== 'SKIPPED_QUARTER_ENDED');
}

console.log('\n=== SH4：Config 關掉而沒有寄出 ⇒ 同一季同一原因只寫第一次 AuditLog ===');
{
  const key = Q + '|DRAFT';
  const silent = (reasons) => '第 1 / 3 次階段提醒（Config 關掉，沒有寄出）：' + Q + ' 停留在 DRAFT（' + reasons + '）';
  check('★★★★★★ 同一原因已記錄過 ⇒ true', gas.hasSilentReminderLogged_([remindRow('2098-11-27', silent('NOT_GENERATED'))], key, 'NOT_GENERATED'));
  check('★★★★★★ 原因不同（已開始）⇒ false（第一次照寫）', !gas.hasSilentReminderLogged_([remindRow('2098-11-27', silent('NOT_GENERATED'))], key, 'NOT_GENERATED（這一季已開始）'));
  check('★★★★★ 有寄出的那一行不算', !gas.hasSilentReminderLogged_([remindRow('2098-11-27', '第 1 / 3 次提醒幹事：' + Q + ' 停留在 DRAFT（NOT_GENERATED）')], key, 'NOT_GENERATED'));
  check('★★★★ 另一季不算', !gas.hasSilentReminderLogged_([Object.assign(remindRow('2098-11-27', silent('NOT_GENERATED')), { [A.TARGET_KEY]: '2099T2|DRAFT' })], key, 'NOT_GENERATED'));
  check('★★★★★ 原因鍵：已開始與未開始分開', gas.describeRemindReasonsKey_({ reasons: ['NOT_GENERATED'], quarterStarted: true }) === 'NOT_GENERATED（這一季已開始）'
    && gas.describeRemindReasonsKey_({ reasons: ['NOT_GENERATED', 'STUCK'] }) === 'NOT_GENERATED＋STUCK');

  const logged = [];
  gas.writeAuditLog_ = (e) => logged.push(e);
  const j = { outcome: 'WOULD_RUN', quarterId: Q, action: gas.AUTOMATION_ACTIONS.REMIND, targetKey: key };
  const r = gas.executeAutomationAction_(j, '2098-12-01', () => ({ skipAudit: true, notes: '已記錄過' }));
  check('★★★★★★ workFn 回 skipAudit ⇒ 不寫 AuditLog、outcome RAN_SILENT', logged.length === 0 && r.outcome === 'RAN_SILENT', JSON.stringify(r));
  const r2 = gas.executeAutomationAction_(j, '2098-12-01', () => '第 1 次');
  check('★★★★★ 一般情況照寫 AuditLog', logged.length === 1 && r2.outcome === 'RAN');

  const tr = read('src/Trigger.gs');
  check('★★★★★★ 每日排程：Config 關掉而且同一原因已記錄過 ⇒ 不呼叫通知（不再寫 ADMIN_NOTIFY_SKIPPED）、不寫 REMIND',
    /if \(getConfig_\(CONFIG_KEYS\.ADMIN_NOTIFY_STAGE_REMINDERS, false\) !== true\s*&& hasSilentReminderLogged_\(readSheet_\(SHEETS\.AUDIT_LOG\), remindJudgment\.targetKey, reasonsKey\)\) \{\s*return \{ skipAudit: true/.test(tr));
}

console.log('\n=== SH5：提醒信內容（已開始） ===');
{
  const ml = read('src/Mailer.gs').replace(/\r\n/g, '\n');
  check('★★★★★★ 原因一行：已開始（quarterStarted）⇒「這一季已經開始……系統內沒有職事表；如果是人手排的，請匯入」',
    /if \(judgment\.reasons\.indexOf\('NOT_GENERATED'\) !== -1 && judgment\.quarterStarted\) \{\n[^\n]*\n    reasonLines\.push\('　• 這一季已經開始（第一個主日 ' \+ \(judgment\.firstServiceDate \|\| ''\) \+ '），系統內沒有職事表；如果是人手排的，請匯入'\);/.test(ml));
  check('★★★★★ 下一步寫〔建立匯入表〕〔檢查並匯入〕；次數一句寫每 7 日', /〔建立匯入表〕，貼上之後按〔檢查並匯入〕/.test(ml) && /改為每 ' \+ REMIND_STARTED_INTERVAL_DAYS \+ ' 日一次/.test(ml));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
