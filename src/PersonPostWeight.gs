/**
 * 第二十六輪批次階段 C：排表偏好（`PersonPostWeight`）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 一個機制搞掂堂委三條規則
 * ─────────────────────────────────────────────────────────────────────
 *
 * 堂委收到 2026T4 系統初稿之後改咗 23 格，**全部集中喺四個崗位**
 * （主席、報告、當值堂委、聖餐襄禮），其餘十二個崗位一格都冇改。
 *
 * 佢哋嘅三條意見（換成假名）：
 *   「甲多啲作報告」
 *   「乙比其他人少一至兩次主席，但可以加返一次當值堂委」
 *   「丙可以比其他主席多一次」
 *
 * 三條**形狀完全一樣**：某人 × 某崗位 → 比平均多／少 N 次。
 * 所以唔使三套邏輯，一張表搞掂。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ 最重要嘅安全性質：張表空嘅時候，排表結果同以前**一模一樣**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 只有明確寫咗一行嘅 (人, 崗位) 對先受影響，其他人、其他崗位**零改變**。
 *
 * 實作上點保證：`computePersonPostWeightBonus_()` 查唔到就 `return 0`，
 * 而 0 加落 `bonus` 度係恆等元——分數逐個位元一樣，
 * 連 tie-break 嘅隨機序列都唔會偏移（因為冇多抽任何一個亂數）。
 *
 * 呢個性質令新機制可以安全上線：堂委未開會之前，張表係空嘅，
 * 系統行為完全不變。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 揀咗邊種做法，點解
 * ─────────────────────────────────────────────────────────────────────
 *
 * 考慮過三種：
 *
 * | 做法 | 點解唔揀／揀 |
 * |---|---|
 * | 每人每崗位目標值 ＋ 偏離扣分 | 現時 `computePersonQuotas_()` 只算**跨全部崗位嘅總配額**，冇按崗位分。要加一整層「每人每崗位目標」——而嗰個目標值本身要靠估（歷史比例？平均？），估錯就會影響**全部人**，違反上面嗰條安全性質 |
 * | 直接改 `Eligibility` 權重 | 會令「有冇資格」同「做幾多次」兩件事混埋，而佢哋要分開改（區三兩個唔同畫面） |
 * | **選人時加權（採用）** | 只喺已經合規嘅候選人之間調整優先次序。冇資料 ⇒ 加 0 ⇒ 零改變。而且**結構上唔可能壓過硬規則**（見下） |
 *
 * **點解結構上唔可能壓過硬規則**：`Generator.gs` 嘅 `pickPerson_()` 係
 * 先 `clean = scored.filter(!hasHard)` **隔走**違反硬規則嘅人，
 * 之後先喺剩低嘅人之間比分數。呢個偏好只影響分數，
 * 所以就算把 `PERSON_POST_WEIGHT_STEP` 調到一萬，一個違反硬規則嘅人
 * 都**唔會**被揀中。呢個係結構保證，唔係「數字調到啱啱好」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 正負兩邊唔對稱（有意）
 * ─────────────────────────────────────────────────────────────────────
 *
 * **正數（多做）：遞減加分**——只喺「呢一季喺呢個崗位已經排咗
 * 少過 `Adjust` 次」嗰陣加分，夠數就停。
 * 常數加分會令佢由 1 次跳到 4-5 次（每一格都佔優），
 * 而 `+1` 對幹事嘅意思係「多**大約一次**」，唔係「霸晒」。
 *
 * **負數（少做）：常數扣分**——一直扣。
 * 呢邊唔使遞減，因為已經有一個天然嘅剎車：`SOFT_QUARTER_DISTRIBUTION`
 * 會隨住其他人越派越多而對**佢哋**扣分，最終蓋過呢個固定扣分。
 * 即係「佢排後啲，但唔會排到零」——正正就係想要嘅效果。
 */

/**
 * 讀出**現正生效**嘅排表偏好。
 *
 * 生效條件（三個都要成立）：
 *   `Active` 係 TRUE
 *   `EffectiveFrom` 空白，或者 ≤ 參考日期
 *   `EffectiveTo` 空白，或者 ≥ 參考日期
 *
 * ⚠️ **解除一筆偏好＝填 `EffectiveTo`**，唔係刪行、唔係 `Active=FALSE`。
 * 同 `PersonPostExclusions` 一致——要睇得返「嗰陣時係點決定嘅」。
 *
 * @param {string} referenceDate 參考日期（yyyy-MM-dd），通常係季初
 * @param {string} timezone 時區
 * @returns {{byKey: Object.<string, Object>, rows: Object[], invalid: Object[]}}
 *   `byKey` 用 `PersonID|PostID` 做 key
 */
