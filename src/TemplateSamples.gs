/**
 * 第九十三輪批次 TB 組：〔寄出電郵範本樣本〕——一次過收到系統每一種信的樣本，核對文字。
 *
 * 位置：幹事介面「進階與診斷 ▸ 寄出電郵範本樣本」（〔開始〕）及試算表選單「維護 ▸ 寄出電郵範本樣本」。權限＝可以修改。
 *
 * ── 每一封信 ─────────────────────────────────────────────────────
 *   ・`EmailTemplates` 工作表每一行（沒有的範本用程式內的預設種子，並註明）：用這一季最新版本的真實資料
 *     （第一位有崗位的人）套入；這一季沒有版本 ⇒ 示範資料，內文最上面寫明。
 *   ・寫死在程式內的幹事通知：沒有電郵名單、生成完成、階段提醒（四種原因）、事奉人員申報待確認。
 *     用示範資料叫**同一批函式**（`captureAdminNotifications_()` 收集而不寄出），樣本文字不會和正式通知分家。
 *   ・季前資料用 `TPL_PRESEASON_TC` 那一封樣本（內容＝`buildPreseasonPack_()` 的完整內容）。
 *   ・不附 PDF（內文最上面寫「正式信會附：……」）；有日曆檔的信附上該人的 .ics 樣本。
 *   ・每一封內文最上面一個灰框：這是範本樣本，不是正式通知；範本名稱；修改位置。
 *
 * ── 收件人及 DRY_RUN（和〔寄給自己〕紙本包同一類例外）────────────────
 *   收件電郵必須是 `MAIL_ADMIN_NOTIFY`、`WEBAPP_ALLOWED_EMAILS`、`MAIL_REDIRECT_ALL_TO` 之中的一個，否則拒絕。
 *   樣本**不經轉寄**，`DRY_RUN` 為 TRUE 時也寄——理由：收件人已經限制在幹事自己的地址，
 *   沒有任何一位事奉人員可能收到；而這個工具的用途正是在測試期間看文字。
 *   經 `sendMailThroughGate_()`（TA 組：全專案唯一的寄信呼叫點）並寫明 `bypassRedirectReason`。
 *
 * ── 紀錄 ─────────────────────────────────────────────────────────
 *   只寫 AuditLog `TEMPLATE_SAMPLES_SENT`（收件人、季度、封數）。**不寫 SendLog、不改任何階段。**
 */

const TEMPLATE_SAMPLES_AUDIT_ACTION = 'TEMPLATE_SAMPLES_SENT';
const TEMPLATE_SAMPLE_BYPASS_REASON = '範本樣本：收件人限制在 MAIL_ADMIN_NOTIFY／WEBAPP_ALLOWED_EMAILS／MAIL_REDIRECT_ALL_TO 之內';

/**
 * 把一格 Config（字串或陣列）拆成電郵清單。
 * @param {*} raw
 * @returns {string[]}
 */
