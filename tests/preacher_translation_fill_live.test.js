// 第十五輪批次階段 A：講員／翻譯／獻花側邊欄嘅**行為測試**（唔係靜態字串
// 檢查）——真正執行 src/PreacherTranslationFill.gs 嘅 apiListPreacherTranslationPending()／
// apiSavePreacherTranslationEntry()，用一個貼近 Google Sheets 真實行為嘅假
// 試算表（支援 getLastRow/getLastColumn／Protection API），對照 2026T4 彩排
// 實測撞到嘅確實情境：「RosterVersions 明明有一行，側邊欄一開就顯示搵唔到
// 已生成的版本」。
//
// 背景：本輪逐層追查之後，用貼近 Ivan 描述嘅資料狀態重現，發現正式碼本身
// 喺呢個情境下其實運作正常（見 docs/系統範圍稽核.md 第十五輪批次階段 A 嘅
// 詳細記錄）——但過程中發現咗一個真實、廣泛存在嘅風險類別：**全形字元／
// 零闊度字元輸入唔會被 `.trim()` 處理，會令 `===` 嚴格比對靜靜噉搵唔到**。
// 呢個檔案專門測試新增嘅 `normalizeIdInput_()` 喺呢條真實路徑上有冇正確
// 生效，以及 A3 嘅「寫入受保護 v0」安全機制。
//
// 執行方式：node tests/preacher_translation_fill_live.test.js

const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkThrows(label, fn, messagePattern) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  const ok = err !== null && (!messagePattern || messagePattern.test(err.message));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log('      ' + (err ? ('實際訊息：' + err.message) : '沒有拋出任何錯誤'));
}

// =====================================================================
// 貼近 Google Sheets 真實行為嘅假試算表：支援 getLastRow/getLastColumn
// （tests/helpers/sheet_mock.js 冇呢兩個方法，第十三輪批次嗰個 mock 專門
// 為 PublicRoster.gs 嘅版面寫入設計，唔啱呢度用）同 Protection API。
// =====================================================================
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows || 1; this.numCols = numCols || 1;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      const srcRow = this.sheet.rows[this.row - 1 + r] || [];
      for (let c = 0; c < this.numCols; c++) rowArr.push(srcRow[this.col - 1 + c] === undefined ? '' : srcRow[this.col - 1 + c]);
      out.push(rowArr);
    }
    return out;
  }
  getValue() {
    const srcRow = this.sheet.rows[this.row - 1] || [];
    return srcRow[this.col - 1] === undefined ? '' : srcRow[this.col - 1];
  }
  setValue(v) {
    if (!this.sheet.rows[this.row - 1]) this.sheet.rows[this.row - 1] = [];
    this.sheet.rows[this.row - 1][this.col - 1] = v;
    return this;
  }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      if (!this.sheet.rows[this.row - 1 + r]) this.sheet.rows[this.row - 1 + r] = [];
      for (let c = 0; c < values[r].length; c++) this.sheet.rows[this.row - 1 + r][this.col - 1 + c] = values[r][c];
    }
    return this;
  }
  setBackground(v) {
    if (!this.sheet.backgrounds[this.row]) this.sheet.backgrounds[this.row] = {};
    this.sheet.backgrounds[this.row][this.col] = v;
    return this;
  }
  setNote(v) {
    if (!this.sheet.notes[this.row]) this.sheet.notes[this.row] = {};
    this.sheet.notes[this.row][this.col] = v;
    return this;
  }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

