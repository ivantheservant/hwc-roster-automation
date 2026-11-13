// 第一百零五輪批次 RG 組：〔上線前檢查〕加影音組合、協唱、指定寄信電郵人數；〔補建設定及範本〕建立兩張規則資料工作表
// 執行方式：node tests/round105_rg_prelaunch.test.js
// 下面用假 ID（P97xx）、example.invalid。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 1200));
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['AdminTools.gs', 'PersonIdFormat.gs', 'PreLaunchWeb.gs', 'GoLiveWizard.gs', 'ConfigSeed.gs', 'EmailTemplateSeed.gs',
    'EmailTemplateUpdate.gs', 'WebAppPersonalLink.gs', 'PersonalLinkInMail.gs', 'WebApp.gs', 'WebAppExclusions.gs', 'WebAppRoster3Common.gs',
    'PreseasonPack.gs', 'UnavailableSchedule.gs', 'PersonalUnavailable.gs', 'UnavailableInvite.gs', 'SendAudience.gs', 'RolloutAudience.gs', 'PreseasonChange.gs',
    'SeasonRehearsal.gs', 'CombinedSkipBackfill.gs', 'QuarterReset.gs', 'SelfTestRunner.gs', 'ManualEmail.gs'] });
  const g = sc.gas;
  g.Session = { getActiveUser: () => ({ getEmail: () => 'editor@example.invalid' }) };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) };
  g.ScriptApp = { getProjectTriggers: () => [] };
  return sc;
}
const item = (r, l) => r.items.filter((i) => i.label === l)[0];

console.log('\n=== RG1：上線前檢查 ===');
{
  const sc = scene();
  const g = sc.gas;
  let r = g.apiGetPreLaunchCheck();
  check('★★★★★★ 三項新項目都在，未填 ⇒ ✘ 並寫明去哪裏', ['影音組合（PostTeams）已填', '協唱（WorshipBackingSingers）已填', '指定寄信電郵（PreferredEmail）已填人數']
    .every((l) => item(r, l) && item(r, l).ok === false && item(r, l).where), JSON.stringify(r.items.slice(-8)));
  check('★★★★★ 工作表未建立 ⇒ 寫「沒有（工作表未建立或未填）」', /工作表未建立或未填/.test(item(r, '影音組合（PostTeams）已填').value));
  const titles = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  seedSheet(sc.ss, 'PostTeams', titles, g.postTeamsKeys_(), [
    { TeamID: 'AV', PersonID: 'P9701', PostIDs: 'SOUND,VIDEO', PerMonth: 1, OutsideTeamLevel: 'HARD', Notes: '', Active: true },
    { TeamID: 'AV', PersonID: 'P9702', PostIDs: 'PPT', PerMonth: 1, OutsideTeamLevel: 'SOFT', Notes: '', Active: true }]);
  seedSheet(sc.ss, 'WorshipBackingSingers', titles.slice(0, 6), g.worshipBackingSingersKeys_(), [
    { LeaderPersonID: 'P9703', SingerPersonID: 'P9704', SingerName: '', Level: 'HARD', Notes: '', Active: true }]);
  r = g.apiGetPreLaunchCheck();
  check('★★★★★★ 填了 ⇒ ✔，寫組數、人數', item(r, '影音組合（PostTeams）已填').ok && item(r, '影音組合（PostTeams）已填').value === '1 組、2 人'
    && item(r, '協唱（WorshipBackingSingers）已填').ok && item(r, '協唱（WorshipBackingSingers）已填').value === '1 位協唱',
  JSON.stringify([item(r, '影音組合（PostTeams）已填'), item(r, '協唱（WorshipBackingSingers）已填')]));
  check('★★★★★ 上線前檢查不寫名字（只寫數目）', JSON.stringify(r).indexOf('P9701') === -1);
  g.readPreferredEmailPersonIds_ = () => ({ P9701: true, P9702: true });
  r = g.apiGetPreLaunchCheck();
  check('★★★★★ 指定寄信電郵人數', item(r, '指定寄信電郵（PreferredEmail）已填人數').value === '2 人' && item(r, '指定寄信電郵（PreferredEmail）已填人數').ok);
}

console.log('\n=== RG2：〔補建設定及範本〕建立工作表 ===');
{
  const sc = scene();
  const g = sc.gas;
  const plan = g.apiPlanSeedConfigAndTemplates();
  check('★★★★★★ 比對列出未建立的 PostTeams、WorshipBackingSingers', plan.sheetsMissing.join() === 'PostTeams,WorshipBackingSingers', JSON.stringify(plan.sheetsMissing));
  const created = g.ensureRuleDataSheets_();
  check('★★★★★★ 建立兩張工作表，第 2 行是欄名', created.join() === 'PostTeams,WorshipBackingSingers'
    && sc.ss.getSheetByName('PostTeams').getRange(2, 1, 1, 7).getValues()[0].join() === 'TeamID,PersonID,PostIDs,PerMonth,OutsideTeamLevel,Notes,Active'
    && sc.ss.getSheetByName('WorshipBackingSingers').getRange(2, 1, 1, 6).getValues()[0].join() === 'LeaderPersonID,SingerPersonID,SingerName,Level,Notes,Active');
  sc.ss.getSheetByName('PostTeams').getRange(3, 1, 1, 3).setValues([['AV', 'P9701', 'SOUND']]);
  check('★★★★★ 再執行一次：不再建立、不改內容（可重複執行）', g.ensureRuleDataSheets_().length === 0
    && sc.ss.getSheetByName('PostTeams').getRange(3, 1, 1, 3).getValues()[0].join() === 'AV,P9701,SOUND'
    && g.apiPlanSeedConfigAndTemplates().sheetsMissing.length === 0);
}

console.log('\n=== RG3：週報說明 ===');
{
  const doc = read('docs/週報系統讀取職事表資料說明.md');
  check('★★★★★ 週報說明：聖餐襄禮 5 位、新工作表週報不用讀', /聖餐襄禮每次 5 位/.test(doc) && /PostTeams/.test(doc) && /WorshipBackingSingers/.test(doc)
    && /UnavailableReplies/.test(doc) && /週報不用讀/.test(doc));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
