// 第二十一輪批次階段 A：硬規則違反三分類。
// 執行方式：node tests/hard_violation_class.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住嘅係「三個工具各自把非 bug 叫做 bug」
// ─────────────────────────────────────────────────────────────────────
//
// 2026-08-17 真實環境實測，三個工具各自報咗一項睇落係 bug、其實唔係嘅違反：
//
//   • 核對職事表：「硬規則違反：1 項 ← 這是 bug」——但幹事已經打字放行過
//   • 上線前檢查：「硬規則違反：6 項」——版本生成之後先落實嘅崗位身分要求
//   • 自我測試：測試 7 未通過——版本生成之後先套用嘅申報寫入咗 Unavailable
//
// ⚠️ 呢度**特登唔測試「按版本時間過濾規則」**——嗰個做法已經否決。
// 向前看嘅檢查必須用今日嘅規則；按生成時間過濾會喺最需要示警嗰一刻
// 把真問題藏起嚟。詳見 src/HardViolationClass.gs 檔頭。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'HardViolationClass.gs'
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

const QUARTER = '2099T4';
const VERSION_MS = Date.parse('2099-08-16T21:55:00Z');

/** 造一個結構化違反項目。全部用虛構 ID／姓名。 */
function v(serviceDate, postId, slotIndex, personId, ruleId) {
  return {
    serviceDate: serviceDate, postId: postId, slotIndex: slotIndex,
    personId: personId, personName: '假甲', ruleId: ruleId,
    reason: '測試用', text: serviceDate + ' ' + postId + '#' + slotIndex + ' 假甲：測試用'
  };
}

/** 造一個乾淨 context（三類都唔命中）。 */
function baseContext(overrides) {
  return Object.assign({
    quarterId: QUARTER,
    releasedKeys: {},
    legacyReleasedKeys: {},
    unavailableCreatedAtByPerson: {},
    versionCreatedAtMs: VERSION_MS
  }, overrides || {});
}

console.log('\n=== A3【核心】第 1 類：真違反 ===');
{
  const items = [v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED)];
  const r = gas.classifyHardViolations_(items, baseContext());

  checkEqual('★★★★★ 冇放行紀錄、冇遲來申報 ⇒ 真違反 1 項', r.real.length, 1);
  checkEqual('★★★★★ needsAction = true（只有真違反先會令流程卡住）', r.needsAction, true);
  checkEqual('★★★★ 已放行 0、遲來申報 0',
    [r.released.length, r.lateUnavailable.length], [0, 0]);
  check('★★★★ 摘要講得出要處理',
    r.summary.indexOf('需要在正式發出前處理') !== -1, r.summary);
  check('★★★★★ 摘要冇「這是 bug」呢句'
    + '——原本嗰句對三類一視同仁，而其中兩類根本唔係 bug',
    r.summary.indexOf('這是 bug') === -1, r.summary);
}

console.log('\n=== A3【核心】第 2 類：已放行（新格式，完整 6 欄 key）===');
{
  const item = v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED);
  const key = gas.buildHardViolationKey_(QUARTER, item);
  const released = {}; released[key] = true;

  const r = gas.classifyHardViolations_([item], baseContext({ releasedKeys: released }));
  checkEqual('★★★★★ 有完整 key 嘅放行紀錄 ⇒ 已放行 1 項', r.released.length, 1);
  checkEqual('★★★★★ 真違反 0 ⇒ needsAction = false'
    + '（幹事已經自己決定放行，唔應該再叫佢做嘢）',
    [r.real.length, r.needsAction], [0, false]);
  check('★★★★ 摘要明確講「沒有真違反」',
    r.summary.indexOf('沒有真違反') !== -1, r.summary);
}

console.log('\n=== A5【核心】放行 key 唔完全吻合時，唔可以誤判為已放行 ===');
{
  const item = v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED);

  // 逐個欄位改一格，全部都應該對唔上
  const variants = [
    ['季度唔同', gas.buildHardViolationKey_('2099T3', item)],
    ['日期唔同', gas.buildHardViolationKey_(QUARTER, Object.assign({}, item, { serviceDate: '2099-11-15' }))],
    ['崗位唔同', gas.buildHardViolationKey_(QUARTER, Object.assign({}, item, { postId: 'CHAIR' }))],
    ['SlotIndex 唔同', gas.buildHardViolationKey_(QUARTER, Object.assign({}, item, { slotIndex: 2 }))],
    ['人唔同', gas.buildHardViolationKey_(QUARTER, Object.assign({}, item, { personId: 'P9002' }))],
    ['規則唔同', gas.buildHardViolationKey_(QUARTER, Object.assign({}, item, { ruleId: gas.RULE_IDS.UNAVAILABLE }))]
  ];

  variants.forEach(function (pair) {
    const released = {}; released[pair[1]] = true;
    const r = gas.classifyHardViolations_([item], baseContext({ releasedKeys: released }));
    checkEqual('★★★★★ 只有「' + pair[0] + '」⇒ 仍然係真違反，唔可以當成已放行'
      + '（放行係逐格逐項嘅決定，唔可以溢出到其他格）',
      [r.real.length, r.released.length], [1, 0]);
  });
}

