// 第二十三輪批次階段 C：`apiGetDashboardState()` 嘅純判斷部分。
// 執行方式：node tests/webapp_dashboard_state.test.js
//
// 測嘅係 `computeDashboardButtons_()`／`buildDashboardStatusText_()` 呢啲
// **純函式**——規格 2.2／2.3 入面最容易寫錯、亦都最需要逐個情境測到嗰段。
// （真正讀試算表嗰層 `buildDashboardState_()` 要 GAS 環境，離線測唔到，
//   靠靜態檢查鎖住幾個結構性要求。）

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppDashboard.gs'
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

const S = gas.QUARTER_STAGE;
const M = gas.MAIL_STAGES;

/** 造一份「facts」，預設係最順利嘅情況，測試逐項覆寫。 */
function facts(overrides) {
  const base = {
    stage: S.REQUESTS_APPLIED,
    versionExists: true,
    unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, hasAny: false },
    reviewerCount: 3,
    officialTargetCount: 57,
    officialNoEmailCount: 0,
    changedPersonCount: 0,
    hasOfficialRecord: false,
    lastSentAt: { REVIEW: null, OFFICIAL: null, RESEND: null }
  };
  return Object.assign(base, overrides || {});
}

console.log('\n=== 規格 1.2【核心】狀態卡文字，逐個 Stage ===');
{
  // 第二十五輪批次階段 A3 改寫：自動生成關咗，「系統會在 X 自動生成」
  // 會令幹事等一個永遠唔會嚟嘅日子。要保留嘅意圖係
  // 「有日期就講日期、冇日期唔可以砌一個出嚟」，而唔係嗰句具體文案。
  checkEqual('★★★★★ DRAFT 無版本 ⇒ 講建議幾時生成，而且要叫佢自己撳掣'
    + '（唔可以再講「系統會自動生成」——自動生成已經關咗）',
    gas.buildDashboardStatusText_(S.DRAFT, false, '11月27日'),
    '還未生成初稿。建議在 11月27日 之後生成，撳下面的「生成初稿」。');
  checkEqual('★★★★ DRAFT 無版本、又冇生成日期 ⇒ 唔可以硬砌一個日期出嚟',
    gas.buildDashboardStatusText_(S.DRAFT, false, ''),
    '還未生成初稿。撳下面的「生成初稿」。');
  check('★★★★★ 全部狀態卡文案都唔可以再出現「自動生成」'
    + '——系統唔會自己動任何嘢，講咗就係講一件唔會發生嘅事',
    [gas.buildDashboardStatusText_(S.DRAFT, false, '11月27日'),
      gas.buildDashboardStatusText_(S.DRAFT, false, ''),
      gas.buildDashboardStatusText_(S.DRAFT, true, '11月27日')]
      .every(function (s) { return s.indexOf('自動') === -1; }));
  checkEqual('★★★★★ DRAFT 有版本', gas.buildDashboardStatusText_(S.DRAFT, true, ''),
    '初稿已生成，未寄給堂委。');
  checkEqual('★★★★★ REVIEW_SENT', gas.buildDashboardStatusText_(S.REVIEW_SENT, true, ''),
    '已寄給堂委，等他們的意見。');
  checkEqual('★★★★★ REQUESTS_APPLIED', gas.buildDashboardStatusText_(S.REQUESTS_APPLIED, true, ''),
    '堂委意見已處理，未正式發出給全體。');
  checkEqual('★★★★★ OFFICIAL_SENT', gas.buildDashboardStatusText_(S.OFFICIAL_SENT, true, ''),
    '已正式發出給全體。');

  check('★★★★ 狀態卡完全冇出現內部代碼（規格 1.3 術語對照）',
    [S.DRAFT, S.REVIEW_SENT, S.REQUESTS_APPLIED, S.OFFICIAL_SENT].every(function (st) {
      const t = gas.buildDashboardStatusText_(st, true, '');
      return t.indexOf('Stage') === -1 && t.indexOf(st) === -1;
    }));
}