function readActivePersonPostWeights_(referenceDate, timezone, baselineData) {
  const W = COLUMNS.PERSON_POST_WEIGHT;
  const byKey = {};
  const rows = [];
  const invalid = [];

  let raw = [];
  try {
    raw = readOptionalSheet_(SHEETS.PERSON_POST_WEIGHT);
  } catch (err) {
    // 張表未建立 ⇒ 冇偏好 ⇒ 行為同以前一模一樣。**唔可以拋錯**，
    // 否則一個未建表嘅環境連生成都做唔到。
    log_('INFO', 'PersonPostWeight 工作表未建立，排表偏好視為空白：' + err.message);
    return { byKey: {}, rows: [], invalid: [] };
  }

  raw.forEach(function (row) {
    const personId = String(row[W.PERSON_ID] || '').trim();
    const postId = String(row[W.POST_ID] || '').trim();
    if (!personId || !postId) return;
    if (!isTrueValue_(row[W.ACTIVE])) return;

    const from = toDateString(row[W.EFFECTIVE_FROM], timezone);
    const to = toDateString(row[W.EFFECTIVE_TO], timezone);
    if (from && referenceDate && from > referenceDate) return;
    if (to && referenceDate && to < referenceDate) return;

    const adjustRaw = row[W.ADJUST];
    const adjust = Math.round(Number(adjustRaw));
    // ⚠️ 超出範圍**唔會靜靜夾到範圍內**——夾咗就等於系統擅自改咗
    // 堂委嘅決定，而且冇人知。列出嚟，由人手處理。
    if (isNaN(adjust) || adjust < PERSON_POST_WEIGHT_MIN || adjust > PERSON_POST_WEIGHT_MAX) {
      invalid.push({
        weightId: String(row[W.WEIGHT_ID] || '').trim(),
        personId: personId, postId: postId,
        rawAdjust: String(adjustRaw === null || adjustRaw === undefined ? '' : adjustRaw),
        reason: 'Adjust 必須是 ' + PERSON_POST_WEIGHT_MIN + ' 到 '
          + PERSON_POST_WEIGHT_MAX + ' 之間的整數'
      });
      return;
    }
    if (adjust === 0) return;   // 0 ＝ 冇偏好，同冇呢一行一樣

    // 第二十八輪批次階段 A：目標次數喺呢度就算好。
    // ⚠️ 冇傳 `baselineData` 嗰陣 `target` 係 `null`——**唔可以當成 0**。
    // 排表路徑見到 null 會拋錯（見 `computePersonPostWeightBonus_()`）；
    // 編輯畫面唔需要目標值，所以佢唔傳都冇問題。
    const base = resolveWeightBaseline_(personId, postId, baselineData);
    const entry = {
      weightId: String(row[W.WEIGHT_ID] || '').trim(),
      personId: personId,
      postId: postId,
      adjust: adjust,
      reason: String(row[W.REASON] || '').trim(),
      baseline: base.baseline,
      baselineSource: base.source,
      baselineLabel: base.label,
      target: base.source === WEIGHT_BASELINE_SOURCE.NOT_COMPUTED
        ? null : computeWeightTarget_(base.baseline, adjust)
    };
    byKey[personId + '|' + postId] = entry;
    rows.push(entry);
  });

  return { byKey: byKey, rows: rows, invalid: invalid };
}

/**
 * 排表計分時嘅偏好加減分。**純函式**（除咗讀 state）。
 *
 * ⚠️ 冇對應嘅偏好行 ⇒ **一定回 0**。0 加落 bonus 係恆等元，
 * 所以「張表空嘅時候結果一模一樣」呢個性質喺呢一行就保證咗。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 第二十八輪批次階段 A：`+N` 由「地板」改成「增量」
 * ─────────────────────────────────────────────────────────────────────
 *
 * **Ivan 實測（2027T4）：`+1` 完全冇效果。**
 * 設咗一行 `+1`（某人／當值堂委），重新生成之後該崗位次數 1 → 1（冇變），
 * 而佢全崗位總數 6 次、上限 8 次，即係**唔係撞上限**。
 *
 * 根因：舊寫法係「排夠 `adjust` 次就停止加分」——即係 `+1` 嘅實際意思係
 * 「**至少排到 1 次**」（一個地板），唔係「**比原本多 1 次**」（一個增量）。
 * 嗰位本身自然就排到 1 次，所以加分由頭到尾冇機會生效。
 *
 * 而畫面寫嘅係「這一季比系統原本會派的多大約一次」。
 * **機制同承諾唔一致，而且冇量度，所以冇人睇得出**——過咗一整輪。
 *
 * 新語意：`目標 = 上一季實際次數 + 偏好`，計分正負**統一**：
 *   `(target - already) × PERSON_POST_WEIGHT_STEP`
 * 未夠就加分、超咗就扣分、啱啱好就 0。
 *
 * @param {string} personId 候選人
 * @param {Object} state 排表狀態
 * @returns {number} 加分（正數＝更容易被揀），冇偏好時 0
 */
