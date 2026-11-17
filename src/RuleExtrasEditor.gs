/**
 * 第一百一十二輪批次 UD 組：〔影音組合及協唱〕設定畫面。
 *
 * 影音組合（PostTeams）、協唱（WorshipBackingSingers）、詩班獻詩日照樣可以擔任的崗位（Config CHOIR_SUNDAY_ALLOWED）
 * 以前只可以在工作表輸入 PersonID／PostID。這裏讓幹事在介面改，寫回**同一批工作表及 Config，格式不變**——生成器不用改。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 讀寫規則
 * ─────────────────────────────────────────────────────────────────────
 *   ・讀（`apiGetRuleExtrasEditor`）：只可查看的人也可以打開，全部唯讀。
 *   ・寫（`apiSaveRuleExtras`）：要可以修改的權限（伺服器端把關，只可查看的人一律拒絕）；經 `withMutationLock_()`。
 *   ・儲存之前執行第一百一十一輪 SE 組的核對函式 `validateRuleExtrasData_()`：有問題就不可以儲存，並指出哪一項。
 *   ・移除＝把那一行的 Active 設為 FALSE，不刪行；已經存在的行只改有變動的格；備註欄不碰。
 *   ・自由文字（組合名稱、協唱名字）經 `sheetSafeText_()`。
 *   ・AuditLog 寫改前、改後（每一份資料一筆；Config 那一項由 `setConfigValue_()` 寫）。
 *   ・這一季已經有版本 ⇒ 儲存之後提示「新設定要按〔請系統幫我調整〕之後才會反映」。
 *
 * 畫面用的資料格式（`apiGetRuleExtrasEditor`／`apiSaveRuleExtras` 共用）：
 *   teams:   [{teamId, perMonth, members: [{personId, postIds: string[], level: 'HARD'|'SOFT'}]}]
 *   singers: [{leaderPersonId, singerPersonId, singerName, level}]
 *   choir:   [{personId, postId}]
 */

const RULE_EXTRAS_EDITOR_AUDIT_ACTION = 'RULE_EXTRAS_SAVED';
const RULE_EXTRAS_MAX_PER_MONTH = 8;
const RULE_EXTRAS_MAX_TEXT = 40;

/**
 * 工作表的行 ⇒ 畫面資料。**純函式。**
 * @param {{teamRows: Object[], singerRows: Object[], choirRaw: *}} input
 * @returns {{teams: Object[], singers: Object[], choir: Object[], choirInvalid: string[]}}
 */
function planRuleExtrasEditorData_(input) {
  const T = COLUMNS.POST_TEAMS;
  const W = COLUMNS.WORSHIP_BACKING_SINGERS;
  const byId = {};
  const order = [];
  (input.teamRows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[T.ACTIVE])) return;
    const teamId = String(r[T.TEAM_ID] || '').trim();
    const personId = String(r[T.PERSON_ID] || '').trim();
    if (!teamId || !personId) return;
    if (!byId[teamId]) { byId[teamId] = { teamId: teamId, perMonth: 0, members: [] }; order.push(teamId); }
    const team = byId[teamId];
    const n = Math.floor(Number(r[T.PER_MONTH]));
    if (!isNaN(n) && n >= 1) team.perMonth = Math.max(team.perMonth, n);
    const level = String(r[T.OUTSIDE_TEAM_LEVEL] || '').trim().toUpperCase() === POST_TEAM_LEVELS.SOFT ? POST_TEAM_LEVELS.SOFT : POST_TEAM_LEVELS.HARD;
    let m = team.members.filter(function (x) { return x.personId === personId; })[0];
    if (!m) { m = { personId: personId, postIds: [], level: level }; team.members.push(m); }
    splitList_(String(r[T.POST_IDS] || '').replace(/[，、;\s]+/g, ',')).forEach(function (p) { if (m.postIds.indexOf(p) === -1) m.postIds.push(p); });
    if (level === POST_TEAM_LEVELS.HARD) m.level = POST_TEAM_LEVELS.HARD;
  });
  const teams = order.map(function (id) { const team = byId[id]; if (!team.perMonth) team.perMonth = 1; return team; });
  const singers = [];
  (input.singerRows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[W.ACTIVE])) return;
    const leaderPersonId = String(r[W.LEADER_PERSON_ID] || '').trim();
    const singerPersonId = String(r[W.SINGER_PERSON_ID] || '').trim();
    const singerName = String(r[W.SINGER_NAME] || '').trim();
    if (!leaderPersonId && !singerPersonId && !singerName) return;
    singers.push({ leaderPersonId: leaderPersonId, singerPersonId: singerPersonId, singerName: singerName,
      level: String(r[W.LEVEL] || '').trim().toUpperCase() === POST_TEAM_LEVELS.SOFT ? POST_TEAM_LEVELS.SOFT : POST_TEAM_LEVELS.HARD });
  });
  const choir = [];
  const choirInvalid = [];
  String(input.choirRaw === null || input.choirRaw === undefined ? '' : input.choirRaw).split(/[,，、;\s]+/)
    .map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (tok) {
      const parts = tok.split(/[:：]/);
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) choir.push({ personId: parts[0].trim(), postId: parts[1].trim() });
      else choirInvalid.push(tok);
    });
  return { teams: teams, singers: singers, choir: choir, choirInvalid: choirInvalid };
}

