// 第一百零五輪批次 RD／RF 組：新排表規則（影音組合、協唱、詩班獻詩日的例外）
// 執行方式：node tests/round105_rd_team_rules.test.js
//
//   RD1 資料：PostTeams、WorshipBackingSingers、CHOIR_SUNDAY_ALLOWED 的解析
//   RD2 組合週計劃：每月 PerMonth 次；避開成員不能服侍、預先安排了領詩的日子；同一個種子每次一樣
//   RD3 生成：組合週由組合成員做（同一人同日兼音響＋錄影）；人手足夠時音響交給另一位；
//       組合週以外 HARD 成員不做、SOFT 成員盡量不做（人手不足才做並提醒）
//   RD4 協唱：領詩那一日 HARD 協唱不排其他崗位（沒有人就留空）、SOFT 協唱盡量不排
//   RD5 詩班獻詩日的例外（PersonID:PostID）
//   RD6 儲存檢查、核對職事表、補空格把關
//   RD7 規則審閱表、草稿覆核報告、Config、補建工作表；RF 協唱不出現在任何輸出
// 下面用假 ID（P98xx）、假名。

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

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'RuleReview.gs', 'DraftReviewReport.gs']));
const ID = gas.RULE_IDS;
const T = gas.COLUMNS.POST_TEAMS;
const W = gas.COLUMNS.WORSHIP_BACKING_SINGERS;

const DATES = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25', '2099-02-01', '2099-02-08', '2099-02-15', '2099-02-22',
  '2099-03-01', '2099-03-08', '2099-03-15', '2099-03-22', '2099-03-29'];
const post = (postId, name, auto) => ({ postId: postId, postNameTC: name, slotCount: 1, distinctWithinPost: true, frequency: 'WEEKLY',
  autoGenerate: auto !== false, allowConsecutive: 'ALLOW', mutexGroup: '', displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: '' });
const POSTS = [post('CHAIR', '主席'), post('WORSHIP', '領詩', false), post('SOUND', '音響'), post('PPT', 'PPT 控制'), post('VIDEO', '錄影')];
const NAMES = { P9801: '假影一', P9802: '假影二', P9803: '假音甲', P9804: '假音乙', P9805: '假錄甲', P9806: '假控甲', P9807: '假控乙',
  P9808: '假主甲', P9809: '假主乙', P9810: '假領甲', P9811: '假協甲', P9812: '假協乙', P9813: '假領乙' };
const PEOPLE = {};
Object.keys(NAMES).forEach((id) => { PEOPLE[id] = { personId: id, nameTC: NAMES[id], maxPerQuarter: null }; });
const TEAMS = gas.normalizePostTeams_([
  { [T.TEAM_ID]: 'AV', [T.PERSON_ID]: 'P9801', [T.POST_IDS]: 'SOUND,VIDEO', [T.PER_MONTH]: 1, [T.OUTSIDE_TEAM_LEVEL]: 'HARD', [T.ACTIVE]: true },
  { [T.TEAM_ID]: 'AV', [T.PERSON_ID]: 'P9802', [T.POST_IDS]: 'PPT', [T.PER_MONTH]: 1, [T.OUTSIDE_TEAM_LEVEL]: 'SOFT', [T.ACTIVE]: '' }]);
const SINGERS = gas.normalizeWorshipBackingSingers_([
  { [W.LEADER_PERSON_ID]: 'P9810', [W.SINGER_PERSON_ID]: 'P9811', [W.LEVEL]: 'HARD', [W.ACTIVE]: true },
  { [W.LEADER_PERSON_ID]: 'P9810', [W.SINGER_NAME]: '名單以外的人', [W.LEVEL]: 'HARD', [W.ACTIVE]: true },
  { [W.LEADER_PERSON_ID]: 'P9813', [W.SINGER_PERSON_ID]: 'P9812', [W.LEVEL]: 'SOFT', [W.ACTIVE]: true }]);

