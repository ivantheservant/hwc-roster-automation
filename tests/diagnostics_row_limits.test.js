// 第三十一輪批次階段 C：Diagnostics 兩個上限都定錯咗一倍。
// 執行方式：node tests/diagnostics_row_limits.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解呢個係一個真問題
// ─────────────────────────────────────────────────────────────────────
//
// 呢張表存在嘅**唯一理由**，係要俾 Google Drive connector 一次過完整讀晒。
// 而 connector 大約 400 行就會截斷。
//
// 舊設定：`DIAGNOSTICS_MAX_ROWS_TOTAL = 800`。
// 即係呢張表可以合法地脹到 connector 讀唔完——**而佢完全唔會出聲**。
// 讀嗰個人見到嘅嘢會靜靜少咗一截，同「本來就係咁多」喺畫面上一模一樣。
//
// ⚠️ 一個「防止讀唔完」嘅上限，設到比讀得完嘅極限大一倍，等於冇設。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Diagnostics.gs']);
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Diagnostics.gs'), 'utf8');

console.log('\n=== C1【核心】上限要對住 connector 嘅極限，唔可以大過佢 ===');
{
  check('★★★★★ **整張表上限 < connector 極限**'
    + '——舊值 800 係極限嘅一倍，等於冇設過上限',
    gas.DIAGNOSTICS_MAX_ROWS_TOTAL < gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT,
    gas.DIAGNOSTICS_MAX_ROWS_TOTAL + ' vs ' + gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT);
  check('★★★★★ 而且留返餘裕俾標題行同自我警告行（唔可以貼到剛剛好 400）',
    gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT - gas.DIAGNOSTICS_MAX_ROWS_TOTAL >= 10,
    String(gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT - gas.DIAGNOSTICS_MAX_ROWS_TOTAL));
  check('★★★★★ connector 嘅極限有自己嘅常數，唔係埋喺註解入面'
    + '——嗰個係外部工具嘅限制，兩個上限都要對住佢嚟定',
    typeof gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT === 'number');
  check('★★★★ 單一報告上限 < 整張表上限（否則一份報告可以獨佔成張表）',
    gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT < gas.DIAGNOSTICS_MAX_ROWS_TOTAL);
}

console.log('\n=== C3【核心】單一報告上限唔可以斬走實測嗰份演練報告 ===');
{
  // 實測 186 行；階段 B1 加咗步驟 3.5 之後預計約 201 行。
  // 收到 200 就會斬走尾巴——而嗰條尾正正係「清理」同「PDF 逐個檔案」，
  // 即係演練完之後最需要睇嗰兩段。
  const MEASURED = 186;
  const PROJECTED = 201;
  check('★★★★★ 容得下實測嘅 186 行', gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT > MEASURED,
    String(gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT));
  check('★★★★★ **亦容得下加咗步驟 3.5 之後預計嘅 201 行**'
    + '——只按舊嗰個 186 嚟定就會啱啱好斬到',
    gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT > PROJECTED,
    String(gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT));
  check('★★★★ 而且仲有至少一成餘裕（人數／特殊主日增加都會令佢再長）',
    gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT >= Math.ceil(PROJECTED * 1.1),
    String(gas.DIAGNOSTICS_MAX_ROWS_PER_REPORT));
  check('★★★★★ 揀呢個數嘅根據寫咗喺常數旁邊，唔係一個冇來由嘅數字',
    src.indexOf('186 行') !== -1 && src.indexOf('201 行') !== -1);
}

