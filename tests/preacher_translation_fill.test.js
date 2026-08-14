// 階段 B3：講員與翻譯填寫工具的回歸測試。
// 執行方式：node tests/preacher_translation_fill.test.js
// 移植 PreacherTranslationFill.gs 的 apiListPreacherTranslationPending()／
// apiSavePreacherTranslationEntry() 核心判斷（去掉試算表存取，用記憶體假資料）。
// 全部姓名為虛構（陳大文／李小明／王美美 沿用本專案既有的安全佔位名慣例）。

const ASSIGN_SOURCE = { AUTO: 'AUTO', MANUAL: 'MANUAL' };

function makeDb() {
  return {
    posts: [
      { postId: 'PREACH', nameTC: '講員' },
      { postId: 'TRANS', nameTC: '翻譯' },
      { postId: 'CHAIR', nameTC: '主席' } // 一般崗位，用來測「崗位不是講員或翻譯」
    ],
    // RosterAssignments：quarterId|versionNo|serviceDate|postId|slotIndex -> row
    assignments: [
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'PREACH', slotIndex: 1, personId: '', personNameSnapshot: '' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'TRANS', slotIndex: 1, personId: '', personNameSnapshot: '' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'CHAIR', slotIndex: 1, personId: 'P001', personNameSnapshot: '陳大文' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-17', postId: 'PREACH', slotIndex: 1, personId: 'P002', personNameSnapshot: '李小明' } // 已填
    ]
  };
}

// ---- 移植：findPreacherTranslationPostIds_()（Posts 依 PostName_TC 精確比對）----
function findPreacherTranslationPostIds_(db) {
  let preacherPostId = null, translationPostId = null;
  db.posts.forEach(function (row) {
    if (row.nameTC === '講員') preacherPostId = row.postId;
    if (row.nameTC === '翻譯') translationPostId = row.postId;
  });
  return { preacherPostId: preacherPostId, translationPostId: translationPostId };
}

// ---- 移植：apiListPreacherTranslationPending() 的核心（去掉 UI/工作表 I/O）----
function findLatestVersionNo(db, quarterId) {
  const rows = db.assignments.filter(a => a.quarterId === quarterId);
  if (rows.length === 0) return -1;
  return Math.max(...rows.map(a => a.versionNo));
}

