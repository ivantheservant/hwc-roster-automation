// 第一百零一輪批次 ZA 組：用字（義工 → 事奉人員）、刪去「系統沒有某個概念」的句子、名字去尊稱容錯。
// 執行方式：node tests/round101_za_wording.test.js
//
//   ZA1 src/*.gs、src/ui/*.html 的字串（排除註解）沒有「義工」（SheetTextUpdate.gs 是舊試算表文字的對照，必須和試算表一字不差，除外）
//   ZA2 沒有「系統沒有「上半場不在」這種概念」一類句子；「系統沒有寄出任何電郵」這類告訴使用者發生了甚麼的句子保留
//   ZA3 resolvePersonIdLenient_：完全相同 → 別名 → 去掉結尾尊稱；名單上本身以尊稱結尾的名字以完全相同優先；
//       Config NAME_HONORIFIC_SUFFIXES 可改；〔儲存並套用名單〕、匯入用它，確認窗寫明「『某某姊妹』當作『某某』」
// 用假資料（P97xx、假甲…）。

const fs = require('fs');
const path = require('path');
const { extractStringLiterals } = require('./helpers/string_literals.js');
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
const SRC_FILES = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f)).map((f) => 'src/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => /\.html$/.test(f)).map((f) => 'src/ui/' + f));
function literalHits(word, exclude) {
  const hits = [];
  SRC_FILES.forEach((f) => {
    if ((exclude || []).indexOf(f) !== -1) return;
    extractStringLiterals(read(f), f).forEach((l) => { if (l.text.indexOf(word) !== -1) hits.push(f + ':' + l.line + '　' + l.text.slice(0, 80)); });
  });
  return hits;
}

console.log('\n=== ZA1：「義工」一律改「事奉人員」===');
{
  const hits = literalHits('義工', ['src/SheetTextUpdate.gs']);
  check('★★★★★★ src 的字串（排除註解）沒有「義工」', hits.length === 0, hits.join('\n'));
  check('★★★★ 掃描器真的掃到字串（「事奉人員」在多個檔出現）', literalHits('事奉人員').length > 50);
  check('★★★★★ 範本 seed、幹事通知用「事奉人員申報」', read('src/EmailTemplateSeed.gs').indexOf('義工') === -1
    && read('src/PersonalUnavailable.gs').indexOf('事奉人員申報不能服侍：') !== -1);
}

console.log('\n=== ZA2：刪去「系統沒有某個概念」的句子 ===');
{
  const hits = literalHits('這種概念');
  check('★★★★★★ 沒有「…這種概念」的句子', hits.length === 0, hits.join('\n'));
  const rr = read('src/RuleReview.gs');
  check('★★★★★ 規則審閱「已申報不能服侍」的說明只剩一句', rr.indexOf("what: '有人告訴我們某幾日不在，那幾日就完全不會排他。'") !== -1);
  check('★★★★★ 不能服侍的日期黃框只剩「填了就代表…」', read('src/ui/ScriptZone3.html').indexOf("text: '填了就代表那一日（或所選的崗位）整日不能服侍。'") !== -1);
  check('★★★★ 告訴使用者發生了甚麼的句子保留（「系統沒有寄出任何電郵」）', literalHits('系統沒有寄出任何電郵').length > 0);
}

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['WebAppEligibility.gs', 'EligibilitySheetEditor.gs', 'Validate.gs'] });
  const g = sc.gas; const C = sc.C; const S = sc.S;
  // P9706 的正名以「師母」結尾（名單上本身包含尊稱）
  const nm = sc.ss.getSheetByName(S.NAME_MAPPING);
  const keys = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0];
  const nameCol = keys.indexOf(C.NAME_MAPPING.NAME_TC) + 1;
  for (let r = 3; r <= nm.getLastRow(); r++) {
    if (String(nm.getRange(r, 1).getValue()) === 'P9706') nm.getRange(r, nameCol).setValue('假己師母');
  }
  // 另一位叫「假己」的人（P9707 改名）：「假己師母」完全相同的那位優先
  for (let r = 3; r <= nm.getLastRow(); r++) {
    if (String(nm.getRange(r, 1).getValue()) === 'P9707') nm.getRange(r, nameCol).setValue('假己');
  }
  if (g.invalidateSheetReadMemo_) g.invalidateSheetReadMemo_();
  if (g.clearConfigCache_) g.clearConfigCache_();
  return sc;
}