console.log('\n=== C2【核心】表格要自己講得出有幾大 ===');
{
  const small = gas.buildDiagnosticsStatusRow_(120);
  check('★★★★★ 有一行「（表格狀態）」',
    small.section === gas.DIAGNOSTICS_STATUS_SECTION, JSON.stringify(small));
  check('★★★★★ 講得出而家幾多行', small.value === '120 行', small.value);
  check('★★★★★ 講得出 connector 大約幾多行截斷'
    + '——冇呢個數字，「120 行」本身完全唔知係多定少',
    small.note.indexOf('400') !== -1, small.note);
  check('★★★★ 而且講埋仲有幾多空間', small.note.indexOf('280') !== -1, small.note);

  const near = gas.buildDiagnosticsStatusRow_(craftNear());
  function craftNear() { return gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT - 20; }
  check('★★★★★ 貼近極限（剩 20 行）⇒ 出 ⚠️ 預警，唔係等到爆咗先講',
    near.note.indexOf('⚠️') !== -1 && near.note.indexOf('只剩 20 行') !== -1, near.note);

  const over = gas.buildDiagnosticsStatusRow_(gas.DIAGNOSTICS_CONNECTOR_ROW_LIMIT + 35);
  check('★★★★★ 已經爆咗 ⇒ 明講會被截斷',
    over.note.indexOf('已經超過') !== -1 && over.note.indexOf('35 行') !== -1, over.note);
  check('★★★★★ **而且明講「不會有任何提示」**'
    + '——呢一行嘅全部價值就係喺度：靜靜讀漏咗，同讀齊咗，'
    + '喺畫面上本來一模一樣',
    over.note.indexOf('不會有任何提示') !== -1, over.note);
  check('★★★★ 仲要講埋點算（先執行想看的那個工具，再讀）',
    over.note.indexOf('再讀這張表') !== -1, over.note);
}

console.log('\n=== C2【核心】自我警告行自己壞咗都唔可以靜靜過 ===');
{
  // 一行專門用嚟防止「靜靜讀漏咗」嘅嘢，佢自己出事更加唔可以靜。
  [undefined, null, NaN, '一百二十', -5].forEach(function (bad) {
    const row = gas.buildDiagnosticsStatusRow_(bad);
    check('★★★★★ `' + String(bad) + '` ⇒ 講「（算不出來）」，唔會印一個似模似樣嘅 0',
      row.value === '（算不出來）', JSON.stringify(row));
  });
  const row = gas.buildDiagnosticsStatusRow_('唔係數');
  check('★★★★ 而且講埋收到咗咩', row.note.indexOf('唔係數') !== -1, row.note);
}

console.log('\n=== C2 舊嘅「（表格狀態）」行要清走，唔可以一份報告留一行 ===');
{
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  const bare = stripComments(src);
  check('★★★★★ 寫入之前會濾走舊嘅狀態行'
    + '——唔濾嘅話，一張用嚟講「而家幾多行」嘅表會同時印住幾個唔同答案，'
    + '比冇答案更差',
    /row\[2\][\s\S]{0,20}!== DIAGNOSTICS_STATUS_SECTION/.test(bare),
    '（睇 writeDiagnosticsReport_）');
  check('★★★★★ 分區名寫成常數，寫入同清走兩邊用同一個值'
    + '——各自寫一次字面字串，改一邊就會靜靜清唔走',
    (bare.match(/DIAGNOSTICS_STATUS_SECTION/g) || []).length >= 4);
  // ⚠️ 第三十三輪批次階段 C3：呢個數由 +1 變咗 +2。
  // 唔係放寬斷言——係「自我狀態行」由一行變咗兩行（新增咗修剪痕跡嗰行），
  // 而呢個斷言嘅本意一直都係「傳落去嘅數要包括即將加上去嘅狀態行自己」。
  // 兩行都加、但數字仍然寫 +1 嘅話，呢張表就會少報自己一行——
  // 一個講「我有幾多行」嘅機制自己報錯數，正正就係佢要防嘅嘢。
  check('★★★★ 狀態行係最後先加，數目包括佢哋自己（修剪痕跡行 ＋ 行數狀態行 ＝ 2 行）',
    /buildDiagnosticsStatusRow_\(combined\.length \+ 2\)/.test(bare));
  check('★★★★★ 兩行狀態行係喺同一個 concat 一齊加落去'
    + '——分開兩次加好易改咗一邊漏咗另一邊，令上面個 +2 對唔上',
    /trimRow\.section[\s\S]{0,200}statusRow\.section/.test(bare));
  check('★★★★★ 修剪痕跡行由 buildDiagnosticsTrimRow_() 產生，而且收到真正嘅清走名單',
    /buildDiagnosticsTrimRow_\(\s*[\s\S]{0,120}trim\.droppedReportNames/.test(bare));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
