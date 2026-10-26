/**
 * 第三十九輪批次 C 組：**一粒「寄出」掣，一個彈窗。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這一組要解決什麼
 * ═════════════════════════════════════════════════════════════════════
 *
 * 現在幹事面前有三粒掣：「寄給堂委審閱」「正式發出給全體」「改動後重發」。
 * 他要自己判斷現在應該撳哪一粒——而那個判斷其實完全是機械的：
 * 由這一季走到哪一步決定，沒有任何空間讓他選擇。
 *
 * 所以改成**一粒「寄出」**，由系統判斷這一次屬於哪一個階段，
 * 並且**用一句人話講出來**，例如：
 *
 *   「這一次是**寄給堂委審閱**（這一季還未正式發出過）」
 *   「這一次是**正式發出給全體**」
 *   「這一次是**改動後重發**（只寄給有改動的人）」
 *
 * 幹事看得見自己在做什麼，但不用自己判斷。
 *
 * ⚠️ 底層的 Stage 機器**完全不變**——版本紀錄、SendLog、稽核、重發比對
 * 全部靠它。這裡只是把「揀哪一粒掣」這個決定由幹事手上拿回來。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 這個檔案**一格都不會寫**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 真正寄信仍然是 `apiStep2Confirm()`／`apiStep4Confirm()`／
 * `apiStep5SendConfirm()` 那三條**已經在真實環境跑過**的路。
 * 這裡只負責「撳落去之前，告訴他會發生什麼事」。
 *
 * 沒有另起爐灶去寄信，是刻意的：寄信那條路上每一道閘
 * （三層防重複、未儲存改動、公開連結、附件資料夾、DRY_RUN）
 * 都是前面幾十輪逐個補回來的。多開一條平行的路等於把它們全部丟掉。
 */

/** 「寄出」這一次屬於哪一個階段。 */
const SEND_KIND = {
  REVIEW: 'REVIEW',
  OFFICIAL: 'OFFICIAL',
  RESEND: 'RESEND',
  NONE: 'NONE'
};

/**
 * 由目前的 Stage 決定這一次「寄出」是哪一種。
 *
 * ⚠️ 在 `REQUESTS_APPLIED` 這一步，「寄給堂委審閱」同「正式發出給全體」
 * **兩粒都是著的**。這時候一律揀**行得最前**那一個（正式發出），
 * 因為那才是流程往前走的方向；而「再寄一次審閱本」仍然做得到，
 * 由前端另外給一條路，不會消失。
 *
 * @param {Object} buttons `computeDashboardButtons_()` 的結果
 * @returns {string} SEND_KIND 之一
 */
function resolveSendKind_(buttons) {
  const b = buttons || {};
  if (b.resend && b.resend.enabled) return SEND_KIND.RESEND;
  if (b.official && b.official.enabled) return SEND_KIND.OFFICIAL;
  if (b.review && b.review.enabled) return SEND_KIND.REVIEW;
  return SEND_KIND.NONE;
}

/**
 * 第七十七輪批次 EE 組：〔給所有人〕嘅寄出種類。正式發出之後，改動後重發嗰粒掣因為「沒有人的安排改過」
 * 而唔著 ⇒ 〔給所有人〕照樣行改動後重發嗰條路（每一位都會收到，見 `resolveResendTargetPersonIds_()`）。
 * 未儲存改動仍然擋（同三粒掣一樣）。
 * @param {Object} buttons `computeDashboardButtons_()` 的結果
 * @param {Object} state `buildDashboardState_()` 的結果
 * @returns {string} SEND_KIND 之一
 */
function resolveSendKindForAll_(buttons, state) {
  const kind = resolveSendKind_(buttons);
  if (kind !== SEND_KIND.NONE) return kind;
  const unsaved = state && state.unsaved && state.unsaved.hasAny;
  if (state && state.stage === QUARTER_STAGE.OFFICIAL_SENT && !unsaved) return SEND_KIND.RESEND;
  return SEND_KIND.NONE;
}

/**
 * 那一句「這一次是⋯⋯」。
 * @param {string} kind SEND_KIND 之一
 * @param {Object} facts 給人話用的數字
 * @returns {string} 一句
 */
function buildSendKindSentence_(kind, facts) {
  if (kind === SEND_KIND.REVIEW) {
    return '這一次是寄給堂委審閱（這一季還未正式發出過）。';
  }
  if (kind === SEND_KIND.OFFICIAL) {
    return '這一次是正式發出給全體。';
  }
  if (kind === SEND_KIND.RESEND) {
    return '這一次是改動後重發（只寄給安排有改動的 '
      + (facts && facts.changedPersonCount ? facts.changedPersonCount : 0) + ' 位）。';
  }
  return '現在沒有可以寄的東西。';
}

