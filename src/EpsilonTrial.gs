/**
 * 「試算不同 epsilon 的效果」（唯讀，只寫 Diagnostics）。
 *
 * 背景：第九輪批次階段 B 為 `compareCandidates_()` 加了分數容差
 * （Config 的 `SCORE_TIE_EPSILON`），令 `RANDOM_SEED` 的隨機決勝真正生效。
 * 但**預設值是 0（完全不啟用）**，因為離線 mock 資料證明得了「容差確實會
 * 產生不同的表、而且硬規則永遠零違反」，卻證明不了「用真實的人手與資格資料
 * 跑出來，哪一個容差值排出來的表比較好」——後者只有用真實資料量度才知道。
 *
 * 這個工具就是為了填補那一步：用**真實資料**、在記憶體裡為每個候選 epsilon
 * 各生成 N 份職事表，只計算並顯示品質指標，讓幹事看過數字再決定要不要把
 * Config 的 `SCORE_TIE_EPSILON` 改成非零值。
 *
 * 唯讀保證（這是本工具最重要的性質）：
 * - 完全**不呼叫** `performRosterGeneration_()`、`createRosterSheet()`、
 *   `writeAssignments()`、`registerVersion()` 這些會寫入的函式；
 * - 只呼叫 `buildGeneratorContext_()`（讀）與 `buildRoster_()`（純運算，
 *   `Generator.gs` 全檔沒有任何 Google Apps Script API 呼叫，見
 *   `tests/helpers/gas_loader.js` 的查證說明）；
 * - 唯一的寫入是 `writeDiagnosticsReport_()`；
 * - **不會改動 Config**——`epsilon` 是直接寫進記憶體中的 context 物件，
 *   不經過 Config 工作表，執行完 Config 的 `SCORE_TIE_EPSILON` 仍然是原值。
 *
 * 刻意不重用 `compareMultiRun()`：那個函式會建立 `MultiRun_Result` 工作表，
 * 不是唯讀的，而且它只跑一組設定，沒有「同一份資料、不同 epsilon 對照」的概念。
 */

/** 試算時預設要比較的 epsilon 值。0 一定排第一，作為「現狀」的對照組。 */
const EPSILON_TRIAL_DEFAULT_VALUES = [0, 0.5, 1, 2, 5];

/** 每個 epsilon 值預設試跑幾個 seed。 */
const EPSILON_TRIAL_DEFAULT_SEEDS = 10;

/**
 * 第十輪批次階段 C：非零 epsilon 至少要把總偏差改善呢個比率，先值得建議去改設定。
 * 改善得太少（例如 1%）唔值得為咗佢動一個影響全部排表嘅設定，維持 0 更保守。
 */
const EPSILON_TRIAL_MIN_IMPROVEMENT = 0.05;

/**
 * 第十輪批次階段 C3：整個試算最多生成幾多份職事表。
 *
 * 實測（89 人／13 週／18 個崗位欄）：每份約 18 毫秒（Node），Apps Script 保守
 * 估 15–25 倍即每份約 0.3–0.45 秒。預設 5 個 epsilon × 10 seed ＝ 50 份，
 * 約 13–22 秒，離 6 分鐘上限好遠。但幹事可以自己輸入 epsilon 清單同 seed 數，
 * 例如 10 個值 × 50 seed ＝ 500 份就會去到 150–225 秒，開始接近上限。
 * 所以加一個總量上限，超出就唔跑、直接叫佢分開幾次試。
 */
const EPSILON_TRIAL_MAX_TOTAL_ROSTERS = 200;

/**
 * 單一 epsilon 值的試算：用同一份 context、連續 N 個 seed 各生成一份表，
 * 統計「產生了多少份真正不同的表」與各項品質指標。
 *
 * @param {Object} context `buildGeneratorContext_()` 的結果（會被就地改動
 *   `randomSeed`／`scoreTieEpsilon`，呼叫端負責在全部試算完之後不再使用它）
 * @param {number} epsilon 要試的容差值
 * @param {number} seedCount 要試幾個 seed
 * @param {?{chairPostId: string, announcePostId: string}} scope 主席／報告崗位
 * @param {Object} baseline 歷史基準（`readTuneBaseline_()` 的結果）
 * @returns {Object} 這個 epsilon 的統計結果
 */
