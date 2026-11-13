/**
 * 第一百零五輪批次 RD 組：三條新的排表規則（全部可配置；名字只在試算表）。
 *
 * ── 一、影音組合（工作表 PostTeams）──────────────────────────────
 * 一行一位組合成員：TeamID、PersonID、PostIDs（逗號分隔，他在組合週做的崗位）、PerMonth（每月幾次，預設 1）、
 * OutsideTeamLevel（HARD＝組合週以外不可以做這些崗位；SOFT＝盡量避免，人手不足才做並提醒）、Notes、Active。
 *   ・生成時先為每個組合選定「組合週」：每個月 PerMonth 個主日，所有成員都可以做（沒有申報不能服侍、崗位當日有設、
 *     沒有預先安排了領詩／司琴等同日不兼任崗位、不是協唱不可以做崗位的日子）；盡量避開詩班獻詩日和緊接上一次組合週。
 *     同一個種子（RANDOM_SEED）每次選同一批日子。
 *   ・組合週：這組的崗位由組合成員做（HARD 以外的情況做不到才排其他人並提醒：SEMI_POST_TEAM_WEEK）。
 *     有成員兼兩個或以上崗位的話，按崗位次序排最前的那一個（例如音響）可以交給名單上另一位：
 *     人手足夠就交出去，不夠才由組合成員兼任（SEMI_POST_TEAM_HANDOFF）。
 *   ・組合週以外：成員做這組的崗位 ⇒ HARD_POST_TEAM_OUTSIDE／SEMI_POST_TEAM_OUTSIDE（按該成員的 OutsideTeamLevel）。
 *   ・儲存、調整、核對（沒有「組合週」的計劃）：某主日所有成員都做着自己最少一個組合崗位 ⇒ 那一日是組合週；
 *     其他日子成員做組合崗位 ⇒ 組合週以外。
 *
 * ── 二、協唱（工作表 WorshipBackingSingers）─────────────────────
 * LeaderPersonID、SingerPersonID 或 SingerName（NameMapping 找不到的人寫名字；找不到的人本來就不會被排）、
 * Level（HARD／SOFT）、Notes、Active。某主日的領詩（Config WORSHIP_LEADER_POST_ID，預設 WORSHIP；
 * 預先安排或職事表）是 Leader ⇒ 那一日 Singer 不擔任其他崗位（HARD_BACKING_SINGER）／盡量不擔任（SEMI_BACKING_SINGER）。
 * 協唱只用來避開排表，不會在職事表、公開版、事奉人員名單或任何輸出出現（這個檔案以外沒有地方讀這張工作表）。
 *
 * ── 三、詩班獻詩日的例外（Config CHOIR_SUNDAY_ALLOWED）──────────
 * 「PersonID:PostID」逗號分隔：列出的人做列出的崗位不受 SEMI_CHOIR_SUNDAY 限制（不加分也不扣分）。見 ChoirRule.gs。
 *
 * 同日兼任：生成器本身容許同一人同日做幾個崗位（只有 Posts.MutexGroup 相同、或者 Config SAME_DAY_EXCLUSIVE_POST_IDS
 * 的崗位才不可以），所以音響＋錄影、PPT＋錄影不用另外設定。
 */

const POST_TEAMS_TITLES_TC = ['組合', 'PersonID', '崗位（逗號分隔）', '每月幾次', '組合週以外（HARD／SOFT）', '備註', '生效'];
const WORSHIP_BACKING_SINGERS_TITLES_TC = ['領詩 PersonID', '協唱 PersonID', '協唱名字（沒有 PersonID 時）', '級別（HARD／SOFT）', '備註', '生效'];
const POST_TEAM_LEVELS = { HARD: 'HARD', SOFT: 'SOFT' };

function postTeamsKeys_() {
  const T = COLUMNS.POST_TEAMS;
  return [T.TEAM_ID, T.PERSON_ID, T.POST_IDS, T.PER_MONTH, T.OUTSIDE_TEAM_LEVEL, T.NOTES, T.ACTIVE];
}

