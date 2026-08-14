// 階段 B（第五輪批次）：全部季度待處理 Requests 殘留＋矛盾組合提早偵測的
// 回歸測試。
// 執行方式：node tests/pending_requests_scan.test.js
// 移植 RequestsApply.gs 的 scanPendingRequestsAllQuarters_()／
// buildRequestConflictKeys_()（逐字對應正式碼的判斷邏輯，只是資料來源
// 換成記憶體假 db，不讀試算表）。全部姓名虛構。

const REQUEST_TYPE = { CANNOT_SERVE: '不能服侍', DESIGNATED_SERVE: '指定服侍' };
const QUARTER_STAGE = { DRAFT: 'DRAFT', REVIEW_SENT: 'REVIEW_SENT', REQUESTS_APPLIED: 'REQUESTS_APPLIED', OFFICIAL_SENT: 'OFFICIAL_SENT' };

function makeDb() {
  return {
    requests: [], // {quarterId, requestId, serviceDateText, personNameText, requestType}
    quarterStages: {}, // quarterId -> stage
    nameToPersonId: {} // 姓名 -> PersonID（模擬 resolvePersonId）
  };
}
function resolvePersonId_(db, name) { return db.nameToPersonId[name] || ''; }
function getQuarterStage_(db, quarterId) {
  return db.quarterStages[quarterId] || QUARTER_STAGE.DRAFT;
}

// ---- 移植：readPendingRequests_()（簡化：只留 RequestID 是否空白這個判斷條件，
//      去掉四欄齊全與否的過濾，因為這裡的假資料一律齊全）----
function readPendingRequests_(db, quarterId) {
  return db.requests.filter(function (r) {
    return r.quarterId === quarterId && !r.requestId;
  });
}

// ---- 移植：RequestsApply.gs 的 buildRequestConflictKeys_()（逐字相同）----
function buildRequestConflictKeys_(pending, db) {
  const typesByKey = {};
  pending.forEach(function (req) {
    const personId = resolvePersonId_(db, req.personNameText);
    if (!personId) return;
    const key = personId + '|' + req.serviceDateText;
    if (!typesByKey[key]) typesByKey[key] = {};
    typesByKey[key][req.requestType] = true;
  });
  const conflicts = {};
  Object.keys(typesByKey).forEach(function (key) {
    if (typesByKey[key][REQUEST_TYPE.CANNOT_SERVE] && typesByKey[key][REQUEST_TYPE.DESIGNATED_SERVE]) {
      conflicts[key] = true;
    }
  });
  return conflicts;
}

