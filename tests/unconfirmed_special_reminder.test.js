// 第十六輪批次階段 D2：「未確認日期嘅特殊主日」提醒維度嘅**行為測試**。
// 執行方式：node tests/unconfirmed_special_reminder.test.js
//
// 點解要另開一個檔案，唔擴充 tests/reminder_mechanism.test.js：
// 嗰個檔案係**移植一份邏輯副本**去測（檔頭有講明），呢個做法對本輪新增
// 嘅維度唔夠好——新維度要真正讀 SpecialSundays 工作表，副本要再移植埋
// 讀表邏輯，等於再抄多一層，抄漏咗測試照樣全綠。所以呢度改用第十三／
// 十五輪批次已經確立嘅做法：**用 gas_loader 載入真正嘅 Trigger.gs，
// 配一個假試算表，真正執行 judgeRemindAction_() 一次。**

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

// =====================================================================
// 最細嘅假試算表：只需要支援 readSheet() 用到嘅幾個方法
// （getLastRow／getLastColumn／getRange().getValues()）。
// 每張表：第 1 行說明（readSheet 會跳過）、第 2 行機器鍵、第 3 行起資料。
// =====================================================================
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.numRows = numRows || 1; this.numCols = numCols || 1;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(src[this.col - 1 + c] === undefined ? '' : src[this.col - 1 + c]);
      out.push(line);
    }
    return out;
  }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((r) => { if (r && r.length > max) max = r.length; });
    return max;
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows, numCols); }
}
class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  addSheet(name, keys, dataRows) {
    const s = new FakeSheet(name);
    s.rows[0] = keys.map(() => '');   // 第 1 行：說明列
    s.rows[1] = keys;                 // 第 2 行：機器鍵
    (dataRows || []).forEach((r, i) => { s.rows[2 + i] = r; });
    this.sheets[name] = s;
    return s;
  }
}

/**
 * 組一個場景。
 * @param {Object} opts
 *   opts.specialSundays  SpecialSundays 資料列（null＝連工作表都唔存在）
 *   opts.generateOn      Quarters.GenerateOn
 *   opts.stage           Quarters.Stage
 */
function buildGas(opts) {
  const ss = new FakeSpreadsheet();

  ss.addSheet('Config',
    ['Key', 'Value', 'Type', 'Group', 'Description', 'Editable'],
    [
      ['SYS_TIMEZONE', 'Pacific/Auckland', 'STRING', 'SYS', '', 'TRUE'],
      ['REMIND_STUCK_DAYS', '3', 'INT', 'AUTOMATION', '', 'TRUE'],
      ['REMIND_STUCK_MAX_COUNT', '3', 'INT', 'AUTOMATION', '', 'TRUE'],
      ['REMIND_DEADLINE_DAYS', '7', 'INT', 'AUTOMATION', '', 'TRUE'],
      ['REMIND_UNCONFIRMED_SPECIAL_DAYS', '7', 'INT', 'AUTOMATION', '', 'TRUE'],
      ['SEND_WEEKDAY_GUARD', 'NONE', 'STRING', 'AUTOMATION', '', 'TRUE']
    ]);

  ss.addSheet('Quarters',
    ['QuarterID', 'Year', 'Term', 'StartDate', 'EndDate', 'WeekCount', 'Stage', 'StageUpdatedAt', 'GenerateOn', 'OfficialSendOn'],
    [['2027T2', 2027, 2, '2027-04-04', '2027-06-27', 13,
      opts.stage || 'DRAFT', '2027-03-01 10:00:00', opts.generateOn, '2027-03-20']]);

  ss.addSheet('AuditLog',
    ['Timestamp', 'Actor', 'Action', 'TargetSheet', 'TargetKey', 'OldValue', 'NewValue', 'Source', 'Notes'],
    []);

  ss.addSheet('RosterVersions',
    ['VersionID', 'QuarterID', 'VersionNo', 'SheetName', 'Basis', 'ParentVersionNo', 'Status',
      'Protected', 'WarningCount', 'CreatedAt', 'CreatedBy', 'Notes'],
    []);

  if (opts.specialSundays !== null) {
    ss.addSheet('SpecialSundays',
      ['SpecialID', 'QuarterID', 'ServiceDate', 'Type', 'Title', 'SkipPostIDs', 'LockPostIDs',
        'ExternalOwner', 'CommunionOverride', 'TranslationRequired', 'Active', 'Notes', 'Confirmed'],
      opts.specialSundays);
  }

  return loadGasSource(
    // RosterWriter.gs：resolveRemindReferenceDate_() 會呼叫 findLatestVersionNo()
    ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
      'RosterWriter.gs', 'Roles.gs', 'AnnualCombined.gs', 'Trigger.gs'],
    {
      SpreadsheetApp: { getActiveSpreadsheet: () => ss },
      CacheService: {
        getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} })
      },
      Utilities: {
        formatDate: function (date, tz, fmt) {
          const iso = new Date(date).toISOString();
          return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
        },
        getUuid: () => 'test-uuid'
      }
    });
}

/** 用嚟組 SpecialSundays 一列。 */
function specialRow(date, title, active, confirmed) {
  return ['SP1', '2027T2', date, '合堂', title, '', '', '', '', '', active, '', confirmed];
}

