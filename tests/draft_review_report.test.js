// 第十輪批次階段 D：草稿覆核報告（寫俾堂委睇嗰份）。
// 執行方式：node tests/draft_review_report.test.js
//
// 呢份報告嘅讀者係**堂委**，唔係幹事、更加唔係開發者。所以最重要嘅兩條線：
//   D2：一個內部代號都唔可以出現（HARD_ELIGIBILITY、SEMI_NO_CONSECUTIVE 等等）
//   D3：要明確講清楚邊啲係系統自動排、邊啲係留俾人手填
// 呢兩條都唔係「睇落應該冇問題」就算，要有測試鎖死——文字好易喺日後改動時
// 不小心又漏返個代號出去。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs',
  'Verify.gs', 'SoftRuleMetrics.gs', 'Diagnostics.gs', 'DraftReviewReport.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/** 造一份量度結果，形狀對照 measureSoftRuleMetrics_() 的回傳值。 */
function buildMetrics(overrides) {
  const o = overrides || {};
  const normal = { gap: 0, judgement: gas.SOFT_METRIC_JUDGEMENT.NORMAL };
  return Object.assign({
    quarterId: '2099T4',
    versionNo: 0,
    weekCount: 13,
    chairEq: { same: 8, weeks: 13, ratio: 8 / 13, target: 0.63, tolerance: 0.05, deviates: false },
    chairEqBaseline: 0.63,
    chairEqJudgement: normal,
    announce: { repeats: 4, pairs: 12, ratio: 4 / 12, target: 0.27, tolerance: 0.05, deviates: false },
    announceBaseline: 0.27,
    announceJudgement: normal,
    distribution: {
      peopleCount: 58, average: 3.31, maxCount: 7,
      histogram: [
        { count: 1, people: 15 }, { count: 2, people: 12 }, { count: 3, people: 13 },
        { count: 4, people: 8 }, { count: 7, people: 10 }
      ]
    },
    peopleCountJudgement: normal,
    averageJudgement: normal,
    maxJudgement: normal,
    consecutive: { count: 0, details: [] },
    manpower: [
      {
        postId: 'CHAIR', postNameTC: '主席', assignedSlots: 13, usedCount: 9,
        eligibleCount: 13, ratio: 9 / 13, unusedCount: 4, unusedPeople: [],
        judgement: gas.SOFT_METRIC_JUDGEMENT.NORMAL
      },
      {
        postId: 'AUDIO', postNameTC: '音響', assignedSlots: 13, usedCount: 2,
        eligibleCount: 6, ratio: 2 / 6, unusedCount: 4, unusedPeople: [],
        judgement: gas.SOFT_METRIC_JUDGEMENT.LOW
      }
    ]
  }, o);
}

const BLANK = {
  assigned: 152, manualPending: 39, structuralNa: 10, specialSkip: 4, genuineGap: 0
};

const rows = gas.buildDraftReviewRows_(buildMetrics(), BLANK);
const allText = rows.map(function (r) {
  return [r.section, r.item, r.value, r.note].join(' ');
}).join('\n');

console.log('\n=== D2【核心】報告入面一個內部代號都唔可以出現 ===');
{
  // 直接由正式碼嘅 RULE_IDS 攞晒全部代號嚟掃，唔係人手抄一份清單——
  // 日後加新規則，呢個檢查自動涵蓋。
  const ruleIdValues = Object.keys(gas.RULE_IDS).map(function (k) { return gas.RULE_IDS[k]; });
  const leaked = ruleIdValues.filter(function (id) { return allText.indexOf(id) !== -1; });
  checkEqual('★★ 冇任何 RULE_IDS 代號（HARD_ELIGIBILITY 等）漏出去', leaked, []);

  // 其他常見嘅內部字眼
  const JARGON = [
    'ASSIGN_SOURCE', 'SKIPPED', 'MANUAL_PENDING', 'GENUINE_GAP', 'STRUCTURAL_NA',
    'RosterAssignments', 'RuleFlags', 'PersonID', 'QuarterID', 'VersionNo',
    'epsilon', 'SCORE_TIE', 'DRY_RUN', 'undefined', 'null', 'NaN'
  ];
  const jargonLeaked = JARGON.filter(function (w) { return allText.indexOf(w) !== -1; });
  checkEqual('★★ 冇其他內部字眼（欄位名、狀態值、設定 Key）', jargonLeaked, []);

  // 唔可以有英文大寫底線常數樣式殘留
  const constantPattern = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g;
  const constants = allText.match(constantPattern) || [];
  checkEqual('★★ 冇任何「大寫加底線」樣式嘅常數殘留', constants, []);
}

