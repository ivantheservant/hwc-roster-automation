// 第九十輪批次 QB 組：詩班名單、〔詩班獻詩〕、規則 SEMI_CHOIR_SUNDAY。
// 執行方式：node tests/round90_qb_choir.test.js
//
// 音樂部意見（Ivan 2026-10-30 決定）：詩班獻詩的主日，詩班員盡量不另派崗位；詩班名單用事奉人員表維護。
//
//   QB1 Posts：ShowInRoster=FALSE 的行（詩班）不是職事表崗位——readPosts_ 每個讀取點都不見；
//       只有「崗位名單」工作表見到；選單工具補建欄位、建立詩班名單（已有就不加）；自我檢查照樣通過
//   QB2 〔詩班獻詩〕：讀取、儲存（自動加欄、AuditLog、重新開啟仍在、沒有改動＝0）
//   QB3 規則：詩班獻詩的主日，詩班名單上的人擔任任何崗位 ⇒ SEMI_HARD 提醒；其他主日不提醒；可關；
//       「堂委」「執事」按當日身分展開；人手填的格照樣提醒（系統不改）；人手檢查不計
//   QB4 生成：避開詩班員；找不到其他人才排並提醒
//   QB5 整季重設：幹事介面保留（會保留段寫「詩班獻詩 N 週」）；選單版清空
//   QB6 季前資料第五段「合堂主日及詩班獻詩」＋「詩班名單（N 人）」
//   QB7 畫面、深連結、唯讀清單、規則審閱表、草稿覆核報告、Config、週報說明
// 下面用假 ID（P97xx）、假名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 場景：round75 場景＋經真正的選單工具加 ShowInRoster 欄和 CHOIR 一行＋詩班名單。
 * @param {{choir: string[], roles: Object[], withChoir: boolean, extraFiles: string[]}} opts
 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({ extraFiles: ['PostSeedChoir.gs', 'WebAppChoir.gs', 'WebAppCombined.gs', 'CellDecisions.gs',
    'QuarterReset.gs', 'Menu.gs', 'WebAppQuarterReset.gs', 'EligibilitySheetEditor.gs', 'SelfTest.gs',
    'StaffingCheck.gs'].concat(opts.extraFiles || []) });
  const g = sc.gas; const C = sc.C; const S = sc.S;
  sc.alerts = [];
  g.SpreadsheetApp.getUi = function () {
    return {
      ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES', NO: 'NO' },
      alert: function (title, msg) { sc.alerts.push(title + '｜' + msg); return 'YES'; }
    };
  };
  g.listRosterPdfFilesForQuarter_ = function () { return []; };
  g.listEditableCopyFilesForQuarter_ = function () { return []; };
  g.listEmptyVersionFoldersForReset_ = function () { return []; };
  const R = C.ROLES;
  seedSheet(sc.ss, S.ROLES, ['R'], Object.keys(R).map((k) => R[k]), opts.roles || []);
  if (opts.withChoir !== false) {
    g.runSeedPostShowInRoster_();
    g.runCreateChoirGroup_();
    const E = C.ELIGIBILITY;
    sc.appendRows(sc.ss, S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
      (opts.choir || ['P9704', 'P9705']).map((id, i) => ({ [E.ELIGIBILITY_ID]: 'EC' + i, [E.PERSON_ID]: id,
        [E.POST_ID]: 'CHOIR', [E.ELIGIBLE]: true, [E.ACTIVE]: true })));
  }
  return sc;
}
const choirViolations = (vs) => vs.filter((v) => v.ruleId === 'SEMI_CHOIR_SUNDAY');

