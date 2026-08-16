/**
 * 上線切換嚮導：把系統由「測試模式」切換到「真正寄信」，以及反向切回測試模式。
 *
 * 之前只有 `buildLaunchSequenceNotes_()`（`PreLaunchChecklist.gs`）——一份
 * 「建議你照呢個次序改」嘅唯讀清單，實際改值仍然要幹事自己去 Config 逐格打字。
 * 上線係整個系統風險最高嘅一次操作（改錯就係全體義工收到唔應該收嘅信），
 * 靠人手逐格改而冇任何檢查同確認，唔合理。
 *
 * ⚠️⚠️ 呢個檔案入面嘅執行函式係全專案少數會**真正改動 Config 值**嘅地方。
 * 開發過程從來冇執行過（見 `docs/系統範圍稽核.md`），第一次執行一定係
 * Ivan 自己喺真實試算表撳。
 *
 * ## 「中途取消唔會留低半套狀態」係點做到嘅
 *
 * Apps Script 冇真正嘅交易（transaction）：清空 `MAIL_SUBJECT_PREFIX` 同
 * 改 `DRY_RUN` 係兩次獨立寫入，第一次成功之後第二次失敗／被取消，技術上
 * 一定會留低「改咗一半」嘅狀態。所以呢度唔假裝做到原子性，改為做兩件事：
 *
 * 1. **每一段獨立確認、獨立生效**——每一段開始之前都會顯示「而家係咩、
 *    將會變成咩」，撳取消就即刻停，已經完成嘅段落保持已完成。
 * 2. **「完成到邊一段」係即場由 Config 真實值計出嚟，唔係靠記低嘅進度旗標**
 *    （見 `assessGoLiveState_()`）。呢點好重要：進度旗標本身可能同真實狀態
 *    脫節（例如幹事自己手動改咗其中一格），而直接讀 Config 就一定係真相。
 *    所以「改咗一半」呢個狀態永遠係**睇得到、講得出、可以接住做落去**嘅，
 *    唔會出現「唔知做到邊」。
 *
 * ## 段落次序係刻意咁排嘅
 *
 * - **上線**：先清空主旨前綴，最後先改 `DRY_RUN=FALSE`。風險最高嗰一步排最後，
 *   前面任何一步取消都唔會有信寄出。
 * - **回退**：先改 `DRY_RUN=TRUE`，之後先還原前綴。要即刻止血，唔可以等。
 */

/** 上線切換要求逐字輸入嘅確認文字。 */
const GO_LIVE_CONFIRM_TEXT = '確認上線';

/** 回退到測試模式要求逐字輸入嘅確認文字。 */
const GO_LIVE_ROLLBACK_CONFIRM_TEXT = '確認回退';

/** 回退時要放返落 MAIL_SUBJECT_PREFIX 嘅預設測試前綴。 */
const GO_LIVE_TEST_SUBJECT_PREFIX = '[測試] ';

/**
 * 讀取目前嘅上線狀態。**完全由 Config 嘅真實值計出嚟**，唔靠任何記低嘅進度。
 * @returns {{dryRun: boolean, subjectPrefix: string, prefixCleared: boolean,
 *   dryRunOff: boolean, phase: string, description: string}}
 */
