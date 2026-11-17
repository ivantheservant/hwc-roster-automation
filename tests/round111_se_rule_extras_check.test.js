// 第一百一十一輪批次 SE 組：影音組合、協唱、詩班獻詩日例外——資料核對，以及找不到組合週時的提示
// 執行方式：node tests/round111_se_rule_extras_check.test.js
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

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['RuleExtrasCheck.gs', 'PreseasonChange.gs']));
const T = gas.COLUMNS.POST_TEAMS;
const W = gas.COLUMNS.WORSHIP_BACKING_SINGERS;
const I = gas.RULE_EXTRAS_ISSUE;

const PEOPLE = {
  P9801: { name: '假影一', active: true }, P9802: { name: '假影二', active: true }, P9803: { name: '假停用', active: false },
  P9810: { name: '假領甲', active: true }, P9811: { name: '假協甲', active: true }
};
const POSTS = { SOUND: { name: '音響', active: true }, VIDEO: { name: '錄影', active: true }, PPT: { name: 'PPT 控制', active: true },
  OLD: { name: '舊崗位', active: false }, WORSHIP: { name: '領詩', active: true }, CHAIR: { name: '主席', active: true } };
const ELIG = { 'P9801:SOUND': true, 'P9801:VIDEO': true, 'P9802:PPT': true, 'P9810:WORSHIP': true, 'P9801:CHAIR': true };
const teamRow = (row, o) => Object.assign({ __row: row, [T.TEAM_ID]: 'AV', [T.PERSON_ID]: 'P9801', [T.POST_IDS]: 'SOUND,VIDEO',
  [T.PER_MONTH]: 1, [T.OUTSIDE_TEAM_LEVEL]: 'HARD', [T.ACTIVE]: true }, o || {});
const singerRow = (row, o) => Object.assign({ __row: row, [W.LEADER_PERSON_ID]: 'P9810', [W.SINGER_PERSON_ID]: 'P9811', [W.SINGER_NAME]: '',
  [W.LEVEL]: 'HARD', [W.ACTIVE]: true }, o || {});
const run = (o) => gas.validateRuleExtrasData_(Object.assign({ teamRows: [], singerRows: [], choirRaw: '', people: PEOPLE, posts: POSTS,
  eligible: ELIG, worshipPostId: 'WORSHIP' }, o || {}));
const codes = (r) => r.issues.map((i) => i.code + '@' + i.row).join();

console.log('\n=== SE1：資料正確 ⇒ 沒有問題 ===');
{
  const r = run({ teamRows: [teamRow(3), teamRow(4, { [T.PERSON_ID]: 'P9802', [T.POST_IDS]: 'PPT', [T.OUTSIDE_TEAM_LEVEL]: 'soft' })],
    singerRows: [singerRow(3), singerRow(4, { [W.SINGER_PERSON_ID]: '', [W.SINGER_NAME]: '名單以外的人' })], choirRaw: 'P9801:CHAIR' });
  check('★★★★★★ 正確資料 ⇒ ok、沒有問題、計數正確', r.ok && r.issues.length === 0 && r.counts.teamRows === 2 && r.counts.singerRows === 2
    && r.counts.choirEntries === 1, JSON.stringify(r));
  check('★★★★★ 回傳結構穩定（ok／counts／issues／lines）', ['ok', 'counts', 'issues', 'lines'].every((k) => k in r));
  check('★★★★ 停用的行不核對', run({ teamRows: [teamRow(3, { [T.PERSON_ID]: 'P9999', [T.ACTIVE]: false })] }).ok);
}

