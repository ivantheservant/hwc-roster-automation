// 第八十五輪批次 LC 組：事奉人員表（崗位名單）可以寫「堂委」「執事」。
// 執行方式：node tests/round85_lc_role_eligibility.test.js
//
//   LC1　讀取：Eligibility 的 `ROLE:COMMITTEE` 行 ⇒ rolesByPost；不放入 byPost（真人清單）
//   LC2　展開：生成時每一個主日當日的現任堂委都可以排；名單上沒有、也不是堂委的人不會排
//   LC3　按日期／換屆：只經「堂委」取得資格的人，卸任之後的主日不會被排；放上去 ⇒ HARD_ELIGIBILITY「已不是堂委」
//   LC4　與名字並存：名字本身在名單上的人不受身分限制、不重複計算
//   LC5　歷史次數保留：名字被「堂委」取代（那一行 Active=FALSE）⇒ HistoricalCount 照用，不會變 0
//   LC6　個人設定照樣適用：不能服侍的日期、NameMapping.Active=FALSE、暫時不做某崗位
//   LC7　畫面：崗位名單工作表列出「堂委」、輸入「堂委」「執事」不當成認不出；崗位資格畫面有身分行；
//        排表偏好畫面列出現任堂委（可以為其中一位設偏好）；規則審閱表列出；資料驗證不當孤兒
// 下面用假資料（P97xx、假甲…），不涉及真實姓名。

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

