// 第一百一十二輪批次 UD 組：〔影音組合及協唱〕設定畫面（第一百一十三輪補專屬測試）。
// 執行方式：node tests/round112_ud_rule_extras_editor.test.js
//
//   UD1 讀取：三段資料、名單選項（只列在職的人）、現有資料問題用幹事看得明白的字（沒有 PersonID／HARD／SOFT）
//   UD2 儲存（三段）：寫回同一批工作表及 Config、格式不變（生成器的讀取函式讀回一樣）；只改有變動的格；沒有改動 ⇒ 不寫
//   UD3 移除＝Active 設為 FALSE（不刪行）；AuditLog 有改前、改後；自由文字經 sheetSafeText_()
//   UD4 核對不通過不可以儲存：指出哪一項（用名字）、甚麼都沒有寫；結構上的錯（重複、空白、太長）
//   UD5 權限：只可查看的人、確認者伺服器端一律拒絕寫入；寫入經 withMutationLock_()
//   UD6 這一季已有版本 ⇒ 儲存之後有提示；沒有版本、沒有改動 ⇒ 沒有提示
//   UD7 畫面：按鈕位置、三段、唯讀、儲存送出的內容、畫面用字
// 用假 ID（P97xx）、假名、example.invalid。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

const BAD_WORDS = /PersonID|PostID|HARD|SOFT|Config|Active|TeamID/;

/** 場景：七位會友、五個崗位（讀經／獻花／領詩…）。影音組合＝「示範組」（P9701 讀經＋獻花，P9702 讀經）；協唱兩行；詩班例外一項。 */
function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({
    extraFiles: ['RuleExtrasCheck.gs', 'RuleExtrasEditor.gs', 'GoLiveWizard.gs', 'WebApp.gs'],
    config: { CHOIR_SUNDAY_ALLOWED: ['', 'STR'], WEBAPP_ENABLED: ['TRUE', 'BOOL'] }
  });
  const g = sc.gas; const C = sc.C; const S = sc.S;
  let n = 0;
  g.nowTimestamp_ = function () { n++; return '2099-01-01 09:00:' + String(n % 60).padStart(2, '0'); };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  g.Session = { getActiveUser: () => ({ getEmail: () => 'editor@example.invalid' }) };
  g.ensureRuleDataSheets_();
  const T = C.POST_TEAMS; const W = C.WORSHIP_BACKING_SINGERS;
  if (!opts.empty) {
    sc.appendRows(sc.ss, S.POST_TEAMS, [T.TEAM_ID, T.PERSON_ID, T.POST_IDS, T.PER_MONTH, T.OUTSIDE_TEAM_LEVEL, T.NOTES, T.ACTIVE], [
      { [T.TEAM_ID]: '示範組', [T.PERSON_ID]: 'P9701', [T.POST_IDS]: 'READ,FLOWER', [T.PER_MONTH]: 2, [T.OUTSIDE_TEAM_LEVEL]: 'HARD', [T.NOTES]: '備註甲', [T.ACTIVE]: true },
      { [T.TEAM_ID]: '示範組', [T.PERSON_ID]: 'P9702', [T.POST_IDS]: 'READ', [T.PER_MONTH]: 2, [T.OUTSIDE_TEAM_LEVEL]: 'SOFT', [T.NOTES]: '', [T.ACTIVE]: true }]);
    sc.appendRows(sc.ss, S.WORSHIP_BACKING_SINGERS, [W.LEADER_PERSON_ID, W.SINGER_PERSON_ID, W.SINGER_NAME, W.LEVEL, W.NOTES, W.ACTIVE], [
      { [W.LEADER_PERSON_ID]: 'P9701', [W.SINGER_PERSON_ID]: 'P9704', [W.SINGER_NAME]: '', [W.LEVEL]: 'HARD', [W.NOTES]: '', [W.ACTIVE]: true },
      { [W.LEADER_PERSON_ID]: 'P9702', [W.SINGER_PERSON_ID]: '', [W.SINGER_NAME]: '外來協唱', [W.LEVEL]: 'SOFT', [W.NOTES]: '', [W.ACTIVE]: true }]);
    setChoir(sc, 'P9703:READ');
  }
  sc.audits = (action) => g.readSheet_(S.AUDIT_LOG).filter((r) => !action || r[C.AUDIT_LOG.ACTION] === action);
  sc.teamRows = () => g.readSheetRowsWithNumbers_(S.POST_TEAMS);
  sc.singerRows = () => g.readSheetRowsWithNumbers_(S.WORSHIP_BACKING_SINGERS);
  sc.snapshot = () => JSON.stringify([sc.teamRows(), sc.singerRows(), g.getConfig_(g.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, '')]);
  return sc;
}
function setChoir(sc, value) {
  const sheet = sc.ss.getSheetByName(sc.S.CONFIG);
  const keys = sheet.getRange(3, 1, sheet.getLastRow() - 2, 1).getValues();
  for (let i = 0; i < keys.length; i++) if (keys[i][0] === sc.gas.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED) sheet.getRange(i + 3, 2).setValue(value);
  sc.gas.reloadConfigCache_();
}
/** 現有內容原樣送回（畫面讀到甚麼就送甚麼）。 */
function payloadFrom(data) {
  return JSON.parse(JSON.stringify({
    teams: data.teams.map((t) => ({ teamId: t.teamId, perMonth: t.perMonth, members: t.members.map((m) => ({ personId: m.personId, postIds: m.postIds, level: m.level })) })),
    singers: data.singers.map((s) => ({ leaderPersonId: s.leaderPersonId, singerPersonId: s.singerPersonId, singerName: s.singerName, level: s.level })),
    choir: data.choir.map((c) => ({ personId: c.personId, postId: c.postId }))
  }));
}

