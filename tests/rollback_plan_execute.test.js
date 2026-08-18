// 第二十四輪批次階段 E：「回到上一個版本」。
// 執行方式：node tests/rollback_plan_execute.test.js
//
// 真正跑要 GAS 環境（讀寫試算表），離線測唔到。呢度鎖住四個
// **唔可以退化**嘅結構性要求，每一個對應一種「靜靜出事」嘅可能。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppRollback.gs'
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

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppRollback.gs'), 'utf8');
const planFn = SRC.slice(SRC.indexOf('function apiRollbackPlan'), SRC.indexOf('function rollbackBlocked_'));
const execFn = SRC.slice(SRC.indexOf('function apiRollbackExecute'));

console.log('\n=== E1【核心】未儲存改動 ⇒ 拒絕（唯一會靜靜銷毀幹事工作嘅情況）===');
{
  check('★★★★★ plan 有查未儲存改動', /readDashboardUnsavedState_\(/.test(planFn));
  check('★★★★★ 有改動就 return blocked，唔會繼續行落去',
    /if \(unsaved\.hasAny\) \{[\s\S]{0,900}?return rollbackBlocked_\('UNSAVED_CHANGES'/.test(planFn));
  check('★★★★★ 訊息明講「回到上一個版本會令這些改動消失」'
    + '——唔講清楚後果，幹事會以為只係普通阻擋',
    /回到上一個版本會令這些改動消失/.test(planFn));
  check('★★★★ 三段式訊息', /buildThreePartMessage_\(/.test(planFn));
  check('★★★★★ **冇任何繞過參數**（force／skipCheck 之類）',
    !/force|skipUnsaved|ignoreUnsaved/i.test(SRC));
}

console.log('\n=== E1【核心】ParentVersionNo 寫實際父版本，唔係目標版本 ===');
{
  // 由 v3 回到 v2、建立 v4：ParentVersionNo 要寫 3，唔係 2。
  // 寫 2 嘅話，版本鏈會變成 v2 有兩個仔，睇落好似分咗支——
  // 但實情係一條直線，只不過 v4 嘅**內容**取自 v2。
  check('★★★★★ registerVersion 傳 plan.currentVersionNo 做 ParentVersionNo',
    /registerVersion\([\s\S]{0,400}?plan\.currentVersionNo,/.test(execFn));
  check('★★★★★ **冇**傳 target 做 ParentVersionNo',
    !/registerVersion\([\s\S]{0,400}?^\s*target,/m.test(execFn));
  check('★★★★ 而且有註解講明點解（唔係啱好撞啱）',
    /ParentVersionNo 寫\*\*實際父版本\*\*，唔係目標版本/.test(execFn)
    || /ParentVersionNo 寫.{0,10}實際父版本/.test(execFn));
  check('★★★★★ Basis 寫「回到第 N 版」，內容來源記喺 Basis／Notes 而唔係 Parent',
    /'回到第 ' \+ target \+ ' 版'/.test(execFn) && /'內容取自第 ' \+ target \+ ' 版'/.test(execFn));
}

console.log('\n=== E1【核心】永不改變 Stage ===');
{
  check('★★★★★ execute 完全冇叫 advanceQuarterStage_／setQuarterStage_'
    + '——回退係「改內容」，唔係「改流程進度」',
    execFn.indexOf('advanceQuarterStage_') === -1
    && execFn.indexOf('setQuarterStage_') === -1);
  check('★★★★ 整個檔案都冇改 Stage',
    SRC.indexOf('advanceQuarterStage_') === -1 && SRC.indexOf('setQuarterStage_') === -1);
  check('★★★★ 檔頭有解釋點解唔改', /永不改變 Stage/.test(SRC));
}

console.log('\n=== E1【核心】發佈失敗 ≠ 全盤失敗 ===');
{
  check('★★★★★ 用 tryPublishPublicRoster_ 把失敗降級',
    /tryPublishPublicRoster_\(quarterId\)/.test(execFn));
  check('★★★★★ 發佈失敗時仍然回 ok:true（版本真係建立咗）'
    + '——當成失敗嘅話，幹事會以為要重做，就會再回退多一次、又多一版',
    /ok: true,\s*\n\s*versionCreated: true/.test(execFn));
  check('★★★★ 回傳 publishFailed／publishError 兩個欄位俾前端分辨',
    /publishFailed: publish\.failed/.test(execFn) && /publishError: publish\.message/.test(execFn));

  const writeCatch = execFn.slice(execFn.indexOf('} catch (err) {'));
  const untilReturn = writeCatch.slice(0, writeCatch.indexOf('\n  }'));
  check('★★★★★ 寫入失敗嘅 catch 入面唔會發佈公開連結',
    untilReturn.indexOf('tryPublishPublicRoster_') === -1);
  check('★★★★★ 寫入失敗訊息明寫「第 N 版可能只寫入了一部分」',
    /可能只寫入了一部分/.test(untilReturn));
  check('★★★★ 而且講明兩個舊版本都完好（回退失敗最驚就係以為連舊版都冧咗）',
    /版都完好無缺/.test(untilReturn));
}

console.log('\n=== E1：目標版本要用今日嘅規則重新檢查 ===');
{
  check('★★★★★ plan 會重新跑規則檢查'
    + '——「舊版本一定合規」係危險假設：嗰一版通過檢查嗰陣用嘅係當時嘅規則',
    /findStateViolations_\(/.test(planFn) && /classifySaveConfirmViolations_\(/.test(planFn));
  check('★★★★★ 檢查失敗時回 violationCheckFailed，**唔可以顯示「0 項違反」**'
    + '——「檢查過冇問題」同「檢查唔到」係兩件事',
    /violationCheckFailed = err\.message/.test(planFn));

  const front = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptRollback.html'), 'utf8');
  check('★★★★★ 前端有把「檢查唔到」同「冇問題」分開顯示',
    /不是「沒有問題」，是「查不到」/.test(front));
}

console.log('\n=== E2：畫面上一定要有「不要用 Google 試算表版本記錄」嗰段字 ===');
{
  check('★★★★★ 後端有呢段警告常數', /const ROLLBACK_SHEETS_HISTORY_WARNING/.test(SRC));
  ['不要用 Google 試算表本身的「版本記錄」還原',
    '不會還原系統內部的職事表資料',
    '不會還原這一季的進度',
    '不會還原寄出記錄',
    '之後每一步都會出錯'
  ].forEach(function (phrase) {
    check('★★★★★ 逐字含：' + phrase,
      gas.ROLLBACK_SHEETS_HISTORY_WARNING.indexOf(phrase) !== -1);
  });

  check('★★★★★ plan 一定回傳呢段字（唔係得 blocked 時先有）',
    /sheetsHistoryWarning: ROLLBACK_SHEETS_HISTORY_WARNING/.test(planFn));
  check('★★★★ blocked 時都照回（前端任何一個畫面都攞得到）',
    /sheetsHistoryWarning: ROLLBACK_SHEETS_HISTORY_WARNING/.test(
      SRC.slice(SRC.indexOf('function rollbackBlocked_'))));

  const front = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptRollback.html'), 'utf8');
  check('★★★★★ 前端由後端常數攞呢段字，**唔喺前端另抄一份**'
    + '（抄一份就會有人改咗一邊而令警告失去力度）',
    /buildSheetsHistoryWarning\(plan\.sheetsHistoryWarning\)/.test(front)
    && front.indexOf('不會還原寄出記錄') === -1);
}

console.log('\n=== E2：打字確認 ＋ 唔信前端 ===');
{
  checkEqual('★★★★★ 確認字串係「確認」兩個字（規格 1.4.4）',
    gas.ROLLBACK_CONFIRM_TEXT, '確認');
  check('★★★★★ execute 開頭重新跑一次 plan，唔信前端傳嚟嘅狀態',
    /const plan = apiRollbackPlan\(quarterId, targetVersionNo\);/.test(execFn));
  check('★★★★★ 重新跑出嚟 blocked 就中止',
    /if \(plan\.blocked\) throw new Error\(plan\.message\);/.test(execFn));
  check('★★★★ 放行文字唔啱就拋三段式錯誤',
    /!== ROLLBACK_CONFIRM_TEXT\) \{[\s\S]{0,200}?buildThreePartMessage_/.test(execFn));
  check('★★★★★ 兩個 api 第一行都有 assertWebAppRequestAllowed_()',
    /function apiRollbackPlan\(quarterId, targetVersionNo\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(SRC)
    && /function apiRollbackExecute\(quarterId, targetVersionNo, releaseText\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(SRC));
}

console.log('\n=== E1：三種唔應該繼續嘅情況都有擋 ===');
{
  ['NO_VERSION', 'BAD_TARGET', 'TARGET_IS_CURRENT', 'TARGET_EMPTY'].forEach(function (reason) {
    check('★★★★ 有擋：' + reason, planFn.indexOf("'" + reason + "'") !== -1);
  });
  check('★★★★★ 揀咗目前嗰一版 ⇒ 擋（唔係靜靜建立一個內容一樣嘅新版本）',
    /target === currentVersionNo/.test(planFn));
  check('★★★★ 目標版本冇任何派工紀錄 ⇒ 擋'
    + '（唔擋嘅話會建立一個空白版本，而且睇落好似成功咗）',
    /targetRows\.length === 0/.test(planFn));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