console.log('\n=== SE2：每種錯誤 ===');
{
  const r = run({ teamRows: [
    teamRow(3, { [T.PERSON_ID]: 'P9999' }),                                   // 不在名單
    teamRow(4, { [T.PERSON_ID]: 'P9803' }),                                   // 已停用
    teamRow(5, { [T.POST_IDS]: 'SOUND,NOPE' }),                               // 崗位不存在
    teamRow(6, { [T.POST_IDS]: 'OLD' }),                                      // 崗位已停用
    teamRow(7, { [T.PERSON_ID]: 'P9802', [T.POST_IDS]: 'SOUND' }),            // 不在崗位名單
    teamRow(8, { [T.PER_MONTH]: 'two' }),                                     // 每月幾次無效
    teamRow(9, { [T.OUTSIDE_TEAM_LEVEL]: 'MAYBE' }),                          // 級別無效
    teamRow(10, { [T.TEAM_ID]: '' })                                          // 必填空白
  ] });
  const c = codes(r);
  check('★★★★★★ PostTeams：不在名單／已停用／崗位不存在／崗位停用／不在崗位名單／每月幾次／級別／空白',
    c === [I.PERSON_MISSING + '@3', I.PERSON_INACTIVE + '@4', I.POST_MISSING + '@5', I.POST_INACTIVE + '@6', I.NOT_ON_POST_LIST + '@7',
      I.PER_MONTH_INVALID + '@8', I.LEVEL_INVALID + '@9', I.INCOMPLETE + '@10'].join(), c);
  check('★★★★★ 每項都有來源、規則名稱、欄名', r.issues.every((i) => i.source === 'PostTeams' && i.rule === '影音組合' && i.field));
  const line7 = r.lines[4];
  check('★★★★★★ 畫面用名字和崗位名稱，不用 ID（名單上有的人）', line7.indexOf('假影二') !== -1 && line7.indexOf('音響') !== -1
    && line7.indexOf('P9802') === -1 && line7.indexOf('PostTeams 第 7 行') === 0, line7);
  check('★★★★★★ 寫明這一行的規則這一次不會生效', /這一行的「影音組合」規則這一次不會生效/.test(line7), line7);
  check('★★★★ 每月幾次、級別無效只是提示（寫明當作甚麼），不寫「不會生效」', /當作 1/.test(r.lines[5]) && r.lines[5].indexOf('不會生效') === -1
    && /當作 HARD/.test(r.lines[6]));
  const s = run({ singerRows: [singerRow(3, { [W.LEADER_PERSON_ID]: 'P9801' }), singerRow(4, { [W.SINGER_PERSON_ID]: 'P9999' }),
    singerRow(5, { [W.SINGER_PERSON_ID]: '', [W.SINGER_NAME]: '' }), singerRow(6, { [W.LEVEL]: 'X' })] });
  check('★★★★★★ 協唱：領詩不在領詩名單／協唱不在名單／協唱空白／級別', codes(s) === [I.NOT_ON_POST_LIST + '@3', I.PERSON_MISSING + '@4',
    I.INCOMPLETE + '@5', I.LEVEL_INVALID + '@6'].join(), codes(s));
  const ch = run({ choirRaw: 'P9801:CHAIR, bad, P9999:CHAIR，P9802：CHAIR' });
  check('★★★★★★ 詩班獻詩日例外：格式／不在名單／不在崗位名單（第幾項）', codes(ch) === [I.FORMAT_INVALID + '@2', I.PERSON_MISSING + '@3',
    I.NOT_ON_POST_LIST + '@4'].join() && ch.counts.choirEntries === 4 && /Config CHOIR_SUNDAY_ALLOWED 第 2 項/.test(ch.lines[0]), codes(ch) + ch.lines[0]);
  const note = gas.describeRuleExtrasCheckNote_(r);
  check('★★★★★ 「這一季還要做的」／生成確認窗那一句：規則名稱、項數、逐行', /^影音組合的資料有 8 項問題/.test(note) && note.indexOf('PostTeams 第 3 行') !== -1, note);
  check('★★★★ 沒有問題 ⇒ 空字串；讀不到（null）⇒ 空字串', gas.describeRuleExtrasCheckNote_(run()) === '' && gas.describeRuleExtrasCheckNote_(null) === '');
}

