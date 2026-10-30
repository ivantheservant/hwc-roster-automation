/**
 * 第八十五輪批次 LF 組：季前資料（自動寄出＋開季前準備〔寄出季前資料〕即時寄出）。
 *
 * Ivan：「季初之前某個時間，自動寄事奉人員表、排表偏好及（下一季仍生效的）不能服侍日期給堂委／執事／幹事。」
 * 時間：生成日前 14 日（Config PRESEASON_DAYS_BEFORE）。
 *
 * ── 內容（目標季度＝將要生成的那一季）──────────────────────────
 *   ① 事奉人員表（每個自動排的崗位一行；「堂委」「執事」寫明現任是誰；人數）
 *   ② 暫時不做某崗位（這一季生效的）
 *   ③ 排表偏好（這一季生效、不是「一般」的）
 *   ④ 不能服侍的日期（落在這一季、有效的）
 *   ⑤ 合堂主日（如有）
 *   ⑥ 人手檢查結果
 *   結尾「如需更改，請在 <生成日> 之前通知幹事」
 *
 * ── 收件人 ───────────────────────────────────────────────────────
 * 寄出當日的現任堂委、執事（Roles）＋幹事（MAIL_ADMIN_NOTIFY）＋ PRESEASON_EXTRA_RECIPIENTS；同一個地址只收一封。
 * 沒有電郵的人在預覽列出。遵守 DRY_RUN、MAIL_REDIRECT_ALL_TO（sendRealEmail_ 套用）、主旨測試前綴。
 *
 * ── 紀錄 ─────────────────────────────────────────────────────────
 * 只寫 AuditLog（PRESEASON_SENT），**不寫 SendLog、不改 Stage**——所以正式發出防護、補寄、
 * 〔變動的人〕的比較基準、提醒次數全部不受影響（那幾樣都只讀 SendLog／Stage）。
 */

const PRESEASON_TEMPLATE_ID = 'TPL_PRESEASON_TC';
const PRESEASON_AUDIT_ACTION = 'PRESEASON_SENT';
const PRESEASON_SEND_MODE = { AUTO: 'AUTO', MANUAL: 'MANUAL' };

/**
 * 預設範本：EMAIL_TEMPLATE_SEEDS 的 TPL_PRESEASON_TC（EmailTemplates 沒有這一行時用；
 * 「維護 ▸ 補齊 Email 範本」會把它加入試算表，之後可以在試算表改標題和內文）。
 * @returns {Object}
 */
function preseasonTemplateDefault_() {
  return EMAIL_TEMPLATE_SEEDS.filter(function (t) { return t.templateId === PRESEASON_TEMPLATE_ID; })[0];
}

function escapePreseasonHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 這一季的生成日（和每日檢查同一個算法：Quarters.GenerateOn，空白就按 Config 推算）。
 * @param {Object} quarterRow Quarters 一行
 * @param {Object} config readConfig_()
 * @returns {string} yyyy-MM-dd；算不到 ⇒ ''
 */
function readPreseasonGenerateDate_(quarterRow, config) {
  try {
    return computeAutomationSchedule_(quarterRow, config).generateDate || '';
  } catch (err) {
    return '';
  }
}

/**
 * 季前資料的內容（六段）。**只讀。**
 * @param {string} quarterId 目標季度
 * @param {string} todayStr 寄出當日（堂委／執事以這一日的現任為準）
 * @param {string} generateDate 生成日
 * @returns {{quarterId: string, quarterLabel: string, generateDate: string, sections: Object[], html: string, plain: string}}
 */