/**
 * 供前端呼叫：〔影音組合及協唱〕畫面的內容。**純讀取**；只可查看的人也可以打開。
 * @param {string} quarterId 季度 ID（只用來判斷這一季有沒有版本）
 * @returns {Object}
 */
function apiGetRuleExtrasEditor(quarterId) {
  assertWebAppRequestAllowed_('apiGetRuleExtrasEditor');
  const id = String(quarterId || '').trim();
  const lookups = buildRuleExtrasLookups_();
  const data = planRuleExtrasEditorData_({
    teamRows: readSheetRowsWithNumbers_(SHEETS.POST_TEAMS),
    singerRows: readSheetRowsWithNumbers_(SHEETS.WORSHIP_BACKING_SINGERS),
    choirRaw: getConfig_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, '')
  });
  const worshipPostId = String(getConfig_(CONFIG_KEYS.WORSHIP_LEADER_POST_ID, 'WORSHIP') || 'WORSHIP').trim();
  const choirPostId = String(getConfig_(CONFIG_KEYS.CHOIR_GROUP_POST_ID, 'CHOIR') || 'CHOIR').trim();
  const people = Object.keys(lookups.people).filter(function (pid) { return lookups.people[pid].active; })
    .map(function (pid) { return { personId: pid, name: lookups.people[pid].name }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  const posts = readPostsNormalized_().map(function (p) { return { postId: p.postId, name: p.postNameTC || p.postId }; });
  const eligibleByPost = {};
  Object.keys(lookups.eligible).forEach(function (k) {
    const parts = k.split(':');
    if (!lookups.people[parts[0]] || !lookups.people[parts[0]].active) return;
    (eligibleByPost[parts[1]] = eligibleByPost[parts[1]] || []).push(parts[0]);
  });
  // 名單上已經找不到的人／崗位（資料有問題）：畫面照實顯示，不要靜靜隱藏
  const nameOf = function (pid) { return (lookups.people[pid] && lookups.people[pid].name) || ''; };
  const postNameOf = function (pid) { return (lookups.posts[pid] && lookups.posts[pid].name) || ''; };
  data.teams.forEach(function (t) { t.members.forEach(function (m) { m.name = nameOf(m.personId); }); });
  data.singers.forEach(function (s) { s.leaderName = nameOf(s.leaderPersonId); s.singerPersonName = nameOf(s.singerPersonId); });
  data.choir.forEach(function (c) { c.personName = nameOf(c.personId); c.postName = postNameOf(c.postId); });
  const check = validateRuleExtrasData_({
    teamRows: readSheetRowsWithNumbers_(SHEETS.POST_TEAMS), singerRows: readSheetRowsWithNumbers_(SHEETS.WORSHIP_BACKING_SINGERS),
    choirRaw: getConfig_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, ''), people: lookups.people, posts: lookups.posts, eligible: lookups.eligible,
    worshipPostId: worshipPostId
  });
  let hasVersion = false;
  try { hasVersion = !!id && findLatestVersionNo_(id) >= 0; } catch (err) { hasVersion = false; }
  return {
    quarterId: id, quarterLabel: id ? buildQuarterLabel_(id) : '', hasVersion: hasVersion,
    teams: data.teams, singers: data.singers, choir: data.choir, choirInvalid: data.choirInvalid,
    options: { people: people, posts: posts, eligibleByPost: eligibleByPost, worshipPostId: worshipPostId, choirPostId: choirPostId,
      maxPerMonth: RULE_EXTRAS_MAX_PER_MONTH },
    sheetsReady: !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POST_TEAMS)
      && !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.WORSHIP_BACKING_SINGERS),
    problems: check.lines,
    explain: {
      teams: '同一個影音組合的成員，每個月會一起服侍指定的次數（組合週）：那一週組合的崗位由組合成員做。組合週以外，成員不做這組的崗位——「一定不排」是不可以排，「盡量不排」是人手不足才排並提醒。',
      singers: '領詩領詩的那一個主日，他的協唱不擔任其他崗位——「一定不排」是不可以排，「盡量不排」是人手不足才排並提醒。協唱只用來避開排表，不會在職事表或任何輸出出現。',
      choir: '詩班獻詩的主日，詩班員一般盡量不擔任其他崗位。這裏列出的人，做列出的崗位不受這個限制（可以排，但不會特別安排）。'
    }
  };
}

