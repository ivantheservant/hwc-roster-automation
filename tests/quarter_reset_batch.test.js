// 第四十七輪批次 E 組：沙盒季度批次清理。
// 執行方式：node tests/quarter_reset_batch.test.js
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 呢一份**一格真實資料都唔會清**
// ═════════════════════════════════════════════════════════════════════
//
// 呢一組只做工具、只寫測試。全部斷言都行喺純函式同原始碼上面，
// 一個 `SpreadsheetApp` 都冇碰。真正要清邊幾季，由 Ivan 自己撳。
//
// ─────────────────────────────────────────────────────────────────────
// 現況
// ─────────────────────────────────────────────────────────────────────
//
// 「維護 ▸ ⚠️⚠️ 重設季度測試資料」一次只食一個 QuarterID。
// 沙盒有幾季要清嘅時候，就要由頭做一次：
// 打 QuarterID ⇒ 揀 v0 ⇒ 睇清單 ⇒ 打「確認重設」，一季四步。
//
// 做四次唔止係煩：**中間任何一次撳錯／睇漏，都冇一個總覽睇得返**。
// 而每一次都要重新讀一次「呢一季會清乜」，前後對唔對得上，
// 全靠幹事自己記住。
//
// ─────────────────────────────────────────────────────────────────────
// 呢一份守嘅係
// ─────────────────────────────────────────────────────────────────────
//
//   E1　輸入接受逗號分隔嘅季度清單
//   E2　一個合併確認畫面：逐季細項 ＋ 總數
//   E3　逐季 try/catch；一季爆咗，其餘照做，而且講得出邊一季爆
//   E4　`QUARTER_RESET_BLOCKED_QUARTERS`：預設 `2026T4`，
//       空白**唔會**變成「乜都唔擋」
//   E5　清完之後，`Quarters` 嘅日期同 `ServiceDates` 一格都唔可以少

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
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'QuarterReset.gs'
]);

// =====================================================================
console.log('\n=== E1【核心】輸入接受逗號分隔嘅季度清單 ===');
{
  const p = gas.parseQuarterResetBatchInput_;

  checkEqual('★★★★★ 一個季度照樣行得', p('2027T1').quarterIds, ['2027T1']);
  checkEqual('★★★★★★ 三個季度，逗號分隔',
    p('2027T1,2027T2,2027T3').quarterIds, ['2027T1', '2027T2', '2027T3']);
  checkEqual('★★★★★ 前後同中間嘅空白唔理',
    p('  2027T1 , 2027T2  ').quarterIds, ['2027T1', '2027T2']);
  checkEqual('★★★★★ 全形逗號都食得'
    + '——幹事用中文輸入法打，好自然就會打到全形',
    p('2027T1，2027T2').quarterIds, ['2027T1', '2027T2']);
  checkEqual('★★★★★ 大細楷正規化成 `2027T1`', p('2027t1').quarterIds, ['2027T1']);

  // ⚠️ 重複要**報出嚟**，唔可以靜靜去重。
  const dup = p('2027T1,2027T1,2027T2');
  checkEqual('★★★★★★ 重複嘅只做一次', dup.quarterIds, ['2027T1', '2027T2']);
  checkEqual('★★★★★★ 而且**講返**邊一個重複咗'
    + '——靜靜去重嘅話，幹事以為佢揀咗三季，而畫面顯示兩季，'
    + '佢會以為系統食咗一季',
    dup.duplicates, ['2027T1']);

  checkEqual('★★★★★ 空白輸入 ⇒ 一季都冇', p('   ').quarterIds, []);
  checkEqual('★★★★★ 連續逗號唔會變成一個空季度 ID',
    p('2027T1,,2027T2').quarterIds, ['2027T1', '2027T2']);
}

