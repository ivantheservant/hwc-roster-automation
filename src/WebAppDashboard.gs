/**
 * 第二十三輪批次階段 C：`apiGetDashboardState()`——**幹事介面唯一嘅狀態端點**。
 *
 * 對應 `docs/幹事介面規格.md` 第 1.2／1.6／2.2／2.3 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要一個統一端點
 * ─────────────────────────────────────────────────────────────────────
 *
 * 舊 Web UI 每粒掣各自打後端攞自己嗰份資料（`apiStep2Preview`、
 * `apiStep4GetSendPreview`…），四粒掣即係四次來回，而且每次都各自
 * 重新讀一次 `RosterAssignments`／`SendLog`。更差嘅係：**四次呼叫之間
 * 狀態可以唔一致**——第一粒掣讀到 Stage=A，第三粒讀到 Stage=B，
 * 畫面就會同時顯示兩個互相矛盾嘅狀態。
 *
 * 呢個端點一次過算晒成版嘢，前端只需要一次呼叫，而且**成版數字一定
 * 出自同一個時間點嘅快照**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 大表只讀一次
 * ─────────────────────────────────────────────────────────────────────
 *
 * 用 `beginSheetReadMemo_()`／`endSheetReadMemo_()` 包住成個呼叫
 * （見 `SheetReader.gs` 檔頭）。**呢個函式全程零寫入**，所以開快取安全。
 * ⚠️ 日後如果有人喺呢度加任何寫入，一定要同時攞走快取，
 * 否則會出現「寫咗但讀返舊值」嗰種極難查嘅 bug。
 */

/**
 * 把 `2026T4` 譯成人話 `2026年10-12月`。
 *
 * 季度起始月份由 Config 嘅 `QUARTER_TERM_START_MONTHS` 決定
 * （教會唔一定用日曆季度），所以唔可以寫死 `T4 = 10-12 月`。
 * @param {string} quarterId 例如 `2026T4`
 * @returns {string} 人話季度名；認唔出格式就原樣回傳 quarterId
 */
function buildQuarterLabel_(quarterId) {
  const m = /^(\d{4})T([1-4])$/.exec(String(quarterId || '').trim());
  if (!m) return String(quarterId || '');

  const year = m[1];
  const term = Number(m[2]);
  const monthsRaw = getConfig(CONFIG_KEYS.QUARTER_TERM_START_MONTHS, DEFAULTS.QUARTER_TERM_START_MONTHS);
  const months = String(monthsRaw).split(',').map(function (s) { return Number(String(s).trim()); });
  if (months.length !== 4 || months.some(isNaN)) return year + '年　第 ' + term + ' 季';

  const startMonth = months[term - 1];
  const endMonth = term === 4 ? months[0] - 1 : months[term] - 1;
  const normalisedEnd = endMonth <= 0 ? 12 : endMonth;
  return year + '年' + startMonth + '-' + normalisedEnd + '月';
}

/**
 * 規格 1.2：狀態卡嗰句人話。
 *
 * 第二十五輪批次階段 A3：「系統會在 X 自動生成」呢句已經唔啱——
 * 自動生成預設關咗，初稿一律由幹事撳掣。呢句留住嘅話，幹事會等一個
 * 永遠唔會嚟嘅日子。
 * @param {string} stage 內部 Stage
 * @param {boolean} versionExists 有冇版本
 * @param {string} generateOnText 建議生成日期（Quarters.GenerateOn），冇就傳空字串
 * @returns {string}
 */
function buildDashboardStatusText_(stage, versionExists, generateOnText, extras) {
  // ⚠️ 第六十三輪批次 F 組：狀態卡要講真話。
  //   ・正式發出咗但未寄晒 ⇒「已正式發出：N／M 位」＋ 指去補寄
  //   ・最新一版未寄過 ⇒ 直接重用 `buildSendHistoryView_()` 嘅 `warnSentence`
  //   （唔另寫一份判斷）
  const base = buildDashboardStatusBase_(stage, versionExists, generateOnText, extras);
  const unsent = extras && extras.unsentWarn ? ' ' + extras.unsentWarn : '';
  return base + unsent;
}

function buildDashboardStatusBase_(stage, versionExists, generateOnText, extras) {
  if (stage === QUARTER_STAGE.OFFICIAL_SENT && extras && extras.officialReach
      && extras.officialReach.expected > 0) {
    const r = extras.officialReach;
    if (r.notReached > 0) {
      return '已正式發出：' + r.reached + '／' + r.expected + ' 位。還有 ' + r.notReached
        + ' 位未收到，要用「進階與診斷 ▸ 補寄未收到的人」補寄。';
    }
    return '已正式發出給全體（' + r.reached + '／' + r.expected + ' 位）。';
  }
  if (stage === QUARTER_STAGE.DRAFT && !versionExists) {
    return generateOnText
      ? '還未生成初稿。建議在 ' + generateOnText + ' 之後生成，撳下面的「生成初稿」。'
      : '還未生成初稿。撳下面的「生成初稿」。';
  }
  if (stage === QUARTER_STAGE.DRAFT) return '初稿已生成，未寄給堂委。';
  if (stage === QUARTER_STAGE.REVIEW_SENT) return '已寄給堂委，等他們的意見。';
  if (stage === QUARTER_STAGE.REQUESTS_APPLIED) return '堂委意見已處理，未正式發出給全體。';
  if (stage === QUARTER_STAGE.OFFICIAL_SENT) return '已正式發出給全體。';
  return '這一季的情況：' + stage;
}

/**
 * `RosterVersions.Basis` 嘅內部代號 → 人話。
 *
 * ⚠️ 第二十五輪批次階段 B1 修：呢個對照表以前唔存在，`Basis` 係原封不動
 * 印上狀態卡嘅，幹事見到嘅係 `REQUESTS_APPLIED` 呢種內部代號（違反規格 1.3）。
 *
 * 全專案掃過一次，`registerVersion()` 嘅 basis 參數一共有五個來源：
 *   `VERSION_VALUES.BASIS_AUTO_GENERATE`／`BASIS_FINE_TUNE`／
 *   `BASIS_REQUESTS_APPLIED`／`BASIS_RESEND`（Constants.gs），
 *   以及 `WebAppRollback.gs` 傳入嘅「回到第 N 版」——後者本身已經係人話，
 *   對照表查唔到會原樣顯示咩？**唔會**，見 `translateVersionBasis_()`。
 */
const VERSION_BASIS_LABELS = {
  AUTO_GENERATE: '系統生成',
  // 第七十七輪批次 EC 組：舊字眼改為「人手改動」（有格數嗰陣會寫「人手改動 N 格」）
  FINE_TUNE: '人手改動',
  REQUESTS_APPLIED: '套用修改申報後',
  RESEND: '改動後重發時建立',
  VERSION_ROLLBACK: '回到舊版本',
  // 第六十七輪批次 AF 組
  IMPORT: '由人手職事表匯入',
  // 第七十五輪批次 CH 組（「以第 M 版作起點」本身係中文，照用，見下面）
  SUGGESTION: '系統調整'
};

/**
 * 把 `Basis` 譯成人話。
 *
 * 對照表查唔到嘅值**唔會照印**——照印就係把內部代號漏落畫面，
 * 亦即係呢一條要修嘅嘢本身。但有一個例外：回退版本嗰個 Basis
 * （`WebAppRollback.gs` 寫嘅「回到第 N 版」）本身就已經係中文人話，
 * 冇必要當成未知值蓋走。判斷準則係「有冇中文字」——內部代號一律
 * 係全大楷英文加底線，唔會含中文。
 * @param {*} basis `RosterVersions.Basis` 原始值
 * @returns {string} 人話；認唔出而且唔似人話就回「（沒有說明）」
 */
function translateVersionBasis_(basis) {
  const raw = String(basis === null || basis === undefined ? '' : basis).trim();
  if (raw === '') return '';
  if (VERSION_BASIS_LABELS[raw]) return VERSION_BASIS_LABELS[raw];
  // 已經係中文（例如回退寫嘅「回到第 3 版」）就照用。
  if (/[一-鿿]/.test(raw)) return raw;
  return '（沒有說明）';
}