/**
 * 整理前端傳來的資料。**純函式。**有結構上的錯（重複、空白名稱、字太長）就拋錯；人和崗位對不對留給核對函式。
 * @param {Object} payload {teams, singers, choir}
 * @returns {{teams: Object[], singers: Object[], choir: Object[]}}
 */
function normaliseRuleExtrasPayload_(payload) {
  const p = payload || {};
  const fail = function (msg, hint) { throw new Error(buildThreePartMessage_(msg, '甚麼都沒有儲存。', hint || ['修正之後再按〔儲存〕'])); };
  const cleanText = function (v) { return String(v === null || v === undefined ? '' : v).replace(/[\r\n\t]+/g, ' ').trim(); };
  const level = function (v) { return String(v || '').trim().toUpperCase() === POST_TEAM_LEVELS.SOFT ? POST_TEAM_LEVELS.SOFT : POST_TEAM_LEVELS.HARD; };
  const teams = [];
  const seenTeam = {};
  (p.teams || []).forEach(function (t) {
    const teamId = cleanText(t.teamId);
    if (!teamId) fail('有一個影音組合沒有填組合名稱。');
    if (teamId.length > RULE_EXTRAS_MAX_TEXT) fail('組合名稱「' + teamId.slice(0, 12) + '…」太長（最多 ' + RULE_EXTRAS_MAX_TEXT + ' 個字）。');
    if (/[,，:：]/.test(teamId)) fail('組合名稱「' + teamId + '」不可以有逗號或冒號。');
    if (seenTeam[teamId]) fail('組合名稱「' + teamId + '」出現了兩次。', ['把兩組改成不同的名稱，或者合併成一組']);
    seenTeam[teamId] = true;
    const perMonth = Number(t.perMonth);
    if (!(Math.floor(perMonth) === perMonth && perMonth >= 1 && perMonth <= RULE_EXTRAS_MAX_PER_MONTH)) {
      fail('組合「' + teamId + '」每月一起服侍的次數要是 1 至 ' + RULE_EXTRAS_MAX_PER_MONTH + ' 的整數。');
    }
    const seenPerson = {};
    const members = [];
    (t.members || []).forEach(function (m) {
      const personId = cleanText(m.personId);
      if (!personId) fail('組合「' + teamId + '」有一位成員沒有選名字。');
      if (seenPerson[personId]) fail('組合「' + teamId + '」的同一位成員出現了兩次。', ['同一位成員的崗位請在同一行勾選']);
      seenPerson[personId] = true;
      const postIds = [];
      (m.postIds || []).forEach(function (x) { const id = cleanText(x); if (id && postIds.indexOf(id) === -1) postIds.push(id); });
      members.push({ personId: personId, postIds: postIds, level: level(m.level) });
    });
    if (members.length === 0) fail('組合「' + teamId + '」沒有成員。', ['加入成員，或者把整組移除']);
    teams.push({ teamId: teamId, perMonth: perMonth, members: members });
  });
  const singers = [];
  const seenSinger = {};
  (p.singers || []).forEach(function (s) {
    const leaderPersonId = cleanText(s.leaderPersonId);
    const singerPersonId = cleanText(s.singerPersonId);
    const singerName = singerPersonId ? '' : cleanText(s.singerName);
    if (singerName.length > RULE_EXTRAS_MAX_TEXT) fail('協唱的名字「' + singerName.slice(0, 12) + '…」太長（最多 ' + RULE_EXTRAS_MAX_TEXT + ' 個字）。');
    const key = leaderPersonId + '|' + singerPersonId + '|' + singerName;
    if (seenSinger[key]) fail('有一對領詩和協唱出現了兩次。');
    seenSinger[key] = true;
    singers.push({ leaderPersonId: leaderPersonId, singerPersonId: singerPersonId, singerName: singerName, level: level(s.level) });
  });
  const choir = [];
  const seenChoir = {};
  (p.choir || []).forEach(function (c) {
    const personId = cleanText(c.personId);
    const postId = cleanText(c.postId);
    const key = personId + ':' + postId;
    if (!personId || !postId) fail('詩班獻詩日的例外有一項沒有選人或者崗位。');
    if (/[,，:：\s]/.test(key.replace(':', ''))) fail('詩班獻詩日的例外「' + key + '」不可以有逗號、冒號或空白。');
    if (seenChoir[key]) return;
    seenChoir[key] = true;
    choir.push({ personId: personId, postId: postId });
  });
  return { teams: teams, singers: singers, choir: choir };
}