console.log('\n=== A3：第 3 類：版本生成後才新增的申報 ===');
{
  const item = v('2099-11-15', 'PIANO', 1, 'P9016', gas.RULE_IDS.UNAVAILABLE);
  const late = {};
  // 申報時間晚過版本生成時間
  late['P9016|2099-11-15'] = Date.parse('2099-08-17T04:41:00Z');

  const r = gas.classifyHardViolations_([item],
    baseContext({ unavailableCreatedAtByPerson: late }));

  checkEqual('★★★★★ 申報晚過版本 ⇒ 第 3 類，唔算真違反'
    + '（嗰個版本喺生成當日完全合規，係被後來新增嘅資料追溯判定）',
    [r.lateUnavailable.length, r.real.length], [1, 0]);
  checkEqual('★★★★★ needsAction = false', r.needsAction, false);
  check('★★★★ 分類理由講得出兩個時間',
    r.lateUnavailable[0].classNote.indexOf('版本生成之後才新增') !== -1,
    r.lateUnavailable[0].classNote);
}

console.log('\n=== A4【核心】第 3 類嘅誠實界線 ===');
{
  const item = v('2099-11-15', 'PIANO', 1, 'P9016', gas.RULE_IDS.UNAVAILABLE);

  // 界線一：申報**早過**版本 ⇒ 真違反（本來就存在嘅問題）
  const early = {}; early['P9016|2099-11-15'] = Date.parse('2099-08-10T00:00:00Z');
  checkEqual('★★★★★ 申報早過版本 ⇒ 真違反（呢個問題生成嗰陣就已經存在）',
    gas.classifyHardViolations_([item],
      baseContext({ unavailableCreatedAtByPerson: early })).real.length, 1);

  // 界線二：冇版本時間 ⇒ 判斷唔到，一律真違反（唔可以靠估）
  const late = {}; late['P9016|2099-11-15'] = Date.parse('2099-08-17T04:41:00Z');
  checkEqual('★★★★★ 讀唔到版本生成時間 ⇒ 判斷唔到，維持真違反'
    + '（唔可以因為「可能係遲來申報」就當佢冇事）',
    gas.classifyHardViolations_([item], baseContext({
      unavailableCreatedAtByPerson: late, versionCreatedAtMs: null
    })).real.length, 1);

  // 界線三：冇申報時間 ⇒ 同上
  checkEqual('★★★★ 讀唔到申報建立時間 ⇒ 維持真違反',
    gas.classifyHardViolations_([item], baseContext()).real.length, 1);

  // ★ 界線四（最重要）：規則類違反**永遠唔可以**歸入第 3 類
  const roleItem = v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED);
  const anyTime = {}; anyTime['P9001|2099-11-08'] = Date.parse('2099-12-31T00:00:00Z');
  checkEqual('★★★★★ `Posts.RequiredRoles` 冇時間戳 ⇒ 規則類違反永遠係真違反'
    + '——唔可以為「規則定義幾時改」發明啟發式判斷。'
    + '呢啲項目會喺重新生成嗰陣自然消失，嗰個先係正確嘅解法',
    gas.classifyHardViolations_([roleItem], baseContext({
      unavailableCreatedAtByPerson: anyTime
    })).real.length, 1);
}

