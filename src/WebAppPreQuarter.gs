/**
 * 第二十三輪批次階段 F：區二「開季前準備」嘅未做完項數。
 *
 * 對應 `docs/幹事介面規格.md` 第三節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 「未做完 N 項」係項數，唔係格數
 * ─────────────────────────────────────────────────────────────────────
 *
 * N ＝ 五項之中 `count > 0` 嘅**項數**。每項各自回傳自己嘅 count，
 * 由前端決定點顯示。噉樣「還有 3 項未做」呢個數字先至穩定——
 * 如果用格數，講員未填 12 週就會顯示「還有 12 項未做」，
 * 幹事會以為有十二件唔同嘅事要做。
 *
 * ⚠️ 五項全部**唔阻擋任何一粒掣**（規格 3.1 表格最右一欄），
 * 只喺掣 2 完成畫面提一句。呢啲係「表會有空格」嘅提醒，
 * 唔係「唔准出表」——出唔出係幹事嘅決定。
 *
 * 名單檢查（3.4 節四條提示）**唔計入 N**——佢哋跟人唔跟季，
 * 混入季度性嘅「開季前準備」會令 N 永遠清唔到零。
 */

/**
 * 判斷一行 `SpecialSundays` 係咪合堂類。
 *
 * 合堂喺本專案冇獨立嘅 Type 代碼（第十六輪決定唔分開處理，見
 * `AnnualCombined.gs` 檔頭 D4），一律靠 `Type`／`Title` 含「合堂」兩個字辨認。
 * @param {Object} row SpecialSundays 一行
 * @returns {boolean}
 */
function isCombinedServiceRow_(row) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const text = String(row[S.TYPE] || '') + '　' + String(row[S.TITLE] || '');
  return text.indexOf('合堂') !== -1;
}

/**
 * 區二五項各自嘅 count。**純計算，唔碰任何 Google API**，方便離線測試。
 *
 * @param {Object} input 已經讀好嘅資料
 * @param {Object[]} input.specialRows 本季 `SpecialSundays` 嘅列（呼叫端已篩季度）
 * @param {Object[]} input.serviceDates 本季主日 `{serviceDate, translationRequired}`
 * @param {Object.<string, boolean>} input.filledByDatePost `日期|崗位` ⇒ 有冇填咗人
 * @param {?string} input.preacherPostId 講員崗位 ID（搵唔到傳 null）
 * @param {?string} input.translationPostId 翻譯崗位 ID
 * @param {?string} input.flowerPostId 獻花崗位 ID
 * @returns {{undoneItemCount: number, items: Object[]}}
 */
function planPreQuarterChecklist_(input) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const specialRows = input.specialRows || [];
  const serviceDates = input.serviceDates || [];
  const filled = input.filledByDatePost || {};

  // 只計 Active=TRUE 嘅列——Active=FALSE 代表幹事已經決定唔用呢一列
  // （例如今年冇堂慶），冇必要再叫佢去確認一個唔會用嘅日期。
  const activeSpecials = specialRows.filter(function (row) {
    return isTrueValue_(row[S.ACTIVE]);
  });

  // ⚠️ **方向唔可以搞反。** `Confirmed` 空白＝已確認，只有明確 FALSE 先算未確認。
  // 判斷入口只有 `isUnconfirmedSpecialSunday_()` 一個，唔喺呢度另外寫一次
  // `isTrueValue_` 判斷——搞錯方向會令全部既有列一開機就報「未確認」。
  const specialUnconfirmed = activeSpecials.filter(isUnconfirmedSpecialSunday_).length;

  const combinedNoSkip = activeSpecials.filter(function (row) {
    return isCombinedServiceRow_(row)
      && String(row[S.SKIP_POST_IDS] || '').trim() === '';
  }).length;

  const countEmptyWeeks = function (postId, onlyWhen) {
    if (!postId) return 0;   // 搵唔到呢個崗位 ⇒ 冇嘢可以未填
    return serviceDates.filter(function (d) {
      if (onlyWhen && !onlyWhen(d)) return false;
      return !filled[d.serviceDate + '|' + postId];
    }).length;
  };

  const items = [
    { id: 'specialUnconfirmed', label: '特別主日日期未確認', count: specialUnconfirmed },
    { id: 'combinedNoSkip', label: '合堂未指定跳過崗位', count: combinedNoSkip },
    { id: 'preacherEmpty', label: '講員未填', count: countEmptyWeeks(input.preacherPostId) },
    {
      id: 'translationEmpty',
      label: '翻譯未填',
      count: countEmptyWeeks(input.translationPostId, function (d) { return d.translationRequired === true; })
    },
    { id: 'flowerEmpty', label: '獻花未填', count: countEmptyWeeks(input.flowerPostId) }
  ];

  return {
    // N ＝ count > 0 嘅**項數**，唔係全部 count 加埋。
    undoneItemCount: items.filter(function (i) { return i.count > 0; }).length,
    items: items
  };
}

