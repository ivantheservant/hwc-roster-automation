// 第八十五輪批次 LB 組：幹事介面〔整季重設〕保留人手加入的資料（Ivan 選 A）；選單版照舊全部清除。
// 執行方式：node tests/round85_lb_reset_keep_manual.test.js
//
//   LB1　確認窗：「會清除」照舊（連第 0 版）；「會保留（人手加入）」逐項寫數目
//   LB2　〔整季重設〕：人手加入的不能服侍日期、每週標題保留；由申報自動加入的（Source=REQUEST）清除；
//        版本全部清除、Stage 回 DRAFT
//   LB3　這一季的 Requests 保留，RequestID／Status／處理結果／處理時間清空 ⇒ 變回未處理（之後可以再套用）；寫 AuditLog
//   LB4　選單「重設季度測試資料」照舊全部清除；確認字眼講明和幹事介面〔整季重設〕的分別
//   LB5　前端確認窗分兩段
// 下面用假資料（P97xx），不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'QuarterReset.gs', 'Menu.gs', 'WebAppQuarterReset.gs'] });
  const gas = sc.gas; const C = sc.C; const S = sc.S;
  gas.listRosterPdfFilesForQuarter_ = function () { return []; };
  gas.listEditableCopyFilesForQuarter_ = function () { return []; };
  gas.listEmptyVersionFoldersForReset_ = function () { return []; };
  gas.apiGenerateDraftExecute(sc.Q);
  const U = C.UNAVAILABLE;
  const ukeys = Object.keys(U).map((k) => U[k]);
  const urow = (id, pid, d, source, status) => ({ [U.UNAVAILABLE_ID]: id, [U.PERSON_ID]: pid, [U.DATE_FROM]: d,
    [U.DATE_TO]: d, [U.APPLIES_TO]: 'ALL', [U.REASON]: 'test 85', [U.SOURCE]: source, [U.STATUS]: status });
  sc.appendRows(sc.ss, S.UNAVAILABLE, ukeys, [
    urow('U1', 'P9701', sc.DATES[1], 'MANUAL', 'ACTIVE'),
    urow('U2', 'P9702', sc.DATES[2], 'WEB', 'ACTIVE'),
    urow('U3', 'P9703', sc.DATES[2], 'REQUEST', 'ACTIVE'),
    urow('U4', 'P9704', sc.DATES[3], 'MANUAL', 'CANCELLED')
  ]);
  // 每週標題：第 2 週
  const sd = sc.ss.getSheetByName(S.SERVICE_DATES);
  const titleCol = gas.ensureServiceDatesTitleColumn_(sd);
  sd.getRange(4, titleCol).setValue('聖誕主日（測試）');
  // 修改申報：一行已處理、一行未處理
  const R = C.REQUESTS;
  const rkeys = Object.keys(R).map((k) => R[k]);
  sc.appendRows(sc.ss, S.REQUESTS, rkeys, [
    { [R.REQUEST_ID]: 'REQ-2099T1-1', [R.QUARTER_ID]: sc.Q, [R.SERVICE_DATE]: sc.DATES[2], [R.POST_NAME]: '主席',
      [R.PERSON_NAME]: '假甲', [R.REQUEST_TYPE]: 'CANNOT_SERVE', [R.STATUS]: 'APPLIED', [R.RESULT_NOTE]: '已套用',
      [R.PROCESSED_AT]: '2099-01-02 10:00:00' },
    { [R.QUARTER_ID]: sc.Q, [R.SERVICE_DATE]: sc.DATES[3], [R.POST_NAME]: '主席', [R.PERSON_NAME]: '假乙',
      [R.REQUEST_TYPE]: 'CANNOT_SERVE' }
  ]);
  return sc;
}
const unavIds = (sc) => sc.gas.readSheet_(sc.S.UNAVAILABLE).map((r) => r[sc.C.UNAVAILABLE.UNAVAILABLE_ID]).sort().join(',');
const versions = (sc) => sc.gas.readSheet_(sc.S.ROSTER_VERSIONS).filter((r) => r[sc.C.ROSTER_VERSIONS.QUARTER_ID] === sc.Q).length;

console.log('\n=== LB1：確認窗兩段 ===');
{
  const sc = scene();
  const p = sc.gas.apiQuarterResetPlan(sc.Q);
  check('★★★★★ 會清除：連第 0 版（v0、…）', p.lines.some((l) => /RosterVersions 登記列：\d+ 個版本（v0/.test(l)), p.lines.join('\n'));
  check('★★★★★ 會清除：Requests 不刪除、變回未處理', p.lines.some((l) => /Requests：不刪除（1 項變回未處理/.test(l)), p.lines.join('\n'));
  check('★★★★★★ 會保留：不能服侍的日期 2 項（有效、人手加入；申報自動加入和已取消的不算）',
    p.keptLines[0] === '不能服侍的日期 2 項', p.keptLines.join('\n'));
  check('★★★★ 逐項列出（名字、日期、原因）', p.keptLines.some((l) => /假甲　2099-01-11　test 85/.test(l)), p.keptLines.join('\n'));
  check('★★★★★ 會保留：每週標題 1 週', p.keptLines.indexOf('每週標題 1 週') !== -1, p.keptLines.join('\n'));
  check('★★★★★ 會保留：修改申報 1 項（變回未處理）', p.keptLines.some((l) => /^修改申報 1 項（變回未處理/.test(l)), p.keptLines.join('\n'));
  check('★★★★ 排表偏好不受影響', p.keptLines.indexOf('排表偏好：不受影響') !== -1);
}