/**
 * 這一次會寄給誰。**講數字同身分，不是講機器代號。**
 * @param {string} kind SEND_KIND 之一
 * @param {Object} buttons 掣的狀態
 * @returns {string} 一句
 */
function buildSendRecipientSentence_(kind, buttons) {
  const b = buttons || {};
  if (kind === SEND_KIND.REVIEW) {
    const n = (b.review && b.review.recipientCount) || 0;
    return '寄給堂委名單上的 ' + n + ' 位。義工一封都不會收到。';
  }
  if (kind === SEND_KIND.OFFICIAL) {
    const n = (b.official && b.official.targetPersonCount) || 0;
    const noEmail = (b.official && b.official.noEmailCount) || 0;
    return '寄給這一季有服侍的 ' + n + ' 位，另外加堂委名單。'
      + (noEmail > 0 ? '其中 ' + noEmail + ' 位查不到電郵，寄不到——他們要印紙本（第 5 步）。' : '');
  }
  if (kind === SEND_KIND.RESEND) {
    const n = (b.resend && b.resend.changedPersonCount) || 0;
    return '只寄給安排真的改過的 ' + n + ' 位。沒有改動的人不會再收到信。';
  }
  return '';
}

/**
 * 這一次會寄**什麼**——由真正會用到的範本推出來，不是寫死。
 *
 * ⚠️ 這一段**不是給幹事揀的**，是告訴他系統會寄什麼。
 * 內容由 `EmailTemplates` 的 `AttachType` 同信件內文決定
 * （見 `resolveStageTemplates_()`／`deliverOne_()`）。
 * 畫一堆撳落去沒有作用的勾選格，比不畫更差。
 *
 * @param {string} kind SEND_KIND 之一
 * @returns {Object} {items: string[], hasPermanentLink: boolean, unknown: string}
 */
function describeSendContents_(kind) {
  const stage = kind === SEND_KIND.REVIEW ? MAIL_STAGES.REVIEW
    : (kind === SEND_KIND.OFFICIAL ? MAIL_STAGES.OFFICIAL
      : (kind === SEND_KIND.RESEND ? MAIL_STAGES.RESEND : ''));
  if (!stage) return { items: [], hasPermanentLink: false, unknown: '' };

  let templates;
  try {
    templates = resolveStageTemplates_(stage);
  } catch (err) {
    // ⚠️ 讀不到範本**不可以**當成「什麼都不寄」。誠實回報查不到，
    // 由前端顯示「查不到會寄什麼」，而不是給一個空清單令幹事以為只寄一行字。
    return { items: [], hasPermanentLink: false, unknown: err.message };
  }
  const list = [templates.person, templates.list].filter(Boolean);
  if (list.length === 0) {
    return {
      items: [], hasPermanentLink: false,
      unknown: 'EmailTemplates 找不到 Stage=' + stage + ' 的範本。'
    };
  }

  const items = [];
  const attachTypes = {};
  list.forEach(function (t) {
    attachTypes[String(t.attachType || ATTACH_TYPE.NONE).toUpperCase()] = true;
  });
  if (attachTypes[ATTACH_TYPE.PERSONAL_PDF]) items.push('每人自己那一份 PDF（個人版）');
  if (attachTypes[ATTACH_TYPE.FULL_PDF]) items.push('完整版職事表 PDF');

  // ⚠️ 第四十輪批次 B 組：**那條永久連結一律附上，不再靠範本。**
  //
  // 2026-08-21 實測核對過七個範本：一個都沒有用 `{PublicRosterUrl}`。
  // 即是「範本會放連結」這個假設由頭到尾不成立。現在由
  // `appendPermanentLinkFooter_()`（Mailer.gs）自己加落信末。
  //
  // 所以這裡一律講「會有」——不是看範本。範本自己有放的話不重複加，
  // 但對幹事來講兩種情況的結果一模一樣：信入面有那條連結。
  const templateHasLink = list.some(function (t) {
    return [t.subject, t.bodyHtml, t.bodyPlain].some(function (part) {
      return String(part || '').indexOf('{PublicRosterUrl}') !== -1;
    });
  });
  items.push('那條永久連結（永遠指向最新一次儲存確認的版本）——一律附上');
  const hasPermanentLink = true;

  // ICS 由 `buildIcsAttachmentForPerson_()` 決定：只有 OFFICIAL／RESEND
  // 而且該收件人這一季有派工才會附。這裡照實講，不誇大。
  if (stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND) {
    items.push('日曆檔（.ics，iPhone 同 Google 日曆都開得到）——只有這一季有服侍的人才會收到');
  }
  if (items.length === 0) items.push('只有信件內文，沒有附件');

  return {
    items: items,
    hasPermanentLink: hasPermanentLink,
    templateHasLink: templateHasLink,
    unknown: ''
  };
}

