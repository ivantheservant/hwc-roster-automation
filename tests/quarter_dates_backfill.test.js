// 第四十四輪批次 G 組：季度日期——年度工具會填，而且補得返舊嗰啲。
// 執行方式：node tests/quarter_dates_backfill.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 用「產生下一年度四個季度」開咗 2028 年四季，然後喺主流程見到：
//
//     這一季的 Quarters 沒有填生成日期（GenerateOn），
//     所以系統講不出還有多久。
//
// 舊設計係「一律留空，之後跑『計算季度日期』逐季補」，而預覽度仲有
// 一句提醒。**但佢冇跑。** 一句提醒抵唔過一個唔會有人做嘅步驟。
//
// 而且 `OfficialSendOn` 空白唔只係「畫面講唔出仲有幾耐」——
// GENERATE／REMIND 範本嘅 `{OfficialSendDate}` 會喺信入面顯示空白，
// 而嗰個係**信寄咗出去先發現**。
//
// 呢一份守三件事：
//   一、年度工具算得到就寫落去，算唔到就明講原因（**唔可以當成 0**）。
//   二、`computeQuarterDateFromLead_()` 係唯一嗰條算式（本來抄咗三份）。
//   三、已經開咗而冇日期嘅季度（Ivan 手上 2028T1～T4）補得返。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(
  ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Trigger.gs', 'QuarterStage.gs',
    'NewQuarterWizard.gs', 'AnnualQuarters.gs'],
  {
    Utilities: {
      formatDate: function (date, tz, fmt) {
        const iso = new Date(date).toISOString();
        return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
      }
    }
  });

// =====================================================================
console.log('\n=== G【核心】唯一嗰條算式：未設定 ⇒ 空白，**唔係 0** ===');
{
  const f = gas.computeQuarterDateFromLead_;
  check('★★★★★ 正常值算得啱（-35 日）',
    f('2028-01-01', -35, 'NONE') === '2027-11-27', f('2028-01-01', -35, 'NONE'));
  check('★★★★★ **`null` ⇒ 空白**'
    + '——`Number(null)` 係 0 唔係 NaN；淨靠 `isNaN()` 擋，'
    + '「未設定」就會變成「提早 0 日」＝ 開季當日，即係「到咗先生成」',
    f('2028-01-01', null, 'NONE') === '', f('2028-01-01', null, 'NONE'));
  check('★★★★★ **空字串 ⇒ 空白**（Config 嗰格得個空白就係呢種）',
    f('2028-01-01', '', 'NONE') === '', f('2028-01-01', '', 'NONE'));
  check('★★★★ `undefined` ⇒ 空白', f('2028-01-01', undefined, 'NONE') === '');
  check('★★★★ 打錯字（唔係數字）⇒ 空白', f('2028-01-01', 'abc', 'NONE') === '');
  check('★★★★ 冇 StartDate ⇒ 空白', f('', -35, 'NONE') === '');
  check('★★★★ 0 真係填 0 嗰陣照計（明明白白填咗 0 係一個決定）',
    f('2028-01-01', 0, 'NONE') === '2028-01-01');
}

