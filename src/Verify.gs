/**
 * 核對指定版本的職事表：計算各項指標與硬規則違反情況，
 * 結果寫入 Verify_{quarterId}_v{versionNo} 工作表。
 * @param {string} quarterId 季度 ID，例如 "2026T4"
 * @param {number} versionNo 版本號
 * @returns {{report: Object, sheetName: string}} 核對報告與產生的工作表名稱
 */
function verifyRoster(quarterId, versionNo) {
  const context = buildVerifyContext_(quarterId, versionNo);
  if (context.assignments.length === 0) {
    throw new Error('找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄');
  }
  const report = buildVerifyReport_(context);
  const sheetName = writeVerifySheet_(quarterId, versionNo, report);
  return { report: report, sheetName: sheetName };
}

/**
 * 讀取核對所需的全部資料，整理成純函式可直接使用的 context 物件。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} 供 buildVerifyReport_() 使用的 context
 */
function buildVerifyContext_(quarterId, versionNo) {
  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const C = COLUMNS.ROSTER_ASSIGNMENTS;

  const assignments = readSheet(SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID],
        slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID],
        personName: row[C.PERSON_NAME_SNAPSHOT],
        assignSource: row[C.ASSIGN_SOURCE]
      };
    });

  // 第十六輪批次階段 B：身分名單與個人崗位排除。三條路徑
  // （生成／步驟 3-5 重跑／核對）用同一個 `buildRoleContext_()`，
  // 見 Roles.gs 檔頭嘅 B1 說明。
  const posts = readPostsNormalized();
  const eligibility = readEligibility();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  eligibility.byPost = roleContext.eligibleByPost;

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    assignments: assignments,
    serviceDates: readServiceDatesNormalized(quarterId, timezone),
    posts: posts,
    eligibility: eligibility,
    roles: roleContext.roles,
    personPostExclusions: roleContext.exclusions,
    unavailable: readUnavailableNormalized(timezone),
    rules: readRules()
  };
}

/**
 * 核對核心：純函式，只依 context 內的資料運算，不讀寫任何工作表。
 * @param {Object} context buildVerifyContext_() 產生的資料集
 * @returns {{rows: Object[], summary: Object}} 報告列與摘要
 */
