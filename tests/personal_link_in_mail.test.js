// 第四十一輪批次 E 組：每一封信要附上收件人自己那條個人專屬連結。
// 執行方式：node tests/personal_link_in_mail.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 逐項講清楚三種附件各自嘅內容：
//
//   不附　　　　　內文 ＋ **佢嘅個人專屬連結** ＋ 永久連結
//   個人版 PDF　　個人版 PDF ＋ **佢嘅個人專屬連結** ＋ 永久連結
//   整季 PDF　　　一份整季 PDF（冇 highlight）＋ 永久連結
//
// ⚠️ 關鍵嗰一句：**「不附」唔等於「乜都冇」。**
// 冇個人專屬連結嘅話，嗰一封信對收件人完全冇用——
// 佢只會見到一段內文同一條全體共用嘅連結，搵唔到自己嗰幾格。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PersonalLinkInMail.gs'
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
const BASE = 'https://example.invalid/macros/s/AAA/exec';

// =====================================================================
console.log('\n=== E【核心】邊幾種附件要附個人連結 ===');
{
  // ⚠️ 呢一句係嗰張表嘅**唯一**實作。畫面上嗰幾行說明文字同呢度
  // 讀同一個判斷——兩邊各寫一次嘅話，畫面會講一件事而系統做另一件事。
  checkEqual('★★★★★ 「不附」**要**附個人連結'
    + '——冇咗佢，嗰封信對收件人完全冇用',
    gas.attachTypeWantsPersonalLink_('NONE'), true);
  checkEqual('★★★★★ 「個人版 PDF」都要', gas.attachTypeWantsPersonalLink_('PERSONAL_PDF'), true);
  checkEqual('★★★★★ 「整季 PDF」**唔要**'
    + '——嗰種係「一份大家睇嘅表」，附一條每人唔同嘅連結反而更亂',
    gas.attachTypeWantsPersonalLink_('FULL_PDF'), false);
}

console.log('\n=== E：畫面上嗰幾行小字要同上面嗰個判斷一致 ===');
{
  ['NONE', 'PERSONAL_PDF'].forEach(function (t) {
    const note = gas.describeAttachOption_(t);
    check('★★★★★ ' + t + ' 嗰行小字有講「個人專屬連結」'
      + '（判斷話有，而畫面唔講，幹事就唔知有）',
      note.indexOf('個人專屬連結') !== -1, note);
  });
  const full = gas.describeAttachOption_('FULL_PDF');
  check('★★★★★ FULL_PDF 嗰行明確講「呢一種冇個人專屬連結」'
    + '——唔講嘅話，幹事會以為三種都一樣',
    full.indexOf('沒有個人專屬連結') !== -1, full);
  check('★★★★★ 而且講明整季 PDF 冇任何標示'
    + '（Ivan 明確要求嗰一份唔可以有 highlight）',
    full.indexOf('沒有任何標示') !== -1, full);
  check('★★★★ 「不附」嗰行唔可以令人以為封信係空嘅',
    gas.describeAttachOption_('NONE').indexOf('信件內文') !== -1,
    gas.describeAttachOption_('NONE'));
}

// =====================================================================
console.log('\n=== E【核心】個人連結嘅網址 ===');
{
  const url = gas.buildPersonalRosterUrl_(BASE, 'TOK123', '2099T1');
  check('★★★★★ 格式係 `?p=<token>&q=<季度>`',
    url === BASE + '?p=TOK123&q=2099T1', url);

  const withQuery = gas.buildPersonalRosterUrl_(BASE + '?x=1', 'TOK123', '2099T1');
  check('★★★★ 網址本身已經有 query 就用 `&` 接落去（唔會整出兩個 `?`）',
    withQuery.indexOf('?x=1&p=TOK123') !== -1, withQuery);

  // ⚠️ 一條打唔開嘅連結，對一個唔熟電腦嘅人嚟講比冇連結更差——
  // 佢會以為系統壞咗。所以冇把握就唔附。
  [
    ['冇設定義工部署網址', '', 'TOK', '2099T1'],
    ['嗰個人冇 token', BASE, '', '2099T1'],
    ['冇季度', BASE, 'TOK', ''],
    ['三樣都冇', '', '', '']
  ].forEach(function (c) {
    checkEqual('★★★★★ ' + c[0] + ' ⇒ 回空字串，**唔可以砌一條半截嘅連結**',
      gas.buildPersonalRosterUrl_(c[1], c[2], c[3]), '');
  });
}

