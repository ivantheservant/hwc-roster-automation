/**
 * 第三十九輪批次 A 組第 4 步：**用一張工作表維護各崗位的事奉人員名單。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 為什麼是工作表，不是彈窗
 * ═════════════════════════════════════════════════════════════════════
 *
 * 現有的「崗位資格」畫面（區三）是一格一格改的。要一次過重排一個崗位的
 * 十幾個人，在彈窗裡面點十幾次，比在試算表裡面複製貼上慢很多倍。
 *
 * 幹事本來就每日用試算表。這一步就是把名單攤開成一張表：
 * **一個崗位一欄，底下是該崗位的人。** 他愛怎麼改就怎麼改，
 * 改完回來撳「儲存並套用名單」。
 *
 * ⚠️ 這一步**沒有取代**區三那個畫面，兩個都保留。
 * 逐格微調用舊那個，整批重排用這一個。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 「認不出的名字」不可以靜靜略過
 * ─────────────────────────────────────────────────────────────────────
 *
 * 這是本專案最反覆出現的一類 bug：把「解析不到人」當成「沒有東西」。
 *
 * 在這裡的具體形態是：幹事打錯一個字，系統認不出，靜靜當那一格是空的
 * ——結果那個人被移出名單，而畫面上什麼都沒有講。下一季他就不會被排到，
 * 而沒有人知道為什麼。
 *
 * 所以 `planEligibilitySheetApply_()` 會把認不出的名字**逐個列出來**，
 * 而且**在有認不出的名字時拒絕套用**，直到幹事處理好為止。
 *
 * ⚠️ 第四十一輪批次 D 組補了一個出口：那張畫面上每一項認不出的名字旁邊
 * 有一粒〔這是新人，一併加入〕，走的是第四十輪那一條
 * `apiAddPersonForUnresolvedName()`——**同一粒掣，不是第二套**。
 * Ivan 實測時撞到的正正是這個：他在「音響」欄打了一個新人的名，
 * 然後整張表都套用不了，而畫面只叫他「去別的地方加這個人」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 第四十一輪批次 D 組：逐項確認
 * ─────────────────────────────────────────────────────────────────────
 *
 * Ivan：「最好在這裡加一個 check box 去確認哪幾項要改。」
 *
 * 他的實際情況是：改一欄的時候順手碰到了另一欄，預覽一出來才發現，
 * 而當時只有「全部套用」同「取消」兩個出口——要嘛連不想要的一起套用，
 * 要嘛整個放棄、回去那張表再改一次。
 *
 * 做法：`apiApplyEligibilitySheet()` 收多一個 `selectedKeys`。
 *
 * ⚠️ 三件事一定要守住：
 *
 *   一、**沒有傳的時候行為同今日一模一樣**（全部套用）。
 *      選單／舊畫面／診斷工具都可能不傳。
 *
 *   二、**仍然重新計算預覽，不信任前端傳來的任何東西。**
 *      `selectedKeys` 只用來「篩走」，不會用來決定寫什麼。
 *      幹事開著預覽的時候有可能又去改了那張表。
 *
 *   三、**勾了但重算之後已經不存在的項要講出來。**
 *      靜靜略過的話，他以為套用了，而實際上一格都沒有動。
 */

/** 名單工作表的名稱。同名會被重建。 */
const ELIGIBILITY_SHEET_NAME = '崗位名單';

/** 第 1 行寫崗位中文名，第 2 行寫機器鍵（PostID），第 3 行起是人名。 */
const ELIGIBILITY_SHEET_FIRST_DATA_ROW = 3;

/**
 * 一項改動的鍵（第四十一輪批次 D 組的逐項確認用）。
 *
 * ⚠️ **只有這裡砌得出這個字串。** 預覽回傳的每一項都自己帶著 `key`，
 * 畫面只負責把它原樣送回來——畫面自己再砌一次的話，格式一改就會
 * 「勾了但套用不到」，而那種錯誤在畫面上完全看不出來。
 *
 * @param {string} kind `ADD` 或者 `REMOVE`
 * @param {string} personId 人員編號
 * @param {string} postId 崗位編號
 * @returns {string} 鍵
 */
function buildEligibilityChangeKey_(kind, personId, postId) {
  return String(kind) + '|' + String(personId) + '|' + String(postId);
}