console.log('\n=== UD1：讀取 ===');
{
  const sc = scene(); const g = sc.gas;
  const d = g.apiGetRuleExtrasEditor(sc.Q);
  check('★★★★★★ 影音組合：一組兩位成員（崗位合併、每月 2 次、組合週以外 HARD／SOFT）',
    d.teams.length === 1 && d.teams[0].teamId === '示範組' && d.teams[0].perMonth === 2 && d.teams[0].members.length === 2
      && d.teams[0].members[0].personId === 'P9701' && d.teams[0].members[0].postIds.join() === 'READ,FLOWER' && d.teams[0].members[0].level === 'HARD'
      && d.teams[0].members[1].level === 'SOFT' && d.teams[0].members[0].name === '假甲', JSON.stringify(d.teams));
  check('★★★★★★ 協唱：兩行（名單上的人、自己輸入的名字）',
    d.singers.length === 2 && d.singers[0].singerPersonId === 'P9704' && d.singers[0].leaderName === '假甲' && d.singers[1].singerName === '外來協唱' && d.singers[1].level === 'SOFT', JSON.stringify(d.singers));
  check('★★★★★★ 詩班獻詩日照樣可以擔任的崗位：一項（人＋崗位名稱）', d.choir.length === 1 && d.choir[0].personId === 'P9703' && d.choir[0].postId === 'READ' && d.choir[0].personName === '假丙' && d.choir[0].postName === '讀經', JSON.stringify(d.choir));
  check('★★★★★ 名單選項：七位在職的人、各崗位的事奉人員名單（領詩名單是 P9701–P9703）',
    d.options.people.length === 7 && d.options.eligibleByPost.WORSHIP.slice().sort().join() === 'P9701,P9702,P9703' && d.options.posts.some((p) => p.postId === 'READ' && p.name === '讀經'), JSON.stringify(d.options.eligibleByPost));
  check('★★★★★ 沒有問題、沒有版本、工作表已建立；三段都有說明', d.problems.length === 0 && d.hasVersion === false && d.sheetsReady === true && d.explain.teams && d.explain.singers && d.explain.choir);
  check('★★★★★ 說明用幹事看得明白的字（沒有 PersonID、HARD、SOFT、Config）', !BAD_WORDS.test(JSON.stringify(d.explain)), JSON.stringify(d.explain));
  // 現有資料有問題 ⇒ 用幹事看得明白的字
  sc.appendRows(sc.ss, sc.S.POST_TEAMS, [sc.C.POST_TEAMS.TEAM_ID, sc.C.POST_TEAMS.PERSON_ID, sc.C.POST_TEAMS.POST_IDS, sc.C.POST_TEAMS.PER_MONTH, sc.C.POST_TEAMS.OUTSIDE_TEAM_LEVEL, sc.C.POST_TEAMS.NOTES, sc.C.POST_TEAMS.ACTIVE],
    [{ TeamID: '錯組', PersonID: 'P9799', PostIDs: 'READ', PerMonth: 1, OutsideTeamLevel: 'XX', Notes: '', Active: true }]);
  setChoir(sc, 'P9703:READ,P9703');
  const d2 = g.apiGetRuleExtrasEditor(sc.Q);
  check('★★★★★★ 資料有問題：逐項列出，指出組合名稱／領詩／第幾項，用名字', d2.problems.length >= 3 && d2.problems.some((l) => /^影音組合「錯組」：名單上找不到「P9799」這個人/.test(l))
    && d2.problems.some((l) => /^影音組合「錯組」：組合週以外的設定不是「一定不排」或「盡量不排」/.test(l)) && d2.problems.some((l) => /^詩班獻詩日的例外第 2 項：「P9703」格式不對/.test(l)), JSON.stringify(d2.problems));
  check('★★★★★★ 畫面上的問題句沒有 PersonID、PostID、HARD、SOFT、Config、PostTeams', !/PersonID|PostID|HARD|SOFT|Config|PostTeams|WorshipBackingSingers/.test(d2.problems.join('')), d2.problems.join('｜'));
  check('★★★★★ 格式不對的例外項列在 choirInvalid（儲存時會移除）', d2.choirInvalid.join() === 'P9703');
}

