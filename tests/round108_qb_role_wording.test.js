// 第一百零八輪批次 QB 組：使用者看得到的說明不寫死身分組合（報告＝堂委＋執事、當值堂委＝只限堂委是設定，會隨教會規定改）
// 執行方式：node tests/round108_qb_role_wording.test.js

const fs = require('fs');
const path = require('path');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 1200));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 非註解行（簡單：去掉 // 開頭、* 開頭的行）
function codeLines(rel) {
  return read(rel).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

// 1. 全專案使用者看得到的字串不再寫死舊的身分組合
const STALE = ['報告限堂委', '當值堂委限堂委或執事', '堂委或執事）', '當值堂委 → ', '報告 → '];
const files = [];
(function walk(dir) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel);
    else if (/\.(gs|html)$/.test(e.name)) files.push(rel);
  });
})('src');
const hits = [];
files.forEach((f) => codeLines(f).forEach((l, i) => STALE.forEach((s) => { if (l.indexOf(s) !== -1) hits.push(f + ' ' + s); })));
check('★★★★★ src 內沒有寫死身分組合的字串（報告限堂委、當值堂委限堂委或執事、報告 → X、當值堂委 → X、堂委或執事）', hits.length === 0, hits.join('\n'));

// 2. 各處改為通用句子
check('★★★★★ FreshEnvironmentCheck：身分名單說明改為「崗位的身分要求」', /崗位的身分要求，例如報告、當值堂委/.test(read('src/FreshEnvironmentCheck.gs')));
check('★★★★★ Verify：核對報告組名改為「崗位的身分要求 RequiredRoles」', /違反身分限制（崗位的身分要求 RequiredRoles）/.test(read('src/Verify.gs')));
check('★★★★ ScriptZone3：沒有身分名單的提示改為通用句', /各崗位的身分要求（Posts 工作表的 RequiredRoles/.test(read('src/ui/ScriptZone3.html')));
check('★★★★ PostSeed：補建欄位說明不寫死哪個崗位填甚麼', /有身分要求的崗位（例如報告、當值堂委）→/.test(read('src/PostSeed.gs')));
check('★★★★ Roles：補建身分名單的說明不寫死哪個崗位填甚麼', /為有身分要求的崗位（例如報告、當值堂委）填所需身分代號/.test(read('src/Roles.gs')));

// 3. 規則審閱表：主席和報告那一行
const g = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'RuleReview.gs', 'DraftReviewReport.gs']));
const R = g.COLUMNS.RULE_SETTINGS;
const rows = g.buildRuleReviewSheetRows_([{ [R.RULE_ID]: 'SOFT_CHAIR_EQ_ANNOUNCE', [R.LEVEL]: 'SOFT', [R.ENABLED]: true, [R.TARGET_VALUE]: 0.63 }], 13, {}).rows
  .filter((r) => r[1] === '主席和報告盡量由同一位擔任')[0];
const what = rows ? String(rows[2]).replace(/\n/g, '') : '';
check('★★★★★ 規則審閱表：報告由「符合崗位身分要求的人」擔任，不需要當日做主席，沒有寫死堂委／執事', /報告由符合崗位身分要求的人擔任/.test(what) && /不需要當日做主席/.test(what) && !/堂委或執事/.test(what), what);

// 4. 新環境種子：只加欄位、不填任何身分（所以沒有預設值要改）
const seed = read('src/PostSeed.gs');
check('★★★★ 補建 Posts 欄位：只加欄位，不填值（種子沒有預設身分要求）', /setValue\(COLUMNS\.POSTS\.REQUIRED_ROLES\)/.test(seed) && !/setValue\([^)]*COMMITTEE/.test(seed));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
