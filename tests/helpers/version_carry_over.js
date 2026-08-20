// 第三十六輪批次 C 組：**擋住整個 class 嘅共用斷言。**
//
// ═════════════════════════════════════════════════════════════════════
// 呢個 class 已經燒過三次
// ═════════════════════════════════════════════════════════════════════
//
// | 輪 | 邊條路 | 丟咗咩 | 現場症狀 |
// | --- | --- | --- | --- |
// | 第三十四輪甲5 | `materialiseManualEdits_()` | `ruleFlags` | PDF 圖例把 79 格報成「系統未能安排」 |
// | 第三十六輪 A | `materialiseManualEdits_()` | `personName` | 講員一格變成「⚠ 未能安排」 |
// | 第三十六輪（第五條路） | `applyDecisions()` | `personName` ＋ `ruleFlags` | 未上線，靠呢條斷言先揪到 |
// | 第三十六輪（第六個實例） | `apiRollbackExecute()` | `serviceDateId` | 成版空白，加咗第五個欄位之後即刻揪到 |
//
// 每一次都係同一句：**建立新版本嗰陣，冇被改動嘅嘢冇被完整搬過去。**
//
// ⚠️ 而每一次嘅測試都只斷言「數量對」——273 格仍然係 273 格，
// 所以三次都逃得過。**數量對而內容錯**先係呢幾輪反覆出現嘅形態。
//
// 所以呢個 helper 係**逐格逐欄位**比。五條建立版本嘅路全部都要過。

/** 一格嘅識別鍵。同 `cellKey_()` 一致。 */
function cellKeyOf(gas, row, timezone) {
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  return gas.toDateString(row[C.SERVICE_DATE], timezone)
    + '|' + row[C.POST_ID] + '|' + String(row[C.SLOT_INDEX]);
}

/**
 * 讀一個版本嘅逐格快照（五個「應該原封不動搬過去」嘅欄位）。
 *
 * @param {Object} gas 沙箱
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} timezone 時區
 * @returns {Object.<string, {personId: string, personName: string,
 *   assignSource: string, ruleFlags: string}>}
 */
function snapshotVersion(gas, quarterId, versionNo, timezone) {
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const out = {};
  gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId) return;
    if (Number(row[C.VERSION_NO]) !== versionNo) return;
    out[cellKeyOf(gas, row, timezone)] = {
      // ⚠️ 第三十六輪批次：`serviceDateId` 係**加咗之後即刻揪到第六個實例**
      // 嘅欄位——`apiRollbackExecute()` 建立嘅新版本成版空白
      //（`readVersionAssignmentsForGrid_()` 本來冇帶佢出嚟）。
      // 呢個就係「只比四個欄位」同「比齊」嘅分別。
      serviceDateId: String(row[C.SERVICE_DATE_ID] || ''),
      personId: String(row[C.PERSON_ID] || ''),
      personName: String(row[C.PERSON_NAME_SNAPSHOT] || ''),
      assignSource: String(row[C.ASSIGN_SOURCE] || ''),
      // 排序之後串起嚟——`ruleFlags` 嘅次序唔應該影響「一唔一樣」嘅判斷。
      ruleFlags: gas.splitList_(row[C.RULE_FLAGS]).slice().sort().join(',')
    };
  });
  return out;
}

/**
 * **C 組核心斷言。** 逐格比對新版本同基準版本。
 *
 * 對於**唔喺「本次改動清單」**嘅每一格，五個欄位必須逐字相同：
 * `serviceDateId`、`personId`、`personName`、`assignSource`、`ruleFlags`。
 *
 * @param {Object} gas 沙箱
 * @param {string} quarterId 季度 ID
 * @param {number} baseVersionNo 基準版本
 * @param {number} newVersionNo 新版本
 * @param {string[]} changedKeys 本次改動清單（`日期|崗位|位次`）
 * @param {string} timezone 時區
 * @returns {string[]} 每一項係一句人話；空陣列代表全部搬齊
 */
function diffUnchangedCells(gas, quarterId, baseVersionNo, newVersionNo, changedKeys, timezone) {
  const before = snapshotVersion(gas, quarterId, baseVersionNo, timezone);
  const after = snapshotVersion(gas, quarterId, newVersionNo, timezone);
  const changed = {};
  (changedKeys || []).forEach(function (k) { changed[k] = true; });

  const problems = [];
  const FIELDS = ['serviceDateId', 'personId', 'personName', 'assignSource', 'ruleFlags'];

  Object.keys(before).forEach(function (key) {
    if (changed[key]) return;
    if (!after[key]) {
      problems.push(key + '：新版本完全冇咗呢一格');
      return;
    }
    FIELDS.forEach(function (f) {
      if (before[key][f] !== after[key][f]) {
        problems.push(key + '　' + f + '：「' + (before[key][f] || '（空）')
          + '」 → 「' + (after[key][f] || '（空）') + '」');
      }
    });
  });

  // 反方向：新版本多咗格都係一種唔一致。
  Object.keys(after).forEach(function (key) {
    if (!before[key]) problems.push(key + '：新版本多咗一格，基準版本冇');
  });

  return problems;
}

/**
 * **格子分類守門。** 五個桶加起嚟等於總格數，
 * 而且「未能安排」**唔可以**等於「總格數 − 有派人」。
 *
 * 後者正正係呢個 bug 嘅指紋：現場見到 273 − 194 = 79、273 − 192 = 81
 * ——即係冇做分類，把所有冇派人嘅格整批倒入最後一個桶。
 *
 * ⚠️ 一個例外：如果**真係**冇任何「待確認／不設／特殊主日」嘅格
 *（全部崗位都自動排、又冇特別主日），噉「未能安排 ＝ 總數 − 有派人」
 * 係啱嘅。所以呢個守門要求呼叫端傳 `expectNonGapBlanks`，明講
 * 「呢個 fixture 應該有冇派人但唔係 GAP 嘅格」。
 *
 * @param {Object} gas 沙箱
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {boolean} expectNonGapBlanks 呢一版應唔應該有「冇派人但唔係未能安排」嘅格
 * @returns {{counts: Object, problems: string[]}}
 */
function auditCellClasses(gas, quarterId, versionNo, expectNonGapBlanks) {
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
    const b = byClass[cls];
    if (b) counts[b]++;
  });

  const problems = [];
  const sum = counts.assigned + counts.manualPending + counts.structuralNa
    + counts.specialSkip + counts.genuineGap;
  if (sum !== counts.total) {
    problems.push('五個桶加起嚟 ' + sum + '，但總格數係 ' + counts.total);
  }
  if (expectNonGapBlanks && counts.genuineGap === counts.total - counts.assigned) {
    problems.push('「未能安排」＝ 總格數 − 有派人（' + counts.total + ' − '
      + counts.assigned + ' = ' + counts.genuineGap + '）'
      + '——呢個就係「冇做分類、全部倒入最後一個桶」嘅指紋。'
      + '呢個 fixture 應該有「待確認／不設／特殊主日」嘅格。');
  }
  return { counts: counts, problems: problems };
}

module.exports = { snapshotVersion, diffUnchangedCells, auditCellClasses, cellKeyOf };
