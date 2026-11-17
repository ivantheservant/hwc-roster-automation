/**
 * 第一百一十一輪批次 SE 組：影音組合（PostTeams）、協唱（WorshipBackingSingers）、
 * 詩班獻詩日例外（Config CHOIR_SUNDAY_ALLOWED）——資料核對，以及找不到組合週時的提示。
 *
 * 背景：這三份資料由人手輸入 PersonID／PostID。`normalizePostTeams_()` 等只整理格式，
 * `planTeamWeeks_()` 把找不到的人或崗位**靜靜略過**——打錯一個字，「一定要遵守」的規則就不生效，
 * 而幹事不會知道。這裏逐行核對，回傳有問題的行，給〔上線前檢查〕、「這一季還要做的」、
 * 生成確認窗用（有問題**不擋生成**，只寫明哪一條規則這一次不會生效）。
 *
 * 核對函式 `validateRuleExtrasData_()` 是純函式；`checkRuleExtrasData_()` 讀表後呼叫它。
 * 回傳格式（穩定；設定畫面儲存前亦可以直接用）：
 *   {
 *     ok: boolean,                         // 沒有任何問題
 *     counts: {teamRows, singerRows, choirEntries},   // 核對了幾多行／項（只計生效的行）
 *     issues: [{
 *       source: 'PostTeams' | 'WorshipBackingSingers' | 'CHOIR_SUNDAY_ALLOWED',
 *       rule: '影音組合' | '協唱' | '詩班獻詩日例外',
 *       row: number,                       // 工作表行號（Config 那一項 ⇒ 第幾項，由 1 起）
 *       field: string,                     // 欄名（例如 PersonID、PostIDs、PerMonth）
 *       code: RULE_EXTRAS_ISSUE.*,
 *       message: string                    // 給幹事看的一句（用名字及崗位名稱，不用 ID；找不到的才寫 ID）
 *     }],
 *     lines: string[]                      // 每項問題一句（已包括來源、行號及「這一次不會生效」）
 *   }
 */

/** 問題類別。 */
const RULE_EXTRAS_ISSUE = {
  PERSON_MISSING: 'PERSON_MISSING',       // PersonID 不在名單（NameMapping）
  PERSON_INACTIVE: 'PERSON_INACTIVE',     // 名單上已停用
  POST_MISSING: 'POST_MISSING',           // PostID 不在 Posts
  POST_INACTIVE: 'POST_INACTIVE',         // 崗位已停用
  NOT_ON_POST_LIST: 'NOT_ON_POST_LIST',   // 不在該崗位的事奉人員名單（Eligibility）
  PER_MONTH_INVALID: 'PER_MONTH_INVALID', // 每月幾次不是 1 或以上的整數
  LEVEL_INVALID: 'LEVEL_INVALID',         // 級別不是 HARD／SOFT
  INCOMPLETE: 'INCOMPLETE',               // 必填格空白
  FORMAT_INVALID: 'FORMAT_INVALID'        // Config 一項不是「PersonID:PostID」
};

/** 來源 ⇒ 規則名稱。 */
const RULE_EXTRAS_RULE_NAMES = {
  PostTeams: '影音組合',
  WorshipBackingSingers: '協唱',
  CHOIR_SUNDAY_ALLOWED: '詩班獻詩日例外'
};

/**
 * 核對三份資料。**純函式。**
 * @param {{teamRows: Object[], singerRows: Object[], choirRaw: *, people: Object.<string, {name: string, active: boolean}>,
 *   posts: Object.<string, {name: string, active: boolean}>, eligible: Object.<string, boolean>, worshipPostId: string}} input
 *   teamRows／singerRows 每行要有 `__row`（工作表行號）；eligible 鍵是「PersonID:PostID」
 * @returns {Object} 見檔頭
 */