/** 整理後的資料 ⇒ 核對函式要的行（`__row` 用第幾項）。 */
function ruleExtrasPayloadToCheckRows_(clean) {
  const T = COLUMNS.POST_TEAMS;
  const W = COLUMNS.WORSHIP_BACKING_SINGERS;
  const teamRows = [];
  clean.teams.forEach(function (t) {
    t.members.forEach(function (m) {
      const r = { __row: teamRows.length + 1 };
      r[T.TEAM_ID] = t.teamId; r[T.PERSON_ID] = m.personId; r[T.POST_IDS] = m.postIds.join(',');
      r[T.PER_MONTH] = t.perMonth; r[T.OUTSIDE_TEAM_LEVEL] = m.level; r[T.ACTIVE] = true;
      teamRows.push(r);
    });
  });
  const singerRows = clean.singers.map(function (s, i) {
    const r = { __row: i + 1 };
    r[W.LEADER_PERSON_ID] = s.leaderPersonId; r[W.SINGER_PERSON_ID] = s.singerPersonId; r[W.SINGER_NAME] = s.singerName;
    r[W.LEVEL] = s.level; r[W.ACTIVE] = true;
    return r;
  });
  return { teamRows: teamRows, singerRows: singerRows };
}

/** 核對的結果 ⇒ 給幹事看的行（指出哪一項）。 */
function describeRuleExtrasSaveProblems_(check, clean) {
  return check.issues.map(function (i) {
    if (i.source === 'PostTeams') {
      const rows = ruleExtrasPayloadToCheckRows_(clean).teamRows;
      const r = rows[i.row - 1];
      return '影音組合「' + (r ? r[COLUMNS.POST_TEAMS.TEAM_ID] : '') + '」：' + i.message;
    }
    if (i.source === 'WorshipBackingSingers') return '協唱第 ' + i.row + ' 行：' + i.message;
    return '詩班獻詩日的例外第 ' + i.row + ' 項：' + i.message;
  });
}

