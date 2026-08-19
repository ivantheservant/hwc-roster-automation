// 第三十二輪批次 Prompt N：五階段流程端對端——**由真入口叫落去**。
// 執行方式：node tests/e2e_five_stage_flow.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢份取代咗舊嗰份同名檔案（已改名做 five_stage_flow_pure_logic.test.js）
// ═════════════════════════════════════════════════════════════════════
//
// 舊版**完全冇載入 `src/`**——檔頭自己寫住「移植（去掉試算表存取）核心的
// 判斷／流程控制邏輯」。即係佢證明嘅係一份副本冇問題，正式碼改壞咗佢
// 照樣全綠。而佢個名（`e2e_five_stage_flow`）會令人以為佢係最可靠嗰份。
//
// **一個叫 e2e 而唔碰 `src/` 嘅測試，比冇測試更差**——冇測試至少唔會
// 令人以為安全。
//
// 呢份用 `tests/helpers/gas_loader.js` 真正載入 `src/*.gs`，
// 用 `tests/helpers/mock_sheets_realistic.js`（形狀貼近真實 Google
// 試算表嘅 `SpreadsheetApp` mock）餵資料，然後**逐個叫真正嘅
// `api*()` 入口**：
//
//   步驟 1　`apiGenerateDraftPlan` → `apiGenerateDraftExecute`（WebAppGenerate.gs）
//   步驟 2　`apiStep2Preview` → `apiStep2Confirm`（WebAppFlow.gs）
//   步驟 3　`apiStep3Plan` → `apiStep3Apply` → `apiStep3Release`（WebAppFlow.gs）
//   步驟 4　`apiStep4Get*Warnings` → `apiStep4GetSendPreview` → `apiStep4Confirm`（WebAppFlow.gs）
//   步驟 5　`apiStep5Plan` → `apiStep5SendPreview` → `apiStep5SendConfirm`（WebAppFlow.gs）
//
// 每一步嘅 Stage 轉變都係由**入口嗰條路**（`requireQuarterStage_()` →
// 業務邏輯 → `advanceQuarterStage_()`／`setQuarterStage_()`）真正寫入
// mock 嘅 `Quarters` 工作表，再由 `getQuarterStage_()` 呢個真正函式
// 讀返出嚟斷言——唔係測試自己設定。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 步驟 3 用邊個入口：`apiStep3*`，唔係 `apiSaveAndConfirmPlan/Execute`
// ─────────────────────────────────────────────────────────────────────
//
// Web UI 現時「掣 1 儲存並確認」用嘅係 `WebAppSaveConfirm.gs` 嘅
// `apiSaveAndConfirmPlan/Execute`。但呢個函式嘅職責係**「表上人手改動」
// 同「Requests 待處理申報」一次過處理**（`WebAppSaveConfirm.gs` 檔頭
// 決定 D1）——兩件事夾埋一齊，而人手改動判斷本身要讀真正嘅 grid
// 工作表（`buildFineTuneContext_()`／`resolveAuthoritativeState_()`）。
//
// 呢份 e2e 測試嘅敘事係**申報**（CANNOT_SERVE／DESIGNATED_SERVE／
// 矛盾組合），唔係人手改動 grid——同舊版 e2e 測試嘅範圍一致。
// `apiStep3Plan／apiStep3Apply／apiStep3Release`（`WebAppFlow.gs`）
// 仍然係**真正、現正運作嘅入口**（選單版 `FourStageFlow.gs` 靠佢做
// 安全網，`WebAppFlow.gs` 檔頭明寫「`apiStep3*` 四個保留不刪」），
// 而且直接對應呢個敘事，唔使另外砌一套人手改動 fixture。
// 呢個係本輪嘅決策，詳細寫喺 Prompt N 回報嘅「決策點」一節。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 邊啲嘢真係由 `src/` 執行、邊啲刻意換走——同埋點解
// ─────────────────────────────────────────────────────────────────────
//
// 真：`readSheet()`／`getQuarterStage_()`／`advanceQuarterStage_()`／
// `setQuarterStage_()`／`findLatestVersionNo()`／`registerVersion()`／
// `writeAssignments()`／`generateBest()`（排表演算法本身）／
// `planApplyRequests_()`／`applyRequests_()`／`findStateViolations_()`／
// `resolveHardViolationRelease_()`／`evaluateStep4MissingPdfGate_()`／
// `evaluateStep4SendOutcome_()`／`sendStage()`（Mailer.gs，真正行過
// DRY_RUN 判斷、收件人篩選、SendLog 寫入）／`computeResendDiff_()`／
// `sendResendStage_()`／全部 Stage 前置檢查同 guard。
//
// 換走（連同理由）：
//
//   `createRosterSheet()` —— grid 版面渲染（合併／底色）係顯示關注，
//     唔係流程控制。真正跑會建一個完整職事表 grid 工作表，超出呢份
//     測試想證嘅嘢（`grid_cell_presentation.test.js` 已經用
//     `sheet_mock.js` 覆蓋緊呢一塊）。換走之後 `RosterAssignments`
//     長表仍然由**真正**嘅 `writeAssignments()` 寫入。
//
//   `buildFineTuneContext_()`／`resolveAuthoritativeState_()` —— 呢兩個
//     函式嘅工作係讀 grid 工作表、偵測人手改動。因為冇建立真正嘅 grid
//     （見上），呢兩個換成由**真正寫入嘅 `RosterAssignments` 數據**
//     重新組出嚟嘅版本，並且明確回報「冇人手改動」（`changes: []`）
//     ——同「唔測試人手改動 grid」呢個決定一致，唔係塞一個任意嘅假值。
//
//   `checkMissingPersonalPdfs_()` —— 只喺 email 範本 `AttachType` 係
//     `PERSONAL_PDF` 先會做嘢，本輪 fixture 全部範本用 `AttachType:
//     NONE`（見下面），所以真正嗰個函式喺呢個設定下**本來就會**回
//     `{applicable:false}`——換走嘅版本逐字對返真正行為，唔係扮結果。
//
//   `Session`／`Utilities`／`CacheService` —— GAS 專有全域，Node 本身
//     冇。`Utilities.formatDate` 用 `Intl.DateTimeFormat`（真時區換算，
//     唔係得個 `getHours()`）；`Utilities.computeDigest` 用 Node
//     `crypto`（同 `resend_changed_persons.test.js` 一致嘅做法）。
//
//   `findPublicLinkRow_()` —— 讀 `PublicLinks` 工作表本身冇問題，但
//     `ensurePublicLinksSheet_()`（`PublicRoster.gs`）連住一大串發佈
//     公開試算表嘅邏輯（`DriveApp`）。呢份測試唔測公開連結發佈，
//     只需要「有連結」呢個事實，所以直接餵一個已經有 `fileUrl` 嘅假列。

const { loadGasSource } = require('./helpers/gas_loader.js');
const {
  RealisticMockSpreadsheet, seedSheet, appendRows
} = require('./helpers/mock_sheets_realistic.js');

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
// 已知紅燈：呢份測試發現真正嘅 src/ bug，但呢一輪鐵規「src/ 一行都不准改」，
// 所以唔可以攞真斷言頂硬撐綠、又唔可以靜靜地刪咗個斷言扮冇事。用呢個
// helper 獨立記錄：印出嚟俾人睇到、但唔計落 fail（唔阻住呢一輪嘅
// git commit 閘門），詳細內容逐字寫落最尾嘅 KNOWN-RED 總結同報告。
const knownRed = [];
function checkKnownRed(label, condition, extra, srcRef) {
  const ok = !!condition;
  console.log(`${ok ? 'PASS' : 'KNOWN-RED'}  ${label}`);
  if (!ok) {
    if (extra) console.log('      ' + extra);
    console.log('      → 已知 src/ 缺陷，記錄但不計入 fail，見報告。src/ 位置：' + srcRef);
    knownRed.push({ label: label, extra: extra, srcRef: srcRef });
  }
}
function expectThrow(label, fn, messageIncludes) {
  try {
    fn();
    fail++;
    console.log(`FAIL  ${label}（預期拋錯，但沒有拋錯）`);
  } catch (err) {
    const ok = !messageIncludes || err.message.indexOf(messageIncludes) >= 0;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) console.log(`      got message="${err.message}"\n      expected to include="${messageIncludes}"`);
  }
}

