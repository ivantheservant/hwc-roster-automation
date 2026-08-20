// 第三十八輪批次 B 組：**fixture 唔可以手砌一個真實程式碼唔會產生嘅狀態。**
// 執行方式：node tests/fixture_provenance.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 連續三輪，同一個成因
// ═════════════════════════════════════════════════════════════════════
//
// 第三十七輪查出：fixture 用 `setSnapshot()` 手砌一格，只寫
// `PersonNameSnapshot` 而 `assignSource` 留住 `SKIPPED`；但真入口
// `apiSavePreacherTranslationEntry()` 會**同時**寫 `MANUAL`。
//
// 於是斷言喺一個**真實碼永遠唔會產生嘅狀態**上面通過，而現場一撳就爆。
// 第三十八輪再證明同一個洞仲喺度。
//
// **呢個唔係手誤，係方法問題。**
//
// ─────────────────────────────────────────────────────────────────────
// 規矩
// ─────────────────────────────────────────────────────────────────────
//
// 凡係代表「**系統寫過嘅資料**」嘅 fixture，一律由真入口產生——
// 先叫 `apiSavePreacherTranslationEntry()`／`apiGenerateDraftExecute()`
// 呢啲真函式去寫，再攞佢寫出嚟嘅嘢做 fixture，
// **唔可以手砌一個等價物**。
//
// 手砌只准用喺「模擬幹事喺 grid 打字」呢類**本來就係外部輸入**嘅地方。
//
// ⚠️ 點分「系統寫過」同「外部輸入」：
//   系統寫過　`RosterAssignments` 嘅 `AssignSource`／`RuleFlags`／
//   　　　　　`PersonNameSnapshot`——呢三欄冇任何介面俾人直接填，
//   　　　　　一定係某段碼寫落去嘅
//   外部輸入　`Posts`／`ServiceDates`／`Eligibility`／`RuleSettings`／
//   　　　　　`NameMapping`——呢啲本來就係幹事喺試算表填嘅
//
// ─────────────────────────────────────────────────────────────────────
// 呢條測試點運作
// ─────────────────────────────────────────────────────────────────────
//
// 掃 `tests/` 全部檔案，搵出直接寫上面三個「系統內部欄位」嘅行。
// 每一處要麼由真入口產生，要麼**喺上面 5 行之內**有一句
//
//     // FIXTURE-OK: <理由>
//
// 冇理由嘅 ⇒ fail。理由要講得出「點解呢度手砌係啱嘅」，
// 唔係「呢度手砌咗」。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) {
    console.log(String(extra).split('\n').slice(0, 25).map(function (l) { return '      ' + l; }).join('\n'));
  }
}

const TESTS_DIR = __dirname;

/** 「系統寫過嘅資料」嘅欄位。呢三欄冇任何介面俾人直接填。 */
const SYSTEM_WRITTEN_FIELDS = [
  { re: /(^|[^A-Za-z0-9_])assignSource\s*:/, name: 'assignSource' },
  { re: /(^|[^A-Za-z0-9_])ruleFlags\s*:/, name: 'ruleFlags' },
  { re: /ASSIGN_SOURCE\]\s*:/, name: 'COLUMNS…ASSIGN_SOURCE' },
  { re: /RULE_FLAGS\]\s*:/, name: 'COLUMNS…RULE_FLAGS' },
  { re: /PERSON_NAME_SNAPSHOT\]\s*:/, name: 'COLUMNS…PERSON_NAME_SNAPSHOT' }
];

/** 用嚟標明「呢度手砌係啱嘅，理由如下」。 */
const MARKER = 'FIXTURE-OK:';
/** 理由要寫喺呢個行數之內（上面）。 */
const MARKER_LOOKBACK = 5;

function listTestFiles() {
  const out = [];
  fs.readdirSync(TESTS_DIR).forEach(function (f) {
    if (/\.js$/.test(f) && f !== path.basename(__filename)) out.push(path.join(TESTS_DIR, f));
  });
  const h = path.join(TESTS_DIR, 'helpers');
  if (fs.existsSync(h)) {
    fs.readdirSync(h).forEach(function (f) {
      if (/\.js$/.test(f)) out.push(path.join(h, f));
    });
  }
  return out;
}

