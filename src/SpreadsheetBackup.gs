/**
 * 第一百一十一輪批次 SI 組：每週備份主試算表。
 *
 * 全部資料在同一個試算表；以前只有 Google 的版本記錄。這裏：
 *   ・每日自動排程加一步：到了 `BACKUP_WEEKDAY`（1＝星期一 … 7＝星期日）而這一週還未備份 ⇒ 匯出 xlsx，
 *     存到備份資料夾，檔名「職事表主試算表備份_yyyy-MM-dd.xlsx」；只保留最近 `BACKUP_KEEP_COUNT` 份。
 *     那一日沒有執行（例如排程停了一日）⇒ 同一週之內下一次執行補做。
 *   ・**用匯出 xlsx**（PDF 匯出同一種做法：UrlFetchApp＋ScriptApp.getOAuthToken()），**不用 makeCopy()**——
 *     複本會連同程式一併複製，變成第二套可以寄信的系統。
 *   ・備份資料夾：`BACKUP_FOLDER_ID`；空白 ⇒ 在 `ROSTER_DRIVE_FOLDER_ID`（已驗證是 Shared Drive）之下的「備份」資料夾。
 *     備份有個人資料：資料夾一定要在 Shared Drive（My Drive ⇒ 拋錯，不寫入）；不改任何分享設定。
 *   ・清理只按檔名規則（「職事表主試算表備份_」開頭）——資料夾內其他檔案一律不碰。
 *   ・出錯只影響這一步；失敗通知幹事（MAIL_ADMIN_NOTIFY）一次（經寄信閘門 notifyAdmin_()，同一週只通知一次）。
 *   ・〔整季重設〕執行之前先備份一次；備份失敗 ⇒ 不重設，並說明原因。
 *   ・〔自動排程狀態〕顯示最近一次備份的日期及結果（Script Properties `LAST_SPREADSHEET_BACKUP`）。
 */

/** 檔名開頭（清理只認這個開頭）。 */
const BACKUP_FILE_PREFIX = '職事表主試算表備份_';
/** 預設資料夾名稱（BACKUP_FOLDER_ID 空白時，在 ROSTER_DRIVE_FOLDER_ID 之下）。 */
const BACKUP_DEFAULT_FOLDER_NAME = '備份';
/** Script Properties：最近一次備份。 */
const BACKUP_LAST_PROP_KEY = 'LAST_SPREADSHEET_BACKUP';
/** xlsx 小於這個大小當作匯出失敗。 */
const BACKUP_MIN_BYTES = 2000;

/**
 * 日期字串的星期幾（1＝星期一 … 7＝星期日）。**純函式。**
 * @param {string} dateStr yyyy-MM-dd
 * @returns {number}
 */
function isoWeekdayOf_(dateStr) {
  const d = new Date(Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10))));
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * 今日要不要備份。**純函式。**
 * 這一週＝由最近一個 BACKUP_WEEKDAY（今日或之前）開始的 7 日；這一週還沒有成功的備份 ⇒ 要。
 * @param {string} today yyyy-MM-dd
 * @param {number} backupWeekday 1–7
 * @param {string} lastOkDate 最近一次成功備份的日期（沒有 ⇒ ''）
 * @returns {{due: boolean, weekStart: string}}
 */
function isBackupDue_(today, backupWeekday, lastOkDate) {
  const wd = Math.min(7, Math.max(1, Math.round(Number(backupWeekday) || 1)));
  const back = (isoWeekdayOf_(today) - wd + 7) % 7;
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10))) - back * 86400000;
  const weekStart = new Date(t).toISOString().slice(0, 10);
  return { due: !lastOkDate || lastOkDate < weekStart, weekStart: weekStart };
}

/** @param {string} dateStr yyyy-MM-dd @returns {string} */
function backupFileName_(dateStr) {
  return BACKUP_FILE_PREFIX + dateStr + '.xlsx';
}

/**
 * 要移到垃圾桶的舊備份。**純函式。**只認「職事表主試算表備份_yyyy-MM-dd.xlsx」，其他檔案一律不列。
 * @param {Array<{id: string, name: string}>} files 資料夾內的檔案
 * @param {number} keepCount 保留幾份
 * @returns {Array<{id: string, name: string}>}
 */
