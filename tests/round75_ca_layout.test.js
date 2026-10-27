// 第七十五輪批次 CA 組：幹事介面版面整理（Ivan 手動測試 A）。
// 執行方式：node tests/round75_ca_layout.test.js
//
// 新主畫面（摘要）：
//   開季前準備：〔開啟名單工作表〕〔儲存並套用名單〕→〔不能服侍的日期〕→「這一季還要做的」
//   主流程第 2 步：多咗〔排表偏好〕（第七十七輪批次 EA 組：再搬去開季前準備）
//   常用設定（取代「名單維護」）：〔人員與電郵〕〔身分（堂委／執事）〕〔固定收件人／管理員電郵〕
//     （新分頁開工作表）＋〔匯出規則審閱表〕〔重新生成初稿（覆蓋式）〕
//   進階與診斷：加〔名單檢查〕；〔重新生成〕〔匯出規則審閱表〕搬走
//   拿走入口：〔崗位資格〕〔暫時不做某崗位〕（`PersonPostExclusions` 資料照留，排表照守）
//
// ⚠️ 呢一份**真係執行**各區嘅 render 函式（ui_loader），睇畫咗乜，唔係讀字串。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html',
  'ScriptRollback.html']);
vm.runInContext("currentQuarterId = '2099T3';", ui);

const buttonTexts = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
const anchors = (node) => node.flatten().filter((n) => n.tagName === 'A');
const clickables = (node) => node.flatten()
  .filter((n) => n.tagName === 'BUTTON' || n.tagName === 'A').map((n) => n.textContent);

const dash = {
  latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/grid' },
  buttons: { save: { enabled: true } },
  preQuarter: { undoneItemCount: 1, items: [{ label: '講員未填', count: 3 }] },
  settingsLinks: {
    people: 'https://example.invalid/s#gid=1',
    roles: 'https://example.invalid/s#gid=2',
    recipients: 'https://example.invalid/s#gid=3'
  },
  publicLink: { hasLink: false }
};

console.log('\n=== CA①：「名單維護」整區冇咗，換成「常用設定」 ===');
{
  const index = read('src/ui/Index.html');
  const zoneTitles = (index.match(/<span class="zone-title">([^<]+)<\/span>/g) || []).join(' ');
  check('★★★★★★ Index 冇「名單維護」區', !/名單維護/.test(zoneTitles), zoneTitles);
  check('★★★★★★ Index 有「常用設定」區', /常用設定/.test(zoneTitles), zoneTitles);
  const z3 = ui.renderZone3(dash) || ui.document.getElementById('zone3Body');
  const body = ui.document.getElementById('zone3Body');
  const all = clickables(body);
  // 第七十七輪批次 EF 組：〔人員與電郵〕拿走（人員同電郵由出席系統讀取）
  check('★★★★★★ 常用設定冇〔人員與電郵〕、冇「Active」嗰句', all.indexOf('人員與電郵') === -1 && body.textContent.indexOf('Active') === -1, JSON.stringify(all));
  ['身分（堂委／執事）', '固定收件人／管理員電郵'].forEach((t) => {
    const a = anchors(body).filter((n) => n.textContent === t)[0];
    check('★★★★★ 常用設定〔' + t + '〕係一條新分頁連結（target=_blank）',
      a && a.target === '_blank' && /^https:\/\/example\.invalid\/s#gid=/.test(a.href), a ? a.href + ' ' + a.target : 'none');
  });
  // 第八十二輪批次 II／IJ 組（刻意改動）：〔重新生成初稿（覆蓋式）〕拿走，換成〔整季清走重來〕
  check('★★★★★ 常用設定有〔匯出規則審閱表〕〔整季清走重來〕兩項、冇〔重新生成初稿（覆蓋式）〕',
    /匯出規則審閱表/.test(body.textContent) && /整季清走重來/.test(body.textContent)
      && !/重新生成初稿（覆蓋式）/.test(body.textContent), body.textContent.slice(0, 300));
  ['崗位資格', '暫時不做某崗位', '不能服侍的日期', '排表偏好'].forEach((t) => {
    check('★★★★★ 常用設定冇〔' + t + '〕', all.indexOf(t) === -1 && body.textContent.indexOf('〔' + t) === -1, JSON.stringify(all));
  });
  // 搵唔到工作表 ⇒ 灰掣＋原因，唔畫一條去錯地方嘅連結
  ui.renderZone3({ settingsLinks: { people: '', roles: 'https://example.invalid/r', recipients: '' } });
  const b2 = ui.document.getElementById('zone3Body');
  const dead = b2.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '固定收件人／管理員電郵')[0];
  check('★★★★ 網址空 ⇒ 灰掣而且有原因', dead && dead.disabled && /EmailRecipients/.test(dead.title), dead ? dead.title : 'none');
}

