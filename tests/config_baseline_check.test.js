// 第二十二輪批次階段 D：「設定回復檢查（唯讀）」回歸測試。
// 執行方式：node tests/config_baseline_check.test.js
//
// 8 月至 11 月中係測試期，Ivan 會為咗配合測試任意調整日期與參數，
// 11 月中之前必須全部改回真實值——呢個工具就係防止「靠記憶會漏」。
// 測試分兩部分：(1) 用合成小快照鎖住三類輸出（不符／已符合／新 Key）嘅
// 判斷邏輯本身；(2) 核對 `src/ConfigBaselineCheck.gs` 嵌入嘅快照
// 同 `docs/config_baseline_上線值.json` 保持同步（兩份手動維護，容易漂移）。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'ConfigBaselineCheck.gs']);

gas.Utilities = {
  formatDate: function (date, timezone, format) {
    if (format !== 'yyyy-MM-dd') throw new Error('測試替身只支援 yyyy-MM-dd');
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
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

function configRow(key, value) {
  const row = {};
  row[C.KEY] = key;
  row[C.VALUE] = value;
  return row;
}
function quarterRow(quarterId, generateOn, officialSendOn) {
  const row = {};
  row[Q.QUARTER_ID] = quarterId;
  row[Q.GENERATE_ON] = generateOn;
  row[Q.OFFICIAL_SEND_ON] = officialSendOn;
  return row;
}

console.log('\n=== D2【核心】三類輸出：不符／已符合／快照無記錄的新 Key ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {
      MATCHED_KEY: { launchTargetValue: 'TRUE', source: '已核實的實際值' },
      MISMATCH_KEY: { launchTargetValue: 'FALSE', source: '已核實的實際值' },
      DYNAMIC_KEY: { launchTargetValue: '', source: '動態值，不比對', dynamic: true }
    },
    quarters: {
      '2026T4': { generateOn: '2026-08-30', officialSendOn: '2026-09-06' },
      '2027T1': { generateOn: '2026-11-27', officialSendOn: '2026-12-04' }
    }
  };
  const configRows = [
    configRow('MATCHED_KEY', 'TRUE'),
    configRow('MISMATCH_KEY', 'TRUE'),        // 現時 TRUE，上線值應為 FALSE ⇒ 不符
    configRow('DYNAMIC_KEY', '隨便什麼值'),      // dynamic=true，唔應該出現喺任何結果
    configRow('BRAND_NEW_KEY', '某個值')        // 快照完全冇記錄 ⇒ 新 Key
  ];
  const quarterRows = [
    quarterRow('2026T4', new Date(Date.UTC(2026, 7, 30)), new Date(Date.UTC(2026, 8, 6))),   // 相符
    quarterRow('2027T1', new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 4))),  // GenerateOn 不符
    quarterRow('2027T2', new Date(Date.UTC(2027, 1, 1)), new Date(Date.UTC(2027, 2, 1)))     // 快照冇 2027T2 ⇒ 新季度
  ];

  const result = gas.planConfigBaselineCheck_(snapshot, configRows, quarterRows, TZ);

  checkEqual('★★★★★ 已符合的 Key：只有 MATCHED_KEY',
    result.config.matched.map(function (i) { return i.key; }), ['MATCHED_KEY']);
  checkEqual('★★★★★ 不符的 Key：只有 MISMATCH_KEY',
    result.config.mismatched.map(function (i) { return i.key; }), ['MISMATCH_KEY']);
  check('★★★★ 不符項目講得出「現時」與「上線值應為」',
    result.config.mismatched[0].currentValue === 'TRUE' && result.config.mismatched[0].targetValue === 'FALSE');
  checkEqual('★★★★★ 新 Key：只有 BRAND_NEW_KEY（DYNAMIC_KEY 唔算，因為快照有記錄佢，只係唔比對）',
    result.config.newKeysInSheet.map(function (i) { return i.key; }), ['BRAND_NEW_KEY']);
  check('★★★★★ DYNAMIC_KEY 完全唔出現喺任何一類結果（動態值唔比對）',
    result.config.matched.every(function (i) { return i.key !== 'DYNAMIC_KEY'; })
    && result.config.mismatched.every(function (i) { return i.key !== 'DYNAMIC_KEY'; })
    && result.config.newKeysInSheet.every(function (i) { return i.key !== 'DYNAMIC_KEY'; }));

  checkEqual('★★★★★ 已符合的季度：只有 2026T4',
    result.quarters.matched.map(function (i) { return i.quarterId; }), ['2026T4']);
  checkEqual('★★★★★ 不符的季度：只有 2027T1', result.quarters.mismatched.map(function (i) { return i.quarterId; }), ['2027T1']);
  checkEqual('★★★★★ 新季度：只有 2027T2', result.quarters.newInSheet.map(function (i) { return i.quarterId; }), ['2027T2']);
}

console.log('\n=== D2：全部相符時，不符清單完全是空的 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: { A: { launchTargetValue: 'X', source: '已核實的實際值' }, B: { launchTargetValue: 'Y', source: '已核實的實際值' } },
    quarters: { '2026T4': { generateOn: '2026-08-30', officialSendOn: '2026-09-06' } }
  };
  const result = gas.planConfigBaselineCheck_(snapshot,
    [configRow('A', 'X'), configRow('B', 'Y')],
    [quarterRow('2026T4', new Date(Date.UTC(2026, 7, 30)), new Date(Date.UTC(2026, 8, 6)))], TZ);
  checkEqual('★★★★★ config 不符清單為空', result.config.mismatched, []);
  checkEqual('★★★★★ quarters 不符清單為空', result.quarters.mismatched, []);
  checkEqual('★★★★ config 新 Key 清單為空', result.config.newKeysInSheet, []);
  checkEqual('★★★★ 全部 2 個 Key 都相符', result.config.matched.length, 2);
}

