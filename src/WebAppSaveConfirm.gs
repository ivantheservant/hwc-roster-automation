/**
 * 第二十三輪批次階段 D：掣 1「儲存並確認」。
 *
 * 對應 `docs/幹事介面規格_可入repo版.md` 第 2.4 節（步 1.1–1.9）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢粒掣係整個介面唯一會改動職事表內容嘅掣（規格 1.7）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 決定 D1：掣 1 **一次過**處理兩件事——「表上人手改動」同「`Requests`
 * 待處理申報」。點解合埋：幹事根本唔應該需要分辨呢兩者。
 * 對佢嚟講兩者都係「有嘢要入表」，分開兩粒掣只係把系統內部嘅資料結構
 * 洩漏到介面上。
 *
 * 決定 D3：喺 `REVIEW_SENT` 執行完之後 Stage 前進到 `REQUESTS_APPLIED`
 * ——否則掣 3 永遠撳唔到。
 *
 * ─────────────────────────────────────────────────────────────────────
 * Plan／Execute 分開兩個端點，而且 Execute 唔信 Plan
 * ─────────────────────────────────────────────────────────────────────
 *
 * `apiSaveAndConfirmPlan()` 純讀取、零寫入，俾前端畫確認畫面。
 * `apiSaveAndConfirmExecute()` **會重新跑一次 plan**，比對前端送嚟嘅決定
 * 係咪仲對應同一批格。
 *
 * ⚠️ 點解要重新跑：Web UI 每次請求都係獨立嘅。幹事由睇預覽到撳確認之間，
 * 可能過咗幾分鐘，期間佢自己（或者另一個分頁）可能改過 grid。
 * 照住一份過時嘅預覽寫入，就會寫入一個**冇人審視過**嘅結果——
 * 而畫面會顯示「成功」。呢種「每一步都成功、但結果唔係你以為嗰個」
 * 係最難察覺嘅一類錯。
 */

/** 掣 1 有真違反時要求逐字輸入嘅放行文字（規格 1.4：一律兩個字）。 */
const SAVE_CONFIRM_RELEASE_TEXT = '確認';

/**
 * 掣 1 步 1.1–1.6：**純讀取，零寫入。**
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 見規格 2.4；`blocked=true` 時只有 `blockReason` 同 `unresolved` 有意義
 */
function apiSaveAndConfirmPlan(quarterId) {
  assertWebAppRequestAllowed_();
  return buildSaveAndConfirmPlan_(quarterId);
}