console.log('\n=== UD2：儲存（三段）＋格式來回一致 ===');
{
  const sc = scene(); const g = sc.gas; const C = sc.C;
  const d = g.apiGetRuleExtrasEditor(sc.Q);
  const p = payloadFrom(d);
  const ctxBefore = JSON.stringify(g.readRuleExtrasContext_());
  const snap = sc.snapshot();
  const none = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★★ 原樣送回 ⇒「沒有改動」、工作表及 Config 不變、不寫 AuditLog', none.message === '沒有改動。' && sc.snapshot() === snap && sc.audits('RULE_EXTRAS_SAVED').length === 0, none.message);
  // 改動：加一位成員（P9703 讀經）、改每月次數 3、加一行協唱、加一項詩班例外、改協唱級別
  p.teams[0].perMonth = 3;
  p.teams[0].members.push({ personId: 'P9703', postIds: ['READ'], level: 'SOFT' });
  p.singers.push({ leaderPersonId: 'P9703', singerPersonId: 'P9705', singerName: '', level: 'HARD' });
  p.singers[0].level = 'SOFT';
  p.choir.push({ personId: 'P9701', postId: 'FLOWER' });
  const r = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★★ 儲存成功，三段都有改動', r.ok === true && r.changed.teams > 0 && r.changed.singers > 0 && r.changed.choir === true && /影音組合、協唱、詩班獻詩日照樣可以擔任的崗位/.test(r.message), JSON.stringify(r));
  const ctx = g.readRuleExtrasContext_();
  const t = ctx.teams.list[0];
  check('★★★★★★ 生成器讀回：組合每月 3 次、三位成員、崗位和組合週以外級別一致',
    t.teamId === '示範組' && t.perMonth === 3 && t.members.length === 3 && t.members[0].postIds.join() === 'READ,FLOWER' && t.members[0].level === 'HARD'
      && t.members[1].level === 'SOFT' && t.members[2].personId === 'P9703' && t.members[2].postIds.join() === 'READ', JSON.stringify(t));
  check('★★★★★★ 生成器讀回：協唱三行（級別改了）、詩班例外兩項（Config 格式「人:崗位」逗號分隔不變）',
    ctx.backingSingers.length === 3 && ctx.backingSingers[0].level === 'SOFT' && ctx.backingSingers[2].leaderId === 'P9703'
      && g.getConfig_(g.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, '') === 'P9703:READ,P9701:FLOWER' && ctx.choirSundayAllowed['P9701:FLOWER'] === true, JSON.stringify(ctx.backingSingers) + g.getConfig_(g.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, ''));
  // 再讀畫面，內容就是剛才儲存的
  const back = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  check('★★★★★★ 儲存之後再打開畫面 ⇒ 和儲存的內容完全一致（來回一致）', JSON.stringify(back) === JSON.stringify(p), JSON.stringify(back));
  // 只改有變動的格：備註欄不碰；沒有改的行不寫
  const rows = sc.teamRows();
  check('★★★★★ 備註欄不碰（原有備註仍在）；新成員新增一行', rows[0][C.POST_TEAMS.NOTES] === '備註甲' && rows.length === 3, JSON.stringify(rows.map((x) => x[C.POST_TEAMS.NOTES])));
  const again = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★ 同一份內容再儲存一次 ⇒「沒有改動」', again.message === '沒有改動。');
}

