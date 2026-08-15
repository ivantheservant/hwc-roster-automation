// 第九輪批次階段 D：上線切換嚮導。
// 執行方式：node tests/go_live_wizard.test.js
//
// 上線切換係整個系統風險最高嘅一次操作——改錯就係全體義工收到唔應該收嘅信。
// 本輪**絕對冇執行過**呢個嚮導（D4），所以佢嘅正確性完全靠呢份測試。
//
// 測試策略：`assessGoLiveState_()` 係一個純判斷函式（只讀 Config、唔寫嘢），
// 邏輯逐字移植過嚟用假 config 餵；至於 `setConfigValue_()`／`runGoLiveWizard_()`
// 呢啲會真正寫入嘅函式，改為用**靜態原始碼檢查**確認幾件唔可以錯嘅事
// （例如「回退一定先改 DRY_RUN 先」），呢種檢查唔需要執行到 GAS API。

const fs = require('fs');
const path = require('path');

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

const SRC = path.join(__dirname, '..', 'src');
const wizardSource = fs.readFileSync(path.join(SRC, 'GoLiveWizard.gs'), 'utf8');

// ---------------------------------------------------------------------------
// 移植：assessGoLiveState_() 嘅判斷邏輯（逐字對應 GoLiveWizard.gs，
// readConfig()／describeConfigValue_() 換成直接傳入值）
// ---------------------------------------------------------------------------
function assessGoLiveState(dryRunValue, subjectPrefixValue) {
  const dryRun = dryRunValue !== false;
  const subjectPrefix = String(subjectPrefixValue || '');
  const prefixCleared = subjectPrefix.trim() === '';
  const dryRunOff = dryRun === false;

  let phase;
  if (dryRunOff && prefixCleared) phase = 'LIVE';
  else if (!dryRunOff && !prefixCleared) phase = 'TEST';
  else if (dryRunOff && !prefixCleared) phase = 'HALF_LIVE_WITH_PREFIX';
  else phase = 'HALF_PREFIX_CLEARED';

  return { dryRun: dryRun, subjectPrefix: subjectPrefix, prefixCleared: prefixCleared,
    dryRunOff: dryRunOff, phase: phase };
}

console.log('\n=== D1／D2：四種狀態都要判斷得準（「做到邊一段」由真實值計出嚟）===');
{
  checkEqual('★ DRY_RUN=TRUE ＋ 有前綴 → 測試模式',
    assessGoLiveState(true, '[測試] ').phase, 'TEST');
  checkEqual('★ DRY_RUN=FALSE ＋ 冇前綴 → 已完全上線',
    assessGoLiveState(false, '').phase, 'LIVE');
  checkEqual('★★ DRY_RUN=TRUE ＋ 冇前綴 → 改咗一半（安全嗰半）',
    assessGoLiveState(true, '').phase, 'HALF_PREFIX_CLEARED');
  checkEqual('★★ DRY_RUN=FALSE ＋ 仲有前綴 → 改咗一半（危險嗰半）',
    assessGoLiveState(false, '[測試] ').phase, 'HALF_LIVE_WITH_PREFIX');

  // Config 冇呢個 Key 嘅時候，describeConfigValue_() 會回傳 fallback（DRY_RUN 預設 true）
  checkEqual('★ Config 完全冇設定時，一律當作測試模式（安全預設）',
    assessGoLiveState(true, '').dryRun, true);
  checkEqual('★ 只有空白字元嘅前綴都算「已清空」',
    assessGoLiveState(true, '   ').prefixCleared, true);
}

