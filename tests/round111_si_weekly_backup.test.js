// 第一百一十一輪批次 SI 組：每週備份主試算表
// 執行方式：node tests/round111_si_weekly_backup.test.js
// 下面用假 ID、example.invalid、2099 年的日期。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'WebAppGuards.gs', 'SpreadsheetBackup.gs']);

console.log('\n=== SI1：星期幾、每週一次 ===');
{
  check('★★★★★ 星期幾（2099-01-05 是星期一）', gas.isoWeekdayOf_('2099-01-05') === 1 && gas.isoWeekdayOf_('2099-01-04') === 7 && gas.isoWeekdayOf_('2099-01-10') === 6);
  check('★★★★★★ 到了備份日、這一週未備份 ⇒ 要', gas.isBackupDue_('2099-01-05', 1, '2098-12-29').due === true);
  check('★★★★★★ 同一週已備份 ⇒ 不用', gas.isBackupDue_('2099-01-07', 1, '2099-01-05').due === false);
  check('★★★★★★ 備份日沒有執行 ⇒ 同一週之內補做（星期三）', gas.isBackupDue_('2099-01-07', 1, '2098-12-29').due === true
    && gas.isBackupDue_('2099-01-07', 1, '2098-12-29').weekStart === '2099-01-05');
  check('★★★★★ 未到備份日（星期日；這一週由上星期一起，已備份）⇒ 不用', gas.isBackupDue_('2099-01-04', 1, '2098-12-29').due === false);
  check('★★★★ 從來沒有備份 ⇒ 要', gas.isBackupDue_('2099-01-04', 1, '').due === true);
  check('★★★★ BACKUP_WEEKDAY＝3（星期三）', gas.isBackupDue_('2099-01-06', 3, '2098-12-31').due === false && gas.isBackupDue_('2099-01-07', 3, '2098-12-31').due === true);
}

console.log('\n=== SI2：保留份數（只清理本程式的檔名） ===');
{
  const files = [];
  for (let d = 1; d <= 10; d++) files.push({ id: 'f' + d, name: '職事表主試算表備份_2099-01-' + String(d).padStart(2, '0') + '.xlsx' });
  files.push({ id: 'x1', name: '其他人放的檔.xlsx' }, { id: 'x2', name: '職事表主試算表備份_手動.xlsx' }, { id: 'x3', name: 'Copy of 職事表主試算表備份_2098-01-01.xlsx' });
  const prune = gas.planBackupPrune_(files, 8);
  check('★★★★★★ 保留最新 8 份，移走最舊 2 份', prune.map((f) => f.id).join() === 'f2,f1', prune.map((f) => f.id).join());
  check('★★★★★★ 資料夾內其他檔案（名稱不符規則）一律不碰', prune.every((f) => /^f/.test(f.id)));
  check('★★★★ 檔名', gas.backupFileName_('2099-01-05') === '職事表主試算表備份_2099-01-05.xlsx');
}

