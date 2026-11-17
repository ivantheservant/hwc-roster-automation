// 第一百一十一輪批次 SG 組：〔上線前檢查〕補項及狀態卡「自動排程最近沒有執行」
// 執行方式：node tests/round111_sg_prelaunch_golive.test.js
// 下面用假地址（example.invalid）及 2099 年的假季度。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'PreLaunchGoLive.gs']);

const Q = (id, start, stage) => ({ id: id, start: start, stage: stage || 'DRAFT' });
const QUARTERS = [Q('2098T4', '2098-10-01', 'OFFICIAL_SENT'), Q('2099T1', '2099-01-01', 'OFFICIAL_SENT'), Q('2099T2', '2099-04-01'),
  Q('2099T3', '2099-07-01'), Q('2099T4', '2099-10-01')];
const base = (o) => Object.assign({ goLiveId: '2099T2', today: '2099-02-15', quarters: QUARTERS, versionsByQuarter: { '2098T4': 2, '2099T1': 3 },
  officialByQuarter: { '2098T4': true, '2099T1': true }, resetBlocked: ['2098T4', '2099T1'], backfillBlocked: ['2098T4', '2099T1'], priorNote: '' }, o || {});
const byLabel = (items, part) => items.filter((i) => i.label.indexOf(part) !== -1)[0];

console.log('\n=== SG1：上線季度四項 ===');
{
  let items = gas.buildGoLiveQuarterItems_(base());
  check('★★★★★★ 全部正確 ⇒ 四項 ✔', items.length === 4 && items.every((i) => i.ok && i.where), JSON.stringify(items));
  items = gas.buildGoLiveQuarterItems_(base({ today: '2099-04-05' }));
  check('★★★★★★ 1：上線季度已開始 ⇒ ✘，提示要改', !byLabel(items, '上線季度（GO_LIVE_QUARTER_ID）').ok && /已經開始/.test(byLabel(items, '上線季度（GO_LIVE').value)
    && /請改為下一個/.test(byLabel(items, '上線季度（GO_LIVE').value));
  items = gas.buildGoLiveQuarterItems_(base({ versionsByQuarter: { '2099T2': 1 } }));
  check('★★★★★ 1：上線季度已有版本 ⇒ ✘', !byLabel(items, '上線季度（GO_LIVE').ok && /已有 1 個版本/.test(byLabel(items, '上線季度（GO_LIVE').value));
  items = gas.buildGoLiveQuarterItems_(base({ resetBlocked: ['2098T4'], backfillBlocked: [] }));
  const prot = byLabel(items, '受保護');
  check('★★★★★★ 2：已正式發出而不在保護清單 ⇒ 逐張清單列出', !prot.ok && /不在 QUARTER_RESET_BLOCKED_QUARTERS：2099T1/.test(prot.value)
    && /不在 COMBINED_BACKFILL_BLOCKED_QUARTERS：2098T4、2099T1/.test(prot.value), prot.value);
  items = gas.buildGoLiveQuarterItems_(base({ quarters: QUARTERS.map((q) => Object.assign({}, q, { stage: 'DRAFT' })), officialByQuarter: { '2099T1': true }, resetBlocked: ['2099T1'], backfillBlocked: ['2099T1'] }));
  check('★★★★★ 2：「已正式發出」看 SendLog 或 Stage（2098T4 兩者都不是 ⇒ 不要求）', byLabel(items, '受保護').ok, byLabel(items, '受保護').value);
  items = gas.buildGoLiveQuarterItems_(base({ versionsByQuarter: { '2099T3': 1, '2099T4': 2 } }));
  const tq = byLabel(items, '測試季度');
  check('★★★★★★ 3：上線之後有版本的季度 ⇒ 列出、提示清理', !tq.ok && /2 季有版本：2099T3、2099T4/.test(tq.value) && /整季重設/.test(tq.value), tq.value);
  items = gas.buildGoLiveQuarterItems_(base({ priorNote: '系統內找不到上一季最後 2 週的職事表' }));
  check('★★★★★★ 4：上一季資料不足 ⇒ ✘，寫 SB 組那一句', !byLabel(items, '上一季').ok && /找不到上一季/.test(byLabel(items, '上一季').value));
  items = gas.buildGoLiveQuarterItems_(base({ goLiveId: '' }));
  check('★★★★★ 未填上線季度 ⇒ 四項 ✘，不拋錯', items.length === 4 && items.every((i) => !i.ok));
}

