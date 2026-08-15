// 階段 A（本輪）：底色語意撞車 bug 的回歸測試。
// 執行方式：node tests/pending_backfill_classification.test.js
//
// 背景（2027T1 實測發現的真實問題）：步驟 4 執行前的「有未完成事項」視窗
// 誤報「仍有 2 格待補」，列出的兩格其實都有人，只是因為指定服侍申報套用
// 後觸發了 SEMI_NO_CONSECUTIVE 規則警告。原因是 GRID_COLORS.WARNING 與
// DEFAULTS.GRID_PENDING_FILL_COLOR 兩者預設同色（#FFF2CC），而
// listPendingBackfillCells_()（RequestsApply.gs）舊版純靠底色比對判斷
// 「是不是待補格」，完全沒有核對 PersonID／AssignSource／RuleFlags。
//
// 修正後 listPendingBackfillCells_() 改成從 RosterAssignments 資料層判斷：
// PersonID 空 + AssignSource=SKIPPED + RuleFlags 含 HARD_ELIGIBILITY 才是
// 待補格。這份測試把該判斷邏輯逐字移植出來（readSheet() 換成傳入陣列，
// 跟本專案其他測試檔一貫的做法一致），常數（RULE_IDS／ASSIGN_SOURCE）
// 則直接用 gas_loader 載入 Constants.gs 的正式碼，避免測試用的常數值
// 跟正式碼漂移。

const { loadGasSource } = require('./helpers/gas_loader.js');
const gas = loadGasSource(['Constants.gs', 'Utils.gs']);

const RULE_IDS = gas.RULE_IDS;
const ASSIGN_SOURCE = gas.ASSIGN_SOURCE;
const GRID_COLORS = gas.GRID_COLORS;
const DEFAULTS = gas.DEFAULTS;
const splitList_ = gas.splitList_;

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
// 移植：listPendingBackfillCells_() 修正後的資料層分類邏輯（逐字對應
// RequestsApply.gs，readSheet(SHEETS.ROSTER_ASSIGNMENTS) 換成傳入陣列）
// ---------------------------------------------------------------------------
function classifyPendingBackfillKeys_(rows, quarterId, versionNo) {
  const pendingKeys = {};
  rows.forEach(function (row) {
    if (row.quarterId !== quarterId || Number(row.versionNo) !== versionNo) return;
    if (row.personId || row.assignSource !== ASSIGN_SOURCE.SKIPPED) return;
    if (splitList_(row.ruleFlags).indexOf(RULE_IDS.ELIGIBILITY) === -1) return;
    pendingKeys[row.serviceDate + '|' + row.postId + '|' + String(row.slotIndex)] = true;
  });
  return pendingKeys;
}

// 反證組：修正前的舊邏輯（純底色比對），用來證明這份測試真的測到了
// 「底色語意撞車」這個問題，而不是隨便斷言一個本來就不會錯的東西。
function classifyPendingBackfillKeysByColorOnly_(rows, fillColor) {
  const pendingKeys = {};
  rows.forEach(function (row) {
    if (String(row.cellColor || '').toUpperCase() !== String(fillColor).toUpperCase()) return;
    pendingKeys[row.serviceDate + '|' + row.postId + '|' + String(row.slotIndex)] = true;
  });
  return pendingKeys;
}

// ---------------------------------------------------------------------------
// 假資料：模擬 2027T1 實測的情境——2 格真正待補、2 格是指定服侍套用後
// 觸發 SEMI_NO_CONSECUTIVE 警告的格子（有人，不是待補），全部人名虛構。
// ---------------------------------------------------------------------------
const QUARTER_ID = '2099T1';
const VERSION_NO = 3;

