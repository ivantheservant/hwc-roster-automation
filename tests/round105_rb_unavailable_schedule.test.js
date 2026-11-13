// 第一百零五輪批次 RB 組：申報不能服侍日子的時間表自動化（2027T2 起；2027T1 照舊人手）
//
//   RB1　日子：G−21 季前資料（請確認事奉人員表）、G−14 申報連結、G−3 提醒、G 截止日＋申報期已完結
//   RB2　開關：UNAVAILABLE_INVITE_AUTO 預設關 ⇒ 全部照舊；UNAVAILABLE_INVITE_AUTO_FROM_QUARTER 之前的季度永遠不自動寄
//   RB3　每日檢查：每一步每季只做一次；DRY_RUN 只模擬；已有版本 ⇒ 不做
//   RB4　〔我這一季沒有不能服侍的日子〕：可以按、可以改回；提醒不寄給已回覆的人；確認畫面列出
//   RB5　申報期內不逐次通知（UNAVAILABLE_QUIET_DURING_WINDOW）
//   RB6　範本、時間表、上線前檢查
//
// 場景：tests/helpers/unavailable_scene.js（2099T1 生成日 2098-12-11；假 ID P97xx、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, tok, T1 } = require('./helpers/unavailable_scene.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + String(detail).slice(0, 1500) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const G = '2098-12-11';   // 2099T1 生成日（開始日 2099-01-01 前 21 日）
const ON = { UNAVAILABLE_INVITE_AUTO: ['TRUE', 'BOOL'] };

function scene(config, today) {
  const sc = buildUnavailableScene({ config: Object.assign({}, config || {}), today: today || '2098-11-01',
    extraFiles: ['AdminTools.gs', 'PersonIdFormat.gs', 'PreLaunchWeb.gs', 'Trigger.gs', 'TemplateSamples.gs', 'EmailTemplateUpdate.gs'] });
  sc.Q = '2099T1';
  sc.qRow = () => sc.gas.readSheet_(sc.S.QUARTERS).filter((r) => r[sc.C.QUARTERS.QUARTER_ID] === sc.Q)[0];
  sc.run = (day) => {
    sc.today = day;
    const g = sc.gas;
    return g.runUnavailableScheduleSteps_(sc.qRow(), day, g.readConfig_(), g.getConfig_('DRY_RUN', true) !== false);
  };
  sc.goLive = () => {
    const cfg = sc.ss.getSheetByName(sc.S.CONFIG);
    for (let row = 3; row <= cfg.getLastRow(); row++) if (cfg.getRange(row, 1).getValue() === 'DRY_RUN') cfg.getRange(row, 2).setValue('FALSE');
    if (sc.gas.reloadConfigCache_) sc.gas.reloadConfigCache_();
    sc.gas.assertNotPreviewMode_ = () => {};
    sc.gas.readMailRedirectTarget_ = () => '';
  };
  return sc;
}
const step = (rep, action) => rep.filter((r) => r.action === action)[0] || {};

console.log('\n=== RB1：日子 ===');
{
  const sc = scene(ON);
  const g = sc.gas;
  const s = g.computeUnavailableSchedule_(G);
  check('★★★★★★ G−21 季前資料、G−14 申報連結、G−3 提醒、截止日＝G', s.preseasonDate === '2098-11-20' && s.inviteDate === '2098-11-27'
    && s.remindDate === '2098-12-08' && s.deadline === G, JSON.stringify(s));
  check('★★★★★ G 空白 ⇒ 全部空白', g.computeUnavailableSchedule_('').inviteDate === '' && g.computeUnavailableSchedule_('').deadline === '');
  check('★★★★★★ 自動化開着：截止日＝生成日；季前資料在生成日前 21 日', g.unavailableDeadlineFor_(sc.Q, G) === G && g.preseasonDaysBeforeFor_(sc.Q) === 21);
  check('★★★★★ 申報邀請預覽的截止日＝生成日', g.apiUnavailableInvitePreview(sc.Q).deadline === G, g.apiUnavailableInvitePreview(sc.Q).deadline);
  const pack = { quarterLabel: '2099年1-3月', html: '', plain: '' };
  const ph = g.buildPreseasonPlaceholders_(sc.Q, pack, G);
  check('★★★★★★ 季前資料：請在 G−14 之前確認；申報連結 G−14 寄出', ph.ListConfirmBy === '2098-11-27' && ph.InviteDate === '2098-11-27', JSON.stringify(ph));
  const tpl = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_PRESEASON_TC')[0];
  check('★★★★★ 季前資料新主旨、第一段', /請在 \{ListConfirmBy\} 之前確認事奉人員表，申報連結將於 \{InviteDate\} 寄給事奉人員/.test(tpl.subject)
    && /<p>平安！請在 \{ListConfirmBy\} 之前確認以下的事奉人員表/.test(tpl.bodyHtml), tpl.subject);
  const inv = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_UNAVAILABLE_INVITE_TC')[0];
  check('★★★★★★ 申報連結信：「請在兩星期內（{Deadline} 之前）」及〔我這一季沒有不能服侍的日子〕',
    /請在兩星期內（\{Deadline\} 之前）/.test(inv.bodyHtml) && /請在兩星期內（\{Deadline\} 之前）/.test(inv.bodyPlain)
    && inv.bodyHtml.indexOf('〔我這一季沒有不能服侍的日子〕') !== -1);
}