function buildVerifyReport_(context) {
  const rows = [];

  const adjacency = computeAdjacentRepeatRates_(context);
  const relief = readReliefPostSetting_(context);
  rows.push(makeSectionRow_('1. 逐崗位相鄰週重複率（目標 0%，洩壓閥崗位除外）'));
  adjacency.forEach(function (item) {
    // 報告崗位是刻意設計的洩壓閥，容許連續兩週同一人，不應被當成違規
    const isRelief = relief && item.postId === relief.postId;
    const target = isRelief
      ? formatPercent_(relief.target) + ' ± ' + formatPercent_(relief.tolerance)
      : '0%';
    const deviates = isRelief
      ? Math.abs(item.rate - relief.target) > relief.tolerance
      : item.repeats > 0;
    rows.push(makeItemRow_(
      item.postNameTC + '（' + item.postId + '）' + (isRelief ? '　洩壓閥' : ''),
      formatPercent_(item.rate) + '　' + item.repeats + '/' + item.pairs + ' 對',
      target,
      deviates
    ));
  });

  // 統計不含洩壓閥崗位：否則報告的正常連續會令「相鄰週重複」永遠顯示未達標
  const totalRepeats = adjacency.reduce(function (sum, item) {
    if (relief && item.postId === relief.postId) return sum;
    return sum + item.repeats;
  }, 0);

  const chairEq = computeChairEqAnnounceRatio_(context);
  rows.push(makeSectionRow_('2. 主席與報告同一人的週數比例'));
  if (chairEq) {
    rows.push(makeItemRow_(
      '同一人週數比例',
      formatPercent_(chairEq.ratio) + '　' + chairEq.same + '/' + chairEq.weeks + ' 週',
      formatPercent_(chairEq.target) + ' ± ' + formatPercent_(chairEq.tolerance),
      chairEq.deviates
    ));
  } else {
    rows.push(makeItemRow_('同一人週數比例', '無法計算（規則或資料不足）', '-', false));
  }

  const announce = computeAnnounceConsecutiveRatio_(context);
  rows.push(makeSectionRow_('3. 報告連續兩週同一人的相鄰 pair 比例'));
  if (announce) {
    rows.push(makeItemRow_(
      '相鄰 pair 重複比例',
      formatPercent_(announce.ratio) + '　' + announce.repeats + '/' + announce.pairs + ' 對',
      formatPercent_(announce.target) + ' ± ' + formatPercent_(announce.tolerance),
      announce.deviates
    ));
  } else {
    rows.push(makeItemRow_('相鄰 pair 重複比例', '無法計算（規則或資料不足）', '-', false));
  }

  const dist = computeServiceDistribution_(context);
  rows.push(makeSectionRow_('4. 服侍次數分佈'));
  rows.push(makeItemRow_('總用人數', dist.peopleCount + ' 人',
    HISTORICAL_BASELINE.PEOPLE_COUNT + ' 人', dist.peopleCountDeviates));
  rows.push(makeItemRow_('平均次數', dist.average.toFixed(2) + ' 次',
    dist.averageTarget + ' 次', dist.averageDeviates));
  rows.push(makeItemRow_('最高次數', dist.maxCount + ' 次',
    dist.maxTarget + ' 次', dist.maxDeviates));
  dist.histogram.forEach(function (bucket) {
    rows.push(makeItemRow_('　服侍 ' + bucket.count + ' 次的人數', bucket.people + ' 人', '', false));
  });

  // 第二十一輪批次階段 A：硬規則違反分三類顯示。
  // 只有「真違反」先算需要處理——已放行同「版本生成後才新增的申報」
  // 照樣列出嚟，但唔會被叫做 bug（詳細理由見 HardViolationClass.gs）。
  const hard = checkHardRuleViolations_(context);
  const classified = classifyHardViolations_(
    hard.all, buildHardViolationClassContext_(
      context.quarterId, context.versionNo, context.unavailable));

  rows.push(makeSectionRow_('5. 硬規則違反檢查（分三類；只有「真違反」需要處理）'));
  rows.push(makeItemRow_('　' + HARD_VIOLATION_CLASS_LABEL.REAL,
    classified.real.length + ' 項', '0 項', classified.real.length > 0));
  rows.push(makeItemRow_('　' + HARD_VIOLATION_CLASS_LABEL.RELEASED,
    classified.released.length + ' 項', '', false));
  rows.push(makeItemRow_('　' + HARD_VIOLATION_CLASS_LABEL.LATE_UNAVAILABLE,
    classified.lateUnavailable.length + ' 項', '', false));

  hard.groups.forEach(function (group) {
    const classedItems = group.items.map(function (item) {
      return classified.items.filter(function (c) {
        return c.violationKey === buildHardViolationKey_(context.quarterId, item);
      })[0] || item;
    });
    const realCount = classedItems.filter(function (c) {
      return c.violationClass === HARD_VIOLATION_CLASS.REAL;
    }).length;
    rows.push(makeItemRow_(group.label, group.items.length + ' 項',
      '0 項（真違反）', realCount > 0));
    classedItems.forEach(function (c) {
      const tag = c.classLabel ? '［' + c.classLabel + '］' : '';
      rows.push(makeItemRow_('　' + tag + (c.text || ''), '', '',
        c.violationClass === HARD_VIOLATION_CLASS.REAL));
    });
  });

  return {
    rows: rows,
    summary: {
      adjacentRepeats: totalRepeats,
      chairEq: chairEq,
      announce: announce,
      distribution: dist,
      hardViolationCount: hard.total,
      hardViolationClass: classified
    }
  };
}

/**
 * 讀取洩壓閥崗位的設定（SOFT_ANNOUNCE_RELIEF）。
 * 該崗位容許連續兩週同一人，目標比例由 RuleSettings 決定，不應以 0% 為目標。
 * @param {Object} context 核對用的資料集
 * @returns {?{postId: string, target: number, tolerance: number}} 設定；規則不存在時回傳 null
 */
