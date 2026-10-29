// 第五十九輪批次：自測機把自己鎖死喺門外。
// 執行方式：node tests/selftest_gate_official_sent.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-08-24 19:27）
// ═════════════════════════════════════════════════════════════════════
//
// 捷報：S09「正式發出」同 S10「改動後重發」兩條**首次 PASSED**。
// 而 S09 做嘅事**就係**把季度推到 `OFFICIAL_SENT`。
//
// 跟住撳「繼續跑自測」：
//
//     自測機沒有執行。
//     ・「2028T3」的 Stage 已經是 OFFICIAL_SENT。
//       那代表這一季已經正式發出給全體，不是一個沙盒季度。
//
// ⇒ S11／S12／S13／S16／S17 五條永遠跑唔到（全部標 NOT_RUN）。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 但嗰道閘唔可以就噉拆走
// ═════════════════════════════════════════════════════════════════════
//
// 佢原意係啱嘅：唔好喺一個已經正式發出嘅**真**季度上面亂跑。
// 自測機開跑第一件事就係清乾淨——版本、派工、SendLog 全部刪。
//
// ⚠️ 而「係咪沙盒季度」單獨用唔到做判斷：兩個呼叫端都係傳
// `SELFTEST_QUARTER_ID` 嘅值入嚟，所以嗰個條件係一句恆真句。
//
// 真正要攔嘅係：有人把 `SELFTEST_QUARTER_ID` 填成一個**真嘅、
// 已經寄咗信嘅**季度（而嗰季又唔喺兩張保護清單上）。
//
// ⇒ 第二個條件直接驗嗰道閘自己講嗰句話：「已經正式發出給全體」。
//   全部係 `DRY_RUN` 嘅話，冇一個人收過嘢。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Invariants.gs', 'SelfTestRunner.gs'];

/**
 * 跑一次前置閘。
 *
 * @param {Object} opts `{quarterId, sandboxId, stage, sendLog, dryRun,
 *   webAppEnabled, blocked, protectedQuarters, sendLogThrows}`
 * @returns {Object} `{gas, gate}`
 */
function gate(opts) {
  const gas = loadGasSource(FILES);
  const C = gas.COLUMNS.SEND_LOG;
  gas.log_ = function () {};
  gas.getConfig = function (key, dflt) {
    if (key === gas.CONFIG_KEYS.DRY_RUN) {
      return opts.dryRun === undefined ? true : opts.dryRun;
    }
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) {
      return opts.webAppEnabled === undefined ? true : opts.webAppEnabled;
    }
    return dflt;
  };
  gas.readSelfTestQuarterDetail_ = function () {
    return { value: opts.sandboxId || '2028T3', source: '（測試寫死）' };
  };
  gas.readQuarterResetBlockedQuarters_ = function () {
    return opts.blocked || [];
  };
  gas.readRehearsalProtectedQuarters_ = function () {
    return opts.protectedQuarters || [];
  };
  gas.getQuarterStage_ = function () { return opts.stage; };
  gas.readSheet = function (name) {
    if (opts.sendLogThrows) throw new Error('找不到工作表: SendLog');
    if (name !== gas.SHEETS.SEND_LOG) return [];
    return (opts.sendLog || []).map(function (r) {
      const row = {};
      row[C.QUARTER_ID] = r.quarterId;
      row[C.STATUS] = r.status;
      return row;
    });
  };
  return { gas: gas, gate: gas.checkSelfTestPreconditions_(opts.quarterId) };
}

/** 一封模擬信（`DRY_RUN`）。 */
function dry(quarterId) { return { quarterId: quarterId, status: 'DRY_RUN' }; }
/** 一封真信（`SENT`）。 */
function sent(quarterId) { return { quarterId: quarterId, status: 'SENT' }; }

// =====================================================================
console.log('\n=== A4(b)【核心】沙盒季度 ＋ OFFICIAL_SENT ⇒ 放行 ===');
{
  // S09 跑完之後嘅實況：Stage 已經 OFFICIAL_SENT，
  // 而 SendLog 入面全部係 DRY_RUN（自測機一定喺 DRY_RUN 之下跑）。
  const box = gate({
    quarterId: '2028T3', sandboxId: '2028T3',
    stage: 'OFFICIAL_SENT',
    sendLog: [dry('2028T3'), dry('2028T3'), dry('2028T3')]
  });
  checkEqual('★★★★★★ **放行**'
    + '——S09 做嘅事就係把季度推到 OFFICIAL_SENT。'
    + '攔住嘅話，S11／S12／S13／S16／S17 五條永遠跑唔到',
    box.gate.ok, true);
  checkEqual('★★★★★ 一個理由都冇', box.gate.reasons.length, 0);
}