/**
 * 場景：讀經（READ）名單＝「堂委」＋ P9704（名字）；P9701 原本有一行讀經（HistoricalCount 7）已停用。
 * Roles：P9701、P9702、P9705 是堂委；P9702 只做到第 2 個主日；P9703 是執事（不在讀經名單）。
 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({ extraFiles: ['WebAppEligibility.gs', 'EligibilitySheetEditor.gs', 'WebAppWeightEdit.gs',
    'WebAppRuleReview.gs', 'RuleReview.gs', 'Validate.gs'].concat(opts.extraFiles || []) });
  const gas = sc.gas; const C = sc.C; const S = sc.S; const D = sc.DATES;
  const E = C.ELIGIBILITY;
  sc.ss.deleteSheet(sc.ss.getSheetByName(S.ELIGIBILITY));
  const rows = [];
  ['P9701', 'P9702', 'P9703', 'P9704', 'P9705', 'P9707'].forEach((id) => rows.push(['CHAIR', id, true, 0]));
  ['P9701', 'P9702', 'P9703'].forEach((id) => rows.push(['WORSHIP', id, true, 0]));
  rows.push(['READ', 'P9701', false, 7]);          // 名字被「堂委」取代 ⇒ 停用，歷史 7 次
  rows.push(['READ', 'P9704', true, 2]);           // 名字本身在名單上
  rows.push(['READ', 'ROLE:COMMITTEE', true, 0]);  // 「堂委」
  if (opts.alsoExplicitP9702) rows.push(['READ', 'P9702', true, 1]);
  seedSheet(sc.ss, S.ELIGIBILITY, ['E'], [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.HISTORICAL_COUNT, E.ACTIVE],
    rows.map((r, i) => ({ [E.ELIGIBILITY_ID]: 'E' + i, [E.POST_ID]: r[0], [E.PERSON_ID]: r[1], [E.ELIGIBLE]: true,
      [E.HISTORICAL_COUNT]: r[3], [E.ACTIVE]: r[2] })));
  const R = C.ROLES;
  const rk = Object.keys(R).map((k) => R[k]);
  const role = (pid, code, from, to) => ({ [R.PERSON_ID]: pid, [R.ROLE_CODE]: code, [R.EFFECTIVE_FROM]: from,
    [R.EFFECTIVE_TO]: to, [R.ACTIVE]: true });
  seedSheet(sc.ss, S.ROLES, ['R'], rk, [
    role('P9701', 'COMMITTEE', '2098-01-01', ''),
    role('P9702', 'COMMITTEE', '2098-01-01', D[1]),
    role('P9705', 'COMMITTEE', '2098-01-01', ''),
    role('P9703', 'DEACON', '2098-01-01', '')
  ].concat(opts.extraRoles || []));
  if (!sc.ss.getSheetByName(S.PERSON_POST_EXCLUSIONS)) {
    const X = C.PERSON_POST_EXCLUSIONS;
    seedSheet(sc.ss, S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), opts.exclusions || []);
  }
  if (opts.unavailable) {
    // 場景的 RuleSettings 沒有 HARD_UNAVAILABLE（沒有那一行＝關掉），這裏補上
    const RS = C.RULE_SETTINGS;
    sc.appendRows(sc.ss, S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
      [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
    const U = C.UNAVAILABLE;
    sc.appendRows(sc.ss, S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), opts.unavailable);
  }
  const inactive = (opts.inactivePeople || []).concat(opts.inactivePerson ? [opts.inactivePerson] : []);
  if (inactive.length > 0) {
    const nm = sc.ss.getSheetByName(S.NAME_MAPPING);
    const keys = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0];
    for (let r = 3; r <= nm.getLastRow(); r++) {
      if (inactive.indexOf(nm.getRange(r, keys.indexOf(C.NAME_MAPPING.PERSON_ID) + 1).getValue()) !== -1) {
        nm.getRange(r, keys.indexOf(C.NAME_MAPPING.ACTIVE) + 1).setValue(false);
      }
    }
  }
  return sc;
}
const readOn = (sc, versionNo) => sc.rows(versionNo).filter((r) => r[sc.A.POST_ID] === 'READ')
  .map((r) => ({ d: sc.gas.toDateString(r[sc.A.SERVICE_DATE], sc.TZ), p: String(r[sc.A.PERSON_ID] || '') }));

console.log('\n=== LC1：讀取 ===');
{
  const sc = scene();
  const e = sc.gas.readEligibility();
  check('★★★★★ rolesByPost.READ＝[COMMITTEE]', JSON.stringify(e.rolesByPost.READ) === '["COMMITTEE"]', JSON.stringify(e.rolesByPost));
  check('★★★★★ byPost.READ 只有真人（P9704），沒有代號', JSON.stringify(e.byPost.READ) === '["P9704"]', JSON.stringify(e.byPost.READ));
  check('★★★★ 停用那一行的歷史次數在 historicalCountAll', e.historicalCountAll.READ.P9701 === 7);
  check('★★★★ 停用的行不在 historicalCount（未展開前）', !(e.historicalCount.READ || {}).P9701);
}

console.log('\n=== LC2／LC3：展開、按日期、換屆 ===');
{
  const sc = scene();
  const gas = sc.gas; const D = sc.DATES;
  const ctx = gas.buildGeneratorContext_(sc.Q);
  const pool = ctx.eligibility.byPost.READ.slice().sort();
  check('★★★★★★ 候選池＝P9704（名字）＋現任／曾任堂委 P9701、P9702、P9705；執事 P9703 不在',
    JSON.stringify(pool) === JSON.stringify(['P9701', 'P9702', 'P9704', 'P9705']), JSON.stringify(pool));
  check('★★★★★ 只經堂委：P9701、P9702、P9705（P9704 不是）',
    Object.keys(ctx.eligibility.roleOnlyByPost.READ).sort().join(',') === 'P9701,P9702,P9705');
  gas.apiGenerateDraftExecute(sc.Q);
  const reads = readOn(sc, 0);
  check('★★★★★★ 生成：讀經只排名單上的人（P9701／P9702／P9704／P9705）',
    reads.length === 4 && reads.every((x) => ['P9701', 'P9702', 'P9704', 'P9705'].indexOf(x.p) !== -1), JSON.stringify(reads));
  check('★★★★★★ 換屆：P9702 卸任（' + D[1] + '）之後的主日不會被排',
    reads.every((x) => x.p !== 'P9702' || x.d <= D[1]), JSON.stringify(reads));
  const fctx = gas.buildFineTuneContext_(sc.Q, 0);
  const viol = gas.findStateViolations_([{ serviceDate: D[3], postId: 'READ', slotIndex: 1, personId: 'P9702' }], fctx);
  const elig = viol.filter((v) => v.ruleId === 'HARD_ELIGIBILITY');
  check('★★★★★★ 卸任之後放上去 ⇒ HARD_ELIGIBILITY，訊息寫明「已不是堂委」',
    elig.length === 1 && /已不是堂委/.test(elig[0].reason), JSON.stringify(viol));
  const ok = gas.findStateViolations_([{ serviceDate: D[0], postId: 'READ', slotIndex: 1, personId: 'P9702' }], fctx);
  check('★★★★★ 卸任之前同一人沒有違規', ok.filter((v) => v.ruleId === 'HARD_ELIGIBILITY').length === 0, JSON.stringify(ok));
  const no = gas.findStateViolations_([{ serviceDate: D[0], postId: 'READ', slotIndex: 1, personId: 'P9703' }], fctx);
  check('★★★★ 執事 P9703 不在讀經名單 ⇒ 不在這個崗位的名單上', no.some((v) => v.ruleId === 'HARD_ELIGIBILITY' && /不在這個崗位的名單上/.test(v.reason)));
  const vctx = gas.buildVerifyContext_(sc.Q, 0);
  vctx.assignments = [{ serviceDate: D[3], postId: 'READ', slotIndex: 1, personId: 'P9702', personName: '假乙' }];
  const vr = gas.checkHardRuleViolations_(vctx);
  const vtext = JSON.stringify(vr);
  check('★★★★★ 核對職事表同樣認得「已不是堂委」', /已不是堂委/.test(vtext), vtext.slice(0, 300));
}

console.log('\n=== LC3b：只剩一位（已卸任）堂委 ⇒ 卸任之後留空，不會排他 ===');
{
  const sc = scene({ inactivePeople: ['P9701', 'P9705', 'P9704'] });
  const D = sc.DATES;
  sc.gas.apiGenerateDraftExecute(sc.Q);
  const reads = readOn(sc, 0);
  check('★★★★★★ 卸任之前排 P9702；卸任之後留空',
    reads.every((x) => (x.d <= D[1] ? x.p === 'P9702' : x.p === '')), JSON.stringify(reads));
}

console.log('\n=== LC4：與名字並存 ===');
{
  const sc = scene({ alsoExplicitP9702: true });
  const gas = sc.gas; const D = sc.DATES;
  gas.apiGenerateDraftExecute(sc.Q);
  const fctx = gas.buildFineTuneContext_(sc.Q, 0);
  check('★★★★★ 名字本身在名單上 ⇒ 不算「只經堂委」', !fctx.eligibility.roleOnlyByPost.READ.P9702);
  const pool = fctx.eligibility.byPost.READ;
  check('★★★★★ 候選池不重複', pool.filter((x) => x === 'P9702').length === 1, JSON.stringify(pool));
  const v = gas.findStateViolations_([{ serviceDate: D[3], postId: 'READ', slotIndex: 1, personId: 'P9702' }], fctx);
  check('★★★★★★ 卸任之後仍然可以排（以名字為準）', v.filter((x) => x.ruleId === 'HARD_ELIGIBILITY').length === 0, JSON.stringify(v));
}

console.log('\n=== LC5：歷史次數保留 ===');
{
  const sc = scene();
  const ctx = sc.gas.buildGeneratorContext_(sc.Q);
  check('★★★★★★ P9701 的讀經歷史次數沿用 7（不是 0）', ctx.eligibility.historicalCount.READ.P9701 === 7,
    JSON.stringify(ctx.eligibility.historicalCount.READ));
  check('★★★★★ P9704（名字那一行）照舊 2', ctx.eligibility.historicalCount.READ.P9704 === 2);
  check('★★★★ 新任（沒有舊行）P9705＝0', !ctx.eligibility.historicalCount.READ.P9705);
  check('★★★★★ 配額用到沿用的歷史次數（P9701 有配額）', (ctx.quotaByPerson.P9701 || 0) > 0, JSON.stringify(ctx.quotaByPerson));
}

console.log('\n=== LC6：個人設定照樣適用 ===');
{
  const U = (sc) => sc.C.UNAVAILABLE;
  let sc = scene();
  const D = sc.DATES;
  const u = U(sc);
  sc = scene({ unavailable: D.map((d, i) => ({ [u.UNAVAILABLE_ID]: 'UX' + i, [u.PERSON_ID]: 'P9701', [u.DATE_FROM]: d, [u.DATE_TO]: d,
    [u.APPLIES_TO]: 'ALL', [u.SOURCE]: 'MANUAL', [u.STATUS]: 'ACTIVE' })), inactivePerson: 'P9705' });
  const X = sc.C.PERSON_POST_EXCLUSIONS;
  const ex = sc.ss.getSheetByName(sc.S.PERSON_POST_EXCLUSIONS);
  const xkeys = ex.getRange(2, 1, 1, ex.getLastColumn()).getValues()[0];
  const line = xkeys.map((k) => ({ [X.PERSON_ID]: 'P9702', [X.POST_ID]: 'READ', [X.REASON]: 'test', [X.ACTIVE]: true })[k] || '');
  ex.getRange(3, 1, 1, xkeys.length).setValues([line]);
  sc.gas.apiGenerateDraftExecute(sc.Q);
  const reads = readOn(sc, 0);
  check('★★★★★★ 不能服侍（P9701 全季）、NameMapping 停用（P9705）、暫時不做讀經（P9702）⇒ 都不會排',
    reads.every((x) => ['P9701', 'P9702', 'P9705'].indexOf(x.p) === -1), JSON.stringify(reads));
}

console.log('\n=== LC7：畫面 ===');
{
  const sc = scene();
  const gas = sc.gas; const S = sc.S;
  gas.Utilities.formatDate = function () { return sc.DATES[0]; };
  // 崗位名單工作表
  gas.buildGridSheetUrl_ = function () { return 'https://example.invalid/x'; };
  gas.GRID_COLORS = gas.GRID_COLORS || { HEADER: '#eee' };
  const built = gas.buildEligibilitySheet_();
  const sh = sc.ss.getSheetByName('崗位名單');
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = keys.indexOf('READ') + 1;
  const colVals = [];
  for (let r = 3; r <= sh.getLastRow(); r++) colVals.push(String(sh.getRange(r, col).getValue()));
  check('★★★★★ 崗位名單工作表讀經欄有「堂委」和「假丁」', built && colVals.indexOf('堂委') !== -1 && colVals.indexOf('假丁') !== -1, JSON.stringify(colVals));
  // 在讀經欄加「執事」、主席欄加「堂委」
  sh.getRange(3 + colVals.filter((v) => v).length, col).setValue('執事');
  const plan = gas.planEligibilitySheetApply_(sc.Q);
  check('★★★★★★ 「堂委」「執事」不當成認不出的名字', plan.unresolved.length === 0, JSON.stringify(plan.unresolved));
  const add = plan.added.filter((a) => a.personId === 'ROLE:DEACON')[0];
  check('★★★★★ 預覽：新增「執事（現任 1 位：假丙）」', add && /^執事（現任 1 位：假丙）$/.test(add.nameTC), JSON.stringify(plan.added));
  check('★★★★ 「堂委」本來就在名單 ⇒ 沒有被當成新增或移除',
    !plan.added.concat(plan.removed).some((x) => x.personId === 'ROLE:COMMITTEE'), JSON.stringify(plan));
  gas.apiApplyEligibilitySheet_locked_(sc.Q);
  check('★★★★★ 套用之後 Eligibility 有 ROLE:DEACON 那一行', JSON.stringify(gas.readEligibility().rolesByPost.READ.sort()) === '["COMMITTEE","DEACON"]');
  // 崗位資格逐格畫面
  const m = gas.apiGetEligibilityMatrix();
  const roleRow = m.people.filter((p) => p.personId === 'ROLE:COMMITTEE')[0];
  check('★★★★★ 崗位資格畫面有「堂委（現任 N 位：…）」那一行', roleRow && roleRow.isRole && /^堂委（現任 3 位：假甲、假乙、假戊）$/.test(roleRow.nameTC), JSON.stringify(roleRow));
  check('★★★★ 讀經的合資格人數按今日展開（假甲、假乙、假戊、假丁、假丙＝5）',
    m.posts.filter((p) => p.postId === 'READ')[0].eligibleCount === 5, JSON.stringify(m.posts));
  // 排表偏好畫面
  gas.resolveWeightQuarterScope_ = function () { return { quarterId: sc.Q, startDate: sc.DATES[0], label: '2099年1月' }; };
  const w = gas.apiGetPersonPostWeightMatrix(sc.Q);
  const readPost = w.posts.filter((p) => p.postId === 'READ')[0];
  const ids = readPost.people.map((p) => p.personId).sort();
  check('★★★★★★ 排表偏好畫面讀經列出現任堂委（可以為其中一位設偏好），沒有代號',
    ids.indexOf('P9701') !== -1 && ids.indexOf('P9705') !== -1 && ids.every((x) => x.indexOf('ROLE:') !== 0), JSON.stringify(ids));
  // 規則審閱表
  const ctx = gas.buildRuleReviewContext_();
  check('★★★★★ 規則審閱表 context 列出讀經：堂委（現任…）',
    (ctx.eligibilityRolePosts || []).some((p) => p.postNameTC === '讀經' && /堂委（現任 3 位/.test(p.text)), JSON.stringify(ctx.eligibilityRolePosts));
  // 資料驗證
  const issues = gas.validateEligibilityOrphans_();
  check('★★★★★ 資料驗證：身分代號不算孤兒', !issues.some((i) => /ROLE:/.test(i)), JSON.stringify(issues));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
