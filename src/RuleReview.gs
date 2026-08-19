/**
 * 規則「人話版」審閱表——匯出／匯入。
 *
 * 對應 `docs/幹事介面規格.md` 第 5.4 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢個工具解決緊咩問題
 * ─────────────────────────────────────────────────────────────────────
 *
 * `RuleSettings` 工作表上面寫住一個 0 到 1 之間嘅小數，或者一個裸數字。
 * 堂委睇住嗰啲數字係**冇辦法決定任何嘢**嘅——佢哋唔知單位、
 * 唔知調大定調細係想點、更加唔知調完之後實際會有咩分別。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 第二十八輪批次階段 B：Ivan 匯出咗一份俾堂委睇，撞到五個問題
 * ─────────────────────────────────────────────────────────────────────
 *
 * B1　「現時設定」仲有裸數字（`3.3`／`1`／`2`／`（沒有設定）`）。
 *     **一個裸數字對堂委嚟講等於冇資訊。**
 * B2　「這一條在做什麼」有內部術語（工作表名、欄名）——
 *     嗰段字係由 `RuleSettings.Description` 直接抄出嚟嘅，
 *     而嗰一欄本來就係寫俾開發者睇。
 * B3　互斥組嗰條寫住「現時無任何組」，但實際上已經設咗一組
 *     ——**嗰句係試算表上一句寫死嘅字，唔係讀實際資料**。
 * B4　五條軟規則嘅「可以改成」只有「維持現狀／要討論」，
 *     堂委開會冇得揀，等於冇得改。
 * B5　欄闊唔夠，內容擠住。
 *
 * 修法：**唔再靠 `RuleSettings` 嘅 `RuleName`／`Description` 兩欄**，
 * 改用呢個檔案入面一份人話對照表（`ruleReviewPlainEntry_()`），
 * 而且「現時設定」同「可以改成」逐條各自定義。
 * 對照表冇覆蓋到嘅規則先至退回試算表嗰兩欄，並且會喺匯出結果標示出嚟
 * ——**唔可以靜靜退回**，退回咗就等於嗰條又出現內部術語。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 三條唔可以妥協嘅界線
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. **匯入只讀「堂委決定」同「備註」兩欄，其餘一律忽略。**
 * 2. **硬規則一律唔可以由匯入改動**（只記 `AuditLog`）。
 * 3. **匯入之後仲要幹事逐條接受或拒絕。**
 *
 * 而且（第二十八輪批次階段 B4）：
 * **換算一律用選項自己帶住嘅值，唔可以由顯示文字反推。**
 * 上一輪自己抓到嗰個「8 ÷ 13 反推回 0.62 會靜靜漂移」就係反推嘅代價。
 */

/** 審閱表嘅欄（第 1 行）。次序就係實際欄次序。 */
const RULE_REVIEW_HEADERS = [
  '編號', '規則（一句話）', '這一條在做什麼', '現時設定', '可以改成', '堂委決定', '備註／原因'
];

/** 「堂委決定」同「備註」係唯一兩個會被讀返入系統嘅欄。 */
const RULE_REVIEW_DECISION_COL = 6;   // 1-based
const RULE_REVIEW_NOTE_COL = 7;

/** 放審閱表嘅子資料夾名。 */
const RULE_REVIEW_FOLDER_NAME = 'RuleReview';

/** 硬規則／準硬規則只有兩個選項。 */
const RULE_REVIEW_HARD_CHOICES = ['同意', '要討論'];

/** 三組嘅標題。 */
const RULE_REVIEW_GROUPS = [
  { level: 'HARD', title: '一定要遵守（違反了系統會擋住）' },
  { level: 'SEMI_HARD', title: '盡量遵守（違反了只會提醒，不會擋住）' },
  { level: 'SOFT', title: '目標值（想做到多少，做不到也不算錯）' }
];

/**
 * 第二十八輪批次階段 B5：欄闊（像素）。
 * B 欄（規則）同 E 欄（可以改成）本來太窄，內容擠住。
 */
const RULE_REVIEW_COLUMN_WIDTHS = [50, 260, 380, 220, 260, 200, 260];

/**
 * 匯入時要寫邊一欄。
 * 有啲選項係改目標值（例如「每季上限 9 次」），
 * 有啲係開關（例如「關掉」）——**兩者唔可以混做一欄**。
 */
const RULE_REVIEW_FIELD = { TARGET: 'TARGET_VALUE', ENABLED: 'ENABLED' };