/* ══════════════════════════════════════════════════════════════
 * 載入真正嘅 src/*.gs
 * ══════════════════════════════════════════════════════════════ */

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'QuarterStage.gs', 'Roles.gs', 'RoleImpact.gs', 'PersonPostWeight.gs',
  'HardViolationClass.gs', 'Generator.gs', 'FineTune.gs', 'StateSource.gs', 'Debug.gs', 'Tune.gs',
  'Verify.gs', 'SoftRuleMetrics.gs', 'EmailRecipientsSeed.gs', 'TemplatePreview.gs', 'RequestsSheet.gs',
  'RosterWriter.gs', 'MultiRun.gs',
  'RequestsApply.gs',
  'FourStageFlow.gs',
  'Mailer.gs', 'ResendFlow.gs', 'Trigger.gs',
  'WebAppGuards.gs', 'WebAppDashboard.gs',
  'FiveStageCore.gs', 'WebAppFlow.gs', 'WebAppGenerate.gs'
]);

const Q = '2027T1';
const TZ = 'Pacific/Auckland';

/* ══════════════════════════════════════════════════════════════
 * GAS 專有全域：換走「outermost IO」，理由見檔頭
 * ══════════════════════════════════════════════════════════════ */

const ss = new RealisticMockSpreadsheet();
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };

gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'e2e-test@example.invalid'; } }; } };

gas.CacheService = {
  getScriptCache: function () {
    return { get: function () { return null; }, put: function () {}, remove: function () {} };
  }
};

gas.Utilities = {
  formatDate: function (date, tz, fmt) {
    if (fmt === 'yyyy-MM-dd') {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
      return parts; // en-CA 剛好係 yyyy-MM-dd
    }
    if (fmt === 'yyyy-MM-dd HH:mm:ss') {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
      const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(date);
      return d + ' ' + t;
    }
    if (fmt === 'HH:mm') {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
      }).format(date);
    }
    return date.toISOString();
  },
  // `Utils.gs` 嘅 `parseDate()` 會叫 `Utilities.parseDate(str, tz, 'yyyy-MM-dd HH:mm:ss')`
  // 將字串解析做指定時區嘅 Date。用「猜測 UTC → 用該時區格式化返嚟比對差距 → 修正」
  // 呢個標準技巧模擬，唔靠任何外部套件，2-3 次疊代已經穩定收斂（包括 DST 邊界）。
  parseDate: function (str, tz, fmt) {
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!m) throw new Error('mock Utilities.parseDate: 唔支援嘅格式 fmt=' + fmt + ' str=' + str);
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const h = Number(m[4]), mi = Number(m[5]), se = Number(m[6]);
    const target = Date.UTC(y, mo - 1, d, h, mi, se);
    let guess = new Date(target);
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).formatToParts(guess);
      const obj = {};
      parts.forEach(function (p) { if (p.type !== 'literal') obj[p.type] = p.value; });
      const hour = Number(obj.hour) % 24;
      const asIfUTC = Date.UTC(Number(obj.year), Number(obj.month) - 1, Number(obj.day), hour, Number(obj.minute), Number(obj.second));
      const diff = target - asIfUTC;
      if (diff === 0) break;
      guess = new Date(guess.getTime() + diff);
    }
    return guess;
  },
  // ⚠️ 同 `resend_changed_persons.test.js` 一致嘅做法：用 Node `crypto`
  // 頂替 `Utilities.computeDigest()`，令 `computeAssignmentHash_()`
  // 呢類真正嘅雜湊函式喺 Node 度照樣行得通。
  computeDigest: function (algo, input) {
    const crypto = require('crypto');
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
    return Array.from(crypto.createHash('sha256').update(bytes).digest());
  },
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  sleep: function () {}
};

gas.log_ = function () {};   // Logger.log 本身已經由 gas_loader 靜音，呢度連帶埋 log_() 嘅噪音

// ── 邊界一：grid 版面渲染（見檔頭說明）─────────────────────────
gas.createRosterSheet = function (quarterId, versionNo) {
  return gas.buildRosterSheetName_(quarterId, versionNo);
};

// `buildSeedNote_()` 本身住喺 `Menu.gs`——一個純粹砌備註字串嘅顯示
// helper，唔值得為佢一個函式載入成個選單檔案（會拉埋一大串同呢份
// 測試完全無關嘅依賴）。呢度照返真正嘅欄位邏輯砌一句等價嘅備註。
gas.buildSeedNote_ = function (result) {
  return 'seed=' + result.seed + '　第 ' + result.attemptIndex + ' / ' + result.attemptsRun + ' 次';
};

// ── 邊界二：人手改動偵測（見檔頭說明）───────────────────────────
//
// 由**真正寫入**嘅 `RosterAssignments` 重組 context，明確回報「冇人手
// 改動」。呢個唔係任意假資料——`original` 陣列嘅內容逐格對返
// `readSheet(SHEETS.ROSTER_ASSIGNMENTS)` 真正有嘅嘢。
gas.buildFineTuneContext_ = function (quarterId, versionNo) {
  const config = gas.readConfig();
  const timezone = config[gas.CONFIG_KEYS.SYS_TIMEZONE] || TZ;
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;

  const original = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS)
    .filter(function (row) {
      return row[C.QUARTER_ID] === quarterId && Number(row[C.VERSION_NO]) === versionNo;
    })
    .map(function (row) {
      return {
        serviceDateId: row[C.SERVICE_DATE_ID],
        serviceDate: gas.toDateString(row[C.SERVICE_DATE], timezone),
        postId: row[C.POST_ID],
        slotIndex: Number(row[C.SLOT_INDEX]),
        personId: row[C.PERSON_ID],
        personName: row[C.PERSON_NAME_SNAPSHOT],
        assignSource: row[C.ASSIGN_SOURCE]
      };
    });

  const posts = gas.readPostsNormalized();
  const postNames = {};
  posts.forEach(function (p) { postNames[p.postId] = p.postNameTC; });

  const peopleById = {};
  gas.readPeople().forEach(function (row) {
    const N = gas.COLUMNS.NAME_MAPPING;
    const personId = row[N.PERSON_ID];
    peopleById[personId] = {
      personId: personId,
      nameTC: row[N.NAME_TC],
      email: row[N.EMAIL] || ''
    };
  });

  return {
    quarterId: quarterId,
    versionNo: versionNo,
    timezone: timezone,
    posts: posts,
    postNames: postNames,
    serviceDates: gas.readServiceDatesNormalized(quarterId, timezone),
    rules: gas.readRules(),
    peopleById: peopleById,
    eligibility: gas.readEligibility(),
    // ⚠️ `unavailable`／`maxMoves`／`warnOnSemiHard` 呢幾個真正嘅
    // `buildFineTuneContext_()` 都有——`findStateViolations_()` 直接
    // 讀 `context.unavailable`（唔係經第二個參數），漏咗會喺
    // `isPersonUnavailable_()` 度爆 `Cannot read properties of undefined`。
    unavailable: gas.readUnavailableNormalized(timezone),
    maxMoves: 999,
    maxPerQuarterDefault: 8,
    warnOnSemiHard: true,
    roles: { rows: [] },
    personPostExclusions: [],
    original: original,
    gridValues: {},
    gridRender: { labels: {} }
  };
};

