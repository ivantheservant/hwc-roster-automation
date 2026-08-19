// ⚠️⚠️⚠️ 本測試不載入 `src/`，證明的是移植出來的判斷邏輯，不能用來證明正式碼正確。⚠️⚠️⚠️
//
// 第三十二輪批次 Prompt N：呢份係舊版 `tests/e2e_five_stage_flow.test.js` 改名保留低嚟嘅。
// 舊版嘅檔名叫 `e2e_five_stage_flow`，但佢完全冇載入 `src/*.gs`——下面全部函式
// （`stepNewQuarter`／`executeStep3Apply`／`planStep5ChangedList`……）都係手抄一份
// 「移植（去掉試算表存取）核心的判斷／流程控制邏輯」，用嚟驗證嘅係呢份副本，
// 唔係正式碼。正式碼（`src/QuarterStage.gs`／`FiveStageCore.gs`／`WebAppFlow.gs`／
// `RequestsApply.gs`／`Mailer.gs`／`ResendFlow.gs`……）改壞咗，呢份測試照樣全綠，
// 完全偵測唔到。一個叫 e2e 而唔碰 `src/` 嘅測試，比冇測試更差——冇測試至少
// 唔會令人以為安全。
//
// 真正會載入 `src/`、逐個叫真正 `api*()` 入口嘅版本喺
// `tests/e2e_five_stage_flow.test.js`（呢份先係而家嘅 e2e，呢份先淨低做
// 「舊版判斷邏輯有冇自相矛盾」嘅參考用途，唔會再更新去追蹤正式碼嘅改動）。
//
// ─────────────────────────────────────────────────────────────────────
// 以下係原本嘅檔頭說明（保留作歷史紀錄）：
// ─────────────────────────────────────────────────────────────────────
//
// 階段 F：五階段流程端對端模擬測試（新增季度 → 生成初稿 → 寄審閱 → 套用申報 →
// 正式發出 → 改動後重發），作為日後所有改動的回歸測試基準。執行方式：
//   node tests/five_stage_flow_pure_logic.test.js
// 不需要任何額外套件、不連線、不讀寫任何試算表——純 Node.js 內建功能。
//
// 跟開發過程中用過的其他驗證腳本一樣的做法：因為 Google Apps Script 的
// SpreadsheetApp／MailApp／Session 等物件無法在 Node.js 下原樣執行，這裡不是
// 直接載入 .gs 原始碼，而是移植（去掉試算表存取）核心的判斷／流程控制邏輯，
// 用一個記憶體內的假「資料庫」物件模擬 Quarters／ServiceDates／RosterVersions／
// RosterAssignments／Requests／Unavailable／Eligibility／NameMapping／SendLog，
// 貫穿一次完整的敘事，而不是只驗證單一功能。
//
// 移植的規則刻意簡化（只實作 HARD_ELIGIBILITY／HARD_UNAVAILABLE 兩條硬規則，
// 不含 SOFT／SEMI_HARD 那些跟本次流程控制邏輯無關的評分規則）——這些個別規則
// 各自有更專門的判斷邏輯在 src/ 裡（RuleEngine 相關函式），這份測試的重點是
// 「五個步驟銜接起來、Stage 每一步該擋的擋、該放行的放行」這件事本身，不是
// 重新驗證每一條排班規則。
//
// 如果之後修改了 src/FiveStageCore.gs／QuarterStage.gs／RequestsApply.gs／
// ResendFlow.gs 這幾個檔案，跑一次這個腳本，確認下面的敘事依然全部 PASS，
// 是回歸測試的第一道防線。

const RULE_LEVELS = { HARD: 'HARD' };
const QUARTER_STAGE = { DRAFT: 'DRAFT', REVIEW_SENT: 'REVIEW_SENT', REQUESTS_APPLIED: 'REQUESTS_APPLIED', OFFICIAL_SENT: 'OFFICIAL_SENT' };
const REQUEST_TYPE = { CANNOT_SERVE: 'CANNOT_SERVE', DESIGNATED_SERVE: 'DESIGNATED_SERVE' };

// ---- 日期工具（跟 NewQuarterWizard.gs／Utils.gs 同一套算法）----
function shiftDateString_(dateStr, days) {
  const base = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
  const shifted = new Date(base + days * 86400000);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth() + 1, d = shifted.getUTCDate();
  const p = n => (n < 10 ? '0' + n : String(n));
  return y + '-' + p(m) + '-' + p(d);
}
function isSundayDate_(dateStr) {
  const base = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
  return new Date(base).getUTCDay() === 0;
}
function listSundaysInRange_(startDate, endDate) {
  let cursor = startDate;
  while (!isSundayDate_(cursor) && cursor <= endDate) cursor = shiftDateString_(cursor, 1);
  const sundays = [];
  while (cursor <= endDate) { sundays.push(cursor); cursor = shiftDateString_(cursor, 7); }
  return sundays;
}