/**
 * 第二十九輪批次階段 A2：**比例型規則有兩種單位。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * Ivan 實測
 * ─────────────────────────────────────────────────────────────────────
 *
 * 第 9 條（報告可以連續兩週）匯出成 `13 個主日之中約 4 個`。
 * 但呢條規則數嘅唔係「主日」，係「**相鄰嘅兩個主日**」——
 * 13 個主日之間只有 12 對相鄰。用「個主日」做量詞根本講唔通。
 *
 * ⚠️ **唔可以寫死邊條用邊個單位。** 單位係規則自己嘅屬性，
 * 要寫喺規則定義表（`ruleReviewPlainEntry_()`）入面，
 * 換算同顯示兩邊都讀同一個欄位。將來加新規則時唔會再中同一個陷阱。
 *
 * 每個單位要講三件事：
 *
 * | 欄位 | 意思 | 點解要分開 |
 * |---|---|---|
 * | `population(weeks)` | 講俾堂委聽嗰個「總數」 | 相鄰對數係 `weeks - 1` |
 * | `ratioDenominator(weeks)` | **排表引擎真正乘嗰個數** | 見下面嘅警告 |
 * | `describe(pop, count)` | 一句人話 | 量詞唔同（個／對） |
 *
 * ⚠️⚠️ **第三十輪批次階段 D2：`ratioDenominator` 改返 `weeks - 1`。**
 *
 * 上一輪為咗「跟排表引擎」而用咗 `weeks`（因為
 * `isBehindTargetPace_(count, weeksCounted, target)` 嘅 `weeksCounted`
 * 數埋第一週）。**嗰個決定係錯嘅**——因為系統自己**量度**嗰邊
 * 用嘅係 `weeks - 1`：
 *
 *   `Verify.gs` 嘅 `measureAnnounceRelief_()`：
 *     `for (let i = 1; i < dates.length; i++) pairs++;`  ⇒ 12 對
 *   出嚟嘅品質統計就係 `報告（ANNOUNCE）洩壓閥　25.0%　3/12 對`
 *
 * 而堂委睇到嘅數字、同幹事事後喺品質統計見到嘅數字，**一定要同一個分母**。
 * 兩個唔同就係「同一件事兩個真相來源」嘅另一個形狀，
 * 而今次錯嗰邊係俾堂委睇嗰一份。
 *
 * 所以：**量詞、母體、換算分母三樣都跟單位**，全部係 `weeks - 1`。
 * `0.27 × 12 = 3.24` ⇒ 「12 對相鄰的主日之中約 3 對」。
 *
 * ⚠️⚠️ **第三十二輪批次階段 C′：引擎嗰邊刻意保留唔一致，已經拍板。**
 *
 * 排表引擎嘅進度控制（`Generator.gs` 嘅 `isBehindTargetPace_()`）
 * 繼續用 `weeksCounted`（＝ 13）。**呢個係決定，唔係遺漏。**
 * 完整理由寫喺 `isBehindTargetPace_()` 嘅註解，簡短版：
 * 引擎嗰個係 greedy pass 內部嘅節流參數，唔係量度；
 * 實測改咗會令每一季排表結果全部改變而目標指標零改善；
 * 而現場 20/23 個版本已經排到 3 對（25%），目標 3.24 對——已經命中。
 *
 * **量度介面呢邊（審閱表、品質統計）一律用 `adjacentPairCount_()`。**
 */
const RULE_REVIEW_UNITS = {
  PER_SUNDAY: {
    id: 'PER_SUNDAY',
    population: function (weeks) { return weeks; },
    ratioDenominator: function (weeks) { return weeks; },
    describe: function (population, count) {
      return population + ' 個主日之中約 ' + count + ' 個';
    }
  },
  ADJACENT_PAIR: {
    id: 'ADJACENT_PAIR',
    // ⚠️ 第三十二輪批次階段 C′2：兩個都叫 `adjacentPairCount_()`。
    // 同一條式喺呢度同 `Verify.gs` 各寫一次就係兩個真相來源。
    population: function (weeks) { return adjacentPairCount_(weeks); },
    ratioDenominator: function (weeks) { return adjacentPairCount_(weeks); },
    describe: function (population, count) {
      return population + ' 對相鄰的主日之中約 ' + count + ' 對';
    }
  }
};

/** 冇標明單位嗰陣用邊個。逐個主日係大多數。 */
const RULE_REVIEW_DEFAULT_UNIT = 'PER_SUNDAY';

/**
 * 攞一個單位定義。
 *
 * 認唔出嘅單位代號 ⇒ **拋錯**，唔可以靜靜退回預設。
 * 靜靜退回嘅話，打錯一個字就會令一條規則用錯分母，
 * 而份表睇落完全正常——而堂委會照住嗰個錯數做決定。
 *
 * @param {?string} unitId
 * @returns {Object}
 */
function ruleReviewUnit_(unitId) {
  const id = String(unitId || RULE_REVIEW_DEFAULT_UNIT).trim();
  const unit = RULE_REVIEW_UNITS[id];
  if (!unit) {
    throw new Error('規則審閱表：認不出的單位代號「' + id + '」。'
      + '可用的是：' + Object.keys(RULE_REVIEW_UNITS).join('、') + '。');
  }
  return unit;
}

/**
 * 一個單位喺呢個季度可唔可以換算。
 *
 * 相鄰對數喺得一個主日嘅季度係 0——0 做分母／母體都冇意思，
 * 呢種情況一律當「查不到」處理（改講百分比），
 * **唔可以印一句「0 對相鄰的主日之中約 0 對」**。
 *
 * @param {Object} unit
 * @param {?number} weeks
 * @returns {?{population: number, denominator: number}} null ＝ 換算唔到
 */
function ruleReviewUnitScale_(unit, weeks) {
  if (weeks === null || weeks === undefined) return null;
  const w = Number(weeks);
  if (isNaN(w) || w < 1) return null;
  const population = unit.population(w);
  const denominator = unit.ratioDenominator(w);
  if (population < 1 || denominator < 1) return null;
  return { population: population, denominator: denominator };
}

/**
 * 一季有幾多個主日。
 *
 * ⚠️ **唔可以寫死 13。** 有啲季度係 12 或者 14 個主日，
 * 而「13 個主日之中約 8 個」呢句話嘅意思完全靠嗰個分母。
 * 分母錯咗，堂委就會照住一個錯嘅比例做決定。
 *
 * 查唔到就回 `null`——呼叫端會改成講百分比，唔會偷偷用一個估出嚟嘅 13。
 *
 * @param {string} timezone
 * @returns {?{weeks: number, quarterId: string}} null ＝ 查不到
 */