/**
 * 規格 5.1：版本描述一律寫人話，永不淨寫 `v2`。
 *
 * ⚠️ 第二十五輪批次階段 B1 修：呢個函式以前會把 `Basis` 同 `Notes` 駁埋。
 * 問題係 v0 嘅 `Notes` 存住嘅係 seed／偏差／百分比呢類**技術統計數字**
 * （`buildSeedNote_()` 寫入），駁埋之後狀態卡會變成一大段幹事完全睇唔明
 * 嘅嘢。技術數字唔應該喺主畫面出現——要睇就去區四「核對職事表」。
 *
 * 所以而家**只用 Basis**，`Notes` 唔再入狀態卡。
 * @param {*} basis `RosterVersions.Basis`
 * @returns {string} 空白時回傳「（沒有說明）」
 */
function buildVersionBasisText_(basis) {
  const text = translateVersionBasis_(basis);
  return text === '' ? '（沒有說明）' : text;
}

/**
 * 第七十七輪批次 EC 組：一個版本嘅來源（人話）——版本下拉、狀態卡、進階與診斷嘅版本清單**同一支**。
 *
 * Ivan（手動測試 B）：「有些修改是人手改完＋系統調整，可不可以在每一個版本反映是人手、系統還是兩者都有？」
 * 數字由 `RosterVersions.ChangeCounts` 嚟（`registerVersion()` 嗰陣寫入）：
 *   只有人手：「人手改動 N 格」　只有系統：「系統調整 M 格」　兩者：「人手改動 N 格＋系統調整 M 格」
 *   以舊版本作起點：「以第 K 版作起點」，再有人手改動就加「＋人手改動 N 格」
 *   系統生成、重新生成、匯入、套用修改申報後：照現有文字（套用申報時有人手改動 ⇒ 加「＋人手改動 N 格」）
 *   舊版本冇數字：照現有文字，**唔猜**。
 * @param {Object} row `RosterVersions` 一行
 * @returns {string}
 */
function buildVersionSourceText_(row) {
  const V = COLUMNS.ROSTER_VERSIONS;
  const basis = String(row[V.BASIS] === null || row[V.BASIS] === undefined ? '' : row[V.BASIS]).trim();
  const parent = String(row[V.PARENT_VERSION_NO] === null || row[V.PARENT_VERSION_NO] === undefined
    ? '' : row[V.PARENT_VERSION_NO]).trim();
  // 生成時已經有舊版本 ⇒ 重新生成（`MultiRun.gs` 寫 ParentVersionNo＝上一版）
  if (basis === VERSION_VALUES.BASIS_AUTO_GENERATE && parent !== '') return '重新生成';
  const base = buildVersionBasisText_(basis);
  const counts = parseVersionChangeCounts_(row[V.CHANGE_COUNTS]);
  if (!counts) return base;
  const manual = counts.manual > 0 ? '人手改動 ' + counts.manual + ' 格' : '';
  const system = counts.system > 0 ? '系統調整 ' + counts.system + ' 格' : '';
  if (counts.startPoint !== null) {
    return '以第 ' + counts.startPoint + ' 版作起點' + (manual ? '＋' + manual : '');
  }
  if (basis === VERSION_VALUES.BASIS_FINE_TUNE || basis === VERSION_VALUES.BASIS_SUGGESTION) {
    const parts = [manual, system].filter(function (s) { return s !== ''; });
    return parts.length > 0 ? parts.join('＋') : base;
  }
  return base + (manual ? '＋' + manual : '');
}

/**
 * 把 `SendLog.SentAt` 呢類時間戳正規化成**可以排序嘅數字**同**可以睇嘅文字**。
 *
 * ⚠️ 第二十五輪批次階段 B2：呢個係同一個 bug class 嘅**第三次**——
 * 「從工作表讀出嚟嘅值未經格式化就送去畫面」。
 *   第二十二輪：`QuarterReset.gs` 嘅「加入於」
 *   第二十三輪：`ICS_SERVICE_START_TIME`
 *   第二十五輪（今次）：`SendLog.SentAt`
 * 幹事見到嘅係 `Mon Aug 17 2026 04:35:09 GMT+1200 (New Zealand Standard Time)`。
 *
 * 而喺呢一次入面仲有**第二個、更難察覺嘅 bug**：舊寫法用
 * `String(sentAt) > String(lastSentAt)` 嚟揀最新一筆。Date 物件
 * `String()` 出嚟係 `Mon Aug 17 ...`／`Sun Sep 01 ...` 呢種格式，
 * 字串比大細係**逐個字母比**——`'M' < 'S'`，所以九月會被當成「大過」
 * 八月純屬巧合，換成 `Fri`／`Wed` 就會揀錯。要排序就一定要用
 * 真正嘅時間值，唔可以用顯示文字。
 *
 * @param {*} value `SendLog.SentAt` 原始值（可能係 Date、可能係文字）
 * @param {string} timezone 時區
 * @returns {?{sortKey: number, text: string}} 認唔出就回 null
 */
function normalizeSentAt_(value, timezone) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date || (value && typeof value.getTime === 'function')) {
    const ms = value.getTime();
    if (isNaN(ms)) return null;
    return { sortKey: ms, text: Utilities.formatDate(value, timezone, 'yyyy-MM-dd HH:mm') };
  }

  const raw = String(value).trim();
  if (raw === '') return null;
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return { sortKey: parsed.getTime(), text: Utilities.formatDate(parsed, timezone, 'yyyy-MM-dd HH:mm') };
  }
  // 認唔出嘅格式：**照原文顯示，但排序權重設成 0**。
  // 唔可以靜靜丟掉（會令「上次幾時寄」變成空白，睇落好似冇寄過），
  // 亦唔可以當成最新（會令一個爛值蓋過真正嘅最新一筆）。
  return { sortKey: 0, text: raw };
}

/**
 * 一次讀完 `SendLog`，同時算齊「各階段最後寄出時間」同「有冇任何 OFFICIAL 紀錄」。
 *
 * 規格 2.6 第 2 層防重複要求：`SendLog` 內呢個季度**不論版本、不論 DRY_RUN**
 * 只要有任何 `OFFICIAL` 紀錄就當已經正式發出過。所以唔可以只睇最新版本。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {{lastSentAt: Object.<string, ?string>, hasOfficialRecord: boolean}}
 *   `lastSentAt` 嘅值係**已經格式化好嘅顯示文字**（yyyy-MM-dd HH:mm），
 *   唔係 Date 物件——前端會原封不動貼上畫面。
 */
