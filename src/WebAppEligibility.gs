/**
 * 第二十五輪批次階段 E3：區三畫面三——崗位資格（`Eligibility`）。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.4 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢張表決定咗「系統肯排邊個」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 系統只會排**曾任該崗位**嘅人。新人一定要喺呢度加，
 * **系統唔會自己擴充**。呢句要寫喺畫面頂——唔講嘅話幹事會等一個
 * 永遠唔會發生嘅「系統自己學識」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 規模同渲染策略（約 90 人 × 16 崗位 = 1440 格）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 後端一次過回全部資料（1440 個布林值 ＋ 歷史次數，JSON 唔算大）。
 * **分頁／過濾係前端嘅事**——後端分頁嘅話，「合資格 N 人」呢個統計
 * 就會變成「當前頁嘅 N 人」，即係一個錯嘅數字，而幹事完全睇唔出。
 *
 * 統計數字（每個崗位幾多人合資格）一律**由後端喺完整資料上面計**，
 * 前端點樣分頁都唔會影響嗰個數。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 取消勾 ≠ 刪行
 * ─────────────────────────────────────────────────────────────────────
 *
 * 取消勾一律寫 `Active=FALSE`，**唔刪行**——`HistoricalCount` 要保留。
 * 刪咗嘅話，日後重新勾返就會由零開始計，而嗰個人其實做過好多次。
 */

/** 少過呢個人數就算「太少人」，畫面上紅字。 */
const ELIGIBILITY_THIN_THRESHOLD = 3;

/**
 * 第二十六輪批次階段 D1：列出**唔會自動排**嘅崗位。
 *
 * 兩個來源，兩個都要睇：
 *   `Posts.AutoGenerate = FALSE`
 *   `HARD_NO_AUTO_PREACHER` 規則嘅 `ScopePostIDs`
 *
 * ⚠️ **唔寫死崗位代碼。** 講員／翻譯／獻花嘅 PostID 喺唔同試算表可能唔同，
 * 寫死就會喺換咗代碼之後靜靜失效——而失效嘅表現係「警告又出返」，
 * 一個睇落好似冇壞嘅退步。
 *
 * @returns {string[]} PostID 清單
 */
function listNoAutoAssignPostIds_() {
  const ids = {};

  try {
    readPosts().forEach(function (row) {
      if (isTrueValue_(row[COLUMNS.POSTS.AUTO_GENERATE])) return;
      const id = String(row[COLUMNS.POSTS.POST_ID] || '').trim();
      if (id) ids[id] = true;
    });
  } catch (err) {
    log_('WARN', 'listNoAutoAssignPostIds_ 讀不到 Posts：' + err.message);
  }

  try {
    const rules = readRules();
    const rule = rules[RULE_IDS.NO_AUTO_GENERATE];
    if (rule) {
      splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]).forEach(function (id) {
        const trimmed = String(id || '').trim();
        if (trimmed) ids[trimmed] = true;
      });
    }
  } catch (err) {
    log_('WARN', 'listNoAutoAssignPostIds_ 讀不到 RuleSettings：' + err.message);
  }

  return Object.keys(ids);
}

/**
 * 攞整個資格矩陣。**純讀取。**
 * @returns {Object} 見規格 4.4
 */