console.log('\n=== UD3：移除＝Active 設為 FALSE；AuditLog 改前改後；sheetSafeText_ ===');
{
  const sc = scene(); const g = sc.gas; const C = sc.C;
  const p = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  const lastRowTeams = sc.ss.getSheetByName(sc.S.POST_TEAMS).getLastRow();
  const lastRowSingers = sc.ss.getSheetByName(sc.S.WORSHIP_BACKING_SINGERS).getLastRow();
  p.teams[0].members.splice(1, 1);                 // 移除成員 P9702
  p.singers.splice(1, 1);                          // 移除協唱第二行
  p.choir = [];                                    // 移除詩班例外
  const r = g.apiSaveRuleExtras(sc.Q, p);
  const T = C.POST_TEAMS; const W = C.WORSHIP_BACKING_SINGERS;
  const sheetTeams = g.readSheet_(sc.S.POST_TEAMS);
  check('★★★★★★ 移除成員：那一行 Active 變 FALSE，不刪行（行數不變）',
    sc.ss.getSheetByName(sc.S.POST_TEAMS).getLastRow() === lastRowTeams && sheetTeams.length === 2 && String(sheetTeams[1][T.ACTIVE]).toUpperCase() === 'FALSE' && String(sheetTeams[0][T.ACTIVE]).toUpperCase() === 'TRUE', JSON.stringify(sheetTeams.map((x) => x[T.ACTIVE])));
  const sheetSingers = g.readSheet_(sc.S.WORSHIP_BACKING_SINGERS);
  check('★★★★★★ 移除協唱：Active 變 FALSE，不刪行', sc.ss.getSheetByName(sc.S.WORSHIP_BACKING_SINGERS).getLastRow() === lastRowSingers && String(sheetSingers[1][W.ACTIVE]).toUpperCase() === 'FALSE' && String(sheetSingers[0][W.ACTIVE]).toUpperCase() === 'TRUE');
  check('★★★★★★ 移除詩班例外：Config 變空白', g.getConfig_(g.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, '') === '' && r.changed.choir === true);
  const ctx = g.readRuleExtrasContext_();
  check('★★★★★ 生成器只讀到仍然生效的：組合一位成員、協唱一行、沒有詩班例外', ctx.teams.list[0].members.length === 1 && ctx.backingSingers.length === 1 && Object.keys(ctx.choirSundayAllowed).length === 0);
  const a = sc.audits('RULE_EXTRAS_SAVED');
  const A = C.AUDIT_LOG;
  const teamAudit = a.filter((x) => x[A.TARGET_SHEET] === sc.S.POST_TEAMS)[0];
  const singerAudit = a.filter((x) => x[A.TARGET_SHEET] === sc.S.WORSHIP_BACKING_SINGERS)[0];
  check('★★★★★★ AuditLog（影音組合）：改前有兩位成員、改後只有一位；用名字及崗位名稱，沒有 ID',
    !!teamAudit && /假甲/.test(teamAudit[A.OLD_VALUE]) && /假乙/.test(teamAudit[A.OLD_VALUE]) && /假甲/.test(teamAudit[A.NEW_VALUE]) && !/假乙/.test(teamAudit[A.NEW_VALUE])
      && /讀經、獻花/.test(teamAudit[A.OLD_VALUE]) && !/P97/.test(teamAudit[A.OLD_VALUE] + teamAudit[A.NEW_VALUE]), JSON.stringify(teamAudit));
  check('★★★★★★ AuditLog（協唱）：改前兩行、改後一行', !!singerAudit && /外來協唱/.test(singerAudit[A.OLD_VALUE]) && !/外來協唱/.test(singerAudit[A.NEW_VALUE]));
  const cfgAudit = g.readSheet_(sc.S.AUDIT_LOG).filter((x) => x[A.TARGET_KEY] === g.CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED);
  check('★★★★★★ AuditLog（詩班例外 Config）：改前「P9703:READ」、改後空白', cfgAudit.length === 1 && cfgAudit[0][A.OLD_VALUE] === 'P9703:READ' && cfgAudit[0][A.NEW_VALUE] === '', JSON.stringify(cfgAudit));
  // 移除之後再加回同一位成員 ⇒ 重新啟用／新增（不會有兩行同時生效）
  const p2 = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  p2.teams[0].members.push({ personId: 'P9702', postIds: ['READ'], level: 'HARD' });
  g.apiSaveRuleExtras(sc.Q, p2);
  check('★★★★★ 移除之後再加回：生成器讀到兩位成員（加回的是新增一行）', g.readRuleExtrasContext_().teams.list[0].members.length === 2 && g.readSheet_(sc.S.POST_TEAMS).length === 3);
}
{
  // 自由文字：以 = + - @ 開頭 ⇒ 加單引號（sheetSafeText_）
  const sc = scene({ empty: true }); const g = sc.gas; const C = sc.C;
  const p = { teams: [{ teamId: '=SUM(1)', perMonth: 1, members: [{ personId: 'P9701', postIds: ['READ'], level: 'HARD' }] }],
    singers: [{ leaderPersonId: 'P9701', singerPersonId: '', singerName: '+外來', level: 'HARD' }], choir: [] };
  const written = [];
  const origApply = g.applyRuleExtrasSheetWrites_;
  g.applyRuleExtrasSheetWrites_ = function (name, plan, activeKey) { written.push(JSON.stringify(plan.appends)); return origApply(name, plan, activeKey); };
  g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★★ 組合名稱、協唱名字經 sheetSafeText_()：寫入的是加了單引號的「=SUM(1)」「+外來」（Google 試算表不會當公式；單引號不留在格內）',
    written.length === 2 && written[0].indexOf("\"'=SUM(1)\"") !== -1 && written[1].indexOf("\"'+外來\"") !== -1, written.join('｜'));
  const t = g.readSheet_(sc.S.POST_TEAMS)[0][C.POST_TEAMS.TEAM_ID];
  check('★★★★★ 讀回來仍是「=SUM(1)」這個名字；同一份內容再儲存 ⇒「沒有改動」（不會因為單引號每次都當作有改動）',
    t === '=SUM(1)' && g.apiSaveRuleExtras(sc.Q, p).message === '沒有改動。', t);
  const src = read('src/RuleExtrasEditor.gs');
  check('★★★★★★ 原始碼：寫入組合名稱及協唱名字都經 sheetSafeText_', /f\[T\.TEAM_ID\] = sheetSafeText_\(t\.teamId\)/.test(src) && /f\[W\.SINGER_NAME\] = sheetSafeText_\(s\.singerName\)/.test(src));
}

