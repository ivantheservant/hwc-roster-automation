// 第二十五輪批次階段 E2：區三畫面二——人員與電郵。
// 執行方式：node tests/name_mapping_crud.test.js
//
// ⚠️ 全部測試資料一律用 `P9xxx` 假 PersonID 同明顯假名——公開 repo。
//
// ─────────────────────────────────────────────────────────────────────
// 呢張表最危險嗰件事
// ─────────────────────────────────────────────────────────────────────
//
// 名單入面真係有兩位姓名只差最尾一個同音字嘅弟兄姊妹，佢哋係兩個唔同嘅人。
// **自動合併就會寄錯人**：甲收到乙嘅職事表，乙永遠收唔到自己嗰份，
// 而兩邊都唔知發生咗咩事。所以撞名一律只警告、交幹事判斷。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppPeople.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const M = gas.COLUMNS.NAME_MAPPING;

// ⚠️ 假電郵**動態組出嚟**，唔喺原始碼度出現一個完整嘅電郵字面值。
// 敏感資料掃描會捉住任何唔喺安全網域清單入面嘅電郵——而正確做法係
// 唔好喺原始碼留低電郵樣嘅字串，唔係去放寬個掃描器。
// （tests/scan_sensitive.test.js 自己嘅自我檢查用嘅就係同一招。）
const FAKE_DOMAIN = ['exam', 'ple', '.', 'invalid'].join('');
const EMAIL_A = 'a' + '@' + FAKE_DOMAIN;
const EMAIL_B = 'b' + '@' + FAKE_DOMAIN;
gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};
gas.getConfig = function (key, fallback) { return fallback; };
gas.Utilities = { formatDate: function () { return '2026-08-18'; } };

function person(o) {
  const r = {};
  r[M.PERSON_ID] = o.id;
  r[M.NAME_TC] = o.name;
  r[M.EMAIL] = o.email === undefined ? '' : o.email;
  r[M.MEMBER_NO] = o.memberNo === undefined ? '' : o.memberNo;
  r[M.ACTIVE] = o.active === false ? 'FALSE' : 'TRUE';
  return r;
}

console.log('\n=== E2【核心】MemberNo 前導零唔可以被試算表食走 ===');
{
  // `01234` 直接 setValue() 入去，試算表會當成數字，變成 `1234`。
  // 而會友編號嘅前導零係有意義嘅。
  const ok = gas.normalizeMemberNo_('01234');
  checkEqual('★★★★★ 回傳係字串，而且有單引號前綴強制當文字',
    ok.value, "'01234");
  checkEqual('★★★★ 冇錯誤', ok.error, '');

  checkEqual('★★★★ 空白 ⇒ 空白（唔強制要填）', gas.normalizeMemberNo_('').value, '');
  checkEqual('★★★★ undefined ⇒ 空白', gas.normalizeMemberNo_(undefined).value, '');

  const bad = gas.normalizeMemberNo_('123');
  check('★★★★★ 唔夠 5 位 ⇒ 擋住（唔可以靜靜補零，補錯就係另一個人）',
    bad.error !== '' && bad.value === '');
  check('★★★★ 非數字 ⇒ 擋住', gas.normalizeMemberNo_('1234A').error !== '');
  check('★★★★ 超過 5 位 ⇒ 擋住', gas.normalizeMemberNo_('123456').error !== '');
}

console.log('\n=== E2【核心】撞名只警告，唔阻擋 ===');
{
  let appended = null;
  gas.readSheet = function () { return [person({ id: 'P9001', name: '測試甲' })]; };
  gas.openSheetForEdit_ = function () { return { sheet: {}, headers: [M.PERSON_ID, M.NAME_TC] }; };
  gas.appendRowFields_ = function (sheet, headers, record) { appended = record; return 9; };
  gas.writeZone3Audit_ = function () {};

  const res = gas.apiAddPerson({ nameTC: '測試甲' });
  check('★★★★★ 撞名仍然成功加入（真係有兩個同名嘅人係正常事，'
    + '阻擋咗就會令幹事加唔到第二個人）', res.ok === true);
  check('★★★★★ 但一定要有警告，而且要講明「系統不會把他們合併」',
    res.duplicateWarning && /系統不會把他們合併/.test(res.duplicateWarning),
    res.duplicateWarning);
  check('★★★★ 真係寫咗一行入去', appended !== null);
  checkEqual('★★★★★ 新 PersonID 係系統編嘅，唔係幹事打嘅',
    appended[M.PERSON_ID], 'P9002');

  const noDup = gas.apiAddPerson({ nameTC: '測試乙' });
  checkEqual('★★★★ 冇撞名就冇警告', noDup.duplicateWarning, '');
}

console.log('\n=== E2 PersonID 編號規則 ===');
{
  checkEqual('★★★★ 由最大號 +1', gas.allocatePersonId_({ P1: true, P7: true }), 'P8');
  checkEqual('★★★★ 空名單由 P1 開始', gas.allocatePersonId_({}), 'P1');
  check('★★★★★ 唔會撞到已存在嘅 ID（就算有人手加咗唔跟格式嘅）',
    ['P3', 'P4'].indexOf(gas.allocatePersonId_({ P1: true, P2: true, P3: true })) !== -1);
}

