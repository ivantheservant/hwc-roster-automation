/**
 * 第二十四輪批次階段 F1：區二「開季前準備」嘅寫入端點。
 *
 * 對應 `docs/幹事介面規格.md` 第 3.2／3.3 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ `Confirmed` 欄嘅方向——最容易搞反嘅一件事
 * ─────────────────────────────────────────────────────────────────────
 *
 * `isUnconfirmedSpecialSunday_()`（`AnnualCombined.gs`）嘅定義係：
 *
 * > **空白＝已確認，只有明確 `FALSE` 先算未確認。**
 *
 * 所以畫面上「日期已確認」呢個 checkbox：
 *
 * | 幹事嘅動作 | 要寫入 `Confirmed` |
 * |---|---|
 * | **勾咗**（已確認）| **空白** |
 * | **未勾**（未確認）| **`FALSE`** |
 *
 * 呢個方向**同直覺相反**（一般會以為「已確認」寫 TRUE），但係刻意噉揀嘅：
 * 呢一欄係後加嘅，如果空白當「未確認」，全部既有列一開機就會變成未確認，
 * 提醒機制即刻噴一堆假警報。
 *
 * 搞反嘅後果：全季嘅特別主日會由「已確認」變成「未確認」（或者相反），
 * 而**畫面上睇落完全正常**——因為 checkbox 顯示嘅係你啱啱勾嗰個狀態，
 * 唔係試算表真正存咗咩。已用 `tests/special_sunday_confirmed_direction.test.js`
 * 鎖死呢個方向。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 唔提供刪除（決定 D7）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 只有 `Active` 開關。刪咗一行，之前用過嗰個特別主日嘅歷史就對唔返。
 */

/**
 * 把畫面上「日期已確認」嘅 checkbox 狀態，轉成要寫入 `Confirmed` 欄嘅值。
 *
 * **純函式**，特登抽出嚟——呢個方向係本檔案最易搞反嘅一件事，
 * 要有一個單一入口俾測試鎖死。
 *
 * @param {boolean} confirmedChecked 幹事有冇勾「日期已確認」
 * @returns {string} 要寫入嘅值：勾咗＝空白，未勾＝`FALSE`
 */
function toConfirmedCellValue_(confirmedChecked) {
  return confirmedChecked === true ? '' : BOOLEAN_TEXT.FALSE;
}

/**
 * 反方向：由試算表格嘅值算出 checkbox 應該勾定唔勾。
 *
 * 一定要行返 `isUnconfirmedSpecialSunday_()` 呢個唯一判斷入口，
 * **唔可以喺呢度另外寫一次 `isTrueValue_` 判斷**——兩個地方各自判斷，
 * 遲早會有一邊搞反。
 *
 * @param {Object} row SpecialSundays 一行
 * @returns {boolean} checkbox 應唔應該勾
 */
function isConfirmedCheckboxOn_(row) {
  return !isUnconfirmedSpecialSunday_(row);
}

/**
 * 供前端呼叫：列出本季全部特別主日（包括 `Active=FALSE` 嘅，分開標示）。
 * @param {string} quarterId 季度 ID
 * @returns {{rows: Object[], posts: Object[], serviceDates: string[]}}
 */
function apiListSpecialSundays(quarterId) {
  assertWebAppRequestAllowed_();

  const S = COLUMNS.SPECIAL_SUNDAYS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const rows = readOptionalSheetRows_(SHEETS.SPECIAL_SUNDAYS)
    .map(function (row, index) {
      return { row: row, sheetRow: index + 3 };   // 資料由第 3 行起
    })
    .filter(function (item) {
      return String(item.row[S.QUARTER_ID] || '').trim() === quarterId;
    })
    .map(function (item) {
      const row = item.row;
      return {
        sheetRow: item.sheetRow,
        specialId: String(row[S.SPECIAL_ID] || ''),
        serviceDate: toDateString(row[S.SERVICE_DATE], timezone),
        type: String(row[S.TYPE] || ''),
        title: String(row[S.TITLE] || ''),
        skipPostIds: splitList_(row[S.SKIP_POST_IDS]),
        translationRequired: isTrueValue_(row[S.TRANSLATION_REQUIRED]),
        // ⚠️ 一定要行 isConfirmedCheckboxOn_()，見檔頭方向說明。
        confirmedChecked: isConfirmedCheckboxOn_(row),
        active: isTrueValue_(row[S.ACTIVE]),
        isCombined: isCombinedServiceRow_(row)
      };
    })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : 1; });

  return {
    rows: rows,
    // 「哪些崗位不用排」用 checkbox 陣列，唔叫幹事打 `WORSHIP,PIANO`
    posts: readPostsNormalized().map(function (p) {
      return { postId: p.postId, postNameTC: p.postNameTC };
    }),
    // 改日期時要即時警告「唔喺本季主日之內」
    serviceDates: readServiceDatesNormalized(quarterId, timezone).map(function (d) {
      return d.serviceDate;
    })
  };
}

