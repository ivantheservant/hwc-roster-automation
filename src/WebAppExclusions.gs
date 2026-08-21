/**
 * 第二十七輪批次階段 D：區三畫面八——暫時不做某崗位。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.5 節。表：`PersonPostExclusions`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 同「崗位資格」嘅分別（呢一句要出現喺畫面上）
 * ─────────────────────────────────────────────────────────────────────
 *
 *   崗位資格 ＝ 這個人從來沒做過這個崗位。
 *   暫時不做 ＝ 這個人做得到，但這一段時間不排他。
 *
 * 兩件事一定要分得開。混埋一齊嘅後果：幹事想「呢半年唔好排佢做主席」，
 * 就去取消佢主席嘅資格——而嗰個係「以後永遠唔會排佢」，
 * 而且日後想恢復嗰陣，「佢做過幾多次」呢個歷史已經斷咗。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 解除限制 ＝ 填 `EffectiveTo`
 * ─────────────────────────────────────────────────────────────────────
 *
 * **唔係刪行，亦唔係設 `Active=FALSE`。**
 *
 * 點解唔可以設 `Active=FALSE`：`Active=FALSE` 嘅意思係「呢一行由頭到尾
 * 都唔算數」。噉樣舊季度嘅職事表就會變成「當時本來可以排佢」——
 * 而事實上當時係真係唔應該排佢。填 `EffectiveTo` 先至係
 * 「嗰段時間確實生效過，由今日起唔再生效」。
 *
 * 同 `Roles` 換屆完全一樣嘅道理（見 WebAppRoles.gs 檔頭）。
 */

/**
 * 列出個人崗位排除。生效中同已解除分開兩節。
 * @param {string=} keyword 姓名／編號搜尋
 * @returns {Object}
 */
