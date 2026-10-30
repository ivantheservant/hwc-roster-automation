// 第七十輪批次 AW 組：「系統出問題時怎樣做」揀最新副本、重設季度清走副本和空資料夾、指南連結。
// 執行方式：node tests/recovery_and_reset_copies.test.js
//
// 現場（2026-10-21 截圖 s55、s58、s43）：
//   1. 重設 2028T3 再重新走一季之後，彈窗寫「最新一份：2028T3_第4版_…_20261021-1608」——
//      那是重設之前留下的舊副本；真正最新的是後來正式發出時自動建立的第 2 版副本（按版本號揀，唔係按建立時間）。
//   2. 重設季度沒有清走「可編輯副本」資料夾內的檔案；版本 PDF 移到垃圾桶之後，空資料夾仍然留著。
//   3. 彈窗寫「詳細步驟在 docs/…」——幹事打不開 repo。
// Drive 全部用替身，只驗「系統叫 Drive 做咩」。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const Q = '2099T1';

/* ── Drive 替身（有垃圾桶）──────────────────────────────────────── */
const byId = {};
function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
function fakeFile(name, id, createdMs, size) {
  const f = {
    _trashed: false,
    getName: () => name, getId: () => id, getSize: () => (size === undefined ? 1000 : size),
    getUrl: () => 'https://drive.invalid/file/' + id,
    getDateCreated: () => new Date(createdMs),
    setTrashed: function (v) { f._trashed = !!v; return f; }
  };
  byId[id] = f;
  return f;
}
function fakeFolder(name, id) {
  const folders = [];
  const files = [];
  const f = {
    _name: name, _folders: folders, _files: files, _trashed: false,
    getName: () => name, getId: () => id,
    getUrl: () => 'https://drive.invalid/folder/' + id,
    getOwner: () => null,
    getFoldersByName: (n) => iter(folders.filter((x) => x._name === n && !x._trashed)),
    getFolders: () => iter(folders.filter((x) => !x._trashed)),
    getFiles: () => iter(files.filter((x) => !x._trashed)),
    getFilesByName: (n) => iter(files.filter((x) => x.getName() === n && !x._trashed)),
    setTrashed: function (v) { f._trashed = !!v; return f; },
    addFolder: function (sub) { folders.push(sub); return sub; },
    addFile: function (file) { files.push(file); return file; }
  };
  byId[id] = f;
  return f;
}

/**
 * 2099T1 的 Drive：
 *   v3：兩個 PDF（要清）　　v5：空資料夾（要清）　　v6：一個 PDF ＋ 一個認不出名嘅檔案（唔係空）
 *   v7：Protected 版本嘅 PDF（唔清）　　可編輯副本：第 2 版（較新）、第 9 版（較舊，版本號大）、
 *   第 7 版（受保護版本）、一份認唔出版本嘅
 */
function buildDrive() {
  Object.keys(byId).forEach((k) => delete byId[k]);
  const root = fakeFolder('PDF根', 'root');
  const qf = root.addFolder(fakeFolder(Q, 'qf'));
  const v3 = qf.addFolder(fakeFolder('v3', 'v3'));
  v3.addFile(fakeFile(Q + '_v3_甲.pdf', 'pdf-a', 1));
  v3.addFile(fakeFile(Q + '_v3_乙.pdf', 'pdf-b', 1));
  qf.addFolder(fakeFolder('v5', 'v5'));
  const v6 = qf.addFolder(fakeFolder('v6', 'v6'));
  v6.addFile(fakeFile(Q + '_v6_丙.pdf', 'pdf-c', 1));
  v6.addFile(fakeFile('手動放入的筆記.txt', 'note', 1));
  const v7 = qf.addFolder(fakeFolder('v7', 'v7'));
  v7.addFile(fakeFile(Q + '_v7_丁.pdf', 'pdf-d', 1));
  // v8：受保護版本嘅**空**資料夾——版本過濾一定要擋住佢（唔係空就唔會被計，所以要空先驗到）
  qf.addFolder(fakeFolder('v8', 'v8'));
  // v4：版本冇登記（孤兒）嘅**空**資料夾——上一次重設之前留低嘅
  qf.addFolder(fakeFolder('v4', 'v4'));
  const cf = qf.addFolder(fakeFolder('可編輯副本', 'cf'));
  cf.addFile(fakeFile(Q + '_第9版_職事表_可編輯副本_20991201-0900', 'copy-old-big', 1000));
  cf.addFile(fakeFile(Q + '_第2版_職事表_可編輯副本_20991231-0900', 'copy-new', 2000));
  cf.addFile(fakeFile(Q + '_第7版_職事表_可編輯副本_20991220-0900', 'copy-v7', 1500));
  // 第 4 版：RosterVersions 冇登記過（孤兒）——就係 s55／s58 截圖時發現嗰份 1608 舊副本
  cf.addFile(fakeFile(Q + '_第4版_職事表_可編輯副本_20991201-1608', 'copy-orphan', 500));
  cf.addFile(fakeFile('不知哪一版.gsheet', 'copy-unknown', 1200));
  return { root: root, qf: qf, v3: v3, v5: v5Of(qf), v6: v6, v7: v7, cf: cf };
}
function v5Of(qf) { return qf._folders.filter((x) => x._name === 'v5')[0]; }

