// 第五十六輪批次 A 組：一筆都套用唔到，照樣造咗個孖生版本。
// 執行方式：node tests/zero_apply_no_version.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第五十五輪實測）
// ═════════════════════════════════════════════════════════════════════
//
//     {"sheetName":"Roster_2028T3_v3","baseVersionNo":2,"appliedCount":0,
//      "rejectedCount":0,"needsInputCount":3,…,"advanced":true}
//
// 三筆申報全部跌落 `needsInput`，一格都冇改過——但照樣造咗 v3，
// 而 v3 同 v2 **逐格一樣**。
//
// 後果：S12 嘅回退預覽出 `cellChangeCount:0`（「回退等於冇嘢改」），
// 版本號白白通脹。
//
// **Ivan 嘅決定：`appliedCount === 0` ⇒ 唔造版本。**
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════
//
// 佢 stub 住每一個寫入動作（`createRosterSheet_`／`writeAssignments_`／
// `registerVersion_`／`publishPublicRoster_`），記低邊個被叫過，
// 然後真正行 `applyRequests_()` 最後嗰一段。

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
const SRC = read('src/RequestsApply.gs');

/**
 * 行 `applyRequests_()` 由「算違反」到 `return` 嗰一段。
 *
 * ⚠️ 由 `const violationCheckState =` 開始——即係
 * **所有寫入動作之前**。呢一段就係 A1 要驗嗰個判斷所在。
 *
 * @param {Object} opts `{outcomes, manualChanges, pendingBackfillCells,
 *   newEligibilityRows, newUnavailableRows}`
 * @returns {Object} `{result, calls}`
 */
function runTail(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppSaveConfirm.gs', 'RequestsApply.gs'
  ]);
  const calls = [];
  gas.log_ = function () {};
  gas.writeAuditLog_ = function () {};
  gas.findStateViolations_ = function () { return []; };
  gas.decorateViolations_ = function (v) { return v; };
  gas.makeWarning_ = function () { return {}; };
  gas.buildRosterSheetName_ = function (q, v) { return 'Roster_' + q + '_v' + v; };
  gas.createRosterSheet_ = function () { calls.push('createRosterSheet_'); return 'Roster_2028T3_v3'; };
  gas.writeAssignments_ = function () { calls.push('writeAssignments_'); };
  gas.registerVersion_ = function () { calls.push('registerVersion_'); };
  gas.markPendingBackfillCells_ = function () { calls.push('markPendingBackfillCells_'); };
  gas.writeNewEligibilityRows_ = function () { calls.push('writeNewEligibilityRows_'); return 0; };
  gas.writeNewUnavailableRows_ = function () { calls.push('writeNewUnavailableRows_'); return 0; };
  gas.writeRequestOutcomes_ = function () { calls.push('writeRequestOutcomes_'); };
  gas.publishPublicRoster_ = function () { calls.push('publish'); };
  gas.findPublicLinkRow_ = function () { return null; };
  gas.findLatestVersionNo_ = function () { return 2; };

  const at = SRC.indexOf('  const violationCheckState = assignments.map(function (a) {');
  const end = SRC.indexOf('\n}\n', SRC.indexOf('    violations: violations\n  };'));
  const tail = SRC.slice(at, end);
  const fn = new Function('ctx', 'opts', 'with (ctx) {'
    + 'const plan = { quarterId: "2028T3", baseVersionNo: 2, context: {},'
    + '  manualChanges: opts.manualChanges || [] };'
    + 'const newVersionNo = 3;'
    + 'const assignments = [];'
    + 'const outcomes = opts.outcomes;'
    + 'const pendingBackfillCells = opts.pendingBackfillCells || [];'
    + 'const newEligibilityRows = opts.newEligibilityRows || [];'
    + 'const newUnavailableRows = opts.newUnavailableRows || [];'
    + 'const basis = null; const versionNote = ""; const changeCounts = null;'
    + tail + '}');
  return { result: fn(gas, opts), calls: calls, gas: gas };
}

function outcome(status) {
  return { sheetRow: 5, status: status, resultNote: '' };
}

// =====================================================================
console.log('\n=== A1【核心】一筆都套用唔到 ⇒ 一個寫入動作都唔應該做 ===');
{
  const gas0 = loadGasSource(['Constants.gs']);
  const S = gas0.REQUEST_STATUS;
  const box = runTail({ outcomes: [outcome(S.NEEDS_INPUT), outcome(S.NEEDS_INPUT),
    outcome(S.NEEDS_INPUT)] });

  checkEqual('★★★★★★ **冇造 grid 工作表**', box.calls.indexOf('createRosterSheet_'), -1);
  checkEqual('★★★★★★ **冇寫 RosterAssignments**', box.calls.indexOf('writeAssignments_'), -1);
  checkEqual('★★★★★★ **冇加 RosterVersions 行**', box.calls.indexOf('registerVersion_'), -1);
  checkEqual('★★★★★★ **冇發佈公開連結**'
    + '——冇造新版本，公開連結就冇嘢要更新',
    box.calls.indexOf('publish'), -1);
  checkEqual('★★★★★★ **但 outcomes 照樣寫返落張表**'
    + '——唔寫嘅話，同一批申報下次會再被當成「未處理」，'
    + '而幹事會見到同一批嘢彈返出嚟',
    box.calls.join('、'), 'writeRequestOutcomes_');
}

