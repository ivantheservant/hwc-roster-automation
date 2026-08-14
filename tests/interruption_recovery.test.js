// 階段 A（收尾輪）：中斷復原相關新邏輯的回歸測試。
// 執行方式：node tests/interruption_recovery.test.js
// 兩個對象：
// (1) countAlreadySentForStage_()（Mailer.gs 新函式）——步驟 2／4 確認視窗
//     用來偵測「這個版本＋階段好像已經寄過」的純邏輯；
// (2) applyRequests_()（RequestsApply.gs）新增的孤兒版本保護——
//     registerVersion 之後的五個寫入包一層 try/catch，任何一步失敗都要
//     拋出講清楚「已經寫了什麼、要怎麼人手復原」的錯誤訊息，逐字對應正式碼。

// ---- 移植：countAlreadySentForStage_()（Mailer.gs，SendLog 換成假陣列）----
const MAIL_STATUS = { SENT: 'SENT', DRY_RUN: 'DRY_RUN', FAILED: 'FAILED', SKIPPED_NO_EMAIL: 'SKIPPED_NO_EMAIL' };
function countAlreadySentForStage_(sendLogRows, quarterId, versionNo, stage) {
  const baselineStatuses = [MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN];
  const seen = {};
  sendLogRows.forEach(function (row) {
    if (row.quarterId !== quarterId) return;
    if (Number(row.versionNo) !== versionNo) return;
    if (row.stage !== stage) return;
    if (baselineStatuses.indexOf(String(row.status || '').toUpperCase()) === -1) return;
    const key = row.personId || row.email;
    if (key) seen[key] = true;
  });
  return Object.keys(seen).length;
}

