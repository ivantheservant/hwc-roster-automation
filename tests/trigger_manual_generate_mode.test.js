// 第二十五輪批次階段 A：自動生成改成人手撳。
// 執行方式：node tests/trigger_manual_generate_mode.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住咩
// ─────────────────────────────────────────────────────────────────────
//
// Ivan 決定：初稿由幹事自己撳掣生成，系統唔會自己動。
// 呢個決定有一個**危險嘅失敗模式**：如果只係「唔記得跑」而唔係
// 「明確關咗」，系統會靜靜咁乜都唔做，而幹事以為佢會做——
// 一季就會完全冇人排，而且**冇任何訊號**。
//
// 所以呢度鎖三件事：
//   1. 開關 FALSE 時**確實唔會生成**（唔可以「應該唔會」）
//   2. 開關 TRUE 時**行為完全不變**（嗰條路徑冇被改壞）
//   3. 關咗之後**一定會有提醒**，而且嗰個提醒**冇次數上限**
//      ——上限係另外三個維度嘅嘢，呢一個唔可以有

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'Trigger.gs'
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

const K = gas.CONFIG_KEYS;
const Q = gas.QUARTER_STAGE;

// ── 可控嘅替身 ───────────────────────────────────────────────
let configValues = {};
let stageValue = Q.DRAFT;
let latestVersionNo = -1;

gas.getConfig = function (key, fallback) {
  return Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : fallback;
};
gas.getQuarterStage_ = function () { return stageValue; };
gas.findLatestVersionNo = function () { return latestVersionNo; };

function reset() {
  configValues = {};
  stageValue = Q.DRAFT;
  latestVersionNo = -1;
}

console.log('\n=== A2【核心】開關 FALSE ⇒ 一定唔會生成 ===');
{
  reset();
  configValues[K.TRIGGER_AUTO_GENERATE] = false;

  const j = gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-12-31');
  checkEqual('★★★★★ 已經到期、Stage=DRAFT、冇版本——'
    + '即係舊邏輯下一定會生成嘅情況，開關關咗就唔會生成',
    j.outcome, 'SKIPPED_MANUAL_MODE');
  check('★★★★ 而且要講到係「改為提醒幹事自己生成」，唔係得一句「略過」'
    + '——幹事睇檢查報告嗰陣要知道下一步係佢自己撳掣',
    /提醒/.test(j.detail) && /撳/.test(j.detail));

  reset();
  // 完全冇設定呢個 key（例如舊試算表未補建）也要當成關閉。
  checkEqual('★★★★★ Config 完全冇呢個 key ⇒ 一樣唔生成（預設關閉）'
    + '——預設值選錯方向嘅話，一個未升級嘅試算表會突然自己開始生成',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-12-31').outcome,
    'SKIPPED_MANUAL_MODE');
}

console.log('\n=== A2 開關檢查要喺最前面，唔可以擺喺日期檢查後面 ===');
{
  reset();
  configValues[K.TRIGGER_AUTO_GENERATE] = false;

  // 未到期。如果開關檢查擺喺日期檢查之後，呢度會回 SKIPPED_NOT_DUE
  // ——即係話「未到期，到咗就會生成」，而實情係永遠都唔會生成。
  checkEqual('★★★★★ 未到期時**一樣**要回 SKIPPED_MANUAL_MODE，'
    + '唔可以回 SKIPPED_NOT_DUE——後者等於話「到咗期就會自己生成」，'
    + '幹事會等一件永遠唔會發生嘅事',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-01-01').outcome,
    'SKIPPED_MANUAL_MODE');

  checkEqual('★★★★ 冇日期時亦然',
    gas.judgeGenerateAction_('2027T1', '', '2026-12-31').outcome, 'SKIPPED_MANUAL_MODE');
}

