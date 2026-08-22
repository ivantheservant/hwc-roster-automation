/**
 * 第四十七輪批次 D 組：**合堂主日，五個崗位唔應該由本堂排。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 呢個問題嘅形狀
 * ═════════════════════════════════════════════════════════════════════
 *
 * 合堂主日嗰日，主席／講員／傳譯／領詩／司琴由另一堂帶領。
 * 排表引擎讀 `SkipPostIDs` 讀得完全正確——問題係嗰張表上面根本冇填。
 *
 * 而「產生年度合堂建議」嗰支工具，確認畫面直頭明文寫住
 * 「跳過崗位一律留空，需要你自己按每一次合堂的實際安排填寫」。
 *
 * 即係：系統知道合堂要跳崗位，而把一件**每次都一樣**嘅嘢
 * 交咗畀幹事逐次記得人手做。呢個唔係「幹事做漏咗」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 兩邊一齊修
 * ─────────────────────────────────────────────────────────────────────
 *
 *   ・**日後**：`AnnualCombined.gs` 新寫入嗰幾行帶住預設值
 *   ・**既有**：呢一支補填工具
 *
 * 淨係修一邊都唔夠：只修日後，既有嗰幾季照樣要人手清；
 * 只補既有，出年產生 2028 年嘅四次合堂又再一次全部留空。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 呢支工具嘅五條界線
 * ─────────────────────────────────────────────────────────────────────
 *
 *   一、**先算後做。** 撳落去先見到一份逐行清單，睇完先決定做唔做。
 *   二、**唔覆寫已經填咗嘅 `SkipPostIDs`。** 幹事填咗一個值落去，
 *       就係佢對嗰一日嘅決定。系統改壞幹事親手做嘅決定，比排錯更差。
 *   三、**唔碰 `Active=FALSE` 嘅行。** 嗰啲係範例列同已停用嘅安排。
 *   四、**唔碰受保護季度。** 見下面 `COMBINED_BACKFILL_BLOCKED_QUARTERS`。
 *   五、**寫 AuditLog。** 改咗邊幾行、由乜改成乜，要查得返。
 */

/**
 * 合堂預設跳過嘅崗位（程式內建預設值）。
 *
 * 主席（CHAIR）／講員（PREACHER）／傳譯（TRANSLATOR）／
 * 領詩（WORSHIP）／司琴（PIANO）——合堂嗰日呢五個位由另一堂帶領。
 *
 * ⚠️ Config 入面改得，但**改嘅係 Config 嗰一格，唔係呢一行**。
 * 呢一行只係「Config 完全冇設定過」嗰陣嘅退路。
 */
const COMBINED_DEFAULT_SKIP_POST_IDS_DEFAULT = 'CHAIR,PREACHER,TRANSLATOR,WORSHIP,PIANO';

/**
 * 補填工具**絕對唔可以碰**嘅季度（程式內建預設值）。
 *
 * ⚠️ **唔重用 `REHEARSAL_PROTECTED_QUARTERS`。**
 *
 * 嗰一個守嘅係「全季流程演練唔可以碰邊幾季」；呢一個守嘅係
 * 「補填工具唔可以改邊幾季嘅資料」。兩件事今日啱啱好重疊，
 * 唔代表日後都重疊——共用一格嘅話，日後有人為咗演練而加減一季，
 * 就會**靜靜噉**連補填工具嘅保護範圍都改埋。
 *
 * 靜靜連帶改咗另一件事，係呢個專案由第一輪殺到而家嗰一種錯。
 */
const COMBINED_BACKFILL_BLOCKED_DEFAULT = '2026T4';

/**
 * 讀「合堂預設跳過崗位」設定。
 *
 * ⚠️ 同保護季度**唔一樣**：呢一格填成空白係一個**有意思嘅決定**
 * （「我唔想任何合堂自動跳崗位」），所以空白就係空白，
 * 唔會退回內建預設。退回嘅話就會推翻幹事特登清空嗰個決定。
 *
 * @returns {string} 逗號分隔嘅 PostID 清單，可以係空字串
 */
