// 第九十一輪批次 RA 組：人手填寫的崗位一律由 Posts.AutoGenerate=FALSE（及 Frequency=AS_NEEDED）決定。
// 執行方式：node tests/round91_ra_manual_posts.test.js
//
// 第九十輪 V5：領詩、司琴改為人手填之後，生成確認窗、完成窗仍寫「講員、翻譯、獻花」；
// 完成窗寫 26 格，工作表圖例寫 65 格。
//
//   RA1 純函式：AutoGenerate=FALSE／AS_NEEDED 才算；原始行和 normalized 都認得；名稱按 Posts 次序
//   RA2 生成：領詩改為人手填、HARD_NO_AUTO_PREACHER 的 ScopePostIDs 是舊值（不包括領詩）⇒ 領詩照樣是人手填；
//       完成窗格數＝工作表圖例「待填」格數；確認窗、完成窗、圖例都列出崗位名稱
//   RA3 「這一季還要做的」：講員／翻譯／獻花以外的人手填寫崗位逐個列出（例如「領詩未填」）
//   RA4 規則審閱表、草稿覆核報告、匯入窗、其他畫面字眼
// 下面用假資料，不涉及真實姓名。

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

/** 場景：領詩（WORSHIP）改為 AutoGenerate=FALSE；HARD_NO_AUTO_PREACHER 的 ScopePostIDs 寫舊值（不包括領詩）。 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({ extraFiles: ['RuleReview.gs', 'DraftReviewReport.gs', 'WebAppRuleReview.gs'] });
  const g = sc.gas; const S = sc.S; const C = sc.C;
  if (opts.withTranslation) {
    // 翻譯：Frequency=AS_NEEDED，這一季沒有主日要翻譯 ⇒ 清單「翻譯未填：0」，但圖例每週都是「待填」
    const P = C.POSTS;
    sc.appendRows(sc.ss, S.POSTS, [P.POST_ID, P.POST_NAME_TC, P.SLOT_COUNT, P.DISTINCT_WITHIN_POST, P.FREQUENCY, P.AUTO_GENERATE,
      P.ALLOW_CONSECUTIVE, P.MUTEX_GROUP, P.DISPLAY_ORDER, P.ACTIVE, P.EMPTY_DISPLAY], [{ [P.POST_ID]: 'TRANS', [P.POST_NAME_TC]: '翻譯',
      [P.SLOT_COUNT]: 1, [P.DISTINCT_WITHIN_POST]: false, [P.FREQUENCY]: 'AS_NEEDED', [P.AUTO_GENERATE]: true, [P.ALLOW_CONSECUTIVE]: 'ALLOW',
      [P.MUTEX_GROUP]: '', [P.DISPLAY_ORDER]: 6, [P.ACTIVE]: true, [P.EMPTY_DISPLAY]: 'PENDING' }]);
  }
  const posts = sc.ss.getSheetByName(S.POSTS);
  const pkeys = posts.getRange(2, 1, 1, posts.getLastColumn()).getValues()[0];
  for (let r = 3; r <= posts.getLastRow(); r++) {
    if (posts.getRange(r, 1).getValue() === 'WORSHIP') posts.getRange(r, pkeys.indexOf(C.POSTS.AUTO_GENERATE) + 1).setValue(false);
  }
  const rs = sc.ss.getSheetByName(S.RULE_SETTINGS);
  const rkeys = rs.getRange(2, 1, 1, rs.getLastColumn()).getValues()[0];
  for (let r = 3; r <= rs.getLastRow(); r++) {
    if (rs.getRange(r, 1).getValue() === 'HARD_NO_AUTO_PREACHER') {
      rs.getRange(r, rkeys.indexOf(C.RULE_SETTINGS.SCOPE_POST_IDS) + 1).setValue('PREACH,FLOWER');
    }
  }
  return sc;
}

// =====================================================================
console.log('\n=== RA1：純函式 ===');
{
  const g = buildRound75Scene().gas;
  const posts = [
    { postId: 'CHAIR', postNameTC: '主席', autoGenerate: true, frequency: 'WEEKLY' },
    { postId: 'WORSHIP', postNameTC: '領詩', autoGenerate: false, frequency: 'WEEKLY' },
    { postId: 'TRANS', postNameTC: '翻譯', autoGenerate: true, frequency: 'AS_NEEDED' },
    { postId: 'PREACH', postNameTC: '講員', autoGenerate: false, frequency: 'WEEKLY' }
  ];
  check('★★★★★★ AutoGenerate=FALSE 及 Frequency=AS_NEEDED 才算；按傳入次序', g.describeManualFillPostNames_(posts) === '領詩、翻譯、講員',
    g.describeManualFillPostNames_(posts));
  const raw = [{ PostID: 'A', PostName_TC: '甲', AutoGenerate: 'FALSE', Frequency: 'WEEKLY' },
    { PostID: 'B', PostName_TC: '乙', AutoGenerate: true, Frequency: 'WEEKLY' }];
  check('★★★★★ 原始行（readPosts_）亦認得', g.describeManualFillPostNames_(raw) === '甲', g.describeManualFillPostNames_(raw));
  check('★★★★ 沒有中文名 ⇒ 用 PostID', g.describeManualFillPostNames_([{ postId: 'X', postNameTC: '', autoGenerate: false }]) === 'X');
  check('★★★★★ 句子：有名稱 ⇒「人手填寫的崗位（…）」；沒有 ⇒「人手填寫的崗位」',
    g.manualFillPostsPhrase_('講員、領詩') === '人手填寫的崗位（講員、領詩）' && g.manualFillPostsPhrase_('') === '人手填寫的崗位');
}

// =====================================================================
console.log('\n=== RA2：生成 ===');
{
  const sc = scene({ withTranslation: true });
  const g = sc.gas;
  const plan = g.apiGenerateDraftPlan(sc.Q);
  check('★★★★★★ 確認窗：人手填寫的崗位按 Posts 列出（領詩、獻花、講員、翻譯）', plan.manualPostNames === '領詩、獻花、講員、翻譯', plan.manualPostNames);
  const res = g.apiGenerateDraftExecute(sc.Q);
  check('（前置）生成成功', res.ok !== false && res.versionNo === 0, JSON.stringify(res).slice(0, 300));
  const worship = sc.rows(0).filter((r) => r[sc.A.POST_ID] === 'WORSHIP');
  check('★★★★★★ ScopePostIDs 是舊值（不包括領詩）⇒ 領詩照樣不自動排（4 格都是人手填）',
    worship.length === 4 && worship.every((r) => !r[sc.A.PERSON_ID] && String(r[sc.A.RULE_FLAGS]).indexOf('HARD_NO_AUTO_PREACHER') !== -1),
    JSON.stringify(worship.map((r) => [r[sc.A.PERSON_ID], r[sc.A.RULE_FLAGS]])));
  const layout = g.buildGridLayout_(sc.Q, g.readVersionAssignmentsForGrid_(sc.Q, 0));
  const legend = g.buildLegendRows_(layout);
  const pending = legend.filter((r) => r[0] === layout.labels.pending)[0];
  // 舊做法（清單加總）＝講員 4＋翻譯 0（沒有主日要翻譯）＋獻花 4＋領詩 4＝12；圖例＝16（翻譯每週都待填）
  check('★★★★★★ 完成窗格數＝工作表圖例「待填」格數（同一個來源，16 格；不是清單加總的 12）', pending && pending[2] === res.manualPendingCount + ' 格' && res.manualPendingCount === 16,
    JSON.stringify({ legend: pending, res: res.manualPendingCount }));
  check('★★★★★ 完成窗帶崗位名稱', res.manualPostNames === '領詩、獻花、講員、翻譯', res.manualPostNames);
  check('★★★★★ 圖例「待填」那一行列出崗位名稱', pending && pending[1] === '此崗位不由系統自動安排（領詩、獻花、講員、翻譯），需要人手填寫', pending && pending[1]);
}

// =====================================================================
console.log('\n=== RA3：「這一季還要做的」===');
{
  const sc = scene();
  const g = sc.gas;
  const inputs = g.buildPreQuarterChecklistInputs_(sc.Q);
  check('★★★★★ 講員／翻譯／獻花以外的人手填寫崗位（領詩）另外列出', JSON.stringify(inputs.otherManualPosts) === JSON.stringify([{ postId: 'WORSHIP', postNameTC: '領詩' }]),
    JSON.stringify(inputs.otherManualPosts));
  const pq = g.planPreQuarterChecklist_(inputs);
  const item = pq.items.filter((i) => i.id === 'manualEmpty_WORSHIP')[0];
  check('★★★★★★ 清單有「領詩未填：4」，提示「生成之後在職事表直接填」', item && item.label === '領詩未填' && item.count === 4 && item.hint === g.MANUAL_FILL_HINT_TC,
    JSON.stringify(pq.items));
  check('★★★★ 舊的三項仍在（講員、翻譯、獻花）', ['preacherEmpty', 'translationEmpty', 'flowerEmpty'].every((id) => pq.items.some((i) => i.id === id)));
  check('★★★★ 沒有完成窗數字時，退回清單加總也計領詩', g.sumManualFillItems_(pq) === pq.items.filter((i) => /Empty/.test(i.id)).reduce((s, i) => s + i.count, 0)
    && g.sumManualFillItems_(pq) >= 4);
  check('★★★★ AS_NEEDED 的崗位不會另外列（翻譯已有自己的一項）', !/AS_NEEDED/.test(JSON.stringify(inputs.otherManualPosts)));
}

// =====================================================================
console.log('\n=== RA4：規則審閱表、草稿覆核報告、畫面 ===');
{
  const sc = scene();
  const g = sc.gas;
  const R = g.COLUMNS.RULE_SETTINGS;
  const rule = { [R.RULE_ID]: 'HARD_NO_AUTO_PREACHER', [R.LEVEL]: 'HARD', [R.ENABLED]: true, [R.SCOPE_POST_IDS]: 'PREACH,FLOWER' };
  const d = g.describeRuleForReview_(rule, 'HARD', 13, { manualPostNames: '領詩、獻花、講員' });
  check('★★★★★★ 規則審閱表：名稱「人手填寫的崗位不自動排」；現時設定列出崗位（不看 ScopePostIDs）',
    d.text === '人手填寫的崗位不自動排' && d.currentText === '有生效：領詩、獻花、講員', JSON.stringify(d));
  check('★★★★ 規則審閱表說明沒有內部術語（Posts、ScopePostIDs、AutoGenerate）', !/Posts|ScopePostIDs|AutoGenerate/.test(d.what), d.what);
  check('★★★★ 規則審閱表讀實際 Posts 名稱', g.buildRuleReviewContext_().manualPostNames === '領詩、獻花、講員');
  check('★★★★★ 草稿覆核報告：規則名稱不再寫死', /map\[RULE_IDS\.NO_AUTO_GENERATE\] = '人手填寫的崗位不由系統安排'/.test(read('src/DraftReviewReport.gs'))
    && !/講員、翻譯、獻花/.test(read('src/DraftReviewReport.gs')));
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  check('★★★★★ 畫面句子：傳了名稱 ⇒ 用那個；沒有 ⇒ 用主畫面狀態；兩樣都沒有 ⇒「人手填寫的崗位」',
    ui.manualPostsPhrase('領詩') === '人手填寫的崗位（領詩）' && ui.manualPostsPhrase('') === '人手填寫的崗位'
    && (vm.runInContext("dashboardState_ = { manualPostNames: '講員、領詩' };", ui), ui.manualPostsPhrase('') === '人手填寫的崗位（講員、領詩）'));
  const uiSrc = ['Script.html', 'ScriptZone1.html', 'ScriptZone4.html', 'ScriptSuggestion.html'].map((f) => read('src/ui/' + f)).join('\n');
  check('★★★★★★ 生成確認窗、完成窗、匯入窗、「不算在內」句子都不再寫死講員／翻譯／獻花',
    !/講員、翻譯、獻花不會自動排|格是要你人手填的（講員、翻譯、獻花）|講員／翻譯／獻花那幾欄|講員、翻譯、獻花照舊自己填/.test(uiSrc)
    && /manualPostsPhrase\(plan\.manualPostNames\) \+ '不會自動排/.test(uiSrc) && /manualPostsPhrase\(res\.manualPostNames\)/.test(uiSrc));
  check('★★★★ 主畫面狀態帶 manualPostNames', /manualPostNames: readManualFillPostNamesSafe_\(\)/.test(read('src/WebAppDashboard.gs')));
  check('★★★★ 選單版生成報告用 result.manualPostNames', /result\.manualPostNames/.test(read('src/FourStageFlow.gs')));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exitCode = fail === 0 ? 0 : 1;
