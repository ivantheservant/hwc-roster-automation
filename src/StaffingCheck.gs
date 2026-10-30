/**
 * 第八十五輪批次 LD 組：每人每季崗位上限、人手檢查、生成不可以多留空。
 *
 * Ivan 的例子：「讀經每人只可讀一次（一季要十三人才夠），但事奉表上只有五人，系統會怎樣排？」
 *
 * ── 人手檢查（只計硬規則）───────────────────────────────────────
 * 用最大流量算出**最少一定會留空的格數**：
 *
 *   來源 → 人（每人每季總次數上限，只在 SOFT_MAX_PER_QUARTER 被 RuleSettings 設成 HARD 時才有）
 *        → 人×崗位（Posts.MaxPerPersonPerQuarter）
 *        → 人×主日×互斥組（HARD_MUTEX_GROUP：同週同組最多一格）
 *        → 主日×崗位（同週同崗位不可重複時每人最多一格）
 *        → 終點（SlotCount）
 *
 * 人×主日×崗位這一條邊只在那個人那一日合資格時才有：名單（含「堂委」「執事」按當日展開）、
 * NameMapping.Active、身分要求（Posts.RequiredRoles）、暫時不做某崗位、不能服侍的日期。
 * 不計準硬規則、軟規則和排表偏好（這些可以違反並提醒）。
 *
 * ⚠️ 同一個互斥組裏有崗位設了每人上限時，兩種限制交叉，不是單一流量網絡可以準確表達——
 * 這時互斥限制放寬計算，結果是「最少留空數」的下限（仍然是「至少 N 格會留空」），並寫明。
 *
 * ── 生成不可以多留空 ────────────────────────────────────────────
 * 生成（buildRoster_）和〔請系統幫我調整〕先照舊用貪心法；之後以那個結果為起點跑同一個網絡，
 * 用增廣路徑補空格（只改動增廣路徑上的格），令留空數等於人手檢查算出的最少留空數。
 */

const STAFFING_REASON = {
  NO_POOL: 'NO_POOL',
  ALL_UNAVAILABLE: 'ALL_UNAVAILABLE',
  ROLE: 'ROLE',
  EXCLUDED: 'EXCLUDED',
  MIXED_FILTERS: 'MIXED_FILTERS',
  POST_MAX: 'POST_MAX',
  MUTEX: 'MUTEX',
  QUARTER_MAX: 'QUARTER_MAX',
  DISTINCT: 'DISTINCT'
};

const STAFFING_REASON_TEXT = {
  NO_POOL: '名單上沒有人',
  ALL_UNAVAILABLE: '名單上的人全部不能服侍',
  ROLE: '名單上的人那一日都沒有所需身分',
  EXCLUDED: '名單上的人都暫時不做這個崗位',
  MIXED_FILTERS: '名單上的人那一日都排不到（不能服侍、身分要求或暫時不做）',
  POST_MAX: '每人每季上限',
  MUTEX: '同週不可兼任',
  QUARTER_MAX: '每人每季總次數上限',
  DISTINCT: '同一崗位同週不可重複'
};

/** 人手檢查有計入的硬規則（其餘被設成 HARD 的規則會列在 notes）。 */
const STAFFING_MODELED_RULE_IDS = [
  'HARD_ELIGIBILITY', 'HARD_UNAVAILABLE', 'HARD_DISTINCT_SLOT', 'HARD_MUTEX_GROUP', 'HARD_ROLE_REQUIRED',
  'HARD_PERSON_POST_EXCLUDED', 'HARD_POST_MAX_PER_PERSON', 'HARD_COMMUNION_FIRST_SUNDAY',
  'HARD_NO_AUTO_PREACHER', 'HARD_SPECIAL_SUNDAY_SKIP', 'SOFT_MAX_PER_QUARTER'
];

/**
 * HARD_POST_MAX_PER_PERSON 的違規訊息（生成、檢查我的改動、儲存、核對職事表共用）。
 * @param {Object} post 崗位（要有 postNameTC）
 * @param {number} used 這一季已排次數
 * @param {number} limit 上限
 * @returns {string}
 */
function buildPostMaxPerPersonReason_(post, used, limit) {
  return (post && post.postNameTC ? post.postNameTC : '這個崗位') + '每人每季最多 ' + limit
    + ' 次，此人這一季' + (used > limit ? '共排了 ' + used + ' 次' : '已排 ' + used + ' 次') + '。';
}

/**
 * 這個崗位的每人每季上限是否生效。
 * @param {Object} rules RuleSettings 對照表
 * @param {Object} post 崗位
 * @returns {?number} 上限；不限 ⇒ null
 */
function postMaxPerPersonOf_(rules, post) {
  if (!post || post.maxPerPersonPerQuarter === null || post.maxPerPersonPerQuarter === undefined) return null;
  if (!isRuleEnabledAllowingDefault_(rules, RULE_IDS.POST_MAX_PER_PERSON)) return null;
  return Number(post.maxPerPersonPerQuarter);
}