console.log('\n=== A2 開關 TRUE ⇒ 舊行為完全不變（嗰條路徑冇被改壞）===');
{
  reset();
  configValues[K.TRIGGER_AUTO_GENERATE] = true;

  checkEqual('★★★★★ 到期＋DRAFT＋冇版本 ⇒ WOULD_RUN',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-12-31').outcome, 'WOULD_RUN');
  checkEqual('★★★★ 未到期 ⇒ SKIPPED_NOT_DUE',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-01-01').outcome, 'SKIPPED_NOT_DUE');
  checkEqual('★★★★ 冇日期 ⇒ SKIPPED_NO_DATE',
    gas.judgeGenerateAction_('2027T1', '', '2026-12-31').outcome, 'SKIPPED_NO_DATE');

  stageValue = Q.REVIEW_SENT;
  checkEqual('★★★★ Stage 已前進 ⇒ SKIPPED_STAGE',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-12-31').outcome, 'SKIPPED_STAGE');

  stageValue = Q.DRAFT;
  latestVersionNo = 0;
  checkEqual('★★★★ 已經有版本 ⇒ SKIPPED_HAS_VERSION',
    gas.judgeGenerateAction_('2027T1', '2026-11-27', '2026-12-31').outcome, 'SKIPPED_HAS_VERSION');
}

console.log('\n=== A2【核心】維度四：到期咗但完全冇版本 ⇒ 一定要提醒 ===');
{
  // 自動生成關咗之後，呢個維度就係**唯一嘅安全網**。
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'Trigger.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function judgeRemindAction_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ 有 NOT_GENERATED 呢個提醒維度', /NOT_GENERATED/.test(body));
  check('★★★★★ 觸發條件係「有生成日期」＋「已到期」＋「完全冇版本」三者齊全'
    + '——少咗「完全冇版本」就會喺已經生成之後繼續嘈',
    /notGeneratedTriggered\s*=\s*!!schedulePeek\.generateDate/.test(body)
    && /today >= schedulePeek\.generateDate/.test(body)
    && /findLatestVersionNo\(quarterId\) < 0/.test(body));

  check('★★★★★ 呢個維度**唔受 maxCount 上限限制**'
    + '——其餘三個維度講「你慢咗」，提三次就夠；'
    + '呢個講「完全冇人做過」，而家連自動生成都冇，冇咗呢個提醒就真係冇任何嘢會發生',
    /if \(!notGeneratedTriggered && reminderCount >= maxCount\)/.test(body));

  check('★★★★★ 但仍然受「今日提醒過就唔再提」限制（一日最多一封）',
    /reminderLog\.indexOf\(today\) !== -1/.test(body));

  check('★★★★★ 冇上限嗰陣**唔可以寫「第 N / M 次」**'
    + '——寫咗就係講緊一個唔存在嘅上限，幹事會以為再等幾日就唔會再嘈',
    /沒有次數上限/.test(body));
}

console.log('\n=== A2 提醒信文案：唔可以再講「系統將會自動生成」 ===');
{
  const mailer = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  const fn = mailer.slice(mailer.indexOf('function notifyAdminStageReminder_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ 完全冇版本時，「下一步」要叫幹事去撳「生成初稿」，'
    + '唔可以照用 STAGE_NEXT_ACTION——冇版本嗰陣嗰啲掣全部係灰嘅，'
    + '叫佢去做一件佢做唔到嘅事',
    /notGenerated[\s\S]{0,200}?生成初稿/.test(body));
  check('★★★★★ 而且要明講「系統不會自己生成」',
    /系統不會自己生成/.test(body));
  check('★★★★ 要提供一條停止收信嘅出路（清空 GenerateOn）'
    + '——一封冇上限嘅提醒信，一定要有得停',
    /GenerateOn/.test(body) && /清空/.test(body));
  check('★★★★★ 唔可以再出現「自動生成」呢個講法',
    body.indexOf('會自動生成') === -1);
}

console.log('\n=== A1 Config 三處要同步 ===');
{
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  check('★★★★ Constants.gs 有 CONFIG_KEYS.TRIGGER_AUTO_GENERATE',
    gas.CONFIG_KEYS.TRIGGER_AUTO_GENERATE === 'TRIGGER_AUTO_GENERATE');
  checkEqual('★★★★★ DEFAULTS 係 false（唔係 true、唔係 undefined）'
    + '——預設值揀錯方向，一個未補建 Config 嘅試算表會突然自己開始生成',
    gas.DEFAULTS.TRIGGER_AUTO_GENERATE, false);
  check('★★★★ ConfigSeed.gs 有登記，而且 Type=BOOL、預設 FALSE',
    /TRIGGER_AUTO_GENERATE[\s\S]{0,200}?CONFIG_TYPES\.BOOL/.test(read('src/ConfigSeed.gs')));
  check('★★★★ ConfigBaselineCheck.gs 嘅快照有呢個 key',
    /TRIGGER_AUTO_GENERATE:\s*\{[^}]*launchTargetValue: 'FALSE'/
      .test(read('src/ConfigBaselineCheck.gs')));
  check('★★★★ config_baseline_上線值.json 亦有',
    read('docs/config_baseline_上線值.json').indexOf('TRIGGER_AUTO_GENERATE') !== -1);
}

console.log('\n=== A2 唯讀檢查報告唔可以講一件唔會發生嘅事 ===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'Trigger.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function buildAutomationCheckReport_'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  check('★★★★★ 報告會按開關講兩套唔同嘅話'
    + '——呢份報告嘅唯一用途就係「話俾幹事知系統會自己做啲乜」，'
    + '講錯咗等於成份報告冇咗價值',
    /autoGenerateOn\s*\?/.test(body));
  check('★★★★ 關咗嗰陣要明寫「系統不會自己生成任何初稿」',
    /系統不會自己生成任何初稿/.test(body));
  check('★★★★ 逐季那一行亦要有 SKIPPED_MANUAL_MODE 嘅講法',
    /SKIPPED_MANUAL_MODE/.test(body));
}

console.log('\n=== 自動生成嘅程式碼路徑一行都冇刪 ===');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'Trigger.gs'), 'utf8');
  check('★★★★★ performRosterGeneration_ 嘅呼叫仲喺度'
    + '——「唔要自動生成」係一個**決定**，唔應該用「刪走程式碼」去表達，'
    + '否則改主意就要重新寫一次（本專案「一切須可配置，不可寫死」）',
    /performRosterGeneration_\(quarterId\)/.test(src));
  check('★★★★ notifyAdminGenerateDone_ 亦仲喺度',
    /notifyAdminGenerateDone_\(/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
