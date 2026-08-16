// 第十輪批次階段 A：草稿呈現品質——四類留空格子的分類與標示。
// 執行方式：node tests/grid_cell_presentation.test.js
//
// 背景：2026T4 嘅草稿會印出嚟俾堂委睇，用嚟展示自動排表嘅成果。最大嘅風險
// 唔係功能缺失，而係觀感——講員、翻譯、獻花三個崗位一律唔自動生成，
// 聖餐襄禮 13 週得 3 週有人。如果 PDF 上淨係一片空白，堂委第一個反應會係
// 「呢個系統排唔到」，而唔係「呢幾行本來就要人手填」。
//
// 修正前嘅實際情況（呢份測試嘅反證段落會證明返出嚟）：
//   - 「講員／翻譯／獻花」同「系統應該排但排唔出」**兩類文字同底色完全一樣**，
//     唯一分別係後者有個儲存格批註，而批註喺 PDF 只會變成頁尾註腳。
//
// 測試對象係**真正嘅 Generator.gs 原始碼**（classifyGridCell_()，經
// tests/helpers/gas_loader.js 載入 Node 沙箱），唔係另抄一份副本。
// 顯示層（resolveGridCellText_／buildLegendRows_）喺 RosterWriter.gs，
// 嗰個檔案有 SpreadsheetApp 呼叫喺函式入面（唔係 top-level），一樣載得入沙箱。

const { loadGasSource } = require('./helpers/gas_loader.js');

// RosterWriter.gs 需要 Constants／Utils／SheetReader／Generator；
// 全部 GAS API 呼叫都喺函式入面，top-level 冇，所以載得入沙箱。
const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'RosterWriter.gs',
  // A4 的版面估算函式 estimatePdfColumnWidth_() 喺呢個檔案，一樣係純運算
  'PdfContentSelfCheck.gs'
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

const CLASS = gas.GRID_CELL_CLASS;
const RULE_IDS = gas.RULE_IDS;
const ASSIGN_SOURCE = gas.ASSIGN_SOURCE;

/** 四類留空格子 ＋ 已排定，逐個造一個代表性的 assignment。 */
function makeCell(kind) {
  const base = { serviceDate: '2099-01-04', postId: 'X', slotIndex: 1, personId: '', personName: '' };
  if (kind === 'assigned') {
    return Object.assign({}, base, {
      postId: 'CHAIR', personId: 'P001', personName: '陳大文',
      assignSource: ASSIGN_SOURCE.AUTO, ruleFlags: []
    });
  }
  if (kind === 'preacher') {
    // 講員／翻譯／獻花：Posts.AutoGenerate=FALSE 或 Frequency=AS_NEEDED
    return Object.assign({}, base, {
      postId: 'PREACHER', assignSource: ASSIGN_SOURCE.SKIPPED,
      ruleFlags: [RULE_IDS.NO_AUTO_GENERATE]
    });
  }
  if (kind === 'communion') {
    // 聖餐襄禮：非每月第一個主日，呢一週根本冇呢個崗位
    return Object.assign({}, base, {
      postId: 'COMMUNION', assignSource: ASSIGN_SOURCE.SKIPPED,
      ruleFlags: [RULE_IDS.COMMUNION_FIRST_SUNDAY]
    });
  }
  if (kind === 'specialSkip') {
    return Object.assign({}, base, {
      postId: 'WORSHIP', assignSource: ASSIGN_SOURCE.SKIPPED,
      ruleFlags: [RULE_IDS.SPECIAL_SUNDAY_SKIP]
    });
  }
  if (kind === 'gap') {
    // 系統應該排但排唔出：整池人當週都唔得閒
    return Object.assign({}, base, {
      postId: 'AUDIO', assignSource: ASSIGN_SOURCE.SKIPPED,
      ruleFlags: [RULE_IDS.ELIGIBILITY]
    });
  }
  if (kind === 'lockedGap') {
    // LockPostIDs 鎖定但冇現有人選可保留——一樣係「排唔出」
    return Object.assign({}, base, {
      postId: 'PIANO', assignSource: ASSIGN_SOURCE.LOCKED, ruleFlags: []
    });
  }
  throw new Error('unknown kind: ' + kind);
}

