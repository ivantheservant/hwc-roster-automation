// 階段 B3：講員與翻譯填寫工具的回歸測試（第十四輪批次階段 C 擴展到獻花）。
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
      { postId: 'FLOWER', nameTC: '獻花' },
      { postId: 'CHAIR', nameTC: '主席' } // 一般崗位，用來測「崗位不是講員/翻譯/獻花」
    ],
    // RosterAssignments：quarterId|versionNo|serviceDate|postId|slotIndex -> row
    assignments: [
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'PREACH', slotIndex: 1, personId: '', personNameSnapshot: '' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'TRANS', slotIndex: 1, personId: '', personNameSnapshot: '' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'FLOWER', slotIndex: 1, personId: '', personNameSnapshot: '' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-10', postId: 'CHAIR', slotIndex: 1, personId: 'P001', personNameSnapshot: '陳大文' },
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-17', postId: 'PREACH', slotIndex: 1, personId: 'P002', personNameSnapshot: '李小明' }, // 已填
      { quarterId: '2027T1', versionNo: 0, serviceDate: '2027-01-17', postId: 'FLOWER', slotIndex: 1, personId: '', personNameSnapshot: '' } // 呢一週冇人認獻，刻意留空
    ]
  };
}

// ---- 移植：findPreacherTranslationPostIds_()（Posts 依 PostName_TC 精確比對）----
function findPreacherTranslationPostIds_(db) {
  let preacherPostId = null, translationPostId = null, flowerPostId = null;
  db.posts.forEach(function (row) {
    if (row.nameTC === '講員') preacherPostId = row.postId;
    if (row.nameTC === '翻譯') translationPostId = row.postId;
    if (row.nameTC === '獻花') flowerPostId = row.postId;
  });
  return { preacherPostId: preacherPostId, translationPostId: translationPostId, flowerPostId: flowerPostId };
}

// ---- 移植：apiListPreacherTranslationPending() 的核心（去掉 UI/工作表 I/O）----
function findLatestVersionNo(db, quarterId) {
  const rows = db.assignments.filter(a => a.quarterId === quarterId);
  if (rows.length === 0) return -1;
  return Math.max(...rows.map(a => a.versionNo));
}

function apiListPreacherTranslationPending(db, quarterId) {
  const ids = findPreacherTranslationPostIds_(db);
  if (!ids.preacherPostId && !ids.translationPostId && !ids.flowerPostId) {
    throw new Error('Posts 工作表找不到名稱為「講員」「翻譯」或「獻花」的崗位，無法使用這個工具。');
  }
  const versionNo = findLatestVersionNo(db, quarterId);
  if (versionNo < 0) throw new Error('找不到 ' + quarterId + ' 已生成的版本，請先執行「步驟 1：生成初稿」。');

  const targetPostIds = [ids.preacherPostId, ids.translationPostId, ids.flowerPostId].filter(Boolean);
  const pending = db.assignments.filter(function (a) {
    return a.quarterId === quarterId && a.versionNo === versionNo
      && targetPostIds.indexOf(a.postId) !== -1
      && !a.personId && !a.personNameSnapshot;
  }).map(function (a) {
    return Object.assign({}, a, { optional: a.postId === ids.flowerPostId });
  });
  return { quarterId: quarterId, versionNo: versionNo, pending: pending };
}