/**
 * 規格 3.4：名單檢查嘅四條唯讀提示。**唔計入 N。**
 *
 * @param {Object} input 已經讀好嘅資料
 * @param {Object[]} input.assignments 最新版本嘅派工（`{personId}`）
 * @param {Object.<string, Object>} input.peopleById `NameMapping` 索引
 * @param {Object[]} input.roleRows `Roles` 全部列
 * @param {string} input.quarterStartDate 本季開始日 `yyyy-MM-dd`
 * @param {Object.<string, number>} input.eligibleCountByPost 逐崗位合資格人數
 * @returns {Object[]} 每項 `{id, label, count}`
 */
function planPreQuarterPeopleHints_(input) {
  const assignments = input.assignments || [];
  const peopleById = input.peopleById || {};
  const usedIds = {};
  assignments.forEach(function (a) {
    if (a.personId) usedIds[a.personId] = true;
  });
  const usedIdList = Object.keys(usedIds);

  const noEmail = usedIdList.filter(function (id) {
    const p = peopleById[id];
    return !!p && !String(p.email || '').trim();
  }).length;

  const notInNameList = usedIdList.filter(function (id) { return !peopleById[id]; }).length;

  // 第二十六輪批次階段 D3：電郵格式睇落唔對。
  //
  // ⚠️ 呢個同「冇電郵」係兩件唔同嘅事：冇電郵嘅人，系統知道佢收唔到；
  // **格式錯嘅人，系統以為佢收到**——寄出去會靜靜失敗，
  // 而 SendLog 只會記一個技術錯誤，冇人會覺得有問題。
  const badEmailPeople = usedIdList.filter(function (id) {
    const p = peopleById[id];
    const email = p ? String(p.email || '').trim() : '';
    return email !== '' && !isPlausibleEmail_(email);
  }).map(function (id) {
    return { personId: id, nameTC: (peopleById[id] || {}).nameTC || id };
  });

  const R = COLUMNS.ROLES;
  const expiredRoles = (input.roleRows || []).filter(function (row) {
    if (!isTrueValue_(row[R.ACTIVE])) return false;
    const personId = String(row[R.PERSON_ID] || '').trim();
    if (!usedIds[personId]) return false;   // 唔喺表上就唔關本季事
    const to = String(row[R.EFFECTIVE_TO] || '').trim();
    return to !== '' && to < input.quarterStartDate;
  }).length;

  const thinPosts = Object.keys(input.eligibleCountByPost || {}).filter(function (postId) {
    return input.eligibleCountByPost[postId] < 3;
  }).length;

  return [
    { id: 'noEmail', label: '表上有人沒有電郵，正式發出時會略過', count: noEmail },
    {
      id: 'badEmailFormat',
      label: '有人的電郵格式看起來不對',
      count: badEmailPeople.length,
      // 逐個列出——只講數字嘅話，幹事要自己喺 89 個人入面搵。
      people: badEmailPeople
    },
    { id: 'notInNameList', label: '表上有名字不在人員名單', count: notInNameList },
    { id: 'expiredRole', label: '有人的堂委／執事身分已過期', count: expiredRoles },
    { id: 'thinEligibility', label: '有崗位的合資格人數少於 3 人', count: thinPosts }
  ];
}