function assessGoLiveState_() {
  const config = readConfig();
  const dryRun = describeConfigValue_(config, CONFIG_KEYS.DRY_RUN, true).value !== false;
  const subjectPrefix = String(describeConfigValue_(config, CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '').value || '');

  const prefixCleared = subjectPrefix.trim() === '';
  const dryRunOff = dryRun === false;

  let phase;
  let description;
  if (dryRunOff && prefixCleared) {
    phase = 'LIVE';
    description = '已完全上線：會真正寄出電郵，主旨冇測試前綴。';
  } else if (!dryRunOff && !prefixCleared) {
    phase = 'TEST';
    description = '測試模式：唔會真正寄出電郵，主旨有前綴「' + subjectPrefix + '」。';
  } else if (dryRunOff && !prefixCleared) {
    phase = 'HALF_LIVE_WITH_PREFIX';
    description = '⚠️ 改咗一半：已經會**真正寄出**電郵，但主旨仍然有測試前綴「'
      + subjectPrefix + '」——收件人會收到真信，但標題掛住測試字樣。';
  } else {
    phase = 'HALF_PREFIX_CLEARED';
    description = '改咗一半：主旨前綴已清空，但仍然係測試模式（唔會真正寄出）。'
      + '呢個狀態係安全嘅，繼續行落去或者停喺度都得。';
  }

  return {
    dryRun: dryRun,
    subjectPrefix: subjectPrefix,
    prefixCleared: prefixCleared,
    dryRunOff: dryRunOff,
    phase: phase,
    description: description
  };
}

/**
 * 改寫 Config 工作表其中一個 Key 嘅 Value 欄。
 *
 * 刻意**只改既有嘅行，搵唔到就拋錯**，唔會自動新增——上線切換唔應該順手
 * 建立新設定。要新增 Key 請用「維護 ▸ 補建 Config 參數」。
 *
 * 改完即刻清 Config 快取（`readConfig()` 有 5 分鐘 CacheService 快取），
 * 否則之後嘅檢查會讀返舊值，令幹事以為冇改到。
 *
 * @param {string} key Config 嘅 Key
 * @param {string} value 新值
 * @param {string} source 寫入 AuditLog 嘅來源函式名
 * @returns {{key: string, oldValue: string, newValue: string}} 改動前後嘅值
 */
function setConfigValue_(key, value, source) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (!sheet) throw new Error('搵唔到工作表: ' + SHEETS.CONFIG);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const C = COLUMNS.CONFIG;

  const keyCol = headers.indexOf(C.KEY) + 1;
  const valueCol = headers.indexOf(C.VALUE) + 1;
  const updatedAtCol = headers.indexOf(C.UPDATED_AT) + 1;
  const updatedByCol = headers.indexOf(C.UPDATED_BY) + 1;
  if (keyCol === 0 || valueCol === 0) {
    throw new Error('Config 工作表搵唔到 ' + C.KEY + ' 或 ' + C.VALUE + ' 欄，無法安全改值。');
  }

  const keys = lastRow >= 3 ? sheet.getRange(3, keyCol, lastRow - 2, 1).getValues() : [];
  let targetRow = -1;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0] || '').trim() === key) { targetRow = i + 3; break; }
  }
  if (targetRow === -1) {
    throw new Error('Config 工作表冇 ' + key + ' 呢一行。'
      + '請先執行「維護 ▸ 補建 Config 參數」，上線切換唔會自動新增設定行。');
  }

  const oldValue = String(sheet.getRange(targetRow, valueCol).getValue() || '');
  sheet.getRange(targetRow, valueCol).setValue(value);
  const now = nowTimestamp_();
  const actor = Session.getActiveUser().getEmail();
  if (updatedAtCol > 0) sheet.getRange(targetRow, updatedAtCol).setValue(now);
  if (updatedByCol > 0) sheet.getRange(targetRow, updatedByCol).setValue(actor);

  reloadConfigCache();

  writeAuditLog_({
    action: '上線切換：改 Config',
    targetSheet: SHEETS.CONFIG,
    targetKey: key,
    oldValue: oldValue,
    newValue: String(value),
    source: source,
    notes: '由上線切換嚮導改動，改完已清 Config 快取'
  });

  return { key: key, oldValue: oldValue, newValue: String(value) };
}

/**
 * 上線前置檢查：跑一次全面體檢，有「必須處理」項目就拒絕繼續。
 * @param {string} quarterId 要一併檢查嘅季度（可留空）
 * @returns {{ok: boolean, mustCount: number, shouldCount: number, mustItems: Object[]}}
 */