// ---- 移植：apiSavePreacherTranslationEntry() 的核心（去掉工作表寫入，改成操作 db.assignments）----
function apiSavePreacherTranslationEntry(db, quarterId, serviceDate, postId, slotIndex, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('姓名不可留空。');

  // 階段 B3 補強（第十四輪批次階段 C 擴展到獻花）的檢查：postId 必須是
  // 講員／翻譯／獻花之一
  const ids = findPreacherTranslationPostIds_(db);
  const allowedPostIds = [ids.preacherPostId, ids.translationPostId, ids.flowerPostId].filter(Boolean);
  if (allowedPostIds.indexOf(postId) === -1) {
    throw new Error('這個工具只能填寫「講員」「翻譯」或「獻花」崗位的格子，收到的 PostID「' + postId + '」不屬於這三個崗位。');
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

console.log('\n=== apiListPreacherTranslationPending：正常路徑（含獻花）===');
{
  const db = makeDb();
  const result = apiListPreacherTranslationPending(db, '2027T1');
  check('★★ 列出全部還空著的講員／翻譯／獻花格子（1/17 的講員已填，不列入；'
    + '1/10 的講員、翻譯、獻花，1/17 的獻花，共 4 格）',
    result.pending.length, 4);
  check('★ 不會列出「主席」這類非講員／翻譯／獻花崗位（即使也空著）',
    result.pending.some(p => p.postId === 'CHAIR'), false);
  check('★★★ 獻花格子的 optional=true，講員／翻譯的 optional=false（UI 據此顯示「可留空」提示）',
    result.pending.map(p => ({ postId: p.postId, optional: p.optional })).sort((a, b) => a.postId < b.postId ? -1 : 1),
    [
      { postId: 'FLOWER', optional: true },
      { postId: 'FLOWER', optional: true },
      { postId: 'PREACH', optional: false },
      { postId: 'TRANS', optional: false }
    ]);
}

console.log('\n=== apiListPreacherTranslationPending：只有部分崗位存在也能運作 ===');
{
  const dbOnlyFlower = makeDb();
  dbOnlyFlower.posts = dbOnlyFlower.posts.filter(p => p.nameTC === '獻花' || p.nameTC === '主席');
  const result = apiListPreacherTranslationPending(dbOnlyFlower, '2027T1');
  check('★ Posts 只有獻花（冇講員／翻譯）都唔會拋錯，只列出獻花格子',
    result.pending.every(p => p.postId === 'FLOWER'), true);
}

console.log('\n=== apiListPreacherTranslationPending：錯誤路徑 ===');
{
  const dbNoPositions = makeDb();
  dbNoPositions.posts = dbNoPositions.posts.filter(p => p.nameTC !== '講員' && p.nameTC !== '翻譯' && p.nameTC !== '獻花');
  checkThrows('★ 講員／翻譯／獻花三個崗位 Posts 工作表全部都冇 → 拋錯',
    () => apiListPreacherTranslationPending(dbNoPositions, '2027T1'), 'Posts 工作表找不到');

  const db = makeDb();
  checkThrows('★ 季度不存在（沒有任何已生成版本）→ 拋錯',
    () => apiListPreacherTranslationPending(db, '2099T4'), '找不到');
}

console.log('\n=== apiSavePreacherTranslationEntry：正常路徑（含獻花）===');
{
  const db = makeDb();
  const result = apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, '王美美');
  check('★ 儲存成功，回傳結果', result, { personId: '', linkedToNameMapping: false });
  const row = db.assignments.find(a => a.serviceDate === '2027-01-10' && a.postId === 'PREACH');
  check('★ 格子已寫入姓名快照', row.personNameSnapshot, '王美美');
  check('★ AssignSource 標記為 MANUAL', row.assignSource, ASSIGN_SOURCE.MANUAL);
}
{
  const db = makeDb();
  const result = apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'FLOWER', 1, '陳太太');
  check('★★★ 獻花格子一樣可以正常儲存（同講員／翻譯用同一個 API）', result, { personId: '', linkedToNameMapping: false });
  const row = db.assignments.find(a => a.serviceDate === '2027-01-10' && a.postId === 'FLOWER');
  check('★ 獻花格子已寫入姓名快照', row.personNameSnapshot, '陳太太');
}
{
  const db = makeDb();
  // 「留空」本身唔係一個要呼叫嘅動作——1/17 嘅獻花本來就已經係留空狀態
  // （makeDb() 建立時 personNameSnapshot 已經係空字串），呢度確認留空
  // 完全唔需要任何額外儲存呼叫，格子仍然會維持喺 pending 清單入面，
  // 唔會被強制要求處理。
  const before = apiListPreacherTranslationPending(db, '2027T1').pending
    .filter(p => p.postId === 'FLOWER').length;
  check('★★ 冇填任何獻花格子都唔會拋錯，留空係合法嘅終態，唔係一定要處理嘅錯誤',
    before, 2);
}