// =====================================================================
console.log('\n=== A1【核心】回傳要講得清楚，而且版本號唔可以幻想 ===');
{
  const gas0 = loadGasSource(['Constants.gs']);
  const S = gas0.REQUEST_STATUS;
  const box = runTail({ outcomes: [outcome(S.NEEDS_INPUT), outcome(S.REJECTED)] });
  const r = box.result;

  checkEqual('★★★★★★ `versionNo` 係**現有**最新版本號（2），'
    + '唔係一個幻想出嚟嘅新號（3）'
    + '——回一個唔存在嘅版本號，呼叫端就會攞住佢去讀一張唔存在嘅表',
    r.versionNo, 2);
  checkEqual('★★★★★ `sheetName` 指返現有嗰張', r.sheetName, 'Roster_2028T3_v2');
  checkEqual('★★★★★★ `versionCreated` 係 false', r.versionCreated, false);
  checkEqual('★★★★★★ **叫 `zeroChange`，同「儲存並確認」嗰邊一樣**'
    + '——一邊叫 zeroChange 一邊叫第二個名，呼叫端就要識兩套',
    r.zeroChange, true);
  check('★★★★★★ 訊息講得出「冇造新版本，因為一筆都冇套用到」',
    /沒有建立新版本，因為一筆申報都沒有套用到/.test(r.message), r.message);
  check('★★★★★ 而且講得出而家最新係邊一版',
    /第 2 版仍然是最新一版/.test(r.message), r.message);
  checkEqual('★★★★★ 三個數照回', r.appliedCount + '/' + r.rejectedCount
    + '/' + r.needsInputCount, '0/1/1');
  check('★★★★★★ `violations` 照回'
    + '——`executeStep3Apply_()` 靠佢決定 Stage 前唔前進，'
    + '而 Ivan 嘅決定係「Stage 嘅前進與否維持現有行為不變」',
    Array.isArray(r.violations), JSON.stringify(r.violations));
}

// =====================================================================
console.log('\n=== A1【核心】有一筆套用到 ⇒ 照造版本 ===');
{
  const gas0 = loadGasSource(['Constants.gs']);
  const S = gas0.REQUEST_STATUS;
  const box = runTail({ outcomes: [outcome(S.APPLIED), outcome(S.NEEDS_INPUT)] });

  check('★★★★★★ 造咗 grid 工作表、寫咗長表、加咗版本行',
    box.calls.indexOf('createRosterSheet_') >= 0
      && box.calls.indexOf('writeAssignments_') >= 0
      && box.calls.indexOf('registerVersion_') >= 0, box.calls.join('、'));
  checkEqual('★★★★★★ 而且發佈咗公開連結'
    + '——第五十五輪 A 組嗰條唔可以被今輪整跌',
    box.calls.indexOf('publish') >= 0, true);
  checkEqual('★★★★★ `versionNo` 係新號', box.result.versionNo, 3);
  checkEqual('★★★★★ `versionCreated` 係 true', box.result.versionCreated, true);
  checkEqual('★★★★★ `zeroChange` 係 false', box.result.zeroChange, false);
}

// =====================================================================
console.log('\n=== A1【核心】「冇任何格被寫」唔止睇 appliedCount ===');
{
  // ⚠️ `appliedCount === 0` 但幹事喺 grid 上面親手改過嘢 ⇒
  // 嗰幾格要跟住新版本一齊入 version of record。唔造版本就會蒸發咗。
  const gas0 = loadGasSource(['Constants.gs']);
  const S = gas0.REQUEST_STATUS;
  [
    ['幹事喺 grid 親手改過（manualChanges）',
      { manualChanges: [{ serviceDate: 'd', postId: 'p', slotIndex: 1 }] }],
    ['有待補格（pendingBackfillCells）', { pendingBackfillCells: [{}] }],
    ['有要新增嘅 Eligibility 行', { newEligibilityRows: [{}] }],
    ['有要新增嘅 Unavailable 行', { newUnavailableRows: [{}] }]
  ].forEach(function (pair) {
    const box = runTail(Object.assign({ outcomes: [outcome(S.NEEDS_INPUT)] }, pair[1]));
    check('★★★★★★ 【' + pair[0] + '】仍然要造版本'
      + '——唔造嘅話，嗰幾格就會蒸發咗',
      box.calls.indexOf('registerVersion_') >= 0, box.calls.join('、'));
  });
}

// =====================================================================
console.log('\n=== A2 措辭同「儲存並確認」嗰邊對齊 ===');
{
  // ⚠️ 兩邊唔可以一邊叫 `zeroChange` 一邊叫第二個名。
  const SC = read('src/WebAppSaveConfirm.gs');
  check('★★★★★★ 「儲存並確認」嗰邊用 `zeroChange: true` ＋ `versionCreated: false`',
    /zeroChange: true/.test(SC) && /versionCreated: false/.test(SC), '');
  check('★★★★★★ 套用申報呢邊用同一套',
    /zeroChange: true/.test(SRC) && /versionCreated: false/.test(SRC), '');
  check('★★★★★ 兩邊都講「沒有建立新版本」',
    /沒有建立新版本/.test(SC) && /沒有建立新版本/.test(SRC), '');
}

// =====================================================================
console.log('\n=== A1 反證：判斷一定要喺寫入之前 ===');
{
  // ⚠️ 「造咗版本先發現係空然後刪返」——刪版本呢種動作唔應該存在。
  // 所以要驗個判斷排喺 `createRosterSheet_()` **之前**。
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const guardAt = CODE.indexOf('  if (wroteNothing) {');
  const writeAt = CODE.indexOf('  const sheetName = createRosterSheet_(');
  check('★★★★★★ **判斷排喺第一個寫入動作之前**'
    + '——造咗先刪返嘅話，一次失敗就會留低一個孤兒版本',
    guardAt > 0 && writeAt > 0 && guardAt < writeAt,
    'guard@' + guardAt + '　write@' + writeAt);
  check('★★★★★★ 而且成支 `applyRequests_()` 冇任何刪版本嘅動作',
    !/deleteSheet|deleteRosterVersion|removeVersion/.test(CODE), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