class FakeProtection {
  constructor(sheet, description) {
    this.sheet = sheet;
    this._description = description || '';
    this._editors = [];
    this._domainEdit = true;
  }
  setDescription(d) { this._description = d; return this; }
  getDescription() { return this._description; }
  getEditors() { return this._editors.map(function (email) { return { getEmail: function () { return email; } }; }); }
  removeEditors() { this._editors = []; return this; }
  addEditor(email) { if (this._editors.indexOf(email) === -1) this._editors.push(email); return this; }
  canDomainEdit() { return this._domainEdit; }
  setDomainEdit(v) { this._domainEdit = v; return this; }
  remove() {
    this.sheet.protections = this.sheet.protections.filter((p) => p !== this);
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.backgrounds = {};
    this.notes = {};
    this.protections = [];
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() {
    let max = 0;
    this.rows.forEach(function (r) { if (r && r.length > max) max = r.length; });
    return max;
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows, numCols); }
  protect() {
    const p = new FakeProtection(this, '');
    this.protections.push(p);
    return p;
  }
  getProtections() { return this.protections.slice(); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  addSheet(name, headerTC, headerKeys, dataRows) {
    const s = new FakeSheet(name);
    s.rows[0] = headerTC || [];
    s.rows[1] = headerKeys || [];
    (dataRows || []).forEach(function (r, i) { s.rows[2 + i] = r; });
    this.sheets[name] = s;
    return s;
  }
}

/** 每個測試場景都要一個乾淨嘅試算表，避免互相污染。 */
function buildScenario() {
  const ss = new FakeSpreadsheet();

  ss.addSheet('Posts', ['PostID', '中文名', '啟用', '顯示次序', '每次人數', '自動生成', '頻率', 'EmptyDisplay'],
    ['PostID', 'PostName_TC', 'Active', 'DisplayOrder', 'SlotCount', 'AutoGenerate', 'Frequency', 'EmptyDisplay'],
    [
      ['CHAIR', '主席', 'TRUE', 1, 1, 'TRUE', 'WEEKLY', ''],
      ['PREACH', '講員', 'TRUE', 2, 1, 'FALSE', 'WEEKLY', 'PENDING'],
      ['TRANS', '翻譯', 'TRUE', 3, 1, 'FALSE', 'WEEKLY', 'BLANK'],
      ['FLOWER', '獻花', 'TRUE', 4, 1, 'FALSE', 'WEEKLY', 'BLANK']
    ]);

  ss.addSheet('RosterVersions',
    ['VersionID', '季度', '版本號', '工作表名稱', '依據', '上一版本號', '狀態', '受保護', '警告數', '建立時間', '建立者', '備註'],
    ['VersionID', 'QuarterID', 'VersionNo', 'SheetName', 'Basis', 'ParentVersionNo', 'Status', 'Protected', 'WarningCount', 'CreatedAt', 'CreatedBy', 'Notes'],
    [
      ['2026T4-v0', '2026T4', 0, 'Roster_2026T4_v0', 'AUTO_GENERATE', '', 'DRAFT', 'TRUE', 0, '2026-08-16 10:00:00', 'test@x.com', '']
    ]);

  ss.addSheet('ServiceDates',
    ['季度', '日期', '週次', '類型', '自動生成'],
    ['QuarterID', 'ServiceDate', 'WeekIndex', 'ServiceType', 'AutoGenerate'],
    [
      ['2026T4', '2026-10-04', 1, '主日崇拜', 'TRUE'],
      ['2026T4', '2026-10-11', 2, '主日崇拜', 'TRUE']
    ]);

  ss.addSheet('RosterAssignments',
    ['AssignmentID', '季度', '版本號', '主日ID', '日期', '崗位', 'Slot', '人員ID', '人員姓名快照', '來源', 'RuleFlags', '鎖定', '更新時間', '更新者'],
    ['AssignmentID', 'QuarterID', 'VersionNo', 'ServiceDateID', 'ServiceDate', 'PostID', 'SlotIndex', 'PersonID', 'PersonNameSnapshot', 'AssignSource', 'RuleFlags', 'Locked', 'UpdatedAt', 'UpdatedBy'],
    [
      ['A1', '2026T4', 0, 'SD1', '2026-10-04', 'CHAIR', 1, 'P001', '陳大文', 'AUTO', '', 'FALSE', '', ''],
      ['A2', '2026T4', 0, 'SD1', '2026-10-04', 'PREACH', 1, '', '', 'SKIPPED', 'HARD_NO_AUTO_PREACHER', 'FALSE', '', ''],
      ['A3', '2026T4', 0, 'SD1', '2026-10-04', 'TRANS', 1, '', '', 'SKIPPED', 'HARD_NO_AUTO_PREACHER', 'FALSE', '', ''],
      ['A4', '2026T4', 0, 'SD1', '2026-10-04', 'FLOWER', 1, '', '', 'SKIPPED', 'HARD_NO_AUTO_PREACHER', 'FALSE', '', '']
    ]);

  ss.addSheet('Quarters',
    ['季度', '年', '季別', '開始日', '結束日', '週數', 'Stage', 'StageUpdatedAt', '生成日', '正式發出日'],
    ['QuarterID', 'Year', 'Term', 'StartDate', 'EndDate', 'WeekCount', 'Stage', 'StageUpdatedAt', 'GenerateOn', 'OfficialSendOn'],
    [['2026T4', 2026, 4, '2026-10-01', '2026-12-31', 13, 'DRAFT', '', '', '']]);

  ss.addSheet('Config', ['Key', 'Value'], ['Key', 'Value'], [['SYS_TIMEZONE', 'Pacific/Auckland']]);
  ss.addSheet('NameMapping', ['PersonID', '中文名', 'Active'], ['PersonID', 'NameTC', 'Active'], []);
  ss.addSheet('NameAlias', ['別名', 'PersonID'], ['AliasName', 'PersonID'], []);
  ss.addSheet('AuditLog',
    ['LogID', '時間', '操作者', '動作', '目標表', '目標鍵', '舊值', '新值', '來源', '備註'],
    ['LogID', 'Timestamp', 'Actor', 'Action', 'TargetSheet', 'TargetKey', 'OldValue', 'NewValue', 'Source', 'Notes'],
    []);

  // grid 工作表：對應 Roster_2026T4_v0，headers/keys/data 同 RosterAssignments 對齊
  const grid = ss.addSheet('Roster_2026T4_v0',
    ['日期', '週次', '類型', '主席', '講員', '翻譯', '獻花'],
    ['_DATE', '_WEEK', '_TYPE', 'CHAIR#1', 'PREACH#1', 'TRANS#1', 'FLOWER#1'],
    [
      ['2026-10-04', 1, '主日崇拜', '陳大文', '', '', ''],
      ['2026-10-11', 2, '主日崇拜', '', '', '', '']
    ]);

  return { ss: ss, grid: grid };
}

const auditLogRows = [];

function buildGas() {
  const scenario = buildScenario();
  const overrides = {
    SpreadsheetApp: {
      getActiveSpreadsheet: function () { return scenario.ss; },
      ProtectionType: { SHEET: 'SHEET' }
    },
    Session: { getActiveUser: function () { return { getEmail: function () { return 'ivan-test@x.com'; } }; } },
    Utilities: {
      getUuid: function () { return 'fake-uuid'; },
      formatDate: function (date) { return (date || new Date()).toISOString().slice(0, 19).replace('T', ' '); }
    },
    Logger: { log: function () {} },
    CacheService: {
      getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; }
    }
  };
  const gas = loadGasSource(
    ['Constants.gs', 'Utils.gs', 'Config.gs', 'SheetReader.gs', 'QuarterStage.gs', 'RosterWriter.gs', 'PreacherTranslationFill.gs'],
    overrides
  );
  return { gas: gas, scenario: scenario };
}

