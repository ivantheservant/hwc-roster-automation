// 第十三輪批次階段 C：`writePublicRosterContent_()` 嘅**行為測試**（唔係
// 靜態字串檢查）——用 `tests/helpers/sheet_mock.js` 模擬一個真正會執行
// merge／setFrozenRows／setFrozenColumns／deleteColumns 等方法、並且會
// 準確重現 Google 試算表幾個結構性限制嘅假工作表，令呢個函式可以喺 Node
// 環境**真正執行**，唔再只係「原始碼有冇出現某個函式名」。
//
// 對應 docs/系統範圍稽核.md 第十三輪批次「測試策略檢討」一節嘅結論：
// 第十二輪批次 38 個測試檔全部 PASS，但真實試算表連續兩次發佈都拋錯，
// 因為之前完全冇測試真正執行過呢個函式。呢個檔案係對呢個盲點嘅直接回應，
// 逐一對應 A1／A2／A3／A5 四個實測發現嘅 bug（A4／A6 嘅回歸測試喺
// tests/public_roster.test.js，因為嗰兩個係純函式層面就測得到）。
//
// 執行方式：node tests/public_roster_write.test.js

const { loadGasSource } = require('./helpers/gas_loader.js');
const { MockSpreadsheet } = require('./helpers/sheet_mock.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'RosterWriter.gs', 'PublicRoster.gs']);

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

/**
 * 砌一份 `buildPublicRosterContent_()` 形狀嘅內容——用真正嘅
 * `transposeRosterForPublicView_()` 轉置（唔係手砌轉置後嘅結果），
 * 貼近實際會由 `buildPublicRosterContent_()` 產生嘅樣。刻意涵蓋 A7
 * 要求嘅全部元素：標題、跨月份、特別主日、多 slot 崗位、BLANK 崗位、
 * 圖例、footer 備註。
 */
function buildSampleContent(quarterId, versionNo) {
  const CLASS = gas.GRID_CELL_CLASS;
  const layout = {
    headers: ['日期', '週次', '類型', '主席1', '司事1', '司事2', '獻花1', '聖餐襄禮1'],
    keys: ['_DATE', '_WEEK', '_TYPE', 'CHAIR#1', 'USHER#1', 'USHER#2', 'FLOWER#1', 'COMMUNION#1'],
    rows: [
      ['2026-01-04', 1, '主日崇拜', '陳大文', '李小明', '王美美', '', '張三'],
      ['2026-02-01', 5, '主日崇拜（浸禮）', '周小華', '（待填）', '黃小強', '', '—']
    ],
    dates: [
      { serviceDate: '2026-01-04', weekIndex: 1, serviceType: '主日崇拜' },
      { serviceDate: '2026-02-01', weekIndex: 5, serviceType: '主日崇拜' }
    ],
    cellIndex: {
      '2026-01-04|CHAIR|1': { row: 3, column: 4, cellClass: CLASS.ASSIGNED },
      '2026-01-04|USHER|1': { row: 3, column: 5, cellClass: CLASS.ASSIGNED },
      '2026-01-04|USHER|2': { row: 3, column: 6, cellClass: CLASS.ASSIGNED },
      '2026-01-04|FLOWER|1': { row: 3, column: 7, cellClass: CLASS.MANUAL_PENDING },
      '2026-01-04|COMMUNION|1': { row: 3, column: 8, cellClass: CLASS.ASSIGNED },
      '2026-02-01|CHAIR|1': { row: 4, column: 4, cellClass: CLASS.ASSIGNED },
      '2026-02-01|USHER|1': { row: 4, column: 5, cellClass: CLASS.MANUAL_PENDING },
      '2026-02-01|USHER|2': { row: 4, column: 6, cellClass: CLASS.ASSIGNED },
      '2026-02-01|FLOWER|1': { row: 4, column: 7, cellClass: CLASS.MANUAL_PENDING },
      '2026-02-01|COMMUNION|1': { row: 4, column: 8, cellClass: CLASS.STRUCTURAL_NA }
    }
  };
  const posts = [
    { postId: 'CHAIR', postNameTC: '主席', slotCount: 1 },
    { postId: 'USHER', postNameTC: '司事', slotCount: 2 },
    { postId: 'FLOWER', postNameTC: '獻花', slotCount: 1 },
    { postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 1 }
  ];
  const specialTitleByDate = { '2026-02-01': '浸禮' };
  const displayOptions = { dateFormatPattern: gas.DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT };
  const transposed = gas.transposeRosterForPublicView_(layout, posts, specialTitleByDate, displayOptions);

  // 第十四輪批次階段 A：BLANK 崗位（獻花）唔再逐格代入說明文字，改成圖例
  // 加一行——呢度用真正嘅 buildBlankRowLegendEntry_() 組第三行，貼近
  // buildPublicRosterContent_() 實際嘅做法。
  const blankEntry = gas.buildBlankRowLegendEntry_(gas.DEFAULTS.PUBLIC_ROSTER_BLANK_NOTE, transposed.blankPendingCount);

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    dateColumns: transposed.dateColumns,
    monthGroups: transposed.monthGroups,
    postRows: transposed.postRows,
    gapColor: '#F4CCCC',
    legendRows: [
      ['（姓名）', '系統自動安排，已排定人選', '3 格'],
      ['（待填）', '此崗位不由系統自動安排', '1 格'],
      blankEntry
    ],
    footerNote: '如有查詢請聯絡幹事。',
    updatedAt: '2099-01-01 12:00:00'
  };
}