// =====================================================================
console.log('\n=== G 呢條算式全專案只寫一次（本來抄咗三份）===');
{
  const files = ['src/QuarterStage.gs', 'src/NewQuarterWizard.gs',
    'src/AnnualQuarters.gs', 'src/Trigger.gs'];
  let raw = 0;
  files.forEach(function (rel) {
    const body = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    raw += (body.match(/applyWeekdayGuard_\(shiftDateString_\(/g) || []).length;
  });
  check('★★★★★ `applyWeekdayGuard_(shiftDateString_(…))` 只出現一次'
    + '——三份之中改一份，另外兩份就會靜靜算出另一個日期，'
    + '而「自動排程今日會唔會跑」正正靠呢個值',
    raw === 1, 'count=' + raw);
  check('★★★★★ `NewQuarterWizard.gs` 改用共用嗰個',
    /computeQuarterDateFromLead_\(startDate, leadGenerate, guardMode\)/
      .test(read('src/NewQuarterWizard.gs')), '');
  check('★★★★★ `planComputeQuarterDates_()` 一樣',
    /const computedValue = computeQuarterDateFromLead_\(/
      .test(read('src/QuarterStage.gs')), '');
}

// =====================================================================
console.log('\n=== G【核心】年度工具算得出兩個日期，而且寫得入 Quarters ===');
{
  const CAL = { 1: 1, 2: 4, 3: 7, 4: 10 };
  const plans = gas.planAnnualQuarters_(2028, CAL, {}, {},
    { leadGenerate: -35, leadOfficial: -28, guardMode: 'NONE' });

  check('★★★★★ 四季都算到生成日期',
    plans.every(function (p) { return !!p.generateOn; }),
    JSON.stringify(plans.map(function (p) { return p.generateOn; })));
  check('★★★★★ 四季都算到正式發出日期',
    plans.every(function (p) { return !!p.officialSendOn; }),
    JSON.stringify(plans.map(function (p) { return p.officialSendOn; })));
  check('★★★★★ 2028T1 開季 2028-01-01 ⇒ 生成 2027-11-27（提早 35 日）',
    plans[0].generateOn === '2027-11-27', plans[0].generateOn);
  check('★★★★★ 而且正式發出 2027-12-04（提早 28 日）',
    plans[0].officialSendOn === '2027-12-04', plans[0].officialSendOn);

  // ── 真係寫落張表 ────────────────────────────────────────
  const written = { quarters: [] };
  const headers = ['QuarterID', 'Year', 'Term', 'StartDate', 'EndDate',
    'WeekCount', 'GenerateOn', 'OfficialSendOn', 'Stage'];
  function fakeSheet(store) {
    return {
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return 2 + store.length; },
      getRange: function (row, col, numRows) {
        return {
          getValues: function () { return [headers]; },
          setValues: function (rows) { rows.forEach(function (r) { store.push(r); }); }
        };
      }
    };
  }
  const sdStore = [];
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) {
          return name === gas.SHEETS.QUARTERS
            ? fakeSheet(written.quarters) : fakeSheet(sdStore);
        }
      };
    }
  };
  const result = gas.executeAnnualQuarters_(plans);
  check('★★★★ 四季都寫咗', result.quartersWritten === 4, JSON.stringify(result));

  const gIdx = headers.indexOf('GenerateOn');
  const oIdx = headers.indexOf('OfficialSendOn');
  check('★★★★★ **`GenerateOn` 真係入咗張表**'
    + '——舊行為係一律留空，而幹事唔會記得跑「計算季度日期」補',
    written.quarters[0][gIdx] === '2027-11-27',
    JSON.stringify(written.quarters[0]));
  check('★★★★★ `OfficialSendOn` 一樣'
    + '——佢空白會令 GENERATE／REMIND 範本嘅 {OfficialSendDate} '
    + '喺信入面顯示空白，而嗰個係信寄咗出去先發現',
    written.quarters[0][oIdx] === '2027-12-04',
    JSON.stringify(written.quarters[0]));
  check('★★★★ 四行都有',
    written.quarters.every(function (r) { return r[gIdx] && r[oIdx]; }),
    JSON.stringify(written.quarters.map(function (r) { return r[gIdx]; })));
}

// =====================================================================
console.log('\n=== G 前置日數未填 ⇒ 兩格留空（唔可以當成開季當日）===');
{
  const CAL = { 1: 1, 2: 4, 3: 7, 4: 10 };
  const plans = gas.planAnnualQuarters_(2028, CAL, {}, {},
    { leadGenerate: null, leadOfficial: null, guardMode: 'NONE' });
  check('★★★★★ 兩格都係空白',
    plans.every(function (p) { return p.generateOn === '' && p.officialSendOn === ''; }),
    JSON.stringify(plans.map(function (p) { return [p.generateOn, p.officialSendOn]; })));
  check('★★★★★ **唔係開季當日**'
    + '——「提早 0 日」睇落好合理，而佢代表「到咗先生成」，'
    + '幹事永遠唔會察覺自己遲咗 35 日',
    plans[0].generateOn !== plans[0].startDate, '');
}

// =====================================================================
console.log('\n=== G 漏傳 `dateSettings` ⇒ 拋錯，唔可以靜靜留空 ===');
{
  const CAL = { 1: 1, 2: 4, 3: 7, 4: 10 };
  let msg = null;
  try { gas.planAnnualQuarters_(2028, CAL, {}, {}); } catch (e) { msg = e.message; }
  check('★★★★★ 有拋錯'
    + '——靜靜留空正正就係呢一組要修嘅嘢；一個「漏傳就回舊行為」嘅預設值，'
    + '等於留返個窿俾下一個人踩',
    msg !== null, String(msg));
  check('★★★★ 而且講得出係邊個參數', msg && msg.indexOf('dateSettings') !== -1, msg);
}

