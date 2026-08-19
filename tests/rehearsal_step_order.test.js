// 第三十輪批次階段 C：演練工具三項（次序、報告寫入、留低咗乜）。
// 執行方式：node tests/rehearsal_step_order.test.js
//
// ─────────────────────────────────────────────────────────────────────
// C1　次序排錯咗（Ivan 嘅 spec 寫錯，唔係實作問題）
// ─────────────────────────────────────────────────────────────────────
//
// 舊次序：生成 → **儲存並確認** → 寄審閱 → 正式發出 → 重發
//
// 「儲存並確認」只有喺 `REVIEW_SENT` 先會令 Stage 前進到
// `REQUESTS_APPLIED`。排喺寄審閱之前，佢喺 `DRAFT` 撳、零改動＝乜都唔做，
// 之後「正式發出」需要 `REQUESTS_APPLIED` 但 Stage 停喺 `REVIEW_SENT`
// ⇒ 連環失敗。
//
// ⚠️ 而且報告只寫「步驟 4 失敗」，睇唔出係「真失敗」定係
// 「前一步冇行到所以連鎖」——所以每一步都要記低前置條件。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Diagnostics.gs', 'SeasonRehearsal.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const src = read('src/SeasonRehearsal.gs');

console.log('\n=== C1【核心】次序改成真實流程 ===');
{
  const order = ['步驟 1：生成初稿', '步驟 2：寄給堂委審閱',
    '步驟 3：儲存並確認（零改動）', '步驟 4：正式發出給全體', '步驟 5：改動後重發'];
  const positions = order.map(function (name) { return src.indexOf("'" + name + "'"); });
  check('★★★★★ 五步都喺原始碼入面搵得到',
    positions.every(function (p) { return p !== -1; }), JSON.stringify(positions));
  check('★★★★★ 而且次序係「生成 → 寄審閱 → 儲存並確認 → 正式發出 → 重發」'
    + '——舊次序把「儲存並確認」排喺寄審閱之前，會令步驟 4 連環失敗',
    positions.every(function (p, i) { return i === 0 || p > positions[i - 1]; }),
    JSON.stringify(positions));
  check('★★★★★ **「儲存並確認」排喺「寄給堂委審閱」之後**（呢個就係修正）',
    src.indexOf("'步驟 3：儲存並確認（零改動）'")
      > src.indexOf("'步驟 2：寄給堂委審閱'"));
}

console.log('\n=== C1【核心】每一步都記低前置條件 ===');
{
  const required = [
    ['步驟 1：生成初稿', 'QUARTER_STAGE.DRAFT'],
    ['步驟 2：寄給堂委審閱', 'QUARTER_STAGE.DRAFT'],
    ['步驟 3：儲存並確認（零改動）', 'QUARTER_STAGE.REVIEW_SENT'],
    ['步驟 4：正式發出給全體', 'QUARTER_STAGE.REQUESTS_APPLIED'],
    ['步驟 5：改動後重發', 'QUARTER_STAGE.OFFICIAL_SENT']
  ];
  required.forEach(function (r) {
    const at = src.indexOf("'" + r[0] + "'");
    const chunk = src.slice(at, at + 220);
    check('★★★★★ ' + r[0] + ' 標明前置 Stage 係 ' + r[1],
      chunk.indexOf('requiresStage: ' + r[1]) !== -1, chunk.slice(0, 180));
  });
}

