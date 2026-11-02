// 第九十六輪批次 WB／WC 組：狀態卡共用 Quarters 的讀取；預設打開下一季。
// 執行方式：node tests/round96_wb_wc_reads_default_quarter.test.js
//
//   WB1 狀態卡載入：Quarters 只讀一次（getQuarterStage_ 在讀表記憶範圍內用同一次 readSheet_）；回傳值和以前相同
//   WB2 範圍外（有寫入的流程）照舊直接讀；找不到季度的錯誤訊息照舊
//   WC1 預設季度：Config WEBAPP_DEFAULT_QUARTER 有值且存在 ⇒ 它；否則開始日在今日之後最早的一季；
//       沒有 ⇒ 包含今日的一季；再沒有 ⇒ 選單第一個
//   WC2 apiListQuarters 標 isDefault（只一項），選單次序不變
//   WC3 前端：沒有深連結 ⇒ 選 isDefault；深連結 quarter 照舊優先；找不到深連結的季度 ⇒ 預設季度
// 用假資料。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (d) => { const x = JSON.parse(JSON.stringify(d)); delete x.timings; if (x.staffing) { delete x.staffing.ms; delete x.staffing.cached; } return JSON.stringify(x); };

console.log('\n=== WB1／WB2：Quarters 只讀一次 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = function () {};
  g.apiGenerateDraftExecute(sc.Q);
  const ss = sc.ss;
  const qs = ss.getSheetByName(sc.S.QUARTERS);
  const raw = qs.getRange.bind(qs);
  let reads = 0;
  qs.getRange = function (r) { if (r === 3) reads++; return raw.apply(qs, arguments); };
  const neu = g.apiGetDashboardState(sc.Q);
  const newReads = reads;
  reads = 0;
  // 舊路徑：getQuarterStage_ 照舊直接讀（模擬：範圍外的讀法）
  const realRead = g.readQuarterValuesForStage_;
  g.readQuarterValuesForStage_ = function (q) {
    const info = g.findQuarterRowInfo_(q);
    if (!info) throw new Error('Quarters 找不到季度: ' + q);
    return info.values;
  };
  const old = g.apiGetDashboardState(sc.Q);
  g.readQuarterValuesForStage_ = realRead;
  check('★★★★★★ WB1 回傳值和以前相同', strip(neu) === strip(old));
  check('★★★★★★ WB1 狀態卡載入 Quarters 只讀一次（以前兩次）', newReads === 1 && reads === 2, newReads + ' vs ' + reads);
  reads = 0;
  check('★★★★★ WB2 範圍外 getQuarterStage_ 照舊直接讀', g.getQuarterStage_(sc.Q) === 'DRAFT' && reads === 1, String(reads));
  let e1 = '';
  let e2 = '';
  try { g.getQuarterStage_('2099T9'); } catch (e) { e1 = e.message; }
  g.beginSheetReadMemo_();
  try { g.getQuarterStage_('2099T9'); } catch (e) { e2 = e.message; } finally { g.endSheetReadMemo_(); }
  check('★★★★★ WB2 找不到季度：範圍內外的錯誤訊息一樣', e1 === 'Quarters 找不到季度: 2099T9' && e2 === e1, e1 + ' / ' + e2);
  g.beginSheetReadMemo_();
  let inMemo;
  try { inMemo = g.getQuarterStage_(sc.Q); } finally { g.endSheetReadMemo_(); }
  check('★★★★ 範圍內外的階段一樣', inMemo === g.getQuarterStage_(sc.Q));
}

console.log('\n=== WC1：預設季度（純函式）===');
{
  const g = buildRound75Scene({ extraFiles: ['WebApp.gs'] }).gas;
  const Q = [
    { quarterId: '2026T4', startDate: '2026-10-01', endDate: '2026-12-31' },
    { quarterId: '2027T1', startDate: '2027-01-01', endDate: '2027-03-31' },
    { quarterId: '2027T2', startDate: '2027-04-01', endDate: '2027-06-30' },
    { quarterId: '2026T3', startDate: '2026-07-01', endDate: '2026-09-30' }
  ];
  check('★★★★★★ WC1 Config 有值且存在 ⇒ 它', g.pickDefaultQuarterId_(Q, '2026-11-03', '2027T2') === '2027T2');
  check('★★★★★ WC1 Config 的季度不存在 ⇒ 照下一季', g.pickDefaultQuarterId_(Q, '2026-11-03', '2030T1') === '2027T1');
  check('★★★★★★ WC1 沒有 Config ⇒ 開始日在今日之後最早的一季（2026-11-03 ⇒ 2027T1）', g.pickDefaultQuarterId_(Q, '2026-11-03', '') === '2027T1');
  check('★★★★ 不看選單次序（最早開始的一季）', g.pickDefaultQuarterId_([Q[2], Q[1], Q[0]], '2026-11-03', '') === '2027T1');
  check('★★★★ 開始日＝今日不算「之後」', g.pickDefaultQuarterId_(Q, '2027-01-01', '') === '2027T2');
  check('★★★★★★ WC1 沒有之後的季度 ⇒ 包含今日的那一季', g.pickDefaultQuarterId_([Q[3], Q[0]], '2026-11-03', '') === '2026T4');
  check('★★★★★★ WC1 再沒有 ⇒ 選單第一個', g.pickDefaultQuarterId_([Q[3], { quarterId: '2026T2', startDate: '2026-04-01', endDate: '2026-06-30' }], '2026-11-03', '') === '2026T3');
  check('★★★★ 沒有季度 ⇒ 空字串', g.pickDefaultQuarterId_([], '2026-11-03', '') === '');
}

