/**
 * 第九十八輪批次 YA 組：開季前準備〔預先安排領詩、司琴〕。
 *
 * ── 為甚麼 ────────────────────────────────────────────────────────
 * 領詩、司琴（`AutoGenerate=FALSE`）生成時留空，要生成之後在表上人手填，開季前沒有地方輸入；
 * 同日不兼任（`SAME_DAY_EXCLUSIVE_POST_IDS`）亦因此在生成時避不開他們。
 *
 * ── 資料 ──────────────────────────────────────────────────────────
 * 工作表 `PreAssignments`（第一次儲存時自動建立；第 1 行中文標題、第 2 行機器鍵）：
 * QuarterID、ServiceDate、PostID、SlotIndex、PersonID、FreeText、UpdatedAt、UpdatedBy。
 * 可以預先安排的崗位由 Config `PREASSIGN_POST_IDS`（預設 WORSHIP,PIANO）決定，崗位名稱讀 `Posts`，不寫死。
 *
 * ── 用在哪裏 ──────────────────────────────────────────────────────
 *   ・生成：預先安排的格直接放入新版本（`AssignSource=PREASSIGNED`），並作為同日不兼任的保留
 *     （Generator.gs `buildSameDayReservedForWeek_()`）
 *   ・〔請系統幫我調整〕：表上該格和預先安排不同 ⇒ 建議改為預先安排的人（「依開季前預先安排」）；
 *     預先安排是空白 ⇒ 不改（SuggestionSheet.gs）
 *   ・狀態卡黃框：表上有格和預先安排不同
 *   ・人手檢查（`readSameDayFixedCells_()`）、義工申報確認畫面、季前資料
 */

const PREASSIGN_EXPLANATION = '這裏填的人會直接放入職事表，系統排其他崗位時會避開他們同日的其他崗位。'
  + '生成之後再改也可以，按〔請系統幫我調整〕或〔儲存〕時會用最新的安排。';
const PREASSIGN_SUGGEST_REASON = '依開季前預先安排';
const PREASSIGN_AUDIT_ACTION = 'PRE_ASSIGN_SAVED';

const PRE_ASSIGNMENTS_TITLES_TC = ['季度', '主日', '崗位', '第幾位', '人（PersonID）', '其他（自己輸入）', '更新時間', '更新者'];

/** @returns {string[]} 機器鍵（次序同中文標題一致） */
function preAssignmentKeys_() {
  const P = COLUMNS.PRE_ASSIGNMENTS;
  return [P.QUARTER_ID, P.SERVICE_DATE, P.POST_ID, P.SLOT_INDEX, P.PERSON_ID, P.FREE_TEXT, P.UPDATED_AT, P.UPDATED_BY];
}

/**
 * 可以預先安排的崗位（Config `PREASSIGN_POST_IDS`，只留 Posts 上有的；次序照 Posts）。
 * @returns {Object[]} 正規化崗位 {postId, postNameTC, slotCount, ...}
 */
function readPreAssignPosts_() {
  const ids = parseSameDayExclusivePostIds_(getConfig_(CONFIG_KEYS.PREASSIGN_POST_IDS, 'WORSHIP,PIANO'));
  return readPostsNormalized_().filter(function (p) { return ids.indexOf(p.postId) !== -1; });
}

/**
 * 取得（必要時建立）`PreAssignments` 工作表。
 * @returns {Sheet}
 */
function ensurePreAssignmentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.PRE_ASSIGNMENTS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.PRE_ASSIGNMENTS);
  const keys = preAssignmentKeys_();
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0] : [];
  if (!keys.every(function (k, i) { return existing[i] === k; })) {
    sheet.getRange(1, 1, 1, PRE_ASSIGNMENTS_TITLES_TC.length).setValues([PRE_ASSIGNMENTS_TITLES_TC]);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]);
  }
  return sheet;
}