/**
 * `apiSaveAndConfirmPlan()` 嘅實作本體。`apiSaveAndConfirmExecute()` 執行之前
 * 亦會再叫一次——**兩邊行同一份程式碼**，唔可以各自實作（第十九輪嘅教訓）。
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function buildSaveAndConfirmPlan_(quarterId) {
  const blocked = function (reason, extra) {
    return Object.assign({
      blocked: true, blockReason: reason, unresolved: [],
      requests: { apply: [], confirm: [], needsInput: [] },
      gridChanges: [], overlaps: [],
      violations: { real: [], released: [], structural: [], semiHard: [] },
      needsRelease: false, proposals: [], targetVersionNo: null,
      zeroChange: false, zeroChangeAction: null
    }, extra || {});
  };

  // ── 步 1.1　取現況 ───────────────────────────────────────────
  const stage = getQuarterStage_(quarterId);
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    return blocked('NO_VERSION', {
      message: buildThreePartMessage_(
        '這一季還沒有生成過任何版本。',
        '職事表沒有任何改動。',
        ['等系統在排定日期自動生成初稿', '或者去「進階功能 ▸ 手動生成初稿」自己生成一次'])
    });
  }

  let context;
  try {
    context = buildFineTuneContext_(quarterId, versionNo);
  } catch (err) {
    // 規格 1.1：grid 工作表被刪或改名。
    return blocked('GRID_SHEET_MISSING', {
      message: buildThreePartMessage_(
        '找不到「第 ' + versionNo + ' 版」的工作表（' + err.message + '）。',
        '職事表資料本身仍然完整（在系統內部保存著），只是你看的那張表不見了。'
          + '沒有任何改動。',
        ['去「進階功能 ▸ 回到上一個版本」重新建立一張',
          '如果那張表只是被改了名，把名字改回原本的就可以'])
    });
  }

  // ── 步 1.2　認名 ─────────────────────────────────────────────
  // ⚠️ mode 必須明確傳（第十九輪）。
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'apiSaveAndConfirmPlan');

  if (resolved.unresolved.length > 0) {
    // **立即中止，唔做之後任何一步**，亦唔提供「略過這幾格繼續」嘅出口。
    // 認唔出就係認唔出——猜係第十九／二十輪嗰一類 bug 嘅溫床。
    return blocked('UNRESOLVED_NAMES', {
      unresolved: resolved.unresolved.map(function (u) {
        return {
          serviceDate: u.serviceDate,
          postNameTC: context.postNames ? (context.postNames[u.postId] || u.postId) : u.postId,
          slotIndex: u.slotIndex,
          rawText: u.manualText || u.rawText || ''
        };
      }),
      message: buildUnresolvedGuidanceText_(resolved.unresolved)
    });
  }

  // ── 步 1.3　讀待處理申報 ─────────────────────────────────────
  const requestPlan = planApplyRequests_(quarterId);
  const pick = function (category) {
    return requestPlan.results
      .filter(function (r) { return r.category === category; })
      .map(mapRequestForClient_);
  };
  const requests = { apply: pick('APPLY'), confirm: pick('CONFIRM'), needsInput: pick('NEEDS_INPUT') };

  // ── 步 1.4　合併，grid 優先 ──────────────────────────────────
  const gridChanges = resolved.changes.map(function (c) {
    return {
      serviceDate: c.serviceDate,
      postId: c.postId,
      postNameTC: context.postNames ? (context.postNames[c.postId] || c.postId) : c.postId,
      slotIndex: c.slotIndex,
      originalName: c.originalName || '（空白）',
      manualName: c.manualText || '（空白）'
    };
  });

  const gridCellKeys = {};
  resolved.changes.forEach(function (c) {
    gridCellKeys[c.serviceDate + '|' + c.postId + '|' + c.slotIndex] = c;
  });
  // 同一格既有 grid 改動、又有申報 ⇒ **grid 贏**（規格 1.4）。
  // 幹事親手改嗰個係最新真相；申報係之前提交嘅。
  const overlaps = requestPlan.results.filter(function (r) {
    return r.serviceDate && r.postId
      && gridCellKeys[r.serviceDate + '|' + r.postId + '|' + (r.slotIndex === undefined ? 1 : r.slotIndex)];
  }).map(function (r) {
    const key = r.serviceDate + '|' + r.postId + '|' + (r.slotIndex === undefined ? 1 : r.slotIndex);
    const g = gridCellKeys[key];
    return {
      serviceDate: r.serviceDate,
      postNameTC: r.postNameText || r.postId,
      slotIndex: g.slotIndex,
      requestWants: r.personNameText || '',
      gridHas: g.manualText || '（空白）'
    };
  });

  // ── 步 1.5　規則檢查（三分類 + 準硬）─────────────────────────
  const allViolations = findStateViolations_(context, resolved.state);
  const violations = classifySaveConfirmViolations_(quarterId, versionNo, allViolations);

  // ── 步 1.6　三欄對照 ─────────────────────────────────────────
  const proposals = buildSaveConfirmProposals_(context, resolved, allViolations);

  // ── 零改動路徑（D4）────────────────────────────────────────
  const zeroChange = resolved.changes.length === 0 && requestPlan.results.length === 0;
  return {
    blocked: false,
    blockReason: null,
    unresolved: [],
    requests: requests,
    gridChanges: gridChanges,
    overlaps: overlaps,
    violations: violations,
    needsRelease: violations.real.length > 0,
    proposals: proposals,
    targetVersionNo: versionNo + 1,
    stage: stage,
    baseVersionNo: versionNo,
    skippedIncompleteCount: requestPlan.skippedIncompleteCount,
    zeroChange: zeroChange,
    zeroChangeAction: zeroChange ? resolveZeroChangeAction_(stage) : null
  };
}

/**
 * 決定 D4：零改動時應該做咩。
 * @param {string} stage 目前 Stage
 * @returns {string} `'NOTHING'` 或 `'ADVANCE_STAGE_ONLY'`
 */
function resolveZeroChangeAction_(stage) {
  // 只有 REVIEW_SENT 一種情況有嘢做：堂委冇提意見，撳掣 1 就當作
  // 「意見已收齊」，Stage 前進令掣 3 亮起。其餘全部乜都唔做。
  return stage === QUARTER_STAGE.REVIEW_SENT ? 'ADVANCE_STAGE_ONLY' : 'NOTHING';
}