/**
 * 規則是否被 RuleSettings 設成 HARD（而且開着）。
 * @param {Object} rules RuleSettings 對照表
 * @param {string} ruleId 規則
 * @returns {boolean}
 */
function isRuleSetHard_(rules, ruleId) {
  const rule = rules[ruleId];
  if (!rule || !isTrueValue_(rule[COLUMNS.RULE_SETTINGS.ENABLED])) return false;
  return String(rule[COLUMNS.RULE_SETTINGS.LEVEL] || '').toUpperCase() === RULE_LEVELS.HARD;
}

// ─────────────────────────────────────────────────────────────────────
// 最大流量（Dinic）
// ─────────────────────────────────────────────────────────────────────

function newFlowGraph_() {
  return { to: [], cap: [], head: [], next: [], nodeCount: 0 };
}
function flowAddNode_(g) { g.head.push(-1); return g.nodeCount++; }
function flowAddEdge_(g, u, v, c) {
  g.to.push(v); g.cap.push(c); g.next.push(g.head[u]); g.head[u] = g.to.length - 1;
  g.to.push(u); g.cap.push(0); g.next.push(g.head[v]); g.head[v] = g.to.length - 1;
  return g.to.length - 2;
}
/** 沿一條固定路徑推一個單位（起點方案用）；任何一段不夠 ⇒ 不推，回傳 false。 */
function flowPushPath_(g, edges) {
  for (let i = 0; i < edges.length; i++) if (g.cap[edges[i]] < 1) return false;
  edges.forEach(function (e) { g.cap[e] -= 1; g.cap[e ^ 1] += 1; });
  return true;
}
function flowMax_(g, s, t) {
  let total = 0;
  const level = new Array(g.nodeCount);
  const it = new Array(g.nodeCount);
  const bfs = function () {
    for (let i = 0; i < g.nodeCount; i++) level[i] = -1;
    const q = [s]; level[s] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (let e = g.head[u]; e !== -1; e = g.next[e]) {
        if (g.cap[e] > 0 && level[g.to[e]] < 0) { level[g.to[e]] = level[u] + 1; q.push(g.to[e]); }
      }
    }
    return level[t] >= 0;
  };
  const dfs = function (u, f) {
    if (u === t) return f;
    for (; it[u] !== -1; it[u] = g.next[it[u]]) {
      const e = it[u]; const v = g.to[e];
      if (g.cap[e] > 0 && level[v] === level[u] + 1) {
        const d = dfs(v, Math.min(f, g.cap[e]));
        if (d > 0) { g.cap[e] -= d; g.cap[e ^ 1] += d; return d; }
      }
    }
    return 0;
  };
  while (bfs()) {
    for (let i = 0; i < g.nodeCount; i++) it[i] = g.head[i];
    let f;
    while ((f = dfs(s, Infinity)) > 0) total += f;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────
// 模型
// ─────────────────────────────────────────────────────────────────────

/**
 * 這一格（主日×崗位）的合資格候選人，以及被哪一條硬規則篩走。**純函式。**
 * @param {Object} ctx 規則 context（posts、rules、eligibility、roles、personPostExclusions、unavailable、peopleById）
 * @param {Object} post 崗位
 * @param {string} dateStr 主日
 * @returns {{pool: string[], candidates: string[], removed: Object.<string, number>}}
 */
function staffingCandidatesOn_(ctx, post, dateStr) {
  const rules = ctx.rules;
  const pool = ((ctx.eligibility.byPost || {})[post.postId] || []).filter(function (id) { return !!ctx.peopleById[id]; });
  const required = requiredRolesOfPost_(post);
  const removed = { UNAVAILABLE: 0, ROLE: 0, EXCLUDED: 0 };
  const candidates = pool.filter(function (personId) {
    if (isRuleEnabled_(rules, RULE_IDS.ELIGIBILITY)
        && eligibilityRoleTokenFailure_(ctx, post.postId, personId, dateStr)) { removed.ROLE++; return false; }
    if (required.length > 0 && isRuleEnabledAllowingDefault_(rules, RULE_IDS.ROLE_REQUIRED)
        && !personHasAnyRoleOn_(ctx.roles || [], personId, required, dateStr)) { removed.ROLE++; return false; }
    if (isRuleEnabledAllowingDefault_(rules, RULE_IDS.PERSON_POST_EXCLUDED)
        && findActivePersonPostExclusion_(ctx.personPostExclusions || [], personId, post.postId, dateStr)) {
      removed.EXCLUDED++; return false;
    }
    if (isRuleEnabled_(rules, RULE_IDS.UNAVAILABLE)
        && isPersonUnavailable_(personId, dateStr, post.postId, ctx.unavailable || [])) { removed.UNAVAILABLE++; return false; }
    return true;
  });
  return { pool: pool, candidates: candidates, removed: removed };
}

/**
 * 建立人手檢查的網絡。**純函式。**
 * @param {Object} ctx 規則 context（另外要有 serviceDates、specialByDate、maxPerQuarterDefault）
 * @param {Object=} opts {fixed: [{serviceDate, postId, personId}]}：已經定下（不改動）的格，先扣容量、不放入網絡
 * @returns {Object} model
 */
function buildStaffingModel_(ctx, opts) {
  opts = opts || {};
  const rules = ctx.rules;
  const g = newFlowGraph_();
  const S = flowAddNode_(g);
  const T = flowAddNode_(g);
  const BIG = 1000000;
  const mutexOn = isRuleEnabled_(rules, RULE_IDS.MUTEX_GROUP);
  const distinctOn = isRuleEnabled_(rules, RULE_IDS.DISTINCT_SLOT);
  const quarterMaxHard = isRuleSetHard_(rules, RULE_IDS.MAX_PER_QUARTER);
  const notes = [];

  // 互斥組裏有崗位設了每人上限 ⇒ 交叉，互斥放寬（下限）
  const groupHasPostMax = {};
  ctx.posts.forEach(function (p) {
    if (mutexOn && p.mutexGroup && postMaxPerPersonOf_(rules, p) !== null) groupHasPostMax[p.mutexGroup] = true;
  });
  const approximateGroups = Object.keys(groupHasPostMax);
  if (approximateGroups.length > 0) {
    notes.push('互斥組 ' + approximateGroups.join('、') + ' 裏有崗位設了每人每季上限，'
      + '同週不可兼任這一條放寬計算，所以下面的留空數是最少值（實際可能更多）。');
  }

  // 已定下的格：先扣容量
  const fixedUse = { person: {}, personPost: {}, personDateGroup: {} };
  (opts.fixed || []).forEach(function (f) {
    if (!f.personId) return;
    const post = findPost_(ctx.posts, f.postId);
    fixedUse.person[f.personId] = (fixedUse.person[f.personId] || 0) + 1;
    fixedUse.personPost[f.personId + '|' + f.postId] = (fixedUse.personPost[f.personId + '|' + f.postId] || 0) + 1;
    if (post && post.mutexGroup) {
      const k = f.personId + '|' + f.serviceDate + '|' + post.mutexGroup;
      fixedUse.personDateGroup[k] = (fixedUse.personDateGroup[k] || 0) + 1;
    }
  });
  const fixedSlot = {};
  (opts.fixed || []).forEach(function (f) {
    const k = f.serviceDate + '|' + f.postId;
    fixedSlot[k] = (fixedSlot[k] || 0) + 1;
  });

  const personNode = {};
  const personEdge = {};
  const ppNode = {};
  const ppEdge = {};
  const mNode = {};
  const mEdge = {};
  const getPerson = function (id) {
    if (personNode[id] !== undefined) return personNode[id];
    const n = flowAddNode_(g);
    personNode[id] = n;
    let cap = BIG;
    if (quarterMaxHard) cap = Math.max(0, resolveAssignmentLimit_(id, ctx) - (fixedUse.person[id] || 0));
    personEdge[id] = flowAddEdge_(g, S, n, cap);
    return n;
  };
  const getPP = function (id, post, limit) {
    const k = id + '|' + post.postId;
    if (ppNode[k] !== undefined) return ppNode[k];
    const n = flowAddNode_(g);
    ppNode[k] = n;
    ppEdge[k] = flowAddEdge_(g, getPerson(id), n, Math.max(0, limit - (fixedUse.personPost[k] || 0)));
    return n;
  };
  const getM = function (id, dateStr, group, fromNode) {
    const k = id + '|' + dateStr + '|' + group;
    if (mNode[k] !== undefined) return mNode[k];
    const n = flowAddNode_(g);
    mNode[k] = n;
    mEdge[k] = flowAddEdge_(g, fromNode, n, Math.max(0, 1 - (fixedUse.personDateGroup[k] || 0)));
    return n;
  };

  const slots = [];
  ctx.serviceDates.forEach(function (sd) {
    const special = (ctx.specialByDate || {})[sd.serviceDate] || { skipPostIds: [], lockPostIds: [] };
    ctx.posts.forEach(function (post) {
      if (getSkipReason_(post, sd, special, rules)) return;
      if ((special.lockPostIds || []).indexOf(post.postId) !== -1) return;
      const slotKey = sd.serviceDate + '|' + post.postId;
      const need = Math.max(0, post.slotCount - (fixedSlot[slotKey] || 0));
      if (need === 0) return;
      const node = flowAddNode_(g);
      const sinkEdge = flowAddEdge_(g, node, T, need);
      const cand = staffingCandidatesOn_(ctx, post, sd.serviceDate);
      const limit = postMaxPerPersonOf_(rules, post);
      const distinct = distinctOn && post.distinctWithinPost;
      const edgeCap = distinct ? 1 : need;
      const useMutex = mutexOn && post.mutexGroup && !groupHasPostMax[post.mutexGroup];
      const inEdges = {};
      cand.candidates.forEach(function (id) {
        let from = limit !== null ? getPP(id, post, limit) : getPerson(id);
        if (useMutex) from = getM(id, sd.serviceDate, post.mutexGroup, from);
        inEdges[id] = flowAddEdge_(g, from, node, edgeCap);
      });
      slots.push({ serviceDate: sd.serviceDate, post: post, need: need, node: node, sinkEdge: sinkEdge,
        cand: cand, inEdges: inEdges, limit: limit, useMutex: useMutex });
    });
  });

  // 被設成 HARD、但這裏沒有計入的規則
  Object.keys(rules || {}).forEach(function (ruleId) {
    if (STAFFING_MODELED_RULE_IDS.indexOf(ruleId) !== -1) return;
    if (isRuleSetHard_(rules, ruleId)) notes.push('規則 ' + ruleId + ' 被設成一定要遵守，但人手檢查沒有計入。');
  });

  return { g: g, S: S, T: T, slots: slots, personEdge: personEdge, ppEdge: ppEdge, mEdge: mEdge,
    quarterMaxHard: quarterMaxHard, notes: notes, approximate: approximateGroups.length > 0 };
}

/**
 * 某一格某人是經哪幾條邊進來（起點方案推流用）。
 */
function staffingPathFor_(model, slot, personId) {
  const e = slot.inEdges[personId];
  if (e === undefined) return null;
  const path = [model.personEdge[personId]];
  const ppk = personId + '|' + slot.post.postId;
  if (slot.limit !== null) path.push(model.ppEdge[ppk]);
  if (slot.useMutex) path.push(model.mEdge[personId + '|' + slot.serviceDate + '|' + slot.post.mutexGroup]);
  path.push(e, slot.sinkEdge);
  return path;
}

/**
 * 解出每一格最後是誰（從流量讀回來）。
 * @returns {Object.<string, string[]>} {'日期|崗位': [personId…]}
 */
function staffingReadAssignment_(model) {
  const out = {};
  model.slots.forEach(function (slot) {
    const ids = [];
    Object.keys(slot.inEdges).forEach(function (id) {
      const e = slot.inEdges[id];
      const used = model.g.cap[e ^ 1];
      for (let i = 0; i < used; i++) ids.push(id);
    });
    out[slot.serviceDate + '|' + slot.post.postId] = ids;
  });
  return out;
}

/**
 * 留空的格，分原因。
 */
function staffingClassifyBlank_(model, slot) {
  const c = slot.cand;
  if (c.pool.length === 0) return STAFFING_REASON.NO_POOL;
  if (c.candidates.length === 0) {
    const r = c.removed;
    if (r.UNAVAILABLE > 0 && r.ROLE === 0 && r.EXCLUDED === 0) return STAFFING_REASON.ALL_UNAVAILABLE;
    if (r.ROLE > 0 && r.UNAVAILABLE === 0 && r.EXCLUDED === 0) return STAFFING_REASON.ROLE;
    if (r.EXCLUDED > 0 && r.UNAVAILABLE === 0 && r.ROLE === 0) return STAFFING_REASON.EXCLUDED;
    return STAFFING_REASON.MIXED_FILTERS;
  }
  const counts = {};
  const g = model.g;
  c.candidates.forEach(function (id) {
    let why = STAFFING_REASON.DISTINCT;
    if (model.quarterMaxHard && g.cap[model.personEdge[id]] === 0) why = STAFFING_REASON.QUARTER_MAX;
    if (slot.limit !== null && g.cap[model.ppEdge[id + '|' + slot.post.postId]] === 0) why = STAFFING_REASON.POST_MAX;
    if (slot.useMutex && g.cap[model.mEdge[id + '|' + slot.serviceDate + '|' + slot.post.mutexGroup]] === 0
        && g.cap[slot.inEdges[id] ^ 1] === 0) why = STAFFING_REASON.MUTEX;
    counts[why] = (counts[why] || 0) + 1;
  });
  return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
}

/**
 * 人手檢查（只讀、純運算）。
 * @param {Object} ctx 規則 context（見 buildStaffingModel_）
 * @returns {{totalBlanks: number, totalNeeded: number, posts: Object[], notes: string[], approximate: boolean}}
 */
function computeStaffingCheck_(ctx) {
  const model = buildStaffingModel_(ctx);
  const filled = flowMax_(model.g, model.S, model.T);
  const byPost = {};
  let totalNeeded = 0;
  model.slots.forEach(function (slot) {
    totalNeeded += slot.need;
    const got = model.g.cap[slot.sinkEdge ^ 1];
    const p = slot.post;
    if (!byPost[p.postId]) {
      byPost[p.postId] = { postId: p.postId, postNameTC: p.postNameTC, slotCount: p.slotCount, needed: 0, filled: 0,
        blanks: 0, weeks: 0, pool: {}, limit: slot.limit, reasons: {}, blankWeeks: [] };
    }
    const b = byPost[p.postId];
    b.needed += slot.need;
    b.filled += got;
    b.weeks++;
    slot.cand.pool.forEach(function (id) { b.pool[id] = true; });
    if (got < slot.need) {
      const reason = staffingClassifyBlank_(model, slot);
      b.blanks += slot.need - got;
      b.reasons[reason] = (b.reasons[reason] || 0) + (slot.need - got);
      b.blankWeeks.push({ serviceDate: slot.serviceDate, blanks: slot.need - got, reasonCode: reason,
        reasonText: STAFFING_REASON_TEXT[reason] });
    }
  });
  const posts = Object.keys(byPost).map(function (id) { return byPost[id]; })
    .filter(function (b) { return b.blanks > 0; })
    .map(function (b) {
      b.poolCount = Object.keys(b.pool).length;
      delete b.pool;
      b.text = describeStaffingPost_(b);
      return b;
    });
  return { totalBlanks: totalNeeded - filled, totalNeeded: totalNeeded, posts: posts, notes: model.notes,
    approximate: model.approximate };
}

/**
 * 一個崗位的一段話（例如「「讀經」：13 週需要 13 人次；名單上 5 人，每人每季最多 1 次 ⇒ 最多排到 5 週，有 8 週會留空。……」）。
 * @param {Object} b computeStaffingCheck_ 每個崗位的結果
 * @returns {string}
 */
function describeStaffingPost_(b) {
  const main = Object.keys(b.reasons).sort(function (x, y) { return b.reasons[y] - b.reasons[x]; })[0];
  const unit = b.slotCount === 1 ? '週' : '人次';
  // 第八十六輪批次 MC 組：崗位名稱一律加「」（中英文、數字相連時才讀得清楚，例如「PPT 控制」）
  const n = '「' + b.postNameTC + '」';
  const head = n + '：' + b.weeks + ' 週需要 ' + b.needed + ' 人次；';
  const tail = '有 ' + b.blanks + (b.slotCount === 1 ? ' 週' : ' 格') + '會留空。';
  if (main === STAFFING_REASON.POST_MAX) {
    return head + '名單上 ' + b.poolCount + ' 人，每人每季最多 ' + b.limit + ' 次 ⇒ 最多排到 ' + b.filled + ' ' + unit + '，'
      + tail + '可以：在' + n + '名單加人，或者把' + n + '的上限改高。';
  }
  if (main === STAFFING_REASON.NO_POOL) return head + '名單上沒有人 ⇒ ' + tail + '可以：在' + n + '名單加人。';
  if (main === STAFFING_REASON.ALL_UNAVAILABLE) {
    return head + '有些主日名單上每一位都不能服侍 ⇒ ' + tail + '可以：在' + n + '名單加人，或者請其中一位改期。';
  }
  if (main === STAFFING_REASON.ROLE) {
    return head + '有些主日名單上沒有人有所需身分 ⇒ ' + tail + '可以：在' + n + '名單加有該身分的人，或者檢查身分的生效日期。';
  }
  if (main === STAFFING_REASON.EXCLUDED) {
    return head + '名單上的人都登記了暫時不做這個崗位 ⇒ ' + tail + '可以：在' + n + '名單加人。';
  }
  if (main === STAFFING_REASON.MUTEX) {
    return head + '名單上的人同一週已經要做另一個不可以兼任的崗位 ⇒ ' + tail + '可以：在' + n + '名單加人。';
  }
  if (main === STAFFING_REASON.QUARTER_MAX) {
    return head + '名單上的人已經到了每人每季總次數上限 ⇒ ' + tail + '可以：在' + n + '名單加人，或者把每季上限改高。';
  }
  return head + STAFFING_REASON_TEXT[main] + ' ⇒ ' + tail + '可以：在' + n + '名單加人。';
}

/**
 * 以現有方案為起點補空格（生成、〔請系統幫我調整〕用）。**純運算。**
 *
 * @param {Object} ctx 規則 context
 * @param {Object[]} cells 每一格 {serviceDate, postId, slotIndex, personId, fixed}
 *   fixed＝不可以改（人手填、鎖定、已決定）；其餘可以按增廣路徑改動。
 *   fixed 而沒有 PersonID（臨時幫手、外請講員等有名而不在名單的格）＝位置已經有人，不是空格
 * @returns {{changes: Object[], blanksBefore: number, blanksAfter: number}}
 *   changes：{serviceDate, postId, slotIndex, from, to}；不合法（違反模型的硬規則）的起點格當作 fixed
 */
function augmentAssignmentsWithStaffingFlow_(ctx, cells) {
  // 第八十五輪回歸：固定的格一律佔住位置（模型按格數扣減需要的人數）；有 PersonID 的另外扣那個人的容量
  const isFixedCell = function (c) { return !!c.fixed; };
  const fixed = cells.filter(isFixedCell);
  const model = buildStaffingModel_(ctx, { fixed: fixed });
  const slotByKey = {};
  model.slots.forEach(function (s) { slotByKey[s.serviceDate + '|' + s.post.postId] = s; });

  // 起點：可以改的格照現有方案推流；推不進去（不合法）就當成空格處理
  const startByKey = {};
  let blanksBefore = 0;
  cells.forEach(function (c) {
    if (isFixedCell(c)) return;
    const key = c.serviceDate + '|' + c.postId;
    const slot = slotByKey[key];
    if (!slot) return;
    if (!startByKey[key]) startByKey[key] = [];
    startByKey[key].push(c);
    if (!c.personId) { blanksBefore++; return; }
    const path = staffingPathFor_(model, slot, c.personId);
    if (!path || !flowPushPath_(model.g, path)) blanksBefore++;
  });
  flowMax_(model.g, model.S, model.T);
  const after = staffingReadAssignment_(model);

  const changes = [];
  let blanksAfter = 0;
  Object.keys(startByKey).forEach(function (key) {
    const list = startByKey[key].slice().sort(function (a, b) { return a.slotIndex - b.slotIndex; });
    const people = (after[key] || []).slice();
    // 保留原本仍然在這一格的人（不改 slotIndex），其餘空位放新的人
    const keep = {};
    list.forEach(function (c) {
      const at = c.personId ? people.indexOf(c.personId) : -1;
      if (at !== -1) { keep[c.slotIndex] = c.personId; people.splice(at, 1); }
    });
    list.forEach(function (c) {
      const to = keep[c.slotIndex] !== undefined ? keep[c.slotIndex] : (people.shift() || '');
      if (!to) blanksAfter++;
      if (to !== (c.personId || '')) {
        changes.push({ serviceDate: c.serviceDate, postId: c.postId, slotIndex: c.slotIndex, from: c.personId || '', to: to });
      }
    });
  });
  return { changes: changes, blanksBefore: blanksBefore, blanksAfter: blanksAfter };
}

// ─────────────────────────────────────────────────────────────────────
// 讀資料（幹事介面用）＋快取
// ─────────────────────────────────────────────────────────────────────

/**
 * 人手檢查需要的資料（和生成器同一批讀取函式，不另寫一套）。
 * @param {string} quarterId 季度 ID
 * @returns {Object} 規則 context
 */
function buildStaffingContext_(quarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const posts = readPostsNormalized();
  const eligibility = readEligibility();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  eligibility.byPost = roleContext.eligibleByPost;
  const peopleById = {};
  readPeople().forEach(function (row) {
    if (!isTrueValue_(row[COLUMNS.NAME_MAPPING.ACTIVE])) return;
    const rawMax = row[COLUMNS.NAME_MAPPING.MAX_PER_QUARTER];
    peopleById[row[COLUMNS.NAME_MAPPING.PERSON_ID]] = {
      personId: row[COLUMNS.NAME_MAPPING.PERSON_ID],
      nameTC: row[COLUMNS.NAME_MAPPING.NAME_TC],
      maxPerQuarter: (rawMax === '' || rawMax === null || rawMax === undefined) ? null : Number(rawMax)
    };
  });
  const config = readConfig();
  return {
    quarterId: quarterId,
    serviceDates: readServiceDatesNormalized(quarterId, timezone),
    posts: posts,
    eligibility: eligibility,
    roles: roleContext.roles,
    personPostExclusions: roleContext.exclusions,
    peopleById: peopleById,
    unavailable: readUnavailableNormalized(timezone),
    specialByDate: buildSpecialSundayByDate_(readSpecialSundays(quarterId), timezone),
    rules: readRules(),
    maxPerQuarterDefault: Number(config[CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER]) || DEFAULTS.MAX_PER_QUARTER
  };
}

/**
 * 輸入資料的簽名（快取用）：只要崗位設定、名單、人員、身分、暫時不做、不能服侍、主日、規則沒有變，結果一樣。
 * @param {Object} ctx buildStaffingContext_() 的結果
 * @returns {string}
 */
function staffingSignature_(ctx) {
  const parts = JSON.stringify([ctx.serviceDates, ctx.posts, ctx.eligibility.byPost, ctx.eligibility.roleOnlyByPost || {},
    ctx.roles, ctx.personPostExclusions, ctx.unavailable.map(function (u) {
      return [u.personId, u.dateFrom, u.dateTo, u.appliesTo, u.postIds];
    }), Object.keys(ctx.peopleById).sort().map(function (id) { return [id, ctx.peopleById[id].maxPerQuarter]; }),
    ctx.specialByDate, ctx.rules, ctx.maxPerQuarterDefault]);
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h * 33) ^ parts.charCodeAt(i)) >>> 0;
  return parts.length + '-' + h.toString(16);
}