function worshipBackingSingersKeys_() {
  const W = COLUMNS.WORSHIP_BACKING_SINGERS;
  return [W.LEADER_PERSON_ID, W.SINGER_PERSON_ID, W.SINGER_NAME, W.LEVEL, W.NOTES, W.ACTIVE];
}

/**
 * 取得（必要時建立）有兩行標題（第 1 行中文、第 2 行欄名）的工作表。**會寫入**（只寫標題）。
 * @param {string} name 工作表名
 * @param {string[]} titles 第 1 行
 * @param {string[]} keys 第 2 行
 * @returns {{sheet: Object, created: boolean}}
 */
function ensureKeyedSheet_(name, titles, keys) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  let created = false;
  if (!sheet) { sheet = ss.insertSheet(name); created = true; }
  const existing = sheet.getLastColumn() > 0 ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  if (!keys.every(function (k, i) { return existing[i] === k; })) {
    sheet.getRange(1, 1, 1, titles.length).setValues([titles]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return { sheet: sheet, created: created };
}

/** 〔補建設定及範本〕：建立 PostTeams、WorshipBackingSingers（已有就只核對標題）。@returns {string[]} 新建立的工作表 */
function ensureRuleDataSheets_() {
  const out = [];
  if (ensureKeyedSheet_(SHEETS.POST_TEAMS, POST_TEAMS_TITLES_TC, postTeamsKeys_()).created) out.push(SHEETS.POST_TEAMS);
  if (ensureKeyedSheet_(SHEETS.WORSHIP_BACKING_SINGERS, WORSHIP_BACKING_SINGERS_TITLES_TC, worshipBackingSingersKeys_()).created) {
    out.push(SHEETS.WORSHIP_BACKING_SINGERS);
  }
  return out;
}

/** Active 欄：空白當生效；其他照 TRUE／FALSE。 */
function isRuleDataRowActive_(value) {
  if (value === '' || value === null || value === undefined) return true;
  return isTrueValue_(value);
}

/**
 * 正規化 PostTeams（純函式）。同一組同一人有幾行 ⇒ 崗位合併。
 * @param {Object[]} rows readSheet_() 的行
 * @returns {{list: Array<{teamId: string, perMonth: number, members: Array<{personId: string, postIds: string[], level: string}>}>}}
 */
function normalizePostTeams_(rows) {
  const T = COLUMNS.POST_TEAMS;
  const byId = {};
  const order = [];
  (rows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[T.ACTIVE])) return;
    const teamId = String(r[T.TEAM_ID] || '').trim();
    const personId = String(r[T.PERSON_ID] || '').trim();
    const postIds = splitList_(String(r[T.POST_IDS] || '').replace(/[，、;\s]+/g, ','));
    if (!teamId || !personId || postIds.length === 0) return;
    if (!byId[teamId]) { byId[teamId] = { teamId: teamId, perMonth: 0, members: [] }; order.push(teamId); }
    const team = byId[teamId];
    const n = Math.floor(Number(r[T.PER_MONTH]));
    if (!isNaN(n) && n >= 1) team.perMonth = Math.max(team.perMonth, n);
    const level = String(r[T.OUTSIDE_TEAM_LEVEL] || '').trim().toUpperCase() === POST_TEAM_LEVELS.SOFT ? POST_TEAM_LEVELS.SOFT : POST_TEAM_LEVELS.HARD;
    let m = team.members.filter(function (x) { return x.personId === personId; })[0];
    if (!m) { m = { personId: personId, postIds: [], level: level }; team.members.push(m); }
    postIds.forEach(function (p) { if (m.postIds.indexOf(p) === -1) m.postIds.push(p); });
    if (level === POST_TEAM_LEVELS.HARD) m.level = POST_TEAM_LEVELS.HARD;   // 同一人有 HARD 也有 SOFT ⇒ 取嚴格的
  });
  return { list: order.sort().map(function (id) { const t = byId[id]; if (!t.perMonth) t.perMonth = 1; return t; }) };
}

