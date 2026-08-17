/**
 * 第二十二輪批次階段 D：「查看（唯讀，只寫 Diagnostics） ▸ 設定回復檢查（唯讀）」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 背景
 * ─────────────────────────────────────────────────────────────────────
 *
 * 真正操作系統的人是幹事，2026 年 11 月中之前要教識佢。2026T4／2027T1
 * 已經正式上線，但 2027T2／T3 等後續季度仍在準備。8 月至 11 月中屬於
 * 測試期，期間 Ivan 會為咗配合測試任意調整日期與參數（`GenerateOn`／
 * `OfficialSendOn`、`LEAD_DAYS_*`、`REMIND_*`、`RANDOM_SEED`、
 * `PDF_BATCH_SIZE`、trigger 時間……），但 **11 月中之前必須全部改回真實值**
 * ——單靠記憶一定會漏，所以需要一個工具逐項核對。
 *
 * `docs/config_baseline_上線值.json` 記錄咗 2026-08-17 當下每一個 Config Key
 * 嘅「上線目標值」，以及四個已知季度嘅 `GenerateOn`／`OfficialSendOn`。
 * Apps Script **讀唔到 repo 檔案**，所以呢份資料內容以常數形式複製一份到
 * `getConfigBaselineSnapshot_()`——兩份要保持同步；如果日後改咗其中一份，
 * 記得另一份都要改。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢個工具本身完全唯讀
 * ─────────────────────────────────────────────────────────────────────
 *
 * 只讀 Config／Quarters，唔改動任何工作表資料、唔改 Config 值——同「查看」
 * 子選單其他工具一樣，唯一嘅寫入是把報告同時記一份落 Diagnostics。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解唔喺呢度自動判斷「上線值 = 程式碼預設值」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 快照入面每個 Key 都有 `source` 欄，標明「已核實的實際值」定係「程式碼
 * 預設值（試算表現時實際值未核實）」。後者代表 2026-08-17 嗰陣 Ivan 冇提供
 * 呢個 Key 嘅實際值——本工具唯一知道嘅係程式碼寫嘅預設值，試算表上面
 * 實際存住嘅值有可能一早已經唔同（工作表既有值一律優先於程式碼預設）。
 * 呢類 Key 一樣會拎去比對（唔比對就完全冧唔到用），但報告會誠實標明
 * 「未核實」，唔會講到好似呢個就一定係「正確嘅上線值」咁肯定。
 */

/**
 * 上線值快照——複製自 `docs/config_baseline_上線值.json`（2026-08-17）。
 * 兩份要保持同步，見檔頭說明。
 * @returns {{snapshotDate: string, configKeys: Object.<string, {launchTargetValue: string, source: string, dynamic: (boolean|undefined)}>, quarters: Object.<string, {generateOn: string, officialSendOn: string}>}}
 */