function buildPreseasonPack_(quarterId, todayStr, generateDate) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const quarter = findQuarter_(quarterId);
  const start = quarter ? toDateString_(quarter[COLUMNS.QUARTERS.START_DATE], timezone) : '';
  const end = quarter ? toDateString_(quarter[COLUMNS.QUARTERS.END_DATE], timezone) : '';
  const nameById = readPersonNameIndex_();
  const posts = readPostsNormalized_();
  const postName = {};
  posts.forEach(function (p) { postName[p.postId] = p.postNameTC || p.postId; });
  const eligibility = readEligibility_();
  const roles = readRolesSafe_(timezone);
  const overlaps = function (from, to) {
    if (!start || !end) return true;
    if (from && from > end) return false;
    if (to && to < start) return false;
    return true;
  };
  const sections = [];

  // ① 事奉人員表
  const s1 = [];
  posts.filter(function (p) { return p.autoGenerate; }).forEach(function (p) {
    const names = ((eligibility.byPost || {})[p.postId] || []).map(function (id) { return nameById[id] || id; }).sort();
    const roleTexts = ((eligibility.rolesByPost || {})[p.postId] || []).map(function (code) {
      return describeEligibilityRoleToken_(code, roles, nameById, todayStr);
    });
    const count = expandEligibilityOnDate_(eligibility, roles, p.postId, start || todayStr).length;
    s1.push(p.postNameTC + '（' + count + ' 人）：' + (roleTexts.concat(names).join('、') || '（名單上沒有人）'));
  });
  sections.push({ title: '一、事奉人員表', lines: s1.length ? s1 : ['（沒有自動排的崗位）'] });

  // ② 暫時不做某崗位
  const s2 = readPersonPostExclusionsSafe_(timezone).filter(function (e) { return overlaps(e.effectiveFrom, e.effectiveTo); })
    .map(function (e) {
      return (nameById[e.personId] || e.personId) + '　' + (postName[e.postId] || e.postId)
        + (e.reason ? '　原因：' + e.reason : '') + (e.effectiveTo ? '　至 ' + e.effectiveTo : '');
    });
  sections.push({ title: '二、暫時不做某崗位', lines: s2.length ? s2 : ['沒有'] });

  // ③ 排表偏好（這一季生效、不是「一般」）
  let s3 = [];
  try {
    s3 = readActivePersonPostWeights_(start || todayStr, timezone).rows
      .filter(function (w) { return Number(w.adjust) !== 0; })
      .map(function (w) {
        const n = Number(w.adjust);
        return (nameById[w.personId] || w.personId) + '　' + (postName[w.postId] || w.postId) + '　'
          + (n > 0 ? '多 ' + n + ' 次' : '少 ' + (-n) + ' 次')
          + (w.reason ? '　原因：' + w.reason : '')
          + '　' + (w.scope === WEIGHT_SCOPE.QUARTER ? '只限這一季' : '之後各季都用');
      });
  } catch (err) {
    s3 = ['（讀不到排表偏好：' + err.message + '）'];
  }
  sections.push({ title: '三、排表偏好', lines: s3.length ? s3 : ['沒有'] });

  // ④ 不能服侍的日期（落在這一季、有效的）
  const U = COLUMNS.UNAVAILABLE;
  const s4 = readUnavailable_().filter(isUnavailableRowActive_).map(function (row) {
    const from = toDateString_(row[U.DATE_FROM], timezone);
    const to = toDateString_(row[U.DATE_TO], timezone) || from;
    return { personId: String(row[U.PERSON_ID] || '').trim(), from: from, to: to, reason: String(row[U.REASON] || '').trim() };
  }).filter(function (u) { return u.from && overlaps(u.from, u.to); })
    .sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); })
    .map(function (u) {
      return (nameById[u.personId] || u.personId) + '　' + u.from + (u.to !== u.from ? ' 至 ' + u.to : '')
        + (u.reason ? '　原因：' + u.reason : '');
    });
  // 第九十輪批次 QC 組：落在這一季、還沒有確認的義工申報（如有）
  let pendingInQuarter = 0;
  try {
    pendingInQuarter = start && end ? countPendingUnavailableSubmissions_({ start: start, end: end }) : 0;
  } catch (err) {
    log_('WARN', '季前資料：義工申報讀不到：' + err.message);
  }
  sections.push({ title: '四、不能服侍的日期', lines: (s4.length ? s4 : ['沒有'])
    .concat(pendingInQuarter > 0 ? ['另有 ' + pendingInQuarter + ' 項義工申報待確認'] : []) });

  // ⑤ 合堂主日及詩班獻詩（第九十輪批次 QB 組：加詩班獻詩的主日及詩班名單）
  const s5 = readCombinedServices_(quarterId, timezone).filter(function (c) { return c.kind; })
    .map(function (c) { return c.serviceDate + '　' + describeCombinedService_(c); });
  readChoirSinging_(quarterId, timezone).filter(function (c) { return c.singing; })
    .forEach(function (c) { s5.push(c.serviceDate + '　詩班獻詩'); });
  s5.sort();  // 每行以日期開頭 ⇒ 合堂和詩班獻詩按日期排在一起
  const choir = readChoirMembersOnSafe_(start || todayStr, timezone);
  const choirLine = choir.error
    ? '詩班名單：（讀不到：' + choir.error + '）'
    : '詩班名單（' + choir.ids.length + ' 人）' + (choir.ids.length
      ? '：' + choir.ids.map(function (id) { return nameById[id] || id; }).join('、') : '');
  sections.push({ title: '五、合堂主日及詩班獻詩', lines: (s5.length ? s5 : ['沒有']).concat([choirLine]) });

  // ⑥ 人手檢查
  let s6;
  try {
    const st = computeStaffingCheck_(buildStaffingContext_(quarterId));
    s6 = st.totalBlanks === 0 ? ['人手足夠'] : st.posts.map(function (p) {
      return p.text + (p.blankWeeks.length ? '（' + p.blankWeeks.map(function (w) { return w.serviceDate; }).join('、') + '）' : '');
    });
  } catch (err) {
    s6 = ['（人手檢查暫時做不到：' + err.message + '）'];
  }
  sections.push({ title: '六、人手檢查', lines: s6 });

  const html = sections.map(function (s) {
    return '<p><b>' + escapePreseasonHtml_(s.title) + '</b></p><ul>'
      + s.lines.map(function (l) { return '<li>' + escapePreseasonHtml_(l) + '</li>'; }).join('') + '</ul>';
  }).join('');
  const plain = sections.map(function (s) {
    return s.title + '\n' + s.lines.map(function (l) { return '・' + l; }).join('\n');
  }).join('\n\n');
  return { quarterId: quarterId, quarterLabel: buildQuarterLabel_(quarterId), generateDate: generateDate,
    sections: sections, html: html, plain: plain };
}

