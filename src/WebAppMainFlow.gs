/**
 * 第三十九輪批次 A 組：**幹事主流程六步**的伺服器端。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這一個檔案為什麼存在
 * ═════════════════════════════════════════════════════════════════════
 *
 * 目標由「修 bug」轉成「**幹事撳得落手**」。幹事真實的工作流程就是
 * 六件事，順序固定：
 *
 *   1. 生成下一季職事表
 *   2. 查看／修改職事表
 *   3. 改動時的名單協助（下拉選單 ＋ 儲存前的確認清單）
 *   4. 維護各崗位的事奉人員名單
 *   5. 寄出
 *   6. 沒有電郵的人要印紙本
 *
 * ⚠️ 這一輪**沒有刪走任何現有功能**，也沒有改任何一項的行為。
 * 這裡加的是「把最常用的六件事抽出來、放到最頂」需要的那幾個唯讀查詢，
 * 以及第 3、4 步真正新加的東西。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 「不要要他揀季度」怎麼做到
 * ─────────────────────────────────────────────────────────────────────
 *
 * 第 1 步的掣上面直接寫出是哪一季（「生成 2027 年 1-3 月職事表」），
 * 不要他自己在下拉選單裡面找。判斷規則寫在
 * `resolveGenerateTargetQuarter_()`，一句話：
 *
 *   **他現在看著的那一季如果還沒有生成過，就是它；否則就是下一季。**
 *
 * 而且**准許**他生成一個已經開始、甚至已經過去的季度——只是先講清楚。
 * 擋住他不是我們的位置：補一個漏掉的舊季度是真實會發生的事。
 */

/** 第 1 步的目標季度：那一季已經開始了。 */
const GENERATE_TARGET_WARN_STARTED = 'STARTED';
/** 第 1 步的目標季度：那一季已經完全過去了。 */
const GENERATE_TARGET_WARN_PAST = 'PAST';

/**
 * 第 1 步的目標季度：**還沒有到生成日期。**
 *
 * ⚠️ 第四十輪批次 E 組。2026-08-21 實測撞到：今日撳那粒掣寫住
 * 「生成 2027 年 1-3 月職事表」，而 `2027T1` 的 `GenerateOn` 是
 * 2026-11-27——還有三個多月。那一季是 Ivan 留來真正上線那一季，
 * 今日撳落去會把它用掉。
 *
 * 原本的規則只看「有沒有生成過」，完全沒有看「到了生成日期沒有」。
 *
 * ⚠️ 這個仍然是**警告，不是阻擋**。提早生成不會出錯，
 * 只是之後義工的情況可能會變、到時要重新生成。擋住他不是我們的位置。
 */
const GENERATE_TARGET_WARN_TOO_EARLY = 'TOO_EARLY';

/**
 * 第 1 步的目標季度：**所有已建立的季度都生成過了。**
 *
 * ⚠️ 第四十二輪批次 C 組。這一種情況掣是灰的，幹事做不到任何事——
 * 所以這時候**不可以**再講「還有 9 天到生成日期」那一類話。
 * 唯一有用的資訊是「下一步去哪裡」（去開一年新的季度）。
 */
const GENERATE_TARGET_WARN_ALL_GENERATED = 'ALL_GENERATED';

/**
 * 決定第 1 步那粒掣要生成哪一季。**純讀取。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ 第四十二輪批次 C 組：這一粒掣曾經整粒廢掉
 * ═════════════════════════════════════════════════════════════════════
 *
 * 2026-08-21 現場：掣寫住「生成 2026 年 10-12 月職事表」，**灰色、撳不到**，
 * 而下面同時講「已經生成過了」同「生成日期是 2026-08-30，還有 9 天」。
 *
 * 成因是舊規則第 3 條：全部季度都有版本的時候，回傳「開始日期在今天之後
 * 最早那一季」——那一季**已經生成過**，所以掣變灰。而它**不會**跳去
 * 下一個未生成的季度。
 *
 * 結果：幹事**永遠測不到第 1 步**，而那是他每季第一件做的事。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 新規則（順序就是優先次序）
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. 幹事現在看著的那一季，如果還沒有任何版本 ⇒ 就是它
 *      （他打開了它、看著它，最想做的一定是生成它）
 *   2. **由今日起計**，第一個還沒有版本的季度（`endDate >= today`）
 *   3. 都找不到 ⇒ 還沒有版本、但已經完全過去的季度之中最早那一個
 *      （補一個漏掉的舊季度是真實會發生的事，`PAST` 警告會講清楚）
 *   4. 全部季度都已經生成過 ⇒ 才顯示灰掣，並且講清楚下一步去哪裡
 *
 * ⚠️ 第 4 種情況**不再算任何日期警告**。「已經全部生成過」同
 * 「還有 9 天到生成日期」放在同一塊講，幹事讀出來只會覺得系統壞了
 * ——而他其實什麼都做不到，因為掣是灰的。
 *
 * @param {string} selectedQuarterId 幹事現在看著的季度
 * @returns {Object} 目標季度同警告
 */
