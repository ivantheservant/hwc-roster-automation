// 階段 B（Opus 深度輪）B3：封存之後，每一個讀取 SendLog／RosterAssignments
// 的功能是否仍然正確。
// 執行方式：node tests/archive_readers_safety.test.js
//
// 這是整個封存機制最容易出事的地方，也是本輪最危險的改動。做法是：
// 對每一個讀取者，用「封存前的完整資料」與「封存後剩下的資料」各跑一次，
// 比較兩者的結果是否一致（或者確認差異在可接受、已文件化的範圍內）。
//
// 涵蓋 B3 逐項要求：
//   1. 步驟 5 的 hash 比對（lastHashByPerson）— 最危險，會導致重複寄信
//   2. 匯出關鍵狀態／全面體檢的統計數字
//   3. AuditLog 摘要與提醒次數判斷
//   4. Fine-tune 的 context 建立
//   5. 生成器讀取歷史派工（readPriorWeeks_）

const { loadGasSource } = require('./helpers/gas_loader.js');

// Archive.gs 需要 Mailer.gs 的 MAIL_STATUS 常數與 QuarterStage.gs 的
// QUARTER_STAGE，兩者都在 Constants.gs；Archive.gs 本身的純判斷函式
// （classifyQuartersForArchive_ 除外，那個要讀試算表）可以直接載入。
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Generator.gs', 'FineTune.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------------------
// 移植：Archive.gs 的封存資格判斷與兩張表的封存計畫（逐字對應正式碼，
// readSheet() 換成傳入的假資料陣列）
// ---------------------------------------------------------------------------
const ARCHIVE_KEEP_RECENT_QUARTERS = gas.ARCHIVE_KEEP_RECENT_QUARTERS;
const MAIL_STATUS = gas.MAIL_STATUS;
const QUARTER_STAGE = gas.QUARTER_STAGE;

function isBaselineSendStatus_(status) {
  const n = String(status || '').toUpperCase();
  return n === MAIL_STATUS.SENT || n === MAIL_STATUS.DRY_RUN || n === MAIL_STATUS.SKIPPED_NO_EMAIL;
}

function classifyQuartersForArchive_(quarterRows, today) {
  const quarters = quarterRows.slice();
  quarters.sort(function (a, b) {
    if (!a.startDate) return -1;
    if (!b.startDate) return 1;
    return a.startDate < b.startDate ? 1 : (a.startDate > b.startDate ? -1 : 0);
  });
  return quarters.map(function (q, index) {
    const reasons = [];
    if (index < ARCHIVE_KEEP_RECENT_QUARTERS) reasons.push('屬於最近 N 個季度');
    if (!q.endDate) reasons.push('EndDate 空白');
    else if (q.endDate >= today) reasons.push('季度尚未結束');
    if (q.stage !== QUARTER_STAGE.OFFICIAL_SENT) reasons.push('Stage 不是 OFFICIAL_SENT');
    return Object.assign({}, q, { archivable: reasons.length === 0, reason: reasons.join('；') });
  });
}

function planSendLogArchive_(rows, archivableIds) {
  const baselineIndexByKey = {};
  rows.forEach(function (row, index) {
    if (!archivableIds[row.quarterId]) return;
    if (!row.personId) return;
    if (!isBaselineSendStatus_(row.status)) return;
    baselineIndexByKey[row.quarterId + '|' + row.personId] = index;
  });
  const keepIndexes = {};
  Object.keys(baselineIndexByKey).forEach(function (k) { keepIndexes[baselineIndexByKey[k]] = true; });

  const rowsToArchive = [];
  const keptBaselineRows = [];
  rows.forEach(function (row, index) {
    if (!archivableIds[row.quarterId]) return;
    if (keepIndexes[index]) { keptBaselineRows.push(index); return; }
    rowsToArchive.push(index);
  });
  return {
    totalRows: rows.length, rowsToArchive: rowsToArchive,
    keptBaselineRows: keptBaselineRows, remainingRows: rows.length - rowsToArchive.length
  };
}

