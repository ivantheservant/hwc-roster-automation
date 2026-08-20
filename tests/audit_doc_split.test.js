// 第三十九輪批次 F 組：稽核文件拆檔之後，一個輪次都唔可以唔見咗。
// 執行方式：node tests/audit_doc_split.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// `docs/系統範圍稽核.md` 去到第三十九輪已經 8853 行，每輪加一節，
// 冇人會由頭睇。所以拆成每十輪一個檔，主檔只留索引同結論。
//
// 拆檔最大嘅風險係**靜靜漏咗一段**——文件唔似程式碼，
// 漏咗唔會拋錯、唔會有紅燈，要等到有人去搵返嗰一輪查過咩先發現，
// 而嗰陣通常已經隔咗好幾個月。
//
// 所以呢一份逐輪核對：由第 5 輪到最新一輪，每一輪都要喺**恰好一個**
// 分檔入面搵得返，而且主檔嘅索引要列得齊。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const DOCS = path.join(__dirname, '..', 'docs');
const MAIN = '系統範圍稽核.md';

const DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(text) {
  const t = String(text);
  if (t.indexOf('十') === -1) return DIGIT[t] || NaN;
  const parts = t.split('十');
  const tens = parts[0] === '' ? 1 : (DIGIT[parts[0]] || NaN);
  const ones = parts[1] === '' ? 0 : (DIGIT[parts[1]] || 0);
  return tens * 10 + ones;
}

/** 一份檔案入面出現過嘅輪次。 */
function roundsIn(text) {
  const out = {};
  (text.match(/^#{1,2} 第[一二三四五六七八九十]+輪批次/gm) || []).forEach(function (line) {
    const m = /第([一二三四五六七八九十]+)輪/.exec(line);
    const n = cnNum(m[1]);
    if (!isNaN(n)) out[n] = true;
  });
  return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
}

const parts = fs.readdirSync(DOCS)
  .filter(function (f) { return /^系統範圍稽核_第\d+-\d+輪\.md$/.test(f); })
  .sort();
const mainText = fs.readFileSync(path.join(DOCS, MAIN), 'utf8');

console.log('\n=== F【核心】主檔已經拆細，但索引齊全 ===');
{
  check('★★★★ 真係拆咗檔出嚟', parts.length >= 3, parts.join('、'));
  const mainLines = mainText.split('\n').length;
  check('★★★★ 主檔短返（1000 行以內）——目的就係「打開嚟睇得晒」',
    mainLines <= 1000, '主檔而家 ' + mainLines + ' 行');
  parts.forEach(function (f) {
    check('★★★★★ 索引有列出 ' + f + '（冇列 ＝ 冇人搵得返嗰幾輪）',
      mainText.indexOf(f) !== -1);
  });
}

console.log('\n=== F【核心】每一輪都搵得返，而且只喺一個檔 ===');
{
  const byRound = {};
  parts.forEach(function (f) {
    roundsIn(fs.readFileSync(path.join(DOCS, f), 'utf8')).forEach(function (n) {
      if (!byRound[n]) byRound[n] = [];
      byRound[n].push(f);
    });
  });

  const found = Object.keys(byRound).map(Number).sort(function (a, b) { return a - b; });
  check('★★★★ 至少由第 5 輪開始（之前幾輪嘅內容喺主檔序言）',
    found.length > 0 && found[0] <= 5, JSON.stringify(found));

  // ⚠️ 中間唔可以有窿。有窿 ＝ 拆嗰陣漏咗一段，
  // 而文件唔會拋錯、唔會有紅燈，要等到有人去搵返嗰一輪查過咩先發現。
  //
  // ⚠️ 第二十二輪**本來就冇寫過**（原檔由第二十一輪直接跳到第二十三輪）。
  // 所以佢喺已知缺口清單入面。呢個清單刻意寫死：
  // 之後再多一個窿，就一定係拆檔或者歸檔嗰陣漏咗，會即刻紅。
  const KNOWN_GAPS = [22];
  const holes = [];
  for (let n = found[0]; n <= found[found.length - 1]; n++) {
    if (!byRound[n] && KNOWN_GAPS.indexOf(n) === -1) holes.push(n);
  }
  checkEqual('★★★★★ 冇任何一輪喺分檔入面搵唔返'
    + '（已知缺口：第 ' + KNOWN_GAPS.join('、') + ' 輪，嗰幾輪本來就冇寫過）',
    holes, []);
  checkEqual('★★★★ 而且已知缺口真係仲係缺口'
    + '——如果之後有人補返第 22 輪，呢一條會紅，提你更新上面個清單',
    KNOWN_GAPS.filter(function (n) { return !!byRound[n]; }), []);

  const dupes = found.filter(function (n) { return byRound[n].length > 1; });
  checkEqual('★★★★★ 冇任何一輪同時出現喺兩個分檔'
    + '（出現兩次 ⇒ 之後有人改其中一份，另一份就變成一個唔啱嘅舊版本）',
    dupes, []);
}

console.log('\n=== F：分檔各自講得出自己係邊幾輪 ===');
{
  parts.forEach(function (f) {
    const text = fs.readFileSync(path.join(DOCS, f), 'utf8');
    const head = text.split('\n').slice(0, 8).join('\n');
    check('★★★★ ' + f + ' 檔頭寫住佢入面有邊幾輪',
      /這一個檔案裡面的輪次/.test(head), head.slice(0, 150));
    check('★★★★ 而且指返去主檔（唔會有人以為呢個就係全部）',
      head.indexOf('系統範圍稽核.md') !== -1, head.slice(0, 200));
  });
}

console.log('\n=== F：最新一輪一定要有 ===');
{
  const all = parts.reduce(function (acc, f) {
    return acc.concat(roundsIn(fs.readFileSync(path.join(DOCS, f), 'utf8')));
  }, []);
  const newest = Math.max.apply(null, all);
  check('★★★★★ 最新嗰一輪喺分檔入面（新一輪寫完唔記得歸檔 ⇒ 下一輪就搵唔返）',
    newest >= 39, '最新搵到第 ' + newest + ' 輪');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