console.log('\n=== A7【核心】首次發佈：逐格核對最終輸出（唔淨係「冇拋錯」）===');
{
  const spreadsheet = new MockSpreadsheet();
  const content = buildSampleContent('2099T1', 3);
  gas.writePublicRosterContent_(spreadsheet, content);
  const sheet = spreadsheet.getSheets()[0];

  checkEqual('★ 分頁名稱', sheet.getName(), gas.GRID_LABELS.FULL_VERSION);
  checkEqual('★★ A1 標題（季度＋更新時間）', sheet.getRange(1, 1, 1, 1).getValue(),
    '2099T1 職事表　更新時間：2099-01-01 12:00:00');
  checkEqual('★ B1 起完全冇內容（標題行冇合併，但都冇多餘內容）', sheet.getRange(1, 2, 1, 1).getValue(), '');

  checkEqual('★★ A2「崗位」標題', sheet.getRange(2, 1, 1, 1).getValue(), gas.GRID_LABELS.POST_COLUMN);
  checkEqual('★★ B2 月份分組「1月」', sheet.getRange(2, 2, 1, 1).getValue(), '1月');
  checkEqual('★★ C2 月份分組「2月」（第二個日期屬於 2 月）', sheet.getRange(2, 3, 1, 1).getValue(), '2月');

  checkEqual('★★★ B3 日期標籤（第十三輪批次階段 A4 修正後，帶「月」「日」，唔係浮點數）',
    sheet.getRange(3, 2, 1, 1).getValue(), '1月4日');
  checkEqual('★★★ C3 日期標籤有特別主日名稱（浸禮，第二行）',
    sheet.getRange(3, 3, 1, 1).getValue(), '2月1日\n浸禮');

  checkEqual('★★ A4 崗位名稱「主席」', sheet.getRange(4, 1, 1, 1).getValue(), '主席');
  checkEqual('★ B4／C4 主席逐日文字', [sheet.getRange(4, 2, 1, 1).getValue(), sheet.getRange(4, 3, 1, 1).getValue()],
    ['陳大文', '周小華']);

  checkEqual('★★ A5 司事 slot1（isFirstSlot）顯示崗位名稱', sheet.getRange(5, 1, 1, 1).getValue(), '司事');
  checkEqual('★★ A6 司事 slot2 唔重複顯示崗位名稱（垂直合併嘅第二格）', sheet.getRange(6, 1, 1, 1).getValue(), '');
  checkEqual('★ B5／B6 司事逐日文字（slot1＝李小明／（待填），slot2＝王美美／黃小強）',
    [sheet.getRange(5, 2, 1, 1).getValue(), sheet.getRange(6, 2, 1, 1).getValue()],
    ['李小明', '王美美']);
  checkEqual('★ C5（待填）', sheet.getRange(5, 3, 1, 1).getValue(), '（待填）');

  checkEqual('★★★ A7「獻花」列＋B7 完全留空（第十四輪批次階段 A 修正：唔再逐格'
    + '代入說明文字，改成圖例加一行，見下面圖例第 3 行嘅斷言）',
    [sheet.getRange(7, 1, 1, 1).getValue(), sheet.getRange(7, 2, 1, 1).getValue()],
    ['獻花', '']);

  checkEqual('★ A8「聖餐襄禮」＋非首主日顯示「—」', [sheet.getRange(8, 1, 1, 1).getValue(), sheet.getRange(8, 3, 1, 1).getValue()],
    ['聖餐襄禮', '—']);

  // 資料列：dataStartRow=4，postRows.length=5（主席1＋司事2＋獻花1＋聖餐襄禮1）
  // → 佔第 4-8 行。legendTitleRow = 4+5+1 = 10，legendDataRow = 11，
  // footerRow = 11 + legendRows.length(3，第十四輪批次新增「（空白）」一行) = 14。
  checkEqual('★ 圖例標題排喺資料列之後', sheet.getRange(10, 1, 1, 1).getValue(), gas.GRID_LABELS.LEGEND_TITLE);
  checkEqual('★ 圖例內容第一行', sheet.getRange(11, 1, 1, 3).getValues()[0],
    ['（姓名）', '系統自動安排，已排定人選', '3 格']);
  checkEqual('★★★ 圖例第 3 行「（空白）」解釋獻花兩格留空嘅原因（第十四輪批次階段 A 新增）',
    sheet.getRange(13, 1, 1, 3).getValues()[0],
    ['（空白）', gas.DEFAULTS.PUBLIC_ROSTER_BLANK_NOTE, '2 格']);
  checkEqual('★ footer 備註排喺圖例之後', sheet.getRange(14, 1, 1, 1).getValue(), '如有查詢請聯絡幹事。');

  check('★★ 凍結首欄', sheet.getFrozenColumns() === 1);
  check('★★ 凍結首 3 行', sheet.getFrozenRows() === 3);
  check('★★★ 日期欄（第 2、3 欄）欄闊都係 PUBLIC_ROSTER_DATE_COLUMN_WIDTH（A3 修正：欄闊真正套用咗）',
    sheet.getColumnWidth(2) === gas.PUBLIC_ROSTER_DATE_COLUMN_WIDTH
      && sheet.getColumnWidth(3) === gas.PUBLIC_ROSTER_DATE_COLUMN_WIDTH);
  check('★ 崗位欄（第 1 欄）欄闊係 PUBLIC_ROSTER_POST_COLUMN_WIDTH',
    sheet.getColumnWidth(1) === gas.PUBLIC_ROSTER_POST_COLUMN_WIDTH);

  check('★★ A1 標題完全冇合併（第十三輪批次階段 A2 修正：唔再橫跨全部欄）',
    !sheet._merges.some(function (m) { return m.row === 1; }));
  check('★ 「崗位」標題（A2:A3）有合併', sheet._merges.some(function (m) {
    return m.row === 2 && m.col === 1 && m.numRows === 2;
  }));
  check('★ 「1月」月份標題冇合併（呢個樣本入面 1 月得返 1 個日期，span=1）',
    !sheet._merges.some(function (m) { return m.row === 2 && m.col === 2 && m.numCols > 1; }));
  check('★★ 司事 slot1/slot2（A5:A6）有垂直合併', sheet._merges.some(function (m) {
    return m.row === 5 && m.col === 1 && m.numRows === 2;
  }));

  checkEqual('★★ 工作表尺寸縮到啱好，冇上一版殘留嘅多餘欄（A5 修正）',
    sheet.getMaxColumns(), 3); // 1 個崗位欄 + 2 個日期欄
}

