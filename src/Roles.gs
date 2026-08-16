/**
 * 第十六輪批次階段 A／B：**教會身分名單**（堂委／執事）與**個人崗位排除**。
 *
 * 教會提供咗五條新排表規則，其中三條係硬規則，全部圍繞「呢個人係咩身分」：
 *   規則 1：報告（家事報告）只可以由現任堂委擔任。
 *   規則 2：當值堂委只可以由現任堂委或者現任執事擔任。
 *   規則 3：個別人士嘅崗位限制（例如某位堂委暫時唔做主席，日後另行通知）。
 * 呢個檔案就係呢三條規則嘅資料層。
 *
 * ---
 * ## 點解要一張新工作表，唔可以塞入現有嘅表
 *
 * **唔可以寫死喺程式碼**：堂委同執事每屆換人，寫死等於每次換屆都要改程式、
 * 重新 push、而且改嘅人未必係 Ivan。而且真實姓名唔可以入 public repo。
 *
 * **唔應該塞入 `Eligibility`**：`Eligibility` 答嘅問題係「呢個人做唔做得到
 * 呢個崗位」（人 × 崗位 × 歷史次數），係一種**能力／資格**。身分答嘅係
 * 「呢個人喺教會擔任緊咩職份」，同崗位無關（一個堂委即使一個崗位都未做過，
 * 佢一樣係堂委）。兩者硬夾埋一齊要用一個假 PostID 去代表身分，而且
 * `Eligibility` 冇時間維度（見下面 A3），做唔到換屆。
 *
 * **唔應該用 `NameMapping` 加一欄**：一欄只放得低「而家係咩身分」。換屆之後
 * 舊值會被覆蓋，上一屆嘅職事表就會被追溯判定為違規（嗰陣佢明明係堂委）。
 * 要保留歷史就一定要一個人可以有多行、每行帶生效期間——即係一張獨立嘅表。
 *
 * ---
 * ## A3：生效日期（本設計最重要嘅一點）
 *
 * `Roles` 每一行有 `EffectiveFrom`／`EffectiveTo`，判斷一律**以該主日嘅日期**
 * 為準（`personHasAnyRoleOn_()`），唔係以「今日」為準。所以換屆之後：
 * - 舊季度嘅職事表重新核對，仍然睇返嗰陣嘅身分，唔會突然變成一堆違規；
 * - 新季度自動用新一屆嘅名單。
 *
 * ⚠️ **換屆嘅正確做法：喺卸任嗰行填 `EffectiveTo`，然後為新人加新一行。
 * 唔好刪除舊行、亦都唔好直接改 `PersonID`。** 刪咗行就等於話「呢個人從來
 * 都唔係堂委」，所有佢做過報告嘅舊季度會即刻全部變成違反規則 1。
 * 呢一點喺 `docs/幹事操作說明.md` 同 `docs/排表規則.md` 都寫咗。
 *
 * 空白嘅 `EffectiveFrom` ＝ 一直以嚟都係（冇下限）；
 * 空白嘅 `EffectiveTo` ＝ 仍然在任（冇上限）。
 *
 * ---
 * ## 兩張表都係可選嘅
 *
 * `readRolesSafe_()`／`readPersonPostExclusionsSafe_()` 喺工作表唔存在時
 * 回傳空陣列而唔係拋錯（`readSheet()` 本身係會拋 `找不到工作表: X` 嘅）。
 * 冇資料 ⇒ 冇人持有任何身分 ⇒ 唯一嘅後果係「有身分要求嘅崗位排唔到人」，
 * 而 `Posts.RequiredRoles` 空白嘅話連呢個後果都冇——即係**未建表之前，
 * 成個系統嘅行為同以前一模一樣**，唔會因為 push 咗新版就突然爆錯。
 */

/** `Roles` 第 1 行（中文標題）與第 2 行（機器鍵）的欄位順序，兩個陣列一一對應。 */
const ROLES_HEADERS_TC = [
  'RoleAssignmentID', 'PersonID',
  '身分代號（COMMITTEE＝堂委　DEACON＝執事）',
  '生效日（yyyy-MM-dd，留空＝一直以來都是）',
  '結束日（yyyy-MM-dd，留空＝仍然在任；換屆時填這一欄，不要刪除整行）',
  'Active', '備註'
];

