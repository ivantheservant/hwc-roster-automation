/**
 * 第一百零一輪批次 ZG 組：〔上線前檢查〕（介面版，取代選單版的入口）。**只讀，不自動改任何東西。**
 *
 * 逐項 ✔／✘ 及「去哪裏改」（幹事介面的位置）：
 *   自動排程已安裝、自動寄信時間表已看過（〔我已核對時間表〕記錄的日期）、PRESEASON_AUTO_SEND、TRIGGER_AUTO_GENERATE、
 *   ADMIN_NOTIFY_*、ROLLOUT_AUDIENCE、ROSTER_CONTACT_TC、MAIL_REDIRECT_ALL_TO 已清空、DRY_RUN、電郵範本是最新版、
 *   測試殘留（UnavailableSubmissions／Unavailable 測試行、PersonPostWeight 測試行、Eligibility 舊 REQUEST 行）。
 *
 * 「決定項」（開關）：Config 工作表有那一行（即已明確決定）⇒ ✔，並寫出現時的值；沒有那一行（仍用程式預設）⇒ ✘。
 */

/** 測試行的字眼（原因、備註）。 */
const PRELAUNCH_TEST_WORDS = ['test', '測試'];

/** 文字是否像測試資料。 */
function looksLikeTestText_(text) {
  const t = String(text || '').toLowerCase();
  return PRELAUNCH_TEST_WORDS.some(function (w) { return t.indexOf(w) !== -1; });
}

/** 一張工作表內原因／備註像測試的行數（工作表不存在 ⇒ 0）。 */
function countTestRows_(sheetName, fields) {
  let rows = [];
  try { rows = readOptionalSheet_(sheetName); } catch (err) { rows = []; }
  return rows.filter(function (r) { return fields.some(function (f) { return looksLikeTestText_(r[f]); }); }).length;
}

/**
 * 組出檢查清單（純函式以外只讀）。
 * @returns {{items: Object[], okCount: number, total: number}}
 */