/**
 * 收件人：寄出當日的現任堂委、執事、幹事（MAIL_ADMIN_NOTIFY）、額外收件人；同一個地址只收一封。
 * @param {string} todayStr 寄出當日
 * @returns {{recipients: Object[], noEmail: string[]}} recipients＝[{email, displayName, why}]
 */
function buildPreseasonRecipients_(todayStr) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const M = COLUMNS.NAME_MAPPING;
  const people = {};
  readPeople_().forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (id) people[id] = { label: String(row[M.NAME_TC] || '').trim() || id, email: String(row[M.EMAIL] || '').trim() };
  });
  const roles = readRolesSafe_(timezone);
  const seen = {};
  const recipients = [];
  const noEmail = [];
  const add = function (email, displayName, why) {
    const e = String(email || '').trim();
    if (!e) return;
    const k = e.toLowerCase();
    if (seen[k]) { seen[k].why += '、' + why; return; }
    seen[k] = { email: e, displayName: displayName || e, why: why };
    recipients.push(seen[k]);
  };
  [ROLE_CODES.COMMITTEE, ROLE_CODES.DEACON].forEach(function (code) {
    roleHoldersOn_(roles, code, todayStr).forEach(function (id) {
      const p = people[id] || { label: id, email: '' };
      if (!p.email) { if (noEmail.indexOf(p.label) === -1) noEmail.push(p.label); return; }
      add(p.email, p.label, ROLE_LABELS_TC[code] || code);
    });
  });
  const split = function (raw) {
    return String(raw || '').split(/[,;、\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
  };
  split(getConfig_(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, '')).forEach(function (e) { add(e, '幹事', '幹事'); });
  split(getConfig_(CONFIG_KEYS.PRESEASON_EXTRA_RECIPIENTS, '')).forEach(function (e) { add(e, e, '額外收件人'); });
  return { recipients: recipients, noEmail: noEmail };
}

/**
 * 第八十六輪批次 MA 組：一筆紀錄是不是「模擬」。
 * 第三段 `DRY_RUN` ⇒ 模擬；`SENT` ⇒ 真正寄出。沒有第三段的舊紀錄：看備註開頭（「模擬 N 封」／「寄出 N 封」），
 * 兩樣都不是 ⇒ 當作真正寄出（寧可少寄一次，也不要重複寄給堂委）。
 * @param {string} flag NEW_VALUE 第三段
 * @param {string} notes AuditLog 備註
 * @returns {boolean}
 */
function isPreseasonRecordSimulated_(flag, notes) {
  const f = String(flag || '').trim().toUpperCase();
  if (f === 'DRY_RUN') return true;
  if (f === 'SENT') return false;
  return String(notes || '').trim().indexOf('模擬') === 0;
}

/**
 * 這一季寄季前資料的紀錄（AuditLog）。
 * @param {string} quarterId 季度 ID
 * @returns {?{date: string, mode: string, simulated: boolean, real: ?{date: string, mode: string}}}
 *   `date`／`mode`／`simulated`＝最後一筆（不論真假）；`real`＝最後一筆真正寄出的（沒有 ⇒ null）
 */
function readPreseasonSentRecord_(quarterId) {
  const A = COLUMNS.AUDIT_LOG;
  let found = null;
  let real = null;
  readSheet_(SHEETS.AUDIT_LOG).forEach(function (row) {
    if (row[A.ACTION] !== PRESEASON_AUDIT_ACTION) return;
    if (String(row[A.TARGET_KEY] || '').trim() !== quarterId) return;
    const parts = String(row[A.NEW_VALUE] || '').split('|');
    const simulated = isPreseasonRecordSimulated_(parts[2], row[A.NOTES]);
    found = { date: parts[1] || '', mode: parts[0] || '', simulated: simulated };
    if (!simulated) real = { date: parts[1] || '', mode: parts[0] || '' };
  });
  if (found) found.real = real;
  return found;
}

/**
 * 自動寄出的判斷。**純函式。**
 * 第八十六輪批次 MA 組：`dryRun === false`（真正寄出模式）⇒ 只有「真正寄出」的紀錄（`sent.real`）才算已寄；
 * 測試模式（其餘情況）⇒ 任何紀錄都算（避免每日重複模擬）。
 * @param {{enabled: boolean, daysBefore: number, generateDate: string, today: string,
 *   sent: ?Object, dryRun: boolean, stage: string, versionNo: number}} f
 * @returns {{send: boolean, reason: string}}
 */
function judgePreseasonAutoSend_(f) {
  if (!f.enabled) return { send: false, reason: 'DISABLED' };
  if (!f.generateDate) return { send: false, reason: 'NO_GENERATE_DATE' };
  const from = shiftDateString_(f.generateDate, -Math.max(0, Number(f.daysBefore) || 0));
  if (f.today < from) return { send: false, reason: 'TOO_EARLY' };
  if (f.today >= f.generateDate) return { send: false, reason: 'TOO_LATE' };
  const counted = f.dryRun === false ? (f.sent && f.sent.real) : f.sent;
  if (counted) return { send: false, reason: 'ALREADY_SENT' };
  if (f.stage && f.stage !== QUARTER_STAGE.DRAFT) return { send: false, reason: 'NOT_DRAFT' };
  if (f.versionNo >= 0) return { send: false, reason: 'HAS_VERSION' };
  return { send: true, reason: 'DUE' };
}

/**
 * 「這一季還要做的」那一行。
 * @param {?Object} sent readPreseasonSentRecord_()
 * @param {string} generateDate 生成日
 * @param {number} daysBefore Config
 * @returns {string}
 */
function describePreseasonStatus_(sent, generateDate, daysBefore) {
  const modeText = function (m) { return m === PRESEASON_SEND_MODE.AUTO ? '自動' : '人手'; };
  // 第八十六輪批次 MA 組：有真正寄出 ⇒ 已寄出；只有模擬 ⇒ 模擬寄出（不算已寄），並講明建議幾時正式寄
  if (sent && sent.real) return '季前資料：已寄出（' + sent.real.date + '，' + modeText(sent.real.mode) + '）';
  const suggest = generateDate ? shiftDateString_(generateDate, -Math.max(0, Number(daysBefore) || 0)) : '';
  if (sent) {
    return '季前資料：模擬寄出（' + sent.date + '，' + modeText(sent.mode) + '）'
      + (suggest ? '；正式使用時建議 ' + suggest + ' 寄出' : '；這一季沒有生成日期，不會自動寄出');
  }
  if (!generateDate) return '季前資料：未寄（這一季沒有生成日期，不會自動寄出）';
  return '季前資料：建議 ' + suggest + ' 寄出（未寄）';
}

/**
 * 寄出季前資料（自動和人手共用）。**會寄信**（DRY_RUN 時只模擬）＋寫 AuditLog。不寫 SendLog、不改 Stage。
 * @param {string} quarterId 目標季度
 * @param {string} mode PRESEASON_SEND_MODE
 * @returns {{dryRun: boolean, sent: number, simulated: number, failed: Object[], recipients: Object[], noEmail: string[]}}
 */
function sendPreseasonPack_(quarterId, mode) {
  const config = readConfig_();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const quarterRow = findQuarter_(quarterId);
  const generateDate = quarterRow ? readPreseasonGenerateDate_(quarterRow, config) : '';
  const pack = buildPreseasonPack_(quarterId, today, generateDate);
  const who = buildPreseasonRecipients_(today);
  const tpl = findEmailTemplateById_(PRESEASON_TEMPLATE_ID) || preseasonTemplateDefault_();
  const placeholders = { QuarterLabel: pack.quarterLabel, QuarterID: quarterId, GenerateDate: generateDate || '生成日',
    PreseasonContentHtml: pack.html, PreseasonContentPlain: pack.plain };
  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '');
  const dryRun = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  const context = { senderName: String(config[CONFIG_KEYS.MAIL_SENDER_NAME] || ''), replyTo: String(config[CONFIG_KEYS.MAIL_REPLY_TO] || '') };
  let sent = 0;
  let simulated = 0;
  const failed = [];
  who.recipients.forEach(function (r) {
    const subject = prefix + applyPlaceholders_(tpl.subject, placeholders, r, '');
    const html = applyPlaceholders_(tpl.bodyHtml, placeholders, r, '');
    const plain = applyPlaceholders_(tpl.bodyPlain, placeholders, r, '');
    if (dryRun) { simulated++; return; }
    try {
      sendRealEmail_({ email: r.email, displayName: r.displayName }, subject, html, plain, context, null, null);
      sent++;
    } catch (err) {
      failed.push({ email: r.email, error: err.message });
    }
  });
  writeAuditLog_({
    action: PRESEASON_AUDIT_ACTION,
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    oldValue: '',
    newValue: mode + '|' + today + '|' + (dryRun ? 'DRY_RUN' : 'SENT'),
    source: mode === PRESEASON_SEND_MODE.AUTO ? 'dailyAutomationCheck_' : 'apiPreseasonSend',
    notes: (dryRun ? '模擬 ' + simulated : '寄出 ' + sent) + ' 封；收件人：'
      + who.recipients.map(function (r) { return r.displayName; }).join('、')
      + (failed.length ? '；失敗 ' + failed.length + ' 封' : '')
      + (who.noEmail.length ? '；沒有電郵：' + who.noEmail.join('、') : '')
  });
  return { dryRun: dryRun, sent: sent, simulated: simulated, failed: failed, recipients: who.recipients, noEmail: who.noEmail };
}

