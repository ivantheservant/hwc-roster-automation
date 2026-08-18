/**
 * 第二十七輪批次階段 G2：規則「人話版」審閱表——匯出／匯入。
 *
 * 對應 `docs/幹事介面規格.md` 第 5.4 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢個工具解決緊咩問題
 * ─────────────────────────────────────────────────────────────────────
 *
 * `RuleSettings` 工作表上面寫住 `SOFT_CHAIR_EQ_ANNOUNCE　0.63`。
 * 堂委睇住 `0.63` 係**冇辦法決定**任何嘢嘅——佢哋唔知 0.63 係咩單位、
 * 唔知調大定調細係想點、更加唔知調完之後實際會有咩分別。
 *
 * 所以呢一份表把每一條規則寫成一句人話，而且**小數一律換算成
 * 「13 個主日之中大約幾多次」**——嗰個係堂委腦入面本來就有嘅單位。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 三條唔可以妥協嘅界線
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. **匯入只讀「堂委決定」同「備註」兩欄，其餘一律忽略。**
 *    就算堂委喺表上改咗規則名、改咗「現時設定」，都唔會入到系統。
 *    呢一點好重要：嗰份表會喺幾個人手上傳嚟傳去，任何一格都可能被
 *    順手改過，而「改咗一個顯示欄就靜靜改咗系統」係最難查嘅一種事故。
 *
 * 2. **硬規則一律唔可以由匯入改動。** 就算堂委揀咗「要討論」，
 *    系統只會把意見記入 AuditLog，唔會改 `Enabled`。
 *    硬規則係「一定唔可以違反」嘅嘢（例如同一日同一個人排兩個崗位），
 *    唔應該由一份試算表嘅一格下拉去關掉。
 *
 * 3. **匯入之後仲要幹事逐條接受或拒絕。** 同掣 1 嗰個三欄對照同一個模式：
 *    現時 ／ 堂委決定 ／ 換算成系統嘅值。
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
 * 一季有幾多個主日。
 *
 * ⚠️ **唔可以寫死 13。** 有啲季度係 12 或者 14 個主日，
 * 而「13 個主日之中約 8 個」呢句話嘅意思完全靠嗰個分母。
 * 分母錯咗，堂委就會照住一個錯嘅比例做決定。
 *
 * 查唔到就回 `null`——呼叫端會改成講「一季（查不到有幾多個主日）」，
 * 唔會偷偷用一個估出嚟嘅 13。
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
 * 把一個規則值換成人話。
 *
 * 小數（0 到 1 之間）視為「比例」⇒ 換算成「N 個主日之中約 M 個」。
 * 其餘照原樣顯示（次數、天數之類本來就係人睇得明嘅）。
 *
 * @param {*} value TargetValue
 * @param {?number} weeks 一季主日數；null ＝ 查不到
 * @returns {string}
 */
function describeRuleValue_(value, weeks) {
  if (value === '' || value === null || value === undefined) return '（沒有設定）';
  const num = Number(value);
  if (isNaN(num)) return String(value);

  // 0 到 1 之間（唔包括 0 同 1）先當成比例。1 以上係次數，0 係「關掉」。
  if (num > 0 && num < 1) {
    if (weeks === null || weeks === undefined) {
      // ⚠️ 查不到主日數就**唔換算**。硬用 13 換算出嚟嘅數字睇落好確定，
      // 但可能係錯嘅——而堂委會照住嗰個錯數做決定。
      return '大約 ' + Math.round(num * 100) + '％的主日（查不到一季有幾多個主日，無法換算成次數）';
    }
    return weeks + ' 個主日之中約 ' + Math.round(num * weeks) + ' 個';
  }
  return String(num);
}

/**
 * 一條軟規則可以改成邊幾樣（2–5 個人話選項）。
 *
 * 做法：以現時值為中心，向上向下各行一兩步，全部換成人話。
 * **唔會生成一個超出 0–1 範圍嘅選項**，亦唔會生成同現時值一樣嘅重複項。
 *
 * @param {number} current 現時值
 * @param {?number} weeks 一季主日數
 * @returns {string[]}
 */
function buildRuleReviewChoices_(current, weeks) {
  const num = Number(current);
  if (isNaN(num) || num <= 0 || num >= 1) {
    // 唔係比例（次數／開關）⇒ 唔生成數值選項，交由人手喺備註寫。
    return ['維持現狀', '要討論（請在備註寫想改成什麼）'];
  }
  if (weeks === null || weeks === undefined) {
    return ['維持現狀', '要討論（請在備註寫想改成什麼）'];
  }

  const currentCount = Math.round(num * weeks);
  const counts = [];
  [-2, -1, 0, 1, 2].forEach(function (delta) {
    const c = currentCount + delta;
    if (c < 0 || c > weeks) return;
    if (counts.indexOf(c) === -1) counts.push(c);
  });

  return counts.map(function (c) {
    return weeks + ' 個主日之中約 ' + c + ' 個' + (c === currentCount ? '（維持現狀）' : '');
  });
}

/**
 * 由一個選項文字反推返 `TargetValue`。
 *
 * ⚠️ 反推唔到就回 `null`（＝呢一條唔會被改動），**唔會估**。
 * 估錯一個規則值嘅後果係整季排表偏一邊，而冇人會知係邊度出事。
 *
 * @param {string} choiceText 堂委喺表上揀嘅文字
 * @param {?number} weeks 一季主日數
 * @returns {?number} null ＝ 反推唔到
 */
