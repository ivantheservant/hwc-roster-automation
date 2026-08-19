/**
 * 第二十六輪批次階段 C4：區三畫面六——排表偏好。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.6 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢個畫面同「崗位資格」嘅分別
 * ─────────────────────────────────────────────────────────────────────
 *
 * 「崗位資格」答嘅係「邊個**可以**做」。
 * 呢個畫面答嘅係「邊個**做幾多次**」。
 *
 * 兩件事一定要分開改——混埋一齊嘅話，幹事想「少排佢一次」就會去
 * 取消佢嘅資格，而嗰個等於「以後永遠唔會排佢」，兩件完全唔同嘅事。
 *
 * ⚠️ **解除一筆偏好＝填 `EffectiveTo` 為今日，唔刪行。**
 * 要睇得返「嗰陣時堂委係點決定嘅」。
 */

/** 畫面下拉嘅選項。**唔俾幹事打數字**——打錯一個負號就完全相反。 */
const PERSON_POST_WEIGHT_CHOICES = [
  { adjust: 2, label: '多兩次' },
  { adjust: 1, label: '多一次' },
  { adjust: 0, label: '一般（預設）' },
  { adjust: -1, label: '少一次' },
  { adjust: -2, label: '少兩次' }
];

/**
 * 攞排表偏好矩陣。**純讀取。**
 *
 * ⚠️ 只顯示**有排過該崗位或者有該崗位資格**嘅人——
 * 90 × 16 個空下拉對幹事嚟講係一幅噪音，佢會搵唔到想改嗰個人。
 *
 * @param {string=} quarterId 用嚟計「呢一季已經排咗幾多次」。
 *   ⚠️ 冇傳、或者嗰季仲未有版本，`quarterLoad` 會係 `null`
 *   ——即係「查不到」，**唔係「零次」**。前端見到 null 就唔會講
 *   「他還沒有接近上限」，因為根本冇檢查過。
 * @returns {Object} 見規格 4.6
 */