console.log('\n=== 規格 2.3 掣 1 動態文字，六種情況 ===');
{
  const t = function (o) { return gas.computeDashboardButtons_(facts(o)).save.dynamicText; };

  checkEqual('★★★★★ 零改動零申報', t({}), '未偵測到你在表上改過任何格。');
  checkEqual('★★★★★ 有 grid 改動',
    t({ unsaved: { gridChangeCount: 4, unresolvedCount: 0, pendingRequestCount: 0, hasAny: true } }),
    '偵測到你在表上改了 4 格。');
  checkEqual('★★★★★ 有申報',
    t({ unsaved: { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 3, hasAny: true } }),
    '有 3 筆修改申報未處理。');
  checkEqual('★★★★★ 兩者都有',
    t({ unsaved: { gridChangeCount: 4, unresolvedCount: 0, pendingRequestCount: 3, hasAny: true } }),
    '偵測到你在表上改了 4 格，另有 3 筆修改申報未處理。');
  checkEqual('★★★★★ 有認不出的文字（**優先於其他情況**，因為佢會阻擋成個動作）',
    t({ unsaved: { gridChangeCount: 4, unresolvedCount: 2, pendingRequestCount: 3, hasAny: true } }),
    '有 2 格的文字系統認不出，撳下去會告訴你是哪幾格。');
  checkEqual('★★★★★ REVIEW_SENT 且零改動 ⇒ 講清楚撳落去等於「意見已收齊」'
    + '（唔係「乜都唔會做」——呢個係 D4 零改動路徑最易誤解嘅一種）',
    t({ stage: S.REVIEW_SENT }),
    '堂委沒有提出改動。撳下去就當作意見已收齊，可以進入正式發出。');
}

console.log('\n=== 規格 2.3 掣 2 動態文字 ===');
{
  const t = function (o) { return gas.computeDashboardButtons_(facts(o)).review.dynamicText; };
  checkEqual('★★★★★ 可撳', t({}), '把唯讀連結寄給 3 位收件人。');
  checkEqual('★★★★★ 收件人為 0 ⇒ 講明寄出去冇人收到，並指去邊度補',
    t({ reviewerCount: 0 }),
    '現時沒有登記任何堂委電郵，寄出去不會有人收到。先去「名單維護」補。');
  checkEqual('★★★★ 已寄過',
    t({ lastSentAt: { REVIEW: '11月28日 14:30', OFFICIAL: null, RESEND: null } }),
    '上次在 11月28日 14:30 寄過。再撳一次會重新寄給同一批人。');
}

console.log('\n=== 規格 2.3 掣 3 動態文字 ===');
{
  const t = function (o) { return gas.computeDashboardButtons_(facts(o)).official.dynamicText; };
  checkEqual('★★★★★ 可撳', t({}),
    '會寄給表上 57 個人，每人一份標示了自己名字的 PDF 和月曆檔。');
  checkEqual('★★★★★ 有人沒有電郵 ⇒ 要講出實際會收到嘅人數（57 − 7 = 50）',
    t({ officialNoEmailCount: 7 }),
    '會寄給表上 57 個人中的 50 人；另外 7 人沒有電郵，會略過。');
  checkEqual('★★★★★ 已發出過 ⇒ 指去「改動後重發」',
    t({ hasOfficialRecord: true, lastSentAt: { REVIEW: null, OFFICIAL: '12月4日 11:20', RESEND: null } }),
    '已在 12月4日 11:20 正式發出過。之後有改動請用「改動後重發」。');
}

console.log('\n=== 規格 2.3 掣 4 動態文字 ===');
{
  const t = function (o) { return gas.computeDashboardButtons_(facts(o)).resend.dynamicText; };
  checkEqual('★★★★★ 有人改動',
    t({ stage: S.OFFICIAL_SENT, changedPersonCount: 6 }),
    '自上次發出之後，有 6 個人的安排改了。只會寄給這 6 人和堂委。');
  checkEqual('★★★★★ 零人改動',
    t({ stage: S.OFFICIAL_SENT, changedPersonCount: 0 }),
    '自上次發出之後沒有人的安排改過，不需要重發。');
}

