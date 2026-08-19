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
 * 把一個比例值換成「N 個主日之中約 M 個」。
 * @param {*} value
 * @param {?number} weeks
 * @returns {string}
 */
function describeRuleValue_(value, weeks) {
  if (value === '' || value === null || value === undefined) return '（沒有設定）';
  const num = Number(value);
  if (isNaN(num)) return String(value);

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
 * 比例型規則嘅選項（2–5 個），**每個選項自己帶住要寫入嘅值**。
 * @param {number} current 現時值（0–1）
 * @param {?number} weeks
 * @returns {Array<{label: string, value: number, field: string}>}
 */
function buildRuleReviewRatioChoices_(current, weeks) {
  const num = Number(current);
  if (isNaN(num) || num <= 0 || num >= 1 || weeks === null || weeks === undefined) {
    return [{ label: '維持現狀', value: num, field: RULE_REVIEW_FIELD.TARGET }];
  }

  const currentCount = Math.round(num * weeks);
  const counts = [];
  [-2, -1, 0, 1, 2].forEach(function (delta) {
    const c = currentCount + delta;
    if (c < 0 || c > weeks) return;
    if (counts.indexOf(c) === -1) counts.push(c);
  });

  return counts.map(function (c) {
    return {
      label: weeks + ' 個主日之中約 ' + c + ' 個' + (c === currentCount ? '（維持現狀）' : ''),
      // ⚠️ 值由**次數直接算**，唔係由顯示文字反推。
      // 而且「維持現狀」直接沿用原值，唔會經過一次來回換算——
      // 上一輪就係因為 8 ÷ 13 反推回 0.62 而令「維持現狀」靜靜改咗值。
      value: c === currentCount ? num : Math.round((c / weeks) * 100) / 100,
      field: RULE_REVIEW_FIELD.TARGET
    };
  });
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
      const groups = (ctx && ctx.mutexGroups) || [];
      if (groups.length === 0) {
        return '哪些崗位算「互相衝突」由設定決定。現時一組都沒有設，所以這一條實際上不會擋住任何安排。';
      }
      return '現時有 ' + groups.length + ' 組：'
        + groups.map(function (g) { return g.postNames.join(' ＋ '); }).join('；')
        + '。同一週之內，同一個人不會同時擔任同一組裡面的崗位。';
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
    what: '違反了系統仍然會排，但會在核對報告標出來讓你看到。',
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
    what: '堂委被排到指定崗位以外的崗位時會扣分（仍然排得到，只是排後一點）。',
    current: function (rule) {
      if (!isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED])) return '已關掉';
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
    what: '同一個主日的主席和報告由同一個人做，會少一個人要早到。'
  };
  table[RULE_IDS.CHAIR_PREFER_DUAL] = {
    text: '優先揀「主席和報告都做得到」的人',
    what: '這樣上面那一條比較容易做到。'
  };
  table[RULE_IDS.ANNOUNCE_RELIEF] = {
    text: '報告盡量不要連續兩週由同一個人擔任',
    what: '報告要預備內容，連兩週會比較辛苦。'
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
      currentText: level === RULE_LEVELS.SOFT
        ? describeRuleValue_(target, weeks) : (enabled ? '有生效' : '已關掉'),
      choices: level === RULE_LEVELS.SOFT
        ? buildRuleReviewRatioChoices_(target, weeks)
        : RULE_REVIEW_HARD_CHOICES.map(function (c) { return { label: c, value: null }; }),
      note: '',
      usedFallback: true
    };
  }

  let currentText;
  if (plain.current) currentText = resolve(plain.current);
  else if (level === RULE_LEVELS.SOFT) currentText = describeRuleValue_(target, weeks);
  else currentText = enabled ? '有生效' : '已關掉';

  let choices;
  if (level !== RULE_LEVELS.SOFT) {
    choices = RULE_REVIEW_HARD_CHOICES.map(function (c) { return { label: c, value: null }; });
  } else if (plain.choices) {
    choices = resolve(plain.choices);
  } else {
    choices = buildRuleReviewRatioChoices_(target, weeks);
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
        // 而堂委係喺會議上面對住張表逐條揀。
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