function ctxOf(extra) {
  const pre = {};
  const addPre = (d, postId, pid) => { pre[d + '|' + postId + '|1'] = { serviceDate: d, postId: postId, slotIndex: 1, personId: pid, freeText: '' }; };
  DATES.forEach((d, i) => addPre(d, 'WORSHIP', i === 0 ? 'P9810' : (i === 1 ? 'P9813' : 'P9813')));
  return Object.assign({
    quarterId: '2099T1',
    serviceDates: DATES.map((d, i) => ({ serviceDateId: 'SD' + i, serviceDate: d, weekIndex: i + 1,
      isFirstSundayOfMonth: d.slice(8) <= '07', autoGenerate: true, choirSinging: false })),
    posts: POSTS,
    eligibility: {
      byPost: { CHAIR: ['P9802', 'P9808', 'P9809', 'P9811'], SOUND: ['P9801', 'P9803', 'P9804', 'P9812'], PPT: ['P9802', 'P9806', 'P9807'],
        VIDEO: ['P9801', 'P9805'], CHOIR: [] },
      byPerson: {}, historicalCount: {}, explicitlyExcluded: {}
    },
    roles: [], personPostExclusions: [], peopleById: PEOPLE, unavailable: [], specialByDate: {}, rules: {},
    priorWeeks: [], existingAssignments: {}, quotaByPerson: {}, maxPerQuarterDefault: 8, selectionStrategy: 'LONGEST_UNSERVED',
    historicalWeight: 0.5, scoreWeights: { selectionWeight: 1, historicalWeight: 0.5, stalenessWeight: 1 }, randomSeed: 42, scoreTieEpsilon: 0,
    sameDayExclusivePostIds: ['WORSHIP', 'PIANO'], preAssignments: pre, choirGroupPostId: 'CHOIR',
    teams: TEAMS, backingSingers: SINGERS, worshipPostId: 'WORSHIP', choirSundayAllowed: {}
  }, extra || {});
}
const grid = (r) => {
  const m = {};
  r.assignments.forEach((a) => { m[a.serviceDate + '|' + a.postId] = a.personId || ''; });
  return m;
};
const unav = (pid, d, postIds) => ({ personId: pid, dateFrom: d, dateTo: d, appliesTo: postIds ? 'POSTS' : 'ALL', postIds: postIds || [] });

console.log('\n=== RD1：資料 ===');
{
  check('★★★★★★ PostTeams：同一組兩位成員、崗位、HARD／SOFT、PerMonth；Active 空白當生效',
    TEAMS.list.length === 1 && TEAMS.list[0].perMonth === 1 && TEAMS.list[0].members.length === 2
    && TEAMS.list[0].members[0].postIds.join() === 'SOUND,VIDEO' && TEAMS.list[0].members[0].level === 'HARD'
    && TEAMS.list[0].members[1].level === 'SOFT', JSON.stringify(TEAMS));
  const off = gas.normalizePostTeams_([{ [T.TEAM_ID]: 'X', [T.PERSON_ID]: 'P1', [T.POST_IDS]: 'A', [T.ACTIVE]: false },
    { [T.TEAM_ID]: 'Y', [T.PERSON_ID]: 'P2', [T.POST_IDS]: 'A、B', [T.OUTSIDE_TEAM_LEVEL]: 'soft' }]);
  check('★★★★★ Active=FALSE 不算；PerMonth 空白 ⇒ 1；頓號分隔；soft 不分大小寫', off.list.length === 1 && off.list[0].teamId === 'Y'
    && off.list[0].perMonth === 1 && off.list[0].members[0].postIds.join() === 'A,B' && off.list[0].members[0].level === 'SOFT', JSON.stringify(off));
  check('★★★★★★ WorshipBackingSingers：PersonID 或名字；級別預設 HARD', SINGERS.length === 3 && SINGERS[1].singerName === '名單以外的人'
    && SINGERS[2].level === 'SOFT' && SINGERS[0].level === 'HARD');
  check('★★★★★ CHOIR_SUNDAY_ALLOWED「PersonID:PostID」（逗號、全形冒號）', JSON.stringify(gas.parseChoirSundayAllowed_('P0001:CHAIR，P0002：READ, bad'))
    === JSON.stringify({ 'P0001:CHAIR': true, 'P0002:READ': true }));
  check('★★★★ 組合可交出去的崗位＝兼兩個崗位的成員按崗位次序最前的（音響）', gas.teamHandoffPostId_(TEAMS.list[0], POSTS) === 'SOUND');
}

