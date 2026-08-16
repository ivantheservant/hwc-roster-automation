// 第十九輪批次階段 C5：步驟 4 缺件保護與 Stage 前進判斷。
// 執行方式：node tests/step4_missing_pdf_gate.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住嘅係一次「靜靜噉失敗嘅正式發出」
// ─────────────────────────────────────────────────────────────────────
//
// Ivan 實測撞到：
//   1. 未產生個人 PDF 就行步驟 4 ⇒ 警告「57 / 57 人缺個人 PDF」，
//      但畀咗「現在繼續」呢個選擇
//   2. 撳繼續 ⇒ 收件人 59、模擬 2、PDF 缺件 57、失敗 0
//      —— 57 位義工一個都冇通知到
//   3. **Stage 照樣前進到 OFFICIAL_SENT**
//   4. 補齊 PDF 想重跑步驟 4 ⇒ 「需要 Stage 為 REQUESTS_APPLIED」，拒絕
//   5. 摘要嗰行「失敗：0」令人以為一切正常
//
// 換咗 DRY_RUN=FALSE，呢個就係「系統話已正式發出、Stage 已鎖定，
// 但全體義工一個都冇收到」。

const { loadGasSource } = require('./helpers/gas_loader.js');

// FiveStageCore.gs 嘅三個純函式住喺呢度。Constants.gs 提供 DEFAULTS／CONFIG_KEYS。
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'FiveStageCore.gs']);

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

function missingResult(missingCount, total) {
  const missing = [];
  for (let i = 0; i < missingCount; i++) missing.push({ nameTC: '假甲', personId: 'P9' + (100 + i) });
  return { applicable: true, missing: missing, total: total };
}

// 門檻明確傳入，唔依賴 Config 讀取（測試唔應該碰試算表）
const LIMIT = 0.2;

console.log('\n=== C1【核心】全部缺件（57 / 57）一定要擋 ===');
{
  const gate = gas.evaluateStep4MissingPdfGate_(missingResult(57, 57), LIMIT);
  check('★★★★★ blocked = true——實測嗰次係 57/57 都可以撳「繼續」，'
    + '結果全體義工冇收到而 Stage 照樣鎖死', gate.blocked === true);
  checkEqual('★★★★ 比例算啱', gate.ratio, 1);
  check('★★★★ 訊息講得出實際數字', gate.message.indexOf('57 / 57') !== -1, gate.message);
  check('★★★★ 訊息講得出後果（收唔到＋Stage 會鎖死）',
    gate.message.indexOf('收不到') !== -1 && gate.message.indexOf('OFFICIAL_SENT') !== -1);
  check('★★★★ 訊息講得出點解決', gate.message.indexOf('產生個人 PDF') !== -1);
  check('★★★ 訊息講得出去邊度調門檻',
    gate.message.indexOf('STEP4_MAX_MISSING_PDF_RATIO') !== -1);
}

console.log('\n=== C1：少量缺件仍然容許繼續（唔可以一刀切全擋）===');
{
  // 1 / 57 ≈ 1.8%，遠低於 20%
  const gate = gas.evaluateStep4MissingPdfGate_(missingResult(1, 57), LIMIT);
  check('★★★★★ blocked = false——少量缺件係合理營運情況，'
    + '一刀切全擋會令幹事為咗一個人卡住成季，跟住就會想辦法繞過關卡',
    gate.blocked === false, JSON.stringify(gate));
  checkEqual('★★★★ 仍然報得出缺件人數（要顯示警告）', gate.missingCount, 1);
}

console.log('\n=== C1：門檻邊界 ===');
{
  // 恰好等於門檻要放行（<= limit），超過先擋
  check('★★★★ 恰好 20%（2/10）放行',
    gas.evaluateStep4MissingPdfGate_(missingResult(2, 10), 0.2).blocked === false);
  check('★★★★ 30%（3/10）擋',
    gas.evaluateStep4MissingPdfGate_(missingResult(3, 10), 0.2).blocked === true);
  check('★★★ 完全冇缺件唔會擋',
    gas.evaluateStep4MissingPdfGate_(missingResult(0, 57), LIMIT).blocked === false);
  check('★★★ 唔適用（範本冇個人 PDF 附件）唔會擋',
    gas.evaluateStep4MissingPdfGate_({ applicable: false, missing: [], total: 0 }, LIMIT).blocked === false);
}