/**
 * 人手檢查（讀資料＋快取）。快取以輸入簽名為鍵——資料一變，簽名就變，自然重新計算。
 * @param {string} quarterId 季度 ID
 * @returns {Object} computeStaffingCheck_() 的結果，另加 signature、cached、ms
 */
function readStaffingCheck_(quarterId) {
  const started = Date.now();
  const ctx = buildStaffingContext_(quarterId);
  const sig = staffingSignature_(ctx);
  const cacheKey = 'staffing_v1_' + quarterId;
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (err) { cache = null; }
  if (cache) {
    try {
      const hit = cache.get(cacheKey);
      if (hit) {
        const parsed = JSON.parse(hit);
        if (parsed.signature === sig) {
          parsed.result.cached = true;
          parsed.result.ms = Date.now() - started;
          return parsed.result;
        }
      }
    } catch (err) {
      log_('WARN', 'readStaffingCheck_ 讀快取失敗：' + err.message);
    }
  }
  const result = computeStaffingCheck_(ctx);
  result.signature = sig;
  result.quarterId = quarterId;
  if (cache) {
    try { cache.put(cacheKey, JSON.stringify({ signature: sig, result: result }), 21600); }
    catch (err) { log_('WARN', 'readStaffingCheck_ 寫快取失敗：' + err.message); }
  }
  result.cached = false;
  result.ms = Date.now() - started;
  return result;
}

