// 第六十七輪批次 AJ 組：系統出問題時，在 Drive 找到最新版自己繼續。
// 執行方式：node tests/editable_copy.test.js
//
// 守住：
//   AJ1　`apiCreateEditableRosterCopy()`：檔名 `<季度>_第<N>版_職事表_可編輯副本_<yyyyMMdd-HHmm>`、
//   　　　放入 `<季度>/可編輯副本/`、原表一格都唔動、新檔只剩一張表、完成訊息講明「快照」
//   AJ2　正式發出成功之後自動做一份；**做唔到唔會令寄出失敗**，Stage 照前進，完成窗有一句
//   AJ3　`apiGetRecoveryLinks()`：三個位置嘅連結由程式讀出；冇就講冇、唔建資料夾
//   AJ4　畫面：（第七十五輪 CK 組起）副本入口喺「系統出問題時怎樣做」、區四多一個入口、唯讀白名單有 `apiGetRecoveryLinks`；
//   　　　公開文件存在而且冇網址／電郵／ID
//
// Drive／試算表全部用替身——呢組要驗嘅係「系統叫 Drive 做咩」，唔係 Drive 本身。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const Q = '2099T1';
const V = 3;
const TZ = 'Pacific/Auckland';

/* ── Drive 替身：資料夾樹 ─────────────────────────────────────── */
function fakeFolder(name, id) {
  const folders = [];
  const files = [];
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const f = {
    _name: name, _folders: folders, _files: files,
    getName: () => name,
    getId: () => id || ('folder-' + name),
    getUrl: () => 'https://drive.invalid/folder/' + (id || name),
    getOwner: () => null,   // Shared Drive
    getFoldersByName: (n) => iter(folders.filter((x) => x._name === n)),
    getFolders: () => iter(folders.slice()),
    getFiles: () => iter(files.slice()),
    getFilesByName: (n) => iter(files.filter((x) => getNameOf(x) === n)),
    createFolder: (n) => { const c = fakeFolder(n); folders.push(c); c._created = true; return c; }
  };
  return f;
}
function getNameOf(file) { return file.getName(); }
function fakeFile(name, id) {
  let parent = null;
  return {
    getName: () => name, getId: () => id, getUrl: () => 'https://drive.invalid/file/' + id,
    moveTo: function (folder) { parent = folder; folder._files.push(this); return this; },
    _parent: () => parent
  };
}

/* ── 試算表替身 ──────────────────────────────────────────────── */
function fakeSheet(name, sheetId) {
  const log = [];
  const s = {
    _log: log, _name: name,
    getName: () => s._name,
    getSheetId: () => sheetId,
    setName: function (n) { log.push('setName:' + n); s._name = n; return s; },
    hideRows: function (r) { log.push('hideRows:' + r); return s; },
    copyTo: function (target) {
      log.push('copyTo:' + target.getId());
      const c = fakeSheet('Copy of ' + name, sheetId + 1000);
      target._sheets.push(c);
      return c;
    }
  };
  return s;
}
function fakeNewSpreadsheet(name, id) {
  const ss = {
    _sheets: [fakeSheet('工作表1', 1)],
    getId: () => id, getUrl: () => 'https://docs.invalid/spreadsheets/' + id, getName: () => name,
    getSheets: function () { return ss._sheets.slice(); },
    deleteSheet: function (sh) { ss._sheets = ss._sheets.filter((x) => x !== sh); }
  };
  return ss;
}

