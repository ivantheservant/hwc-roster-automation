/**
 * 第一百一十一輪批次 SG 組：〔上線前檢查〕補項及狀態卡「自動排程最近沒有執行」。**只讀。**
 *
 * 〔上線前檢查〕新項目（buildPreLaunchWebItems_() 經 appendGoLivePreLaunchItems_() 加入）：
 *   1. GO_LIVE_QUARTER_ID 那一季還未開始，而且還未有版本
 *   2. 開始日在上線季度之前、已正式發出的季度，都在 QUARTER_RESET_BLOCKED_QUARTERS 及 COMBINED_BACKFILL_BLOCKED_QUARTERS 之內
 *   3. 開始日在上線季度之後而已經有版本的季度（測試季度）：列出，提示上線前清理
 *   4. 上線季度的上一季有緊接的職事表資料（第一百零九輪 SB 組同一支函式）
 *   5. MAIL_SUBJECT_PREFIX 仍有內容時顯示現值（〔上線切換〕會清空）
 *   6. USER_GUIDE_URL 是否已填（只是提示）
 *   7. Requests、SpecialSundays 沒有測試行
 *   10. MAIL_REDIRECT_ALL_TO 未清空時只有開發帳戶（MAIL_ADMIN_NOTIFY 第一個地址）一個地址（不寫出地址）
 */

/**
 * 上線季度相關的四項（1–4）。**純函式。**
 * @param {{goLiveId: string, today: string, quarters: Array<{id: string, start: string, stage: string}>,
 *   versionsByQuarter: Object.<string, number>, officialByQuarter: Object.<string, boolean>,
 *   resetBlocked: string[], backfillBlocked: string[], priorNote: string}} input
 * @returns {Array<{label: string, ok: boolean, value: string, where: string}>}
 */
function buildGoLiveQuarterItems_(input) {
  const inp = input || {};
  const items = [];
  const add = function (label, ok, value, where) { items.push({ label: label, ok: !!ok, value: value, where: where }); };
  const goLiveId = String(inp.goLiveId || '').trim();
  const quarters = (inp.quarters || []).filter(function (q) { return q.id; });
  const versions = inp.versionsByQuarter || {};
  const official = inp.officialByQuarter || {};
  const goLive = quarters.filter(function (q) { return q.id === goLiveId; })[0];
  const whereGoLive = 'Config 工作表 GO_LIVE_QUARTER_ID';

  if (!goLiveId || !goLive) {
    add('上線季度（GO_LIVE_QUARTER_ID）還未開始而且還未有版本', false, goLiveId ? ('「' + goLiveId + '」不在 Quarters') : '未填', whereGoLive);
    add('上線之前已正式發出的季度都受保護（不可以整季重設、不可以補填合堂）', false, '先填好上線季度', whereGoLive);
    add('上線之後沒有測試季度的版本', false, '先填好上線季度', whereGoLive);
    add('上線季度的上一季有緊接的職事表', false, '先填好上線季度', whereGoLive);
    return items;
  }

  const started = !!goLive.start && goLive.start <= String(inp.today || '');
  const nGoLive = Number(versions[goLiveId] || 0);
  add('上線季度（GO_LIVE_QUARTER_ID）還未開始而且還未有版本', !started && nGoLive === 0,
    goLiveId + '（' + goLive.start + ' 開始）：' + (started ? '已經開始' : '未開始') + '、' + (nGoLive ? '已有 ' + nGoLive + ' 個版本' : '沒有版本')
      + (started || nGoLive ? '——請改為下一個還未開始、還未生成的季度' : ''),
    whereGoLive);

  const reset = inp.resetBlocked || [];
  const backfill = inp.backfillBlocked || [];
  const before = quarters.filter(function (q) { return q.start && q.start < goLive.start && (official[q.id] || q.stage === 'OFFICIAL_SENT'); });
  const missReset = before.filter(function (q) { return reset.indexOf(q.id) === -1; }).map(function (q) { return q.id; });
  const missBackfill = before.filter(function (q) { return backfill.indexOf(q.id) === -1; }).map(function (q) { return q.id; });
  add('上線之前已正式發出的季度都受保護（不可以整季重設、不可以補填合堂）', missReset.length === 0 && missBackfill.length === 0,
    before.length === 0 ? '上線之前沒有已正式發出的季度'
      : (missReset.length === 0 && missBackfill.length === 0 ? before.length + ' 季全部受保護'
        : (missReset.length ? '不在 QUARTER_RESET_BLOCKED_QUARTERS：' + missReset.join('、') : '')
          + (missReset.length && missBackfill.length ? '；' : '')
          + (missBackfill.length ? '不在 COMBINED_BACKFILL_BLOCKED_QUARTERS：' + missBackfill.join('、') : '')),
    'Config 工作表 QUARTER_RESET_BLOCKED_QUARTERS、COMBINED_BACKFILL_BLOCKED_QUARTERS');

  const testQuarters = quarters.filter(function (q) { return q.start && q.start > goLive.start && Number(versions[q.id] || 0) > 0; })
    .map(function (q) { return q.id; }).sort();
  add('上線之後沒有測試季度的版本', testQuarters.length === 0,
    testQuarters.length === 0 ? '沒有' : testQuarters.length + ' 季有版本：' + testQuarters.join('、') + '——上線前請用〔整季重設〕清理',
    '選那一季 ▸ 常用設定「整季重設」〔開始〕');

  const prior = String(inp.priorNote || '');
  add('上線季度的上一季有緊接的職事表', !prior, prior ? prior : '有（上線季度頭幾週會核對「同一崗位連續兩週」）',
    '上一季是人手排的 ⇒ 進階與診斷〔建立匯入表〕→〔檢查並匯入〕');
  return items;
}

