// 第四十九輪批次 第 4 層：亂行機。
// 執行方式：node tests/monkey_run.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 亂行機擋緊嘅係「冇人諗過要噉撳」
// ═════════════════════════════════════════════════════════════════════
//
// 前面三層都有同一個盲點：**佢哋只走我想像得到嗰幾條路。**
// 自測機嘅 S01→S10 係我坐喺度諗出嚟嘅次序。而現場撞到嘅 bug，
// 有一半係「冇人諗過要噉撳」。
//
// ⚠️ 呢一份守嘅係亂行機自己嗰幾條規矩：
//
//   一、**確定性**——同一個 seed 一定行同一條路。
//       冇咗佢，紅咗都重現唔到，而一個重現唔到嘅 bug 報告等於冇
//   二、**續跑要真係接得返**，唔可以由頭再行一次而報告寫住「繼續」
//   三、動作清單入面**冇**五樣禁止嘅嘢
//   四、拋錯唔會被吞——「畫面話得而系統話唔得」本身就係一個發現
//   五、報告一定要印「走到這裡的完整步驟」

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
const SRC = read('src/MonkeyRun.gs');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
  'SeasonRehearsal.gs', 'QuarterReset.gs', 'SelfTestRunner.gs', 'MonkeyRun.gs'
]);