function computePersonPostWeightBonus_(personId, state) {
  const weights = state.context.personPostWeights;
  if (!weights) return 0;
  const entry = weights.byKey[personId + '|' + state.post.postId];
  if (!entry) return 0;

  // ⚠️ 目標值一定要喺 context 建立嗰陣就算好。算唔到就係一個**程式錯誤**
  // （呼叫端漏咗傳基準資料），唔係一個資料狀況。
  //
  // 呢度特登拋錯而唔係回 0：回 0 嘅話，整個偏好機制會靜靜咁完全失效，
  // 而排表結果睇落完全正常——**上一輪就係噉樣過咗一整輪都冇人發現**。
  if (entry.target === null || entry.target === undefined) {
    throw new Error('排表偏好未算好目標次數（' + personId + '｜' + state.post.postId
      + '）。buildGeneratorContext_() 一定要傳基準資料畀 readActivePersonPostWeights_()。');
  }

  const already = readPersonPostCount_(state, personId, state.post.postId);
  return (entry.target - already) * PERSON_POST_WEIGHT_STEP;
}

/* ============================================================
 * 第二十八輪批次階段 A：基準（baseline）
 * ============================================================ */

/** 基準嘅來源。**「查不到」一定要同「0 次」分得開。** */
const WEIGHT_BASELINE_SOURCE = {
  /** 上一個有版本嘅季度嘅實際次數（最可信） */
  PREV_QUARTER: 'PREV_QUARTER',
  /** 冇上一季 ⇒ 用歷史平均每季次數 */
  HISTORICAL_AVERAGE: 'HISTORICAL_AVERAGE',
  /** 兩樣都冇 ⇒ 基準當 0，但**要標示出嚟** */
  NONE: 'NONE',
  /** 未算過（例如編輯畫面只列清單，冇準備基準資料） */
  NOT_COMPUTED: 'NOT_COMPUTED'
};

/**
 * 由基準資料查一個 (人, 崗位) 嘅基準。**純函式，可以離線測。**
 *
 * ⚠️ 上一季**有版本**而嗰個人喺嗰個崗位排 0 次 ⇒ 基準係一個**真實嘅 0**，
 * 唔係「查不到」。呢兩件事喺畫面上都係「0」，但意思完全相反：
 * 前者係「佢上季真係冇做過」，後者係「我哋根本唔知」。
 *
 * @param {string} personId
 * @param {string} postId
 * @param {?Object} baselineData `buildWeightBaselineData_()` 嘅結果；null ＝ 未算
 * @returns {{baseline: number, source: string, label: string}}
 */
function resolveWeightBaseline_(personId, postId, baselineData) {
  if (!baselineData) {
    return { baseline: 0, source: WEIGHT_BASELINE_SOURCE.NOT_COMPUTED, label: '' };
  }
  const key = personId + '|' + postId;

  if (baselineData.prev) {
    return {
      baseline: baselineData.prev.byKey[key] || 0,
      source: WEIGHT_BASELINE_SOURCE.PREV_QUARTER,
      label: baselineData.prev.label
    };
  }

  const historical = baselineData.historicalByKey[key];
  if (historical !== undefined && baselineData.pastQuarterCount > 0) {
    return {
      baseline: historical / baselineData.pastQuarterCount,
      source: WEIGHT_BASELINE_SOURCE.HISTORICAL_AVERAGE,
      label: '歷史平均每季'
    };
  }

  return { baseline: 0, source: WEIGHT_BASELINE_SOURCE.NONE, label: '' };
}

/**
 * 目標次數。**純函式。**
 *
 * 基準可能係小數（歷史平均），所以先四捨五入再加偏好——
 * 「1.4 次 ＋ 多一次」對幹事嚟講嘅意思係「2 次」，唔係「2.4 次」。
 * @param {number} baseline
 * @param {number} adjust
 * @returns {number} 下限 0
 */
function computeWeightTarget_(baseline, adjust) {
  return Math.max(0, Math.round(Number(baseline) || 0) + Number(adjust || 0));
}

/**
 * 把基準寫成一句人話（畫面用）。前端後端共用，**唔可以兩邊各寫一次**。
 * @param {{baseline: number, source: string, label: string}} info
 * @param {string} postNameTC 崗位名（人話）
 * @param {number} target 目標次數
 * @returns {string}
 */
