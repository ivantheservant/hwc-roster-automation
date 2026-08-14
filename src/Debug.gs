/**
 * 診斷 SOFT_CHAIR_EQ_ANNOUNCE、SOFT_ANNOUNCE_RELIEF 與選人加權的實際運作。
 *
 * 會在記憶體中重跑一次排表並記錄每格的候選人分數，但**不寫入任何工作表、
 * 不建立版本**。結果只輸出到 Logger。
 *
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @returns {Object} 診斷摘要，同時已寫入 Logger
 */
function debugSoftRules(quarterId) {
  const context = buildGeneratorContext_(quarterId);
  context.trace = [];
  const result = buildRoster_(context);

  const lines = [];
  lines.push('=== debugSoftRules ' + quarterId + ' ===');
  lines.push('');
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.CHAIR_EQ_ANNOUNCE));
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.CHAIR_PREFER_DUAL));
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.ANNOUNCE_RELIEF));
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.QUARTER_DISTRIBUTION));
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.PERSONAL_QUOTA));
  lines.push(describeRuleSetting_(context.rules, RULE_IDS.MAX_PER_QUARTER));
  lines.push('');
  lines.push(describePersonQuotas_(context));
  lines.push('');
  lines.push('SELECTION_WEIGHT_HISTORICAL = ' + context.historicalWeight
    + '（0 = 全按最久沒服侍，1 = 全按歷史次數）');
  lines.push('計分量級（可在 Config 以 SCORE_* 覆寫）：'
    + 'SELECTION_WEIGHT = ' + context.scoreWeights.selectionWeight
    + '　PREFERENCE_BONUS = ' + context.scoreWeights.preferenceBonus
    + '　CHAIR_DUAL_BONUS = ' + context.scoreWeights.chairDualBonus);
  lines.push('');

  const scope = getChairAnnounceScope_(context.rules);
  if (!scope) {
    lines.push('⚠ SOFT_CHAIR_EQ_ANNOUNCE 的 ScopePostIDs 不足兩個崗位，規則無法生效。');
    Logger.log(lines.join('\n'));
    return { error: 'SCOPE_INVALID' };
  }
  lines.push('主席崗位 = ' + scope.chairPostId + '　報告崗位 = ' + scope.announcePostId);
  lines.push('報告崗位的合資格人數 = ' + (context.eligibility.byPost[scope.announcePostId] || []).length);
  lines.push('主席崗位的合資格人數 = ' + (context.eligibility.byPost[scope.chairPostId] || []).length);
  const chairPool = context.eligibility.byPost[scope.chairPostId] || [];
  const overlap = countOverlap_(context.eligibility, scope);
  lines.push('兩個崗位都合資格的人數 = ' + overlap + ' / ' + chairPool.length
    + '（只有主崗位資格的有 ' + (chairPool.length - overlap) + ' 人）');
  lines.push('若主崗位平均分配，兼任比例的理論上限 = '
    + (chairPool.length === 0 ? 0 : (overlap / chairPool.length * 100).toFixed(1)) + '%'
    + ' ← SOFT_CHAIR_PREFER_DUAL 就是為了突破這個上限');
  lines.push('');

  const partnerPool = context.eligibility.byPost[scope.announcePostId] || [];
  const isDual = function (personId) { return partnerPool.indexOf(personId) !== -1; };

  lines.push('=== 逐週明細（主席崗位：是否派給可兼任報告者）===');
  context.trace
    .filter(function (t) { return t.postId === scope.chairPostId; })
    .forEach(function (t) {
      const pace = t.ratioState.dualQualified + ' / ' + t.ratioState.dualAssigned;
      lines.push('【' + t.serviceDate + '】獲派 = ' + nameOfPerson_(context, t.winner)
        + (isDual(t.winner) ? '（可兼報告 ✓）' : '（只有主席資格）')
        + '　派此格前的累計雙重資格 ' + pace);
    });

  lines.push('');
  lines.push('=== 逐週明細（報告崗位）===');
  const announceTraces = context.trace.filter(function (t) { return t.postId === scope.announcePostId; });
  const nameOf = function (personId) { return nameOfPerson_(context, personId); };

  announceTraces.forEach(function (t) {
    const chairThisWeek = findChairOfWeek_(result.assignments, t.serviceDate, scope.chairPostId);
    const pace = t.ratioState.chairEqAnnounce + ' / ' + t.ratioState.weeksCounted
      + ' = ' + (t.ratioState.chairEqAnnounce / Math.max(1, t.ratioState.weeksCounted)).toFixed(3);
    lines.push('');
    lines.push('【' + t.serviceDate + '】主席 = ' + nameOf(chairThisWeek)
      + '　報告獲派 = ' + nameOf(t.winner));
    lines.push('  累計主席兼報告 ' + pace
      + '　累計報告連續 ' + t.ratioState.announceConsecutive + ' / ' + t.ratioState.weeksCounted);
    lines.push('  候選人分數（分數越低越優先）：');
    t.candidates.forEach(function (c) {
      const isChair = c.personId === chairThisWeek ? ' ★本週主席' : '';
      lines.push('    ' + padRight_(nameOf(c.personId), 10)
        + ' 總分=' + c.score.toFixed(1)
        + '　扣分=' + c.penalty
        + '　獎勵=' + c.bonus
        + '　選人分=' + (c.selectionScore === undefined ? '-' : c.selectionScore.toFixed(3))
        + '（歷史次數=' + c.historicalCount
        + '，距上次服侍=' + (c.staleness === null ? '從未' : c.staleness + '天') + '）'
        + (c.violations.length > 0 ? '　違反[' + c.violations.join(',') + ']' : '')
        + isChair);
    });
    if (chairThisWeek && !t.candidates.some(function (c) { return c.personId === chairThisWeek; })) {
      lines.push('    ⚠ 本週主席不在報告崗位的候選名單內（Eligibility 沒有這一組），因此不可能兼任');
    }
  });

  const summary = summariseTrace_(result, context, scope);
  lines.push('');
  lines.push('=== 結果 ===');
  const dualChairWeeks = context.serviceDates.filter(function (d) {
    const chair = findChairOfWeek_(result.assignments, d.serviceDate, scope.chairPostId);
    return chair && isDual(chair);
  }).length;
  lines.push('主席派給可兼報告者：' + dualChairWeeks + ' / ' + summary.weeks
    + ' = ' + (summary.weeks === 0 ? 0 : (dualChairWeeks / summary.weeks * 100).toFixed(1)) + '%'
    + '（SOFT_CHAIR_PREFER_DUAL 目標 '
    + describeTargetOnly_(context.rules, RULE_IDS.CHAIR_PREFER_DUAL) + '）');
  lines.push('主席兼報告：' + summary.chairEqWeeks + ' / ' + summary.weeks
    + ' = ' + (summary.chairEqRatio * 100).toFixed(1) + '%');
  lines.push('報告連續兩週：' + summary.announceConsecutive + ' / ' + Math.max(0, summary.weeks - 1)
    + ' = ' + (summary.announceRatio * 100).toFixed(1) + '%');
  lines.push('服侍次數：' + summary.peopleCount + ' 人、平均 ' + summary.average.toFixed(2)
    + '、最高 ' + summary.maxCount);
  lines.push('');
  lines.push('（以上為記憶體中的模擬結果，未寫入任何工作表）');

  Logger.log(lines.join('\n'));
  return summary;
}

