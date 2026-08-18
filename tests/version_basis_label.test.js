// 第二十五輪批次階段 B1：`RosterVersions.Basis` 唔可以原封不動漏落畫面。
// 執行方式：node tests/version_basis_label.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// Ivan 打開幹事介面，狀態卡第二行寫住：
//     目前第 1 版　2026-08-17　REQUESTS_APPLIED
// `REQUESTS_APPLIED` 係內部代號，違反規格 1.3（畫面唔可以出現內部代號）。
//
// 而且仲有更差嘅一種：v0 嘅 `Notes` 存住
//     seed=20260813　第 3 / 20 次　總偏差 0.6033　主席兼報告 46.2%
// 而舊嘅 `buildVersionBasisText_()` 會把 Basis 同 Notes 駁埋，
// 所以揀住 v0 嗰陣，狀態卡會變成一大段技術統計數字。
//
// 呢個測試鎖住三件事：
//   1. 已知嘅 Basis 值一律譯成人話
//   2. **未知嘅值唔可以照印**——照印就係呢個 bug 本身
//   3. Notes 唔會入狀態卡

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppPreQuarter.gs', 'WebAppDashboard.gs'
]);

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

console.log('\n=== B1【核心】全部 registerVersion() 用過嘅 Basis 值都要譯到 ===');
{
  // ⚠️ 呢個清單**唔係人手抄**，係由 Constants.gs 嘅 VERSION_VALUES 攞——
  // 將來有人加多個 BASIS_XXX 而唔加對照，呢條測試會即刻失敗。
  const basisValues = Object.keys(gas.VERSION_VALUES)
    .filter(function (k) { return k.indexOf('BASIS_') === 0; })
    .map(function (k) { return gas.VERSION_VALUES[k]; });

  check('★★★ 至少搵到四個 Basis 值（防止清單抽空令測試變成空跑）',
    basisValues.length >= 4, '只搵到 ' + basisValues.length + ' 個');

  const untranslated = basisValues.filter(function (v) {
    const out = gas.buildVersionBasisText_(v);
    // 譯唔到會回「（沒有說明）」；照印會回原值本身。兩者都算失敗。
    return out === v || out === '（沒有說明）';
  });
  checkEqual('★★★★★ 每一個 Basis 值都有人話對照'
    + '——新加一個 BASIS_XXX 而唔加對照，幹事就會喺狀態卡見到內部代號',
    untranslated, []);

  checkEqual('★★★★★ REQUESTS_APPLIED（實測撞到嗰個）',
    gas.buildVersionBasisText_('REQUESTS_APPLIED'), '套用修改申報後');
  checkEqual('★★★★ AUTO_GENERATE', gas.buildVersionBasisText_('AUTO_GENERATE'), '系統生成');
  checkEqual('★★★★ FINE_TUNE', gas.buildVersionBasisText_('FINE_TUNE'), '人手調整後');
  checkEqual('★★★★ RESEND', gas.buildVersionBasisText_('RESEND'), '改動後重發時建立');
}

console.log('\n=== B1【核心】未知值唔可以照印 ===');
{
  checkEqual('★★★★★ 對照表冇嘅全大楷代號 ⇒「（沒有說明）」，**唔可以照印**'
    + '——照印就係「內部代號漏落畫面」呢個 bug 本身',
    gas.buildVersionBasisText_('SOME_FUTURE_INTERNAL_CODE'), '（沒有說明）');
  checkEqual('★★★★★ 空白 ⇒「（沒有說明）」，唔可以留空令畫面得個版本號',
    gas.buildVersionBasisText_(''), '（沒有說明）');
  checkEqual('★★★★ null 亦然（工作表空格讀出嚟可能係 null）',
    gas.buildVersionBasisText_(null), '（沒有說明）');

  // 例外：回退版本嘅 Basis 本身已經係中文人話（WebAppRollback.gs 寫嘅）。
  checkEqual('★★★★★ 本身已經係中文嘅唔好蓋走'
    + '（WebAppRollback.gs 寫入嘅係「回到第 N 版」，唔係代號）',
    gas.buildVersionBasisText_('回到第 2 版'), '回到第 2 版');
}

console.log('\n=== B1【核心】Notes 唔可以入狀態卡 ===');
{
  // v0 Notes 嘅真實形狀（buildSeedNote_() 寫入嗰種）。
  const v0Notes = 'seed=20260813　第 3 / 20 次　總偏差 0.6033　主席兼報告 46.2%';

  const out = gas.buildVersionBasisText_('AUTO_GENERATE', v0Notes);
  checkEqual('★★★★★ 就算硬塞第二個參數，Notes 都唔會入狀態卡'
    + '——技術統計數字對幹事完全冇意義，要睇就去區四「核對職事表」',
    out, '系統生成');
  check('★★★★★ 結果入面唔會出現 seed／偏差／百分比呢啲字',
    out.indexOf('seed') === -1 && out.indexOf('偏差') === -1 && out.indexOf('%') === -1);

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function buildVersionBasisText_'));
  check('★★★★★ 函式簽名只收一個參數（結構上就攞唔到 Notes）',
    /function buildVersionBasisText_\(basis\)/.test(fn.slice(0, 60)));
}

console.log('\n=== B1 全部呼叫端都要跟住改（唔可以剩返一個舊呼叫）===');
{
  ['WebAppDashboard.gs', 'WebAppRollback.gs'].forEach(function (f) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    check('★★★★★ ' + f + ' 冇再傳 Notes 落去'
      + '——剩低一個舊呼叫，嗰個畫面就會繼續顯示技術數字',
      src.indexOf('buildVersionBasisText_(row[V.BASIS], row[V.NOTES])') === -1);
  });
}

console.log('\n=== B4 順帶：狀態卡同掣嘅文案唔可以再出現內部代號 ===');
{
  const S = gas.QUARTER_STAGE;
  const samples = [
    gas.buildDashboardStatusText_(S.DRAFT, false, '11月27日'),
    gas.buildDashboardStatusText_(S.DRAFT, true, ''),
    gas.buildDashboardStatusText_(S.REVIEW_SENT, true, ''),
    gas.buildDashboardStatusText_(S.REQUESTS_APPLIED, true, ''),
    gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, '')
  ];
  check('★★★★★ 冇一句出現 Stage 代號',
    samples.every(function (s) {
      return ['DRAFT', 'REVIEW_SENT', 'REQUESTS_APPLIED', 'OFFICIAL_SENT', 'Stage']
        .every(function (code) { return s.indexOf(code) === -1; });
    }), JSON.stringify(samples, null, 1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
