// 第七十五輪批次 CM 組：〔不能服侍的日期〕預設只顯示揀咗嘅季度（生效中、日期重疊）。
// 執行方式：node tests/round75_cm_unavailable_quarter.test.js
//
// Ivan 手動測試 A：重設 2028T3 之後見到一堆紀錄，以為係測試資料冇清，
// 其實係其他季度嘅（`Unavailable` 冇季度欄，舊畫面全部列出）。
//
//   CM1　後端：每筆標 `inQuarter`（同季度日期範圍重疊）；回傳 quarterStart／quarterEnd
//   CM2　前端：預設只列 inQuarter 而生效中；有「顯示其他季度和已取消的」；勾咗先列晒
//   CM3　新增：預設日期落喺呢一季之內（今日喺季度入面 ⇒ 今日，否則季度第一日）

const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'Generator.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppUnavailable.gs'
]);
const TZ = 'Pacific/Auckland';
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }
};
gas.assertWebAppRequestAllowed_ = function () {};
gas.getConfig_ = (key, fallback) => (key === gas.CONFIG_KEYS.SYS_TIMEZONE ? TZ : fallback);
gas.log_ = function () {};
gas.readPosts_ = () => [];
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};

const U = gas.COLUMNS.UNAVAILABLE;
const M = gas.COLUMNS.NAME_MAPPING;
const Q = gas.COLUMNS.QUARTERS;
function un(id, pid, from, to, status) {
  const r = {};
  r[U.UNAVAILABLE_ID] = id; r[U.PERSON_ID] = pid; r[U.DATE_FROM] = from; r[U.DATE_TO] = to;
  r[U.APPLIES_TO] = 'ALL'; r[U.STATUS] = status || 'ACTIVE';
  return r;
}
const people = ['P9701', 'P9702', 'P9703', 'P9704'].map((id) => {
  const r = {}; r[M.PERSON_ID] = id; r[M.NAME_TC] = '人' + id.slice(-1); r[M.ACTIVE] = 'TRUE'; return r;
});
const quarter = {}; quarter[Q.QUARTER_ID] = '2099T3'; quarter[Q.START_DATE] = '2099-07-01'; quarter[Q.END_DATE] = '2099-09-30';
gas.readSheet_ = function (name) {
  if (name === gas.SHEETS.NAME_MAPPING) return people;
  if (name === gas.SHEETS.QUARTERS) return [quarter];
  if (name === gas.SHEETS.UNAVAILABLE) {
    return [
      un('U1', 'P9701', '2099-07-09', '2099-07-09'),            // 本季
      un('U2', 'P9702', '2099-06-25', '2099-07-02'),            // 跨入本季
      un('U3', 'P9703', '2099-11-01', '2099-11-30'),            // 其他季度
      un('U4', 'P9704', '2099-08-01', '2099-08-01', 'CANCELLED') // 本季但已取消
    ];
  }
  return [];
};

console.log('\n=== CM1：後端標 inQuarter ===');
const data = gas.apiListUnavailable('2099T3', '');
{
  const byId = {};
  data.current.concat(data.past, data.cancelled).forEach((r) => { byId[r.unavailableId] = r; });
  check('★★★★★ quarterStart／quarterEnd 由 Quarters 讀出', data.quarterStart === '2099-07-01' && data.quarterEnd === '2099-09-30', data.quarterStart + '~' + data.quarterEnd);
  check('★★★★★★ 本季嗰筆 inQuarter=true', byId.U1 && byId.U1.inQuarter === true);
  check('★★★★★ 跨入本季嗰筆 inQuarter=true（重疊就算）', byId.U2 && byId.U2.inQuarter === true);
  check('★★★★★★ 十一月嗰筆 inQuarter=false', byId.U3 && byId.U3.inQuarter === false);
  check('★★★★ 已取消照舊分去 cancelled', data.cancelled.length === 1 && data.cancelled[0].unavailableId === 'U4');
  check('★★★★ 純函式：冇 DateTo 當一日；冇範圍一律當重疊',
    gas.unavailableOverlapsRange_('2099-07-01', '', { start: '2099-07-01', end: '2099-09-30' }) === true
    && gas.unavailableOverlapsRange_('2099-06-30', '', { start: '2099-07-01', end: '2099-09-30' }) === false
    && gas.unavailableOverlapsRange_('2000-01-01', '2000-01-02', null) === true);
}

console.log('\n=== CM2：前端預設只列本季生效中 ===');
const ui = loadUiScripts(['Script.html', 'ScriptZone3.html']);
vm.runInContext("currentQuarterId = '2099T3';", ui);
ui.unavailableData_set = null;
vm.runInContext('unavailableData = ' + JSON.stringify(data) + '; unavailableShowAll_ = false;', ui);
ui.renderUnavailable('');
const body = () => ui.document.getElementById('modalBody');
{
  const t = body().textContent;
  check('★★★★★★ 預設：本季兩筆有列', /人1/.test(t) && /人2/.test(t), t.slice(0, 400));
  check('★★★★★★ 預設：其他季度嗰筆冇列', !/人3/.test(t), t.slice(0, 400));
  check('★★★★★ 預設：已取消嗰筆冇列', !/人4/.test(t), t.slice(0, 400));
  check('★★★★ 講明另有幾筆冇顯示', /另有 2 筆是其他季度、已過去或已取消的紀錄/.test(t), t);
  const cb = body().flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox')[0];
  check('★★★★★ 有「顯示其他季度和已取消的」勾選格（預設唔勾）', cb && cb.checked === false && /顯示其他季度和已取消的/.test(t));
  cb.checked = true;
  cb.fire('change');
  const t2 = body().textContent;
  check('★★★★★★ 勾咗之後其他季度同已取消都列出', /人3/.test(t2) && /人4/.test(t2), t2.slice(0, 500));
}

console.log('\n=== CM3：新增預設日期落喺本季 ===');
{
  check('★★★★★ 今日喺季度之前 ⇒ 季度第一日',
    ui.defaultUnavailableDate({ quarterStart: '2099-07-01', quarterEnd: '2099-09-30', today: '2099-05-01' }) === '2099-07-01');
  check('★★★★★ 今日喺季度入面 ⇒ 今日',
    ui.defaultUnavailableDate({ quarterStart: '2099-07-01', quarterEnd: '2099-09-30', today: '2099-08-15' }) === '2099-08-15');
  check('★★★★ 讀唔到季度 ⇒ 空白（照舊）', ui.defaultUnavailableDate({ today: '2099-08-15' }) === '');
  vm.runInContext("unavailableData.today = '2099-05-01';", ui);
  ui.openUnavailableEditor(null);
  const dates = body().flatten().filter((n) => n.tagName === 'INPUT' && n.value === '2099-07-01');
  check('★★★★★ 新增畫面嘅日期預設係 2099-07-01', dates.length >= 1, String(dates.length));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