/**
 * 正規化 WorshipBackingSingers（純函式）。
 * @param {Object[]} rows
 * @returns {Array<{leaderId: string, singerId: string, singerName: string, level: string}>}
 */
function normalizeWorshipBackingSingers_(rows) {
  const W = COLUMNS.WORSHIP_BACKING_SINGERS;
  const out = [];
  (rows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[W.ACTIVE])) return;
    const leaderId = String(r[W.LEADER_PERSON_ID] || '').trim();
    const singerId = String(r[W.SINGER_PERSON_ID] || '').trim();
    const singerName = String(r[W.SINGER_NAME] || '').trim();
    if (!leaderId || (!singerId && !singerName)) return;
    out.push({ leaderId: leaderId, singerId: singerId, singerName: singerName,
      level: String(r[W.LEVEL] || '').trim().toUpperCase() === POST_TEAM_LEVELS.SOFT ? POST_TEAM_LEVELS.SOFT : POST_TEAM_LEVELS.HARD });
  });
  return out;
}

/**
 * Config CHOIR_SUNDAY_ALLOWED ⇒ {'PersonID:PostID': true}（純函式）。
 * @param {*} raw
 * @returns {Object.<string, boolean>}
 */
function parseChoirSundayAllowed_(raw) {
  const out = {};
  String(raw === null || raw === undefined ? '' : raw).split(/[,，、;\s]+/).forEach(function (t) {
    const parts = t.split(/[:：]/);
    if (parts.length !== 2) return;
    const personId = parts[0].trim();
    const postId = parts[1].trim();
    if (personId && postId) out[personId + ':' + postId] = true;
  });
  return out;
}

/**
 * 生成、儲存檢查、核對共用：三條新規則的資料。讀不到（工作表未建立等）⇒ 沒有資料＝沒有影響，並寫 log。
 * @returns {{teams: Object, backingSingers: Object[], worshipPostId: string, choirSundayAllowed: Object}}
 */
function readRuleExtrasContext_() {
  let teams = { list: [] };
  let singers = [];
  try { teams = normalizePostTeams_(readOptionalSheet_(SHEETS.POST_TEAMS)); } catch (err) { log_('WARN', '讀不到 PostTeams，當作沒有組合：' + err.message); }
  try { singers = normalizeWorshipBackingSingers_(readOptionalSheet_(SHEETS.WORSHIP_BACKING_SINGERS)); } catch (err) { log_('WARN', '讀不到 WorshipBackingSingers，當作沒有協唱：' + err.message); }
  return {
    teams: teams,
    backingSingers: singers,
    worshipPostId: String(getConfig_(CONFIG_KEYS.WORSHIP_LEADER_POST_ID, 'WORSHIP') || 'WORSHIP').trim(),
    choirSundayAllowed: parseChoirSundayAllowed_(getConfig_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, ''))
  };
}

/* ───────────────────────── 規則審閱表的摘要（只寫數目，不寫名字） ───────────────────────── */

/** 例如「有生效：1 組（2 人；音響、錄影、PPT 控制；每月 1 次）」。沒有 ⇒ ''。 */
function describeTeamsForReview_(teams, posts) {
  const list = (teams && teams.list) || [];
  if (list.length === 0) return '';
  return '有生效：' + list.length + ' 組（' + list.map(function (t) {
    const ids = [];
    t.members.forEach(function (m) { m.postIds.forEach(function (p) { if (ids.indexOf(p) === -1) ids.push(p); }); });
    return t.members.length + ' 人；' + ids.map(function (id) {
      const p = findPost_(posts || [], id);
      return p ? p.postNameTC : id;
    }).join('、') + '；每月 ' + t.perMonth + ' 次';
  }).join('／') + '）';
}

/** 例如「有生效：2 位領詩、4 位協唱（一定 3、盡量 1）」。沒有 ⇒ ''。 */
function describeSingersForReview_(singers) {
  const list = singers || [];
  if (list.length === 0) return '';
  const leaders = {};
  list.forEach(function (e) { leaders[e.leaderId] = true; });
  const hard = list.filter(function (e) { return e.level === POST_TEAM_LEVELS.HARD; }).length;
  return '有生效：' + Object.keys(leaders).length + ' 位領詩、' + list.length + ' 位協唱（一定 ' + hard + '、盡量 ' + (list.length - hard) + '）';
}

