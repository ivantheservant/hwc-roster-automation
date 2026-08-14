// 階段 C（第五輪批次）：PDF 殘留管理的回歸測試。
// 執行方式：node tests/pdf_cleanup.test.js
// 三個對象：
// (1) scanNonLatestPdfs_() 的逐身分判斷邏輯（PdfExport.gs 既有函式，這次
//     補上第一次測試覆蓋，重點驗證「步驟 5 部分重發後，同一資料夾混雜版本
//     時不會誤刪仍在使用的舊版本」）；
// (2) scanPdfStatsByQuarterVersion_()（新函式，按季度＋版本統計容量與
//     是否最新版）；
// (3) planQuarterPdfCleanup_()（新函式，按季度清理的 plan 階段，純讀取）。
// 全部用虛構檔名（假姓名、假季度 ID）。

// ---- 移植：PdfExport.gs 的 scanNonLatestPdfs_() 核心（去掉 DriveApp 存取，
//      改吃一個 {name, size}[] 陣列模擬資料夾內容，判斷邏輯逐字相同）----
function scanNonLatestPdfs_(quarterId, folderFiles) {
  const pattern = new RegExp('^' + quarterId + '_v(\\d+)(.*)$');
  const recognized = [];
  const unrecognized = [];
  folderFiles.forEach(function (f) {
    const match = pattern.exec(f.name);
    if (match) {
      recognized.push({ id: f.id, name: f.name, versionNo: Number(match[1]), identity: match[2] });
    } else {
      unrecognized.push({ id: f.id, name: f.name });
    }
  });

  const maxVersionByIdentity = {};
  recognized.forEach(function (f) {
    if (!(f.identity in maxVersionByIdentity) || f.versionNo > maxVersionByIdentity[f.identity]) {
      maxVersionByIdentity[f.identity] = f.versionNo;
    }
  });
  const nonLatest = recognized.filter(function (f) { return f.versionNo !== maxVersionByIdentity[f.identity]; });

  return {
    totalFileCount: folderFiles.length, recognized: recognized, unrecognized: unrecognized,
    nonLatest: nonLatest, latestCount: recognized.length - nonLatest.length,
    identityCount: Object.keys(maxVersionByIdentity).length
  };
}

// ---- 移植：scanPdfStatsByQuarterVersion_()（逐字對應正式碼邏輯，folder/fileSizes
//      換成假 Map）----
function scanPdfStatsByQuarterVersion_(fileSizes, latestVersionByQuarter) {
  const pattern = /^(.+?)_v(\d+)_/;
  const groups = {};
  let totalFileCount = 0, totalSizeBytes = 0;
  fileSizes.forEach(function (size, name) {
    totalFileCount++;
    totalSizeBytes += size;
    const match = pattern.exec(name);
    const quarterId = match ? match[1] : '';
    const versionNo = match ? Number(match[2]) : null;
    const key = match ? quarterId + '|' + versionNo : '（不符合命名慣例）';
    if (!groups[key]) groups[key] = { quarterId: quarterId, versionNo: versionNo, fileCount: 0, sizeBytes: 0 };
    groups[key].fileCount++;
    groups[key].sizeBytes += size;
  });
  const result = Object.keys(groups).map(function (key) {
    const g = groups[key];
    return Object.assign({}, g, { isLatestVersion: !!g.quarterId && latestVersionByQuarter[g.quarterId] === g.versionNo });
  }).sort(function (a, b) {
    if (a.quarterId !== b.quarterId) return a.quarterId < b.quarterId ? -1 : 1;
    return (a.versionNo || 0) - (b.versionNo || 0);
  });
  return { totalFileCount: totalFileCount, totalSizeBytes: totalSizeBytes, groups: result };
}