/**
 * SEND_KIND → MAIL_STAGES。
 *
 * ⚠️ 第四十六輪批次 A4 組：呢個**冇拆走，亦都唔可以拆**。
 * 版本紀錄、`SendLog`、稽核、重發比對全部靠 Stage。
 * 改咗嘅只係「Stage 唔再決定收件人」——判斷同記錄一個字都冇變。
 *
 * @param {string} kind SEND_KIND 之一
 * @returns {string} 階段；NONE 回空字串
 */
function sendKindToStage_(kind) {
  if (kind === SEND_KIND.REVIEW) return MAIL_STAGES.REVIEW;
  if (kind === SEND_KIND.OFFICIAL) return MAIL_STAGES.OFFICIAL;
  if (kind === SEND_KIND.RESEND) return MAIL_STAGES.RESEND;
  return '';
}

/* ── 舊嗰個「按階段出名單」已經拆走（第四十六輪批次 A 組）──────────
 *
 * ⚠️ ／／
 *  三個一齊刪咗。佢哋做嘅係「喺**階段本來嘅**
 * 收件範圍入面再篩」——而嗰個正正就係第四十一同四十三輪做錯咗嘅方向。
 *
 * Ivan 嘅原話：「這是用來寄給職事表上所有人、CC、DB、IT、admin 同自訂
 * email 的」——即係收件人同階段無關。
 *
 * 取而代之：（下面）＋
 * （）。
 *
 * 留住一個冇人用嘅舊 API 就係留住第二份元件，而 A2 明確要求「唔准寫兩份」。
 */


/**
 * 第四十六輪批次 A／B 組：**寄出彈窗嘅收件人池。**
 *
 * ⚠️ 呢個**取代**咗 `apiGetSendCandidates()`（按階段出名單嗰個）。
 * 個池同階段完全無關——收件人由幹事自己勾，唔係由階段決定。
 * 理由全文喺 `src/SendRecipients.gs` 檔頭。
 *
 * 回傳三樣嘢：
 *   `items`   　收件人池，逐個有 `sources`（佢屬於邊幾個來源）
 *   `groups`  　六個來源，逐個有實際人數（**唔係寫死**）
 *   `changed` 　「有改動」係相對邊一版、邊幾位、改咗乜
 *
 * @param {string} quarterId 季度 ID
 * @param {string=} kind SEND_KIND 之一（第七十輪批次 AT 組：決定「固定收件人」那一組
 *   是哪一個階段的名單、預設勾不勾）；不傳當正式發出
 * @returns {Object} 收件人池
 */
function apiGetSendRecipientPool(quarterId, kind) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const snap = buildSendPoolSnapshot_(quarterId, kind);
    if (!snap.ok) return snap;
    return {
      ok: true,
      versionNo: snap.versionNo,
      items: snap.pool,
      groups: snap.groups,
      // 第七十七輪批次 EE 組：〔選擇其他〕開窗時預設勾「只寄給安排有改動的人」嗰一組
      //（同上一次寄出嘅版本比較）；從來未寄過 ⇒ 一位都唔勾。**唔再預設勾固定收件人**
      //（嗰個情況改用〔給所有人〕）。
      defaultPickedKeys: defaultPickedKeysForChanged_(snap.pool, snap.lastSent),
      changed: snap.changed
    };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 第七十七輪批次 EE 組：收件人池＋分組＋「有改動」比較——三粒掣共用（**唔另寫一套**）。
 * @param {string} quarterId 季度 ID
 * @param {string=} kind SEND_KIND 之一
 * @returns {Object} `{ok, versionNo, pool, groups, fixedMembers, lastSent, changed}`；`ok=false` 帶 `message`
 */
