/**
 * 集中管理所有工作表名稱與欄位名稱常數，避免字串寫死在多個檔案中。
 * 修改試算表欄位時只需更新此處。
 */

const SHEETS = {
  CONFIG: 'Config',
  POSTS: 'Posts',
  NAME_MAPPING: 'NameMapping',
  NAME_ALIAS: 'NameAlias',
  ELIGIBILITY: 'Eligibility',
  SERVICE_DATES: 'ServiceDates',
  SPECIAL_SUNDAYS: 'SpecialSundays',
  UNAVAILABLE: 'Unavailable',
  RULE_SETTINGS: 'RuleSettings',
  QUARTERS: 'Quarters',
  ROSTER_VERSIONS: 'RosterVersions',
  ROSTER_ASSIGNMENTS: 'RosterAssignments',
  EMAIL_RECIPIENTS: 'EmailRecipients',
  EMAIL_TEMPLATES: 'EmailTemplates',
  SEND_LOG: 'SendLog',
  FINE_TUNE_PROPOSALS: 'FineTuneProposals',
  AUDIT_LOG: 'AuditLog',
  NAME_MAPPING_DRAFT: 'NameMapping_Draft',
  SELF_TEST_RESULT: 'SelfTest_Result',
  TUNE_RESULT: 'Tune_Result',
  MULTIRUN_RESULT: 'MultiRun_Result',
  REQUESTS: 'Requests',
  DIAGNOSTICS: 'Diagnostics',
  // 第三十二輪批次階段 B：全季流程演練嘅跨段狀態。
  // ⚠️ 用工作表唔用 `PropertiesService`——connector 讀唔到 Properties，
  // 而演練狀態正正係開發時每一輪都要讀得到嗰樣嘢。
  REHEARSAL_STATE: 'RehearsalState',
  // 階段 B（Opus 深度輪）新增：歸檔用的封存表。封存是**搬移不是刪除**——
  // 原始列完整搬到這兩張表，隨時可以人手查閱或搬回去。見 Archive.gs。
  SEND_LOG_ARCHIVE: 'SendLog_Archive',
  ROSTER_ASSIGNMENTS_ARCHIVE: 'RosterAssignments_Archive',
  // 第十一輪批次階段 A：一季一條固定連結。每個季度對應一個**獨立公開試算表
  // 檔案**（不是主試算表裡的分頁），檔案 ID／網址／發佈紀錄記在這張表。
  // 見 PublicRoster.gs 的檔頭說明。
  PUBLIC_LINKS: 'PublicLinks',
  // 第十六輪批次階段 A：教會身分名單（堂委／執事）與個人崗位排除。
  // 兩張表都是**可選的**——不存在時 readRolesSafe_()／readPersonPostExclusionsSafe_()
  // 回傳空陣列，全部相關規則自動失效，舊環境完全不受影響。見 Roles.gs 檔頭。
  ROLES: 'Roles',
  PERSON_POST_EXCLUSIONS: 'PersonPostExclusions',
  // 第二十六輪批次階段 C：排表偏好（某人 × 某崗位 → 比平均多／少 N 次）。
  PERSON_POST_WEIGHT: 'PersonPostWeight'
};

/**
 * 階段 B（Opus 深度輪）：封存時一定要保留、不可搬走的「最近幾多個季度」。
 *
 * 為什麼一定要保留最近的季度，不可以只看「季度已結束」：
 * `readPriorWeeks_()`（Generator.gs）在生成新一季時，會讀取**季度開始日之前**
 * 最後 CARRY_OVER_WEEKS 個主日的派工紀錄，用來判斷跨季界的「連續兩週同一人」。
 * 如果把緊接的上一季封存走，新一季第一週就會失去比對基準，可能排出「上季
 * 最後一週同一人、今季第一週又是他」而系統不知道。
 *
 * 預設 2＝「目前正在處理的一季」＋「它前面那一季」。CARRY_OVER_WEEKS 通常是
 * 1–2 週，一整季（約 13 週）遠遠覆蓋得到；planArchive_() 另外會檢查
 * CARRY_OVER_WEEKS 有沒有大到連保留的季度都不夠，不夠會明確警告。
 */
const ARCHIVE_KEEP_RECENT_QUARTERS = 2;

/** 執行封存時要逐字輸入的確認文字，沿用「確認重設」「確認清理」的既有慣例。 */
const ARCHIVE_CONFIRM_TEXT = '確認封存';

/**
 * 階段 B（Opus 深度輪）：「🩺 全面體檢」提示「建議規劃封存」的行數門檻。
 *
 * 這幾張表只增不減、readSheet() 每次整表讀取（見 docs/系統範圍稽核.md 第六輪
 * 階段 D 的規模評估）。門檻的用途只是**提早提醒**，不是「超過就會壞」——
 * 現時真實資料約 762 行 SendLog，離門檻還很遠。
 */
const ARCHIVE_SIZE_HINT_ROWS = {
  SEND_LOG: 5000,
  ROSTER_ASSIGNMENTS: 10000,
  AUDIT_LOG: 10000
};

/**
 * 多次生成揀最好的時間預算（毫秒）。
 * Apps Script 上限為 6 分鐘，這裡只用 3 分鐘，其餘留給建表、寫長表與登記版本。
 */
const MULTIRUN_TIME_BUDGET_MS = 180000;

/**
 * 階段 A（Opus 深度輪）新增：generateBest() 用來偵測「換 seed 到底有沒有令
 * 結果不同」的探測次數。
 *
 * 背景：generateBest() 的設計是「用多個不同的 seed 各生成一份，再揀最貼近
 * 歷史基準的一份」，但 seed 唯一的用途是 pickPerson_() 裡的 `tieBreak`，
 * 而 tieBreak 只在**兩位候選人的 score 與 selectionScore 完全相等**時才會被
 * 拿來比較（見 compareCandidates_()）。selectionScore 是連續浮點數，實務上
 * 極少完全相等——用假資料實測 30 個不同 seed，30 份職事表逐格完全一樣。
 * 換言之在這種資料下，跑 20 次等於把同一份表算 20 次，白花 20 倍時間
 * （而且這是步驟 1 最耗時的部分，時間預算 3 分鐘）。
 *
 * 這個常數控制「先試幾次來判斷 seed 有沒有影響」：頭 N 次如果產生完全相同的
 * 職事表，就當作這份資料下 seed 無效、提早停止。**這個提早停止不會改變輸出**
 * ——isBetterCandidate_() 用嚴格小於（`deviation < best.deviation`）比較，
 * 一份與已有候選完全相同的職事表 deviation 必然相等、不可能勝出，所以略過
 * 它們之後選出的「最佳」跟跑足全部次數是同一份。
 *
 * 刻意做成「用實際結果判斷」而不是寫死跳過：真實資料如果真的出現同分候選人，
 * 換 seed 就會產生不同結果，這時偵測不成立、會照樣跑足設定的次數。
 */
const MULTIRUN_SEED_PROBE_ATTEMPTS = 3;

/** 參數掃描要試的組合，以及分批執行的設定。 */
/**
 * 參數掃描要試嘅值。
 *
 * ## ⚠️ 第十八輪批次階段 B：`CHAIR_DUAL_BONUS` 舊值 `[30,45,60,75]` 全部落喺飽和區
 *
 * 現象：12 組掃描結果入面，同一個 `WEIGHT_HISTORICAL` 之下，
 * `CHAIR_DUAL_BONUS` 由 30 加到 75，六項指標**四位小數完全一樣**。
 *
 * 追查結論：**參數本身有生效，只係舊 grid 全部取樣喺飽和區。** 實測掃描
 * （13 週 × 60 人 fixture，同一個 seed）：
 *
 * | 值 | 用人 | 兼任週 | 對上一個值有冇分別 |
 * |---|---|---|---|
 * | 0–10 | 43 | 0 | 冇（加分太細，壓唔過選人分數差距） |
 * | 15 | 43 | 6 | **有** |
 * | 20 | 45 | 7 | **有** |
 * | 25 | 45 | 5 | **有** |
 * | 30／45／60／75／150／500 | 45 | 5 | **完全冇**（已經飽和） |
 *
 * 機制：`score = penalty − bonus − selectionScore × selectionWeight`。
 * 呢個 bonus 係一個**固定加分**，畀所有「雙重合資格而且未達標」嘅候選人。
 * 一旦佢大過候選人之間 `selectionScore × selectionWeight` 嘅最大差距
 * （`selectionWeight` 預設 45，`selectionScore` 正規化到 0–1，所以差距上限
 * 約 45，實務上因為候選池較細通常喺 20–25 左右），全部雙重合資格嘅人
 * 就已經穩定排喺全部非雙重合資格嘅人前面——再加大**改變唔到任何次序**。
 *
 * 所以呢個參數係一個**門檻型**參數，唔係連續型：有效區間喺 0 到約 25，
 * 之後完全飽和。新 grid 改為取樣有效區間，令掃描真係比較到嘢。
 *
 * 呢個飽和點會隨資料改變（候選池大細、歷史次數分佈都會影響
 * `selectionScore` 嘅差距），所以 grid 刻意由 0 開始、跨過整個過渡區，
 * 唔係寫死一個「已知門檻」。
 */
const TUNE_GRID = {
  CHAIR_DUAL_BONUS: [0, 10, 15, 20, 25, 30],
  WEIGHT_HISTORICAL: [0.5, 0.65, 0.8]
};

/**
 * 單次執行的時間預算（毫秒）。Apps Script 上限為 6 分鐘，
 * 這裡留 2 分鐘餘裕給寫入工作表與收尾，超時就把進度存起來下次繼續。
 */
const TUNE_TIME_BUDGET_MS = 240000;

/** 存放參數掃描進度的 Script Property 鍵名。 */
const TUNE_PROGRESS_KEY = 'roster_tune_progress';

/** 存放「產生個人 PDF」批次進度的 Script Property 鍵名。 */
const PDF_BATCH_PROGRESS_KEY = 'roster_pdf_batch_progress';

/**
 * 存放步驟 5「改動後重發」批次進度的 Script Property 鍵名。獨立於
 * PDF_BATCH_PROGRESS_KEY 之外，避免跟「準備工作 ▸ 產生個人 PDF」（處理全體）
 * 的進度互相覆蓋——兩者可能在同一個季度交替執行。
 */
const PDF_RESEND_BATCH_PROGRESS_KEY = 'roster_pdf_resend_batch_progress';

/**
 * 第十一輪批次階段 D：存放幹事介面深色/淺色偏好的 User Property 鍵名——只喺
 * 瀏覽器 localStorage 唔可用（例如 HtmlService sandbox 擋咗）時，前端先會退回
 * 用呢個 key 透過 PropertiesService.getUserProperties() 讀寫（見 WebApp.gs 的
 * apiGetThemePreference()／apiSetThemePreference()，ui/Script.html 的切換邏輯）。
 */
const WEBAPP_THEME_PROPERTY_KEY = 'roster_webapp_theme';

/**
 * 「產生個人 PDF」單次執行的時間安全網（毫秒）。Apps Script 上限為 6 分鐘，
 * 這裡留 2 分鐘餘裕給收尾；即使 Config 的 PDF_BATCH_SIZE 設得太大，
 * 一批處理到接近這個時間也會提早停止並存進度，不會被硬中斷。
 */
const PDF_BATCH_TIME_BUDGET_MS = 240000;

/** 由程式動態產生的工作表名稱前綴。 */
const SHEET_PREFIXES = {
  ROSTER: 'Roster_',
  VERIFY: 'Verify_',
  TEMP_PDF: '_TempPdf_'
};