// =====================================================================
// C2：Stage 前進與否
// =====================================================================
console.log('\n=== C2【核心】三種情境嘅 Stage 前進判斷 ===');
{
  // 情境一：全部缺件——正正就係實測嗰次
  const allMissing = gas.evaluateStep4SendOutcome_({
    sent: 0, dryRun: 2, skipped: 0, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 57, isDryRun: true
  });
  check('★★★★★ 全部缺件 ⇒ ok = false，**唔前進 Stage**'
    + '（實測嗰次係無條件前進，於是想補救都無門）', allMissing.ok === false);
  checkEqual('★★★★ 未處理人數 = 57', allMissing.unhandledCount, 57);
  check('★★★★ 訊息講明 Stage 冇前進、可以再跑一次',
    allMissing.message.indexOf('沒有前進') !== -1
      && allMissing.message.indexOf('再執行一次') !== -1, allMissing.message);
  check('★★★★ 訊息指路去補寄工具（唔好靠步驟 5 嘅副作用救）',
    allMissing.message.indexOf('補寄未收到的人') !== -1);

  // 情境二：部分缺件
  const partial = gas.evaluateStep4SendOutcome_({
    sent: 50, dryRun: 0, skipped: 7, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 2, isDryRun: false
  });
  check('★★★★★ 部分缺件（2 位）⇒ 一樣唔前進——'
    + '「大部分人收到」唔等於「完成」', partial.ok === false);
  checkEqual('★★★★ 未處理人數 = 2', partial.unhandledCount, 2);

  // 情境三：只有 SKIPPED_NO_EMAIL
  const noEmailOnly = gas.evaluateStep4SendOutcome_({
    sent: 50, dryRun: 0, skipped: 7, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 0, isDryRun: false
  });
  check('★★★★★ 只有「查無電郵」⇒ ok = true，**照樣前進**'
    + '——本季有 7 位義工本來就冇電郵，已知而且無解，'
    + '唔應該因為呢個卡住成季', noEmailOnly.ok === true);
  checkEqual('★★★★ 查無電郵唔計入未處理', noEmailOnly.unhandledCount, 0);
}

console.log('\n=== C2：寄送失敗同 PDF 產生失敗一樣算未處理 ===');
{
  check('★★★★ FAILED 算未處理', gas.evaluateStep4SendOutcome_({
    sent: 50, skipped: 0, failed: 3, errorPdf: 0, errorPdfMissing: 0
  }).ok === false);
  check('★★★★ ERROR_PDF 算未處理', gas.evaluateStep4SendOutcome_({
    sent: 50, skipped: 0, failed: 0, errorPdf: 1, errorPdfMissing: 0
  }).ok === false);
  checkEqual('★★★ 三種一齊出現時人數會加埋', gas.evaluateStep4SendOutcome_({
    sent: 10, skipped: 0, failed: 3, errorPdf: 1, errorPdfMissing: 2
  }).unhandledCount, 6);
}

// =====================================================================
// C4：摘要結論句
// =====================================================================
console.log('\n=== C4【核心】摘要要講得出真相 ===');
{
  // 實測見到嗰組數字：寄出 0　模擬 2　失敗 0　PDF 缺件 57
  // 每個數字都啱，但讀落去似乎冇事（「失敗：0」）
  const sentence = gas.buildStep4OutcomeSentence_({
    sent: 0, dryRun: 2, skipped: 0, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 57, isDryRun: true
  });
  check('★★★★★ 結論句直接講「57 位義工未收到通知」'
    + '——之前得四行數字，「失敗：0」讀落似乎冇事',
    sentence.indexOf('57 位義工未收到通知') !== -1, sentence);
  check('★★★★ 有警告符號，唔會混入一般資訊',
    sentence.indexOf('⚠️') !== -1, sentence);

  const ok = gas.buildStep4OutcomeSentence_({
    sent: 50, dryRun: 0, skipped: 7, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 0, isDryRun: false
  });
  check('★★★★★ 一切正常時講得出「冇任何一位因為系統出錯而漏掉」',
    ok.indexOf('✅') !== -1 && ok.indexOf('系統出錯') !== -1, ok);
  check('★★★★ 順帶交代查無電郵嗰 7 位（唔好令人以為漏咗）',
    ok.indexOf('7 位查無電郵') !== -1, ok);

  const dry = gas.buildStep4OutcomeSentence_({
    sent: 0, dryRun: 59, skipped: 0, unchanged: 0,
    failed: 0, errorPdf: 0, errorPdfMissing: 0, isDryRun: true
  });
  check('★★★★ DRY_RUN 時要講明係模擬、冇真正寄出',
    dry.indexOf('模擬') !== -1 && dry.indexOf('沒有真正寄出') !== -1, dry);
}

console.log('\n=== C2：executeStep4Send_ 唔可以再無條件前進 Stage ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'FiveStageCore.gs'), 'utf8');
  const body = src.slice(src.indexOf('function executeStep4Send_'));
  const fnBody = body.slice(0, body.indexOf('\n}\n') + 3);

  check('★★★★★ advanceQuarterStage_ 一定要喺 `if (outcome.ok)` 入面'
    + '——無條件前進就係實測嗰個 bug 嘅根源',
    /if\s*\(\s*outcome\.ok\s*\)\s*\{[\s\S]*?advanceQuarterStage_/.test(fnBody),
    fnBody);
  check('★★★★ 真正寄之前仲有一道缺件檢查'
    + '（Web UI 每次請求獨立，攔唔到直接呼叫）',
    fnBody.indexOf('evaluateStep4MissingPdfGate_') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