/** `PersonPostExclusions` 第 1 行（中文標題）的欄位順序。 */
const PERSON_POST_EXCLUSIONS_HEADERS_TC = [
  'ExclusionID', 'PersonID', '崗位（PostID）', '原因（給人看，會出現在違規訊息）',
  '生效日（yyyy-MM-dd，留空＝即時生效）',
  '解除日（yyyy-MM-dd，留空＝暫時無限期；日後解除時填這一欄，不要刪除整行）',
  'Active', '備註'
];

/**
 * 取得 `Roles` 第 2 行機器鍵陣列。寫成函式而非頂層 const，理由同
 * `SpecialSundaysSeed.gs` 的 `getSpecialSundaysHeaderKeys_()`：本檔案（R 開頭）
 * 依字母序早於 Constants.gs 載入，頂層直接引用 COLUMNS 會撞到 TDZ。
 * @returns {string[]} 機器鍵陣列
 */
function getRolesHeaderKeys_() {
  const C = COLUMNS.ROLES;
  return [
    C.ROLE_ASSIGNMENT_ID, C.PERSON_ID, C.ROLE_CODE,
    C.EFFECTIVE_FROM, C.EFFECTIVE_TO, C.ACTIVE, C.NOTES
  ];
}

/**
 * 取得 `PersonPostExclusions` 第 2 行機器鍵陣列。
 * @returns {string[]} 機器鍵陣列
 */
function getPersonPostExclusionsHeaderKeys_() {
  const C = COLUMNS.PERSON_POST_EXCLUSIONS;
  return [
    C.EXCLUSION_ID, C.PERSON_ID, C.POST_ID, C.REASON,
    C.EFFECTIVE_FROM, C.EFFECTIVE_TO, C.ACTIVE, C.NOTES
  ];
}

/**
 * 讀一張**可能未建立**的工作表：存在就照 `readSheet()` 讀，唔存在就回傳空陣列。
 *
 * 唔直接改 `readSheet()` 嘅行為——嗰個函式拋錯係啱嘅（`Posts`／`NameMapping`
 * 呢類核心表唔見咗，靜靜返空陣列只會令排表結果詭異噉變空，遠差過即刻拋錯）。
 * 呢度只係為咗兩張**新增而且可選**嘅表另開一個明確嘅入口。
 *
 * @param {string} sheetName 工作表名稱
 * @returns {Object[]} 資料列；工作表不存在時為空陣列
 */
function readOptionalSheet_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  return readSheet(sheetName);
}

/**
 * 讀取 `Roles` 工作表並正規化。只保留 `Active=TRUE` 的行。
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 每項 {personId, roleCode, effectiveFrom, effectiveTo}
 */
function readRolesSafe_(timezone) {
  const C = COLUMNS.ROLES;
  return readOptionalSheet_(SHEETS.ROLES)
    .filter(function (row) { return isTrueValue_(row[C.ACTIVE]); })
    .map(function (row) {
      return {
        personId: String(row[C.PERSON_ID] || '').trim(),
        // 身分代號一律轉大寫再比對：試算表上打 `committee` 同 `COMMITTEE`
        // 應該係同一回事，唔應該因為大小寫令規則靜靜噉唔生效。
        roleCode: String(row[C.ROLE_CODE] || '').trim().toUpperCase(),
        effectiveFrom: toDateString(row[C.EFFECTIVE_FROM], timezone),
        effectiveTo: toDateString(row[C.EFFECTIVE_TO], timezone)
      };
    })
    .filter(function (r) { return r.personId && r.roleCode; });
}

/**
 * 讀取 `PersonPostExclusions` 工作表並正規化。只保留 `Active=TRUE` 的行。
 * @param {string} timezone 時區名稱
 * @returns {Object[]} 每項 {personId, postId, reason, effectiveFrom, effectiveTo}
 */
