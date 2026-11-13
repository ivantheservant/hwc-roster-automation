// 第一百零一輪批次 ZB 組：電郵範本（照 Ivan 逐項）。
// 執行方式：node tests/round101_zb_email_templates.test.js
//
//   ZB1 寄信閘門最後防線：主旨、內文（HTML／純文字）、附件名稱有主試算表 ID ⇒ 不寄、拋錯、寫 AuditLog
//   ZB2 {SpreadsheetUrl} 全部刪除；新佔位符 {VersionLabel}、{ContactName}（Config ROSTER_CONTACT_TC）
//   ZB3 公開連結那一行一律「{QuarterID} 職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）：」，每封信最多一次；
//       個人專屬連結那一行「你的職事表預覽，亦可以在此申報你哪些日子不能事奉：」，第一階段非堂委／執事／幹事 ⇒「（只供查看）」
//   ZB4 逐個範本（GENERATE、REMIND、OFFICIAL、REVIEW、RESEND_LIST、OFFICIAL_LIST、邀請「怎樣申報」和個人連結頁一致）
//   ZB5 幹事通知：生成完成用幹事介面做法；「沒有電郵名單」「階段提醒」Config 開關（預設 FALSE＝不寄，只寫 AuditLog）
//   ZB6〔更新電郵範本到最新版〕：差異、勾選、先備份再覆寫、再比對沒有差異；〔預覽電郵範本〕不寄
// 用假資料、example.invalid。

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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FAKE_ID = ['FAKEID', 'abcdefghij', 'klmnopqrst'].join('-');   // 假的試算表 ID（分段寫，免得敏感資料掃描當作真 ID）
const PREVIEW_LINE = '職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）';

function scene(opts) {
  opts = opts || {};
  const sc = buildSendScene('editor@example.invalid', ['TemplateSamples.gs', 'UnavailableSchedule.gs', 'IcsExport.gs', 'PreseasonPack.gs', 'UnavailableInvite.gs',
    'PersonalUnavailable.gs', 'EmailTemplateSeed.gs', 'EmailTemplateUpdate.gs', 'ChoirRule.gs', 'ResendFlow.gs', 'Trigger.gs']);
  const g = sc.gas; const C = sc.C;
  const T = C.EMAIL_TEMPLATES;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_TEMPLATES));
  const rows = (opts.templateRows || g.EMAIL_TEMPLATE_SEEDS.map((t) => ({ [T.TEMPLATE_ID]: t.templateId, [T.STAGE]: t.stage, [T.LANG]: t.lang,
    [T.SUBJECT]: t.subject, [T.BODY_HTML]: t.bodyHtml, [T.BODY_PLAIN]: t.bodyPlain, [T.PLACEHOLDERS]: t.placeholders,
    [T.ATTACH_TYPE]: t.attachType, [T.ACTIVE]: true })));
  seedSheet(sc.ss, sc.S.EMAIL_TEMPLATES, Object.keys(T).map(() => ''), Object.keys(T).map((k) => T[k]), rows);
  const log = { sent: [] };
  g.MailApp = { sendEmail: function () { log.sent.push(Array.prototype.slice.call(arguments)); } };
  g.Utilities.newBlob = function (t, type, name) { return { text: t, getName: function () { return name; }, getBytes: function () { return Buffer.from(t); }, getDataAsString: function () { return t; } }; };
  g.assertNotPreviewMode_ = function () {};
  g.assertWebAppRequestAllowed_ = function () {};
  const realGetConfig = g.getConfig_;
  const cfg = Object.assign({ DRY_RUN: true, MAIL_ADMIN_NOTIFY: 'admin@example.invalid', WEBAPP_ALLOWED_EMAILS: 'editor@example.invalid',
    MAIL_REDIRECT_ALL_TO: '', MAIL_SUBJECT_PREFIX: '', ROSTER_SPREADSHEET_ID: FAKE_ID,
    WEBAPP_STEWARD_URL: 'https://example.invalid/admin/exec' }, opts.config || {});
  g.getConfig_ = function (key, d) { return Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : realGetConfig(key, d); };
  g.buildPreseasonPack_ = function () { return { quarterLabel: '2099 年第一季', html: '<p>季前資料（假）</p>', plain: '季前資料（假）', sections: [] }; };
  return { sc: sc, g: g, log: log, cfg: cfg };
}
function auditActions(s) {
  return s.g.readSheet_(s.sc.S.AUDIT_LOG).map((r) => r[s.sc.C.AUDIT_LOG.ACTION]);
}