/**
 * 第 10 項：測試轉寄只有開發帳戶一個地址。**純函式。**不寫出地址。
 * @param {string[]} redirect 轉寄地址
 * @param {string[]} adminNotify MAIL_ADMIN_NOTIFY
 * @returns {{label: string, ok: boolean, value: string, where: string}}
 */
function buildRedirectSingleTargetItem_(redirect, adminNotify) {
  const r = (redirect || []).map(function (e) { return String(e).trim().toLowerCase(); }).filter(Boolean);
  const dev = String((adminNotify || [])[0] || '').trim().toLowerCase();
  const ok = r.length === 0 || (r.length === 1 && !!dev && r[0] === dev);
  return {
    label: '測試轉寄（未清空時）只有開發帳戶一個地址', ok: ok,
    value: r.length === 0 ? '已清空（不用核對）' : (ok ? '一個地址，與開發帳戶相同' : (r.length + ' 個地址' + (r.length === 1 ? '，與開發帳戶不同' : '') + '——測試期間的信可能寄到別人')),
    where: 'Config 工作表 MAIL_REDIRECT_ALL_TO（開發帳戶＝MAIL_ADMIN_NOTIFY 第一個地址）'
  };
}

/**
 * 讀資料後加入 1–7、10 項（只讀；讀不到某一項 ⇒ 那一項寫「讀不到」，不影響其他項）。
 * @param {function(string, boolean, string, string)} add buildPreLaunchWebItems_() 的 add
 * @param {Object} config readConfig_()
 * @returns {void}
 */