function runEpsilonTrialFor_(context, epsilon, seedCount, scope, baseline) {
  const baseSeed = context.randomSeed;
  const signatures = {};
  const records = [];
  let hardViolationTotal = 0;
  let worstHardViolations = 0;

  for (let i = 0; i < seedCount; i++) {
    context.randomSeed = baseSeed + i;
    context.scoreTieEpsilon = epsilon;

    const roster = buildRoster_(context);
    const signature = buildRosterSignature_(roster);
    signatures[signature] = true;

    const evaluation = evaluateRosterQuality_(context, roster, scope, baseline);
    hardViolationTotal += evaluation.hardViolations;
    if (evaluation.hardViolations > worstHardViolations) worstHardViolations = evaluation.hardViolations;

    records.push({
      seed: context.randomSeed,
      chairEq: evaluation.metrics.chairEq,
      announce: evaluation.metrics.announce,
      peopleCount: evaluation.metrics.peopleCount,
      average: evaluation.metrics.average,
      maxCount: evaluation.metrics.maxCount,
      hardViolations: evaluation.hardViolations,
      deviation: evaluation.deviation,
      chiSquare: evaluation.chiSquare,
      semiHardWarnings: countSemiHardWarnings_(roster)
    });
  }

  context.randomSeed = baseSeed;
  return summariseEpsilonTrialRecords_(epsilon, seedCount,
    Object.keys(signatures).length, hardViolationTotal, worstHardViolations, records);
}

/**
 * 統計某個 epsilon 試算出來的一組結果。抽成獨立的純函式，令測試可以直接
 * 餵假的 records 驗證統計邏輯，不需要真的跑生成器。
 * @param {number} epsilon 容差值
 * @param {number} seedCount 試了幾個 seed
 * @param {number} distinctRosters 產生了幾份真正不同的表
 * @param {number} hardViolationTotal 全部試跑的硬規則違反總數
 * @param {number} worstHardViolations 單一份表最多有幾項硬規則違反
 * @param {Object[]} records 每次試跑的紀錄
 * @returns {Object} 統計結果
 */
function summariseEpsilonTrialRecords_(epsilon, seedCount, distinctRosters,
  hardViolationTotal, worstHardViolations, records) {
  const pickNumbers = function (field) {
    return records.map(function (r) { return r[field]; })
      .filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
  };
  const range = function (values) {
    if (values.length === 0) return null;
    let min = values[0];
    let max = values[0];
    let sum = 0;
    values.forEach(function (v) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    });
    return { min: min, max: max, mean: sum / values.length, spread: max - min };
  };

  return {
    epsilon: epsilon,
    seedCount: seedCount,
    distinctRosters: distinctRosters,
    hardViolationTotal: hardViolationTotal,
    worstHardViolations: worstHardViolations,
    chairEq: range(pickNumbers('chairEq')),
    announce: range(pickNumbers('announce')),
    peopleCount: range(pickNumbers('peopleCount')),
    average: range(pickNumbers('average')),
    maxCount: range(pickNumbers('maxCount')),
    deviation: range(pickNumbers('deviation')),
    chiSquare: range(pickNumbers('chiSquare')),
    semiHardWarnings: range(pickNumbers('semiHardWarnings')),
    records: records
  };
}

/**
 * 第十輪批次階段 C：**由程式直接判斷應該用邊一個 epsilon 值**，唔係丟一堆
 * 指標俾幹事自己諗。
 *
 * 判斷準則刻意對齊 `generateBest()` 實際做緊嘅嘢：佢跑 N 次然後**揀最好嗰份**，
 * 所以真正緊要嘅唔係平均品質，而係「最好嗰份可以去到幾好」——即係
 * `deviation.min`（總偏差最細嗰份，`generateBest()` 就係揀佢）。
 *
 * 逐層篩選：
 * 1. 硬規則違反必須係 0——有違反嘅一律出局，冇得商量。
 * 2. 準硬規則（同崗位連續兩週）唔可以比 epsilon=0 差。
 * 3. 喺剩低嘅之中揀 `deviation.min` 最細嗰個。
 * 4. 要贏 epsilon=0 至少 `EPSILON_TRIAL_MIN_IMPROVEMENT`（相對改善率），
 *    贏得太少就唔值得改設定——維持 0 更保守。
 * 5. 同分時揀**較細**嗰個 epsilon（容差越細，優勝者偏離最佳分數嘅上界越細）。
 *
 * @param {Object[]} trials `runEpsilonTrialFor_()` 的結果陣列
 * @param {number} preferenceBonus Config 的 SCORE_PREFERENCE_BONUS（用來提醒
 *   「epsilon 唔可以大到蓋過獎勵分」）
 * @returns {{value: number, reason: string, warnings: string[], baselineDeviation: ?number,
 *   bestDeviation: ?number, improvementRatio: ?number}}
 */