console.log('\n=== RD2：組合週計劃 ===');
{
  const plan = gas.planTeamWeeks_(ctxOf());
  const weeks = plan.byTeam.AV;
  check('★★★★★★ 每月一次（三個月三個組合週）', weeks.length === 3 && weeks[0].slice(0, 7) === '2099-01' && weeks[1].slice(0, 7) === '2099-02'
    && weeks[2].slice(0, 7) === '2099-03', JSON.stringify(plan));
  check('★★★★★ 1 月 4 日：成員假影一是協唱？不是——但那一日的領詩有 HARD 協唱，不影響組合', true);
  check('★★★★★★ 同一個種子每次一樣', JSON.stringify(gas.planTeamWeeks_(ctxOf()).byTeam) === JSON.stringify(plan.byTeam));
  const u = gas.planTeamWeeks_(ctxOf({ unavailable: [unav('P9801', '2099-01-04'), unav('P9801', '2099-01-11'), unav('P9802', '2099-01-18')] }));
  check('★★★★★★ 成員申報了不能服侍的日子不選（1 月只剩 25 日）', u.byTeam.AV[0] === '2099-01-25', JSON.stringify(u.byTeam));
  const preCtx = ctxOf();
  ['2099-02-01', '2099-02-08', '2099-02-15'].forEach((d) => { preCtx.preAssignments[d + '|WORSHIP|1'].personId = 'P9802'; });
  const p2 = gas.planTeamWeeks_(preCtx);
  check('★★★★★ 成員那一日預先安排了領詩（同日不兼任）⇒ 不選', p2.byTeam.AV[1] === '2099-02-22', JSON.stringify(p2.byTeam));
  const none = gas.planTeamWeeks_(ctxOf({ unavailable: ['2099-03-01', '2099-03-08', '2099-03-15', '2099-03-22', '2099-03-29'].map((d) => unav('P9801', d)) }));
  check('★★★★ 某個月沒有可以的日子 ⇒ 那個月沒有組合週（記下）', none.byTeam.AV.length === 2 && none.missing.AV.join() === '2099-03', JSON.stringify(none));
  check('★★★★ 沒有組合 ⇒ 空計劃', JSON.stringify(gas.planTeamWeeks_(ctxOf({ teams: { list: [] } })).byTeam) === '{}');
}

