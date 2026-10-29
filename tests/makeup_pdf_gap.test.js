// 第六十五輪批次 W 組：補寄不會產生缺的個人 PDF，完成訊息又把缺件吞掉。
// 執行方式：node tests/makeup_pdf_gap.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 回歸測試 R1.4、R4.21，`2028T2`）
// ═════════════════════════════════════════════════════════════════════
//
//   第 2 版正式發出只寄了 2 位，之後存成第 3 版。
//   「補寄未收到的人 ▸ 正式發出給全體」預覽列出 53 位（寫明「會寄第 3 版」）。
//   撳「確定補寄」後完成窗只寫「寄出 0 封　模擬 4 封　查無電郵略過 0 位　失敗 0」。
//   SendLog 最尾約 49 行 `ERROR_PDF_MISSING`，只有 4 行 `DRY_RUN`。
//
// 成因：`executeMakeupSend_()` 直接逐人 `deliverOne_()`，冇先補產生個人 PDF；
// 完成窗冇顯示 `errorPdf`／`errorPdfMissing`（後端有回傳）。
//
// 下面用假 ID（P93xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs', 'PersonalLinkInMail.gs',
  // 第六十六輪批次 AC 組：`apiMakeupGenerateMissingPdfs()` 經 `pdfBatchClientFields_()`（PdfBatch.gs）回傳失敗欄位
  'PdfBatch.gs', 'MakeupSend.gs', 'WebAppZone4.gs'
]);

const Q = '2099T4';
const OFFICIAL = gas.MAIL_STAGES.OFFICIAL;
const RECIPIENTS = [
  { type: 'PERSON', personId: 'P9301', email: 'p9301@example.invalid', displayName: '假一' },
  { type: 'PERSON', personId: 'P9302', email: 'p9302@example.invalid', displayName: '假二' },
  { type: 'PERSON', personId: 'P9303', email: 'p9303@example.invalid', displayName: '假三' },
  { type: 'PERSON', personId: 'P9304', email: '', displayName: '假四' },
  { type: 'LIST', personId: '', email: 'office@example.invalid', displayName: '教會辦公室' }
];
// P9302 冇檔、P9303 過期；P9399 冇檔但唔係補寄對象（唔關事）
let PDF_CHECK = {
  applicable: true,
  absent: [{ personId: 'P9302', nameTC: '假二' }, { personId: 'P9399', nameTC: '假九' }],
  stale: [{ personId: 'P9303', nameTC: '假三' }]
};
let ATTACH = 'PERSONAL_PDF';
let delivered = [];
let batchCall = null;

gas.buildMailContext_ = function () { return {}; };
gas.listRecipients_ = function () { return RECIPIENTS; };
gas.readSheet = function () { return []; };
gas.getConfig = function (_k, d) { return d; };
gas.findEmailTemplate_ = function () { return { attachType: ATTACH }; };
gas.findLatestVersionNo = function () { return 3; };
gas.assertWebAppRequestAllowed_ = function () {};
gas.assertNotPreviewMode_ = function () {};
gas.assertOfficialNotFromAutomationTrigger_ = function () {};
gas.resolveMailAttachmentFolder_ = function () {};
gas.writeSendLogRows_ = function () {};
gas.writeAuditLog_ = function () {};
gas.log_ = function () {};
gas.checkMissingPersonalPdfs_ = function () {
  return {
    applicable: PDF_CHECK.applicable,
    absent: PDF_CHECK.absent, stale: PDF_CHECK.stale,
    missing: PDF_CHECK.absent.concat(PDF_CHECK.stale)
  };
};
gas.deliverOne_ = function (r) {
  delivered.push(r.personId || r.email);
  return { status: r.email ? 'DRY_RUN' : 'SKIPPED_NO_EMAIL' };
};
gas.countStatus_ = function (outcomes, status) {
  return outcomes.filter(function (o) { return o.status === status; }).length;
};
gas.generatePersonalPdfBatchForPeople_ = function (q, v, ids) {
  batchCall = { q: q, v: v, ids: ids.slice() };
  return { done: true, doneCount: ids.length, totalPeople: ids.length, generatedCount: ids.length, skippedExistingCount: 0 };
};

// =====================================================================
console.log('\n=== W【核心】補寄目標中有人缺 PDF ⇒ 搵得出係邊幾位 ===');
{
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  const gaps = gas.findMakeupPdfGaps_(plan);
  const ids = gaps.people.map(function (p) { return p.personId; }).sort();
  check('★★★★★★ 只係「這一次要寄、而且缺／過期」嘅人（P9302 冇檔、P9303 過期）',
    JSON.stringify(ids) === JSON.stringify(['P9302', 'P9303']), JSON.stringify(ids));
  check('★★★★★ 唔關事嘅人（P9399，唔係補寄對象）唔計——同 V 組一樣',
    ids.indexOf('P9399') === -1);
  check('★★★★★ 分開數「冇」同「過期」', gaps.absentCount === 1 && gaps.staleCount === 1, JSON.stringify(gaps));
}

