/**
 * 第二十四輪批次階段 E：「回到上一個版本」。
 *
 * 對應 `docs/幹事介面規格.md` 第 5.3 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 做法：唔刪任何嘢，只係新增一個內容相同嘅版本
 * ─────────────────────────────────────────────────────────────────────
 *
 * 讀 v(目標) 嘅派工紀錄，寫成一個**全新版本** v(N+1)。
 * **舊版本一個都唔會刪**——包括被回退嗰個。
 *
 * ⚠️ 呢個語意好容易被誤會成「刪除／取代」。畫面文案一定要講清楚：
 * 撳完之後版本數目係**增加**咗，唔係減少。幹事以為自己「復原」咗
 * 而實際上多咗一版，之後對數就會對唔上。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ParentVersionNo 寫實際父版本，唔係目標版本
 * ─────────────────────────────────────────────────────────────────────
 *
 * 由 v3 回到 v2、建立 v4：`ParentVersionNo` 要寫 **3**，唔係 2。
 *
 * 點解：`ParentVersionNo` 記錄嘅係「呢一版係由邊一版接落嚟」，
 * 即係版本鏈嘅實際次序。寫 2 嘅話，版本鏈會變成 v2 有兩個仔
 * （v3 同 v4），睇落好似分咗支——但實情係一條直線：v3 之後係 v4，
 * 只不過 v4 嘅**內容**取自 v2。
 * 內容來源記喺 `Basis`／`Notes`，唔應該混入 `ParentVersionNo`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 永不改變 Stage
 * ─────────────────────────────────────────────────────────────────────
 *
 * 回退係「改內容」，唔係「改流程進度」。已經寄咗俾堂委嘅一季，
 * 回退之後仍然係「已寄咗俾堂委」——只不過佢哋而家開連結會見到舊內容。
 * 呢個事實由畫面提醒幹事，唔應該由系統靜靜改 Stage 去「補償」。
 */

/** 「回到上一個版本」要求逐字輸入嘅確認文字（規格 1.4：一律兩個字）。 */
const ROLLBACK_CONFIRM_TEXT = '確認';

/**
 * 規格 5.3：**畫面上一定要有呢段字。** 幹事一定會問「點解唔用 Google
 * 試算表本身嘅版本記錄」，而佢自己去用嘅後果係災難性但唔明顯嘅。
 *
 * 寫成常數係為咗令前端同測試都引用同一份文字，唔會有人喺前端改咗
 * 一半措辭而令警告失去力度。
 */
const ROLLBACK_SHEETS_HISTORY_WARNING =
  '不要用 Google 試算表本身的「版本記錄」還原。\n'
  + '那個只會還原你看到的那張表，不會還原系統內部的職事表資料、\n'
  + '不會還原這一季的進度、不會還原寄出記錄。\n'
  + '還原之後表面看起來對，實際上系統內部對不上，之後每一步都會出錯。';

/**
 * 供前端呼叫：列出呢一季全部版本（人話），供「回到上一個版本」揀。
 * @param {string} quarterId 季度 ID
 * @returns {{latestVersionNo: number, versions: Object[]}}
 */
function apiListVersionsForRollback(quarterId) {
  assertWebAppRequestAllowed_();

  const V = COLUMNS.ROSTER_VERSIONS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const latestVersionNo = findLatestVersionNo(quarterId);

  const versions = readSheet(SHEETS.ROSTER_VERSIONS)
    .filter(function (row) { return String(row[V.QUARTER_ID] || '').trim() === quarterId; })
    .map(function (row) {
      const versionNo = Number(row[V.VERSION_NO]);
      return {
        versionNo: versionNo,
        createdAt: toDateString(row[V.CREATED_AT], timezone),
        basisText: buildVersionBasisText_(row[V.BASIS]),
        isCurrent: versionNo === latestVersionNo,
        isProtected: isTrueValue_(row[V.PROTECTED])
      };
    })
    .sort(function (a, b) { return b.versionNo - a.versionNo; });

  return { latestVersionNo: latestVersionNo, versions: versions };
}

