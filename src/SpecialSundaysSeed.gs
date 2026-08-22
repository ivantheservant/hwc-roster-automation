/**
 * 階段 A 新增：「補建 SpecialSundays 工作表」。
 *
 * NewQuarterWizard.gs 的完成畫面一直叫幹事「到 SpecialSundays 工作表標記特別主日」，
 * 但全專案從來沒有任何程式碼保證這張表真的存在——如果幹事的試算表副本是很久以前
 * 建立的、或者這張表不知何故被刪掉，幹事會對著一句找不到對應工作表的指示發呆。
 * 這個工具補上這個缺口，做法完全比照 `RequestsSheet.gs` 的
 * `createOrRefreshRequestsSheet_()`：**只在工作表不存在時新建**，已存在時什麼都不動
 * （不會覆寫任何一格既有資料），行為是冪等的，可以放心重複執行。
 *
 * 這個工具只保證「表存在、欄位齊全」，不負責幫幹事填任何一列特別主日的實際內容——
 * 那是人手判斷的事（哪一週合堂、哪一週浸禮），不是系統可以自動偵測的（見
 * roster_patterns_rules.md 第六節：「系統必須容許在 configuration 中標記某週為特殊
 * 主日」，重點是「容許」，不是「自動判斷」）。
 *
 * Type 欄刻意不加下拉選單限制成「合堂／浸禮／宣教月」三個固定值——這正是
 * roster_patterns_rules.md 明確要求的「不可寫死」，而且程式碼（Generator.gs 的
 * getSkipReason_()）本來就完全不讀這一欄，只讀 SkipPostIDs／LockPostIDs 來決定
 * 實際的生成行為，Type／Title 純粹是給人看的說明文字，幹事想怎麼分類都可以。
 */

/** SpecialSundays 第 1 行（中文標題）與第 2 行（機器鍵）的欄位順序，兩個陣列一一對應。 */
const SPECIAL_SUNDAYS_HEADERS_TC = [
  'SpecialID', 'QuarterID', '日期', '類型（自由文字，例如合堂／浸禮／宣教月）', '標題／說明',
  '跳過崗位（PostID，逗號分隔）', '鎖定崗位（PostID，逗號分隔）', '外部負責單位',
  '聖餐特別安排（保留欄位，目前程式碼未讀取，見備註）', '需要翻譯（保留欄位，目前程式碼未讀取）',
  'Active', '備註',
  // ⚠️ 第四十七輪批次 C1 組：**加喺最後，唔可以插喺中間。**
  //
  // 既有試算表嘅欄序已經固定；插喺中間會令所有既有列嘅資料整排移位。
  //
  // 呢一欄由第一日就喺 `COLUMNS.SPECIAL_SUNDAYS` 定義咗，
  // 全專案有五處程式碼讀寫佢（`AnnualCombined.gs`／`WebAppPreQuarterEdit.gs`
  // ／`ConfigSeed.gs` 嘅說明文字⋯⋯），**而呢兩個 header 陣列一直冇佢**。
  // 所以建表路徑由頭到尾造唔出呢一欄，而
  // `isUnconfirmedSpecialSunday_()` 永遠讀到 `undefined`
  // ⇒「未確認的特殊主日」永遠係 0。
  '日期是否已確認（留空＝已確認；只有填 FALSE 才算未確認）'
];

/**
 * 取得 SpecialSundays 第 2 行機器鍵陣列，順序須與 SPECIAL_SUNDAYS_HEADERS_TC 一一對應。
 * 寫成函式而非頂層 const，理由同 `RequestsSheet.gs` 的 `getRequestsHeaderKeys_()`：
 * 本檔案（S 開頭）依字母序早於 Constants.gs 載入，頂層直接引用 COLUMNS 會撞到 TDZ。
 * @returns {string[]} 機器鍵陣列
 */
function getSpecialSundaysHeaderKeys_() {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  return [
    C.SPECIAL_ID, C.QUARTER_ID, C.SERVICE_DATE, C.TYPE, C.TITLE,
    C.SKIP_POST_IDS, C.LOCK_POST_IDS, C.EXTERNAL_OWNER,
    C.COMMUNION_OVERRIDE, C.TRANSLATION_REQUIRED, C.ACTIVE, C.NOTES,
    // ⚠️ 第四十七輪批次 C1 組：見 `SPECIAL_SUNDAYS_HEADERS_TC` 嗰段。
    // **一定要排喺最後**，而且要同上面嗰個陣列一一對應。
    C.CONFIRMED
  ];
}

/**
 * 建立（若不存在）SpecialSundays 工作表。已存在時完全不動，回傳 isNew=false。
 * @returns {{isNew: boolean}}
 */
function ensureSpecialSundaysSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (existing) return { isNew: false };

  const sheet = ss.insertSheet(SHEETS.SPECIAL_SUNDAYS);
  const keys = getSpecialSundaysHeaderKeys_();

  sheet.getRange(1, 1, 1, SPECIAL_SUNDAYS_HEADERS_TC.length).setValues([SPECIAL_SUNDAYS_HEADERS_TC])
    .setFontWeight('bold')
    .setBackground(GRID_COLORS.HEADER)
    .setWrap(true);
  sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  sheet.setFrozenRows(2);
  sheet.hideRows(2);
  sheet.autoResizeColumns(1, keys.length);

  return { isNew: true };
}

/**
 * 選單項目「維護 ▸ 補建 SpecialSundays 工作表」的執行入口。
 * @returns {void}
 */
function runEnsureSpecialSundaysSheet_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = ensureSpecialSundaysSheet_();
    ui.alert(
      '補建 SpecialSundays 工作表',
      result.isNew
        ? '原本沒有 SpecialSundays 工作表，已建立（只有標題列，沒有任何資料）。'
        : 'SpecialSundays 工作表已經存在，沒有做任何改動。',
      ui.ButtonSet.OK
    );
  } catch (err) {
    log_('ERROR', 'runEnsureSpecialSundaysSheet_ 失敗: ' + err.message);
    ui.alert('補建 SpecialSundays 工作表', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/* ═════════════════════════════════════════════════════════════════════
 * 第四十七輪批次 C2 組：**把既有試算表補上缺欄。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * `Confirmed` 由第一日就喺 `COLUMNS.SPECIAL_SUNDAYS` 定義咗，而兩個 header
 * 陣列一直冇佢——所以任何一張**已經建立咗**嘅 `SpecialSundays` 都冇呢一欄。
 * 補返 header 陣列（C1）只影響**日後新建**嘅表，既有嗰張要人手補。
 *
 * ⚠️ 呢支工具嘅四條界線：
 *
 *   一、**只喺最後加欄。** 唔重排、唔刪、唔改任何既有資料。
 *   二、**已經有嗰一欄就乜都唔做**，而且要明確報「已經有了」——
 *       靜靜做多次會令幹事以為佢做漏咗嘢。
 *   三、**唔會順手替既有列填值。** 邊一行嘅日期真係未確認，只有幹事知。
 *       程式猜一個 `FALSE` 上去就會即刻噴一堆假警報——
 *       `Constants.gs` 嗰段註釋已經解釋過點解方向要揀「空白＝已確認」，
 *       就係為咗避免呢件事。
 *   四、補完之後**逐行印出現時嘅值**（會全部係空白），
 *       並且提醒佢邊一類行要人手填 `FALSE`。
 */

/**
 * 算一算要唔要補欄。**純讀取。**
 *
 * @returns {{sheetExists: boolean, alreadyHas: boolean, headers: string[],
 *   missingKey: string, nextCol: number, rowCount: number}}
 */
function planSpecialSundaysColumnBackfill_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  if (!sheet) {
    return {
      sheetExists: false, alreadyHas: false, headers: [],
      missingKey: COLUMNS.SPECIAL_SUNDAYS.CONFIRMED, nextCol: 0, rowCount: 0
    };
  }
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0
    ? sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (v) {
      return String(v || '').trim();
    })
    : [];
  const key = COLUMNS.SPECIAL_SUNDAYS.CONFIRMED;
  return {
    sheetExists: true,
    alreadyHas: headers.indexOf(key) !== -1,
    headers: headers,
    missingKey: key,
    nextCol: lastCol + 1,
    rowCount: Math.max(0, lastRow - 2)
  };
}

/**
 * 逐行講「呢一行現時個 `Confirmed` 係乜」。**純讀取。**
 *
 * ⚠️ 補完之後一定要印呢一份。一個空欄對幹事嚟講冇任何意思——
 * 佢要見到「哦，六行全部空白，即係全部當成已確認」，
 * 先至答得到「噉邊幾行要我改成 FALSE」。
 *
 * @returns {Object[]} 每筆 {specialId, quarterId, serviceDate, title, confirmed}
 */
function describeSpecialSundaysConfirmedRows_() {
  const C = COLUMNS.SPECIAL_SUNDAYS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readSheet(SHEETS.SPECIAL_SUNDAYS).map(function (row) {
    return {
      specialId: String(row[C.SPECIAL_ID] || '').trim(),
      quarterId: String(row[C.QUARTER_ID] || '').trim(),
      serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
      title: String(row[C.TITLE] || '').trim(),
      type: String(row[C.TYPE] || '').trim(),
      active: isTrueValue_(row[C.ACTIVE]),
      confirmed: row[C.CONFIRMED] === undefined
        ? '（沒有這一欄）' : String(row[C.CONFIRMED] || '').trim()
    };
  });
}