function resolveRuleReviewWeeks_(timezone) {
  try {
    const D = COLUMNS.SERVICE_DATES;
    const byQuarter = {};
    readSheet(SHEETS.SERVICE_DATES).forEach(function (row) {
      const q = String(row[D.QUARTER_ID] || '').trim();
      if (!q) return;
      byQuarter[q] = (byQuarter[q] || 0) + 1;
    });
    const quarters = Object.keys(byQuarter).sort();
    if (quarters.length === 0) return null;
    const latest = quarters[quarters.length - 1];
    return { weeks: byQuarter[latest], quarterId: latest };
  } catch (err) {
    log_('WARN', '算不到一季有幾多個主日：' + err.message);
    return null;
  }
}

/**
 * 把一個比例值換成人話，量詞同母體跟規則自己嘅單位。
 *
 * @param {*} value
 * @param {?number} weeks
 * @param {?string} unitId 見 `RULE_REVIEW_UNITS`；唔傳 ＝ 逐個主日
 * @returns {string}
 */
function describeRuleValue_(value, weeks, unitId) {
  if (value === '' || value === null || value === undefined) return '（沒有設定）';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  if (!(num > 0 && num < 1)) return String(num);

  const unit = ruleReviewUnit_(unitId);
  const scale = ruleReviewUnitScale_(unit, weeks);
  if (!scale) {
    // ⚠️ 查不到主日數就**唔換算**。硬用 13 換算出嚟嘅數字睇落好確定，
    // 但可能係錯嘅——而堂委會照住嗰個錯數做決定。
    return '大約 ' + Math.round(num * 100) + '％的主日（查不到一季有幾多個主日，無法換算成次數）';
  }
  return unit.describe(scale.population, Math.round(num * scale.denominator));
}

/**
 * 比例型規則嘅選項（2–5 個），**每個選項自己帶住要寫入嘅值**。
 *
 * @param {number} current 現時值（0–1）
 * @param {?number} weeks
 * @param {?string} unitId 見 `RULE_REVIEW_UNITS`
 * @returns {Array<{label: string, value: number, field: string}>}
 */
function buildRuleReviewRatioChoices_(current, weeks, unitId) {
  const num = Number(current);
  const unit = ruleReviewUnit_(unitId);
  const scale = ruleReviewUnitScale_(unit, weeks);
  const keepOnly = [{ label: '維持現狀', value: num, field: RULE_REVIEW_FIELD.TARGET }];
  if (isNaN(num) || num <= 0 || num >= 1 || !scale) return keepOnly;

  const currentCount = Math.round(num * scale.denominator);
  // 現時嘅設定細到連一次都唔夠 ⇒ 冇一組「多一次／少一次」問得出口。
  // 硬砌一堆選項出嚟，「維持現狀」就會落喺一個唔等於原值嘅次數上面。
  if (currentCount < 1) return keepOnly;

  // ⚠️ 上限唔止係母體，仲要令換算出嚟嘅值**細過 1**。
  // `c === denominator` 換算出嚟就係 1.0，而 1.0 已經唔再係一個 0–1 之間
  // 嘅比例：下一次匯出會原樣印「1」，同上面 0 嗰個問題一模一樣。
  // 而且「每一個主日都要」係一條硬規則，唔係一個目標值。
  const maxCount = Math.min(scale.population, scale.denominator - 1);
  // 現時嘅設定已經高過上限（例如 0.99 × 13 ≈ 13 對）⇒ 同上面 `< 1` 一樣，
  // 砌唔出一組「維持現狀」落得正嘅選項，一律只留原值。
  if (currentCount > maxCount) return keepOnly;

  const counts = [];
  [-2, -1, 0, 1, 2].forEach(function (delta) {
    const c = currentCount + delta;
    // ⚠️ **由 1 開始，唔要 0。**
    //   1. `0` 存入 `TargetValue` 之後唔再係一個 0–1 之間嘅比例，
    //      下一次匯出會原樣印「0」而唔係「N 個之中約 0 個」——
    //      即係一個換算來回唔一致嘅值（見 rule_review_roundtrip 測試）。
    //   2. 而且「一次都唔好」根本唔係一個目標值，係「關掉呢條規則」，
    //      應該行 `ENABLED` 嗰欄，唔係喺目標值度填 0。
    //      對第 9 條（洩壓閥）嚟講，「0 對」正正就係封死逃生口——
    //      唔應該做成一個一撳就揀到嘅下拉選項。
    if (c < 1 || c > maxCount) return;
    if (counts.indexOf(c) === -1) counts.push(c);
  });

  return counts.map(function (c) {
    return {
      label: unit.describe(scale.population, c) + (c === currentCount ? '（維持現狀）' : ''),
      // ⚠️ 值由**次數直接算**，唔係由顯示文字反推。
      // 而且「維持現狀」直接沿用原值，唔會經過一次來回換算——
      // 上一輪就係因為 8 ÷ 13 反推回 0.62 而令「維持現狀」靜靜改咗值。
      value: c === currentCount ? num : Math.round((c / scale.denominator) * 100) / 100,
      field: RULE_REVIEW_FIELD.TARGET
    };
  });
}