function buildSendPoolSnapshot_(quarterId, kind) {
  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '這一季還沒有生成過任何版本，所以沒有收件人可以選。',
        '一封都沒有寄出。',
        ['先在第 1 步生成職事表'])
    };
  }

  let context;
  try {
    context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);
  } catch (err) {
    // ⚠️ 砌不到 context **不可以**回一個空池——空池在畫面上等於
    // 「這一季一個人都沒有」，而那是假的。
    throw new Error(buildThreePartMessage_(
      '讀不到這一季的收件名單（' + err.message + '）。',
      '一封都沒有寄出。',
      ['撳一次「重新整理」再試',
        '如果一直讀不到，去「進階與診斷 ▸ 核對職事表」看看這一版有沒有問題']));
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const pool = buildSendRecipientPool_(context, timezone);

  // ── 第七十輪批次 AT 組：辦公室等固定收件人 ─────────────────
  const poolStage = sendKindToStage_(kind) || MAIL_STAGES.OFFICIAL;
  const fixedMembers = tagFixedRecipients_(pool, poolStage, context);

  // ── 「有改動」相對邊一版 ────────────────────────────────
  const lastSent = findLastSentSnapshot_(quarterId);
  const changedByPerson = lastSent
    ? listChangedPersonsBetweenVersions_(quarterId, lastSent.versionNo, versionNo)
    : {};
  pool.forEach(function (item) {
    const notes = changedByPerson[item.personId];
    if (notes && notes.length > 0) {
      item.changeNotes = notes;
      item.sources = item.sources.concat([SEND_SOURCE.CHANGED]);
    }
  });
  // ⚠️ 第六十三輪批次 P 組：有改動、但唔喺池入面嘅人（呢一版 0 格、
  // 又唔係身分持有人）⇒ 加返入池。唔加嘅話「有 3 位改過」而
  // 「只寄給安排有改動的人」得 2 位，被整個換走嗰個揀都揀唔到。
  addChangedPersonsMissingFromPool_(pool, changedByPerson, context.peopleById);

  // ── 六個來源逐個數人（**唔可以寫死**）────────────────────
  const groups = SEND_SOURCE_LABELS.map(function (g) {
    const members = pool.filter(function (item) {
      return item.sources.indexOf(g.key) !== -1;
    });
    return {
      key: g.key,
      label: g.label,
      total: members.length,
      // 冇電郵嘅勾咗都收唔到，所以「勾呢一組會加幾多位」要數勾得到嗰批。
      selectable: members.filter(function (m) { return m.selectable; }).length,
      // 第七十輪批次 AT 組：固定收件人那一組列出每一位（電郵照現有方式遮蔽）
      members: g.key === SEND_SOURCE.FIXED
        ? members.map(function (m) {
          return { displayName: m.displayName, emailMasked: maskEmailForPreview_(m.email) };
        })
        : []
    };
  });

  return {
    ok: true,
    versionNo: versionNo,
    pool: pool,
    groups: groups,
    fixedMembers: fixedMembers,
    lastSent: lastSent,
    changed: {
      // ⚠️ **一定要講明相對邊一版。** 只講「有 4 位改過」，
      // 幹事無從判斷係相對佢啱啱儲存嗰版定係上一次寄嗰版。
      hasBaseline: !!lastSent,
      baselineVersionNo: lastSent ? lastSent.versionNo : null,
      baselineStage: lastSent ? lastSent.stage : '',
      baselineStageLabel: lastSent ? (SEND_STAGE_LABELS_TC[lastSent.stage] || lastSent.stage) : '',
      baselineSentAt: lastSent ? lastSent.sentAt : '',
      changedCount: Object.keys(changedByPerson).length,
      sentence: lastSent
        ? ('同 第 ' + lastSent.versionNo + ' 版（' + lastSent.sentAt + ' '
          + (SEND_STAGE_LABELS_TC[lastSent.stage] || lastSent.stage) + '）比較，有 '
          + Object.keys(changedByPerson).length + ' 位的安排改過。')
        : '這一季從來沒有寄出過，所以沒有東西可以比較——'
          + '「只寄給安排有改動的人」現在選不到。'
    }
  };
}

/**
 * 第七十七輪批次 EE 組：〔給所有人〕嘅收件人——**由後端算**（重用同一個池同分組）。
 *
 * 收件人＝呢一版職事表上全部人 ＋ 堂委 ＋ 執事；`Config.SEND_ALL_INCLUDES_FIXED=TRUE`（預設）
 * 再加辦公室等固定收件人（`EmailRecipients` 該階段嘅名單）。冇電郵嘅勾唔到——另外列出嚟畀第 4 步印紙本。
 * @param {string} quarterId 季度 ID
 * @param {string=} kind SEND_KIND 之一（決定固定收件人係邊個階段嘅名單）
 * @returns {Object} `{ok, versionNo, pickedKeys, items, groups, noEmailCount, noEmailNames, includesFixed}`
 */
