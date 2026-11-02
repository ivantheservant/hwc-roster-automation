/**
 * 第九十輪批次 QC 組：義工在個人專屬連結申報不能服侍（取代共用試算表）。
 *
 * Ivan 2026-10-30 決定：義工在自己的個人專屬連結（`?p=<token>&q=<季度>`）勾選不能服侍的主日，
 * 幹事在〔不能服侍的日期〕確認之後才生效。
 *
 * ── 資料 ─────────────────────────────────────────────────────────
 *   新工作表 `UnavailableSubmissions`（第 1 行中文標題、第 2 行機器鍵；第一次提交時自動建立）：
 *   SubmissionID、PersonID、ServiceDate、Reason、SubmittedAt、Status（PENDING／ACCEPTED／REJECTED／WITHDRAWN）、
 *   DecidedBy、DecidedAt、UnavailableID、Late。
 *   **義工提交不會直接寫 `Unavailable`**——幹事〔接受〕之後才建立 `Unavailable` 行（Source=PERSONAL_LINK）。
 *   已生成的季度，之後就走現有「之後才申報不能服侍」那一套提醒（按 Unavailable.CreatedAt 判斷）。
 *
 * ── 安全（個人連結部署是 access=ANYONE）────────────────────────────
 *   - 可以申報的主日：由連結的季度（`q`）開始、未完結的 N 季（Config PERSONAL_UNAVAILABLE_QUARTERS_AHEAD，預設 2）；
 *     `q` 已完結或不存在 ⇒ 由今日最近的未完結季度開始。過去的日子一律不可以選。
 *   - 公開函式只有 `PERSONAL_LINK_PUBLIC_APIS` 列的兩個（提交、撤回）。每個第一句一定是
 *     `const person = assertPersonalLinkCaller_(token);`——用 token 認人（NameMapping.PersonalLinkToken、Active），
 *     認不到 ⇒ 中性錯誤（PERSONAL_LINK_INVALID_MESSAGE），不透露原因。測試 round88_pd_public_globals 逐個核對。
 *   - 只可以寫入**自己**的申報；日期一定要是允許範圍內的主日、不是過去的日子；每次最多 20 個日期；
 *     每人每日最多 10 次提交（按工作表上這個人今日的提交數，不靠快取）；原因去掉 HTML、最多 100 字。
 *   - AuditLog 只寫 PersonID，**不寫 token**。
 *
 * ── 第九十四輪批次 ───────────────────────────────────────────────
 *   UA：申報可以選「只限以下崗位」（`UnavailableSubmissions.PostIDs`，空白＝全部崗位）。崗位清單由伺服器按這個人
 *       這一季可以服侍的崗位計算（`listPersonQuarterPosts_()`），提交時重新計算並核對是子集。確認後建立的
 *       `Unavailable`：有 PostIDs ⇒ AppliesTo＝POSTS＋PostIDs；空白 ⇒ 照舊 ALL。
 *   UB：確認者（`UNAVAILABLE_CONFIRMER_EMAILS`＋可以修改的人）用「義工申報，確認」畫面（`apiGetUnavailableConfirmView`）。
 *   UC：每次決定之後按人合併通知申請人（範本 TPL_UNAVAILABLE_DECIDED_TC；經 sendRealEmail_，DRY_RUN、轉寄照舊）。
 *   UD：〔生成初稿〕〔請系統幫我調整〕執行前把該季等候確認的申報自動確認（`autoConfirmPendingSubmissionsForQuarter_()`）。
 *   用字：對申請人一律「確認了你的申請」「未能確認你的申請」；按鈕〔確認申請〕〔不確認〕〔全部確認〕。
 */

/** 個人連結頁可以呼叫的公開函式（不以 _ 結尾）。加名之前要寫明理由，並更新 round88_pd_public_globals。 */
// 第九十四輪批次 UA 組：崗位清單隨頁面資料一併送出（伺服器端計算），不另加公開函式。
const PERSONAL_LINK_PUBLIC_APIS = ['personalSubmitUnavailable', 'personalWithdrawUnavailable'];

const UNAVAILABLE_SUBMISSION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN'
};

/** 個人頁上的狀態字眼（第九十四輪：不用「接受」「拒絕」「批准」）。 */
const UNAVAILABLE_SUBMISSION_STATUS_TC = {
  PENDING: '等候確認',
  ACCEPTED: '已確認了你的申請',
  REJECTED: '未能確認',
  WITHDRAWN: '已撤回'
};

/**
 * 第九十五輪批次 VE 組：已確認、但由這一項建立的 `Unavailable` 已被幹事取消（Status 不是 ACTIVE，或者那一行已經不在）。
 * 只是個人頁顯示用的狀態（工作表的 Status 仍然是 ACCEPTED）；那一日可以再申報。不寄信。
 */
const UNAVAILABLE_SUBMISSION_VIEW_CANCELLED = 'CANCELLED';
const UNAVAILABLE_SUBMISSION_VIEW_CANCELLED_TC = '幹事已取消';

/** 第九十四輪批次 UD 組：自動確認時寫入 DecidedBy 的字眼。 */
const UNAVAILABLE_AUTO_CONFIRM_BY = {
  GENERATE: '系統自動（生成初稿）',
  SUGGEST: '系統自動（請系統幫我調整）'
};

/** 第九十四輪批次 UC 組：通知申請人的範本。 */
const UNAVAILABLE_DECIDED_TEMPLATE_ID = 'TPL_UNAVAILABLE_DECIDED_TC';

/** 「全部崗位」的字眼。 */
const UNAVAILABLE_ALL_POSTS_TC = '全部崗位';

/** 接受之後建立的 `Unavailable` 行的 Source。 */
const UNAVAILABLE_SOURCE_PERSONAL_LINK = 'PERSONAL_LINK';

const PERSONAL_UNAVAILABLE_MAX_DATES = 20;
const PERSONAL_UNAVAILABLE_MAX_PER_DAY = 10;
const PERSONAL_UNAVAILABLE_REASON_MAX = 100;

/** `UnavailableSubmissions` 第 1 行中文標題（對應 `unavailableSubmissionKeys_()` 次序）。 */
const UNAVAILABLE_SUBMISSIONS_TITLES_TC = [
  '申報編號', '人', '主日', '原因', '提交時間', '狀態（PENDING／ACCEPTED／REJECTED／WITHDRAWN）',
  '決定者', '決定時間', '建立的不能服侍編號', '截止日之後', '只限崗位（空白＝全部崗位）'
];

/** @returns {string[]} 機器鍵（次序同中文標題一致） */
function unavailableSubmissionKeys_() {
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  return [S.SUBMISSION_ID, S.PERSON_ID, S.SERVICE_DATE, S.REASON, S.SUBMITTED_AT, S.STATUS,
    S.DECIDED_BY, S.DECIDED_AT, S.UNAVAILABLE_ID, S.LATE, S.POST_IDS];
}

/**
 * 取得（必要時建立）`UnavailableSubmissions` 工作表。
 * @returns {Sheet}
 */
function ensureUnavailableSubmissionsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.UNAVAILABLE_SUBMISSIONS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.UNAVAILABLE_SUBMISSIONS);
  const keys = unavailableSubmissionKeys_();
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  const ok = keys.every(function (k, i) { return existing[i] === k; });
  if (!ok) {
    sheet.getRange(1, 1, 1, UNAVAILABLE_SUBMISSIONS_TITLES_TC.length).setValues([UNAVAILABLE_SUBMISSIONS_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/**
 * 全部申報（工作表還沒有建立 ⇒ 空陣列）。日期、時間一律轉成字串。
 * @param {string} timezone 時區
 * @returns {Object[]} {sheetRow, submissionId, personId, serviceDate, reason, submittedAt, submittedDay, status, late, unavailableId}
 */
function readUnavailableSubmissions_(timezone) {
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.UNAVAILABLE_SUBMISSIONS)) return [];
  return readSheet_(SHEETS.UNAVAILABLE_SUBMISSIONS).map(function (r, i) {
    const at = r[S.SUBMITTED_AT];
    const atText = Object.prototype.toString.call(at) === '[object Date]'
      ? Utilities.formatDate(at, timezone, 'yyyy-MM-dd HH:mm:ss') : String(at || '').trim();
    return {
      sheetRow: i + 3,
      submissionId: String(r[S.SUBMISSION_ID] || '').trim(),
      personId: String(r[S.PERSON_ID] || '').trim(),
      serviceDate: toDateString_(r[S.SERVICE_DATE], timezone),
      reason: String(r[S.REASON] || '').trim(),
      submittedAt: atText,
      submittedDay: atText.slice(0, 10),
      status: String(r[S.STATUS] || '').trim().toUpperCase(),
      late: isTrueValue_(r[S.LATE]),
      unavailableId: String(r[S.UNAVAILABLE_ID] || '').trim(),
      // 第九十四輪批次 UA 組：空陣列＝全部崗位（舊行沒有這一欄 ⇒ 全部崗位）
      postIds: splitList_(r[S.POST_IDS]),
      decidedBy: String(r[S.DECIDED_BY] || '').trim(),
      decidedAt: (function (v) {
        return Object.prototype.toString.call(v) === '[object Date]'
          ? Utilities.formatDate(v, timezone, 'yyyy-MM-dd HH:mm:ss') : String(v || '').trim();
      })(r[S.DECIDED_AT])
    };
  }).filter(function (s) { return !!s.submissionId; });
}

/**
 * 原因：去掉 HTML、合併空白、最多 100 字。**純函式。**
 * @param {*} raw 義工輸入
 * @returns {string}
 */
function sanitizePersonalUnavailableReason_(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PERSONAL_UNAVAILABLE_REASON_MAX);
}

/**
 * 個人連結公開函式的第一句：用 token 認人。認不到（或 Web UI 停用）⇒ 中性錯誤，不透露原因。
 * @param {*} token 頁面送來的 token
 * @returns {{personId: string, nameTC: string}}
 */
function assertPersonalLinkCaller_(token) {
  try {
    assertWebAppEnabled_();
  } catch (err) {
    throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  }
  const t = typeof token === 'string' ? token.trim() : '';
  // 格式不對就不用讀表（32 個十六進位字元，見 generatePersonalLinkToken_()）
  if (!/^[0-9a-fA-F]{32}$/.test(t)) throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  const person = findPersonByToken_(t);
  if (!person) throw new Error(PERSONAL_LINK_INVALID_MESSAGE);
  return { personId: String(person.personId || '').trim(), nameTC: String(person.nameTC || '').trim() };
}

/**
 * 可以申報的季度：未完結（EndDate ≥ 今日）的季度之中，按開始日排，取 N 季（Config，預設 2）。
 * 第九十輪回歸 V3 修正：由連結的季度（`q`，例如邀請信的那一季）開始——否則邀請義工申報較後的季度時，
 * 頁面只列出今日最近的兩季，義工找不到要申報的那一季。`q` 已完結或不存在 ⇒ 由最近的未完結季度開始。
 * @param {string} todayStr 今日
 * @param {string} timezone 時區
 * @param {string=} anchorQuarterId 連結的季度（`q`）
 * @returns {Object[]} {quarterId, label, startDate, endDate, generateDate, deadline}
 */
function listPersonalUnavailableQuarters_(todayStr, timezone, anchorQuarterId) {
  const Q = COLUMNS.QUARTERS;
  const ahead = Math.max(1, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_QUARTERS_AHEAD, 2)) || 2);
  const deadlineDays = Math.max(0, Number(getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_DEADLINE_DAYS, 7)) || 0);
  const config = readConfig_();
  const open = readSheet_(SHEETS.QUARTERS)
    .map(function (r) {
      const generateDate = readPreseasonGenerateDate_(r, config);
      return {
        quarterId: String(r[Q.QUARTER_ID] || '').trim(),
        startDate: toDateString_(r[Q.START_DATE], timezone),
        endDate: toDateString_(r[Q.END_DATE], timezone),
        generateDate: generateDate,
        deadline: generateDate ? shiftDateString_(generateDate, -deadlineDays) : ''
      };
    })
    .filter(function (q) { return q.quarterId && q.endDate && q.endDate >= todayStr; })
    .sort(function (a, b) { return a.startDate < b.startDate ? -1 : (a.startDate > b.startDate ? 1 : 0); });
  const anchor = String(anchorQuarterId || '').trim();
  const from = Math.max(0, open.map(function (q) { return q.quarterId; }).indexOf(anchor));
  return open.slice(from)
    .slice(0, ahead)
    .map(function (q) { q.label = buildQuarterLabel_(q.quarterId); return q; });
}

/**
 * 「M 月 D 日」。
 * @param {string} dateStr yyyy-MM-dd
 * @returns {string}
 */
function personalUnavailableDayLabel_(dateStr) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  return m ? Number(m[1]) + ' 月 ' + Number(m[2]) + ' 日' : String(dateStr || '');
}

/**
 * 第九十四輪批次 UA 組：計算「這個人這一季可以服侍的崗位」要用的資料（一次讀好，逐季共用）。
 * 崗位＝事奉人員表上的崗位（自動排的）＋同日不兼任的崗位（領詩、司琴）；不列只作名單組別的詩班、不在職事表顯示的。
 * @param {string} timezone 時區
 * @returns {{posts: Object[], roleContext: Object, ruleCtx: Object}}
 */
function buildPersonQuarterPostsContext_(timezone) {
  const posts = readPostsNormalized_({ includeGroups: true });
  const sameDay = readSameDayExclusivePostIds_();
  const choirId = readChoirGroupPostId_();
  const shown = posts.filter(function (p) {
    if (p.postId === choirId) return false;
    if (p.showInRoster === false) return false;
    return p.autoGenerate === true || sameDay.indexOf(p.postId) !== -1;
  });
  const eligibility = readEligibility_();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  return { posts: shown, roleContext: roleContext, ruleCtx: { eligibility: eligibility, roles: roleContext.roles } };
}

/**
 * 第九十四輪批次 UA 組：這個人這一季可以服侍的崗位（名單寫「堂委」「執事」的崗位按這一季第一個主日的身分展開）。
 * @param {string} personId 人
 * @param {string} firstSunday 這一季第一個主日（yyyy-MM-dd）
 * @param {Object} ctx buildPersonQuarterPostsContext_()
 * @returns {{postId: string, postNameTC: string}[]} Posts 工作表的次序
 */