/**
 * 規格 1.5 步 1.5：把違反分成四組。
 *
 * 真違反／已放行 沿用第二十一輪嘅 `classifyHardViolations_()`——
 * **唔喺呢度重新判斷一次**。結構性不適用同準硬規則按 severity／ruleId 分。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} allViolations `findStateViolations_()` 嘅結果
 * @returns {{real: Object[], released: Object[], structural: Object[], semiHard: Object[]}}
 */
function classifySaveConfirmViolations_(quarterId, versionNo, allViolations) {
  const hard = (allViolations || []).filter(function (v) { return v.severity === RULE_LEVELS.HARD; });
  const semiHard = (allViolations || []).filter(function (v) { return v.severity === RULE_LEVELS.SEMI_HARD; });
  const structural = hard.filter(function (v) {
    return STRUCTURAL_NA_RULE_IDS.indexOf(v.ruleId) !== -1;
  });
  const judgeable = hard.filter(function (v) {
    return STRUCTURAL_NA_RULE_IDS.indexOf(v.ruleId) === -1;
  });

  let real = judgeable;
  let released = [];
  try {
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const classified = classifyHardViolations_(
      judgeable,
      buildHardViolationClassContext_(quarterId, versionNo, readUnavailableNormalized(timezone)));
    real = classified.real;
    released = classified.released.concat(classified.lateUnavailable);
  } catch (err) {
    // 分類唔到 ⇒ **一律當成真違反**，唔可以靜靜當成「已放行」。
    // 寧可多要一次打字確認，都好過把一個真違反歸類成「唔使理」。
    log_('WARN', 'classifySaveConfirmViolations_ 分類失敗，全部當真違反：' + err.message);
  }

  return { real: real, released: released, structural: structural, semiHard: semiHard };
}

/**
 * 規格步 1.6：三欄對照（原本／你改成／系統建議）。
 *
 * **只有「有違反 且 系統搵到替代人選」嘅格先會有建議欄**——冇違反嘅格
 * 唔應該提出建議，噉會令幹事以為自己改錯咗。
 *
 * @param {Object} context fine-tune context
 * @param {Object} resolved `resolveAuthoritativeState_()` 嘅結果
 * @param {Object[]} allViolations 全部違反
 * @returns {Object[]}
 */
function buildSaveConfirmProposals_(context, resolved, allViolations) {
  if (!resolved.changes || resolved.changes.length === 0) return [];

  const violationByCell = {};
  (allViolations || []).forEach(function (v) {
    if (v.severity !== RULE_LEVELS.HARD) return;
    violationByCell[v.serviceDate + '|' + v.postId + '|' + v.slotIndex] = v;
  });

  // 「原本係邊個」＝**已定案版本**嘅內容，所以明確要 VERSION_OF_RECORD。
  //
  // ⚠️ 呢度特登唔直接讀 `context.original`——雖然結果一樣，但直接讀
  // 就係第十九輪嗰個「兩個真相來源、靜靜揀咗其中一個」bug class 嘅形狀。
  // 行返 `resolveAuthoritativeState_()` 呢道門，意圖就寫喺程式碼入面：
  // **呢一欄我要嘅係已定案版本，唔係 grid 上面嘅嘢。**
  // （三欄對照嘅「原本」一欄如果攞咗 grid 值，就會變成「你改成」同
  //   「原本」兩欄一模一樣，幹事完全睇唔出自己改咗啲咩。）
  const originalByKey = {};
  resolveAuthoritativeState_(context, STATE_SOURCE.VERSION_OF_RECORD, 'buildSaveConfirmProposals_')
    .state.forEach(function (a) {
      originalByKey[a.serviceDate + '|' + a.postId + '|' + a.slotIndex] = a;
    });
  const nameOf = function (personId) {
    if (!personId) return '';
    const p = context.peopleById[personId];
    return p ? p.nameTC : personId;
  };

  return resolved.changes.map(function (c) {
    const key = c.serviceDate + '|' + c.postId + '|' + c.slotIndex;
    const violation = violationByCell[key];
    const original = originalByKey[key] || {};
    let suggested = '';
    if (violation) {
      const pool = (context.eligibility.byPost[c.postId] || []).filter(function (id) {
        return id !== c.personId && id !== original.personId;
      });
      suggested = pool.length > 0 ? nameOf(pool[0]) : '';
    }
    return {
      serviceDate: c.serviceDate,
      postId: c.postId,
      postNameTC: context.postNames ? (context.postNames[c.postId] || c.postId) : c.postId,
      slotIndex: c.slotIndex,
      original: nameOf(original.personId),
      manual: c.manualText || '',
      suggested: suggested,
      // 規格步 1.6：原本係空白時「改回原本」要禁用，畫面要寫明原因。
      canRevertToOriginal: !!original.personId,
      reason: violation ? (violation.reason || violation.ruleId) : ''
    };
  });
}

