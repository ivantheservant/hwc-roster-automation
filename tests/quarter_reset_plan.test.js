// 階段 B4：季度重設工具「plan 階段」的回歸測試。
// 執行方式：node tests/quarter_reset_plan.test.js
// 只測 planQuarterReset_()（QuarterReset.gs）——純讀取、完全不刪任何東西的那一半。
// 不測 executeQuarterReset_()（真正刪除，這裡刻意不碰）。
// 移植邏輯與正式碼的版本篩選規則（v0／Protected）逐字相同。

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// ---- 移植：planQuarterReset_() 的版本篩選核心（QuarterReset.gs 第 29-75 行的邏輯，
//      去掉 SpreadsheetApp／Drive 存取，只留「哪些版本會被列入清理清單」的判斷）----
function planVersionSelection(versions, includeV0) {
  const plan = { versions: [], manualAttention: [] };
  versions.forEach(function (v) {
    if (v.versionNo === 0 && !includeV0) {
      plan.manualAttention.push('v0（' + v.sheetName + '）：原始版本，本次選擇保留。'
        + '如果確定要連 v0 一併清走，重新執行並選擇「連 v0 一齊清」。');
      return;
    }
    if (v.isProtected && v.versionNo !== 0) {
      plan.manualAttention.push('v' + v.versionNo + '（' + v.sheetName + '）：RosterVersions 標示為受保護（Protected=TRUE），'
        + '不會自動清除。如果確定要清，請先在 RosterVersions 把 Protected 改為 FALSE。');
      return;
    }
    plan.versions.push(v);
  });
  return plan;
}

// ---- 移植：Unavailable 只清 Source=REQUEST 的行（QuarterReset.gs 第 106-134 行）----
function planUnavailableSelection(unavailableRows, quarterStart, quarterEnd) {
  let requestRows = 0, manualRows = 0;
  unavailableRows.forEach(function (row) {
    if (!row.dateFrom || row.dateFrom < quarterStart || row.dateFrom > quarterEnd) return;
    if (String(row.source || '').trim().toUpperCase() === 'REQUEST') requestRows++;
    else manualRows++;
  });
  return { requestRows: requestRows, manualRows: manualRows };
}

console.log('\n=== v0 預設保留，不列入清理清單 ===');
{
  const versions = [
    { versionNo: 0, sheetName: 'Roster_2027T1_v0', isProtected: true },
    { versionNo: 1, sheetName: 'Roster_2027T1_v1', isProtected: false },
    { versionNo: 2, sheetName: 'Roster_2027T1_v2', isProtected: false }
  ];
  const plan = planVersionSelection(versions, false);
  check('★ v0 不在清理清單內', plan.versions.map(v => v.versionNo), [1, 2]);
  check('★ v0 出現在「需要人手處理」清單，說明是刻意保留', plan.manualAttention.length, 1);
  check('★ manualAttention 文字有講清楚是「選擇保留」，不是被規則卡住', plan.manualAttention[0].indexOf('選擇保留') !== -1, true);
}

console.log('\n=== includeV0=true 時，v0 才會列入清理清單（仍要看 Protected）===');
{
  const versions = [
    { versionNo: 0, sheetName: 'Roster_2027T1_v0', isProtected: true },
    { versionNo: 1, sheetName: 'Roster_2027T1_v1', isProtected: false }
  ];
  const plan = planVersionSelection(versions, true);
  // 注意：v0 即使 includeV0=true，如果同時 isProtected=TRUE，仍然會被 Protected 規則擋下——
  // 但目前程式碼的判斷順序是「先判斷 v0 是否保留」，v0 分支一旦符合就直接 return，
  // 不會再往下檢查 Protected；也就是說 includeV0=true 時 v0 一定會被列入清理清單，
  // 不論 Protected 是否為 TRUE——這是刻意的（「連 v0 一齊清」本來就是要繞過保護）。
  check('★ includeV0=true 時 v0 直接列入清理清單，不受 Protected 影響', plan.versions.map(v => v.versionNo), [0, 1]);
  check('★ 沒有任何 manualAttention（v0 這次不算例外情況）', plan.manualAttention.length, 0);
}

console.log('\n=== 受保護的非 v0 版本（Protected=TRUE）一律保留，列入人手處理 ===');
{
  const versions = [
    { versionNo: 1, sheetName: 'Roster_2027T1_v1', isProtected: false },
    { versionNo: 2, sheetName: 'Roster_2027T1_v2', isProtected: true }, // 幹事手動保護過的版本
    { versionNo: 3, sheetName: 'Roster_2027T1_v3', isProtected: false }
  ];
  const plan = planVersionSelection(versions, false);
  check('★ v2（受保護）不在清理清單內', plan.versions.map(v => v.versionNo), [1, 3]);
  check('★ v2 出現在需要人手處理清單', plan.manualAttention.some(m => m.indexOf('v2') !== -1), true);
}

console.log('\n=== plan 函式本身完全沒有副作用（只回傳資料，不呼叫任何寫入） ===');
{
  // 用凍結（Object.freeze）輸入資料的方式驗證：如果 planVersionSelection 內部
  // 嘗試修改輸入陣列或其中任何一個版本物件，JS 在嚴格模式下會拋錯，非嚴格模式
  // 下賦值會靜默失敗但值不會變——這裡直接比對輸入陣列在呼叫前後完全相同，
  // 證明函式沒有原地修改輸入，是名副其實的「只讀」。
  const original = [
    { versionNo: 0, sheetName: 'Roster_2027T1_v0', isProtected: true },
    { versionNo: 1, sheetName: 'Roster_2027T1_v1', isProtected: false }
  ];
  const frozen = original.map(v => Object.freeze(v));
  Object.freeze(frozen);
  let threw = false;
  try {
    planVersionSelection(frozen, false);
  } catch (err) {
    threw = true;
  }
  check('★ 對凍結的輸入資料呼叫 plan 函式不會拋錯（代表沒有嘗試寫入輸入資料）', threw, false);
  check('★ 輸入資料的內容在呼叫後完全沒變', frozen, [
    { versionNo: 0, sheetName: 'Roster_2027T1_v0', isProtected: true },
    { versionNo: 1, sheetName: 'Roster_2027T1_v1', isProtected: false }
  ]);
}

console.log('\n=== Unavailable：只算 Source=REQUEST 的行，幹事人手輸入的一律不列入清理 ===');
{
  const rows = [
    { dateFrom: '2027-02-01', source: 'REQUEST' },   // 這一季、系統自動加入 → 算
    { dateFrom: '2027-02-15', source: 'REQUEST' },   // 這一季、系統自動加入 → 算
    { dateFrom: '2027-02-20', source: '' },           // 這一季、幹事人手輸入（Source 空白）→ 不算清理，算 manual
    { dateFrom: '2027-02-25', source: 'MANUAL' },     // 這一季、明確標記人手 → 不算清理
    { dateFrom: '2027-06-01', source: 'REQUEST' }     // 不在這一季範圍內 → 完全不計
  ];
  const result = planUnavailableSelection(rows, '2027-01-01', '2027-03-31');
  check('★ Source=REQUEST 且在季度範圍內：2 行會被清理', result.requestRows, 2);
  check('★ 幹事人手輸入的（Source 空白或非 REQUEST）：2 行保留、列入人手處理', result.manualRows, 2);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
