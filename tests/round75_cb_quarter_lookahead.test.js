// 第七十五輪批次 CB 組：季度提前自動建立（Config `QUARTER_LOOKAHEAD_MONTHS`，預設 6）。
// 執行方式：node tests/round75_cb_quarter_lookahead.test.js
//
// Ivan 手動測試 A：「季度選單未來嘅季度會唔會自動出現？可唔可以提前大約半年建立？」
//
//   CB1　純函式：今日＋N 個月（月尾日子收窄）；揀出開始日期喺 (今日, 今日＋N月] 而未存在嘅季度
//   CB2　ensureLookaheadQuarters_()：逐季建立（唔一次過開成年）、每季一行 AuditLog、已存在嘅唔掂
//   CB3　Config 唔係正整數 ⇒ 用預設 6（唔可以當成 0 靜靜熄咗）
//   CB4　入口：載入時（apiEnsureFutureQuarters）、每日排程、進階與診斷〔建立未來季度〕

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'NewQuarterWizard.gs', 'Trigger.gs', 'AnnualQuarters.gs']);
const warns = [];
gas.log_ = (lvl, msg) => { if (lvl === 'WARN') warns.push(msg); };

console.log('\n=== CB1：純函式 ===');
{
  check('★★★★★ 2026-10-24 ＋ 6 ⇒ 2027-04-24', gas.addMonthsToYmd_('2026-10-24', 6) === '2027-04-24', gas.addMonthsToYmd_('2026-10-24', 6));
  check('★★★★ 2026-08-31 ＋ 6 ⇒ 2027-02-28（冇 31 號就收到月尾）', gas.addMonthsToYmd_('2026-08-31', 6) === '2027-02-28');
  check('★★★★ 2027-12-15 ＋ 1 ⇒ 2028-01-15（跨年）', gas.addMonthsToYmd_('2027-12-15', 1) === '2028-01-15');

  const planned = (year) => [1, 4, 7, 10].map((m, i) => ({
    quarterId: year + 'T' + (i + 1), startDate: year + '-' + (m < 10 ? '0' + m : m) + '-01',
    alreadyExists: (year + 'T' + (i + 1)) === '2027T1'
  }));
  const r = gas.selectLookaheadQuarterPlans_('2026-10-24', 6, planned);
  check('★★★★★ horizon 正確', r.horizon === '2027-04-24', r.horizon);
  check('★★★★★★ 只揀 2027T2（2027T1 已存在；2026T4 已開始；2027T3 超出 6 個月）',
    r.plans.map((p) => p.quarterId).join(',') === '2027T2', r.plans.map((p) => p.quarterId).join(','));
}