// ---- 移植：scanPendingRequestsAllQuarters_()（逐字對應正式碼的邏輯順序）----
function scanPendingRequestsAllQuarters_(db) {
  const seen = {};
  const allQuarterIds = [];
  db.requests.forEach(function (r) {
    if (r.quarterId && !seen[r.quarterId]) { seen[r.quarterId] = true; allQuarterIds.push(r.quarterId); }
  });

  return allQuarterIds.map(function (quarterId) {
    const pending = readPendingRequests_(db, quarterId);
    const conflictKeys = buildRequestConflictKeys_(pending, db);
    const conflictDetails = Object.keys(conflictKeys).map(function (key) {
      const sep = key.indexOf('|');
      const personId = key.slice(0, sep);
      const date = key.slice(sep + 1);
      const requests = pending.filter(function (r) { return resolvePersonId_(db, r.personNameText) === personId && r.serviceDateText === date; });
      return { personId: personId, date: date, requests: requests };
    });
    const stage = getQuarterStage_(db, quarterId);
    return {
      quarterId: quarterId, stage: stage, pendingCount: pending.length,
      conflictCount: conflictDetails.length, conflictDetails: conflictDetails,
      isOfficialSentWithPending: stage === QUARTER_STAGE.OFFICIAL_SENT && pending.length > 0
    };
  }).filter(function (r) { return r.pendingCount > 0; });
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== B1：按季度分組列出待處理申報，附上該季度目前 Stage ===');
{
  const db = makeDb();
  db.nameToPersonId = { '陳大文': 'P001', '李小明': 'P002' };
  db.quarterStages = { '2026T4': QUARTER_STAGE.OFFICIAL_SENT, '2027T1': QUARTER_STAGE.REQUESTS_APPLIED };
  db.requests = [
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-04', personNameText: '陳大文', requestType: REQUEST_TYPE.CANNOT_SERVE },
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-04', personNameText: '陳大文', requestType: REQUEST_TYPE.DESIGNATED_SERVE },
    { quarterId: '2027T1', requestId: 'REQ-已處理', serviceDateText: '2027-02-01', personNameText: '李小明', requestType: REQUEST_TYPE.CANNOT_SERVE } // 已處理，不算待處理
  ];

  const result = scanPendingRequestsAllQuarters_(db);
  check('★ 只有 2026T4 出現在結果（2027T1 那筆已經有 RequestID，不算待處理）', result.map(r => r.quarterId), ['2026T4']);
  check('★ 2026T4 待處理筆數 = 2', result[0].pendingCount, 2);
  check('★ 2026T4 目前 Stage 正確帶出', result[0].stage, QUARTER_STAGE.OFFICIAL_SENT);
}

console.log('\n=== 已 OFFICIAL_SENT 但仍有待處理申報：明確標示 ===');
{
  const db = makeDb();
  db.nameToPersonId = { '王美美': 'P003' };
  db.quarterStages = { '2026T4': QUARTER_STAGE.OFFICIAL_SENT };
  db.requests = [
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-11-01', personNameText: '王美美', requestType: REQUEST_TYPE.DESIGNATED_SERVE }
  ];
  const result = scanPendingRequestsAllQuarters_(db);
  check('★ isOfficialSentWithPending=true', result[0].isOfficialSentWithPending, true);

  // 對照組：同樣有待處理，但 Stage 還在 DRAFT（正常流程中，不算異常）
  const db2 = makeDb();
  db2.nameToPersonId = { '王美美': 'P003' };
  db2.quarterStages = { '2027T2': QUARTER_STAGE.DRAFT };
  db2.requests = [
    { quarterId: '2027T2', requestId: '', serviceDateText: '2027-05-01', personNameText: '王美美', requestType: REQUEST_TYPE.DESIGNATED_SERVE }
  ];
  const result2 = scanPendingRequestsAllQuarters_(db2);
  check('★ DRAFT 階段有待處理不算「已發出仍殘留」', result2[0].isOfficialSentWithPending, false);
}

console.log('\n=== B2：矛盾組合提早偵測（不需要已生成版本，只看 Requests 本身）===');
{
  const db = makeDb();
  db.nameToPersonId = { '陳大文': 'P001', '李小明': 'P002' };
  db.quarterStages = { '2026T4': QUARTER_STAGE.DRAFT };
  db.requests = [
    // 陳大文同一日矛盾組合
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-04', personNameText: '陳大文', requestType: REQUEST_TYPE.CANNOT_SERVE },
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-04', personNameText: '陳大文', requestType: REQUEST_TYPE.DESIGNATED_SERVE },
    // 李小明同一日兩筆「指定服侍」但崗位不同（假設不同申報行）—— 不算矛盾
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-11', personNameText: '李小明', requestType: REQUEST_TYPE.DESIGNATED_SERVE },
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-11', personNameText: '李小明', requestType: REQUEST_TYPE.DESIGNATED_SERVE }
  ];
  const result = scanPendingRequestsAllQuarters_(db);
  check('★ 偵測到 1 組矛盾（陳大文 2026-10-04）', result[0].conflictCount, 1);
  check('★ 矛盾組合的 personId／date 正確', [result[0].conflictDetails[0].personId, result[0].conflictDetails[0].date], ['P001', '2026-10-04']);
  check('★ 李小明同日兩筆「指定服侍」不算矛盾（同崗位兼任常見情況）',
    result[0].conflictDetails.every(c => c.personId !== 'P002'), true);
}

console.log('\n=== 沒有矛盾、沒有殘留時，結果應為空陣列 ===');
{
  const db = makeDb();
  db.nameToPersonId = { '陳大文': 'P001' };
  db.quarterStages = { '2027T1': QUARTER_STAGE.REVIEW_SENT };
  db.requests = [
    { quarterId: '2027T1', requestId: 'REQ-1', serviceDateText: '2027-02-01', personNameText: '陳大文', requestType: REQUEST_TYPE.CANNOT_SERVE }
  ];
  const result = scanPendingRequestsAllQuarters_(db);
  check('★ 全部申報都已處理（有 RequestID）→ 沒有任何季度出現在結果', result, []);

  const emptyDb = makeDb();
  check('★ Requests 完全沒有資料 → 空陣列', scanPendingRequestsAllQuarters_(emptyDb), []);
}

console.log('\n=== 不會改動任何資料：純讀取函式對輸入資料沒有副作用 ===');
{
  const db = makeDb();
  db.nameToPersonId = { '陳大文': 'P001' };
  db.quarterStages = { '2026T4': QUARTER_STAGE.OFFICIAL_SENT };
  db.requests = [
    { quarterId: '2026T4', requestId: '', serviceDateText: '2026-10-04', personNameText: '陳大文', requestType: REQUEST_TYPE.CANNOT_SERVE }
  ];
  const before = JSON.stringify(db.requests);
  scanPendingRequestsAllQuarters_(db);
  const after = JSON.stringify(db.requests);
  check('★ db.requests 內容在呼叫前後完全相同', after, before);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