function readPersonPostExclusionsSafe_(timezone) {
  const C = COLUMNS.PERSON_POST_EXCLUSIONS;
  return readOptionalSheet_(SHEETS.PERSON_POST_EXCLUSIONS)
    .filter(function (row) { return isTrueValue_(row[C.ACTIVE]); })
    .map(function (row) {
      return {
        personId: String(row[C.PERSON_ID] || '').trim(),
        postId: String(row[C.POST_ID] || '').trim(),
        reason: String(row[C.REASON] || '').trim(),
        effectiveFrom: toDateString(row[C.EFFECTIVE_FROM], timezone),
        effectiveTo: toDateString(row[C.EFFECTIVE_TO], timezone)
      };
    })
    .filter(function (r) { return r.personId && r.postId; });
}

/**
 * 判斷一段「生效期間」喺指定日期當日係咪有效。純函式。
 *
 * 邊界一律**包含**（`from <= date <= to`）：教會講「由 X 日開始擔任」嘅意思
 * 一定包括 X 日本身。`yyyy-MM-dd` 格式嘅字串直接用字典序比大細就等同日期
 * 比大細，唔需要轉 Date 物件（同 `daysBetween_()` 一樣避開時區問題）。
 *
 * @param {string} effectiveFrom 生效日（yyyy-MM-dd）；空字串＝冇下限
 * @param {string} effectiveTo 結束日（yyyy-MM-dd）；空字串＝冇上限
 * @param {string} dateStr 要判斷嘅日期（yyyy-MM-dd）
 * @returns {boolean} 當日係咪喺生效期間之內
 */
function isEffectiveOn_(effectiveFrom, effectiveTo, dateStr) {
  if (!dateStr) return false;
  if (effectiveFrom && dateStr < effectiveFrom) return false;
  if (effectiveTo && dateStr > effectiveTo) return false;
  return true;
}

/**
 * 判斷某人喺指定日期當日，有冇持有 `requiredRoles` 入面**任何一個**身分。
 *
 * 「任何一個」（OR）唔係「全部」（AND）——規則 2「當值堂委只可以由現任堂委
 * **或者**現任執事擔任」直接就係 OR；而規則 1 只有一個身分要求，OR／AND
 * 冇分別。冇任何實際規則需要 AND，所以刻意唔實作 AND，避免加一個冇人用
 * 但要維護嘅語意。
 *
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @param {string} personId 要判斷的人
 * @param {string[]} requiredRoles 所需身分代號（已大寫）
 * @param {string} dateStr 主日日期（yyyy-MM-dd）
 * @returns {boolean} 當日係咪持有其中一個所需身分
 */
function personHasAnyRoleOn_(roles, personId, requiredRoles, dateStr) {
  if (!requiredRoles || requiredRoles.length === 0) return true; // 冇要求＝一定符合
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    if (r.personId !== personId) continue;
    if (requiredRoles.indexOf(r.roleCode) === -1) continue;
    if (isEffectiveOn_(r.effectiveFrom, r.effectiveTo, dateStr)) return true;
  }
  return false;
}

/**
 * 找出某人喺指定日期當日，對某崗位生效中的排除紀錄（規則 3）。
 * @param {Object[]} exclusions `readPersonPostExclusionsSafe_()` 的結果
 * @param {string} personId 要判斷的人
 * @param {string} postId 崗位
 * @param {string} dateStr 主日日期（yyyy-MM-dd）
 * @returns {?Object} 生效中的排除紀錄；沒有時回傳 null
 */
function findActivePersonPostExclusion_(exclusions, personId, postId, dateStr) {
  for (let i = 0; i < exclusions.length; i++) {
    const e = exclusions[i];
    if (e.personId !== personId || e.postId !== postId) continue;
    if (isEffectiveOn_(e.effectiveFrom, e.effectiveTo, dateStr)) return e;
  }
  return null;
}

/**
 * 把身分代號組成畀人睇嘅文字，例如 `['COMMITTEE','DEACON']` → `「堂委」或「執事」`。
 * 認唔到嘅代號原樣顯示（唔好靜靜噉消失，否則打錯字就永遠查唔到）。
 * @param {string[]} roleCodes 身分代號
 * @returns {string} 可讀文字
 */
function describeRoleCodes_(roleCodes) {
  if (!roleCodes || roleCodes.length === 0) return '（沒有身分要求）';
  return roleCodes.map(function (code) {
    return '「' + (ROLE_LABELS_TC[code] || code) + '」';
  }).join('或');
}

