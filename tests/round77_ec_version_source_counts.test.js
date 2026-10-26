// 第七十七輪批次 EC 組：版本來源分得出「人手」「系統」「人手＋系統」。
// 執行方式：node tests/round77_ec_version_source_counts.test.js
//
// Ivan（手動測試 B）：「有些修改是人手改完＋系統調整，可不可以在每一個版本反映是人手、系統還是兩者都有？」
//
//   EC1　〔儲存〕：只有人手 ⇒「人手改動 N 格」；數字存入 RosterVersions.ChangeCounts（經表頭名稱，舊表自動補欄）
//   EC2　接受建議：人手改 1 格＋系統改 1 格 ⇒「人手改動 1 格＋系統調整 1 格」（用建立建議表嗰陣記低嘅數字）
//   EC3　用舊版本作起點：「以第 K 版作起點」；之後再改嘅格先算人手 ⇒「＋人手改動 N 格」
//   EC4　純函式 buildVersionSourceText_()：重新生成／匯入／套用申報照現有文字（申報＋人手 ⇒ 加「＋人手改動 N 格」）；舊版本冇數字照舊
//   EC5　「人手調整後」呢個字眼全 src/ 唔再出現；版本下拉、狀態卡同一支

const fs = require('fs');
const path = require('path');
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
// 舊試算表冇 ChangeCounts 欄：先把 RosterVersions 重新種成 12 欄（冇 ChangeCounts），驗 registerVersion() 會自己補欄
{
  const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
  const oldKeys = Object.keys(V).filter((k) => k !== 'CHANGE_COUNTS').map((k) => V[k]);
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.ROSTER_VERSIONS));
  seedSheet(sc.ss, sc.S.ROSTER_VERSIONS, oldKeys.map(() => ''), oldKeys, []);
}
gas.apiGenerateDraftExecute(sc.Q);
const versionRow = (no) => gas.readSheet(sc.S.ROSTER_VERSIONS).filter((r) => r[V.QUARTER_ID] === sc.Q && Number(r[V.VERSION_NO]) === no)[0];
const sourceOf = (no) => gas.listQuarterVersionChoices_(sc.Q, sc.TZ).filter((v) => v.versionNo === no)[0].sourceText;
const others = (post, d, not) => ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => n !== not && n !== sc.getCell(0, d, post))[0];

console.log('\n=== EC1：〔儲存〕只有人手 ===');
{
  const chair0 = sc.getCell(0, D[0], 'CHAIR#1');
  sc.setCell(0, D[0], 'CHAIR#1', others('CHAIR#1', D[0], chair0));
  sc.setCell(0, D[3], 'CHAIR#1', others('CHAIR#1', D[3], sc.getCell(0, D[3], 'CHAIR#1')));
  const r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 1 版', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 來源：「人手改動 2 格」', sourceOf(1) === '人手改動 2 格', sourceOf(1));
  const row = versionRow(1);
  check('★★★★★ RosterVersions.ChangeCounts＝manual=2;system=0;start=（經表頭名稱寫入，舊表自動補欄）',
    row && row[V.CHANGE_COUNTS] === 'manual=2;system=0;start=', JSON.stringify(row));
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 狀態卡同一句', dash.latestVersion.basisText === '人手改動 2 格', dash.latestVersion.basisText);
  const headers = sc.ss.getSheetByName(sc.S.ROSTER_VERSIONS).getRange(1, 1, 2, sc.ss.getSheetByName(sc.S.ROSTER_VERSIONS).getLastColumn()).getValues();
  check('★★★★ 補咗欄：第 1 行中文標題「改動格數」、第 2 行機器鍵', headers[0].indexOf('改動格數') !== -1 && headers[1].indexOf(V.CHANGE_COUNTS) === headers[0].indexOf('改動格數'), JSON.stringify(headers));
  check('★★★★ 第 0 版（系統生成）冇數字 ⇒ 照舊「系統生成」', sourceOf(0) === '系統生成', sourceOf(0));
}