// =====================================================================
console.log('\n=== 一【核心】確定性：同一個 seed 一定行同一條路 ===');
{
  const draw = function (seed, n, skip) {
    const rnd = gas.makeMonkeyRandom_(seed, skip);
    const out = [];
    for (let i = 0; i < n; i++) out.push(rnd());
    return out;
  };

  checkEqual('★★★★★★ 同一個 seed 抽 10 次，兩次結果一模一樣'
    + '——冇咗呢一點，一個紅咗嘅步驟就永遠重現唔到',
    JSON.stringify(draw(12345, 10)), JSON.stringify(draw(12345, 10)));
  check('★★★★★ 唔同 seed 行唔同路',
    JSON.stringify(draw(12345, 10)) !== JSON.stringify(draw(999, 10)), '');
  check('★★★★★★ 冇用 `Math.random()`'
    + '——用咗就冇可能重現',
    !/Math\.random\(/.test(CODE), '');
  check('★★★★★ 抽出嚟嘅值全部喺 [0,1)',
    draw(7, 200).every(function (v) { return v >= 0 && v < 1; }), '');
}

// =====================================================================
console.log('\n=== 二【核心】續跑要真係接得返 ===');
{
  // ⚠️ 唔快轉嘅話，「繼續亂行」會由同一個 seed 嘅第一抽再嚟一次，
  // 即係行返上一次同一條路——而嗰個唔係「繼續」，
  // 係「由頭再行一次，而報告寫住繼續」。
  const full = [];
  const rndFull = gas.makeMonkeyRandom_(42);
  for (let i = 0; i < 20; i++) full.push(rndFull());

  const firstHalf = [];
  const rndA = gas.makeMonkeyRandom_(42);
  for (let i = 0; i < 10; i++) firstHalf.push(rndA());
  checkEqual('★★★★★ 抽數數得啱', rndA.drawnCount(), 10);

  const secondHalf = [];
  const rndB = gas.makeMonkeyRandom_(42, 10);
  for (let i = 0; i < 10; i++) secondHalf.push(rndB());

  checkEqual('★★★★★★ 「跑 10 步再續跑 10 步」＝「一次過跑 20 步」'
    + '——續跑要接住上一條路，唔係由頭再行一次',
    JSON.stringify(firstHalf.concat(secondHalf)), JSON.stringify(full));

  check('★★★★★★ `runMonkey_()` 會把抽數回埋出嚟畀續跑用',
    /drawnCount: rnd\.drawnCount\(\)/.test(CODE), '');
  check('★★★★★★ 而且續跑入口真係用返上一次嘅抽數',
    /runMonkey_\(steps, state\.seed, state\.drawnCount\)/.test(CODE), '');
  check('★★★★★ 第一次跑完都要寫低狀態，否則第一次之後就續唔到',
    /writeMonkeyLog_\(report\);\s*\n\s*writeMonkeyState_\(report\);/.test(CODE), '');
}

// =====================================================================
console.log('\n=== 三【核心】五樣絕對唔准做嘅嘢 ===');
{
  // ⚠️ 唔係靠「我記得唔好噉做」——動作清單入面根本冇嗰幾個動作。
  const actions = CODE.slice(CODE.indexOf('function monkeyActions_('),
    CODE.indexOf('function monkeyReadFacts_('));

  const forbidden = [
    ['安裝 trigger', /ScriptApp|newTrigger|installTrigger|runInstallTriggers/],
    ['改 Config', /setConfigValue_|SHEETS\.CONFIG/],
    ['改人員資料', /apiSavePerson|apiAddPerson|SHEETS\.NAME_MAPPING/],
    ['重設季度', /executeQuarterReset_|planQuarterReset_/],
    ['真正寄出（繞過 DRY_RUN）', /sendStage\(|MailApp|GmailApp/]
  ];
  forbidden.forEach(function (pair) {
    check('★★★★★★ 動作清單入面冇「' + pair[0] + '」',
      !pair[1].test(actions), '動作清單裡面找到 ' + pair[0]);
  });

  // ⚠️ 成支檔案都唔准有。清單乾淨而別處偷偷做，一樣係壞。
  check('★★★★★★ 成支檔案都冇裝 trigger／改 Config／改人員資料',
    !/newTrigger|setConfigValue_|apiSavePerson|apiAddPerson/.test(CODE), '');

  check('★★★★★★ 每 ' + '10' + ' 步重新斷言一次 `DRY_RUN`'
    + '——開跑嗰陣驗一次係唔夠嘅：一次亂行行幾分鐘，'
    + '中間有人改咗 Config，後面嗰幾十步就會真係寄信',
    /MONKEY_DRY_RUN_RECHECK_EVERY/.test(CODE)
      && /getConfig\(CONFIG_KEYS\.DRY_RUN, true\) !== true/.test(CODE), '');
  check('★★★★★★ 而且一發現就即刻 `break`，唔係記一筆繼續行',
    /DRY_RUN 已經不是 TRUE。已立刻停手。[\s\S]{0,200}break;/.test(SRC), '');

  check('★★★★★ 開跑之前行同一套閘（同自測機共用）',
    /checkSelfTestPreconditions_\(quarterId\)/.test(CODE), '');
  check('★★★★★ 只碰沙盒季度',
    /readSelfTestQuarterDetail_\(\)/.test(CODE)
      && (CODE.match(/const quarterId = quarter\.value;/g) || []).length === 1, '');
}

// =====================================================================
console.log('\n=== 四【核心】拋錯唔會被吞 ===');
{
  // ⚠️ 一個 `legal` 講得通而執行起上嚟拋錯嘅動作，
  // 就係「畫面話得，而系統話唔得」——嗰個本身就係一個發現。
  check('★★★★★★ 合法動作拋錯要記低成一項失敗',
    /kind: '合法動作拋錯'/.test(SRC), '');
  check('★★★★★★ 而且帶住走到嗰度嘅完整步驟',
    /kind: '合法動作拋錯'[\s\S]{0,200}path: path\.slice\(\)\.concat\(\[picked\.id\]\)/
      .test(SRC), '');
  check('★★★★★ 不變量算唔出都要記低，唔可以當冇事',
    /kind: '不變量算不出'/.test(SRC), '');
}

// =====================================================================
console.log('\n=== 五【核心】報告要印「走到這裡的完整步驟」 ===');
{
  const lines = gas.describeMonkeyReport_({
    blocked: false, quarterId: '2028T3', seed: 20260822,
    requestedSteps: 50, ranSteps: 4, stoppedForTime: false, steps: [],
    failures: [{ step: 4, kind: '不變量 I08.step2.recipientCount',
      detail: '會寄給這 N 位｜預期 9｜實際 3｜畫面那一支回 3；另一條路數出 9',
      path: ['生成初稿', '改 grid 幾格', '寄給堂委審閱（模擬）'] }],
    path: []
  }).join('\n');

  check('★★★★★★ 印咗完整重現路徑'
    + '——冇咗佢，紅咗都重現唔到，'
    + '而一個重現唔到嘅 bug 報告對兩個月之後嘅自己嚟講等於冇',
    /走到這裡的完整步驟：生成初稿 → 改 grid 幾格 → 寄給堂委審閱（模擬）/.test(lines),
    lines);
  check('★★★★★★ 而且印咗 seed（唔印嘅話重現唔到）',
    /隨機種子：20260822/.test(lines), lines);
  check('★★★★★ 失敗嗰條要印埋預期／實際',
    /預期 9｜實際 3/.test(lines), lines);

  const blocked = gas.describeMonkeyReport_({
    blocked: true, quarterId: '2026T4',
    reasons: ['「2026T4」在 QUARTER_RESET_BLOCKED_QUARTERS 裡面。']
  }).join('\n');
  check('★★★★★★ 被閘擋住要講明「沒有執行」'
    + '——唔講嘅話，一份空白報告睇落同「跑完，冇事」一模一樣',
    /亂行機沒有執行/.test(blocked), blocked);
}

// =====================================================================
console.log('\n=== 六 每一步都要跑一次全部不變量 ===');
{
  check('★★★★★★ 每一步跑一次 `runAllInvariants_()`'
    + '——亂行機自己冇斷言，佢全部靠不變量出力',
    /path\.push\(picked\.id\);[\s\S]{0,400}runAllInvariants_\(quarterId\)/.test(CODE), '');
  check('★★★★★ 逐步紀錄寫入 `MonkeyLog`',
    /function writeMonkeyLog_\(/.test(CODE) && /第幾步/.test(SRC), '');
  check('★★★★★ 有選單入口（兩個：開跑同續跑）',
    /runMonkeyFromMenu_/.test(read('src/Menu.gs'))
      && /runMonkeyResumeFromMenu_/.test(read('src/Menu.gs')), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
