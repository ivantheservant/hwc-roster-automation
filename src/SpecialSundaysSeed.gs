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
  'Active', '備註'
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
    C.COMMUNION_OVERRIDE, C.TRANSLATION_REQUIRED, C.ACTIVE, C.NOTES
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
