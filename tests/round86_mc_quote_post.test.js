// 第八十六輪批次 MC 組：人手檢查的句子，崗位名稱加「」。
// 執行方式：node tests/round86_mc_quote_post.test.js
//
//   MC1　每一種原因的一段話：崗位名稱每次出現都包在「」裏（「PPT 控制」：…可以：在「PPT 控制」名單加人，…）
//   MC2　改動之後的提示：「⚠ 人手檢查：「PPT 控制」人手不足，最少會有 1 格留空」；多個崗位用「、」分開
//   MC3　開季前準備那一行：人手不足：N 個崗位（最少 M 格會留空）——「甲」、「乙」
//   MC4　季前資料第六段、生成確認窗用同一支一段話（p.text），所以同樣有「」
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'PersonPostWeight.gs',
  'Generator.gs', 'FineTune.gs', 'Verify.gs']);
const R = gas.STAFFING_REASON;
// 崗位名稱每一次出現都有「」包住
const allQuoted = (text, name) => {
  const total = text.split(name).length - 1;
  const quoted = text.split('「' + name + '」').length - 1;
  return total > 0 && total === quoted;
};

console.log('\n=== MC1：一段話 ===');
{
  const reasons = ['POST_MAX', 'NO_POOL', 'ALL_UNAVAILABLE', 'ROLE', 'EXCLUDED', 'MUTEX', 'QUARTER_MAX'];
  reasons.forEach((code) => {
    const b = { postNameTC: 'PPT 控制', slotCount: 1, weeks: 13, needed: 13, blanks: 1, filled: 12, poolCount: 12, limit: 1,
      reasons: { [R[code]]: 1 } };
    const t = gas.describeStaffingPost_(b);
    check('★★★★★★ ' + code + '：崗位名稱每次都有「」；開頭是「「PPT 控制」：13 週需要 13 人次」',
      allQuoted(t, 'PPT 控制') && /^「PPT 控制」：13 週需要 13 人次；/.test(t) && !/在PPT|在 PPT/.test(t), t);
  });
  const t1 = gas.describeStaffingPost_({ postNameTC: 'PPT 控制', slotCount: 1, weeks: 13, needed: 13, blanks: 1, filled: 12, poolCount: 12, limit: 1,
    reasons: { [R.ALL_UNAVAILABLE]: 1 } });
  check('★★★★★★ Ivan 的例子：可以：在「PPT 控制」名單加人，或者請其中一位改期。', /可以：在「PPT 控制」名單加人，或者請其中一位改期。$/.test(t1), t1);
  const t2 = gas.describeStaffingPost_({ postNameTC: '讀經', slotCount: 1, weeks: 13, needed: 13, blanks: 8, filled: 5, poolCount: 5, limit: 1,
    reasons: { [R.POST_MAX]: 8 } });
  check('★★★★★★ 讀經：可以：在「讀經」名單加人，或者把「讀經」的上限改高。', /可以：在「讀經」名單加人，或者把「讀經」的上限改高。$/.test(t2), t2);
}

console.log('\n=== MC2：改動之後的提示 ===');
{
  const one = gas.describeStaffingChange_(null, { totalBlanks: 1, posts: [{ postNameTC: 'PPT 控制' }] });
  check('★★★★★★ ⚠ 人手檢查：「PPT 控制」人手不足，最少會有 1 格留空', /^⚠ 人手檢查：「PPT 控制」人手不足，最少會有 1 格留空。/.test(one), one);
  const two = gas.describeStaffingChange_(null, { totalBlanks: 2, posts: [{ postNameTC: '讀經' }, { postNameTC: 'PPT 控制' }] });
  check('★★★★★ 兩個崗位：「讀經」、「PPT 控制」人手不足', /^⚠ 人手檢查：「讀經」、「PPT 控制」人手不足/.test(two), two);
}

console.log('\n=== MC3：開季前準備那一行 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const t = ui.staffingShortText({ shortPostCount: 2, totalBlanks: 3, posts: [{ postNameTC: '讀經' }, { postNameTC: 'PPT 控制' }] });
  check('★★★★★★ 人手不足：2 個崗位（最少 3 格會留空）——「讀經」、「PPT 控制」', t === '人手不足：2 個崗位（最少 3 格會留空）——「讀經」、「PPT 控制」', t);
}

console.log('\n=== MC4：季前資料第六段、生成確認窗用同一支一段話 ===');
{
  const pre = fs.readFileSync('src/PreseasonPack.gs', 'utf8');
  const z1 = fs.readFileSync('src/ui/ScriptZone1.html', 'utf8');
  const zone2 = fs.readFileSync('src/ui/ScriptZone2.html', 'utf8');
  check('★★★★★ 季前資料第六段用 p.text', /return p\.text \+ \(p\.blankWeeks\.length/.test(pre));
  check('★★★★★ 生成確認窗用 p.text', /'・' \+ p\.text/.test(z1));
  check('★★★★★ 〔人手檢查〕視窗用 p.text', /make\('div', \{ text: p\.text, className: 'vio-head' \}\)/.test(zone2));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;
