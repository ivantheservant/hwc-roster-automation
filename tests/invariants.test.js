// 第四十九輪批次 第 3 層：不變量。
// 執行方式：node tests/invariants.test.js
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份測試自己都受同一個問題影響
// ═════════════════════════════════════════════════════════════════════
//
// 不變量嘅價值喺**真環境**——佢問嘅係「而家張表同畫面對唔對得上」。
// 喺 Node 沙箱入面，張表係我砌嘅，所以呢一份**證明唔到**系統冇事。
//
// 佢守嘅係另一件事：**不變量本身唔可以壞**。具體係三條：
//
//   一、算唔出嘅時候要報 `ERROR`，**唔可以報 `ok: true`**
//       ——「查不到」當成「冇事」，就係呢個專案由第一輪殺到而家嗰種錯
//   二、一條爆咗，其餘要照跑
//   三、`I08` 嘅登記表，`verify` 一定要行**另一條路**
//       ——抄 `produce` 一份落嚟就係自己同自己比，永遠綠
//
// 真正嘅證據喺第 1 層（自測機）同第 4 層（亂行機）——嗰兩層喺真試算表上
// 叫呢一支。

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
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SendOptions.gs', 'Invariants.gs'
]);

// =====================================================================
console.log('\n=== 一【核心】算唔出 ⇒ 報 ERROR，唔可以報 ok ===');
{
  // ⚠️ 呢一條係整層嘅根。
  //
  // 一支「拋咗錯就當成通過」嘅檢查，比冇檢查更差：
  // 冇檢查嘅時候大家知道冇檢查；假通過嘅時候大家以為驗過。
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () { throw new Error('故意爆：讀不到試算表'); }
  };
  gas.readSheet = function () { throw new Error('故意爆：讀不到工作表'); };
  gas.getConfig = function () { throw new Error('故意爆：讀不到 Config'); };
  gas.readQuarterResetBlockedQuarters_ = function () { throw new Error('故意爆'); };
  gas.findLatestVersionNo = function () { throw new Error('故意爆'); };
  gas.buildDashboardState_ = function () { throw new Error('故意爆'); };

  const report = gas.runAllInvariants_('2028T3');

  checkEqual('★★★★★★ 全部都算唔出 ⇒ **一條 OK 都冇**'
    + '——一條都唔可以扮成通過',
    report.okCount, 0);
  check('★★★★★★ 而且全部標成 `ERROR`（唔係靜靜略過）'
    + '——略過咗就會喺報告上面消失，而消失同通過睇落一模一樣',
    report.errorCount > 0, JSON.stringify(report));
  // ⚠️ 斷言係「**每一條都帶住一句實際嘅錯誤原文**」，
  // 唔係「每一條都提到『故意爆』」——呢個沙箱冇載入
  // `FiveStageCore.gs`／`SendRecipients.gs`，所以 I08 嗰兩條會回
  // 「planStep2_ is not defined」。嗰個一樣係一句有用嘅原文。
  //
  // 寫成「一定要提到『故意爆』」嘅話，我就係喺要求佢報一個
  // **我預先知道嘅答案**——而唔係要求佢誠實講返佢撞到咩。
  const errors = report.results.filter(function (r) { return r.status === 'ERROR'; });
  check('★★★★★★ 每一條 `ERROR` 都帶住實際嘅錯誤原文'
    + '——只講「失敗」而唔講實際值，等於逼下一個人由零查起',
    errors.length > 0 && errors.every(function (r) {
      return String(r.evidence || '').trim().length > 0;
    }),
    JSON.stringify(errors.map(function (r) { return r.id + '｜' + r.evidence; })));
  check('★★★★★ 而且真係傳得返我特登掟出嚟嗰句',
    errors.some(function (r) { return /故意爆/.test(r.evidence); }),
    JSON.stringify(errors.map(function (r) { return r.evidence; })));

  // ⚠️ 二：一條爆咗，其餘照跑。
  check('★★★★★★ 一條爆咗，其餘照跑（結果條數 ≥ 5）'
    + '——一條爆就成批停低嘅話，一個細問題會掩蓋晒後面全部',
    report.results.length >= 5, report.results.length);
}