console.log('\n=== D2【核心】接近生成日期 + 有未確認特殊主日 → 觸發提醒 ===');
{
  const gas = buildGas({
    generateOn: '2027-03-10',
    specialSundays: [specialRow('2027-05-23', '五月合堂（日期待確認）', 'TRUE', 'FALSE')]
  });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];

  // 今日 2027-03-05，距離生成日期 5 日（門檻 7 日）→ 應該觸發
  const j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-03-05', config);

  checkEqual('★★★★★ outcome＝WOULD_RUN（會提醒）', j.outcome, 'WOULD_RUN');
  check('★★★★★ reasons 包含 UNCONFIRMED_SPECIAL',
    j.reasons.indexOf('UNCONFIRMED_SPECIAL') !== -1, JSON.stringify(j.reasons));
  checkEqual('★★★★ 帶埋未確認嘅明細（提醒信要列得出係邊一日）',
    j.unconfirmedSpecials.map((u) => u.serviceDate), ['2027-05-23']);
  checkEqual('★★★ 距離生成日期嘅日數算得啱', j.daysUntilGenerate, 5);
}

console.log('\n=== D2：仲未接近生成日期 → 唔會因為呢個維度提醒 ===');
{
  const gas = buildGas({
    generateOn: '2027-03-10',
    specialSundays: [specialRow('2027-05-23', '五月合堂（日期待確認）', 'TRUE', 'FALSE')]
  });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];

  // 今日 2027-02-01，距離生成日期 37 日（門檻 7 日）→ 唔應該因為呢個維度觸發
  const j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-02-01', config);
  check('★★★★ reasons 唔包含 UNCONFIRMED_SPECIAL（未夠近，唔好太早嘈）',
    j.reasons.indexOf('UNCONFIRMED_SPECIAL') === -1, JSON.stringify(j.reasons));
  checkEqual('★★★★ 而且**未夠近嗰陣完全唔會去讀 SpecialSundays**（避免每日每季白讀一次）',
    j.unconfirmedSpecials, []);
}

console.log('\n=== D2【核心】接近生成日期，但全部特殊主日都已確認 → 唔會提醒 ===');
{
  const gas = buildGas({
    generateOn: '2027-03-10',
    specialSundays: [
      specialRow('2027-04-04', '復活節主日（浸禮）', 'TRUE', 'TRUE'),
      // 空白＝已確認（呢個方向係本階段最易寫反嘅一點）
      specialRow('2027-05-23', '舊有嘅特殊主日（Confirmed 欄留空）', 'TRUE', '')
    ]
  });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];
  const j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-03-05', config);

  check('★★★★★ 全部已確認（含 Confirmed 留空嘅舊列）→ 唔會觸發呢個維度'
    + '——證明「空白＝已確認」呢個方向喺真正嘅執行路徑上都係啱',
    j.reasons.indexOf('UNCONFIRMED_SPECIAL') === -1, JSON.stringify(j.reasons));
}

console.log('\n=== D2：Active=FALSE 嘅特殊主日唔會觸發提醒 ===');
{
  const gas = buildGas({
    generateOn: '2027-03-10',
    // 幹事已經決定唔用呢一列（例如今年冇堂慶），唔應該再叫佢去確認一個唔會用嘅日期
    specialSundays: [specialRow('2027-05-23', '今年取消', 'FALSE', 'FALSE')]
  });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];
  const j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-03-05', config);
  check('★★★★ Active=FALSE 嘅列唔算未確認',
    j.reasons.indexOf('UNCONFIRMED_SPECIAL') === -1, JSON.stringify(j.reasons));
}

console.log('\n=== 向後相容【核心】：SpecialSundays 工作表唔存在時唔會拋錯 ===');
{
  const gas = buildGas({ generateOn: '2027-03-10', specialSundays: null });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];

  let threw = null;
  let j = null;
  try {
    j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-03-05', config);
  } catch (e) { threw = e; }

  check('★★★★★ 工作表未建立時唔會拋錯（readSheet() 本身係會拋「找不到工作表」嘅，'
    + '所以一定要行 readOptionalSheet_()）', threw === null, threw && threw.message);
  check('★★★★ 而且唔會因為呢個維度觸發提醒',
    j && j.reasons.indexOf('UNCONFIRMED_SPECIAL') === -1, j && JSON.stringify(j.reasons));
}

console.log('\n=== 唔影響既有兩個維度：Stage=OFFICIAL_SENT 時一律唔提醒 ===');
{
  const gas = buildGas({
    generateOn: '2027-03-10',
    stage: 'OFFICIAL_SENT',
    specialSundays: [specialRow('2027-05-23', '五月合堂（日期待確認）', 'TRUE', 'FALSE')]
  });
  const config = gas.readConfig();
  const quarterRow = gas.readSheet('Quarters')[0];
  const j = gas.judgeRemindAction_('2027T2', quarterRow, '2027-03-05', config);

  checkEqual('★★★★★ 已經正式發出嘅季度唔會因為新維度而被提醒'
    + '（新維度唔可以繞過原本嘅提早離開判斷）', j.outcome, 'SKIPPED_NOT_STUCK');
  checkEqual('★★★ reasons 係空', j.reasons, []);
}

console.log('\n=== 提醒信內容：三個維度嘅原因都要出現喺信入面 ===');
{
  // 呢度唔真正寄信，只係確認 Mailer.gs 嘅組信邏輯有處理新維度。
  const fs = require('fs');
  const path = require('path');
  const mailer = fs.readFileSync(path.join(__dirname, '..', 'src', 'Mailer.gs'), 'utf8');
  check('★★★★ notifyAdminStageReminder_() 有處理 UNCONFIRMED_SPECIAL 呢個 reason',
    mailer.indexOf("indexOf('UNCONFIRMED_SPECIAL')") !== -1);
  check('★★★★ 而且會把未確認明細（describeUnconfirmedSpecialSundays_）放入信件內文',
    mailer.indexOf('describeUnconfirmedSpecialSundays_') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
