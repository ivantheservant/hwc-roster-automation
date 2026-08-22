// 第五十五輪批次 C3 組：回退預覽——前端到底畫咗乜。
// 執行方式：node tests/rollback_preview_replay.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// S12 上一次斷言「回退嘅預覽有警告」，做法係喺 `JSON.stringify(plan)`
// 入面搵「警告」兩個字。搵唔到 ⇒ 紅。
//
// 而 `apiRollbackPlan()` **一直都有**一個警告欄位：`sheetsHistoryWarning`。
// 佢嘅內容係：
//
//     不要用 Google 試算表本身的「版本記錄」還原。…
//
// 嗰段字入面**一個「警告」都冇**。警告一直喺度，係測試搵錯咗字。
//
// ⚠️ 但係「API 有嗰個欄位」同「幹事真係見到嗰句」係兩件事。
// 中間隔住 `renderRollbackPreview()`——一個第 2 層錄影重播先驗得到。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份用真嘅前端函式
// ═════════════════════════════════════════════════════════════════════
//
// 佢載入真嘅 `ScriptRollback.html`，餵一份照 `apiRollbackPlan()`
// 真正嗰個 return 砌嘅 payload，然後睇**真正畫咗出嚟嗰段文字**。
//
// ⚠️ 下面第 0 條守住「payload 嘅欄位同真嗰個 return 一樣」——
// 憑想像寫欄位名嘅話，呢一份會綠而實機會紅。

const fs = require('fs');
const path = require('path');
const { loadUiScripts } = require('./helpers/ui_loader.js');

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

/** `ROLLBACK_SHEETS_HISTORY_WARNING` 由後端原始碼度攞，唔喺呢度抄一次。 */
const WARNING = (function () {
  const src = read('src/WebAppRollback.gs');
  const at = src.indexOf('const ROLLBACK_SHEETS_HISTORY_WARNING =');
  const end = src.indexOf(';', at);
  // 把 `'…\n' + '…'` 嗰串拼接還原成一段字。
  return src.slice(at, end).split('=').slice(1).join('=')
    .split('+').map(function (part) {
      const m = part.match(/'([\s\S]*)'/);
      return m ? m[1] : '';
    }).join('').replace(/\\n/g, '\n');
})();

/** 照 `apiRollbackPlan()` 真正嗰個 return 砌一份 payload。 */
function makePlan(opts) {
  const o = opts || {};
  const changes = o.cellChanges || [];
  return {
    blocked: false,
    blockReason: null,
    quarterId: '2028T3',
    stage: o.stage || 'OFFICIAL_SENT',
    currentVersionNo: 3,
    targetVersionNo: 2,
    newVersionNo: 4,
    cellChangeCount: changes.length,
    cellChanges: changes,
    violations: { real: [], released: [], structural: [], semiHard: [] },
    violationCheckFailed: o.violationCheckFailed || '',
    needsRelease: false,
    outdatedPersonCount: o.outdatedPersonCount === undefined ? 2 : o.outdatedPersonCount,
    sheetsHistoryWarning: WARNING
  };
}

function makeChange(serviceDate, postNameTC, slotIndex, currentName, willBecome) {
  return {
    serviceDate: serviceDate, postId: 'X', postNameTC: postNameTC,
    slotIndex: slotIndex, currentName: currentName, willBecome: willBecome
  };
}

/**
 * 載入真嘅前端，攔住 `openConfirm()`，回傳佢收到嗰份嘢。
 *
 * @returns {Object} `{ui, captured}`
 */
function freshUi() {
  const ui = loadUiScripts(['Script.html', 'ScriptRollback.html']);
  const captured = { calls: [] };
  ui.openConfirm = function (opts) { captured.calls.push(opts); };
  ui.currentQuarterId = '2028T3';
  return { ui: ui, captured: captured };
}

/** 把 `openConfirm()` 收到嗰批 node 攤平成一段文字。 */
function textOf(opts) {
  const out = [];
  const walk = function (n) {
    if (!n) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (n.textContent) out.push(n.textContent);
    (n.children || []).forEach(walk);
  };
  (opts.bodyNodes || []).forEach(walk);
  return out.join('\n');
}