console.log('\n=== UD4：核對不通過不可以儲存 ===');
{
  const sc = scene(); const g = sc.gas;
  const base = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  const snap = sc.snapshot();
  const auditsBefore = g.readSheet_(sc.S.AUDIT_LOG).length;
  const attempt = (mut) => { const p = JSON.parse(JSON.stringify(base)); mut(p); return throwsMsg(() => g.apiSaveRuleExtras(sc.Q, p)); };
  // 不在該崗位的事奉人員名單（P9704 不在領詩名單；P9706 不在讀經名單）
  const m1 = attempt((p) => { p.teams[0].members.push({ personId: 'P9706', postIds: ['READ'], level: 'HARD' }); });
  check('★★★★★★ 成員不在該崗位的事奉人員名單 ⇒ 不可以儲存，指出組合及名字及崗位（不寫 ID）',
    /不可以儲存/.test(m1) && /影音組合「示範組」：「假己」不在「讀經」的事奉人員名單上/.test(m1) && !/P9706|PersonID/.test(m1) && /甚麼都沒有儲存/.test(m1), m1);
  const m2 = attempt((p) => { p.singers[0].leaderPersonId = 'P9704'; });
  check('★★★★★★ 領詩不在領詩名單 ⇒ 不可以儲存，指出是哪位領詩的協唱', /協唱（領詩「假丁」）：「假丁」不在「領詩」的事奉人員名單上/.test(m2), m2);
  const m3 = attempt((p) => { p.choir.push({ personId: 'P9706', postId: 'READ' }); });
  check('★★★★★★ 詩班例外：人不在該崗位名單 ⇒ 不可以儲存，指出第幾項', /詩班獻詩日的例外第 2 項：「假己」不在「讀經」的事奉人員名單上/.test(m3), m3);
  const m4 = attempt((p) => { p.teams[0].members.push({ personId: 'P9799', postIds: ['READ'], level: 'HARD' }); });
  check('★★★★★ 人不在名單上 ⇒ 不可以儲存（用幹事看得明白的字）', /名單上找不到「P9799」這個人/.test(m4) && !/PersonID/.test(m4), m4);
  const m5 = attempt((p) => { p.teams[0].members.push({ personId: 'P9703', postIds: ['NOPE'], level: 'HARD' }); });
  check('★★★★★ 崗位不存在 ⇒ 不可以儲存', /崗位「NOPE」不存在/.test(m5) && !/PostID/.test(m5), m5);
  const m6 = attempt((p) => { p.singers.push({ leaderPersonId: 'P9703', singerPersonId: '', singerName: '', level: 'HARD' }); });
  check('★★★★★ 協唱沒有選人也沒有名字 ⇒ 不可以儲存', /沒有選協唱/.test(m6) && !/PersonID/.test(m6), m6);
  const m7 = attempt((p) => { p.teams[0].members.push({ personId: 'P9703', postIds: [], level: 'HARD' }); });
  check('★★★★★ 成員沒有勾選任何崗位 ⇒ 不可以儲存', /有一位成員沒有勾選任何崗位/.test(m7), m7);
  check('★★★★★★ 上面每一次被拒絕，工作表、Config、AuditLog 都沒有動過', sc.snapshot() === snap && g.readSheet_(sc.S.AUDIT_LOG).length === auditsBefore);
  // 結構上的錯
  check('★★★★★ 組合名稱空白', /沒有填組合名稱/.test(attempt((p) => { p.teams[0].teamId = '  '; })));
  check('★★★★★ 組合名稱重複', /出現了兩次/.test(attempt((p) => { p.teams.push(JSON.parse(JSON.stringify(p.teams[0]))); })));
  check('★★★★★ 組合名稱有逗號／冒號', /不可以有逗號或冒號/.test(attempt((p) => { p.teams[0].teamId = '甲,乙'; })));
  check('★★★★★ 組合名稱太長', /太長/.test(attempt((p) => { p.teams[0].teamId = '長'.repeat(41); })));
  check('★★★★★ 每月次數不是 1 至 8 的整數', /1 至 8 的整數/.test(attempt((p) => { p.teams[0].perMonth = 9; })) && /1 至 8 的整數/.test(attempt((p) => { p.teams[0].perMonth = 1.5; })));
  check('★★★★★ 同一位成員出現兩次', /同一位成員出現了兩次/.test(attempt((p) => { p.teams[0].members.push(JSON.parse(JSON.stringify(p.teams[0].members[0]))); })));
  check('★★★★★ 組合沒有成員', /沒有成員/.test(attempt((p) => { p.teams[0].members = []; })));
  check('★★★★★ 同一對領詩和協唱出現兩次', /出現了兩次/.test(attempt((p) => { p.singers.push(JSON.parse(JSON.stringify(p.singers[0]))); })));
  check('★★★★★ 詩班例外沒有選人或崗位', /沒有選人或者崗位/.test(attempt((p) => { p.choir.push({ personId: '', postId: 'READ' }); })));
  check('★★★★★ 全部結構上的錯同樣不動工作表', sc.snapshot() === snap);
  // 正常的仍可以儲存
  check('★★★★ 修正之後可以儲存', g.apiSaveRuleExtras(sc.Q, Object.assign(JSON.parse(JSON.stringify(base)), { choir: [] })).ok === true);
}

