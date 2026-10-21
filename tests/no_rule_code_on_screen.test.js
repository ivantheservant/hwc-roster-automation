// 第七十輪批次 AV 組：內部規則代號不印到義工收到的 PDF，也不直接顯示給幹事。
// 執行方式：node tests/no_rule_code_on_screen.test.js
//
// 現場（2026-10-21 截圖 s44）：個人 PDF 第 3 頁腳註寫「[1] SEMI_NO_CONSECUTIVE: 上一週同崗位已是此人」。
// 來源：`RosterWriter.gs` 把 `w.ruleId + ': ' + w.reason` 寫成工作表批註，PDF 匯出時批註變成腳註。
//
// 做法：一、批註只寫中文原因；二、PDF 匯出網址不印批註（三種義工 PDF 都經 `exportSheetAsPdfBlob_()`）；
//       三、畫面上直接顯示規則代號的地方改成中文說明（只改顯示文字，不改資料）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CODE_RE = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/;   // 全大楷加底線的內部代號

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'RosterWriter.gs', 'PdfExport.gs', 'FourStageFlow.gs'
]);

// =====================================================================
console.log('\n=== AV1 批註只寫中文原因 ===');
{
  gas.getConfig = function (_k, d) { return d; };
  const key = '2028-07-02|CHAIR|1';
  const layout = {
    rows: [{}], keys: ['a'],
    cellIndex: {}
  };
  layout.cellIndex[key] = { row: 3, column: 1, assignment: null, cellClass: gas.GRID_CELL_CLASS.ASSIGNED };
  const warningIndex = {};
  warningIndex[key] = [
    { ruleId: 'SEMI_NO_CONSECUTIVE', reason: '上一週同崗位已是此人' },
    { ruleId: 'HARD_ELIGIBILITY', reason: '不在這個崗位的名單上' }
  ];
  let captured = null;
  const sheet = {
    getRange: function () {
      return { setBackgrounds: function () {}, setNotes: function (n) { captured = n; } };
    }
  };
  gas.applyCellMarks_(sheet, layout, warningIndex);
  const note = captured && captured[0] && captured[0][0];
  check('★★★★★★ 批註有中文原因', /上一週同崗位已是此人/.test(note || ''), JSON.stringify(captured));
  check('★★★★★★ 批註**不含**內部規則代號（SEMI_／HARD_ 開頭的全大楷代號）',
    !CODE_RE.test(note || ''), note);
  check('★★★★ 兩條原因都在、分行', (note || '').split('\n').length === 2, note);
}

// =====================================================================
console.log('\n=== AV2 義工 PDF 的匯出網址不印批註 ===');
{
  let url = null;
  gas.getConfig = function (_k, d) { return d; };
  gas.ScriptApp = { getOAuthToken: function () { return 't'; } };
  gas.fetchWithRetry_ = function (u) {
    url = u;
    return { responseCode: 200, retries: 0, blobTooSmall: false,
      blob: { getBytes: function () { return [1, 2, 3]; }, setName: function () { return this; } } };
  };
  const sheet = { getParent: function () { return { getId: function () { return 'SSID'; } }; }, getSheetId: function () { return 7; } };
  try { gas.exportSheetAsPdfBlob_(sheet, 'x.pdf'); } catch (e) { /* 只看網址 */ }
  check('★★★★★★ 匯出網址有 shownotes=false（不印批註／腳註）', url && /[?&]shownotes=false(&|$)/.test(url), url);
  check('★★★★★ 匯出網址有 printnotes=false', url && /[?&]printnotes=false(&|$)/.test(url), url);
  check('★★★★★ 全專案只有一處組 PDF 匯出網址（個人版、整季版、紙本三種都經過它）',
    (read('src/PdfExport.gs').match(/\/export\?/g) || []).length === 1
    && !/\/export\?/.test(read('src/PdfBatch.gs')), '');
}

// =====================================================================
console.log('\n=== AV3 畫面不直接顯示規則代號 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone4.html']);
  const vm = require('vm');
  ui.__x = { ruleId: 'SOFT_UNKNOWN_FUTURE_RULE', serviceDate: '2028-07-02', postNameTC: '主席', slotIndex: 1, personName: '假甲' };
  const line = vm.runInContext('humanViolationLine(__x)', ui);
  check('★★★★★★ 對不上的規則代號：不印英文代號，印一句通用的中文', !CODE_RE.test(line) && /排表規則沒有符合/.test(line), line);
  ui.__y = { ruleId: 'SOFT_UNKNOWN_FUTURE_RULE', reason: '某某原因' };
  check('★★★★★ 有後端中文原因就用原因', /某某原因/.test(vm.runInContext('humanViolationLine(Object.assign({}, __x, __y))', ui)));
  check('★★★★★ 已知代號仍然用對照句', /他未做過這個崗位/.test(
    vm.runInContext('humanViolationLine(Object.assign({}, __x, { ruleId: "HARD_ELIGIBILITY" }))', ui)));

  // 靜態掃描：任何 `text: ... .ruleId` 的顯示行都不可以直接用代號
  const offenders = [];
  fs.readdirSync(path.join(ROOT, 'src', 'ui')).filter((f) => f.endsWith('.html')).forEach((f) => {
    read('src/ui/' + f).split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || /^\s*\*/.test(l)) return;
      if (/text:.*\b\w+\.ruleId\b/.test(l) && !/plainRuleText|RULE_SENTENCE/.test(l)) offenders.push(f + ':' + (i + 1));
      if (/\|\|\s*\w+\.ruleId\b/.test(l)) offenders.push(f + ':' + (i + 1));
    });
  });
  check('★★★★★★ src/ui 沒有任何一行把 .ruleId 直接當顯示文字', offenders.length === 0, offenders.join(', '));

  const lines = gas.buildViolationReportLines_([{
    severity: gas.RULE_LEVELS.HARD, ruleId: 'HARD_ELIGIBILITY', serviceDate: '2028-07-02',
    postNameTC: '主席', slotIndex: 1, personName: '假甲', reason: '不在這個崗位的名單上'
  }], 'Roster_2028T3_v1');
  check('★★★★★ 選單的違反報告也不印規則代號', !CODE_RE.test(lines.join('\n')) && /不在這個崗位的名單上/.test(lines.join('\n')), lines.join('\n'));
  check('★★★★★ 開季前檢查清單的違反行不印規則代號',
    !/v\.ruleId/.test(read('src/PreLaunchChecklist.gs').replace(/^\s*\/\/.*$/gm, '')), '');
}

console.log(fail === 0 ? '\nOK' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