function recommendEpsilon_(trials, preferenceBonus) {
  const warnings = [];
  const deviationOf = function (t) {
    return (t.deviation && !isNaN(t.deviation.min)) ? t.deviation.min : null;
  };
  const semiOf = function (t) {
    return (t.semiHardWarnings && !isNaN(t.semiHardWarnings.min)) ? t.semiHardWarnings.min : 0;
  };

  const baseline = trials.filter(function (t) { return t.epsilon === 0; })[0] || null;
  const baselineDeviation = baseline ? deviationOf(baseline) : null;
  const baselineSemi = baseline ? semiOf(baseline) : null;

  if (!baseline) {
    return {
      value: 0, warnings: warnings, baselineDeviation: null, bestDeviation: null,
      improvementRatio: null,
      reason: '試算清單裡沒有 epsilon = 0 這一組，無法跟「現狀」比較。'
        + '請重跑一次並在 epsilon 清單中加入 0。'
    };
  }

  const dirty = trials.filter(function (t) { return t.hardViolationTotal > 0; });
  if (dirty.length > 0) {
    warnings.push('有 ' + dirty.length + ' 個 epsilon 值出現硬規則違反（'
      + dirty.map(function (t) { return t.epsilon; }).join('、')
      + '），這些值一律不可使用。正常情況不應該發生，如果見到請告訴 Claude。');
  }

  const candidates = trials.filter(function (t) {
    if (t.epsilon <= 0) return false;
    if (t.hardViolationTotal > 0) return false;
    if (deviationOf(t) === null) return false;
    // 準硬規則唔可以比現狀差
    if (baselineSemi !== null && semiOf(t) > baselineSemi) return false;
    // 冇多樣性就等於冇改變，唔使考慮
    return t.distinctRosters > 1;
  });

  if (candidates.length === 0 || baselineDeviation === null) {
    return {
      value: 0, warnings: warnings, baselineDeviation: baselineDeviation, bestDeviation: null,
      improvementRatio: null,
      reason: '沒有任何非零值同時做到「產生多份不同的表」「硬規則違反 0」'
        + '「準硬規則不比現狀差」。建議維持 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' = 0（即不啟用）。'
    };
  }

  candidates.sort(function (a, b) {
    const da = deviationOf(a);
    const db = deviationOf(b);
    if (Math.abs(da - db) > 1e-9) return da - db;
    return a.epsilon - b.epsilon; // 同分揀較保守（較細）嗰個
  });
  const best = candidates[0];
  const bestDeviation = deviationOf(best);
  const improvementRatio = baselineDeviation > 0
    ? (baselineDeviation - bestDeviation) / baselineDeviation
    : (bestDeviation < baselineDeviation ? 1 : 0);

  if (improvementRatio < EPSILON_TRIAL_MIN_IMPROVEMENT) {
    return {
      value: 0, warnings: warnings,
      baselineDeviation: baselineDeviation, bestDeviation: bestDeviation,
      improvementRatio: improvementRatio,
      reason: '最好的非零值是 ' + best.epsilon + '，但它只把總偏差由 '
        + baselineDeviation.toFixed(4) + ' 改善到 ' + bestDeviation.toFixed(4)
        + '（改善 ' + (improvementRatio * 100).toFixed(1) + '%），'
        + '低於值得改設定的門檻 ' + (EPSILON_TRIAL_MIN_IMPROVEMENT * 100).toFixed(0) + '%。'
        + '建議維持 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' = 0（即不啟用），改動不划算。'
    };
  }

  // 安全提醒：epsilon 大到接近獎勵分量級時，軟規則偏好會被蓋過
  if (preferenceBonus > 0 && best.epsilon >= preferenceBonus / 2) {
    warnings.push('建議值 ' + best.epsilon + ' 已經達到獎勵分量級（'
      + CONFIG_KEYS.SCORE_PREFERENCE_BONUS + ' = ' + preferenceBonus
      + '）的一半以上。容差太大會蓋過「主席兼報告」這類軟規則偏好，'
      + '令服侍次數分佈被拉平。採用前請一併看上面的「平均次數」與「最高次數」，'
      + '確認仍然貼近歷史（平均約 3.3 次、最高約 8 次）。');
  }

  return {
    value: best.epsilon, warnings: warnings,
    baselineDeviation: baselineDeviation, bestDeviation: bestDeviation,
    improvementRatio: improvementRatio,
    reason: '在 ' + best.seedCount + ' 個 seed 之中，它排得出的最好一份總偏差是 '
      + bestDeviation.toFixed(4) + '，比現狀（epsilon = 0）的 '
      + baselineDeviation.toFixed(4) + ' 改善 ' + (improvementRatio * 100).toFixed(1) + '%；'
      + '硬規則違反 0 項，準硬規則沒有比現狀差，而且產生了 '
      + best.distinctRosters + ' / ' + best.seedCount + ' 份不同的表——'
      + '「多次生成揀最好」到這裡才真正發揮作用。'
  };
}