// =====================================================================
console.log('\n=== QB1：Posts 讀取點 ===');
{
  const sc = scene();
  const g = sc.gas; const S = sc.S; const C = sc.C;
  const postsSheet = sc.ss.getSheetByName(S.POSTS);
  const keys = postsSheet.getRange(2, 1, 1, postsSheet.getLastColumn()).getValues()[0];
  check('★★★★★ 選單「補建 Posts 欄位」加了 ShowInRoster 欄', keys.indexOf('ShowInRoster') !== -1, JSON.stringify(keys));
  const raw = g.readSheet_(S.POSTS);
  const choirRow = raw.filter((r) => r[C.POSTS.POST_ID] === 'CHOIR')[0];
  check('★★★★★★ 選單「建立詩班名單」：CHOIR／詩班、AutoGenerate=FALSE、ShowInRoster=FALSE、Active=TRUE',
    choirRow && choirRow[C.POSTS.POST_NAME_TC] === '詩班' && choirRow[C.POSTS.AUTO_GENERATE] === false
    && choirRow[C.POSTS.SHOW_IN_ROSTER] === false && choirRow[C.POSTS.ACTIVE] === true, JSON.stringify(choirRow));
  check('★★★★ AuditLog：CHOIR_GROUP_CREATED',
    g.readSheet_(S.AUDIT_LOG).some((r) => r[C.AUDIT_LOG.ACTION] === 'CHOIR_GROUP_CREATED'));
  sc.alerts.length = 0;
  g.runCreateChoirGroup_();
  check('★★★★★ 再按一次 ⇒ 已有就不加（只得一行）',
    g.readSheet_(S.POSTS).filter((r) => r[C.POSTS.POST_ID] === 'CHOIR').length === 1 && /已經有 CHOIR/.test(sc.alerts.join()), sc.alerts.join());
  check('★★★★★ 純函式：已有 ⇒ null', g.buildChoirGroupPostRow_(keys, raw, 'CHOIR') === null);
  check('★★★★ Config 改 PostID ⇒ 用新的', (g.buildChoirGroupPostRow_(keys, raw, 'CHOIR2') || [])[keys.indexOf('PostID')] === 'CHOIR2');

  check('★★★★★★ readPosts_()：沒有詩班（職事表欄、PDF、個人頁、服侍次數、生成都經這裏）',
    g.readPosts_().every((r) => r[C.POSTS.POST_ID] !== 'CHOIR') && g.readPosts_().length === 5);
  check('★★★★★ readPostsNormalized_()：沒有詩班；{includeGroups:true} 才有，而且 showInRoster=false',
    g.readPostsNormalized_().every((p) => p.postId !== 'CHOIR')
    && g.readPostsNormalized_({ includeGroups: true }).some((p) => p.postId === 'CHOIR' && p.showInRoster === false));
  check('★★★★ isPostShownInRoster_：空白／TRUE ⇒ 是；FALSE（布林或文字）⇒ 不是',
    g.isPostShownInRoster_({ ShowInRoster: '' }) && g.isPostShownInRoster_({}) && g.isPostShownInRoster_({ ShowInRoster: true })
    && !g.isPostShownInRoster_({ ShowInRoster: false }) && !g.isPostShownInRoster_({ ShowInRoster: 'false' }));

  // 生成：職事表沒有詩班的欄、沒有詩班的格
  g.apiGenerateDraftExecute(sc.Q);
  check('★★★★★★ 生成：RosterAssignments 沒有 CHOIR', sc.rows(0).length > 0 && sc.rows(0).every((r) => r[sc.A.POST_ID] !== 'CHOIR'));
  const grid = sc.gridSheet(0);
  const gkeys = grid.getRange(2, 1, 1, grid.getLastColumn()).getValues()[0].map(String);
  check('★★★★★★ 職事表工作表沒有詩班一欄', gkeys.every((k) => k.indexOf('CHOIR') === -1)
    && grid.getRange(1, 1, 1, grid.getLastColumn()).getValues()[0].every((t) => String(t) !== '詩班'), JSON.stringify(gkeys));
  const staffing = g.computeStaffingCheck_(g.buildStaffingContext_(sc.Q));
  check('★★★★★ 人手檢查沒有詩班', (staffing.posts || []).every((p) => p.postId !== 'CHOIR')
    && JSON.stringify(staffing).indexOf('詩班') === -1, JSON.stringify(staffing).slice(0, 400));

  // 只有「崗位名單」工作表見到詩班
  g.Utilities.formatDate = function () { return sc.DATES[0]; };
  g.buildGridSheetUrl_ = function () { return 'https://example.invalid/x'; };
  g.GRID_COLORS = g.GRID_COLORS || { HEADER: '#eee' };
  g.buildEligibilitySheet_();
  const es = sc.ss.getSheetByName('崗位名單');
  const ekeys = es.getRange(2, 1, 1, es.getLastColumn()).getValues()[0];
  const ecol = ekeys.indexOf('CHOIR') + 1;
  const evals = [];
  for (let r = 3; r <= es.getLastRow(); r++) evals.push(String(es.getRange(r, ecol).getValue()));
  check('★★★★★★ 「崗位名單」工作表有「詩班」一欄，名單是假四、假五',
    ecol > 0 && String(es.getRange(1, ecol).getValue()) === '詩班' && evals.filter((v) => v).sort().join() === [sc.PEOPLE.P9704, sc.PEOPLE.P9705].sort().join(),
    JSON.stringify(evals));
  const plan = g.planEligibilitySheetApply_(sc.Q);
  check('★★★★★ 原封不動 ⇒ 儲存預覽沒有增減（詩班一欄照樣認得）',
    plan.added.length === 0 && plan.removed.length === 0 && plan.unresolved.length === 0, JSON.stringify(plan).slice(0, 400));
  const selfTest = g.testPostsReading_();
  check('★★★★★ 自我檢查「Posts 讀取」照樣通過（名單組別不算漏讀）', selfTest.pass === true, JSON.stringify(selfTest));
}

