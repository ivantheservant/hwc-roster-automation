/**
 * 第三十九輪批次 A 組第 3 步：**在職事表加入名單下拉選單。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這一步要解決什麼
 * ═════════════════════════════════════════════════════════════════════
 *
 * 幹事在職事表上改一格，現在是憑記憶打字。打錯字、或者放了一個不合資格
 * 的人，要等到撳「儲存我的修改」才會被規則檢查抓到。
 *
 * 加一個下拉選單，令他**改的時候就見到該崗位有誰**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 下拉選單**不可以變成限制**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 外請講員、新人、借調——這些名字本來就不在任何名單上，而且是真實會
 * 發生的事。一個「只准揀名單上的」下拉選單會把這幾種情況直接堵死。
 *
 * 所以一律 `setAllowInvalid(true)`：**有選單，但照樣可以打任何字。**
 * 打了名單以外的名，儲存的時候那道確認清單會逐項列出來讓他看一眼——
 * 那才是把關的位置，不是這裡。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 「不由系統排」的崗位不設選單
 * ─────────────────────────────────────────────────────────────────────
 *
 * 講員／翻譯／獻花（`AutoGenerate=FALSE`）的值本來就是自由文字，
 * 而且外請講員不在 `NameMapping`。給這幾欄一個選單只會誤導——
 * 幹事會以為「不在選單上就是不可以」。這幾欄刻意留白。
 */

/**
 * 一欄下拉選單最多列幾多個名。
 *
 * ⚠️ 這不是 Google 的硬限制，是可用性的限制：一條要捲一分鐘的選單
 * 比沒有選單更難用。超過就整欄不設選單（並在回報裡面講明是哪一欄），
 * **不會靜靜截斷**——截斷等於告訴幹事「這個人不可以」，而那是假的。
 */
const GRID_DROPDOWN_MAX_OPTIONS = 200;

/**
 * 把某一版職事表的每個「系統會排」的崗位欄，設上該崗位的合資格名單選單。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object} {sheetName, columns, skipped, unprotected}
 */
function applyGridNameDropdowns_(quarterId, versionNo) {
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(buildThreePartMessage_(
      '找不到「' + sheetName + '」這一張工作表。',
      '職事表沒有任何改動。',
      ['去「進階與診斷 ▸ 回到上一個版本」重新建立一張',
        '如果那張表只是被改了名，把名字改回原本的就可以']));
  }
  // 正式那一張的機器鍵一定在第 2 行（見 `buildGridLayout_()`）。
  return applyNameDropdownsToSheet_(sheet, sheetName, 2);
}

/**
 * 第四十三輪批次 C2：**把下拉選單套到任何一張 grid 形狀的工作表。**
 *
 * ⚠️ 存在的理由：`_建議` 工作表都要有選單——Ivan 就是要在那一張上面
 * 直接再改。而它的機器鍵行**不在第 2 行**（表頂有一段圖例），
 * 所以行號要由呼叫端傳入。
 *
 * ⚠️ 抽出來而不是在建議表那邊另寫一份：兩份的話，
 * 「`setAllowInvalid(true)`」「講員／翻譯／獻花不設選單」
 * 「設不到要老實講」這三條規矩會慢慢只剩一邊有。
 *
 * @param {Sheet} sheet 目標工作表
 * @param {string} sheetName 工作表名稱（只用來回報）
 * @param {number} keyRow 機器鍵在第幾行
 * @returns {Object} 逐欄的結果
 */
function applyNameDropdownsToSheet_(sheet, sheetName, keyRow) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const dataStart = keyRow + 1;
  if (lastRow < dataStart || lastCol < 1) {
    return { sheetName: sheetName, columns: [], skipped: [], unprotected: false };
  }

  const keys = sheet.getRange(keyRow, 1, 1, lastCol).getValues()[0].map(String);

  const posts = readPostsNormalized();
  const postById = {};
  posts.forEach(function (p) { postById[p.postId] = p; });

  const eligibility = readEligibility();
  const N = COLUMNS.NAME_MAPPING;
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    // ⚠️ 停用的人不進選單，但**不會**從既有格子移走——那是另一件事，
    // 由名單維護那一步負責。這裡只影響「有沒有得揀」。
    if (!id || row[N.ACTIVE] === false) return;
    nameById[id] = String(row[N.NAME_TC] || '').trim();
  });

  const columns = [];
  const skipped = [];

  const unprotected = writeToPossiblyProtectedGridSheet_(sheet, function () {
    keys.forEach(function (key, i) {
      const parts = String(key).split('#');
      const postId = parts[0];
      const post = postById[postId];
      if (!post) return;                      // 日期／週次／類型三欄

      // 不由系統排的崗位刻意留白，理由見檔頭。
      if (post.autoGenerate === false) {
        skipped.push({ postId: postId, postNameTC: post.postNameTC, reason: 'NOT_AUTO' });
        return;
      }

      const names = (eligibility.byPost[postId] || [])
        .map(function (pid) { return nameById[pid]; })
        .filter(function (n) { return !!n; })
        .sort();

      if (names.length === 0) {
        skipped.push({ postId: postId, postNameTC: post.postNameTC, reason: 'NO_ELIGIBLE' });
        return;
      }
      if (names.length > GRID_DROPDOWN_MAX_OPTIONS) {
        skipped.push({ postId: postId, postNameTC: post.postNameTC, reason: 'TOO_MANY' });
        return;
      }

      // ⚠️ `setAllowInvalid(true)` 是這整個功能的關鍵，見檔頭。
      // 改成 false 就會把外請講員／新人／借調直接堵死。
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(names, true)
        .setAllowInvalid(true)
        .setHelpText('可以在選單裡面選，也可以直接打一個不在名單上的名'
          + '（外請講員、新人、借調都是這樣填）。')
        .build();
      // ⚠️ 第四十一輪批次 A 組：設不到要老實講，不可以靜靜失敗。
      //
      // 第三十九輪的報告講明：受保護的第 0 版上面設不設得到資料驗證，
      // 從來沒有在現場驗過。離線的 mock 不模擬保護，所以測試證不到。
      //
      // 靜靜失敗的後果：幹事開了表，那一欄沒有選單，
      // 而系統剛剛才說「已經加入名單選單」——他會以為是自己看錯。
      try {
        sheet.getRange(dataStart, i + 1, lastRow - dataStart + 1, 1).setDataValidation(rule);
        columns.push({ postId: postId, postNameTC: post.postNameTC, optionCount: names.length });
      } catch (err) {
        skipped.push({
          postId: postId, postNameTC: post.postNameTC,
          reason: 'SET_FAILED', error: err.message
        });
      }
    });
  });

  return { sheetName: sheetName, columns: columns, skipped: skipped, unprotected: unprotected };
}