/* ───────────────────────── 人名（違規句子用） ───────────────────────── */

function ruleExtrasNameOf_(ctx, personId) {
  const p = ((ctx && ctx.peopleById) || {})[personId];
  return p ? (p.nameTC || p.name || personId) : personId;
}

function ruleExtrasPostNameOf_(ctx, postId) {
  const post = findPost_((ctx && ctx.posts) || [], postId);
  return post ? post.postNameTC : postId;
}

function teamPostsText_(ctx, postIds) {
  return postIds.map(function (id) { return ruleExtrasPostNameOf_(ctx, id); }).join('、');
}

/* ───────────────────────── 組合週（生成時的計劃） ───────────────────────── */

function stringSeed_(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 這一組可以「交出去」的崗位：第一位兼兩個或以上崗位的成員，他按崗位次序排最前的那一個。沒有 ⇒ ''。
 * @param {Object} team
 * @param {Object[]} posts 崗位（次序）
 * @returns {string}
 */
function teamHandoffPostId_(team, posts) {
  const idx = {};
  (posts || []).forEach(function (p, i) { idx[p.postId] = i; });
  for (let i = 0; i < team.members.length; i++) {
    const own = team.members[i].postIds.filter(function (id) { return idx[id] !== undefined; });
    if (own.length >= 2) {
      return own.slice().sort(function (a, b) { return idx[a] - idx[b]; })[0];
    }
  }
  return '';
}

/**
 * 那一日領詩的人（預先安排；生成時再加上職事表已排的）。
 * @param {Object} ctx context（preAssignments、worshipPostId）
 * @param {string} dateStr
 * @returns {string[]}
 */
function preassignedLeadersOn_(ctx, dateStr) {
  const pre = ctx.preAssignments || {};
  const out = [];
  Object.keys(pre).forEach(function (k) {
    const c = pre[k];
    if (c.serviceDate === dateStr && c.postId === ctx.worshipPostId && c.personId && out.indexOf(c.personId) === -1) out.push(c.personId);
  });
  return out;
}

/**
 * 協唱：這個人是不是那一日某位領詩的協唱。
 * @returns {?{leaderId: string, level: string}}
 */
function backingSingerEntryFor_(ctx, personId, leaders) {
  const list = (ctx.backingSingers || []).filter(function (e) {
    return e.singerId === personId && leaders.indexOf(e.leaderId) !== -1;
  });
  if (list.length === 0) return null;
  return list.filter(function (e) { return e.level === POST_TEAM_LEVELS.HARD; })[0] || list[0];
}

/**
 * 生成之前，為每個組合選定組合週。**純函式。** 同一個 RANDOM_SEED ⇒ 同一批日子。
 * @param {Object} context 生成器 context
 * @returns {{byTeam: Object.<string, string[]>, handoff: Object.<string, string>, missing: Object.<string, string[]>}}
 */
function planTeamWeeks_(context) {
  const plan = { byTeam: {}, handoff: {}, missing: {} };
  const teams = (context.teams && context.teams.list) || [];
  if (teams.length === 0) return plan;
  const rules = context.rules || {};
  const exclusive = context.sameDayExclusivePostIds || [];
  const pre = context.preAssignments || {};
  const months = [];
  const byMonth = {};
  context.serviceDates.forEach(function (sd) {
    const m = sd.serviceDate.slice(0, 7);
    if (!byMonth[m]) { byMonth[m] = []; months.push(m); }
    byMonth[m].push(sd);
  });
  teams.forEach(function (team) {
    plan.byTeam[team.teamId] = [];
    plan.missing[team.teamId] = [];
    const members = team.members.map(function (m) {
      return { personId: m.personId, level: m.level,
        postIds: m.postIds.filter(function (id) { return !!findPost_(context.posts, id); }) };
    }).filter(function (m) { return m.postIds.length > 0 && !!(context.peopleById || {})[m.personId]; });
    if (members.length === 0) return;
    plan.handoff[team.teamId] = teamHandoffPostId_({ members: members }, context.posts);
    const random = makeSeededRandom_(((context.randomSeed || 0) + stringSeed_(team.teamId)) >>> 0);
    const valid = function (sd) {
      const d = sd.serviceDate;
      const special = (context.specialByDate || {})[d] || { skipPostIds: [], lockPostIds: [] };
      const leaders = preassignedLeadersOn_(context, d);
      return members.every(function (m) {
        const hard = backingSingerEntryFor_(context, m.personId, leaders);
        if (hard && hard.level === POST_TEAM_LEVELS.HARD) return false;
        // 預先安排了同日不兼任崗位（領詩、司琴）而那不是他的組合崗位 ⇒ 這一日不可以
        const reserved = Object.keys(pre).some(function (k) {
          const c = pre[k];
          return c.serviceDate === d && c.personId === m.personId && exclusive.indexOf(c.postId) !== -1 && m.postIds.indexOf(c.postId) === -1;
        });
        if (reserved) return false;
        return m.postIds.every(function (postId) {
          const post = findPost_(context.posts, postId);
          if (getSkipReason_(post, sd, { skipPostIds: special.skipPostIds || [], lockPostIds: special.lockPostIds || [] }, rules)) return false;
          if ((special.lockPostIds || []).indexOf(postId) !== -1) return false;
          if (isPersonUnavailable_(m.personId, d, postId, context.unavailable || [])) return false;
          const preCell = pre[cellKey_(d, postId, 1)];
          return !(preCell && (preCell.personId || preCell.freeText) && preCell.personId !== m.personId);
        });
      });
    };
    const cost = function (sd, chosen) {
      const d = sd.serviceDate;
      let c = 0;
      const leaders = preassignedLeadersOn_(context, d);
      members.forEach(function (m) {
        m.postIds.forEach(function (postId) {
          if (isChoirSundayConflict_(context, m.personId, !!sd.choirSinging, d, postId)) c += 10;
        });
        if (backingSingerEntryFor_(context, m.personId, leaders)) c += 10;
      });
      const prev = chosen.length > 0 ? chosen[chosen.length - 1] : '';
      if (prev && daysBetween_(prev, d) <= 7) c += 5;   // 緊接上一次組合週 ⇒ 連續兩週同崗位
      return c;
    };
    months.forEach(function (m) {
      let cands = byMonth[m].filter(valid);
      for (let n = 0; n < team.perMonth; n++) {
        if (cands.length === 0) { plan.missing[team.teamId].push(m); break; }
        const chosen = plan.byTeam[team.teamId];
        const scored = cands.map(function (sd) { return { sd: sd, cost: cost(sd, chosen) }; });
        const best = Math.min.apply(null, scored.map(function (x) { return x.cost; }));
        const tied = scored.filter(function (x) { return x.cost === best; });
        const pick = tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))].sd;
        chosen.push(pick.serviceDate);
        cands = cands.filter(function (sd) { return sd.serviceDate !== pick.serviceDate; });
      }
    });
    plan.byTeam[team.teamId].sort();
  });
  return plan;
}