const COLUMNS = {
  CONFIG: {
    KEY: 'Key',
    VALUE: 'Value',
    TYPE: 'Type',
    GROUP: 'Group',
    DEFAULT: 'Default',
    DESCRIPTION: 'Description',
    EDITABLE: 'Editable',
    UPDATED_AT: 'UpdatedAt',
    UPDATED_BY: 'UpdatedBy'
  },
  POSTS: {
    POST_ID: 'PostID',
    POST_NAME_TC: 'PostName_TC',
    POST_NAME_EN: 'PostName_EN',
    SLOT_COUNT: 'SlotCount',
    DISTINCT_WITHIN_POST: 'DistinctWithinPost',
    CATEGORY: 'Category',
    FREQUENCY: 'Frequency',
    AUTO_GENERATE: 'AutoGenerate',
    ALLOW_CONSECUTIVE: 'AllowConsecutive',
    MUTEX_GROUP: 'MutexGroup',
    DISPLAY_ORDER: 'DisplayOrder',
    ACTIVE: 'Active',
    NOTES: 'Notes',
    EMPTY_DISPLAY: 'EmptyDisplay',
    // 第十一輪批次階段 C：崗位提早到場分鐘數（見 PostSeed.gs 檔頭說明——
    // 為什麼是 Posts 欄而不是逐一開 Config Key）。留空視為 0（不提早）。
    EARLY_ARRIVAL_MINUTES: 'EarlyArrivalMinutes',
    // 第十六輪批次階段 B：擔任這個崗位必須具備的身分（ROLE_CODES 的值，
    // 逗號分隔＝**任何一個**符合即可，不是全部都要）。留空＝冇身分要求，
    // 呢個崗位嘅行為同以前完全一樣。
    //
    // 呢一欄就係規則 1／2 嘅「開關」：填咗先至有身分限制，冇填就當冇呢條規則。
    // 放喺 Posts 而唔係 RuleSettings，理由同 EarlyArrivalMinutes 一樣——
    // 「呢個崗位要咩身分」係崗位本身嘅屬性，逐崗位設定，Posts 本來就係
    // 「一個崗位一列」嘅資料結構。見 Roles.gs 檔頭。
    REQUIRED_ROLES: 'RequiredRoles'
  },
  NAME_MAPPING: {
    PERSON_ID: 'PersonID',
    NAME_TC: 'NameTC',
    NAME_EN: 'NameEN',
    MEMBER_NO: 'MemberNo',
    CONGREGATION: 'Congregation',
    MEMBER_TYPE: 'MemberType',
    MEETING_POINT: 'MeetingPoint',
    EMAIL: 'Email',
    EMAIL_SOURCE: 'EmailSource',
    EMAIL_VERIFIED_AT: 'EmailVerifiedAt',
    PHONE: 'Phone',
    LAST_ATTENDANCE: 'LastAttendance',
    ACTIVE: 'Active',
    MAX_PER_QUARTER: 'MaxPerQuarter',
    PREFERRED_POSTS: 'PreferredPosts',
    NOTES: 'Notes',
    SYNCED_AT: 'SyncedAt',
    // 第十一輪批次階段 B：個人專屬連結用嘅 token。見 WebAppPersonalLink.gs 檔頭說明。
    PERSONAL_LINK_TOKEN: 'PersonalLinkToken'
  },
  NAME_ALIAS: {
    ALIAS_ID: 'AliasID',
    ALIAS: 'Alias',
    PERSON_ID: 'PersonID',
    ALIAS_TYPE: 'AliasType',
    SOURCE: 'Source',
    ACTIVE: 'Active',
    NOTES: 'Notes'
  },
  ELIGIBILITY: {
    ELIGIBILITY_ID: 'EligibilityID',
    PERSON_ID: 'PersonID',
    POST_ID: 'PostID',
    ELIGIBLE: 'Eligible',
    HISTORICAL_COUNT: 'HistoricalCount',
    SOURCE: 'Source',
    ADDED_BY: 'AddedBy',
    ADDED_AT: 'AddedAt',
    ACTIVE: 'Active',
    NOTES: 'Notes'
  },

  // 第十六輪批次階段 A：教會身分名單。一個人可以有多行（同時係堂委又係執事、
  // 或者卸任之後再連任），靠 EffectiveFrom／EffectiveTo 分辨邊段時間有效。
  ROLES: {
    ROLE_ASSIGNMENT_ID: 'RoleAssignmentID',
    PERSON_ID: 'PersonID',
    ROLE_CODE: 'RoleCode',
    EFFECTIVE_FROM: 'EffectiveFrom',
    EFFECTIVE_TO: 'EffectiveTo',
    ACTIVE: 'Active',
    NOTES: 'Notes'
  },

  // 第十六輪批次階段 B：個人崗位排除（規則 3）。表達「某人暫時唔做某崗位，
  // 日後解除」——解除時**填 EffectiveTo，唔好刪除成行**，噉樣舊季度嘅職事表
  // 唔會因為今日解除咗而被追溯判定為違規（同 Roles 一樣嘅道理）。
  PERSON_POST_EXCLUSIONS: {
    EXCLUSION_ID: 'ExclusionID',
    PERSON_ID: 'PersonID',
    POST_ID: 'PostID',
    REASON: 'Reason',
    EFFECTIVE_FROM: 'EffectiveFrom',
    EFFECTIVE_TO: 'EffectiveTo',
    ACTIVE: 'Active',
    NOTES: 'Notes'
  },

  /**
   * 第二十六輪批次階段 C：排表偏好。
   *
   * 一個機制搞掂堂委三條規則（「某人多做／少做某崗位幾次」）——
   * 佢哋形狀完全一樣，唔使三套邏輯。
   *
   * ⚠️ **解除一筆偏好＝填 `EffectiveTo`，唔係刪行、唔係設 Active=FALSE。**
   * 同 PersonPostExclusions 一致：要睇得返「嗰陣時係點決定嘅」。
   */
  PERSON_POST_WEIGHT: {
    WEIGHT_ID: 'WeightID',
    PERSON_ID: 'PersonID',
    POST_ID: 'PostID',
    ADJUST: 'Adjust',
    REASON: 'Reason',
    EFFECTIVE_FROM: 'EffectiveFrom',
    EFFECTIVE_TO: 'EffectiveTo',
    ACTIVE: 'Active',
    CREATED_AT: 'CreatedAt',
    CREATED_BY: 'CreatedBy'
  },
  SERVICE_DATES: {
    SERVICE_DATE_ID: 'ServiceDateID',
    QUARTER_ID: 'QuarterID',
    SERVICE_DATE: 'ServiceDate',
    WEEK_INDEX: 'WeekIndex',
    IS_FIRST_SUNDAY_OF_MONTH: 'IsFirstSundayOfMonth',
    SERVICE_TYPE: 'ServiceType',
    SPECIAL_ID: 'SpecialID',
    AUTO_GENERATE: 'AutoGenerate',
    NOTES: 'Notes'
  },
  SPECIAL_SUNDAYS: {
    SPECIAL_ID: 'SpecialID',
    QUARTER_ID: 'QuarterID',
    SERVICE_DATE: 'ServiceDate',
    TYPE: 'Type',
    TITLE: 'Title',
    SKIP_POST_IDS: 'SkipPostIDs',
    LOCK_POST_IDS: 'LockPostIDs',
    EXTERNAL_OWNER: 'ExternalOwner',
    COMMUNION_OVERRIDE: 'CommunionOverride',
    TRANSLATION_REQUIRED: 'TranslationRequired',
    ACTIVE: 'Active',
    NOTES: 'Notes',
    // 第十六輪批次階段 D：日期本身係咪已經確認。
    //
    // ⚠️ **空白＝已確認**，只有明確填 FALSE 先當「未確認」——呢個方向係
    // 刻意揀嘅：呢一欄係後加嘅，如果空白當「未確認」，全部既有列一開機
    // 就會變成未確認，提醒機制即刻噴一堆假警報。判斷邏輯只有一個入口
    // `isUnconfirmedSpecialSunday_()`（AnnualCombined.gs），唔好喺其他
    // 地方另外寫一次 isTrueValue_ 判斷——方向搞錯咗就會完全相反。
    //
    // 用途：五月嗰次合堂（5 月 22 日前後）要出表時先向教會確認實際日期，
    // 年度合堂工具會寫一行建議日期並標 Confirmed=FALSE，提醒機制與生成
    // 完成畫面都會把佢揪出嚟。
    CONFIRMED: 'Confirmed'
  },
  UNAVAILABLE: {
    UNAVAILABLE_ID: 'UnavailableID',
    PERSON_ID: 'PersonID',
    DATE_FROM: 'DateFrom',
    DATE_TO: 'DateTo',
    APPLIES_TO: 'AppliesTo',
    POST_IDS: 'PostIDs',
    REASON: 'Reason',
    SOURCE: 'Source',
    STATUS: 'Status',
    CREATED_AT: 'CreatedAt',
    CREATED_BY: 'CreatedBy'
  },
  RULE_SETTINGS: {
    RULE_ID: 'RuleID',
    RULE_NAME: 'RuleName',
    LEVEL: 'Level',
    ENABLED: 'Enabled',
    SCOPE_POST_IDS: 'ScopePostIDs',
    TARGET_VALUE: 'TargetValue',
    TOLERANCE: 'Tolerance',
    PARAM_JSON: 'ParamJSON',
    ON_VIOLATION: 'OnViolation',
    PRIORITY: 'Priority',
    DESCRIPTION: 'Description'
  },
  QUARTERS: {
    QUARTER_ID: 'QuarterID',
    YEAR: 'Year',
    TERM: 'Term',
    START_DATE: 'StartDate',
    END_DATE: 'EndDate',
    WEEK_COUNT: 'WeekCount',
    GENERATE_ON: 'GenerateOn',
    // 追加階段 Q 查證過 RemindOn 是死欄位：全專案只有 computeAutomationSchedule_()
    // 讀過它，而且算出來的 remindDate 從沒有任何呼叫端使用（REMIND 當時已改由
    // REMIND_STUCK_DAYS／Quarters.StageUpdatedAt 驅動，不再是日期概念）。已依你的
    // 決定移除這個欄位的註冊與對應計算（computeAutomationSchedule_() 已同步移除
    // remindDate）。Quarters 工作表上原本的 RemindOn 欄本身還在（程式沒有自動刪除
    // 工作表上的欄），如果你已經人手刪掉了，這則註解可以忽略。第三輪批次下一輪
    // （新一批階段 B）的「死線接近」提醒維度改用 OfficialSendOn（下面這一欄）
    // 當參考日期，不是復活 RemindOn，見 Trigger.gs 的 judgeRemindAction_()。
    OFFICIAL_SEND_ON: 'OfficialSendOn',
    STATUS: 'Status',
    // 追加階段 T 查證過 CurrentVersion 是死欄位（沒有任何程式碼讀寫過），
    // 追加階段 I 已依你的決定移除這個欄位的註冊。「目前用哪個版本」一律由
    // findLatestVersionNo()（RosterWriter.gs）即時掃描 RosterVersions、
    // 取 VersionNo 最大值決定；四階段流程步驟 3（RequestsApply.gs 的
    // planApplyRequests_()）也是呼叫這個函式，不依賴任何欄位。
    // Quarters 工作表上原本的 CurrentVersion 欄本身還在（程式沒有自動刪除
    // 工作表上的欄），如果你已經人手刪掉了，這則註解可以忽略。
    NOTES: 'Notes',
    STAGE: 'Stage',
    STAGE_UPDATED_AT: 'StageUpdatedAt'
  },
  // 第十一輪批次階段 A 新增：一季一條固定連結。一列對應一個季度，
  // FileID 一旦建立就終身不變（覆寫內容不換檔案，見 PublicRoster.gs）。
  PUBLIC_LINKS: {
    QUARTER_ID: 'QuarterID',
    FILE_ID: 'FileID',
    FILE_URL: 'FileUrl',
    LAST_PUBLISHED_AT: 'LastPublishedAt',
    LAST_PUBLISHED_VERSION: 'LastPublishedVersion',
    SHARING_ACCESS: 'SharingAccess',
    SHARING_PERMISSION: 'SharingPermission',
    CREATED_AT: 'CreatedAt'
  },
  ROSTER_VERSIONS: {
    VERSION_ID: 'VersionID',
    QUARTER_ID: 'QuarterID',
    VERSION_NO: 'VersionNo',
    SHEET_NAME: 'SheetName',
    BASIS: 'Basis',
    PARENT_VERSION_NO: 'ParentVersionNo',
    STATUS: 'Status',
    PROTECTED: 'Protected',
    WARNING_COUNT: 'WarningCount',
    CREATED_AT: 'CreatedAt',
    CREATED_BY: 'CreatedBy',
    NOTES: 'Notes'
  },
  EMAIL_RECIPIENTS: {
    RECIPIENT_ID: 'RecipientID',
    GROUP_ID: 'GroupID',
    EMAIL: 'Email',
    DISPLAY_NAME: 'DisplayName',
    STAGE: 'Stage',
    SEND_AS: 'SendAs',
    ACTIVE: 'Active',
    NOTES: 'Notes',
    ROLE: 'Role'
  },
  EMAIL_TEMPLATES: {
    TEMPLATE_ID: 'TemplateID',
    STAGE: 'Stage',
    LANG: 'Lang',
    SUBJECT: 'Subject',
    BODY_HTML: 'BodyHtml',
    BODY_PLAIN: 'BodyPlain',
    PLACEHOLDERS: 'Placeholders',
    ATTACH_TYPE: 'AttachType',
    ACTIVE: 'Active',
    UPDATED_AT: 'UpdatedAt'
  },
  SEND_LOG: {
    SEND_ID: 'SendID',
    QUARTER_ID: 'QuarterID',
    VERSION_NO: 'VersionNo',
    STAGE: 'Stage',
    RECIPIENT_TYPE: 'RecipientType',
    PERSON_ID: 'PersonID',
    EMAIL: 'Email',
    DISPLAY_NAME: 'DisplayName',
    ASSIGNMENT_HASH: 'AssignmentHash',
    ASSIGNMENT_SUMMARY: 'AssignmentSummary',
    ATTACHMENT_NAME: 'AttachmentName',
    SENT_AT: 'SentAt',
    STATUS: 'Status',
    MESSAGE_ID: 'MessageId',
    ERROR_MESSAGE: 'ErrorMessage',
    TRIGGERED_BY: 'TriggeredBy'
  },
  FINE_TUNE_PROPOSALS: {
    PROPOSAL_ID: 'ProposalID',
    BATCH_ID: 'BatchID',
    QUARTER_ID: 'QuarterID',
    BASE_VERSION_NO: 'BaseVersionNo',
    SERVICE_DATE_ID: 'ServiceDateID',
    POST_ID: 'PostID',
    SLOT_INDEX: 'SlotIndex',
    ORIGINAL_PERSON_ID: 'OriginalPersonID',
    MANUAL_PERSON_ID: 'ManualPersonID',
    SUGGESTED_PERSON_ID: 'SuggestedPersonID',
    BROKEN_RULE_ID: 'BrokenRuleID',
    SEVERITY: 'Severity',
    REASON: 'Reason',
    DECISION: 'Decision',
    DECIDED_BY: 'DecidedBy',
    DECIDED_AT: 'DecidedAt',
    RESULT_VERSION_NO: 'ResultVersionNo'
  },
  AUDIT_LOG: {
    LOG_ID: 'LogID',
    TIMESTAMP: 'Timestamp',
    ACTOR: 'Actor',
    ACTION: 'Action',
    TARGET_SHEET: 'TargetSheet',
    TARGET_KEY: 'TargetKey',
    OLD_VALUE: 'OldValue',
    NEW_VALUE: 'NewValue',
    SOURCE: 'Source',
    NOTES: 'Notes'
  },
  ROSTER_ASSIGNMENTS: {
    ASSIGNMENT_ID: 'AssignmentID',
    QUARTER_ID: 'QuarterID',
    VERSION_NO: 'VersionNo',
    SERVICE_DATE_ID: 'ServiceDateID',
    SERVICE_DATE: 'ServiceDate',
    POST_ID: 'PostID',
    SLOT_INDEX: 'SlotIndex',
    PERSON_ID: 'PersonID',
    PERSON_NAME_SNAPSHOT: 'PersonNameSnapshot',
    ASSIGN_SOURCE: 'AssignSource',
    RULE_FLAGS: 'RuleFlags',
    LOCKED: 'Locked',
    UPDATED_AT: 'UpdatedAt',
    UPDATED_BY: 'UpdatedBy'
  },
  REQUESTS: {
    REQUEST_ID: 'RequestID',
    QUARTER_ID: 'QuarterID',
    SERVICE_DATE: 'ServiceDate',
    POST_NAME: 'PostName',
    PERSON_NAME: 'PersonName',
    REQUEST_TYPE: 'RequestType',
    STATUS: 'Status',
    RESULT_NOTE: 'ResultNote',
    CREATED_AT: 'CreatedAt',
    PROCESSED_AT: 'ProcessedAt',
    NOTES: 'Notes'
  },
  DIAGNOSTICS: {
    REPORT_NAME: 'ReportName',
    GENERATED_AT: 'GeneratedAt',
    SECTION: 'Section',
    ITEM: 'Item',
    VALUE: 'Value',
    NOTE: 'Note'
  },
  /**
   * 第三十二輪批次階段 B：演練跨段狀態。**最多一行。**
   * 演練全部行完之後成行清走——留低一行舊狀態會令下一次接續
   * 接住一個唔存在嘅演練。
   */
  REHEARSAL_STATE: {
    QUARTER_ID: 'QuarterID',
    STARTED_AT: 'StartedAt',
    SEGMENT: 'Segment',
    BASE_VERSION_NO: 'BaseVersionNo',
    STEPS_DONE: 'StepsDone',
    PDF_ROUNDS_DONE: 'PdfRoundsDone',
    PDF_DONE: 'PdfDone',
    STOPPED_BY: 'StoppedBy',
    UPDATED_AT: 'UpdatedAt',
    NOTES: 'Notes'
  }
};

