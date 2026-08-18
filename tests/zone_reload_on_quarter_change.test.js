// 第二十五輪批次階段 A：換季度時，全部區嘅載入狀態都要清走。
// 執行方式：node tests/zone_reload_on_quarter_change.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅 bug
// ─────────────────────────────────────────────────────────────────────
//
// Ivan 由 2027年7-9月 換去 2026年10-12月，區二嘅標題正確變成
// 「還有 2 項未做」，但下面五項清單仍然顯示上一季嘅數字。
//
// 成因：**同一個狀態有兩個旗標，只重設咗其中一個。**
//   `Script.html` 嘅 `wireZoneToggle()` 內部有 closure 變數 `loaded`
//   `ScriptZone2.html` 另外有個 `zone2Loaded`
// 換季度只重設咗後者。
//
// ⚠️ 呢個係本專案最危險嗰類 bug：**畫面顯示上一個季度嘅數字，
// 但睇落完全正常**——冇錯誤、冇空白、冇任何訊號。
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試特登唔淨係驗「有冇重設區二」
// ─────────────────────────────────────────────────────────────────────
//
// 驗「有冇重設區二」嘅話，下一輪加咗區三內容而漏咗重設，測試會照樣綠燈。
// 所以驗嘅係**寫法本身**：重設一定要係「整個掉走」，
// 唔可以逐個區列名——列名就一定有一日會漏。

const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui');
const read = (f) => fs.readFileSync(path.join(UI, f), 'utf8');

const common = read('Script.html');
const boot = read('ScriptBoot.html');
const zoneFiles = ['ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptRollback.html'];

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

console.log('\n=== A1【核心】「已載入」只有一個真相來源 ===');
{
  check('★★★★★ Script.html 有一個全域嘅 zoneLoadState',
    /let zoneLoadState = \{\};/.test(common));
  check('★★★★★ wireZoneToggle() **唔再有**自己嘅 closure 旗標'
    + '——嗰個就係第二個真相來源',
    !/function wireZoneToggle[\s\S]{0,200}?let loaded = false;/.test(common));
  check('★★★★ wireZoneToggle() 用 zoneLoadState[bodyId] 判斷',
    /zoneLoadState\[bodyId\]/.test(common));

  // 逐個區檔案掃：唔可以再有人自己開一個「載入咗未」旗標。
  const offenders = [];
  zoneFiles.forEach(function (f) {
    const text = read(f);
    const m = text.match(/^\s*let\s+\w*[Ll]oaded\w*\s*=/gm);
    if (m) offenders.push(f + '：' + m.join('、'));
  });
  checkEqual('★★★★★ 冇任何區檔案自己開一個「載入咗未」旗標'
    + '——第二個旗標一出現，「換季度要重設」就會變成「要記得重設兩個地方」，'
    + '而漏咗嗰個唔會有任何訊號',
    offenders, []);
}

console.log('\n=== A2【核心】換季度要「整個掉走」，唔可以逐個區列名 ===');
{
  check('★★★★★ Script.html 有 resetAllZoneLoadState()',
    /function resetAllZoneLoadState\(\)/.test(common));

  {
    const fn = common.slice(common.indexOf('function resetAllZoneLoadState'));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 5);
    check('★★★★★ 實作係「整個物件掉走」（zoneLoadState = {}），'
      + '**唔係**逐個 delete 或者逐個區列名'
      + '——列名嘅話，下一輪加咗區三內容而漏咗改呢一行，'
      + 'bug 就會原封不動再中一次，而且一樣冇訊號',
      /zoneLoadState = \{\};/.test(body) && body.indexOf('zone2') === -1
      && body.indexOf('zone3') === -1 && body.indexOf('zone4') === -1,
      body);
  }

  const changeHandler = boot.slice(
    boot.indexOf("el('quarter').addEventListener"),
    boot.indexOf("el('btnRefresh')"));
  check('★★★★★ 換季度 handler 有叫 resetAllZoneLoadState()',
    /resetAllZoneLoadState\(\)/.test(changeHandler));
  check('★★★★★ 而且**唔會**再逐個區名重設（例如 zone2Loaded = false）',
    !/zone\d\w*\s*=\s*false/.test(changeHandler), changeHandler);
  check('★★★★ 換季度仍然會關掉已開嘅彈窗（規格 1.1，唔可以順手拆走）',
    /closeModal\(\);/.test(changeHandler));
}

console.log('\n=== A1 setZoneOpen() 直接展開嗰條路都要標記 ===');
{
  // 區二喺「還有 N 項未做」時會用 setZoneOpen() 直接展開，
  // 唔會行 wireZoneToggle() 嗰條路——所以要有另一個入口標記「已載入」，
  // 而嗰個入口一樣要寫入同一個 zoneLoadState。
  check('★★★★★ Script.html 有 markZoneLoaded()（同一個 state 嘅第二個入口）',
    /function markZoneLoaded\(bodyId\)/.test(common));
  {
    const fn = common.slice(common.indexOf('function markZoneLoaded'));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 5);
    check('★★★★★ markZoneLoaded() 寫嘅係 zoneLoadState，唔係另一個變數',
      /zoneLoadState\[bodyId\] = true;/.test(body));
    check('★★★★ 而且回傳「之前係咪已經載入過」，令呼叫端唔使自己記',
      /const was = !!zoneLoadState\[bodyId\];/.test(body) && /return was;/.test(body));
  }
  check('★★★★ 區二用 markZoneLoaded() 而唔係自己嘅旗標',
    /markZoneLoaded\('zone2Body'\)/.test(read('ScriptZone2.html')));
}

console.log('\n=== 全部收摺區都要接上同一套機制 ===');
{
  const wired = (boot.match(/wireZoneToggle\('(\w+)Head'/g) || [])
    .map(function (s) { return /wireZoneToggle\('(\w+)Head'/.exec(s)[1]; });
  check('★★★★ 三個收摺區（區二／三／四）都有接',
    ['zone2', 'zone3', 'zone4'].every(function (z) { return wired.indexOf(z) !== -1; }),
    JSON.stringify(wired));
  check('★★★★★ 區三而家有真內容（renderZone3），唔再係 null'
    + '——本輪加咗內容，正正就係嗰個「將來會中招」嘅情況',
    /wireZoneToggle\('zone3Head', 'zone3Body', renderZone3\)/.test(boot));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