function load(extraStubs) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'MutationLock.gs',
    'WebAppGuards.gs', 'PdfFolders.gs', 'EditableCopy.gs', 'QuarterReset.gs', 'Menu.gs'
  ]);
  return gas;
}

// =====================================================================
console.log('\n=== AW1 最新一份可編輯副本：按建立時間，同一時間先比版本號 ===');
{
  const gas = load();
  const pick = (entries) => (gas.pickLatestEditableCopy_(entries) || {}).name;
  checkEqual('★★★★★★ 舊嘅版本號較大、但較早建立 ⇒ 揀較新建立嗰份',
    pick([{ name: Q + '_第4版_職事表_可編輯副本_20261021-1608', createdMs: 100 },
      { name: Q + '_第2版_職事表_可編輯副本_20261021-2056', createdMs: 200 }]),
    Q + '_第2版_職事表_可編輯副本_20261021-2056');
  checkEqual('★★★★★ 同一時間 ⇒ 比版本號（大嗰份）',
    pick([{ name: Q + '_第2版_x', createdMs: 100 }, { name: Q + '_第10版_x', createdMs: 100 }]), Q + '_第10版_x');
  checkEqual('★★★★ 同時間同版本 ⇒ 比檔名（時間戳大嗰份）',
    pick([{ name: Q + '_第2版_x_20261021-0900', createdMs: 100 }, { name: Q + '_第2版_x_20261021-1000', createdMs: 100 }]),
    Q + '_第2版_x_20261021-1000');
  check('★★★★ 空陣列 ⇒ null', gas.pickLatestEditableCopy_([]) === null);

  // 真正彈窗後端：副本資料夾內 第 9 版（舊）同 第 2 版（新）
  const d = buildDrive();
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.findLatestVersionNo_ = function () { return 3; };
  gas.resolveMailAttachmentFolder_ = function () { return d.root; };
  gas.findPublicLinkRow_ = function () { return null; };
  gas.buildAttachmentName_ = function (q, v, label) { return q + '_v' + v + '_' + label + '.pdf'; };
  gas.getConfig_ = function (_k, dflt) { return dflt; };
  const r = gas.apiGetRecoveryLinks(Q);
  check('★★★★★★ 「最新一份」是較新建立嗰份（第 2 版，2000），唔係版本號最大嗰份（第 9 版）',
    /copy-new/.test(r.editableCopy.url) && /第2版/.test(r.editableCopy.note), JSON.stringify(r.editableCopy));
}

