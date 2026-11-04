/**
 * 第一百零一輪批次 ZD／ZG 組：只在試算表選單的功能搬入幹事介面；〔使用權限〕；〔上線前檢查〕。
 *
 * Ivan：「所有指南／介面／電郵範本，不包括在『職事表系統』（試算表選單）的操作。若有必要的功能只在選單，就要加入介面。」
 *
 * 這裏的 api 都只是薄殼：權限（assertWebAppRequestAllowed_）＋鎖（改動類）＋叫選單版同一支後端，**不另寫一套**：
 *   自動排程　　　　 installAutomationTrigger_／removeAutomationTriggers_／listAutomationTriggers_（Trigger.gs）
 *   個人專屬連結　　 planPersonalLinkTokenSeed_／seedPersonalLinkTokens_／reissuePersonalLinkToken_（WebAppPersonalLink.gs）
 *   補建設定及範本　 planConfigKeySeed_／seedConfigKeys_（ConfigSeed.gs）、planEmailTemplateSeed_／seedEmailTemplates_
 *   上線切換　　　　 assessGoLiveState_／checkGoLiveReadiness_／setConfigValue_（GoLiveWizard.gs，同一套檢查）
 */

/** 最近一次每日檢查的時間及結果（ScriptProperties）。 */
const AUTOMATION_LAST_RUN_KEY = 'AUTOMATION_LAST_RUN';
/** 〔我已核對時間表〕的 AuditLog action。 */
const AUTOMATION_SCHEDULE_REVIEWED_ACTION = 'AUTOMATION_SCHEDULE_REVIEWED';
/** 重新產生個人連結要逐字輸入的確認文字。 */
const REISSUE_LINK_CONFIRM_TEXT = '確認重新產生';

/* ═════════════════════════ 自動排程 ═════════════════════════ */

/**
 * 每日檢查完成（或失敗）時記下時間及結果。讀寫失敗不影響每日檢查本身。
 * @param {boolean} ok
 * @param {string} summary
 * @returns {void}
 */
function recordAutomationLastRun_(ok, summary) {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    PropertiesService.getScriptProperties().setProperty(AUTOMATION_LAST_RUN_KEY, JSON.stringify({
      at: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm'), ok: !!ok, summary: String(summary || '').slice(0, 300)
    }));
  } catch (err) {
    log_('WARN', '記不到每日檢查的時間：' + err.message);
  }
}

