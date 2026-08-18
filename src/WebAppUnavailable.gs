/**
 * 第二十五輪批次階段 E1：區三畫面一——不能服侍的日期（`Unavailable`）。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.1 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解呢個排第一
 * ─────────────────────────────────────────────────────────────────────
 *
 * 幹事最常用嘅一個——會友成日會講「我十一月唔喺度」。
 * 呢件事一日未入到系統，排表就會照樣派佢，然後要人手補鑊。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 三個容易做錯嘅位
 * ─────────────────────────────────────────────────────────────────────
 *
 * 1. **系統冇「上半場唔喺度」呢個概念。** 填咗就係成日唔能夠服侍。
 *    呢句要寫喺畫面上——唔講嘅話幹事會以為填咗個時間就得。
 * 2. **加一筆唔會自動改現有版本。** 如果嗰個人已經被排咗入去，
 *    要撳「儲存並確認」系統先會重新檢查。畫面要用紅字講明，
 *    否則幹事會以為加完就搞掂。
 * 3. **過期嘅行唔可以刪。** 摺埋就得——刪咗就冇咗紀錄，
 *    下次有人問「佢舊年幾時唔喺度」就查唔到。
 */

/**
 * 列出一個季度相關嘅不能服侍紀錄。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @param {string=} keyword 搜尋字（中文名／英文名／PersonID）
 * @returns {Object} 見規格 4.1
 */
function apiListUnavailable(quarterId, keyword) {
  assertWebAppRequestAllowed_();

  beginSheetReadMemo_();
  try {
    const U = COLUMNS.UNAVAILABLE;
    const M = COLUMNS.NAME_MAPPING;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

    const peopleById = {};
    const people = [];
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const id = String(row[M.PERSON_ID] || '').trim();
      if (!id) return;
      const entry = {
        personId: id,
        nameTC: String(row[M.NAME_TC] || '').trim(),
        nameEN: String(row[M.NAME_EN] || '').trim(),
        active: isTrueValue_(row[M.ACTIVE])
      };
      peopleById[id] = entry;
      people.push(entry);
    });

    const current = [];
    const past = [];
    readSheet(SHEETS.UNAVAILABLE).forEach(function (row) {
      const personId = String(row[U.PERSON_ID] || '').trim();
      if (!personId) return;
      const person = peopleById[personId];
      if (!matchesPeopleSearch_(keyword,
        [person ? person.nameTC : '', person ? person.nameEN : '', personId])) return;

      const dateTo = toDateString(row[U.DATE_TO], timezone);
      const item = {
        unavailableId: String(row[U.UNAVAILABLE_ID] || '').trim(),
        personId: personId,
        // 名單上冇呢個人（例如已經改咗 PersonID）唔可以顯示做空白——
        // 空白會令幹事以為呢一行壞咗而想刪。
        personName: person ? person.nameTC : '（名單上找不到 ' + personId + '）',
        dateFrom: toDateString(row[U.DATE_FROM], timezone),
        dateTo: dateTo,
        appliesTo: String(row[U.APPLIES_TO] || UNAVAILABLE_VALUES.APPLIES_TO_ALL).trim(),
        postIds: splitList_(row[U.POST_IDS]),
        reason: String(row[U.REASON] || '').trim(),
        source: String(row[U.SOURCE] || '').trim(),
        status: String(row[U.STATUS] || '').trim()
      };
      // 過去嘅摺埋，**唔刪**——刪咗就冇咗紀錄。
      if (dateTo && dateTo < today) past.push(item);
      else current.push(item);
    });

    const sortByDate = function (a, b) {
      return a.dateFrom < b.dateFrom ? -1 : (a.dateFrom > b.dateFrom ? 1 : 0);
    };
    current.sort(sortByDate);
    past.sort(function (a, b) { return sortByDate(b, a); });   // 最近嘅過期擺前

    return {
      quarterId: quarterId,
      today: today,
      people: people.filter(function (p) { return p.active; })
        .sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; }),
      posts: readPosts().map(function (row) {
        return {
          postId: row[COLUMNS.POSTS.POST_ID],
          postNameTC: row[COLUMNS.POSTS.POST_NAME_TC]
        };
      }),
      current: current,
      past: past
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 加一筆之前先睇影響。**純讀取，零寫入。**
 *
 * 兩件事：
 *   1. 呢個日期範圍蓋住本季幾多個主日（有邊幾日）
 *   2. 呢個人喺嗰幾日有冇已經被排咗入現有版本
 *
 * 第二點特別重要——加完之後**現有版本唔會自己變**，要撳「儲存並確認」
 * 系統先會重新檢查。唔講嘅話幹事會以為加完就搞掂。
 *
 * @param {Object} payload {quarterId, personId, dateFrom, dateTo, appliesTo, postIds}
 * @returns {Object} 見規格 4.1
 */