function planAssignmentsArchive_(rows, archivableIds) {
  const rowsToArchive = [];
  rows.forEach(function (row, index) {
    if (archivableIds[row.quarterId]) rowsToArchive.push(index);
  });
  return { totalRows: rows.length, rowsToArchive: rowsToArchive, remainingRows: rows.length - rowsToArchive.length };
}

/** 依計畫算出「封存後原表剩下什麼」與「封存表有什麼」。 */
function applyArchive(rows, plan) {
  const archived = {};
  plan.rowsToArchive.forEach(function (i) { archived[i] = true; });
  return {
    remaining: rows.filter(function (_r, i) { return !archived[i]; }),
    archive: rows.filter(function (_r, i) { return archived[i]; })
  };
}

// ---------------------------------------------------------------------------
// 移植：各個讀取者（逐字對應正式碼，只把 readSheet() 換成傳入陣列）
// ---------------------------------------------------------------------------

/** Mailer.gs 的 readLastSendRecordByPerson_()——步驟 5 hash 比對的基準來源。 */
function readLastSendRecordByPerson_(sendLogRows, quarterId) {
  const baselineStatuses = [MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN, MAIL_STATUS.SKIPPED_NO_EMAIL];
  const rows = sendLogRows.filter(function (row) {
    if (row.quarterId !== quarterId) return false;
    if (!row.personId) return false;
    return baselineStatuses.indexOf(String(row.status || '').toUpperCase()) !== -1;
  });
  const result = {};
  rows.forEach(function (row) {
    result[row.personId] = { hash: String(row.hash || ''), status: String(row.status || '').toUpperCase() };
  });
  return result;
}

/** ResendFlow.gs 的 computeResendDiff_() 核心：算出「這一輪要通知誰」。 */
function computeResendDiff_(currentHashByPerson, lastRecordByPerson, peopleWithEmail) {
  const ids = {};
  Object.keys(currentHashByPerson).forEach(function (id) { ids[id] = true; });
  Object.keys(lastRecordByPerson).forEach(function (id) { ids[id] = true; });

  const changed = [];
  Object.keys(ids).sort().forEach(function (personId) {
    const newHash = currentHashByPerson[personId] || 'EMPTY';
    const record = lastRecordByPerson[personId];
    const oldHash = record ? record.hash : '';
    const hashChanged = newHash !== oldHash;
    const lastStatus = record ? record.status : '';
    const firstNotifyDueToEmail = !hashChanged
      && lastStatus === MAIL_STATUS.SKIPPED_NO_EMAIL && !!peopleWithEmail[personId];
    if (!hashChanged && !firstNotifyDueToEmail) return;
    changed.push(personId);
  });
  return changed;
}

/** Generator.gs 的 readPriorWeeks_()（真正那一份，由沙箱載入的正式碼）。 */
function callReadPriorWeeks(assignmentRows, quarterStartDate, carryOverWeeks) {
  // 正式碼讀 readSheet() 之後用 toDateString() 正規化；這裡的假資料本身
  // 已經是 yyyy-MM-dd，所以直接移植它的分組邏輯（逐字對應）。
  if (carryOverWeeks <= 0) return [];
  const rows = assignmentRows.filter(function (r) { return r.serviceDate && r.serviceDate < quarterStartDate; });
  if (rows.length === 0) return [];
  const maxVersionByDate = {};
  rows.forEach(function (r) {
    const v = Number(r.versionNo) || 0;
    if (maxVersionByDate[r.serviceDate] === undefined || v > maxVersionByDate[r.serviceDate]) {
      maxVersionByDate[r.serviceDate] = v;
    }
  });
  const byDate = {};
  rows.forEach(function (r) {
    if ((Number(r.versionNo) || 0) !== maxVersionByDate[r.serviceDate]) return;
    if (!r.personId) return;
    if (!byDate[r.serviceDate]) byDate[r.serviceDate] = {};
    if (!byDate[r.serviceDate][r.postId]) byDate[r.serviceDate][r.postId] = [];
    byDate[r.serviceDate][r.postId].push(r.personId);
  });
  return Object.keys(byDate).sort().slice(-carryOverWeeks).map(function (d) { return byDate[d]; });
}

