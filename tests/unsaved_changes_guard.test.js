// 第二十三輪批次階段 E2／E3：掣 2／3／4 嘅前置檢查。
// 執行方式：node tests/unsaved_changes_guard.test.js
//
// 規格 1.7 一條總原則：
//   **掣 1 係唯一會改動職事表內容嘅掣。掣 2／3／4 只寄信，永不改內容。**
//
// 所以掣 2／3／4 執行前一律先檢查「有冇未儲存嘅改動」，有就拒絕並指去掣 1。
//
// 點解要噉：如果掣 2 可以喺「grid 改咗但未儲存」嘅情況下寄出，
// 堂委收到嘅係**舊版本嘅連結**，而幹事以為佢哋睇緊啱啱改完嗰版。
// 呢種「以為寄咗新嘢、其實寄咗舊嘢」係最難察覺嘅一類錯——每一步都成功。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppDashboard.gs', 'WebAppGuards.gs'
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

console.log('\n=== 規格 1.5【核心】三段式錯誤訊息，缺一不可 ===');
{
  const msg = gas.buildThreePartMessage_(
    '找不到「假甲」這個名字。',
    '職事表沒有任何改動，第 2 版仍然是最新一版。',
    ['如果打錯字，把那一格改回原本的名字', '如果是新人，去「名單維護」新增']);

  check('★★★★★ 有「發生了什麼」', msg.indexOf('發生了什麼：') !== -1, msg);
  check('★★★★★ 有「現在的情況」——**最重要嗰段**：'
    + '幹事最想知嘅唔係點解錯，係「而家個表究竟點樣」',
    msg.indexOf('現在的情況：') !== -1, msg);
  check('★★★★★ 有「你可以怎樣做」', msg.indexOf('你可以怎樣做：') !== -1, msg);
  check('★★★★ 逐條出路用「・」列出', (msg.match(/・/g) || []).length === 2, msg);
  check('★★★★ 三段次序係「發生咩 → 而家點 → 可以點做」',
    msg.indexOf('發生了什麼：') < msg.indexOf('現在的情況：')
    && msg.indexOf('現在的情況：') < msg.indexOf('你可以怎樣做：'));
}