function apiGetSendAllRecipients(quarterId, kind) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const snap = buildSendPoolSnapshot_(quarterId, kind);
    if (!snap.ok) return snap;
    const includesFixed = getConfig(CONFIG_KEYS.SEND_ALL_INCLUDES_FIXED, true) === true;
    const wanted = [SEND_SOURCE.ROSTER, SEND_SOURCE.COMMITTEE, SEND_SOURCE.DEACON]
      .concat(includesFixed ? [SEND_SOURCE.FIXED] : []);
    const inScope = snap.pool.filter(function (item) {
      return wanted.some(function (src) { return item.sources.indexOf(src) !== -1; });
    });
    const noEmail = inScope.filter(function (item) { return item.type === RECIPIENT_TYPE.PERSON && !item.hasEmail; });
    return {
      ok: true,
      versionNo: snap.versionNo,
      pickedKeys: inScope.filter(function (item) { return item.selectable !== false; }).map(function (item) { return item.key; }),
      items: snap.pool,
      groups: snap.groups,
      includesFixed: includesFixed,
      noEmailCount: noEmail.length,
      noEmailNames: noEmail.map(function (item) { return item.displayName; })
    };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 第七十七輪批次 EE 組：〔變動的人〕嘅收件人——同每個人**上一次收到嘅版本**比較、安排有改動嘅人
 *（包括被整個換走嘅人）。用改動後重發確認窗**同一支**判斷（`planResendChangedPersons_()` →
 * `computeResendDiff_()`），寄出窗同確認窗人數先會一致。
 *
 *   ・上一次冇收到嘅人（冇舊 hash）唔列入，只講一句「另外 K 位上一次沒有收到」
 *   ・冇電郵嘅列出嚟（寄唔到，要用第 4 步印紙本）
 *   ・呢一季未正式發出過 ⇒ `ok=false, notOfficialYet=true`
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiGetSendChangedRecipients(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const sendLog = readSendLogSummaryForDashboard_(quarterId);
    if (!sendLog.officialSentOnce) {
      return {
        ok: false, notOfficialYet: true,
        message: '這一季還未正式發出給全體，請用〔給所有人〕或〔選擇其他〕。'
      };
    }
    const plan = planResendChangedPersons_(quarterId);
    const notes = readResendChangeNotes_(quarterId, plan.versionNo);
    const people = (plan.changed || []).filter(function (c) { return c.arrangementChanged; }).map(function (c) {
      return {
        personId: c.personId,
        nameTC: c.nameTC,
        hasEmail: !!c.hasEmail,
        hasAssignments: c.hasAssignments !== false,
        previousSummary: c.previousSummary || '',
        currentSummary: c.currentSummary || '',
        changeNotes: (notes[c.personId] || []).slice()
      };
    });
    const notReceived = (plan.changed || []).filter(function (c) { return !c.arrangementChanged; });
    const lastSent = findLastSentSnapshot_(quarterId);
    return {
      ok: true,
      versionNo: plan.versionNo,
      noChanges: people.length === 0,
      people: people,
      pickedKeys: people.filter(function (p) { return p.hasEmail; }).map(function (p) { return p.personId; }),
      noEmailNames: people.filter(function (p) { return !p.hasEmail; }).map(function (p) { return p.nameTC; }),
      notReceivedCount: notReceived.length,
      baseline: lastSent ? {
        versionNo: lastSent.versionNo, sentAt: lastSent.sentAt,
        stageLabel: SEND_STAGE_LABELS_TC[lastSent.stage] || lastSent.stage
      } : null
    };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 第七十輪批次 AU 組：〔改為再寄一次審閱本〕要寄給**上一次審閱本實際寄出嘅同一批人**。
 *
 * 回傳 `sendOptions`（`PICK`＋`pickedKeys`＋`extraEmails`），前端原封不動交返
 * `apiStep2Preview`／`apiStep2Confirm`——預覽同真正寄出行同一條解析路。
 *
 * - 上一批嘅 PERSON 用 PersonID、LIST 用 `EmailRecipients` 嘅電郵；
 *   上次幹事自己輸入嘅地址（唔喺 `EmailRecipients`）放入 `extraEmails`。
 * - 上一批入面而家已經唔喺收件人池嘅人（例如身分已卸任、今季冇服侍）**寄唔到**，
 *   點數放入 `droppedCount`，畫面講明，唔可以靜靜少寄。
 * - 讀唔到上一批（從來冇寄過、或舊紀錄全部冇收件人）⇒ `found: false`，
 *   前端用預設審閱名單並照實講。
 *
 * ⚠️ 純讀取，一格都唔寫。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} {ok, found, sentAt, versionNo, count, droppedCount, sendOptions}
 */
function apiGetLastReviewSendOptions(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const batch = findLastReviewBatch_(readSheet(SHEETS.SEND_LOG), quarterId, timezone);
    if (!batch.found) return { ok: true, found: false };

    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) return { ok: true, found: false };
    const context = buildMailContext_(quarterId, versionNo, MAIL_STAGES.REVIEW);
    const pool = buildSendRecipientPool_(context, timezone);
    const inPool = {};
    pool.forEach(function (item) { inPool[item.key] = true; });

    const pickedKeys = [];
    const extraEmails = [];
    let droppedCount = 0;
    batch.personIds.forEach(function (personId) {
      if (inPool[personId]) pickedKeys.push(personId); else droppedCount++;
    });
    batch.listEmails.forEach(function (email) {
      if (inPool['LIST:' + email]) pickedKeys.push('LIST:' + email);
      else extraEmails.push(email);
    });
    return {
      ok: true,
      found: true,
      sentAt: batch.sentAt,
      versionNo: batch.versionNo,
      count: batch.count,
      droppedCount: droppedCount,
      sendOptions: { recipientScope: SEND_RECIPIENT_SCOPE.PICK, pickedKeys: pickedKeys, extraEmails: extraEmails }
    };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 第四十六輪批次 B3 組：**這一季寄過幾次、寄咗邊一版、幾多位。**
 *
 * ⚠️ 最後一行係重點：**現時嗰版從來未寄過就要明講。**
 * 幹事最容易犯嘅錯就係「以為寄咗」——佢改完、儲存咗、然後去做第二件事，
 * 而嗰一版由頭到尾冇寄過。一個「已經寄過 3 次」嘅紀錄唔會提醒到佢，
 * 一句「第 9 及第 10 版未寄過給任何人」會。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} {batches, currentVersionNo, unsentVersions, warnSentence}
 */
