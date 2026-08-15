/**
 * 用多個不同的 seed 各生成一份完整職事表，計算每份與歷史基準的偏差，回傳最好的一份。
 *
 * 背景：逐格挑選當下最好人選的貪心演算法，無法命中「整季比例」這類全域目標。
 * 與其調校計分參數，不如生成多份候選再揀最貼近基準的一份。
 *
 * 全程在記憶體運算，**不寫入任何工作表、不建立版本**。
 *
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @param {number=} attempts 嘗試次數；未提供時讀 Config 的 MULTIRUN_ATTEMPTS（預設 20）
 * @returns {Object} 最佳結果與全部嘗試的摘要
 */
function generateBest(quarterId, attempts) {
  const context = buildGeneratorContext_(quarterId);
  const baseSeed = context.randomSeed;
  const planned = attempts !== undefined && attempts !== null
    ? Number(attempts)
    : readMultiRunAttempts_();

  const scope = getChairAnnounceScope_(context.rules);
  const baseline = readTuneBaseline_(context.rules);
  const startedAt = Date.now();

  const results = [];
  let best = null;
  let attemptsRun = 0;
  let stoppedByTime = false;
  // 階段 A（Opus 深度輪）新增：偵測「換 seed 有沒有令結果不同」，
  // 見 MULTIRUN_SEED_PROBE_ATTEMPTS（Constants.gs）的完整說明。
  let stoppedBySeedInert = false;
  let firstSignature = null;
  let allIdenticalSoFar = true;
  // 第九輪批次階段 B（B4）：「seed 是不是完全沒作用」這個提早停止偵測，建立在
  // 「換 seed 不會改變結果」這個前提上；而啟用分數容差（SCORE_TIE_EPSILON > 0）
  // 的**目的**正是要推翻那個前提、讓 seed 真正影響選人。容差生效時，頭三次剛好
  // 產生相同的表完全可能只是巧合（例如那三個 seed 下每一格的同分群組都只有一個人），
  // 這時停下來會白白放棄後面本來會產生的不同候選表，令「多次生成揀最好」退化成
  // 「只生成三次」。所以容差非零時整個偵測直接關掉。
  // 容差為 0（預設值）時，這個旗標是 true，行為與上一輪逐字相同。
  const seedProbeEnabled = !(context.scoreTieEpsilon > 0);

  for (let i = 0; i < planned; i++) {
    // seed 由 RANDOM_SEED 遞增產生，令整輪多次生成本身也可完全重現
    const seed = baseSeed + i;
    context.randomSeed = seed;

    const roster = buildRoster_(context);

    const signature = buildRosterSignature_(roster);
    if (i === 0) {
      firstSignature = signature;
    } else if (signature !== firstSignature) {
      allIdenticalSoFar = false;
    }

    const evaluation = evaluateRosterQuality_(context, roster, scope, baseline);
    const record = {
      attemptIndex: i + 1,
      seed: seed,
      chairEqRatio: evaluation.metrics.chairEq,
      announceRatio: evaluation.metrics.announce,
      peopleCount: evaluation.metrics.peopleCount,
      average: evaluation.metrics.average,
      maxCount: evaluation.metrics.maxCount,
      hardViolations: evaluation.hardViolations,
      deviation: evaluation.deviation,
      histogramText: evaluation.histogramText,
      chiSquare: evaluation.chiSquare,
      warningCount: roster.warnings.length
    };
    results.push(record);
    attemptsRun++;

    if (isBetterCandidate_(record, best)) {
      best = record;
      best.roster = roster;
    }

    // 階段 A（Opus 深度輪）新增：頭 MULTIRUN_SEED_PROBE_ATTEMPTS 次如果產生
    // 逐格完全相同的職事表，代表這份資料下換 seed 不會改變結果，再跑下去只是
    // 把同一份表重複算——提早停止。輸出不受影響（見 Constants.gs 的說明）。
    //
    // 第九輪批次階段 B（B4）：啟用了分數容差（SCORE_TIE_EPSILON > 0）時一律
    // 不做這個提早停止（見上面 seedProbeEnabled 的說明）。
    if (seedProbeEnabled && allIdenticalSoFar
      && attemptsRun >= MULTIRUN_SEED_PROBE_ATTEMPTS && attemptsRun < planned) {
      stoppedBySeedInert = true;
      log_('INFO', 'generateBest: 頭 ' + attemptsRun + ' 次生成的職事表逐格完全相同，'
        + '判定這份資料下 RANDOM_SEED 不影響結果，已提早停止（原定 ' + planned + ' 次）。'
        + '最佳結果與跑足全部次數相同。');
      break;
    }

    // 量度單次耗時，若再跑一次會超出預算就停止
    const elapsed = Date.now() - startedAt;
    const averagePerAttempt = elapsed / attemptsRun;
    if (i + 1 < planned && elapsed + averagePerAttempt > MULTIRUN_TIME_BUDGET_MS) {
      stoppedByTime = true;
      log_('WARN', 'generateBest: 為避免超時，只跑了 ' + attemptsRun + ' / ' + planned + ' 次');
      break;
    }
  }

  if (!best) throw new Error('多次生成沒有產生任何結果，請檢查 ' + quarterId + ' 的資料');

  return {
    quarterId: quarterId,
    assignments: best.roster.assignments,
    warnings: best.roster.warnings,
    seed: best.seed,
    attemptIndex: best.attemptIndex,
    attemptsRun: attemptsRun,
    attemptsPlanned: planned,
    stoppedByTime: stoppedByTime,
    stoppedBySeedInert: stoppedBySeedInert,
    deviation: best.deviation,
    hardViolations: best.hardViolations,
    histogramText: best.histogramText,
    chiSquare: best.chiSquare,
    metrics: {
      chairEqRatio: best.chairEqRatio,
      announceRatio: best.announceRatio,
      peopleCount: best.peopleCount,
      average: best.average,
      maxCount: best.maxCount
    },
    results: results
  };
}

