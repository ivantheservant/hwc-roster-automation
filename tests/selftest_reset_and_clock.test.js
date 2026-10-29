// 第五十六輪批次 B／C 組：計時器、尾句指示、自測機自己收身。
// 執行方式：node tests/selftest_reset_and_clock.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 三件現場
// ═════════════════════════════════════════════════════════════════════
//
// B1　「⚠️ 跑自測」清 546 行派工要幾分鐘。舊寫法喺函式第一行起錶，
// 　　於是預算被清理食光——重設完即刻停，17 個情境全部「未跑」，
// 　　而報告寫「用了 2 秒」（嗰行只計情境迴圈）。
// 　　Ivan 見過至少兩次，每次都以為部機器壞咗。
//
// B2　報告尾句按狀態揀一句印。但「使用者改咗碼（clasp push 過）」
// 　　呢個最關鍵嘅情況，部機器**根本知唔到**。指示錯咗兩次，
// 　　Ivan 照住撳，白撳。
//
// B3　每次全新跑，S14 都 append 一行 `-SELFTEST` 落 `SpecialSundays`，
// 　　而 S15 只熄返自己嗰行。實測已經積咗 3 行（兩行仲 Active=TRUE），
// 　　生成嗰陣出「2／3 個特殊主日未確認」重覆警告。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份唔驗字串
// ═════════════════════════════════════════════════════════════════════

const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const FILES = ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Invariants.gs', 'SelfTestRunner.gs'];

/**
 * 造一部自測機，`Date` 可以由測試控制。
 *
 * @param {Object} opts `{resetMs, scenarioMs, invariantMs, scenarios}`
 * @returns {Object}
 */
function machine(opts) {
  const gas = loadGasSource(FILES);
  const S = gas.SELFTEST_STATUS;
  let now = 1000000;
  const RealDate = Date;
  // ⚠️ 只換 `new Date().getTime()` 嗰個用法——時間全部由測試話事，
  // 否則「三段加埋等唔等於總數」呢一條驗唔到。
  gas.Date = function () { return { getTime: function () { return now; } }; };
  gas.Date.now = function () { return now; };

  gas.log_ = function () {};
  gas.readSelfTestQuarterDetail_ = function () { return { value: '2028T3', source: 'x' }; };
  gas.checkSelfTestPreconditions_ = function () { return { ok: true, reasons: [] }; };
  gas.planQuarterReset_ = function () { return {}; };
  gas.executeQuarterReset_ = function () {
    now += (opts.resetMs || 0);   // 清理食咗幾耐
    return { versionRowsDeleted: 546, assignmentRowsDeleted: 546, sendLogRowsDeleted: 0 };
  };
  gas.selfTestResetOwnSheets_ = function () {
    return { specialSundayRowsDeleted: 3, payloadRowsDeleted: 120 };
  };
  gas.runAllInvariants_ = function () {
    now += (opts.invariantMs || 0);
    return { results: [], okCount: 0, failedCount: 0, errorCount: 0,
      skippedCount: 0, notApplicableCount: 0 };
  };
  gas.readSelfTestState_ = function () { return {}; };
  gas.writeSelfTestState_ = function () {};
  gas.selfTestScenarios_ = function () {
    return (opts.scenarios || [{ id: 'X1', status: S.PASSED }]).map(function (sc) {
      return {
        id: sc.id, title: sc.id, dependsOn: sc.dependsOn || [],
        run: function () {
          now += (opts.scenarioMs || 0);
          return { id: sc.id, status: sc.status, checks: [],
            failedChecks: sc.status === S.PASSED ? []
              : [{ label: 'x', expected: 'a', actual: 'b', evidence: '' }] };
        }
      };
    });
  };
  const report = gas.runSelfTestMachine_(false, false);
  return { gas: gas, report: report,
    lines: gas.describeSelfTestReport_(report).join('\n'), S: S };
}