console.log('\n=== LB2／LB3：〔整季重設〕 ===');
{
  const sc = scene();
  const gas = sc.gas; const C = sc.C; const S = sc.S;
  check('（準備）有版本', versions(sc) >= 1);
  const r = gas.apiQuarterResetExecute(sc.Q, '確認重設');
  check('★★★★★ 成功；0 個版本；Stage 回 DRAFT', r.ok && versions(sc) === 0 && gas.getQuarterStage_(sc.Q) === 'DRAFT', JSON.stringify(r));
  check('★★★★★★ 人手加入的不能服侍日期保留；由申報自動加入的清除', unavIds(sc) === 'U1,U2,U4', unavIds(sc));
  const title = gas.readSheet_(S.SERVICE_DATES).filter((x) => x[C.SERVICE_DATES.TITLE])[0];
  check('★★★★★★ 每週標題保留', title && title[C.SERVICE_DATES.TITLE] === '聖誕主日（測試）');
  const reqs = gas.readSheet_(S.REQUESTS);
  const R = C.REQUESTS;
  check('★★★★★★ Requests 兩行都保留', reqs.length === 2, reqs.length);
  check('★★★★★★ 已處理那一行：RequestID／Status／處理結果／處理時間清空',
    reqs.every((x) => !x[R.REQUEST_ID] && !x[R.STATUS] && !x[R.RESULT_NOTE] && !x[R.PROCESSED_AT]), JSON.stringify(reqs));
  check('★★★★★ 變回未處理：之後可以再套用（兩行都是待處理）', gas.readPendingRequests_(sc.Q).length === 2);
  const audit = gas.readSheet_(S.AUDIT_LOG).filter((x) => x[C.AUDIT_LOG.ACTION] === 'REQUEST_RESET_TO_PENDING');
  check('★★★★★ 寫 AuditLog（一行）', audit.length === 1 && /REQ-2099T1-1/.test(audit[0][C.AUDIT_LOG.OLD_VALUE]));
  check('★★★★ 「清理 Requests 手改痕跡」不會當成手改', gas.planCleanRequestsTampering_().rows.length === 0);
}

console.log('\n=== LB4：選單版照舊全部清除 ===');
{
  const sc = scene();
  const gas = sc.gas; const C = sc.C; const S = sc.S;
  const plan = gas.planQuarterReset_(sc.Q, true);
  check('★★★★ 選單版計畫不是保留模式', plan.keepManual === false && plan.keptUnavailableDetails.length === 0);
  gas.executeQuarterResetBatch_([{ quarterId: sc.Q, plan: plan }]);
  check('★★★★★★ 不能服侍日期（完全在這一季）全部清除', unavIds(sc) === '', unavIds(sc));
  check('★★★★★★ 每週標題清空', gas.readSheet_(S.SERVICE_DATES).every((x) => !x[C.SERVICE_DATES.TITLE]));
  check('★★★★★★ Requests 刪除', gas.readSheet_(S.REQUESTS).length === 0);
  check('★★★★★ 確認字眼講明和幹事介面〔整季重設〕的分別',
    /這個選單版本會全部清除[\s\S]*幹事介面「常用設定 ▸ 整季重設」則會保留人手加入的資料/.test(gas.QUARTER_RESET_MENU_DIFFERENCE_TEXT)
    && (read('src/Menu.gs').match(/QUARTER_RESET_MENU_DIFFERENCE_TEXT/g) || []).length === 2);
  check('★★★★ QUARTER_RESET_BLOCKED_QUARTERS 預設不加 2027T1', !/2027T1/.test(gas.QUARTER_RESET_BLOCKED_DEFAULT));
}

console.log('\n=== LB5：前端確認窗分兩段 ===');
{
  const z3 = read('src/ui/ScriptZone3.html');
  check('★★★★★ 「會清除」「會保留（人手加入）」兩段，保留段用 keptLines',
    /sectionTitle\('會清除'\)/.test(z3) && /sectionTitle\('會保留（人手加入）'\)/.test(z3) && /p\.keptLines \|\| \[\]/.test(z3));
  check('★★★★★ 常用設定那一行的說明寫明會保留人手加入的資料（不再寫「不能服侍日期等一併清除」）',
    /人手加入的不能服侍日期、每週標題、合堂主日會保留/.test(z3) && !/這一季的不能服侍日期等一併清除/.test(z3));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