console.log('\n=== CA②：開季前準備：名單 → 不能服侍的日期 → 清單；冇〔名單檢查〕 ===');
{
  ui.renderZone2Body(dash);
  const body = ui.document.getElementById('zone2Body');
  const btns = buttonTexts(body);
  check('★★★★★ 有〔開啟名單工作表〕〔儲存並套用名單〕', btns.indexOf('開啟名單工作表') !== -1 && btns.indexOf('儲存並套用名單') !== -1, JSON.stringify(btns));
  check('★★★★★★ 有〔不能服侍的日期〕', btns.indexOf('不能服侍的日期') !== -1, JSON.stringify(btns));
  check('★★★★★ 冇〔名單檢查〕（搬咗去進階與診斷）', btns.indexOf('名單檢查') === -1, JSON.stringify(btns));
  const t = body.textContent;
  check('★★★★ 次序：名單工作表 → 不能服侍的日期 → 「這一季還要做的」',
    t.indexOf('開啟名單工作表') < t.indexOf('不能服侍的日期') && t.indexOf('不能服侍的日期') < t.indexOf('這一季還要做的'), t.slice(0, 300));
}

console.log('\n=== CA③：〔排表偏好〕喺開季前準備（第七十七輪批次 EA 組：由第 2 步搬過去）===');
{
  const card = ui.renderStep2(dash, { suggestion: {} });
  check('★★★★★★ 第 2 步冇〔排表偏好〕', buttonTexts(card).indexOf('排表偏好') === -1, JSON.stringify(buttonTexts(card)));
  ui.renderZone2Body(dash);
  const btns = buttonTexts(ui.document.getElementById('zone2Body'));
  check('★★★★★★ 開季前準備有〔排表偏好〕，喺〔不能服侍的日期〕旁邊',
    btns.indexOf('排表偏好') !== -1 && btns.indexOf('排表偏好') === btns.indexOf('不能服侍的日期') + 1, JSON.stringify(btns));
}

console.log('\n=== CA④：進階與診斷：加〔名單檢查〕；〔重新生成〕〔匯出規則審閱表〕搬走 ===');
{
  ui.renderZone4(dash);
  const body = ui.document.getElementById('zone4Body');
  const t = body.textContent;
  check('★★★★★ 進階與診斷有「名單檢查」', /名單檢查/.test(t), t.slice(0, 400));
  check('★★★★★ 進階與診斷仍有「匯入人手編好的職事表」', /匯入人手編好的職事表/.test(t));
  check('★★★★★ 進階與診斷冇「重新生成初稿（覆蓋式）」', !/重新生成初稿（覆蓋式）/.test(t));
  check('★★★★★ 進階與診斷冇「匯出規則審閱表」（匯入規則審閱表留低）', !/匯出規則審閱表'/.test(t) && !/zone4Row\('匯出規則審閱表'/.test(read('src/ui/ScriptZone4.html')) && /匯入規則審閱表/.test(t));
}

console.log('\n=== CA⑤：拿走嘅入口真係冇咗；資料照留 ===');
{
  const allUi = ['ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html', 'ScriptMainFlow.html']
    .map((f) => read('src/ui/' + f)).join('\n');
  check('★★★★★ 冇任何掣開〔崗位資格〕彈窗（openEligibility()）', !/button\('[^']*', \(\) => openEligibility\(\)/.test(allUi));
  check('★★★★★ 冇任何掣開〔暫時不做某崗位〕（openExclusions()）', !/button\('[^']*', \(\) => openExclusions\(\)/.test(allUi));
  check('★★★★ 排表照舊讀 PersonPostExclusions（Generator 冇改）', /findActivePersonPostExclusion_\(/.test(read('src/Generator.gs')));
}

console.log('\n=== CA⑥：後端 settingsLinks（試算表 ID 同 gid 實時問，唔寫死）===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'WebAppDashboard.gs']);
  const sheets = { NameMapping: 11, Roles: 22 };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getId: () => 'SSID',
      getSheetByName: (n) => (sheets[n] ? { getSheetId: () => sheets[n] } : null)
    })
  };
  gas.log_ = () => {};
  const links = gas.buildSettingsSheetLinks_();
  check('★★★★★ NameMapping 連結帶 gid', links.people === 'https://docs.google.com/spreadsheets/d/SSID/edit#gid=11', links.people);
  check('★★★★★ Roles 連結帶 gid', links.roles === 'https://docs.google.com/spreadsheets/d/SSID/edit#gid=22', links.roles);
  check('★★★★★ 冇 EmailRecipients 工作表 ⇒ 空字串（前端畫灰掣）', links.recipients === '', links.recipients);
  check('★★★★ buildDashboardState_() 有 settingsLinks', /settingsLinks: buildSettingsSheetLinks_\(\)/.test(read('src/WebAppDashboard.gs')));
}

console.log('\n=== CA⑦：所有開試算表／檔案嘅連結都喺新分頁 ===');
{
  ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'].forEach((f) => {
    const src = read('src/ui/' + f);
    const anchorsN = (src.match(/make\('a',/g) || []).length;
    const blanks = (src.match(/\.target = '_blank';/g) || []).length;
    check('★★★★ ' + f + '：每一條 <a> 都有 target=_blank（' + anchorsN + ' 條）', blanks >= anchorsN, anchorsN + ' vs ' + blanks);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