/**
 * 供前端呼叫：改一行特別主日。
 * @param {Object} payload `{quarterId, sheetRow, serviceDate, type, title,
 *   skipPostIds, translationRequired, confirmedChecked, active}`
 * @returns {{ok: boolean, warning: string}}
 */
function apiSaveSpecialSunday(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) throw new Error('找不到工作表：' + SHEETS.SPECIAL_SUNDAYS);

  const sheetRow = Number(p.sheetRow);
  if (!sheetRow || sheetRow < 3) {
    throw new Error('要改的那一行找不到（行號 ' + p.sheetRow + '）。請重新整理再試一次。');
  }

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  // 唔信前端傳嚟嘅季度：由該行自己讀返，確認真係本季嗰行。
  const before = sheet.getRange(sheetRow, 1, 1, headers.length).getValues()[0];
  const beforeByKey = {};
  headers.forEach(function (h, i) { if (h) beforeByKey[h] = before[i]; });
  if (String(beforeByKey[S.QUARTER_ID] || '').trim() !== String(p.quarterId || '').trim()) {
    throw new Error(buildThreePartMessage_(
      '要改的那一行不屬於目前選中的季度（可能在你開著這個畫面的時候，'
        + '有人動過特別主日的資料）。',
      '沒有改動任何東西。',
      ['關掉這個畫面，重新整理再試一次']));
  }

  const updates = {};
  updates[S.SERVICE_DATE] = String(p.serviceDate || '');
  updates[S.TYPE] = String(p.type || '');
  updates[S.TITLE] = String(p.title || '');
  updates[S.SKIP_POST_IDS] = (p.skipPostIds || []).join(',');
  updates[S.TRANSLATION_REQUIRED] = p.translationRequired ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
  // ⚠️ 方向：勾咗＝空白，未勾＝FALSE。見檔頭。
  updates[S.CONFIRMED] = toConfirmedCellValue_(p.confirmedChecked === true);
  updates[S.ACTIVE] = p.active ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;

  writeSpecialSundayRow_(sheet, headers, sheetRow, updates);

  writeAuditLog_({
    action: '改特別主日',
    targetSheet: SHEETS.SPECIAL_SUNDAYS,
    targetKey: String(beforeByKey[S.SPECIAL_ID] || ('第 ' + sheetRow + ' 行')),
    oldValue: describeSpecialSundayRow_(beforeByKey, timezone),
    newValue: describeSpecialSundayRow_(updates, timezone),
    source: 'WEBUI'
  });

  return {
    ok: true,
    warning: buildServiceDateWarning_(p.quarterId, String(p.serviceDate || ''), timezone)
  };
}

/**
 * 供前端呼叫：新增一行特別主日。
 * @param {Object} payload 同 `apiSaveSpecialSunday`，但冇 `sheetRow`
 * @returns {{ok: boolean, sheetRow: number, warning: string}}
 */
function apiAddSpecialSunday(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};

  const quarterId = String(p.quarterId || '').trim();
  if (!quarterId) throw new Error('沒有指定季度。');
  if (!String(p.serviceDate || '').trim()) throw new Error('日期不可留空。');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) throw new Error('找不到工作表：' + SHEETS.SPECIAL_SUNDAYS);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const targetRow = sheet.getLastRow() + 1;

  const updates = {};
  updates[S.SPECIAL_ID] = quarterId + '-SP-' + Utilities.getUuid().slice(0, 8);
  updates[S.QUARTER_ID] = quarterId;
  updates[S.SERVICE_DATE] = String(p.serviceDate || '');
  updates[S.TYPE] = String(p.type || '');
  updates[S.TITLE] = String(p.title || '');
  updates[S.SKIP_POST_IDS] = (p.skipPostIds || []).join(',');
  updates[S.TRANSLATION_REQUIRED] = p.translationRequired ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
  updates[S.CONFIRMED] = toConfirmedCellValue_(p.confirmedChecked === true);
  updates[S.ACTIVE] = BOOLEAN_TEXT.TRUE;

  writeSpecialSundayRow_(sheet, headers, targetRow, updates);

  writeAuditLog_({
    action: '新增特別主日',
    targetSheet: SHEETS.SPECIAL_SUNDAYS,
    targetKey: updates[S.SPECIAL_ID],
    newValue: describeSpecialSundayRow_(updates, timezone),
    source: 'WEBUI'
  });

  return {
    ok: true,
    sheetRow: targetRow,
    warning: buildServiceDateWarning_(quarterId, String(p.serviceDate || ''), timezone)
  };
}