/**
 * 每日檢查呼叫：到了時間就自動寄一次。
 * @param {Object} quarterRow Quarters 一行
 * @param {string} today yyyy-MM-dd
 * @param {Object} config readConfig_()
 * @returns {Object} 報告一行 {quarterId, action, outcome, detail}
 */
function runPreseasonAutoSend_(quarterRow, today, config) {
  const quarterId = String(quarterRow[COLUMNS.QUARTERS.QUARTER_ID] || '').trim();
  const judgment = judgePreseasonAutoSend_({
    enabled: getConfig_(CONFIG_KEYS.PRESEASON_AUTO_SEND, true) !== false,
    daysBefore: Number(getConfig_(CONFIG_KEYS.PRESEASON_DAYS_BEFORE, 14)),
    generateDate: readPreseasonGenerateDate_(quarterRow, config),
    today: today,
    sent: readPreseasonSentRecord_(quarterId),
    dryRun: getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false,
    stage: String(quarterRow[COLUMNS.QUARTERS.STAGE] || QUARTER_STAGE.DRAFT).trim().toUpperCase(),
    versionNo: findLatestVersionNo_(quarterId)
  });
  if (!judgment.send) {
    if (judgment.reason === 'NO_GENERATE_DATE') log_('INFO', '季前資料：' + quarterId + ' 沒有生成日期，不會自動寄出');
    return { quarterId: quarterId, action: 'PRESEASON', outcome: 'SKIP', detail: judgment.reason };
  }
  const r = sendPreseasonPack_(quarterId, PRESEASON_SEND_MODE.AUTO);
  return { quarterId: quarterId, action: 'PRESEASON', outcome: 'SENT',
    detail: (r.dryRun ? '模擬 ' + r.simulated : '寄出 ' + r.sent) + ' 封季前資料' };
}