// =====================================================================
console.log('\n=== QB2：〔詩班獻詩〕儲存 ===');
{
  const sc = scene();
  const g = sc.gas; const D = sc.DATES; const S = sc.S; const C = sc.C;
  const open1 = g.apiGetChoirSinging(sc.Q);
  check('★★★★★ 每個主日一行，預設不是', open1.weeks.length === 4 && open1.weeks.every((w) => w.singing === false), JSON.stringify(open1.weeks));
  check('★★★★ 說明句、詩班人數', /盡量不擔任其他崗位/.test(open1.note) && open1.choirCount === 2, JSON.stringify(open1));
  const sd = sc.ss.getSheetByName(S.SERVICE_DATES);
  const none = g.apiSaveChoirSinging(sc.Q, open1.weeks.map((w) => ({ serviceDate: w.serviceDate, singing: false })));
  check('★★★★ 一週都沒有勾 ⇒ 不加欄、沒有改動',
    none.changed === 0 && sd.getRange(2, 1, 1, sd.getLastColumn()).getValues()[0].indexOf('ChoirSinging') === -1);
  const res = g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[2], singing: true }]);
  check('★★★★★★ 勾第 3 週 ⇒ 儲存 1 週，ServiceDates 自動加 ChoirSinging 欄',
    res.ok && res.changed === 1 && sd.getRange(2, 1, 1, sd.getLastColumn()).getValues()[0].indexOf('ChoirSinging') !== -1, JSON.stringify(res));
  const open2 = g.apiGetChoirSinging(sc.Q);
  check('★★★★★★ 重新開啟：第 3 週仍然勾選，其餘不是',
    open2.weeks.map((w) => w.singing).join() === 'false,false,true,false', JSON.stringify(open2.weeks));
  const audit = g.readSheet_(S.AUDIT_LOG).filter((r) => r[C.AUDIT_LOG.ACTION] === 'CHOIR_SINGING_CHANGED');
  check('★★★★★ AuditLog 一筆（CHOIR_SINGING_CHANGED）', audit.length === 1 && audit[0][C.AUDIT_LOG.TARGET_KEY] === sc.Q + '|' + D[2],
    JSON.stringify(audit));
  check('★★★★ 同樣再存 ⇒ 0 週', g.apiSaveChoirSinging(sc.Q, open2.weeks).changed === 0);
  check('★★★★★ normalized 主日帶 choirSinging', g.readServiceDatesNormalized_(sc.Q, sc.TZ).map((d) => !!d.choirSinging).join() === 'false,false,true,false');
  g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[2], singing: false }]);
  check('★★★★ 取消勾選 ⇒ 清空', g.apiGetChoirSinging(sc.Q).weeks.every((w) => !w.singing));
}

