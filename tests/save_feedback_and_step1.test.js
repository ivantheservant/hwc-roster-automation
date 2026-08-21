// 第四十二輪批次 C／D／E 組：第 1 步挑季度、儲存回饋逐格、三處文案。
// FIXTURE-OK: 純函式同靜態掃描；`diffVersionAssignments_` 嗰段由
// `seedSheet()` 種一份 `RosterAssignments`，而嗰個表本來就係系統寫入嘅形狀
//（欄位由 `COLUMNS.ROSTER_ASSIGNMENTS` 攞，唔係手抄欄名）。
// 執行方式：node tests/save_feedback_and_step1.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// ── C 組：第 1 步指錯季度、撳唔到（blocker）──────────────────────
//
// 2026-08-21 現場：粒掣寫住「生成 2026 年 10-12 月職事表」，**灰色**，
// 而下面同時講「已經生成過了」同「生成日期係 2026-08-30，仲有 9 天」。
// 結果係幹事**永遠測唔到第 1 步**，而嗰個係佢每季第一件做嘅事。
//
// ── D 組：儲存回饋只講格數 ──────────────────────────────────────
//
// 「已經接受建議，儲存成第 10 版（2 格改動）」——一個數字證明唔到
// 系統動嗰兩格就係佢改嗰兩格。
//
// ── E 組：三處文案 ─────────────────────────────────────────────
//
// 頁頂仍然寫住「六步」（實際五步）、「發生了什麼」呢個機器標記漏咗出嚟、
// 零改動嗰陣兩句自相矛盾。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'FineTune.gs', 'RosterWriter.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const ROOT = path.join(__dirname, '..');
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
const bare = function (s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
};

const flowGs = read('src/WebAppMainFlow.gs');
const flowUi = read('src/ui/ScriptMainFlow.html');
const indexUi = read('src/ui/Index.html');
const scriptUi = read('src/ui/Script.html');
const zone1Ui = read('src/ui/ScriptZone1.html');
const suggestUi = read('src/ui/ScriptSuggestion.html');
const suggestGs = read('src/SuggestionSheet.gs');
const saveGs = read('src/WebAppSaveConfirm.gs');
const seedGs = read('src/ConfigSeed.gs');

