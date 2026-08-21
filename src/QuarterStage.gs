/**
 * 四階段流程的狀態機：Quarters.Stage 只能依 QUARTER_STAGE_ORDER 的順序前進，不可倒退
 * （REQUESTS_APPLIED 例外，可以重複停留，因為步驟 3「套用修改申報」容許執行多次）。
 *
 * Stage 只可由 FourStageFlow.gs 的四個步驟函式呼叫 advanceQuarterStage_() 改動，
 * 這個檔案本身與其他任何地方都只讀不寫——這是專案慣例（跟「ScriptApp.newTrigger()
 * 只能在 installAutomationTrigger() 呼叫」同一種以註解＋紀律把關的做法，不是語言層級強制）。
 */

/**
 * 在 Quarters 找出指定季度所在的實際列號與目前各欄的值。
 * @param {string} quarterId 季度 ID
 * @returns {?{sheetRow: number, headers: string[], values: Object}} 找不到時回傳 null
 */
function findQuarterRowInfo_(quarterId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) return null;

  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const quarterCol = headers.indexOf(COLUMNS.QUARTERS.QUARTER_ID);
  if (quarterCol === -1) throw new Error('Quarters 缺少 QuarterID 欄');

  for (let i = 0; i < values.length; i++) {
    if (values[i][quarterCol] === quarterId) {
      const record = {};
      headers.forEach(function (h, idx) { record[h] = values[i][idx]; });
      return { sheetRow: i + 3, headers: headers, values: record };
    }
  }
  return null;
}

/**
 * 讀取指定季度目前的 Stage。Stage 欄不存在、值空白，或值不是 QUARTER_STAGE 的合法值時，
 * 一律當作 DRAFT（對應規格「要求 Stage = DRAFT 或不存在」的判斷）。
 * @param {string} quarterId 季度 ID
 * @returns {string} QUARTER_STAGE 其中一個值
 */
function getQuarterStage_(quarterId) {
  const info = findQuarterRowInfo_(quarterId);
  if (!info) throw new Error('Quarters 找不到季度: ' + quarterId);
  const stage = String(info.values[COLUMNS.QUARTERS.STAGE] || '').trim().toUpperCase();
  return QUARTER_STAGE_ORDER.indexOf(stage) !== -1 ? stage : QUARTER_STAGE.DRAFT;
}

/**
 * 檢查季度目前的 Stage 是否在允許清單內；不符就拋錯，訊息講明目前 Stage 與需要的 Stage。
 * 供四個步驟函式在執行任何動作之前呼叫。
 * @param {string} quarterId 季度 ID
 * @param {string[]} allowedStages 允許執行的 Stage 清單
 * @param {string} stepName 步驟名稱，用於錯誤訊息（例如「寄給堂委審閱」）
 * @returns {string} 目前的 Stage，呼叫端可直接沿用，不需要再讀一次
 */
function requireQuarterStage_(quarterId, allowedStages, stepName) {
  const current = getQuarterStage_(quarterId);
  if (allowedStages.indexOf(current) === -1) {
    throw new Error(
      '「' + stepName + '」需要 ' + quarterId + ' 的 Stage 為「' + allowedStages.join(' 或 ') + '」，'
        + '但目前的 Stage 是「' + current + '」。'
    );
  }
  return current;
}

/**
 * 把季度的 Stage 改成新值，並更新 StageUpdatedAt。
 * 只可由 FourStageFlow.gs 的四個步驟函式呼叫，其他地方不可寫入 Stage。
 * @param {string} quarterId 季度 ID
 * @param {string} newStage QUARTER_STAGE 其中一個值
 * @returns {void}
 */