console.log('\n=== A1／A5：五種格子各自分到正確嘅類別 ===');
{
  checkEqual('★ 已排定人選 → ASSIGNED', gas.classifyGridCell_(makeCell('assigned')), CLASS.ASSIGNED);
  checkEqual('★ 講員（AutoGenerate=FALSE）→ MANUAL_PENDING',
    gas.classifyGridCell_(makeCell('preacher')), CLASS.MANUAL_PENDING);
  checkEqual('★ 聖餐襄禮非首主日 → STRUCTURAL_NA',
    gas.classifyGridCell_(makeCell('communion')), CLASS.STRUCTURAL_NA);
  checkEqual('★ 特別主日跳過 → SPECIAL_SKIP',
    gas.classifyGridCell_(makeCell('specialSkip')), CLASS.SPECIAL_SKIP);
  checkEqual('★★ 找不到合資格人選 → GENUINE_GAP',
    gas.classifyGridCell_(makeCell('gap')), CLASS.GENUINE_GAP);
  checkEqual('★ LockPostIDs 鎖定但冇人可保留 → GENUINE_GAP',
    gas.classifyGridCell_(makeCell('lockedGap')), CLASS.GENUINE_GAP);
  checkEqual('★ 完全冇紀錄嘅格 → MANUAL_PENDING（保守當作要人手填）',
    gas.classifyGridCell_(null), CLASS.MANUAL_PENDING);
}

console.log('\n=== A2【本輪核心】四類留空格子喺表上必須顯示唔同嘅文字 ===');
{
  const labels = {
    pending: gas.DEFAULTS.GRID_PENDING_LABEL,
    na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
    specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
    gap: gas.DEFAULTS.GRID_GAP_LABEL
  };
  const textOf = function (kind, emptyDisplay) {
    const cell = makeCell(kind);
    return gas.resolveGridCellText_(cell, gas.classifyGridCell_(cell), emptyDisplay, labels);
  };

  const preacherText = textOf('preacher', 'PENDING');
  const communionText = textOf('communion', 'PENDING');
  const specialText = textOf('specialSkip', 'PENDING');
  const gapText = textOf('gap', 'PENDING');

  console.log('      實際顯示：講員「' + preacherText + '」　聖餐襄禮「' + communionText
    + '」　特別主日「' + specialText + '」　排唔出「' + gapText + '」');

  check('★★ 講員（待人手填）同「排唔出」顯示唔同嘅文字',
    preacherText !== gapText,
    '呢個係本輪最重要嘅一項：兩類以前一模一樣，堂委分唔出「本來就要人手填」同「系統排唔到」');

  const allTexts = [preacherText, communionText, specialText, gapText];
  checkEqual('★★ 四類留空格子嘅文字兩兩唔同（黑白列印一樣分得出）',
    new Set(allTexts).size, 4);

  check('★ 四類文字都唔係空白（空白格等於冇解釋）',
    allTexts.every(function (t) { return String(t).trim().length > 0; }),
    '實際：' + JSON.stringify(allTexts));

  check('★ 已排定嘅格顯示人名本身', textOf('assigned', 'PENDING') === '陳大文');

  check('★ 「排唔出」嘅文字帶警示符號，掃一眼就見到',
    /[⚠!✖×]/.test(gapText), '實際：' + gapText);
}

console.log('\n=== A2：MANUAL_PENDING 仍然尊重 Posts.EmptyDisplay 逐崗位設定 ===');
{
  const labels = {
    pending: '（待填）', na: '—', specialSkip: '特殊主日', gap: '⚠ 未能安排'
  };
  const cell = makeCell('preacher');
  const cls = gas.classifyGridCell_(cell);
  checkEqual('★ EmptyDisplay=PENDING → 顯示待填文字',
    gas.resolveGridCellText_(cell, cls, 'PENDING', labels), '（待填）');
  checkEqual('★ EmptyDisplay=NA → 顯示不適用符號',
    gas.resolveGridCellText_(cell, cls, 'NA', labels), '—');
  checkEqual('★ EmptyDisplay=BLANK → 完全留白（有啲崗位幹事想佢乾淨）',
    gas.resolveGridCellText_(cell, cls, 'BLANK', labels), '');

  // 但「排唔出」嗰類唔受 EmptyDisplay 影響——唔可以俾人設定成隱形
  const gapCell = makeCell('gap');
  const gapCls = gas.classifyGridCell_(gapCell);
  checkEqual('★★ 「排唔出」唔受 EmptyDisplay=BLANK 影響，一定顯示得到',
    gas.resolveGridCellText_(gapCell, gapCls, 'BLANK', labels), '⚠ 未能安排');
}