/** FineTune.gs 的 buildFineTuneContext_() 的資料篩選部分。 */
function buildFineTuneOriginal_(assignmentRows, quarterId, versionNo) {
  return assignmentRows.filter(function (r) {
    return r.quarterId === quarterId && Number(r.versionNo) === versionNo;
  });
}

// ---------------------------------------------------------------------------
// 假資料：三個季度，最舊那個（2098T1）符合封存資格
// ---------------------------------------------------------------------------
const TODAY = '2099-06-01';
const QUARTERS = [
  { quarterId: '2098T1', startDate: '2098-01-05', endDate: '2098-03-30', stage: 'OFFICIAL_SENT' },
  { quarterId: '2098T4', startDate: '2098-10-04', endDate: '2098-12-27', stage: 'OFFICIAL_SENT' },
  { quarterId: '2099T1', startDate: '2099-01-04', endDate: '2099-03-29', stage: 'OFFICIAL_SENT' }
];

/** SendLog 假資料：每個季度每人有多筆紀錄（模擬 OFFICIAL + 多次 RESEND）。 */
function buildSendLog() {
  const rows = [];
  QUARTERS.forEach(function (q) {
    ['P001', 'P002', 'P003'].forEach(function (personId) {
      rows.push({ quarterId: q.quarterId, personId: personId, status: 'DRY_RUN', hash: q.quarterId + '-h1', stage: 'OFFICIAL' });
      rows.push({ quarterId: q.quarterId, personId: personId, status: 'FAILED', hash: q.quarterId + '-hx', stage: 'RESEND' });
      rows.push({ quarterId: q.quarterId, personId: personId, status: 'SENT', hash: q.quarterId + '-h2', stage: 'RESEND' });
    });
    // 一位查無電郵的人：Status=SKIPPED_NO_EMAIL 也算「已確實處理」的基準
    rows.push({ quarterId: q.quarterId, personId: 'P004', status: 'SKIPPED_NO_EMAIL', hash: q.quarterId + '-h1', stage: 'OFFICIAL' });
    // LIST 收件人（沒有 PersonID）
    rows.push({ quarterId: q.quarterId, personId: '', status: 'SENT', hash: '', stage: 'OFFICIAL' });
  });
  return rows;
}

/** RosterAssignments 假資料：每季 2 個版本、每版 3 個主日 × 2 個崗位。 */
function buildAssignments() {
  const rows = [];
  QUARTERS.forEach(function (q) {
    const base = Number(q.startDate.slice(0, 4));
    [0, 1].forEach(function (v) {
      [0, 1, 2].forEach(function (w) {
        const day = Number(q.startDate.slice(8, 10)) + w * 7;
        const serviceDate = q.startDate.slice(0, 8) + (day < 10 ? '0' + day : String(day));
        ['CHAIR', 'ANNOUNCE'].forEach(function (postId, pi) {
          rows.push({
            quarterId: q.quarterId, versionNo: v, serviceDate: serviceDate,
            postId: postId, slotIndex: 1, personId: 'P' + (100 + base % 10 + v + w + pi)
          });
        });
      });
    });
  });
  return rows;
}

const sendLogAll = buildSendLog();
const assignmentsAll = buildAssignments();

