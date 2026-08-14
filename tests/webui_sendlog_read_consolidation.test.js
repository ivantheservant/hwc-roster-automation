// 階段 D（收尾輪）：apiGetFlowState() 的 SendLog 讀取合併優化回歸測試。
// 執行方式：node tests/webui_sendlog_read_consolidation.test.js
//
// 背景：apiGetFlowState()（WebAppFlow.gs，Web UI 幾乎每次操作後都會呼叫一次
// ——見 ui/Script.html 的 closeWizardAndRefresh()）原本對步驟 2／4／5 各自呼叫
// findLastSendTimestamp_()，即各自獨立完整讀一次 SendLog。SendLog 只會隨使用
// 時間單調增長、沒有歸檔機制（見 docs/系統範圍稽核.md 階段 D 的規模壓力評估），
// 三次重複讀取是純粹浪費。改成 findLastSendTimestampsByStage_()，一次過讀完
// SendLog、三個階段的最後寄送時間一次算齊。這裡驗證：(1) 合併後算出的結果跟
// 逐一分開算完全一致（純粹的效能重構，不改變行為）；(2) 底層資料只被讀取一次
// （用呼叫次數計數的假 readSheet 驗證）。

// ---- 移植：findLastSendTimestampsByStage_()（WebAppFlow.gs，readSheet 換成
//      可注入的假函式，方便計數呼叫次數）----
function findLastSendTimestampsByStage_(readSendLogFn, quarterId, stages) {
  const latestByStage = {};
  stages.forEach(function (s) { latestByStage[s] = null; });

  readSendLogFn().forEach(function (row) {
    if (row.quarterId !== quarterId) return;
    const stage = row.stage;
    if (stages.indexOf(stage) === -1) return;
    const sentAt = String(row.sentAt || '');
    if (sentAt && (!latestByStage[stage] || sentAt > latestByStage[stage])) latestByStage[stage] = sentAt;
  });
  return latestByStage;
}

// ---- 移植：舊版逐階段各自呼叫的寫法（用來驗證新版結果一致）----
function findLastSendTimestamp_(readSendLogFn, quarterId, stage) {
  let latest = null;
  readSendLogFn().forEach(function (row) {
    if (row.quarterId !== quarterId || row.stage !== stage) return;
    const sentAt = String(row.sentAt || '');
    if (sentAt && (!latest || sentAt > latest)) latest = sentAt;
  });
  return latest;
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const sendLog = [
  { quarterId: '2027T1', stage: 'REVIEW', sentAt: '2027-01-01 09:00:00' },
  { quarterId: '2027T1', stage: 'REVIEW', sentAt: '2027-01-02 09:00:00' }, // 較新，應該取這一筆
  { quarterId: '2027T1', stage: 'OFFICIAL', sentAt: '2027-02-01 09:00:00' },
  { quarterId: '2027T1', stage: 'RESEND', sentAt: '2027-02-15 09:00:00' },
  { quarterId: '2027T1', stage: 'RESEND', sentAt: '2027-02-10 09:00:00' }, // 較舊，不應該取這一筆
  { quarterId: '2026T4', stage: 'OFFICIAL', sentAt: '2026-11-01 09:00:00' } // 不同季度，不應該計入
];

console.log('\n=== 合併版本 findLastSendTimestampsByStage_() 一次算齊三個階段，結果跟逐一分開算完全一致 ===');
{
  const readFn = function () { return sendLog; };
  const combined = findLastSendTimestampsByStage_(readFn, '2027T1', ['REVIEW', 'OFFICIAL', 'RESEND']);
  const separate = {
    REVIEW: findLastSendTimestamp_(readFn, '2027T1', 'REVIEW'),
    OFFICIAL: findLastSendTimestamp_(readFn, '2027T1', 'OFFICIAL'),
    RESEND: findLastSendTimestamp_(readFn, '2027T1', 'RESEND')
  };
  check('★ 合併版本與逐一分開算的結果完全一致', combined, separate);
  check('★ REVIEW 取到較新那筆（2027-01-02）', combined.REVIEW, '2027-01-02 09:00:00');
  check('★ RESEND 取到較新那筆（2027-02-15，不是排在後面但較舊的 2027-02-10）', combined.RESEND, '2027-02-15 09:00:00');
  check('★ 不同季度的紀錄不會混入', combined.OFFICIAL, '2027-02-01 09:00:00');
}

console.log('\n=== 完全沒有紀錄的階段回傳 null，不是 undefined 或拋錯 ===');
{
  const readFn = function () { return sendLog; };
  const combined = findLastSendTimestampsByStage_(readFn, '2027T1', ['GENERATE']);
  check('★ 沒有任何 GENERATE 紀錄 → null', combined.GENERATE, null);
}

console.log('\n=== 效能：合併版本只呼叫一次底層讀取，不論查詢幾多個階段 ===');
{
  let callCount = 0;
  const countingReadFn = function () { callCount++; return sendLog; };
  findLastSendTimestampsByStage_(countingReadFn, '2027T1', ['REVIEW', 'OFFICIAL', 'RESEND']);
  check('★ 查詢 3 個階段，底層讀取只呼叫 1 次（舊版逐一呼叫會是 3 次）', callCount, 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
