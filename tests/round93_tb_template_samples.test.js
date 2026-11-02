// 第九十三輪批次 TB 組：〔寄出電郵範本樣本〕。
// 執行方式：node tests/round93_tb_template_samples.test.js
//
//   TB1 收件人限制：只可以是 MAIL_ADMIN_NOTIFY／WEBAPP_ALLOWED_EMAILS／MAIL_REDIRECT_ALL_TO 之一，其他一律拒絕、一封都不寄
//   TB2 內容：EmailTemplates 每一行（8 個範本）＋七種幹事通知，每種一封；主旨「[範本樣本 n/N] 名稱｜…」；灰框；不附 PDF 的說明；日曆檔
//   TB3 DRY_RUN＝TRUE 也寄，但只寄給該收件人；不經轉寄（即使 MAIL_REDIRECT_ALL_TO 有值）
//   TB4 紀錄：AuditLog TEMPLATE_SAMPLES_SENT；不寫 SendLog；不改階段
//   TB5 沒有版本 ⇒ 示範資料並寫明；入口：幹事介面「進階與診斷」新一行＋選單「維護」同名項目；權限＝可以修改
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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ADMIN = 'admin@example.invalid';
const EDITOR = 'editor@example.invalid';
const REDIRECT = 'redirect@example.invalid';

function scene(opts) {
  opts = opts || {};
  const sc = buildSendScene('self@example.invalid', ['TemplateSamples.gs', 'IcsExport.gs', 'PreseasonPack.gs', 'UnavailableInvite.gs',
    'PersonalUnavailable.gs', 'EmailTemplateSeed.gs', 'ChoirRule.gs']);
  const g = sc.gas; const C = sc.C;
  // EmailTemplates：種子 8 個範本（Active）
  const T = C.EMAIL_TEMPLATES;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_TEMPLATES));
  seedSheet(sc.ss, sc.S.EMAIL_TEMPLATES, Object.keys(T).map(() => ''), Object.keys(T).map((k) => T[k]),
    g.EMAIL_TEMPLATE_SEEDS.slice(0, opts.rows || 99).map((t) => ({ [T.TEMPLATE_ID]: t.templateId, [T.STAGE]: t.stage, [T.LANG]: t.lang, [T.SUBJECT]: t.subject,
      [T.BODY_HTML]: t.bodyHtml, [T.BODY_PLAIN]: t.bodyPlain, [T.PLACEHOLDERS]: t.placeholders, [T.ATTACH_TYPE]: t.attachType, [T.ACTIVE]: true })));
  const log = { sent: [] };
  g.MailApp = { sendEmail: function () { log.sent.push(Array.prototype.slice.call(arguments)); } };
  g.Utilities.newBlob = function (t, type, name) { return { text: t, getName: function () { return name; }, getBytes: function () { return Buffer.from(t); }, getDataAsString: function () { return t; } }; };
  g.assertNotPreviewMode_ = function () {};
  g.assertWebAppRequestAllowed_ = function () {};
  const realGetConfig = g.getConfig_;
  const cfg = Object.assign({ DRY_RUN: opts.dryRun === undefined ? true : opts.dryRun, MAIL_ADMIN_NOTIFY: ADMIN, WEBAPP_ALLOWED_EMAILS: EDITOR,
    MAIL_REDIRECT_ALL_TO: opts.redirect === undefined ? REDIRECT : opts.redirect, MAIL_SUBJECT_PREFIX: '' }, opts.config || {});
  g.getConfig_ = function (key, d) { return Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : realGetConfig(key, d); };
  // 季前資料的內容很多資料來源；這裡只要知道「有被用上」，內容另有專門的測試
  g.buildPreseasonPack_ = function (q) { return { quarterLabel: '2099 年第一季', html: '<p>季前資料（假）</p>', plain: '季前資料（假）', sections: [] }; };
  return { sc: sc, g: g, log: log, cfg: cfg };
}

console.log('\n=== TB1：收件人限制 ===');
{
  const s = scene();
  const g = s.g;
  check('★★★★★ 允許名單＝三個 Config 的聯集（MAIL_ADMIN_NOTIFY、WEBAPP_ALLOWED_EMAILS、MAIL_REDIRECT_ALL_TO）',
    JSON.stringify(g.readTemplateSampleAllowedEmails_().sort()) === JSON.stringify([ADMIN, EDITOR, REDIRECT].sort()), JSON.stringify(g.readTemplateSampleAllowedEmails_()));
  ['someone@example.invalid', '', 'admin2@example.invalid'].forEach((bad) => {
    let err = null;
    try { g.sendTemplateSamples_('2099T1', bad); } catch (e) { err = e; }
    check('★★★★★★ 不在名單「' + bad + '」⇒ 拒絕，一封都不寄', err && /不是可以收範本樣本的地址/.test(err.message) && /一封都沒有寄出/.test(err.message) && s.log.sent.length === 0, err && err.message);
  });
  const ok = g.assertTemplateSampleRecipientAllowed_('Admin@Example.invalid');
  check('★★★★ 大小寫不分，回傳名單內的寫法', ok === ADMIN, ok);
  const gated = fs.readFileSync(path.join(ROOT, 'src', 'TemplateSamples.gs'), 'utf8');
  check('★★★★★ 寄出之前一定先驗收件人（sendTemplateSamples_ 第一步）',
    /function sendTemplateSamples_[\s\S]{0,300}assertTemplateSampleRecipientAllowed_\(toEmail\)[\s\S]{0,200}buildTemplateSamples_/.test(gated));
}