function planBackupPrune_(files, keepCount) {
  const keep = Math.max(1, Math.round(Number(keepCount) || 1));
  const re = /^職事表主試算表備份_\d{4}-\d{2}-\d{2}\.xlsx$/;
  const ours = (files || []).filter(function (f) { return re.test(String(f.name || '')); })
    .sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });
  return ours.slice(keep);
}

/** @returns {?{date: string, at: string, ok: boolean, fileName: string, sizeBytes: number, reason: string, error: string, failNotifiedWeek: string}} */
function readLastBackup_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(BACKUP_LAST_PROP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/** @param {Object} rec @returns {void} */
function writeLastBackup_(rec) {
  try {
    PropertiesService.getScriptProperties().setProperty(BACKUP_LAST_PROP_KEY, JSON.stringify(rec));
  } catch (err) {
    log_('WARN', '記不到最近一次備份：' + err.message);
  }
}

/**
 * 備份資料夾（一定在 Shared Drive）。
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function resolveBackupFolder_() {
  const id = String(getConfig_(CONFIG_KEYS.BACKUP_FOLDER_ID, DEFAULTS.BACKUP_FOLDER_ID) || '').trim();
  const folder = id ? DriveApp.getFolderById(id) : findOrCreateChildFolder_(resolveMailAttachmentFolder_(), BACKUP_DEFAULT_FOLDER_NAME);
  if (isPersonalMyDriveFolder_(folder)) {
    throw new Error('備份資料夾不在 Shared Drive（在個人的 My Drive）。備份有個人資料，不可以放在 My Drive——'
      + '請在 Config BACKUP_FOLDER_ID 填 Shared Drive 內的資料夾，或者留空（用職事表資料夾之下的「備份」）。');
  }
  return folder;
}

/**
 * 匯出主試算表成 xlsx 並存入備份資料夾，之後清理舊備份。失敗 ⇒ 拋錯（呼叫端決定怎樣處理）。
 * @param {string} reason 'WEEKLY' | 'BEFORE_RESET' | 'MANUAL'
 * @returns {{fileName: string, sizeBytes: number, pruned: number}}
 */
function runSpreadsheetBackup_(reason) {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const folder = resolveBackupFolder_();
  const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
  const res = fetchWithRetry_(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }, BACKUP_MIN_BYTES);
  if (res.responseCode !== 200 || res.blobTooSmall) {
    throw new Error('匯出 xlsx 失敗（HTTP ' + res.responseCode + (res.blobTooSmall ? '，檔案太小' : '') + '，已重試 ' + res.retries + ' 次）');
  }
  const name = backupFileName_(today);
  // 同一日再備份（例如重設之前）⇒ 先把同名的舊檔移到垃圾桶（只限本程式的檔名）
  const same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);
  const blob = res.blob.setName(name);
  const file = folder.createFile(blob);
  const sizeBytes = file.getSize();
  const all = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); all.push({ id: f.getId(), name: f.getName() }); }
  const prune = planBackupPrune_(all, getConfig_(CONFIG_KEYS.BACKUP_KEEP_COUNT, DEFAULTS.BACKUP_KEEP_COUNT));
  prune.forEach(function (f) { DriveApp.getFileById(f.id).setTrashed(true); });
  const prev = readLastBackup_() || {};
  writeLastBackup_({ date: today, at: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm'), ok: true, fileName: name,
    sizeBytes: sizeBytes, reason: reason, error: '', lastOkDate: today, failNotifiedWeek: prev.failNotifiedWeek || '' });
  writeAuditLog_({ action: 'SPREADSHEET_BACKUP', targetSheet: '', targetKey: name, newValue: Math.round(sizeBytes / 1024) + ' KB',
    source: 'runSpreadsheetBackup_', notes: '原因：' + reason + '；清理舊備份 ' + prune.length + ' 份（只限「' + BACKUP_FILE_PREFIX + '」開頭的檔）' });
  return { fileName: name, sizeBytes: sizeBytes, pruned: prune.length };
}

