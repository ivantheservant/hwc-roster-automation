/**
 * 程式碼實際會用 getConfig()／CONFIG_KEYS 讀取、但可能還沒出現在 Config 工作表的
 * 參數定義。選單「補建 Config 參數」只會把這裡列出、工作表目前沒有的 Key
 * 加到最後一行，絕不修改任何既有行的 Value——已經在工作表裡的設定一律維持原樣，
 * 即使跟這裡的 defaultValue 不同也不會被覆寫或刪除。
 *
 * 寫法跟 EmailTemplateSeed.gs 的 seedEmailTemplates_() 同一個手法（只 append、
 * 用既有的 Key 清單判斷要不要略過）。
 *
 * ⚠️ 這份清單曾經漏過大部分的 Key（只收錄了近幾輪追加階段新增的 5 個），
 * 導致「補建 Config 參數」對 40 幾個實際會用到的 Key 完全視而不見、誤判成
 * 「都已存在」。這是實測抓到的真實 bug（GRID_PENDING_FILL_COLOR 事件）。
 * 現在已經逐一比對全部 `getConfig()`／`config[CONFIG_KEYS.X]` 呼叫點，
 * 補齊成一份完整清單，並在下方加了 checkConfigKeyRegistryGaps_() 自我檢查，
 * 執行「補建 Config 參數」時一律會報告 CONFIG_KEYS 裡有沒有任何 Key
 * 沒被這份清單涵蓋，不會再靜靜地漏掉。
 *
 * 【對於「正確值因人而異、猜錯有實際後果」的 Key（LEAD_DAYS_* 這類排程日數），
 * 這裡刻意不猜一個看起來合理但其實不知道對不對的數字，而是給空白 Value
 * （Type 仍然正確設定），Description 講清楚「必填，請自行填入」——空白 Value
 * 在效果上等同這一行完全不存在（getConfig() 的 fallback 一樣會生效），
 * 所以這樣做不會比「完全沒有這個 Key」更差，卻能讓你在 Config 工作表上
 * 直接看到這個 Key 存在、需要你填，而不是要靠翻程式碼才知道。】
 *
 * 刻意寫成函式而非 const 陣列：本檔案（C 開頭）依字母序會比 Constants.gs 更早載入，
 * 若在頂層直接引用 CONFIG_KEYS／CONFIG_TYPES／DEFAULTS 會拋
 * "Cannot access 'CONFIG_KEYS' before initialization"（跟 Constants.gs 的
 * getRequiredConfigKeys() 是同一個理由、同一種寫法）。改為函式後，
 * 這些引用只在呼叫當下才求值，那時候全部檔案都已經載入完畢。
 * @returns {Object[]} Key 定義清單
 */