function listPersonQuarterPosts_(personId, firstSunday, ctx) {
  return ctx.posts.filter(function (p) {
    if ((ctx.roleContext.eligibleByPost[p.postId] || []).indexOf(personId) === -1) return false;
    return !eligibilityRoleTokenFailure_(ctx.ruleCtx, p.postId, personId, firstSunday);
  }).map(function (p) { return { postId: p.postId, postNameTC: p.postNameTC || p.postId }; });
}

/**
 * 崗位清單的文字：空＝「全部崗位」；否則崗位名（找不到名就用編號）。
 * @param {string[]} postIds
 * @param {Object.<string, string>} nameById PostID → 中文名
 * @returns {string}
 */
function describeUnavailablePosts_(postIds, nameById) {
  if (!postIds || postIds.length === 0) return UNAVAILABLE_ALL_POSTS_TC;
  return postIds.map(function (id) { return (nameById || {})[id] || id; }).join('、');
}

/** @returns {Object.<string, string>} PostID → 中文名（包括名單組別） */
function readPostNameIndexForUnavailable_() {
  const out = {};
  readPostsNormalized_({ includeGroups: true }).forEach(function (p) { out[p.postId] = p.postNameTC || p.postId; });
  return out;
}

/**
 * 個人頁「申報不能服侍的日子」那一段的資料。**只讀；只有這個人自己的資料。**
 * @param {string} personId 已經用 token 認出來的人
 * @param {string} todayStr 今日
 * @param {string} timezone 時區
 * @param {string=} anchorQuarterId 連結的季度（`q`）
 * @returns {{quarters: Object[], submissions: Object[], maxDates: number, maxReason: number}}
 */
function buildPersonalUnavailableView_(personId, todayStr, timezone, anchorQuarterId) {
  const D = COLUMNS.SERVICE_DATES;
  const U = COLUMNS.UNAVAILABLE;
  const quarters = listPersonalUnavailableQuarters_(todayStr, timezone, anchorQuarterId);
  const mine = readUnavailableSubmissions_(timezone).filter(function (s) { return s.personId === personId; });
  // 第九十五輪批次 VE 組：已確認的申報，連結的 Unavailable 已被取消（或已不在）⇒「幹事已取消」，那一日可以再申報
  const activeUnavailableIds = {};
  readUnavailable_().forEach(function (r) {
    if (isUnavailableRowActive_(r)) activeUnavailableIds[String(r[U.UNAVAILABLE_ID] || '').trim()] = true;
  });
  const viewStatusOf = function (s) {
    if (s.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED && s.unavailableId && !activeUnavailableIds[s.unavailableId]) {
      return UNAVAILABLE_SUBMISSION_VIEW_CANCELLED;
    }
    return s.status;
  };
  const byDate = {};
  mine.forEach(function (s) {
    const st = viewStatusOf(s);
    if (st === UNAVAILABLE_SUBMISSION_STATUS.PENDING || st === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED) {
      byDate[s.serviceDate] = st;
    }
  });
  // 已經在不能服侍名單（任何來源、生效中）的日子不用再申報
  const listed = readUnavailable_().filter(function (r) {
    return isUnavailableRowActive_(r) && String(r[U.PERSON_ID] || '').trim() === personId;
  }).map(function (r) {
    const from = toDateString_(r[U.DATE_FROM], timezone);
    return { from: from, to: toDateString_(r[U.DATE_TO], timezone) || from,
      all: String(r[U.APPLIES_TO] || UNAVAILABLE_VALUES.APPLIES_TO_ALL).trim() === UNAVAILABLE_VALUES.APPLIES_TO_ALL };
  });
  const isListed = function (d) { return listed.some(function (u) { return u.all && u.from <= d && d <= u.to; }); };
  const dateRows = readSheet_(SHEETS.SERVICE_DATES);
  const postsCtx = quarters.length > 0 ? buildPersonQuarterPostsContext_(timezone) : null;
  const out = quarters.map(function (q) {
    const allDates = dateRows
      .filter(function (r) { return String(r[D.QUARTER_ID] || '').trim() === q.quarterId; })
      .map(function (r) { return toDateString_(r[D.SERVICE_DATE], timezone); })
      .filter(function (d) { return !!d; })
      .sort();
    const firstSunday = allDates[0] || q.startDate;
    const dates = allDates
      .filter(function (d) { return d >= todayStr; })
      .map(function (d) {
        return { serviceDate: d, label: personalUnavailableDayLabel_(d),
          status: byDate[d] || (isListed(d) ? 'LISTED' : '') };
      });
    // 第九十四輪批次 UA 組：「只限以下崗位」可以選的崗位（這個人這一季可以服侍的）
    return { quarterId: q.quarterId, label: q.label, deadline: q.deadline, dates: dates,
      posts: listPersonQuarterPosts_(personId, firstSunday, postsCtx) };
  }).filter(function (q) { return q.dates.length > 0; });
  const postNames = readPostNameIndexForUnavailable_();
  const submissions = mine
    // 第九十四輪批次 UA 組：「我已申報的日子」連已撤回的都列出（狀態寫明）
    .filter(function (s) { return s.serviceDate >= todayStr; })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); })
    .map(function (s) {
      const st = viewStatusOf(s);
      return {
        submissionId: s.submissionId,
        serviceDate: s.serviceDate,
        label: personalUnavailableDayLabel_(s.serviceDate),
        reason: s.reason,
        postIds: s.postIds,
        postsText: describeUnavailablePosts_(s.postIds, postNames),
        status: st,
        statusText: st === UNAVAILABLE_SUBMISSION_VIEW_CANCELLED ? UNAVAILABLE_SUBMISSION_VIEW_CANCELLED_TC
          : (UNAVAILABLE_SUBMISSION_STATUS_TC[s.status] || s.status),
        canWithdraw: s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING,
        late: s.late
      };
    });
  return { quarters: out, submissions: submissions,
    maxDates: PERSONAL_UNAVAILABLE_MAX_DATES, maxReason: PERSONAL_UNAVAILABLE_REASON_MAX };
}

/**
 * 嵌入 `<script>` 的 JSON：`<`、`>`、`&`、U+2028／2029 一律轉義（原因是義工自己輸入的字）。
 * @param {*} obj 資料
 * @returns {string}
 */