// ── 模擬 Drive／UrlFetch ──
let PROPS = {};
let FILES = [];
let TRASHED = [];
let AUDIT = [];
let MAILS = [];
let fetchCode = 200;
let fetchedUrl = '';
let myDrive = false;
function setup() {
  PROPS = {}; FILES = [{ id: 'old1', name: '職事表主試算表備份_2098-01-01.xlsx' }, { id: 'keep', name: '人手筆記.docx' }]; TRASHED = []; AUDIT = []; MAILS = [];
  fetchCode = 200; fetchedUrl = ''; myDrive = false;
  const fileObj = (f) => ({ getId: () => f.id, getName: () => f.name, getSize: () => 123456, setTrashed: () => { TRASHED.push(f.id); FILES = FILES.filter((x) => x !== f); } });
  const folder = {
    getFilesByName: (n) => { const l = FILES.filter((f) => f.name === n).map(fileObj); return { hasNext: () => l.length > 0, next: () => l.shift() }; },
    getFiles: () => { const l = FILES.map(fileObj); return { hasNext: () => l.length > 0, next: () => l.shift() }; },
    createFile: (blob) => { const f = { id: 'new' + FILES.length, name: blob.name }; FILES.push(f); return fileObj(f); }
  };
  gas.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; } }) };
  gas.getConfig_ = (k, d) => ({ BACKUP_KEEP_COUNT: 1, BACKUP_WEEKDAY: 1, BACKUP_ENABLED: true }[k] !== undefined ? { BACKUP_KEEP_COUNT: 1, BACKUP_WEEKDAY: 1, BACKUP_ENABLED: true }[k] : d);
  gas.Utilities = { formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd' ? '2099-01-05' : '2099-01-05 09:30') };
  gas.resolveMailAttachmentFolder_ = () => ({ root: true });
  gas.findOrCreateChildFolder_ = (parent, name) => { folder.createdName = name; return folder; };
  gas.isPersonalMyDriveFolder_ = () => myDrive;
  gas.DriveApp = { getFolderById: () => folder, getFileById: (id) => fileObj(FILES.find((f) => f.id === id)) };
  gas.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'SSID', makeCopy: () => { throw new Error('不可以用 makeCopy'); } }) };
  gas.ScriptApp = { getOAuthToken: () => 'tok' };
  gas.fetchWithRetry_ = (url) => { fetchedUrl = url; return { responseCode: fetchCode, retries: 0, blobTooSmall: false, blob: { name: '', setName(n) { this.name = n; return this; } } }; };
  gas.writeAuditLog_ = (e) => AUDIT.push(e);
  gas.log_ = () => {};
  gas.readConfig_ = () => ({ MAIL_ADMIN_NOTIFY: 'dev@example.invalid', MAIL_SUBJECT_PREFIX: '[測試] ' });
  gas.notifyAdmin_ = (s, b, to, dry) => MAILS.push({ s, b, to, dry });
  return folder;
}

