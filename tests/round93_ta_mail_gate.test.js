// 第九十三輪批次 TA 組：測試期間所有寄出的信都經轉寄名單（MAIL_REDIRECT_ALL_TO）。
// 執行方式：node tests/round93_ta_mail_gate.test.js
//
//   TA1 靜態：`MailApp.sendEmail` 在 src/ 只出現在 `sendMailThroughGate_()`；其他寄信 API（GmailApp.send…）一個都沒有；
//       自我檢查：加一個沒有經閘門的新入口 ⇒ 掃描要報
//   TA2 幹事通知 `notifyAdmin_()`：有轉寄 ⇒ 改寄轉寄名單（多個地址）＋主旨及內文加同一個轉寄標示；沒有 ⇒ 照舊；
//       DRY_RUN 照舊不寄；轉寄名單有無效電郵 ⇒ 一封都不寄
//   TA3 〔寄給自己〕紙本包：有轉寄 ⇒ 改寄轉寄名單（不寄給輸入的額外地址）；沒有 ⇒ 照舊；無效 ⇒ 一封都不寄
//   TA4 `sendRealEmail_()` 仍然經閘門，行為不變（附件、HTML）
//   TA5 閘門 `bypassRedirectReason`：有理由才可以不經轉寄
// 用假地址（example.invalid），不涉及真實電郵。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1');
}
function allSources() {
  const out = [];
  fs.readdirSync(SRC).forEach((f) => { if (/\.gs$/.test(f)) out.push({ name: f, text: fs.readFileSync(path.join(SRC, f), 'utf8') }); });
  const ui = path.join(SRC, 'ui');
  fs.readdirSync(ui).forEach((f) => { if (/\.(gs|html)$/.test(f)) out.push({ name: 'ui/' + f, text: fs.readFileSync(path.join(ui, f), 'utf8') }); });
  return out;
}
/** 掃描：寄信 API 的呼叫點必須只在 sendMailThroughGate_ 的函式本體之內。 */
function scanMailCallSites(sources) {
  const problems = [];
  sources.forEach((s) => {
    const text = stripComments(s.text);
    const re = /MailApp\s*\.\s*\w+\s*\(|GmailApp\s*\.\s*\w+\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const fnStart = before.lastIndexOf('\nfunction ');
      const fnName = fnStart === -1 ? '' : (before.slice(fnStart + 10).match(/^[A-Za-z0-9_]+/) || [''])[0];
      const isGate = s.name === 'MailRedirect.gs' && fnName === 'sendMailThroughGate_' && /^MailApp\s*\.\s*sendEmail\s*\(/.test(m[0]);
      if (!isGate) problems.push(s.name + '：' + fnName + ' 內有 ' + m[0]);
    }
  });
  return problems;
}

console.log('\n=== TA1：靜態——寄信呼叫點只有閘門 ===');
{
  const sources = allSources();
  const problems = scanMailCallSites(sources);
  check('★★★★★★ `MailApp`／`GmailApp` 的呼叫只在 `sendMailThroughGate_()` 之內，其他地方一個都沒有', problems.length === 0, problems.join('\n'));
  const gateCount = sources.reduce((n, s) => n + (stripComments(s.text).match(/MailApp\.sendEmail\(/g) || []).length, 0);
  check('★★★★ 全專案剛好一個 `MailApp.sendEmail(`', gateCount === 1, String(gateCount));
  const fake = sources.concat([{ name: 'FakeNewEntry.gs', text: 'function sendSomethingNew_() {\n  MailApp.sendEmail("a@example.invalid", "s", "b");\n}\n' }]);
  check('★★★★★★ 自我檢查：多一個不經閘門的新寄信入口 ⇒ 掃描報出', scanMailCallSites(fake).some((p) => /FakeNewEntry/.test(p)));
  const fake2 = sources.concat([{ name: 'FakeGmail.gs', text: 'function x_() {\n  GmailApp.sendEmail("a@example.invalid", "s", "b");\n}\n' }]);
  check('★★★★ 自我檢查：用 GmailApp 寄也報', scanMailCallSites(fake2).some((p) => /FakeGmail/.test(p)));
  check('★★★★ 三條原有入口都經閘門：Mailer（sendRealEmail_、notifyAdmin_）、PaperPack、TemplateSamples',
    /sendMailThroughGate_\(/.test(fs.readFileSync(path.join(SRC, 'Mailer.gs'), 'utf8'))
    && /sendMailThroughGate_\(/.test(fs.readFileSync(path.join(SRC, 'PaperPack.gs'), 'utf8'))
    && /sendMailThroughGate_\(/.test(fs.readFileSync(path.join(SRC, 'TemplateSamples.gs'), 'utf8')));
}

// ── 行為測試的共用準備 ─────────────────────────────────────────
const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs', 'WebAppPeople.gs', 'MutationLock.gs',
  'MailRedirect.gs', 'Mailer.gs', 'PaperPack.gs'
]);

function scene(config, dryRun) {
  const log = { sent: [], warn: [] };
  gas.MailApp = { sendEmail: function () { log.sent.push(Array.prototype.slice.call(arguments)); } };
  gas.getConfig_ = function (key, d) {
    if (key === 'DRY_RUN') return dryRun === undefined ? false : dryRun;
    return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : d;
  };
  gas.assertNotPreviewMode_ = function () {};
  gas.log_ = function (level, msg) { if (level === 'WARN') log.warn.push(msg); };
  return log;
}
const REDIRECT_TWO = 'owner@example.invalid, helper@example.invalid';

console.log('\n=== TA2：幹事通知 notifyAdmin_() ===');
{
  let log = scene({ MAIL_REDIRECT_ALL_TO: REDIRECT_TWO });
  gas.notifyAdmin_('2099T1 初稿已生成', '請覆核', 'admin@example.invalid', false);
  check('★★★★★★ 有轉寄 ⇒ 只寄一封，收件人是轉寄名單（兩個地址），不是 MAIL_ADMIN_NOTIFY',
    log.sent.length === 1 && log.sent[0][0] === 'owner@example.invalid,helper@example.invalid', JSON.stringify(log.sent));
  check('★★★★★ 主旨加轉寄標示（原收件人）', /^\[原收件人：[^\]]+\] 2099T1 初稿已生成/.test(log.sent[0][1]), log.sent[0] && log.sent[0][1]);
  check('★★★★★ 內文加同一個轉寄橫幅，原本內文仍在', /這封信本來是寄給/.test(log.sent[0][2]) && log.sent[0][2].indexOf('請覆核') !== -1, log.sent[0] && log.sent[0][2]);
  check('★★★★ 幹事通知本來是純文字：沒有加 htmlBody', !log.sent[0][3] || log.sent[0][3].htmlBody === undefined, JSON.stringify(log.sent[0][3]));

  log = scene({});
  gas.notifyAdmin_('2099T1 初稿已生成', '請覆核', 'admin@example.invalid', false);
  check('★★★★★★ 沒有轉寄 ⇒ 照舊寄給 MAIL_ADMIN_NOTIFY，主旨內文一個字不變',
    log.sent.length === 1 && log.sent[0][0] === 'admin@example.invalid' && log.sent[0][1] === '2099T1 初稿已生成' && log.sent[0][2] === '請覆核', JSON.stringify(log.sent));

  log = scene({ MAIL_REDIRECT_ALL_TO: REDIRECT_TWO });
  gas.notifyAdmin_('s', 'b', 'admin@example.invalid', true);
  check('★★★★★ DRY_RUN（呼叫端 isDryRun）照舊不寄', log.sent.length === 0);
  log = scene({ MAIL_REDIRECT_ALL_TO: REDIRECT_TWO }, true);
  gas.notifyAdmin_('s', 'b', 'admin@example.invalid', false);
  check('★★★★★ Config DRY_RUN=TRUE 照舊不寄', log.sent.length === 0);

  log = scene({ MAIL_REDIRECT_ALL_TO: 'owner@example.invalid, 唔係電郵' });
  gas.notifyAdmin_('s', 'b', 'admin@example.invalid', false);
  check('★★★★★★ 轉寄名單有無效電郵 ⇒ 一封都不寄（不會退回寄給 MAIL_ADMIN_NOTIFY）', log.sent.length === 0, JSON.stringify(log.sent));
  check('★★★★ 而且不拋錯令主流程失敗，只記 WARN', log.warn.length === 1 && /幹事通知沒有寄出/.test(log.warn[0]), JSON.stringify(log.warn));
}

console.log('\n=== TA3：〔寄給自己〕紙本包 ===');
{
  const names = { P9001: '測試甲' };
  function paperScene(config) {
    const log = scene(config);
    gas.assertWebAppRequestAllowed_ = function () {};
    gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'clerk@example.invalid'; } }; } };
    gas.findLatestVersionNo_ = function () { return 7; };
    gas.buildRosterSheetName_ = function () { return '職事表 2099T1 v7'; };
    gas.buildQuarterLabel_ = function () { return '2099 年第一季'; };
    gas.writeAuditLog_ = function () {};
    gas.DriveApp = { getFileById: function () { return { getBlob: function () { return { name: 'x.pdf' }; } }; } };
    gas.listPaperPackFiles_ = function (_q, _v, ids) {
      return { folderUrl: 'https://drive.example.invalid/f', missing: [],
        files: ids.map((id) => ({ personId: id, nameTC: names[id] || id, fileName: id + '.pdf', url: 'https://drive.example.invalid/d/F' + id, sizeBytes: 1000 })) };
    };
    return log;
  }
  let log = paperScene({ MAIL_REDIRECT_ALL_TO: REDIRECT_TWO });
  let r = gas.apiEmailPaperPackToSelf_locked_('2099T1', ['P9001'], ['helper2@example.invalid']);
  check('★★★★★★ 有轉寄 ⇒ 只寄給轉寄名單，不寄給操作者自己及輸入的額外地址',
    r.sentCount === 1 && log.sent.length === 1 && log.sent[0][0] === 'owner@example.invalid,helper@example.invalid', JSON.stringify(log.sent.map((m) => m[0])));
  check('★★★★★ 主旨及內文有轉寄標示，附件仍在', /^\[原收件人：/.test(log.sent[0][1]) && /這封信本來是寄給/.test(log.sent[0][2])
    && Array.isArray(log.sent[0][3].attachments) && log.sent[0][3].attachments.length === 1, JSON.stringify(log.sent[0]).slice(0, 400));

  log = paperScene({});
  r = gas.apiEmailPaperPackToSelf_locked_('2099T1', ['P9001'], ['helper2@example.invalid']);
  check('★★★★★★ 沒有轉寄 ⇒ 照舊寄給自己＋額外地址',
    log.sent.length === 1 && log.sent[0][0] === 'clerk@example.invalid,helper2@example.invalid' && log.sent[0][1].indexOf('[原收件人') === -1, JSON.stringify(log.sent.map((m) => m[0])));

  log = paperScene({ MAIL_REDIRECT_ALL_TO: REDIRECT_TWO }, true);
  r = gas.apiEmailPaperPackToSelf_locked_('2099T1', ['P9001'], []);
  check('★★★★ 紙本包刻意不理 DRY_RUN（和以前一樣）：DRY_RUN=TRUE 也寄，但只寄轉寄名單', log.sent.length === 1 && log.sent[0][0] === 'owner@example.invalid,helper@example.invalid');

  log = paperScene({ MAIL_REDIRECT_ALL_TO: 'owner@example.invalid, 唔係電郵' });
  let threw = null;
  try { gas.apiEmailPaperPackToSelf_locked_('2099T1', ['P9001'], []); } catch (e) { threw = e; }
  check('★★★★★★ 轉寄名單有無效電郵 ⇒ 一封都不寄，並且講明', log.sent.length === 0 && threw && /一封都沒有寄出/.test(threw.message), threw && threw.message);
}