// =====================================================================
console.log('\n=== C【核心】揀季度嘅規則 ===');
{
  const src = bare(flowGs);
  const at = src.indexOf('function resolveGenerateTargetQuarter_');
  const body = src.slice(at, src.indexOf('\n}', at));

  check('★★★★★ 「由今日起計」＝ 未完全過去（`endDate >= today`）'
    + '——舊規則揀「開始日期最早而又未生成」，會指去一個兩年前嘅季度',
    /const upcoming = ungenerated\.filter/.test(body)
      && /!q\.endDate \|\| q\.endDate >= today/.test(body), body.slice(0, 800));
  check('★★★★★ `endDate` 空白**唔算**已經過去'
    + '——剔走佢就會令一個資料填漏嘅季度靜靜噉永遠揀唔到',
    /!q\.endDate \|\|/.test(body), '');
  check('★★★★★ 只剩下已經過去而又未生成嗰啲 ⇒ 照樣指得到，唔係死路'
    + '（補一個漏咗嘅舊季度係真實會發生嘅事）',
    /\} else if \(ungenerated\.length > 0\) \{/.test(body), body.slice(0, 1200));
  check('★★★★★ 全部生成過先至 `allGenerated = true`',
    /allGenerated = true;/.test(body), '');
  check('★★★★★ 而且嗰種情況**唔會再算任何日期警告**'
    + '——「已經全部生成過」同「仲有 9 天到生成日期」擺埋一齊，'
    + '幹事讀出嚟只會覺得系統壞咗',
    /if \(allGenerated\) \{[\s\S]{0,600}GENERATE_TARGET_WARN_ALL_GENERATED/.test(body),
    body.slice(body.indexOf('let warn'), body.indexOf('let warn') + 500));
  check('★★★★★ 而且嗰個分支排喺其餘幾個日期判斷**之前**',
    body.indexOf('if (allGenerated)') !== -1
      && body.indexOf('if (allGenerated)') < body.indexOf('GENERATE_TARGET_WARN_PAST'), '');
}

console.log('\n=== C：掣旁邊要顯示嘅嘢 ===');
{
  const src = bare(flowGs);
  check('★★★★★ 回傳有「而家有幾多個版本」',
    /versionCount: target\.versionNo >= 0 \? target\.versionNo \+ 1 : 0/.test(src), '');
  check('★★★★ 畫面真係印咗出嚟',
    /現時有 ' \+ \(t\.versionCount \|\| 0\) \+ ' 個版本/.test(bare(flowUi)), '');
  check('★★★★ 生成日期同距離幾多日仍然喺度',
    /生成日期：' \+ t\.generateOn/.test(bare(flowUi)), '');
}

console.log('\n=== C【核心】真正要上線嗰一季，撳之前要額外講一句 ===');
{
  check('★★★★★ 由 Config 決定邊一季，**唔可以寫死**'
    + '（嗰個係教會嘅資料，而且每年都唔同）',
    /GO_LIVE_QUARTER_ID: 'GO_LIVE_QUARTER_ID'/.test(read('src/Constants.gs')), '');
  check('★★★★★ `ConfigSeed.gs` 有對應嗰一行'
    + '——第三十三輪嘅教訓：`CONFIG_KEYS` 有而 seed 冇，'
    + '「補建 Config 參數」就永遠建唔出佢',
    /key: CONFIG_KEYS\.GO_LIVE_QUARTER_ID/.test(seedGs), '');
  checkEqual('★★★★★ 預設留空 ⇒ 完全唔會出現嗰一句（行為同今日一樣）',
    gas.DEFAULTS.GO_LIVE_QUARTER_ID, '');
  check('★★★★★ 後端算出 `isGoLiveQuarter`，而且留空嗰陣一定係 false',
    /goLiveQuarterId !== '' && goLiveQuarterId === target\.quarterId/.test(bare(flowGs)), '');
  check('★★★★★ 畫面真係會彈一個確認',
    /t\.isGoLiveQuarter/.test(bare(flowUi))
      && /這一季是實際要上線的季度/.test(flowUi), '');
}

// =====================================================================
console.log('\n=== D【核心】兩個版本之間逐格邊個變成邊個 ===');
{
  const ss = new RealisticMockSpreadsheet();
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
  gas.Utilities = {
    formatDate: function (date, tz) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
    }
  };
  gas.CacheService = {
    getScriptCache: function () {
      return { get: function () { return null; }, put: function () {}, remove: function () {} };
    }
  };
  gas.log_ = function () {};

  const C = gas.COLUMNS;
  const S = gas.SHEETS;
  const A = C.ROSTER_ASSIGNMENTS;
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
    { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: 'Pacific/Auckland',
      [C.CONFIG.TYPE]: 'STR' }]);

  const row = function (v, date, post, name) {
    return {
      [A.QUARTER_ID]: '2099T9', [A.VERSION_NO]: v, [A.SERVICE_DATE]: date,
      [A.POST_ID]: post, [A.SLOT_INDEX]: 1, [A.PERSON_NAME_SNAPSHOT]: name
    };
  };
  seedSheet(ss, S.ROSTER_ASSIGNMENTS, ['RA'],
    Object.keys(A).map(function (k) { return A[k]; }), [
      row(1, '2099-07-05', 'CHAIR', '測甲'),
      row(1, '2099-07-05', 'READ', '測乙'),
      row(1, '2099-07-12', 'CHAIR', '測丙'),
      row(2, '2099-07-05', 'CHAIR', '測甲'),
      row(2, '2099-07-05', 'READ', '測丁'),
      row(2, '2099-07-12', 'CHAIR', ''),
      // ⚠️ 一格**只喺新版本存在**（舊版本連呢一行都冇）。
      // 呢個 case 專門守住「只行其中一邊嘅 key」嗰個 bug：
      // 只行舊版本嗰邊嘅話，呢一格會靜靜漏咗。
      row(2, '2099-07-19', 'CHAIR', '測戊')
    ]);

  const diff = gas.diffVersionAssignments_('2099T9', 1, 2);
  checkEqual('★★★★★ 只列出真係變咗嗰幾格（冇變嗰格唔可以出現），'
    + '而且**新版本先有嗰格都要出現**',
    diff.map(function (d) { return d.postId + '@' + d.serviceDate; }),
    ['READ@2099-07-05', 'CHAIR@2099-07-12', 'CHAIR@2099-07-19']);
  checkEqual('★★★★★ 而且講得出由邊個變成邊個',
    diff.map(function (d) { return d.fromName + '→' + d.toName; }),
    ['測乙→測丁', '測丙→', '→測戊']);

  // ⚠️ 一格由「有人」變成「冇人」都係一個改動。只行其中一邊嘅 key
  // 就會靜靜漏咗一半。
  const back = gas.diffVersionAssignments_('2099T9', 2, 1);
  checkEqual('★★★★★ 反方向一樣數得到（空白 → 有人 都算）', back.length, 3);
  checkEqual('★★★★ 冇分別嘅兩版 ⇒ 空陣列',
    gas.diffVersionAssignments_('2099T9', 1, 1), []);
}