/**
 * 工作表現有行 ⇒ 要改的格／要停用的行／要新增的行。**純函式。**
 * @param {Object[]} existingRows 工作表的行（`__row`）
 * @param {Object[]} desired 想要的最終內容，每項 `{key, fields: {欄名: 值}}`
 * @param {function(Object): string} keyOf 由工作表的一行得出同樣的 key
 * @param {string} activeKey Active 欄名
 * @returns {{updates: Object[], deactivate: number[], appends: Object[]}}
 */
function planRuleExtrasSheetWrites_(existingRows, desired, keyOf, activeKey) {
  const byKey = {};
  (existingRows || []).forEach(function (r) {
    if (!isRuleDataRowActive_(r[activeKey])) return;
    const k = keyOf(r);
    if (!k) return;
    (byKey[k] = byKey[k] || []).push(r);
  });
  const updates = [];
  const deactivate = [];
  const appends = [];
  const wanted = {};
  desired.forEach(function (d) {
    wanted[d.key] = true;
    const rows = byKey[d.key];
    if (!rows || rows.length === 0) { appends.push(d.fields); return; }
    const first = rows[0];
    const changes = {};
    Object.keys(d.fields).forEach(function (col) {
      const cur = first[col] === null || first[col] === undefined ? '' : String(first[col]).trim();
      const want = d.fields[col] === null || d.fields[col] === undefined ? '' : String(d.fields[col]).trim();
      if (cur !== want) changes[col] = d.fields[col];
    });
    if (Object.keys(changes).length > 0) updates.push({ row: first.__row, changes: changes });
    // 同一個 key 有幾行（例如每個崗位一行）⇒ 合併到第一行，其餘停用
    rows.slice(1).forEach(function (r) { deactivate.push(r.__row); });
  });
  Object.keys(byKey).forEach(function (k) {
    if (wanted[k]) return;
    byKey[k].forEach(function (r) { deactivate.push(r.__row); });
  });
  return { updates: updates, deactivate: deactivate, appends: appends };
}