function setup(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'MutationLock.gs',
    'WebAppGuards.gs', 'PdfFolders.gs', 'EditableCopy.gs'
  ]);
  const world = { audit: [], created: [], moved: [], logs: [] };
  const root = fakeFolder('PDF根', 'root');
  const source = fakeSheet('Roster_' + Q + '_v' + V, 77);
  const active = {
    getId: () => 'active-ss', getName: () => '系統',
    getSheetByName: (n) => (n === source._name ? source : null)
  };
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.findLatestVersionNo = function () { return opts && opts.noVersion ? -1 : V; };
  gas.getConfig = function (k, d) { return k === gas.CONFIG_KEYS.SYS_TIMEZONE ? TZ : d; };
  gas.buildRosterSheetName_ = function (q, v) { return 'Roster_' + q + '_v' + v; };
  gas.writeAuditLog_ = function (e) { world.audit.push(e); };
  gas.log_ = function (level, msg) { world.logs.push(level + ' ' + msg); };
  gas.resolveMailAttachmentFolder_ = function () {
    if (opts && opts.driveBroken) throw new Error('Config 的 ROSTER_DRIVE_FOLDER_ID 未設定');
    return root;
  };
  gas.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  gas.Utilities = {
    formatDate: function (date, tz, fmt) {
      if (fmt === gas.EDITABLE_COPY_TIMESTAMP_FORMAT) return '20991231-0900';
      return '2099-12-31';
    },
    sleep: function () {}
  };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: () => active,
    create: function (name) { const ss = fakeNewSpreadsheet(name, 'new-' + (world.created.length + 1)); world.created.push(ss); return ss; }
  };
  gas.DriveApp = {
    getFileById: function (id) {
      const ss = world.created.filter((x) => x.getId() === id)[0];
      const f = fakeFile(ss ? ss.getName() : id, id);
      const origMove = f.moveTo;
      f.moveTo = function (folder) { world.moved.push({ id: id, folder: folder._name }); return origMove.call(f, folder); };
      return f;
    }
  };
  // withMutationLock_ 用 CacheService／LockService——簡化
  gas.withMutationLock_ = function (label, fn) { return fn(); };
  return { gas: gas, world: world, root: root, source: source };
}

console.log('\n=== AJ1【核心】可編輯副本：檔名、位置、原表唔動 ===');
{
  const s = setup();
  const r = s.gas.apiCreateEditableRosterCopy(Q);
  checkEqual('★★★★★★ 檔名 `<季度>_第<N>版_職事表_可編輯副本_<yyyyMMdd-HHmm>`',
    r.fileName, Q + '_第3版_職事表_可編輯副本_20991231-0900');
  const qf = s.root._folders.filter((f) => f._name === Q)[0];
  const cf = qf && qf._folders.filter((f) => f._name === s.gas.EDITABLE_COPY_FOLDER_NAME)[0];
  check('★★★★★★ 放入 `<季度>/可編輯副本/`', !!cf && cf._files.length === 1 && cf._files[0].getName() === r.fileName,
    JSON.stringify(s.world.moved));
  check('★★★★★ 原本嗰張 grid 工作表一格都冇動（只被 copyTo）',
    s.source._log.length === 1 && /^copyTo:/.test(s.source._log[0]) && s.source._name === 'Roster_' + Q + '_v' + V,
    JSON.stringify(s.source._log));
  const created = s.world.created[0];
  check('★★★★★ 新檔只剩一張表，而且名叫原本嗰個工作表名',
    created._sheets.length === 1 && created._sheets[0]._name === 'Roster_' + Q + '_v' + V,
    JSON.stringify(created._sheets.map((x) => x._name)));
  check('★★★★ 第 2 行機器鍵照樣隱藏', created._sheets[0]._log.indexOf('hideRows:2') !== -1);
  check('★★★★★ 完成訊息講明係快照、之後改動唔會更新', /快照/.test(r.message) && /不會跟著變/.test(r.message), r.message);
  check('★★★★ 有連結同資料夾連結', /new-1/.test(r.fileUrl) && /folder/.test(r.folderUrl));
  check('★★★★ 寫 AuditLog `EDITABLE_COPY_CREATED`', s.world.audit.some((e) => e.action === 'EDITABLE_COPY_CREATED'));
  check('★★★★ 再做一次用返同一個資料夾（唔會建第二個同名）', (function () {
    s.gas.apiCreateEditableRosterCopy(Q);
    return qf._folders.filter((f) => f._name === s.gas.EDITABLE_COPY_FOLDER_NAME).length === 1 && cf._files.length === 2;
  })());

  const none = setup({ noVersion: true });
  let threw = null;
  try { none.gas.apiCreateEditableRosterCopy(Q); } catch (e) { threw = e; }
  check('★★★★ 冇版本 ⇒ 講清楚，唔會建檔', threw && /還沒有生成過/.test(threw.message) && none.world.created.length === 0);
}