// =====================================================================
console.log('\n=== B1【核心】清理唔可以食情境嘅時間預算 ===');
{
  // ⚠️ 清理要**長過成個預算**（4.5 分 ＝ 270 秒）先驗到呢一條。
  // 清 200 秒嘅話，舊寫法都仲淨返 70 秒，三條短情境照樣跑得晒——
  // 於是個突變睇落冇分別。實測現場係清 546 行派工要幾分鐘。
  const box = machine({
    resetMs: 300000, scenarioMs: 1000, invariantMs: 500,
    scenarios: [{ id: 'X1', status: 'PASSED' }, { id: 'X2', status: 'PASSED' },
      { id: 'X3', status: 'PASSED' }]
  });
  checkEqual('★★★★★★ 清理用咗 5 分鐘，長過 4.5 分鐘嘅預算'
    + '——短過預算嘅話，舊寫法都仲跑得晒，就驗唔到下面嗰條',
    box.report.resetMs > 4.5 * 60 * 1000, true);
  checkEqual('★★★★★★ **三條情境全部執行到，冇一條「未執行」**'
    + '——舊寫法喺函式第一行起錶，清理食光預算，'
    + '重設完即刻停，17 個全部「未跑」而報告寫「用了 2 秒」',
    box.report.notRunCount, 0);
  checkEqual('★★★★★ 而且三條都綠', box.report.passedCount, 3);
}

// =====================================================================
console.log('\n=== B1【核心】三段時間加埋一定等於總數 ===');
{
  const box = machine({
    resetMs: 200000, scenarioMs: 3000, invariantMs: 1000,
    scenarios: [{ id: 'X1', status: 'PASSED' }, { id: 'X2', status: 'PASSED' }]
  });
  const r = box.report;
  checkEqual('★★★★★★ **清理 ＋ 情境 ＋ 不變量 ＝ 總數**'
    + '——兩個數各自量一次嘅話，兩邊會唔對，而幹事會問邊個先啱',
    r.resetMs + r.scenarioMs + r.invariantMs, r.totalMs);
  checkEqual('★★★★★★ 而且清理嗰段真係計到（200 秒）', r.resetMs, 200000);
  check('★★★★★★ 三段都大過零——邊一段係零，就代表嗰段冇計到',
    r.resetMs > 0 && r.scenarioMs > 0 && r.invariantMs > 0,
    JSON.stringify({ reset: r.resetMs, scenario: r.scenarioMs, inv: r.invariantMs }));
  check('★★★★★★ 報告印齊三段',
    /時間：用了 .*（清理 .*／情境 .*／不變量 .*）/.test(box.lines),
    box.lines.slice(-400));
  check('★★★★★ 而且清理嗰段印咗「3 分 20 秒」',
    /清理 3 分 20 秒/.test(box.lines), box.lines.slice(-400));
}

// =====================================================================
console.log('\n=== B2【核心】尾句兩種情況一齊印，唔好估 ===');
{
  const box = machine({
    scenarios: [{ id: 'X1', status: 'FAILED' }, { id: 'X2', status: 'PASSED' }]
  });
  check('★★★★★★ **「你改過程式碼」嗰行印咗**'
    + '——部機器睇唔到 Ivan 有冇 clasp push 過，'
    + '估唔到就唔好扮估到。指示錯咗兩次，佢照住撳，白撳',
    /・你改過程式碼（有 clasp push 過） ⇒ 按「⚠️ 執行自測」從頭執行/.test(box.lines),
    box.lines.slice(-500));
  check('★★★★★★ 「你冇改過碼」嗰行都印咗',
    /・你沒有改過程式碼，只是修了工作表的資料 ⇒ 按「▶️ 只重新執行紅色情境」/
      .test(box.lines), box.lines.slice(-500));
  check('★★★★★ 全綠嗰陣唔會印呢兩行',
    !/・你改過程式碼/.test(
      machine({ scenarios: [{ id: 'X1', status: 'PASSED' }] }).lines), '');
}

// =====================================================================
console.log('\n=== B1 重設摘要要講埋清走咗幾多自測殘留 ===');
{
  const box = machine({ scenarios: [{ id: 'X1', status: 'PASSED' }] });
  check('★★★★★ 講得出自測特殊主日同回傳值紀錄清咗幾多行',
    /自測特殊主日 3 行/.test(box.lines) && /上一次的回傳值紀錄 120 行/.test(box.lines),
    box.lines.slice(0, 500));
}

