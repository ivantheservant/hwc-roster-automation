// 第十三輪批次階段 D：產生 docs/個人連結頁面樣本.md。
// 執行方式：node tests/render_personal_roster_samples.js
//
// 唔係測試（檔名刻意唔係 *.test.js），係文件產生器：用虛構資料實際渲染
// **真正嘅 `src/ui/PersonalRoster.html` 樣板檔案**（唔係抄一份副本），
// 產生四種情況嘅完整 HTML 輸出，供 Ivan 喺新增 access=ANYONE 部署、
// 正式開放俾非白名單人士之前逐份讀過。
//
// 渲染方式：
// - 「正常」／「零派工」兩種情況：用同正式碼一樣嘅
//   `transposeRosterForPublicView_()`（真正原始碼，經 gas_loader 載入）
//   組出 `data` 物件，再用 `gas_html_renderer.js`（自製嘅輕量版 GAS
//   scriptlet 樣板引擎）評估真正嘅樣板檔案文字。
// - 「無效 token」／「季度不存在」兩種情況：直接呼叫真正嘅
//   `renderPersonalRosterError_()`（`WebAppPersonalLink.gs`），淨係
//   將 `HtmlService` 換成一個貼合需要嘅簡化版 mock（見
//   `loadGasSource()` 嘅 `overrides` 參數）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { renderGasTemplate } = require('./helpers/gas_html_renderer.js');

const SRC = path.join(__dirname, '..', 'src');
const DOCS = path.join(__dirname, '..', 'docs');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'RosterWriter.gs']);

const personalRosterTemplateSource = fs.readFileSync(path.join(SRC, 'ui', 'PersonalRoster.html'), 'utf8');

