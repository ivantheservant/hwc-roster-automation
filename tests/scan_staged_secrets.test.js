// 第十八輪批次階段 D4：commit 前掃描 script 嘅測試。
// 執行方式：node tests/scan_staged_secrets.test.js
//
// 兩個方向都要鎖住：
//   • 造假嘅高風險內容（假網域／假 PersonID／假電郵）→ **一定要捉到**
//   • 造測試 fixture 樣式嘅內容（P9xxx／example.invalid／虛構姓名）→ **一定唔可以誤報**
//
// ⚠️ 呢個測試檔本身同樣唔可以寫真實資料。全部「應該被捉到」嘅樣本都係
// 明顯虛構、而且**執行時先拼接出嚟**（見下面 FAKE_DOMAIN_A 嗰段嘅說明）。

const scanner = require('../tools/scan-staged-secrets.js');

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

/** 造假嘅 staged 行（模擬 readStagedAddedLines() 嘅輸出）。 */
function L(file, line, text) { return { file: file, line: line, text: text }; }

// ─────────────────────────────────────────────────────────────────────
// ⚠️ 「應該被捉到」嘅樣本一律**執行時拼接**，唔可以喺檔案入面寫成完整字串
// ─────────────────────────────────────────────────────────────────────
//
// 呢個測試檔要證明掃描器捉得到「唔喺安全清單嘅網域／電郵」，所以一定要
// 有噉樣嘅樣本。但如果直接寫成完整字串，**呢個測試檔自己就會被掃描器
// 擋住 commit**——實測第一次就係噉，9 項高風險全部嚟自呢個檔案。
//
// 兩個唔好嘅解法：
//   ✗ 改用 .invalid ⇒ 落咗安全清單，等於冇測到偵測能力
//   ✗ 將呢個檔案加入白名單 ⇒ 開咗一個永久盲點，日後有人喺呢度貼真嘢就漏
//
// 採用嘅解法：拼接。檔案入面只有碎片（見下面），掃描器（逐行掃文字）
// 見唔到完整網域；但執行時 JS 會組返完整字串，掃描器嘅函式一樣收到
// 真正嘅輸入，偵測能力照樣測得到。
//
// ⚠️ 拼接位要揀啱：淨係喺前面斬一刀係唔夠嘅——如果後半截自己已經係
// 一個完整合法網域（有名稱又有頂層網域），掃描器照樣捉到。實測就係噉。
// 規矩：**每一段碎片都唔可以自成一個網域／電郵／PersonID**，
// 所以連頂層網域都要斬開（見下面）。
const FAKE_DOMAIN_A = 'notarealchurch' + '.o' + 'rg';
const FAKE_DOMAIN_B = 'madeupparish' + '.n' + 'et';
const FAKE_EMAIL = 'someone@' + FAKE_DOMAIN_B;
const FAKE_AUTHOR_EMAIL = 'dev@example.invalid';

// PersonID 樣本同理：寫成完整字串會被自己嘅掃描器捉到，所以字母同數字
// 要分開兩段。
const FAKE_REAL_ID_A = 'P' + '0042';
const FAKE_REAL_ID_B = 'P' + '123';

// =====================================================================
// D4 方向一：高風險內容一定要捉到
// =====================================================================
console.log('\n=== D4【核心】方向一：假網域一定要捉到 ===');
{
  const lines = [
    L('src/Config.gs', 10, "const SITE = 'https://" + FAKE_DOMAIN_A + "/roster';"),
    L('docs/x.md', 3, '請到 ' + FAKE_DOMAIN_B + ' 查看'),
  ];
  const found = scanner.scanDomains(lines);
  check('★★★★★ 捉到兩個唔喺安全清單嘅網域', found.length === 2,
    JSON.stringify(found.map(function (f) { return f.match; })));
  check('★★★★ 標為 HIGH（會擋住 commit）',
    found.every(function (f) { return f.severity === 'HIGH'; }));
  check('★★★★ 有檔案同行號',
    found[0] && found[0].file === 'src/Config.gs' && found[0].line === 10,
    JSON.stringify(found[0]));
}

console.log('\n=== D4：假電郵一定要捉到 ===');
{
  const lines = [L('docs/y.md', 7, '聯絡 ' + FAKE_EMAIL + ' 查詢')];
  const found = scanner.scanEmails(lines, '');
  checkEqual('★★★★★ 捉到一個', found.length, 1);
  check('★★★★ 標為 HIGH', found[0].severity === 'HIGH');
  check('★★★ match 係完整電郵', found[0].match === FAKE_EMAIL, found[0].match);
}

