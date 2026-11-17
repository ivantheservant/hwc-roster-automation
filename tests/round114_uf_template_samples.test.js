// 第一百一十四輪批次 UF 組：〔寄出電郵範本樣本〕補上新通知。
// 執行方式：node tests/round114_uf_template_samples.test.js
//
//   UF1 樣本總數 22 → 28：多每週事奉提醒範本＋五種幹事通知（這一季已經開始、每週備份失敗、申報連結寄不出、
//       每週事奉提醒的「沒有電郵」摘要、每週事奉提醒寄不出）
//   UF2 每一封用正式寄出同一支砌文字的函式（樣本與正式通知的文字一樣）
//   UF3 每週事奉提醒樣本：日期、崗位、到場時間、個人連結；HTML 用 <br> 分行；沒有未代入的 {…}
// 用假資料，收件地址一律 example.invalid。

const fs = require('fs');
const path = require('path');
const { buildSendScene } = require('./helpers/send_scene.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const ADMIN = 'admin@example.invalid';

function scene() {
  const sc = buildSendScene('self@example.invalid', ['TemplateSamples.gs', 'PersonalLinkMessage.gs', 'UnavailableSchedule.gs', 'IcsExport.gs', 'PreseasonPack.gs',
    'UnavailableInvite.gs', 'PersonalUnavailable.gs', 'EmailTemplateSeed.gs', 'ChoirRule.gs', 'WeeklyReminder.gs', 'SpreadsheetBackup.gs', 'RolloutAudience.gs', 'PersonalLinkInMail.gs']);
  const g = sc.gas; const C = sc.C;
  const T = C.EMAIL_TEMPLATES;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_TEMPLATES));
  seedSheet(sc.ss, sc.S.EMAIL_TEMPLATES, Object.keys(T).map(() => ''), Object.keys(T).map((k) => T[k]),
    g.EMAIL_TEMPLATE_SEEDS.map((t) => ({ [T.TEMPLATE_ID]: t.templateId, [T.STAGE]: t.stage, [T.LANG]: t.lang, [T.SUBJECT]: t.subject,
      [T.BODY_HTML]: t.bodyHtml, [T.BODY_PLAIN]: t.bodyPlain, [T.PLACEHOLDERS]: t.placeholders, [T.ATTACH_TYPE]: t.attachType, [T.ACTIVE]: true })));
  g.MailApp = { sendEmail: function () {} };
  g.Utilities.newBlob = function (t, type, name) { return { text: t, getName: () => name, getBytes: () => Buffer.from(t), getDataAsString: () => t }; };
  g.assertNotPreviewMode_ = function () {};
  const realGetConfig = g.getConfig_;
  const cfg = { DRY_RUN: true, MAIL_ADMIN_NOTIFY: ADMIN, WEBAPP_ALLOWED_EMAILS: 'editor@example.invalid', MAIL_SUBJECT_PREFIX: '', ICS_SERVICE_START_TIME: '10:45' };
  g.getConfig_ = function (key, d) { return Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : realGetConfig(key, d); };
  g.buildPreseasonPack_ = function () { return { quarterLabel: '2099 年第一季', html: '<p>季前資料（假）</p>', plain: '季前資料（假）', sections: [] }; };
  return { sc: sc, g: g };
}

const s = scene();
const g = s.g; const sc = s.sc;
const built = g.buildTemplateSamples_(sc.Q, ADMIN);
const byName = {};
built.samples.forEach((x) => { byName[x.name] = x; });

console.log('\n=== UF1：樣本總數及新加的樣本 ===');
{
  check('★★★★★★ 樣本總數 22 → 28（15 個範本＋13 種幹事通知）', built.samples.length === 28
    && built.samples.filter((x) => x.kind === 'TEMPLATE').length === 15 && built.samples.filter((x) => x.kind === 'ADMIN').length === 13,
    built.samples.length + '：' + built.samples.map((x) => x.name).join('｜'));
  ['TPL_WEEKLY_REMINDER_TC', '幹事通知：階段提醒（這一季已經開始，系統內沒有職事表）', '幹事通知：每週備份失敗', '幹事通知：申報連結寄不出',
    '幹事通知：每週事奉提醒（沒有電郵的人）', '幹事通知：每週事奉提醒寄不出'].forEach((n) => {
    check('★★★★★★ 有「' + n + '」', !!byName[n]);
  });
}