/**
 * 這一季的預先安排（只限 `PREASSIGN_POST_IDS` 的崗位；空白的格不回傳）。工作表不存在 ⇒ {}。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object.<string, {serviceDate: string, postId: string, slotIndex: number, personId: string, freeText: string}>}
 *   鍵＝`date|postId|slot`
 */
function readPreAssignments_(quarterId, timezone) {
  const out = {};
  let rows;
  try {
    rows = readSheet_(SHEETS.PRE_ASSIGNMENTS);
  } catch (err) {
    return out;   // 未建立＝沒有預先安排
  }
  const allowed = readPreAssignPosts_().map(function (p) { return p.postId; });
  // 合堂主日等不設的格不算（例如先填了、之後才設定合堂）
  const blockedOf = buildPreAssignBlockedLookup_(quarterId, timezone);
  const P = COLUMNS.PRE_ASSIGNMENTS;
  rows.forEach(function (r) {
    if (String(r[P.QUARTER_ID] || '').trim() !== quarterId) return;
    const postId = String(r[P.POST_ID] || '').trim();
    if (allowed.indexOf(postId) === -1) return;
    const personId = String(r[P.PERSON_ID] || '').trim();
    const freeText = String(r[P.FREE_TEXT] === null || r[P.FREE_TEXT] === undefined ? '' : r[P.FREE_TEXT]).trim();
    if (!personId && !freeText) return;
    const serviceDate = toDateString_(r[P.SERVICE_DATE], timezone);
    const slotIndex = Number(r[P.SLOT_INDEX]) || 1;
    if (!serviceDate || blockedOf(serviceDate, postId)) return;
    out[cellKey_(serviceDate, postId, slotIndex)] = { serviceDate: serviceDate, postId: postId, slotIndex: slotIndex,
      personId: personId, freeText: personId ? '' : freeText };
  });
  return out;
}

/** 讀不到也不令呼叫者失敗（狀態卡、人手檢查、確認畫面、季前資料用）。 */
function readPreAssignmentsSafe_(quarterId, timezone) {
  try {
    return readPreAssignments_(quarterId, timezone);
  } catch (err) {
    log_('WARN', 'readPreAssignmentsSafe_（' + quarterId + '）讀不到預先安排，當作沒有：' + err.message);
    return {};
  }
}

/**
 * 哪些格不可以預先安排：合堂主日（`ServiceDates.CombinedKind` 有值）⇒「合堂」；
 * 特別主日 `SkipPostIDs` 有這個崗位 ⇒「不設」。畫面、儲存、讀取（生成、調整、狀態卡）都用這一支。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {function(string, string): string} (serviceDate, postId) → 「合堂」／「不設」／空字串（可以填）
 */
function buildPreAssignBlockedLookup_(quarterId, timezone) {
  const specialByDate = buildSpecialSundayByDate_(readSpecialSundays_(quarterId), timezone);
  const combinedByDate = {};
  try {
    readCombinedServices_(quarterId, timezone).forEach(function (c) { if (c.kind) combinedByDate[c.serviceDate] = c.kind; });
  } catch (err) {
    log_('WARN', 'buildPreAssignBlockedLookup_ 讀不到合堂設定，當作沒有合堂：' + err.message);
  }
  return function (serviceDate, postId) {
    if (combinedByDate[serviceDate]) return '合堂';
    const sp = specialByDate[serviceDate];
    return sp && (sp.skipPostIds || []).indexOf(postId) !== -1 ? '不設' : '';
  };
}

/**
 * 供前端呼叫：〔預先安排領詩、司琴〕畫面。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} {quarterId, quarterLabel, explanation, posts:[{postId, postNameTC, slotCount, options:[{personId, nameTC}]}],
 *   weeks:[{serviceDate, cells:[{postId, slotIndex, personId, freeText, blocked}]}]}
 */
