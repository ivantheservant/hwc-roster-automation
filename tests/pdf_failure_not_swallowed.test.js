// 第六十六輪批次 AC 組（優先）＋ AD 組後端：個人 PDF 產生失敗唔可以被吞咗。
// 執行方式：node tests/pdf_failure_not_swallowed.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-21 自測機，沙盒 2028T3 第 3 版）
// ═════════════════════════════════════════════════════════════════════
//
//   S08 最後一次回傳 `{"done":true,"doneCount":59,"totalPeople":59,"generatedCount":59}` ⇒ 判綠。
//   Drive 上個人檔只有 58 份，缺 1 位；S09 因此 `ERROR_PDF_MISSING`，S10／S11 被擋住。
//
// 成因（四處）：
//   1. `runPersonalPdfBatchLoopInner_()` 失敗都 `generatedCount++`
//   2. `apiGeneratePersonalPdfBatch()` 回傳冇 `errors`
//   3. 前端只睇 `done`，完成窗寫「已完成 N / N」
//   4. `selfTestS08_()` 只斷言 `done === true`
//
// 呢一份**真嘅執行** PdfBatch.gs／WebAppZone4.gs／SelfTestRunner.gs，只換走 Drive／試算表嗰層。
// 下面用假 ID（P98xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 造一個沙盒：PdfBatch.gs＋WebAppZone4.gs 真碼，Drive／試算表／匯出換假。
 * @param {{ids: string[], failPlan: Object, batchSize: number}} opts
 *   `failPlan[personId] = 還會失敗幾次`（每次匯出拋錯扣一次）
 */
function sandbox(opts) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs',
    'PdfBatch.gs', 'WebAppZone4.gs']);
  const props = {};
  gas.PropertiesService = { getScriptProperties: function () {
    return {
      getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
      setProperty: function (k, v) { props[k] = v; },
      deleteProperty: function (k) { delete props[k]; }
    };
  } };
  const exportCalls = [];
  const plan = JSON.parse(JSON.stringify(opts.failPlan || {}));
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.PDF_BATCH_SIZE && opts.batchSize) return opts.batchSize;
    return d;
  };
  gas.log_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.withMutationLock_ = function (_l, fn) { return fn(); };
  gas.getOrCreateRosterSubfolder_ = function () { return {}; };
  gas.listExistingFileInfo_ = function () { return new Map(); };
  gas.readVersionAssignmentsRaw_ = function () { return []; };
  gas.openPersonalPdfRenderContext_ = function () { return { close: function () {} }; };
  gas.readPersonalPdfContentStamp_ = function () { return { updatedAt: null, timezone: 'UTC' }; };
  gas.listPeopleNeedingPersonalPdf_ = function () { return opts.ids.map(function (id) { return { personId: id }; }); };
  gas.lookupPersonName_ = function (id) { return '姓' + id.slice(-2); };
  gas.buildAttachmentName_ = function (q, v, n) { return q + '_v' + v + '_' + n + '.pdf'; };
  gas.buildPersonalPdfBlob_ = function (_q, _v, id) {
    exportCalls.push(id);
    if (plan[id] > 0) { plan[id]--; throw new Error('匯出暫時出錯（' + id + '）'); }
    return { fileName: id + '.pdf', blob: {}, retries: 0, highlightMs: 1, exportMs: 1 };
  };
  gas.saveOrOverwriteFile_ = function () { return { getSize: function () { return 50000; } }; };
  gas.checkFileActuallySucceeded_ = function () { return false; };
  return { gas: gas, exportCalls: exportCalls, props: props };
}

const IDS = ['P9801', 'P9802', 'P9803', 'P9804', 'P9805'];

// =====================================================================
console.log('\n=== AC【核心】失敗唔計入「新產生」；自動再試一次 ===');
{
  // 一次失敗、再試成功
  const a = sandbox({ ids: IDS, failPlan: { P9803: 1 } });
  const ra = a.gas.generatePersonalPdfBatch_('2099T4', 3);
  check('★★★★★★ 再試成功 ⇒ failedCount ＝ 0、errors 空', ra.failedCount === 0 && ra.errors.length === 0, JSON.stringify(ra));
  check('★★★★★★ 失敗嗰份自動再試咗**一次**（匯出叫咗 2 次）',
    a.exportCalls.filter(function (x) { return x === 'P9803'; }).length === 2, a.exportCalls.join());
  check('★★★★★ 再試成功之後 generatedCount ＝ 5（全部）', ra.generatedCount === 5 && ra.doneCount === 5, JSON.stringify(ra));
  check('★★★★ 講得出「再試成功 1 份」', ra.retriedOkCount === 1, ra.retriedOkCount);

  // 一直失敗
  const b = sandbox({ ids: IDS, failPlan: { P9803: 99 } });
  const rb = b.gas.generatePersonalPdfBatch_('2099T4', 3);
  check('★★★★★★ 仍然失敗 ⇒ generatedCount **唔包**佢（4，唔係 5）', rb.generatedCount === 4, JSON.stringify(rb));
  check('★★★★★★ failedCount ＝ 1，errors 有 PersonID／姓名／訊息',
    rb.failedCount === 1 && rb.errors.length === 1 && rb.errors[0].personId === 'P9803'
      && rb.errors[0].nameTC === '姓03' && /匯出暫時出錯/.test(rb.errors[0].message), JSON.stringify(rb.errors));
  check('★★★★★ 只再試一次（總共匯出 2 次，唔係無限）',
    b.exportCalls.filter(function (x) { return x === 'P9803'; }).length === 2, b.exportCalls.join());
  check('★★★★ 仍然 done（失敗唔係「未做完」）', rb.done === true && rb.doneCount === 5);
}