function readSendLogSummaryForDashboard_(quarterId, timezone) {
  const C = COLUMNS.SEND_LOG;
  const tz = timezone || getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const stages = [MAIL_STAGES.REVIEW, MAIL_STAGES.OFFICIAL, MAIL_STAGES.RESEND];
  const lastSentAt = {};
  const bestSortKey = {};
  stages.forEach(function (s) { lastSentAt[s] = null; bestSortKey[s] = null; });
  let hasOfficialRecord = false;
  // 第七十七輪批次 EE 組：呢一季有冇「正式發出過」（OFFICIAL／RESEND 有紀錄，或者匯入時聲明已在系統外寄出）
  // ——〔變動的人〕只喺之後先可以撳。
  let officialSentOnce = false;
  // 第四十八輪批次 A4 組第 3 點：最近一筆嘅 `SendOptions`。
  //
  // ⚠️ **摺入呢一次讀，唔另開一次。** `WebAppDashboard.gs` 由第十九輪
  // 起就守住「SendLog 只喺一個地方讀」，而 `tests/webapp_dashboard_state.test.js`
  // 會靜態檢查 `readSheet(SHEETS.SEND_LOG)` 只出現一次。
  // 另開一次讀嘅代價唔止係慢：兩次讀之間張表可以變，
  // 而畫面上兩個數字就會對唔上。
  let latestOptions = '';
  let latestSortKey = null;
  // 第七十輪批次 AU 組：上一批審閱本實際寄給咗幾多位（同一次讀入面順手收集）
  const reviewRows = [];

  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[C.QUARTER_ID] || '').trim() !== quarterId) return;
    const stage = String(row[C.STAGE] || '').trim();
    if (stage === MAIL_STAGES.OFFICIAL) hasOfficialRecord = true;
    if (stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND
        || String(row[C.STATUS] || '').trim().toUpperCase() === MAIL_STATUS.EXTERNAL) {
      officialSentOnce = true;
    }
    if (stage === MAIL_STAGES.REVIEW) reviewRows.push(row);

    const sentAt = normalizeSentAt_(row[C.SENT_AT], tz);
    // ⚠️ 「最近一筆」唔篩階段——三個階段任何一次寄出都算數。
    // 篩咗嘅話，一次用缺口寄出嘅「改動後重發」就會被漏走，
    // 而嗰一句警告永遠唔會出現。
    if (sentAt && (latestSortKey === null || sentAt.sortKey > latestSortKey)) {
      latestSortKey = sentAt.sortKey;
      latestOptions = String(row[C.SEND_OPTIONS] || '');
    }

    if (stages.indexOf(stage) === -1) return;
    if (!sentAt) return;
    // 比大細用 sortKey（真正嘅時間值），顯示用 text（已格式化）。
    if (bestSortKey[stage] === null || sentAt.sortKey > bestSortKey[stage]) {
      bestSortKey[stage] = sentAt.sortKey;
      lastSentAt[stage] = sentAt.text;
    }
  });

  return {
    lastSentAt: lastSentAt,
    hasOfficialRecord: hasOfficialRecord,
    officialSentOnce: officialSentOnce,
    unsavedRelease: parseUnsavedReleaseNote_(latestOptions),
    lastReviewBatch: findLastReviewBatch_(reviewRows, quarterId, tz)
  };
}

/**
 * 規格 2.2／2.3：四粒掣嘅 `enabled`／`disabledReason`／`dynamicText`。
 *
 * **純函式**，唔碰任何 Google API——呢度係規格入面最容易寫錯、
 * 亦都係最需要逐個情境測到嘅一段，所以特登抽出嚟可以離線測。
 *
 * ⚠️ `disabledReason` 一律寫「**怎樣才撳得到**」，唔寫「為何失敗」（規格 1.6）。
 * 反例：`目前鎖定——現在 Stage 是 DRAFT`（幹事完全唔知下一步做咩）。
 *
 * @param {Object} s 已經算好嘅事實
 * @returns {Object} 四粒掣各自嘅狀態
 */
function computeDashboardButtons_(s) {
  const unsaved = s.unsaved;
  const buttons = {};

  // ── 掣 0：生成初稿（第二十五輪批次階段 A4 新增）────────────────
  //
  // 只喺**完全冇版本**時存在。有版本之後前端唔會畫佢——重新生成
  // （覆蓋式）留喺區四「進階功能」，唔應該同日常四粒掣擺埋一齊。
  buttons.generate = {
    enabled: !s.versionExists,
    disabledReason: s.versionExists
      ? '這一季已經有初稿了。如果要重新生成，請去「進階功能」。' : '',
    dynamicText: buildGenerateButtonText_(s)
  };

  // ── 掣 1：儲存並確認 ──────────────────────────────────────────
  // 規格 2.2：有版本就任何 Stage 都撳得到（佢係唯一會改內容嘅掣）。
  //
  // 第二十五輪批次階段 B4：措辭由「要等系統生成咗初稿」改成
  // 「要先生成初稿」——一來自動生成關咗，「等」係錯嘅；
  // 二來原本嗰句係口語（「咗」），畫面文案一律書面語。
  buttons.save = computeSaveButton_(s);

  // ── 掣 2：寄給堂委審閱 ────────────────────────────────────────
  // D2：開放於 DRAFT／REVIEW_SENT／REQUESTS_APPLIED（＝未正式發出之前）。
  const reviewStageOk = s.versionExists && s.stage !== QUARTER_STAGE.OFFICIAL_SENT;
  buttons.review = {
    enabled: reviewStageOk && !unsaved.hasAny,
    disabledReason: !s.versionExists
      ? '要先生成初稿，這一粒才會著。'
      : (s.stage === QUARTER_STAGE.OFFICIAL_SENT
        ? '這一季已經正式發出給全體，不會再寄審閱本。之後有改動請用「改動後重發」。'
        : (unsaved.hasAny ? buildUnsavedBlockHint_(unsaved) : '')),
    dynamicText: buildReviewButtonText_(s),
    recipientCount: s.reviewerCount,
    lastSentAt: s.lastSentAt[MAIL_STAGES.REVIEW]
  };

  // ── 掣 3：正式發出給全體 ──────────────────────────────────────
  // 三層防重複（規格 2.6）：Stage、SendLog 有冇 OFFICIAL 紀錄、未儲存改動。
  const officialStageOk = s.stage === QUARTER_STAGE.REQUESTS_APPLIED;
  buttons.official = {
    enabled: officialStageOk && !s.hasOfficialRecord && !unsaved.hasAny,
    disabledReason: s.hasOfficialRecord
      ? '已經正式發出過。之後有改動請用「改動後重發」。'
      : (!officialStageOk
        ? '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存」，這一粒才會著。'
        : (unsaved.hasAny ? buildUnsavedBlockHint_(unsaved) : '')),
    dynamicText: buildOfficialButtonText_(s),
    targetPersonCount: s.officialTargetCount,
    noEmailCount: s.officialNoEmailCount,
    lastSentAt: s.lastSentAt[MAIL_STAGES.OFFICIAL]
  };

  // ── 掣 4：改動後重發 ──────────────────────────────────────────
  // E4 內容閘：0 人有改動就唔應該亮（重發一封內容一模一樣嘅信只會令人困惑）。
  const resendStageOk = s.stage === QUARTER_STAGE.OFFICIAL_SENT;
  buttons.resend = {
    enabled: resendStageOk && !unsaved.hasAny && s.changedPersonCount > 0,
    disabledReason: !resendStageOk
      ? '要先撳「正式發出給全體」，這一粒才會著。'
      : (unsaved.hasAny
        ? buildUnsavedBlockHint_(unsaved)
        : (s.changedPersonCount === 0 ? '沒有人的安排改過，不需要重發。' : '')),
    dynamicText: buildResendButtonText_(s),
    changedPersonCount: s.changedPersonCount,
    arrangementChangedCount: s.arrangementChangedCount,
    notReceivedCount: s.notReceivedCount,
    lastSentAt: s.lastSentAt[MAIL_STAGES.RESEND]
  };

  return buttons;
}

/**
 * 掣 0 嘅動態文字（規格 2.1，第二十五輪批次階段 A4 改寫）。
 *
 * 三種情況分開講，因為幹事真正想知嘅係「而家撳係咪太早」：
 *   未到建議日期 ⇒ 講埋「現在就生成也可以」，唔好令佢以為要等
 *   已過建議日期 ⇒ 講過咗幾多日，呢個先係催佢嘅訊號
 *   冇設定日期　 ⇒ 唔可以扮有日期
 * @param {Object} s 已經算好嘅事實
 * @returns {string}
 */
function buildGenerateButtonText_(s) {
  if (s.versionExists) return '這一季已經有初稿了。';
  if (!s.generateOnText) return '隨時可以生成。';
  if (s.daysUntilGenerateOn === null || s.daysUntilGenerateOn === undefined) {
    return '建議在 ' + s.generateOnText + ' 之後生成。現在就生成也可以。';
  }
  if (s.daysUntilGenerateOn > 0) {
    return '建議在 ' + s.generateOnText + ' 之後生成，那時距離季初大約五個星期。'
      + '現在就生成也可以。';
  }
  if (s.daysUntilGenerateOn === 0) {
    return '原定 ' + s.generateOnText + ' 生成，就是今天。';
  }
  return '原定 ' + s.generateOnText + ' 生成，已經過了 '
    + Math.abs(s.daysUntilGenerateOn) + ' 天。';
}

