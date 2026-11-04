// 第一百零二輪批次 OA／OC 組：所有寄出／公開的職事表共用一個輸出版面（src/RosterOutput.gs）。
// FIXTURE-OK: 砌嘅係 `buildRosterOutputModel_()` 嘅直接輸入（派工紀錄＝readVersionAssignmentsForGrid_() 嘅形狀），
// 測嘅係版面規則本身；分類沿用 classifyGridCell_()（tests/classify_call_sites.test.js 已驗真入口）。
//   OA1–11：版面（標題、更新日期、月份合併及顏色、日子列及特別主日標籤、崗位次序 OutputOrder、
//          多人崗位合併、空白／黃色、頁腳、服侍次數頁、個人 highlight、公開檔兩張工作表）
//   OC1：自我檢查（checkRosterOutputModel_）
// 樣本：browser-test/reference/2026 T2 update_20260422.pdf、2026 T3 00.pdf。資料全部虛構。
// 執行方式：node tests/round102_oa_roster_output.test.js

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { MockSpreadsheet } = require('./helpers/sheet_mock.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + extra);
}
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, `got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// SpreadsheetApp 只供標題 rich text 及框線常數用（其餘 GAS API 照舊會拋錯）
const richCalls = [];
const SpreadsheetAppStub = {
  BorderStyle: { SOLID: 'SOLID', SOLID_THICK: 'SOLID_THICK' },
  newTextStyle: function () {
    const s = {};
    const b = { setFontFamily: (v) => { s.fontFamily = v; return b; }, setBold: (v) => { s.bold = v; return b; },
      setFontSize: (v) => { s.fontSize = v; return b; }, build: () => Object.assign({}, s) };
    return b;
  },
  newRichTextValue: function () {
    const v = { runs: [] };
    const b = { setText: (t) => { v.text = t; return b; }, setTextStyle: (a, z, st) => { v.runs.push({ a: a, z: z, st: st }); return b; },
      build: () => { richCalls.push(v); return v; } };
    return b;
  },
  flush: function () {}
};

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'PersonPostWeight.gs', 'Generator.gs',
  'RosterWriter.gs', 'RosterOutput.gs', 'PdfContentSelfCheck.gs'], { SpreadsheetApp: SpreadsheetAppStub });
const K = gas.ROSTER_OUTPUT_CELL_KIND;
const PAL = gas.ROSTER_OUTPUT_MONTH_PALETTE;

// ---- 虛構季度：2028-10-01 至 2028-12-31，14 個主日（10 月 5、11 月 4、12 月 5）----
const dates = [];
for (let d = new Date(Date.UTC(2028, 9, 1)); d <= new Date(Date.UTC(2028, 11, 31)); d.setUTCDate(d.getUTCDate() + 7)) {
  dates.push(d.toISOString().slice(0, 10));
}
const posts = [
  // DisplayOrder 故意和輸出次序不同
  { postId: 'COMMUNION', postNameTC: '聖餐襄禮', slotCount: 4, displayOrder: 1, outputOrder: 160, emptyDisplay: 'NA' },
  { postId: 'CHAIR', postNameTC: '主席', slotCount: 1, displayOrder: 2, outputOrder: 10, emptyDisplay: 'PENDING' },
  { postId: 'PREACHER', postNameTC: '講員', slotCount: 1, displayOrder: 3, outputOrder: 30, emptyDisplay: 'PENDING' },
  { postId: 'TRANSLATE', postNameTC: '翻譯', slotCount: 1, displayOrder: 4, outputOrder: 40, emptyDisplay: 'BLANK' },
  { postId: 'USHER', postNameTC: '司事', slotCount: 2, displayOrder: 5, outputOrder: 80, emptyDisplay: 'PENDING' },
  { postId: 'FLOWER', postNameTC: '獻花', slotCount: 1, displayOrder: 6, outputOrder: 150, emptyDisplay: 'BLANK' },
  { postId: 'PIANO', postNameTC: '司琴', slotCount: 1, displayOrder: 85, outputOrder: '', emptyDisplay: 'PENDING' } // 留空 ⇒ DisplayOrder 85
];
const people = {
  P9001: { nameTC: '陳大文', nameEN: 'Tom Chan' }, P9002: { nameTC: '李小明', nameEN: 'amy Lee' },
  P9003: { nameTC: '王美美', nameEN: '' }, P9004: { nameTC: '何一', nameEN: '' }, P9005: { nameTC: '張三', nameEN: 'KC Cheung' },
  P9006: { nameTC: '周四', nameEN: 'Katie Chow' }
};
const A = (d, post, slot, pid, name, extra) => Object.assign({ serviceDate: d, postId: post, slotIndex: slot, personId: pid, personName: name, assignSource: pid ? 'AUTO' : 'SKIPPED', ruleFlags: [] }, extra || {});
const assignments = [];
dates.forEach((d, i) => {
  assignments.push(A(d, 'CHAIR', 1, i === 3 ? '' : 'P9001', i === 3 ? '' : '陳大文')); // 第 4 週主席排不出 ⇒ GENUINE_GAP
  assignments.push(A(d, 'USHER', 1, 'P9002', '李小明'));
  assignments.push(A(d, 'USHER', 2, i === 0 ? 'P9003' : 'P9004', i === 0 ? '王美美' : '何一'));
  assignments.push(A(d, 'PIANO', 1, 'P9005', '張三'));
  const first = Number(d.slice(8)) <= 7;
  for (let s = 1; s <= 4; s++) {
    assignments.push(first ? A(d, 'COMMUNION', s, 'P900' + (s + 2), people['P900' + (s + 2)].nameTC)
      : A(d, 'COMMUNION', s, '', '', { ruleFlags: [gas.STRUCTURAL_NA_RULE_IDS[0]] }));
  }
  // 講員：第 1 週有（外請，沒有 PersonID），其餘不寫（MANUAL_PENDING ⇒ 黃色）
  if (i === 0) assignments.push(A(d, 'PREACHER', 1, '', '黃牧師', { assignSource: 'MANUAL' }));
  // 翻譯：第 2 週兩行
  if (i === 1) assignments.push(A(d, 'TRANSLATE', 1, '', '甲(粵>華)\n乙(粵>英)', { assignSource: 'MANUAL' }));
  // 獻花：第 1 週有人
  if (i === 0) assignments.push(A(d, 'FLOWER', 1, 'P9006', '周四'));
});
// 合堂週（第 9 週）：司琴由英語堂負責；司事第 1 個沒有外部單位 ⇒ 空白
const combined = dates[8];
assignments.forEach((a) => {
  if (a.serviceDate === combined && a.postId === 'PIANO') { a.personId = ''; a.personName = ''; a.ruleFlags = [gas.SPECIAL_SKIP_RULE_IDS[0]]; a.assignSource = 'SKIPPED'; }
});
// 臨時幫手：最後一週司事 2
assignments.forEach((a) => {
  if (a.serviceDate === dates[13] && a.postId === 'USHER' && a.slotIndex === 2) { a.personId = ''; a.personName = '臨時甲'; a.assignSource = 'MANUAL'; }
});

const baseInput = {
  quarterId: '2028T4', serviceDates: dates,
  specialTitleByDate: { [dates[8]]: '宣教月合堂' }, externalOwnerByDate: { [dates[8]]: '英語堂' },
  posts: posts, hasOutputOrderColumn: true, assignments: assignments, people: people,
  updatedDate: '18/06/2028', titlePattern: '粵語堂 {Year} 年 {StartMonth}-{EndMonth} 月職事表',
  footerText: '* 若有任何疑問，請與示範幹事聯絡。', showCounts: true
};
const model = gas.buildRosterOutputModel_(baseInput);
const sm = model.sheets[0];
const v = (r, c) => sm.values[r - 1][c - 1];
const bg = (r, c) => sm.backgrounds[r - 1][c - 1];

console.log('\n=== OA2 標題列 ===');
eq('★★★★★ 標題「粵語堂 2028 年 10-12 月職事表」', v(1, 1), '粵語堂 2028 年 10-12 月職事表');
eq('★★★★ 右邊「更新日期：dd/MM/yyyy」（最後一欄、靠右）', [v(1, sm.numCols), sm.horizontalAlignments[0][sm.numCols - 1]], ['更新日期：18/06/2028', 'right']);
check('★★★ 標題粗體、大字；「粵語堂」另用較粗字型（rich text 前綴 3 字）', sm.fontWeights[0][0] === 'bold' && sm.fontSizes[0][0] >= 18 && sm.titleRich && sm.titleRich.prefixLength === 3);
eq('★★★ 更新日期：yyyy-MM-dd HH:mm:ss ⇒ dd/MM/yyyy', gas.formatOutputUpdatedDate_('2026-06-18 10:03:00'), '18/06/2026');

console.log('\n=== OA1／OA3 表頭兩列、14 個主日 ===');
eq('★★★★★ 14 個主日 ⇒ 15 欄（崗位＋14）', sm.numCols, 15);
eq('★★★★★ 月份合併範圍（10 月 5、11 月 4、12 月 5）', model.monthGroups.map((g) => [g.label, g.span]), [['10 月', 5], ['11 月', 4], ['12 月', 5]]);
eq('★★★★ 月份合併格在第 2 行、由第 2 欄起', sm.merges.filter((m) => m.row === 2), [{ row: 2, col: 2, numRows: 1, numCols: 5 }, { row: 2, col: 7, numRows: 1, numCols: 4 }, { row: 2, col: 11, numRows: 1, numCols: 5 }]);
eq('★★★★ 左上角灰 #A6A6A6、「崗位」#BFBFBF', [bg(2, 1), v(3, 1), bg(3, 1)], ['#A6A6A6', '崗位', '#BFBFBF']);
eq('★★★★★ 日子列只寫日子數字', [v(3, 2), v(3, 3), v(3, 6)], ['1', '8', '29']);
eq('★★★★★ 特別主日：數字下面加括號標題', v(3, 10), '26\n(宣教月合堂)');

console.log('\n=== OA4 顏色（按季內第幾個月）===');
eq('★★★★★ 第 1 個月：月份 #A8D08D、日子 #C5E0B3、內容 #E2EFD9', [bg(2, 2), bg(3, 2), bg(4, 2)], ['#A8D08D', '#C5E0B3', '#E2EFD9']);
eq('★★★★★ 第 2 個月：#F4B083／#F7CAAC／#FBE4D5', [bg(2, 7), bg(3, 7), bg(4, 7)], ['#F4B083', '#F7CAAC', '#FBE4D5']);
eq('★★★★★ 第 3 個月：#9CC2E5／#BDD6EE／#DEEAF6', [bg(2, 11), bg(3, 11), bg(4, 11)], ['#9CC2E5', '#BDD6EE', '#DEEAF6']);
// QUARTER_TERM_START_MONTHS 可以改：季度由 2 月開始時，第 1 個月（2 月）仍然是綠色
const m1 = gas.buildRosterOutputModel_(Object.assign({}, baseInput, { serviceDates: ['2027-02-07', '2027-03-07', '2027-04-04'], assignments: [] }));
eq('★★★★ 不按月份：2 月開始的季度，第 1／2／3 個月是綠／橙／藍', [1, 2, 3].map((c) => m1.sheets[0].backgrounds[1][c]), ['#A8D08D', '#F4B083', '#9CC2E5']);
eq('★★★ 崗位名稱 #D9D9D9、粗體', [bg(4, 1), sm.fontWeights[3][0]], ['#D9D9D9', 'bold']);

console.log('\n=== OA5 崗位次序（OutputOrder；留空用 DisplayOrder）、多人崗位合併 ===');
eq('★★★★★ 次序跟 OutputOrder，司琴 OutputOrder 留空 ⇒ 用 DisplayOrder 85（排在司事 80 之後）', model.postOrder, ['CHAIR', 'PREACHER', 'TRANSLATE', 'USHER', 'PIANO', 'FLOWER', 'COMMUNION']);
const rowOf = (name) => sm.values.findIndex((r) => r[0] === name) + 1;
eq('★★★★ 多人崗位：司事 2 行、聖餐襄禮 4 行，崗位名稱合併', sm.merges.filter((m) => m.col === 1).map((m) => [v(m.row, 1), m.numRows]), [['司事', 2], ['聖餐襄禮', 4]]);
const noCol = gas.sortPostsForOutput_(posts.map((p) => Object.assign({}, p, { outputOrder: '' })), false).map((p) => p.postNameTC);
eq('★★★★ 還未有 OutputOrder 欄 ⇒ 用樣本種子次序（主席、講員、翻譯、司琴、司事、獻花、聖餐襄禮）', noCol, ['主席', '講員', '翻譯', '司琴', '司事', '獻花', '聖餐襄禮']);
eq('★★★ 種子次序比對不理空格（「PPT 控制」＝「PPT控制」）', gas.resolveOutputPostSortKey_({ postNameTC: 'PPT 控制', displayOrder: 99 }, false), 10);
eq('★★★ 種子沒有的崗位排最後（按 DisplayOrder）', gas.resolveOutputPostSortKey_({ postNameTC: '新崗位', displayOrder: 5 }, false), 1005);

console.log('\n=== OA6 內容格：只寫名字；空白／黃色 ===');
const chairRow = rowOf('主席');
eq('★★★★★ 有人 ⇒ 名字', v(chairRow, 2), '陳大文');
eq('★★★★★ 系統排不出（未能安排）⇒ 空白＋黃色 #FFFF00', [v(chairRow, 5), bg(chairRow, 5)], ['', '#FFFF00']);
const preRow = rowOf('講員');
eq('★★★★★ 外請講員照原文（連稱謂）', v(preRow, 2), '黃牧師');
eq('★★★★★ 講員未填（待確認）⇒ 空白＋黃色', [v(preRow, 3), bg(preRow, 3)], ['', '#FFFF00']);
const trRow = rowOf('翻譯');
eq('★★★★ 翻譯可以兩行', v(trRow, 3), '甲(粵>華)\n乙(粵>英)');
check('★★★ 兩行的列較高', sm.rowHeights[trRow] > sm.rowHeights[chairRow]);
eq('★★★★★ 翻譯（EmptyDisplay=BLANK）空白 ⇒ 只有月份底色，不是黃色', [v(trRow, 2), bg(trRow, 2)], ['', '#E2EFD9']);
const flRow = rowOf('獻花');
eq('★★★★ 獻花空白 ⇒ 月份底色', [v(flRow, 3), bg(flRow, 3)], ['', '#E2EFD9']);
const coRow = rowOf('聖餐襄禮');
eq('★★★★★ 聖餐襄禮只在每月第一個主日有名字（10/1、11/5、12/3）', [v(coRow, 2), v(coRow, 7), v(coRow, 11)], ['王美美', '王美美', '王美美']);
eq('★★★★★ 聖餐襄禮其他主日：空白＋月份底色（不是「—」、不是黃色）', [v(coRow, 3), bg(coRow, 3), v(coRow + 3, 8), bg(coRow + 3, 8)], ['', '#E2EFD9', '', '#FBE4D5']);
const piRow = rowOf('司琴');
eq('★★★★★ 合堂週：由英語堂負責 ⇒ 寫「英語堂」，月份底色', [v(piRow, 10), bg(piRow, 10)], ['英語堂', '#FBE4D5']);
const noOwner = gas.classifyRosterOutputCell_({ personId: '', personName: '', ruleFlags: [gas.SPECIAL_SKIP_RULE_IDS[0]] }, 'PENDING', '');
eq('★★★★ 合堂跳過而沒有外部單位 ⇒ 空白（不寫「特殊主日」）', noOwner, { kind: K.BLANK, text: '' });
const allValues = JSON.stringify(sm.values);
check('★★★★★ 整張表沒有「待確認」「—」「特殊主日」「未能安排」「⚠」', !/待確認|—|特殊主日|未能安排|⚠/.test(allValues), allValues.slice(0, 200));
check('★★★★★ 整張表沒有 PersonID', !/P00\d/.test(allValues));
check('★★★★ 沒有圖例、沒有「本季實際格數」、沒有「如未能按上表服侍」', !/圖例|本季實際格數|如未能按上表服侍/.test(allValues));
const yellowCount = sm.backgrounds.flat().filter((c) => c === '#FFFF00').length;
eq('★★★★ 黃色格數＝missingCells（主席 1＋講員 13）', [yellowCount, model.missingCells.length], [14, 14]);

console.log('\n=== OA7 頁腳 ===');
eq('★★★★★ 表下一行頁腳', [v(sm.numRows, 1), sm.horizontalAlignments[sm.numRows - 1][0]], ['* 若有任何疑問，請與示範幹事聯絡。', 'left']);
check('★★★ 頁腳不在框線範圍內', sm.borderRange.row + sm.borderRange.numRows - 1 === sm.numRows - 1);

console.log('\n=== OA8 服侍次數頁 ===');
const cs = model.sheets[1];
eq('★★★★★ 第二張「服侍次數」，三欄', [cs.name, cs.numCols], ['服侍次數', 3]);
const lines = model.countEntries.map((e) => gas.formatServiceCountLine_(e));
eq('★★★★★ 先英文名（不分大小寫）、後只有中文名（按字碼）；格式「英文名 中文名 (次數)」',
  lines, ['amy Lee 李小明 (14)', 'Katie Chow 周四 (4)', 'KC Cheung 張三 (16)', 'Tom Chan 陳大文 (13)', '何一 (15)', '王美美 (4)']);
check('★★★★★ 次數包括聖餐襄禮、獻花（王美美＝司事 1＋聖餐 3；周四＝聖餐 3＋獻花 1）', lines.includes('王美美 (4)') && lines.includes('Katie Chow 周四 (4)'));
check('★★★★ 臨時幫手、外請講員沒有 PersonID ⇒ 不計', !lines.some((l) => /臨時甲|黃牧師/.test(l)));
eq('★★★★ 直排：第 1 欄排完再到第 2 欄（6 人 ⇒ 每欄 2 行）', cs.values, [[lines[0], lines[2], lines[4]], [lines[1], lines[3], lines[5]]]);
check('★★★ 沒有標題列、沒有 PersonID', !/P00\d|姓名|次數/.test(JSON.stringify(cs.values).replace(/\(\d+\)/g, '')));
const off = gas.buildRosterOutputModel_(Object.assign({}, baseInput, { showCounts: false }));
eq('★★★★★ ROSTER_OUTPUT_SHOW_COUNTS=FALSE ⇒ 只有一張', off.sheets.length, 1);
eq('★★★ 兩頁總闊度一樣（縮放一樣）', cs.columnWidths.reduce((a, b) => a + b, 0) <= sm.columnWidths.reduce((a, b) => a + b, 0) && cs.columnWidths.reduce((a, b) => a + b, 0) >= sm.columnWidths.reduce((a, b) => a + b, 0) - 3, true);

console.log('\n=== OA10 個人 highlight ===');
eq('★★★★★ 預設：粗體、深紅字 #C00000、粗框，不用底色', gas.parseRosterOutputHighlightStyle_('BOLD,#C00000,BORDER'), { bold: true, fontColor: '#C00000', border: true, background: '' });
eq('★★★ Config 可改（底色）', gas.parseRosterOutputHighlightStyle_('bg:#ffeeaa, bold'), { bold: true, fontColor: '', border: false, background: '#FFEEAA' });
eq('★★★ 全部認不出 ⇒ 預設', gas.parseRosterOutputHighlightStyle_('xyz'), { bold: true, fontColor: '#C00000', border: true, background: '' });
const p3 = gas.locateRosterOutputPersonCells_(model, 'P9003');
eq('★★★★★ 標示的格全部是那個人（王美美 4 格）', [p3.length, p3.every((c) => v(c.row, c.col) === '王美美')], [4, true]);
const temp = gas.locateRosterOutputPersonCells_(model, 'NAME:臨時甲');
eq('★★★★ 臨時幫手按名字', [temp.length, v(temp[0].row, temp[0].col)], [1, '臨時甲']);

console.log('\n=== 寫入（公開檔／PDF 暫存檔共用）===');
const ss = new MockSpreadsheet();
ss.getSheets()[0]._seedResidualState({ frozenRows: 2, frozenCols: 1, merges: [{ row: 1, col: 1, numRows: 1, numCols: 5 }] });
ss.insertSheet('幹事手動加的');
const written = gas.writeRosterOutputToSpreadsheet_(ss, model);
eq('★★★★★ 兩張：職事表、服侍次數（其他工作表刪走）', ss.getSheets().map((s) => s.getName()), ['職事表', '服侍次數']);
const ws = written.rosterSheet;
eq('★★★★ 內容寫入', [ws._getCell(3, 10), ws._getCell(chairRow, 2)], ['26\n(宣教月合堂)', '陳大文']);
eq('★★★★ 底色寫入', [ws._getFormat(2, 2, 'background'), ws._getFormat(chairRow, 5, 'background')], ['#A8D08D', '#FFFF00']);
eq('★★★ 全部格細黑框（表格範圍）', ws._getFormat(4, 2, 'border'), { color: '#000000', style: 'SOLID' });
eq('★★★ 字型 Noto Sans TC', ws._getFormat(4, 2, 'fontFamily'), 'Noto Sans TC');
eq('★★★ 只凍結頂 3 行（崗位欄不凍結，標題才不會被截斷）', [ws.getFrozenRows(), ws.getFrozenColumns()], [3, 0]);
check('★★★ 「粵語堂」rich text：Noto Serif TC 粗體', richCalls.some((r) => r.runs.some((x) => x.a === 0 && x.z === 3 && x.st.fontFamily === 'Noto Serif TC' && x.st.bold)));
gas.writeRosterOutputToSpreadsheet_(ss, off);
eq('★★★★ 重新發佈而次數頁關掉 ⇒ 刪走「服侍次數」', ss.getSheets().map((s) => s.getName()), ['職事表']);

console.log('\n=== 寫入：GAS 每次回新的 Sheet 物件（第一百零二輪部署實測撞到「You can\'t remove all the sheets」）===');
{
  // 季度重設之後的公開檔：只有一張（舊名「完整版」，內容「已重設」）
  const fresh = new MockSpreadsheet({ freshWrappers: true });
  fresh.getSheets()[0].setName('完整版');
  let err = null;
  try { gas.writeRosterOutputToSpreadsheet_(fresh, model); } catch (e) { err = e; }
  check('★★★★★ 只有一張工作表的檔案寫入不拋錯（不會把全部工作表刪走）', err === null, err && err.message);
  eq('★★★★★ 寫完是「職事表」「服侍次數」兩張', fresh.getSheets().map((s) => s.getName()), ['職事表', '服侍次數']);
  let err2 = null;
  try { gas.writeRosterOutputToSpreadsheet_(fresh, model); } catch (e) { err2 = e; }
  check('★★★★★ 重新發佈（已有兩張）不拋錯，仍然兩張', err2 === null && fresh.getSheets().length === 2, err2 && err2.message);
  fresh.insertSheet('幹事手動加的');
  gas.writeRosterOutputToSpreadsheet_(fresh, off);
  eq('★★★★ 次數頁關掉 ⇒ 只剩「職事表」（多餘工作表刪走）', fresh.getSheets().map((s) => s.getName()), ['職事表']);
}

console.log('\n=== 個人 highlight 寫入（上一個人的格還原）===');
const ctx = { rosterSheet: ws, model: model, highlightStyle: gas.parseRosterOutputHighlightStyle_('BOLD,#C00000,BORDER'), highlighted: [] };
gas.writeRosterOutputToSpreadsheet_(ss, model);
const n1 = gas.applyRosterOutputHighlight_(ctx, gas.locateRosterOutputPersonCells_(model, 'P9003'));
const c3 = p3[0];
eq('★★★★★ 標示：粗體、#C00000、粗框', [n1, ws._getFormat(c3.row, c3.col, 'fontWeight'), ws._getFormat(c3.row, c3.col, 'fontColor'), ws._getFormat(c3.row, c3.col, 'border').style], [4, 'bold', '#C00000', 'SOLID_THICK']);
gas.applyRosterOutputHighlight_(ctx, gas.locateRosterOutputPersonCells_(model, 'P9005'));
eq('★★★★★ 下一個人：上一個人的格還原（normal、黑字、細框）', [ws._getFormat(c3.row, c3.col, 'fontWeight'), ws._getFormat(c3.row, c3.col, 'fontColor'), ws._getFormat(c3.row, c3.col, 'border').style], ['normal', '#000000', 'SOLID']);
check('★★★★ 黃色不用作 highlight（個人格底色不變）', ws._getFormat(c3.row, c3.col, 'background') !== '#FFFF00');
eq('★★★ A1 寫法', [gas.rosterOutputCellA1_({ row: 5, col: 2 }), gas.rosterOutputCellA1_({ row: 1, col: 27 })], ['B5', 'AA1']);

console.log('\n=== PDF 匯出參數 ===');
const params = gas.buildRosterOutputPdfExportParams_();
check('★★★★★ 整份試算表（沒有 gid ⇒ 第 1 頁職事表、第 2 頁服侍次數）', !params.some((p) => /^gid=/.test(p)));
check('★★★★ A4 橫向、縮到頁寬、沒有格線及頁碼、不印批註', ['size=A4', 'portrait=false', 'fitw=true', 'gridlines=false', 'pagenumbers=false', 'shownotes=false'].every((x) => params.includes(x)));

console.log('\n=== OC 自我檢查 ===');
const expect = { statusWords: ['待確認', '—', '特殊主日', '⚠ 未能安排'], personIds: Object.keys(people), expectedPostOrder: model.postOrder.slice(),
  samplePersonId: 'P9003', samplePersonCellCount: 4, samplePersonName: '王美美' };
const good = gas.checkRosterOutputModel_(model, expect);
check('★★★★★ 正常版面全部通過', good.ok, JSON.stringify(good.items.filter((i) => !i.ok)));
const bad1 = JSON.parse(JSON.stringify(model)); bad1.sheets[0].values[chairRow - 1][4] = '待確認';
check('★★★★★ 有狀態字 ⇒ 報錯', !gas.checkRosterOutputModel_(bad1, expect).items[0].ok);
const bad2 = JSON.parse(JSON.stringify(model)); bad2.sheets[0].values[chairRow - 1][1] = 'P9001';
check('★★★★★ 有 PersonID ⇒ 報錯', !gas.checkRosterOutputModel_(bad2, expect).ok);
const bad3 = JSON.parse(JSON.stringify(model)); bad3.sheets[0].backgrounds[1][7] = '#A8D08D';
check('★★★★ 月份顏色錯 ⇒ 報錯', !gas.checkRosterOutputModel_(bad3, expect).items.find((i) => /月份顏色/.test(i.label)).ok);
const bad4 = JSON.parse(JSON.stringify(model)); bad4.sheets[0].backgrounds[preRow - 1][2] = '#E2EFD9';
check('★★★★★ 未有人的格不是黃色 ⇒ 報錯', !gas.checkRosterOutputModel_(bad4, expect).items.find((i) => /黃色/.test(i.label)).ok);
check('★★★★ 崗位次序不對 ⇒ 報錯', !gas.checkRosterOutputModel_(model, Object.assign({}, expect, { expectedPostOrder: model.postOrder.slice().reverse() })).ok);
check('★★★★ highlight 格數不對 ⇒ 報錯', !gas.checkRosterOutputModel_(model, Object.assign({}, expect, { samplePersonCellCount: 5 })).ok);

console.log('\n=== OA5 補建 Posts.OutputOrder（〔補建設定及範本〕）===');
{
  const postsSs = new MockSpreadsheet();
  const ps = postsSs.getSheets()[0];
  ps.setName('Posts');
  ps.getRange(1, 1, 1, 3).setValues([['崗位', '名稱', '次序']]);
  ps.getRange(2, 1, 1, 3).setValues([['PostID', 'PostName_TC', 'DisplayOrder']]);
  ps.getRange(3, 1, 4, 3).setValues([['CHAIR', '主席', 1], ['PPT', 'PPT 控制', 2], ['COMM', '聖餐襄禮', 3], ['NEW', '新崗位', 4]]);
  const g3 = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'RosterOutput.gs'],
    { SpreadsheetApp: { getActiveSpreadsheet: () => postsSs } });
  const plan = g3.planPostOutputOrderSeed_();
  eq('★★★★★ 欄不存在 ⇒ 要補；按樣本次序（主席 10、PPT 控制 100、聖餐襄禮 160；樣本沒有的留空）',
    [plan.needed, plan.columnExists, plan.fills.map((f) => f.value)], [true, false, [10, 100, 160, '']]);
  const n = g3.seedPostOutputOrder_(plan);
  eq('★★★★★ 新增 OutputOrder 欄（第 2 行機器鍵）並填好', [n, ps._getCell(2, 4), ps._getCell(3, 4), ps._getCell(6, 4)], [3, 'OutputOrder', 10, '']);
  ps._setCell(4, 4, 15);
  // 補建之後由試算表讀（readSheet_ 每次執行有記憶，這裏新開一次）
  const g4 = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'RosterOutput.gs'],
    { SpreadsheetApp: { getActiveSpreadsheet: () => postsSs } });
  eq('★★★★ 有人填過值 ⇒ 不再補（不覆寫幹事改過的次序）', g4.planPostOutputOrderSeed_().needed, false);
}

console.log('\n=== OB 入口：寄出／公開全部經共用版面（讀原始碼）===');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const body = (code, name) => { const i = code.indexOf('function ' + name + '('); const j = code.indexOf('\nfunction ', i + 10); return code.slice(i, j < 0 ? undefined : j); };
const pe = src('PdfExport.gs');
check('★★★★★ 整季 PDF 用共用版面（不再由 Roster_* 工作表匯出）', /openRosterOutputPdfContext_/.test(body(pe, 'buildFullRosterPdfBlob_')) && !/exportSheetAsPdfBlob_/.test(body(pe, 'buildFullRosterPdfBlob_')));
check('★★★★★ 個人 PDF 用共用版面', /exportRosterOutputPdfBlob_/.test(body(pe, 'buildPersonalPdfBlob_')) && /openRosterOutputPdfContext_/.test(body(pe, 'openPersonalPdfRenderContext_')));
const pr = src('PublicRoster.gs');
check('★★★★★ 公開檔用共用版面', /buildRosterOutputForVersion_/.test(body(pr, 'buildPublicRosterContent_')) && /writeRosterOutputToSpreadsheet_/.test(body(pr, 'writePublicRosterContent_')));
const all = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.gs')).map((f) => [f, src(f)]);
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const users = all.filter(([f, t]) => f !== 'PdfExport.gs' && /exportSheetAsPdfBlob_\(/.test(stripComments(t))).map(([f]) => f);
eq('★★★★★ 沒有其他檔案由 Roster_* 工作表直接匯出 PDF', users, []);
const adm = src('AdminTools.gs');
check('★★★★ 〔補建設定及範本〕比對列出 OutputOrder、執行時補建', /postsOutputOrder:/.test(body(adm, 'apiPlanSeedConfigAndTemplates'))
  && /o\.needed \? seedPostOutputOrder_\(o\) : 0/.test(body(adm, 'apiSeedConfigAndTemplates')));
const pc = src('PdfContentSelfCheck.gs');
check('★★★★ 〔核對寄出版面〕不寄出、不發佈、不寫任何工作表（連 AuditLog 都不寫）：只有存檔到「版面樣本」',
  !/sendMail|publishPublicRoster_|MailApp|GmailApp|writeAuditLog_|setValue|appendRow/.test(body(pc, 'apiRosterOutputSample'))
  && /getOrCreateRosterOutputSampleFolder_\(\)/.test(body(pc, 'apiRosterOutputSample')));

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
