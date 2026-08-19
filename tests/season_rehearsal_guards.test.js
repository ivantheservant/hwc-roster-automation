// 第二十九輪批次階段 D：全季流程演練——四道安全閘同報告格式。
// 執行方式：node tests/season_rehearsal_guards.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個工具係咩
// ─────────────────────────────────────────────────────────────────────
//
// 到今日為止，**成套系統從來未由頭到尾行足一次。**
// 單獨嘅步驟全部試過，但「串起嚟」嗰一層完全未驗證——
// 而過往每一次真正撞到嘅問題（Stage 鎖死、PDF 版本號對唔上、
// 資料夾冇建到、ICS 時間變成 NaN）都係喺嗰一層先浮現。
//
// ⚠️ 但佢**會建立版本、產生 PDF、寫 SendLog**，所以四道閘缺一不可：
//   1. DRY_RUN 一定要 TRUE
//   2. 唔可以喺受保護季度（真正上線嗰季）
//   3. 要打字確認
//   4. 目標季度冇預設值，一定要使用者揀
//
// ⚠️ 而且工具**唔可以自動清理**——自動清理係不可逆動作。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Diagnostics.gs', 'SeasonRehearsal.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const src = read('src/SeasonRehearsal.gs');
const guard = gas.evaluateSeasonRehearsalGuards_;
const PROTECTED = ['2027T1'];

function ok(overrides) {
  return Object.assign({
    isDryRun: true, quarterId: '2027T4',
    protectedQuarters: PROTECTED, typedText: null
  }, overrides || {});
}

console.log('\n=== D2 閘 1：DRY_RUN 一定要 TRUE ===');
{
  check('★★★★★ DRY_RUN=TRUE ⇒ 放行', guard(ok()).blocked === false);

  const off = guard(ok({ isDryRun: false }));
  check('★★★★★ DRY_RUN=FALSE ⇒ 擋住', off.blocked === true);
  check('★★★★★ 而且講明後果：嗰啲信會真係寄出去'
    + '——「DRY_RUN 唔係 TRUE」本身唔係一個理由',
    off.reasons.join('').indexOf('會真的寄出去給全體義工') !== -1,
    off.reasons.join('\n'));

  check('★★★★★ **`undefined` 唔算通過**（讀唔到 Config）'
    + '——「查不到」同「查到係 TRUE」係兩件事，'
    + '而估錯嗰邊嘅代價係真係寄信',
    guard(ok({ isDryRun: undefined })).blocked === true);
  check('★★★★★ 亦唔接受字串 "TRUE"（一定要 boolean true）'
    + '——一個非空字串喺 JS 入面永遠 truthy，用 `if (x)` 就會靜靜放行',
    guard(ok({ isDryRun: 'TRUE' })).blocked === true);
  check('★★★★ `null`／0／空字串一律擋',
    guard(ok({ isDryRun: null })).blocked === true
    && guard(ok({ isDryRun: 0 })).blocked === true
    && guard(ok({ isDryRun: '' })).blocked === true);
}

console.log('\n=== D2 閘 2：目標季度冇預設值 ===');
{
  const none = guard(ok({ quarterId: '' }));
  check('★★★★★ 冇揀季度 ⇒ 擋住', none.blocked === true);
  check('★★★★★ 而且講明係**刻意**冇預設值，唔係漏咗',
    none.reasons.join('').indexOf('刻意沒有預設值') !== -1, none.reasons.join('\n'));
  check('★★★★ 只有空白都當冇揀',
    guard(ok({ quarterId: '   ' })).blocked === true);
}

console.log('\n=== D2 閘 3：受保護季度 ===');
{
  const live = guard(ok({ quarterId: '2027T1' }));
  check('★★★★★ 受保護季度 ⇒ 擋住', live.blocked === true);
  check('★★★★★ 而且講明點解（會把真正嘅資料弄髒，之後分唔出邊啲係演練留低）',
    live.reasons.join('').indexOf('很難分辨哪些是演練留下的') !== -1,
    live.reasons.join('\n'));
  check('★★★★ 大小寫唔同都擋得住（`2027t1`）'
    + '——大小寫係一個打字習慣，唔應該變成保護嘅漏洞',
    guard(ok({ quarterId: '2027t1' })).blocked === true);
  check('★★★★★ 清單有多過一季都逐個擋',
    guard(ok({ quarterId: '2028T1', protectedQuarters: ['2027T1', '2028T1'] }))
      .blocked === true);
  check('★★★★ 唔喺清單嘅季度放行',
    guard(ok({ quarterId: '2027T4' })).blocked === false);
}

