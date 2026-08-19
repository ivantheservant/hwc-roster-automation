#!/usr/bin/env node
// 第三十二輪批次階段 D：入口覆蓋率地圖。
// 執行方式：node tools/lint-entry-coverage.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個工具想答一條問題
// ─────────────────────────────────────────────────────────────────────
//
//   「呢個測試嘅入口，同真實環境嘅入口一樣嗎？」
//
// Ivan 記低嘅 bug class 第 6 條：**測試直接叫內部函式，冇一個由真正
// 入口叫落去。** 一個星期之內出現咗三次：
//
//   1. 掣 1 `findStateViolations_()` 參數次序寫反
//   2. `Mailer.gs` 個人 PDF 嘅 `folder`
//   3. 第三十一輪階段 A：ICS 時間——**第二十三輪嘅修正從來冇生效過**，
//      而測試一路都係綠嘅，因為佢直接餵一個 Date 物件落純函式，
//      而真實環境經 `convertConfigValue_()` 之後餵落嚟嘅係一個字串。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 刻意嘅取捨（照抄第三十輪嗰兩個 lint 嘅做法）
// ─────────────────────────────────────────────────────────────────────
//
// 1. **純函式嘅單元測試唔算問題。** 例如 `adjacentPairCount_()` 嘅
//    邊界測試根本冇入口可言。工具只負責**報告事實**，
//    唔會自己判斷「應該有而冇」。
// 2. **假警報寧多勿漏。** 呢個工具嘅價值係俾人睇一張表，
//    唔係自動化把關。
// 3. **唔會加入 push gate。** 佢係一張地圖，唔係一道閘——
//    退出碼永遠 0。
//
// 輸出：`docs/入口覆蓋率.md`

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TESTS_DIR = path.join(ROOT, 'tests');
const OUT = path.join(ROOT, 'docs', '入口覆蓋率.md');

const IDENT = '[A-Za-z_$][\\w$]*';

/**
 * 抽出「真入口」：真實環境有嘢會叫佢哋，而唔係由另一段自己嘅碼叫。
 * @returns {Object} `{名: 種類}`
 */
