// 第四十七輪批次 D 組：所有合堂主日，五個崗位唔自動排。
// 執行方式：node tests/combined_skip_posts.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 合堂主日嗰日，主席／講員／傳譯／領詩／司琴呢五個崗位唔應該由本堂排——
// 合堂係另一堂帶領。而家系統照排，幹事每次都要人手清走。
//
// 成因唔係排表邏輯錯：`buildGeneratorContext_()` 讀 `SkipPostIDs` 讀得啱。
// 係**張表上面根本冇填**。而「產生年度合堂建議」嗰支工具，
// 確認畫面直頭明文寫住：
//
//   「⚠️ 跳過崗位（SkipPostIDs）與外部負責單位（ExternalOwner）一律留空，
//     需要你自己按每一次合堂的實際安排填寫」
//
// 即係：系統知道合堂要跳崗位，而每一次都靠幹事記得人手填。
// 呢個唔係「幹事做漏咗」，係**系統把一件每次都一樣嘅嘢交咗畀人手做**。
//
// ─────────────────────────────────────────────────────────────────────
// 呢一份守嘅係
// ─────────────────────────────────────────────────────────────────────
//
//   D1　有一個 Config 鍵講明「合堂預設跳邊幾個崗位」
//   D2　`isCombinedSpecialSunday_()` 認得出邊一行係合堂
//   D3　補填工具：先算後做、唔覆寫已填、唔碰 Active=FALSE、寫 AuditLog
//   D4　年度合堂工具**新寫入嗰幾行**會帶住預設值
//
// ⚠️ 保護季度**唔可以**重用 `REHEARSAL_PROTECTED_QUARTERS`。
// 嗰一個守嘅係「全季流程演練唔可以碰邊幾季」，同呢一支要守嘅
// 「補填工具唔可以改邊幾季嘅資料」係兩件事。
// 共用一格嘅話，日後改其中一邊就會靜靜改咗另一邊。

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
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'SeasonRehearsal.gs', 'CombinedSkipBackfill.gs'
]);

// =====================================================================
console.log('\n=== D1【核心】Config 鍵：合堂預設跳邊幾個崗位 ===');
{
  check('★★★★★★ 有 `COMBINED_DEFAULT_SKIP_POST_IDS`'
    + '——冇嘅話，「合堂要跳邊五個崗位」呢件每次都一樣嘅嘢，'
    + '就永遠要靠幹事逐次記得人手填',
    !!gas.CONFIG_KEYS.COMBINED_DEFAULT_SKIP_POST_IDS,
    JSON.stringify(Object.keys(gas.CONFIG_KEYS).filter(function (k) {
      return /COMBINED/.test(k);
    })));

  checkEqual('★★★★★★ 內建預設係五個崗位',
    gas.COMBINED_DEFAULT_SKIP_POST_IDS_DEFAULT,
    'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO');

  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ `ConfigSeed.gs` 有落種，而且係 LIST 型',
    /COMBINED_DEFAULT_SKIP_POST_IDS[\s\S]{0,120}CONFIG_TYPES\.LIST/.test(seed), '');

  // ⚠️ 保護季度要**另開一格**。
  check('★★★★★★ 有一個**獨立**嘅保護季度鍵，'
    + '唔係重用 `REHEARSAL_PROTECTED_QUARTERS`'
    + '——兩件唔同嘅事共用一格，日後改一邊就會靜靜改咗另一邊',
    !!gas.CONFIG_KEYS.COMBINED_BACKFILL_BLOCKED_QUARTERS
      && gas.CONFIG_KEYS.COMBINED_BACKFILL_BLOCKED_QUARTERS
        !== gas.CONFIG_KEYS.REHEARSAL_PROTECTED_QUARTERS,
    String(gas.CONFIG_KEYS.COMBINED_BACKFILL_BLOCKED_QUARTERS));

  checkEqual('★★★★★ 保護季度內建預設係 `2026T4`',
    gas.COMBINED_BACKFILL_BLOCKED_DEFAULT, '2026T4');

  // 空白唔可以變成「乜都唔保護」——同 `readRehearsalProtectedQuarters_()` 一樣。
  check('★★★★★★ Config 填成空白 ⇒ **仍然退回內建預設**，'
    + '唔會變成「乜都唔保護」'
    + '——一格打空咗就冧晒保護，係最易誤觸嗰種',
    /raw === ''/.test(read('src/CombinedSkipBackfill.gs')), '');
}

// =====================================================================
console.log('\n=== D2【核心】認得出邊一行係合堂 ===');
{
  const C = gas.COLUMNS.SPECIAL_SUNDAYS;
  const row = function (type, title) {
    const out = {};
    out[C.TYPE] = type;
    out[C.TITLE] = title || '';
    return out;
  };

  check('★★★★★ Type 有「合堂」兩隻字 ⇒ 係',
    gas.isCombinedSpecialSunday_(row('合堂', '')), '');
  check('★★★★★ Type 係「聯合堂慶合堂」噉樣包住都算 ⇒ 係',
    gas.isCombinedSpecialSunday_(row('堂慶合堂', '')), '');
  check('★★★★★ Type 係 `COMBINED` ⇒ 係',
    gas.isCombinedSpecialSunday_(row('COMBINED', '')), '');
  check('★★★★★ 大細楷唔理：`combined` ⇒ 係',
    gas.isCombinedSpecialSunday_(row('combined', '')), '');
  check('★★★★★ 前後有空白都認得',
    gas.isCombinedSpecialSunday_(row('  合堂  ', '')), '');
  check('★★★★★★ Title 講「合堂」而 Type 唔係 ⇒ **都算**'
    + '——幹事實際上兩格都會噉寫，只認一格就會靜靜漏咗一半',
    gas.isCombinedSpecialSunday_(row('特別主日', '五月合堂（日期待確認）')), '');
  check('★★★★★★ 浸禮主日 ⇒ **唔係**'
    + '——認得太闊就會喺唔應該跳嘅日子跳咗五個崗位，'
    + '而嗰一日係真係要排人嘅',
    !gas.isCombinedSpecialSunday_(row('浸禮', '四月浸禮主日')), '');
  check('★★★★★ 兩格都空 ⇒ 唔係',
    !gas.isCombinedSpecialSunday_(row('', '')), '');
}