// =====================================================================
console.log('\n=== B3【核心】S14 upsert：搵到就覆寫，搵唔到先 append ===');
{
  // ⚠️ 現場：每次全新跑 append 多一行，S15 只熄返自己嗰行。
  // 積咗 3 行（兩行仲 Active=TRUE），生成嗰陣出
  // 「2／3 個特殊主日未確認」重覆警告。
  const S = loadGasSource(['Constants.gs']).COLUMNS.SPECIAL_SUNDAYS;
  const headers = [S.SPECIAL_ID, S.QUARTER_ID, S.SERVICE_DATE, S.TYPE,
    S.TITLE, S.SKIP_POST_IDS, S.ACTIVE, S.CONFIRMED];

  const runS14 = function (existingIds) {
    const gas = loadGasSource(FILES);
    const appended = [];
    const overwritten = [];
    gas.log_ = function () {};
    gas.selfTestRecordPayload_ = function () {};
    gas.getConfig = function () { return 'Asia/Hong_Kong'; };
    gas.readServiceDatesNormalized = function () {
      return [{ serviceDate: '2028-07-02' }];
    };
    gas.findLatestVersionNo = function () { return 1; };
    // 重新生成／驗證嗰幾段唔係呢一條要驗嘅嘢，全部短路。
    gas.apiGenerateRoster = function () { throw new Error('（測試到此為止）'); };
    gas.SpreadsheetApp = {
      getActiveSpreadsheet: function () {
        return { getSheetByName: function () {
          return {
            getLastRow: function () { return 2 + existingIds.length; },
            getLastColumn: function () { return headers.length; },
            getRange: function (row, col, numRows, numCols) {
              return {
                getValues: function () {
                  if (row === 2) return [headers];
                  return existingIds.slice(row - 3, row - 3 + numRows)
                    .map(function (id) { return [id]; });
                },
                setValues: function (v) { overwritten.push({ row: row, values: v[0] }); }
              };
            },
            appendRow: function (r) { appended.push(r); }
          };
        } };
      }
    };
    let threw = '';
    try { gas.selfTestS14_('2028T3'); } catch (err) { threw = err.message; }
    return { appended: appended, overwritten: overwritten, threw: threw };
  };

  const fresh = runS14([]);
  checkEqual('★★★★★ 一行都冇 ⇒ append 一行', fresh.appended.length, 1);
  checkEqual('★★★★★ 而且冇覆寫任何嘢', fresh.overwritten.length, 0);

  const again = runS14(['2028T3-SELFTEST']);
  checkEqual('★★★★★★ **已經有嗰一行 ⇒ 覆寫，唔再 append**'
    + '——舊寫法每次全新跑都 append 多一行，'
    + '積咗 3 行之後生成嗰陣出「2／3 個特殊主日未確認」重覆警告',
    again.appended.length, 0);
  checkEqual('★★★★★★ 覆寫嘅係搵到嗰一行（第 3 行）',
    again.overwritten.length && again.overwritten[0].row, 3);
  checkEqual('★★★★★★ 而且 `Active` 覆寫返做 TRUE、`Confirmed` 做 FALSE'
    + '——S15 要靠呢兩個值先數得到「未確認」',
    again.overwritten[0].values[headers.indexOf(S.ACTIVE)] + '/'
      + again.overwritten[0].values[headers.indexOf(S.CONFIRMED)],
    'TRUE/FALSE');
  checkEqual('★★★★★ 而且 `SkipPostIDs` 都寫返',
    again.overwritten[0].values[headers.indexOf(S.SKIP_POST_IDS)], 'CHAIR');

  const third = runS14(['2028T3-OTHER', '2028T3-SELFTEST']);
  checkEqual('★★★★★★ 中間夾住第二行都搵得返（第 4 行）'
    + '——搵錯行就會覆寫咗一行真資料',
    third.overwritten.length && third.overwritten[0].row, 4);
  checkEqual('★★★★★ 一樣冇 append', third.appended.length, 0);
}