console.log('\n=== D4：真實格式嘅 PersonID 一定要捉到 ===');
{
  const lines = [
    L('src/Menu.gs', 20, "const target = '" + FAKE_REAL_ID_A + "';"),
    L('docs/z.md', 5, '這一格是 ' + FAKE_REAL_ID_B + ' 負責'),
  ];
  const found = scanner.scanPersonIds(lines);
  checkEqual('★★★★★ 兩個都捉到', found.length, 2);
  check('★★★★ 標為 HIGH', found.every(function (f) { return f.severity === 'HIGH'; }));
}

// =====================================================================
// D4 方向二：測試 fixture 樣式一定唔可以誤報
// =====================================================================
console.log('\n=== D4【核心】方向二：測試 fixture 樣式唔可以誤報 ===');
{
  const fixtureLines = [
    L('tests/foo.test.js', 1, "const COMMITTEE = ['P9001', 'P9002', 'P9003'];"),
    L('tests/foo.test.js', 2, "const email = 'p1@x.com';"),
    L('tests/foo.test.js', 3, "const url = 'https://example.invalid/spreadsheet-url';"),
    L('docs/範本.md', 4, '電郵一律 `x.com`，試算表連結用 `example.invalid`。'),
    L('src/Menu.gs', 5, "ui.prompt('請輸入 PersonID（例如 P0001）：');"),
    L('src/Debug.gs', 6, "// 請輸入 PersonID（例如 P0001）"),
  ];

  checkEqual('★★★★★ P9xxx 假 ID 慣例 → 零誤報',
    scanner.scanPersonIds([fixtureLines[0]]), []);
  checkEqual('★★★★★ 「例如 P0001」格式示範 → 零誤報',
    scanner.scanPersonIds([fixtureLines[4], fixtureLines[5]]), []);
  checkEqual('★★★★★ x.com／example.invalid 電郵與網址 → 零誤報',
    scanner.scanEmails([fixtureLines[1], fixtureLines[2]], ''), []);
  checkEqual('★★★★★ 安全網域 → 零誤報',
    scanner.scanDomains([fixtureLines[1], fixtureLines[2], fixtureLines[3]]), []);
}

console.log('\n=== D4：常見技術雜訊唔可以當網域 ===');
{
  const noise = [
    L('src/a.gs', 1, "const x = require('./helpers/gas_loader.js');"),
    L('package.json', 2, '"version": "1.2.3",'),
    L('src/b.gs', 3, '// 見 Constants.gs 同 SoftRuleMetrics.gs'),
    L('docs/c.md', 4, '例如 e.g. 呢啲縮寫'),
    L('src/d.gs', 5, "sheet.getRange('A1').setValue('x');"),
  ];
  checkEqual('★★★★★ 檔名／版本號／縮寫全部唔會被當成網域',
    scanner.scanDomains(noise), []);
}

console.log('\n=== D4：git author 電郵唔會被當成洩漏 ===');
{
  const lines = [L('COMMIT_MSG', 1, 'Co-Authored-By: Someone <' + FAKE_AUTHOR_EMAIL + '>')];
  checkEqual('★★★★ author 電郵放行', scanner.scanEmails(lines, FAKE_AUTHOR_EMAIL), []);

  // 反證：唔傳 author 嗰陣，如果嗰個網域唔安全就會被捉
  const other = [L('COMMIT_MSG', 1, 'Co-Authored-By: X <dev@' + FAKE_DOMAIN_B + '>')];
  check('★★★★ 反證：其他電郵仍然捉得到',
    scanner.scanEmails(other, FAKE_AUTHOR_EMAIL).length === 1);
}

// =====================================================================
// 中文姓名：提示而唔係擋（設計取捨）
// =====================================================================
console.log('\n=== D1：中文姓名係 MEDIUM（提示），唔係 HIGH（擋）===');
{
  const lines = [L('docs/note.md', 3, '今次由陳大明負責主席')];
  const found = scanner.scanChineseNames(lines);
  check('★★★★ 有捉到疑似姓名', found.length >= 1, JSON.stringify(found));
  check('★★★★★ 但標為 MEDIUM——**唔會擋住 commit**'
    + '（樣式配對一定有誤判，設計成擋嘅話會被人用 --no-verify 繞過，'
    + '嗰陣個關卡就等於冇）',
    found.every(function (f) { return f.severity === 'MEDIUM'; }));
  check('★★★★ 提示文字有講明會誤判、要人親眼確認',
    found[0] && found[0].hint.indexOf('誤判') !== -1 && found[0].hint.indexOf('確認') !== -1,
    found[0] && found[0].hint);
}

