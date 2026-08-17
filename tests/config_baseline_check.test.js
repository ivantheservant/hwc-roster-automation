// 第二十二輪批次階段 D／第二十三輪批次階段 B：「設定回復檢查（唯讀）」。
// 執行方式：node tests/config_baseline_check.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 第二十三輪為咗咩改呢個測試
// ─────────────────────────────────────────────────────────────────────
//
// 第二十二輪版本實測跑出 **28 項不符，其中 23 項係假警報**——工具達成唔到
// 佢自己嘅目的（「上線前把全部差異清零」，永遠清唔到零）。三個成因：
//
// | # | 缺陷 | 修法 |
// |---|---|---|
// | B1 | 只有「相符／不符」兩桶，冇可信基準嘅 Key 全部塞入「必須改回」 | 三分類 |
// | B2 | 純字串比對，`true` vs `TRUE`、`0.50` vs `0.5`、Date vs `10:45` 全部誤報 | 按 Type 比 |
// | B3 | 每行掛「未經核實」但照樣計入 ❌ 總數，自相矛盾 | 三節獨立、總結句分開數 |

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'ConfigBaselineCheck.gs']);

// Date 物件經 toDateString()／normalizeConfigValueForCompare_() 會用
// Utilities.formatDate；測試沙箱嘅 GAS stub 一被呼叫就拋錯，換確定性替身。
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    const p = function (n) { return n < 10 ? '0' + n : String(n); };
    if (format === 'yyyy-MM-dd') {
      return date.getUTCFullYear() + '-' + p(date.getUTCMonth() + 1) + '-' + p(date.getUTCDate());
    }
    if (format === 'HH:mm') return p(date.getHours()) + ':' + p(date.getMinutes());
    throw new Error('測試替身唔支援格式：' + format);
  }
};

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

const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS.CONFIG;
const Q = gas.COLUMNS.QUARTERS;
const VERIFIED = gas.CONFIG_BASELINE_SOURCE_VERIFIED;
const UNVERIFIED = '程式碼預設值（試算表現時實際值未核實）';

function configRow(key, value, type) {
  const row = {};
  row[C.KEY] = key;
  row[C.VALUE] = value;
  row[C.TYPE] = type || gas.CONFIG_TYPES.STR;
  return row;
}
function quarterRow(quarterId, generateOn, officialSendOn) {
  const row = {};
  row[Q.QUARTER_ID] = quarterId;
  row[Q.GENERATE_ON] = generateOn;
  row[Q.OFFICIAL_SEND_ON] = officialSendOn;
  return row;
}
function keys(list) { return list.map(function (i) { return i.key; }); }

console.log('\n=== B1【核心】三分類：已符合／必須改回／未核實基準 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      VERIFIED_MATCH: { launchTargetValue: 'X', source: VERIFIED },
      VERIFIED_DIFF: { launchTargetValue: 'FALSE', source: VERIFIED },
      UNVERIFIED_DIFF: { launchTargetValue: 'A', source: UNVERIFIED },
      UNVERIFIED_SAME: { launchTargetValue: 'B', source: UNVERIFIED },
      DYNAMIC_KEY: { launchTargetValue: '', source: '動態值，不比對', dynamic: true }
    },
    quarters: {}
  };
  const configRows = [
    configRow('VERIFIED_MATCH', 'X'),
    configRow('VERIFIED_DIFF', 'TRUE'),
    configRow('UNVERIFIED_DIFF', 'Z'),
    configRow('UNVERIFIED_SAME', 'B'),
    configRow('DYNAMIC_KEY', '隨便什麼')
  ];
  const r = gas.planConfigBaselineCheck_(snapshot, configRows, [], TZ);

  checkEqual('★★★★★ 必須改回：只有「已核實基準」而且真係唔同嗰個',
    keys(r.config.mismatched), ['VERIFIED_DIFF']);
  checkEqual('★★★★★ 未核實基準：source 唔係「已核實」嘅一律入呢桶，'
    + '**唔理值相唔相同**（冇基準就係冇基準，工具唔可以替人斷定）',
    keys(r.config.unknownBaseline).sort(), ['UNVERIFIED_DIFF', 'UNVERIFIED_SAME']);
  checkEqual('★★★★★ 已符合：只有「已核實基準」而且相同嗰個',
    keys(r.config.matched), ['VERIFIED_MATCH']);
  check('★★★★ dynamic 完全唔出現喺任何一桶',
    keys(r.config.mismatched).concat(keys(r.config.unknownBaseline), keys(r.config.matched))
      .indexOf('DYNAMIC_KEY') === -1);
}