// =====================================================================
console.log('\n=== AW2 重設季度：可編輯副本 ＋ 清理後變空嘅版本 PDF 資料夾一併清走 ===');
{
  const gas = load();
  const d = buildDrive();
  const C = gas.COLUMNS;
  const V = C.ROSTER_VERSIONS;
  const versionRow = (no, prot) => {
    const r = {};
    r[V.QUARTER_ID] = Q; r[V.VERSION_NO] = no; r[V.PROTECTED] = !!prot; r[V.SHEET_NAME] = 'Roster_' + Q + '_v' + no;
    return r;
  };
  gas.readSheet_ = function (name) {
    if (name === gas.SHEETS.ROSTER_VERSIONS) {
      return [versionRow(3), versionRow(5), versionRow(6), versionRow(7, true)];
    }
    return [];
  };
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } };
  gas.getConfig_ = function (_k, dflt) { return dflt; };
  gas.findQuarter_ = function () { return null; };
  gas.getQuarterStage_ = function () { return 'DRAFT'; };
  gas.resolveMailAttachmentFolder_ = function () { return d.root; };
  gas.buildRosterSheetName_ = function (q, v) { return 'Roster_' + q + '_v' + v; };

  const plan = gas.planQuarterReset_(Q, false);
  // 登記咗嘅版本係 3、5、6、7（7 受保護）。副本版本係 9、2（兩個都冇登記＝孤兒）、7（登記咗但受保護）、認不出。
  checkEqual('★★★★★★ 版本冇登記嘅孤兒副本（第 9、第 2、第 4 版）要清——例如上一次重設之前留低嘅副本',
    plan.editableCopyFiles.map((f) => f.name).sort(),
    [Q + '_第2版_職事表_可編輯副本_20991231-0900', Q + '_第4版_職事表_可編輯副本_20991201-1608',
      Q + '_第9版_職事表_可編輯副本_20991201-0900']);
  check('★★★★★ 登記咗但受保護（v7）、認不出版本嘅副本保留並列入「需要人手處理」',
    plan.manualAttention.filter((t) => /可編輯副本/.test(t)).length === 2,
    JSON.stringify(plan.manualAttention));
}
{
  const gas = load();
  const d = buildDrive();
  const C = gas.COLUMNS;
  const V = C.ROSTER_VERSIONS;
  const versionRow = (no, prot) => {
    const r = {};
    r[V.QUARTER_ID] = Q; r[V.VERSION_NO] = no; r[V.PROTECTED] = !!prot; r[V.SHEET_NAME] = 'Roster_' + Q + '_v' + no;
    return r;
  };
  // 版本 2、3、5、6、7、9 都登記，7 受保護
  gas.readSheet_ = function (name) {
    if (name === gas.SHEETS.ROSTER_VERSIONS) {
      // 版本 4 冇登記（孤兒）
      return [versionRow(2), versionRow(3), versionRow(5), versionRow(6), versionRow(7, true), versionRow(8, true), versionRow(9)];
    }
    return [];
  };
  const trashedSheets = [];
  gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } };
  gas.getConfig_ = function (_k, dflt) { return dflt; };
  gas.findQuarter_ = function () { return null; };
  gas.getQuarterStage_ = function () { return 'DRAFT'; };
  gas.resolveMailAttachmentFolder_ = function () { return d.root; };
  gas.buildRosterSheetName_ = function (q, v) { return 'Roster_' + q + '_v' + v; };
  gas.writeAuditLog_ = function () {};
  gas.deleteRowsMatching_ = function () { return 0; };
  gas.resetQuarterStageForTesting_ = function () {};
  gas.DriveApp = {
    getFileById: function (id) { return byId[id]; },
    getFolderById: function (id) { return byId[id]; }
  };

  const plan = gas.planQuarterReset_(Q, false);
  checkEqual('★★★★★★ 要清嘅可編輯副本：第 2 版（新）、第 9 版（舊）、第 4 版（孤兒）；受保護 v7 同認不出版本嗰份保留',
    plan.editableCopyFiles.map((f) => f.name).sort(),
    [Q + '_第2版_職事表_可編輯副本_20991231-0900', Q + '_第4版_職事表_可編輯副本_20991201-1608',
      Q + '_第9版_職事表_可編輯副本_20991201-0900']);
  check('★★★★★ 受保護版本嘅副本、認不出版本嘅副本都在「需要人手處理」',
    plan.manualAttention.some((t) => /第7版/.test(t) && /保留/.test(t))
    && plan.manualAttention.some((t) => /不知哪一版/.test(t)), JSON.stringify(plan.manualAttention));
  checkEqual('★★★★★★ 清理後變空嘅版本 PDF 資料夾：v3（兩個 PDF 都會清）、v5（本來就空）、v4（冇登記嘅孤兒空資料夾）；v6 入面有認不出嘅檔案 ⇒ 唔係空；v7 受保護 ⇒ 不碰',
    plan.pdfFolders.map((f) => f.name).sort(), ['v3', 'v4', 'v5']);

  const lines = gas.describeQuarterResetPlanLines_(Q, plan).join('\n');
  check('★★★★★★ 確認清單「將會清理」列出可編輯副本同空資料夾數目',
    /可編輯副本：3 個檔案/.test(lines) && /清理後變空的版本 PDF 資料夾：3 個/.test(lines), lines);
  check('★★★★★ 並逐個列出名稱', /將移到垃圾桶的可編輯副本：/.test(lines) && /第9版/.test(lines) && /將移到垃圾桶的空資料夾/.test(lines), lines);

  const summary = gas.summariseQuarterResetBatch_([{ quarterId: Q, plan: plan }]);
  check('★★★★★ 批次總數也計入（nothingToDo 唔會誤報）',
    summary.totals.editableCopies === 3 && summary.totals.pdfFolders === 3 && summary.nothingToDo === false,
    JSON.stringify(summary.totals));
  const onlyCopies = gas.summariseQuarterResetBatch_([{ quarterId: Q, plan: {
    versions: [], editableCopyFiles: [{ id: 'x' }], pdfFolders: [], pdfFiles: [], manualAttention: [] } }]);
  check('★★★★★ 只有副本要清都算有嘢做', onlyCopies.nothingToDo === false);

  // 執行
  const result = gas.executeQuarterReset_(plan);
  check('★★★★★★ 三份副本（新、舊、孤兒）移到垃圾桶', byId['copy-new']._trashed && byId['copy-old-big']._trashed && byId['copy-orphan']._trashed && result.editableCopiesTrashed === 3,
    JSON.stringify(result));
  check('★★★★★★ 受保護 v7 副本、認不出版本嗰份冇動',
    !byId['copy-v7']._trashed && !byId['copy-unknown']._trashed);
  check('★★★★★★ 空資料夾 v3、v4（孤兒）、v5 移到垃圾桶（v3 先清走 PDF 才變空）', byId['v3']._trashed && byId['v4']._trashed && byId['v5']._trashed && result.pdfFoldersTrashed === 3,
    JSON.stringify(result));
  check('★★★★★★ v6（有認不出嘅檔案）、v7（受保護）資料夾冇動', !byId['v6']._trashed && !byId['v7']._trashed);
  check('★★★★ 不碰「可編輯副本」資料夾本身', !byId['cf']._trashed);
  check('★★★★★★ 受保護版本嘅空資料夾 v8 唔計（版本過濾）', !byId['v8']._trashed && plan.pdfFolders.every((f) => f.name !== 'v8'));
  check('★★★★ PDF 照舊只移到垃圾桶（v3 兩份、v6 一份）',
    byId['pdf-a']._trashed && byId['pdf-b']._trashed && byId['pdf-c']._trashed && !byId['pdf-d']._trashed && !byId['note']._trashed);

  // 計畫到執行之間資料夾多咗檔案 ⇒ 唔動佢
  const d2 = buildDrive();
  gas.resolveMailAttachmentFolder_ = function () { return d2.root; };
  const plan2 = gas.planQuarterReset_(Q, false);
  d2.v5.addFile(fakeFile('後來放入.pdf', 'late', 1));
  const result2 = gas.executeQuarterReset_(plan2);
  check('★★★★★★ 計畫之後資料夾多咗檔案 ⇒ 執行時唔當空資料夾清走', !byId['v5']._trashed && result2.pdfFoldersKept === 1,
    JSON.stringify(result2));

  const src = read('src/QuarterReset.gs');
  check('★★★★★ QUARTER_RESET_BLOCKED 保護照舊（plan／execute 入口一個字冇改）',
    /readQuarterResetBlockedQuarters_/.test(src) && /QUARTER_RESET_BLOCKED_DEFAULT = '2026T4'/.test(src), '');
}

