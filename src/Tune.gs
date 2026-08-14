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
 * @param {Object} context 排表 context
 * @param {{assignments: Object[]}} result buildRoster_() 的結果
 * @returns {number} 硬規則違反總數
 */
function countHardViolations_(context, result) {
  const verifyContext = {
    posts: context.posts,
    serviceDates: context.serviceDates,
    eligibility: context.eligibility,
    unavailable: context.unavailable,
    assignments: result.assignments
  };
  return checkHardRuleViolations_(verifyContext).total;
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

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, headers.length);
  return sheetName;
}
