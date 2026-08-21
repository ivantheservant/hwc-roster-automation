// 第四十一輪批次 F 組：PDF 只印職事表本身 ＋ 欄寬配合 A4。
// 執行方式：node tests/pdf_roster_only_and_widths.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 實測：
//   「個人專屬連結、PDF……只要職事表本身就夠。
//     不需要『圖例（本季實際格數）』、『本季服侍次數統計』。」
//   「欄位收縮了、撐不夠闊……配合 A4 印得出。」
//
// ⚠️ 做法係**匯出嗰陣截住**，唔係唔寫入 grid。
// 嗰兩段喺試算表上係有用嘅（幹事自己核對格數、核對邊個做得多），
// 淨係印俾義工嗰一份唔需要。唔寫入嘅話，佢連自己想睇嗰陣都睇唔到
// ——嗰個係攞走一樣佢而家有嘅嘢。
//
// ⚠️ 最核心嗰一條：**寧可多印，不可以少印。**
// 兩段標題都搵唔到（例如 GRID_SHOW_LEGEND 關咗、或者係一張舊表）
// 就唔截。少印一個主日係一個冇人睇得出嘅錯；多印一段圖例只係唔靚。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'PdfExport.gs', 'RosterWriter.gs'
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

const ROOT = path.join(__dirname, '..');
const pdf = fs.readFileSync(path.join(ROOT, 'src', 'PdfExport.gs'), 'utf8');
const writer = fs.readFileSync(path.join(ROOT, 'src', 'RosterWriter.gs'), 'utf8');
const seed = fs.readFileSync(path.join(ROOT, 'src', 'ConfigSeed.gs'), 'utf8');
const bare = function (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};
const pdfBare = bare(pdf);
const writerBare = bare(writer);

/**
 * 一張假嘅 grid 工作表：只實作 `findRosterGridLastRow_()` 用到嗰兩個方法。
 * FIXTURE-OK：呢個唔係「系統寫入嘅資料」，係一個純讀取函式嘅輸入替身；
 * 而第一欄嘅內容係直接由 `GRID_LABELS` 攞，唔係手抄。
 */
function fakeSheet(colA) {
  return {
    getLastRow: function () { return colA.length; },
    getRange: function (row, col, numRows) {
      return {
        getValues: function () {
          const out = [];
          for (let i = 0; i < numRows; i++) out.push([colA[row - 1 + i]]);
          return out;
        }
      };
    }
  };
}

const LEGEND = gas.GRID_LABELS.LEGEND_TITLE;
const STATS = gas.GRID_LABELS.STATS_TITLE;

// =====================================================================
console.log('\n=== F【核心】印到邊一行為止 ===');
{
  // 標題、機器鍵、三個主日、空行、圖例、兩行圖例、空行、統計⋯⋯
  const sheet = fakeSheet([
    '日期', 'date', '2027-01-03', '2027-01-10', '2027-01-17',
    '', LEGEND, '（待填）', '⚠ 未能安排', '', STATS, '測試甲'
  ]);
  checkEqual('★★★★★ 印到最後一個主日為止（第 5 行）'
    + '——多一行就會印到嗰行空白，少一行就會漏咗一個主日',
    gas.findRosterGridLastRow_(sheet), 5);
}

{
  // 冇圖例，直接跳到統計（`GRID_SHOW_LEGEND` 關咗嗰陣就係噉）
  const sheet = fakeSheet([
    '日期', 'date', '2027-01-03', '2027-01-10', '', STATS, '測試甲'
  ]);
  checkEqual('★★★★★ 只有統計都截得到（圖例可以由 Config 關掉）',
    gas.findRosterGridLastRow_(sheet), 4);
}

{
  const sheet = fakeSheet([
    '日期', 'date', '2027-01-03', LEGEND, '（待填）'
  ]);
  checkEqual('★★★★ 冇空行分隔都截得到', gas.findRosterGridLastRow_(sheet), 3);
}

console.log('\n=== F【核心】搵唔到 ⇒ 唔截。寧可多印，不可以少印 ===');
{
  // ⚠️ 少印一個主日係一個冇人睇得出嘅錯——PDF 上淨係少咗一行，
  // 而幹事唔會逐行數。多印一段圖例只係唔靚，一眼就見到。
  const noMarkers = fakeSheet([
    '日期', 'date', '2027-01-03', '2027-01-10', '2027-01-17'
  ]);
  checkEqual('★★★★★ 兩段標題都搵唔到 ⇒ 回 0（唔截）',
    gas.findRosterGridLastRow_(noMarkers), 0);

  checkEqual('★★★★★ 一張空表 ⇒ 回 0，唔可以回一個負數或者 1'
    + '（`r2=0` 會變成一份完全空白嘅 PDF）',
    gas.findRosterGridLastRow_(fakeSheet(['日期', 'date'])), 0);

  const legendAtTop = fakeSheet(['日期', 'date', LEGEND, '（待填）']);
  checkEqual('★★★★★ 一個主日都冇（圖例緊接住機器鍵行）⇒ 回 0，唔截'
    + '——截到第 2 行嘅話，出嚟係一份得標題冇內容嘅 PDF',
    gas.findRosterGridLastRow_(legendAtTop), 0);
}