// =====================================================================
console.log('\n=== B3【核心】清 SpecialSundays：兩個條件都要中先刪 ===');
{
  const gas = loadGasSource(FILES);
  const S = gas.COLUMNS.SPECIAL_SUNDAYS;
  const headers = [S.SPECIAL_ID, S.QUARTER_ID, S.SERVICE_DATE, S.TYPE,
    S.TITLE, S.SKIP_POST_IDS, S.ACTIVE, S.CONFIRMED];
  // 第六十五輪批次 AA 組：改成一段一段刪之後，相連嘅兩行會變成一段，
  // 「由下而上」就驗唔到——所以兩行 SELFTEST 中間夾一行真資料（第 3、5 行，兩段）。
  const rows = [
    ['2028T3-SELFTEST', '2028T3', '2028-07-02', '合堂', 'x', 'CHAIR', 'TRUE', 'FALSE'],
    // ⚠️ 沙盒季度，但**唔係** -SELFTEST ⇒ 真資料，唔准刪。
    ['2028T3-EASTER', '2028T3', '2028-07-16', '節期', '復活節', '', 'TRUE', 'TRUE'],
    ['2028T3-SELFTEST', '2028T3', '2028-07-09', '合堂', 'x', 'CHAIR', 'TRUE', 'FALSE'],
    // ⚠️ 係 -SELFTEST，但**唔係**沙盒季度 ⇒ 唔准刪。
    ['2026T4-SELFTEST', '2026T4', '2026-11-01', '合堂', 'x', 'CHAIR', 'TRUE', 'FALSE']
  ];
  const deleted = [];
  const audits = [];
  gas.log_ = function () {};
  gas.writeAuditLog_ = function (e) { audits.push(e); };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function () {
          return {
            getLastRow: function () { return 2 + rows.length; },
            getLastColumn: function () { return headers.length; },
            getRange: function (row, col, numRows, numCols) {
              return {
                getValues: function () {
                  if (row === 2) return [headers];
                  return rows.slice(row - 3, row - 3 + numRows);
                }
              };
            },
            deleteRow: function (r) { deleted.push(r); },
            // 第六十五輪批次 AA 組：一段一段刪——逐行記低（由下而上）
            deleteRows: function (from, count) {
              for (let r = from + count - 1; r >= from; r--) deleted.push(r);
            }
          };
        }
      };
    }
  };

  const count = gas.deleteSelfTestSpecialSundays_('2028T3');
  checkEqual('★★★★★★ 刪咗 2 行（兩個條件都中嗰兩行）', count, 2);
  checkEqual('★★★★★★ **由下而上刪**'
    + '——由上而下刪嘅話，刪完一行之後下面每一行都會向上移一格，'
    + '而之後嗰幾個行號就全部錯晒',
    deleted.join('、'), '5、3');
  check('★★★★★★ **一行真資料都冇刪到**'
    + '——只對 `-SELFTEST` 嘅話，一行改錯咗名嘅真資料就會被刪；'
    + '只對季度嘅話，沙盒季度入面一行真嘅特殊主日就會被刪',
    deleted.indexOf(4) === -1 && deleted.indexOf(6) === -1, deleted.join('、'));
  checkEqual('★★★★★ 而且寫咗一筆 AuditLog', audits.length, 1);
  check('★★★★★ 佢講得出刪咗邊幾行',
    /2028T3-SELFTEST/.test(audits[0].oldValue)
      && /已刪除 2 行/.test(audits[0].newValue), JSON.stringify(audits[0]));
}

// =====================================================================
console.log('\n=== B3 一行 SELFTEST 都冇 ⇒ 唔好刪、唔好寫 AuditLog ===');
{
  const gas = loadGasSource(FILES);
  const S = gas.COLUMNS.SPECIAL_SUNDAYS;
  const headers = [S.SPECIAL_ID, S.QUARTER_ID];
  const rows = [['2028T3-EASTER', '2028T3']];
  const deleted = [];
  const audits = [];
  gas.log_ = function () {};
  gas.writeAuditLog_ = function (e) { audits.push(e); };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { getSheetByName: function () {
        return {
          getLastRow: function () { return 2 + rows.length; },
          getLastColumn: function () { return headers.length; },
          getRange: function (row, col, numRows) {
            return { getValues: function () {
              return row === 2 ? [headers] : rows.slice(row - 3, row - 3 + numRows);
            } };
          },
          deleteRow: function (r) { deleted.push(r); },
          deleteRows: function (from, count) {
            for (let r = from + count - 1; r >= from; r--) deleted.push(r);
          }
        };
      } };
    }
  };
  checkEqual('★★★★★★ 冇嘢刪', gas.deleteSelfTestSpecialSundays_('2028T3'), 0);
  checkEqual('★★★★★ 一行都冇刪', deleted.length, 0);
  checkEqual('★★★★★★ 而且冇寫一筆「刪咗 0 行」嘅 AuditLog'
    + '——每次跑都寫一筆空紀錄嘅話，AuditLog 就會變成雜訊',
    audits.length, 0);
}

