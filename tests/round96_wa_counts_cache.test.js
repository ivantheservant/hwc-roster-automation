// 第九十六輪批次 WA 組：狀態卡「第 3、4 步人數」按簽名快取。
// 執行方式：node tests/round96_wa_counts_cache.test.js
//
//   WA1 回傳值相同：快取關掉（OFF）、第一次（MISS）、第二次（HIT）的 apiGetDashboardState 除 timings 外深度相等
//   WA2 命中時不再計算（planResendChangedPersons_ 不叫）；有效期 6 小時
//   WA3 寄出一封之後人數即時改變（快取被清除／簽名改變，不會顯示舊數字）
//   WA4 簽名每一項改變都令快取失效：版本號、版本建立時間、階段、SendLog（多一行、改狀態）、派工、電郵、CellDecisions
//   WA5 快取壞了（拿不到、讀出錯、寫出錯、內容壞）⇒ 照舊計算，不出錯；算不到（出錯）⇒ 照舊回 0，而且不寫入快取
//   WA6 主動清除：寄出、補寄、重發、標記外部寄出、匯入、儲存、生成、重設、填講員翻譯、刪寄出紀錄、清孤兒版本；
//       任何寫 SendLog／RosterAssignments 的函式都要清除（新寫入入口沒有清除 ⇒ 這個測試失敗）
// 用假資料。

const fs = require('fs');
const path = require('path');
const { buildSendScene } = require('./helpers/send_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SELF = 'k@example.invalid';

function memCache() {
  const store = {};
  const ttl = {};
  return {
    store: store, ttl: ttl,
    api: {
      get: (k) => (store[k] === undefined ? null : store[k]),
      put: (k, v, s) => { store[k] = String(v); ttl[k] = s; },
      remove: (k) => { delete store[k]; }
    }
  };
}
// 只令「第 3、4 步人數」那一個快取壞（Config 等其他地方照常用 CacheService）
function countsOnly(bad, good) {
  return { getScriptCache: () => (/readDashboardCountsCached_/.test(new Error().stack.split('\n')[2] || '') ? bad() : good) };
}
const noCache = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) }.getScriptCache();
function strip(d) {
  const x = JSON.parse(JSON.stringify(d));
  delete x.timings;
  if (x.staffing) { delete x.staffing.ms; delete x.staffing.cached; }
  return JSON.stringify(x);
}

/** 已正式發出、之後改了一格並儲存的場景（第 3、4 步人數不是 0）。 */
function officialScene() {
  const sc = buildSendScene(SELF);
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = function () {};
  const mc = memCache();
  g.CacheService = { getScriptCache: () => mc.api };
  sc.mc = mc;
  const all = g.apiGetSendAllRecipients(sc.Q, 'OFFICIAL');
  g.apiStep4Confirm(sc.Q, { recipientScope: 'PICK', pickedKeys: all.pickedKeys, sendMode: 'ALL', attachType: 'NONE', includeIcs: false });
  const D = sc.DATES;
  const cur = sc.getCell(0, D[0], 'CHAIR#1');
  const other = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => n !== cur)[0];
  sc.setCell(0, D[0], 'CHAIR#1', other);
  sc.v = g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] }).versionNo;
  return sc;
}
const KEY = (sc) => 'dash_counts_v1_' + sc.Q;

