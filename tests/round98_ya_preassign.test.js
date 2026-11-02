// 第九十八輪批次 YA 組：開季前準備〔預先安排領詩、司琴〕。
// 執行方式：node tests/round98_ya_preassign.test.js
//
//   YA1 Config PREASSIGN_POST_IDS（LIST，預設 WORSHIP,PIANO；只留 Posts 上有的）；AssignSource PREASSIGNED 算人手
//   YA2 畫面：每個主日一行、每個崗位一欄；選項＝崗位名單上的人；合堂主日灰色「合堂」不可以填；說明句
//   YA3 儲存：PreAssignments 第一次自動建立（第 1 行中文標題、第 2 行機器鍵）；不合法 ⇒ 甚麼都不寫；AuditLog；
//       讀取／儲存的權限分類；儲存會更新人手檢查（STAFFING_AFFECTING_CALLS）
//   YA4 生成：預先安排的格直接放入（PREASSIGNED，「其他」的名字沒有 PersonID）；同日不兼任先保留他們
//   YA5 人手檢查 readSameDayFixedCells_：未有版本 ⇒ 讀預先安排；有版本 ⇒ 版本＋版本上還沒有的預先安排
//   YA6 生成之後再改：狀態卡黃框；〔請系統幫我調整〕建議改成預先安排的人（「依開季前預先安排」），改其他格避開
//       同日兼任；預先安排空白 ⇒ 不改有人的格；〔儲存〕不會自動改格
//   YA7 義工申報確認畫面：「這一日已預先安排他做領詩」
//   YA8 季前資料：第五段之後「六、預先安排的領詩、司琴」
//   YA9 週報系統說明有新工作表、新 AssignSource、view=preassign
//   YA10 前端：按鈕在〔詩班獻詩〕旁邊；畫面下拉有「其他（自己輸入）」；〔儲存〕送出每一格
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { buildUnavailableScene, T1 } = require('./helpers/unavailable_scene.js');
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
const EXPLANATION = '這裏填的人會直接放入職事表，系統排其他崗位時會避開他們同日的其他崗位。'
  + '生成之後再改也可以，按〔請系統幫我調整〕或〔儲存〕時會用最新的安排。';

/** 按某一欄的值找一行，改另一欄。 */
function setField(sc, sheetName, keyField, keyValue, field, value) {
  const sh = sc.ss.getSheetByName(sheetName);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const kc = keys.indexOf(keyField) + 1;
  const fc = keys.indexOf(field) + 1;
  if (kc === 0 || fc === 0) throw new Error('沒有欄 ' + keyField + '／' + field);
  for (let r = 3; r <= sh.getLastRow(); r++) {
    const v = sh.getRange(r, kc).getValue();
    const text = v instanceof Date || Object.prototype.toString.call(v) === '[object Date]' ? sc.gas.toDateString_(v, sc.TZ) : String(v);
    if (text === keyValue) { sh.getRange(r, fc).setValue(value); return; }
  }
  throw new Error('找不到 ' + keyValue);
}