const rows = [
  // 真正待補：Generator.gs 留空格（找不到不違反硬規則的人選）
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-01-10',
    postId: 'SCRIPTURE', slotIndex: 1, personId: '', assignSource: ASSIGN_SOURCE.SKIPPED,
    ruleFlags: RULE_IDS.ELIGIBILITY, cellColor: GRID_COLORS.WARNING
  },
  // 真正待補：applyCannotServe_() 找不到替補
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-02-14',
    postId: 'SOUND', slotIndex: 1, personId: '', assignSource: ASSIGN_SOURCE.SKIPPED,
    ruleFlags: RULE_IDS.ELIGIBILITY, cellColor: DEFAULTS.GRID_PENDING_FILL_COLOR
  },
  // 誤判來源 1：指定服侍套用後，有人但觸發 SEMI_NO_CONSECUTIVE 警告
  // （對應 2027T1 實測的「2027-01-10 SCRIPTURE#1」）
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-03-07',
    postId: 'SCRIPTURE', slotIndex: 1, personId: 'P-CHAN-TAI-MING', assignSource: ASSIGN_SOURCE.MANUAL,
    ruleFlags: RULE_IDS.NO_CONSECUTIVE, cellColor: GRID_COLORS.WARNING
  },
  // 誤判來源 2：同上，不同崗位（對應「2027-03-07 SOUND#1」）
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-03-21',
    postId: 'SOUND', slotIndex: 1, personId: 'P-WONG-SIU-FAN', assignSource: ASSIGN_SOURCE.MANUAL,
    ruleFlags: RULE_IDS.NO_CONSECUTIVE, cellColor: GRID_COLORS.WARNING
  },
  // 正常格子：有人、無警告，作為對照組
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-01-17',
    postId: 'CHAIR', slotIndex: 1, personId: 'P-LEE-KA-YAN', assignSource: ASSIGN_SOURCE.AUTO,
    ruleFlags: '', cellColor: null
  },
  // 結構性不適用（例如講員崗位不自動生成）：SKIPPED 但沒有 ELIGIBILITY 旗標，
  // 不該被當成待補
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-01-17',
    postId: 'PREACHER', slotIndex: 1, personId: '', assignSource: ASSIGN_SOURCE.SKIPPED,
    ruleFlags: '', cellColor: null
  },
  // 其他版本／季度的資料，不應該混進來
  {
    quarterId: QUARTER_ID, versionNo: VERSION_NO - 1, serviceDate: '2099-01-10',
    postId: 'SCRIPTURE', slotIndex: 1, personId: '', assignSource: ASSIGN_SOURCE.SKIPPED,
    ruleFlags: RULE_IDS.ELIGIBILITY, cellColor: GRID_COLORS.WARNING
  }
];

console.log('\n=== 前提：GRID_COLORS.WARNING 與 DEFAULTS.GRID_PENDING_FILL_COLOR 現在刻意不同色（A4 修正） ===');
{
  check('★ 兩者不再同色（A2 的資料層修正才是主要防線，這是第二層防線）',
    GRID_COLORS.WARNING.toUpperCase() !== DEFAULTS.GRID_PENDING_FILL_COLOR.toUpperCase());
}

console.log('\n=== 反證：修正前的純底色比對邏輯，會把有人的規則警告格誤判成待補格 ===');
{
  // 重建「A4 改色之前」的舊世界：GRID_COLORS.WARNING 與
  // DEFAULTS.GRID_PENDING_FILL_COLOR 兩者當年同為 #FFF2CC，這裡把凡是
  // 現在標成這兩種語意底色的格子，一律改回舊世界共用的那個顏色，證明
  // 「只靠底色」這個判斷方式本身就是危險的，不是修正前資料剛好沒踩到。
  const oldPendingColor = GRID_COLORS.WARNING; // 修正前 DEFAULTS.GRID_PENDING_FILL_COLOR 跟這個同值
  const collidedRows = rows.map(function (r) {
    const isWarningOrPending = r.cellColor === GRID_COLORS.WARNING || r.cellColor === DEFAULTS.GRID_PENDING_FILL_COLOR;
    return Object.assign({}, r, { cellColor: isWarningOrPending ? oldPendingColor : r.cellColor });
  });
  const buggyKeys = classifyPendingBackfillKeysByColorOnly_(collidedRows, oldPendingColor);
  check('★ 純底色比對會把「2099-03-07 SCRIPTURE#1」（有人、有警告）誤判成待補格',
    buggyKeys['2099-03-07|SCRIPTURE|1'] === true);
  check('★ 純底色比對會把「2099-03-21 SOUND#1」（有人、有警告）誤判成待補格',
    buggyKeys['2099-03-21|SOUND|1'] === true);
  checkEqual('★ 純底色比對誤判出 4 格待補（2 真 + 2 誤判），這正是 2027T1 實測「報告 2 格」的成因規模',
    Object.keys(buggyKeys).length, 4);
}