/**
 * 第二十九輪批次階段 B：互斥組要**逐組列出全部成員**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * Ivan 實測
 * ─────────────────────────────────────────────────────────────────────
 *
 * 匯出寫住 `現時有 1 組：主席。`
 * 堂委睇到「1 組：主席」，完全唔知主席係同咩衝突——
 * **一句講唔出對手係邊個嘅衝突規則，等於冇講。**
 *
 * ⚠️ 順帶捉埋一個配置錯誤：**得一個成員嘅組完全冇作用。**
 * 「同一個人唔可以同一週做同一組入面兩個崗位」——組入面得一個崗位嘅話，
 * 呢句話永遠成立，即係嗰條規則對嗰一組完全冇擋過任何嘢。
 * 呢個要明講出嚟，唔可以印一句睇落正常嘅「現時有 1 組：主席」——
 * 嗰句會令人以為條規則喺度做緊嘢（bug class 2）。
 *
 * @param {Array<{group: string, postNames: string[]}>} groups
 * @returns {string}
 */
function describeMutexGroupsForReview_(groups) {
  const list = groups || [];
  if (list.length === 0) {
    return '現時沒有設定任何互斥組合，所以這一條實際上不會擋住任何安排。';
  }

  const lines = list.map(function (g) {
    const names = (g.postNames || []).slice();
    // ⚠️ 第三十輪批次階段 D1：**「只有一個崗位」同「有兩個但其中一個停用」
    // 係兩件完全唔同嘅事**，唔可以講同一句。
    //
    // 實測：`Posts` 入面 `CHAIR` 同 `COMMUNION` 兩行都有 `CHAIR_COMMUNION`，
    // 但匯出只列到「主席」——因為讀組員嗰段行咗
    // `readPostsNormalized()`（會 filter `Active=TRUE`）。
    // 一個停用嘅組員靜靜消失之後，畫面上剩返一個成員嘅組
    // 睇落同「配置漏咗」一模一樣，而正確嘅下一步完全唔同。
    const members = g.members || null;
    if (members) {
      const active = members.filter(function (m) { return m.active; });
      const inactive = members.filter(function (m) { return !m.active; });
      if (members.length >= 2 && active.length < 2) {
        return '　・' + names.join(' ＋ ')
          + '（這一組有 ' + members.length + ' 個崗位，但其中 ' + inactive.length
          + ' 個已停用，所以實際上不會擋住任何安排——'
          + '要它生效的話，把停用的那個改回啟用）';
      }
    }
    if (names.length < 2) {
      return '　・' + (names[0] || '（沒有崗位）')
        + '（這一組只有一個崗位，所以實際上不會擋住任何安排——'
        + '請檢查是不是漏了設定另一個崗位）';
    }
    return '　・' + names.join(' ＋ ');
  });

  // 多過一組時逐組一行——串埋一行嘅話，堂委要自己數返邊個同邊個一組。
  return '現時有 ' + list.length + ' 組：\n' + lines.join('\n')
    + '\n同一週之內，同一個人不會同時擔任同一組裡面的崗位。';
}

/**
 * 第二十九輪批次階段 A4：把一條規則嘅 `ScopePostIDs` 譯成中文崗位名。
 *
 * ⚠️ 攞唔到中文名嘅時候回**原本嗰個代號**，唔可以靜靜略過——
 * 略過嘅話，一個打錯咗嘅 PostID 就會喺份表上面完全消失，
 * 而嗰條規則對嗰個崗位根本冇生效過。
 *
 * @param {Object} rule `RuleSettings` 一行
 * @param {?Object} ctx `{postNameById}`
 * @returns {string[]} 空陣列 ＝ 一個崗位都冇填
 */
function describeScopePostNames_(rule, ctx) {
  const ids = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  const names = (ctx && ctx.postNameById) || {};
  return ids.map(function (id) { return names[id] || id; });
}

/**
 * 第二十八輪批次階段 B1／B2／B4：逐條規則嘅人話定義。
 *
 * 每一條回：
 *   `text`     規則一句話（取代 `RuleSettings.RuleName`）
 *   `what`     這一條在做什麼（取代 `RuleSettings.Description`，**唔可以有內部術語**）
 *   `current`  現時設定嘅人話（`function(rule, ctx)`）
 *   `choices`  可以改成（`function(rule, ctx)`），只有軟規則需要
 *   `note`     額外提醒（可選）
 *
 * @param {string} ruleId
 * @returns {?Object} 冇定義就回 null（呼叫端會退回試算表嗰兩欄並標示）
 */