function apiGetEligibilityMatrix() {
  assertWebAppRequestAllowed_();

  beginSheetReadMemo_();
  try {
    const E = COLUMNS.ELIGIBILITY;
    const M = COLUMNS.NAME_MAPPING;

    // ⚠️ 第二十六輪批次階段 D1：邊啲崗位**唔應該計入「合資格人數太少」警告**。
    //
    // Ivan 實測見到紅框：「有 2 個崗位的合資格人數少於 3 人：講員 0／翻譯 0」。
    // **呢個警告係錯嘅。** 講員／翻譯／獻花由 `HARD_NO_AUTO_PREACHER` 規定
    // 一律留空、永不自動排，所以合資格 0 人係**正常而且正確**。
    // 呢個警告每次開畫面都會出，令幹事以為有嘢未做好，而實際上冇嘢要做。
    //
    // 同上一輪嘅「39 格」係同一個 bug class：
    // **一個數字計嗰陣冇理會「呢個崗位到底使唔使排」。**
    //
    // 判斷一律由資料讀出——`Posts.AutoGenerate` ＋ 規則嘅 `ScopePostIDs`，
    // **唔寫死崗位代碼**（崗位代碼喺唔同試算表可能唔同，寫死就會靜靜失效）。
    const noAutoPostIds = listNoAutoAssignPostIds_();

    const posts = readPosts().map(function (row) {
      const postId = String(row[COLUMNS.POSTS.POST_ID] || '').trim();
      return {
        postId: postId,
        postNameTC: String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim(),
        // 唔自動排 ⇒ 唔計入「人數太少」警告（但格子照樣顯示，
        // 幹事仍然可以喺呢度加資格——只係唔會被當成問題）
        autoAssigned: noAutoPostIds.indexOf(postId) === -1
      };
    }).filter(function (p) { return p.postId !== ''; });

    const people = [];
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const personId = String(row[M.PERSON_ID] || '').trim();
      if (!personId) return;
      // 停用嘅人照顯示（佢哋可能仲有資格紀錄要睇），但標示出嚟。
      people.push({
        personId: personId,
        nameTC: String(row[M.NAME_TC] || '').trim() || personId,
        nameEN: String(row[M.NAME_EN] || '').trim(),
        active: isTrueValue_(row[M.ACTIVE])
      });
    });
    people.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });

    // 格內容：`PersonID|PostID` → {eligible, historicalCount}
    const cells = {};
    readSheet(SHEETS.ELIGIBILITY).forEach(function (row) {
      const personId = String(row[E.PERSON_ID] || '').trim();
      const postId = String(row[E.POST_ID] || '').trim();
      if (!personId || !postId) return;
      cells[personId + '|' + postId] = {
        eligibilityId: String(row[E.ELIGIBILITY_ID] || '').trim(),
        // 「有資格」＝ Eligible 同 Active 兩樣都要 TRUE。
        // 只睇 Eligible 就會令取消咗嘅資格重新生效。
        eligible: isTrueValue_(row[E.ELIGIBLE]) && isTrueValue_(row[E.ACTIVE]),
        historicalCount: Number(row[E.HISTORICAL_COUNT]) || 0
      };
    });

    // ⚠️ 統計一律喺**完整資料**上面計，唔理前端點樣分頁過濾。
    const perPost = {};
    posts.forEach(function (p) { perPost[p.postId] = 0; });
    const perPerson = {};
    people.forEach(function (person) {
      perPerson[person.personId] = 0;
      posts.forEach(function (p) {
        const c = cells[person.personId + '|' + p.postId];
        if (c && c.eligible) {
          perPerson[person.personId]++;
          perPost[p.postId]++;
        }
      });
    });

    return {
      posts: posts.map(function (p) {
        return {
          postId: p.postId,
          postNameTC: p.postNameTC,
          eligibleCount: perPost[p.postId],
          autoAssigned: p.autoAssigned,
          // ⚠️ 唔自動排嘅崗位**永遠唔會**標成 thin——0 人係正常。
          thin: p.autoAssigned && perPost[p.postId] < ELIGIBILITY_THIN_THRESHOLD
        };
      }),
      people: people.map(function (person) {
        return {
          personId: person.personId,
          nameTC: person.nameTC,
          nameEN: person.nameEN,
          active: person.active,
          postCount: perPerson[person.personId]
        };
      }),
      cells: cells,
      thinThreshold: ELIGIBILITY_THIN_THRESHOLD
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 批次儲存資格改動。**會寫入。**
 *
 * @param {Object[]} changes 每項 {personId, postId, eligible}
 * @returns {Object} {ok, added, removed, skipped}
 */
function apiSaveEligibilityBatch(changes) {
  assertWebAppRequestAllowed_();
  const list = changes || [];
  if (list.length === 0) {
    return { ok: true, added: 0, removed: 0, skipped: 0, notes: '沒有任何改動。' };
  }

  const E = COLUMNS.ELIGIBILITY;
  const opened = openSheetForEdit_(SHEETS.ELIGIBILITY);
  const nameIndex = buildPersonNameIndex_();
  const postNames = {};
  readPosts().forEach(function (row) {
    postNames[String(row[COLUMNS.POSTS.POST_ID] || '').trim()] =
      String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim();
  });

  // 先讀一次現況，逐項比對——避免逐項各讀一次成張表。
  const existing = {};
  readSheet(SHEETS.ELIGIBILITY).forEach(function (row, i) {
    const personId = String(row[E.PERSON_ID] || '').trim();
    const postId = String(row[E.POST_ID] || '').trim();
    if (!personId || !postId) return;
    existing[personId + '|' + postId] = { record: row, sheetRow: i + 3 };
  });

  const actor = Session.getActiveUser().getEmail();
  // ⚠️ AddedAt 一定要**格式化**先寫入。第二十二輪已經喺 QuarterReset.gs
  // 撞過同一件事：未格式化嘅 Date 物件顯示出嚟係
  // `Mon Aug 17 2026 ... GMT+1200`，而且排序會用字串比大細。
  const todayStr = Utilities.formatDate(
    new Date(), getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE), 'yyyy-MM-dd');

  let added = 0;
  let removed = 0;
  let skipped = 0;

  list.forEach(function (change) {
    const personId = String(change.personId || '').trim();
    const postId = String(change.postId || '').trim();
    if (!personId || !postId) { skipped++; return; }
    const wantEligible = change.eligible === true;
    const key = personId + '|' + postId;
    const label = (nameIndex[personId] || personId) + '　' + (postNames[postId] || postId);
    const hit = existing[key];

    if (hit) {
      const wasEligible = isTrueValue_(hit.record[E.ELIGIBLE]) && isTrueValue_(hit.record[E.ACTIVE]);
      if (wasEligible === wantEligible) { skipped++; return; }

      const updates = {};
      updates[E.ELIGIBLE] = wantEligible ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
      // ⚠️ 取消勾一律寫 Active=FALSE，**唔刪行**——HistoricalCount 要保留。
      updates[E.ACTIVE] = wantEligible ? BOOLEAN_TEXT.TRUE : BOOLEAN_TEXT.FALSE;
      if (wantEligible) {
        updates[E.SOURCE] = '手動';
        updates[E.ADDED_BY] = actor;
        updates[E.ADDED_AT] = todayStr;
      }
      writeRowFields_(opened.sheet, opened.headers, hit.sheetRow, updates);
      writeZone3Audit_({
        action: wantEligible ? 'ELIGIBILITY_ENABLE' : 'ELIGIBILITY_DISABLE',
        targetSheet: SHEETS.ELIGIBILITY,
        targetKey: String(hit.record[E.ELIGIBILITY_ID] || key),
        oldValue: '有資格=' + (wasEligible ? '是' : '否'),
        newValue: '有資格=' + (wantEligible ? '是' : '否'),
        notes: label + (wantEligible ? '' : '（沒有刪行，保留歷史次數）')
      });
      if (wantEligible) added++; else removed++;
      return;
    }

    // 本來完全冇呢一格。取消勾一個唔存在嘅資格＝乜都唔使做。
    if (!wantEligible) { skipped++; return; }

    const record = {};
    record[E.ELIGIBILITY_ID] = 'ELIG-' + compactTimestamp_() + '-' + (added + 1);
    record[E.PERSON_ID] = personId;
    record[E.POST_ID] = postId;
    record[E.ELIGIBLE] = BOOLEAN_TEXT.TRUE;
    record[E.HISTORICAL_COUNT] = 0;
    record[E.SOURCE] = '手動';
    record[E.ADDED_BY] = actor;
    record[E.ADDED_AT] = todayStr;
    record[E.ACTIVE] = BOOLEAN_TEXT.TRUE;
    appendRowFields_(opened.sheet, opened.headers, record);
    writeZone3Audit_({
      action: 'ELIGIBILITY_ADD',
      targetSheet: SHEETS.ELIGIBILITY,
      targetKey: record[E.ELIGIBILITY_ID],
      oldValue: '（沒有這一格）',
      newValue: '有資格=是',
      notes: label
    });
    added++;
  });

  return { ok: true, added: added, removed: removed, skipped: skipped };
}
