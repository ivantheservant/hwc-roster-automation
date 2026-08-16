// 第十九輪批次階段 D3／E：個人 PDF 版本語意與匯出速率。
// 執行方式：node tests/pdf_version_and_pacing.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 階段 D 查到嘅真相（先攞證據，後落結論）
// ─────────────────────────────────────────────────────────────────────
//
// 現象：啱啱先為 v1 做完 57 份個人 PDF，步驟 5 話「版本號：v1」，
// 但又再重新產生咗 57 份。`PDF_REGENERATE_IF_EXISTS` 係 FALSE，
// 睇落應該全部略過先啱。
//
// **結論：唔係 bug，係合理行為。**
//
// 檔名係 `{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf`
// ——**版本號嵌喺檔名入面**（`buildAttachmentName_()`，PdfExport.gs）。
// 而「已存在」嘅判斷係「同一個檔名 + 大小達標」
// （`generateOnePersonalPdf_()`，PdfBatch.gs），唔係按 Drive 檔案 ID、
// 亦都唔係按內容 hash。
//
// 所以：**版本號一變，就一定係另一個檔名 ⇒ 一定要重做。**
// 而「產生個人 PDF」個選單項嘅版本號提示係「留空 = 最新版本」，
// 所以如果產生嗰陣最新版本仲係 v0、之後步驟 3 套用申報建立咗 v1，
// 步驟 5 為 v1 重做全部就係**正確**嘅——v1 嘅內容可能同 v0 唔同，
// 把 v0 嘅 PDF 當成 v1 寄出去先至係真正嘅錯。
//
// 版本號放入檔名，正正就係為咗防止呢件事。所以唔改行為，改嘅係
// 「事先講清楚」＋「畀個工具睇得到」。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PdfExport.gs', 'PdfBatch.gs']);

// buildAttachmentName_() 會讀 Config 拎 pattern；用替身避開試算表。
// （同 state_source_authority.test.js 一樣，一定要喺載入之後先設。）
gas.getConfig = function (key, fallback) {
  if (key === 'ATTACH_NAME_PATTERN') return '{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf';
  return fallback;
};

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

console.log('\n=== D3【核心】版本號嵌喺檔名 ⇒ 版本一變就一定重做 ===');
{
  const v0 = gas.buildAttachmentName_('2026T4', 0, '假甲');
  const v1 = gas.buildAttachmentName_('2026T4', 1, '假甲');

  checkEqual('★★★★★ v0 同 v1 係兩個唔同嘅檔名'
    + '——「已存在」按檔名判斷，所以版本一變就一定重做。'
    + '呢個就係「啱啱做完 57 份、步驟 5 又做多次」嘅真相',
    v0 === v1, false);
  check('★★★★ 檔名入面真係有版本號', v0.indexOf('_v0_') !== -1 && v1.indexOf('_v1_') !== -1,
    v0 + ' / ' + v1);
  check('★★★★ 同一個版本、同一個人 ⇒ 檔名穩定（否則每次都會重做）',
    gas.buildAttachmentName_('2026T4', 1, '假甲') === v1);
  check('★★★ 唔同人 ⇒ 唔同檔名',
    gas.buildAttachmentName_('2026T4', 1, '假乙') !== v1);
}

console.log('\n=== D3：版本分佈報告要答得出「下次會唔會重做」===');
{
  // 情境一：檔案全部係舊版本（＝實測嗰次）
  const stale = gas.buildPersonalPdfVersionReport_({
    quarterId: '2026T4', latestVersionNo: 1, totalFiles: 57,
    byVersion: [{ version: 'v0', count: 57 }], folderName: '測試資料夾'
  });
  check('★★★★★ 全部係舊版本時，明確講「會重新產生全部」',
    stale.indexOf('重新產生全部') !== -1, stale);
  check('★★★★★ 而且明確講「這不是故障」'
    + '——唔好等幹事以為系統壞咗',
    stale.indexOf('不是故障') !== -1);
  check('★★★★ 解釋咗機制（檔名有版本號）',
    stale.indexOf('{VersionNo}') !== -1);
  check('★★★★ 講埋最常見成因（產生時版本還是舊那個）',
    stale.indexOf('留空') !== -1 && stale.indexOf('步驟 3') !== -1);

  // 情境二：全部最新
  const fresh = gas.buildPersonalPdfVersionReport_({
    quarterId: '2026T4', latestVersionNo: 1, totalFiles: 57,
    byVersion: [{ version: 'v1', count: 57 }], folderName: '測試資料夾'
  });
  check('★★★★★ 全部最新時講「會略過已存在的，不會重做」',
    fresh.indexOf('不會重做') !== -1, fresh);
  check('★★★★ 唔會誤報「不是故障」嗰段（唔啱情境就唔好噏）',
    fresh.indexOf('不是故障') === -1);

  // 情境三：新舊混合
  const mixed = gas.buildPersonalPdfVersionReport_({
    quarterId: '2026T4', latestVersionNo: 1, totalFiles: 60,
    byVersion: [{ version: 'v0', count: 3 }, { version: 'v1', count: 57 }],
    folderName: '測試資料夾'
  });
  check('★★★★ 混合時講得出幾多個係舊版本殘留',
    mixed.indexOf('3 個是舊版本') !== -1, mixed);
}

