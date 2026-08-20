// 第十七輪批次階段 D：兩條身分硬規則嘅違規訊息可讀性。
// FIXTURE-OK: 呢度砌嘅係規則檢查嘅派工狀態陣列（純函式輸入），
// 全部係 `AUTO` ＋ 有 personId 嘅正常格——生成器真正會產生嘅形狀。
// 執行方式：node tests/role_violation_messages.test.js
//
// 點解要有呢個測試檔：新規則會令幹事見到「點解呢個人唔見咗」。訊息寫得
// 唔清楚，佢會當係 bug 然後嚟問——所以訊息本身就係一個要守住嘅介面。
//
// 斷言方式一律用**關鍵字**（「教會」「不是系統錯誤」「堂委」……），
// 唔逐字比對成句——逐字比對嘅話，日後改一個標點都會爆測試，
// 結果就係大家開始隨手改測試遷就實作，測試就失效咗。

const fs = require('fs');
const path = require('path');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'DraftReviewReport.gs']));

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

const ANNOUNCE = { postId: 'ANNOUNCE', postNameTC: '報告' };
const CHAIR = { postId: 'CHAIR', postNameTC: '主席' };

console.log('\n=== D1【核心】HARD_ROLE_REQUIRED 訊息三要素 ===');
{
  const msg = gas.buildRoleRequiredReason_(ANNOUNCE, ['COMMITTEE'], '2027-05-02');

  check('★★★★★ 要素 1：崗位**中文名**（唔可以淨係 PostID，幹事唔記得代號）',
    msg.indexOf('報告') !== -1, msg);
  check('★★★★★ 要素 2：所需身分嘅**中文名**（「堂委」而唔係 COMMITTEE）',
    msg.indexOf('堂委') !== -1, msg);
  check('★★★★★ 要素 3：明確講「這是教會規定」同「不是系統錯誤」',
    msg.indexOf('教會') !== -1 && msg.indexOf('不是系統錯誤') !== -1, msg);
  check('★★★★ 有講出係邊一日（同一個人可能只喺部分週次唔合資格）',
    msg.indexOf('2027-05-02') !== -1, msg);
  check('★★★ 有講出可以點處理（去邊張表補生效日期）',
    msg.indexOf(gas.SHEETS.ROLES) !== -1, msg);
  check('★★★ 唔會漏咗英文代號出街（幹事睇唔明 COMMITTEE）',
    msg.indexOf('COMMITTEE') === -1, msg);
}

console.log('\n=== D1：多身分要求要講「或」（反映 OR 語意）===');
{
  const msg = gas.buildRoleRequiredReason_(
    { postId: 'DEACON', postNameTC: '當值堂委' }, ['COMMITTEE', 'DEACON'], '2027-05-02');
  check('★★★★ 兩個身分都出現而且用「或」連接',
    msg.indexOf('堂委') !== -1 && msg.indexOf('執事') !== -1 && msg.indexOf('或') !== -1, msg);
  check('★★★ 崗位中文名正確', msg.indexOf('當值堂委') !== -1, msg);
}

console.log('\n=== D1【核心】HARD_PERSON_POST_EXCLUDED 要把「原因」欄原文帶出嚟 ===');
{
  const msg = gas.buildPersonPostExcludedReason_(CHAIR,
    { personId: 'P9001', postId: 'CHAIR', reason: '新任堂委，暫時不擔任主席' });

  check('★★★★★ **原因欄原文**帶咗出嚟（嗰欄就係幹事當初寫低點解嘅地方）',
    msg.indexOf('新任堂委，暫時不擔任主席') !== -1, msg);
  check('★★★★★ 崗位中文名', msg.indexOf('主席') !== -1, msg);
  check('★★★★★ 明確講「這是教會安排」同「不是系統錯誤」',
    msg.indexOf('教會') !== -1 && msg.indexOf('不是系統錯誤') !== -1, msg);
  check('★★★★ 有講點樣解除，而且警告唔好刪除整行',
    msg.indexOf('解除日') !== -1 && msg.indexOf('不要刪除') !== -1, msg);
  check('★★★ 講得出刪除嘅後果（舊季度會被追溯判違規）',
    msg.indexOf('追溯') !== -1, msg);
}

console.log('\n=== D1：原因欄留空時唔會出現 undefined／null ===');
{
  const blank = gas.buildPersonPostExcludedReason_(CHAIR, { reason: '' });
  check('★★★★ 留空顯示「未填」而唔係 undefined',
    blank.indexOf('未填') !== -1 && blank.indexOf('undefined') === -1, blank);
  const missing = gas.buildPersonPostExcludedReason_(CHAIR, null);
  check('★★★ 連 exclusion 物件都冇都唔會爆（防禦性）',
    missing.indexOf('未填') !== -1 && missing.indexOf('undefined') === -1, missing);
}

