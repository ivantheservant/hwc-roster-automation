// 第九十五輪批次 VA 組：狀態卡一次載入只建一次 fine-tune context；職事表工作表只讀一次；人手檢查簽名用已讀到的資料。
// 執行方式：node tests/round95_va_context_memo.test.js
//
//   VA1 回傳值相同：同一份假資料，舊路徑（記憶關掉）和新路徑的 apiGetDashboardState 除 timings 外深度相等
//       （沒有版本、有版本、表上有未儲存改動、改了每週標題、之後才申報不能服侍、Requests 有一筆「不能服侍」）
//   VA2 context 次數：有版本 ⇒ 1；有未儲存改動 ⇒ 仍然 1；其餘用記憶（timings.fineTuneContextReused）
//   VA3 職事表工作表（Roster_…）同一個範圍只讀一次；「類型」欄從整張的那一份取
//   VA4 記憶只在狀態卡載入之內：載入完之後再建 context ⇒ 每次都真正建；不是跨請求的全域變數
//   VA5 交出去的是複本：呼叫者改動 context 不影響下一個呼叫者；skipGrid 的複本沒有 grid
//   VA6 人手檢查：簽名和結果和以前一樣（用記憶的部分 vs 自己讀）
// 用假資料。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LATE_AT = '2099-01-02 10:00:00';

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs', 'CellDecisions.gs', 'StaffingCheck.gs'] });
  const g = sc.gas;
  g.readWeightsForQuarterTune_ = () => ({ rows: [] });
  const RS = sc.C.RULE_SETTINGS;
  sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
    [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
  g.assertWebAppRequestAllowed_ = function () {};
  sc.idOf = (name) => Object.keys(sc.PEOPLE).filter((id) => sc.PEOPLE[id] === name)[0];
  // 人手檢查的快取（CacheService）在 harness 是空的，每次都重新計算
  return sc;
}

// 舊路徑：記憶不開（beginRequestContextMemo_ 換成甚麼都不做），其餘一字不改
function loadBoth(g, q) {
  const realBegin = g.beginRequestContextMemo_;
  g.beginRequestContextMemo_ = function () {};
  const oldD = g.apiGetDashboardState(q);
  g.beginRequestContextMemo_ = realBegin;
  const newD = g.apiGetDashboardState(q);
  return { oldD: oldD, newD: newD };
}
function strip(d) {
  const x = JSON.parse(JSON.stringify(d));
  delete x.timings;
  if (x.staffing) { delete x.staffing.ms; delete x.staffing.cached; }
  return JSON.stringify(x);
}

const D = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];