console.log('\n=== WA1／WA2：回傳值相同、命中 ===');
{
  const sc = officialScene();
  const g = sc.gas;
  check('（前置）OFFICIAL_SENT、有新一版', g.getQuarterStage_(sc.Q) === 'OFFICIAL_SENT' && sc.v >= 1, sc.v);
  sc.mc.api.remove(KEY(sc));
  let plans = 0;
  const realPlan = g.planResendChangedPersons_;
  g.planResendChangedPersons_ = function () { plans++; return realPlan.apply(this, arguments); };
  // 快取關掉（舊路徑）
  g.CacheService = countsOnly(() => { throw new Error('沒有快取'); }, sc.mc.api);
  const off = g.apiGetDashboardState(sc.Q);
  g.CacheService = { getScriptCache: () => sc.mc.api };
  const miss = g.apiGetDashboardState(sc.Q);
  const plansAfterMiss = plans;
  const hit = g.apiGetDashboardState(sc.Q);
  check('（前置）第 3、4 步人數不是 0', off.buttons.resend && off.buttons.resend.changedPersonCount > 0 && off.buttons.official.targetPersonCount > 0,
    JSON.stringify(off.buttons.resend));
  check('★★★★★★ WA1 快取關掉（OFF）與第一次（MISS）回傳值相同', strip(off) === strip(miss));
  check('★★★★★★ WA1 命中（HIT）回傳值相同', strip(miss) === strip(hit));
  check('★★★★★ timings.countsCache：OFF → MISS → HIT', off.timings.countsCache === 'OFF' && miss.timings.countsCache === 'MISS' && hit.timings.countsCache === 'HIT',
    [off.timings.countsCache, miss.timings.countsCache, hit.timings.countsCache].join(','));
  check('★★★★★★ WA2 命中時不再計算（planResendChangedPersons_ 沒有再叫）', plans === plansAfterMiss && plansAfterMiss === 2, plans + ' ' + plansAfterMiss);
  check('★★★★★ WA2 有效期 6 小時（21600 秒）', sc.mc.ttl[KEY(sc)] === 21600, sc.mc.ttl[KEY(sc)]);
  const stored = JSON.parse(sc.mc.store[KEY(sc)]);
  check('★★★★ 快取的鍵＝季度，值裏面有簽名', !!stored.signature && stored.official && stored.resend);
  g.planResendChangedPersons_ = realPlan;
}

console.log('\n=== WA3：寄出一封之後即時改變 ===');
{
  const sc = officialScene();
  const g = sc.gas;
  const before = g.apiGetDashboardState(sc.Q);
  g.apiGetDashboardState(sc.Q);
  check('（前置）已經命中', g.apiGetDashboardState(sc.Q).timings.countsCache === 'HIT');
  const changed = g.planResendChangedPersons_(sc.Q).changed.filter((c) => c.arrangementChanged);
  check('（前置）有安排改了的人', changed.length > 0, JSON.stringify(changed.map((c) => c.personId)));
  // 寄出一封（同所有寄出一樣經 writeSendLogRows_ 寫 SendLog：這一位這一版的 hash）
  const ctx = g.buildMailContext_(sc.Q, sc.v, 'RESEND');
  const pa = ctx.assignmentsByPerson[changed[0].personId] || [];
  g.writeSendLogRows_([{ recipientType: 'PERSON', personId: changed[0].personId, email: 'x@example.invalid', displayName: 'x',
    hash: g.computeAssignmentHash_(pa), summary: '', attachmentName: '', status: 'DRY_RUN', messageId: '', errorMessage: '',
    intendedEmail: 'x@example.invalid', deliveredTo: '' }], { quarterId: sc.Q, versionNo: sc.v, stage: 'RESEND', sendDecision: null });
  check('★★★★★★ WA3 寄出時已清除快取', sc.mc.store[KEY(sc)] === undefined);
  const after = g.apiGetDashboardState(sc.Q);
  check('★★★★★★ WA3 寄出一封之後人數即時改變（少了一位）', after.buttons.resend.changedPersonCount === before.buttons.resend.changedPersonCount - 1
    && after.timings.countsCache === 'MISS', before.buttons.resend.changedPersonCount + ' → ' + after.buttons.resend.changedPersonCount);
  // 即使沒有清除（例如在其他地方改了表），簽名也會令舊值失效
  const stale = JSON.parse(sc.mc.store[KEY(sc)]);
  stale.resend = { total: 999, arrangementChanged: 999, notReceived: 0 };
  stale.signature = 'old-signature';
  sc.mc.store[KEY(sc)] = JSON.stringify(stale);
  const again = g.apiGetDashboardState(sc.Q);
  check('★★★★★★ WA3 快取的簽名和現在不同 ⇒ 不用（不會顯示 999）', again.buttons.resend.changedPersonCount === after.buttons.resend.changedPersonCount
    && again.timings.countsCache === 'MISS');
}