console.log('\n=== E【核心】攞唔到連結 ⇒ 整段略過，唔可以出現空連結 ===');
{
  const body = '你好';
  [undefined, null, '', '   '].forEach(function (empty) {
    checkEqual('★★★★★ url = ' + JSON.stringify(empty) + ' ⇒ 內文原封不動',
      gas.appendPersonalLinkFooter_(body, empty, false), body);
  });
  const withLink = gas.appendPersonalLinkFooter_(body, BASE + '?p=T&q=Q', false);
  check('★★★★★ 有連結 ⇒ 加，而且講明「打開只看到你有份服侍的日子」'
    + '——唔講嘅話佢唔知同永久連結有咩分別',
    withLink.indexOf('你自己那一份') !== -1 && withLink.indexOf('?p=T&q=Q') !== -1,
    withLink);

  const html = gas.appendPersonalLinkFooter_(body, BASE + '?p=T&q=Q', true);
  check('★★★★ HTML 版係一條撳得到嘅連結', html.indexOf('<a href=') !== -1, html);
  check('★★★★★ 而且 `&` 有轉義（網址嚟自資料，唔轉義會整爛成段 HTML）',
    html.indexOf('&amp;q=Q') !== -1, html);
}

// =====================================================================
console.log('\n=== E：接上寄信路徑 ===');
{
  const body = mailer.slice(mailer.indexOf('function deliverOne_'),
    mailer.indexOf('function sendRealEmail_'));
  const bare = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ 只有 PERSON 收件人先會有個人連結'
    + '（LIST 收件人係一張名單，冇「佢自己嗰幾格」呢回事）',
    /recipient\.type === RECIPIENT_TYPE\.PERSON\s*\n?\s*&& attachTypeWantsPersonalLink_/.test(bare),
    bare.slice(0, 600));
  check('★★★★★ 附件類型讀返上游嘅決定，唔係喺呢度睇範本'
    + '——同第四十輪 A 組同一條規矩：deliverOne_() 只執行，唔判斷',
    /const decidedAttach = context\.sendDecision/.test(bare), bare.slice(0, 600));
  check('★★★★★ 兩邊內文都有加（HTML 同純文字）'
    + '——只做一邊嘅話，用純文字睇信嗰啲人就冇連結',
    /appendPersonalLinkFooter_\([\s\S]{0,200}personalUrl, true\)/.test(bare)
    && /appendPersonalLinkFooter_\([\s\S]{0,200}personalUrl, false\)/.test(bare),
    bare.slice(0, 900));
  check('★★★★★ 個人連結排喺永久連結**之前**'
    + '（對收件人嚟講「我自己嗰幾格」比「全體嗰一份」有用得多）',
    /appendPermanentLinkFooter_\(\s*\n\s*appendPersonalLinkFooter_\(/.test(body),
    body.slice(0, 900));
  check('★★★★★ 攞唔到連結嗰陣會數低',
    /_noPersonalLinkCount = \(context\._noPersonalLinkCount \|\| 0\) \+ 1/.test(bare), '');
  check('★★★★★ 而且 `sendStage()` 會把個數字報返出去'
    + '——靜靜略過嘅話，嗰幾位收到嘅信會比其他人少一段而冇人知',
    /noPersonalLinkCount: context\._noPersonalLinkCount \|\| 0/.test(mailer), '');
}

console.log('\n=== E：token 對照表一次過讀好 ===');
{
  check('★★★★★ 喺 `buildMailContext_()` 讀一次，唔係逐個人讀一次表'
    + '——幾十位收件人就係幾十次讀表，而嗰條路本來已經接近執行上限',
    /personalTokenById: indexPersonalLinkTokens_\(\)/.test(mailer), '');
  const src = fs.readFileSync(path.join(SRC, 'PersonalLinkInMail.gs'), 'utf8');
  check('★★★★★ 讀唔到唔可以令整批寄信失敗（個人連結係錦上添花）',
    /try \{[\s\S]{0,400}readPeople\(\)[\s\S]{0,400}\} catch/.test(src), '');
  check('★★★★ 但要寫 log', /log_\('WARN'[\s\S]{0,80}indexPersonalLinkTokens_/.test(src), '');
}

console.log('\n=== E：整季 PDF 嗰一份真係冇 highlight ===');
{
  // Ivan 明確要求確認呢一點。`FULL_PDF` 行嘅係
  // `buildFullRosterAttachmentCached_()`，同個人版嗰條路唔同——
  // 個人版先會經 highlight。
  const pdf = fs.readFileSync(path.join(SRC, 'PdfExport.gs'), 'utf8');
  // ⚠️ 只切**嗰一個函式嘅本體**（去到佢自己嗰個收結大括號為止）。
  //  切太闊就會切到落一個函式，而嗰個係個人版嗰條路（真係有 highlight）
  //  ——噉個測試就會指住一段唔關事嘅碼話你知有 bug。
  const fullAt = pdf.indexOf('function buildFullRosterPdfBlob_');
  const closeAt = pdf.indexOf('\n}', fullAt);
  const fullFn = fullAt === -1 ? '' : pdf.slice(fullAt, closeAt);
  check('★★★★★ 完整版 PDF 嗰條路冇叫任何 highlight'
    + '（有嘅話，一份「大家睇嘅表」會標住某一個人嘅名）',
    fullFn === '' || !/highlight/i.test(fullFn),
    fullFn.slice(0, 300));
  check('★★★★ 而且個人版嗰條路先有 highlight（反證：唔係全部都冇）',
    /highlight/i.test(pdf), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