console.log('\n=== D2 閘 4：打字確認 ===');
{
  check('★★★★★ `typedText: null` ＝ 仲未問到嗰步 ⇒ 唔當失敗'
    + '（第一次算閘嗰陣要行得過，先問得到）',
    guard(ok({ typedText: null })).blocked === false);
  check('★★★★★ 打對咗 ⇒ 放行',
    guard(ok({ typedText: '演練' })).blocked === false);
  check('★★★★ 前後有空白都當打對',
    guard(ok({ typedText: '  演練  ' })).blocked === false);
  check('★★★★★ 打錯／空白 ⇒ 擋住',
    guard(ok({ typedText: '' })).blocked === true
    && guard(ok({ typedText: 'yes' })).blocked === true);
  check('★★★★★ 而且講明「什麼都沒有做」'
    + '——取消之後最要緊知道嘅就係「有冇做咗一半」',
    guard(ok({ typedText: 'yes' })).reasons.join('').indexOf('什麼都沒有做') !== -1);
}

console.log('\n=== D2【核心】四道閘一次過講晒，唔係逐個拋 ===');
{
  const all = guard({
    isDryRun: false, quarterId: '2027T1',
    protectedQuarters: PROTECTED, typedText: 'no'
  });
  check('★★★★★ 三個問題一次過列出（DRY_RUN／受保護季度／打字）'
    + '——逐個拋嘅話，使用者改完一個再撳先發現仲有第二個',
    all.reasons.length === 3, JSON.stringify(all.reasons));
  // 抽出函式本體再檢查——用一個「由函式開頭到下一個頂層 `}` 」嘅切法，
  // 唔係靠一個猜出嚟嘅字元數上限（上限估短咗就檢查唔到嘢，估長咗
  // 就會掃埋下一個函式，兩種都係一個「睇落綠色」嘅假通過）。
  const body = (function () {
    const start = src.indexOf('function evaluateSeasonRehearsalGuards_(');
    const rest = src.slice(start);
    const end = rest.indexOf('\n}\n');
    return end === -1 ? rest : rest.slice(0, end);
  })();
  check('★★★★ 而且係純函式：唔讀 Config、唔讀工作表',
    body.length > 200 && !/getConfig|readSheet|SpreadsheetApp|DriveApp/.test(body),
    body.slice(0, 200));
}

console.log('\n=== D2 受保護清單：Config 讀唔到唔等於冇保護 ===');
{
  check('★★★★★ 有一個寫死嘅預設清單',
    gas.SEASON_REHEARSAL_PROTECTED_DEFAULT === '2027T1');
  check('★★★★★ Config 填成空白 ⇒ **仍然用預設**，唔會變成乜都唔保護'
    + '——只靠 Config 嘅話，一個被清走嘅 key 就等於保護消失，'
    + '而畫面上完全睇唔出',
    /if \(raw === ''\) raw = SEASON_REHEARSAL_PROTECTED_DEFAULT;/.test(src));
  check('★★★★ 讀 Config 拋錯都退返預設，唔會拋出去',
    /catch \(err\) \{\s*\n\s*raw = SEASON_REHEARSAL_PROTECTED_DEFAULT;/.test(src));
}

console.log('\n=== D3【核心】一步失敗要繼續行落去 ===');
{
  const log = [];
  gas.runRehearsalStep_(log, '第一步', function () { return { a: 1 }; });
  gas.runRehearsalStep_(log, '第二步', function () { throw new Error('故意炸'); });
  const third = gas.runRehearsalStep_(log, '第三步', function () { return { c: 3 }; });

  check('★★★★★ 中間一步炸咗，第三步照樣行'
    + '——中途 throw 就見唔到後面幾步嘅問題，而「串起嚟」嗰層'
    + '嘅問題好多時就係喺後面先浮現',
    log.length === 3 && third !== null && third.c === 3, JSON.stringify(log));
  check('★★★★★ 失敗嗰步記低咗錯誤訊息，唔係靜靜跳過',
    log[1].ok === false && log[1].error === '故意炸');
  check('★★★★ 每一步都有耗時（B 段要知道成個流程要幾耐）',
    log.every(function (s) { return typeof s.seconds === 'number'; }));
  check('★★★★ 成功嗰步回返 detail 畀下一步用',
    log[0].ok === true && log[0].detail.a === 1);
}

console.log('\n=== D4【核心】報告：PDF 逐個檔案嘅完整路徑 ===');
{
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4',
    baseline: { stage: 'DRAFT', latestVersionNo: -1, sendLogRows: 0, pdfFileCount: 0 },
    after: { stage: 'OFFICIAL_SENT', latestVersionNo: 1, sendLogRows: 62, pdfFileCount: 58 },
    steps: [{ name: '步驟 1：生成初稿', ok: true, seconds: 12.3, detail: { versionNo: 0 }, error: '' }],
    pdfFiles: {
      available: true, rootName: 'RosterPDF',
      files: [
        { name: 'a.pdf', sizeBytes: 1000, path: 'RosterPDF / 2027T4 / v0 / a.pdf', inSubfolder: true },
        { name: 'b.pdf', sizeBytes: 2000, path: 'RosterPDF / b.pdf', inSubfolder: false }
      ]
    },
    ics: { available: true, lines: ['DTSTART;TZID=Pacific/Auckland:20270103T090000'] },
    highlight: { available: true, personId: 'P9001', cellCount: 4 }
  });
  const text = rows.map(function (r) {
    return [r.section, r.item, r.value, r.note].join(' | ');
  }).join('\n');

  check('★★★★★ 逐個 PDF 列出**完整路徑**'
    + '——分季分版資料夾從來未真正建過，係目前風險最高嘅未驗證項，'
    + '所以唔可以只出一個檔案數',
    text.indexOf('RosterPDF / 2027T4 / v0 / a.pdf') !== -1
    && text.indexOf('RosterPDF / b.pdf') !== -1);
  check('★★★★★ 分開數「喺子資料夾」同「仍然平鋪喺根資料夾」',
    text.indexOf('在「季度／版本」子資料夾裡 | 1') !== -1
    && text.indexOf('仍然平鋪在根資料夾 | 1') !== -1, text);

  const noSub = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {}, steps: [],
    pdfFiles: {
      available: true, rootName: 'RosterPDF',
      files: [{ name: 'b.pdf', sizeBytes: 1, path: 'RosterPDF / b.pdf', inSubfolder: false }]
    },
    ics: { available: false, reason: '沒有版本' },
    highlight: { available: false, reason: '沒有版本' }
  });
  check('★★★★★ 一個都冇落子資料夾 ⇒ **明講出嚟**'
    + '（呢個就係「資料夾根本冇建到」嗰個 case）',
    noSub.some(function (r) {
      return String(r.note).indexOf('分季分版資料夾可能根本沒有建到') !== -1;
    }));
}