/** @returns {?{at: string, ok: boolean, summary: string}} */
function readAutomationLastRun_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(AUTOMATION_LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/**
 * 每日檢查報告 ⇒ 一句摘要（「已生成 1、已寄 1、出錯 0」）。
 * @param {Object[]} report dailyAutomationCheck_() 的結果
 * @returns {string}
 */
function summariseAutomationReport_(report) {
  const n = { done: 0, skip: 0, err: 0 };
  (report || []).forEach(function (r) {
    const o = String((r && r.outcome) || '');
    if (/ERROR/.test(o)) n.err++;
    else if (/^SKIP/.test(o) || o === 'NOT_DUE') n.skip++;
    else n.done++;
  });
  return '做了 ' + n.done + ' 項、略過 ' + n.skip + ' 項、出錯 ' + n.err + ' 項';
}

/**
 * 自動寄信時間表：未來兩季（開始日在今日之後、最早的兩季），每一季每一項寫明日期、會寄給誰、現時開／關。
 * @param {string} todayStr
 * @returns {Object[]} [{quarterId, quarterLabel, items: [{label, date, who, onOff}]}]
 */
function buildAutomationTimetable_(todayStr) {
  const config = readConfig_();
  const timezone = config[CONFIG_KEYS.SYS_TIMEZONE] || DEFAULTS.TIMEZONE;
  const Q = COLUMNS.QUARTERS;
  const rows = readSheet_(SHEETS.QUARTERS).filter(function (r) {
    const start = toDateString_(r[Q.START_DATE], timezone);
    return r[Q.QUARTER_ID] && start && start > todayStr;
  }).sort(function (a, b) {
    return toDateString_(a[Q.START_DATE], timezone) < toDateString_(b[Q.START_DATE], timezone) ? -1 : 1;
  }).slice(0, 2);
  const onOff = function (b) { return b ? '開' : '關'; };
  const preseasonOn = getConfig_(CONFIG_KEYS.PRESEASON_AUTO_SEND, true) !== false;
  const daysBefore = Number(getConfig_(CONFIG_KEYS.PRESEASON_DAYS_BEFORE, 14));
  const generateOn = getConfig_(CONFIG_KEYS.TRIGGER_AUTO_GENERATE, DEFAULTS.TRIGGER_AUTO_GENERATE) === true;
  const reminderOn = getConfig_(CONFIG_KEYS.ADMIN_NOTIFY_STAGE_REMINDERS, false) === true;
  const deadlineDays = Number(getConfig_(CONFIG_KEYS.REMIND_DEADLINE_DAYS, 7));
  return rows.map(function (row) {
    const quarterId = String(row[Q.QUARTER_ID]).trim();
    const schedule = computeAutomationSchedule_(row, config);
    const generateDate = schedule.generateDate || '';
    const officialDate = toDateString_(row[Q.OFFICIAL_SEND_ON], timezone) || schedule.officialDate || '';
    let deadline = '';
    try { deadline = readUnavailableInviteDates_(quarterId).deadline || ''; } catch (err) { deadline = ''; }
    return {
      quarterId: quarterId, quarterLabel: buildQuarterLabel_(quarterId),
      items: [
        { label: '申報截止日', date: deadline || '（未定）', who: '不寄信（寫在申報連結的信及個人連結頁上）', onOff: '—' },
        { label: '季前資料自動寄出日', date: generateDate && !isNaN(daysBefore) ? shiftDateString_(generateDate, -daysBefore) : '（未定）',
          who: '現任堂委、執事、幹事（MAIL_ADMIN_NOTIFY）及額外收件人', onOff: onOff(preseasonOn) },
        { label: '自動生成日', date: generateDate || '（未定）', who: '只通知幹事（MAIL_ADMIN_NOTIFY）', onOff: onOff(generateOn) },
        { label: '提醒（接近正式發出日）', date: officialDate && !isNaN(deadlineDays) ? shiftDateString_(officialDate, -deadlineDays) : '（未定）',
          who: '只寄幹事（MAIL_ADMIN_NOTIFY）；堂委不會收到自動提醒', onOff: onOff(reminderOn) },
        { label: '正式發出日（人手）', date: officialDate || '（未定）',
          who: '職事表上所有人、堂委、執事及固定收件人（幹事在第 3 步按〔給所有人〕才會寄）', onOff: '人手' }
      ]
    };
  });
}

/**
 * 每日檢查還會做的兩件事（不按日期）。
 * @returns {Object[]} [{label, who, onOff}]
 */
function buildAutomationDailyItems_() {
  return [
    { label: '有新的事奉人員申報（不能服侍）', who: '幹事（MAIL_ADMIN_NOTIFY）及確認者（UNAVAILABLE_CONFIRMER_EMAILS），同一日最多一封',
      onOff: getConfig_(CONFIG_KEYS.PERSONAL_UNAVAILABLE_NOTIFY, true) !== false ? '開' : '關' },
    { label: '已有版本之後開季前資料有改動', who: '幹事（MAIL_ADMIN_NOTIFY）',
      onOff: getConfig_(CONFIG_KEYS.PRESEASON_CHANGE_NOTIFY, true) !== false ? '開' : '關' }
  ];
}

/** 最近一次〔我已核對時間表〕的日期（AuditLog）。 */
function readAutomationScheduleReviewedAt_() {
  const A = COLUMNS.AUDIT_LOG;
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  let at = '';
  readSheet_(SHEETS.AUDIT_LOG).forEach(function (r) {
    if (r[A.ACTION] !== AUTOMATION_SCHEDULE_REVIEWED_ACTION) return;
    const v = r[A.NEW_VALUE];
    // 試算表可能把「2026-11-04」自動轉成日期 ⇒ 轉回 yyyy-MM-dd
    at = Object.prototype.toString.call(v) === '[object Date]' ? toDateString_(v, timezone) : String(v || '');
  });
  return at;
}

/**
 * 〔自動排程狀態〕（唯讀）。
 * @returns {Object}
 */
function apiGetAutomationStatus() {
  assertWebAppRequestAllowed_('apiGetAutomationStatus');
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  let triggers = [];
  let triggerError = '';
  try { triggers = listAutomationTriggers_(); } catch (err) { triggerError = err.message; }
  const rawHour = Number(getConfig_(CONFIG_KEYS.SEND_HOUR_LOCAL, 9));
  return {
    today: today, installed: triggers.length > 0, triggerCount: triggers.length, triggerError: triggerError,
    hour: isNaN(rawHour) ? 9 : Math.min(23, Math.max(0, Math.round(rawHour))),
    lastRun: readAutomationLastRun_(),
    dryRun: getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false,
    timetable: buildAutomationTimetable_(today),
    daily: buildAutomationDailyItems_(),
    reviewedAt: readAutomationScheduleReviewedAt_()
  };
}

/** 〔安裝自動排程〕。 */
function apiInstallAutomation() {
  assertWebAppRequestAllowed_();
  return withMutationLock_('安裝自動排程', function () {
    const r = installAutomationTrigger_();
    writeAuditLog_({ action: 'AUTOMATION_INSTALLED', targetSheet: '', targetKey: '', newValue: '每日 ' + r.hour + ':00',
      source: 'apiInstallAutomation', notes: '幹事介面〔安裝自動排程〕' });
    return { ok: true, hour: r.hour, message: '已安裝，每日約 ' + r.hour + ':00 執行一次檢查。' };
  });
}

/** 〔移除自動排程〕。 */
function apiRemoveAutomation() {
  assertWebAppRequestAllowed_();
  return withMutationLock_('移除自動排程', function () {
    const n = removeAutomationTriggers_();
    writeAuditLog_({ action: 'AUTOMATION_REMOVED', targetSheet: '', targetKey: '', newValue: '移除 ' + n + ' 個',
      source: 'apiRemoveAutomation', notes: '幹事介面〔移除自動排程〕' });
    return { ok: true, removed: n, message: n > 0 ? '已移除。之後系統不會自己執行任何動作。' : '本來就沒有安裝。' };
  });
}

/** 〔我已核對時間表〕：記下日期（AuditLog）。 */
function apiMarkAutomationScheduleReviewed() {
  assertWebAppRequestAllowed_();
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  writeAuditLog_({ action: AUTOMATION_SCHEDULE_REVIEWED_ACTION, targetSheet: '', targetKey: '', newValue: today,
    source: 'apiMarkAutomationScheduleReviewed', notes: '幹事已核對自動寄信時間表' });
  return { ok: true, reviewedAt: today, message: '已記下：' + today + ' 核對了自動寄信時間表。' };
}

/* ═════════════════════════ 個人專屬連結 ═════════════════════════ */

/** 〔補發個人專屬連結〕〔重新產生某人的個人連結〕畫面（唯讀）。 */
function apiGetPersonalLinkTools() {
  assertWebAppRequestAllowed_('apiGetPersonalLinkTools');
  const M = COLUMNS.NAME_MAPPING;
  return {
    missing: planPersonalLinkTokenSeed_().map(function (p) { return { personId: p.personId, nameTC: String(p.nameTC || p.personId) }; }),
    people: readPeople_().map(function (r) {
      return { personId: String(r[M.PERSON_ID] || ''), nameTC: String(r[M.NAME_TC] || r[M.PERSON_ID] || ''),
        hasLink: !!String(r[M.PERSONAL_LINK_TOKEN] || '').trim() };
    }).filter(function (p) { return p.personId; }).sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; }),
    confirmText: REISSUE_LINK_CONFIRM_TEXT
  };
}