function readReliefPostSetting_(context) {
  const rule = context.rules[RULE_IDS.ANNOUNCE_RELIEF];
  if (!rule || !isRuleEnabled_(context.rules, RULE_IDS.ANNOUNCE_RELIEF)) return null;

  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length === 0) return null;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  if (isNaN(target)) return null;

  return {
    postId: scope[0],
    target: target,
    tolerance: Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0
  };
}

/**
 * 建立 {postId: {serviceDate: [personId...]}} 索引，只計入實際有派人的格子。
 * @param {Object[]} assignments 派工紀錄
 * @returns {Object.<string, Object.<string, string[]>>} 崗位／日期／人員索引
 */
function buildPostWeekMap_(assignments) {
  const map = {};
  assignments.forEach(function (a) {
    if (!a.personId) return;
    if (!map[a.postId]) map[a.postId] = {};
    if (!map[a.postId][a.serviceDate]) map[a.postId][a.serviceDate] = [];
    map[a.postId][a.serviceDate].push(a.personId);
  });
  return map;
}

/**
 * 計算每個崗位的相鄰週重複率：連續兩個主日出現同一人的比例。
 * 多人崗位（例如司事、司數）只要兩週的人員有交集就算重複。
 * @param {Object} context 核對用的資料集
 * @returns {Object[]} 每個崗位的 {postId, postNameTC, pairs, repeats, rate}
 */
function computeAdjacentRepeatRates_(context) {
  const map = buildPostWeekMap_(context.assignments);
  const dates = context.serviceDates.map(function (d) { return d.serviceDate; });

  return context.posts.map(function (post) {
    const byDate = map[post.postId] || {};
    let pairs = 0;
    let repeats = 0;
    for (let i = 1; i < dates.length; i++) {
      const prev = byDate[dates[i - 1]];
      const cur = byDate[dates[i]];
      if (!prev || !cur || prev.length === 0 || cur.length === 0) continue;
      pairs++;
      const overlap = cur.some(function (p) { return prev.indexOf(p) !== -1; });
      if (overlap) repeats++;
    }
    return {
      postId: post.postId,
      postNameTC: post.postNameTC,
      pairs: pairs,
      repeats: repeats,
      rate: pairs === 0 ? 0 : repeats / pairs
    };
  }).filter(function (item) { return item.pairs > 0; });
}

/**
 * 計算主席與報告由同一人擔任的週數比例。
 * 兩個崗位 ID 與目標值皆取自 RuleSettings 的 SOFT_CHAIR_EQ_ANNOUNCE。
 * @param {Object} context 核對用的資料集
 * @returns {?Object} {same, weeks, ratio, target, tolerance, deviates}；規則不存在時回傳 null
 */
function computeChairEqAnnounceRatio_(context) {
  const rule = context.rules[RULE_IDS.CHAIR_EQ_ANNOUNCE];
  if (!rule) return null;
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length < 2) return null;

  const map = buildPostWeekMap_(context.assignments);
  const chairByDate = map[scope[0]] || {};
  const announceByDate = map[scope[1]] || {};

  let weeks = 0;
  let same = 0;
  context.serviceDates.forEach(function (d) {
    const chair = chairByDate[d.serviceDate];
    const announce = announceByDate[d.serviceDate];
    if (!chair || !announce || chair.length === 0 || announce.length === 0) return;
    weeks++;
    if (announce.some(function (p) { return chair.indexOf(p) !== -1; })) same++;
  });
  if (weeks === 0) return null;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  const ratio = same / weeks;
  return {
    same: same,
    weeks: weeks,
    ratio: ratio,
    target: target,
    tolerance: tolerance,
    deviates: isNaN(target) ? false : Math.abs(ratio - target) > tolerance
  };
}

/**
 * 計算報告崗位連續兩週同一人的相鄰 pair 比例。
 * 崗位 ID 與目標值取自 RuleSettings 的 SOFT_ANNOUNCE_RELIEF。
 * @param {Object} context 核對用的資料集
 * @returns {?Object} {repeats, pairs, ratio, target, tolerance, deviates}；規則不存在時回傳 null
 */