/**
 * 統計一份生成結果裡準硬規則（`SEMI_NO_CONSECUTIVE`）的警告數。
 * `evaluateRosterQuality_()` 只算硬規則違反，準硬規則要另外數。
 * @param {{warnings: Object[]}} roster `buildRoster_()` 的結果
 * @returns {number} 準硬規則警告數
 */
function countSemiHardWarnings_(roster) {
  return roster.warnings.filter(function (w) {
    return w.ruleId === RULE_IDS.NO_CONSECUTIVE;
  }).length;
}

/**
 * 執行完整的 epsilon 試算：對每個候選值各跑一輪，回傳全部結果。唯讀。
 * @param {string} quarterId 季度 ID
 * @param {number[]=} epsilonValues 要比較的容差值；未提供時用 `EPSILON_TRIAL_DEFAULT_VALUES`
 * @param {number=} seedCount 每個容差值試幾個 seed；未提供時用 `EPSILON_TRIAL_DEFAULT_SEEDS`
 * @returns {{quarterId: string, seedCount: number, configuredEpsilon: number, trials: Object[]}}
 */
function runEpsilonTrial_(quarterId, epsilonValues, seedCount) {
  const values = (epsilonValues && epsilonValues.length > 0)
    ? epsilonValues : EPSILON_TRIAL_DEFAULT_VALUES;
  const seeds = Math.max(1, Math.round(seedCount || EPSILON_TRIAL_DEFAULT_SEEDS));

  // 階段 C3：總量把關。實測每份約 0.3–0.45 秒（Apps Script，89 人／13 週），
  // 超過上限就唔跑——寧可叫幹事分兩次試，都好過跑到一半撞正 6 分鐘上限、
  // 咩結果都拎唔到。
  const totalRosters = values.length * seeds;
  if (totalRosters > EPSILON_TRIAL_MAX_TOTAL_ROSTERS) {
    throw new Error('這次試算要生成 ' + totalRosters + ' 份職事表（'
      + values.length + ' 個 epsilon × ' + seeds + ' 個 seed），超出單次上限 '
      + EPSILON_TRIAL_MAX_TOTAL_ROSTERS + ' 份。\n\n'
      + 'Apps Script 單次執行上限是 6 分鐘，每份大約需要 0.3–0.45 秒，'
      + '跑太多會中途被系統中斷、白做一場。\n\n'
      + '建議：減少 epsilon 的數目或 seed 數（例如 5 個值 × 10 個 seed ＝ 50 份，'
      + '大約 15–25 秒），或者分兩次試不同的值。');
  }

  const context = buildGeneratorContext_(quarterId);
  const configuredEpsilon = context.scoreTieEpsilon;
  const scope = getChairAnnounceScope_(context.rules);
  const baseline = readTuneBaseline_(context.rules);

  const trials = values.map(function (epsilon) {
    return runEpsilonTrialFor_(context, epsilon, seeds, scope, baseline);
  });

  // 還原記憶體中的 context（這個物件本來就只活在這次執行裡，還原純粹是
  // 為了任何後續讀取都看到真實的 Config 值，不是為了寫回工作表）
  context.scoreTieEpsilon = configuredEpsilon;

  return {
    quarterId: quarterId,
    seedCount: seeds,
    configuredEpsilon: configuredEpsilon,
    trials: trials,
    // 階段 C2：建議值由程式算，唔係丟一堆數字俾幹事自己判斷
    recommendation: recommendEpsilon_(trials, context.scoreWeights.preferenceBonus)
  };
}