console.log('\n=== ZA3：名字去尊稱容錯 ===');
{
  const sc = scene();
  const g = sc.gas;
  const sfx = g.readNameHonorificSuffixes_();
  check('★★★★★ 預設尊稱七個，長的排先', sfx.length === 7 && sfx.indexOf('姊妹') !== -1 && sfx.indexOf('長老') !== -1, JSON.stringify(sfx));
  check('★★★★★ 純函式：「假甲姊妹」⇒ 假甲＋姊妹；只有尊稱 ⇒ 不去；沒有尊稱 ⇒ null',
    JSON.stringify(g.stripNameHonorific_('假甲姊妹', sfx)) === JSON.stringify({ base: '假甲', suffix: '姊妹' })
    && g.stripNameHonorific_('姊妹', sfx) === null && g.stripNameHonorific_('假甲', sfx) === null);
  const exact = g.resolvePersonIdLenient_('假甲');
  check('★★★★★ 完全相同 ⇒ 沒有去尊稱', exact && exact.personId === 'P9701' && exact.suffix === '', JSON.stringify(exact));
  const sis = g.resolvePersonIdLenient_('假甲姊妹');
  check('★★★★★★ 「假甲姊妹」找不到 ⇒ 去掉「姊妹」⇒ P9701', sis && sis.personId === 'P9701' && sis.base === '假甲' && sis.suffix === '姊妹', JSON.stringify(sis));
  check('★★★★★ 「假乙傳道」⇒ P9702', (g.resolvePersonIdLenient_('假乙傳道') || {}).personId === 'P9702');
  const mrs = g.resolvePersonIdLenient_('假己師母');
  check('★★★★★★ 名單上本身是「假己師母」⇒ 完全相同優先（P9706），不當作「假己」（P9707）', mrs && mrs.personId === 'P9706' && mrs.suffix === '', JSON.stringify(mrs));
  check('★★★★★ 找不到 ⇒ null；resolvePersonId_ 本身不變（仍然只做完全相同）',
    g.resolvePersonIdLenient_('無此人姊妹') === null && g.resolvePersonId_('假甲姊妹') === null);
  check('★★★★★ 確認窗句子', g.describeHonorificMatch_('假甲姊妹', '假甲') === '『假甲姊妹』當作『假甲』');
  // Config 可改
  g.getConfig_ = ((orig) => (k, d) => (k === 'NAME_HONORIFIC_SUFFIXES' ? ['先生'] : orig(k, d)))(g.getConfig_);
  check('★★★★★ Config NAME_HONORIFIC_SUFFIXES 改成「先生」⇒「假甲先生」找到、「假甲姊妹」找不到',
    (g.resolvePersonIdLenient_('假甲先生') || {}).personId === 'P9701' && g.resolvePersonIdLenient_('假甲姊妹') === null);
}

console.log('\n=== ZA3：〔儲存並套用名單〕===');
{
  const sc = scene();
  const g = sc.gas;
  g.Utilities.formatDate = function () { return sc.DATES[0]; };
  g.buildGridSheetUrl_ = function () { return 'https://example.invalid/x'; };
  g.GRID_COLORS = g.GRID_COLORS || { HEADER: '#eee' };
  g.buildEligibilitySheet_();
  const sh = sc.ss.getSheetByName('崗位名單');
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = keys.indexOf('READ') + 1;
  let r = 3; while (String(sh.getRange(r, col).getValue()) !== '') r++;
  sh.getRange(r, col).setValue('假丁弟兄');
  sh.getRange(r + 1, col).setValue('假丁弟兄');
  const plan = g.planEligibilitySheetApply_(sc.Q);
  check('★★★★★★ 「假丁弟兄」不當作認不出的名字', plan.unresolved.length === 0, JSON.stringify(plan.unresolved));
  check('★★★★★★ 預覽列出「『假丁弟兄』當作『假丁』」（同一個名字只列一次）',
    plan.honorificMatches.length === 1 && plan.honorificMatches[0].note === '『假丁弟兄』當作『假丁』' && plan.honorificMatches[0].personId === 'P9704',
    JSON.stringify(plan.honorificMatches));
  const main = read('src/ui/ScriptMainFlow.html');
  check('★★★★★ 確認窗顯示這一段（renderEligibilitySheetPlan）', /honorificMatchBox\(plan\.honorificMatches\)/.test(main));
  check('★★★★★ 共用元件寫「去掉尊稱之後才找到」並逐個列出', /function honorificMatchBox\(list\)[\s\S]{0,400}去掉尊稱之後才找到[\s\S]{0,400}m\.note/.test(read('src/ui/Script.html')));
}

console.log('\n=== ZA3：匯入 ===');
{
  const imp = read('src/RosterImport.gs');
  check('★★★★★ 匯入用 resolvePersonIdLenient_，plan 帶 honorificMatches', /resolvePersonIdLenient_\(typed\)/.test(imp) && /honorificMatches: honorificMatches/.test(imp));
  check('★★★★★ 匯入確認窗顯示這一段', /honorificMatchBox\(plan\.honorificMatches\)/.test(read('src/ui/ScriptZone4.html')));
  check('★★★★ 職事表格子（第 2 步）仍然只做完全相同', /resolvePersonId_\(normalizedGrid\)/.test(read('src/FineTune.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