function computeAnnounceConsecutiveRatio_(context) {
  const rule = context.rules[RULE_IDS.ANNOUNCE_RELIEF];
  if (!rule) return null;
  const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
  if (scope.length === 0) return null;

  const map = buildPostWeekMap_(context.assignments);
  const byDate = map[scope[0]] || {};
  const dates = context.serviceDates.map(function (d) { return d.serviceDate; });

  let pairs = 0;
  let repeats = 0;
  for (let i = 1; i < dates.length; i++) {
    const prev = byDate[dates[i - 1]];
    const cur = byDate[dates[i]];
    if (!prev || !cur || prev.length === 0 || cur.length === 0) continue;
    pairs++;
    if (cur.some(function (p) { return prev.indexOf(p) !== -1; })) repeats++;
  }
  if (pairs === 0) return null;

  const target = Number(rule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]);
  const tolerance = Number(rule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0;
  const ratio = repeats / pairs;
  return {
    repeats: repeats,
    pairs: pairs,
    ratio: ratio,
    target: target,
    tolerance: tolerance,
    deviates: isNaN(target) ? false : Math.abs(ratio - target) > tolerance
  };
}

/**
 * 計算本季服侍次數分佈：次數對人數的對照表、總用人數、平均次數與最高次數。
 * 平均次數與最高次數的目標值分別取自 SOFT_QUARTER_DISTRIBUTION 與 SOFT_MAX_PER_QUARTER。
 * @param {Object} context 核對用的資料集
 * @returns {Object} 分佈統計與各項是否偏離基準
 */