/** 第八十二輪批次 IH 組：〔儲存〕灰色時嘅原因（表上冇未儲存改動）。 */
const SAVE_NOTHING_TO_SAVE_TEXT = '表上沒有未儲存的改動';

/**
 * 掣 1〔儲存〕嘅狀態——主畫面同「切回幹事介面時嘅輕量檢查」（`apiGetSaveButtonState()`）**同一支**。
 *
 * 第八十二輪批次 IH 組（Ivan：沒有改動的話〔儲存〕可不可以變灰？）：
 * 有版本、而且有嘢要儲存（表上改動、認唔出嘅名、未處理嘅修改申報、用舊版本作起點未儲存）先亮。
 * 讀唔到未儲存狀態（`hasAny` 會係 true、數字係 -1）⇒ 照舊亮——唔可以把「讀唔到」當成「冇嘢」。
 * @param {Object} s `{versionExists, stage, unsaved, startPointPending}`
 * @returns {{enabled: boolean, disabledReason: string, dynamicText: string, hasWork: boolean}}
 */
function computeSaveButton_(s) {
  const u = s.unsaved || {};
  const hasWork = !!u.hasAny || Number(u.unresolvedCount) > 0 || !!s.startPointPending;
  const enabled = !!s.versionExists && hasWork;
  return {
    enabled: enabled,
    hasWork: hasWork,
    disabledReason: !s.versionExists ? '要先生成初稿，這一粒才會著。' : (hasWork ? '' : SAVE_NOTHING_TO_SAVE_TEXT),
    dynamicText: buildSaveButtonText_(s)
  };
}

/**
 * 第八十二輪批次 IH 組：幹事由試算表分頁切返幹事介面 ⇒ 前端用呢個**輕量**呼叫重新檢查有冇未儲存改動，
 * 只更新〔儲存〕同第 2 步嗰句，唔重載成個主畫面。
 * @param {string} quarterId 季度 ID
 * @returns {{versionNo: number, save: Object}}
 */
function apiGetSaveButtonState(quarterId) {
  assertWebAppRequestAllowed_();
  const versionNo = findLatestVersionNo(quarterId);
  const versionExists = versionNo >= 0;
  const s = {
    versionExists: versionExists,
    stage: getQuarterStage_(quarterId),
    unsaved: versionExists ? readDashboardUnsavedState_(quarterId, versionNo)
      : { gridChangeCount: 0, unresolvedCount: 0, pendingRequestCount: 0, needsInputCount: 0, hasAny: false },
    startPointPending: versionExists && readStartPointBasisForSave_(quarterId, versionNo) !== null
  };
  return { versionNo: versionNo, save: computeSaveButton_(s) };
}

/** 規格 2.3 掣 1 嘅動態文字。 */
function buildSaveButtonText_(s) {
  const u = s.unsaved;
  if (u.unresolvedCount > 0) {
    // 第七十五輪批次 CE 組：認唔出嘅名唔再擋，撳落去可以逐個決定
    return '有 ' + u.unresolvedCount + ' 個名字在名單上找不到。撳〔儲存〕或者〔檢查我的改動〕，'
      + '可以逐個選〔加入名單〕或者「這一季臨時幫手，不加入名單」。';
  }
  // 第三十四輪批次甲3：`NEEDS_INPUT` 唔再擋住流程，但**一定要講出嚟**，
  // 否則就變成靜靜消失。一律當成句尾嘅補充。
  const needsInput = Number(u.needsInputCount) > 0
    ? '另有 ' + u.needsInputCount + ' 筆申報系統看不懂，需要你自己到 Requests 工作表處理'
      + '（它們不會擋住「正式發出」）。'
    : '';

  const noChange = u.gridChangeCount === 0 && u.pendingRequestCount === 0;
  // 第八十二輪批次 IH／IF 組：用舊版本作起點而表上冇偵測到差異
  if (noChange && s.startPointPending) return '你用了舊版本作起點，還未儲存。撳〔儲存〕成為新一版。' + needsInput;
  if (noChange && s.stage === QUARTER_STAGE.REVIEW_SENT) {
    return '堂委沒有提出改動。撳下去就當作意見已收齊，可以進入正式發出。' + needsInput;
  }
  if (noChange) return '未偵測到你在表上改過任何格。' + needsInput;
  if (u.gridChangeCount > 0 && u.pendingRequestCount > 0) {
    return '偵測到你在表上改了 ' + u.gridChangeCount + ' 格，另有 '
      + u.pendingRequestCount + ' 筆修改申報未處理。' + needsInput;
  }
  if (u.gridChangeCount > 0) return '偵測到你在表上改了 ' + u.gridChangeCount + ' 格。' + needsInput;
  return '有 ' + u.pendingRequestCount + ' 筆修改申報未處理。' + needsInput;
}

/** 規格 2.3 掣 2 嘅動態文字。 */
function buildReviewButtonText_(s) {
  if (s.reviewerCount === 0) {
    return '現時沒有登記任何堂委電郵，寄出去不會有人收到。先去「常用設定 ▸ 身分（堂委／執事）」補。';
  }
  const last = s.lastSentAt[MAIL_STAGES.REVIEW];
  // 第七十輪批次 AU 組：呢粒掣寄嘅係**預設審閱名單**（`Role=REVIEWER`），
  // 唔係「上一批」——上一批可能係幹事自己勾嘅另一班人。照實講。
  if (last) {
    const batch = s.lastReviewBatch;
    const defaultText = '再撳一次會寄給預設的審閱名單（' + s.reviewerCount + ' 位）。';
    return (batch && batch.found)
      ? ('上次在 ' + last + ' 寄過（' + batch.count + ' 位）。' + defaultText)
      : ('上次在 ' + last + ' 寄過，但查不到當時的收件人。' + defaultText);
  }
  return '把唯讀連結寄給 ' + s.reviewerCount + ' 位收件人。';
}

/** 規格 2.3 掣 3 嘅動態文字。 */
function buildOfficialButtonText_(s) {
  // 第二十五輪批次階段 B3：冇版本嘅時候唔可以報一個「0」。
  //
  // 舊寫法會顯示「會寄給表上 0 個人」——嗰個 0 唔係「數過，係零」，
  // 而係「根本未有表可以數」。呢個係本專案一路燒緊嘅同一個 bug class：
  // **把「查不到」講成一個具體數字**。零同未知係兩件事，
  // 「0 個人」會令幹事以為名單有問題，去搵一個唔存在嘅錯。
  if (!s.versionExists) return '還未生成初稿，未知會寄給哪幾位。';
  if (s.hasOfficialRecord) {
    const last = s.lastSentAt[MAIL_STAGES.OFFICIAL];
    return '已在 ' + (last || '之前') + ' 正式發出過。之後有改動請用「改動後重發」。';
  }
  if (s.officialNoEmailCount > 0) {
    return '會寄給表上 ' + s.officialTargetCount + ' 個人中的 '
      + (s.officialTargetCount - s.officialNoEmailCount) + ' 人；另外 '
      + s.officialNoEmailCount + ' 人沒有電郵，會略過。';
  }
  return '會寄給表上 ' + s.officialTargetCount + ' 個人，每人一份標示了自己名字的 PDF 和月曆檔。';
}