function apiGetPreAssignView(quarterId) {
  assertWebAppRequestAllowed_('apiGetPreAssignView');
  const id = String(quarterId || '').trim();
  beginSheetReadMemo_();
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const posts = readPreAssignPosts_();
    const allPosts = readPostsNormalized_();
    const eligibility = readEligibility_();
    const roleContext = buildRoleContext_(eligibility, allPosts, timezone);
    const names = readPersonNameIndex_();
    const active = {};
    readPeople_().forEach(function (r) {
      if (isTrueValue_(r[COLUMNS.NAME_MAPPING.ACTIVE])) active[String(r[COLUMNS.NAME_MAPPING.PERSON_ID] || '').trim()] = true;
    });
    const blockedOf = buildPreAssignBlockedLookup_(id, timezone);
    const pre = readPreAssignmentsSafe_(id, timezone);
    const dates = readServiceDatesNormalized_(id, timezone).map(function (d) { return d.serviceDate; }).sort();
    return {
      quarterId: id,
      quarterLabel: buildQuarterLabel_(id),
      explanation: PREASSIGN_EXPLANATION,
      posts: posts.map(function (p) {
        const ids = (roleContext.eligibleByPost[p.postId] || []).filter(function (pid) { return active[pid]; });
        return {
          postId: p.postId, postNameTC: p.postNameTC || p.postId, slotCount: p.slotCount || 1,
          options: ids.map(function (pid) { return { personId: pid, nameTC: names[pid] || pid }; })
            .sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : (a.nameTC > b.nameTC ? 1 : 0); })
        };
      }),
      weeks: dates.map(function (d) {
        const cells = [];
        posts.forEach(function (p) {
          for (let slot = 1; slot <= (p.slotCount || 1); slot++) {
            const cur = pre[cellKey_(d, p.postId, slot)] || {};
            cells.push({ postId: p.postId, slotIndex: slot, personId: cur.personId || '', freeText: cur.freeText || '',
              blocked: blockedOf(d, p.postId) });
          }
        });
        return { serviceDate: d, cells: cells };
      })
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：〔儲存〕預先安排。**會寫入 PreAssignments（第一次自動建立）＋AuditLog。**
 * @param {string} quarterId 季度 ID
 * @param {Object[]} cells 每項 {serviceDate, postId, slotIndex, personId, freeText}；兩者都空＝清除
 * @returns {{ok: boolean, changed: number, message: string, view: Object}}
 */
function apiSavePreAssignments(quarterId, cells) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('儲存預先安排', function () {
    return savePreAssignments_locked_(String(quarterId || '').trim(), cells);
  });
}