function resolveGenerateTargetQuarter_(selectedQuarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const goLiveQuarterId = String(
    getConfig(CONFIG_KEYS.GO_LIVE_QUARTER_ID, DEFAULTS.GO_LIVE_QUARTER_ID) || '').trim();
  const C = COLUMNS.QUARTERS;

  const quarters = readSheet(SHEETS.QUARTERS).map(function (row) {
    const quarterId = String(row[C.QUARTER_ID] || '').trim();
    return {
      quarterId: quarterId,
      startDate: toDateString(row[C.START_DATE], timezone),
      endDate: toDateString(row[C.END_DATE], timezone),
      // 第四十輪批次 E 組：生成日期。幹事要一眼看得到自己在做什麼。
      generateOn: toDateString(row[C.GENERATE_ON], timezone),
      versionNo: findLatestVersionNo(quarterId)
    };
  }).filter(function (q) { return q.quarterId !== ''; });

  if (quarters.length === 0) {
    return {
      quarterId: '', label: '', found: false,
      alreadyGenerated: false, warn: '', warnMessage: '',
      reason: '`Quarters` 工作表一行都沒有。'
    };
  }

  quarters.sort(function (a, b) { return a.startDate < b.startDate ? -1 : (a.startDate > b.startDate ? 1 : 0); });

  const selected = quarters.filter(function (q) { return q.quarterId === selectedQuarterId; })[0];
  const ungenerated = quarters.filter(function (q) { return q.versionNo < 0; });
  // 「由今日起計」＝ 還沒有完全過去。`endDate` 空白的照樣算在內——
  // ⚠️ 空白不等於「已經過去」，把它剔走就會令一個資料填漏的季度
  // 靜靜地永遠揀不到。
  const upcoming = ungenerated.filter(function (q) {
    return !q.endDate || q.endDate >= today;
  });

  let target = null;
  let allGenerated = false;
  if (selected && selected.versionNo < 0) {
    target = selected;
  } else if (upcoming.length > 0) {
    target = upcoming[0];
  } else if (ungenerated.length > 0) {
    // 只剩下已經完全過去、而又未生成過的季度。照樣指向它並且撳得到
    // ——補一個漏掉的舊季度是真實會發生的事。`PAST` 警告會講清楚。
    target = ungenerated[ungenerated.length - 1];
  } else {
    // 全部生成過。指向最後一季，掣變灰，而且**不算任何日期警告**。
    allGenerated = true;
    target = quarters[quarters.length - 1];
  }

  // ⚠️ 「已經開始」同「已經過去」是兩件事，訊息不一樣。
  // 合成一句「日期不對」會令幹事不知道到底發生什麼事。
  // 距離生成日期還有幾多天。算不出（沒填 GenerateOn）就是 null——
  // ⚠️ **不可以當成 0**：0 的意思是「今日就是生成日」，那是一個肯定句，
  // 而我們根本不知道。
  const daysUntil = target.generateOn ? daysBetween_(today, target.generateOn) : null;

  let warn = '';
  let warnMessage = '';
  if (allGenerated) {
    // ⚠️ 什麼日期警告都不算。掣是灰的，他做不到任何事——
    // 這時候唯一有用的資訊是「下一步去哪裡」。
    warn = GENERATE_TARGET_WARN_ALL_GENERATED;
    warnMessage = buildThreePartMessage_(
      '所有已建立的季度都生成過了。',
      '什麼都沒有改動。',
      ['要建立更下一年的季度，請去「開季前準備 ▸ 產生下一年度四個季度」',
        '要重新生成一個已經生成過的季度（會覆蓋現有安排），'
          + '請去「進階與診斷 ▸ 重新生成職事表」']);
  } else if (target.endDate && target.endDate < today) {
    warn = GENERATE_TARGET_WARN_PAST;
    warnMessage = buildThreePartMessage_(
      '「' + buildQuarterLabel_(target.quarterId) + '」已經完全過去了（' + target.endDate + ' 結束）。',
      '還沒有生成，所以現在什麼都沒有改動。',
      ['如果你是在補一個漏掉的舊季度，照樣生成沒有問題',
        '如果你想做的是下一季，請在最上面的季度選單改一改']);
  } else if (target.generateOn && target.generateOn > today) {
    // ⚠️ 次序：「已經過去」同「已經開始」行先。
    // 一季既已經開始、又未到生成日期，是資料本身矛盾（GenerateOn 填錯了），
    // 這時候講「已經開始」對幹事有用得多——那才是他看得見的事實。
    warn = GENERATE_TARGET_WARN_TOO_EARLY;
    warnMessage = buildThreePartMessage_(
      '「' + buildQuarterLabel_(target.quarterId) + '」的生成日期是 '
        + target.generateOn + '，還有 ' + daysUntil + ' 天。',
      '還沒有生成，所以現在什麼都沒有改動。',
      ['提早生成不會出錯，但之後義工的情況可能會變，到時要重新生成',
        '如果你只是想試一試，用一個測試季度，不要用這一季']);
  } else if (target.startDate && target.startDate <= today) {
    warn = GENERATE_TARGET_WARN_STARTED;
    warnMessage = buildThreePartMessage_(
      '「' + buildQuarterLabel_(target.quarterId) + '」已經開始了（' + target.startDate + ' 開始）。',
      '還沒有生成，所以現在什麼都沒有改動。',
      ['如果這一季真的還沒有排過，照樣生成沒有問題',
        '已經過去的那幾個主日，系統照樣會排——生成之後記得看一看']);
  }

  return {
    quarterId: target.quarterId,
    label: buildQuarterLabel_(target.quarterId),
    startDate: target.startDate,
    endDate: target.endDate,
    found: true,
    // 第四十輪批次 E 組：掣旁邊要顯示，令幹事一眼看到自己在做什麼。
    generateOn: target.generateOn,
    daysUntilGenerateOn: daysUntil,
    alreadyGenerated: target.versionNo >= 0,
    // ⚠️ 第四十二輪批次 C 組：掣旁邊要同時顯示「現時有幾多個版本」。
    // `findLatestVersionNo()` 回 -1 代表一個都沒有；版本由 v0 起計，
    // 所以「有幾多個」＝ 最新版本號 ＋ 1。
    versionCount: target.versionNo >= 0 ? target.versionNo + 1 : 0,
    latestVersionNo: target.versionNo,
    allGenerated: allGenerated,
    // ⚠️ 第四十二輪批次 C 組：這一季是不是真正要上線那一季。
    // 由 Config 的 `GO_LIVE_QUARTER_ID` 決定——**不可以寫死**，
    // 那是教會的資料，而且每年都不同。留空就永遠是 false。
    isGoLiveQuarter: goLiveQuarterId !== '' && goLiveQuarterId === target.quarterId,
    warn: warn,
    warnMessage: warnMessage,
    reason: ''
  };
}