console.log('\n=== SE3：找不到組合週 ⇒ 原因類別 ===');
{
  const DATES = ['2099-03-01', '2099-03-08', '2099-03-15', '2099-03-22', '2099-03-29'];
  const post = (postId, name) => ({ postId: postId, postNameTC: name, slotCount: 1, distinctWithinPost: true, frequency: 'WEEKLY', autoGenerate: true,
    allowConsecutive: 'ALLOW', mutexGroup: '', displayOrder: 1, emptyDisplay: 'PENDING', earlyArrivalMinutes: 0, requiredRoles: '' });
  const teams = gas.normalizePostTeams_([teamRow(3), teamRow(4, { [T.PERSON_ID]: 'P9802', [T.POST_IDS]: 'PPT' })]);
  const pre = {};
  pre['2099-03-15|WORSHIP|1'] = { serviceDate: '2099-03-15', postId: 'WORSHIP', slotIndex: 1, personId: 'P9802', freeText: '' };
  const unav = (pid, d) => ({ personId: pid, dateFrom: d, dateTo: d, appliesTo: 'ALL', postIds: [] });
  const ctx = {
    serviceDates: DATES.map((d, i) => ({ serviceDateId: 'SD' + i, serviceDate: d, weekIndex: i + 1, isFirstSundayOfMonth: d.slice(8) <= '07', autoGenerate: true, choirSinging: false })),
    posts: [post('WORSHIP', '領詩'), post('SOUND', '音響'), post('VIDEO', '錄影'), post('PPT', 'PPT 控制')],
    peopleById: { P9801: {}, P9802: {} }, rules: {}, sameDayExclusivePostIds: ['WORSHIP'], preAssignments: pre,
    unavailable: [unav('P9801', '2099-03-01'), unav('P9801', '2099-03-08'), unav('P9802', '2099-03-22')],
    specialByDate: { '2099-03-29': { skipPostIds: ['SOUND', 'VIDEO', 'PPT'], lockPostIds: [] } },
    teams: teams, backingSingers: [], worshipPostId: 'WORSHIP', choirSundayAllowed: {}, randomSeed: 7
  };
  const plan = gas.planTeamWeeks_(ctx);
  check('★★★★★★ 3 月沒有一日可以 ⇒ missing 及 missingDetail（原因類別逐日計）', plan.missing.AV.join() === '2099-03'
    && JSON.stringify(plan.missingDetail.AV) === JSON.stringify([{ month: '2099-03', reasons: { UNAVAILABLE: 3, PREASSIGNED: 1, COMBINED: 1 } }]),
  JSON.stringify(plan.missingDetail));
  const lines = gas.describeTeamWeekGaps_(plan);
  check('★★★★★★ 提示一句：組合、月份、原因類別、後果', lines.length === 1 && lines[0].indexOf('影音組合 AV：2099年3月找不到全組都可以服侍的主日') === 0
    && /有成員不能服侍 3 個主日/.test(lines[0]) && /已預先安排領詩或司琴 1 個主日/.test(lines[0]) && /合堂或這一週不用排 1 個主日/.test(lines[0]), lines[0]);
  check('★★★★ 找到組合週 ⇒ 沒有提示', gas.describeTeamWeekGaps_(gas.planTeamWeeks_(Object.assign({}, ctx, { unavailable: [] }))).length === 0);
  check('★★★★ 沒有計劃 ⇒ []', gas.describeTeamWeekGaps_(null).length === 0);
}

