/**
 * 參數掃描：對 SCORE_CHAIR_DUAL_BONUS 與 SELECTION_WEIGHT_HISTORICAL 的各種組合
 * 各模擬一次排表，計算與歷史基準的偏差，找出最佳參數組合。
 *
 * 全程在記憶體運算，**不寫入 RosterAssignments、不建立版本、不改動 Config 與 RuleSettings**，
 * 只會產生／覆寫一張 Tune_Result 報告工作表。
 *
 * 單次執行有時間預算（TUNE_TIME_BUDGET_MS）。未跑完的組合會把進度存入 Script Properties，
 * 下次再執行同一個季度時自動接續，直到全部完成才寫出報告。
 *
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {{done: boolean, completed: number, total: number, remaining: number,
 *   sheetName: (string|undefined), best: (Object|undefined)}} 執行結果
 */
function tuneParameters(quarterId) {
  const combos = buildTuneCombos_();
  const progress = loadTuneProgress_(quarterId);

  // context 只讀一次，12 組共用：讀表是整個流程最慢的部分
  const context = buildGeneratorContext_(quarterId);
  const scope = getChairAnnounceScope_(context.rules);
  if (!scope) throw new Error('SOFT_CHAIR_EQ_ANNOUNCE 的 ScopePostIDs 不足兩個崗位，無法計算兼任比例');

  const baseline = readTuneBaseline_(context.rules);
  const startedAt = Date.now();

  while (progress.nextIndex < combos.length && (Date.now() - startedAt) < TUNE_TIME_BUDGET_MS) {
    progress.rows.push(runTuneCombo_(context, scope, baseline, combos[progress.nextIndex]));
    progress.nextIndex++;
  }

  const remaining = combos.length - progress.nextIndex;
  if (remaining > 0) {
    saveTuneProgress_(progress);
    log_('INFO', 'tuneParameters: 已完成 ' + progress.nextIndex + '/' + combos.length + ' 組，尚餘 ' + remaining);
    return { done: false, completed: progress.nextIndex, total: combos.length, remaining: remaining };
  }

  clearTuneProgress_();
  const sorted = progress.rows.slice().sort(function (a, b) { return a.deviation - b.deviation; });
  const sheetName = writeTuneSheet_(quarterId, sorted, baseline);

  return {
    done: true,
    completed: combos.length,
    total: combos.length,
    remaining: 0,
    sheetName: sheetName,
    best: sorted[0]
  };
}

/**
 * 產生所有要試的參數組合。
 * @returns {Object[]} 每項為 {chairDualBonus, historicalWeight}
 */
function buildTuneCombos_() {
  const combos = [];
  TUNE_GRID.CHAIR_DUAL_BONUS.forEach(function (bonus) {
    TUNE_GRID.WEIGHT_HISTORICAL.forEach(function (weight) {
      combos.push({ chairDualBonus: bonus, historicalWeight: weight });
    });
  });
  return combos;
}

/**
 * 取得比較用的基準值。兩個比例型基準優先取自 RuleSettings 的 TargetValue，
 * 人數／平均／最高則取自 HISTORICAL_BASELINE。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @returns {{chairEq: number, announce: number, peopleCount: number, average: number, maxCount: number}} 基準值
 */
function readTuneBaseline_(rules) {
  const readTarget = function (ruleId, fallback) {
    const rule = rules[ruleId];
    if (!rule) return fallback;
    const value = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
    return isNaN(value) ? fallback : value;
  };

  return {
    chairEq: readTarget(RULE_IDS.CHAIR_EQ_ANNOUNCE, 0.63),
    announce: readTarget(RULE_IDS.ANNOUNCE_RELIEF, 0.27),
    peopleCount: HISTORICAL_BASELINE.PEOPLE_COUNT,
    average: HISTORICAL_BASELINE.AVG_PER_PERSON,
    maxCount: HISTORICAL_BASELINE.MAX_PER_PERSON
  };
}

/**
 * 用指定的參數組合模擬一次排表，並計算各項指標與總偏差。
 * 會就地改寫 context 的兩個參數欄位，但不影響任何工作表。
 * @param {Object} context 排表 context（12 組共用）
 * @param {{chairPostId: string, announcePostId: string}} scope 主席與報告的崗位
 * @param {Object} baseline 基準值
 * @param {{chairDualBonus: number, historicalWeight: number}} combo 要試的參數
 * @returns {Object} 該組合的模擬結果
 */
function runTuneCombo_(context, scope, baseline, combo) {
  context.scoreWeights = {
    chairDualBonus: combo.chairDualBonus,
    preferenceBonus: context.scoreWeights.preferenceBonus,
    selectionWeight: context.scoreWeights.selectionWeight
  };
  context.historicalWeight = combo.historicalWeight;

  const result = buildRoster_(context);
  const summary = summariseTrace_(result, context, scope);
  const hardViolations = countHardViolations_(context, result);

  const metrics = {
    chairEq: summary.chairEqRatio,
    announce: summary.announceRatio,
    peopleCount: summary.peopleCount,
    average: summary.average,
    maxCount: summary.maxCount
  };

  return {
    chairDualBonus: combo.chairDualBonus,
    historicalWeight: combo.historicalWeight,
    chairEqRatio: metrics.chairEq,
    announceRatio: metrics.announce,
    peopleCount: metrics.peopleCount,
    average: metrics.average,
    maxCount: metrics.maxCount,
    hardViolations: hardViolations,
    deviation: computeTuneDeviation_(metrics, baseline)
  };
}