console.log('\n=== B 組：每一處手砌「系統寫過嘅欄位」都要有理由 ===');
{
  const unjustified = [];
  let checked = 0;

  listTestFiles().forEach(function (file) {
    const rel = path.relative(path.join(TESTS_DIR, '..'), file).replace(/\\/g, '/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    // 整份檔案級別嘅豁免：檔頭 30 行之內有 marker ⇒ 全份檔案當已經交代過。
    const fileLevel = lines.slice(0, 30).some(function (l) { return l.indexOf(MARKER) !== -1; });

    lines.forEach(function (line, i) {
      // 註解行本身唔算。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const hit = SYSTEM_WRITTEN_FIELDS.find(function (f) { return f.re.test(line); });
      if (!hit) return;
      checked++;
      if (fileLevel) return;

      const from = Math.max(0, i - MARKER_LOOKBACK);
      const nearby = lines.slice(from, i).join('\n');
      if (nearby.indexOf(MARKER) !== -1) return;

      unjustified.push(rel + ':' + (i + 1) + '　寫緊 ' + hit.name
        + '　⇒ ' + line.trim().slice(0, 70));
    });
  });

  check('★★★★★ 掃到嘅位置唔係零（掃描器本身壞咗嘅話下面會變成假綠燈）',
    checked > 10, '掃到 ' + checked + ' 處');
  check('★★★★★ 每一處手砌「系統寫過嘅欄位」都有 `// ' + MARKER + ' <理由>`'
    + '——冇理由嘅話，就分唔出「刻意咁砌」同「唔知真入口會寫咩」，'
    + '而連續三輪出事嘅正正就係後者',
    unjustified.length === 0,
    unjustified.join('\n')
      + (unjustified.length > 0
        ? '\n\n修法：喺嗰一行上面 ' + MARKER_LOOKBACK + ' 行之內加一句\n'
          + '  // ' + MARKER + ' 為什麼這裡手砌是對的\n'
          + '或者改成由真入口產生（首選）。'
        : ''));
}

console.log('\n=== B 組：理由唔可以係空話 ===');
{
  const weak = [];
  const WEAK_PATTERNS = [/^\s*$/, /^測試$/, /^fixture$/, /^手砌$/, /^方便$/];
  listTestFiles().forEach(function (file) {
    const rel = path.relative(path.join(TESTS_DIR, '..'), file).replace(/\\/g, '/');
    fs.readFileSync(file, 'utf8').split('\n').forEach(function (line, i) {
      const at = line.indexOf(MARKER);
      if (at === -1) return;
      const reason = line.slice(at + MARKER.length).trim();
      if (reason.length < 8 || WEAK_PATTERNS.some(function (p) { return p.test(reason); })) {
        weak.push(rel + ':' + (i + 1) + '　理由太空泛：「' + reason + '」');
      }
    });
  });
  check('★★★★ 每個理由都寫得出「點解呢度手砌係啱嘅」（至少 8 個字）',
    weak.length === 0, weak.join('\n'));
}

console.log('\n=== B 組：真入口優先——關鍵路徑唔准手砌 ===');
{
  // 呢幾個檔案係「建立新版本」呢個 bug class 嘅防線本身。
  // 佢哋嘅 fixture **一定**要由真入口產生，唔接受 FIXTURE-OK 豁免。
  const CRITICAL = ['version_carry_over_all_paths.test.js'];
  const problems = [];
  CRITICAL.forEach(function (name) {
    const p = path.join(TESTS_DIR, name);
    if (!fs.existsSync(p)) { problems.push(name + '：搵唔到呢個檔案'); return; }
    const src = fs.readFileSync(p, 'utf8');
    if (!/apiSavePreacherTranslationEntry\(/.test(src)) {
      problems.push(name + '：冇用真入口 apiSavePreacherTranslationEntry() 填自由文字');
    }
    if (!/apiGenerateDraftExecute\(/.test(src)) {
      problems.push(name + '：冇用真入口 apiGenerateDraftExecute() 生成底本');
    }
    // 舊嗰個手砌函式唔可以翻生。
    if (/function setSnapshot\s*\(/.test(src)) {
      problems.push(name + '：仲有 setSnapshot() ——嗰個就係第三十七輪出事嘅手砌函式');
    }
  });
  check('★★★★★ 「建立新版本」嗰條防線嘅 fixture 全部由真入口產生',
    problems.length === 0, problems.join('\n'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