function getConfigBaselineSnapshot_() {
  return {
    snapshotDate: '2026-08-17',
    configKeys: {
      ATTACH_HIGHLIGHT_PERSONAL: { launchTargetValue: 'FALSE', source: '程式碼預設值（試算表現時實際值未核實）' },
      ATTACH_NAME_PATTERN: { launchTargetValue: '{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf', source: '程式碼預設值（試算表現時實際值未核實）' },
      ATTACH_PAGE_ORIENTATION: { launchTargetValue: 'LANDSCAPE', source: '程式碼預設值（試算表現時實際值未核實）' },
      CARRY_OVER_WEEKS: { launchTargetValue: '2', source: '已核實的實際值' },
      DEFAULT_MAX_PER_QUARTER: { launchTargetValue: '8', source: '已核實的實際值' },
      DRY_RUN: { launchTargetValue: 'FALSE', source: '已核實的實際值' },
      FINETUNE_MAX_MOVES: { launchTargetValue: '6', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_FOOTER_NOTE: { launchTargetValue: '如未能按上表服侍，請盡早聯絡幹事安排調動。', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_GAP_LABEL: { launchTargetValue: '⚠ 未能安排', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_NOT_APPLICABLE_LABEL: { launchTargetValue: '—', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_PENDING_FILL_COLOR: { launchTargetValue: '#F4CCCC', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_PENDING_LABEL: { launchTargetValue: '（待填）', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_SHOW_LEGEND: { launchTargetValue: 'TRUE', source: '程式碼預設值（試算表現時實際值未核實）' },
      GRID_SPECIAL_SKIP_LABEL: { launchTargetValue: '特殊主日', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_COL_EMAIL: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_COL_LAST_ATTENDANCE: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_COL_MEETING_POINT: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_COL_MEMBER_NO: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_COL_NAME: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_CONGREGATION_PREFIXES: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_MEMBERS_SHEET: { launchTargetValue: 'Members', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_READ_COLUMNS: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      HWCAS_SPREADSHEET_ID: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      ICS_SERVICE_END_TIME: { launchTargetValue: '12:00', source: '程式碼預設值（試算表現時實際值未核實）' },
      ICS_SERVICE_START_TIME: { launchTargetValue: '10:45', source: '程式碼預設值（試算表現時實際值未核實）' },
      LEAD_DAYS_GENERATE: { launchTargetValue: '-35', source: '已核實的實際值' },
      LEAD_DAYS_OFFICIAL: { launchTargetValue: '-28', source: '已核實的實際值' },
      MAIL_ADMIN_NOTIFY: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      MAIL_REPLY_TO: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      MAIL_SENDER_NAME: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      MAIL_SUBJECT_PREFIX: { launchTargetValue: '', source: '已核實的實際值' },
      MAIL_SUMMARY_DATE_FORMAT: { launchTargetValue: 'M月d日', source: '程式碼預設值（試算表現時實際值未核實）' },
      MAIL_SUMMARY_SEPARATOR: { launchTargetValue: '；', source: '程式碼預設值（試算表現時實際值未核實）' },
      MULTIRUN_ATTEMPTS: { launchTargetValue: '20', source: '已核實的實際值' },
      PDF_BATCH_SIZE: { launchTargetValue: '25', source: '已核實的實際值' },
      PDF_EXPORT_MAX_RETRIES: { launchTargetValue: '4', source: '程式碼預設值（試算表現時實際值未核實）' },
      PDF_EXPORT_PACING_MS: { launchTargetValue: '500', source: '已核實的實際值' },
      PDF_EXPORT_RETRY_DELAY_MS: { launchTargetValue: '1000', source: '程式碼預設值（試算表現時實際值未核實）' },
      PDF_MIN_SIZE_BYTES: { launchTargetValue: '10240', source: '已核實的實際值' },
      PDF_REGENERATE_IF_EXISTS: { launchTargetValue: 'FALSE', source: '程式碼預設值（試算表現時實際值未核實）' },
      PUBLIC_ROSTER_BLANK_NOTE: { launchTargetValue: '由會友另行安排，非本系統自動排定', source: '程式碼預設值（試算表現時實際值未核實）' },
      PUBLIC_ROSTER_DATE_FORMAT: { launchTargetValue: '{M}月{d}日', source: '程式碼預設值（試算表現時實際值未核實）' },
      PUBLIC_ROSTER_FILE_NAME_PATTERN: { launchTargetValue: '{QuarterID} 粵語堂職事表（公開版）', source: '程式碼預設值（試算表現時實際值未核實）' },
      QUARTER_TERM_START_MONTHS: { launchTargetValue: '1,4,7,10', source: '已核實的實際值' },
      RANDOM_SEED: { launchTargetValue: '20260811', source: '已核實的實際值' },
      REMIND_DEADLINE_DAYS: { launchTargetValue: '7', source: '已核實的實際值' },
      REMIND_STUCK_DAYS: { launchTargetValue: '3', source: '已核實的實際值' },
      REMIND_STUCK_MAX_COUNT: { launchTargetValue: '3', source: '已核實的實際值' },
      REMIND_UNCONFIRMED_SPECIAL_DAYS: { launchTargetValue: '7', source: '已核實的實際值' },
      RESEND_ONLY_CHANGED: { launchTargetValue: 'TRUE', source: '程式碼預設值（試算表現時實際值未核實）' },
      ROSTER_DRIVE_FOLDER_ID: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      // 動態值：安裝時自動偵測填入本試算表自己的 ID，唔可能有固定嘅「上線目標值」，
      // 比對時一律略過（見 planConfigBaselineCheck_() 的 dynamic 判斷）。
      ROSTER_SPREADSHEET_ID: { launchTargetValue: '', source: '動態值，不比對', dynamic: true },
      SCORE_CHAIR_DUAL_BONUS: { launchTargetValue: '30', source: '已核實的實際值' },
      SCORE_PREFERENCE_BONUS: { launchTargetValue: '50', source: '已核實的實際值' },
      SCORE_SELECTION_WEIGHT: { launchTargetValue: '45', source: '已核實的實際值' },
      SCORE_TIE_EPSILON: { launchTargetValue: '0', source: '已核實的實際值' },
      SCRIPT_ACCOUNT_EMAIL: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      SELECTION_STRATEGY: { launchTargetValue: 'LONGEST_UNSERVED', source: '程式碼預設值（試算表現時實際值未核實）' },
      SELECTION_WEIGHT_HISTORICAL: { launchTargetValue: '0.5', source: '已核實的實際值' },
      SELF_TEST_QUARTER_ID: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      SEND_HOUR_LOCAL: { launchTargetValue: '9', source: '已核實的實際值' },
      SEND_LOG_FLUSH_BATCH_SIZE: { launchTargetValue: '15', source: '已核實的實際值' },
      SEND_WEEKDAY_GUARD: { launchTargetValue: 'NONE', source: '已核實的實際值' },
      SOFT_METRIC_COUNT_TOLERANCE_RATIO: { launchTargetValue: '0.2', source: '程式碼預設值（試算表現時實際值未核實）' },
      SOFT_METRIC_POST_USAGE_MIN_RATIO: { launchTargetValue: '0.5', source: '程式碼預設值（試算表現時實際值未核實）' },
      SOFT_METRIC_RATIO_TOLERANCE: { launchTargetValue: '0.05', source: '程式碼預設值（試算表現時實際值未核實）' },
      STEP4_MAX_MISSING_PDF_RATIO: { launchTargetValue: '0.2', source: '已核實的實際值' },
      SYS_CONFIG_CACHE_SECONDS: { launchTargetValue: '300', source: '程式碼預設值（試算表現時實際值未核實）' },
      SYS_LOCALE: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      SYS_TIMESTAMP_FORMAT: { launchTargetValue: 'yyyy-MM-dd HH:mm:ss', source: '程式碼預設值（試算表現時實際值未核實）' },
      SYS_TIMEZONE: { launchTargetValue: 'Pacific/Auckland', source: '程式碼預設值（試算表現時實際值未核實）' },
      V0_PROTECT: { launchTargetValue: 'FALSE', source: '程式碼預設值（試算表現時實際值未核實）' },
      WARN_ON_SEMI_HARD_BREAK: { launchTargetValue: 'TRUE', source: '程式碼預設值（試算表現時實際值未核實）' },
      WEBAPP_ALLOWED_EMAILS: { launchTargetValue: '', source: '程式碼預設值（試算表現時實際值未核實）' },
      WEBAPP_ENABLED: { launchTargetValue: 'TRUE', source: '已核實的實際值' }
    },
    quarters: {
      '2026T4': { generateOn: '2026-08-30', officialSendOn: '2026-09-06' },
      '2027T1': { generateOn: '2026-11-27', officialSendOn: '2026-12-04' },
      '2027T2': { generateOn: '2027-02-25', officialSendOn: '2027-03-04' },
      '2027T3': { generateOn: '2027-05-27', officialSendOn: '2027-06-03' },
      '2027T4': { generateOn: '', officialSendOn: '' }
    }
  };
}

/**
 * 快照入面代表「呢個基準可信」嘅 `source` 值。只有呢一種先會被判「必須改回」。
 * 寫成常數係因為 `planConfigBaselineCheck_()` 同快照本身兩邊都要用同一個字串，
 * 打錯一個字就會令全部 Key 靜靜跌入「未核實」桶而冇人發現。
 */
const CONFIG_BASELINE_SOURCE_VERIFIED = '已核實的實際值';

/**
 * 第二十三輪批次階段 B2：把 Config 儲存格原始值轉成可以比對／顯示嘅文字。
 *
 * ⚠️ **唔可以就咁 `String(rawValue)`。** Google 試算表會把「睇落似時間／
 * 日期」嘅格自動存成 Date 物件——`String(Date)` 出嚟係成串英文長格式
 * （`Sat Dec 30 1899 10:45:00 GMT+1130 (…)`），同快照入面嘅 `10:45`
 * 永遠對唔上，於是每次都報「不符」，但幹事去到 Config 望，格入面明明
 * 寫住 `10:45`——**工具講嘅嘢同幹事睇到嘅嘢對唔上，係最難查嘅一種誤報。**
 * （同一個成因喺階段 A 令 ICS 附件時間全部變成 NaN。）
 *
 * 兩種 Date 要分開處理：
 * - **年份 < 1900**：試算表儲存「純時間」用嘅 epoch（1899-12-30 當日），
 *   代表呢格本來係 `HH:mm` ⇒ 輸出 `HH:mm`
 * - **其餘**：真正嘅日期 ⇒ 輸出 `yyyy-MM-dd`
 *
 * @param {*} rawValue Config 儲存格原始值
 * @param {string} timezone 時區
 * @returns {string} 可比對／可顯示嘅文字
 */
function normalizeConfigValueForCompare_(rawValue, timezone) {
  if (rawValue === null || rawValue === undefined) return '';
  if (Object.prototype.toString.call(rawValue) === '[object Date]') {
    return rawValue.getFullYear() < 1900
      ? Utilities.formatDate(rawValue, timezone, 'HH:mm')
      : Utilities.formatDate(rawValue, timezone, 'yyyy-MM-dd');
  }
  return String(rawValue).trim();
}

/**
 * 第二十三輪批次階段 B2：**按 Config 嘅 `Type` 欄比對，唔可以純字串比。**
 *
 * 實測跑出 28 項不符，當中一大批係純粹嘅格式差異而唔係真差異：
 *
 * | Type | 誤報例子 | 點解 |
 * |---|---|---|
 * | `BOOL` | 工作表 `true` vs 快照 `TRUE` | 大小寫唔同，語意完全一樣 |
 * | `DEC` | 工作表 `0.50` vs 快照 `0.5` | 試算表會補／去尾數零 |
 * | `INT` | 工作表數字 `9` vs 快照字串 `'9'` | 儲存格存數字，快照存文字 |
 * | `LIST` | `1, 4, 7, 10` vs `1,4,7,10` | 空格差異 |
 * | 其餘 | Date 物件 vs `10:45` | 見 normalizeConfigValueForCompare_() |
 *
 * 每一種都要用嗰種型別本身嘅語意去比，先至問得出「呢兩個值係咪同一件事」。
 *
 * @param {*} rawCurrent 工作表現時原始值
 * @param {string} targetValue 快照嘅上線目標值（一律係文字）
 * @param {string} type Config 嘅 `Type` 欄（已 uppercase）
 * @param {string} timezone 時區
 * @returns {{equal: boolean, currentDisplay: string, note: string}}
 */
function compareConfigValues_(rawCurrent, targetValue, type, timezone) {
  const currentText = normalizeConfigValueForCompare_(rawCurrent, timezone);
  const targetText = String(targetValue === null || targetValue === undefined ? '' : targetValue).trim();

  if (type === CONFIG_TYPES.BOOL) {
    // 兩邊都經 isTrueValue_ 再比布林，`true`／`TRUE`／`True` 一律視為相同。
    return {
      equal: isTrueValue_(currentText) === isTrueValue_(targetText),
      currentDisplay: currentText,
      note: ''
    };
  }

  if (type === CONFIG_TYPES.INT || type === CONFIG_TYPES.DEC) {
    // 兩邊都空白＝相同（都係「未設定」）。
    if (currentText === '' && targetText === '') {
      return { equal: true, currentDisplay: currentText, note: '' };
    }
    const a = Number(currentText);
    const b = Number(targetText);
    // 任何一邊唔係數字，退回字串比——唔可以靜靜當成 NaN === NaN（永遠 false）
    // 或者 0，嗰兩種都係把「認唔到」當成一個有意義嘅答案。
    if (isNaN(a) || isNaN(b)) {
      return {
        equal: currentText === targetText,
        currentDisplay: currentText,
        note: '這一格的值不是數字，已退回逐字比對'
      };
    }
    return { equal: a === b, currentDisplay: currentText, note: '' };
  }

  if (type === CONFIG_TYPES.LIST) {
    const split = function (s) {
      return String(s).split(',').map(function (x) { return x.trim(); })
        .filter(function (x) { return x !== ''; });
    };
    const a = split(currentText);
    const b = split(targetText);
    const sameOrder = a.length === b.length && a.every(function (x, i) { return x === b[i]; });
    if (sameOrder) return { equal: true, currentDisplay: currentText, note: '' };

    // 次序不同視為不符（有啲 LIST 次序有意義，例如
    // QUARTER_TERM_START_MONTHS 嘅四個月份），但訊息要講明係次序問題，
    // 唔好令人以為內容唔同、去逐項對半日先發現只係排列唔同。
    const sorted = function (arr) { return arr.slice().sort(); };
    const sameSet = a.length === b.length
      && sorted(a).every(function (x, i) { return x === sorted(b)[i]; });
    return {
      equal: false,
      currentDisplay: currentText,
      note: sameSet ? '⚠ 項目完全相同，只是排列次序不同' : ''
    };
  }

  return { equal: currentText === targetText, currentDisplay: currentText, note: '' };
}

/**
 * 純比對邏輯，不碰任何 Google API——方便離線測試。
 * @param {Object} snapshot getConfigBaselineSnapshot_() 的結果
 * @param {Object[]} configRows readSheet(SHEETS.CONFIG) 的結果
 * @param {Object[]} quarterRows readSheet(SHEETS.QUARTERS) 的結果
 * @param {string} timezone 時區名稱（比對 Quarters 日期用）
 * @returns {{snapshotDate: string,
 *   config: {mismatched: Object[], matched: Object[], newKeysInSheet: Object[]},
 *   quarters: {mismatched: Object[], matched: Object[], newInSheet: Object[]}}}
 */
function planConfigBaselineCheck_(snapshot, configRows, quarterRows, timezone) {
  const C = COLUMNS.CONFIG;
  const currentByKey = {};
  const typeByKey = {};
  (configRows || []).forEach(function (row) {
    const key = String(row[C.KEY] || '').trim();
    if (!key) return;
    // ⚠️ 唔可以就咁 String()——見 normalizeConfigValueForCompare_() 檔頭。
    // 保留原始值，型別相關嘅正規化留到比對嗰陣先做。
    currentByKey[key] = row[C.VALUE];
    typeByKey[key] = String(row[C.TYPE] || '').trim().toUpperCase();
  });

  const configMismatched = [];
  const configMatched = [];
  const configUnknownBaseline = [];
  const configNewKeysInSheet = [];

  Object.keys(snapshot.configKeys).forEach(function (key) {
    const def = snapshot.configKeys[key];
    if (def.dynamic) return;   // 動態值（例如 ROSTER_SPREADSHEET_ID）唔比對

    const hasRow = Object.prototype.hasOwnProperty.call(currentByKey, key);
    const rawCurrent = hasRow ? currentByKey[key] : '';
    const type = typeByKey[key] || '';
    const cmp = compareConfigValues_(rawCurrent, def.launchTargetValue, type, timezone);

    const item = {
      key: key,
      type: type,
      currentValue: hasRow ? cmp.currentDisplay : '（工作表沒有這一行，視同空白）',
      targetValue: def.launchTargetValue,
      source: def.source,
      note: cmp.note || ''
    };

    // 第二十三輪批次階段 B1：**三分類，唔係二分類。**
    //
    // 之前只有「相符／不符」兩桶，於是 75 個 Key 之中大約 23 個
    // 「快照本身就冇可信基準」（source 係「程式碼預設值（未核實）」）嘅 Key
    // 全部被塞入「❌ 必須改回」，實測跑出 28 項不符入面 23 項係假警報。
    // 結果：**呢個工具永遠清唔到零，達成唔到佢自己嘅目的**
    // （「上線前把全部差異清零」）。
    //
    // 呢個係本專案已經燒過幾次嘅同一個 bug class 嘅變種：
    // **把「唔知」當成「已知係錯」。** 冇基準唔等於不符——
    // 冇基準就係冇基準，要人眼核對，唔可以由工具替人斷定。
    // `docs/config_baseline_上線值.json` 嘅 `_說明` 本來就係噉寫，
    // 之前係實作冇跟；以 JSON 嘅 `_說明` 為準。
    if (def.source !== CONFIG_BASELINE_SOURCE_VERIFIED) {
      configUnknownBaseline.push(item);
    } else if (cmp.equal) {
      configMatched.push(item);
    } else {
      configMismatched.push(item);
    }
  });

  Object.keys(currentByKey).forEach(function (key) {
    if (!snapshot.configKeys[key]) {
      configNewKeysInSheet.push({
        key: key,
        currentValue: normalizeConfigValueForCompare_(currentByKey[key], timezone)
      });
    }
  });

  const Q = COLUMNS.QUARTERS;
  const quarterMismatched = [];
  const quarterMatched = [];
  const quarterNewInSheet = [];

  (quarterRows || []).forEach(function (row) {
    const quarterId = String(row[Q.QUARTER_ID] || '').trim();
    if (!quarterId) return;
    const def = snapshot.quarters[quarterId];
    const currentGenerateOn = toDateString(row[Q.GENERATE_ON], timezone);
    const currentOfficialSendOn = toDateString(row[Q.OFFICIAL_SEND_ON], timezone);

    if (!def) {
      quarterNewInSheet.push({
        quarterId: quarterId, generateOn: currentGenerateOn, officialSendOn: currentOfficialSendOn
      });
      return;
    }

    // 快照嗰邊留空（例如 2027T4「尚未計算」）代表冇基準可比，一律當「相符」，
    // 不會誤報「不符」——冇資料唔等於錯，跟第十八輪「缺失當有意義值」是
    // 相反方向的同一個陷阱：這裡刻意不把「未知」當成「不符」。
    const generateOnOk = def.generateOn === '' || def.generateOn === currentGenerateOn;
    const officialSendOnOk = def.officialSendOn === '' || def.officialSendOn === currentOfficialSendOn;

    const item = {
      quarterId: quarterId,
      currentGenerateOn: currentGenerateOn, targetGenerateOn: def.generateOn,
      currentOfficialSendOn: currentOfficialSendOn, targetOfficialSendOn: def.officialSendOn
    };
    if (generateOnOk && officialSendOnOk) {
      quarterMatched.push(item);
    } else {
      quarterMismatched.push(item);
    }
  });

  return {
    snapshotDate: snapshot.snapshotDate,
    config: {
      mismatched: configMismatched,
      matched: configMatched,
      unknownBaseline: configUnknownBaseline,
      newKeysInSheet: configNewKeysInSheet
    },
    quarters: { mismatched: quarterMismatched, matched: quarterMatched, newInSheet: quarterNewInSheet }
  };
}

/**
 * 組裝 planConfigBaselineCheck_() 需要的真實輸入（讀試算表，唯讀）。
 * @returns {Object} { snapshot, configRows, quarterRows, timezone }
 */
function buildConfigBaselineCheckInputs_() {
  return {
    snapshot: getConfigBaselineSnapshot_(),
    configRows: readSheet(SHEETS.CONFIG),
    quarterRows: readSheet(SHEETS.QUARTERS),
    timezone: getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE)
  };
}

/**
 * 選單項目「查看（唯讀，只寫 Diagnostics） ▸ 設定回復檢查（唯讀）」的執行入口。
 * @returns {void}
 */
function runConfigBaselineCheck_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const inputs = buildConfigBaselineCheckInputs_();
    const result = planConfigBaselineCheck_(inputs.snapshot, inputs.configRows, inputs.quarterRows, inputs.timezone);

    // 第二十三輪批次階段 B3：三個桶各自獨立成一節，總結句擺最前。
    //
    // 之前每一行尾巴掛一句「⚠ 上線值來自程式碼預設，未經核實」，
    // 但嗰行**照樣計入 ❌ 總數**——訊息自己講緊「呢個基準唔可信」，
    // 同一行卻又叫人「必須改回」，自相矛盾。而且 ❌ 總數永遠清唔到零，
    // 令幹事無從判斷「幾時先算做完」。
    const mismatchCount = result.config.mismatched.length + result.quarters.mismatched.length;
    const unknownCount = result.config.unknownBaseline.length;
    const matchedCount = result.config.matched.length + result.quarters.matched.length;
    const totalNew = result.config.newKeysInSheet.length + result.quarters.newInSheet.length;

    const lines = [
      '快照日期：' + result.snapshotDate + '（docs/config_baseline_上線值.json）',
      '',
      '❌ 必須改回：' + mismatchCount + ' 項',
      'ℹ️ 未核實基準，要人眼核對：' + unknownCount + ' 項（不計入必須改回）',
      '✅ 已符合：' + matchedCount + ' 項'
    ];

    if (mismatchCount > 0) {
      lines.push('', '─── ❌ 必須改回（快照有已核實基準，而現時值不符）───');
      result.config.mismatched.forEach(function (item) {
        lines.push('　' + item.key + '　現時「' + item.currentValue + '」　上線值應為「' + item.targetValue + '」'
          + (item.note ? '　' + item.note : ''));
      });
      result.quarters.mismatched.forEach(function (item) {
        lines.push('　' + item.quarterId + '　GenerateOn 現時「' + item.currentGenerateOn
          + '」應為「' + item.targetGenerateOn + '」　OfficialSendOn 現時「' + item.currentOfficialSendOn
          + '」應為「' + item.targetOfficialSendOn + '」');
      });
    }

    if (unknownCount > 0) {
      lines.push('', '─── ℹ️ 未核實基準，工具無法判斷（列出現時值供你人眼核對）───',
        '　這些 Key 在 2026-08-17 造快照時沒有記錄實際值，快照只有程式碼預設值。',
        '　工具不會替你斷定它們對不對——「沒有基準」不等於「不符」。');
      result.config.unknownBaseline.forEach(function (item) {
        lines.push('　' + item.key + '　現時「' + item.currentValue + '」'
          + '　（程式碼預設是「' + item.targetValue + '」）'
          + (item.note ? '　' + item.note : ''));
      });
    }

    if (totalNew > 0) {
      lines.push('', '─── 🆕 快照無記錄的新 Key／新季度：' + totalNew + ' 項 ───',
        '　本工具沒有判斷，只列出來讓你自己確認是否需要人手處理。');
      result.config.newKeysInSheet.forEach(function (item) {
        lines.push('　' + item.key + '　現時「' + item.currentValue + '」');
      });
      result.quarters.newInSheet.forEach(function (item) {
        lines.push('　' + item.quarterId + '　GenerateOn「' + item.generateOn
          + '」　OfficialSendOn「' + item.officialSendOn + '」');
      });
    }

    const rows = [];
    result.config.mismatched.forEach(function (item) {
      rows.push(diagRow_('設定回復檢查', item.key, item.currentValue,
        '必須改回，上線值應為「' + item.targetValue + '」' + (item.note ? '　' + item.note : '')));
    });
    result.quarters.mismatched.forEach(function (item) {
      rows.push(diagRow_('設定回復檢查', item.quarterId,
        'GenerateOn=' + item.currentGenerateOn + '　OfficialSendOn=' + item.currentOfficialSendOn,
        '必須改回，應為 GenerateOn=' + item.targetGenerateOn + '　OfficialSendOn=' + item.targetOfficialSendOn));
    });
    result.config.unknownBaseline.forEach(function (item) {
      rows.push(diagRow_('設定回復檢查', item.key, item.currentValue,
        '未核實基準，要人眼核對（程式碼預設是「' + item.targetValue + '」）'));
    });
    rows.push(diagRow_('設定回復檢查', '（總覽）',
      '必須改回 ' + mismatchCount + '　未核實 ' + unknownCount + '　已符合 ' + matchedCount
        + '　新 Key／新季度 ' + totalNew, '快照日期：' + result.snapshotDate));
    tryWriteDiagnostics_('設定回復檢查', rows);
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

    ui.alert('設定回復檢查（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runConfigBaselineCheck_ 失敗: ' + err.message);
    ui.alert('設定回復檢查（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
