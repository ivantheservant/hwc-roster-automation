// 第一百一十四輪批次 VB 組：小修正。
// 執行方式：node tests/round114_vb_small_fixes.test.js
//
//   VB-1 開季前準備清單：季前資料、申報確認、人手檢查排在「生成之前要做：」標題之下；沒有任何生成之前的項目 ⇒ 不顯示空標題
//   VB-2 〔影音組合及協唱〕按「加一行」「移除」重畫之後，捲動位置不跳回最上面
//   VB-3 深連結：第一百一十四輪不能重現卡住，原因不明確 ⇒ 不改程式（只記錄）；這裏鎖住啟動流程與一般載入相同
// 用假名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const FILES = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html',
  'ScriptSuggestion.html', 'ScriptRollback.html'];

console.log('\n=== VB-1：「生成之前要做：」標題之下才是生成之前的項目 ===');
{
  const ui = loadUiScripts(FILES);
  vm.runInContext("currentQuarterId = '2099T3';", ui);
  const items = [{ label: '講員未填', count: 13, phase: 'AFTER', hint: '生成之後在職事表直接填' }, { label: '翻譯未填', count: 0, phase: 'AFTER' }];
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: items, generated: false }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] },
    preseasonStatus: '季前資料：模擬寄出（2098-10-30，人手）', pendingSubmissions: 0 });
  const t = ui.document.getElementById('zone2Body').textContent;
  const at = (s) => t.indexOf(s);
  check('★★★★★★ 次序：這一季還要做的 → 生成之前要做 → 季前資料 → 申報待確認 → 人手檢查 → 生成之後才做 → 講員未填',
    at('這一季還要做的') !== -1 && at('這一季還要做的') < at('生成之前要做：') && at('生成之前要做：') < at('季前資料：')
      && at('季前資料：') < at('事奉人員申報待確認') && at('事奉人員申報待確認') < at('人手檢查：足夠') && at('人手檢查：足夠') < at('生成之後才做')
      && at('生成之後才做') < at('講員未填'), t.slice(t.indexOf('這一季還要做的'), t.indexOf('這一季還要做的') + 300));
  // 生成之後才做以外沒有任何項目（沒有季前資料、沒有申報資料、讀不到人手）⇒ 不顯示空的「生成之前要做：」
  const ui2 = loadUiScripts(FILES);
  vm.runInContext("currentQuarterId = '2099T3';", ui2);
  ui2.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: items, generated: false } });
  const t2 = ui2.document.getElementById('zone2Body').textContent;
  check('★★★★★★ 沒有任何生成之前的項目 ⇒ 不顯示「生成之前要做：」，只有「生成之後才做」', t2.indexOf('生成之前要做：') === -1 && t2.indexOf('生成之後才做') !== -1, t2.slice(-200));
  // 沒有「生成之後」的項目 ⇒ 不分段（照舊）
  const ui3 = loadUiScripts(FILES);
  vm.runInContext("currentQuarterId = '2099T3';", ui3);
  ui3.renderZone2Body({ preQuarter: { undoneItemCount: 1, items: [{ label: '甲', count: 1 }], generated: true }, staffing: { totalBlanks: 0 } });
  const t3 = ui3.document.getElementById('zone2Body').textContent;
  check('★★★★★ 沒有生成之後的項目 ⇒ 不分段（沒有兩個小標題）', t3.indexOf('生成之前要做：') === -1 && t3.indexOf('生成之後') === -1 && t3.indexOf('甲：1 項') !== -1);
}

console.log('\n=== VB-2：〔影音組合及協唱〕重畫之後保留捲動位置 ===');
{
  const ui = loadUiScripts(FILES);
  vm.runInContext("currentQuarterId = '2099T1'; viewOnly_ = false;", ui);
  const data = {
    quarterId: '2099T1', quarterLabel: '2099年1-3月', hasVersion: false, sheetsReady: true, choirInvalid: [], problems: [],
    teams: [{ teamId: '示範組', perMonth: 1, members: [{ personId: 'P9701', postIds: ['READ'], level: 'HARD' }] }],
    singers: [{ leaderPersonId: 'P9701', singerPersonId: 'P9702', singerName: '', level: 'HARD' }], choir: [],
    options: { people: [{ personId: 'P9701', name: '假甲' }, { personId: 'P9702', name: '假乙' }], posts: [{ postId: 'READ', name: '讀經' }, { postId: 'WORSHIP', name: '領詩' }],
      eligibleByPost: { READ: ['P9701', 'P9702'], WORSHIP: ['P9701'] }, worshipPostId: 'WORSHIP', choirPostId: 'CHOIR', maxPerMonth: 8 },
    explain: { teams: '甲', singers: '乙', choir: '丙' }
  };
  ui.renderRuleExtras_(data);
  const mb = ui.document.getElementById('modalBody');
  mb.scrollTop = 480;
  const addRow = mb.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '加一行')[0];
  addRow.fire('click');
  const mb2 = ui.document.getElementById('modalBody');
  check('★★★★★★ 按「加一行」⇒ 多了一行協唱，捲動位置仍然是 480（不跳回最上面）', mb2.scrollTop === 480
    && mb2.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '移除').length === 3, String(mb2.scrollTop));
  mb2.scrollTop = 350;
  mb2.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '移除').slice(-1)[0].fire('click');
  check('★★★★★★ 按「移除」⇒ 捲動位置仍然是 350', ui.document.getElementById('modalBody').scrollTop === 350, String(ui.document.getElementById('modalBody').scrollTop));
  check('★★★★ 開窗（第一次畫）仍然由最上面開始（openModal 把捲動位置設回 0）', /body\.scrollTop = 0;/.test(read('src/ui/Script.html')));
}

console.log('\n=== VB-3：深連結的啟動流程與一般載入相同（只多選季度及打開畫面） ===');
{
  const boot = read('src/ui/ScriptBoot.html');
  check('★★★★★ 啟動：讀權限 → 讀網址參數 → loadQuarters(指定季度) → 載入完成後才打開那個畫面', /await loadMyPermission_\(\);\n\s+deepLink_ = parseDeepLink_\(await readDeepLinkParams_\(\)\);[\s\S]{0,300}await loadQuarters\(deepLink_\.quarter\);[\s\S]{0,120}\}\)\.then\(\(\) => \{ if \(myRole_ !== 'CONFIRMER'\) applyDeepLink_\(deepLink_\); \}\);/.test(boot));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