function readCombinedDefaultSkipPostIds_() {
  try {
    return String(getConfig(CONFIG_KEYS.COMBINED_DEFAULT_SKIP_POST_IDS,
      COMBINED_DEFAULT_SKIP_POST_IDS_DEFAULT) || '').trim();
  } catch (err) {
    return COMBINED_DEFAULT_SKIP_POST_IDS_DEFAULT;
  }
}

/**
 * 讀「補填工具唔可以碰邊幾季」設定。
 *
 * ⚠️ 同上面嗰個**相反**：呢一格填成空白**唔會**變成「乜都唔保護」，
 * 仍然退回內建預設。一格打空咗就冧晒保護，係最易誤觸嗰種。
 * 想真正解除某一季嘅保護，只能把它由嗰一格移走。
 *
 * @returns {string[]} 季度 ID 陣列
 */
function readCombinedBackfillBlockedQuarters_() {
  let raw = '';
  try {
    raw = String(getConfig(CONFIG_KEYS.COMBINED_BACKFILL_BLOCKED_QUARTERS,
      COMBINED_BACKFILL_BLOCKED_DEFAULT) || '').trim();
  } catch (err) {
    raw = COMBINED_BACKFILL_BLOCKED_DEFAULT;
  }
  if (raw === '') raw = COMBINED_BACKFILL_BLOCKED_DEFAULT;
  return splitList_(raw);
}

/**
 * 呢一行 `SpecialSundays` 係唔係一次合堂？**純函式。**
 *
 * 判斷準則：`Type` 或者 `Title` 入面出現「合堂」，
 * 或者出現 `COMBINED`（大細楷唔理）。
 *
 * ⚠️ 兩格都睇，係因為幹事實際上兩格都會噉寫：
 * 「產生年度合堂建議」寫嘅係 `Type='合堂'`，
 * 而人手加嘅行成日係 `Type='特別主日'`、`Title='五月合堂'`。
 * 只認一格就會靜靜漏咗一半。
 *
 * ⚠️ 而認得太闊亦都係錯：浸禮主日、宣教主日呢啲日子係**要排人**嘅，
 * 誤判就會喺唔應該跳嘅日子跳咗五個崗位，而個表面上睇落好正常。
 *
 * @param {Object} row 一行 `SpecialSundays`（`readSheet()` 出嚟嗰種物件）
 * @returns {boolean} 係合堂就 true
 */
function isCombinedSpecialSunday_(row) {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  const text = (String((row && row[C.TYPE]) || '') + ' '
    + String((row && row[C.TITLE]) || '')).trim();
  if (text === '') return false;
  if (text.indexOf('合堂') !== -1) return true;
  return text.toUpperCase().indexOf('COMBINED') !== -1;
}

/**
 * 把一批 `SpecialSundays` 行分成五類。**純函式，唔讀唔寫任何工作表。**
 *
 * 寫成純函式係為咗可以喺測試入面直接餵五種行入去，
 * 逐類斷言——唔使砌成張假試算表先驗得到。
 *
 * @param {Object[]} rows `SpecialSundays` 全部行
 * @param {string} defaultSkip 逗號分隔嘅預設 PostID 清單
 * @param {string[]} blockedQuarters 受保護嘅季度 ID
 * @returns {{willFill: Object[], alreadyFilled: Object[], inactive: Object[],
 *   notCombined: Object[], blocked: Object[]}}
 */