/**
 * RuleSettings 工作表中使用的 RuleID。程式以這些 ID 向 RuleSettings 查詢
 * Level / Enabled / ScopePostIDs / TargetValue / Tolerance / ParamJSON / OnViolation / Priority，
 * 所有實際參數與嚴重程度一律以工作表內容為準，此處只是 ID 名稱的單一來源。
 */
/**
 * 第十六輪批次階段 A：教會身分代號。`Roles.RoleCode` 與 `Posts.RequiredRoles`
 * 兩邊都用呢一組值，兩邊必須一致（打錯字會令規則靜靜噉唔生效——所以
 * 「身分名單概況（唯讀）」會專門檢查 `Posts.RequiredRoles` 有冇引用到
 * 完全冇人持有嘅身分代號，見 `buildRoleOverviewRows_()`）。
 *
 * 用英文代號而唔係直接用中文「堂委」／「執事」：中文字喺試算表好容易
 * 因為輸入法而變成全形／異體字，肉眼睇唔出但比對唔到（第十五輪批次已經
 * 為咗同一類問題全面加咗 `normalizeIdInput_()`）。
 */
const ROLE_CODES = {
  COMMITTEE: 'COMMITTEE',
  DEACON: 'DEACON'
};

/**
 * 身分代號對應嘅中文顯示名。只用喺畀人睇嘅訊息（違規原因、報告、對話框），
 * 唔參與任何比對邏輯。呢度係**身分類別名**，唔係任何人嘅姓名。
 */
const ROLE_LABELS_TC = {
  COMMITTEE: '堂委',
  DEACON: '執事'
};

const RULE_IDS = {
  ELIGIBILITY: 'HARD_ELIGIBILITY',
  DISTINCT_SLOT: 'HARD_DISTINCT_SLOT',
  UNAVAILABLE: 'HARD_UNAVAILABLE',
  COMMUNION_FIRST_SUNDAY: 'HARD_COMMUNION_FIRST_SUNDAY',
  NO_AUTO_GENERATE: 'HARD_NO_AUTO_PREACHER',
  // 階段 A 新增：專門給 SpecialSundays.SkipPostIDs 造成的「這一週跳過」用，
  // 不跟 NO_AUTO_GENERATE 共用同一個 ID——這個崗位平常會自動生成，只是這一週
  // 因為特別主日而跳過，跟「這個崗位本來就永遠不自動生成」（講員／翻譯／獻花）
  // 語意不同，見 getSkipReason_()（Generator.gs）與 SPECIAL_SKIP_RULE_IDS。
  SPECIAL_SUNDAY_SKIP: 'HARD_SPECIAL_SUNDAY_SKIP',
  MUTEX_GROUP: 'HARD_MUTEX_GROUP',
  // 第十六輪批次階段 B（教會新規則 1／2）：呢個崗位要求某個身分，但獲派嘅人
  // 喺嗰個主日當日並唔持有任何一個所需身分。
  ROLE_REQUIRED: 'HARD_ROLE_REQUIRED',
  // 第十六輪批次階段 B（教會新規則 3）：PersonPostExclusions 明確排除咗
  // 呢個人做呢個崗位，而且喺嗰個主日當日仍然生效。
  PERSON_POST_EXCLUDED: 'HARD_PERSON_POST_EXCLUDED',
  NO_CONSECUTIVE: 'SEMI_NO_CONSECUTIVE',
  // 第十六輪批次階段 C（教會新規則 4）：堂委盡量集中喺指定嘅幾個崗位，
  // 其餘崗位盡量唔排。軟規則——排唔到人嗰陣仍然可以派，只係扣分。
  ROLE_POST_FOCUS: 'SOFT_ROLE_POST_FOCUS',
  CHAIR_EQ_ANNOUNCE: 'SOFT_CHAIR_EQ_ANNOUNCE',
  CHAIR_PREFER_DUAL: 'SOFT_CHAIR_PREFER_DUAL',
  ANNOUNCE_RELIEF: 'SOFT_ANNOUNCE_RELIEF',
  MAX_PER_QUARTER: 'SOFT_MAX_PER_QUARTER',
  LOAD_BALANCE: 'SOFT_LOAD_BALANCE',
  QUARTER_DISTRIBUTION: 'SOFT_QUARTER_DISTRIBUTION',
  PERSONAL_QUOTA: 'SOFT_PERSONAL_QUOTA'
};

/**
 * 「結構性不適用」的 RuleID 清單：該崗位在該週**根本不存在**，不是「留空待填」。
 * 目前只有一種情況——非首主日的聖餐襄禮（RULE_IDS.COMMUNION_FIRST_SUNDAY）。
 *
 * 注意 RULE_IDS.NO_AUTO_GENERATE**不在**這個清單裡：AutoGenerate=FALSE 的崗位
 * （講員／翻譯／獻花）是「崗位存在、只是不自動生成，要人手填」，跟「崗位不存在」
 * 是不同概念，顯示上要分開處理（見 Posts 的 EmptyDisplay 欄，RosterWriter.gs 的
 * buildGridLayout_() 與 WebApp.gs 的 apiGetRosterGrid()）。
 *
 * 日後如果有新崗位需要同樣「結構性不適用」的處理，把對應的 RuleID 加進這個陣列即可，
 * 顯示層（isStructuralNotApplicable_() / isStructuralNotApplicableFlagsText_()）
 * 不需要另外寫死崗位名稱。
 */
const STRUCTURAL_NA_RULE_IDS = [RULE_IDS.COMMUNION_FIRST_SUNDAY];

/**
 * 第十輪批次階段 A 新增：一格職事表的五種語意分類。判斷邏輯見 Generator.gs 的
 * `classifyGridCell_()`——全系統唯一的分類來源，顯示文字、底色、圖例計數、
 * 生成完成畫面的統計全部共用。
 *
 * - `ASSIGNED`：已經有人。
 * - `STRUCTURAL_NA`：這一週根本冇呢個崗位（聖餐襄禮只喺每月第一個主日）。
 * - `SPECIAL_SKIP`：呢個崗位平時有，只係呢一週因為特別主日而唔用系統排。
 * - `MANUAL_PENDING`：崗位存在，但系統設計上就唔會自動排（講員／翻譯／獻花），
 *   **預期中要人手填**，唔係出錯。
 * - `GENUINE_GAP`：系統應該排但排唔出（例如整池人當週都唔得閒）——
 *   **唯一真正代表「有問題、要優先處理」嘅一類**。
 *
 * `MANUAL_PENDING` 同 `GENUINE_GAP` 分開係本輪最重要嘅改動：兩者以前喺表上
 * 一模一樣，堂委分唔出「本來就要人手填」同「系統排唔到」。
 */
const GRID_CELL_CLASS = {
  ASSIGNED: 'ASSIGNED',
  STRUCTURAL_NA: 'STRUCTURAL_NA',
  SPECIAL_SKIP: 'SPECIAL_SKIP',
  MANUAL_PENDING: 'MANUAL_PENDING',
  GENUINE_GAP: 'GENUINE_GAP'
};