/**
 * 階段 A（Opus 深度輪）新增：把一份職事表壓成一個字串簽名，供 generateBest()
 * 判斷兩次生成的結果是否逐格完全相同。
 *
 * 只取「每一格派了誰」——那正是職事表的全部內容，其餘欄位（assignSource、
 * ruleFlags）都是由 personId 與 context 推導出來的，不會出現「派的人一樣但
 * 其他欄位不同」的情況。assignments 的產生順序由 buildRoster_() 的三層迴圈
 * （週 → 崗位 → slot）決定，同一個 context 下必定一致，所以直接串接即可，
 * 不需要另外排序。
 *
 * @param {{assignments: Object[]}} roster buildRoster_() 的結果
 * @returns {string} 簽名字串
 */
function buildRosterSignature_(roster) {
  return roster.assignments.map(function (a) { return a.personId || ''; }).join('|');
}

/**
 * 判斷一份新結果是否比目前最佳的更好。
 * 硬規則違反優先於偏差：有違反的一律排在無違反之後，
 * 確保只要有一份合法的職事表，就絕不會採用不合法的那些。
 * @param {Object} candidate 新的結果
 * @param {?Object} best 目前最佳的結果
 * @returns {boolean} 新結果是否較好
 */
function isBetterCandidate_(candidate, best) {
  if (!best) return true;
  const candidateClean = candidate.hardViolations === 0;
  const bestClean = best.hardViolations === 0;
  if (candidateClean !== bestClean) return candidateClean;
  if (candidate.hardViolations !== best.hardViolations) {
    return candidate.hardViolations < best.hardViolations;
  }
  return candidate.deviation < best.deviation;
}

/**
 * 計算一份職事表的各項指標、硬規則違反數與總偏差。
 * @param {Object} context 排表 context
 * @param {{assignments: Object[]}} roster buildRoster_() 的結果
 * @param {?{chairPostId: string, announcePostId: string}} scope 主席與報告的崗位；缺少時兩項比例不計入偏差
 * @param {Object} baseline 歷史基準值
 * @returns {{metrics: Object, hardViolations: number, deviation: number}} 評估結果
 */
function evaluateRosterQuality_(context, roster, scope, baseline) {
  const counts = {};
  roster.assignments.forEach(function (a) {
    if (!a.personId) return;
    counts[a.personId] = (counts[a.personId] || 0) + 1;
  });
  const values = Object.keys(counts).map(function (k) { return counts[k]; });
  const total = values.reduce(function (sum, v) { return sum + v; }, 0);

  const metrics = {
    chairEq: null,
    announce: null,
    peopleCount: values.length,
    average: values.length === 0 ? 0 : total / values.length,
    maxCount: values.reduce(function (m, v) { return v > m ? v : m; }, 0)
  };

  if (scope) {
    const summary = summariseTrace_(roster, context, scope);
    metrics.chairEq = summary.chairEqRatio;
    metrics.announce = summary.announceRatio;
  }

  const histogram = buildCountHistogram_(values);
  return {
    metrics: metrics,
    histogram: histogram,
    histogramText: formatHistogram_(histogram),
    chiSquare: computeDistributionChiSquare_(histogram),
    hardViolations: countHardViolations_(context, roster),
    deviation: computeTuneDeviation_(metrics, baseline)
  };
}

/**
 * 把每人服侍次數整理成「次數 → 人數」的分佈。
 * @param {number[]} values 每個人的服侍次數
 * @returns {Object.<number, number>} {次數: 人數}
 */