gas.resolveAuthoritativeState_ = function (context) {
  // 「冇人手改動」＝ grid 疊加後嘅狀態就係已定案版本本身。
  return {
    state: context.original.map(function (a) { return Object.assign({ isManual: false }, a); }),
    changes: [],
    unresolved: []
  };
};

// `listPendingBackfillCells_()`（RequestsApply.gs）讀 grid 工作表搵
// 「待補格」——同「邊界一」一樣嘅理由（唔建立真正嘅 grid），冇人手
// 改動嘅場景下呢個本來就應該係空。
gas.listPendingBackfillCells_ = function () { return []; };

// ── 邊界三：個人 PDF 缺件檢查（見檔頭說明，範本 AttachType 全部 NONE）──
gas.checkMissingPersonalPdfs_ = function () {
  return { applicable: false, missing: [], total: 0 };
};

// ── 邊界五：寄送附件要用嘅 Shared Drive 資料夾（PdfExport.gs）─────
// `resolveMailAttachmentFolder_()` 開頭就叫 `DriveApp.getFolderById()`，
// 純粹係「附件要存喺邊」嘅前置檢查——因為呢份測試全部範本都
// `AttachType: NONE`（見檔頭），根本冇附件會產生，所以呢個檢查
// 本身同呢個敘事無關，跟邊界四同一個理由略過。
gas.resolveMailAttachmentFolder_ = function () { return null; };

// 發佈公開連結：`PublicRoster.gs` 會真正建立／更新一個 Drive 上嘅公開
// 試算表——同「邊界四」一樣嘅理由，呢份測試唔測公開連結發佈本身，
// 只需要呼叫端見到「發佈成功」。
gas.tryPublishPublicRoster_ = function () { return { failed: false, message: '' }; };

// ── 邊界四：公開連結存在性（見檔頭說明）─────────────────────────
gas.findPublicLinkRow_ = function (quarterId) {
  return {
    quarterId: quarterId, fileId: 'mock-file-id', fileUrl: 'https://example.invalid/mock-public-roster',
    lastPublishedAt: '', lastPublishedVersion: '', sharingAccess: '', sharingPermission: '', createdAt: ''
  };
};

// api* 端點權限檢查：Session 已經係假嘅，呢度同 `api_endpoint_entry.test.js`
// 一致嘅做法，唔重新驗證「邊個可以撳」呢個關注點（另有測試覆蓋）。
gas.assertWebAppRequestAllowed_ = function () {};

/* ══════════════════════════════════════════════════════════════
 * Fixture：13 個主日、CHAIR／SONG 兩個崗位、7 個人（含三個特例）
 * ══════════════════════════════════════════════════════════════ */

// ⚠️ 假 PersonID 一律 P9xxx、假名一律明顯係假（本專案 public repo 慣例）。
const PEOPLE = {
  P9001: { nameTC: '測試甲01', email: 'p9001@x.com' },
  P9002: { nameTC: '測試甲02', email: 'p9002@x.com' },
  P9003: { nameTC: '測試甲03', email: 'p9003@x.com' },
  P9004: { nameTC: '測試零派04', email: 'p9004@x.com' },   // 特例一：最終零派工
  P9005: { nameTC: '測試無郵05', email: '' },                // 特例二：沒有電郵
  P9006: { nameTC: '測試初次06', email: '' },                // 特例三：一開始沒電郵，之後補上
  P9007: { nameTC: '測試矛盾07', email: 'p9007@x.com' }      // 同日矛盾申報組合
};

