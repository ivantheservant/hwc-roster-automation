// 第八十五輪批次 LD 組：每人每季崗位上限、人手檢查、生成不可以多留空。
// 執行方式：node tests/round85_ld_staffing.test.js
//
//   LD1　讀經 5 人、每人每季最多 1 次、13 週 ⇒ 人手檢查寫 8 格；一段話照 Ivan 的例子
//   LD2　新硬規則：生成不會排超過上限；檢查我的改動／儲存（findStateViolations_）、核對職事表認得
//   LD3　貪心法會失敗的例子：增廣補空格 ⇒ 達到最少留空；生成（多個種子）留空數＝人手檢查最少留空數
//   LD4　同週不可兼任（主席＋聖餐襄禮）
//   LD5　身分按日期；不能服侍；SOFT_MAX_PER_QUARTER 改成 HARD 也計入
//   LD6　規則審閱表「一定要遵守」列出（逐個崗位／沒有設定）；生成確認窗資料；主畫面摘要＋快取
//   LD7　〔請系統幫我調整〕：逐格找不到人時用網絡補（MAKE_ROOM）
//   LD8　速度：90 人 × 16 崗位 × 13 週
// 下面用假資料（P9xxx），不涉及真實姓名。

const { loadGasSource } = require('./helpers/gas_loader.js');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'PersonPostWeight.gs',
  'Generator.gs', 'FineTune.gs', 'Verify.gs']);
const rule = (level, extra) => Object.assign({ Enabled: true, Level: level, OnViolation: 'BLOCK', Priority: 1 }, extra || {});
function weeks(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2099, 0, 4 + 7 * i));
    out.push({ serviceDateId: 'SD' + i, serviceDate: d.toISOString().slice(0, 10), weekIndex: i + 1,
      isFirstSundayOfMonth: d.getUTCDate() <= 7, serviceType: '主日崇拜', autoGenerate: true });
  }
  return out;
}
function post(id, name, extra) {
  return Object.assign({ postId: id, postNameTC: name, slotCount: 1, distinctWithinPost: false, frequency: 'WEEKLY',
    autoGenerate: true, allowConsecutive: 'ALLOW', mutexGroup: '', displayOrder: 1, requiredRoles: '',
    maxPerPersonPerQuarter: null }, extra || {});
}
function ctxOf(o) {
  const people = {};
  (o.people || []).forEach((id) => { people[id] = { personId: id, nameTC: '假' + id, maxPerQuarter: null }; });
  return {
    serviceDates: o.serviceDates, posts: o.posts,
    eligibility: { byPost: o.byPost, roleOnlyByPost: {}, historicalCount: {}, explicitlyExcluded: {} },
    roles: o.roles || [], personPostExclusions: [], unavailable: o.unavailable || [], peopleById: people,
    specialByDate: {}, rules: Object.assign({
      HARD_ELIGIBILITY: rule('HARD'), HARD_UNAVAILABLE: rule('HARD'), HARD_DISTINCT_SLOT: rule('HARD'),
      HARD_MUTEX_GROUP: rule('HARD')
    }, o.rules || {}), maxPerQuarterDefault: 8
  };
}
const P = (n) => Array.from({ length: n }, (_, i) => 'P9' + String(i + 1).padStart(3, '0'));