console.log('\n=== D【核心】逐格清單三個出口共用一個產生器 ===');
{
  const rows = gas.buildSavedChangeRows_([
    { serviceDate: '2099-07-05', postId: 'CHAIR', slotIndex: 1, fromName: '', toName: '測甲' }
  ], { CHAIR: '主席' }, 'REQUEST');
  checkEqual('★★★★★ 崗位寫中文名（幹事腦入面冇 `CHAIR` 呢個概念）',
    rows[0].postNameTC, '主席');
  checkEqual('★★★★★ 空白要講得出係空白（印一個空字串，佢會以為自己睇漏）',
    rows[0].fromName, '（空白）');
  checkEqual('★★★★★ 來源要帶住（申報帶嚟嗰啲要標出嚟）', rows[0].source, 'REQUEST');
  checkEqual('★★★★ 查唔到中文名就照印 postId，唔可以印空白',
    gas.buildSavedChangeRows_(
      [{ serviceDate: 'd', postId: 'XX', slotIndex: 1, fromName: 'a', toName: 'b' }], {})[0]
      .postNameTC, 'XX');
  checkEqual('★★★★ 冇傳 source ⇒ 當成幹事自己改',
    gas.buildSavedChangeRows_(
      [{ serviceDate: 'd', postId: 'XX', slotIndex: 1, fromName: 'a', toName: 'b' }], {})[0]
      .source, 'MANUAL');
}

console.log('\n=== D【核心】同一格兩邊都有 ⇒ 幹事嗰批贏 ===');
{
  // ⚠️ 呢個要同實際行為一致。第四十輪定咗規矩：幹事已經親手改過嗰啲格，
  // 申報唔套用（`plan.overlaps`）。顯示次序唔一致嘅話，
  // 畫面會講一件事而系統做另一件事。
  const manual = [{ serviceDate: 'd1', postId: 'P', slotIndex: 1, source: 'MANUAL', toName: '甲' }];
  const req = [
    { serviceDate: 'd1', postId: 'P', slotIndex: 1, source: 'REQUEST', toName: '乙' },
    { serviceDate: 'd2', postId: 'P', slotIndex: 1, source: 'REQUEST', toName: '丙' }
  ];
  const merged = gas.mergeSavedChangeRows_(manual, req);
  checkEqual('★★★★★ 同一格只出現一次，而且係幹事嗰個',
    merged.filter(function (r) { return r.serviceDate === 'd1'; })
      .map(function (r) { return r.source + ':' + r.toName; }), ['MANUAL:甲']);
  checkEqual('★★★★★ 申報獨有嗰格照樣列出嚟', merged.length, 2);
  checkEqual('★★★★ 傳空／undefined 唔會炸', gas.mergeSavedChangeRows_(null, null), []);
}

