// 第三十二輪批次階段 B：全季流程演練——接續模式。
// 執行方式：node tests/rehearsal_resume.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解要有接續
// ─────────────────────────────────────────────────────────────────────
//
// 第一段喺 3.5 分鐘死線內盡力產生個人 PDF，然後步驟 4 被缺件閘門攔住。
// 呢個係**正確嘅行為**（實測 58 份要分 3 次、共 552 秒，而單次
// Apps Script 執行上限係 6 分鐘）。
//
// 但後果係：**步驟 4（正式發出）同步驟 5（改動後重發）至今冇喺演練
// 入面行過一次。** 而嗰兩步正正係 12 月 4 日最重要嗰兩步。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 整個階段最重要嗰一條守則
// ─────────────────────────────────────────────────────────────────────
//
// **接續一個已經過時嘅狀態，比唔能夠接續更差。**
// 版本號對唔上就一律拒絕——照接續落去會排練一件唔存在嘅事，
// 而報告會理直氣壯咁話「全部成功」。
//
// ⚠️ 而且呢一份有一段係**由 `runSeasonRehearsalResume_()` 呢個真入口
// 叫落去**，唔淨係測內部函式。

const fs = require('fs');
const path = require('path');
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
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// ⚠️ 一定要載 `FiveStageCore.gs`——接續段嘅步驟 4／5 用
// `FLOW_STEP_KEYS` 同 `describeFlowStepPrecondition_()`（第三十一輪
// 階段 B2 把前置條件收歸嗰一份單一真相來源）。唔載就會
// `FLOW_STEP_KEYS is not defined`。
const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Diagnostics.gs',
  'FiveStageCore.gs', 'SeasonRehearsal.gs', 'SeasonRehearsalResume.gs'];

/**
 * 一個假 `RehearsalState` 工作表：所有寫入都記落 `sheetRows`，
 * 而 `readSheet()` 讀返同一個陣列——即係真係模擬到「寫完再讀」。
 */
function makeGas(opts) {
  const o = opts || {};
  const gas = loadGasSource(FILES);
  const C = gas.COLUMNS.REHEARSAL_STATE;
  const keys = [C.QUARTER_ID, C.STARTED_AT, C.SEGMENT, C.BASE_VERSION_NO, C.STEPS_DONE,
    C.PDF_ROUNDS_DONE, C.PDF_DONE, C.STOPPED_BY, C.UPDATED_AT, C.NOTES];

  const store = { rows: (o.initialRows || []).slice() };
  const calls = { alerts: [], toasts: [], writes: 0, clears: 0 };

  gas.readSheet = function (name) {
    if (name === gas.SHEETS.REHEARSAL_STATE) {
      return store.rows.map(function (arr) {
        const row = {};
        keys.forEach(function (k, i) { row[k] = arr[i]; });
        return row;
      });
    }
    if (name === gas.SHEETS.SEND_LOG) return [];
    return [];
  };
  // 用一個極簡嘅假 Sheet：只需要 `getLastRow` / `getRange().clearContent()/setValues()`。
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function () { return fakeSheet; },
        insertSheet: function () { return fakeSheet; },
        toast: function (msg) { calls.toasts.push(String(msg)); }
      };
    },
    getUi: function () { return o.ui || {}; }
  };
  const fakeSheet = {
    getLastRow: function () { return store.rows.length > 0 ? 2 + store.rows.length : 2; },
    getLastColumn: function () { return keys.length; },
    setFrozenRows: function () {},
    getRange: function (row, col, numRows) {
      return {
        getValues: function () { return [keys]; },
        setValues: function (vals) {
          if (row === 3) { store.rows = vals.map(function (v) { return v.slice(); }); calls.writes++; }
          return this;
        },
        clearContent: function () {
          if (row === 3) { store.rows = []; calls.clears++; }
        },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; }
      };
    }
  };
  gas.GRID_COLORS = gas.GRID_COLORS || { HEADER: '#eee' };
  gas.nowTimestamp_ = function () { return '2027-08-19 10:00:00'; };
  gas.log_ = function () {};
  return { gas: gas, store: store, calls: calls, keys: keys };
}