console.log('\n=== AJ2【核心】正式發出成功之後自動做副本；做唔到唔影響寄出 ===');
{
  const run = function (driveBroken) {
    const gas = loadGasSource([
      'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'MutationLock.gs',
      'WebAppGuards.gs', 'PdfFolders.gs', 'EditableCopy.gs', 'FiveStageCore.gs', 'WebAppFlow.gs'
    ]);
    const world = { advanced: [], logs: [], created: [] };
    const root = fakeFolder('PDF根', 'root');
    const source = fakeSheet('Roster_' + Q + '_v' + V, 77);
    gas.assertWebAppRequestAllowed_ = function () {};
    gas.withMutationLock_ = function (label, fn) { return fn(); };
    gas.assertNeverOfficiallySent_ = function () {};
    gas.assertNoUnsavedChanges_ = function () { return { released: false }; };
    gas.logSendWithUnsavedRelease_ = function () {};
    gas.requireQuarterStage_ = function () {};
    gas.findLatestVersionNo = function () { return V; };
    gas.checkMissingPersonalPdfs_ = function () { return { missing: [], total: 0 }; };
    gas.evaluateStep4MissingPdfGate_ = function () { return { blocked: false }; };
    gas.ensurePublicLinkFreshBeforeSend_ = function () { return { republished: false }; };
    gas.sendStage = function () { return { isDryRun: true, sent: 0, dryRun: 5, skipped: 0, unchanged: 0, failed: 0, errorPdf: 0, errorPdfMissing: 0 }; };
    gas.evaluateStep4SendOutcome_ = function () { return { ok: true, message: '', unhandledCount: 0 }; };
    gas.countOfficialReach_ = function () { return null; };
    gas.buildStep4OutcomeSentence_ = function () { return '寄了。'; };
    gas.advanceQuarterStage_ = function (q, st) { world.advanced.push(st); };
    gas.getConfig = function (k, d) { return k === gas.CONFIG_KEYS.SYS_TIMEZONE ? TZ : d; };
    gas.buildRosterSheetName_ = function (q, v) { return 'Roster_' + q + '_v' + v; };
    gas.writeAuditLog_ = function () {};
    gas.log_ = function (level, msg) { world.logs.push(level + ' ' + msg); };
    gas.resolveMailAttachmentFolder_ = function () {
      if (driveBroken) throw new Error('Drive 壞了');
      return root;
    };
    gas.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
    gas.Utilities = { formatDate: () => '20991231-0900', sleep: () => {} };
    gas.SpreadsheetApp = {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === source._name ? source : null) }),
      create: function (name) { const ss = fakeNewSpreadsheet(name, 'new-1'); world.created.push(ss); return ss; }
    };
    gas.DriveApp = { getFileById: (id) => fakeFile('x', id) };
    return { result: gas.apiStep4Confirm(Q, {}), world: world };
  };

  const bad = run(true);
  check('★★★★★★ Drive 壞咗 ⇒ 寄出照樣成功、Stage 照前進',
    bad.result.advanced === true && bad.world.advanced[0] === 'OFFICIAL_SENT', JSON.stringify(bad.result).slice(0, 300));
  check('★★★★★★ 完成窗有一句講做唔到副本（寄出不受影響）',
    bad.result.editableCopy && bad.result.editableCopy.ok === false && /寄出不受影響/.test(bad.result.editableCopy.message),
    JSON.stringify(bad.result.editableCopy));
  check('★★★★ 原因入執行記錄', bad.world.logs.some((l) => /自動建立可編輯副本失敗/.test(l)), bad.world.logs.join('|'));

  const good = run(false);
  check('★★★★★★ Drive 正常 ⇒ 自動做咗一份，完成窗有連結',
    good.result.editableCopy && good.result.editableCopy.ok === true && /new-1/.test(good.result.editableCopy.fileUrl)
    && good.world.created.length === 1, JSON.stringify(good.result.editableCopy));
}