/**
 * 掣 1 步 1.7–1.9：實際寫入。
 *
 * 次序固定（規格步 1.8）：`AuditLog` 逐格 → `createRosterSheet()` →
 * `writeAssignments()` → `registerVersion()` → 前進 Stage → 發佈公開連結。
 *
 * @param {string} quarterId 季度 ID
 * @param {Object} payload `{decisions, confirmedRequestRows, releaseText}`
 * @returns {Object} 三種結果可以分辨：完全成功／版本成功但發佈失敗／完全失敗
 */
function apiSaveAndConfirmExecute(quarterId, payload) {
  assertWebAppRequestAllowed_();
  const input = payload || {};

  // ── 1　後端重新讀 Stage 同最新版本號，唔信前端 ────────────────
  // ── 2　重新跑一次 plan，比對前端送嚟嘅決定係咪仲對應同一批格 ──
  const plan = buildSaveAndConfirmPlan_(quarterId);
  if (plan.blocked) {
    throw new Error(plan.message || ('無法儲存：' + plan.blockReason));
  }
  assertSaveConfirmPlanStillFresh_(plan, input.decisions);

  // ── 3　放行文字檢查 ─────────────────────────────────────────
  if (plan.needsRelease && String(input.releaseText || '').trim() !== SAVE_CONFIRM_RELEASE_TEXT) {
    throw new Error(buildThreePartMessage_(
      '有 ' + plan.violations.real.length + ' 格違反了一定要遵守的規則，需要你打字放行才能儲存。',
      '職事表沒有任何改動，第 ' + plan.baseVersionNo + ' 版仍然是最新一版。',
      ['如果這些安排是正確的（例如名單還未更新），在放行格輸入「'
        + SAVE_CONFIRM_RELEASE_TEXT + '」再撳一次',
        '如果是改錯了，回到職事表把那幾格改回去，再撳「儲存並確認」']));
  }

  // ── 零改動路徑（D4）────────────────────────────────────────
  if (plan.zeroChange) {
    return executeSaveConfirmZeroChange_(quarterId, plan);
  }

  // ── 4／5　逐格寫 AuditLog、建立新版本 ────────────────────────
  // materialiseManualEdits_() 內部就係「逐格 AuditLog → createRosterSheet()
  // → writeAssignments()」，唔喺呢度再抄一次（第十八輪嘅教訓）。
  const context = buildFineTuneContext_(quarterId, plan.baseVersionNo);
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'apiSaveAndConfirmExecute');

  let created;
  try {
    created = materialiseManualEdits_(context, resolved.changes, resolved.state, 'apiSaveAndConfirmExecute');
    registerVersion(
      quarterId, created.versionNo, created.sheetName,
      VERSION_VALUES.BASIS_FINE_TUNE, plan.baseVersionNo,
      plan.violations.real.length + plan.violations.semiHard.length,
      false,
      '掣 1 儲存並確認：人手改動 ' + resolved.changes.length + ' 格'
        + (plan.requests.apply.length > 0 ? '、申報 ' + plan.requests.apply.length + ' 筆' : ''));
  } catch (err) {
    // 規格步 1.8：**最危險嘅一種。** 版本可能只寫咗一部分。
    // ⚠️ 一定要 **唔前進 Stage、唔發佈公開連結**——半套資料唔應該
    // 一路推落去令堂委／義工睇到。
    return {
      ok: false,
      versionCreated: false,
      publishFailed: false,
      message: buildThreePartMessage_(
        '儲存到一半失敗了（' + err.message + '）。',
        '第 ' + (plan.baseVersionNo + 1) + ' 版可能只寫入了一部分。'
          + 'Stage 沒有前進，公開連結沒有更新，沒有寄出任何電郵。',
        ['去「進階功能 ▸ 檢查各版本派工紀錄」核對第 ' + (plan.baseVersionNo + 1) + ' 版是否完整',
          '或者用「進階功能 ▸ 回到上一個版本」退回第 ' + plan.baseVersionNo + ' 版'])
    };
  }

  // ── 6　前進 Stage（只喺 REVIEW_SENT → REQUESTS_APPLIED 呢一種）──
  let stageAdvanced = false;
  if (plan.stage === QUARTER_STAGE.REVIEW_SENT) {
    advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
    stageAdvanced = true;
  }

  // ── 7　重新發佈公開連結 ─────────────────────────────────────
  const publish = tryPublishPublicRoster_(quarterId);

  return {
    ok: true,
    versionCreated: true,
    versionNo: created.versionNo,
    sheetName: created.sheetName,
    baseVersionNo: plan.baseVersionNo,
    cellCount: created.cellCount,
    appliedRequestCount: plan.requests.apply.length,
    needsInputCount: plan.requests.needsInput.length,
    releasedViolationCount: plan.violations.real.length,
    stageAdvanced: stageAdvanced,
    publishFailed: publish.failed,
    publishError: publish.message,
    message: publish.failed
      ? buildThreePartMessage_(
        '第 ' + created.versionNo + ' 版已經儲存好了，但公開連結未能更新（' + publish.message + '）。',
        '職事表已經儲存成第 ' + created.versionNo + ' 版。'
          + '堂委現在開連結會看到舊內容。沒有寄出任何電郵。',
        ['去「進階功能 ▸ 重新發佈公開連結」再試一次',
          '如果連續失敗，先不要撳「寄給堂委審閱」，否則他們會看到舊版本'])
      : ''
  };
}

