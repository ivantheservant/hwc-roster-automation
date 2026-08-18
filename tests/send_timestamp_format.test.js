// 第二十五輪批次階段 B2：`SendLog.SentAt` 一定要格式化先送去畫面。
// 執行方式：node tests/send_timestamp_format.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個係同一個 bug class 嘅第三次
// ─────────────────────────────────────────────────────────────────────
//
//   第二十二輪：`QuarterReset.gs` 嘅「加入於」顯示 Date 物件原文
//   第二十三輪：`ICS_SERVICE_START_TIME` 被 Sheets 正規化成 Date
//   第二十五輪（今次）：`SendLog.SentAt`
//
// Ivan 實測見到掣 2／掣 3 寫住：
//     上次在 Mon Aug 17 2026 04:35:09 GMT+1200 (New Zealand Standard Time) 寄過
//
// 而且喺修嘅過程中發現**第二個、更難察覺嘅 bug**：舊寫法用
// `String(a) > String(b)` 揀最新一筆。Date 物件 String() 出嚟係
// `Mon Aug 17 ...` 呢種格式，字串比大細係逐個字母比——
// 揀出嚟嗰筆根本唔係最新嗰筆。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppPreQuarter.gs', 'WebAppDashboard.gs'
]);

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

const TZ = 'Pacific/Auckland';
const C = gas.COLUMNS.SEND_LOG;
const M = gas.MAIL_STAGES;

// 測試沙箱嘅 GAS stub 一被呼叫就拋錯，所以換一個確定性替身
// （做法同 quarter_reset_display_fixes.test.js）。
// ⚠️ 一定要**整個換走**，唔可以 `gas.Utilities.formatDate = …`——
// 原本嗰個係 Proxy，喺佢身上加 property 係加唔到嘅。
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    if (format !== 'yyyy-MM-dd HH:mm') throw new Error('測試替身只支援 yyyy-MM-dd HH:mm');
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1)
      + '-' + pad(date.getUTCDate())
      + ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
  }
};