// ---- 移植：applyRequests_() 新增的孤兒版本保護段落（逐字對應正式碼的
//      try/catch 與錯誤訊息組成，寫入動作換成可注入的假函式）----
function applyRequestsWriteSequence_(sheetName, quarterId, newVersionNo, writers) {
  let newEligibilityCount = 0;
  let newUnavailableCount = 0;
  try {
    writers.registerVersion();
    writers.markPendingBackfillCells();
    newEligibilityCount = writers.writeNewEligibilityRows();
    newUnavailableCount = writers.writeNewUnavailableRows();
    writers.writeRequestOutcomes();
  } catch (err) {
    throw new Error(
      '套用申報時，工作表 ' + sheetName + ' 與 RosterAssignments 的派工紀錄已經寫入成功，'
        + '但後續登記（RosterVersions／待補格子底色／Eligibility／Unavailable／'
        + 'Requests 處理結果其中一步）失敗（' + err.message + '），流程中途停住了。\n\n'
        + '需要人手處理，建議：\n'
        + '1. 打開 Requests 工作表，檢查這批申報的 RequestID 欄是否已填上——'
        + '仍是空白代表系統還沒把這批標記為「已處理」，重新執行本步驟會再處理一次；\n'
        + '2. 打開 RosterVersions，檢查有沒有 ' + quarterId + '-v' + newVersionNo + ' 這一行——'
        + '沒有的話，' + sheetName + ' 是系統找不到的孤兒版本，重新執行本步驟前'
        + '建議先人手刪除它（連同 RosterAssignments 中 QuarterID=' + quarterId
        + '、VersionNo=' + newVersionNo + ' 的所有列），否則下次執行會因為工作表名稱'
        + '衝突而立即失敗；\n'
        + '3. 完整症狀對照與復原步驟見 docs/中斷復原指引.md「步驟 3／5：套用修改申報'
        + '中途失敗」一節。'
    );
  }
  return { newEligibilityCount: newEligibilityCount, newUnavailableCount: newUnavailableCount };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkThrows(label, fn, messageSubstrings) {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label}（沒有拋出錯誤）`);
  } catch (err) {
    const missing = (messageSubstrings || []).filter(function (s) { return err.message.indexOf(s) === -1; });
    if (missing.length === 0) {
      console.log(`PASS  ${label}`);
    } else {
      fail++;
      console.log(`FAIL  ${label}（訊息缺少：${missing.join('、')}）\n      實際訊息=${err.message}`);
    }
  }
}

console.log('\n=== countAlreadySentForStage_：偵測「這個版本＋階段已經寄過」===');
{
  const sendLog = [
    { quarterId: '2027T1', versionNo: 3, stage: 'OFFICIAL', personId: 'P001', email: '', status: 'SENT' },
    { quarterId: '2027T1', versionNo: 3, stage: 'OFFICIAL', personId: 'P002', email: '', status: 'DRY_RUN' },
    { quarterId: '2027T1', versionNo: 3, stage: 'OFFICIAL', personId: 'P003', email: '', status: 'FAILED' }, // 失敗不算「已寄過」
    { quarterId: '2027T1', versionNo: 2, stage: 'OFFICIAL', personId: 'P004', email: '', status: 'SENT' }, // 舊版本不算
    { quarterId: '2027T1', versionNo: 3, stage: 'REVIEW', personId: '', email: 'x@x.com', status: 'SENT' } // 不同階段不算
  ];
  check('★ v3 OFFICIAL 已有 2 位（SENT + DRY_RUN），FAILED／舊版本／不同階段都不計入',
    countAlreadySentForStage_(sendLog, '2027T1', 3, 'OFFICIAL'), 2);
  check('★ 完全沒有紀錄的版本 → 0', countAlreadySentForStage_(sendLog, '2027T1', 9, 'OFFICIAL'), 0);
}

console.log('\n=== countAlreadySentForStage_：同一人多筆紀錄只算一次（去重）===');
{
  const sendLog = [
    { quarterId: '2027T1', versionNo: 4, stage: 'OFFICIAL', personId: 'P001', email: '', status: 'SENT' },
    { quarterId: '2027T1', versionNo: 4, stage: 'OFFICIAL', personId: 'P001', email: '', status: 'SENT' } // 同一人重複紀錄
  ];
  check('★ 同一 PersonID 出現兩次只算 1 人', countAlreadySentForStage_(sendLog, '2027T1', 4, 'OFFICIAL'), 1);
}

console.log('\n=== countAlreadySentForStage_：LIST 收件人用 Email 當識別鍵（沒有 PersonID）===');
{
  const sendLog = [
    { quarterId: '2027T1', versionNo: 5, stage: 'REVIEW', personId: '', email: 'reviewer@x.com', status: 'SENT' }
  ];
  check('★ LIST 收件人（PersonID 空白）用 Email 辨識，正確算入', countAlreadySentForStage_(sendLog, '2027T1', 5, 'REVIEW'), 1);
}

console.log('\n=== applyRequests_ 孤兒版本保護：全部寫入成功時正常回傳，不拋錯 ===');
{
  const calls = [];
  const result = applyRequestsWriteSequence_('Roster_2027T1_v11', '2027T1', 11, {
    registerVersion: function () { calls.push('registerVersion'); },
    markPendingBackfillCells: function () { calls.push('markPendingBackfillCells'); },
    writeNewEligibilityRows: function () { calls.push('writeNewEligibilityRows'); return 2; },
    writeNewUnavailableRows: function () { calls.push('writeNewUnavailableRows'); return 1; },
    writeRequestOutcomes: function () { calls.push('writeRequestOutcomes'); }
  });
  check('★ 五個寫入按順序全部執行', calls,
    ['registerVersion', 'markPendingBackfillCells', 'writeNewEligibilityRows', 'writeNewUnavailableRows', 'writeRequestOutcomes']);
  check('★ 正確回傳兩個計數', result, { newEligibilityCount: 2, newUnavailableCount: 1 });
}

console.log('\n=== applyRequests_ 孤兒版本保護：registerVersion 失敗 → 拋出孤兒版本錯誤訊息 ===');
{
  checkThrows('★ registerVersion 失敗時的錯誤訊息包含工作表名、季度版本、RequestID／RosterVersions 檢查指引',
    function () {
      applyRequestsWriteSequence_('Roster_2027T1_v11', '2027T1', 11, {
        registerVersion: function () { throw new Error('模擬 RosterVersions 寫入配額錯誤'); },
        markPendingBackfillCells: function () { throw new Error('不應該執行到這裡'); },
        writeNewEligibilityRows: function () { throw new Error('不應該執行到這裡'); },
        writeNewUnavailableRows: function () { throw new Error('不應該執行到這裡'); },
        writeRequestOutcomes: function () { throw new Error('不應該執行到這裡'); }
      });
    },
    ['Roster_2027T1_v11', '模擬 RosterVersions 寫入配額錯誤', '2027T1-v11', 'RequestID', 'RosterVersions', '孤兒版本', 'docs/中斷復原指引.md']
  );
}

console.log('\n=== applyRequests_ 孤兒版本保護：最後一步（writeRequestOutcomes）才失敗，一樣要示警 ===');
{
  const calls = [];
  checkThrows('★ 即使前四步都成功，最後一步失敗仍然拋出同一種孤兒版本錯誤（此時 RosterVersions 其實已經有登記）',
    function () {
      applyRequestsWriteSequence_('Roster_2027T1_v12', '2027T1', 12, {
        registerVersion: function () { calls.push('registerVersion'); },
        markPendingBackfillCells: function () { calls.push('markPendingBackfillCells'); },
        writeNewEligibilityRows: function () { calls.push('writeNewEligibilityRows'); return 0; },
        writeNewUnavailableRows: function () { calls.push('writeNewUnavailableRows'); return 0; },
        writeRequestOutcomes: function () { calls.push('writeRequestOutcomes'); throw new Error('模擬 Requests 寫入時逾時'); }
      });
    },
    ['Roster_2027T1_v12', '模擬 Requests 寫入時逾時', 'RequestID']
  );
  check('★ 前四步＋第五步本身都確實執行過（不是提早中斷，是第五步執行到一半才失敗）', calls,
    ['registerVersion', 'markPendingBackfillCells', 'writeNewEligibilityRows', 'writeNewUnavailableRows', 'writeRequestOutcomes']);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
