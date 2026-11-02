// 第九十三輪批次 TC 組：出席系統名字配對加一條規則——4 個中文字去掉第一個字（例如夫姓）再配一次，只作候選。
// 執行方式：node tests/round93_tc_surname_dropped.test.js
//
//   TC1 `resolveNameLocally_`：4 字配到（NameTC／NameAlias）；配到兩個不算；3 字、2 字名不做；英文名不做；前兩步配到的照舊
//   TC2 跨姓名欄：其他欄已經完全相同 ⇒ 不被「去掉第一個字」干擾；只有這一類 ⇒ SURNAME_DROPPED＋說明
//   TC3 只作候選：預覽列不可以套用、風險「高」、有說明句；不改 `Utils.gs resolvePersonId_`
//   TC4 畫面候選有說明句
// 用假名（假甲、假乙……），不涉及真人資料。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 600));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs', 'HwcasSync.gs', 'HwcasApply.gs', 'WebAppHwcas.gs']);
const M = gas.HWCAS_MATCH;
const PID = gas.COLUMNS.NAME_MAPPING.PERSON_ID;
const personRow = (id) => ({ [PID]: id });

// 名單（職事表慣用稱呼）：假名三個字的、四個字的、兩個字的
const byName = {
  '假大文': [personRow('P9001')],      // 出席系統寫「某假大文」（夫姓）
  '假小明': [personRow('P9002'), personRow('P9003')],   // 同名兩人
  '假美': [personRow('P9004')],        // 兩個字
  '假三豐': [personRow('P9005')]       // 別名測試用
};
const aliasMap = { '假小花': 'P9006', '假大文': 'P9001' };

console.log('\n=== TC1：resolveNameLocally_ ===');
{
  let r = gas.resolveNameLocally_('某假大文', byName, aliasMap);
  check('★★★★★★ 4 字名、去掉第一個字後剛好配到一個人 ⇒ SURNAME_DROPPED', r && r.matchType === M.SURNAME_DROPPED && r.personId === 'P9001', JSON.stringify(r));
  r = gas.resolveNameLocally_('某假小花', byName, aliasMap);
  check('★★★★★ 去掉第一個字後靠 NameAlias 配到 ⇒ 也算（剛好一個）', r && r.matchType === M.SURNAME_DROPPED && r.personId === 'P9006', JSON.stringify(r));
  r = gas.resolveNameLocally_('某假小明', byName, aliasMap);
  check('★★★★★★ 去掉第一個字後配到兩個人 ⇒ 不算（當作配不到）', r === null, JSON.stringify(r));
  check('★★★★★ 3 個字的名不做這一步（「假大文」不會變成「大文」去配）', gas.resolveNameLocally_('某大文', byName, aliasMap) === null);
  check('★★★★★ 2 個字的名不做', gas.resolveNameLocally_('某美', byName, aliasMap) === null);
  check('★★★★★★ 3 個字的名即使「去掉第一個字」剛好等於名單上一個 2 字名也不做（「某假美」不會配到「假美」）', gas.resolveNameLocally_('某假美', byName, aliasMap) === null);
  check('★★★★★ 英文名不做（4 個英文字母也不行）', gas.resolveNameLocally_('John', byName, { John: undefined }) === null
    && gas.resolveNameLocally_('Mary Chen', byName, aliasMap) === null);
  check('★★★★ 4 字名含英文字母不做', gas.resolveNameLocally_('A假大文', byName, aliasMap) === null);
  r = gas.resolveNameLocally_('假大文', byName, aliasMap);
  check('★★★★★ 前兩步配到的照舊（完全相同優先於別名）', r && r.matchType === M.EXACT && r.personId === 'P9001', JSON.stringify(r));
  r = gas.resolveNameLocally_('假小花', byName, aliasMap);
  check('★★★★★ 別名照舊 ALIAS', r && r.matchType === M.ALIAS && r.personId === 'P9006', JSON.stringify(r));
  check('★★★★ 4 字名配不到（去掉第一個字也沒有）⇒ null', gas.resolveNameLocally_('假甲乙丙', byName, aliasMap) === null);
  check('★★★★ 空白 ⇒ null', gas.resolveNameLocally_('  ', byName, aliasMap) === null);
}

