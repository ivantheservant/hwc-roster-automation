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
      '沒有選要回到哪一個版本。',
      '職事表沒有任何改動。',
      ['在上面的版本清單選一個，再撳一次']));
  }
  if (target === currentVersionNo) {
    return rollbackBlocked_('TARGET_IS_CURRENT', buildThreePartMessage_(
      '你選的第 ' + target + ' 版就是目前這一版。',
      '職事表沒有任何改動。',
      ['選一個較早的版本', '如果只是想重新發佈公開連結，用「進階功能 ▸ 重新發佈公開連結」']));
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
      ['先撳「儲存」，把改動儲存成新一版',
        '或者把那幾格改回原樣，這一粒就會重新亮起']));
  }

  // ── 步 3：逐格比對（唯讀）─────────────────────────────────────
  const currentRows = readVersionAssignmentsForGrid_(quarterId, currentVersionNo);
  const targetRows = readVersionAssignmentsForGrid_(quarterId, target);

  if (targetRows.length === 0) {
    return rollbackBlocked_('TARGET_EMPTY', buildThreePartMessage_(
      '第 ' + target + ' 版在系統內部沒有任何派工紀錄。',
      '職事表沒有任何改動。',
      ['選另一個版本',
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
        isManual: false,
        // 第六十三輪批次 K 組：目標版本嘅來源。唔帶嘅話會搬**現時版本**嘅來源
        assignSource: a.assignSource
      };
    });
    // ⚠️ 參數次序：`findStateViolations_(state, context)`——**派工狀態行先**。
    // 同 `WebAppSaveConfirm.gs` 一樣寫反咗；只係「回到上一個版本」嘅預覽
    // 冇人撳過，所以未爆出嚟。兩個錯嘅都係新寫嘅 Web UI 端點。
    // 第六十三輪批次 L 組：同儲存確認一樣補上中文崗位名同人名
    const rawViolations = findStateViolations_(targetState, context);
    violations = classifySaveConfirmViolations_(
      quarterId, target, decorateViolations_(rawViolations, context));
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
/**
 * ⚠️ 第四十三輪批次 A 組：**同一時間只可以有一個會改動資料的動作在跑。**
 *
 * 這個薄殼只做兩件事：檢查權限、拿鎖。真正的內容在下面那一個
 * `apiRollbackExecute_locked_()`。分開兩層是刻意的——把 `withMutationLock_()`
 * 塞進原本那個函式裡面，就要在它每一個 `return` 前面記得放鎖，
 * 而漏一個就會令整份試算表卡死到下一次執行為止。
 *
 * 理由的全文在 `src/MutationLock.gs` 檔頭。
 */
function apiRollbackExecute(quarterId, targetVersionNo, releaseText) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('回到上一個版本', function () {
    return apiRollbackExecute_locked_(quarterId, targetVersionNo, releaseText);
  });
}