console.log('\n=== 規格 2.2【核心】四粒掣嘅 enabled 狀態機 ===');
{
  const b = function (o) { return gas.computeDashboardButtons_(facts(o)); };

  // 掣 1：有版本就任何 Stage 都撳得到
  [S.DRAFT, S.REVIEW_SENT, S.REQUESTS_APPLIED, S.OFFICIAL_SENT].forEach(function (st) {
    check('★★★★ 掣 1 喺 ' + st + ' 都撳得到（佢係唯一會改內容嘅掣）',
      b({ stage: st }).save.enabled === true);
  });
  check('★★★★★ 冇版本 ⇒ 掣 1 撳唔到', b({ versionExists: false }).save.enabled === false);

  // 掣 2：D2 三個 Stage 開放，OFFICIAL_SENT 唔開放
  check('★★★★★ 掣 2 喺 DRAFT 撳得到', b({ stage: S.DRAFT }).review.enabled === true);
  check('★★★★★ 掣 2 喺 REVIEW_SENT 撳得到（第二輪審閱，D2）',
    b({ stage: S.REVIEW_SENT }).review.enabled === true);
  check('★★★★★ 掣 2 喺 REQUESTS_APPLIED 撳得到（D2 嘅重點：舊版只准 DRAFT）',
    b({ stage: S.REQUESTS_APPLIED }).review.enabled === true);
  check('★★★★★ 掣 2 喺 OFFICIAL_SENT 撳唔到',
    b({ stage: S.OFFICIAL_SENT }).review.enabled === false);

  // 掣 3：三層防重複
  check('★★★★★ 掣 3 只喺 REQUESTS_APPLIED 撳得到',
    b({ stage: S.REQUESTS_APPLIED }).official.enabled === true
    && b({ stage: S.REVIEW_SENT }).official.enabled === false
    && b({ stage: S.DRAFT }).official.enabled === false);
  check('★★★★★ 掣 3：SendLog 有 OFFICIAL 紀錄 ⇒ 即使 Stage 啱都撳唔到'
    + '（規格 2.6 第 2 層，不論版本、不論 DRY_RUN）',
    b({ hasOfficialRecord: true }).official.enabled === false);

  // 掣 4：Stage + 內容閘
  check('★★★★★ 掣 4 要 OFFICIAL_SENT 而且有人改動',
    b({ stage: S.OFFICIAL_SENT, changedPersonCount: 6 }).resend.enabled === true);
  check('★★★★★ 掣 4：零人改動 ⇒ 撳唔到（E4 內容閘）',
    b({ stage: S.OFFICIAL_SENT, changedPersonCount: 0 }).resend.enabled === false);
}

console.log('\n=== 決定 D5【核心】有未儲存改動 ⇒ 掣 2／3／4 全部撳唔到 ===');
{
  const unsaved = { gridChangeCount: 4, unresolvedCount: 0, pendingRequestCount: 0, hasAny: true };

  const atReq = gas.computeDashboardButtons_(facts({ stage: S.REQUESTS_APPLIED, unsaved: unsaved }));
  check('★★★★★ 掣 2 撳唔到', atReq.review.enabled === false);
  check('★★★★★ 掣 3 撳唔到', atReq.official.enabled === false);
  check('★★★★★ 掣 1 **仍然撳得到**——佢正正就係用嚟處理呢啲改動嘅',
    atReq.save.enabled === true);

  const atOfficial = gas.computeDashboardButtons_(
    facts({ stage: S.OFFICIAL_SENT, changedPersonCount: 6, unsaved: unsaved }));
  check('★★★★★ 掣 4 撳唔到', atOfficial.resend.enabled === false);

  check('★★★★★ 三粒掣嘅 disabledReason 都指去「儲存並確認」',
    [atReq.review, atReq.official, atOfficial.resend].every(function (btn) {
      return btn.disabledReason.indexOf('儲存並確認') !== -1;
    }),
    JSON.stringify([atReq.review.disabledReason, atReq.official.disabledReason, atOfficial.resend.disabledReason]));
}

console.log('\n=== 規格 1.6【核心】disabledReason 一律寫「怎樣才撳得到」，唔寫「為何失敗」 ===');
{
  const samples = [
    gas.computeDashboardButtons_(facts({ stage: S.DRAFT })).official.disabledReason,
    gas.computeDashboardButtons_(facts({ stage: S.REVIEW_SENT })).official.disabledReason,
    gas.computeDashboardButtons_(facts({ stage: S.REQUESTS_APPLIED })).resend.disabledReason,
    gas.computeDashboardButtons_(facts({ versionExists: false })).save.disabledReason,
    gas.computeDashboardButtons_(facts({ hasOfficialRecord: true })).official.disabledReason
  ].filter(function (s) { return s !== ''; });

  check('★★★★★ 冇一句出現內部代碼（反例：「目前鎖定——現在 Stage 是 DRAFT」）',
    samples.every(function (s) {
      return s.indexOf('Stage') === -1 && s.indexOf('DRAFT') === -1
        && s.indexOf('REVIEW_SENT') === -1 && s.indexOf('REQUESTS_APPLIED') === -1
        && s.indexOf('OFFICIAL_SENT') === -1;
    }), JSON.stringify(samples, null, 1));

  check('★★★★★ 每一句都講到「點樣先撳得到」或者「應該改用邊粒掣」',
    samples.every(function (s) {
      return s.indexOf('才會著') !== -1 || s.indexOf('請用') !== -1 || s.indexOf('不需要') !== -1;
    }), JSON.stringify(samples, null, 1));

  checkEqual('★★★★ 掣 3 喺 DRAFT 嘅提示係規格 1.6 嗰句正例',
    gas.computeDashboardButtons_(facts({ stage: S.DRAFT })).official.disabledReason,
    '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存並確認」，這一粒才會著。');
}