function getConfigKeySeeds_() {
  return [
    // ---- PDF_BATCH ----
    {
      key: CONFIG_KEYS.PDF_BATCH_SIZE, type: CONFIG_TYPES.INT, group: 'PDF_BATCH',
      defaultValue: String(DEFAULTS.PDF_BATCH_SIZE),
      description: '「產生個人 PDF」每批處理的人數上限。批次設太大也有內建的時間安全網'
        + '（4 分鐘）會提早停止並存進度，不會超過 Apps Script 6 分鐘單次執行上限。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SEND_LOG_FLUSH_BATCH_SIZE, type: CONFIG_TYPES.INT, group: 'PDF_BATCH',
      defaultValue: String(DEFAULTS.SEND_LOG_FLUSH_BATCH_SIZE),
      description: '寄送流程（sendStage()／sendResendStage_()）每處理幾個收件人就把 '
        + 'SendLog 寫入一次，不是全部寄完才一次寫入。設太大時，Apps Script 逾時中途中斷'
        + '會遺失較多筆還沒寫入的紀錄；設太小則寫入次數變多、稍微變慢。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PDF_REGENERATE_IF_EXISTS, type: CONFIG_TYPES.BOOL, group: 'PDF_BATCH',
      defaultValue: 'FALSE',
      description: '「產生個人 PDF」是否強制重新產生已存在的同版本 PDF。'
        + 'TRUE＝全部重做；FALSE（預設）＝已存在的檔案略過，不重新匯出。',
      editable: 'TRUE'
    },
    // ---- GRID ----
    {
      key: CONFIG_KEYS.GRID_NOT_APPLICABLE_LABEL, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
      description: '職事表 grid 中「結構性不適用」的格子（目前只有非首主日的聖餐襄禮，'
        + '見 STRUCTURAL_NA_RULE_IDS）顯示的文字；也是 Posts.EmptyDisplay=NA 的顯示文字。'
        + '避免義工誤會自己可能被派到。只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_PENDING_LABEL, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_PENDING_LABEL,
      description: '職事表 grid 中「崗位存在、留空待人手填寫」的格子預設顯示的文字'
        + '（Posts.EmptyDisplay=PENDING，或該崗位未設定 EmptyDisplay 時的預設）。'
        + '只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_SPECIAL_SKIP_LABEL, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
      description: '職事表 grid 中「這個崗位平常會自動生成，但這一週因為 SpecialSundays '
        + '標記了 SkipPostIDs 而跳過」的格子顯示的文字（見 SPECIAL_SKIP_RULE_IDS）。'
        + '跟 GRID_PENDING_LABEL 刻意不同，避免跟「這個崗位本來就永遠不自動生成」'
        + '（講員／翻譯／獻花）混淆。只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_PENDING_FILL_COLOR, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_PENDING_FILL_COLOR,
      description: '「系統應該排但排不出」的格子底色（十六進位色碼）。同時用於生成時'
        + '找不到合資格人選的格，以及「套用修改申報」找不到合資格替補的格——'
        + '兩者語意相同（都要人手補），刻意用同一種顏色。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_GAP_LABEL, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_GAP_LABEL,
      description: '「系統應該排但排不出」的格子顯示的文字。刻意跟 GRID_PENDING_LABEL'
        + '（講員／翻譯／獻花那類本來就要人手填的格）用完全不同的字，'
        + '令黑白列印出來一樣分得出。只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_SHOW_LEGEND, type: CONFIG_TYPES.BOOL, group: 'GRID',
      defaultValue: 'TRUE',
      description: '職事表 grid 底部是否加一段圖例，說明每種標示的意思與本季實際格數。'
        + '草稿要印給堂委看時特別有用。只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.GRID_FOOTER_NOTE, type: CONFIG_TYPES.STR, group: 'GRID',
      defaultValue: DEFAULTS.GRID_FOOTER_NOTE,
      description: '職事表 grid 最底的一句備註（對照現行人手職事表底部的聯絡人字句）。'
        + '留空則不顯示。只影響日後新生成的版本。',
      editable: 'TRUE'
    },
    // ---- ATTACH ----
    {
      key: CONFIG_KEYS.ATTACH_HIGHLIGHT_PERSONAL, type: CONFIG_TYPES.BOOL, group: 'ATTACH',
      defaultValue: 'FALSE',
      description: '個人版 PDF 是否把該人獲派的格子加上藍色底色與粗體。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.ATTACH_NAME_PATTERN, type: CONFIG_TYPES.STR, group: 'ATTACH',
      defaultValue: DEFAULTS.ATTACH_NAME_PATTERN,
      description: 'PDF 附件檔名樣板，支援 {QuarterID}／{VersionNo}／{PersonName}。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.ATTACH_PAGE_ORIENTATION, type: CONFIG_TYPES.ENUM, group: 'ATTACH',
      defaultValue: PAGE_ORIENTATION.LANDSCAPE,
      description: 'PDF 匯出方向：LANDSCAPE（橫向，預設）或 PORTRAIT（直向）。',
      editable: 'TRUE'
    },
    // ---- PDF_EXPORT ----
    {
      key: CONFIG_KEYS.PDF_EXPORT_MAX_RETRIES, type: CONFIG_TYPES.INT, group: 'PDF_EXPORT',
      defaultValue: String(DEFAULTS.PDF_EXPORT_MAX_RETRIES),
      description: 'PDF 匯出遇到 HTTP 429／5xx 時最多重試幾次。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PDF_EXPORT_RETRY_DELAY_MS, type: CONFIG_TYPES.INT, group: 'PDF_EXPORT',
      defaultValue: String(DEFAULTS.PDF_EXPORT_RETRY_DELAY_MS),
      description: 'PDF 匯出重試的初始等待毫秒數，每次重試前倍增。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PDF_EXPORT_PACING_MS, type: CONFIG_TYPES.INT, group: 'PDF_EXPORT',
      defaultValue: String(DEFAULTS.PDF_EXPORT_PACING_MS),
      description: '連續匯出 PDF 之間的固定間隔毫秒數，主動降低觸發速率限制的機率。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PDF_MIN_SIZE_BYTES, type: CONFIG_TYPES.INT, group: 'PDF_EXPORT',
      defaultValue: String(DEFAULTS.PDF_MIN_SIZE_BYTES),
      description: '追加階段 AG 新增。匯出的 PDF 檔案小於這個大小（bytes）就當作內容'
        + '空白或截斷，視為失敗並自動重試；已存在的檔案小於這個大小也不算「已產生過」，'
        + '會重新產生；寄送前也用這個門檻判斷附件是否完整，不完整記為缺件不寄出。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.STEP4_MAX_MISSING_PDF_RATIO, type: CONFIG_TYPES.DEC, group: 'PDF_EXPORT',
      defaultValue: String(DEFAULTS.STEP4_MAX_MISSING_PDF_RATIO),
      description: '第十九輪批次新增。步驟 4「正式發出」容許的個人 PDF 缺件比例上限'
        + '（0–1，預設 0.2）。缺件人數 ÷ 應收人數超過這個比例就直接中止，'
        + '不會再提供「現在繼續」的選擇。實測背景：曾經在 57／57 人全部缺件的情況下'
        + '仍然可以按「繼續」，結果全體義工一個都沒有收到，而 Stage 已經前進到'
        + ' OFFICIAL_SENT、鎖住了重跑步驟 4 的路。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SELF_TEST_QUARTER_ID, type: CONFIG_TYPES.STR, group: 'SYSTEM',
      defaultValue: '',
      description: '第二十一輪批次新增。「測試工具 ▸ 自我測試」要驗哪一個季度。'
        + '「留空」是建議做法——留空時系統會自動用「最近一個有生成過版本的季度」，'
        + '所以不會過期。只有在你想固定驗某一季（例如驗證某個歷史版本）時才填。'
        + '版本號不用填也不能填：一律驗該季的最新版本'
        + '（初稿之後的版本才是真正會寄出去的東西）。',
      editable: 'TRUE'
    },
    // ---- MAIL ----
    {
      key: CONFIG_KEYS.MAIL_ADMIN_NOTIFY, type: CONFIG_TYPES.EMAIL, group: 'MAIL',
      defaultValue: '',
      description: '「查無電郵」名單要通知的管理員信箱；留空則只記錄在 Logger，不寄通知。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MAIL_REPLY_TO, type: CONFIG_TYPES.EMAIL, group: 'MAIL',
      defaultValue: '',
      description: '寄出郵件的回覆地址；留空則使用預設寄件身分。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MAIL_SENDER_NAME, type: CONFIG_TYPES.STR, group: 'MAIL',
      defaultValue: '',
      description: '寄出郵件顯示的寄件人名稱；留空則使用預設寄件身分。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MAIL_SUBJECT_PREFIX, type: CONFIG_TYPES.STR, group: 'MAIL',
      defaultValue: '',
      description: '郵件標題前綴，會加在每封信主旨的最前面。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MAIL_SUMMARY_DATE_FORMAT, type: CONFIG_TYPES.STR, group: 'MAIL',
      defaultValue: DEFAULTS.MAIL_SUMMARY_DATE_FORMAT,
      description: '個人派工摘要（{AssignmentSummary}）裡日期的顯示格式。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MAIL_SUMMARY_SEPARATOR, type: CONFIG_TYPES.STR, group: 'MAIL',
      defaultValue: DEFAULTS.MAIL_SUMMARY_SEPARATOR,
      description: '個人派工摘要裡多筆派工之間的分隔符號。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.RESEND_ONLY_CHANGED, type: CONFIG_TYPES.BOOL, group: 'MAIL',
      defaultValue: 'TRUE',
      description: 'RESEND 階段是否只寄給內容有改動的人（跟上次成功寄送比對 AssignmentHash）。'
        + 'TRUE（預設，維持原行為）＝內容沒變的人略過，記 SKIPPED_UNCHANGED；'
        + 'FALSE＝忽略比對，對每個人都強制重寄。',
      editable: 'TRUE'
    },
    // ---- SYS ----
    {
      key: CONFIG_KEYS.DRY_RUN, type: CONFIG_TYPES.BOOL, group: 'SYS',
      defaultValue: 'TRUE',
      description: '全域測試模式閘門。TRUE 時全專案唯一會呼叫 MailApp.sendEmail 的兩處'
        + '都會被攔截，只寫 SendLog、不真正寄出。務必先確認無誤才改成 FALSE。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SYS_TIMEZONE, type: CONFIG_TYPES.STR, group: 'SYS',
      defaultValue: DEFAULTS.TIMEZONE,
      description: '系統運作採用的時區，例如 Pacific/Auckland。幾乎所有日期運算都靠這個值。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SYS_LOCALE, type: CONFIG_TYPES.STR, group: 'SYS',
      defaultValue: '',
      description: '必填但目前程式碼沒有任何地方實際讀取這個值（只在 validateSetup() 的'
        + '必填清單裡）。語意不明確，故意留空不猜，請你確認正確值後自行填入。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SYS_TIMESTAMP_FORMAT, type: CONFIG_TYPES.STR, group: 'SYS',
      defaultValue: DEFAULTS.TIMESTAMP_FORMAT,
      description: '寫入工作表的時間戳格式。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SYS_CONFIG_CACHE_SECONDS, type: CONFIG_TYPES.INT, group: 'SYS',
      defaultValue: String(CACHE_DURATIONS.CONFIG_SECONDS),
      description: 'Config 工作表快取的秒數，缺省或無效時退回這個預設值；上限為 CacheService 本身的 21600 秒。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.ROSTER_SPREADSHEET_ID, type: CONFIG_TYPES.STR, group: 'SYS',
      defaultValue: SpreadsheetApp.getActiveSpreadsheet().getId(),
      description: '本試算表自己的 ID（自動偵測填入，不是用猜的——這是唯一一個能安全'
        + '自動算出正確值的必填 Key）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.ROSTER_DRIVE_FOLDER_ID, type: CONFIG_TYPES.STR, group: 'SYS',
      defaultValue: '',
      description: '存放 PDF 的 Shared Drive 資料夾 ID。留空時一般匯出會退回試算表所在'
        + '資料夾，但寄送附件（Mailer.gs）一律要求必須是 Shared Drive，留空會直接報錯。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL, type: CONFIG_TYPES.EMAIL, group: 'SYS',
      defaultValue: '',
      description: '必填，操作者帳號，用於 v0 保護等機制的編輯者白名單。屬於帳號設定，'
        + '不應該由程式猜測，故意留空，請你自行填入。',
      editable: 'TRUE'
    },
    // ---- AUTOMATION ----
    {
      key: CONFIG_KEYS.LEAD_DAYS_GENERATE, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: '',
      description: '必填，自動排程「生成職事表」在季度開始日前幾天觸發。因你的實際流程'
        + '而異，沒有安全的通用預設值，故意留空不猜，請你自行填入（Quarters 自己的 '
        + 'GenerateOn 欄留空時才會用到這個值）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.LEAD_DAYS_OFFICIAL, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: '',
      description: '必填，自動排程「正式寄出」在季度開始日前幾天觸發，同上，故意留空不猜。'
        + '追加階段 N 之後：OFFICIAL 已經不會由自動排程觸發（一律要幹事手動執行「步驟 4」）。'
        + '追加階段 Q 當時查證這個 Key 全專案沒有任何呼叫端讀取——但第三輪批次下一輪'
        + '（新一批階段 B）已經重新啟用它：REMIND 的「死線接近」提醒維度會用它算出來的'
        + 'officialDate（computeAutomationSchedule_()）當參考日期，所以這個 Key 現在不是'
        + '死值了，不建議移除。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.REMIND_STUCK_DAYS, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: String(DEFAULTS.REMIND_STUCK_DAYS),
      description: '「停滯時間」維度的門檻：Stage 停留在目前這個階段（DRAFT／'
        + 'REVIEW_SENT／REQUESTS_APPLIED 三者之一）超過幾天未前進，開始每日提醒幹事。'
        + '三個 Stage 共用同一個門檻，沒有分開設定——見 docs/系統範圍稽核.md 的說明。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.REMIND_STUCK_MAX_COUNT, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: String(DEFAULTS.REMIND_STUCK_MAX_COUNT),
      description: '卡在同一個 Stage 的提醒最多對幹事發送幾次（每天最多一次，'
        + '兩個觸發維度同時成立當天也只算一次），達到次數上限後不再提醒；'
        + '一旦 Stage 前進到下一個階段，這個計數會重新從零開始算。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.REMIND_DEADLINE_DAYS, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: String(DEFAULTS.REMIND_DEADLINE_DAYS),
      description: '「死線接近」維度的門檻：距離正式發出日期（Quarters.OfficialSendOn，'
        + '缺省時退回 LEAD_DAYS_OFFICIAL 從 StartDate 推算）少於幾天、而 Stage 仍未到'
        + 'OFFICIAL_SENT，不論目前是哪個 Stage 都開始每日提醒幹事。這是系統範圍需求'
        + '第 3 項「季初前 4 週 +2 日寄提醒」的現代版本，對象只有幹事，不寄給義工，'
        + '見 docs/系統範圍稽核.md。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.QUARTER_TERM_START_MONTHS, type: CONFIG_TYPES.LIST, group: 'SCHEDULE',
      defaultValue: DEFAULTS.QUARTER_TERM_START_MONTHS,
      description: '第十七輪批次新增：T1～T4 各自由哪一個月開始，逗號分隔的四個月份數字。'
        + '預設 1,4,7,10 就是日曆季度（T1=1-3月、T2=4-6月、T3=7-9月、T4=10-12月），'
        + '跟這個 Key 加入之前寫死在程式裡的一樣，所以不改也不會有任何行為變化。'
        + '教會如果用學期制或財政年度等其他劃分，改這裡就可以，不需要改程式。'
        + '「⚠️ 新增季度」與「⚠️ 產生下一年度四個季度」兩個工具都讀這個值。'
        + '格式不正確（不是四項、或有值不在 1-12）時會整組退回預設值並記一句 WARN。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.REMIND_UNCONFIRMED_SPECIAL_DAYS, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: String(DEFAULTS.REMIND_UNCONFIRMED_SPECIAL_DAYS),
      description: '第十六輪批次新增（教會規則 5）：距離自動生成日期少於幾天，就開始提醒'
        + '「這一季還有未確認日期的特殊主日」。用生成日期而不是正式發出日期，因為'
        + 'SpecialSundays 的 SkipPostIDs 是在生成那一刻才套用——生成完才發現日期錯了，'
        + '整張表要重新生成。預設 7 天（生成前一星期問，還有時間去問教會）。'
        + '未確認的列是指 SpecialSundays 的 Confirmed 欄明確填了 FALSE 的列'
        + '（空白一律視為已確認，見 docs/排表規則.md）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SEND_HOUR_LOCAL, type: CONFIG_TYPES.INT, group: 'AUTOMATION',
      defaultValue: '9',
      description: '每日自動排程檢查大約在幾點執行（0-23，只保證在該小時內觸發）。'
        + '9 是程式碼裡 runInstallAutomation_() 本來就有的後備值，這裡沿用同一個值。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SEND_WEEKDAY_GUARD, type: CONFIG_TYPES.ENUM, group: 'AUTOMATION',
      defaultValue: 'NONE',
      description: '排程日期撞正星期日時的處理：NONE（不理會）／SKIP_SUNDAY（提前到星期六）'
        + '／NEXT_WEEKDAY（順延到星期一）。',
      editable: 'TRUE'
    },
    // ---- GENERATOR（排表演算法的可調參數；Generator.gs 本身未改動，這些只是它會讀的 Config）----
    {
      key: CONFIG_KEYS.CARRY_OVER_WEEKS, type: CONFIG_TYPES.INT, group: 'GENERATOR',
      defaultValue: '0',
      description: '生成新季度時，往前看幾週的既有派工紀錄作為「連續兩週」判斷的基準。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER, type: CONFIG_TYPES.INT, group: 'GENERATOR',
      defaultValue: String(DEFAULTS.MAX_PER_QUARTER),
      description: '個人每季服侍次數上限的預設值（NameMapping 有個人設定時優先用個人值）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.RANDOM_SEED, type: CONFIG_TYPES.INT, group: 'GENERATOR',
      defaultValue: '0',
      description: '排表用的亂數種子，同一個 seed 配同一份資料必定產生相同結果。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SELECTION_STRATEGY, type: CONFIG_TYPES.ENUM, group: 'GENERATOR',
      defaultValue: SELECTION_STRATEGIES.LONGEST_UNSERVED,
      description: '選人策略，目前只有 LONGEST_UNSERVED（最久沒服侍者優先）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SELECTION_WEIGHT_HISTORICAL, type: CONFIG_TYPES.DEC, group: 'GENERATOR',
      defaultValue: '0',
      description: '選人分數中歷史服侍次數的加權比重（0–1）。0＝純粹最久沒服侍者優先。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SCORE_CHAIR_DUAL_BONUS, type: CONFIG_TYPES.INT, group: 'SCORE',
      defaultValue: String(SCORE_DEFAULTS.CHAIR_DUAL_BONUS),
      description: 'SOFT_CHAIR_PREFER_DUAL 的獎勵分量級。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SCORE_PREFERENCE_BONUS, type: CONFIG_TYPES.INT, group: 'SCORE',
      defaultValue: String(SCORE_DEFAULTS.PREFERENCE_BONUS),
      description: 'SOFT_CHAIR_EQ_ANNOUNCE／SOFT_ANNOUNCE_RELIEF 的獎勵分量級。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SCORE_SELECTION_WEIGHT, type: CONFIG_TYPES.INT, group: 'SCORE',
      defaultValue: String(SCORE_DEFAULTS.SELECTION_WEIGHT),
      description: '選人分數本身在總扣分中的量級。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SCORE_TIE_EPSILON, type: CONFIG_TYPES.DEC, group: 'SCORE',
      defaultValue: String(DEFAULTS.SCORE_TIE_EPSILON),
      description: '候選人分數相差多少以內視為「同分」，令 RANDOM_SEED 的隨機決勝真正生效。'
        + '⚠️ 預設 0＝完全不啟用，排表行為與加入這個設定之前逐格一致。'
        + '改成非零值之前，請先用「查看 ▸ 試算不同 epsilon 的效果（唯讀）」在真實資料上比較。',
      editable: 'TRUE'
    },
    // ---- SOFT_METRIC（軟規則實測量度工具的判斷門檻）----
    {
      key: CONFIG_KEYS.SOFT_METRIC_RATIO_TOLERANCE, type: CONFIG_TYPES.DEC, group: 'SOFT_METRIC',
      defaultValue: String(DEFAULTS.SOFT_METRIC_RATIO_TOLERANCE),
      description: '「軟規則實測量度」判斷比例型指標（主席兼報告％、報告連續兩週％）'
        + '偏離歷史基準多少才算不正常。0.05＝相差 5 個百分點以內算正常。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SOFT_METRIC_COUNT_TOLERANCE_RATIO, type: CONFIG_TYPES.DEC, group: 'SOFT_METRIC',
      defaultValue: String(DEFAULTS.SOFT_METRIC_COUNT_TOLERANCE_RATIO),
      description: '「軟規則實測量度」判斷次數型指標（總用人數、平均次數、最高次數）的容差比例。'
        + '0.2＝跟歷史基準相差 20% 以內算正常。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.SOFT_METRIC_POST_USAGE_MIN_RATIO, type: CONFIG_TYPES.DEC, group: 'SOFT_METRIC',
      defaultValue: String(DEFAULTS.SOFT_METRIC_POST_USAGE_MIN_RATIO),
      description: '「軟規則實測量度」判斷某崗位人手是否過度集中：實際動用人數 ÷ 合資格人數'
        + '低於這個比例就標為偏低。0.5＝合資格的人整季有一半以上從未被派到就提示。',
      editable: 'TRUE'
    },
    // ---- PUBLIC（第十一輪批次階段 A：一季一條固定連結）----
    {
      key: CONFIG_KEYS.PUBLIC_ROSTER_FILE_NAME_PATTERN, type: CONFIG_TYPES.STR, group: 'PUBLIC',
      defaultValue: DEFAULTS.PUBLIC_ROSTER_FILE_NAME_PATTERN,
      description: '公開試算表檔案的命名樣板，支援 {QuarterID}。只影響「發佈公開職事表」'
        + '第一次建立檔案時的名稱，之後覆寫不會改檔名。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PUBLIC_ROSTER_DATE_FORMAT, type: CONFIG_TYPES.STR, group: 'PUBLIC',
      defaultValue: DEFAULTS.PUBLIC_ROSTER_DATE_FORMAT,
      description: '公開/個人頁面日期欄嘅顯示格式，支援 {M}（月）與 {d}（日）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.PUBLIC_ROSTER_BLANK_NOTE, type: CONFIG_TYPES.STR, group: 'PUBLIC',
      defaultValue: DEFAULTS.PUBLIC_ROSTER_BLANK_NOTE,
      description: '公開/個人頁面代替「EmptyDisplay=BLANK」崗位空白格嘅通用說明文字'
        + '（例如獻花、翻譯）。留空則維持顯示空白。',
      editable: 'TRUE'
    },
    // ---- ICS（第十一輪批次階段 C：日曆檔）----
    {
      key: CONFIG_KEYS.ICS_SERVICE_START_TIME, type: CONFIG_TYPES.STR, group: 'ICS',
      defaultValue: DEFAULTS.ICS_SERVICE_START_TIME,
      description: '崇拜預設開始時間（HH:mm，24 小時制）。個別崗位的提早到場時間見 Posts 的 '
        + 'EarlyArrivalMinutes 欄，不在這裡設定。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.ICS_SERVICE_END_TIME, type: CONFIG_TYPES.STR, group: 'ICS',
      defaultValue: DEFAULTS.ICS_SERVICE_END_TIME,
      description: '崇拜預設結束時間（HH:mm，24 小時制），日曆事件的結束時間一律用這個'
        + '（提早到場只影響開始時間，不影響結束時間）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.V0_PROTECT, type: CONFIG_TYPES.BOOL, group: 'GENERATOR',
      defaultValue: 'FALSE',
      description: '多次生成揀最佳結果後，是否自動為 v0 加上保護（只留 SCRIPT_ACCOUNT_EMAIL 可編輯）。',
      editable: 'TRUE'
    },
    // ---- FINETUNE / MULTIRUN ----
    {
      key: CONFIG_KEYS.FINETUNE_MAX_MOVES, type: CONFIG_TYPES.INT, group: 'FINETUNE',
      defaultValue: String(DEFAULTS.FINETUNE_MAX_MOVES),
      description: '「檢查改動」一次最多提出幾項最小改動建議。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.WARN_ON_SEMI_HARD_BREAK, type: CONFIG_TYPES.BOOL, group: 'FINETUNE',
      defaultValue: 'TRUE',
      description: '「檢查改動」／「套用修改申報」重跑規則檢查時，SEMI_HARD 級別的違反是否'
        + '要回報。TRUE（預設，維持原行為）＝回報；FALSE＝只回報 HARD，不理 SEMI_HARD'
        + '（HARD 一律回報，不受這個開關影響）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.MULTIRUN_ATTEMPTS, type: CONFIG_TYPES.INT, group: 'MULTIRUN',
      defaultValue: String(DEFAULTS.MULTIRUN_ATTEMPTS),
      description: '「生成職事表」／「多次生成比較」預設嘗試幾次、揀最貼近歷史基準的一份。',
      editable: 'TRUE'
    },
    // ---- WEBAPP ----
    {
      key: CONFIG_KEYS.WEBAPP_ENABLED, type: CONFIG_TYPES.BOOL, group: 'WEBAPP',
      defaultValue: 'FALSE',
      description: '追加階段 AV：Web UI 總開關。FALSE（預設）＝即使已經 deploy 成 Web App，'
        + 'doGet() 與全部 api* 函式一律拒絕運作，只回傳說明頁。要啟用 Web UI，'
        + '必須先確定 appsscript.json 的 webapp 存取權限設定正確，再把這格改成 TRUE。'
        + '不確定就保持 FALSE。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, type: CONFIG_TYPES.LIST, group: 'WEBAPP',
      defaultValue: '',
      description: '追加階段 AV：可以使用 Web UI 的電郵白名單（逗號分隔）。留空時只允許'
        + 'SCRIPT_ACCOUNT_EMAIL 那一個人——空白代表「只有預設那一位」，不是「任何人」。'
        + '這是 appsscript.json 部署權限之外的第二道防線，即使部署設定日後被改鬆'
        + '（例如誤設成任何人皆可存取），這一關仍然會擋住不在名單內的人。',
      editable: 'TRUE'
    },
    // ---- HWCAS（會友系統同步，全部選填——留空只是代表這個同步功能還沒設定）----
    {
      key: CONFIG_KEYS.HWCAS_SPREADSHEET_ID, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 會友資料試算表的 ID。留空代表尚未設定，執行「從 HWCAS 取電郵」會報錯。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_MEMBERS_SHEET, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: DEFAULTS.HWCAS_MEMBERS_SHEET,
      description: 'HWCAS 試算表中會友名冊所在的工作表名稱。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_READ_COLUMNS, type: CONFIG_TYPES.LIST, group: 'HWCAS',
      defaultValue: '',
      description: '唯讀讀取 HWCAS 時只逐欄讀取的欄位清單（逗號分隔）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_COL_NAME, type: CONFIG_TYPES.LIST, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 姓名欄對應的欄名（可多個，逗號分隔）。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_COL_EMAIL, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 電郵欄對應的欄名。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_COL_MEMBER_NO, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 會眾編號欄對應的欄名。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_COL_LAST_ATTENDANCE, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 最後出席欄對應的欄名。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_COL_MEETING_POINT, type: CONFIG_TYPES.STR, group: 'HWCAS',
      defaultValue: '',
      description: 'HWCAS 聚會點欄對應的欄名。',
      editable: 'TRUE'
    },
    {
      key: CONFIG_KEYS.HWCAS_CONGREGATION_PREFIXES, type: CONFIG_TYPES.LIST, group: 'HWCAS',
      defaultValue: '',
      description: '會眾編號前綴對照（格式「前綴:堂會:身分」，逗號分隔多項）；留空時'
        + '退回程式內建的 HWCAS_CONGREGATION_PREFIX_DEFAULT。',
      editable: 'TRUE'
    }
  ];
}