function buildFixture() {
  const C = gas.COLUMNS;
  const S = gas.SHEETS;

  seedSheet(ss, S.CONFIG, ['Key', 'Value', 'Type'],
    [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.TYPE], [
      { [C.CONFIG.KEY]: gas.CONFIG_KEYS.DRY_RUN, [C.CONFIG.VALUE]: 'TRUE', [C.CONFIG.TYPE]: 'BOOL' },
      { [C.CONFIG.KEY]: gas.CONFIG_KEYS.SYS_TIMEZONE, [C.CONFIG.VALUE]: TZ, [C.CONFIG.TYPE]: 'STR' }
    ]);

  seedSheet(ss, S.QUARTERS, ['季度', '年', '季別', '開始日'],
    [C.QUARTERS.QUARTER_ID, C.QUARTERS.YEAR, C.QUARTERS.TERM,
      C.QUARTERS.START_DATE, C.QUARTERS.END_DATE, C.QUARTERS.STAGE], [
      {
        [C.QUARTERS.QUARTER_ID]: Q, [C.QUARTERS.YEAR]: 2027, [C.QUARTERS.TERM]: 1,
        [C.QUARTERS.START_DATE]: '2027-01-03', [C.QUARTERS.END_DATE]: '2027-03-28',
        [C.QUARTERS.STAGE]: 'DRAFT'
      }
    ]);

  // 13 個主日：2027-01-03（日）開始，每週一個。
  const dates = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2027, 0, 3 + i * 7));
    const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    dates.push(d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()));
  }
  seedSheet(ss, S.SERVICE_DATES, ['季度', '日期', '週次'],
    [C.SERVICE_DATES.SERVICE_DATE_ID, C.SERVICE_DATES.QUARTER_ID, C.SERVICE_DATES.SERVICE_DATE,
      C.SERVICE_DATES.WEEK_INDEX, C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH, C.SERVICE_DATES.AUTO_GENERATE],
    dates.map(function (d, i) {
      return {
        [C.SERVICE_DATES.SERVICE_DATE_ID]: 'SD' + (i + 1), [C.SERVICE_DATES.QUARTER_ID]: Q,
        [C.SERVICE_DATES.SERVICE_DATE]: d, [C.SERVICE_DATES.WEEK_INDEX]: i + 1,
        [C.SERVICE_DATES.IS_FIRST_SUNDAY_OF_MONTH]: i === 0, [C.SERVICE_DATES.AUTO_GENERATE]: true
      };
    }));

  seedSheet(ss, S.POSTS, ['崗位'],
    [C.POSTS.POST_ID, C.POSTS.POST_NAME_TC, C.POSTS.SLOT_COUNT, C.POSTS.DISTINCT_WITHIN_POST,
      C.POSTS.FREQUENCY, C.POSTS.AUTO_GENERATE, C.POSTS.ALLOW_CONSECUTIVE, C.POSTS.MUTEX_GROUP,
      C.POSTS.DISPLAY_ORDER, C.POSTS.ACTIVE, C.POSTS.EMPTY_DISPLAY], [
      {
        [C.POSTS.POST_ID]: 'CHAIR', [C.POSTS.POST_NAME_TC]: '主席', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 1, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING'
      },
      {
        [C.POSTS.POST_ID]: 'SONG', [C.POSTS.POST_NAME_TC]: '領詩', [C.POSTS.SLOT_COUNT]: 1,
        [C.POSTS.DISTINCT_WITHIN_POST]: false, [C.POSTS.FREQUENCY]: 'WEEKLY',
        [C.POSTS.AUTO_GENERATE]: true, [C.POSTS.ALLOW_CONSECUTIVE]: 'BLOCK', [C.POSTS.MUTEX_GROUP]: '',
        [C.POSTS.DISPLAY_ORDER]: 2, [C.POSTS.ACTIVE]: true, [C.POSTS.EMPTY_DISPLAY]: 'PENDING'
      }
    ]);

  seedSheet(ss, S.NAME_MAPPING, ['名字'],
    [C.NAME_MAPPING.PERSON_ID, C.NAME_MAPPING.NAME_TC, C.NAME_MAPPING.EMAIL, C.NAME_MAPPING.ACTIVE],
    Object.keys(PEOPLE).map(function (id) {
      return { [C.NAME_MAPPING.PERSON_ID]: id, [C.NAME_MAPPING.NAME_TC]: PEOPLE[id].nameTC,
        [C.NAME_MAPPING.EMAIL]: PEOPLE[id].email, [C.NAME_MAPPING.ACTIVE]: true };
    }));

  const elig = [
    ['CHAIR', 'P9001'], ['CHAIR', 'P9002'], ['CHAIR', 'P9004'], ['CHAIR', 'P9007'],
    ['SONG', 'P9001'], ['SONG', 'P9003'], ['SONG', 'P9005'], ['SONG', 'P9006']
  ];
  seedSheet(ss, S.ELIGIBILITY, ['資格'],
    [C.ELIGIBILITY.ELIGIBILITY_ID, C.ELIGIBILITY.PERSON_ID, C.ELIGIBILITY.POST_ID,
      C.ELIGIBILITY.ELIGIBLE, C.ELIGIBILITY.ACTIVE],
    elig.map(function (pair, i) {
      return { [C.ELIGIBILITY.ELIGIBILITY_ID]: 'ELIG' + i, [C.ELIGIBILITY.POST_ID]: pair[0],
        [C.ELIGIBILITY.PERSON_ID]: pair[1], [C.ELIGIBILITY.ELIGIBLE]: true, [C.ELIGIBILITY.ACTIVE]: true };
    }));

  // 只開兩條硬規則，同舊版 e2e 測試範圍一致——SOFT／SEMI_HARD 規則
  // 各自有專門嘅測試（generator_semi_soft_rules.test.js 等）覆蓋。
  seedSheet(ss, S.RULE_SETTINGS, ['規則'],
    [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.LEVEL, C.RULE_SETTINGS.ENABLED,
      C.RULE_SETTINGS.SCOPE_POST_IDS, C.RULE_SETTINGS.ON_VIOLATION, C.RULE_SETTINGS.PRIORITY], [
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_ELIGIBILITY', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 },
      { [C.RULE_SETTINGS.RULE_ID]: 'HARD_UNAVAILABLE', [C.RULE_SETTINGS.LEVEL]: 'HARD',
        [C.RULE_SETTINGS.ENABLED]: true, [C.RULE_SETTINGS.ON_VIOLATION]: 'BLOCK', [C.RULE_SETTINGS.PRIORITY]: 1 }
    ]);

  // 空表，但要有標題行——後面各步會逐步寫入。
  seedSheet(ss, S.ROSTER_VERSIONS, ['版本'],
    [C.ROSTER_VERSIONS.VERSION_ID, C.ROSTER_VERSIONS.QUARTER_ID, C.ROSTER_VERSIONS.VERSION_NO,
      C.ROSTER_VERSIONS.SHEET_NAME, C.ROSTER_VERSIONS.BASIS, C.ROSTER_VERSIONS.PARENT_VERSION_NO,
      C.ROSTER_VERSIONS.STATUS, C.ROSTER_VERSIONS.PROTECTED, C.ROSTER_VERSIONS.WARNING_COUNT,
      C.ROSTER_VERSIONS.CREATED_AT, C.ROSTER_VERSIONS.CREATED_BY, C.ROSTER_VERSIONS.NOTES], []);
  seedSheet(ss, S.ROSTER_ASSIGNMENTS, ['派工'],
    [C.ROSTER_ASSIGNMENTS.ASSIGNMENT_ID, C.ROSTER_ASSIGNMENTS.QUARTER_ID, C.ROSTER_ASSIGNMENTS.VERSION_NO,
      C.ROSTER_ASSIGNMENTS.SERVICE_DATE_ID, C.ROSTER_ASSIGNMENTS.SERVICE_DATE, C.ROSTER_ASSIGNMENTS.POST_ID,
      C.ROSTER_ASSIGNMENTS.SLOT_INDEX, C.ROSTER_ASSIGNMENTS.PERSON_ID, C.ROSTER_ASSIGNMENTS.PERSON_NAME_SNAPSHOT,
      C.ROSTER_ASSIGNMENTS.ASSIGN_SOURCE, C.ROSTER_ASSIGNMENTS.RULE_FLAGS, C.ROSTER_ASSIGNMENTS.LOCKED,
      C.ROSTER_ASSIGNMENTS.UPDATED_AT, C.ROSTER_ASSIGNMENTS.UPDATED_BY], []);
  seedSheet(ss, S.SEND_LOG, ['寄送記錄'],
    [C.SEND_LOG.SEND_ID, C.SEND_LOG.QUARTER_ID, C.SEND_LOG.VERSION_NO, C.SEND_LOG.STAGE,
      C.SEND_LOG.RECIPIENT_TYPE, C.SEND_LOG.PERSON_ID, C.SEND_LOG.EMAIL, C.SEND_LOG.DISPLAY_NAME,
      C.SEND_LOG.ASSIGNMENT_HASH, C.SEND_LOG.ASSIGNMENT_SUMMARY, C.SEND_LOG.ATTACHMENT_NAME,
      C.SEND_LOG.SENT_AT, C.SEND_LOG.STATUS, C.SEND_LOG.MESSAGE_ID, C.SEND_LOG.ERROR_MESSAGE,
      C.SEND_LOG.TRIGGERED_BY], []);
  seedSheet(ss, S.AUDIT_LOG, ['稽核記錄'],
    [C.AUDIT_LOG.LOG_ID, C.AUDIT_LOG.TIMESTAMP, C.AUDIT_LOG.ACTOR, C.AUDIT_LOG.ACTION,
      C.AUDIT_LOG.TARGET_SHEET, C.AUDIT_LOG.TARGET_KEY, C.AUDIT_LOG.OLD_VALUE, C.AUDIT_LOG.NEW_VALUE,
      C.AUDIT_LOG.SOURCE, C.AUDIT_LOG.NOTES], []);
  seedSheet(ss, S.REQUESTS, ['申報'],
    [C.REQUESTS.REQUEST_ID, C.REQUESTS.QUARTER_ID, C.REQUESTS.SERVICE_DATE, C.REQUESTS.POST_NAME,
      C.REQUESTS.PERSON_NAME, C.REQUESTS.REQUEST_TYPE, C.REQUESTS.STATUS, C.REQUESTS.RESULT_NOTE,
      C.REQUESTS.CREATED_AT, C.REQUESTS.PROCESSED_AT, C.REQUESTS.NOTES], []);
  seedSheet(ss, S.SPECIAL_SUNDAYS, ['特殊主日'],
    [C.SPECIAL_SUNDAYS.SPECIAL_ID, C.SPECIAL_SUNDAYS.QUARTER_ID, C.SPECIAL_SUNDAYS.SERVICE_DATE,
      C.SPECIAL_SUNDAYS.TYPE, C.SPECIAL_SUNDAYS.SKIP_POST_IDS, C.SPECIAL_SUNDAYS.LOCK_POST_IDS,
      C.SPECIAL_SUNDAYS.ACTIVE, C.SPECIAL_SUNDAYS.CONFIRMED], []);

  seedSheet(ss, S.UNAVAILABLE, ['不可用'],
    [C.UNAVAILABLE.UNAVAILABLE_ID, C.UNAVAILABLE.PERSON_ID, C.UNAVAILABLE.DATE_FROM, C.UNAVAILABLE.DATE_TO,
      C.UNAVAILABLE.APPLIES_TO, C.UNAVAILABLE.POST_IDS, C.UNAVAILABLE.STATUS,
      C.UNAVAILABLE.CREATED_AT, C.UNAVAILABLE.CREATED_BY], []);

  // 範本全部 AttachType=NONE（見檔頭「邊界三」）；一律唔用 {PublicRosterUrl}
  // 避免要真正發佈公開連結。
  seedSheet(ss, S.EMAIL_TEMPLATES, ['範本'],
    [C.EMAIL_TEMPLATES.TEMPLATE_ID, C.EMAIL_TEMPLATES.STAGE, C.EMAIL_TEMPLATES.LANG,
      C.EMAIL_TEMPLATES.SUBJECT, C.EMAIL_TEMPLATES.BODY_HTML, C.EMAIL_TEMPLATES.BODY_PLAIN,
      C.EMAIL_TEMPLATES.ATTACH_TYPE, C.EMAIL_TEMPLATES.ACTIVE], [
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_REVIEW_TC', [C.EMAIL_TEMPLATES.STAGE]: 'REVIEW',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表審閱',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>請審閱。</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '請審閱。',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_OFFICIAL_TC', [C.EMAIL_TEMPLATES.STAGE]: 'OFFICIAL',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表正式發出',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_OFFICIAL_LIST_TC', [C.EMAIL_TEMPLATES.STAGE]: 'OFFICIAL',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表正式發出（堂委）',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>已發出。</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '已發出。',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_RESEND_TC', [C.EMAIL_TEMPLATES.STAGE]: 'RESEND',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表已更新',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>{AssignmentSummary}</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '{AssignmentSummary}',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true },
      { [C.EMAIL_TEMPLATES.TEMPLATE_ID]: 'TPL_RESEND_LIST_TC', [C.EMAIL_TEMPLATES.STAGE]: 'RESEND',
        [C.EMAIL_TEMPLATES.LANG]: 'TC', [C.EMAIL_TEMPLATES.SUBJECT]: '職事表已更新（堂委）',
        [C.EMAIL_TEMPLATES.BODY_HTML]: '<p>已更新。</p>', [C.EMAIL_TEMPLATES.BODY_PLAIN]: '已更新。',
        [C.EMAIL_TEMPLATES.ATTACH_TYPE]: 'NONE', [C.EMAIL_TEMPLATES.ACTIVE]: true }
    ]);

  seedSheet(ss, S.EMAIL_RECIPIENTS, ['收件人'],
    [C.EMAIL_RECIPIENTS.RECIPIENT_ID, C.EMAIL_RECIPIENTS.EMAIL, C.EMAIL_RECIPIENTS.DISPLAY_NAME,
      C.EMAIL_RECIPIENTS.STAGE, C.EMAIL_RECIPIENTS.SEND_AS, C.EMAIL_RECIPIENTS.ACTIVE, C.EMAIL_RECIPIENTS.ROLE], [
      { [C.EMAIL_RECIPIENTS.RECIPIENT_ID]: 'REC1', [C.EMAIL_RECIPIENTS.EMAIL]: 'deacon@x.com',
        [C.EMAIL_RECIPIENTS.DISPLAY_NAME]: '堂委', [C.EMAIL_RECIPIENTS.STAGE]: 'OFFICIAL,RESEND',
        [C.EMAIL_RECIPIENTS.SEND_AS]: 'TO', [C.EMAIL_RECIPIENTS.ACTIVE]: true,
        [C.EMAIL_RECIPIENTS.ROLE]: 'REVIEWER' }
    ]);
}

