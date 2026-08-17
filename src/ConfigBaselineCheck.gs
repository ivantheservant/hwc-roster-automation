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
  (configRows || []).forEach(function (row) {
    const key = String(row[C.KEY] || '').trim();
    if (!key) return;
    currentByKey[key] = displayCellValue_(row[C.VALUE], '');
  });

  const configMismatched = [];
  const configMatched = [];
  const configNewKeysInSheet = [];

  Object.keys(snapshot.configKeys).forEach(function (key) {
    const def = snapshot.configKeys[key];
    if (def.dynamic) return;   // 動態值（例如 ROSTER_SPREADSHEET_ID）唔比對
    const hasRow = Object.prototype.hasOwnProperty.call(currentByKey, key);
    const current = hasRow ? currentByKey[key] : '';
    const target = def.launchTargetValue;
    const item = {
      key: key,
      currentValue: hasRow ? current : '（工作表沒有這一行，視同空白）',
      targetValue: target,
      source: def.source
    };
    if (current === target) {
      configMatched.push(item);
    } else {
      configMismatched.push(item);
    }
  });

  Object.keys(currentByKey).forEach(function (key) {
    if (!snapshot.configKeys[key]) {
      configNewKeysInSheet.push({ key: key, currentValue: currentByKey[key] });
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
    config: { mismatched: configMismatched, matched: configMatched, newKeysInSheet: configNewKeysInSheet },
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

    const totalMismatch = result.config.mismatched.length + result.quarters.mismatched.length;
    const totalNew = result.config.newKeysInSheet.length + result.quarters.newInSheet.length;

    const lines = [
      '快照日期：' + result.snapshotDate + '（docs/config_baseline_上線值.json）',
      '',
      '❌ 與上線目標值不符（必須改回）：' + totalMismatch + ' 項'
    ];
    result.config.mismatched.forEach(function (item) {
      lines.push('　' + item.key + '　現時「' + item.currentValue + '」　上線值應為「' + item.targetValue + '」'
        + (item.source.indexOf('未核實') !== -1 ? '　⚠ 上線值來自程式碼預設，未經 Ivan 核實' : ''));
    });
    result.quarters.mismatched.forEach(function (item) {
      lines.push('　' + item.quarterId + '　GenerateOn 現時「' + item.currentGenerateOn
        + '」應為「' + item.targetGenerateOn + '」　OfficialSendOn 現時「' + item.currentOfficialSendOn
        + '」應為「' + item.targetOfficialSendOn + '」');
    });

    lines.push('', '✅ 已符合：' + (result.config.matched.length + result.quarters.matched.length) + ' 項');

    lines.push('', '🆕 快照無記錄的新 Key／新季度：' + totalNew + ' 項'
      + '（本工具冇判斷，只列出來讓你自己確認是否需要人手處理）');
    result.config.newKeysInSheet.forEach(function (item) {
      lines.push('　' + item.key + '　現時「' + item.currentValue + '」');
    });
    result.quarters.newInSheet.forEach(function (item) {
      lines.push('　' + item.quarterId + '　GenerateOn「' + item.generateOn
        + '」　OfficialSendOn「' + item.officialSendOn + '」');
    });

    const rows = [];
    result.config.mismatched.forEach(function (item) {
      rows.push(diagRow_('設定回復檢查', item.key, item.currentValue,
        '不符，上線值應為「' + item.targetValue + '」（' + item.source + '）'));
    });
    result.quarters.mismatched.forEach(function (item) {
      rows.push(diagRow_('設定回復檢查', item.quarterId,
        'GenerateOn=' + item.currentGenerateOn + '　OfficialSendOn=' + item.currentOfficialSendOn,
        '不符，應為 GenerateOn=' + item.targetGenerateOn + '　OfficialSendOn=' + item.targetOfficialSendOn));
    });
    rows.push(diagRow_('設定回復檢查', '（總覽）',
      '不符 ' + totalMismatch + '　已符合 ' + (result.config.matched.length + result.quarters.matched.length)
        + '　新 Key／新季度 ' + totalNew, '快照日期：' + result.snapshotDate));
    tryWriteDiagnostics_('設定回復檢查', rows);
    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);

    ui.alert('設定回復檢查（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runConfigBaselineCheck_ 失敗: ' + err.message);
    ui.alert('設定回復檢查（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
