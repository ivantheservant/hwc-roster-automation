// 第四十一輪批次 H 組：安全地真正寄一次信（MAIL_REDIRECT_ALL_TO）。
// 執行方式：node tests/mail_redirect.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 要試「寄出」——真係產生附件、真係經過 MailApp、真係收到一封信。
// `DRY_RUN = TRUE` 做唔到（佢喺 `sendRealEmail_()` 之前就攔住）。
// 但**唔可以直接改成 FALSE**：NameMapping 有幾十位真實義工嘅真實電郵。
//
// 所以有 `MAIL_REDIRECT_ALL_TO`：有值嗰陣每一封信嘅收件人一律改成嗰個地址。
//
// ⚠️ **一個「安全地寄錯人」嘅機制，本身就係一個危險。**
//
// 佢最壞嘅失敗方式唔係「轉寄唔成功」，係**唔記得閂**——
// 上線之後幹事撳「正式發出」，全體義工一封都收唔到，
// 而系統報告會話「已寄出 51 封」，SendLog 亦都會話成功。
//
// 所以呢一份守嘅係「五處都要大聲」：主旨、內文、SendLog、介面標籤、
// 上線前檢查。少一處，佢就有機會靜靜生效。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs',
  // isPlausibleEmail_ 喺呢度——轉寄地址填錯咗要認得出。
  'WebAppPeople.gs',
  'MailRedirect.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const SRC = path.join(__dirname, '..', 'src');
const mailer = fs.readFileSync(path.join(SRC, 'Mailer.gs'), 'utf8');

const PLAN = {
  toEmail: 'volunteer@example.invalid',
  displayName: '假甲',
  subject: '2099T1 職事表',
  bodyHtml: '<p>你好</p>',
  bodyPlain: '你好'
};

// =====================================================================
console.log('\n=== H【核心】冇設定 ⇒ 行為同今日一模一樣 ===');
{
  // ⚠️ 呢一條係整份最重要。一個「會改寄件人」嘅機制，
  // 冇設定嘅時候必須完全等於冇存在過。
  [undefined, null, '', '   '].forEach(function (empty) {
    const r = gas.applyMailRedirect_(PLAN, empty);
    checkEqual('★★★★★ redirectTo = ' + JSON.stringify(empty)
      + ' ⇒ 收件人、主旨、內文一個字都冇變',
      {
        toEmail: r.toEmail, subject: r.subject,
        bodyHtml: r.bodyHtml, bodyPlain: r.bodyPlain, redirected: r.redirected
      },
      {
        toEmail: PLAN.toEmail, subject: PLAN.subject,
        bodyHtml: PLAN.bodyHtml, bodyPlain: PLAN.bodyPlain, redirected: false
      });
  });
}

console.log('\n=== H【核心】有設定 ⇒ 五處都要講 ===');
{
  const TO = 'ivan@example.invalid';
  const r = gas.applyMailRedirect_(PLAN, TO);

  checkEqual('★★★★★ 一、收件人真係改咗', r.toEmail, TO);
  checkEqual('★★★★★ 而且記得返本來要寄俾邊個', r.originalEmail, PLAN.toEmail);

  check('★★★★★ 二、主旨前面寫住原收件人'
    + '——收件匣入面幾十封主旨一模一樣嘅信，分唔出邊封係邊位嘅',
    r.subject.indexOf('[原收件人：假甲]') === 0, r.subject);
  check('★★★★ 而且原本嘅主旨仲喺度',
    r.subject.indexOf(PLAN.subject) !== -1, r.subject);

  check('★★★★★ 三、純文字內文頂部有橫幅',
    r.bodyPlain.indexOf('這封信本來是寄給') > 0
    && r.bodyPlain.indexOf('這封信本來是寄給') < 5, r.bodyPlain.slice(0, 120));
  check('★★★★★ 而且明確講「收件人本人沒有收到這封信」'
    + '——唔講嘅話，Ivan 會以為義工都收到咗一份',
    r.bodyPlain.indexOf('收件人本人沒有收到') !== -1, r.bodyPlain.slice(0, 200));
  check('★★★★ 原本嘅內文仲喺下面',
    r.bodyPlain.indexOf(PLAN.bodyPlain) !== -1, r.bodyPlain);

  check('★★★★★ HTML 內文一樣有橫幅，而且喺最頂',
    r.bodyHtml.indexOf('<div') === 0
    && r.bodyHtml.indexOf(PLAN.bodyHtml) > 0, r.bodyHtml.slice(0, 200));
}