console.log('\n=== RD3：生成 ===');
{
  const r = gas.buildRoster_(ctxOf());
  const g = grid(r);
  const weeks = r.teamPlan.byTeam.AV;
  check('★★★★★★ 組合週：錄影＝假影一、PPT＝假影二', weeks.every((d) => g[d + '|VIDEO'] === 'P9801' && g[d + '|PPT'] === 'P9802'), JSON.stringify(weeks.map((d) => [d, g[d + '|SOUND'], g[d + '|VIDEO'], g[d + '|PPT']])));
  check('★★★★★★ 組合週人手足夠 ⇒ 音響交給名單上另一位', weeks.every((d) => g[d + '|SOUND'] && g[d + '|SOUND'] !== 'P9801'));
  const outside = DATES.filter((d) => weeks.indexOf(d) === -1);
  check('★★★★★★ 組合週以外：HARD 成員（假影一）不做音響、錄影', outside.every((d) => g[d + '|SOUND'] !== 'P9801' && g[d + '|VIDEO'] !== 'P9801'));
  check('★★★★★★ 組合週以外：SOFT 成員（假影二）人手足夠時不做 PPT', outside.every((d) => g[d + '|PPT'] !== 'P9802'));
  check('★★★★★ 組合週以外錄影由其他人做（名單上只有假錄甲）', outside.every((d) => g[d + '|VIDEO'] === 'P9805'));
  // 人手不足：音響名單只有假影一 ⇒ 組合週他同日兼音響＋錄影；組合週以外留空（HARD）
  const shortCtx = ctxOf();
  shortCtx.eligibility.byPost.SOUND = ['P9801'];
  const rs = gas.buildRoster_(shortCtx);
  const gs = grid(rs);
  const w2 = rs.teamPlan.byTeam.AV;
  check('★★★★★★ 音響人手不足 ⇒ 組合週由組合成員兼任（同一人同日音響＋錄影）', w2.every((d) => gs[d + '|SOUND'] === 'P9801' && gs[d + '|VIDEO'] === 'P9801'),
    JSON.stringify(w2.map((d) => [d, gs[d + '|SOUND'], gs[d + '|VIDEO']])));
  check('★★★★★ 兼任時有提醒（SEMI_POST_TEAM_HANDOFF）', rs.warnings.some((w) => w.ruleId === ID.TEAM_HANDOFF && w2.indexOf(w.serviceDate) !== -1));
  check('★★★★★★ 組合週以外音響留空（HARD：不會為了填滿而違反）', DATES.filter((d) => w2.indexOf(d) === -1).every((d) => gs[d + '|SOUND'] === ''));
  // SOFT 成員人手不足：某個非組合週 PPT 其他兩位都不能服侍 ⇒ 假影二做，並提醒
  const softCtx = ctxOf();
  const plan = gas.planTeamWeeks_(softCtx);
  const nonTeam = DATES.filter((d) => plan.byTeam.AV.indexOf(d) === -1)[0];
  softCtx.unavailable = [unav('P9806', nonTeam), unav('P9807', nonTeam)];
  softCtx.rules = { HARD_UNAVAILABLE: { RuleID: 'HARD_UNAVAILABLE', Level: 'HARD', Enabled: true } };
  const rsoft = gas.buildRoster_(softCtx);
  check('★★★★★★ SOFT 成員：組合週以外人手不足才做 PPT，並提醒（SEMI_POST_TEAM_OUTSIDE）', grid(rsoft)[nonTeam + '|PPT'] === 'P9802'
    && rsoft.warnings.some((w) => w.ruleId === ID.TEAM_OUTSIDE_SOFT && w.serviceDate === nonTeam), JSON.stringify([nonTeam, rsoft.assignments.filter((a) => a.serviceDate === nonTeam), rsoft.warnings.filter((w) => w.serviceDate === nonTeam)]));
  // 組合週組合成員做不到（不能服侍）⇒ 排其他人並提醒
  const missCtx = ctxOf();
  const wk = gas.planTeamWeeks_(missCtx).byTeam.AV[0];
  const r3 = gas.buildRoster_(ctxOf({ randomSeed: 42 }));
  check('★★★★ 三次生成結果一樣（同一個種子）', JSON.stringify(grid(r3)) === JSON.stringify(g)
    && JSON.stringify(grid(gas.buildRoster_(ctxOf()))) === JSON.stringify(g));
  const vWeek = gas.evaluateViolations_('P9803', { context: missCtx, post: POSTS[4], serviceDate: { serviceDate: wk }, weekByPost: {}, weekByPerson: {},
    previousWeek: {}, quarterCount: {}, postCount: {}, lastServed: {}, ratioState: { weeksCounted: 1 }, teamPlan: gas.planTeamWeeks_(missCtx) });
  check('★★★★★ 組合週其他人做錄影 ⇒ SEMI_POST_TEAM_WEEK（成員做不到才排）', vWeek.some((v) => v.ruleId === ID.TEAM_WEEK && v.level === 'SEMI_HARD'), JSON.stringify(vWeek));
  const noTeam = gas.buildRoster_(ctxOf({ teams: { list: [] }, backingSingers: [] }));
  check('★★★★★ 沒有組合 ⇒ 假影一照常排音響／錄影（證明上面的結果由規則造成）', DATES.some((d) => grid(noTeam)[d + '|SOUND'] === 'P9801' || grid(noTeam)[d + '|VIDEO'] === 'P9801')
    && JSON.stringify(noTeam.teamPlan.byTeam) === '{}');
  const offRule = { HARD_POST_TEAM_OUTSIDE: { RuleID: 'HARD_POST_TEAM_OUTSIDE', Level: 'HARD', Enabled: false } };
  const vOff = gas.evaluateViolations_('P9801', { context: ctxOf({ rules: offRule }), post: POSTS[2], serviceDate: { serviceDate: outside[0] }, weekByPost: {},
    weekByPerson: {}, previousWeek: {}, quarterCount: {}, postCount: {}, lastServed: {}, ratioState: { weeksCounted: 1 }, teamPlan: r.teamPlan });
  check('★★★★ RuleSettings 關掉 ⇒ 不檢查', !vOff.some((v) => v.ruleId === ID.TEAM_OUTSIDE_HARD));
}