function apiRollbackExecute_locked_(quarterId, targetVersionNo, releaseText) {

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

/* ═════════════════════════════════════════════════════════════════════
 * 第七十五輪批次 CH 組：第 2 步嘅版本下拉（Ivan 已決定做法）
 * ═════════════════════════════════════════════════════════════════════
 *
 * 取代〔回到上一個儲存版本〕同「進階與診斷 ▸ 回到上一個版本」：
 *   ・揀最新一版 ⇒ 照舊（〔查看／修改職事表〕開可以改嘅工作表）
 *   ・揀舊版本 ⇒〔查看這一版〕（新分頁、唯讀）／〔用這一版作起點〕
 *
 * 〔用這一版作起點〕**唔會即刻建立新版本**：只係把嗰一版嘅格子同每週標題
 * 按機器鍵寫入最新嗰張可以改嘅工作表，之後幹事可以再改，撳〔儲存〕先成為新一版。
 * 所以「人手改動偵測」（`buildGridOverlayState_()`）自然會見到嗰啲格，
 * 唔使另一條儲存路。新一版嘅來源寫「以第 M 版作起點」——靠下面嗰個 AuditLog 標記。
 * 標記同儲存嗰陣讀標記嘅函式喺 `SheetReader.gs`（儲存嗰邊一定載入）。
 * 舊版本一律唔改唔刪。上面嘅 `apiRollbackPlan()`／`apiRollbackExecute()` 留低（自我測試、亂行機仲用）。
 */

/**
 * 一個版本嘅來源（人話）。
 * @param {Object} row `RosterVersions` 一行
 * @returns {string}
 */
function describeVersionSource_(row) {
  const V = COLUMNS.ROSTER_VERSIONS;
  const basis = String(row[V.BASIS] === null || row[V.BASIS] === undefined ? '' : row[V.BASIS]).trim();
  const parent = String(row[V.PARENT_VERSION_NO] === null || row[V.PARENT_VERSION_NO] === undefined
    ? '' : row[V.PARENT_VERSION_NO]).trim();
  // 生成時已經有舊版本 ⇒ 重新生成（`MultiRun.gs` 寫 ParentVersionNo＝上一版）
  if (basis === VERSION_VALUES.BASIS_AUTO_GENERATE && parent !== '') return '重新生成';
  return buildVersionBasisText_(basis);
}

/**
 * 「由誰」：`EmailRecipients.DisplayName` → `NameMapping.NameTC` → 電郵 @ 前面部分。
 * 兩張表各讀一次。讀唔到就淨係用電郵 @ 前面。
 * @returns {function(string): string}
 */
function buildVersionAuthorResolver_() {
  const byEmail = {};
  const add = function (email, name) {
    const e = String(email || '').trim().toLowerCase();
    const n = String(name || '').trim();
    if (e && n && !byEmail[e]) byEmail[e] = n;
  };
  try {
    const R = COLUMNS.EMAIL_RECIPIENTS;
    readSheet(SHEETS.EMAIL_RECIPIENTS).forEach(function (r) { add(r[R.EMAIL], r[R.DISPLAY_NAME]); });
  } catch (err) {
    log_('WARN', 'buildVersionAuthorResolver_ 讀不到 EmailRecipients：' + err.message);
  }
  try {
    const N = COLUMNS.NAME_MAPPING;
    readSheet(SHEETS.NAME_MAPPING).forEach(function (r) { add(r[N.EMAIL], r[N.NAME_TC]); });
  } catch (err) {
    log_('WARN', 'buildVersionAuthorResolver_ 讀不到 NameMapping：' + err.message);
  }
  return function (email) {
    const e = String(email || '').trim();
    if (!e) return '';
    if (byEmail[e.toLowerCase()]) return byEmail[e.toLowerCase()];
    const at = e.indexOf('@');
    return at > 0 ? e.slice(0, at) : e;
  };
}

/**
 * 呢一季全部版本（新到舊），畀第 2 步嘅版本下拉用。
 * 每項 `label`＝「第 N 版　yyyy-MM-dd HH:mm　來源　由誰」。
 * @param {string} quarterId 季度 ID
 * @param {string} timezone 時區
 * @returns {Object[]}
 */
function listQuarterVersionChoices_(quarterId, timezone) {
  const V = COLUMNS.ROSTER_VERSIONS;
  const latestVersionNo = findLatestVersionNo(quarterId);
  const authorOf = buildVersionAuthorResolver_();
  return readSheet(SHEETS.ROSTER_VERSIONS)
    .filter(function (row) { return String(row[V.QUARTER_ID] || '').trim() === quarterId; })
    .map(function (row) {
      const versionNo = Number(row[V.VERSION_NO]);
      const at = normalizeSentAt_(row[V.CREATED_AT], timezone);
      const createdAtText = at ? at.text : '';
      const sourceText = describeVersionSource_(row);
      const byText = authorOf(row[V.CREATED_BY]);
      return {
        versionNo: versionNo,
        createdAtText: createdAtText,
        sourceText: sourceText,
        byText: byText,
        isLatest: versionNo === latestVersionNo,
        sheetUrl: buildGridSheetUrl_(String(row[V.SHEET_NAME] || '').trim()),
        label: ['第 ' + versionNo + ' 版', createdAtText, sourceText, byText]
          .filter(function (s) { return s !== ''; }).join('　')
      };
    })
    .filter(function (v) { return !isNaN(v.versionNo); })
    .sort(function (a, b) { return b.versionNo - a.versionNo; });
}

/**
 * 搵一個版本嘅 `RosterVersions` 行同工作表。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{row: Object, sheetName: string}}
 */
function findVersionRowForPicker_(quarterId, versionNo) {
  const V = COLUMNS.ROSTER_VERSIONS;
  const row = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (r) {
    return String(r[V.QUARTER_ID] || '').trim() === quarterId && Number(r[V.VERSION_NO]) === versionNo;
  })[0];
  if (!row) {
    throw new Error(buildThreePartMessage_(
      '找不到這一季的第 ' + versionNo + ' 版。',
      '職事表沒有任何改動。',
      ['撳頁頂〔重新整理〕再選一次']));
  }
  const sheetName = String(row[V.SHEET_NAME] || '').trim() || buildRosterSheetName_(quarterId, versionNo);
  return { row: row, sheetName: sheetName };
}

