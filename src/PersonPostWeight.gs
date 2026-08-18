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
function readActivePersonPostWeights_(referenceDate, timezone) {
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

    const entry = {
      weightId: String(row[W.WEIGHT_ID] || '').trim(),
      personId: personId,
      postId: postId,
      adjust: adjust,
      reason: String(row[W.REASON] || '').trim()
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
 * @param {string} personId 候選人
 * @param {Object} state 排表狀態
 * @returns {number} 加分（正數＝更容易被揀），冇偏好時 0
 */
function computePersonPostWeightBonus_(personId, state) {
  const weights = state.context.personPostWeights;
  if (!weights) return 0;
  const entry = weights.byKey[personId + '|' + state.post.postId];
  if (!entry) return 0;

  if (entry.adjust > 0) {
    // 遞減加分：呢一季喺呢個崗位已經排夠 `adjust` 次就停。
    // 唔遞減嘅話 +1 會變成「霸晒」，而 +1 嘅意思係「多大約一次」。
    const already = readPersonPostCount_(state, personId, state.post.postId);
    if (already >= entry.adjust) return 0;
    return entry.adjust * PERSON_POST_WEIGHT_STEP;
  }
  // 負數：常數扣分。剎車由 SOFT_QUARTER_DISTRIBUTION 提供
  // ——其他人越派越多，佢哋自己嘅扣分最終會蓋過呢個固定扣分，
  // 所以係「排後啲」而唔係「排到零」。
  return entry.adjust * PERSON_POST_WEIGHT_STEP;
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
 * @returns {{lines: string[], rows: Object[]}}
 */
function buildPersonPostWeightReport_(assignments, weights, peopleById, postNames) {
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
    const target = average + w.adjust;
    const row = {
      personId: w.personId,
      nameTC: (peopleById[w.personId] || {}).nameTC || w.personId,
      postId: w.postId,
      postNameTC: postNames[w.postId] || w.postId,
      adjust: w.adjust,
      averageForPost: Math.round(average * 10) / 10,
      targetCount: Math.round(target * 10) / 10,
      actualCount: got,
      gap: Math.round((got - target) * 10) / 10,
      reason: w.reason
    };
    rows.push(row);
    lines.push('　' + row.nameTC + '　' + row.postNameTC
      + '　偏好 ' + (w.adjust > 0 ? '+' : '') + w.adjust
      + '　這個崗位平均 ' + row.averageForPost + ' 次'
      + '　目標約 ' + row.targetCount + ' 次'
      + '　實際 ' + row.actualCount + ' 次'
      + '　差 ' + (row.gap > 0 ? '+' : '') + row.gap);
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