/* ───────────────────────── 生成時的檢查 ───────────────────────── */

/**
 * 生成器（evaluateViolations_）：組合、協唱兩條規則的違規。**純函式。**
 * @param {string} personId 候選人
 * @param {Object} state 排表狀態（context、post、serviceDate、weekByPost、weekByPerson、teamPlan）
 * @returns {Object[]} makeViolation_() 的違規物件
 */
function evaluateTeamAndSingerViolations_(personId, state) {
  const ctx = state.context;
  const rules = ctx.rules || {};
  const post = state.post;
  const d = state.serviceDate.serviceDate;
  const out = [];
  const plan = state.teamPlan;
  const name = ruleExtrasNameOf_(ctx, personId);
  if (plan) {
    ((ctx.teams && ctx.teams.list) || []).forEach(function (team) {
      const weeks = plan.byTeam[team.teamId] || [];
      const onTeamDate = weeks.indexOf(d) !== -1;
      const member = team.members.filter(function (m) { return m.personId === personId; })[0];
      if (member && member.postIds.indexOf(post.postId) !== -1) {
        if (!onTeamDate) {
          const id = member.level === POST_TEAM_LEVELS.HARD ? RULE_IDS.TEAM_OUTSIDE_HARD : RULE_IDS.TEAM_OUTSIDE_SOFT;
          if (isRuleEnabledAllowingDefault_(rules, id)) {
            out.push(makeViolation_(rules, id, buildTeamOutsideReason_(name, team, member, post.postNameTC, d, ctx)));
          }
        } else if (post.postId === plan.handoff[team.teamId] && isRuleEnabledAllowingDefault_(rules, RULE_IDS.TEAM_HANDOFF)) {
          out.push(makeViolation_(rules, RULE_IDS.TEAM_HANDOFF,
            sameDayHumanDate_(d) + '是組合週，' + post.postNameTC + '人手足夠時交給名單上另一位；這一次由組合成員' + name + '兼任。'));
        }
      } else if (onTeamDate && post.postId !== plan.handoff[team.teamId] && isRuleEnabledAllowingDefault_(rules, RULE_IDS.TEAM_WEEK)) {
        const holder = team.members.filter(function (m) { return m.postIds.indexOf(post.postId) !== -1; })[0];
        if (holder && (state.weekByPost[post.postId] || []).indexOf(holder.personId) === -1) {
          out.push(makeViolation_(rules, RULE_IDS.TEAM_WEEK,
            sameDayHumanDate_(d) + '是組合週，' + post.postNameTC + '本來由組合成員' + ruleExtrasNameOf_(ctx, holder.personId) + '做。'));
        }
      }
    });
  }
  // 協唱
  const singers = ctx.backingSingers || [];
  if (singers.length > 0) {
    const worshipId = ctx.worshipPostId;
    if (post.postId !== worshipId) {
      const leaders = (state.weekByPost[worshipId] || []).concat(preassignedLeadersOn_(ctx, d));
      const entry = backingSingerEntryFor_(ctx, personId, leaders);
      if (entry) {
        const id = entry.level === POST_TEAM_LEVELS.HARD ? RULE_IDS.BACKING_SINGER_HARD : RULE_IDS.BACKING_SINGER_SOFT;
        if (isRuleEnabledAllowingDefault_(rules, id)) {
          out.push(makeViolation_(rules, id, buildBackingSingerReason_(name, ruleExtrasNameOf_(ctx, entry.leaderId), d, entry.level)));
        }
      }
    } else {
      singers.filter(function (e) { return e.leaderId === personId && e.singerId; }).forEach(function (e) {
        if ((state.weekByPerson[e.singerId] || []).length === 0) return;
        const id = e.level === POST_TEAM_LEVELS.HARD ? RULE_IDS.BACKING_SINGER_HARD : RULE_IDS.BACKING_SINGER_SOFT;
        if (!isRuleEnabledAllowingDefault_(rules, id)) return;
        out.push(makeViolation_(rules, id, '如果' + name + '領詩，他的協唱' + ruleExtrasNameOf_(ctx, e.singerId) + sameDayHumanDate_(d) + '已經有其他崗位。'));
      });
    }
  }
  return out;
}