// =====================================================================
// D2：四個地方都出得到、而且睇得明
// =====================================================================
console.log('\n=== D2【核心】地方一：生成器嘅警告（evaluateViolations_）===');
{
  const dates = [{ serviceDateId: 'SD1', serviceDate: '2027-05-02', weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true }];
  const post = {
    postId: 'ANNOUNCE', postNameTC: '報告', slotCount: 1, distinctWithinPost: true,
    frequency: 'WEEKLY', autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '',
    displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: 'COMMITTEE'
  };
  const state = {
    context: {
      rules: {}, roles: [], personPostExclusions: [],
      peopleById: { P9001: {} }, unavailable: [], posts: [post],
      quotaByPerson: {}, maxPerQuarterDefault: 8, scoreWeights: {}
    },
    post: post, slot: 1, serviceDate: dates[0],
    weekByPost: {}, weekByPerson: {}, previousWeek: {}, quarterCount: {}, lastServed: {},
    ratioState: { weeksCounted: 0, chairEqAnnounce: 0, announceConsecutive: 0, dualQualified: 0, dualAssigned: 0 }
  };
  const violations = gas.evaluateViolations_('P9001', state);
  const roleV = violations.filter((v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED);

  checkEqual('★★★★ 生成器有產生呢條違規', roleV.length, 1);
  check('★★★★★ 而且用嘅係同一句共用訊息（三要素齊）',
    roleV[0].reason.indexOf('報告') !== -1
    && roleV[0].reason.indexOf('堂委') !== -1
    && roleV[0].reason.indexOf('不是系統錯誤') !== -1, roleV[0].reason);
}

console.log('\n=== D2【核心】地方二：步驟 3／5 重跑檢查（findStateViolations_）===');
{
  const context = {
    posts: [
      { postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', allowConsecutive: 'ALLOW', distinctWithinPost: true },
      { postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
    ],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2027-05-02', weekIndex: 1, isFirstSundayOfMonth: true }],
    eligibility: { byPost: { ANNOUNCE: ['P9001'], CHAIR: ['P9002'] }, explicitlyExcluded: {} },
    roles: [],
    personPostExclusions: [
      { personId: 'P9002', postId: 'CHAIR', reason: '按教會安排暫停主席職務', effectiveFrom: '', effectiveTo: '' }
    ],
    unavailable: [], rules: {}, peopleById: {}, warnOnSemiHard: true, maxPerQuarterDefault: 8
  };
  const state = [
    { serviceDateId: 'SD1', serviceDate: '2027-05-02', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P9001', isManual: true },
    { serviceDateId: 'SD1', serviceDate: '2027-05-02', postId: 'CHAIR', slotIndex: 1, personId: 'P9002', isManual: true }
  ];
  const violations = gas.findStateViolations_(state, context);

  const roleV = violations.filter((v) => v.ruleId === gas.RULE_IDS.ROLE_REQUIRED)[0];
  const exclV = violations.filter((v) => v.ruleId === gas.RULE_IDS.PERSON_POST_EXCLUDED)[0];

  check('★★★★★ 身分違規訊息三要素齊',
    roleV && roleV.reason.indexOf('報告') !== -1 && roleV.reason.indexOf('堂委') !== -1
    && roleV.reason.indexOf('不是系統錯誤') !== -1, roleV && roleV.reason);
  check('★★★★★ 個人排除違規帶咗原因原文',
    exclV && exclV.reason.indexOf('按教會安排暫停主席職務') !== -1, exclV && exclV.reason);
  check('★★★★ 兩條都係 HARD（會擋住步驟 4）',
    roleV && roleV.severity === 'HARD' && exclV && exclV.severity === 'HARD');
}

console.log('\n=== D2【核心】地方三：核對職事表（checkHardRuleViolations_）===');
{
  const context = {
    quarterId: '2027T2', versionNo: 0,
    assignments: [
      { serviceDate: '2027-05-02', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P9001', personName: '假甲', assignSource: 'AUTO' },
      { serviceDate: '2027-05-02', postId: 'CHAIR', slotIndex: 1, personId: 'P9002', personName: '假乙', assignSource: 'AUTO' }
    ],
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2027-05-02', weekIndex: 1, isFirstSundayOfMonth: true }],
    posts: [
      { postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: 'COMMITTEE', distinctWithinPost: true },
      { postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', distinctWithinPost: true }
    ],
    eligibility: { byPost: { ANNOUNCE: ['P9001'], CHAIR: ['P9002'] }, explicitlyExcluded: {} },
    roles: [],
    personPostExclusions: [
      { personId: 'P9002', postId: 'CHAIR', reason: '按教會安排暫停主席職務', effectiveFrom: '', effectiveTo: '' }
    ],
    unavailable: [], rules: {}
  };
  const result = gas.checkHardRuleViolations_(context);

  const roleGroup = result.groups.filter((g) => g.label.indexOf('身分限制') !== -1)[0];
  const exclGroup = result.groups.filter((g) => g.label.indexOf('個人崗位限制') !== -1)[0];

  check('★★★★★ 核對報告有「違反身分限制」呢一組', !!roleGroup,
    JSON.stringify(result.groups.map((g) => g.label)));
  check('★★★★ 而且組名講得出係規則 1／2',
    roleGroup && roleGroup.label.indexOf('規則 1') !== -1, roleGroup && roleGroup.label);
  // 第二十一輪批次階段 A：`items` 由「一句字串」改成**結構化物件**
  // （要用明確 key 做放行比對），顯示字串搬咗去 `.text`。
  check('★★★★★ 明細帶咗共用訊息（三要素齊）',
    roleGroup && roleGroup.items.length === 1
    && roleGroup.items[0].text.indexOf('堂委') !== -1
    && roleGroup.items[0].text.indexOf('不是系統錯誤') !== -1,
    roleGroup && JSON.stringify(roleGroup.items));
  check('★★★★★ 個人排除嗰組帶咗原因原文',
    exclGroup && exclGroup.items.length === 1
    && exclGroup.items[0].text.indexOf('按教會安排暫停主席職務') !== -1,
    exclGroup && JSON.stringify(exclGroup.items));
  check('★★★ 明細行頭有日期、崗位、姓名（定位得到係邊一格）',
    roleGroup && roleGroup.items[0].text.indexOf('2027-05-02') !== -1
    && roleGroup.items[0].text.indexOf('ANNOUNCE') !== -1,
    roleGroup && roleGroup.items[0].text);

  // 第二十一輪批次階段 A：結構化欄位要齊，否則放行比對砌唔出 key
  check('★★★★★ 每項都有做 key 用嘅六個結構化欄位'
    + '（季度喺呼叫端補；靠訊息文字比對嘅話，改一次措辭'
    + '就會令全部舊放行紀錄靜靜失效）',
    roleGroup && ['serviceDate', 'postId', 'slotIndex', 'personId', 'ruleId']
      .every(function (f) { return roleGroup.items[0][f] !== undefined; }),
    roleGroup && JSON.stringify(roleGroup.items[0]));
}

console.log('\n=== D2【核心】地方四：草稿覆核報告（describeRuleForCommittee_）===');
{
  // 呢度係寫俾**堂委**睇嘅，唔可以出現任何內部代號
  const roleText = gas.describeRuleForCommittee_(gas.RULE_IDS.ROLE_REQUIRED);
  const exclText = gas.describeRuleForCommittee_(gas.RULE_IDS.PERSON_POST_EXCLUDED);
  const focusText = gas.describeRuleForCommittee_(gas.RULE_IDS.ROLE_POST_FOCUS);

  check('★★★★★ HARD_ROLE_REQUIRED 有中文說法（唔會落到「規則檢查」呢個 fallback）',
    roleText !== '規則檢查' && roleText.indexOf('身分') !== -1, roleText);
  check('★★★★★ HARD_PERSON_POST_EXCLUDED 有中文說法',
    exclText !== '規則檢查' && exclText.indexOf('崗位') !== -1, exclText);
  check('★★★★ SOFT_ROLE_POST_FOCUS 都有（規則 4 一樣會出現喺報告）',
    focusText !== '規則檢查' && focusText.indexOf('堂委') !== -1, focusText);
  check('★★★★★ 三句都冇內部代號漏出去',
    [roleText, exclText, focusText].every((t) =>
      t.indexOf('HARD_') === -1 && t.indexOf('SOFT_') === -1 && t.indexOf('COMMITTEE') === -1),
    JSON.stringify([roleText, exclText, focusText]));
}

console.log('\n=== D2：fine-tune 提案嘅 Reason 欄會帶埋違規原因 ===');
{
  // 提案嘅 reason 係 `violation.reason + '；' + replacement.reason`（FineTune.gs），
  // 即係共用訊息會原封不動帶入 FineTuneProposals 嘅 Reason 欄。
  // 呢度用靜態檢查鎖住呢條串接關係——真正跑 proposeMinimalFix() 需要 grid 工作表，
  // 而串接關係本身先係呢一項要守住嘅嘢。
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'FineTune.gs'), 'utf8');
  check('★★★★ 提案 reason 由 violation.reason 串接而成（唔會另外造一句冇資訊嘅文字）',
    src.indexOf("violation.reason + '；' + replacement.reason") !== -1);
  check('★★★ 而且真係寫入 Reason 欄', src.indexOf('record[C.REASON] = p.reason') !== -1);
}

console.log('\n=== D3：訊息由單一來源產生（四處唔會各自走樣）===');
{
  const srcDir = path.join(__dirname, '..', 'src');
  const read = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');

  ['Generator.gs', 'FineTune.gs', 'Verify.gs'].forEach((f) => {
    const content = read(f);
    check('★★★★ ' + f + ' 用共用函式產生身分違規訊息',
      content.indexOf('buildRoleRequiredReason_(') !== -1);
    check('★★★★ ' + f + ' 用共用函式產生個人排除訊息',
      content.indexOf('buildPersonPostExcludedReason_(') !== -1);
  });

  // 反向：三個檔案唔應該仲有自己砌嗰句嘅殘留
  ['Generator.gs', 'FineTune.gs', 'Verify.gs'].forEach((f) => {
    const content = read(f);
    check('★★★★★ ' + f + ' 冇殘留自己砌嘅「違反身分限制：」字串',
      content.indexOf("'違反身分限制：'") === -1);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