// =====================================================================
console.log('\n=== E4【核心】受保護季度：預設 2026T4，空白唔會變成「乜都唔擋」 ===');
{
  check('★★★★★★ 有一個**獨立**嘅 Config 鍵 `QUARTER_RESET_BLOCKED_QUARTERS`',
    gas.CONFIG_KEYS.QUARTER_RESET_BLOCKED_QUARTERS === 'QUARTER_RESET_BLOCKED_QUARTERS',
    String(gas.CONFIG_KEYS.QUARTER_RESET_BLOCKED_QUARTERS));

  checkEqual('★★★★★★ 內建預設係 `2026T4`'
    + '——嗰一季係正式上線嗰一季，一格都唔准清',
    gas.QUARTER_RESET_BLOCKED_DEFAULT, '2026T4');

  const src = read('src/QuarterReset.gs');
  check('★★★★★★ Config 填成空白 ⇒ **仍然退回內建預設**'
    + '——一格打空咗就冧晒保護，係最易誤觸嗰種。'
    + '想解除某一季嘅保護，只能把它由嗰一格移走',
    /raw === ''/.test(src), '');

  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ `ConfigSeed.gs` 有落種，而且係 LIST 型',
    /QUARTER_RESET_BLOCKED_QUARTERS[\s\S]{0,120}CONFIG_TYPES\.LIST/.test(seed), '');
  check('★★★★★ 說明文字講明「填空白唔等於冇保護」',
    /QUARTER_RESET_BLOCKED_QUARTERS[\s\S]{0,1400}並不會變成「什麼都不保護」/.test(seed), '');

  // ── 真係行一次分流 ─────────────────────────────────────────────
  const split = gas.splitQuarterResetTargets_(
    ['2027T1', '2026T4', '2027T2'], ['2026T4']);
  checkEqual('★★★★★★ 受保護嗰季**唔會**入清理名單',
    split.allowed, ['2027T1', '2027T2']);
  checkEqual('★★★★★★ 而且要**明講**佢被擋咗'
    + '——靜靜略過嘅話，幹事以為清咗三季，而實際兩季',
    split.blocked, ['2026T4']);
  checkEqual('★★★★★ 大細楷唔理',
    gas.splitQuarterResetTargets_(['2026t4'], ['2026T4']).blocked, ['2026T4']);
  checkEqual('★★★★★★ **全部都受保護 ⇒ allowed 係空**，唔會退回「照清全部」',
    gas.splitQuarterResetTargets_(['2026T4'], ['2026T4']).allowed, []);
}

// =====================================================================
console.log('\n=== E2【核心】合併確認畫面：逐季細項 ＋ 總數 ===');
{
  const mkPlan = function (quarterId, versions, rows) {
    return {
      quarterId: quarterId,
      quarterStage: 'SENT',
      includeV0: true,
      versions: versions,
      assignmentRows: rows,
      sendLogRows: rows,
      requestRows: 0,
      unavailableRequestRows: 0,
      fineTuneProposalRows: 0,
      fineTuneProposalArchiveRows: 0,
      pdfFiles: [],
      manualAttention: []
    };
  };

  const summary = gas.summariseQuarterResetBatch_([
    { quarterId: '2027T1', plan: mkPlan('2027T1', [{ versionNo: 0 }, { versionNo: 1 }], 26) },
    { quarterId: '2027T2', plan: mkPlan('2027T2', [{ versionNo: 0 }], 13) }
  ]);

  checkEqual('★★★★★★ 總數：兩季加埋 3 個版本', summary.totals.versions, 3);
  checkEqual('★★★★★★ 總數：RosterAssignments 39 行', summary.totals.assignmentRows, 39);
  checkEqual('★★★★★ 總數：SendLog 39 行', summary.totals.sendLogRows, 39);
  checkEqual('★★★★★ 有幾多季', summary.totals.quarters, 2);

  check('★★★★★★ 逐季細項仲喺度'
    + '——淨係一個總數嘅話，幹事睇唔出邊一季會清走乜，'
    + '而佢要判斷嘅正正就係「呢一季係咪真係可以清」',
    summary.perQuarter.length === 2
      && summary.perQuarter[0].quarterId === '2027T1'
      && summary.perQuarter[0].versions === 2,
    JSON.stringify(summary.perQuarter));

  // ⚠️ 一季都冇嘢清 ⇒ 要講得出，唔可以靜靜當成成功。
  const empty = gas.summariseQuarterResetBatch_([
    { quarterId: '2027T3', plan: mkPlan('2027T3', [], 0) }
  ]);
  checkEqual('★★★★★★ 一季都冇嘢清 ⇒ `nothingToDo` 係 true',
    empty.nothingToDo, true);
  checkEqual('★★★★★ 有嘢清 ⇒ false', summary.nothingToDo, false);
}

