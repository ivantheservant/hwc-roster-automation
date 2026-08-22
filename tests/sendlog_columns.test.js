// 第五十輪批次 C／E 組：不變量「唔適用」＋ SendLog 缺欄。
// 執行方式：node tests/sendlog_columns.test.js
//
// ═════════════════════════════════════════════════════════════════════
// E 組：`SendLog` 缺 `IntendedEmail` 同 `DeliveredTo`
// ═════════════════════════════════════════════════════════════════════
//
// 現場（自測機嘅 I01，每一個情境都報）：
//
//     I01｜預期 0 個缺欄｜實際 2 個缺欄｜
//     SendLog：缺「IntendedEmail」（COLUMNS.SEND_LOG.INTENDED_EMAIL）；
//     SendLog：缺「DeliveredTo」（COLUMNS.SEND_LOG.DELIVERED_TO）
//
// 呢一條係真嘅。`Mailer.gs` 真係有寫呢兩個值入 `record`，但
// `writeSendLogRows_()` 係按表頭逐欄寫，而真實試算表冇呢兩欄 ⇒
// 兩個值靜靜掉咗。
//
// ⚠️ `MAIL_REDIRECT_ALL_TO` 而家有值、正在生效。即係 Ivan 準備做嘅
// 真實寄信測試，`SendLog` 只會記到轉寄地址，記唔到「原本要寄畀邊個」。
// 第四十一輪 H 組要防嗰件事，**一次都冇真正生效過**。
//
// ⚠️⚠️ 而且第四十七輪特登為此寫嘅 `tools/lint-schema-drift.js`
// **捉唔到呢一個**——佢只驗得到「碼對碼」。呢一次係執行期不變量 I01 捉到。
// **離線 lint 同執行期不變量擋嘅係兩種病，唔可以互相取代。**

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'MailRedirect.gs', 'Roles.gs', 'Mailer.gs',
  // `invariantDialogNumbers_()` 用 `SEND_RECIPIENT_SCOPE.PICK` 砌第二種選項。
  'SendOptions.gs',
  // `STEP4_ALLOWED_STAGES_` 喺呢度——⚠️ 載入**真嗰支**，
  // 唔喺測試度手打一份。手打一份就係「兩個定義」，
  // 而呢個專案由第一輪殺到而家嗰種錯就係噉嚟。
  'FiveStageCore.gs', 'Invariants.gs'
]);

