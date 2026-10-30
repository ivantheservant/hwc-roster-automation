// 第九十一輪批次 RC 組（儲存時不重複建 fine-tune context）＋ RE 組（儲存計時拆細，不改行為）。
// 執行方式：node tests/round91_rc_re_save.test.js
//
//   RC1 儲存那一步不再自己建 buildFineTuneContext_()（沿用 plan 那一次）；plan 本身建一次。
//       （`planApplyRequests_()` 為申報另外建一次，不在本組範圍，交接寫明。）
//   RC2 reuseSaveConfirmContext_：季度、版本號相同 ⇒ 沿用；不同或沒有 ⇒ 重建
//   RC3 plan 那一段不會改動 context（沿用之前要先證明這一點：建好時和 plan 完成後的內容一樣）
//   RE1 確認前（apiSaveAndConfirmPlan）和確認後（儲存）兩次都有新分段：讀取各工作表、申報、規則分類、其他
//   RE2 計時不改結果：有計時和沒有計時，plan 的內容一樣
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 生成第 0 版，改一格主席（換成當日沒有崗位的人）。 */
function scene() {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const D = sc.DATES;
  const busy = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((k) => sc.getCell(0, D[0], k));
  const free = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
  sc.setCell(0, D[0], 'CHAIR#1', free);
  return sc;
}

/** 把 buildFineTuneContext_ 包起來：數次數、記低每個 context 建好時的內容。 */
function spyContext(g) {
  const real = g.buildFineTuneContext_;
  const spy = { count: 0, made: [] };
  g.buildFineTuneContext_ = function (q, v, o) {
    spy.count++;
    const caller = (new Error().stack.split('\n')[2] || '').trim();
    const ctx = real(q, v, o);
    spy.made.push({ ctx: ctx, json: JSON.stringify(ctx), caller: caller });
    return ctx;
  };
  return spy;
}

console.log('\n=== RC1：一次儲存只建一次 context ===');
{
  const sc = scene();
  const g = sc.gas;
  const spy = spyContext(g);
  const r = g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（前置）儲存成第 1 版', r && r.ok && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
  const callers = spy.made.map((m) => m.caller);
  check('★★★★★★ 儲存那一步（apiSaveAndConfirmExecute_locked_）不再自己建 context',
    callers.every((c) => c.indexOf('apiSaveAndConfirmExecute_locked_') === -1), callers.join('｜'));
  check('★★★★★★ 一次儲存合共建 2 次（plan 一次＋申報 planApplyRequests_ 一次；之前 3 次）', spy.count === 2, callers.join('｜'));
  check('★★★★★ buildSaveAndConfirmPlan_ 只建一次（之前連儲存那一步共兩次）',
    callers.filter((c) => c.indexOf('buildSaveAndConfirmPlan_ (') !== -1).length === 1, callers.join('｜'));
}

console.log('\n=== RC2：reuseSaveConfirmContext_ ===');
{
  const sc = scene();
  const g = sc.gas;
  const spy = spyContext(g);
  const ctx = g.buildFineTuneContext_(sc.Q, 0);
  spy.count = 0;
  check('★★★★★ 季度、版本號相同 ⇒ 沿用同一個物件，不重建', g.reuseSaveConfirmContext_(ctx, sc.Q, 0) === ctx && spy.count === 0);
  const other = g.reuseSaveConfirmContext_(Object.assign({}, ctx, { versionNo: 5 }), sc.Q, 0);
  check('★★★★★★ 版本號不同 ⇒ 重建', spy.count === 1 && other.versionNo === 0, spy.count);
  g.reuseSaveConfirmContext_(Object.assign({}, ctx, { quarterId: '2098T4' }), sc.Q, 0);
  g.reuseSaveConfirmContext_(null, sc.Q, 0);
  check('★★★★★ 季度不同、沒有 context ⇒ 重建', spy.count === 3, spy.count);
}

console.log('\n=== RC3：plan 不會改動 context ===');
{
  const sc = scene();
  const g = sc.gas;
  const spy = spyContext(g);
  const out = {};
  g.buildSaveAndConfirmPlan_(sc.Q, null, out);
  const mine = spy.made.filter((m) => m.ctx === out.context)[0];
  check('（前置）plan 交出它自己建的 context', !!mine && mine.caller.indexOf('buildSaveAndConfirmPlan_ (') !== -1, spy.made.map((m) => m.caller).join('｜'));
  check('★★★★★★ plan 完成之後 context 和建好時一樣（沿用是安全的）', mine && JSON.stringify(out.context) === mine.json);
  const plan = g.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★ 送去前端的 plan 沒有 context（不會把整份資料送出去）', !('context' in plan) && JSON.stringify(plan).indexOf('peopleById') === -1);
}

console.log('\n=== RE1／RE2：分段計時 ===');
{
  const sc = scene();
  const g = sc.gas;
  const plan = g.apiSaveAndConfirmPlan(sc.Q);
  const labels = (plan.timings || []).map((x) => x.label);
  check('★★★★★ 確認前：檢查：讀取各工作表／申報／規則分類／其他，最後「合計」',
    ['檢查：讀取各工作表', '檢查：申報', '檢查：規則分類', '檢查：其他（三欄對照、空格、起點）'].every((l) => labels.indexOf(l) !== -1)
    && labels[labels.length - 1] === '合計', labels.join('｜'));
  const bare = g.buildSaveAndConfirmPlan_(sc.Q);
  const timed = Object.assign({}, plan); delete timed.timings;
  check('★★★★★★ 計時不改結果（有計時和沒有計時的 plan 一樣）', JSON.stringify(bare) === JSON.stringify(timed));
  const r = g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  const rl = (r.timings || []).map((x) => x.label);
  check('★★★★★ 確認後（儲存）：重新檢查：讀取各工作表／申報／規則分類／其他',
    ['重新檢查：讀取各工作表', '重新檢查：申報', '重新檢查：規則分類', '重新檢查：其他（三欄對照、空格、起點）'].every((l) => rl.indexOf(l) !== -1), rl.join('｜'));
  check('★★★★ 前端把確認前的分段寫入 console（標題「儲存確認前檢查分段時間」）',
    /logSaveTimings\(savePlan, '儲存確認前檢查分段時間'\)/.test(read('src/ui/ScriptZone1.html')));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exitCode = fail === 0 ? 0 : 1;