/**
 * 真正補欄。**只喺最後加一欄，一格既有資料都唔會動。**
 *
 * @param {Object} plan `planSpecialSundaysColumnBackfill_()` 的結果
 * @returns {{added: boolean, col: number}}
 */
function executeSpecialSundaysColumnBackfill_(plan) {
  if (!plan.sheetExists || plan.alreadyHas) return { added: false, col: 0 };

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(SHEETS.SPECIAL_SUNDAYS);
  const col = plan.nextCol;
  const keys = getSpecialSundaysHeaderKeys_();
  const titles = SPECIAL_SUNDAYS_HEADERS_TC;
  const idx = keys.indexOf(plan.missingKey);

  // 第 1 行中文標題、第 2 行機器鍵——同 `ensureSpecialSundaysSheet_()` 一樣。
  sheet.getRange(1, col).setValue(idx >= 0 ? titles[idx] : plan.missingKey);
  sheet.getRange(2, col).setValue(plan.missingKey);

  // ⚠️ **到此為止。** 唔會替任何一列填值——見檔內第三條界線。

  writeAuditLog_({
    action: 'SPECIAL_SUNDAYS_COLUMN_BACKFILL',
    targetSheet: SHEETS.SPECIAL_SUNDAYS,
    targetCell: '第 ' + col + ' 欄',
    oldValue: '（沒有這一欄）',
    newValue: plan.missingKey,
    source: 'executeSpecialSundaysColumnBackfill_',
    notes: '只在最後加欄；沒有重排、沒有刪除、沒有改動任何既有資料，'
      + '亦沒有替任何一列填值'
  });
  return { added: true, col: col };
}

/**
 * 選單項目「維護 ▸ ⚠️ 補建 SpecialSundays 缺欄」的執行入口。
 * @returns {void}
 */
function runSpecialSundaysColumnBackfill_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 SpecialSundays 缺欄';

  let plan;
  try {
    plan = planSpecialSundaysColumnBackfill_();
  } catch (err) {
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (!plan.sheetExists) {
    ui.alert(title,
      '找不到「' + SHEETS.SPECIAL_SUNDAYS + '」這一張工作表。\n\n'
        + '先去「維護 ▸ 補建 SpecialSundays 工作表」建立它——'
        + '新建立的那一張本來就會有這一欄。',
      ui.ButtonSet.OK);
    return;
  }
  if (plan.alreadyHas) {
    ui.alert(title,
      '「' + plan.missingKey + '」這一欄已經有了，沒有改動。\n\n'
        + '目前這一張表有 ' + plan.headers.length + ' 欄、'
        + plan.rowCount + ' 行資料。',
      ui.ButtonSet.OK);
    return;
  }

  const lines = [
    '「' + SHEETS.SPECIAL_SUNDAYS + '」現在沒有「' + plan.missingKey + '」這一欄。',
    '',
    '會做的事：',
    '　・在最後（第 ' + plan.nextCol + ' 欄）加一欄，標題同機器鍵各一行',
    '',
    '不會做的事：',
    '　・不會重排、不會刪除任何一欄',
    '　・不會改動任何一格既有資料',
    '　・⚠️ 不會替任何一列填值——哪一行的日期真的未確認，只有你知道',
    '',
    '目前有 ' + plan.rowCount + ' 行資料。要加這一欄嗎？'
  ];
  if (ui.alert(title, lines.join('\n'), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  let result;
  try {
    result = executeSpecialSundaysColumnBackfill_(plan);
  } catch (err) {
    log_('ERROR', 'runSpecialSundaysColumnBackfill_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  // ── 補完之後逐行印，並且講明下一步 ────────────────────────
  const rows = describeSpecialSundaysConfirmedRows_();
  const after = [
    '已經加好了（第 ' + result.col + ' 欄）。',
    '',
    '現時每一行的「' + plan.missingKey + '」值：'
  ];
  rows.forEach(function (r) {
    after.push('　' + (r.specialId || '（沒有 SpecialID）')
      + '　' + (r.serviceDate || '（沒有日期）')
      + '　' + (r.type || '（沒有類型）')
      + '　⇒ ' + (r.confirmed === '' ? '（空白）' : r.confirmed)
      + (r.active ? '' : '　［Active=FALSE］'));
  });
  after.push('');
  after.push('⚠️ 全部都是空白，而「空白」代表「已確認」。');
  after.push('由「產生年度合堂建議」產生、而日期還未向教會確認的那幾行，');
  after.push('要人手把這一欄填 FALSE——只有填了 FALSE 才算未確認，');
  after.push('系統才會在提醒和體檢裡面算它。');
  ui.alert(title, after.join('\n'), ui.ButtonSet.OK);
}