console.log('\n=== D2：中途取消唔會留低「唔知做到邊」嘅狀態 ===');
{
  // 關鍵性質：狀態完全由 (DRY_RUN, MAIL_SUBJECT_PREFIX) 兩個真實值決定，
  // 唔靠任何額外記低嘅進度旗標。所以無論喺邊一步取消、甚至幹事自己手動
  // 改咗其中一格，再入嚟都一定計得返「而家係邊個 phase」。
  const allCombos = [
    [true, '[測試] '], [true, ''], [false, '[測試] '], [false, '']
  ];
  const phases = allCombos.map(function (c) { return assessGoLiveState(c[0], c[1]).phase; });
  checkEqual('★★ 四種可能組合各自對應一個明確 phase，冇「未知」狀態',
    phases, ['TEST', 'HALF_PREFIX_CLEARED', 'HALF_LIVE_WITH_PREFIX', 'LIVE']);
  checkEqual('★ 四個 phase 互不重複（每個真實狀態只對應一個講法）',
    new Set(phases).size, 4);

  check('★★ 程式碼冇用 PropertiesService 記進度（狀態一律即場由 Config 計）',
    wizardSource.indexOf('PropertiesService') === -1,
    '一旦改用記低嘅進度旗標，就會出現「旗標話做完但 Config 其實冇改」嘅脫節情況');
}

console.log('\n=== D1：前置體檢有「必須處理」就一定要拒絕繼續 ===');
{
  check('★★ 嚮導會呼叫 buildFullHealthCheckReport_()',
    wizardSource.indexOf('buildFullHealthCheckReport_') !== -1);
  check('★★ 體檢唔 ok 就 return，唔會改任何 Config',
    /if\s*\(!readiness\.ok\)[\s\S]{0,900}?return;/.test(wizardSource),
    '必須喺任何 setConfigValue_() 之前就 return');

  // 更嚴格：確認「體檢把關」喺原始碼中真係排喺第一次 setConfigValue_ 之前
  const readinessIdx = wizardSource.indexOf('if (!readiness.ok)');
  const firstSetIdx = wizardSource.indexOf('setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX');
  check('★★ 體檢把關喺第一次改 Config 之前（唔係改完先檢查）',
    readinessIdx > 0 && firstSetIdx > 0 && readinessIdx < firstSetIdx);

  check('★ 體檢本身拋錯時亦都會中止（唔會當作通過）',
    /全面體檢執行失敗[\s\S]{0,200}?return;/.test(wizardSource));
}

console.log('\n=== D1：DRY_RUN 改 FALSE 一定要打字確認，唔可以撳 Yes 就過 ===');
{
  check('★★ 有逐字確認文字常數 GO_LIVE_CONFIRM_TEXT',
    /const GO_LIVE_CONFIRM_TEXT\s*=\s*'確認上線'/.test(wizardSource));
  check('★★ DRY_RUN=FALSE 之前會比對逐字輸入嘅文字',
    /getResponseText\(\)\.trim\(\)\s*!==\s*GO_LIVE_CONFIRM_TEXT/.test(wizardSource));

  // 確認打字確認真係喺 DRY_RUN 改動之前
  const confirmIdx = wizardSource.indexOf('!== GO_LIVE_CONFIRM_TEXT');
  const dryRunSetIdx = wizardSource.indexOf("setConfigValue_(CONFIG_KEYS.DRY_RUN, 'FALSE'");
  check('★★ 打字確認排喺 DRY_RUN 改 FALSE 之前',
    confirmIdx > 0 && dryRunSetIdx > 0 && confirmIdx < dryRunSetIdx);

  check('★ 清空主旨前綴嗰段只需要 Yes／No（風險低，唔使打字）',
    /第 1 段[\s\S]{0,600}?ButtonSet\.YES_NO/.test(wizardSource));
}