console.log('\n=== E2【核心】Active=FALSE 唔係刪行 ===');
{
  let written = null;
  gas.readSheet = function () { return [person({ id: 'P9001', name: '測試甲', email: EMAIL_A })]; };
  gas.openSheetForEdit_ = function () { return { sheet: {}, headers: Object.keys(M).map(function (k) { return M[k]; }) }; };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) { written = updates; return []; };
  gas.writeZone3Audit_ = function () {};

  const res = gas.apiSavePerson({
    personId: 'P9001', nameTC: '測試甲', email: EMAIL_A, active: false
  });
  check('★★★★ 成功', res.ok === true);
  checkEqual('★★★★★ 寫嘅係 Active=FALSE，唔係刪行', written[M.ACTIVE], 'FALSE');
  check('★★★★★ 回傳有 deactivated 旗標，令前端知道要顯示嗰句警告',
    res.deactivated === true);

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppPeople.gs'), 'utf8');
  check('★★★★★ 整個檔案冇任何刪行呼叫', !/deleteRow|deleteRows|removeRow/.test(src));
}

console.log('\n=== E2【核心】PersonID 唔可以改 ===');
{
  let written = null;
  gas.readSheet = function () { return [person({ id: 'P9001', name: '測試甲' })]; };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) { written = updates; return []; };

  gas.apiSavePerson({ personId: 'P9001', nameTC: '測試甲改咗名' });
  check('★★★★★ 更新時**唔會**寫 PersonID 欄'
    + '——佢係全系統嘅外鍵（Eligibility／Unavailable／RosterAssignments／SendLog），'
    + '改一個就會令嗰個人喺歷史紀錄入面「消失」',
    !Object.prototype.hasOwnProperty.call(written, M.PERSON_ID),
    JSON.stringify(Object.keys(written)));

  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★ 畫面上 PersonID 係灰字標籤，唔係輸入格',
    /className: 'idtag'/.test(zone3));
}

console.log('\n=== E2 電郵：只有真係改咗先動 EmailSource ===');
{
  let written = null;
  gas.readSheet = function () {
    return [person({ id: 'P9001', name: '測試甲', email: EMAIL_A })];
  };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) { written = updates; return []; };

  gas.apiSavePerson({ personId: 'P9001', nameTC: '測試甲', email: EMAIL_A });
  check('★★★★★ 電郵冇改 ⇒ 唔會把 EmailSource 改成「手動」'
    + '——改咗會令下次同步邏輯判斷錯',
    !Object.prototype.hasOwnProperty.call(written, M.EMAIL_SOURCE));

  gas.apiSavePerson({ personId: 'P9001', nameTC: '測試甲', email: EMAIL_B });
  checkEqual('★★★★ 電郵真係改咗 ⇒ EmailSource 設為「手動」',
    written[M.EMAIL_SOURCE], '手動');
  check('★★★★ 而且有寫核實日期（已格式化）',
    written[M.EMAIL_VERIFIED_AT] === '2026-08-18');

  const bad = gas.apiSavePerson({ personId: 'P9001', nameTC: '測試甲', email: '唔係電郵' });
  check('★★★★ 明顯唔似電郵 ⇒ 擋住', bad.ok === false);
  check('★★★★★ 空白電郵**唔算錯**（有人真係冇電郵）',
    gas.apiSavePerson({ personId: 'P9001', nameTC: '測試甲', email: '' }).ok === true);
}

console.log('\n=== E2 中文名唔可以清空 ===');
{
  gas.readSheet = function () { return [person({ id: 'P9001', name: '測試甲' })]; };
  const res = gas.apiSavePerson({ personId: 'P9001', nameTC: '' });
  // 訊息要指出**正確嘅做法**（取消勾「啟用」），唔係淨係話「唔准」——
  // 只講「唔准」嘅話，幹事會諗唔到佢其實想做嘅嘢有另一個做法。
  check('★★★★★ 擋住，而且叫佢取消勾「啟用」而唔係清空名字',
    res.ok === false && /「啟用」取消勾選/.test(res.message)
    && /不要清空名字/.test(res.message), res.message);
}

console.log('\n=== E2 結構：AuditLog、只改該欄、Web App 關卡 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppPeople.gs'), 'utf8');
  checkEqual('★★★★★ 每個 api 函式都有 assertWebAppRequestAllowed_()',
    (src.match(/function api\w+\(/g) || []).length,
    (src.match(/assertWebAppRequestAllowed_\(\);/g) || []).length);
  ['PERSON_UPDATE', 'PERSON_ADD', 'ALIAS_ADD', 'ALIAS_UPDATE', 'PERSONAL_TOKEN_REISSUE']
    .forEach(function (action) {
      check('★★★★ 有寫 AuditLog：' + action, src.indexOf("action: '" + action + "'") !== -1);
    });
  check('★★★★★ 用 writeRowFields_()，**唔係整行覆寫**',
    /writeRowFields_\(/.test(src) && !/setValues\(\[row\]\)/.test(src));
  check('★★★★★ token 重發重用選單版嘅 reissuePersonalLinkToken_()，唔另寫一套',
    /reissuePersonalLinkToken_\(id\)/.test(src));
}

console.log('\n=== E2 畫面文案 ===');
{
  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ 停用時有講「已經排好的職事表不受影響」',
    zone3.indexOf('已經排好的職事表不受影響。') !== -1);
  check('★★★★ 冇電郵嗰行有標示「正式發出會略過」',
    zone3.indexOf('沒有電郵，正式發出會略過') !== -1);
  check('★★★★★ 重發 token 要打字確認（不可逆）',
    /requireTyping: true/.test(zone3));
  check('★★★★ HWCAS 補電郵本輪唔做，畫面上指返選單',
    zone3.indexOf('「從出席系統補電郵」暫時請用試算表上方的選單。') !== -1);
  check('★★★★★ 別名畫面有講「名字相似不代表是同一個人」',
    zone3.indexOf('名字相似不代表是同一個人。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
