/**
 * 第六十三輪批次 J 組：**孤兒版本——偵測，同埋受保護嘅清理。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 現場（2026T4）
 * ═════════════════════════════════════════════════════════════════════
 *
 *   `RosterAssignments`　273 行 `2026T4` `VersionNo=2`（2026-08-17 14:09:12 寫入，
 *                       AUTO 188／SKIPPED 81／MANUAL 4），同 v1 只差一格
 *   工作表　　　　　　　`Roster_2026T4_v2` 仍然喺度
 *   `RosterVersions`　　**冇** 2026T4-v2
 *
 * 即係一次造版本寫咗一半：grid 同長表寫咗，登記嗰一步冇行到。
 *
 * 後果：
 *   ・日後 2026T4 任何一條造版本嘅路，`createRosterSheet_()` 都會因為
 *     `Roster_2026T4_v2` 撞名而失敗（`MultiRun.gs` 嘅設計會先擋住，唔會再留
 *     孤兒，但幹事會見到一個睇唔明嘅錯）
 *   ・跨季「連續兩週」之前會讀到佢（I 組已修）
 *
 * ─────────────────────────────────────────────────────────────────────
 * 清理工具嘅界線
 * ─────────────────────────────────────────────────────────────────────
 *
 * **只刪未登記版本嘅派工紀錄同 grid 工作表。已登記嘅版本一律唔碰。**
 *
 * ⚠️ 呢個工具**刻意唔受** `QUARTER_RESET_BLOCKED_QUARTERS` 限制。嗰張清單
 * 保護嘅係「真實季度嘅已登記資料」——重設會刪晒成季（版本、寄出紀錄、
 * 申報）。呢度一行已登記嘅資料都唔會刪：系統由頭到尾冇認過嗰個版本，
 * 冇任何畫面、PDF、電郵、公開連結係由佢產生。2026T4 正正係受保護季度，
 * 而孤兒正正喺嗰度——受限制嘅話呢個工具就冇用。
 *
 * ⚠️ 先算後做：預覽逐項列出；執行要打字確認；執行嗰刻**重新算一次**，
 * 同預覽唔一樣就停（期間可能有人登記咗）。每一項寫 AuditLog。
 */

/** 執行清理要逐字輸入嘅確認文字。 */
const ORPHAN_VERSION_CONFIRM_TEXT = '確認清理孤兒版本';

/**
 * 搵出全部「`RosterAssignments` 有、`RosterVersions` 冇」嘅（季度, 版本），
 * 以及冇登記嘅 grid 工作表（`Roster_{季度}_v{N}`）。**純讀取。**
 *
 * @returns {Object[]} 每項 {key, quarterId, versionNo, assignmentRows, gridSheetName, gridExists}，
 *   按季度、版本排序
 */
function findOrphanVersions_() {
  const registered = readRegisteredVersionKeys_();
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const byKey = {};
  const touch = function (quarterId, versionNo) {
    const key = registeredVersionKey_(quarterId, versionNo);
    if (!byKey[key]) {
      byKey[key] = {
        key: key,
        quarterId: String(quarterId || '').trim(),
        versionNo: Number(versionNo),
        assignmentRows: 0,
        gridSheetName: buildRosterSheetName_(String(quarterId || '').trim(), Number(versionNo)),
        gridExists: false
      };
    }
    return byKey[key];
  };

  readSheet_(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    const quarterId = String(row[A.QUARTER_ID] || '').trim();
    const versionNo = row[A.VERSION_NO];
    if (!quarterId || versionNo === '' || versionNo === null || !isFinite(Number(versionNo))) return;
    if (registered[registeredVersionKey_(quarterId, versionNo)]) return;
    touch(quarterId, versionNo).assignmentRows++;
  });

  // 冇派工紀錄、淨係剩一張 grid 嘅孤兒都要搵到
  const prefix = SHEET_PREFIXES.ROSTER;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    const m = name.indexOf(prefix) === 0 ? /^(.+)_v(\d+)$/.exec(name.slice(prefix.length)) : null;
    if (!m) return;
    // 反推出嚟嘅名一定要同系統自己砌嘅一樣，先當係 grid（避免誤認其他表）
    if (buildRosterSheetName_(m[1], Number(m[2])) !== name) return;
    if (registered[registeredVersionKey_(m[1], m[2])]) return;
    touch(m[1], m[2]).gridExists = true;
  });

  return Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) {
    if (a.quarterId !== b.quarterId) return a.quarterId < b.quarterId ? -1 : 1;
    return a.versionNo - b.versionNo;
  });
}

/**
 * 全面體檢嗰一項。有孤兒 ⇒ MUST（日後造版本會撞名失敗）。
 * @param {Object[]} orphans `findOrphanVersions_()` 嘅結果
 * @returns {Object} `healthItem_()` 嘅結果
 */
function classifyOrphanVersionsHealth_(orphans) {
  return healthItem_('孤兒版本', orphans.length > 0 ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.INFO,
    '未登記的版本（RosterAssignments 有、RosterVersions 無）',
    orphans.length + ' 個',
    orphans.length === 0
      ? '沒有發現問題。'
      : '這些版本寫了一半（派工紀錄或工作表寫了，但沒有登記）。日後這一季再建立新版本時，'
        + '會因為工作表名稱重複而失敗。可以用「維護 ▸ ⚠️ 清理未登記的孤兒版本」清除——'
        + '它只刪這些未登記的資料，已登記的版本一律不會改動。',
    orphans.map(describeOrphanVersion_));
}

/**
 * 一項孤兒寫成一行人話。
 * @param {Object} o `findOrphanVersions_()` 其中一項
 * @returns {string}
 */
