// 第七十八輪批次 FC 組：「類型（每週標題）」嘅人手改動，接受建議時要帶入新版本。
// 執行方式：node tests/round78_fc_title_on_accept.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十七輪回歸 G9／G10）
// ═════════════════════════════════════════════════════════════════════
//
//   第 2 週「類型」由 `主日崇拜` 改成 `Baptism Service`：
//   〔檢查我的改動〕「你改了這 5 格」**包括**類型；〔請系統幫我調整〕→〔接受它〕後
//   儲存完成窗只寫「這一次儲存了這 4 格」，第 1 版類型返返 `主日崇拜`，
//   版本來源「人手改動 4 格＋系統調整 1 格」——類型嗰格靜靜丟咗。
//
//   FC1　接受建議：類型寫入新版本（新表、ServiceDates.Title）；完成窗列出類型嗰一行
//   FC2　人手格數包括類型，同〔檢查我的改動〕「你改了這 N 格」一致
//   FC3　建議表上另外改嘅類型以建議表為準
//   FC4　〔儲存〕嗰條路人手格數都包括類型

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs', 'WebAppZone4.gs'] });
const gas = sc.gas;
const D = sc.DATES;
const V = sc.C.ROSTER_VERSIONS;
gas.apiGenerateDraftExecute(sc.Q);
const others = (v, post, d) => ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf)
  .filter((n) => n !== sc.getCell(v, d, post))[0];
const sourceOf = (no) => gas.listQuarterVersionChoices_(sc.Q, sc.TZ).filter((v) => v.versionNo === no)[0].sourceText;
const versionRow = (no) => gas.readSheet(sc.S.ROSTER_VERSIONS)
  .filter((r) => r[V.QUARTER_ID] === sc.Q && Number(r[V.VERSION_NO]) === no)[0];
const serviceDateTitle = (d) => {
  const SD = sc.C.SERVICE_DATES;
  const row = gas.readSheet(sc.S.SERVICE_DATES).filter((r) => gas.toDateString(r[SD.SERVICE_DATE], sc.TZ) === d)[0];
  return row ? String(row[SD.TITLE] || '') : null;
};
/** 建議表上改一格（建議表頂有圖例，機器鍵唔喺第 2 行） */
function setSuggestionCell(versionNo, dateStr, key, value) {
  const sh = sc.ss.getSheetByName(gas.buildSuggestionSheetName_(sc.Q, versionNo));
  const all = sh.getDataRange().getValues();
  const keyRow = all.findIndex((r) => r.some((v) => String(v).indexOf('#') !== -1));
  const col = all[keyRow].indexOf(key);
  const row = all.findIndex((r, i) => i > keyRow && gas.toDateString(r[0], sc.TZ) === dateStr);
  sh.getRange(row + 1, col + 1).setValue(value);
}