// ---- 硬規則放行判斷（跟 resolveHardViolationRelease_() 完全同一份邏輯，Stage C 已抽出共用）----
function resolveHardViolationRelease(violations, releaseText) {
  const hard = (violations || []).filter(v => v.severity === RULE_LEVELS.HARD);
  if (hard.length === 0) return true;
  return String(releaseText || '').trim() === '確認放行';
}

// =====================================================================
// 記憶體內的假「資料庫」——模擬各工作表
// =====================================================================
function makeDb() {
  return {
    quarters: {},        // quarterId -> {stage, startDate, endDate}
    serviceDates: {},    // quarterId -> [{serviceDate, weekIndex}]
    posts: [
      { postId: 'CHAIR', slotCount: 1 },
      { postId: 'SONG', slotCount: 1 }
    ],
    people: {
      P1: { nameTC: '陳大文', email: 'p1@x.com' },
      P2: { nameTC: '李小明', email: 'p2@x.com' },
      P3: { nameTC: '黃小芳', email: 'p3@x.com' },
      P_ZERO: { nameTC: '張零派', email: 'pzero@x.com' },     // 特例一：最終零派工
      P_NOEMAIL: { nameTC: '林無電郵', email: '' },            // 特例二：沒有電郵
      P_FIRSTNOTIFY: { nameTC: '黃初次', email: '' },          // 特例三：一開始沒電郵，之後補上 → 首次通知
      P_CONTRA: { nameTC: '何矛盾', email: 'pcontra@x.com' }   // 用於同日矛盾申報組合
    },
    eligibility: {
      CHAIR: new Set(['P1', 'P2', 'P_ZERO', 'P_CONTRA']),
      SONG: new Set(['P1', 'P3', 'P_NOEMAIL', 'P_FIRSTNOTIFY'])
    },
    unavailable: [],     // {personId, dateFrom, dateTo, status: 'ACTIVE'}
    rosterVersions: {},  // quarterId -> [{versionNo, basis}]
    assignments: {},     // quarterId -> versionNo -> [{serviceDate, postId, personId}]
    requests: {},        // quarterId -> [{requestId, serviceDate, postId, personId, type, status}]
    sendLog: [],          // {quarterId, versionNo, stage, personId, outcome}
    lastSentHash: {}      // personId -> 上次寄出時的內容雜湊（供步驟 5 比對改動）
  };
}

// =====================================================================
// 移植：新增季度（對應 NewQuarterWizard.gs）
// =====================================================================
function stepNewQuarter(db, quarterId, startDate, endDate) {
  if (db.quarters[quarterId]) throw new Error(quarterId + ' 已存在，拒絕覆寫');
  const sundays = listSundaysInRange_(startDate, endDate);
  db.quarters[quarterId] = { stage: QUARTER_STAGE.DRAFT };
  db.serviceDates[quarterId] = sundays.map((d, i) => ({ serviceDate: d, weekIndex: i + 1 }));
  db.rosterVersions[quarterId] = [];
  db.assignments[quarterId] = {};
  db.requests[quarterId] = [];
  return { quarterId, sundayCount: sundays.length };
}

// =====================================================================
// 移植：Stage 檢查（對應 requireQuarterStage_()）
// =====================================================================
function requireStage(db, quarterId, allowed, stepName) {
  const q = db.quarters[quarterId];
  if (!q) throw new Error('找不到季度: ' + quarterId);
  if (allowed.indexOf(q.stage) === -1) {
    throw new Error(stepName + '需要 Stage 為「' + allowed.join('/') + '」，但目前是「' + q.stage + '」。');
  }
  return q.stage;
}

// =====================================================================
// 移植：硬規則檢查（只實作 HARD_ELIGIBILITY／HARD_UNAVAILABLE）
// =====================================================================
function isUnavailable(db, personId, date) {
  return db.unavailable.some(u => u.personId === personId && u.status === 'ACTIVE' && date >= u.dateFrom && date <= u.dateTo);
}
function findViolations(db, quarterId, versionNo) {
  const rows = db.assignments[quarterId][versionNo];
  const violations = [];
  rows.forEach(a => {
    if (!a.personId) return;
    if (!db.eligibility[a.postId] || !db.eligibility[a.postId].has(a.personId)) {
      violations.push({ severity: RULE_LEVELS.HARD, ruleId: 'HARD_ELIGIBILITY', serviceDate: a.serviceDate, postId: a.postId, personId: a.personId, reason: '不具備該崗位資格' });
    }
    if (isUnavailable(db, a.personId, a.serviceDate)) {
      violations.push({ severity: RULE_LEVELS.HARD, ruleId: 'HARD_UNAVAILABLE', serviceDate: a.serviceDate, postId: a.postId, personId: a.personId, reason: '該日已登記不可服侍' });
    }
  });
  return violations;
}