/** 砌一行狀態（同 `writeRehearsalState_()` 寫落去嘅次序一致）。 */
function stateRow(over) {
  const o = over || {};
  return [
    o.quarterId === undefined ? '2027T4' : o.quarterId,
    o.startedAt === undefined ? '2027-08-19 09:00:00' : o.startedAt,
    o.segment === undefined ? 1 : o.segment,
    o.baseVersionNo === undefined ? 7 : o.baseVersionNo,
    o.stepsDone === undefined ? '步驟 1，步驟 2，步驟 3' : o.stepsDone,
    o.pdfRoundsDone === undefined ? 4 : o.pdfRoundsDone,
    o.pdfDone === undefined ? 'FALSE' : o.pdfDone,
    o.stoppedBy === undefined ? '時間用完' : o.stoppedBy,
    '2027-08-19 09:04:00',
    ''
  ];
}

/* ══════════════════════════════════════════════════════════════
 * B6-1　冇狀態時撳接續
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B6【核心】冇狀態 ⇒ 明確講「沒有未完成的演練」，而且乜都唔寫 ===');
{
  const alerts = [];
  const env = makeGas({
    initialRows: [],
    ui: {
      alert: function (title, msg) { alerts.push(String(msg)); },
      prompt: function () { throw new Error('唔應該行到問確認嗰一步'); },
      ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
      Button: { OK: 'OK' }
    }
  });

  // ⚠️ **由真入口叫落去。**
  env.gas.runSeasonRehearsalResume_();

  check('★★★★★ 講「沒有未完成的演練」',
    alerts.join('\n').indexOf('沒有未完成的演練') !== -1, alerts.join('\n'));
  check('★★★★★ 而且叫人先執行「全季流程演練」',
    alerts.join('\n').indexOf('請先執行「全季流程演練」') !== -1, alerts.join('\n'));
  check('★★★★★ **明講呢個工具唔會自己開始一次新演練**'
    + '——靜靜當成新演練開始就會建版本、產生 PDF、寫 SendLog',
    alerts.join('\n').indexOf('不會自己開始') !== -1, alerts.join('\n'));
  checkEqual('★★★★★ 冇任何寫入動作（連建張表都冇）', env.calls.writes, 0);
  checkEqual('★★★★★ 亦冇清任何嘢', env.calls.clears, 0);
}

/* ══════════════════════════════════════════════════════════════
 * B6-2　版本號唔符 ⇒ 拒絕 ＋ 清狀態
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B6【最重要】版本號唔符 ⇒ 拒絕接續，狀態清走 ===');
{
  const env = makeGas({ initialRows: [stateRow({ baseVersionNo: 7 })] });
  const state = env.gas.readRehearsalState_();
  const verdict = env.gas.evaluateRehearsalResume_(state, 9);

  checkEqual('★★★★★ 拒絕', verdict.ok, false);
  checkEqual('★★★★★ 而且要清走狀態'
    + '——留住一個對唔上嘅狀態，下次一撳又會拒絕一次，冇完冇了',
    verdict.clearState, true);
  check('★★★★★ 訊息含**兩個**版本號（現時 v9、演練用嘅 v7）'
    + '——只講「版本不符」等於叫人自己去查',
    verdict.reason.indexOf('v9') !== -1 && verdict.reason.indexOf('v7') !== -1,
    verdict.reason);
  check('★★★★★ 而且講得出點解唔可以接（會排練一件不存在的事）',
    verdict.reason.indexOf('不存在的事') !== -1, verdict.reason);
  check('★★★★ 仲要講返跟住點做（重新由第一段開始）',
    verdict.reason.indexOf('重新由') !== -1, verdict.reason);
}

console.log('\n=== B6【核心】查唔到版本號 ⇒ 唔可以當成對得上 ===');
{
  const env = makeGas({ initialRows: [stateRow({ baseVersionNo: 7 })] });
  const state = env.gas.readRehearsalState_();
  [NaN, undefined, null, '唔知'].forEach(function (bad) {
    const v = env.gas.evaluateRehearsalResume_(state, bad);
    checkEqual('★★★★★ 現時版本號係 `' + String(bad) + '` ⇒ 拒絕'
      + '——「查不到」同「查到係啱」係兩件事', v.ok, false);
    checkEqual('★★★★ 而且呢種情況**唔清狀態**（可能只係一時讀唔到）',
      v.clearState, false);
  });
}

console.log('\n=== B6 版本號對得上 ⇒ 放行 ===');
{
  const env = makeGas({ initialRows: [stateRow({ baseVersionNo: 7 })] });
  const state = env.gas.readRehearsalState_();
  checkEqual('★★★★★ v7 對 v7 ⇒ 可以接續',
    env.gas.evaluateRehearsalResume_(state, 7).ok, true);
}

/* ══════════════════════════════════════════════════════════════
 * B6-3　PDF 未 done ⇒ 段數加一、批數累加、PdfDone 仍係 FALSE
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B6【核心】PDF 未產生完 ⇒ 更新狀態，唔行步驟 4／5 ===');
{
  const env = makeGas({ initialRows: [stateRow({ segment: 1, pdfRoundsDone: 4 })] });
  const gas = env.gas;
  let step4Called = 0;
  let step5Called = 0;
  gas.findLatestVersionNo = function () { return 7; };
  gas.readRehearsalPdfPaths_ = function () { return { available: true, files: [] }; };
  // 每一批都回「仲未 done」。
  gas.generatePersonalPdfBatch_ = function () {
    return { done: false, totalPeople: 58, doneCount: 30, generatedCount: 10,
      skippedExistingCount: 0, errors: [] };
  };
  gas.executeStep4Send_ = function () { step4Called++; return {}; };
  gas.planStep5ChangedList_ = function () { step5Called++; return { versionNo: 7, changedList: [] }; };

  const before = gas.readRehearsalState_();
  const record = gas.executeSeasonRehearsalResume_(before);

  checkEqual('★★★★★ 回報未完成', record.completed, false);
  checkEqual('★★★★★ **冇行步驟 4**（PDF 未齊就行落去只係浪費一次執行）',
    step4Called, 0);
  checkEqual('★★★★★ 亦冇行步驟 5', step5Called, 0);

  const after = gas.readRehearsalState_();
  checkEqual('★★★★★ `Segment` 加一', after.segment, 2);
  check('★★★★★ `PdfRoundsDone` 累加（原本 4，今段再跑咗至少 1 批）',
    after.pdfRoundsDone > 4, String(after.pdfRoundsDone));
  checkEqual('★★★★★ `PdfDone` 仍然係 false（**唔可以樂觀寫 TRUE**）',
    after.pdfDone, false);
  checkEqual('★★★★★ 而且狀態**冇被清走**——清走等於逼人由頭再嚟一次',
    after.quarterId, '2027T4');
  check('★★★★★ 講返「再撳一次接續」', record.nextAction.indexOf('再撳一次') !== -1,
    record.nextAction);
}

/* ══════════════════════════════════════════════════════════════
 * B6-4　PDF done ⇒ 行步驟 4、5，然後清走狀態
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B6【最重要】PDF 產生完 ⇒ 步驟 4／5 真係行到，完成後狀態清走 ===');
{
  const env = makeGas({ initialRows: [stateRow({ segment: 2, pdfRoundsDone: 6, pdfDone: 'TRUE' })] });
  const gas = env.gas;
  let step4Called = 0;
  let step5Called = 0;
  gas.findLatestVersionNo = function () { return 7; };
  gas.planStep4Warnings_ = function () { return { versionNo: 7, pendingCells: [] }; };
  gas.planStep4MissingPdf_ = function () { return { missing: [] }; };
  gas.planStep4SendPreview_ = function () { return { recipientCount: 58, isDryRun: true }; };
  gas.executeStep4Send_ = function () { step4Called++; return { skipped: 0, outcomeSentence: '已寄 58 人' }; };
  gas.getQuarterStage_ = function () { return 'OFFICIAL_SENT'; };
  gas.planStep5ChangedList_ = function () { step5Called++; return { versionNo: 7, changedList: [] }; };

  const record = gas.executeSeasonRehearsalResume_(gas.readRehearsalState_());

  checkEqual('★★★★★ **步驟 4 真係被叫到**'
    + '——呢一步至今從來冇喺演練入面行過一次', step4Called, 1);
  checkEqual('★★★★★ **步驟 5 亦真係被叫到**', step5Called, 1);
  checkEqual('★★★★★ 回報已完成', record.completed, true);
  checkEqual('★★★★★ **`RehearsalState` 冇剩返任何行**'
    + '——留低一行舊狀態會令下一次接續接住一個唔存在嘅演練',
    gas.readRehearsalState_(), null);
  checkEqual('★★★★ 而且成張表真係空咗', env.store.rows.length, 0);
}

/* ══════════════════════════════════════════════════════════════
 * B6-5　報告分段
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B4【核心】報告名分段，第二段唔會洗走第一段 ===');
{
  const gas = loadGasSource(FILES);
  const n1 = gas.seasonRehearsalReportName_(1);
  const n2 = gas.seasonRehearsalReportName_(2);
  check('★★★★★ 第一段個名帶「第 1 段」', n1.indexOf('第 1 段') !== -1, n1);
  check('★★★★★ 第二段個名帶「第 2 段」', n2.indexOf('第 2 段') !== -1, n2);
  check('★★★★★ **兩個名唔同**——`writeDiagnosticsReport_()` 係同名覆蓋，'
    + '同名嘅話第二段會把第一段整份洗走，而第一段先係最完整嗰份',
    n1 !== n2, n1 + ' / ' + n2);
  check('★★★★ 認唔出段數就當第 1 段（唔會出「第 NaN 段」）',
    gas.seasonRehearsalReportName_(undefined).indexOf('第 1 段') !== -1,
    gas.seasonRehearsalReportName_(undefined));
}

console.log('\n=== B4【核心】接續段報告開頭要講返自己係第幾段 ===');
{
  const gas = loadGasSource(FILES);
  const rows = gas.buildRehearsalResumeRows_({
    quarterId: '2027T4', segment: 2, versionNo: 7, completed: false,
    startedAt: '2027-08-19 09:00:00', nextAction: '請再撳一次接續。',
    steps: [{ name: '步驟 3.5：產生個人 PDF（續跑）', ok: true, seconds: 200,
      preconditionText: '（沒有前置條件）', preconditionMet: true,
      detail: { finished: false, rounds: 3 }, error: '' }]
  });
  const text = rows.map(function (r) { return [r.section, r.item, r.value, r.note].join('|'); }).join('\n');

  check('★★★★★ 開頭寫「本次演練由多段執行完成，這是第 2 段」',
    text.indexOf('本次演練由多段執行完成，這是第 2 段') !== -1, text.slice(0, 300));
  check('★★★★★ 而且指返前一段嗰份報告個名',
    text.indexOf('第 1 段') !== -1, text.slice(0, 300));
  check('★★★★★ 明講唔會生成新版本', text.indexOf('接續不會生成新版本') !== -1, text);
  check('★★★★★ 未完成 ⇒ 冇寫總結（總結只喺最後一段寫）',
    text.indexOf('合共幾段') === -1, text);
  check('★★★★★ **控制喺 80 行以內**'
    + '——兩三段合起嚟迫爆 DIAGNOSTICS_MAX_ROWS_TOTAL（380）'
    + '就會由最舊嗰份開始整份丟，而第一段先係最完整嗰份',
    rows.length <= 80, String(rows.length));

  const finalRows = gas.buildRehearsalResumeRows_({
    quarterId: '2027T4', segment: 3, versionNo: 7, completed: true,
    startedAt: new Date(Date.now() - 25 * 60000).toISOString(), nextAction: '',
    steps: [{ name: '步驟 4：正式發出給全體', ok: true, seconds: 30,
      preconditionText: 'Stage 要是 REQUESTS_APPLIED，實際是 REQUESTS_APPLIED　✅',
      preconditionMet: true, detail: { recipientCount: 58 }, error: '' }]
  });
  const finalText = finalRows.map(function (r) { return r.item + '|' + r.value + '|' + r.note; }).join('\n');
  check('★★★★★ 最後一段有總結：合共幾段', finalText.indexOf('合共幾段|3 段') !== -1, finalText);
  check('★★★★★ 而且講得出由開始到完成經過幾多分鐘',
    /由開始到完成\|2[45] 分鐘/.test(finalText), finalText);
  check('★★★★★ 亦講明狀態已清走', finalText.indexOf('已清走') !== -1, finalText);
  check('★★★★★ 算唔到時間就講「算不出來」，**唔可以寫 0 分鐘**'
    + '——0 分鐘會令人以為成件事一秒完成',
    gas.describeRehearsalSpanMinutes_('').indexOf('算不出來') !== -1
    && gas.describeRehearsalSpanMinutes_('唔係時間').indexOf('算不出來') !== -1,
    gas.describeRehearsalSpanMinutes_(''));
}

/* ══════════════════════════════════════════════════════════════
 * B5　第一段收尾要講返下一步
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B5【核心】第一段收尾要有一句明確嘅下一步 ===');
{
  const gas = loadGasSource(FILES);
  const t = gas.buildRehearsalNextStepText_({
    resumeNeeded: true, stateError: '',
    steps: [{ name: '步驟 3.5：產生個人 PDF',
      detail: { totalPeople: 58, doneCount: 22 } }]
  });
  check('★★★★★ 明確叫人去邊個選單項目',
    t.indexOf('全季流程演練（接續）') !== -1, t);
  check('★★★★★ 講得出仲差幾多份（58 − 22 ＝ 36）',
    t.indexOf('36 份') !== -1, t);
  check('★★★★★ 而且講明系統會自動接住行步驟 4 同步驟 5',
    t.indexOf('自動接住') !== -1 && t.indexOf('步驟 5') !== -1, t);

  const noNum = gas.buildRehearsalNextStepText_({
    resumeNeeded: true, stateError: '',
    steps: [{ name: '步驟 3.5：產生個人 PDF', detail: {} }]
  });
  check('★★★★★ 數唔到就唔寫數字，**唔可以寫 0 份**'
    + '——0 份會令人以為已經做完',
    noNum.indexOf('0 份') === -1 && noNum.indexOf('全季流程演練（接續）') !== -1, noNum);

  const stateBad = gas.buildRehearsalNextStepText_({
    resumeNeeded: false, stateError: '權限不足', steps: []
  });
  check('★★★★★ 狀態寫唔入要明講'
    + '——唔講嘅話幹事會撳接續，然後見到「沒有未完成的演練」，'
    + '完全唔知發生咩事',
    stateBad.indexOf('權限不足') !== -1 && stateBad.indexOf('只能重新演練') !== -1, stateBad);

  const allDone = gas.buildRehearsalNextStepText_({
    resumeNeeded: false, stateError: '', steps: []
  });
  check('★★★★ 全部行完就講冇嘢要接續',
    allDone.indexOf('沒有需要接續') !== -1, allDone);
}

console.log('\n=== B2 選單真係掛咗接續入口 ===');
{
  const menu = read('src/Menu.gs');
  check('★★★★★ `runSeasonRehearsalResume_` 掛咗上選單'
    + '——冇掛上去嘅話，成個階段 B 幹事撳唔到',
    /addItem\([^)]*全季流程演練（接續）[^)]*, 'runSeasonRehearsalResume_'\)/.test(menu),
    '（睇 Menu.gs）');
  check('★★★★ 而且排喺原本嗰項正下方',
    menu.indexOf("'runSeasonRehearsalResume_'") > menu.indexOf("'runSeasonRehearsal_'"));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