/**
 * 第七十七輪批次 EH 組：版本號清單 ⇒ 人話片段（連續三個或以上寫「A 至 B」；兩個寫「A、B」）。**純函式。**
 * @param {number[]} list 版本號
 * @returns {string[]} 例如 [1,2,3,4,5] ⇒ ['1 至 5']；[2,4,5,6] ⇒ ['2', '4 至 6']
 */
function formatVersionNoRanges_(list) {
  const nums = (list || []).map(Number).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
  const parts = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    if (j > i + 1) parts.push(nums[i] + ' 至 ' + nums[j]);
    else if (j === i + 1) parts.push(nums[i] + '、' + nums[j]);
    else parts.push(String(nums[i]));
    i = j + 1;
  }
  return parts;
}

function buildSendHistoryView_(quarterId) {
  const batches = listSendHistory_(quarterId);
  const currentVersionNo = findLatestVersionNo(quarterId);

  const sentVersions = {};
  batches.forEach(function (b) {
    if (b.versionNo !== null && b.sent > 0) sentVersions[b.versionNo] = true;
  });

  // 邊幾版由頭到尾冇寄過。只數**已經存在嘅版本**，唔會數到將來。
  const unsent = [];
  for (let v = 0; v <= currentVersionNo; v++) {
    if (!sentVersions[v]) unsent.push(v);
  }

  let warnSentence = '';
  if (currentVersionNo < 0) {
    warnSentence = '';
  } else if (!sentVersions[currentVersionNo]) {
    const tail = unsent.filter(function (v) { return v > 0; });
    // 第七十七輪批次 EH 組：連續嘅版本號合併——「第 1 至 5 版都未寄過」「第 2、4 至 6 版未寄過」
    const ranges = formatVersionNoRanges_(tail);
    warnSentence = tail.length > 1
      ? ('⚠️ 目前是第 ' + currentVersionNo + ' 版，第 ' + ranges.join('、') + ' 版'
        + (ranges.length === 1 ? '都' : '') + '未寄過給任何人。')
      : ('⚠️ 目前是第 ' + currentVersionNo + ' 版，這一版未寄過給任何人。');
  }

  return {
    batches: batches.map(function (b) {
      return {
        stage: b.stage,
        stageLabel: SEND_STAGE_LABELS_TC[b.stage] || b.stage,
        versionNo: b.versionNo,
        sentAt: b.sentAt,
        total: b.total,
        sent: b.sent,
        noEmail: b.noEmail,
        failed: b.failed
      };
    }),
    currentVersionNo: currentVersionNo,
    unsentVersions: unsent,
    warnSentence: warnSentence
  };
}

/* ═════════════════════════════════════════════════════════════════════
 * 第四十八輪批次 A2 組：〔寄出但不儲存〕嗰個確認畫面要嘅料
 * ═════════════════════════════════════════════════════════════════════
 *
 * 撳咗〔寄出但不儲存〕**唔會直接寄**。中間要有一個把後果講到白嘅畫面：
 *
 *     會寄出的：第 5 版（2026-08-22 儲存）
 *     不會寄出的：你在表上改了、還未儲存的這 2 格
 *       2028-04-02　主席　假甲乙 → 假丙丁
 *       2028-04-02　報告　假戊己 → 假庚辛
 *
 * ⚠️ 嗰幾格要**逐格列出嚟**，而且要同「檢查我的改動」嗰個畫面
 * 用**同一支**函式產生（`buildSavedChangeRows_()`）。
 * 三個地方講同一件事而各自格式化，一定會分岔——而分岔咗之後，
 * 兩個畫面對住同一格會顯示唔同嘅嘢，冇人分得出邊個啱。
 */

/** 確認畫面最多列幾多格；多過呢個數就摺埋，另外畀一粒〔全部列出〕。 */
const UNSAVED_SEND_PREVIEW_LIMIT = 12;