/**
 * 那條永久連結的說明。**一段寫死的人話，前端同文件用同一份。**
 *
 * ⚠️ 幹事最常問的一句是「內容改了要不要換連結」。答案寫在這裡，
 * 讓介面上直接看得到，不用他去翻文件。
 * @returns {string} 兩句人話
 */
function buildPermanentLinkExplanation_() {
  return '這是唯一一條連結。它永遠指向你最近一次「儲存我的修改」的版本。'
    + '內容改了之後不用換連結，收到的人重新開就見到新版。';
}

/**
 * 供前端呼叫：主流程六步需要、而 `apiGetDashboardState()` 沒有的那幾樣。
 * **純讀取，一格都不會寫。**
 *
 * ⚠️ 刻意不把這些塞進 `apiGetDashboardState()`：那一個已經很重，
 * 而且每次換季度、每次做完動作都會重跑。這一份只在畫主流程時要。
 *
 * @param {string} quarterId 幹事現在看著的季度
 * @returns {Object} 六步要的資料
 */
function apiGetMainFlowState(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const generateTarget = resolveGenerateTargetQuarter_(quarterId);
    const publicLink = readPublicLinkState_(quarterId);
    return {
      generateTarget: generateTarget,
      permanentLink: {
        url: publicLink.fileUrl || '',
        hasLink: !!publicLink.hasLink,
        checkFailed: !!publicLink.checkFailed,
        explanation: buildPermanentLinkExplanation_()
      },
      // 第四十一輪批次 B 組：而家有冇一張未處理嘅建議表。
      //
      // ⚠️ 有建議表而畫面唔講，幹事會喺正式表上改，然後發現改動唔見咗
      // ——因為下一次「請系統幫我調整」會以建議表做起點。
      suggestion: readSuggestionStateSafely_(quarterId),
      // 第 5 步要的人數，喺呢度一次過算好，唔使前端再叫多一次。
      paperCount: countPeopleWithoutEmail_(quarterId)
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 這一季有沒有一張未處理的建議表。**純讀取，而且不會拋錯。**
 *
 * ⚠️ 讀不到不可以令整個主流程畫不出來——那樣幹事會見到一版接近空白
 * 的畫面而完全不知道發生什麼事。讀不到就當「沒有」，並且寫 log。
 * @param {string} quarterId 季度 ID
 * @returns {Object} {hasSuggestion, sheetName, url}
 */
function readSuggestionStateSafely_(quarterId) {
  try {
    return apiGetSuggestionState(quarterId);
  } catch (err) {
    log_('WARN', 'readSuggestionStateSafely_：' + err.message);
    return { hasSuggestion: false, sheetName: '', url: '' };
  }
}

/**
 * 這一季有幾多位排了工、但 `NameMapping` 沒有電郵的人。**純讀取。**
 *
 * ⚠️ 「查不到電郵」不等於「這個人不用服侍」——他照樣要收到職事表，
 * 只是要印紙本。所以這個數字要在主流程第 5 步直接看得見，
 * 而不是等寄完信之後才在報告裡面出現。
 * @param {string} quarterId 季度 ID
 * @returns {number} 人數；算不出時回 0（並寫 log，不拋錯）
 */
function countPeopleWithoutEmail_(quarterId) {
  try {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) return 0;
    return listPeopleNeedingPaper_(quarterId, versionNo).length;
  } catch (err) {
    log_('WARN', 'countPeopleWithoutEmail_ 算不出：' + err.message);
    return 0;
  }
}

/**
 * 把這一版有派工的人分成兩批：沒有電郵的、有電郵的。**純讀取。**
 *
 * ⚠️ 這是第 5 步唯一的名單來源。
 *
 * 第三十九輪原本寫成兩個函式（一個算人數、一個出名單），各自建一次
 * 名字對照表、各自寫一次「查不到名字」的處理。`tools/verify-red.js`
 * 立刻抓到：把其中一個改壞，測試照樣綠燈——因為測試踩的是另一個。
 *
 * 那正正是本專案反覆出事那一類（**兩個真相來源，只改一個**）。
 * 所以合併成這一個，兩邊都叫它。
 *
 * ⚠️ 只算「這一版真的有派工」的人。整張 `NameMapping` 裡面沒有電郵的人
 * 之中，有些這一季根本沒有服侍——印他們的紙本是浪費，而且會令幹事
 * 以為漏了什麼。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{noEmail: Object[], withEmail: Object[]}} 每筆 {personId, nameTC, cellCount}
 */
function splitAssignedPeopleByEmail_(quarterId, versionNo) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const N = COLUMNS.NAME_MAPPING;

  const emailById = {};
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    if (!id) return;
    emailById[id] = String(row[N.EMAIL] || '').trim();
    nameById[id] = String(row[N.NAME_TC] || '').trim();
  });

  const countById = {};
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
    if (Number(row[A.VERSION_NO]) !== versionNo) return;
    const id = String(row[A.PERSON_ID] || '').trim();
    if (!id) return;
    countById[id] = (countById[id] || 0) + 1;
  });

  const noEmail = [];
  const withEmail = [];
  Object.keys(countById).forEach(function (id) {
    const entry = {
      personId: id,
      // ⚠️ 查不到名字**不可以**當成空白略過——那樣幹事會少印一份，
      // 而且完全不知道少了誰。照樣列出來，用一句講明查不到。
      nameTC: nameById[id] || ('（NameMapping 查不到這個編號：' + id + '）'),
      cellCount: countById[id]
    };
    if (emailById[id]) withEmail.push(entry); else noEmail.push(entry);
  });

  const byName = function (a, b) {
    return a.nameTC < b.nameTC ? -1 : (a.nameTC > b.nameTC ? 1 : 0);
  };
  return { noEmail: noEmail.sort(byName), withEmail: withEmail.sort(byName) };
}

/**
 * 這一季排了工、但沒有電郵的人。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {Object[]} 每筆 {personId, nameTC, cellCount}
 */
function listPeopleNeedingPaper_(quarterId, versionNo) {
  return splitAssignedPeopleByEmail_(quarterId, versionNo).noEmail;
}

/**
 * 供前端呼叫：第 5 步的名單。**純讀取。**
 *
 * 回傳兩份：預設要印的（沒有電郵）、可以額外加入的（有電郵但可能也要紙本，
 * 例如同時想要紙本的長者）。
 * @param {string} quarterId 季度 ID
 * @returns {Object} {versionNo, noEmail: [], withEmail: [], message}
 */
function apiGetPaperListState(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) {
      return { versionNo: -1, noEmail: [], withEmail: [], message: '這一季還沒有生成過任何版本。' };
    }
    const split = splitAssignedPeopleByEmail_(quarterId, versionNo);
    return {
      versionNo: versionNo,
      noEmail: split.noEmail,
      withEmail: split.withEmail,
      message: ''
    };
  } finally {
    endSheetReadMemo_();
  }
}