/**
 * 取得某崗位嘅身分要求。`Posts.RequiredRoles` 留空 ⇒ 空陣列 ⇒ 冇要求。
 * @param {Object} post 已正規化的崗位物件（`readPostsNormalized()` 的一項）
 * @returns {string[]} 身分代號陣列（已大寫）
 */
function requiredRolesOfPost_(post) {
  if (!post) return [];
  return splitList_(post.requiredRoles).map(function (s) { return s.toUpperCase(); });
}

/**
 * 建立**身分增補後**嘅崗位候選人索引，畀排表器同規則檢查共用。
 *
 * ## B1 嘅判斷：交集定聯集？——**聯集，再加一條硬規則收窄**
 *
 * 呢一點係本輪最需要想清楚嘅設計決定，理由如下：
 *
 * **點解唔可以用交集（`Eligibility` ∩ 身分名單）**：規則 1 講「報告只可以由
 * 現任堂委擔任」，呢句係一個**必要條件**（身分），唔係一句關於經驗嘅描述。
 * 一位新任堂委好可能一次報告都未做過，`Eligibility` 完全冇佢嘅報告呢一行——
 * 用交集就會將佢排除，直接違反教會嘅規則。Ivan 喺任務描述入面提出嘅正正
 * 就係呢個情況，判斷完全正確。
 *
 * **點解又唔可以完全放棄 `Eligibility`**：
 * 1. `HistoricalCount` 住喺 `Eligibility`，係配額（`computePersonQuotas_()`）
 *    同選人分數嘅來源，冇咗佢排表品質會塌。
 * 2. 其餘**所有冇身分要求嘅崗位**（主席、司事、音響……）完全靠
 *    `Eligibility` 決定人選，一步都唔應該改。
 * 3. 幹事仍然需要一個「即使佢係堂委，都唔好排佢做呢個崗位」嘅覆寫手段。
 *
 * **所以實際做法**：
 * - 候選池 ＝ `Eligibility` 名單 **∪** 持有所需身分嘅人
 *   （解決「新任堂委冇歷史紀錄」）；
 * - 再減去 `Eligibility` 入面明確 `Eligible=FALSE` 嘅人
 *   （保留幹事嘅覆寫權，見 `readEligibility()` 嘅 `explicitlyExcluded`）；
 * - 最後由 `HARD_ROLE_REQUIRED` 呢條新硬規則**逐格逐日**檢查真正嘅身分
 *   （解決「前任堂委有歷史紀錄但已經卸任」——佢仲喺 `Eligibility` 入面，
 *   聯集唔會踢走佢，但硬規則會）。
 *
 * 候選池本身刻意**唔做日期過濾**（只要有一行 Active 嘅身分紀錄就當佢入池）：
 * 池只需要係一個安全嘅超集，真正嘅收窄由逐格逐日嘅硬規則負責，而嗰條硬規則
 * 喺生成、步驟 3／5 重跑、核對三條路徑都有跑。池做日期過濾反而要知道
 * 「邊一季」，三條路徑各自傳一次季度資訊，多咗出錯嘅機會而冇任何好處。
 *
 * @param {Object} eligibility `readEligibility()` 的結果
 * @param {Object[]} posts 已正規化的崗位清單
 * @param {Object[]} roles `readRolesSafe_()` 的結果
 * @returns {Object.<string, string[]>} 增補後的 {PostID: [PersonID...]}
 */
function buildRoleAugmentedEligibleByPost_(eligibility, posts, roles) {
  const byPost = {};
  Object.keys(eligibility.byPost).forEach(function (postId) {
    byPost[postId] = eligibility.byPost[postId].slice();
  });

  const excluded = eligibility.explicitlyExcluded || {};

  posts.forEach(function (post) {
    const required = requiredRolesOfPost_(post);
    if (required.length === 0) return; // 冇身分要求嘅崗位完全唔改

    const existing = {};
    (byPost[post.postId] || []).forEach(function (id) { existing[id] = true; });
    const postExcluded = excluded[post.postId] || {};

    roles.forEach(function (r) {
      if (required.indexOf(r.roleCode) === -1) return;
      if (existing[r.personId]) return;
      // 幹事喺 Eligibility 明確寫咗 Eligible=FALSE ⇒ 唔好因為身分而加返入去
      if (postExcluded[r.personId]) return;
      existing[r.personId] = true;
      if (!byPost[post.postId]) byPost[post.postId] = [];
      byPost[post.postId].push(r.personId);
    });
  });

  return byPost;
}

