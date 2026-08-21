/**
 * 第四十輪批次 A 組：**寄出彈窗那三個決定。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這一個檔案為什麼存在
 * ═════════════════════════════════════════════════════════════════════
 *
 * 幹事每次寄出都要揀三樣東西：
 *
 *   一、寄給誰　　全部應收的人／只寄有改動的／自己揀
 *   二、附件　　　不附／個人版 PDF／整季 PDF
 *   三、日曆檔　　附／不附 `.ics`
 *
 * 這三樣本來全部由 `EmailTemplates.AttachType` 那一欄同階段寫死。
 * 幹事真實需要每次揀（例如範本改好之後要重寄全體、或者只想補寄一兩位）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 這一個檔案是**解析層**，不是執行層
 * ─────────────────────────────────────────────────────────────────────
 *
 * 上一輪（第三十三、三十八輪）在寄信路徑上連續修過兩個同一類的 bug：
 * `deliverOne_()` 用自己一套更粗的邏輯重新判斷「要不要寄」，
 * 蓋過上游已經算好的決定。
 *
 * 所以這裡定的規矩是：
 *
 *   **`resolveSendOptions_()` 一次過把三個決定解析成結論，
 *   放進 `context.sendDecision`。`deliverOne_()` 只可以照做，
 *   不可以再判斷一次。**
 *
 * 落到 `deliverOne_()` 那一層，`attachType` 已經是一個確定的值、
 * `includeIcs` 已經是一個確定的布林值——沒有任何東西要它再想。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 幹事什麼都不揀的時候，行為必須同今日**一模一樣**
 * ─────────────────────────────────────────────────────────────────────
 *
 * `sendOptions` 缺席、或者其中一個欄位缺席，一律退回今日的行為：
 *   收件範圍　　REVIEW／OFFICIAL ⇒ ALL；RESEND ⇒ CHANGED_ONLY
 *   附件　　　　該階段範本的 `AttachType`
 *   日曆檔　　　`buildIcsAttachmentForPerson_()` 本來的自動判斷
 *               （只有 OFFICIAL／RESEND 才有）
 *
 * `tests/send_options.test.js` 有一整節釘住這一條：不傳 `sendOptions`
 * 跑一次，逐項斷言結果同傳入「今日的預設值」完全相同。
 */

/** 寄給誰。 */
const SEND_RECIPIENT_SCOPE = {
  /** 全部應收的人（該階段本來的名單）。 */
  ALL: 'ALL',
  /** 只寄安排有改動的（RESEND 今日的行為）。 */
  CHANGED_ONLY: 'CHANGED_ONLY',
  /** 幹事自己逐個揀。 */
  PICK: 'PICK'
};

/**
 * 各階段的預設收件範圍。
 *
 * ⚠️ 這一份就是「幹事什麼都不揀」的答案，**改它等於改今日的行為**。
 */
const SEND_SCOPE_DEFAULT_BY_STAGE = {
  REVIEW: SEND_RECIPIENT_SCOPE.ALL,
  OFFICIAL: SEND_RECIPIENT_SCOPE.ALL,
  RESEND: SEND_RECIPIENT_SCOPE.CHANGED_ONLY,
  GENERATE: SEND_RECIPIENT_SCOPE.ALL,
  REMIND: SEND_RECIPIENT_SCOPE.ALL
};

/**
 * 今日 `.ics` 的自動判斷：只有 OFFICIAL／RESEND 才附。
 *
 * ⚠️ 這一句要同 `buildIcsAttachmentForPerson_()` 開頭那道閘一致。
 * 兩邊講不同的話，彈窗上寫住「會附日曆檔」而實際上沒有附，
 * 而幹事沒有任何方法看得出。`tests/send_options.test.js` 釘住這一點。
 *
 * @param {string} stage 寄送階段
 * @returns {boolean} 今日會不會附
 */
function icsDefaultForStage_(stage) {
  return stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND;
}

/**
 * 把幹事揀的三樣東西解析成**結論**。
 *
 * @param {string} stage 寄送階段
 * @param {?Object} sendOptions 彈窗傳落來的（可以是 null／undefined）
 * @param {Object} templates `resolveStageTemplates_()` 的結果
 * @returns {Object} `context.sendDecision`
 */
