// 第一百零九輪批次 SB 組：跨季「上一週」基準只用緊接上一季的主日（Generator.gs readPriorWeeksInfo_()）
// 執行方式：node tests/round109_sb_prior_weeks.test.js
// 下面用假 ID（P97xx）。

const fs = require('fs');
const path = require('path');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 800));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource(FILES_FOR_GENERATOR);
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const V = gas.COLUMNS.ROSTER_VERSIONS;
const TZ = 'Pacific/Auckland';

function setRows(dates) {
  const rows = dates.map(function (d, i) {
    const r = {};
    r[A.QUARTER_ID] = 'QX'; r[A.VERSION_NO] = 0; r[A.SERVICE_DATE] = d; r[A.POST_ID] = 'CHAIR'; r[A.PERSON_ID] = 'P97' + String(i).padStart(2, '0');
    return r;
  });
  const vr = {}; vr[V.QUARTER_ID] = 'QX'; vr[V.VERSION_NO] = 0;
  gas.readSheet_ = function (name) {
    if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return rows;
    if (name === gas.SHEETS.ROSTER_VERSIONS) return [vr];
    return [];
  };
}

console.log('\n=== SB1 緊接上一季 ⇒ 照用，不提示 ===');
{
  // 這一季第一個主日 2027-04-04；上一季最後兩個主日 03-21、03-28
  setRows(['2027-03-14', '2027-03-21', '2027-03-28']);
  const info = gas.readPriorWeeksInfo_('2027-04-01', 2, TZ, '2027-04-04');
  check('★★★★★ 用最後兩個緊接的主日', info.dates.join() === '2027-03-21,2027-03-28', JSON.stringify(info.dates));
  check('★★★★★ 不提示', gas.describePriorWeeksGap_(info) === '');
  check('★★★★ readPriorWeeks_() 回傳同一份', gas.readPriorWeeks_('2027-04-01', 2, TZ, '2027-04-04').length === 2);
}

console.log('\n=== SB2 隔了一季（上一季是人手排、未匯入）⇒ 不用，並提示 ===');
{
  setRows(['2026-12-20', '2026-12-27']);
  const info = gas.readPriorWeeksInfo_('2027-04-01', 2, TZ, '2027-04-04');
  check('★★★★★★ 不用 2026 年 12 月的主日當「上一週」', info.weeks.length === 0, JSON.stringify(info.dates));
  const note = gas.describePriorWeeksGap_(info);
  check('★★★★★★ 提示寫明最近一個有資料的主日及請先匯入', /找不到上一季最後 2 週/.test(note) && /2026-12-27/.test(note) && /請先匯入/.test(note), note);
}

console.log('\n=== SB3 只得一週（例如合堂令其中一週沒有資料）⇒ 用一週並提示 ===');
{
  setRows(['2027-03-28']);
  const info = gas.readPriorWeeksInfo_('2027-04-01', 2, TZ, '2027-04-04');
  check('★★★★★ 用那一週', info.dates.join() === '2027-03-28');
  check('★★★★★ 少於 CARRY_OVER_WEEKS ⇒ 提示', gas.describePriorWeeksGap_(info) !== '');
  // 隔一週沒有資料（合堂）仍然在範圍之內：2×7＋6＝20 日
  setRows(['2027-03-14', '2027-03-28']);
  const info2 = gas.readPriorWeeksInfo_('2027-04-01', 2, TZ, '2027-04-04');
  check('★★★★ 用日數判斷，不要求逐週連續（03-14 距離 21 日 ⇒ 超出 20 日，不用）', info2.dates.join() === '2027-03-28', JSON.stringify(info2.dates));
}

console.log('\n=== SB4 CARRY_OVER_WEEKS=0 ⇒ 不提示 ===');
{
  setRows([]);
  const info = gas.readPriorWeeksInfo_('2027-04-01', 0, TZ, '2027-04-04');
  check('★★★★★ 不提示', gas.describePriorWeeksGap_(info) === '' && info.weeks.length === 0);
}

console.log('\n=== SB5 三處顯示及同一支函式 ===');
{
  const gen = read('src/Generator.gs');
  check('★★★★★ 生成 context 用 readPriorWeeksInfo_()（調整、儲存檢查都經 buildGeneratorContext_()）',
    /priorWeeks: priorInfo\.weeks/.test(gen) && /priorWeeksNote: describePriorWeeksGap_\(priorInfo\)/.test(gen));
  check('★★★★★ 生成確認窗及完成窗', (read('src/WebAppGenerate.gs').match(/priorWeeksNote: computePriorWeeksNoteForQuarter_/g) || []).length === 2
    && /plan\.priorWeeksNote/.test(read('src/ui/ScriptZone1.html')) && /res\.priorWeeksNote/.test(read('src/ui/ScriptZone1.html')));
  check('★★★★★ 「這一季還要做的」', /if \(d && d\.priorWeeksNote\) summary\.appendChild/.test(read('src/ui/ScriptZone2.html')) && /priorWeeksNote: versionExists/.test(read('src/WebAppDashboard.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