console.log('\n=== RB2：開關、2027T1 ===');
{
  const sc = scene({});
  const g = sc.gas;
  check('★★★★★★ 預設關（UNAVAILABLE_INVITE_AUTO=FALSE）', g.isUnavailableInviteAutoOn_() === false);
  check('★★★★★★ 關 ⇒ 截止日照舊（生成日前 7 日）、季前資料照舊（PRESEASON_DAYS_BEFORE）', g.unavailableDeadlineFor_(sc.Q, G) === '2098-12-04'
    && g.preseasonDaysBeforeFor_(sc.Q) === 14);
  check('★★★★★ 關 ⇒ 季前資料確認期限＝生成日（照舊）', g.buildPreseasonPlaceholders_(sc.Q, { quarterLabel: '', html: '', plain: '' }, G).ListConfirmBy === G);
  const rep = sc.run('2098-11-27');
  check('★★★★★★ 關 ⇒ 每日檢查不做（DISABLED），不寄任何信', rep.length === 1 && rep[0].detail === 'DISABLED' && sc.mails.length === 0
    && sc.audits('UNAVAILABLE_INVITE_SENT').length === 0, JSON.stringify(rep));
  check('★★★★ 關 ⇒ 不靜默（照舊逐次通知）', g.isUnavailableSubmissionQuiet_(sc.Q, '2098-12-01', G) === false);

  // 2027T1 的做法：開始季度設在這一季之後 ⇒ 這一季永遠不自動寄
  const sc2 = scene(Object.assign({ UNAVAILABLE_INVITE_AUTO_FROM_QUARTER: ['2099T2', 'STR'] }, ON));
  const g2 = sc2.gas;
  check('★★★★★★ 開始季度之前的季度（例如 2027T1）：自動化開着也不寄、截止日照舊', sc2.run('2098-11-27')[0].detail === 'BEFORE_FROM_QUARTER'
    && sc2.run('2098-12-08')[0].detail === 'BEFORE_FROM_QUARTER' && sc2.run(G)[0].detail === 'BEFORE_FROM_QUARTER'
    && g2.unavailableDeadlineFor_(sc2.Q, G) === '2098-12-04' && g2.preseasonDaysBeforeFor_(sc2.Q) === 14 && sc2.mails.length === 0
    && sc2.audits('UNAVAILABLE_INVITE_SENT').length === 0);
  check('★★★★★ 開始季度及之後照用時間表', g2.isUnavailableScheduleQuarter_('2099T2') && g2.isUnavailableScheduleQuarter_('2100T1') && !g2.isUnavailableScheduleQuarter_('2099T1'));
  check('★★★★★★ Config 預設：開始季度 2027T2、14／7／3、靜默 TRUE、自動化 FALSE', (() => {
    const seed = {};
    const re = /key: CONFIG_KEYS\.(\w+), type: CONFIG_TYPES\.\w+, group: '\w+',\s*defaultValue: "([^"]*)"/g;
    let m;
    const src = read('src/ConfigSeed.gs');
    while ((m = re.exec(src))) seed[m[1]] = m[2];
    return seed.UNAVAILABLE_INVITE_AUTO === 'FALSE' && seed.UNAVAILABLE_INVITE_AUTO_FROM_QUARTER === '2027T2' && seed.UNAVAILABLE_INVITE_DAYS_BEFORE_GENERATE === '14'
      && seed.LIST_CONFIRM_DAYS_BEFORE_INVITE === '7' && seed.UNAVAILABLE_REMIND_DAYS_BEFORE_DEADLINE === '3' && seed.UNAVAILABLE_QUIET_DURING_WINDOW === 'TRUE';
  })());
}

