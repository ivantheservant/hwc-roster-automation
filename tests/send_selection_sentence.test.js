// 第六十四輪批次 U 組：寄出彈窗嘅收件摘要，各組分項加埋必須等於總數。
// 執行方式：node tests/send_selection_sentence.test.js
//
// 現場（瀏覽器實測 K-S）：「這一次會寄給 6 位：職事表上全部人 5 位 ＋ 堂委 6 位 ＋ 執事 2 位。」
// 5＋6＋2＝13，總數 6。一個人可以同時屬於幾組，舊寫法逐組數再用「＋」串起嚟，
// 令人以為係加數。
//
// 揀咗做法甲：每個人只算一次，按組嘅次序歸入第一個屬於嘅組，後面嘅組用「另外」。
// 下面用假 key，唔涉及真實姓名。

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ui = loadUiScripts(['Script.html', 'ScriptSendPaper.html']);
const GROUPS = [
  { key: 'ROSTER', label: '職事表上全部人' }, { key: 'COMMITTEE', label: '堂委' },
  { key: 'DEACON', label: '執事' }, { key: 'IT', label: 'IT' },
  { key: 'CLERK', label: '幹事' }, { key: 'CHANGED', label: '只寄給安排有改動的人' }
];
function sentence(pool, picked, extraEmails) {
  ui.__pool = pool; ui.__picked = picked; ui.__extra = extraEmails || []; ui.__groups = GROUPS;
  vm.runInContext(
    'sendPool_ = __pool; sendPoolGroups_ = __groups; '
    + 'sendOptions_ = { pickedKeys: __picked, extraEmails: __extra };', ui);
  return vm.runInContext('describeSendSelection()', ui);
}
/** 由句子抽出所有「N 位／N 個地址」，加埋。 */
function sumOfParts(text) {
  const body = text.split('：')[1] || '';
  return (body.match(/(\d+) (?:位|個地址)/g) || [])
    .reduce((a, m) => a + Number(/\d+/.exec(m)[0]), 0);
}

console.log('\n=== U【核心】一個人同時屬於三組 ===');
{
  // 6 個人：5 個屬職事表；其中 4 個又係堂委；2 個又係執事；另外 1 個只係堂委
  const pool = [
    { key: 'a', sources: ['ROSTER', 'COMMITTEE', 'DEACON'], selectable: true },
    { key: 'b', sources: ['ROSTER', 'COMMITTEE', 'DEACON'], selectable: true },
    { key: 'c', sources: ['ROSTER', 'COMMITTEE'], selectable: true },
    { key: 'd', sources: ['ROSTER', 'COMMITTEE'], selectable: true },
    { key: 'e', sources: ['ROSTER'], selectable: true },
    { key: 'f', sources: ['COMMITTEE'], selectable: true }
  ];
  const t = sentence(pool, ['a', 'b', 'c', 'd', 'e', 'f']);
  console.log('      ' + t);
  check('★★★★★★ 句子冇「＋」', t.indexOf('＋') === -1 && t.indexOf('+') === -1, t);
  check('★★★★★★ 分項加埋等於總數（6）', sumOfParts(t) === 6 && /會寄給 6 位/.test(t), t);
  check('★★★★★ 每人歸入第一個屬於嘅組：職事表 5、另外堂委 1',
    t === '這一次會寄給 6 位：職事表上全部人 5 位、另外堂委 1 位。', t);
}

console.log('\n=== U：其他情況 ===');
{
  const pool = [
    { key: 'a', sources: ['COMMITTEE', 'DEACON'], selectable: true },
    { key: 'b', sources: ['DEACON'], selectable: true },
    { key: 'c', sources: ['CHANGED'], selectable: true },
    { key: 'z', sources: [], selectable: true }
  ];
  const t = sentence(pool, ['a', 'b', 'c', 'z'], ['x@example.invalid']);
  check('★★★★★ 歸組、其他、自訂地址都計入，總數 5', sumOfParts(t) === 5 && /會寄給 5 位/.test(t), t);
  check('★★★★ 第一項冇「另外」，後面每項有', /^這一次會寄給 5 位：堂委 1 位、另外執事 1 位、另外只寄給安排有改動的人 1 位、另外其他 1 位、另外自訂 1 個地址。$/.test(t), t);
  check('★★★★ 淨係自訂地址', sentence(pool, [], ['x@example.invalid']) === '這一次會寄給 1 位：自訂 1 個地址。');
  check('★★★ 冇揀 ⇒ 照舊', sentence(pool, [], []) === '還沒有選任何收件人。');
}

console.log('\n=== U：原始碼不再用「＋」串各組 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptSendPaper.html'), 'utf8');
  const fn = src.slice(src.indexOf('function describeSendSelection()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'))
    .replace(/\/\/.*$/gm, '');
  check('★★★★★ 函式本體冇 join(\' ＋ \')', body.indexOf("' ＋ '") === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