function jsonForInlineScript_(obj) {
  return JSON.stringify(obj === undefined ? null : obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** @returns {string} 6 個十六進位字元（編號用，避免同一秒撞號） */
function randomIdSuffix_() {
  return Utilities.getUuid().split('-').join('').slice(0, 6);
}

/** @returns {{timezone: string, today: string}} */
function personalUnavailableToday_() {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return { timezone: timezone, today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd') };
}

/**
 * 個人連結公開函式：提交不能服侍的日子。**只寫 `UnavailableSubmissions` 這個人自己的行。**
 * @param {string} token 個人連結 token
 * @param {string} quarterId 連結的季度（`q`；決定可以申報哪幾季）
 * @param {string[]} dates 主日（yyyy-MM-dd）
 * @param {string} reason 原因（可以空白）
 * @param {string[]=} postIds 第九十四輪批次 UA 組：只限這些崗位（不傳／空陣列＝全部崗位）
 * @returns {{ok: boolean, message: string, added: number, view: Object}}
 */
function personalSubmitUnavailable(token, quarterId, dates, reason, postIds) {
  const person = assertPersonalLinkCaller_(token);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, message: '系統繁忙，請稍後再試。', added: 0 };
  }
  try {
    return submitPersonalUnavailable_(person, dates, reason, typeof quarterId === 'string' ? quarterId : '', postIds);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 提交的實際內容（已認出人、已拿鎖）。
 * @param {{personId: string, nameTC: string}} person 這個人
 * @param {*} dates 頁面送來的日期
 * @param {*} reason 頁面送來的原因
 * @param {string=} anchorQuarterId 連結的季度
 * @param {*=} postIds 頁面送來的崗位（不傳／空陣列＝全部崗位）
 * @returns {{ok: boolean, message: string, added: number, view: Object}}
 */
function submitPersonalUnavailable_(person, dates, reason, anchorQuarterId, postIds) {
  const now = personalUnavailableToday_();
  const fail = function (message) {
    return { ok: false, message: message, added: 0,
      view: buildPersonalUnavailableView_(person.personId, now.today, now.timezone, anchorQuarterId) };
  };
  if (!Array.isArray(dates) || dates.length === 0) return fail('請先勾選日子。');
  const wanted = [];
  dates.forEach(function (d) {
    const s = typeof d === 'string' ? d.trim() : '';
    if (wanted.indexOf(s) === -1) wanted.push(s);
  });
  if (wanted.length > PERSONAL_UNAVAILABLE_MAX_DATES) {
    return fail('每次最多可以提交 ' + PERSONAL_UNAVAILABLE_MAX_DATES + ' 個日子，請分開提交。');
  }
  const view = buildPersonalUnavailableView_(person.personId, now.today, now.timezone, anchorQuarterId);
  const allowed = {};
  const quarterOf = {};
  view.quarters.forEach(function (q) {
    q.dates.forEach(function (d) { allowed[d.serviceDate] = d.status; quarterOf[d.serviceDate] = q; });
  });
  const bad = wanted.filter(function (d) { return !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Object.prototype.hasOwnProperty.call(allowed, d); });
  if (bad.length > 0) return fail('有日子不可以申報（不是可以選的主日，或者已經過去），請重新整理頁面再選。');
  const all = readUnavailableSubmissions_(now.timezone);
  const batchesToday = {};
  all.forEach(function (s) {
    if (s.personId === person.personId && s.submittedDay === now.today) batchesToday[s.submittedAt] = true;
  });
  if (Object.keys(batchesToday).length >= PERSONAL_UNAVAILABLE_MAX_PER_DAY) {
    return fail('今日的提交次數已經到上限，請明天再試，或者聯絡幹事。');
  }
  const fresh = wanted.filter(function (d) { return !allowed[d]; });   // 已申報／已確認／已在名單 ⇒ 不重複
  if (fresh.length === 0) return fail('勾選的日子已經申報過了。');
  // 第九十四輪批次 UA 組：只限某些崗位 ⇒ 一定是同一季的日子，而且崗位是這個人這一季可以服侍的（伺服器重新計算，不信頁面）
  let wantedPosts = [];
  if (postIds !== undefined && postIds !== null) {
    if (!Array.isArray(postIds)) return fail('崗位的資料不正確，請重新整理頁面再選。');
    postIds.forEach(function (x) {
      const id = typeof x === 'string' ? x.trim() : '';
      if (id && wantedPosts.indexOf(id) === -1) wantedPosts.push(id);
    });
    if (postIds.length > 0 && wantedPosts.length === 0) return fail('崗位的資料不正確，請重新整理頁面再選。');
  }
  if (wantedPosts.length > 0) {
    const qIds = {};
    fresh.forEach(function (d) { qIds[quarterOf[d].quarterId] = true; });
    if (Object.keys(qIds).length !== 1) return fail('只限某些崗位時，每次只可以提交同一季的日子，請分開提交。');
    const okPosts = (quarterOf[fresh[0]].posts || []).map(function (x) { return x.postId; });
    if (wantedPosts.some(function (id) { return okPosts.indexOf(id) === -1; })) {
      return fail('選了你這一季不在名單上的崗位，請重新整理頁面再選。');
    }
  }
  const postNames = readPostNameIndexForUnavailable_();
  const postsText = describeUnavailablePosts_(wantedPosts, postNames);
  const cleanReason = sanitizePersonalUnavailableReason_(reason);
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const sheet = ensureUnavailableSubmissionsSheet_();
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const stamp = nowTimestamp_();
  const idBase = 'SUB-' + compactTimestamp_() + '-' + person.personId + '-' + randomIdSuffix_();
  const lateDates = [];
  fresh.sort().forEach(function (d, i) {
    const q = quarterOf[d];
    const late = !!(q && q.deadline && now.today > q.deadline);
    if (late) lateDates.push(d);
    const rec = {};
    rec[S.SUBMISSION_ID] = idBase + '-' + (i + 1);
    rec[S.PERSON_ID] = person.personId;
    rec[S.SERVICE_DATE] = d;
    rec[S.REASON] = cleanReason;
    rec[S.SUBMITTED_AT] = stamp;
    rec[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.PENDING;
    rec[S.LATE] = late;
    rec[S.POST_IDS] = wantedPosts.join(',');
    appendRowFields_(sheet, headers, rec);
  });
  writeAuditLog_({
    action: 'PERSONAL_UNAVAILABLE_SUBMITTED',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: person.personId,
    oldValue: '',
    newValue: fresh.join('、'),
    source: 'personalSubmitUnavailable',
    notes: '個人專屬連結申報 ' + fresh.length + ' 個日子（' + postsText + '）' + (lateDates.length ? '（截止日之後：' + lateDates.join('、') + '）' : '')
  });
  return { ok: true, added: fresh.length,
    message: '已提交 ' + fresh.length + ' 個日子（' + (wantedPosts.length ? '崗位：' + postsText : UNAVAILABLE_ALL_POSTS_TC) + '），等候確認。',
    view: buildPersonalUnavailableView_(person.personId, now.today, now.timezone, anchorQuarterId) };
}

/**
 * 個人連結公開函式：撤回一項**等候確認**的申報。只可以撤回自己的。
 * @param {string} token 個人連結 token
 * @param {string} quarterId 連結的季度（`q`；回傳的頁面資料用）
 * @param {string} submissionId 申報編號
 * @returns {{ok: boolean, message: string, view: Object}}
 */
function personalWithdrawUnavailable(token, quarterId, submissionId) {
  const person = assertPersonalLinkCaller_(token);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, message: '系統繁忙，請稍後再試。' };
  }
  try {
    return withdrawPersonalUnavailable_(person, submissionId, typeof quarterId === 'string' ? quarterId : '');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 撤回的實際內容。
 * @param {{personId: string}} person 這個人
 * @param {*} submissionId 頁面送來的編號
 * @param {string=} anchorQuarterId 連結的季度
 * @returns {{ok: boolean, message: string, view: Object}}
 */
function withdrawPersonalUnavailable_(person, submissionId, anchorQuarterId) {
  const now = personalUnavailableToday_();
  const id = typeof submissionId === 'string' ? submissionId.trim() : '';
  const target = readUnavailableSubmissions_(now.timezone).filter(function (s) {
    return s.submissionId === id && s.personId === person.personId;
  })[0];
  const view = function () { return buildPersonalUnavailableView_(person.personId, now.today, now.timezone, anchorQuarterId); };
  // 不是自己的、找不到 ⇒ 同一句（不透露那個編號是不是別人的）
  if (!target) return { ok: false, message: '找不到這一項申報，請重新整理頁面。', view: view() };
  if (target.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED) {
    return { ok: false, message: '這一項已經確認。如需取消，請聯絡幹事。', view: view() };
  }
  if (target.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) {
    return { ok: false, message: '這一項已經處理，不可以撤回。', view: view() };
  }
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const sheet = ensureUnavailableSubmissionsSheet_();
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  writeRowFields_(sheet, headers, target.sheetRow, (function () {
    const u = {};
    u[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.WITHDRAWN;
    u[S.DECIDED_AT] = nowTimestamp_();
    return u;
  })());
  writeAuditLog_({
    action: 'PERSONAL_UNAVAILABLE_WITHDRAWN',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: person.personId,
    oldValue: target.serviceDate + '｜' + UNAVAILABLE_SUBMISSION_STATUS.PENDING,
    newValue: target.serviceDate + '｜' + UNAVAILABLE_SUBMISSION_STATUS.WITHDRAWN,
    source: 'personalWithdrawUnavailable',
    notes: '個人專屬連結撤回：' + target.submissionId
  });
  return { ok: true, message: '已撤回 ' + personalUnavailableDayLabel_(target.serviceDate) + ' 的申報。', view: view() };
}

// ═════════════════════════════════════════════════════════════════════
// 幹事端
// ═════════════════════════════════════════════════════════════════════

/**
 * 等候確認的申報（幹事〔不能服侍的日期〕最上面那一段）。
 * @param {string} timezone 時區
 * @returns {Object[]} {submissionId, personId, personName, serviceDate, reason, submittedAt, late}
 */
function readPendingUnavailableSubmissions_(timezone) {
  const names = buildPersonNameIndex_();
  const postNames = readPostNameIndexForUnavailable_();
  return readUnavailableSubmissions_(timezone)
    .filter(function (s) { return s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING; })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); })
    .map(function (s) {
      return { submissionId: s.submissionId, personId: s.personId, personName: names[s.personId] || s.personId,
        serviceDate: s.serviceDate, reason: s.reason, submittedAt: s.submittedAt, late: s.late,
        postIds: s.postIds, postsText: describeUnavailablePosts_(s.postIds, postNames) };
    });
}

/**
 * 等候確認的申報數目（主畫面、季前資料用）。讀不到 ⇒ 拋錯（呼叫端照實講）。
 * @param {?{start: string, end: string}} range 只計落在這段日子的（null ⇒ 全部）
 * @returns {number}
 */
function countPendingUnavailableSubmissions_(range) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return readUnavailableSubmissions_(timezone).filter(function (s) {
    if (s.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) return false;
    return !range || (s.serviceDate >= range.start && s.serviceDate <= range.end);
  }).length;
}

/**
 * 供前端呼叫：〔確認申請〕〔不確認〕〔全部確認〕。**會寫入。**
 * 確認 ⇒ 建立 `Unavailable` 行（Source=PERSONAL_LINK；有 PostIDs ⇒ 只限那些崗位）並記 UnavailableID；
 * 不確認 ⇒ 只改狀態。之後按人合併通知申請人（UC）。
 * 第九十四輪批次 UB 組：確認者（UNAVAILABLE_CONFIRMER_EMAILS）亦可以呼叫——見 WebApp.gs `UNAVAILABLE_CONFIRMER_APIS`。
 * @param {string[]} submissionIds 申報編號
 * @param {string} decision 'ACCEPT'／'REJECT'
 * @returns {{ok: boolean, accepted: number, rejected: number, skipped: number, message: string}}
 */
function apiDecideUnavailableSubmissions(submissionIds, decision) {
  assertWebAppRequestAllowed_('apiDecideUnavailableSubmissions');
  return withMutationLock_('處理義工申報', function () {
    return decideUnavailableSubmissions_(submissionIds, decision, Session.getActiveUser().getEmail());
  });
}

/**
 * 確認／不確認的實際內容（已拿鎖）。寫入失敗會拋錯（自動確認那一條路要停下來，不可以靜靜略過）。
 * @param {string[]} submissionIds 申報編號
 * @param {string} decision 'ACCEPT'／'REJECT'
 * @param {string} decidedBy 登入電郵，或 UNAVAILABLE_AUTO_CONFIRM_BY 的字眼
 * @returns {{ok: boolean, accepted: number, rejected: number, skipped: number, message: string, notified: Object}}
 */
function decideUnavailableSubmissions_(submissionIds, decision, decidedBy) {
  const accept = decision === 'ACCEPT';
  if (!accept && decision !== 'REJECT') throw new Error('不認得的決定：' + decision);
  const ids = (Array.isArray(submissionIds) ? submissionIds : []).map(function (x) { return String(x || '').trim(); });
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const S = COLUMNS.UNAVAILABLE_SUBMISSIONS;
  const U = COLUMNS.UNAVAILABLE;
  const subs = readUnavailableSubmissions_(timezone);
  const subSheet = ensureUnavailableSubmissionsSheet_();
  const subHeaders = subSheet.getRange(2, 1, 1, subSheet.getLastColumn()).getValues()[0];
  const names = buildPersonNameIndex_();
  const postNames = readPostNameIndexForUnavailable_();
  let unav = null;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  const decided = [];
  const stamp = nowTimestamp_();
  // 加隨機部分：同一秒內兩次〔確認申請〕不會撞編號
  const idBase = 'UNAV-' + compactTimestamp_() + '-' + randomIdSuffix_();
  ids.forEach(function (id) {
    const s = subs.filter(function (x) { return x.submissionId === id; })[0];
    if (!s || s.status !== UNAVAILABLE_SUBMISSION_STATUS.PENDING) { skipped++; return; }
    const updates = {};
    updates[S.DECIDED_BY] = decidedBy || '';
    updates[S.DECIDED_AT] = stamp;
    if (accept) {
      if (!unav) unav = openSheetForEdit_(SHEETS.UNAVAILABLE);
      const newId = idBase + '-' + (accepted + 1);
      const rec = {};
      rec[U.UNAVAILABLE_ID] = newId;
      rec[U.PERSON_ID] = s.personId;
      rec[U.DATE_FROM] = s.serviceDate;
      rec[U.DATE_TO] = s.serviceDate;
      // 第九十四輪批次 UA 組：只限某些崗位 ⇒ 用現有「只限某些崗位」的值（POSTS）＋PostIDs
      rec[U.APPLIES_TO] = s.postIds.length > 0 ? 'POSTS' : UNAVAILABLE_VALUES.APPLIES_TO_ALL;
      rec[U.POST_IDS] = s.postIds.join(',');
      rec[U.REASON] = s.reason;
      rec[U.SOURCE] = UNAVAILABLE_SOURCE_PERSONAL_LINK;
      rec[U.STATUS] = UNAVAILABLE_VALUES.STATUS_ACTIVE;
      rec[U.CREATED_AT] = stamp;
      rec[U.CREATED_BY] = decidedBy || '';
      appendRowFields_(unav.sheet, unav.headers, rec);
      updates[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED;
      updates[S.UNAVAILABLE_ID] = newId;
      accepted++;
    } else {
      updates[S.STATUS] = UNAVAILABLE_SUBMISSION_STATUS.REJECTED;
      rejected++;
    }
    writeRowFields_(subSheet, subHeaders, s.sheetRow, updates);
    decided.push({ personId: s.personId, serviceDate: s.serviceDate, postIds: s.postIds, accepted: accept });
    writeZone3Audit_({
      action: accept ? 'PERSONAL_UNAVAILABLE_ACCEPTED' : 'PERSONAL_UNAVAILABLE_REJECTED',
      targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
      targetKey: s.submissionId,
      oldValue: UNAVAILABLE_SUBMISSION_STATUS.PENDING,
      newValue: updates[S.STATUS] + (accept ? '｜' + updates[S.UNAVAILABLE_ID] : ''),
      notes: (names[s.personId] || s.personId) + '　' + s.serviceDate + '　' + describeUnavailablePosts_(s.postIds, postNames)
        + (s.reason ? '　原因：' + s.reason : '') + '　決定者：' + (decidedBy || '')
    });
  });
  // 第九十四輪批次 UC 組：按人合併通知申請人。通知失敗不會令已經寫入的決定變無效（記 AuditLog、講出來）。
  let notified = { sent: 0, simulated: 0, noEmail: 0, failed: 0 };
  if (decided.length > 0) {
    try {
      notified = notifyUnavailableDecisions_(decided, names, postNames);
    } catch (err) {
      log_('WARN', '通知申請人失敗：' + err.message);
      notified.failed = decided.length;
    }
  }
  const parts = [];
  if (accepted) parts.push('已確認 ' + accepted + ' 項（已加入不能服侍的日期）');
  if (rejected) parts.push('不確認 ' + rejected + ' 項');
  if (skipped) parts.push(skipped + ' 項已經處理過或找不到，沒有改動');
  if (decided.length > 0) {
    parts.push(notified.simulated > 0 ? '通知申請人：測試模式，模擬 ' + notified.simulated + ' 封'
      : '已通知申請人 ' + notified.sent + ' 封' + (notified.noEmail ? '（' + notified.noEmail + ' 位沒有電郵）' : '')
        + (notified.failed ? '（' + notified.failed + ' 封未能寄出）' : ''));
  }
  return { ok: true, accepted: accepted, rejected: rejected, skipped: skipped, notified: notified,
    message: parts.length ? parts.join('；') + '。' : '沒有改動。' };
}

/** 預設範本（EmailTemplates 沒有這一行時用；「補齊 Email 範本」會加入）。 */
function unavailableDecidedTemplateDefault_() {
  return EMAIL_TEMPLATE_SEEDS.filter(function (t) { return t.templateId === UNAVAILABLE_DECIDED_TEMPLATE_ID; })[0];
}

/**
 * 第九十四輪批次 UC 組：通知申請人那封信的內容（純函式；範本樣本用同一支）。
 * @param {{serviceDate: string, postsText: string, accepted: boolean}[]} items 這個人這一次的決定
 * @param {string} quarterLabel 季度名（多於一季用「、」連接）
 * @returns {{DecisionHtml: string, DecisionPlain: string, QuarterLabel: string}}
 */
function buildUnavailableDecisionPlaceholders_(items, quarterLabel) {
  const esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const line = function (it) { return personalUnavailableDayLabel_(it.serviceDate) + '（' + it.postsText + '）'; };
  const ok = items.filter(function (it) { return it.accepted; });
  const no = items.filter(function (it) { return !it.accepted; });
  const html = [];
  const plain = [];
  if (ok.length > 0) {
    html.push('<p>你申報 ' + esc(quarterLabel) + ' 以下主日不能服侍，已確認了你的申請：</p><ul>'
      + ok.map(function (it) { return '<li>' + esc(line(it)) + '</li>'; }).join('') + '</ul>'
      + '<p>系統排表時會避開這些日子。如需更改，請聯絡幹事。</p>');
    plain.push('你申報 ' + quarterLabel + ' 以下主日不能服侍，已確認了你的申請：\n'
      + ok.map(function (it) { return '・' + line(it); }).join('\n') + '\n系統排表時會避開這些日子。如需更改，請聯絡幹事。');
  }
  if (no.length > 0) {
    html.push('<p>未能確認你以下的申請：</p><ul>'
      + no.map(function (it) { return '<li>' + esc(line(it)) + '</li>'; }).join('') + '</ul><p>請聯絡幹事了解。</p>');
    plain.push('未能確認你以下的申請：\n' + no.map(function (it) { return '・' + line(it); }).join('\n') + '\n請聯絡幹事了解。');
  }
  return { QuarterLabel: quarterLabel, DecisionHtml: html.join(''), DecisionPlain: plain.join('\n\n') };
}

/**
 * 第九十四輪批次 UC 組：按人合併，寄信通知申請人（確認、不確認、自動確認都寄）。
 * 經 sendRealEmail_()（DRY_RUN 時只模擬；轉寄照舊）。沒有電郵的人略過並記入 AuditLog。
 * @param {{personId: string, serviceDate: string, postIds: string[], accepted: boolean}[]} decided
 * @param {Object.<string, string>} names PersonID → 名
 * @param {Object.<string, string>} postNames PostID → 名
 * @returns {{sent: number, simulated: number, noEmail: number, failed: number}}
 */
function notifyUnavailableDecisions_(decided, names, postNames) {
  const config = readConfig_();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const dryRun = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const context = { senderName: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || ''), replyTo: String(config[CONFIG_KEYS.MAIL_REPLY_TO] || '') };
  const tpl = findEmailTemplateById_(UNAVAILABLE_DECIDED_TEMPLATE_ID) || unavailableDecidedTemplateDefault_();
  const M = COLUMNS.NAME_MAPPING;
  const emailById = {};
  readPeople_().forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (id) emailById[id] = String(row[M.EMAIL] || '').trim();
  });
  const quarterRows = readSheet_(SHEETS.QUARTERS).map(function (r) {
    return { quarterId: String(r[COLUMNS.QUARTERS.QUARTER_ID] || '').trim(),
      start: toDateString_(r[COLUMNS.QUARTERS.START_DATE], timezone), end: toDateString_(r[COLUMNS.QUARTERS.END_DATE], timezone) };
  });
  const quarterLabelOf = function (d) {
    const q = quarterRows.filter(function (x) { return x.quarterId && x.start <= d && d <= x.end; })[0];
    return q ? buildQuarterLabel_(q.quarterId) : '';
  };
  const byPerson = {};
  const order = [];
  decided.forEach(function (it) {
    if (!byPerson[it.personId]) { byPerson[it.personId] = []; order.push(it.personId); }
    byPerson[it.personId].push({ serviceDate: it.serviceDate, accepted: it.accepted,
      postsText: describeUnavailablePosts_(it.postIds, postNames) });
  });
  const out = { sent: 0, simulated: 0, noEmail: 0, failed: 0 };
  order.forEach(function (personId) {
    const items = byPerson[personId].sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : 1; });
    const labels = [];
    items.forEach(function (it) { const l = quarterLabelOf(it.serviceDate); if (l && labels.indexOf(l) === -1) labels.push(l); });
    const name = names[personId] || personId;
    const email = emailById[personId] || '';
    const audit = function (flag, notes) {
      writeAuditLog_({ action: 'UNAVAILABLE_DECISION_NOTIFIED', targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS, targetKey: personId,
        oldValue: '', newValue: flag, source: 'notifyUnavailableDecisions_', notes: notes });
    };
    const summary = items.map(function (it) { return it.serviceDate + (it.accepted ? ' 確認' : ' 不確認'); }).join('、');
    if (!email) { out.noEmail++; audit('NO_EMAIL', '沒有電郵，沒有通知：' + summary); return; }
    const placeholders = buildUnavailableDecisionPlaceholders_(items, labels.join('、'));
    const recipient = { email: email, displayName: name };
    const subject = prefix + applyPlaceholders_(tpl.subject, placeholders, recipient, '');
    const html = applyPlaceholders_(tpl.bodyHtml, placeholders, recipient, '');
    const plain = applyPlaceholders_(tpl.bodyPlain, placeholders, recipient, '');
    if (dryRun) { out.simulated++; audit('DRY_RUN', '模擬通知：' + summary); return; }
    try {
      sendRealEmail_(recipient, subject, html, plain, context, null, null);
      out.sent++;
      audit('SENT', '已通知：' + summary);
    } catch (err) {
      out.failed++;
      audit('FAILED', '未能寄出（' + err.message + '）：' + summary);
    }
  });
  return out;
}

