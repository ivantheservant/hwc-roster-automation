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

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'PersonPostWeight.gs', 'Generator.gs', 'RosterWriter.gs', 'RosterOutput.gs', 'PublicRoster.gs'],
  { SpreadsheetApp: { BorderStyle: { SOLID: 'SOLID', SOLID_THICK: 'SOLID_THICK' }, newTextStyle: function () { throw new Error('rich text 不測'); } } });

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
 * 第一百零二輪批次 OA 組（刻意改動）：公開檔改用共用輸出版面——內容由真正的
 * `buildRosterOutputModel_()` 產生（唔係手砌結果），涵蓋：跨月份、特別主日、多 slot 崗位、
 * BLANK 崗位、不適用格、頁腳、服侍次數頁。
 * FIXTURE-OK: 呢度砌嘅係 `buildRosterOutputModel_()` 嘅直接輸入（派工紀錄），測嘅係寫入工作表本身。
 */
function buildSampleContent(quarterId, versionNo) {
  const A = (d, post, slot, pid, name, flags) => ({ serviceDate: d, postId: post, slotIndex: slot, personId: pid, personName: name,
    assignSource: pid ? 'AUTO' : 'SKIPPED', ruleFlags: flags || [] });
  const model = gas.buildRosterOutputModel_({
    quarterId: quarterId,
    serviceDates: ['2026-01-04', '2026-02-01'],
    specialTitleByDate: { '2026-02-01': '浸禮' },
    externalOwnerByDate: {},
    posts: [
      { postId: 'CHAIR', postNameTC: '主席', slotCount: 1, displayOrder: 1, outputOrder: 10, emptyDisplay: 'PENDING' },
      { postId: 'USHER', postNameTC: '司事', slotCount: 2, displayOrder: 2, outputOrder: 20, emptyDisplay: 'PENDING' },
      { postId: 'FLOWER', postNameTC: '獻花', slotCount: 1, displayOrder: 3, outputOrder: 30, emptyDisplay: 'BLANK' },
      { postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 1, displayOrder: 4, outputOrder: 40, emptyDisplay: 'NA' }
    ],
    hasOutputOrderColumn: true,
    assignments: [
      A('2026-01-04', 'CHAIR', 1, 'P1', '陳大文'), A('2026-01-04', 'USHER', 1, 'P2', '李小明'), A('2026-01-04', 'USHER', 2, 'P3', '王美美'),
      A('2026-01-04', 'COMMUNION', 1, 'P4', '張三'),
      A('2026-02-01', 'CHAIR', 1, 'P5', '周小華'), A('2026-02-01', 'USHER', 2, 'P6', '黃小強'),
      A('2026-02-01', 'COMMUNION', 1, '', '', [gas.STRUCTURAL_NA_RULE_IDS[0]])
    ],
    people: {},
    updatedDate: '01/01/2099',
    titlePattern: '粵語堂 {Year} 年 {StartMonth}-{EndMonth} 月職事表',
    footerText: '* 若有任何疑問，請與幹事聯絡。',
    showCounts: true
  });
  model.versionNo = versionNo;
  model.publishedAt = '2099-01-01 12:00:00';
  return model;
}