function validateRuleExtrasData_(input) {
  const inp = input || {};
  const people = inp.people || {};
  const posts = inp.posts || {};
  const eligible = inp.eligible || {};
  const issues = [];
  const counts = { teamRows: 0, singerRows: 0, choirEntries: 0 };
  const add = function (source, row, field, code, message) {
    issues.push({ source: source, rule: RULE_EXTRAS_RULE_NAMES[source], row: row, field: field, code: code, message: message });
  };
  const nameOf = function (id) { return (people[id] && people[id].name) || id; };
  const postNameOf = function (id) { return (posts[id] && posts[id].name) || id; };
  // 人：存在而且啟用。回傳 true＝沒有問題
  const checkPerson = function (source, row, field, id) {
    if (!people[id]) { add(source, row, field, RULE_EXTRAS_ISSUE.PERSON_MISSING, 'PersonID「' + id + '」不在名單上'); return false; }
    if (!people[id].active) { add(source, row, field, RULE_EXTRAS_ISSUE.PERSON_INACTIVE, '「' + nameOf(id) + '」在名單上已停用'); return false; }
    return true;
  };
  const checkPost = function (source, row, field, id) {
    if (!posts[id]) { add(source, row, field, RULE_EXTRAS_ISSUE.POST_MISSING, '崗位「' + id + '」不存在'); return false; }
    if (!posts[id].active) { add(source, row, field, RULE_EXTRAS_ISSUE.POST_INACTIVE, '崗位「' + postNameOf(id) + '」已停用'); return false; }
    return true;
  };
  const checkOnList = function (source, row, field, personId, postId) {
    if (eligible[personId + ':' + postId]) return true;
    add(source, row, field, RULE_EXTRAS_ISSUE.NOT_ON_POST_LIST, '「' + nameOf(personId) + '」不在「' + postNameOf(postId) + '」的事奉人員名單上');
    return false;
  };
  const levelOk = function (v) {
    const s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
    return s === '' || s === POST_TEAM_LEVELS.HARD || s === POST_TEAM_LEVELS.SOFT;
  };

  const T = COLUMNS.POST_TEAMS;
  (inp.teamRows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[T.ACTIVE])) return;
    counts.teamRows++;
    const row = r.__row;
    const src = 'PostTeams';
    const teamId = String(r[T.TEAM_ID] || '').trim();
    const personId = String(r[T.PERSON_ID] || '').trim();
    const postIds = splitList_(String(r[T.POST_IDS] || '').replace(/[，、;\s]+/g, ','));
    if (!teamId) add(src, row, T.TEAM_ID, RULE_EXTRAS_ISSUE.INCOMPLETE, '沒有填組合名稱');
    if (!personId) add(src, row, T.PERSON_ID, RULE_EXTRAS_ISSUE.INCOMPLETE, '沒有填 PersonID');
    if (postIds.length === 0) add(src, row, T.POST_IDS, RULE_EXTRAS_ISSUE.INCOMPLETE, '沒有填崗位');
    const personOk = personId ? checkPerson(src, row, T.PERSON_ID, personId) : false;
    postIds.forEach(function (postId) {
      if (checkPost(src, row, T.POST_IDS, postId) && personOk) checkOnList(src, row, T.POST_IDS, personId, postId);
    });
    const pm = r[T.PER_MONTH];
    if (!(pm === '' || pm === null || pm === undefined)) {
      const n = Number(pm);
      if (!(Math.floor(n) === n && n >= 1)) add(src, row, T.PER_MONTH, RULE_EXTRAS_ISSUE.PER_MONTH_INVALID, '每月幾次「' + pm + '」不是 1 或以上的整數（當作 1）');
    }
    if (!levelOk(r[T.OUTSIDE_TEAM_LEVEL])) {
      add(src, row, T.OUTSIDE_TEAM_LEVEL, RULE_EXTRAS_ISSUE.LEVEL_INVALID, '組合週以外「' + r[T.OUTSIDE_TEAM_LEVEL] + '」不是 HARD 或 SOFT（當作 HARD）');
    }
  });

  const W = COLUMNS.WORSHIP_BACKING_SINGERS;
  const worshipPostId = String(inp.worshipPostId || 'WORSHIP').trim();
  (inp.singerRows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[W.ACTIVE])) return;
    counts.singerRows++;
    const row = r.__row;
    const src = 'WorshipBackingSingers';
    const leaderId = String(r[W.LEADER_PERSON_ID] || '').trim();
    const singerId = String(r[W.SINGER_PERSON_ID] || '').trim();
    const singerName = String(r[W.SINGER_NAME] || '').trim();
    if (!leaderId) add(src, row, W.LEADER_PERSON_ID, RULE_EXTRAS_ISSUE.INCOMPLETE, '沒有填領詩 PersonID');
    else if (checkPerson(src, row, W.LEADER_PERSON_ID, leaderId) && posts[worshipPostId]) checkOnList(src, row, W.LEADER_PERSON_ID, leaderId, worshipPostId);
    if (!singerId && !singerName) add(src, row, W.SINGER_PERSON_ID, RULE_EXTRAS_ISSUE.INCOMPLETE, '沒有填協唱 PersonID 或名字');
    else if (singerId) checkPerson(src, row, W.SINGER_PERSON_ID, singerId);
    if (!levelOk(r[W.LEVEL])) add(src, row, W.LEVEL, RULE_EXTRAS_ISSUE.LEVEL_INVALID, '級別「' + r[W.LEVEL] + '」不是 HARD 或 SOFT（當作 HARD）');
  });

  const choirTokens = String(inp.choirRaw === null || inp.choirRaw === undefined ? '' : inp.choirRaw)
    .split(/[,，、;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  choirTokens.forEach(function (tok, i) {
    counts.choirEntries++;
    const src = 'CHOIR_SUNDAY_ALLOWED';
    const parts = tok.split(/[:：]/);
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      add(src, i + 1, 'CHOIR_SUNDAY_ALLOWED', RULE_EXTRAS_ISSUE.FORMAT_INVALID, '「' + tok + '」不是「PersonID:PostID」的格式');
      return;
    }
    const personId = parts[0].trim();
    const postId = parts[1].trim();
    const personOk = checkPerson(src, i + 1, 'CHOIR_SUNDAY_ALLOWED', personId);
    if (checkPost(src, i + 1, 'CHOIR_SUNDAY_ALLOWED', postId) && personOk) checkOnList(src, i + 1, 'CHOIR_SUNDAY_ALLOWED', personId, postId);
  });

  return { ok: issues.length === 0, counts: counts, issues: issues, lines: issues.map(describeRuleExtrasIssue_) };
}

