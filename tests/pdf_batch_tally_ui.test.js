// 第六十六輪批次 AC＋AD 組前端：「先產生 PDF」完成窗——失敗唔可以出綠色；數字係整次操作嘅累計。
// 執行方式：node tests/pdf_batch_tally_ui.test.js
//
// 現場：
//   AC　個人 PDF 有一份失敗，完成窗照寫「已完成 N / N 位、新產生 N 份」（綠色）。
//   AD　補寄先產生 PDF，開頭「48 位還沒有第 4 版的個人 PDF」，約 8.5 分鐘後完成窗寫
//       「已完成 23 / 23 位。新產生 23 份」——指定人版每次接駁都重新計「還差誰」，
//       前端顯示最後一次回傳嘅數字。
//
// 呢一份**真嘅執行**前端（ui_loader），驗嘅係「真正畫咗乜出嚟」。
// 下面用假 ID（P98xx）。

const fs = require('fs');
const path = require('path');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function freshUi() {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone4.html']);
  // `runPdfBatchToCompletion()` 自己冇 return runAction 嘅 promise，所以記低佢，俾測試等
  ui.runAction = function (_label, fn) { ui.__p = fn(); return ui.__p; };
  ui.setStatus = function () {};
  return ui;
}
const modalOf = (ui) => ({
  title: ui.document.getElementById('modalTitle').textContent,
  body: ui.document.getElementById('modalBody').textContent,
  bodyNodes: ui.document.getElementById('modalBody').children,
  actions: ui.document.getElementById('modalActions').children.map((b) => b.textContent)
});
const hasClass = (node, cls) => !!node && String(node.className || '').split(/\s+/).indexOf(cls) !== -1
  || (node && node.children || []).some((c) => hasClass(c, cls));

// 一輪回傳
const ids = (from, n) => Array.from({ length: n }, (_, i) => 'P98' + String(from + i).padStart(2, '0'));
const round = (o) => Object.assign({ ok: true, errors: [], skippedExistingCount: 0, callSkippedCount: 0 }, o);