// =====================================================================
// 階段 E：匯出速率
// =====================================================================
console.log('\n=== E1【核心】pacing 預設值同實測推導 ===');
{
  checkEqual('★★★★★ PDF_EXPORT_PACING_MS 預設由 500 調到 1500'
    + '（實測：57 份撞 47 次重試，285 / 530 秒係喺度等重試）',
    gas.DEFAULTS.PDF_EXPORT_PACING_MS, 1500);

  // 損益平衡驗算：多付嘅 pacing 時間一定要遠細過目前嘅重試等待
  const n = 57;
  const extraPacingSec = (1500 - 500) / 1000 * n;   // 57 秒
  const currentRetryWaitSec = 285;
  check('★★★★★ 損益平衡點低於 20%——就算加大 pacing 只消除兩成重試'
    + '都已經打和，向上空間（約 200 秒）遠大過下行風險（57 秒）',
    extraPacingSec / currentRetryWaitSec < 0.25,
    '多付 ' + extraPacingSec + ' 秒 / 目前重試等待 ' + currentRetryWaitSec + ' 秒');

  checkEqual('★★★★ 每份平均耗時常數同實測一致（530.3 / 57 ≈ 9.3）',
    gas.PERSONAL_PDF_SECONDS_PER_FILE, 9.3);
}

console.log('\n=== E1：耗時預估要講得出人聽得明嘅數字 ===');
{
  check('★★★★ 57 份 ≈ 9 分鐘',
    gas.estimatePersonalPdfDurationText_(57) === '約 9 分鐘',
    gas.estimatePersonalPdfDurationText_(57));
  check('★★★ 少量用秒做單位（唔好講「約 0 分鐘」）',
    gas.estimatePersonalPdfDurationText_(5).indexOf('秒') !== -1,
    gas.estimatePersonalPdfDurationText_(5));
  checkEqual('★★★ 0 份唔會講廢話', gas.estimatePersonalPdfDurationText_(0), '');
}

console.log('\n=== E2【核心】重試偏多時要提示，唔好靜靜咁慢 ===');
{
  // 實測嗰組：47 / 57 ≈ 82%
  const hint = gas.buildPdfRetryHintText_({ totalPeople: 57, totalRetries: 47 });
  check('★★★★★ 47 / 57 會出提示', hint !== '', hint);
  check('★★★★ 提示講得出比例', hint.indexOf('82%') !== -1, hint);
  check('★★★★ 提示指名可以調邊個參數',
    hint.indexOf('PDF_EXPORT_PACING_MS') !== -1);
  check('★★★★★ 提示明確講「這不是故障」'
    + '——重試機制本身運作正常，唔應該因為呢個提示去改重試邏輯',
    hint.indexOf('不是故障') !== -1);
  check('★★★★ 提示解釋咗「多等一點反而可能更快」呢個反直覺嘅點',
    hint.indexOf('反而') !== -1);

  // 反向：偶爾一兩次重試唔應該嘈
  checkEqual('★★★★★ 反向：2 / 57 唔會出提示（正常波動，每次都嘈就會冇人睇）',
    gas.buildPdfRetryHintText_({ totalPeople: 57, totalRetries: 2 }), '');
  checkEqual('★★★ 零重試唔會出提示',
    gas.buildPdfRetryHintText_({ totalPeople: 57, totalRetries: 0 }), '');
  checkEqual('★★★ 零份數唔會爆',
    gas.buildPdfRetryHintText_({ totalPeople: 0, totalRetries: 0 }), '');
}

console.log('\n=== E3：唔可以為咗優化而改動重試機制本身嘅正確性 ===');
{
  checkEqual('★★★★ 最大重試次數維持 4（本輪冇改）', gas.DEFAULTS.PDF_EXPORT_MAX_RETRIES, 4);
  checkEqual('★★★★ 重試間隔維持 1000ms（本輪冇改）', gas.DEFAULTS.PDF_EXPORT_RETRY_DELAY_MS, 1000);
  checkEqual('★★★★ 檔案大小門檻維持（呢個係正確性關卡，唔係效能參數）',
    gas.DEFAULTS.PDF_MIN_SIZE_BYTES, 10240);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