function resolveSendOptions_(stage, sendOptions, templates) {
  const o = sendOptions || {};

  // ── 一、收件範圍 ─────────────────────────────────────────────
  const defaultScope = SEND_SCOPE_DEFAULT_BY_STAGE[stage] || SEND_RECIPIENT_SCOPE.ALL;
  let scope = String(o.recipientScope || '').toUpperCase();
  if (!SEND_RECIPIENT_SCOPE[scope]) scope = defaultScope;

  // ⚠️ 揀咗「自己揀」但一個都冇揀 ⇒ **拋錯，唔可以靜靜當成寄全部**。
  // 靜靜寄全部係最壞嘅結果：佢以為淨係寄俾三個人，實際上成班人收到。
  const picked = {};
  let pickedCount = 0;
  (o.pickedKeys || []).forEach(function (k) {
    const key = String(k || '').trim();
    if (!key) return;
    if (!picked[key]) { picked[key] = true; pickedCount++; }
  });
  if (scope === SEND_RECIPIENT_SCOPE.PICK && pickedCount === 0) {
    throw new Error(buildThreePartMessage_(
      '你選了「自己選擇」，但一位都沒有選。',
      '一封都沒有寄出。',
      ['回去那個名單勾選要寄給誰，再撳一次',
        '如果你想寄給全部人，請改選「全部應收的人」']));
  }

  // ── 一之二、幹事自行輸入嘅電郵（第四十三輪批次 F 組）──────────
  //
  // ⚠️ 呢啲地址**唔會存入 `NameMapping`**，淨係影響今次。
  // 存入去就變成一個冇 PersonID、冇資格、冇服侍紀錄嘅「半個人」——
  // 而嗰種半個人喺呢個系統入面出過好多次事。
  //
  // ⚠️ 格式唔啱**要拋錯，唔可以靜靜略過**。靜靜略過嘅話，
  // 佢以為嗰個人收到咗，而實際上冇——而佢永遠唔會發現。
  const extraEmails = [];
  const badEmails = [];
  (o.extraEmails || []).forEach(function (raw) {
    const e = String(raw || '').trim();
    if (!e) return;
    if (!isPlausibleEmail_(e)) { badEmails.push(e); return; }
    if (extraEmails.indexOf(e) === -1) extraEmails.push(e);
  });
  if (badEmails.length > 0) {
    throw new Error(buildThreePartMessage_(
      '你自己輸入那 ' + badEmails.length + ' 個地址看起來不是電郵：' + badEmails.join('、'),
      '一封都沒有寄出。',
      ['回去那一格改正或者刪走，再撳一次']));
  }

  // ── 二、附件 ─────────────────────────────────────────────────
  //
  // 預設 ＝ 該階段範本嗰一欄。**唔會改寫 `EmailTemplates` 工作表**——
  // 彈窗只係容許今次覆寫，唔係改設定。
  const templateAttach = String(
    (templates && templates.person && templates.person.attachType) || ATTACH_TYPE.NONE
  ).toUpperCase();
  let attachType = String(o.attachType || '').toUpperCase();
  if (!ATTACH_TYPE[attachType]) attachType = (ATTACH_TYPE[templateAttach] ? templateAttach : ATTACH_TYPE.NONE);

  // LIST 收件人嗰個範本另有自己嘅 AttachType。幹事**冇主動改**嗰陣要照用佢，
  // 一改就兩邊都跟佢揀嗰個（PERSONAL_PDF 對 LIST 收件人本來就會回 null，
  // 見 `generateMailAttachment_()`，所以安全）。
  const listTemplateAttach = String(
    (templates && templates.list && templates.list.attachType) || ''
  ).toUpperCase();
  const attachOverridden = !!(o.attachType && ATTACH_TYPE[String(o.attachType).toUpperCase()]);
  const listAttachType = attachOverridden
    ? attachType
    : (ATTACH_TYPE[listTemplateAttach] ? listTemplateAttach : attachType);

  // ── 三、日曆檔 ───────────────────────────────────────────────
  const icsDefault = icsDefaultForStage_(stage);
  const includeIcs = (o.includeIcs === true || o.includeIcs === false)
    ? o.includeIcs : icsDefault;

  return {
    stage: stage,
    recipientScope: scope,
    pickedKeys: picked,
    pickedCount: pickedCount,
    extraEmails: extraEmails,
    attachType: attachType,
    listAttachType: listAttachType,
    includeIcs: includeIcs,
    // 有冇任何一項係幹事主動改嘅。畫面同 AuditLog 都要分得出
    //「佢冇揀（＝今日行為）」同「佢揀咗一個啱啱好一樣嘅值」。
    overridden: {
      scope: !!(o.recipientScope && SEND_RECIPIENT_SCOPE[String(o.recipientScope).toUpperCase()]),
      attachType: attachOverridden,
      includeIcs: (o.includeIcs === true || o.includeIcs === false)
    },
    defaults: {
      scope: defaultScope,
      attachType: ATTACH_TYPE[templateAttach] ? templateAttach : ATTACH_TYPE.NONE,
      includeIcs: icsDefault
    }
  };
}