console.log('\n=== WA4：簽名每一項 ===');
{
  const sc = officialScene();
  const g = sc.gas;
  const C = sc.C;
  const sigNow = (sendRows) => {
    g.beginSheetReadMemo_();
    try {
      const sr = sendRows || g.readSendLogSummaryForDashboard_(sc.Q).signatureRows;
      return g.buildDashboardCountsSignature_(sc.Q, sc.v, g.getQuarterStage_(sc.Q), sr);
    } finally { g.endSheetReadMemo_(); }
  };
  const base = sigNow();
  check('（前置）簽名算得到、而且穩定', !!base && base === sigNow(), base);
  check('★★★★★ 不在讀表記憶範圍內 ⇒ 沒有簽名（不用快取）', g.buildDashboardCountsSignature_(sc.Q, sc.v, 'OFFICIAL_SENT', []) === '');
  check('★★★★★ 沒有 SendLog 的行（呼叫者沒有給）⇒ 沒有簽名', (function () {
    g.beginSheetReadMemo_(); try { return g.buildDashboardCountsSignature_(sc.Q, sc.v, 'OFFICIAL_SENT', null) === ''; } finally { g.endSheetReadMemo_(); }
  })());
  const variants = [];
  g.beginSheetReadMemo_();
  let sr;
  try { sr = g.readSendLogSummaryForDashboard_(sc.Q).signatureRows; } finally { g.endSheetReadMemo_(); }
  const sigWith = (fn) => { g.beginSheetReadMemo_(); try { return fn(); } finally { g.endSheetReadMemo_(); } };
  variants.push(['版本號', sigWith(() => g.buildDashboardCountsSignature_(sc.Q, sc.v - 1, 'OFFICIAL_SENT', sr))]);
  variants.push(['季度階段', sigWith(() => g.buildDashboardCountsSignature_(sc.Q, sc.v, 'REVIEW_SENT', sr))]);
  variants.push(['SendLog 多一行', sigWith(() => g.buildDashboardCountsSignature_(sc.Q, sc.v, 'OFFICIAL_SENT', sr.concat([['S-X', sc.v, 'RESEND', 'PERSON', 'P9701', 'h', 'SENT', '2099-01-02']])))]);
  variants.push(['SendLog 某一行改狀態', sigWith(() => g.buildDashboardCountsSignature_(sc.Q, sc.v, 'OFFICIAL_SENT', sr.map((r, i) => (i === 0 ? r.slice(0, 6).concat(['FAILED', r[7]]) : r))))]);
  check('（前置）基準簽名＝同一份 SendLog 行', sigWith(() => g.buildDashboardCountsSignature_(sc.Q, sc.v, 'OFFICIAL_SENT', sr)) === base);
  // 版本建立時間
  const V = C.ROSTER_VERSIONS;
  const vs = sc.ss.getSheetByName(sc.S.ROSTER_VERSIONS);
  const vkeys = vs.getRange(2, 1, 1, vs.getLastColumn()).getValues()[0];
  const setCellBy = (sheet, keys, matchCol, matchVal, col, val) => {
    for (let r = 3; r <= sheet.getLastRow(); r++) {
      if (String(sheet.getRange(r, keys.indexOf(matchCol) + 1).getValue()) === String(matchVal)) { const old = sheet.getRange(r, keys.indexOf(col) + 1).getValue(); sheet.getRange(r, keys.indexOf(col) + 1).setValue(val); return old; }
    }
    return null;
  };
  let rowV = null;
  for (let r = 3; r <= vs.getLastRow(); r++) {
    if (Number(vs.getRange(r, vkeys.indexOf(V.VERSION_NO) + 1).getValue()) === sc.v) rowV = r;
  }
  const oldCreated = vs.getRange(rowV, vkeys.indexOf(V.CREATED_AT) + 1).getValue();
  vs.getRange(rowV, vkeys.indexOf(V.CREATED_AT) + 1).setValue('2099-12-31 23:59:59');
  variants.push(['版本建立時間', sigNow()]);
  vs.getRange(rowV, vkeys.indexOf(V.CREATED_AT) + 1).setValue(oldCreated);
  check('（前置）還原後簽名回到基準', sigNow() === base);
  // 派工
  const D = sc.DATES;
  const A = C.ROSTER_ASSIGNMENTS;
  const as = sc.ss.getSheetByName(sc.S.ROSTER_ASSIGNMENTS);
  const akeys = as.getRange(2, 1, 1, as.getLastColumn()).getValues()[0];
  const pcol = akeys.indexOf(A.PERSON_ID) + 1;
  const oldP = as.getRange(3, pcol).getValue();
  as.getRange(3, pcol).setValue(oldP === 'P9706' ? 'P9707' : 'P9706');
  variants.push(['RosterAssignments 派工', sigNow()]);
  as.getRange(3, pcol).setValue(oldP);
  // 電郵
  const M = C.NAME_MAPPING;
  const nm = sc.ss.getSheetByName(sc.S.NAME_MAPPING);
  const nkeys = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0];
  const oldEmail = setCellBy(nm, nkeys, M.PERSON_ID, 'P9701', M.EMAIL, '');
  variants.push(['NameMapping 電郵', sigNow()]);
  setCellBy(nm, nkeys, M.PERSON_ID, 'P9701', M.EMAIL, oldEmail);
  check('（前置）還原電郵後簽名回到基準', sigNow() === base);
  // CellDecisions
  const CD = C.CELL_DECISIONS;
  const cdKeys = Object.keys(CD).map((k) => CD[k]);
  if (!sc.ss.getSheetByName(sc.S.CELL_DECISIONS)) require('./helpers/mock_sheets_realistic.js').seedSheet(sc.ss, sc.S.CELL_DECISIONS, cdKeys.map(() => ''), cdKeys, []);
  variants.push(['CellDecisions 工作表建立（沒有行）', sigNow()]);
  sc.appendRows(sc.ss, sc.S.CELL_DECISIONS, cdKeys, [{ [CD.DECISION_ID]: 'CD1', [CD.QUARTER_ID]: sc.Q,
    [CD.SERVICE_DATE]: D[0], [CD.POST_ID]: 'CHAIR', [CD.SLOT_INDEX]: 1, [CD.KIND]: 'KEEP', [CD.STATUS]: 'ACTIVE' }]);
  variants.push(['CellDecisions', sigNow()]);
  variants.forEach(([label, sig]) => check('★★★★★★ WA4 「' + label + '」改變 ⇒ 簽名不同（快取失效）', !!sig && sig !== base, sig));
}

