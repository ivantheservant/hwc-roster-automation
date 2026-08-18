// 第二十七輪批次階段 C：區三畫面七——身分（堂委／執事）與換屆。
// 執行方式：node tests/roles_crud_and_term_change.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個畫面平時幾乎唔會用，所以測試重心唔係 CRUD
// ─────────────────────────────────────────────────────────────────────
//
// 身分名單一年動一次。真正會用到嘅時刻只有一個：**換屆**。
// 而換屆最容易做錯嘅事係**把舊行刪走**，後果係**追溯性**嘅：
//
//   `Roles` 係按日期判斷「嗰一日佢係咪堂委」。刪咗舊行，系統就會當佢
//   由頭到尾都唔係堂委——上一季、上上季嘅職事表全部會被追溯判成違反
//   「報告限堂委」嗰條硬規則。而嗰啲季度早就寄咗信、印咗 PDF。
//
// 所以呢份測試最重嘅幾條斷言全部圍繞「唔刪行」同「預覽要列全部」。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const backend = read('src/WebAppRoles.gs');
const zone3 = read('src/ui/ScriptZone3.html');
const common = read('src/ui/Script.html');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== C【核心】換屆：一定唔可以刪行 ===');
{
  check('★★★★★ 全個檔案冇任何刪行呼叫'
    + '——刪咗舊行，舊季度嘅職事表會被追溯判成違規，'
    + '而嗰啲季度早就寄咗信、印咗 PDF，改唔到亦唔應該改',
    !/deleteRow|deleteRows|removeRow/.test(backend));

  const exec = bodyOf(backend, 'apiRolesTermChangeExecute');
  check('★★★★★ 換屆只寫 EffectiveTo 一欄，唔掂其他欄',
    /updates\[R\.EFFECTIVE_TO\] = plan\.endDate;/.test(exec)
    && (exec.match(/updates\[R\./g) || []).length === 1);
  check('★★★★★ 逐行寫 AuditLog（唔係寫一筆「批次換屆」就算）'
    + '——日後要查得返「邊個、咩身分、邊日卸任」',
    /plan\.rows\.forEach[\s\S]{0,900}?writeZone3Audit_/.test(exec));
  check('★★★★★ 逐行用 ID 重新搵列號'
    + '——批次動作中途插行嘅風險同單行一樣',
    /findRowById_\(SHEETS\.ROLES, R\.ROLE_ASSIGNMENT_ID, r\.roleAssignmentId\)/.test(exec));
  check('★★★★★ 搵唔返嘅行會報出嚟（failed），唔會靜靜略過'
    + '——靜靜略過就係「做咗一半但報告話全部成功」',
    /failed\.push\(/.test(exec) && /failed: failed/.test(exec));
}

console.log('\n=== C【核心】執行前後端自己重算一次計畫 ===');
{
  const exec = bodyOf(backend, 'apiRolesTermChangeExecute');
  check('★★★★★ 執行時重新叫一次 Plan，唔信前端傳返嚟嗰份'
    + '——前端嗰份係幾秒前算嘅，期間可能有人喺試算表改過',
    /const plan = apiRolesTermChangePlan\(endDateRaw\);/.test(exec));
  check('★★★★★ 打字確認喺後端再驗一次（唔靠前端做關卡）',
    /!== ROLES_TERM_CHANGE_CONFIRM_TEXT/.test(exec));
  check('★★★★ 冇行要處理就唔會扮成功',
    /plan\.rows\.length === 0/.test(exec));
}

console.log('\n=== C 預覽：純讀取、列全部、擋住打錯日期 ===');
{
  const plan = bodyOf(backend, 'apiRolesTermChangePlan');
  check('★★★★★ 預覽一格都唔寫',
    !/setValue|appendRow|writeRowFields_|appendRowFields_/.test(plan));
  check('★★★★★ 已經有 EffectiveTo 嘅行唔會再被掂'
    + '——佢哋已經卸任過，唔應該被改成另一個日期',
    /if \(to\) return;/.test(plan));
  check('★★★★ 生效日仲未到嘅都唔掂（可能已經預先加咗下一屆）',
    /if \(from && from > today\) return;/.test(plan));
  check('★★★★★ 生效日比卸任日遲會被擋住'
    + '——寫落去就會出現「生效日比生效至遲」嘅行，'
    + '而嗰種行喺日期判斷入面永遠唔成立，即係嗰個人靜靜咁冇咗身分',
    /startsAfterEnd/.test(plan) && /blocked: invalid\.length > 0/.test(plan));
}

console.log('\n=== C 畫面：規格指定嗰段字逐字照抄 ===');
{
  // 呢三句喺規格 4.3 寫明要逐字照抄。改寫成「摘要版」會令幹事以為
  // 「唔好刪行」只係一個建議，而唔係一條會令舊季度出事嘅規則。
  ['換屆時不要刪除舊的行。',
    '撳「換屆」，輸入卸任日期，系統會把所有現任的行填上「生效至」＝卸任日期，',
    '然後你再逐個加入新一屆。',
    '這樣做的原因：舊季度的職事表不會因為今日換屆而被追溯判成違規。'
  ].forEach((line) => {
    check('★★★★★ 有這一句：' + line.slice(0, 18) + '…',
      zone3.indexOf(line) !== -1);
  });

  check('★★★★★ 預覽會**逐行列出全部**，唔係只講數目'
    + '——呢一步係幹事唯一一次可以用人眼確認「係咪真係想改咁多人」嘅關口',
    /plan\.rows\.forEach\(\(r\) => \{[\s\S]{0,300}?list\.appendChild/.test(zone3));
  check('★★★★★ 而且要打字確認（一次過改幾十行係不可逆嘅批次動作）',
    /requireTyping: true,[\s\S]{0,300}?confirmLabel: '確定換屆'/.test(zone3));
  check('★★★★ 確認畫面有「不會做的事」，而且明講唔會刪行',
    /不會刪除任何一行/.test(zone3));
}

console.log('\n=== C 畫面永不顯示英文身分碼 ===');
{
  check('★★★★★ 下拉嘅顯示文字用 label（中文），value 先係英文碼',
    /o\.value = c\.roleCode;[\s\S]{0,200}?o\.textContent = c\.label;/.test(zone3));
  check('★★★★★ 後端一律連 roleLabel 一齊回（前端唔使自己維護一份對照表）'
    + '——維護兩份就會有一日對唔上',
    /roleLabel: ROLE_LABELS_TC\[roleCode\] \|\| roleCode/.test(backend));
  check('★★★★★ 認唔出嘅身分代號會標出嚟，**唔會靜靜當成一個已知身分**'
    + '——打錯字嘅話規則會靜靜失效，而畫面睇落完全正常',
    /unknownRoleCode: !ROLE_LABELS_TC\[roleCode\]/.test(backend)
    && zone3.indexOf('這個身分代號系統不認得，等於沒有身分') !== -1);
  check('★★★★ 身分選項由 ROLE_CODES 產生，唔係喺畫面寫死兩個',
    /Object\.keys\(ROLE_CODES\)/.test(backend));
}

console.log('\n=== C 按人分組、精簡清單 ＋「修改」模式 ===');
{
  check('★★★★★ 後端按人分組（一個人可以同時是堂委又是執事，或者卸任後再連任）',
    /byPerson\[personId\] = \{ personId: personId, nameTC: nameTC, rows: \[\] \}/.test(backend));
  check('★★★★★ 前端唔係一次過展開全部編輯卡'
    + '——同「不能服侍的日期」一致：撳「修改」先展開',
    /if \(slot\.firstChild\) \{ clear\(slot\); return; \}[\s\S]{0,120}?roleEditorFields/.test(zone3));
  check('★★★★ 有「現任」判斷（Active 而且今日喺生效期內）',
    /current: active && \(!from \|\| from <= today\) && \(!to \|\| to >= today\)/.test(backend));
}

console.log('\n=== C 單行寫入：四條區三規矩 ===');
{
  const save = bodyOf(backend, 'apiSaveRole');
  const add = bodyOf(backend, 'apiAddRole');
  check('★★★★★ 改一行用 writeRowFields_（只改該行該欄，唔整行覆寫）',
    /writeRowFields_\(opened\.sheet, opened\.headers, found\.sheetRow, newValues\)/.test(save));
  check('★★★★★ 用 ID 重新搵列號，唔信前端傳嚟嗰個',
    /findRowById_\(SHEETS\.ROLES, R\.ROLE_ASSIGNMENT_ID, roleId\)/.test(save));
  check('★★★★★ AuditLog 有 old 同 new 兩邊'
    + '——只記新值嘅話，日後查「究竟改咗啲乜」就要靠估',
    /oldValue: describeFields_\(found\.record, FIELDS\)/.test(save)
    && /newValue: describeFields_\(newValues, FIELDS\)/.test(save));
  check('★★★★ 新增亦寫 AuditLog', /action: 'ROLE_ADD'/.test(add));
  check('★★★★★ 冇「刪除」掣（停用＝Active，卸任＝填生效至）',
    !/apiDeleteRole|button\('刪除'/.test(backend + zone3));
}

console.log('\n=== C 輸入驗證：日期同身分 ===');
{
  const v = bodyOf(backend, 'validateRoleInput_');
  check('★★★★★ 生效日**可以留空**（＝一直以來都是），同 Roles.gs 讀取邏輯一致'
    + '——強制要填就會逼幹事亂填一個日期，而嗰個日期會變成真相',
    /if \(String\(p\.effectiveFrom \|\| ''\)\.trim\(\) !== ''\)/.test(v));
  check('★★★★ 生效日遲過生效至會被擋', /from > to/.test(v));
  check('★★★★★ 身分只接受 ROLE_LABELS_TC 認得嘅代號'
    + '——放行一個認唔出嘅代號，等於容許規則靜靜失效',
    /if \(!ROLE_LABELS_TC\[roleCode\]\)/.test(v));
  check('★★★★ 日期用共用嘅 parseOfficerDateInput_（唔另寫一次寬鬆版）',
    /parseOfficerDateInput_\(p\.effectiveFrom, timezone\)/.test(v));
}

console.log('\n=== C 唯讀提示：接既有嘅 buildRoleOverviewRows_() ===');
{
  const ov = bodyOf(backend, 'apiRoleOverview');
  check('★★★★★ 重用既有嘅總覽（唔係另寫一份會走樣嘅）',
    /buildRoleOverviewRows_\(overview\)/.test(ov));
  check('★★★★ Diagnostics 嘅欄名喺後端轉走，前端唔使識嗰套欄名',
    /section: r\[COLUMNS\.DIAGNOSTICS\.SECTION\]/.test(ov));
  check('★★★★★ 讀唔到唔會令整個畫面死——只回一句人話，名單照樣用得',
    /catch \(err\)[\s\S]{0,300}?上面的名單仍然可以用/.test(ov));
}

console.log('\n=== C 呼叫層：讀寫分流（階段 A 嗰條白名單）===');
{
  const listMatch = common.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
  const readOnly = (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));

  ['apiListRoles', 'apiRolesTermChangePlan', 'apiRoleOverview'].forEach((n) => {
    check('★★★★ ' + n + ' 喺唯讀白名單', readOnly.indexOf(n) !== -1);
  });
  ['apiSaveRole', 'apiAddRole', 'apiRolesTermChangeExecute'].forEach((n) => {
    check('★★★★★ ' + n + ' **唔喺**白名單（佢哋會寫入）',
      readOnly.indexOf(n) === -1);
    check('★★★★★ 而且前端用 callServerMutating() 叫佢'
      + '——唔係嘅話，寫完之後區二嘅「還有 N 項未做」會停喺舊數',
      zone3.indexOf("callServerMutating('" + n + "'") !== -1);
  });
}

console.log('\n=== C 區三入口 ===');
{
  check('★★★★ 區三有「身分（堂委／執事）」呢粒掣',
    /button\('身分（堂委／執事）', \(\) => openRoles\(\), ''\)/.test(zone3));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