// =====================================================================
console.log('\n=== 0【前提】payload 嘅欄位要同真嗰個 return 對得上 ===');
{
  const src = read('src/WebAppRollback.gs');
  const at = src.indexOf('  return {\n    blocked: false,\n    blockReason: null,\n    quarterId: quarterId,');
  const block = src.slice(at, src.indexOf('\n  };', at));
  const realKeys = (block.match(/^    (\w+):/gm) || [])
    .map(function (m) { return m.trim().replace(':', ''); }).sort();
  const mineKeys = Object.keys(makePlan({})).sort();
  checkEqual('★★★★★★ **payload 嘅欄位同 `apiRollbackPlan()` 完全一樣**'
    + '——憑想像寫欄位名嘅話，呢一份會綠而實機會紅',
    mineKeys.join(','), realKeys.join(','));
  check('★★★★★ 而且真係抓到嘢（唔係兩邊都空）',
    realKeys.length >= 14, realKeys.join(','));
  check('★★★★★★ 而且嗰段警告真係由後端常數度攞返嚟'
    + '——喺呢度抄多一次嘅話，後端改咗文案而呢一份仍然綠',
    WARNING.indexOf('不要用 Google 試算表本身的') === 0
      && WARNING.indexOf('之後每一步都會出錯') > 0, JSON.stringify(WARNING));
}

// =====================================================================
console.log('\n=== C1【核心】後端真係帶住嗰個警告欄位 ===');
{
  // ⚠️ 上面第 0 條驗嘅係「payload 嘅欄位名對得上」，
  // 呢一條驗嘅係**後端真係填咗嘢入去**——兩件事。
  //
  // 而且要真正叫落 `apiRollbackPlan()`，唔係讀原始碼搵字串。
  const { loadGasSource } = require('./helpers/gas_loader.js');
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'StateSource.gs', 'WebAppGuards.gs', 'WebAppRollback.gs'
  ]);
  gas.log_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.findLatestVersionNo = function () { return 3; };
  gas.getQuarterStage_ = function () { return gas.QUARTER_STAGE.OFFICIAL_SENT; };
  gas.readDashboardUnsavedState_ = function () {
    return { hasAny: false, gridChangeCount: 0, unresolvedCount: 0,
      pendingRequestCount: 0 };
  };
  gas.readPostsNormalized = function () {
    return [{ postId: 'USHER', postNameTC: '司事', slotCount: 1 }];
  };
  gas.readVersionAssignmentsForGrid_ = function (quarterId, versionNo) {
    return [{
      serviceDate: '2028-07-09', postId: 'USHER', slotIndex: 1,
      personId: versionNo === 3 ? 'P1' : 'P2',
      personName: versionNo === 3 ? '假甲乙' : '假丙丁'
    }];
  };
  // 規則檢查跑唔起 ⇒ `violationCheckFailed` 有值，其餘照回。
  gas.buildFineTuneContext_ = function () { throw new Error('（測試不跑規則檢查）'); };

  const plan = gas.apiRollbackPlan('2028T3', 2);
  checkEqual('★★★★★ 冇被擋住', plan.blocked, false);
  check('★★★★★★ **`sheetsHistoryWarning` 真係有嘢**'
    + '——第五十四輪嗰次 S12 喺 `JSON.stringify(plan)` 入面搵「警告」兩個字，'
    + '而嗰段警告本身一個「警告」都冇，所以搵唔到。'
    + '警告一直喺度，係測試搵錯咗字',
    String(plan.sheetsHistoryWarning || '').indexOf('不要用 Google 試算表本身的') === 0,
    JSON.stringify(plan.sheetsHistoryWarning));
  checkEqual('★★★★★★ 而且同後端嗰個常數一模一樣'
    + '——兩邊各寫一次嘅話，改咗其中一邊就會靜靜噉唔一致',
    plan.sheetsHistoryWarning, WARNING);
  checkEqual('★★★★★ 而且列得出差異', plan.cellChangeCount, 1);
  checkEqual('★★★★★ 回退會造出第 4 版（唔係刪走第 3 版）', plan.newVersionNo, 4);
}

// =====================================================================
console.log('\n=== C3【核心】幹事真係見到嗰句警告 ===');
{
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({
    cellChanges: [makeChange('2028-07-09', '司事', 1, '假甲乙', '假丙丁')]
  }));

  checkEqual('★★★★★★ 真係彈咗個確認窗出嚟', box.captured.calls.length, 1);
  const opts = box.captured.calls[0];
  const body = textOf(opts);
  check('★★★★★★ **「不要用試算表版本記錄還原」嗰句真係畫咗出嚟**'
    + '——API 有嗰個欄位，同幹事真係見到，係兩件事。'
    + '中間隔住 `renderRollbackPreview()`',
    body.indexOf('不要用 Google 試算表本身的') >= 0, body.slice(0, 700));
  check('★★★★★ 而且成段都喺度（唔係淨係第一行）',
    body.indexOf('之後每一步都會出錯') >= 0, body.slice(-500));
}

