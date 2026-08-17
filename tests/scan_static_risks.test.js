// 第十九輪批次階段 I：靜態風險掃描 script 本身嘅測試。
// 執行方式：node tests/scan_static_risks.test.js
//
// ⚠️ **點解一定要有正向測試**
//
// 第十八輪寫敏感資料掃描嗰陣，中文姓名偵測兩個版本都係零偵測，
// 而測試表面上仍然「冇誤報」，睇落好似正常運作——係自己寫嘅
// **正向**測試（「陳大明要捉到」）先揭穿。
//
// 呢個 script 而家掃全專案係 **0 項**。0 項可以係「真係冇問題」，
// 亦可以係「規則寫壞咗，乜都捉唔到」。淨係睇個 0 分唔出。
// 所以下面每一條規則都要有一個**特登造嘅壞樣本**，證明佢真係捉得到。

const path = require('path');
const scanner = require(path.join(__dirname, '..', 'tools', 'scan-static-risks.js'));

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

/** 每個情境獨立收集 findings。 */
function collect(fn) {
  const before = scanner._findings.length;
  fn();
  return scanner._findings.slice(before);
}

// =====================================================================
// 規則 1：樣板逃逸（有專用嘅純函式，可以直接餵一行）
// =====================================================================
console.log('\n=== I1【核心】規則 1：<script> 裡面用會轉義嘅標籤 ⇒ 要捉到 ===');
{
  const fakeFile = { name: '假樣板.html' };

  // 呢個就係第十九輪喺 PreacherFillSidebar.html 撳到嘅真實寫法
  const bad = collect(function () {
    scanner.checkTemplateLine(fakeFile, '  var Q = <?= JSON.stringify(quarterId) ?>;', 51, true);
  });
  checkEqual('★★★★★ script 區塊入面用會轉義嘅標籤 ⇒ 捉到 1 項'
    + '（實測就係噉：引號變成 &quot;，成個 script 唔會執行、側邊欄直接死）',
    bad.length, 1);
  check('★★★★ 訊息講得出後果（JS 語法錯誤、唔會執行）',
    bad[0] && bad[0].note.indexOf('語法錯誤') !== -1, bad[0] && bad[0].note);
  check('★★★★ 訊息講得出應該點改', bad[0] && bad[0].note.indexOf('<?!=') !== -1);

  // 反向一：同一行改成不轉義標籤 ⇒ 唔應該報
  const good = collect(function () {
    scanner.checkTemplateLine(fakeFile, '  var Q = <?!= JSON.stringify(quarterId) ?>;', 51, true);
  });
  checkEqual('★★★★★ 反向：改成不轉義標籤之後唔會再報'
    + '（證明規則分得清兩個標籤，唔係見到 `<?` 就報）', good.length, 0);

  // 反向二：HTML 內文用會轉義嘅標籤係啱嘅
  const bodyEscaped = collect(function () {
    scanner.checkTemplateLine(fakeFile, '  <h1><?= data.quarterId ?> 職事表</h1>', 128, false);
  });
  checkEqual('★★★★★ 反向：HTML 內文用會轉義嘅標籤係正確做法，唔報',
    bodyEscaped.length, 0);
}

console.log('\n=== I1：規則 1 反方向——內文用不轉義標籤 = XSS 風險 ===');
{
  const fakeFile = { name: '假樣板.html' };
  const xss = collect(function () {
    scanner.checkTemplateLine(fakeFile, '  <p><?!= data.personName ?></p>', 10, false);
  });
  checkEqual('★★★★★ 內文用不轉義標籤 ⇒ 捉到（XSS 風險）', xss.length, 1);
  check('★★★★ 訊息講得出係 XSS', xss[0] && xss[0].note.indexOf('XSS') !== -1);

  // 專案既有嘅合法寫法唔應該報
  const includeCall = collect(function () {
    scanner.checkTemplateLine(fakeFile, "  <?!= includeHtml('ui/Style') ?>", 5, false);
  });
  checkEqual('★★★★★ 反向：`includeHtml()` 內嵌子樣板係標準寫法，唔報'
    + '（唔豁免嘅話每個 Web UI 頁面都報一次，噪音會蓋過真問題）',
    includeCall.length, 0);

  const classAttr = collect(function () {
    scanner.checkTemplateLine(fakeFile,
      "  <td<?!= cell.mine ? ' class=\"mine\"' : '' ?>>", 169, false);
  });
  checkEqual('★★★★ 反向：拼 class 屬性嘅慣用寫法唔報', classAttr.length, 0);
}

// =====================================================================
// 規則 2–5：用真實專案原始碼做反向驗證
// =====================================================================
console.log('\n=== I：跑全專案應該係乾淨嘅（本輪已經逐項修好／調準）===');
{
  const before = scanner._findings.length;
  scanner.scanFirstRunAsymmetry();
  scanner.scanUncheckedColumnAccess();
  scanner.scanHandBuiltContext();
  scanner.scanDualSourceAmbiguity();
  const real = scanner._findings.slice(before);

  checkEqual('★★★★★ 規則 2–5 掃真實 src/ 係 0 項'
    + '（第十八輪嘅 bug class 已根治、第十九輪嘅雙來源已改用 resolver、'
    + '建表分工已豁免）',
    real.map(function (f) { return f.kind + ' ' + f.file + ':' + f.line; }), []);
}