console.log('\n=== D：三個出口都真係接咗上去 ===');
{
  check('★★★★★ 〔儲存我的修改〕（連套用申報嗰條）',
    /savedChanges: buildSavedChangeRowsForSave_\(/.test(bare(saveGs)), '');
  check('★★★★★ 而且申報帶嚟嗰幾格真係由比對兩個版本讀出嚟'
    + '——`resolved.changes` 只有幹事親手改嗰批，'
    + '而申報動嘅格數往往比佢自己改嘅多',
    /diffVersionAssignments_\(quarterId, baseVersionNo, newVersionNo\)/.test(bare(saveGs)), '');
  check('★★★★★ 比對失敗唔可以令整個儲存變成失敗（版本已經寫好咗）',
    /catch \(err\) \{[\s\S]{0,300}return manual;/.test(bare(saveGs)), '');
  check('★★★★★ 〔接受這個建議版本〕',
    /savedChanges: buildSavedChangeRows_\(/.test(bare(suggestGs)), '');
  check('★★★★★ 畫面兩邊都用返同一個共用元件 `savedChangeNodes()`',
    /savedChangeNodes\(result\.savedChanges, result\.cellCount\)/.test(bare(zone1Ui))
      && /savedChangeNodes\(r\.savedChanges, r\.cellCount\)/.test(bare(suggestUi)), '');
  check('★★★★★ 超過 10 格要講明仲有幾多格（靜靜截斷 ⇒ 佢以為只動咗十格）',
    /另有 ' \+ \(list\.length - SAVED_CHANGE_ROW_LIMIT_UI\)/.test(bare(scriptUi)), '');
  check('★★★★★ 申報帶嚟嗰啲要標「（來自修改申報）」'
    + '——唔標嘅話，幹事會以為嗰幾格係佢自己改嘅，然後去搵一個唔存在嘅記憶',
    /c\.source === 'REQUEST' \? '（來自修改申報）'/.test(bare(scriptUi)), '');
  check('★★★★ 攞唔到明細都要講返個數，唔可以乜都唔講',
    /fallbackCount > 0/.test(bare(scriptUi)), '');
}

// =====================================================================
console.log('\n=== E【核心】頁頂嗰個「幾多步」由實際步數算出嚟 ===');
{
  check('★★★★★ `Index.html` 冇再寫死「六步」',
    !/由上而下做，六步/.test(indexUi), '');
  check('★★★★★ 而且個位留咗俾 JS 填',
    /id="flowHeadSub"/.test(indexUi), '');
  check('★★★★★ JS 由 `steps.length` 算，唔係另一個寫死嘅數字'
    + '——寫死一個數字 ＝ 又一個「兩個真相來源」，'
    + '而第四十一輪由六步減成五步之後，嗰句足足一輪冇人發現',
    /cnNumber\(steps\.length\)/.test(bare(flowUi)), '');
  check('★★★★★ 而且每一步都真係經過 `steps` 呢個陣列'
    + '（有人繞過去直接 appendChild 嘅話，個數字就會又一次唔啱）',
    /steps\.forEach\(\(node\) => root\.appendChild\(node\)\)/.test(bare(flowUi))
      && !/root\.appendChild\(renderStep/.test(bare(flowUi)), '');
  checkEqual('★★★★ 中文數字轉換：5 ⇒ 五',
    (bare(flowUi).match(/const digits = \[[^\]]*\]/) || [''])[0].indexOf('五') !== -1, true);
}

console.log('\n=== E【核心】「發生了什麼」呢個機器標記唔可以漏出畫面 ===');
{
  check('★★★★★ 步卡嗰一句會剝走個標記'
    + '——嗰句講嘅係「呢一季仲未到生成日期」，根本冇嘢發生過',
    /replace\(\/\^發生了什麼：\\s\*\/, ''\)/.test(bare(flowUi)), '');
  check('★★★★★ 確認畫面唔再直接 `para(rawMessage)`',
    !/para\(t\.warnMessage\)/.test(bare(flowUi))
      && /threePartNodes\(t\.warnMessage\)/.test(bare(flowUi)), '');
  check('★★★★★ 而 `threePartNodes()` 拆唔到三段就照原文顯示'
    + '（扮到有三段會令人以為系統識得分析，而其實冇）',
    /if \(!parsed\) return \[para\(String\(text \|\| ''\)\)\];/.test(bare(scriptUi)), '');
  check('★★★★★ 後端嗰個機器標記**冇改**（顯示同機器格式係兩回事）',
    /return '發生了什麼：' \+ whatHappened/.test(read('src/WebAppGuards.gs')), '');
}

console.log('\n=== E【核心】零改動嗰陣文案唔可以自相矛盾 ===');
{
  check('★★★★★ 零改動 ⇒ 只講「你還沒有改過任何一格」，'
    + '**唔可以講「可以儲存」**（根本冇嘢可以儲存）',
    /const noChange = r\.changes\.length === 0;/.test(bare(suggestUi))
      && /noChange\s*\n?\s*\? '你還沒有改過任何一格。'/.test(bare(suggestUi)), '');
  check('★★★★★ 而且同一句唔會喺同一個畫面出現兩次'
    + '（讀落好似系統講咗兩件唔同嘅事）',
    (suggestUi.match(/'你還沒有改過任何一格。'/g) || []).length === 1, '');
  check('★★★★ 零改動嗰陣改為講返「噉點做」',
    /去〔查看／修改職事表〕在表上改/.test(suggestUi), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