console.log('\n=== LD1：讀經 5 人、上限 1、13 週 ===');
{
  const ctx = ctxOf({ serviceDates: weeks(13), posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 1 })],
    byPost: { READ: P(5) }, people: P(5) });
  const r = gas.computeStaffingCheck_(ctx);
  check('★★★★★★ 最少留空 8 格', r.totalBlanks === 8, JSON.stringify(r));
  const p = r.posts[0];
  check('★★★★★★ 一段話照 Ivan 的例子',
    p && p.text === '讀經：13 週需要 13 人次；名單上 5 人，每人每季最多 1 次 ⇒ 最多排到 5 週，有 8 週會留空。可以：在讀經名單加人，或者把讀經的上限改高。', p && p.text);
  check('★★★★★ 逐週列出原因（每人每季上限）', p.blankWeeks.length === 8 && p.blankWeeks.every((w) => w.reasonCode === 'POST_MAX'),
    JSON.stringify(p.blankWeeks.slice(0, 2)));
  const off = ctxOf({ serviceDates: weeks(13), posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 1 })],
    byPost: { READ: P(5) }, people: P(5), rules: { HARD_POST_MAX_PER_PERSON: rule('HARD', { Enabled: false }) } });
  check('★★★★★ RuleSettings 把這條關掉 ⇒ 不計上限（0 格）', gas.computeStaffingCheck_(off).totalBlanks === 0);
  const none = ctxOf({ serviceDates: weeks(13), posts: [post('READ', '讀經')], byPost: { READ: P(5) }, people: P(5) });
  check('★★★★ 沒有設上限 ⇒ 足夠（現時的做法：五人輪流讀十三週）', gas.computeStaffingCheck_(none).totalBlanks === 0);
}

console.log('\n=== LD2：新硬規則 ===');
{
  const ctx = ctxOf({ serviceDates: weeks(13), posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 1 })],
    byPost: { READ: P(5) }, people: P(5) });
  ctx.priorWeeks = []; ctx.existingAssignments = {}; ctx.quotaByPerson = {}; ctx.selectionStrategy = 'LONGEST_UNSERVED';
  ctx.historicalWeight = 0; ctx.scoreWeights = { selectionWeight: 0, chairDualBonus: 0, preferenceBonus: 0 };
  ctx.randomSeed = 1; ctx.scoreTieEpsilon = 0; ctx.personPostWeights = { byKey: {}, rows: [] };
  const res = gas.buildRoster_(ctx);
  const filled = res.assignments.filter((a) => a.personId);
  const counts = {};
  filled.forEach((a) => { counts[a.personId] = (counts[a.personId] || 0) + 1; });
  check('★★★★★★ 生成：5 週有人、8 週留空；每人最多 1 次', filled.length === 5 && Object.values(counts).every((n) => n === 1), JSON.stringify(counts));
  const state = [{ serviceDate: ctx.serviceDates[0].serviceDate, postId: 'READ', slotIndex: 1, personId: 'P9001' },
    { serviceDate: ctx.serviceDates[1].serviceDate, postId: 'READ', slotIndex: 1, personId: 'P9001' }];
  const v = gas.findStateViolations_(state, ctx).filter((x) => x.ruleId === 'HARD_POST_MAX_PER_PERSON');
  check('★★★★★★ 檢查我的改動／儲存：第 2 次那一格違反（第 1 次不算）',
    v.length === 1 && v[0].serviceDate === ctx.serviceDates[1].serviceDate && /讀經每人每季最多 1 次/.test(v[0].reason), JSON.stringify(v));
  check('★★★★★ 硬規則（RULE_DEFAULT_LEVELS＝HARD、預設開啟）',
    gas.RULE_DEFAULT_LEVELS.HARD_POST_MAX_PER_PERSON === 'HARD' && gas.RULE_DEFAULT_ENABLED.HARD_POST_MAX_PER_PERSON === true);
  ctx.assignments = state.map((s) => Object.assign({ personName: 'x' }, s));
  const vr = gas.checkHardRuleViolations_(ctx);
  check('★★★★★ 核對職事表認得（超過每人每季崗位上限）', vr.groups.some((g) => /每人每季崗位上限/.test(g.label) && g.items.length === 1),
    vr && JSON.stringify(vr.groups.map((g) => [g.label, g.items.length])));
}