console.log('\n=== WA5：快取壞了、算不到 ===');
{
  const sc = officialScene();
  const g = sc.gas;
  const good = strip(g.apiGetDashboardState(sc.Q));
  const cases = [
    ['拿不到快取', countsOnly(() => { throw new Error('x'); }, noCache)],
    ['讀快取出錯', countsOnly(() => ({ get: () => { throw new Error('x'); }, put: () => {}, remove: () => {} }), noCache)],
    ['寫快取出錯', countsOnly(() => ({ get: () => null, put: () => { throw new Error('x'); }, remove: () => {} }), noCache)],
    ['快取內容壞了', countsOnly(() => ({ get: () => '{壞', put: () => {}, remove: () => {} }), noCache)]
  ];
  cases.forEach(([label, cs]) => {
    g.CacheService = cs;
    let d = null;
    let err = '';
    try { d = g.apiGetDashboardState(sc.Q); } catch (e) { err = e.message; }
    check('★★★★★★ WA5 ' + label + ' ⇒ 照舊計算，結果一樣、不出錯', d && strip(d) === good, err);
  });
  g.CacheService = { getScriptCache: () => sc.mc.api };
  sc.mc.api.remove(KEY(sc));
  const realPlan = g.planResendChangedPersons_;
  g.planResendChangedPersons_ = function () { throw new Error('讀不到'); };
  const d = g.apiGetDashboardState(sc.Q);
  g.planResendChangedPersons_ = realPlan;
  check('★★★★★★ WA5 算不到 ⇒ 和以前一樣回 0', d.buttons.resend.changedPersonCount === 0);
  check('★★★★★★ WA5 算不到 ⇒ 不寫入快取（下一次重新計算）', sc.mc.store[KEY(sc)] === undefined);
  check('★★★★ 沒有版本 ⇒ 不用快取（0、OFF）', (function () {
    const r = g.readDashboardCountsCached_('2099T9', -1, false, 'DRAFT', []);
    return r.cache === 'OFF' && r.official.total === 0 && r.resend.total === 0;
  })());
  check('★★★★ 清除時拿不到快取也不拋錯', (function () {
    g.CacheService = { getScriptCache: () => { throw new Error('x'); } };
    try { g.clearDashboardCountsCache_(sc.Q); return true; } catch (e) { return false; } finally { g.CacheService = { getScriptCache: () => sc.mc.api }; }
  })());
}

