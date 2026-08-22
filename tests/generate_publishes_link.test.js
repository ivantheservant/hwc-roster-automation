// 第五十二輪批次 A 組：四個造版本嘅入口，只有一個會更新公開連結。
// 執行方式：node tests/generate_publishes_link.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（自測機 S14 嘅 I09）
// ═════════════════════════════════════════════════════════════════════
//
//     ⚠️ 不變量：I09｜預期 v1｜實際 v0｜PublicLinks.LastPublishedVersion=0；
//     findLatestVersionNo()=1。不一致代表收信的人開連結看到的，不是最新那一版。
//
// S14 經「進階功能 ▸ 重新生成初稿」造出 v1。v1 造咗出嚟，
// 但 `PublicLinks.LastPublishedVersion` 仍然係 0。
//
// ─────────────────────────────────────────────────────────────────────
// 四個入口
// ─────────────────────────────────────────────────────────────────────
//
//   步驟 1 生成初稿（幹事介面主流程）  `WebAppGenerate.gs`   ✅ 本來就有
//   進階功能 ▸ 重新生成初稿            `WebApp.gs`           ❌
//   試算表選單 ▸ 生成                  `Menu.gs`             ❌
//   四階段流程 ▸ 生成                  `FourStageFlow.gs`    ❌
//
// ⚠️ 公開連結嘅畫面文案自己寫住：
//
//     這是唯一一條連結。它永遠指向你最近一次「儲存我的修改」的版本。
//     內容改了之後不用換連結，收到的人重新開就見到新版。
//
// 幹事重新生成一次，然後同堂委講「連結已經更新」——
// 而堂委開連結見到嘅係舊嗰一版，**中間冇任何一個畫面提示過**。
// 呢個係靜默嘅錯，唔係會報錯嘅錯。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份驗嘅係**行為**，唔係字串
// ═════════════════════════════════════════════════════════════════════
//
// 第五十輪到第五十一輪，`verify-red` 連續四輪捉到同一種假綠：
// 測試喺搵「檔案入面有冇呢串字」，而 `if (false) { … }` 之後嗰串字仲喺度。
//
// 所以呢一份**唔用字串比對**。佢造一個 stub 記低呼叫次序，
// 真正叫落每一個入口，然後斷言「造咗版本之後一定跟住發佈」。

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

/**
 * 每一個入口一個乾淨嘅沙箱。
 *
 * ⚠️ 每次重新載入——共用一個沙箱嘅話，前一個入口留低嘅 stub
 * 會影響下一個，而嗰種污染同呢一輪 B 組要修嗰件事係同一種病。
 *
 * @param {Object} opts `{publishFails: boolean}`
 * @returns {Object} `{gas, calls, alerts}`
 */
function freshSandbox(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'PublicRoster.gs', 'WebAppSaveConfirm.gs', 'WebApp.gs', 'FourStageFlow.gs',
    'Menu.gs'
  ]);
  const calls = [];
  const alerts = [];

  // ── 記低呼叫次序 ──────────────────────────────────────────
  gas.performRosterGeneration_ = function (quarterId) {
    calls.push('generate:' + quarterId);
    return {
      versionNo: 1, sheetName: 'Roster_X_v1', assigned: 10, blank: 2,
      warnings: 0, attemptsRun: 1, attemptsPlanned: 1, attemptIndex: 1,
      seed: 1, deviation: 0, protected: false, stoppedByTime: false,
      unconfirmedSpecials: [],
      blankBreakdown: {
        structuralNaCount: 0, specialSkipCount: 0,
        manualPendingCount: 2, genuineGapCount: 0, genuineGapCells: []
      }
    };
  };
  gas.publishPublicRoster_ = function (quarterId) {
    calls.push('publish:' + quarterId);
    if (opts && opts.publishFails) throw new Error('故意爆：Drive 拒絕寫入');
  };

  // ── 其餘依賴一律最小化 ────────────────────────────────────
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.requireQuarterStage_ = function () {};
  gas.normalizeIdInput_ = function (v) { return String(v || '').trim(); };
  gas.describeUnconfirmedSpecialSundays_ = function () { return ''; };
  gas.countDistinctServiceDates_ = function () { return 13; };
  gas.countDistinctPosts_ = function () { return 8; };
  gas.log_ = function () {};
  gas.readSheet = function () { return []; };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { toast: function () {} };
    },
    getUi: function () {
      return {
        Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
        prompt: function () {
          return {
            getSelectedButton: function () { return 'OK'; },
            getResponseText: function () { return '2028T3'; }
          };
        },
        alert: function (title, body) {
          alerts.push(String(title) + '｜' + String(body === undefined ? '' : body));
          return 'OK';
        }
      };
    }
  };
  return { gas: gas, calls: calls, alerts: alerts };
}