console.log('\n=== AJ3【核心】三個位置嘅連結由程式讀出 ===');
{
  const s = setup();
  s.gas.findPublicLinkRow_ = function () { return { fileUrl: 'https://docs.invalid/public/abc' }; };
  // 空嘅 Drive：講冇，唔建資料夾
  const empty = s.gas.apiGetRecoveryLinks(Q);
  check('★★★★★ 公開連結由 PublicLinks 讀出', empty.publicLink.url === 'https://docs.invalid/public/abc');
  check('★★★★★ 冇 PDF／冇副本 ⇒ 講冇（唔係空白）', /還沒有/.test(empty.fullPdf.note) && /還沒有做過/.test(empty.editableCopy.note),
    JSON.stringify(empty));
  checkEqual('★★★★★★ 唯讀：一個資料夾都冇建', s.root._folders.length, 0);
  check('★★★★ 帶公開文件檔名', empty.guideDoc === 'docs/系統出問題時手動繼續.md', empty.guideDoc);

  // 有嘢：v3 完整版 PDF ＋ 兩份副本
  const qf = s.root.createFolder(Q);
  const vf = qf.createFolder('v' + V);
  s.gas.buildAttachmentName_ = function (q, v, label) { return q + '_v' + v + '_' + label + '.pdf'; };
  vf._files.push(fakeFile(Q + '_v3_完整版.pdf', 'pdf-full'));
  const cf = qf.createFolder(s.gas.EDITABLE_COPY_FOLDER_NAME);
  cf._files.push(fakeFile(Q + '_第2版_職事表_可編輯副本_20991130-1000', 'copy-old'));
  cf._files.push(fakeFile(Q + '_第3版_職事表_可編輯副本_20991231-0900', 'copy-new'));
  const r = s.gas.apiGetRecoveryLinks(Q);
  check('★★★★★★ 完整版 PDF 連結係最新一版嗰份', /pdf-full/.test(r.fullPdf.url), JSON.stringify(r.fullPdf));
  check('★★★★★★ 可編輯副本連結係時間戳最新嗰份', /copy-new/.test(r.editableCopy.url) && /folder/.test(r.editableCopy.folderUrl),
    JSON.stringify(r.editableCopy));
  check('★★★★ 副本一句講明係快照', /快照/.test(r.editableCopy.note), r.editableCopy.note);

  const broken = setup({ driveBroken: true });
  broken.gas.findPublicLinkRow_ = function () { return null; };
  const b = broken.gas.apiGetRecoveryLinks(Q);
  check('★★★★★ Drive 開唔到 ⇒ 唔冧，講原因', /開不到/.test(b.fullPdf.note) && /還沒有發佈/.test(b.publicLink.note), JSON.stringify(b));
}