/**
 * 砌〔寄出但不儲存〕確認畫面要嘅料。**純讀取。**
 *
 * @param {string} quarterId 季度 ID
 * @param {Object} state `buildDashboardState_()` 的結果
 * @returns {Object} `{versionNo, savedAt, total, shown, moreCount, all}`
 */
function buildUnsavedSendPreview_(quarterId, state) {
  const empty = {
    versionNo: -1, savedAt: '', total: 0, shown: [], moreCount: 0, all: []
  };
  if (!state || !state.canSendUnsaved) return empty;

  const versionNo = (state.latestVersion || {}).versionNo;
  if (!(versionNo >= 0)) return empty;

  let rows = [];
  try {
    const context = buildFineTuneContext_(quarterId, versionNo);
    const resolved = resolveAuthoritativeState_(
      context, STATE_SOURCE.GRID_OVERLAY, 'buildUnsavedSendPreview_');
    // `context.postNames` 唔存在，要由 `context.posts` 譯——
    // 同 `buildSaveAndConfirmPlan_()` 一樣嘅做法。
    const postNameById = {};
    (context.posts || []).forEach(function (p) { postNameById[p.postId] = p.postNameTC; });
    // ⚠️ **同一支**函式，同「檢查我的改動」嗰個畫面一樣。
    rows = buildSavedChangeRows_(resolved.changes, postNameById, 'MANUAL');
  } catch (err) {
    // 讀唔到 ⇒ 唔可以扮成「零格」。零格會令個畫面寫住
    //「不會寄出的：0 格」，而幹事會以為佢改嗰幾格其實已經入咗。
    log_('WARN', 'buildUnsavedSendPreview_ 讀不到 grid 狀態：' + err.message);
    return Object.assign({}, empty, { versionNo: versionNo, error: err.message });
  }

  const cap = UNSAVED_SEND_PREVIEW_LIMIT;
  return {
    versionNo: versionNo,
    savedAt: (state.latestVersion || {}).createdAt || '',
    total: rows.length,
    shown: rows.slice(0, cap),
    moreCount: Math.max(0, rows.length - cap),
    // 整份都帶埋，令〔全部列出〕唔使再打一次伺服器——
    // 再打一次嘅話，兩次之間狀態有機會唔同，
    // 而幹事會見到一份同上面個數字對唔上嘅清單。
    all: rows
  };
}

/**
 * 第七十輪批次 AX 組：進度係「已寄給堂委，等他們的意見」（REVIEW_SENT）時，
 * 「寄出」窗最上面嘅提示。
 *
 * 現場：寄咗審閱本之後，第 3 步〔寄出〕開出嘅仍然係「寄給堂委審閱」。要先喺第 2 步
 * 撳〔儲存及寄出〕（冇改動都得）把進度推到「意見已收齊」，〔寄出〕先會變成正式發出。
 * 幹事唔知，截圖時連測試工具都走錯過一次。
 *
 * ⚠️ 只改顯示，**唔改流程**。文字由後端出（前端唔另寫一套）。
 */
const SEND_REVIEW_SENT_HINT = '堂委的意見收齊、要正式發出給全體？'
  + '請先在第 2 步撳〔儲存〕（沒有改動也可以撳），'
  + '之後再撳〔寄出〕，這裡就會變成「正式發出給全體」。';

/**
 * 這個進度要不要顯示上面那個提示。純函式。
 * @param {string} stage 季度進度（QUARTER_STAGE）
 * @returns {string} 提示文字；其他進度回空字串
 */
function buildReviewSentHint_(stage) {
  return stage === QUARTER_STAGE.REVIEW_SENT ? SEND_REVIEW_SENT_HINT : '';
}

/**
 * 供前端呼叫：「寄出」彈窗要的一切。**純讀取，一格都不會寫。**
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} 彈窗要的資料
 */
