// 第四十輪批次 B 組：那條永久連結一律附在信末。
// 執行方式：node tests/permanent_link_footer.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// 2026-08-21 實測核對過七個範本嘅 `Placeholders` 欄：
// **一個都冇用 `{PublicRosterUrl}`。**
//
// 即係話「範本會放連結」呢個假設由頭到尾都唔成立，
// 而收信嘅人手上只有一份會過期嘅附件——之後內容改咗佢唔會知。
//
// 所以改成系統自己加。呢一份守三種情況：
//   範本有 placeholder　⇒ 唔重複加
//   範本冇　　　　　　　⇒ 加
//   冇公開連結　　　　　⇒ 整段略過（**唔可以出現空連結或者 undefined**）

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SendRecipients.gs', 'Mailer.gs']);

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

const URL = 'https://example.invalid/public/2099T1';

// =====================================================================
console.log('\n=== B【核心】情況一：範本冇 placeholder ⇒ 要加 ===');
{
  const tpl = '各位好，請查閱附件。';
  const plain = gas.appendPermanentLinkFooter_(tpl, tpl, URL, false);
  check('★★★★★ 純文字版真係加咗條連結'
    + '（呢個係收信嘅人之後自己去睇最新版嘅唯一途徑）',
    plain.indexOf(URL) !== -1, plain);
  check('★★★★★ 而且用一句人話講明佢係「固定連結、更新後打開就係最新版」'
    + '——唔講嘅話佢會以為係嗰一次嘅快照，改咗之後唔會再開',
    plain.indexOf('固定連結') !== -1 && plain.indexOf('最新版') !== -1, plain);
  check('★★★★ 原本嘅內文一個字都冇少', plain.indexOf(tpl) === 0, plain);

  const html = gas.appendPermanentLinkFooter_(tpl, tpl, URL, true);
  check('★★★★★ HTML 版係一條撳得到嘅連結，唔係一串裸文字',
    html.indexOf('<a href="' + URL + '">') !== -1, html);
  check('★★★★ 而且同上面嘅內文分開（有分隔線）', html.indexOf('<hr>') !== -1, html);
}

console.log('\n=== B【核心】情況二：範本已經有 placeholder ⇒ 唔可以加多次 ===');
{
  // ⚠️ 範本自己有放，`applyPlaceholders_()` 已經換好。再加一次
  // 就會同一條連結喺一封信入面出現兩次——睇落好似系統壞咗。
  const tpl = '請查閱：{PublicRosterUrl}';
  const applied = '請查閱：' + URL;
  const plain = gas.appendPermanentLinkFooter_(applied, tpl, URL, false);
  checkEqual('★★★★★ 原封不動', plain, applied);
  checkEqual('★★★★★ 條連結只出現一次',
    (plain.match(new RegExp(URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);

  const html = gas.appendPermanentLinkFooter_(applied, tpl, URL, true);
  checkEqual('★★★★ HTML 版一樣', html, applied);
}

console.log('\n=== B【核心】情況三：冇公開連結 ⇒ 整段略過 ===');
{
  // ⚠️ 呢個係三種入面最重要嘅。加一段「固定連結：」後面卻係空白、
  // 或者 `undefined`，比唔加更差——收信嘅人會以為系統壞咗，
  // 而且會去撳一條唔存在嘅連結。
  const tpl = '各位好，請查閱附件。';
  [undefined, null, '', '   '].forEach(function (empty) {
    const plain = gas.appendPermanentLinkFooter_(tpl, tpl, empty, false);
    checkEqual('★★★★★ url = ' + JSON.stringify(empty) + ' ⇒ 內文原封不動',
      plain, tpl);
    check('★★★★★ 而且冇出現「固定連結」四個字'
      + '（出現咗就代表加咗一段後面係空白嘅嘢）',
      plain.indexOf('固定連結') === -1, plain);
    check('★★★★★ 亦都冇出現 undefined／null 呢啲字'
      + '——呢個係本專案一直喺度殺嗰個「缺失被當成正常值」',
      plain.indexOf('undefined') === -1 && plain.indexOf('null') === -1, plain);
  });
}

console.log('\n=== B：連結本身要轉義（HTML 版）===');
{
  // `PublicLinks` 嗰一欄係資料，理論上可以含 `&`、`<`。
  // 唔轉義就會整段 HTML 爛掉。
  const weird = 'https://example.invalid/a?b=1&c=2';
  const html = gas.appendPermanentLinkFooter_('x', 'x', weird, true);
  check('★★★★ `&` 轉成 `&amp;`', html.indexOf('b=1&amp;c=2') !== -1, html);
  check('★★★★★ 而且 href 同顯示文字都轉咗'
    + '（只轉一邊嘅話，撳落去同睇到嘅唔一樣）',
    (html.match(/&amp;/g) || []).length === 2, html);
}

// =====================================================================
console.log('\n=== B：deliverOne_ 真係有叫佢，而且兩邊都叫 ===');
{
  const mailer = fs.readFileSync(path.join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  const body = mailer.slice(mailer.indexOf('function deliverOne_'),
    mailer.indexOf('function sendRealEmail_'));
  check('★★★★★ bodyHtml 有經過信末注入',
    /const bodyHtml = appendPermanentLinkFooter_\(/.test(body), body.slice(0, 200));
  check('★★★★★ bodyPlain 都有'
    + '——只做一邊嘅話，用純文字睇信嗰啲人（好多長者嘅郵件程式）就冇連結',
    /const bodyPlain = appendPermanentLinkFooter_\(/.test(body), body.slice(0, 200));
  check('★★★★★ 傳入去嘅係**原始範本內文**，唔係套用完嘅'
    + '——套用完之後 `{PublicRosterUrl}` 已經冇咗，就永遠偵測唔到「範本本來有放」，'
    + '結果同一條連結出現兩次',
    /template\.bodyHtml, permanentLink, true\)/.test(body)
    && /template\.bodyPlain, permanentLink, false\)/.test(body), body.slice(0, 400));
}

console.log('\n=== B：呢個係硬要求，唔係一個選項 ===');
{
  const opts = fs.readFileSync(path.join(__dirname, '..', 'src', 'SendOptions.gs'), 'utf8');
  const bare = opts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 三個寄出選項入面**冇**「要唔要附永久連結」嗰一項'
    + '——做成選項就有機會被關掉，而嗰批人手上就只剩一份會過期嘅附件',
    !/includeLink|includePermanentLink|withLink/.test(bare), bare.slice(0, 300));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