console.log('\n=== CB2：ensureLookaheadQuarters_() 逐季寫、逐季記錄 ===');
{
  const executed = [];
  const audits = [];
  gas.getConfig = (key, fb) => {
    if (key === gas.CONFIG_KEYS.SYS_TIMEZONE) return 'Pacific/Auckland';
    if (key === gas.CONFIG_KEYS.QUARTER_LOOKAHEAD_MONTHS) return 9;
    return fb;
  };
  // ⚠️ formatDate 唔可以回常數——planAnnualQuarters_() 數主日要靠佢逐日推。
  // 「今日」由 Date 替身控制（只影響冇參數嘅 new Date()）。
  const RealDate = Date;
  gas.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super('2026-10-24T12:00:00Z'); else super(...a); } };
  gas.Utilities = {
    formatDate: (d) => {
      const pad = (n) => (n < 10 ? '0' + n : String(n));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
  };
  gas.readQuarterTermStartMonths_ = () => ({ 1: 1, 2: 4, 3: 7, 4: 10 });
  gas.readQuarterDateSettings_ = () => ({ leadGenerate: 35, leadOfficial: 14, guardMode: 'NONE' });
  gas.readExistingQuarterAndServiceDateIds_ = () => ({ quarterIds: { '2026T4': true, '2027T1': true }, serviceDateIds: {} });
  const starts = [];
  gas.executeAnnualQuarters_ = (plans) => {
    plans.forEach((p) => starts.push(p.startDate));
    executed.push(plans.map((p) => p.quarterId));
    return { quartersWritten: plans.length, serviceDatesWritten: plans.length * 13, skippedQuarters: [] };
  };
  gas.writeAuditLog_ = (e) => audits.push(e);
  const out = gas.ensureLookaheadQuarters_('test');
  check('★★★★★★ 9 個月內：建立 2027T2、2027T3', out.created.join(',') === '2027T2,2027T3', out.created.join(','));
  check('★★★★★★ 逐季寫（每次 executeAnnualQuarters_ 只得一季，唔係一次過成年）',
    executed.length === 2 && executed.every((x) => x.length === 1), JSON.stringify(executed));
  check('★★★★★ 每建一季一行 AuditLog（自動建立未來季度）',
    audits.length === 2 && audits.every((a) => a.action === '自動建立未來季度'), JSON.stringify(audits.map((a) => a.targetKey)));
  check('★★★★ 已存在嘅 2027T1 冇再寫', executed.every((x) => x.indexOf('2027T1') === -1));
  check('★★★★ 用真嘅 planAnnualQuarters_()（開始日期 2027-04-01、2027-07-01）',
    starts.join(',') === '2027-04-01,2027-07-01', starts.join(','));
}

console.log('\n=== CB3：Config 唔係正整數 ⇒ 預設 6 ===');
{
  ['', 'abc', 0, -3, 2.5].forEach((bad) => {
    warns.length = 0;
    gas.getConfig = (key, fb) => (key === gas.CONFIG_KEYS.QUARTER_LOOKAHEAD_MONTHS ? bad : fb);
    check('★★★★★ 「' + bad + '」⇒ 6，並記 WARN', gas.readQuarterLookaheadMonths_() === 6 && warns.length === 1);
  });
  check('★★★★ 預設值係 6', gas.DEFAULTS.QUARTER_LOOKAHEAD_MONTHS === 6);
  const seed = read('src/ConfigSeed.gs');
  check('★★★★ ConfigSeed 有種子同說明', /key: CONFIG_KEYS\.QUARTER_LOOKAHEAD_MONTHS, type: CONFIG_TYPES\.INT/.test(seed));
  check('★★★★ 基線 JSON 有呢個 Key', /"QUARTER_LOOKAHEAD_MONTHS"/.test(read('docs/config_baseline_上線值.json')));
}

console.log('\n=== CB4：三個入口 ===');
{
  const ui = read('src/ui/Script.html');
  const load = ui.slice(ui.indexOf('async function loadQuarters'), ui.indexOf('async function fillQuarterSelect_'));
  check('★★★★★★ 載入時先叫 apiEnsureFutureQuarters，再讀季度清單',
    /callServerMutating\('apiEnsureFutureQuarters'\)/.test(load) && /fillQuarterSelect_\(null\)/.test(load));
  check('★★★★★ 建唔到唔阻住載入（try/catch）', /try \{\s*await callServerMutating\('apiEnsureFutureQuarters'\);\s*\} catch/.test(load));
  check('★★★★★ 每日自動排程都會做', /ensureLookaheadQuarters_\('dailyAutomationCheck_'\)/.test(read('src/Trigger.gs')));
  const z4 = read('src/ui/ScriptZone4.html');
  check('★★★★★★ 進階與診斷有〔建立未來季度〕', /zone4Row\('建立未來季度'/.test(z4) && /callServerMutating\('apiEnsureFutureQuarters'\)/.test(z4));
  check('★★★★ 建咗之後重填季度選單但保留而家揀緊嗰季', /fillQuarterSelect_\(currentQuarterId\)/.test(z4));
  check('★★★★ apiEnsureFutureQuarters 有鎖', /function apiEnsureFutureQuarters\(\) \{\s*assertWebAppRequestAllowed_\(\);\s*return withMutationLock_\(/.test(read('src/AnnualQuarters.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