console.log('\n=== RB3：每日檢查（DRY_RUN） ===');
{
  const sc = scene(ON);
  // G−21：季前資料（請確認事奉人員表）由 runPreseasonAutoSend_ 寄（日子用 preseasonDaysBeforeFor_）
  sc.today = '2098-11-19';
  const pre0 = sc.gas.runPreseasonAutoSend_(sc.qRow(), '2098-11-19', sc.gas.readConfig_());
  sc.today = '2098-11-20';
  const pre1 = sc.gas.runPreseasonAutoSend_(sc.qRow(), '2098-11-20', sc.gas.readConfig_());
  check('★★★★★★ G−21 才寄季前資料（G−22 未到）', pre0.outcome === 'SKIP' && pre1.outcome === 'SENT', JSON.stringify([pre0, pre1]));
  let rep = sc.run('2098-11-26');
  check('★★★★★ G−15：申報連結未到日子', step(rep, 'UNAVAILABLE_INVITE').detail === 'NOT_DUE' && sc.audits('UNAVAILABLE_INVITE_SENT').length === 0, JSON.stringify(rep));
  rep = sc.run('2098-11-27');
  const a = sc.audits('UNAVAILABLE_INVITE_SENT');
  check('★★★★★★ G−14：申報連結（DRY_RUN 只模擬；AuditLog AUTO…DRY_RUN）', step(rep, 'UNAVAILABLE_INVITE').outcome === 'SENT' && sc.mails.length === 0
    && a.length === 1 && /^AUTO\|2098-11-27\|DRY_RUN$/.test(a[0][sc.C.AUDIT_LOG.NEW_VALUE]), JSON.stringify(rep));
  rep = sc.run('2098-11-28');
  check('★★★★★★ 第二日不再寄（每季一次）', step(rep, 'UNAVAILABLE_INVITE').detail === 'ALREADY_DONE' && sc.audits('UNAVAILABLE_INVITE_SENT').length === 1);
  rep = sc.run('2098-12-08');
  check('★★★★★★ G−3：提醒一次', step(rep, 'UNAVAILABLE_REMIND').outcome === 'SENT' && sc.audits('UNAVAILABLE_REMIND_SENT').length === 1, JSON.stringify(rep));
  sc.run('2098-12-09');
  check('★★★★★ 提醒不重複', sc.audits('UNAVAILABLE_REMIND_SENT').length === 1);
  rep = sc.run(G);
  check('★★★★★★ G：申報期已完結（一次）', step(rep, 'UNAVAILABLE_WINDOW_CLOSED').outcome === 'SENT' && sc.audits('UNAVAILABLE_WINDOW_CLOSED').length === 1, JSON.stringify(rep));
  sc.run('2098-12-12');
  check('★★★★★ 完結通知不重複', sc.audits('UNAVAILABLE_WINDOW_CLOSED').length === 1);
  check('★★★★★ DRY_RUN：全程沒有寄出任何信', sc.mails.length === 0);

  // 上線之後（DRY_RUN=FALSE）：模擬過的步驟不算做過 ⇒ 仍然會真正寄一次
  sc.goLive();
  check('★★★★★ 模擬過的步驟在上線之後不算做過', sc.gas.hasUnavailableScheduleRecord_('UNAVAILABLE_INVITE_SENT', sc.Q) === false);

  // 錯過了申報連結的日子（例如生成日當日才開）⇒ 不補寄，提醒、完結通知亦不寄
  const late = scene(ON);
  rep = late.run(G);
  check('★★★★★ 生成日才第一次執行 ⇒ 申報連結不補寄（WINDOW_PASSED），提醒、完結通知不寄', step(rep, 'UNAVAILABLE_INVITE').detail === 'WINDOW_PASSED'
    && step(rep, 'UNAVAILABLE_WINDOW_CLOSED').detail === 'NOT_INVITED' && late.audits('UNAVAILABLE_INVITE_SENT').length === 0, JSON.stringify(rep));

  // 人手已真正寄出過 ⇒ 自動不再寄
  const manual = scene(ON);
  manual.gas.writeAuditLog_({ action: 'UNAVAILABLE_INVITE_SENT', targetSheet: 'Quarters', targetKey: manual.Q, newValue: 'MANUAL|2098-11-20|SENT', source: 'apiUnavailableInviteSend' });
  rep = manual.run('2098-11-27');
  check('★★★★★ 人手真正寄出過 ⇒ 自動不寄申報連結（但之後的提醒照做）', step(rep, 'UNAVAILABLE_INVITE').detail === 'ALREADY_DONE');

  // 已有版本 ⇒ 不做
  const ver = scene(ON);
  ver.gas.findLatestVersionNo_ = () => 0;
  rep = ver.run('2098-11-27');
  check('★★★★★ 已有版本 ⇒ 時間表不做（HAS_VERSION）', rep.length === 1 && rep[0].detail === 'HAS_VERSION');

  const trig = read('src/Trigger.gs');
  check('★★★★★★ dailyAutomationCheck_ 呼叫 runUnavailableScheduleSteps_（出錯只影響這一項）',
    /try \{\s*runUnavailableScheduleSteps_\(row, today, config, isDryRun\)\.forEach/.test(trig) && /申報時間表 ' \+ quarterId \+ ' 失敗/.test(trig));
}

console.log('\n=== RB4：〔我這一季沒有不能服侍的日子〕、提醒對象 ===');
{
  const sc = scene(ON, '2098-11-27');
  const g = sc.gas;
  sc.goLive();
  sc.run('2098-11-27');
  const invited = sc.mails.map((m) => m.to).sort();
  check('★★★★★ 申報連結真正寄出（每人一封、有個人連結）', invited.length >= 3 && sc.mails.every((m) => /p=[0-9a-f]{32}&q=2099T1/.test(m.body)), JSON.stringify(invited));
  check('★★★★★ 信內寫「請在兩星期內（2098-12-11 之前）」', sc.mails.every((m) => m.body.indexOf('請在兩星期內（2098-12-11 之前）') !== -1), sc.mails[0] && sc.mails[0].body);
  sc.today = '2098-12-01';
  // P9701 申報一個日子；P9702 按「沒有」；P9703 按了再改回
  const s1 = g.personalSubmitUnavailable(tok(1), sc.Q, [T1[1]], '');
  const r2 = g.personalReplyNoUnavailable(tok(2), sc.Q, sc.Q, true);
  check('★★★★★★ 按〔我這一季沒有不能服侍的日子〕⇒ 記錄、頁面顯示已回覆', s1.ok && r2.ok && r2.view.quarters.filter((q) => q.quarterId === sc.Q)[0].noneReplied === true, JSON.stringify(r2).slice(0, 400));
  const r3a = g.personalReplyNoUnavailable(tok(3), sc.Q, sc.Q, true);
  const r3b = g.personalReplyNoUnavailable(tok(3), sc.Q, sc.Q, false);
  check('★★★★★★ 可以改回（取消）', r3a.ok && r3b.ok && r3b.view.quarters.filter((q) => q.quarterId === sc.Q)[0].noneReplied === false);
  const rows = g.readSheet_('UnavailableReplies');
  check('★★★★★ UnavailableReplies：一人一季一行（P9702 ACTIVE、P9703 WITHDRAWN）', rows.length === 2
    && rows.filter((r) => r.PersonID === 'P9702')[0].Status === 'ACTIVE' && rows.filter((r) => r.PersonID === 'P9703')[0].Status === 'WITHDRAWN', JSON.stringify(rows));
  check('★★★★★ AuditLog UNAVAILABLE_NONE_REPLY 只寫 PersonID，不寫 token', sc.audits('UNAVAILABLE_NONE_REPLY').length === 3
    && JSON.stringify(sc.audits('UNAVAILABLE_NONE_REPLY')).indexOf(tok(2)) === -1);
  const bad = (() => { try { g.personalReplyNoUnavailable('f'.repeat(32), sc.Q, sc.Q, true); return false; } catch (e) { return true; } })();
  check('★★★★★★ 錯的 token ⇒ 中性錯誤，不寫', bad && g.readSheet_('UnavailableReplies').length === 2);
  const closedQ = g.personalReplyNoUnavailable(tok(4), sc.Q, '2090T1', true);
  check('★★★★★ 不是頁面上的季度 ⇒ 不可以回覆', closedQ.ok === false && g.readSheet_('UnavailableReplies').length === 2);
  // 確認畫面列出
  const cv = g.apiGetUnavailableConfirmView(sc.Q);
  check('★★★★★★ 確認畫面列出已回覆「沒有」的人（只列 ACTIVE）', JSON.stringify(cv.noneReplies) === JSON.stringify([{ quarterId: sc.Q, names: [sc.PEOPLE.P9702] }]), JSON.stringify(cv.noneReplies));
  // 提醒：只寄給還沒有回覆的人
  sc.mails.length = 0;
  sc.run('2098-12-08');
  const reminded = sc.mails.map((m) => m.to.split('@')[0].toUpperCase()).sort();
  check('★★★★★★ G−3 提醒不寄給已申報（P9701）、已按「沒有」（P9702）的人；改回的人（P9703）照寄',
    reminded.length > 0 && reminded.indexOf('P9701') === -1 && reminded.indexOf('P9702') === -1 && reminded.indexOf('P9703') !== -1, JSON.stringify(reminded));
  check('★★★★★ 提醒信用 TPL_UNAVAILABLE_REMIND_TC（主旨「提醒」、截止日）', sc.mails.every((m) => /提醒——請在 2098-12-11 之前申報不能服侍的主日/.test(m.subject)), sc.mails[0] && sc.mails[0].subject);
  check('★★★★★ AuditLog UNAVAILABLE_REMIND_SENT（AUTO…SENT）', /^AUTO\|2098-12-08\|SENT$/.test(sc.audits('UNAVAILABLE_REMIND_SENT')[0][sc.C.AUDIT_LOG.NEW_VALUE]));
  // 完結通知：幹事＋現任堂委；N 份待確認；深連結
  sc.mails.length = 0;
  sc.run(G);
  const closeMail = sc.mails[0] || {};
  check('★★★★★★ G：「申報期已完結：共 1 份申報待確認」寄給幹事（MAIL_ADMIN_NOTIFY）', sc.mails.length === 1 && /申報期已完結：共 1 份申報待確認/.test(closeMail.subject)
    && String(closeMail.to).indexOf('clerk@example.invalid') !== -1, JSON.stringify(sc.mails));
  check('★★★★★ 完結通知有確認畫面的深連結', /view=unavailable-confirm|不能服侍的日期/.test(closeMail.body), closeMail.body);
}

console.log('\n=== RB5：申報期內不逐次通知 ===');
{
  const sc = scene(ON);
  const g = sc.gas;
  check('★★★★★★ 時間表季度、截止日之前提交 ⇒ 靜默', g.isUnavailableSubmissionQuiet_(sc.Q, '2098-12-10', G) === true);
  check('★★★★★★ 截止日當日及之後提交 ⇒ 照舊逐次通知', g.isUnavailableSubmissionQuiet_(sc.Q, G, G) === false && g.isUnavailableSubmissionQuiet_(sc.Q, '2098-12-20', G) === false);
  const sc2 = scene(Object.assign({ UNAVAILABLE_QUIET_DURING_WINDOW: ['FALSE', 'BOOL'] }, ON));
  check('★★★★★ UNAVAILABLE_QUIET_DURING_WINDOW=FALSE ⇒ 照舊逐次通知', sc2.gas.isUnavailableSubmissionQuiet_(sc2.Q, '2098-12-10', G) === false);
  const pu = read('src/PersonalUnavailable.gs');
  check('★★★★★ 新申報通知過濾靜默的申報', /const fresh = pending\.filter\(function \(s\) \{ return \(!lastAt \|\| s\.submittedAt > lastAt\) && !quiet\(s\); \}\);/.test(pu));
}

console.log('\n=== RB6：範本、時間表、上線前檢查、個人頁 ===');
{
  const sc = scene(ON, '2098-11-01');
  const g = sc.gas;
  const ids = g.EMAIL_TEMPLATE_SEEDS.map((t) => t.templateId);
  check('★★★★★★ 新範本 TPL_UNAVAILABLE_REMIND_TC、TPL_UNAVAILABLE_WINDOW_CLOSED_TC', ids.indexOf('TPL_UNAVAILABLE_REMIND_TC') !== -1 && ids.indexOf('TPL_UNAVAILABLE_WINDOW_CLOSED_TC') !== -1);
  const byId = (id) => g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === id)[0];
  check('★★★★★ 兩個新範本用 {ContactName}、{Deadline}、{QuarterID}', ['TPL_UNAVAILABLE_REMIND_TC', 'TPL_UNAVAILABLE_WINDOW_CLOSED_TC'].every((id) =>
    ['{ContactName}', '{Deadline}', '{QuarterID}'].every((p) => byId(id).bodyHtml.indexOf(p) !== -1 && byId(id).bodyPlain.indexOf(p) !== -1)));
  check('★★★★★ 完結通知主旨「申報期已完結：共 {PendingCount} 份申報待確認」', /申報期已完結：共 \{PendingCount\} 份申報待確認/.test(byId('TPL_UNAVAILABLE_WINDOW_CLOSED_TC').subject));
  const plan = g.planEmailTemplateUpdate_();
  check('★★★★★ 〔更新電郵範本到最新版〕列出兩個新範本（未有）', JSON.stringify(plan).indexOf('TPL_UNAVAILABLE_REMIND_TC') !== -1
    && JSON.stringify(plan).indexOf('TPL_UNAVAILABLE_WINDOW_CLOSED_TC') !== -1);
  // 時間表
  const tt = g.buildAutomationTimetable_('2098-11-01');
  const t1 = tt.filter((q) => q.quarterId === '2099T1')[0];
  const it = (l) => t1.items.filter((i) => i.label === l)[0] || {};
  check('★★★★★★ 時間表：季前資料 G−21、申報連結 G−14、提醒 G−3、截止日 G、完結通知 G（每項寫收件人、開／關）',
    it('季前資料自動寄出日').date === '2098-11-20' && it('申報連結自動寄出日').date === '2098-11-27' && it('截止日前提醒').date === '2098-12-08'
    && it('申報截止日').date === G && it('申報期完結通知').date === G && it('申報連結自動寄出日').onOff === '開'
    && t1.items.every((i) => i.who && i.onOff), JSON.stringify(t1.items));
  const off = scene({}, '2098-11-01');
  const offIt = off.gas.buildAutomationTimetable_('2098-11-01').filter((q) => q.quarterId === '2099T1')[0].items;
  check('★★★★★ 自動化關 ⇒ 三步顯示「關」、截止日照舊', offIt.filter((i) => i.label === '申報連結自動寄出日')[0].onOff === '關'
    && offIt.filter((i) => i.label === '申報截止日')[0].date === '2098-12-04', JSON.stringify(offIt));
  const before = scene(Object.assign({ UNAVAILABLE_INVITE_AUTO_FROM_QUARTER: ['2099T2', 'STR'] }, ON), '2098-11-01');
  const bIt = before.gas.buildAutomationTimetable_('2098-11-01').filter((q) => q.quarterId === '2099T1')[0].items;
  check('★★★★★ 開始季度之前 ⇒ 寫明「人手（這一季不用申報時間表）」', bIt.filter((i) => i.label === '申報連結自動寄出日')[0].onOff === '人手（這一季不用申報時間表）');
  const daily = g.buildAutomationDailyItems_()[0];
  check('★★★★ 每日項目寫明申報期內不逐次通知', /申報期內（截止日之前）不逐次通知/.test(daily.who), daily.who);
  // 上線前檢查
  const pl = g.buildPreLaunchWebItems_().items.filter((i) => i.label === '申報時間表自動化（UNAVAILABLE_INVITE_AUTO）已開')[0];
  check('★★★★★★ 上線前檢查有 UNAVAILABLE_INVITE_AUTO 一項（開 ⇒ ✔）', pl && pl.ok === true && /由 2027T2 開始/.test(pl.value), JSON.stringify(pl));
  check('★★★★★ 自動化關 ⇒ ✘', off.gas.buildPreLaunchWebItems_().items.filter((i) => i.label === '申報時間表自動化（UNAVAILABLE_INVITE_AUTO）已開')[0].ok === false);
  // 個人頁
  const html = read('src/ui/PersonalRoster.html');
  check('★★★★★★ 個人頁有〔我這一季沒有不能服侍的日子〕及〔取消〕，呼叫 personalReplyNoUnavailable（帶 token）',
    html.indexOf("'我這一季沒有不能服侍的日子'") !== -1 && /runner\.personalReplyNoUnavailable\(token, quarterId, args\[0\], args\[1\]\)/.test(html)
    && /你已回覆：這一季沒有不能服侍的日子。/.test(html) && /call\('none', \[q\.quarterId, false\], view\)/.test(html));
  const z3 = read('src/ui/ScriptZone3.html');
  check('★★★★★ 確認畫面列出「已回覆『這一季沒有不能服侍的日子』」', /已回覆「這一季沒有不能服侍的日子」/.test(z3) && /d\.noneReplies \|\| \[\]/.test(z3));
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