/**
 * 一個收件人喺「自己揀」名單入面嘅鍵。
 *
 * ⚠️ 唔可以淨係用 `personId`：REVIEW 階段**只有 LIST 收件人**（堂委名單），
 * 佢哋冇 PersonID。淨係用 PersonID 嘅話，喺 REVIEW 揀「自己揀」
 * 會一個人都揀唔到，而個彈窗睇落完全正常。
 *
 * @param {Object} recipient 收件人
 * @returns {string} 鍵
 */
function sendRecipientKey_(recipient) {
  if (recipient.personId) return recipient.personId;
  return 'LIST:' + String(recipient.email || '').trim().toLowerCase();
}

/**
 * 按收件範圍篩收件人。
 *
 * ⚠️ 呢個係**執行上游決定**，唔係喺呢度再判斷一次。
 * `CHANGED_ONLY` 喺 `sendStage()` 呢條路上冇意義（REVIEW／OFFICIAL 本來就係
 * 寄全部），所以當成 ALL——而唔係靜靜寄零封。
 *
 * @param {Object[]} recipients `listRecipients_()` 嘅結果
 * @param {Object} decision `resolveSendOptions_()` 嘅結果
 * @returns {Object[]} 篩完
 */
function filterRecipientsByScope_(recipients, decision) {
  const base = (!decision || decision.recipientScope !== SEND_RECIPIENT_SCOPE.PICK)
    ? recipients
    : recipients.filter(function (r) {
      return decision.pickedKeys[sendRecipientKey_(r)] === true;
    });
  return appendExtraEmailRecipients_(base, decision);
}

/**
 * 第四十三輪批次 F 組：把幹事自行輸入那幾個地址接落收件人清單。
 *
 * ⚠️ 它們是 `RECIPIENT_TYPE.LIST`——**不是 PERSON**。
 * 那是刻意的：`PERSON` 那一種下游會去查「他這一季有哪幾格」、
 * 會做個人版 PDF、會附個人專屬連結。一個只有電郵、沒有 `PersonID`
 * 的地址查不出任何東西，當成 `PERSON` 只會令下游逐個地方拿到空值，
 * 而每一個空值都要另外處理一次。
 *
 * 當成 `LIST`（同堂委名單那一種一樣）就完全不用改下游任何一段：
 * 那一種本來就是「一個沒有個人資料的收件地址」。
 *
 * ⚠️ 同一個地址已經在名單裡面就不再加一次——否則他會收到兩封。
 *
 * @param {Object[]} recipients 已經篩好的收件人
 * @param {Object} decision `resolveSendOptions_()` 的結果
 * @returns {Object[]} 加上額外地址之後的清單
 */
function appendExtraEmailRecipients_(recipients, decision) {
  const extra = (decision && decision.extraEmails) || [];
  if (extra.length === 0) return recipients;

  const seen = {};
  recipients.forEach(function (r) {
    const e = String(r.email || '').trim().toLowerCase();
    if (e) seen[e] = true;
  });

  const out = recipients.slice();
  extra.forEach(function (email) {
    const key = String(email).trim().toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      type: RECIPIENT_TYPE.LIST,
      email: email,
      displayName: email,
      personId: '',
      sendAs: SEND_AS.TO,
      // 標記出處。SendLog 同寄出報告都要分得出「名單上的」同
      // 「幹事今次自己輸入的」——分不出就查不到「那一封為什麼寄了給他」。
      isExtraEmail: true
    });
  });
  return out;
}

/**
 * 把今次用咗咩選項寫成一句，畀 AuditLog 同 SendLog 用。
 *
 * ⚠️ 一定要記低。唔記低嘅話，日後查「點解嗰次冇附件」係查唔到嘅——
 * `EmailTemplates` 嗰一欄係當時嘅值，而幹事可能今次覆寫過。
 *
 * @param {Object} decision `resolveSendOptions_()` 嘅結果
 * @returns {string} 一句
 */
function describeSendDecision_(decision) {
  if (!decision) return '';
  const scopeText = {
    ALL: '全部應收的人',
    CHANGED_ONLY: '只寄安排有改動的',
    PICK: '自己選擇（' + decision.pickedCount + ' 位）'
  }[decision.recipientScope] || decision.recipientScope;
  const attachText = {
    NONE: '不附',
    PERSONAL_PDF: '個人版 PDF',
    FULL_PDF: '整季 PDF'
  }[decision.attachType] || decision.attachType;
  const mark = function (on) { return on ? '（幹事改過）' : ''; };
  return '收件範圍=' + scopeText + mark(decision.overridden.scope)
    + '　附件=' + attachText + mark(decision.overridden.attachType)
    + '　日曆檔=' + (decision.includeIcs ? '有' : '沒有') + mark(decision.overridden.includeIcs);
}
