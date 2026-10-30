/**
 * 第九十輪批次 QB 組：詩班名單放在事奉人員表（「崗位名單」工作表），但不是職事表崗位。
 *
 *   維護 ▸ 補建 Posts 欄位（是否在職事表顯示）：只加 `ShowInRoster` 欄（留空＝顯示）。
 *   維護 ▸ 建立詩班名單：Posts 加一行（PostID＝Config CHOIR_GROUP_POST_ID，預設 CHOIR；中文「詩班」；
 *     AutoGenerate=FALSE、ShowInRoster=FALSE、Active=TRUE）；已有就不加。
 *
 * 名單本身在「開季前準備 ▸ 開啟名單工作表」那一張表填（可以寫名字，亦可以寫「堂委」「執事」）。
 */

/**
 * 檢查 Posts 工作表有沒有 `ShowInRoster` 欄（只讀）。
 * @returns {{columnExists: boolean, columnIndex: number, postCount: number}}
 */
function planPostShowInRosterSeed_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  const headers = lastCol > 0 ? sheet.getRange(2, 1, 1, lastCol).getValues()[0] : [];
  const existingIndex = headers.indexOf(COLUMNS.POSTS.SHOW_IN_ROSTER);
  return {
    columnExists: existingIndex !== -1,
    columnIndex: existingIndex !== -1 ? existingIndex + 1 : lastCol + 1,
    postCount: Math.max(0, lastRow - 2)
  };
}

/**
 * 依計畫補建 `ShowInRoster` 欄（只加欄，不填值；留空＝顯示）。
 * @param {Object} plan planPostShowInRosterSeed_() 的結果
 * @returns {boolean} 是否真的新增了欄位
 */
function seedPostShowInRoster_(plan) {
  if (plan.columnExists) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
  sheet.getRange(1, plan.columnIndex).setValue('是否在職事表顯示（留空或 TRUE＝顯示；FALSE＝只作名單組別）');
  sheet.getRange(2, plan.columnIndex).setValue(COLUMNS.POSTS.SHOW_IN_ROSTER);
  return true;
}

/**
 * 選單「維護 ▸ 補建 Posts 欄位（是否在職事表顯示）」。
 * @returns {void}
 */