/**
 * 第九十四輪批次 UD 組：〔生成初稿〕〔請系統幫我調整〕執行前，把**該季**所有等候確認的申報自動確認
 * （DecidedBy＝「系統自動（生成初稿）」等）、建立 Unavailable、寄確認信。寫入失敗 ⇒ 拋三段式錯誤（呼叫端停下）。
 * 呼叫端要已經拿着 withMutationLock_ 的鎖。
 * @param {string} quarterId 季度
 * @param {string} decidedBy UNAVAILABLE_AUTO_CONFIRM_BY 之一
 * @returns {{confirmed: number, message: string}}
 */
function autoConfirmPendingSubmissionsForQuarter_(quarterId, decidedBy) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const range = readQuarterDateRangeForUnavailable_(quarterId, timezone);
  if (!range) return { confirmed: 0, message: '' };
  let ids;
  try {
    ids = readUnavailableSubmissions_(timezone).filter(function (s) {
      return s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING && s.serviceDate >= range.start && s.serviceDate <= range.end;
    }).map(function (s) { return s.submissionId; });
  } catch (err) {
    throw new Error(buildThreePartMessage_('讀不到義工申報（' + err.message + '），未能自動確認。',
      '沒有開始，甚麼都沒有改動。', ['稍後再按一次', '如果一直失敗，先在「不能服侍的日期」最上面人手確認或不確認']));
  }
  if (ids.length === 0) return { confirmed: 0, message: '' };
  let r;
  try {
    r = decideUnavailableSubmissions_(ids, 'ACCEPT', decidedBy);
  } catch (err) {
    throw new Error(buildThreePartMessage_('自動確認義工申報時出錯（' + err.message + '）。',
      '沒有開始排表。部分申報可能已經確認（見「不能服侍的日期」最上面）。',
      ['稍後再按一次（已確認的不會重複）', '或者先在「不能服侍的日期」最上面人手確認或不確認，再按一次']));
  }
  return { confirmed: r.accepted, message: r.accepted > 0 ? '已自動確認 ' + r.accepted + ' 項義工申報，並通知申請人。' : '' };
}