/**
 * 供前端呼叫：〔寄出季前資料〕預覽（內容＋收件人）。**純讀取。**
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiPreseasonPreview(quarterId) {
  assertWebAppRequestAllowed_('apiPreseasonPreview');
  const id = String(quarterId || '').trim();
  beginSheetReadMemo_();
  try {
    const config = readConfig_();
    const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const row = findQuarter_(id);
    const generateDate = row ? readPreseasonGenerateDate_(row, config) : '';
    const pack = buildPreseasonPack_(id, today, generateDate);
    const who = buildPreseasonRecipients_(today);
    return { quarterId: id, quarterLabel: pack.quarterLabel, generateDate: generateDate, sections: pack.sections,
      recipients: who.recipients, noEmail: who.noEmail, dryRun: getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false,
      sentRecord: readPreseasonSentRecord_(id) };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 供前端呼叫：〔寄出〕季前資料（人手）。
 * @param {string} quarterId 季度 ID
 * @returns {Object} sendPreseasonPack_() 的結果
 */
function apiPreseasonSend(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('寄出季前資料', function () {
    return sendPreseasonPack_(String(quarterId || '').trim(), PRESEASON_SEND_MODE.MANUAL);
  });
}

/**
 * 主畫面：「這一季還要做的」那一行。
 * @param {string} quarterId 季度 ID
 * @returns {string}
 */
function readPreseasonStatusText_(quarterId) {
  const config = readConfig_();
  const row = findQuarter_(quarterId);
  const generateDate = row ? readPreseasonGenerateDate_(row, config) : '';
  return describePreseasonStatus_(readPreseasonSentRecord_(quarterId), generateDate,
    Number(getConfig_(CONFIG_KEYS.PRESEASON_DAYS_BEFORE, 14)));
}