/**
 * 已知「CONFIG_KEYS 有登記、但這份補建清單刻意沒收錄」的 Key 與原因，
 * 供 checkConfigKeyRegistryGaps_() 判斷一個落差是「刻意排除、已知」還是「意外遺漏」。
 * 只收錄「目前完全沒有任何程式碼實際讀取」的 Key——不是本次 bug 的範圍
 * （bug 的定義是「程式碼用到但沒有登記」），列出來只是讓你知道它們存在。
 *
 * 追加階段 T：原本這裡列的 5 個「假設定」逐一查證過——
 * `ATTACH_FORMAT`／`HWCAS_SYNC_MODE`／`MAIL_SKIP_NO_EMAIL_ACTION` 確認沒有對應的
 * 程式邏輯可以接上，已從 CONFIG_KEYS 移除（幹事會自行刪除 Config 工作表對應的行）；
 * `RESEND_ONLY_CHANGED`／`WARN_ON_SEMI_HARD_BREAK` 找到明確對應的硬編碼位置，
 * 已接上（見 Mailer.gs 的 deliverOne_()、FineTune.gs 的 buildFineTuneContext_()），
 * 現在有程式碼實際讀取，已移到 getConfigKeySeeds_()，不再算「未使用」。
 * @returns {Object.<string, string>} {Key: 原因}
 */