function apiPreviewUnavailableImpact(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const from = parseUnavailableDate_(p.dateFrom, timezone, '開始日期');
  const to = parseUnavailableDate_(p.dateTo, timezone, '結束日期');
  if (from.error) return { ok: false, message: from.error };
  if (to.error) return { ok: false, message: to.error };
  if (from.dateStr > to.dateStr) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '開始日期（' + from.dateStr + '）比結束日期（' + to.dateStr + '）遲。',
        '什麼都沒有加入。',
        ['把兩個日期調轉', '如果只是一日不能服侍，兩格填同一日'])
    };
  }

  beginSheetReadMemo_();
  try {
    // 蓋住本季邊幾個主日
    let coveredDates = [];
    try {
      coveredDates = readServiceDatesNormalized(p.quarterId, timezone)
        .map(function (d) { return d.serviceDate; })
        .filter(function (d) { return d >= from.dateStr && d <= to.dateStr; });
    } catch (err) {
      log_('WARN', 'apiPreviewUnavailableImpact 讀不到本季主日：' + err.message);
    }

    // 呢個人喺嗰幾日已經被排咗啲乜
    const conflicts = [];
    const versionNo = findLatestVersionNo(p.quarterId);
    if (versionNo >= 0 && coveredDates.length > 0) {
      const A = COLUMNS.ROSTER_ASSIGNMENTS;
      const postNames = {};
      readPosts().forEach(function (row) {
        postNames[row[COLUMNS.POSTS.POST_ID]] = row[COLUMNS.POSTS.POST_NAME_TC];
      });
      const wantedPostIds = String(p.appliesTo || UNAVAILABLE_VALUES.APPLIES_TO_ALL)
        === UNAVAILABLE_VALUES.APPLIES_TO_ALL ? null : (p.postIds || []);

      readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
        if (String(row[A.QUARTER_ID] || '').trim() !== p.quarterId) return;
        if (Number(row[A.VERSION_NO]) !== versionNo) return;
        if (String(row[A.PERSON_ID] || '').trim() !== String(p.personId || '').trim()) return;
        const d = toDateString(row[A.SERVICE_DATE], timezone);
        if (coveredDates.indexOf(d) === -1) return;
        const postId = String(row[A.POST_ID] || '').trim();
        if (wantedPostIds && wantedPostIds.indexOf(postId) === -1) return;
        conflicts.push({
          serviceDate: d,
          postId: postId,
          postNameTC: postNames[postId] || postId
        });
      });
    }

    return {
      ok: true,
      dateFrom: from.dateStr,
      dateTo: to.dateStr,
      coveredDates: coveredDates,
      conflicts: conflicts,
      versionNo: versionNo
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 新增或者更新一筆不能服侍。**會寫入。**
 *
 * ⚠️ **冇「刪除」。** 要取消一筆就把 `Status` 改成非 ACTIVE，
 * 或者改窄日期範圍。行永遠留住。
 *
 * @param {Object} payload {unavailableId, quarterId, personId, dateFrom, dateTo,
 *   appliesTo, postIds, reason, active}
 * @returns {Object}
 */
function apiSaveUnavailable(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const U = COLUMNS.UNAVAILABLE;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const personId = String(p.personId || '').trim();
  if (!personId) {
    return {
      ok: false,
      message: buildThreePartMessage_('沒有揀人。', '什麼都沒有加入。', ['在上面的下拉揀一位'])
    };
  }

  const from = parseUnavailableDate_(p.dateFrom, timezone, '開始日期');
  const to = parseUnavailableDate_(p.dateTo, timezone, '結束日期');
  if (from.error) return { ok: false, message: from.error };
  if (to.error) return { ok: false, message: to.error };
  if (from.dateStr > to.dateStr) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '開始日期（' + from.dateStr + '）比結束日期（' + to.dateStr + '）遲。',
        '什麼都沒有改動。',
        ['把兩個日期調轉', '如果只是一日不能服侍，兩格填同一日'])
    };
  }

  const appliesTo = String(p.appliesTo || UNAVAILABLE_VALUES.APPLIES_TO_ALL).trim()
    === UNAVAILABLE_VALUES.APPLIES_TO_ALL
    ? UNAVAILABLE_VALUES.APPLIES_TO_ALL : 'POSTS';
  const postIds = appliesTo === UNAVAILABLE_VALUES.APPLIES_TO_ALL ? [] : (p.postIds || []);
  if (appliesTo === 'POSTS' && postIds.length === 0) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '揀了「指定崗位」，但一個崗位都沒有勾。',
        '什麼都沒有改動。',
        ['勾選至少一個崗位', '或者改揀「全部崗位」'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.UNAVAILABLE);
  const nameIndex = buildPersonNameIndex_();
  const personName = nameIndex[personId] || personId;
  const FIELDS = [U.PERSON_ID, U.DATE_FROM, U.DATE_TO, U.APPLIES_TO, U.POST_IDS, U.REASON, U.STATUS];

  const newValues = {};
  newValues[U.PERSON_ID] = personId;
  newValues[U.DATE_FROM] = from.dateStr;
  newValues[U.DATE_TO] = to.dateStr;
  newValues[U.APPLIES_TO] = appliesTo;
  newValues[U.POST_IDS] = postIds.join(',');
  newValues[U.REASON] = String(p.reason || '').trim();
  newValues[U.STATUS] = p.active === false ? 'CANCELLED' : UNAVAILABLE_VALUES.STATUS_ACTIVE;

  const existingId = String(p.unavailableId || '').trim();
  if (existingId) {
    // ⚠️ 用 ID 重新搵列號，**唔信前端傳嚟嗰個**——幹事可能喺試算表插咗行。
    const found = findRowById_(SHEETS.UNAVAILABLE, U.UNAVAILABLE_ID, existingId);
    if (found.sheetRow === -1) {
      return {
        ok: false,
        message: buildThreePartMessage_(
          '找不到要改的那一筆（' + existingId + '）。',
          '什麼都沒有改動。',
          ['重新整理這一頁再試一次', '可能有人剛剛在試算表改動過這張表'])
      };
    }
    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, newValues);
    writeZone3Audit_({
      action: 'UNAVAILABLE_UPDATE',
      targetSheet: SHEETS.UNAVAILABLE,
      targetKey: existingId,
      oldValue: describeFields_(found.record, FIELDS),
      newValue: describeFields_(newValues, FIELDS),
      notes: '幹事介面改動：' + personName
    });
    return { ok: true, unavailableId: existingId, personName: personName, created: false };
  }

  const newId = 'UNAV-' + compactTimestamp_();
  newValues[U.UNAVAILABLE_ID] = newId;
  newValues[U.SOURCE] = WEBUI_AUDIT_SOURCE;
  newValues[U.CREATED_AT] = nowTimestamp_();
  newValues[U.CREATED_BY] = Session.getActiveUser().getEmail();
  appendRowFields_(opened.sheet, opened.headers, newValues);
  writeZone3Audit_({
    action: 'UNAVAILABLE_ADD',
    targetSheet: SHEETS.UNAVAILABLE,
    targetKey: newId,
    oldValue: '（新增）',
    newValue: describeFields_(newValues, FIELDS),
    notes: '幹事介面新增：' + personName
  });
  return { ok: true, unavailableId: newId, personName: personName, created: true };
}

/**
 * 日期輸入一律經 `parseOfficerDateInput_()`（第二十一輪已經收窄嗰個）。
 *
 * ⚠️ **唔喺呢度另外寫一套日期解析。** 第二十一輪特登收窄咗接受嘅格式
 * （因為「3/4」究竟係 3 月 4 日定 4 月 3 日，靠估就一定有一日估錯），
 * 另寫一套就等於喺呢個入口重新打開嗰個洞。
 * @param {*} raw 使用者輸入
 * @param {string} timezone 時區
 * @param {string} label 欄位名（出錯訊息用）
 * @returns {{dateStr: string, error: string}}
 */
function parseUnavailableDate_(raw, timezone, label) {
  const parsed = parseOfficerDateInput_(raw, timezone);
  if (!parsed.ok) {
    return {
      dateStr: '',
      error: buildThreePartMessage_(
        label + '「' + (parsed.rawText || String(raw || '（空白）')) + '」看不懂。',
        '什麼都沒有改動。',
        [
          '請用 2026-11-08 這種寫法（年-月-日）',
          '「11/8」這種寫法系統不接受——因為分不出是 11 月 8 日還是 8 月 11 日'
        ])
    };
  }
  return { dateStr: parsed.dateStr, error: '' };
}
