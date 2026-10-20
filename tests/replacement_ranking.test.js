// 第六十五輪批次 Z 組（排表演算法）：替補人選永遠揀 PersonID 最細那一個。
// 執行方式：node tests/replacement_ranking.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// `findReplacementPerson_()`（FineTune.gs）：候選池按 PersonID 排序，**第一個**通過全部
// 檢查嘅人就係答案。「不能服侍」申報嘅替補、「請系統幫我調整」嘅建議都用佢。
// 兩次實測都揀咗同日已經做主席嘅同一位會友去做司事（`Posts` 冇設 `MutexGroup`）。
//
// 只改「幾個合資格人選之間揀邊個」：①同日冇其他崗位優先 ②這一季格數少優先
// ③PersonID。主席兼報告啟用時，同日做緊拍檔崗位唔當作「有其他崗位」。
//
// 下面用假 ID（P97xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['WebAppSaveConfirm.gs']));
const R = gas.COLUMNS.RULE_SETTINGS;

const D1 = '2099-01-04';
const D2 = '2099-01-11';
function makeContext(byPost, rules) {
  return {
    posts: [
      { postId: 'CHAIR', postNameTC: '主席', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
      { postId: 'ANNOUNCE', postNameTC: '報告', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
      { postId: 'USHER', postNameTC: '司事', frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
    ],
    serviceDates: [
      { serviceDateId: 'SD1', serviceDate: D1, weekIndex: 1, isFirstSundayOfMonth: true },
      { serviceDateId: 'SD2', serviceDate: D2, weekIndex: 2, isFirstSundayOfMonth: false }
    ],
    eligibility: { byPost: byPost, explicitlyExcluded: {} },
    roles: [], personPostExclusions: [], unavailable: [],
    rules: rules || {},
    peopleById: {
      P9701: { personId: 'P9701', nameTC: '假一' }, P9702: { personId: 'P9702', nameTC: '假二' },
      P9703: { personId: 'P9703', nameTC: '假三' }, P9799: { personId: 'P9799', nameTC: '假九' }
    },
    warnOnSemiHard: true, maxPerQuarterDefault: 8
  };
}
function cell(date, postId, slot, personId) {
  return { serviceDateId: date === D1 ? 'SD1' : 'SD2', serviceDate: date, postId: postId, slotIndex: slot,
    personId: personId, isManual: false };
}
const vacancy = { serviceDate: D1, serviceDateId: 'SD1', postId: 'USHER', slotIndex: 1, personId: 'P9799' };

// =====================================================================
console.log('\n=== Z【核心】同日冇其他崗位嘅優先（就算 PersonID 較大） ===');
{
  const ctx = makeContext({ USHER: ['P9701', 'P9702'], CHAIR: ['P9701'] });
  const state = [cell(D1, 'CHAIR', 1, 'P9701'), cell(D1, 'USHER', 1, 'P9799')];
  const r = gas.findReplacementPerson_(vacancy, state, ctx);
  check('★★★★★★ 揀 P9702（同日冇崗位），唔係 PersonID 較細、同日已做主席嘅 P9701'
    + '——現場兩次都揀咗同日做主席嘅人去做司事',
    r.personId === 'P9702', JSON.stringify(r));
  check('★★★★ 冇「同日亦擔任」提示', !r.sameDayNote, r.reason);
}

console.log('\n=== Z：這一季格數少嘅優先；打和用 PersonID ===');
{
  const ctx = makeContext({ USHER: ['P9701', 'P9702', 'P9703'] });
  const state = [cell(D1, 'USHER', 1, 'P9799'), cell(D2, 'CHAIR', 1, 'P9701'), cell(D2, 'ANNOUNCE', 1, 'P9702')];
  check('★★★★★★ P9703（這一季 0 格）先過 P9701、P9702（各 1 格）',
    gas.findReplacementPerson_(vacancy, state, ctx).personId === 'P9703');
  const tie = [cell(D1, 'USHER', 1, 'P9799')];
  check('★★★★★ 全部打和 ⇒ PersonID 最細（結果穩定）',
    gas.findReplacementPerson_(vacancy, tie, ctx).personId === 'P9701');
  const again = gas.findReplacementPerson_(vacancy, state, ctx).personId;
  check('★★★★★ 同一個輸入永遠同一個答案', again === 'P9703');
  check('★★★★ 排序唔改 state', state.length === 3 && state[0].personId === 'P9799');
}

console.log('\n=== Z：冇更好嘅人選 ⇒ 揀同日有崗位嗰個，而且講出嚟 ===');
{
  const ctx = makeContext({ USHER: ['P9701'], CHAIR: ['P9701'] });
  const state = [cell(D1, 'CHAIR', 1, 'P9701'), cell(D1, 'USHER', 1, 'P9799')];
  const r = gas.findReplacementPerson_(vacancy, state, ctx);
  check('（前置）仍然揀到', r.personId === 'P9701', JSON.stringify(r));
  check('★★★★★★ 提示「假一 同日亦擔任 主席」（畫面用中文名）', r.sameDayNote === '假一 同日亦擔任 主席', r.sameDayNote);
  check('★★★★★ 建議原因都帶埋（「請系統幫我調整」用呢句）', /建議改派 假一（假一 同日亦擔任 主席）/.test(r.reason), r.reason);
}

console.log('\n=== Z：主席兼報告——拍檔崗位唔當作「同日有其他崗位」 ===');
{
  const rules = {};
  const rule = {}; rule[R.ENABLED] = 'TRUE'; rule[R.SCOPE_POST_IDS] = 'CHAIR,ANNOUNCE'; rule[R.TARGET_VALUE] = 0.5;
  rules[gas.RULE_IDS.CHAIR_EQ_ANNOUNCE] = rule;
  const v = { serviceDate: D1, serviceDateId: 'SD1', postId: 'ANNOUNCE', slotIndex: 1, personId: 'P9799' };
  // P9701 同日做主席（1 格）；P9702 冇同日崗位但這一季 2 格
  const state = [cell(D1, 'CHAIR', 1, 'P9701'), cell(D1, 'ANNOUNCE', 1, 'P9799'),
    cell(D2, 'USHER', 1, 'P9702'), cell(D2, 'CHAIR', 1, 'P9702')];
  const on = gas.findReplacementPerson_(v, state, makeContext({ ANNOUNCE: ['P9701', 'P9702'] }, rules));
  check('★★★★★★ 規則啟用：當日主席照樣排得上報告（唔被第①點推後），而且冇提示',
    on.personId === 'P9701' && !on.sameDayNote, JSON.stringify(on));
  const off = gas.findReplacementPerson_(v, state, makeContext({ ANNOUNCE: ['P9701', 'P9702'] }, {}));
  check('★★★★★ 規則冇啟用：同日做主席就算「有其他崗位」⇒ 揀 P9702',
    off.personId === 'P9702', JSON.stringify(off));
}

console.log('\n=== Z：處理結果、儲存完成畫面都講 ===');
{
  const ra = read('src/RequestsApply.gs');
  check('★★★★★ 申報處理結果（Requests H 欄）帶 sameDayNote',
    /' 已由 ' \+ rName \+ ' 替補'\s*\n\s*\+ \(replacement\.sameDayNote \? '；' \+ replacement\.sameDayNote : ''\)/.test(ra));

  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const row = function (date, postId, slot, personId) {
    const r = {}; r[A.QUARTER_ID] = '2099T1'; r[A.VERSION_NO] = 2; r[A.SERVICE_DATE] = date;
    r[A.POST_ID] = postId; r[A.SLOT_INDEX] = slot; r[A.PERSON_ID] = personId; return r;
  };
  gas.readSheet = function () {
    return [row(D1, 'CHAIR', 1, 'P9701'), row(D1, 'USHER', 1, 'P9701'), row(D2, 'USHER', 2, 'P9702')];
  };
  gas.getConfig = function (_k, d) { return d; };
  const diffs = [
    { serviceDate: D1, postId: 'USHER', slotIndex: 1, fromName: '假九', toName: '假一', fromPersonId: 'P9799', toPersonId: 'P9701' },
    { serviceDate: D2, postId: 'USHER', slotIndex: 2, fromName: '假三', toName: '假二', fromPersonId: 'P9703', toPersonId: 'P9702' }
  ];
  const rows = gas.buildSavedChangeRows_(diffs, { USHER: '司事', CHAIR: '主席' }, 'REQUEST');
  gas.noteRequestSameDayDuties_(rows, diffs, '2099T1', 2, { USHER: '司事', CHAIR: '主席' });
  check('★★★★★★ 儲存完成：接手人同日亦做主席 ⇒ 「假一 同日亦擔任 主席」', rows[0].sameDayNote === '假一 同日亦擔任 主席',
    JSON.stringify(rows[0]));
  check('★★★★ 冇其他崗位嘅唔加', !rows[1].sameDayNote, JSON.stringify(rows[1]));

  const sc = read('src/WebAppSaveConfirm.gs');
  const fn = sc.slice(sc.indexOf('function buildSavedChangeRowsForSave_('));
  check('★★★★★ 儲存流程真係有叫（申報帶嚟嗰批）',
    /noteRequestSameDayDuties_\(fromRequests, diffs, quarterId, newVersionNo, postNames\);/.test(fn.slice(0, 1500)));

  const ui = loadUiScripts(['Script.html']);
  const nodes = ui.savedChangeNodes(rows, 0);
  check('★★★★★ 畫面顯示嗰句', /⚠ 假一 同日亦擔任 主席/.test(nodes[0].textContent), nodes[0].textContent);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