/**
 * 計算與歷史基準的總偏差：五項各自取「相對差值」後相加，數值越細代表越貼近歷史。
 * 用相對差值（除以基準）而非絕對差值，令比例（0–1）與次數（0–8）能放在同一尺度比較。
 * @param {Object} metrics 模擬結果的五項指標
 * @param {Object} baseline 基準值
 * @returns {number} 總偏差
 */
function computeTuneDeviation_(metrics, baseline) {
  // 指標為 null 代表該項無法計算（例如 RuleSettings 沒有對應規則），跳過不計
  const relative = function (actual, expected) {
    if (!expected) return 0;
    if (actual === null || actual === undefined) return 0;
    return Math.abs(actual - expected) / expected;
  };

  return relative(metrics.chairEq, baseline.chairEq)
    + relative(metrics.announce, baseline.announce)
    + relative(metrics.peopleCount, baseline.peopleCount)
    + relative(metrics.average, baseline.average)
    + relative(metrics.maxCount, baseline.maxCount);
}

/**
 * 統計模擬結果違反了多少條 HARD 規則。任何一項不為 0 都代表該組合產生了不合法的職事表。
 *
 * ## ⚠️ 第十八輪批次階段 A1 修正：漏傳 roles／personPostExclusions
 *
 * 呢個函式手砌一個 verifyContext 畀 `checkHardRuleViolations_()`。第十六輪
 * 將兩條身分硬規則加入嗰個檢查函式嗰陣，**冇更新呢個呼叫點**，於是
 * `context.roles` 係 `undefined`，被當時嘅 `|| []` 靜靜噉當成空陣列，
 * `personHasAnyRoleOn_([], ...)` 對每個人都 false ⇒ **每一格有身分要求嘅
 * 崗位都被當成違規**。實際後果：參數掃描 12 組全部報「硬規則違反 26」
 * （＝ 13 個報告格 ＋ 13 個當值堂委格），12 行全部標成失敗色，
 * 而同一季真正生成出嚟嘅 v0 其實係 0 違反。
 *
 * 修正：由 `context` 直接沿用兩個欄位。`context` 來自
 * `buildGeneratorContext_()`，嗰度已經係用 `buildRoleContext_()` 讀好，
 * 所以呢度**唔會另外讀一次工作表**，亦都保證同生成器睇到同一份資料。
 *
 * 同時 `checkHardRuleViolations_()` 而家會對缺欄位直接拋錯
 * （見 `requireRoleContextField_()`），所以同類漏傳日後唔可能再靜靜發生。
 *
 * @param {Object} context 排表 context（由 buildGeneratorContext_() 產生）
 * @param {{assignments: Object[]}} result buildRoster_() 的結果
 * @returns {number} 硬規則違反總數
 */
function countHardViolations_(context, result) {
  const verifyContext = {
    posts: context.posts,
    serviceDates: context.serviceDates,
    eligibility: context.eligibility,
    unavailable: context.unavailable,
    roles: context.roles,
    personPostExclusions: context.personPostExclusions,
    assignments: result.assignments
  };
  return checkHardRuleViolations_(verifyContext).total;
}

/**
 * 第十八輪批次階段 B：偵測「某個參數喺整個掃描範圍入面完全冇改變過結果」。
 *
 * 判斷方法：把結果按**另一個**參數分組，喺每一組入面睇「本參數不同值」
 * 嘅結果指標係咪完全一樣。全部組都一樣 ⇒ 呢個參數喺呢個取樣範圍飽和咗
 * （或者根本冇生效），提示幹事試更細嘅值。
 *
 * 純函式，方便測試。
 *
 * @param {Object[]} rows 掃描結果（每項含 chairDualBonus／historicalWeight 與各指標）
 * @returns {string[]} 提示文字；冇發現飽和時回傳空陣列
 */
