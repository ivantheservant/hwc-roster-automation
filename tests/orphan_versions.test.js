// 第六十三輪批次 J 組：孤兒版本（偵測 ＋ 受保護嘅清理）。
// 執行方式：node tests/orphan_versions.test.js
//
// 現場（2026T4）：`RosterAssignments` 有 273 行 `VersionNo=2`，工作表
// `Roster_2026T4_v2` 仍然喺度，但 `RosterVersions` 冇 2026T4-v2。
// 日後 2026T4 任何一條造版本嘅路都會因為工作表撞名而失敗。
//
// 清理工具：只刪未登記版本嘅派工紀錄同 grid；已登記版本一律唔碰；
// **刻意唔受** `QUARTER_RESET_BLOCKED_QUARTERS` 限制。
// 下面用假季度（2098T4）同假 ID。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'RosterWriter.gs',
  'QuarterReset.gs', 'FullHealthCheck.gs', 'MutationLock.gs', 'WebAppGuards.gs', 'OrphanVersions.gs'
]);
const C = gas.COLUMNS;
const S = gas.SHEETS;
const Q = '2098T4';

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'j@example.invalid'; } }; } };
gas.getConfig_ = function (_k, d) { return d; };
gas.nowTimestamp_ = function () { return '2098-10-01 09:00:00'; };
gas.compactTimestamp_ = function () { return '20981001090000'; };
gas.log_ = function () {};

const A = C.ROSTER_ASSIGNMENTS;
const V = C.ROSTER_VERSIONS;
seedSheet(ss, S.ROSTER_VERSIONS, ['V'], Object.keys(V).map(function (k) { return V[k]; }),
  [0, 1].map(function (v) { return { [V.VERSION_ID]: Q + '-v' + v, [V.QUARTER_ID]: Q, [V.VERSION_NO]: v }; }));
const rows = [];
[0, 1, 2].forEach(function (v) {
  ['2098-10-04', '2098-10-11', '2098-10-18'].forEach(function (d) {
    rows.push({ [A.ASSIGNMENT_ID]: Q + '-v' + v + '-' + d, [A.QUARTER_ID]: Q, [A.VERSION_NO]: v,
      [A.SERVICE_DATE]: d, [A.POST_ID]: 'READ', [A.SLOT_INDEX]: 1, [A.PERSON_ID]: 'P9701' });
  });
});
seedSheet(ss, S.ROSTER_ASSIGNMENTS, ['A'], Object.keys(A).map(function (k) { return A[k]; }), rows);
seedSheet(ss, S.AUDIT_LOG, ['L'], Object.keys(C.AUDIT_LOG).map(function (k) { return C.AUDIT_LOG[k]; }), []);
// grid：v0、v1 有登記；v2 孤兒；v5 淨係得一張 grid（冇派工紀錄）
['Roster_2098T4_v0', 'Roster_2098T4_v1', 'Roster_2098T4_v2', 'Roster_2098T4_v5', 'Roster_notes'].forEach(function (n) {
  ss.insertSheet(n);
});

// =====================================================================
console.log('\n=== J1【核心】全面體檢搵到孤兒 ===');
const plan = gas.findOrphanVersions_();
{
  check('★★★★★★ 搵到 v2（派工紀錄有、RosterVersions 冇）同 v5（淨係 grid）',
    plan.map(function (o) { return o.key; }).join(',') === Q + '|2,' + Q + '|5', JSON.stringify(plan));
  const v2 = plan[0];
  check('★★★★★ 講得出幾多行同 grid 存唔存在', v2.assignmentRows === 3 && v2.gridExists === true);
  check('★★★★ 唔會把唔似 grid 嘅表當成孤兒（Roster_notes）',
    plan.every(function (o) { return o.gridSheetName !== 'Roster_notes'; }));
  const item = gas.classifyOrphanVersionsHealth_(plan);
  check('★★★★★ 體檢 MUST（日後造版本會撞名失敗）並列出每一項',
    item.severity === gas.HEALTH_SEVERITY.MUST && item.details.length === 2, JSON.stringify(item));
  check('★★★★ 冇孤兒 ⇒ INFO', gas.classifyOrphanVersionsHealth_([]).severity === gas.HEALTH_SEVERITY.INFO);
  check('★★★★ 體檢報告有呢一項',
    /classifyOrphanVersionsHealth_\(findOrphanVersions_\(\)\)/.test(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'FullHealthCheck.gs'), 'utf8')));
}

console.log('\n=== J2【核心】清理：只刪未登記嘅 ===');
{
  const result = gas.executeOrphanVersionCleanup_(plan);
  const left = gas.readSheet_(S.ROSTER_ASSIGNMENTS);
  check('★★★★★★ v2 嘅 3 行刪咗', result.deletedRows === 3
    && left.every(function (r) { return Number(r[A.VERSION_NO]) !== 2; }), JSON.stringify(result));
  check('★★★★★★ 已登記嘅 v0、v1 一行都冇少', left.length === 6
    && left.filter(function (r) { return Number(r[A.VERSION_NO]) === 0; }).length === 3
    && left.filter(function (r) { return Number(r[A.VERSION_NO]) === 1; }).length === 3);
  check('★★★★★ 孤兒 grid 刪咗；已登記嘅 grid 同其他表仍然喺度',
    !ss.getSheetByName('Roster_2098T4_v2') && !ss.getSheetByName('Roster_2098T4_v5')
    && !!ss.getSheetByName('Roster_2098T4_v0') && !!ss.getSheetByName('Roster_2098T4_v1')
    && !!ss.getSheetByName('Roster_notes'));
  check('★★★★★ 每一項寫 AuditLog', gas.readSheet_(S.AUDIT_LOG).filter(function (r) {
    return r[C.AUDIT_LOG.ACTION] === '清理孤兒版本';
  }).length === 2);
  check('★★★★ 清完再搵 ⇒ 冇', gas.findOrphanVersions_().length === 0);
}

console.log('\n=== J2：預覽之後清單變咗 ⇒ 乜都唔刪 ===');
{
  ss.insertSheet('Roster_2098T4_v7');
  let err = null;
  try { gas.executeOrphanVersionCleanup_([]); } catch (e) { err = e; }
  check('★★★★★★ 執行嗰刻重新算，同預覽唔一樣就停', err && /清單變了/.test(err.message), err && err.message);
  check('★★★★ 乜都冇刪', !!ss.getSheetByName('Roster_2098T4_v7'));
}

console.log('\n=== J：界線寫清楚 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'OrphanVersions.gs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ 刻意唔受 QUARTER_RESET_BLOCKED_QUARTERS 限制，而且有寫理由',
    !/getConfig_\(CONFIG_KEYS\.QUARTER_RESET_BLOCKED_QUARTERS/.test(code)
    && /刻意唔受/.test(src) && /一行已登記嘅資料都唔會刪/.test(src));
  check('★★★★★ 要打字確認', /ORPHAN_VERSION_CONFIRM_TEXT = '確認清理孤兒版本'/.test(src)
    && /getResponseText\(\)\.trim\(\) !== ORPHAN_VERSION_CONFIRM_TEXT/.test(src));
  check('★★★★ 選單有呢一項', /'⚠️ 清理未登記的孤兒版本', 'runCleanupOrphanVersions_'/.test(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'Menu.gs'), 'utf8')));
  check('★★★★ 會刪資料 ⇒ 包互斥鎖', /function runCleanupOrphanVersions_\(\) \{\s*return withMutationLock_\(/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