/** 〔補發個人專屬連結〕：只為還沒有連結的人（新人）補上。 */
function apiSeedPersonalLinkTokens() {
  assertWebAppRequestAllowed_();
  return withMutationLock_('補發個人專屬連結', function () {
    const missing = planPersonalLinkTokenSeed_();
    const n = seedPersonalLinkTokens_(missing);
    writeAuditLog_({ action: 'PERSONAL_LINK_TOKENS_SEEDED', targetSheet: SHEETS.NAME_MAPPING, targetKey: '',
      newValue: '補發 ' + n + ' 位', source: 'apiSeedPersonalLinkTokens',
      notes: missing.map(function (m) { return m.personId; }).join(',') });
    return { ok: true, count: n, message: n > 0 ? '已為 ' + n + ' 位補發個人專屬連結。' : '每一位都已經有個人專屬連結。' };
  });
}

/**
 * 〔重新產生某人的個人連結〕（外洩時用；強確認）。舊連結即時失效。
 * @param {string} personId
 * @param {string} typed 要逐字輸入 REISSUE_LINK_CONFIRM_TEXT
 * @returns {Object}
 */
function apiReissuePersonalLinkToken(personId, typed, quarterId) {
  assertWebAppRequestAllowed_();
  if (String(typed || '').trim() !== REISSUE_LINK_CONFIRM_TEXT) {
    throw new Error('確認文字不對（要逐字輸入「' + REISSUE_LINK_CONFIRM_TEXT + '」），沒有改動。');
  }
  const id = normalizeIdInput_(personId);
  return withMutationLock_('重新產生某人的個人連結', function () {
    const r = reissuePersonalLinkToken_(id);
    writeAuditLog_({ action: 'PERSONAL_LINK_TOKEN_REISSUED', targetSheet: SHEETS.NAME_MAPPING, targetKey: id,
      newValue: '（新 token，不記錄）', source: 'apiReissuePersonalLinkToken', notes: '外洩時用：舊連結即時失效' });
    const base = String(getConfig_(CONFIG_KEYS.WEBAPP_VOLUNTEER_URL, '') || '').trim();
    return { ok: true, nameTC: r.nameTC, newUrl: base ? buildPersonalRosterUrl_(base, r.newToken, String(quarterId || '').trim()) : '',
      message: '已為 ' + (r.nameTC || id) + ' 重新產生個人連結。舊連結已經失效，請把新連結交給他本人。' };
  });
}