// =====================================================================
console.log('\n=== A4(a)【核心】唔係沙盒季度 ＋ OFFICIAL_SENT ⇒ 仍然拒絕 ===');
{
  const box = gate({
    quarterId: '2026T4', sandboxId: '2028T3',
    stage: 'OFFICIAL_SENT', sendLog: []
  });
  checkEqual('★★★★★★ **拒絕**'
    + '——自測機開跑第一件事就係清乾淨（版本、派工、SendLog 全刪），'
    + '喺一個真季度上面跑會刪走真實資料',
    box.gate.ok, false);
  check('★★★★★★ 而且講得出佢唔係沙盒季度指住嗰一季',
    box.gate.reasons.some(function (r) {
      return /不是 SELFTEST_QUARTER_ID 指着的那一季（2028T3）/.test(r);
    }), JSON.stringify(box.gate.reasons));
}

// =====================================================================
console.log('\n=== A1【核心】沙盒季度但真係寄過信 ⇒ 拒絕 ===');
{
  // ⚠️⚠️ **呢一條先係整組最重要嗰一條。**
  //
  // 兩個呼叫端都係傳 `SELFTEST_QUARTER_ID` 嘅值入嚟，
  // 所以「係咪沙盒季度」單獨用嘅話係一句恆真句，攔唔到任何嘢。
  //
  // 真正要攔嘅係：有人把 `SELFTEST_QUARTER_ID` 填成一個真嘅、
  // 已經寄咗信嘅季度（而嗰季又唔喺兩張保護清單上）。
  const box = gate({
    quarterId: '2026T4', sandboxId: '2026T4',
    stage: 'OFFICIAL_SENT',
    sendLog: [dry('2026T4'), sent('2026T4'), sent('2026T4')]
  });
  checkEqual('★★★★★★ **拒絕**'
    + '——`SELFTEST_QUARTER_ID` 填錯成一個真季度，'
    + '而嗰季又唔喺兩張保護清單上。放行就會清走真實資料',
    box.gate.ok, false);
  check('★★★★★★ 而且數得出有幾多封係真嘅寄咗出去',
    box.gate.reasons.some(function (r) {
      return /有 2 封是真的寄出去的（Status=SENT）/.test(r);
    }), JSON.stringify(box.gate.reasons));
  check('★★★★★ 而且叫佢去確認 Config 嗰格',
    box.gate.reasons.some(function (r) {
      return /請先確認 SELFTEST_QUARTER_ID 填對了/.test(r);
    }), JSON.stringify(box.gate.reasons));
}

// =====================================================================
console.log('\n=== A1 只數呢一季，唔數第二季 ===');
{
  const box = gate({
    quarterId: '2028T3', sandboxId: '2028T3',
    stage: 'OFFICIAL_SENT',
    // 第二季有真信，但同呢一季無關。
    sendLog: [sent('2026T4'), sent('2027T1'), dry('2028T3')]
  });
  checkEqual('★★★★★★ 放行'
    + '——第二季寄過信唔關沙盒季度事',
    box.gate.ok, true);
}

// =====================================================================
console.log('\n=== A1【核心】讀唔到 SendLog ⇒ 當成唔安全，拒絕 ===');
{
  const box = gate({
    quarterId: '2028T3', sandboxId: '2028T3',
    stage: 'OFFICIAL_SENT', sendLogThrows: true
  });
  checkEqual('★★★★★★ **拒絕**'
    + '——「查不到」同「查到係 0」係兩件事，'
    + '而估錯嗰邊嘅代價係一個真季度被清乾淨',
    box.gate.ok, false);
  check('★★★★★ 而且講明係「讀不到」，唔係「冇寄過」',
    box.gate.reasons.some(function (r) {
      return /讀不到（不能確認有沒有真的寄過信）/.test(r);
    }), JSON.stringify(box.gate.reasons));
}

// =====================================================================
console.log('\n=== A1 Stage 唔係 OFFICIAL_SENT ⇒ 根本唔使查 SendLog ===');
{
  let readCalls = 0;
  const gas = loadGasSource(FILES);
  gas.log_ = function () {};
  gas.getConfig = function (key, dflt) {
    if (key === gas.CONFIG_KEYS.DRY_RUN) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    return dflt;
  };
  gas.readSelfTestQuarterDetail_ = function () { return { value: '2028T3', source: 'x' }; };
  gas.readQuarterResetBlockedQuarters_ = function () { return []; };
  gas.readRehearsalProtectedQuarters_ = function () { return []; };
  gas.getQuarterStage_ = function () { return 'DRAFT'; };
  gas.readSheet = function () { readCalls++; return []; };
  const out = gas.checkSelfTestPreconditions_('2028T3');
  checkEqual('★★★★★ 放行', out.ok, true);
  checkEqual('★★★★★ 而且一次 SendLog 都冇讀過'
    + '——SendLog 可以有幾千行，唔應該每次開跑都掃一次',
    readCalls, 0);
}