/**
 * 按幹事勾選的項篩走不要的。**純函式。**
 *
 * ⚠️ `selectedKeys` 是 `null`／`undefined` 的時候**全部保留**——
 * 即是同今日行為一模一樣。選單、舊畫面、診斷工具都可能不傳。
 *
 * ⚠️ 勾了但重算之後已經不存在的項要回報（`vanished`），不可以靜靜略過。
 * 幹事看完預覽之後又去改了那張表，是完全正常的事。
 *
 * @param {Object} plan `planEligibilitySheetApply_()` 的結果
 * @param {string[]=} selectedKeys 勾選了的鍵
 * @returns {{added: Object[], removed: Object[], skipped: Object[], vanished: string[]}}
 */
function filterEligibilityPlanBySelection_(plan, selectedKeys) {
  const all = (plan.added || []).concat(plan.removed || []);
  if (selectedKeys === null || selectedKeys === undefined) {
    return { added: plan.added || [], removed: plan.removed || [], skipped: [], vanished: [] };
  }

  const want = {};
  (selectedKeys || []).forEach(function (k) {
    const s = String(k || '').trim();
    if (s) want[s] = true;
  });

  const present = {};
  all.forEach(function (x) { present[x.key] = true; });

  return {
    added: (plan.added || []).filter(function (a) { return want[a.key] === true; }),
    removed: (plan.removed || []).filter(function (r) { return want[r.key] === true; }),
    skipped: all.filter(function (x) { return want[x.key] !== true; }),
    vanished: Object.keys(want).filter(function (k) { return present[k] !== true; })
  };
}

/**
 * 建立（或重建）那張名單工作表，把現時的 `Eligibility` 攤開成一欄一個崗位。
 *
 * ⚠️ 這個函式**只寫那一張表**，不會碰 `Eligibility` 本身。
 * 真正的寫入在 `applyEligibilitySheet_()`，而且要經過一個預覽。
 *
 * @returns {{sheetName: string, url: string, postCount: number, rowCount: number}}
 */
function buildEligibilitySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(ELIGIBILITY_SHEET_NAME);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(ELIGIBILITY_SHEET_NAME);

  const posts = readPostsNormalized().filter(function (p) { return p.active !== false; });
  const eligibility = readEligibility();
  const N = COLUMNS.NAME_MAPPING;
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    if (!id) return;
    nameById[id] = String(row[N.NAME_TC] || '').trim();
  });

  const columns = posts.map(function (post) {
    const names = (eligibility.byPost[post.postId] || [])
      .map(function (pid) { return nameById[pid] || ''; })
      .filter(function (n) { return n !== ''; })
      .sort();
    return { post: post, names: names };
  });

  const maxRows = columns.reduce(function (m, c) { return Math.max(m, c.names.length); }, 0);
  const width = Math.max(1, columns.length);
  const height = ELIGIBILITY_SHEET_FIRST_DATA_ROW - 1 + Math.max(maxRows, 20);

  const grid = [];
  for (let r = 0; r < height; r++) {
    const line = [];
    for (let c = 0; c < width; c++) {
      const col = columns[c];
      if (!col) { line.push(''); continue; }
      if (r === 0) line.push(col.post.postNameTC);
      else if (r === 1) line.push(col.post.postId);
      else line.push(col.names[r - 2] || '');
    }
    grid.push(line);
  }
  sheet.getRange(1, 1, height, width).setValues(grid);

  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
  // 第 2 行是機器鍵，幹事不需要看。收起來，但**不刪**——
  // 套用的時候要靠它認回是哪一個崗位（靠中文名會在改名之後全部對不上）。
  sheet.hideRows(2);
  sheet.setFrozenRows(2);

  return {
    sheetName: ELIGIBILITY_SHEET_NAME,
    url: buildGridSheetUrl_(ELIGIBILITY_SHEET_NAME),
    postCount: columns.length,
    rowCount: maxRows
  };
}

/**
 * 供前端呼叫：開一張名單工作表出來給幹事改。**會寫入（建立那張表）。**
 * @returns {Object} 工作表名稱同連結
 */
function apiOpenEligibilitySheet() {
  assertWebAppRequestAllowed_();
  const result = buildEligibilitySheet_();
  writeAuditLog_({
    action: 'ELIGIBILITY_SHEET_OPENED',
    targetSheet: result.sheetName,
    targetCell: '',
    oldValue: '',
    newValue: '攤開了 ' + result.postCount + ' 個崗位的名單'
  });
  return result;
}

/**
 * 讀回那張名單工作表，算出「新增了誰、移除了誰、認不出誰」。**純讀取。**
 *
 * @param {string} quarterId 用來判斷「移除的人有沒有已經排在表上」
 * @returns {Object} 預覽
 */
