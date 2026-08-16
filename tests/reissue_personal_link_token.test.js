// 第十五輪批次階段 B（主動稽核期間發現）：`reissuePersonalLinkToken_()` 有
// 同 normalizeIdInput_() 針對嘅 QuarterID 一模一樣嘅輸入風險——PersonID 係
// 人手打字入 ui.prompt()，再同 NameMapping 度嘅值做嚴格相等比對，全形／
// 零闊度字元一樣會令搵唔到人。
//
// 修正做法同 QuarterID 一致：只喺輸入捕捉點（runReissuePersonalLinkToken_()）
// 用 normalizeIdInput_() 處理，唔改讀表比對嗰邊（sheet 值本身理應乾淨，
// 而且同 findLatestVersionNo() 等既有做法保持一致）。
//
// 呢個測試檔用真正嘅原始碼（loadGasSource）＋一個支援 getLastRow/
// getLastColumn 嘅假試算表，實測 reissuePersonalLinkToken_() 本身嘅行為
// （唔止靜態字串檢查）。
//
// 執行方式：node tests/reissue_personal_link_token.test.js

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// 貼近真實 Google Sheets 行為嘅假試算表（同 preacher_translation_fill_live.test.js
// 用嘅同一套設計，tests/helpers/sheet_mock.js 冇 getLastRow/getLastColumn，唔啱用）。
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows || 1; this.numCols = numCols || 1;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      const srcRow = this.sheet.rows[this.row - 1 + r] || [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(srcRow[this.col - 1 + c] === undefined ? '' : srcRow[this.col - 1 + c]);
      out.push(rowArr);
    }
    return out;
  }
  getValue() {
    const srcRow = this.sheet.rows[this.row - 1] || [];
    return srcRow[this.col - 1] === undefined ? '' : srcRow[this.col - 1];
  }
  setValue(v) {
    if (!this.sheet.rows[this.row - 1]) this.sheet.rows[this.row - 1] = [];
    this.sheet.rows[this.row - 1][this.col - 1] = v;
    return this;
  }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() {
    let max = 0;
    this.rows.forEach(function (r) { if (r && r.length > max) max = r.length; });
    return max;
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows, numCols); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  addSheet(name, headerTC, headerKeys, dataRows) {
    const s = new FakeSheet(name);
    s.rows[0] = headerTC || [];
    s.rows[1] = headerKeys || [];
    (dataRows || []).forEach(function (r, i) { s.rows[2 + i] = r; });
    this.sheets[name] = s;
    return s;
  }
}

function buildGas() {
  const ss = new FakeSpreadsheet();
  ss.addSheet('NameMapping',
    ['PersonID', '姓名', 'PersonalLinkToken'],
    ['PersonID', 'NameTC', 'PersonalLinkToken'],
    [
      ['P001', '陳大文', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      ['P002', '李小明', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    ]);

  let uuidCounter = 0;
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'WebAppPersonalLink.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return ss; } },
    Utilities: { getUuid: function () { uuidCounter++; return 'newtoken-' + uuidCounter + '-0000-0000-000000000000'; } }
  });
  return { gas, ss };
}

console.log('\n=== reissuePersonalLinkToken_()：正常半形 PersonID 直接搵到 ===');
{
  const { gas, ss } = buildGas();
  const result = gas.reissuePersonalLinkToken_('P001');
  checkEqual('★★★ 回傳正確嘅 personId', result.personId, 'P001');
  checkEqual('★★ 回傳正確嘅姓名', result.nameTC, '陳大文');
  check('★★ token 已經更新（唔再係舊值）', ss.sheets.NameMapping.rows[2][2] !== 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  checkEqual('★ P002 嘅 token 完全冇被動過', ss.sheets.NameMapping.rows[3][2], 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
}

console.log('\n=== 【核心】搵唔到嘅 PersonID 會拋錯（唔存在） ===');
{
  const { gas } = buildGas();
  let threw = null;
  try { gas.reissuePersonalLinkToken_('P999'); } catch (e) { threw = e; }
  check('★★★ 拋出錯誤', !!threw);
  check('★★ 錯誤訊息提到搵唔到 PersonID', threw && threw.message.indexOf('P999') !== -1, threw && threw.message);
}

console.log('\n=== 【核心】runReissuePersonalLinkToken_() 嘅輸入捕捉點已經套用 normalizeIdInput_() ===');
{
  const SRC = path.join(__dirname, '..', 'src');
  const content = fs.readFileSync(path.join(SRC, 'WebAppPersonalLink.gs'), 'utf8');
  check('★★★★ personId 唔再係裸 .trim()，改用 normalizeIdInput_()（同 QuarterID 入口一致嘅正規化，防全形／零闊度字元令 PersonID 比對唔上）',
    content.indexOf('const personId = normalizeIdInput_(response.getResponseText());') !== -1);
  check('★★★ 冇殘留舊嘅裸 trim 寫法',
    content.indexOf('const personId = response.getResponseText().trim();') === -1);
}

console.log('\n=== 【核心】normalizeIdInput_() 令全形 PersonID 輸入正規化之後可以搵到人 ===');
{
  // 呢度直接測 normalizeIdInput_() 本身喺呢個場景嘅效果——真正嘅
  // ui.prompt() 冇辦法喺 Node 環境重現，但正規化之後嘅字串行為同
  // normalize_quarter_id.test.js 已經驗證過嘅係同一個函式、同一套邏輯。
  const { gas } = buildGas();
  const fullWidthInput = 'Ｐ００１'; // 全形版本嘅 "P001"
  const normalized = gas.normalizeIdInput_(fullWidthInput);
  checkEqual('★★★★ 全形 "Ｐ００１" 正規化之後變返半形 "P001"', normalized, 'P001');
  const result = gas.reissuePersonalLinkToken_(normalized);
  checkEqual('★★★ 正規化之後可以成功搵到 P001（如果冇正規化，全形字串直接同 sheet 度嘅半形值比對會失敗）',
    result.personId, 'P001');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