console.log('\n=== B1：實測嗰個場景——未核實嘅 Key 唔可以再撐大「必須改回」數字 ===');
{
  // 實測：28 項不符入面 23 項係「未核實基準」被誤歸類。
  const snapshot = { snapshotDate: '2026-08-17', configKeys: {}, quarters: {} };
  const rows = [];
  for (let i = 0; i < 23; i++) {
    snapshot.configKeys['U' + i] = { launchTargetValue: 'code-default', source: UNVERIFIED };
    rows.push(configRow('U' + i, 'actual-' + i));
  }
  for (let i = 0; i < 5; i++) {
    snapshot.configKeys['V' + i] = { launchTargetValue: 'want', source: VERIFIED };
    rows.push(configRow('V' + i, 'got'));
  }
  const r = gas.planConfigBaselineCheck_(snapshot, rows, [], TZ);
  checkEqual('★★★★★ 必須改回 = 5（唔再係 28）', r.config.mismatched.length, 5);
  checkEqual('★★★★★ 未核實 = 23，獨立成一桶', r.config.unknownBaseline.length, 23);
}

console.log('\n=== B2【核心】BOOL：大小寫唔同唔算差異 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      B_LOWER: { launchTargetValue: 'TRUE', source: VERIFIED },
      B_MIXED: { launchTargetValue: 'FALSE', source: VERIFIED },
      B_REAL_DIFF: { launchTargetValue: 'TRUE', source: VERIFIED }
    },
    quarters: {}
  };
  const rows = [
    configRow('B_LOWER', 'true', gas.CONFIG_TYPES.BOOL),
    configRow('B_MIXED', 'False', gas.CONFIG_TYPES.BOOL),
    configRow('B_REAL_DIFF', 'FALSE', gas.CONFIG_TYPES.BOOL)
  ];
  const r = gas.planConfigBaselineCheck_(snapshot, rows, [], TZ);
  checkEqual('★★★★★ `true` vs `TRUE` ⇒ 相符（實測嘅假警報之一）',
    keys(r.config.matched).indexOf('B_LOWER') !== -1, true);
  checkEqual('★★★★ `False` vs `FALSE` ⇒ 相符', keys(r.config.matched).indexOf('B_MIXED') !== -1, true);
  checkEqual('★★★★★ 真嘅布林差異仍然要報（唔可以為咗消警報而全部放過）',
    keys(r.config.mismatched), ['B_REAL_DIFF']);
}