console.log('\n=== H：名字要轉義（HTML 橫幅）===');
{
  // `displayName` 係使用者輸入。唔轉義就係一條 XSS 路。
  const r = gas.applyMailRedirect_(
    Object.assign({}, PLAN, { displayName: '<script>x</script>' }), 'a@example.invalid');
  check('★★★★★ `<` 轉咗做 `&lt;`', r.bodyHtml.indexOf('&lt;script&gt;') !== -1, r.bodyHtml.slice(0, 300));
  check('★★★★★ 而且冇一個原原本本嘅 script 開標籤留喺 HTML 入面',
    r.bodyHtml.indexOf('<script') === -1, r.bodyHtml.slice(0, 300));
}

console.log('\n=== H：查唔到名字都要講得出係邊封 ===');
{
  const r = gas.applyMailRedirect_(
    Object.assign({}, PLAN, { displayName: '' }), 'a@example.invalid');
  check('★★★★★ 冇 displayName 就退而用電郵，**唔可以留空**'
    + '——主旨變成「[原收件人：] ⋯⋯」就等於乜都冇講',
    r.subject.indexOf(PLAN.toEmail) !== -1, r.subject);
}

// =====================================================================
console.log('\n=== H【核心】設定本身有問題 ⇒ 拋錯，唔可以當成「冇設定」 ===');
{
  // ⚠️ 當成「冇設定」＝ 喺應該轉寄嘅時候真係寄咗俾義工。
  // 呢個係唯一一個「寧可寄唔出」嘅情況。
  gas.getConfig = function () { return '唔係一個電郵'; };
  let threw = null;
  try { gas.readMailRedirectTarget_(); } catch (e) { threw = e; }
  check('★★★★★ 填咗一個唔似電郵嘅值 ⇒ 拋錯', threw !== null);
  check('★★★★ 而且講「一封都冇寄出」',
    threw && threw.message.indexOf('一封都沒有寄出') !== -1, threw && threw.message);

  gas.getConfig = function () { return '  '; };
  checkEqual('★★★★★ 空白（含只有空格）⇒ 回空字串，即係正常運作',
    gas.readMailRedirectTarget_(), '');

  gas.getConfig = function () { return 'ivan@example.invalid'; };
  checkEqual('★★★★ 正常值 ⇒ 原樣回', gas.readMailRedirectTarget_(), 'ivan@example.invalid');
}

console.log('\n=== H：介面標籤 ===');
{
  gas.getConfig = function () { return ''; };
  checkEqual('★★★★★ 冇設定 ⇒ 冇標籤（空字串）', gas.buildMailRedirectBadgeText_(), '');

  gas.getConfig = function () { return 'ivan@example.invalid'; };
  const badge = gas.buildMailRedirectBadgeText_();
  check('★★★★★ 有設定 ⇒ 一定要有標籤，而且寫住寄去邊'
    + '——**唔可以靜靜生效**，佢最壞嘅失敗方式係「唔記得閂」',
    badge.indexOf('ivan@example.invalid') !== -1 && badge.indexOf('全部信件轉寄') !== -1,
    badge);

  gas.getConfig = function () { return '亂噏'; };
  const bad = gas.buildMailRedirectBadgeText_();
  check('★★★★★ 設定有問題都要有標籤，唔可以靜靜變返「冇設定」',
    bad !== '' && bad.indexOf('有問題') !== -1, bad);
}