console.log('\n=== AJ4【核心】畫面同文件 ===');
{
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const paper = read('src/ui/ScriptSendPaper.html');
  // ⚠️ 第七十五輪批次 CK 組（Ivan 決定）：入口由第 4 步搬去「系統出問題時怎樣做」彈窗嘅〔建立可編輯副本〕。
  check('★★★★★★ 第 4 步已經冇「可編輯的試算表副本（最新版本）」（第七十五輪 CK 組）', !/'EDITABLE_COPY'/.test(paper));
  check('★★★★★ 建立副本仍然叫 apiCreateEditableRosterCopy', /callServerMutating\('apiCreateEditableRosterCopy', currentQuarterId\)/.test(paper));
  const zone4 = read('src/ui/ScriptZone4.html');
  check('★★★★ 說明講明係快照（搬咗去區四）', /只是快照，之後系統再改動不會更新它/.test(zone4));
  check('★★★★★ 「系統出問題時怎樣做」有〔建立可編輯副本〕', /button\('建立可編輯副本', \(\) => runEditableCopy\(\)/.test(zone4));
  check('★★★★★★ 區四有「系統出問題時怎樣做」', /zone4Row\('系統出問題時怎樣做'/.test(zone4));
  check('★★★★★ 連結由 apiGetRecoveryLinks 讀出，唔寫死', /callServer\('apiGetRecoveryLinks', currentQuarterId\)/.test(zone4)
    && !/https?:\/\//.test(zone4.slice(zone4.indexOf('function openRecoveryHelp'), zone4.indexOf('function openRecoveryHelp') + 4000)));
  const script = read('src/ui/Script.html');
  check('★★★★★ 唯讀白名單有 apiGetRecoveryLinks', /'apiGetRecoveryLinks',/.test(script));
  const zone1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 正式發出完成窗處理 editableCopy（成功畀連結、失敗提一句）',
    /r\.editableCopy && r\.editableCopy\.ok/.test(zone1) && /r\.editableCopy && !r\.editableCopy\.ok/.test(zone1));

  // 完成窗真渲染一次（成功／失敗）
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const base = { isDryRun: true, sent: 0, dryRun: 3, skipped: 0, unchanged: 0, failed: 0, errorPdf: 0, errorPdfMissing: 0,
    advanced: true, outcomeSentence: '寄了。', outcomeMessage: '', unhandledCount: 0, publicLinkRepublished: false };
  ui.renderOfficialDone(Object.assign({}, base, { editableCopy: { ok: true, fileName: 'F1', fileUrl: 'https://x.invalid/1', folderUrl: '', message: '' } }));
  const okText = ui.document.getElementById('modalBody').textContent;
  check('★★★★★ 成功 ⇒「自動在 Drive 放了一份這一版的可編輯副本」＋連結', /可編輯副本（快照）/.test(okText) && /開啟可編輯副本（F1）/.test(okText), okText);
  ui.renderOfficialDone(Object.assign({}, base, { editableCopy: { ok: false, fileName: '', fileUrl: '', folderUrl: '', message: '這一次做不到自動副本（壞了）。寄出不受影響；要的話去第 4 步「下載及匯出」自己做一份。' } }));
  const badText = ui.document.getElementById('modalBody').textContent;
  check('★★★★★ 失敗 ⇒ 提一句，寄出不受影響', /做不到自動副本/.test(badText) && /寄出不受影響/.test(badText), badText);

  const doc = read('docs/系統出問題時手動繼續.md');
  check('★★★★★ 公開文件存在而且講齊三個位置同匯入', /公開連結試算表/.test(doc) && /完整版 PDF/.test(doc) && /可編輯/.test(doc) && /匯入/.test(doc));
  check('★★★★★★ 文件冇網址、電郵、試算表 ID', !/https?:\/\//.test(doc) && !/@/.test(doc) && !/[A-Za-z0-9_-]{30,}/.test(doc));
  check('★★★★ docs/README.md 有收錄', /系統出問題時手動繼續\.md/.test(read('docs/README.md')));
  check('★★★★ 常數喺 Constants.gs（唔寫死喺函式入面）', /const EDITABLE_COPY_FOLDER_NAME = '可編輯副本';/.test(read('src/Constants.gs'))
    && /const RECOVERY_GUIDE_DOC_NAME = 'docs\/系統出問題時手動繼續\.md';/.test(read('src/Constants.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