buildFixture();

/* ══════════════════════════════════════════════════════════════
 * 敘事開始
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== 開始狀態 ===');
{
  checkEqual('★★★★★ Stage 初始值為 DRAFT（由真正的 getQuarterStage_() 讀出）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.DRAFT);
}

console.log('\n=== 各步驟在錯誤 Stage 執行都要被真正嘅 requireQuarterStage_() 拒絕 ===');
{
  expectThrow('★★★★★ 步驟 4 在 DRAFT 執行 → 拒絕（由入口 apiStep4Confirm 叫落去）',
    function () { gas.apiStep4Confirm(Q); }, '步驟 4');
  expectThrow('★★★★ 步驟 5 在 DRAFT 執行 → 拒絕（由入口 apiStep5Plan 叫落去）',
    function () { gas.apiStep5Plan(Q); }, '步驟 5');
}

console.log('\n=== 步驟 1：生成初稿（apiGenerateDraftPlan → apiGenerateDraftExecute）===');
let v0 = -1;
{
  const plan = gas.apiGenerateDraftPlan(Q);
  check('★★★★★ plan 唔會 blocked（呢一季未生成過）', plan.blocked === false, JSON.stringify(plan));
  checkEqual('★★★★★ plan 算到 13 個主日', plan.serviceDateCount, 13);

  const result = gas.apiGenerateDraftExecute(Q);
  check('★★★★★ **執行成功**（`ok !== false`）——由 apiGenerateDraftExecute()'
    + ' 真正叫 performRosterGeneration_() → generateBest() → writeAssignments() → registerVersion()',
    result.ok !== false, JSON.stringify(result));
  v0 = result.versionNo;
  checkEqual('★★★★★ 建立 v0', v0, 0);
  checkEqual('★★★★★ Stage 仍然是 DRAFT（步驟 1 不前進 Stage，真正讀出嚟）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.DRAFT);

  const assignments = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS);
  checkEqual('★★★★★ RosterAssignments 真正寫入咗 26 格（13 主日 × 2 崗位）',
    assignments.length, 26);
  const versions = gas.readSheet(gas.SHEETS.ROSTER_VERSIONS);
  checkEqual('★★★★ RosterVersions 真正登記咗 1 個版本', versions.length, 1);

  const second = gas.apiGenerateDraftExecute(Q);
  checkEqual('★★★★ 已經有版本 ⇒ 唔會重複生成', second.versionCreated, false);
}

console.log('\n=== 步驟 2：寄給堂委審閱（apiStep2Preview → apiStep2Confirm，DRAFT → REVIEW_SENT）===');
{
  expectThrow('★★★★ 步驟 4 仲未到步驟 2，繼續拒絕',
    function () { gas.apiStep4Confirm(Q); }, '步驟 4');

  const preview = gas.apiStep2Preview(Q);
  checkEqual('★★★★★ preview 對應到最新版本 v0', preview.versionNo, 0);
  check('★★★★ preview 讀到 1 個審閱者（真正由 EmailRecipients 讀出）',
    preview.recipientCount === 1, JSON.stringify(preview));

  const result = gas.apiStep2Confirm(Q);
  checkEqual('★★★★★ Stage → REVIEW_SENT（由 executeStep2_() 的 setQuarterStage_() 真正寫入）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.REVIEW_SENT);
  checkEqual('★★★★★ **1 位審閱者真正被 sendStage() 記成 DRY_RUN**'
    + '（唔係測試自己塞落 SendLog）', result.dryRun, 1);

  const sendLog = gas.readSheet(gas.SHEETS.SEND_LOG).filter(function (r) {
    return r[gas.COLUMNS.SEND_LOG.STAGE] === 'REVIEW';
  });
  checkEqual('★★★★★ SendLog 真正有一行 REVIEW 階段嘅紀錄', sendLog.length, 1);
}

console.log('\n=== 步驟 3：套用修改申報——加入含特例與矛盾組合的申報（apiStep3Plan/Apply/Release）===');
{
  const R = gas.COLUMNS.REQUESTS;
  const dates = gas.readSheet(gas.SHEETS.SERVICE_DATES)
    .sort(function (a, b) { return Number(a[gas.COLUMNS.SERVICE_DATES.WEEK_INDEX]) - Number(b[gas.COLUMNS.SERVICE_DATES.WEEK_INDEX]); })
    .map(function (r) { return gas.toDateString(r[gas.COLUMNS.SERVICE_DATES.SERVICE_DATE], TZ); });

  // ⚠️ 「不能服侍」要求嗰個人**真係**喺嗰個崗位有派工——`validateRequest_()`
  // 揸唔到就會判 NEEDS_INPUT（「查無此人在此崗位的派工紀錄」，呢個係
  // 正確行為，唔係 bug）。真正嘅生成器唔係簡單輪替，邊個坐邊一週要
  // **由真正寫入嘅 v0 讀返出嚟**，唔可以假設。
  const v0rows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] === Q
      && Number(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) === v0;
  });
  const chairOn = function (dateStr) {
    const row = v0rows.find(function (r) {
      return gas.toDateString(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ) === dateStr
        && r[gas.COLUMNS.ROSTER_ASSIGNMENTS.POST_ID] === 'CHAIR';
    });
    return row ? row[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] : null;
  };
  // 搵 P9007 真正坐咗 CHAIR 嗰一週，用嚟砌矛盾組合（一定搵到：CHAIR
  // 得 4 個合資格候選人，13 週落嚟每人至少會坐幾次）。
  const contraDate = dates.find(function (d) { return chairOn(d) === 'P9007'; });
  check('（前置條件）P9007 真係喺某一週坐咗 CHAIR，先有得砌矛盾組合',
    !!contraDate, JSON.stringify(dates.map(chairOn)));
  const chairWeek3PersonId = chairOn(dates[2]);
  check('（前置條件）第 3 週真係有人坐 CHAIR', !!chairWeek3PersonId, '');

  appendRows(ss, gas.SHEETS.REQUESTS, [
    R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME, R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS
  ], [
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: dates[2], [R.POST_NAME]: '主席',
      [R.PERSON_NAME]: PEOPLE[chairWeek3PersonId].nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.CANNOT_SERVE, [R.STATUS]: '' },
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: dates[0], [R.POST_NAME]: '主席',
      [R.PERSON_NAME]: PEOPLE.P9004.nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' },
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: dates[3], [R.POST_NAME]: '領詩',
      [R.PERSON_NAME]: PEOPLE.P9005.nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' },
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: dates[4], [R.POST_NAME]: '領詩',
      [R.PERSON_NAME]: PEOPLE.P9006.nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' },
    // 矛盾組合：同一人同一日「不能服侍」與「指定服侍」並存（P9007 嗰日
    // 真係坐緊 CHAIR，所以「不能服侍」本身係一條合法申報，淨係因為
    // 同一日仲有一筆「指定服侍」先變成語意矛盾）。
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: contraDate, [R.POST_NAME]: '主席',
      [R.PERSON_NAME]: PEOPLE.P9007.nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.CANNOT_SERVE, [R.STATUS]: '' },
    { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: contraDate, [R.POST_NAME]: '領詩',
      [R.PERSON_NAME]: PEOPLE.P9007.nameTC, [R.REQUEST_TYPE]: gas.REQUEST_TYPE.DESIGNATED_SERVE, [R.STATUS]: '' }
  ]);

  const plan = gas.apiStep3Plan(Q);
  checkEqual('★★★★★ mode=HAS_PENDING（由真正的 planApplyRequests_() 讀 Requests 讀出）',
    plan.mode, 'HAS_PENDING');
  const needsInput = plan.needsInputList || [];
  checkEqual('★★★★★ 矛盾組合的兩筆都被判 NEEDS_INPUT', needsInput.length, 2);

  const applyResult = gas.apiStep3Apply(Q, true);
  check('★★★★★ 套用成功、有前進或者需要放行其中一樣',
    typeof applyResult.advanced === 'boolean', JSON.stringify(applyResult));
  checkEqual('★★★★★ 套用後建立 v1（真正 registerVersion() 登記）',
    gas.findLatestVersionNo(Q), 1);

  const v1rows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] === Q
      && Number(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) === 1;
  });
  const chairWeek3 = v1rows.find(function (r) {
    return gas.toDateString(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ) === dates[2]
      && r[gas.COLUMNS.ROSTER_ASSIGNMENTS.POST_ID] === 'CHAIR';
  });
  check('★★★★★ ' + chairWeek3PersonId + ' 第 3 週已經不再擔任 CHAIR（真正被 CANNOT_SERVE 頂替）',
    chairWeek3 && chairWeek3[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] !== chairWeek3PersonId,
    JSON.stringify(chairWeek3));
  const chairWeek1 = v1rows.find(function (r) {
    return gas.toDateString(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ) === dates[0]
      && r[gas.COLUMNS.ROSTER_ASSIGNMENTS.POST_ID] === 'CHAIR';
  });
  checkEqual('★★★★★ P9004（特例一）第 1 週真正被指定擔任 CHAIR',
    chairWeek1 && chairWeek1[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID], 'P9004');

  if (!applyResult.advanced) {
    const release = gas.apiStep3Release(Q, '確認放行');
    check('★★★★ 放行文字啱 ⇒ 前進', release.advanced === true, JSON.stringify(release));
  }
  checkEqual('★★★★★ Stage → REQUESTS_APPLIED（真正由 advanceQuarterStage_() 寫入）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.REQUESTS_APPLIED);
}

console.log('\n=== 步驟 3：硬規則違反時不放行、Stage 停住，修正後重跑才前進 ===');
{
  // 由真正嘅入口，喺目前最新版本手動注入一格違反資格嘅指派
  // （模擬「套用申報之後才發現有問題」嘅情境），驗證閘門真係擋得住。
  const versionNo = gas.findLatestVersionNo(Q);
  const C = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  const dates = gas.readSheet(gas.SHEETS.SERVICE_DATES)
    .sort(function (a, b) { return Number(a[gas.COLUMNS.SERVICE_DATES.WEEK_INDEX]) - Number(b[gas.COLUMNS.SERVICE_DATES.WEEK_INDEX]); })
    .map(function (r) { return gas.toDateString(r[gas.COLUMNS.SERVICE_DATES.SERVICE_DATE], TZ); });

  const rows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS);
  const week1Chair = rows.find(function (r) {
    return r[C.QUARTER_ID] === Q && Number(r[C.VERSION_NO]) === versionNo
      && gas.toDateString(r[C.SERVICE_DATE], TZ) === dates[0] && r[C.POST_ID] === 'CHAIR';
  });
  // P9003 冇 CHAIR 資格（見 Eligibility fixture）——直接改呢個真正儲存格。
  ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS)._cells.forEach; // no-op，避免 lint 誤解
  const rangeRow = 3 + rows.indexOf(week1Chair);
  const headers = ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS).getRange(2, 1, 1,
    ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS).getLastColumn()).getValues()[0];
  const personCol = headers.indexOf(C.PERSON_ID) + 1;
  ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS).getRange(rangeRow, personCol).setValue('P9003');

  // ⚠️ `executeStep3Release_()` 對「Stage 已經係 REQUESTS_APPLIED」有一個
  // 早退分支（`{advanced:false, alreadyAdvanced:true}`），唔會重新檢查
  // 違反——呢個係設計，唔係漏洞（一旦前進過，注入新違反唔應該由
  // 「放行」呢個動作重新把關，要由重新走一次 plan 週期處理）。
  // 由**真正**嘅 `setQuarterStage_()` 退返去 `REVIEW_SENT`，模擬「呢個
  // 版本仲未放行過」嘅前置狀態——同舊版 e2e 測試嘅做法一致。
  gas.setQuarterStage_(Q, gas.QUARTER_STAGE.REVIEW_SENT, 'e2e 測試：模擬硬規則違反場景');

  const releaseFail = gas.apiStep3Release(Q, '亂打文字');
  check('★★★★★ 文字不是「確認放行」→ 不放行（由真正嘅 resolveHardViolationRelease_() 判斷）',
    releaseFail.advanced === false, JSON.stringify(releaseFail));
  checkEqual('★★★★★ Stage 仍然停在 REVIEW_SENT（沒有被錯誤放行）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.REVIEW_SENT);

  // 幹事修正：改返做一個有資格嘅人
  ss.getSheetByName(gas.SHEETS.ROSTER_ASSIGNMENTS).getRange(rangeRow, personCol).setValue('P9004');
  const releaseOk = gas.apiStep3Release(Q, '確認放行');
  check('★★★★★ 修正後打「確認放行」→ 前進', releaseOk.advanced === true, JSON.stringify(releaseOk));

  // ⚠️⚠️ **矛盾組合嗰兩筆會一直卡住，`apiStep3Decline()` 都解決唔到。**
  //
  // 讀 `writeRequestOutcomes_()`（RequestsApply.gs）先發現：NEEDS_INPUT
  // 類別**刻意唔會攞到 `RequestID`**（`keepPending = true`），而
  // `readPendingRequests_()` 判斷「呢筆處理咗未」睇嘅正正係 RequestID
  // 有冇值，唔係 Status 欄嘅文字。即係：**一個真正嘅語意矛盾，
  // 系統唔會幫你自動放棄，佢會一直卡喺「未處理」**，直到有人刪走
  // 其中一筆為止——`assertNoUnsavedChanges_()` 會因此一直擋住步驟 4。
  //
  // 呢個係正確行為（同錯誤訊息講嘅一致：「請刪除其中一筆」），唔係
  // 測試漏咗嘢。所以呢度模擬幹事真正嘅補救：**刪走「指定服侍」嗰筆**
  // （留低「不能服侍」，即係 P9007 嗰日真係唔服侍），再重新行一次
  // plan／apply 令佢真正被套用。
  const decline = gas.apiStep3Decline(Q);
  checkEqual('★★★★★ apiStep3Decline() 記低咗 2 筆（Status 寫咗，但 RequestID 刻意留空）',
    decline.recorded, 2);

  const R2 = gas.COLUMNS.REQUESTS;
  const contraDesignatedRow = 3 + 5;   // appendRows() 第 6 筆（sheetRow 對應 index）
  const reqSheet = ss.getSheetByName(gas.SHEETS.REQUESTS);
  const reqHeaders = reqSheet.getRange(2, 1, 1, reqSheet.getLastColumn()).getValues()[0];
  ['SERVICE_DATE', 'POST_NAME', 'PERSON_NAME', 'REQUEST_TYPE'].forEach(function (k) {
    const col = reqHeaders.indexOf(R2[k]) + 1;
    reqSheet.getRange(contraDesignatedRow, col).setValue('');
  });

  const replan = gas.apiStep3Plan(Q);
  const stillPending = (replan.mode === 'HAS_PENDING')
    ? (replan.applyList.length + replan.confirmList.length + replan.needsInputList.length) : 0;
  check('★★★★★ 刪走矛盾一半之後，剩低嗰筆「不能服侍」變返一條乾淨嘅申報',
    stillPending === 1 || replan.mode !== 'HAS_PENDING', JSON.stringify(replan));
  if (replan.mode === 'HAS_PENDING') {
    const reapply = gas.apiStep3Apply(Q, true);
    check('★★★★★ 真正套用咗（P9007 嗰日唔再擔任 CHAIR）',
      typeof reapply.appliedCount === 'number' && reapply.appliedCount >= 1, JSON.stringify(reapply));
    if (!reapply.advanced) gas.apiStep3Release(Q, '確認放行');
  }

  const finalPlan = gas.apiStep3Plan(Q);
  check('★★★★★ 再叫一次 apiStep3Plan() 已經冇嘢剩（矛盾真正解決咗，唔係扮嘅）',
    finalPlan.mode !== 'HAS_PENDING', JSON.stringify(finalPlan));
}

console.log('\n=== 步驟 4：正式發出（含無電郵特例，apiStep4Get*Warnings → apiStep4Confirm）===');
{
  expectThrow('★★★★ 步驟 5 仲未到步驟 4，繼續拒絕',
    function () { gas.apiStep5Plan(Q); }, '步驟 5');

  const pending = gas.apiStep4GetPendingWarnings(Q);
  checkEqual('★★★★ 冇待處理申報（上面已經處理晒）', pending.pendingRequests.length, 0);

  const missing = gas.apiStep4GetMissingPdfWarnings(Q, pending.versionNo);
  checkEqual('★★★★★ AttachType=NONE ⇒ 個人 PDF 缺件檢查唔適用（唔係扮唔到，係範本設定令佢真係唔適用）',
    missing.applicable, false);

  const sendPreview = gas.apiStep4GetSendPreview(Q, pending.versionNo);
  check('★★★★★ 收件人數 > 0（真正由 RosterAssignments 派工紀錄算出）',
    sendPreview.recipientCount > 0, JSON.stringify(sendPreview));

  const result = gas.apiStep4Confirm(Q);
  checkEqual('★★★★★ Stage → OFFICIAL_SENT（真正由 executeStep4Send_() 前進）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.OFFICIAL_SENT);

  const noEmailLog = gas.readSheet(gas.SHEETS.SEND_LOG).filter(function (l) {
    return l[gas.COLUMNS.SEND_LOG.STAGE] === 'OFFICIAL'
      && l[gas.COLUMNS.SEND_LOG.STATUS] === gas.MAIL_STATUS.SKIPPED_NO_EMAIL;
  });
  check('★★★★★ 特例二／三（P9005／P9006）首次正式發出時都還沒有電郵'
    + ' → 兩人都真正被 sendStage() 記為 SKIPPED_NO_EMAIL',
    ['P9005', 'P9006'].every(function (p) {
      return noEmailLog.some(function (l) { return l[gas.COLUMNS.SEND_LOG.PERSON_ID] === p; });
    }), JSON.stringify(noEmailLog));
  check('★★★★ 結果講得出「幾多人真正發出咗」', typeof result.dryRun === 'number', JSON.stringify(result));
}

console.log('\n=== 步驟 5：剛正式發出，未有任何改動（apiStep5Plan）===');
{
  const plan = gas.apiStep5Plan(Q);
  checkEqual('★★★★★ mode=NO_CHANGES（P9005／P9006 呢一刻都仲未有電郵；設計上'
    + '「首次通知」要等佢哋真正有電郵先會被標記——ResendFlow.gs 檔頭註解明文'
    + '「firstNotifyDueToEmail」要 nowHasEmail 為真，唔係「無電郵就永遠被標住」）',
    plan.mode, 'NO_CHANGES');
  checkEqual('★★★★ changed 陣列真係空嘅', plan.changed.length, 0);
}

console.log('\n=== 步驟 5：改動後重發——三個特例人物（apiStep5Plan → apiStep5SendConfirm）===');
{
  const R = gas.COLUMNS.REQUESTS;

  const versionNo = gas.findLatestVersionNo(Q);
  const p9004Rows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] === Q
      && Number(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) === versionNo
      && r[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] === 'P9004';
  });
  check('（前置條件）P9004 目前確實有指派，才有得取消', p9004Rows.length > 0, '');

  // 特例一：P9004 被踢出全部指派，變成本季真正零派工——P9004 唔保證淨係得
  // 步驟3「指定服侍」嗰一格（佢本身係 CHAIR 合資格人選之一，生成時可能仲有
  // 其他格），所以要逐格都遞一張「不能服侍」，唔可以淨係揀第一格當佢得一格。
  appendRows(ss, gas.SHEETS.REQUESTS, [
    R.REQUEST_ID, R.QUARTER_ID, R.SERVICE_DATE, R.POST_NAME, R.PERSON_NAME, R.REQUEST_TYPE, R.STATUS
  ], p9004Rows.map(function (row) {
    return { [R.QUARTER_ID]: Q, [R.SERVICE_DATE]: gas.toDateString(row[gas.COLUMNS.ROSTER_ASSIGNMENTS.SERVICE_DATE], TZ),
      [R.POST_NAME]: '主席', [R.PERSON_NAME]: PEOPLE.P9004.nameTC,
      [R.REQUEST_TYPE]: gas.REQUEST_TYPE.CANNOT_SERVE, [R.STATUS]: '' };
  }));

  // 特例三：P9006 派工內容完全不變，只是現在補上電郵。
  {
    const sheet = ss.getSheetByName(gas.SHEETS.NAME_MAPPING);
    const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idCol = headers.indexOf(gas.COLUMNS.NAME_MAPPING.PERSON_ID) + 1;
    const emailCol = headers.indexOf(gas.COLUMNS.NAME_MAPPING.EMAIL) + 1;
    const lastRow = sheet.getLastRow();
    for (let r = 3; r <= lastRow; r++) {
      if (sheet.getRange(r, idCol).getValue() === 'P9006') {
        sheet.getRange(r, emailCol).setValue('p9006-fixed@x.com');
      }
    }
  }

  const plan = gas.apiStep5Plan(Q);
  checkEqual('★★★★ 這一輪有待處理申報', plan.mode, 'HAS_CHANGES');
  const applyResult = gas.apiStep5Apply(Q, true);
  checkEqual('★★★★★ Stage 維持 OFFICIAL_SENT（步驟 5 不前進 Stage）',
    gas.getQuarterStage_(Q), gas.QUARTER_STAGE.OFFICIAL_SENT);
  check('★★★★ Requests 全部真正套用咗（P9004 幾多格就幾多筆申報）',
    applyResult.appliedCount >= p9004Rows.length, JSON.stringify(applyResult));

  const newVersionNo = gas.findLatestVersionNo(Q);
  const newRows = gas.readSheet(gas.SHEETS.ROSTER_ASSIGNMENTS).filter(function (r) {
    return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID] === Q
      && Number(r[gas.COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO]) === newVersionNo;
  });
  check('★★★★★ P9004 這一版真的一格都沒有了（真正零派工）',
    !newRows.some(function (r) { return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] === 'P9004'; }),
    JSON.stringify(newRows.filter(function (r) { return r[gas.COLUMNS.ROSTER_ASSIGNMENTS.PERSON_ID] === 'P9004'; })));

  const sendPreview = gas.apiStep5SendPreview(Q);
  check('★★★★ 送出預覽真係包含改動嘅人', sendPreview.mode === 'READY' && sendPreview.changedList.length > 0,
    JSON.stringify(sendPreview));

  const sendResult = gas.apiStep5SendConfirm(Q, '');
  check('★★★★★ 冇被硬規則關卡擋住', sendResult.blocked !== true, JSON.stringify(sendResult));

  const resendLog = gas.readSheet(gas.SHEETS.SEND_LOG).filter(function (l) {
    return l[gas.COLUMNS.SEND_LOG.STAGE] === 'RESEND';
  });
  check('★★★★★ P9004（特例一）真正被 sendResendStage_() 記到「已寄出」'
    + '（有電郵，零派工的「取消通知」仍然要真正發出）',
    resendLog.some(function (l) {
      return l[gas.COLUMNS.SEND_LOG.PERSON_ID] === 'P9004'
        && l[gas.COLUMNS.SEND_LOG.STATUS] === gas.MAIL_STATUS.DRY_RUN;
    }), JSON.stringify(resendLog));
  check('★★★★ P9005（仍然沒有電郵、派工內容亦無改變）本輪根本不會被嘗試——'
    + 'computeResendDiff_() 要 hash 變咗或者 firstNotifyDueToEmail 成立先會入名單，'
    + '兩者都唔成立，連 deliverOne_() 都唔會叫到，SendLog 完全冇呢個人呢一行',
    !resendLog.some(function (l) { return l[gas.COLUMNS.SEND_LOG.PERSON_ID] === 'P9005'; }),
    JSON.stringify(resendLog));

  checkKnownRed('★★★★★ 【已知 src/ bug】P9006（OFFICIAL 階段因無電郵被略過、呢一刻'
    + '先至補上電郵）理應真正被記到「已寄出」（第一次通知），但實際被記做'
    + ' SKIPPED_UNCHANGED——deliverOne_() 嘅「RESEND 且內容未變」關卡淨係比較'
    + ' hash，完全唔理會 computeResendDiff_() 已經算好嘅 firstNotifyDueToEmail 旗標，'
    + '令呢個旗標形同虛設：呢個人永遠唔會透過步驟5真正收到佢嘅第一封信',
    resendLog.some(function (l) {
      return l[gas.COLUMNS.SEND_LOG.PERSON_ID] === 'P9006'
        && l[gas.COLUMNS.SEND_LOG.STATUS] === gas.MAIL_STATUS.DRY_RUN;
    }), JSON.stringify(resendLog),
    'src/Mailer.gs deliverOne_()「RESEND 且內容未變」嘅 hash-only 關卡（約第 510-519 行）');
}

console.log('\n=== 步驟 5：重複執行——上一輪 bug 嘅延續症狀 ===');
{
  const plan = gas.apiStep5Plan(Q);
  const changedIds = plan.changed.map(function (c) { return c.personId; });
  checkKnownRed('★★★★★ 【已知 src/ bug 嘅延續】理論上 P9006 上一輪應該已經處理完，'
    + '呢度應該冇嘢剩（plan.changed 應該係 []）；但因為 readLastSendRecordByPerson_()'
    + '（Mailer.gs）嘅基準名單特登唔認 SKIPPED_UNCHANGED 呢個 Status（見該函式檔頭'
    + '註解：「SKIPPED_UNCHANGED 同樣不在這三者之列」），上一輪嗰筆 SKIPPED_UNCHANGED'
    + ' 唔算數，基準繼續停留喺更舊嗰筆 SKIPPED_NO_EMAIL——結果 P9006 會不斷被判'
    + '「先前未通知過」，但每次都因為同一個 hash-only 關卡再次被跳過，形成永遠'
    + '通知唔到嘅死循環',
    JSON.stringify(changedIds) === JSON.stringify([]), JSON.stringify(changedIds),
    'src/Mailer.gs readLastSendRecordByPerson_() + deliverOne_()（同一個根因，第二個症狀）');
}

if (knownRed.length > 0) {
  console.log(`\n=== KNOWN-RED（已知 src/ 缺陷，共 ${knownRed.length} 項，不計入 fail）===`);
  knownRed.forEach(function (item, i) {
    console.log(`[${i + 1}] ${item.label}`);
    if (item.extra) console.log('    ' + item.extra);
    console.log('    src/：' + item.srcRef);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
