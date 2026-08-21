/**
 * 第二十三輪批次階段 D：掣 1「儲存並確認」。
 *
 * 對應 `docs/幹事介面規格.md` 第 2.4 節（步 1.1–1.9）。
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

  // ⚠️ 第三十五輪批次 B 組（順帶）：崗位中文名。
  //
  // 本檔案原本有**三處**寫 `context.postNames ? (context.postNames[x] || x) : x`，
  // 但 `buildFineTuneContext_()` **根本冇 `postNames` 呢個欄位**
  //（只有 `buildMailContext_()` 先有）。所以三處都永遠 fallback 到 postId，
  // 幹事見到嘅係 `PREACHER#1` 呢種機器鍵——現場對話框嗰句
  // `2027-07-04　PREACHER#1　……` 就係噉嚟。
  //
  // 由 `context.posts`（真正存在）砌一次，三處共用。
  const postNameById = {};
  (context.posts || []).forEach(function (p) { postNameById[p.postId] = p.postNameTC; });

  // ── 步 1.2　認名 ─────────────────────────────────────────────
  // ⚠️ mode 必須明確傳（第十九輪）。
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'apiSaveAndConfirmPlan');

  if (resolved.unresolved.length > 0) {
    // **立即中止，唔做之後任何一步**，亦唔提供「略過這幾格繼續」嘅出口。
    // 認唔出就係認唔出——猜係第十九／二十輪嗰一類 bug 嘅溫床。
    return blocked('UNRESOLVED_NAMES', {
      // ─────────────────────────────────────────────────────────────
      // ⚠️ 第三十五輪批次 B 組：**兩個值都要送，而且唔可以送錯欄位名。**
      // ─────────────────────────────────────────────────────────────
      //
      // 原本寫 `rawText: u.manualText || u.rawText || ''`，但
      // `buildGridOverlayState_()`（FineTune.gs）推入 `unresolved` 嗰陣
      // 用嘅欄位名係 **`text`**——`manualText` 同 `rawText` 兩個都唔存在。
      // 所以永遠 fallback 到 `''`，而畫面就印成「你打了：「(空白)」」。
      //
      // 現場後果：grid 上明明有一位客席講員嘅名，對話框話你打咗空白。
      // 幹事會照住去改一格本來冇問題嘅嘢。
      //
      // ⚠️ 而家**兩個值都送**（格內現在／本來應該係）。只送一個
      // 就永遠分唔出係邊一邊出事——而呢個 bug 正正就係噉樣藏咗好耐。
      // ⚠️ 第三十五輪批次 B 組（順帶）：`context.postNames` **根本唔存在**。
      // `buildFineTuneContext_()` 冇呢個欄位（只有寄信嗰個 context 先有），
      // 所以個三元運算永遠 fallback 到 `u.postId` ⇒ 幹事見到嘅係
      // `PREACHER#1` 呢種機器鍵，唔係「講員」。
      // 現場對話框嗰句 `2027-07-04　PREACHER#1　……` 就係噉嚟。
      // 而家由 `context.posts` 真正譯返中文名。
      unresolved: resolved.unresolved.map(function (u) {
        return {
          serviceDate: u.serviceDate,
          postNameTC: postNameById[u.postId] || u.postId,
          slotIndex: u.slotIndex,
          // 格內而家真正有咩（幹事打嗰個）
          gridText: u.text || '',
          // 呢一格本來應該渲染成咩（版本記錄嗰邊）
          expectedText: u.expectedText || '',
          // 舊欄位名保留，等未更新嘅前端唔會即刻爆——但佢而家帶住**正確**嘅值。
          rawText: u.text || ''
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
      postNameTC: postNameById[c.postId] || c.postId,
      slotIndex: c.slotIndex,
      originalName: c.originalName || '（空白）',
      manualName: c.manualText || '（空白）'
    };
  });

  // 同一格既有 grid 改動、又有申報 ⇒ **grid 贏**（規格 1.4）。
  // 幹事親手改嗰個係最新真相；申報係之前提交嘅。
  //
  // ⚠️ 第三十九輪批次（順手）：呢一段本來喺呢度自己寫一次，
  // 而 `applyRequests_()` 嗰邊（第三十八輪 F 組）又寫多一次。
  // 兩段答案一致，但係兩個真相來源——本專案反覆出事嗰一類。
  // 而家兩邊都叫 `findRequestGridOverlaps_()`（RequestsApply.gs）。
  //
  // ⚠️ 順帶記低第三十四輪甲2 嗰個 bug 免得有人again：原本寫 `r.postId`，
  // 但 `validateRequest_()` 回嘅係 `post`（成個崗位物件），
  // **根本冇 `postId` 呢個欄位** ⇒ 個 filter 永遠一項都唔中 ⇒
  // 規格 1.4 由頭到尾冇實作過。而家個 key 一律由 `r.post.postId` 攞。
  const postNamesById = {};
  (requestPlan.context && requestPlan.context.posts || []).forEach(function (po) {
    postNamesById[po.postId] = po.postNameTC;
  });
  const overlaps = findRequestGridOverlaps_(requestPlan, postNamesById);

  // ── 步 1.5　規則檢查（三分類 + 準硬）─────────────────────────
  // ⚠️ 參數次序：`findStateViolations_(state, context)`——**派工狀態行先**。
  // 呢一行本來寫反咗，令掣 1「儲存並確認」一撳就爆
  //（`Cannot read properties of undefined (reading 'forEach')`）。
  // 由 Prompt B 寫出嚟到第二十九輪，114 個測試冇一個經過呢條路
  // ——全部都直接叫 `findStateViolations_()`，冇一個由端點入口叫落去。
  const allViolations = findStateViolations_(resolved.state, context);
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

  // 第三十五輪批次 B 組（順帶）：同 `buildSaveAndConfirmPlan_()` 一樣嘅理由
  // ——`context.postNames` 唔存在，要由 `context.posts` 譯。
  const postNameById = {};
  (context.posts || []).forEach(function (p) { postNameById[p.postId] = p.postNameTC; });

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
      postNameTC: postNameById[c.postId] || c.postId,
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
  //
  // ─────────────────────────────────────────────────────────────────────
  // ⚠️ 第三十四輪批次甲1／甲2：**有申報就一定要行 applyRequests_() 嗰條路。**
  // ─────────────────────────────────────────────────────────────────────
  //
  // 修正之前呢度**淨係**叫 `materialiseManualEdits_()`，而嗰個函式只識得
  // grid 人手改動。後果（2026-08-20 實測）：
  //
  //   甲1　0 格人手改動 ＋ 有申報 ⇒ `resolved.changes` 係空陣列 ⇒
  //        `materialiseManualEdits_()` 嘅空守衛拋錯。**「幹事只填申報、
  //        完全唔碰 grid」係日常最常見嘅用法，而呢條路從來冇實作過。**
  //
  //   甲2　有 grid 改動 ＋ 有申報 ⇒ 版本建立成功、Stage 前進、公開連結重發，
  //        但**申報完全冇被套用**：`Requests` 嘅 RequestID／Status 仍然空白，
  //        AuditLog 冇任何申報紀錄，而版本備註同確認畫面都寫住「申報 1 筆」。
  //        `plan.requests.apply` 喺整個執行階段**淨係被用嚟砌嗰句備註**。
  //        ⚠️ 靜默失敗——幹事會以為義工嘅申報已經處理好。
  //
  //   甲3　因此形成死鎖：掣 3 嘅閘門（正確地）擋住未處理申報，
  //        但撳掣 1 永遠處理唔完，幹事喺介面上無路可走。
  //
  // 修法冇另起爐灶。`planApplyRequests_()` ＋ `applyRequests_()` 呢條路
  // **本身就已經做齊全部嘢**，而且一直行得啱（2027T2 v1 嘅圖例正確）：
  //   ・`assignByKey` 由 GRID_OVERLAY 砌 ⇒ 人手改動已經喺入面
  //   ・`manualChanges` 逐格寫 AuditLog（MANUAL_GRID_EDIT_CARRIED）
  //   ・`ruleFlags` 原樣帶落去（甲5 嗰個 bug 喺嗰邊唔存在）
  //   ・套用完會叫 `writeRequestOutcomes_()` 回寫 Requests
  //   ・同一格既有 grid 改動又有申報 ⇒ 由 `applyDesignatedServe_()` 覆寫，
  //     而 plan 嗰邊已經計咗 `overlaps` 俾幹事睇（規格 1.4）
  //
  // 所以有申報就交返俾佢，冇申報就維持原本嗰條（已經有測試守住）。
  // **兩條路都係「建立新版本」，但唔會有兩份實作。**
  const context = buildFineTuneContext_(quarterId, plan.baseVersionNo);
  const resolved = resolveAuthoritativeState_(
    context, STATE_SOURCE.GRID_OVERLAY, 'apiSaveAndConfirmExecute');

  const hasRequests = plan.requests.apply.length > 0
    || plan.requests.confirm.length > 0
    || plan.requests.needsInput.length > 0;
  const versionNote = '掣 1 儲存並確認：人手改動 ' + resolved.changes.length + ' 格'
    + (plan.requests.apply.length > 0 ? '、申報 ' + plan.requests.apply.length + ' 筆' : '');

  let created;
  let requestResult = null;
  try {
    if (hasRequests) {
      // ⚠️ 重新 plan 一次，唔用上面個 `plan`——`buildSaveAndConfirmPlan_()`
      // 出嚟嘅係俾前端睇嘅精簡版（`mapRequestForClient_()`），
      // 而 `applyRequests_()` 要嘅係完整嘅 `results`／`assignByKey`／`context`。
      const requestPlan = planApplyRequests_(quarterId);
      requestResult = applyRequests_(
        requestPlan,
        (input.confirmedRequestRows || []),
        VERSION_VALUES.BASIS_FINE_TUNE,
        versionNote,
        // 規格 1.4：同一格幹事已經親手改咗嗰啲申報，唔套用。
        // 列號由 plan 嗰邊算好（`overlaps`）——**上游決定，下游執行**。
        plan.overlaps.map(function (o) { return o.sheetRow; })
          .filter(function (row) { return row !== undefined && row !== null; }));
      created = {
        versionNo: requestResult.versionNo,
        sheetName: requestResult.sheetName,
        cellCount: resolved.changes.length
      };
    } else {
      created = materialiseManualEdits_(context, resolved.changes, resolved.state, 'apiSaveAndConfirmExecute');
      registerVersion(
        quarterId, created.versionNo, created.sheetName,
        VERSION_VALUES.BASIS_FINE_TUNE, plan.baseVersionNo,
        plan.violations.real.length + plan.violations.semiHard.length,
        false, versionNote);
    }
  } catch (err) {
    // ─────────────────────────────────────────────────────────────
    // ⚠️ 第三十四輪批次甲4：**分開「未開始寫」同「寫到一半」。**
    // ─────────────────────────────────────────────────────────────
    //
    // 修正之前一律講「第 N 版可能只寫入了一部分」，並叫幹事去核對版本
    // 甚至回退。但甲1 嗰種失敗係喺**建立版本之前**拋嘅——實測核實
    // 一個字都冇寫入（RosterVersions 冇 v2、AuditLog 零新紀錄、Requests 未動）。
    // 把「乾淨失敗」講成需要人手善後，會令幹事去做完全不必要嘅回退，
    // 而回退本身係一個會建立新版本嘅動作。
    return buildSaveConfirmFailureResult_(quarterId, plan.baseVersionNo, err);
  }

  // ── 6　前進 Stage（只喺 REVIEW_SENT → REQUESTS_APPLIED 呢一種）──
  let stageAdvanced = false;
  if (plan.stage === QUARTER_STAGE.REVIEW_SENT) {
    advanceQuarterStage_(quarterId, QUARTER_STAGE.REQUESTS_APPLIED);
    stageAdvanced = true;
  }

  // 第四十一輪批次 C 組：逐格明細要寫崗位中文名，唔可以寫 PostID。
  // 幹事腦入面冇 `CHAIR` 呢個概念。
  const savedPostNames = {};
  readPostsNormalized().forEach(function (po) { savedPostNames[po.postId] = po.postNameTC; });

  // ── 7　重新發佈公開連結 ─────────────────────────────────────
  const publish = tryPublishPublicRoster_(quarterId);

  return {
    ok: true,
    versionCreated: true,
    versionNo: created.versionNo,
    sheetName: created.sheetName,
    baseVersionNo: plan.baseVersionNo,
    cellCount: created.cellCount,
    // ⚠️ 第四十一輪批次 C 組：**逐格列出來**，不是只給一個數字。
    //
    // Ivan 實測之後講：「沒有任何成功儲存的提示。需要提示幹事儲存了
    // 什麼改動，或者至少講一句『已成功儲存』。」
    //
    // 一個「套用了 3 格改動」的數字，證明不到系統改的就是他改的那三格。
    // 逐格寫「由誰改成誰」，他一眼就核對得到。
    //
    // ⚠️ 第四十二輪批次 D 組：**申報帶來那幾格也要列出來。**
    // `resolved.changes` 只有幹事親手改的那批；套用申報那條路動了哪幾格，
    // 這裡本來一句都沒有講——而那條路動的格數往往比他自己改的多。
    // 由「比對兩個版本」讀出來，不改 `applyRequests_()` 的寫入邏輯。
    savedChanges: buildSavedChangeRowsForSave_(
      quarterId, plan.baseVersionNo, created.versionNo,
      resolved.changes, savedPostNames, hasRequests),
    // ⚠️ 第三十四輪批次甲2：呢兩個數而家由**真正套用嘅結果**出，
    // 唔再由 plan 嗰個「打算套用幾多筆」出。修正之前兩者永遠一樣，
    // 因為根本冇套用過——一個永遠自我印證嘅數字。
    appliedRequestCount: requestResult ? requestResult.appliedCount : 0,
    rejectedRequestCount: requestResult ? requestResult.rejectedCount : 0,
    needsInputCount: requestResult ? requestResult.needsInputCount : 0,
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
 * 第三十四輪批次甲4：儲存失敗之後，**先查清楚到底寫咗幾多**，先至講文案。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 點解要分
 * ─────────────────────────────────────────────────────────────────────
 *
 * 原本一律講「第 N 版可能只寫入了一部分……去核對／或者回退」。
 * 但甲1 嗰種失敗（空守衛拋錯）係喺**建立版本之前**發生，
 * 實測核實一個字都冇寫入。把乾淨失敗講成需要人手善後，
 * 會令幹事去做一次完全不必要嘅回退——而回退本身會建立新版本，
 * 即係一句嚇人嘅文案製造咗一個真正嘅多餘版本。
 *
 * 判斷方法係**去睇實際狀態**，唔係靠估：
 *   ・`RosterVersions` 有冇登記到新版本
 *   ・grid 工作表存唔存在（登記之前就已經建立咗）
 * 兩樣都冇 ⇒ 乾淨，可以直接再試。
 *
 * ⚠️ 查唔到嗰陣（連查都失敗）**一律當成「可能寫咗一半」**——
 * 呢個方向嘅錯比較安全：叫人核對一次，好過叫人放心而其實有半套資料。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} baseVersionNo 失敗之前嘅最新版本號
 * @param {Error} err 原本嘅錯誤
 * @returns {Object} 失敗結果（`ok: false`）
 */