function splitSampleEmailList_(raw) {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw === null || raw === undefined ? '' : raw);
  return text.split(/[,;、\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
}

/**
 * 可以收樣本的電郵：三個 Config 的聯集（去重，大小寫不分）。
 * @returns {string[]}
 */
function readTemplateSampleAllowedEmails_() {
  const keys = [CONFIG_KEYS.MAIL_ADMIN_NOTIFY, CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, CONFIG_KEYS.MAIL_REDIRECT_ALL_TO];
  const seen = {};
  const out = [];
  keys.forEach(function (key) {
    splitSampleEmailList_(getConfig_(key, '')).forEach(function (e) {
      const k = e.toLowerCase();
      if (!seen[k]) { seen[k] = true; out.push(e); }
    });
  });
  return out;
}

/**
 * 收件電郵不在允許名單 ⇒ 拒絕（三段式訊息）。**回傳名單裏面那個寫法的地址。**
 * @param {string} email
 * @returns {string}
 */
function assertTemplateSampleRecipientAllowed_(email) {
  const wanted = String(email || '').trim();
  const allowed = readTemplateSampleAllowedEmails_();
  const hit = allowed.filter(function (e) { return e.toLowerCase() === wanted.toLowerCase(); })[0];
  if (!wanted || !hit) {
    throw new Error(buildThreePartMessage_(
      '「' + (wanted || '（沒有填）') + '」不是可以收範本樣本的地址。',
      '一封都沒有寄出。',
      ['收件電郵只可以是 Config 的 MAIL_ADMIN_NOTIFY、WEBAPP_ALLOWED_EMAILS 或 MAIL_REDIRECT_ALL_TO 之中的一個',
        '在畫面的清單裏面選一個']));
  }
  return hit;
}

/** 灰框：「這是範本樣本，不是正式通知。範本：…；修改位置：…」 */
function buildTemplateSampleBox_(templateName, whereText, extraLines) {
  const text = '這是範本樣本，不是正式通知。範本：' + templateName + '；修改位置：' + whereText;
  const extra = (extraLines || []).filter(Boolean);
  const html = '<div style="background:#eeeeee;border:1px solid #999999;color:#333333;padding:10px;margin-bottom:14px;">'
    + escapePreseasonHtml_(text)
    + extra.map(function (l) { return '<br>' + escapePreseasonHtml_(l); }).join('') + '</div>';
  const plain = text + extra.map(function (l) { return '\n' + l; }).join('')
    + '\n\n────────────────────\n\n';
  return { text: text, html: html, plain: plain };
}

/** 「正式信會附：……」 */
function describeSampleAttachments_(attachType, hasIcs) {
  const parts = [];
  const t = String(attachType || ATTACH_TYPE.NONE).toUpperCase();
  if (t === ATTACH_TYPE.PERSONAL_PDF) parts.push('個人版 PDF');
  if (t === ATTACH_TYPE.FULL_PDF) parts.push('整季完整版 PDF');
  if (hasIcs) parts.push('日曆檔（.ics）');
  return '正式信會附：' + (parts.length ? parts.join('、') : '沒有附件') + '（這封樣本不附 PDF）';
}

/** 樣本主旨：[範本樣本 n/N] 名稱｜原主旨 */
function buildTemplateSampleSubject_(index, total, name, subject) {
  return '[範本樣本 ' + index + '/' + total + '] ' + name + '｜' + subject;
}

/** 幹事通知的示範資料（只用來叫真正的通知函式，不寫任何地方）。 */
function buildTemplateSampleAdminNotifications_(quarterId, prefix, adminEmail) {
  const demoContext = { subjectPrefix: prefix, quarterId: quarterId, adminEmail: adminEmail };
  const reminder = function (judgment) {
    return function () { notifyAdminStageReminder_(quarterId, judgment, { MAIL_SUBJECT_PREFIX: prefix, MAIL_ADMIN_NOTIFY: adminEmail }, true); };
  };
  const base = { stage: QUARTER_STAGE.DRAFT, reasons: [], reminderCount: 0, maxCount: 3, daysStuck: 0, stuckDays: 3,
    daysUntilDeadline: 0, deadlineDays: 7, generateDueDate: '', daysSinceGenerateDue: 0, daysUntilGenerate: 0,
    unconfirmedLeadDays: 14, unconfirmedSpecials: [] };
  const withReasons = function (reasons, extra) { return Object.assign({}, base, { reasons: reasons }, extra || {}); };
  const defs = [
    { name: '幹事通知：沒有電郵名單', where: '程式（Mailer.gs notifyAdminNoEmail_）',
      run: function () { notifyAdminNoEmail_(['示範甲（P0001）', '示範乙（P0002）'], demoContext, true); } },
    { name: '幹事通知：生成完成', where: '程式（Mailer.gs notifyAdminGenerateDone_）',
      run: function () { notifyAdminGenerateDone_(quarterId, { sheetName: buildRosterSheetName_(quarterId, 0) },
        { MAIL_SUBJECT_PREFIX: prefix, MAIL_ADMIN_NOTIFY: adminEmail }, true); } },
    { name: '幹事通知：階段提醒（還沒有生成初稿）', where: '程式（Mailer.gs notifyAdminStageReminder_）',
      run: reminder(withReasons(['NOT_GENERATED'], { generateDueDate: '2028-05-27', daysSinceGenerateDue: 3 })) },
    { name: '幹事通知：階段提醒（停在同一階段太久）', where: '程式（Mailer.gs notifyAdminStageReminder_）',
      run: reminder(withReasons(['STUCK'], { stage: QUARTER_STAGE.REVIEW_SENT || QUARTER_STAGE.DRAFT, daysStuck: 5, reminderCount: 1 })) },
    { name: '幹事通知：階段提醒（接近正式發出日期）', where: '程式（Mailer.gs notifyAdminStageReminder_）',
      run: reminder(withReasons(['DEADLINE'], { daysUntilDeadline: 4, reminderCount: 0 })) },
    { name: '幹事通知：階段提醒（特殊主日日期未確認）', where: '程式（Mailer.gs notifyAdminStageReminder_）',
      run: reminder(withReasons(['UNCONFIRMED_SPECIAL'], { daysUntilGenerate: 9,
        unconfirmedSpecials: [{ serviceDate: '2028-08-13', title: '示範特殊主日' }] })) },
    { name: '幹事通知：事奉人員申報待確認', where: '程式（PersonalUnavailable.gs buildUnavailableSubmissionNotifyText_）',
      run: function () {
        const text = buildUnavailableSubmissionNotifyText_(prefix,
          [{ personName: '示範甲', serviceDate: '2028-08-06', postsText: '全部崗位', reason: '出外地', late: false },
            { personName: '示範乙', serviceDate: '2028-08-13', postsText: '讀經、司事', reason: '', late: true }], 3,
          buildUnavailableConfirmUrl_(quarterId));
        notifyAdmin_(text.subject, text.body, adminEmail, true);
      } },
    // 第九十八輪批次 YB 組：已有版本之後開季前資料有改動
    { name: '幹事通知：開季前資料有改動', where: '程式（PreseasonChange.gs buildPreseasonChangeNotifyText_）',
      run: function () {
        const text = buildPreseasonChangeNotifyText_(prefix, quarterId, 1,
          [{ id: 'WEIGHT', label: '排表偏好', count: 2 }, { id: 'PRE', label: '預先安排', count: 1 }],
          buildPreseasonChangeAdminUrl_(quarterId));
        notifyAdmin_(text.subject, text.body, adminEmail, true);
      } }
  ];
  return defs.map(function (d) {
    const got = captureAdminNotifications_(d.run);
    if (got.length !== 1) throw new Error('範本樣本：「' + d.name + '」沒有產生一封通知（' + got.length + '）');
    return { name: d.name, source: d.where.replace(/^程式（|）$/g, ''), where: d.where.indexOf('程式') === 0 ? '程式（請告訴 Claude）' : d.where,
      templateName: d.where.replace(/^程式（|）$/g, ''), kind: 'ADMIN', subject: got[0].subject, bodyPlain: got[0].body, bodyHtml: null, ics: null };
  });
}

/**
 * 組出全部樣本（只讀，不寄）。
 * @param {string} quarterId 季度 ID
 * @param {string} toEmail 收件電郵（放在示範收件人上；不影響內容）
 * @returns {{samples: Object[], hasVersion: boolean, versionNo: number}}
 */
function buildTemplateSamples_(quarterId, toEmail) {
  const quarter = findQuarter_(quarterId);
  if (!quarter) throw new Error('找不到季度 ' + quarterId + '。');
  const config = readConfig_();
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const versionNo = findLatestVersionNo_(quarterId);
  const hasVersion = versionNo >= 0;
  const demoNote = hasVersion ? '' : '這一季還沒有版本，下面是示範資料。';

  const context = buildMailContext_(quarterId, hasVersion ? versionNo : 0, MAIL_STAGES.OFFICIAL);
  let personId = '';
  let assignments = [];
  if (hasVersion) {
    const first = context.assignments.filter(function (a) { return a.personId && context.peopleById[a.personId]; })
      .sort(function (a, b) {
        const ka = a.serviceDate + '|' + a.postId + '|' + a.slotIndex;
        const kb = b.serviceDate + '|' + b.postId + '|' + b.slotIndex;
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      })[0];
    if (first) { personId = first.personId; assignments = context.assignmentsByPerson[personId] || []; }
  }
  let personName;
  if (personId) {
    personName = context.peopleById[personId].nameTC || personId;
  } else {
    personId = 'DEMO';
    personName = '示範人員';
    const start = toDateString_(quarter[COLUMNS.QUARTERS.START_DATE], timezone) || '2028-07-02';
    assignments = [
      { serviceDate: start, postId: 'DEMO', slotIndex: 1, personId: 'DEMO' },
      { serviceDate: shiftDateString_(start, 14), postId: 'DEMO', slotIndex: 1, personId: 'DEMO' }
    ];
    context.postNames = Object.assign({}, context.postNames, { DEMO: '示範崗位' });
  }
  const summary = buildAssignmentSummary_(assignments, context.postNames, timezone);
  const token = (context.personalTokenById || {})[personId] || '';
  const baseUrl = context.volunteerBaseUrl || '';

  const samples = [];
  const templateRows = readSheet_(SHEETS.EMAIL_TEMPLATES);
  const T = COLUMNS.EMAIL_TEMPLATES;
  const seen = {};
  const templates = [];
  templateRows.forEach(function (row, i) {
    const id = String(row[T.TEMPLATE_ID] || '').trim();
    if (!id) return;
    seen[id] = true;
    templates.push({ id: id, template: normalizeEmailTemplateRow_(row), where: 'EmailTemplates 第 ' + (i + 3) + ' 行',
      inactive: !isTrueValue_(row[T.ACTIVE]) });
  });
  EMAIL_TEMPLATE_SEEDS.forEach(function (seed) {
    if (seen[seed.templateId]) return;
    templates.push({ id: seed.templateId, template: normalizeEmailTemplateRow_(seedToTemplateRow_(seed)),
      where: '程式（請告訴 Claude）；EmailTemplates 工作表沒有這一行，用程式預設', inactive: false, fromSeed: true });
  });

  templates.forEach(function (t) {
    const stage = String(t.template.stage || '').toUpperCase();
    const isList = /_LIST_/.test(t.id) || stage === MAIL_STAGES.REVIEW || stage === MAIL_STAGES.REMIND;
    const ctx = Object.assign({}, context, { stage: stage === MAIL_STAGES.RESEND ? MAIL_STAGES.RESEND : MAIL_STAGES.OFFICIAL });
    const recipient = isList
      ? { type: RECIPIENT_TYPE.LIST, personId: '', email: toEmail, displayName: '堂委／教會辦公室名單（樣本）', sendAs: SEND_AS.TO }
      : { type: RECIPIENT_TYPE.PERSON, personId: personId, email: toEmail, displayName: personName, sendAs: SEND_AS.TO };
    let placeholders = ctx.placeholders;
    let personalUrl = '';
    let ics = null;
    let sampleSummary = isList ? '' : summary;
    let pack = null;
    if (t.id === PRESEASON_TEMPLATE_ID) {
      const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
      const generateDate = readPreseasonGenerateDate_(quarter, config);
      pack = buildPreseasonPack_(quarterId, today, generateDate);
      placeholders = { QuarterLabel: pack.quarterLabel, QuarterID: quarterId, GenerateDate: generateDate || '生成日',
        PreseasonContentHtml: pack.html, PreseasonContentPlain: pack.plain };
      sampleSummary = '';
    } else if (t.id === UNAVAILABLE_INVITE_TEMPLATE_ID) {
      const dates = readUnavailableInviteDates_(quarterId);
      placeholders = { QuarterLabel: buildQuarterLabel_(quarterId), QuarterID: quarterId,
        GenerateDate: dates.generateDate || '生成日', Deadline: dates.deadline || '生成日之前',
        PersonalLink: buildPersonalRosterUrl_(baseUrl || 'https://example.invalid/exec', token || 'SAMPLE', quarterId) };
      sampleSummary = '';
    } else if (t.id === UNAVAILABLE_DECIDED_TEMPLATE_ID) {
      // 第九十四輪批次 UC 組：通知申請人處理結果——示範一項確認、一項不確認（同一個人合併成一封）
      const firstDate = (assignments[0] && assignments[0].serviceDate) || '2028-07-02';
      placeholders = buildUnavailableDecisionPlaceholders_([
        { serviceDate: firstDate, postsText: UNAVAILABLE_ALL_POSTS_TC, accepted: true },
        { serviceDate: shiftDateString_(firstDate, 7), postsText: '讀經', accepted: false }
      ], buildQuarterLabel_(quarterId));
      sampleSummary = '';
    } else if (!isList && attachTypeWantsPersonalLink_(t.template.attachType)) {
      personalUrl = buildPersonalRosterUrl_(baseUrl, token, quarterId);
    }
    if ((stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND) && !isList) {
      try {
        // 和正式信一樣：RESEND 加取消事件（用真實的 SendLog；示範資料沒有）
        const cancelled = hasVersion ? computeCancelledCellsForPerson_(ctx, personId, assignments) : [];
        ics = buildIcsAttachmentForPerson_(ctx, recipient, assignments, cancelled);
      } catch (err) {
        log_('WARN', '範本樣本：日曆檔產生失敗：' + err.message);
      }
    }
    const permanentLink = (placeholders || {}).PublicRosterUrl || '';
    const hasCancelled = !!(ics && ics.cancelledCount > 0);
    // 第一百零一輪批次 ZB 組：和正式寄信同一支判斷（第一階段不是堂委／執事／幹事 ⇒ 只供查看）
    const canDeclare = !personalUrl || isMailDeclareAllowed_(ctx, personId);
    let html = appendPermanentLinkFooter_(appendPersonalLinkFooter_(
      applyPlaceholders_(t.template.bodyHtml, placeholders, recipient, sampleSummary), personalUrl, true, canDeclare),
      t.template.bodyHtml, permanentLink, true, quarterId);
    let plain = appendPermanentLinkFooter_(appendPersonalLinkFooter_(
      applyPlaceholders_(t.template.bodyPlain, placeholders, recipient, sampleSummary), personalUrl, false, canDeclare),
      t.template.bodyPlain, permanentLink, false, quarterId);
    if (ics) {
      html = appendIcsNotice_(html, hasCancelled, true);
      plain = appendIcsNotice_(plain, hasCancelled, false);
    }
    const box = buildTemplateSampleBox_(t.id, t.where, [
      demoNote,
      t.inactive ? '這個範本在工作表上 Active 不是 TRUE，正式寄信不會用它。' : '',
      describeSampleAttachments_(t.template.attachType, !!ics)
    ]);
    samples.push({
      name: t.id, source: t.where, where: t.where, templateName: t.id, kind: 'TEMPLATE',
      subject: prefix + applyPlaceholders_(t.template.subject, placeholders, recipient, sampleSummary),
      bodyHtml: box.html + html, bodyPlain: box.plain + plain, ics: ics
    });
  });

  buildTemplateSampleAdminNotifications_(quarterId, prefix, toEmail).forEach(function (n) {
    const box = buildTemplateSampleBox_(n.templateName, n.where, [demoNote ? '這一封一律是示範資料。' : '這一封是示範資料。',
      '正式通知只寄給 MAIL_ADMIN_NOTIFY。']);
    samples.push({ name: n.name, source: n.source, where: n.where, templateName: n.templateName, kind: 'ADMIN',
      subject: n.subject, bodyHtml: null, bodyPlain: box.plain + n.bodyPlain, ics: null });
  });
  return { samples: samples, hasVersion: hasVersion, versionNo: hasVersion ? versionNo : -1 };
}

/** 種子（EMAIL_TEMPLATE_SEEDS 的一項）轉成 EmailTemplates 一列的形狀。 */
function seedToTemplateRow_(seed) {
  const T = COLUMNS.EMAIL_TEMPLATES;
  const row = {};
  row[T.TEMPLATE_ID] = seed.templateId;
  row[T.STAGE] = seed.stage;
  row[T.LANG] = seed.lang;
  row[T.SUBJECT] = seed.subject;
  row[T.BODY_HTML] = seed.bodyHtml;
  row[T.BODY_PLAIN] = seed.bodyPlain;
  row[T.ATTACH_TYPE] = seed.attachType;
  row[T.ACTIVE] = true;
  return row;
}

/**
 * 寄出全部樣本。**會寄信**（不理 DRY_RUN、不經轉寄，只寄給允許名單內的那一個地址）＋寫 AuditLog。
 * @param {string} quarterId 季度 ID
 * @param {string} toEmail 收件電郵
 * @returns {{sent: number, names: string[], hasVersion: boolean, quarterId: string, message: string}}
 */
function sendTemplateSamples_(quarterId, toEmail) {
  assertNotPreviewMode_('sendTemplateSamples_');
  const to = assertTemplateSampleRecipientAllowed_(toEmail);
  const built = buildTemplateSamples_(quarterId, to);
  const total = built.samples.length;
  const config = readConfig_();
  const options0 = { name: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || '') };
  const replyTo = String(config[CONFIG_KEYS.MAIL_REPLY_TO] || '');
  const names = [];
  built.samples.forEach(function (s, i) {
    const options = {};
    if (options0.name) options.name = options0.name;
    if (replyTo) options.replyTo = replyTo;
    if (s.ics && s.ics.blob) options.attachments = [s.ics.blob];
    sendMailThroughGate_({
      to: to,
      displayName: '範本樣本',
      subject: buildTemplateSampleSubject_(i + 1, total, s.name, s.subject),
      bodyHtml: s.bodyHtml,
      bodyPlain: s.bodyPlain,
      options: options,
      bypassRedirectReason: TEMPLATE_SAMPLE_BYPASS_REASON
    });
    names.push(s.name);
  });
  writeAuditLog_({
    action: TEMPLATE_SAMPLES_AUDIT_ACTION,
    targetSheet: SHEETS.EMAIL_TEMPLATES,
    targetKey: quarterId,
    oldValue: '',
    newValue: '寄出 ' + total + ' 封',
    source: 'sendTemplateSamples_',
    notes: '收件人：' + to + '；季度：' + quarterId + '；' + (built.hasVersion ? '用第 ' + built.versionNo + ' 版的真實資料' : '沒有版本，用示範資料')
  });
  return { sent: total, names: names, hasVersion: built.hasVersion, quarterId: quarterId,
    message: '已經寄出 ' + total + ' 封範本樣本到你選的地址。' + (built.hasVersion ? '' : '（這一季還沒有版本，內容是示範資料。）') };
}