function appendGoLivePreLaunchItems_(add, config) {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const Q = COLUMNS.QUARTERS;
    const quarters = readSheet_(SHEETS.QUARTERS).map(function (r) {
      return { id: String(r[Q.QUARTER_ID] || '').trim(), start: toDateString_(r[Q.START_DATE], timezone), stage: String(r[Q.STAGE] || '').trim().toUpperCase() };
    });
    const versionsByQuarter = {};
    readSheet_(SHEETS.ROSTER_VERSIONS).forEach(function (r) {
      const id = String(r[COLUMNS.ROSTER_VERSIONS.QUARTER_ID] || '').trim();
      if (id) versionsByQuarter[id] = (versionsByQuarter[id] || 0) + 1;
    });
    const officialByQuarter = {};
    const SL = COLUMNS.SEND_LOG;
    readOptionalSheet_(SHEETS.SEND_LOG).forEach(function (r) {
      const st = String(r[SL.STAGE] || '').trim();
      if (st === MAIL_STAGES.OFFICIAL || st === MAIL_STAGES.RESEND) officialByQuarter[String(r[SL.QUARTER_ID] || '').trim()] = true;
    });
    const goLiveId = String(getConfig_(CONFIG_KEYS.GO_LIVE_QUARTER_ID, DEFAULTS.GO_LIVE_QUARTER_ID) || '').trim();
    buildGoLiveQuarterItems_({
      goLiveId: goLiveId, today: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd'), quarters: quarters,
      versionsByQuarter: versionsByQuarter, officialByQuarter: officialByQuarter,
      resetBlocked: readQuarterResetBlockedQuarters_(), backfillBlocked: readCombinedBackfillBlockedQuarters_(),
      priorNote: goLiveId ? computePriorWeeksNoteForQuarter_(goLiveId) : ''
    }).forEach(function (it) { add(it.label, it.ok, it.value, it.where); });
  } catch (err) {
    add('上線季度相關檢查', false, '讀不到：' + err.message, 'Config 工作表 GO_LIVE_QUARTER_ID');
  }

  const prefix = String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '').trim();
  add('電郵主旨的測試字首（MAIL_SUBJECT_PREFIX）已清空', !prefix, prefix ? ('現時：' + prefix + '（〔上線切換〕會清空）') : '已清空',
    '進階與診斷〔上線切換〕');
  const guide = String(config[CONFIG_KEYS.USER_GUIDE_URL] || '').trim();
  add('使用指南連結（USER_GUIDE_URL）已填', !!guide, guide ? '已填' : '未填（只是提示：信內不會有使用指南連結）', 'Config 工作表 USER_GUIDE_URL');
  const R = COLUMNS.REQUESTS;
  const S = COLUMNS.SPECIAL_SUNDAYS;
  const nReq = countTestRows_(SHEETS.REQUESTS, [R.NOTES, R.RESULT_NOTE, R.PERSON_NAME]);
  const nSpecial = countTestRows_(SHEETS.SPECIAL_SUNDAYS, [S.TITLE, S.NOTES]);
  add('修改申報、特別主日沒有測試行（Requests／SpecialSundays）', nReq + nSpecial === 0,
    '修改申報 ' + nReq + ' 行、特別主日 ' + nSpecial + ' 行有 test／測試', 'Requests、SpecialSundays 工作表（刪除或改正那幾行）');
  let redirect = [];
  let admins = [];
  try { redirect = readMailRedirectTargets_(); } catch (err) { redirect = ['（設定有錯）', '（設定有錯）']; }
  admins = String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || '').split(/[,;\s]+/).filter(Boolean);
  const it = buildRedirectSingleTargetItem_(redirect, admins);
  add(it.label, it.ok, it.value, it.where);
}

/**
 * 狀態卡：自動排程已安裝，但最近一次執行超過 36 小時，或者最近一次有錯誤 ⇒ 一句紅字。**純函式。**
 * 未安裝 ⇒ ''（〔上線前檢查〕及〔自動排程狀態〕照舊提示）。
 * @param {boolean} installed
 * @param {?{at: string, ok: boolean}} lastRun readAutomationLastRun_()（at＝'yyyy-MM-dd HH:mm'，本地時間）
 * @param {string} nowText 現在（'yyyy-MM-dd HH:mm'，同一個時區）
 * @returns {string}
 */
function describeAutomationStaleAlert_(installed, lastRun, nowText) {
  if (!installed) return '';
  const where = '請到進階與診斷〔自動排程狀態〕看最近一次執行的結果。';
  if (!lastRun || !lastRun.at) return '⚠️ 自動排程最近沒有執行（沒有執行紀錄）。' + where;
  const toMs = function (t) { return Date.parse(String(t).replace(' ', 'T') + ':00Z'); };
  const hours = (toMs(nowText) - toMs(lastRun.at)) / 3600000;
  if (!(hours <= AUTOMATION_STALE_HOURS)) {
    return '⚠️ 自動排程最近沒有執行（最近一次是 ' + lastRun.at + '，已超過 ' + AUTOMATION_STALE_HOURS + ' 小時）。' + where;
  }
  if (lastRun.ok === false) return '⚠️ 自動排程最近一次執行（' + lastRun.at + '）有錯誤。' + where;
  return '';
}

/** 狀態卡「自動排程最近沒有執行」的時限（小時）。 */
const AUTOMATION_STALE_HOURS = 36;

/**
 * 狀態卡用（讀不到 ⇒ ''，提示不可以令狀態卡失敗）。
 * @returns {string}
 */
function readAutomationStaleAlert_() {
  try {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    return describeAutomationStaleAlert_(listAutomationTriggers_().length > 0, readAutomationLastRun_(),
      Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm'));
  } catch (err) {
    return '';
  }
}