function advanceQuarterStage_(quarterId, newStage) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const info = findQuarterRowInfo_(quarterId);
  if (!info) throw new Error('Quarters 找不到季度: ' + quarterId);

  const stageCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE) + 1;
  if (stageCol === 0) throw new Error('Quarters 缺少 Stage 欄，請先執行「補建 Quarters 欄位」');

  const oldStage = String(info.values[COLUMNS.QUARTERS.STAGE] || '').trim() || QUARTER_STAGE.DRAFT;
  sheet.getRange(info.sheetRow, stageCol).setValue(newStage);

  const stageAtCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE_UPDATED_AT) + 1;
  if (stageAtCol > 0) {
    sheet.getRange(info.sheetRow, stageAtCol).setValue(nowTimestamp_());
    applyTimestampFormat_(sheet, info.headers, [COLUMNS.QUARTERS.STAGE_UPDATED_AT], info.sheetRow, 1);
  }

  // 階段 F 新增：這是全專案唯一會真正改動 Stage 的地方，Stage 變更本身
  // 對稽核來說是最重要的事件之一，之前完全沒有寫入 AuditLog。
  writeAuditLog_({
    action: 'Stage 前進',
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    oldValue: oldStage,
    newValue: newStage,
    source: 'advanceQuarterStage_'
  });
}

/**
 * 第二十三輪批次階段 E1：**明確設定** Stage，包括合法嘅「退回」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解唔直接用 advanceQuarterStage_()
 * ─────────────────────────────────────────────────────────────────────
 *
 * `advanceQuarterStage_()` 技術上冇禁止倒退（佢只係 setValue），
 * 所以「用得到」——但佢寫入 `AuditLog` 嘅 action 係寫死嘅**「Stage 前進」**。
 * 由 `REQUESTS_APPLIED` 撳掣 2（第二輪審閱，決定 D2）令 Stage 退回
 * `REVIEW_SENT`，如果用嗰個函式，稽核紀錄就會出現一行
 * 「Stage 前進：REQUESTS_APPLIED → REVIEW_SENT」——**紀錄本身講咗大話。**
 *
 * 稽核紀錄講錯嘢，比冇紀錄更差：日後查「點解呢一季退返去審閱」嗰陣，
 * 讀嘅人會以為系統壞咗，而唔係「有人有意噉做」。
 *
 * 所以分開一個函式，`AuditLog` 誠實記錄方向同原因。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} newStage 要設定嘅 Stage
 * @param {string} reason 點解要噉設（會寫入 AuditLog 嘅 Notes）
 * @returns {{oldStage: string, newStage: string, movedBackwards: boolean}}
 */
function setQuarterStage_(quarterId, newStage, reason) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const info = findQuarterRowInfo_(quarterId);
  if (!info) throw new Error('Quarters 找不到季度: ' + quarterId);

  const stageCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE) + 1;
  if (stageCol === 0) throw new Error('Quarters 缺少 Stage 欄，請先執行「補建 Quarters 欄位」');

  const oldStage = String(info.values[COLUMNS.QUARTERS.STAGE] || '').trim() || QUARTER_STAGE.DRAFT;
  const oldIndex = QUARTER_STAGE_ORDER.indexOf(oldStage);
  const newIndex = QUARTER_STAGE_ORDER.indexOf(newStage);
  const movedBackwards = oldIndex >= 0 && newIndex >= 0 && newIndex < oldIndex;

  sheet.getRange(info.sheetRow, stageCol).setValue(newStage);

  const stageAtCol = info.headers.indexOf(COLUMNS.QUARTERS.STAGE_UPDATED_AT) + 1;
  if (stageAtCol > 0) {
    sheet.getRange(info.sheetRow, stageAtCol).setValue(nowTimestamp_());
    applyTimestampFormat_(sheet, info.headers, [COLUMNS.QUARTERS.STAGE_UPDATED_AT], info.sheetRow, 1);
  }

  writeAuditLog_({
    action: movedBackwards ? 'Stage 退回（有意）' : 'Stage 設定',
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    oldValue: oldStage,
    newValue: newStage,
    source: 'setQuarterStage_',
    notes: reason || ''
  });

  return { oldStage: oldStage, newStage: newStage, movedBackwards: movedBackwards };
}