console.log('\n=== A1／A2【核心】季度有版本 → 正確列出待填格子（真正原始碼，非移植版本）===');
{
  const { gas } = buildGas();
  const result = gas.apiListPreacherTranslationPending('2026T4');
  checkEqual('★★★★ versionNo 正確', result.versionNo, 0);
  checkEqual('★★★ stage 正確', result.stage, 'DRAFT');
  checkEqual('★★★ pending 格數正確（講員／翻譯／獻花各一格，主席已排唔計）', result.pending.length, 3);
  check('★★ 每一週嘅 weekIndex 正確帶到（唔係跌返做 0）',
    result.pending.every((p) => p.weekIndex === 1), 'weekIndex=' + JSON.stringify(result.pending.map((p) => p.weekIndex)));
}

console.log('\n=== A2【核心】normalizeIdInput_ 喺呢條真實路徑上生效：全形字元輸入都搵到 ===');
{
  const { gas } = buildGas();
  // 模擬全形輸入法打出嚟嘅 QuarterID（睇落同 "2026T4" 一樣，但每隻字都係
  // 全形字元）——用 normalizeIdInput_() 轉正之後應該同半形版本行為一致。
  const fullWidthInput = '２０２６Ｔ４';
  check('★ 全形輸入本身確實同半形唔一樣（反證：唔轉正嘅話一定搵唔到）',
    fullWidthInput !== '2026T4');
  const normalized = gas.normalizeIdInput_(fullWidthInput);
  checkEqual('★★★★ normalizeIdInput_ 正確轉返做半形', normalized, '2026T4');
  const result = gas.apiListPreacherTranslationPending(normalized);
  checkEqual('★★★★ 用正規化之後嘅 QuarterID 可以正確搵到版本', result.versionNo, 0);
}