// =====================================================================
console.log('\n=== QB3：規則 SEMI_CHOIR_SUNDAY ===');
{
  const D = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];
  const sc = scene({
    choir: ['P9704', 'ROLE:DEACON'],
    roles: [
      { PersonID: 'P9701', RoleCode: 'DEACON', EffectiveFrom: '2098-01-01', EffectiveTo: D[0], Active: true },
      { PersonID: 'P9702', RoleCode: 'DEACON', EffectiveFrom: '2098-01-01', EffectiveTo: '', Active: true }]
  });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[1], singing: true }]);
  const ctx = g.buildFineTuneContext_(sc.Q, 0);
  check('★★★★ context 帶 choirGroupPostId', ctx.choirGroupPostId === 'CHOIR');
  check('★★★★★ RuleSettings 沒有這一行 ⇒ 預設開啟、SEMI_HARD',
    g.RULE_DEFAULT_LEVELS.SEMI_CHOIR_SUNDAY === 'SEMI_HARD' && g.RULE_DEFAULT_ENABLED.SEMI_CHOIR_SUNDAY === true);
  const cell = (date, postId, personId, extra) => Object.assign({ serviceDateId: 'X', serviceDate: date, postId: postId, slotIndex: 1,
    personId: personId, isManual: false }, extra || {});
  const vs = choirViolations(g.findStateViolations_([cell(D[1], 'CHAIR', 'P9704'), cell(D[0], 'READ', 'P9704'),
    cell(D[1], 'READ', 'P9703')], ctx));
  check('★★★★★★ 詩班獻詩的主日，詩班員做主席 ⇒ 一項 SEMI_HARD；其他主日、非詩班員不提醒',
    vs.length === 1 && vs[0].postId === 'CHAIR' && vs[0].serviceDate === D[1] && vs[0].severity === 'SEMI_HARD', JSON.stringify(vs));
  check('★★★★★ 一句人話', vs[0] && vs[0].reason === sc.PEOPLE.P9704 + ' 是詩班成員，1 月 11 日詩班獻詩，盡量不擔任其他崗位。', vs[0] && vs[0].reason);
  // 「執事」展開：P9702 現任；P9701 在 D[0] 卸任 ⇒ D[1] 不再是詩班成員
  const deacon = choirViolations(g.findStateViolations_([cell(D[1], 'CHAIR', 'P9702'), cell(D[1], 'READ', 'P9701')], ctx));
  check('★★★★★★ 詩班名單寫「執事」：現任執事算詩班成員；已卸任的不算',
    deacon.length === 1 && deacon[0].personId === 'P9702', JSON.stringify(deacon));
  // 人手填的格（獻花，AutoGenerate=FALSE）照樣提醒；系統不改
  const manual = choirViolations(g.findStateViolations_([cell(D[1], 'FLOWER', 'P9704', { isManual: true })], ctx));
  check('★★★★★★ 人手填的格（詩班員做獻花）照樣提醒', manual.length === 1 && manual[0].postId === 'FLOWER', JSON.stringify(manual));
  check('★★★★★ 人手填的崗位 ⇒ 系統不改（manual-only），說明可以勾「保留我的安排」',
    g.isManualOnlyRuleViolation_(manual[0], ctx.posts) === true
    && /勾「保留我的安排」/.test(g.manualOnlyRuleNote_(manual[0])) && g.manualOnlyRuleNote_(manual[0]) === g.CHOIR_MANUAL_ONLY_NOTE);
  check('★★★★ 自動排的崗位 ⇒ 不是 manual-only（系統可以調整）', g.isManualOnlyRuleViolation_(vs[0], ctx.posts) === false);
  // 規則可關
  const R = g.COLUMNS.RULE_SETTINGS;
  const off = Object.assign({}, ctx, { rules: Object.assign({}, ctx.rules, { SEMI_CHOIR_SUNDAY: { [R.RULE_ID]: 'SEMI_CHOIR_SUNDAY', [R.LEVEL]: 'SEMI_HARD', [R.ENABLED]: false } }) });
  check('★★★★★★ RuleSettings 關掉 ⇒ 不提醒', choirViolations(g.findStateViolations_([cell(D[1], 'CHAIR', 'P9704')], off)).length === 0);
  check('★★★★ 沒有設詩班（CHOIR_GROUP_POST_ID 空）⇒ 不提醒',
    g.isChoirSundayConflict_(Object.assign({}, ctx, { choirGroupPostId: '' }), 'P9704', true, D[1]) === false);
  // 〔請系統幫我調整〕：自動排的格改人，換成不是詩班員的人
  const state = ctx.original.map((c) => Object.assign({}, c));
  const target = state.filter((c) => c.serviceDate === D[1] && c.postId === 'CHAIR')[0];
  target.personId = 'P9704';
  const others = state.filter((c) => c.serviceDate === D[1] && c.postId !== 'CHAIR' && c.personId === 'P9704');
  others.forEach((c) => { c.personId = 'P9707'; });
  const fix = g.proposeMinimalFixFromState_(ctx, { manualState: state }, {}, {}, null, {});
  // （初稿在設定詩班獻詩之前生成，所以第 2 週其他格亦可能有詩班員；這裏只看主席那一格）
  const p = fix.proposals.filter((x) => x.brokenRuleId === 'SEMI_CHOIR_SUNDAY' && x.postId === 'CHAIR');
  check('★★★★★★ 〔請系統幫我調整〕：詩班員的主席那一格換成不是詩班員的人',
    p.length === 1 && p[0].postId === 'CHAIR' && p[0].suggestedPersonId && ['P9704', 'P9702'].indexOf(p[0].suggestedPersonId) === -1,
    JSON.stringify(fix.proposals));
  // 人手檢查不計（準硬規則）
  check('★★★★★ 人手檢查不計 SEMI_CHOIR_SUNDAY', g.STAFFING_MODELED_RULE_IDS.indexOf('SEMI_CHOIR_SUNDAY') === -1);
}