function classifyCombinedSkipRows_(rows, defaultSkip, blockedQuarters) {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  const blocked = (blockedQuarters || []).map(function (q) {
    return String(q || '').trim().toUpperCase();
  });
  const value = String(defaultSkip || '').trim();

  const out = {
    willFill: [], alreadyFilled: [], inactive: [], notCombined: [], blocked: []
  };

  (rows || []).forEach(function (row, index) {
    const item = {
      rowIndex: index,
      specialId: String(row[C.SPECIAL_ID] || '').trim(),
      quarterId: String(row[C.QUARTER_ID] || '').trim(),
      type: String(row[C.TYPE] || '').trim(),
      title: String(row[C.TITLE] || '').trim(),
      oldValue: String(row[C.SKIP_POST_IDS] || '').trim(),
      newValue: value
    };

    // ⚠️ 次序有意思：**先分類，後決定**。
    //
    // 「唔係合堂」擺喺最前——一行浸禮主日就算喺受保護季度、
    // 就算 Active=FALSE，佢首先係「呢支工具由頭到尾唔關佢事」。
    // 分錯類嘅話，報告會話「呢一行因為季度受保護所以冇補」，
    // 而幹事解除保護之後會發現佢仍然冇補，然後以為系統壞咗。
    if (!isCombinedSpecialSunday_(row)) { out.notCombined.push(item); return; }
    if (!isTrueValue_(row[C.ACTIVE])) { out.inactive.push(item); return; }
    if (item.oldValue !== '') { out.alreadyFilled.push(item); return; }
    if (blocked.indexOf(item.quarterId.toUpperCase()) !== -1) {
      out.blocked.push(item);
      return;
    }
    // ⚠️ Config 揀成空白 ⇒ **一行都唔補**。
    // 當成「冇設定所以照用內建」會推翻幹事特登清空嗰個決定。
    if (value === '') return;
    out.willFill.push(item);
  });

  return out;
}

/**
 * 算一算要補邊幾行。**純讀取。**
 *
 * @returns {Object} `classifyCombinedSkipRows_()` 嘅結果，加上 `defaultSkip`
 *   同 `blockedQuarters` 兩個欄位（畀確認畫面照住講）
 */
function planCombinedSkipBackfill_() {
  const defaultSkip = readCombinedDefaultSkipPostIds_();
  const blockedQuarters = readCombinedBackfillBlockedQuarters_();
  const rows = readSheet(SHEETS.SPECIAL_SUNDAYS);
  const plan = classifyCombinedSkipRows_(rows, defaultSkip, blockedQuarters);
  plan.defaultSkip = defaultSkip;
  plan.blockedQuarters = blockedQuarters;
  return plan;
}

/**
 * 真正補填。**只寫 `willFill` 嗰幾行嘅 `SkipPostIDs` 一格。**
 *
 * @param {Object} plan `planCombinedSkipBackfill_()` 嘅結果
 * @returns {{filled: number}}
 */
function executeCombinedSkipBackfill_(plan) {
  if (!plan || !plan.willFill || plan.willFill.length === 0) return { filled: 0 };

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) throw new Error('找不到「' + SHEETS.SPECIAL_SUNDAYS + '」這一張工作表。');

  const key = COLUMNS.SPECIAL_SUNDAYS.SKIP_POST_IDS;
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (v) { return String(v || '').trim(); });
  const col = headers.indexOf(key) + 1;
  if (col <= 0) {
    throw new Error(buildThreePartMessage_(
      '「' + SHEETS.SPECIAL_SUNDAYS + '」這一張工作表沒有「' + key + '」這一欄。',
      '什麼都沒有寫入。',
      ['去選單「維護 ▸ 補建 SpecialSundays 工作表」看看這一張表是不是壞了',
        '如果整張表的欄位都不對，先把它修好再跑這一支']));
  }

  // `readSheet()` 由第 3 行開始，所以 rowIndex 0 ＝ 試算表第 3 行。
  plan.willFill.forEach(function (item) {
    sheet.getRange(item.rowIndex + 3, col).setValue(item.newValue);
  });

  writeAuditLog_({
    action: 'COMBINED_SKIP_BACKFILL',
    targetSheet: SHEETS.SPECIAL_SUNDAYS,
    targetKey: plan.willFill.map(function (i) { return i.specialId; }).join('、'),
    oldValue: '（空白）',
    newValue: plan.defaultSkip,
    source: 'executeCombinedSkipBackfill_',
    notes: '只填原本空白的那幾行；沒有覆寫任何已填的值、'
      + '沒有碰 Active=FALSE 的行、沒有碰受保護季度（'
      + plan.blockedQuarters.join('、') + '）'
  });

  return { filled: plan.willFill.length };
}