console.log('\n=== 封存資格判斷：只有「已結束 + OFFICIAL_SENT + 不是最近 N 季」才可封存 ===');
{
  const classified = classifyQuartersForArchive_(QUARTERS, TODAY);
  const archivable = classified.filter(function (q) { return q.archivable; }).map(function (q) { return q.quarterId; });
  checkEqual('★ 三個季度中只有最舊的 2098T1 可封存（另外兩個屬於最近 2 季，一律保留）',
    archivable, ['2098T1']);

  // Stage 未走完的季度即使很舊也不可封存
  const withDraft = QUARTERS.concat([
    { quarterId: '2097T1', startDate: '2097-01-06', endDate: '2097-03-31', stage: 'DRAFT' }
  ]);
  const c2 = classifyQuartersForArchive_(withDraft, TODAY);
  const draftRow = c2.filter(function (q) { return q.quarterId === '2097T1'; })[0];
  checkEqual('★ Stage=DRAFT 的舊季度不可封存（流程未走完，可能還要處理）', draftRow.archivable, false);

  // 尚未結束的季度即使 Stage=OFFICIAL_SENT 也不可封存
  const future = [
    { quarterId: '2099T3', startDate: '2099-07-05', endDate: '2099-09-27', stage: 'OFFICIAL_SENT' },
    { quarterId: '2099T2', startDate: '2099-04-05', endDate: '2099-06-28', stage: 'OFFICIAL_SENT' },
    { quarterId: '2099T1', startDate: '2099-01-04', endDate: '2099-03-29', stage: 'OFFICIAL_SENT' },
    { quarterId: '2098T4', startDate: '2098-10-04', endDate: '2098-12-27', stage: 'OFFICIAL_SENT' }
  ];
  const c3 = classifyQuartersForArchive_(future, TODAY);
  const notEnded = c3.filter(function (q) { return q.quarterId === '2099T2'; })[0];
  checkEqual('★ EndDate 還沒過去的季度不可封存（步驟 5 仍然可能要用）', notEnded.archivable, false);

  const endDateMissing = classifyQuartersForArchive_([
    { quarterId: 'A', startDate: '2090-01-01', endDate: '', stage: 'OFFICIAL_SENT' },
    { quarterId: 'B', startDate: '2098-01-01', endDate: '2098-03-01', stage: 'OFFICIAL_SENT' },
    { quarterId: 'C', startDate: '2099-01-01', endDate: '2099-03-01', stage: 'OFFICIAL_SENT' }
  ], TODAY);
  checkEqual('★ EndDate 空白時保守處理，不可封存',
    endDateMissing.filter(function (q) { return q.quarterId === 'A'; })[0].archivable, false);
}

const archivableIds = { '2098T1': true };
const sendPlan = planSendLogArchive_(sendLogAll, archivableIds);
const assignPlan = planAssignmentsArchive_(assignmentsAll, archivableIds);
const sendAfter = applyArchive(sendLogAll, sendPlan);
const assignAfter = applyArchive(assignmentsAll, assignPlan);

console.log('\n=== 封存是搬移不是刪除：原表 + 封存表 = 原本全部資料 ===');
{
  checkEqual('★ SendLog：剩下 + 封存 = 原本總數',
    sendAfter.remaining.length + sendAfter.archive.length, sendLogAll.length);
  checkEqual('★ RosterAssignments：剩下 + 封存 = 原本總數',
    assignAfter.remaining.length + assignAfter.archive.length, assignmentsAll.length);
  check('★ 封存表確實有內容（不是空跑一場）',
    sendAfter.archive.length > 0 && assignAfter.archive.length > 0);
  console.log('      （SendLog ' + sendLogAll.length + ' → 剩 ' + sendAfter.remaining.length
    + '；RosterAssignments ' + assignmentsAll.length + ' → 剩 ' + assignAfter.remaining.length + '）');
}