function apiGetPersonPostWeightMatrix(quarterId) {
  assertWebAppRequestAllowed_();

  beginSheetReadMemo_();
  try {
    const E = COLUMNS.ELIGIBILITY;
    const M = COLUMNS.NAME_MAPPING;
    const W = COLUMNS.PERSON_POST_WEIGHT;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

    const posts = readPosts()
      .filter(function (row) {
        // 唔自動排嘅崗位（講員／翻譯／獻花）冇「排幾多次」呢個概念。
        return isTrueValue_(row[COLUMNS.POSTS.AUTO_GENERATE]);
      })
      .map(function (row) {
        return {
          postId: String(row[COLUMNS.POSTS.POST_ID] || '').trim(),
          postNameTC: String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim()
        };
      })
      .filter(function (p) { return p.postId !== ''; });

    const nameById = {};
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const id = String(row[M.PERSON_ID] || '').trim();
      if (id) nameById[id] = String(row[M.NAME_TC] || '').trim() || id;
    });

    // 「有資格」＝ Eligibility 有一行而且 Eligible／Active 都 TRUE。
    const eligibleByPost = {};
    readSheet(SHEETS.ELIGIBILITY).forEach(function (row) {
      const personId = String(row[E.PERSON_ID] || '').trim();
      const postId = String(row[E.POST_ID] || '').trim();
      if (!personId || !postId) return;
      if (!isTrueValue_(row[E.ELIGIBLE]) || !isTrueValue_(row[E.ACTIVE])) return;
      if (!eligibleByPost[postId]) eligibleByPost[postId] = [];
      eligibleByPost[postId].push(personId);
    });

    // 現正生效嘅偏好（今日做參考日期）
    const active = readActivePersonPostWeights_(today, timezone);

    // 全部偏好行（含已解除嘅），供畫面顯示「以前改過乜」
    let allRows = [];
    try {
      allRows = readOptionalSheet_(SHEETS.PERSON_POST_WEIGHT).map(function (row) {
        return {
          weightId: String(row[W.WEIGHT_ID] || '').trim(),
          personId: String(row[W.PERSON_ID] || '').trim(),
          postId: String(row[W.POST_ID] || '').trim(),
          adjust: Number(row[W.ADJUST]) || 0,
          reason: String(row[W.REASON] || '').trim(),
          effectiveFrom: toDateString(row[W.EFFECTIVE_FROM], timezone),
          effectiveTo: toDateString(row[W.EFFECTIVE_TO], timezone),
          active: isTrueValue_(row[W.ACTIVE])
        };
      });
    } catch (err) {
      log_('INFO', 'PersonPostWeight 工作表未建立：' + err.message);
    }

    // 第二十七輪批次階段 B2：呢一季每個人已經排咗幾多次、上限係幾多。
    const load = readQuarterLoadForWeights_(quarterId);

    // ⚠️ 第二十八輪批次階段 A3：**每一行都要顯示基準同目標**，
    // 唔理有冇偏好。Ivan 實測撞到嘅根本問題係：
    // 佢揀咗「多一次」，但畫面上冇任何數字話俾佢知「多一次」係由幾多變到幾多，
    // 所以生成完之後亦冇辦法知道有冇生效。
    const baselineData = buildWeightBaselineDataSafely_(quarterId);
    // 本季已經排咗幾多次（逐個崗位）——同「上一季幾多次」擺埋一齊睇先有意思。
    const thisQuarterByKey = readThisQuarterPostCounts_(quarterId);

    const byPost = posts.map(function (p) {
      const ids = (eligibleByPost[p.postId] || []).slice().sort(function (a, b) {
        return (nameById[a] || a) < (nameById[b] || b) ? -1 : 1;
      });
      return {
        postId: p.postId,
        postNameTC: p.postNameTC,
        people: ids.map(function (id) {
          const hit = active.byKey[id + '|' + p.postId];
          const adjust = hit ? hit.adjust : 0;
          const base = resolveWeightBaseline_(id, p.postId, baselineData);
          const target = computeWeightTarget_(base.baseline, adjust);
          return {
            personId: id,
            nameTC: nameById[id] || id,
            adjust: adjust,
            reason: hit ? hit.reason : '',
            weightId: hit ? hit.weightId : '',
            baseline: base.baseline,
            baselineSource: base.source,
            target: target,
            // 一句人話，前端直接印——**唔可以前端自己再砌一次**，
            // 兩邊各砌一次就會有一日兩個畫面講唔同嘅嘢。
            baselineText: describeWeightBaseline_(base, p.postNameTC, target),
            // null ＝ 查不到（呢一季未有版本）。**唔係 0 次。**
            thisQuarterCount: thisQuarterByKey
              ? (thisQuarterByKey[id + '|' + p.postId] || 0) : null,
            // null ＝ 查不到（冇季度、冇版本、或者讀取失敗）
            quarterLoad: load.available ? (load.byPerson[id] || null) : null
          };
        })
      };
    });

    return {
      choices: PERSON_POST_WEIGHT_CHOICES,
      posts: byPost,
      activeCount: active.rows.length,
      invalid: active.invalid,
      // 前端要靠呢兩個字段分辨「查不到」同「查到但冇人接近上限」。
      // 兩者睇落一樣（都係冇黃字），但意思完全相反。
      loadAvailable: load.available,
      loadUnavailableReason: load.reason,
      history: allRows.filter(function (r) { return r.effectiveTo !== ''; })
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 第二十八輪批次階段 A3：安全咁攞基準資料。
 *
 * 基準資料要讀四張表。任何一張出問題都唔應該令整個編輯畫面開唔到
 * ——冇基準只係少咗一行提示，而開唔到係幹事完全用唔到。
 * 攞唔到就回 `null`，而 `resolveWeightBaseline_()` 收到 null 會標示
 * 「還沒有算基準」，**唔會扮成 0 次**。
 * @param {string} quarterId
 * @returns {?Object}
 */
function buildWeightBaselineDataSafely_(quarterId) {
  const id = String(quarterId || '').trim();
  if (!id) return null;
  try {
    return buildWeightBaselineData_(
      id, getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE));
  } catch (err) {
    log_('WARN', '排表偏好畫面讀不到基準資料：' + err.message);
    return null;
  }
}

/**
 * 本季最新版本、逐個 (人, 崗位) 已經排咗幾多次。
 *
 * ⚠️ 回 `null` ＝ **查不到**（未有版本／讀取失敗），唔係「全部 0 次」。
 * 前端見到 null 就唔會顯示「今季已排 N 次」——顯示 0 等於話
 * 「已經排過，而且排咗 0 次」，同「仲未生成」係兩件事。
 * @param {string} quarterId
 * @returns {?Object.<string, number>}
 */
function readThisQuarterPostCounts_(quarterId) {
  const id = String(quarterId || '').trim();
  if (!id) return null;
  try {
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) return null;
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    const byKey = {};
    readVersionAssignmentsRaw_(id, versionNo).forEach(function (row) {
      const personId = String(row[A.PERSON_ID] || '').trim();
      const postId = String(row[A.POST_ID] || '').trim();
      if (!personId || !postId) return;
      const key = personId + '|' + postId;
      byKey[key] = (byKey[key] || 0) + 1;
    });
    return byKey;
  } catch (err) {
    log_('WARN', '排表偏好畫面讀不到本季派工：' + err.message);
    return null;
  }
}