function checkGoLiveReadiness_(quarterId) {
  const report = buildFullHealthCheckReport_(quarterId);
  const mustItems = report.sections.filter(function (s) {
    return s.severity === HEALTH_SEVERITY.MUST;
  });
  return {
    ok: mustItems.length === 0,
    mustCount: report.mustCount,
    shouldCount: report.shouldCount,
    mustItems: mustItems
  };
}

/**
 * 選單項目「⚠️⚠️ 上線切換嚮導（會令系統真正寄信）」嘅執行入口。
 * @returns {void}
 */
function runGoLiveWizard_() {
  const ui = SpreadsheetApp.getUi();
  const title = '⚠️⚠️ 上線切換嚮導';

  // ---- 第 0 段：顯示現況 ----
  const before = assessGoLiveState_();
  if (before.phase === 'LIVE') {
    ui.alert(title,
      '系統已經完全上線，唔需要再切換。\n\n' + before.description
        + '\n\n如果想切返測試模式，請用「⚠️ 回退到測試模式」。',
      ui.ButtonSet.OK);
    return;
  }

  const intro = [
    '目前狀態：' + before.description,
    '',
    '呢個嚮導會分兩段改動 Config，每一段都會另外問你一次：',
    '　第 1 段：清空 ' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX
      + '（目前「' + (before.subjectPrefix || '（已經係空白）') + '」）',
    '　第 2 段：' + CONFIG_KEYS.DRY_RUN + ' 改為 FALSE（呢一段要打字確認）',
    '',
    '⚠️ 第 2 段完成之後，系統就會真正寄出電郵給義工。',
    '',
    '開始之前會先跑一次全面體檢；如果有「必須處理」嘅項目，會拒絕繼續。',
    '',
    '中途隨時可以撳取消——已經完成嘅段落會保持完成，',
    '再入返嚟嗰陣會顯示而家做到邊一段，可以接住做落去。',
    '',
    '要開始嗎？'
  ].join('\n');
  if (ui.alert(title, intro, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // ---- 第 1 段之前：全面體檢把關 ----
  const quarterResponse = ui.prompt(title,
    '體檢要檢查邊一個季度？輸入 QuarterID（留空 = 只做唔需要季度嘅檢查）：',
    ui.ButtonSet.OK_CANCEL);
  if (quarterResponse.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = normalizeIdInput_(quarterResponse.getResponseText());

  let readiness;
  try {
    readiness = checkGoLiveReadiness_(quarterId);
  } catch (err) {
    log_('ERROR', 'runGoLiveWizard_ 體檢失敗: ' + err.message);
    ui.alert(title, '全面體檢執行失敗，為安全起見唔會繼續：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (!readiness.ok) {
    const lines = ['全面體檢搵到 ' + readiness.mustCount + ' 項「必須處理」，唔會繼續上線切換。', ''];
    readiness.mustItems.slice(0, 10).forEach(function (item) {
      lines.push('🔴 ' + item.section + '：' + item.label);
      lines.push('　　' + item.summary);
    });
    if (readiness.mustItems.length > 10) {
      lines.push('　……另有 ' + (readiness.mustItems.length - 10) + ' 項');
    }
    lines.push('', '請先處理以上項目，再重新執行呢個嚮導。');
    lines.push('（可以用「維護 ▸ 🩺 全面體檢（唯讀）」睇完整報告）');
    ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
    return;
  }

  const completed = [];

  // ---- 第 1 段：清空主旨前綴 ----
  if (!before.prefixCleared) {
    const seg1 = [
      '第 1 段／共 2 段：清空主旨前綴',
      '',
      '　' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX,
      '　現在：「' + before.subjectPrefix + '」',
      '　改成：（空白）',
      '',
      '影響：之後寄出嘅電郵主旨唔會再有測試字樣。',
      '呢一段本身唔會令系統寄出任何信（' + CONFIG_KEYS.DRY_RUN + ' 仍然係 TRUE）。',
      '',
      '確定改嗎？'
    ].join('\n');
    if (ui.alert(title, seg1, ui.ButtonSet.YES_NO) !== ui.Button.YES) {
      ui.alert(title, '已取消，冇改動任何嘢。目前狀態不變：\n\n' + before.description, ui.ButtonSet.OK);
      return;
    }
    try {
      const r = setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '', 'runGoLiveWizard_');
      completed.push('第 1 段：' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '「' + r.oldValue + '」→（空白）');
    } catch (err) {
      log_('ERROR', 'runGoLiveWizard_ 第 1 段失敗: ' + err.message);
      ui.alert(title, '第 1 段失敗，冇改動任何嘢：\n\n' + err.message, ui.ButtonSet.OK);
      return;
    }
  } else {
    completed.push('第 1 段：主旨前綴本來已經係空白，唔使改');
  }

  // ---- 第 2 段：DRY_RUN → FALSE（打字確認）----
  const seg2 = [
    '第 2 段／共 2 段：' + CONFIG_KEYS.DRY_RUN + ' 改為 FALSE',
    '',
    '⚠️⚠️ 呢一段一完成，系統就會**真正寄出電郵**。',
    '之後任何一次「步驟 2／4／5」或者補寄，收件人都會真係收到信。',
    '',
    '已完成：',
    '　' + completed.join('\n　'),
    '',
    '如果確定，請喺下面逐字輸入：' + GO_LIVE_CONFIRM_TEXT
  ].join('\n');
  const confirmResponse = ui.prompt(title, seg2, ui.ButtonSet.OK_CANCEL);
  if (confirmResponse.getSelectedButton() !== ui.Button.OK
    || confirmResponse.getResponseText().trim() !== GO_LIVE_CONFIRM_TEXT) {
    const mid = assessGoLiveState_();
    ui.alert(title,
      '已取消，' + CONFIG_KEYS.DRY_RUN + ' 維持 TRUE（唔會寄出任何信）。\n\n'
        + '已完成：\n　' + completed.join('\n　')
        + '\n\n目前狀態：' + mid.description
        + '\n\n想繼續嘅話，隨時再執行一次呢個嚮導，佢會由未完成嗰一段接住做。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    const r = setConfigValue_(CONFIG_KEYS.DRY_RUN, 'FALSE', 'runGoLiveWizard_');
    completed.push('第 2 段：' + CONFIG_KEYS.DRY_RUN + '「' + r.oldValue + '」→ FALSE');
  } catch (err) {
    log_('ERROR', 'runGoLiveWizard_ 第 2 段失敗: ' + err.message);
    const mid = assessGoLiveState_();
    ui.alert(title,
      '第 2 段失敗：\n\n' + err.message
        + '\n\n已完成：\n　' + completed.join('\n　')
        + '\n\n目前狀態：' + mid.description,
      ui.ButtonSet.OK);
    return;
  }

  // ---- 完成後：再跑一次體檢確認狀態 ----
  const after = assessGoLiveState_();
  let postCheckText;
  try {
    const post = checkGoLiveReadiness_(quarterId);
    postCheckText = post.ok
      ? '✅ 完成後體檢：冇「必須處理」項目（建議處理 ' + post.shouldCount + ' 項）'
      : '⚠️ 完成後體檢：出現 ' + post.mustCount + ' 項「必須處理」，請即刻用'
        + '「維護 ▸ 🩺 全面體檢（唯讀）」睇詳情';
  } catch (err) {
    postCheckText = '⚠️ 完成後體檢執行失敗：' + err.message;
  }

  writeAuditLog_({
    action: '上線切換完成',
    targetSheet: SHEETS.CONFIG,
    targetKey: quarterId || '（未指定季度）',
    newValue: 'DRY_RUN=FALSE，主旨前綴已清空',
    source: 'runGoLiveWizard_',
    notes: completed.join('；')
  });

  ui.alert(title, [
    '✅ 上線切換完成。',
    '',
    '已完成：',
    '　' + completed.join('\n　'),
    '',
    '目前狀態：' + after.description,
    '',
    postCheckText,
    '',
    '⚠️ 由而家開始，「步驟 2／4／5」同補寄都會真正寄出電郵。',
    '如果發現有問題要即刻止血，請用「⚠️ 回退到測試模式」。'
  ].join('\n'), ui.ButtonSet.OK);
}

/**
 * 選單項目「⚠️ 回退到測試模式」嘅執行入口（D3）。
 *
 * 上線之後發現有問題要即刻停，呢個係唯一應該撳嘅掣。次序同上線相反：
 * **先改 `DRY_RUN=TRUE` 止血，之後先還原主旨前綴**——止血唔可以等。
 * @returns {void}
 */
function runGoLiveRollback_() {
  const ui = SpreadsheetApp.getUi();
  const title = '⚠️ 回退到測試模式';

  const before = assessGoLiveState_();
  if (before.phase === 'TEST') {
    ui.alert(title,
      '系統已經係測試模式，唔需要回退。\n\n' + before.description, ui.ButtonSet.OK);
    return;
  }

  const prefixResponse = ui.prompt(title, [
    '目前狀態：' + before.description,
    '',
    '呢個嚮導會分兩段改返 Config：',
    '　第 1 段：' + CONFIG_KEYS.DRY_RUN + ' 改為 TRUE（即刻停止真正寄信）',
    '　第 2 段：' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX + ' 放返測試前綴',
    '',
    '次序同上線相反係刻意嘅：先止血，之後先還原前綴。',
    '',
    '要放返嘅前綴（留空 = 用預設「' + GO_LIVE_TEST_SUBJECT_PREFIX + '」）：'
  ].join('\n'), ui.ButtonSet.OK_CANCEL);
  if (prefixResponse.getSelectedButton() !== ui.Button.OK) return;
  const prefixText = prefixResponse.getResponseText();
  const newPrefix = prefixText.trim() === '' ? GO_LIVE_TEST_SUBJECT_PREFIX : prefixText;

  const confirmResponse = ui.prompt(title, [
    '確認回退到測試模式：',
    '',
    '　' + CONFIG_KEYS.DRY_RUN + '：' + (before.dryRun ? 'TRUE' : 'FALSE') + ' → TRUE',
    '　' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '：「' + before.subjectPrefix + '」→「' + newPrefix + '」',
    '',
    '回退之後系統唔會再寄出任何真實電郵。',
    '（已經寄出咗嘅信收唔返，呢個掣只係阻止之後再寄。）',
    '',
    '請逐字輸入：' + GO_LIVE_ROLLBACK_CONFIRM_TEXT
  ].join('\n'), ui.ButtonSet.OK_CANCEL);
  if (confirmResponse.getSelectedButton() !== ui.Button.OK
    || confirmResponse.getResponseText().trim() !== GO_LIVE_ROLLBACK_CONFIRM_TEXT) {
    ui.alert(title, '已取消，冇改動任何嘢。目前狀態不變：\n\n' + before.description, ui.ButtonSet.OK);
    return;
  }

  const completed = [];

  // ---- 第 1 段：止血 ----
  try {
    const r = setConfigValue_(CONFIG_KEYS.DRY_RUN, 'TRUE', 'runGoLiveRollback_');
    completed.push('第 1 段：' + CONFIG_KEYS.DRY_RUN + '「' + r.oldValue + '」→ TRUE（已停止真正寄信）');
  } catch (err) {
    log_('ERROR', 'runGoLiveRollback_ 第 1 段失敗: ' + err.message);
    ui.alert(title,
      '⚠️ 第 1 段失敗，系統可能仍然會真正寄信：\n\n' + err.message
        + '\n\n請即刻自己去 Config 工作表，人手將 ' + CONFIG_KEYS.DRY_RUN + ' 改成 TRUE。',
      ui.ButtonSet.OK);
    return;
  }

  // ---- 第 2 段：還原前綴 ----
  try {
    const r = setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, newPrefix, 'runGoLiveRollback_');
    completed.push('第 2 段：' + CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '「' + r.oldValue + '」→「' + newPrefix + '」');
  } catch (err) {
    log_('ERROR', 'runGoLiveRollback_ 第 2 段失敗: ' + err.message);
    const mid = assessGoLiveState_();
    ui.alert(title,
      '第 1 段已成功（已經停止寄信，最重要嗰步做咗），但第 2 段失敗：\n\n' + err.message
        + '\n\n目前狀態：' + mid.description
        + '\n\n主旨前綴可以遲啲再改，唔急——系統而家已經唔會寄出任何真實電郵。',
      ui.ButtonSet.OK);
    return;
  }

  const after = assessGoLiveState_();
  writeAuditLog_({
    action: '回退到測試模式',
    targetSheet: SHEETS.CONFIG,
    targetKey: '（全系統）',
    newValue: 'DRY_RUN=TRUE，主旨前綴＝' + newPrefix,
    source: 'runGoLiveRollback_',
    notes: completed.join('；')
  });

  ui.alert(title, [
    '✅ 已回退到測試模式。',
    '',
    '已完成：',
    '　' + completed.join('\n　'),
    '',
    '目前狀態：' + after.description,
    '',
    '之後任何寄送操作都只會寫 SendLog（Status=DRY_RUN），唔會真正寄出。'
  ].join('\n'), ui.ButtonSet.OK);
}

/**
 * 選單項目「上線狀態（唯讀）」嘅執行入口：只顯示現況，唔改任何嘢。
 * 中途取消之後想知「而家做到邊」，撳呢個就得。
 * @returns {void}
 */
function runGoLiveStatus_() {
  const ui = SpreadsheetApp.getUi();
  const state = assessGoLiveState_();

  const lines = [
    '目前狀態：' + state.description,
    '',
    CONFIG_KEYS.DRY_RUN + '　＝　' + (state.dryRun ? 'TRUE（唔會真正寄出）' : 'FALSE（會真正寄出）'),
    CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '　＝　'
      + (state.subjectPrefix === '' ? '（空白）' : '「' + state.subjectPrefix + '」'),
    ''
  ];

  if (state.phase === 'TEST') {
    lines.push('下一步：想上線就用「⚠️⚠️ 上線切換嚮導」。');
  } else if (state.phase === 'LIVE') {
    lines.push('下一步：已經完全上線，唔使做嘢。發現問題要止血就用「⚠️ 回退到測試模式」。');
  } else if (state.phase === 'HALF_PREFIX_CLEARED') {
    lines.push('下一步：主旨前綴已清空，仲差最後一步（' + CONFIG_KEYS.DRY_RUN + ' → FALSE）。');
    lines.push('再執行一次「⚠️⚠️ 上線切換嚮導」就會由呢一段接住做。');
    lines.push('停喺呢個狀態係安全嘅——系統仍然唔會寄出任何真實電郵。');
  } else {
    lines.push('⚠️ 下一步：而家已經會真正寄信，但主旨仲掛住測試前綴。');
    lines.push('收件人會收到真信、標題卻寫住測試字樣，應該盡快處理：');
    lines.push('　• 想繼續上線 → 執行「⚠️⚠️ 上線切換嚮導」清空前綴；');
    lines.push('　• 想返去測試 → 執行「⚠️ 回退到測試模式」。');
  }

  lines.push('');
  lines.push('（呢個檢視完全唯讀，唔會改動任何設定。）');

  ui.alert('上線狀態（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}