function buildSaveConfirmFailureResult_(quarterId, baseVersionNo, err) {
  const targetVersionNo = baseVersionNo + 1;

  let wroteSomething = true;   // 查唔到就當寫咗（安全方向）
  try {
    const registered = findLatestVersionNo(quarterId) > baseVersionNo;
    const sheetExists = !!SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(buildRosterSheetName_(quarterId, targetVersionNo));
    wroteSomething = registered || sheetExists;
  } catch (probeErr) {
    log_('WARN', '儲存失敗之後查唔到寫入狀態，一律當成「可能寫咗一半」：' + probeErr.message);
  }

  if (!wroteSomething) {
    return {
      ok: false,
      versionCreated: false,
      publishFailed: false,
      partialWrite: false,
      message: buildThreePartMessage_(
        '儲存沒有做成（' + err.message + '）。',
        '沒有任何東西被寫入——第 ' + targetVersionNo + ' 版沒有建立，'
          + '職事表、修改申報、Stage 全部維持原樣，第 ' + baseVersionNo + ' 版仍然是最新一版。'
          + '沒有寄出任何電郵。',
        ['直接再撳一次「儲存並確認」就可以，不需要做任何清理',
          '如果再試仍然一樣，把上面整段文字交給開發者'])
    };
  }

  // 規格步 1.8：**最危險嘅一種。** 版本可能只寫咗一部分。
  // ⚠️ 一定要 **唔前進 Stage、唔發佈公開連結**——半套資料唔應該
  // 一路推落去令堂委／義工睇到。
  return {
    ok: false,
    versionCreated: false,
    publishFailed: false,
    partialWrite: true,
    message: buildThreePartMessage_(
      '儲存到一半失敗了（' + err.message + '）。',
      '第 ' + targetVersionNo + ' 版可能只寫入了一部分。'
        + 'Stage 沒有前進，公開連結沒有更新，沒有寄出任何電郵。',
      ['去「進階功能 ▸ 檢查各版本派工紀錄」核對第 ' + targetVersionNo + ' 版是否完整',
        '或者用「進階功能 ▸ 回到上一個版本」退回第 ' + baseVersionNo + ' 版'])
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

/**
 * 第四十二輪批次 D 組：這一次儲存了什麼，逐格。
 *
 * ⚠️ 兩批來源要分得清：
 *   `MANUAL`　幹事自己在 grid 上改的（`resolved.changes`）
 *   `REQUEST` 套用修改申報帶來的（比對兩個版本讀出來）
 *
 * ⚠️ 同一格兩邊都有 ⇒ **幹事那一批贏**。那是第四十輪定下的規矩
 *（`plan.overlaps`：幹事已經親手改過那些格，申報不套用）。
 * 顯示次序要同實際行為一致，否則畫面會講一件事而系統做另一件事。
 *
 * ⚠️ 比對失敗不可以令整個儲存變成失敗——版本已經寫好了。
 * 退回「只列幹事那一批」，並且在 log 講一句。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} baseVersionNo 舊版本
 * @param {number} newVersionNo 新版本
 * @param {Object[]} manualChanges `resolved.changes`
 * @param {Object.<string, string>} postNames `postId` → 崗位中文名
 * @param {boolean} hasRequests 這一次有沒有走套用申報那一條
 * @returns {Object[]} 逐格清單
 */
function buildSavedChangeRowsForSave_(
  quarterId, baseVersionNo, newVersionNo, manualChanges, postNames, hasRequests) {
  const manual = buildSavedChangeRows_(manualChanges, postNames, 'MANUAL');
  if (!hasRequests) return manual;

  let fromRequests = [];
  try {
    fromRequests = buildSavedChangeRows_(
      diffVersionAssignments_(quarterId, baseVersionNo, newVersionNo), postNames, 'REQUEST');
  } catch (err) {
    log_('WARN', 'buildSavedChangeRowsForSave_ 比對唔到兩個版本（版本本身已經儲存好）：'
      + err.message);
    return manual;
  }
  return mergeSavedChangeRows_(manual, fromRequests);
}