console.log('\n=== ZB1：寄信閘門最後防線 ===');
{
  const s = scene();
  const g = s.g;
  check('★★★★★ 純函式：主旨／純文字／HTML／附件名稱各自找得到；沒有 ⇒ 空字串',
    g.findSpreadsheetIdLeak_({ subject: 'a' + FAKE_ID, bodyPlain: '' }, [FAKE_ID]) === '主旨'
    && g.findSpreadsheetIdLeak_({ subject: '', bodyPlain: 'x/' + FAKE_ID + '/edit' }, [FAKE_ID]) === '純文字內文'
    && g.findSpreadsheetIdLeak_({ subject: '', bodyPlain: '', bodyHtml: '<a href="' + FAKE_ID + '">' }, [FAKE_ID]) === 'HTML 內文'
    && g.findSpreadsheetIdLeak_({ subject: '', bodyPlain: '', attachmentNames: [FAKE_ID + '.pdf'] }, [FAKE_ID]) === '附件名稱'
    && g.findSpreadsheetIdLeak_({ subject: 'ok', bodyPlain: 'ok', bodyHtml: 'ok' }, [FAKE_ID]) === '');
  check('★★★★ 太短的值不算 ID（避免誤擋）', JSON.stringify(s.g.readBlockedSpreadsheetIds_().filter((x) => x.length < 20)) === '[]');
  [['主旨', { subject: '看 ' + FAKE_ID, bodyPlain: 'x' }],
    ['純文字內文', { subject: 's', bodyPlain: 'https://docs.google.com/spreadsheets/d/' + FAKE_ID + '/edit' }],
    ['HTML 內文', { subject: 's', bodyPlain: 'x', bodyHtml: '<p>' + FAKE_ID + '</p>' }],
    ['附件名稱', { subject: 's', bodyPlain: 'x', options: { attachments: [g.Utilities.newBlob('x', 'application/pdf', FAKE_ID + '.pdf')] } }]
  ].forEach(([where, m]) => {
    s.log.sent.length = 0;
    let err = null;
    try { g.sendMailThroughGate_(Object.assign({ to: 'someone@example.invalid', displayName: 'x' }, m)); } catch (e) { err = e; }
    check('★★★★★★ ' + where + '有主試算表 ID ⇒ 不寄、拋錯', err && /主試算表/.test(err.message) && s.log.sent.length === 0, err && err.message);
  });
  const audit = s.g.readSheet_(s.sc.S.AUDIT_LOG).filter((r) => r[s.sc.C.AUDIT_LOG.ACTION] === 'MAIL_BLOCKED_SPREADSHEET_ID');
  check('★★★★★ 每次擋住都寫 AuditLog MAIL_BLOCKED_SPREADSHEET_ID（不寫 ID 本身）', audit.length === 4
    && audit.every((r) => JSON.stringify(r).indexOf(FAKE_ID) === -1), audit.length);
  s.log.sent.length = 0;
  g.sendMailThroughGate_({ to: 'someone@example.invalid', subject: '正常', bodyPlain: '正常內容' });
  check('★★★★★ 沒有 ID ⇒ 照寄', s.log.sent.length === 1);
  check('★★★★★ 閘門第一步就檢查', /function sendMailThroughGate_\(mail\) \{\n\s*assertNoSpreadsheetIdInMail_\(mail\);/.test(read('src/MailRedirect.gs').replace(/\r/g, '')));
}

console.log('\n=== ZB2：{SpreadsheetUrl} 刪除；{VersionLabel}、{ContactName} ===');
{
  const s = scene();
  const g = s.g;
  check('★★★★★★ 所有範本種子都沒有 {SpreadsheetUrl}', g.EMAIL_TEMPLATE_SEEDS.every((t) => JSON.stringify(t).indexOf('SpreadsheetUrl') === -1));
  const mailer = read('src/Mailer.gs');
  const mailerCode = mailer.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
  check('★★★★★★ 寄信 context、提醒信尾都不再放主試算表網址', !/SpreadsheetUrl:\s*SpreadsheetApp/.test(mailerCode)
    && mailerCode.indexOf('getActiveSpreadsheet().getUrl()') === -1);
  check('★★★★★ context 有 VersionLabel（例如 2028T3v1）、ContactName', /VersionLabel: quarterId \+ 'v' \+ versionNo/.test(mailer) && /ContactName: readRosterContactName_\(\)/.test(mailer));
  check('★★★★★ ContactName 預設「幹事」', g.readRosterContactName_() === '幹事');
  s.cfg.ROSTER_CONTACT_TC = '示範幹事';
  check('★★★★★★ Config ROSTER_CONTACT_TC ⇒ 範本 {ContactName} 代入（沒有在 placeholders 給也讀 Config）',
    g.applyPlaceholders_('請與{ContactName}聯絡', {}, { displayName: 'x' }, '') === '請與示範幹事聯絡');
}

console.log('\n=== ZB3：公開連結、個人連結那一行 ===');
{
  const s = scene();
  const g = s.g;
  const plain = g.appendPermanentLinkFooter_('內文', '內文', 'https://example.invalid/p/preview', false, '2099T1');
  check('★★★★★★ 信末公開連結：「2099T1 職事表預覽（只供查看，不能修改；內容更新後打開就是最新版）：」',
    plain === '內文\n\n2099T1 ' + PREVIEW_LINE + '：\nhttps://example.invalid/p/preview', plain);
  const html = g.appendPermanentLinkFooter_('x', 'x', 'https://example.invalid/p/preview', true, '2099T1');
  check('★★★★★ HTML 版名稱粗體', html.indexOf('<strong>2099T1 職事表預覽</strong>（只供查看，不能修改；內容更新後打開就是最新版）：') !== -1, html);
  check('★★★★★ 範本已有 {PublicRosterUrl} ⇒ 不再加（每封最多一次）',
    g.appendPermanentLinkFooter_('a', '{PublicRosterUrl}', 'https://example.invalid/p', false, '2099T1') === 'a');
  check('★★★★★★ 個人連結：「你的職事表預覽，亦可以在此申報你哪些日子不能事奉：」',
    g.appendPersonalLinkFooter_('x', 'https://example.invalid/v?p=T', false) === 'x\n\n你的職事表預覽，亦可以在此申報你哪些日子不能事奉：\nhttps://example.invalid/v?p=T');
  check('★★★★★★ 第一階段非堂委／執事／幹事：「你的職事表預覽（只供查看）：」',
    g.appendPersonalLinkFooter_('x', 'https://example.invalid/v?p=T', false, false) === 'x\n\n你的職事表預覽（只供查看）：\nhttps://example.invalid/v?p=T');
  // 判斷：LEADERS（預設）
  const ctx = { timezone: s.sc.TZ };
  check('★★★★★★ LEADERS：堂委 P9701、執事 P9702、幹事（CLERK）P9704 ⇒ 可以申報；一般事奉人員 P9705 ⇒ 只供查看',
    g.isMailDeclareAllowed_(ctx, 'P9701') && g.isMailDeclareAllowed_(ctx, 'P9702') && g.isMailDeclareAllowed_(ctx, 'P9704')
    && !g.isMailDeclareAllowed_(ctx, 'P9705') && !g.isMailDeclareAllowed_(ctx, 'P9703'));
  s.cfg.ROLLOUT_AUDIENCE = 'ALL';
  check('★★★★★ ALL ⇒ 全部可以申報', g.isMailDeclareAllowed_({ timezone: s.sc.TZ }, 'P9705'));
  const mailer = read('src/Mailer.gs').replace(/\r/g, '');
  check('★★★★★ 正式寄信（deliverOne_）兩行都用新寫法（HTML、純文字）', /personalUrl, true, canDeclare\),\n\s*template\.bodyHtml, permanentLink, true, context\.quarterId\)/.test(mailer)
    && /personalUrl, false, canDeclare\),\n\s*template\.bodyPlain, permanentLink, false, context\.quarterId\)/.test(mailer)
    && /const canDeclare = !personalUrl \|\| isMailDeclareAllowed_\(context, recipient\.personId\);/.test(mailer));
  // 其他範本或程式內同類字眼
  const hits = [];
  ['src', 'src/ui'].forEach((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(gs|html)$/.test(f)).forEach((f) => {
    read(d + '/' + f).split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\/?\*)/.test(l)) return;
      if (/你自己那一份|這一季職事表的固定連結/.test(l)) hits.push(d + '/' + f + ':' + (i + 1));
    });
  }));
  check('★★★★★ src 沒有「你自己那一份」「這一季職事表的固定連結」', hits.length === 0, hits.join('\n'));
}