/**
 * 供前端呼叫：〔人手檢查〕。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiGetStaffingCheck(quarterId) {
  assertWebAppRequestAllowed_('apiGetStaffingCheck');
  beginSheetReadMemo_();
  try {
    const id = String(quarterId || '').trim();
    const r = readStaffingCheck_(id);
    r.quarterLabel = buildQuarterLabel_(id);
    return r;
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 改動之後的一句提醒：人手不足（或者比之前更差）。之前沒有數字 ⇒ 只看現在。
 * @param {?Object} before 改動前的人手檢查（可以 null）
 * @param {?Object} after 改動後的人手檢查
 * @returns {string} 空字串＝不用提醒
 */
function describeStaffingChange_(before, after) {
  if (!after || after.totalBlanks <= 0) return '';
  const names = after.posts.map(function (p) { return '「' + p.postNameTC + '」'; }).join('、');
  const worse = before && after.totalBlanks > before.totalBlanks;
  return '⚠ 人手檢查：' + names + '人手不足，最少會有 ' + after.totalBlanks + ' 格留空'
    + (worse ? '（比之前多了 ' + (after.totalBlanks - before.totalBlanks) + ' 格）' : '')
    + '。按「開季前準備 ▸ 人手檢查」看詳情。';
}

/**
 * 改動之後仍然守住互斥組（模型放寬互斥時用來把關）。**純函式。**
 * @param {Object} ctx 規則 context
 * @param {Object[]} cells 改動後的全部格 {serviceDate, postId, personId}
 * @returns {boolean} true＝沒有同週同組兼任
 */