// =====================================================================
console.log('\n=== QB4：生成 ===');
{
  // 詩班＝假四、假五（主席／讀經名單上還有假一、假二、假三、假七）⇒ 第 2 週避開
  {
    const sc = scene();
    const g = sc.gas; const D = sc.DATES;
    g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[1], singing: true }]);
    g.apiGenerateDraftExecute(sc.Q);
    const onD1 = sc.rows(0).filter((r) => g.toDateString_(r[sc.A.SERVICE_DATE], sc.TZ) === D[1]).map((r) => r[sc.A.PERSON_ID]);
    check('★★★★★★ 生成：詩班獻詩那一週沒有詩班員（假四、假五）',
      onD1.length > 0 && onD1.every((id) => id !== 'P9704' && id !== 'P9705'), JSON.stringify(onD1));
    const all = sc.rows(0).map((r) => r[sc.A.PERSON_ID]);
    check('★★★★ 其他主日照常排詩班員（規則只管詩班獻詩那一週）', all.some((id) => id === 'P9704' || id === 'P9705'), JSON.stringify(all));
  }
  // 領詩名單只有假一、假二、假三，三位都是詩班 ⇒ 找不到其他人才排，並提醒
  const sc = scene({ choir: ['P9701', 'P9702', 'P9703'] });
  const g = sc.gas; const D = sc.DATES;
  g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[1], singing: true }]);
  g.apiGenerateDraftExecute(sc.Q);
  const w = sc.cellRow(0, D[1], 'WORSHIP');
  check('★★★★★★ 領詩找不到其他人 ⇒ 照樣排詩班員（不留空）', w && ['P9701', 'P9702', 'P9703'].indexOf(w[sc.A.PERSON_ID]) !== -1,
    JSON.stringify(w));
  const others = sc.rows(0).filter((r) => g.toDateString_(r[sc.A.SERVICE_DATE], sc.TZ) === D[1] && r[sc.A.POST_ID] !== 'WORSHIP')
    .map((r) => r[sc.A.PERSON_ID]).filter((id) => id);
  check('★★★★★ 主席、讀經有其他人 ⇒ 不排詩班員', others.length > 0 && others.every((id) => ['P9701', 'P9702', 'P9703'].indexOf(id) === -1),
    JSON.stringify(others));
  const ctx = g.buildFineTuneContext_(sc.Q, 0);
  const vs = choirViolations(g.findStateViolations_(ctx.original, ctx));
  check('★★★★★★ 並提醒（領詩那一格一項 SEMI_HARD）', vs.length === 1 && vs[0].postId === 'WORSHIP' && vs[0].serviceDate === D[1], JSON.stringify(vs));
}