console.log('\n=== FC1／FC2【核心】接受建議：類型帶入新版本，人手格數包括類型 ===');
const v0Title = sc.getCell(0, D[1], '_TYPE');
{
  sc.setCell(0, D[1], '_TYPE', 'Baptism Service');
  sc.setCell(0, D[0], 'READ#1', others(0, 'READ#1', D[0]));
  sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf('P9704'));   // 系統要改嘅違反
  const chk = gas.apiCheckMyChanges(sc.Q);
  const titleRow = chk.changes.filter((c) => c.isTitle)[0];
  check('（準備）〔檢查我的改動〕列出類型嗰一格', titleRow && titleRow.toName === 'Baptism Service', JSON.stringify(chk.changes));
  const checkCount = chk.changes.length;
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（準備）建議表：系統 ≥1 格', sug.ok === true && sug.systemCount >= 1, JSON.stringify(sug).slice(0, 300));
  const acc = gas.apiAcceptSuggestion(sc.Q);
  check('（準備）第 1 版建立', acc.ok === true && acc.versionNo === 1, JSON.stringify(acc).slice(0, 300));
  check('★★★★★★ 第 1 版嗰張表第 2 週類型＝Baptism Service', sc.getCell(1, D[1], '_TYPE') === 'Baptism Service',
    sc.getCell(1, D[1], '_TYPE'));
  check('★★★★★★ ServiceDates.Title 寫咗（公開職事表、PDF 讀呢度）', serviceDateTitle(D[1]) === 'Baptism Service',
    serviceDateTitle(D[1]));
  const doneTitle = (acc.savedChanges || []).filter((c) => c.isTitle)[0];
  check('★★★★★★ 完成窗列出類型嗰一行（原本 → Baptism Service）', doneTitle && doneTitle.toName === 'Baptism Service'
    && doneTitle.fromName === v0Title, JSON.stringify(acc.savedChanges));
  check('★★★★★ 完成窗格數包括類型', acc.cellCount === (acc.savedChanges || []).length && /格改動/.test(acc.message),
    JSON.stringify([acc.cellCount, acc.message]));
  const manualCells = chk.changes.filter((c) => !c.isTitle).length;
  check('★★★★★★ 版本來源人手格數＝〔檢查我的改動〕「你改了這 N 格」（包括類型）',
    sourceOf(1) === '人手改動 ' + checkCount + ' 格＋系統調整 ' + sug.systemCount + ' 格'
      && checkCount === manualCells + 1, sourceOf(1) + ' / check=' + checkCount);
  check('★★★★★ ChangeCounts 記低', versionRow(1)[V.CHANGE_COUNTS] === 'manual=' + checkCount + ';system=' + sug.systemCount + ';start=',
    versionRow(1)[V.CHANGE_COUNTS]);
  check('★★★★★ 第 0 版嗰張表類型還原（FB）', sc.getCell(0, D[1], '_TYPE') === v0Title, sc.getCell(0, D[1], '_TYPE'));
}

console.log('\n=== FC3：建議表上另外改嘅類型以建議表為準 ===');
{
  sc.setCell(1, D[2], '_TYPE', '正式表寫的');
  sc.setCell(1, D[0], 'CHAIR#1', others(1, 'CHAIR#1', D[0]));
  sc.setCell(1, D[3], 'WORSHIP#1', sc.nameOf('P9704'));
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（準備）建議表建立', sug.ok === true, JSON.stringify(sug).slice(0, 300));
  setSuggestionCell(1, D[2], '_TYPE', 'Holy Communion');
  setSuggestionCell(1, D[3], '_TYPE', '建議表另改');
  const acc = gas.apiAcceptSuggestion(sc.Q);
  check('（準備）第 2 版建立', acc.ok === true && acc.versionNo === 2, JSON.stringify(acc).slice(0, 300));
  check('★★★★★★ 同一週兩邊都改 ⇒ 以建議表為準', sc.getCell(2, D[2], '_TYPE') === 'Holy Communion', sc.getCell(2, D[2], '_TYPE'));
  check('★★★★★ 只喺建議表改嘅一週都帶入', sc.getCell(2, D[3], '_TYPE') === '建議表另改', sc.getCell(2, D[3], '_TYPE'));
  check('★★★★ 完成窗兩行類型', (acc.savedChanges || []).filter((c) => c.isTitle).length === 2, JSON.stringify(acc.savedChanges));
}

console.log('\n=== FC4：〔儲存〕嗰條路人手格數都包括類型 ===');
{
  sc.setCell(2, D[0], '_TYPE', '只改類型');
  const r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 3 版建立', r && r.versionNo === 3, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 只改類型 ⇒ 來源「人手改動 1 格」', sourceOf(3) === '人手改動 1 格', sourceOf(3));
  sc.setCell(3, D[1], '_TYPE', '再改類型');
  sc.setCell(3, D[2], 'CHAIR#1', others(3, 'CHAIR#1', D[2]));
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★ 一格＋類型 ⇒「人手改動 2 格」', sourceOf(4) === '人手改動 2 格', sourceOf(4));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