console.log('\n=== A2：季度沒有版本 → 錯誤訊息列出實際已知嘅 QuarterID（方便診斷） ===');
{
  const { gas } = buildGas();
  checkThrows('★★★ 打錯／季度未生成 → 拋錯，訊息附上實際已知嘅 QuarterID 清單',
    () => gas.apiListPreacherTranslationPending('2099T4'),
    /找不到 "2099T4" 已生成的版本[\s\S]*目前已生成過版本的季度：2026T4/);
}

console.log('\n=== A2：季度完全不存在（連 RosterVersions 都冇任何紀錄）→ 錯誤訊息改講清楚 ===');
{
  const scenario = buildScenario();
  // 清空 RosterVersions 資料列，模擬「呢個全新試算表完全未生成過任何一季」
  scenario.ss.sheets['RosterVersions'].rows = scenario.ss.sheets['RosterVersions'].rows.slice(0, 2);
  const overrides = {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return scenario.ss; }, ProtectionType: { SHEET: 'SHEET' } },
    Session: { getActiveUser: function () { return { getEmail: function () { return 'test@x.com'; } }; } },
    Logger: { log: function () {} },
    CacheService: { getScriptCache: function () { return { get: () => null, put: () => {}, remove: () => {} }; } }
  };
  const gas = loadGasSource(
    ['Constants.gs', 'Utils.gs', 'Config.gs', 'SheetReader.gs', 'QuarterStage.gs', 'RosterWriter.gs', 'PreacherTranslationFill.gs'],
    overrides
  );
  checkThrows('★★ 完全冇任何版本時，訊息講明「完全冇任何已生成嘅版本紀錄」，唔會列出空清單',
    () => gas.apiListPreacherTranslationPending('2026T4'),
    /目前 RosterVersions 完全冇任何已生成嘅版本紀錄/);
}

console.log('\n=== A4【核心】儲存後：RosterAssignments 更新、grid 工作表更新、AuditLog 有記錄、唔建新版本 ===');
{
  const { gas, scenario } = buildGas();
  const before = gas.apiListPreacherTranslationPending('2026T4');
  checkEqual('★ 儲存前有 3 格待填', before.pending.length, 3);

  const result = gas.apiSavePreacherTranslationEntry('2026T4', '2026-10-04', 'PREACH', 1, '王美美');
  checkEqual('★★ 回傳結果（自由文字，未連結 NameMapping）', result, { personId: '', linkedToNameMapping: false });

  const after = gas.apiListPreacherTranslationPending('2026T4');
  checkEqual('★★★ 儲存之後只剩 2 格待填（講員嗰格已經填咗）', after.pending.length, 2);
  check('★ 講員唔再出現喺待填清單', !after.pending.some((p) => p.postId === 'PREACH'));

  const raRows = scenario.ss.sheets['RosterAssignments'].rows.slice(2);
  const preachRow = raRows.find((r) => r[5] === 'PREACH');
  checkEqual('★★★ RosterAssignments 嘅 PersonNameSnapshot 已更新', preachRow[8], '王美美');
  checkEqual('★★ AssignSource 改成 MANUAL', preachRow[9], 'MANUAL');

  const gridSheet = scenario.ss.sheets['Roster_2026T4_v0'];
  checkEqual('★★★ grid 工作表對應儲存格已經寫入姓名', gridSheet.rows[2][4], '王美美');

  const auditRows = scenario.ss.sheets['AuditLog'].rows.slice(2);
  check('★★★★ AuditLog 有記錄呢次填寫', auditRows.some((r) => r[3] === 'FILL_PREACHER_TRANSLATION' && r[7] === '王美美'));

  const versionRows = scenario.ss.sheets['RosterVersions'].rows.slice(2);
  checkEqual('★★★★ RosterVersions 仍然只有 1 行（冇建立新版本）', versionRows.length, 1);

  const quartersRows = scenario.ss.sheets['Quarters'].rows.slice(2);
  checkEqual('★★★ Quarters.Stage 完全冇變（仍然係 DRAFT，冇被推進）', quartersRows[0][6], 'DRAFT');
}