/**
 * 決定 D4 嘅零改動路徑。
 * @param {string} quarterId 季度 ID
 * @param {Object} plan plan 結果
 * @returns {Object}
 */
function executeSaveConfirmZeroChange_(quarterId, plan) {
  if (plan.zeroChangeAction !== 'ADVANCE_STAGE_ONLY') {
    return {
      ok: true, versionCreated: false, publishFailed: false, stageAdvanced: false,
      zeroChange: true,
      message: '沒有偵測到任何改動，不需要儲存。'
        + (plan.stage === QUARTER_STAGE.REQUESTS_APPLIED ? '可以撳「正式發出給全體」了。' : '')
        + (plan.stage === QUARTER_STAGE.OFFICIAL_SENT ? '這一季已經正式發出過了。' : '')
    };
  }

  // REVIEW_SENT 零改動 ＝ 堂委冇提意見。唔建版本，但 Stage 前進 + 重發連結。
  advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
  const publish = tryPublishPublicRoster_(quarterId);
  return {
    ok: true, versionCreated: false, stageAdvanced: true, zeroChange: true,
    publishFailed: publish.failed, publishError: publish.message,
    message: '堂委沒有提出改動，已當作意見已收齊。職事表內容沒有改變，'
      + '沒有建立新版本。「正式發出給全體」現在可以撳了。'
      + (publish.failed ? '\n\n⚠️ 不過公開連結未能更新（' + publish.message + '）。' : '')
  };
}

/**
 * 比對前端送嚟嘅 `decisions` 係咪仲對應同一批格。
 *
 * ⚠️ 對唔上 ⇒ 拋錯，**唔可以就住寫落去**。詳細理由見檔頭。
 * @param {Object} plan 重新跑出嚟嘅 plan
 * @param {Object[]} decisions 前端送嚟嘅逐格決定
 * @returns {void}
 */
function assertSaveConfirmPlanStillFresh_(plan, decisions) {
  if (!decisions || decisions.length === 0) return;   // 冇送決定就冇嘢要比對

  const currentKeys = {};
  (plan.proposals || []).forEach(function (p) {
    currentKeys[p.serviceDate + '|' + p.postId + '|' + p.slotIndex] = true;
  });
  (plan.gridChanges || []).forEach(function (g) {
    currentKeys[g.serviceDate + '|' + g.postId + '|' + g.slotIndex] = true;
  });

  const stale = decisions.filter(function (d) {
    return !currentKeys[d.serviceDate + '|' + d.postId + '|' + d.slotIndex];
  });
  if (stale.length === 0) return;

  throw new Error(
    '職事表在你確認的期間被改動過，剛才的預覽已經過期。'
    + '請關掉這個畫面重新撳一次「儲存並確認」。');
}

/**
 * 發佈公開連結，把失敗降級成「唔算全盤失敗」（規格步 1.9）。
 * @param {string} quarterId 季度 ID
 * @returns {{failed: boolean, message: string}}
 */
function tryPublishPublicRoster_(quarterId) {
  try {
    publishPublicRoster_(quarterId);
    return { failed: false, message: '' };
  } catch (err) {
    log_('WARN', 'tryPublishPublicRoster_ 失敗（版本已儲存，唔當全盤失敗）：' + err.message);
    return { failed: true, message: err.message };
  }
}
