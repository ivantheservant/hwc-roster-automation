// 第七十三輪批次 BB 組：人手填嘅崗位（講員／翻譯／獻花）**唔查崗位名單**。
// 執行方式：node tests/manual_post_no_eligibility.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十一輪第一次重拍）
// ═════════════════════════════════════════════════════════════════════
//
// 第 1 個主日獻花填咗一位會友（喺 `NameMapping`，但唔喺獻花名單上），之後**每一次**儲存
// 都彈出放行框要打字。講員／翻譯／獻花本來就係人手填（`Posts.AutoGenerate = FALSE`），
// 任何會友都可以做；放行框變成日常噪音（同第六十三輪 K 組同一類問題）。
//
// Ivan 決定：「不在這個崗位的名單上」（`RULE_IDS.ELIGIBILITY`）對人手填嘅崗位唔算違反。
// 按 `AutoGenerate` 欄判斷，唔可以寫死崗位名或 PostID（崗位會增減）；其他規則照舊。
//
//   BB1　獻花（AutoGenerate=FALSE）填一位唔喺名單上嘅人 ⇒ `findStateViolations_()` 冇違反
//   BB2　同一個人填喺 AutoGenerate=TRUE 嘅崗位 ⇒ 照舊違反
//   BB3　改 Posts 資料把另一個崗位設成 AutoGenerate=FALSE ⇒ 呢個崗位都唔查（唔係寫死崗位名）
//   BB4　其他規則照舊：人手填崗位嘅人如果當日不能服侍，照樣違反（唔係一併關咗）
//   BB5　核對職事表（`checkHardRuleViolations_()`）同一套判斷
//   BB6　搵唔到崗位資料 ⇒ 照舊查（保守）
//   BB7　`findStateViolations_()`、`checkHardRuleViolations_()` 都經 `isEligibilityCheckedPost_()`

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'PersonPostWeight.gs',
  'Generator.gs', 'FineTune.gs', 'Verify.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