// =====================================================================
console.log('\n=== QB5：整季重設 ===');
{
  const sc = scene();
  const g = sc.gas; const D = sc.DATES;
  g.apiGenerateDraftExecute(sc.Q);
  g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[1], singing: true }, { serviceDate: D[3], singing: true }]);
  const p = g.apiQuarterResetPlan(sc.Q);
  check('★★★★★★ 會保留：詩班獻詩 2 週', p.keptLines.indexOf('詩班獻詩 2 週') !== -1, JSON.stringify(p.keptLines));
  g.apiQuarterResetExecute(sc.Q, '確認重設');
  check('★★★★★★ 幹事介面重設之後兩週仍在', g.apiGetChoirSinging(sc.Q).weeks.filter((w) => w.singing).length === 2);
  const plan = g.planQuarterReset_(sc.Q, true);
  check('★★★★ 選單版計畫：詩班獻詩 2 週會清', plan.choirDates.length === 2);
  check('★★★★ 選單版確認文字有詩班獻詩一行', /詩班獻詩（ServiceDates\.ChoirSinging，只清這一季）：/.test(read('src/Menu.gs')));
  g.executeQuarterResetBatch_([{ quarterId: sc.Q, plan: plan }]);
  check('★★★★★ 選單版清空', g.apiGetChoirSinging(sc.Q).weeks.every((w) => !w.singing));
}

// =====================================================================
console.log('\n=== QB6：季前資料 ===');
{
  const sc = scene({ extraFiles: ['PreseasonPack.gs', 'EmailTemplateSeed.gs', 'WebAppPeople.gs'],
    choir: ['P9704', 'ROLE:DEACON'],
    roles: [{ PersonID: 'P9702', RoleCode: 'DEACON', EffectiveFrom: '2098-01-01', EffectiveTo: '', Active: true }] });
  const g = sc.gas; const D = sc.DATES;
  const X = sc.C.PERSON_POST_EXCLUSIONS;
  seedSheet(sc.ss, sc.S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), []);
  const W = sc.C.PERSON_POST_WEIGHT;
  seedSheet(sc.ss, sc.S.PERSON_POST_WEIGHT, ['W'], Object.keys(W).map((k) => W[k]), []);
  g.apiSaveCombinedServices(sc.Q, [{ serviceDate: D[2], kind: 'BAPTISM', name: '' }]);
  g.apiSaveChoirSinging(sc.Q, [{ serviceDate: D[1], singing: true }]);
  const origFormat = g.Utilities.formatDate;
  g.Utilities.formatDate = function (d, tz, f) {
    return Math.abs(d.getTime() - Date.now()) < 600000 ? '2098-12-10' : origFormat(d, tz, f);
  };
  g.computeAutomationSchedule_ = function () { return { generateDate: '2098-12-20', officialDate: '' }; };
  const pack = g.buildPreseasonPack_(sc.Q);
  const s5 = pack.sections[4];
  check('★★★★★★ 第五段標題「五、合堂主日及詩班獻詩」', s5.title === '五、合堂主日及詩班獻詩', s5.title);
  check('★★★★★★ 按日期：第 2 週詩班獻詩、第 3 週浸禮',
    s5.lines[0] === D[1] + '　詩班獻詩' && s5.lines[1] === D[2] + '　浸禮', JSON.stringify(s5.lines));
  const last = s5.lines[s5.lines.length - 1];
  check('★★★★★★ 另加一行「詩班名單（N 人）：名字」（「執事」按現任展開）',
    /^詩班名單（2 人）：/.test(last) && last.indexOf(sc.PEOPLE.P9704) !== -1 && last.indexOf(sc.PEOPLE.P9702) !== -1, last);
  check('★★★★ 第一段（事奉人員表）沒有詩班', pack.sections[0].lines.every((l) => !/^詩班/.test(l)), JSON.stringify(pack.sections[0].lines));
}