function getConfigKeyKnownUnusedKeys_() {
  return {};
}

/**
 * 自我檢查：比對 CONFIG_KEYS 的完整登記清單與 getConfigKeySeeds_() 實際涵蓋的範圍，
 * 找出任何「CONFIG_KEYS 有、補建清單沒有」的落差，分成「已知且無害」（見
 * getConfigKeyKnownUnusedKeys_()）與「未預期」兩類。「未預期」代表日後又發生了
 * 跟 GRID_PENDING_FILL_COLOR 同一種疏漏——新增了 Config Key 但忘記把它加進
 * getConfigKeySeeds_()。這個檢查不需要真的去解析程式碼原始碼（Apps Script 環境
 * 沒有簡單的方法讀自己的原始碼），改用 CONFIG_KEYS 本身當作「程式碼用到的 Key」的
 * 可靠代理——目前逐一核對過，CONFIG_KEYS 之外沒有任何 getConfig() 呼叫用到別的
 * Key 名稱，所以只要日後新 Key 都照專案慣例先加進 CONFIG_KEYS，這個檢查就抓得到。
 * @returns {{unexpectedGaps: string[], knownGaps: Object[]}}
 *   unexpectedGaps 為需要留意的 Key 名稱；knownGaps 每項為 {key, reason}
 */
