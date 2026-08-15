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
    trials: trials
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

  trial.trials.forEach(function (t) {
    const label = 'epsilon = ' + t.epsilon + (t.epsilon === 0 ? '（現狀）' : '');
    rows.push(diagRow_('產生的表有多少種', label,
      t.distinctRosters + ' 種 / ' + t.seedCount + ' 個 seed',
      t.distinctRosters === 1
        ? '換 seed 完全不影響結果——這正是 epsilon=0 時已知的現象'
        : '換 seed 真的會排出不同的表，「多次生成揀最好」才有意義'));
    rows.push(diagRow_('硬規則違反', label,
      t.worstHardViolations + ' 項（最壞的一份）',
      t.hardViolationTotal === 0
        ? '✅ 全部 ' + t.seedCount + ' 份表都是 0 項——任何 epsilon 值都不可以出現硬規則違反'
        : '⚠️ 總共 ' + t.hardViolationTotal + ' 項，這個 epsilon 值不可使用'));
    rows.push(diagRow_('準硬規則警告（同崗位連續兩週）', label,
      fmtRange(t.semiHardWarnings, false, 1), ''));
    rows.push(diagRow_('主席兼報告比例', label, fmtRange(t.chairEq, true), ''));
    rows.push(diagRow_('報告連續兩週比例', label, fmtRange(t.announce, true), ''));
    rows.push(diagRow_('總用人數', label, fmtRange(t.peopleCount, false, 0), ''));
    rows.push(diagRow_('平均次數', label, fmtRange(t.average, false, 2), ''));
    rows.push(diagRow_('最高次數', label, fmtRange(t.maxCount, false, 0), ''));
    rows.push(diagRow_('總偏差（越細越貼近基準）', label, fmtRange(t.deviation, false, 4),
      '「多次生成揀最好」就是揀這個數字最細的一份'));
    rows.push(diagRow_('與歷史分佈的卡方距離', label, fmtRange(t.chiSquare, false, 2), ''));
  });

  rows.push(diagRow_('怎樣解讀', '建議',
    '揀「產生的表有多種、硬規則違反 0、總偏差的最小值比 epsilon=0 更細」的那個值',
    'epsilon 越大，同分群組越大、隨機性越強，但優勝者的分數也可能比最佳分數差最多 epsilon。'
      + '如果某個 epsilon 產生了多種表、而總偏差的最小值比 epsilon=0 那一行更細，'
      + '代表「多次生成揀最好」真的揀到了更貼近歷史基準的表，值得採用。'
      + '如果全部 epsilon 的總偏差都跟 epsilon=0 差不多，就維持 0 不要改。'));

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
  const quarterId = quarterResponse.getResponseText().trim();
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

  const written = tryWriteDiagnostics_('epsilon 試算', buildEpsilonTrialRows_(trial));

  const lines = [
    trial.quarterId + '　每個 epsilon 各試 ' + trial.seedCount + ' 個 seed',
    'Config 目前的 ' + CONFIG_KEYS.SCORE_TIE_EPSILON + ' ＝ ' + trial.configuredEpsilon,
    ''
  ];
  trial.trials.forEach(function (t) {
    lines.push('epsilon ' + t.epsilon + '：'
      + t.distinctRosters + ' 種表　硬規則違反 ' + t.worstHardViolations + ' 項　'
      + '總偏差 ' + (t.deviation ? t.deviation.min.toFixed(4) : '-') + '（最好的一份）');
  });
  lines.push('');
  lines.push('完整對照表已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「epsilon 試算」，共 '
    + written + ' 行。');
  lines.push('');
  lines.push('本工具完全唯讀：全部在記憶體生成，沒有建立任何版本或工作表、'
    + '沒有改動 Config、沒有寄出任何電郵。');
  lines.push('看完覺得某個 epsilon 值更好，要自己去 Config 把 '
    + CONFIG_KEYS.SCORE_TIE_EPSILON + ' 改成該值才會生效。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