// 全部虛構：P9801 喺所有崗位名單上；P9802 唔喺任何崗位名單上
const posts = (autoFlower, autoTranslate) => [
  { postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'FLOWER', postNameTC: '獻花', frequency: 'WEEKLY', autoGenerate: autoFlower, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'TRANSLATE', postNameTC: '翻譯', frequency: 'WEEKLY', autoGenerate: autoTranslate, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
];
// 兩條硬規則都啟用（`isRuleEnabled_()` 要 RuleSettings 有一列而且 Enabled）
const RULES = {};
RULES[gas.RULE_IDS.ELIGIBILITY] = { Enabled: 'TRUE', Level: 'HARD' };
RULES[gas.RULE_IDS.UNAVAILABLE] = { Enabled: 'TRUE', Level: 'HARD' };
const baseContext = (p, extra) => Object.assign({
  posts: p,
  serviceDates: [{ serviceDateId: 'SD1', serviceDate: '2026-07-05', weekIndex: 1, isFirstSundayOfMonth: true }],
  eligibility: { byPost: { CHAIR: ['P9801'], FLOWER: ['P9801'], TRANSLATE: ['P9801'] }, explicitlyExcluded: {} },
  roles: [], personPostExclusions: [], unavailable: [], rules: RULES, peopleById: {},
  warnOnSemiHard: true, maxPerQuarterDefault: 8
}, extra || {});
// FIXTURE-OK: 純函式 findStateViolations_ 嘅輸入（記憶體入面嘅一格），唔係寫落工作表嘅資料；
// 而且呢份測試只填 personId，assignSource 一律留空（＝「唔知」，照舊行為）。
const cell = (postId, personId, assignSource) => ({
  serviceDateId: 'SD1', serviceDate: '2026-07-05', postId: postId, slotIndex: 1,
  personId: personId, isManual: true, assignSource: assignSource
});
const eligV = (vs, postId) => vs.filter((v) => v.ruleId === gas.RULE_IDS.ELIGIBILITY && v.postId === postId);

console.log('\n=== BB1／BB2　人手填崗位唔查名單；自動排嘅崗位照舊查 ===');
{
  const ctx = baseContext(posts(false, false));
  const vs = gas.findStateViolations_([cell('FLOWER', 'P9802'), cell('CHAIR', 'P9802')], ctx);
  check('★★★★★ 獻花（AutoGenerate=FALSE）填唔喺名單上嘅人 ⇒ 冇名單違反', eligV(vs, 'FLOWER').length === 0, JSON.stringify(vs));
  check('★★★★★ 同一個人填喺主席（AutoGenerate=TRUE）⇒ 照舊違反名單', eligV(vs, 'CHAIR').length === 1, JSON.stringify(vs));
  check('★★★★ 違反係 HARD', eligV(vs, 'CHAIR')[0] && eligV(vs, 'CHAIR')[0].severity === 'HARD');
}

console.log('\n=== BB3　改 Posts 資料就跟住變（唔係寫死崗位名）===');
{
  const asAuto = gas.findStateViolations_([cell('TRANSLATE', 'P9802')], baseContext(posts(false, true)));
  check('★★★★★ 翻譯 AutoGenerate=TRUE ⇒ 查名單（違反）', eligV(asAuto, 'TRANSLATE').length === 1, JSON.stringify(asAuto));
  const asManual = gas.findStateViolations_([cell('TRANSLATE', 'P9802')], baseContext(posts(false, false)));
  check('★★★★★ 同一個崗位改成 AutoGenerate=FALSE ⇒ 唔查名單', eligV(asManual, 'TRANSLATE').length === 0, JSON.stringify(asManual));
  const flowerAuto = gas.findStateViolations_([cell('FLOWER', 'P9802')], baseContext(posts(true, false)));
  check('★★★★ 獻花改成 AutoGenerate=TRUE ⇒ 獻花都查名單', eligV(flowerAuto, 'FLOWER').length === 1, JSON.stringify(flowerAuto));
}

console.log('\n=== BB4　其他規則照舊 ===');
{
  const ctx = baseContext(posts(false, false), {
    unavailable: [{ personId: 'P9802', dateFrom: '2026-07-05', dateTo: '2026-07-05', appliesTo: 'ALL', status: 'ACTIVE' }]
  });
  const vs = gas.findStateViolations_([cell('FLOWER', 'P9802')], ctx);
  const hasUnavail = vs.some((v) => v.ruleId === gas.RULE_IDS.UNAVAILABLE && v.postId === 'FLOWER');
  check('★★★★★ 人手填崗位：當日不能服侍照樣違反（只係名單唔查）', hasUnavail, JSON.stringify(vs));
  check('★★★★ 而且仍然冇名單違反', eligV(vs, 'FLOWER').length === 0);
}

console.log('\n=== BB5　核對職事表同一套判斷 ===');
{
  const ctx = baseContext(posts(false, false), {
    assignments: [
      { serviceDate: '2026-07-05', postId: 'FLOWER', slotIndex: 1, personId: 'P9802', personName: '假乙' },
      { serviceDate: '2026-07-05', postId: 'CHAIR', slotIndex: 1, personId: 'P9802', personName: '假乙' }
    ]
  });
  const r = gas.checkHardRuleViolations_(ctx);
  const g = r.groups.filter((x) => x.label === '不在這個崗位的名單上')[0];
  check('★★★★★ 核對：自動排嘅主席照舊報名單違反', g && g.items.some((i) => i.postId === 'CHAIR'), JSON.stringify(g));
  check('★★★★★ 核對：獻花（人手填）唔報名單違反', g && !g.items.some((i) => i.postId === 'FLOWER'), JSON.stringify(g));
}

console.log('\n=== BB6　搵唔到崗位資料 ⇒ 照舊查 ===');
{
  check('★★★★ isEligibilityCheckedPost_(null) === true', gas.isEligibilityCheckedPost_(null) === true);
  check('★★★★ isEligibilityCheckedPost_({autoGenerate:false}) === false', gas.isEligibilityCheckedPost_({ autoGenerate: false }) === false);
  check('★★★★ isEligibilityCheckedPost_({autoGenerate:true}) === true', gas.isEligibilityCheckedPost_({ autoGenerate: true }) === true);
}

console.log('\n=== BB7　兩個入口都經同一支判斷（唔寫死崗位名）===');
{
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/\r/g, '');
  check('★★★★★ FineTune.gs findStateViolations_ 叫 isEligibilityCheckedPost_',
    /isRuleEnabled_\(rules, RULE_IDS\.ELIGIBILITY\) && isEligibilityCheckedPost_\(post\)/.test(read('FineTune.gs')));
  check('★★★★★ Verify.gs checkHardRuleViolations_ 叫 isEligibilityCheckedPost_',
    /isEligibilityCheckedPost_\(post\) && pool\.indexOf\(a\.personId\) === -1/.test(read('Verify.gs')));
  const g = read('Generator.gs');
  const at = g.indexOf('function isEligibilityCheckedPost_');
  const body = g.slice(at, g.indexOf('\n}\n', at));
  check('★★★★★ isEligibilityCheckedPost_ 只看 autoGenerate，不寫死 PostID／崗位名',
    /post\.autoGenerate/.test(body) && !/FLOWER|TRANSLATE|PREACH|獻花|翻譯|講員/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')), body);
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAIL');
process.exitCode = fail === 0 ? 0 : 1;