// =====================================================================
console.log('\n=== C3【核心】回退要打字確認，唔可以撳一下就做 ===');
{
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({
    cellChanges: [makeChange('2028-07-09', '司事', 1, '假甲乙', '假丙丁')]
  }));
  const opts = box.captured.calls[0];
  checkEqual('★★★★★★ `requireTyping` 係 true'
    + '——回退會蓋走現況，撳一下就做嘅話，'
    + '幹事會當成「睇一睇」噉撳落去',
    opts.requireTyping, true);
  checkEqual('★★★★★ 而且標成 danger', opts.danger, true);
  checkEqual('★★★★★ 標題講得出回去邊一版', opts.title, '回到第 2 版');
}

// =====================================================================
console.log('\n=== C3 規格 5.3 步 4：確認畫面嗰四句一句都唔可以少 ===');
{
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({
    cellChanges: [makeChange('2028-07-09', '司事', 1, '假甲乙', '假丙丁')]
  }));
  const body = textOf(box.captured.calls[0]);
  [
    ['會建立第 4 版，內容與第 2 版相同。', '唔講嘅話，幹事會以為回退係「刪咗新嗰版」'],
    ['第 3 版不會被刪除，仍然可以查看和再回去。', '唔講嘅話，幹事唔敢撳'],
    ['會重新發佈公開連結。', '唔講嘅話，幹事唔知道收到連結嗰班人會見到新內容'],
    ['不會寄出任何電郵、不會改變這一季的進度。', '唔講嘅話，幹事會驚撳咗會寄信']
  ].forEach(function (pair) {
    check('★★★★★★ 「' + pair[0] + '」——' + pair[1],
      body.indexOf(pair[0]) >= 0, body.slice(0, 900));
  });
}

// =====================================================================
console.log('\n=== C3 逐格對照要列得出，而唔係淨係一個數字 ===');
{
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({
    cellChanges: [
      makeChange('2028-07-09', '司事', 1, '假甲乙', '假丙丁'),
      makeChange('2028-07-16', '讀經', 2, '假戊己', '假庚辛')
    ]
  }));
  const body = textOf(box.captured.calls[0]);
  check('★★★★★★ 逐格列咗出嚟，而且用崗位**中文名**'
    + '——列 `postId` 嘅話，幹事見到嘅係 `X#1` 呢種機器鍵',
    body.indexOf('2028-07-09　司事#1') >= 0
      && body.indexOf('2028-07-16　讀經#2') >= 0, body.slice(0, 900));
  check('★★★★★ 而且講得出「目前係邊個、會變返邊個」',
    body.indexOf('目前是「假甲乙」') >= 0
      && body.indexOf('會變回「假丙丁」') >= 0, body.slice(0, 900));
}

// =====================================================================
console.log('\n=== C3 `cellChangeCount = 0` 嗰個退化狀態要講明 ===');
{
  // ⚠️ 第五十四輪嗰次實測就係呢個：第 3 版同第 2 版一模一樣
  //（一個 `appliedCount=0` 嘅空套用造出嚟嘅孖生版本，見 A3 決策點）。
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({ cellChanges: [] }));
  const body = textOf(box.captured.calls[0]);
  check('★★★★★★ 講明「內容完全一樣，回退不會改變任何一格」'
    + '——唔講嘅話，幹事撳落去見到多咗一版而乜都冇變，會以為系統壞咗',
    body.indexOf('內容完全一樣') >= 0
      && body.indexOf('回退不會改變任何一格') >= 0, body.slice(0, 700));
  check('★★★★★ 而且嗰句警告照樣要出',
    body.indexOf('不要用 Google 試算表本身的') >= 0, body.slice(-500));
}

// =====================================================================
console.log('\n=== C3 規則檢查查唔到 ⇒ 要講「查唔到」，唔可以扮「冇問題」 ===');
{
  const box = freshUi();
  box.ui.renderRollbackPreview(makePlan({
    cellChanges: [makeChange('2028-07-09', '司事', 1, '假甲乙', '假丙丁')],
    violationCheckFailed: 'Posts 工作表讀不到'
  }));
  const body = textOf(box.captured.calls[0]);
  check('★★★★★★ 講「這一次檢查不到」而唔係「0 項違反」'
    + '——「檢查過，冇問題」同「檢查唔到」係兩件事，'
    + '而後者被顯示成前者係最難察覺嗰種錯',
    body.indexOf('這一次檢查不到') >= 0
      && body.indexOf('Posts 工作表讀不到') >= 0, body.slice(0, 900));
  check('★★★★★ 而且明講「不是「沒有問題」，是「查不到」」',
    body.indexOf('不是「沒有問題」，是「查不到」') >= 0, body.slice(0, 900));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