console.log('\n=== B2【核心】Date 物件一定要格式化 ===');
{
  const d = new Date(Date.UTC(2026, 7, 17, 4, 35, 9));
  const n = gas.normalizeSentAt_(d, TZ);
  checkEqual('★★★★★ Date ⇒ yyyy-MM-dd HH:mm，唔可以係 "Mon Aug 17 2026 ... GMT+1200"'
    + '（Ivan 實測見到嘅就係嗰串）',
    n.text, '2026-08-17 04:35');
  check('★★★★★ 顯示文字入面唔可以有 GMT／星期英文縮寫／時區全名',
    ['GMT', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Standard Time']
      .every(function (bad) { return n.text.indexOf(bad) === -1; }), n.text);
  check('★★★★ 同時要有一個可以比大細嘅 sortKey（數字，唔係文字）',
    typeof n.sortKey === 'number' && n.sortKey === d.getTime());
}

console.log('\n=== B2【核心】排序要用真時間，唔可以用顯示文字 ===');
{
  // 呢個係修嗰陣先發現嘅第二個 bug。
  // 8 月 17 日（Mon）同 9 月 1 日（Tue）：字串比大細 'M' < 'T'，
  // 啱啱好啱；但 12 月 4 日（Fri）同 8 月 17 日（Mon）就會揀錯。
  const aug = new Date(Date.UTC(2026, 7, 17, 4, 35));   // Mon
  const dec = new Date(Date.UTC(2026, 11, 4, 9, 0));    // Fri（真正最新）

  check('★★★★★ 舊寫法（字串比大細）會揀錯——先證明個陷阱真係存在',
    String(dec) < String(aug),
    'String(dec)=' + String(dec) + '\n      String(aug)=' + String(aug));

  const rows = [
    sendRow({ stage: M.OFFICIAL, sentAt: aug }),
    sendRow({ stage: M.OFFICIAL, sentAt: dec })
  ];
  gas.readSheet = function () { return rows; };
  const summary = gas.readSendLogSummaryForDashboard_('2026T4', TZ);
  checkEqual('★★★★★ 新寫法揀到真正最新嗰筆（12 月，唔係 8 月）',
    summary.lastSentAt[M.OFFICIAL], '2026-12-04 09:00');

  // 順序倒轉再試一次，證明結果同讀入次序無關。
  gas.readSheet = function () { return rows.slice().reverse(); };
  checkEqual('★★★★ 讀入次序倒轉都係同一個答案',
    gas.readSendLogSummaryForDashboard_('2026T4', TZ).lastSentAt[M.OFFICIAL],
    '2026-12-04 09:00');
}

console.log('\n=== B2 認唔出嘅格式：照原文顯示，但唔可以當成最新 ===');
{
  const junk = gas.normalizeSentAt_('唔知咩鬼嘢', TZ);
  checkEqual('★★★★ 認唔出就原文顯示，唔可以靜靜丟掉'
    + '（丟掉會令「上次幾時寄」變空白，睇落好似冇寄過）',
    junk.text, '唔知咩鬼嘢');
  checkEqual('★★★★★ 但排序權重設成 0，唔可以當成最新'
    + '——一個爛值蓋過真正最新嗰筆，就會顯示錯嘅時間',
    junk.sortKey, 0);

  checkEqual('★★★★ 空白 ⇒ null（完全唔參與）', gas.normalizeSentAt_('', TZ), null);
  checkEqual('★★★★ null ⇒ null', gas.normalizeSentAt_(null, TZ), null);
  checkEqual('★★★★ undefined ⇒ null', gas.normalizeSentAt_(undefined, TZ), null);
}

console.log('\n=== B2 掣 2／掣 3 嘅動態文字用嘅係格式化後嘅值 ===');
{
  const facts = {
    stage: gas.QUARTER_STAGE.REVIEW_SENT,
    versionExists: true,
    reviewerCount: 5,
    officialTargetCount: 40,
    officialNoEmailCount: 0,
    changedPersonCount: 0,
    hasOfficialRecord: false,
    unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false },
    lastSentAt: {}
  };
  facts.lastSentAt[M.REVIEW] = '2026-08-17 04:35';
  facts.lastSentAt[M.OFFICIAL] = null;
  facts.lastSentAt[M.RESEND] = null;

  const t = gas.buildReviewButtonText_(facts);
  checkEqual('★★★★★ 掣 2：「上次在 2026-08-17 04:35 寄過」',
    t, '上次在 2026-08-17 04:35 寄過。再撳一次會重新寄給同一批人。');
}

console.log('\n=== B3【核心】冇版本時唔可以報一個「0」 ===');
{
  const noVersion = {
    stage: gas.QUARTER_STAGE.DRAFT,
    versionExists: false,
    reviewerCount: 5,
    officialTargetCount: 0,
    officialNoEmailCount: 0,
    changedPersonCount: 0,
    hasOfficialRecord: false,
    unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false },
    lastSentAt: {}
  };
  checkEqual('★★★★★ 掣 3 冇版本 ⇒「還未生成初稿，未知會寄給哪幾位。」'
    + '——「0 個人」唔係「數過，係零」，而係「根本未有表可以數」。'
    + '報一個 0 會令幹事去搵一個唔存在嘅名單錯誤',
    gas.buildOfficialButtonText_(noVersion), '還未生成初稿，未知會寄給哪幾位。');
  check('★★★★★ 而且句子入面唔可以出現「0 個人」',
    gas.buildOfficialButtonText_(noVersion).indexOf('0 個人') === -1);
}

function sendRow(o) {
  const r = {};
  r[C.QUARTER_ID] = o.quarterId || '2026T4';
  r[C.STAGE] = o.stage;
  r[C.SENT_AT] = o.sentAt;
  return r;
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
