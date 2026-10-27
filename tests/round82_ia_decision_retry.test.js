// 第八十二輪批次 IA 組：〔檢查我的改動〕勾選撞到全域鎖 ⇒ 自動等候再試；排隊逐個寫；最後寫唔到 ⇒ 還原。
// 執行方式：node tests/round82_ia_decision_retry.test.js
//
// 手動測試 C：勾選框下面出紅框「記不住你的選擇：另一個動作還在做緊……」，而勾選框仍然顯示已勾。
//
//   IA1　撞鎖兩次再成功 ⇒ 自動再試、記住；狀態寫「記住中……」，完成後清走
//   IA2　一直撞鎖 ⇒ 試到上限（約 30 秒）就停；勾選框還原成未勾；嗰一行寫「這一格未記住，請再勾一次」
//   IA3　連續快速勾三格 ⇒ 排隊逐個寫（同一時間只有一個呼叫），三格都記住
//   IA4　唔係撞鎖嘅錯誤 ⇒ 唔等、即刻還原

const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const BUSY = '發生了甚麼：另一個動作還在做緊，所以「記住你的決定」沒有開始。';

function setup(behaviour) {
  const ui = loadUiScripts(['Script.html']);
  const log = { calls: [], active: 0, maxActive: 0, waits: 0 };
  ui.waitMs = () => { log.waits++; return Promise.resolve(); };
  ui.callServerMutating = async (fn, q, payloads) => {
    log.active++;
    log.maxActive = Math.max(log.maxActive, log.active);
    log.calls.push({ fn, payloads });
    await Promise.resolve();
    await Promise.resolve();
    log.active--;
    const r = behaviour(log.calls.length, payloads);
    if (r instanceof Error) throw r;
    return { ok: true };
  };
  return { ui, log };
}

const rule = (i) => ({
  key: '2099-01-0' + i + '|READ|1', serviceDate: '2099-01-0' + i, postId: 'READ', slotIndex: 1,
  kind: 'KEEP_RULE', cellText: '假甲', ruleId: 'SEMI_CONSECUTIVE', mustFollow: false, checked: false
});
const textOf = (n) => String(n.textContent || '');
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

function boxesOf(ui, sections) {
  const out = [];
  const walk = (n) => {
    if (n.tagName === 'INPUT') out.push(n);
    (n.children || []).forEach(walk);
  };
  sections.nodes.forEach(walk);
  return out;
}
function linesOf(sections) {
  const out = [];
  const walk = (n) => {
    if (n.className === 'check-row') out.push(n);
    (n.children || []).forEach(walk);
  };
  sections.nodes.forEach(walk);
  return out;
}

(async () => {
  console.log('\n=== IA1：撞鎖兩次再成功 ===');
  {
    const { ui, log } = setup((n) => (n <= 2 ? new Error(BUSY) : null));
    const s = ui.buildDecisionSections({ names: [], rules: [rule(1)] }, {});
    const cb = boxesOf(ui, s)[0];
    const line = linesOf(s)[0];
    cb.checked = true;
    const p = cb.fire('change');
    await Promise.resolve();
    check('★★★★ 勾咗之後即刻寫「記住中……」', /記住中/.test(textOf(line)), textOf(line));
    await p; await flush();
    check('★★★★★★ 自動再試：一共叫 3 次、等咗 2 次', log.calls.length === 3 && log.waits === 2, JSON.stringify([log.calls.length, log.waits]));
    check('★★★★★★ 勾選框保持已勾', cb.checked === true);
    check('★★★★ 完成後「記住中」清走、冇「未記住」', !/記住中|未記住/.test(textOf(line)), textOf(line));
  }

  console.log('\n=== IA2：一直撞鎖 ⇒ 還原 ===');
  {
    const { ui, log } = setup(() => new Error(BUSY));
    const s = ui.buildDecisionSections({ names: [], rules: [rule(1)] }, {});
    const cb = boxesOf(ui, s)[0];
    const line = linesOf(s)[0];
    cb.checked = true;
    await cb.fire('change'); await flush();
    check('★★★★★ 試到上限就停（11 次，約 30 秒）', log.calls.length === 11 && log.waits === 10, JSON.stringify([log.calls.length, log.waits]));
    check('★★★★★★ 勾選框還原成未勾', cb.checked === false);
    check('★★★★★★ 嗰一行寫「這一格未記住，請再勾一次」', /這一格未記住，請再勾一次/.test(textOf(line)), textOf(line));
    check('★★★★ 頂部／彈窗狀態寫「勾選已經還原」', /勾選已經還原/.test(textOf(ui.document.getElementById('status'))));
  }

  console.log('\n=== IA3：連續快速勾三格 ⇒ 排隊 ===');
  {
    const { ui, log } = setup((n) => (n === 1 ? new Error(BUSY) : null));
    const s = ui.buildDecisionSections({ names: [], rules: [rule(1), rule(2), rule(3)] }, {});
    const cbs = boxesOf(ui, s);
    const ps = cbs.map((cb) => { cb.checked = true; return cb.fire('change'); });
    await Promise.all(ps); await flush();
    check('★★★★★★ 同一時間只有一個呼叫（排隊）', log.maxActive === 1, log.maxActive);
    const keys = log.calls.map((c) => c.payloads[0].serviceDate);
    check('★★★★★★ 三格都寫入（第一格撞鎖再試一次）', ['2099-01-01', '2099-01-02', '2099-01-03'].every((d) => keys.indexOf(d) !== -1)
      && log.calls.length === 4, JSON.stringify(keys));
    check('★★★★★ 次序：第一格寫完先到第二、三格', keys.join(',') === '2099-01-01,2099-01-01,2099-01-02,2099-01-03', keys.join(','));
    check('★★★★★ 三格保持已勾', cbs.every((cb) => cb.checked === true));
  }

  console.log('\n=== IA4：唔係撞鎖嘅錯誤 ===');
  {
    const { ui, log } = setup(() => new Error('發生了甚麼：工作表不見了'));
    const s = ui.buildDecisionSections({ names: [], rules: [rule(1)] }, {});
    const cb = boxesOf(ui, s)[0];
    cb.checked = true;
    await cb.fire('change'); await flush();
    check('★★★★★ 唔等、只叫一次', log.calls.length === 1 && log.waits === 0, JSON.stringify([log.calls.length, log.waits]));
    check('★★★★★ 還原', cb.checked === false);
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