console.log('\n=== D4 報告：ICS 嘅 DTSTART／DTEND 原樣印出 ===');
{
  const bad = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {}, steps: [],
    pdfFiles: { available: false, reason: '讀不到' },
    ics: { available: true, lines: ['DTSTART;TZID=Pacific/Auckland:NaNNaNNaNTNaNNaN00'] },
    highlight: { available: false, reason: '沒有版本' }
  });
  check('★★★★★ 含 NaN 嗰行會被標出嚟'
    + '——之前撞過 `NaNNaNNaN`，修咗但未真正寄過一次',
    bad.some(function (r) {
      return String(r.note).indexOf('含 NaN') !== -1;
    }), JSON.stringify(bad.filter(function (r) { return r.section === 'ICS 附件'; })));

  const none = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {}, steps: [],
    pdfFiles: { available: false, reason: '讀不到' },
    ics: { available: true, lines: [] },
    highlight: { available: false, reason: '沒有版本' }
  });
  check('★★★★★ 有檔案但一行時間都搵唔到 ⇒ 亦要標出嚟'
    + '——「冇 NaN」唔等於「有正確時間」',
    none.some(function (r) { return String(r.value).indexOf('一行都沒有') !== -1; }));
}

console.log('\n=== D4 報告：查不到就講查不到 ===');
{
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4', baseline: {}, after: {}, steps: [],
    pdfFiles: { available: false, reason: 'ROSTER_DRIVE_FOLDER_ID 未設定' },
    ics: { available: false, reason: '這一季還沒有版本' },
    highlight: { available: false, reason: '這一季還沒有版本' }
  });
  const text = rows.map(function (r) { return [r.item, r.value, r.note].join('|'); }).join('\n');
  check('★★★★★ PDF 讀唔到 ⇒ 明講「不是一份都沒有——是根本讀不到資料夾」'
    + '——回一個 0 會令人以為確認過',
    text.indexOf('不是「一份都沒有」') !== -1, text);
  check('★★★★ ICS 同 highlight 一樣講返原因',
    text.indexOf('這一季還沒有版本') !== -1);
}