/** 規格 2.3 掣 4 嘅動態文字。 */
function buildResendButtonText_(s) {
  if (s.changedPersonCount === 0) return '自上次發出之後沒有人的安排改過，不需要重發。';
  // ⚠️ 第六十三輪批次 R 組：**「上次冇收到」嘅人唔計入「安排改了」。**
  // 上次正式發出只寄咗部分人嘅話，其餘人冇舊紀錄，舊寫法會講
  // 「有 54 個人的安排改了」。冇提供分類（舊呼叫端）⇒ 照舊用總數。
  const changedN = typeof s.arrangementChangedCount === 'number'
    ? s.arrangementChangedCount : s.changedPersonCount;
  const notReceived = typeof s.notReceivedCount === 'number' ? s.notReceivedCount : 0;
  const head = changedN > 0
    ? '自上次發出之後，有 ' + changedN + ' 個人的安排改了。'
    : '自上次發出之後沒有人的安排改過。';
  if (notReceived > 0) {
    return head + '另外 ' + notReceived + ' 位上次正式發出時沒有收到——'
      + '要寄第一次通知給他們，用「補寄未收到的人」。';
  }
  return head + '只會寄給這 ' + changedN + ' 人和堂委。';
}

/**
 * 掣 2／3／4 因為「有未儲存改動」而唔撳得時嘅提示。
 * 規格 1.6：講「怎樣才撳得到」。
 * @param {Object} unsaved 未儲存改動摘要
 * @returns {string}
 */
function buildUnsavedBlockHint_(unsaved) {
  const bits = [];
  if (unsaved.gridChangeCount > 0) bits.push('你在表上改了 ' + unsaved.gridChangeCount + ' 格');
  if (unsaved.unresolvedCount > 0) bits.push('有 ' + unsaved.unresolvedCount + ' 格的文字系統認不出');
  if (unsaved.pendingRequestCount > 0) bits.push('有 ' + unsaved.pendingRequestCount + ' 筆修改申報未處理');
  return bits.join('、') + '。先撳「儲存」，這一粒才會著。';
}

/**
 * 供前端呼叫：一次過取得整頁狀態。**純讀取，零寫入。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} 見檔頭與規格第二節
 */