// =====================================================================
console.log('\n=== AW3 USER_GUIDE_URL：有值畫連結；空白寫指南章名；唔再叫人睇 docs/ ===');
{
  const gas = load();
  const d = buildDrive();
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.findLatestVersionNo_ = function () { return 3; };
  gas.resolveMailAttachmentFolder_ = function () { return d.root; };
  gas.findPublicLinkRow_ = function () { return null; };
  gas.buildAttachmentName_ = function (q, v, label) { return q + '_v' + v + '_' + label + '.pdf'; };

  gas.getConfig_ = function (_k, dflt) { return dflt; };
  const blank = gas.apiGetRecoveryLinks(Q);
  check('★★★★★★ 空白 ⇒ 寫「詳細步驟見《職事表系統使用指南》「系統出問題時」一章」',
    blank.guideUrl === '' && blank.guideSentence === '詳細步驟見《職事表系統使用指南》「系統出問題時」一章。', JSON.stringify(blank));
  gas.getConfig_ = function (k, dflt) { return k === gas.CONFIG_KEYS.USER_GUIDE_URL ? ' https://docs.invalid/guide ' : dflt; };
  const set = gas.apiGetRecoveryLinks(Q);
  check('★★★★★★ 有值 ⇒ 回連結（去掉空白）＋「詳細步驟見使用指南」',
    set.guideUrl === 'https://docs.invalid/guide' && /詳細步驟見使用指南/.test(set.guideSentence), JSON.stringify(set));

  check('★★★★★ Config 有 USER_GUIDE_URL 種子（預設空白）並登記在三個地方',
    gas.CONFIG_KEYS.USER_GUIDE_URL === 'USER_GUIDE_URL' && gas.DEFAULTS.USER_GUIDE_URL === ''
    && /key: CONFIG_KEYS\.USER_GUIDE_URL/.test(read('src/ConfigSeed.gs'))
    && /USER_GUIDE_URL: \{ launchTargetValue: ''/.test(read('src/ConfigBaselineCheck.gs')), '');

  // 畫面
  const ui = loadUiScripts(['Script.html', 'ScriptZone4.html']);
  const render = (r) => {
    ui.__r = r;
    let body = '';
    vm.runInContext(
      'runAction = async function (l, fn) { await fn(); };'
      + 'currentQuarterId = "2099T1";'
      + 'callServer = async function () { return __r; };'
      + 'openModal = function (title, nodes) { __modal = { title: title, nodes: nodes }; };'
      + 'var __modal = null;', ui);
    return Promise.resolve(vm.runInContext('openRecoveryHelp()', ui)).then(() => Promise.resolve()).then(() => {
      const modal = vm.runInContext('__modal', ui);
      const walk = (n) => String(n._text || '') + (n.children || []).map(walk).join('\n') + (n.href ? ' [' + n.href + ']' : '');
      body = (modal ? modal.nodes : []).map(walk).join('\n');
      return body;
    });
  };
  const base = { quarterId: Q, versionNo: 3, guideDoc: 'docs/系統出問題時手動繼續.md',
    publicLink: { url: '', note: '' }, fullPdf: { url: '', note: '' }, editableCopy: { url: '', folderUrl: '', note: '' } };
  return render(Object.assign({ guideUrl: '', guideSentence: '詳細步驟見《職事表系統使用指南》「系統出問題時」一章。' }, base)).then((t1) => {
    check('★★★★★★ 空白：畫面寫指南章名，**不出現 docs/**', /職事表系統使用指南/.test(t1) && !/docs\//.test(t1), t1);
    return render(Object.assign({ guideUrl: 'https://docs.invalid/guide', guideSentence: '詳細步驟見使用指南。' }, base));
  }).then((t2) => {
    check('★★★★★★ 有值：畫面有連結', /詳細步驟見使用指南/.test(t2) && /\[https:\/\/docs\.invalid\/guide\]/.test(t2) && !/docs\//.test(t2.replace(/docs\.invalid/g, '')), t2);
    console.log(fail === 0 ? '\nOK' : '\n' + fail + ' FAILURE(S)');
    process.exit(fail === 0 ? 0 : 1);
  });
}