function describeWeightBaseline_(info, postNameTC, target) {
  const post = postNameTC || '這個崗位';
  if (info.source === WEIGHT_BASELINE_SOURCE.PREV_QUARTER) {
    return '上一季（' + info.label + '）' + post + ' ' + info.baseline + ' 次'
      + '　→　今季目標 ' + target + ' 次'
      + (info.baseline === target ? '（與上一季相同）' : '');
  }
  if (info.source === WEIGHT_BASELINE_SOURCE.HISTORICAL_AVERAGE) {
    return '沒有上一季的記錄，用歷史平均每季 '
      + (Math.round(info.baseline * 10) / 10) + ' 次做基準'
      + '　→　今季目標 ' + target + ' 次';
  }
  if (info.source === WEIGHT_BASELINE_SOURCE.NOT_COMPUTED) return '（還沒有算基準）';
  // ⚠️ 「沒有基準」一定要講出嚟，唔可以寫成「上一季 0 次」——
  // 後者係一個肯定句，而我哋根本冇資料。
  return '沒有上一季的記錄，基準當作 0 次　→　今季目標 ' + target + ' 次';
}

/**
 * 基準嘅**短版**文字（報告表格用，唔要「→ 今季目標」嗰半截）。
 * @param {Object} entry 偏好行（有 baseline／baselineSource）
 * @returns {string}
 */
function describeWeightBaselineShort_(entry) {
  const source = entry.baselineSource || WEIGHT_BASELINE_SOURCE.NOT_COMPUTED;
  if (source === WEIGHT_BASELINE_SOURCE.PREV_QUARTER) {
    return entry.baseline + ' 次（' + (entry.baselineLabel || '上一季') + '）';
  }
  if (source === WEIGHT_BASELINE_SOURCE.HISTORICAL_AVERAGE) {
    return (Math.round(entry.baseline * 10) / 10) + ' 次（歷史平均）';
  }
  if (source === WEIGHT_BASELINE_SOURCE.NONE) return '沒有基準（當作 0 次）';
  return '（沒有算過基準）';
}

/**
 * 準備「上一季實際次數」同「歷史平均」兩份基準資料。
 *
 * **要讀試算表**，所以只可以喺 `buildGeneratorContext_()` 同 Web API
 * 呢類呼叫端叫。純函式部分（`resolveWeightBaseline_()`／
 * `computeWeightTarget_()`）唔碰試算表，離線測得到。
 *
 * 「上一個季度」＝ 按 `StartDate` 排序，本季之前**最近一個有版本**嘅季度，
 * 用嗰季**最新版本**嘅實際派工。
 *
 * ⚠️ 「有版本」呢個條件唔可以慳：一個已經建立但未生成過嘅季度
 * （例如已經預先開好嘅下一季）派工紀錄係空嘅，
 * 攞佢做基準就等於把每一個人嘅基準都當成 0。
 *
 * @param {string} quarterId 本季
 * @param {string} timezone
 * @returns {{prev: ?Object, historicalByKey: Object, pastQuarterCount: number}}
 */
function buildWeightBaselineData_(quarterId, timezone) {
  const Q = COLUMNS.QUARTERS;
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const E = COLUMNS.ELIGIBILITY;

  const quarters = readSheet(SHEETS.QUARTERS)
    .map(function (row) {
      return {
        quarterId: String(row[Q.QUARTER_ID] || '').trim(),
        startDate: toDateString(row[Q.START_DATE], timezone)
      };
    })
    .filter(function (q) { return q.quarterId && q.startDate; })
    .sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });

  const self = quarters.filter(function (q) { return q.quarterId === quarterId; })[0];
  const earlier = self
    ? quarters.filter(function (q) { return q.startDate < self.startDate; })
    : [];

  // 由最近嘅一季向前搵，第一個有版本嘅就係基準季。
  let prev = null;
  for (let i = earlier.length - 1; i >= 0 && !prev; i--) {
    const candidate = earlier[i];
    let versionNo = -1;
    try { versionNo = findLatestVersionNo(candidate.quarterId); }
    catch (err) { versionNo = -1; }
    if (versionNo < 0) continue;

    const byKey = {};
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== candidate.quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      const personId = String(row[A.PERSON_ID] || '').trim();
      const postId = String(row[A.POST_ID] || '').trim();
      if (!personId || !postId) return;
      const key = personId + '|' + postId;
      byKey[key] = (byKey[key] || 0) + 1;
    });

    prev = {
      quarterId: candidate.quarterId,
      versionNo: versionNo,
      label: buildQuarterLabel_(candidate.quarterId),
      byKey: byKey
    };
  }

  // 歷史平均嘅分母：本季之前已經存在嘅季度數。
  // ⚠️ 呢個係一個近似值——`Eligibility.HistoricalCount` 統計嘅期間
  // 唔一定等於 `Quarters` 入面全部舊季度。所以佢只做**後備**基準，
  // 而且畫面會標明「用歷史平均做基準」，唔會扮成上一季嘅實數。
  const historicalByKey = {};
  try {
    readSheet(SHEETS.ELIGIBILITY).forEach(function (row) {
      const personId = String(row[E.PERSON_ID] || '').trim();
      const postId = String(row[E.POST_ID] || '').trim();
      if (!personId || !postId) return;
      const count = Number(row[E.HISTORICAL_COUNT]);
      if (isNaN(count) || count <= 0) return;
      historicalByKey[personId + '|' + postId] = count;
    });
  } catch (err) {
    log_('WARN', '讀不到 Eligibility 的歷史次數，排表偏好只能用「沒有基準」：' + err.message);
  }

  return { prev: prev, historicalByKey: historicalByKey, pastQuarterCount: earlier.length };
}

