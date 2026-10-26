// 第七十七輪批次 EF 組：常用設定預設展開；拿走〔人員與電郵〕同「Active」嗰句。
// 執行方式：node tests/round77_ef_settings_zone.test.js
//
// Ivan（手動測試 B）：「Auto expand for the section 常用設定」；「we will fetch email and name data from attendance
// system, there should not have manual entry for 人員與電郵, right? Remove this button and function」；
// 「不再服侍的人請把「Active」改成 FALSE…seems not applicable now. Pls remove.」
//
//   EF1　Index：常用設定一開始就係展開；每次重畫主畫面都展開並重畫（renderZone3Always）
//   EF2　常用設定冇〔人員與電郵〕；有〔身分〕〔固定收件人〕〔匯出規則審閱表〕〔重新生成初稿（覆蓋式）〕；新一句提示
//   EF3　人員與電郵畫面（openPeople／renderPeople／apiSavePerson 入口）整個拿走；名單檢查嘅「去處理」改開出席系統連結
//   EF4　全 src 冇再叫幹事去「人員與電郵」／「名單維護」補人補電郵

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
vm.runInContext("currentQuarterId = '2099T1';", ui);
const dash = {
  latestVersion: null, buttons: {}, preQuarter: { undoneItemCount: 0, items: [] },
  settingsLinks: { people: 'https://example.invalid/s#gid=1', roles: 'https://example.invalid/s#gid=2', recipients: 'https://example.invalid/s#gid=3' }
};
const buttonTexts = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON' || n.tagName === 'A').map((n) => n.textContent);

console.log('\n=== EF1：預設展開 ===');
{
  const index = read('src/ui/Index.html');
  const zone3 = (index.match(/<section class="zone" id="zone3">[\s\S]*?<\/section>/) || [''])[0];
  check('★★★★★★ Index：zone3 一開始就係展開（aria-expanded=true、區身冇 hidden）',
    /id="zone3Head" type="button" aria-expanded="true"/.test(zone3) && /<div class="zone-body" id="zone3Body"><\/div>/.test(zone3), zone3);
  const allUi = fs.readdirSync(path.join(ROOT, 'src', 'ui')).map((f) => code(read('src/ui/' + f))).join('\n');
  check('★★★★★★ 每次重畫主畫面都 renderZone3Always(d)（跟住 renderZone2Head(d)；重新整理、換季度之後都係展開）',
    /renderZone2Head\(dashboardState_\);\s*\n\s*renderZone3Always\(dashboardState_\);/.test(allUi));
  // 真係行一次（測試用嘅假 DOM 冇 setAttribute ⇒ 記低 setZoneOpen／markZoneLoaded 收到乜）
  vm.runInContext('__zo = null; setZoneOpen = (h, b, o) => { __zo = [h, b, o]; }; __ml = null; markZoneLoaded = (b) => { __ml = b; return false; };', ui);
  ui.renderZone3Always(dash);
  const body = ui.document.getElementById('zone3Body');
  check('★★★★★ renderZone3Always：直接展開（setZoneOpen true）、標記已載入、內容畫咗',
    JSON.stringify(vm.runInContext('__zo', ui)) === '["zone3Head","zone3Body",true]' && vm.runInContext('__ml', ui) === 'zone3Body'
    && body.textContent.length > 0, JSON.stringify([vm.runInContext('__zo', ui), vm.runInContext('__ml', ui)]));
}

console.log('\n=== EF2：內容 ===');
{
  ui.renderZone3(dash);
  const body = ui.document.getElementById('zone3Body');
  const texts = buttonTexts(body);
  check('★★★★★★ 冇〔人員與電郵〕', texts.indexOf('人員與電郵') === -1, JSON.stringify(texts));
  check('★★★★★ 有〔身分（堂委／執事）〕〔固定收件人／管理員電郵〕〔匯出規則審閱表〕〔重新生成初稿（覆蓋式）〕',
    ['身分（堂委／執事）', '固定收件人／管理員電郵'].every((t) => texts.indexOf(t) !== -1)
    && /匯出規則審閱表/.test(body.textContent) && /重新生成初稿（覆蓋式）/.test(body.textContent), JSON.stringify(texts));
  check('★★★★★★ 新一句：「人員和電郵由出席系統讀取，這裡不用改。身分和固定收件人在試算表那一張工作表改（會在新分頁打開）。」',
    body.textContent.indexOf('人員和電郵由出席系統讀取，這裡不用改。身分和固定收件人在試算表那一張工作表改（會在新分頁打開）。') !== -1, body.textContent.slice(0, 200));
  check('★★★★★★ 冇「Active」改成 FALSE 嗰句', body.textContent.indexOf('Active') === -1);
}

console.log('\n=== EF3：人員與電郵畫面拿走 ===');
{
  const uiDir = path.join(ROOT, 'src', 'ui');
  const hits = [];
  fs.readdirSync(uiDir).forEach((f) => {
    const t = code(fs.readFileSync(path.join(uiDir, f), 'utf8'));
    ['openPeople(', 'renderPeople(', "'apiSavePerson'", 'openAddPerson(', 'personEditor(', 'savePersonWithEmailCheck('].forEach((w) => {
      if (t.indexOf(w) !== -1) hits.push(f + ':' + w);
    });
  });
  check('★★★★★★ 前端冇殘留人員與電郵畫面（openPeople／renderPeople／apiSavePerson／openAddPerson）', hits.length === 0, JSON.stringify(hits));
  const z2 = code(read('src/ui/ScriptZone2.html'));
  check('★★★★★ 名單檢查嘅「去處理」（沒有電郵／不在名單）改開出席系統連結',
    /noEmail: function \(\) \{ openHwcas\(\); \}/.test(z2) && /notInNameList: function \(\) \{ openHwcas\(\); \}/.test(z2));
  check('★★★★★ 進階與診斷有〔出席系統連結〕入口', /zone4Row\('出席系統連結'/.test(read('src/ui/ScriptZone4.html')));
}

console.log('\n=== EF4：字眼 ===');
{
  const srcDir = path.join(ROOT, 'src');
  const hits = [];
  const walk = (dir) => fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    const t = code(fs.readFileSync(p, 'utf8'));
    ['常用設定 ▸ 人員與電郵', '名單維護 ▸', '去「人員與電郵」'].forEach((w) => { if (t.indexOf(w) !== -1) hits.push(f + ':' + w); });
  });
  walk(srcDir);
  check('★★★★★ 全 src 冇再叫幹事去「人員與電郵」／「名單維護」', hits.length === 0, JSON.stringify(hits));
  check('★★★★ 名單上找不到的名字 ⇒ 叫佢撳〔加入名單〕（在出席系統揀人）', /撳〔加入名單〕（在出席系統揀人）/.test(read('src/EligibilitySheetEditor.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