/**
 * 階段 A 新增：「本週因特別主日而跳過」的 RuleID 清單，跟上面的
 * STRUCTURAL_NA_RULE_IDS 是兩個不同概念，不可混用：
 * - STRUCTURAL_NA：這個崗位「根本不存在」（例如非首主日的聖餐襄禮），不需要
 *   任何人處理，顯示「—」。
 * - SPECIAL_SKIP：這個崗位平常會自動生成，只是「這一週」因為 SpecialSundays
 *   標記了 SkipPostIDs 而跳過（例如合堂週的領詩／司琴改由華語堂／英語堂負責），
 *   崗位本身沒有消失，只是這一週不用系統自動排——需要跟「這個崗位本來就永遠
 *   不自動生成，要人手填」（RULE_IDS.NO_AUTO_GENERATE，講員／翻譯／獻花）
 *   區分開，否則兩者在職事表上看起來一模一樣，幹事無法一眼分辨。
 * 顯示層見 RosterWriter.gs 的 isSpecialSundaySkip_()。
 */
const SPECIAL_SKIP_RULE_IDS = [RULE_IDS.SPECIAL_SUNDAY_SKIP];

/**
 * Posts.EmptyDisplay 欄可能出現的值，決定「崗位存在但留空」的格子要顯示什麼：
 * PENDING＝GRID_PENDING_LABEL（如「待確認」）、NA＝GRID_NOT_APPLICABLE_LABEL（如「—」）、
 * BLANK＝留空字串。欄位空白或值不是這三者之一時，一律當作 PENDING。
 * 「結構性不適用」（見 STRUCTURAL_NA_RULE_IDS）的優先級高於這個欄位設定，
 * 不理該崗位的 EmptyDisplay，一律顯示 NA。
 */
const POST_EMPTY_DISPLAY = {
  PENDING: 'PENDING',
  NA: 'NA',
  BLANK: 'BLANK'
};

/** RuleSettings 的 Level 欄可能出現的值。 */
const RULE_LEVELS = {
  HARD: 'HARD',
  SEMI_HARD: 'SEMI_HARD',
  SOFT: 'SOFT'
};

/**
 * 各 Level 對應的扣分權重（純屬演算法內部的計分機制，不是業務規則）。
 * 規則屬於哪個 Level 由 RuleSettings 決定；此處只定義「HARD 比 SEMI_HARD 重」的量級。
 */
const RULE_LEVEL_PENALTY = {
  HARD: 1000000,
  SEMI_HARD: 1000,
  SOFT: 10
};

/**
 * 第十六輪批次階段 B：規則喺 `RuleSettings` 工作表**冇對應一列**時，
 * 應該當佢係邊個級別。
 *
 * 點解需要呢個 map（呢個係本輪最容易出事嘅一點，寫清楚）：
 * `makeViolation_()`（Generator.gs）同 `findStateViolations_()` 嘅 `add()`
 * （FineTune.gs）兩處都係 `rule[LEVEL] || RULE_LEVELS.SOFT`——即係**規則列
 * 唔存在就當 SOFT**。對舊有規則冇問題（佢哋全部都預期幹事已經喺
 * RuleSettings 有一列），但對本輪兩條新硬規則係致命嘅：
 * 生成器排除候選人嘅條件係 `violations.some(v => v.level === HARD)`，
 * 級別跌做 SOFT 就變成「只扣 10 分」，一個唔係堂委嘅人照樣可以被派去做報告，
 * 而且畫面上完全睇唔出有嘢唔妥。
 *
 * 兩條新硬規則刻意設計成「唔使幹事去 RuleSettings 加一列都即刻生效」，
 * 因為佢哋真正嘅開關喺資料本身：
 * - `HARD_ROLE_REQUIRED` 要 `Posts.RequiredRoles` 有填先會檢查到嘢；
 * - `HARD_PERSON_POST_EXCLUDED` 要 `PersonPostExclusions` 有列先會檢查到嘢。
 * 兩者都係「冇資料＝完全冇影響」，所以預設啟用係安全嘅，反而預設停用會令
 * 幹事以為規則已經生效但其實冇。
 *
 * 冇列喺呢個 map 嘅規則維持原本行為（fallback 仍然係 SOFT）。
 */
const RULE_DEFAULT_LEVELS = {
  [RULE_IDS.ROLE_REQUIRED]: RULE_LEVELS.HARD,
  [RULE_IDS.PERSON_POST_EXCLUDED]: RULE_LEVELS.HARD
};

/**
 * 第十六輪批次階段 B：`RuleSettings` 冇對應一列時，預設當佢**啟用**嘅規則。
 * 理由同 `RULE_DEFAULT_LEVELS` 一樣（見上面），判斷入口係
 * `isRuleEnabledAllowingDefault_()`（Generator.gs）——其餘全部規則一律繼續用
 * `isRuleEnabled_()`（冇列＝停用），呢個行為冇改過。
 */
const RULE_DEFAULT_ENABLED = {
  [RULE_IDS.ROLE_REQUIRED]: true,
  [RULE_IDS.PERSON_POST_EXCLUDED]: true
};

/**
 * 排表計分的三個量級，全部可在 Config 覆寫（見 CONFIG_KEYS.SCORE_*）。
 * 這裡只是 Config 沒有設定時採用的預設值，程式一律經 readScoreWeights_() 取值。
 *
 * 參考關係：SOFT_QUARTER_DISTRIBUTION 的扣分約 40、SOFT_MAX_PER_QUARTER 約 60。
 * 獎勵分大於 40 才能突破「每季平均 3.3 次」的壓制；大於 60 則會連個人季度上限也蓋過。
 */
const SCORE_DEFAULTS = {
  CHAIR_DUAL_BONUS: 30,
  PREFERENCE_BONUS: 50,
  SELECTION_WEIGHT: 45
};

/**
 * 第二十六輪批次階段 C：排表偏好每一級（`Adjust` 每 ±1）嘅分數量級。
 *
 * 量級點揀：同 `SELECTION_WEIGHT`（45）同一個數量級，令一級偏好大致等於
 * 「壓過一次選人偏好」，即係大約一次派工嘅分別。太細（例如 5）幾乎冇效果、
 * 太大（例如 500）就會變成一條實際上唔可以違反嘅硬規則——而
 * `Adjust` **設計上係 soft**，永遠唔可以壓過硬規則。
 *
 * ⚠️ 就算調到好大都**唔可能**壓過硬規則：硬規則係喺
 * `clean = scored.filter(!hasHard)` 嗰度**先隔走**候選人，
 * 之後先比分數。所以呢個數字只影響「合規嘅人之間邊個優先」。
 */
const PERSON_POST_WEIGHT_STEP = 45;

/** `Adjust` 容許嘅範圍。超出範圍嘅行會被當成資料錯誤，唔會靜靜夾到範圍內。 */
const PERSON_POST_WEIGHT_MIN = -3;
const PERSON_POST_WEIGHT_MAX = 3;

/** 診斷用的 trace 每格最多記錄多少個候選人。 */
const TRACE_CANDIDATE_LIMIT = 6;

/**
 * RosterAssignments 的 AssignSource 欄可能出現的值。
 *
 * ⚠️ `FORCED` 是**歷史值，新生成的職事表不會再出現**：階段 A（Opus 深度輪）
 * 修正了 pickPerson_()——原本在「候選人池非空、但每個人都違反至少一條 HARD
 * 規則」時會硬派違規最輕的一個並標記 FORCED，即場造成硬規則違反；現在改為
 * 留空並發出警告（見 Generator.gs 的 pickPerson_() 說明）。
 *
 * 這個值**刻意保留不移除**：修正之前生成的版本（已經寫進 RosterAssignments
 * 的歷史資料）可能仍然含有 AssignSource=FORCED 的列，顯示層
 * （RosterWriter.gs 的 applyCellMarks_()、WebApp.gs 的 apiGetRosterGrid()）
 * 要繼續認得它，否則翻查舊版本時那些格會顯示不正常。
 */
const ASSIGN_SOURCE = {
  AUTO: 'AUTO',
  FORCED: 'FORCED',
  SKIPPED: 'SKIPPED',
  LOCKED: 'LOCKED',
  MANUAL: 'MANUAL',
  FINE_TUNED: 'FINE_TUNED'
};

/**
 * Quarters.Stage 欄可能出現的值：四階段流程的狀態機，只能依此順序前進，不可倒退。
 * REQUESTS_APPLIED 可以重複停留（步驟 3「套用修改申報」可以執行多次）。
 * Stage 只可由 FourStageFlow.gs 的四個步驟函式改動，其他地方一律只讀。
 */
const QUARTER_STAGE = {
  DRAFT: 'DRAFT',
  REVIEW_SENT: 'REVIEW_SENT',
  REQUESTS_APPLIED: 'REQUESTS_APPLIED',
  OFFICIAL_SENT: 'OFFICIAL_SENT'
};

/** QUARTER_STAGE 的順序，索引越大代表越後面的階段；requireQuarterStage_() 用來檢查合法性。 */
const QUARTER_STAGE_ORDER = [
  QUARTER_STAGE.DRAFT,
  QUARTER_STAGE.REVIEW_SENT,
  QUARTER_STAGE.REQUESTS_APPLIED,
  QUARTER_STAGE.OFFICIAL_SENT
];

/** Requests.RequestType 欄可能出現的兩個值（下拉選單直接顯示這兩個中文字串）。 */
const REQUEST_TYPE = {
  CANNOT_SERVE: '不能服侍',
  DESIGNATED_SERVE: '指定服侍'
};

/** Requests.Status 欄可能出現的值。留空視同 PENDING（見 RequestsApply.gs）。 */
const REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  REJECTED: 'REJECTED',
  NEEDS_INPUT: 'NEEDS_INPUT'
};

/** 職事表 grid 工作表第 2 行機器鍵中，日期相關欄位的固定鍵名。 */
const GRID_KEYS = {
  DATE: '_DATE',
  WEEK: '_WEEK',
  TYPE: '_TYPE'
};

/** 職事表 grid 工作表的標示底色。 */
const GRID_COLORS = {
  HEADER: '#D9EAD3',
  WARNING: '#FFF2CC',
  FORCED: '#F9CB9C',
  SKIPPED: '#EFEFEF',
  SPECIAL_SKIP: '#D9D2E9',
  STATS_HEADER: '#D9D9D9',
  PERSONAL_HIGHLIGHT: '#CFE2F3'
};

/**
 * 核對報告用的歷史基準值（來自 2025 T1 – 2026 T3 的實際服侍記錄）。
 * 平均次數與每季上限另有 RuleSettings 的 TargetValue 可查，此處只保留人數基準。
 */
const HISTORICAL_BASELINE = {
  PEOPLE_COUNT: 62,
  AVG_PER_PERSON: 3.3,
  MAX_PER_PERSON: 8,
  PEOPLE_TOLERANCE_RATIO: 0.2
};

/**
 * 歷史上每季服侍次數的實際分佈：{次數: 人數}，合計 62 人、平均 3.3、最高 8。
 *
 * 注意這個分佈明顯右偏，不是集中在平均值附近：
 * 大部分人每季只服侍 1–3 次，另有一小群核心義工做到 7–8 次。
 * 所以「每人上限 = 全體平均」的做法會同時壓住核心義工的次數與兼任比例。
 */
const HISTORICAL_BASELINE_DISTRIBUTION = {
  1: 17, 2: 11, 3: 14, 4: 7, 5: 2, 6: 1, 7: 3, 8: 7
};

/** 電郵寄送的階段。 */
const MAIL_STAGES = {
  GENERATE: 'GENERATE',
  REMIND: 'REMIND',
  OFFICIAL: 'OFFICIAL',
  RESEND: 'RESEND',
  REVIEW: 'REVIEW'
};

/**
 * EmailRecipients.Role 欄可能出現的值，供四階段流程的「步驟 2：寄給堂委審閱」判斷
 * 收件人。REVIEWER＝這次要收到審閱信；ALL＝一般收件人（沿用既有 Stage 欄的邏輯，
 * 不受這個新概念影響）。
 */
const RECIPIENT_ROLE = {
  REVIEWER: 'REVIEWER',
  ALL: 'ALL'
};