/**
 * 一次過讀齊「身分相關」嘅全部資料，組成一個可以直接傳畀規則判斷嘅物件。
 * 三條路徑（`buildGeneratorContext_()`／`buildFineTuneContext_()`／
 * `buildVerifyContext_()`）都呼叫呢一個函式，確保三者睇到嘅係同一份資料、
 * 用同一套增補邏輯——唔會出現「生成嗰陣容許、核對嗰陣話違規」呢種鬼故。
 *
 * @param {Object} eligibility `readEligibility()` 的結果
 * @param {Object[]} posts 已正規化的崗位清單
 * @param {string} timezone 時區名稱
 * @returns {{roles: Object[], exclusions: Object[], eligibleByPost: Object.<string, string[]>}}
 */
function buildRoleContext_(eligibility, posts, timezone) {
  const roles = readRolesSafe_(timezone);
  return {
    roles: roles,
    exclusions: readPersonPostExclusionsSafe_(timezone),
    eligibleByPost: buildRoleAugmentedEligibleByPost_(eligibility, posts, roles)
  };
}

// =====================================================================
// 以下係補建工作表嘅工具（A2）。⚠️ 本輪唔可以寫入試算表，
// 所以呢啲函式只係實作好，本輪冇執行過。
// =====================================================================

/**
 * 建立（若不存在）`Roles` 工作表。已存在時完全不動，回傳 isNew=false。
 * 做法完全比照 `SpecialSundaysSeed.gs` 的 `ensureSpecialSundaysSheet_()`：
 * 冪等、只新建、絕不覆寫任何既有內容。
 * @returns {{isNew: boolean}}
 */
function ensureRolesSheet_() {
  return ensureSimpleSheet_(SHEETS.ROLES, ROLES_HEADERS_TC, getRolesHeaderKeys_());
}

/**
 * 建立（若不存在）`PersonPostExclusions` 工作表。已存在時完全不動。
 * @returns {{isNew: boolean}}
 */
function ensurePersonPostExclusionsSheet_() {
  return ensureSimpleSheet_(
    SHEETS.PERSON_POST_EXCLUSIONS,
    PERSON_POST_EXCLUSIONS_HEADERS_TC,
    getPersonPostExclusionsHeaderKeys_());
}

/**
 * 兩張新表共用嘅建表邏輯（第 1 行中文標題、第 2 行機器鍵並隱藏、凍結兩行）。
 * @param {string} sheetName 工作表名稱
 * @param {string[]} headersTC 第 1 行中文標題
 * @param {string[]} keys 第 2 行機器鍵
 * @returns {{isNew: boolean}}
 */
function ensureSimpleSheet_(sheetName, headersTC, keys) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(sheetName)) return { isNew: false };

  const sheet = ss.insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headersTC.length).setValues([headersTC])
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
 * A2 嘅唯讀檢查：列出目前各身分有幾多人、個人崗位排除有幾多條，
 * 同埋幾項最容易靜靜出事嘅資料問題。純讀取，唔寫任何嘢（呼叫端負責寫
 * Diagnostics）。
 *
 * 特別檢查嘅三種「打錯字就規則靜靜失效」情況：
 * 1. `Posts.RequiredRoles` 引用咗一個**完全冇人持有**嘅身分代號——多數係
 *    打錯字（例如 `COMMITEE` 少咗一個 T），後果係嗰個崗位永遠排唔到人。
 * 2. `Roles.RoleCode` 用咗一個**冇任何崗位要求**嘅代號——可能係打錯字，
 *    亦可能只係記錄用途（所以只當提示，唔當錯誤）。
 * 3. 身分名單／排除名單入面嘅 `PersonID` 喺 `NameMapping` 搵唔到（或者
 *    已經 `Active=FALSE`）——嗰行等於冇作用。
 *
 * @param {string} timezone 時區名稱
 * @param {string} today 今日日期（yyyy-MM-dd），用嚟判斷邊啲行「目前生效中」
 * @returns {Object} 供 `buildRoleOverviewRows_()` 組報告用的統計
 */