console.log('\n=== TC2：跨姓名欄 ===');
{
  const cols = ['B', 'C'];
  const headers = { B: '姓名1', C: '姓名2' };
  let r = gas.matchAcrossNameColumns_({ B: 'Chen', C: '某假大文' }, cols, headers, byName, aliasMap);
  check('★★★★★★ 只有去掉第一個字那一類 ⇒ SURNAME_DROPPED，帶說明句',
    r.matchType === M.SURNAME_DROPPED && r.personId === 'P9001' && r.note.indexOf('出席系統的名字去掉第一個字後相同（例如夫姓）') !== -1, JSON.stringify(r));
  r = gas.matchAcrossNameColumns_({ B: '假大文', C: '某假大文' }, cols, headers, byName, aliasMap);
  check('★★★★★★ 另一欄已經完全相同 ⇒ 照舊 EXACT（候選那一類不參與）', r.matchType === M.EXACT && r.personId === 'P9001', JSON.stringify(r));
  r = gas.matchAcrossNameColumns_({ B: '假三豐', C: '某假大文' }, cols, headers, byName, aliasMap);
  check('★★★★★ 另一欄完全相同配到別人 ⇒ 以完全相同為準，不變成「同名多人」', r.matchType === M.EXACT && r.personId === 'P9005', JSON.stringify(r));
  r = gas.matchAcrossNameColumns_({ B: '某假小明', C: '' }, cols, headers, byName, aliasMap);
  check('★★★★ 去掉第一個字配到兩個 ⇒ NONE（照舊當作配不到）', r.matchType === M.NONE, JSON.stringify(r));
  r = gas.matchSingleName_('某假大文', byName, aliasMap);
  check('★★★★ 單一姓名欄（舊行為）也一樣', r.matchType === M.SURNAME_DROPPED && r.personId === 'P9001');
}

console.log('\n=== TC3：只作候選 ===');
{
  const row = gas.buildHwcasPreviewRow_({ matchType: M.SURNAME_DROPPED, personId: 'P9001', nameTC: '假大文', hwcasName: '某假大文',
    hwcasEmail: 'x@example.invalid', existingEmail: '', note: 'n' }, { P9001: '假大文' });
  check('★★★★★★ 預覽列：不可以套用（canApply＝false）', row.canApply === false, JSON.stringify(row));
  check('★★★★★ 風險「高」，不歸入「沒有改動」', row.riskLevel === 'HIGH' && row.bucket === gas.HWCAS_BUCKET.NEEDS_ACTION, JSON.stringify(row));
  check('★★★★★ 有說明句（去掉第一個字後相同、只是候選）', row.warnings.some((w) => /去掉第一個字後相同（例如夫姓）/.test(w) && /候選/.test(w)), JSON.stringify(row.warnings));
  check('★★★★ 不套用時的原因句', /去掉第一個字後相同/.test(gas.describeHwcasSkip_(row)));
  check('★★★★★ 選單版套用：SURNAME_DROPPED 不是 EXACT／ALIAS ⇒ 略過，並有原因', /SURNAME_DROPPED/.test(gas.describeSkipReason_(M.SURNAME_DROPPED)));
  check('★★★★ 選單版初稿的「建議動作」要人手確認', /需人手確認/.test(gas.decideDraftAction_(M.SURNAME_DROPPED, '', 'x@example.invalid')));
  const utils = read('src/Utils.gs');
  const resolve = utils.slice(utils.indexOf('function resolvePersonId_'));
  check('★★★★★★ 職事表格子的配對（Utils.gs resolvePersonId_）沒有加這一類', resolve.slice(0, resolve.indexOf('\n}\n')).indexOf('SURNAME_DROPPED') === -1
    && utils.indexOf('SURNAME_DROPPED') === -1);
}

console.log('\n=== TC4：畫面 ===');
{
  const z3 = read('src/ui/ScriptZone3.html');
  check('★★★★★ 〔出席系統連結〕候選行寫「候選：出席系統的名字去掉第一個字後相同（例如夫姓）」，預設不勾',
    /c\.matchType === 'SURNAME_DROPPED'[\s\S]{0,120}去掉第一個字後相同（例如夫姓）/.test(z3) && /cb\.checked = hwcasLinkPicked\[p\.personId\] === c\.memberNo;/.test(z3));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