function planEligibilitySheetApply_(quarterId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ELIGIBILITY_SHEET_NAME);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '找不到「' + ELIGIBILITY_SHEET_NAME + '」這一張工作表。',
      '名單沒有任何改動。',
      ['先撳「開啟名單工作表」，改完再回來撳這一粒']));
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < ELIGIBILITY_SHEET_FIRST_DATA_ROW || lastCol < 1) {
    throw new Error(buildThreePartMessage_(
      '「' + ELIGIBILITY_SHEET_NAME + '」是空的。',
      '名單沒有任何改動。',
      ['先撳「開啟名單工作表」重新攤開一次']));
  }

  const postIds = sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v || '').trim();
  });
  const values = sheet.getRange(
    ELIGIBILITY_SHEET_FIRST_DATA_ROW, 1,
    lastRow - ELIGIBILITY_SHEET_FIRST_DATA_ROW + 1, lastCol).getValues();

  const posts = readPostsNormalized();
  const postNameById = {};
  posts.forEach(function (p) { postNameById[p.postId] = p.postNameTC; });

  const current = readEligibility();
  const unresolved = [];
  const wanted = {};   // postId -> {personId: true}

  postIds.forEach(function (postId, c) {
    if (!postId) return;
    if (!postNameById[postId]) {
      // 機器鍵對不上任何崗位。**不可以當那一欄不存在**——
      // 那一欄可能是幹事整欄剪貼錯位，靜靜略過會令整個崗位的名單被清空。
      unresolved.push({
        kind: 'UNKNOWN_POST', postId: postId, text: postId,
        note: '第 ' + (c + 1) + ' 欄的崗位代號「' + postId + '」對不上 Posts 任何一個崗位。'
      });
      return;
    }
    wanted[postId] = {};
    values.forEach(function (rowValues, r) {
      const text = String(rowValues[c] || '').trim();
      if (!text) return;
      const personId = resolvePersonId(text);
      if (!personId) {
        unresolved.push({
          // ⚠️ `postNameTC` 一定要帶出去：畫面上那一粒〔這是新人，一併加入〕
          // 會問「同時讓他可以做『○○』」，只有 `postId` 的話那句就會
          // 變成一串代號，而幹事根本看不懂自己在答什麼。
          kind: 'UNKNOWN_NAME', postId: postId, postNameTC: postNameById[postId], text: text,
          note: postNameById[postId] + '　第 ' + (r + ELIGIBILITY_SHEET_FIRST_DATA_ROW)
            + ' 行的「' + text + '」不在人員名單裡面。'
        });
        return;
      }
      wanted[postId][personId] = true;
    });
  });

  // ── 比對 ─────────────────────────────────────────────────────
  const N = COLUMNS.NAME_MAPPING;
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    if (id) nameById[id] = String(row[N.NAME_TC] || '').trim();
  });

  const added = [];
  const removed = [];
  Object.keys(wanted).forEach(function (postId) {
    const before = {};
    (current.byPost[postId] || []).forEach(function (pid) { before[pid] = true; });
    Object.keys(wanted[postId]).forEach(function (pid) {
      if (!before[pid]) {
        added.push({ postId: postId, postNameTC: postNameById[postId], personId: pid,
          nameTC: nameById[pid] || pid,
          key: buildEligibilityChangeKey_('ADD', pid, postId) });
      }
    });
    Object.keys(before).forEach(function (pid) {
      if (!wanted[postId][pid]) {
        removed.push({ postId: postId, postNameTC: postNameById[postId], personId: pid,
          nameTC: nameById[pid] || pid,
          key: buildEligibilityChangeKey_('REMOVE', pid, postId) });
      }
    });
  });

  // ⚠️ 被移走的人如果已經排在現有職事表上，要特別標出來——
  // 移走名單不會把他從已排好的格子拿走，但下一次重排就不會再有他。
  // 幹事需要知道這件事，否則會以為「移走了就等於換了人」。
  //
  // ⚠️ 第四十一輪批次 D 組：不只要數目，還要**具體是哪幾個主日**。
  // Ivan 的原話是他看不出「還有 3 格」是指哪一季、哪幾個日子。
  // 一個他核對不到的數字，同沒有講差不多。
  const assignedNow = {};
  const assignedDates = {};
  const versionNo = findLatestVersionNo(quarterId);
  const tz = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  if (versionNo >= 0) {
    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      const pid = String(row[A.PERSON_ID] || '').trim();
      if (!pid) return;
      const key = pid + '|' + row[A.POST_ID];
      assignedNow[key] = (assignedNow[key] || 0) + 1;
      if (!assignedDates[key]) assignedDates[key] = [];
      assignedDates[key].push(toDateString(row[A.SERVICE_DATE], tz));
    });
  }
  removed.forEach(function (r) {
    const key = r.personId + '|' + r.postId;
    r.assignedCount = assignedNow[key] || 0;
    r.assignedDates = (assignedDates[key] || []).sort();
  });

  const byName = function (a, b) {
    if (a.postNameTC !== b.postNameTC) return a.postNameTC < b.postNameTC ? -1 : 1;
    return a.nameTC < b.nameTC ? -1 : (a.nameTC > b.nameTC ? 1 : 0);
  };

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    added: added.sort(byName),
    removed: removed.sort(byName),
    unresolved: unresolved,
    // 有認不出的名字就**不准套用**，理由見檔頭。
    blocked: unresolved.length > 0,
    postCount: Object.keys(wanted).length
  };
}

