// 階段 F（第五輪批次）：全面體檢——嚴重度分級與整合邏輯的回歸測試。
// 執行方式：node tests/full_health_check.test.js
//
// 這裡只測「分級」與「整合」這兩件事本身的邏輯（逐字對應 src/FullHealthCheck.gs
// 的 classify*Health_() 函式群），不測底層各個 build*/scan*/plan*() 函式本身
// ——那些已經各自有既有測試覆蓋（config_display_fallback／pending_requests_scan／
// pdf_cleanup 等），這裡假設它們回傳的資料結構正確，只驗證「拿到這些資料之後，
// 全面體檢會不會分對級、會不會漏掉東西、會不會重複顯示」。

const HEALTH_SEVERITY = { MUST: '必須處理', SHOULD: '建議處理', INFO: '資訊' };

function healthItem_(section, severity, label, summary, note, details) {
  return { section: section, severity: severity, label: label, summary: summary, note: note, details: details || [] };
}

// ---- 移植：classifySetupHealth_ ----
function classifySetupHealth_(issues) {
  return healthItem_('檢查設定', issues.length > 0 ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.INFO,
    '基本設定檢查', issues.length + ' 個問題',
    issues.length === 0 ? '沒有發現問題。' : '以下設定問題會直接影響核心功能，建議優先處理：',
    issues.map(String));
}

// ---- 移植：classifyConfigRowHealth_ ----
function classifyConfigRowHealth_(audit) {
  const dupKeys = Object.keys(audit.duplicateKeys);
  const problems = audit.blankKeyRows.length + dupKeys.length + audit.missingFromSheet.length;
  const details = [];
  if (audit.blankKeyRows.length > 0) details.push('Key 完全空白的列：行號 ' + audit.blankKeyRows.join(', '));
  dupKeys.forEach(function (k) { details.push('重複 Key：' + k + '　行號 ' + audit.duplicateKeys[k].join(', ')); });
  if (audit.missingFromSheet.length > 0) {
    details.push('CONFIG_KEYS 已登記但工作表沒有這個 Key：' + audit.missingFromSheet.join('、'));
  }
  if (audit.extraInSheet.length > 0) {
    details.push('（僅供參考）工作表有但 CONFIG_KEYS 沒有登記：' + audit.extraInSheet.join('、'));
  }
  return healthItem_('Config 行數', problems > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO,
    'Config 工作表資料整潔度', problems + ' 項整潔問題',
    problems === 0 ? '整潔。' : '有整潔問題。', details);
}

// ---- 移植：classifyEmailTemplatesHealth_ ----
function classifyEmailTemplatesHealth_(results) {
  const details = [];
  let mustCount = 0, shouldCount = 0;
  results.forEach(function (r) {
    const problems = [];
    if (r.unresolvedAfterRender.length > 0) {
      problems.push('有變數沒有真的代入：' + r.unresolvedAfterRender.join('、'));
      if (r.active) mustCount++; else shouldCount++;
    }
    if (r.bothBodiesEmpty) { problems.push('BodyHtml／BodyPlain 都是空白'); shouldCount++; }
    if (r.looksLikeTestSubject) { problems.push('完整主旨含測試字眼'); shouldCount++; }
    if (problems.length > 0) details.push(r.templateId + '：' + problems.join('；'));
  });
  const severity = mustCount > 0 ? HEALTH_SEVERITY.MUST : (shouldCount > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO);
  return healthItem_('電郵範本自我檢查', severity, 'EmailTemplates 逐一自我檢查',
    results.length + ' 個範本，' + details.length + ' 個有問題', '', details);
}

