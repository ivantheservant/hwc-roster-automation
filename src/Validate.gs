/**
 * 檢查試算表資料完整性，回傳發現的問題清單並寫入 Logger。
 * 檢查項目：Eligibility 孤兒 ID、NameAlias 重複、NameMapping 姓名重複、
 * Posts 的 SlotCount 有效性、ServiceDates 引用的 SpecialID 是否存在、必填 Config 是否缺失、
 * EmailRecipients 有沒有未填的佔位文字（例如「（請填入 CC list 電郵）」）。
 * @returns {string[]} 問題描述陣列；沒有問題時回傳空陣列
 */
function validateSetup() {
  // 「檢查設定」的意義就是核對目前試算表的真實狀態，不應該讀到過期的 Config 快取
  reloadConfigCache();

  let issues = [];
  issues = issues.concat(validateEligibilityOrphans_());
  issues = issues.concat(validateNameAliasDuplicates_());
  issues = issues.concat(validateNameMappingDuplicates_());
  issues = issues.concat(validatePostsSlotCount_());
  issues = issues.concat(validateServiceDatesSpecialId_());
  issues = issues.concat(validateRequiredConfig_());
  issues = issues.concat(validateEmailRecipientPlaceholders_());

  if (issues.length === 0) {
    log_('INFO', 'validateSetup: 沒有發現問題');
  } else {
    log_('WARN', 'validateSetup: 發現 ' + issues.length + ' 個問題');
    for (let i = 0; i < issues.length; i++) {
      log_('WARN', issues[i]);
    }
  }
  return issues;
}

/**
 * 檢查 Eligibility 的 PersonID / PostID 是否有孤兒（在主檔中找不到對應資料）。
 * @returns {string[]} 問題描述陣列
 */
function validateEligibilityOrphans_() {
  const issues = [];
  const eligibilityRows = readSheet(SHEETS.ELIGIBILITY);
  const people = readSheet(SHEETS.NAME_MAPPING);
  const posts = readSheet(SHEETS.POSTS);

  const personIds = {};
  for (let i = 0; i < people.length; i++) {
    personIds[people[i][COLUMNS.NAME_MAPPING.PERSON_ID]] = true;
  }
  const postIds = {};
  for (let j = 0; j < posts.length; j++) {
    postIds[posts[j][COLUMNS.POSTS.POST_ID]] = true;
  }

  for (let k = 0; k < eligibilityRows.length; k++) {
    const row = eligibilityRows[k];
    const eligibilityId = row[COLUMNS.ELIGIBILITY.ELIGIBILITY_ID];
    const personId = row[COLUMNS.ELIGIBILITY.PERSON_ID];
    const postId = row[COLUMNS.ELIGIBILITY.POST_ID];
    if (personId && !personIds[personId]) {
      issues.push('Eligibility [' + eligibilityId + ']: PersonID "' + personId + '" 在 NameMapping 中不存在');
    }
    if (postId && !postIds[postId]) {
      issues.push('Eligibility [' + eligibilityId + ']: PostID "' + postId + '" 在 Posts 中不存在');
    }
  }
  return issues;
}

/**
 * 檢查 NameAlias 的 Alias 是否重複出現。
 * @returns {string[]} 問題描述陣列
 */
function validateNameAliasDuplicates_() {
  const issues = [];
  const rows = readSheet(SHEETS.NAME_ALIAS);
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const alias = rows[i][COLUMNS.NAME_ALIAS.ALIAS];
    if (!alias) continue;
    if (seen[alias]) {
      issues.push('NameAlias: Alias "' + alias + '" 重複出現');
    }
    seen[alias] = true;
  }
  return issues;
}

/**
 * 檢查 NameMapping 的 NameTC（正名）是否重複出現。
 * @returns {string[]} 問題描述陣列
 */
