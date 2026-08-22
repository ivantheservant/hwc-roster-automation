// 第四十九輪批次 第 2 層 2C／2D：前端重播。
// 執行方式：node tests/ui_replay.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份同之前 170 份唔同喺邊
// ═════════════════════════════════════════════════════════════════════
//
// 之前每一份前端測試都係喺**讀原始碼字串**——
// 「`ScriptSendPaper.html` 入面有冇『寄出但不儲存』呢幾個字」。
// 而讀字串答唔到唯一重要嗰條問題：**呢一段到底行唔行得到。**
//
// 第四十七輪嗰個 bug 就係噉：一整個對話框寫得完全正確，
// 而上游嘅判斷令佢永遠行唔到。所有字串比對全部綠。
//
// 呢一份**真嘅執行** `src/ui/*.html` 入面嗰啲 `<script>`，
// 餵一份 `s` 落 `renderSendDialog()`，然後睇**實際畫咗啲乜出嚟**。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 份 `s` 由邊度嚟——講清楚
// ─────────────────────────────────────────────────────────────────────
//
// 決定行邊一條分支嗰幾個欄位（`kind`／`blockedByUnsavedOnly`／
// `canSendUnsaved`），全部由**真正嗰幾支後端函式**算出嚟：
//
//     computeDashboardButtons_()  →  resolveSendKind_()
//                                 →  computeSendBlockedByUnsavedOnly_()
//                                 →  canSendWithUnsavedChanges_()
//
// 即係話：如果邊一支改咗，呢一份會即刻反映。
//
// ⚠️ 但**呢個仍然唔係一份真環境錄影**。
// 真正嘅錄影由第 1 層自測機喺真試算表上做（寫入 `SelfTestPayloads`），
// 匯出之後放喺 `tests/payloads/`。呢一支見到嗰個資料夾有嘢就會
// **一併重播**；冇嘅話會大聲講明「呢一次淨係用後端算出嚟嗰份」。
//
// 唔講明嘅話，呢一層就會變成「我以為驗咗真嘢」——
// 而嗰個正正就係本輪要處理嘅病。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const ROOT = path.join(__dirname, '..');

// ── 後端：算出決定分支嗰幾個欄位 ──────────────────────────────────
const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  'SendOptions.gs', 'SendRecipients.gs', 'Mailer.gs', 'WebAppSendPlan.gs'
]);

function facts(overrides) {
  return Object.assign({
    stage: gas.QUARTER_STAGE.DRAFT,
    versionExists: true,
    generateOnText: '2028-03-01',
    daysUntilGenerateOn: -30,
    unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false },
    reviewerCount: 3,
    officialTargetCount: 20,
    officialNoEmailCount: 0,
    changedPersonCount: 0,
    hasOfficialRecord: false,
    lastSentAt: ''
  }, overrides || {});
}

/**
 * 砌一份 `s`。
 *
 * ⚠️ 決定分支嗰幾個欄位**全部由真正嗰幾支後端函式算**——
 * 唔係我打一個 `kind: 'NONE'` 落去。打落去就係喺假設答案，
 * 而假設答案就係第四十七輪個 bug 冇被捉到嘅原因。
 *
 * @param {Object} unsaved 未儲存狀態
 * @returns {Object} 一份 `apiGetSendPlanSummary()` 形狀嘅 `s`
 */
function buildSummaryFromBackend(unsaved) {
  const f = facts({ unsaved: unsaved });
  const buttons = gas.computeDashboardButtons_(f);
  const kind = gas.resolveSendKind_(buttons);
  const verdict = gas.canSendWithUnsavedChanges_(unsaved);
  return {
    kind: kind,
    blockedByUnsavedOnly: gas.computeSendBlockedByUnsavedOnly_(f),
    canSendUnsaved: verdict.allowed,
    canSendUnsavedReason: verdict.reason,
    unsaved: unsaved,
    latestVersion: { versionNo: 5, createdAt: '2026-08-22', basisText: '', sheetUrl: '' },
    blockedReasons: ['review', 'official', 'resend']
      .filter(function (k) { return buttons[k] && !buttons[k].enabled; })
      .map(function (k) { return { key: k, reason: buttons[k].disabledReason }; }),
    unsavedSendPreview: {
      versionNo: 5, savedAt: '2026-08-22',
      total: unsaved.gridChangeCount,
      moreCount: 0,
      shown: [], all: []
    },
    sendOptionDefaults: { recipientScope: 'ALL', attachType: 'NONE', includeIcs: false },
    attachOptionNotes: { NONE: '', PERSONAL_PDF: '', FULL_PDF: '' },
    // ⚠️ 欄位名照抄 `apiGetSendPlanSummary()` 真正回嗰個形狀
    //（`src/WebAppSendPlan.gs` 嘅 `permanentLink`）。
    //
    // 第一次跑呢一份嘅時候，我漏咗呢一個欄位，而前端即刻拋
    // `Cannot read properties of undefined (reading 'hasLink')`。
    // 呢個就係本層嘅價值：**形狀對唔上會即刻爆**，
    // 而唔係好似讀字串嗰陣咁靜靜綠燈。
    permanentLink: { url: '', hasLink: true, checkFailed: false }
  };
}