function collectEntryPoints() {
  const entries = {};
  const add = function (name, kind) {
    if (!name) return;
    // 同一個名可能兩種身分（例如又掛選單又係 api）——保留第一個，
    // 但兩種都記低，免得表上寫得太窄。
    entries[name] = entries[name] ? (entries[name] + '／' + kind) : kind;
  };

  fs.readdirSync(SRC_DIR).filter(function (f) { return f.endsWith('.gs'); })
    .forEach(function (file) {
      const src = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');

      // 1. 選單：`.addItem('…', 'runXxx_')`
      const menuRe = new RegExp("addItem\\s*\\([^,]*,\\s*'(" + IDENT + ")'", 'g');
      let m;
      while ((m = menuRe.exec(src)) !== null) add(m[1], '選單');

      // 2. Web UI：所有 `api*()`（前端 `google.script.run` 叫）
      const apiRe = new RegExp('^function\\s+(api' + IDENT + ')\\s*\\(', 'gm');
      while ((m = apiRe.exec(src)) !== null) add(m[1], 'Web UI');

      // 3. Web App 本身
      const webRe = /^function\s+(doGet|doPost)\s*\(/gm;
      while ((m = webRe.exec(src)) !== null) add(m[1], 'Web App');

      // 4. Trigger handler：由 `ScriptApp.newTrigger('名')` 掛住嘅
      const trigRe = new RegExp("newTrigger\\s*\\(\\s*'(" + IDENT + ")'", 'g');
      while ((m = trigRe.exec(src)) !== null) add(m[1], '觸發器');

      // 5. 側邊欄／對話框嘅 `google.script.run` 目標（`.gs` 入面
      //    以字串傳出去嘅 handler 名）——收窄到 `withSuccessHandler` 之後
      //    嗰個 `.名(` 唔可靠，所以只認 `.html` 入面嗰啲，見下面。
    });

  // 6. `ui/*.html` 入面 `google.script.run….名(` 嘅目標。
  //    前端真係會叫佢哋，所以佢哋都係真入口。
  const uiDir = path.join(ROOT, 'ui');
  if (fs.existsSync(uiDir)) {
    fs.readdirSync(uiDir).filter(function (f) { return f.endsWith('.html'); })
      .forEach(function (file) {
        const html = fs.readFileSync(path.join(uiDir, file), 'utf8');
        const re = new RegExp('google\\.script\\.run[\\s\\S]{0,200}?\\.(' + IDENT + ')\\s*\\(', 'g');
        let m;
        while ((m = re.exec(html)) !== null) {
          if (/^with(Success|Failure)Handler$/.test(m[1])) continue;
          add(m[1], '前端呼叫');
        }
      });
  }

  return entries;
}

/**
 * 一個測試檔叫咗邊啲入口。
 * @param {string} source 測試檔全文
 * @param {Object} entries
 * @returns {string[]}
 */
function entriesCalledBy(source, entries) {
  // ⚠️ 先剝走註解。第三十一輪踩過八次同一個陷阱：
  // 一段**解釋**某個入口嘅註解，本身會被掃描當成「叫咗佢」。
  const bare = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  return Object.keys(entries).filter(function (name) {
    // 要真係「呼叫」——名後面跟住一個開括號。
    // 只係喺字串入面提過個名（例如靜態掃描斷言）唔算。
    //
    // ⚠️ **一定要容許前面有一個 `.`。** 測試沙箱嘅寫法係
    // `gas.apiSaveAndConfirmPlan('2027T4')`——即係每一個由真入口叫落去
    // 嘅測試都係 `<物件>.<入口名>(`。第一版寫咗 `[^\w$.]`（唔准有點），
    // 結果 `api_endpoint_entry.test.js` 明明叫緊 `apiSaveAndConfirmPlan`
    // 都被報成「冇入口」——**一個專門搵漏網之魚嘅工具，自己漏晒。**
    const re = new RegExp('(?:^|[^\\w$])' + name.replace(/\$/g, '\\$') + '\\s*\\(');
    return re.test(bare);
  }).sort();
}

function main() {
  const entries = collectEntryPoints();
  const entryNames = Object.keys(entries).sort();

  const testFiles = fs.readdirSync(TESTS_DIR)
    .filter(function (f) { return f.endsWith('.test.js'); }).sort();

  const rows = testFiles.map(function (file) {
    const src = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
    const called = entriesCalledBy(src, entries);
    return { file: file, called: called };
  });

  const withEntry = rows.filter(function (r) { return r.called.length > 0; });
  const ratio = rows.length === 0 ? 0 : (withEntry.length / rows.length * 100);

  const lines = [];
  lines.push('# 入口覆蓋率');
  lines.push('');
  lines.push('由 `tools/lint-entry-coverage.js` 自動產生。**不要手改。**');
  lines.push('');
  lines.push('## 這張表想答什麼');
  lines.push('');
  lines.push('> 「這個測試的入口，跟真實環境的入口一樣嗎？」');
  lines.push('');
  lines.push('本專案反覆出事的地方：測試直接叫內部函式，沒有一個由真正入口叫落去。');
  lines.push('第三十一輪階段 A 那個 ICS 修正**從來沒有生效過**，而測試一路都是綠的');
  lines.push('——因為它直接餵一個 Date 物件落純函式，而真實環境經');
  lines.push('`convertConfigValue_()` 之後餵下來的是一個字串。');
  lines.push('');
  lines.push('⚠️ **這是一張地圖，不是一道閘。**');
  lines.push('');
  lines.push('- 純函式的單元測試「沒有入口」**不是問題**（例如 `adjacentPairCount_()`');
  lines.push('  的邊界測試根本沒有入口可言）。這個工具只報告事實，');
  lines.push('  不會自己判斷「應該有而沒有」。');
  lines.push('- 假警報寧多勿漏。');
  lines.push('- 不會加進 push gate，退出碼永遠 0。');
  lines.push('');
  // 第三十三輪批次階段 F2：呢個工具刻意唔判斷「應該有而冇」，
  // 但**一定要有人判斷過**——否則張表上一百幾十個「—」會變成
  // 一堆冇人再理嘅噪音，同「冇呢張表」等價。判斷寫咗喺另一份人手維護嘅文件，
  // 呢度指返過去，令兩份唔會各自漂移。
  lines.push('> 📋 **「—」逐個判斷過係邊一類（純函式／應該有但沒有／不確定），');
  lines.push('> 寫喺 [`docs/入口覆蓋率分類.md`](入口覆蓋率分類.md)。**');
  lines.push('> 那一份是人手維護的——加新測試檔而它標「—」的話，請回去補一行。');
  lines.push('');
  lines.push('## 統計');
  lines.push('');
  lines.push('- 測試檔：**' + rows.length + '** 個');
  lines.push('- 其中有叫到至少一個真入口：**' + withEntry.length + '** 個');
  lines.push('- 比率：**' + ratio.toFixed(1) + '%**');
  lines.push('- 認到的真入口：**' + entryNames.length + '** 個');
  lines.push('');
  lines.push('## 逐個測試檔');
  lines.push('');
  lines.push('| 測試檔 | 有沒有 | 叫了哪個入口 |');
  lines.push('| --- | --- | --- |');
  rows.forEach(function (r) {
    lines.push('| `' + r.file + '` | ' + (r.called.length > 0 ? '✅' : '—') + ' | '
      + (r.called.length > 0
        ? r.called.map(function (n) { return '`' + n + '`'; }).join('、')
        : '（沒有——可能是純函式測試，見上面說明）') + ' |');
  });
  lines.push('');
  lines.push('## 認到的真入口');
  lines.push('');
  lines.push('| 入口 | 種類 |');
  lines.push('| --- | --- |');
  entryNames.forEach(function (n) {
    lines.push('| `' + n + '` | ' + entries[n] + ' |');
  });
  lines.push('');

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

  console.log('入口覆蓋率掃描：' + rows.length + ' 個測試檔，'
    + entryNames.length + ' 個真入口');
  console.log('有真入口嘅測試檔：' + withEntry.length + ' 個（' + ratio.toFixed(1) + '%）');
  console.log('已寫入 docs/入口覆蓋率.md');
  console.log('');
  console.log('⚠️ 呢個工具係地圖，唔係閘——退出碼永遠 0。');
  // ⚠️ 永遠 0。加咗非零退出碼就會變成一道閘，
  // 而純函式測試冇入口係完全正常嘅。
  process.exit(0);
}

main();