// =====================================================================
console.log('\n=== C【核心】清 payloads：清之前要留低一行摘要 ===');
{
  const gas = loadGasSource(FILES);
  const audits = [];
  let deletedFrom = 0;
  let deletedCount = 0;
  const data = [['S03', 'apiA'], ['S03', 'apiB'], ['S05', 'apiC']];
  gas.log_ = function () {};
  gas.writeAuditLog_ = function (e) { audits.push(e); };
  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { getSheetByName: function () {
        return {
          getLastRow: function () { return 1 + data.length; },
          getLastColumn: function () { return 2; },
          getRange: function (row, col, numRows) {
            return { getValues: function () {
              if (row === 1) return [['情境', 'API']];
              return data.slice(row - 2, row - 2 + numRows)
                .map(function (r) { return [r[col - 1]]; });
            } };
          },
          deleteRows: function (from, count) { deletedFrom = from; deletedCount = count; }
        };
      } };
    }
  };

  checkEqual('★★★★★★ 清咗 3 行', gas.clearSelfTestPayloads_(), 3);
  checkEqual('★★★★★ 由第 2 行起清（第 1 行係標題）',
    deletedFrom + '/' + deletedCount, '2/3');
  checkEqual('★★★★★★ **清之前留低咗一行摘要**'
    + '——清咗就冇得追返，而「上一次到底叫過幾多個 API」'
    + '係一條事後會想知嘅資料',
    audits.length, 1);
  check('★★★★★★ 而且摘要逐條情境數得出',
    /S03×2/.test(audits[0].newValue) && /S05×1/.test(audits[0].newValue),
    JSON.stringify(audits[0]));
  // ⚠️ `action` 都要驗——一筆冇 action 嘅稽核紀錄事後搵唔返。
  checkEqual('★★★★★ 而且 `action` 說得出佢係咩',
    audits[0].action, '清除上一次自測的回傳值紀錄');
  check('★★★★★ 同埋講得出本來有幾多行',
    /3 行/.test(audits[0].oldValue), JSON.stringify(audits[0]));
}

// =====================================================================
console.log('\n=== C【核心】太長就由最舊嗰邊剪起 ===');
{
  const gas = loadGasSource(FILES);
  const cap = gas.SELFTEST_PAYLOAD_MAX_ROWS;
  let trimmed = null;
  const sheet = function (rowCount) {
    return {
      getLastRow: function () { return rowCount + 1; },
      deleteRows: function (from, count) { trimmed = { from: from, count: count }; }
    };
  };

  gas.trimSelfTestPayloads_(sheet(cap));
  checkEqual('★★★★★ 啱啱到上限 ⇒ 唔剪', trimmed, null);

  gas.trimSelfTestPayloads_(sheet(cap + 7));
  check('★★★★★★ **超過上限 ⇒ 由第 2 行（最舊嗰行）起剪**'
    + '——由最新嗰邊剪嘅話，剪走嘅正正係今次跑嗰批，'
    + '而下一輪要靠嗰批原文',
    trimmed && trimmed.from === 2 && trimmed.count === 7,
    JSON.stringify(trimmed));
  checkEqual('★★★★★ 剪完啱啱好係上限', cap + 7 - (trimmed ? trimmed.count : 0), cap);
}

// =====================================================================
console.log('\n=== C 清唔到唔可以令成次執行爆 ===');
{
  const gas = loadGasSource(FILES);
  const warns = [];
  gas.log_ = function (level, msg) { warns.push(level + '：' + msg); };
  gas.deleteSelfTestSpecialSundays_ = function () { throw new Error('表被鎖住'); };
  gas.clearSelfTestPayloads_ = function () { throw new Error('讀唔到'); };
  let threw = '';
  let out = null;
  try { out = gas.selfTestResetOwnSheets_('2028T3'); } catch (err) { threw = err.message; }
  checkEqual('★★★★★★ 冇拋出去'
    + '——清理係收身動作，唔應該令成次自測跑唔到', threw, '');
  checkEqual('★★★★★ 兩個數都回 0', out.specialSundayRowsDeleted + '/'
    + out.payloadRowsDeleted, '0/0');
  checkEqual('★★★★★★ **但兩次都留低咗一句 WARN**'
    + '——靜靜過嘅話，殘留會一直積落去而冇人知',
    warns.length, 2);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