/**
 * 供前端呼叫：在最新一版職事表加入名單下拉選單。
 *
 * ⚠️ **會寫入**（資料驗證是工作表的一部分），所以前端一定要用
 * `callServerMutating()`。它不會改任何一格的**內容**，但會改那張表。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 逐欄的結果，前端用來寫一句人話
 */
function apiApplyGridNameDropdowns(quarterId) {
  assertWebAppRequestAllowed_();
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。',
      '職事表沒有任何改動。',
      ['先在第 1 步生成職事表']));
  }
  const result = applyGridNameDropdowns_(quarterId, versionNo);

  writeAuditLog_({
    action: 'GRID_DROPDOWN_APPLIED',
    targetSheet: result.sheetName,
    targetCell: '',
    oldValue: '',
    newValue: '設定了 ' + result.columns.length + ' 欄的名單選單'
  });

  return {
    versionNo: versionNo,
    sheetName: result.sheetName,
    columns: result.columns,
    skipped: result.skipped,
    // 一句人話，前端直接顯示。
    summary: buildGridDropdownSummary_(result)
  };
}

/**
 * 把逐欄結果寫成一句人話。
 *
 * ⚠️ 略過了的欄**一定要講出來**，而且要講原因。不講的話，幹事會以為
 * 「那一欄壞了」，或者更差——以為那一欄不用填。
 * @param {Object} result `applyGridNameDropdowns_()` 的結果
 * @returns {string} 一到三句
 */
function buildGridDropdownSummary_(result) {
  const lines = [];
  lines.push('已經在 ' + result.columns.length + ' 欄加入名單選單。'
    + '你照樣可以直接打一個不在名單上的名（外請講員、新人、借調都是這樣填）。');

  const notAuto = result.skipped.filter(function (s) { return s.reason === 'NOT_AUTO'; });
  if (notAuto.length > 0) {
    lines.push('這幾欄沒有加：' + notAuto.map(function (s) { return s.postNameTC; }).join('、')
      + '——它們本來就不由系統排，值是自由文字（外請講員不在人員名單裡面）。');
  }

  const noOne = result.skipped.filter(function (s) { return s.reason === 'NO_ELIGIBLE'; });
  if (noOne.length > 0) {
    lines.push('這幾欄查不到任何合資格的人，所以沒有選單：'
      + noOne.map(function (s) { return s.postNameTC; }).join('、')
      + '。去第 3 步維護名單就會有。');
  }

  // ⚠️ 設不到（多數是工作表被保護）一定要講出來，而且要講建議。
  // 這是第三十九輪報告點名「從來沒有在現場驗過」的那一個情況。
  const setFailed = result.skipped.filter(function (s) { return s.reason === 'SET_FAILED'; });
  if (setFailed.length > 0) {
    lines.push('這幾欄設不到選單：'
      + setFailed.map(function (s) { return s.postNameTC; }).join('、')
      + '。多數是因為那一張工作表被保護了（第 0 版預設會保護）。'
      + '職事表本身完全正常，只是那幾欄沒有下拉選單，你照樣可以直接打字。'
      + '（第一個錯誤：' + setFailed[0].error + '）');
  }

  const tooMany = result.skipped.filter(function (s) { return s.reason === 'TOO_MANY'; });
  if (tooMany.length > 0) {
    lines.push('這幾欄的合資格人數超過 ' + GRID_DROPDOWN_MAX_OPTIONS
      + ' 位，選單會長到不好用，所以沒有加：'
      + tooMany.map(function (s) { return s.postNameTC; }).join('、') + '。');
  }
  return lines.join('\n');
}
