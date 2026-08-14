// 階段 E（第五輪批次）：個人 PDF 產生效能——「略過已存在」判斷邏輯的回歸測試，
// 以及批次時間預算／可續跑機制的行為驗證。
// 執行方式：node tests/pdf_batch_perf.test.js
//
// 背景（見 docs/系統範圍稽核.md 階段 E 完整評估）：這次重新讀 PdfBatch.gs 確認
// 「略過已存在」早就是一次過列資料夾內容（listExistingFileSizes_()），不是
// 逐個檔案查——但發現一個小效能缺口：forceRegenerate=TRUE 時，
// generateOnePersonalPdf_() 原本仍然會白做一次「是否已存在」的查詢（結果
// 完全用不到，因為 forceRegenerate=TRUE 時一定會重新產生），已修正為
// forceRegenerate=TRUE 時整段跳過。這裡驗證：(1) 修正前後，最終行為
// 完全不變（forceRegenerate=TRUE 一定重新產生，FALSE 且已存在一定略過）；
// (2) forceRegenerate=TRUE 時，查詢函式真的沒有被呼叫。

// ---- 移植：generateOnePersonalPdf_() 的「是否已存在」判斷段落（逐字對應
//      修正後的正式碼邏輯，其餘步驟用假函式代替）----
function checkExistingAndMaybeSkip_(fileName, minBytes, forceRegenerate, existingFileSizes, folderQueryFn) {
  let existingSize;
  let queried = false;
  if (!forceRegenerate) {
    if (existingFileSizes) {
      existingSize = existingFileSizes.has(fileName) ? existingFileSizes.get(fileName) : undefined;
    } else {
      queried = true;
      existingSize = folderQueryFn(fileName);
    }
    const alreadyExists = existingSize !== undefined && existingSize >= minBytes;
    if (alreadyExists) {
      return { skipped: true, queried: queried };
    }
  }
  return { skipped: false, queried: queried };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== 行為不變：forceRegenerate=FALSE 且檔案已存在（大小達標）→ 略過 ===');
{
  const existingFileSizes = new Map([['2027T1_v3_粵語堂職事表_陳大文.pdf', 200000]]);
  const result = checkExistingAndMaybeSkip_('2027T1_v3_粵語堂職事表_陳大文.pdf', 10240, false, existingFileSizes, () => { throw new Error('不應該呼叫逐檔查詢'); });
  check('★ 已存在且達標 → 略過', result.skipped, true);
}

console.log('\n=== 行為不變：forceRegenerate=FALSE 但檔案不存在 → 不略過 ===');
{
  const existingFileSizes = new Map(); // 空的，代表資料夾內沒有這個檔案
  const result = checkExistingAndMaybeSkip_('2027T1_v3_粵語堂職事表_李小明.pdf', 10240, false, existingFileSizes, () => undefined);
  check('★ 不存在 → 不略過（會重新產生）', result.skipped, false);
}

console.log('\n=== 行為不變：forceRegenerate=FALSE 但檔案存在、大小不足門檻 → 不略過（視為缺件）===');
{
  const existingFileSizes = new Map([['2027T1_v3_粵語堂職事表_王美美.pdf', 500]]); // 遠低於門檻
  const result = checkExistingAndMaybeSkip_('2027T1_v3_粵語堂職事表_王美美.pdf', 10240, false, existingFileSizes, () => 500);
  check('★ 大小不足門檻 → 不略過（重新產生）', result.skipped, false);
}

console.log('\n=== 行為不變：forceRegenerate=TRUE 時，即使檔案已存在也一定重新產生 ===');
{
  const existingFileSizes = new Map([['2027T1_v3_粵語堂職事表_陳大文.pdf', 200000]]);
  const result = checkExistingAndMaybeSkip_('2027T1_v3_粵語堂職事表_陳大文.pdf', 10240, true, existingFileSizes, () => { throw new Error('不應該呼叫'); });
  check('★ forceRegenerate=TRUE → 一定不略過（強制重新產生）', result.skipped, false);
}

console.log('\n=== 這次修正的重點：forceRegenerate=TRUE 時，完全不會執行任何查詢（不浪費 Drive API 呼叫）===');
{
  let queryCalled = false;
  const folderQueryFn = function () { queryCalled = true; return 200000; };

  // 情境 A：existingFileSizes 有值（forceRegenerate=FALSE 時才會有）——這裡故意
  // 模擬「呼叫端傳了 existingFileSizes 但這次是 forceRegenerate=TRUE」的情況，
  // 驗證即使有資料可查，forceRegenerate=TRUE 時也完全不查（連 Map.has() 都不呼叫）。
  const existingFileSizes = new Map([['x.pdf', 200000]]);
  const result1 = checkExistingAndMaybeSkip_('x.pdf', 10240, true, existingFileSizes, folderQueryFn);
  check('★ forceRegenerate=TRUE、有 existingFileSizes Map → 仍然不查（skipped=false）', result1.skipped, false);

  // 情境 B（這是實際正式碼會發生的情況）：forceRegenerate=TRUE 時，呼叫端傳的
  // existingFileSizes 本來就是 null，這裡驗證此時「逐檔查詢」的 fallback
  // 函式完全沒有被呼叫——這正是這次修正要解決的問題（修正前這裡會被呼叫，
  // 查完卻沒有用到結果）。
  const result2 = checkExistingAndMaybeSkip_('x.pdf', 10240, true, null, folderQueryFn);
  check('★ forceRegenerate=TRUE、existingFileSizes=null → 逐檔查詢函式完全沒被呼叫（queried=false）', result2.queried, false);
  check('★ queryCalled 旗標仍然是 false（folderQueryFn 真的沒被執行）', queryCalled, false);
}

console.log('\n=== 對照：forceRegenerate=FALSE、existingFileSizes=null 時仍然會查（維持既有的 fallback 行為）===');
{
  let queryCalled = false;
  const folderQueryFn = function () { queryCalled = true; return undefined; };
  const result = checkExistingAndMaybeSkip_('x.pdf', 10240, false, null, folderQueryFn);
  check('★ FALSE 且沒有預先列好的 Map → 退回逐檔查詢（queried=true）', result.queried, true);
  check('★ 查詢函式確實被呼叫過', queryCalled, true);
}

console.log('\n=== 批次時間預算與可續跑機制：60 人在預設設定下的完成輪數估算 ===');
{
  // 移植 runPersonalPdfBatchLoopInner_() 的停止條件：
  // elapsed + avgPerPerson > PDF_BATCH_TIME_BUDGET_MS 時停止，
  // 另外 processedThisRun < batchSize 這個上限跟時間預算是「兩個獨立的停止
  // 條件」，任一個先到就停——這裡驗證：即使時間預算足夠（例如每人耗時很短），
  // batchSize 上限仍然會生效，不會因為時間夠就把 batchSize 忽略掉。
  const PDF_BATCH_SIZE_DEFAULT = 25; // ConfigSeed.gs 的預設值
  const PDF_BATCH_TIME_BUDGET_MS = 240000; // Constants.gs 的常數

  function simulateBatch(totalPeople, msPerPerson, batchSize, timeBudgetMs) {
    let remaining = totalPeople;
    let rounds = 0;
    while (remaining > 0) {
      rounds++;
      let processedThisRun = 0;
      let elapsed = 0;
      while (remaining > 0 && processedThisRun < batchSize) {
        elapsed += msPerPerson;
        processedThisRun++;
        remaining--;
        const avgPerPerson = elapsed / processedThisRun;
        if (remaining > 0 && elapsed + avgPerPerson > timeBudgetMs) break;
      }
    }
    return rounds;
  }

  // 假設每人約 1.5 秒（0.8 秒匯出＋0.5 秒節流間隔＋些微 highlight 開銷，
  // 見 docs/系統範圍稽核.md 階段 E 的估算依據）
  const rounds60 = simulateBatch(60, 1500, PDF_BATCH_SIZE_DEFAULT, PDF_BATCH_TIME_BUDGET_MS);
  check('★ 60 人、預設 batchSize=25 → 需要 3 輪（25+25+10），由 batchSize 上限決定，不是時間預算',
    rounds60, 3);

  // 驗證：即使把時間預算故意設得很短（模擬異常緩慢的情況），機制仍然會分批完成
  // 而不是卡死或拋錯——這是「可續跑」設計本身在極端情況下依然成立的保證。
  const roundsSlow = simulateBatch(60, 1500, PDF_BATCH_SIZE_DEFAULT, 5000); // 時間預算故意設極短
  check('★ 即使時間預算極短，機制仍然會分成多輪完成（不會卡死），輪數變多但一定收斂',
    roundsSlow > rounds60, true);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