function checkConfigKeyRegistryGaps_() {
  const seeded = {};
  getConfigKeySeeds_().forEach(function (s) { seeded[s.key] = true; });
  const knownUnused = getConfigKeyKnownUnusedKeys_();

  const unexpectedGaps = [];
  const knownGaps = [];
  Object.keys(CONFIG_KEYS).forEach(function (name) {
    const key = CONFIG_KEYS[name];
    if (seeded[key]) return;
    if (knownUnused[key]) {
      knownGaps.push({ key: key, reason: knownUnused[key] });
    } else {
      unexpectedGaps.push(key);
    }
  });
  return { unexpectedGaps: unexpectedGaps, knownGaps: knownGaps };
}

/**
 * 檢查 Config 工作表目前缺少哪些程式碼會用到的 Key（只讀，不寫入），
 * 同時附上 checkConfigKeyRegistryGaps_() 的自我檢查結果，以及反方向的檢查：
 * 工作表上有、但 CONFIG_KEYS 完全沒有登記的 Key（extraInSheet）——
 * 追加階段 J 新增，用途是日後從 CONFIG_KEYS 移除一個 Key 時（例如這次的
 * ATTACH_FORMAT／HWCAS_SYNC_MODE／MAIL_SKIP_NO_EMAIL_ACTION），工作表上
 * 對應的行不會自動消失，這裡會主動點名，提醒你去手動刪除那一行，
 * 而不是要你自己回想「上次是不是有 Key 被移除了」。
 * @returns {{missing: Object[], registryGaps: {unexpectedGaps: string[], knownGaps: Object[]},
 *   extraInSheet: string[]}}
 *   missing 為缺少的 Key 定義清單（getConfigKeySeeds_() 的子集）；
 *   extraInSheet 為工作表有、CONFIG_KEYS 沒有登記的 Key 名稱清單
 */