/**
 * 供前端呼叫：名單工作表的套用預覽。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} 預覽
 */
function apiPlanEligibilitySheetApply(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    return planEligibilitySheetApply_(quarterId);
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：真正把那張表寫回 `Eligibility`。
 *
 * ⚠️ **會重新計算預覽，不信任前端傳來的任何東西。** 幹事開著預覽的時候
 * 有可能又去改了那張表；照著一份舊預覽寫入就會寫錯，而且畫面上看不出。
 * 這跟 `executeStep3Release_()` 是同一個理由。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 實際寫入的結果
 */
function apiApplyEligibilitySheet(quarterId, selectedKeys) {
  assertWebAppRequestAllowed_();
  const plan = planEligibilitySheetApply_(quarterId);
  if (plan.blocked) {
    throw new Error(buildThreePartMessage_(
      '名單裡面有 ' + plan.unresolved.length + ' 個名字系統認不出。',
      '名單沒有任何改動——一個都沒有寫入。',
      ['回去「' + ELIGIBILITY_SHEET_NAME + '」那張表，把那幾個名字改成正確的寫法',
        '如果那是一位新人，先去「名單維護 ▸ 人員與電郵」加入他',
        '改好之後再撳一次「儲存並套用名單」']));
  }
  if (plan.added.length === 0 && plan.removed.length === 0) {
    return { changed: false, added: 0, removed: 0, message: '名單沒有改動，不需要儲存。' };
  }

  // ⚠️ 第四十一輪批次 D 組：逐項確認。篩走之後，下面每一段都只看
  // `pick.added` ／ `pick.removed`——**不可以再有一段用回 `plan.added`**，
  // 那樣就會出現「畫面說略過了，而系統照樣寫入」，
  // 即是這個專案最常出現的那一類 bug：兩個來源，只更新了一個。
  const pick = filterEligibilityPlanBySelection_(plan, selectedKeys);
  if (pick.added.length === 0 && pick.removed.length === 0) {
    return {
      changed: false, added: 0, removed: 0, skipped: pick.skipped.length,
      vanished: pick.vanished,
      message: '一項都沒有勾選，所以一項都沒有寫入。'
    };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ELIGIBILITY);
  if (!sheet) throw new Error('找不到工作表: ' + SHEETS.ELIGIBILITY);
  const E = COLUMNS.ELIGIBILITY;
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = function (k) { return headers.indexOf(k) + 1; };
  const lastRow = sheet.getLastRow();

  // ── 移走：設 Active = FALSE，**不刪行** ──────────────────────
  //
  // ⚠️ 跟區三那個畫面同一個做法（見它的說明）：不再服侍是「停用」，
  // 不是「刪除」。刪了行就沒有任何紀錄講得出這個人曾經在名單上，
  // 而稽核要答得出「他上一季為什麼會被排到」。
  const removeKeys = {};
  pick.removed.forEach(function (r) { removeKeys[r.personId + '|' + r.postId] = true; });

  let removedCount = 0;
  if (lastRow >= 3 && col(E.ACTIVE) > 0) {
    for (let r = 3; r <= lastRow; r++) {
      const pid = String(sheet.getRange(r, col(E.PERSON_ID)).getValue() || '').trim();
      const post = String(sheet.getRange(r, col(E.POST_ID)).getValue() || '').trim();
      if (!removeKeys[pid + '|' + post]) continue;
      if (sheet.getRange(r, col(E.ACTIVE)).getValue() === false) continue;
      sheet.getRange(r, col(E.ACTIVE)).setValue(false);
      removedCount++;
    }
  }

  // ── 新增：先找有沒有一行停用了的，有就重新啟用；沒有才新增一行 ──
  //
  // ⚠️ 不先找就直接新增，同一個人同一個崗位會累積出好幾行
  // （每停用再加入一次就多一行），而 `readEligibility()` 讀到的是
  // 「有沒有一行 Active=TRUE」，所以畫面看起來完全正常，
  // 只有那張表會愈來愈長、愈來愈難看得懂。
  let addedCount = 0;
  const appendRows = [];
  pick.added.forEach(function (a) {
    let revived = false;
    if (lastRow >= 3) {
      for (let r = 3; r <= lastRow; r++) {
        const pid = String(sheet.getRange(r, col(E.PERSON_ID)).getValue() || '').trim();
        const post = String(sheet.getRange(r, col(E.POST_ID)).getValue() || '').trim();
        if (pid !== a.personId || post !== a.postId) continue;
        sheet.getRange(r, col(E.ACTIVE)).setValue(true);
        if (col(E.ELIGIBLE) > 0) sheet.getRange(r, col(E.ELIGIBLE)).setValue(true);
        revived = true;
        break;
      }
    }
    if (revived) { addedCount++; return; }
    const line = new Array(headers.length).fill('');
    if (col(E.ELIGIBILITY_ID) > 0) {
      line[col(E.ELIGIBILITY_ID) - 1] = 'E-' + a.postId + '-' + a.personId;
    }
    line[col(E.PERSON_ID) - 1] = a.personId;
    line[col(E.POST_ID) - 1] = a.postId;
    if (col(E.ELIGIBLE) > 0) line[col(E.ELIGIBLE) - 1] = true;
    if (col(E.ACTIVE) > 0) line[col(E.ACTIVE) - 1] = true;
    appendRows.push(line);
    addedCount++;
  });
  if (appendRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appendRows.length, headers.length)
      .setValues(appendRows);
  }

  // ⚠️ 第四十一輪批次 A 組：名單改咗，下拉選單要跟住更新。
  //
  // Ivan 明講：「如果『事奉人員名單』有更新，這個也要自動再跑一次去更新下拉選單。」唔跑嘅話，佢喺表上見到嘅選單仲係舊名單，
  // 而佢啱啱先改完——嗰個係「畫面同資料唔同步」，最難察覺嗰種。
  //
  // ⚠️ 失敗唔可以令「套用名單」變成失敗——名單本身已經寫好咗。
  // 但要記低，而且回傳畀畫面講一句。
  let dropdownNote = '';
  try {
    const v = findLatestVersionNo(quarterId);
    if (v >= 0) applyGridNameDropdowns_(quarterId, v);
  } catch (err) {
    log_('WARN', '名單套用咗，但下拉選單更新唔到：' + err.message);
    dropdownNote = '名單已經套用好，但職事表上的下拉選單更新不到（'
      + err.message + '）。可以去「進階與診斷 ▸ 更新名單選單」再試一次。';
  }

  writeAuditLog_({
    action: 'ELIGIBILITY_SHEET_APPLIED',
    targetSheet: SHEETS.ELIGIBILITY,
    targetCell: '',
    oldValue: '',
    newValue: '加入 ' + addedCount + ' 項、停用 ' + removedCount + ' 項'
      + (pick.skipped.length > 0 ? ('（幹事略過了 ' + pick.skipped.length + ' 項）') : '')
  });

  return {
    changed: true,
    added: addedCount,
    removed: removedCount,
    // ⚠️ 略過了幾多項一定要回報。幹事勾走了兩項，而畫面只講「已經加入 5 項」
    // 的話，他分不出系統是照他意思略過了，還是連他勾了的那幾項都漏做。
    skipped: pick.skipped.length,
    skippedItems: pick.skipped.map(function (x) {
      return { postNameTC: x.postNameTC, nameTC: x.nameTC, key: x.key };
    }),
    // ⚠️ 勾了但重算之後已經不存在的項。他看預覽的時候又去改了那張表，
    // 是完全正常的事——但一定要講，否則他以為那幾項套用了。
    vanished: pick.vanished,
    stillAssigned: pick.removed.filter(function (r) { return r.assignedCount > 0; }),
    dropdownNote: dropdownNote,
    message: '已經加入 ' + addedCount + ' 項、停用 ' + removedCount + ' 項。'
      + (pick.skipped.length > 0
        ? ('按你的勾選略過了 ' + pick.skipped.length + ' 項，那幾項一格都沒有動。')
        : '')
  };
}