console.log('\n=== D3：回退次序必須係「先止血，之後先還原前綴」 ===');
{
  const rollbackStart = wizardSource.indexOf('function runGoLiveRollback_');
  check('★ 有回退函式 runGoLiveRollback_()', rollbackStart > 0);

  const rollbackBody = wizardSource.slice(rollbackStart);
  const dryRunTrueIdx = rollbackBody.indexOf("setConfigValue_(CONFIG_KEYS.DRY_RUN, 'TRUE'");
  const prefixIdx = rollbackBody.indexOf('setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX');
  check('★★ 回退時 DRY_RUN=TRUE 排喺還原前綴之前（止血優先）',
    dryRunTrueIdx > 0 && prefixIdx > 0 && dryRunTrueIdx < prefixIdx,
    '次序倒轉嘅話，還原前綴失敗就會卡喺「仲會真正寄信」嘅狀態');

  check('★★ 回退亦都要打字確認', /GO_LIVE_ROLLBACK_CONFIRM_TEXT/.test(rollbackBody));
  check('★ 第 1 段（止血）失敗時，會明確叫幹事自己去 Config 人手改',
    /人手將[\s\S]{0,80}?DRY_RUN[\s\S]{0,40}?改成 TRUE|人手將 ' \+ CONFIG_KEYS\.DRY_RUN/.test(rollbackBody));
  check('★ 第 2 段失敗時會講明「最重要嗰步已經做咗」，唔會嚇親幹事',
    /第 1 段已成功/.test(rollbackBody));
}

console.log('\n=== 安全性：setConfigValue_() 唔可以自動新增 Config 行 ===');
{
  const setStart = wizardSource.indexOf('function setConfigValue_');
  const setBody = wizardSource.slice(setStart, wizardSource.indexOf('\n}', setStart));
  check('★★ 搵唔到 Key 就拋錯，唔會 append 新行',
    /targetRow === -1[\s\S]{0,300}?throw new Error/.test(setBody),
    '上線切換順手建立新設定行係危險嘅——應該由「補建 Config 參數」負責');
  check('★ 冇任何 appendRow／getLastRow()+1 嘅寫入',
    setBody.indexOf('appendRow') === -1 && !/getLastRow\(\)\s*\+\s*1/.test(setBody));
  check('★★ 改完即刻清 Config 快取（否則之後嘅檢查會讀返舊值）',
    setBody.indexOf('reloadConfigCache()') !== -1);
  check('★ 每次改值都寫 AuditLog（含改動前後嘅值）',
    setBody.indexOf('writeAuditLog_') !== -1 && setBody.indexOf('oldValue') !== -1);
}

console.log('\n=== 安全性：嚮導唔會順手做任何其他嘢 ===');
{
  // 上線切換應該只掂兩個 Config 值，唔可以順手寄信、改 Stage、生成版本
  const FORBIDDEN = [
    ['sendStage(', '寄信'],
    ['MailApp', '直接寄信'],
    ['advanceQuarterStage_', '改動季度 Stage'],
    ['performRosterGeneration_', '生成職事表'],
    ['ScriptApp.newTrigger', '建立 trigger']
  ];
  FORBIDDEN.forEach(function (pair) {
    check('★★ 上線切換嚮導冇' + pair[1] + '（' + pair[0] + '）',
      wizardSource.indexOf(pair[0]) === -1);
  });

  // 只可以改呢兩個 Key
  const setCalls = wizardSource.match(/setConfigValue_\(CONFIG_KEYS\.[A-Z_]+/g) || [];
  const keys = Array.from(new Set(setCalls.map(function (s) {
    return s.replace('setConfigValue_(CONFIG_KEYS.', '');
  }))).sort();
  checkEqual('★★ 全檔只會改動 DRY_RUN 同 MAIL_SUBJECT_PREFIX 兩個 Key',
    keys, ['DRY_RUN', 'MAIL_SUBJECT_PREFIX']);
}

console.log('\n=== D4：本輪冇執行過（唯讀檢視函式必須真係唯讀）===');
{
  const statusStart = wizardSource.indexOf('function runGoLiveStatus_');
  const statusBody = wizardSource.slice(statusStart);
  check('★★ runGoLiveStatus_() 完全冇改動任何嘢',
    statusBody.indexOf('setConfigValue_') === -1
      && statusBody.indexOf('setValue') === -1
      && statusBody.indexOf('writeAuditLog_') === -1,
    '「睇下而家做到邊」呢個動作本身唔應該有任何副作用');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