function ruleReviewPlainEntry_(ruleId) {
  const onOff = function (yesText) {
    return function (rule) {
      return isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED])
        ? ('有生效' + (yesText ? '（' + yesText + '）' : '')) : '已關掉';
    };
  };
  const onOffChoices = function (keepLabel) {
    return function (rule) {
      const enabled = isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED]);
      return [
        { label: '維持現狀（' + (enabled ? keepLabel : '已關掉') + '）',
          value: enabled, field: RULE_REVIEW_FIELD.ENABLED },
        { label: enabled ? '關掉' : '開啟',
          value: !enabled, field: RULE_REVIEW_FIELD.ENABLED }
      ];
    };
  };

  const table = {};

  // ── 一定要遵守（硬規則）────────────────────────────────────
  table[RULE_IDS.ELIGIBILITY] = {
    text: '只安排做過那個崗位的人',
    what: '系統只會安排「以前做過這個崗位」的人。新人一定要先在「崗位資格」加，系統不會自己擴充。'
  };
  table[RULE_IDS.DISTINCT_SLOT] = {
    text: '同一天同一個崗位不會排到同一個人兩次',
    what: '同一個主日、同一個崗位如果有兩格（例如兩位司事），不會兩格都是同一個人。'
  };
  table[RULE_IDS.UNAVAILABLE] = {
    text: '已申報不能服侍的日子不會被排',
    what: '有人告訴我們某幾日不在，那幾日就完全不會排他。系統沒有「上半場不在」這種概念，填了就是整日。'
  };
  table[RULE_IDS.COMMUNION_FIRST_SUNDAY] = {
    text: '聖餐襄禮只在每月第一個主日',
    what: '其餘主日這個崗位根本不存在，不是「留空待填」。'
  };
  table[RULE_IDS.NO_AUTO_GENERATE] = {
    text: '講員、翻譯、獻花不由系統安排',
    what: '這三個崗位一定要人手填。系統會把格子留空，並在「開季前準備」提醒還有多少格未填。'
  };
  table[RULE_IDS.SPECIAL_SUNDAY_SKIP] = {
    text: '特別主日標明「這一週不用排」的崗位不會排人',
    what: '合堂、浸禮那些主日，你在「確認特別主日」勾了不用排的崗位，那一週就會留空。'
  };
  table[RULE_IDS.MUTEX_GROUP] = {
    text: '同一週不會安排同一個人擔任互相衝突的崗位',
    // ⚠️ B3：**讀實際資料**，唔可以寫死。
    what: function (rule, ctx) {
      return describeMutexGroupsForReview_((ctx && ctx.mutexGroups) || []);
    }
  };
  table[RULE_IDS.ROLE_REQUIRED] = {
    text: '某些崗位只由具備相應身分的人擔任',
    what: function (rule, ctx) {
      const gated = (ctx && ctx.gatedPosts) || [];
      if (gated.length === 0) {
        return '哪些崗位有身分要求由設定決定。現時一個都沒有設，所以這一條實際上不會擋住任何安排。';
      }
      return '現時有 ' + gated.length + ' 個崗位有身分要求：'
        + gated.map(function (p) { return p.postNameTC + '（' + p.requiredText + '）'; }).join('；')
        + '。';
    }
  };
  table[RULE_IDS.PERSON_POST_EXCLUDED] = {
    text: '個別同工按教會安排暫時不擔任某些崗位',
    what: '在「暫時不做某崗位」登記了的人，在登記那段時間之內不會被排到那個崗位。解除是填一個解除日期，不是刪掉紀錄。'
  };

  // ── 盡量遵守（準硬規則）────────────────────────────────────
  table[RULE_IDS.NO_CONSECUTIVE] = {
    text: '同一個崗位盡量不要連續兩週由同一個人擔任',
    // ⚠️ 第二十九輪批次階段 A4：**呢一條唔係對每個崗位都成立。**
    // `Generator.gs` 只喺 `post.allowConsecutive !== ALLOW` 嗰陣先檢查，
    // 而報告正正就係一個 `ALLOW` 嘅崗位（洩壓閥）。
    // 唔講嘅話，堂委喺同一份表上面會見到呢一條同「報告可以連續兩週」
    // 直接打架，然後唔知信邊條。
    what: '違反了系統仍然會排，但會在核對報告標出來讓你看到。'
      + '個別崗位可以豁免——報告就是豁免的，見下面「報告可以連續兩週」那一條。',
    current: onOff(''),
    choices: onOffChoices('有生效')
  };

  // ── 目標值（軟規則）────────────────────────────────────────
  table[RULE_IDS.MAX_PER_QUARTER] = {
    text: '每個人一季最多服侍多少次',
    what: '超過這個數目之後，系統就不會再排他。個別人士可以在名單上單獨設定自己的上限。',
    current: function (rule) {
      const v = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      return isNaN(v) ? '（沒有設定）' : ('每人每季最多 ' + v + ' 次');
    },
    choices: function (rule) {
      const current = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      return [6, 7, 8, 9, 10].map(function (n) {
        return {
          label: n + ' 次' + (n === current ? '（維持現狀）' : ''),
          value: n, field: RULE_REVIEW_FIELD.TARGET
        };
      });
    }
  };
  table[RULE_IDS.LOAD_BALANCE] = {
    text: '最久沒有服侍的人優先',
    what: '同樣合適的幾個人之中，系統會先揀最久沒有服侍那一位。',
    current: onOff(''),
    choices: onOffChoices('有生效')
  };
  table[RULE_IDS.QUARTER_DISTRIBUTION] = {
    text: '每季次數分佈盡量貼近以往',
    what: '避免出現「幾個人做很多、其他人幾乎沒有」的情況。',
    // ⚠️ 第二十九輪批次階段 A4：**呢兩條係二選一，唔係兩條各自生效。**
    // `Generator.gs`：`if (PERSONAL_QUOTA 開) { … } else if (QUARTER_DISTRIBUTION 開) { … }`
    // 「每個人的份額按他一向的服侍量分配」開住嗰陣，呢一條**完全冇行過**。
    // 唔講嘅話，堂委會喺呢一條上面花時間調一個唔會有任何效果嘅數字。
    note: '這一條只在「每個人的份額按他一向的服侍量分配」關掉時才會生效。'
      + '那一條開着的時候，這裏改什麼都不會有分別。',
    current: function (rule) {
      const v = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      return isNaN(v) ? '（沒有設定）' : ('平均每人每季約 ' + v + ' 次');
    },
    choices: function (rule) {
      const current = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      const options = [2.5, 3, 3.3, 3.5, 4];
      if (!isNaN(current) && options.indexOf(current) === -1) options.push(current);
      return options.sort(function (a, b) { return a - b; }).map(function (n) {
        return {
          label: '平均約 ' + n + ' 次' + (n === current ? '（維持現狀）' : ''),
          value: n, field: RULE_REVIEW_FIELD.TARGET
        };
      });
    }
  };
  table[RULE_IDS.PERSONAL_QUOTA] = {
    text: '每個人的份額按他一向的服侍量分配',
    what: '有些人一向做得多、有些人一向做得少。系統按各人以往的比例分配，而不是人人一樣多。',
    current: onOff('按各人一向的服侍量分配'),
    choices: onOffChoices('按各人一向的量'),
    note: '改成人人平均會令核心義工大幅減少、少見的人大幅增加。'
  };
  table[RULE_IDS.ROLE_POST_FOCUS] = {
    text: '堂委盡量集中在指定的幾個崗位',
    // ⚠️ 第二十九輪批次階段 A4：**要讀實際嘅集中崗位清單**，唔可以只寫一句抽象嘅話。
    // 而且 `evaluateRolePostFocus_()` 喺 `ScopePostIDs` 一個崗位都冇填嗰陣
    // 會**直接當規則未生效**（因為「唔喺白名單」永遠成立，扣到成份表都歪）。
    // 嗰種情況下印一句「有生效（其他崗位扣分，強度 2）」就係一句大話。
    what: function (rule, ctx) {
      const posts = describeScopePostNames_(rule, ctx);
      if (posts.length === 0) {
        return '本來的意思是：堂委被排到指定崗位以外的崗位時會扣分。'
          + '但現時一個「指定崗位」都沒有設，所以這一條實際上完全沒有作用。';
      }
      return '指定崗位是：' + posts.join('、')
        + '。堂委被排到這幾個以外的崗位時會扣分（仍然排得到，只是排後一點）。';
    },
    current: function (rule, ctx) {
      if (!isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED])) return '已關掉';
      if (describeScopePostNames_(rule, ctx).length === 0) {
        return '開着，但沒有設定指定崗位，所以實際上沒有作用';
      }
      const v = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      return '有生效（其他崗位扣分' + (isNaN(v) ? '' : '，強度 ' + v) + '）';
    },
    choices: function (rule) {
      const enabled = isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED]);
      const v = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
      const base = isNaN(v) ? 2 : v;
      return [
        { label: '強一些（更少排到其他崗位）', value: base + 1, field: RULE_REVIEW_FIELD.TARGET },
        { label: '維持現狀' + (enabled ? '' : '（已關掉）'), value: base, field: RULE_REVIEW_FIELD.TARGET },
        { label: '弱一些（比較容易排到其他崗位）',
          value: Math.max(1, base - 1), field: RULE_REVIEW_FIELD.TARGET },
        { label: '關掉', value: false, field: RULE_REVIEW_FIELD.ENABLED }
      ];
    }
  };
  table[RULE_IDS.CHAIR_EQ_ANNOUNCE] = {
    text: '主席和報告盡量由同一位擔任',
    what: '同一個主日的主席和報告由同一個人做，會少一個人要早到。',
    unit: 'PER_SUNDAY'
  };
  table[RULE_IDS.CHAIR_PREFER_DUAL] = {
    text: '優先揀「主席和報告都做得到」的人',
    // ⚠️ 第二十九輪批次階段 A4：呢一條個數字量嘅唔係「主日」，
    // 而係「**排主席嗰陣**，有幾多次揀咗一個兩邊都做得到嘅人」
    //（`computeChairPreferDualBonus_()` 嘅分母係 `dualAssigned + 1`）。
    // 每個主日排一次主席，所以數字上同主日數幾乎一樣，
    // 但一句唔講清楚，堂委會以為個數字係「有幾多個主日兼任咗」——
    // 而嗰個係上面另一條規則。
    what: '排主席的時候，同樣合適的人之中先揀「主席和報告都做得到」那一位。'
      + '這樣上面那一條比較容易做到。'
      + '下面的數字是「排主席的時候有多少次揀了兩邊都做得到的人」，'
      + '不是「有多少個主日真的兼任了」。',
    unit: 'PER_SUNDAY'
  };
  // ⚠️⚠️ 第二十九輪批次階段 A1：**呢一條原本寫反咗。**
  //
  // 舊文字：「報告盡量**不要**連續兩週由同一個人擔任」
  //         「報告要預備內容，連兩週會比較辛苦。」
  //
  // 但呢條規則喺系統入面嘅角色**啱啱相反**：佢係洩壓閥。
  // 排唔出人嗰陣，系統靠「容許報告連續」嚟解開嗰一週。
  //（`Generator.gs` 嘅 `computeAnnounceReliefBonus_()`：
  //  連續比例落後於目標進度時，上週嘅報告人**攞獎勵分**。）
  //
  // 寫反咗嘅後果唔係「文案唔靚」：如果堂委好心揀「約 2 對」，
  // 佢實際上係封咗系統唯一嘅逃生口，結果會令某些週完全排不出來。
  // **系統會忠實執行嗰個錯決定。**
  table[RULE_IDS.ANNOUNCE_RELIEF] = {
    text: '報告可以連續兩週由同一個人擔任',
    what: '這是系統的洩壓閥。某一週怎樣都排不出來時，'
      + '系統會優先讓報告連續。收得太緊會令某些週排不出來。',
    // 呢一條數嘅係「相鄰嘅兩個主日」，唔係「主日」。
    unit: 'ADJACENT_PAIR'
  };

  return table[ruleId] || null;
}