/**
 * 第二十七輪批次階段 B2：讀「呢一季每個人已經排咗幾多次、上限係幾多」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個
 * ─────────────────────────────────────────────────────────────────────
 *
 * 離線驗收顯示：四行偏好之中兩行「冇變」，原因係嗰兩位已經撞到
 * `MaxPerQuarter` 上限，而偏好係軟嘅，唔會突破上限。機制係啱嘅，
 * 但**幹事揀咗「多一次」而乜都冇發生，畫面唔會解釋點解**。
 * 佢只會得出一個結論：「呢個功能壞咗」。
 *
 * ⚠️ 回傳一定要分得出「查不到」同「查到，冇人接近上限」。
 * 兩者喺畫面上睇落一樣（都係冇黃字），但意思完全相反——
 * 呢個就係本專案撞過好多次嗰個 bug class。
 *
 * @param {string=} quarterId
 * @returns {{available: boolean, reason: string, byPerson: Object}}
 */
function readQuarterLoadForWeights_(quarterId) {
  const none = function (reason) {
    return { available: false, reason: reason, byPerson: {} };
  };
  const id = String(quarterId || '').trim();
  if (!id) return none('還沒有選季度，所以看不到誰接近每季上限。');

  try {
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) {
      return none('這一季還沒有生成過任何版本，所以看不到誰接近每季上限。');
    }

    const peopleById = indexPeopleById_();
    // ⚠️ 上限有三層（個人值 ▸ RuleSettings TargetValue ▸ Config 預設）。
    // 呢度用返同排表一樣嗰個 resolve 函式，唔可以自己再寫一次
    // ——寫兩次就一定會有一日分岔，而畫面同排表講唔同嘅嘢係最難查嘅一種。
    const limitContext = {
      rules: readRules(),
      defaultLimit:
        Number(getConfig(CONFIG_KEYS.DEFAULT_MAX_PER_QUARTER, DEFAULTS.MAX_PER_QUARTER))
        || DEFAULTS.MAX_PER_QUARTER
    };

    const counts = {};
    readVersionAssignmentsRaw_(id, versionNo).forEach(function (a) {
      if (!a.personId) return;
      counts[a.personId] = (counts[a.personId] || 0) + 1;
    });

    const byPerson = {};
    Object.keys(counts).forEach(function (personId) {
      const limit = resolveWeightQuarterLimit_(peopleById[personId], limitContext);
      if (limit === null) return;   // 上限查不到 ⇒ 唔擺呢個人，唔擺一個估出嚟嘅值
      byPerson[personId] = {
        count: counts[personId],
        limit: limit,
        // 「接近」＝ 差一次或以下。差兩次仲有空間，講出嚟只會變成噪音。
        near: counts[personId] >= limit - 1,
        atLimit: counts[personId] >= limit
      };
    });

    return { available: true, reason: '', byPerson: byPerson };
  } catch (err) {
    log_('WARN', '讀不到季度用人量（排表偏好畫面）：' + err.message);
    return none('讀不到這一季的派工紀錄（' + err.message + '），'
      + '所以看不到誰接近每季上限。');
  }
}

/**
 * 批次儲存偏好改動。**會寫入。**
 *
 * 三種動作：
 *   新增（本來冇偏好，而家揀咗多／少 N 次）⇒ 加一行
 *   改動（本來有偏好，而家換咗另一個數字）⇒ 解除舊行 ＋ 加新行
 *   解除（本來有偏好，而家揀返「一般」）⇒ **填 EffectiveTo，唔刪行**
 *
 * ⚠️ 「改動」特登做成「解除舊行 ＋ 加新行」而唔係就地改個數字：
 * 就地改嘅話，「上一次係幾多、幾時改嘅、點解改」就冇咗。
 * 堂委下次開會問「舊年我哋decide咗幾多」就答唔到。
 *
 * @param {Object[]} changes 每項 {personId, postId, adjust, reason}
 * @returns {Object} {ok, added, released, skipped}
 */
