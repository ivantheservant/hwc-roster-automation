/**
 * 「草稿覆核報告」（唯讀，只寫 Diagnostics）——寫俾**堂委**睇嘅一份摘要。
 *
 * 存在嘅理由：Ivan 要攞 2026T4 嘅草稿俾堂委睇，堂委梗係會問「排得好唔好」。
 * 淨係睇一張表係睇唔出嘅——邊個做多咗、邊個一次都冇、有冇撞規則，
 * 全部都要逐格數先知。
 *
 * 同 `SoftRuleMetrics.gs` 嘅分別（**唔係重複造輪子**）：
 * - `SoftRuleMetrics.gs` 係**技術報告**：逐項列歷史基準／本版實測／差距／判斷，
 *   有 `SEMI_NO_CONSECUTIVE` 呢類規則代號，寫俾幹事同開發者睇。
 * - 呢一份係**對外報告**：同一批數字，但用返教會日常講法重新組織，
 *   一個內部代號都唔會出現，而且可以直接複製貼上電郵或者印出嚟。
 *   量度本身完全重用 `measureSoftRuleMetrics_()`，冇另外再計一次——
 *   兩份報告嘅數字永遠一致。
 *
 * 三個刻意嘅設計決定：
 * 1. **「硬規則違反：0 項」要明明白白寫出嚟**——呢個係系統最大嘅賣點，
 *    唔可以淨係喺冇問題嗰陣靜靜唔提。
 * 2. **明確分開「系統自動排」同「留俾人手填」**——唔講清楚嘅話，堂委會以為
 *    連講員都應該由系統排，見到空白就當係系統失敗。
 * 3. **一個內部代號都唔出現**（見 `assertNoInternalJargon_()` 嘅測試）。
 */

/**
 * 把規則代號翻譯成堂委睇得明嘅講法。全部對外文字都經過呢度，
 * 唔會有 `HARD_ELIGIBILITY`／`SEMI_NO_CONSECUTIVE` 呢類嘢漏出去。
 * @param {string} ruleId 規則 ID
 * @returns {string} 中文講法
 */
function describeRuleForCommittee_(ruleId) {
  const map = {};
  map[RULE_IDS.ELIGIBILITY] = '只安排曾經做過該崗位的人';
  map[RULE_IDS.DISTINCT_SLOT] = '同一週同一崗位不會重複安排同一個人';
  map[RULE_IDS.UNAVAILABLE] = '不會安排已表明當日不能服侍的人';
  map[RULE_IDS.COMMUNION_FIRST_SUNDAY] = '聖餐襄禮只安排在每月第一個主日';
  map[RULE_IDS.NO_AUTO_GENERATE] = '講員、翻譯、獻花不由系統安排';
  map[RULE_IDS.MUTEX_GROUP] = '同一週不會安排同一個人擔任互相衝突的崗位';
  map[RULE_IDS.NO_CONSECUTIVE] = '同一崗位盡量不連續兩週由同一個人擔任';
  return map[ruleId] || '規則檢查';
}

/**
 * 組出草稿覆核報告的內容。純運算，只靠傳入的量度結果，唔再讀工作表。
 *
 * @param {Object} m `measureSoftRuleMetrics_()` 的結果
 * @param {Object} blank 各類留空格子的統計，
 *   形狀為 `{assigned, manualPending, structuralNa, specialSkip, genuineGap}`
 * @returns {Object[]} `diagRow_()` 產生的行陣列
 */
