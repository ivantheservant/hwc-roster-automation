// 第一百零五輪批次 RE 組：崗位人數增加（聖餐襄禮每次 4 位 → 5 位，Posts.SlotCount）。
// 執行方式：node tests/round105_re_slot_count.test.js
//
// 崗位人數全部由 Posts.SlotCount 決定（沒有寫死 4）。要鎖住的是「人數增加之後」：
//   RE1 生成：新的人數全部排滿，而且同一週不重複（DistinctWithinPost）
//   RE2 職事表工作表有新的一欄（例如 READ#2）
//   RE3 舊版本（人數增加之前生成，只有舊的格數）：工作表新的一格填了名字 ⇒ 當人手改動（以前會靜靜忽略）；
//       空白的不加；序號超過 SlotCount、不認識的崗位或日子不加
//   RE4 輸出版面：每個名額一行（人數增加 ⇒ 行數增加）
// 用 round75 場景的讀經（READ）代替聖餐襄禮（每次 1 位 → 2 位），假名、P97xx。

const { buildRound75Scene } = require('./helpers/round75_harness.js');


let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}

function setSlotCount(sc, postId, n) {
  const sh = sc.ss.getSheetByName(sc.S.POSTS);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = keys.indexOf(sc.C.POSTS.POST_ID) + 1;
  const col = keys.indexOf(sc.C.POSTS.SLOT_COUNT) + 1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, idCol).getValue() === postId) { sh.getRange(r, col).setValue(n); return true; }
  }
  return false;
}

console.log('\n=== RE1／RE2：人數增加之後生成 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const g = sc.gas;
  check('（前置）READ 改為每次 2 位', setSlotCount(sc, 'READ', 2));
  g.apiGenerateDraftExecute(sc.Q);
  const reads = sc.rows(0).filter((r) => r[sc.A.POST_ID] === 'READ');
  const byDate = {};
  reads.forEach((r) => {
    const d = g.toDateString_(r[sc.A.SERVICE_DATE], sc.TZ);
    (byDate[d] = byDate[d] || []).push(r);
  });
  const dates = Object.keys(byDate);
  check('★★★★★★ 每週 2 格', dates.length === sc.DATES.length && dates.every((d) => byDate[d].length === 2), JSON.stringify(dates.map((d) => byDate[d].length)));
  const filled = dates.filter((d) => byDate[d].every((r) => r[sc.A.PERSON_ID]));
  check('★★★★★ 有人的週同一週兩格不同人', filled.length > 0 && filled.every((d) => byDate[d][0][sc.A.PERSON_ID] !== byDate[d][1][sc.A.PERSON_ID]),
    JSON.stringify(filled.map((d) => byDate[d].map((r) => r[sc.A.PERSON_ID]))));
  check('★★★★★★ 工作表有 READ#2 一欄', sc.getCell(0, sc.DATES[0], 'READ#2') !== null);
}

console.log('\n=== RE3：舊版本只有舊的格數 ===');
{
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  setSlotCount(sc, 'READ', 2);
  const ctx = g.buildFineTuneContext_(sc.Q, 0);
  check('（前置）上一版沒有 READ 第 2 格', !ctx.original.some((a) => a.postId === 'READ' && a.slotIndex === 2));
  const D = sc.DATES;
  ctx.gridValues[D[0] + '|READ|2'] = sc.nameOf('P9701');   // 新的一格填了名字
  ctx.gridValues[D[1] + '|READ|2'] = '';                    // 空白
  ctx.gridValues[D[2] + '|READ|3'] = sc.nameOf('P9702');   // 超過 SlotCount
  ctx.gridValues[D[2] + '|NOPOST|1'] = sc.nameOf('P9702'); // 不認識的崗位
  ctx.gridValues['2099-12-31|READ|2'] = sc.nameOf('P9702'); // 不認識的日子
  const o = g.buildGridOverlayState_(ctx);
  const ch = o.changes.filter((c) => c.postId === 'READ' && c.slotIndex === 2);
  check('★★★★★★ 新的一格填了名字 ⇒ 當人手改動', ch.length === 1 && ch[0].serviceDate === D[0] && ch[0].manualPersonId === 'P9701', JSON.stringify(o.changes));
  check('★★★★★★ 狀態多了這一格（人手）', o.manualState.some((s) => s.serviceDate === D[0] && s.postId === 'READ' && s.slotIndex === 2 && s.personId === 'P9701' && s.isManual));
  check('★★★★★ 空白的不加', !o.manualState.some((s) => s.serviceDate === D[1] && s.postId === 'READ' && s.slotIndex === 2));
  check('★★★★★ 超過 SlotCount、不認識的崗位或日子不加', !o.manualState.some((s) => s.slotIndex === 3 || s.postId === 'NOPOST' || s.serviceDate === '2099-12-31'));
  check('★★★★ 原本的格數不變（只多 1 格）', o.manualState.length === ctx.original.length + 1);
}

console.log('\n=== RE4：輸出版面每個名額一行 ===');
{

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'RosterOutput.gs'), 'utf8');
  check('★★★★★ 行數按 SlotCount 計（Math.max(1, slotCount)）', /postRowCount \+= Math\.max\(1, Number\(p\.slotCount\) \|\| 1\)/.test(src)
    && /for \(let slot = 1; slot <= slotCount; slot\+\+\)/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