console.log('\n=== D2：工作表完全沒有這一行時，視同空白，跟快照留空的值比對 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: { BLANK_TARGET: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' } },
    quarters: {}
  };
  const result = gas.planConfigBaselineCheck_(snapshot, [], [], TZ);
  checkEqual('★★★★ 快照目標值本身係空字串、工作表完全冇呢一行 ⇒ 當相符，唔誤報不符',
    [result.config.matched.length, result.config.mismatched.length], [1, 0]);
}

console.log('\n=== D2：快照留空的季度日期（例如 2027T4 尚未計算）當「相符」，唔誤報 ===');
{
  const snapshot = {
    snapshotDate: '2026-08-17',
    configKeys: {},
    quarters: { '2027T4': { generateOn: '', officialSendOn: '' } }
  };
  const result = gas.planConfigBaselineCheck_(snapshot, [],
    [quarterRow('2027T4', '', '')], TZ);
  checkEqual('★★★★★ 快照留空 ⇒ 當相符（冇基準可比，唔可以當成「不符」——'
    + '呢個係「缺失當有意義值」呢個 bug class 嘅相反陷阱：呢度刻意唔把「未知」當「不符」）',
    [result.quarters.matched.length, result.quarters.mismatched.length], [1, 0]);
}

// ---------------------------------------------------------------------
// 核對正式碼嵌入嘅快照同 docs/config_baseline_上線值.json 保持同步
// ---------------------------------------------------------------------

console.log('\n=== D1／D2：src/ConfigBaselineCheck.gs 嵌入嘅快照要同 docs/config_baseline_上線值.json 同步 ===');
{
  const jsonPath = path.join(__dirname, '..', 'docs', 'config_baseline_上線值.json');
  const jsonSnapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const gsSnapshot = gas.getConfigBaselineSnapshot_();

  checkEqual('★★★★★ 快照日期一致', gsSnapshot.snapshotDate, jsonSnapshot.snapshotDate);

  const jsonKeys = Object.keys(jsonSnapshot.configKeys).sort();
  const gsKeys = Object.keys(gsSnapshot.configKeys).sort();
  checkEqual('★★★★★ Config Key 清單完全一致（兩份文件手動維護，容易漂移）', gsKeys, jsonKeys);

  const mismatchedTargets = jsonKeys.filter(function (key) {
    if (jsonSnapshot.configKeys[key].dynamic) return false;   // 動態值兩邊寫法唔同，跳過
    return gsSnapshot.configKeys[key].launchTargetValue !== jsonSnapshot.configKeys[key].launchTargetValue;
  });
  checkEqual('★★★★★ 每個 Key 的上線目標值兩邊一致', mismatchedTargets, []);

  const jsonQuarters = Object.keys(jsonSnapshot.quarters).sort();
  const gsQuarters = Object.keys(gsSnapshot.quarters).sort();
  checkEqual('★★★★ 季度清單一致', gsQuarters, jsonQuarters);
  const mismatchedQuarters = jsonQuarters.filter(function (qid) {
    const a = gsSnapshot.quarters[qid], b = jsonSnapshot.quarters[qid];
    return a.generateOn !== b.generateOn || a.officialSendOn !== b.officialSendOn;
  });
  checkEqual('★★★★ 每個季度的 GenerateOn／OfficialSendOn 兩邊一致', mismatchedQuarters, []);
}

console.log('\n=== 用 2026-08-17 當時已知嘅實際值全部代入，工具應該剛好抓到 DRY_RUN 與 MAIL_SUBJECT_PREFIX 兩項不符 ===');
{
  const jsonPath = path.join(__dirname, '..', 'docs', 'config_baseline_上線值.json');
  const jsonSnapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const gsSnapshot = gas.getConfigBaselineSnapshot_();

  // 模擬「試算表現時的值」＝ JSON 快照記錄嘅 currentValue（已核實的直接用實際值；
  // 未核實的假設試算表現時就是程式碼預設值，即 launchTargetValue）。
  const configRows = Object.keys(jsonSnapshot.configKeys).map(function (key) {
    const e = jsonSnapshot.configKeys[key];
    return configRow(key, e.currentValue === null ? '' : e.currentValue);
  });
  const quarterRows = Object.keys(jsonSnapshot.quarters).map(function (qid) {
    const q = jsonSnapshot.quarters[qid];
    return quarterRow(qid,
      q.generateOn ? new Date(q.generateOn + 'T00:00:00Z') : '',
      q.officialSendOn ? new Date(q.officialSendOn + 'T00:00:00Z') : '');
  });

  const result = gas.planConfigBaselineCheck_(gsSnapshot, configRows, quarterRows, TZ);

  checkEqual('★★★★★ 剛好 2 項不符：DRY_RUN 與 MAIL_SUBJECT_PREFIX'
    + '（測試期刻意調整、11 月中前要改回，其餘已核實嘅 Key 現時值就是上線值，理應相符）',
    result.config.mismatched.map(function (i) { return i.key; }).sort(),
    ['DRY_RUN', 'MAIL_SUBJECT_PREFIX']);
  checkEqual('★★★★ 季度日期全部相符（Ivan 提供嘅 GenerateOn／OfficialSendOn 就是目前設定）',
    result.quarters.mismatched, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