/** SendLog 的 Status 欄可能出現的值。 */
const MAIL_STATUS = {
  SENT: 'SENT',
  DRY_RUN: 'DRY_RUN',
  SKIPPED_NO_EMAIL: 'SKIPPED_NO_EMAIL',
  SKIPPED_UNCHANGED: 'SKIPPED_UNCHANGED',
  FAILED: 'FAILED',
  ERROR_PDF: 'ERROR_PDF',
  ERROR_PDF_MISSING: 'ERROR_PDF_MISSING'
};

/**
 * 第三十三輪批次階段 A：步驟 5「改動後重發」判定「這個人為什麼要收信」的理由。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 這個列舉存在的理由：**上游決定，下游執行。**
 * ─────────────────────────────────────────────────────────────────────
 *
 * `computeResendDiff_()`（ResendFlow.gs）是「誰要收信」的唯一真相來源。
 * 它已經知道每一個人要收信的原因，`deliverOne_()`（Mailer.gs）**不可以
 * 重新判斷一次**——第三十二輪的實測就是被這件事咬到：`deliverOne_()`
 * 自己用 hash 再判斷一次，把上游已經決定要寄的人擋了下來，
 * 令「補上電郵之後的第一封信」永遠寄不出去。
 *
 * 用具名理由而不是一個 `forceSend` 布林值：日後一定會有第三、第四種
 * 「內容沒變但仍然要寄」的情況（例如範本文字改了、個人 PDF 重新產生過），
 * 到時只需要在這裡加一個值，不需要再想一次布林值的語意該不該反轉。
 * 理由本身也是可以寫進報告與 SendLog 給人看的文字。
 */
const RESEND_NOTIFY_REASON = {
  /** 派工內容跟上次寄出時不同（hash 變了）——步驟 5 最常見的情況。 */
  ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED',
  /**
   * 派工內容一格都沒變，但上次因為 NameMapping 查無電郵被略過
   * （`SKIPPED_NO_EMAIL`），而現在電郵已經補上。
   * 對這個人來說這其實是**第一次**真正收到通知，不可以因為內容沒變而略過。
   */
  FIRST_NOTIFY_AFTER_EMAIL_ADDED: 'FIRST_NOTIFY_AFTER_EMAIL_ADDED'
};

/**
 * 第三十三輪批次階段 A2：`readLastSendRecordByPerson_()`（Mailer.gs）認定
 * 「這個人上一次已經確實被處理過」的 Status 白名單，以及每一個的理由。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 抽成常數的理由：這份名單原本只寫在 `readLastSendRecordByPerson_()`
 * 的檔頭註解裡，是一段隨時會跟程式碼脫節的散文。而它決定的是
 * 「步驟 5 拿什麼當比對基準」——基準錯了，整個步驟 5 就會靜靜地
 * 重複騷擾人或者永遠漏掉人，兩種都沒有錯誤訊息。
 * ─────────────────────────────────────────────────────────────────────
 *
 * | Status | 收不收 | 理由 |
 * | --- | --- | --- |
 * | `SENT` | ✅ | 真正寄出成功。 |
 * | `DRY_RUN` | ✅ | 模擬模式下完整計算過派工與 hash，只是沒有真的寄。 |
 * | `SKIPPED_NO_EMAIL` | ✅ | 查無電郵而略過，但派工與 hash 一樣完整計算過。**必須收**：不收的話，一個本來就沒有電郵、派工又完全沒變的人，會因為「查不到基準」被永遠誤判成「有改動」而重複出現。 |
 * | `SKIPPED_UNCHANGED` | ✅ | 第三十三輪階段 A 修好 `deliverOne_()` 之後，這個狀態的意思才變乾淨：「上一輪確實有基準、而且真的沒有改動」。詳見 `docs/系統範圍稽核.md` 第三十三輪階段 A2 的判斷。 |
 * | `FAILED`／`ERROR_PDF`／`ERROR_PDF_MISSING` | ❌ | 處理中途出錯，當時算出來的 hash 可能不完整或不可信，不可以當下次比對的基準。 |
 *
 * ⚠️ 加新 Status 到 `MAIL_STATUS` 時，一定要回來這裡決定它算不算基準。
 * `tests/resend_baseline_statuses.test.js` 會擋住「加了新 Status 但沒有在這裡表態」。
 */
const RESEND_BASELINE_STATUSES = [
  MAIL_STATUS.SENT,
  MAIL_STATUS.DRY_RUN,
  MAIL_STATUS.SKIPPED_NO_EMAIL,
  MAIL_STATUS.SKIPPED_UNCHANGED
];

/**
 * `RESEND_BASELINE_STATUSES` 刻意排除的 Status 與理由（給測試對照用，
 * 令「漏了表態」與「刻意排除」可以分辨）。
 */
const RESEND_NON_BASELINE_STATUSES = {
  FAILED: '寄送失敗，當時的 hash 未必完整',
  ERROR_PDF: '個人 PDF 產生失敗，當時的派工計算可能中斷',
  ERROR_PDF_MISSING: '個人 PDF 缺件，同上'
};

/**
 * 追加階段 AO：computeAssignmentHash_()（Mailer.gs）給「沒有任何派工」的人用的固定
 * 標記，取代原本回傳的空字串。原因：SendLog.AssignmentHash 欄若寫入空字串，跟這一欄
 * 「從來沒有被寫過」的真正空白儲存格在讀出來時完全無法分辨（兩者 getValues() 都是
 * ''），這種歧義在步驟 5「改動後重發」逐輪比對 hash 時會變成脆弱的隱性假設。改用這個
 * 固定、非空、跟真正的 16 位十六進位雜湊明顯不同的字串，讀寫兩邊都用同一個常數比對，
 * 不再依賴空字串巧合相等。
 */
const ASSIGNMENT_HASH_EMPTY = 'NO_ASSIGNMENTS';

/**
 * 會眾編號前綴對照的預設值，格式為「前綴:堂會:身分」。
 * Config 的 HWCAS_CONGREGATION_PREFIXES 一旦設定就以 Config 為準，此處只是後備。
 */
const HWCAS_CONGREGATION_PREFIX_DEFAULT = [
  '10:粵語堂:會友',
  '15:粵語堂:非會友',
  '30:英語堂:會友',
  '35:英語堂:非會友',
  '50:國語堂:會友',
  '55:國語堂:非會友'
];

/** NameMapping_Draft 工作表的欄位名稱。 */
const DRAFT_COLUMNS = {
  HWCAS_ROW: 'HWCAS 行號',
  HWCAS_NAME: 'HWCAS 姓名',
  HWCAS_EMAIL: 'HWCAS 電郵',
  MEMBER_NO: '會眾編號',
  LAST_ATTENDANCE: '最後出席',
  MEETING_POINT: '聚會點',
  PERSON_ID: 'PersonID',
  NAME_TC: 'NameMapping 姓名',
  EXISTING_EMAIL: '現有電郵',
  MATCH_TYPE: '配對結果',
  ACTION: '建議動作',
  NOTE: '備註'
};

/** HWCAS 電郵來源在 NameMapping.EmailSource 欄的標示值。 */
const EMAIL_SOURCE_HWCAS = 'HWCAS';

/** 試算表的地區設定（紐西蘭），令日期以 dd/MM/yyyy 而非美式 MM/dd/yyyy 顯示。 */
const SPREADSHEET_LOCALE_NZ = 'en_NZ';

/** 已套用的 fine-tune 提案封存工作表名稱。 */
const FINETUNE_ARCHIVE_SHEET = 'FineTuneProposals_Archive';

/**
 * 自動排程動作在 AuditLog 使用的 Action 值。GENERATE／REMIND 由 Trigger.gs 的
 * judgeGenerateAction_()／judgeRemindAction_() 使用，分別對應「同一季只成功
 * 生成一次初稿」與「目前這個 Stage 提醒過幾次、今天提醒過沒有」的判斷——REMIND
 * 的 AuditLog TargetKey 是 `quarterId + '|' + stage`，不是單純 quarterId，
 * 見 judgeRemindAction_() 與 readReminderLog_()。
 * OFFICIAL 追加階段 N 之後不再由自動排程使用（正式發出永遠只能由幹事手動觸發），
 * 保留這個值只是為了跟 Config 的 LEAD_DAYS_OFFICIAL 命名對應，不代表還有程式碼
 * 會拿它去查 AuditLog；真正阻擋自動觸發 OFFICIAL 的是 Trigger.gs 的
 * assertOfficialNotFromAutomationTrigger_()，寫入 AuditLog 時用的是另一個獨立的
 * 'OFFICIAL_BLOCKED_FROM_TRIGGER' 字串，不是這裡的 OFFICIAL。
 */
const AUTOMATION_ACTIONS = {
  GENERATE: 'TRIGGER_GENERATE',
  REMIND: 'TRIGGER_REMIND',
  OFFICIAL: 'TRIGGER_OFFICIAL'
};

/** 未填寫資料時常見的佔位文字標記，validateSetup() 用來偵測未完成設定的欄位。 */
const PLACEHOLDER_MARKER = '請填入';

/** HWCAS 配對初稿的配對結果類型。 */
const HWCAS_MATCH = {
  EXACT: 'EXACT',
  ALIAS: 'ALIAS',
  AMBIGUOUS: 'AMBIGUOUS',
  NONE: 'NONE',
  MISSING_IN_HWCAS: 'MISSING_IN_HWCAS'
};

/**
 * FineTuneProposals 的 Decision 欄可能出現的值，與資料表 schema 一致。
 * PENDING = 未決定；KEEP_MANUAL = 保留幹事的改動；
 * ACCEPT_SUGGESTED = 採用系統建議；REVERT_ORIGINAL = 還原為系統原本排的人。
 */
const FINETUNE_DECISION = {
  PENDING: 'PENDING',
  KEEP_MANUAL: 'KEEP_MANUAL',
  ACCEPT_SUGGESTED: 'ACCEPT_SUGGESTED',
  REVERT_ORIGINAL: 'REVERT_ORIGINAL'
};

/**
 * 即使級別是 SOFT，fine-tune 仍要回報的規則。
 *
 * 幹事人手改動有可能令某人超出每季次數上限，但 SOFT_MAX_PER_QUARTER 的級別是 SOFT，
 * 預設會被 findStateViolations_ 的 HARD／SEMI_HARD 過濾掉，變成完全不提示。
 * 這些規則回報時 Severity 仍維持 SOFT，不會污染核對報表的硬規則統計。
 */
const FINETUNE_REPORTED_SOFT_RULES = [
  RULE_IDS.MAX_PER_QUARTER
];

/** Decision 欄下拉選單的選項次序。 */
const FINETUNE_DECISION_OPTIONS = [
  FINETUNE_DECISION.PENDING,
  FINETUNE_DECISION.KEEP_MANUAL,
  FINETUNE_DECISION.ACCEPT_SUGGESTED,
  FINETUNE_DECISION.REVERT_ORIGINAL
];

/**
 * grid 格內代表「沒有派人」的佔位文字。
 * 比對幹事改動時，這些文字與空白一律視為相同，否則整季幾十個留空格會被誤判為人手改動。
 */
const GRID_PLACEHOLDER_TEXTS = ['待確認', '另行安排', '-', '—', '－', 'N/A', 'n/a'];

const CACHE_KEYS = {
  CONFIG: 'roster_config_cache'
};

const CACHE_DURATIONS = {
  CONFIG_SECONDS: 300
};

/**
 * Config 工作表中所有 Key 的名稱。程式一律透過此處存取，不直接寫字面值。
 */