console.log('\n=== W【核心】前端預覽拎到缺件數 ===');
{
  const res = gas.apiMakeupSendPlan(Q, OFFICIAL);
  check('（前置）成功', res.ok, JSON.stringify(res).slice(0, 300));
  check('★★★★★★ pdfGaps.count = 2（前端見到 ＞0 就唔畀〔確定補寄〕）',
    res.pdfGaps && res.pdfGaps.count === 2, JSON.stringify(res.pdfGaps));
  check('★★★★ 帶埋名', res.pdfGaps.names.join() === '假二,假三', JSON.stringify(res.pdfGaps.names));
}

console.log('\n=== W【核心】後端唔信前端：缺件就一封都唔寄 ===');
{
  delivered = [];
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  let thrown = null;
  try { gas.executeMakeupSend_(plan); } catch (e) { thrown = e; }
  check('★★★★★★ executeMakeupSend_() 拋錯', thrown && thrown.makeupPdfGap === true, thrown && thrown.message);
  check('★★★★★★ 而且**一封都冇寄**（連有 PDF 嘅 P9301、名單收件人都冇）',
    delivered.length === 0, JSON.stringify(delivered));
  check('★★★★★ 訊息係三段式、講明人數同「沒有寄出任何電郵」',
    thrown && /發生了甚麼：/.test(thrown.message) && /2 位還沒有第 3 版的個人 PDF/.test(thrown.message)
      && /沒有寄出任何電郵/.test(thrown.message), thrown && thrown.message);

  delivered = [];
  const res = gas.apiMakeupSendExecute_locked_(Q, OFFICIAL);
  check('★★★★★★ 網頁執行入口：ok=false、pdfGapBlocked、冇寄',
    res.ok === false && res.pdfGapBlocked === true && delivered.length === 0, JSON.stringify(res).slice(0, 300));
  check('★★★★ 唔再包多一層「補寄未收到的人失敗（…）」',
    !/補寄未收到的人失敗/.test(res.message), res.message);
}

console.log('\n=== W：唔適用嘅情況唔擋 ===');
{
  ATTACH = 'FULL_PDF';
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★★ 附件唔係個人版 PDF ⇒ 唔使 PDF', gas.findMakeupPdfGaps_(plan).people.length === 0);
  ATTACH = 'PERSONAL_PDF';
  const review = gas.planMakeupSend_(Q, 3, gas.MAIL_STAGES.REVIEW);
  check('★★★★★ 審閱信 ⇒ 唔使 PDF', gas.findMakeupPdfGaps_(review).people.length === 0);
}

console.log('\n=== W：冇缺件就照寄，完成結果帶埋 PDF 缺件數 ===');
{
  PDF_CHECK = { applicable: true, absent: [], stale: [] };
  delivered = [];
  const res = gas.apiMakeupSendExecute_locked_(Q, OFFICIAL);
  check('（前置）成功', res.ok === true, JSON.stringify(res).slice(0, 300));
  check('★★★★★ 寄咗', delivered.length > 0, JSON.stringify(delivered));
  check('★★★★★★ 回傳 errorPdf／errorPdfMissing（畫面要顯示）',
    'errorPdf' in res && 'errorPdfMissing' in res, JSON.stringify(res));
}