/**
 * 只寫 `updates` 入面有嘅欄，其餘一律唔郁。
 *
 * ⚠️ 唔可以整行覆寫——`SpecialSundays` 有幾欄（`LockPostIDs`、
 * `CommunionOverride`、`Notes`）唔喺呢個畫面上面，整行寫會靜靜清空佢哋。
 * @param {Sheet} sheet 工作表
 * @param {string[]} headers 標題列
 * @param {number} sheetRow 目標行號
 * @param {Object} updates 要改嘅欄
 * @returns {void}
 */
function writeSpecialSundayRow_(sheet, headers, sheetRow, updates) {
  Object.keys(updates).forEach(function (key) {
    const col = headers.indexOf(key) + 1;
    if (col === 0) return;   // 呢張表冇呢一欄（舊版 schema），略過
    sheet.getRange(sheetRow, col).setValue(updates[key]);
  });
}

/** 把一行整理成 AuditLog 睇得明嘅一句。 */
function describeSpecialSundayRow_(byKey, timezone) {
  const S = COLUMNS.SPECIAL_SUNDAYS;
  return '日期=' + toDateString(byKey[S.SERVICE_DATE], timezone)
    + '　類型=' + displayCellValue_(byKey[S.TYPE], '（空白）')
    + '　名稱=' + displayCellValue_(byKey[S.TITLE], '（空白）')
    + '　跳過崗位=' + displayCellValue_(byKey[S.SKIP_POST_IDS], '（無）')
    + '　Confirmed=' + displayCellValue_(byKey[S.CONFIRMED], '（空白＝已確認）')
    + '　Active=' + displayCellValue_(byKey[S.ACTIVE]);
}

/**
 * 規格 3.2：改日期時，如果新日期唔喺本季 `ServiceDates` 之內就即時警告。
 * @returns {string} 冇問題時回空字串
 */
function buildServiceDateWarning_(quarterId, serviceDate, timezone) {
  if (!serviceDate) return '';
  try {
    const dates = readServiceDatesNormalized(quarterId, timezone)
      .map(function (d) { return d.serviceDate; });
    if (dates.indexOf(serviceDate) !== -1) return '';
    return '⚠️ ' + serviceDate + ' 不是這一季的主日。'
      + '這一行仍然已經儲存了，但排表時不會用到它——'
      + '因為系統只會排這一季 ServiceDates 上有的日子。'
      + '請確認日期有沒有打錯。';
  } catch (err) {
    return '⚠️ 無法核對這個日期是不是這一季的主日（' + err.message + '）。請自己確認一次。';
  }
}

/* ============================================================
 * 規格 3.3：講員／翻譯／獻花——Web App 專用包裝層
 * ============================================================
 *
 * `apiListPreacherTranslationPending()`／`apiSavePreacherTranslationEntry()`
 * （`PreacherTranslationFill.gs`）本來係**試算表側邊欄**用嘅，
 * 冇 `assertWebAppRequestAllowed_()`——因為側邊欄嘅授權係「你打得開
 * 呢個試算表」，同 Web App 嗰三層完全唔同。
 *
 * ⚠️ **唔可以直接喺原函式加 guard**：噉會令側邊欄壞掉
 * （`WEBAPP_ENABLED` 關閉時側邊欄都會拒絕運作，但側邊欄同 Web UI
 *   啟用與否本來就冇關係）。
 *
 * 所以加一層薄包裝：Web App 呢邊有 guard，側邊軉嗰邊維持原樣。
 */

/**
 * 供 Web UI 呼叫：列出本季仲未填嘅講員／翻譯／獻花格。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 同 `apiListPreacherTranslationPending()`
 */
function apiWebListPreacherPending(quarterId) {
  assertWebAppRequestAllowed_();
  return apiListPreacherTranslationPending(quarterId);
}

/**
 * 供 Web UI 呼叫：儲存一格講員／翻譯／獻花。
 * @param {string} quarterId 季度 ID
 * @param {string} serviceDate 服侍日期
 * @param {string} postId 崗位 ID
 * @param {number} slotIndex slot
 * @param {string} name 姓名
 * @returns {Object} 同 `apiSavePreacherTranslationEntry()`
 */
function apiWebSavePreacherEntry(quarterId, serviceDate, postId, slotIndex, name) {
  assertWebAppRequestAllowed_();
  return apiSavePreacherTranslationEntry(quarterId, serviceDate, postId, slotIndex, name);
}