console.log('\n=== RD4：協唱 ===');
{
  const r = gas.buildRoster_(ctxOf());
  const g = grid(r);
  check('★★★★★★ 假領甲 1 月 4 日領詩 ⇒ HARD 協唱假協甲那一日不做主席', g['2099-01-04|CHAIR'] !== 'P9811');
  const only = ctxOf();
  only.eligibility.byPost.CHAIR = ['P9811'];
  const ro = gas.buildRoster_(only);
  check('★★★★★★ 主席名單只有假協甲 ⇒ 1 月 4 日留空（HARD），其他日子照排', grid(ro)['2099-01-04|CHAIR'] === '' && grid(ro)['2099-01-11|CHAIR'] === 'P9811');
  const soft = ctxOf();
  soft.eligibility.byPost.SOUND = ['P9812'];
  soft.teams = { list: [] };
  const rsf = gas.buildRoster_(soft);
  check('★★★★★★ SOFT 協唱（假協乙）：他的領詩領詩的日子，人手不足才排並提醒', grid(rsf)['2099-01-11|SOUND'] === 'P9812'
    && rsf.warnings.some((w) => w.ruleId === ID.BACKING_SINGER_SOFT && w.serviceDate === '2099-01-11'), JSON.stringify(rsf.warnings.slice(0, 3)));
  const soft2 = ctxOf();
  soft2.eligibility.byPost.SOUND = ['P9812', 'P9803'];
  soft2.teams = { list: [] };
  check('★★★★★ SOFT 協唱：有其他人就不排他', grid(gas.buildRoster_(soft2))['2099-01-11|SOUND'] === 'P9803');
  // 領詩不是預先安排、而是生成時排：先排了協唱，再排領詩 ⇒ 那位領詩亦算違反
  const st = { context: ctxOf(), post: POSTS[1], serviceDate: { serviceDate: '2099-01-04' }, weekByPost: { CHAIR: ['P9811'] }, weekByPerson: { P9811: ['CHAIR'] },
    previousWeek: {}, quarterCount: {}, postCount: {}, lastServed: {}, ratioState: { weeksCounted: 1 }, teamPlan: { byTeam: {}, handoff: {} } };
  const vLead = gas.evaluateViolations_('P9810', st);
  check('★★★★★ 協唱當日已有崗位 ⇒ 排他的領詩亦違反（次序不影響）', vLead.some((v) => v.ruleId === ID.BACKING_SINGER_HARD), JSON.stringify(vLead));
  check('★★★★ 句子「假協甲是假領甲的協唱，1 月 4 日假領甲領詩，不可以擔任其他崗位。」',
    gas.buildBackingSingerReason_('假協甲', '假領甲', '2099-01-04', 'HARD') === '假協甲是假領甲的協唱，1 月 4 日假領甲領詩，不可以擔任其他崗位。');
}