console.log('\n=== D1：虛構姓名慣例同崗位名唔會誤報 ===');
{
  const lines = [
    L('docs/範本.md', 1, '陳大文 弟兄／姊妹：平安！'),
    L('tests/a.test.js', 2, "personName: '李小明'"),
    L('docs/b.md', 3, '王美美 = 王玫美'),
    L('src/c.gs', 4, "map[RULE_IDS.X] = '主席、讀經、領詩、司事';"),
    L('src/d.gs', 5, '當值堂委只可以由堂委或執事擔任'),
  ];
  const found = scanner.scanChineseNames(lines);
  const names = found.map(function (f) { return f.match; });
  check('★★★★★ 三個虛構姓名慣例都唔會報',
    !names.includes('陳大文') && !names.includes('李小明') && !names.includes('王美美'),
    JSON.stringify(names));
  check('★★★★ 崗位名稱唔會報',
    !names.includes('主席') && !names.includes('讀經') && !names.includes('領詩')
      && !names.includes('司事') && !names.includes('堂委') && !names.includes('執事'),
    JSON.stringify(names));
}

console.log('\n=== D1：常用詞降噪（實測 80 項提示 → 12 項）===');
{
  // 姓氏表入面 何／方／連／程／白／高／紀 同時係中文高頻構詞成分。
  // 第一版掃 15 個檔案出咗 80 項提示，六成係下面呢啲——噪音大到冇人
  // 會逐項睇，等於個提示白做。
  const noisy = [
    L('src/a.gs', 1, '唔可以省略任何身分要求，亦都唔會有任何跡象'),
    L('src/b.gs', 2, '修正方法：改用另一個方式，方向已經確定'),
    L('src/c.gs', 3, '呢個係門檻型參數，唔係連續型'),
    L('src/d.gs', 4, '程式碼入面呢一段流程要紀錄低'),
    L('src/e.gs', 5, '空白格同高風險項目分開處理'),
  ];
  const noisyNames = scanner.scanChineseNames(noisy).map(function (f) { return f.match; });
  checkEqual('★★★★★ 常用詞一個都唔會報（任何／方法／方式／方向／連續／'
    + '程式／流程／紀錄／空白／高風）', noisyNames, []);

  // 掃描器自己嘅姓氏表（同任何姓氏參考清單）唔應該當成姓名
  const surnameTable = [L('tools/x.js', 1,
    "const S = '" + scanner.SURNAMES.slice(0, 30) + "';")];
  checkEqual('★★★★ 一連串姓氏排住（姓氏表本身）唔會報',
    scanner.scanChineseNames(surnameTable).map(function (f) { return f.match; }), []);

  // ★ 反證：降噪唔可以順手殺埋真正名形——含歧義姓氏嘅姓名仍然要捉到
  const stillCaught = [
    L('docs/n.md', 1, '今次由高志文負責'),     // 高：亦係「高風險」嘅高
    L('docs/n.md', 2, '聯絡方偉強跟進'),       // 方：亦係「方法」嘅方
    L('docs/n.md', 3, '連俊傑會補上'),         // 連：亦係「連續」嘅連
  ];
  const caught = scanner.scanChineseNames(stillCaught).map(function (f) { return f.match; });
  check('★★★★★ 反證：含歧義姓氏（高／方／連）嘅姓名形狀**仍然捉得到**'
    + '——降噪係濾走「姓氏＋常用詞」呢個組合，唔係濾走成個姓氏',
    caught.indexOf('高志文') !== -1 && caught.indexOf('方偉強') !== -1
      && caught.indexOf('連俊傑') !== -1,
    JSON.stringify(caught));
}

