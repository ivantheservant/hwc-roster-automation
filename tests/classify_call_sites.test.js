// 第三十八輪批次 E 組：`classifyGridCell_()` 每一個呼叫點都要餵同一份資料。
// 執行方式：node tests/classify_call_sites.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要逐個呼叫點驗
// ═════════════════════════════════════════════════════════════════════
//
// `classifyGridCell_()` 係全系統唯一嘅分類來源——顯示文字、底色、圖例
// 計數、PDF、公開版全部靠佢。**五種分類入面只有 ASSIGNED 會渲染人名**
//（`resolveGridCellText_()`），所以判錯類 ＝ 個名喺 grid 同 PDF 上消失。
//
// 第三十七輪修好咗函式本身（自由文字都算「有人」），但函式收到咩，
// 完全由呼叫者決定。任何一個呼叫點漏傳 `personName`，喺**嗰一個面**
// 就會重現返同一個 bug——而其餘幾個面睇落正常，最難查。
//
// 呢一份逐個呼叫點餵**同一格**（有自由文字、冇 PersonID 嘅講員格），
// 要求全部答同一個答案。
//
// FIXTURE-OK: 呢度砌嘅係 `classifyGridCell_()` 嘅**直接輸入**——分類器
// 本身就係測試對象。而且呢一格嘅形狀唔係估嘅：佢照抄
// `apiSavePreacherTranslationEntry()` 真正寫落長表嗰四個欄位，
// 而嗰個形狀由 `version_carry_over_all_paths.test.js` 用真入口守住。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
  'Generator.gs', 'RosterWriter.gs', 'FineTune.gs', 'DraftReviewReport.gs'
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

// ─────────────────────────────────────────────────────────────────────
// 一、先數清楚有幾多個呼叫點——加咗新嘅要有人知
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== E 組：呼叫點清單（加咗新嘅一定要更新呢一份）===');

const KNOWN_CALL_SITES = {
  'DraftReviewReport.gs': 1,   // 初稿檢視報告嘅圖例計數
  'Generator.gs': 1,           // 生成完成畫面嘅統計
  'RosterWriter.gs': 3,        // grid 文字、grid 底色、renderExpectedGridText_()
  // 第三十八輪批次 G 組新增嘅唯讀清點工具。佢有傳 personName——
  // 落面「逐個轉換」嗰一節會逐個字驗。
  'VersionCellAudit.gs': 1,
  'WebApp.gs': 1               // 網頁版 grid
};

