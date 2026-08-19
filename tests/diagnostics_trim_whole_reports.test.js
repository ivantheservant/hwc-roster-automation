// 第三十三輪批次階段 C：Diagnostics 修剪唔可以留半截報告。
// 執行方式：node tests/diagnostics_trim_whole_reports.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 2026-08-20 實測揭出嘅事
// ═════════════════════════════════════════════════════════════════════
//
// 演練第 1 段嘅完成對話框話報告「共 255 行」，但 Diagnostics 工作表上
// 嗰份報告只剩 241 行。三段演練合共 316 行，加埋其他報告超過
// `DIAGNOSTICS_MAX_ROWS_TOTAL`（380），修剪機制把一份報告斬走咗一截。
//
// **半截報告比冇報告更差。** 讀嘅人唔知自己睇緊嘅係殘缺版，
// 而報告開頭通常就係最重要嗰段摘要。呢個係本專案 bug class 第 2 條
// 「缺失被當成正常值」嘅變體——一份被斬過嘅報告，睇落同完整報告一模一樣。
//
// ⚠️ 呢一輪**冇調高 380**。380 係 Google Drive connector 嘅可讀極限，
// 調高等於 Claude 讀唔到尾，而讀唔到尾就等於要 Ivan 逐張截圖
// ——嗰個正正係第三十輪特意解決咗嘅問題。正確方向係令報告更精簡。

const { loadGasSource } = require('./helpers/gas_loader');

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

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'Diagnostics.gs']);

/** 砌 n 行同一份報告嘅假資料（試算表列陣列，第 0 格係報告名）。 */
function rowsFor(reportName, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([reportName, '2026-08-20 09:00:00', '分區' + i, '項目' + i, i, '']);
  }
  return out;
}
/** 數某一份報告喺結果入面剩返幾多行。 */
function countRows(rows, reportName) {
  return rows.filter(function (r) { return String(r[0]) === reportName; }).length;
}

console.log('\n=== C1：夠位嗰陣乜都唔使丟 ===');
{
  const existing = rowsFor('報告A', 50).concat(rowsFor('報告B', 50));
  const fresh = rowsFor('報告C', 50);
  const r = gas.planDiagnosticsTrim_(existing, fresh, '報告C', 380);
  checkEqual('★★★★ 150 行喺 380 之內 ⇒ 一行都唔丟', r.rows.length, 150);
  checkEqual('★★★★ 冇任何報告被清走', r.droppedReportNames, []);
  checkEqual('★★★★ 三份都仲喺度', r.keptReportNames, ['報告A', '報告B', '報告C']);
  check('★★★★ currentReportAlone=false', r.currentReportAlone === false);
}

console.log('\n=== C1：超標嗰陣，由最舊嗰份開始「整份」丟 ===');
{
  // 三份各 150 行 = 450 行，上限 380 ⇒ 要丟。
  const existing = rowsFor('最舊', 150).concat(rowsFor('中間', 150));
  const fresh = rowsFor('今次', 150);
  const r = gas.planDiagnosticsTrim_(existing, fresh, '今次', 380);

  checkEqual('★★★★★ 「最舊」嗰份被整份清走（唔係斬一半）', countRows(r.rows, '最舊'), 0);
  checkEqual('★★★★★ 「中間」嗰份一行都冇少——**呢條就係修正嘅核心**：'
    + '丟到夠位就停，唔會為咗啱啱好貼住上限而斬多一份報告嘅一截',
    countRows(r.rows, '中間'), 150);
  checkEqual('★★★★★ 今次寫入嗰份完整保留', countRows(r.rows, '今次'), 150);
  checkEqual('★★★★ 清走名單講得出丟咗邊份', r.droppedReportNames, ['最舊']);
  check('★★★★ 結果 300 行，喺 380 之內', r.rows.length === 300, String(r.rows.length));
}

console.log('\n=== C1：任何情況下，留低嘅報告都必須係「原本幾多行就幾多行」 ===');
{
  // 刻意砌一個「丟一份唔夠、丟兩份先夠」嘅情況。
  const existing = rowsFor('舊1', 200).concat(rowsFor('舊2', 200)).concat(rowsFor('舊3', 100));
  const fresh = rowsFor('今次', 100);
  const r = gas.planDiagnosticsTrim_(existing, fresh, '今次', 380);

  const survivors = r.keptReportNames;
  const originalSize = { 舊1: 200, 舊2: 200, 舊3: 100, 今次: 100 };
  const halved = survivors.filter(function (name) {
    return countRows(r.rows, name) !== originalSize[name];
  });
  checkEqual('★★★★★ 冇任何一份留低嘅報告係「行數少過原本」（＝冇任何一份被斬半）',
    halved, []);
  check('★★★★ 總行數已經降到上限之內', r.rows.length <= 380, String(r.rows.length));
  check('★★★★ 今次寫入嗰份一定喺留低名單入面', survivors.indexOf('今次') !== -1);
}

console.log('\n=== C1：今次寫入嗰份永遠唔會被當成犧牲品（即使佢排最前）===');
{
  // 「今次」排喺最前（最舊寫入嘅位置），但佢係當前報告，唔可以丟。
  const existing = rowsFor('今次', 200).concat(rowsFor('別份', 300));
  const fresh = [];
  const r = gas.planDiagnosticsTrim_(existing, fresh, '今次', 380);
  checkEqual('★★★★★ 「今次」完整保留，被丟嘅係「別份」', countRows(r.rows, '今次'), 200);
  checkEqual('★★★★ 「別份」被整份清走', countRows(r.rows, '別份'), 0);
}