/**
 * 選單項目「維護 ▸ 補填合堂跳過崗位」的執行入口。
 * @returns {void}
 */
function runCombinedSkipBackfill_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補填合堂跳過崗位';

  let plan;
  try {
    plan = planCombinedSkipBackfill_();
  } catch (err) {
    log_('ERROR', 'runCombinedSkipBackfill_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  const describe = function (item) {
    return '　' + (item.specialId || '（沒有 SpecialID）')
      + '　' + (item.quarterId || '（沒有季度）')
      + '　' + (item.type || item.title || '（沒有類型）');
  };

  const lines = ['合堂主日那一天，主席／講員／傳譯／領詩／司琴由另一堂帶領，'];
  lines.push('所以這五個崗位不應該由本堂排。');
  lines.push('');
  lines.push('要填進去的值（來自 Config「' + CONFIG_KEYS.COMBINED_DEFAULT_SKIP_POST_IDS + '」）：');
  lines.push('　' + (plan.defaultSkip || '（空白）'));
  lines.push('');

  if (plan.defaultSkip === '') {
    ui.alert(title,
      'Config「' + CONFIG_KEYS.COMBINED_DEFAULT_SKIP_POST_IDS + '」目前是空白，\n'
        + '所以這一次一行都不會補。\n\n'
        + '（空白當成你的決定，不會自動退回程式內建的那五個崗位。'
        + '想恢復就在那一格填回 PostID，逗號分隔。）',
      ui.ButtonSet.OK);
    return;
  }

  if (plan.willFill.length === 0) {
    lines.push('沒有任何一行需要補。');
    if (plan.alreadyFilled.length > 0) {
      lines.push('');
      lines.push('已經填了的（不會覆寫）：' + plan.alreadyFilled.length + ' 行');
      plan.alreadyFilled.forEach(function (i) {
        lines.push(describe(i) + '　⇒ 現在是「' + i.oldValue + '」');
      });
    }
    if (plan.blocked.length > 0) {
      lines.push('');
      lines.push('受保護季度，不會動：' + plan.blocked.length + ' 行');
      plan.blocked.forEach(function (i) { lines.push(describe(i)); });
    }
    ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
    return;
  }

  lines.push('會補這 ' + plan.willFill.length + ' 行（原本是空白的）：');
  plan.willFill.forEach(function (i) { lines.push(describe(i)); });
  lines.push('');
  lines.push('不會動的：');
  lines.push('　・已經填了值：' + plan.alreadyFilled.length + ' 行（不覆寫你填的東西）');
  lines.push('　・Active=FALSE：' + plan.inactive.length + ' 行');
  lines.push('　・不是合堂：' + plan.notCombined.length + ' 行');
  lines.push('　・受保護季度（' + plan.blockedQuarters.join('、') + '）：'
    + plan.blocked.length + ' 行');
  lines.push('');
  lines.push('只會改「' + COLUMNS.SPECIAL_SUNDAYS.SKIP_POST_IDS + '」這一欄，其他一格都不動。');
  lines.push('');
  lines.push('確定要補嗎？');

  if (ui.alert(title + '（確認）', lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  let result;
  try {
    result = executeCombinedSkipBackfill_(plan);
  } catch (err) {
    log_('ERROR', 'executeCombinedSkipBackfill_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  ui.alert(title,
    '已經補好 ' + result.filled + ' 行。\n\n'
      + '⚠️ 已經生成過的季度不會自動重排——'
      + '要那幾天真的跳過這五個崗位，需要重新生成那一季。\n\n'
      + '哪一次合堂實際上不只跳這五個崗位（例如堂慶連司事都由英語堂負責），'
      + '在那一行自己加上去就可以，這一支不會再覆寫。',
    ui.ButtonSet.OK);
}