// =====================================================================
console.log('\n=== E3【核心】逐季 try/catch：一季爆咗，其餘照做 ===');
{
  const src = read('src/QuarterReset.gs');

  check('★★★★★ 有 `executeQuarterResetBatch_()`',
    /function executeQuarterResetBatch_\(/.test(src), '');

  const body = src.slice(src.indexOf('function executeQuarterResetBatch_('));
  check('★★★★★★ 逐季包住 try/catch'
    + '——一季爆咗就成批停低嘅話，前面清咗一半、後面完全冇做，'
    + '而幹事唔知停咗喺邊',
    /try \{[\s\S]{0,900}catch \(err\)/.test(body.slice(0, 2000)), '');

  check('★★★★★★ 爆咗嗰季要**記低係邊一季**'
    + '——「有一季失敗」呢種訊息等於冇講',
    /quarterId: /.test(body.slice(0, 2000)) && /error/.test(body.slice(0, 2000)), '');

  // ── 逐季 AuditLog：做之前 ＋ 做之後 ────────────────────────────
  //
  // ⚠️ 連 `action:` 一齊比對，唔可以淨係搵個字串。
  // 呢幾個名亦都出現喺 `log_('ERROR', 'QUARTER_RESET_BATCH_AFTER 寫入失敗…')`
  // 嗰幾句入面——淨係搵字串嘅話，就算真正嗰句 `writeAuditLog_()` 拆走咗，
  // 呢一條測試都仍然係綠。verify-red 嗰陣就係噉捉到。
  check('★★★★★★ 每一季**做之前**寫一次 AuditLog'
    + '——出事嗰陣至少知道當時打算清乜',
    /action: 'QUARTER_RESET_BATCH_BEFORE'/.test(src), '');
  check('★★★★★★ 每一季**做完之後**再寫一次'
    + '——只有 before 嘅話，「打算清」同「實際清咗」永遠對唔到帳；'
    + '一季中途爆咗，AuditLog 睇落同成功一模一樣',
    /action: 'QUARTER_RESET_BATCH_AFTER'/.test(src), '');
  check('★★★★★ 爆咗嗰季都要寫低結果，唔可以靜靜冇咗',
    /action: 'QUARTER_RESET_BATCH_FAILED'/.test(src), '');
}

// =====================================================================
console.log('\n=== E5【核心】清完之後，季度嘅日期同主日清單一格都唔可以少 ===');
{
  // 2027T1 係下一個沙盒季度：`GenerateOn=2026-11-27`、
  // `OfficialSendOn=2026-12-04`、13 個 ServiceDates。
  // 呢幾樣**唔係測試痕跡**，係嗰一季本身嘅設定。
  // 清走咗嘅話，主流程會即刻顯示「這一季的 Quarters 沒有填生成日期」，
  // 而幹事要由頭再填一次。
  const src = read('src/QuarterReset.gs');

  check('★★★★★★ `ServiceDates` 喺「絕對不碰」名單入面',
    /絕對不碰的工作表[\s\S]{0,400}ServiceDates/.test(src), '');
  check('★★★★★★ `SpecialSundays` 都喺入面',
    /絕對不碰的工作表[\s\S]{0,400}SpecialSundays/.test(src), '');

  // 真正嘅防線：`executeQuarterReset_()` 只可以寫 `Quarters` 嘅
  // `Stage` 同 `StageUpdatedAt`，唔可以掂 `GenerateOn`／`OfficialSendOn`。
  const stageFn = src.slice(src.indexOf('function resetQuarterStageForTesting_('));
  check('★★★★★★ 重設 Stage 嗰段**冇掂** `GenerateOn`'
    + '——2027T1 嘅 `GenerateOn=2026-11-27` 唔係測試痕跡，'
    + '係嗰一季本身嘅設定',
    !/GENERATE_ON/.test(stageFn.slice(0, 1600)), '');
  check('★★★★★★ 亦冇掂 `OfficialSendOn`',
    !/OFFICIAL_SEND_ON/.test(stageFn.slice(0, 1600)), '');

  // 而且 `deleteRowsMatching_()` 唔可以被叫嚟掃 `ServiceDates`／`Quarters`。
  const exec = src.slice(src.indexOf('function executeQuarterReset_('),
    src.indexOf('function deleteRowsMatching_('));
  check('★★★★★★ `executeQuarterReset_()` 由頭到尾冇 `SHEETS.SERVICE_DATES`',
    !/SHEETS\.SERVICE_DATES/.test(exec), '');
  check('★★★★★★ 亦冇 `deleteRowsMatching_(SHEETS.QUARTERS`',
    !/deleteRowsMatching_\(SHEETS\.QUARTERS/.test(exec), '');

  // E5 仲有一半：2027T1 要**連 v0 一齊清**。
  check('★★★★★ 批次入口講得出「連 v0 一齊清」係逐批一次過揀',
    /連 v0/.test(read('src/Menu.gs')), '');
}

// =====================================================================
console.log('\n=== E1/E2 接線【核心】選單入口真係行批次嗰條路 ===');
{
  // ⚠️ 呢一節係整組 E 最容易假綠嘅地方。
  //
  // 純函式全部寫好、全部綠燈，而**選單入口仍然一次只食一個 QuarterID**——
  // 噉樣工具等於冇入口，而測試會由頭到尾綠。
  // 呢個就係第四十七輪 A 組嗰種錯嘅另一個樣：碼寫得啱，而行唔到。
  const menu = read('src/Menu.gs');
  const entry = menu.slice(menu.indexOf('function runResetQuarterTestData_('));

  check('★★★★★★ 入口真係叫 `parseQuarterResetBatchInput_()`'
    + '——仲用緊 `normalizeIdInput_()` 直接當一個 QuarterID 嘅話，'
    + '打逗號入去只會變成一個搵唔到嘅季度 ID',
    /parseQuarterResetBatchInput_\(/.test(entry.slice(0, 3000)), '');
  check('★★★★★★ 入口真係叫 `splitQuarterResetTargets_()`'
    + '——冇呢一步，2026T4 就照清',
    /splitQuarterResetTargets_\(/.test(entry.slice(0, 3000)), '');
  check('★★★★★ 入口真係叫 `readQuarterResetBlockedQuarters_()`',
    /readQuarterResetBlockedQuarters_\(/.test(entry.slice(0, 3000)), '');
  check('★★★★★★ 入口真係叫 `executeQuarterResetBatch_()`'
    + '——仲直接叫 `executeQuarterReset_()` 嘅話，'
    + '逐季 try/catch 同逐季 AuditLog 全部行唔到',
    /executeQuarterResetBatch_\(/.test(entry), '');
  check('★★★★★ 入口真係叫 `summariseQuarterResetBatch_()`',
    /summariseQuarterResetBatch_\(/.test(entry), '');
  check('★★★★★★ 逐季細項由 `describeQuarterResetPlanLines_()` 出'
    + '——批次版自己另寫一份細項嘅話，'
    + '兩份清單會慢慢長得唔一樣，而幹事靠嗰份清單做決定',
    /describeQuarterResetPlanLines_\(/.test(entry), '');
  check('★★★★★ `describeQuarterResetPlanLines_()` 真係存在',
    /function describeQuarterResetPlanLines_\(/.test(menu), '');

  check('★★★★★★ 提示文字講得出可以用逗號分隔'
    + '——功能做咗而冇人知，等於冇做',
    /逗號分隔/.test(entry.slice(0, 1500)), '');
  check('★★★★★★ 「連 v0 一齊清」講明係**整批一次過**'
    + '——唔講嘅話，幹事會以為佢淨係揀緊第一季',
    /套用到這一批/.test(entry), '');
  check('★★★★★★ 完成畫面講明 `GenerateOn`／`ServiceDates` 冇碰過'
    + '——清完之後幹事最驚就係「係咪連日期都冇埋」',
    /ServiceDates 的主日清單/.test(entry), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