function apiSavePersonPostWeightBatch(changes) {
  assertWebAppRequestAllowed_();
  const list = changes || [];
  if (list.length === 0) {
    return { ok: true, added: 0, released: 0, skipped: 0, notes: '沒有任何改動。' };
  }

  const W = COLUMNS.PERSON_POST_WEIGHT;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

  // 每一筆改動都要有原因——冇原因嘅偏好，三個月後冇人記得點解。
  const missingReason = list.filter(function (c) {
    return String(c.reason || '').trim() === '';
  });
  if (missingReason.length > 0) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '有 ' + missingReason.length + ' 項改動沒有填原因。',
        '什麼都沒有儲存。',
        [
          '每一項偏好都要填原因（例如「堂委 2026-08 決議」）',
          '三個月之後，沒有原因的偏好沒有人記得為什麼要這樣改'
        ])
    };
  }

  const outOfRange = list.filter(function (c) {
    const a = Math.round(Number(c.adjust));
    return isNaN(a) || a < PERSON_POST_WEIGHT_MIN || a > PERSON_POST_WEIGHT_MAX;
  });
  if (outOfRange.length > 0) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '有 ' + outOfRange.length + ' 項的數值超出範圍。',
        '什麼都沒有儲存。',
        ['偏好只可以是「多兩次」到「少兩次」之間'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.PERSON_POST_WEIGHT);
  const nameIndex = buildPersonNameIndex_();
  const postNames = {};
  readPosts().forEach(function (row) {
    postNames[String(row[COLUMNS.POSTS.POST_ID] || '').trim()] =
      String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim();
  });

  // 現正生效嘅行，逐個 (人|崗位) 索引到列號
  const existing = {};
  readOptionalSheet_(SHEETS.PERSON_POST_WEIGHT).forEach(function (row, i) {
    const personId = String(row[W.PERSON_ID] || '').trim();
    const postId = String(row[W.POST_ID] || '').trim();
    if (!personId || !postId) return;
    if (!isTrueValue_(row[W.ACTIVE])) return;
    const to = toDateString(row[W.EFFECTIVE_TO], timezone);
    if (to && to < today) return;   // 已經解除
    existing[personId + '|' + postId] = { record: row, sheetRow: i + 3 };
  });

  const actor = Session.getActiveUser().getEmail();
  let added = 0;
  let released = 0;
  let skipped = 0;

  list.forEach(function (change) {
    const personId = String(change.personId || '').trim();
    const postId = String(change.postId || '').trim();
    if (!personId || !postId) { skipped++; return; }
    const adjust = Math.round(Number(change.adjust));
    const reason = String(change.reason || '').trim();
    const label = (nameIndex[personId] || personId) + '　' + (postNames[postId] || postId);
    const hit = existing[personId + '|' + postId];
    const wasAdjust = hit ? (Number(hit.record[W.ADJUST]) || 0) : 0;
    if (wasAdjust === adjust) { skipped++; return; }

    // 解除舊嗰行（**填 EffectiveTo，唔刪行**）
    if (hit) {
      const releaseUpdates = {};
      releaseUpdates[W.EFFECTIVE_TO] = today;
      writeRowFields_(opened.sheet, opened.headers, hit.sheetRow, releaseUpdates);
      writeZone3Audit_({
        action: 'WEIGHT_RELEASE',
        targetSheet: SHEETS.PERSON_POST_WEIGHT,
        targetKey: String(hit.record[W.WEIGHT_ID] || personId + '|' + postId),
        oldValue: 'Adjust=' + wasAdjust,
        newValue: 'EffectiveTo=' + today + '（解除，沒有刪行）',
        notes: label
      });
      released++;
    }

    // 揀返「一般」＝ 淨係解除，唔加新行
    if (adjust === 0) return;

    const record = {};
    record[W.WEIGHT_ID] = 'WGT-' + compactTimestamp_() + '-' + (added + 1);
    record[W.PERSON_ID] = personId;
    record[W.POST_ID] = postId;
    record[W.ADJUST] = adjust;
    record[W.REASON] = reason;
    record[W.EFFECTIVE_FROM] = today;
    record[W.EFFECTIVE_TO] = '';
    record[W.ACTIVE] = BOOLEAN_TEXT.TRUE;
    // ⚠️ CreatedAt 一定要**格式化**先寫入（第二十二輪喺 QuarterReset.gs
    // 撞過同一件事：未格式化嘅 Date 顯示出嚟係一串 GMT 文字）。
    record[W.CREATED_AT] = nowTimestamp_();
    record[W.CREATED_BY] = actor;
    appendRowFields_(opened.sheet, opened.headers, record);
    writeZone3Audit_({
      action: 'WEIGHT_ADD',
      targetSheet: SHEETS.PERSON_POST_WEIGHT,
      targetKey: record[W.WEIGHT_ID],
      oldValue: hit ? 'Adjust=' + wasAdjust : '（沒有偏好）',
      newValue: 'Adjust=' + adjust,
      notes: label + '　原因：' + reason
    });
    added++;
  });

  return { ok: true, added: added, released: released, skipped: skipped };
}