console.log('\n=== ZB3：每封信最多一次（範本樣本＝正式寄信的同一套組裝）===');
{
  const s = scene();
  const g = s.g;
  g.resolvePublicRosterUrlForPlaceholder_ = () => 'https://example.invalid/pub/preview';
  const r = g.buildTemplateSamples_(s.sc.Q, 'admin@example.invalid');
  const over = r.samples.filter((x) => (x.bodyPlain.split('職事表預覽（只供查看，不能修改').length - 1) > 1);
  check('★★★★★★ 每一封樣本的公開連結那一行最多一次', over.length === 0, over.map((x) => x.name).join('、'));
  const offi = r.samples.filter((x) => x.name === 'TPL_OFFICIAL_TC')[0];
  check('★★★★★ 正式發出個人信有公開連結那一行（信末）', offi && offi.bodyPlain.indexOf(s.sc.Q + ' ' + PREVIEW_LINE) !== -1, offi && offi.bodyPlain);
  check('★★★★★ 沒有任何一封有「試算表連結」', r.samples.every((x) => x.bodyPlain.indexOf('試算表連結') === -1));
}

console.log('\n=== ZB4：逐個範本 ===');
{
  const g = scene().g;
  const byId = {};
  g.EMAIL_TEMPLATE_SEEDS.forEach((t) => { byId[t.templateId] = t; });
  const both = (t, s) => t.bodyHtml.replace(/<[^>]+>/g, '').indexOf(s) !== -1 && t.bodyPlain.indexOf(s) !== -1;
  const gen = byId.TPL_GENERATE_TC;
  check('★★★★★★ GENERATE：「…已生成，請按以下連結預覽。」下一行是職事表預覽；沒有「請登入試算表覆核」',
    gen && both(gen, '的職事表初稿已生成，請按以下連結預覽。') && gen.bodyPlain.indexOf('請按以下連結預覽。\n\n{QuarterID} ' + PREVIEW_LINE + '：{PublicRosterUrl}') !== -1
    && JSON.stringify(gen).indexOf('請登入試算表覆核') === -1);
  check('★★★★★★ GENERATE：「如需修改，請與{ContactName}聯絡，由幹事統一修改；任何人都不可以直接修改試算表。」',
    both(gen, '如需修改，請與{ContactName}聯絡，由幹事統一修改；任何人都不可以直接修改試算表。') && JSON.stringify(gen).indexOf('請直接在試算表上編輯') === -1);
  const rem = byId.TPL_REMIND_TC;
  check('★★★★★ REMIND：事奉人員；「如需修改，請於該日之前與{ContactName}聯絡。」；有職事表預覽',
    both(rem, '正式發給各位事奉人員') && both(rem, '如需修改，請於該日之前與{ContactName}聯絡。') && rem.bodyPlain.indexOf(PREVIEW_LINE) !== -1
    && JSON.stringify(rem).indexOf('請於該日之前完成') === -1);
  const off = byId.TPL_OFFICIAL_TC;
  check('★★★★★★ OFFICIAL：主旨「{QuarterID} 粵語堂主日職事表（定稿）」；聯絡人用 {ContactName}',
    off.subject === '{QuarterID} 粵語堂主日職事表（定稿）' && both(off, '請與{ContactName}聯絡'));
  const rev = byId.TPL_REVIEW_TC;
  check('★★★★★★ REVIEW：沒有「試算表連結」、沒有「請勿直接修改試算表上的儲存格」', JSON.stringify(rev).indexOf('試算表連結') === -1
    && JSON.stringify(rev).indexOf('請勿直接修改試算表上的儲存格') === -1);
  const rl = byId.TPL_RESEND_LIST_TC;
  check('★★★★★★ RESEND_LIST：主旨「{QuarterID} 粵語堂職事表已改動重發（{VersionLabel}）——本輪異動摘要」；第一句有「（版本 {VersionLabel}）」',
    rl.subject === '{QuarterID} 粵語堂職事表已改動重發（{VersionLabel}）——本輪異動摘要' && both(rl, '已重新發出（版本 {VersionLabel}）'));
  const ol = byId.TPL_OFFICIAL_LIST_TC;
  check('★★★★★★ OFFICIAL_LIST：刪了兩段', JSON.stringify(ol).indexOf('試算表連結') === -1 && JSON.stringify(ol).indexOf('請勿直接修改') === -1);
  // 邀請「怎樣申報」和個人連結頁一致
  const how = g.UNAVAILABLE_INVITE_HOW_TO_TEXT;
  const inv = byId.TPL_UNAVAILABLE_INVITE_TC;
  check('★★★★★ 邀請信 HTML、純文字都用同一段「怎樣申報」', inv.bodyHtml.indexOf(how) !== -1 && inv.bodyPlain.indexOf(how) !== -1);
  const page = read('src/ui/PersonalRoster.html');
  const statusTexts = Object.keys(g.UNAVAILABLE_SUBMISSION_STATUS_TC).map((k) => g.UNAVAILABLE_SUBMISSION_STATUS_TC[k]);
  const names = (how.match(/「[^」]+」|〔[^〕]+〕/g) || []).map((x) => x.slice(1, -1));
  const missing = names.filter((n) => page.indexOf(n) === -1 && statusTexts.indexOf(n) === -1);
  check('★★★★★★ 自我檢查：「怎樣申報」引用的每個「」〔〕名稱都在個人連結頁出現（狀態字眼在 UNAVAILABLE_SUBMISSION_STATUS_TC）——日後改頁面要同步改範本',
    names.length >= 5 && missing.length === 0, '找不到：' + missing.join('、'));
}