console.log('\n=== D3：要明確分開「系統自動排」同「留俾人手填」 ===');
{
  check('★★ 有一節專門講「系統排了什麼、留了什麼給人手」',
    /系統排了什麼、留了什麼給人手/.test(allText));
  check('★★ 有明確講出講員、翻譯、獻花唔由系統排',
    /講員/.test(allText) && /翻譯/.test(allText) && /獻花/.test(allText));
  check('★★ 有明確講呢啲空格「係預期中，唔係系統排唔出」',
    /預期中的空格.*不是系統排不出來|不是系統排不出/.test(allText),
    '呢句係防止堂委誤會嘅關鍵');
  check('★ 有講出聖餐襄禮點解得幾週有人',
    /聖餐襄禮只在每月第一個主日/.test(allText));

  const manualRow = rows.filter(function (r) { return /留給人手填寫/.test(r.item); })[0];
  check('★ 「留俾人手填」有實際格數', manualRow && String(manualRow.value).indexOf('39') !== -1,
    manualRow ? manualRow.value : '搵唔到嗰行');

  const assignedRow = rows.filter(function (r) { return /系統自動安排/.test(r.item); })[0];
  check('★ 「系統自動排」有實際格數', assignedRow && String(assignedRow.value).indexOf('152') !== -1);
}

console.log('\n=== D1：硬規則違反 0 項要明明白白寫出嚟（呢個係賣點）===');
{
  const hardRow = rows.filter(function (r) { return /不可違反的規則/.test(r.item); })[0];
  check('★★ 有「不可違反的規則」呢一行', !!hardRow);
  check('★★ 明確寫住 0 項違反', hardRow && String(hardRow.value).indexOf('0 項違反') !== -1,
    hardRow ? hardRow.value : '');
  check('★★ 有解釋點解永遠係 0（寧願留空都唔會違反）',
    hardRow && /寧願把格子留空|不會為了填滿/.test(hardRow.note),
    hardRow ? hardRow.note : '');
  check('★ 有用中文列出係邊幾條規則',
    hardRow && /只安排曾經做過該崗位的人/.test(hardRow.note));
}

console.log('\n=== D1：其餘必要內容 ===');
{
  check('★ 有用了多少人', /參與服侍的人數/.test(allText));
  check('★ 有平均每人服侍幾次', /平均每人服侍次數/.test(allText));
  check('★ 有最多的做幾次', /最多的一位服侍次數/.test(allText));
  check('★ 有次數分佈，而且同過往並列比較',
    /服侍 1 次/.test(allText) && /過往約 \d+ 位/.test(allText));
  check('★ 有準硬規則（連續兩週）嘅數目', /同一崗位盡量不連續兩週/.test(allText));
  check('★ 有主席兼報告比例同過往比較',
    /主席同時擔任報告的比例/.test(allText) && /過往習慣約/.test(allText));
  check('★ 有各崗位動用人數 vs 合資格人數',
    /各崗位的人手運用/.test(allText) && /動用 9 \/ 合資格 13 位/.test(allText));
  check('★ 動用比例偏低嘅崗位有標示出嚟',
    /比例偏低/.test(allText), '音響 2/6 應該被標為偏低');
  check('★ 有講明過往基準嘅來源同期間',
    /2025 年第一季至 2026 年第三季/.test(allText) && /78 週/.test(allText));
}

console.log('\n=== D1：排唔出格子嘅講法要跟住實際數字變 ===');
{
  const zeroGap = gas.buildDraftReviewRows_(buildMetrics(), BLANK);
  const zeroRow = zeroGap.filter(function (r) { return /系統排不出來/.test(r.item); })[0];
  check('★★ 0 格時要講「沒有，全部成功排到人」',
    zeroRow && /沒有。所有應該由系統安排的格子都成功排到人/.test(zeroRow.note),
    zeroRow ? zeroRow.note : '');

  const withGap = gas.buildDraftReviewRows_(buildMetrics(),
    Object.assign({}, BLANK, { genuineGap: 3 }));
  const gapRow = withGap.filter(function (r) { return /系統排不出來/.test(r.item); })[0];
  check('★★ 有格排唔出時要講明幾多格、點標示、要人手處理',
    gapRow && /3 格/.test(gapRow.note) && /需要人手處理/.test(gapRow.note),
    gapRow ? gapRow.note : '');
  check('★ 而且用返表上實際見到嗰個標示文字',
    gapRow && gapRow.note.indexOf(gas.DEFAULTS.GRID_GAP_LABEL) !== -1);
}

console.log('\n=== 一致性：分類統計用返同一個 classifyGridCell_() ===');
{
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'DraftReviewReport.gs'), 'utf8');
  check('★★ 格子分類重用 classifyGridCell_()，唔係另寫一套判斷',
    source.indexOf('classifyGridCell_(') !== -1);
  check('★★ 量度重用 measureSoftRuleMetrics_()，唔會同技術報告講唔同數字',
    source.indexOf('measureSoftRuleMetrics_(') !== -1);
  check('★ 完全唔會寫入除 Diagnostics 以外嘅嘢',
    source.indexOf('insertSheet') === -1
      && source.indexOf('deleteSheet') === -1
      && source.indexOf('setValues') === -1
      && source.indexOf('MailApp') === -1);
}

console.log('\n=== 樣本輸出（人手掃一眼睇下讀唔讀得順）===');
rows.slice(0, 12).forEach(function (r) {
  console.log('  [' + r.section + '] ' + r.item + '：' + r.value
    + (r.note ? '\n      → ' + r.note : ''));
});

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