/**
 * 把每人配額整理成可讀的摘要：先列配額的分佈，再列配額最高的十位。
 * @param {Object} context 排表 context
 * @returns {string} 描述文字
 */
function describePersonQuotas_(context) {
  const quotas = context.quotaByPerson || {};
  const personIds = Object.keys(quotas);
  if (personIds.length === 0) return '每人配額：（無資料）';

  const histogram = {};
  personIds.forEach(function (id) { histogram[quotas[id]] = (histogram[quotas[id]] || 0) + 1; });
  const total = personIds.reduce(function (sum, id) { return sum + quotas[id]; }, 0);

  const top = personIds
    .slice()
    .sort(function (a, b) {
      if (quotas[b] !== quotas[a]) return quotas[b] - quotas[a];
      return a < b ? -1 : 1;
    })
    .slice(0, 10)
    .map(function (id) { return nameOfPerson_(context, id) + ' ' + quotas[id]; });

  const lines = [
    '每人配額（SOFT_PERSONAL_QUOTA 用）：共 ' + personIds.length + ' 人、配額總和 ' + total,
    '　配額分佈　' + formatHistogram_(histogram),
    '　歷史分佈　' + formatHistogram_(HISTORICAL_BASELINE_DISTRIBUTION) + '（作對照）',
    '　配額最高十位：' + top.join('、')
  ];
  return lines.join('\n');
}

