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
 * @param {string} stage 內部 Stage
 * @param {boolean} versionExists 有冇版本
 * @param {string} generateOnText 自動生成日期（人話），冇就傳空字串
 * @returns {string}
 */
function buildDashboardStatusText_(stage, versionExists, generateOnText) {
  if (stage === QUARTER_STAGE.DRAFT && !versionExists) {
    return generateOnText
      ? '還未生成初稿。系統會在 ' + generateOnText + ' 自動生成。'
      : '還未生成初稿。';
  }
  if (stage === QUARTER_STAGE.DRAFT) return '初稿已生成，未寄給堂委。';
  if (stage === QUARTER_STAGE.REVIEW_SENT) return '已寄給堂委，等他們的意見。';
  if (stage === QUARTER_STAGE.REQUESTS_APPLIED) return '堂委意見已處理，未正式發出給全體。';
  if (stage === QUARTER_STAGE.OFFICIAL_SENT) return '已正式發出給全體。';
  return '這一季的情況：' + stage;
}

/**
 * 規格 5.1：版本描述一律寫人話，永不淨寫 `v2`。
 * @param {string} basis `RosterVersions.Basis`
 * @param {string} notes `RosterVersions.Notes`
 * @returns {string} 兩者都空白時回傳「（沒有說明）」
 */
function buildVersionBasisText_(basis, notes) {
  const parts = [String(basis || '').trim(), String(notes || '').trim()]
    .filter(function (s) { return s !== ''; });
  return parts.length > 0 ? parts.join('　') : '（沒有說明）';
}

/**
 * 一次讀完 `SendLog`，同時算齊「各階段最後寄出時間」同「有冇任何 OFFICIAL 紀錄」。
 *
 * 規格 2.6 第 2 層防重複要求：`SendLog` 內呢個季度**不論版本、不論 DRY_RUN**
 * 只要有任何 `OFFICIAL` 紀錄就當已經正式發出過。所以唔可以只睇最新版本。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{lastSentAt: Object.<string, ?string>, hasOfficialRecord: boolean}}
 */
function readSendLogSummaryForDashboard_(quarterId) {
  const C = COLUMNS.SEND_LOG;
  const stages = [MAIL_STAGES.REVIEW, MAIL_STAGES.OFFICIAL, MAIL_STAGES.RESEND];
  const lastSentAt = {};
  stages.forEach(function (s) { lastSentAt[s] = null; });
  let hasOfficialRecord = false;

  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[C.QUARTER_ID] || '').trim() !== quarterId) return;
    const stage = String(row[C.STAGE] || '').trim();
    if (stage === MAIL_STAGES.OFFICIAL) hasOfficialRecord = true;
    if (stages.indexOf(stage) === -1) return;
    const sentAt = String(row[C.SENT_AT] || '');
    if (sentAt && (!lastSentAt[stage] || sentAt > lastSentAt[stage])) lastSentAt[stage] = sentAt;
  });

  return { lastSentAt: lastSentAt, hasOfficialRecord: hasOfficialRecord };
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

  // ── 掣 1：儲存並確認 ──────────────────────────────────────────
  // 規格 2.2：有版本就任何 Stage 都撳得到（佢係唯一會改內容嘅掣）。
  buttons.save = {
    enabled: s.versionExists,
    disabledReason: s.versionExists ? '' : '要等系統生成咗初稿，這一粒才會著。',
    dynamicText: buildSaveButtonText_(s)
  };

  // ── 掣 2：寄給堂委審閱 ────────────────────────────────────────
  // D2：開放於 DRAFT／REVIEW_SENT／REQUESTS_APPLIED（＝未正式發出之前）。
  const reviewStageOk = s.versionExists && s.stage !== QUARTER_STAGE.OFFICIAL_SENT;
  buttons.review = {
    enabled: reviewStageOk && !unsaved.hasAny,
    disabledReason: !s.versionExists
      ? '要等系統生成咗初稿，這一粒才會著。'
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
        ? '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存並確認」，這一粒才會著。'
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
    lastSentAt: s.lastSentAt[MAIL_STAGES.RESEND]
  };

  return buttons;
}

/** 規格 2.3 掣 1 嘅動態文字。 */
function buildSaveButtonText_(s) {
  const u = s.unsaved;
  if (u.unresolvedCount > 0) {
    return '有 ' + u.unresolvedCount + ' 格的文字系統認不出，撳下去會告訴你是哪幾格。';
  }
  const noChange = u.gridChangeCount === 0 && u.pendingRequestCount === 0;
  if (noChange && s.stage === QUARTER_STAGE.REVIEW_SENT) {
    return '堂委沒有提出改動。撳下去就當作意見已收齊，可以進入正式發出。';
  }
  if (noChange) return '未偵測到你在表上改過任何格。';
  if (u.gridChangeCount > 0 && u.pendingRequestCount > 0) {
    return '偵測到你在表上改了 ' + u.gridChangeCount + ' 格，另有 '
      + u.pendingRequestCount + ' 筆修改申報未處理。';
  }
  if (u.gridChangeCount > 0) return '偵測到你在表上改了 ' + u.gridChangeCount + ' 格。';
  return '有 ' + u.pendingRequestCount + ' 筆修改申報未處理。';
}