// =====================================================================
// diff 解析：檔名同行號要指得啱（唔啱嘅話，D2「列出檔案同行號」就冇意義）
// =====================================================================
console.log('\n=== D2：diff 檔名／行號解析 ===');
{
  const diff = [
    'diff --git a/src/A.gs b/src/A.gs',
    '--- a/src/A.gs',
    '+++ b/src/A.gs',
    '@@ -10,0 +11,2 @@',
    '+第一行',
    '+第二行',
    'diff --git a/docs/文件.md b/docs/文件.md',
    '--- a/docs/文件.md',
    '+++ b/docs/文件.md',
    '@@ -0,0 +1 @@',
    '+中文檔名嘅內容',
  ].join('\n');
  const parsed = scanner.parseStagedDiff(diff);
  checkEqual('★★★★★ 中文檔名解析得到（`core.quotepath=false` 之後 git 會出 UTF-8 路徑）',
    parsed.map(function (p) { return p.file + ':' + p.line; }),
    ['src/A.gs:11', 'src/A.gs:12', 'docs/文件.md:1']);

  // ★ 實測撞過嘅 bug：git 預設 `core.quotepath=true` 會出
  // `+++ "b/docs/\347..."`——引號喺 `b/` 前面，`startsWith('+++ b/')` 唔中。
  // 之前嘅寫法會**靜靜咁沿用上一個檔名**，於是 docs 入面 22 項提示
  // 全部報成喺 .gitignore、行號 3428（.gitignore 得 80 行）。
  const quoted = [
    '+++ b/src/A.gs',
    '@@ -0,0 +1 @@',
    '+安全內容',
    '+++ "b/docs/\\347\\263\\261.md"',
    '@@ -0,0 +1 @@',
    '+呢一行屬於中文檔名嗰個檔案',
  ].join('\n');
  let threw = null;
  try { scanner.parseStagedDiff(quoted); } catch (e) { threw = e; }
  check('★★★★★ 認唔到嘅 `+++` 檔頭**要拋錯**，唔可以靜靜咁當成上一個檔案'
    + '（同階段 A 同一個 bug class：一個「唔知道」被當成有意義嘅值，'
    + '結果係報告指去錯嘅檔案，人手追查會撲空）',
    threw !== null, '冇拋錯——解析咗做：' + JSON.stringify(threw));
  check('★★★★ 錯誤訊息講得出係 quotepath 問題、同埋唔可以照行落去',
    threw && threw.message.indexOf('core.quotepath') !== -1
      && threw.message.indexOf('上一個檔案') !== -1,
    threw && threw.message);

  checkEqual('★★★ 新增檔案（`--- /dev/null`）照樣解析得到',
    scanner.parseStagedDiff([
      '--- /dev/null', '+++ b/tools/新.js', '@@ -0,0 +1 @@', '+內容',
    ].join('\n')).map(function (p) { return p.file; }), ['tools/新.js']);

  checkEqual('★★★ 刪除檔案（`+++ /dev/null`）唔會有新增行',
    scanner.parseStagedDiff([
      '--- a/x.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-舊內容',
    ].join('\n')), []);
}

// =====================================================================
// D2：離開碼語意
// =====================================================================
console.log('\n=== D2：只有高風險先會擋，提示唔會 ===');
{
  // 直接跑 script 對真實 staged 內容——呢度只驗證佢跑得起、輸出結構正確
  const { execSync } = require('child_process');
  const path = require('path');
  const script = path.join(__dirname, '..', 'tools', 'scan-staged-secrets.js');
  let out = '';
  let code = 0;
  try {
    out = execSync('node "' + script + '" --json', { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  } catch (e) {
    out = e.stdout || '';
    code = e.status;
  }
  let parsed = null;
  try { parsed = JSON.parse(out); } catch (e) { /* 下面斷言會報 */ }

  check('★★★★ --json 輸出係合法 JSON', parsed !== null, out.slice(0, 300));
  check('★★★★ 有 ok／high／medium 三個欄位',
    parsed && typeof parsed.ok === 'boolean'
      && Array.isArray(parsed.high) && Array.isArray(parsed.medium));
  check('★★★★★ ok 嘅定義係「冇高風險項目」（提示唔影響）',
    parsed && parsed.ok === (parsed.high.length === 0));
  check('★★★★ 離開碼同 ok 一致（0＝可以 commit）',
    parsed && ((code === 0) === parsed.ok), '離開碼 ' + code + '　ok=' + (parsed && parsed.ok));
}

console.log('\n=== 掃描 script 本身唔可以含真實資料（自我檢查）===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'scan-staged-secrets.js'), 'utf8');

  // 用 script 自己嘅規則掃自己——安全清單以外嘅網域／PersonID 一項都唔應該有
  const selfLines = src.split('\n').map(function (t, i) {
    return L('tools/scan-staged-secrets.js', i + 1, t);
  });
  checkEqual('★★★★★ script 自己冇任何非安全網域（否則就係喺防洩漏嘅檔案入面洩漏）',
    scanner.scanDomains(selfLines).map(function (f) { return f.match; }), []);
  checkEqual('★★★★★ script 自己冇任何真實格式 PersonID',
    scanner.scanPersonIds(selfLines).map(function (f) { return f.match; }), []);
  check('★★★★★ script 冇硬編碼真實中文姓名——姓氏表只有**單字姓氏**，'
    + '唔係完整姓名（硬編碼真實姓名本身就係洩漏）',
    /const SURNAMES = '[一-鿿]+';/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