console.log('\n=== apiSavePreacherTranslationEntry：錯誤路徑 ===');
{
  const db = makeDb();
  checkThrows('★ 姓名空白 → 拋錯（獻花都唔可以「儲存」一個空白姓名——留空係靠唔撳掣，唔係撳掣傳空字串）',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'FLOWER', 1, ''), '姓名不可留空');
  checkThrows('★ 姓名只有空格 → 拋錯（.trim() 後仍是空白）',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'PREACH', 1, '   '), '姓名不可留空');
  checkThrows('★★ 崗位不是講員／翻譯／獻花（傳入「主席」的 PostID）→ 拋錯，不會覆寫別的崗位',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'CHAIR', 1, '王美美'), '只能填寫「講員」「翻譯」或「獻花」');
  checkThrows('★ 日期不在該季（該日完全沒有對應的 RosterAssignments 格子）→ 拋錯',
    () => apiSavePreacherTranslationEntry(db, '2027T1', '2099-12-25', 'PREACH', 1, '王美美'), '找不到對應的格子');
  checkThrows('★ 季度不存在 → 拋錯',
    () => apiSavePreacherTranslationEntry(db, '2099T4', '2027-01-10', 'PREACH', 1, '王美美'), '找不到');

  // 確認上面每一種錯誤路徑都完全沒有改動任何資料（拋錯之前就中止，不會半途寫一半）
  check('★ 全部錯誤路徑跑完之後，db.assignments 完全沒有被動過',
    db.assignments.every(a => a.assignSource !== ASSIGN_SOURCE.MANUAL || a.personNameSnapshot === '陳大文'),
    true);
}

console.log('\n=== 確認「講員／翻譯／獻花不自動生成」這條硬規則沒有被這個工具繞過 ===');
{
  // 這個工具刻意設計成「只能填空著的格子」——如果格子已經有人（AssignSource=AUTO
  // 之類的自動生成結果），代表 Generator.gs 從未自動指派過講員／翻譯／獻花（本來就
  // AutoGenerate=FALSE，見 Generator.gs 的 getSkipReason_()），這裡驗證的是
  // 「這個工具本身也不會把講員／翻譯／獻花格子標成 AUTO」——每一次儲存都固定寫
  // AssignSource=MANUAL，不會有任何路徑讓呢三個崗位變成系統自動指派的結果。
  const db = makeDb();
  apiSavePreacherTranslationEntry(db, '2027T1', '2027-01-10', 'FLOWER', 1, '王美美');
  const row = db.assignments.find(a => a.serviceDate === '2027-01-10' && a.postId === 'FLOWER');
  check('★ 獻花格子填寫後 AssignSource 永遠是 MANUAL，不是 AUTO', row.assignSource, ASSIGN_SOURCE.MANUAL);
}

console.log('\n=== 用真正原始碼驗證 findPreacherTranslationPostIds_()（唔淨係測上面移植嘅版本）===');
{
  // 上面全部測試移植咗一份邏輯（同其他測試檔一致嘅慣例），但移植版本走樣
  // 都會照樣全綠、測唔到正式碼改壞——呢度額外用 loadGasSource() 載入真正
  // 嘅 src/PreacherTranslationFill.gs，只覆寫 readPosts()（唯一嘅 GAS 依賴），
  // 直接驗證真正嘅 findPreacherTranslationPostIds_() 有冇正確搵到「獻花」。
  const { loadGasSource } = require('./helpers/gas_loader.js');
  // 先載入一次淨係攞 COLUMNS 常數（唔需要 overrides）——COLUMNS.POSTS.POST_NAME_TC／
  // POST_ID 嘅實際字串鍵名由 Constants.gs 決定，用返呢個嚟砌 fake row，
  // 唔好自己估字串（估錯會令呢個驗證變成冇意義嘅假陽性）。
  const constants = loadGasSource(['Constants.gs']);
  const POSTS_ROWS = [
    { [constants.COLUMNS.POSTS.POST_NAME_TC]: '講員', [constants.COLUMNS.POSTS.POST_ID]: 'PREACH' },
    { [constants.COLUMNS.POSTS.POST_NAME_TC]: '翻譯', [constants.COLUMNS.POSTS.POST_ID]: 'TRANS' },
    { [constants.COLUMNS.POSTS.POST_NAME_TC]: '獻花', [constants.COLUMNS.POSTS.POST_ID]: 'FLOWER' }
  ];
  const gas = loadGasSource(['Constants.gs', 'PreacherTranslationFill.gs'], {
    readPosts: function () { return POSTS_ROWS; }
  });
  const ids = gas.findPreacherTranslationPostIds_();
  check('★★★★ 真正原始碼嘅 findPreacherTranslationPostIds_() 正確搵到三個崗位嘅 PostID',
    ids, { preacherPostId: 'PREACH', translationPostId: 'TRANS', flowerPostId: 'FLOWER' });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