/**
 * 一項問題 ⇒ 一句。**純函式。**
 * @param {Object} issue
 * @returns {string}
 */
function describeRuleExtrasIssue_(issue) {
  const where = issue.source === 'CHOIR_SUNDAY_ALLOWED'
    ? 'Config CHOIR_SUNDAY_ALLOWED 第 ' + issue.row + ' 項'
    : issue.source + ' 第 ' + issue.row + ' 行';
  const soft = issue.code === RULE_EXTRAS_ISSUE.PER_MONTH_INVALID || issue.code === RULE_EXTRAS_ISSUE.LEVEL_INVALID;
  return where + '：' + issue.message + (soft ? '' : '——這一行的「' + issue.rule + '」規則這一次不會生效');
}

/**
 * 讀工作表，保留工作表行號（`__row`）。第 2 行是標題，第 3 行起是資料；空行略過。工作表不存在 ⇒ []。
 * @param {string} sheetName
 * @returns {Object[]}
 */
function readSheetRowsWithNumbers_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) return [];
  const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const out = [];
  data.forEach(function (vals, i) {
    const obj = { __row: i + 3 };
    let empty = true;
    headers.forEach(function (h, c) {
      if (!h) return;
      obj[h] = vals[c];
      if (vals[c] !== '' && vals[c] !== null) empty = false;
    });
    if (!empty) out.push(obj);
  });
  return out;
}

/**
 * 讀表後核對三份資料。讀不到 ⇒ null（提示不可以變成阻擋）。
 * @returns {?Object} `validateRuleExtrasData_()` 的結果
 */
function checkRuleExtrasData_() {
  try {
    const N = COLUMNS.NAME_MAPPING;
    const P = COLUMNS.POSTS;
    const E = COLUMNS.ELIGIBILITY;
    const people = {};
    readSheet_(SHEETS.NAME_MAPPING).forEach(function (r) {
      const id = String(r[N.PERSON_ID] || '').trim();
      if (id) people[id] = { name: String(r[N.NAME_TC] || '').trim() || id, active: isTrueValue_(r[N.ACTIVE]) };
    });
    const posts = {};
    readSheet_(SHEETS.POSTS).forEach(function (r) {
      const id = String(r[P.POST_ID] || '').trim();
      if (id) posts[id] = { name: String(r[P.POST_NAME_TC] || '').trim() || id, active: isTrueValue_(r[P.ACTIVE]) };
    });
    const eligible = {};
    readOptionalSheet_(SHEETS.ELIGIBILITY).forEach(function (r) {
      if (!isTrueValue_(r[E.ACTIVE])) return;
      if (r[E.ELIGIBLE] !== '' && r[E.ELIGIBLE] !== undefined && !isTrueValue_(r[E.ELIGIBLE])) return;
      eligible[String(r[E.PERSON_ID] || '').trim() + ':' + String(r[E.POST_ID] || '').trim()] = true;
    });
    return validateRuleExtrasData_({
      teamRows: readSheetRowsWithNumbers_(SHEETS.POST_TEAMS),
      singerRows: readSheetRowsWithNumbers_(SHEETS.WORSHIP_BACKING_SINGERS),
      choirRaw: getConfig_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, ''),
      people: people, posts: posts, eligible: eligible,
      worshipPostId: String(getConfig_(CONFIG_KEYS.WORSHIP_LEADER_POST_ID, 'WORSHIP') || 'WORSHIP')
    });
  } catch (err) {
    log_('WARN', '核對影音組合、協唱、詩班獻詩日例外失敗：' + err.message);
    return null;
  }
}