function apiGetSendPlanSummary(quarterId) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const state = buildDashboardState_(quarterId);
    const buttons = state.buttons || {};
    const kind = resolveSendKind_(buttons);
    const contents = describeSendContents_(kind);
    const publicLink = readPublicLinkState_(quarterId);
    // 第七十七輪批次 EE 組：〔給所有人〕喺正式發出之後，就算冇人改過都寄得（行改動後重發嗰條路）
    const allKind = resolveSendKindForAll_(buttons, state);

    // 為什麼寄不到（`kind === NONE` 時）。逐粒掣講它自己的原因——
    // 合成一句「現在不能寄」等於什麼都沒有講。
    const blockedReasons = [];
    if (kind === SEND_KIND.NONE) {
      ['review', 'official', 'resend'].forEach(function (k) {
        const b = buttons[k];
        if (b && !b.enabled && b.disabledReason) {
          blockedReasons.push({ key: k, reason: b.disabledReason });
        }
      });
    }

    // 在 REQUESTS_APPLIED 那一步，「再寄一次審閱本」仍然做得到。
    const alsoReview = kind === SEND_KIND.OFFICIAL
      && !!(buttons.review && buttons.review.enabled);

    // 第四十輪批次 A 組：三個選項嘅**預設值**。
    //
    // ⚠️ 前端一定要用呢一份做預設，唔可以自己寫死一套——
    // 寫死兩套就係兩個真相來源，而「幹事乜都唔揀嘅時候行為同今日一樣」
    // 呢個保證會靜靜失效。
    const stageForOptions = sendKindToStage_(kind);
    const defaultDecision = stageForOptions
      ? resolveSendOptions_(stageForOptions, null, resolveStageTemplates_(stageForOptions))
      : null;

    return {
      kind: kind,
      // 第七十七輪批次 EE 組：〔給所有人〕用嘅種類；〔變動的人〕要正式發出過先可以撳
      allKind: allKind,
      officialSentOnce: !!state.officialSentOnce,
      // 第七十輪批次 AX 組：已寄給堂委、等意見時，「寄出」窗最上面嘅提示（其他進度係空字串）
      reviewSentHint: buildReviewSentHint_(state.stage),
      // ⚠️ 第四十七輪批次 A1 組：三粒掣唔著嘅**唯一**原因就係未儲存。
      //
      // 前端要靠佢排喺 `kind === NONE` 之前——否則第四十輪寫嘅
      //「未儲存」嗰段永遠行唔到（有未儲存改動 ⇒ `kind` 必定係 `NONE`）。
      blockedByUnsavedOnly: !!state.blockedByUnsavedOnly,
      // 第四十八輪批次 A1／A3 組：〔寄出但不儲存〕嗰粒掣畫唔畫、
      // 唔畫嗰陣點解釋。
      // ⚠️ 由後端出，同 `assertNoUnsavedChanges_()` 讀**同一支**
      // `canSendWithUnsavedChanges_()`——前端自己再判斷一次嘅話，
      // 就會出現「畫咗粒掣、撳落去拋錯」。
      canSendUnsaved: !!state.canSendUnsaved,
      canSendUnsavedReason: String(state.canSendUnsavedReason || ''),
      // A2 嗰個確認畫面要嘅嘢：寄邊一版、幾時儲存嘅、邊幾格唔會寄出。
      unsavedSendPreview: buildUnsavedSendPreview_(quarterId, state),
      // 第四十一輪批次 E 組：每個附件選項下面嗰行小字。
      // ⚠️ 由後端出，同 attachTypeWantsPersonalLink_() 讀同一個判斷——
      // 前端自己寫一套嘅話，畫面會講一件事而系統做另一件事。
      attachOptionNotes: {
        NONE: describeAttachOption_(ATTACH_TYPE.NONE),
        PERSONAL_PDF: describeAttachOption_(ATTACH_TYPE.PERSONAL_PDF),
        FULL_PDF: describeAttachOption_(ATTACH_TYPE.FULL_PDF)
      },
      sendOptionDefaults: defaultDecision ? {
        recipientScope: defaultDecision.recipientScope,
        attachType: defaultDecision.attachType,
        includeIcs: defaultDecision.includeIcs
      } : null,
      // ⚠️ 第四十六輪批次 A3 組：`kindSentence` **唔再喺彈窗頂顯示**。
      //
      // 嗰句係「這一次是寄給堂委審閱（這一季還未正式發出過）」——
      // 一句由**階段**推斷出嚟嘅描述。而由呢一輪開始收件人係由幹事勾嘅，
      // 所以嗰句同佢實際做緊嘅事對唔上。Ivan 明確講咗嗰句係錯嘅。
      //
      // 欄位保留係因為 `AuditLog` 同開發者診斷仲用得着，
      // 但畫面改為顯示一句由**實際勾咗乜**算出嚟嘅收件摘要。
      kindSentence: buildSendKindSentence_(kind, {
        changedPersonCount: (buttons.resend && buttons.resend.changedPersonCount) || 0
      }),
      recipientSentence: buildSendRecipientSentence_(kind, buttons),
      // 第四十六輪批次 B3 組：這一季寄過幾次、哪一版未寄過。
      sendHistory: buildSendHistoryView_(quarterId),
      contents: contents,
      alsoReview: alsoReview,
      blockedReasons: blockedReasons,
      // 「系統只會寄已經儲存確認的版本」——這一句在彈窗頂部要再講一次。
      unsaved: state.unsaved || { hasAny: false },
      latestVersion: state.latestVersion || null,
      isDryRun: !!state.isDryRun,
      permanentLink: {
        url: publicLink.fileUrl || '',
        hasLink: !!publicLink.hasLink,
        checkFailed: !!publicLink.checkFailed
      }
    };
  } finally {
    endSheetReadMemo_();
  }
}