function buildTuneSaturationNotes_(rows) {
  const notes = [];
  const signature = function (r) {
    return [r.chairEqRatio, r.announceRatio, r.peopleCount, r.average, r.maxCount, r.deviation].join('|');
  };

  // CHAIR_DUAL_BONUS：以 historicalWeight 分組
  const byWeight = {};
  rows.forEach(function (r) {
    const key = String(r.historicalWeight);
    if (!byWeight[key]) byWeight[key] = [];
    byWeight[key].push(r);
  });

  const weightKeys = Object.keys(byWeight);
  const allIdentical = weightKeys.length > 0 && weightKeys.every(function (key) {
    const group = byWeight[key];
    if (group.length < 2) return false; // 一組得一個值，比較唔到
    const first = signature(group[0]);
    return group.every(function (r) { return signature(r) === first; });
  });

  if (allIdentical) {
    const values = rows.map(function (r) { return r.chairDualBonus; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; });
    notes.push('CHAIR_DUAL_BONUS 由 ' + values[0] + ' 到 ' + values[values.length - 1]
      + ' 之間，全部組合的六項指標完全一樣——代表這個範圍已經「飽和」，'
      + '再加大改變不到任何排班結果。');
    notes.push('原因：這個加分是一個固定值，一旦大過候選人之間'
      + '「選人分數 × SELECTION_WEIGHT」的最大差距，全部雙重合資格的人就已經'
      + '穩定排在非雙重合資格的人前面，再加大也改變不了次序（門檻型參數，不是連續型）。');
    notes.push('建議：想比較出分別，試更細的值（例如 0／5／10／15／20）。'
      + '飽和點會隨候選池大小與歷史次數分佈改變，沒有一個固定數字。');
  }

  return notes;
}

/**
 * 讀取上次未完成的掃描進度。季度不同或沒有紀錄時，從頭開始。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, nextIndex: number, rows: Object[]}} 進度物件
 */
function loadTuneProgress_(quarterId) {
  const raw = PropertiesService.getScriptProperties().getProperty(TUNE_PROGRESS_KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      if (saved && saved.quarterId === quarterId) return saved;
    } catch (err) {
      log_('WARN', 'tuneParameters: 進度紀錄損毀，重新開始。' + err.message);
    }
  }
  return { quarterId: quarterId, nextIndex: 0, rows: [] };
}

/**
 * 把掃描進度存入 Script Properties，供下次執行接續。
 * @param {Object} progress 進度物件
 * @returns {void}
 */
function saveTuneProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(TUNE_PROGRESS_KEY, JSON.stringify(progress));
}

/**
 * 清除掃描進度紀錄。
 * @returns {void}
 */
function clearTuneProgress_() {
  PropertiesService.getScriptProperties().deleteProperty(TUNE_PROGRESS_KEY);
}

/**
 * 把掃描結果寫入 Tune_Result 工作表（同名工作表會重建），最佳一行標綠色。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} sortedRows 已按總偏差由細至大排序的結果
 * @param {Object} baseline 基準值
 * @returns {string} 工作表名稱
 */
function writeTuneSheet_(quarterId, sortedRows, baseline) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = SHEETS.TUNE_RESULT;
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  sheet.getRange(1, 1).setValue(
    '參數掃描結果　' + quarterId
      + '　執行時間：' + nowTimestamp_()
      + '　基準：主席兼報告 ' + baseline.chairEq + '、報告連續 ' + baseline.announce
      + '、用人數 ' + baseline.peopleCount + '、平均 ' + baseline.average + '、最高 ' + baseline.maxCount
      + '　（全部為記憶體模擬，未寫入任何職事表版本）'
  );

  const headers = ['CHAIR_DUAL_BONUS', 'WEIGHT_HISTORICAL', '主席兼報告%', '報告連續%',
    '用人數', '平均次數', '最高次數', '硬規則違反數', '與歷史基準的總偏差'];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  const rows = sortedRows.map(function (r) {
    return [
      r.chairDualBonus,
      r.historicalWeight,
      Number((r.chairEqRatio * 100).toFixed(1)),
      Number((r.announceRatio * 100).toFixed(1)),
      r.peopleCount,
      Number(r.average.toFixed(2)),
      r.maxCount,
      r.hardViolations,
      Number(r.deviation.toFixed(4))
    ];
  });
  sheet.getRange(3, 1, rows.length, headers.length).setValues(rows);

  // 最佳組合（總偏差最細）標綠色；有硬規則違反的行標紅色，因為那一組不可採用
  const backgrounds = sortedRows.map(function (r, i) {
    const color = r.hardViolations > 0 ? SELF_TEST_COLORS.FAIL
      : (i === 0 ? SELF_TEST_COLORS.PASS : null);
    return new Array(headers.length).fill(color);
  });
  sheet.getRange(3, 1, backgrounds.length, headers.length).setBackgrounds(backgrounds);

  // 第十八輪批次階段 B：報告要識得自己講「呢個參數喺呢個範圍冇作用」。
  //
  // 起因：舊 grid 嘅四個 CHAIR_DUAL_BONUS 值全部落喺飽和區，12 行嘅六項
  // 指標四位小數完全一樣。當時冇任何提示，睇報告嘅人只會覺得「奇怪」，
  // 要自己去追先知道係取樣範圍問題而唔係參數失效。而家直接寫出嚟。
  const notes = buildTuneSaturationNotes_(sortedRows);
  if (notes.length > 0) {
    const noteRow = 3 + rows.length + 1;
    sheet.getRange(noteRow, 1).setValue('⚠️ 參數敏感度提示');
    sheet.getRange(noteRow, 1).setFontWeight('bold');
    notes.forEach(function (note, i) {
      sheet.getRange(noteRow + 1 + i, 1).setValue(note);
    });
  }

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, headers.length);
  return sheetName;
}