function scene() {
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.readWeightsForQuarterTune_ = () => ({ rows: [] });
  // 領詩改為人手填（同現場一樣）；同日不兼任開
  setField(sc, sc.S.POSTS, sc.C.POSTS.POST_ID, 'WORSHIP', sc.C.POSTS.AUTO_GENERATE, false);
  setField(sc, sc.S.RULE_SETTINGS, sc.C.RULE_SETTINGS.RULE_ID, 'HARD_SAME_DAY_EXCLUSIVE', sc.C.RULE_SETTINGS.ENABLED, true);
  const RS = sc.C.RULE_SETTINGS;
  sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
    [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
  sc.setCombined = (date, kind) => {
    const sh = sc.ss.getSheetByName(sc.S.SERVICE_DATES);
    g.ensureServiceDatesCombinedColumns_(sh);
    setField(sc, sc.S.SERVICE_DATES, sc.C.SERVICE_DATES.SERVICE_DATE, date, sc.C.SERVICE_DATES.COMBINED_KIND, kind);
  };
  sc.save = (cells) => g.apiSavePreAssignments(sc.Q, cells);
  sc.preRows = () => {
    const sh = sc.ss.getSheetByName(sc.S.PRE_ASSIGNMENTS);
    return sh ? g.readSheet_(sc.S.PRE_ASSIGNMENTS) : null;
  };
  sc.v0 = (date, post) => sc.cellRow(0, date, post);
  return sc;
}
const W = (date, personId, freeText) => ({ serviceDate: date, postId: 'WORSHIP', slotIndex: 1, personId: personId || '', freeText: freeText || '' });

console.log('\n=== YA1：Config、AssignSource ===');
{
  const sc = scene();
  const g = sc.gas;
  check('★★★★★ Config 鍵 PREASSIGN_POST_IDS', g.CONFIG_KEYS.PREASSIGN_POST_IDS === 'PREASSIGN_POST_IDS');
  check('★★★★★ ConfigSeed：LIST、預設 WORSHIP,PIANO',
    /key: CONFIG_KEYS\.PREASSIGN_POST_IDS, type: CONFIG_TYPES\.LIST[\s\S]{0,80}defaultValue: 'WORSHIP,PIANO'/.test(read('src/ConfigSeed.gs')));
  check('★★★★★★ 沒有 Config 行 ⇒ 用程式預設值；只留 Posts 上有的（這裏沒有司琴 ⇒ 只有領詩）',
    JSON.stringify(g.readPreAssignPosts_().map((p) => p.postId)) === '["WORSHIP"]', JSON.stringify(g.readPreAssignPosts_()));
  check('★★★★★★ AssignSource PREASSIGNED，算人手（不算「系統自己排了人手崗位」）',
    g.ASSIGN_SOURCE.PREASSIGNED === 'PREASSIGNED' && g.HUMAN_ASSIGN_SOURCES.indexOf('PREASSIGNED') !== -1
    && g.isNoAutoGenerateViolation_({ autoGenerate: false, frequency: 'WEEKLY' }, 'PREASSIGNED') === false);
  sc.appendRows(sc.ss, sc.S.CONFIG, [sc.C.CONFIG.KEY, sc.C.CONFIG.VALUE, sc.C.CONFIG.TYPE],
    [{ [sc.C.CONFIG.KEY]: 'PREASSIGN_POST_IDS', [sc.C.CONFIG.VALUE]: 'CHAIR,WORSHIP', [sc.C.CONFIG.TYPE]: 'LIST' }]);
  if (g.clearConfigCache_) g.clearConfigCache_();
  const v = g.apiGetPreAssignView(sc.Q);
  check('★★★★★★ 換崗位只改 Config（CHAIR,WORSHIP）⇒ 畫面兩欄，名稱讀 Posts，不用改程式',
    v.posts.map((p) => p.postNameTC).join('／') === '主席／領詩', JSON.stringify(v.posts.map((p) => p.postId)));
  check('★★★★ 新工作表名 PreAssignments、八個機器鍵', g.SHEETS.PRE_ASSIGNMENTS === 'PreAssignments'
    && g.preAssignmentKeys_().join(',') === 'QuarterID,ServiceDate,PostID,SlotIndex,PersonID,FreeText,UpdatedAt,UpdatedBy');
}

console.log('\n=== YA2：畫面 ===');
{
  const sc = scene();
  const g = sc.gas;
  sc.setCombined(T1[3], 'COMBINED');
  const v = g.apiGetPreAssignView(sc.Q);
  check('★★★★★★ 打開畫面不會建立工作表', !sc.ss.getSheetByName(sc.S.PRE_ASSIGNMENTS));
  check('★★★★★★ 說明句（逐字）', v.explanation === EXPLANATION, v.explanation);
  check('★★★★★ 每個崗位一欄（崗位名稱讀 Posts）', v.posts.length === 1 && v.posts[0].postNameTC === '領詩', JSON.stringify(v.posts));
  check('★★★★★★ 選項＝領詩名單上的人（P9701–P9703）',
    v.posts[0].options.map((o) => o.personId).sort().join(',') === 'P9701,P9702,P9703', JSON.stringify(v.posts[0].options));
  check('★★★★★ 每個主日一行', v.weeks.map((w) => w.serviceDate).join(',') === T1.join(','));
  check('★★★★★★ 合堂主日灰色「合堂」；其他主日可以填', v.weeks[3].cells[0].blocked === '合堂'
    && v.weeks.slice(0, 3).every((w) => w.cells[0].blocked === ''), JSON.stringify(v.weeks.map((w) => w.cells)));
}

console.log('\n=== YA3：儲存 ===');
{
  const sc = scene();
  const g = sc.gas;
  sc.setCombined(T1[3], 'COMBINED');
  const bad = sc.save([W(T1[0], 'P9999')]);
  check('★★★★★★ 名單上找不到的人 ⇒ 不儲存、甚麼都沒有寫（連工作表都沒有建立）', bad.ok === false && !sc.ss.getSheetByName(sc.S.PRE_ASSIGNMENTS),
    JSON.stringify(bad));
  const comb = sc.save([W(T1[0], 'P9701'), W(T1[3], 'P9702')]);
  check('★★★★★★ 合堂主日填了人 ⇒ 整批不儲存', comb.ok === false && /合堂主日/.test(comb.message) && !sc.ss.getSheetByName(sc.S.PRE_ASSIGNMENTS),
    JSON.stringify(comb));
  const ok = sc.save([W(T1[0], 'P9701'), W(T1[1], '', '外請甲'), W(T1[2], '', '')]);
  check('★★★★★★ 儲存成功，改了 2 格（空白的格不寫）', ok.ok === true && ok.changed === 2, JSON.stringify(ok).slice(0, 300));
  const sh = sc.ss.getSheetByName(sc.S.PRE_ASSIGNMENTS);
  check('★★★★★★ 第一次儲存自動建立 PreAssignments：第 1 行中文標題、第 2 行機器鍵', sh
    && sh.getRange(1, 1).getValue() === '季度' && sh.getRange(2, 1, 1, 8).getValues()[0].join(',') === g.preAssignmentKeys_().join(','));
  const pre = g.readPreAssignments_(sc.Q, sc.TZ);
  check('★★★★★★ 讀回：P9701、「其他」名字', pre[T1[0] + '|WORSHIP|1'].personId === 'P9701' && pre[T1[1] + '|WORSHIP|1'].freeText === '外請甲'
    && Object.keys(pre).length === 2, JSON.stringify(pre));
  const audits = sc.audits('PRE_ASSIGN_SAVED');
  check('★★★★★ AuditLog PRE_ASSIGN_SAVED（改了幾格）', audits.length === 1 && String(audits[0][sc.C.AUDIT_LOG.NEW_VALUE]) === '2');
  const again = sc.save([W(T1[0], 'P9701'), W(T1[1], '', '外請甲')]);
  check('★★★★ 再儲存同樣內容 ⇒ 沒有改動、不多寫 AuditLog', again.ok && again.changed === 0 && sc.audits('PRE_ASSIGN_SAVED').length === 1);
  const clear = sc.save([W(T1[1], '', '')]);
  check('★★★★★ 清空一格 ⇒ 那一格不再算預先安排', clear.changed === 1 && !g.readPreAssignments_(sc.Q, sc.TZ)[T1[1] + '|WORSHIP|1']);
  sc.setCombined(T1[0], 'COMBINED');
  check('★★★★★ 先填、之後才設合堂 ⇒ 那一格不算（生成、調整都不會放入）', !g.readPreAssignments_(sc.Q, sc.TZ)[T1[0] + '|WORSHIP|1']);
  const ui = read('src/ui/Script.html');
  const wa = read('src/WebApp.gs');
  check('★★★★★★ 讀取畫面在兩份唯讀清單（WebApp.gs、Script.html）', /'apiGetPreAssignView'/.test(wa) && /'apiGetPreAssignView'/.test(ui));
  check('★★★★★★ 儲存不在唯讀清單；在 STAFFING_AFFECTING_CALLS', !/'apiSavePreAssignments'/.test(wa)
    && /STAFFING_AFFECTING_CALLS = \[[\s\S]*?'apiSavePreAssignments'\]/.test(ui));
  const src = read('src/PreAssign.gs');
  check('★★★★★ api 分類：讀取 assertWebAppRequestAllowed_(\'apiGetPreAssignView\')；儲存 assertWebAppRequestAllowed_()＋withMutationLock_',
    /function apiGetPreAssignView\(quarterId\) \{\n  assertWebAppRequestAllowed_\('apiGetPreAssignView'\);/.test(src)
    && /function apiSavePreAssignments\(quarterId, cells\) \{\n  assertWebAppRequestAllowed_\(\);\n  return withMutationLock_\(/.test(src));
}

console.log('\n=== YA4：生成 ===');
{
  const sc = scene();
  const g = sc.gas;
  // 第 1 週主席：除了 P9701 其他人都不能做 ⇒ 沒有保留的話一定排 P9701
  const U = sc.C.UNAVAILABLE;
  sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), ['P9702', 'P9703', 'P9704', 'P9705', 'P9707'].map((p, i) => ({
    [U.UNAVAILABLE_ID]: 'UX' + i, [U.PERSON_ID]: p, [U.DATE_FROM]: T1[0], [U.DATE_TO]: T1[0], [U.SOURCE]: 'WEB', [U.STATUS]: 'ACTIVE',
    [U.APPLIES_TO]: 'POSTS', [U.POST_IDS]: 'CHAIR' })));
  sc.save([W(T1[0], 'P9701'), W(T1[1], '', '外請甲')]);
  g.apiGenerateDraftExecute(sc.Q);
  const A = sc.A;
  const w0 = sc.v0(T1[0], 'WORSHIP');
  check('★★★★★★ 預先安排的人直接放入（AssignSource＝PREASSIGNED）', w0 && w0[A.PERSON_ID] === 'P9701' && w0[A.ASSIGN_SOURCE] === 'PREASSIGNED',
    JSON.stringify(w0));
  const w1 = sc.v0(T1[1], 'WORSHIP');
  check('★★★★★★ 「其他（自己輸入）」的名字：沒有 PersonID、名字在 PersonNameSnapshot', w1 && !w1[A.PERSON_ID]
    && w1[A.PERSON_NAME_SNAPSHOT] === '外請甲' && w1[A.ASSIGN_SOURCE] === 'PREASSIGNED', JSON.stringify(w1));
  const w2 = sc.v0(T1[2], 'WORSHIP');
  check('★★★★★ 沒有預先安排的週 ⇒ 照舊留空待填', w2 && !w2[A.PERSON_ID] && w2[A.ASSIGN_SOURCE] === 'SKIPPED');
  const day0 = sc.rows(0).filter((r) => g.toDateString_(r[A.SERVICE_DATE], sc.TZ) === T1[0] && r[A.PERSON_ID] === 'P9701');
  check('★★★★★★ 同日不兼任：P9701 那一日沒有其他崗位（主席寧願留空）', day0.length === 1 && day0[0][A.POST_ID] === 'WORSHIP',
    JSON.stringify(day0.map((r) => r[A.POST_ID])));
  const ctx = { sameDayExclusivePostIds: ['WORSHIP', 'PIANO'], rules: {}, posts: [], existingAssignments: {},
    preAssignments: { [T1[0] + '|WORSHIP|1']: { serviceDate: T1[0], postId: 'WORSHIP', slotIndex: 1, personId: 'P9702', freeText: '' } } };
  check('★★★★★★ buildSameDayReservedForWeek_ 保留預先安排的人', g.buildSameDayReservedForWeek_(ctx, { serviceDate: T1[0] },
    { skipPostIds: [], lockPostIds: [] }).P9702 === 'WORSHIP');
  check('★★★★ 那一日不設那個崗位 ⇒ 不保留', !g.buildSameDayReservedForWeek_(ctx, { serviceDate: T1[0] },
    { skipPostIds: ['WORSHIP'], lockPostIds: [] }).P9702);
  check('★★★★★ 特別主日 SkipPostIDs 的格不放入；NO_AUTO_GENERATE 的格放入',
    g.findPreAssignedCell_(ctx, { serviceDate: T1[0], postId: 'WORSHIP', slotIndex: 1 }, { ruleId: g.RULE_IDS.SPECIAL_SUNDAY_SKIP }) === null
    && g.findPreAssignedCell_(ctx, { serviceDate: T1[0], postId: 'WORSHIP', slotIndex: 1 }, { ruleId: g.RULE_IDS.NO_AUTO_GENERATE }).personId === 'P9702');
}

console.log('\n=== YA5：人手檢查讀預先安排 ===');
{
  const sc = scene();
  const g = sc.gas;
  sc.save([W(T1[0], 'P9701'), W(T1[1], '', '外請甲')]);
  const before = g.readSameDayFixedCells_(sc.Q, ['WORSHIP', 'PIANO'], sc.TZ);
  check('★★★★★★ 未有版本 ⇒ 讀預先安排（有 PersonID 的）', JSON.stringify(before) === JSON.stringify([{ serviceDate: T1[0], postId: 'WORSHIP', personId: 'P9701' }]),
    JSON.stringify(before));
  g.apiGenerateDraftExecute(sc.Q);
  sc.save([W(T1[0], 'P9701'), W(T1[2], 'P9702')]);
  const after = g.readSameDayFixedCells_(sc.Q, ['WORSHIP', 'PIANO'], sc.TZ);
  check('★★★★★★ 有版本 ⇒ 版本上的（P9701）＋版本上還沒有的預先安排（P9702），不重複',
    after.filter((f) => f.personId === 'P9701' && f.serviceDate === T1[0]).length === 1
    && after.some((f) => f.personId === 'P9702' && f.serviceDate === T1[2]), JSON.stringify(after));
}

console.log('\n=== YA6：生成之後再改 ===');
{
  const sc = scene();
  const g = sc.gas;
  sc.save([W(T1[0], 'P9701')]);
  g.apiGenerateDraftExecute(sc.Q);
  check('★★★★★ 生成後表上和預先安排一樣 ⇒ 沒有黃框', g.summarisePreAssignMismatch_(sc.Q, 0).count === 0);
  // 改預先安排：第 1 週領詩改 P9702；P9702 在表上那一日做主席（人手改，沒有勾保留）
  sc.save([W(T1[0], 'P9702')]);
  sc.setCell(0, T1[0], 'CHAIR#1', sc.PEOPLE.P9702);
  const mm = g.summarisePreAssignMismatch_(sc.Q, 0);
  check('★★★★★★ 狀態卡黃框句（逐字）', mm.count === 1 && mm.text === '預先安排的領詩有 1 格和職事表不同，按〔請系統幫我調整〕更新。', JSON.stringify(mm));
  check('★★★★★ 主畫面資料有 preAssignMismatch；狀態卡用 buildPlainWarnNodes 顯示',
    /preAssignMismatch: preAssignMismatch/.test(read('src/WebAppDashboard.gs'))
    && /\.concat\(buildPlainWarnNodes\(d\.preAssignMismatch\)\)/.test(read('src/ui/Script.html')));
  const built = g.buildSuggestionState_(sc.Q, { versionNo: 0, source: g.SUGGESTION_START.GRID }, []);
  const st = built.state;
  const at = (date, post) => st.filter((s) => s.serviceDate === date && s.postId === post)[0];
  check('★★★★★★ 建議：第 1 週領詩改成預先安排的 P9702', at(T1[0], 'WORSHIP').personId === 'P9702', JSON.stringify(at(T1[0], 'WORSHIP')));
  const fx = built.systemFixes.filter((f) => f.serviceDate === T1[0] && f.postNameTC === '領詩')[0];
  check('★★★★★★ 原因「依開季前預先安排」，原本 → 改成', fx && fx.reason === '依開季前預先安排' && fx.fromName === sc.PEOPLE.P9701
    && fx.toName === sc.PEOPLE.P9702, JSON.stringify(built.systemFixes));
  const p9702Day = st.filter((s) => s.serviceDate === T1[0] && s.personId === 'P9702').map((s) => s.postId);
  check('★★★★★★ 同日兼任：系統改走 P9702 那一日的主席', JSON.stringify(p9702Day) === '["WORSHIP"]', JSON.stringify(p9702Day));
  check('★★★★★ 那一格當作系統改的格（計入 systemCount）', !!built.systemKeys[T1[0] + '|WORSHIP|1']);
  // 預先安排空白 ⇒ 不改有人的格
  const state = [{ serviceDate: T1[2], postId: 'WORSHIP', slotIndex: 1, personId: 'P9703', freeText: '' }];
  check('★★★★★★ 預先安排空白 ⇒ 有人的格不算不同', g.listPreAssignMismatches_({}, state).length === 0);
  check('★★★★★ 「其他」名字一樣 ⇒ 不算不同；不同名字 ⇒ 不同',
    g.listPreAssignMismatches_({ [T1[2] + '|WORSHIP|1']: { serviceDate: T1[2], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請甲' } },
      [{ serviceDate: T1[2], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請甲' }]).length === 0
    && g.listPreAssignMismatches_({ [T1[2] + '|WORSHIP|1']: { serviceDate: T1[2], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請甲' } },
      [{ serviceDate: T1[2], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請乙' }]).length === 1);
  check('★★★★★ 〔儲存〕（WebAppSaveConfirm.gs）不會讀預先安排去改格', !/PreAssign|preAssign/.test(read('src/WebAppSaveConfirm.gs')));
}

console.log('\n=== YA7：義工申報確認畫面 ===');
{
  const sc = scene();
  const g = sc.gas;
  sc.save([W(T1[0], 'P9701')]);
  const all = [{ submissionId: 'S1', personId: 'P9701', serviceDate: T1[0], status: 'PENDING', postIds: '', reason: '', submittedAt: '', late: false },
    { submissionId: 'S2', personId: 'P9702', serviceDate: T1[0], status: 'PENDING', postIds: '', reason: '', submittedAt: '', late: false }];
  const view = g.buildUnavailableConfirmView_(all, { P9701: '假甲', P9702: '假乙' }, {}, true, sc.Q, g.buildPreAssignNoteLookup_(all, sc.TZ));
  const item = (pid) => view.pending.filter((p) => p.personId === pid)[0].items[0];
  check('★★★★★★ 預先安排了的人那一日：「這一日已預先安排他做領詩」', item('P9701').preAssignNote === '這一日已預先安排他做領詩', JSON.stringify(item('P9701')));
  check('★★★★★ 其他人沒有這一句', item('P9702').preAssignNote === '');
  check('★★★★ 前端顯示這一句', /if \(it\.preAssignNote\) line\.appendChild/.test(read('src/ui/ScriptZone3.html')));
}

console.log('\n=== YA8：季前資料 ===');
{
  const sc = scene();
  const g = sc.gas;
  let pack = g.buildPreseasonPack_(sc.Q, '2098-12-10', '2098-12-20');
  const sec = (p) => p.sections.filter((s) => s.title === '六、預先安排的領詩、司琴')[0];
  check('★★★★★★ 第五段之後「六、預先安排的領詩、司琴」；沒有 ⇒「沒有」', pack.sections[5].title === '六、預先安排的領詩、司琴'
    && sec(pack).lines.join() === '沒有' && pack.sections[6].title === '七、人手檢查', pack.sections.map((s) => s.title).join('／'));
  sc.save([W(T1[0], 'P9701'), W(T1[1], '', '外請甲')]);
  pack = g.buildPreseasonPack_(sc.Q, '2098-12-10', '2098-12-20');
  check('★★★★★★ 每個主日一行', JSON.stringify(sec(pack).lines) === JSON.stringify([T1[0] + '　領詩：' + sc.PEOPLE.P9701, T1[1] + '　領詩：外請甲']),
    JSON.stringify(sec(pack).lines));
}

console.log('\n=== YA9：週報系統說明 ===');
{
  const doc = read('docs/週報系統讀取職事表資料說明.md');
  check('★★★★★ 新 AssignSource PREASSIGNED（第 3 節及第 9 節）', /`PREASSIGNED`（開季前〔預先安排領詩、司琴〕/.test(doc) && /\| 第九十八輪 \|/.test(doc));
  check('★★★★★ 新工作表 PreAssignments 及欄位', /`PreAssignments`/.test(doc) && /`FreeText`/.test(doc));
  check('★★★★ view=preassign', /\| `preassign` \| 〔預先安排領詩、司琴〕/.test(doc));
}

console.log('\n=== YA10：前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone2.html']);
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★ 〔預先安排領詩、司琴〕在〔詩班獻詩〕旁邊', /button\('詩班獻詩', \(\) => openChoirSinging\(\), ''\),\n[^\n]*\n\s*button\(PREASSIGN_BUTTON_LABEL, \(\) => openPreAssign\(\), ''\)/.test(z2)
    && vm.runInContext('PREASSIGN_BUTTON_LABEL', ui) === '預先安排領詩、司琴');
  check('★★★★★ 深連結 view=preassign', typeof vm.runInContext('DEEP_LINK_VIEWS', ui).preassign === 'function');
  const data = { quarterId: '2099T1', quarterLabel: '2099 第一季', explanation: EXPLANATION,
    posts: [{ postId: 'WORSHIP', postNameTC: '領詩', slotCount: 1, options: [{ personId: 'P9701', nameTC: '假甲' }] }],
    weeks: [{ serviceDate: T1[0], cells: [{ postId: 'WORSHIP', slotIndex: 1, personId: 'P9701', freeText: '', blocked: '' }] },
      { serviceDate: T1[1], cells: [{ postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請甲', blocked: '' }] },
      { serviceDate: T1[2], cells: [{ postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '', blocked: '合堂' }] }] };
  let sent = null;
  vm.runInContext("currentQuarterId = '2099T1'", ui);
  ui.callServerMutating = async function (name, q, cells) { sent = { name: name, q: q, cells: cells }; return { ok: true, changed: 1, message: '已儲存（改了 1 格）。' }; };
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.renderPreAssign_(data);
  const body = ui.document.getElementById('modalBody');
  const nodes = body.flatten();
  const selects = nodes.filter((n) => n.tagName === 'SELECT');
  check('★★★★★★ 說明句、合堂格灰色字「合堂」（沒有下拉）', body.textContent.indexOf(EXPLANATION) !== -1
    && nodes.some((n) => /preassign-blocked/.test(n.className) && n.textContent === '合堂') && selects.length === 2, body.textContent.slice(0, 300));
  check('★★★★★★ 下拉：（空白）、名單上的人、其他（自己輸入）', selects[0].children.map((o) => o.textContent).join('／') === '（空白）／假甲／其他（自己輸入）');
  const inputs = nodes.filter((n) => n.tagName === 'INPUT');
  check('★★★★★ 「其他」的格顯示輸入框（有名字）；選了人的格輸入框收起', inputs[0].hidden === true && inputs[1].hidden === false && inputs[1].value === '外請甲');
  selects[0].value = '__OTHER__';
  selects[0].fire('change');
  check('★★★★ 改選「其他」⇒ 輸入框出現', inputs[0].hidden === false);
  inputs[0].value = '外請乙';
  const acts = ui.document.getElementById('modalActions').flatten();
  const saveBtn = acts.filter((n) => n.tagName === 'BUTTON' && n.textContent === '儲存')[0];
  saveBtn.fire('click');
  setTimeout(() => {
    check('★★★★★★ 〔儲存〕用 callServerMutating 送出可以填的每一格（合堂格不送）', sent && sent.name === 'apiSavePreAssignments'
      && JSON.stringify(sent.cells) === JSON.stringify([{ serviceDate: T1[0], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請乙' },
        { serviceDate: T1[1], postId: 'WORSHIP', slotIndex: 1, personId: '', freeText: '外請甲' }]), JSON.stringify(sent));
    console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAIL');
    process.exitCode = fail === 0 ? 0 : 1;
  }, 20);
}
process.on('exit', () => { if (fail > 0) process.exitCode = 1; });