console.log('\n=== A1【核心】重複發佈唔會撞到「merge frozen and non-frozen rows」===');
{
  const spreadsheet = new MockSpreadsheet();
  const content = buildSampleContent('2099T1', 3);

  let firstErr = null, secondErr = null, thirdErr = null;
  try { gas.writePublicRosterContent_(spreadsheet, content); } catch (err) { firstErr = err; }
  try { gas.writePublicRosterContent_(spreadsheet, content); } catch (err) { secondErr = err; }
  try { gas.writePublicRosterContent_(spreadsheet, content); } catch (err) { thirdErr = err; }

  check('★★★ 第一次發佈唔拋錯', firstErr === null, firstErr && firstErr.message);
  check('★★★★ 第二次發佈（republish，Ivan 實測撞到嘅確實情境）唔拋錯',
    secondErr === null, secondErr && secondErr.message);
  check('★★★ 第三次發佈都唔拋錯（唔係「淨係第二次啱好過到」）',
    thirdErr === null, thirdErr && thirdErr.message);

  const sheet = spreadsheet.getSheets()[0];
  check('★ 重複發佈之後版面仍然正確（凍結／欄闊冇跑位）',
    sheet.getFrozenRows() === 3 && sheet.getFrozenColumns() === 1
      && sheet.getColumnWidth(2) === gas.PUBLIC_ROSTER_DATE_COLUMN_WIDTH);
}

