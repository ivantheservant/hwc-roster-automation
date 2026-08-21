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
      + (noEmail > 0 ? '其中 ' + noEmail + ' 位查不到電郵，寄不到——他們要印紙本（第 6 步）。' : '');
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
 * 第四十輪批次 A 組：「自己揀」那個名單。**純讀取。**
 *
 * ⚠️ 列的是**這一個階段真正會收到信的人**，不是整張 NameMapping。
 * 列一個不會收到信的人，他勾了之後照樣收不到，而畫面上看不出。
 *
 * ⚠️ 鍵一定要經 `sendRecipientKey_()`：REVIEW 階段只有 LIST 收件人
 *（堂委名單），他們沒有 PersonID。淨用 PersonID 會令 REVIEW 一個都揀不到。
 *
 * @param {string} quarterId 季度 ID
 * @param {string} kind SEND_KIND 之一
 * @returns {Object[]} 每筆 {key, displayName, type, cellCount, hasEmail}
 */
function listSendCandidates_(quarterId, kind) {
  const stage = sendKindToStage_(kind);
  if (!stage) return [];

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) return [];

  let context;
  try {
    context = buildMailContext_(quarterId, versionNo, stage);
  } catch (err) {
    // ⚠️ 砌不到 context **不可以**回一個空陣列——空陣列在畫面上等於
    // 「這一季沒有人要收信」，而那是假的。照實拋，由前端顯示原因。
    throw new Error(buildThreePartMessage_(
      '讀不到這一次的收件名單（' + err.message + '）。',
      '一封都沒有寄出。',
      ['撳一次「重新整理」再試',
        '如果一直讀不到，去「進階與診斷 ▸ 核對職事表」看看這一版有沒有問題']));
  }

  return listRecipients_(stage, context).map(function (r) {
    const assigned = r.personId
      ? (context.assignmentsByPerson[r.personId] || []).length : 0;
    return {
      key: sendRecipientKey_(r),
      displayName: r.displayName || r.email || r.personId,
      type: r.type,
      cellCount: assigned,
      // 查不到電郵的人照樣列出來，並且講明——他不是「不用服侍」，
      // 是要印紙本（第 6 步）。
      hasEmail: !!String(r.email || '').trim()
    };
  });
}

/**
 * SEND_KIND → MAIL_STAGES。
 * @param {string} kind SEND_KIND 之一
 * @returns {string} 階段；NONE 回空字串
 */
function sendKindToStage_(kind) {
  if (kind === SEND_KIND.REVIEW) return MAIL_STAGES.REVIEW;
  if (kind === SEND_KIND.OFFICIAL) return MAIL_STAGES.OFFICIAL;
  if (kind === SEND_KIND.RESEND) return MAIL_STAGES.RESEND;
  return '';
}

/**
 * 供前端呼叫：「自己揀」那個名單。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @param {string} kind SEND_KIND 之一
 * @returns {Object[]} 名單
 */
function apiGetSendCandidates(quarterId, kind) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    return listSendCandidates_(quarterId, kind);
  } finally {
    endSheetReadMemo_();
  }
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
      sendOptionDefaults: defaultDecision ? {
        recipientScope: defaultDecision.recipientScope,
        attachType: defaultDecision.attachType,
        includeIcs: defaultDecision.includeIcs
      } : null,
      kindSentence: buildSendKindSentence_(kind, {
        changedPersonCount: (buttons.resend && buttons.resend.changedPersonCount) || 0
      }),
      recipientSentence: buildSendRecipientSentence_(kind, buttons),
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