console.log('\n=== SI3：備份本身 ===');
{
  const folder = setup();
  const r = gas.runSpreadsheetBackup_('WEEKLY');
  check('★★★★★★ 用匯出 xlsx（UrlFetchApp），不用 makeCopy', /\/export\?format=xlsx$/.test(fetchedUrl) && !/\.makeCopy\(/.test(read('src/SpreadsheetBackup.gs')));
  check('★★★★★★ 存到 ROSTER_DRIVE_FOLDER_ID 之下的「備份」；檔名按日期', folder.createdName === '備份' && r.fileName === '職事表主試算表備份_2099-01-05.xlsx');
  check('★★★★★★ 保留份數＝1 ⇒ 舊備份移到垃圾桶；其他檔案不碰', TRASHED.join() === 'old1' && FILES.some((f) => f.id === 'keep'), TRASHED.join());
  const last = JSON.parse(PROPS.LAST_SPREADSHEET_BACKUP);
  check('★★★★★ 記下最近一次備份（〔自動排程狀態〕顯示）', last.ok && last.lastOkDate === '2099-01-05' && /✔ 職事表主試算表備份_2099-01-05\.xlsx（121 KB）/.test(gas.describeLastBackup_(last)));
  check('★★★★ AuditLog 寫檔名及大小', AUDIT[0].action === 'SPREADSHEET_BACKUP' && AUDIT[0].newValue === '121 KB');
  setup();
  myDrive = true;
  let msg = '';
  try { gas.runSpreadsheetBackup_('WEEKLY'); } catch (e) { msg = e.message; }
  check('★★★★★★ 資料夾在 My Drive ⇒ 拒絕寫入（備份有個人資料）', /不在 Shared Drive/.test(msg) && FILES.length === 2, msg);
}

console.log('\n=== SI4：每日排程的一步——失敗不影響其他步驟，通知一次 ===');
{
  setup();
  let row = gas.dailyBackupStep_('2099-01-05', true);
  check('★★★★★★ 到期 ⇒ 備份，回傳報告一行', row.action === 'BACKUP' && row.outcome === 'DONE', JSON.stringify(row));
  row = gas.dailyBackupStep_('2099-01-06', true);
  check('★★★★★ 同一週再執行 ⇒ 不用', row.outcome === 'SKIPPED_NOT_DUE');
  setup();
  fetchCode = 500;
  row = gas.dailyBackupStep_('2099-01-05', true);
  check('★★★★★★ 失敗 ⇒ 不拋錯，回 ERROR', row.outcome === 'ERROR' && /HTTP 500/.test(row.detail), JSON.stringify(row));
  check('★★★★★★ 失敗通知幹事一次（經 notifyAdmin_，跟 DRY_RUN）', MAILS.length === 1 && MAILS[0].to === 'dev@example.invalid' && MAILS[0].dry === true && /每週備份失敗/.test(MAILS[0].s));
  gas.dailyBackupStep_('2099-01-06', true);
  check('★★★★★★ 同一週再失敗 ⇒ 不再通知', MAILS.length === 1);
  check('★★★★★ 失敗寫 AuditLog、記下錯誤', AUDIT.some((a) => a.action === 'SPREADSHEET_BACKUP_ERROR') && /✘ 失敗/.test(gas.describeLastBackup_(JSON.parse(PROPS.LAST_SPREADSHEET_BACKUP))));
  setup();
  gas.getConfig_ = (k, d) => (k === 'BACKUP_ENABLED' ? false : d);
  check('★★★★★ BACKUP_ENABLED＝FALSE ⇒ 不備份', gas.dailyBackupStep_('2099-01-05', true).outcome === 'SKIPPED_DISABLED' && fetchedUrl === '');
}

console.log('\n=== SI5：整季重設之前先備份 ===');
{
  setup();
  check('★★★★★★ 成功 ⇒ 回傳檔名', gas.backupBeforeQuarterReset_().fileName === '職事表主試算表備份_2099-01-05.xlsx');
  setup();
  fetchCode = 403;
  let msg = '';
  try { gas.backupBeforeQuarterReset_(); } catch (e) { msg = e.message; }
  check('★★★★★★ 失敗 ⇒ 拋三段式錯誤：沒有清除任何東西', /備份失敗/.test(msg) && /沒有清除任何東西/.test(msg), msg);
  const qr = read('src/QuarterReset.gs').replace(/\r\n/g, '\n');
  check('★★★★★★ executeQuarterResetBatch_() 在逐季刪除之前備份（失敗就拋錯，一季都不重設）',
    /function executeQuarterResetBatch_\(entries\) \{\n  const results = \[\];\n  const failedQuarters = \[\];\n[^\n]*\n  if \(\(entries \|\| \[\]\)\.length > 0 && typeof backupBeforeQuarterReset_ === 'function'\) backupBeforeQuarterReset_\(\);/.test(qr));
}

console.log('\n=== SI6：接線、設定 ===');
{
  const tr = read('src/Trigger.gs');
  check('★★★★★ 每日自動排程加一步（自己 try/catch）', /report\.push\(dailyBackupStep_\(today, isDryRun\)\);/.test(tr));
  check('★★★★★ 〔自動排程狀態〕顯示最近一次備份', /lastBackupText: typeof describeLastBackup_ === 'function'/.test(read('src/AdminTools.gs'))
    && /z5Line\('最近一次備份', s\.lastBackupText/.test(read('src/ui/ScriptZone5.html')));
  check('★★★★★ Config 四個鍵：預設 TRUE、1、8、空白', gas.DEFAULTS.BACKUP_ENABLED === true && gas.DEFAULTS.BACKUP_WEEKDAY === 1
    && gas.DEFAULTS.BACKUP_KEEP_COUNT === 8 && gas.DEFAULTS.BACKUP_FOLDER_ID === '');
  const seed = read('src/ConfigSeed.gs');
  check('★★★★ 四個鍵都有種子及說明', ['BACKUP_ENABLED', 'BACKUP_WEEKDAY', 'BACKUP_KEEP_COUNT', 'BACKUP_FOLDER_ID'].every((k) => seed.indexOf('CONFIG_KEYS.' + k + ',') !== -1));
  check('★★★★★ 不改任何分享設定', !/setSharing|addEditor|addViewer|setAccess/.test(read('src/SpreadsheetBackup.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