console.log('\n=== 規格 1.1／5.1：季度與版本一律寫人話 ===');
{
  // buildQuarterLabel_ 讀 Config，離線要換走 getConfig。
  const savedGetConfig = gas.getConfig;
  gas.getConfig = function (key, fallback) {
    if (key === gas.CONFIG_KEYS.QUARTER_TERM_START_MONTHS) return '1,4,7,10';
    return fallback;
  };
  checkEqual('★★★★★ 2026T4 ⇒ 2026年10-12月', gas.buildQuarterLabel_('2026T4'), '2026年10-12月');
  checkEqual('★★★★ 2027T1 ⇒ 2027年1-3月', gas.buildQuarterLabel_('2027T1'), '2027年1-3月');
  checkEqual('★★★ 認唔出格式就原樣回傳，唔可以砌一個似層層嘅名出嚟',
    gas.buildQuarterLabel_('唔知咩'), '唔知咩');
  gas.getConfig = savedGetConfig;

  // ── 第二十五輪批次階段 B1：Basis 內部代號唔可以漏落畫面 ──────────
  //
  // Ivan 實測撞到：狀態卡寫住 `目前第 1 版　2026-08-17　REQUESTS_APPLIED`。
  // 而且 v0 嘅 Notes 存住 seed／偏差／百分比，駁埋之後成句變成技術數字。
  checkEqual('★★★★★ Basis 譯成人話，唔可以照印內部代號',
    gas.buildVersionBasisText_('REQUESTS_APPLIED'), '套用修改申報後');
  checkEqual('★★★★★ AUTO_GENERATE', gas.buildVersionBasisText_('AUTO_GENERATE'), '系統生成');
  checkEqual('★★★★ FINE_TUNE', gas.buildVersionBasisText_('FINE_TUNE'), '人手調整後');
  checkEqual('★★★★ RESEND', gas.buildVersionBasisText_('RESEND'), '改動後重發時建立');
  checkEqual('★★★★★ 空白 ⇒「（沒有說明）」，唔可以留空令畫面得個版本號',
    gas.buildVersionBasisText_(''), '（沒有說明）');
  checkEqual('★★★★★ 對照表冇嘅內部代號**唔可以照印**，'
    + '要顯示「（沒有說明）」——照印就係本身要修嗰個 bug',
    gas.buildVersionBasisText_('SOME_FUTURE_CODE'), '（沒有說明）');
  checkEqual('★★★★★ 但本身已經係中文嘅（回退版本寫嘅）就照用，唔好蓋走',
    gas.buildVersionBasisText_('回到第 2 版'), '回到第 2 版');

  {
    // v0 嘅 Notes 真實樣本（`buildSeedNote_()` 寫入嗰種）。
    const v0Notes = 'seed=20260813　第 3 / 20 次　總偏差 0.6033　主席兼報告 46.2%';
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8');
    const fn = src.slice(src.indexOf('function buildVersionBasisText_'));
    check('★★★★★ 狀態卡**唔會**再讀 Notes——技術統計數字唔應該出現喺主畫面',
      fn.slice(0, 400).indexOf('NOTES') === -1
      && gas.buildVersionBasisText_('AUTO_GENERATE', v0Notes).indexOf('seed=') === -1);
  }
}

console.log('\n=== 結構性要求（靜態檢查正式碼）===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8');
  check('★★★★★ 第一行有 assertWebAppRequestAllowed_()',
    /function apiGetDashboardState\(quarterId\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(src));
  check('★★★★★ 用 readSheet 快取包住，而且有 finally 收尾'
    + '（漏咗 finally 會令之後全部讀取都用緊過時快取）',
    /beginSheetReadMemo_\(\);[\s\S]*?finally \{[\s\S]*?endSheetReadMemo_\(\);/.test(src));
  check('★★★★★ SendLog 只喺一個地方讀（一次過算齊三個階段 + 有冇 OFFICIAL 紀錄）',
    (src.match(/readSheet\(SHEETS\.SEND_LOG\)/g) || []).length === 1);
  check('★★★★★ 規則狀態明確傳 GRID_OVERLAY（第十九輪：唔可以省略 mode）',
    /resolveAuthoritativeState_\(\s*\n?\s*context, STATE_SOURCE\.GRID_OVERLAY/.test(src));
  check('★★★★ grid 讀唔到時唔可以當成「零改動」'
    + '（零改動會令掣 2／3／4 全部亮起，等於話「冇嘢未處理」）',
    /gridChangeCount: -1[\s\S]{0,80}hasAny: true/.test(src));
  check('★★★★ 區二算唔到時 undoneItemCount 唔可以係 0'
    + '（0 會顯示「全部做好了」，就係把「讀唔到」當成「冇事」）',
    /undoneItemCount: -1/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
