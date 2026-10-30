// 第九十輪批次 QA 組：同日不兼任（領詩、司琴）——HARD_SAME_DAY_EXCLUSIVE。
// 執行方式：node tests/round90_qa_same_day.test.js
//
// 音樂部意見（Ivan 2026-10-30 決定）：領詩、司琴由幹事在職事表人手填（Posts.AutoGenerate=FALSE），
// 填了之後那個人同一個主日不可以再擔任其他崗位；系統可以調整（保留領詩／司琴，改另一格）。
//
//   QA1 純函式：違反掛在「其他崗位」那一格；錨按 Posts 次序；同一崗位兩格不算（DISTINCT_SLOT 的事）
//   QA2 findStateViolations_：認得出（有 PersonID）才查；認不出（只有名字）不查；規則可關；Config 改崗位
//   QA3 〔請系統幫我調整〕：保留領詩那一格、改另一格；另一格亦是人手填的崗位 ⇒ 不改、列入需要人手處理；勾保留 ⇒ 不動
//   QA4 生成：候選人今日已排別的崗位 ⇒ 不可以再排同日不兼任崗位；鎖定格的領詩先預留
//   QA5 人手檢查：已填的領詩那一日不再計入其他崗位的人手；補空格不新增同日兼任
//   QA6 核對職事表、規則審閱表、草稿覆核報告、狀態卡、Config
// 下面用假 ID（P97xx）、假名。
// FIXTURE-OK: 核對職事表（checkHardRuleViolations_）的 context 是純函式的直接輸入——assignSource 只用來
// 判斷 NO_AUTO_GENERATE，本測試要的是同日不兼任一組；其餘場景全部經真函式（findStateViolations_ 等）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 800));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['WebAppSaveConfirm.gs', 'SuggestionSheet.gs', 'Verify.gs',
  'RuleReview.gs', 'DraftReviewReport.gs']));
const R = gas.COLUMNS.RULE_SETTINGS;
const ID = gas.RULE_IDS;