function describeOrphanVersion_(o) {
  return o.quarterId + ' 第 ' + o.versionNo + ' 版　派工紀錄 ' + o.assignmentRows + ' 行　工作表「'
    + o.gridSheetName + '」' + (o.gridExists ? '存在' : '不存在');
}

/**
 * 執行清理。**會刪資料**——只刪 `plan` 列出、而且執行嗰刻仍然未登記嘅。
 *
 * @param {Object[]} plan 預覽嗰陣 `findOrphanVersions_()` 嘅結果
 * @returns {{deletedRows: number, deletedSheets: string[], errors: string[]}}
 */
function executeOrphanVersionCleanup_(plan) {
  // ⚠️ 執行嗰刻重新算——同預覽唔一樣就停（期間可能有人登記咗某一版）
  const fresh = findOrphanVersions_();
  const freshKeys = fresh.map(function (o) { return o.key; }).join(',');
  const planKeys = (plan || []).map(function (o) { return o.key; }).join(',');
  if (freshKeys !== planKeys) {
    throw new Error(buildThreePartMessage_(
      '預覽之後孤兒版本的清單變了（預覽：' + (planKeys || '無') + '；現在：' + (freshKeys || '無') + '）。',
      '甚麼都沒有刪。',
      ['重新執行一次這個工具，看清楚新的清單再決定']));
  }

  const registered = readRegisteredVersionKeys_();
  const targets = {};
  fresh.forEach(function (o) { targets[o.key] = true; });
  const errors = [];
  const A = COLUMNS.ROSTER_ASSIGNMENTS;

  // ⚠️ 雙重保險：逐行再核一次「未登記」，唔單靠清單
  const deletedRows = deleteRowsMatching_(SHEETS.ROSTER_ASSIGNMENTS, function (record) {
    const key = registeredVersionKey_(record[A.QUARTER_ID], record[A.VERSION_NO]);
    return targets[key] === true && registered[key] !== true;
  }, errors);

  const deletedSheets = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  fresh.forEach(function (o) {
    if (registered[o.key]) return;
    const sheet = ss.getSheetByName(o.gridSheetName);
    if (!sheet) return;
    try {
      ss.deleteSheet(sheet);
      deletedSheets.push(o.gridSheetName);
    } catch (err) {
      errors.push('刪除工作表 ' + o.gridSheetName + ' 失敗：' + err.message);
    }
  });

  fresh.forEach(function (o) {
    writeAuditLog_({
      action: '清理孤兒版本',
      targetSheet: SHEETS.ROSTER_ASSIGNMENTS,
      targetKey: o.quarterId + '-v' + o.versionNo,
      oldValue: '派工紀錄 ' + o.assignmentRows + ' 行；工作表 ' + o.gridSheetName
        + (o.gridExists ? '（存在）' : '（不存在）'),
      newValue: '已刪除',
      source: 'executeOrphanVersionCleanup_',
      notes: 'RosterVersions 沒有登記這一版；已登記的版本沒有改動。'
        + '這個工具刻意不受 QUARTER_RESET_BLOCKED_QUARTERS 限制（只刪未登記的資料）。'
    });
  });

  return { deletedRows: deletedRows, deletedSheets: deletedSheets, errors: errors };
}

/**
 * 選單「維護 ▸ ⚠️ 清理未登記的孤兒版本」。先算後做、要打字確認。
 * @returns {void}
 */
function runCleanupOrphanVersions_() {
  return withMutationLock_('清理孤兒版本', function () {
    return runCleanupOrphanVersions_locked_();
  });
}

function runCleanupOrphanVersions_locked_() {
  const ui = SpreadsheetApp.getUi();
  const title = '⚠️ 清理未登記的孤兒版本';
  let plan;
  try {
    plan = findOrphanVersions_();
  } catch (err) {
    ui.alert(title, '檢查失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }
  if (plan.length === 0) {
    ui.alert(title, '沒有發現未登記的版本，不需要清理。', ui.ButtonSet.OK);
    return;
  }

  const lines = ['以下版本在 RosterAssignments 或工作表裏有資料，但 RosterVersions 沒有登記：', '']
    .concat(plan.map(function (o) { return '　・' + describeOrphanVersion_(o); }))
    .concat(['',
      '會做的事：只刪除上面這些未登記版本的派工紀錄和工作表，每一項寫入 AuditLog。',
      '不會做的事：已登記的版本、SendLog、Requests、PDF 一律不會改動。',
      '',
      '（這個工具不受 QUARTER_RESET_BLOCKED_QUARTERS 限制，因為它不會改動任何已登記的資料。）',
      '',
      '確定的話，請在下面逐字輸入「' + ORPHAN_VERSION_CONFIRM_TEXT + '」。']);
  const confirm = ui.prompt(title, lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (confirm.getSelectedButton() !== ui.Button.OK) return;
  if (confirm.getResponseText().trim() !== ORPHAN_VERSION_CONFIRM_TEXT) {
    ui.alert(title, '輸入的文字不是「' + ORPHAN_VERSION_CONFIRM_TEXT + '」，已取消，甚麼都沒有刪。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    const result = executeOrphanVersionCleanup_(plan);
    ui.alert(title + '（完成）',
      '已刪除派工紀錄 ' + result.deletedRows + ' 行、工作表 ' + result.deletedSheets.length + ' 張'
        + (result.deletedSheets.length > 0 ? '（' + result.deletedSheets.join('、') + '）' : '') + '。'
        + (result.errors.length > 0 ? '\n\n⚠️ 有部分未完成：\n' + result.errors.join('\n') : ''),
      ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCleanupOrphanVersions_ 失敗：' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