function collectRoleOverview_(timezone, today) {
  const roles = readRolesSafe_(timezone);
  const exclusions = readPersonPostExclusionsSafe_(timezone);
  const posts = readPostsNormalized();

  const activePeopleIds = {};
  readPeople().forEach(function (row) {
    activePeopleIds[String(row[COLUMNS.NAME_MAPPING.PERSON_ID] || '').trim()] = true;
  });

  // 各身分目前生效中的人數（同一個人同一身分有多行時只計一次）
  const currentByRole = {};
  const allRoleCodes = {};
  roles.forEach(function (r) {
    allRoleCodes[r.roleCode] = true;
    if (!isEffectiveOn_(r.effectiveFrom, r.effectiveTo, today)) return;
    if (!currentByRole[r.roleCode]) currentByRole[r.roleCode] = {};
    currentByRole[r.roleCode][r.personId] = true;
  });

  const roleCounts = Object.keys(allRoleCodes).sort().map(function (code) {
    return {
      roleCode: code,
      label: ROLE_LABELS_TC[code] || code,
      currentCount: Object.keys(currentByRole[code] || {}).length,
      totalRows: roles.filter(function (r) { return r.roleCode === code; }).length
    };
  });

  // 有身分要求的崗位
  const gatedPosts = posts
    .map(function (p) { return { postId: p.postId, postNameTC: p.postNameTC, required: requiredRolesOfPost_(p) }; })
    .filter(function (p) { return p.required.length > 0; });

  // 問題 1：崗位引用咗冇人持有嘅身分代號
  const unknownRoleRefs = [];
  gatedPosts.forEach(function (p) {
    p.required.forEach(function (code) {
      if (!allRoleCodes[code]) {
        unknownRoleRefs.push(p.postNameTC + '（' + p.postId + '）要求身分「' + code
          + '」，但 ' + SHEETS.ROLES + ' 完全沒有任何人持有這個身分代號'
          + '（這個崗位會永遠排不到人；請檢查是不是打錯字）');
      }
    });
  });

  // 問題 2：身分代號冇任何崗位用到（只當提示）
  const requiredCodeSet = {};
  gatedPosts.forEach(function (p) { p.required.forEach(function (c) { requiredCodeSet[c] = true; }); });
  const unusedRoleCodes = Object.keys(allRoleCodes).sort().filter(function (c) { return !requiredCodeSet[c]; });

  // 問題 3：PersonID 唔喺在職名單
  const unknownPersonRefs = [];
  roles.forEach(function (r) {
    if (!activePeopleIds[r.personId]) {
      unknownPersonRefs.push(SHEETS.ROLES + '：PersonID「' + r.personId
        + '」不在 NameMapping 的在職名單內，這一行不會有任何作用');
    }
  });
  exclusions.forEach(function (e) {
    if (!activePeopleIds[e.personId]) {
      unknownPersonRefs.push(SHEETS.PERSON_POST_EXCLUSIONS + '：PersonID「' + e.personId
        + '」不在 NameMapping 的在職名單內，這一行不會有任何作用');
    }
  });

  const currentExclusions = exclusions.filter(function (e) {
    return isEffectiveOn_(e.effectiveFrom, e.effectiveTo, today);
  });

  return {
    today: today,
    rolesSheetExists: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ROLES),
    exclusionsSheetExists: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.PERSON_POST_EXCLUSIONS),
    roleCounts: roleCounts,
    totalRoleRows: roles.length,
    gatedPosts: gatedPosts,
    exclusionTotal: exclusions.length,
    exclusionCurrent: currentExclusions.length,
    exclusionDetails: currentExclusions.map(function (e) {
      return { personId: e.personId, postId: e.postId, reason: e.reason, effectiveTo: e.effectiveTo };
    }),
    unknownRoleRefs: unknownRoleRefs,
    unusedRoleCodes: unusedRoleCodes,
    unknownPersonRefs: unknownPersonRefs
  };
}