// =====================================================================
console.log('\n=== A4【核心】四個入口，造完版本一定跟住發佈 ===');
{
  // ⚠️ 每一個都係**真正叫落去**，然後睇 stub 記低嘅呼叫次序。
  const entries = [
    { id: '進階功能 ▸ 重新生成初稿', run: function (g) { g.apiGenerateRoster('2028T3'); } },
    { id: '試算表選單 ▸ 生成', run: function (g) { g.runGenerateRoster_(); } },
    { id: '四階段流程 ▸ 步驟 1', run: function (g) { g.runFourStageStep1_(); } }
  ];

  entries.forEach(function (entry) {
    const box = freshSandbox({});
    let threw = '';
    try { entry.run(box.gas); } catch (err) { threw = err.message; }

    checkEqual('★★★★★★ 【' + entry.id + '】真的造了版本'
      + '（前置：沒有造過的話，下面那一條驗不到東西）',
      box.calls.filter(function (c) { return c.indexOf('generate:') === 0; }).length,
      1);
    checkEqual('★★★★★★ 【' + entry.id + '】**造完版本之後跟住發佈**'
      + '——不發佈的話，收到連結的人看到的仍然是舊那一版，'
      + '而中間沒有任何一個畫面提示過',
      box.calls.join(' → '), 'generate:2028T3 → publish:2028T3');
    checkEqual('★★★★★ 【' + entry.id + '】沒有拋錯', threw, '');
  });
}

// =====================================================================
console.log('\n=== A2【核心】用同一支，唔係各自寫 ===');
{
  // ⚠️ 呢一組 bug 嘅成因就係「同一件事四個地方做，其中三個漏咗」。
  // 再各自補一次只會把四個分岔變成四個新分岔。
  //
  // 驗法：**把 `tryPublishPublicRoster_()` 換走**，然後斷言四個入口
  // 全部都唔再發佈。自己寫一份嘅入口唔會受影響，就會露餡。
  const box = freshSandbox({});
  box.gas.tryPublishPublicRoster_ = function () {
    box.calls.push('shared-helper-called');
    return { failed: false, message: '' };
  };
  box.gas.apiGenerateRoster('2028T3');
  checkEqual('★★★★★★ `apiGenerateRoster()` 行嘅係共用嗰支'
    + '——換走共用嗰支之後，佢就唔會再直接叫 `publishPublicRoster_()`',
    box.calls.join(' → '), 'generate:2028T3 → shared-helper-called');

  const box2 = freshSandbox({});
  box2.gas.tryPublishPublicRoster_ = function () {
    box2.calls.push('shared-helper-called');
    return { failed: false, message: '' };
  };
  box2.gas.runGenerateRoster_();
  checkEqual('★★★★★★ 試算表選單嗰個一樣行共用嗰支',
    box2.calls.join(' → '), 'generate:2028T3 → shared-helper-called');

  const box3 = freshSandbox({});
  box3.gas.tryPublishPublicRoster_ = function () {
    box3.calls.push('shared-helper-called');
    return { failed: false, message: '' };
  };
  box3.gas.runFourStageStep1_();
  checkEqual('★★★★★★ 四階段流程嗰個一樣行共用嗰支',
    box3.calls.join(' → '), 'generate:2028T3 → shared-helper-called');
}