/**
 * 讀「呢一季，呢個人喺呢個崗位已經排咗幾多次」。
 * @param {Object} state 排表狀態
 * @param {string} personId PersonID
 * @param {string} postId PostID
 * @returns {number}
 */
function readPersonPostCount_(state, personId, postId) {
  if (!state.postCount) return 0;
  return state.postCount[personId + '|' + postId] || 0;
}

/**
 * 排表品質統計嘅「排表偏好」一節：逐行列出目標同實際。
 *
 * ⚠️ **唔可以只改行為而唔顯示結果。** 一個「軟」機制冇量度嘅話，
 * 幹事同堂委都冇辦法知道「究竟有冇用」——下次開會就會憑感覺再調，
 * 而唔係睇住數字調。
 *
 * @param {Object[]} assignments 生成結果
 * @param {Object} weights `readActivePersonPostWeights_()` 嘅結果
 * @param {Object.<string, Object>} peopleById 人員索引
 * @param {Object.<string, string>} postNames PostID → 崗位名
 * @param {?{rules: Object, defaultLimit: number}} limitContext 每季上限嘅來源。
 *   ⚠️ 傳 null／唔傳 ＝ **查不到**，唔係「冇上限」。查不到嗰陣
 *   「未達標原因」會照樣講明「上限查不到」，唔會扮到已經檢查過。
 * @returns {{lines: string[], rows: Object[]}}
 */
function buildPersonPostWeightReport_(assignments, weights, peopleById, postNames,
  limitContext) {
  const rows = [];
  if (!weights || weights.rows.length === 0) {
    return {
      lines: ['排表偏好：目前沒有任何生效中的偏好（系統按一般規則排）。'],
      rows: []
    };
  }

  // 逐個 (人, 崗位) 數實際排到幾多次
  const actual = {};
  (assignments || []).forEach(function (a) {
    if (!a.personId) return;
    const key = a.personId + '|' + a.postId;
    actual[key] = (actual[key] || 0) + 1;
  });

  // 同一個崗位、冇偏好嘅人平均排幾多次——用嚟講「比平均多／少幾多」。
  const perPostTotals = {};
  const perPostPeople = {};
  (assignments || []).forEach(function (a) {
    if (!a.personId) return;
    perPostTotals[a.postId] = (perPostTotals[a.postId] || 0) + 1;
    if (!perPostPeople[a.postId]) perPostPeople[a.postId] = {};
    perPostPeople[a.postId][a.personId] = true;
  });

  const lines = ['排表偏好（' + weights.rows.length + ' 項生效中）：'];
  weights.rows.forEach(function (w) {
    const key = w.personId + '|' + w.postId;
    const peopleCount = Object.keys(perPostPeople[w.postId] || {}).length;
    const average = peopleCount === 0 ? 0 : (perPostTotals[w.postId] || 0) / peopleCount;
    const got = actual[key] || 0;

    // ⚠️ 第二十八輪批次階段 A4：目標值改用**基準 ＋ 偏好**，
    // 唔再用「該崗位平均 ＋ 偏好」。
    //
    // 舊做法兩個問題：
    // 1. 平均值係由**呢一次生成嘅結果**算返出嚟。偏好生效令佢多排咗，
    //    平均值本身亦會升，目標跟住升——即係一個追唔到嘅目標。
    // 2. 平均值同排表計分實際用嘅嘢完全冇關係，
    //    所以報告講嘅「目標」根本唔係系統真正追嗰個目標。
    //
    // 而家用 `w.target`，同 `computePersonPostWeightBonus_()` 用嘅係同一個數。
    const target = (w.target === null || w.target === undefined)
      ? computeWeightTarget_(w.baseline || 0, w.adjust) : w.target;

    // 目標值而家係整數，所以「未達標」門檻係 0——差一次就係差一次。
    const shortfall = target - got;
    const personLimit = resolveWeightQuarterLimit_(peopleById[w.personId], limitContext);
    const explained = shortfall > 0
      ? explainWeightShortfall_(w, target, got, assignments, personLimit)
      : { reasons: [], text: '' };
    // 第二十九輪批次階段 C：**超標亦要解釋。**
    // 「今季目標 2 次　今季已排 3 次」而冇下文，幹事一樣冇辦法知道
    // 呢個係機制壞咗定係正常——而佢會估係前者。
    const over = shortfall < 0
      ? explainWeightOvershoot_(w, target, got, assignments)
      : { reasons: [], text: '' };

    const row = {
      personId: w.personId,
      nameTC: (peopleById[w.personId] || {}).nameTC || w.personId,
      postId: w.postId,
      postNameTC: postNames[w.postId] || w.postId,
      adjust: w.adjust,
      baseline: w.baseline === undefined ? null : w.baseline,
      baselineSource: w.baselineSource || WEIGHT_BASELINE_SOURCE.NOT_COMPUTED,
      baselineText: describeWeightBaselineShort_(w),
      averageForPost: Math.round(average * 10) / 10,
      targetCount: target,
      actualCount: got,
      gap: got - target,
      reason: w.reason,
      met: shortfall <= 0,
      shortfallReasons: explained.reasons,
      shortfallText: explained.text,
      overshootReasons: over.reasons,
      overshootText: over.text,
      // 第二十九輪批次階段 C：畫面**只讀呢一個欄位**。
      // 前端自己判斷「差咗定多咗」再揀讀邊個欄位，就係同一件事
      // 兩個真相來源——本專案撞過最多次嗰類問題。
      // 空字串 ＝ 啱啱好等於目標，冇嘢要解釋。
      gapText: shortfall > 0
        ? ('未達標：' + explained.text)
        : (shortfall < 0
          ? ('比目標多 ' + (got - target) + ' 次：' + over.text)
          : '')
    };
    rows.push(row);
    lines.push('　' + row.nameTC + '　' + row.postNameTC
      + '　上一季 ' + row.baselineText
      + '　偏好 ' + (w.adjust > 0 ? '+' : '') + w.adjust
      + '　今季目標 ' + row.targetCount + ' 次'
      + '　實際 ' + row.actualCount + ' 次'
      + '　差 ' + (row.gap > 0 ? '+' : '') + row.gap);
    if (row.gapText) lines.push('　　' + row.gapText);
  });

  if (weights.invalid.length > 0) {
    lines.push('⚠️ 有 ' + weights.invalid.length + ' 行的 Adjust 超出範圍，'
      + '這幾行完全沒有生效（系統不會自己改成範圍內的值）：');
    weights.invalid.forEach(function (bad) {
      lines.push('　' + bad.personId + '　' + bad.postId + '　Adjust=' + bad.rawAdjust);
    });
  }

  lines.push('（偏好是「軟」的：它只影響已經合規的人之間誰優先，'
    + '永遠不會令系統違反任何規則，所以實際次數不會剛好等於目標。）');

  return { lines: lines, rows: rows };
}

