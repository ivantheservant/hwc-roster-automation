// 第一百一十二輪批次 UA 組：個人連結頁——申報區要容易找到。
// 執行方式：node tests/round112_ua_personal_declare_jump.test.js
//
//   UA1 頁頂〔申報不能服侍的日子〕按鈕：只在伺服器判斷「可以申報」時顯示（boot.canDeclare）；一般事奉人員在第一階段看不到
//   UA2 只做頁內捲動（scrollIntoView），不改網址、不重新載入頁面
//   UA3 未有版本 ⇒ 申報區排在職事表位置之前；已有版本 ⇒ 次序照舊
//   UA4 提交、撤回、〔我這一季沒有不能服侍的日子〕之後，結果訊息捲到看得到的位置
//   UA5 手機：按鈕最少 48px 高；不新增公開函式
// 用假資料（P97xx、假名）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, tok } = require('./helpers/unavailable_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const page = read('src/ui/PersonalRoster.html');

console.log('\n=== UA1：按鈕顯示條件（伺服器判斷）===');
{
  const sc = buildUnavailableScene({ config: { ROLLOUT_AUDIENCE: ['LEADERS', 'ENUM'] } });
  const g = sc.gas;
  const closed = g.buildPersonalUnavailableBoot_('P9705', tok(5), sc.Q);
  check('★★★★★★ 第一階段、一般事奉人員（未開放）⇒ 沒有 canDeclare', closed.closed === true && !closed.canDeclare, JSON.stringify(closed).slice(0, 200));
  const sc2 = buildUnavailableScene({});
  const open = sc2.gas.buildPersonalUnavailableBoot_('P9705', tok(5), sc2.Q);
  check('★★★★★★ 已開放、有主日可以申報 ⇒ canDeclare = true', open.canDeclare === true && open.view.quarters.length > 0, JSON.stringify(open).slice(0, 200));
  check('★★★★★ 沒有可以申報的主日 ⇒ false', g.personalCanDeclareFromView_({ quarters: [] }) === false);
  check('★★★★★ 讀不到（view = null）⇒ false', g.personalCanDeclareFromView_(null) === false);
  check('★★★★★ 讀不到申報一段（error）⇒ 沒有 canDeclare', (function () {
    const sc3 = buildUnavailableScene({});
    sc3.gas.buildPersonalUnavailableView_ = function () { throw new Error('boom'); };
    const b = sc3.gas.buildPersonalUnavailableBoot_('P9705', tok(5), sc3.Q);
    return !b.canDeclare && !!b.error;
  })());
  check('★★★★★★ 頁面：按鈕預設隱藏（hidden），只在 boot.canDeclare 時顯示',
    /<button class="go-declare" id="goDeclareBtn" type="button" hidden>申報不能服侍的日子<\/button>/.test(page)
    && /if \(goBtn && boot\.canDeclare\) \{\s*goBtn\.hidden = false;/.test(page));
  check('★★★★★ 按鈕在名字（頁頂 toolbar）之下、職事表之前', page.indexOf('id="goDeclareBtn"') > page.indexOf('class="toolbar"') && page.indexOf('id="goDeclareBtn"') < page.indexOf('id="mainCol"'));
}

console.log('\n=== UA2：頁內捲動 ===');
{
  const m = /var goBtn = document\.getElementById\('goDeclareBtn'\);[\s\S]*?\n      \}\n/.exec(page);
  const code = m ? m[0] : '';
  check('★★★★★★ 用 scrollIntoView 捲到 unavSection', /getElementById\('unavSection'\)/.test(code) && /scrollIntoView\(/.test(code), code);
  check('★★★★★★ 不改網址、不跳轉（沒有 location／href／hash／submit）', !/location|href|hash|\.submit\(|pushState/.test(code), code);
  check('★★★★★ 按鈕不是連結（<button type="button">）', !/<a [^>]*goDeclare/.test(page));
}

console.log('\n=== UA3：未有版本 ⇒ 申報區在最上面 ===');
{
  check('★★★★★★ 主內容包在 .main-col；未有版本時加 no-roster', /<div class="main-col<\?= data\.noRoster \? ' no-roster' : '' \?>" id="mainCol">/.test(page));
  check('★★★★★★ .no-roster 時申報區 order: -1（排在職事表位置之前）', /\.main-col \{ display: flex; flex-direction: column; \}\s*\.main-col\.no-roster #unavSection \{ order: -1; \}/.test(page));
  check('★★★★★ 申報區與職事表位置在同一個 .main-col 內', (function () {
    const a = page.indexOf('id="mainCol"');
    const sched = page.indexOf('<div class="schedule">');
    const unav = page.indexOf('id="unavSection"');
    const end = page.indexOf('</div>\n\n  <div class="how-to">');
    return a < sched && sched < unav && unav < end;
  })());
  check('★★★★★ 未有版本時職事表位置仍然只寫一句「這一季的職事表還未發出。」', /<\? if \(data\.noRoster\) \{ \?>\s*<div class="schedule">\s*<h2>你的服侍安排<\/h2>\s*<p>這一季的職事表還未發出。<\/p>/.test(page));
  check('★★★★★ 已有版本 ⇒ 沒有 no-roster class（次序照舊）：class 只由 data.noRoster 決定', !/no-roster/.test(page.replace(/\.main-col\.no-roster[^\n]*\n/, '').replace(/' no-roster'/, '')));
}

console.log('\n=== UA4：結果訊息捲到看得到 ===');
{
  check('★★★★★★ 做過動作（call）才捲動，初次載入不捲動', /userActed = true;/.test(page) && /function scrollToNode\(node\) \{\s*if \(!userActed/.test(page));
  check('★★★★★★ render() 加入訊息後呼叫 scrollToNode', /body\.appendChild\(msgEl\);\s*scrollToNode\(msgEl\);/.test(page));
  check('★★★★★ 提交、撤回、沒有不能服侍的日子三條路都經 call()', /fnName === 'submit'/.test(page) && /personalReplyNoUnavailable/.test(page) && /personalWithdrawUnavailable/.test(page));
  check('★★★★★ 捲動失敗（瀏覽器不支援）靜靜略過', /try \{ node\.scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\); \} catch \(err\)/.test(page));
}

console.log('\n=== UA5：手機、安全 ===');
{
  const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
  check('★★★★★★ 頁頂按鈕最少 48px 高（≥ 44px）', /button\.go-declare \{[^}]*min-height: 48px/.test(css));
  check('★★★★★ 按鈕字體跟正文（font: inherit）', /button\.go-declare \{ font: inherit;/.test(css));
  const gs = read('src/WebAppPersonalLink.gs') + read('src/PersonalUnavailable.gs');
  const pub = (gs.match(/^function (personal[A-Za-z]+)\(/gm) || []).map((s) => s.replace(/^function /, '').replace(/\($/, ''));
  check('★★★★★★ 個人連結頁公開函式仍然只有三個 personal*', JSON.stringify(pub.sort()) === JSON.stringify(['personalReplyNoUnavailable', 'personalSubmitUnavailable', 'personalWithdrawUnavailable']), pub.join(','));
  check('★★★★★ 新函式以 _ 結尾', /function personalCanDeclareFromView_\(/.test(gs));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