/**
 * 供前端呼叫：可以收樣本的地址清單及預設季度。**只讀。**
 * @returns {{recipients: string[], defaultQuarterId: string}}
 */
function apiGetTemplateSampleOptions() {
  assertWebAppRequestAllowed_('apiGetTemplateSampleOptions');
  return { recipients: readTemplateSampleAllowedEmails_(), defaultQuarterId: '2028T3' };
}

/**
 * 供前端呼叫：〔寄出電郵範本樣本〕。**會寄信**（只寄給允許名單內的地址）。
 * @param {string} quarterId 季度 ID
 * @param {string} toEmail 收件電郵
 * @returns {Object} sendTemplateSamples_() 的結果
 */
function apiSendTemplateSamples(quarterId, toEmail) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('寄出電郵範本樣本', function () {
    return sendTemplateSamples_(String(quarterId || '').trim(), String(toEmail || '').trim());
  });
}

/**
 * 選單項目「寄出電郵範本樣本」的執行入口。
 * @returns {void}
 */
function runSendTemplateSamples_() {
  const ui = SpreadsheetApp.getUi();
  const title = '寄出電郵範本樣本';
  const allowed = readTemplateSampleAllowedEmails_();
  if (allowed.length === 0) {
    ui.alert(title, 'Config 的 MAIL_ADMIN_NOTIFY、WEBAPP_ALLOWED_EMAILS、MAIL_REDIRECT_ALL_TO 都沒有填，沒有可以收樣本的地址。', ui.ButtonSet.OK);
    return;
  }
  const q = ui.prompt(title, '季度（例如 2028T3）：', ui.ButtonSet.OK_CANCEL);
  if (q.getSelectedButton() !== ui.Button.OK) return;
  const quarterId = q.getResponseText().trim() || '2028T3';
  const e = ui.prompt(title, '收件電郵（必須是 MAIL_ADMIN_NOTIFY、WEBAPP_ALLOWED_EMAILS 或 MAIL_REDIRECT_ALL_TO 之一）：', ui.ButtonSet.OK_CANCEL);
  if (e.getSelectedButton() !== ui.Button.OK) return;
  try {
    const r = withMutationLock_(title, function () { return sendTemplateSamples_(quarterId, e.getResponseText().trim()); });
    ui.alert(title, r.message, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert(title, '沒有寄出：\n\n' + err.message, ui.ButtonSet.OK);
  }
}

/**
 * 第一百零一輪批次 ZB 組：〔預覽電郵範本〕——和〔寄出電郵範本樣本〕同一份內容，但**不寄**，只在畫面顯示。**只讀。**
 * 每一封同時檢查：有沒有主試算表 ID、有沒有「義工」、有沒有「試算表連結」（部署後核對用）。
 * @param {string} quarterId 季度 ID
 * @returns {{samples: Object[], hasVersion: boolean, versionNo: number}}
 */
function apiPreviewTemplateSamples(quarterId) {
  assertWebAppRequestAllowed_('apiPreviewTemplateSamples');
  const q = String(quarterId || '').trim() || '2028T3';
  const built = buildTemplateSamples_(q, 'preview@example.invalid');
  const ids = readBlockedSpreadsheetIds_();
  const total = built.samples.length;
  return {
    hasVersion: built.hasVersion, versionNo: built.versionNo,
    samples: built.samples.map(function (s, i) {
      const text = [s.subject, s.bodyPlain, s.bodyHtml || ''].join('\n');
      return {
        title: buildTemplateSampleSubject_(i + 1, total, s.name, s.subject),
        name: s.name, subject: s.subject, bodyPlain: s.bodyPlain,
        hasSpreadsheetId: findSpreadsheetIdLeak_({ subject: s.subject, bodyPlain: s.bodyPlain, bodyHtml: s.bodyHtml }, ids) !== '',
        hasOldWord: text.indexOf(['義', '工'].join('')) !== -1,   // 舊用字（分開兩個字寫，免得用字掃描當作介面文字）
        hasSheetLink: text.indexOf('試算表連結') !== -1
      };
    })
  };
}