console.log('\n=== A3【核心】v0 受保護（Protected=TRUE）時，寫入 grid 工作表一樣成功 ===');
{
  const { gas, scenario } = buildGas();
  const gridSheet = scenario.ss.sheets['Roster_2026T4_v0'];

  // 模擬 protectV0() 喺 v0 生成之後留低嘅保護狀態：只留一個特定編輯者。
  const protection = gridSheet.protect().setDescription('v0 原始版，建立後鎖定');
  protection.removeEditors(protection.getEditors());
  protection.addEditor('script-account@x.com');

  checkEqual('★ 儲存前 grid 工作表確實受保護', gridSheet.getProtections().length, 1);

  let err = null;
  try {
    gas.apiSavePreacherTranslationEntry('2026T4', '2026-10-04', 'FLOWER', 1, '陳太太');
  } catch (e) { err = e; }
  check('★★★★ 寫入受保護嘅 v0 唔會拋錯（呢個係正常路徑，唔係例外）', err === null, err && err.message);

  checkEqual('★★★ 寫入內容確實成功（grid 工作表已更新）', gridSheet.rows[2][6], '陳太太');
  checkEqual('★★★★ 寫完之後保護重新套用返，數量同之前一致（唔會削弱保護）',
    gridSheet.getProtections().length, 1);
  checkEqual('★★ 重新套用嘅保護維持原本嘅描述', gridSheet.getProtections()[0].getDescription(), 'v0 原始版，建立後鎖定');
  checkEqual('★★ 重新套用嘅保護維持原本嘅編輯者名單',
    gridSheet.getProtections()[0].getEditors().map((e) => e.getEmail()), ['script-account@x.com']);

  const auditRows = scenario.ss.sheets['AuditLog'].rows.slice(2);
  const flowerLog = auditRows.find((r) => r[3] === 'FILL_PREACHER_TRANSLATION' && r[7] === '陳太太');
  check('★ AuditLog 有記錄「grid 工作表受保護，已暫時解除並重新保護」',
    flowerLog && flowerLog[9].indexOf('受保護') !== -1, JSON.stringify(flowerLog));
}

console.log('\n=== A3：v0 冇受保護時（例如未受保護嘅測試季度），寫入行為唔變 ===');
{
  const { gas, scenario } = buildGas();
  const gridSheet = scenario.ss.sheets['Roster_2026T4_v0'];
  checkEqual('★ 確認呢個場景冇任何保護', gridSheet.getProtections().length, 0);

  gas.apiSavePreacherTranslationEntry('2026T4', '2026-10-04', 'TRANS', 1, '李四');
  checkEqual('★★ 寫入成功', gridSheet.rows[2][5], '李四');
  checkEqual('★ 完成之後仍然冇任何保護（冇無端端幫佢加咗保護）', gridSheet.getProtections().length, 0);
}

console.log('\n=== A4：儲存失敗路徑（找不到對應格子）唔會半途寫一半 ===');
{
  const { gas, scenario } = buildGas();
  checkThrows('★★ 日期唔存在於呢一版 → 拋錯',
    () => gas.apiSavePreacherTranslationEntry('2026T4', '2099-01-01', 'PREACH', 1, '王美美'),
    /找不到對應的格子/);
  const raRows = scenario.ss.sheets['RosterAssignments'].rows.slice(2);
  check('★ 拋錯之後 RosterAssignments 完全冇被改動', raRows.every((r) => r[9] !== 'MANUAL'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