function apiGetDashboardState(quarterId) {
  assertWebAppRequestAllowed_();

  // 全程零寫入，所以開 readSheet 快取安全——見 SheetReader.gs 檔頭嘅警告。
  beginSheetReadMemo_();
  try {
    return buildDashboardState_(quarterId);
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * `apiGetDashboardState()` 嘅實作本體（分開一層，令快取嘅 try/finally 夠清晰）。
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function buildDashboardState_(quarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const stage = getQuarterStage_(quarterId);
  const versionNo = findLatestVersionNo(quarterId);
  const versionExists = versionNo >= 0;
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;

  const quarterRow = findQuarter_(quarterId);
  const generateOnText = quarterRow
    ? toDateString(quarterRow[COLUMNS.QUARTERS.GENERATE_ON], timezone) : '';
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const daysUntilGenerateOn = generateOnText ? daysBetween_(today, generateOnText) : null;

  // ── 最新版本資料 ─────────────────────────────────────────────
  let latestVersion = null;
  if (versionExists) {
    const V = COLUMNS.ROSTER_VERSIONS;
    const row = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (r) {
      return String(r[V.QUARTER_ID] || '').trim() === quarterId
        && Number(r[V.VERSION_NO]) === versionNo;
    })[0];
    latestVersion = {
      versionNo: versionNo,
      // ⚠️ 唔可以 String(Date)——第二十二輪已經喺 Diagnostics 修過同一個位。
      createdAt: row ? toDateString(row[V.CREATED_AT], timezone) : '',
      // 第七十七輪批次 EC 組：同版本下拉同一支（有格數就寫「人手改動 N 格＋系統調整 M 格」）
      basisText: row ? buildVersionSourceText_(row) : '（沒有說明）',
      // A6：常駐「開啟職事表」連結。搵唔到嗰張工作表就係空字串——
      // 前端見到空字串就唔會畫個連結出嚟。
      sheetUrl: row ? buildGridSheetUrl_(row[V.SHEET_NAME]) : ''
    };
  }
  // 第七十五輪批次 CH 組：第 2 步嘅版本下拉（讀唔到唔可以令主畫面出唔到）
  let versionChoices = [];
  if (versionExists) {
    try {
      versionChoices = listQuarterVersionChoices_(quarterId, timezone);
    } catch (err) {
      log_('WARN', 'buildDashboardState_ 讀不到版本清單：' + err.message);
    }
  }

  // ── 未儲存改動（三者任一，規格 2.2）─────────────────────────
  const unsaved = readDashboardUnsavedState_(quarterId, versionNo);

  // ── SendLog（整張表只讀一次，同時算齊三個階段 + 有冇 OFFICIAL 紀錄）──
  const sendLog = readSendLogSummaryForDashboard_(quarterId, timezone);

  // 第二十六輪批次階段 A2：公開連結狀態。前端用嚟喺掣 2 旁邊提早講，
  // 唔使等幹事撳落去先發現。
  const publicLink = readPublicLinkState_(quarterId);
  // ⚠️ 第六十三輪批次 A 組：有連結**唔等於**連結係最新。
  // 填咗講員而未重發佈，堂委開連結見到嘅講員係「待確認」。
  // 判斷唔到 ⇒ 唔顯示（`stale: false`），寄出前嗰道會照樣補發。
  publicLink.stale = false;
  publicLink.staleMessage = '';
  try {
    const freshness = evaluatePublicLinkFreshness_(quarterId);
    publicLink.stale = !!(freshness.hasLink && freshness.stale);
    publicLink.staleMessage = publicLink.stale ? freshness.message : '';
  } catch (err) {
    log_('WARN', 'apiGetDashboardState：查不到公開連結是不是最新：' + err.message);
  }

  // ── 掣 3／掣 4 要嘅人數 ──────────────────────────────────────
  const officialCounts = countDashboardOfficialTargets_(quarterId, versionNo, versionExists);
  const resendBreakdown = stage === QUARTER_STAGE.OFFICIAL_SENT
    ? countDashboardResendBreakdown_(quarterId)
    : { total: 0, arrangementChanged: 0, notReceived: 0 };
  const changedPersonCount = resendBreakdown.total;

  const facts = {
    stage: stage,
    versionExists: versionExists,
    generateOnText: generateOnText,
    daysUntilGenerateOn: daysUntilGenerateOn,
    unsaved: unsaved,
    // 第八十二輪批次 IH 組：用舊版本作起點而未儲存，都係一項要儲存嘅改動（IF 組）
    startPointPending: versionExists && readStartPointBasisForSave_(quarterId, versionNo) !== null,
    reviewerCount: safeCountReviewers_(),
    officialTargetCount: officialCounts.total,
    officialNoEmailCount: officialCounts.noEmail,
    changedPersonCount: changedPersonCount,
    // 第六十三輪批次 R 組：「安排有改動」同「上次正式發出時冇收到」分開數
    arrangementChangedCount: resendBreakdown.arrangementChanged,
    notReceivedCount: resendBreakdown.notReceived,
    hasOfficialRecord: sendLog.hasOfficialRecord,
    lastSentAt: sendLog.lastSentAt,
    lastReviewBatch: sendLog.lastReviewBatch
  };

  let preQuarter = { undoneItemCount: 0, items: [] };
  try {
    const inputs = buildPreQuarterChecklistInputs_(quarterId);
    preQuarter = planPreQuarterChecklist_(inputs);
  } catch (err) {
    // 區二算唔到唔應該令成個 dashboard 冧，但**唔可以靜靜當成 0 項未做**
    // ——噉樣畫面會顯示「全部做好了」，就係把「讀唔到」當成「冇事」。
    log_('WARN', 'apiGetDashboardState：區二開季前準備算不到：' + err.message);
    preQuarter = { undoneItemCount: -1, items: [], error: err.message };
  }

  return {
    quarterId: quarterId,
    quarterLabel: buildQuarterLabel_(quarterId),
    stage: stage,
    // 第七十七輪批次 EE 組：第 3 步〔變動的人〕要正式發出過先可以撳
    officialSentOnce: !!sendLog.officialSentOnce,
    // 第七十七輪批次 EG 組：狀態卡「電郵已由出席系統更新（…）」／「讀不到出席系統…」；N 位收不到電郵
    hwcasSync: describeHwcasSyncForDashboard_(),
    peopleEmailGaps: countPeopleEmailGaps_(),
    // ⚠️ 第四十七輪批次 A1 組：「三粒掣唔著嘅**唯一**原因就係未儲存」。
    // 詳細理由見 `computeSendBlockedByUnsavedOnly_()` 檔內說明。
    blockedByUnsavedOnly: computeSendBlockedByUnsavedOnly_(facts),
    // 第四十八輪批次 A3 組：呢一次可唔可以用〔寄出但不儲存〕。
    // ⚠️ 唔符合條件嗰陣**唔好畫嗰粒掣**——一粒撳咗拋錯嘅掣，
    // 比冇嗰粒掣更差。而且要講得出點解今次唔得。
    canSendUnsaved: canSendWithUnsavedChanges_(unsaved).allowed,
    canSendUnsavedReason: canSendWithUnsavedChanges_(unsaved).reason,
    // 第四十八輪批次 A4 組第 3 點：寄完之後一直顯示，直到佢儲存為止。
    sentWithUnsavedWarning: buildSentWithUnsavedWarning_(
      sendLog.unsavedRelease, unsaved),
    statusText: buildDashboardStatusText_(stage, versionExists, generateOnText,
      readDashboardStatusExtras_(quarterId, versionNo, stage, versionExists)),
    latestVersion: latestVersion,
    versionChoices: versionChoices,
    isDryRun: isDryRun,
    // 第四十一輪批次 H 組：轉寄測試地址有值嗰陣，介面頂部要有一個標籤。
    // **唔可以靜靜生效**——佢最壞嘅失敗方式係「唔記得閂」，
    // 而嗰陣所有畫面同報告都會話一切正常。
    mailRedirectBadge: buildMailRedirectBadgeText_(),
    unsaved: unsaved,
    buttons: computeDashboardButtons_(facts),
    preQuarter: preQuarter,
    publicLink: publicLink,
    // 第六十七輪批次 AG／AH 組：狀態卡常駐——空格同已放行嘅違反
    sendWarnings: versionExists ? summariseVersionSendWarnings_(quarterId, versionNo)
      : { versionNo: -1, blank: { count: 0, items: [], moreCount: 0 }, released: { count: 0, items: [], moreCount: 0 }, error: '' },
    // 第六十七輪批次 AI 組：名單改了之後，這一版有幾多格的人已經唔喺該崗位名單上
    eligibilityImpact: versionExists ? summariseEligibilityImpact_(quarterId)
      : { versionNo: -1, count: 0, items: [], moreCount: 0, error: '' },
    // 第七十五輪批次 CA 組：「常用設定」三粒掣喺新分頁直接開嗰張工作表。
    settingsLinks: buildSettingsSheetLinks_()
  };
}

/**
 * 第七十五輪批次 CA 組：「常用設定」三張工作表嘅網址。
 *
 * Ivan：「人員與電郵、身分（堂委執事）可唔可以直接去試算表嗰張工作表改？」
 * ⚠️ 用 `buildGridSheetUrl_()`（試算表 ID 同 gid 實時問）；搵唔到 ⇒ 空字串，前端畫灰掣。
 * @returns {{people: string, roles: string, recipients: string}}
 */
function buildSettingsSheetLinks_() {
  return {
    people: buildGridSheetUrl_(SHEETS.NAME_MAPPING),
    roles: buildGridSheetUrl_(SHEETS.ROLES),
    recipients: buildGridSheetUrl_(SHEETS.EMAIL_RECIPIENTS)
  };
}

/**
 * 第四十七輪批次 A1 組：**三粒寄出掣不著的唯一原因，是不是就只有「未儲存」？**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 為什麼要重算，不可以只看 `unsaved.hasAny`
 * ═════════════════════════════════════════════════════════════════════
 *
 * 兩種情況在畫面上長得一模一樣（三粒掣全部灰、`kind === NONE`），
 * 而幹事要做的事完全相反：
 *
 *   ・**只有未儲存擋住** ⇒ 儲存完就寄得到 ⇒ 應該給他〔立即儲存並繼續〕
 *   ・未儲存 **加上** Stage 也未到 ⇒ 儲存完一樣寄不到 ⇒ 給那粒掣是騙他
 *
 * 所以判斷方法是：把 `unsaved` 換成一個全 0 的物件，**用同一個
 * `computeDashboardButtons_()` 再算一次**，看有沒有至少一粒會著。
 *
 * ⚠️ **不可以在這裡抄一份 `computeDashboardButtons_()` 的邏輯。**
 * 那三粒掣的條件（Stage 到沒到、有沒有 OFFICIAL 紀錄、有沒有人改動）
 * 隨時會加。抄一份出來就是兩個真相來源，而分岔的後果是
 * 「畫面給了一粒儲存完都寄不到的掣」——比不給更差。
 *
 * @param {Object} facts `buildDashboardState_()` 裡面那一份
 * @returns {boolean} 是不是「只有未儲存擋住」
 */
function computeSendBlockedByUnsavedOnly_(facts) {
  const unsaved = (facts && facts.unsaved) || {};
  if (!unsaved.hasAny) return false;

  // 把 `unsaved` 換成全 0，其餘一個字都不改，再叫同一個函式。
  const asIfSaved = Object.assign({}, facts, {
    unsaved: {
      gridChangeCount: 0,
      unresolvedCount: 0,
      pendingRequestCount: 0,
      hasAny: false
    }
  });
  const buttons = computeDashboardButtons_(asIfSaved);
  return ['review', 'official', 'resend'].some(function (k) {
    return !!(buttons[k] && buttons[k].enabled);
  });
}

/* ═════════════════════════════════════════════════════════════════════
 * 第四十八輪批次 A4 組第 3 點：**寄完之後，主畫面要一直講返呢件事。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 呢一點係整組最重要嗰一句。
 *
 * AuditLog 同 SendLog 係畀**日後查**嘅；呢一句係畀**而家**嘅佢睇。
 * 佢撳完寄出、閂咗個窗，五分鐘之後就會唔記得自己揀咗乜——
 * 而嗰陣佢會以為收信嘅人睇到嘅係佢表上而家嗰個內容。
 *
 * 顯示條件：**上一次寄出用咗缺口**，而且**而家表上仍然有未儲存改動**。
 * 儲存咗之後就自動消失（因為儲存之後兩者已經一致）。
 */

/**
 * 由一行 `SendLog.SendOptions` 讀返「呢一次係咪喺未儲存改動下放行」。
 * **純函式。**
 *
 * 嗰句由 `describeSendDecision_()`（`SendOptions.gs`）寫入，
 * 兩邊講嘅係同一件事。
 *
 * ⚠️ 寫成純函式，係為咗**唔使另開一次 `readSheet(SHEETS.SEND_LOG)`**。
 * 呢一支檔案由第十九輪起就守住「SendLog 只喺一個地方讀」。
 *
 * @param {string} optionsText `SendLog` 的 `SendOptions` 欄
 * @returns {{used: boolean, versionNo: number, gridChangeCount: number}}
 */
function parseUnsavedReleaseNote_(optionsText) {
  const none = { used: false, versionNo: -1, gridChangeCount: 0 };
  const match = String(optionsText || '')
    .match(/未儲存改動下放行：寄出第 (-?\d+) 版，當時表上有 (\d+) 格未儲存/);
  if (!match) return none;
  return { used: true, versionNo: Number(match[1]), gridChangeCount: Number(match[2]) };
}

/**
 * 主畫面第 2 步嗰一句警告——冇嘢要講嗰陣回空字串。
 *
 * @param {Object} release `parseUnsavedReleaseNote_()` 的結果
 * @param {Object} unsaved `readDashboardUnsavedState_()` 的結果
 * @returns {string} 要顯示的句子；不需要顯示時是空字串
 */
function buildSentWithUnsavedWarning_(release, unsaved) {
  if (!release || !release.used) return '';
  const grid = (unsaved || {}).gridChangeCount;
  // ⚠️ 儲存咗（而家冇未儲存改動）⇒ 唔再講。
  // 兩者已經一致，繼續講就變成一句永遠關唔甩嘅警告，
  // 而永遠關唔甩嘅警告好快就會冇人再讀。
  if (!(grid > 0)) return '';
  return '⚠️ 上一次寄出的是第 ' + release.versionNo + ' 版，'
    + '而你表上有 ' + grid + ' 格改動還未儲存。\n'
    + '收到信的人看到的不是你現在表上的內容。';
}

/**
 * 算「有沒有未儲存的改動」（規格 2.2 三者任一）。
 *
 * ⚠️ 規則狀態一律用 `STATE_SOURCE.GRID_OVERLAY` 明確指定，唔可以省略 mode
 * ——第十九輪就係因為靜靜讀長表而令幹事改幾多次 grid 都冇分別。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 最新版本號（<0 代表冇版本）
 * @returns {{gridChangeCount: number, unresolvedCount: number,
 *   pendingRequestCount: number, hasAny: boolean}}
 */
function readDashboardUnsavedState_(quarterId, versionNo) {
  // 第六十三輪批次 S 組：診斷用（見 `logDashboardUnsavedDiag_()`）
  const diagStartedAtMs = Date.now();
  let gridChangeCount = 0;
  let unresolvedCount = 0;

  if (versionNo >= 0) {
    try {
      const context = buildFineTuneContext_(quarterId, versionNo);
      const resolved = resolveAuthoritativeState_(
        context, STATE_SOURCE.GRID_OVERLAY, 'readDashboardUnsavedState_');
      // 第七十五輪批次 CC 組：改咗每週標題（「類型」欄）都係一項未儲存改動
      gridChangeCount = resolved.changes.length + (resolved.titleChanges || []).length;
      // 第七十五輪批次 CE 組：已勾「這一季臨時幫手」嘅名唔再算「未處理」
      const dIndex = readCellDecisionIndex_(quarterId, context.timezone);
      unresolvedCount = resolved.unresolved.filter(function (u) {
        return !dIndex.isTempHelper(u.serviceDate + '|' + u.postId + '|' + u.slotIndex, u.text);
      }).length;
    } catch (err) {
      // grid 工作表被刪／改名嗰類。**唔可以當成「零改動」**——
      // 零改動會令掣 2／3／4 全部亮起，等於話「冇嘢未處理」，
      // 但實情係我哋根本睇唔到有冇嘢未處理。
      log_('WARN', 'readDashboardUnsavedState_ 讀不到 grid 狀態：' + err.message);
      const gridFailed = {
        gridChangeCount: -1, unresolvedCount: -1, pendingRequestCount: -1,
        hasAny: true, error: err.message
      };
      logDashboardUnsavedDiag_(quarterId, versionNo, gridFailed, diagStartedAtMs, null);
      return gridFailed;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // ⚠️ 第三十四輪批次甲3：**「未處理」同「系統睇唔明、等人手處理」要分開。**
  // ─────────────────────────────────────────────────────────────────────
  //
  // 修正之前呢度係 `readPendingRequests_(quarterId).length`——即係數晒
  // 全部 `RequestID` 空白嘅行。但 `NEEDS_INPUT` 類申報**刻意永遠唔會攞到
  // RequestID**（`RequestsApply.gs` 嘅 `writeRequestOutcomes_()`，
  // 咁樣先可以喺底層資料修正之後重新驗證一次）。
  //
  // 兩件事夾埋嘅後果（2026-08-20 實測）：掣 3「正式發出」永遠灰，
  // 訊息叫幹事「先撳儲存並確認」，但撳幾多次都處理唔完——
  // 現場係靠人手去 `Requests` 刪走嗰兩行先行得返。
  //
  // 判斷：**閘門只應該擋「會改動職事表但仲未套用」嘅嘢。**
  // 一筆 `NEEDS_INPUT` 申報系統根本睇唔明，佢**永遠唔會**自動改動職事表，
  // 所以佢唔構成「正式發出之後職事表會唔啱」嘅風險——擋住佢冇保護到任何嘢，
  // 只係令幹事無路可走。而一筆 `APPLY`／`CONFIRM` 未套用就係真風險，繼續擋。
  //
  // ⚠️ 但 `NEEDS_INPUT` **一定要繼續顯示出嚟**（獨立一個數），
  // 唔可以變成靜靜消失——嗰個就會變成另一個「缺失被當成正常值」。
  let pendingRequestCount = 0;
  let needsInputCount = 0;
  let skippedIncompleteCount = null;
  try {
    if (versionNo >= 0) {
      const requestPlan = planApplyRequests_(quarterId);
      skippedIncompleteCount = requestPlan.skippedIncompleteCount;
      requestPlan.results.forEach(function (r) {
        if (r.category === 'NEEDS_INPUT') needsInputCount++;
        else pendingRequestCount++;
      });
    } else {
      // 未有版本 ⇒ 分唔到類（驗證要對住一個版本嘅派工狀態）。
      // 一律當成「未處理」——呢個方向嘅錯比較安全。
      pendingRequestCount = readPendingRequests_(quarterId).length;
    }
  } catch (err) {
    log_('WARN', 'readDashboardUnsavedState_ 讀不到待處理申報：' + err.message);
    const requestsFailed = {
      gridChangeCount: gridChangeCount, unresolvedCount: unresolvedCount,
      pendingRequestCount: -1, needsInputCount: -1, hasAny: true, error: err.message
    };
    logDashboardUnsavedDiag_(quarterId, versionNo, requestsFailed, diagStartedAtMs, null);
    return requestsFailed;
  }

  const state = {
    gridChangeCount: gridChangeCount,
    unresolvedCount: unresolvedCount,
    pendingRequestCount: pendingRequestCount,
    needsInputCount: needsInputCount,
    // ⚠️ `needsInputCount` **刻意唔計入 `hasAny`**——見上面嘅判斷。
    hasAny: gridChangeCount > 0 || unresolvedCount > 0 || pendingRequestCount > 0
  };
  logDashboardUnsavedDiag_(quarterId, versionNo, state, diagStartedAtMs, skippedIncompleteCount);
  return state;
}

/**
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ 第六十三輪批次 S 組：**診斷 log——原因未查明，所以只記錄，唔改邏輯。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 現場（2026-10-20 瀏覽器實測，兩次）：
 *   ・`Requests` 加咗 3 行申報，撳「重新整理」，第 2 步寫「堂委沒有提出改動」
 *     （即係讀到 0 筆）；30 秒後撳「儲存及寄出」，確認畫面正確列出 2＋1 筆
 *   ・grid 用下拉改咗 1 格，撳「重新整理」，第 2 步寫「未偵測到你在表上改過
 *     任何格」；隨即撳「寄出」，卻正確攔住「你有 1 格改動還未儲存」
 * 同一次測試另外兩次就顯示正確。
 *
 * 已經查過（詳見 docs 第六十三輪 S 組）：
 *   ・前端冇快取：「重新整理」每次都叫 `apiGetDashboardState()`
 *   ・伺服器冇快取：`readSheet()` 嘅記憶只喺同一次呼叫入面生效
 *   ・用真程式＋擬真試算表重現（`tests/dashboard_unsaved_consistency.test.js`）：
 *     狀態卡（開記憶）同寄出閘（冇記憶）三個情境都讀到一樣嘅數字
 * 所以未搵到程式上嘅原因。最可能係試算表改動未寫到伺服器就被讀——但未證實。
 *
 * 呢一行寫入 Apps Script「執行項目」嘅 log（`Logger`），**唔寫任何工作表**
 * （呢條路喺 `apiGetDashboardState()` 嘅唯讀記憶入面行，唔可以寫入）。
 * 下次再撞到：喺 Apps Script 編輯器 ▸ 執行項目，搵嗰次 `apiGetDashboardState`
 * 同之後嗰次寄出，對照兩行 `[DIAG] 未儲存狀態` 嘅讀取時間同數字。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} state `readDashboardUnsavedState_()` 準備回傳嘅結果
 * @param {number} startedAtMs 開始讀取嘅時間（`Date.now()`）
 * @param {?number} skippedIncompleteCount 申報表入面唔完整（略過）嘅行數；查唔到就 null
 * @returns {string} 寫咗出去嗰一行（測試用）
 */
function logDashboardUnsavedDiag_(quarterId, versionNo, state, startedAtMs, skippedIncompleteCount) {
  const line = '[DIAG] 未儲存狀態 ' + quarterId + ' v' + versionNo
    + ' grid=' + (versionNo >= 0 ? buildRosterSheetName_(quarterId, versionNo) : '（未有版本）')
    + ' 改動格=' + state.gridChangeCount
    + ' 認不出=' + state.unresolvedCount
    + ' 待處理申報=' + state.pendingRequestCount
    + ' 看不懂申報=' + (state.needsInputCount === undefined ? '?' : state.needsInputCount)
    + ' 不完整申報=' + (skippedIncompleteCount === null || skippedIncompleteCount === undefined
      ? '?' : skippedIncompleteCount)
    + ' 讀取開始=' + new Date(startedAtMs).toISOString()
    + ' 用時=' + (Date.now() - startedAtMs) + 'ms'
    + (state.error ? ' 錯誤=' + state.error : '');
  try {
    Logger.log(line);
  } catch (err) {
    // 診斷本身唔可以令狀態卡失敗
  }
  return line;
}

/**
 * 掣 3 要顯示嘅「表上幾多人／幾多人冇電郵」。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {boolean} versionExists 有冇版本
 * @returns {{total: number, noEmail: number}}
 */
function countDashboardOfficialTargets_(quarterId, versionNo, versionExists) {
  if (!versionExists) return { total: 0, noEmail: 0 };
  try {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    const peopleById = indexPeopleById_();
    const seen = {};
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      const personId = String(row[A.PERSON_ID] || '').trim();
      if (personId) seen[personId] = true;
    });
    const ids = Object.keys(seen);
    const noEmail = ids.filter(function (id) {
      const p = peopleById[id];
      return !p || !String(p.email || '').trim();
    }).length;
    return { total: ids.length, noEmail: noEmail };
  } catch (err) {
    log_('WARN', 'countDashboardOfficialTargets_ 失敗：' + err.message);
    return { total: 0, noEmail: 0 };
  }
}

/**
 * 第六十三輪批次 F 組：狀態卡嗰兩句額外嘅真話。
 *
 * ⚠️ 數唔到唔可以令成個 dashboard 冧，亦唔可以扮成「冇問題」——
 * 數唔到就淨係顯示原本嗰句（同改之前一樣），並且寫 log。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 最新版本號
 * @param {string} stage Stage
 * @param {boolean} versionExists 有冇版本
 * @returns {{officialReach: ?Object, unsentWarn: string}}
 */
function readDashboardStatusExtras_(quarterId, versionNo, stage, versionExists) {
  const out = { officialReach: null, unsentWarn: '' };
  if (!versionExists) return out;
  if (stage === QUARTER_STAGE.OFFICIAL_SENT) {
    try {
      out.officialReach = countOfficialReach_(quarterId, versionNo);
    } catch (err) {
      log_('WARN', 'readDashboardStatusExtras_：數不到正式發出人數：' + err.message);
    }
  }
  try {
    const history = buildSendHistoryView_(quarterId);
    const anySent = history.batches.some(function (b) { return b.sent > 0; });
    // 「最新版本號 ＞ 最後一次寄出嘅版本號」先講——從來未寄過唔關事
    if (anySent) out.unsentWarn = history.warnSentence || '';
  } catch (err) {
    log_('WARN', 'readDashboardStatusExtras_：讀不到寄出紀錄：' + err.message);
  }
  return out;
}

/** 掣 4 要顯示嘅「有幾多人嘅安排改咗」。只喺 OFFICIAL_SENT 先會呼叫。 */
function countDashboardResendBreakdown_(quarterId) {
  // 第六十三輪批次 R 組：除咗總數，仲要分「安排有改動」同「上次冇收到」。
  // 掣亮唔亮仍然睇總數（上次冇收到嘅人一樣可以喺重發揀）；文字只講前者。
  try {
    const plan = planResendChangedPersons_(quarterId);
    return {
      total: plan.changed.length,
      arrangementChanged: plan.arrangementChangedCount,
      notReceived: plan.notReceivedCount
    };
  } catch (err) {
    log_('WARN', 'countDashboardResendBreakdown_ 失敗：' + err.message);
    return { total: 0, arrangementChanged: 0, notReceived: 0 };
  }
}

/**
 * A6：砌一條直接跳到某張 grid 工作表嘅網址。
 *
 * 試算表 ID 同工作表 gid **兩樣都係實時問返嚟嘅**，一個都冇寫死——
 * 寫死試算表 ID 會令呢個 repo 洩漏一個真實 ID（本專案硬規則），
 * 而且日後換試算表就會靜靜咁指去舊嗰個。
 *
 * 搵唔到嗰張工作表就回空字串。**唔會回一條「大概啱」嘅連結**——
 * 一條打開之後去錯地方（或者開唔到）嘅連結，對一個唔識電腦嘅人嚟講
 * 比冇連結更差：佢會以為自己撳錯咗，而唔會諗到係連結本身有問題。
 * @param {*} sheetName grid 工作表名
 * @returns {string} 網址；攞唔到時回空字串
 */
function buildGridSheetUrl_(sheetName) {
  const name = String(sheetName || '').trim();
  if (name === '') return '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(name);
    if (!sheet) return '';
    return 'https://docs.google.com/spreadsheets/d/' + ss.getId()
      + '/edit#gid=' + sheet.getSheetId();
  } catch (err) {
    log_('WARN', 'buildGridSheetUrl_ 取不到工作表網址：' + err.message);
    return '';
  }
}

