// 第六十二輪批次 B 組：亂行機嘅步數計錯，Ivan 永遠撳唔到 50/50。
// 執行方式：node tests/monkey_total_steps.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（由試算表直接讀到）
// ═════════════════════════════════════════════════════════════════════
//
//   時間　　已抽次數　已跑步數
//   早前　　10　　　　2
//   之後　　32　　　　4
//   而家　　70　　　　3   ← 跌返落去
//
// 已抽次數一路加（證明隨機序列真係接住走），但「已跑步數」由 4 跌到 3。
//
// 成因：`writeMonkeyState_()` 寫落表嗰個係 `report.ranSteps`——
// **當前呢一批**跑咗幾多步——而 `readMonkeyState_()` 由頭到尾冇讀返佢。
// 而報告第一句「跑了 N / 50 步」用嘅就係呢個會歸零嘅數。
//
// ⇒ 撳幾多次，分子都只會喺 2–4 之間浮動，永遠去唔到 50。
//
// ⚠️ 底層一直有進展：最新一批三步係「寄堂委審閱（模擬，dryRun:3）
// → 改 grid 1 格 → 儲存並確認造出 v7」，同上一批完全唔同，
// 季度已行到 v7，全程零不變量失敗。
//
// **唔係部機器唔郁，係個計數器呃人。**
// 而一個會歸零嘅進度計數器比冇計數器更差——
// 佢會令人以為部機器打緊轉，然後放棄。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/MonkeyRun.gs'), 'utf8');

const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'SeasonRehearsal.gs', 'QuarterReset.gs',
  'SelfTestRunner.gs', 'Invariants.gs', 'MonkeyRun.gs'];

/**
 * 一張夠用嘅假工作表（`appendRow` / `getRange` / `clear` / `deleteRows`）。
 *
 * ⚠️ 特登唔用 fixture，直接記住每一次寫入——「log 有冇被覆寫」
 * 呢件事，只有睇實際留低咗幾多行先驗得到。
 */
function fakeSheet(name) {
  const rows = [];
  const api = {
    name: name,
    rows: rows,
    appendRow: function (r) { rows.push(r.slice()); },
    clear: function () { rows.length = 0; },
    setFrozenRows: function () {},
    getLastRow: function () { return rows.length; },
    getLastColumn: function () {
      return rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    },
    deleteRows: function (start, howMany) { rows.splice(start - 1, howMany); },
    getRange: function (r, c, nr, nc) {
      return {
        getValues: function () {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = rows[r - 1 + i] || [];
            const cells = [];
            for (let j = 0; j < nc; j++) cells.push(row[c - 1 + j]);
            out.push(cells);
          }
          return out;
        }
      };
    }
  };
  return api;
}

/**
 * 造一個 GAS 沙箱，`SpreadsheetApp` 回一批假工作表。
 *
 * @param {Object} sheets `{名: fakeSheet}`
 * @returns {Object} gas
 */
function withSheets(sheets) {
  const gas = loadGasSource(FILES);
  gas.log_ = function () {};
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (n) { return sheets[n] || null; },
        insertSheet: function (n) { sheets[n] = fakeSheet(n); return sheets[n]; }
      };
    }
  };
  return gas;
}

// =====================================================================
console.log('\n=== B1【核心】兩批各 3 步 ⇒ 累計 6 步 ===');
{
  const sheets = {};
  const gas = withSheets(sheets);

  // 第一批：由頭開始（priorSteps 冇傳 ＝ 0）。
  const one = {
    seed: 7, quarterId: '2028T3', drawnCount: 9,
    priorSteps: 0, totalSteps: 3, ranSteps: 3,
    steps: [{ step: 1, action: 'A', outcome: 'o1', invariant: 'OK' },
      { step: 2, action: 'B', outcome: 'o2', invariant: 'OK' },
      { step: 3, action: 'C', outcome: 'o3', invariant: 'OK' }]
  };
  gas.writeMonkeyLog_(one);
  gas.writeMonkeyState_(one);

  const afterOne = gas.readMonkeyState_();
  checkEqual('★★★★★★ 第一批之後，累計 ＝ 3', afterOne.totalSteps, 3);
  checkEqual('★★★★★ 種子同抽數都讀得返', afterOne.seed + '/' + afterOne.drawnCount,
    '7/9');

  // 第二批：續跑，帶住上一批嘅累計。
  const two = {
    seed: 7, quarterId: '2028T3', drawnCount: 21,
    priorSteps: 3, totalSteps: 6, ranSteps: 3,
    steps: [{ step: 4, action: 'D', outcome: 'o4', invariant: 'OK' },
      { step: 5, action: 'E', outcome: 'o5', invariant: 'OK' },
      { step: 6, action: 'F', outcome: 'o6', invariant: 'OK' }]
  };
  gas.writeMonkeyLog_(two);
  gas.writeMonkeyState_(two);

  const afterTwo = gas.readMonkeyState_();
  checkEqual('★★★★★★ **第二批之後，累計 ＝ 6（唔係跌返做 3）**'
    + '——舊寫法寫落表嗰個係當前批次嘅步數，'
    + '所以撳幾多次分子都喺 2–4 之間浮動，永遠去唔到 50',
    afterTwo.totalSteps, 6);
  checkEqual('★★★★★ 抽數一路加（本來就啱，唔可以改壞咗）',
    afterTwo.drawnCount, 21);
}