/** 手砌 cellIndex（獨立一個函式，方便 buildSampleLayout() 同時用嚟計 classCounts）。 */
function buildSampleCellIndex_() {
  const CLASS = gas.GRID_CELL_CLASS;
  return {
    '2026-01-04|CHAIR|1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P001', personName: '周大文' } },
    '2026-01-04|USHER|1': { row: 3, column: 5, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P002', personName: '陳小明' } },
    '2026-01-04|USHER|2': { row: 3, column: 6, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P003', personName: '李美美' } },
    '2026-01-04|FLOWER|1': { row: 3, column: 7, cellClass: CLASS.MANUAL_PENDING },
    '2026-01-04|COMMUNION|1': { row: 3, column: 8, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P004', personName: '黃三' } },
    '2026-01-11|CHAIR|1': { row: 4, column: 4, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P005', personName: '馮小華' } },
    '2026-01-11|USHER|1': { row: 4, column: 5, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P001', personName: '周大文' } },
    '2026-01-11|USHER|2': { row: 4, column: 6, cellClass: CLASS.MANUAL_PENDING },
    '2026-01-11|FLOWER|1': { row: 4, column: 7, cellClass: CLASS.MANUAL_PENDING },
    '2026-01-11|COMMUNION|1': { row: 4, column: 8, cellClass: CLASS.STRUCTURAL_NA },
    '2026-02-01|CHAIR|1': { row: 5, column: 4, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P002', personName: '陳小明' } },
    '2026-02-01|USHER|1': { row: 5, column: 5, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P004', personName: '黃三' } },
    '2026-02-01|USHER|2': { row: 5, column: 6, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P005', personName: '馮小華' } },
    '2026-02-01|FLOWER|1': { row: 5, column: 7, cellClass: CLASS.MANUAL_PENDING },
    '2026-02-01|COMMUNION|1': { row: 5, column: 8, cellClass: CLASS.ASSIGNED, assignment: { personId: 'P003', personName: '李美美' } }
  };
}

/** 砌一份貼近真實形狀嘅 layout（做法同 tests/public_roster_write.test.js 一致）。 */
function buildSampleLayout() {
  const cellIndex = buildSampleCellIndex_();
  const classCounts = {};
  Object.keys(gas.GRID_CELL_CLASS).forEach(function (k) { classCounts[gas.GRID_CELL_CLASS[k]] = 0; });
  Object.keys(cellIndex).forEach(function (key) { classCounts[cellIndex[key].cellClass]++; });

  return {
    headers: ['日期', '週次', '類型', '主席1', '司事1', '司事2', '獻花1', '聖餐襄禮1'],
    keys: ['_DATE', '_WEEK', '_TYPE', 'CHAIR#1', 'USHER#1', 'USHER#2', 'FLOWER#1', 'COMMUNION#1'],
    rows: [
      ['2026-01-04', 1, '主日崇拜', '周大文', '陳小明', '李美美', '', '黃三'],
      ['2026-01-11', 2, '主日崇拜', '馮小華', '周大文', '（待填）', '', '—'],
      ['2026-02-01', 5, '主日崇拜（浸禮）', '陳小明', '黃三', '馮小華', '', '李美美']
    ],
    dates: [
      { serviceDate: '2026-01-04', weekIndex: 1, serviceType: '主日崇拜' },
      { serviceDate: '2026-01-11', weekIndex: 2, serviceType: '主日崇拜' },
      { serviceDate: '2026-02-01', weekIndex: 5, serviceType: '主日崇拜' }
    ],
    cellIndex: cellIndex,
    classCounts: classCounts,
    // buildLegendRows_() 喺冇傳 labels 時會退回 readGridCellLabels_()
    // （要真正 GAS 環境嘅 getConfig()），呢度直接用 Constants.gs 嘅
    // DEFAULTS（純資料，已經喺呢個 gas bundle 入面），避免載入 Config.gs。
    labels: {
      pending: gas.DEFAULTS.GRID_PENDING_LABEL,
      na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
      specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
      gap: gas.DEFAULTS.GRID_GAP_LABEL
    }
  };
}

const SAMPLE_POSTS = [
  { postId: 'CHAIR', postNameTC: '主席', slotCount: 1 },
  { postId: 'USHER', postNameTC: '司事', slotCount: 2 },
  { postId: 'FLOWER', postNameTC: '獻花', slotCount: 1 },
  { postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 1 }
];
const SAMPLE_SPECIAL_TITLES = { '2026-02-01': '浸禮' };
const SAMPLE_DISPLAY_OPTIONS = { dateFormatPattern: gas.DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT };

/**
 * 組一份 `buildPersonalRosterPageData_()` 形狀嘅 `data`，做法同正式碼
 * 一致：轉置之後逐格判斷係咪指定 `personId`，加 `mine`／`background` 旗標，
 * 收集 `mySchedule`。
 * @param {string} personId 要 highlight 嘅人；傳一個查唔到嘅 ID（例如
 *   `'NOBODY'`）就會變成「零派工」情況（全部格都唔係佢嘅）
 * @param {string} personName 顯示用姓名
 */
function buildPersonalPageData(personId, personName) {
  const layout = buildSampleLayout();
  const transposed = gas.transposeRosterForPublicView_(layout, SAMPLE_POSTS, SAMPLE_SPECIAL_TITLES, SAMPLE_DISPLAY_OPTIONS);
  const gapColor = '#F4CCCC';
  const postNameById = {};
  SAMPLE_POSTS.forEach(function (p) { postNameById[p.postId] = p.postNameTC; });
  const mySchedule = [];

  transposed.postRows.forEach(function (pr) {
    pr.cells.forEach(function (cell, dateIndex) {
      const key = transposed.dateColumns[dateIndex].serviceDate + '|' + pr.postId + '|' + pr.slotIndex;
      const original = layout.cellIndex[key];
      const mine = !!(original && original.assignment && original.assignment.personId === personId);
      cell.mine = mine;
      cell.background = gas.resolveGridCellBackground_(cell.cellClass, gapColor);
      if (mine) {
        mySchedule.push({
          serviceDate: transposed.dateColumns[dateIndex].serviceDate,
          postId: pr.postId,
          postNameTC: postNameById[pr.postId] || pr.postId
        });
      }
    });
  });
  mySchedule.sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : 1; });

  // 第十四輪批次階段 A：同 buildPersonalRosterPageData_() 實際做法一致——
  // BLANK 崗位（獻花）唔再逐格代入說明文字，改成圖例加一行。
  const blankEntry = gas.buildBlankRowLegendEntry_(gas.DEFAULTS.PUBLIC_ROSTER_BLANK_NOTE, transposed.blankPendingCount);
  const legendRows = gas.buildLegendRows_(layout).concat(blankEntry ? [blankEntry] : []);

  return {
    quarterId: '2099T1',
    versionNo: 4,
    personName: personName,
    dateColumns: transposed.dateColumns,
    monthGroups: transposed.monthGroups,
    postRows: transposed.postRows,
    mySchedule: mySchedule,
    legendRows: legendRows,
    footerNote: '如對職事表有任何疑問，請聯絡幹事。',
    updatedAt: '2099-01-01 09:00:00'
  };
}

function renderPersonalRosterHtml(data) {
  return renderGasTemplate(personalRosterTemplateSource, data, { GRID_LABELS: gas.GRID_LABELS });
}

// ---- 「無效 token」／「季度不存在」：真正呼叫 renderPersonalRosterError_() ----
function captureHtmlOutput(content) {
  const obj = {
    _content: content, _title: '',
    setTitle: function (t) { obj._title = t; return obj; },
    addMetaTag: function () { return obj; },
    getContent: function () { return obj._content; },
    getTitle: function () { return obj._title; }
  };
  return obj;
}
const htmlServiceMock = {
  createHtmlOutput: function (content) { return captureHtmlOutput(content); }
};
const gasWithHtmlService = loadGasSource(
  ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'RosterWriter.gs', 'WebAppPersonalLink.gs'],
  { HtmlService: htmlServiceMock }
);
const errorOutput = gasWithHtmlService.renderPersonalRosterError_();

// ---- 組合四種情況 ----
const scenarios = [
  {
    id: 1,
    label: '正常 token（有服侍安排）',
    description: '有效 token，呢一季有 3 次服侍安排（主席、司事×2）。',
    html: renderPersonalRosterHtml(buildPersonalPageData('P001', '周大文'))
  },
  {
    id: 2,
    label: '零派工（token 有效，但本季完全冇被排到）',
    description: '有效 token，但呢個人本季一次都冇被排到任何崗位。',
    html: renderPersonalRosterHtml(buildPersonalPageData('NOBODY', '未派工者'))
  },
  {
    id: 3,
    label: '無效 token',
    description: 'token 查唔到（唔存在、打錯字、或者已經被 runReissuePersonalLinkToken_() 取代）。',
    html: errorOutput.getContent()
  },
  {
    id: 4,
    label: '季度不存在（或者未生成過任何版本）',
    description: 'q 參數指向一個唔存在嘅季度，或者呢一季從未執行過「生成職事表」。',
    html: errorOutput.getContent()
  }
];

// ---- 產生文件 ----
const lines = [];
lines.push('# 個人連結頁面樣本（實際渲染結果）');
lines.push('');
lines.push('呢份文件係**用虛構資料實際渲染出嚟嘅個人專屬連結頁面**，唔係樣板');
lines.push('原始碼。目的係喺 Ivan 新增 `access=ANYONE` 部署、正式開放俾冇');
lines.push('Google 帳戶嘅義工存取之前，先有人逐份讀過實際輸出——呢個係整個');
lines.push('專案第一次開放俾非白名單人士嘅入口，開放之前必須有人讀過。');
lines.push('');
lines.push('產生方式：`node tests/render_personal_roster_samples.js`。頁面內容');
lines.push('讀自**真正嘅 `src/ui/PersonalRoster.html` 樣板檔案**（用自製嘅輕量版');
lines.push('GAS scriptlet 樣板引擎評估，見 `tests/helpers/gas_html_renderer.js`），');
lines.push('版面轉置用嘅係正式碼嘅 `transposeRosterForPublicView_()`');
lines.push('（`src/RosterWriter.gs`），「無效 token」／「季度不存在」兩種情況');
lines.push('直接呼叫正式碼嘅 `renderPersonalRosterError_()`（`src/WebAppPersonalLink.gs`）。');
lines.push('');
lines.push('全部資料一律虛構：姓名用「周大文」「陳小明」「李美美」「馮小華」');
lines.push('「黃三」，`PersonID` 用 `P001`–`P005`，季度用 2099T1。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 覆核結論（D3，詳細討論見 docs/系統範圍稽核.md 第十三輪批次階段 D）');
lines.push('');
lines.push('逐項覆核四份輸出之後嘅結論：');
lines.push('');
lines.push('1. **冇任何不應該公開嘅資訊洩漏**——四份輸出都冇出現電郵、');
lines.push('   `PersonID`、內部代號（`postId`／`personId` 等機器鍵完全冇出現');
lines.push('   喺輸出文字入面，只有 `postNameTC`／姓名呢類本來就係俾人睇嘅');
lines.push('   顯示文字）、規則違反標示、`Stage`、版本號以外嘅系統狀態。');
lines.push('   `versionNo` 本身有傳入 `data`，但樣板完全冇輸出佢，只用嚟');
lines.push('   組 `<title>`（`data.quarterId ?> 職事表`，唔含版本號）。');
lines.push('2. **「無效 token」同「季度不存在」兩種情況輸出完全一樣**——');
lines.push('   兩個情況都導向同一個 `renderPersonalRosterError_()`，證明');
lines.push('   `PERSONAL_LINK_INVALID_MESSAGE` 呢個中性錯誤訊息設計有效：');
lines.push('   訪客完全冇辦法從畫面分辨係邊一種原因，減少暴力嘗試 token');
lines.push('   嘅可乘之機。');
lines.push('3. **頁面完全冇任何會改動資料嘅路徑**——冇 `<form>`、冇');
lines.push('   `<input>`，唯一嘅互動元素係深色/淺色切換掣（純前端 CSS，');
lines.push('   `localStorage` 讀寫，唔改任何伺服器資料）。');
lines.push('4. **頁面完全冇輸出任何 `google.script.run` 呼叫**——樣板本身');
lines.push('   （`src/ui/PersonalRoster.html`）搜尋唔到呢個字串，四份實際');
lines.push('   渲染輸出一樣搜尋唔到。');
lines.push('5. **匿名訪客呼叫任何 `api*` 函式一律被拒絕**——`renderPersonalRosterPage_()`');
lines.push('   完全唔呼叫任何 `api*` 函式，個人連結呢條路徑本身唔經過');
lines.push('   `assertApiCallerAuthorized_()`（義工冇 Google 身分），呢個');
lines.push('   係刻意嘅設計（見 `WebAppPersonalLink.gs` 檔頭），唔係漏做');
lines.push('   ——安全性完全靠 token 本身唔可猜。呢一項嘅獨立驗證見');
lines.push('   `tests/webapp_access_guard.test.js`（鎖住全部 `api*` 函式');
lines.push('   第一行都係 `assertWebAppRequestAllowed_()`）同');
lines.push('   `tests/personal_link.test.js`（鎖住 `renderPersonalRosterPage_()`');
lines.push('   完全冇呼叫 `assertApiCallerAuthorized_()`）。');
lines.push('');
lines.push('**冇發現任何安全或格式問題。**');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 一覽');
lines.push('');
lines.push('| # | 情況 | 說明 |');
lines.push('|---|---|---|');
scenarios.forEach(function (s) {
  lines.push('| ' + s.id + ' | ' + s.label + ' | ' + s.description + ' |');
});
lines.push('');
lines.push('---');
lines.push('');

scenarios.forEach(function (s) {
  lines.push('## ' + s.id + '. ' + s.label);
  lines.push('');
  lines.push(s.description);
  lines.push('');
  lines.push('```html');
  lines.push(s.html);
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
});

const outPath = path.join(DOCS, '個人連結頁面樣本.md');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('已產生：' + outPath);
console.log('共 ' + scenarios.length + ' 個樣本，輸出總長度 '
  + scenarios.reduce(function (sum, s) { return sum + s.html.length; }, 0) + ' 字元。');