/**
 * 把一條規則轉成審閱表要嘅五個欄位。
 * @param {Object} rule `RuleSettings` 一行
 * @param {string} level HARD／SEMI_HARD／SOFT
 * @param {?number} weeks
 * @param {?Object} ctx `{mutexGroups, gatedPosts}`
 * @returns {{text: string, what: string, currentText: string,
 *   choices: Array<Object>, note: string, usedFallback: boolean}}
 */
function describeRuleForReview_(rule, level, weeks, ctx) {
  const R = COLUMNS.RULE_SETTINGS;
  const ruleId = String(rule[R.RULE_ID] || '').trim();
  const plain = ruleReviewPlainEntry_(ruleId);
  const enabled = isTrueValue_(rule[R.ENABLED]);
  const target = rule[R.TARGET_VALUE];

  const resolve = function (v) {
    return typeof v === 'function' ? v(rule, ctx) : v;
  };

  if (!plain) {
    // ⚠️ 退回試算表嗰兩欄係**最後手段**，而且一定要標示出嚟
    //（`usedFallback`）——嗰兩欄本來就係寫俾開發者睇嘅，
    // 靜靜退回就等於呢一條又出現內部術語，而冇人知。
    return {
      text: String(rule[R.RULE_NAME] || ruleId),
      what: String(rule[R.DESCRIPTION] || '').trim()
        || '（這一條還沒有寫給堂委看的說明，請問開發者）',
      // 冇人話表嘅規則一律當「逐個主日」——但佢已經被標成 `usedFallback`，
      // 呼叫端會列出佢個 RuleID 叫人去補人話同單位。
      currentText: level === RULE_LEVELS.SOFT
        ? describeRuleValue_(target, weeks, RULE_REVIEW_DEFAULT_UNIT)
        : (enabled ? '有生效' : '已關掉'),
      choices: level === RULE_LEVELS.SOFT
        ? buildRuleReviewRatioChoices_(target, weeks, RULE_REVIEW_DEFAULT_UNIT)
        : RULE_REVIEW_HARD_CHOICES.map(function (c) { return { label: c, value: null }; }),
      note: '',
      usedFallback: true
    };
  }

  // ⚠️ 單位由規則定義表話事，換算同顯示兩邊讀**同一個**欄位。
  // 兩邊各讀一次就係「同一件事兩個真相來源」。
  const unitId = plain.unit || RULE_REVIEW_DEFAULT_UNIT;

  let currentText;
  if (plain.current) currentText = resolve(plain.current);
  else if (level === RULE_LEVELS.SOFT) currentText = describeRuleValue_(target, weeks, unitId);
  else currentText = enabled ? '有生效' : '已關掉';

  // ⚠️ 第三十二輪批次階段 C′4：相鄰對嘅規則要補一句「兩者都算命中」。
  //
  // `0.27 × 12 = 3.24` 對，而 3.24 對只可以實現為 3 對或者 4 對
  //（25.0% ／ 33.3%）。冇呢句嘅話，堂委見到審閱表寫「約 3 對」、
  // 事後品質統計見到「4 對」，會以為系統冇跟佢哋批准嗰個數。
  //
  // ⚠️ 用返 `describeAdjacentPairTarget_()`——同 `Verify.gs` 品質統計
  // 同一個函式。兩邊各寫一次就會漂移，而漂移嘅後果係
  // 堂委見到嘅數同幹事事後見到嘅數唔同。
  if (unitId === RULE_REVIEW_UNITS.ADJACENT_PAIR.id && level === RULE_LEVELS.SOFT) {
    const goal = describeAdjacentPairTarget_(target, weeks);
    if (goal.ok) currentText = currentText + '\n' + goal.note;
  }

  let choices;
  if (level !== RULE_LEVELS.SOFT) {
    choices = RULE_REVIEW_HARD_CHOICES.map(function (c) { return { label: c, value: null }; });
  } else if (plain.choices) {
    choices = resolve(plain.choices);
  } else {
    choices = buildRuleReviewRatioChoices_(target, weeks, unitId);
  }

  return {
    text: plain.text,
    what: resolve(plain.what),
    currentText: currentText,
    choices: choices,
    note: plain.note || '',
    usedFallback: false
  };
}