/**
 * 該季的日子範圍（Quarters 的 StartDate／EndDate）。找不到 ⇒ null。
 * @param {string} quarterId 季度
 * @param {string} timezone 時區
 * @returns {?{start: string, end: string}}
 */
function readQuarterDateRangeForUnavailable_(quarterId, timezone) {
  const q = findQuarter_(String(quarterId || '').trim());
  if (!q) return null;
  const start = toDateString_(q[COLUMNS.QUARTERS.START_DATE], timezone);
  const end = toDateString_(q[COLUMNS.QUARTERS.END_DATE], timezone);
  return start && end ? { start: start, end: end } : null;
}

/**
 * 第九十四輪批次 UD 組：該季等候確認的申報數目（生成／調整確認窗那一句用）。讀不到 ⇒ -1。
 * @param {string} quarterId 季度
 * @returns {number}
 */
function countPendingSubmissionsForQuarterSafe_(quarterId) {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const range = readQuarterDateRangeForUnavailable_(quarterId, timezone);
    return range ? countPendingUnavailableSubmissions_(range) : 0;
  } catch (err) {
    return -1;
  }
}

/** 確認窗那一句（有待確認時才有）。 */
function describePendingAutoConfirm_(count) {
  return count > 0 ? '還有 ' + count + ' 項義工申報未確認，開始之後會自動當作確認，並通知申請人。' : '';
}