function staffingCellsKeepMutex_(ctx, cells) {
  if (!isRuleEnabled_(ctx.rules, RULE_IDS.MUTEX_GROUP)) return true;
  const seen = {};
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.personId) continue;
    const post = findPost_(ctx.posts, c.postId);
    if (!post || !post.mutexGroup) continue;
    const k = c.personId + '|' + c.serviceDate + '|' + post.mutexGroup;
    if (seen[k]) return false;
    seen[k] = true;
  }
  return true;
}

/**
 * 第八十五輪批次 LD 組：生成之後補空格（只在能令留空減少時改動，改動的格寫明）。
 * 「排不出」（SKIPPED＋HARD_ELIGIBILITY）的格才是空格；鎖定的格不改；結構性不設的格不在網絡。
 * @param {Object} context 生成器 context
 * @param {{assignments: Object[], warnings: Object[]}} result buildRoster_() 的結果（就地修改）
 * @returns {{before: number, after: number, changed: number}}
 */
function repairRosterBlanksWithStaffingFlow_(context, result) {
  const cells = result.assignments.map(function (a) {
    return {
      serviceDate: a.serviceDate, postId: a.postId, slotIndex: a.slotIndex, personId: a.personId || '',
      fixed: a.assignSource === ASSIGN_SOURCE.LOCKED
    };
  });
  let aug;
  try {
    aug = augmentAssignmentsWithStaffingFlow_(context, cells);
  } catch (err) {
    log_('WARN', 'repairRosterBlanksWithStaffingFlow_ 失敗，照舊用貪心法結果：' + err.message);
    return { before: -1, after: -1, changed: 0 };
  }
  if (aug.changes.length === 0 || aug.blanksAfter >= aug.blanksBefore) {
    return { before: aug.blanksBefore, after: aug.blanksBefore, changed: 0 };
  }
  const byKey = {};
  result.assignments.forEach(function (a, i) { byKey[a.serviceDate + '|' + a.postId + '|' + a.slotIndex] = i; });
  const next = cells.map(function (c) { return { serviceDate: c.serviceDate, postId: c.postId, personId: c.personId }; });
  aug.changes.forEach(function (ch) {
    const i = byKey[ch.serviceDate + '|' + ch.postId + '|' + ch.slotIndex];
    if (i !== undefined) next[i].personId = ch.to;
  });
  if (!staffingCellsKeepMutex_(context, next)) {
    log_('WARN', 'repairRosterBlanksWithStaffingFlow_：補空格會令同週兼任，照舊用貪心法結果');
    return { before: aug.blanksBefore, after: aug.blanksBefore, changed: 0 };
  }
  const filledKeys = {};
  aug.changes.forEach(function (ch) {
    const i = byKey[ch.serviceDate + '|' + ch.postId + '|' + ch.slotIndex];
    if (i === undefined) return;
    const a = result.assignments[i];
    const person = context.peopleById[ch.to];
    a.personId = ch.to;
    a.personName = person ? person.nameTC : ch.to;
    a.assignSource = ASSIGN_SOURCE.AUTO;
    a.ruleFlags = [];
    if (!ch.from) filledKeys[ch.serviceDate + '|' + ch.postId + '|' + ch.slotIndex] = true;
  });
  // 補上了的格，「排不出」那一句警告拿走
  result.warnings = result.warnings.filter(function (w) {
    return !(w.ruleId === RULE_IDS.ELIGIBILITY && filledKeys[w.serviceDate + '|' + w.postId + '|' + w.slotIndex]);
  });
  return { before: aug.blanksBefore, after: aug.blanksAfter, changed: aug.changes.length };
}

