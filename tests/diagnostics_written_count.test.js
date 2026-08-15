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
  // 又被當數字/字串用（例如 `+ written + ' 行'`）。呢度直接鎖住「捕捉咗
  // 呢個函式嘅回傳值」呢一步本身就唔應該出現——正確做法一律唔捕捉，
  // 行數另外由呼叫端已經有嘅 rows 陣列 `.length` 計。
  const BUGGY_PATTERN = /\b\w+\s*=\s*tryWriteDiagnostics_\(/;
  const offenders = [];
  gsFiles.forEach(function (fileName) {
    const content = fs.readFileSync(path.join(SRC, fileName), 'utf8');
    if (BUGGY_PATTERN.test(content)) offenders.push(fileName);
  });
  check('★★★ 全部 ' + gsFiles.length + ' 個 .gs 檔案都冇再捕捉 tryWriteDiagnostics_() 嘅回傳值',
    offenders.length === 0, '仍然有問題嘅檔案：' + offenders.join('、'));
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
  const diagnosticsSource = fs.readFileSync(path.join(SRC, 'Diagnostics.gs'), 'utf8');
  const start = diagnosticsSource.indexOf('function tryWriteDiagnostics_');
  const end = diagnosticsSource.indexOf('\n}', start);
  const body = diagnosticsSource.slice(start, end);
  check('★ tryWriteDiagnostics_() 成功時 return true', /return true;/.test(body));
  check('★ tryWriteDiagnostics_() 失敗時 return false（catch 區塊入面）', /return false;/.test(body));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