function buildCountHistogram_(values) {
  const histogram = {};
  values.forEach(function (v) { histogram[v] = (histogram[v] || 0) + 1; });
  return histogram;
}

/**
 * 把分佈格式化為「1:17 2:11 3:14 …」的字串，按次數由小至大排列。
 * @param {Object.<number, number>} histogram 分佈
 * @returns {string} 格式化字串
 */
function formatHistogram_(histogram) {
  return Object.keys(histogram)
    .map(Number)
    .sort(function (a, b) { return a - b; })
    .map(function (count) { return count + ':' + histogram[count]; })
    .join(' ');
}

/**
 * 計算本次分佈與歷史分佈的卡方距離，數值越細代表形狀越貼近歷史。
 *
 * 不把歷史分佈按人數縮放：用人數本身的差異也應該反映為距離。
 * 歷史沒有出現過的次數（例如 9 次以上）其期望值為 0，除數以 1 為下限避免除以零。
 *
 * @param {Object.<number, number>} histogram 本次的分佈
 * @returns {number} 卡方距離
 */
function computeDistributionChiSquare_(histogram) {
  const buckets = {};
  Object.keys(HISTORICAL_BASELINE_DISTRIBUTION).forEach(function (k) { buckets[k] = true; });
  Object.keys(histogram).forEach(function (k) { buckets[k] = true; });

  let chiSquare = 0;
  Object.keys(buckets).forEach(function (k) {
    const observed = histogram[k] || 0;
    const expected = HISTORICAL_BASELINE_DISTRIBUTION[k] || 0;
    const denominator = Math.max(expected, 1);
    chiSquare += Math.pow(observed - expected, 2) / denominator;
  });
  return chiSquare;
}

/**
 * 讀取 Config 的 MULTIRUN_ATTEMPTS。此 Key 為選填，缺少或無效時採用預設值。
 * @returns {number} 嘗試次數，至少為 1
 */
function readMultiRunAttempts_() {
  const config = readConfig();
  const attempts = readNumericConfig_(config, CONFIG_KEYS.MULTIRUN_ATTEMPTS, DEFAULTS.MULTIRUN_ATTEMPTS);
  return Math.max(1, Math.round(attempts));
}

/**
 * 把多次生成的全部結果寫入 MultiRun_Result 工作表（同名工作表會重建），
 * 依總偏差由細至大排序，最佳一行標綠色、有硬規則違反的行標紅色。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} results generateBest() 回傳的 results
 * @param {Object} baseline 歷史基準值
 * @returns {string} 工作表名稱
 */
function writeMultiRunSheet_(quarterId, results, baseline) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = SHEETS.MULTIRUN_RESULT;
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  sheet.getRange(1, 1).setValue(
    '多次生成比較　' + quarterId
      + '　執行時間：' + nowTimestamp_()
      + '　基準：主席兼報告 ' + baseline.chairEq + '、報告連續 ' + baseline.announce
      + '、用人數 ' + baseline.peopleCount + '、平均 ' + baseline.average + '、最高 ' + baseline.maxCount
      + '　歷史次數分佈：' + formatHistogram_(HISTORICAL_BASELINE_DISTRIBUTION)
      + '　（全部為記憶體模擬，未寫入任何職事表版本）'
  );

  const headers = ['次數', 'seed', '主席兼報告%', '報告連續%', '用人數',
    '平均次數', '最高次數', '硬規則違反', '總偏差', '次數分佈', '與歷史分佈的卡方距離'];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  const sorted = results.slice().sort(function (a, b) {
    if (a.hardViolations !== b.hardViolations) return a.hardViolations - b.hardViolations;
    return a.deviation - b.deviation;
  });

  const rows = sorted.map(function (r) {
    return [
      r.attemptIndex,
      r.seed,
      r.chairEqRatio === null ? '-' : Number((r.chairEqRatio * 100).toFixed(1)),
      r.announceRatio === null ? '-' : Number((r.announceRatio * 100).toFixed(1)),
      r.peopleCount,
      Number(r.average.toFixed(2)),
      r.maxCount,
      r.hardViolations,
      Number(r.deviation.toFixed(4)),
      r.histogramText,
      Number(r.chiSquare.toFixed(2))
    ];
  });
  sheet.getRange(3, 1, rows.length, headers.length).setValues(rows);

  const backgrounds = sorted.map(function (r, i) {
    const color = r.hardViolations > 0 ? SELF_TEST_COLORS.FAIL
      : (i === 0 ? SELF_TEST_COLORS.PASS : null);
    return new Array(headers.length).fill(color);
  });
  sheet.getRange(3, 1, backgrounds.length, headers.length).setBackgrounds(backgrounds);

  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, headers.length);
  return sheetName;
}