function apiListPreacherTranslationPending(db, quarterId) {
  const ids = findPreacherTranslationPostIds_(db);
  if (!ids.preacherPostId && !ids.translationPostId) {
    throw new Error('Posts 工作表找不到名稱為「講員」或「翻譯」的崗位，無法使用這個工具。');
  }
  const versionNo = findLatestVersionNo(db, quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');

  const targetPostIds = [ids.preacherPostId, ids.translationPostId].filter(Boolean);
  const pending = db.assignments.filter(function (a) {
    return a.quarterId === quarterId && a.versionNo === versionNo
      && targetPostIds.indexOf(a.postId) !== -1
      && !a.personId && !a.personNameSnapshot;
  });
  return { quarterId: quarterId, versionNo: versionNo, pending: pending };
}

// ---- 移植：apiSavePreacherTranslationEntry() 的核心（去掉工作表寫入，改成操作 db.assignments）----
function apiSavePreacherTranslationEntry(db, quarterId, serviceDate, postId, slotIndex, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('姓名不可留空。');

  // 階段 B3 補強的檢查：postId 必須是講員或翻譯之一
  const ids = findPreacherTranslationPostIds_(db);
  const allowedPostIds = [ids.preacherPostId, ids.translationPostId].filter(Boolean);
  if (allowedPostIds.indexOf(postId) === -1) {
    throw new Error('這個工具只能填寫「講員」或「翻譯」崗位的格子，收到的 PostID「' + postId + '」不屬於這兩個崗位。');
  }

  const versionNo = findLatestVersionNo(db, quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本。');

  const row = db.assignments.find(function (a) {
    return a.quarterId === quarterId && a.versionNo === versionNo
      && a.serviceDate === serviceDate && a.postId === postId && a.slotIndex === Number(slotIndex);
  });
  if (!row) {
    throw new Error('在 RosterAssignments 找不到對應的格子（' + serviceDate + ' ' + postId + '#' + slotIndex + '），'
      + '可能版本已經改變，請重新整理側邊欄。');
  }

  row.personId = '';
  row.personNameSnapshot = trimmedName;
  row.assignSource = ASSIGN_SOURCE.MANUAL;
  return { personId: '', linkedToNameMapping: false };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkThrows(label, fn, messageIncludes) {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label}\n      沒有拋出錯誤`);
  } catch (err) {
    const ok = messageIncludes === undefined || err.message.indexOf(messageIncludes) !== -1;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) console.log(`      實際錯誤訊息：${err.message}\n      應包含：${messageIncludes}`);
  }
}

console.log('\n=== apiListPreacherTranslationPending：正常路徑 ===');
{
  const db = makeDb();
  const result = apiListPreacherTranslationPending(db, '2027T1');
  check('★ 只列出還空著的講員／翻譯格子（1/17 的講員已填，不列入）',
    result.pending.length, 2);
  check('★ 不會列出「主席」這類非講員／翻譯崗位（即使也空著）',
    result.pending.some(p => p.postId === 'CHAIR'), false);
}

console.log('\n=== apiListPreacherTranslationPending：錯誤路徑 ===');
{
  const dbNoPositions = makeDb();
  dbNoPositions.posts = dbNoPositions.posts.filter(p => p.nameTC !== '講員' && p.nameTC !== '翻譯');
  checkThrows('★ 崗位不是講員或翻譯（Posts 工作表根本沒有這兩個崗位）→ 拋錯',
    () => apiListPreacherTranslationPending(dbNoPositions, '2027T1'), 'Posts 工作表找不到');

  const db = makeDb();
  checkThrows('★ 季度不存在（沒有任何已生成版本）→ 拋錯',
    () => apiListPreacherTranslationPending(db, '2099T4'), '找不到');
}

console.log('\n=== apiSavePreacherTranslationEntry：正常路徑 ===');
{
  const db = makeDb();
  const result = apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, '王美美');
  check('★ 儲存成功，回傳結果', result, { personId: '', linkedToNameMapping: false });
  const row = db.assignments.find(a => a.serviceDate === '2027-01-10' && a.postId === 'PREACH');
  check('★ 格子已寫入姓名快照', row.personNameSnapshot, '王美美');
  check('★ AssignSource 標記為 MANUAL', row.assignSource, ASSIGN_SOURCE.MANUAL);
}

console.log('\n=== apiSavePreacherTranslationEntry：錯誤路徑 ===');
{
  const db = makeDb();
  checkThrows('★ 姓名空白 → 拋錯',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, ''), '姓名不可留空');
  checkThrows('★ 姓名只有空格 → 拋錯（.trim() 後仍是空白）',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, '   '), '姓名不可留空');
  checkThrows('★ 崗位不是講員或翻譯（傳入「主席」的 PostID）→ 拋錯，不會覆寫別的崗位',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'CHAIR', 1, '王美美'), '只能填寫「講員」或「翻譯」');
  checkThrows('★ 日期不在該季（該日完全沒有對應的 RosterAssignments 格子）→ 拋錯',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2099-12-25', 'PREACH', 1, '王美美'), '找不到對應的格子');
  checkThrows('★ 季度不存在 → 拋錯',
    () => apiSavePreacherTranslationEntry(db, '2099T4', '2027-01-10', 'PREACH', 1, '王美美'), '找不到');

  // 確認上面每一種錯誤路徑都完全沒有改動任何資料（拋錯之前就中止，不會半途寫一半）
  check('★ 全部錯誤路徑跑完之後，db.assignments 完全沒有被動過',
    db.assignments.every(a => a.assignSource !== ASSIGN_SOURCE.MANUAL || a.personNameSnapshot === '陳大文'),
    true);
}

console.log('\n=== 確認「講員不自動生成」這條硬規則沒有被這個工具繞過 ===');
{
  // 這個工具刻意設計成「只能填空著的格子」——如果格子已經有人（AssignSource=AUTO
  // 之類的自動生成結果），代表 Generator.gs 從未自動指派過講員／翻譯（本來就
  // AutoGenerate=FALSE，見 Generator.gs 的 getSkipReason_()），這裡驗證的是
  // 「這個工具本身也不會把講員／翻譯格子標成 AUTO」——每一次儲存都固定寫
  // AssignSource=MANUAL，不會有任何路徑讓講員／翻譯變成系統自動指派的結果。
  const db = makeDb();
  apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, '王美美');
  const row = db.assignments.find(a => a.serviceDate === '2027-01-10' && a.postId === 'PREACH');
  check('★ 講員格子填寫後 AssignSource 永遠是 MANUAL，不是 AUTO', row.assignSource, ASSIGN_SOURCE.MANUAL);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