console.log('\n=== W：〔現在就產生個人 PDF〕只為缺件嗰幾位做 ===');
{
  PDF_CHECK = {
    applicable: true,
    absent: [{ personId: 'P9302', nameTC: '假二' }, { personId: 'P9399', nameTC: '假九' }],
    stale: [{ personId: 'P9303', nameTC: '假三' }]
  };
  batchCall = null;
  const res = gas.apiMakeupGenerateMissingPdfs_locked_(Q, OFFICIAL);
  check('（前置）成功', res.ok === true, JSON.stringify(res));
  check('★★★★★★ 叫 generatePersonalPdfBatchForPeople_() 只帶 P9302、P9303',
    batchCall && JSON.stringify(batchCall.ids.slice().sort()) === JSON.stringify(['P9302', 'P9303'])
      && batchCall.v === 3, JSON.stringify(batchCall));
  PDF_CHECK = { applicable: true, absent: [], stale: [] };
  batchCall = null;
  const none = gas.apiMakeupGenerateMissingPdfs_locked_(Q, OFFICIAL);
  check('★★★★ 冇缺件 ⇒ done，唔叫產生', none.done === true && batchCall === null);
  check('★★★★ 薄殼有拿鎖', /function apiMakeupGenerateMissingPdfs\(quarterId, stage\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);\s*\n\s*return withMutationLock_\(/
    .test(read('src/WebAppZone4.gs')));
}

console.log('\n=== W：選單版本都擋 ===');
{
  const src = read('src/MakeupSend.gs');
  const fn = src.slice(src.indexOf('function runMakeupSendExecute_locked_('), src.indexOf('function promptMakeupTarget_('));
  check('★★★★★ 未打字確認之前檢查缺件',
    fn.indexOf('findMakeupPdfGaps_(plan)') !== -1
      && fn.indexOf('findMakeupPdfGaps_(plan)') < fn.indexOf('MAKEUP_CONFIRM_TEXT'), fn.slice(0, 300));
}

// =====================================================================
console.log('\n=== W【核心】畫面：完成窗有缺件時有結論句，唔可以淨係綠色 ===');
const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone4.html']);
function textOf(nodes) { return nodes.map(function (n) { return n.textContent; }).join('｜'); }
{
  const bad = ui.buildMakeupResultNodes({ ok: true, isDryRun: true, sent: 0, dryRun: 4, skipped: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 49 });
  const t = textOf(bad);
  check('★★★★★★ 顯示「失敗 0　PDF 失敗 0　PDF 缺件 49」', /失敗 0　PDF 失敗 0　PDF 缺件 49/.test(t), t);
  check('★★★★★★ 有結論句：49 位因為沒有個人 PDF 而沒有寄出', /49 位因為沒有個人 PDF 而沒有寄出/.test(t), t);
  check('★★★★★ 有問題時冇任何一行係綠色（ok-line）',
    bad.every(function (n) { return n.className !== 'ok-line'; }), bad.map(function (n) { return n.className; }).join());

  const good = ui.buildMakeupResultNodes({ ok: true, isDryRun: true, sent: 0, dryRun: 4, skipped: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 0 });
  check('★★★★ 全部成功 ⇒ 綠色，冇結論句',
    good.some(function (n) { return n.className === 'ok-line'; }) && !/沒有寄出。/.test(textOf(good)), textOf(good));
  const failedOnly = textOf(ui.buildMakeupResultNodes({ isDryRun: false, sent: 3, dryRun: 0, skipped: 0,
    failed: 2, errorPdf: 1, errorPdfMissing: 0 }));
  check('★★★★ 寄送失敗都有一句', /3 位寄送失敗/.test(failedOnly), failedOnly);
}

console.log('\n=== W【核心】畫面：預覽有缺件 ⇒ 唔畀〔確定補寄〕，畀〔現在就產生個人 PDF〕 ===');
{
  ui.renderMakeupPlan(OFFICIAL, {
    ok: true, stage: OFFICIAL, versionNo: 3, isDryRun: true, attachType: 'PERSONAL_PDF', attachLabel: '個人版 PDF',
    people: [{ nameTC: '假二', hasEmail: true, isListRecipient: false }],
    cannotSend: [], alreadySentCount: 0, cannotSendCount: 0,
    pdfGaps: { count: 2, absentCount: 1, staleCount: 1, names: ['假二', '假三'] }
  });
  const title = ui.document.getElementById('modalTitle').textContent;
  const body = ui.document.getElementById('modalBody').textContent;
  const labels = ui.document.getElementById('modalActions').children.map(function (c) { return c.textContent; });
  check('★★★★★★ 開嘅係「還沒有個人 PDF」窗', /還沒有個人 PDF/.test(title), title);
  check('★★★★★★ 有〔現在就產生個人 PDF〕，冇〔確定補寄〕',
    labels.indexOf('現在就產生個人 PDF') !== -1 && labels.indexOf('確定補寄') === -1, JSON.stringify(labels));
  check('★★★★★ 講明幾多位、第幾版、冇寄出', /2 位還沒有第 3 版的個人 PDF/.test(body) && /沒有寄出任何電郵/.test(body), body);
}

console.log('\n=== W：產生 PDF 嘅迴圈同正式發出共用 ===');
{
  const z1 = read('src/ui/ScriptZone1.html');
  const z4 = read('src/ui/ScriptZone4.html');
  check('★★★★★ 補寄用共用嘅 runPdfBatchToCompletion()，叫 apiMakeupGenerateMissingPdfs',
    /function runMakeupPdfBatch\(stage\) \{\s*\n\s*runPdfBatchToCompletion\(\{\s*\n\s*callBatch: \(\) => callServerMutating\('apiMakeupGenerateMissingPdfs', currentQuarterId, stage\)/.test(z4));
  check('★★★★★ 正式發出都用同一支', /function runMissingPdfBatch\(versionNo, sendOpts\) \{\s*\n\s*runPdfBatchToCompletion\(\{/.test(z1));
  check('★★★★ 做完行返補寄確認', /backLabel: '回到補寄確認'/.test(z4) && /onBack: \(\) => \{ closeModal\(\); openMakeupPreview\(stage\); \}/.test(z4));
  check('★★★★ 只得一個迴圈（ScriptZone4 冇自己再寫一份 MISSING_PDF_MAX_ROUNDS）', z4.indexOf('MISSING_PDF_MAX_ROUNDS') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