/* ═════════════════════════ 補建設定及範本 ═════════════════════════ */

/** 〔補建設定及範本〕比對（唯讀）：缺少的 Config 行、缺少的電郵範本。 */
function apiPlanSeedConfigAndTemplates() {
  assertWebAppRequestAllowed_('apiPlanSeedConfigAndTemplates');
  const c = planConfigKeySeed_();
  const t = planEmailTemplateSeed_();
  // 第一百零二輪批次 OA 組：Posts.OutputOrder（寄出／公開職事表的崗位次序）
  const o = planPostOutputOrderSeed_();
  return {
    postsOutputOrder: o.needed ? o.fills.map(function (f) { return f.postNameTC + '＝' + (f.value === '' ? '（留空＝用 DisplayOrder）' : f.value); }) : [],
    configMissing: c.missing.map(function (s) { return { key: s.key, defaultValue: String(s.defaultValue || ''), group: s.group }; }),
    templatesMissing: t.missing.map(function (s) { return s.templateId; })
  };
}

/** 〔補建設定及範本〕：只新增缺少的（不改任何既有行）。 */
function apiSeedConfigAndTemplates() {
  assertWebAppRequestAllowed_();
  return withMutationLock_('補建設定及範本', function () {
    const c = planConfigKeySeed_();
    const t = planEmailTemplateSeed_();
    const nc = c.missing.length ? seedConfigKeys_(c.missing) : 0;
    const nt = t.missing.length ? seedEmailTemplates_(t.missing) : 0;
    // 第一百零二輪批次 OA 組：Posts.OutputOrder 欄（只在欄不存在或整欄空白時補）
    const o = planPostOutputOrderSeed_();
    const no = o.needed ? seedPostOutputOrder_(o) : 0;
    if (nc > 0) reloadConfigCache_();
    writeAuditLog_({ action: 'CONFIG_TEMPLATES_SEEDED', targetSheet: SHEETS.CONFIG, targetKey: '',
      newValue: 'Config ' + nc + ' 行、範本 ' + nt + ' 個' + (o.needed ? '、Posts.OutputOrder ' + no + ' 行' : ''), source: 'apiSeedConfigAndTemplates',
      notes: c.missing.map(function (s) { return s.key; }).concat(t.missing.map(function (s) { return s.templateId; })).join(',') });
    return { ok: true, configAdded: c.missing.map(function (s) { return s.key; }), templatesAdded: t.missing.map(function (s) { return s.templateId; }),
      postsOutputOrderSeeded: o.needed ? no : 0,
      message: (nc + nt) > 0 || o.needed
        ? '已補建 Config ' + nc + ' 行、電郵範本 ' + nt + ' 個（數值是預設值）' + (o.needed ? '；Posts 的 OutputOrder 欄填了 ' + no + ' 行（寄出／公開職事表的崗位次序）' : '') + '。'
        : '全部已經齊全，不需要補建。' };
  });
}