const CONFIG_KEYS = {
  LEAD_DAYS_GENERATE: 'LEAD_DAYS_GENERATE',
  // 追加階段 Q：LEAD_DAYS_REMIND 查證後確認是死 Key（唯一讀它的
  // computeAutomationSchedule_() 算出來的 remindDate 從沒有任何呼叫端使用），
  // 已依你的決定移除註冊，連同種子清單（ConfigSeed.gs）一併移除。
  // REMIND 當時重新定義為「Stage 卡在 REVIEW_SENT 太久」的提醒，不再是日期概念。
  // 第三輪批次的下一輪（新一批 A-F 階段 B）再擴大：REMIND 現在涵蓋
  // DRAFT／REVIEW_SENT／REQUESTS_APPLIED 三種停滯情境（不只 REVIEW_SENT 一種），
  // 且新增 REMIND_DEADLINE_DAYS 這個獨立維度（見下）——但這次新增的死線判斷
  // 用的是 OfficialSendOn／LEAD_DAYS_OFFICIAL 算出來的日期，不是重新加回
  // LEAD_DAYS_REMIND，兩者概念不同：LEAD_DAYS_REMIND 是「季度開始後第幾日」，
  // 這次的死線判斷是「距離實際正式發出日期還有幾日」，語意更直接、也不需要
  // 復活一個已經查證過是死 Key 的東西。詳見 Trigger.gs 的 judgeRemindAction_()。
  LEAD_DAYS_OFFICIAL: 'LEAD_DAYS_OFFICIAL',
  REMIND_STUCK_DAYS: 'REMIND_STUCK_DAYS',
  REMIND_STUCK_MAX_COUNT: 'REMIND_STUCK_MAX_COUNT',
  // 新增：REMIND 的「死線接近」維度門檻（天數）。距離 Quarters.OfficialSendOn
  // （缺省時退回 Config 的 LEAD_DAYS_OFFICIAL 從 StartDate 推算）少於這個天數、
  // 而 Stage 仍未到 OFFICIAL_SENT，不論目前是哪個 Stage 都會觸發提醒——這是
  // 系統範圍需求第 3 項「季初前 4 週 +2 日寄提醒」的現代版本，對象改成只提醒
  // 幹事（不是義工），見 docs/系統範圍稽核.md。
  REMIND_DEADLINE_DAYS: 'REMIND_DEADLINE_DAYS',
  // 第二十五輪批次階段 A：到期自動生成初稿嘅總開關，預設 FALSE（關）。
  //
  // 點解預設關：真正操作系統嘅人唔識電腦。「系統靜靜幫你做咗一件事」
  // 比「你撳個掣先會發生」難教好多——幹事開頁見到已經有咗一份初稿，
  // 佢冇辦法分辨「係我上次撳咗」定「係系統自己做」，亦唔知應該信邊個。
  // 改成人手撳之後，**系統唔會自己動任何嘢**，全部行動由幹事發起。
  //
  // ⚠️ 自動生成嗰條程式碼路徑**完全冇刪**，只係喺入口加咗呢道開關。
  // 嗰條路徑已經測試過，將來想開返就改呢個值即刻有；而且符合本專案
  // 「一切須可配置，不可寫死」嘅原則——「唔要自動生成」係一個**決定**，
  // 唔應該用「刪走程式碼」去表達，否則改主意就要重新寫一次。
  //
  // 失去嘅安全網（幹事放假／病咗就冇人生成）由提醒 trigger 補返：
  // GenerateOn 到期而仍然冇任何版本，會每日提醒幹事去撳掣，見 Trigger.gs。
  TRIGGER_AUTO_GENERATE: 'TRIGGER_AUTO_GENERATE',
  // 第二十五輪批次階段 D：幹事介面嘅網址，供提醒信附連結用。
  //
  // 點解要一個 Config key 而唔係喺程式碼度問：呢個專案有兩個部署
  // （義工個人連結、幹事介面），`ScriptApp.getService().getUrl()` 只會回
  // 其中一個，而且喺 trigger 執行環境回嘅可能係 head 部署。
  // **一條打唔開嘅連結對一個唔識電腦嘅人比冇連結更差**——佢會以為系統壞咗。
  //
  // 所以唔靠估：由管理員部署完之後貼一次。留空就唔附連結（只附試算表）。
  WEBAPP_STEWARD_URL: 'WEBAPP_STEWARD_URL',
  // 第十七輪批次階段 C：T1～T4 各自由邊個月開始（逗號分隔嘅四個月份數字）。
  //
  // 點解要放 Config 而唔係寫死：教會嘅季度劃分未必係日曆季度（可能係學期制
  // 或者財政年度）。原本 `QUARTER_TERM_START_MONTH`（NewQuarterWizard.gs）
  // 係寫死嘅常數，改一次要改程式、重新 push——而呢個係一個**純粹嘅教會慣例**，
  // 完全應該由幹事自己喺試算表決定。預設值 `1,4,7,10` 就係原本寫死嗰套
  // （T1=1-3月、T2=4-6月、T3=7-9月、T4=10-12月），所以唔設定嘅話行為不變。
  QUARTER_TERM_START_MONTHS: 'QUARTER_TERM_START_MONTHS',
  // 第十六輪批次階段 D：提醒幹事「呢一季仲有未確認日期嘅特殊主日」嘅提前日數。
  // 距離自動生成日期（computeAutomationSchedule_() 算出嘅 generateDate）
  // 仲有唔夠呢個日數、而該季 SpecialSundays 有 Confirmed=FALSE 嘅列，
  // 就會觸發提醒。預設 7 日（生成前一星期），符合教會新規則第 5 條
  // 「5 月嗰次合堂要出表時先確認」——出表前一星期問，仲有時間去問。
  REMIND_UNCONFIRMED_SPECIAL_DAYS: 'REMIND_UNCONFIRMED_SPECIAL_DAYS',
  SEND_HOUR_LOCAL: 'SEND_HOUR_LOCAL',
  SEND_WEEKDAY_GUARD: 'SEND_WEEKDAY_GUARD',
  SYS_TIMEZONE: 'SYS_TIMEZONE',
  SYS_LOCALE: 'SYS_LOCALE',
  SYS_TIMESTAMP_FORMAT: 'SYS_TIMESTAMP_FORMAT',
  ROSTER_SPREADSHEET_ID: 'ROSTER_SPREADSHEET_ID',
  ROSTER_DRIVE_FOLDER_ID: 'ROSTER_DRIVE_FOLDER_ID',
  SCRIPT_ACCOUNT_EMAIL: 'SCRIPT_ACCOUNT_EMAIL',
  DRY_RUN: 'DRY_RUN',
  HWCAS_SPREADSHEET_ID: 'HWCAS_SPREADSHEET_ID',
  HWCAS_MEMBERS_SHEET: 'HWCAS_MEMBERS_SHEET',
  HWCAS_READ_COLUMNS: 'HWCAS_READ_COLUMNS',
  HWCAS_COL_NAME: 'HWCAS_COL_NAME',
  HWCAS_COL_EMAIL: 'HWCAS_COL_EMAIL',
  HWCAS_COL_MEMBER_NO: 'HWCAS_COL_MEMBER_NO',
  HWCAS_COL_LAST_ATTENDANCE: 'HWCAS_COL_LAST_ATTENDANCE',
  HWCAS_COL_MEETING_POINT: 'HWCAS_COL_MEETING_POINT',
  HWCAS_CONGREGATION_PREFIXES: 'HWCAS_CONGREGATION_PREFIXES',
  MAIL_SENDER_NAME: 'MAIL_SENDER_NAME',
  MAIL_REPLY_TO: 'MAIL_REPLY_TO',
  MAIL_ADMIN_NOTIFY: 'MAIL_ADMIN_NOTIFY',
  MAIL_SUBJECT_PREFIX: 'MAIL_SUBJECT_PREFIX',
  MAIL_SUMMARY_DATE_FORMAT: 'MAIL_SUMMARY_DATE_FORMAT',
  MAIL_SUMMARY_SEPARATOR: 'MAIL_SUMMARY_SEPARATOR',
  ATTACH_HIGHLIGHT_PERSONAL: 'ATTACH_HIGHLIGHT_PERSONAL',
  ATTACH_NAME_PATTERN: 'ATTACH_NAME_PATTERN',
  ATTACH_PAGE_ORIENTATION: 'ATTACH_PAGE_ORIENTATION',
  SYS_CONFIG_CACHE_SECONDS: 'SYS_CONFIG_CACHE_SECONDS',
  PDF_EXPORT_MAX_RETRIES: 'PDF_EXPORT_MAX_RETRIES',
  PDF_EXPORT_RETRY_DELAY_MS: 'PDF_EXPORT_RETRY_DELAY_MS',
  PDF_EXPORT_PACING_MS: 'PDF_EXPORT_PACING_MS',
  // 追加階段 AG：PDF 匯出偶爾會回傳 HTTP 200 但內容是空白或截斷的檔案，
  // 這個門檻用來判斷「檔案是不是小得不正常」，見 PdfExport.gs 的 fetchWithRetry_()。
  PDF_MIN_SIZE_BYTES: 'PDF_MIN_SIZE_BYTES',
  // 第十九輪批次階段 C1：步驟 4 容許嘅個人 PDF 缺件比例上限
  STEP4_MAX_MISSING_PDF_RATIO: 'STEP4_MAX_MISSING_PDF_RATIO',
  // 第二十一輪批次階段 B：自我測試要驗邊一季。留空 = 用最近一個
  // 有生成過版本嘅季度（所以唔會過期）。
  SELF_TEST_QUARTER_ID: 'SELF_TEST_QUARTER_ID',
  // 第二十九輪批次階段 D：唔准做「全季流程演練」嘅季度（逗號分隔）。
  // ⚠️ 留空／未補建**唔等於冇保護**——`SeasonRehearsal.gs` 有一個寫死嘅
  // 預設清單，讀唔到就用嗰個。只靠 Config 嘅話，一個被清走嘅 key
  // 就等於保護消失，而畫面上完全睇唔出。
  REHEARSAL_PROTECTED_QUARTERS: 'REHEARSAL_PROTECTED_QUARTERS',
  PDF_BATCH_SIZE: 'PDF_BATCH_SIZE',
  // 階段 G 新增：sendStage()／sendResendStage_() 每處理幾個收件人就把 SendLog
  // 寫入一次，縮小 Apps Script 逾時時遺失紀錄的範圍，見 Mailer.gs 的說明。
  SEND_LOG_FLUSH_BATCH_SIZE: 'SEND_LOG_FLUSH_BATCH_SIZE',
  PDF_REGENERATE_IF_EXISTS: 'PDF_REGENERATE_IF_EXISTS',
  GRID_NOT_APPLICABLE_LABEL: 'GRID_NOT_APPLICABLE_LABEL',
  GRID_PENDING_LABEL: 'GRID_PENDING_LABEL',
  GRID_PENDING_FILL_COLOR: 'GRID_PENDING_FILL_COLOR',
  // 第十輪批次階段 A 新增：草稿印俾堂委睇時的呈現設定。
  // GRID_GAP_LABEL＝「系統應該排但排不出」的格子文字（跟「待人手填」分開）；
  // GRID_SHOW_LEGEND＝是否在 grid 底部加圖例（連每一類的實際格數）；
  // GRID_FOOTER_NOTE＝表格最底的一句備註（對照現行人手職事表的聯絡人一行）。
  GRID_GAP_LABEL: 'GRID_GAP_LABEL',
  GRID_SHOW_LEGEND: 'GRID_SHOW_LEGEND',
  GRID_FOOTER_NOTE: 'GRID_FOOTER_NOTE',
  // 階段 A 新增：特別主日（SpecialSundays.SkipPostIDs）跳過的格子專用標籤，
  // 跟「這個崗位本來就不自動生成」（講員／翻譯／獻花等）的 GRID_PENDING_LABEL
  // 區分開——同一個崗位平常會自動生成，只是「這一週」因為特別主日而跳過，
  // 語意跟「永遠不自動生成」不同，見 RosterWriter.gs 的 isSpecialSundaySkip_()。
  GRID_SPECIAL_SKIP_LABEL: 'GRID_SPECIAL_SKIP_LABEL',
  DEFAULT_MAX_PER_QUARTER: 'DEFAULT_MAX_PER_QUARTER',
  SELECTION_STRATEGY: 'SELECTION_STRATEGY',
  SELECTION_WEIGHT_HISTORICAL: 'SELECTION_WEIGHT_HISTORICAL',
  SCORE_CHAIR_DUAL_BONUS: 'SCORE_CHAIR_DUAL_BONUS',
  SCORE_PREFERENCE_BONUS: 'SCORE_PREFERENCE_BONUS',
  SCORE_SELECTION_WEIGHT: 'SCORE_SELECTION_WEIGHT',
  MULTIRUN_ATTEMPTS: 'MULTIRUN_ATTEMPTS',
  RANDOM_SEED: 'RANDOM_SEED',
  CARRY_OVER_WEEKS: 'CARRY_OVER_WEEKS',
  V0_PROTECT: 'V0_PROTECT',
  RESEND_ONLY_CHANGED: 'RESEND_ONLY_CHANGED',
  FINETUNE_MAX_MOVES: 'FINETUNE_MAX_MOVES',
  WARN_ON_SEMI_HARD_BREAK: 'WARN_ON_SEMI_HARD_BREAK',
  // 追加階段 AV：Web UI 的總開關。預設 FALSE——即使已經 deploy 成 Web App，
  // doGet() 與全部 api* 函式都會拒絕運作，直到幹事自己把這格改成 TRUE。
  // 見 WebApp.gs 的 assertWebAppEnabled_()。
  WEBAPP_ENABLED: 'WEBAPP_ENABLED',
  // 追加階段 AV：Web UI 呼叫者白名單（電郵，逗號分隔）。留空時退回只允許
  // SCRIPT_ACCOUNT_EMAIL 那一個人——空白絕不代表「任何人皆可」。
  // 見 WebApp.gs 的 assertApiCallerAuthorized_()。
  WEBAPP_ALLOWED_EMAILS: 'WEBAPP_ALLOWED_EMAILS',
  // 第九輪批次階段 A：軟規則實測量度工具的三個判斷門檻（見 SoftRuleMetrics.gs）。
  // 刻意做成可配置而不是寫死——不同季度的人手鬆緊差很遠，「差多少才算偏離」
  // 本來就應該由幹事按實際情況調整。
  SOFT_METRIC_RATIO_TOLERANCE: 'SOFT_METRIC_RATIO_TOLERANCE',
  SOFT_METRIC_COUNT_TOLERANCE_RATIO: 'SOFT_METRIC_COUNT_TOLERANCE_RATIO',
  SOFT_METRIC_POST_USAGE_MIN_RATIO: 'SOFT_METRIC_POST_USAGE_MIN_RATIO',
  // 第九輪批次階段 B：候選人分數的「視為同分」容差，令 RANDOM_SEED 的
  // tieBreak 真正參與決勝（見 Generator.gs 的 compareCandidates_()／
  // pickEpsilonWinner_()）。**預設 0＝行為與加入這個 Key 之前完全一致**，
  // 要真的啟用必須由幹事自己改成非零值，而且應該先用「試算不同 epsilon
  // 的效果（唯讀）」在真實資料上比較過再改。
  SCORE_TIE_EPSILON: 'SCORE_TIE_EPSILON',
  // 第十一輪批次階段 A：一季一條固定連結。公開試算表檔案的命名樣板，
  // 支援 {QuarterID}。見 PublicRoster.gs。
  PUBLIC_ROSTER_FILE_NAME_PATTERN: 'PUBLIC_ROSTER_FILE_NAME_PATTERN',
  // 第十三輪批次階段 A4：公開/個人頁面日期欄嘅顯示格式。純字串代入
  // （{M}＝月、{d}＝日），刻意唔用 Utilities.formatDate()——後者要真正
  // GAS 環境，令產生呢個標籤嘅函式冧唔到再係純函式（見 RosterWriter.gs
  // 嘅 formatShortDateLabel_()）。實測發現寫死數字字串（例如 "3"）會被
  // Google 試算表自動判斷成數字格式顯示做 "3.0"，改用帶中文字嘅樣板
  // 令儲存格內容一定唔會被誤判成數字。
  PUBLIC_ROSTER_DATE_FORMAT: 'PUBLIC_ROSTER_DATE_FORMAT',
  // 第十三輪批次階段 A6：公開/個人頁面嗰啲 Posts.EmptyDisplay=BLANK 嘅崗位
  // （例如獻花、翻譯——刻意留空、唔想每格都顯示「（待填）」），喺幹事介面
  // 留白冇問題（幹事知道呢啲係人手安排），但對外公開嘅版面成行留白冇任何
  // 說明，義工會誤以為漏咗嘢。呢個 Key 提供一句通用嘅說明文字，喺公開/
  // 個人頁面代替空白（幹事介面完全唔受影響，仍然顯示空白）。
  PUBLIC_ROSTER_BLANK_NOTE: 'PUBLIC_ROSTER_BLANK_NOTE',
  // 第十一輪批次階段 C：ICS 日曆事件的預設崇拜時間（HH:mm，24 小時制，
  // Pacific/Auckland）。個別崗位的提早到場時間見 Posts 的 EarlyArrivalMinutes 欄
  // （見 PostSeed.gs 檔頭說明——為什麼改用 Posts 欄而不是逐一開 Config Key）。
  ICS_SERVICE_START_TIME: 'ICS_SERVICE_START_TIME',
  ICS_SERVICE_END_TIME: 'ICS_SERVICE_END_TIME'
};