console.log('\n=== UD5：權限、鎖 ===');
{
  const src = read('src/RuleExtrasEditor.gs');
  check('★★★★★★ apiSaveRuleExtras 第一句是 assertWebAppRequestAllowed_()（不傳名字＝要可以修改），之後經 withMutationLock_',
    /function apiSaveRuleExtras\([^)]*\) \{\n  assertWebAppRequestAllowed_\(\);\n  return withMutationLock_\(/.test(src));
  check('★★★★★★ apiGetRuleExtrasEditor 以自己的名字呼叫（只讀名單 WEBAPP_READ_ONLY_APIS 內）', /function apiGetRuleExtrasEditor\([^)]*\) \{\n  assertWebAppRequestAllowed_\('apiGetRuleExtrasEditor'\);/.test(src)
    && /WEBAPP_READ_ONLY_APIS = \[[\s\S]*'apiGetRuleExtrasEditor'[\s\S]*?\];/.test(read('src/WebApp.gs')));
  const gas = require('./helpers/gas_loader.js').loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  let email = 'viewer@example.invalid';
  gas.Session = { getActiveUser: () => ({ getEmail: () => email }) };
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['editor@example.invalid'];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid'];
    return d;
  };
  gas.writeAuditLog_ = () => {}; gas.log_ = () => {};
  // 載入 RuleExtrasEditor.gs 的函式到同一個環境
  const sc = scene(); const g = sc.gas;
  g.getConfig_ = (function (orig) {
    return function (key, d) {
      if (key === g.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['editor@example.invalid'];
      if (key === g.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid'];
      return orig(key, d);
    };
  })(g.getConfig_);
  // 場景預設把權限檢查換成空函式；這裏換回真正的 WebApp.gs 權限檢查（在 gas 那個環境讀名單）
  g.assertWebAppRequestAllowed_ = function (n) { gas.Session = g.Session; return gas.assertWebAppRequestAllowed_(n); };
  const snap = sc.snapshot();
  const payload = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  payload.teams[0].perMonth = 5;
  g.Session = { getActiveUser: () => ({ getEmail: () => 'viewer@example.invalid' }) };
  g.apiGetRuleExtrasEditor(sc.Q);
  const msg = throwsMsg(() => g.apiSaveRuleExtras(sc.Q, payload));
  check('★★★★★★ 只可查看的人儲存 ⇒ 伺服器拒絕「你只有查看權限，不可以改動。」，工作表及 Config 沒有動', msg === '你只有查看權限，不可以改動。' && sc.snapshot() === snap, msg);
  let readOk = true;
  try { g.assertWebAppRequestAllowed_('apiGetRuleExtrasEditor'); } catch (e) { readOk = false; }
  check('★★★★★★ 只可查看的人可以打開畫面（讀取）', readOk);
  const d = g.apiGetRuleExtrasEditor(sc.Q);
  check('★★★★★ 只可查看的人讀到的內容和可以修改的人一樣', d.teams.length === 1 && d.options.people.length === 7);
  g.Session = { getActiveUser: () => ({ getEmail: () => 'stranger@example.invalid' }) };
  check('★★★★★ 不在任何名單的人 ⇒ 讀取、儲存都拒絕', throwsMsg(() => g.apiSaveRuleExtras(sc.Q, payload)) !== '' && throwsMsg(() => g.apiGetRuleExtrasEditor(sc.Q)) !== '' && sc.snapshot() === snap);
  g.Session = { getActiveUser: () => ({ getEmail: () => 'editor@example.invalid' }) };
  // 鎖：withMutationLock_ 拿不到鎖 ⇒ 不寫
  g.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {}, waitLock: () => { throw new Error('lock'); } }), getDocumentLock: () => ({ tryLock: () => false, releaseLock: () => {}, waitLock: () => { throw new Error('lock'); } }) };
  const lockMsg = throwsMsg(() => g.apiSaveRuleExtras(sc.Q, payload));
  check('★★★★★★ 拿不到鎖 ⇒ 不儲存、工作表不動（寫入經 withMutationLock_）', lockMsg !== '' && sc.snapshot() === snap, lockMsg);
}

console.log('\n=== UD6：這一季已有版本的提示 ===');
{
  const sc = scene(); const g = sc.gas;
  const p = payloadFrom(g.apiGetRuleExtrasEditor(sc.Q));
  p.teams[0].perMonth = 4;
  const r0 = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★ 這一季沒有版本 ⇒ 沒有提示，說「之後生成職事表時會用新設定」', r0.hasVersion === false && r0.versionNote === '' && /之後生成職事表時會用新設定/.test(r0.message), JSON.stringify(r0));
  g.findLatestVersionNo_ = function (q) { return q === sc.Q ? 0 : -1; };
  check('★★★★★★ 畫面讀取：這一季已有版本（第 0 版也算）', g.apiGetRuleExtrasEditor(sc.Q).hasVersion === true);
  p.teams[0].perMonth = 5;
  const r1 = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★★ 已有版本 ⇒ 儲存之後提示「這一季已經有版本，新設定要按〔請系統幫我調整〕之後才會反映。」',
    r1.hasVersion === true && r1.versionNote === '這一季已經有版本，新設定要按〔請系統幫我調整〕之後才會反映。' && r1.message.indexOf(r1.versionNote) !== -1, JSON.stringify(r1));
  const r2 = g.apiSaveRuleExtras(sc.Q, p);
  check('★★★★★ 已有版本但沒有改動 ⇒ 不提示（只說沒有改動）', r2.message === '沒有改動。' && r2.versionNote === '');
  check('★★★★★ 另一季沒有版本 ⇒ 沒有提示', g.apiGetRuleExtrasEditor('2099T2').hasVersion === false);
}