console.log('\n=== 第十四輪批次階段 D【核心】SPECIAL_SKIP 格子優先顯示 ExternalOwner ===');
{
  const labels = {
    pending: '（待填）', na: '—', specialSkip: '特殊主日', gap: '⚠ 未能安排'
  };
  const cell = makeCell('specialSkip');
  const cls = gas.classifyGridCell_(cell);

  checkEqual('★★★★ 有填 ExternalOwner（例如「英語堂」）就直接顯示，唔再顯示通用嘅「特殊主日」',
    gas.resolveGridCellText_(cell, cls, 'PENDING', labels, '英語堂'), '英語堂');
  checkEqual('★★ 冇傳第 5 個參數（舊呼叫方式）退回通用文字，向下相容',
    gas.resolveGridCellText_(cell, cls, 'PENDING', labels), '特殊主日');
  checkEqual('★ ExternalOwner 係空字串照樣退回通用文字',
    gas.resolveGridCellText_(cell, cls, 'PENDING', labels, ''), '特殊主日');
  checkEqual('★ ExternalOwner 淨係空白字元都當冇填，退回通用文字',
    gas.resolveGridCellText_(cell, cls, 'PENDING', labels, '   '), '特殊主日');
  checkEqual('★ 非 SPECIAL_SKIP 嘅格唔受 ExternalOwner 影響（就算傳咗都唔會用到）',
    gas.resolveGridCellText_(makeCell('preacher'), gas.classifyGridCell_(makeCell('preacher')), 'PENDING', labels, '英語堂'),
    '（待填）');
}

console.log('\n=== 第十四輪批次階段 D：buildSpecialSundayExternalOwnerIndex_() ===');
{
  const S = gas.COLUMNS.SPECIAL_SUNDAYS;
  const fakeRows = [
    { [S.ACTIVE]: 'TRUE', [S.SERVICE_DATE]: '2026-10-04', [S.EXTERNAL_OWNER]: '英語堂' },
    { [S.ACTIVE]: 'TRUE', [S.SERVICE_DATE]: '2026-11-01', [S.EXTERNAL_OWNER]: '' }, // 冇填 ExternalOwner
    { [S.ACTIVE]: 'FALSE', [S.SERVICE_DATE]: '2026-12-06', [S.EXTERNAL_OWNER]: '華語堂' } // Active=FALSE 唔應該計入
  ];
  // 刻意唔載入 SheetReader.gs——嗰個檔案本身會宣告 readSpecialSundays()，
  // vm 沙箱入面 top-level function 宣告會蓋過呢度預先設低嘅 override，
  // 令假資料完全冧唔到用。改為連 isTrueValue_ 都一齊用 override 提供
  // （原始碼一樣簡單：value===true 或者 trim().toUpperCase()==='TRUE'）。
  const gas2 = loadGasSource(['Constants.gs', 'Utils.gs', 'RosterWriter.gs'], {
    readSpecialSundays: function () { return fakeRows; },
    isTrueValue_: function (value) {
      if (value === true) return true;
      return String(value).trim().toUpperCase() === 'TRUE';
    },
    toDateString: function (v) { return v; } // 呢個測試嘅日期已經係字串，唔需要真正轉換
  });
  const index = gas2.buildSpecialSundayExternalOwnerIndex_('2026T4', 'Pacific/Auckland');
  checkEqual('★★★ 有填 ExternalOwner 嘅 Active 主日會加入索引',
    index['2026-10-04'], '英語堂');
  check('★ 冇填 ExternalOwner 嘅主日唔會加入索引（呼叫端會退回通用文字，唔會顯示空字串）',
    !('2026-11-01' in index));
  check('★★ Active=FALSE 嘅行完全唔計入（同 buildSpecialSundayTitleIndex_() 一致嘅過濾規則）',
    !('2026-12-06' in index));
}