console.log('\n=== WA6：主動清除 ===');
{
  // 真入口：儲存、生成、重設
  const sc = officialScene();
  const g = sc.gas;
  const warm = () => { g.apiGetDashboardState(sc.Q); return sc.mc.store[KEY(sc)] !== undefined; };
  check('（前置）有快取', warm());
  sc.setCell(sc.v, sc.DATES[1], 'CHAIR#1', sc.getCell(sc.v, sc.DATES[2], 'CHAIR#1'));
  g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ WA6 儲存之後快取已清除', sc.mc.store[KEY(sc)] === undefined);
  check('（前置）有快取', warm());
  g.clearDashboardCountsCache_(sc.Q);
  check('★★★★★ clearDashboardCountsCache_ 清除該季', sc.mc.store[KEY(sc)] === undefined);

  const bodyOf = (text, name) => {
    const i = text.indexOf('function ' + name + '(');
    if (i === -1) return '';
    const j = text.indexOf('\nfunction ', i + 10);
    return text.slice(i, j === -1 ? text.length : j);
  };
  const entries = [
    ['Mailer.gs', 'sendStage_', '寄出（寄審閱、正式發出）'],
    ['Mailer.gs', 'writeSendLogRows_', '寫 SendLog（每一種寄出）'],
    ['ResendFlow.gs', 'sendResendStage_', '改動後重發'],
    ['MakeupSend.gs', 'executeMakeupSend_', '補寄'],
    ['RosterImport.gs', 'writeExternalSendBaseline_', '標記外部寄出'],
    ['RosterImport.gs', 'apiImportRosterExecute_locked_', '匯入'],
    ['WebAppSaveConfirm.gs', 'apiSaveAndConfirmExecute_locked_', '儲存'],
    ['MultiRun.gs', 'performRosterGeneration_', '生成'],
    ['RosterWriter.gs', 'writeAssignments_', '寫派工（生成、儲存、調整、匯入）'],
    ['QuarterReset.gs', 'executeQuarterReset_', '整季重設'],
    ['PreacherTranslationFill.gs', 'apiSavePreacherTranslationEntry_locked_', '填講員翻譯'],
    ['SendLogMaintenance.gs', 'deleteSendLogBatch_', '刪寄出紀錄'],
    ['OrphanVersions.gs', 'executeOrphanVersionCleanup_', '清孤兒版本']
  ];
  entries.forEach(([f, fn, label]) => {
    check('★★★★★ WA6 ' + label + '（' + fn + '）有清除快取', /clearDashboardCountsCache_\(/.test(bodyOf(read('src/' + f), fn)));
  });
  // 掃描：任何寫 SendLog／RosterAssignments 的函式都要清除（只有改表頭的那一支例外）
  const ALLOW = { 'MailRedirect.gs executeSendLogColumnBackfill_': '只補表頭欄名，不改任何一行', 'SelfTestRunner.gs selfTestS14_': '自我測試（測試資料，不經幹事介面）' };
  const missing = [];
  const scan = (name, text) => {
    const re = /^function (\w+)\(/gm;
    const starts = [];
    let m;
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      const body = text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length);
      const touches = /SHEETS\.(SEND_LOG|ROSTER_ASSIGNMENTS)\b/.test(body);
      const writes = /\.(setValues|setValue|appendRow|deleteRow|deleteRows|clearContent|insertRowsAfter)\(|deleteSheetRowsInRuns_\(|deleteRowsMatching_\(/.test(body);
      if (touches && writes && !/clearDashboardCountsCache_\(/.test(body) && !ALLOW[name + ' ' + s.name]) missing.push(name + ' ' + s.name);
    });
    return missing;
  };
  fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f)).forEach((f) => scan(f, read('src/' + f)));
  check('★★★★★★ WA6 所有寫 SendLog／RosterAssignments 的函式都有清除快取', missing.length === 0, missing.join('、'));
  const before = missing.length;
  scan('NewSend.gs', "function sendSomethingNew_(q) {\n  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SEND_LOG);\n  sheet.appendRow([q]);\n}\n");
  check('★★★★★ WA6 （自我核對）新寫入入口沒有清除 ⇒ 掃描會找到', missing.length === before + 1 && missing[missing.length - 1] === 'NewSend.gs sendSomethingNew_');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