/**
 * 依 PersonID 取得中文姓名，供診斷輸出使用。
 * @param {Object} context 排表 context
 * @param {string} personId 對象的 PersonID
 * @returns {string} 中文姓名；查不到時回傳 PersonID 或「（無）」
 */
function nameOfPerson_(context, personId) {
  const person = context.peopleById[personId];
  return person ? person.nameTC : (personId || '（無）');
}

/**
 * 把一條規則在 RuleSettings 的實際設定值印成一行，用來確認讀到的是數字而非空值或字串。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {string} ruleId 規則 ID
 * @returns {string} 描述文字
 */
function describeRuleSetting_(rules, ruleId) {
  const rule = rules[ruleId];
  if (!rule) return ruleId + '：⚠ RuleSettings 中找不到這條規則';

  const rawTarget = rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE];
  const rawTolerance = rule[COLUMNS.RULE_SETTINGS.TOLERANCE];
  const target = Number(rawTarget);

  return ruleId + '：Enabled=' + isRuleEnabled_(rules, ruleId)
    + '　Level=' + rule[COLUMNS.RULE_SETTINGS.LEVEL]
    + '　TargetValue=' + JSON.stringify(rawTarget) + '（轉為數字 ' + target + '，'
    + (isNaN(target) ? '⚠ 不是有效數字，規則不會生效' : '有效') + '）'
    + '　Tolerance=' + JSON.stringify(rawTolerance)
    + '　ScopePostIDs=' + JSON.stringify(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
}

/**
 * 只取出某條規則的 TargetValue，供摘要行顯示。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @param {string} ruleId 規則 ID
 * @returns {string} 目標值描述；規則不存在時說明尚未加入
 */
function describeTargetOnly_(rules, ruleId) {
  const rule = rules[ruleId];
  if (!rule) return '此規則尚未加入 RuleSettings';
  if (!isRuleEnabled_(rules, ruleId)) return '此規則 Enabled=FALSE';
  return String(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
}

/**
 * 從 RuleSettings 取出主席與報告的崗位 ID。
 * @param {Object.<string, Object>} rules RuleSettings 對照表
 * @returns {?{chairPostId: string, announcePostId: string}} 崗位組合；設定不足時回傳 null
 */
function getChairAnnounceScope_(rules) {
  const rule = rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  if (!rule) return null;
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length < 2) return null;
  return { chairPostId: scope[0], announcePostId: scope[1] };
}

/**
 * 計算同時具備主席與報告資格的人數。
 * @param {Object} eligibility readEligibility() 的結果
 * @param {{chairPostId: string, announcePostId: string}} scope 崗位組合
 * @returns {number} 兩個崗位都合資格的人數
 */
function countOverlap_(eligibility, scope) {
  const chairs = eligibility.byPost[scope.chairPostId] || [];
  const announces = eligibility.byPost[scope.announcePostId] || [];
  return chairs.filter(function (personId) {
    return announces.indexOf(personId) !== -1;
  }).length;
}