/**
 * 把 `collectRoleOverview_()` 嘅結果組成 Diagnostics 行陣列。純函式。
 *
 * ⚠️ 刻意**唔顯示任何姓名**，只顯示 PersonID 同人數——呢個報告會寫入
 * Diagnostics 工作表，而 Diagnostics 有可能被複製去對話／文件。PersonID
 * 本身唔係姓名，安全好多。要對返邊個人，幹事自己去 NameMapping 查。
 *
 * @param {Object} o `collectRoleOverview_()` 的結果
 * @returns {Object[]} `diagRow_()` 產生的行陣列
 */
function buildRoleOverviewRows_(o) {
  const rows = [];

  rows.push(diagRow_('身分名單', '工作表狀態',
    SHEETS.ROLES + '：' + (o.rolesSheetExists ? '已建立' : '尚未建立')
      + '　' + SHEETS.PERSON_POST_EXCLUSIONS + '：' + (o.exclusionsSheetExists ? '已建立' : '尚未建立'),
    o.rolesSheetExists ? '' : '尚未建立時，所有身分規則自動失效（系統行為與加入這些規則之前完全一樣）'));

  rows.push(diagRow_('身分名單', '判斷基準日', o.today,
    '「目前在任」是以這一日為準；換屆之後查舊季度，系統會改用該主日當日的日期判斷'));

  if (o.roleCounts.length === 0) {
    rows.push(diagRow_('身分名單', '各身分人數', '（沒有任何資料）',
      '請在 ' + SHEETS.ROLES + ' 工作表填入名單'));
  }
  o.roleCounts.forEach(function (r) {
    rows.push(diagRow_('身分名單', r.label + '（' + r.roleCode + '）',
      '目前在任 ' + r.currentCount + ' 人',
      '這個身分共有 ' + r.totalRows + ' 行紀錄（含已卸任的歷史紀錄）'));
  });

  if (o.gatedPosts.length === 0) {
    rows.push(diagRow_('身分要求', '有身分要求的崗位', '0 個',
      'Posts 工作表的 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄全部留空，目前沒有任何崗位受身分限制'));
  }
  o.gatedPosts.forEach(function (p) {
    rows.push(diagRow_('身分要求', p.postNameTC + '（' + p.postId + '）',
      describeRoleCodes_(p.required), '只有持有這個身分的人可以擔任（硬規則）'));
  });

  rows.push(diagRow_('個人崗位排除', '目前生效中', o.exclusionCurrent + ' 條',
    '共 ' + o.exclusionTotal + ' 條紀錄（含已解除的歷史紀錄）'));
  o.exclusionDetails.forEach(function (e) {
    rows.push(diagRow_('個人崗位排除', e.personId + ' ✕ ' + e.postId,
      e.reason || '（沒有填原因）',
      e.effectiveTo ? '至 ' + e.effectiveTo + ' 為止' : '暫時無限期（解除時填「解除日」，不要刪除整行）'));
  });

  const problems = o.unknownRoleRefs.concat(o.unknownPersonRefs);
  rows.push(diagRow_('資料檢查', '需要處理的問題', problems.length + ' 項',
    problems.length === 0 ? '沒有發現問題' : ''));
  problems.forEach(function (p, i) {
    rows.push(diagRow_('資料檢查', '問題 ' + (i + 1), '', p));
  });

  if (o.unusedRoleCodes.length > 0) {
    rows.push(diagRow_('資料檢查', '沒有任何崗位用到的身分代號', o.unusedRoleCodes.join('、'),
      '這不一定是錯——可能只是記錄用途。但如果你原意是要限制某個崗位，'
        + '請檢查 Posts 的 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄有沒有填。'));
  }

  return rows;
}

// =====================================================================
// 選單入口
// =====================================================================

/**
 * 選單項目「維護 ▸ 補建身分名單工作表」的執行入口。
 * 一次過補建 `Roles` 與 `PersonPostExclusions` 兩張表（都是冪等的，
 * 已存在時完全不動），因為兩者是同一套機制的兩半，分兩個選單項目
 * 只會令幹事漏做其中一個。
 * @returns {void}
 */