console.log('\n=== A6：三類混合 ===');
{
  const realItem = v('2099-11-01', 'CHAIR', 1, 'P9003', gas.RULE_IDS.ELIGIBILITY);
  const releasedItem = v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED);
  const lateItem = v('2099-11-15', 'PIANO', 1, 'P9016', gas.RULE_IDS.UNAVAILABLE);

  const released = {};
  released[gas.buildHardViolationKey_(QUARTER, releasedItem)] = true;
  const late = {};
  late['P9016|2099-11-15'] = Date.parse('2099-08-17T04:41:00Z');

  const r = gas.classifyHardViolations_([realItem, releasedItem, lateItem],
    baseContext({ releasedKeys: released, unavailableCreatedAtByPerson: late }));

  checkEqual('★★★★★ 三類各 1 項',
    [r.real.length, r.released.length, r.lateUnavailable.length], [1, 1, 1]);
  checkEqual('★★★★★ needsAction 只由真違反決定', r.needsAction, true);
  checkEqual('★★★★★ 摘要三類都列出',
    r.summary.split('\n')[0],
    '硬規則違反：3 項（真違反 1、已放行 1、版本生成後才新增的申報 1）');
  check('★★★★ 每項都有中文分類標籤（報告要逐項標示）',
    r.items.every(function (i) { return !!i.classLabel; }));
}

console.log('\n=== A5：舊格式放行紀錄（相容層，界線要講清楚）===');
{
  const item = v('2099-11-08', 'ANNOUNCE', 1, 'P9001', gas.RULE_IDS.ROLE_REQUIRED);
  const legacy = {}; legacy['2099-11-08|' + gas.RULE_IDS.ROLE_REQUIRED] = true;

  const r = gas.classifyHardViolations_([item], baseContext({ legacyReleasedKeys: legacy }));
  checkEqual('★★★★★ 舊格式紀錄（只有日期＋規則）一樣認得返'
    + '——否則幹事之前做過嘅放行等於白做',
    r.released.length, 1);
  check('★★★★ 分類理由明確標示係舊格式',
    r.released[0].classNote.indexOf('舊格式') !== -1, r.released[0].classNote);

  // 誠實記錄相容層嘅代價
  const other = v('2099-11-08', 'DEACON', 1, 'P9009', gas.RULE_IDS.ROLE_REQUIRED);
  checkEqual('★★★★ 已知代價：同日同規則、唔同崗位嘅另一項都會當成已放行'
    + '（舊紀錄冇 PersonID、崗位可能係中文名，資訊不足。新格式冇呢個問題）',
    gas.classifyHardViolations_([other], baseContext({ legacyReleasedKeys: legacy }))
      .released.length, 1);
}

console.log('\n=== A5：context 缺欄位一定要拋錯 ===');
{
  ['quarterId', 'releasedKeys', 'legacyReleasedKeys',
    'unavailableCreatedAtByPerson', 'versionCreatedAtMs'].forEach(function (field) {
    const broken = baseContext();
    delete broken[field];
    let threw = null;
    try { gas.classifyHardViolations_([], broken); } catch (e) { threw = e; }
    check('★★★★★ 缺 `' + field + '` 會拋錯，唔會靜默預設'
      + '（靜默預設嘅後果係「所有已放行項目變返真違反」，'
      + '而報告會照樣言之鑿鑿咁列出嚟）',
      threw !== null);
  });

  let msg = '';
  try {
    const broken = baseContext(); delete broken.releasedKeys;
    gas.classifyHardViolations_([], broken);
  } catch (e) { msg = e.message; }
  check('★★★★ 錯誤訊息講得出後果', msg.indexOf('已放行的項目都會被當成真違反') !== -1, msg);
  check('★★★★ 錯誤訊息講得出點修', msg.indexOf('buildHardViolationClassContext_') !== -1);
}

console.log('\n=== A5：零違反同摘要 ===');
{
  const r = gas.classifyHardViolations_([], baseContext());
  checkEqual('★★★★ 冇違反 ⇒ needsAction = false', r.needsAction, false);
  checkEqual('★★★★ 摘要係原本嗰句（冇違反時唔改語氣）',
    r.summary, '硬規則違反：0 項 ✓');
}

console.log('\n=== A5：全專案唔可以再有「這是 bug」呢句 ===');
{
  const fs = require('fs');
  const path = require('path');
  const srcDir = path.join(__dirname, '..', 'src');
  const hits = [];
  fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); }).forEach(function (f) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    text.split('\n').forEach(function (line, i) {
      // 註解入面講返呢段歷史係可以嘅，只擋輸出字串
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (line.indexOf('這是 bug') !== -1) hits.push(f + ':' + (i + 1));
    });
  });
  checkEqual('★★★★★ 輸出字串入面冇「這是 bug」'
    + '——三類項目入面有兩類根本唔係 bug，'
    + '一句講錯嘅結論比冇結論更差', hits, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
