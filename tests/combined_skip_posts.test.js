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
  // ⚠️ 剝走註釋先數——理由同 `quarter_reset_batch.test.js` 嗰一條一樣。
  const backfillCode = read('src/CombinedSkipBackfill.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ Config 填成空白 ⇒ **仍然退回內建預設**，'
    + '唔會變成「乜都唔保護」'
    + '——一格打空咗就冧晒保護，係最易誤觸嗰種',
    /raw === ''/.test(backfillCode), '');
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

// =====================================================================
console.log('\n=== 第四十八輪批次 C 組【核心】受保護季度要**排第一** ===');
{
  // ═══════════════════════════════════════════════════════════════
  // 一道從來冇響過嘅警報，同冇裝過係一樣嘅
  // ═══════════════════════════════════════════════════════════════
  //
  // 修正前，確認畫面寫住：
  //
  //     不會動的:
  //     　・已經填了值：1 行（不覆寫你填的東西）
  //     　・Active=FALSE：1 行
  //     　・不是合堂：1 行
  //     　・受保護季度（2026T4）：0 行
  //
  // 而真實資料入面，`SP-2026-02` 就係 `2026T4` 嘅合堂列
  // （`SkipPostIDs=WORSHIP,PIANO`）。佢**應該**被「受保護季度」擋住，
  // 但佢先被「已經填了值」接走咗，所以受保護季度嗰一項報 0。
  //
  // 即係：**2026T4 嘅保護由寫出嚟到而家，一次都冇真正行過。**
  //
  // ⚠️ 呢個唔止係一個數字錯。一個永遠報 0 嘅保護計數，
  // 睇上去同「冇嘢需要保護」一模一樣——所以冇人會去問佢到底有冇跑過。
  const C = gas.COLUMNS.SPECIAL_SUNDAYS;
  const mk = function (id, quarterId, type, skip, active) {
    const out = {};
    out[C.SPECIAL_ID] = id;
    out[C.QUARTER_ID] = quarterId;
    out[C.SERVICE_DATE] = '2026-10-04';
    out[C.TYPE] = type;
    out[C.TITLE] = '';
    out[C.SKIP_POST_IDS] = skip;
    out[C.ACTIVE] = active;
    return out;
  };
  const DEFAULT_SKIP = 'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO';
  const ids = function (list) {
    return list.map(function (i) { return i.specialId; }).sort().join(',');
  };

  // ── C2　保護真係擋得住 ────────────────────────────────────────
  //
  // ⚠️ 呢一條就係整組嘅全部價值。
  // fixture 係一行**四項條件全部符合「應該被補填」**嘅列：
  // `2026T4` ／ 合堂 ／ `SkipPostIDs` 空白 ／ `Active=TRUE`。
  // 冇呢一條，C1 只係把一個數字由 0 改成 1。
  //
  // ⚠️ 老實講一句：呢一條喺 C1 之前**已經係綠**——
  // 空白嗰一行本來就落到 `blocked`。佢守嘅唔係 C1 改嗰件事，
  // 而係「保護到底攔唔攔得住」呢個問題**由頭到尾冇人問過**。
  {
    const plan = gas.classifyCombinedSkipRows_(
      [mk('SP-BLOCK-EMPTY', '2026T4', '合堂', '', 'TRUE')],
      DEFAULT_SKIP, ['2026T4']);
    checkEqual('★★★★★★ 四項條件全部符合「應該補填」嘅 `2026T4` 列，'
      + '**唔會**被改', ids(plan.willFill), '');
    checkEqual('★★★★★★ 而且歸類喺「受保護季度」'
      + '——歸錯類嘅話，個數字報 0，而幹事會以為冇嘢需要保護',
      ids(plan.blocked), 'SP-BLOCK-EMPTY');
  }

  // ── C1　受保護季度排第一 ──────────────────────────────────────
  //
  // 用真實嗰一行嘅形狀：`2026T4` 合堂列，而 `SkipPostIDs` **已經有值**。
  {
    const plan = gas.classifyCombinedSkipRows_(
      [mk('SP-2026-02', '2026T4', '合堂', 'WORSHIP,PIANO', 'TRUE')],
      DEFAULT_SKIP, ['2026T4']);
    checkEqual('★★★★★★ 已經填咗值嘅 `2026T4` 列，歸「受保護季度」'
      + '——修正前佢先被「已經填了值」接走，'
      + '所以「受保護季度：0 行」報咗兩輪',
      ids(plan.blocked), 'SP-2026-02');
    checkEqual('★★★★★★ 而且**唔會**同時出現喺「已經填了值」'
      + '——一行只可以歸一類，兩邊都算就會出現「總數對唔上」',
      ids(plan.alreadyFilled), '');
  }

  // ── 受保護優先於**每一個**其他分類，唔止「已經填了值」 ────────
  {
    const plan = gas.classifyCombinedSkipRows_([
      mk('P-FILLED', '2026T4', '合堂', 'WORSHIP', 'TRUE'),
      mk('P-INACTIVE', '2026T4', '合堂', '', 'FALSE'),
      mk('P-NOTCOMBINED', '2026T4', '浸禮', '', 'TRUE'),
      mk('OK-FILL', '2027T2', '合堂', '', 'TRUE')
    ], DEFAULT_SKIP, ['2026T4']);
    checkEqual('★★★★★★ `2026T4` 嗰三行全部歸「受保護季度」'
      + '——一行只要落喺受保護季度，唔理佢有冇值、`Active` 係乜、'
      + '`Type` 係乜，一律先歸呢一類。'
      + '噉個數字先至講得出真話',
      ids(plan.blocked), 'P-FILLED,P-INACTIVE,P-NOTCOMBINED');
    checkEqual('★★★★★ 而唔受保護嗰季照補', ids(plan.willFill), 'OK-FILL');
    checkEqual('★★★★★ 其餘三類全部係空', ids(plan.alreadyFilled)
      + '|' + ids(plan.inactive) + '|' + ids(plan.notCombined), '||');
  }

  // ── 分類次序本身要寫喺碼度，唔係靠人記住 ─────────────────────
  const src = read('src/CombinedSkipBackfill.gs');
  const body = src.slice(src.indexOf('function classifyCombinedSkipRows_('));
  const posBlocked = body.indexOf('out.blocked.push(item)');
  const posFilled = body.indexOf('out.alreadyFilled.push(item)');
  const posInactive = body.indexOf('out.inactive.push(item)');
  const posNotCombined = body.indexOf('out.notCombined.push(item)');
  check('★★★★★★ `blocked` 嗰個判斷實際上排喺其餘三個之前'
    + '——次序就係規則本身。'
    + '寫喺註釋度話「受保護優先」而碼度排喺後面，等於冇寫',
    posBlocked >= 0 && posBlocked < posFilled
      && posBlocked < posInactive && posBlocked < posNotCombined,
    'blocked=' + posBlocked + ' filled=' + posFilled
      + ' inactive=' + posInactive + ' notCombined=' + posNotCombined);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