const D1 = '2099-01-04';
const D2 = '2099-01-11';
const POSTS = [
  { postId: 'CHAIR', postNameTC: '主席', slotCount: 1, frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'WORSHIP', postNameTC: '領詩', slotCount: 1, frequency: 'WEEKLY', autoGenerate: false, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'PIANO', postNameTC: '司琴', slotCount: 1, frequency: 'WEEKLY', autoGenerate: false, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'USHER', postNameTC: '司事', slotCount: 2, frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
  { postId: 'FLOWER', postNameTC: '獻花', slotCount: 1, frequency: 'WEEKLY', autoGenerate: false, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
];
const PEOPLE = {
  P9701: { personId: 'P9701', nameTC: '假一', maxPerQuarter: null }, P9702: { personId: 'P9702', nameTC: '假二', maxPerQuarter: null },
  P9703: { personId: 'P9703', nameTC: '假三', maxPerQuarter: null }, P9704: { personId: 'P9704', nameTC: '假四', maxPerQuarter: null }
};
function ruleRow(id, level, enabled) {
  const r = {};
  r[R.RULE_ID] = id; r[R.LEVEL] = level; r[R.ENABLED] = enabled;
  return r;
}
function makeContext(opts) {
  opts = opts || {};
  return {
    posts: POSTS,
    serviceDates: [
      { serviceDateId: 'SD1', serviceDate: D1, weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true },
      { serviceDateId: 'SD2', serviceDate: D2, weekIndex: 2, isFirstSundayOfMonth: false, autoGenerate: true }
    ],
    specialByDate: {},
    eligibility: { byPost: opts.byPost || { CHAIR: ['P9701', 'P9702'], USHER: ['P9701', 'P9702', 'P9703', 'P9704'] }, explicitlyExcluded: {} },
    roles: [], personPostExclusions: [], unavailable: [],
    rules: opts.rules || {},
    peopleById: PEOPLE,
    warnOnSemiHard: true, maxPerQuarterDefault: 8, maxMoves: 20,
    sameDayExclusivePostIds: opts.ids === undefined ? ['WORSHIP', 'PIANO'] : opts.ids
  };
}
function cell(date, postId, slot, personId, extra) {
  return Object.assign({ serviceDateId: date === D1 ? 'SD1' : 'SD2', serviceDate: date, postId: postId, slotIndex: slot,
    personId: personId, isManual: false }, extra || {});
}
const sameDay = (vs) => vs.filter((v) => v.ruleId === ID.SAME_DAY_EXCLUSIVE);

// =====================================================================
console.log('\n=== QA1：純函式 ===');
{
  const cells = [cell(D1, 'WORSHIP', 1, 'P9701'), cell(D1, 'USHER', 1, 'P9701'), cell(D1, 'CHAIR', 1, 'P9702'),
    cell(D2, 'USHER', 1, 'P9701')];
  const xs = gas.findSameDayExclusiveConflicts_(cells, ['WORSHIP', 'PIANO'], POSTS);
  check('★★★★★★ 領詩那一日另有司事 ⇒ 違反掛在司事那一格（錨＝領詩）',
    xs.length === 1 && xs[0].cell.postId === 'USHER' && xs[0].anchor.postId === 'WORSHIP', JSON.stringify(xs));
  const both = gas.findSameDayExclusiveConflicts_([cell(D1, 'PIANO', 1, 'P9701'), cell(D1, 'WORSHIP', 1, 'P9701')],
    ['WORSHIP', 'PIANO'], POSTS);
  check('★★★★★ 同一人領詩＋司琴 ⇒ 按 Posts 次序領詩是錨，司琴那一格違反',
    both.length === 1 && both[0].cell.postId === 'PIANO' && both[0].anchor.postId === 'WORSHIP', JSON.stringify(both));
  check('★★★★ 同一崗位同日兩格同一人不算（那是 HARD_DISTINCT_SLOT）',
    gas.findSameDayExclusiveConflicts_([cell(D1, 'USHER', 1, 'P9701'), cell(D1, 'USHER', 2, 'P9701')], ['USHER'], POSTS).length === 0);
  check('★★★★ 沒有設崗位 ⇒ 不檢查', gas.findSameDayExclusiveConflicts_(cells, [], POSTS).length === 0);
  check('★★★★★ 句子：「假一 7 月 2 日已經是領詩，同日不可以再做司事。」',
    gas.buildSameDayExclusiveReason_('假一', '2099-07-02', '領詩', '司事') === '假一 7 月 2 日已經是領詩，同日不可以再做司事。');
  check('★★★★ Config 解析（逗號、頓號、空白、去重）',
    JSON.stringify(gas.parseSameDayExclusivePostIds_(' WORSHIP，PIANO、WORSHIP ')) === '["WORSHIP","PIANO"]');
  check('★★★★ 生成用：今日已有司事 ⇒ 不可以再排領詩（錨回領詩）；今日已是領詩 ⇒ 不可以再排司事',
    gas.sameDayExclusiveAnchorForCandidate_('WORSHIP', ['USHER'], null, ['WORSHIP', 'PIANO']) === 'WORSHIP'
    && gas.sameDayExclusiveAnchorForCandidate_('USHER', ['WORSHIP'], null, ['WORSHIP', 'PIANO']) === 'WORSHIP'
    && gas.sameDayExclusiveAnchorForCandidate_('USHER', ['CHAIR'], null, ['WORSHIP', 'PIANO']) === null
    && gas.sameDayExclusiveAnchorForCandidate_('USHER', [], 'PIANO', ['WORSHIP', 'PIANO']) === 'PIANO');
}

console.log('\n=== QA2：findStateViolations_ ===');
{
  const ctx = makeContext();
  const state = [cell(D1, 'WORSHIP', 1, 'P9701', { isManual: true }), cell(D1, 'USHER', 1, 'P9701'),
    cell(D1, 'USHER', 2, 'P9702'), cell(D1, 'CHAIR', 1, 'P9703')];
  const v = sameDay(gas.findStateViolations_(state, ctx));
  check('★★★★★★ 人手填的領詩（認得出 PersonID）＋同日司事 ⇒ 一項 HARD，掛在司事那一格',
    v.length === 1 && v[0].postId === 'USHER' && v[0].slotIndex === 1 && v[0].severity === 'HARD', JSON.stringify(v));
  check('★★★★★ 違規一句人話', v[0] && v[0].reason === '假一 1 月 4 日已經是領詩，同日不可以再做司事。', v[0] && v[0].reason);
  // 認不出：只有名字（外請、名單以外）⇒ 沒有 PersonID ⇒ 不查
  const free = [cell(D1, 'WORSHIP', 1, '', { isManual: true, freeText: '外請甲' }), cell(D1, 'USHER', 1, 'P9701')];
  check('★★★★★★ 認不出的名字（只有文字、沒有 PersonID）⇒ 不檢查', sameDay(gas.findStateViolations_(free, ctx)).length === 0);
  // 規則可關
  const off = makeContext({ rules: { HARD_SAME_DAY_EXCLUSIVE: ruleRow(ID.SAME_DAY_EXCLUSIVE, 'HARD', false) } });
  check('★★★★★★ RuleSettings 關掉 ⇒ 不檢查', sameDay(gas.findStateViolations_(state, off)).length === 0);
  check('★★★★★ RuleSettings 沒有這一行 ⇒ 預設開啟、HARD（RULE_DEFAULT_ENABLED／LEVELS）',
    gas.RULE_DEFAULT_ENABLED[ID.SAME_DAY_EXCLUSIVE] === true && gas.RULE_DEFAULT_LEVELS[ID.SAME_DAY_EXCLUSIVE] === 'HARD');
  // Config 改崗位：只有 PIANO ⇒ 領詩不再是錨
  check('★★★★★ Config 只設 PIANO ⇒ 領詩＋司事不算違反', sameDay(gas.findStateViolations_(state, makeContext({ ids: ['PIANO'] }))).length === 0);
  check('★★★★ context 沒有這一欄（舊測試自組的 context）⇒ 不檢查',
    sameDay(gas.findStateViolations_(state, Object.assign(makeContext(), { sameDayExclusivePostIds: undefined }))).length === 0);
  check('★★★★ 建 context 的地方一律放入（fine-tune／生成／核對／人手檢查）',
    /sameDayExclusivePostIds: readSameDayExclusivePostIds_\(\)/.test(read('src/FineTune.gs'))
    && /sameDayExclusivePostIds: readSameDayExclusivePostIds_\(\)/.test(read('src/Generator.gs'))
    && /sameDayExclusivePostIds: readSameDayExclusivePostIds_\(\)/.test(read('src/Verify.gs'))
    && /sameDayExclusivePostIds: sameDayIds/.test(read('src/StaffingCheck.gs')));
}

console.log('\n=== QA3：〔請系統幫我調整〕===');
{
  const ctx = makeContext();
  const state = [cell(D1, 'WORSHIP', 1, 'P9701', { isManual: true }), cell(D1, 'USHER', 1, 'P9701'),
    cell(D1, 'USHER', 2, 'P9702'), cell(D1, 'CHAIR', 1, 'P9703'),
    cell(D2, 'WORSHIP', 1, ''), cell(D2, 'USHER', 1, 'P9703'), cell(D2, 'USHER', 2, 'P9704'), cell(D2, 'CHAIR', 1, 'P9702')];
  const r = gas.proposeMinimalFixFromState_(ctx, { manualState: state }, { [D1 + '|WORSHIP|1']: true }, {}, null, {});
  const p = r.proposals.filter((x) => x.brokenRuleId === ID.SAME_DAY_EXCLUSIVE);
  check('★★★★★★ 保留人手填的領詩，改司事那一格（換成同日沒有崗位的人）',
    p.length === 1 && p[0].postId === 'USHER' && p[0].slotIndex === 1 && p[0].suggestedPersonId === 'P9704',
    JSON.stringify(r.proposals));
  check('★★★★★ 領詩那一格沒有任何建議', r.proposals.every((x) => x.postId !== 'WORSHIP'));
  check('★★★★ 原因先講「為甚麼」', p[0] && /已經是領詩，同日不可以再做司事/.test(p[0].reason), p[0] && p[0].reason);

  // 兩格都是人手填（領詩＋獻花）⇒ 不改，列入需要人手處理
  const manual2 = [cell(D1, 'WORSHIP', 1, 'P9701', { isManual: true }), cell(D1, 'FLOWER', 1, 'P9701', { isManual: true })];
  const ctx2 = makeContext({ byPost: { FLOWER: ['P9701', 'P9702'], USHER: ['P9702'] } });
  const r2 = gas.proposeMinimalFixFromState_(ctx2, { manualState: manual2 }, {}, {}, null, {});
  const p2 = r2.proposals.filter((x) => x.brokenRuleId === ID.SAME_DAY_EXCLUSIVE);
  check('★★★★★★ 另一格亦是人手填的崗位 ⇒ 不改、列入「需要人手處理」',
    p2.length === 1 && p2[0].postId === 'FLOWER' && !p2[0].suggestedPersonId
    && r2.unfixable.some((u) => u.postId === 'FLOWER' && u.ruleId === ID.SAME_DAY_EXCLUSIVE)
    && /兩格都是人手填的崗位，系統不會改，需要人手處理/.test(p2[0].reason), JSON.stringify(r2));

  // 勾「保留我的安排」⇒ 不動
  const r3 = gas.proposeMinimalFixFromState_(ctx, { manualState: state }, {}, {}, null, { [D1 + '|USHER|1']: true });
  check('★★★★★★ 司事那一格勾了「保留我的安排」⇒ 不動，列在 untouchedManual',
    r3.proposals.every((x) => !(x.postId === 'USHER' && x.slotIndex === 1 && x.serviceDate === D1))
    && r3.untouchedManual.some((u) => u.postId === 'USHER' && u.ruleId === ID.SAME_DAY_EXCLUSIVE && u.kept), JSON.stringify(r3.untouchedManual));

  // 找替補時不會揀當日的領詩
  const vac = { serviceDate: D1, serviceDateId: 'SD1', postId: 'USHER', slotIndex: 1, personId: '' };
  const st4 = [cell(D1, 'WORSHIP', 1, 'P9701', { isManual: true }), cell(D1, 'USHER', 1, ''), cell(D1, 'USHER', 2, 'P9702')];
  const rep = gas.findReplacementPerson_(vac, st4, makeContext({ byPost: { USHER: ['P9701', 'P9702', 'P9703'] } }));
  check('★★★★★ 填空格時不會揀當日的領詩', rep.personId === 'P9703', JSON.stringify(rep));
  // 保留了的同日兼任格，補空格的網絡亦不可以把人調走（之前網絡會當它不合法 ⇒ 當空格重排）
  const ws = gas.augmentGapFillsWithStaffingFlow_(makeContext({ rules: {
    HARD_NO_AUTO_PREACHER: ruleRow(ID.NO_AUTO_GENERATE, 'HARD', true), HARD_DISTINCT_SLOT: ruleRow(ID.DISTINCT_SLOT, 'HARD', true) } }),
  [cell(D1, 'WORSHIP', 1, 'P9701', { isManual: true }), cell(D1, 'USHER', 1, 'P9701', { kept: true }), cell(D1, 'USHER', 2, ''),
    cell(D1, 'CHAIR', 1, '')]);
  check('★★★★★★ 補空格網絡：勾了保留的格（kept）不會被調走', ws.changes.every((c) => !(c.postId === 'USHER' && c.slotIndex === 1)),
    JSON.stringify(ws));
  check('★★★★ 保留／放行／系統不動的格在補空格前標 kept', /if \(untouchedKeys\[cellKey_\(s\.serviceDate, s\.postId, s\.slotIndex\)\]\) s\.kept = true;/.test(read('src/SuggestionSheet.gs')));
  check('★★★★ FineTune.gs 舊入口（proposeMinimalFix_）一樣不改人手格',
    /isSameDayExclusiveManualOnlyViolation_\(violation, context\.posts\)/.test(read('src/FineTune.gs')));
}

console.log('\n=== QA4：生成 ===');
{
  const ctx = makeContext();
  ctx.existingAssignments = {};
  const base = { context: ctx, post: POSTS[3], serviceDate: { serviceDate: D1 }, weekByPost: {}, previousWeek: {},
    quarterCount: {}, postCount: {}, lastServed: {}, ratioState: { weeksCounted: 1 } };
  const vWorshipThenUsher = gas.evaluateViolations_('P9701', Object.assign({}, base, { weekByPerson: { P9701: ['WORSHIP'] } }));
  check('★★★★★★ 今日已是領詩 ⇒ 排司事是 HARD 違反（生成會避開）',
    vWorshipThenUsher.some((v) => v.ruleId === ID.SAME_DAY_EXCLUSIVE && v.level === 'HARD'), JSON.stringify(vWorshipThenUsher));
  const vWorship = gas.evaluateViolations_('P9701', Object.assign({}, base, { post: POSTS[1], weekByPerson: { P9701: ['CHAIR'] } }));
  const sd = vWorship.filter((v) => v.ruleId === ID.SAME_DAY_EXCLUSIVE)[0];
  check('★★★★★ 今日已有主席 ⇒ 排領詩亦違反，句子寫「已經是主席，同日不可以再做領詩」',
    sd && sd.reason === '假一 1 月 4 日已經是主席，同日不可以再做領詩。', sd && sd.reason);
  check('★★★★★ 今日只有主席 ⇒ 排司事不違反',
    !gas.evaluateViolations_('P9701', Object.assign({}, base, { weekByPerson: { P9701: ['CHAIR'] } }))
      .some((v) => v.ruleId === ID.SAME_DAY_EXCLUSIVE));
  // 鎖定格：領詩在 Posts 次序排在司事之前／之後都要先預留
  ctx.existingAssignments[D1 + '|WORSHIP|1'] = { personId: 'P9702', personName: '假二' };
  const reserved = gas.buildSameDayReservedForWeek_(ctx, { serviceDate: D1 }, { skipPostIds: [], lockPostIds: ['WORSHIP'] });
  check('★★★★★★ 鎖定格的領詩先預留（P9702 → WORSHIP）', reserved.P9702 === 'WORSHIP', JSON.stringify(reserved));
  const vReserved = gas.evaluateViolations_('P9702', Object.assign({}, base, { weekByPerson: {}, sameDayReserved: reserved }));
  check('★★★★★★ 預留了領詩的人 ⇒ 排司事是違反（就算鎖定格還未輪到處理）',
    vReserved.some((v) => v.ruleId === ID.SAME_DAY_EXCLUSIVE));
  check('★★★★ 鎖定格沒有領詩 ⇒ 不預留',
    Object.keys(gas.buildSameDayReservedForWeek_(ctx, { serviceDate: D1 }, { skipPostIds: [], lockPostIds: [] })).length === 0);
}

console.log('\n=== QA5：人手檢查、補空格 ===');
{
  // 一個主日：司事 2 格，名單 P9701、P9702；P9701 已填領詩 ⇒ 司事只有 1 人 ⇒ 最少 1 格留空
  const ctx = makeContext({ byPost: { USHER: ['P9701', 'P9702'] }, rules: {
    HARD_NO_AUTO_PREACHER: ruleRow(ID.NO_AUTO_GENERATE, 'HARD', true), HARD_DISTINCT_SLOT: ruleRow(ID.DISTINCT_SLOT, 'HARD', true) } });
  ctx.posts = [POSTS[1], POSTS[3]];
  ctx.serviceDates = [ctx.serviceDates[0]];
  ctx.sameDayFixed = [{ serviceDate: D1, postId: 'WORSHIP', personId: 'P9701' }];
  const st = gas.computeStaffingCheck_(ctx);
  check('★★★★★★ 已填的領詩那一日不再計入司事人手 ⇒ 最少 1 格留空', st.totalBlanks === 1, JSON.stringify(st));
  check('★★★★★ 原因「名單上的人那一日已經擔任不可以兼任的崗位」',
    st.posts[0] && st.posts[0].blankWeeks[0] && st.posts[0].blankWeeks[0].reasonCode === 'SAME_DAY', JSON.stringify(st.posts));
  const st0 = gas.computeStaffingCheck_(Object.assign({}, ctx, { sameDayFixed: [] }));
  check('★★★★ 未填領詩 ⇒ 不留空', st0.totalBlanks === 0, JSON.stringify(st0));
  const off = gas.computeStaffingCheck_(Object.assign({}, ctx, { rules: Object.assign({}, ctx.rules,
    { HARD_SAME_DAY_EXCLUSIVE: ruleRow(ID.SAME_DAY_EXCLUSIVE, 'HARD', false) }) }));
  check('★★★★ 規則關掉 ⇒ 照舊計', off.totalBlanks === 0, JSON.stringify(off));
  // 補空格（固定格是人手填的領詩）不可以把領詩的人放入司事
  const cells = [{ serviceDate: D1, postId: 'WORSHIP', slotIndex: 1, personId: 'P9701', fixed: true },
    { serviceDate: D1, postId: 'USHER', slotIndex: 1, personId: '', fixed: false },
    { serviceDate: D1, postId: 'USHER', slotIndex: 2, personId: '', fixed: false }];
  const aug = gas.augmentAssignmentsWithStaffingFlow_(Object.assign({}, ctx, { sameDayFixed: [] }), cells);
  check('★★★★★★ 補空格不會把當日領詩的人放入司事', aug.changes.every((c) => c.to !== 'P9701') && aug.blanksAfter === 1,
    JSON.stringify(aug));
  check('★★★★★ 兩條補空格路都有「不可以新增同日兼任」的把關',
    (read('src/StaffingCheck.gs').match(/sameDayExclusiveNotWorse_\(/g) || []).length === 2);
  check('★★★★ 人手檢查的模型有計這一條（不會被列成「沒有計入」）',
    gas.STAFFING_MODELED_RULE_IDS.indexOf(ID.SAME_DAY_EXCLUSIVE) !== -1);
}

console.log('\n=== QA6：核對職事表、規則審閱表、報告、狀態卡、Config ===');
{
  const vctx = {
    posts: POSTS, serviceDates: [{ serviceDate: D1, isFirstSundayOfMonth: true }], rules: {},
    eligibility: { byPost: { USHER: ['P9701'], CHAIR: ['P9701'] } }, roles: [], personPostExclusions: [], unavailable: [],
    sameDayExclusivePostIds: ['WORSHIP', 'PIANO'],
    assignments: [{ serviceDate: D1, postId: 'WORSHIP', slotIndex: 1, personId: 'P9701', personName: '假一', assignSource: 'MANUAL' },
      { serviceDate: D1, postId: 'USHER', slotIndex: 1, personId: 'P9701', personName: '假一', assignSource: 'AUTO' }]
  };
  const rep = gas.checkHardRuleViolations_(vctx);
  const g = rep.groups.filter((x) => /同日兼任/.test(x.label))[0];
  check('★★★★★★ 核對職事表有「同日兼任」一組，掛在司事', g && g.items.length === 1 && g.items[0].postId === 'USHER'
    && g.items[0].reason === '假一 1 月 4 日已經是領詩，同日不可以再做司事。', JSON.stringify(g));

  const entry = gas.ruleReviewPlainEntry_(ID.SAME_DAY_EXCLUSIVE);
  const on = {}; on[R.ENABLED] = true;
  check('★★★★★★ 規則審閱表「一定要遵守」有這一條，現時設定列出崗位',
    entry && /領詩、司琴/.test(entry.text) && entry.current(on, { sameDayExclusiveLabel: '領詩／司琴' }) === '有生效：領詩／司琴',
    JSON.stringify(entry));
  const built = gas.buildRuleReviewSheetRows_([], 13, { sameDayExclusiveLabel: '領詩／司琴' });
  const hardTitle = built.rows.findIndex((r) => String(r[0]).indexOf('一定要遵守') === 0);
  const idx = built.rows.findIndex((r) => r[1] === entry.text);
  check('★★★★★ RuleSettings 沒有這一行都列在「一定要遵守」', hardTitle >= 0 && idx > hardTitle, JSON.stringify(built.rows.map((r) => r[0] + ' ' + r[1])));
  check('★★★★ 草稿覆核報告有人話', gas.describeRuleForCommittee_(ID.SAME_DAY_EXCLUSIVE) !== '規則檢查');

  // 狀態卡：勾了保留的不計
  const ctx = makeContext();
  const state = [cell(D1, 'WORSHIP', 1, 'P9701'), cell(D1, 'USHER', 1, 'P9701'), cell(D2, 'PIANO', 1, 'P9702'), cell(D2, 'CHAIR', 1, 'P9702')];
  const s1 = gas.summariseSameDayExclusive_(state, ctx, () => false);
  check('★★★★★★ 狀態卡數字＝2，崗位名「領詩／司琴」', s1.count === 2 && s1.postsLabel === '領詩／司琴', JSON.stringify(s1));
  const s2 = gas.summariseSameDayExclusive_(state, ctx, (k) => k === D2 + '|CHAIR|1');
  check('★★★★★ 勾了「保留我的安排」的不計', s2.count === 1 && s2.items[0].postId === 'USHER', JSON.stringify(s2));
  check('★★★★ 狀態卡數字由 readDashboardUnsavedState_ 算（含未儲存的改動）',
    /sameDay = summariseSameDayExclusive_\(resolved\.state, context/.test(read('src/WebAppDashboard.gs')));

  const ui = loadUiScripts(['Script.html']);
  const nodes = ui.buildSameDayNodes({ count: 1, postsLabel: '領詩／司琴', items: [{ reason: '假一 1 月 4 日已經是領詩，同日不可以再做司事。' }] });
  const text = nodes.map((n) => n.textContent).join('');
  check('★★★★★★ 狀態卡句子「1 格同日兼任：領詩／司琴的人當日另有崗位」＋逐格原因',
    /1 格同日兼任：領詩／司琴的人當日另有崗位/.test(text) && /已經是領詩/.test(text), text);
  check('★★★★ 沒有就不畫', ui.buildSameDayNodes({ count: 0 }).length === 0 && ui.buildSameDayNodes(null).length === 0);
  check('★★★★ 狀態卡有接上', /buildSameDayNodes\(d\.unsaved && d\.unsaved\.sameDay\)/.test(read('src/ui/Script.html')));

  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ Config：SAME_DAY_EXCLUSIVE_POST_IDS 預設 WORSHIP,PIANO、有說明',
    /SAME_DAY_EXCLUSIVE_POST_IDS[\s\S]{0,200}defaultValue: 'WORSHIP,PIANO'[\s\S]{0,120}同一個主日不可以再擔任任何其他崗位/.test(seed));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