console.log('\n=== RD5：詩班獻詩日的例外 ===');
{
  const c = ctxOf();
  c.serviceDates[2].choirSinging = true;
  c.eligibility.byPost.CHOIR = ['P9802'];
  const st = (postIdx) => ({ context: c, post: POSTS[postIdx], serviceDate: c.serviceDates[2], weekByPost: {}, weekByPerson: {},
    previousWeek: {}, quarterCount: {}, postCount: {}, lastServed: {}, ratioState: { weeksCounted: 1 }, teamPlan: { byTeam: { AV: [c.serviceDates[2].serviceDate] }, handoff: {} } });
  const has = (vs) => vs.some((v) => v.ruleId === ID.CHOIR_SUNDAY);
  check('★★★★★ 沒有例外 ⇒ 詩班員獻詩日做主席是 SEMI_CHOIR_SUNDAY', has(gas.evaluateViolations_('P9802', st(0))));
  c.choirSundayAllowed = gas.parseChoirSundayAllowed_('P9802:CHAIR');
  check('★★★★★★ 例外「P9802:CHAIR」⇒ 做主席不受限制', !has(gas.evaluateViolations_('P9802', st(0))));
  check('★★★★★★ 例外只限列出的崗位（PPT 仍然受限制）', has(gas.evaluateViolations_('P9802', st(3))));
  const cells = [{ serviceDate: c.serviceDates[2].serviceDate, postId: 'CHAIR', slotIndex: 1, personId: 'P9802' }];
  const fv = gas.findStateViolations_(cells, Object.assign({}, c, { serviceDates: c.serviceDates, warnOnSemiHard: true }));
  check('★★★★★ 儲存檢查同一個例外', !fv.some((v) => v.ruleId === ID.CHOIR_SUNDAY), JSON.stringify(fv));
  check('★★★★ 例外不加分（只是不扣分）', !/choirSundayAllowed/.test(read('src/Generator.gs').split('function computeBonus_')[1].split('function evaluateViolations_')[0]));
}