// =====================================================================
console.log('\n=== ⚠️ 其餘三道閘一律唔准放寬 ===');
{
  // ⚠️ 呢一節守嘅係「唔好順手放寬」。今輪只准動閘 3。
  checkEqual('★★★★★★ 【閘 1】`DRY_RUN` 唔係 TRUE ⇒ 仍然拒絕'
    + '——自測機會走完整個寄送流程，'
    + 'DRY_RUN=FALSE 嗰陣啲信會真係寄出去',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'DRAFT',
      dryRun: false }).gate.ok, false);
  checkEqual('★★★★★★ 【閘 1】`DRY_RUN` 讀唔到（undefined）⇒ 一樣拒絕',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'DRAFT',
      dryRun: undefined === undefined ? null : null }).gate.ok, false);
  checkEqual('★★★★★★ 【閘 2】喺季度重設保護清單上 ⇒ 仍然拒絕',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'DRAFT',
      blocked: ['2028T3'] }).gate.ok, false);
  checkEqual('★★★★★★ 【閘 2】喺演練保護清單上 ⇒ 仍然拒絕',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'DRAFT',
      protectedQuarters: ['2028T3'] }).gate.ok, false);
  checkEqual('★★★★★★ 【閘 2】季度 ID 空白 ⇒ 仍然拒絕',
    gate({ quarterId: '', sandboxId: '', stage: 'DRAFT' }).gate.ok, false);
  checkEqual('★★★★★★ 【閘 4】`WEBAPP_ENABLED` 唔係 TRUE ⇒ 仍然拒絕',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'DRAFT',
      webAppEnabled: false }).gate.ok, false);

  // ⚠️ 保護清單嗰兩道，就算 Stage 係 OFFICIAL_SENT 而且全部 DRY_RUN
  // （即係「睇落好似沙盒」）都一樣要攔。
  checkEqual('★★★★★★ 【閘 2】保護清單壓過今輪嘅放行'
    + '——今輪只放寬閘 3，唔可以順手令保護清單失效',
    gate({ quarterId: '2028T3', sandboxId: '2028T3', stage: 'OFFICIAL_SENT',
      sendLog: [dry('2028T3')], blocked: ['2028T3'] }).gate.ok, false);
}

// =====================================================================
console.log('\n=== A3【核心】報告開頭要講一句 Stage ===');
{
  const gas = loadGasSource(FILES);
  const lines = gas.describeSelfTestReport_({
    quarterId: '2028T3', resetSummary: '（繼續執行，沒有重設）',
    stageAtStart: 'OFFICIAL_SENT',
    results: [], passedCount: 0, failedCount: 0, errorCount: 0,
    notRunCount: 0, incompleteCount: 0, startupFailures: [], finalInvariants: null
  }).join('\n');
  check('★★★★★★ **講明「S09 造成，正常」**'
    + '——唔講嘅話，下次見到嗰個 Stage 又會以為部機器壞咗',
    /沙盒季度目前 Stage=OFFICIAL_SENT（S09 造成，正常）/.test(lines),
    lines.slice(0, 500));
  check('★★★★★ 而且講明重設會把佢帶返 DRAFT',
    /重設那一步會把它帶回 DRAFT/.test(lines), lines.slice(0, 500));

  const draft = gas.describeSelfTestReport_({
    quarterId: '2028T3', resetSummary: '已清乾淨', stageAtStart: 'DRAFT',
    results: [], passedCount: 0, failedCount: 0, errorCount: 0,
    notRunCount: 0, incompleteCount: 0, startupFailures: [], finalInvariants: null
  }).join('\n');
  check('★★★★★ Stage 唔係 OFFICIAL_SENT 嗰陣唔會印呢一句',
    !/S09 造成，正常/.test(draft), draft.slice(0, 400));
}

// =====================================================================
console.log('\n=== A2 重設會把 Stage 帶返 DRAFT（核實一次）===');
{
  // ⚠️ 呢一條唔係今輪改嘅嘢，係**核實**——A2 要求確認一次。
  const RESET = read('src/QuarterReset.gs');
  check('★★★★★★ `QuarterReset.gs` 真係把 Stage 寫返 `DRAFT`'
    + '——冇呢一步嘅話，「⚠️ 跑自測」重頭跑一次之後 Stage 仍然係'
    + 'OFFICIAL_SENT，而 S01「空季度」嗰條就永遠跑唔啱',
    /sheet\.getRange\(info\.sheetRow, stageCol\)\.setValue\(QUARTER_STAGE\.DRAFT\);/
      .test(RESET), '');
  check('★★★★★ 而且稽核紀錄講得出佢重設咗 Stage',
    /Stage 重設為 ' \+ QUARTER_STAGE\.DRAFT/.test(RESET), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