/**
 * 砌出整份審閱表嘅內容（**純運算，唔碰 Drive**）。
 *
 * @param {Object[]} ruleRows `readSheet(SHEETS.RULE_SETTINGS)` 嘅結果
 * @param {?number} weeks 一季主日數
 * @param {?Object} ctx `{mutexGroups, gatedPosts}`；唔傳嘅話互斥組同身分要求
 *   嗰兩條會講「現時一組都沒有設」——所以呼叫端**一定要傳**
 * @returns {{rows: Array<Array<string>>, meta: Object[], fallbackRuleIds: string[]}}
 */
function buildRuleReviewSheetRows_(ruleRows, weeks, ctx) {
  const R = COLUMNS.RULE_SETTINGS;
  const rows = [RULE_REVIEW_HEADERS.slice()];
  const meta = [null];
  const fallbackRuleIds = [];

  let seq = 0;
  RULE_REVIEW_GROUPS.forEach(function (group) {
    const inGroup = (ruleRows || []).filter(function (r) {
      const level = String(r[R.LEVEL] || RULE_LEVELS.SOFT).trim().toUpperCase();
      return level === group.level;
    });
    if (inGroup.length === 0) return;

    rows.push([group.title, '', '', '', '', '', '']);
    meta.push(null);

    inGroup.forEach(function (r) {
      seq++;
      const ruleId = String(r[R.RULE_ID] || '').trim();
      const level = String(r[R.LEVEL] || RULE_LEVELS.SOFT).trim().toUpperCase();
      const d = describeRuleForReview_(r, level, weeks, ctx);
      if (d.usedFallback) fallbackRuleIds.push(ruleId);

      rows.push([
        String(seq),
        d.text,
        d.what + (d.note ? '\n⚠️ ' + d.note : ''),
        d.currentText,
        // ⚠️ B5：一個選項一行。用「／」串埋一行會排到好長，
        // 而堂委係喺會議上面對住份表逐條揀。
        d.choices.map(function (c) { return c.label; }).join('\n'),
        '',   // 堂委決定：留空，黃底，有下拉
        ''    // 備註
      ]);
      meta.push({
        seq: seq, ruleId: ruleId, level: level,
        currentValue: r[R.TARGET_VALUE], currentText: d.currentText,
        choices: d.choices, ruleText: d.text
      });
    });
  });

  return { rows: rows, meta: meta, fallbackRuleIds: fallbackRuleIds };
}