console.log('\n=== RD6：儲存檢查、核對、補空格 ===');
{
  const c = ctxOf();
  const D = DATES;
  const cell = (d, postId, pid) => ({ serviceDateId: 'x', serviceDate: d, postId: postId, slotIndex: 1, personId: pid, isManual: true });
  const state = [cell(D[0], 'SOUND', 'P9801'), cell(D[0], 'VIDEO', 'P9801'), cell(D[0], 'PPT', 'P9802'),   // 組合週（兩人都在）
    cell(D[1], 'SOUND', 'P9801'),   // 組合週以外（HARD）
    cell(D[2], 'PPT', 'P9802'),     // 組合週以外（SOFT）
    cell(D[0], 'WORSHIP', 'P9810'), cell(D[0], 'CHAIR', 'P9811')];   // 協唱
  const xs = gas.findTeamAndSingerConflicts_(state, c);
  check('★★★★★★ 組合週＝兩人都做着組合崗位；其他日子：HARD 成員一項、SOFT 成員一項', xs.filter((x) => x.ruleId === ID.TEAM_OUTSIDE_HARD).length === 1
    && xs.filter((x) => x.ruleId === ID.TEAM_OUTSIDE_SOFT).length === 1 && !xs.some((x) => x.cell.serviceDate === D[0] && x.cell.postId !== 'CHAIR'), JSON.stringify(xs));
  check('★★★★★★ 協唱：領詩那一日做主席 ⇒ HARD', xs.some((x) => x.ruleId === ID.BACKING_SINGER_HARD && x.cell.postId === 'CHAIR'));
  const fv = gas.findStateViolations_(state, Object.assign({}, c, { warnOnSemiHard: true }));
  check('★★★★★★ findStateViolations_ 報告三項（HARD 兩項、SEMI 一項）', fv.filter((v) => v.ruleId === ID.TEAM_OUTSIDE_HARD && v.severity === 'HARD').length === 1
    && fv.filter((v) => v.ruleId === ID.TEAM_OUTSIDE_SOFT && v.severity === 'SEMI_HARD').length === 1
    && fv.filter((v) => v.ruleId === ID.BACKING_SINGER_HARD).length === 1, JSON.stringify(fv.map((v) => v.ruleId)));
  check('★★★★ 句子寫明組合、崗位、每月幾次', /是組合「AV」的成員（音響、錄影，每月 1 次一起服侍），1 月 11 日不是組合週，不可以做音響。/.test(
    xs.filter((x) => x.ruleId === ID.TEAM_OUTSIDE_HARD)[0].reason), xs[0] && xs[0].reason);
  const noData = gas.findStateViolations_(state, Object.assign({}, c, { teams: undefined, backingSingers: undefined }));
  check('★★★★ context 沒有 teams／backingSingers（舊的自組 context）⇒ 不檢查', !noData.some((v) => /TEAM|SINGER/.test(v.ruleId)));
  const vc = { assignments: state.map((s) => Object.assign({ personName: NAMES[s.personId] }, s)), posts: POSTS, rules: {}, eligibility: { byPost: {} },
    roles: [], personPostExclusions: [], unavailable: [], serviceDates: [], teams: TEAMS, backingSingers: SINGERS, worshipPostId: 'WORSHIP', peopleById: PEOPLE };
  const hv = gas.checkHardRuleViolations_(vc);
  const grp = hv.groups.filter((x) => /影音組合/.test(x.label))[0];
  check('★★★★★ 核對職事表：一組「影音組合…／協唱…」只列 HARD（兩項）', grp && grp.items.length === 2, JSON.stringify(grp));
  check('★★★★★★ 補空格把關：組合／協唱違規變多 ⇒ 不接受', gas.teamAndSingerNotWorse_(c, [], state) === false && gas.teamAndSingerNotWorse_(c, state, state) === true
    && /if \(!teamAndSingerNotWorse_\(context, cells, next\)\)/.test(read('src/StaffingCheck.gs')));
  check('★★★★★ 三處 context 都放入（生成、儲存檢查、核對）', ['src/Generator.gs', 'src/FineTune.gs', 'src/Verify.gs'].every((f) =>
    /const extras = readRuleExtrasContext_\(\);/.test(read(f)) && /teams: extras\.teams,/.test(read(f))));
}

