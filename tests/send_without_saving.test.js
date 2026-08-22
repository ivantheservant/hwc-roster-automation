// 第四十八輪批次 A 組：〔寄出但不儲存〕。
// 執行方式：node tests/send_without_saving.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一組係**把一道特登設落嘅閘開一個缺口**
// ═════════════════════════════════════════════════════════════════════
//
// 修正前，撳〔寄出〕會見到（第四十七輪 A 組做出嚟嗰個窗）：
//
//     寄出：你有 2 格改動還未儲存
//     你在表上改了 2 格，但還未儲存確認。如果現在寄出去，寄出的會是「第 5 版」
//     ——你剛才改的那 2 格不會在裡面。
//     先儲存的話，改動會存成新一版，然後那一版才會寄出去。
//     有未儲存的改動的時候，系統不容許寄出——這是為了不會出現
//     「畫面說寄了，而寄出去的是舊內容」。
//     ［立即儲存並繼續］　［取消］
//
// ─────────────────────────────────────────────────────────────────────
// 點解開呢個缺口係合理嘅
// ─────────────────────────────────────────────────────────────────────
//
// ⚠️ **唔好當成「幹事想繞過安全閘」。**
//
//   ・公開職事表嗰條永久連結**本來就**指向最近一次儲存嗰一版。
//     寄一條連結出去，收信嘅人睇到嘅一直都係第 5 版——寄同唔寄冇分別。
//   ・幹事可能正喺表上試改幾格、未決定要唔要，而審閱信今日一定要出。
//     逼佢先儲存，等於逼佢把未決定嘅嘢變成正式一版。
//   ・表上嗰幾格未儲存嘅改動，亦都可能純粹係撞到鍵盤撞出嚟。
//
// 所以真正嘅風險**唔係**寄出第 5 版，
// 而係**幹事以為寄出去嘅係佢啱啱改嗰一版**。
// 整組要防嘅就只有呢一件事。
//
// ─────────────────────────────────────────────────────────────────────
// 缺口要開得窄
// ─────────────────────────────────────────────────────────────────────
//
//   ・只有 `gridChangeCount > 0` 呢一種可以放行
//   ・`unresolvedCount > 0`（有格嘅文字系統認唔出）**唔放行**
//     ——嗰個唔係「幹事改咗未儲存」，係「表上有系統讀唔明嘅字」，
//     寄咗出去之後嗰幾格會變成乜，系統自己都講唔出
//   ・`pendingRequestCount > 0`（有修改申報未處理）**唔放行**
//     ——嗰啲仲未入到表度
//   ・讀唔到狀態（`-1`）**唔放行**——「查不到」唔等於「冇嘢」

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs'
]);

const st = function (grid, unresolved, pending, extra) {
  return Object.assign({
    gridChangeCount: grid, unresolvedCount: unresolved,
    pendingRequestCount: pending, needsInputCount: 0,
    hasAny: grid > 0 || unresolved > 0 || pending > 0
  }, extra || {});
};

// =====================================================================
console.log('\n=== A3【核心】缺口要開得窄：邊一種未儲存可以放行 ===');
{
  const can = gas.canSendWithUnsavedChanges_;

  checkEqual('★★★★★★ 淨係 grid 改動 ⇒ **可以**放行'
    + '——公開連結本來就指住最近一次儲存嗰一版，寄同唔寄冇分別',
    can(st(2, 0, 0)).allowed, 'true');

  checkEqual('★★★★★★ 有格嘅文字系統認唔出 ⇒ **唔放行**'
    + '——嗰個唔係「改咗未儲存」，係「表上有系統讀唔明嘅字」。'
    + '寄咗出去之後嗰幾格會變成乜，系統自己都講唔出',
    can(st(2, 1, 0)).allowed, 'false');
  check('★★★★★★ 而且要講得出點解唔放行'
    + '——「唔得」而唔講原因，幹事只會不停撳',
    /認不出/.test(can(st(2, 1, 0)).reason), can(st(2, 1, 0)).reason);

  checkEqual('★★★★★★ 有修改申報未處理 ⇒ **唔放行**'
    + '——嗰啲仲未入到表度',
    can(st(2, 0, 1)).allowed, 'false');
  check('★★★★★ 一樣要講得出原因',
    /申報/.test(can(st(2, 0, 1)).reason), can(st(2, 0, 1)).reason);

  checkEqual('★★★★★★ 讀唔到狀態（`-1`）⇒ **唔放行**'
    + '——「查不到」唔等於「冇嘢」。'
    + '呢個方向估錯咗，就係寄一份冇人知內容嘅嘢出去',
    can(st(-1, -1, -1, { error: 'grid 工作表被刪' })).allowed, 'false');

  checkEqual('★★★★★ 完全冇未儲存改動 ⇒ 冇嘢要放行（`allowed` 係 false）',
    can(st(0, 0, 0)).allowed, 'false');
  check('★★★★★ 而且原因要分得出係「本來就冇嘢未儲存」',
    /沒有未儲存/.test(can(st(0, 0, 0)).reason), can(st(0, 0, 0)).reason);

  // ⚠️ 兩種同時有 ⇒ 一樣唔放行。
  checkEqual('★★★★★ 三種夾埋 ⇒ 唔放行', can(st(2, 3, 4)).allowed, 'false');
}