console.log('\n=== ZB5：幹事通知 ===');
{
  const s = scene();
  const g = s.g;
  const got = g.captureAdminNotifications_(() => g.notifyAdminGenerateDone_(s.sc.Q, { sheetName: 'x' }, { MAIL_SUBJECT_PREFIX: '', MAIL_ADMIN_NOTIFY: 'admin@example.invalid' }, true));
  const body = got[0].body;
  check('★★★★★★ 生成完成：沒有「請登入試算表」「職事表系統 →」「步驟 2 的責任」', body.indexOf('請登入試算表') === -1 && body.indexOf('職事表系統') === -1 && body.indexOf('步驟 2 的責任') === -1, body);
  check('★★★★★★ 生成完成：幹事介面深連結、選季度、按鈕名稱', body.indexOf('https://example.invalid/admin/exec?quarter=' + s.sc.Q) !== -1
    && /季度選單選「/.test(body) && body.indexOf('〔查看／修改職事表〕') !== -1 && body.indexOf('〔寄給堂委／執事〕') !== -1, body);
  const ui = read('src/ui/ScriptMainFlow.html');
  check('★★★★★ 通知內的按鈕名稱真的在畫面上（由原始碼讀）', ["stepButton('查看／修改職事表'", "stepButton('寄給堂委／執事'", "title: '寄出'", "title: '查看／修改職事表'"].every((x) => ui.indexOf(x) !== -1));
  // 開關
  let calls = 0;
  const realNotify = g.notifyAdmin_;
  g.notifyAdmin_ = function () { calls++; };
  check('★★★★★★ 「沒有電郵名單」預設 FALSE ⇒ 不寄', g.notifyAdminNoEmailIfEnabled_(['甲'], { quarterId: s.sc.Q, subjectPrefix: '', adminEmail: 'a@example.invalid' }, true) === false && calls === 0);
  check('★★★★★★ 「階段提醒」預設 FALSE ⇒ 不寄', g.notifyAdminStageReminderIfEnabled_(s.sc.Q, { stage: 'DRAFT', reasons: ['STUCK'] }, {}, true) === false && calls === 0);
  check('★★★★★ 兩次都寫 AuditLog ADMIN_NOTIFY_SKIPPED', auditActions(s).filter((a) => a === 'ADMIN_NOTIFY_SKIPPED').length === 2);
  s.cfg.ADMIN_NOTIFY_NO_EMAIL = true;
  s.cfg.ADMIN_NOTIFY_STAGE_REMINDERS = true;
  g.notifyAdminStageReminder_ = function () { calls++; };
  check('★★★★★ 開了 ⇒ 照寄', g.notifyAdminNoEmailIfEnabled_(['甲'], { quarterId: s.sc.Q, subjectPrefix: '', adminEmail: 'a@example.invalid' }, true) === true
    && g.notifyAdminStageReminderIfEnabled_(s.sc.Q, { stage: 'DRAFT', reasons: [] }, {}, true) === true && calls === 2);
  g.notifyAdmin_ = realNotify;
  const trig = read('src/Trigger.gs');
  check('★★★★★ 每日檢查用有開關的那一支；寄出、改動後重發的「沒有電郵名單」也是',
    /notifyAdminStageReminderIfEnabled_\(quarterId, remindJudgment/.test(trig) && trig.indexOf('notifyAdminStageReminder_(quarterId, remindJudgment') === -1
    && /notifyAdminNoEmailIfEnabled_\(noEmailPeople/.test(read('src/Mailer.gs')) && /notifyAdminNoEmailIfEnabled_\(noEmailPeople/.test(read('src/ResendFlow.gs')));
  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ Config 種子：ROSTER_CONTACT_TC（幹事）、ADMIN_NOTIFY_NO_EMAIL、ADMIN_NOTIFY_STAGE_REMINDERS（FALSE）',
    /CONFIG_KEYS\.ROSTER_CONTACT_TC[\s\S]{0,120}defaultValue: '幹事'/.test(seed) && /CONFIG_KEYS\.ADMIN_NOTIFY_NO_EMAIL[\s\S]{0,120}defaultValue: 'FALSE'/.test(seed)
    && /CONFIG_KEYS\.ADMIN_NOTIFY_STAGE_REMINDERS[\s\S]{0,120}defaultValue: 'FALSE'/.test(seed));
}

console.log('\n=== ZB6：〔更新電郵範本到最新版〕===');
{
  // 試算表上：REVIEW 是舊文字（有試算表連結）、GENERATE 沒有這一行、其餘和最新版一樣
  const g0 = scene().g;
  const T = { TEMPLATE_ID: 'TemplateID', STAGE: 'Stage', LANG: 'Lang', SUBJECT: 'Subject', BODY_HTML: 'BodyHtml', BODY_PLAIN: 'BodyPlain', PLACEHOLDERS: 'Placeholders', ATTACH_TYPE: 'AttachType', ACTIVE: 'Active' };
  const rows = g0.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId !== 'TPL_GENERATE_TC').map((t) => ({ [T.TEMPLATE_ID]: t.templateId, [T.STAGE]: t.stage, [T.LANG]: t.lang,
    [T.SUBJECT]: t.subject, [T.BODY_HTML]: t.templateId === 'TPL_REVIEW_TC' ? '<p>試算表連結：{SpreadsheetUrl}</p>' : t.bodyHtml,
    [T.BODY_PLAIN]: t.templateId === 'TPL_REVIEW_TC' ? '' : t.bodyPlain, [T.PLACEHOLDERS]: t.placeholders,
    [T.ATTACH_TYPE]: t.templateId === 'TPL_REVIEW_TC' ? 'NONE' : t.attachType, [T.ACTIVE]: true }));
  rows.splice(2, 0, {});   // 中間有一行空白（行號不可以因此錯位）
  const s = scene({ templateRows: rows });
  const g = s.g;
  const plan = g.planEmailTemplateUpdate_();
  const st = {};
  plan.items.forEach((x) => { st[x.templateId] = x.status; });
  check('★★★★★★ 比對：REVIEW＝有差異、GENERATE＝工作表沒有、其他＝已是最新版', st.TPL_REVIEW_TC === 'DIFF' && st.TPL_GENERATE_TC === 'MISSING'
    && plan.items.filter((x) => x.status === 'SAME').length === plan.items.length - 2, JSON.stringify(st));
  const rev = plan.items.filter((x) => x.templateId === 'TPL_REVIEW_TC')[0];
  check('★★★★★ 差異逐欄列出「現時」「最新版」（內文 HTML、純文字）', rev.diffs.map((d) => d.label).join('／') === '內文（HTML）／內文（純文字）'
    && rev.diffs[0].current.indexOf('試算表連結') !== -1);
  const r = g.applyEmailTemplateUpdate_(['TPL_REVIEW_TC']);
  check('★★★★★★ 只更新勾選了的（REVIEW），GENERATE 沒有勾 ⇒ 不新增', JSON.stringify(r.updated) === '["TPL_REVIEW_TC"]' && r.added.length === 0);
  const bk = g.readSheet_('EmailTemplates_Backup');
  check('★★★★★★ 先把舊內容整行備份到 EmailTemplates_Backup（加時間）', bk.length === 1 && bk[0].TemplateID === 'TPL_REVIEW_TC'
    && String(bk[0].BodyHtml).indexOf('試算表連結') !== -1 && String(bk[0].BackedUpAt) !== '', JSON.stringify(bk));
  const after = g.readSheet_(s.sc.S.EMAIL_TEMPLATES).filter((x) => x.TemplateID === 'TPL_REVIEW_TC')[0];
  const seedRev = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_REVIEW_TC')[0];
  check('★★★★★★ 覆寫了內文；AttachType 不改', after.BodyHtml === seedRev.bodyHtml && after.BodyPlain === seedRev.bodyPlain && after.AttachType === 'NONE');
  const other = g.readSheet_(s.sc.S.EMAIL_TEMPLATES).filter((x) => x.TemplateID === 'TPL_OFFICIAL_TC')[0];
  check('★★★★★ 空白行之後的行沒有被寫錯', other && other.Subject === '{QuarterID} 粵語堂主日職事表（定稿）');
  g.applyEmailTemplateUpdate_(['TPL_GENERATE_TC']);
  const plan2 = g.planEmailTemplateUpdate_();
  check('★★★★★★ 全部做完再比對一次 ⇒ 沒有差異', plan2.diffCount === 0 && plan2.missingCount === 0, JSON.stringify(plan2.items.filter((x) => x.status !== 'SAME').map((x) => x.templateId)));
  check('★★★★★ AuditLog EMAIL_TEMPLATES_UPDATED', auditActions(s).filter((a) => a === 'EMAIL_TEMPLATES_UPDATED').length === 2);
  const none = g.applyEmailTemplateUpdate_([]);
  check('★★★★ 一個都沒有勾 ⇒ 不改', none.updated.length === 0 && /沒有選擇/.test(none.message));
  // 預覽（不寄）
  s.log.sent.length = 0;
  g.resolvePublicRosterUrlForPlaceholder_ = () => 'https://example.invalid/pub/preview';
  const pv = g.apiPreviewTemplateSamples(s.sc.Q);
  check('★★★★★★ 〔預覽電郵範本〕不寄任何信，每封都檢查了 ID、舊用字、試算表連結', s.log.sent.length === 0 && pv.samples.length >= 10
    && pv.samples.every((x) => x.hasSpreadsheetId === false && x.hasOldWord === false && x.hasSheetLink === false), JSON.stringify(pv.samples.filter((x) => x.hasSpreadsheetId || x.hasOldWord || x.hasSheetLink).map((x) => x.name)));
  // 入口及權限
  const z4 = read('src/ui/ScriptZone4.html');
  check('★★★★★ 進階與診斷「設定及電郵範本」：〔補建設定及範本〕旁邊〔預覽電郵範本〕〔更新電郵範本到最新版〕〔寄出電郵範本樣本〕', /sectionTitle\('設定及電郵範本'\),[\s\S]{0,300}zone4Row\('補建設定及範本'[\s\S]{0,300}zone4Row\('預覽電郵範本'[\s\S]{0,400}zone4Row\('更新電郵範本到最新版'[\s\S]{0,400}zone4Row\('寄出電郵範本樣本'/.test(z4));
  const web = read('src/WebApp.gs');
  const upd = read('src/EmailTemplateUpdate.gs');
  check('★★★★★ 比對、預覽是唯讀 api（伺服器及前端兩邊登記）；套用是改動 api（鎖）', /'apiPlanEmailTemplateUpdate', 'apiPreviewTemplateSamples'/.test(web)
    && /'apiPlanEmailTemplateUpdate',/.test(read('src/ui/Script.html')) && /function apiApplyEmailTemplateUpdate\(selectedIds\) \{\s*assertWebAppRequestAllowed_\(\);\s*return withMutationLock_\(/.test(upd));
  check('★★★★ 前端已載入 ScriptZone5', /includeHtml\('ui\/ScriptZone5'\)/.test(read('src/ui/Index.html')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