console.log('\n=== WC2：apiListQuarters ===');
{
  const sc = buildRound75Scene({ extraFiles: ['WebApp.gs', 'NewQuarterWizard.gs', 'AnnualQuarters.gs'] });
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = function () {};
  g.apiEnsureFutureQuarters();
  const list = g.apiListQuarters();
  const today = g.Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd');
  const defaults = list.filter((q) => q.isDefault);
  const expected = g.pickDefaultQuarterId_(list, today, '');
  check('（前置）有幾季', list.length >= 3, JSON.stringify(list.map((q) => q.quarterId)));
  check('★★★★★★ WC2 只有一項 isDefault，就是 pickDefaultQuarterId_ 的結果（今日之後最早的一季）', defaults.length === 1 && defaults[0].quarterId === expected
    && defaults[0].startDate > today, JSON.stringify(defaults));
  check('★★★★★ WC2 選單次序不變（Quarters 工作表的次序）', JSON.stringify(list.map((q) => q.quarterId))
    === JSON.stringify(g.readSheet_(sc.S.QUARTERS).map((r) => r[sc.C.QUARTERS.QUARTER_ID])));
  const realGet = g.getConfig_;
  g.getConfig_ = (k, fb) => (k === 'WEBAPP_DEFAULT_QUARTER' ? sc.Q : realGet(k, fb));
  const withCfg = g.apiListQuarters().filter((q) => q.isDefault);
  g.getConfig_ = realGet;
  check('★★★★★★ WC2 Config WEBAPP_DEFAULT_QUARTER ⇒ 標那一季', withCfg.length === 1 && withCfg[0].quarterId === sc.Q, JSON.stringify(withCfg));
  const seed = read('src/ConfigSeed.gs');
  check('★★★★ Config 種子（STR，預設空白）及基線', /key: CONFIG_KEYS\.WEBAPP_DEFAULT_QUARTER, type: CONFIG_TYPES\.STR[\s\S]{0,80}defaultValue: ''/.test(seed)
    && /"WEBAPP_DEFAULT_QUARTER"/.test(read('docs/config_baseline_上線值.json'))
    && /WEBAPP_DEFAULT_QUARTER: \{ launchTargetValue: ''/.test(read('src/ConfigBaselineCheck.gs')));
}

console.log('\n=== WC3：前端 ===');
(async () => {
  const UI = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];
  const ui = loadUiScripts(UI);
  const quarters = [
    { quarterId: '2026T4', label: 'A' }, { quarterId: '2027T1', label: 'B', isDefault: true }, { quarterId: '2028T3', label: 'C' }
  ];
  ui.callServer = async () => quarters;
  const loads = [];
  ui.loadDashboard = async () => { loads.push(vm.runInContext('currentQuarterId', ui)); };
  await ui.fillQuarterSelect_(null);
  const sel = ui.document.getElementById('quarter');
  check('★★★★★★ WC3 沒有深連結 ⇒ 預設季度（isDefault）', vm.runInContext('currentQuarterId', ui) === '2027T1' && loads[0] === '2027T1', loads.join(','));
  check('★★★★★ WC3 選單次序不變', Array.from(sel.children).map((o) => o.value).join(',') === '2026T4,2027T1,2028T3');
  await ui.fillQuarterSelect_('2028T3');
  check('★★★★★★ WC3 深連結 quarter 照舊優先', vm.runInContext('currentQuarterId', ui) === '2028T3');
  await ui.fillQuarterSelect_('2099T9');
  check('★★★★★ WC3 深連結的季度找不到 ⇒ 預設季度', vm.runInContext('currentQuarterId', ui) === '2027T1');
  // （沒有 isDefault 時照舊靠瀏覽器：清空選單後預設第一個——假 DOM 不模擬這一點，所以不在這裏測）

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