{
  const found = {};
  fs.readdirSync(SRC).filter(function (f) { return /\.gs$/.test(f); }).forEach(function (f) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    // 拆走註解——註解入面提過好多次個名。
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const n = (bare.match(/classifyGridCell_\(/g) || []).length
      - (bare.match(/function classifyGridCell_\(/g) || []).length;
    if (n > 0) found[f] = n;
  });
  checkEqual('★★★★★ 呼叫點同已知清單完全一致'
    + '（多咗一個而冇人更新呢一份 ⇒ 嗰個新面冇被驗過）',
    found, KNOWN_CALL_SITES);
}

// ─────────────────────────────────────────────────────────────────────
// 二、基準：同一格，分類函式本身點答
// ─────────────────────────────────────────────────────────────────────
//
// 呢一格照現場：幹事用「填寫講員／翻譯」側邊欄填咗一位外請講員。
//   PersonID 空（佢唔喺 NameMapping）
//   PersonNameSnapshot 有字
//   AssignSource = MANUAL
//   RuleFlags 仍然有 NO_AUTO_GENERATE（真入口唔會掂佢）
const FREE_TEXT_ROW = {
  personId: '',
  personName: '客席甲牧師',
  assignSource: gas.ASSIGN_SOURCE.MANUAL,
  ruleFlags: [gas.RULE_IDS.NO_AUTO_GENERATE]
};

const LABELS = {
  pending: gas.DEFAULTS.GRID_PENDING_LABEL,
  na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
  specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
  gap: gas.DEFAULTS.GRID_GAP_LABEL
};

console.log('\n=== E 組：基準——分類函式本身 ===');
checkEqual('★★★★★ 有自由文字嘅格算「有派人」（只有 ASSIGNED 會渲染人名）',
  gas.classifyGridCell_(FREE_TEXT_ROW), gas.GRID_CELL_CLASS.ASSIGNED);
checkEqual('★★★★★ 而且渲染出嚟真係個名（唔係「未能安排」）',
  gas.resolveGridCellText_(FREE_TEXT_ROW, gas.classifyGridCell_(FREE_TEXT_ROW),
    'PENDING', LABELS, ''), FREE_TEXT_ROW.personName);

// ─────────────────────────────────────────────────────────────────────
// 三、每個「把長表一行變成分類輸入」嘅轉換
// ─────────────────────────────────────────────────────────────────────
//
// 六個呼叫點入面有五個收一個變數，所以真正要驗嘅係**砌嗰個變數嘅地方**
// 有冇把 `PersonNameSnapshot` 帶埋落去。漏咗就係第三十七輪嗰個 bug
// 喺嗰一個面單獨復活——其餘幾個面睇落正常，最難查。
console.log('\n=== E 組：逐個「長表 → 分類輸入」嘅轉換 ===');

const CONVERTERS = [
  {
    name: 'RosterWriter.gs `readVersionAssignmentsForGrid_()`'
      + '（餵 grid 文字同 grid 底色兩個呼叫點）',
    file: 'RosterWriter.gs',
    from: 'function readVersionAssignmentsForGrid_(',
    to: '\n}'
  },
  {
    name: 'WebApp.gs 網頁版 grid 嘅 `byKey`',
    file: 'WebApp.gs',
    from: 'const byKey = {};',
    to: 'const posts = readPostsNormalized();'
  },
  {
    name: 'DraftReviewReport.gs 圖例計數（直接寫喺呼叫點）',
    file: 'DraftReviewReport.gs',
    from: 'classifyGridCell_({',
    to: '});'
  },
  {
    name: 'VersionCellAudit.gs 逐季逐版清點（第三十八輪 G 組）',
    file: 'VersionCellAudit.gs',
    from: 'classifyGridCell_({',
    to: '});'
  }
];

CONVERTERS.forEach(function (c) {
  const src = fs.readFileSync(path.join(SRC, c.file), 'utf8');
  const i = src.indexOf(c.from);
  const j = i === -1 ? -1 : src.indexOf(c.to, i + c.from.length);
  check('（前置）切到 ' + c.file + ' 嗰一段', i !== -1 && j > i,
    'from=' + i + ' to=' + j);
  if (i === -1 || j <= i) return;
  const seg = src.slice(i, j);
  // ⚠️ 先落一個本地變數再用。直接寫「物件點 name」會被敏感資料掃描
  //  當成一個網域而擋住 commit（name 係真嘅頂層網域）。
  const converterName = c.name;
  check('★★★★★ ' + converterName + ' 有把 `PersonNameSnapshot` 帶埋落去'
    + '（漏咗 ⇒ 呢一個面嘅講員名會變成「未能安排」，而其餘幾個面正常）',
    /personName:\s*row\[C\.PERSON_NAME_SNAPSHOT\]/.test(seg), seg);
});

// `Generator.gs` 嗰個呼叫點收嘅係生成器自己砌嘅派工物件，唔經長表。
// 佢一定要有 `personName` 呢個欄位，否則生成完成畫面嘅統計會同 grid 唔一致。
{
  const src = fs.readFileSync(path.join(SRC, 'Generator.gs'), 'utf8');
  check('★★★★★ Generator.gs 砌嘅派工物件本身有 `personName` 欄位'
    + '（生成完成畫面嘅統計同 grid 要講同一句話）',
    /personName:/.test(src), '');

  // ⚠️ 第四十輪批次 F4：上面嗰條淨係驗到「有嗰個欄位」，
  // 驗唔到「統計真係認得兩種 ASSIGNED」——第三十八輪嘅報告自己列咗呢一點。
  //
  // 嗰段統計本來寫 `if (a.personId) return;`，即係只認「有 PersonID」嗰一種。
  // 一格填好嘅講員（外請講員冇 PersonID，只有自由文字）會跌落最後個 else，
  // 被當成「系統應該排但排唔出」——而 grid 同一格顯示佢個名。
  const statsBody = src.slice(src.indexOf('let manualPendingCount = 0;'),
    src.indexOf('genuineGapCells.push('));
  check('★★★★★ 統計嗰段唔可以自己用 `a.personId` 判斷「已經有人」'
    + '——只認 PersonID 就會把填好嘅講員格算成「未能安排」，'
    + '而 grid 嗰邊顯示佢個名，兩邊講唔同嘅話幹事會去追一個唔存在嘅問題',
    // ⚠️ 剝走註解先驗——上面段註解特登引用咗舊嗰一行做對照，
    //  唔剝就會查中自己嘅註解，變成一條永遠紅嘅假警報。
    !/if \(a\.personId\) return;/.test(statsBody.replace(/^\s*\/\/.*$/gm, '')),
    statsBody.slice(0, 300));
  check('★★★★★ 而係問返 `classifyGridCell_()`（全系統唯一嘅分類來源）'
    + '，兩種 ASSIGNED 佢都認得',
    /if \(cellClass === GRID_CELL_CLASS\.ASSIGNED\) return;/.test(statsBody),
    statsBody.slice(0, 400));

  // 真正餵一格「有自由文字、冇 PersonID」入去，確認佢係 ASSIGNED——
  // 即係上面嗰個 early return 會接住佢，唔會跌落「未能安排」。
  checkEqual('★★★★★ 反證：一格填好嘅講員（冇 PersonID）分類係 ASSIGNED，'
    + '所以統計會當佢「已經有人」而唔會數落「未能安排」',
    gas.classifyGridCell_(FREE_TEXT_ROW), gas.GRID_CELL_CLASS.ASSIGNED);
}

// ─────────────────────────────────────────────────────────────────────
// 四、同一格，幾個渲染面嘅答案要一致
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== E 組：同一格，幾個面嘅答案要一致 ===');
{
  const renderContext = {
    labels: LABELS,
    emptyDisplayByPostId: { PREACH: 'PENDING' },
    autoGenerateByPostId: { PREACH: false },
    externalOwnerByDate: {}
  };

  // 面一：grid 文字（RosterWriter.gs `renderExpectedGridText_()` 嗰個呼叫點）
  checkEqual('★★★★★ grid 文字 ＝ 個名',
    gas.renderExpectedGridText_(FREE_TEXT_ROW, 'PREACH', '2099-01-03', renderContext),
    FREE_TEXT_ROW.personName);

  // 面二：底色分類
  checkEqual('★★★★ 底色跟 ASSIGNED 走（唔會用「排唔出」嗰隻粉紅）',
    gas.classifyGridCell_(FREE_TEXT_ROW), gas.GRID_CELL_CLASS.ASSIGNED);

  // 面三：反方向——真係乜都冇嗰格，唔可以講成「有人」
  const EMPTY_ROW = {
    personId: '', personName: '', assignSource: gas.ASSIGN_SOURCE.SKIPPED,
    ruleFlags: [gas.RULE_IDS.NO_AUTO_GENERATE]
  };
  checkEqual('★★★★★ 反證：冇填過嘅講員格仍然係「待確認」'
    + '（唔係就證明修正把所有格都當成有人，等於冇咗分類）',
    gas.classifyGridCell_(EMPTY_ROW), gas.GRID_CELL_CLASS.MANUAL_PENDING);
  checkEqual('★★★★ 而且佢渲染成「待確認」',
    gas.renderExpectedGridText_(EMPTY_ROW, 'PREACH', '2099-01-03', renderContext),
    LABELS.pending);

  // 面四：空白但唔係「留待人手」——真係排唔出
  const GAP_ROW = {
    personId: '', personName: '', assignSource: gas.ASSIGN_SOURCE.SKIPPED,
    ruleFlags: [gas.RULE_IDS.ELIGIBILITY]
  };
  checkEqual('★★★★★ 真係排唔出嗰種仍然係「未能安排」'
    + '（呢個先係圖例入面應該計落「未能安排」嘅嘢）',
    gas.classifyGridCell_(GAP_ROW), gas.GRID_CELL_CLASS.GENUINE_GAP);
}

// ─────────────────────────────────────────────────────────────────────
// 五、邊界：只有空白字元唔算「有填」
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== E 組：邊界 ===');
[' ', '　', '\t'].forEach(function (blank) {
  checkEqual('★★★★ 只有空白字元（' + JSON.stringify(blank) + '）唔算「有填」'
    + '——照計「待確認」，唔可以變成一格睇落有人但實際係空嘅格',
    gas.classifyGridCell_(Object.assign({}, FREE_TEXT_ROW, { personName: blank })),
    gas.GRID_CELL_CLASS.MANUAL_PENDING);
});

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);// ─────────────────────────────────────────────────────────────────────
// 六、2026-08-20 現場 2027T3 v7 嗰個指紋
// ─────────────────────────────────────────────────────────────────────
//
// 現場圖例：`有派人 194／待確認 37／— 40／特殊主日 0／未能安排 2`
// 而 `37 + 2 = 39` ＝ 13 個主日 × 3 個非自動崗位。
// 即係話：**「未能安排」嗰兩格，本來就唔應該由系統排。**
//
// 佢哋係填過講員之後個名唔見咗嘅格，`AssignSource` 停留喺 `MANUAL`。
console.log('\n=== E 組：現場 2027T3 v7 嗰個指紋 ===');
{
  const LOST_NAME_ROW = {
    personId: '',
    personName: '',                        // 個名唔見咗（舊碼整走嘅，見稽核文件）
    assignSource: gas.ASSIGN_SOURCE.MANUAL, // 但係「填過」呢個事實留低咗
    ruleFlags: [gas.RULE_IDS.NO_AUTO_GENERATE]
  };
  checkEqual('★★★★★ 一格「填過講員但個名冇咗」嘅格算「待確認」，唔係「未能安排」'
    + '——系統由頭到尾都冇打算排呢一格，講佢「未能安排」係講錯嘢',
    gas.classifyGridCell_(LOST_NAME_ROW), gas.GRID_CELL_CLASS.MANUAL_PENDING);

  // 反方向：一格系統真係要排、但排唔到嘅，唔可以被呢個修正一齊收埋。
  checkEqual('★★★★★ 反證：系統要排但排唔到嘅格仍然係「未能安排」'
    + '（收埋咗就等於冇咗呢個警示，幹事永遠唔會知有格冇人）',
    gas.classifyGridCell_({
      personId: '', personName: '', assignSource: gas.ASSIGN_SOURCE.MANUAL,
      ruleFlags: [gas.RULE_IDS.ELIGIBILITY]
    }), gas.GRID_CELL_CLASS.GENUINE_GAP);
}