function planConfigKeySeed_() {
  const existingKeys = {};
  readSheet(SHEETS.CONFIG).forEach(function (row) {
    const key = row[COLUMNS.CONFIG.KEY];
    if (key) existingKeys[String(key)] = true;
  });
  const registeredKeys = {};
  Object.keys(CONFIG_KEYS).forEach(function (name) { registeredKeys[CONFIG_KEYS[name]] = true; });
  const extraInSheet = Object.keys(existingKeys).filter(function (key) { return !registeredKeys[key]; }).sort();

  return {
    missing: getConfigKeySeeds_().filter(function (s) { return !existingKeys[s.key]; }),
    registryGaps: checkConfigKeyRegistryGaps_(),
    extraInSheet: extraInSheet
  };
}

/**
 * 追加階段 P：逐行核對 Config 工作表的實際內容，只讀不寫，供「檢查 Config 行數
 * （唯讀）」使用。跟 planConfigKeySeed_() 的差異：那邊用 readSheet()（會靜靜略過
 * 整行全空的列，也不記錄列號，且用物件當 Set 判斷 Key 存不存在時，同一個 Key
 * 出現兩次會被合併成一次、完全看不出來），這裡改用 getRange().getValues() 逐格
 * 讀取、自己保留列號，才有辦法回報「哪一列是空白」「哪個 Key 重複、重複在哪幾列」
 * 這種 planConfigKeySeed_() 天生看不到的資訊。
 * @returns {{totalDataRows: number, keyedRowCount: number, blankKeyRows: number[],
 *   duplicateKeys: Object.<string, number[]>, distinctKeyCount: number,
 *   extraInSheet: string[], missingFromSheet: string[]}}
 *   totalDataRows 為第 3 行起的資料列總數；blankKeyRows 為 Key 欄空白的列號；
 *   duplicateKeys 為 {Key: 出現的列號陣列}，只列出現 2 次以上的 Key；
 *   extraInSheet／missingFromSheet 為工作表與 CONFIG_KEYS 兩邊互相沒有的 Key
 */