function runEnsureRoleSheets_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建身分名單工作表';
  try {
    const roles = ensureRolesSheet_();
    const exclusions = ensurePersonPostExclusionsSheet_();
    ui.alert(title,
      SHEETS.ROLES + '：' + (roles.isNew ? '已建立（只有標題列）' : '已存在，沒有做任何改動') + '\n'
        + SHEETS.PERSON_POST_EXCLUSIONS + '：'
        + (exclusions.isNew ? '已建立（只有標題列）' : '已存在，沒有做任何改動') + '\n\n'
        + '接下來要做的事：\n'
        + '1. 在 ' + SHEETS.ROLES + ' 填入堂委與執事名單（一人一行，PersonID 見 NameMapping）。\n'
        + '　 身分代號：' + ROLE_CODES.COMMITTEE + '＝堂委、' + ROLE_CODES.DEACON + '＝執事。\n'
        + '2. 在 Posts 工作表的 ' + COLUMNS.POSTS.REQUIRED_ROLES + ' 欄，\n'
        + '　 為「報告」填 ' + ROLE_CODES.COMMITTEE + '、\n'
        + '　 為「當值堂委」填 ' + ROLE_CODES.COMMITTEE + ',' + ROLE_CODES.DEACON + '（逗號分隔＝任一符合即可）。\n'
        + '　 （欄位不存在時，先執行「維護 ▸ 補建 Posts 欄位（崗位身分要求）」。）\n'
        + '3. 用「查看 ▸ 身分名單概況（唯讀）」核對填得對不對。\n\n'
        + '⚠️ 換屆時請在舊那一行填「結束日」，不要刪除整行——\n'
        + '　 刪除會令舊季度的職事表被追溯判定為違規。',
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runEnsureRoleSheets_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 選單項目「查看 ▸ 身分名單概況（唯讀）」的執行入口。
 * 只讀取，唯一會寫的是 Diagnostics 工作表。
 * @returns {void}
 */
function runRoleOverview_() {
  const ui = SpreadsheetApp.getUi();
  const title = '身分名單概況（唯讀）';
  try {
    const config = readConfig();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const overview = collectRoleOverview_(timezone, today);
    const rows = buildRoleOverviewRows_(overview);
    tryWriteDiagnostics_('身分名單概況', rows);

    const lines = ['判斷基準日：' + today, ''];
    if (!overview.rolesSheetExists) {
      lines.push('⚠ ' + SHEETS.ROLES + ' 工作表尚未建立——所有身分規則目前完全沒有生效，');
      lines.push('　 系統行為與加入這些規則之前完全一樣。');
      lines.push('　 請先執行「維護 ▸ 補建身分名單工作表」。', '');
    }
    overview.roleCounts.forEach(function (r) {
      lines.push(r.label + '（' + r.roleCode + '）：目前在任 ' + r.currentCount + ' 人'
        + '（共 ' + r.totalRows + ' 行紀錄，含已卸任）');
    });
    if (overview.roleCounts.length === 0) lines.push('（身分名單沒有任何資料）');

    lines.push('', '有身分要求的崗位：' + overview.gatedPosts.length + ' 個');
    overview.gatedPosts.forEach(function (p) {
      lines.push('　' + p.postNameTC + '（' + p.postId + '）→ ' + describeRoleCodes_(p.required));
    });

    lines.push('', '個人崗位排除：目前生效中 ' + overview.exclusionCurrent
      + ' 條（共 ' + overview.exclusionTotal + ' 條紀錄）');

    const problems = overview.unknownRoleRefs.concat(overview.unknownPersonRefs);
    lines.push('', problems.length === 0 ? '資料檢查：沒有發現問題 ✓' : '⚠ 發現 ' + problems.length + ' 項問題：');
    problems.slice(0, 10).forEach(function (p) { lines.push('　• ' + p); });
    if (problems.length > 10) lines.push('　……另有 ' + (problems.length - 10) + ' 項，詳見 Diagnostics');

    lines.push('', DIAGNOSTICS_WRITTEN_NOTE);
    ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runRoleOverview_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