// =====================================================================
console.log('\n=== B2【核心】`MonkeyLog` 唔可以每批覆寫 ===');
{
  const sheets = {};
  const gas = withSheets(sheets);
  const batch = function (prior, nos) {
    return {
      seed: 7, quarterId: '2028T3', drawnCount: 9,
      priorSteps: prior, totalSteps: prior + nos.length, ranSteps: nos.length,
      steps: nos.map(function (n) {
        return { step: n, action: 'A' + n, outcome: 'o' + n, invariant: 'OK' };
      })
    };
  };
  gas.writeMonkeyLog_(batch(0, [1, 2, 3]));
  gas.writeMonkeyLog_(batch(3, [4, 5, 6]));

  const log = sheets.MonkeyLog.rows;
  checkEqual('★★★★★★ **表頭 1 行 ＋ 6 行資料**'
    + '——舊寫法第一句就係 `sheet.clear()`，'
    + '所以續跑之後成張 log 只剩當前嗰一批（實測讀到得 3 行）',
    log.length, 7);
  checkEqual('★★★★★★ **步號係 1–6（累計），唔係 1–3 再 1–3**',
    log.slice(1).map(function (r) { return r[0]; }).join(','), '1,2,3,4,5,6');
  checkEqual('★★★★★ 表頭係新格式',
    log[0].join('|'), gas.MONKEY_LOG_HEADERS.join('|'));
  checkEqual('★★★★★ 每行都自帶種子同季度'
    + '——append 之後表頭嗰行講唔到「呢一行係邊一批」',
    log[6][4] + '/' + log[6][5], '7/2028T3');
}

// =====================================================================
console.log('\n=== B2 由頭開始跑 ⇒ 要清走舊 log（新一條路）===');
{
  const sheets = {};
  const gas = withSheets(sheets);
  gas.writeMonkeyLog_({ seed: 7, quarterId: '2028T3', priorSteps: 0,
    steps: [{ step: 1, action: 'A', outcome: 'o', invariant: 'OK' }] });
  gas.writeMonkeyLog_({ seed: 99, quarterId: '2028T3', priorSteps: 0,
    steps: [{ step: 1, action: 'Z', outcome: 'o', invariant: 'OK' }] });
  const log = sheets.MonkeyLog.rows;
  checkEqual('★★★★★★ 換咗種子由頭跑 ⇒ 只剩新嗰一批（表頭 ＋ 1 行）',
    log.length, 2);
  checkEqual('★★★★★ 而且係新嗰批', log[1][1], 'Z');
}

// =====================================================================
console.log('\n=== B2 有上限，超過由最舊剪起 ===');
{
  // ⚠️ append 而冇上限，跑得耐就會撐爆張表。
  const sheets = {};
  const gas = withSheets(sheets);
  const cap = gas.MONKEY_LOG_MAX_ROWS;
  check('★★★★★ 上限係一個合理嘅數（' + cap + '）',
    cap >= 100 && cap <= 10000, String(cap));

  const many = [];
  for (let n = 1; n <= cap + 25; n++) {
    many.push({ step: n, action: 'A' + n, outcome: 'o', invariant: 'OK' });
  }
  gas.writeMonkeyLog_({ seed: 7, quarterId: '2028T3', priorSteps: 0,
    steps: many });
  const log = sheets.MonkeyLog.rows;
  checkEqual('★★★★★★ 表頭 ＋ 剛好 ' + cap + ' 行', log.length, cap + 1);
  checkEqual('★★★★★★ **剪走嘅係最舊嗰啲**'
    + '——剪最新嘅話，等於一跑滿就再冇最近嘅紀錄',
    log[1][0] + '…' + log[log.length - 1][0], 26 + '…' + (cap + 25));
}