/* ═════════════════════════ 上線切換 ═════════════════════════ */

/**
 * 〔上線切換〕〔回到測試模式〕畫面（唯讀）：現況＋全面體檢（和選單嚮導同一套檢查）。
 * @param {string} quarterId 體檢季度（可留空）
 * @returns {Object}
 */
function apiGoLivePlan(quarterId) {
  const role = assertWebAppRequestAllowed_('apiGoLivePlan');
  assertEditorOnlyRead_(role, '上線切換');
  const state = assessGoLiveState_();
  let readiness = null;
  let readinessError = '';
  try {
    const r = checkGoLiveReadiness_(String(quarterId || '').trim());
    readiness = { ok: r.ok, mustCount: r.mustCount, shouldCount: r.shouldCount,
      mustItems: r.mustItems.slice(0, 20).map(function (i) { return { section: i.section, label: i.label, summary: i.summary }; }) };
  } catch (err) {
    readinessError = err.message;
  }
  return { state: state, readiness: readiness, readinessError: readinessError,
    confirmText: GO_LIVE_CONFIRM_TEXT, rollbackConfirmText: GO_LIVE_ROLLBACK_CONFIRM_TEXT, testPrefix: GO_LIVE_TEST_SUBJECT_PREFIX };
}

/**
 * 〔上線切換〕：清空主旨前綴 → DRY_RUN=FALSE（風險最高的一步排最後）。體檢有「必須處理」⇒ 拒絕。
 * @param {string} quarterId
 * @param {string} typed 逐字輸入 GO_LIVE_CONFIRM_TEXT
 * @returns {Object}
 */