// =====================================================================
console.log('\n=== H：轉寄要喺最後一刻套用，唔喺上游 ===');
{
  // ⚠️ 擺喺 `sendRealEmail_()` 入面（真正 MailApp.sendEmail() 之前）
  // 係刻意嘅：上游任何一條新加嘅路都自動受保護，唔使記得。
  // 擺上游就會變成「有一條路唔記得套用」而真係寄咗俾義工。
  // ⚠️ 一定要剝走註解先量位置：呢兩個名喺註解入面提過好多次，
  //  搵中註解就會量錯，而個測試會指住一段註解話你知有 bug。
  const bareMailer = mailer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = bareMailer.slice(bareMailer.indexOf('function sendRealEmail_'),
    bareMailer.indexOf('function generateMailAttachment_'));
  check('★★★★★ `applyMailRedirect_()` 喺 `sendRealEmail_()` 入面',
    /applyMailRedirect_\(/.test(body), body.slice(0, 300));
  const redirectAt = body.indexOf('applyMailRedirect_(');
  const sendAt = body.indexOf('MailApp.sendEmail(');
  check('★★★★★ 而且喺 `MailApp.sendEmail()` **之前**',
    redirectAt !== -1 && sendAt !== -1 && redirectAt < sendAt,
    'redirect@' + redirectAt + ' send@' + sendAt);
  check('★★★★★ 真正寄出用嘅係轉寄之後嗰個地址，唔係 `recipient.email`'
    + '——用返原本嗰個就等於整個機制冇生效，而畫面同 log 都會話成功',
    /MailApp\.sendEmail\(redirected\.toEmail,/.test(body), body.slice(-400));
  check('★★★★★ 全專案只有兩個 `MailApp.sendEmail\(` 呼叫點'
    + '（另一個係「只通知幹事」嗰個，唔會寄俾義工）——'
    + '多一個就代表有一條路繞過咗轉寄',
    (bareMailer.match(/MailApp\.sendEmail\(/g) || []).length === 2,
    String((bareMailer.match(/MailApp\.sendEmail\(/g) || []).length));
}

console.log('\n=== H：SendLog 兩樣都要記 ===');
{
  check('★★★★★ 記低本來要寄俾邊個',
    /record\[C\.INTENDED_EMAIL\]/.test(mailer), '');
  check('★★★★★ 亦都記低實際寄咗去邊'
    + '——只記其中一樣，日後查「嗰個人到底收唔收到」就查唔到',
    /record\[C\.DELIVERED_TO\]/.test(mailer), '');
  check('★★★★ 冇轉寄嗰陣兩欄一樣（唔會留空）',
    /o\.intendedEmail === undefined \? o\.email/.test(mailer)
    && /o\.deliveredTo === undefined \? o\.email/.test(mailer), '');
}

console.log('\n=== H：上線前檢查要列為必須處理 ===');
{
  const checklist = fs.readFileSync(path.join(SRC, 'PreLaunchChecklist.gs'), 'utf8');
  check('★★★★★ 上線前檢查有呢一項',
    /MAIL_REDIRECT_ALL_TO（測試用的轉寄地址）/.test(checklist), '');
  check('★★★★★ 而且**有值就算「需要處理」**（第二個參數係「ready」）',
    /redirectTo === ''[\s\S]{0,40}redirectReadError === ''/.test(checklist), '');
  check('★★★★★ 建議文字要講出最壞嗰個後果'
    + '——「系統報告已寄出，而全體義工其實一封都冇收到」',
    /系統會報告「已寄出」而全體義工其實一封都沒有收到/.test(checklist), '');
}

console.log('\n=== H：Config 有 seed，而且說明講得出用途同風險 ===');
{
  const seed = fs.readFileSync(path.join(SRC, 'ConfigSeed.gs'), 'utf8');
  const at = seed.indexOf('CONFIG_KEYS.MAIL_REDIRECT_ALL_TO');
  check('★★★★ ConfigSeed 有佢', at !== -1);
  const block = seed.slice(at, at + 700);
  check('★★★★★ 預設值係空白（唔可以預設開住）',
    /defaultValue: ''/.test(block), block.slice(0, 200));
  check('★★★★★ 說明開頭就寫「上線前一定要清空」',
    /【測試用，上線前一定要清空】/.test(block), block.slice(0, 200));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