/**
 * 一個版本**儲存嗰陣**嘅每週標題（「類型」欄應該顯示乜）。
 *
 * ⚠️ 唔可以讀嗰一版嘅工作表：幹事係喺嗰張表上改完先儲存成下一版，
 * 所以舊版本工作表上面嘅字其實係**下一版**嘅內容。標題唔係逐版存，
 * 於是由 AuditLog 推返出嚟（AuditLog 只會加、唔會改，行嘅次序就係時間次序）：
 *   第 M 版「建立新版本」嗰行之後，每個日期**第一筆** `WEEK_TITLE_CHANGED` 嘅 OldValue
 *   ＝ 嗰陣（亦即第 M 版）顯示緊嘅字；之後冇改過 ⇒ 同而家一樣。
 * 搵唔到第 M 版「建立新版本」嗰行（例如好舊嘅資料）⇒ 用而家嘅標題，記 WARN。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object} renderContext `buildGridRenderContext_()`（要有 `typeTextByDate`）
 * @param {Array[]} auditRows `readSheet(SHEETS.AUDIT_LOG)`
 * @returns {Object.<string, string>} 日期 → 標題文字
 */
function readVersionWeekTitles_(quarterId, versionNo, renderContext, auditRows) {
  const C = COLUMNS.AUDIT_LOG;
  const out = {};
  const current = renderContext.typeTextByDate || {};
  Object.keys(current).forEach(function (d) { out[d] = current[d]; });
  const rows = auditRows || [];
  let createdAt = -1;
  rows.forEach(function (r, i) {
    if (String(r[C.ACTION] || '') === '建立新版本'
      && String(r[C.TARGET_KEY] || '').trim() === quarterId + '-v' + versionNo) createdAt = i;
  });
  if (createdAt === -1) {
    log_('WARN', 'readVersionWeekTitles_ 找不到第 ' + versionNo + ' 版的建立紀錄，每週標題用現在的');
    return out;
  }
  const seen = {};
  for (let i = createdAt + 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[C.ACTION] || '') !== 'WEEK_TITLE_CHANGED') continue;
    const key = String(r[C.TARGET_KEY] || '').trim();
    if (key.indexOf(quarterId + '|') !== 0) continue;
    const d = key.slice(quarterId.length + 1);
    if (seen[d] || !Object.prototype.hasOwnProperty.call(out, d)) continue;
    seen[d] = true;
    out[d] = String(r[C.OLD_VALUE] === null || r[C.OLD_VALUE] === undefined ? '' : r[C.OLD_VALUE]).trim();
  }
  return out;
}