console.log('\n=== B3-1【最危險】步驟 5 hash 比對：封存後不可以把任何人誤判為「要重發」 ===');
{
  // 對每一個季度（包括被封存的 2098T1）逐一比較封存前後的結果
  QUARTERS.forEach(function (q) {
    const before = readLastSendRecordByPerson_(sendLogAll, q.quarterId);
    const after = readLastSendRecordByPerson_(sendAfter.remaining, q.quarterId);
    checkEqual('★ ' + q.quarterId + '：封存前後，每人的 hash 基準完全一致', after, before);
  });

  // 真正的後果測試：用同一份「這一版的 hash」跑 computeResendDiff_()，
  // 封存前後要通知的人必須完全一樣——多一個都代表有人會收到重複的信。
  const peopleWithEmail = { P001: true, P002: true, P003: true, P004: true };
  QUARTERS.forEach(function (q) {
    const currentHash = { P001: q.quarterId + '-h2', P002: q.quarterId + '-h2', P003: q.quarterId + '-h2', P004: q.quarterId + '-h1' };
    const beforeChanged = computeResendDiff_(currentHash,
      readLastSendRecordByPerson_(sendLogAll, q.quarterId), peopleWithEmail);
    const afterChanged = computeResendDiff_(currentHash,
      readLastSendRecordByPerson_(sendAfter.remaining, q.quarterId), peopleWithEmail);
    checkEqual('★ ' + q.quarterId + '：封存前後「要重發給誰」完全一致（' + afterChanged.length + ' 人）',
      afterChanged, beforeChanged);
  });

  // 這一項是保命規則的直接證據
  checkEqual('★ 被封存季度的「每人最後一次紀錄」有刻意保留下來（P001–P004 共 4 行）',
    sendPlan.keptBaselineRows.length, 4);
  const keptForArchived = sendAfter.remaining.filter(function (r) { return r.quarterId === '2098T1'; });
  checkEqual('★ 被封存季度在原表只剩那 4 行基準紀錄', keptForArchived.length, 4);
  check('★ 保留下來的每一行都是「已確實處理」狀態（不是 FAILED 這種不可信基準）',
    keptForArchived.every(function (r) { return isBaselineSendStatus_(r.status); }),
    '保留了不可信的狀態會令 hash 比對用錯基準');
}

console.log('\n=== B3-1 反證：如果沒有保命規則（整季全部搬走），會出什麼事 ===');
{
  // 刻意造一個「沒有保命規則」的封存版本，證明上面的測試真的測到東西——
  // 如果拿走保護，2098T1 的重發判斷就會把每一個人都當成要通知。
  const naiveRemaining = sendLogAll.filter(function (r) { return !archivableIds[r.quarterId]; });
  const peopleWithEmail = { P001: true, P002: true, P003: true, P004: true };
  const currentHash = { P001: '2098T1-h2', P002: '2098T1-h2', P003: '2098T1-h2', P004: '2098T1-h1' };
  const correct = computeResendDiff_(currentHash,
    readLastSendRecordByPerson_(sendLogAll, '2098T1'), peopleWithEmail);
  const naive = computeResendDiff_(currentHash,
    readLastSendRecordByPerson_(naiveRemaining, '2098T1'), peopleWithEmail);

  // 正確做法下只有 P004 需要通知，而且原因正當：他上次是 SKIPPED_NO_EMAIL
  // （當時查無電郵、真的沒收過信），現在補上了電郵，所以要補一次首次通知。
  // 這正是 computeResendDiff_() 的 firstNotifyDueToEmail 分支，跟封存無關。
  checkEqual('★ 正確做法（有保命規則）：只有 1 人需要通知，而且是正當的首次通知（P004 補了電郵）',
    correct, ['P004']);
  checkEqual('★ 天真做法（整季搬走）：4 個人全部被誤判為要重發', naive.length, 4);
  check('★ 天真做法多出 3 個人（P001–P003）是真正的重複寄信——'
    + '這 3 位上次已經收過信、內容也完全沒變',
    naive.length - correct.length === 3);
}

