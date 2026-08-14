// 階段 B2：SpecialSundays 對職事表生成影響的回歸測試。
// 執行方式：node tests/special_sundays_generation.test.js
// 測試對象是 Generator.gs 的 getSkipReason_()（純函式，判斷某崗位在某主日是否
// 整格留空），移植邏輯與正式碼逐字相同。崗位清單不寫死——用陣列迴圈驗證
// 「凡是在 SkipPostIDs 名單內的崗位都跳過、名單外的都不跳過」，不特別針對
// 某個崗位名字寫斷言。

const RULE_IDS = {
  NO_AUTO_GENERATE: 'HARD_NO_AUTO_PREACHER',
  COMMUNION_FIRST_SUNDAY: 'HARD_COMMUNION_FIRST_SUNDAY',
  SPECIAL_SUNDAY_SKIP: 'HARD_SPECIAL_SUNDAY_SKIP'
};
const POST_FREQUENCY = { WEEKLY: 'WEEKLY', FIRST_SUNDAY: 'FIRST_SUNDAY', AS_NEEDED: 'AS_NEEDED' };

// ---- 移植：Generator.gs 的 isRuleEnabled_()（簡化：直接吃一個 {ruleId: enabled} 物件）----
function isRuleEnabled_(rules, ruleId) {
  return !!rules[ruleId];
}

// ---- 移植：Generator.gs 的 getSkipReason_()（逐字相同的判斷順序與條件）----
function getSkipReason_(post, serviceDate, special, rules) {
  if (!post.autoGenerate && isRuleEnabled_(rules, RULE_IDS.NO_AUTO_GENERATE)) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '此崗位 AutoGenerate=FALSE，系統不自動派人' };
  }
  if (post.frequency === POST_FREQUENCY.FIRST_SUNDAY
      && !serviceDate.isFirstSundayOfMonth
      && isRuleEnabled_(rules, RULE_IDS.COMMUNION_FIRST_SUNDAY)) {
    return { ruleId: RULE_IDS.COMMUNION_FIRST_SUNDAY, reason: '此崗位只在每月第一個主日安排' };
  }
  if (post.frequency === POST_FREQUENCY.AS_NEEDED) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '此崗位 Frequency=AS_NEEDED，按需要人手安排' };
  }
  if (special.skipPostIds.indexOf(post.postId) !== -1) {
    return { ruleId: RULE_IDS.SPECIAL_SUNDAY_SKIP, reason: '此崗位在該特別主日的 SkipPostIDs 名單內' };
  }
  if (!serviceDate.autoGenerate) {
    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: '該主日 AutoGenerate=FALSE' };
  }
  return null;
}