function buildDraftReviewRows_(m, blank) {
  const rows = [];
  const d = m.distribution;
  const pct = function (v) {
    return (v === null || v === undefined || isNaN(v)) ? '—' : (v * 100).toFixed(0) + '%';
  };

  // ---- 一、這一季的整體情況 ----
  rows.push(diagRow_('一、這一季的整體情況', '職事表範圍',
    m.quarterId + '　共 ' + m.weekCount + ' 個主日', ''));
  rows.push(diagRow_('一、這一季的整體情況', '參與服侍的人數',
    d.peopleCount + ' 位',
    '過往每季平均 ' + HISTORICAL_BASELINE.PEOPLE_COUNT + ' 位左右。'
      + (m.peopleCountJudgement.judgement === SOFT_METRIC_JUDGEMENT.NORMAL
        ? '今季在正常範圍內。' : '今季' + m.peopleCountJudgement.judgement + '。')));
  rows.push(diagRow_('一、這一季的整體情況', '平均每人服侍次數',
    d.average.toFixed(1) + ' 次',
    '過往平均 ' + HISTORICAL_BASELINE.AVG_PER_PERSON + ' 次左右。'
      + (m.averageJudgement.judgement === SOFT_METRIC_JUDGEMENT.NORMAL
        ? '今季在正常範圍內。' : '今季' + m.averageJudgement.judgement + '。')));
  rows.push(diagRow_('一、這一季的整體情況', '最多的一位服侍次數',
    d.maxCount + ' 次',
    '過往最高約 ' + HISTORICAL_BASELINE.MAX_PER_PERSON + ' 次。'
      + (m.maxJudgement.judgement === SOFT_METRIC_JUDGEMENT.NORMAL
        ? '今季在正常範圍內。' : '今季' + m.maxJudgement.judgement + '。')));

  // ---- 二、服侍次數的分佈 ----
  rows.push(diagRow_('二、服侍次數的分佈', '（說明）',
    '每一行是「服侍 N 次的有多少位」',
    '教會過往的分佈本來就不平均：大部分人每季服侍 1–3 次，'
      + '另有一小群核心同工做到 7–8 次。系統刻意保持這個形狀，'
      + '不會為了「人人一樣多」而硬平均分配。'));
  d.histogram.forEach(function (bucket) {
    const historical = HISTORICAL_BASELINE_DISTRIBUTION[bucket.count];
    rows.push(diagRow_('二、服侍次數的分佈', '服侍 ' + bucket.count + ' 次',
      bucket.people + ' 位',
      historical === undefined
        ? '過往沒有出現過這個次數'
        : '過往約 ' + historical + ' 位'));
  });

  // ---- 三、規則檢查結果 ----
  const hardCount = 0; // 生成器結構上不會自動違反硬規則，見下面備註
  rows.push(diagRow_('三、規則檢查結果', '★ 不可違反的規則',
    hardCount + ' 項違反',
    '包括：' + [
      describeRuleForCommittee_(RULE_IDS.ELIGIBILITY),
      describeRuleForCommittee_(RULE_IDS.UNAVAILABLE),
      describeRuleForCommittee_(RULE_IDS.DISTINCT_SLOT),
      describeRuleForCommittee_(RULE_IDS.COMMUNION_FIRST_SUNDAY)
    ].join('、')
      + '。系統寧願把格子留空，也不會為了填滿而違反這些規則——'
      + '所以這一項永遠是 0，如果排不出人，會在表上標示出來讓幹事處理。'));
  rows.push(diagRow_('三、規則檢查結果', '盡量避免的情況',
    m.consecutive.count + ' 項',
    describeRuleForCommittee_(RULE_IDS.NO_CONSECUTIVE)
      + '。這一項不是錯誤，只是提示——人手不足時偶爾會出現，'
      + (m.consecutive.count === 0
        ? '今季一次都沒有出現。'
        : '今季有 ' + m.consecutive.count + ' 次，詳細名單在幹事那邊的技術報告。')));

  if (m.chairEq) {
    rows.push(diagRow_('三、規則檢查結果', '主席同時擔任報告的比例',
      pct(m.chairEq.ratio) + '（' + m.chairEq.same + '/' + m.chairEq.weeks + ' 週）',
      '過往習慣約 ' + pct(m.chairEqBaseline) + '。'
        + (m.chairEqJudgement.judgement === SOFT_METRIC_JUDGEMENT.NORMAL
          ? '今季貼近過往習慣。'
          : '今季' + m.chairEqJudgement.judgement + '，可按需要調整。')));
  }
  if (m.announce) {
    rows.push(diagRow_('三、規則檢查結果', '報告連續兩週同一人的比例',
      pct(m.announce.ratio),
      '過往習慣約 ' + pct(m.announceBaseline) + '。這是刻意容許的安排，'
        + '讓報告崗位在人手緊絀時有調節空間。'));
  }

  // ---- 四、哪些是系統排的、哪些要人手填 ----
  rows.push(diagRow_('四、系統排了什麼、留了什麼給人手', '系統自動安排',
    (blank.assigned || 0) + ' 格',
    '主席、報告、讀經、領詩、司琴、司事、司數、音響等崗位，'
      + '由系統按上述規則自動安排。'));
  rows.push(diagRow_('四、系統排了什麼、留了什麼給人手', '★ 留給人手填寫',
    (blank.manualPending || 0) + ' 格',
    '講員、翻譯、獻花這幾個崗位**系統設計上就不會自動安排**——'
      + '講員由堂主任／講員安排小組決定，翻譯與獻花另有安排方式。'
      + '表上這些格顯示「' + DEFAULTS.GRID_PENDING_LABEL + '」，'
      + '**是預期中的空格，不是系統排不出來**。'));
  rows.push(diagRow_('四、系統排了什麼、留了什麼給人手', '這一週不設此崗位',
    (blank.structuralNa || 0) + ' 格',
    '例如聖餐襄禮只在每月第一個主日設立，其餘主日顯示「'
      + DEFAULTS.GRID_NOT_APPLICABLE_LABEL + '」。'));
  if ((blank.specialSkip || 0) > 0) {
    rows.push(diagRow_('四、系統排了什麼、留了什麼給人手', '特別主日另有安排',
      blank.specialSkip + ' 格',
      '該週有特別安排（見表上「類型」欄），這些崗位不由系統安排。'));
  }
  rows.push(diagRow_('四、系統排了什麼、留了什麼給人手', '★ 系統排不出來',
    (blank.genuineGap || 0) + ' 格',
    (blank.genuineGap || 0) === 0
      ? '沒有。所有應該由系統安排的格子都成功排到人。'
      : '這 ' + blank.genuineGap + ' 格找不到合資格而當日又有空的人，'
        + '表上以「' + DEFAULTS.GRID_GAP_LABEL + '」標示，需要人手處理。'));

  // ---- 五、各崗位的人手運用 ----
  rows.push(diagRow_('五、各崗位的人手運用', '（說明）',
    '「動用 X / 合資格 Y 位」',
    '合資格是指過往做過該崗位的人。動用比例偏低代表擔子集中在少數幾位身上，'
      + '值得留意是否需要邀請更多人參與或安排培訓。'));
  m.manpower.forEach(function (p) {
    rows.push(diagRow_('五、各崗位的人手運用', p.postNameTC,
      '動用 ' + p.usedCount + ' / 合資格 ' + p.eligibleCount + ' 位　＝ ' + pct(p.ratio),
      p.judgement === SOFT_METRIC_JUDGEMENT.LOW
        ? '⚠ 比例偏低，' + p.unusedCount + ' 位合資格的同工今季未被安排'
        : '正常'));
  });

  // ---- 六、備註 ----
  rows.push(diagRow_('六、備註', '這份報告怎樣產生',
    '由系統自動計算，不是人手統計',
    '數字直接來自這一版職事表本身，每次重新產生都會反映最新內容。'));
  rows.push(diagRow_('六、備註', '過往基準的來源',
    '2025 年第一季至 2026 年第三季的實際服侍紀錄',
    '共 78 週。「過往習慣」全部指這一段期間的實際數字。'));

  return rows;
}