console.log('\n=== A7【核心】首次發佈：逐格核對最終輸出（唔淨係「冇拋錯」）===');
{
  const spreadsheet = new MockSpreadsheet();
  const content = buildSampleContent('2099T1', 3);
  gas.writePublicRosterContent_(spreadsheet, content);
  const sheet = spreadsheet.getSheets()[0];

  checkEqual('★ 分頁名稱（第一張「職事表」、第二張「服侍次數」）', spreadsheet.getSheets().map((s) => s.getName()), ['職事表', '服侍次數']);
  checkEqual('★★ A1 標題', sheet.getRange(1, 1, 1, 1).getValue(), '粵語堂 2026 年 1-2 月職事表');
  checkEqual('★★ 最後一欄「更新日期」', sheet.getRange(1, 3, 1, 1).getValue(), '更新日期：01/01/2099');

  checkEqual('★★ A3「崗位」標題', sheet.getRange(3, 1, 1, 1).getValue(), gas.GRID_LABELS.POST_COLUMN);
  checkEqual('★★ B2 月份「1 月」', sheet.getRange(2, 2, 1, 1).getValue(), '1 月');
  checkEqual('★★ C2 月份「2 月」（第二個日期屬於 2 月）', sheet.getRange(2, 3, 1, 1).getValue(), '2 月');

  checkEqual('★★★ B3 日子只寫數字（字串，唔會變浮點數）', sheet.getRange(3, 2, 1, 1).getValue(), '4');
  checkEqual('★★★ C3 特別主日：數字下面括號標題', sheet.getRange(3, 3, 1, 1).getValue(), '1\n(浸禮)');

  checkEqual('★★ A4 崗位名稱「主席」', sheet.getRange(4, 1, 1, 1).getValue(), '主席');
  checkEqual('★ B4／C4 主席逐日文字', [sheet.getRange(4, 2, 1, 1).getValue(), sheet.getRange(4, 3, 1, 1).getValue()],
    ['陳大文', '周小華']);
  checkEqual('★★ A5 司事 slot1 顯示崗位名稱', sheet.getRange(5, 1, 1, 1).getValue(), '司事');
  checkEqual('★★ A6 司事 slot2 唔重複顯示崗位名稱（垂直合併嘅第二格）', sheet.getRange(6, 1, 1, 1).getValue(), '');
  checkEqual('★★★ C5 未有人 ⇒ 空白（唔再寫「（待填）」）＋黃色',
    [sheet.getRange(5, 3, 1, 1).getValue(), sheet._getFormat(5, 3, 'background')], ['', '#FFFF00']);
  checkEqual('★★★ A7「獻花」＋B7 留空、只有月份底色',
    [sheet.getRange(7, 1, 1, 1).getValue(), sheet.getRange(7, 2, 1, 1).getValue(), sheet._getFormat(7, 2, 'background')], ['獻花', '', '#E2EFD9']);
  checkEqual('★★★ A8「聖餐襄禮」＋非首主日空白（唔再寫「—」）', [sheet.getRange(8, 1, 1, 1).getValue(), sheet.getRange(8, 3, 1, 1).getValue()],
    ['聖餐襄禮', '']);
  checkEqual('★ 頁腳緊接表格之下（冇圖例）', sheet.getRange(9, 1, 1, 1).getValue(), '* 若有任何疑問，請與幹事聯絡。');

  check('★★ 凍結首 3 行；崗位欄唔凍結（標題先唔會被截斷）', sheet.getFrozenRows() === 3 && sheet.getFrozenColumns() === 0);
  check('★★★ 日期欄（第 2、3 欄）欄闊都係 ROSTER_OUTPUT_DATE_COL_WIDTH（欄闊真正套用咗）',
    sheet.getColumnWidth(2) === gas.ROSTER_OUTPUT_DATE_COL_WIDTH && sheet.getColumnWidth(3) === gas.ROSTER_OUTPUT_DATE_COL_WIDTH);
  check('★ 崗位欄（第 1 欄）欄闊係 ROSTER_OUTPUT_POST_COL_WIDTH', sheet.getColumnWidth(1) === gas.ROSTER_OUTPUT_POST_COL_WIDTH);

  check('★★ A1 標題完全冇合併（第十三輪批次階段 A2 修正：唔再橫跨全部欄）',
    !sheet._merges.some(function (m) { return m.row === 1; }));
  check('★ 「1 月」月份標題冇合併（呢個樣本入面 1 月得返 1 個日期，span=1）',
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
    sheet.getFrozenRows() === 3 && sheet.getFrozenColumns() === 0
      && sheet.getColumnWidth(2) === gas.ROSTER_OUTPUT_DATE_COL_WIDTH);
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
      sheet.getRange(1, 1, 1, 1).getValue(), '粵語堂 2026 年 1-2 月職事表');
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