/**
 * 核心讀取層運作所需的必填 Config Key。
 * validateSetup() 會檢查這些 Key 是否有已解析的值（Value 或 Default）。
 *
 * 刻意寫成函式而非 const 陣列：Apps Script 會把所有 .gs 檔案的頂層程式碼
 * 按檔名字母序依次求值，const 之間一旦有前向引用就會拋
 * "Cannot access X before initialization"，連 onOpen 都無法執行。
 * 改為函式後，CONFIG_KEYS 只在呼叫當下才被讀取，永遠不會早於它的定義。
 *
 * @returns {string[]} 必填的 Config Key 清單
 */
function getRequiredConfigKeys() {
  return [
    CONFIG_KEYS.LEAD_DAYS_GENERATE,
    CONFIG_KEYS.LEAD_DAYS_OFFICIAL,
    CONFIG_KEYS.SEND_HOUR_LOCAL,
    CONFIG_KEYS.SYS_TIMEZONE,
    CONFIG_KEYS.SYS_LOCALE,
    CONFIG_KEYS.ROSTER_SPREADSHEET_ID,
    CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL,
    CONFIG_KEYS.DRY_RUN,
    CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER,
    CONFIG_KEYS.SELECTION_STRATEGY
  ];
}

/** Config 工作表 Type 欄可能出現的值。 */
const CONFIG_TYPES = {
  INT: 'INT',
  DEC: 'DEC',
  BOOL: 'BOOL',
  LIST: 'LIST',
  STR: 'STR',
  ENUM: 'ENUM',
  EMAIL: 'EMAIL'
};

/** Posts 的 Frequency 欄可能出現的值。 */
const POST_FREQUENCY = {
  WEEKLY: 'WEEKLY',
  FIRST_SUNDAY: 'FIRST_SUNDAY',
  AS_NEEDED: 'AS_NEEDED'
};

/** Posts 的 AllowConsecutive 欄可能出現的值。 */
const ALLOW_CONSECUTIVE = {
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  BLOCK: 'BLOCK'
};

/** RuleSettings 的 OnViolation 欄可能出現的值。 */
const ON_VIOLATION = {
  BLOCK: 'BLOCK',
  WARN: 'WARN',
  IGNORE: 'IGNORE'
};

/** Unavailable 的 AppliesTo 與 Status 欄可能出現的值。 */
const UNAVAILABLE_VALUES = {
  APPLIES_TO_ALL: 'ALL',
  STATUS_ACTIVE: 'ACTIVE',
  // 第三十四輪批次乙2：本來 `apiSaveUnavailable()` 直接寫死字串 'CANCELLED'，
  // 而讀嗰邊（`readUnavailableNormalized()`）淨係認 ACTIVE，兩邊各自寫一次
  // 就係兩個真相來源。而家寫成常數，兩邊都讀同一個。
  // ⚠️ 一律停用，**唔刪**——刪咗就冇咗紀錄。
  STATUS_CANCELLED: 'CANCELLED'
};

/** Config 的 SELECTION_STRATEGY 可能出現的值。 */
const SELECTION_STRATEGIES = {
  LONGEST_UNSERVED: 'LONGEST_UNSERVED'
};

/** Config 的 ATTACH_PAGE_ORIENTATION 可能出現的值。 */
const PAGE_ORIENTATION = {
  PORTRAIT: 'PORTRAIT',
  LANDSCAPE: 'LANDSCAPE'
};

/** EmailTemplates 的 AttachType 欄可能出現的值。 */
const ATTACH_TYPE = {
  NONE: 'NONE',
  FULL_PDF: 'FULL_PDF',
  PERSONAL_PDF: 'PERSONAL_PDF'
};

/** SendLog 的 RecipientType 欄與 EmailRecipients 的 SendAs 欄可能出現的值。 */
const RECIPIENT_TYPE = {
  LIST: 'LIST',
  PERSON: 'PERSON'
};

/** EmailRecipients 的 SendAs 欄可能出現的值。 */
const SEND_AS = {
  TO: 'TO',
  CC: 'CC',
  BCC: 'BCC'
};

/** RosterVersions 的 Basis 與 Status 欄可能出現的值。 */
const VERSION_VALUES = {
  BASIS_AUTO_GENERATE: 'AUTO_GENERATE',
  BASIS_FINE_TUNE: 'FINE_TUNE',
  BASIS_REQUESTS_APPLIED: 'REQUESTS_APPLIED',
  // 步驟 5「改動後重發」：套用 Requests 產生新版本時用這個 Basis 標記，
  // 跟步驟 3 的 REQUESTS_APPLIED 區分開來（同樣是套用 Requests，但發生在
  // OFFICIAL_SENT 之後，語意上是「已經正式發出、這是後續改動」）。
  BASIS_RESEND: 'RESEND',
  STATUS_DRAFT: 'DRAFT'
};

/** 工作表儲存格中代表布林值的文字。 */
const BOOLEAN_TEXT = {
  TRUE: 'TRUE',
  FALSE: 'FALSE'
};

/** 職事表 grid 與統計區使用的中文標籤。 */
const GRID_LABELS = {
  DATE: '日期',
  WEEK: '週次',
  TYPE: '類型',
  // 第十輪批次階段 A：由「待確認」改為「（待填）」。「待確認」讀落似係
  // 「系統唔肯定」，而呢一類其實係**預期中要人手填**（講員／翻譯／獻花），
  // 系統完全冇出錯。加括號亦令佢喺表上一眼睇得出唔係人名。
  PENDING: '（待填）',
  // 第十輪批次階段 A 新增：真正排唔出嘅格。刻意同 PENDING 用完全唔同嘅字，
  // 而且帶一個 ⚠ 符號——即使印成黑白，一眼都分得出。
  GAP: '⚠ 未能安排',
  STATS_TITLE: '本季服侍次數統計',
  LEGEND_TITLE: '圖例（本季實際格數）',
  NAME: '姓名',
  PERSON_ID: 'PersonID',
  COUNT: '次數',
  FULL_VERSION: '完整版',
  // 第十二輪批次階段 A：公開/個人頁面轉置版面（崗位做列、日期做欄）
  // 左上角崗位欄嘅標題。
  POST_COLUMN: '崗位'
};

/** Web App 使用的 HTML 檔案名稱。 */
const UI_FILES = {
  INDEX: 'ui/Index',
  STYLE: 'ui/Style',
  SCRIPT: 'ui/Script',
  // 第十一輪批次階段 B：個人專屬連結的唯讀頁面，見 WebAppPersonalLink.gs。
  PERSONAL_ROSTER: 'ui/PersonalRoster'
};

/** 自我測試的結果類型。 */
const SELF_TEST_RESULT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  ERROR: 'ERROR'
};

/** 自我測試結果工作表的標示底色。 */
const SELF_TEST_COLORS = {
  PASS: '#D9EAD3',
  FAIL: '#FCE8E6',
  ERROR: '#F9CB9C'
};

/**
 * ⚠️ 第二十一輪批次階段 B：`SELF_TEST_TARGET` **已移除**，唔好加返。
 *
 * 原本係 `{ QUARTER_ID: '2026T4', VERSION_NO: 0 }`，兩個問題：
 *
 * 1. **寫死年份會過期。** 每過一季，自我測試就係喺驗一個舊季度，
 *    而唔係驗「而家用緊嗰個」。實測就係噉：2026T4 v0 生成之後
 *    先套用嘅申報寫入咗一行 Unavailable，令測試 7 追溯報失敗，
 *    但嗰個版本喺生成當日完全合規。
 * 2. **寫死 `VERSION_NO: 0`** 令佢永遠只驗初稿。初稿之後嘅版本
 *    （套用申報、人手改動）先係真正會寄出去嘅嘢，反而冇驗。
 *
 * 而家由 `resolveSelfTestTarget_()`（SelfTest.gs）決定：
 * 季度讀 Config 嘅 `SELF_TEST_QUARTER_ID`（冇設定就用最近一個有生成過
 * 版本嘅季度），版本一律用**該季最新版本**。
 */