/** 把 plan 寫入工作表。 */
function applyRuleExtrasSheetWrites_(sheetName, plan, activeKey) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表: ' + sheetName);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
  const colOf = function (name) {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error('工作表 ' + sheetName + ' 找不到欄 ' + name);
    return i + 1;
  };
  plan.updates.forEach(function (u) {
    Object.keys(u.changes).forEach(function (col) { sheet.getRange(u.row, colOf(col)).setValue(u.changes[col]); });
  });
  plan.deactivate.forEach(function (row) { sheet.getRange(row, colOf(activeKey)).setValue(false); });
  if (plan.appends.length > 0) {
    const rows = plan.appends.map(function (fields) {
      return headers.map(function (h) {
        if (h === activeKey) return true;
        return fields[h] === undefined ? '' : fields[h];
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
}

/** 一份資料 ⇒ 給 AuditLog 的文字（用名字及崗位名稱）。 */
function describeRuleExtrasForAudit_(data, lookups) {
  const nameOf = function (id) { return (lookups.people[id] && lookups.people[id].name) || id; };
  const postOf = function (id) { return (lookups.posts[id] && lookups.posts[id].name) || id; };
  const lv = function (l) { return l === POST_TEAM_LEVELS.SOFT ? '盡量不排' : '一定不排'; };
  return {
    teams: data.teams.map(function (t) {
      return t.teamId + '（每月 ' + t.perMonth + ' 次）：' + t.members.map(function (m) {
        return nameOf(m.personId) + '［' + m.postIds.map(postOf).join('、') + '；組合週以外' + lv(m.level) + '］';
      }).join('、');
    }).join('；') || '（沒有）',
    singers: data.singers.map(function (s) {
      return nameOf(s.leaderPersonId) + ' → ' + (s.singerPersonId ? nameOf(s.singerPersonId) : s.singerName) + '（' + lv(s.level) + '）';
    }).join('；') || '（沒有）',
    choir: data.choir.map(function (c) { return nameOf(c.personId) + '：' + postOf(c.postId); }).join('；') || '（沒有）'
  };
}

/**
 * 供前端呼叫：儲存〔影音組合及協唱〕。要可以修改的權限；有問題不可以儲存；寫回同一批工作表及 Config。
 * @param {string} quarterId 季度 ID（只用來提示這一季有沒有版本）
 * @param {{teams: Object[], singers: Object[], choir: Object[]}} payload 畫面上的全部內容（想要的最終內容）
 * @returns {{ok: boolean, changed: Object, hasVersion: boolean, message: string}}
 */
function apiSaveRuleExtras(quarterId, payload) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('儲存影音組合及協唱', function () {
    const id = String(quarterId || '').trim();
    const clean = normaliseRuleExtrasPayload_(payload);
    const lookups = buildRuleExtrasLookups_();
    const worshipPostId = String(getConfig_(CONFIG_KEYS.WORSHIP_LEADER_POST_ID, 'WORSHIP') || 'WORSHIP').trim();
    const rows = ruleExtrasPayloadToCheckRows_(clean);
    const check = validateRuleExtrasData_({
      teamRows: rows.teamRows, singerRows: rows.singerRows,
      choirRaw: clean.choir.map(function (c) { return c.personId + ':' + c.postId; }).join(','),
      people: lookups.people, posts: lookups.posts, eligible: lookups.eligible, worshipPostId: worshipPostId
    });
    if (!check.ok) {
      const lines = describeRuleExtrasSaveProblems_(check, clean);
      throw new Error(buildThreePartMessage_('有 ' + lines.length + ' 項資料不對，不可以儲存：' + lines.join('；') + '。', '甚麼都沒有儲存。',
        ['按上面指出的項目修正（例如把人加入該崗位的事奉人員名單，或者改選另一位）', '修正之後再按〔儲存〕']));
    }
    // 沒有工作表 ⇒ 先建立（只有標題；已有就只核對標題）
    const created = ensureRuleDataSheets_();
    const before = planRuleExtrasEditorData_({
      teamRows: readSheetRowsWithNumbers_(SHEETS.POST_TEAMS),
      singerRows: readSheetRowsWithNumbers_(SHEETS.WORSHIP_BACKING_SINGERS),
      choirRaw: getConfig_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, '')
    });
    const T = COLUMNS.POST_TEAMS;
    const W = COLUMNS.WORSHIP_BACKING_SINGERS;
    const changed = { teams: 0, singers: 0, choir: false };

    // 影音組合：一位成員一行（key＝組合名稱|PersonID）
    const teamDesired = [];
    clean.teams.forEach(function (t) {
      t.members.forEach(function (m) {
        const f = {};
        f[T.TEAM_ID] = sheetSafeText_(t.teamId); f[T.PERSON_ID] = m.personId; f[T.POST_IDS] = m.postIds.join(',');
        f[T.PER_MONTH] = t.perMonth; f[T.OUTSIDE_TEAM_LEVEL] = m.level;
        teamDesired.push({ key: t.teamId + '|' + m.personId, fields: f });
      });
    });
    const teamPlan = planRuleExtrasSheetWrites_(readSheetRowsWithNumbers_(SHEETS.POST_TEAMS), teamDesired,
      function (r) { const a = String(r[T.TEAM_ID] || '').trim(); const b = String(r[T.PERSON_ID] || '').trim(); return a && b ? a + '|' + b : ''; }, T.ACTIVE);
    // 協唱：key＝領詩|協唱 PersonID|協唱名字
    const singerDesired = clean.singers.map(function (s) {
      const f = {};
      f[W.LEADER_PERSON_ID] = s.leaderPersonId; f[W.SINGER_PERSON_ID] = s.singerPersonId; f[W.SINGER_NAME] = sheetSafeText_(s.singerName); f[W.LEVEL] = s.level;
      return { key: s.leaderPersonId + '|' + s.singerPersonId + '|' + s.singerName, fields: f };
    });
    const singerPlan = planRuleExtrasSheetWrites_(readSheetRowsWithNumbers_(SHEETS.WORSHIP_BACKING_SINGERS), singerDesired,
      function (r) {
        const a = String(r[W.LEADER_PERSON_ID] || '').trim();
        const b = String(r[W.SINGER_PERSON_ID] || '').trim();
        const c = String(r[W.SINGER_NAME] || '').trim();
        return a || b || c ? a + '|' + b + '|' + c : '';
      }, W.ACTIVE);
    const touch = function (p) { return p.updates.length + p.deactivate.length + p.appends.length; };
    changed.teams = touch(teamPlan);
    changed.singers = touch(singerPlan);
    if (changed.teams > 0) applyRuleExtrasSheetWrites_(SHEETS.POST_TEAMS, teamPlan, T.ACTIVE);
    if (changed.singers > 0) applyRuleExtrasSheetWrites_(SHEETS.WORSHIP_BACKING_SINGERS, singerPlan, W.ACTIVE);

    // AuditLog：改前、改後
    const beforeText = describeRuleExtrasForAudit_(before, lookups);
    const afterText = describeRuleExtrasForAudit_(clean, lookups);
    if (changed.teams > 0) {
      writeAuditLog_({ action: RULE_EXTRAS_EDITOR_AUDIT_ACTION, targetSheet: SHEETS.POST_TEAMS, targetKey: '影音組合',
        oldValue: beforeText.teams, newValue: afterText.teams, source: 'apiSaveRuleExtras', notes: '〔影音組合及協唱〕改了 ' + changed.teams + ' 行（移除＝Active 設為 FALSE，不刪行）' });
    }
    if (changed.singers > 0) {
      writeAuditLog_({ action: RULE_EXTRAS_EDITOR_AUDIT_ACTION, targetSheet: SHEETS.WORSHIP_BACKING_SINGERS, targetKey: '協唱',
        oldValue: beforeText.singers, newValue: afterText.singers, source: 'apiSaveRuleExtras', notes: '〔影音組合及協唱〕改了 ' + changed.singers + ' 行（移除＝Active 設為 FALSE，不刪行）' });
    }
    // 詩班獻詩日照樣可以擔任的崗位：Config CHOIR_SUNDAY_ALLOWED（格式「PersonID:PostID」逗號分隔，不變）
    const oldChoir = before.choir.map(function (c) { return c.personId + ':' + c.postId; }).join(',');
    const newChoir = clean.choir.map(function (c) { return c.personId + ':' + c.postId; }).join(',');
    if (oldChoir !== newChoir || before.choirInvalid.length > 0) {
      setConfigValue_(CONFIG_KEYS.CHOIR_SUNDAY_ALLOWED, newChoir, 'apiSaveRuleExtras', '影音組合及協唱：改 Config');
      changed.choir = true;
    }

    let hasVersion = false;
    try { hasVersion = !!id && findLatestVersionNo_(id) >= 0; } catch (err) { hasVersion = false; }
    const any = changed.teams > 0 || changed.singers > 0 || changed.choir;
    const parts = [];
    if (changed.teams > 0) parts.push('影音組合');
    if (changed.singers > 0) parts.push('協唱');
    if (changed.choir) parts.push('詩班獻詩日照樣可以擔任的崗位');
    const versionNote = any && hasVersion ? '這一季已經有版本，新設定要按〔請系統幫我調整〕之後才會反映。' : '';
    return {
      ok: true, changed: changed, hasVersion: hasVersion, createdSheets: created, versionNote: versionNote,
      message: any ? '已儲存：' + parts.join('、') + '。' + (versionNote ? versionNote : '之後生成職事表時會用新設定。') : '沒有改動。'
    };
  });
}