/**
 * 診斷用：執行多次生成並把全部結果寫入 MultiRun_Result，不建立任何職事表版本。
 * @param {string} quarterId 季度 ID
 * @param {number=} attempts 嘗試次數；未提供時讀 Config
 * @returns {Object} generateBest() 的結果，另附 sheetName
 */
function compareMultiRun(quarterId, attempts) {
  const best = generateBest(quarterId, attempts);
  const baseline = readTuneBaseline_(readRules());
  best.sheetName = writeMultiRunSheet_(quarterId, best.results, baseline);
  return best;
}

/**
 * 生成職事表的完整流程：多次生成揀最好 → 建立 grid 工作表 → 寫入長表 →
 * （v0 時）加保護 → 登記版本。這是選單「生成職事表」、Web UI 的 apiGenerateRoster()、
 * 以及自動排程 dailyAutomationCheck_() 共用的單一入口，避免三處各自重複一份邏輯。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 生成結果：sheetName、versionNo、assigned、blank、warnings、
 *   attemptsRun、attemptsPlanned、stoppedByTime、attemptIndex、seed、deviation、protected
 */
function performRosterGeneration_(quarterId) {
  const genResult = generateBest(quarterId);
  const previousVersionNo = findLatestVersionNo(quarterId);
  const versionNo = previousVersionNo + 1;

  // 先建 grid 工作表：若名稱衝突會在寫入長表之前就中止，避免留下孤兒資料列
  const sheetName = createRosterSheet(quarterId, versionNo, genResult.assignments, genResult.warnings);
  writeAssignments(quarterId, versionNo, genResult.assignments);

  // 階段 G：Apps Script 沒有真正的交易（transaction），grid 工作表與
  // RosterAssignments 這時已經真正寫入了。如果接下來的 protectV0()／
  // registerVersion() 失敗（例如 RosterVersions 剛好被誰刪掉、或一次性的
  // 配額錯誤），會留下「有 grid 工作表、有 RosterAssignments 列，但
  // RosterVersions 完全沒有登記」的孤兒版本——findLatestVersionNo() 找不到它，
  // 之後任何操作都會當作它不存在，等於「做了一半又不知道做到哪」。這裡不嘗試
  // 自動回滾（自動刪除剛寫好的資料风险更高，可能刪錯或刪一半），只在失敗時
  // 把「已經寫了什麼、需要人手怎麼處理」講清楚，讓幹事或下一次對話的 Claude
  // 有足夠資訊接續，而不是看到一句看不出所以然的原始錯誤訊息。
  const shouldProtect = versionNo === 0 && getConfig(CONFIG_KEYS.V0_PROTECT, false) === true;
  try {
    if (shouldProtect) protectV0(sheetName);
    registerVersion(
      quarterId, versionNo, sheetName, VERSION_VALUES.BASIS_AUTO_GENERATE,
      previousVersionNo < 0 ? null : previousVersionNo,
      genResult.warnings.length, shouldProtect, buildSeedNote_(genResult)
    );
  } catch (err) {
    throw new Error(
      '產生職事表時，工作表 ' + sheetName + ' 與 RosterAssignments 的派工紀錄已經寫入成功，'
        + '但登記版本時失敗（' + err.message + '），RosterVersions 目前沒有這個版本的紀錄，'
        + '系統會找不到它（等於「孤兒版本」）。\n\n'
        + '需要人手處理，建議：\n'
        + '1. 檢查 RosterVersions 工作表是否還在、欄位是否完整（可用「維護 ▸ 補建 Quarters 欄位」'
        + '這類補建工具的思路自行核對，或直接告訴 Claude 這個錯誤訊息）；\n'
        + '2. 確認原因後，可以選擇（a）人手在 RosterVersions 補一行登記 v' + versionNo
        + '，讓系統認得這個版本，或（b）如果不需要保留，人手刪除 ' + sheetName
        + ' 工作表與 RosterAssignments 中 QuarterID=' + quarterId + '、VersionNo=' + versionNo + ' 的所有列，'
        + '當作這次生成沒發生過，之後重新執行「步驟 1：生成初稿」。'
    );
  }

  const assigned = genResult.assignments.filter(function (a) { return !!a.personId; }).length;
  const blankBreakdown = summariseBlankAssignments_(genResult.assignments);

  return {
    quarterId: quarterId,
    sheetName: sheetName,
    versionNo: versionNo,
    previousVersionNo: previousVersionNo,
    assigned: assigned,
    blank: genResult.assignments.length - assigned,
    blankBreakdown: blankBreakdown,
    warnings: genResult.warnings.length,
    attemptsRun: genResult.attemptsRun,
    attemptsPlanned: genResult.attemptsPlanned,
    stoppedByTime: genResult.stoppedByTime,
    attemptIndex: genResult.attemptIndex,
    seed: genResult.seed,
    deviation: genResult.deviation,
    protected: shouldProtect
  };
}