// =====================================================================
console.log('\n=== QB7：畫面、清單、文件 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T3';", ui);
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: [] }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] } });
  const body = ui.document.getElementById('zone2Body');
  const rowBtns = body.flatten().filter((n) => /\brow\b/.test(n.className || ''))
    .map((r) => r.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent)).filter((l) => l.indexOf('合堂主日') !== -1)[0];
  check('★★★★★★ 〔詩班獻詩〕在〔合堂主日〕旁邊', rowBtns && rowBtns.indexOf('詩班獻詩') === rowBtns.indexOf('合堂主日') + 1, JSON.stringify(rowBtns));
  const saved = [];
  ui.callServer = async function (name) {
    if (name === 'apiGetChoirSinging') {
      return { quarterLabel: '2028年7-9月', note: '勾選詩班獻詩的主日。', choirCount: 3,
        weeks: [{ serviceDate: '2028-07-02', singing: false }, { serviceDate: '2028-07-09', singing: true }] };
    }
    return {};
  };
  ui.callServerMutating = async function (name, q, items) { saved.push([name, q, items]); return { message: '已儲存 1 週的詩班獻詩設定。' }; };
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.openChoirSinging();
  setTimeout(() => {
    const title = ui.document.getElementById('modalTitle').textContent;
    const mb = ui.document.getElementById('modalBody');
    const boxes = mb.flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
    check('★★★★★ 視窗標題「詩班獻詩：2028年7-9月」', title === '詩班獻詩：2028年7-9月', title);
    check('★★★★★ 每個主日一個勾選格（第 2 週已勾）', boxes.length === 2 && boxes[0].checked === false && boxes[1].checked === true);
    check('★★★★ 說明句、詩班人數', /勾選詩班獻詩的主日/.test(mb.textContent) && /詩班名單：3 人/.test(mb.textContent), mb.textContent);
    boxes[0].checked = true;
    const saveBtn = ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '儲存')[0];
    saveBtn.fire('click');
    setTimeout(() => {
      check('★★★★★★ 〔儲存〕經 callServerMutating 送出全部週',
        saved.length === 1 && saved[0][0] === 'apiSaveChoirSinging' && saved[0][1] === '2099T3'
        && JSON.stringify(saved[0][2]) === JSON.stringify([{ serviceDate: '2028-07-02', singing: true }, { serviceDate: '2028-07-09', singing: true }]),
        JSON.stringify(saved));
      finish();
    }, 0);
  }, 0);

  const views = Object.keys(vm.runInContext('DEEP_LINK_VIEWS', ui)).sort().join(',');
  check('★★★★★ 深連結 view=choir', views.split(',').indexOf('choir') !== -1, views);
  const listOf = (src, re) => (src.match(re) || ['', ''])[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  check('★★★★★ apiGetChoirSinging 在前後端唯讀清單；apiSaveChoirSinging 不在',
    listOf(read('src/WebApp.gs'), /const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/).indexOf('apiGetChoirSinging') !== -1
    && listOf(read('src/ui/Script.html'), /const READ_ONLY_APIS = \[([\s\S]*?)\];/).indexOf('apiGetChoirSinging') !== -1
    && listOf(read('src/WebApp.gs'), /const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/).indexOf('apiSaveChoirSinging') === -1);
  const sc = scene({ withChoir: false, extraFiles: ['RuleReview.gs', 'DraftReviewReport.gs'] });
  const g = sc.gas;
  check('★★★★ Config：CHOIR_GROUP_POST_ID 預設 CHOIR（種子、基準）', g.CONFIG_KEYS.CHOIR_GROUP_POST_ID === 'CHOIR_GROUP_POST_ID'
    && /CHOIR_GROUP_POST_ID/.test(read('src/ConfigSeed.gs')) && /"CHOIR_GROUP_POST_ID"/.test(read('docs/config_baseline_上線值.json')));
  check('★★★★ 沒有詩班那一行 ⇒ 詩班人數 0（不拋）', g.readChoirMemberCountSafe_() === 0);
  check('★★★★ 選單：補建 Posts 欄位、建立詩班名單', /補建 Posts 欄位（是否在職事表顯示）/.test(read('src/Menu.gs')) && /'建立詩班名單', 'runCreateChoirGroup_'/.test(read('src/Menu.gs')));
  const built = g.buildRuleReviewSheetRows_([], 13);
  const choirIdx = built.meta.findIndex((m) => m && m.ruleId === 'SEMI_CHOIR_SUNDAY');
  let groupTitle = '';
  for (let i = choirIdx; i >= 0; i--) { if (built.meta[i] === null) { groupTitle = built.rows[i][0]; break; } }
  check('★★★★★ 規則審閱表：這一條列在「盡量遵守」組', choirIdx !== -1 && /盡量遵守/.test(groupTitle), groupTitle);
  check('★★★★ 草稿覆核報告有人話', /詩班獻詩的主日，詩班員盡量不擔任其他崗位/.test(read('src/DraftReviewReport.gs')));
  const doc = read('docs/週報系統讀取職事表資料說明.md');
  check('★★★★★ 週報說明：ChoirSinging、ShowInRoster、view=choir、第九十輪一行',
    /ServiceDates\.ChoirSinging/.test(doc) && /ShowInRoster=FALSE/.test(doc) && /\| `choir` \|/.test(doc) && /\| 第九十輪 \|/.test(doc));
}

function finish() {
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exitCode = fail === 0 ? 0 : 1;
}
