// 第十二輪批次階段 C：修正「公開連結狀態（唯讀）」完成畫面顯示「共 true 行」
// 嘅型別錯誤，並掃描全專案有冇同類問題。
// 執行方式：node tests/diagnostics_written_count.test.js
//
// 根源：`tryWriteDiagnostics_(reportName, rows)`（Diagnostics.gs）回傳嘅係
// 「有冇成功寫入」嘅**布林值**，唔係寫入行數。實測發現「公開連結狀態」
// 完成畫面把呢個布林值直接當行數顯示，變成「共 true 行」。逐一檢查全部
// 呼叫點之後，另外喺 DraftReviewReport.gs／EpsilonTrial.gs／SoftRuleMetrics.gs
// 搵到三處同一種寫法（`const written = tryWriteDiagnostics_(...)`），一併修正。
//
// 呢份測試做**永久回歸**：掃描全部 src/*.gs，確保呢種寫法唔會再出現
// ——正確寫法一定係將 `tryWriteDiagnostics_(...)` 當獨立陳述式呼叫，
// 行數另外用 `rows.length` 計。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const SRC = path.join(__dirname, '..', 'src');
const gsFiles = fs.readdirSync(SRC).filter(function (f) { return f.endsWith('.gs'); });

console.log('\n=== C1【核心】永久回歸：唔會再有「將 tryWriteDiagnostics_() 嘅布林值當行數用」呢種寫法 ===');
{
  // 錯誤寫法固定形態：`<標識符> = tryWriteDiagnostics_(...)`，之後嗰個變數
  // 又被當數字/字串用（例如 `+ written + ' 行'`）。
  //
  // ⚠️ 第三十輪批次修正：本來呢度鎖死「一律唔可以捕捉回傳值」。
  // 太嚴——「寫入失敗要講返」係一個**啱嘅**需求（`SeasonRehearsal.gs`
  // 原本嘅 `(written ? '' : '（⚠️ 寫入失敗…）')` 設計係啱嘅）。
  // 為咗過呢一條而把整個賦值拆走，結果漏咗清走下面嗰個引用，
  // 變成 `written is not defined`：對話框寫「已寫入…共 170 行」，
  // 而 Diagnostics 入面根本冇嗰份報告。**一條太嚴嘅不變式造出咗一個新 bug。**
  //
  // 收窄成真正嘅問題：**個變數名唔可以令人誤會成行數**。
  // `written`／`writtenCount`／`rowsWritten` 呢類名一律唔准；
  // `wroteOk`／`didWrite` 呢類明顯係 boolean 嘅名可以。
  // 行數一律由 `rows.length` 計。
  //
  // ⚠️ 要**剝走註解先掃**——解釋「唔可以寫成咩」嘅註解本身就含住嗰個寫法，
  // 而唯一嘅「修法」就係把註解寫得含糊。本專案已經撞過幾次。
  const stripComments = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  };
  const COUNTY_NAMES = /\b(written|writtenCount|rowsWritten|writtenRows|count)\s*=\s*tryWriteDiagnostics_\(/;
  const offenders = [];
  gsFiles.forEach(function (fileName) {
    const content = stripComments(fs.readFileSync(path.join(SRC, fileName), 'utf8'));
    if (COUNTY_NAMES.test(content)) offenders.push(fileName);
  });
  check('★★★ 全部 ' + gsFiles.length + ' 個 .gs 檔案都冇用一個「聽落似行數」'
    + '嘅名接住 tryWriteDiagnostics_() 嘅 boolean 回傳值',
    offenders.length === 0, '仍然有問題嘅檔案：' + offenders.join('、'));

  // 而接住咗嘅，個值只可以用喺條件判斷，唔可以直接串落文字。
  const badUse = [];
  gsFiles.forEach(function (fileName) {
    const content = fs.readFileSync(path.join(SRC, fileName), 'utf8');
    const m = content.match(/\b(\w+)\s*=\s*tryWriteDiagnostics_\(/);
    if (!m) return;
    const name = m[1];
    // `+ name + ' 行'` 呢類直接串落文字嘅寫法
    if (new RegExp('\\+\\s*' + name + '\\s*\\+\\s*[\'"]\\s*行').test(content)) {
      badUse.push(fileName + '（' + name + '）');
    }
  });
  check('★★★★★ 而且接住咗嘅 boolean 冇被直接串成「共 X 行」'
    + '——實測撞過「共 true 行」',
    badUse.length === 0, badUse.join('、'));
}

console.log('\n=== C1：已知嘅四個呼叫點都已經改用 rows.length（唔係得返一個 PublicRoster.gs）===');
{
  const expectedFixes = [
    { file: 'PublicRoster.gs', label: '公開連結狀態' },
    { file: 'DraftReviewReport.gs', label: '草稿覆核報告' },
    { file: 'EpsilonTrial.gs', label: 'epsilon 試算' },
    { file: 'SoftRuleMetrics.gs', label: '軟規則實測量度' }
  ];
  expectedFixes.forEach(function (item) {
    const content = fs.readFileSync(path.join(SRC, item.file), 'utf8');
    const reportIdx = content.indexOf("'" + item.label + "'");
    check('★★ ' + item.file + '（' + item.label + '）附近有 .length 計算行數',
      reportIdx !== -1 && /\.length;/.test(content.slice(Math.max(0, reportIdx - 200), reportIdx + 400)),
      '報告名稱字串位置：' + reportIdx);
  });
}

console.log('\n=== C1：tryWriteDiagnostics_() 本身嘅回傳型別冇變（確認係布林值，唔係我哋呢度理解錯咗）===');
{
  // 第三十輪批次階段 C2-2：`tryWriteDiagnostics_()` 而家係一個薄殼，
  // 真正嘅 try/catch 搬咗落 `tryWriteDiagnosticsDetailed_()`（佢會**帶埋
  // 失敗原因返出嚟**——舊寫法只寫入 Logger，而 Ivan 讀唔到 Logger）。
  // 要求不變：成功回 true、失敗回 false。
  const diagnosticsSource = fs.readFileSync(path.join(SRC, 'Diagnostics.gs'), 'utf8');
  const start = diagnosticsSource.indexOf('function tryWriteDiagnosticsDetailed_');
  const end = diagnosticsSource.indexOf('\n}', start);
  const body = diagnosticsSource.slice(start, end);
  check('★ 成功時 ok: true', /return \{ ok: true, error: '' \};/.test(body));
  check('★ 失敗時 ok: false（catch 區塊入面），而且帶埋 error',
    /return \{ ok: false, error: err\.message \};/.test(body));
  check('★★★★ 而 `tryWriteDiagnostics_()` 仍然係 boolean（其餘 20 幾個呼叫點冇改）',
    /function tryWriteDiagnostics_\(reportName, rows\) \{\s*\n\s*return tryWriteDiagnosticsDetailed_\(reportName, rows\)\.ok;/
      .test(diagnosticsSource));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