function apiGoLiveExecute(quarterId, typed) {
  assertWebAppRequestAllowed_();
  if (String(typed || '').trim() !== GO_LIVE_CONFIRM_TEXT) {
    throw new Error('確認文字不對（要逐字輸入「' + GO_LIVE_CONFIRM_TEXT + '」），沒有改動任何東西。');
  }
  return withMutationLock_('上線切換', function () {
    const q = String(quarterId || '').trim();
    const readiness = checkGoLiveReadiness_(q);
    if (!readiness.ok) {
      throw new Error(buildThreePartMessage_('全面體檢找到 ' + readiness.mustCount + ' 項「必須處理」。',
        '沒有改動任何東西，系統仍然是測試模式。', ['先處理那幾項（〔上線前檢查〕會列出），再按一次']));
    }
    const done = [];
    const before = assessGoLiveState_();
    if (!before.prefixCleared) {
      const r1 = setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '', 'apiGoLiveExecute');
      done.push(CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '「' + r1.oldValue + '」→（空白）');
    }
    const r2 = setConfigValue_(CONFIG_KEYS.DRY_RUN, 'FALSE', 'apiGoLiveExecute');
    done.push(CONFIG_KEYS.DRY_RUN + '「' + r2.oldValue + '」→ FALSE');
    writeAuditLog_({ action: '上線切換完成', targetSheet: SHEETS.CONFIG, targetKey: q || '（未指定季度）',
      newValue: 'DRY_RUN=FALSE，主旨前綴已清空', source: 'apiGoLiveExecute', notes: done.join('；') });
    return { ok: true, done: done, state: assessGoLiveState_(),
      message: '已上線：之後寄出的信會真正寄出。發現問題要立即停止，按〔回到測試模式〕。' };
  });
}

/**
 * 〔回到測試模式〕：先 DRY_RUN=TRUE（止血）→ 再放回主旨前綴。
 * @param {string} typed 逐字輸入 GO_LIVE_ROLLBACK_CONFIRM_TEXT
 * @returns {Object}
 */
function apiGoLiveRollback(typed) {
  assertWebAppRequestAllowed_();
  if (String(typed || '').trim() !== GO_LIVE_ROLLBACK_CONFIRM_TEXT) {
    throw new Error('確認文字不對（要逐字輸入「' + GO_LIVE_ROLLBACK_CONFIRM_TEXT + '」），沒有改動任何東西。');
  }
  return withMutationLock_('回到測試模式', function () {
    const done = [];
    const r1 = setConfigValue_(CONFIG_KEYS.DRY_RUN, 'TRUE', 'apiGoLiveRollback');
    done.push(CONFIG_KEYS.DRY_RUN + '「' + r1.oldValue + '」→ TRUE（已停止真正寄信）');
    const r2 = setConfigValue_(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, GO_LIVE_TEST_SUBJECT_PREFIX, 'apiGoLiveRollback');
    done.push(CONFIG_KEYS.MAIL_SUBJECT_PREFIX + '「' + r2.oldValue + '」→「' + GO_LIVE_TEST_SUBJECT_PREFIX + '」');
    writeAuditLog_({ action: '回到測試模式', targetSheet: SHEETS.CONFIG, targetKey: '（全系統）',
      newValue: 'DRY_RUN=TRUE，主旨前綴＝' + GO_LIVE_TEST_SUBJECT_PREFIX, source: 'apiGoLiveRollback', notes: done.join('；') });
    return { ok: true, done: done, state: assessGoLiveState_(), message: '已回到測試模式：之後不會再真正寄出任何信。' };
  });
}

/* ═════════════════════════ 使用權限 ═════════════════════════ */

/** 每一類一句說明「這些人可以做甚麼、看到甚麼」。 */
const PERMISSION_CATEGORY_TEXT = {
  editors: '可以修改：打開幹事介面做所有事（生成、修改、寄出、設定），亦可以打開主試算表。',
  viewers: '只可查看：打開幹事介面看狀態及職事表預覽，所有會改動的按鈕都是灰色，看不到任何打開主試算表的按鈕或連結。',
  confirmers: '確認申報：打開幹事介面只看到「事奉人員申報，確認」畫面，可以確認或不確認事奉人員申報不能服侍的日子。',
  adminNotify: '幹事通知電郵：系統寄給幹事的通知（生成完成、新申報、開季前資料改動等）寄到這裏；亦會收到季前資料。',
  rollout: '開放範圍：「只開放給堂委、執事及幹事」＝第一階段，申報不能服侍的日子及申報連結只給堂委、執事、幹事；「全部事奉人員」＝全面開放。'
};