/**
 * 每日自動排程的一步。出錯只影響這一步（回傳報告一行，不拋錯）。
 * @param {string} today yyyy-MM-dd
 * @param {boolean} isDryRun 通知用（經 notifyAdmin_() 的寄信閘門）
 * @returns {{quarterId: string, action: string, outcome: string, detail: string}}
 */
function dailyBackupStep_(today, isDryRun) {
  const row = { quarterId: '', action: 'BACKUP' };
  const enabled = getConfig_(CONFIG_KEYS.BACKUP_ENABLED, DEFAULTS.BACKUP_ENABLED);
  if (!(enabled === true || String(enabled).toUpperCase() === 'TRUE')) {
    return Object.assign(row, { outcome: 'SKIPPED_DISABLED', detail: 'BACKUP_ENABLED 關掉' });
  }
  const last = readLastBackup_() || {};
  const due = isBackupDue_(today, getConfig_(CONFIG_KEYS.BACKUP_WEEKDAY, DEFAULTS.BACKUP_WEEKDAY), last.lastOkDate || '');
  if (!due.due) return Object.assign(row, { outcome: 'SKIPPED_NOT_DUE', detail: '這一週（' + due.weekStart + ' 起）已經備份過' });
  try {
    const r = runSpreadsheetBackup_('WEEKLY');
    return Object.assign(row, { outcome: 'DONE', detail: '已備份 ' + r.fileName + '（' + Math.round(r.sizeBytes / 1024) + ' KB）' });
  } catch (err) {
    const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const notifyThisWeek = last.failNotifiedWeek !== due.weekStart;
    writeLastBackup_(Object.assign({}, last, { date: today, at: Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd HH:mm'), ok: false,
      reason: 'WEEKLY', error: err.message, failNotifiedWeek: notifyThisWeek ? due.weekStart : (last.failNotifiedWeek || '') }));
    writeAuditLog_({ action: 'SPREADSHEET_BACKUP_ERROR', targetSheet: '', targetKey: today, newValue: '失敗', source: 'dailyBackupStep_', notes: err.message });
    if (notifyThisWeek) {
      try {
        const config = readConfig_();
        notifyAdmin_(String(config[CONFIG_KEYS.MAIL_SUBJECT_PREFIX] || '') + '職事表系統：每週備份失敗',
          '每日自動排程今日（' + today + '）備份主試算表失敗：\n\n' + err.message
            + '\n\n其餘每日檢查照常執行。系統會在這一週之內每日再試；這一週不會再通知。\n'
            + '請到幹事介面「進階與診斷」〔自動排程狀態〕看「最近一次備份」。',
          String(config[CONFIG_KEYS.MAIL_ADMIN_NOTIFY] || ''), isDryRun);
      } catch (e) {
        log_('WARN', '每週備份失敗通知寄不出：' + e.message);
      }
    }
    return Object.assign(row, { outcome: 'ERROR', detail: '備份失敗：' + err.message });
  }
}

/**
 * 〔整季重設〕之前先備份。失敗 ⇒ 拋三段式錯誤（不重設）。
 * @returns {{fileName: string, sizeBytes: number}}
 */
function backupBeforeQuarterReset_() {
  try {
    return runSpreadsheetBackup_('BEFORE_RESET');
  } catch (err) {
    throw new Error(buildThreePartMessage_(
      '整季重設之前要先備份主試算表，但備份失敗：' + err.message,
      '沒有清除任何東西。',
      ['稍後再試一次', '如果一直失敗，看「進階與診斷」〔自動排程狀態〕的「最近一次備份」，或把這段文字交給開發者']));
  }
}

/**
 * 〔自動排程狀態〕那一行。**純函式。**
 * @param {?Object} last readLastBackup_()
 * @returns {string}
 */
function describeLastBackup_(last) {
  if (!last || !last.date) return '還沒有紀錄';
  if (last.ok) return last.at + '　✔ ' + last.fileName + '（' + Math.round(Number(last.sizeBytes || 0) / 1024) + ' KB）';
  return last.at + '　✘ 失敗：' + String(last.error || '').slice(0, 200) + (last.lastOkDate ? '（最近一次成功：' + last.lastOkDate + '）' : '');
}