// =====================================================================
console.log('\n=== AD【核心】分三輪做完 48 份 ⇒ 完成窗講 48（唔係最後一輪嘅 8）===');
{
  const ui = freshUi();
  const rounds = [
    round({ done: false, totalPeople: 48, doneCount: 20, generatedCount: 20, callGeneratedCount: 20, attemptedIds: ids(1, 20) }),
    round({ done: false, totalPeople: 28, doneCount: 20, generatedCount: 20, callGeneratedCount: 20, attemptedIds: ids(21, 20) }),
    round({ done: true, totalPeople: 8, doneCount: 8, generatedCount: 8, callGeneratedCount: 8, attemptedIds: ids(41, 8) })
  ];
  let n = 0;
  let continued = false;
  let backed = false;
  (async function () {
    ui.runPdfBatchToCompletion({
      callBatch: async () => rounds[n++],
      onContinue: () => { continued = true; },
      doneText: '現在可以回到補寄確認。', backLabel: '回到補寄確認', onBack: () => { backed = true; }
    });
    await ui.__p;
    const m = modalOf(ui);
    check('★★★★★★ 「已完成 48 / 48 位」（唔係 8 / 8）', /已完成 48 \/ 48 位/.test(m.body), m.body);
    check('★★★★★★ 「新產生 48 份」', /新產生 48 份/.test(m.body), m.body);
    check('★★★★ 有〔回到補寄確認〕', m.actions.indexOf('回到補寄確認') !== -1, m.actions.join());
    check('★★★★ 接駁咗 3 輪', n === 3);

    // ── AC：最後一輪有 1 份失敗 ──
    const ui2 = freshUi();
    const r2 = [
      round({ done: false, totalPeople: 48, doneCount: 20, generatedCount: 20, callGeneratedCount: 20, attemptedIds: ids(1, 20) }),
      round({ done: true, totalPeople: 28, doneCount: 28, generatedCount: 27, callGeneratedCount: 27, attemptedIds: ids(21, 28),
        errors: [{ personId: 'P9830', nameTC: '姓30', message: '匯出暫時出錯' }] })
    ];
    let k = 0;
    let cont2 = 0;
    ui2.runPdfBatchToCompletion({
      callBatch: async () => r2[k++],
      onContinue: () => { cont2++; },
      doneText: '現在可以回到補寄確認。', backLabel: '回到補寄確認', onBack: () => {}
    });
    await ui2.__p;
    const f = modalOf(ui2);
    check('★★★★★★ 有失敗 ⇒ 標題講失敗份數（唔係「已經產生好」）', /有 1 份沒有產生好/.test(f.title) && !/已經產生好/.test(f.title), f.title);
    check('★★★★★★ 「已產生 47 份，1 份失敗：姓30」', /已產生 47 份，1 份失敗：姓30/.test(f.body), f.body);
    check('★★★★★★ 唔可以出「已完成 N / N」', !/已完成/.test(f.body), f.body);
    check('★★★★★★ 唔出綠色（冇 ok-line）', !hasClass({ children: f.bodyNodes }, 'ok-line'));
    check('★★★★★★ 有〔再試失敗的 1 份〕', f.actions.indexOf('再試失敗的 1 份') !== -1, f.actions.join());
    check('★★★★★ 失敗嗰次冇〔回到補寄確認〕（唔准行返轉頭去寄）', f.actions.indexOf('回到補寄確認') === -1, f.actions.join());
    check('★★★★ 訊息喺技術細節（唔係主文）', /匯出暫時出錯/.test(f.body));

    // ── AD：失敗嗰位下一輪再試成功 ⇒ 失敗清走 ──
    const ui3 = freshUi();
    const r3 = [
      round({ done: false, totalPeople: 10, doneCount: 5, generatedCount: 4, callGeneratedCount: 4, attemptedIds: ids(1, 5),
        errors: [{ personId: 'P9803', nameTC: '姓03', message: 'x' }] }),
      round({ done: true, totalPeople: 6, doneCount: 6, generatedCount: 6, callGeneratedCount: 6, attemptedIds: ['P9803'].concat(ids(6, 5)) })
    ];
    let j = 0;
    ui3.runPdfBatchToCompletion({
      callBatch: async () => r3[j++], onContinue: () => {}, doneText: '', backLabel: '返', onBack: () => {}
    });
    await ui3.__p;
    const g = modalOf(ui3);
    check('★★★★★ 之前失敗、下一輪再試成功 ⇒ 唔再算失敗（已完成 10 / 10）', /已完成 10 \/ 10 位/.test(g.body) && !/失敗/.test(g.title), g.title + g.body);

    // ── 未做完 ──
    const ui4 = freshUi();
    const r4 = Array.from({ length: 41 }, () => round({ done: false, totalPeople: 100, doneCount: 1, generatedCount: 1, callGeneratedCount: 1, attemptedIds: ['P9801'] }));
    let q = 0;
    ui4.runPdfBatchToCompletion({ callBatch: async () => r4[q++], onContinue: () => {}, doneText: '', backLabel: '返', onBack: () => {} });
    await ui4.__p;
    const h = modalOf(ui4);
    check('★★★★ 做唔完 ⇒ 講仲差幾多，畀〔繼續產生〕', /還差 60 份/.test(h.body) && h.actions.indexOf('繼續產生') !== -1, h.body + h.actions);

    // ── 純函式：describePdfBatchOutcome_ ──
    const t = ui.newPdfBatchTally_();
    ui.addPdfBatchResult_(t, round({ done: true, totalPeople: 3, generatedCount: 2, callGeneratedCount: 2, attemptedIds: ids(1, 3),
      errors: [{ personId: 'P9802', nameTC: '姓02', message: 'm' }] }));
    const o = ui.describePdfBatchOutcome_(t, true, '');
    check('★★★★ describePdfBatchOutcome_：kind ＝ FAILED、failedCount ＝ 1', o.kind === 'FAILED' && o.failedCount === 1, JSON.stringify([o.kind, o.failedCount]));

    // ── 另外三個流程都經同一個顯示 ──
    const z1 = read('src/ui/ScriptZone1.html');
    const z4 = read('src/ui/ScriptZone4.html');
    check('★★★★★ 正式發出（runMissingPdfBatch）、補寄（runMakeupPdfBatch）行同一支 runPdfBatchToCompletion()',
      /function runMissingPdfBatch[\s\S]{0,200}runPdfBatchToCompletion\(/.test(z1)
        && /function runMakeupPdfBatch[\s\S]{0,200}runPdfBatchToCompletion\(/.test(z4));
    check('★★★★★ 「進階與診斷 ▸ 產生個人 PDF」用 describePdfBatchOutcome_()', /describePdfBatchOutcome_\(tally, true/.test(z4));
    check('★★★★★★ 改動後重發：有失敗 ⇒ 唔照寄（先 return 先叫 apiStep5SendConfirm）',
      /pdfOutcome\.kind === 'FAILED'[\s\S]{0,900}return;[\s\S]*apiStep5SendConfirm/.test(z1));
    check('★★★★ 改動後重發失敗窗有〔再試失敗的 N 份〕', /'再試失敗的 ' \+ pdfOutcome\.failedCount/.test(z1));

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
    process.exit(fail === 0 ? 0 : 1);
  })().catch(function (e) { console.log('FAIL  crashed: ' + e.stack); process.exit(1); });
}