console.log('\n=== F【核心】Config 關咗就完全唔截 ===');
{
  const src = pdfBare.slice(pdfBare.indexOf('function resolveRosterOnlyExportOpts_'));
  const body = src.slice(0, src.indexOf('\n}'));
  check('★★★★★ 讀 `PDF_ROSTER_ONLY`，唔係 true 就回 undefined'
    + '（回 undefined ＝ `exportSheetAsPdfBlob_()` 一個參數都唔加，'
    + '即係同今日一模一樣）',
    /getConfig\(CONFIG_KEYS\.PDF_ROSTER_ONLY, DEFAULTS\.PDF_ROSTER_ONLY\) !== true/.test(body)
      && /return undefined;/.test(body), body.slice(0, 400));
  check('★★★★★ 而且 `findRosterGridLastRow_()` 回 0 嗰陣都回 undefined'
    + '——傳 `{lastRow: 0}` 落去會變成 `r2=0`，即係一份空白 PDF',
    /if \(lastRow <= 0\) return undefined;/.test(body), body.slice(0, 400));
  check('★★★★ 預設係開（Ivan 直接要求，唔係推論）',
    gas.DEFAULTS.PDF_ROSTER_ONLY === true, String(gas.DEFAULTS.PDF_ROSTER_ONLY));
  check('★★★★ Config 表有呢一個 key，而且改得',
    /key: CONFIG_KEYS\.PDF_ROSTER_ONLY[\s\S]{0,400}editable: 'TRUE'/.test(seed), '');
  check('★★★★★ 而且個說明講明嗰兩段仲會寫喺試算表上'
    + '——唔講嘅話，幹事會以為系統唔再計圖例同統計',
    /那兩段仍然會寫在試算表的職事表上/.test(seed), '');
}

console.log('\n=== F【核心】匯出網址嘅範圍參數 ===');
{
  const src = pdfBare.slice(pdfBare.indexOf('function exportSheetAsPdfBlob_'));
  const body = src.slice(0, src.indexOf('\n}'));
  check('★★★★★ `r1` 由 0 起（0-based）', /rangeParams\.push\('r1=0'\)/.test(body), '');
  check('★★★★★ `r2` 就係 lastRow（右邊開區間，所以唔使加一）'
    + '——差一格就會少印最後一個主日，而 PDF 上完全睇落正常',
    /rangeParams\.push\('r2=' \+ Math\.floor\(lastRow\)\)/.test(body), '');
  check('★★★★★ 冇傳 opts ⇒ 一個範圍參數都唔加',
    /const lastRow = Number\(opts && opts\.lastRow\);/.test(body)
      && /if \(lastRow > 0\) \{/.test(body), body.slice(0, 600));
  check('★★★★ 範圍參數係接落原本嗰串後面，唔係取代',
    /\]\.concat\(rangeParams\)\.join\('&'\)/.test(body), '');
}

console.log('\n=== F【核心】兩條 PDF 路都要有，而且讀同一個判斷 ===');
{
  // ⚠️ 各自讀一次 Config 嘅話，日後有人只改咗其中一條，就會出現
  // 「個人版冇圖例而整季版有」，而幹事會以為系統壞咗。
  check('★★★★★ 整季版有',
    /exportSheetAsPdfBlob_\(sheet, fileName, resolveRosterOnlyExportOpts_\(sheet\)\)/
      .test(pdfBare), '');
  check('★★★★★ 個人版有',
    /exportSheetAsPdfBlob_\(ctx\.tempSheet, fileName, ctx\.rosterOnlyOpts\)/.test(pdfBare), '');
  check('★★★★★ 而且個人版係喺開 context 嗰陣算一次，唔係逐個人掃一次第一欄'
    + '——幾十位收件人就係幾十次讀表，而嗰條路本來已經接近執行上限',
    /rosterOnlyOpts: resolveRosterOnlyExportOpts_\(tempSheet\)/.test(pdfBare), '');
  checkEqual('★★★★★ 只有一個地方讀呢個 Config key',
    (pdfBare.match(/CONFIG_KEYS\.PDF_ROSTER_ONLY/g) || []).length, 1);
}