// =====================================================================
// 步驟 1：生成初稿（簡化版排班——固定指派，不做評分揀選，因為階段 F 的重點
// 不是排班演算法本身）
// =====================================================================
function planStep1(db, quarterId) {
  requireStage(db, quarterId, [QUARTER_STAGE.DRAFT], '步驟 1：生成初稿');
  const dates = db.serviceDates[quarterId];
  const rows = [];
  dates.forEach((d, i) => {
    // 簡單輪替：CHAIR 在 P1/P2 之間輪，SONG 在 P1/P3 之間輪
    rows.push({ serviceDate: d.serviceDate, postId: 'CHAIR', personId: i % 2 === 0 ? 'P1' : 'P2' });
    rows.push({ serviceDate: d.serviceDate, postId: 'SONG', personId: i % 2 === 0 ? 'P3' : 'P1' });
  });
  return rows;
}
function executeStep1(db, quarterId) {
  const rows = planStep1(db, quarterId);
  db.assignments[quarterId][0] = rows;
  db.rosterVersions[quarterId].push({ versionNo: 0, basis: 'GENERATE' });
  return { versionNo: 0, assignedCount: rows.length };
}

// =====================================================================
// 步驟 2：寄給堂委審閱
// =====================================================================
function executeStep2(db, quarterId) {
  requireStage(db, quarterId, [QUARTER_STAGE.DRAFT], '步驟 2：寄給堂委審閱');
  const versionNo = latestVersion(db, quarterId);
  db.sendLog.push({ quarterId, versionNo, stage: 'REVIEW', personId: 'REVIEWER_LIST', outcome: 'DRY_RUN' });
  db.quarters[quarterId].stage = QUARTER_STAGE.REVIEW_SENT;
  return { versionNo };
}

function latestVersion(db, quarterId) {
  const versions = db.rosterVersions[quarterId];
  if (!versions || versions.length === 0) return -1;
  return Math.max.apply(null, versions.map(v => v.versionNo));
}

// =====================================================================
// 步驟 3：套用修改申報（簡化版 planApplyRequests_／applyRequests_）
// =====================================================================
function pendingRequests(db, quarterId) {
  return db.requests[quarterId].filter(r => !r.requestId);
}

// 跟真實系統的 FiveStageCore.gs 同一種切法：Stage 檢查跟「怎麼分類這批申報」
// 分成兩個函式——後者跟 Stage 完全無關，步驟 3、5 各自帶著自己的 Stage 檢查
// 呼叫同一份分類邏輯，不會因為步驟 5 目前是 OFFICIAL_SENT 就被步驟 3 的
// Stage 檢查誤擋。
//
// 追加階段 AS 同款規則：同一人同一日「不能服侍」與「指定服侍」並存 → 兩筆都 NEEDS_INPUT
function computeRequestPlan(db, quarterId) {
  const pending = pendingRequests(db, quarterId);
  if (pending.length === 0) return { mode: 'NO_PENDING' };

  // 找矛盾組合：同人同日 CANNOT_SERVE + DESIGNATED_SERVE
  const byPersonDate = {};
  pending.forEach(r => {
    const key = r.personId + '|' + r.serviceDate;
    (byPersonDate[key] = byPersonDate[key] || []).push(r);
  });
  const contradictory = new Set();
  Object.values(byPersonDate).forEach(list => {
    const hasCannot = list.some(r => r.type === REQUEST_TYPE.CANNOT_SERVE);
    const hasDesignated = list.some(r => r.type === REQUEST_TYPE.DESIGNATED_SERVE);
    if (hasCannot && hasDesignated) list.forEach(r => contradictory.add(r));
  });

  const results = pending.map(r => {
    if (contradictory.has(r)) {
      return { request: r, category: 'NEEDS_INPUT', reason: '同一人同一日「不能服侍」與「指定服侍」並存，語意矛盾，請刪除其中一筆' };
    }
    if (r.type === REQUEST_TYPE.CANNOT_SERVE) return { request: r, category: 'APPLY' };
    if (r.type === REQUEST_TYPE.DESIGNATED_SERVE) {
      const eligible = db.eligibility[r.postId] && db.eligibility[r.postId].has(r.personId);
      return { request: r, category: eligible ? 'APPLY' : 'CONFIRM', reason: eligible ? undefined : '未曾任該崗位' };
    }
    return { request: r, category: 'NEEDS_INPUT', reason: '無法辨識的申報類型' };
  });
  return { mode: 'HAS_PENDING', results };
}