console.log('\n=== TB2／TB3／TB4：內容、DRY_RUN、紀錄（這一季有版本）===');
{
  const s = scene();
  const g = s.g; const sc = s.sc;
  const sendLogBefore = g.readSheet_(sc.S.SEND_LOG).length;
  const stageBefore = g.getQuarterStage_(sc.Q);
  const r = g.sendTemplateSamples_(sc.Q, ADMIN);
  const mails = s.log.sent;
  const subjects = mails.map((m) => m[1]);
  const TEMPLATES = ['TPL_REVIEW_TC', 'TPL_REMIND_TC', 'TPL_OFFICIAL_TC', 'TPL_OFFICIAL_LIST_TC', 'TPL_RESEND_TC', 'TPL_RESEND_LIST_TC', 'TPL_PRESEASON_TC', 'TPL_UNAVAILABLE_INVITE_TC', 'TPL_UNAVAILABLE_DECIDED_TC']; // 第九十四輪批次 UC 組（刻意改動）：多一個範本
  const ADMIN_KINDS = ['沒有電郵名單', '生成完成', '還沒有生成初稿', '停在同一階段太久', '接近正式發出日期', '特殊主日日期未確認', '義工申報待確認', '開季前資料有改動'];
  check('★★★★★★ 一共 17 封：9 個範本＋8 種幹事通知（第九十八輪批次 YB 組刻意加「開季前資料有改動」）', r.sent === 17 && mails.length === 17, r.sent + '／' + mails.length);
  check('★★★★★★ 每一封只寄給你選的那一個地址（沒有第二個收件人、沒有轉寄）', mails.every((m) => m[0] === ADMIN), JSON.stringify(mails.map((m) => m[0])));
  check('★★★★★★ DRY_RUN＝TRUE 也寄（樣本例外）；MAIL_REDIRECT_ALL_TO 有值也不轉寄', s.cfg.DRY_RUN === true && mails.length === 17 && mails.every((m) => m[1].indexOf('[原收件人') === -1));
  check('★★★★★ 主旨前面：[範本樣本 n/N] 名稱｜…（編號 1 至 17）',
    subjects.every((t, i) => t.indexOf('[範本樣本 ' + (i + 1) + '/17] ') === 0), JSON.stringify(subjects));
  TEMPLATES.forEach((id) => {
    check('★★★★★ 有「' + id + '」', subjects.some((t) => t.indexOf('] ' + id + '｜') !== -1), JSON.stringify(subjects));
  });
  ADMIN_KINDS.forEach((k) => {
    check('★★★★ 有幹事通知「' + k + '」', subjects.some((t) => t.indexOf('幹事通知：') !== -1 && t.indexOf(k) !== -1), JSON.stringify(subjects.filter((t) => /幹事通知/.test(t))));
  });
  const BOX = /這是範本樣本，不是正式通知。範本：([^；]+)；修改位置：/;
  check('★★★★★★ 每一封內文最上面有灰框：「這是範本樣本，不是正式通知。範本：…；修改位置：…」（純文字）',
    mails.every((m) => String(m[2]).indexOf('這是範本樣本，不是正式通知。範本：') === 0 && BOX.test(m[2])), mails.filter((m) => !BOX.test(m[2])).map((m) => m[1]).join('\n'));
  check('★★★★★ 範本信有 HTML 灰框（background:#eeeeee），在內文最上面', mails.slice(0, 8).every((m) => /^<div style="background:#eeeeee/.test(m[3].htmlBody) && m[3].htmlBody.indexOf('這是範本樣本，不是正式通知') !== -1));
  const body = (id) => mails.filter((m) => m[1].indexOf('] ' + id + '｜') !== -1)[0];
  check('★★★★★ 修改位置：EmailTemplates 範本寫「EmailTemplates 第 N 行」', /修改位置：EmailTemplates 第 \d+ 行/.test(body('TPL_OFFICIAL_TC')[2]));
  check('★★★★★ 修改位置：寫死在程式內的幹事通知寫「程式（請告訴 Claude）」', mails.filter((m) => /幹事通知/.test(m[1])).every((m) => /修改位置：程式（請告訴 Claude）/.test(m[2])));
  check('★★★★★ 不附 PDF，內文最上面寫「正式信會附：……」', /正式信會附：個人版 PDF/.test(body('TPL_OFFICIAL_TC')[2]) && /正式信會附：整季完整版 PDF|正式信會附：沒有附件/.test(body('TPL_OFFICIAL_LIST_TC')[2])
    && mails.every((m) => !m[3] || !(m[3].attachments || []).some((a) => /pdf/i.test(String(a.name || a.fileName || '')))));
  const official = body('TPL_OFFICIAL_TC');
  check('★★★★★ 有日曆檔的信（正式發出、改動後重發）附上該人的 .ics 樣本',
    official[3].attachments && official[3].attachments.length === 1 && /\.ics$/.test(official[3].attachments[0].getName ? official[3].attachments[0].getName() : '')
    && /正式信會附：[^\n]*日曆檔（\.ics）/.test(official[2]), JSON.stringify(Object.keys(official[3])));
  check('★★★★ 日曆檔附件的信：提示句「只包括你自己的服侍」', official[2].indexOf('附件的日曆檔（.ics）只包括你自己的服侍') !== -1);
  check('★★★★ 範本信用這一季的真實資料：沒有留下 {…} 未代入', mails.slice(0, 8).every((m) => !/\{[A-Za-z]+\}/.test(m[2])));
  check('★★★★ 這一季有版本 ⇒ 沒有「示範資料」那一句', mails.slice(0, 8).every((m) => m[2].indexOf('這一季還沒有版本，下面是示範資料') === -1));
  check('★★★★★ 申報邀請的個人連結有代入', /Deadline|截止|申報/.test(body('TPL_UNAVAILABLE_INVITE_TC')[2]) && !/\{PersonalLink\}/.test(body('TPL_UNAVAILABLE_INVITE_TC')[2]));

  const audit = g.readSheet_(sc.S.AUDIT_LOG).filter((row) => row[sc.C.AUDIT_LOG.ACTION] === 'TEMPLATE_SAMPLES_SENT');
  check('★★★★★★ AuditLog 一筆 TEMPLATE_SAMPLES_SENT（收件人、季度、封數）', audit.length === 1 && /寄出 17 封/.test(audit[0][sc.C.AUDIT_LOG.NEW_VALUE])
    && audit[0][sc.C.AUDIT_LOG.TARGET_KEY] === sc.Q && String(audit[0][sc.C.AUDIT_LOG.NOTES]).indexOf(ADMIN) !== -1, JSON.stringify(audit));
  check('★★★★★★ 不寫 SendLog', g.readSheet_(sc.S.SEND_LOG).length === sendLogBefore);
  check('★★★★★★ 不改任何階段', g.getQuarterStage_(sc.Q) === stageBefore);
}

console.log('\n=== TB5：沒有版本 ⇒ 示範資料；入口及權限 ===');
{
  const s = scene();
  const g = s.g; const sc = s.sc;
  g.findLatestVersionNo_ = function () { return -1; };
  const r = g.sendTemplateSamples_(sc.Q, EDITOR);
  const mails = s.log.sent;
  check('★★★★★ 沒有版本也寄得出 17 封，每一封收件人是你選的地址', r.sent === 17 && mails.every((m) => m[0] === EDITOR) && r.hasVersion === false);
  check('★★★★★ 範本信內文最上面寫明「這一季還沒有版本，下面是示範資料。」', mails.slice(0, 8).every((m) => m[2].indexOf('這一季還沒有版本，下面是示範資料。') !== -1));
  check('★★★★ 訊息講明是示範資料', /示範資料/.test(r.message));

  const zone4 = read('src/ui/ScriptZone4.html');
  check('★★★★★★ 幹事介面「進階與診斷」有一行「寄出電郵範本樣本」（按鈕〔開始〕）', /zone4Row\('寄出電郵範本樣本'/.test(zone4) && /function zone4Row[\s\S]{0,400}button\('開始'/.test(zone4));
  check('★★★★★ 試算表選單「維護」有同名項目', /ui\.createMenu\('維護'\)[\s\S]*?\.addItem\('寄出電郵範本樣本', 'runSendTemplateSamples_'\)/.test(read('src/Menu.gs')));
  check('★★★★★ 權限＝可以修改：只可查看的人按鈕變灰（不在 VIEW_ONLY_READ_TOOLS）', read('src/ui/Script.html').match(/const VIEW_ONLY_READ_TOOLS = \[([^\]]*)\]/)[1].indexOf('寄出電郵範本樣本') === -1);
  const webapp = read('src/WebApp.gs');
  check('★★★★★ apiSendTemplateSamples 是改動（不在唯讀清單）；選項讀取 apiGetTemplateSampleOptions 是唯讀（前後端清單一致）',
    webapp.match(/const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/)[1].indexOf('apiSendTemplateSamples') === -1
    && webapp.match(/const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/)[1].indexOf('apiGetTemplateSampleOptions') !== -1
    && /function apiSendTemplateSamples[\s\S]{0,200}assertWebAppRequestAllowed_\(\)/.test(read('src/TemplateSamples.gs'))
    && /withMutationLock_\(/.test(read('src/TemplateSamples.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
