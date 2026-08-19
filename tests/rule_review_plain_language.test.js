// 第二十八輪批次階段 B：規則審閱表五項實測修正。
// 執行方式：node tests/rule_review_plain_language.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 匯出咗一份俾堂委睇，撞到五個問題
// ─────────────────────────────────────────────────────────────────────
//
// B1　「現時設定」仲有裸數字：`3.3`／`1`／`2`／`（沒有設定）`。
//     **一個裸數字對堂委嚟講等於冇資訊**——佢哋唔知單位、唔知調大定調細係想點。
// B2　「這一條在做什麼」有內部術語（工作表名、欄名）。
//     嗰段字係由 `RuleSettings` 嘅說明欄直接抄出嚟，而嗰一欄本來就係寫俾開發者睇。
// B3　互斥組嗰條寫住「現時無任何組」，但 Ivan 已經設咗一組
//     ——**嗰句係試算表上一句寫死嘅字，唔係讀實際資料**。
// B4　五條軟規則嘅「可以改成」只有「維持現狀／要討論」，堂委開會冇得揀。
// B5　欄闊唔夠。
//
// ⚠️ 而 B4 嘅換算**唔可以由顯示文字反推**——上一輪自己抓到嗰個
// 「8 ÷ 13 反推回 0.62 會靜靜漂移」就係反推嘅代價。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RuleReview.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const R = gas.COLUMNS.RULE_SETTINGS;
const ID = gas.RULE_IDS;

function ruleRow(id, level, target, opts) {
  const row = {};
  row[R.RULE_ID] = id;
  row[R.RULE_NAME] = '（試算表上的舊名）';
  row[R.LEVEL] = level;
  row[R.TARGET_VALUE] = target;
  row[R.ENABLED] = (opts && opts.enabled === false) ? 'FALSE' : 'TRUE';
  // ⚠️ 特登餵一段**含內部術語**嘅說明，證明匯出唔會用佢。
  row[R.DESCRIPTION] = (opts && opts.description !== undefined)
    ? opts.description : '由 Posts 的 MutexGroup 驅動，讀 Eligibility 與 NameMapping';
  // 第二十九輪批次階段 A4：`SOFT_ROLE_POST_FOCUS` 而家要讀實際嘅集中崗位清單
  //（一個都冇填嘅話規則靜靜失效，唔可以寫「有生效」）。
  row[R.SCOPE_POST_IDS] = (opts && opts.scopePostIds !== undefined)
    ? opts.scopePostIds : 'CHAIR,ANNOUNCE';
  return row;
}

const CTX = {
  mutexGroups: [{ group: 'CHAIR_COMMUNION', postNames: ['主席', '聖餐襄禮'] }],
  gatedPosts: [{ postId: 'ANNOUNCE', postNameTC: '報告', requiredText: '「堂委」' }],
  postNameById: { CHAIR: '主席', ANNOUNCE: '報告' }
};