console.log('\n=== EC2：接受建議 ⇒ 人手＋系統 ===');
{
  // 人手改 1 格（第 1 週讀經換人）＋ 製造一個系統要改嘅違反（第 4 週領詩填一個唔喺領詩名單嘅人）
  const read1 = sc.getCell(1, D[0], 'READ#1');
  sc.setCell(1, D[0], 'READ#1', others('READ#1', D[0], read1));
  sc.setCell(1, D[3], 'WORSHIP#1', sc.nameOf('P9704'));
  const sug = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（準備）建議表：人手 2 格、系統 ≥1 格', sug.ok === true && sug.manualCount === 2 && sug.systemCount >= 1, JSON.stringify(sug).slice(0, 400));
  const acc = gas.apiAcceptSuggestion(sc.Q);
  check('（準備）第 2 版', acc.ok === true && acc.versionNo === 2, JSON.stringify(acc).slice(0, 300));
  const expected = '人手改動 2 格＋系統調整 ' + sug.systemCount + ' 格';
  check('★★★★★★ 來源：「' + expected + '」', sourceOf(2) === expected, sourceOf(2));
  const row = versionRow(2);
  check('★★★★★ ChangeCounts 記低兩邊', row && row[V.CHANGE_COUNTS] === 'manual=2;system=' + sug.systemCount + ';start=', JSON.stringify(row));
  const zone4 = gas.apiListRecentVersions ? null : null;   // 進階與診斷清單同一支（EC5 用原始碼驗）
  check('★★★★ 進階與診斷嘅版本清單經 buildVersionSourceText_()', /buildVersionSourceText_\(v\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppZone4.gs'), 'utf8')));
}

console.log('\n=== EC3：用舊版本作起點 ===');
{
  gas.apiUseVersionAsStartPoint(sc.Q, 0);
  let r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 3 版', r && r.versionNo === 3, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 只係用第 0 版作起點、冇再改 ⇒「以第 0 版作起點」（起點寫入嗰啲格唔算人手改動）', sourceOf(3) === '以第 0 版作起點', sourceOf(3));

  gas.apiUseVersionAsStartPoint(sc.Q, 1);
  sc.setCell(3, D[2], 'CHAIR#1', others('CHAIR#1', D[2], sc.getCell(3, D[2], 'CHAIR#1')));
  r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 4 版', r && r.versionNo === 4, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 用第 1 版作起點再改 1 格 ⇒「以第 1 版作起點＋人手改動 1 格」', sourceOf(4) === '以第 1 版作起點＋人手改動 1 格', sourceOf(4));
  const row = versionRow(4);
  check('★★★★★ ChangeCounts：manual=1;system=0;start=1', row && row[V.CHANGE_COUNTS] === 'manual=1;system=0;start=1', JSON.stringify(row));
}

console.log('\n=== EC4：純函式 ===');
{
  const t = (basis, parent, counts) => gas.buildVersionSourceText_({ [V.BASIS]: basis, [V.PARENT_VERSION_NO]: parent, [V.CHANGE_COUNTS]: counts });
  check('★★★★★ 重新生成照舊（即使有數字）', t('AUTO_GENERATE', 2, 'manual=3;system=0;start=') === '重新生成');
  check('★★★★★ 系統生成（第一版）照舊', t('AUTO_GENERATE', '', '') === '系統生成');
  check('★★★★★ 匯入照舊', t('IMPORT', '', '') === '由人手職事表匯入');
  check('★★★★★ 套用申報＋人手改動 2 格 ⇒「套用修改申報後＋人手改動 2 格」', t('REQUESTS_APPLIED', 1, 'manual=2;system=0;start=') === '套用修改申報後＋人手改動 2 格', t('REQUESTS_APPLIED', 1, 'manual=2;system=0;start='));
  check('★★★★★ 套用申報、冇人手改動 ⇒ 照舊', t('REQUESTS_APPLIED', 1, 'manual=0;system=0;start=') === '套用修改申報後');
  check('★★★★★ 只有系統 ⇒「系統調整 3 格」', t('SUGGESTION', 1, 'manual=0;system=3;start=') === '系統調整 3 格');
  check('★★★★★ 舊版本冇數字 ⇒ 照現有文字，唔猜', t('FINE_TUNE', 1, '') === '人手改動' && t('SUGGESTION', 1, '') === '系統調整');
  check('★★★★ 認唔出嘅 ChangeCounts ⇒ 當冇', gas.parseVersionChangeCounts_('垃圾') === null && gas.parseVersionChangeCounts_('start=2') === null);
  check('★★★★ 格式化／解析對稱', gas.parseVersionChangeCounts_(gas.formatVersionChangeCounts_({ manual: 1, system: 2, startPoint: 3 })).startPoint === 3
    && gas.formatVersionChangeCounts_(null) === '');
}

console.log('\n=== EC5：字眼 ===');
{
  const srcDir = path.join(__dirname, '..', 'src');
  const hits = [];
  const walk = (dir) => fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (/人手調整後/.test(fs.readFileSync(p, 'utf8'))) hits.push(f);
  });
  walk(srcDir);
  check('★★★★★ 全 src/ 冇「人手調整後」', hits.length === 0, JSON.stringify(hits));
  check('★★★★ 版本下拉（describeVersionSource_）同狀態卡用同一支 buildVersionSourceText_()',
    /return buildVersionSourceText_\(row\);/.test(fs.readFileSync(path.join(srcDir, 'WebAppRollback.gs'), 'utf8'))
    && /basisText: row \? buildVersionSourceText_\(row\)/.test(fs.readFileSync(path.join(srcDir, 'WebAppDashboard.gs'), 'utf8')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