/**
 * 規格 5.3 步 1–3：回退預覽。**純讀取，零寫入。**
 *
 * @param {string} quarterId 季度 ID
 * @param {number} targetVersionNo 要回到嘅版本號
 * @returns {Object} 見規格 5.3
 */
function apiRollbackPlan(quarterId, targetVersionNo) {
  assertWebAppRequestAllowed_();

  const target = Number(targetVersionNo);
  const currentVersionNo = findLatestVersionNo(quarterId);

  if (currentVersionNo < 0) {
    return rollbackBlocked_('NO_VERSION', buildThreePartMessage_(
      '這一季還沒有生成過任何版本。',
      '職事表沒有任何改動。',
      ['等系統在排定日期自動生成初稿']));
  }
  if (isNaN(target) || target < 0) {
    return rollbackBlocked_('BAD_TARGET', buildThreePartMessage_(
      '沒有揀要回到哪一個版本。',
      '職事表沒有任何改動。',
      ['在上面的版本清單揀一個，再撳一次']));
  }
  if (target === currentVersionNo) {
    return rollbackBlocked_('TARGET_IS_CURRENT', buildThreePartMessage_(
      '你揀的第 ' + target + ' 版就是目前這一版。',
      '職事表沒有任何改動。',
      ['揀一個較早的版本', '如果只是想重新發佈公開連結，用「進階功能 ▸ 重新發佈公開連結」']));
  }

  // ── 前置檢查一：未儲存改動（規格 5.3 步 1）────────────────────
  // ⚠️ 回退會令 grid 上未儲存嘅人手改動消失。呢個係唯一一個
  // 「唔擋就會靜靜銷毀幹事嘅工作」嘅情況，所以擋死，唔提供繞過。
  const unsaved = readDashboardUnsavedState_(quarterId, currentVersionNo);
  if (unsaved.hasAny) {
    const bits = [];
    if (unsaved.gridChangeCount > 0) bits.push('你在表上改了 ' + unsaved.gridChangeCount + ' 格');
    if (unsaved.unresolvedCount > 0) bits.push('有 ' + unsaved.unresolvedCount + ' 格的文字系統認不出');
    if (unsaved.pendingRequestCount > 0) bits.push('有 ' + unsaved.pendingRequestCount + ' 筆修改申報未處理');
    if (bits.length === 0) bits.push('系統查不到目前有沒有未儲存的改動');

    return rollbackBlocked_('UNSAVED_CHANGES', buildThreePartMessage_(
      bits.join('，') + '，未儲存。回到上一個版本會令這些改動消失。',
      '職事表沒有任何改動，第 ' + currentVersionNo + ' 版仍然是最新一版。',
      ['先撳「儲存並確認」，把改動儲存成新一版',
        '或者把那幾格改回原樣，這一粒就會重新亮起']));
  }

  // ── 步 3：逐格比對（唯讀）─────────────────────────────────────
  const currentRows = readVersionAssignmentsForGrid_(quarterId, currentVersionNo);
  const targetRows = readVersionAssignmentsForGrid_(quarterId, target);

  if (targetRows.length === 0) {
    return rollbackBlocked_('TARGET_EMPTY', buildThreePartMessage_(
      '第 ' + target + ' 版在系統內部沒有任何派工紀錄。',
      '職事表沒有任何改動。',
      ['揀另一個版本',
        '去「進階功能 ▸ 檢查各版本派工紀錄」看看這一版是不是曾經被清理過']));
  }

  const postNames = {};
  readPostsNormalized().forEach(function (p) { postNames[p.postId] = p.postNameTC; });
  const keyOf = function (a) { return a.serviceDate + '|' + a.postId + '|' + a.slotIndex; };
  const currentByKey = {};
  currentRows.forEach(function (a) { currentByKey[keyOf(a)] = a; });

  const cellChanges = [];
  targetRows.forEach(function (t) {
    const cur = currentByKey[keyOf(t)];
    const curName = cur ? (cur.personName || '') : '';
    const tgtName = t.personName || '';
    if (curName === tgtName) return;
    cellChanges.push({
      serviceDate: t.serviceDate,
      postId: t.postId,
      postNameTC: postNames[t.postId] || t.postId,
      slotIndex: t.slotIndex,
      currentName: curName || '（空白）',
      willBecome: tgtName || '（空白）'
    });
  });

  // ── 步 3：把目標版本嘅內容用**今日嘅規則**重新檢查一次 ────────
  // ⚠️ 規則可能自嗰陣起改過（第二十一輪嗰三個「假 bug」就係呢個情況）。
  // 「舊版本一定合規」係一個危險嘅假設——嗰一版通過檢查嗰陣用嘅係
  // 當時嘅規則。所以呢度一定要重新跑，唔可以省。
  let violations = { real: [], released: [], structural: [], semiHard: [] };
  let violationCheckFailed = '';
  try {
    const context = buildFineTuneContext_(quarterId, currentVersionNo);
    const targetState = targetRows.map(function (a) {
      return {
        serviceDateId: a.serviceDateId,
        serviceDate: a.serviceDate,
        postId: a.postId,
        slotIndex: a.slotIndex,
        personId: a.personId,
        isManual: false
      };
    });
    violations = classifySaveConfirmViolations_(
      quarterId, target, findStateViolations_(context, targetState));
  } catch (err) {
    // 檢查唔到 ⇒ 誠實講「查唔到」，**唔可以顯示「0 項違反」**
    // ——嗰個等於話「檢查過，冇問題」，同「檢查唔到」係兩件事。
    log_('WARN', 'apiRollbackPlan 規則檢查失敗：' + err.message);
    violationCheckFailed = err.message;
  }

  // ── OFFICIAL_SENT 時，有幾多人手上嗰份會變成過時 ──────────────
  const stage = getQuarterStage_(quarterId);
  let outdatedPersonCount = 0;
  if (stage === QUARTER_STAGE.OFFICIAL_SENT) {
    const affected = {};
    cellChanges.forEach(function (c) {
      const cur = currentByKey[c.serviceDate + '|' + c.postId + '|' + c.slotIndex];
      if (cur && cur.personId) affected[cur.personId] = true;
    });
    targetRows.forEach(function (t) {
      const cur = currentByKey[keyOf(t)];
      if (t.personId && (!cur || cur.personId !== t.personId)) affected[t.personId] = true;
    });
    outdatedPersonCount = Object.keys(affected).length;
  }

  return {
    blocked: false,
    blockReason: null,
    quarterId: quarterId,
    stage: stage,
    currentVersionNo: currentVersionNo,
    targetVersionNo: target,
    newVersionNo: currentVersionNo + 1,
    cellChangeCount: cellChanges.length,
    cellChanges: cellChanges,
    violations: violations,
    violationCheckFailed: violationCheckFailed,
    needsRelease: violations.real.length > 0,
    outdatedPersonCount: outdatedPersonCount,
    sheetsHistoryWarning: ROLLBACK_SHEETS_HISTORY_WARNING
  };
}