console.log('\n=== LD3：貪心法會失敗的例子 ===');
{
  const ws = weeks(2);
  const ctx = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 1 })],
    byPost: { READ: ['PA', 'PB'] }, people: ['PA', 'PB'],
    unavailable: [{ personId: 'PA', dateFrom: ws[1].serviceDate, dateTo: ws[1].serviceDate, appliesTo: 'ALL', postIds: [] }] });
  check('（準備）人手檢查：0 格（PA 第 1 週、PB 第 2 週）', gas.computeStaffingCheck_(ctx).totalBlanks === 0);
  const aug = gas.augmentAssignmentsWithStaffingFlow_(ctx, [
    { serviceDate: ws[0].serviceDate, postId: 'READ', slotIndex: 1, personId: 'PB', fixed: false },
    { serviceDate: ws[1].serviceDate, postId: 'READ', slotIndex: 1, personId: '', fixed: false }]);
  const after = {};
  aug.changes.forEach((c) => { after[c.serviceDate] = c.to; });
  check('★★★★★★ 貪心法第 1 週排了 PB ⇒ 修補：第 1 週改 PA、第 2 週 PB；留空 1 → 0',
    aug.blanksBefore === 1 && aug.blanksAfter === 0 && after[ws[0].serviceDate] === 'PA' && after[ws[1].serviceDate] === 'PB', JSON.stringify(aug));
  const fixedAug = gas.augmentAssignmentsWithStaffingFlow_(ctx, [
    { serviceDate: ws[0].serviceDate, postId: 'READ', slotIndex: 1, personId: 'PB', fixed: true },
    { serviceDate: ws[1].serviceDate, postId: 'READ', slotIndex: 1, personId: '', fixed: false }]);
  check('★★★★★ 人手填的格（fixed）不會改', fixedAug.changes.every((c) => c.serviceDate !== ws[0].serviceDate));
  // 生成（多個種子）：留空數＝最少留空數
  const big = ctxOf({ serviceDates: weeks(13), posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 2 }),
    post('CHAIR', '主席', { maxPerPersonPerQuarter: 3 })], byPost: { READ: P(6), CHAIR: P(6).slice(2) }, people: P(6),
    unavailable: P(6).slice(0, 3).map((id, i) => ({ personId: id, dateFrom: weeks(13)[i * 4].serviceDate,
      dateTo: weeks(13)[i * 4 + 3].serviceDate, appliesTo: 'ALL', postIds: [] })) });
  const minBlanks = gas.computeStaffingCheck_(big).totalBlanks;
  let allOk = true; const seen = [];
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((seed) => {
    const c = Object.assign({}, big, { priorWeeks: [], existingAssignments: {}, quotaByPerson: {}, selectionStrategy: 'LONGEST_UNSERVED',
      historicalWeight: 0, scoreWeights: { selectionWeight: 0, chairDualBonus: 0, preferenceBonus: 0 }, randomSeed: seed,
      scoreTieEpsilon: 0, personPostWeights: { byKey: {}, rows: [] } });
    const r = gas.buildRoster_(c);
    const blanks = r.assignments.filter((a) => !a.personId).length;
    seen.push(blanks + '(' + r.blankRepair.before + '→' + r.blankRepair.after + ')');
    if (blanks !== minBlanks) allOk = false;
    const viol = gas.findStateViolations_(r.assignments.filter((a) => a.personId), c).filter((v) => v.severity === 'HARD');
    if (viol.length > 0) allOk = false;
  });
  console.log('      各種子留空（修補前→後）：' + seen.join(' '));
  check('★★★★★★ 8 個種子：留空數都＝人手檢查的最少留空數（' + minBlanks + '），而且沒有硬規則違反', allOk, seen.join(' '));
}

console.log('\n=== LD4：同週不可兼任 ===');
{
  const ws = weeks(4);
  const ctx = ctxOf({ serviceDates: ws, posts: [post('CHAIR', '主席', { mutexGroup: 'CHAIR_COMMUNION' }),
    post('COMMUNION', '聖餐襄禮', { mutexGroup: 'CHAIR_COMMUNION' })], byPost: { CHAIR: ['PA'], COMMUNION: ['PA'] }, people: ['PA'] });
  const r = gas.computeStaffingCheck_(ctx);
  check('★★★★★★ 只有一人兼兩個互斥崗位 ⇒ 每週一格留空（4 格）', r.totalBlanks === 4, JSON.stringify(r.posts.map((p) => [p.postId, p.blanks])));
  check('★★★★★ 原因：同週不可兼任', r.posts.some((p) => p.blankWeeks.some((w) => w.reasonCode === 'MUTEX')), JSON.stringify(r.posts));
  const off = ctxOf({ serviceDates: ws, posts: ctx.posts, byPost: ctx.eligibility.byPost, people: ['PA'], rules: { HARD_MUTEX_GROUP: rule('HARD', { Enabled: false }) } });
  check('★★★★ 互斥規則關掉 ⇒ 0 格', gas.computeStaffingCheck_(off).totalBlanks === 0);
}