/* ============================================================
 * 第二十七輪批次階段 B1：補建 `PersonPostWeight` 工作表
 * ============================================================
 *
 * ⚠️ 呢張表**現時仲未建立**（connector 核實過）。冇佢嘅時候
 * `readActivePersonPostWeights_()` 會回空白，系統行為同以前一模一樣
 * ——所以佢係「可選」嘅，缺咗唔會壞，只係排表偏好用唔到。
 */

/** 第 1 行（中文標題）。**每一欄都寫明點填**，唔可以淨係寫個機器鍵。 */
const PERSON_POST_WEIGHT_HEADERS_TC = [
  'WeightID',
  'PersonID',
  '崗位（PostID）',
  '偏好（-3 到 3 的整數；正數＝多做幾次，負數＝少做幾次，0＝沒有偏好）',
  '原因（例如：堂委 2026-08 決議；三個月後沒有原因就沒有人記得為什麼）',
  '生效日（yyyy-MM-dd，留空＝即時生效）',
  '解除日（yyyy-MM-dd，留空＝仍然生效；日後解除時填這一欄，不要刪除整行）',
  'Active',
  '建立時間',
  '建立者'
];

/**
 * 取得第 2 行機器鍵。寫成函式而非頂層 const，理由同 `getRolesHeaderKeys_()`：
 * 頂層直接引用 `COLUMNS` 會撞到載入次序造成嘅 TDZ。
 * @returns {string[]}
 */
function getPersonPostWeightHeaderKeys_() {
  const W = COLUMNS.PERSON_POST_WEIGHT;
  return [
    W.WEIGHT_ID, W.PERSON_ID, W.POST_ID, W.ADJUST, W.REASON,
    W.EFFECTIVE_FROM, W.EFFECTIVE_TO, W.ACTIVE, W.CREATED_AT, W.CREATED_BY
  ];
}

/**
 * 建立（若不存在）`PersonPostWeight` 工作表。已存在時**完全唔動**。
 * 沿用 `ensureSimpleSheet_()`（同 Roles／PersonPostExclusions 一樣）。
 * @returns {{isNew: boolean}}
 */