console.log('\n=== SE4：接線（生成確認窗、完成窗、狀態卡、「這一季還要做的」、上線前檢查） ===');
{
  const gen = read('src/WebAppGenerate.gs');
  check('★★★★★ 生成確認窗：ruleExtrasNote', /ruleExtrasNote: \(typeof checkRuleExtrasData_ === 'function' \? describeRuleExtrasCheckNote_\(checkRuleExtrasData_\(\)\) : ''\)/.test(gen));
  check('★★★★★ 生成完成窗：teamWeekGaps', /teamWeekGaps: result\.teamWeekGaps \|\| \[\]/.test(gen));
  const mr = read('src/MultiRun.gs');
  check('★★★★★ 最好的一次生成的組合週計劃 ⇒ teamWeekGaps；生成後記下（狀態卡）',
    /teamWeekGaps: typeof describeTeamWeekGaps_ === 'function' \? describeTeamWeekGaps_\(best\.roster\.teamPlan\) : \[\]/.test(mr)
    && /saveTeamWeekGaps_\(quarterId, genResult\.teamWeekGaps \|\| \[\]\)/.test(mr));
  const dash = read('src/WebAppDashboard.gs');
  check('★★★★★ 狀態資料：ruleExtrasNote、teamWeekGaps（有版本才讀）', /ruleExtrasNote: \(typeof checkRuleExtrasData_/.test(dash)
    && /teamWeekGaps: versionExists && typeof readTeamWeekGaps_ === 'function' \? readTeamWeekGaps_\(quarterId\) : \[\]/.test(dash));
  check('★★★★★ 前端：確認窗、完成窗、這一季還要做的、狀態卡', /plan\.ruleExtrasNote/.test(read('src/ui/ScriptZone1.html'))
    && /res\.teamWeekGaps/.test(read('src/ui/ScriptZone1.html')) && /d\.ruleExtrasNote/.test(read('src/ui/ScriptZone2.html'))
    && /renderTeamWeekGaps_\(d\.teamWeekGaps \|\| \[\]\)/.test(read('src/ui/Script.html')));
  const pl = read('src/PreLaunchWeb.gs');
  check('★★★★★ 上線前檢查：三項「已填而且沒有問題／沒有問題」，有問題逐行列出', /影音組合（PostTeams）已填而且沒有問題/.test(pl)
    && /協唱（WorshipBackingSingers）已填而且沒有問題/.test(pl) && /詩班獻詩日例外（CHOIR_SUNDAY_ALLOWED）沒有問題/.test(pl)
    && /describeRuleExtrasIssue_/.test(pl));
}

console.log('\n=== SE5：開季前資料改動偵測 ===');
{
  const ids = gas.PRESEASON_CHANGE_CATEGORIES.map((c) => c.id);
  check('★★★★★★ 加入 TEAMS、SINGERS、CHOIR_ALLOWED', ['TEAMS', 'SINGERS', 'CHOIR_ALLOWED'].every((id) => ids.indexOf(id) !== -1));
  const base = { TEAMS: { a: '1' }, SINGERS: {}, CHOIR_ALLOWED: { k: 'T' } };
  const d = gas.diffPreseasonSnapshots_(base, { TEAMS: { a: '2' }, SINGERS: { s: '1' }, CHOIR_ALLOWED: {} });
  check('★★★★★★ 已有版本之後這三類有改動 ⇒ 列出', JSON.stringify(d.map((x) => x.id + x.count)) === JSON.stringify(['TEAMS1', 'SINGERS1', 'CHOIR_ALLOWED1']),
    JSON.stringify(d));
  check('★★★★★★ 舊基準沒有這三類 ⇒ 不當作改動（避免部署後誤報）', gas.diffPreseasonSnapshots_({ ELIG: {} }, { ELIG: {}, TEAMS: { a: '1' } }).length === 0);
  check('★★★★★ 舊類別仍然照比較（舊基準沒有 ⇒ 全部當新增）', gas.diffPreseasonSnapshots_({ ELIG: {} }, { ELIG: {}, ROLES: { x: '1' } }).length === 1);
  const src = read('src/PreseasonChange.gs');
  check('★★★★ 快照讀 PostTeams、WorshipBackingSingers、Config CHOIR_SUNDAY_ALLOWED', /out\.TEAMS = /.test(src) && /out\.SINGERS = /.test(src) && /out\.CHOIR_ALLOWED = /.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
