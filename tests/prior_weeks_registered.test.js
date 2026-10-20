// 第六十三輪批次 I 組：跨季「連續兩週」檢查會讀到未登記嘅版本。
// 執行方式：node tests/prior_weeks_registered.test.js
//
// `readPriorWeeks_()` 按「每個主日最大 VersionNo」取上季最後幾週，**唔核對
// `RosterVersions` 有冇登記**。現場：`RosterAssignments` 有 273 行
// `2026T4 VersionNo=2`，`RosterVersions` 只有 v0／v1。今次剛好差嘅格唔喺
// 最後兩週，所以冇影響——但嗰個係運氣。
// 下面用假 ID（P96xx）。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}

const gas = loadGasSource(FILES_FOR_GENERATOR);
const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
const V = gas.COLUMNS.ROSTER_VERSIONS;
function cell(v, date, personId) {
  const r = {};
  r[A.QUARTER_ID] = '2099T1'; r[A.VERSION_NO] = v; r[A.SERVICE_DATE] = date;
  r[A.POST_ID] = 'READ'; r[A.SLOT_INDEX] = 1; r[A.PERSON_ID] = personId;
  return r;
}
function ver(v) { const r = {}; r[V.QUARTER_ID] = '2099T1'; r[V.VERSION_NO] = v; return r; }
let versions = [ver(0), ver(1)];
const assignments = [
  cell(1, '2099-03-22', 'P9601'), cell(1, '2099-03-29', 'P9602'),
  // v2：寫咗一半、冇登記嘅孤兒版本——最後一週換咗人
  cell(2, '2099-03-22', 'P9601'), cell(2, '2099-03-29', 'P9699')
];
gas.readSheet = function (name) {
  if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) return assignments;
  if (name === gas.SHEETS.ROSTER_VERSIONS) return versions;
  return [];
};

console.log('\n=== I【核心】只用有登記嘅版本 ===');
{
  const weeks = gas.readPriorWeeks_('2099-04-05', 2, 'Pacific/Auckland');
  check('（前置）攞到兩週', weeks.length === 2, JSON.stringify(weeks));
  check('★★★★★★ 最後一週用登記咗嘅 v1（P9602），唔係孤兒 v2（P9699）',
    JSON.stringify(weeks[1]) === JSON.stringify({ READ: ['P9602'] }), JSON.stringify(weeks));
  versions = [ver(0), ver(1), ver(2)];
  const weeks2 = gas.readPriorWeeks_('2099-04-05', 2, 'Pacific/Auckland');
  check('★★★★★ 對照：v2 登記咗之後就用 v2',
    JSON.stringify(weeks2[1]) === JSON.stringify({ READ: ['P9699'] }), JSON.stringify(weeks2));
  check('★★★★ 版本號字串同數字當同一個',
    gas.registeredVersionKey_('2099T1', '2') === gas.registeredVersionKey_(' 2099T1 ', 2));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