/* ══════════════════════════════════════════════════════════════
 * B1　現時設定唔可以係裸數字
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B1【核心】四條實測撞到嘅，逐條核對 ===');
{
  const cases = [
    { id: ID.LOAD_BALANCE, target: '', expect: '有生效',
      why: '最久沒服侍者優先：本來顯示「（沒有設定）」——而佢其實有生效' },
    { id: ID.QUARTER_DISTRIBUTION, target: 3.3, expect: '平均每人每季約 3.3 次',
      why: '每季次數分佈：本來顯示裸數字 3.3' },
    { id: ID.PERSONAL_QUOTA, target: 1, expect: '有生效（按各人一向的服侍量分配）',
      why: '每人配額按歷史比例：本來顯示裸數字 1' },
    { id: ID.ROLE_POST_FOCUS, target: 2, expect: '有生效（其他崗位扣分，強度 2）',
      why: '堂委集中在指定崗位：本來顯示裸數字 2' }
  ];
  cases.forEach(function (c) {
    const d = gas.describeRuleForReview_(
      ruleRow(c.id, 'SOFT', c.target), gas.RULE_LEVELS.SOFT, 13, CTX);
    check('★★★★★ ' + c.why + ' ⇒ 「' + c.expect + '」',
      d.currentText === c.expect, '得到：' + d.currentText);
  });

  check('★★★★★ 每季上限亦有單位（「每人每季最多 8 次」而唔係「8」）',
    gas.describeRuleForReview_(ruleRow(ID.MAX_PER_QUARTER, 'SOFT', 8),
      gas.RULE_LEVELS.SOFT, 13, CTX).currentText === '每人每季最多 8 次');
  check('★★★★ 關掉咗嘅一定要寫「已關掉」，唔可以留白',
    gas.describeRuleForReview_(ruleRow(ID.LOAD_BALANCE, 'SOFT', '', { enabled: false }),
      gas.RULE_LEVELS.SOFT, 13, CTX).currentText === '已關掉');
}

/* ══════════════════════════════════════════════════════════════
 * B2　唔可以有內部術語
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B2【核心】整份表唔可以出現工作表名／欄名 ===');
{
  // 規格 1.3：畫面唔可以出現工作表名同欄名。呢份係俾堂委睇嘅。
  const FORBIDDEN = ['Eligibility', 'DistinctWithinPost', 'Unavailable',
    'MutexGroup', 'NameMapping', 'RuleSettings', 'PersonPostExclusions',
    'RosterAssignments', 'TargetValue', 'ScopePostIDs', 'Posts'];

  const rules = Object.keys(ID).map(function (k) {
    const id = ID[k];
    const level = id.indexOf('HARD_') === 0
      ? 'HARD' : (id.indexOf('SEMI_') === 0 ? 'SEMI_HARD' : 'SOFT');
    return ruleRow(id, level, level === 'SOFT' ? 0.5 : '');
  });
  const built = gas.buildRuleReviewSheetRows_(rules, 13, CTX);

  check('★★★★★ 每一條規則都有人話定義（一條都冇退回試算表嗰兩欄）'
    + '——退回就等於嗰條又會出現內部術語，而冇人知',
    built.fallbackRuleIds.length === 0,
    '退回咗：' + built.fallbackRuleIds.join('、'));

  const flat = built.rows.map(function (r) { return r.join(' '); }).join('\n');
  FORBIDDEN.forEach(function (term) {
    check('★★★★★ 整份表冇出現「' + term + '」',
      flat.indexOf(term) === -1,
      (flat.split('\n').filter(function (l) { return l.indexOf(term) !== -1; })[0] || ''));
  });
}

/* ══════════════════════════════════════════════════════════════
 * B3　描述要讀實際資料
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B3【核心】互斥組同身分要求：讀實際資料，唔可以寫死 ===');
{
  const withGroups = gas.describeRuleForReview_(
    ruleRow(ID.MUTEX_GROUP, 'HARD', ''), gas.RULE_LEVELS.HARD, 13, CTX);
  // 第二十九輪批次階段 B：組員而家逐組一行（`現時有 N 組：\n　・A ＋ B`），
  // 所以唔再係一句連住嘅字串——但「講得出係邊幾個崗位」呢個要求不變。
  check('★★★★★ 有設組 ⇒ 講得出係邊幾個崗位'
    + '——舊版寫住「現時無任何組」，而嗰句係試算表上一句寫死嘅字',
    withGroups.what.indexOf('現時有 1 組') === 0
    && withGroups.what.indexOf('主席 ＋ 聖餐襄禮') !== -1, withGroups.what);

  const noGroups = gas.describeRuleForReview_(
    ruleRow(ID.MUTEX_GROUP, 'HARD', ''), gas.RULE_LEVELS.HARD, 13,
    { mutexGroups: [], gatedPosts: [] });
  check('★★★★★ 冇設組 ⇒ 講明「實際上不會擋住任何安排」'
    + '（唔止講「沒有設」——堂委要知道後果）',
    noGroups.what.indexOf('實際上不會擋住任何安排') !== -1, noGroups.what);

  const gated = gas.describeRuleForReview_(
    ruleRow(ID.ROLE_REQUIRED, 'HARD', ''), gas.RULE_LEVELS.HARD, 13, CTX);
  check('★★★★★ 身分要求同樣讀實際資料（邊個崗位、要邊個身分）',
    gated.what.indexOf('報告（「堂委」）') !== -1, gated.what);

  const backend = read('src/WebAppRuleReview.gs');
  check('★★★★★ 而且真係由 Posts 讀出嚟（唔係另一份寫死清單）',
    /function buildRuleReviewContext_/.test(backend)
    && /readPostsNormalized\(\)\.forEach/.test(backend));
  check('★★★★★ 匯出同匯入兩邊都傳咗 ctx'
    + '——只傳一邊嘅話，匯入時對唔返選項，堂委填咗都唔會生效',
    /buildRuleReviewSheetRows_\(\s*\n?\s*readSheet\(SHEETS\.RULE_SETTINGS\), weeks, buildRuleReviewContext_\(\)\)/.test(backend)
    && /buildRuleReviewImportPlan_\([\s\S]{0,200}?buildRuleReviewContext_\(\)\)/.test(backend));
  check('★★★★ 讀唔到 Posts 要記低（唔可以靜靜當成「一組都冇設」）',
    /catch \(err\)[\s\S]{0,200}?互斥組／身分要求會顯示為「沒有設」/.test(backend));
}

/* ══════════════════════════════════════════════════════════════
 * B4　五條軟規則要有具體選項
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B4【核心】五條軟規則各有具體選項 ===');
{
  const expectLabels = {};
  expectLabels[ID.MAX_PER_QUARTER] = ['6 次', '7 次', '8 次（維持現狀）', '9 次', '10 次'];
  expectLabels[ID.LOAD_BALANCE] = ['維持現狀（有生效）', '關掉'];
  expectLabels[ID.QUARTER_DISTRIBUTION] =
    ['平均約 2.5 次', '平均約 3 次', '平均約 3.3 次（維持現狀）', '平均約 3.5 次', '平均約 4 次'];
  expectLabels[ID.PERSONAL_QUOTA] = ['維持現狀（按各人一向的量）', '關掉'];
  expectLabels[ID.ROLE_POST_FOCUS] =
    ['強一些（更少排到其他崗位）', '維持現狀', '弱一些（比較容易排到其他崗位）', '關掉'];

  const targets = {};
  targets[ID.MAX_PER_QUARTER] = 8;
  targets[ID.LOAD_BALANCE] = '';
  targets[ID.QUARTER_DISTRIBUTION] = 3.3;
  targets[ID.PERSONAL_QUOTA] = 1;
  targets[ID.ROLE_POST_FOCUS] = 2;

  Object.keys(expectLabels).forEach(function (id) {
    const d = gas.describeRuleForReview_(
      ruleRow(id, 'SOFT', targets[id]), gas.RULE_LEVELS.SOFT, 13, CTX);
    const labels = d.choices.map(function (c) { return c.label; });
    check('★★★★★ ' + id + ' 嘅選項係規格指定嗰幾個'
      + '——「維持現狀／要討論」等於冇得改',
      JSON.stringify(labels) === JSON.stringify(expectLabels[id]),
      JSON.stringify(labels));
    check('★★★★★ ' + id + ' 每個選項都帶住 value 同 field（**唔靠反推**）',
      d.choices.every(function (c) {
        return c.value !== undefined && !!c.field;
      }), JSON.stringify(d.choices));
  });

  const quota = gas.describeRuleForReview_(
    ruleRow(ID.PERSONAL_QUOTA, 'SOFT', 1), gas.RULE_LEVELS.SOFT, 13, CTX);
  check('★★★★★ 每人配額嗰條有規格指定嗰句備註'
    + '——唔講後果嘅話，堂委會以為「人人平均」係比較公平',
    quota.note === '改成人人平均會令核心義工大幅減少、少見的人大幅增加。');

  const built = gas.buildRuleReviewSheetRows_(
    [ruleRow(ID.PERSONAL_QUOTA, 'SOFT', 1)], 13, CTX);
  check('★★★★ 而且備註真係出現喺表上（第三欄）',
    built.rows[2][2].indexOf('改成人人平均會令核心義工大幅減少') !== -1, built.rows[2][2]);
}

console.log('\n=== B4【核心】匯入用選項自己嘅值，唔可以由文字反推 ===');
{
  const rules = [
    ruleRow(ID.MAX_PER_QUARTER, 'SOFT', 8),
    ruleRow(ID.LOAD_BALANCE, 'SOFT', ''),
    ruleRow(ID.QUARTER_DISTRIBUTION, 'SOFT', 3.3),
    ruleRow(ID.PERSONAL_QUOTA, 'SOFT', 1),
    ruleRow(ID.ROLE_POST_FOCUS, 'SOFT', 2)
  ];
  const header = gas.RULE_REVIEW_HEADERS.slice();
  const row = function (seq, text, decision) {
    return [String(seq), text, '', '', '', decision, ''];
  };

  const plan = gas.buildRuleReviewImportPlan_([
    header,
    row(1, '每個人一季最多服侍多少次', '9 次'),
    row(2, '最久沒有服侍的人優先', '關掉'),
    row(3, '每季次數分佈盡量貼近以往', '平均約 3.5 次'),
    row(4, '每個人的份額按他一向的服侍量分配', '關掉'),
    row(5, '堂委盡量集中在指定的幾個崗位', '強一些（更少排到其他崗位）')
  ], rules, 13, CTX);

  const byId = {};
  plan.changes.forEach(function (c) { byId[c.ruleId] = c; });

  check('★★★★★ 每季上限 ⇒ 寫 9（整數，直接對照）',
    byId[ID.MAX_PER_QUARTER] && byId[ID.MAX_PER_QUARTER].newValue === 9
    && byId[ID.MAX_PER_QUARTER].field === 'TARGET_VALUE',
    JSON.stringify(byId[ID.MAX_PER_QUARTER]));
  check('★★★★★ 「關掉」⇒ 寫**開關欄**，唔係目標值欄'
    + '——寫錯欄嘅話，一個 boolean 會入咗目標值，之後被讀成 NaN，規則靜靜失效',
    byId[ID.LOAD_BALANCE] && byId[ID.LOAD_BALANCE].newValue === false
    && byId[ID.LOAD_BALANCE].field === 'ENABLED',
    JSON.stringify(byId[ID.LOAD_BALANCE]));
  check('★★★★★ 每季分佈 ⇒ 寫 3.5（原始值，唔經次數換算來回）',
    byId[ID.QUARTER_DISTRIBUTION] && byId[ID.QUARTER_DISTRIBUTION].newValue === 3.5);
  check('★★★★★ 每人配額「關掉」⇒ 開關欄 false',
    byId[ID.PERSONAL_QUOTA] && byId[ID.PERSONAL_QUOTA].newValue === false
    && byId[ID.PERSONAL_QUOTA].field === 'ENABLED');
  check('★★★★★ 堂委集中「強一些」⇒ 目標值 3（2 ＋ 1）',
    byId[ID.ROLE_POST_FOCUS] && byId[ID.ROLE_POST_FOCUS].newValue === 3);

  // 「維持現狀」一定唔可以變成一個改動。
  const keep = gas.buildRuleReviewImportPlan_([
    header,
    row(1, '每個人一季最多服侍多少次', '8 次（維持現狀）'),
    row(2, '每季次數分佈盡量貼近以往', '平均約 3.3 次（維持現狀）'),
    row(3, '最久沒有服侍的人優先', '維持現狀（有生效）')
  ], rules, 13, CTX);
  check('★★★★★ 揀「維持現狀」⇒ **零改動**'
    + '——上一輪由文字反推，令「維持現狀」反而把 0.63 靜靜改成 0.62，'
    + '每次匯入漂移少少',
    keep.changes.length === 0, JSON.stringify(keep.changes));
  check('★★★★ 而且三行都列入 ignored，講明「跟現在的設定一樣」',
    keep.ignored.length === 3
    && keep.ignored.every(function (i) {
      return i.reason.indexOf('跟現在的設定一樣') !== -1;
    }), JSON.stringify(keep.ignored));

  const nonsense = gas.buildRuleReviewImportPlan_([
    header, row(1, '每個人一季最多服侍多少次', '大概少少啦')
  ], rules, 13, CTX);
  check('★★★★★ 堂委自己打咗一句嘢 ⇒ 唔改動，而且講明「看不懂」'
    + '——估錯一個規則值嘅後果係整季排表偏一邊，而冇人會知係邊度出事',
    nonsense.changes.length === 0
    && nonsense.ignored[0].reason.indexOf('看不懂') !== -1);
}

/* ══════════════════════════════════════════════════════════════
 * B5　欄闊
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B5 欄闊 ＋ 換行 ＋ 行高 ===');
{
  const backend = read('src/WebAppRuleReview.gs');
  check('★★★★ 有逐欄設闊度', /RULE_REVIEW_COLUMN_WIDTHS\.forEach/.test(backend));
  check('★★★★★ **唔用 autoResizeColumns()**'
    + '——說明同選項都係長段文字，自動調闊會令幾欄變到成千 pixel，'
    + '堂委要橫向捲先睇得晒',
    // 剝走註解先檢查——解釋「唔用邊個 API」嘅註解本身就含住嗰個 API 名。
    // 唔剝嘅話，寫得越清楚就越容易被自己嘅測試捉住。
    !/autoResizeColumns/.test(
      backend.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  check('★★★★ 有自動換行 ＋ 靠上對齊', /setWrap\(true\)\.setVerticalAlignment\('top'\)/.test(backend));
  check('★★★★ 有設行高', /setRowHeights\(/.test(backend));
  check('★★★★★ 選項一個一行（唔係用分隔符串埋一行）',
    /d\.choices\.map\(function \(c\) \{ return c\.label; \}\)\.join\('\\n'\)/
      .test(read('src/RuleReview.gs')));
  check('★★★★ B 欄同 E 欄唔可以太窄',
    gas.RULE_REVIEW_COLUMN_WIDTHS[1] >= 240 && gas.RULE_REVIEW_COLUMN_WIDTHS[4] >= 240,
    JSON.stringify(gas.RULE_REVIEW_COLUMN_WIDTHS));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
