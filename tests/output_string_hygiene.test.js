// 第二十一輪批次階段 D／E：輸出字串衛生。
// 執行方式：node tests/output_string_hygiene.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有呢個測試
// ─────────────────────────────────────────────────────────────────────
//
// Apps Script 嘅 `ui.alert()` **唔會渲染 markdown**。
// 寫 `**這一步不能繼續**` 出嚟就係一堆星號：
//
//     **這一步不能繼續**——照樣寄出的話……
//
// 幹事見到嘅係星號，唔係重點。而寫呢啲字嘅人（我）一直以為佢會變粗體。
// 全專案曾經有 **26 處**噉樣寫，分佈 17 個檔案。
//
// ⚠️ 註解同 `docs/` 入面嘅 markdown `**` 係啱嘅，唔可以掃——
// 嗰啲係畀人喺編輯器／GitHub 睇嘅，會正常渲染。
// 呢個測試只掃**字串字面量**。

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

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

/**
 * 掃一個檔案入面**字串字面量**含唔含指定樣式。
 * 註解行（`//`、`*`、`/*`）一律略過。
 */
function scanStringLiterals(fileName, needle) {
  const hits = [];
  const lines = fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8').split('\n');
  lines.forEach(function (line, i) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const literals = line.match(/'[^']*'/g) || [];
    literals.forEach(function (lit) {
      if (lit.indexOf(needle) !== -1) hits.push(fileName + ':' + (i + 1) + '  ' + lit.trim().slice(0, 90));
    });
  });
  return hits;
}

function scanAll(needle) {
  const all = [];
  fs.readdirSync(SRC_DIR).filter(function (f) { return f.endsWith('.gs'); })
    .forEach(function (f) { all.push.apply(all, scanStringLiterals(f, needle)); });
  return all;
}

console.log('\n=== D【核心】輸出字串唔可以有 literal ** ===');
{
  const hits = scanAll('**');
  checkEqual('★★★★★ src/ 全部 .gs 嘅字串字面量都冇 `**`'
    + '（ui.alert() 唔渲染 markdown，寫出嚟就係一堆星號）',
    hits, []);
}

console.log('\n=== D：反向——註解同 docs 嘅 markdown 唔可以被掃到 ===');
{
  // 呢個測試本身嘅價值取決於「佢真係識得分辨」。
  // 如果連註解都掃，全專案會有幾百項，等於冇用。
  const commentSample = [
    '/**',
    ' * 呢度係註解，**粗體**喺編輯器度會正常渲染，唔應該被掃到。',
    ' */',
    '  // 單行註解入面嘅 **重點** 都一樣'
  ].join('\n');
  const tmp = path.join(SRC_DIR, '__hygiene_probe__.gs');
  fs.writeFileSync(tmp, commentSample, 'utf8');
  try {
    checkEqual('★★★★★ 註解入面嘅 `**` 唔會被掃到'
      + '（如果連註解都掃，全專案會有幾百項，個測試就等於冇用）',
      scanStringLiterals('__hygiene_probe__.gs', '**'), []);
  } finally {
    fs.unlinkSync(tmp);
  }

  // ★ 正向：真係有一句輸出字串含 ** 嘅話，一定要捉到
  const badSample = "function f_() {\n  ui.alert('這一步**不能繼續**——測試用');\n}";
  const tmp2 = path.join(SRC_DIR, '__hygiene_probe2__.gs');
  fs.writeFileSync(tmp2, badSample, 'utf8');
  try {
    check('★★★★★ 正向：輸出字串含 `**` 一定要捉到'
      + '——一條掃出 0 項嘅規則，可以係「真係冇問題」，'
      + '亦可以係「規則寫壞咗」，淨係睇個 0 分唔出',
      scanStringLiterals('__hygiene_probe2__.gs', '**').length === 1);
  } finally {
    fs.unlinkSync(tmp2);
  }
}