function planConfigRowAudit_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.CONFIG);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const totalDataRows = Math.max(0, lastRow - 2);

  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const keyCol = headers.indexOf(COLUMNS.CONFIG.KEY);
  if (keyCol === -1) throw new Error('Config 工作表缺少 Key 欄（第 2 行標題列找不到 "' + COLUMNS.CONFIG.KEY + '"）');

  const values = totalDataRows > 0 ? sheet.getRange(3, 1, totalDataRows, lastCol).getValues() : [];
  const rowsByKey = {};
  const blankKeyRows = [];

  values.forEach(function (row, i) {
    const sheetRow = i + 3;
    const key = String(row[keyCol] || '').trim();
    if (!key) {
      blankKeyRows.push(sheetRow);
      return;
    }
    if (!rowsByKey[key]) rowsByKey[key] = [];
    rowsByKey[key].push(sheetRow);
  });

  const duplicateKeys = {};
  Object.keys(rowsByKey).forEach(function (key) {
    if (rowsByKey[key].length > 1) duplicateKeys[key] = rowsByKey[key];
  });

  const registeredKeys = {};
  Object.keys(CONFIG_KEYS).forEach(function (name) { registeredKeys[CONFIG_KEYS[name]] = true; });
  const sheetKeys = Object.keys(rowsByKey);
  const extraInSheet = sheetKeys.filter(function (key) { return !registeredKeys[key]; }).sort();
  const missingFromSheet = Object.keys(registeredKeys).filter(function (key) { return !rowsByKey[key]; }).sort();

  return {
    totalDataRows: totalDataRows,
    keyedRowCount: totalDataRows - blankKeyRows.length,
    blankKeyRows: blankKeyRows,
    duplicateKeys: duplicateKeys,
    distinctKeyCount: sheetKeys.length,
    extraInSheet: extraInSheet,
    missingFromSheet: missingFromSheet
  };
}