/**
 * 只限可以修改的人看的唯讀畫面（使用權限、上線切換）。
 * @param {string} role assertWebAppRequestAllowed_() 的結果
 * @param {string} what 畫面名稱
 * @returns {void}
 */
function assertEditorOnlyRead_(role, what) {
  if (role !== 'EDITOR') throw new Error('「' + what + '」只限可以修改的人使用。');
}

/** 電郵是否合法。 */
function isValidPermissionEmail_(e) {
  const s = String(e || '');
  const parts = s.split('@');
  if (parts.length !== 2 || !parts[0] || parts[1].indexOf('.') <= 0 || /\.$/.test(parts[1])) return false;
  return !/[\s,;]/.test(s);
}

/** 〔使用權限〕（唯讀）。 */
function apiGetPermissions() {
  const role = assertWebAppRequestAllowed_('apiGetPermissions');
  // 名單有各人的電郵 ⇒ 只限可以修改的人（只可查看的人按不到這一頁）
  assertEditorOnlyRead_(role, '使用權限');
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const lookup = buildRolloutLeaderLookup_(timezone, today);
  const people = readAudiencePeople_();
  const names = function (ids) { return ids.map(function (id) { return (people[id] && people[id].name) || id; }); };
  let me = '';
  try { me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (err) { me = ''; }
  return {
    me: me,
    editors: readWebAppEmailList_(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS),
    viewers: readWebAppEmailList_(CONFIG_KEYS.WEBAPP_VIEWER_EMAILS),
    confirmers: readWebAppEmailList_(CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS),
    adminNotify: splitRolloutEmails_(getConfig_(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, '')),
    rollout: readRolloutAudience_(),
    committee: names(lookup.committee), deacon: names(lookup.deacon),
    text: PERMISSION_CATEGORY_TEXT
  };
}

/**
 * 〔使用權限〕儲存。驗證電郵格式；不可以把自己從「可以修改」移走；每一項改動寫 AuditLog（setConfigValue_）。
 * @param {{editors: string[], viewers: string[], confirmers: string[], adminNotify: string[], rollout: string}} payload
 * @returns {Object}
 */
function apiSavePermissions(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const clean = function (list) {
    return (Array.isArray(list) ? list : String(list || '').split(/[,，;；\s]+/))
      .map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean)
      .filter(function (e, i, a) { return a.indexOf(e) === i; });
  };
  const next = { editors: clean(p.editors), viewers: clean(p.viewers), confirmers: clean(p.confirmers), adminNotify: clean(p.adminNotify) };
  const bad = [];
  Object.keys(next).forEach(function (k) { next[k].forEach(function (e) { if (!isValidPermissionEmail_(e)) bad.push(e); }); });
  if (bad.length > 0) throw new Error('這幾個電郵格式不對：' + bad.join('、') + '。沒有改動任何東西。');
  let me = '';
  try { me = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (err) { me = ''; }
  if (!me || next.editors.indexOf(me) === -1) {
    throw new Error(buildThreePartMessage_('不可以把你自己（' + (me || '讀不到你的電郵') + '）從「可以修改」移走。',
      '沒有改動任何東西。', ['把你自己的電郵加回「可以修改」，再按〔儲存〕']));
  }
  const rollout = String(p.rollout || '').trim().toUpperCase();
  if (rollout !== ROLLOUT_AUDIENCE.LEADERS && rollout !== ROLLOUT_AUDIENCE.ALL) throw new Error('開放範圍只可以是 LEADERS 或 ALL。');
  return withMutationLock_('使用權限', function () {
    const now = readPermissionsRaw_();
    const changes = [];
    const setIfChanged = function (key, oldList, newList) {
      const a = oldList.join(','); const b = newList.join(',');
      if (a === b) return;
      ensureConfigKeyRow_(key);
      const r = setConfigValue_(key, b, 'apiSavePermissions', '使用權限：改 Config');
      changes.push(key + '：「' + r.oldValue + '」→「' + b + '」');
    };
    setIfChanged(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, now.editors, next.editors);
    setIfChanged(CONFIG_KEYS.WEBAPP_VIEWER_EMAILS, now.viewers, next.viewers);
    setIfChanged(CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS, now.confirmers, next.confirmers);
    setIfChanged(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, now.adminNotify, next.adminNotify);
    if (rollout !== now.rollout) {
      ensureConfigKeyRow_(CONFIG_KEYS.ROLLOUT_AUDIENCE);
      const r = setConfigValue_(CONFIG_KEYS.ROLLOUT_AUDIENCE, rollout, 'apiSavePermissions', '使用權限：改 Config');
      changes.push(CONFIG_KEYS.ROLLOUT_AUDIENCE + '：「' + r.oldValue + '」→「' + rollout + '」');
    }
    if (changes.length > 0) {
      writeAuditLog_({ action: 'PERMISSIONS_SAVED', targetSheet: SHEETS.CONFIG, targetKey: '', newValue: changes.length + ' 項',
        source: 'apiSavePermissions', notes: changes.join('；') });
    }
    return { ok: true, changes: changes, message: changes.length ? '已儲存 ' + changes.length + ' 項改動。' : '沒有改動。' };
  });
}

/** 現值（不檢查權限；apiSavePermissions 內部用）。 */
function readPermissionsRaw_() {
  return {
    editors: readWebAppEmailList_(CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS),
    viewers: readWebAppEmailList_(CONFIG_KEYS.WEBAPP_VIEWER_EMAILS),
    confirmers: readWebAppEmailList_(CONFIG_KEYS.UNAVAILABLE_CONFIRMER_EMAILS),
    adminNotify: splitRolloutEmails_(getConfig_(CONFIG_KEYS.MAIL_ADMIN_NOTIFY, '')),
    rollout: readRolloutAudience_()
  };
}

/**
 * Config 工作表沒有這一行 ⇒ 先用種子補上（和〔補建設定及範本〕同一支），再改值。
 * @param {string} key
 * @returns {void}
 */
function ensureConfigKeyRow_(key) {
  const plan = planConfigKeySeed_();
  const seed = plan.missing.filter(function (s) { return s.key === key; });
  if (seed.length > 0) seedConfigKeys_(seed);
}

/* ═════════════════════════ 只可查看的人：不送主試算表網址 ═════════════════════════ */

/**
 * 第一百零一輪批次 ZD-4：只可查看的人（role＝VIEWER）⇒ 清走主試算表網址；其他人原封不動。
 * @param {string} role
 * @param {*} state
 * @returns {*}
 */
function viewerSafeState_(role, state) {
  return role === 'VIEWER' ? stripMainSpreadsheetUrlsForViewer_(state) : state;   // WEBAPP_ROLE.VIEWER
}

/**
 * 第一百零一輪批次 ZD-4：只可查看的人 ⇒ 回傳資料內任何主試算表網址（含 ID 的字串）一律清空。
 * 介面因此不會出現任何打開主試算表的按鈕或連結（伺服器端把關，不只靠介面）。
 * @param {*} value
 * @param {string[]=} ids
 * @returns {*}
 */
function stripMainSpreadsheetUrlsForViewer_(value, ids) {
  const blocked = ids || readBlockedSpreadsheetIds_();
  if (blocked.length === 0) return value;
  const walk = function (v) {
    if (typeof v === 'string') {
      return blocked.some(function (id) { return v.indexOf(id) !== -1; }) ? '' : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]') {
      const out = {};
      Object.keys(v).forEach(function (k) { out[k] = walk(v[k]); });
      return out;
    }
    return v;
  };
  return walk(value);
}