console.log('\n=== LD5：身分按日期、不能服侍、SOFT_MAX_PER_QUARTER 改成 HARD ===');
{
  const ws = weeks(4);
  const ctx = ctxOf({ serviceDates: ws, posts: [post('ANN', '報告', { requiredRoles: 'COMMITTEE' })], byPost: { ANN: ['PA'] }, people: ['PA'],
    roles: [{ personId: 'PA', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: ws[1].serviceDate }] });
  const r = gas.computeStaffingCheck_(ctx);
  check('★★★★★★ 身分按日期：卸任之後 2 週留空，原因「身分要求」',
    r.totalBlanks === 2 && r.posts[0].blankWeeks.every((w) => w.reasonCode === 'ROLE' && w.serviceDate > ws[1].serviceDate), JSON.stringify(r.posts));
  const u = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經')], byPost: { READ: ['PA', 'PB'] }, people: ['PA', 'PB'],
    unavailable: ['PA', 'PB'].map((id) => ({ personId: id, dateFrom: ws[2].serviceDate, dateTo: ws[2].serviceDate, appliesTo: 'ALL', postIds: [] })) });
  const ru = gas.computeStaffingCheck_(u);
  check('★★★★★★ 名單上每一位都不能服侍 ⇒ 那一週 1 格，原因「全部不能服侍」',
    ru.totalBlanks === 1 && ru.posts[0].blankWeeks[0].serviceDate === ws[2].serviceDate && ru.posts[0].blankWeeks[0].reasonCode === 'ALL_UNAVAILABLE', JSON.stringify(ru.posts));
  const q = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經')], byPost: { READ: ['PA'] }, people: ['PA'],
    rules: { SOFT_MAX_PER_QUARTER: rule('HARD', { TargetValue: 2 }) } });
  const rq = gas.computeStaffingCheck_(q);
  check('★★★★★★ SOFT_MAX_PER_QUARTER 設成 HARD（上限 2）⇒ 4 週只排到 2 週', rq.totalBlanks === 2
    && rq.posts[0].blankWeeks.every((w) => w.reasonCode === 'QUARTER_MAX'), JSON.stringify(rq.posts));
  const qs = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經')], byPost: { READ: ['PA'] }, people: ['PA'],
    rules: { SOFT_MAX_PER_QUARTER: rule('SOFT', { TargetValue: 2 }) } });
  check('★★★★★ 照舊是軟規則 ⇒ 不計（0 格）', gas.computeStaffingCheck_(qs).totalBlanks === 0);
  const noPool = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經')], byPost: {}, people: [] });
  check('★★★★ 名單上沒有人 ⇒ 4 格，原因「名單上沒有人」', gas.computeStaffingCheck_(noPool).posts[0].blankWeeks.every((w) => w.reasonCode === 'NO_POOL'));
}

