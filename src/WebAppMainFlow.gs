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
 * 決定第 1 步那粒掣要生成哪一季。**純讀取。**
 *
 * 規則（順序就是優先次序）：
 *   1. 幹事現在看著的那一季，如果還沒有任何版本 ⇒ 就是它
 *      （他打開了它、看著它，最想做的一定是生成它）
 *   2. 否則，所有還沒有版本的季度之中，開始日期最早那一個
 *   3. 全部都生成過 ⇒ 仍然回傳「下一季」（開始日期在今天之後最早那個），
 *      但 `alreadyGenerated` 為 true，前端會把掣變灰並講明原因
 *      （重新生成是覆蓋式動作，留在「進階與診斷」，不放在主流程）
 *
 * @param {string} selectedQuarterId 幹事現在看著的季度
 * @returns {Object} 目標季度同警告
 */
function resolveGenerateTargetQuarter_(selectedQuarterId) {
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
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

  let target = null;
  if (selected && selected.versionNo < 0) {
    target = selected;
  } else if (ungenerated.length > 0) {
    target = ungenerated[0];
  } else {
    // 全部生成過。回傳開始日期喺今天之後最早嗰一季（冇就回最後一季）。
    const future = quarters.filter(function (q) { return q.startDate > today; });
    target = future.length > 0 ? future[0] : quarters[quarters.length - 1];
  }

  // ⚠️ 「已經開始」同「已經過去」是兩件事，訊息不一樣。
  // 合成一句「日期不對」會令幹事不知道到底發生什麼事。
  // 距離生成日期還有幾多天。算不出（沒填 GenerateOn）就是 null——
  // ⚠️ **不可以當成 0**：0 的意思是「今日就是生成日」，那是一個肯定句，
  // 而我們根本不知道。
  const daysUntil = target.generateOn ? daysBetween_(today, target.generateOn) : null;

  let warn = '';
  let warnMessage = '';
  if (target.endDate && target.endDate < today) {
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
      // 第 6 步要的人數，喺呢度一次過算好，唔使前端再叫多一次。
      paperCount: countPeopleWithoutEmail_(quarterId)
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 這一季有幾多位排了工、但 `NameMapping` 沒有電郵的人。**純讀取。**
 *
 * ⚠️ 「查不到電郵」不等於「這個人不用服侍」——他照樣要收到職事表，
 * 只是要印紙本。所以這個數字要在主流程第 6 步直接看得見，
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
 * ⚠️ 這是第 6 步唯一的名單來源。
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
 * 供前端呼叫：第 6 步的名單。**純讀取。**
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