function planStep3(db, quarterId) {
  const stage = requireStage(db, quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');
  const plan = computeRequestPlan(db, quarterId);
  return Object.assign({ stage: stage }, plan);
}

function executeStep3Apply(db, quarterId, results, acceptConfirm) {
  const baseVersionNo = latestVersion(db, quarterId);
  const newVersionNo = baseVersionNo + 1;
  let rows = db.assignments[quarterId][baseVersionNo].map(a => Object.assign({}, a));

  results.forEach(r => {
    if (r.category === 'NEEDS_INPUT') return;
    if (r.category === 'CONFIRM' && !acceptConfirm) { r.request.status = 'REJECTED'; r.request.requestId = 'REQ-' + Math.random(); return; }

    if (r.request.type === REQUEST_TYPE.CANNOT_SERVE) {
      // 移除該人當日的所有指派，找一個當天未服侍、有資格、當天沒被標不可用的人補上
      rows.forEach(a => {
        if (a.personId === r.request.personId && a.serviceDate === r.request.serviceDate) {
          const busyToday = new Set(rows.filter(x => x.serviceDate === a.serviceDate).map(x => x.personId));
          const candidates = Array.from(db.eligibility[a.postId] || []).filter(p => !busyToday.has(p) && !isUnavailable(db, p, a.serviceDate));
          a.personId = candidates.length > 0 ? candidates[0] : '';
        }
      });
      // 記錄一筆 Unavailable（跟真實系統一樣，CANNOT_SERVE 會順帶登記不可用時段）
      db.unavailable.push({ personId: r.request.personId, dateFrom: r.request.serviceDate, dateTo: r.request.serviceDate, status: 'ACTIVE', source: 'REQUEST' });
    } else if (r.request.type === REQUEST_TYPE.DESIGNATED_SERVE) {
      const slot = rows.find(a => a.serviceDate === r.request.serviceDate && a.postId === r.request.postId);
      if (slot) slot.personId = r.request.personId;
      else rows.push({ serviceDate: r.request.serviceDate, postId: r.request.postId, personId: r.request.personId });
    }
    r.request.requestId = 'REQ-' + Math.random();
    r.request.status = 'APPLIED';
  });

  db.assignments[quarterId][newVersionNo] = rows;
  db.rosterVersions[quarterId].push({ versionNo: newVersionNo, basis: 'REQUESTS_APPLIED' });
  const violations = findViolations(db, quarterId, newVersionNo);

  let advanced = false;
  if (resolveHardViolationRelease(violations, '')) {
    db.quarters[quarterId].stage = QUARTER_STAGE.REQUESTS_APPLIED;
    advanced = true;
  }
  return { versionNo: newVersionNo, violations, advanced };
}

function executeStep3Release(db, quarterId, releaseText) {
  const stage = requireStage(db, quarterId, [QUARTER_STAGE.REVIEW_SENT, QUARTER_STAGE.REQUESTS_APPLIED], '步驟 3：套用修改申報');
  if (stage === QUARTER_STAGE.REQUESTS_APPLIED) return { advanced: false, alreadyAdvanced: true };
  const versionNo = latestVersion(db, quarterId);
  const violations = findViolations(db, quarterId, versionNo);
  if (!resolveHardViolationRelease(violations, releaseText)) return { advanced: false, violations };
  db.quarters[quarterId].stage = QUARTER_STAGE.REQUESTS_APPLIED;
  return { advanced: true };
}

// =====================================================================
// 步驟 4：正式發出
// =====================================================================
function executeStep4(db, quarterId) {
  requireStage(db, quarterId, [QUARTER_STAGE.REQUESTS_APPLIED], '步驟 4：正式發出');
  const versionNo = latestVersion(db, quarterId);
  const rows = db.assignments[quarterId][versionNo];
  const peopleThisVersion = Array.from(new Set(rows.filter(a => a.personId).map(a => a.personId)));

  let sent = 0, skippedNoEmail = 0;
  peopleThisVersion.forEach(personId => {
    const person = db.people[personId];
    const hash = hashPersonAssignments(rows, personId);
    if (!person.email) {
      db.sendLog.push({ quarterId, versionNo, stage: 'OFFICIAL', personId, outcome: 'SKIPPED_NO_EMAIL' });
      skippedNoEmail++;
    } else {
      db.sendLog.push({ quarterId, versionNo, stage: 'OFFICIAL', personId, outcome: 'DRY_RUN' });
      db.lastSentHash[personId] = hash; // 只有真正（或模擬）寄出的人才更新 lastSentHash
      sent++;
    }
  });
  db.quarters[quarterId].stage = QUARTER_STAGE.OFFICIAL_SENT;
  return { versionNo, sent, skippedNoEmail };
}

function hashPersonAssignments(rows, personId) {
  return rows.filter(a => a.personId === personId).map(a => a.serviceDate + '#' + a.postId).sort().join(',');
}

// =====================================================================
// 步驟 5：改動後重發
// =====================================================================
function planStep5(db, quarterId) {
  requireStage(db, quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');
  return computeRequestPlan(db, quarterId); // 分類邏輯跟步驟 3 完全共用，各自帶自己的 Stage 檢查
}
function executeStep5Apply(db, quarterId, results, acceptConfirm) {
  return executeStep3ApplyNoAdvance(db, quarterId, results, acceptConfirm);
}
function executeStep3ApplyNoAdvance(db, quarterId, results, acceptConfirm) {
  // 跟 executeStep3Apply 幾乎一樣，但步驟 5 不前進 Stage（維持 OFFICIAL_SENT）
  const baseVersionNo = latestVersion(db, quarterId);
  const newVersionNo = baseVersionNo + 1;
  let rows = db.assignments[quarterId][baseVersionNo].map(a => Object.assign({}, a));
  results.forEach(r => {
    if (r.category === 'NEEDS_INPUT') return;
    if (r.category === 'CONFIRM' && !acceptConfirm) { r.request.status = 'REJECTED'; r.request.requestId = 'REQ-' + Math.random(); return; }
    if (r.request.type === REQUEST_TYPE.CANNOT_SERVE) {
      rows.forEach(a => {
        if (a.personId === r.request.personId && a.serviceDate === r.request.serviceDate) {
          const busyToday = new Set(rows.filter(x => x.serviceDate === a.serviceDate).map(x => x.personId));
          const candidates = Array.from(db.eligibility[a.postId] || []).filter(p => !busyToday.has(p) && !isUnavailable(db, p, a.serviceDate));
          a.personId = candidates.length > 0 ? candidates[0] : '';
        }
      });
      db.unavailable.push({ personId: r.request.personId, dateFrom: r.request.serviceDate, dateTo: r.request.serviceDate, status: 'ACTIVE', source: 'REQUEST' });
    } else if (r.request.type === REQUEST_TYPE.DESIGNATED_SERVE) {
      const slot = rows.find(a => a.serviceDate === r.request.serviceDate && a.postId === r.request.postId);
      if (slot) slot.personId = r.request.personId; else rows.push({ serviceDate: r.request.serviceDate, postId: r.request.postId, personId: r.request.personId });
    }
    r.request.requestId = 'REQ-' + Math.random();
    r.request.status = 'APPLIED';
  });
  db.assignments[quarterId][newVersionNo] = rows;
  db.rosterVersions[quarterId].push({ versionNo: newVersionNo, basis: 'RESEND' });
  return { versionNo: newVersionNo, violations: findViolations(db, quarterId, newVersionNo) };
}

// 比對改動者：跟上次「真正寄出過」的內容雜湊比較（沒寄出過的人，只要現在有派工，也算改動——首次通知）
function planStep5ChangedList(db, quarterId) {
  requireStage(db, quarterId, [QUARTER_STAGE.OFFICIAL_SENT], '步驟 5：改動後重發');
  const versionNo = latestVersion(db, quarterId);
  const rows = db.assignments[quarterId][versionNo];
  const everyone = Array.from(new Set(rows.filter(a => a.personId).map(a => a.personId).concat(Object.keys(db.lastSentHash))));
  const changed = [];
  everyone.forEach(personId => {
    const hash = hashPersonAssignments(rows, personId);
    const lastHash = db.lastSentHash[personId];
    const hasAssignments = hash !== '';
    const person = db.people[personId];
    if (hash !== (lastHash || '')) {
      changed.push({ personId, hasAssignments, firstNotifyDueToEmail: !lastHash && !!person.email });
    }
  });
  return { versionNo, changedList: changed };
}
function executeStep5Send(db, quarterId, versionNo, changedList) {
  const rows = db.assignments[quarterId][versionNo];
  let sent = 0, skippedNoEmail = 0;
  changedList.forEach(c => {
    const person = db.people[c.personId];
    if (!person.email) { db.sendLog.push({ quarterId, versionNo, stage: 'RESEND', personId: c.personId, outcome: 'SKIPPED_NO_EMAIL' }); skippedNoEmail++; return; }
    db.sendLog.push({ quarterId, versionNo, stage: 'RESEND', personId: c.personId, outcome: 'DRY_RUN' });
    db.lastSentHash[c.personId] = hashPersonAssignments(rows, c.personId);
    sent++;
  });
  return { sent, skippedNoEmail };
}

// =====================================================================
// 測試斷言工具
// =====================================================================
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function expectThrow(label, fn, messageIncludes) {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label}（預期拋錯，但沒有拋錯）`);
  } catch (err) {
    const ok = !messageIncludes || err.message.indexOf(messageIncludes) >= 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) console.log(`      got message="${err.message}"\n      expected to include="${messageIncludes}"`);
  }
}

// =====================================================================
// 敘事開始
// =====================================================================
const db = makeDb();
const Q = '2027T1';

console.log('\n=== 新增季度 ===');
{
  const result = stepNewQuarter(db, Q, '2027-01-01', '2027-03-31');
  check('★ 算出 13 個主日', result.sundayCount, 13);
  check('★ Stage 初始值為 DRAFT', db.quarters[Q].stage, QUARTER_STAGE.DRAFT);
  expectThrow('★ 同一個 QuarterID 再新增一次 → 拒絕覆寫', () => stepNewQuarter(db, Q, '2027-01-01', '2027-03-31'), '已存在');
}

console.log('\n=== 各步驟在錯誤 Stage 執行都要被拒絕（目前 Stage=DRAFT）===');
{
  expectThrow('★ 步驟 3 在 DRAFT 執行 → 拒絕', () => planStep3(db, Q), '步驟 3');
  expectThrow('★ 步驟 4 在 DRAFT 執行 → 拒絕', () => executeStep4(db, Q), '步驟 4');
  expectThrow('★ 步驟 5 在 DRAFT 執行 → 拒絕', () => planStep5(db, Q), '步驟 5');
}

console.log('\n=== 步驟 1：生成初稿（Stage 維持 DRAFT）===');
{
  const result = executeStep1(db, Q);
  check('★ 建立 v0', result.versionNo, 0);
  check('★ 26 格全部派人（13 主日 × 2 崗位）', result.assignedCount, 26);
  check('★ Stage 仍然是 DRAFT（步驟 1 不前進 Stage）', db.quarters[Q].stage, QUARTER_STAGE.DRAFT);
}

console.log('\n=== 步驟 2：寄給堂委審閱（DRAFT → REVIEW_SENT）===');
{
  expectThrow('★ 步驟 4 在 DRAFT 執行仍然拒絕（還沒到步驟 2）', () => executeStep4(db, Q), '步驟 4');
  const result = executeStep2(db, Q);
  check('★ 對應到最新版本 v0', result.versionNo, 0);
  check('★ Stage → REVIEW_SENT', db.quarters[Q].stage, QUARTER_STAGE.REVIEW_SENT);
  expectThrow('★ Stage 已經前進，步驟 2 不能再執行一次（要求 DRAFT）', () => executeStep2(db, Q), '步驟 2');
}

console.log('\n=== 步驟 3：套用修改申報——加入含特例與矛盾組合的申報 ===');
{
  db.requests[Q].push({ personId: 'P1', serviceDate: db.serviceDates[Q][2].serviceDate, postId: 'CHAIR', type: REQUEST_TYPE.CANNOT_SERVE });
  db.requests[Q].push({ personId: 'P_ZERO', serviceDate: db.serviceDates[Q][0].serviceDate, postId: 'CHAIR', type: REQUEST_TYPE.DESIGNATED_SERVE });
  // 特例二／三先透過指定服侍安排上崗，讓步驟 4 真的會嘗試通知他們（兩人此時都還沒有電郵）
  db.requests[Q].push({ personId: 'P_NOEMAIL', serviceDate: db.serviceDates[Q][3].serviceDate, postId: 'SONG', type: REQUEST_TYPE.DESIGNATED_SERVE });
  db.requests[Q].push({ personId: 'P_FIRSTNOTIFY', serviceDate: db.serviceDates[Q][4].serviceDate, postId: 'SONG', type: REQUEST_TYPE.DESIGNATED_SERVE });
  // 矛盾組合：P_CONTRA 同一日「不能服侍」與「指定服侍」並存
  const contraDate = db.serviceDates[Q][5].serviceDate;
  db.requests[Q].push({ personId: 'P_CONTRA', serviceDate: contraDate, postId: 'CHAIR', type: REQUEST_TYPE.CANNOT_SERVE });
  db.requests[Q].push({ personId: 'P_CONTRA', serviceDate: contraDate, postId: 'SONG', type: REQUEST_TYPE.DESIGNATED_SERVE });

  const plan = planStep3(db, Q);
  check('★ mode=HAS_PENDING', plan.mode, 'HAS_PENDING');
  const needsInput = plan.results.filter(r => r.category === 'NEEDS_INPUT');
  check('★ 矛盾組合的兩筆都被判 NEEDS_INPUT', needsInput.length, 2);
  check('★ NEEDS_INPUT 都是 P_CONTRA', needsInput.every(r => r.request.personId === 'P_CONTRA'), true);
  const applyList = plan.results.filter(r => r.category === 'APPLY');
  check('★ 其餘四筆（P1 不能服侍、P_ZERO／P_NOEMAIL／P_FIRSTNOTIFY 指定服侍且本身合資格）可直接套用', applyList.length, 4);

  const result = executeStep3Apply(db, Q, plan.results, true);
  check('★ 套用後建立 v1', result.versionNo, 1);
  check('★ 沒有硬規則違反（矛盾的兩筆被跳過，沒有寫入任何指派）', result.violations.length, 0);
  check('★ 沒有違反 → 自動前進 Stage', result.advanced, true);
  check('★ Stage → REQUESTS_APPLIED', db.quarters[Q].stage, QUARTER_STAGE.REQUESTS_APPLIED);
  check('★ P1 在第 3 週已經不再擔任 CHAIR（被 CANNOT_SERVE 頂替）',
    db.assignments[Q][1].find(a => a.serviceDate === db.serviceDates[Q][2].serviceDate && a.postId === 'CHAIR').personId !== 'P1', true);
  check('★ P_ZERO 第 1 週被指定擔任 CHAIR', db.assignments[Q][1].find(a => a.serviceDate === db.serviceDates[Q][0].serviceDate && a.postId === 'CHAIR').personId, 'P_ZERO');
}

console.log('\n=== 步驟 3：硬規則違反時不放行、Stage 停住，修正後重跑才前進 ===');
{
  // 手動注入一個違反資格的指派，模擬「套用申報後出現硬規則違反」的情境
  db.assignments[Q][1].push({ serviceDate: db.serviceDates[Q][0].serviceDate, postId: 'CHAIR', personId: 'P3' }); // P3 沒有 CHAIR 資格

  db.quarters[Q].stage = QUARTER_STAGE.REVIEW_SENT; // 模擬回到「還沒放行」的狀態以便測試 executeStep3Release
  const violations = findViolations(db, Q, 1);
  check('★ 手動注入的違規被偵測到（HARD_ELIGIBILITY）', violations.some(v => v.ruleId === 'HARD_ELIGIBILITY' && v.personId === 'P3'), true);

  const releaseFail = executeStep3Release(db, Q, '亂打文字');
  check('★ 文字不是「確認放行」→ 不放行', releaseFail.advanced, false);
  check('★ Stage 仍然停在 REVIEW_SENT（沒有被錯誤放行）', db.quarters[Q].stage, QUARTER_STAGE.REVIEW_SENT);

  // 幹事修正：移除違規指派
  db.assignments[Q][1] = db.assignments[Q][1].filter(a => !(a.serviceDate === db.serviceDates[Q][0].serviceDate && a.postId === 'CHAIR' && a.personId === 'P3'));
  const releaseOk = executeStep3Release(db, Q, '確認放行');
  check('★ 修正後打「確認放行」→ 前進', releaseOk.advanced, true);
  check('★ Stage → REQUESTS_APPLIED', db.quarters[Q].stage, QUARTER_STAGE.REQUESTS_APPLIED);
}

console.log('\n=== 步驟 4：正式發出（含無電郵特例）===');
{
  expectThrow('★ 步驟 5 在 REQUESTS_APPLIED 執行 → 拒絕（還沒到步驟 4）', () => planStep5(db, Q), '步驟 5');
  const result = executeStep4(db, Q);
  check('★ Stage → OFFICIAL_SENT', db.quarters[Q].stage, QUARTER_STAGE.OFFICIAL_SENT);
  const noEmailLog = db.sendLog.filter(l => l.stage === 'OFFICIAL' && l.outcome === 'SKIPPED_NO_EMAIL');
  check('★ 特例二／三首次正式發出時都還沒有電郵 → 兩人都被記為 SKIPPED_NO_EMAIL（非空集合，真的驗證到了）',
    ['P_NOEMAIL', 'P_FIRSTNOTIFY'].every(p => noEmailLog.some(l => l.personId === p)), true);
}

console.log('\n=== 步驟 5：剛正式發出——沒有電郵的人從來沒有真正收過通知，一開始就會顯示待處理 ===');
{
  // P_NOEMAIL／P_FIRSTNOTIFY 剛才在步驟 4 都因為沒有電郵被略過，等於「從來沒有成功通知過」，
  // 所以「有沒有改動」的判斷不能只看「派工內容有沒有變」，還要看「上次是否真的成功寄出過」——
  // 這兩人派工內容雖然沒變，但因為從未成功送達，理應仍然算「待處理」，不能被當成「沒有改動」。
  const changed = planStep5ChangedList(db, Q);
  check('★ 兩人都還在待處理名單（不是「沒有改動」，是「從來沒有成功通知過」）',
    changed.changedList.map(c => c.personId).sort(), ['P_FIRSTNOTIFY', 'P_NOEMAIL']);
  check('★ 已經成功收過信的人（例如 P1）不會被誤判為待處理', changed.changedList.some(c => c.personId === 'P1'), false);
}

console.log('\n=== 步驟 5：改動後重發——三個特例人物 ===');
{
  // 特例一：P_ZERO 現在被踢出 CHAIR（CANNOT_SERVE 他唯一的一格），變成本季真正零派工
  const zeroDate = db.assignments[Q][latestVersion(db, Q)].find(a => a.personId === 'P_ZERO');
  check('（前置條件）P_ZERO 目前確實有一格指派，才有得取消', !!zeroDate, true);
  db.requests[Q].push({ personId: 'P_ZERO', serviceDate: zeroDate.serviceDate, postId: 'CHAIR', type: REQUEST_TYPE.CANNOT_SERVE });

  // 特例二：P_NOEMAIL 派工內容維持不變，仍然沒有電郵——刻意不動他，用來示範「沒有電郵的人
  // 會一直卡在待處理名單，直到有人補上電郵或撤回他的指派為止」，不會因為「反正上次也沒寄成」
  // 就被系統悄悄放棄不再提醒。
  //
  // ⚠️ 呢個「移植」出嚟嘅假設，同真正 `src/ResendFlow.gs`／`src/Mailer.gs` 實際行為
  // 對唔上，而且第三十三輪批次階段 A 之後差異又變咗一次。真正嘅行為係：
  //
  //   1. `computeResendDiff_()` 要求 `nowHasEmail` 為真先會標記
  //      `firstNotifyDueToEmail`。**無電郵嘅人喺 hash 冇變嘅情況下根本唔會
  //      出現喺 changed 名單度**——唔會好似呢份純邏輯版咁「一直卡住等人補電郵」。
  //   2. 補上電郵之後嗰一輪，佢先至出現一次、真正被寄出，之後就唔會再出現
  //      （第三十三輪階段 A 之前有 bug，會被 `deliverOne_()` 嘅 hash 關卡擋住
  //      而變成死循環；而家已經修好）。
  //
  // 對照見 `tests/e2e_five_stage_flow.test.js`「步驟 5：剛正式發出，未有任何改動」
  // 同 `tests/resend_first_notify_after_email.test.js`（由真入口叫落去嗰份）。
  // 呢度淨係反映呢份「純邏輯」版本自己嘅假設，唔代表正式碼咁做。

  // 特例三：P_FIRSTNOTIFY 派工內容完全不變，只是現在補上電郵——即使指派沒變，也要被判定為需要通知
  db.people.P_FIRSTNOTIFY.email = 'firstnotify@x.com';

  const plan = planStep5(db, Q);
  check('★ 這一輪有待處理申報', plan.mode, 'HAS_PENDING');
  const applyResult = executeStep5Apply(db, Q, plan.results, true);
  const versionNo = applyResult.versionNo;
  check('★ Stage 維持 OFFICIAL_SENT（步驟 5 不前進 Stage）', db.quarters[Q].stage, QUARTER_STAGE.OFFICIAL_SENT);
  check('★ P_ZERO 這一版真的一格都沒有了', db.assignments[Q][versionNo].some(a => a.personId === 'P_ZERO'), false);
  check('★ P_NOEMAIL 完全沒有被動過，這一版仍然有他的指派', db.assignments[Q][versionNo].some(a => a.personId === 'P_NOEMAIL'), true);

  const changed = planStep5ChangedList(db, Q);
  const zeroEntry = changed.changedList.find(c => c.personId === 'P_ZERO');
  const noEmailEntry = changed.changedList.find(c => c.personId === 'P_NOEMAIL');
  const firstNotifyEntry = changed.changedList.find(c => c.personId === 'P_FIRSTNOTIFY');

  check('★ 特例一（零派工）：P_ZERO 出現在改動名單，且 hasAssignments=false（本季已無服侍安排，仍要通知一聲）',
    zeroEntry && zeroEntry.hasAssignments, false);
  check('★ 特例二（無電郵）：派工內容完全沒變，仍然因為「從未成功通知過」持續出現在待處理名單',
    noEmailEntry && noEmailEntry.hasAssignments, true);
  check('★ 特例三（首次通知）：P_FIRSTNOTIFY 派工內容沒變、只是補上電郵 → 仍被標記為需要通知，且 hasAssignments=true',
    firstNotifyEntry && firstNotifyEntry.firstNotifyDueToEmail && firstNotifyEntry.hasAssignments, true);

  const sendResult = executeStep5Send(db, Q, versionNo, changed.changedList);
  check('★ P_NOEMAIL 寄送時因為仍然沒有電郵被略過', db.sendLog.some(l => l.stage === 'RESEND' && l.personId === 'P_NOEMAIL' && l.outcome === 'SKIPPED_NO_EMAIL'), true);
  check('★ P_ZERO 有電郵，零派工的「取消通知」仍然真正寄出（不是因為沒電郵被略過）',
    db.sendLog.some(l => l.stage === 'RESEND' && l.personId === 'P_ZERO' && l.outcome === 'DRY_RUN'), true);
  check('★ P_FIRSTNOTIFY 這次真正「寄出」（模擬），Stage 仍是 OFFICIAL_SENT', db.quarters[Q].stage, QUARTER_STAGE.OFFICIAL_SENT);
}

console.log('\n=== 步驟 5：重複執行——P_NOEMAIL 沒有電郵，會一直卡在待處理名單，不會被系統悄悄放棄 ===');
{
  const changed = planStep5ChangedList(db, Q);
  check('★ 上一輪已經全部處理過，理論上「有變動」的都處理完了，但 P_NOEMAIL 因為沒有電郵、從未成功通知過，仍然出現',
    changed.changedList.map(c => c.personId), ['P_NOEMAIL']);
  const sendResult = executeStep5Send(db, Q, latestVersion(db, Q), changed.changedList);
  check('★ 再次嘗試寄送，仍然因為沒有電郵被略過（不是漏測，是同一件事每次重跑結果都要一致）',
    sendResult, { sent: 0, skippedNoEmail: 1 });
}

console.log('\n=== 步驟 5：幹事到 NameMapping 幫 P_NOEMAIL 補上電郵之後，重跑就能真正寄出、之後真的沒有改動了 ===');
{
  db.people.P_NOEMAIL.email = 'noemail-fixed@x.com';
  const changed = planStep5ChangedList(db, Q);
  check('★ 補上電郵後，P_NOEMAIL 仍然出現在待處理名單（現在總算真的能寄了）', changed.changedList.map(c => c.personId), ['P_NOEMAIL']);
  const sendResult = executeStep5Send(db, Q, latestVersion(db, Q), changed.changedList);
  check('★ 這次真正寄出（模擬），不再略過', sendResult, { sent: 1, skippedNoEmail: 0 });

  const finalCheck = planStep5ChangedList(db, Q);
  check('★ 全部人都已經成功通知過 → 重跑一次，changedList 終於真的是空的', finalCheck.changedList.length, 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
