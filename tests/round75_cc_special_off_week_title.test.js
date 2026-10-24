// 第七十五輪批次 CC 組：特別主日完全拿走（`SPECIAL_SUNDAYS_ENABLED`，預設 FALSE）＋每週標題可以喺職事表直接改。
// 執行方式：node tests/round75_cc_special_off_week_title.test.js
//
//   CC1　關咗（預設）：生成唔讀 SpecialSundays——有 SkipPostIDs 嘅週照常排全部崗位
//   CC2　開季前準備清單冇「特別主日日期未確認」「合堂未指定跳過崗位」兩項
//   CC3　圖例冇「特殊主日」一行（冇特殊主日格時）
//   CC4　開返（TRUE）：舊行為照舊（嗰週嗰個崗位跳過）——工作表同資料冇刪
//   CC5　「類型」欄改咗 ⇒ 算一項改動（檢查我的改動、儲存、狀態卡未儲存數）
//   CC6　〔儲存〕⇒ 寫入 ServiceDates.Title、新一版顯示新標題、公開版標題索引有佢
//   CC7　改返預設 ⇒ Title 清空；只改標題都會建立新一版

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

function specialRow(sc) {
  const SS = sc.C.SPECIAL_SUNDAYS;
  return {
    [SS.SPECIAL_ID]: 'SP1', [SS.QUARTER_ID]: sc.Q, [SS.SERVICE_DATE]: sc.DATES[1],
    [SS.TYPE]: '合堂', [SS.TITLE]: '合堂', [SS.SKIP_POST_IDS]: 'CHAIR', [SS.ACTIVE]: 'TRUE',
    [SS.CONFIRMED]: 'FALSE'
  };
}
function typeCell(sc, versionNo, dateStr) {
  const sh = sc.gridSheet(versionNo);
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (sc.gas.toDateString(sh.getRange(r, 1).getValue(), sc.TZ) === dateStr) return { sh: sh, row: r };
  }
  return null;
}

console.log('\n=== CC1／CC2／CC3：預設關閉 ===');
{
  const sc = buildRound75Scene({ specialRows: [] });
  sc.appendRows(sc.ss, sc.S.SPECIAL_SUNDAYS, Object.keys(sc.C.SPECIAL_SUNDAYS).map((k) => sc.C.SPECIAL_SUNDAYS[k]), [specialRow(sc)]);
  const gas = sc.gas;
  check('（前置）SpecialSundays 有一行合堂（第 2 週跳過主席）', gas.readSheet(sc.S.SPECIAL_SUNDAYS).length === 1);
  check('★★★★★ 預設 isSpecialSundaysEnabled_() = false', gas.isSpecialSundaysEnabled_() === false);
  check('★★★★★★ readSpecialSundays() 回空（全部讀者共同入口）', gas.readSpecialSundays(sc.Q).length === 0);
  gas.apiGenerateDraftExecute(sc.Q);
  const chair = sc.cellRow(0, sc.DATES[1], 'CHAIR');
  check('★★★★★★ 第 2 週主席照常排咗人（冇因特別主日跳過）', chair && chair[sc.A.PERSON_ID], JSON.stringify(chair));
  check('★★★★★ 冇 HARD_SPECIAL_SUNDAY_SKIP 標記', !/SPECIAL_SUNDAY_SKIP/.test(String(chair[sc.A.RULE_FLAGS] || '')));
  const pq = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q));
  const ids = pq.items.map((i) => i.id);
  check('★★★★★★ 清單冇特別主日、合堂兩項', ids.indexOf('specialUnconfirmed') === -1 && ids.indexOf('combinedNoSkip') === -1, ids.join(','));
  check('★★★★ 講員／翻譯／獻花三項仍在', ['preacherEmpty', 'translationEmpty', 'flowerEmpty'].every((x) => ids.indexOf(x) !== -1));
  const layout = gas.buildGridLayout_(sc.Q, gas.readVersionAssignmentsForGrid_(sc.Q, 0));
  const legend = gas.buildLegendRows_(layout).map((r) => r[0]);
  check('★★★★★★ 圖例冇「特殊主日」一行', legend.indexOf(layout.labels.specialSkip) === -1, legend.join('|'));
  check('★★★★ 未確認特殊主日唔會提醒', gas.listUnconfirmedSpecialSundays_(sc.Q, sc.TZ).length === 0);
}