// =====================================================================
console.log('\n=== E1【核心】補欄工具：只喺最後加，唔改既有資料 ===');
{
  const src = read('src/MailRedirect.gs');
  check('★★★★★ 有 `planSendLogColumnBackfill_()`（純讀取）',
    /function planSendLogColumnBackfill_\(/.test(src), '');
  check('★★★★★ 有 `executeSendLogColumnBackfill_(plan)`',
    /function executeSendLogColumnBackfill_\(/.test(src), '');
  check('★★★★★ 有選單入口',
    /function runSendLogColumnBackfill_\(/.test(src)
      && /補建 SendLog 缺欄/.test(read('src/Menu.gs')), '');
  check('★★★★★★ 已經有齊 ⇒ 明確報「沒有改動」'
    + '——靜靜做多次會令幹事以為佢做漏咗',
    /已經有全部欄，沒有改動/.test(src), '');
  check('★★★★★★ **唔會替既有行填值**'
    + '——舊行到底寄咗去邊，而家已經無從得知；'
    + '猜一個上去就係造假紀錄，而假紀錄比冇紀錄更差',
    /不會替任何一行填值/.test(src), '');
  check('★★★★★★ 而且補完要講明「既有嗰幾行呢兩欄會係空白，嗰個係正常嘅」'
    + '——唔講嘅話，幹事見到一片空白會以為補欄失敗咗',
    /那是正常的/.test(src), '');
  check('★★★★★ 有寫 `AuditLog`',
    /action: 'SEND_LOG_COLUMN_BACKFILL'/.test(src), '');

  // ⚠️ 只喺最後加欄。
  const exec = src.slice(src.indexOf('function executeSendLogColumnBackfill_('),
    src.indexOf('function runSendLogColumnBackfill_('));
  check('★★★★★★ 由 `plan.nextCol` 開始逐欄加，冇 `insertColumn`／冇重排',
    /let col = plan\.nextCol;/.test(exec)
      && !/insertColumn/.test(exec) && !/deleteColumn/.test(exec), exec.slice(0, 300));
}

// =====================================================================
console.log('\n=== E2【核心】轉寄生效 ＋ 缺欄 ⇒ 直接擋住 ===');
{
  const assertReady = gas.assertSendLogRedirectColumnsReady_;
  const C = gas.COLUMNS.SEND_LOG;
  const fullHeaders = Object.keys(C).map(function (k) { return C[k]; });
  const withoutIntended = fullHeaders.filter(function (h) {
    return h !== C.INTENDED_EMAIL && h !== C.DELIVERED_TO;
  });

  const setRedirect = function (value) {
    gas.getConfig = function (key, fallback) {
      if (key === gas.CONFIG_KEYS.MAIL_REDIRECT_ALL_TO) return value;
      return fallback;
    };
  };
  const warned = [];
  gas.log_ = function (level, msg) { warned.push(level + '｜' + msg); };

  // ── 有齊欄 ⇒ 乜都唔做 ──────────────────────────────────────
  setRedirect('someone@a-mail.test');
  warned.length = 0;
  let threw = '';
  try { assertReady(fullHeaders); } catch (err) { threw = err.message; }
  checkEqual('★★★★★ 有齊兩欄 ⇒ 唔擋、唔 WARN', threw + '|' + warned.length, '|0');

  // ── 缺欄，而轉寄冇生效 ⇒ 只 WARN，唔擋 ─────────────────────
  //
  // ⚠️ **唔好把成個寄送流程綁死喺一個歷史遺留問題上。**
  // 轉寄冇生效嗰陣，`IntendedEmail` 同 `DeliveredTo` 本來就等於 `Email`。
  setRedirect('');
  warned.length = 0;
  threw = '';
  try { assertReady(withoutIntended); } catch (err) { threw = err.message; }
  checkEqual('★★★★★★ 缺欄 ＋ 轉寄冇生效 ⇒ **唔擋**', threw, '');
  check('★★★★★★ 但要 WARN——靜靜略過就係呢個專案一直喺度殺嗰個 bug class',
    warned.some(function (w) { return /WARN/.test(w) && /SendLog 沒有/.test(w); }),
    JSON.stringify(warned));

  // ── 缺欄，而轉寄生效 ⇒ **擋住** ────────────────────────────
  setRedirect('someone@a-mail.test');
  threw = '';
  try { assertReady(withoutIntended); } catch (err) { threw = err.message; }
  // ⚠️ 唔可以淨係驗 `threw !== ''`。
  // 一個 `TypeError: assertReady is not a function`（即係我根本冇載入
  // 嗰支檔案）一樣會令佢成立——實測就係噉：呢一條喺函式唔存在嘅時候
  // 照樣綠。所以要驗**佢拋嘅係我要嗰句**。
  check('★★★★★★ 缺 `IntendedEmail` ＋ 轉寄生效 ⇒ **一封都唔寄**'
    + '——嗰個先係呢兩欄存在嘅唯一理由：'
    + '信實際寄咗去轉寄地址，而「原本要寄畀邊個」只喺嗰一欄度',
    /轉寄測試地址生效中/.test(threw), threw || '（沒有拋錯，即是照樣寄了出去）');
  check('★★★★★★ 訊息係三段式（發生了什麼／現在的情況／你可以怎樣做）',
    /發生了什麼/.test(threw) && /現在的情況/.test(threw) && /你可以怎樣做/.test(threw),
    threw);
  check('★★★★★★ 而且講得出去邊度補',
    /補建 SendLog 缺欄/.test(threw), threw);
  check('★★★★★ 同埋講明「一封都沒有寄出」',
    /一封都沒有寄出/.test(threw), threw);
  check('★★★★★ 仲畀多一條出路（唔想用轉寄就清空 Config）',
    /MAIL_REDIRECT_ALL_TO/.test(threw) && /清空/.test(threw), threw);

  // ── 只缺 `DeliveredTo` ⇒ WARN，唔擋 ────────────────────────
  const withoutDelivered = fullHeaders.filter(function (h) { return h !== C.DELIVERED_TO; });
  warned.length = 0;
  threw = '';
  try { assertReady(withoutDelivered); } catch (err) { threw = err.message; }
  checkEqual('★★★★★ 只缺 `DeliveredTo` ⇒ 唔擋'
    + '（轉寄地址喺 Config 查得返）', threw, '');
  check('★★★★★ 但一樣要 WARN',
    warned.some(function (w) { return /DeliveredTo/.test(w); }), JSON.stringify(warned));

  // ── 讀唔到轉寄設定 ⇒ **當成有生效** ────────────────────────
  gas.getConfig = function () { throw new Error('故意爆：讀不到 Config'); };
  threw = '';
  try { assertReady(withoutIntended); } catch (err) { threw = err.message; }
  check('★★★★★★ 讀唔到轉寄設定 ⇒ **當成有生效，照擋**'
    + '——「查不到」當成「冇事」就係呢個專案一直喺度殺嗰個 bug class，'
    + '而估錯呢一邊嘅代價係一批查唔返嘅寄送紀錄',
    /轉寄測試地址生效中/.test(threw) && /讀不到/.test(threw),
    threw || '（沒有拋錯）');

  // ── 接線：`writeSendLogRows_()` 真係叫咗佢 ─────────────────
  const mailer = read('src/Mailer.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ `writeSendLogRows_()` 真係叫咗呢個檢查'
    + '——寫咗一個擋而冇人叫，等於冇寫過',
    /function writeSendLogRows_[\s\S]{0,900}assertSendLogRedirectColumnsReady_\(headers\)/
      .test(mailer), '');
}

// =====================================================================
console.log('\n=== C【核心】不變量：「唔適用」唔可以當成失敗 ===');
{
  // ⚠️ 現場：季度啱啱清乾淨、一個版本都未有，而 I08 報「算不出來」。
  // 呢一句唔係失敗，係「呢個狀態下本來就唔適用」。
  //
  // 後果：Stage 到 `REQUESTS_APPLIED` 之前每一個情境嘅 I08.step4 都會紅
  // ⇒ S01 到 S08 全部一定紅，不論系統本身有冇問題。
  // 紅色一多就冇人睇——嗰個就係假警報。
  checkEqual('★★★★★ 有 `NOT_APPLICABLE` 呢個狀態',
    gas.INVARIANT_STATUS.NOT_APPLICABLE, 'NOT_APPLICABLE');

  const na = gas.invariantResult_('I08.x', '一個數字',
    gas.INVARIANT_STATUS.NOT_APPLICABLE, '（不適用）', '還沒有版本', '還沒有版本');
  checkEqual('★★★★★★ `NOT_APPLICABLE` **唔算 ok**（唔係扮成通過）',
    na.ok, false);

  const report = {
    results: [na], okCount: 0, failedCount: 0, errorCount: 0,
    skippedCount: 0, notApplicableCount: 1
  };
  const lines = gas.describeInvariantReport_(report).join('\n');
  check('★★★★★★ 報告用 ⚪ 唔用 ⚠️'
    + '——用 ⚠️ 就會同真失敗混埋一齊，而紅色一多就冇人再睇',
    /⚪ I08\.x/.test(lines), lines);
  check('★★★★★ 摘要行有「不適用」一欄',
    /不適用 1/.test(lines), lines);
  check('★★★★★★ 而且**唔計入失敗**（`failedCount` 仍然係 0）',
    report.failedCount === 0 && /🔴 0/.test(lines), lines);

  // ── ⚠️ C2：分清楚「唔適用」同「算錯咗」──────────────────────
  const src = read('src/Invariants.gs');
  check('★★★★★★ 判斷準則寫咗喺檔頭'
    + '——分錯咗嘅話，呢一組就變成「把紅色改成睇唔見」，比而家更差',
    /NOT_APPLICABLE` 嘅判斷準則/.test(src)
      && /只有「前置條件本身唔成立」先至係 NOT_APPLICABLE/.test(src), '');
  check('★★★★★★ 而且**唔准靠讀錯誤訊息嘅字**去分'
    + '——錯誤訊息會改，而改咗之後一條真失敗就會靜靜變成「唔適用」',
    /唔可以靠讀錯誤訊息嘅字/.test(src), '');
  check('★★★★★★ 實作真係喺叫之前自己查（版本號 ＋ Stage）',
    /const versionNo = findLatestVersionNo\(quarterId\);[\s\S]{0,400}getQuarterStage_\(quarterId\)/
      .test(src), '');

  // ── ⚠️ 以下兩節**真係行一次** `invariantDialogNumbers_()` ─────────
  //
  // 之前呢兩條係讀原始碼字串，而 verify-red 兩條突變都照樣綠：
  // 把 `NOT_APPLICABLE` 改成 `FAILED`、把 `ERROR` 改成 `NOT_APPLICABLE`，
  // 兩次個字串都仲喺檔案入面。
  //
  // 讀字串答唔到「呢一段行出嚟係咩」。所以呢度餵真嘅前置狀態入去，
  // 睇佢**實際回咩 status**。

  // (a) 一個版本都未有 ⇒ 三個登記數字全部 `NOT_APPLICABLE`
  gas.findLatestVersionNo = function () { return -1; };
  gas.getQuarterStage_ = function () { return 'DRAFT'; };
  const naResults = gas.invariantDialogNumbers_('2028T3');
  check('★★★★★★ 一個版本都未有 ⇒ 全部 `NOT_APPLICABLE`'
    + '——唔係失敗。呢一句唔啱嘅話，S01 到 S08 全部一定紅，'
    + '不論系統本身有冇問題',
    naResults.length > 0 && naResults.every(function (r) {
      return r.status === gas.INVARIANT_STATUS.NOT_APPLICABLE;
    }),
    JSON.stringify(naResults.map(function (r) { return r.id + ':' + r.status; })));
  check('★★★★★ 而且每一條都講得出點解唔適用',
    naResults.every(function (r) { return /還沒有生成過版本/.test(r.evidence); }),
    JSON.stringify(naResults.map(function (r) { return r.evidence; })));

  // (b) 有版本、Stage 到位，而其中一條路拋錯 ⇒ **`ERROR`，唔係不適用**
  //
  // ⚠️ 呢一條就係 C2 嗰個分界。分錯咗，呢一組就變成
  // 「把紅色改成睇唔見」，比修之前更差。
  //
  // 特登令其中一條路拋錯——正好就係「前置條件成立咗，
  // 而其中一條路拋錯」嗰種情況。
  gas.findLatestVersionNo = function () { return 1; };
  gas.getQuarterStage_ = function () { return gas.QUARTER_STAGE.REQUESTS_APPLIED; };
  gas.planStep2_ = function () { throw new Error('故意爆：算不出來'); };
  gas.planStep4SendPreview_ = function () { throw new Error('故意爆：算不出來'); };
  gas.readDashboardUnsavedState_ = function () { throw new Error('故意爆：算不出來'); };
  const errResults = gas.invariantDialogNumbers_('2028T3');
  check('★★★★★★ 有版本、Stage 到位，而其中一條路拋錯 ⇒ **`ERROR`**'
    + '——**唔係**不適用。前置條件成立咗而算唔出，就係失敗，'
    + '而嗰個先係我哋要捉嘅嘢',
    errResults.length > 0 && errResults.every(function (r) {
      return r.status === gas.INVARIANT_STATUS.ERROR;
    }),
    JSON.stringify(errResults.map(function (r) { return r.id + ':' + r.status; })));
  check('★★★★★ 而且帶住實際嘅錯誤原文',
    errResults.every(function (r) { return String(r.evidence || '').trim() !== ''; }),
    JSON.stringify(errResults.map(function (r) { return r.evidence; })));
}

// =====================================================================
console.log('\n=== B2【核心】I04 只掃一季（自測機用），全表嗰個要留返 ===');
{
  const src = read('src/Invariants.gs');
  check('★★★★★★ `invariantAssignmentUniqueness_()` 收一個可選 `quarterId`',
    /function invariantAssignmentUniqueness_\(quarterId\)/.test(src), '');
  check('★★★★★★ 冇傳就掃全表（全面體檢嗰邊要用）'
    + '——唔可以因為自測機要快而把全表嗰條刪走：'
    + '一個跨季度嘅重複只有掃全表先睇得到',
    /if \(only && qid !== only\) return;/.test(src), '');
  check('★★★★★ 自測機嗰邊傳咗季度落去',
    /invariantAssignmentUniqueness_\(qid \|\| null\)/.test(src), '');
  check('★★★★★ 而且標題講明呢一次掃咗邊個範圍',
    /\(only \? '（只掃 ' \+ only \+ '）' : '（全表）'\)/.test(src), '');
}

// =====================================================================
console.log('\n=== E3【核心】lint 要講明「掃唔到」唔等於「冇事」 ===');
{
  const lint = read('tools/lint-schema-drift.js');
  check('★★★★★★ lint 報告講明佢只驗得到「碼對碼」',
    /只驗得到「碼對碼」/.test(lint), '');
  check('★★★★★★ 而且拿實測做例：`SendLog` 缺兩欄佢冇報過',
    /SendLog` 缺 `IntendedEmail`／`DeliveredTo` 兩欄/.test(lint), '');
  check('★★★★★★ 同埋講明「碼對真實試算表」只有 I01 做得到',
    /只有 I01/.test(lint), '');
  check('★★★★★★ 語氣要係警告，唔可以係一句中性嘅免責聲明'
    + '——之前嗰一句讀落似免責聲明，而實際上嗰 19 張入面'
    + '真係有一張缺欄',
    /唔係「查過冇事」，係「查唔到」/.test(lint), '');
}

// =====================================================================
console.log('\n=== I01 要列出**全部**缺欄，唔可以截斷 ===');
{
  const src = read('src/Invariants.gs');
  const fn = src.slice(src.indexOf('function invariantSheetHeaders_('),
    src.indexOf('function invariantButtonPreconditions_('));
  check('★★★★★★ I01 嘅證據係 `problems.join()`，冇 `.slice(0, N)` 截斷'
    + '——截斷咗就會出現「報咗頭兩個，而第三個冇人知」',
    /problems\.join\('；'\)/.test(fn) && !/problems\.slice\(/.test(fn), fn.slice(-400));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
