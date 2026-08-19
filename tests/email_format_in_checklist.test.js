// 第二十八輪批次階段 C2：名單檢查嘅「電郵格式看起來不對」報 0，但實際有。
// 執行方式：node tests/email_format_in_checklist.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測
// ─────────────────────────────────────────────────────────────────────
//
// 名單上有一位嘅電郵**結尾多咗一個句號**，但區二「名單檢查」報 0。
//
// 查咗兩個可能：
//   1. 格式檢查規則捉唔到結尾句號　→　**唔係**，`isPlausibleEmail_()` 捉得到
//   2. 檢查規則捉到，但「名單檢查」冇接上　→　**都唔係**，接咗
//
// 真正原因係**檢查範圍**：本來只檢查「本季表上有被排到嘅人」，
// 而嗰位本季啱啱冇被排到，所以完全冇被檢查過。
//
// ⚠️ 一個打錯咗嘅電郵係一個**同季度無關**嘅資料錯誤：
// 佢會喺嗰個人下一次被排到嗰陣先靜靜失敗，而嗰陣先發現就太遲。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppPeople.gs', 'WebAppPreQuarter.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

// ⚠️ 全部樣本用 `.invalid`（RFC 2606 保留），而且動態組出嚟
// ——唔喺原始碼留低完整電郵字面值（敏感資料掃描）。
const D = ['exam', 'ple', '.', 'invalid'].join('');
const AT = '@';

console.log('\n=== C2 可能一：格式檢查本身捉唔捉到結尾句號 ===');
{
  check('★★★★★ 結尾多咗一個句號 ⇒ **捉得到**',
    gas.isPlausibleEmail_('someone' + AT + D + '.') === false);
  check('★★★★ 正常地址 ⇒ 放行', gas.isPlausibleEmail_('someone' + AT + D) === true);
}

console.log('\n=== C2【核心】可能二：檢查範圍——呢個先係真正原因 ===');
{
  const hints = function (input) {
    return gas.planPreQuarterPeopleHints_(input);
  };
  const findBad = function (list) {
    return list.filter(function (h) { return h.id === 'badEmailFormat'; })[0];
  };

  // ⚠️ 假 PersonID 一律 P9xxx，假名一律明顯係假。
  const peopleById = {
    P9001: { personId: 'P9001', nameTC: '測試甲', email: 'a' + AT + D },
    // 呢位**本季冇被排到**，但電郵結尾多咗一個句號。
    P9002: { personId: 'P9002', nameTC: '測試乙', email: 'b' + AT + D + '.' }
  };

  const oldScope = findBad(hints({
    assignments: [{ personId: 'P9001' }],
    peopleById: peopleById,
    roleRows: [], quarterStartDate: '2027-01-01', eligibleCountByPost: {}
  }));
  check('★★★★★ 冇傳「全部在職嘅人」嗰陣，行為同以前一樣（只睇本季表上）'
    + '——呢個係**退回行為**，證明個修法係加範圍而唔係改判斷',
    oldScope.count === 0, JSON.stringify(oldScope));

  const newScope = findBad(hints({
    assignments: [{ personId: 'P9001' }],
    peopleById: peopleById,
    allActivePersonIds: ['P9001', 'P9002'],
    roleRows: [], quarterStartDate: '2027-01-01', eligibleCountByPost: {}
  }));
  check('★★★★★ 傳咗全部在職嘅人 ⇒ **捉到嗰位本季冇被排到嘅**'
    + '——Ivan 實測撞到嘅就係呢個 case',
    newScope.count === 1, JSON.stringify(newScope));
  check('★★★★★ 而且逐個列出係邊位（只講數字嘅話，'
    + '幹事要自己喺成張名單入面搵）',
    newScope.people.length === 1 && newScope.people[0].personId === 'P9002',
    JSON.stringify(newScope.people));
  check('★★★★ 標題講明範圍係「名單上」而唔係「表上」'
    + '——兩者喺同一頁上面同時出現，唔講清楚幹事會以為兩個數字應該一致',
    newScope.label.indexOf('名單上') === 0, newScope.label);
}

console.log('\n=== C2 範圍界線：已停用嘅唔檢查、冇電郵嘅唔當成格式錯 ===');
{
  const hints = gas.planPreQuarterPeopleHints_({
    assignments: [],
    peopleById: {
      P9001: { personId: 'P9001', nameTC: '測試甲', email: '' },
      P9002: { personId: 'P9002', nameTC: '測試乙', email: 'b' + AT + D + '.' }
    },
    // 已停用嗰位（P9003）根本唔喺呢個清單入面。
    allActivePersonIds: ['P9001', 'P9002'],
    roleRows: [], quarterStartDate: '2027-01-01', eligibleCountByPost: {}
  });
  const bad = hints.filter(function (h) { return h.id === 'badEmailFormat'; })[0];
  check('★★★★★ 冇電郵嘅唔算「格式錯」'
    + '——「冇電郵」同「格式錯」係兩件事：前者系統知道佢收唔到，'
    + '後者系統以為佢收到',
    bad.count === 1 && bad.people[0].personId === 'P9002');

  const noEmail = hints.filter(function (h) { return h.id === 'noEmail'; })[0];
  check('★★★★★ 而 `noEmail` **冇一齊改範圍**'
    + '——嗰一項嘅意思真係「本季表上有人會被略過」，範圍係本季',
    noEmail.count === 0, JSON.stringify(noEmail));
}

console.log('\n=== C2 後端真係有備好「全部在職嘅人」 ===');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppPreQuarter.gs'), 'utf8');
  check('★★★★★ buildPreQuarterPeopleHintInputs_() 有讀名單出 allActivePersonIds',
    /allActivePersonIds: allActivePersonIds/.test(src)
    && /readSheet\(SHEETS\.NAME_MAPPING\)[\s\S]{0,200}?isTrueValue_\(row\[M\.ACTIVE\]\)/.test(src));
  check('★★★★ 已停用嘅唔會入清單（佢哋唔會再被排，個電郵冇機會用到）',
    /filter\(function \(row\) \{ return isTrueValue_\(row\[M\.ACTIVE\]\); \}\)/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