console.log('\n=== C2：單一報告自己就超過上限 ===');
{
  const existing = rowsFor('別份', 100);
  const fresh = rowsFor('巨無霸', 500);   // 自己就超過 380
  const r = gas.planDiagnosticsTrim_(existing, fresh, '巨無霸', 380);

  checkEqual('★★★★★ 其餘報告全部清走', countRows(r.rows, '別份'), 0);
  checkEqual('★★★★★ 但「巨無霸」自己**一行都冇被斬**（寧願超標，唔可以靜靜留半截）',
    countRows(r.rows, '巨無霸'), 500);
  check('★★★★★ currentReportAlone=true ⇒ 呼叫端會喺頂部插一行明講',
    r.currentReportAlone === true);
}

console.log('\n=== C2：上限算唔出嚟嗰陣唔可以清空成張表 ===');
{
  // `Number(null)` ＝ 0、`Number('')` ＝ 0 ⇒ 上限變 0 ⇒ 丟晒所有嘢。
  // 呢個正正就係本專案 bug class 第 2 條。
  [null, undefined, '', '  ', NaN, 'abc'].forEach(function (bad) {
    const r = gas.planDiagnosticsTrim_(rowsFor('A', 100), rowsFor('B', 100), 'B', bad);
    check('★★★★★ maxTotal=' + JSON.stringify(bad) + ' ⇒ 唔修剪（保留全部 200 行），'
      + '唔會靜靜當成上限 0 而清空成張表', r.rows.length === 200, String(r.rows.length));
  });
}

console.log('\n=== C3：修剪之後要留低痕跡 ===');
{
  const withDrop = gas.buildDiagnosticsTrimRow_(['甲', '乙'], ['丙', '丁'], 380);
  check('★★★★ 分區同「（表格狀態）」一致（跟第三十一輪嗰行同一個位置）',
    withDrop.section === gas.DIAGNOSTICS_STATUS_SECTION, withDrop.section);
  check('★★★★★ 講得出保留幾多份、清走幾多份',
    withDrop.value.indexOf('保留 2 份') !== -1 && withDrop.value.indexOf('清走 2 份') !== -1,
    withDrop.value);
  check('★★★★ 講得出清走咗邊幾份（唔係淨係報數字）',
    withDrop.note.indexOf('丙') !== -1 && withDrop.note.indexOf('丁') !== -1, withDrop.note);
  check('★★★★ 講得出總行數上限', withDrop.note.indexOf('380') !== -1, withDrop.note);

  // ⚠️ 冇清走都要寫——只喺有清走嗰陣先寫，等於要讀嘅人靠「有冇呢一行」推論，
  // 而佢根本唔知應唔應該有。
  const noDrop = gas.buildDiagnosticsTrimRow_(['甲'], [], 380);
  check('★★★★★ 冇清走任何嘢嗰陣**都要寫**，而且明講「本次沒有清走任何報告」',
    noDrop.note.indexOf('本次沒有清走任何報告') !== -1, noDrop.note);
  check('★★★★ 冇清走嗰陣數字係 0', noDrop.value.indexOf('清走 0 份') !== -1, noDrop.value);
}

console.log('\n=== C4：380 冇被調高（呢一輪明確唔准）===');
{
  checkEqual('★★★★★ DIAGNOSTICS_MAX_ROWS_TOTAL 仍然係 380'
    + '（connector 大約 400 行截斷，調高等於讀唔到尾）',
    gas.DIAGNOSTICS_MAX_ROWS_TOTAL, 380);
  check('★★★★ 而且仍然細過 connector 極限',
    gas.DIAGNOSTICS_MAX_ROWS_TOTAL < gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT,
    gas.DIAGNOSTICS_MAX_ROWS_TOTAL + ' vs ' + gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT);
  check('★★★★ 單一報告上限仍然細過整張表上限（否則 C2 嗰條路會變成常態）',
    gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT < gas.DIAGNOSTICS_MAX_ROWS_TOTAL);
}

console.log('\n=== 實測情境重演：三段演練 ＋ 其他報告 ===');
{
  // 實測數字：三段演練合共 316 行。加上其他報告一定超過 380。
  const existing = rowsFor('全季流程演練', 316)
    .concat(rowsFor('全面體檢', 60))
    .concat(rowsFor('Config 行數', 20));
  const fresh = rowsFor('寄送記錄摘要', 40);
  const r = gas.planDiagnosticsTrim_(existing, fresh, '寄送記錄摘要', 380);

  check('★★★★★ 演練報告要就完整 316 行、要就完全唔喺度——冇「241 行」呢種半截狀態',
    countRows(r.rows, '全季流程演練') === 316 || countRows(r.rows, '全季流程演練') === 0,
    '實際 ' + countRows(r.rows, '全季流程演練') + ' 行');
  check('★★★★ 總行數喺上限之內', r.rows.length <= 380, String(r.rows.length));
  check('★★★★ 今次寫入嗰份完整', countRows(r.rows, '寄送記錄摘要') === 40);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