/**
 * 把試算結果組成 Diagnostics 的行陣列。
 * @param {Object} trial `runEpsilonTrial_()` 的結果
 * @returns {Object[]} `diagRow_()` 產生的行陣列
 */
function buildEpsilonTrialRows_(trial) {
  const rows = [];
  const fmtRange = function (r, asPercent, digits) {
    if (!r) return '-';
    const f = function (v) {
      return asPercent ? (v * 100).toFixed(1) + '%' : v.toFixed(digits === undefined ? 2 : digits);
    };
    return r.min === r.max ? f(r.min) : f(r.min) + ' – ' + f(r.max) + '（平均 ' + f(r.mean) + '）';
  };

  rows.push(diagRow_('試算設定', trial.quarterId,
    '每個 epsilon 各試 ' + trial.seedCount + ' 個 seed',
    'Config 目前的 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' ＝ ' + trial.configuredEpsilon
      + '　（本試算完全在記憶體進行，沒有改動 Config、沒有建立任何版本或工作表）'));

  // ---- 階段 C2：每個 epsilon 一行，最重要嘅數字排喺前面 ----
  // 修正前係每個 epsilon 出 10 行指標（5 個值就 50 行），要橫向比較就要
  // 上上下下捲——幹事根本睇唔出邊個好。而家改成一個值一行。
  const best = trial.recommendation ? trial.recommendation.value : 0;
  trial.trials.forEach(function (t) {
    const label = 'epsilon = ' + t.epsilon
      + (t.epsilon === 0 ? '（現狀）' : '')
      + (t.epsilon === best && best > 0 ? '　⭐ 建議' : '');
    const bestDeviation = (t.deviation && !isNaN(t.deviation.min)) ? t.deviation.min.toFixed(4) : '-';
    rows.push(diagRow_('逐個 epsilon 比較', label,
      '最好一份的總偏差 ' + bestDeviation
        + '　｜　排出 ' + t.distinctRosters + '/' + t.seedCount + ' 份不同的表'
        + '　｜　硬規則違反 ' + t.worstHardViolations + ' 項',
      '總偏差越細越貼近歷史基準（「多次生成揀最好」就是揀這個數字最細的一份）。'
        + '　主席兼報告 ' + fmtRange(t.chairEq, true)
        + '　報告連續 ' + fmtRange(t.announce, true)
        + '　用人數 ' + fmtRange(t.peopleCount, false, 0)
        + '　平均次數 ' + fmtRange(t.average, false, 2)
        + '　最高次數 ' + fmtRange(t.maxCount, false, 0)
        + '　準硬規則警告 ' + fmtRange(t.semiHardWarnings, false, 1)
        + '　卡方距離 ' + fmtRange(t.chiSquare, false, 2)));
  });

  // ---- 階段 C2：結論。判斷邏輯喺 recommendEpsilon_()，唔係靠人睇數字 ----
  const rec = trial.recommendation;
  if (rec) {
    rows.push(diagRow_('★ 結論', '建議值',
      CONFIG_KEYS.SCORE_TIE_EPSILON + ' = ' + rec.value
        + (rec.value === 0 ? '（維持現狀，不要改）' : '（建議改成這個值）'),
      rec.reason));

    if (rec.value !== trial.configuredEpsilon) {
      rows.push(diagRow_('★ 結論', '要怎樣做',
        '去 Config 工作表，把 ' + CONFIG_KEYS.SCORE_TIE_EPSILON
          + ' 由目前的 ' + trial.configuredEpsilon + ' 改成 ' + rec.value,
        '改完之後，下一次「步驟 1：生成初稿」就會用新設定。'
          + '本工具不會自動改 Config——要不要採用由你決定。'));
    } else {
      rows.push(diagRow_('★ 結論', '要怎樣做', '不用做任何事',
        'Config 目前的 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' 已經是 '
          + trial.configuredEpsilon + '，跟建議值一樣。'));
    }

    (rec.warnings || []).forEach(function (w, i) {
      rows.push(diagRow_('★ 結論', '⚠️ 提醒 ' + (i + 1), '請留意', w));
    });
  }

  return rows;
}

/**
 * 選單項目「查看 ▸ 試算不同 epsilon 的效果（唯讀）」的執行入口。
 * @returns {void}
 */