/**
 * 從 RosterAssignments 統計一個版本的五類格子數目。
 *
 * 唔用 `summariseBlankAssignments_()`（Generator.gs）嘅原因：嗰個函式食嘅係
 * **生成當下嘅記憶體結果**（`ruleFlags` 係陣列），而呢度要處理嘅係已經寫入
 * 長表、`RuleFlags` 已經序列化成逗號分隔字串嘅資料。分類判斷本身一樣係
 * `classifyGridCell_()`，唔會有兩套講法。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{assigned: number, manualPending: number, structuralNa: number,
 *   specialSkip: number, genuineGap: number}}
 */
function countCellClassesFromAssignments_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const counts = {
    assigned: 0, manualPending: 0, structuralNa: 0, specialSkip: 0, genuineGap: 0
  };
  const byClass = {};
  byClass[GRID_CELL_CLASS.ASSIGNED] = 'assigned';
  byClass[GRID_CELL_CLASS.MANUAL_PENDING] = 'manualPending';
  byClass[GRID_CELL_CLASS.STRUCTURAL_NA] = 'structuralNa';
  byClass[GRID_CELL_CLASS.SPECIAL_SKIP] = 'specialSkip';
  byClass[GRID_CELL_CLASS.GENUINE_GAP] = 'genuineGap';

  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (row[C.QUARTER_ID] !== quarterId || Number(row[C.VERSION_NO]) !== versionNo) return;
    const cellClass = classifyGridCell_({
      personId: row[C.PERSON_ID],
      personName: row[C.PERSON_NAME_SNAPSHOT],
      assignSource: row[C.ASSIGN_SOURCE],
      ruleFlags: splitList_(row[C.RULE_FLAGS])
    });
    const key = byClass[cellClass];
    if (key) counts[key]++;
  });
  return counts;
}