console.log('\n=== E【核心】「清 Status 重新提交」係錯嘅講法 ===');
{
  // `readPendingRequests_()` 實際上係睇 **RequestID 係咪空白**，
  // 清 Status 完全冇作用——照住做只會白做一次然後以為系統壞咗。
  // ⚠️ 只掃「叫幹事去做」嗰種講法，唔掃「描述系統做咗乜」。
  //
  // 「清理 Requests 手改痕跡」呢個工具本身**真係會**清空 Status／處理結果／
  // 處理時間，佢嘅報告噉樣描述係準確嘅。錯嘅只係「叫幹事清 Status 去
  // 重新提交」——因為 `readPendingRequests_()` 睇嘅係 RequestID 係咪空白，
  // 清 Status 完全冇作用，照住做只會白做一次然後以為系統壞咗。
  const wrongInstructions = ['Status 清空重新提交', '清空 Status 重新提交',
    'Status 清空後重新提交'];
  const hits = [];
  wrongInstructions.forEach(function (w) {
    scanAll(w).forEach(function (h) { hits.push(h); });
  });
  checkEqual('★★★★★ 輸出字串冇「清空 Status 重新提交」呢類**指引**'
    + '（實際判斷準則係 RequestID 是否空白，清 Status 冇作用）',
    hits, []);

  // 而且要主動講破呢個誤解——單純刪走錯嘅講法唔夠，
  // 幹事可能已經記住咗舊做法。
  check('★★★★★ 有主動講明「清 Status 沒有作用」，唔係淨係刪走錯嘅講法',
    scanAll('清 Status 沒有作用').length >= 1);

  // 而且正確講法要真係出現過
  const correct = scanAll('RequestID');
  check('★★★★ 有講「刪除 RequestID」呢個正確做法',
    correct.some(function (h) { return h.indexOf('RequestID') !== -1; }),
    '搵唔到任何提到 RequestID 嘅指引');
}

console.log('\n=== D：Config 說明同電郵範本種子都係輸出，一樣要乾淨 ===');
{
  // Config 嘅 description 會寫入試算表畀幹事睇；
  // 電郵範本種子會寄出去畀義工睇。兩者都係「輸出」。
  checkEqual('★★★★ ConfigSeed.gs 冇 `**`', scanStringLiterals('ConfigSeed.gs', '**'), []);
  checkEqual('★★★★ EmailTemplateSeed.gs 冇 `**`',
    scanStringLiterals('EmailTemplateSeed.gs', '**'), []);
}

// =====================================================================
console.log('\n=== E：原始碼裡面不可以有原始控制字元（第四十四輪批次發現）===');
{
  // ⚠️ 真實撞到：`src/SuggestionSheet.gs` 的 `fingerprintGridText_()`
  // 把兩個分隔符寫成**原始的 0x00／0x01 位元組**，直接嵌在原始碼裡面。
  //
  // 它跑得動，但代價是：
  //   ・`git` 把整個檔當成 binary——`grep` 一句都搵不到，
  //     `git diff` 只會講「Binary files differ」
  //   ・任何一次編輯器／工具來回都可能靜靜地丟掉它們，
  //     而後果是整批「起點指紋」變值 ⇒ 系統以為那張表被人改過
  //
  // 寫成 `\u0000` 跳脫，算出來的值完全一樣，而以上兩個問題都沒有了。
  // ⚠️ 刻意唔用 `withFileTypes` 嗰個寫法：`tools/scan-staged-secrets.js`
  // 會把原始碼入面嘅「識別字 ＋ 一點 ＋ name」當成一個網域（`name` 本身
  // 就係一個真實 TLD），而呢個 repo 係公開嘅，所以嗰條掃描寧可誤報都唔放過。
  // 改用「檔名字串 ＋ `statSync`」，一個都唔會出現。
  const walkSrc = function (dir, out) {
    fs.readdirSync(dir).forEach(function (item) {
      if (item === 'node_modules' || item === '.git') return;
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) walkSrc(full, out);
      else if (/\.(gs|js|html)$/.test(item)) out.push(full);
    });
    return out;
  };
  const ROOT2 = path.join(__dirname, '..');
  const files = walkSrc(path.join(ROOT2, 'src'), [])
    .concat(walkSrc(path.join(ROOT2, 'tests'), []))
    .concat(walkSrc(path.join(ROOT2, 'tools'), []));
  const bad = [];
  files.forEach(function (f) {
    const body = fs.readFileSync(f, 'utf8');
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      // Tab／換行／回車係正常嘅；其餘 <32 一律唔應該原封不動出現喺原始碼。
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        bad.push(path.relative(ROOT2, f) + '（第 '
          + body.slice(0, i).split('\n').length + ' 行，字元碼 ' + c + '）');
        break;
      }
    }
  });
  checkEqual('★★★★★ `src/`／`tests/`／`tools/` 一個原始控制字元都冇'
    + '——有嘅話 `git` 會把整個檔當成 binary，而編輯器來回會靜靜丟咗佢',
    bad, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