/* ============================================================
 * 選單「計算季度日期」——追加階段 S 新增
 * ============================================================
 * 背景：追加階段 S 查證發現，全專案沒有任何函式會寫入 Quarters 的
 * GenerateOn／OfficialSendOn（RemindOn 追加階段 Q 已確認是死欄位，這裡不處理）。
 * 新增一季時，這兩欄如果只填 QuarterID／Year／Term／StartDate／EndDate／WeekCount，
 * 會維持空白——GenerateOn 空白時，Trigger.gs 的 computeAutomationSchedule_() 會在
 * 判斷「今天要不要自動生成初稿」的當下即時按 LEAD_DAYS_GENERATE 從 StartDate 推算
 * （不會寫回這一欄，所以格子本身看起來仍然空白，這是預期行為，不是 bug）；但
 * OfficialSendOn 空白時，Mailer.gs 的 buildMailContext_() 沒有這種即時推算的後備
 * 機制，會直接讀到空白，令 GENERATE／REMIND 範本的 {OfficialSendDate} placeholder
 * 在信件內文顯示空白——這是一個真實會影響信件內容的缺口，所以新增這個工具。
 */

/**
 * 第四十四輪批次 G 組：由 StartDate ＋ 前置日數算出一個季度日期。
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ 這一條算式本來抄了三份
 * ═════════════════════════════════════════════════════════════════════
 *
 * 同一句 `isNaN(lead) ? '' : applyWeekdayGuard_(shiftDateString_(…), guard)`
 * 本來散在三個地方：`NewQuarterWizard.gs`、`planComputeQuarterDates_()`、
 * 還有 `Trigger.gs` 的即時推算。三份之中改一份，另外兩份就會靜靜地
 * 算出另一個日期——而「自動排程今天會不會跑」正正靠這個值。
 *
 * 所以收成一句。年度工具（本輪新接上）是第四個呼叫端，
 * 再抄一份就一定會走樣。
 *
 * @param {string} startDate 季度開始日 yyyy-MM-dd
 * @param {number} leadDays 前置日數（負數＝開季之前）
 * @param {string} guardMode SEND_WEEKDAY_GUARD
 * @returns {string} 算出的日期；算不出（lead days 未設定）回空字串
 */
function computeQuarterDateFromLead_(startDate, leadDays, guardMode) {
  // ⚠️ `Number(null)` 同 `Number('')` 都係 **0**，唔係 NaN。
  // 淨靠 `isNaN()` 擋，「未設定」就會變成「提早 0 日」＝ 開季當日，
  // 即係「到咗先生成」——而幹事要嘅係提早 35 日。
  // 呢個係一個睇落好合理、而且完全唔會有人察覺嘅錯日期。
  if (leadDays === null || leadDays === undefined || leadDays === '') return '';
  const lead = Number(leadDays);
  if (!startDate || isNaN(lead)) return '';
  return applyWeekdayGuard_(shiftDateString_(startDate, lead), guardMode);
}

/**
 * 第四十四輪批次 G 組：算季度日期要用嘅那幾個 Config 值，讀一次。
 *
 * ⚠️ **不可以在算不出的時候悄悄當成 0。** `LEAD_DAYS_GENERATE` 沒有填
 * 而當成 0，`GenerateOn` 就會變成開季當日——即係「到咗先生成」，
 * 而幹事本來要的是提早 35 天。回 `null` 並且在畫面上明講算不出，
 * 比一個看起來合理的錯日期好。
 *
 * @returns {{leadGenerate: ?number, leadOfficial: ?number, guardMode: string}}
 */
function readQuarterDateSettings_() {
  const config = readConfig();
  const g = Number(config[CONFIG_KEYS.LEAD_DAYS_GENERATE]);
  const o = Number(config[CONFIG_KEYS.LEAD_DAYS_OFFICIAL]);
  return {
    leadGenerate: isNaN(g) ? null : g,
    leadOfficial: isNaN(o) ? null : o,
    guardMode: String(config[CONFIG_KEYS.SEND_WEEKDAY_GUARD] || 'NONE').toUpperCase()
  };
}

/**
 * 計算指定季度的 GenerateOn／OfficialSendOn（只讀，不寫入）：按 StartDate 加上
 * Config 的 LEAD_DAYS_GENERATE／LEAD_DAYS_OFFICIAL 天數，再套用 SEND_WEEKDAY_GUARD，
 * 跟 Trigger.gs 的 computeAutomationSchedule_() 用同一套 shiftDateString_()／
 * applyWeekdayGuard_()，保證這裡算出來的值跟自動排程實際會用到的值一致。
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, sheetRow: number, startDate: string, fields: Object[]}}
 *   fields 每項為 {key, label, columnIndex, currentValue, computedValue, leadDays}
 */