function buildTeamOutsideReason_(name, team, member, postName, dateStr, ctx) {
  return name + '是組合「' + team.teamId + '」的成員（' + teamPostsText_(ctx, member.postIds) + '，每月 ' + team.perMonth + ' 次一起服侍），'
    + sameDayHumanDate_(dateStr) + '不是組合週，' + (member.level === POST_TEAM_LEVELS.HARD ? '不可以' : '盡量不') + '做' + postName + '。';
}

function buildBackingSingerReason_(name, leaderName, dateStr, level) {
  return name + '是' + leaderName + '的協唱，' + sameDayHumanDate_(dateStr) + leaderName + '領詩，'
    + (level === POST_TEAM_LEVELS.HARD ? '不可以' : '盡量不') + '擔任其他崗位。';
}

/* ───────────────────────── 儲存、調整、核對的檢查 ───────────────────────── */

/**
 * 一份派工狀態（全部格）違反組合、協唱規則的格。**純函式。**
 * 組合週＝那一日所有成員都做着自己最少一個組合崗位。
 * @param {Object[]} cells {serviceDate, postId, slotIndex, personId, ...}
 * @param {Object} ctx context（teams、backingSingers、worshipPostId、posts、peopleById、rules）
 * @returns {Array<{cell: Object, ruleId: string, reason: string}>}
 */