function savePreAssignments_locked_(quarterId, cells) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const posts = readPreAssignPosts_();
  const postIds = posts.map(function (p) { return p.postId; });
  const dates = readServiceDatesNormalized_(quarterId, timezone).map(function (d) { return d.serviceDate; });
  const blockedOf = buildPreAssignBlockedLookup_(quarterId, timezone);
  const people = readPersonNameIndex_();
  const bad = [];
  const wanted = (Array.isArray(cells) ? cells : []).map(function (c) {
    return {
      serviceDate: String((c && c.serviceDate) || '').trim(),
      postId: String((c && c.postId) || '').trim(),
      slotIndex: Number((c && c.slotIndex) || 1) || 1,
      personId: String((c && c.personId) || '').trim(),
      freeText: String((c && c.freeText) || '').trim()
    };
  }).filter(function (c) {
    if (postIds.indexOf(c.postId) === -1 || dates.indexOf(c.serviceDate) === -1) { bad.push(c.serviceDate + ' ' + c.postId); return false; }
    if (c.personId && !people[c.personId]) { bad.push(c.serviceDate + ' ' + c.postId + '（名單上找不到 ' + c.personId + '）'); return false; }
    const blocked = blockedOf(c.serviceDate, c.postId);
    if ((c.personId || c.freeText) && blocked) {
      bad.push(c.serviceDate + ' ' + c.postId + '（' + (blocked === '合堂' ? '合堂主日' : '這一日不設這個崗位') + '）');
      return false;
    }
    return true;
  });
  if (bad.length > 0) {
    return { ok: false, changed: 0, message: buildThreePartMessage_('有 ' + bad.length + ' 格不可以填：' + bad.join('、'),
      '甚麼都沒有寫入。', ['按〔重新整理〕再開一次這個畫面']) };
  }
  const sheet = ensurePreAssignmentsSheet_();
  const keys = preAssignmentKeys_();
  const P = COLUMNS.PRE_ASSIGNMENTS;
  const lastRow = sheet.getLastRow();
  const rowByKey = {};
  if (lastRow >= 3) {
    sheet.getRange(3, 1, lastRow - 2, keys.length).getValues().forEach(function (r, i) {
      if (String(r[0] || '').trim() !== quarterId) return;
      rowByKey[cellKey_(toDateString_(r[1], timezone), String(r[2] || '').trim(), Number(r[3]) || 1)] =
        { sheetRow: i + 3, personId: String(r[4] || '').trim(), freeText: String(r[5] || '').trim() };
    });
  }
  const now = nowTimestamp_();
  let actor = '';
  try { actor = String(Session.getActiveUser().getEmail() || ''); } catch (err) { actor = ''; }
  let changed = 0;
  wanted.forEach(function (c) {
    const key = cellKey_(c.serviceDate, c.postId, c.slotIndex);
    const freeText = c.personId ? '' : c.freeText;
    const old = rowByKey[key];
    if (old && old.personId === c.personId && old.freeText === freeText) return;
    if (!old && !c.personId && !freeText) return;
    const record = {};
    record[P.QUARTER_ID] = quarterId;
    record[P.SERVICE_DATE] = c.serviceDate;
    record[P.POST_ID] = c.postId;
    record[P.SLOT_INDEX] = c.slotIndex;
    record[P.PERSON_ID] = c.personId;
    record[P.FREE_TEXT] = freeText;
    record[P.UPDATED_AT] = now;
    record[P.UPDATED_BY] = actor;
    if (old) {
      sheet.getRange(old.sheetRow, 1, 1, keys.length).setValues([keys.map(function (k) { return record[k]; })]);
    } else {
      appendRowFields_(sheet, keys, record);
    }
    changed++;
  });
  if (changed > 0) {
    writeAuditLog_({
      action: PREASSIGN_AUDIT_ACTION,
      targetSheet: SHEETS.PRE_ASSIGNMENTS,
      targetKey: quarterId,
      oldValue: '',
      newValue: String(changed),
      source: 'apiSavePreAssignments',
      notes: '〔預先安排領詩、司琴〕改了 ' + changed + ' 格'
    });
  }
  return { ok: true, changed: changed, message: changed > 0 ? '已儲存（改了 ' + changed + ' 格）。' : '沒有改動。',
    view: apiGetPreAssignView(quarterId) };
}

/**
 * 表上（最新版本疊加未儲存的改動）和預先安排不同的格。**只讀。**預先安排空白的格不算。
 * @param {Object.<string, Object>} pre `readPreAssignments_()` 的結果
 * @param {Object[]} state 狀態（{serviceDate, postId, slotIndex, personId, freeText}）
 * @returns {Object[]} 不同的格 {key, serviceDate, postId, slotIndex, want}
 */
function listPreAssignMismatches_(pre, state) {
  const byKey = {};
  (state || []).forEach(function (s) { byKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] = s; });
  const out = [];
  Object.keys(pre || {}).forEach(function (key) {
    const want = pre[key];
    const cur = byKey[key];
    if (!cur) return;   // 這一版沒有這一格（例如不設）
    const same = want.personId
      ? String(cur.personId || '') === want.personId
      : (!cur.personId && String(cur.freeText || '').trim() === want.freeText);
    if (!same) out.push({ key: key, serviceDate: want.serviceDate, postId: want.postId, slotIndex: want.slotIndex, want: want });
  });
  return out.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
}

/**
 * 狀態卡黃框：「預先安排的領詩／司琴有 N 格和職事表不同，按〔請系統幫我調整〕更新。」（沒有不同 ⇒ 空字串）
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 最新版本號
 * @returns {{count: number, text: string}}
 */