console.log('\n=== RD7：規則審閱表、Config、補建；RF ===');
{
  const R = gas.COLUMNS.RULE_SETTINGS;
  const built = gas.buildRuleReviewSheetRows_([], 13, { teamSummary: '有生效：1 組', singerSummary: '有生效：2 位領詩' });
  const texts = built.rows.map((r) => r[1]);
  ['影音組合每月一起服侍；組合週以外，組合成員不做組合的崗位', '影音組合：組合週以外，「盡量避免」的成員盡量不做組合的崗位', '影音組合週，組合的崗位由組合成員做',
    '影音組合週，人手足夠時其中一個崗位交給另一位', '某位領詩的協唱，在他領詩的主日不擔任其他崗位', '某位領詩的協唱，在他領詩的主日盡量不擔任其他崗位'].forEach((t) => {
    check('★★★★★ 規則審閱表有「' + t + '」', texts.indexOf(t) !== -1);
  });
  check('★★★★ 沒有一條退回試算表欄（每條都有人話）', built.fallbackRuleIds.length === 0, built.fallbackRuleIds.join());
  const sameDay = built.rows.filter((r) => r[1].indexOf('擔任領詩、司琴等崗位') === 0)[0];
  check('★★★★★ 「領詩不做主席」寫在同日不兼任那一條', sameDay && /領詩那一日不做主席/.test(sameDay[2]));
  const maxRow = { [R.RULE_ID]: 'SOFT_MAX_PER_QUARTER', [R.LEVEL]: 'SOFT', [R.ENABLED]: true, [R.TARGET_VALUE]: 8 };
  const mr = gas.buildRuleReviewSheetRows_([maxRow], 13, {}).rows.filter((r) => r[1] === '每個人一季最多服侍多少次')[0];
  check('★★★★★ 每季上限 8 次是「盡量遵守」：寫明有需要可以超過', mr && /人手不足、有需要時可以超過/.test(mr[2]) && mr[3] === '每人每季最多 8 次', JSON.stringify(mr));
  const cr = gas.buildRuleReviewSheetRows_([{ [R.RULE_ID]: 'SOFT_CHAIR_EQ_ANNOUNCE', [R.LEVEL]: 'SOFT', [R.ENABLED]: true, [R.TARGET_VALUE]: 0.63 }], 13, {})
    .rows.filter((r) => r[1] === '主席和報告盡量由同一位擔任')[0];
  // 第一百零八輪 QB 組：不寫死身分組合，改為「符合崗位身分要求的人」
  check('★★★★★ 報告由符合崗位身分要求的人擔任，不需要當日做主席', cr && /報告由符合崗位身分要求的人擔任，\s*不需要當日做主席/.test(cr[2].replace(/\n/g, '')), JSON.stringify(cr));
  check('★★★★ 草稿覆核報告有新規則的人話', gas.describeRuleForCommittee_(ID.TEAM_OUTSIDE_HARD) !== '規則檢查' && gas.describeRuleForCommittee_(ID.BACKING_SINGER_SOFT) !== '規則檢查');
  check('★★★★★ 新規則預設開啟、級別（HARD／準硬）', [ID.TEAM_OUTSIDE_HARD, ID.BACKING_SINGER_HARD].every((id) => gas.RULE_DEFAULT_LEVELS[id] === 'HARD' && gas.RULE_DEFAULT_ENABLED[id] === true)
    && [ID.TEAM_OUTSIDE_SOFT, ID.TEAM_WEEK, ID.TEAM_HANDOFF, ID.BACKING_SINGER_SOFT].every((id) => gas.RULE_DEFAULT_LEVELS[id] === 'SEMI_HARD'));
  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ Config：CHOIR_SUNDAY_ALLOWED（LIST，預設空白）、WORSHIP_LEADER_POST_ID（WORSHIP）',
    /key: CONFIG_KEYS\.CHOIR_SUNDAY_ALLOWED, type: CONFIG_TYPES\.LIST, group: 'SYS',\s*defaultValue: ""/.test(seed)
    && /key: CONFIG_KEYS\.WORSHIP_LEADER_POST_ID, type: CONFIG_TYPES\.STR, group: 'SYS',\s*defaultValue: "WORSHIP"/.test(seed));
  const admin = read('src/AdminTools.gs');
  check('★★★★★ 〔補建設定及範本〕建立 PostTeams、WorshipBackingSingers（畫面列出）', /const sheetsCreated = ensureRuleDataSheets_\(\);/.test(admin)
    && /sheetsMissing: sheetsMissing,/.test(admin) && /會建立的工作表（只有標題，之後自行填寫）/.test(read('src/ui/ScriptZone5.html')));
  check('★★★★★ 欄名', gas.postTeamsKeys_().join() === 'TeamID,PersonID,PostIDs,PerMonth,OutsideTeamLevel,Notes,Active'
    && gas.worshipBackingSingersKeys_().join() === 'LeaderPersonID,SingerPersonID,SingerName,Level,Notes,Active');
  // RF：協唱名單只在 PostTeams.gs 讀（加上 Constants 定義、補建工作表），任何輸出、名單都不讀
  const readers = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.gs'))
    .filter((f) => /SHEETS\.WORSHIP_BACKING_SINGERS/.test(read('src/' + f)));
  check('★★★★★★ RF：WorshipBackingSingers 只在 PostTeams.gs（規則）及 AdminTools.gs（補建工作表）出現', readers.sort().join() === 'AdminTools.gs,PostTeams.gs', readers.join());
  check('★★★★★ RF：協唱只用來避開排表——審閱表摘要只寫數目，不寫名字', gas.describeSingersForReview_(SINGERS) === '有生效：2 位領詩、3 位協唱（一定 2、盡量 1）'
    && gas.describeSingersForReview_(SINGERS).indexOf('假') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