/**
 * 由「堂委填好嘅表」＋「系統現況」砌出三欄對照。**純運算。**
 *
 * ⚠️ 換算**一律用選項自己帶住嘅值**（`meta[].choices[].value`），
 * 唔可以由顯示文字反推——反推會漂移（見檔頭）。
 *
 * @param {Array<Array<string>>} sheetValues 整份表讀返嚟（含標題行）
 * @param {Object[]} ruleRows 現時 RuleSettings
 * @param {?number} weeks 一季主日數
 * @param {?Object} ctx `{mutexGroups, gatedPosts}`
 * @returns {{changes: Object[], hardNotes: Object[], ignored: Object[]}}
 */
function buildRuleReviewImportPlan_(sheetValues, ruleRows, weeks, ctx) {
  const R = COLUMNS.RULE_SETTINGS;

  // 用**現時嘅規則**重新砌一次選項表，靠「規則一句話」對返 RuleID。
  // 噉樣就算堂委喺表上改咗其他欄，都完全唔影響。
  const built = buildRuleReviewSheetRows_(ruleRows, weeks, ctx);
  const byRuleText = {};
  built.meta.forEach(function (m) { if (m) byRuleText[m.ruleText] = m; });

  const ruleById = {};
  (ruleRows || []).forEach(function (r) {
    const id = String(r[R.RULE_ID] || '').trim();
    if (id) ruleById[id] = r;
  });

  const changes = [];
  const hardNotes = [];
  const ignored = [];

  (sheetValues || []).forEach(function (row, index) {
    if (index === 0) return;                        // 標題行
    const seq = String(row[0] || '').trim();
    if (!/^\d+$/.test(seq)) return;                 // 組標題行

    const ruleText = String(row[1] || '').trim();
    const decision = String(row[RULE_REVIEW_DECISION_COL - 1] || '').trim();
    const note = String(row[RULE_REVIEW_NOTE_COL - 1] || '').trim();
    if (!decision && !note) return;                 // 冇填 ⇒ 冇意見

    // ⚠️ **只靠規則名對返系統嗰一行。** 表上其餘欄一律唔讀
    // ——嗰份表會傳嚟傳去，任何一格都可能被順手改過。
    const m = byRuleText[ruleText];
    if (!m) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: '系統裡面找不到這一條規則（規則名可能被改過）'
      });
      return;
    }

    if (m.level !== RULE_LEVELS.SOFT) {
      // 硬規則／準硬規則：**只記錄，永不改動**。
      hardNotes.push({
        ruleId: m.ruleId, ruleText: ruleText, level: m.level,
        decision: decision || '（沒有揀）', note: note
      });
      return;
    }

    const choice = m.choices.filter(function (c) { return c.label === decision; })[0];
    if (!choice) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: decision
          ? '看不懂這個決定（不是下拉裡面的選項），所以不會改動任何東西'
          : '只填了備註，沒有揀決定'
      });
      return;
    }

    const rule = ruleById[m.ruleId];
    const currentValue = choice.field === RULE_REVIEW_FIELD.ENABLED
      ? isTrueValue_(rule[R.ENABLED]) : Number(rule[R.TARGET_VALUE]);

    // 「維持現狀」同「同現時一樣」一律唔算改動——而且係**比值**，
    // 唔係比顯示文字。
    const same = choice.field === RULE_REVIEW_FIELD.ENABLED
      ? (currentValue === choice.value)
      : (!isNaN(currentValue) && Math.abs(currentValue - Number(choice.value)) < 0.0001);
    if (same) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: '跟現在的設定一樣，不用改'
      });
      return;
    }

    changes.push({
      ruleId: m.ruleId,
      ruleText: ruleText,
      field: choice.field,
      currentValue: choice.field === RULE_REVIEW_FIELD.ENABLED
        ? (currentValue ? '有生效' : '已關掉')
        : (isNaN(currentValue) ? '（沒有設定）' : currentValue),
      currentText: m.currentText,
      decisionText: decision,
      newValue: choice.value,
      note: note
    });
  });

  return { changes: changes, hardNotes: hardNotes, ignored: ignored };
}