function computeServiceDistribution_(context) {
  const counts = {};
  context.assignments.forEach(function (a) {
    if (!a.personId) return;
    counts[a.personId] = (counts[a.personId] || 0) + 1;
  });

  const personIds = Object.keys(counts);
  const values = personIds.map(function (id) { return counts[id]; });
  const total = values.reduce(function (sum, v) { return sum + v; }, 0);
  const peopleCount = personIds.length;
  const average = peopleCount === 0 ? 0 : total / peopleCount;
  const maxCount = values.reduce(function (m, v) { return v > m ? v : m; }, 0);

  const buckets = {};
  values.forEach(function (v) { buckets[v] = (buckets[v] || 0) + 1; });
  const histogram = Object.keys(buckets)
    .map(function (k) { return { count: Number(k), people: buckets[k] }; })
    .sort(function (a, b) { return a.count - b.count; });

  const distRule = context.rules[RULE_IDS.QUARTER_DISTRIBUTION];
  const maxRule = context.rules[RULE_IDS.MAX_PER_QUARTER];
  const averageTarget = distRule ? Number(distRule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : HISTORICAL_BASELINE.AVG_PER_PERSON;
  const averageTolerance = distRule ? (Number(distRule[COLUMNS.RULE_SETTINGS.TOLERANCE]) || 0) : DEFAULTS.QUARTER_DISTRIBUTION_TOLERANCE;
  const maxTarget = maxRule ? Number(maxRule[COLUMNS.RULE_SETTINGS.TARGET_VALUE]) : HISTORICAL_BASELINE.MAX_PER_PERSON;

  const peopleTolerance = HISTORICAL_BASELINE.PEOPLE_COUNT * HISTORICAL_BASELINE.PEOPLE_TOLERANCE_RATIO;

  return {
    peopleCount: peopleCount,
    average: average,
    maxCount: maxCount,
    histogram: histogram,
    averageTarget: averageTarget,
    maxTarget: maxTarget,
    peopleCountDeviates: Math.abs(peopleCount - HISTORICAL_BASELINE.PEOPLE_COUNT) > peopleTolerance,
    averageDeviates: !isNaN(averageTarget) && Math.abs(average - averageTarget) > averageTolerance,
    maxDeviates: !isNaN(maxTarget) && maxCount > maxTarget
  };
}

/**
 * 檢查所有硬規則是否被違反。任何一項有結果都代表排表程式有 bug。
 * @param {Object} context 核對用的資料集
 * @returns {{groups: Object[], total: number}} 各項檢查的結果與違反總數
 */
function checkHardRuleViolations_(context) {
  // 第十八輪批次階段 A2：`undefined` 唔可以當成「冇人持有任何身分」，
  // 詳細理由見 `requireRoleContextField_()`（Roles.gs）。
  const roles = requireRoleContextField_(context, 'roles', 'checkHardRuleViolations_');
  const exclusions = requireRoleContextField_(
    context, 'personPostExclusions', 'checkHardRuleViolations_');

  const postById = {};
  context.posts.forEach(function (p) { postById[p.postId] = p; });
  const dateInfo = {};
  context.serviceDates.forEach(function (d) { dateInfo[d.serviceDate] = d; });

  const notEligible = [];
  const unavailableHits = [];
  const notFirstSunday = [];
  const autoGenerateHits = [];
  // 第十六輪批次階段 B：教會新規則 1／2／3
  const roleViolations = [];
  const exclusionViolations = [];

  // 第二十一輪批次階段 A：違反項目由「一句字串」改成**結構化物件**。
  //
  // 點解要改：分類（真違反／已放行／版本生成後才新增嘅申報）要用明確嘅 key
  // 比對——季度＋服侍日期＋PostID＋SlotIndex＋PersonID＋RuleID。
  // 如果項目只係一句 `2026-11-08 ANNOUNCE#1 某某：某某原因`，就只可以靠
  // 訊息文字比對，而訊息文字係會改嘅（第十七輪就改過一次措辭）——
  // 一改就會靜靜咁對唔上，然後所有已放行嘅項目都會變返「真違反」。
  //
  // `text` 欄保留原本嘅顯示字串，所以顯示層完全唔使改語氣。
  const mk = function (a, ruleId, reason) {
    return {
      serviceDate: a.serviceDate,
      postId: a.postId,
      slotIndex: a.slotIndex,
      personId: a.personId,
      personName: a.personName || '',
      ruleId: ruleId,
      reason: reason,
      text: a.serviceDate + ' ' + a.postId + '#' + a.slotIndex
        + ' ' + (a.personName || a.personId) + '：' + reason
    };
  };

  context.assignments.forEach(function (a) {
    if (!a.personId) return;
    const post = postById[a.postId];

    const pool = context.eligibility.byPost[a.postId] || [];
    if (pool.indexOf(a.personId) === -1) {
      notEligible.push(mk(a, RULE_IDS.ELIGIBILITY, '不在 Eligibility 名單內'));
    }

    if (post) {
      // 第十七輪批次階段 D1：訊息由 Roles.gs 嘅共用函式產生，同生成器、
      // 步驟 3／5 重跑檢查、fine-tune 提案四處一模一樣。
      const required = requiredRolesOfPost_(post);
      if (required.length > 0
          && !personHasAnyRoleOn_(roles, a.personId, required, a.serviceDate)) {
        roleViolations.push(mk(a, RULE_IDS.ROLE_REQUIRED,
          buildRoleRequiredReason_(post, required, a.serviceDate)));
      }
      const exclusion = findActivePersonPostExclusion_(
        exclusions, a.personId, a.postId, a.serviceDate);
      if (exclusion) {
        exclusionViolations.push(mk(a, RULE_IDS.PERSON_POST_EXCLUDED,
          buildPersonPostExcludedReason_(post, exclusion)));
      }
    }
    if (isPersonUnavailable_(a.personId, a.serviceDate, a.postId, context.unavailable)) {
      unavailableHits.push(mk(a, RULE_IDS.UNAVAILABLE, '該日已表明不能服侍'));
    }
    if (post && post.frequency === POST_FREQUENCY.FIRST_SUNDAY) {
      const info = dateInfo[a.serviceDate];
      if (info && !info.isFirstSundayOfMonth) {
        notFirstSunday.push(mk(a, RULE_IDS.COMMUNION_FIRST_SUNDAY, '出現在非每月第一主日'));
      }
    }
    if (post && !post.autoGenerate) {
      autoGenerateHits.push(mk(a, RULE_IDS.NO_AUTO_GENERATE, 'AutoGenerate=FALSE 的崗位卻被派人'));
    }
  });

  const duplicates = [];
  const map = buildPostWeekMap_(context.assignments);
  context.posts.forEach(function (post) {
    if (!post.distinctWithinPost) return;
    const byDate = map[post.postId] || {};
    Object.keys(byDate).forEach(function (dateStr) {
      const people = byDate[dateStr];
      const seen = {};
      people.forEach(function (personId) {
        if (seen[personId]) {
          duplicates.push({
            serviceDate: dateStr,
            postId: post.postId,
            // 同週重複係「呢個崗位喺呢一日有兩個人」，唔屬於單一 slot，
            // slotIndex 留空；分類 key 一樣拼得出，唔會同其他項目撞。
            slotIndex: '',
            personId: personId,
            personName: '',
            ruleId: RULE_IDS.DISTINCT_SLOT,
            reason: '同週重複派了 ' + personId,
            text: dateStr + ' ' + post.postId + '：同週重複派了 ' + personId
          });
        }
        seen[personId] = true;
      });
    });
  });

  const groups = [
    { label: '不在 Eligibility 名單內', items: notEligible },
    { label: '違反 Unavailable', items: unavailableHits },
    { label: '同週 DistinctWithinPost 重複', items: duplicates },
    { label: '第一主日限定崗位出現在其他週', items: notFirstSunday },
    { label: 'AutoGenerate=FALSE 崗位被派人', items: autoGenerateHits },
    { label: '違反身分限制（規則 1／2：報告限堂委、當值堂委限堂委或執事）', items: roleViolations },
    { label: '違反個人崗位限制（規則 3）', items: exclusionViolations }
  ];
  const total = groups.reduce(function (sum, g) { return sum + g.items.length; }, 0);
  // `all` 係全部項目攤平——分類函式要一次過睇晒，唔應該逐 group 各自分類
  // （逐 group 分類嘅話，同一項可能喺唔同 group 得到唔同分類）。
  const all = groups.reduce(function (acc, g) { return acc.concat(g.items); }, []);
  return { groups: groups, total: total, all: all };
}

/**
 * 把核對報告寫入 Verify_{quarterId}_v{versionNo} 工作表；同名工作表會被重建。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} report buildVerifyReport_() 的結果
 * @returns {string} 工作表名稱
 */
function writeVerifySheet_(quarterId, versionNo, report) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = SHEET_PREFIXES.VERIFY + quarterId + '_v' + versionNo;

  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const header = ['項目', '實際值', '目標／歷史基準'];
  const values = [header].concat(report.rows.map(function (r) {
    return [r.label, r.actual, r.target];
  }));
  sheet.getRange(1, 1, values.length, 3).setValues(values);

  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  const backgrounds = report.rows.map(function (r) {
    if (r.kind === 'section') {
      return [GRID_COLORS.STATS_HEADER, GRID_COLORS.STATS_HEADER, GRID_COLORS.STATS_HEADER];
    }
    if (r.deviates) return [GRID_COLORS.WARNING, GRID_COLORS.WARNING, GRID_COLORS.WARNING];
    return [null, null, null];
  });
  if (backgrounds.length > 0) {
    sheet.getRange(2, 1, backgrounds.length, 3).setBackgrounds(backgrounds);
  }

  report.rows.forEach(function (r, i) {
    if (r.kind === 'section') sheet.getRange(i + 2, 1).setFontWeight('bold');
  });

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 3);
  return sheetName;
}

/**
 * 建立一列區段標題。
 * @param {string} label 區段名稱
 * @returns {{kind: string, label: string, actual: string, target: string, deviates: boolean}} 報告列
 */
function makeSectionRow_(label) {
  return { kind: 'section', label: label, actual: '', target: '', deviates: false };
}

/**
 * 建立一列一般項目。
 * @param {string} label 項目名稱
 * @param {string} actual 實際值
 * @param {string} target 目標或歷史基準
 * @param {boolean} deviates 是否偏離目標
 * @returns {{kind: string, label: string, actual: string, target: string, deviates: boolean}} 報告列
 */
function makeItemRow_(label, actual, target, deviates) {
  return { kind: 'item', label: label, actual: actual, target: target, deviates: deviates };
}

/**
 * 把 0 至 1 的比例格式化為百分比字串。
 * @param {number} ratio 比例值
 * @returns {string} 例如 "63.2%"
 */
function formatPercent_(ratio) {
  if (ratio === null || ratio === undefined || isNaN(ratio)) return '-';
  return (ratio * 100).toFixed(1) + '%';
}