// =====================================================================
console.log('\n=== A3【核心】flag 一定要**明確傳 `true`** 先生效 ===');
{
  // ⚠️ 呢一節係整組最危險嘅地方。
  //
  // 「冇傳就當 true」或者任何預設放行嘅寫法，
  // 會令一個**根本冇撳過嗰粒掣**嘅寄出靜靜跳過閘門——
  // 而嗰個正正就係呢道閘當初要防嗰件事。
  const resolve = gas.resolveAllowUnsavedFlag_;

  checkEqual('★★★★★★ 明確傳 `true` ⇒ 放行', resolve({ allowUnsaved: true }), 'true');

  checkEqual('★★★★★★ **傳漏咗**（`sendOptions` 冇呢一個欄位）⇒ 唔放行',
    resolve({}), 'false');
  checkEqual('★★★★★★ `sendOptions` 本身係 `undefined` ⇒ 唔放行',
    resolve(undefined), 'false');
  checkEqual('★★★★★★ `sendOptions` 本身係 `null` ⇒ 唔放行',
    resolve(null), 'false');
  checkEqual('★★★★★★ 傳 `undefined` ⇒ 唔放行',
    resolve({ allowUnsaved: undefined }), 'false');
  checkEqual('★★★★★★ 傳字串 `\'false\'` ⇒ 唔放行'
    + '——`\'false\'` 係 truthy，用 `if (flag)` 寫法會靜靜放行',
    resolve({ allowUnsaved: 'false' }), 'false');
  checkEqual('★★★★★★ 傳字串 `\'true\'` ⇒ **一樣唔放行**'
    + '——只認布林 `true`。認字串就等於認一大堆講唔清嘅輸入',
    resolve({ allowUnsaved: 'true' }), 'false');
  checkEqual('★★★★★ 傳 `1` ⇒ 唔放行', resolve({ allowUnsaved: 1 }), 'false');
  checkEqual('★★★★★ 傳 `false` ⇒ 唔放行', resolve({ allowUnsaved: false }), 'false');
}