console.log('\n=== AC【核心】Web API 全部交出 failedCount＋errors ===');
{
  const s = sandbox({ ids: IDS, failPlan: { P9803: 99 } });
  const r = s.gas.apiGeneratePersonalPdfBatch('2099T4', 3);
  check('★★★★★★ apiGeneratePersonalPdfBatch：failedCount ＝ 1、errors 帶姓名',
    r.ok === true && r.failedCount === 1 && r.errors[0].personId === 'P9803' && r.errors[0].nameTC === '姓03', JSON.stringify(r));
  check('★★★★★ generatedCount 唔包失敗', r.generatedCount === 4, r.generatedCount);

  // 指定人版（補寄用）
  const m = sandbox({ ids: IDS, failPlan: { P9802: 99 } });
  m.gas.findLatestVersionNo_ = function () { return 3; };
  m.gas.planMakeupSend_ = function () { return {}; };
  m.gas.findMakeupPdfGaps_ = function () {
    return { people: [{ personId: 'P9802', nameTC: '姓02' }, { personId: 'P9804', nameTC: '姓04' }], absentCount: 2, staleCount: 0 };
  };
  const rm = m.gas.apiMakeupGenerateMissingPdfs_locked_('2099T4', 'OFFICIAL');
  check('★★★★★★ apiMakeupGenerateMissingPdfs：failedCount ＝ 1', rm.ok === true && rm.failedCount === 1
    && rm.errors[0].personId === 'P9802' && rm.generatedCount === 1, JSON.stringify(rm));

  // 改動後重發（apiStep5GeneratePdfs）用同一支 `pdfBatchClientFields_()`
  check('★★★★★ 改動後重發 API 都經 pdfBatchClientFields_()',
    /\}, pdfBatchClientFields_\(pdfResult\)\);/.test(read('src/WebAppFlow.gs')));
}

console.log('\n=== AD【核心】後端交出「呢一次呼叫自己嘅增量」 ===');
{
  const s = sandbox({ ids: IDS, failPlan: {}, batchSize: 2 });
  const r1 = s.gas.generatePersonalPdfBatch_('2099T4', 3);
  const r2 = s.gas.generatePersonalPdfBatch_('2099T4', 3);
  const r3 = s.gas.generatePersonalPdfBatch_('2099T4', 3);
  check('★★★★★★ 三輪（2＋2＋1）：累計 generatedCount 係 2、4、5', [r1.generatedCount, r2.generatedCount, r3.generatedCount].join() === '2,4,5',
    [r1.generatedCount, r2.generatedCount, r3.generatedCount].join());
  check('★★★★★★ 但每輪嘅增量係 2、2、1（前端累加就得出 5）',
    [r1.callGeneratedCount, r2.callGeneratedCount, r3.callGeneratedCount].join() === '2,2,1',
    [r1.callGeneratedCount, r2.callGeneratedCount, r3.callGeneratedCount].join());
  check('★★★★ attemptedIds 只係嗰一輪處理過嘅人', r2.attemptedIds.join() === 'P9803,P9804', r2.attemptedIds.join());
  check('★★★★ 最後一輪 done', r1.done === false && r3.done === true);
}

// =====================================================================
console.log('\n=== AC：自測機 S08——有失敗 ⇒ 紅（唔報綠），S09 就會係 BLOCKED 唔係「真正失敗」 ===');
{
  function s08(apiResult) {
    const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
      'QuarterStage.gs', 'Invariants.gs', 'SelfTestRunner.gs']);
    gas.findLatestVersionNo_ = function () { return 3; };
    gas.selfTestCall_ = function (_id, _api, fn) { return fn(); };
    gas.selfTestRecordPayload_ = function () {};
    gas.selfTestOutOfTime_ = function () { return false; };
    gas.apiGeneratePersonalPdfBatch = function () { return apiResult; };
    return gas.selfTestS08_('2099T4');
  }
  const red = s08({ ok: true, done: true, doneCount: 59, totalPeople: 59, generatedCount: 58, failedCount: 1,
    errors: [{ personId: 'P9804', nameTC: '姓04', message: '匯出暫時出錯' }] });
  check('★★★★★★ failedCount ＞ 0 ⇒ S08 係 FAILED（唔係 PASSED）', red.status === 'FAILED', red.status);
  const evidence = JSON.stringify(red.failedChecks);
  check('★★★★★ 證據列出 PersonID 同訊息', /P9804/.test(evidence) && /匯出暫時出錯/.test(evidence), evidence);
  const green = s08({ ok: true, done: true, doneCount: 59, totalPeople: 59, generatedCount: 59, failedCount: 0, errors: [] });
  check('★★★★ 冇失敗 ⇒ 照舊 PASSED', green.status === 'PASSED', JSON.stringify(green));
  const old = s08({ ok: true, done: true, doneCount: 59, totalPeople: 59, generatedCount: 59 });
  check('★★★ 舊回傳（冇 failedCount 欄）⇒ 照舊 PASSED（唔會因為欄位冇咗而紅）', old.status === 'PASSED', old.status);
}

console.log('\n=== AC：其他入口（選單、重發選單）唔再寫「已全部完成」／照寄 ===');
{
  const menu = read('src/Menu.gs');
  check('★★★★ 選單「產生個人 PDF」有失敗就唔寫「已全部完成」',
    /result\.errors\.length > 0\s*\?\s*'已處理完 '/.test(menu));
  const four = read('src/FourStageFlow.gs');
  check('★★★★★ 選單「步驟 5」有 PDF 失敗就停低、唔照寄',
    /pdfResult\.errors && pdfResult\.errors\.length > 0[\s\S]{0,700}return;/.test(four));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
