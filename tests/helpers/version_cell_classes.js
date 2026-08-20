// 第三十四輪批次甲5：**每一條「建立新版本」嘅路都要過呢個斷言。**
// FIXTURE-OK: 呢個 helper 由頭到尾**淨係讀**——把已經寫入嘅長表
// 逐行讀返出嚟砌比對用嘅快照。下面全部 `assignSource:`／`ruleFlags:`
// 都係 `row[C.…]` 讀值，冇一處係手砌一個系統唔會產生嘅狀態。
//
// ═════════════════════════════════════════════════════════════════════
// 點解要抽成共用
// ═════════════════════════════════════════════════════════════════════
//
// 2026-08-20 實測：`2027T3 v2`（經 `materialiseManualEdits_()` 建立）
// 嘅完整版 PDF 圖例係
//
//   （姓名）　　系統自動安排　　　　　　　194 格
//   待確認　　　此崗位不由系統自動安排　　  0 格　← 應該 39
//   —　　　　　這一週不設此崗位　　　　　  0 格　← 應該 40
//   特殊主日　　這一週有特別安排　　　　　  0 格
//   ⚠ 未能安排　系統找不到合資格又有空的人　79 格　← 應該 0
//
// 273 總格 − 194 有派人 = 79，同「未能安排」一模一樣 ⇒ **冇做分類**，
// 而係把所有冇派人嘅格整批倒入最後一個桶。成因係 `StateSource.gs`
// 寫死 `ruleFlags: []`——冇原因，`classifyGridCell_()` 就分唔出。
//
// ⚠️ 但**唔係所有非 AUTO 版本都壞**：`2027T2 v1`（REQUESTS_APPLIED）
// 嘅圖例一直正確，因為 `applyRequests_()` 有 `a.ruleFlags.slice()`。
// 所以唔可以只憑 basis 判斷，要**逐條建立版本嘅路都覆蓋到**。
//
// 呢個 helper 就係嗰個共用斷言。日後加新一條路（或者改舊嗰啲），
// 喺嗰條路嘅測試度叫一次呢個函式就得。

/**
 * 由一個版本嘅 `RosterAssignments` 列算出五個桶嘅格數。
 *
 * 用**真正嘅 `classifyGridCell_()`**（`Generator.gs`）——唔喺呢度手抄一份
 * 分類邏輯，否則就變成第二個真相來源，而分類正正就係出事嗰件事。
 *
 * @param {Object} gas `loadGasSource()` 回嚟嘅沙箱
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{total: number, assigned: number, manualPending: number,
 *   structuralNa: number, specialSkip: number, genuineGap: number}}
 */
function countVersionCellClasses(gas, quarterId, versionNo) {
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const counts = { total: 0, assigned: 0, manualPending: 0, structuralNa: 0, specialSkip: 0, genuineGap: 0 };
  const byClass = {};
  byClass[gas.GRID_CELL_CLASS.ASSIGNED] = 'assigned';
  byClass[gas.GRID_CELL_CLASS.MANUAL_PENDING] = 'manualPending';
  byClass[gas.GRID_CELL_CLASS.STRUCTURAL_NA] = 'structuralNa';
  byClass[gas.GRID_CELL_CLASS.SPECIAL_SKIP] = 'specialSkip';
  byClass[gas.GRID_CELL_CLASS.GENUINE_GAP] = 'genuineGap';

  gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return;
    if (Number(row[C.VERSION_NO]) !== versionNo) return;
    counts.total++;
    const cls = gas.classifyGridCell_({
      personId: row[C.PERSON_ID],
      // ⚠️ 第三十七輪批次：`personName` **一定要傳**。冇傳嘅話，
      // 一格由「填講員／翻譯／獻花」寫入嘅自由文字（冇 PersonID）
      // 會被呢個 helper 自己判成「冇人」——即係 helper 重現咗
      // 佢本來要守嗰個 bug，變成一條假綠燈。
      personName: row[C.PERSON_NAME_SNAPSHOT],
      assignSource: row[C.ASSIGN_SOURCE],
      ruleFlags: gas.splitList_(row[C.RULE_FLAGS])
    });
    const bucket = byClass[cls];
    if (bucket) counts[bucket]++;
  });
  return counts;
}

/**
 * 逐格比對兩個版本嘅 `ruleFlags`。
 *
 * @param {Object} gas 沙箱
 * @param {string} quarterId 季度 ID
 * @param {number} fromVersion 舊版本
 * @param {number} toVersion 新版本
 * @param {string[]=} exemptKeys 容許唔同嘅格（被人手改動嗰啲），
 *   格式同 `cellKey_()` 一致：`serviceDate|postId|slotIndex`
 * @returns {string[]} 對唔上嘅格（每項一句人話），空陣列代表全部一致
 */
function diffVersionRuleFlags(gas, quarterId, fromVersion, toVersion, exemptKeys) {
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const timezone = gas.getConfig(gas.CONFIG_KEYS.SYS_TIMEZONE, gas.DEFAULTS.TIMEZONE);
  const exempt = {};
  (exemptKeys || []).forEach(function (k) { exempt[k] = true; });

  const read = function (versionNo) {
    const map = {};
    gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (row[C.QUARTER_ID] !== quarterId) return;
      if (Number(row[C.VERSION_NO]) !== versionNo) return;
      const key = gas.toDateString(row[C.SERVICE_DATE], timezone)
        + '|' + row[C.POST_ID] + '|' + String(row[C.SLOT_INDEX]);
      map[key] = gas.splitList_(row[C.RULE_FLAGS]).slice().sort().join(',');
    });
    return map;
  };

  const before = read(fromVersion);
  const after = read(toVersion);
  const problems = [];
  Object.keys(before).forEach(function (key) {
    if (exempt[key]) return;
    if (after[key] === undefined) {
      problems.push(key + '：新版本冇咗呢一格');
      return;
    }
    if (before[key] !== after[key]) {
      problems.push(key + '：ruleFlags 由「' + (before[key] || '（空）')
        + '」變成「' + (after[key] || '（空）') + '」');
    }
  });
  return problems;
}

module.exports = { countVersionCellClasses, diffVersionRuleFlags };
