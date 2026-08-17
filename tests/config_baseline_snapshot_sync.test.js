// 第二十三輪批次階段 B4：`getConfigBaselineSnapshot_()` 與
// `docs/config_baseline_上線值.json` 必須逐 Key 一致。
// 執行方式：node tests/config_baseline_snapshot_sync.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有呢個測試
// ─────────────────────────────────────────────────────────────────────
//
// 同一份資料喺兩個地方各有一份：
//   1. `docs/config_baseline_上線值.json`——人睇嘅、可以 diff 嘅權威版本
//   2. `src/ConfigBaselineCheck.gs` 嘅 `getConfigBaselineSnapshot_()`
//      ——Apps Script **讀唔到 repo 檔案**，所以一定要喺程式碼入面複製一份
//
// 兩份靠人手保持一致。**「同一個判斷寫兩次、兩邊漂移」係本專案已經燒過
// 幾次嘅 bug class**（第十九輪「兩個真相來源」、第二十二輪階段 B3 嘅
// PDF 清理）。呢度冇辦法消除重複（GAS 讀唔到檔案係硬限制），
// 所以改為**用測試鎖死兩者一致**——漂移即刻紅燈，唔使等到真實環境
// 報一堆對唔上嘅數字先發現。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'ConfigBaselineCheck.gs']);

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

const jsonPath = path.join(__dirname, '..', 'docs', 'config_baseline_上線值.json');
const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const gsSnapshot = gas.getConfigBaselineSnapshot_();

console.log('\n=== B4【核心】JSON 與 .gs 常數逐 Key 一致 ===');
{
  checkEqual('★★★★★ 快照日期一致', gsSnapshot.snapshotDate, json.snapshotDate);

  const jsonKeys = Object.keys(json.configKeys).sort();
  const gsKeys = Object.keys(gsSnapshot.configKeys).sort();

  const onlyInJson = jsonKeys.filter(function (k) { return gsKeys.indexOf(k) === -1; });
  const onlyInGs = gsKeys.filter(function (k) { return jsonKeys.indexOf(k) === -1; });
  checkEqual('★★★★★ 冇 Key 只喺 JSON 有（漏咗抄入 .gs）', onlyInJson, []);
  checkEqual('★★★★★ 冇 Key 只喺 .gs 有（JSON 冇跟住更新）', onlyInGs, []);
  checkEqual('★★★★ Key 總數一致', gsKeys.length, jsonKeys.length);
}

console.log('\n=== B4：逐 Key 比對 launchTargetValue 與 source ===');
{
  const targetDiffs = [];
  const sourceDiffs = [];
  const dynamicDiffs = [];

  Object.keys(json.configKeys).forEach(function (key) {
    const j = json.configKeys[key];
    const g = gsSnapshot.configKeys[key];
    if (!g) return;   // 上面已經報過

    if (!!j.dynamic !== !!g.dynamic) {
      dynamicDiffs.push(key + '（JSON dynamic=' + !!j.dynamic + '　.gs dynamic=' + !!g.dynamic + '）');
      return;   // dynamic 兩邊寫法容許唔同（.gs 唔記錄說明文字），唔再比值
    }
    if (j.dynamic) return;

    const jt = j.launchTargetValue === null || j.launchTargetValue === undefined ? '' : j.launchTargetValue;
    const gt = g.launchTargetValue === null || g.launchTargetValue === undefined ? '' : g.launchTargetValue;
    if (jt !== gt) {
      targetDiffs.push(key + '（JSON「' + jt + '」　.gs「' + gt + '」）');
    }
    if (j.source !== g.source) {
      sourceDiffs.push(key + '（JSON「' + j.source + '」　.gs「' + g.source + '」）');
    }
  });

  checkEqual('★★★★★ 每個 Key 嘅 launchTargetValue 兩邊一致', targetDiffs, []);
  checkEqual('★★★★★ 每個 Key 嘅 source 兩邊一致'
    + '——source 決定佢跌入「必須改回」定「未核實」桶，**打錯一個字就會令'
    + '真差異被靜靜歸類成「唔使理」**', sourceDiffs, []);
  checkEqual('★★★★ dynamic 標記兩邊一致', dynamicDiffs, []);
}

console.log('\n=== B4：季度日期兩邊一致 ===');
{
  const jsonQ = Object.keys(json.quarters).sort();
  const gsQ = Object.keys(gsSnapshot.quarters).sort();
  checkEqual('★★★★ 季度清單一致', gsQ, jsonQ);

  const diffs = [];
  jsonQ.forEach(function (qid) {
    const j = json.quarters[qid];
    const g = gsSnapshot.quarters[qid];
    if (!g) return;
    if (j.generateOn !== g.generateOn || j.officialSendOn !== g.officialSendOn) {
      diffs.push(qid);
    }
  });
  checkEqual('★★★★ 每個季度嘅 GenerateOn／OfficialSendOn 兩邊一致', diffs, []);
}

console.log('\n=== B4：source 只可以係兩種已知值（防止打錯字靜靜改變分類）===');
{
  // `planConfigBaselineCheck_()` 用 `source === CONFIG_BASELINE_SOURCE_VERIFIED`
  // 判斷入邊個桶。如果有人喺快照打錯 source（例如少咗個字），
  // 嗰個 Key 會靜靜由「必須改回」跌入「未核實」——**真差異被藏起**。
  const known = {};
  known[gas.CONFIG_BASELINE_SOURCE_VERIFIED] = true;
  known['程式碼預設值（試算表現時實際值未核實）'] = true;
  known['動態值，不比對'] = true;

  const unknown = [];
  Object.keys(gsSnapshot.configKeys).forEach(function (key) {
    const s = gsSnapshot.configKeys[key].source;
    if (!known[s]) unknown.push(key + '：「' + s + '」');
  });
  checkEqual('★★★★★ 冇任何 Key 用咗未知嘅 source 字串', unknown, []);

  check('★★★★ CONFIG_BASELINE_SOURCE_VERIFIED 常數本身係「已核實的實際值」',
    gas.CONFIG_BASELINE_SOURCE_VERIFIED === '已核實的實際值',
    gas.CONFIG_BASELINE_SOURCE_VERIFIED);

  const verifiedCount = Object.keys(gsSnapshot.configKeys).filter(function (k) {
    return gsSnapshot.configKeys[k].source === gas.CONFIG_BASELINE_SOURCE_VERIFIED;
  }).length;
  check('★★★★ 至少有一批 Key 係「已核實」（防止全部靜靜變成未核實、'
    + '令「必須改回」永遠係 0 而睇落好似冇問題）',
    verifiedCount >= 20, '只有 ' + verifiedCount + ' 個已核實');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