/**
 * 第九十四輪批次 UB 組：供前端呼叫——「義工申報，確認」畫面。**只讀。**
 * 可以修改的人、只可查看的人（按鈕灰色）、確認者都可以呼叫（見 WebApp.gs）。
 * @param {string=} quarterId 深連結的季度（只用來寫標題；待確認一律列出全部）
 * @returns {{pending: Object[], pendingCount: number, history: Object[], canDecide: boolean, quarterLabel: string}}
 */
function apiGetUnavailableConfirmView(quarterId) {
  const role = assertWebAppRequestAllowed_('apiGetUnavailableConfirmView');
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const all = readUnavailableSubmissions_(timezone);
  return buildUnavailableConfirmView_(all, buildPersonNameIndex_(), readPostNameIndexForUnavailable_(),
    role === WEBAPP_ROLE.EDITOR || isUnavailableConfirmerCaller_(), String(quarterId || '').trim());
}

/**
 * 確認畫面的資料。**純函式。**
 * @param {Object[]} all readUnavailableSubmissions_()
 * @param {Object.<string, string>} names PersonID → 名
 * @param {Object.<string, string>} postNames PostID → 名
 * @param {boolean} canDecide 這個人可不可以按〔確認申請〕〔不確認〕
 * @param {string} quarterId 深連結的季度
 * @returns {Object}
 */
function buildUnavailableConfirmView_(all, names, postNames, canDecide, quarterId) {
  const pendingItems = all.filter(function (s) { return s.status === UNAVAILABLE_SUBMISSION_STATUS.PENDING; })
    .sort(function (a, b) { return a.serviceDate < b.serviceDate ? -1 : (a.serviceDate > b.serviceDate ? 1 : 0); });
  const groups = [];
  const byPerson = {};
  pendingItems.forEach(function (s) {
    if (!byPerson[s.personId]) {
      byPerson[s.personId] = { personId: s.personId, personName: names[s.personId] || s.personId, items: [] };
      groups.push(byPerson[s.personId]);
    }
    byPerson[s.personId].items.push({ submissionId: s.submissionId, serviceDate: s.serviceDate,
      postsText: describeUnavailablePosts_(s.postIds, postNames), reason: s.reason, submittedAt: s.submittedAt, late: s.late });
  });
  const history = all.filter(function (s) {
    return s.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED || s.status === UNAVAILABLE_SUBMISSION_STATUS.REJECTED;
  }).sort(function (a, b) { return a.decidedAt < b.decidedAt ? 1 : (a.decidedAt > b.decidedAt ? -1 : 0); })
    .slice(0, 50)
    .map(function (s) {
      return { personName: names[s.personId] || s.personId, serviceDate: s.serviceDate,
        postsText: describeUnavailablePosts_(s.postIds, postNames),
        resultText: s.status === UNAVAILABLE_SUBMISSION_STATUS.ACCEPTED ? '已確認' : '不確認',
        decidedBy: s.decidedBy, decidedAt: s.decidedAt };
    });
  return { pending: groups, pendingCount: pendingItems.length, history: history, canDecide: !!canDecide,
    quarterId: quarterId, quarterLabel: quarterId ? buildQuarterLabel_(quarterId) : '' };
}