// ---- 移植：Generator.gs 呼叫端組 special 物件的邏輯（buildGeneratorContext_() 與
//      主迴圈 const special = context.specialByDate[serviceDate.serviceDate] || { skipPostIds: [], lockPostIds: [] };）----
function resolveSpecialForDate(specialByDate, dateStr) {
  return specialByDate[dateStr] || { skipPostIds: [], lockPostIds: [] };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const rulesAllEnabled = {
  [RULE_IDS.NO_AUTO_GENERATE]: true,
  [RULE_IDS.COMMUNION_FIRST_SUNDAY]: true
};
const normalServiceDate = { serviceDate: '2027-05-02', isFirstSundayOfMonth: false, autoGenerate: true };

// 一批虛構崗位，涵蓋一般週崗位——刻意用假 PostID（P1..P6），不寫死任何真實崗位名稱。
function makePosts() {
  return [
    { postId: 'P1', frequency: POST_FREQUENCY.WEEKLY, autoGenerate: true },
    { postId: 'P2', frequency: POST_FREQUENCY.WEEKLY, autoGenerate: true },
    { postId: 'P3', frequency: POST_FREQUENCY.WEEKLY, autoGenerate: true },
    { postId: 'P4', frequency: POST_FREQUENCY.WEEKLY, autoGenerate: true },
    { postId: 'P5', frequency: POST_FREQUENCY.WEEKLY, autoGenerate: true }
  ];
}

console.log('\n=== 某週標記合堂，指定崗位跳過自動生成，其餘崗位照常 ===');
{
  const posts = makePosts();
  const skipPostIds = ['P2', 'P4']; // 「指定崗位」——不寫死是哪個真實崗位，只用假 ID
  const special = { skipPostIds: skipPostIds, lockPostIds: [] };

  const results = posts.map(function (p) {
    return { postId: p.postId, skip: getSkipReason_(p, normalServiceDate, special, rulesAllEnabled) };
  });

  results.forEach(function (r) {
    const shouldSkip = skipPostIds.indexOf(r.postId) !== -1;
    check('★ ' + r.postId + (shouldSkip ? ' 在 SkipPostIDs 名單內 → 應該跳過' : ' 不在名單內 → 不應該跳過（照常）'),
      !!r.skip, shouldSkip);
    if (shouldSkip) {
      check('★ ' + r.postId + ' 跳過原因是 SPECIAL_SUNDAY_SKIP（不是其他規則）',
        r.skip.ruleId, RULE_IDS.SPECIAL_SUNDAY_SKIP);
    }
  });
}

console.log('\n=== 浸禮：也是用同一個 skipPostIds 機制，Type 文字本身程式完全不讀 ===');
{
  // roster_patterns_rules.md／SpecialSundaysSeed.gs 檔頭都明確說 Type 欄只是給人看的
  // 自由文字，getSkipReason_() 完全不看 Type，只看 skipPostIds——這裡驗證換一個
  // Type 的情境（浸禮），同一套判斷邏輯照樣正確運作，不需要也不應該有 if (Type==='浸禮')
  // 這種寫死的分支。
  const posts = makePosts();
  const skipPostIds = ['P1']; // 浸禮週假設只跳過一個崗位（例如主席欄有特別註明）
  const special = { skipPostIds: skipPostIds, lockPostIds: [] };
  const results = posts.map(function (p) { return getSkipReason_(p, normalServiceDate, special, rulesAllEnabled); });
  check('★ 浸禮週：只有 P1 跳過', results.map(r => !!r), [true, false, false, false, false]);
  check('★ 浸禮週：P1 的跳過原因是 SPECIAL_SUNDAY_SKIP', results[0].ruleId, RULE_IDS.SPECIAL_SUNDAY_SKIP);
}

console.log('\n=== 宣教月：同一機制，跳過的崗位集合可以完全不同 ===');
{
  const posts = makePosts();
  const skipPostIds = ['P3', 'P5'];
  const special = { skipPostIds: skipPostIds, lockPostIds: [] };
  const results = posts.map(function (p) { return getSkipReason_(p, normalServiceDate, special, rulesAllEnabled); });
  check('★ 宣教月：P3、P5 跳過，其餘照常', results.map(r => !!r), [false, false, true, false, true]);
}

console.log('\n=== SpecialID 空白（該主日完全沒有 SpecialSundays 紀錄）：行為與未標記完全相同 ===');
{
  const posts = makePosts();
  const specialByDate = {}; // 這一天完全沒有 SpecialSundays 的 Active 紀錄
  const special = resolveSpecialForDate(specialByDate, normalServiceDate.serviceDate);
  check('★ special 物件退回空陣列（不是 undefined、不會拋錯）', special, { skipPostIds: [], lockPostIds: [] });

  const results = posts.map(function (p) { return getSkipReason_(p, normalServiceDate, special, rulesAllEnabled); });
  check('★ 沒有任何崗位因為「特別主日」而跳過', results.every(r => r === null), true);

  // 對照組：同一批崗位、同一個主日，但這次真的標記了 SkipPostIDs，確認「有標記」
  // 與「完全沒有標記」兩種情況的差異只在於有沒有進 specialByDate，判斷邏輯本身
  // 完全一致（都是呼叫同一個 getSkipReason_()，不是兩套邏輯）。
  const specialByDateWithEntry = { [normalServiceDate.serviceDate]: { specialId: 'SP1', skipPostIds: ['P1'], lockPostIds: [] } };
  const specialWithEntry = resolveSpecialForDate(specialByDateWithEntry, normalServiceDate.serviceDate);
  const resultsWithEntry = posts.map(function (p) { return getSkipReason_(p, normalServiceDate, specialWithEntry, rulesAllEnabled); });
  check('★ 有標記時 P1 才跳過（證明兩種情境走的是同一套邏輯，差異只在 special 內容）',
    resultsWithEntry.map(r => !!r), [true, false, false, false, false]);
}

console.log('\n=== SPECIAL_SUNDAY_SKIP 規則本身 Enabled=FALSE 時：不受 rules 影響（這條規則沒有走 isRuleEnabled_ 檢查）===');
{
  // 特別注意：getSkipReason_() 的 SpecialSundays 分支（第 4 個 if）跟其他分支不同，
  // 完全沒有呼叫 isRuleEnabled_()——只要在 skipPostIds 名單內就一定跳過，
  // 不受 RuleSettings 的 Enabled 欄影響。這裡驗證這個「不受規則開關控制」的行為，
  // 避免日後有人誤以為它跟其他規則一樣可以用 RuleSettings 關掉。
  const posts = makePosts();
  const special = { skipPostIds: ['P2'], lockPostIds: [] };
  const rulesWithSkipDisabled = Object.assign({}, rulesAllEnabled, { [RULE_IDS.SPECIAL_SUNDAY_SKIP]: false });
  const result = getSkipReason_(posts[1], normalServiceDate, special, rulesWithSkipDisabled);
  check('★ 即使 RuleSettings 沒有這個 RuleID 的 Enabled 值，P2 仍然跳過', !!result, true);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