console.log('\n=== C1【核心】前置條件不符合 ⇒ 報告要講到「係連鎖」 ===');
{
  const log = [];
  // 沒有 `requiresStage` ⇒ 當作沒有前置條件。
  gas.runRehearsalStep_(log, '甲', null, function () { return {}; });
  check('★★★★ 冇前置條件嗰步寫「（沒有前置條件）」，唔會扮成檢查過',
    log[0].preconditionText === '（沒有前置條件）' && log[0].preconditionMet === true,
    JSON.stringify(log[0]));

  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {},
    created: { versions: [], pdfPaths: [] },
    steps: [
      { name: '步驟 3：儲存並確認（零改動）', ok: false, seconds: 0.1,
        preconditionText: 'Stage 要係 REVIEW_SENT，實際係 DRAFT　⚠️ 不符合——下面的失敗很可能是連鎖，不是這一步本身',
        preconditionMet: false, detail: {}, error: 'Stage 不對' },
      { name: '步驟 4：正式發出給全體', ok: false, seconds: 0.1,
        preconditionText: 'Stage 要係 REQUESTS_APPLIED，實際係 DRAFT　⚠️ 不符合——下面的失敗很可能是連鎖，不是這一步本身',
        preconditionMet: false, detail: {}, error: 'Stage 不對' }
    ],
    pdfFiles: { available: false, reason: 'x' },
    ics: { available: false, reason: 'x' }, highlight: { available: false, reason: 'x' }
  });
  const text = rows.map(function (r) { return [r.section, r.item, r.value, r.note].join('|'); }).join('\n');

  check('★★★★★ 逐步都有一行「前置條件」，同「結果」排埋一齊',
    (text.match(/\|前置條件\|/g) || []).length === 2, text);
  check('★★★★★ 不符合嗰啲會標 `⚠️ 不符合`',
    (text.match(/前置條件\|[^|]*\|⚠️ 不符合/g) || []).length === 2, text);
  check('★★★★★ 而且完結有一行「其中因為前置條件不符合而連鎖的」'
    + '——冇呢一行，兩步都失敗睇落好似兩個獨立問題',
    text.indexOf('其中因為前置條件不符合而連鎖的|2') !== -1, text);
  check('★★★★★ 而且明講「先看前一步」',
    text.indexOf('先看前一步') !== -1, text);
}

console.log('\n=== C2-2【核心】每一格強制變成字串，唔會令整份報告寫唔入 ===');
{
  // 實測：`s.detail[k]` 入面有陣列（例如 `warnings`），
  // 而 `Range.setValues()` 唔接受 ⇒ 整份報告拋錯，被 catch 食咗。
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {},
    created: { versions: [], pdfPaths: [] },
    steps: [{
      name: '步驟 1：生成初稿', ok: true, seconds: 1,
      preconditionText: '（沒有前置條件）', preconditionMet: true,
      detail: {
        warnings: [{ ruleId: 'X', reason: 'Y' }, { ruleId: 'Z', reason: 'W' }],
        nested: { a: 1, b: [2, 3] },
        emptyArray: [],
        nothing: null,
        num: 42
      },
      error: ''
    }],
    pdfFiles: { available: false, reason: 'x' },
    ics: { available: false, reason: 'x' }, highlight: { available: false, reason: 'x' }
  });
  const bad = rows.filter(function (r) {
    return typeof r.section !== 'string' || typeof r.item !== 'string'
      || typeof r.value !== 'string' || typeof r.note !== 'string';
  });
  check('★★★★★ 每一格都係字串（`setValues()` 唔接受陣列／物件，'
    + '而一格唔啱就會令**整份報告**寫唔入）',
    bad.length === 0, JSON.stringify(bad.slice(0, 3)));

  const text = rows.map(function (r) { return r.item + '|' + r.value; }).join('\n');
  check('★★★★★ 陣列展開成人話，唔係變成 `[object Object]`',
    text.indexOf('warnings|') !== -1 && text.indexOf('[object Object]') === -1, text);
  check('★★★★ 空陣列講「（空）」，`null` 講「（沒有值）」'
    + '——兩者同 0／空字串係唔同嘅事',
    text.indexOf('emptyArray|（空）') !== -1
    && text.indexOf('nothing|（沒有值）') !== -1, text);
  check('★★★★ 數字照樣讀得出', text.indexOf('num|42') !== -1);

  // ⚠️ 反面：**唔可以靠「靜靜跳過寫唔入嗰啲行」解決**。
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  check('★★★★★ 冇任何「跳過寫唔入嘅行」嘅邏輯'
    + '——嗰樣係把問題藏得更深',
    !/skipUnwritable|filter\([^)]*canWrite|dropBadRows/.test(stripComments(src)));
}

console.log('\n=== C2-2【核心】寫入失敗要把原因帶返出嚟 ===');
{
  const diag = read('src/Diagnostics.gs');
  check('★★★★★ 有 `tryWriteDiagnosticsDetailed_()`，回 `{ok, error}`',
    /function tryWriteDiagnosticsDetailed_\(reportName, rows\)/.test(diag)
    && /return \{ ok: false, error: err\.message \};/.test(diag));
  check('★★★★★ 而 `tryWriteDiagnostics_()` 變成薄殼，'
    + '其餘 20 幾個呼叫點嘅 boolean 行為完全不變',
    /return tryWriteDiagnosticsDetailed_\(reportName, rows\)\.ok;/.test(diag));
  check('★★★★★ 演練用嗰個帶原因嘅版本',
    /const wrote = tryWriteDiagnosticsDetailed_\(SEASON_REHEARSAL_REPORT, rows\);/.test(src));
  check('★★★★★ 而且對話框印咗 `wrote.error`'
    + '——舊寫法只講「見執行記錄」，而 Ivan 讀唔到 Logger，等於冇講',
    /\+ wrote\.error/.test(src));
  check('★★★★★ 失敗嗰陣明講「Diagnostics 裡面沒有這份報告」'
    + '——實測就係「對話框話已寫入 170 行，但嗰一份表根本冇」',
    src.indexOf('Diagnostics 裡面沒有這份報告') !== -1);
}