console.log('\n=== A1／A5【核心】喺帶殘留狀態嘅工作表上發佈（模擬 Ivan 實測嗰個確實場景）===');
{
  // 模擬「上一次發佈用緊 24 欄嘅舊版面、凍結咗 3 行 1 欄、有一堆合併格」，
  // 依家用新版面（14 欄，呢度樣本細啲、3 欄）重新發佈。
  const spreadsheet = new MockSpreadsheet();
  const sheet = spreadsheet.getSheets()[0];
  sheet._seedResidualState({
    frozenRows: 3,
    frozenCols: 1,
    maxCols: 24,
    maxRows: 40,
    merges: [
      { row: 1, col: 1, numRows: 1, numCols: 24 }, // 舊版本標題橫跨全部 24 欄
      { row: 2, col: 1, numRows: 2, numCols: 1 },
      { row: 2, col: 2, numRows: 1, numCols: 13 }  // 舊月份合併
    ],
    values: { '1,1': '舊版本殘留標題' }
  });

  const content = buildSampleContent('2099T1', 4);
  let err = null;
  try { gas.writePublicRosterContent_(spreadsheet, content); } catch (e) { err = e; }

  check('★★★★ 帶殘留合併／凍結狀態嘅工作表上重寫，唔會拋錯（呢個就係 Ivan 實測嘅確實情況）',
    err === null, err && err.message);
  if (!err) {
    checkEqual('★★★ 舊殘留欄（第 4 欄起）已經清走，工作表縮返啱好嘅尺寸（A5 修正）',
      sheet.getMaxColumns(), 3);
    checkEqual('★ 舊版本殘留嘅標題文字已經冇咗（唔係停留喺被覆寫前嘅內容）',
      sheet.getRange(1, 1, 1, 1).getValue(), '2099T1 職事表　更新時間：2099-01-01 12:00:00');
    check('★★ 舊嘅 24 欄橫跨合併已經解除（唔喺 _merges 度）',
      !sheet._merges.some(function (m) { return m.numCols === 24; }));
  }
}

console.log('\n=== A2【核心】刻意起返一個「標題橫跨全部欄」嘅版本，證明呢種寫法會拋錯（反證）===');
{
  // 反證：直接用 mock 驗證「凍結咗第 1 欄之後，先合併一個橫跨全部欄嘅
  // 標題」呢種（第十二輪批次嘅）寫法確實會拋錯——證明 sheet_mock.js
  // 嘅限制模擬本身有效，唔係得個空殼。
  const spreadsheet = new MockSpreadsheet();
  const sheet = spreadsheet.getSheets()[0];
  sheet.setFrozenColumns(1);
  let err = null;
  try {
    sheet.getRange(1, 1, 1, 5).merge();
  } catch (e) { err = e; }
  check('★★★ mock 正確模擬「合併格跨越凍結欄分界線」會拋錯',
    err !== null && /freeze columns which contain only part/.test(err.message));
}

console.log('\n=== A1：反證——凍結列之後先合併一個跨越分界線嘅範圍，證明 mock 會捉到 ===');
{
  const spreadsheet = new MockSpreadsheet();
  const sheet = spreadsheet.getSheets()[0];
  sheet.setFrozenRows(2);
  let err = null;
  try {
    sheet.getRange(1, 1, 3, 1).merge(); // 列 1-3，凍結範圍係 1-2，跨咗去第 3 行
  } catch (e) { err = e; }
  check('★★★ mock 正確模擬「合併格跨越凍結列分界線」會拋錯',
    err !== null && /merge frozen and non-frozen rows/.test(err.message));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
