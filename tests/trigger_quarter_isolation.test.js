// 階段 C（收尾輪）：dailyAutomationCheck_() 新增的「單一季度判斷失敗不拖累
// 其他季度」保護的回歸測試。
// 執行方式：node tests/trigger_quarter_isolation.test.js
//
// 背景：dailyAutomationCheck_() 原本對每個季度呼叫 computeAutomationSchedule_()／
// judgeGenerateAction_()／judgeRemindAction_() 時完全沒有 try/catch——如果某個
// 季度的資料壞到連「今天要不要做」都判斷不出來（例如 StartDate 是完全無法辨識
// 的自由文字，經 shiftDateString_() 產生 Invalid Date，Utilities.formatDate()
// 對 Invalid Date 會拋錯），整個 forEach 迴圈會在那一季直接中斷，排在後面的
// 季度全部不會被檢查到。這裡移植逐字對應正式碼的迴圈結構（Trigger.gs 的
// dailyAutomationCheck_()），驗證新增的 try/catch 確實把「單一季度判斷失敗」
// 限制在那一季，不影響其他季度。

// ---- 移植：dailyAutomationCheck_() 對每個季度的處理迴圈（逐字對應正式碼的
//      控制流程，底層業務函式換成可注入的假函式）----
function runQuarterLoop_(quarterIds, deps) {
  const report = [];
  quarterIds.forEach(function (quarterId) {
    if (!quarterId) return;
    try {
      const schedule = deps.computeAutomationSchedule_(quarterId);
      const generateJudgment = deps.judgeGenerateAction_(quarterId, schedule);
      report.push(deps.executeAutomationAction_(generateJudgment));

      const remindJudgment = deps.judgeRemindAction_(quarterId);
      report.push(deps.executeAutomationAction_(remindJudgment));
    } catch (err) {
      deps.writeAuditLog_({ action: 'AUTOMATION_QUARTER_JUDGE_ERROR', targetKey: quarterId, notes: err.message });
      report.push({ quarterId: quarterId, action: 'JUDGE', outcome: 'JUDGE_ERROR', detail: err.message });
    }
  });
  return report;
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== 全部季度資料正常時，逐一正常處理，report 依序包含每季 2 筆（GENERATE＋REMIND）===');
{
  const auditLogs = [];
  const report = runQuarterLoop_(['2026T4', '2027T1'], {
    computeAutomationSchedule_: function (quarterId) { return { generateDate: '2026-09-01' }; },
    judgeGenerateAction_: function (quarterId) { return { quarterId: quarterId, action: 'GENERATE', outcome: 'SKIPPED_NOT_DUE' }; },
    judgeRemindAction_: function (quarterId) { return { quarterId: quarterId, action: 'REMIND', outcome: 'SKIPPED_NOT_DUE' }; },
    executeAutomationAction_: function (judgment) { return judgment; },
    writeAuditLog_: function (r) { auditLogs.push(r); }
  });
  check('★ 兩個季度各自產生 2 筆結果，共 4 筆', report.length, 4);
  check('★ 沒有任何 JUDGE_ERROR', report.filter(r => r.outcome === 'JUDGE_ERROR').length, 0);
  check('★ 完全沒有寫入 AuditLog（沒有任何判斷失敗）', auditLogs.length, 0);
}

console.log('\n=== 第一個季度判斷階段拋錯（模擬 StartDate 壞資料）：第二個季度仍然要正常處理 ===');
{
  const auditLogs = [];
  const processedQuarters = [];
  const report = runQuarterLoop_(['2026T4_壞資料', '2027T1'], {
    computeAutomationSchedule_: function (quarterId) {
      processedQuarters.push(quarterId);
      if (quarterId === '2026T4_壞資料') throw new Error('模擬 Utilities.formatDate 對 Invalid Date 拋錯');
      return { generateDate: '2026-09-01' };
    },
    judgeGenerateAction_: function (quarterId) { return { quarterId: quarterId, action: 'GENERATE', outcome: 'SKIPPED_NOT_DUE' }; },
    judgeRemindAction_: function (quarterId) { return { quarterId: quarterId, action: 'REMIND', outcome: 'SKIPPED_NOT_DUE' }; },
    executeAutomationAction_: function (judgment) { return judgment; },
    writeAuditLog_: function (r) { auditLogs.push(r); }
  });

  check('★ 兩個季度都有被嘗試處理（第一個拋錯不阻止迴圈繼續跑第二個）',
    processedQuarters, ['2026T4_壞資料', '2027T1']);
  check('★ report 裡有第一季的 JUDGE_ERROR 項目',
    report.some(r => r.quarterId === '2026T4_壞資料' && r.outcome === 'JUDGE_ERROR'), true);
  check('★ JUDGE_ERROR 項目附帶原始錯誤訊息',
    report.find(r => r.quarterId === '2026T4_壞資料').detail, '模擬 Utilities.formatDate 對 Invalid Date 拋錯');
  check('★ 第二季（正常資料）仍然正常產生 2 筆結果（GENERATE＋REMIND）',
    report.filter(r => r.quarterId === '2027T1').length, 2);
  check('★ 判斷失敗有寫入 AuditLog，方便日後追查', auditLogs.length, 1);
  check('★ AuditLog 記錄的是失敗那一季', auditLogs[0].targetKey, '2026T4_壞資料');
}

console.log('\n=== 中間季度拋錯（不是第一個也不是最後一個）：前後兩季都要正常處理 ===');
{
  const processedQuarters = [];
  const report = runQuarterLoop_(['A', 'B_壞資料', 'C'], {
    computeAutomationSchedule_: function (quarterId) {
      processedQuarters.push(quarterId);
      if (quarterId === 'B_壞資料') throw new Error('模擬中間季度判斷失敗');
      return { generateDate: '2026-09-01' };
    },
    judgeGenerateAction_: function (quarterId) { return { quarterId: quarterId, action: 'GENERATE', outcome: 'SKIPPED_NOT_DUE' }; },
    judgeRemindAction_: function (quarterId) { return { quarterId: quarterId, action: 'REMIND', outcome: 'SKIPPED_NOT_DUE' }; },
    executeAutomationAction_: function (judgment) { return judgment; },
    writeAuditLog_: function () {}
  });

  check('★ 三個季度全部有被嘗試處理，次序不變', processedQuarters, ['A', 'B_壞資料', 'C']);
  check('★ A 季正常產生 2 筆結果', report.filter(r => r.quarterId === 'A').length, 2);
  check('★ B 季只有 1 筆 JUDGE_ERROR（不是 2 筆，因為判斷階段本身失敗，兩個 judge 都沒跑到）',
    report.filter(r => r.quarterId === 'B_壞資料').length, 1);
  check('★ C 季（排在壞資料季度之後）仍然正常產生 2 筆結果', report.filter(r => r.quarterId === 'C').length, 2);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