console.log('\n=== A2：圖例逐類都有，而且附上本季實際格數 ===');
{
  const layout = {
    classCounts: {
      ASSIGNED: 152, MANUAL_PENDING: 39, STRUCTURAL_NA: 10, SPECIAL_SKIP: 4, GENUINE_GAP: 0
    },
    labels: {
      pending: gas.DEFAULTS.GRID_PENDING_LABEL,
      na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
      specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
      gap: gas.DEFAULTS.GRID_GAP_LABEL
    }
  };
  const rows = gas.buildLegendRows_(layout);

  checkEqual('★ 圖例有五行（五種分類全部解釋，包括 0 格嗰啲）', rows.length, 5);
  check('★ 每行都有【標示／意思／格數】三欄',
    rows.every(function (r) { return r.length === 3 && String(r[1]).length > 0; }));

  const gapRow = rows.filter(function (r) { return r[0] === gas.DEFAULTS.GRID_GAP_LABEL; })[0];
  check('★★ 「未能安排：0 格」有明確寫出嚟（呢個數字本身就係系統嘅賣點）',
    gapRow && gapRow[2] === '0 格', gapRow ? JSON.stringify(gapRow) : '搵唔到嗰一行');

  const pendingRow = rows.filter(function (r) { return r[0] === gas.DEFAULTS.GRID_PENDING_LABEL; })[0];
  check('★★ 「待填：39 格」有寫出嚟，即刻解釋咗點解表上有咁多空位',
    pendingRow && pendingRow[2] === '39 格');
  check('★ 待填嗰行有講明係邊幾個崗位（講員／翻譯／獻花）',
    pendingRow && /講員/.test(pendingRow[1]) && /翻譯/.test(pendingRow[1]),
    pendingRow ? pendingRow[1] : '');
  check('★ 不適用嗰行有講明點解（聖餐襄禮只喺每月第一個主日）',
    rows.some(function (r) { return /第一個主日/.test(r[1]); }));

  console.log('      圖例內容：');
  rows.forEach(function (r) { console.log('        ' + r[0] + '｜' + r[1] + '｜' + r[2]); });
}

console.log('\n=== A3：特別主日要喺「類型」欄註明（對照現行人手職事表）===');
{
  checkEqual('★★ 有特別主日 → 「主日崇拜（浸禮）」',
    gas.describeServiceType_('主日崇拜', '浸禮'), '主日崇拜（浸禮）');
  checkEqual('★ 冇特別主日 → 照舊淨係顯示類型（行為不變）',
    gas.describeServiceType_('主日崇拜', ''), '主日崇拜');
  checkEqual('★ 類型空白但有特別主日 → 顯示特別主日名',
    gas.describeServiceType_('', '堂慶合堂'), '堂慶合堂');
  checkEqual('★ 特別主日名已包含類型時唔重複',
    gas.describeServiceType_('主日崇拜', '主日崇拜（宣教月）'), '主日崇拜（宣教月）');
  checkEqual('★ 兩者皆空 → 空字串', gas.describeServiceType_('', ''), '');
  checkEqual('★ null／undefined 唔會變成字面文字 "null"',
    gas.describeServiceType_(null, undefined), '');
}

console.log('\n=== 反證：證明修正前嘅做法真係分唔出（唔係測試寫嚟好睇）===');
{
  // 修正前嘅顯示邏輯：SKIPPED 就睇 isStructuralNotApplicable_ → naLabel，
  // 否則一律行 resolveEmptyDisplayText_()。「排唔出」同「講員」都落最後嗰個分支。
  const oldTextOf = function (cell, emptyDisplay) {
    if (gas.isStructuralNotApplicable_(cell)) return '—';
    if (gas.isSpecialSundaySkip_(cell)) return '特殊主日';
    return gas.resolveEmptyDisplayText_(emptyDisplay, '待確認', '—');
  };
  const oldPreacher = oldTextOf(makeCell('preacher'), 'PENDING');
  const oldGap = oldTextOf(makeCell('gap'), 'PENDING');

  checkEqual('★★ 反證：修正前兩類文字完全一樣（呢個就係本輪要解決嘅問題）',
    oldPreacher, oldGap);
  console.log('      修正前：講員「' + oldPreacher + '」＝ 排唔出「' + oldGap + '」——分唔出');
}