/**
 * 讀試算表，組出 `planPreQuarterChecklist_()`／`planPreQuarterPeopleHints_()`
 * 需要嘅輸入。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function buildPreQuarterChecklistInputs_(quarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const S = COLUMNS.SPECIAL_SUNDAYS;

  const specialRows = readOptionalSheetRows_(SHEETS.SPECIAL_SUNDAYS).filter(function (row) {
    return String(row[S.QUARTER_ID] || '').trim() === quarterId;
  });

  // ⚠️ `TranslationRequired` 喺 `SpecialSundays`，**唔喺 `ServiceDates`**
  // （`readServiceDatesNormalized()` 完全冇呢一欄）。要靠日期夾埋兩張表。
  // 冇對應特別主日嗰啲主日 ⇒ 唔需要翻譯。
  const translationRequiredByDate = {};
  specialRows.forEach(function (row) {
    if (!isTrueValue_(row[S.ACTIVE])) return;
    const d = toDateString(row[S.SERVICE_DATE], timezone);
    if (d && isTrueValue_(row[S.TRANSLATION_REQUIRED])) translationRequiredByDate[d] = true;
  });

  const serviceDates = readServiceDatesNormalized(quarterId, timezone).map(function (d) {
    return {
      serviceDate: d.serviceDate,
      translationRequired: translationRequiredByDate[d.serviceDate] === true
    };
  });

  const postIds = findPreacherTranslationPostIds_();

  // 「有冇填咗人」一律睇最新版本嘅 `RosterAssignments`（資料層），
  // **唔可以讀 grid 顯示文字反推**——第二十輪就係踩過呢個坑
  // （合堂嘅「特殊主日」placeholder 被當成人名）。
  const versionNo = findLatestVersionNo(quarterId);
  const filledByDatePost = {};
  if (versionNo >= 0) {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      if (!String(row[A.PERSON_ID] || '').trim()
        && !String(row[A.PERSON_NAME_SNAPSHOT] || '').trim()) return;
      filledByDatePost[toDateString(row[A.SERVICE_DATE], timezone) + '|' + row[A.POST_ID]] = true;
    });
  }

  return {
    specialRows: specialRows,
    serviceDates: serviceDates,
    filledByDatePost: filledByDatePost,
    preacherPostId: postIds.preacherPostId,
    translationPostId: postIds.translationPostId,
    flowerPostId: postIds.flowerPostId,
    versionNo: versionNo,
    timezone: timezone
  };
}

/**
 * 供前端呼叫：區二「開季前準備」嘅五項 count ＋ 四條名單提示。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {{undoneItemCount: number, items: Object[], peopleHints: Object[]}}
 */
function apiGetPreQuarterChecklist(quarterId) {
  assertWebAppRequestAllowed_();

  const inputs = buildPreQuarterChecklistInputs_(quarterId);
  const checklist = planPreQuarterChecklist_(inputs);

  let peopleHints = [];
  try {
    peopleHints = planPreQuarterPeopleHints_(buildPreQuarterPeopleHintInputs_(quarterId, inputs));
  } catch (err) {
    // 名單提示唔計入 N，讀失敗唔應該令成個區二冧——但一定要留低痕跡，
    // 唔可以靜靜當成「四項都係 0」（噉樣畫面會顯示「名單全部冇問題」，
    // 就係把「讀唔到」當成「冇事」嗰個 bug class）。
    log_('WARN', 'planPreQuarterPeopleHints_ 失敗，區二名單提示以「無法檢查」顯示：' + err.message);
    peopleHints = [{ id: 'unavailable', label: '名單檢查暫時無法執行（' + err.message + '）', count: -1 }];
  }

  return {
    undoneItemCount: checklist.undoneItemCount,
    items: checklist.items,
    peopleHints: peopleHints
  };
}

/**
 * 組出名單提示需要嘅輸入。分開一個函式係為咗令上面嘅 try/catch 範圍夠窄，
 * 唔會意外吞埋 checklist 本身嘅錯誤。
 * @param {string} quarterId 季度 ID
 * @param {Object} baseInputs `buildPreQuarterChecklistInputs_()` 嘅結果
 * @returns {Object}
 */
function buildPreQuarterPeopleHintInputs_(quarterId, baseInputs) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const assignments = baseInputs.versionNo < 0 ? [] : readSheet(SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return String(row[A.QUARTER_ID] || '').trim() === quarterId
        && Number(row[A.VERSION_NO]) === baseInputs.versionNo;
    })
    .map(function (row) { return { personId: String(row[A.PERSON_ID] || '').trim() }; });

  const peopleById = indexPeopleById_();

  const quarterRow = findQuarter_(quarterId);
  const quarterStartDate = quarterRow
    ? toDateString(quarterRow[COLUMNS.QUARTERS.START_DATE], baseInputs.timezone) : '';

  const eligibility = readEligibility();
  const eligibleCountByPost = {};
  Object.keys(eligibility.byPost || {}).forEach(function (postId) {
    eligibleCountByPost[postId] = (eligibility.byPost[postId] || []).length;
  });

  return {
    assignments: assignments,
    peopleById: peopleById,
    roleRows: readOptionalSheetRows_(SHEETS.ROLES),
    quarterStartDate: quarterStartDate,
    eligibleCountByPost: eligibleCountByPost
  };
}
