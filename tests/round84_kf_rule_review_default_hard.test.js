// 第八十四輪批次 KF 組：規則審閱表加入兩條預設開啟的硬規則；週報說明兩處。
// 執行方式：node tests/round84_kf_rule_review_default_hard.test.js
//
// `HARD_ROLE_REQUIRED`、`HARD_PERSON_POST_EXCLUDED` 喺 `RULE_DEFAULT_ENABLED` 預設開啟——`RuleSettings`
// 冇嗰兩行都照樣生效，但舊嘅審閱表只列 `RuleSettings` 嘅行 ⇒ 堂委睇唔到呢兩條。
//
//   KF1　RuleSettings 冇呢兩行 ⇒「一定要遵守」最後兩條照列（同意／要討論）
//   KF2　身分要求：現時設定按 Posts.RequiredRoles 逐個寫（describeRoleCodes_）
//   KF3　暫時不做某崗位：「有生效（現時 N 項）」
//   KF4　RuleSettings 有嗰一行（Enabled=FALSE）⇒ 照實寫「已關掉」，唔重覆列
//   KF5　匯入當硬規則：只記錄（hardNotes），唔改設定
//   KF6　週報說明：PostName_TC；合堂人手清空的格；第 9 節第八十四輪

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'RuleReview.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const R = gas.COLUMNS.RULE_SETTINGS;
const ID = gas.RULE_IDS;
function ruleRow(id, level, enabled, target) {
  const row = {};
  row[R.RULE_ID] = id; row[R.RULE_NAME] = '（舊名）'; row[R.LEVEL] = level;
  row[R.TARGET_VALUE] = target === undefined ? '' : target; row[R.ENABLED] = enabled === false ? 'FALSE' : 'TRUE';
  row[R.DESCRIPTION] = '';
  return row;
}
const CTX = {
  mutexGroups: [],
  gatedPosts: [
    { postId: 'ANNOUNCE', postNameTC: '報告', requiredText: gas.describeRoleCodes_(['COMMITTEE']) },
    { postId: 'DUTY', postNameTC: '當值堂委', requiredText: gas.describeRoleCodes_(['COMMITTEE', 'DEACON']) }
  ],
  postNameById: {},
  exclusionCurrentCount: 2
};
const BASE = [ruleRow(ID.ELIGIBILITY, 'HARD'), ruleRow(ID.UNAVAILABLE, 'HARD'), ruleRow(ID.NO_CONSECUTIVE, 'SEMI_HARD'),
  ruleRow(ID.MAX_PER_QUARTER, 'SOFT', true, 8)];

console.log('\n=== KF1–KF3：RuleSettings 冇呢兩行 ===');
const built = gas.buildRuleReviewSheetRows_(BASE, 13, CTX);
const rowOf = (text) => built.rows.filter((r) => r[1] === text)[0];
const ROLE_TEXT = '某些崗位只由指定身分的人擔任';
const EXCL_TEXT = '堂委會決定暫時不做某崗位的人，不會被排到那個崗位';
{
  const semiTitle = built.rows.findIndex((r) => String(r[0]).indexOf('盡量遵守') === 0);
  const roleIdx = built.rows.indexOf(rowOf(ROLE_TEXT));
  const exclIdx = built.rows.indexOf(rowOf(EXCL_TEXT));
  check('★★★★★★ KF1 兩條都列出', roleIdx > 0 && exclIdx > 0, JSON.stringify(built.rows.map((r) => r[1])));
  check('★★★★★★ KF1 排喺「一定要遵守」最後（盡量遵守之前、其他硬規則之後）',
    // 第九十輪批次 QA 組（刻意改動）：RULE_DEFAULT_ENABLED 多了 HARD_SAME_DAY_EXCLUSIVE（按代號排序在最後）
    semiTitle === Math.max(roleIdx, exclIdx, built.rows.indexOf(rowOf(gas.ruleReviewPlainEntry_(ID.SAME_DAY_EXCLUSIVE).text))) + 1
      && built.rows.indexOf(rowOf(gas.ruleReviewPlainEntry_(ID.UNAVAILABLE).text)) < Math.min(roleIdx, exclIdx),
    JSON.stringify(built.rows.map((r) => r[0] + ' ' + r[1])));
  check('★★★★★ KF1 選項「同意／要討論」', rowOf(ROLE_TEXT)[4] === '同意\n要討論' && rowOf(EXCL_TEXT)[4] === '同意\n要討論');
  check('★★★★★ KF1 這一條在做甚麼（身分要求）', rowOf(ROLE_TEXT)[2] === '崗位設定了身分要求的話，系統只會排有那個身分的人；身分以那一個主日當日為準。', rowOf(ROLE_TEXT)[2]);
  check('★★★★★★ KF2 現時設定按 Posts.RequiredRoles 逐個寫', rowOf(ROLE_TEXT)[3] === '報告：只限「堂委」／當值堂委：只限「堂委」或「執事」', rowOf(ROLE_TEXT)[3]);
  check('★★★★★★ KF3「有生效（現時 2 項）」', rowOf(EXCL_TEXT)[3] === '有生效（現時 2 項）', rowOf(EXCL_TEXT)[3]);
  const m = built.meta.filter((x) => x && (x.ruleId === ID.ROLE_REQUIRED || x.ruleId === ID.PERSON_POST_EXCLUDED));
  check('★★★★★ meta 當硬規則', m.length === 2 && m.every((x) => x.level === 'HARD'), JSON.stringify(m));
  check('★★★★ 冇崗位設身分要求 ⇒ 照講（唔留白）', /現時沒有崗位設定身分要求/.test(
    gas.describeRuleForReview_(ruleRow(ID.ROLE_REQUIRED, 'HARD'), 'HARD', 13, { gatedPosts: [] }).currentText));
  check('★★★★ 讀唔到排除數 ⇒ 只寫「有生效」', gas.describeRuleForReview_(ruleRow(ID.PERSON_POST_EXCLUDED, 'HARD'), 'HARD', 13,
    { exclusionCurrentCount: null }).currentText === '有生效');
}