function planComputeQuarterDates_(quarterId) {
  const info = findQuarterRowInfo_(quarterId);
  if (!info) throw new Error('Quarters 找不到季度: ' + quarterId);

  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const guardMode = String(config[CONFIG_KEYS.SEND_WEEKDAY_GUARD] || 'NONE').toUpperCase();
  const startDate = toDateString(info.values[COLUMNS.QUARTERS.START_DATE], timezone);
  if (!startDate) throw new Error(quarterId + ' 的 StartDate 是空白，無法計算');

  const defs = [
    { key: COLUMNS.QUARTERS.GENERATE_ON, label: 'GenerateOn', leadDaysKey: CONFIG_KEYS.LEAD_DAYS_GENERATE },
    { key: COLUMNS.QUARTERS.OFFICIAL_SEND_ON, label: 'OfficialSendOn', leadDaysKey: CONFIG_KEYS.LEAD_DAYS_OFFICIAL }
  ];

  const fields = defs.map(function (def) {
    const columnIndex = info.headers.indexOf(def.key) + 1;
    const currentValue = toDateString(info.values[def.key], timezone);
    const leadDays = Number(config[def.leadDaysKey]);
    const computedValue = computeQuarterDateFromLead_(startDate, leadDays, guardMode);
    return {
      key: def.key, label: def.label, columnIndex: columnIndex,
      currentValue: currentValue, computedValue: computedValue,
      leadDays: isNaN(leadDays) ? null : leadDays
    };
  });

  return { quarterId: quarterId, sheetRow: info.sheetRow, startDate: startDate, fields: fields };
}

/**
 * 第四十四輪批次 G 組：**列出所有仍然欠日期的季度。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要有
 * ═════════════════════════════════════════════════════════════════════
 *
 * 年度工具由本輪開始會自己算好兩個日期，但**以前用佢開嘅季度冇**——
 * Ivan 手上 2028T1～T4 就係噉樣，四季全部空白。
 *
 * 而原本嗰個「計算季度日期」一次只做一季，要輸入 `QuarterID`。
 * 四季即係做四次，每次都要記得個 ID 點串。做少一次就會有一季
 * 喺主流程一直顯示「這一季的 Quarters 沒有填生成日期」。
 *
 * ⚠️ 呢度**只列出真係欠嘅**（兩格入面至少一格空白）。
 * 把已經有值嘅都列返出嚟，就會令幹事以為要全部重算，
 * 而重算會蓋走佢人手改過嘅日期。
 *
 * @returns {Object[]} 每項 {quarterId, startDate, missingGenerateOn, missingOfficialSendOn}
 */
function listQuartersMissingDates_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) return [];

  const config = readConfig();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const Q = COLUMNS.QUARTERS;
  const idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });

  const out = [];
  values.forEach(function (row) {
    const quarterId = String(row[idx[Q.QUARTER_ID]] || '').trim();
    if (!quarterId) return;
    const startDate = toDateString(row[idx[Q.START_DATE]], timezone);
    const g = idx[Q.GENERATE_ON] === undefined
      ? '' : toDateString(row[idx[Q.GENERATE_ON]], timezone);
    const o = idx[Q.OFFICIAL_SEND_ON] === undefined
      ? '' : toDateString(row[idx[Q.OFFICIAL_SEND_ON]], timezone);
    if (g && o) return;
    out.push({
      quarterId: quarterId,
      startDate: startDate,
      missingGenerateOn: !g,
      missingOfficialSendOn: !o
    });
  });
  return out;
}

/**
 * 依 planComputeQuarterDates_() 的計畫，把算出的日期寫入 Quarters。
 * @param {Object} plan planComputeQuarterDates_() 的結果
 * @param {boolean} overwriteExisting true＝已有值的格也覆寫成算出值；false＝只填目前空白的格，
 *   已有值的格保留原值不動
 * @returns {number} 實際寫入的格數
 */
