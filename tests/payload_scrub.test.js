// 第四十九輪批次 第 2 層 2B：匯出 payload 之前嘅洗資料。
// 執行方式：node tests/payload_scrub.test.js
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一支洗唔乾淨嘅代價
// ═════════════════════════════════════════════════════════════════════
//
// 自測機錄低嘅係**真實回傳值**——入面有真人姓名、真電郵、真 PersonID。
// 呢個 repo 係公開嘅。
//
// 一份「洗咗九成」嘅資料入咗公開 repo，就係一次真實嘅個人資料外洩，
// 而佢換返嚟嘅只係一層測試。**呢個交換完全唔值。**
//
// 所以呢一份守嘅係三件事：
//   一、三種東西（姓名／電郵／PersonID）全部要換走
//   二、對照表要**一致**——同一個人喺兩處要換成同一個代號
//   三、洗完之後個 JSON 要 parse 得返

const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs'
]);

/** 一組假嘅「真名」——特登用同一個姓，測長短排序。 */
const NAME_MAP = [
  { from: '假甲乙丙', to: '測試人物01' },
  { from: '假甲乙', to: '測試人物02' },
  { from: '假戊己', to: '測試人物03' }
];

function freshMaps() {
  return { names: NAME_MAP, emails: {}, persons: {} };
}

// =====================================================================
console.log('\n=== 一【核心】三種東西全部要換走 ===');
{
  const maps = freshMaps();
  const raw = JSON.stringify({
    recipients: [
      // 例如一個未洗過嘅 PersonID（洗完會變 P9NNN）
      { personId: 'P012', nameTC: '假甲乙', email: 'someone@a-church.test' },   // 例如
      // 例如一個四位數嘅（洗完一樣會變 P9NNN）
      { personId: 'P0345', nameTC: '假戊己', email: 'Another_One@a-mail.test' }   // 例如
    ]
  });
  const out = gas.scrubPayloadText_(raw, maps);

  check('★★★★★★ 真人姓名換走晒',
    out.indexOf('假甲乙') === -1 && out.indexOf('假戊己') === -1, out);
  // ⚠️ 呢度用 `.test`（RFC 2606 保留）做「唔係 .invalid 嘅網域」。
  // 用一個似真嘅網域嚟做 fixture，本身就係喺公開 repo 度放一個真網域
  // ——而 `tools/scan-staged-secrets.js` 會（正確噉）擋住。
  check('★★★★★★ 電郵換走晒（連網域）'
    + '——留返網域就等於留低教會身分',
    !/a-church\.test/.test(out) && !/a-mail\.test/.test(out), out);
  check('★★★★★★ PersonID 換走晒',
    !/\bP012\b/.test(out) && !/\bP0345\b/.test(out), out);
  check('★★★★★ 換完之後係 `.invalid` 網域（RFC 2606 保留，一定唔會解析到）',
    (out.match(/@example\.invalid/g) || []).length === 2, out);
  check('★★★★★ 換完之後 PersonID 係 `P9NNN`',
    (out.match(/P9\d{3}/g) || []).length === 2, out);

  // ⚠️ 洗完一定要 parse 得返——洗嗰一步整爛咗個 JSON 嘅話，
  // 匯出嘅就係一份壞檔案，而重播嗰陣先至發現。
  let parsed = null;
  try { parsed = JSON.parse(out); } catch (err) { parsed = null; }
  check('★★★★★★ 洗完之後 JSON 仲 parse 得返', parsed !== null, out);
}

// =====================================================================
console.log('\n=== 二【核心】對照表要一致 ===');
{
  // ⚠️ 同一個人喺兩處要換成同一個代號。
  // 唔一致嘅話，一份資料入面同一個人會變成兩個人，
  // 而重播出嚟嘅畫面就同真實嗰個唔一樣。
  const maps = freshMaps();
  const a = gas.scrubPayloadText_(
    JSON.stringify({ id: 'P012', mail: 'x@a-church.test' }), maps);   // 例如
  const b = gas.scrubPayloadText_(
    JSON.stringify({ id: 'P012', mail: 'x@a-church.test' }), maps);   // 例如
  checkEqual('★★★★★★ 同一份輸入，兩次洗出同一個結果', a, b);

  const c = gas.scrubPayloadText_(
    JSON.stringify({ id: 'P013', mail: 'y@a-church.test' }), maps);   // 例如
  check('★★★★★ 唔同嘅人換成唔同代號',
    JSON.parse(c).id !== JSON.parse(a).id
      && JSON.parse(c).mail !== JSON.parse(a).mail,
    a + ' vs ' + c);
}

// =====================================================================
console.log('\n=== 三【核心】長名要排喺短名前面 ===');
{
  // ⚠️ 一個包住另一個嘅名，短嗰個先換就會剩返一截。
  // 例如「假甲乙」先換走，「假甲乙丙」就會變成「測試人物02丙」——
  // 而嗰一個「丙」係由真名剩返落嚟嘅。
  const maps = freshMaps();
  const out = gas.scrubPayloadText_(JSON.stringify({ n: '假甲乙丙' }), maps);
  checkEqual('★★★★★★ 「假甲乙丙」整個換走，唔會剩返一截真名',
    JSON.parse(out).n, '測試人物01');

  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'src', 'SelfTestRunner.gs'), 'utf8');
  check('★★★★★★ 而且對照表本身有由長到短排',
    /names\.sort\(function \(a, b\) \{ return b\.length - a\.length; \}\);/.test(src), '');
}

// =====================================================================
console.log('\n=== 四 已經係測試資料嘅唔會再換一次 ===');
{
  // ⚠️ 再換一次唔係「換多咗」——係會令兩次匯出嘅同一個人變成唔同代號，
  // 而 `tests/payloads/` 入面幾份檔案就對唔返上。
  const maps = freshMaps();
  const out = gas.scrubPayloadText_(
    JSON.stringify({ id: 'P9001', mail: 'p01@example.invalid' }), maps);
  const parsed = JSON.parse(out);
  checkEqual('★★★★★ 已經係 `P9NNN` 嘅唔會再換', parsed.id, 'P9001');
  checkEqual('★★★★★ 已經係 `.invalid` 嘅唔會再換', parsed.mail, 'p01@example.invalid');
}

// =====================================================================
console.log('\n=== 五 洗唔到嗰幾行要報出嚟，唔可以靜靜略過 ===');
{
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'src', 'SelfTestRunner.gs'), 'utf8');
  check('★★★★★★ 洗完 parse 唔返嘅行要收集起嚟報告'
    + '——靜靜略過就會匯出一份「少咗幾筆」而睇落正常嘅檔案',
    /broken\.push\(/.test(src) && /沒有匯出/.test(src), '');
  check('★★★★★★ 而且要提醒「放入 repo 之前再跑一次 scan-staged-secrets」'
    + '——呢一支只係第一道，唔係最後一道',
    /scan-staged-secrets/.test(src), '');
  check('★★★★★★ 同埋要講明「洗唔乾淨就唔好放進去」',
    /洗不乾淨就不要放進去/.test(src), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