/**
 * 找出某個主日獲派主席的人。
 * @param {Object[]} assignments 派工結果
 * @param {string} serviceDate 主日日期
 * @param {string} chairPostId 主席崗位 ID
 * @returns {string} PersonID；找不到時回傳空字串
 */
function findChairOfWeek_(assignments, serviceDate, chairPostId) {
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a.serviceDate === serviceDate && a.postId === chairPostId && a.personId) return a.personId;
  }
  return '';
}

/**
 * 統計模擬結果的各項比例與次數分佈。
 * @param {{assignments: Object[]}} result buildRoster_() 的結果
 * @param {Object} context 排表 context
 * @param {{chairPostId: string, announcePostId: string}} scope 崗位組合
 * @returns {Object} 統計摘要
 */
function summariseTrace_(result, context, scope) {
  const dates = context.serviceDates.map(function (d) { return d.serviceDate; });
  const byDatePost = {};
  const counts = {};
  result.assignments.forEach(function (a) {
    if (!a.personId) return;
    byDatePost[a.serviceDate + '|' + a.postId] = a.personId;
    counts[a.personId] = (counts[a.personId] || 0) + 1;
  });

  let weeks = 0;
  let chairEqWeeks = 0;
  dates.forEach(function (d) {
    const chair = byDatePost[d + '|' + scope.chairPostId];
    const announce = byDatePost[d + '|' + scope.announcePostId];
    if (!chair || !announce) return;
    weeks++;
    if (chair === announce) chairEqWeeks++;
  });

  let pairs = 0;
  let announceConsecutive = 0;
  for (let i = 1; i < dates.length; i++) {
    const prev = byDatePost[dates[i - 1] + '|' + scope.announcePostId];
    const cur = byDatePost[dates[i] + '|' + scope.announcePostId];
    if (!prev || !cur) continue;
    pairs++;
    if (prev === cur) announceConsecutive++;
  }

  const values = Object.keys(counts).map(function (k) { return counts[k]; });
  const total = values.reduce(function (s, v) { return s + v; }, 0);

  return {
    weeks: weeks,
    chairEqWeeks: chairEqWeeks,
    chairEqRatio: weeks === 0 ? 0 : chairEqWeeks / weeks,
    announceConsecutive: announceConsecutive,
    announceRatio: pairs === 0 ? 0 : announceConsecutive / pairs,
    peopleCount: values.length,
    average: values.length === 0 ? 0 : total / values.length,
    maxCount: values.reduce(function (m, v) { return v > m ? v : m; }, 0)
  };
}

/**
 * 印出職事表 grid 工作表第 1 行（中文標題）與第 2 行（機器鍵）的實際內容，逐欄對照。
 * 用來確認標題與編號有沒有錯位。不改動工作表。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{headers: string[], keys: string[]}} 實際讀到的兩行內容
 */
function debugGridHeaders(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    log_('ERROR', 'debugGridHeaders: 找不到工作表 ' + sheetName);
    return null;
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

  const lines = ['=== debugGridHeaders ' + sheetName + ' ==='];
  lines.push('共 ' + lastCol + ' 欄');
  lines.push('');
  lines.push('欄號　中文標題（第1行）　　機器鍵（第2行）');
  for (let i = 0; i < lastCol; i++) {
    lines.push('  ' + padRight_(String(i + 1), 4)
      + padRight_(String(headers[i] || ''), 16)
      + String(keys[i] || ''));
  }
  lines.push('');
  lines.push('完整標題陣列：' + JSON.stringify(headers));

  Logger.log(lines.join('\n'));
  return { headers: headers, keys: keys };
}

/**
 * 把字串補到指定寬度，方便 Logger 輸出對齊。
 * @param {string} text 原始文字
 * @param {number} width 目標寬度
 * @returns {string} 補足空格後的文字
 */
function padRight_(text, width) {
  let s = String(text);
  while (s.length < width) s += '　';
  return s;
}