function buildPreLaunchWebItems_() {
  const config = readConfig_();
  const has = function (key) { return config[key] !== undefined && config[key] !== null && config[key] !== ''; };
  const onOff = function (key, d) { return getConfig_(key, d) === true || String(getConfig_(key, d)).toUpperCase() === 'TRUE' ? '開' : '關'; };
  const items = [];
  const add = function (label, ok, value, where) { items.push({ label: label, ok: !!ok, value: value, where: where }); };

  let triggers = [];
  try { triggers = listAutomationTriggers_(); } catch (err) { triggers = []; }
  add('自動排程已安裝', triggers.length > 0, triggers.length > 0 ? '已安裝' : '未安裝', '進階與診斷〔自動排程狀態〕→〔安裝自動排程〕');
  const reviewed = readAutomationScheduleReviewedAt_();
  add('自動寄信時間表已看過', !!reviewed, reviewed ? ('已核對（' + reviewed + '）') : '未核對', '進階與診斷〔自動排程狀態〕→〔我已核對時間表〕');
  add('季前資料自動寄出（PRESEASON_AUTO_SEND）已決定', has(CONFIG_KEYS.PRESEASON_AUTO_SEND),
    '現時：' + onOff(CONFIG_KEYS.PRESEASON_AUTO_SEND, true), 'Config 工作表 PRESEASON_AUTO_SEND（〔自動排程狀態〕時間表顯示開／關）');
  add('自動生成（TRIGGER_AUTO_GENERATE）已決定', has(CONFIG_KEYS.TRIGGER_AUTO_GENERATE),
    '現時：' + onOff(CONFIG_KEYS.TRIGGER_AUTO_GENERATE, DEFAULTS.TRIGGER_AUTO_GENERATE), 'Config 工作表 TRIGGER_AUTO_GENERATE');
  add('幹事通知「沒有電郵名單」（ADMIN_NOTIFY_NO_EMAIL）已決定', has(CONFIG_KEYS.ADMIN_NOTIFY_NO_EMAIL),
    '現時：' + onOff(CONFIG_KEYS.ADMIN_NOTIFY_NO_EMAIL, false), '進階與診斷〔補建設定及範本〕補上之後，在 Config 工作表改');
  add('幹事通知「階段提醒」（ADMIN_NOTIFY_STAGE_REMINDERS）已決定', has(CONFIG_KEYS.ADMIN_NOTIFY_STAGE_REMINDERS),
    '現時：' + onOff(CONFIG_KEYS.ADMIN_NOTIFY_STAGE_REMINDERS, false), '進階與診斷〔補建設定及範本〕補上之後，在 Config 工作表改');
  // 第一百零五輪批次 RB 組：申報時間表自動化（上線值 TRUE；由 UNAVAILABLE_INVITE_AUTO_FROM_QUARTER 那一季開始）
  const autoInvite = isUnavailableInviteAutoOn_();
  add('申報時間表自動化（UNAVAILABLE_INVITE_AUTO）已開', autoInvite,
    '現時：' + (autoInvite ? '開' : '關') + '（由 ' + String(getConfig_(CONFIG_KEYS.UNAVAILABLE_INVITE_AUTO_FROM_QUARTER, '2027T2') || '') + ' 開始）',
    'Config 工作表 UNAVAILABLE_INVITE_AUTO（〔自動排程狀態〕時間表顯示申報連結、提醒、申報期完結的日子及開／關）');
  // 第一百零五輪批次 RG 組：影音組合、協唱已填；指定寄信電郵人數（只供核對，0 亦可以是正常）
  let extras = null;
  try { extras = readRuleExtrasContext_(); } catch (err) { extras = null; }
  const nTeams = extras ? extras.teams.list.length : -1;
  const nTeamMembers = extras ? extras.teams.list.reduce(function (s, t) { return s + t.members.length; }, 0) : 0;
  add('影音組合（PostTeams）已填', nTeams > 0, nTeams < 0 ? '讀不到' : (nTeams === 0 ? '沒有（工作表未建立或未填）' : nTeams + ' 組、' + nTeamMembers + ' 人'),
    'PostTeams 工作表（未建立 ⇒ 進階與診斷〔補建設定及範本〕）');
  const nSingers = extras ? extras.backingSingers.length : -1;
  add('協唱（WorshipBackingSingers）已填', nSingers > 0, nSingers < 0 ? '讀不到' : (nSingers === 0 ? '沒有（工作表未建立或未填）' : nSingers + ' 位協唱'),
    'WorshipBackingSingers 工作表（未建立 ⇒ 進階與診斷〔補建設定及範本〕）');
  let nPreferred = -1;
  try { nPreferred = Object.keys(readPreferredEmailPersonIds_()).length; } catch (err) { nPreferred = -1; }
  add('指定寄信電郵（PreferredEmail）已填人數', nPreferred > 0, nPreferred < 0 ? '讀不到' : nPreferred + ' 人',
    '常用設定〔補填電郵〕的「指定寄信電郵（優先）」');
  const rollout = readRolloutAudience_();
  add('開放範圍（ROLLOUT_AUDIENCE）已決定', has(CONFIG_KEYS.ROLLOUT_AUDIENCE),
    '現時：' + (rollout === ROLLOUT_AUDIENCE.ALL ? '全部事奉人員' : '只開放給堂委、執事及幹事（第一階段）'), '常用設定〔使用權限〕');
  const contact = String(config[CONFIG_KEYS.ROSTER_CONTACT_TC] || '').trim();
  add('有修改要聯絡的人（ROSTER_CONTACT_TC）已填', !!contact, contact ? ('現時：' + contact) : '未填（信內寫「幹事」）', 'Config 工作表 ROSTER_CONTACT_TC');
  let redirect = [];
  try { redirect = readMailRedirectTargets_(); } catch (err) { redirect = ['（設定有錯）']; }
  add('測試轉寄（MAIL_REDIRECT_ALL_TO）已清空', redirect.length === 0, redirect.length ? ('現時轉寄到 ' + redirect.length + ' 個地址') : '已清空',
    'Config 工作表 MAIL_REDIRECT_ALL_TO');
  const dryRun = getConfig_(CONFIG_KEYS.DRY_RUN, true) !== false;
  add('已離開測試模式（DRY_RUN=FALSE）', !dryRun, dryRun ? '仍是測試模式（不會真正寄信）' : '已上線（會真正寄信）', '進階與診斷〔上線切換〕');
  let tpl = { diffCount: 0, missingCount: 0 };
  try { tpl = planEmailTemplateUpdate_(); } catch (err) { tpl = { diffCount: -1, missingCount: 0 }; }
  add('電郵範本是最新版', tpl.diffCount === 0 && tpl.missingCount === 0,
    tpl.diffCount < 0 ? '讀不到' : (tpl.diffCount + tpl.missingCount === 0 ? '全部最新' : (tpl.diffCount + ' 個有差異、' + tpl.missingCount + ' 個未有')),
    '進階與診斷〔更新電郵範本到最新版〕');
  const U = COLUMNS.UNAVAILABLE; const S = COLUMNS.UNAVAILABLE_SUBMISSIONS; const W = COLUMNS.PERSON_POST_WEIGHT; const E = COLUMNS.ELIGIBILITY;
  const nSub = countTestRows_(SHEETS.UNAVAILABLE_SUBMISSIONS, [S.REASON]);
  const nUnav = countTestRows_(SHEETS.UNAVAILABLE, [U.REASON]);
  add('沒有不能服侍的測試行（UnavailableSubmissions／Unavailable）', nSub + nUnav === 0, '申報 ' + nSub + ' 行、不能服侍 ' + nUnav + ' 行原因有 test／測試',
    '開季前準備〔不能服侍的日期〕（取消那幾行）');
  const nWeight = countTestRows_(SHEETS.PERSON_POST_WEIGHT, [W.REASON]);
  add('沒有排表偏好的測試行（PersonPostWeight）', nWeight === 0, nWeight + ' 行原因有 test／測試', '開季前準備〔排表偏好〕');
  let nReq = 0;
  try {
    nReq = readOptionalSheet_(SHEETS.ELIGIBILITY).filter(function (r) {
      return String(r[E.SOURCE] || '').trim().toUpperCase() === 'REQUEST' && isTrueValue_(r[E.ACTIVE]);
    }).length;
  } catch (err) { nReq = 0; }
  add('沒有 Eligibility 舊 REQUEST 行', nReq === 0, nReq + ' 行（來源 REQUEST、仍然生效）', '開季前準備〔開啟事奉人員名單〕檢查，然後〔儲存並套用名單〕');
  return { items: items, okCount: items.filter(function (i) { return i.ok; }).length, total: items.length };
}

/**
 * 〔上線前檢查〕（唯讀）。
 * @returns {Object}
 */
function apiGetPreLaunchCheck() {
  assertWebAppRequestAllowed_('apiGetPreLaunchCheck');
  beginSheetReadMemo_();
  try {
    return buildPreLaunchWebItems_();
  } finally {
    endSheetReadMemo_();
  }
}