function findTeamAndSingerConflicts_(cells, ctx) {
  const out = [];
  if (!ctx) return out;
  const rules = ctx.rules || {};
  const byDatePerson = {};
  (cells || []).forEach(function (c) {
    if (!c || !c.personId) return;
    const k = c.serviceDate + '|' + c.personId;
    (byDatePerson[k] = byDatePerson[k] || []).push(c);
  });
  const dates = {};
  (cells || []).forEach(function (c) { if (c && c.serviceDate) dates[c.serviceDate] = true; });
  const dateList = Object.keys(dates).sort();
  ((ctx.teams && ctx.teams.list) || []).forEach(function (team) {
    dateList.forEach(function (d) {
      const holds = function (m) {
        return (byDatePerson[d + '|' + m.personId] || []).some(function (c) { return m.postIds.indexOf(c.postId) !== -1; });
      };
      if (team.members.every(holds)) return;   // 組合週
      team.members.forEach(function (m) {
        (byDatePerson[d + '|' + m.personId] || []).forEach(function (c) {
          if (m.postIds.indexOf(c.postId) === -1) return;
          const id = m.level === POST_TEAM_LEVELS.HARD ? RULE_IDS.TEAM_OUTSIDE_HARD : RULE_IDS.TEAM_OUTSIDE_SOFT;
          if (!isRuleEnabledAllowingDefault_(rules, id)) return;
          out.push({ cell: c, ruleId: id, reason: buildTeamOutsideReason_(ruleExtrasNameOf_(ctx, m.personId), team, m,
            ruleExtrasPostNameOf_(ctx, c.postId), d, ctx) });
        });
      });
    });
  });
  const singers = ctx.backingSingers || [];
  if (singers.length > 0) {
    const worshipId = ctx.worshipPostId || 'WORSHIP';
    const leadersOn = {};
    (cells || []).forEach(function (c) {
      if (c && c.personId && c.postId === worshipId) (leadersOn[c.serviceDate] = leadersOn[c.serviceDate] || []).push(c.personId);
    });
    Object.keys(leadersOn).sort().forEach(function (d) {
      singers.forEach(function (e) {
        if (!e.singerId || leadersOn[d].indexOf(e.leaderId) === -1) return;
        const id = e.level === POST_TEAM_LEVELS.HARD ? RULE_IDS.BACKING_SINGER_HARD : RULE_IDS.BACKING_SINGER_SOFT;
        if (!isRuleEnabledAllowingDefault_(rules, id)) return;
        (byDatePerson[d + '|' + e.singerId] || []).forEach(function (c) {
          if (c.postId === worshipId) return;
          out.push({ cell: c, ruleId: id, reason: buildBackingSingerReason_(ruleExtrasNameOf_(ctx, e.singerId),
            ruleExtrasNameOf_(ctx, e.leaderId), d, e.level) });
        });
      });
    });
  }
  return out;
}

/**
 * 補空格（人手網絡）之後，組合、協唱的違規有沒有變多。**純函式。**
 * @returns {boolean} true＝沒有變多
 */
function teamAndSingerNotWorse_(ctx, before, after) {
  return findTeamAndSingerConflicts_(after, ctx).length <= findTeamAndSingerConflicts_(before, ctx).length;
}