// =====================================================================
console.log('\n=== A3【核心】發佈失敗唔可以靜靜略過 ===');
{
  // ⚠️ **唔可以只寫 log。** 寫 log 等於冇人知。

  // ── 選單入口：`ui.alert()` 要講 ────────────────────────────
  const menu = freshSandbox({ publishFails: true });
  menu.gas.runGenerateRoster_();
  const menuText = menu.alerts.join('\n');
  check('★★★★★★ 【試算表選單】發佈失敗要喺 `ui.alert()` 講出嚟',
    /公開連結沒有更新成功/.test(menuText), menuText.slice(0, 400));
  check('★★★★★★ 而且講得出「收到連結嘅人而家見到嘅係邊一版」'
    + '——淨係講「發佈失敗」，幹事唔知嚴唔嚴重',
    /收到連結的人現在看到的仍然是/.test(menuText), menuText.slice(0, 400));
  check('★★★★★ 同埋講得出去邊度重試',
    /發佈公開職事表/.test(menuText), menuText.slice(0, 400));
  check('★★★★★ 仲有失敗原因原文',
    /故意爆：Drive 拒絕寫入/.test(menuText), menuText.slice(0, 500));

  // ── 四階段流程：一樣 ───────────────────────────────────────
  const four = freshSandbox({ publishFails: true });
  four.gas.runFourStageStep1_();
  const fourText = four.alerts.join('\n');
  check('★★★★★★ 【四階段流程】一樣要講',
    /公開連結沒有更新成功/.test(fourText), fourText.slice(0, 400));

  // ── Web UI 入口：回傳值要帶住 ─────────────────────────────
  const web = freshSandbox({ publishFails: true });
  const res = web.gas.apiGenerateRoster('2028T3');
  checkEqual('★★★★★★ 【進階功能】回傳值標住 `publishFailed`'
    + '——Web UI 冇 `ui.alert()`，所以要由回傳值帶出去',
    res.publishFailed, true);
  check('★★★★★★ 而且帶住同一段訊息',
    /公開連結沒有更新成功/.test(String(res.publishMessage)),
    String(res.publishMessage).slice(0, 400));

  // ── ⚠️ 發佈失敗**唔算生成失敗**（版本已經真係建立咗）──────
  checkEqual('★★★★★★ 發佈失敗唔會令生成整個失敗'
    + '——版本已經真係建立咗，當成失敗會令幹事以為要再生成一次',
    res.versionNo, 1);
  const four2 = freshSandbox({ publishFails: true });
  let threw = '';
  try { four2.gas.runFourStageStep1_(); } catch (err) { threw = err.message; }
  checkEqual('★★★★★ 選單入口一樣唔會拋錯', threw, '');
}

// =====================================================================
console.log('\n=== A3 成功嗰邊都要講一句 ===');
{
  const box = freshSandbox({});
  box.gas.runGenerateRoster_();
  check('★★★★★ 發佈成功都要講「公開連結已經更新到第 N 版」'
    + '——唔講嘅話，幹事唔知道呢一步有冇做過',
    /公開連結已經更新到第 1 版/.test(box.alerts.join('\n')),
    box.alerts.join('\n').slice(0, 300));
}

// =====================================================================
console.log('\n=== 步驟 1 主流程嗰個入口本來就有，唔可以改壞咗 ===');
{
  // ⚠️ 呢一條守嘅係「修其餘三個嗰陣冇順手整爛本來啱嗰個」。
  const src = read('src/WebAppGenerate.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ `apiGenerateDraftExecute_locked_()` 仍然叫 `tryPublishPublicRoster_()`',
    /const publish = tryPublishPublicRoster_\(quarterId\);/.test(src), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