console.log('\n=== B2【核心】INT／DEC：數值相等就算相符，唔理寫法 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      D_TRAILING_ZERO: { launchTargetValue: '0.5', source: VERIFIED },
      I_NUMBER_CELL: { launchTargetValue: '9', source: VERIFIED },
      D_REAL_DIFF: { launchTargetValue: '0.2', source: VERIFIED },
      I_NEGATIVE: { launchTargetValue: '-35', source: VERIFIED }
    },
    quarters: {}
  };
  const rows = [
    configRow('D_TRAILING_ZERO', '0.50', gas.CONFIG_TYPES.DEC),
    // 試算表數字格讀出嚟係 JS number，唔係字串——呢個先係真實形狀
    configRow('I_NUMBER_CELL', 9, gas.CONFIG_TYPES.INT),
    configRow('D_REAL_DIFF', '0.35', gas.CONFIG_TYPES.DEC),
    configRow('I_NEGATIVE', -35, gas.CONFIG_TYPES.INT)
  ];
  const r = gas.planConfigBaselineCheck_(snapshot, rows, [], TZ);
  checkEqual('★★★★★ `0.50` vs `0.5` ⇒ 相符', keys(r.config.matched).indexOf('D_TRAILING_ZERO') !== -1, true);
  checkEqual('★★★★★ 儲存格存數字 9 vs 快照字串 "9" ⇒ 相符'
    + '（試算表數字格讀出嚟係 JS number，唔係字串——舊碼純字串比必然報錯）',
    keys(r.config.matched).indexOf('I_NUMBER_CELL') !== -1, true);
  checkEqual('★★★★ 負數一樣（LEAD_DAYS_* 係負數）',
    keys(r.config.matched).indexOf('I_NEGATIVE') !== -1, true);
  checkEqual('★★★★★ 真嘅數值差異仍然要報', keys(r.config.mismatched), ['D_REAL_DIFF']);
}

console.log('\n=== B2：INT 兩邊空白算相符；非數字退回逐字比並講明 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      I_BOTH_BLANK: { launchTargetValue: '', source: VERIFIED },
      I_GARBAGE: { launchTargetValue: '9', source: VERIFIED }
    },
    quarters: {}
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [
    configRow('I_BOTH_BLANK', '', gas.CONFIG_TYPES.INT),
    configRow('I_GARBAGE', '唔係數字', gas.CONFIG_TYPES.INT)
  ], [], TZ);
  checkEqual('★★★★ 兩邊都空白 ⇒ 相符（都係「未設定」，唔可以當成 0 ≠ NaN）',
    keys(r.config.matched), ['I_BOTH_BLANK']);
  const garbage = r.config.mismatched.filter(function (i) { return i.key === 'I_GARBAGE'; })[0];
  check('★★★★★ 值唔係數字 ⇒ 報不符，而且 note 講明已退回逐字比對'
    + '（唔可以靜靜當成 NaN===NaN 永遠 false，亦唔可以當成 0）',
    !!garbage && garbage.note.indexOf('不是數字') !== -1, garbage ? garbage.note : '冇呢一項');
}

console.log('\n=== B2【核心】LIST：空格唔算差異；次序不同要講明係次序問題 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      L_SPACES: { launchTargetValue: '1,4,7,10', source: VERIFIED },
      L_ORDER: { launchTargetValue: '1,4,7,10', source: VERIFIED },
      L_REAL_DIFF: { launchTargetValue: '1,4,7,10', source: VERIFIED }
    },
    quarters: {}
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [
    configRow('L_SPACES', '1, 4, 7, 10', gas.CONFIG_TYPES.LIST),
    configRow('L_ORDER', '4,1,10,7', gas.CONFIG_TYPES.LIST),
    configRow('L_REAL_DIFF', '1,4,7', gas.CONFIG_TYPES.LIST)
  ], [], TZ);

  checkEqual('★★★★★ 只差空格 ⇒ 相符', keys(r.config.matched), ['L_SPACES']);
  const order = r.config.mismatched.filter(function (i) { return i.key === 'L_ORDER'; })[0];
  check('★★★★★ 次序不同 ⇒ 報不符（有啲 LIST 次序有意義），'
    + '但 note 要講明「項目完全相同，只是排列次序不同」'
    + '——唔講嘅話幹事會逐項對半日先發現只係排列問題',
    !!order && order.note.indexOf('排列次序') !== -1, order ? order.note : '冇呢一項');
  const realDiff = r.config.mismatched.filter(function (i) { return i.key === 'L_REAL_DIFF'; })[0];
  check('★★★★ 真係少咗一項 ⇒ 報不符，而且唔會誤標成「只是次序」',
    !!realDiff && realDiff.note === '', realDiff ? realDiff.note : '冇呢一項');
}