// =====================================================================
console.log('\n=== A3【核心】`assertNoUnsavedChanges_()` 嘅缺口 ===');
{
  const src = read('src/WebAppGuards.gs');
  check('★★★★★ 簽名多咗第三個參數 `allowUnsaved`',
    /function assertNoUnsavedChanges_\(quarterId, actionName, allowUnsaved\)/.test(src), '');
  check('★★★★★★ 放行嘅時候**一定要回傳**當時嘅狀態'
    + '——呼叫方要用佢寫紀錄。唔回傳嘅話，'
    + '「寄咗第幾版、當時有幾多格未儲存」呢件事就冇人記得低',
    /@returns \{Object\}/.test(src.slice(src.indexOf('function assertNoUnsavedChanges_') - 900,
      src.indexOf('function assertNoUnsavedChanges_'))), '');
  check('★★★★★★ 放行條件由 `canSendWithUnsavedChanges_()` 出，'
    + '唔係喺呢度再寫一次'
    + '——同一件事兩個算法，一定會分岔',
    /canSendWithUnsavedChanges_\(/.test(src), '');
  check('★★★★★★ flag 由 `resolveAllowUnsavedFlag_()` 判斷，'
    + '唔係 `if (allowUnsaved)`',
    !/if \(allowUnsaved\)/.test(src), '仲有 `if (allowUnsaved)` 呢種寫法');
}

// =====================================================================
console.log('\n=== A1／A2【核心】前端：三粒掣 ＋ 一個講到白嘅確認 ===');
{
  const html = read('src/ui/ScriptSendPaper.html');

  check('★★★★★★ 窗裡面有〔寄出但不儲存〕',
    /寄出但不儲存/.test(html), '');
  check('★★★★★★ 用次要色，**唔可以**用危險色（紅）'
    + '——佢唔係一個危險動作，佢係一個要睇清楚嘅動作',
    !/danger[^\n]*寄出但不儲存|寄出但不儲存[^\n]*danger/.test(html), '');
  check('★★★★★ 〔立即儲存並繼續〕仍然係預設掣',
    /立即儲存並繼續/.test(html), '');

  check('★★★★★★ 撳落去**唔會直接寄**，中間有一個確認畫面'
    + '——⚠️ 要驗**粒掣真係叫佢**，唔係得個函式名喺檔案入面。'
    + '得個名嘅話，粒掣改成直接寄都仍然綠',
    /button\('寄出但不儲存', \(\) => renderSendWithoutSavingConfirm\(s\)/.test(html), '');
  check('★★★★★ 而個確認畫面真係存在',
    /function renderSendWithoutSavingConfirm\(s\) \{/.test(html), '');
  check('★★★★★★ 確認畫面講得出「會寄出的：第 N 版」',
    /會寄出的：/.test(html), '');
  check('★★★★★★ 同埋「不會寄出的：你在表上改了、還未儲存的這 N 格」',
    /不會寄出的：/.test(html), '');
  check('★★★★★★ 嗰幾格要**逐格列出嚟**',
    /renderUnsavedCellList\(cellBox, preview\)/.test(html), '');
  // ⚠️ 料要同「檢查我的改動」嗰個畫面出自**同一支**函式。
  // 各自格式化嘅話，兩個畫面對住同一格會顯示唔同嘅嘢，
  // 而冇人分得出邊個啱。
  const planCode = read('src/WebAppSendPlan.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ 而且係由共用嘅 `buildSavedChangeRows_()` 出',
    /rows = buildSavedChangeRows_\(resolved\.changes, postNameById, 'MANUAL'\);/
      .test(planCode), '');
  check('★★★★★★ 有一個明白框',
    /我明白收信的人看到的是/.test(html), '');
  check('★★★★★★ 而且**明明白白寫一次 `false`**'
    + '——靠「唔寫就係 false」嘅話，日後有人加一句'
    + '`ackBox.checked = something` 就會靜靜變成預設勾住',
    /ackBox\.checked = false;/.test(html), '');
  check('★★★★★★ 唔勾嘅時候〔繼續寄出⋯⋯〕係 disabled',
    /goBtn\.disabled = true;/.test(html) && /繼續寄出/.test(html), '');
  check('★★★★★ 勾咗先解鎖',
    /goBtn\.disabled = !ackBox\.checked/.test(html), '');
  check('★★★★★★ 超過 12 格 ⇒ 列頭 12 格 ＋「另外還有 N 格」＋〔全部列出〕',
    /另外還有/.test(html) && /全部列出/.test(html), '');
  check('★★★★★★ 講明「這 N 格會留在表上，不會不見」'
    + '——唔講嘅話，幹事會以為撳落去等於放棄咗嗰幾格',
    /會留在表上，不會不見/.test(html), '');

  // ⚠️ **唔可以用打字閘。**
  check('★★★★★★ 冇用「請輸入『確認』」嗰種打字閘'
    + '——嗰個閘留返畀「照樣儲存（違反硬規則）」同「重設季度測試資料」'
    + '嗰一類**改壞咗救唔返**嘅動作。呢一個救得返（嗰幾格仲喺表上），'
    + '用打字閘會令打字閘本身貶值',
    !/請輸入「確認」|逐字輸入/.test(
      html.slice(html.indexOf('renderSendWithoutSavingConfirm'),
        html.indexOf('renderSendWithoutSavingConfirm') + 4000)), '');

  // A3：唔符合條件嗰陣**唔好畫嗰粒掣**。
  check('★★★★★★ `canSendUnsaved` 係 false 嗰陣唔畫嗰粒掣，'
    + '而且講明點解今次唔可以'
    + '——一粒撳咗冇反應嘅掣，比冇嗰粒掣更差',
    /s\.canSendUnsaved/.test(html) && /canSendUnsavedReason/.test(html), '');
}

// =====================================================================
console.log('\n=== A4【核心】痕跡：三處 ===');
{
  const flow = read('src/WebAppFlow.gs');
  check('★★★★★★ 一、放行咗要寫 AuditLog，動作名睇得出係呢一種',
    /寄送批次（未儲存改動下放行）/.test(flow), '');
  check('★★★★★ 而且備註寫得出寄咗第幾版、當時有幾多格未儲存',
    /logSendWithUnsavedRelease_\(/.test(flow), '');

  const options = read('src/SendOptions.gs');
  // ⚠️ 唔可以淨係搵嗰句字串——`if (true) return base;` 一句就可以令佢
  // 永遠行唔到，而句字串仲喺檔案入面。
  const optionsCode = options.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ 二、`SendLog` 嗰一批嘅備註要記住同一件事'
    + '——日後查「佢點解收到舊版」，答案要喺 SendLog 搵得到，'
    + '唔係要去翻 AuditLog 對時間',
    /未儲存改動下放行：寄出第 /.test(optionsCode)
      && /if \(!rel\) return base;/.test(optionsCode), '');
  check('★★★★★★ 而且要講得出**寄咗第幾版**同**當時有幾多格未儲存**'
    + '——「有未儲存改動」呢種講法答唔到「佢收到嘅到底係咩」',
    /rel\.versionNo/.test(options) && /rel\.gridChangeCount/.test(options), '');
  check('★★★★★★ 帶落去嗰個物件係**新建**嘅，唔係改呼叫方傳嚟嗰個'
    + '——直接改嘅話，同一個 `sendOptions` 之後再用會帶住一個'
    + '唔關佢事嘅標記',
    /Object\.assign\(\{\}, sendOptions \|\| \{\}/.test(flow), '');

  const dash = read('src/WebAppDashboard.gs');
  check('★★★★★★ 三、返到主畫面之後嗰一句要一直顯示'
    + '——前面兩點係畀日後查嘅，呢一點係畀**而家**嘅佢睇。'
    + '佢撳完寄出、閂咗個窗，五分鐘之後就會唔記得自己揀咗乜',
    /sentWithUnsaved/.test(dash), '');
  // ⚠️ 句子由**後端**出，前端只負責畫。
  // 前端自己寫一句嘅話，就會有兩份措辭，而兩份措辭會慢慢分岔。
  // ⚠️ 同上：`if (true) return '';` 一句就可以令佢永遠行唔到。
  const dashCode = dash.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const warnFn = dashCode.slice(dashCode.indexOf('function buildSentWithUnsavedWarning_('));
  check('★★★★★★ 句子由後端 `buildSentWithUnsavedWarning_()` 出',
    /上一次寄出的是第/.test(warnFn), '');
  check('★★★★★★ 而且真係行得到——冇一句無條件 `return \'\'` 擋喺前面',
    !/^\s*(if \(true\) )?return '';/m.test(
      warnFn.slice(0, warnFn.indexOf('上一次寄出的是第'))
        .replace(/if \(!release \|\| !release\.used\) return '';/, '')
        .replace(/if \(!\(grid > 0\)\) return '';/, '')), warnFn.slice(0, 400));
  check('★★★★★★ 嗰一句要講明「收到信的人看到的不是你現在表上的內容」',
    /收到信的人看到的不是你現在表上的內容/.test(dash), '');
  check('★★★★★★ **儲存咗之後就唔再講**'
    + '——一句永遠關唔甩嘅警告，好快就冇人再讀',
    /if \(!\(grid > 0\)\) return '';/.test(dash), '');
  const mainFlow = read('src/ui/ScriptMainFlow.html');
  check('★★★★★★ 而且主畫面第 2 步真係畫咗佢',
    /d\.sentWithUnsavedWarning/.test(mainFlow), '');
}

// =====================================================================
console.log('\n=== A5【核心】唔准碰嘅嘢 ===');
{
  // ── 真係行一次：v5 用缺口寄出 → 儲存成 v6 → 改動後重發 ──────
  //
  // ⚠️ `computeResendDiff_()` 係純函式，餵得入去就驗得到。
  // 用 grep 證「冇讀 grid」只係一個代替品；呢度直接驗行為。
  const resendGas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs', 'Mailer.gs', 'ResendFlow.gs'
  ]);
  // ⚠️ 同 `e2e_five_stage_flow.test.js` 一致嘅做法：用 Node `crypto`
  // 頂替 `Utilities.computeDigest()`，令 `computeAssignmentHash_()`
  // 呢類真正嘅雜湊函式喺 Node 度照樣行得通。
  resendGas.Utilities = {
    computeDigest: function (algo, input) {
      const crypto = require('crypto');
      return Array.from(crypto.createHash('sha256').update(
        Buffer.from(String(input), 'utf8')).digest());
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' }
  };

  const assign = function (date, postId) {
    return { serviceDate: date, postId: postId, slotIndex: 1 };
  };
  // v5：假甲乙排咗 4 月 2 日主席。呢一版**用缺口寄咗出去**，
  // 所以 SendLog 記低嘅係佢嘅 hash。
  const v5ForPerson = [assign('2028-04-02', 'CHAIR')];
  const v5Hash = resendGas.computeAssignmentHash_(v5ForPerson);
  // v6：幹事之後把嗰幾格儲存咗，主席由假甲乙換成假丙丁
  //     ⇒ 假甲乙冇咗嗰一格、假丙丁多咗嗰一格。
  const ctx = {
    assignmentsByPerson: { P9002: [assign('2028-04-02', 'CHAIR')] },
    lastHashByPerson: { P9001: v5Hash },
    lastStatusByPerson: {},
    peopleById: {
      P9001: { nameTC: '假甲乙', email: 'a@example.invalid' },
      P9002: { nameTC: '假丙丁', email: 'b@example.invalid' }
    }
  };
  const diff = resendGas.computeResendDiff_(ctx);
  const changedIds = diff.map(function (c) { return c.personId; }).sort().join(',');
  checkEqual('★★★★★★ 基準係**上一次真正寄出嗰一版（v5）**，'
    + '所以兩個人都算有改動'
    + '——用咗缺口之後 v5 已經寄咗出去，'
    + '嗰一版就係收信嘅人手上嗰一份，重發一定要同佢比',
    changedIds, 'P9001,P9002');

  // ⚠️ 反過來：如果基準錯咗變成「表上現在的內容」（即 v6 自己），
  // 就會一個人都唔算改動——而實際上兩個人都收咗一封講緊 v5 嘅信。
  const ctxWrong = {
    assignmentsByPerson: { P9002: [assign('2028-04-02', 'CHAIR')] },
    lastHashByPerson: {
      P9002: resendGas.computeAssignmentHash_([assign('2028-04-02', 'CHAIR')])
    },
    lastStatusByPerson: {},
    peopleById: ctx.peopleById
  };
  checkEqual('★★★★★★ 而基準等於現況嗰陣就一個都唔算改動'
    + '——呢一條就係「基準唔可以改成表上現在的內容」嘅代價',
    resendGas.computeResendDiff_(ctxWrong).length, 0);

  const resend = read('src/ResendFlow.gs');
  check('★★★★★ `ResendFlow.gs` 由頭到尾冇讀 grid overlay',
    !/GRID_OVERLAY/.test(resend), '');
  const core = read('src/FiveStageCore.gs');
  check('★★★★★★ `planStep5ChangedList_()` 用 `findLatestVersionNo()`'
    + '（已儲存嘅版本），唔係讀表上未儲存嗰個狀態',
    /function planStep5ChangedList_\(quarterId\) \{[\s\S]{0,400}findLatestVersionNo\(quarterId\)/
      .test(core) && !/planStep5ChangedList_[\s\S]{0,400}GRID_OVERLAY/.test(core), '');

  // 公開連結嗰邊一格都唔好改。
  const publicRoster = read('src/PublicRoster.gs');
  check('★★★★★ 公開連結嘅發佈邏輯冇被呢一輪碰過'
    + '（冇 `allowUnsaved` 呢個字）',
    !/allowUnsaved/.test(publicRoster), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