console.log('\n=== LD6：規則審閱表、生成確認窗、主畫面 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['WebAppRuleReview.gs', 'RuleReview.gs'] });
  const g = sc.gas; const C = sc.C;
  // 讀經上限 1；名單照場景（6 人）⇒ 4 週足夠；改成只得 P9701 ⇒ 3 格
  const ps = sc.ss.getSheetByName(sc.S.POSTS);
  const pk = ps.getRange(2, 1, 1, ps.getLastColumn()).getValues()[0];
  ps.getRange(2, pk.length + 1).setValue(C.POSTS.MAX_PER_PERSON_PER_QUARTER);
  for (let r = 3; r <= ps.getLastRow(); r++) if (ps.getRange(r, pk.indexOf(C.POSTS.POST_ID) + 1).getValue() === 'READ') ps.getRange(r, pk.length + 1).setValue(1);
  const ctx = g.buildRuleReviewContext_();
  check('★★★★★ 規則審閱表 context：讀經每人每季最多 1 次', JSON.stringify(ctx.postMaxPosts) === JSON.stringify([{ postId: 'READ', postNameTC: '讀經', limit: 1 }]), JSON.stringify(ctx.postMaxPosts));
  const rows = g.buildRuleReviewSheetRows_([], 13, ctx);
  const line = rows.rows.find((r) => /每人每季最多做幾次/.test(r[1]));
  check('★★★★★ 「一定要遵守」有這一條，現時設定逐個崗位列出', line && line[3] === '讀經：每人每季最多 1 次', line && JSON.stringify(line));
  const plan = g.apiGenerateDraftPlan(sc.Q);
  check('★★★★ 名單足夠 ⇒ 生成確認窗沒有人手不足', plan.staffing && plan.staffing.totalBlanks === 0, JSON.stringify(plan.staffing));
  const E = C.ELIGIBILITY;
  const es = sc.ss.getSheetByName(sc.S.ELIGIBILITY);
  const ek = es.getRange(2, 1, 1, es.getLastColumn()).getValues()[0];
  for (let r = 3; r <= es.getLastRow(); r++) {
    if (es.getRange(r, ek.indexOf(E.POST_ID) + 1).getValue() === 'READ' && es.getRange(r, ek.indexOf(E.PERSON_ID) + 1).getValue() !== 'P9701') {
      es.getRange(r, ek.indexOf(E.ACTIVE) + 1).setValue(false);
    }
  }
  const plan2 = g.apiGenerateDraftPlan(sc.Q);
  check('★★★★★★ 生成確認窗：讀經人手不足 3 格', plan2.staffing.totalBlanks === 3 && /^讀經：4 週需要 4 人次/.test(plan2.staffing.posts[0].text), JSON.stringify(plan2.staffing));
  // 主畫面摘要＋快取
  const store = {};
  g.CacheService = { getScriptCache: () => ({ get: (k) => store[k] || null, put: (k, v) => { store[k] = v; }, remove: (k) => { delete store[k]; } }) };
  const first = g.readStaffingCheck_(sc.Q);
  const second = g.readStaffingCheck_(sc.Q);
  check('★★★★★ 第二次讀同一份資料 ⇒ 用快取（簽名一樣）', first.cached === false && second.cached === true && second.totalBlanks === 3);
  const sum = g.summariseStaffingForDashboard_(second);
  check('★★★★ 主畫面摘要：1 個崗位、3 格', sum.shortPostCount === 1 && sum.totalBlanks === 3);
  for (let r = 3; r <= es.getLastRow(); r++) es.getRange(r, ek.indexOf(E.ACTIVE) + 1).setValue(true);
  const third = g.readStaffingCheck_(sc.Q);
  check('★★★★★ 名單改了 ⇒ 簽名變、重新計算（0 格）', third.cached === false && third.totalBlanks === 0);
  const note = g.describeStaffingChange_({ totalBlanks: 0 }, first);
  check('★★★★★ 改動之後的一句：人手不足（比之前多了）', /^⚠ 人手檢查：讀經 人手不足，最少會有 3 格留空（比之前多了 3 格）/.test(note), note);
  check('★★★★ 足夠 ⇒ 不寫', g.describeStaffingChange_(first, third) === '');
}