function apiListExclusions(keyword) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const X = COLUMNS.PERSON_POST_EXCLUSIONS;
    const M = COLUMNS.NAME_MAPPING;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

    let raw = [];
    let sheetExists = true;
    try {
      raw = readOptionalSheet_(SHEETS.PERSON_POST_EXCLUSIONS);
    } catch (err) {
      sheetExists = false;
      log_('INFO', 'PersonPostExclusions 工作表未建立：' + err.message);
    }

    const nameIndex = buildPersonNameIndex_();
    const postNames = {};
    const posts = [];
    readPosts().forEach(function (row) {
      const postId = String(row[COLUMNS.POSTS.POST_ID] || '').trim();
      if (!postId) return;
      const nameTC = String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim() || postId;
      postNames[postId] = nameTC;
      posts.push({ postId: postId, postNameTC: nameTC });
    });

    const people = [];
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const id = String(row[M.PERSON_ID] || '').trim();
      if (!id) return;
      if (!isTrueValue_(row[M.ACTIVE])) return;
      people.push({ personId: id, nameTC: String(row[M.NAME_TC] || '').trim() || id });
    });
    people.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });

    const current = [];
    const lifted = [];
    raw.forEach(function (row) {
      const personId = String(row[X.PERSON_ID] || '').trim();
      const postId = String(row[X.POST_ID] || '').trim();
      if (!personId || !postId) return;
      const nameTC = nameIndex[personId] || personId;
      if (!matchesPeopleSearch_(keyword, [nameTC, personId, postNames[postId] || postId])) return;

      const to = toDateString(row[X.EFFECTIVE_TO], timezone);
      const item = {
        exclusionId: String(row[X.EXCLUSION_ID] || '').trim(),
        personId: personId,
        nameTC: nameTC,
        postId: postId,
        // 崗位表冇呢個 postId ⇒ **標出嚟**，唔可以只顯示個代號當冇事：
        // 打錯 PostID 嘅話，呢條限制根本唔會生效，而畫面睇落完全正常。
        postNameTC: postNames[postId] || postId,
        unknownPost: !postNames[postId],
        reason: String(row[X.REASON] || '').trim(),
        effectiveFrom: toDateString(row[X.EFFECTIVE_FROM], timezone),
        effectiveTo: to,
        active: isTrueValue_(row[X.ACTIVE]),
        notes: String(row[X.NOTES] || '').trim()
      };
      // 已解除 ＝ EffectiveTo 早過今日。**唔係**「Active=FALSE」——
      // 見檔頭：兩者對舊季度嘅意思完全唔同。
      if (to && to < today) lifted.push(item);
      else current.push(item);
    });

    const byName = function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; };
    current.sort(byName);
    lifted.sort(byName);

    return {
      ok: true,
      sheetExists: sheetExists,
      today: today,
      current: current,
      lifted: lifted,
      people: people,
      posts: posts
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 共用：驗一行排除嘅輸入。
 * @param {Object} p {personId, postId, reason, effectiveFrom, effectiveTo}
 * @param {string} timezone
 * @returns {{ok: boolean, message: string, values: Object}}
 */
function validateExclusionInput_(p, timezone) {
  const bad = function (what, actions) {
    return { ok: false, message: buildThreePartMessage_(what, '什麼都沒有改動。', actions), values: {} };
  };

  const personId = String(p.personId || '').trim();
  if (!personId) return bad('沒有選人。', ['在上面的下拉選一位']);

  const postId = String(p.postId || '').trim();
  if (!postId) return bad('沒有選崗位。', ['在上面的下拉選一個崗位']);

  // ⚠️ 原因**必填**。三個月之後，一條沒有原因的限制沒有人記得為什麼，
  // 於是沒有人夠膽解除它——那個人就永遠不會再被排到那個崗位。
  const reason = String(p.reason || '').trim();
  if (!reason) {
    return bad('沒有填原因。',
      ['寫一句就夠，例如「膝傷，暫時不能站」或者「本人要求，2026-08 面談」',
        '三個月之後，沒有原因的限制沒有人記得為什麼，也就沒有人夠膽解除它']);
  }

  let from = '';
  if (String(p.effectiveFrom || '').trim() !== '') {
    const parsed = parseOfficerDateInput_(p.effectiveFrom, timezone);
    if (!parsed.ok) {
      return bad('生效日「' + (parsed.rawText || String(p.effectiveFrom)) + '」看不懂。',
        ['請用 2026-11-08 這種寫法（年-月-日）', '留空代表「即時生效」']);
    }
    from = parsed.dateStr;
  }

  let to = '';
  if (String(p.effectiveTo || '').trim() !== '') {
    const parsed = parseOfficerDateInput_(p.effectiveTo, timezone);
    if (!parsed.ok) {
      return bad('解除日「' + (parsed.rawText || String(p.effectiveTo)) + '」看不懂。',
        ['請用 2026-11-08 這種寫法（年-月-日）', '留空代表「仍然生效」']);
    }
    to = parsed.dateStr;
  }

  if (from && to && from > to) {
    return bad('生效日（' + from + '）比解除日（' + to + '）遲。',
      ['把兩個日期調轉', '如果還沒有解除，把解除日留空']);
  }

  return {
    ok: true,
    message: '',
    values: {
      personId: personId, postId: postId, reason: reason,
      effectiveFrom: from, effectiveTo: to
    }
  };
}

/** `ExclusionID` 用 `EXCL-<時間戳>-<序號>`。 */
function allocateExclusionId_(existingIds) {
  const base = 'EXCL-' + compactTimestamp_();
  let n = 1;
  while (existingIds[base + '-' + n]) n++;
  return base + '-' + n;
}

/** 讀出全部已用嘅 `ExclusionID`。 */
function readExistingExclusionIds_() {
  const X = COLUMNS.PERSON_POST_EXCLUSIONS;
  const ids = {};
  try {
    readOptionalSheet_(SHEETS.PERSON_POST_EXCLUSIONS).forEach(function (row) {
      const id = String(row[X.EXCLUSION_ID] || '').trim();
      if (id) ids[id] = true;
    });
  } catch (err) {
    log_('INFO', 'PersonPostExclusions 工作表未建立，視為沒有任何 ID：' + err.message);
  }
  return ids;
}

/**
 * 新增一條限制。**會寫入。**
 * @param {Object} payload {personId, postId, reason, effectiveFrom, effectiveTo, notes}
 * @returns {Object}
 */
function apiAddExclusion(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const X = COLUMNS.PERSON_POST_EXCLUSIONS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const check = validateExclusionInput_(p, timezone);
  if (!check.ok) return { ok: false, message: check.message };
  const v = check.values;

  const opened = openSheetForEdit_(SHEETS.PERSON_POST_EXCLUSIONS);
  const exclusionId = allocateExclusionId_(readExistingExclusionIds_());

  const record = {};
  record[X.EXCLUSION_ID] = exclusionId;
  record[X.PERSON_ID] = v.personId;
  record[X.POST_ID] = v.postId;
  record[X.REASON] = v.reason;
  record[X.EFFECTIVE_FROM] = v.effectiveFrom;
  record[X.EFFECTIVE_TO] = v.effectiveTo;
  record[X.ACTIVE] = true;
  record[X.NOTES] = String(p.notes || '').trim();

  appendRowFields_(opened.sheet, opened.headers, record);
  const nameIndex = buildPersonNameIndex_();
  writeZone3Audit_({
    action: 'EXCLUSION_ADD',
    targetSheet: SHEETS.PERSON_POST_EXCLUSIONS,
    targetKey: exclusionId,
    oldValue: '（新增）',
    newValue: describeFields_(record,
      [X.PERSON_ID, X.POST_ID, X.REASON, X.EFFECTIVE_FROM, X.EFFECTIVE_TO, X.ACTIVE]),
    notes: (nameIndex[v.personId] || v.personId) + '　' + v.postId
  });

  return { ok: true, exclusionId: exclusionId, nameTC: nameIndex[v.personId] || v.personId };
}

/**
 * 改一條限制。**會寫入。**
 * @param {Object} payload {exclusionId, personId, postId, reason, effectiveFrom, effectiveTo, active, notes}
 * @returns {Object}
 */
function apiSaveExclusion(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const X = COLUMNS.PERSON_POST_EXCLUSIONS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const exclusionId = String(p.exclusionId || '').trim();
  if (!exclusionId) {
    return {
      ok: false,
      message: buildThreePartMessage_('沒有指定要改哪一條。', '什麼都沒有改動。',
        ['重新整理這一頁再試一次'])
    };
  }

  const check = validateExclusionInput_(p, timezone);
  if (!check.ok) return { ok: false, message: check.message };
  const v = check.values;

  const found = findRowById_(SHEETS.PERSON_POST_EXCLUSIONS, X.EXCLUSION_ID, exclusionId);
  if (found.sheetRow === -1) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '找不到要改的那一條（' + exclusionId + '）。',
        '什麼都沒有改動。',
        ['重新整理這一頁再試一次', '可能有人剛剛在試算表改動過這張工作表'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.PERSON_POST_EXCLUSIONS);
  const FIELDS = [X.PERSON_ID, X.POST_ID, X.REASON, X.EFFECTIVE_FROM, X.EFFECTIVE_TO, X.ACTIVE, X.NOTES];

  const newValues = {};
  newValues[X.PERSON_ID] = v.personId;
  newValues[X.POST_ID] = v.postId;
  newValues[X.REASON] = v.reason;
  newValues[X.EFFECTIVE_FROM] = v.effectiveFrom;
  newValues[X.EFFECTIVE_TO] = v.effectiveTo;
  newValues[X.ACTIVE] = p.active !== false;
  newValues[X.NOTES] = String(p.notes || '').trim();

  writeRowFields_(opened.sheet, opened.headers, found.sheetRow, newValues);
  writeZone3Audit_({
    action: 'EXCLUSION_UPDATE',
    targetSheet: SHEETS.PERSON_POST_EXCLUSIONS,
    targetKey: exclusionId,
    oldValue: describeFields_(found.record, FIELDS),
    newValue: describeFields_(newValues, FIELDS)
  });

  return { ok: true, exclusionId: exclusionId };
}

/**
 * 解除一條限制。**只填 `EffectiveTo`，唔掂任何其他欄。**
 *
 * ⚠️ 特登做成一個獨立 API 而唔係叫呼叫端用 `apiSaveExclusion()`：
 * 「解除」係一個有明確語意嘅動作，做成獨立入口就可以
 *   ・喺 `AuditLog` 記成 `EXCLUSION_LIFT`（日後一句 filter 就查得晒）
 *   ・**結構上**保證佢唔會順手改到 `Active` 或者原因
 * 而唔係靠呼叫端記得「解除嗰陣唔好改其他嘢」。
 *
 * @param {string} exclusionId
 * @param {string} liftDateRaw 解除日（預設今日）
 * @returns {Object}
 */
function apiLiftExclusion(exclusionId, liftDateRaw) {
  assertWebAppRequestAllowed_();
  const X = COLUMNS.PERSON_POST_EXCLUSIONS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const id = String(exclusionId || '').trim();
  if (!id) {
    return {
      ok: false,
      message: buildThreePartMessage_('沒有指定要解除哪一條。', '什麼都沒有改動。',
        ['重新整理這一頁再試一次'])
    };
  }

  const parsed = parseOfficerDateInput_(liftDateRaw, timezone);
  if (!parsed.ok) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '解除日期「' + (parsed.rawText || String(liftDateRaw || '（空白）')) + '」看不懂。',
        '什麼都沒有改動。',
        ['請用 2026-11-08 這種寫法（年-月-日）',
          '這一日之後，這個人就可以再被排到那個崗位'])
    };
  }

  const found = findRowById_(SHEETS.PERSON_POST_EXCLUSIONS, X.EXCLUSION_ID, id);
  if (found.sheetRow === -1) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '找不到要解除的那一條（' + id + '）。', '什麼都沒有改動。',
        ['重新整理這一頁再試一次'])
    };
  }

  const from = toDateString(found.record[X.EFFECTIVE_FROM], timezone);
  if (from && parsed.dateStr < from) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '解除日（' + parsed.dateStr + '）比生效日（' + from + '）還要早。',
        '什麼都沒有改動。',
        ['檢查解除日期有沒有打錯',
          '如果這一條根本不應該存在，請改用「修改」把「啟用」取消'
            + '——那個意思是「這一行由頭到尾都不算數」'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.PERSON_POST_EXCLUSIONS);
  const updates = {};
  updates[X.EFFECTIVE_TO] = parsed.dateStr;
  writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);

  const nameIndex = buildPersonNameIndex_();
  const personId = String(found.record[X.PERSON_ID] || '').trim();
  writeZone3Audit_({
    action: 'EXCLUSION_LIFT',
    targetSheet: SHEETS.PERSON_POST_EXCLUSIONS,
    targetKey: id,
    oldValue: X.EFFECTIVE_TO + '=' + displayCellValue_(found.record[X.EFFECTIVE_TO], '（空白，仍然生效）'),
    newValue: X.EFFECTIVE_TO + '=' + parsed.dateStr,
    notes: (nameIndex[personId] || personId) + '　'
      + String(found.record[X.POST_ID] || '') + '　解除限制'
  });

  return { ok: true, exclusionId: id, effectiveTo: parsed.dateStr };
}
