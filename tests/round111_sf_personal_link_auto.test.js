// 第一百一十一輪批次 SF 組：新加入的人自動有個人連結
// 執行方式：node tests/round111_sf_personal_link_auto.test.js
// 下面用假 ID（P96xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 800));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppPersonalLink.gs']);
let AUDIT = [];
let seededWith = [];
let missing = [];
let seedThrows = false;
function setup() {
  AUDIT = []; seededWith = []; seedThrows = false;
  gas.writeAuditLog_ = (e) => AUDIT.push(e);
  gas.log_ = () => {};
  gas.planPersonalLinkTokenSeed_ = () => missing.slice();
  gas.seedPersonalLinkTokens_ = (list) => { if (seedThrows) throw new Error('壞了'); seededWith.push(list); return list.length; };
}

console.log('\n=== SF1：自動補發（每日排程、寄出前） ===');
{
  setup();
  missing = [{ personId: 'P9601', nameTC: '假新一' }, { personId: 'P9602', nameTC: '假新二' }];
  const n = gas.autoSeedPersonalLinkTokens_('寄出前');
  check('★★★★★★ 只補沒有 token 的人（planPersonalLinkTokenSeed_ 的名單）', n === 2 && seededWith.length === 1 && seededWith[0].length === 2);
  check('★★★★★★ AuditLog 只寫人數，不寫 PersonID 或 token', AUDIT.length === 1 && AUDIT[0].action === 'PERSONAL_LINK_TOKENS_AUTO_SEEDED'
    && AUDIT[0].newValue === '自動補發 2 位' && AUDIT[0].source === '寄出前' && JSON.stringify(AUDIT).indexOf('P960') === -1, JSON.stringify(AUDIT));
  setup();
  missing = [];
  check('★★★★★ 全部都有 ⇒ 不寫、不記', gas.autoSeedPersonalLinkTokens_('x') === 0 && seededWith.length === 0 && AUDIT.length === 0);
  setup();
  missing = [{ personId: 'P9601' }];
  seedThrows = true;
  check('★★★★★★ 出錯 ⇒ 回 0，不拋錯（不可以令寄出或每日排程失敗）', gas.autoSeedPersonalLinkTokens_('x') === 0);
}

console.log('\n=== SF2：剛加入的一位即時補 ===');
{
  setup();
  check('★★★★★★ 只補那一位', gas.seedPersonalLinkTokenForNewPerson_(' P9603 ') === 1 && JSON.stringify(seededWith) === JSON.stringify([[{ personId: 'P9603' }]]));
  setup();
  seedThrows = true;
  check('★★★★★ 出錯 ⇒ 0，不拋錯（加入新人本身已成功）', gas.seedPersonalLinkTokenForNewPerson_('P9603') === 0);
}

console.log('\n=== SF3：接線 ===');
{
  const people = read('src/WebAppPeople.gs');
  check('★★★★★★ 〔加入名單〕／〔立即加入這個人〕（apiAddPerson）：新增一行之後即時補', /appendRowFields_\(opened\.sheet, opened\.headers, record\);\n[^\n]*\n  if \(typeof seedPersonalLinkTokenForNewPerson_ === 'function'\) seedPersonalLinkTokenForNewPerson_\(personId\);/.test(people.replace(/\r\n/g, '\n')));
  check('★★★★★ 〔立即加入這個人〕經 apiAddPerson（沒有自己一套）', /apiAddPerson\(\{/.test(read('src/UnresolvedNameFix.gs')));
  const hw = read('src/WebAppHwcas.gs').replace(/\r\n/g, '\n');
  check('★★★★★★ 由出席系統加入（addPersonFromHwcas_locked_）：即時補', /appendRowFields_\(opened\.sheet, opened\.headers, record\);\n[^\n]*\n  if \(typeof seedPersonalLinkTokenForNewPerson_ === 'function'\) seedPersonalLinkTokenForNewPerson_\(personId\);/.test(hw));
  const sr = read('src/SheetReader.gs');
  check('★★★★★★ 各種寄出之前（syncPeopleFromHwcasBeforeSend_）補一次', /function syncPeopleFromHwcasBeforeSend_\(\) \{[\s\S]{0,300}autoSeedPersonalLinkTokens_\('寄出前'\)/.test(sr));
  const callers = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.gs') && /syncPeopleFromHwcasBeforeSend_\(\);/.test(read('src/' + f)));
  check('★★★★★ 寄申報連結（UnavailableInvite）、季前資料、職事表三條路、補寄都經這一支', ['UnavailableInvite.gs', 'PreseasonPack.gs', 'WebAppFlow.gs', 'WebAppZone4.gs']
    .every((f) => callers.indexOf(f) !== -1), callers.join());
  const tr = read('src/Trigger.gs');
  check('★★★★★★ 每日自動排程開頭補一次（在逐季檢查之前）', tr.indexOf("autoSeedPersonalLinkTokens_('dailyAutomationCheck_')") !== -1
    && tr.indexOf("autoSeedPersonalLinkTokens_('dailyAutomationCheck_')") < tr.indexOf('readSheet_(SHEETS.QUARTERS).forEach'));
  check('★★★★★ 上線前檢查：所有啟用的事奉人員都有個人連結', /add\('所有啟用的事奉人員都有個人連結', nNoLink === 0/.test(read('src/PreLaunchWeb.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