/** 規格 2.3 掣 2 嘅動態文字。 */
function buildReviewButtonText_(s) {
  if (s.reviewerCount === 0) {
    return '現時沒有登記任何堂委電郵，寄出去不會有人收到。先去「名單維護」補。';
  }
  const last = s.lastSentAt[MAIL_STAGES.REVIEW];
  if (last) return '上次在 ' + last + ' 寄過。再撳一次會重新寄給同一批人。';
  return '把唯讀連結寄給 ' + s.reviewerCount + ' 位收件人。';
}

/** 規格 2.3 掣 3 嘅動態文字。 */
function buildOfficialButtonText_(s) {
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
  return '自上次發出之後，有 ' + s.changedPersonCount + ' 個人的安排改了。只會寄給這 '
    + s.changedPersonCount + ' 人和堂委。';
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
  return bits.join('、') + '。先撳「儲存並確認」，這一粒才會著。';
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
      basisText: row ? buildVersionBasisText_(row[V.BASIS], row[V.NOTES]) : '（沒有說明）'
    };
  }

  // ── 未儲存改動（三者任一，規格 2.2）─────────────────────────
  const unsaved = readDashboardUnsavedState_(quarterId, versionNo);

  // ── SendLog（整張表只讀一次，同時算齊三個階段 + 有冇 OFFICIAL 紀錄）──
  const sendLog = readSendLogSummaryForDashboard_(quarterId);

  // ── 掣 3／掣 4 要嘅人數 ──────────────────────────────────────
  const officialCounts = countDashboardOfficialTargets_(quarterId, versionNo, versionExists);
  const changedPersonCount = stage === QUARTER_STAGE.OFFICIAL_SENT
    ? countDashboardChangedPersons_(quarterId, versionNo)
    : 0;

  const facts = {
    stage: stage,
    versionExists: versionExists,
    unsaved: unsaved,
    reviewerCount: safeCountReviewers_(),
    officialTargetCount: officialCounts.total,
    officialNoEmailCount: officialCounts.noEmail,
    changedPersonCount: changedPersonCount,
    hasOfficialRecord: sendLog.hasOfficialRecord,
    lastSentAt: sendLog.lastSentAt
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
    statusText: buildDashboardStatusText_(stage, versionExists, generateOnText),
    latestVersion: latestVersion,
    isDryRun: isDryRun,
    unsaved: unsaved,
    buttons: computeDashboardButtons_(facts),
    preQuarter: preQuarter
  };
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
  let gridChangeCount = 0;
  let unresolvedCount = 0;

  if (versionNo >= 0) {
    try {
      const context = buildFineTuneContext_(quarterId, versionNo);
      const resolved = resolveAuthoritativeState_(
        context, STATE_SOURCE.GRID_OVERLAY, 'readDashboardUnsavedState_');
      gridChangeCount = resolved.changes.length;
      unresolvedCount = resolved.unresolved.length;
    } catch (err) {
      // grid 工作表被刪／改名嗰類。**唔可以當成「零改動」**——
      // 零改動會令掣 2／3／4 全部亮起，等於話「冇嘢未處理」，
      // 但實情係我哋根本睇唔到有冇嘢未處理。
      log_('WARN', 'readDashboardUnsavedState_ 讀不到 grid 狀態：' + err.message);
      return {
        gridChangeCount: -1, unresolvedCount: -1, pendingRequestCount: -1,
        hasAny: true, error: err.message
      };
    }
  }

  let pendingRequestCount = 0;
  try {
    pendingRequestCount = readPendingRequests_(quarterId).length;
  } catch (err) {
    log_('WARN', 'readDashboardUnsavedState_ 讀不到待處理申報：' + err.message);
    return {
      gridChangeCount: gridChangeCount, unresolvedCount: unresolvedCount,
      pendingRequestCount: -1, hasAny: true, error: err.message
    };
  }

  return {
    gridChangeCount: gridChangeCount,
    unresolvedCount: unresolvedCount,
    pendingRequestCount: pendingRequestCount,
    hasAny: gridChangeCount > 0 || unresolvedCount > 0 || pendingRequestCount > 0
  };
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

/** 掣 4 要顯示嘅「有幾多人嘅安排改咗」。只喺 OFFICIAL_SENT 先會呼叫。 */
function countDashboardChangedPersons_(quarterId, versionNo) {
  try {
    return planResendChangedPersons_(quarterId).changed.length;
  } catch (err) {
    log_('WARN', 'countDashboardChangedPersons_ 失敗：' + err.message);
    return 0;
  }
}

/** 堂委收件人數；讀唔到時回 0（掣 2 會因此顯示「沒有登記任何堂委電郵」）。 */
function safeCountReviewers_() {
  try {
    return countReviewerRecipients_();
  } catch (err) {
    log_('WARN', 'safeCountReviewers_ 失敗：' + err.message);
    return 0;
  }
}