console.log('\n=== B3-2 匯出關鍵狀態／全面體檢的統計數字 ===');
{
  // 這些統計本來就是「目前這張表有什麼」，封存之後數字會變小是**預期行為**，
  // 不是 bug。這裡驗證的是：變小的幅度剛好等於被搬走的量，沒有算漏或算錯。
  const beforeByQuarter = {};
  sendLogAll.forEach(function (r) { beforeByQuarter[r.quarterId] = (beforeByQuarter[r.quarterId] || 0) + 1; });
  const afterByQuarter = {};
  sendAfter.remaining.forEach(function (r) { afterByQuarter[r.quarterId] = (afterByQuarter[r.quarterId] || 0) + 1; });

  checkEqual('★ 未封存季度的統計數字完全沒有變（2098T4）',
    afterByQuarter['2098T4'], beforeByQuarter['2098T4']);
  checkEqual('★ 未封存季度的統計數字完全沒有變（2099T1）',
    afterByQuarter['2099T1'], beforeByQuarter['2099T1']);
  checkEqual('★ 被封存季度的數字剛好減少了搬走的量（不多不少）',
    beforeByQuarter['2098T1'] - afterByQuarter['2098T1'], sendPlan.rowsToArchive.length);

  // countAlreadySentForStage_（補寄工具與已寄警示都會用）
  function countAlreadySentForStage_(rows, quarterId, stage) {
    const seen = {};
    rows.forEach(function (row) {
      if (row.quarterId !== quarterId || row.stage !== stage) return;
      if ([MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN].indexOf(String(row.status || '').toUpperCase()) === -1) return;
      const key = row.personId || row.email;
      if (key) seen[key] = true;
    });
    return Object.keys(seen).length;
  }
  QUARTERS.forEach(function (q) {
    if (q.quarterId === '2098T1') return; // 被封存的季度另外在階段 D 專門測
    checkEqual('★ ' + q.quarterId + ' 的 OFFICIAL 已寄人數，封存前後一致',
      countAlreadySentForStage_(sendAfter.remaining, q.quarterId, 'OFFICIAL'),
      countAlreadySentForStage_(sendLogAll, q.quarterId, 'OFFICIAL'));
  });
}

console.log('\n=== B3-3 AuditLog 摘要與提醒次數判斷 ===');
{
  // AuditLog **完全不在封存範圍內**——這是刻意的設計決定：
  // (1) 它是稽核紀錄，本質上就應該完整保留；
  // (2) readReminderLog_() 用它判斷「這個季度＋Stage 提醒過幾次」，
  //     封存會直接令提醒次數重新歸零、對同一件事重複提醒；
  // (3) 它的成長速度遠低於另外兩張表（每日檢查每季一筆，不是每人一筆）。
  // 所以這一項的正確斷言是「AuditLog 一行都不會被動到」。
  const auditLogRows = [
    { action: 'TRIGGER_REMIND', targetKey: '2098T1|REVIEW_SENT', newValue: '2098-02-01' },
    { action: 'TRIGGER_REMIND', targetKey: '2098T1|REVIEW_SENT', newValue: '2098-02-02' },
    { action: 'TRIGGER_GENERATE', targetKey: '2099T1', newValue: '2099-01-01' }
  ];
  // 封存機制只碰 SendLog 與 RosterAssignments 兩張表（見 Archive.gs 的
  // executeArchive_()，只呼叫 moveRowsToArchive_ 兩次）
  const archivedSheets = ['SendLog', 'RosterAssignments'];
  checkEqual('★ 封存範圍不包含 AuditLog', archivedSheets.indexOf('AuditLog'), -1);

  function readReminderLog_(rows, quarterId, stage) {
    const key = quarterId + '|' + stage;
    return rows.filter(function (r) { return r.action === 'TRIGGER_REMIND' && r.targetKey === key; })
      .map(function (r) { return r.newValue; });
  }
  checkEqual('★ 提醒次數判斷不受封存影響（AuditLog 原封不動）',
    readReminderLog_(auditLogRows, '2098T1', 'REVIEW_SENT').length, 2);
}