function validateNameMappingDuplicates_() {
  const issues = [];
  const rows = readSheet(SHEETS.NAME_MAPPING);
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i][COLUMNS.NAME_MAPPING.NAME_TC];
    if (!name) continue;
    if (seen[name]) {
      issues.push('NameMapping: NameTC "' + name + '" 重複出現');
    }
    seen[name] = true;
  }
  return issues;
}

/**
 * 檢查 Posts 的 SlotCount 是否為有效值（必須 >= 1）。
 * @returns {string[]} 問題描述陣列
 */
function validatePostsSlotCount_() {
  const issues = [];
  const rows = readSheet(SHEETS.POSTS);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const slotCount = Number(row[COLUMNS.POSTS.SLOT_COUNT]);
    if (isNaN(slotCount) || slotCount < 1) {
      issues.push('Posts: PostID "' + row[COLUMNS.POSTS.POST_ID] + '" 的 SlotCount 無效 (' + row[COLUMNS.POSTS.SLOT_COUNT] + ')');
    }
  }
  return issues;
}

/**
 * 檢查 ServiceDates 引用的 SpecialID 是否存在於 SpecialSundays。
 * @returns {string[]} 問題描述陣列
 */
function validateServiceDatesSpecialId_() {
  const issues = [];
  const serviceDates = readSheet(SHEETS.SERVICE_DATES);
  const specialSundays = readSheet(SHEETS.SPECIAL_SUNDAYS);

  const specialIds = {};
  for (let i = 0; i < specialSundays.length; i++) {
    specialIds[specialSundays[i][COLUMNS.SPECIAL_SUNDAYS.SPECIAL_ID]] = true;
  }

  for (let j = 0; j < serviceDates.length; j++) {
    const row = serviceDates[j];
    const specialId = row[COLUMNS.SERVICE_DATES.SPECIAL_ID];
    if (specialId && !specialIds[specialId]) {
      issues.push('ServiceDates [' + row[COLUMNS.SERVICE_DATES.SERVICE_DATE_ID] + ']: SpecialID "' + specialId + '" 在 SpecialSundays 中不存在');
    }
  }
  return issues;
}

/**
 * 檢查必填 Config Key（見 getRequiredConfigKeys()）是否缺失或未設值。
 * @returns {string[]} 問題描述陣列
 */
function validateRequiredConfig_() {
  const issues = [];
  const config = readConfig();
  const requiredKeys = getRequiredConfigKeys();
  for (let i = 0; i < requiredKeys.length; i++) {
    const key = requiredKeys[i];
    const value = config[key];
    if (value === undefined || value === null || value === '') {
      issues.push('Config: 必填的 "' + key + '" 缺失或未設值');
    }
  }
  return issues;
}

/**
 * 檢查 EmailRecipients 的 Email／DisplayName 欄有沒有留著未填的佔位文字
 * （例如「（請填入 CC list 電郵）」）。只回報，不會自動填入實際值——
 * 那必須由人手決定填什麼。
 * @returns {string[]} 問題描述陣列
 */
function validateEmailRecipientPlaceholders_() {
  const issues = [];
  const rows = readSheet(SHEETS.EMAIL_RECIPIENTS);
  const C = COLUMNS.EMAIL_RECIPIENTS;
  const checkColumns = [C.EMAIL, C.DISPLAY_NAME];

  rows.forEach(function (row) {
    checkColumns.forEach(function (column) {
      const value = String(row[column] || '');
      if (isPlaceholderText_(value)) {
        issues.push('EmailRecipients: ' + (row[C.RECIPIENT_ID] || '(無 RecipientID)')
          + ' 的 "' + column + '" 欄仍是未填的佔位文字：「' + value + '」');
      }
    });
  });
  return issues;
}

/**
 * 判斷一段文字是不是未填的佔位提示（含「請填入」字樣）。
 * @param {string} value 儲存格文字
 * @returns {boolean} 是否為佔位文字
 */
function isPlaceholderText_(value) {
  return value.indexOf(PLACEHOLDER_MARKER) !== -1;
}