console.log('\n=== D5【核心】工具唔會自動清理 ===');
{
  const rows = gas.buildSeasonRehearsalRows_({
    quarterId: '2027T4',
    baseline: { stage: 'DRAFT', latestVersionNo: -1, sendLogRows: 0, pdfFileCount: 0 },
    after: { stage: 'OFFICIAL_SENT', latestVersionNo: 1, sendLogRows: 62, pdfFileCount: 58 },
    steps: [], pdfFiles: { available: false, reason: 'x' },
    ics: { available: false, reason: 'x' }, highlight: { available: false, reason: 'x' }
  });
  const cleanup = rows.filter(function (r) { return r.section === '清理'; });
  check('★★★★★ 列出呢次演練建立咗乜（版本／SendLog／PDF 各自由幾多變到幾多）',
    cleanup.some(function (r) {
      return String(r.value).indexOf('版本 -1 → 1') !== -1
        && String(r.value).indexOf('SendLog 0 → 62') !== -1
        && String(r.value).indexOf('PDF 0 → 58') !== -1;
    }), JSON.stringify(cleanup));
  check('★★★★★ 講明點清（指去「重設季度測試資料」）',
    cleanup.some(function (r) {
      return String(r.value).indexOf('重設季度測試資料') !== -1;
    }));
  check('★★★★★ 而且講明係**刻意**唔自動清'
    + '——自動清理係不可逆動作，唔可以由一個測試工具代做',
    cleanup.some(function (r) {
      return String(r.note).indexOf('刻意不會自動清理') !== -1;
    }));

  // 反面：整個檔案都唔應該叫任何刪除／重設。
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  const code = stripComments(src);
  check('★★★★★ 程式碼一行都冇叫過清理／刪除',
    !/planQuarterReset_|executeQuarterReset_|deleteFile|setTrashed|deleteSheet|deleteRow/
      .test(code));
}

console.log('\n=== D 報告去 Diagnostics，唔係塞落 ui.alert() ===');
{
  check('★★★★★ 行 `tryWriteDiagnostics_()` 寫 Diagnostics',
    /tryWriteDiagnostics_\(SEASON_REHEARSAL_REPORT, rows\)/.test(src));
  check('★★★★★ `ui.alert()` 只講幾個關鍵數字同「去邊度睇」，唔會逐行塞'
    + '——一個對話框裝唔落，而 Diagnostics 先係 connector 讀得返嗰一份表',
    /完整報告已寫入 ' \+ SHEETS\.DIAGNOSTICS/.test(src)
    && !/rows\.forEach[\s\S]{0,200}?ui\.alert/.test(src));
  check('★★★★ 同名報告會覆蓋，唔會累積（沿用既有 writeDiagnosticsReport_ 行為）',
    /const SEASON_REHEARSAL_REPORT = '全季流程演練';/.test(src));
}

console.log('\n=== D1 放試算表選單，唔搬上 Web ===');
{
  const menu = read('src/Menu.gs');
  check('★★★★★ 選單有註冊，而且喺「測試工具」嗰組',
    /addItem\('⚠️⚠️ 全季流程演練（只在 DRY_RUN 沙盒季度）', 'runSeasonRehearsal_'\)/.test(menu));
  check('★★★★★ 標住 ⚠️⚠️（會建立版本、產生 PDF、寫 SendLog）',
    /⚠️⚠️ 全季流程演練/.test(menu));
  check('★★★★★ **冇任何 `api*` 端點**——呢個係測試工具，'
    + '使用者係 Ivan 唔係幹事，搬上 Web 只會令幹事撳錯',
    !/function api[A-Z]/.test(src));
  check('★★★★★ 而且冇註冊落 Web 嘅唯讀白名單',
    !/SeasonRehearsal|runSeasonRehearsal_|apiSeasonRehearsal/
      .test(read('src/ui/Script.html')));
}

console.log('\n=== D 內部：唔可以行 `api*`（嗰啲有 Web 請求關卡）===');
{
  check('★★★★★ 步驟 2 行 `buildSaveAndConfirmPlan_()` 而唔係 `apiSaveAndConfirmPlan()`'
    + '——後者第一行係 `assertWebAppRequestAllowed_()`，'
    + 'Web UI 一關就會拋一個同演練無關嘅錯',
    /const plan = buildSaveAndConfirmPlan_\(quarterId\);/.test(src)
    && !/apiSaveAndConfirmPlan\(/.test(src.replace(/\/\/.*$/gm, '')));
  check('★★★★★ `plan.requests` 當成物件讀（佢係 `{apply, confirm, needsInput}`）'
    + '——當佢係陣列讀 `.length` 會靜靜得出 undefined，'
    + '而「零申報」同「讀錯欄」喺報告上睇落一樣',
    /req\.apply\.length \+ req\.confirm\.length \+ req\.needsInput\.length/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