console.log('\n=== B3-4 Fine-tune 的 context 建立（步驟 3／5 套用申報的底本）===');
{
  // 被封存的季度：context 會建不起來（找不到派工紀錄）——這是**正確且預期**
  // 的行為，因為那個季度已經完全結束、不應該再套用申報。正式碼在
  // buildFineTuneContext_() 會拋「找不到派工紀錄」，訊息本來就清楚。
  QUARTERS.forEach(function (q) {
    [0, 1].forEach(function (v) {
      const before = buildFineTuneOriginal_(assignmentsAll, q.quarterId, v);
      const after = buildFineTuneOriginal_(assignAfter.remaining, q.quarterId, v);
      if (q.quarterId === '2098T1') {
        checkEqual('★ 已封存的 ' + q.quarterId + ' v' + v + '：原表查不到（預期行為，該季已結束）',
          after.length, 0);
        check('★ 已封存的 ' + q.quarterId + ' v' + v + ' 資料完整保留在封存表',
          assignAfter.archive.filter(function (r) {
            return r.quarterId === q.quarterId && Number(r.versionNo) === v;
          }).length === before.length);
      } else {
        checkEqual('★ 未封存的 ' + q.quarterId + ' v' + v + '：封存前後逐行一致', after, before);
      }
    });
  });
}

console.log('\n=== B3-5【第二危險】生成器讀取歷史派工 readPriorWeeks_（跨季界連續兩週判斷）===');
{
  // 這是「保留最近 N 個季度」那條規則存在的唯一理由。生成 2099T1 的下一季
  // （2099T2）時，要讀 2099T1 最後幾週；生成 2099T1 時要讀 2098T4 最後幾週。
  const carryOverWeeks = 2;

  // 情境 1：生成緊接在未封存季度之後的新一季——完全不受影響
  const nextQuarterStart = '2099-04-05';
  const beforePrior = callReadPriorWeeks(assignmentsAll, nextQuarterStart, carryOverWeeks);
  const afterPrior = callReadPriorWeeks(assignAfter.remaining, nextQuarterStart, carryOverWeeks);
  checkEqual('★ 生成新一季時的跨季界基準，封存前後完全一致', afterPrior, beforePrior);
  check('★ 而且真的讀到了資料（不是兩邊都空才「一致」）', beforePrior.length > 0);

  // 情境 2：如果封存規則沒有「保留最近 N 季」，會出什麼事——反證。
  //
  // ⚠️ 這裡要比較的是**內容**不是**組數**：readPriorWeeks_() 一律回傳最後
  // carryOverWeeks 組，即使正確的那幾週被搬走了，它仍然會回傳同樣組數——
  // 只不過拿的是更早、來自另一個季度的週次。組數一樣但內容錯，比完全拿不到
  // 更危險（系統會以為自己有正確基準）。第一版測試比較組數，剛好兩邊都是
  // 2 組而測不出問題，已改為比較內容。
  const overArchived = assignmentsAll.filter(function (r) {
    return r.quarterId !== '2099T1' && r.quarterId !== '2098T4';
  });
  const brokenPrior = callReadPriorWeeks(overArchived, nextQuarterStart, carryOverWeeks);
  check('★ 反證：若連最近的季度都封存走，跨季界基準的**內容**會變成錯的'
    + '（組數同樣是 ' + brokenPrior.length + ' 組，但拿到的是更早季度的週次）',
    JSON.stringify(brokenPrior) !== JSON.stringify(beforePrior),
    '若兩者內容一樣，代表這個反證情境沒有真正拿走需要的資料，測試需要重新設計');
  checkEqual('★ 正常封存（只搬最舊的 2098T1）拿到的內容跟封存前逐字相同',
    afterPrior, beforePrior);
}

console.log('\n=== 封存的實際效果：讀取量真的有減少 ===');
{
  const sendReduction = 1 - sendAfter.remaining.length / sendLogAll.length;
  const assignReduction = 1 - assignAfter.remaining.length / assignmentsAll.length;
  check('★ SendLog 讀取量有減少（' + (sendReduction * 100).toFixed(0) + '%）', sendReduction > 0);
  check('★ RosterAssignments 讀取量有減少（' + (assignReduction * 100).toFixed(0) + '%）', assignReduction > 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