// =====================================================================
console.log('\n=== F【核心】欄寬配合 A4 ===');
{
  check('★★★★★ 週次最窄',
    gas.GRID_WIDTH_WEEK < gas.GRID_WIDTH_TYPE
      && gas.GRID_WIDTH_WEEK < gas.GRID_WIDTH_NAME
      && gas.GRID_WIDTH_WEEK < gas.GRID_WIDTH_DATE,
    JSON.stringify([gas.GRID_WIDTH_WEEK, gas.GRID_WIDTH_TYPE,
      gas.GRID_WIDTH_NAME, gas.GRID_WIDTH_DATE]));
  check('★★★★★ 人名欄闊過週次同類型'
    + '——Ivan 講嘅「撐不夠闊」講嘅就係人名嗰幾欄',
    gas.GRID_WIDTH_NAME > gas.GRID_WIDTH_WEEK, '');
  // ⚠️ 第四十三輪批次 C3：日期改成顯示 `MM-DD`，所以嗰欄窄得多，
  // 而慳返嘅位全部俾咗人名欄——Ivan 兩次都講人名欄唔夠闊。
  check('★★★★★ 日期欄放得落 `01-03`（五個字元）',
    gas.GRID_WIDTH_DATE >= 46 && gas.GRID_WIDTH_DATE <= 70,
    String(gas.GRID_WIDTH_DATE));
  check('★★★★★ 而且顯示格式係唔含年份嘅 `MM-dd`'
    + '——一張職事表只涵蓋一季，年份重複十三次淨係浪費嗰欄嘅闊度',
    gas.GRID_DATE_FORMAT === 'MM-dd', gas.GRID_DATE_FORMAT);
  check('★★★★★ 人名欄放得落**四個**中文字（Ivan 兩次都提，要一行顯示得完）',
    gas.GRID_WIDTH_NAME >= 72, String(gas.GRID_WIDTH_NAME));
  check('★★★★★ 而且人名欄比日期欄闊'
    + '——上一輪最大嘅問題就係位俾咗日期，而人名縮到三個字都放唔落',
    gas.GRID_WIDTH_NAME > gas.GRID_WIDTH_DATE, '');
}

console.log('\n=== F：設欄寬嗰個函式本身 ===');
{
  const src = writerBare.slice(writerBare.indexOf('function applyGridColumnWidthsForA4_'));
  const body = src.slice(0, src.indexOf('\n}'));
  check('★★★★★ 前三欄逐欄設', /setColumnWidth\(1, GRID_WIDTH_DATE\)/.test(body)
    && /setColumnWidth\(2, GRID_WIDTH_WEEK\)/.test(body)
    && /setColumnWidth\(3, GRID_WIDTH_TYPE\)/.test(body), body.slice(0, 400));
  check('★★★★★ 第 4 欄起一次過設（唔係逐欄叫一次——二十幾個崗位就係二十幾次寫）',
    /setColumnWidths\(4, nameColumnCount, GRID_WIDTH_NAME\)/.test(body), '');
  check('★★★★★ 一個崗位都冇嗰陣唔可以叫 `setColumnWidths(4, 0, ...)`'
    + '（`numColumns` 係 0 會拋錯，而嗰個會令整個建立版本失敗）',
    /if \(nameColumnCount > 0\)/.test(body), '');
  check('★★★★★ 一格資料都冇改（呢個函式只可以碰格式）',
    !/setValues?\(/.test(body), body.slice(0, 600));
  // ⚠️ 第四十三輪批次 C3 反轉咗呢一條：Ivan 明講「人名欄要闊到中文名
  // 一行顯示得完，**不換行**」。換行會令整行變高兩倍，
  // 一頁 A4 就印唔落八個主日——而印唔落係一個佢即刻見到嘅問題。
  check('★★★★★ 人名欄**唔換行**（改為靠闊度解決）',
    /setWrap\(false\)/.test(body), body.slice(0, 600));
  // ⚠️ 呢一條係因為註解寫住「失敗唔可以令建立版本失敗——見呼叫端嘅 try/catch」，
  // 而第一次寫嗰陣呼叫端根本冇 try/catch。一句講住有防守而實際冇嘅註解，
  // 比冇註解更差：下一個人會信佢，然後喺上面繼續起樓。
  check('★★★★★ 呼叫端真係有 try/catch'
    + '——欄寬只係「印出嚟好唔好睇」，唔可以令一張已經排好嘅職事表整個失敗',
    /try \{\s*\n\s*applyGridColumnWidthsForA4_\(sheet, layout\);\s*\n\s*\} catch/
      .test(writerBare), '');
  check('★★★★ 但唔可以靜靜失敗——要寫 log',
    /log_\('WARN', 'createRosterSheet：欄寬設定唔到/.test(writer), '');
  check('★★★★★ 排喺 `autoResizeColumns()` **之後**'
    + '——排之前嘅話，autoResize 會即刻把佢設嘅寬度改返',
    writerBare.indexOf('sheet.autoResizeColumns(1, layout.keys.length);')
      < writerBare.indexOf('applyGridColumnWidthsForA4_(sheet, layout);'), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