console.log('\n=== UF2：與正式通知同一支砌文字的函式 ===');
{
  const date = g.weeklySampleDate_(sc.Q);
  const sh = byName['幹事通知：階段提醒（這一季已經開始，系統內沒有職事表）'];
  check('★★★★★★ 「這一季已經開始」：正式 notifyAdminStageReminder_ 的文字（第一個主日已過、請匯入、建立匯入表）',
    /這一季已經開始（第一個主日 2028-07-02），系統內沒有職事表；如果是人手排的，請匯入/.test(sh.bodyPlain) && /〔建立匯入表〕/.test(sh.bodyPlain), sh.bodyPlain);
  const today = g.Utilities.formatDate(new Date(), g.getConfig_(g.CONFIG_KEYS.SYS_TIMEZONE, 'Pacific/Auckland'), 'yyyy-MM-dd');
  const bk = g.buildBackupFailureNotifyText_('', today, '（示範錯誤訊息）找不到備份資料夾');
  check('★★★★★★ 每週備份失敗：主旨及內文＝buildBackupFailureNotifyText_()（正式通知同一支）', byName['幹事通知：每週備份失敗'].subject === bk.subject
    && byName['幹事通知：每週備份失敗'].bodyPlain.indexOf(bk.body) !== -1, byName['幹事通知：每週備份失敗'].subject);
  const inv = g.buildUnavailableInviteFailureText_('', sc.Q, 2, 10);
  check('★★★★★★ 申報連結寄不出：＝buildUnavailableInviteFailureText_()', byName['幹事通知：申報連結寄不出'].subject === inv.subject
    && byName['幹事通知：申報連結寄不出'].bodyPlain.indexOf(inv.body) !== -1);
  const ne = g.buildWeeklyReminderNoEmailText_('', sc.Q, date, [{ name: '示範甲', postNames: ['讀經', '司事'] }, { name: '示範乙', postNames: ['音響'] }]);
  check('★★★★★★ 每週事奉提醒（沒有電郵的人）：＝buildWeeklyReminderNoEmailText_()', byName['幹事通知：每週事奉提醒（沒有電郵的人）'].subject === ne.subject
    && byName['幹事通知：每週事奉提醒（沒有電郵的人）'].bodyPlain.indexOf(ne.body) !== -1);
  const wf = g.buildWeeklyReminderFailureText_('', sc.Q, date, 5);
  check('★★★★★★ 每週事奉提醒寄不出：＝buildWeeklyReminderFailureText_()', byName['幹事通知：每週事奉提醒寄不出'].subject === wf.subject
    && byName['幹事通知：每週事奉提醒寄不出'].bodyPlain.indexOf(wf.body) !== -1);
  check('★★★★★★ 正式通知用同一支：每週備份失敗（dailyBackupStep_）', /const text = buildBackupFailureNotifyText_\(String\(config\[CONFIG_KEYS\.MAIL_SUBJECT_PREFIX\] \|\| ''\), today, err\.message\);\n\s+notifyAdmin_\(text\.subject, text\.body/.test(read('src/SpreadsheetBackup.gs')));
  check('★★★★★★ 正式通知用同一支：申報連結寄不出（notifyUnavailableInviteFailureOnce_）', /const text = buildUnavailableInviteFailureText_\(String\(config\[CONFIG_KEYS\.MAIL_SUBJECT_PREFIX\] \|\| ''\), quarterId, result\.failed\.length, result\.sent\);\n\s+notifyAdmin_\(text\.subject, text\.body/.test(read('src/UnavailableSchedule.gs')));
  const wr = read('src/WeeklyReminder.gs');
  check('★★★★★★ 正式通知用同一支：每週事奉提醒（沒有電郵摘要、寄不出、每一封的佔位符）', /const text = buildWeeklyReminderNoEmailText_\(prefix, quarterId, serviceDate, noEmail\);/.test(wr)
    && /const text = buildWeeklyReminderFailureText_\(prefix, quarterId, serviceDate, failed\);/.test(wr) && /buildWeeklyReminderPlaceholders_\(e, quarterId, serviceDate, url, true\)/.test(wr));
}

console.log('\n=== UF3：每週事奉提醒樣本內容 ===');
{
  const w = byName.TPL_WEEKLY_REMINDER_TC;
  check('★★★★★★ 主旨及內文：日期「M 月 d 日（主日）的事奉」、崗位一行一個、如未能出席請聯絡、個人連結', /月 \d+ 日（主日）的事奉/.test(w.subject)
    && /提醒你在 \d+ 月 \d+ 日（主日）的事奉：\n・/.test(w.bodyPlain) && /如未能出席，請盡早聯絡/.test(w.bodyPlain) && /個人專屬連結/.test(w.bodyPlain), w.bodyPlain.slice(-500));
  check('★★★★★ HTML 版用 HTML 的佔位符（<br> 分行、個人連結是 <a> 連結）', /的事奉：<br>・/.test(w.bodyHtml) && /可以看這一季全部安排）：<br><a href="https:/.test(w.bodyHtml), w.bodyHtml.slice(-600));
  check('★★★★★ 沒有未代入的 {…}', !/\{[A-Za-z]+\}/.test(w.subject + w.bodyPlain + w.bodyHtml));
  check('★★★★ 樣本用正式的 buildWeeklyReminderPlaceholders_（純文字、HTML 各一次）', /placeholders = buildWeeklyReminderPlaceholders_\(entry, quarterId, sampleDate, url, false\);/.test(read('src/TemplateSamples.gs'))
    && /placeholdersHtml = buildWeeklyReminderPlaceholders_\(entry, quarterId, sampleDate, url, true\);/.test(read('src/TemplateSamples.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