console.log('\n=== B2【核心】Date 儲存格：試算表真正會俾嘅嘢 ===');
{
  // 呢個就係階段 A 嗰個 bug 喺呢個工具身上嘅表現：
  // Config 打咗 `10:45`，試算表存成 Date 物件，舊碼 String() 出成串
  // 英文長格式，永遠報「不符」——但幹事去 Config 望，格入面明明寫住 10:45。
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      ICS_START: { launchTargetValue: '10:45', source: VERIFIED },
      SOME_DATE: { launchTargetValue: '2026-08-30', source: VERIFIED }
    },
    quarters: {}
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [
    // 試算表存「純時間」用 1899-12-30 當日
    configRow('ICS_START', new Date(1899, 11, 30, 10, 45, 0), gas.CONFIG_TYPES.STR),
    configRow('SOME_DATE', new Date(Date.UTC(2026, 7, 30)), gas.CONFIG_TYPES.STR)
  ], [], TZ);

  checkEqual('★★★★★ 時間格 Date ⇒ 正規化成 HH:mm 之後相符'
    + '（舊碼 String(Date) 出「Sat Dec 30 1899 …」，永遠報不符）',
    keys(r.config.matched).indexOf('ICS_START') !== -1, true);
  checkEqual('★★★★ 日期格 Date ⇒ 正規化成 yyyy-MM-dd 之後相符',
    keys(r.config.matched).indexOf('SOME_DATE') !== -1, true);

  const startItem = r.config.matched.filter(function (i) { return i.key === 'ICS_START'; })[0];
  checkEqual('★★★★ 顯示出嚟係 10:45，唔係英文長格式（畫面要同幹事睇到嘅一樣）',
    startItem.currentValue, '10:45');
}

console.log('\n=== 工作表缺行：視同空白，唔會當成「不符」除非目標值真係唔係空白 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      MISSING_BLANK_TARGET: { launchTargetValue: '', source: VERIFIED },
      MISSING_REAL_TARGET: { launchTargetValue: 'SHOULD_BE_SET', source: VERIFIED }
    },
    quarters: {}
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [], [], TZ);
  checkEqual('★★★★ 缺行 + 目標值本身空白 ⇒ 相符', keys(r.config.matched), ['MISSING_BLANK_TARGET']);
  checkEqual('★★★★★ 缺行 + 目標值非空白 ⇒ 必須改回', keys(r.config.mismatched), ['MISSING_REAL_TARGET']);
  check('★★★★ 缺行嘅顯示文字講明「工作表沒有這一行」，唔係就咁顯示空白'
    + '（空白同「根本冇呢一行」係兩件事，幹事要知去邊度加）',
    r.config.mismatched[0].currentValue.indexOf('沒有這一行') !== -1,
    r.config.mismatched[0].currentValue);
}

console.log('\n=== 快照無記錄的新 Key ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: { KNOWN: { launchTargetValue: 'A', source: VERIFIED } },
    quarters: {}
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [
    configRow('KNOWN', 'A'),
    configRow('BRAND_NEW', 'whatever'),
    configRow('ANOTHER_NEW', 'x')
  ], [], TZ);
  checkEqual('★★★★★ 新 Key 獨立一桶，唔會混入「必須改回」',
    keys(r.config.newKeysInSheet).sort(), ['ANOTHER_NEW', 'BRAND_NEW']);
  checkEqual('★★★★ 必須改回維持 0', r.config.mismatched.length, 0);
}

