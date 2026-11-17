// 第一百一十四輪批次 UE 組：每週事奉提醒（WeeklyReminder.gs）。
// 執行方式：node tests/round114_ue_weekly_reminder.test.js
//
//   UE1 純函式：提醒日、寄出期（錯過星期一會補、主日當日及之後不補）、到場時間、同一人幾個崗位合成一項
//   UE2 只限已正式發出（狀態卡同一個判斷 getQuarterStage_）、用最新版本；Config 關掉不寄
//   UE3 只寄一次：同日再執行不重寄；之後幾日不重寄；DRY_RUN 的模擬紀錄上線後不算
//   UE4 部分寄失敗：同日不重試、翌日只補失敗的人；全部寄不出通知幹事一次
//   UE5 沒有電郵的人：合成一封摘要寄幹事（每個主日一次）；名單以外的人不寄
//   UE6 開放範圍：第一階段只寄給堂委、執事、幹事
//   UE7 時間預算：超過就停，下一次接着寄未寄的人
//   UE8 接線：每日自動排程（自己 try/catch）、〔自動排程狀態〕、〔上線前檢查〕、Config、範本、補建工作表
// 用假 ID（P97xx）、假名、example.invalid。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

/** 場景：2099T1 四個主日（2099-01-04、11、18、25；星期日）。生成第 0 版；可選正式發出。 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({
    extraFiles: ['WeeklyReminder.gs', 'RolloutAudience.gs', 'PersonalLinkInMail.gs', 'EmailTemplateSeed.gs', 'SendBatch.gs', 'WebAppPersonalLink.gs', 'PdfBatch.gs'],
    config: Object.assign({
      WEEKLY_REMINDER_ENABLED: ['TRUE', 'BOOL'], WEEKLY_REMINDER_WEEKDAY: ['1', 'INT'],
      ROLLOUT_AUDIENCE: ['ALL', 'ENUM'], MAIL_ADMIN_NOTIFY: ['clerk@example.invalid', 'STR'],
      WEBAPP_VOLUNTEER_URL: ['https://example.invalid/vol/exec', 'STR'], ICS_SERVICE_START_TIME: ['10:45', 'STR'],
      MAIL_SUBJECT_PREFIX: ['', 'STR']
    }, opts.config || {})
  });
  const g = sc.gas;
  let n = 0;
  g.nowTimestamp_ = function () { n++; return '2099-01-01 09:00:' + String(n % 60).padStart(2, '0'); };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  if (typeof g.ensureNameMappingPersonalLinkTokenColumn_ === 'function') {
    const col = g.ensureNameMappingPersonalLinkTokenColumn_();
    const nm = sc.ss.getSheetByName(sc.S.NAME_MAPPING);
    for (let r = 3; r <= nm.getLastRow(); r++) nm.getRange(r, col).setValue('tok' + String(nm.getRange(r, 1).getValue()).slice(-2));
  }
  g.apiGenerateDraftExecute(sc.Q);
  if (opts.official !== false) g.setQuarterStage_(sc.Q, 'OFFICIAL_SENT', 'test');
  sc.mails = [];
  sc.failFor = {};
  g.sendRealEmail_ = function (r, subject, html, plain) {
    if (sc.failFor[r.email]) throw new Error('寄不出（測試）');
    sc.mails.push({ to: r.email, name: r.displayName, subject: subject, html: html, plain: plain });
  };
  sc.admin = [];
  g.notifyAdmin_ = function (subject, body, to) { sc.admin.push({ subject: subject, body: body, to: to }); };
  sc.cfg = function (key, value) {
    const sheet = sc.ss.getSheetByName(sc.S.CONFIG);
    const keys = sheet.getRange(3, 1, sheet.getLastRow() - 2, 1).getValues();
    let found = false;
    for (let i = 0; i < keys.length; i++) if (keys[i][0] === key) { sheet.getRange(i + 3, 2).setValue(value); found = true; }
    if (!found) throw new Error('沒有 Config ' + key);
    g.reloadConfigCache_();
  };
  sc.run = (today) => g.runWeeklyReminderStep_(today, g.readConfig_(), g.getConfig_(g.CONFIG_KEYS.DRY_RUN, true) !== false);
  sc.log = () => g.readSheet_(sc.S.WEEKLY_REMINDER_LOG);
  sc.audits = (action) => g.readSheet_(sc.S.AUDIT_LOG).filter((r) => r[sc.C.AUDIT_LOG.ACTION] === action);
  // 2099-01-11 那一個主日有崗位而在名單上的人（最新版本）
  const A = sc.C.ROSTER_ASSIGNMENTS;
  const v = g.findLatestVersionNo_(sc.Q);
  sc.assigned = (date) => {
    const ids = {};
    g.readVersionAssignmentsRaw_(sc.Q, v).forEach((r) => {
      if (g.toDateString_(r[A.SERVICE_DATE], sc.TZ) === date && /^P97/.test(String(r[A.PERSON_ID] || ''))) ids[r[A.PERSON_ID]] = true;
    });
    return Object.keys(ids).sort();
  };
  return sc;
}

console.log('\n=== UE1：純函式 ===');
{
  const g = buildRound75Scene({ extraFiles: ['WeeklyReminder.gs'] }).gas;
  check('★★★★★ 2099-01-04、2099-01-11 是星期日（場景的主日）', g.weekdayOfDateString_('2099-01-04') === 0 && g.weekdayOfDateString_('2099-01-05') === 1);
  check('★★★★★ 提醒日：1＝星期一；0、7＝星期日；認不出、空白、8 ⇒ 預設 1',
    g.normaliseWeeklyReminderWeekday_(1) === 1 && g.normaliseWeeklyReminderWeekday_('3') === 3 && g.normaliseWeeklyReminderWeekday_(0) === 0
      && g.normaliseWeeklyReminderWeekday_(7) === 0 && g.normaliseWeeklyReminderWeekday_('x') === 1 && g.normaliseWeeklyReminderWeekday_('') === 1
      && g.normaliseWeeklyReminderWeekday_(8) === 1);
  check('★★★★ 提醒日至主日相隔：星期一 6、星期六 1、星期日 7', g.weeklyReminderDaysBefore_(1) === 6 && g.weeklyReminderDaysBefore_(6) === 1 && g.weeklyReminderDaysBefore_(0) === 7);
  const sds = ['2099-01-04', '2099-01-11', '2099-01-18'].map((d) => ({ quarterId: 'Q', serviceDate: d }));
  const pick = (today, w) => g.pickWeeklyReminderTargets_(today, w, sds).map((t) => t.serviceDate).join();
  check('★★★★★★ 星期一（提醒日）⇒ 當週主日', pick('2099-01-05', 1) === '2099-01-11', pick('2099-01-05', 1));
  check('★★★★★★ 星期一錯過了：星期二至星期六都會補（仍然是同一個主日）', pick('2099-01-06', 1) === '2099-01-11' && pick('2099-01-10', 1) === '2099-01-11');
  check('★★★★★★ 主日當日及之後不補（主日當日看的是下一個主日，還未到提醒日）', pick('2099-01-11', 1) === '' && pick('2099-01-12', 1) === '2099-01-18');
  check('★★★★★ 提醒日是星期三 ⇒ 星期一、二不寄；星期三起寄', pick('2099-01-05', 3) === '' && pick('2099-01-06', 3) === '' && pick('2099-01-07', 3) === '2099-01-11');
  check('★★★★ 提醒日是星期日 ⇒ 前一個主日提醒下一個主日', pick('2099-01-04', 0) === '2099-01-11');
  check('★★★★★ 下一次提醒日：今日是星期三、提醒日星期一 ⇒ 下星期一，提醒那個星期日',
    JSON.stringify(g.nextWeeklyReminderDate_('2099-01-07', 1)) === JSON.stringify({ date: '2099-01-12', serviceDate: '2099-01-18' }), JSON.stringify(g.nextWeeklyReminderDate_('2099-01-07', 1)));
  check('★★★★★★ 到場時間＝崇拜開始時間減提早分鐘；沒有填就不寫時間',
    g.buildWeeklyReminderPostLine_('讀經', 15, '10:45') === '・讀經——請在 10:30 前到場' && g.buildWeeklyReminderPostLine_('司事', 0, '10:45') === '・司事'
      && g.buildWeeklyReminderPostLine_('音響', 60, '10:45') === '・音響——請在 09:45 前到場');
  check('★★★★ 日期寫法「M 月 d 日（主日）」', g.formatWeeklyReminderDate_('2099-01-11') === '1 月 11 日（主日）');
  const people = { P9701: { name: '假甲', active: true }, P9702: { name: '假乙', active: true } };
  const posts = { READ: { name: '讀經', early: 15, order: 2 }, CHAIR: { name: '主席', early: 0, order: 1 } };
  const grouped = g.groupWeeklyReminderAssignments_([
    { serviceDate: '2099-01-11', postId: 'READ', personId: 'P9701' }, { serviceDate: '2099-01-11', postId: 'CHAIR', personId: 'P9701' },
    { serviceDate: '2099-01-11', postId: 'READ', personId: 'NAME:外來' }, { serviceDate: '2099-01-11', postId: 'READ', personId: '' },
    { serviceDate: '2099-01-18', postId: 'READ', personId: 'P9702' }], '2099-01-11', people, posts, '10:45');
  check('★★★★★★ 同一人同日幾個崗位合成一項（崗位按次序）；名單以外的文字、空格、其他日子不收',
    grouped.length === 1 && grouped[0].personId === 'P9701' && grouped[0].lines.join('|') === '・主席|・讀經——請在 10:30 前到場', JSON.stringify(grouped));
  const log = g.summariseWeeklyReminderLog_([{ personId: 'P1', sentDate: '2099-01-05', result: 'DRY_RUN' }, { personId: 'P2', sentDate: '2099-01-05', result: 'SENT' },
    { personId: 'P3', sentDate: '2099-01-06', result: 'FAILED' }], false, '2099-01-06');
  check('★★★★★★ 逐人紀錄：SENT 算收到；DRY_RUN 上線後不算；今日失敗的不重試', log.received.P2 && !log.received.P1 && log.failedToday.P3,
    JSON.stringify(log));
  check('★★★★★ DRY_RUN 期間：模擬紀錄算收到', g.summariseWeeklyReminderLog_([{ personId: 'P1', sentDate: 'x', result: 'DRY_RUN' }], true, 'y').received.P1);
}

console.log('\n=== UE2：只限已正式發出；Config 關掉不寄 ===');
{
  const sc = scene({ official: false });
  const r = sc.run('2099-01-05');
  check('★★★★★★ 未正式發出（DRAFT）⇒ 不寄，報告 NOT_OFFICIAL', sc.mails.length === 0 && r.length === 1 && /NOT_OFFICIAL/.test(r[0].detail), JSON.stringify(r));
  const src = read('src/WeeklyReminder.gs');
  check('★★★★★★ 「已經正式發出」用 getQuarterStage_() === OFFICIAL_SENT（狀態卡「已正式發出給全體」同一個判斷）',
    /getQuarterStage_\(t\.quarterId\) !== QUARTER_STAGE\.OFFICIAL_SENT/.test(src) && /stage === QUARTER_STAGE\.OFFICIAL_SENT\) return '已正式發出給全體。'/.test(read('src/WebAppDashboard.gs')));
  const sc2 = scene({ config: { WEEKLY_REMINDER_ENABLED: ['FALSE', 'BOOL'] } });
  const r2 = sc2.run('2099-01-05');
  check('★★★★★★ WEEKLY_REMINDER_ENABLED＝FALSE ⇒ 不寄（DISABLED）', sc2.mails.length === 0 && r2[0].detail === 'DISABLED', JSON.stringify(r2));
  const r3 = sc2.gas.runWeeklyReminderStep_('2099-01-11', sc2.gas.readConfig_(), true);
  check('★★★★ 未到提醒日（主日當日）⇒ NOT_DUE（Config 開着時）', (sc2.cfg('WEEKLY_REMINDER_ENABLED', 'TRUE'), sc2.run('2099-01-11'))[0].detail === 'NOT_DUE' && r3[0].detail === 'DISABLED');
}

console.log('\n=== UE3：只寄一次；DRY_RUN；補寄 ===');
{
  const sc = scene({ config: { DRY_RUN: ['TRUE', 'BOOL'] } });
  const expected = sc.assigned('2099-01-11').filter((id) => id !== 'P9707');   // P9707 沒有電郵
  const r = sc.run('2099-01-05');
  const rows = sc.log();
  check('★★★★★★ DRY_RUN：不寄出，逐人記 DRY_RUN（每位有電郵、有崗位的人一行）', sc.mails.length === 0 && r[0].outcome === 'DRY_RUN'
    && rows.length === expected.length && rows.every((x) => x.Result === 'DRY_RUN'), JSON.stringify(r) + JSON.stringify(rows.map((x) => x.PersonID)));
  check('★★★★★ 逐人紀錄不記電郵', !/@/.test(JSON.stringify(rows)));
  sc.run('2099-01-05');
  sc.run('2099-01-07');
  check('★★★★★★ 同日再執行、之後幾日再執行 ⇒ 不重寄（DRY_RUN 期間模擬紀錄算數）', sc.log().length === expected.length);
  // 上線
  sc.cfg('DRY_RUN', 'FALSE');
  const r2 = sc.run('2099-01-08');
  check('★★★★★★ 上線之後：DRY_RUN 的模擬紀錄不算 ⇒ 主日之前真正寄一次給每一位', sc.mails.length === expected.length && r2[0].outcome === 'SENT'
    && sc.mails.map((m) => m.to).sort().join() === expected.map((id) => id.toLowerCase() + '@example.invalid').sort().join(), JSON.stringify(r2));
  sc.run('2099-01-08');
  sc.run('2099-01-10');
  check('★★★★★★ 之後同日、翌日再執行 ⇒ 不會寄第二次', sc.mails.length === expected.length);
  const m = sc.mails[0];
  check('★★★★★★ 一封信：主旨有日期；內文有「提醒你在 1 月 11 日（主日）的事奉」、崗位、如未能出席請聯絡、個人連結；沒有未代入的 {…}',
    /1 月 11 日（主日）的事奉/.test(m.subject) && /提醒你在 1 月 11 日（主日）的事奉/.test(m.plain) && /・/.test(m.plain) && /如未能出席，請盡早聯絡/.test(m.plain)
      && /https:\/\/example\.invalid\/vol\/exec\?p=tok\d\d&q=2099T1/.test(m.plain) && !/\{[A-Za-z]+\}/.test(m.plain + m.subject + m.html), m.plain);
  check('★★★★★ 香港書面語（沒有「您」「義工」）', !/您|義工/.test(m.plain + m.subject));
  const sent = sc.audits('WEEKLY_REMINDER_SENT');
  check('★★★★★ AuditLog：每次有寄（或模擬）寫一行，鍵＝季度|主日', sent.length === 2 && sent.every((x) => x[sc.C.AUDIT_LOG.TARGET_KEY] === '2099T1|2099-01-11'), sent.length);
  // 主日當日：不補
  const sc2 = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'] } });
  sc2.run('2099-01-11');
  check('★★★★★★ 由星期一至星期六都沒有執行 ⇒ 主日當日不補寄', sc2.mails.length === 0);
  const sc3 = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'] } });
  sc3.run('2099-01-07');
  check('★★★★★★ 星期一沒有執行、星期三執行 ⇒ 補寄一次', sc3.mails.length === sc3.assigned('2099-01-11').filter((id) => id !== 'P9707').length && sc3.mails.length > 0);
}

console.log('\n=== UE4：部分寄失敗、全部寄不出 ===');
{
  const sc = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'] } });
  const expected = sc.assigned('2099-01-11').filter((id) => id !== 'P9707');
  const bad = expected[0].toLowerCase() + '@example.invalid';
  sc.failFor[bad] = true;
  const r = sc.run('2099-01-05');
  check('★★★★★★ 一位寄不出 ⇒ 其他照寄；那一位記 FAILED；報告 PARTIAL', sc.mails.length === expected.length - 1 && r[0].outcome === 'PARTIAL'
    && sc.log().filter((x) => x.Result === 'FAILED').map((x) => x.PersonID).join() === expected[0], JSON.stringify(r));
  sc.run('2099-01-05');
  check('★★★★★★ 同日再執行 ⇒ 不重試失敗的人', sc.log().filter((x) => x.Result === 'FAILED').length === 1 && sc.mails.length === expected.length - 1);
  delete sc.failFor[bad];
  sc.run('2099-01-06');
  check('★★★★★★ 翌日 ⇒ 只補失敗的那一位', sc.mails.length === expected.length && sc.mails[sc.mails.length - 1].to === bad);
  check('★★★★★ 部分失敗不通知幹事（只在全部寄不出時通知）', sc.admin.filter((a) => /寄不出/.test(a.subject)).length === 0);
  const sc2 = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'] } });
  sc2.assigned('2099-01-11').forEach((id) => { sc2.failFor[id.toLowerCase() + '@example.invalid'] = true; });
  const r2 = sc2.run('2099-01-05');
  sc2.run('2099-01-06');
  const notes = sc2.admin.filter((a) => /每週事奉提醒有 \d+ 封寄不出/.test(a.subject));
  check('★★★★★★ 全部寄不出 ⇒ 通知幹事（MAIL_ADMIN_NOTIFY）一次；翌日再全部失敗不再通知；報告 ERROR', notes.length === 1 && notes[0].to === 'clerk@example.invalid'
    && r2[0].outcome === 'ERROR', JSON.stringify(sc2.admin.map((a) => a.subject)));
}

console.log('\n=== UE5：沒有電郵的人；名單以外 ===');
{
  const sc = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'] } });
  // 確保 P9707（沒有電郵）在 2099-01-11 有崗位：直接把那一天一格改成 P9707
  const A = sc.C.ROSTER_ASSIGNMENTS;
  const sheet = sc.ss.getSheetByName(sc.S.ROSTER_ASSIGNMENTS);
  const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cPerson = keys.indexOf(A.PERSON_ID) + 1; const cDate = keys.indexOf(A.SERVICE_DATE) + 1; const cPost = keys.indexOf(A.POST_ID) + 1;
  let changed = false;
  for (let r = 3; r <= sheet.getLastRow() && !changed; r++) {
    if (sc.gas.toDateString_(sheet.getRange(r, cDate).getValue(), sc.TZ) === '2099-01-11' && sheet.getRange(r, cPost).getValue() === 'FLOWER') {
      sheet.getRange(r, cPerson).setValue('P9707'); changed = true;
    }
  }
  if (!changed) {
    for (let r = 3; r <= sheet.getLastRow() && !changed; r++) {
      if (sc.gas.toDateString_(sheet.getRange(r, cDate).getValue(), sc.TZ) === '2099-01-11') { sheet.getRange(r, cPerson).setValue('P9707'); changed = true; }
    }
  }
  sc.run('2099-01-05');
  sc.run('2099-01-06');
  const summary = sc.admin.filter((a) => /沒有電郵，請另外通知/.test(a.subject));
  check('★★★★★★ 沒有電郵的人 ⇒ 合成一封摘要寄幹事（列出名字及崗位）；同一個主日只寄一次', changed && summary.length === 1 && /假庚：/.test(summary[0].body)
    && summary[0].to === 'clerk@example.invalid', JSON.stringify(sc.admin.map((a) => a.subject)));
  check('★★★★★ 沒有電郵的人不會收到信、亦不寫逐人紀錄', !sc.mails.some((m) => /P9707/i.test(m.to)) && !sc.log().some((x) => x.PersonID === 'P9707'));
  check('★★★★★ AuditLog 只記 PersonID（不記電郵）', sc.audits('WEEKLY_REMINDER_NO_EMAIL_NOTIFIED').length === 1
    && /P9707/.test(sc.audits('WEEKLY_REMINDER_NO_EMAIL_NOTIFIED')[0][sc.C.AUDIT_LOG.NOTES]));
  const g = sc.gas;
  const t = g.buildWeeklyReminderNoEmailText_('', '2099T1', '2099-01-11', [{ name: '示範甲', postNames: ['讀經', '司事'] }]);
  check('★★★★ 摘要文字：日期、人數、名字及崗位、怎樣補電郵', /1 月 11 日（主日） 每週事奉提醒：1 位沒有電郵/.test(t.subject) && /示範甲：讀經、司事/.test(t.body) && /補填電郵/.test(t.body));
}

console.log('\n=== UE6：開放範圍（第一階段） ===');
{
  const sc = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'], ROLLOUT_AUDIENCE: ['LEADERS', 'ENUM'], WEBAPP_ALLOWED_EMAILS: ['p9701@example.invalid', 'LIST'] } });
  const expected = sc.assigned('2099-01-11');
  sc.run('2099-01-05');
  check('★★★★★★ LEADERS ⇒ 只寄給堂委、執事、幹事（這裏只有一位幹事 P9701）', sc.mails.every((m) => m.to === 'p9701@example.invalid')
    && sc.mails.length === (expected.indexOf('P9701') !== -1 ? 1 : 0), JSON.stringify(sc.mails.map((m) => m.to)) + ' 預期名單 ' + expected.join());
}

console.log('\n=== UE7：時間預算 ===');
{
  const sc = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'], SEND_TIME_BUDGET_MS: ['1000', 'INT'] } });
  const expected = sc.assigned('2099-01-11').filter((id) => id !== 'P9707');
  // 場景的程式在自己的 vm 環境執行 ⇒ 要換那個環境的 Date.now（每讀一次時間過 600 毫秒）
  let clock = 1000000;
  sc.gas.__fakeClock = () => { clock += 600; return clock; };
  require('vm').runInContext('var __realNow = Date.now; Date.now = function () { return __fakeClock(); };', sc.gas);
  let r;
  try { r = sc.run('2099-01-05'); } finally { require('vm').runInContext('Date.now = __realNow;', sc.gas); }
  check('★★★★★★ 超過時間預算 ⇒ 停手（至少寄出一位），報告 PARTIAL 並寫明餘下幾位', expected.length >= 2 && sc.mails.length >= 1 && sc.mails.length < expected.length
    && r[0].outcome === 'PARTIAL' && /時間預算用完/.test(r[0].detail), JSON.stringify(r) + ' 寄了 ' + sc.mails.length + '/' + expected.length);
  sc.run('2099-01-06');
  check('★★★★★★ 下一次執行接着寄未寄的人（不重寄已收到的人）', sc.mails.length === expected.length
    && new Set(sc.mails.map((m) => m.to)).size === expected.length);
}

console.log('\n=== UE8：接線 ===');
{
  const tr = read('src/Trigger.gs');
  check('★★★★★★ 每日自動排程加一步（自己 try/catch，出錯只影響這一步）',
    /if \(typeof runWeeklyReminderStep_ === 'function'\) \{\n      try \{\n        runWeeklyReminderStep_\(today, config, isDryRun\)\.forEach/.test(tr)
      && /action: 'WEEKLY_REMINDER', outcome: 'ERROR'/.test(tr));
  const sc = scene();
  const g = sc.gas;
  const off = (sc.cfg('WEEKLY_REMINDER_ENABLED', 'FALSE'), g.describeWeeklyReminderForStatus_('2099-01-07'));
  check('★★★★★★ 〔自動排程狀態〕：「每週事奉提醒」關；開啟之後下一次哪一日寄、提醒哪一個主日、寄給誰',
    off.label === '每週事奉提醒' && off.onOff === '關' && /開啟之後下一次：2099-01-12（星期一），提醒 2099-01-18 的事奉/.test(off.who)
      && /緊接的主日有崗位的人/.test(off.who) && /沒有電郵的人合成一封寄幹事/.test(off.who), JSON.stringify(off));
  check('★★★★★ 〔自動排程狀態〕的每日項目包括這一行', /typeof describeWeeklyReminderForStatus_ === 'function' && describeWeeklyReminderForStatus_\(/.test(read('src/AdminTools.gs')));
  check('★★★★★★ 〔上線前檢查〕有「每週事奉提醒已決定」', /if \(typeof isWeeklyReminderEnabled_ === 'function'\) add\('每週事奉提醒（WEEKLY_REMINDER_ENABLED）已決定', has\(CONFIG_KEYS\.WEEKLY_REMINDER_ENABLED\)/.test(read('src/PreLaunchWeb.gs')));
  check('★★★★★★ Config 預設：WEEKLY_REMINDER_ENABLED＝FALSE、WEEKLY_REMINDER_WEEKDAY＝1；有種子及說明、基線',
    g.DEFAULTS.WEEKLY_REMINDER_ENABLED === false && g.DEFAULTS.WEEKLY_REMINDER_WEEKDAY === 1
      && ['WEEKLY_REMINDER_ENABLED', 'WEEKLY_REMINDER_WEEKDAY'].every((k) => read('src/ConfigSeed.gs').indexOf('CONFIG_KEYS.' + k + ',') !== -1
        && read('src/ConfigBaselineCheck.gs').indexOf(k + ': {') !== -1 && read('docs/config_baseline_上線值.json').indexOf('"' + k + '"') !== -1));
  const seed = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_WEEKLY_REMINDER_TC')[0];
  check('★★★★★★ 新範本 TPL_WEEKLY_REMINDER_TC（香港書面語；有日期、崗位、聯絡、個人連結的佔位符）', !!seed
    && ['{ServiceDateText}', '{AssignmentLines}', '{ContactName}', '{PersonalLinkLine}'].every((k) => seed.bodyPlain.indexOf(k) !== -1)
    && !/您|義工/.test(seed.bodyPlain + seed.subject));
  check('★★★★★ 〔補建設定及範本〕建立 WeeklyReminderLog', /SHEETS\.WEEKLY_REMINDER_LOG\]\.filter/.test(read('src/AdminTools.gs'))
    && /ensureWeeklyReminderLogSheet_\(\)\.created\) sheetsCreated\.push\(SHEETS\.WEEKLY_REMINDER_LOG\)/.test(read('src/AdminTools.gs')));
  check('★★★★ 取捨寫在檔頭：提醒寄出之後職事表再改不補寄（由〔變動的人〕通知）', /提醒寄出之後職事表再有改動：不補寄提醒（改動由第 3 步〔變動的人〕通知）/.test(read('src/WeeklyReminder.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