console.log('\n=== I：規則 4／5 嘅正向驗證（唔可以淨係「掃出 0 項」就收貨）===');
{
  // 規則 5 用嘅係檔案內容判斷，最直接嘅正向驗證係確認
  // 「resolver 有被真正使用」——如果全專案冇人用，規則 5 就係空殼。
  const fs = require('fs');
  const srcDir = path.join(__dirname, '..', 'src');
  let resolverCallSites = 0;
  fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); }).forEach(function (f) {
    if (f === 'StateSource.gs') return;
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    resolverCallSites += (text.match(/resolveAuthoritativeState_\(/g) || []).length;
  });
  check('★★★★★ `resolveAuthoritativeState_()` 真係有呼叫點'
    + '——0 項唔可以係因為「根本冇人用兩個來源」，'
    + '要係因為「用嘅人都明確表咗態」',
    resolverCallSites >= 2, '只搵到 ' + resolverCallSites + ' 個呼叫點');

  // 規則 4 同理：guard 要真係有被套用
  let guardSites = 0;
  fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); }).forEach(function (f) {
    if (f === 'Roles.gs') return;
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    guardSites += (text.match(/requireRoleContextField_\(/g) || []).length;
  });
  check('★★★★★ 第十八輪嘅 `requireRoleContextField_()` 仍然有被套用'
    + '（如果有人拆咗返，規則 4 就會變成永遠通過嘅空殼）',
    guardSites >= 4, '只搵到 ' + guardSites + ' 個套用點');
}

console.log('\n=== 規則 6【核心】由渲染輸出反推資料（第二十輪嗰個 bug）===');
{
  // 舊寫法：讀 grid 文字 ⇒ 直接查表反推人名。合堂顯示「特殊主日」，
  // 於是被當成「認唔出嘅人手改動」，令整個功能喺有合堂嘅季度用唔到。
  const badBody = [
    'function detect_(context) {',
    '  const gridText = context.gridValues[key];',
    '  const id = resolvePersonId(gridText);',
    '}'
  ].join('\n');
  check('★★★★★ 讀 grid 文字之後直接 resolvePersonId ⇒ 要捉到'
    + '（呢個就係令「把人手改動寫成新版本」喺有合堂嘅季度完全用唔到嗰個寫法）',
    scanner.shouldFlagReversal('  const id = resolvePersonId(gridText);', badBody));

  // 修正之後：行渲染器比對
  const goodBody = [
    'function detect_(context) {',
    '  const gridText = context.gridValues[key];',
    '  const expected = renderExpectedGridText_(a, a.postId, a.serviceDate, context.gridRender);',
    '  const id = resolvePersonId(gridText);',
    '}'
  ].join('\n');
  check('★★★★★ 反向：已經行渲染器比對就唔報'
    + '（否則修好咗都會一直嘈，冇人會再睇）',
    !scanner.shouldFlagReversal('  const id = resolvePersonId(gridText);', goodBody));

  // 表單輸入唔應該報——呢個係實測撞到嘅誤報
  const formBody = [
    'function saveFill_(quarterId, postId, name) {',
    '  const trimmedName = String(name).trim();',
    '  const sheetName = buildRosterSheetName_(quarterId, versionNo);',
    '  const personId = resolvePersonId(trimmedName) || \'\';',
    '}'
  ].join('\n');
  check('★★★★★ 反向：表單輸入（側邊欄打字）唔報'
    + '——反推本來就係佢嘅工作。第一版用「有冇掂過 grid」做訊號，'
    + '就係喺呢度誤報咗（嗰個函式只係之後會**寫入** grid）',
    !scanner.shouldFlagReversal(
      '  const personId = resolvePersonId(trimmedName) || \'\';', formBody));

  check('★★★★ 變數名講明係格內容嘅話，即使冇 gridValues 都報',
    scanner.shouldFlagReversal(
      '  const id = resolvePersonId(cellText);', 'function f_() {\n  const id = resolvePersonId(cellText);\n}'));
}

console.log('\n=== I2：報告要寫得成檔案（唔可以淨係印喺 console）===');
{
  const md = scanner.buildReportMarkdown({
    '樣板逃逸': [{
      kind: '樣板逃逸', file: 'src/ui/假.html', line: 51,
      text: 'var Q = <?= x ?>;', note: '示範說明'
    }]
  }, 1);
  check('★★★★ 產生得到 Markdown', md.indexOf('# 靜態風險掃描結果') !== -1);
  check('★★★★ 有講明「只警告、不擋 commit」'
    + '（靜態分析一定有誤判，擋 commit 會令人養成無視嘅習慣）',
    md.indexOf('只警告、不擋 commit') !== -1);
  check('★★★★ 有講明「不要手改這個檔案」（下次執行會覆寫）',
    md.indexOf('不要手改') !== -1);
  check('★★★ 逐項有檔案同行號', md.indexOf('src/ui/假.html:51') !== -1);

  const empty = scanner.buildReportMarkdown({}, 0);
  check('★★★ 零項時唔會產生空白報告', empty.indexOf('沒有任何項目') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