// ---- 移植：planQuarterPdfCleanup_()（folder.getFiles() 換成假陣列）----
function planQuarterPdfCleanup_(quarterId, folderFiles) {
  const pattern = new RegExp('^' + quarterId + '_v(\\d+)');
  const files = [];
  let totalSizeBytes = 0;
  folderFiles.forEach(function (f) {
    const match = pattern.exec(f.name);
    if (!match) return;
    totalSizeBytes += f.size;
    files.push({ id: f.id, name: f.name, sizeBytes: f.size, versionNo: Number(match[1]) });
  });
  return { files: files, totalSizeBytes: totalSizeBytes };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== C2：scanNonLatestPdfs_ 逐身分判斷——步驟 5 部分重發後不誤刪仍在用的版本 ===');
{
  // 情境：2027T1 原本 v5，步驟 5 之後陳大文的安排有改動（重發到 v6），
  // 但李小明沒有改動（PdfBatch.gs 的批次只為被改動者產生新版 PDF，見既有
  // 註解），所以資料夾同時有陳大文_v6（新）、李小明_v5（舊，但仍在使用）、
  // 完整版_v6（新）。
  const files = [
    { id: 'f1', name: '2027T1_v5_粵語堂職事表_陳大文.pdf' }, // 舊版，陳大文已重發到 v6，這份要清
    { id: 'f2', name: '2027T1_v6_粵語堂職事表_陳大文.pdf' }, // 陳大文最新版，保留
    { id: 'f3', name: '2027T1_v5_粵語堂職事表_李小明.pdf' }, // 李小明沒有被改動，v5 就是他的最新版，保留
    { id: 'f4', name: '2027T1_v5_粵語堂職事表_完整版.pdf' }, // 完整版舊版，要清
    { id: 'f5', name: '2027T1_v6_粵語堂職事表_完整版.pdf' }  // 完整版最新版，保留
  ];
  const scan = scanNonLatestPdfs_('2027T1', files);

  check('★ 只有 2 個檔案被判為「非最新」（陳大文 v5、完整版 v5）', scan.nonLatest.length, 2);
  check('★ 李小明的 v5（他自己唯一的版本）★不會★被誤判成「非最新」（這是最容易寫錯的地方：'
    + '如果誤用「非全域最新版本號」判斷，李小明的 v5 會被誤刪）',
    scan.nonLatest.some(f => f.name.indexOf('李小明') !== -1), false);
  check('★ 陳大文 v5 正確被列入清理清單', scan.nonLatest.some(f => f.id === 'f1'), true);
  check('★ 完整版 v5 正確被列入清理清單', scan.nonLatest.some(f => f.id === 'f4'), true);
  check('★ 保留數量正確（3 個：陳大文v6、李小明v5、完整版v6）', scan.latestCount, 3);
}

console.log('\n=== C2 補充：全部人都在同一版本時，nonLatest 應該是空的 ===');
{
  const files = [
    { id: 'f1', name: '2027T1_v3_粵語堂職事表_陳大文.pdf' },
    { id: 'f2', name: '2027T1_v3_粵語堂職事表_李小明.pdf' },
    { id: 'f3', name: '2027T1_v3_粵語堂職事表_完整版.pdf' }
  ];
  const scan = scanNonLatestPdfs_('2027T1', files);
  check('★ 全部同一版本 → nonLatest 空陣列', scan.nonLatest, []);
  check('★ latestCount 等於全部辨識到的檔案數', scan.latestCount, 3);
}

console.log('\n=== C2 補充：不符合命名慣例的檔案一律不會被清理（寧可少清不誤刪） ===');
{
  const files = [
    { id: 'f1', name: '2027T1_v3_粵語堂職事表_陳大文.pdf' },
    { id: 'f2', name: '不明檔案.pdf' },
    { id: 'f3', name: '2026T3_舊格式檔名.pdf' }
  ];
  const scan = scanNonLatestPdfs_('2027T1', files);
  check('★ 兩個不符合慣例的檔案進 unrecognized', scan.unrecognized.length, 2);
  check('★ unrecognized 完全不出現在 nonLatest（不會被清理）',
    scan.nonLatest.every(f => f.id !== 'f2' && f.id !== 'f3'), true);
}

console.log('\n=== C1：scanPdfStatsByQuarterVersion_ 按季度＋版本統計容量，標示最新版本 ===');
{
  const fileSizes = new Map([
    ['2026T4_v11_粵語堂職事表_陳大文.pdf', 200000],
    ['2026T4_v11_粵語堂職事表_李小明.pdf', 210000],
    ['2026T4_v10_粵語堂職事表_陳大文.pdf', 195000], // 舊版本殘留
    ['2027T1_v2_粵語堂職事表_王美美.pdf', 220000]
  ]);
  const latestVersionByQuarter = { '2026T4': 11, '2027T1': 2 };
  const stats = scanPdfStatsByQuarterVersion_(fileSizes, latestVersionByQuarter);

  check('★ 總檔案數正確', stats.totalFileCount, 4);
  check('★ 總容量正確', stats.totalSizeBytes, 200000 + 210000 + 195000 + 220000);

  const v11Group = stats.groups.find(g => g.quarterId === '2026T4' && g.versionNo === 11);
  const v10Group = stats.groups.find(g => g.quarterId === '2026T4' && g.versionNo === 10);
  check('★ 2026T4 v11（最新）標示 isLatestVersion=true', v11Group.isLatestVersion, true);
  check('★ 2026T4 v10（舊版殘留）標示 isLatestVersion=false（可考慮清理）', v10Group.isLatestVersion, false);
  check('★ v10 群組檔案數與容量正確', [v10Group.fileCount, v10Group.sizeBytes], [1, 195000]);

  const v2Group = stats.groups.find(g => g.quarterId === '2027T1' && g.versionNo === 2);
  check('★ 2027T1 v2（該季唯一版本）標示 isLatestVersion=true', v2Group.isLatestVersion, true);
}

console.log('\n=== C3：planQuarterPdfCleanup_ 只列出，完全不刪除（純讀取） ===');
{
  const files = [
    { id: 'f1', name: '2026T4_v10_粵語堂職事表_陳大文.pdf', size: 100000 },
    { id: 'f2', name: '2026T4_v11_粵語堂職事表_陳大文.pdf', size: 105000 },
    { id: 'f3', name: '2027T1_v2_粵語堂職事表_王美美.pdf', size: 90000 } // 不同季度，不應該出現
  ];
  const plan = planQuarterPdfCleanup_('2026T4', files);

  check('★ 只列出屬於 2026T4 的檔案（不分版本，2 個都列）', plan.files.length, 2);
  check('★ 不會混入其他季度的檔案', plan.files.every(f => f.name.indexOf('2026T4') === 0), true);
  check('★ 總容量正確加總', plan.totalSizeBytes, 100000 + 105000);

  // 「plan-only」的關鍵驗證：這個函式本身完全沒有任何刪除／setTrashed 呼叫，
  // 只回傳資料——這裡用「輸入陣列在呼叫前後沒有變化」間接證明沒有副作用。
  const before = JSON.stringify(files);
  planQuarterPdfCleanup_('2026T4', files);
  check('★ 輸入資料呼叫前後完全相同（沒有副作用）', JSON.stringify(files), before);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