console.log('\n=== LD7：〔請系統幫我調整〕用網絡補 ===');
{
  const ws = weeks(2);
  const ctx = ctxOf({ serviceDates: ws, posts: [post('READ', '讀經', { maxPerPersonPerQuarter: 1 })],
    byPost: { READ: ['PA', 'PB'] }, people: ['PA', 'PB'],
    unavailable: [{ personId: 'PA', dateFrom: ws[1].serviceDate, dateTo: ws[1].serviceDate, appliesTo: 'ALL', postIds: [] }] });
  const state = [{ serviceDate: ws[0].serviceDate, postId: 'READ', slotIndex: 1, personId: 'PB' },
    { serviceDate: ws[1].serviceDate, postId: 'READ', slotIndex: 1, personId: '' }];
  const r = gas.augmentGapFillsWithStaffingFlow_(ctx, state);
  check('★★★★★★ 調開 PB（第 1 週改 PA）、第 2 週填 PB', r.after === 0 && state[0].personId === 'PA' && state[1].personId === 'PB', JSON.stringify(r));
  const state2 = [{ serviceDate: ws[0].serviceDate, postId: 'READ', slotIndex: 1, personId: 'PB', isManual: true },
    { serviceDate: ws[1].serviceDate, postId: 'READ', slotIndex: 1, personId: '' }];
  const r2 = gas.augmentGapFillsWithStaffingFlow_(ctx, state2);
  check('★★★★★ 人手改的格不調開', r2.changes.length === 0 && state2[0].personId === 'PB');
}

console.log('\n=== LD9：畫面 ===');
{
  const vm = require('vm');
  const { loadUiScripts } = require('./helpers/ui_loader.js');
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T3';", ui);
  const base = { preQuarter: { undoneItemCount: 0, items: [] } };
  ui.renderZone2Body(Object.assign({}, base, { staffing: { totalBlanks: 1, shortPostCount: 1, posts: [{ postNameTC: 'PPT 控制', blanks: 1 }] } }));
  let body = ui.document.getElementById('zone2Body');
  const btns = body.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  check('★★★★★★ 人手不足 ⇒「人手不足：1 個崗位」＋〔人手檢查〕', /人手不足：1 個崗位（最少 1 格會留空）——PPT 控制/.test(body.textContent)
    && btns.indexOf('人手檢查') !== -1, body.textContent.slice(0, 300));
  ui.renderZone2Body(Object.assign({}, base, { staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] } }));
  body = ui.document.getElementById('zone2Body');
  check('★★★★★ 足夠 ⇒「這一季還要做的」寫「人手檢查：足夠」、沒有〔人手檢查〕',
    /人手檢查：足夠/.test(body.textContent) && body.flatten().every((n) => n.textContent !== '人手檢查'), body.textContent.slice(0, 300));
  ui.renderZone2Body(Object.assign({}, base, { staffing: { error: '讀不到', totalBlanks: 0, shortPostCount: 0, posts: [] } }));
  check('★★★★★ 讀不到 ⇒ 照實講，不寫「足夠」', /人手檢查：暫時查不到/.test(ui.document.getElementById('zone2Body').textContent));
  const nodes = ui.staffingCheckNodes({ totalBlanks: 1, totalNeeded: 13, notes: [], posts: [{ text: 'PPT 控制：…', blankWeeks: [
    { serviceDate: '2028-07-16', blanks: 1, reasonText: '名單上的人全部不能服侍' }] }] });
  const text = nodes.map((n) => n.textContent).join('\n');
  check('★★★★★ 〔人手檢查〕逐週列出（7 月 16 日：1 格（名單上的人全部不能服侍））', /7 月 16 日：1 格（名單上的人全部不能服侍）/.test(text), text);
}

console.log('\n=== LD8：速度 ===');
{
  const ppl = P(90);
  const posts = Array.from({ length: 16 }, (_, i) => post('X' + i, '崗位' + i, { maxPerPersonPerQuarter: i % 3 === 0 ? 1 : null,
    mutexGroup: i < 2 ? 'G' : '', slotCount: i % 4 === 0 ? 2 : 1, distinctWithinPost: true }));
  const byPost = {};
  posts.forEach((p, i) => { byPost[p.postId] = ppl.filter((_, k) => (k + i) % 4 === 0); });
  const ctx = ctxOf({ serviceDates: weeks(13), posts: posts, byPost: byPost, people: ppl });
  const t0 = Date.now();
  const r = gas.computeStaffingCheck_(ctx);
  const ms = Date.now() - t0;
  console.log('      人手檢查（90 人 × 16 崗位 × 13 週）：' + ms + ' ms，最少留空 ' + r.totalBlanks + ' 格');
  check('★★★★ 計算本身少於 2 秒', ms < 2000, ms);
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