// =====================================================================
console.log('\n=== B1 讀舊表：照欄名搵，唔照位置 ===');
{
  // ⚠️ 舊表第 3 欄叫「已跑步數」（只計當前批次）。照位置讀嘅話，
  // 一張舊表會被當成「累計已經跑咗 3 步」——而嗰個 3 係批次數。
  // 一個講錯咗嘅數字比冇數字更差，所以搵唔到就當 0。
  const sheets = { MonkeyState: fakeSheet('MonkeyState') };
  sheets.MonkeyState.appendRow(['種子', '已抽次數', '已跑步數', '季度']);
  sheets.MonkeyState.appendRow([70, 70, 3, '2028T3']);
  const gas = withSheets(sheets);
  const state = gas.readMonkeyState_();
  checkEqual('★★★★★★ 種子同抽數照樣讀得返（舊表都有呢兩欄）',
    state.seed + '/' + state.drawnCount, '70/70');
  checkEqual('★★★★★★ **累計步數 ＝ 0（唔係當「已跑步數」係累計）**'
    + '——嗰個 3 係上一批嘅批次數，唔係累計；猜嘅話就係一個講錯咗嘅數字',
    state.totalSteps, 0);
}

// =====================================================================
console.log('\n=== B1 欄序調亂都要讀得啱 ===');
{
  const sheets = { MonkeyState: fakeSheet('MonkeyState') };
  sheets.MonkeyState.appendRow(['季度', '累計步數', '種子', '已抽次數']);
  sheets.MonkeyState.appendRow(['2028T3', 12, 7, 45]);
  const gas = withSheets(sheets);
  const state = gas.readMonkeyState_();
  checkEqual('★★★★★★ 照欄名搵，唔係照位置',
    [state.seed, state.drawnCount, state.totalSteps].join('/'), '7/45/12');
}

// =====================================================================
console.log('\n=== B1 冇紀錄 ⇒ 全部 0，唔可以爆 ===');
{
  const gas = withSheets({});
  const state = gas.readMonkeyState_();
  checkEqual('★★★★★ 冇張表 ⇒ 全部 0',
    [state.seed, state.drawnCount, state.totalSteps].join('/'), '0/0/0');
}

// =====================================================================
console.log('\n=== B1 寫落表嗰個要係累計，唔係當前批次 ===');
{
  const sheets = {};
  const gas = withSheets(sheets);
  gas.writeMonkeyState_({ seed: 7, drawnCount: 70, ranSteps: 3,
    totalSteps: 10, quarterId: '2028T3' });
  const row = sheets.MonkeyState.rows[1];
  checkEqual('★★★★★★ **第 3 格 ＝ 10（累計），唔係 3（呢一批）**'
    + '——就係呢一格寫錯咗，令個分子每批歸零',
    row[2], 10);
  checkEqual('★★★★★ 表頭跟住改咗名',
    sheets.MonkeyState.rows[0].join('|'), gas.MONKEY_STATE_HEADERS.join('|'));
}

// =====================================================================
console.log('\n=== B3【核心】報告要分開講「這一批」同「累計」 ===');
{
  const gas = loadGasSource(FILES);
  const lines = gas.describeMonkeyReport_({
    blocked: false, quarterId: '2028T3', seed: 20260825,
    ranSteps: 3, requestedSteps: 50,
    priorSteps: 7, totalSteps: 10, firstStepNo: 8, lastStepNo: 10,
    totalMs: 252000, actionMs: 12000, invariantMs: 240000,
    fullSweepCount: 1, tailSweepStep: 10, fastInvariantIds: ['I01', 'I05'],
    skipSlow: false, skippedSlow: [],
    spinning: null, noLegalAction: null, stoppedForTime: false,
    failures: [], path: ['A', 'B', 'C'], steps: []
  }).join('\n');

  check('★★★★★★ **第一句用累計（10 / 50），唔係當前批次（3 / 50）**'
    + '——舊寫法就係喺呢一句用咗會歸零嗰個數，'
    + '於是撳幾多次都係 2、4、3，睇落好似原地踏步',
    /亂行機：累計 10 \/ 50 步/.test(lines), lines.slice(0, 400));
  check('★★★★★★ 而且另外一句講「這一批」，連步號範圍',
    /這一批：跑了 3 步（第 8 – 10 步）/.test(lines), lines.slice(0, 400));
  check('★★★★★★ 時間用「X 分 Y 秒」，唔使自己心算',
    /用了 4 分 12 秒/.test(lines), lines.slice(0, 400));
  check('★★★★★ 平均每步都印',
    /平均每步 84 秒/.test(lines), lines.slice(0, 400));
  check('★★★★★★ 失敗數講明係「這一批」'
    + '——唔講明嘅話，一個累計 10 步而今批 0 失敗嘅報告，'
    + '會被當成「10 步都冇失敗過」',
    /項失敗（這一批）/.test(lines), lines.slice(0, 400));
}