console.log('\n=== C3【核心】逐個列出呢次演練建立咗乜 ===');
{
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4',
    baseline: { stage: 'DRAFT', latestVersionNo: 6, sendLogRows: 100, pdfFileCount: 200 },
    after: { stage: 'OFFICIAL_SENT', latestVersionNo: 8, sendLogRows: 162, pdfFileCount: 258 },
    created: { versions: [7, 8], pdfPaths: ['RosterPDF / 2027T4 / v8 / x.pdf'] },
    steps: [],
    pdfFiles: {
      available: true, rootName: 'RosterPDF',
      files: [
        { name: 'old.pdf', sizeBytes: 1, path: 'RosterPDF / 2027T4 / v6 / old.pdf',
          inSubfolder: true, isNew: false },
        { name: 'x.pdf', sizeBytes: 2, path: 'RosterPDF / 2027T4 / v8 / x.pdf',
          inSubfolder: true, isNew: true }
      ]
    },
    ics: { available: false, reason: 'x' }, highlight: { available: false, reason: 'x' }
  });
  const cleanup = rows.filter(function (r) { return r.section === '清理'; });
  const text = cleanup.map(function (r) { return r.item + '|' + r.value + '|' + r.note; }).join('\n');

  check('★★★★★ 逐個列出呢次建立嘅版本（`v7、v8`）'
    + '——2027T4 已經累積咗 9 個版本，只講「由 6 變到 8」清理嗰陣唔夠用',
    text.indexOf('這次演練建立的版本|v7、v8') !== -1, text);
  check('★★★★★ SendLog 講「新增 62 行」，唔止講前後兩個數',
    text.indexOf('這次演練新增的 SendLog 行數|62') !== -1, text);
  check('★★★★★ 逐個列出呢次新建嘅 PDF 路徑',
    text.indexOf('新 PDF|RosterPDF / 2027T4 / v8 / x.pdf') !== -1, text);
  check('★★★★★ 而且舊嗰個唔會被當成「呢次新建」'
    + '——標錯咗就會叫人清走一份唔應該清嘅檔案',
    text.indexOf('v6 / old.pdf') === -1, text);
  check('★★★★ 逐個檔案清單入面，新嗰個有標註',
    rows.some(function (r) {
      return r.section === 'PDF 逐個檔案' && r.item.indexOf('v8 / x.pdf') !== -1
        && r.note.indexOf('這一次演練新建立的') !== -1;
    }));
  check('★★★★★ 照舊講明**刻意**唔自動清',
    text.indexOf('刻意不會自動清理') !== -1);
}

console.log('\n=== C3 冇標到就講「查不到」，唔可以報 0 ===');
{
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4',
    baseline: { latestVersionNo: 6, sendLogRows: 0, pdfFileCount: 0 },
    after: { latestVersionNo: 6, sendLogRows: 0, pdfFileCount: 0 },
    created: { versions: [], pdfPaths: [] },
    steps: [], pdfFiles: { available: false, reason: '讀不到資料夾' },
    ics: { available: false, reason: 'x' }, highlight: { available: false, reason: 'x' }
  });
  const text = rows.filter(function (r) { return r.section === '清理'; })
    .map(function (r) { return r.item + '|' + r.value; }).join('\n');
  check('★★★★★ 一個版本都冇建 ⇒ 明講「（沒有建立新版本）」',
    text.indexOf('這次演練建立的版本|（沒有建立新版本）') !== -1, text);
  check('★★★★★ PDF 標唔到 ⇒ 講「查不到」，**唔可以報 0**'
    + '——0 會令人以為確認過一份都冇新建',
    text.indexOf('這次演練新建立的 PDF|（查不到——只知道總數的變化）') !== -1, text);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