console.log('\n=== 修正後：資料層判斷不受底色影響，正確分辨「真待補」與「有人但有警告」 ===');
{
  const correctKeys = classifyPendingBackfillKeys_(rows, QUARTER_ID, VERSION_NO);

  check('★ 真正待補格「2099-01-10 SCRIPTURE#1」（留空格）被正確分類為待補',
    correctKeys['2099-01-10|SCRIPTURE|1'] === true);
  check('★ 真正待補格「2099-02-14 SOUND#1」（找不到替補）被正確分類為待補',
    correctKeys['2099-02-14|SOUND|1'] === true);

  check('★★ 核心斷言：有人但觸發規則警告的「2099-03-07 SCRIPTURE#1」不再被誤判為待補格',
    correctKeys['2099-03-07|SCRIPTURE|1'] === undefined,
    '這格 PersonID 是 P-CHAN-TAI-MING、AssignSource 是 MANUAL——有人，只是有規則警告，不該出現在待補清單');
  check('★★ 核心斷言：有人但觸發規則警告的「2099-03-21 SOUND#1」不再被誤判為待補格',
    correctKeys['2099-03-21|SOUND|1'] === undefined,
    '這格 PersonID 是 P-WONG-SIU-FAN、AssignSource 是 MANUAL——有人，只是有規則警告，不該出現在待補清單');

  check('★ 正常格子（有人、無警告）本來就不該出現在待補清單', correctKeys['2099-01-17|CHAIR|1'] === undefined);
  check('★ 結構性不適用格子（SKIPPED 但沒有 ELIGIBILITY 旗標）不該出現在待補清單',
    correctKeys['2099-01-17|PREACHER|1'] === undefined,
    '例如講員崗位本來就不自動生成，SKIPPED 但原因不是「找不到人」');
  const priorVersionKeys = classifyPendingBackfillKeys_(rows, QUARTER_ID, VERSION_NO - 1);
  checkEqual('★ 別的版本（v' + (VERSION_NO - 1) + '）的待補清單跟這一版分開算，各自只算自己版本的資料',
    Object.keys(priorVersionKeys), ['2099-01-10|SCRIPTURE|1']);

  checkEqual('★ 這一版總共只有 2 格真正待補（不是舊邏輯誤判出的 4 格）',
    Object.keys(correctKeys).length, 2);
}

console.log('\n=== 邊界情況：AssignSource=SKIPPED 但 RuleFlags 含其他規則（不是 ELIGIBILITY）不算待補 ===');
{
  // 理論上不應該發生（SKIPPED 格子目前只會帶 ELIGIBILITY 旗標），但既然判斷
  // 條件明確寫了「必須含 ELIGIBILITY」，就該有測試鎖住這個邊界，避免日後
  // 改動 RuleFlags 組成方式時不小心放寬了條件。
  const edgeRows = [{
    quarterId: QUARTER_ID, versionNo: VERSION_NO, serviceDate: '2099-04-04',
    postId: 'SCRIPTURE', slotIndex: 1, personId: '', assignSource: ASSIGN_SOURCE.SKIPPED,
    ruleFlags: RULE_IDS.NO_CONSECUTIVE
  }];
  const keys = classifyPendingBackfillKeys_(edgeRows, QUARTER_ID, VERSION_NO);
  check('★ SKIPPED 但 RuleFlags 不含 ELIGIBILITY 的格子不算待補', Object.keys(keys).length === 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