console.log('\n=== 一致性：分類統計同表面顯示唔可以各講各話 ===');
{
  // summariseBlankAssignments_() 而家直接呼叫 classifyGridCell_()，
  // 呢度用同一批假資料兩邊各算一次，確認數字對得返上。
  const assignments = [
    makeCell('assigned'), makeCell('assigned'),
    makeCell('preacher'), makeCell('preacher'), makeCell('preacher'),
    makeCell('communion'), makeCell('communion'),
    makeCell('specialSkip'),
    makeCell('gap'), makeCell('lockedGap')
  ];
  const summary = gas.summariseBlankAssignments_(assignments);

  const byClassifier = {};
  assignments.forEach(function (a) {
    const c = gas.classifyGridCell_(a);
    byClassifier[c] = (byClassifier[c] || 0) + 1;
  });

  checkEqual('★★ 待人手填：統計 vs 分類器一致',
    summary.manualPendingCount, byClassifier[CLASS.MANUAL_PENDING]);
  checkEqual('★★ 結構性不適用：統計 vs 分類器一致',
    summary.structuralNaCount, byClassifier[CLASS.STRUCTURAL_NA]);
  checkEqual('★★ 特別主日跳過：統計 vs 分類器一致',
    summary.specialSkipCount, byClassifier[CLASS.SPECIAL_SKIP]);
  checkEqual('★★ 排唔出：統計 vs 分類器一致',
    summary.genuineGapCount, byClassifier[CLASS.GENUINE_GAP]);
  checkEqual('★ 留空總數 = 全部格 − 已排定',
    summary.totalBlank, assignments.length - byClassifier[CLASS.ASSIGNED]);
  checkEqual('★ 排唔出嘅格有列出明細（幹事要逐格跟進）',
    summary.genuineGapCells.length, 2);
}

console.log('\n=== A4：版面可讀性——13 週要放得落一頁 A4 橫向 ===');
{
  // 真實規模：16 個崗位，其中司事／司數各 2 個位 → 18 個崗位欄。
  const REAL_SLOT_COLUMNS = 18;
  const est = gas.estimatePdfColumnWidth_(REAL_SLOT_COLUMNS);
  console.log('      ' + REAL_SLOT_COLUMNS + ' 個崗位欄 → 每欄約 '
    + est.estimatedInchesPerColumn + ' 吋（' + (est.estimatedInchesPerColumn * 25.4).toFixed(1) + ' mm）');

  check('★ 真實規模（18 個崗位欄）唔會被判定為過窄',
    !est.likelyCramped,
    '每欄 ' + est.estimatedInchesPerColumn + ' 吋，門檻 0.45 吋');

  // 三個中文字喺 10pt（Google Sheets 預設）大約需要 0.42 吋
  const THREE_CHAR_NAME_INCHES_AT_10PT = 3 * 10 / 72;
  check('★★ 三個字嘅中文姓名喺 10pt 之下放得落一欄（唔會逐個字斷行）',
    est.estimatedInchesPerColumn >= THREE_CHAR_NAME_INCHES_AT_10PT,
    '每欄 ' + est.estimatedInchesPerColumn + ' 吋 vs 三字姓名需要 '
      + THREE_CHAR_NAME_INCHES_AT_10PT.toFixed(2) + ' 吋');

  // 欄數再多就會開始出事，記低個臨界點供日後新增崗位時參考
  const cramped = gas.estimatePdfColumnWidth_(22);
  check('★ 22 個崗位欄會被判定為過窄（日後加崗位要留意呢個臨界點）',
    cramped.likelyCramped,
    '如果呢項失敗，代表門檻改咗，docs 入面嘅版面結論要重新核實');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