/**
 * 第九十三輪批次 TB 組：「義工申報待確認」幹事通知的文字（由 `runUnavailableSubmissionNotify_()` 抽出，
 * 〔寄出電郵範本樣本〕用示範資料叫同一支，樣本文字不會和正式通知分家）。
 * @param {string} prefix 主旨前綴
 * @param {{personName: string, serviceDate: string, reason: string, late: boolean}[]} fresh 新申報
 * @param {number} pendingCount 全部待確認數
 * @param {string=} confirmUrl 第九十四輪批次 UC 組：確認畫面的深連結（沒有設定幹事介面網址 ⇒ 空白，改寫去哪裏找）
 * @returns {{subject: string, body: string}}
 */
function buildUnavailableSubmissionNotifyText_(prefix, fresh, pendingCount, confirmUrl) {
  const lines = fresh.slice(0, 30).map(function (s) {
    return '　• ' + s.personName + '　' + s.serviceDate + (s.postsText ? '　' + s.postsText : '')
      + (s.reason ? '　原因：' + s.reason : '') + (s.late ? '　（截止日之後）' : '');
  });
  if (fresh.length > 30) lines.push('　……另有 ' + (fresh.length - 30) + ' 項');
  const body = '有 ' + fresh.length + ' 項新的義工申報（不能服侍）等候確認（全部待確認：' + pendingCount + ' 項）：\n\n'
    + lines.join('\n') + '\n\n'
    + (confirmUrl
      ? '請打開確認畫面，逐項〔確認申請〕或〔不確認〕：\n' + confirmUrl
      : '請打開幹事介面「開季前準備 ▸ 不能服侍的日期」，在最上面逐項〔確認申請〕或〔不確認〕。')
    + '\n\n（未確認的申報會在生成初稿或「請系統幫我調整」之前自動當作確認。）';
  return { subject: prefix + '義工申報不能服侍：' + fresh.length + ' 項等候確認', body: body };
}

/**
 * 每日檢查：有新的待確認申報 ⇒ 通知幹事一次（同一日最多一封；遵守 DRY_RUN；Config 可關）。
 * 「新」＝提交時間在上一次通知之後。通知紀錄寫 AuditLog（UNAVAILABLE_SUBMISSION_NOTIFIED）。
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @param {boolean} isDryRun DRY_RUN
 * @returns {Object} 報告一行 {quarterId, action, outcome, detail}
 */
function runUnavailableSubmissionNotify_(today, config, isDryRun) {
  const row = function (outcome, detail) { return { quarterId: '', action: 'UNAVAILABLE_SUBMISSIONS', outcome: outcome, detail: detail }; };
  if (getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_NOTIFY, true) === false) return row('SKIP', 'DISABLED');
  const A = COLUMNS.AUDIT_LOG;
  let lastAt = '';
  readSheet_(SHEETS.AUDIT_LOG).forEach(function (r) {
    if (r[A.ACTION] === 'UNAVAILABLE_SUBMISSION_NOTIFIED') lastAt = String(r[A.NEW_VALUE] || '').split('|')[0];
  });
  if (lastAt && lastAt.slice(0, 10) === today) return row('SKIP', 'ALREADY_TODAY');
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const pending = readPendingUnavailableSubmissions_(timezone);
  const fresh = pending.filter(function (s) { return !lastAt || s.submittedAt > lastAt; });
  if (fresh.length === 0) return row('SKIP', 'NOTHING_NEW');
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  // 第九十四輪批次 UC 組：收件人＝MAIL_ADMIN_NOTIFY＋UNAVAILABLE_CONFIRMER_EMAILS（去重）；信內有確認畫面的深連結
  const recipients = readUnavailableNotifyRecipients_(config);
  const firstQuarter = quarterIdForDateForUnavailable_(fresh[0].serviceDate, timezone);
  const text = buildUnavailableSubmissionNotifyText_(prefix, fresh, pending.length, buildUnavailableConfirmUrl_(firstQuarter));
  notifyAdmin_(text.subject, text.body, recipients.join(','), isDryRun);
  writeAuditLog_({
    action: 'UNAVAILABLE_SUBMISSION_NOTIFIED',
    targetSheet: SHEETS.UNAVAILABLE_SUBMISSIONS,
    targetKey: today,
    newValue: nowTimestamp_() + '|' + (isDryRun || getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false ? 'DRY_RUN' : 'SENT'),
    source: 'dailyAutomationCheck_',
    notes: '新申報 ' + fresh.length + ' 項；全部待確認 ' + pending.length + ' 項；收件人 ' + recipients.length + ' 個'
  });
  return row('SENT', (isDryRun ? '模擬' : '') + '通知幹事：' + fresh.length + ' 項新的義工申報');
}

/**
 * 第九十四輪批次 UC 組：新申報通知的收件人＝MAIL_ADMIN_NOTIFY＋UNAVAILABLE_CONFIRMER_EMAILS（去重，大小寫不分）。
 * @param {Object} config readConfig_()
 * @returns {string[]}
 */
function readUnavailableNotifyRecipients_(config) {
  const out = [];
  const seen = {};
  const add = function (raw) {
    (Array.isArray(raw) ? raw : String(raw || '').split(/[,;、\s]+/)).forEach(function (e) {
      const v = String(e || '').trim();
      if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; out.push(v); }
    });
  };
  add(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY]);
  add(getConfig_(CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS, []));
  return out;
}

/**
 * 第九十四輪批次 UC 組：確認畫面的深連結（WEBAPP_STEWARD_URL?view=unavailable-confirm&quarter=…）。沒有設定網址 ⇒ 空白。
 * @param {string} quarterId 季度（可以空白）
 * @returns {string}
 */
function buildUnavailableConfirmUrl_(quarterId) {
  const base = String(getConfig_(CONFIG_KEYS.WEBAPP_STEWARD_URL, '') || '').trim();
  if (!base) return '';
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'view=unavailable-confirm'
    + (quarterId ? '&quarter=' + encodeURIComponent(quarterId) : '');
}

/**
 * 某一日落在哪一季（Quarters 的 StartDate～EndDate）。找不到 ⇒ 空字串。
 * @param {string} dateStr yyyy-MM-dd
 * @param {string} timezone 時區
 * @returns {string}
 */
function quarterIdForDateForUnavailable_(dateStr, timezone) {
  const Q = COLUMNS.QUARTERS;
  const hit = readSheet_(SHEETS.QUARTERS).filter(function (r) {
    const start = toDateString_(r[Q.START_DATE], timezone);
    const end = toDateString_(r[Q.END_DATE], timezone);
    return start && end && start <= dateStr && dateStr <= end;
  })[0];
  return hit ? String(hit[Q.QUARTER_ID] || '').trim() : '';
}