console.log('\n=== 季度日期：快照留空 ⇒ 當相符，唔誤報 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {},
    quarters: {
      '2026T4': { generateOn: '2026-08-30', officialSendOn: '2026-09-06' },
      '2027T1': { generateOn: '2026-11-27', officialSendOn: '2026-12-04' },
      '2027T4': { generateOn: '', officialSendOn: '' }
    }
  };
  const r = gas.planConfigBaselineCheck_(snapshot, [], [
    quarterRow('2026T4', new Date(Date.UTC(2026, 7, 30)), new Date(Date.UTC(2026, 8, 6))),
    quarterRow('2027T1', new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 4))),
    quarterRow('2027T4', '', ''),
    quarterRow('2027T2', new Date(Date.UTC(2027, 1, 25)), new Date(Date.UTC(2027, 2, 4)))
  ], TZ);

  checkEqual('★★★★★ 2027T1 GenerateOn 真係唔同 ⇒ 報不符',
    r.quarters.mismatched.map(function (i) { return i.quarterId; }), ['2027T1']);
  checkEqual('★★★★★ 2027T4 快照留空 ⇒ 當相符（冇基準唔等於錯——'
    + '同 B1 三分類係同一個原則：唔可以把「未知」當成「已知係錯」）',
    r.quarters.matched.map(function (i) { return i.quarterId; }).sort(), ['2026T4', '2027T4']);
  checkEqual('★★★★ 快照冇記錄嘅季度 ⇒ 入「新季度」桶',
    r.quarters.newInSheet.map(function (i) { return i.quarterId; }), ['2027T2']);
}

console.log('\n=== B3：報告文案（靜態檢查正式碼）===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ConfigBaselineCheck.gs'), 'utf8');
  check('★★★★★ 總結句用三個獨立數字（必須改回／未核實／已符合）',
    /❌ 必須改回：/.test(src) && /ℹ️ 未核實基準，要人眼核對：/.test(src) && /✅ 已符合：/.test(src));
  check('★★★★★ 總結句明寫「不計入必須改回」', /不計入必須改回/.test(src));
  check('★★★★★ 舊嘅自相矛盾句子（掛喺不符行尾嘅「未經 Ivan 核實」）已經冇晒',
    src.indexOf('未經 Ivan 核實') === -1);
  check('★★★★ 未核實嗰節有解釋「沒有基準不等於不符」',
    /「沒有基準」不等於「不符」/.test(src));
}

console.log('\n=== 用真快照 + 已知實際值代入：預期剩返 2 項必須改回 ===');
{
  const jsonPath = path.join(__dirname, '..', 'docs', 'config_baseline_上線值.json');
  const jsonSnapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const gsSnapshot = gas.getConfigBaselineSnapshot_();

  // 模擬「試算表現時嘅值」＝ JSON 快照記錄嘅 currentValue。
  const rows = Object.keys(jsonSnapshot.configKeys).map(function (key) {
    const e = jsonSnapshot.configKeys[key];
    return configRow(key, e.currentValue === null ? '' : e.currentValue);
  });
  const qrows = Object.keys(jsonSnapshot.quarters).map(function (qid) {
    const q = jsonSnapshot.quarters[qid];
    return quarterRow(qid,
      q.generateOn ? new Date(q.generateOn + 'T00:00:00Z') : '',
      q.officialSendOn ? new Date(q.officialSendOn + 'T00:00:00Z') : '');
  });

  const r = gas.planConfigBaselineCheck_(gsSnapshot, rows, qrows, TZ);
  checkEqual('★★★★★ 必須改回剛好 2 項：DRY_RUN 與 MAIL_SUBJECT_PREFIX'
    + '（測試期刻意調整、11 月中前要改回；其餘已核實嘅 Key 現時值就是上線值）',
    keys(r.config.mismatched).sort(), ['DRY_RUN', 'MAIL_SUBJECT_PREFIX']);
  checkEqual('★★★★ 季度日期全部相符', r.quarters.mismatched, []);
  check('★★★★★ 未核實桶非空——正正就係之前被誤計入「必須改回」嗰批',
    r.config.unknownBaseline.length > 0, '未核實 = ' + r.config.unknownBaseline.length);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