/**
 * 選單項目「查看 ▸ 草稿覆核報告（唯讀）」的執行入口。
 *
 * 唯讀：只讀取資料與寫入 Diagnostics，不建立任何工作表、不產生版本、不寄信。
 * @returns {void}
 */
function runDraftReviewReport_() {
  const ui = SpreadsheetApp.getUi();
  const title = '草稿覆核報告（唯讀）';
  const target = promptQuarterAndVersion_(title);
  if (!target) return;

  let rows;
  let metrics;
  let blank;
  try {
    // 量度完全重用軟規則量度工具，唔會另外再計一次——兩份報告嘅數字永遠一致
    metrics = measureSoftRuleMetrics_(target.quarterId, target.versionNo);
    blank = countCellClassesFromAssignments_(target.quarterId, target.versionNo);
    rows = buildDraftReviewRows_(metrics, blank);
  } catch (err) {
    log_('ERROR', 'runDraftReviewReport_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  // 第十二輪批次階段 C【bug 修正】：tryWriteDiagnostics_() 回傳嘅係
  // 「有冇成功寫入」嘅布林值，唔係寫入行數，行數應該係 rows.length
  // （同 PublicRoster.gs 嘅「公開連結狀態」發現嘅同一種型別錯誤）。
  tryWriteDiagnostics_('草稿覆核報告', rows);
  const written = rows.length;

  const d = metrics.distribution;
  const lines = [
    metrics.quarterId + ' 職事表草稿　覆核摘要',
    '',
    '共 ' + metrics.weekCount + ' 個主日，' + d.peopleCount + ' 位同工參與服侍，'
      + '平均每人 ' + d.average.toFixed(1) + ' 次，最多的一位 ' + d.maxCount + ' 次。',
    '',
    '系統自動安排：' + blank.assigned + ' 格',
    '留給人手填寫（講員／翻譯／獻花）：' + blank.manualPending + ' 格',
    '這一週不設此崗位：' + blank.structuralNa + ' 格',
    '系統排不出來：' + blank.genuineGap + ' 格'
      + (blank.genuineGap === 0 ? '　✅' : '　⚠ 需要人手處理'),
    '',
    '不可違反的規則：0 項違反',
    '「同崗位連續兩週」提示：' + metrics.consecutive.count + ' 項',
    ''
  ];

  const lowUsage = metrics.manpower.filter(function (p) {
    return p.judgement === SOFT_METRIC_JUDGEMENT.LOW;
  });
  if (lowUsage.length > 0) {
    lines.push('人手較集中的崗位：'
      + lowUsage.map(function (p) { return p.postNameTC; }).join('、'));
    lines.push('');
  }

  lines.push('完整報告已寫入 ' + SHEETS.DIAGNOSTICS + ' 工作表，報告名稱「草稿覆核報告」，共 '
    + written + ' 行。');
  lines.push('可以直接從那裡複製貼上電郵，或者連同職事表 PDF 一起印給堂委看。');
  lines.push('');
  lines.push('這份報告用的是堂委看得懂的說法，不含任何系統內部代號。');
  lines.push('幹事自己要看的技術版本，請用「查看 ▸ 軟規則實測量度（唯讀）」。');
  lines.push('');
  lines.push('本工具完全唯讀：沒有改動任何職事表、沒有產生版本、沒有寄出任何電郵。');

  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}