console.log('\n=== TA4：sendRealEmail_() 行為不變 ===');
{
  let log = scene({ MAIL_REDIRECT_ALL_TO: 'owner@example.invalid' });
  const blob = { name: 'a.pdf' };
  const ret = gas.sendRealEmail_({ email: 'vol@example.invalid', displayName: '假甲' }, '主旨', '<p>內文</p>', '內文',
    { senderName: '系統', replyTo: 'r@example.invalid' }, { blob: blob }, null);
  const m = log.sent[0];
  check('★★★★★ 轉寄：收件人、主旨、HTML 橫幅、純文字橫幅、附件、寄件人名稱、回覆地址',
    m[0] === 'owner@example.invalid' && m[1] === '[原收件人：假甲] 主旨' && /^<div/.test(m[3].htmlBody) && m[3].htmlBody.indexOf('<p>內文</p>') > 0
    && /這封信本來是寄給/.test(m[2]) && m[3].attachments[0] === blob && m[3].name === '系統' && m[3].replyTo === 'r@example.invalid', JSON.stringify(m).slice(0, 500));
  check('★★★★★ 回傳 redirected／toEmail（SendLog 要記實際寄去哪）', ret.redirected === true && ret.toEmail === 'owner@example.invalid');
  log = scene({});
  gas.sendRealEmail_({ email: 'vol@example.invalid', displayName: '假甲' }, '主旨', '<p>內文</p>', '內文', {}, null, null);
  check('★★★★ 沒有轉寄 ⇒ 照舊寄給本人', log.sent[0][0] === 'vol@example.invalid' && log.sent[0][1] === '主旨' && log.sent[0][3].htmlBody === '<p>內文</p>');
}