// =====================================================================
console.log('\n=== D3【核心】補填工具：先算後做，唔覆寫幹事親手填嘅嘢 ===');
{
  const src = read('src/CombinedSkipBackfill.gs');

  check('★★★★★ 有 `planCombinedSkipBackfill_()`（純讀取）',
    /function planCombinedSkipBackfill_\(/.test(src), '');
  check('★★★★★ 有 `executeCombinedSkipBackfill_(plan)`',
    /function executeCombinedSkipBackfill_\(/.test(src), '');
  check('★★★★★ 有選單入口 `runCombinedSkipBackfill_()`',
    /function runCombinedSkipBackfill_\(/.test(src), '');
  check('★★★★★ 選單有「補填合堂跳過崗位」',
    /補填合堂跳過崗位/.test(read('src/Menu.gs')), '');
  check('★★★★★ 有寫 `AuditLog`', /writeAuditLog_\(/.test(src), '');

  // ── 真係行一次 plan，睇佢點分類 ──────────────────────────────
  const C = gas.COLUMNS.SPECIAL_SUNDAYS;
  const mk = function (id, quarterId, type, skip, active) {
    const out = {};
    out[C.SPECIAL_ID] = id;
    out[C.QUARTER_ID] = quarterId;
    out[C.SERVICE_DATE] = '2027-05-23';
    out[C.TYPE] = type;
    out[C.TITLE] = '';
    out[C.SKIP_POST_IDS] = skip;
    out[C.ACTIVE] = active;
    return out;
  };

  const rows = [
    mk('A', '2027T2', '合堂', '', 'TRUE'),              // 要補
    mk('B', '2027T2', '合堂', 'CHAIR', 'TRUE'),          // 已填 ⇒ 唔郁
    mk('C', '2027T2', '合堂', '', 'FALSE'),              // Active=FALSE ⇒ 唔郁
    mk('D', '2027T2', '浸禮', '', 'TRUE'),               // 唔係合堂 ⇒ 唔郁
    mk('E', '2026T4', '合堂', '', 'TRUE')                // 保護季度 ⇒ 唔郁
  ];

  const plan = gas.classifyCombinedSkipRows_(rows, 'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO', ['2026T4']);

  const ids = function (list) {
    return list.map(function (i) { return i.specialId; }).sort().join(',');
  };

  checkEqual('★★★★★★ 只有「合堂 ＋ 未填 ＋ Active ＋ 唔受保護」嗰一行會補', ids(plan.willFill), 'A');
  checkEqual('★★★★★★ 已經填咗嘅**唔覆寫**'
    + '——系統改壞幹事親手做嘅決定，比排錯更差', ids(plan.alreadyFilled), 'B');
  checkEqual('★★★★★ Active=FALSE 唔郁（範例列就係噉）', ids(plan.inactive), 'C');
  checkEqual('★★★★★ 唔係合堂嘅唔郁', ids(plan.notCombined), 'D');
  checkEqual('★★★★★★ 受保護季度唔郁'
    + '——2026T4 係正式上線嗰一季，一格都唔准改', ids(plan.blocked), 'E');

  checkEqual('★★★★★ 要補嗰一行，補落去嘅值就係 Config 嗰五個',
    plan.willFill[0].newValue, 'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO');

  // ⚠️ 空清單 ⇒ **一行都唔補**，唔係「當成冇設定所以全部照補」。
  const emptyPlan = gas.classifyCombinedSkipRows_(rows, '', ['2026T4']);
  checkEqual('★★★★★★ Config 揀成空白 ⇒ **一行都唔補**'
    + '——當成「冇設定所以照用內建」會令幹事特登清空嗰個決定被推翻',
    emptyPlan.willFill.length, 0);
}

// =====================================================================
console.log('\n=== D4【核心】年度合堂工具新寫入嗰幾行要帶住預設值 ===');
{
  const src = read('src/AnnualCombined.gs');
  check('★★★★★★ `writeAnnualCombinedSundays_()` 會寫 `SKIP_POST_IDS`'
    + '——唔寫嘅話，今日補完，出年產生 2028 年嘅四次合堂又再一次全部留空',
    /setCell\(C\.SKIP_POST_IDS/.test(src), '');
  check('★★★★★★ 而且確認畫面嗰句「一律留空」要改咗'
    + '——寫住「一律留空」而實際會填，就係另一個「畫面講一件事、'
    + '系統做另一件事」',
    !/跳過崗位（SkipPostIDs）與外部負責單位（ExternalOwner）一律留空/.test(src),
    '仲寫住「一律留空」');
  check('★★★★★ 而且講得出實際會填邊幾個崗位',
    /會先填上/.test(src), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