/**
 * 第七十七輪批次 EB 組：某張 grid 工作表嘅**唯讀顯示網址**（〔查看這一版〕用）。
 *
 * Ivan 手動測試 B：「查看這一版，應該是 read only（現在使用者可以改）。」
 * 沿用第七十五輪 CL 組公開職事表嘅做法（`/preview`），加 `#gid=` 直接顯示嗰一張工作表。
 * 第七十七輪回歸時喺瀏覽器核對過：`/preview#gid=<gid>` 同 `/htmlview?gid=<gid>#gid=<gid>`
 * 都顯示正確工作表、都冇編輯工具列；揀 `/preview`——同公開職事表同一個形式。
 * 保護（`setWarningOnly`）照舊加，作為第二道防線。
 * 搵唔到嗰張工作表就回空字串（同 `buildGridSheetUrl_()` 一樣，唔砌一條去錯地方嘅連結）。
 * @param {*} sheetName grid 工作表名
 * @returns {string}
 */
function buildGridSheetViewUrl_(sheetName) {
  const name = String(sheetName || '').trim();
  if (name === '') return '';
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(name);
    if (!sheet) return '';
    return 'https://docs.google.com/spreadsheets/d/' + ss.getId()
      + GRID_SHEET_VIEW_SUFFIX + '#gid=' + sheet.getSheetId();
  } catch (err) {
    log_('WARN', 'buildGridSheetViewUrl_ 取不到工作表網址：' + err.message);
    return '';
  }
}

/** 第七十七輪批次 EB 組：唯讀顯示網址嘅路徑（同公開職事表 `PUBLIC_LINK_VIEW_SUFFIX` 同一個形式）。 */
const GRID_SHEET_VIEW_SUFFIX = '/preview';

/** 堂委收件人數；讀唔到時回 0（掣 2 會因此顯示「沒有登記任何堂委電郵」）。 */
function safeCountReviewers_() {
  try {
    return countReviewerRecipients_();
  } catch (err) {
    log_('WARN', 'safeCountReviewers_ 失敗：' + err.message);
    return 0;
  }
}