// =====================================================================
console.log('\n=== 二【核心】`I08` 登記表：`verify` 要行另一條路 ===');
{
  const src = read('src/Invariants.gs');
  const registry = src.slice(src.indexOf('function buildDialogNumberRegistry_('),
    src.indexOf('/* ═════════════════════════════════════════════════════════════════════\n * 逐條不變量'));

  const entries = registry.match(/id: '[^']+'/g) || [];
  check('★★★★★ 登記表入面至少有三個數字',
    entries.length >= 3, JSON.stringify(entries));

  // ⚠️ `produce` 同 `verify` 唔可以叫同一支函式——嗰個係同義反覆。
  const blocks = registry.split(/\n    \{\n/).slice(1);
  const sameFn = [];
  blocks.forEach(function (b) {
    const p = (b.match(/produce: function[\s\S]*?\n      \}/) || [''])[0];
    const v = (b.match(/verify: function[\s\S]*?\n      \}/) || [''])[0];
    const calls = function (text) {
      return (text.match(/\b[a-zA-Z][A-Za-z0-9_]*_?\(/g) || [])
        .filter(function (c) { return !/^(function|String|Number|if)\(/.test(c); });
    };
    const pc = calls(p).join(',');
    const vc = calls(v).join(',');
    if (p && v && pc === vc) sameFn.push(b.slice(0, 60));
  });
  checkEqual('★★★★★★ 冇一個登記項嘅 `produce` 同 `verify` 叫同一串函式'
    + '——抄一份落嚟就係自己同自己比，永遠綠，'
    + '而嗰個正正就係第四十六輪「3 位 vs 9 封」冇被捉到嘅原因',
    sameFn.length, 0);

  check('★★★★★★ 兩份 `sendOptions` 都要跑（`null` ＋ `PICK`）'
    + '——只用 `null` 跑嘅話，兩個算法啱啱好重合，'
    + '而第四十七輪 `e2e_five_stage_flow.test.js` 就係噉樣由頭綠到尾',
    /options: null/.test(src) && /SEND_RECIPIENT_SCOPE\.PICK/.test(src), '');
}

// =====================================================================
console.log('\n=== 三 不變量本身唔准改任何嘢 ===');
{
  const src = read('src/Invariants.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ⚠️ 一支會改嘢嘅檢查，行完之後嘅狀態就唔再係佢驗嗰個狀態。
  const writers = ['setValue(', 'setValues(', 'appendRow(', 'deleteRow(',
    'writeAuditLog_(', 'insertSheet(', 'setConfigValue_('];
  const found = writers.filter(function (w) { return src.indexOf(w) !== -1; });
  checkEqual('★★★★★★ 由頭到尾冇一句寫入'
    + '——連 AuditLog 都唔寫：一支唯讀檢查寫嘢落去，'
    + '就會令佢自己成為佢要驗嗰個狀態嘅一部分',
    JSON.stringify(found), '[]');
}

// =====================================================================
console.log('\n=== 四 接線：全面體檢真係叫咗佢 ===');
{
  const health = read('src/FullHealthCheck.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ 「維護 ▸ 🩺 全面體檢」真係叫 `runAllInvariants_()`'
    + '——寫咗一層而冇入口，等於冇寫過',
    /classifyInvariantsHealth_\(runAllInvariants_\(quarterId\)\)/.test(health), '');
  check('★★★★★★ 一條紅咗 ⇒ 分級係 `MUST`'
    + '——「畫面同表對唔上」唔可以報成「建議處理」',
    /broken > 0 \? HEALTH_SEVERITY\.MUST/.test(read('src/Invariants.gs')), '');
  check('★★★★★★ 算唔出**都係** `MUST`'
    + '——「我哋唔知對唔對得上」同「對唔上」一樣咁重要',
    /const broken = report\.failedCount \+ report\.errorCount;/
      .test(read('src/Invariants.gs')), '');
}

// =====================================================================
console.log('\n=== 五 冇季度嗰陣要**明講**跳過咗邊幾條 ===');
{
  // ⚠️ 靜靜少驗四條，而個報告睇落一樣係「全部通過」——
  // 呢個就係第四十七輪 C 組「未確認的特殊主日永遠係 0」嗰種形狀。
  gas.readSheet = function () { return []; };
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } };
  gas.getConfig = function (k, d) { return d; };
  gas.readQuarterResetBlockedQuarters_ = function () { return ['2026T4']; };

  const report = gas.runAllInvariants_('');
  const skipped = report.results.filter(function (r) { return r.status === 'SKIPPED'; });
  check('★★★★★★ 冇傳季度 ⇒ 有一條明講「呢四條要對住一季先驗得到」',
    skipped.some(function (r) { return /I02／I08／I09／I10/.test(r.id); }),
    JSON.stringify(report.results.map(function (r) { return r.id + ':' + r.status; })));
  checkEqual('★★★★★ 而且嗰一條唔算 OK',
    report.results.filter(function (r) { return /I02／I08/.test(r.id) && r.ok; }).length, 0);
}

// =====================================================================
console.log('\n=== 六 報告要拿得出證據 ===');
{
  const lines = gas.describeInvariantReport_({
    results: [
      { id: 'I08.step2', label: '會寄給這 N 位', status: 'FAILED', ok: false,
        expected: '9', actual: '3', evidence: '畫面那一支回 3；另一條路數出 9' }
    ],
    okCount: 0, failedCount: 1, errorCount: 0, skippedCount: 0
  }).join('\n');
  check('★★★★★★ 紅色嗰條要印**預期／實際／證據**三樣'
    + '——第四十六輪嗰個 bug 講出嚟就係「preview 3，實際 9」，'
    + '冇呢三行就淨係得一句「失敗」',
    /預期：9/.test(lines) && /實際：3/.test(lines)
      && /證據：畫面那一支回 3/.test(lines), lines);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
