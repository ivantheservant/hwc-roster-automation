// 第一百零四輪批次 PC 組：整季重設之後，公開連結 /preview 看得到完整的「已重設」句子。
// 執行方式：node tests/round104_pc_reset_note.test.js
//
// 現場（第一百零二輪觀察）：/preview 不讓文字溢出到旁邊的格；重設之後只剩一欄，而那一欄沿用職事表崗位欄的
// 闊度（82px），句子被截斷。
//
//   PC1　重設之後 A1 是「已重設」句子、粗體、自動換行
//   PC2　第一欄加闊到放得下整句（≥ 句子字數 × 約 14px）
//   PC3　「服侍次數」那一張刪走，只剩一張；只剩一欄（沒有合併的需要）

const { loadGasSource } = require('./helpers/gas_loader.js');
const { MockSpreadsheet } = require('./helpers/sheet_mock.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const pub = new MockSpreadsheet();
const SpreadsheetAppStub = { openById: function () { return pub; } };
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'RosterOutput.gs', 'PublicRoster.gs'],
  { SpreadsheetApp: SpreadsheetAppStub });
gas.findPublicLinkRow_ = function () { return { fileId: 'FILE_TEST', fileUrl: 'https://example.invalid/p' }; };
const audits = [];
gas.writeAuditLog_ = function (x) { audits.push(x); };
gas.log_ = function () {};

// 之前發佈過：第一張「職事表」多欄、崗位欄 82px；第二張「服侍次數」
const roster = pub.insertSheet(gas.ROSTER_OUTPUT_SHEET_NAMES.ROSTER);
roster.getRange(1, 1, 3, 6).setValues([['a', 'b', 'c', 'd', 'e', 'f'], ['1', '2', '3', '4', '5', '6'], ['x', 'y', 'z', 'u', 'v', 'w']]);
roster.setColumnWidth(1, 82);
pub.insertSheet(gas.ROSTER_OUTPUT_SHEET_NAMES.COUNTS);

const ok = gas.clearPublicRosterOnQuarterReset_('2099T1');
check('（前置）清空成功', ok === true);
const sheets = pub.getSheets();
const s = sheets[0];
const text = String(s.getRange(1, 1).getValue());
console.log('\n=== PC1 ===');
check('★★★★★ A1 是「已重設」句子', /2099T1 職事表已重設，尚未重新發佈/.test(text), text);
check('★★★★ 粗體', s._getFormat(1, 1, 'fontWeight') === 'bold');
check('★★★★★★ 自動換行（/preview 不會截斷）', s._getFormat(1, 1, 'wrap') === true);
console.log('\n=== PC2 ===');
const w = s.getColumnWidth(1);
check('★★★★★★ 第一欄加闊到放得下整句（不再是崗位欄的 82px）', w >= text.length * 14 && w === gas.PUBLIC_ROSTER_RESET_NOTE_WIDTH_PX,
  w + ' / 句子 ' + text.length + ' 字');
console.log('\n=== PC3 ===');
check('★★★★★ 只剩一張（服侍次數刪走）', sheets.length === 1, String(sheets.length));
check('★★★★ 只剩一欄', s.getMaxColumns() === 1, String(s.getMaxColumns()));
check('★★★★ AuditLog 照寫', audits.length === 1);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
