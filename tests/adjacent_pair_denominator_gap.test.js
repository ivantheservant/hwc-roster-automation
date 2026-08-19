// 第三十三輪批次階段 E：兩個分母唔同嗰陣要講出嚟。
// 執行方式：node tests/adjacent_pair_denominator_gap.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 背景（第三十二輪階段 C′2 留低嘅尾巴）
// ═════════════════════════════════════════════════════════════════════
//
// 「報告連續」有兩個分母，而且**刻意唔一樣**：
//
//   目標嗰邊　`adjacentPairCount_(週數)`　　理論值 `週數 − 1`
//   實測嗰邊　`announce.pairs`　　　　　　　真正數到、兩邊都排到人嘅 pair
//
// 有週次冇排報告嗰陣兩者會唔同，而**嗰個唔同係有意義嘅**——夾硬用理論值
// 做實測分母，等於把一個準確嘅量度改成一個估算（第三十二輪已經拍板）。
//
// 但報告只印兩個數、唔解釋，讀嘅人會以為係 bug。
//
// ⚠️ 呢一輪**冇改** `Generator.gs` 嘅 `announceConsecutive` 分母
//（第三十二輪已經拍板保留 `weeksCounted`）。呢度純粹係顯示層。

const { loadGasSource } = require('./helpers/gas_loader');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs']);

console.log('\n=== E：兩個分母一樣 ⇒ 一個字都唔好多印 ===');
{
  // 13 個主日 ⇒ 理論 12 對。實際都係 12 對 ⇒ 冇嘢要解釋。
  checkEqual('★★★★★ 12 對 vs 12 對 ⇒ 回空字串（唔好印一句廢話）',
    gas.describeAdjacentPairDenominatorGap_(12, 13, 0), '');
  checkEqual('★★★★ 週數唔係 13 都一樣：11 對 vs 12 個主日 ⇒ 空字串',
    gas.describeAdjacentPairDenominatorGap_(11, 12, 0), '');
}

console.log('\n=== E：兩個分母唔同 ⇒ 要講明點解 ===');
{
  // 13 個主日 ⇒ 理論 12 對；其中 1 週冇排報告 ⇒ 實際只有 11 對。
  const text = gas.describeAdjacentPairDenominatorGap_(11, 13, 1);
  check('★★★★★ 唔係空字串', text !== '', JSON.stringify(text));
  check('★★★★★ 講得出「其中 1 週沒有排報告」（真正嘅原因，唔係含糊帶過）',
    text.indexOf('其中 1 週沒有排報告') !== -1, text);
  check('★★★★★ 講得出「實際只有 11 對可以比較」',
    text.indexOf('實際只有 11 對可以比較') !== -1, text);
  check('★★★★ 亦都講得出理論值 12 對，等讀嘅人對得返上另一張表',
    text.indexOf('12 對') !== -1, text);
}

console.log('\n=== E：數唔到「幾多週冇排報告」嗰陣，唔可以由 pair 差額倒推 ===');
{
  // ⚠️ 中間少一週會斷兩對、頭尾少一週只斷一對——由 pair 差額倒推週數
  // 一定會有機會推錯。推錯嘅後果係報告寫住一個似模似樣但係假嘅數字，
  // 正正就係本專案 bug class 第 2 條。
  [null, undefined, 0].forEach(function (missing) {
    const text = gas.describeAdjacentPairDenominatorGap_(10, 13, missing);
    check('★★★★★ weeksWithoutAnnounce=' + JSON.stringify(missing)
      + ' ⇒ 唔會作一個週數出嚟',
      !/其中 \d+ 週/.test(text), text);
    check('★★★★ 但仍然講得出實際分母同理論分母',
      text.indexOf('實際只有 10 對') !== -1 && text.indexOf('12 對') !== -1, text);
  });
}

console.log('\n=== E：算唔到就唔好作嘢講 ===');
{
  checkEqual('★★★★★ actualPairs 算唔到 ⇒ 空字串（冇解釋好過一句錯嘅解釋）',
    gas.describeAdjacentPairDenominatorGap_(null, 13, 1), '');
  checkEqual('★★★★ actualPairs 係空字串 ⇒ 空字串',
    gas.describeAdjacentPairDenominatorGap_('', 13, 1), '');
  checkEqual('★★★★★ 週數算唔到 ⇒ 空字串',
    gas.describeAdjacentPairDenominatorGap_(11, null, 1), '');
  checkEqual('★★★★ 得一個主日（理論 0 對）⇒ 空字串',
    gas.describeAdjacentPairDenominatorGap_(0, 1, 0), '');
}

console.log('\n=== E：實際大過理論係唔可能嘅，要嘈唔可以當正常 ===');
{
  const text = gas.describeAdjacentPairDenominatorGap_(20, 13, 0);
  check('★★★★★ 實際 20 對 > 理論 12 對 ⇒ 明講「唔應該發生」而唔係若無其事解釋一番',
    text.indexOf('不應該發生') !== -1 || text.indexOf('唔應該發生') !== -1, text);
  check('★★★★ 而且叫人告訴開發者', text.indexOf('開發者') !== -1, text);
}

console.log('\n=== E：兩處用同一個函式（唔可以各寫一句然後慢慢漂移）===');
{
  const SRC = path.join(__dirname, '..', 'src');
  const verify = fs.readFileSync(path.join(SRC, 'Verify.gs'), 'utf8');
  const review = fs.readFileSync(path.join(SRC, 'RuleReview.gs'), 'utf8');

  check('★★★★★ Verify.gs 品質統計叫 describeAdjacentPairDenominatorGap_()',
    /describeAdjacentPairDenominatorGap_\(/.test(verify));
  check('★★★★★ RuleReview.gs 規則審閱表都叫同一個函式'
    + '——各自寫一句就會漂移成兩個講法，而堂委同幹事會見到唔同嘅解釋',
    /describeAdjacentPairDenominatorGap_\(/.test(review));

  // 兩邊都唔可以自己另外砌一句「實際只有 N 對」。
  const handRolled = [];
  ['Verify.gs', 'RuleReview.gs'].forEach(function (f) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/'[^']*實際只有[^']*'/.test(bare)) handRolled.push(f);
  });
  checkEqual('★★★★★ 兩個檔案都冇自己手寫「實際只有…」嗰句', handRolled, []);
}

console.log('\n=== E：computeAnnounceConsecutiveRatio_() 要帶埋解釋所需嘅資料出嚟 ===');
{
  const verify = fs.readFileSync(path.join(__dirname, '..', 'src', 'Verify.gs'), 'utf8');
  check('★★★★★ 回傳有 weeksWithoutAnnounce（喺呢度先數得到——'
    + '淨係靠 pair 數係推唔返出週數嘅）',
    /weeksWithoutAnnounce:\s*weeksWithoutAnnounce/.test(verify));
  check('★★★★ 亦都帶埋 weeksCounted', /weeksCounted:\s*dates\.length/.test(verify));
}

console.log('\n=== 唔准改嘅嘢：引擎分母維持 weeksCounted ===');
{
  const gen = fs.readFileSync(path.join(__dirname, '..', 'src', 'Generator.gs'), 'utf8');
  // 第三十二輪已經拍板：引擎嗰個係 greedy pass 內部嘅節流參數，唔係量度。
  // 呢一輪明確唔准改。
  check('★★★★★ Generator.gs 嘅 isBehindTargetPace_() 仍然冇用 adjacentPairCount_()',
    !/isBehindTargetPace_[\s\S]{0,600}adjacentPairCount_/.test(gen));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