/**
 * 把第 `sourceVersionNo` 版**儲存咗嘅內容**（`RosterAssignments`＋每週標題）按機器鍵寫入一張工作表。
 * 只寫內容唔同嘅格；只寫有改嘅行（資料行冇公式，見 `createRosterSheet()`）。
 * @param {string} quarterId 季度 ID
 * @param {number} sourceVersionNo 內容來源版本
 * @param {Object} sheet 要寫入嘅工作表
 * @param {string} timezone 時區
 * @returns {{cellCount: number, titleCount: number}}
 */
function writeVersionContentIntoSheet_(quarterId, sourceVersionNo, sheet, timezone) {
  const sourceRows = readVersionAssignmentsForGrid_(quarterId, sourceVersionNo);
  if (sourceRows.length === 0) {
    throw new Error(buildThreePartMessage_(
      '第 ' + sourceVersionNo + ' 版在系統內部沒有任何派工紀錄。',
      '職事表沒有任何改動。',
      ['選另一個版本']));
  }
  const renderContext = buildGridRenderContext_(quarterId, timezone);
  let auditRows = [];
  try {
    auditRows = readSheet(SHEETS.AUDIT_LOG);
  } catch (err) {
    log_('WARN', 'writeVersionContentIntoSheet_ 讀不到 AuditLog（每週標題用現在的）：' + err.message);
  }
  const titles = readVersionWeekTitles_(quarterId, sourceVersionNo, renderContext, auditRows);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3) throw new Error('工作表沒有內容：' + sheet.getName());
  const keys = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (k) { return String(k || '').trim(); });
  const values = sheet.getRange(3, 1, lastRow - 2, lastCol).getValues();
  const colByKey = {};
  keys.forEach(function (k, i) { if (k.indexOf('#') !== -1) colByKey[k] = i; });
  // ⚠️ 用第 2 行機器鍵認欄，唔靠位置估
  const typeCol = keys[WEEK_TITLE_GRID_COLUMN - 1] === GRID_KEYS.TYPE ? WEEK_TITLE_GRID_COLUMN - 1 : -1;
  const rowByDate = {};
  values.forEach(function (r, i) {
    const d = toDateString(r[0], timezone);
    if (d && rowByDate[d] === undefined) rowByDate[d] = i;
  });

  const changedRows = {};
  let cellCount = 0;
  let titleCount = 0;
  const setCell = function (ri, ci, text) {
    const now = String(values[ri][ci] === null || values[ri][ci] === undefined ? '' : values[ri][ci]).trim();
    if (now === String(text).trim()) return false;
    values[ri][ci] = text;
    changedRows[ri] = true;
    return true;
  };
  sourceRows.forEach(function (a) {
    const ri = rowByDate[a.serviceDate];
    const ci = colByKey[a.postId + '#' + a.slotIndex];
    if (ri === undefined || ci === undefined) return;
    if (setCell(ri, ci, renderExpectedGridText_(a, a.postId, a.serviceDate, renderContext))) cellCount++;
  });
  if (typeCol !== -1) {
    Object.keys(titles).forEach(function (d) {
      const ri = rowByDate[d];
      if (ri === undefined) return;
      if (setCell(ri, typeCol, titles[d])) titleCount++;
    });
  }
  Object.keys(changedRows).forEach(function (ri) {
    const i = Number(ri);
    sheet.getRange(3 + i, 1, 1, lastCol).setValues([values[i]]);
  });
  return { cellCount: cellCount, titleCount: titleCount };
}

/**
 * 〔查看這一版〕：舊版本嘅工作表網址（新分頁開）。
 *
 * ⚠️ 舊版本工作表上面可能仲有「改完先儲存成下一版」嘅字（見 `readVersionWeekTitles_()`），
 * 所以開之前先把嗰張表**還原成嗰一版儲存咗嘅內容**——版本紀錄（`RosterAssignments`／
 * `RosterVersions`）一格都唔改，只係令張表同嗰一版一致。
 * 唯讀：未有保護 ⇒ 加一個「只會提示」嘅保護；已經有保護（例如 v0 鎖定）⇒ 照用。
 * 最新一版唔郁（佢係要改嗰張）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 舊版本號
 * @returns {{url: string, sheetName: string, protectedNow: boolean, restoredCells: number, restoreFailed: string}}
 */