// =====================================================================
console.log('\n=== B3 第一批（累計 ＝ 批次）都要讀得順 ===');
{
  const gas = loadGasSource(FILES);
  const lines = gas.describeMonkeyReport_({
    blocked: false, quarterId: '2028T3', seed: 7,
    ranSteps: 2, requestedSteps: 50,
    priorSteps: 0, totalSteps: 2, firstStepNo: 1, lastStepNo: 2,
    totalMs: 30000, actionMs: 5000, invariantMs: 25000,
    fullSweepCount: 1, tailSweepStep: 0, fastInvariantIds: [],
    skipSlow: false, skippedSlow: [],
    spinning: null, noLegalAction: null, stoppedForTime: false,
    failures: [], path: [], steps: []
  }).join('\n');
  check('★★★★★ 累計 2 / 50', /亂行機：累計 2 \/ 50 步/.test(lines),
    lines.slice(0, 300));
  check('★★★★★ 一分鐘以內仍然用秒', /用了 30\.0 秒/.test(lines),
    lines.slice(0, 300));
}

// =====================================================================
console.log('\n=== B1 步號真係跨批續落去（跑一次真迴圈）===');
{
  const gas = loadGasSource(FILES);
  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: '2028T3', source: '（測試寫死）' };
  };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.assertMonkeyDryRunStillOn_ = function () {};
  gas.writeMonkeyLog_ = function () {};
  gas.readConfig = function () { return {}; };
  gas.getConfig = function (key, dflt) { return dflt; };
  gas.runAllInvariants_ = function () { return { results: [] }; };
  let n = 0;
  gas.monkeyReadFacts_ = function () {
    n++;
    return { hasVersion: true, latestVersionNo: n, stage: 'DRAFT',
      gridChangeCount: 0, unresolvedCount: 0,
      buttons: { review: { enabled: false }, official: { enabled: false },
        resend: { enabled: false } } };
  };
  gas.monkeyActions_ = function () {
    return [{ id: 'X', legal: function () { return true; },
      run: function () { return {}; } }];
  };

  const first = gas.runMonkey_(3, 7, 0);
  const second = gas.runMonkey_(3, 7, first.drawnCount, first.totalSteps);

  checkEqual('★★★★★★ 第一批：步號 1,2,3',
    first.steps.map(function (s) { return s.step; }).join(','), '1,2,3');
  checkEqual('★★★★★★ **第二批：步號 4,5,6（唔係再由 1 開始）**',
    second.steps.map(function (s) { return s.step; }).join(','), '4,5,6');
  checkEqual('★★★★★★ **累計 ＝ 6**', second.totalSteps, 6);
  checkEqual('★★★★★ 而「這一批」仍然係 3', second.ranSteps, 3);
  checkEqual('★★★★★ 步號範圍講得啱',
    second.firstStepNo + '–' + second.lastStepNo, '4–6');
}

// =====================================================================
console.log('\n=== 原始碼形狀 ===');
{
  check('★★★★★★ `writeMonkeyState_()` 寫 `totalSteps`，唔係 `ranSteps`',
    /report\.totalSteps,\n\s*report\.quarterId\]\)/.test(SRC)
      && !/report\.drawnCount, report\.ranSteps/.test(SRC), '');
  check('★★★★★★ **`writeMonkeyLog_()` 唔再無條件 `clear()`**',
    /const freshRun = Number\(report\.priorSteps \|\| 0\) === 0;/.test(SRC), '');
  check('★★★★★ 而且有剪最舊嗰段',
    /sheet\.deleteRows\(2, dataRows - MONKEY_LOG_MAX_ROWS\);/.test(SRC), '');
  check('★★★★★★ `readMonkeyState_()` 照欄名搵',
    /const at = headers\.indexOf\(name\);/.test(SRC), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