console.log('\n=== CC4：開返 TRUE ⇒ 舊行為 ===');
{
  const sc = buildRound75Scene({ config: { SPECIAL_SUNDAYS_ENABLED: ['TRUE', 'BOOL'] } });
  sc.appendRows(sc.ss, sc.S.SPECIAL_SUNDAYS, Object.keys(sc.C.SPECIAL_SUNDAYS).map((k) => sc.C.SPECIAL_SUNDAYS[k]), [specialRow(sc)]);
  const gas = sc.gas;
  gas.apiGenerateDraftExecute(sc.Q);
  const chair = sc.cellRow(0, sc.DATES[1], 'CHAIR');
  check('★★★★★ 開咗：第 2 週主席跳過（工作表同資料冇刪、仲用得返）',
    chair && !chair[sc.A.PERSON_ID] && /SPECIAL_SUNDAY_SKIP/.test(String(chair[sc.A.RULE_FLAGS] || '')), JSON.stringify(chair));
  const ids = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q)).items.map((i) => i.id);
  check('★★★★ 開咗：清單有特別主日一項', ids.indexOf('specialUnconfirmed') !== -1, ids.join(','));
}

console.log('\n=== CC5／CC6／CC7：每週標題 ===');
{
  const sc = buildRound75Scene();
  const gas = sc.gas;
  gas.apiGenerateDraftExecute(sc.Q);
  const pos = typeCell(sc, 0, sc.DATES[1]);
  check('（前置）第 2 週「類型」本來係「主日崇拜」', pos && pos.sh.getRange(pos.row, 3).getValue() === '主日崇拜');
  pos.sh.getRange(pos.row, 3).setValue('Baptism Service');

  const chk = gas.apiCheckMyChanges(sc.Q);
  const titleRow = (chk.changes || []).filter((c) => c.isTitle)[0];
  check('★★★★★★ 檢查我的改動：「你改了這 N 格」列出標題改動',
    titleRow && titleRow.fromName === '主日崇拜' && titleRow.toName === 'Baptism Service', JSON.stringify(chk.changes));
  const unsaved = gas.readDashboardUnsavedState_(sc.Q, 0);
  check('★★★★★ 狀態卡：算一格未儲存改動', unsaved.gridChangeCount === 1 && unsaved.hasAny === true, JSON.stringify(unsaved));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 儲存計劃：唔係零改動，gridChanges 有標題一行',
    plan.zeroChange === false && plan.gridChanges.some((g) => g.isTitle && g.manualName === 'Baptism Service'), JSON.stringify(plan.gridChanges));

  const res = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ 只改標題都會建立新一版', res.ok === true && res.versionNo === 1, JSON.stringify(res).slice(0, 300));
  const sd = gas.readServiceDates(sc.Q).filter((r) => gas.toDateString(r[sc.C.SERVICE_DATES.SERVICE_DATE], sc.TZ) === sc.DATES[1])[0];
  check('★★★★★★ ServiceDates.Title 寫咗', sd && sd[sc.C.SERVICE_DATES.TITLE] === 'Baptism Service', JSON.stringify(sd));
  const pos1 = typeCell(sc, 1, sc.DATES[1]);
  check('★★★★★★ 新一版「類型」顯示新標題', pos1 && pos1.sh.getRange(pos1.row, 3).getValue() === 'Baptism Service');
  check('★★★★★ 其他週照舊「主日崇拜」', typeCell(sc, 1, sc.DATES[0]).sh.getRange(typeCell(sc, 1, sc.DATES[0]).row, 3).getValue() === '主日崇拜');
  check('★★★★★ 公開版／個人頁嘅標題索引有佢', gas.buildDisplayTitleIndex_(sc.Q, sc.TZ)[sc.DATES[1]] === 'Baptism Service');
  check('★★★★★ 儲存後再檢查：冇改動', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
  check('★★★★ 儲存結果逐格明細有標題一行', (res.savedChanges || []).some((r) => r.isTitle));
  const audit = gas.readSheet(sc.S.AUDIT_LOG).filter((r) => r[sc.C.AUDIT_LOG.ACTION] === 'WEEK_TITLE_CHANGED');
  check('★★★★ AuditLog 有 WEEK_TITLE_CHANGED', audit.length === 1);

  // 改返預設
  pos1.sh.getRange(pos1.row, 3).setValue('主日崇拜');
  const res2 = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  const sd2 = gas.readServiceDates(sc.Q).filter((r) => gas.toDateString(r[sc.C.SERVICE_DATES.SERVICE_DATE], sc.TZ) === sc.DATES[1])[0];
  check('★★★★★★ 改返預設 ⇒ Title 清空', res2.versionNo === 2 && String(sd2[sc.C.SERVICE_DATES.TITLE] || '') === '', JSON.stringify(sd2));
  check('★★★★ 第 2 版顯示「主日崇拜」', typeCell(sc, 2, sc.DATES[1]).sh.getRange(typeCell(sc, 2, sc.DATES[1]).row, 3).getValue() === '主日崇拜');
}

console.log('\n=== CC：畫面冇〔確認特別主日〕 ===');
{
  const zone2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8');
  check('★★★★★★ 開季前準備冇〔確認特別主日〕掣', !/button\('確認特別主日'/.test(zone2));
  check('★★★★★ 彈窗程式碼都拿走', !/function openSpecialSundays\(/.test(zone2) && !/function openAnnualTool\(/.test(zone2));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