function apiOpenVersionForViewing(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('查看舊版本', function () {
    return openVersionForViewing_locked_(quarterId, Number(versionNo));
  });
}

function openVersionForViewing_locked_(quarterId, target) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const found = findVersionRowForPicker_(quarterId, target);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(found.sheetName);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '第 ' + target + ' 版的工作表「' + found.sheetName + '」不見了。',
      '職事表沒有任何改動。系統內部仍然有這一版的資料。',
      ['選這一版再撳〔用這一版作起點〕，內容會寫入最新那一張']));
  }
  let protectedNow = false;
  let restoredCells = 0;
  let restoreFailed = '';
  if (target !== findLatestVersionNo(quarterId)) {
    try {
      const r = writeVersionContentIntoSheet_(quarterId, target, sheet, timezone);
      restoredCells = r.cellCount + r.titleCount;
    } catch (err) {
      restoreFailed = err.message;
      log_('WARN', 'apiOpenVersionForViewing 還原舊版本工作表失敗：' + err.message);
    }
    try {
      const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
      if (existing.length === 0) {
        sheet.protect().setDescription('第 ' + target + ' 版（舊版本），只供查看').setWarningOnly(true);
        protectedNow = true;
      }
    } catch (err) {
      log_('WARN', 'apiOpenVersionForViewing 加保護失敗：' + err.message);
    }
  }
  return {
    url: buildGridSheetUrl_(found.sheetName), sheetName: found.sheetName,
    protectedNow: protectedNow, restoredCells: restoredCells, restoreFailed: restoreFailed
  };
}

/**
 * 〔用這一版作起點〕。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 起點（舊版本號）
 * @returns {Object}
 */
function apiUseVersionAsStartPoint(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('用舊版本作起點', function () {
    return useVersionAsStartPoint_locked_(quarterId, Number(versionNo));
  });
}

function useVersionAsStartPoint_locked_(quarterId, target) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const latest = findLatestVersionNo(quarterId);
  if (latest < 0) {
    throw new Error(buildThreePartMessage_('這一季還沒有任何版本。', '職事表沒有任何改動。',
      ['先在第 1 步生成職事表']));
  }
  if (isNaN(target) || target < 0 || target === latest) {
    throw new Error(buildThreePartMessage_(
      (isNaN(target) || target < 0) ? '沒有選要用哪一版作起點。' : '你選的第 ' + target + ' 版就是最新一版。',
      '職事表沒有任何改動。',
      ['在版本下拉選一個舊版本再撳一次']));
  }
  findVersionRowForPicker_(quarterId, target);   // 冇呢一版 ⇒ 拋錯
  const latestFound = findVersionRowForPicker_(quarterId, latest);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(latestFound.sheetName);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '找不到最新一版的工作表「' + latestFound.sheetName + '」。',
      '職事表沒有任何改動。',
      ['如果那張表只是被改了名，把名字改回原本的就可以']));
  }

  const written = writeVersionContentIntoSheet_(quarterId, target, sheet, timezone);

  writeAuditLog_({
    action: VERSION_START_POINT_ACTION,
    targetSheet: latestFound.sheetName,
    targetKey: quarterId,
    oldValue: String(latest),
    newValue: String(target),
    source: 'apiUseVersionAsStartPoint',
    notes: '以第 ' + target + ' 版作起點：寫入 ' + written.cellCount + ' 格、每週標題 ' + written.titleCount
      + ' 週（未儲存；第 ' + target + ' 版與第 ' + latest + ' 版都沒有改動）'
  });

  return {
    ok: true,
    targetVersionNo: target,
    latestVersionNo: latest,
    cellCount: written.cellCount,
    titleCount: written.titleCount,
    sheetUrl: buildGridSheetUrl_(latestFound.sheetName)
  };
}