function runSeedPostShowInRoster_() {
  const ui = SpreadsheetApp.getUi();
  const title = '補建 Posts 欄位（是否在職事表顯示）';
  try {
    const plan = planPostShowInRosterSeed_();
    if (plan.columnExists) {
      ui.alert(title, 'Posts 工作表已經有 ' + COLUMNS.POSTS.SHOW_IN_ROSTER + ' 欄（第 '
        + plan.columnIndex + ' 欄），沒有做任何改動。', ui.ButtonSet.OK);
      return;
    }
    const confirm = ui.alert(title, '會在 Posts 工作表最後一欄之後新增 ' + COLUMNS.POSTS.SHOW_IN_ROSTER
      + ' 欄（目前共 ' + plan.postCount + ' 個崗位），全部留空（＝照舊在職事表顯示）。\n\n確定要新增嗎？', ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;
    seedPostShowInRoster_(plan);
    writeAuditLog_({
      action: '補建 Posts 欄位',
      targetSheet: SHEETS.POSTS,
      targetKey: COLUMNS.POSTS.SHOW_IN_ROSTER,
      newValue: '（只新增欄位，沒有填任何值）',
      source: 'runSeedPostShowInRoster_'
    });
    ui.alert(title, '已新增 ' + COLUMNS.POSTS.SHOW_IN_ROSTER + ' 欄（第 ' + plan.columnIndex
      + ' 欄），全部留空。之後可以用「維護 ▸ 建立詩班名單」加詩班那一行。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runSeedPostShowInRoster_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 詩班那一行（按 Posts 第 2 行機器鍵排列）。**純函式。**
 * @param {string[]} keys Posts 第 2 行機器鍵
 * @param {Object[]} rows 現有 Posts 行（readSheet_ 的形狀）
 * @param {string} choirPostId 詩班的 PostID
 * @returns {?Array} 要加的一行；已有那個 PostID ⇒ null
 */
function buildChoirGroupPostRow_(keys, rows, choirPostId) {
  const P = COLUMNS.POSTS;
  const exists = (rows || []).some(function (r) { return String(r[P.POST_ID] || '').trim() === choirPostId; });
  if (exists) return null;
  let maxOrder = 0;
  (rows || []).forEach(function (r) {
    const n = Number(r[P.DISPLAY_ORDER]);
    if (!isNaN(n) && n > maxOrder) maxOrder = n;
  });
  const values = {};
  values[P.POST_ID] = choirPostId;
  values[P.POST_NAME_TC] = '詩班';
  values[P.SLOT_COUNT] = 1;
  values[P.DISTINCT_WITHIN_POST] = true;
  values[P.FREQUENCY] = POST_FREQUENCY.WEEKLY;
  values[P.AUTO_GENERATE] = false;
  values[P.ALLOW_CONSECUTIVE] = ALLOW_CONSECUTIVE.ALLOW;
  values[P.MUTEX_GROUP] = '';
  values[P.DISPLAY_ORDER] = maxOrder + 1;
  values[P.ACTIVE] = true;
  values[P.NOTES] = '詩班名單（只作名單組別，不在職事表顯示）；名單在「崗位名單」工作表填';
  values[P.EMPTY_DISPLAY] = POST_EMPTY_DISPLAY.BLANK;
  values[P.SHOW_IN_ROSTER] = false;
  return keys.map(function (k) {
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : '';
  });
}

/**
 * 選單「維護 ▸ 建立詩班名單」。
 * @returns {void}
 */
function runCreateChoirGroup_() {
  const ui = SpreadsheetApp.getUi();
  const title = '建立詩班名單';
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.POSTS);
    if (!sheet) throw new Error('找不到工作表: ' + SHEETS.POSTS);
    const keys = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (k) { return String(k || '').trim(); });
    if (keys.indexOf(COLUMNS.POSTS.SHOW_IN_ROSTER) === -1) {
      ui.alert(title, 'Posts 工作表還沒有 ' + COLUMNS.POSTS.SHOW_IN_ROSTER
        + ' 欄。請先按「維護 ▸ 補建 Posts 欄位（是否在職事表顯示）」，再建立詩班名單。', ui.ButtonSet.OK);
      return;
    }
    const choirPostId = readChoirGroupPostId_();
    const row = buildChoirGroupPostRow_(keys, readSheet_(SHEETS.POSTS), choirPostId);
    if (!row) {
      ui.alert(title, 'Posts 已經有 ' + choirPostId + ' 這一行，沒有做任何改動。\n\n名單在「開季前準備 ▸ 開啟名單工作表」填。',
        ui.ButtonSet.OK);
      return;
    }
    const confirm = ui.alert(title, '會在 Posts 加一行：' + choirPostId + '（詩班），只作名單組別'
      + '（ShowInRoster=FALSE、AutoGenerate=FALSE），不會在職事表顯示。\n\n確定要加嗎？', ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    writeAuditLog_({
      action: 'CHOIR_GROUP_CREATED',
      targetSheet: SHEETS.POSTS,
      targetKey: choirPostId,
      newValue: '詩班（ShowInRoster=FALSE、AutoGenerate=FALSE、Active=TRUE）',
      source: 'runCreateChoirGroup_'
    });
    ui.alert(title, '已加入 ' + choirPostId + '（詩班）。\n\n名單在「開季前準備 ▸ 開啟名單工作表」的「詩班」一欄填'
      + '（可以寫名字，亦可以寫「堂委」「執事」）。', ui.ButtonSet.OK);
  } catch (err) {
    log_('ERROR', 'runCreateChoirGroup_ 失敗: ' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
  }
}