console.log('\n=== TA5：閘門的 bypassRedirectReason ===');
{
  let log = scene({ MAIL_REDIRECT_ALL_TO: 'owner@example.invalid' });
  gas.sendMailThroughGate_({ to: 'me@example.invalid', subject: 's', bodyPlain: 'b', bodyHtml: null, bypassRedirectReason: '測試理由' });
  check('★★★★★ 有寫理由 ⇒ 不經轉寄，寄給指定地址', log.sent.length === 1 && log.sent[0][0] === 'me@example.invalid' && log.sent[0][1] === 's');
  log = scene({ MAIL_REDIRECT_ALL_TO: 'owner@example.invalid' });
  gas.sendMailThroughGate_({ to: 'me@example.invalid', subject: 's', bodyPlain: 'b', bodyHtml: null, bypassRedirectReason: '   ' });
  check('★★★★★ 理由是空白 ⇒ 照樣轉寄（不是一個順手關掉的開關）', log.sent[0][0] === 'owner@example.invalid');
  const src = fs.readFileSync(path.join(SRC, 'TemplateSamples.gs'), 'utf8');
  check('★★★★ 現時只有範本樣本用 bypassRedirectReason', allSources().filter((s) => /bypassRedirectReason:\s*[A-Z_a-z'“]/.test(stripComments(s.text)) && s['name'] !== 'MailRedirect.gs').map((s) => s['name']).join() === 'TemplateSamples.gs'
    && /TEMPLATE_SAMPLE_BYPASS_REASON/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