console.log('\n=== UD7：畫面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1'; runAction = async function (l, fn) { await fn(); };", ui);
  const sh = read('src/ui/Script.html');
  check('★★★★★★ 〔影音組合及協唱〕在 Script.html 的「只讀 api」名單內（打開不令畫面標記過期）', /'apiGetRuleExtrasEditor'/.test(sh));
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: [] }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] } });
  const rowBtns = ui.document.getElementById('zone2Body').flatten().filter((n) => /\brow\b/.test(n.className || ''))
    .map((r) => r.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent)).filter((l) => l.indexOf('預先安排領詩、司琴') !== -1)[0];
  check('★★★★★★ 〔影音組合及協唱〕在〔預先安排領詩、司琴〕旁邊（同一行，最後一粒）', Array.isArray(rowBtns) && rowBtns.indexOf('影音組合及協唱') === rowBtns.indexOf('預先安排領詩、司琴') + 1, JSON.stringify(rowBtns));

  const data = {
    quarterId: '2099T1', quarterLabel: '2099年1-3月', hasVersion: true, sheetsReady: true, choirInvalid: [], problems: [],
    teams: [{ teamId: '示範組', perMonth: 2, members: [{ personId: 'P9701', postIds: ['READ', 'FLOWER'], level: 'HARD', name: '假甲' }, { personId: 'P9702', postIds: ['READ'], level: 'SOFT', name: '假乙' }] }],
    singers: [{ leaderPersonId: 'P9701', singerPersonId: 'P9704', singerName: '', level: 'HARD' }, { leaderPersonId: 'P9702', singerPersonId: '', singerName: '外來協唱', level: 'SOFT' }],
    choir: [{ personId: 'P9703', postId: 'READ' }],
    options: { people: [{ personId: 'P9701', name: '假甲' }, { personId: 'P9702', name: '假乙' }, { personId: 'P9703', name: '假丙' }, { personId: 'P9704', name: '假丁' }],
      posts: [{ postId: 'READ', name: '讀經' }, { postId: 'FLOWER', name: '獻花' }, { postId: 'WORSHIP', name: '領詩' }],
      eligibleByPost: { READ: ['P9701', 'P9702', 'P9703', 'P9704'], FLOWER: ['P9701', 'P9702'], WORSHIP: ['P9701', 'P9702', 'P9703'], CHOIR: ['P9703'] },
      worshipPostId: 'WORSHIP', choirPostId: 'CHOIR', maxPerMonth: 8 },
    explain: { teams: '組合說明', singers: '協唱說明', choir: '詩班說明' }
  };
  const view = () => {
    const mb = ui.document.getElementById('modalBody');
    return { title: ui.document.getElementById('modalTitle').textContent, text: mb.textContent, all: mb.flatten(),
      buttons: ui.document.getElementById('modalActions').flatten().filter((n) => n.tagName === 'BUTTON').concat(mb.flatten().filter((n) => n.tagName === 'BUTTON')) };
  };
  vm.runInContext('viewOnly_ = false;', ui);
  ui.renderRuleExtras_(data);
  let v = view();
  const bodyButtons = v.all.filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  check('★★★★★★ 視窗標題帶季度；三段標題、各段說明都在', v.title === '影音組合及協唱：2099年1-3月' && /影音組合/.test(v.text) && /協唱/.test(v.text) && /詩班獻詩日照樣可以擔任的崗位/.test(v.text)
    && /組合說明/.test(v.text) && /協唱說明/.test(v.text) && /詩班說明/.test(v.text), v.title);
  check('★★★★★★ 影音組合：組合名稱、每月次數、成員名字、勾選的崗位、組合週以外的設定', v.all.some((n) => n.tagName === 'INPUT' && n.value === '示範組')
    && v.all.some((n) => n.tagName === 'SELECT' && n.value === '2') && v.all.some((n) => n.tagName === 'SELECT' && n.value === 'P9701')
    && v.all.filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox').length === 3 && /讀經/.test(v.text) && /獻花/.test(v.text)
    && v.all.some((n) => n.tagName === 'SELECT' && n.value === 'SOFT'));
  check('★★★★★★ 可以加一組、加一位成員、移除這一組、移除成員；協唱、例外各有加一行／加一項、移除',
    ['加一組', '加一位成員', '移除這一組', '加一行', '加一項'].every((l) => bodyButtons.indexOf(l) !== -1) && bodyButtons.filter((l) => l === '移除').length === 2 + 2 + 1, JSON.stringify(bodyButtons));
  const memberSel = v.all.filter((n) => n.tagName === 'SELECT' && n.value === 'P9701')[0];
  check('★★★★★★ 成員名字下拉：只列有崗位名單資格的人（讀經＋獻花都要在名單上 ⇒ 假甲、假乙）；現有的人在內',
    memberSel.flatten().filter((n) => n.tagName === 'OPTION').map((o) => o.textContent).join() === '（請選）,假乙,假甲' || memberSel.flatten().filter((n) => n.tagName === 'OPTION').map((o) => o.textContent).join() === '（請選）,假甲,假乙',
    memberSel.flatten().filter((n) => n.tagName === 'OPTION').map((o) => o.textContent).join());
  const leaderSel = v.all.filter((n) => n.tagName === 'SELECT' && n.flatten().some((o) => o.tagName === 'OPTION' && o.textContent === '假丙') && !n.flatten().some((o) => o.textContent === '假丁')).length;
  check('★★★★★★ 領詩下拉只列領詩名單上的人（沒有假丁）', leaderSel >= 1);
  check('★★★★★★ 協唱下拉：名單上的人，加「其他（自己輸入）」；自己輸入的名字顯示在文字框', v.all.some((n) => n.tagName === 'SELECT' && n.flatten().some((o) => o.textContent === '其他（自己輸入）'))
    && v.all.some((n) => n.tagName === 'INPUT' && n.value === '外來協唱' && n.hidden === false) && v.all.filter((n) => n.tagName === 'INPUT' && n.type === 'text' && n.hidden === true).length >= 1);
  check('★★★★★★ 領詩那一日協唱：一定不排／盡量不排', v.all.some((n) => n.tagName === 'SELECT' && n.flatten().filter((o) => o.tagName === 'OPTION').map((o) => o.textContent).join() === '一定不排,盡量不排'));
  check('★★★★★★ 畫面用字：沒有 PersonID、PostID、HARD、SOFT、Config（選項的值不算畫面用字）',
    !/PersonID|PostID|HARD|SOFT|Config|Active|TeamID|P97\d\d/.test(v.text + v.title + v.buttons.map((b) => b.textContent).join('')), v.text.slice(0, 300));
  // 儲存：整份送給伺服器
  let sent = null;
  ui.callServerMutating = async function (name, q, payload) { sent = { name: name, q: q, payload: JSON.parse(JSON.stringify(payload)) }; return { message: '已儲存：影音組合。這一季已經有版本，新設定要按〔請系統幫我調整〕之後才會反映。' }; };
  v.buttons.filter((b) => b.textContent === '儲存')[0].fire('click');
  setTimeout(() => {
    check('★★★★★★ 〔儲存〕呼叫 apiSaveRuleExtras，送出畫面上的全部三段', sent && sent.name === 'apiSaveRuleExtras' && sent.q === '2099T1'
      && sent.payload.teams[0].teamId === '示範組' && sent.payload.teams[0].members.length === 2 && sent.payload.singers.length === 2 && sent.payload.choir[0].postId === 'READ', JSON.stringify(sent));
    const done = view();
    check('★★★★★★ 儲存之後視窗顯示伺服器的訊息（包括「這一季已經有版本…」提示）和〔完成〕', /這一季已經有版本，新設定要按〔請系統幫我調整〕之後才會反映/.test(done.text) && done.buttons.some((b) => b.textContent === '完成'), done.text);

    // 只可查看：全部唯讀、沒有儲存／加／移除
    vm.runInContext('viewOnly_ = true;', ui);
    ui.renderRuleExtras_(data);
    const ro = view();
    const roBodyButtons = ro.all.filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    const controls = ro.all.filter((n) => ['SELECT', 'INPUT'].indexOf(n.tagName) !== -1);
    check('★★★★★★ 只可查看：說明「你只有查看權限」；所有下拉、輸入、勾選都是 disabled', /你只有查看權限，下面全部只可以看/.test(ro.text) && controls.length > 0 && controls.every((n) => n.disabled === true), controls.filter((n) => !n.disabled).length);
    check('★★★★★★ 只可查看：沒有〔儲存〕、加、移除按鈕，只有〔關閉〕', roBodyButtons.length === 0 && !ro.buttons.some((b) => b.textContent === '儲存') && ro.buttons.some((b) => b.textContent === '關閉'), JSON.stringify(ro.buttons.map((b) => b.textContent)));
    // 資料有問題／工作表未建立／格式不對的例外
    vm.runInContext('viewOnly_ = false;', ui);
    ui.renderRuleExtras_(Object.assign({}, data, { problems: ['影音組合「錯組」：名單上找不到「P9799」這個人——這一行的「影音組合」規則這一次不會生效'], sheetsReady: false, choirInvalid: ['X1'], teams: [], singers: [], choir: [] }));
    const pv = view();
    check('★★★★★ 現有資料問題逐項列出；工作表未建立有說明；格式不對的例外會移除；空的三段有「現在沒有…」', /現有資料有 1 項問題/.test(pv.text) && /名單上找不到/.test(pv.text) && /第一次儲存時會自動建立/.test(pv.text)
      && /詩班獻詩日的例外設定有 1 項格式不對（X1），儲存時會移除/.test(pv.text) && /現在沒有影音組合/.test(pv.text) && /現在沒有協唱/.test(pv.text) && /現在沒有例外/.test(pv.text), pv.text.slice(0, 400));
    // 畫面原始碼沒有程式用字
    const z2 = read('src/ui/ScriptZone2.html');
    const block = z2.slice(z2.indexOf('第一百一十二輪批次 UD 組：〔影音組合及協唱〕\n'), z2.indexOf('/** 第一百零一輪批次 ZC-3：合併後的按鈕名稱'));
    const strings = (block.match(/'[^'\n]*[一-鿿][^'\n]*'/g) || []);
    check('★★★★★★ 畫面原始碼：所有中文字串都沒有 PersonID、PostID、HARD、SOFT、Config、Active', strings.length > 30 && strings.every((s) => !/PersonID|PostID|HARD|SOFT|Config|Active|TeamID/.test(s)), strings.filter((s) => BAD_WORDS.test(s)).join('｜'));
    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exitCode = fail === 0 ? 0 : 1;
  }, 50);
}