console.log('\n=== VA1／VA2：回傳值相同、context 次數 ===');
{
  const sc = scene();
  const g = sc.gas;
  let r = loadBoth(g, sc.Q);
  check('★★★★★★ VA1 沒有版本：新舊回傳值（除 timings）完全相同', strip(r.oldD) === strip(r.newD));
  check('★★★★ VA2 沒有版本 ⇒ 不建 context（0 次）', r.newD.timings.fineTuneContextCount === 0, JSON.stringify(r.newD.timings));

  g.apiGenerateDraftExecute(sc.Q);
  r = loadBoth(g, sc.Q);
  check('★★★★★★ VA1 有版本（沒有改動）：新舊回傳值（除 timings）完全相同', strip(r.oldD) === strip(r.newD));
  check('★★★★★★ VA2 舊路徑建 4 次（未儲存、修改申報、寄出警告、名單影響）', r.oldD.timings.fineTuneContextCount === 4, JSON.stringify(r.oldD.timings));
  check('★★★★★★ VA2 新路徑只建 1 次，其餘 3 次用記憶', r.newD.timings.fineTuneContextCount === 1 && r.newD.timings.fineTuneContextReused === 3, JSON.stringify(r.newD.timings));

  // 表上改一格、改每週標題、之後才申報不能服侍、Requests 一筆「不能服侍」（planApplyRequests_ 會就地改 context.unavailable）
  const readP = sc.idOf(sc.getCell(0, D[1], 'READ#1'));
  const U = sc.C.UNAVAILABLE;
  sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [{ [U.UNAVAILABLE_ID]: 'ULATE', [U.PERSON_ID]: readP,
    [U.DATE_FROM]: D[1], [U.DATE_TO]: D[1], [U.SOURCE]: 'WEBUI', [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL', [U.CREATED_AT]: LATE_AT }]);
  const reqSheet = sc.ss.getSheetByName(sc.S.REQUESTS);
  const keys = reqSheet.getRange(2, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(String);
  sc.appendRows(sc.ss, sc.S.REQUESTS, keys, [{ QuarterID: sc.Q, ServiceDate: D[3], PostName: '讀經',
    PersonName: sc.getCell(0, D[3], 'READ#1'), RequestType: '不能服侍', CreatedAt: LATE_AT }]);
  const chairOn0 = sc.getCell(0, D[0], 'CHAIR#1');
  const other = Object.keys(sc.PEOPLE).map(sc.nameOf).filter((n) => n !== chairOn0 && n !== sc.nameOf('P9706'))[0];
  sc.setCell(0, D[0], 'CHAIR#1', other);
  const typeSheet = sc.gridSheet(0);
  const tkeys = typeSheet.getRange(2, 1, 1, typeSheet.getLastColumn()).getValues()[0];
  const typeCol = tkeys.indexOf('TYPE') + 1;
  if (typeCol > 0) typeSheet.getRange(3, typeCol).setValue('第九十五輪測試標題');
  r = loadBoth(g, sc.Q);
  check('（前置）有未儲存改動、有一筆修改申報', r.newD.unsaved.gridChangeCount >= 1 && r.newD.unsaved.pendingRequestCount >= 1, JSON.stringify(r.newD.unsaved));
  check('（前置）寄出警告有「之後才申報不能服侍」', r.newD.sendWarnings.lateUnavailable.count === 1, JSON.stringify(r.newD.sendWarnings.lateUnavailable));
  check('★★★★★★ VA1 有未儲存改動＋修改申報＋之後才申報：新舊回傳值（除 timings）完全相同', strip(r.oldD) === strip(r.newD),
    strip(r.oldD).slice(0, 300) + '\n      ' + strip(r.newD).slice(0, 300));
  check('★★★★★★ VA2 有未儲存改動：新路徑仍然只建 1 次（交接寫明：上限 2，實際 1）', r.newD.timings.fineTuneContextCount === 1, JSON.stringify(r.newD.timings));
  check('★★★★ VA1 再載入一次結果一樣（記憶不跨請求）', strip(g.apiGetDashboardState(sc.Q)) === strip(r.newD));
}

console.log('\n=== VA3：職事表工作表只讀一次 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const counts = {};
  const sh = sc.gridSheet(0);
  const raw = sh.getRange.bind(sh);
  sh.getRange = function () { const k = Array.from(arguments).join(','); counts[k] = (counts[k] || 0) + 1; return raw.apply(sh, arguments); };
  const ss = sc.ss;
  const rawGet = ss.getSheetByName.bind(ss);
  let gridLookups = 0;
  ss.getSheetByName = function (n) { if (/^Roster_/.test(n)) gridLookups++; return rawGet(n); };
  g.apiGetDashboardState(sc.Q);
  const total = Object.keys(counts).reduce((s, k) => s + counts[k], 0);
  check('★★★★★★ VA3 一次載入只讀兩個範圍（第 2 行機器鍵、第 3 行起全部），各一次', total === 2 && Object.keys(counts).every((k) => counts[k] === 1), JSON.stringify(counts));
  const newLookups = gridLookups;
  // 記憶關掉 ⇒ 照舊（每個讀取的函式自己讀）
  Object.keys(counts).forEach((k) => delete counts[k]);
  gridLookups = 0;
  g.beginRequestContextMemo_ = function () {};
  g.apiGetDashboardState(sc.Q);
  const oldTotal = Object.keys(counts).reduce((s, k) => s + counts[k], 0);
  check('★★★★ VA3 對照：舊路徑讀 10 次', oldTotal === 10, JSON.stringify(counts));
  check('★★★★ VA3 找職事表工作表（getSheetByName）的次數少了 4 次（三個讀取函式共用一次）', newLookups === gridLookups - 4, newLookups + ' vs ' + gridLookups);
}

console.log('\n=== VA4／VA5：記憶的範圍、複本 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.apiGetDashboardState(sc.Q);
  g.FINE_TUNE_CONTEXT_STATS_.count = 0;
  g.buildFineTuneContext_(sc.Q, 0);
  g.buildFineTuneContext_(sc.Q, 0);
  check('★★★★★★ VA4 載入完之後（其他流程）每次都真正建 context', g.FINE_TUNE_CONTEXT_STATS_.count === 2, String(g.FINE_TUNE_CONTEXT_STATS_.count));
  check('★★★★★ VA4 載入完之後記憶已關（REQUEST_CONTEXT_MEMO_ 是 null）', g.REQUEST_CONTEXT_MEMO_ === null);
  // 出錯也要關
  const realBuild = g.buildDashboardState_;
  g.buildDashboardState_ = function () { throw new Error('boom'); };
  try { g.apiGetDashboardState(sc.Q); } catch (e) { /* 預期 */ }
  g.buildDashboardState_ = realBuild;
  check('★★★★★ VA4 載入中途出錯，記憶照樣關掉', g.REQUEST_CONTEXT_MEMO_ === null && g.SHEET_READ_MEMO_ === null);

  g.beginSheetReadMemo_();
  g.beginRequestContextMemo_();
  try {
    g.FINE_TUNE_CONTEXT_STATS_.count = 0;
    const a = g.buildFineTuneContext_(sc.Q, 0);
    a.unavailable.push({ personId: 'PX', dateFrom: D[0], dateTo: D[0] });
    a.original[0].personId = 'PX';
    a.gridValues.zzz = 'x';
    const b = g.buildFineTuneContext_(sc.Q, 0);
    check('★★★★★★ VA5 第二個呼叫者拿到的不受第一個呼叫者改動影響', !b.unavailable.some((u) => u.personId === 'PX')
      && b.original[0].personId !== 'PX' && !('zzz' in b.gridValues));
    check('★★★★ VA5 兩次只建一次', g.FINE_TUNE_CONTEXT_STATS_.count === 1);
    const c = g.buildFineTuneContext_(sc.Q, 0, { skipGrid: true });
    check('★★★★★★ VA5 skipGrid 的複本：gridValues、gridTypeValues 是空物件（和以前一樣）',
      Object.keys(c.gridValues).length === 0 && Object.keys(c.gridTypeValues).length === 0 && Object.keys(b.gridValues).length > 0);
    g.endRequestContextMemo_();
    g.endSheetReadMemo_();
    const direct = g.buildFineTuneContext_(sc.Q, 0, { skipGrid: true });
    check('★★★★★★ VA5 skipGrid 複本和直接建的 skipGrid context 完全相同', JSON.stringify(direct) === JSON.stringify(c));
    g.beginSheetReadMemo_();
    g.beginRequestContextMemo_();
    // 先 skipGrid 再要整份 ⇒ 要真正建整份（不可以交一份沒有 grid 的）
    g.endRequestContextMemo_();
    g.beginRequestContextMemo_();
    g.FINE_TUNE_CONTEXT_STATS_.count = 0;
    g.buildFineTuneContext_(sc.Q, 0, { skipGrid: true });
    const full = g.buildFineTuneContext_(sc.Q, 0);
    check('★★★★★★ VA5 先建 skipGrid、再要整份 ⇒ 再建一次，有 grid', g.FINE_TUNE_CONTEXT_STATS_.count === 2 && Object.keys(full.gridValues).length > 0);
    let threw = '';
    try { g.buildFineTuneContext_(sc.Q, 7); } catch (e) { threw = e.message; }
    check('★★★★ VA5 找不到的版本照舊拋錯（不記住錯誤，不交出別的版本）', /找不到 2099T1 v7/.test(threw), threw);
  } finally {
    g.endRequestContextMemo_();
    g.endSheetReadMemo_();
  }
}

console.log('\n=== VA3 補充：範圍讀取的記憶 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const name = 'Roster_' + sc.Q + '_v0';
  const info0 = g.readGridSheetInfo_(name);
  const full = info0.sheet.getRange(3, 1, info0.lastRow - 2, info0.lastCol).getValues();
  g.beginRequestContextMemo_();
  try {
    const info = g.readGridSheetInfo_(name);
    const a = g.readGridRangeValues_(info, name, 3, 1, info.lastRow - 2, info.lastCol);
    a[0][0] = 'changed';
    const b = g.readGridRangeValues_(info, name, 3, 1, info.lastRow - 2, info.lastCol);
    check('★★★★★ 交出新的二維陣列（改了不影響記憶）', b[0][0] !== 'changed' && JSON.stringify(b) === JSON.stringify(full));
    const three = g.readGridRangeValues_(info, name, 3, 1, info.lastRow - 2, 3);
    check('★★★★★ 頭三欄從整張的那一份取，和直接讀頭三欄一樣', JSON.stringify(three) === JSON.stringify(info.sheet.getRange(3, 1, info.lastRow - 2, 3).getValues()));
    check('★★★★ 找不到工作表 ⇒ sheet null', g.readGridSheetInfo_('Roster_NOPE').sheet === null);
  } finally {
    g.endRequestContextMemo_();
  }
}

console.log('\n=== VA6：人手檢查 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const plain = g.buildStaffingContext_(sc.Q);
  g.beginSheetReadMemo_();
  g.beginRequestContextMemo_();
  let memoCtx;
  let parts;
  try {
    g.buildFineTuneContext_(sc.Q, 0);
    parts = g.readMemoQuarterContextParts_(sc.Q, sc.gas.getConfig_('SYS_TIMEZONE', sc.gas.DEFAULTS.TIMEZONE));
    const realRole = g.buildRoleContext_;
    let roleBuilds = 0;
    g.buildRoleContext_ = function () { roleBuilds++; return realRole.apply(this, arguments); };
    memoCtx = g.buildStaffingContext_(sc.Q);
    g.buildRoleContext_ = realRole;
    check('★★★★★★ VA6 狀態卡載入時人手檢查不再自己建名單／身分（用已讀到的資料）', roleBuilds === 0, String(roleBuilds));
  } finally {
    g.endRequestContextMemo_();
    g.endSheetReadMemo_();
  }
  check('（前置）記憶裏有這一季的部分', !!parts && Array.isArray(parts.posts));
  check('★★★★★★ VA6 人手檢查資料和自己讀的完全相同', JSON.stringify(plain) === JSON.stringify(memoCtx));
  check('★★★★★★ VA6 簽名相同', g.staffingSignature_(plain) === g.staffingSignature_(memoCtx));
  check('★★★★ VA6 時區不同 ⇒ 不用記憶（自己讀）', (function () {
    g.beginRequestContextMemo_();
    try { g.buildFineTuneContext_(sc.Q, 0); return g.readMemoQuarterContextParts_(sc.Q, 'Asia/Hong_Kong') === null; }
    finally { g.endRequestContextMemo_(); }
  })());
  check('★★★★ VA6 記憶沒有開 ⇒ null', g.readMemoQuarterContextParts_(sc.Q, 'Pacific/Auckland') === null);
}

console.log('\n=== 靜態 ===');
{
  const dash = read('src/WebAppDashboard.gs');
  check('★★★★ apiGetDashboardState 在 finally 關記憶', /beginRequestContextMemo_\(\);\s*try \{\s*(?:\/\/[^\n]*\n\s*)?return (?:viewerSafeState_\(role, )?buildDashboardState_\(quarterId\)\)?;\s*\} finally \{\s*endRequestContextMemo_\(\);/.test(dash));
  check('★★★★ timings 有 fineTuneContextReused', /fineTuneContextReused: FINE_TUNE_CONTEXT_STATS_\.reused/.test(dash));
  const others = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f) && f !== 'SheetReader.gs' && f !== 'WebAppDashboard.gs')
    .filter((f) => /^\s*beginRequestContextMemo_\(\);/m.test(read('src/' + f)));
  check('★★★★ 只有狀態卡載入開這個記憶（有寫入的流程不開）', others.length === 0, others.join(','));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