/** 開一次前端，回一個乾淨嘅 sandbox。 */
function freshUi() {
  return loadUiScripts([
    'Script.html', 'ScriptZone1.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html'
  ]);
}

const modalOf = function (ui) {
  return {
    title: ui.document.getElementById('modalTitle').textContent,
    body: ui.document.getElementById('modalBody').textContent,
    actions: ui.document.getElementById('modalActions').children
      .map(function (c) { return c.textContent; })
  };
};

// =====================================================================
console.log('\n=== 2C【核心】真嘅執行前端，唔係讀字串 ===');
{
  const ui = freshUi();
  check('★★★★★★ `src/ui/*.html` 嘅 `<script>` 真係喺 Node 度跑得起'
    + '——跑唔起嘅話，之前所有前端測試都只係喺讀字串',
    typeof ui.renderSendDialog === 'function'
      && typeof ui.openModal === 'function'
      && typeof ui.make === 'function',
    'renderSendDialog=' + typeof ui.renderSendDialog);
}

// =====================================================================
console.log('\n=== 2D【核心】第四十七輪嗰個死碼，呢一層捉得到 ===');
{
  // ⚠️ 呢一段就係第四十七輪 A 組。
  //
  // 現場：改咗 2 格冇儲存 → 撳〔寄出〕→ 畫面出「現在沒有可以寄的東西。
  // 這一季還沒有生成過職事表。」而唔係「你有 2 格改動還未儲存」。
  //
  // 成因：三粒掣全部被未儲存擋住 ⇒ `resolveSendKind_()` 回 `NONE`
  //       ⇒ `renderSendDialog()` 入面 `kind === 'NONE'` 嗰段排喺前面
  //       ⇒ 「未儲存」嗰成段永遠行唔到。
  const unsaved = {
    gridChangeCount: 2, unresolvedCount: 0, pendingRequestCount: 0, hasAny: true
  };
  const s = buildSummaryFromBackend(unsaved);

  // 先確認份 `s` 真係由後端算出嚟嗰個形狀。
  check('★★★★★★ （前置）後端算出嚟嘅 `kind` 真係 `NONE`'
    + '——即係「有未儲存改動」同「`kind === NONE`」係同一件事',
    s.kind === 'NONE', s.kind);
  check('★★★★★ （前置）而 `blockedByUnsavedOnly` 係 true',
    s.blockedByUnsavedOnly === true, String(s.blockedByUnsavedOnly));

  const ui = freshUi();
  ui.renderSendDialog(s);
  const modal = modalOf(ui);

  check('★★★★★★ **真正畫出嚟嗰個窗**係「你有 2 格改動還未儲存」'
    + '——唔係「現在沒有可以寄的東西」。'
    + '呢一條就係第四十七輪嗰個 bug：一整個對話框寫得完全正確，'
    + '而上游嘅判斷令佢永遠行唔到',
    modal.title.indexOf('你有 2 格改動還未儲存') !== -1, modal.title);
  check('★★★★★★ 而且**冇**畫成「現在沒有可以寄的東西」',
    modal.body.indexOf('現在沒有可以寄的東西') === -1, modal.body.slice(0, 200));

  // 第四十八輪 A 組：三粒掣。
  check('★★★★★★ 三粒掣，次序係〔立即儲存並繼續〕〔寄出但不儲存〕〔取消〕',
    modal.actions.length === 3
      && modal.actions[0].indexOf('立即儲存並繼續') !== -1
      && modal.actions[1].indexOf('寄出但不儲存') !== -1
      && modal.actions[2].indexOf('取消') !== -1,
    JSON.stringify(modal.actions));
}