/**
 * 把缺少的 Key 定義寫入 Config（附加在現有資料之後）。
 * 只新增，絕不覆寫或改動任何既有行；呼叫前應先用 planConfigKeySeed_() 確認清單。
 * @param {Object[]} missing 要新增的 Key 定義清單
 * @returns {number} 實際寫入的行數
 */
function seedConfigKeys_(missing) {
  if (missing.length === 0) return 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.CONFIG);

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const C = COLUMNS.CONFIG;
  const now = nowTimestamp_();
  const actor = Session.getActiveUser().getEmail();

  const rows = missing.map(function (s) {
    const record = {};
    record[C.KEY] = s.key;
    record[C.VALUE] = s.defaultValue;
    record[C.TYPE] = s.type;
    record[C.GROUP] = s.group;
    record[C.DEFAULT] = s.defaultValue;
    record[C.DESCRIPTION] = s.description;
    record[C.EDITABLE] = s.editable;
    record[C.UPDATED_AT] = now;
    record[C.UPDATED_BY] = actor;
    return headers.map(function (h) { return record[h] === undefined ? '' : record[h]; });
  });

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, rows.length, headers.length).setValues(rows);
  applyTimestampFormat_(sheet, headers, [C.UPDATED_AT], targetRow, rows.length);
  return rows.length;
}