/** 造一個 blocked 回傳（欄位齊全，令前端唔使逐個 undefined 檢查）。 */
function rollbackBlocked_(reason, message) {
  return {
    blocked: true, blockReason: reason, message: message,
    cellChangeCount: 0, cellChanges: [],
    violations: { real: [], released: [], structural: [], semiHard: [] },
    violationCheckFailed: '', needsRelease: false, outdatedPersonCount: 0,
    sheetsHistoryWarning: ROLLBACK_SHEETS_HISTORY_WARNING
  };
}

/**
 * 規格 5.3 步 5：執行回退。
 *
 * 次序同掣 1 步 1.8／1.9 一樣：逐格 AuditLog → 建 grid → 寫派工 →
 * 登記版本 → 發佈公開連結。**永不改 Stage。**
 *
 * @param {string} quarterId 季度 ID
 * @param {number} targetVersionNo 目標版本號
 * @param {string} releaseText 打字確認文字
 * @returns {Object} 三種結果分辨得到：完全成功／版本成功但發佈失敗／完全失敗
 */
function apiRollbackExecute(quarterId, targetVersionNo, releaseText) {
  assertWebAppRequestAllowed_();

  // 唔信前端：重新跑一次 plan。
  const plan = apiRollbackPlan(quarterId, targetVersionNo);
  if (plan.blocked) throw new Error(plan.message);

  if (String(releaseText || '').trim() !== ROLLBACK_CONFIRM_TEXT) {
    throw new Error(buildThreePartMessage_(
      '「回到上一個版本」需要你打字確認才會執行。',
      '職事表沒有任何改動，第 ' + plan.currentVersionNo + ' 版仍然是最新一版。',
      ['在確認格輸入「' + ROLLBACK_CONFIRM_TEXT + '」再撳一次',
        '如果不想繼續，直接關掉這個畫面就可以']));
  }

  const target = plan.targetVersionNo;
  const newVersionNo = plan.newVersionNo;
  const targetRows = readVersionAssignmentsForGrid_(quarterId, target);

  // 逐格寫 AuditLog（規格 5.3 步 5）。喺真正寫入之前做——
  // 出事嗰陣至少知道當時打算做咩。
  plan.cellChanges.forEach(function (c) {
    writeAuditLog_({
      action: 'VERSION_ROLLBACK',
      targetSheet: buildRosterSheetName_(quarterId, plan.currentVersionNo),
      targetKey: c.serviceDate + '|' + c.postId + '|' + c.slotIndex,
      oldValue: c.currentName,
      newValue: c.willBecome,
      source: 'apiRollbackExecute',
      notes: '回到第 ' + target + ' 版，內容寫成第 ' + newVersionNo
        + ' 版（第 ' + plan.currentVersionNo + ' 版保持不變、不會刪除）'
    });
  });

  let sheetName;
  try {
    const assignments = targetRows.map(function (a) {
      return {
        serviceDateId: a.serviceDateId,
        serviceDate: a.serviceDate,
        postId: a.postId,
        slotIndex: a.slotIndex,
        personId: a.personId || '',
        personName: a.personName || '',
        assignSource: a.assignSource,
        ruleFlags: a.ruleFlags || []
      };
    });
    sheetName = createRosterSheet(quarterId, newVersionNo, assignments, []);
    writeAssignments(quarterId, newVersionNo, assignments);
    registerVersion(
      quarterId, newVersionNo, sheetName,
      '回到第 ' + target + ' 版',
      // ⚠️ ParentVersionNo 寫**實際父版本**，唔係目標版本。見檔頭說明。
      plan.currentVersionNo,
      plan.violations.real.length + plan.violations.semiHard.length,
      false,
      '內容取自第 ' + target + ' 版');
  } catch (err) {
    return {
      ok: false,
      versionCreated: false,
      publishFailed: false,
      message: buildThreePartMessage_(
        '回退寫到一半失敗了（' + err.message + '）。',
        '第 ' + newVersionNo + ' 版可能只寫入了一部分。'
          + '這一季的進度沒有改變，公開連結沒有更新，沒有寄出任何電郵。',
        ['去「進階功能 ▸ 檢查各版本派工紀錄」核對第 ' + newVersionNo + ' 版是否完整',
          '第 ' + plan.currentVersionNo + ' 版與第 ' + target + ' 版都完好無缺，沒有被改動過'])
    };
  }

  const publish = tryPublishPublicRoster_(quarterId);

  return {
    ok: true,
    versionCreated: true,
    newVersionNo: newVersionNo,
    sheetName: sheetName,
    targetVersionNo: target,
    previousVersionNo: plan.currentVersionNo,
    cellChangeCount: plan.cellChangeCount,
    outdatedPersonCount: plan.outdatedPersonCount,
    stage: plan.stage,
    publishFailed: publish.failed,
    publishError: publish.message,
    message: publish.failed
      ? buildThreePartMessage_(
        '第 ' + newVersionNo + ' 版已經建立好了（內容取自第 ' + target
          + ' 版），但公開連結未能更新（' + publish.message + '）。',
        '職事表已經回到第 ' + target + ' 版的內容。'
          + '堂委現在開連結會看到回退之前的內容。沒有寄出任何電郵。',
        ['去「進階功能 ▸ 重新發佈公開連結」再試一次'])
      : ''
  };
}