// =====================================================================
console.log('\n=== 2D 之二：唔符合條件嗰陣，唔畫〔寄出但不儲存〕 ===');
{
  // 有格嘅文字系統認唔出 ⇒ 缺口唔開。
  const unsaved = {
    gridChangeCount: 2, unresolvedCount: 1, pendingRequestCount: 0, hasAny: true
  };
  const s = buildSummaryFromBackend(unsaved);
  check('★★★★★ （前置）後端話唔可以用缺口',
    s.canSendUnsaved === false, String(s.canSendUnsaved));

  const ui = freshUi();
  ui.renderSendDialog(s);
  const modal = modalOf(ui);
  check('★★★★★★ 真正畫出嚟嗰個窗**冇**〔寄出但不儲存〕'
    + '——一粒撳咗會拋錯嘅掣，比冇嗰粒更差',
    modal.actions.every(function (t) { return t.indexOf('寄出但不儲存') === -1; }),
    JSON.stringify(modal.actions));
  check('★★★★★★ 而且**講得出點解今次唔可以**'
    + '——上一次佢明明見過嗰粒掣，靜靜唔畫佢會以為系統壞咗',
    modal.body.indexOf('認不出來') !== -1, modal.body.slice(0, 400));
}

// =====================================================================
console.log('\n=== 2D 之三：完全冇未儲存改動 ⇒ 行主畫面，唔會誤入未儲存段 ===');
{
  const unsaved = {
    gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false
  };
  const s = buildSummaryFromBackend(unsaved);
  check('★★★★★ （前置）冇未儲存 ⇒ `blockedByUnsavedOnly` 係 false',
    s.blockedByUnsavedOnly === false, String(s.blockedByUnsavedOnly));

  const ui = freshUi();
  ui.renderSendDialog(s);
  const modal = modalOf(ui);
  check('★★★★★★ **唔會**畫成「你有 N 格改動還未儲存」'
    + '——次序調轉之後如果變成「乜都行呢一段」，就係換咗另一個方向嘅同一個錯',
    modal.title.indexOf('改動還未儲存') === -1, modal.title);
}

// =====================================================================
console.log('\n=== 2B／2A：真環境錄影（`tests/payloads/`）===');
{
  // ⚠️ 呢一節**特登唔會**因為冇檔案而變綠或者變紅。
  // 佢淨係大聲講出「呢一次到底用咗幾多份真錄影」——
  // 唔講嘅話，呢一層就會變成「我以為驗咗真嘢」。
  const dir = path.join(ROOT, 'tests', 'payloads');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); })
    : [];

  console.log('      真環境錄影：' + files.length + ' 份');
  if (files.length === 0) {
    console.log('      ⚠️ 目前一份都冇。上面幾條用嘅係「後端真正算出嚟」嘅 s，');
    console.log('         唔係喺真試算表上錄返嚟嘅。兩者嘅分別喺報告寫明咗。');
    console.log('         要補上：喺試算表撳「測試工具 ▸ ⚠️ 跑自測」，');
    console.log('         再撳「匯出自測 payload」，把洗乾淨嘅 JSON 放入 tests/payloads/。');
  }

  let replayed = 0;
  files.forEach(function (name) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    (Array.isArray(raw) ? raw : [raw]).forEach(function (entry) {
      if (!entry || entry.api !== 'apiGetSendPlanSummary') return;
      const ui = freshUi();
      // ⚠️ 真錄影一律要畫得出嘢而唔拋錯。
      // 拋錯就代表「真實回傳值」同前端假設嘅形狀對唔上——
      // 而嗰個就係呢一層要捉嘅嘢。
      try {
        ui.renderSendDialog(entry.value);
        replayed++;
        check('★★★★★★ 重播真錄影 ' + name + '（' + (entry.scenario || '?') + '）冇拋錯',
          true, '');
      } catch (err) {
        check('★★★★★★ 重播真錄影 ' + name + '（' + (entry.scenario || '?') + '）冇拋錯',
          false, err.message);
      }
    });
  });
  if (files.length > 0) console.log('      已重播 ' + replayed + ' 份。');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