/**
 * 第八十五輪批次 LD 組：〔請系統幫我調整〕逐格填空之後仍然有空格 ⇒ 用同一個網絡補（可能要把別格的人調開）。
 * 人手填了人的格（isManual）、有名而沒有 PersonID 的格（freeText：臨時幫手等）不改，而且不當成空格；
 * 人手清空的格和逐格填空一樣，可以填。
 * @param {Object} context fine-tune context
 * @param {Object[]} workingState 工作狀態（就地修改）
 * @returns {{changes: Object[], before: number, after: number}}
 */
function augmentGapFillsWithStaffingFlow_(context, workingState) {
  const cells = workingState.map(function (s) {
    return { serviceDate: s.serviceDate, postId: s.postId, slotIndex: s.slotIndex, personId: s.personId || '',
      fixed: !!(s.freeText || (s.isManual && s.personId)) };
  });
  const aug = augmentAssignmentsWithStaffingFlow_(context, cells);
  if (aug.changes.length === 0 || aug.blanksAfter >= aug.blanksBefore) {
    return { changes: [], before: aug.blanksBefore, after: aug.blanksBefore };
  }
  const byKey = {};
  workingState.forEach(function (s, i) { byKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] = i; });
  const next = workingState.map(function (s) { return { serviceDate: s.serviceDate, postId: s.postId, personId: s.personId }; });
  aug.changes.forEach(function (ch) {
    const i = byKey[cellKey_(ch.serviceDate, ch.postId, ch.slotIndex)];
    if (i !== undefined) next[i].personId = ch.to;
  });
  if (!staffingCellsKeepMutex_(context, next)) return { changes: [], before: aug.blanksBefore, after: aug.blanksBefore };
  aug.changes.forEach(function (ch) {
    const i = byKey[cellKey_(ch.serviceDate, ch.postId, ch.slotIndex)];
    if (i !== undefined) workingState[i].personId = ch.to;
  });
  return { changes: aug.changes, before: aug.blanksBefore, after: aug.blanksAfter };
}

/**
 * 第八十五輪批次 LD 組：改了名單／不能服侍／身分／暫時不做／規則／合堂之後，完成窗的一句提醒。
 * 「之前」＝快取裏上一次算的結果（主畫面載入時算過）；「現在」＝重新算。**只讀**（只更新快取）。
 * @param {string} quarterId 季度 ID
 * @returns {{note: string}}
 */
function apiGetStaffingChangeNote(quarterId) {
  assertWebAppRequestAllowed_('apiGetStaffingChangeNote');
  const id = String(quarterId || '').trim();
  if (!id) return { note: '' };
  let before = null;
  try {
    const hit = CacheService.getScriptCache().get('staffing_v1_' + id);
    if (hit) before = JSON.parse(hit).result;
  } catch (err) {
    before = null;
  }
  beginSheetReadMemo_();
  try {
    return { note: describeStaffingChange_(before, readStaffingCheck_(id)) };
  } catch (err) {
    log_('WARN', 'apiGetStaffingChangeNote 失敗：' + err.message);
    return { note: '' };
  } finally {
    endSheetReadMemo_();
  }
}