/** Config 未設定時程式採用的預設值。 */
const DEFAULTS = {
  TIMEZONE: 'Pacific/Auckland',
  TIMESTAMP_FORMAT: 'yyyy-MM-dd HH:mm:ss',
  MAX_PER_QUARTER: 8,
  ATTACH_NAME_PATTERN: '{QuarterID}_{VersionNo}_粵語堂職事表_{PersonName}.pdf',
  HWCAS_MEMBERS_SHEET: 'Members',
  FINETUNE_MAX_MOVES: 6,
  QUARTER_DISTRIBUTION_TOLERANCE: 0.5,
  MULTIRUN_ATTEMPTS: 20,
  // 第九輪批次階段 C：由 'dd/MM' 改為 'M月d日'。
  // 'dd/MM' 對習慣 MM/dd 的讀者有月日歧義——「03/04」究竟是 3 月 4 日還是
  // 4 月 3 日分不出。而義工就是靠個人信裡這一行去記自己邊個禮拜要返，記錯
  // 日期的代價很實際（當日冇人到位）。'M月d日' 對中文讀者完全沒有歧義，
  // 也不受地區慣例影響。CJK 字元在 SimpleDateFormat 屬於字面字元，
  // 不是格式符號（只有 ASCII 字母才是），所以「月」「日」會原樣輸出。
  // ⚠️ 這是程式碼預設值。如果 Config 工作表已經有 MAIL_SUMMARY_DATE_FORMAT
  // 這一行，工作表的值優先，要一併改才會生效——見 docs/電郵範本樣本.md。
  MAIL_SUMMARY_DATE_FORMAT: 'M月d日',
  MAIL_SUMMARY_SEPARATOR: '；',
  PDF_EXPORT_MAX_RETRIES: 4,
  PDF_EXPORT_RETRY_DELAY_MS: 1000,
  /**
   * 每份個人 PDF 匯出之間嘅間隔（毫秒）。
   *
   * 第十九輪批次階段 E：由 500 改成 1500，根據 2026-08-17 嘅 57 份實測推算。
   *
   * **實測數字**（57 份、真實環境、pacing = 500ms）：
   * | 項目 | 總計 | 每份 |
   * |---|---|---|
   * | 設定 highlight 格式 | 55.7 秒 | 0.98 秒 |
   * | 呼叫匯出 | 189.6 秒 | 3.33 秒 |
   * | **重試前等待** | **285.0 秒** | **5.00 秒** |
   * | 總耗時 | 530.3 秒 | 9.30 秒 |
   *
   * 重試次數 **47**（57 份入面大部分至少撞過一次速率限制），
   * 平均每次重試等 6.1 秒。**超過一半嘅總時間係喺度等重試。**
   *
   * **推算**：如果加大 pacing 可以令重試接近零，
   * 總耗時 ≈ highlight + 匯出 + pacing × 份數：
   * | pacing | 額外 pacing 時間 | 重試歸零時嘅總計 |
   * |---|---|---|
   * | 500ms（舊值） | — | 274 秒（但實際係 530 秒，因為重試冇歸零）|
   * | 1000ms | +29 秒 | 302 秒 |
   * | **1500ms** | **+57 秒** | **331 秒** |
   * | 2000ms | +86 秒 | 359 秒 |
   *
   * 揀 1500ms 嘅理由：**損益平衡點好低**。目前重試等待係 285 秒，
   * 而 1500ms 只係多付 57 秒 pacing——即係話，就算加大 pacing 只能夠
   * 消除 **20%** 嘅重試，都已經打和；消除得多過 20% 就係淨賺。
   * 呢個係一個唔對稱嘅賭注，向上空間（省約 200 秒）遠大過下行風險。
   *
   * ⚠️ **呢個係推算，唔係實測結論。** pacing 加大到底會消除幾多重試，
   * 要真實跑一次先知——Google 端嘅速率限制冇公開參數。
   * 下次跑完「產生個人 PDF」，睇完成對話框嗰行重試次數：
   *   • 明顯跌（例如 47 → 10 以下）⇒ 有效，可以再試調大或者維持
   *   • 冇乜分別 ⇒ 唔係 pacing 嘅問題，調返 500ms 慳返嗰 57 秒
   *
   * ⚠️ 改呢度**只改程式碼預設值**。試算表 Config 已經有呢一行嘅話，
   * 工作表嘅值優先，要 Ivan 自己去改先會生效。
   */
  PDF_EXPORT_PACING_MS: 1500,
  PDF_BATCH_SIZE: 25,
  SEND_LOG_FLUSH_BATCH_SIZE: 15,
  GRID_NOT_APPLICABLE_LABEL: '—',
  GRID_PENDING_LABEL: GRID_LABELS.PENDING,
  GRID_SPECIAL_SKIP_LABEL: '特殊主日',
  // 刻意跟 GRID_COLORS.WARNING（#FFF2CC）不同色：這格是「空格，需要人手補」，
  // WARNING 是「已經有人，但觸發規則警告」，兩者語意完全不同，2027T1 實測時
  // 曾經因為兩者同色（都是 #FFF2CC）被幹事誤認、也曾讓 listPendingBackfillCells_()
  // 的底色比對邏輯誤判（已改為讀 RosterAssignments 資料層，見 RequestsApply.gs）。
  // 這裡改色是為了讓人眼也分得出來，屬於雙重防線的第二層。
  GRID_PENDING_FILL_COLOR: '#F4CCCC',
  // 第十輪批次階段 A：草稿呈現設定。GRID_GAP_LABEL 跟 GRID_PENDING_LABEL
  // 刻意用完全不同的字，令黑白列印一樣分得出；圖例預設開啟；
  // 底部備註刻意用不含任何姓名／電郵的通用句子（public repo 規則）。
  GRID_GAP_LABEL: GRID_LABELS.GAP,
  GRID_SHOW_LEGEND: true,
  GRID_FOOTER_NOTE: '如未能按上表服侍，請盡早聯絡幹事安排調動。',
  REMIND_STUCK_DAYS: 3,
  REMIND_STUCK_MAX_COUNT: 3,
  REMIND_DEADLINE_DAYS: 7,
  // 第二十五輪批次階段 A：到期自動生成初稿。預設 false＝關閉，初稿一律由
  // 幹事在網頁上自己撳掣生成。見 CONFIG_KEYS.TRIGGER_AUTO_GENERATE 嘅說明。
  TRIGGER_AUTO_GENERATE: false,
  // 第二十五輪批次階段 D：留空＝提醒信唔附幹事介面連結。
  // 見 CONFIG_KEYS.WEBAPP_STEWARD_URL 嘅說明。
  WEBAPP_STEWARD_URL: '',
  // 第十六輪批次階段 D：生成前幾多日開始提醒「仲有未確認日期嘅特殊主日」。
  REMIND_UNCONFIRMED_SPECIAL_DAYS: 7,
  // 第十七輪批次階段 C：T1～T4 各自嘅起始月份（日曆季度）。
  QUARTER_TERM_START_MONTHS: '1,4,7,10',
  PDF_MIN_SIZE_BYTES: 10240,
  /**
   * 第十九輪批次階段 C1：步驟 4 容許嘅個人 PDF 缺件比例（0–1）。
   *
   * 0.2 ＝ 五個人入面最多一個缺件仲可以繼續（會有警告）。超過就直接擋，
   * 唔會再畀「現在繼續」呢個選擇。
   *
   * 點解唔係 0（有缺件就擋）：少量缺件係合理嘅營運情況，一刀切全擋會令
   * 幹事為咗一個人卡住成季，跟住就會想辦法繞過個關卡。關卡越嚴，
   * 被繞過嘅機會越大。
   *
   * 點解唔係更寬鬆：實測嗰次係 57 / 57（100%）——即係全體義工一個都
   * 收唔到，而 Stage 照樣鎖死。任何一個合理門檻都攔得住呢種情況，
   * 0.2 只係一個保守嘅起點，有需要可以喺 Config 調。
   */
  STEP4_MAX_MISSING_PDF_RATIO: 0.2,
  // 第九輪批次階段 A：軟規則實測量度的三個判斷門檻（見 SoftRuleMetrics.gs）。
  // 比例型 ±5 個百分點、次數型 ±20%（沿用 HISTORICAL_BASELINE.PEOPLE_TOLERANCE_RATIO
  // 一直在用的同一個寬鬆度）、崗位動用率下限 50%（合資格的人整季有一半以上
  // 從未被派到，就值得看一眼是不是人手過度集中）。
  SOFT_METRIC_RATIO_TOLERANCE: 0.05,
  SOFT_METRIC_COUNT_TOLERANCE_RATIO: 0.2,
  SOFT_METRIC_POST_USAGE_MIN_RATIO: 0.5,
  // 第九輪批次階段 B：**預設 0，代表完全不啟用**，選人行為與加入這個機制
  // 之前逐格完全一致（見 Generator.gs 的 compareCandidates_() 說明）。
  SCORE_TIE_EPSILON: 0,
  // 第十一輪批次階段 A：公開試算表檔案的預設命名樣板。
  PUBLIC_ROSTER_FILE_NAME_PATTERN: '{QuarterID} 粵語堂職事表（公開版）',
  // 第十一輪批次階段 C：預設崇拜時間 10:45–12:00（Ivan 已確認）。
  ICS_SERVICE_START_TIME: '10:45',
  ICS_SERVICE_END_TIME: '12:00',
  // 第十三輪批次階段 A4：預設「M月d日」（例如「1月3日」）——實測發現純數字
  // 標籤會被試算表自動格式化成 "3.0"，帶中文字嘅樣板保證唔會被誤判做數字。
  PUBLIC_ROSTER_DATE_FORMAT: '{M}月{d}日',
  // 第十三輪批次階段 A6：獻花／翻譯呢類 EmptyDisplay=BLANK 崗位喺公開/個人
  // 頁面代替空白嘅通用說明文字。
  PUBLIC_ROSTER_BLANK_NOTE: '由會友另行安排，非本系統自動排定'
};

/**
 * REMIND 提醒訊息裡「下一步應該撳邊個選單項」的對照——單一事實來源，避免
 * Trigger.gs／Mailer.gs 各自寫一份、日後改一邊漏一邊。只涵蓋會被提醒的三個
 * Stage（DRAFT／REVIEW_SENT／REQUESTS_APPLIED）；OFFICIAL_SENT 不會被提醒，
 * 不需要在這裡有對應項。
 */
const STAGE_NEXT_ACTION = {};
STAGE_NEXT_ACTION[QUARTER_STAGE.DRAFT] = '四階段流程 ▸ 步驟 2：寄給堂委審閱';
STAGE_NEXT_ACTION[QUARTER_STAGE.REVIEW_SENT] = '四階段流程 ▸ 步驟 3：套用修改申報';
STAGE_NEXT_ACTION[QUARTER_STAGE.REQUESTS_APPLIED] = '四階段流程 ▸ 步驟 4：正式發出';

/** CacheService 的最大 TTL（秒），Config 的 SYS_CONFIG_CACHE_SECONDS 不可超過這個上限。 */
const CACHE_MAX_TTL_SECONDS = 21600;

/**
 * 第十九輪批次階段 E：每份個人 PDF 嘅平均耗時（秒），
 * 用嚟喺對話框事先講「需時約幾耐」，令幹事唔會以為系統當咗機。
 *
 * 來源：2026-08-17 嘅 57 份真實環境實測（530.3 秒 ÷ 57 ≈ 9.3）。
 * **已包含撞速率限制之後嘅重試等待**，唔係理論值——所以呢個數字
 * 會隨 `PDF_EXPORT_PACING_MS` 嘅調整而變。下次實測之後記得回填。
 */
const PERSONAL_PDF_SECONDS_PER_FILE = 9.3;

/**
 * 第十九輪批次階段 E2：重試次數 ÷ 份數超過呢個比例，就喺完成對話框
 * 提示「大部分匯出撞到速率限制」。
 *
 * 0.5 嘅理由：實測係 47 / 57 ≈ 0.82，明顯要提示；而偶爾一兩次重試
 * （例如 2 / 57 ≈ 0.04）係正常波動，唔應該每次都嘈。
 */
const PDF_RETRY_RATIO_HINT_THRESHOLD = 0.5;