function writeQuarterDates_(plan, overwriteExisting) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  let written = 0;
  plan.fields.forEach(function (f) {
    if (f.columnIndex === 0) return; // 欄不存在（例如已被人手刪除），略過
    if (!f.computedValue) return; // 算不出值（Config 的 LEAD_DAYS_* 未設定），略過
    if (f.currentValue && !overwriteExisting) return; // 已有值且選擇不覆寫，略過
    sheet.getRange(plan.sheetRow, f.columnIndex).setValue(f.computedValue);
    written++;
  });
  return written;
}

/* ============================================================
 * 選單「補建 Quarters 欄位」：手法與 ConfigSeed.gs／PostSeed.gs 一致。
 * ============================================================ */

/**
 * 檢查 Quarters 是否已有 Stage／StageUpdatedAt 欄，算出要新增的欄與要補的預設值
 * （現有季度、Stage 空白者一律預設 DRAFT）。只讀，不寫入。
 * @returns {{missingColumns: string[], columnIndexes: Object.<string, number>, rows: Object[]}}
 *   missingColumns 為要新增的機器鍵清單；columnIndexes 為 {機器鍵: 1-based 欄號}
 *   （欄已存在＝目前欄號，不存在＝最後一欄之後依序往右）；
 *   rows 為要補 Stage=DRAFT 的季度列 {sheetRow, quarterId}
 */
function planQuartersStageSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];

  const wantedColumns = [COLUMNS.QUARTERS.STAGE, COLUMNS.QUARTERS.STAGE_UPDATED_AT];
  const columnIndexes = {};
  const missingColumns = [];
  let nextCol = lastCol;
  wantedColumns.forEach(function (key) {
    const existing = headers.indexOf(key);
    if (existing !== -1) {
      columnIndexes[key] = existing + 1;
    } else {
      nextCol += 1;
      columnIndexes[key] = nextCol;
      missingColumns.push(key);
    }
  });

  const plan = { missingColumns: missingColumns, columnIndexes: columnIndexes, rows: [] };

  const dataRowCount = lastRow - 2;
  if (dataRowCount <= 0) return plan;

  const quarterCol = headers.indexOf(COLUMNS.QUARTERS.QUARTER_ID) + 1;
  const quarterIds = sheet.getRange(3, quarterCol, dataRowCount, 1).getValues();
  const stageColIsNew = missingColumns.indexOf(COLUMNS.QUARTERS.STAGE) !== -1;
  const existingStageValues = stageColIsNew
    ? quarterIds.map(function () { return ['']; })
    : sheet.getRange(3, columnIndexes[COLUMNS.QUARTERS.STAGE], dataRowCount, 1).getValues();

  for (let i = 0; i < dataRowCount; i++) {
    const quarterId = quarterIds[i][0];
    if (!quarterId) continue;
    const currentStage = String(existingStageValues[i][0] || '').trim();
    if (currentStage !== '') continue; // 已有值，略過（只填補空白）
    plan.rows.push({ sheetRow: i + 3, quarterId: quarterId });
  }
  return plan;
}

/**
 * 依 planQuartersStageSeed_() 的計畫寫入 Quarters：欄不存在就新增在最後一欄之後
 * （第 1 行放中文標題，第 2 行放機器鍵），然後把 Stage 空白的季度填 DRAFT。
 * 完全不會動到既有欄位，也不會覆寫已經有 Stage 值的季度列。
 * @param {Object} plan planQuartersStageSeed_() 的結果
 * @returns {number} 實際補上 Stage=DRAFT 的季度數
 */
function seedQuartersStage_(plan) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.QUARTERS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.QUARTERS);

  const titles = {};
  titles[COLUMNS.QUARTERS.STAGE] = '流程階段';
  titles[COLUMNS.QUARTERS.STAGE_UPDATED_AT] = '階段更新時間';

  plan.missingColumns.forEach(function (key) {
    const col = plan.columnIndexes[key];
    sheet.getRange(1, col).setValue(titles[key] || key);
    sheet.getRange(2, col).setValue(key);
  });

  if (plan.rows.length > 0) {
    const stageCol = plan.columnIndexes[COLUMNS.QUARTERS.STAGE];
    plan.rows.forEach(function (r) {
      sheet.getRange(r.sheetRow, stageCol).setValue(QUARTER_STAGE.DRAFT);
    });
  }
  return plan.rows.length;
}