// =====================================================================
console.log('\n=== G【核心】補返舊嗰啲：列出仲欠日期嘅季度 ===');
{
  const headers = ['QuarterID', 'StartDate', 'GenerateOn', 'OfficialSendOn'];
  const rows = [
    ['2027T4', '2027-10-01', '2027-08-27', '2027-09-03'],   // 齊
    ['2028T1', '2028-01-01', '', ''],                        // 兩格都冇
    ['2028T2', '2028-04-01', '2028-02-26', ''],              // 淨係差一格
    ['', '', '', ''],                                        // 空行
    ['2028T3', '2028-07-01', '', '']
  ];
  gas.readConfig = function () { return {}; };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function () {
          return {
            getLastColumn: function () { return headers.length; },
            getLastRow: function () { return 2 + rows.length; },
            getRange: function (row) {
              return { getValues: function () { return row === 2 ? [headers] : rows; } };
            }
          };
        }
      };
    }
  };
  const missing = gas.listQuartersMissingDates_();
  check('★★★★★ 只列出真係欠嘅（三季）',
    missing.length === 3, JSON.stringify(missing));
  check('★★★★★ **已經齊嗰季唔會入名單**'
    + '——把已經有值嘅都列返出嚟，幹事會以為要全部重算，'
    + '而重算會蓋走佢人手改過嘅日期',
    !missing.some(function (m) { return m.quarterId === '2027T4'; }),
    JSON.stringify(missing));
  check('★★★★★ 只差一格嗰季一樣要補',
    missing.some(function (m) {
      return m.quarterId === '2028T2' && m.missingOfficialSendOn === true
        && m.missingGenerateOn === false;
    }), JSON.stringify(missing));
  check('★★★★ 空行唔會當成一季',
    !missing.some(function (m) { return m.quarterId === ''; }));
  check('★★★★ 帶埋 StartDate（俾呼叫端唔使再讀多次）',
    missing[0].startDate === '2028-01-01', JSON.stringify(missing[0]));
}

// =====================================================================
console.log('\n=== G 選單「計算季度日期」：留空 ＝ 一次過補齊 ===');
{
  const menu = read('src/Menu.gs');
  const fn = menu.slice(menu.indexOf('function runComputeQuarterDates_()'),
    menu.indexOf('\n}\n', menu.indexOf('function runComputeQuarterDates_()')));
  check('★★★★★ 提示明講「留空 ＝ 一次過補齊全部還欠日期的季度」'
    + '——2028 有四季要補，逐季輸入 QuarterID 做四次，'
    + '做少一次就有一季一直顯示「沒有填生成日期」',
    /留空並撳「確定」＝ 一次過補齊全部還欠日期的季度/.test(fn), '');
  check('★★★★★ 留空嗰陣行 `listQuartersMissingDates_()`',
    /missing = listQuartersMissingDates_\(\);/.test(fn), '');
  check('★★★★★ **全部算完先問一次**'
    + '——逐季問一次，幹事撳到第三次就唔會再睇內容',
    /const choice = ui\.alert\('計算季度日期（確認）'/.test(fn)
    && (fn.match(/ui\.alert\('計算季度日期（確認）'/g) || []).length === 1, '');
  check('★★★★★ 算唔到嗰幾季照樣列出嚟'
    + '——靜靜略過就會變成「報告話補齊咗」而其實嗰幾季一格都冇改',
    /以下季度算不出，不會寫入：/.test(fn), '');
  check('★★★★ 冇嘢要補嗰陣講一句，唔係靜靜乜都唔做',
    /都已經有值，沒有東西要補/.test(fn), '');
  check('★★★★★ 寫入照樣經 `writeQuarterDates_()`（唔另開一條寫入路）',
    /written \+= writeQuarterDates_\(plan, choice === ui\.Button\.YES\);/.test(fn), '');
}

// =====================================================================
console.log('\n=== G 畫面：預覽度睇得到兩個日期 ===');
{
  const ui = read('src/ui/ScriptZone2.html')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 逐季畫住生成日期同正式發出日期',
    /text: '　　生成日期 ' \+ \(r\.generateOn \|\| '（算不出）'\)/.test(ui), '');
  check('★★★★★ 後端有回呢兩個欄位（前端有得畫先有意義）',
    /generateOn: p\.generateOn \|\| '',/.test(read('src/WebAppRuleReview.gs')), '');
  check('★★★★★ 唔再叫幹事「寫入之後還要用選單的計算季度日期補上」'
    + '——嗰句就係 Ivan 冇做、然後四季全部冇日期嗰一步',
    ui.indexOf('那兩格這裡不會填') === -1, '');
  check('★★★★★ 算唔到嗰陣講返**原因**（Config 邊個 Key 未填）',
    /LEAD_DAYS_GENERATE 或 LEAD_DAYS_OFFICIAL 還沒有填/.test(ui), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