function parseRuleReviewChoice_(choiceText, weeks) {
  const text = String(choiceText || '').trim();
  if (!text) return null;
  if (weeks === null || weeks === undefined || !weeks) return null;
  const m = /個主日之中約\s*(\d+)\s*個/.exec(text);
  if (!m) return null;
  const count = Number(m[1]);
  if (isNaN(count) || count < 0 || count > weeks) return null;
  return Math.round((count / weeks) * 100) / 100;
}

/**
 * 砌出整份審閱表嘅內容（**純運算，唔碰 Drive**）。
 *
 * 分開一個純函式，係為咗可以離線測：格式、換算、分組全部驗得到，
 * 唔使真係去建一個試算表。
 *
 * @param {Object[]} ruleRows `readSheet(SHEETS.RULE_SETTINGS)` 嘅結果
 * @param {?number} weeks 一季主日數
 * @returns {{rows: Array<Array<string>>, meta: Object[]}}
 *   `rows` 係要寫入試算表嘅二維陣列（含標題同組標題）；
 *   `meta` 逐行對應（組標題行係 null），供匯入時對返 RuleID
 */
function buildRuleReviewSheetRows_(ruleRows, weeks) {
  const R = COLUMNS.RULE_SETTINGS;
  const rows = [RULE_REVIEW_HEADERS.slice()];
  const meta = [null];

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
      const target = r[R.TARGET_VALUE];
      const enabled = isTrueValue_(r[R.ENABLED]);

      const currentText = level === RULE_LEVELS.SOFT
        ? describeRuleValue_(target, weeks)
        : (enabled ? '有生效' : '已關掉');
      const choices = level === RULE_LEVELS.SOFT
        ? buildRuleReviewChoices_(target, weeks)
        : RULE_REVIEW_HARD_CHOICES.slice();

      rows.push([
        String(seq),
        String(r[R.RULE_NAME] || ruleId),
        // Description 空白時唔可以留白——留白會令堂委以為「呢條冇嘢做」。
        String(r[R.DESCRIPTION] || '').trim() || '（這一條還沒有寫說明，請問開發者）',
        currentText,
        choices.join(' ／ '),
        '',   // 堂委決定：留空，黃底，有下拉
        ''    // 備註
      ]);
      meta.push({
        seq: seq, ruleId: ruleId, level: level,
        currentValue: target, currentText: currentText, choices: choices
      });
    });
  });

  return { rows: rows, meta: meta };
}

/**
 * 由「堂委填好嘅表」＋「系統現況」砌出三欄對照。**純運算。**
 *
 * @param {Array<Array<string>>} sheetValues 整份表讀返嚟（含標題行）
 * @param {Object[]} ruleRows 現時 RuleSettings
 * @param {?number} weeks 一季主日數
 * @returns {{changes: Object[], hardNotes: Object[], ignored: Object[]}}
 */
function buildRuleReviewImportPlan_(sheetValues, ruleRows, weeks) {
  const R = COLUMNS.RULE_SETTINGS;
  const byRuleName = {};
  const byRuleId = {};
  (ruleRows || []).forEach(function (r) {
    const id = String(r[R.RULE_ID] || '').trim();
    if (!id) return;
    byRuleId[id] = r;
    byRuleName[String(r[R.RULE_NAME] || id).trim()] = r;
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

    // ⚠️ **只靠規則名對返系統嗰一行。** 表上其餘欄（現時設定、可以改成）
    // 一律唔讀——嗰份表會傳嚟傳去，任何一格都可能被順手改過。
    const rule = byRuleName[ruleText];
    if (!rule) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: '系統裡面找不到這一條規則（規則名可能被改過）'
      });
      return;
    }

    const ruleId = String(rule[R.RULE_ID] || '').trim();
    const level = String(rule[R.LEVEL] || RULE_LEVELS.SOFT).trim().toUpperCase();

    if (level !== RULE_LEVELS.SOFT) {
      // 硬規則／準硬規則：**只記錄，永不改動**。
      hardNotes.push({
        ruleId: ruleId, ruleText: ruleText, level: level,
        decision: decision || '（沒有揀）', note: note
      });
      return;
    }

    const newValue = parseRuleReviewChoice_(decision, weeks);
    if (newValue === null) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: decision
          ? '看不懂這個決定（不是下拉裡面的選項），所以不會改動任何東西'
          : '只填了備註，沒有揀決定'
      });
      return;
    }

    // ⚠️ **要比「次數」，唔可以比原始小數。**
    //
    // 現時值 0.63 顯示成「13 個主日之中約 8 個」，而 8 ÷ 13 反推返係 0.62
    // ——揀「維持現狀」反而會靜靜把 0.63 改成 0.62。
    // 每次匯入都漂移一點點，幾輪之後就同堂委當初決定嘅嘢差好遠，
    // 而每一次睇落都「同顯示嘅一樣」。
    const currentValue = Number(rule[R.TARGET_VALUE]);
    const currentCount = isNaN(currentValue) ? null : Math.round(currentValue * weeks);
    const newCount = Math.round(newValue * weeks);
    if (currentCount !== null && currentCount === newCount) {
      ignored.push({
        seq: seq, ruleText: ruleText, decision: decision, note: note,
        reason: '跟現在的設定一樣，不用改'
      });
      return;
    }

    changes.push({
      ruleId: ruleId,
      ruleText: ruleText,
      currentValue: isNaN(currentValue) ? '（沒有設定）' : currentValue,
      currentText: describeRuleValue_(rule[R.TARGET_VALUE], weeks),
      decisionText: decision,
      newValue: newValue,
      note: note
    });
  });

  return { changes: changes, hardNotes: hardNotes, ignored: ignored };
}
