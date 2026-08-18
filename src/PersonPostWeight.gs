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
    const target = average + w.adjust;

    // 第二十七輪批次階段 B2：未達標一定要講得出係邊條規則擋住。
    //
    // ⚠️ 「未達標」嘅門檻用 0.5 而唔係 0：目標值本身係一個小數
    //（平均 ＋ 偏好），差 0.3 次唔算「冇生效」，只係四捨五入。
    // 用 0 做門檻會令幾乎每一行都報一堆原因，而真正有問題嗰行就淹沒咗。
    const shortfall = target - got;
    const personLimit = resolveWeightQuarterLimit_(peopleById[w.personId], limitContext);
    const explained = shortfall > 0.5
      ? explainWeightShortfall_(w, Math.round(target), got, assignments, personLimit)
      : { reasons: [], text: '' };

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
      reason: w.reason,
      met: shortfall <= 0.5,
      shortfallReasons: explained.reasons,
      shortfallText: explained.text
    };
    rows.push(row);
    lines.push('　' + row.nameTC + '　' + row.postNameTC
      + '　偏好 ' + (w.adjust > 0 ? '+' : '') + w.adjust
      + '　這個崗位平均 ' + row.averageForPost + ' 次'
      + '　目標約 ' + row.targetCount + ' 次'
      + '　實際 ' + row.actualCount + ' 次'
      + '　差 ' + (row.gap > 0 ? '+' : '') + row.gap);
    if (!row.met) lines.push('　　未達標原因：' + row.shortfallText);
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