function summarisePreAssignMismatch_(quarterId, versionNo) {
  const none = { count: 0, text: '' };
  if (!(versionNo >= 0)) return none;
  try {
    // 沒有預先安排 ⇒ 不用建 fine-tune context（主畫面載入不會因此變慢）
    const pre = readPreAssignmentsSafe_(quarterId, getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE));
    if (Object.keys(pre).length === 0) return none;
    const context = buildFineTuneContext_(quarterId, versionNo);
    const resolved = resolveAuthoritativeState_(context, STATE_SOURCE.GRID_OVERLAY, 'summarisePreAssignMismatch_');
    const diff = listPreAssignMismatches_(pre, resolved.state);
    if (diff.length === 0) return none;
    const names = readPreAssignPosts_().map(function (p) { return p.postNameTC || p.postId; }).join('／');
    return { count: diff.length, text: '預先安排的' + names + '有 ' + diff.length + ' 格和職事表不同，按〔請系統幫我調整〕更新。' };
  } catch (err) {
    log_('WARN', 'summarisePreAssignMismatch_ 算不到：' + err.message);
    return none;
  }
}

/**
 * 某人某日的預先安排（崗位名稱，「、」分隔；沒有 ⇒ 空字串）。義工申報確認畫面用。
 * @param {Object.<string, Object>} pre `readPreAssignments_()` 的結果
 * @param {string} personId 人
 * @param {string} serviceDate 日期
 * @returns {string}
 */
function describePreAssignedPosts_(pre, personId, serviceDate) {
  const names = {};
  readPreAssignPosts_().forEach(function (p) { names[p.postId] = p.postNameTC || p.postId; });
  const out = [];
  Object.keys(pre || {}).forEach(function (k) {
    const c = pre[k];
    if (c.personId === personId && c.serviceDate === serviceDate && out.indexOf(names[c.postId] || c.postId) === -1) out.push(names[c.postId] || c.postId);
  });
  return out.join('／');
}

/**
 * 〔請系統幫我調整〕：把狀態裏和開季前預先安排不同的格改成預先安排的人（**就地修改** state）。
 * 預先安排空白的格不改；表上已經是同一個人的格不改，但一樣當作「保留」（系統不會把他改走）。
 * @param {string} quarterId 季度 ID
 * @param {Object} context fine-tune context
 * @param {Object[]} state 狀態（GRID_OVERLAY）
 * @param {string} timezone 時區
 * @returns {{keys: Object.<string, boolean>, changed: Object[]}} keys＝預先安排的格（全部）；
 *   changed＝改了的格 {key, serviceDate, postId, postNameTC, slotIndex, fromName, toName}
 */
function applyPreAssignmentsToState_(quarterId, context, state, timezone) {
  const out = { keys: {}, changed: [] };
  const pre = readPreAssignmentsSafe_(quarterId, timezone);
  if (Object.keys(pre).length === 0) return out;
  const byKey = {};
  (state || []).forEach(function (s) { byKey[cellKey_(s.serviceDate, s.postId, s.slotIndex)] = s; });
  const nameOf = function (personId) {
    const p = (context.peopleById || {})[personId];
    return p ? p.nameTC : personId;
  };
  Object.keys(pre).forEach(function (k) { if (byKey[k]) out.keys[k] = true; });
  listPreAssignMismatches_(pre, state).forEach(function (m) {
    const cell = byKey[m.key];
    const fromName = cell.personId ? nameOf(cell.personId) : String(cell.freeText || '').trim();
    cell.personId = m.want.personId;
    cell.freeText = m.want.personId ? '' : m.want.freeText;
    cell.assignSource = ASSIGN_SOURCE.PREASSIGNED;
    const post = findPostById_(context.posts, m.postId);
    out.changed.push({ key: m.key, serviceDate: m.serviceDate, postId: m.postId, postNameTC: post ? post.postNameTC : m.postId,
      slotIndex: m.slotIndex, fromName: fromName || '（空白）', toName: m.want.personId ? nameOf(m.want.personId) : m.want.freeText });
  });
  return out;
}