/**
 * 「這一季還要做的」、生成確認窗用的一句。沒有問題 ⇒ ''。**純函式。**
 * @param {?Object} check `validateRuleExtrasData_()` 的結果
 * @returns {string}
 */
function describeRuleExtrasCheckNote_(check) {
  if (!check || check.ok) return '';
  const rules = [];
  check.issues.forEach(function (i) { if (rules.indexOf(i.rule) === -1) rules.push(i.rule); });
  return rules.join('、') + '的資料有 ' + check.issues.length + ' 項問題（有問題的那幾行這一次不會生效）：'
    + check.lines.join('；');
}

/* ───────────────────────── 找不到組合週 ───────────────────────── */

/** 找不到組合週的原因類別 ⇒ 字眼。 */
const TEAM_WEEK_BLOCK_LABELS = {
  UNAVAILABLE: '有成員不能服侍',
  PREASSIGNED: '已預先安排領詩或司琴',
  COMBINED: '合堂或這一週不用排',
  BACKING: '要做協唱',
  OTHER: '其他人已預先安排'
};

/**
 * 組合週計劃裏找不到組合週的月份 ⇒ 每組一句。**純函式。**
 * 例如「影音組合 A：2028年8月找不到全組都可以服侍的主日（有成員不能服侍 3 個主日、合堂或這一週不用排 1 個主日）」。
 * @param {Object} teamPlan `planTeamWeeks_()` 的結果（要有 missingDetail）
 * @returns {string[]}
 */
function describeTeamWeekGaps_(teamPlan) {
  const detail = (teamPlan && teamPlan.missingDetail) || {};
  const out = [];
  Object.keys(detail).sort().forEach(function (teamId) {
    (detail[teamId] || []).forEach(function (m) {
      const parts = Object.keys(TEAM_WEEK_BLOCK_LABELS).filter(function (k) { return (m.reasons || {})[k] > 0; })
        .map(function (k) { return TEAM_WEEK_BLOCK_LABELS[k] + ' ' + m.reasons[k] + ' 個主日'; });
      const ym = String(m.month || '');
      out.push('影音組合 ' + teamId + '：' + ym.slice(0, 4) + '年' + Number(ym.slice(5, 7)) + '月找不到全組都可以服侍的主日'
        + (parts.length ? '（' + parts.join('、') + '）' : '') + '，那個月組合週以外「一定不做」的成員不會排到組合的崗位');
    });
  });
  return out;
}

/** Script Properties 鍵：各季最近一次生成時找不到組合週的提示（狀態卡用）。 */
const TEAM_WEEK_GAPS_PROP_KEY = 'TEAM_WEEK_GAPS';

/**
 * 生成之後記下這一季的提示（狀態卡用）。失敗只寫 log。
 * @param {string} quarterId
 * @param {string[]} lines
 * @returns {void}
 */
function saveTeamWeekGaps_(quarterId, lines) {
  try {
    const store = PropertiesService.getScriptProperties();
    let all = {};
    try { all = JSON.parse(store.getProperty(TEAM_WEEK_GAPS_PROP_KEY) || '{}') || {}; } catch (e) { all = {}; }
    if (lines && lines.length) all[quarterId] = lines; else delete all[quarterId];
    store.setProperty(TEAM_WEEK_GAPS_PROP_KEY, JSON.stringify(all));
  } catch (err) {
    log_('WARN', '記不到找不到組合週的提示：' + err.message);
  }
}

/**
 * @param {string} quarterId
 * @returns {string[]} 沒有 ⇒ []
 */
function readTeamWeekGaps_(quarterId) {
  try {
    const all = JSON.parse(PropertiesService.getScriptProperties().getProperty(TEAM_WEEK_GAPS_PROP_KEY) || '{}') || {};
    return Array.isArray(all[quarterId]) ? all[quarterId] : [];
  } catch (err) {
    return [];
  }
}