console.log('\n=== SG2：轉寄只有開發帳戶（第 10 項） ===');
{
  const dev = 'dev@example.invalid';
  check('★★★★★★ 一個地址、與開發帳戶相同 ⇒ ✔（不寫出地址）', gas.buildRedirectSingleTargetItem_([dev], [dev, 'b@example.invalid']).ok
    && gas.buildRedirectSingleTargetItem_([dev], [dev]).value === '一個地址，與開發帳戶相同');
  check('★★★★★★ 兩個地址 ⇒ ✘', !gas.buildRedirectSingleTargetItem_([dev, 'x@example.invalid'], [dev]).ok);
  const other = gas.buildRedirectSingleTargetItem_(['x@example.invalid'], [dev]);
  check('★★★★★ 一個但不是開發帳戶 ⇒ ✘，不寫出地址', !other.ok && other.value.indexOf('@') === -1, other.value);
  check('★★★★ 已清空 ⇒ ✔', gas.buildRedirectSingleTargetItem_([], [dev]).ok);
}

console.log('\n=== SG3：狀態卡「自動排程最近沒有執行」 ===');
{
  const alert = gas.describeAutomationStaleAlert_;
  check('★★★★★★ 未安裝 ⇒ 沒有紅字（照現有提示）', alert(false, null, '2099-01-03 10:00') === '');
  check('★★★★★★ 35 小時內、沒有錯誤 ⇒ 沒有紅字', alert(true, { at: '2099-01-02 00:00', ok: true }, '2099-01-03 11:00') === '');
  check('★★★★★★ 超過 36 小時 ⇒ 紅字，寫最近一次及去哪裏看', /自動排程最近沒有執行（最近一次是 2099-01-01 09:23，已超過 36 小時）/.test(alert(true, { at: '2099-01-01 09:23', ok: true }, '2099-01-03 09:24'))
    && /自動排程狀態/.test(alert(true, { at: '2099-01-01 09:23', ok: true }, '2099-01-03 09:24')));
  check('★★★★★ 跨月份也算對（1 月 31 日 → 2 月 2 日）', alert(true, { at: '2099-01-31 09:00', ok: true }, '2099-02-02 09:00') !== '');
  check('★★★★★★ 最近一次有錯誤 ⇒ 紅字', /有錯誤/.test(alert(true, { at: '2099-01-03 09:23', ok: false }, '2099-01-03 10:00')));
  check('★★★★★ 已安裝但沒有執行紀錄 ⇒ 紅字', /沒有執行紀錄/.test(alert(true, null, '2099-01-03 10:00')));
}

console.log('\n=== SG4：接線 ===');
{
  const go = read('src/PreLaunchGoLive.gs');
  ['電郵主旨的測試字首（MAIL_SUBJECT_PREFIX）已清空', '使用指南連結（USER_GUIDE_URL）已填', '修改申報、特別主日沒有測試行（Requests／SpecialSundays）']
    .forEach((l) => check('★★★★★ 上線前檢查有「' + l + '」', go.indexOf("add('" + l + "'") !== -1));
  check('★★★★★ 測試行：Requests 備註、處理結果、名字；SpecialSundays 名稱、備註', /countTestRows_\(SHEETS\.REQUESTS, \[R\.NOTES, R\.RESULT_NOTE, R\.PERSON_NAME\]\)/.test(go)
    && /countTestRows_\(SHEETS\.SPECIAL_SUNDAYS, \[S\.TITLE, S\.NOTES\]\)/.test(go));
  check('★★★★★ 上一季資料用 SB 組同一支（computePriorWeeksNoteForQuarter_）', /priorNote: goLiveId \? computePriorWeeksNoteForQuarter_\(goLiveId\) : ''/.test(go));
  check('★★★★★★ 〔上線前檢查〕加入這些項目；原有「測試轉寄已清空」照舊', /appendGoLivePreLaunchItems_\(add, config\)/.test(read('src/PreLaunchWeb.gs'))
    && /測試轉寄（MAIL_REDIRECT_ALL_TO）已清空/.test(read('src/PreLaunchWeb.gs')));
  check('★★★★★★ 狀態資料 automationAlert；頁頂紅字', /automationAlert: typeof readAutomationStaleAlert_ === 'function' \? readAutomationStaleAlert_\(\) : ''/.test(read('src/WebAppDashboard.gs'))
    && /auto\.textContent = String\(d\.automationAlert \|\| ''\)/.test(read('src/ui/Script.html')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