console.log('\n=== E2：assertNoUnsavedChanges_ 嘅三種觸發條件（靜態檢查）===');
{
  // 真正執行要 GAS 環境（要讀 grid／Requests），離線測唔到；
  // 呢度鎖住「三項都有覆蓋」同「訊息係三段式」呢兩個結構性要求。
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppGuards.gs'), 'utf8');

  check('★★★★★ 三項條件都有講：grid 改動、認唔出嘅文字、待處理申報',
    /gridChangeCount > 0/.test(src) && /unresolvedCount > 0/.test(src)
    && /pendingRequestCount > 0/.test(src));
  check('★★★★★ 用三段式訊息', /buildThreePartMessage_\(/.test(src));
  check('★★★★★ 出路第一條就係「先撳儲存並確認」',
    /先撳「儲存並確認」/.test(src));
  check('★★★★★ 讀唔到狀態（-1）時唔可以講「零改動」，要誠實講「查不到」'
    + '——把「讀唔到」當成「冇事」正正就係本專案燒過幾次嗰個 bug class',
    /系統查不到目前有沒有未儲存的改動/.test(src));
}

console.log('\n=== E2：三粒掣都真係接咗前置檢查 ===');
{
  const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const body = function (fnName) {
    const start = flow.indexOf('function ' + fnName + '(');
    return start === -1 ? '' : flow.slice(start, start + 900);
  };

  check('★★★★★ 掣 2（apiStep2Confirm）有叫 assertNoUnsavedChanges_',
    /assertNoUnsavedChanges_\(/.test(body('apiStep2Confirm')));
  check('★★★★★ 掣 3（apiStep4Confirm）有叫 assertNoUnsavedChanges_',
    /assertNoUnsavedChanges_\(/.test(body('apiStep4Confirm')));
  check('★★★★★ 掣 4（apiStep5SendConfirm）有叫 assertNoUnsavedChanges_',
    /assertNoUnsavedChanges_\(/.test(body('apiStep5SendConfirm')));
  check('★★★★★ 三粒都喺 assertWebAppRequestAllowed_() 之後、真正動作之前',
    ['apiStep2Confirm', 'apiStep4Confirm', 'apiStep5SendConfirm'].every(function (fn) {
      const b = body(fn);
      return b.indexOf('assertWebAppRequestAllowed_') < b.indexOf('assertNoUnsavedChanges_');
    }));
}

console.log('\n=== E3【核心】掣 3 防重複第二層：SendLog 有 OFFICIAL 紀錄即拒絕 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppGuards.gs'), 'utf8');
  const fnBody = src.slice(src.indexOf('function assertNeverOfficiallySent_'));

  check('★★★★★ **不論版本**——冇按 VersionNo 篩選'
    + '（按版本判斷嘅話，建多一個版本就可以再「正式發出」一次，'
    + '全體義工會收到第二封「正式」通知）',
    fnBody.indexOf('VERSION_NO') === -1);
  check('★★★★★ **不論 DRY_RUN**——冇按 Status／DryRun 篩選'
    + '（DRY_RUN 紀錄代表呢個動作已經行過一次，應該提出嚟俾人知）',
    fnBody.indexOf('DRY_RUN') === -1 && fnBody.indexOf('MAIL_STATUS') === -1);
  check('★★★★ 只按 QuarterID + Stage=OFFICIAL 篩選',
    /QUARTER_ID/.test(fnBody) && /MAIL_STAGES\.OFFICIAL/.test(fnBody));
  check('★★★★★ 拒絕訊息指去「改動後重發」',
    /改動後重發/.test(fnBody));
  check('★★★★ 訊息講埋「如果係誤判可以點做」（清寄出記錄），唔係淨係話「唔准」',
    // 第三十三輪批次階段 D1：訊息改成引用 Menu.gs 嘅真正項目名
    //（「⚠️ 清除一批 SendLog 記錄」），唔再自己作一個「清除一批寄出記錄」。
    // 幹事照住原本嗰句去維護子選單搵，係搵唔到嗰個名嘅。
    /清除一批 SendLog 記錄/.test(fnBody));

  const flow = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppFlow.gs'), 'utf8');
  const step4 = flow.slice(flow.indexOf('function apiStep4Confirm('), flow.indexOf('function apiStep4Confirm(') + 900);
  check('★★★★★ apiStep4Confirm 有接呢道檢查', /assertNeverOfficiallySent_\(/.test(step4));
  check('★★★★ 次序：先查「已經發出過未」再查「有冇未儲存改動」'
    + '——已經發出過係更根本嘅阻擋理由，先講嗰個對幹事更有用',
    step4.indexOf('assertNeverOfficiallySent_') < step4.indexOf('assertNoUnsavedChanges_'));
}

console.log('\n=== E1：掣 2 Stage 閘放寬（D2）＋ 退回要用誠實嘅 AuditLog ===');
{
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'FiveStageCore.gs'), 'utf8');

  check('★★★★★ 三個 Stage 都容許（DRAFT／REVIEW_SENT／REQUESTS_APPLIED）',
    /STEP2_ALLOWED_STAGES_ = \[[\s\S]*?QUARTER_STAGE\.DRAFT,[\s\S]*?QUARTER_STAGE\.REVIEW_SENT,[\s\S]*?QUARTER_STAGE\.REQUESTS_APPLIED[\s\S]*?\]/.test(core));
  check('★★★★★ plan 同 execute 兩邊用同一份清單常數'
    + '（各寫一次就係「同一個判斷寫兩次、兩邊漂移」嗰個 bug class）',
    (core.match(/STEP2_ALLOWED_STAGES_/g) || []).length >= 3);
  check('★★★★★ executeStep2_ 用 setQuarterStage_ 而唔係 advanceQuarterStage_',
    /setQuarterStage_\(quarterId, QUARTER_STAGE\.REVIEW_SENT/.test(core));

  const qs = fs.readFileSync(path.join(__dirname, '..', 'src', 'QuarterStage.gs'), 'utf8');
  const setFn = qs.slice(qs.indexOf('function setQuarterStage_'));
  check('★★★★★ setQuarterStage_ 會分辨方向，退回時 AuditLog 寫「Stage 退回（有意）」'
    + '——用 advanceQuarterStage_ 嘅話紀錄會寫「Stage 前進：'
    + 'REQUESTS_APPLIED → REVIEW_SENT」，**稽核紀錄本身講咗大話**',
    /movedBackwards \? 'Stage 退回（有意）'/.test(setFn));
  check('★★★★ 會記低原因（reason 寫入 Notes）', /notes: reason/.test(setFn));
  check('★★★★ 原本嘅 advanceQuarterStage_ 冇被刪（選單路徑仲用緊）',
    /function advanceQuarterStage_/.test(qs));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