function ensurePersonPostWeightSheet_() {
  return ensureSimpleSheet_(
    SHEETS.PERSON_POST_WEIGHT,
    PERSON_POST_WEIGHT_HEADERS_TC,
    getPersonPostWeightHeaderKeys_());
}

/**
 * 選單項目「維護 ▸ 補建排表偏好工作表」嘅執行入口。冪等。
 * @returns {void}
 */
function runEnsurePersonPostWeightSheet_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建排表偏好工作表';
  try {
    const res = ensurePersonPostWeightSheet_();
    if (!res.isNew) {
      ui.alert(title, SHEETS.PERSON_POST_WEIGHT + ' 工作表已經存在，沒有改動任何東西。',
        ui.ButtonSet.OK);
      return;
    }
    writeAuditLog_({
      action: title,
      targetSheet: SHEETS.PERSON_POST_WEIGHT,
      targetKey: '（建立工作表）',
      newValue: PERSON_POST_WEIGHT_HEADERS_TC.length + ' 欄',
      source: 'MENU'
    });
    ui.alert(title,
      '已建立 ' + SHEETS.PERSON_POST_WEIGHT + ' 工作表（第 1 行是說明標題，'
      + '第 2 行是系統用的欄位鍵，已隱藏）。\n\n'
      + '之後請用幹事介面「名單維護 ▸ 排表偏好」加內容，不要直接在這張表打字'
      + '——那個畫面會自動填 WeightID／建立時間，並且寫入稽核紀錄。\n\n'
      + '⚠️ 解除一筆偏好是填「解除日」，不是刪掉那一行。',
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/* ============================================================
 * 第二十七輪批次階段 B2：偏好未達標時要講得出係邊條規則擋住
 * ============================================================
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要做呢一段
 * ─────────────────────────────────────────────────────────────────────
 *
 * 離線驗收：四行偏好之中兩行「冇變」。機制係啱嘅——嗰兩位已經撞到
 * `MaxPerQuarter` 上限，而偏好係軟嘅，唔會為咗滿足偏好而突破上限。
 *
 * 但**幹事揀咗「多一次」而乜都冇發生，畫面唔會解釋點解**。
 * 佢只會得出一個結論：「呢個功能壞咗」，然後去做一啲更危險嘅嘢
 * （例如改人哋嘅崗位資格）。
 *
 * 所以未達標一定要講得出係邊一條規則擋住，唔可以只寫「未達標」三個字。
 */

/**
 * 決定一個人嘅每季上限。
 *
 * ⚠️ **一定要重用 `RoleImpact.gs` 嘅 `resolvePersonQuarterLimit_()`。**
 * 呢度本來寫過一個「個人值 ?? Config 預設值」嘅簡化版，漏咗
 * `RuleSettings` 嘅 `TargetValue` 覆寫——即係同一個問題會有兩個答案，
 * 而排表用一個、報告用另一個。全專案已經撞過好多次呢個 bug class
 * （同一個狀態兩個真相來源），所以呢度只做一件事：把「查不到」
 * 同「查到」分開。
 *
 * @param {?Object} person `indexPeopleById_()` 嘅一項（有 maxPerQuarter）
 * @param {?{rules: Object, defaultLimit: number}} ctx null ＝ 查不到
 * @returns {?number} null ＝ 查不到（**唔係「冇上限」**）
 */
function resolveWeightQuarterLimit_(person, ctx) {
  if (!ctx || !ctx.rules || ctx.defaultLimit === null || ctx.defaultLimit === undefined
    || isNaN(ctx.defaultLimit)) {
    return null;
  }
  const limit = resolvePersonQuarterLimit_(person, ctx.rules, Number(ctx.defaultLimit));
  return isNaN(limit) ? null : Number(limit);
}

/**
 * 分析一項偏好點解未達標。**只用生成結果推**，唔重跑排表。
 *
 * @param {Object} w 偏好行 {personId, postId, adjust}
 * @param {number} targetCount 目標次數
 * @param {number} actualCount 實際次數
 * @param {Object[]} assignments 本季全部派工 {personId, postId, serviceDate}
 * @param {?number} limit 呢個人嘅每季上限（null ＝ 查不到）
 * @returns {{reasons: string[], text: string}}
 */
/**
 * 第二十九輪批次階段 C：**排到多過目標**嘅原因。
 *
 * ⚠️ 未達標同超標都要講。「今季目標 2 次　今季已排 3 次」而冇下文，
 * 幹事得出嘅結論同「乜都冇發生」一樣：「呢個功能壞咗」。
 *
 * ⚠️ 呢度只用派工紀錄推得出嚟嘅嘢。**唔會估。**
 * 講唔出具體原因嗰陣，至少要講返個機制本身係點——
 * 因為「軟偏好排夠目標之後唔會擋住佢再被排到」呢一點，
 * 本身就係最常見嘅正解，而幹事唔會自己知。
 *
 * @param {Object} w 一行偏好
 * @param {number} targetCount 目標次數
 * @param {number} actualCount 實際次數
 * @param {Object[]} assignments 生成結果
 * @returns {{reasons: string[], text: string}}
 */
function explainWeightOvershoot_(w, targetCount, actualCount, assignments) {
  const reasons = [];
  const list = assignments || [];

  // 呢個崗位本季有幾多位唔同嘅人被排到、共幾多個主日。
  const peopleOnPost = {};
  const postDates = {};
  list.forEach(function (a) {
    if (a.postId !== w.postId || !a.personId) return;
    peopleOnPost[a.personId] = true;
    postDates[a.serviceDate] = true;
  });
  const poolSize = Object.keys(peopleOnPost).length;
  const dateCount = Object.keys(postDates).length;

  // 人少格多 ⇒ 佢無論如何都會被排到多過目標。
  if (poolSize > 0 && dateCount > poolSize) {
    reasons.push('這個崗位這一季有 ' + dateCount + ' 個主日要排，'
      + '但整季只有 ' + poolSize + ' 位不同的人被排到——'
      + '合資格而又有空的人不多，那幾週沒有其他人可以排');
  }

  // ⚠️ 呢句永遠成立，而且係最常見嘅正解，所以一定要出。
  reasons.push('偏好是「軟」的：排夠目標之後系統只是不再為他加分，'
    + '並不會擋住他再被排到');

  return { reasons: reasons, text: reasons.join('；') };
}

function explainWeightShortfall_(w, targetCount, actualCount, assignments, limit) {
  const reasons = [];
  const list = assignments || [];

  // 呢個人本季總共排咗幾多次（跨全部崗位）
  let personTotal = 0;
  const personDates = {};
  list.forEach(function (a) {
    if (a.personId !== w.personId) return;
    personTotal++;
    personDates[a.serviceDate] = true;
  });

  // 呢個崗位本季有邊幾日要排（有派工紀錄嘅日子）
  const postDates = {};
  list.forEach(function (a) { if (a.postId === w.postId) postDates[a.serviceDate] = true; });
  const postDateList = Object.keys(postDates).sort();

  // ── 1　撞每季上限 ──────────────────────────────────────────
  // ⚠️ `limit` 係 null 代表**查不到**，唔係「冇上限」。
  // 當成「冇上限」就係「缺失被當成正常值靜靜過」嗰個 bug class。
  if (limit === null || limit === undefined) {
    reasons.push('每季上限查不到（沒有提供上限資料），所以無法判斷是不是這一條擋住');
  } else if (personTotal >= limit) {
    reasons.push('撞到每季上限（' + limit + ' 次，他這一季已經排了 ' + personTotal
      + ' 次）——偏好是軟的，不會為了滿足它而超出上限');
  }

  // ── 2　該崗位格數不足 ─────────────────────────────────────
  if (postDateList.length < targetCount) {
    reasons.push('這個崗位這一季只有 ' + postDateList.length + ' 個主日要排，'
      + '排不出 ' + targetCount + ' 次');
  }

  // ── 3　逐個「排唔到佢」嘅主日，睇下嗰日發生咗咩事 ─────────────
  let sameDayElsewhere = 0;
  let consecutiveRisk = 0;
  let plainCompetition = 0;
  postDateList.forEach(function (date) {
    const gotIt = list.some(function (a) {
      return a.personId === w.personId && a.postId === w.postId && a.serviceDate === date;
    });
    if (gotIt) return;
    if (personDates[date]) { sameDayElsewhere++; return; }
    // 前後一週有冇服侍——同崗位連續兩週係準硬規則，會被扣好重嘅分
    const prev = shiftDateString_(date, -7);
    const next = shiftDateString_(date, 7);
    const servedAdjacentSamePost = list.some(function (a) {
      return a.personId === w.personId && a.postId === w.postId
        && (a.serviceDate === prev || a.serviceDate === next);
    });
    if (servedAdjacentSamePost) { consecutiveRisk++; return; }
    plainCompetition++;
  });

  if (sameDayElsewhere > 0) {
    reasons.push('有 ' + sameDayElsewhere + ' 個主日他當天已經在其他崗位服侍');
  }
  if (consecutiveRisk > 0) {
    reasons.push('有 ' + consecutiveRisk + ' 個主日會造成同一崗位連續兩週（準硬規則）');
  }
  if (plainCompetition > 0) {
    reasons.push('有 ' + plainCompetition + ' 個主日是其他人更需要平均（一般的平均分配）');
  }

  return {
    reasons: reasons,
    text: reasons.length === 0
      ? '沒有找到明顯的原因，請把這一項貼給開發者看'
      : reasons.join('；')
  };
}