function runEpsilonTrial_Menu_() {
  const ui = SpreadsheetApp.getUi();
  const title = '試算不同 epsilon 的效果（唯讀）';

  const quarterResponse = ui.prompt(title, '請輸入 QuarterID（例如 2026T4）：', ui.ButtonSet.OK_CANCEL);
  if (quarterResponse.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(quarterResponse.getResponseText());
  if (!quarterId) {
    ui.alert(title, '未輸入 QuarterID，已取消。', ui.ButtonSet.OK);
    return;
  }

  const epsilonResponse = ui.prompt(title,
    '要比較哪些 epsilon 值？用逗號分隔，留空 = ' + EPSILON_TRIAL_DEFAULT_VALUES.join('、') + '：',
    ui.ButtonSet.OK_CANCEL);
  if (epsilonResponse.getSelectedButton() !== ui.Button.OK) return;
  const epsilonText = epsilonResponse.getResponseText().trim();

  let epsilonValues = null;
  if (epsilonText !== '') {
    epsilonValues = epsilonText.split(',').map(function (s) { return Number(s.trim()); });
    const bad = epsilonValues.filter(function (v) { return isNaN(v) || v < 0; });
    if (bad.length > 0) {
      ui.alert(title, 'epsilon 必須是 0 或正數，收到的內容有無效值：「' + epsilonText + '」。', ui.ButtonSet.OK);
      return;
    }
  }

  const seedResponse = ui.prompt(title,
    '每個 epsilon 各試幾個 seed？留空 = ' + EPSILON_TRIAL_DEFAULT_SEEDS + '：', ui.ButtonSet.OK_CANCEL);
  if (seedResponse.getSelectedButton() !== ui.Button.OK) return;
  const seedText = seedResponse.getResponseText().trim();
  const seedCount = seedText === '' ? EPSILON_TRIAL_DEFAULT_SEEDS : Number(seedText);
  if (isNaN(seedCount) || seedCount < 1) {
    ui.alert(title, 'seed 數必須是 1 以上的整數，收到的是「' + seedText + '」。', ui.ButtonSet.OK);
    return;
  }

  let trial;
  try {
    trial = runEpsilonTrial_(quarterId, epsilonValues, seedCount);
  } catch (err) {
    log_('ERROR', 'runEpsilonTrial_Menu_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  // 第十二輪批次階段 C【bug 修正】：tryWriteDiagnostics_() 回傳嘅係
  // 「有冇成功寫入」嘅布林值，唔係寫入行數，行數應該係 rows.length。
  const epsilonTrialRows = buildEpsilonTrialRows_(trial);
  tryWriteDiagnostics_('epsilon 試算', epsilonTrialRows);
  const written = epsilonTrialRows.length;

  const rec = trial.recommendation;
  const lines = [
    trial.quarterId + '　每個 epsilon 各試 ' + trial.seedCount + ' 個 seed',
    'Config 目前的 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' ＝ ' + trial.configuredEpsilon,
    '',
    '逐個比較（總偏差越細越好）：'
  ];
  trial.trials.forEach(function (t) {
    lines.push('　epsilon ' + t.epsilon
      + '：總偏差 ' + (t.deviation ? t.deviation.min.toFixed(4) : '-')
      + '　排出 ' + t.distinctRosters + '/' + t.seedCount + ' 份不同的表'
      + '　硬規則違反 ' + t.worstHardViolations + ' 項'
      + (rec && t.epsilon === rec.value && rec.value > 0 ? '　⭐ 建議' : ''));
  });

  if (rec) {
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('建議值：' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' = ' + rec.value
      + (rec.value === 0 ? '（維持現狀，不要改）' : ''));
    lines.push('');
    lines.push('理由：' + rec.reason);
    if (rec.value !== trial.configuredEpsilon) {
      lines.push('');
      lines.push('要改的話：去 Config 工作表，把 ' + CONFIG_KEYS.SCORE_TIE_EPSILON
        + ' 由 ' + trial.configuredEpsilon + ' 改成 ' + rec.value + '。');
    } else {
      lines.push('');
      lines.push('Config 目前已經是這個值，不用做任何事。');
    }
    (rec.warnings || []).forEach(function (w) {
      lines.push('');
      lines.push('⚠️ ' + w);
    });
    lines.push('━━━━━━━━━━━━━━━━━━━━');
  }

  lines.push('');
  lines.push('完整明細已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「epsilon 試算」，共 '
    + written + ' 行。');
  lines.push('');
  lines.push('本工具完全唯讀：全部在記憶體生成，沒有建立任何版本或工作表、'
    + '沒有改動 Config、沒有寄出任何電郵。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
