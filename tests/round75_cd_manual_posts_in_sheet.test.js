// 第七十五輪批次 CD 組：講員／翻譯／獻花直接喺職事表填（〔填講員／翻譯／獻花〕拿走）。
// 執行方式：node tests/round75_cd_manual_posts_in_sheet.test.js
//
// Ivan 手動測試 A：生成前撳〔填講員／翻譯／獻花〕出「找不到已生成的版本」，好混亂；
// 「統一喺〔查看／修改職事表〕加或者改，盡量減少掣」。
//
//   CD1　未通知過人嘅版本（初稿）喺職事表改人手崗位 ⇒〔儲存〕偵測得到（BC 組嘅限制拿走）
//   CD2　名字喺 NameMapping ⇒ 新一版連 PersonID；唔喺（外請講員）⇒ 照收名字、唔算違反、唔使確認
//   CD3　人手崗位都有名單選單，而且 allowInvalid（只警告、唔拒絕）
//   CD4　開季前準備「未填」照最新職事表工作表計，提示「生成之後在職事表直接填」
//   CD5　畫面冇〔填講員／翻譯／獻花〕、冇 BC 組提示句

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

const sc = buildRound75Scene();
const gas = sc.gas;
const A = sc.A;
gas.apiGenerateDraftExecute(sc.Q);

console.log('\n=== CD4（前）：生成後未填 ===');
{
  const pq = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q));
  const flower = pq.items.filter((i) => i.id === 'flowerEmpty')[0];
  const preach = pq.items.filter((i) => i.id === 'preacherEmpty')[0];
  check('（前置）找到講員／獻花兩項', flower && preach, JSON.stringify(pq.items));
}

console.log('\n=== CD1／CD2：初稿喺職事表直接填 ===');
sc.setCell(0, sc.DATES[0], 'FLOWER#1', sc.nameOf('P9703'));   // 名單上嘅會友
sc.setCell(0, sc.DATES[0], 'PREACH#1', 'Rev Wong');            // 外請講員（唔喺 NameMapping）
{
  const chk = gas.apiCheckMyChanges(sc.Q);
  check('★★★★★★ 檢查我的改動：兩格都列出（未通知過人嘅版本都偵測得到）', chk.changes.length === 2, JSON.stringify(chk.changes));
  check('★★★★★★ 外請講員唔算「認不出」', chk.unresolved.length === 0, JSON.stringify(chk.unresolved));
  check('★★★★★ 兩格都唔算違反', chk.violations.length === 0, JSON.stringify(chk.violations));
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ 儲存計劃：唔擋、唔使放行、唔係零改動',
    plan.blocked === false && plan.needsRelease === false && plan.zeroChange === false && plan.gridChanges.length === 2,
    JSON.stringify(plan).slice(0, 400));
  const res = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ 儲存成第 1 版', res.ok && res.versionNo === 1, JSON.stringify(res).slice(0, 300));
  const flower = sc.cellRow(1, sc.DATES[0], 'FLOWER');
  const preach = sc.cellRow(1, sc.DATES[0], 'PREACH');
  check('★★★★★★ 名單上嘅會友 ⇒ 新一版連 PersonID（正式發出時會收到通知）',
    flower[A.PERSON_ID] === 'P9703' && flower[A.ASSIGN_SOURCE] === 'MANUAL', JSON.stringify(flower));
  check('★★★★★★ 外請講員 ⇒ 只存名字、冇 PersonID、來源 MANUAL',
    !preach[A.PERSON_ID] && preach[A.PERSON_NAME_SNAPSHOT] === 'Rev Wong' && preach[A.ASSIGN_SOURCE] === 'MANUAL', JSON.stringify(preach));
  check('★★★★★ 新一版職事表照樣顯示「Rev Wong」', sc.getCell(1, sc.DATES[0], 'PREACH#1') === 'Rev Wong');
  check('★★★★ 儲存後再檢查：冇改動', gas.apiSaveAndConfirmPlan(sc.Q).zeroChange === true);
}

console.log('\n=== CD1：之後再改（任何階段）都偵測到 ===');
{
  sc.setCell(1, sc.DATES[1], 'FLOWER#1', 'Helena');
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★ 再改一格獻花（名單以外）⇒ 偵測到、唔擋',
    plan.blocked === false && plan.gridChanges.length === 1 && plan.gridChanges[0].manualName === 'Helena', JSON.stringify(plan.gridChanges));
  sc.setCell(1, sc.DATES[1], 'FLOWER#1', '');
}

console.log('\n=== CD4：未填照職事表工作表計 ===');
{
  const pq = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q));
  const flower = pq.items.filter((i) => i.id === 'flowerEmpty')[0];
  const preach = pq.items.filter((i) => i.id === 'preacherEmpty')[0];
  check('★★★★★★ 獻花未填 = 4 − 1 = 3', flower.count === 3, JSON.stringify(flower));
  check('★★★★★★ 講員未填 = 3（外請講員都算填咗）', preach.count === 3, JSON.stringify(preach));
  check('★★★★★ 提示「生成之後在職事表直接填」', flower.hint === '生成之後在職事表直接填');
  // 喺工作表填咗但未儲存 ⇒ 都已經計入（照工作表計）
  sc.setCell(1, sc.DATES[2], 'FLOWER#1', sc.nameOf('P9701'));
  const after = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q)).items.filter((i) => i.id === 'flowerEmpty')[0];
  check('★★★★★ 工作表上填咗（未儲存）都即刻計入：3 → 2', after.count === 2, JSON.stringify(after));
  // 工作表上清走一格（未儲存）⇒ 即刻當未填
  sc.setCell(1, sc.DATES[0], 'FLOWER#1', '');
  const after2 = gas.planPreQuarterChecklist_(gas.buildPreQuarterChecklistInputs_(sc.Q)).items.filter((i) => i.id === 'flowerEmpty')[0];
  check('★★★★ 工作表上清走 ⇒ 2 → 3', after2.count === 3, JSON.stringify(after2));
}

console.log('\n=== CD3：人手崗位都有名單選單（allowInvalid）===');
{
  const sh = sc.gridSheet(1);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const flowerCol = keys.indexOf('FLOWER#1') + 1;
  const rule = sh.getRange(3, flowerCol).getDataValidation && sh.getRange(3, flowerCol).getDataValidation();
  check('★★★★★★ 獻花欄有選單', rule && Array.isArray(rule.list) && rule.list.indexOf(sc.nameOf('P9701')) !== -1, JSON.stringify(rule));
  check('★★★★★★ 而且 allowInvalid = true（名單以外只警告、唔拒絕）', rule && rule.allowInvalid === true);
  check('★★★★★ 提示講明可以打名單以外嘅名字、系統照收', rule && /系統照收/.test(rule.helpText || ''));
}

console.log('\n=== CD5：畫面 ===');
{
  const zone2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8');
  check('★★★★★★ 冇〔填講員／翻譯／獻花〕掣', !/button\('填講員／翻譯／獻花'/.test(zone2));
  check('★★★★★ 彈窗同 BC 組提示句一齊拿走', !/function openPreacherFill\(/.test(zone2) && !/writesToSheetOnly/.test(zone2));
  check('★★★★ 清單提示有畫出嚟', /i\.count > 0 && i\.hint/.test(zone2));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