console.log('\n=== KF4：RuleSettings 有嗰一行（Enabled=FALSE）===');
{
  const b2 = gas.buildRuleReviewSheetRows_(BASE.concat([ruleRow(ID.ROLE_REQUIRED, 'HARD', false)]), 13, CTX);
  const rows = b2.rows.filter((r) => r[1] === ROLE_TEXT);
  check('★★★★★★ KF4 照實寫「已關掉」', rows.length === 1 && rows[0][3] === '已關掉', JSON.stringify(rows));
  const b3 = gas.buildRuleReviewSheetRows_(BASE.concat([ruleRow(ID.PERSON_POST_EXCLUDED, 'SOFT', false)]), 13, CTX);
  const r3 = b3.rows.filter((r) => r[1] === EXCL_TEXT);
  const m3 = b3.meta.filter((x) => x && x.ruleId === ID.PERSON_POST_EXCLUDED);
  check('★★★★★ KF4 Level 寫錯都當硬規則、只列一次', r3.length === 1 && r3[0][3] === '已關掉' && m3.length === 1 && m3[0].level === 'HARD',
    JSON.stringify([r3, m3]));
}

console.log('\n=== KF5：匯入當硬規則 ===');
{
  const sheet = built.rows.map((r) => r.slice());
  sheet.forEach((r) => { if (r[1] === ROLE_TEXT || r[1] === EXCL_TEXT) { r[5] = '要討論'; r[6] = '想再傾'; } });
  const plan = gas.buildRuleReviewImportPlan_(sheet, BASE, 13, CTX);
  const ids = plan.hardNotes.map((h) => h.ruleId).sort().join(',');
  check('★★★★★★ KF5 兩條都只記錄（hardNotes），唔改設定', ids === [ID.PERSON_POST_EXCLUDED, ID.ROLE_REQUIRED].sort().join(',')
    && plan.changes.length === 0, JSON.stringify(plan));
  check('★★★★ 唔會當「系統裡面找不到這一條規則」', plan.ignored.length === 0, JSON.stringify(plan.ignored));
}

console.log('\n=== KF 後端：審閱表 ctx 有排除數 ===');
{
  const be = read('src/WebAppRuleReview.gs');
  check('★★★★ buildRuleReviewContext_ 回 exclusionCurrentCount（讀 PersonPostExclusions 今日生效）',
    /exclusionCurrentCount: exclusionCurrentCount,/.test(be) && /readPersonPostExclusionsSafe_\(timezone\)\.filter/.test(be));
}

console.log('\n=== KF6：週報說明 ===');
{
  const doc = read('docs/週報系統讀取職事表資料說明.md');
  const sec3 = doc.slice(doc.indexOf('## 3.'), doc.indexOf('## 4.'));
  check('★★★★★ 第 3 節 Posts.PostName_TC（唔係 PostNameTC）', sec3.indexOf('`Posts.PostName_TC`') !== -1 && sec3.indexOf('`Posts.PostNameTC`') === -1);
  check('★★★★★ 欄名同程式一致', /POST_NAME_TC: 'PostName_TC'/.test(read('src/Constants.gs')));
  check('★★★★★ 第 3 節：合堂人手清空的格當「未排定」；結構性不設只看 RuleFlags',
    sec3.indexOf('合堂等特別安排的週，幹事人手清空不用的崗位') !== -1 && sec3.indexOf('讀取方當「未排定」') !== -1
    && sec3.indexOf('`STRUCTURAL_NA_RULE_IDS`') !== -1);
  const sec9 = doc.slice(doc.indexOf('## 9.'));
  check('★★★★ 第 9 節有第八十四輪一行', /\| 第八十四輪 \|/.test(sec9));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
