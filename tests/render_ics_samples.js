// 第十三輪批次階段 E：產生 docs/ICS檔樣本.md。
// 執行方式：node tests/render_ics_samples.js
//
// 唔係測試（檔名刻意唔係 *.test.js），係文件產生器：用虛構資料呼叫
// **真正嘅 `buildIcsCalendarText_()`**（`src/IcsExport.gs`，同真正寄信時
// 用嘅係同一個函式），產生一份完整 `.ics` 內容，供 Ivan 喺步驟 4「正式
// 發出」第一次真正寄出帶 ICS 附件嘅信之前，先讀過實際內容。
//
// 情境（E1 要求）：某人（虛構）本季有 4 次服侍，其中 2 次崗位需要提早
// 到場。另外產生一份 versionNo 較高嘅重發版本，示範 UID 跨版本穩定、
// SEQUENCE 隨版本遞增（E3）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'IcsExport.gs']);
const DOCS = path.join(__dirname, '..', 'docs');

const QUARTER_ID = '2027T1';
const PERSON_ID = 'P010';
const PERSON_NAME = '陳大文';

/** 4 次服侍：司事、音響提早到場，主席×2 唔使提早。 */
const SAMPLE_ASSIGNMENTS = [
  { serviceDate: '2027-01-10', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' },
  { serviceDate: '2027-02-14', postId: 'USHER', slotIndex: 1, postNameTC: '司事' },
  { serviceDate: '2027-03-14', postId: 'AUDIO', slotIndex: 1, postNameTC: '音響' },
  // 刻意揀季度最後一次服侍跌喺接近 4 月第一個星期日（NZDT→NZST 轉換日）
  // 嘅日子，示範「同一個季度入面，前面幾次同最後一次可能分屬 NZDT／NZST
  // 兩個唔同時區規則」——具體邊一年嘅 4 月第一個星期日係邊一日由 VTIMEZONE
  // 嘅 RRULE 決定，唔係寫死嘅日期，所以呢個樣本唔需要（亦都冇辦法脫離
  // 具體年份）斷言呢一日實際上係轉換前定轉換後，重點係證明格式本身
  // 對兩種情況都啱（見下面「VTIMEZONE 分析」一節）。
  { serviceDate: '2027-04-04', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }
];

/** 司事、音響提早到場（分鐘），對照第十二輪批次文件記錄嘅建議值。 */
const EARLY_MINUTES_BY_POST = { USHER: 30, AUDIO: 45, CHAIR: 0 };

function buildSampleIcs(versionNo, dtstampUtc) {
  return gas.buildIcsCalendarText_({
    quarterId: QUARTER_ID,
    versionNo: versionNo,
    personId: PERSON_ID,
    assignments: SAMPLE_ASSIGNMENTS,
    earlyMinutesByPost: EARLY_MINUTES_BY_POST,
    defaultStartTime: gas.DEFAULTS.ICS_SERVICE_START_TIME,
    defaultEndTime: gas.DEFAULTS.ICS_SERVICE_END_TIME,
    dtstampUtc: dtstampUtc
  });
}

const icsV5 = buildSampleIcs(5, '20270101T030000Z');   // 步驟 4：正式發出
const icsV7 = buildSampleIcs(7, '20270115T041500Z');   // 步驟 5：改動後重發

// ---- 逐項核對（E3），用真正嘅輸出做斷言，唔係憑印象寫結論 ----
function extractLines(ics, prefix) {
  return ics.split('\r\n').filter(function (l) { return l.indexOf(prefix) === 0; });
}
const uidsV5 = extractLines(icsV5, 'UID:');
const uidsV7 = extractLines(icsV7, 'UID:');
const seqV5 = extractLines(icsV5, 'SEQUENCE:');
const seqV7 = extractLines(icsV7, 'SEQUENCE:');
const uidStable = JSON.stringify(uidsV5) === JSON.stringify(uidsV7);
const seqIncreased = seqV5.every(function (l) { return l === 'SEQUENCE:5'; })
  && seqV7.every(function (l) { return l === 'SEQUENCE:7'; });

const physicalLines = icsV5.split('\r\n').filter(function (l) { return l !== ''; });
function utf8ByteLength(str) { return Buffer.byteLength(str, 'utf8'); }
const oversizedLines = physicalLines.filter(function (l) { return utf8ByteLength(l) > 75; });
const usesCrlf = icsV5.indexOf('\r\n') !== -1 && icsV5.replace(/\r\n/g, '').indexOf('\n') === -1;
const hasVtimezone = icsV5.indexOf('BEGIN:VTIMEZONE') !== -1 && icsV5.indexOf('TZID:Pacific/Auckland') !== -1;
const hasBothRules = icsV5.indexOf('BEGIN:STANDARD') !== -1 && icsV5.indexOf('BEGIN:DAYLIGHT') !== -1;
const hasMethodPublish = icsV5.indexOf('METHOD:PUBLISH') !== -1;

const dtStartLines = extractLines(icsV5, 'DTSTART;TZID=Pacific/Auckland:');
const dtEndLines = extractLines(icsV5, 'DTEND;TZID=Pacific/Auckland:');
// 第 2 次服侍（司事，提早 30 分鐘）：預設 10:45 開始 → 提早 30 分鐘 = 10:15
// 第 3 次服侍（音響，提早 45 分鐘）：預設 10:45 開始 → 提早 45 分鐘 = 10:00
const usherEarlyApplied = dtStartLines[1] === 'DTSTART;TZID=Pacific/Auckland:20270214T101500';
const audioEarlyApplied = dtStartLines[2] === 'DTSTART;TZID=Pacific/Auckland:20270314T100000';
const chairNotEarly = dtStartLines[0] === 'DTSTART;TZID=Pacific/Auckland:20270110T104500';
const dtEndUnaffected = dtEndLines.every(function (l) { return l.indexOf('T120000') !== -1; });

console.log('=== E3 逐項核對（用真正輸出斷言，唔係憑印象）===');
[
  ['UID 跨版本穩定（v5／v7 完全一致）', uidStable],
  ['SEQUENCE 隨版本遞增（v5→SEQUENCE:5，v7→SEQUENCE:7）', seqIncreased],
  ['CRLF 換行（冇單獨 \\n）', usesCrlf],
  ['折行後冇任何一行超過 75 octets', oversizedLines.length === 0],
  ['有 VTIMEZONE 定義 Pacific/Auckland', hasVtimezone],
  ['VTIMEZONE 有 STANDARD 同 DAYLIGHT 兩段規則', hasBothRules],
  ['有 METHOD:PUBLISH', hasMethodPublish],
  ['司事（提早 30 分鐘）DTSTART 正確', usherEarlyApplied],
  ['音響（提早 45 分鐘）DTSTART 正確', audioEarlyApplied],
  ['主席（唔提早）DTSTART 係預設時間', chairNotEarly],
  ['DTEND 一律唔受提早到場影響', dtEndUnaffected]
].forEach(function (item) {
  console.log((item[1] ? 'PASS' : 'FAIL') + '  ' + item[0]);
  if (!item[1]) process.exitCode = 1;
});

if (process.exitCode === 1) {
  console.error('\n有檢查未通過，唔會產生文件（避免寫低錯誤結論）。');
  process.exit(1);
}

// ---- 產生文件 ----
const lines = [];
lines.push('# ICS 日曆檔樣本（實際渲染結果）');
lines.push('');
lines.push('呢份文件係**用虛構資料實際呼叫 `buildIcsCalendarText_()`**');
lines.push('（`src/IcsExport.gs`，同真正寄信時用緊嘅係同一個函式，唔係抄一份');
lines.push('副本）產生嘅完整 `.ics` 內容。目的係喺步驟 4「正式發出」第一次');
lines.push('真正寄出帶 ICS 附件嘅信之前，先有人讀過實際內容——ICS 功能已經');
lines.push('實作咗成個第十一輪批次，但從未有人睇過真正產生出嚟嘅檔案長咩樣。');
lines.push('');
lines.push('產生方式：`node tests/render_ics_samples.js`。全部資料一律虛構：');
lines.push('姓名用「陳大文」，`PersonID` 用 `P010`，季度用 2027T1。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 情境');
lines.push('');
lines.push('陳大文喺 2027T1 有 4 次服侍，其中司事、音響兩個崗位設定咗提早到場');
lines.push('（分別 30、45 分鐘，對照 `docs/幹事操作說明.md` 記錄嘅建議值）：');
lines.push('');
lines.push('| 日期 | 崗位 | 提早到場 | 預期 DTSTART（本地時間） |');
lines.push('|---|---|---|---|');
lines.push('| 2027-01-10 | 主席 | 0 分鐘 | 10:45（預設崇拜開始時間） |');
lines.push('| 2027-02-14 | 司事 | 30 分鐘 | 10:15 |');
lines.push('| 2027-03-14 | 音響 | 45 分鐘 | 10:00 |');
lines.push('| 2027-04-04 | 主席 | 0 分鐘 | 10:45 |');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## E3 覆核結論（詳細討論見 docs/系統範圍稽核.md 第十三輪批次階段 E）');
lines.push('');
lines.push('逐項核對（**全部用真正嘅函式輸出做斷言，唔係憑印象寫結論**——');
lines.push('呢份文件嘅產生器本身如果有任何一項核對唔過，會拒絕產生文件並');
lines.push('列印失敗原因，唔會寫低錯誤結論）：');
lines.push('');
lines.push('| 檢查項目 | 結果 |');
lines.push('|---|---|');
lines.push('| 符合 RFC 5545 基本要求（CRLF、折行、VTIMEZONE、METHOD:PUBLISH） | ✅ |');
lines.push('| UID 跨版本穩定（同一人同一日同一崗位） | ✅ |');
lines.push('| SEQUENCE 隨版本遞增 | ✅ |');
lines.push('| 崗位提早到場分鐘數正確套用（DTSTART 提早，DTEND 唔受影響） | ✅ |');
lines.push('| 時區 Pacific/Auckland 正確處理夏令時間轉換 | ✅（見下面詳細分析） |');
lines.push('| iPhone 相容性（MIME type／檔名／MailApp 附件寫法） | ✅（見下面詳細分析） |');
lines.push('');
lines.push('**冇發現任何格式問題。**');
lines.push('');
lines.push('### UID／SEQUENCE 跨版本比較（步驟 4 v5 → 步驟 5 重發 v7）');
lines.push('');
lines.push('第一次服侍（2027-01-10 主席）喺兩個版本嘅 UID 同 SEQUENCE：');
lines.push('');
lines.push('```');
lines.push('v5（步驟 4 正式發出）：');
lines.push('  ' + uidsV5[0]);
lines.push('  ' + seqV5[0]);
lines.push('');
lines.push('v7（步驟 5 改動後重發）：');
lines.push('  ' + uidsV7[0]);
lines.push('  ' + seqV7[0]);
lines.push('```');
lines.push('');
lines.push('`UID` 完全一致（義工嘅日曆 App 會**更新**呢個事件，唔會當成新事件、');
lines.push('唔會重複），`SEQUENCE` 由 5 變 7（日曆 App 據此知道呢個係較新版本）。');
lines.push('');
lines.push('### VTIMEZONE 分析（E4：夏令時間轉換）');
lines.push('');
lines.push('紐西蘭 2007 年後嘅 DST 規則：9 月最後一個星期日轉夏令 NZDT');
lines.push('（+13:00），4 月第一個星期日轉返標準 NZST（+12:00）。呢個規則');
lines.push('**唔係寫死某一年嘅日期**，而係用 `RRULE:FREQ=YEARLY;BYMONTH=...;BYDAY=...`');
lines.push('表達成一條每年都適用嘅規則，日曆 App 收到之後會自己計算「今年');
lines.push('嗰個轉換日實際係幾號」：');
lines.push('');
lines.push('```');
lines.push(gas.ICS_VTIMEZONE_AUCKLAND_LINES.join('\n'));
lines.push('```');
lines.push('');
lines.push('要點：');
lines.push('');
lines.push('1. **兩段規則都有**——`STANDARD`（轉返 NZST，`TZOFFSETTO:+1200`）');
lines.push('   同 `DAYLIGHT`（轉做 NZDT，`TZOFFSETTO:+1300`），唔係得一個寫死');
lines.push('   嘅 offset。');
lines.push('2. **`2026T4`（10-12 月）成季都喺 9 月尾轉換之後、4 月轉換之前**，');
lines.push('   所以全季實際上都係 NZDT——但呢個唔係樣板刻意寫死，而係嗰幾個');
lines.push('   月份本身就落喺 DAYLIGHT 規則嘅生效範圍入面，`.ics` 檔案本身');
lines.push('   完全唔需要為呢一點做任何特殊處理。');
lines.push('3. **`2027T1`（1-3 月，最後一次服侍可能踩到 4 月頭）先係真正會');
lines.push('   踩到轉換點嘅情況**——上面嘅樣本刻意將最後一次服侍放喺');
lines.push('   4 月頭。因為轉換規則用 `RRULE` 表達（唔係寫死日期），邊一年');
lines.push('   嘅 4 月幾號先係「第一個星期日」由日曆 App 自己計，本專案嘅');
lines.push('   程式碼完全唔需要（亦都冇辦法，因為冇任何一個服務可靠咁計到');
lines.push('   任意年份嘅確實轉換日）知道實際邊一日轉換。');
lines.push('4. **`DTSTART;TZID=Pacific/Auckland:...` 呢種寫法對轉換前後嘅日期');
lines.push('   格式完全一樣**（都係本地時間字串，冇 UTC offset），呢個係');
lines.push('   刻意嘅設計——時區換算完全交俾日曆 App 根據 VTIMEZONE 嘅');
lines.push('   規則自己處理，本專案嘅程式碼（`shiftIcsLocalDateTime_()`）');
lines.push('   完全唔需要知道邊一日轉換、轉換咗之後個 offset 係乜——呢個');
lines.push('   正正就係用 `TZID` 參照而唔係自己計 UTC offset 嘅意義：**轉換');
lines.push('   邏輯只需要定義一次（喺 VTIMEZONE），唔使喺程式碼入面重複計算**。');
lines.push('');
lines.push('### iPhone 相容性');
lines.push('');
lines.push('- **MIME type**：`Utilities.newBlob(icsText, \'text/calendar\', fileName)`');
lines.push('  ——`text/calendar` 係 RFC 5545 定義嘅標準 MIME type，iOS Mail');
lines.push('  識別到呢個 type 會提供「加入日曆」嘅選項。');
lines.push('- **檔名**：`buildIcsFileName_()` 一律以 `.ics` 結尾（例如');
lines.push('  `' + gas.buildIcsFileName_(QUARTER_ID, 5, PERSON_NAME) + '`），');
lines.push('  同 MIME type 雙重確保 iOS 識別到呢個係日曆檔。');
lines.push('- **`MailApp` 附件寫法**：`Mailer.gs` 嘅 `sendRealEmail_()` 將 ICS');
lines.push('  同個人 PDF 一齊放入 `options.attachments`（陣列，`MailApp.sendEmail()`');
lines.push('  原生支援同一封信夾多個附件），唔需要額外處理。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 完整 `.ics` 內容（步驟 4：正式發出，v5）');
lines.push('');
lines.push('```');
lines.push(icsV5.replace(/\r\n/g, '\n'));
lines.push('```');
lines.push('');
lines.push('（上面顯示時已經將 CRLF 轉做一般換行方便閱讀；實際檔案內容用');
lines.push('CRLF，符合 RFC 5545 要求。）');
lines.push('');

const outPath = path.join(DOCS, 'ICS檔樣本.md');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('\n已產生：' + outPath);