// ---- 移植：classifyRequestsHealth_ ----
function classifyRequestsHealth_(pendingAcrossQuarters) {
  const officialSentWithPending = pendingAcrossQuarters.filter(function (r) { return r.isOfficialSentWithPending; });
  const totalConflicts = pendingAcrossQuarters.reduce(function (sum, r) { return sum + r.conflictCount; }, 0);
  const severity = (officialSentWithPending.length > 0 || totalConflicts > 0) ? HEALTH_SEVERITY.MUST
    : (pendingAcrossQuarters.length > 0 ? HEALTH_SEVERITY.SHOULD : HEALTH_SEVERITY.INFO);
  return healthItem_('Requests 殘留', severity, '全部季度的待處理 Requests 殘留',
    pendingAcrossQuarters.length + ' 個季度有待處理申報', '', []);
}

// ---- 移植：classifyPreLaunchChecklistHealth_（含白名單升級＋排除清單）----
const HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS = ['最新版本是否仍有未解決的硬規則違反'];
const HEALTH_PRELAUNCH_EXCLUDE_LABEL_SUBSTRINGS = ['全部季度的待處理 Requests 殘留', 'EmailRecipients 每個收件人'];

function classifyPreLaunchChecklistHealth_(checklistResult) {
  const items = checklistResult.items.filter(function (it) {
    return !HEALTH_PRELAUNCH_EXCLUDE_LABEL_SUBSTRINGS.some(function (sub) { return it.label.indexOf(sub) !== -1; });
  });
  const notReady = items.filter(function (it) { return !it.ready; });
  const results = notReady.map(function (it) {
    const isMust = HEALTH_PRELAUNCH_MUST_LABEL_SUBSTRINGS.some(function (sub) { return it.label.indexOf(sub) !== -1; });
    return healthItem_('上線前檢查', isMust ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.SHOULD,
      it.label, it.value, it.guidance, it.details);
  });
  if (results.length === 0) {
    results.push(healthItem_('上線前檢查', HEALTH_SEVERITY.INFO, checklistResult.quarterId + ' 上線前檢查',
      '全部已就緒', '', []));
  }
  return results;
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== F：檢查設定——有問題一律 MUST，沒問題 INFO ===');
{
  check('★ 有 2 個問題 → MUST', classifySetupHealth_(['問題A', '問題B']).severity, HEALTH_SEVERITY.MUST);
  check('★ 沒有問題 → INFO', classifySetupHealth_([]).severity, HEALTH_SEVERITY.INFO);
}

console.log('\n=== F：Config 行數——整潔問題一律 SHOULD（不是 MUST），完全乾淨才 INFO ===');
{
  const dirty = { blankKeyRows: [5], duplicateKeys: {}, missingFromSheet: ['SOME_KEY'], extraInSheet: [] };
  check('★ 有整潔問題 → SHOULD（不是 MUST，因為不一定立即影響運作）', classifyConfigRowHealth_(dirty).severity, HEALTH_SEVERITY.SHOULD);
  const clean = { blankKeyRows: [], duplicateKeys: {}, missingFromSheet: [], extraInSheet: [] };
  check('★ 完全乾淨 → INFO', classifyConfigRowHealth_(clean).severity, HEALTH_SEVERITY.INFO);
  const onlyExtra = { blankKeyRows: [], duplicateKeys: {}, missingFromSheet: [], extraInSheet: ['OLD_KEY'] };
  check('★ 只有「工作表有但程式碼無」（extraInSheet）不算整潔問題 → INFO', classifyConfigRowHealth_(onlyExtra).severity, HEALTH_SEVERITY.INFO);
}

console.log('\n=== F：電郵範本自我檢查——啟用中的範本有未代入變數 → MUST；未啟用的同樣問題只 SHOULD ===');
{
  const withActiveUnresolved = [
    { templateId: 'TPL_A', stage: 'OFFICIAL', active: true, unresolvedAfterRender: ['{Foo}'], bothBodiesEmpty: false, looksLikeTestSubject: false }
  ];
  check('★ Active=TRUE 且有未代入變數 → MUST', classifyEmailTemplatesHealth_(withActiveUnresolved).severity, HEALTH_SEVERITY.MUST);

  const withInactiveUnresolved = [
    { templateId: 'TPL_B', stage: 'OFFICIAL', active: false, unresolvedAfterRender: ['{Foo}'], bothBodiesEmpty: false, looksLikeTestSubject: false }
  ];
  check('★ Active=FALSE 但有未代入變數 → 只 SHOULD（未啟用中，目前不會真的寄出）',
    classifyEmailTemplatesHealth_(withInactiveUnresolved).severity, HEALTH_SEVERITY.SHOULD);

  const allClean = [
    { templateId: 'TPL_C', stage: 'REMIND', active: true, unresolvedAfterRender: [], bothBodiesEmpty: false, looksLikeTestSubject: false }
  ];
  check('★ 全部正常 → INFO', classifyEmailTemplatesHealth_(allClean).severity, HEALTH_SEVERITY.INFO);

  const testSubjectOnly = [
    { templateId: 'TPL_D', stage: 'REVIEW', active: true, unresolvedAfterRender: [], bothBodiesEmpty: false, looksLikeTestSubject: true }
  ];
  check('★ 只有主旨疑似測試字眼（沒有未代入變數）→ SHOULD（不是 MUST）',
    classifyEmailTemplatesHealth_(testSubjectOnly).severity, HEALTH_SEVERITY.SHOULD);
}

console.log('\n=== F：Requests 殘留——矛盾組合或 OFFICIAL_SENT 仍殘留 → MUST；單純待處理 → SHOULD；完全沒有 → INFO ===');
{
  const withConflict = [{ quarterId: '2026T4', stage: 'DRAFT', pendingCount: 2, isOfficialSentWithPending: false, conflictCount: 1 }];
  check('★ 有矛盾組合 → MUST', classifyRequestsHealth_(withConflict).severity, HEALTH_SEVERITY.MUST);

  const officialSentPending = [{ quarterId: '2026T3', stage: 'OFFICIAL_SENT', pendingCount: 1, isOfficialSentWithPending: true, conflictCount: 0 }];
  check('★ 已 OFFICIAL_SENT 仍有殘留 → MUST', classifyRequestsHealth_(officialSentPending).severity, HEALTH_SEVERITY.MUST);

  const justPending = [{ quarterId: '2027T1', stage: 'REVIEW_SENT', pendingCount: 3, isOfficialSentWithPending: false, conflictCount: 0 }];
  check('★ 只是單純待處理，沒有矛盾也不是 OFFICIAL_SENT → SHOULD', classifyRequestsHealth_(justPending).severity, HEALTH_SEVERITY.SHOULD);

  check('★ 完全沒有殘留 → INFO', classifyRequestsHealth_([]).severity, HEALTH_SEVERITY.INFO);
}

console.log('\n=== F：上線前檢查整合——DRY_RUN 仍是 TRUE 這類「有意選擇」的不就緒項目不會被誤判成 MUST ===');
{
  // 模擬 buildPreLaunchChecklist_ 的真實回傳形狀：DRY_RUN 項目 ready=false 代表
  // 「仍在安全的測試模式」，這是刻意的、正常的狀態，不應該被全面體檢誤判成
  // 必須處理的問題——這是這次分級邏輯設計時最容易寫錯的地方。
  const checklistResult = {
    quarterId: '2027T1',
    items: [
      { label: 'DRY_RUN（是否仍在模擬寄信模式）', ready: false, value: 'TRUE', guidance: '安全的測試狀態', details: [] },
      { label: '最新版本是否仍有未解決的硬規則違反', ready: false, value: '硬規則違反：2 項', guidance: '請處理', details: ['違反1', '違反2'] },
      { label: '全部季度的待處理 Requests 殘留（不限本次輸入的季度）', ready: false, value: '1 個季度有殘留', guidance: '', details: [] },
      { label: 'EmailRecipients 每個收件人實際會收到的階段', ready: true, value: '3 個收件人', guidance: '', details: [] }
    ]
  };
  const results = classifyPreLaunchChecklistHealth_(checklistResult);

  check('★ 排除了「全部季度的待處理 Requests 殘留」與「EmailRecipients」兩個全域重複項目，只剩 2 項',
    results.length, 2);
  check('★ DRY_RUN 不就緒 → 降為 SHOULD（不是 MUST，因為這是有意的安全預設狀態）',
    results.find(r => r.label.indexOf('DRY_RUN') !== -1).severity, HEALTH_SEVERITY.SHOULD);
  check('★ 硬規則違反不就緒 → 白名單命中，升級為 MUST',
    results.find(r => r.label.indexOf('硬規則違反') !== -1).severity, HEALTH_SEVERITY.MUST);
}

console.log('\n=== F：上線前檢查整合——全部就緒時回傳單一 INFO 項目，不是空陣列（避免報告完全沒有這一段） ===');
{
  const allReadyChecklist = {
    quarterId: '2027T2',
    items: [
      { label: 'DRY_RUN（是否仍在模擬寄信模式）', ready: true, value: '', guidance: '', details: [] },
      { label: '全部季度的待處理 Requests 殘留（不限本次輸入的季度）', ready: false, value: '', guidance: '', details: [] } // 會被排除，不影響「全部就緒」的判斷
    ]
  };
  const results = classifyPreLaunchChecklistHealth_(allReadyChecklist);
  check('★ 排除全域重複項目後，其餘全部就緒 → 回傳 1 個 INFO 項目', results.length, 1);
  check('★ 那個項目是 INFO', results[0].severity, HEALTH_SEVERITY.INFO);
}

console.log('\n=== F：整體嚴重度計數彙總——模擬 buildFullHealthCheckReport_() 最後的 count 邏輯 ===');
{
  const sections = [
    classifySetupHealth_(['問題A']),           // MUST
    classifyConfigRowHealth_({ blankKeyRows: [], duplicateKeys: {}, missingFromSheet: [], extraInSheet: [] }), // INFO
    classifyRequestsHealth_([{ quarterId: 'X', stage: 'DRAFT', pendingCount: 1, isOfficialSentWithPending: false, conflictCount: 0 }]) // SHOULD
  ];
  const mustCount = sections.filter(s => s.severity === HEALTH_SEVERITY.MUST).length;
  const shouldCount = sections.filter(s => s.severity === HEALTH_SEVERITY.SHOULD).length;
  const infoCount = sections.filter(s => s.severity === HEALTH_SEVERITY.INFO).length;
  check('★ mustCount=1, shouldCount=1, infoCount=1', [mustCount, shouldCount, infoCount], [1, 1, 1]);
}

console.log('\n=== F：單一檢查失敗不影響其餘檢查（模擬 buildFullHealthCheckReport_() 的 try/catch 隔離）===');
{
  function run(sectionsArr, fn) {
    try {
      sectionsArr.push(fn());
    } catch (err) {
      sectionsArr.push(healthItem_('（執行失敗）', HEALTH_SEVERITY.MUST, fn.name || '未知檢查', '執行失敗', err.message, []));
    }
  }
  const sections = [];
  run(sections, function () { return classifySetupHealth_([]); }); // 正常
  run(sections, function () { throw new Error('模擬 Drive API 逾時'); }); // 失敗
  run(sections, function () { return classifySetupHealth_(['真的有問題']); }); // 正常，MUST

  check('★ 三個檢查都有結果（失敗的那個沒有讓後面的檢查被跳過）', sections.length, 3);
  check('★ 第一個檢查正常完成，是 INFO', sections[0].severity, HEALTH_SEVERITY.INFO);
  check('★ 第二個檢查失敗，被記為 MUST「執行失敗」', sections[1].severity, HEALTH_SEVERITY.MUST);
  check('★ 第二個檢查的備註帶有原始錯誤訊息', sections[1].note, '模擬 Drive API 逾時');
  check('★ 第三個檢查（在失敗的檢查之後）仍然正常執行，不受影響', sections[2].severity, HEALTH_SEVERITY.MUST);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
