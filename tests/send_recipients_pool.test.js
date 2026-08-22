// 第四十六輪批次 A／B 組：收件人由幹事決定，唔係由階段決定。
// 執行方式：node tests/send_recipients_pool.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 之前兩輪點解做錯咗
// ═════════════════════════════════════════════════════════════════════
//
// 第四十一同第四十三輪都把需求理解成「喺現有嘅階段流程上加一個選人清單」
// ——階段仍然由系統判斷，而個清單只係喺**嗰個階段本來嘅收件範圍**入面再篩。
//
// Ivan 嘅原話：
//
//   > 這是用來寄給職事表上所有人、CC、DB、IT、admin 同自訂 email 的。
//   > 所以我說它應該似「處理紙本」那個。
//   > 因此「這一次是寄給堂委審閱（這一季還未正式發出過）」**這句描述也是錯的**。
//
// 呢一份守四件事：
//   一、個池**同階段無關**（職事表上全部人 ＋ 身分持有人 ＋ EmailRecipients）
//   二、六個來源逐個有實際人數，**唔係喺畫面寫死**
//   三、「有改動」一定要講明**相對邊一版**
//   四、寄出紀錄，而且**現時嗰版未寄過就要明講**

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

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
const ui = read('src/ui/ScriptSendPaper.html');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
  'WebAppGuards.gs', 'SendOptions.gs', 'SendRecipients.gs', 'Mailer.gs',
  // `buildSendHistoryView_()`／`apiGetSendRecipientPool()` 喺呢度。
  'WebAppSendPlan.gs'
]);

const TZ = 'Pacific/Auckland';

/**
 * 一份現況：
 *   P9001 測試甲　這一季有 3 格　　　　　有電郵
 *   P9002 測試乙　這一季有 1 格　堂委　　有電郵
 *   P9003 測試丙　這一季有 2 格　　　　　**冇電郵**
 *   P9004 測試丁　這一季 0 格　　執事　　有電郵　← 冇服侍嘅身分持有人
 *   P9005 測試戊　這一季 0 格　　IT　　　有電郵
 * ＋ EmailRecipients 一行堂委名單地址
 */
function setup(opts) {
  opts = opts || {};
  const people = {
    P9001: { personId: 'P9001', nameTC: '測試甲', email: 'a@example.invalid' },
    P9002: { personId: 'P9002', nameTC: '測試乙', email: 'b@example.invalid' },
    P9003: { personId: 'P9003', nameTC: '測試丙', email: '' },
    P9004: { personId: 'P9004', nameTC: '測試丁', email: 'd@example.invalid' },
    P9005: { personId: 'P9005', nameTC: '測試戊', email: 'e@example.invalid' }
  };
  gas.readRolesSafe_ = function () {
    return [
      { personId: 'P9002', roleCode: 'COMMITTEE', effectiveFrom: '', effectiveTo: '' },
      { personId: 'P9004', roleCode: 'DEACON', effectiveFrom: '', effectiveTo: '' },
      { personId: 'P9005', roleCode: 'IT', effectiveFrom: '', effectiveTo: '' },
      // 一個**已經卸任**嘅堂委：生效期已過 ⇒ 唔應該入池嘅堂委組。
      { personId: 'P9001', roleCode: 'COMMITTEE',
        effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' }
    ];
  };
  gas.Utilities = { formatDate: function () { return '2027-10-01'; } };
  gas.getConfig = function (_k, d) { return d; };
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.EMAIL_RECIPIENTS) {
      const R = gas.COLUMNS.EMAIL_RECIPIENTS;
      const row = {};
      row[R.ACTIVE] = true;
      row[R.EMAIL] = 'council@example.invalid';
      row[R.DISPLAY_NAME] = '堂委名單';
      row[R.SEND_AS] = 'TO';
      row[R.STAGE] = 'REVIEW';
      return [row];
    }
    if (name === gas.SHEETS.SEND_LOG) return opts.sendLog || [];
    return [];
  };
  return {
    quarterId: '2027T3',
    versionNo: 10,
    stage: gas.MAIL_STAGES.OFFICIAL,
    timezone: TZ,
    peopleById: people,
    assignmentsByPerson: {
      P9001: [{}, {}, {}],
      P9002: [{}],
      P9003: [{}, {}]
    },
    lastHashByPerson: {}
  };
}

/** 造一行 SendLog。 */
function logRow(stage, versionNo, sentAt, status, personId) {
  const C = gas.COLUMNS.SEND_LOG;
  const row = {};
  row[C.QUARTER_ID] = '2027T3';
  row[C.STAGE] = stage;
  row[C.VERSION_NO] = versionNo;
  row[C.SENT_AT] = sentAt;
  row[C.STATUS] = status;
  row[C.PERSON_ID] = personId || '';
  return row;
}

// =====================================================================
console.log('\n=== A1【核心】個池同階段完全無關 ===');
{
  const context = setup();
  const pool = gas.buildSendRecipientPool_(context, TZ);
  const byKey = {};
  pool.forEach(function (p) { byKey[p.key] = p; });

  check('★★★★★★ **一個冇服侍嘅執事都喺池入面**'
    + '——舊設計嘅 REVIEW 池只有 `EmailRecipients` 幾行地址，'
    + '一個堂委好可能呢一季一格都冇派工，而佢正正就係要收審閱本嗰個',
    !!byKey.P9004 && byKey.P9004.cellCount === 0,
    JSON.stringify(Object.keys(byKey)));
  check('★★★★★ 職事表上有服侍嘅都喺度（連冇電郵嗰個）',
    !!byKey.P9001 && !!byKey.P9002 && !!byKey.P9003);
  check('★★★★★ `EmailRecipients` 嗰行都喺度',
    !!byKey['LIST:council@example.invalid']
    && byKey['LIST:council@example.invalid'].type === 'LIST');
  check('★★★★ 格數讀得啱', byKey.P9001.cellCount === 3 && byKey.P9002.cellCount === 1);
  check('★★★★★ 冇電郵嘅**勾唔到**（勾得到但寄唔到，個數字就講大話）',
    byKey.P9003.selectable === false && byKey.P9003.hasEmail === false);
  check('★★★★★ 一個人唔會出現兩次'
    + '——測試乙（有服侍 ＋ 堂委）兩批都會撞到佢',
    pool.filter(function (p) { return p.key === 'P9002'; }).length === 1);
}

// =====================================================================
console.log('\n=== A1【核心】六個來源逐個標，而且身分由 `Roles` 讀 ===');
{
  const context = setup();
  const pool = gas.buildSendRecipientPool_(context, TZ);
  const byKey = {};
  pool.forEach(function (p) { byKey[p.key] = p; });

  checkEqual('★★★★★ 測試甲：只係「職事表上全部人」',
    byKey.P9001.sources, ['ROSTER']);
  checkEqual('★★★★★ 測試乙：職事表 ＋ 堂委（**一個人可以同時屬於幾組**）',
    byKey.P9002.sources.sort(), ['COMMITTEE', 'ROSTER']);
  checkEqual('★★★★★ 測試丁：只係執事（呢一季冇服侍）',
    byKey.P9004.sources, ['DEACON']);
  checkEqual('★★★★★ 測試戊：IT', byKey.P9005.sources, ['IT']);
  check('★★★★★★ **已經卸任嘅堂委唔算堂委**'
    + '——生效期由 `Roles` 判斷，唔係喺畫面寫死一份名單；'
    + '寫死嗰份下一屆就錯，而且冇人會記得去改',
    byKey.P9001.sources.indexOf('COMMITTEE') === -1,
    JSON.stringify(byKey.P9001));
  check('★★★★ `EmailRecipients` 嗰行唔屬於任何身分組',
    byKey['LIST:council@example.invalid'].sources.length === 0);
}

// =====================================================================
console.log('\n=== A1 `IT` 同 `幹事` 兩個身分（本輪新加）===');
{
  check('★★★★★★ `ROLE_CODES` 有 `IT` 同 `CLERK`'
    + '——系統本來只有堂委同執事。Ivan 要求按 IT／幹事揀收件人，'
    + '所以加代號；**冇靜靜當成幹事本人**',
    gas.ROLE_CODES.IT === 'IT' && gas.ROLE_CODES.CLERK === 'CLERK');
  check('★★★★★ 而且有中文顯示名（唔係一串英文代號）',
    gas.ROLE_LABELS_TC.IT === 'IT' && gas.ROLE_LABELS_TC.CLERK === '幹事');
  check('★★★★★ 六個來源嘅次序同名跟 `SEND_SOURCE_LABELS`，唔喺畫面寫死',
    gas.SEND_SOURCE_LABELS.length === 6
    && gas.SEND_SOURCE_LABELS[0].key === 'ROSTER'
    && gas.SEND_SOURCE_LABELS[5].key === 'CHANGED',
    JSON.stringify(gas.SEND_SOURCE_LABELS));
  check('★★★★★★ 畫面**一組零人嗰陣要講點解同去邊度加**'
    + '——`IT` 同 `幹事` 係新加嘅，好可能一個人都未填；'
    + '靜靜出一個勾唔到嘅框，幹事只會以為系統壞咗',
    /現時沒有人有這個身分。要用這一組，先去「名單維護 ▸ 身分」/.test(ui), '');
}

// =====================================================================
console.log('\n=== A4【核心】Stage 冇拆走，只係唔再決定收件人 ===');
{
  const context = setup();
  const decisionPick = { recipientScope: 'PICK', pickedKeys: {}, extraEmails: [] };
  const decisionAll = { recipientScope: 'ALL', pickedKeys: {}, extraEmails: [] };

  gas.listRecipients_ = function (stage) {
    // 舊嗰個按階段出名單：REVIEW 只有堂委地址。
    return stage === gas.MAIL_STAGES.REVIEW
      ? [{ type: 'LIST', personId: '', email: 'council@example.invalid',
        displayName: '堂委名單', sendAs: 'TO' }]
      : [{ type: 'PERSON', personId: 'P9001', email: 'a@example.invalid',
        displayName: '測試甲', sendAs: 'TO' }];
  };

  const pickPool = gas.resolveSendRecipientPool_(
    gas.MAIL_STAGES.REVIEW, context, decisionPick);
  check('★★★★★★ 幹事自己勾（`PICK`）⇒ **全池**，就算階段係 REVIEW'
    + '——池仍然係「REVIEW 只有堂委地址」嘅話，'
    + '佢勾一個義工，嗰個義工根本唔喺池入面 ⇒ 勾咗都唔會收到，'
    + '而畫面會話「已選 12 位」',
    pickPool.length >= 5
    && pickPool.some(function (r) { return r.personId === 'P9001'; }),
    JSON.stringify(pickPool.map(function (r) { return r.personId || r.email; })));

  const allPool = gas.resolveSendRecipientPool_(
    gas.MAIL_STAGES.REVIEW, context, decisionAll);
  checkEqual('★★★★★★ 其餘一律行返 `listRecipients_()`'
    + '——自動排程／補寄／彩排嗰幾條路一個字都冇變',
    allPool.map(function (r) { return r.email; }), ['council@example.invalid']);

  check('★★★★★ 池嘅形狀同 `listRecipients_()` 一模一樣'
    + '——下游（`deliverOne_()`／`generateMailAttachment_()`）讀嘅就係嗰幾個欄位，'
    + '少一個就會靜靜爆',
    pickPool.every(function (r) {
      return 'type' in r && 'personId' in r && 'email' in r
        && 'displayName' in r && 'sendAs' in r;
    }), JSON.stringify(pickPool[0]));

  check('★★★★★ `sendKindToStage_()` 冇拆走'
    + '——版本紀錄、`SendLog`、稽核、重發比對全部靠 Stage',
    /function sendKindToStage_\(kind\)/.test(read('src/WebAppSendPlan.gs')), '');
  check('★★★★★ 而且 `sendStage()` 照樣把 Stage 寫入 `SendLog` 同 `AuditLog`',
    /'Stage=' \+ stage \+ '　收件人='/.test(read('src/Mailer.gs')), '');
}

// =====================================================================
console.log('\n=== A3【核心】彈窗頂唔再由階段推斷「這一次是⋯⋯」 ===');
{
  check('★★★★★★ `s.kindSentence` **唔再畫喺彈窗頂**'
    + '——嗰句係「這一次是寄給堂委審閱（這一季還未正式發出過）」，'
    + '而 Ivan 明確講咗嗰句係錯嘅描述',
    !/text: s\.kindSentence/.test(ui), '');
  check('★★★★★ 保留兩樣真係有用嘅事實：寄邊一版、係咪模擬模式',
    /系統只會寄你已經儲存確認的版本/.test(ui)
    && /系統現在是模擬模式/.test(ui), '');
  check('★★★★★★ 收件摘要由**實際勾咗乜**算出嚟，唔係由階段推斷',
    /function describeSendSelection\(\)/.test(ui)
    && /這一次會寄給 ' \+ total \+ ' 位'/.test(ui), '');
  check('★★★★★ 而且逐個來源講幾多位（「堂委 3 位 ＋ 執事 5 位 ＋ 自訂 2 個地址」）',
    /bits\.push\(g\.label \+ ' ' \+ n \+ ' 位'\)/.test(ui)
    && /bits\.push\('自訂 ' \+ extra \+ ' 個地址'\)/.test(ui), '');
}

// =====================================================================
console.log('\n=== A2【核心】名單同「下載及匯出」用**同一份**元件 ===');
{
  const common = read('src/ui/Script.html');
  check('★★★★★★ `pickListNodes()` 全個專案只定義一次'
    + '——Ivan 已經講咗三次「應該似處理紙本嗰個」，'
    + '寫第二份就會再一次出現兩邊行為唔一致',
    (common.match(/function pickListNodes\(/g) || []).length === 1
    && (ui.match(/function pickListNodes\(/g) || []).length === 0);
  check('★★★★★ 收件人名單同下載及匯出兩邊都叫佢',
    (ui.match(/pickListNodes\(\{/g) || []).length >= 2, '');
  check('★★★★★ 舊嗰個按階段出名單嘅子彈窗已經拆走'
    + '——留住一份冇人用嘅舊碼就係留住第二份元件',
    ui.indexOf('function drawSendPickList') === -1
    && read('src/WebAppSendPlan.gs').indexOf('function listSendCandidates_') === -1, '');
  check('★★★★ 冇電郵嗰個標示同紙本嗰邊一樣',
    /沒有電郵，收不到信/.test(ui), '');
}

// =====================================================================
console.log('\n=== B3【核心】寄出紀錄：這一季寄過幾次 ===');
{
  const context = setup({
    sendLog: [
      logRow('REVIEW', 4, '2026-08-20T09:10:00Z', 'SENT', 'P9002'),
      logRow('REVIEW', 4, '2026-08-20T09:10:00Z', 'SENT', 'P9004'),
      logRow('OFFICIAL', 5, '2026-08-20T09:23:00Z', 'SENT', 'P9001'),
      logRow('OFFICIAL', 5, '2026-08-20T09:23:00Z', 'SKIPPED_NO_EMAIL', 'P9003'),
      logRow('RESEND', 8, '2026-08-20T11:24:00Z', 'SENT', 'P9001')
    ]
  });
  gas.Utilities = {
    formatDate: function (d) {
      const iso = new Date(d).toISOString();
      return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
    }
  };
  gas.findLatestVersionNo = function () { return 10; };

  const history = gas.listSendHistory_('2027T3');
  check('★★★★★ 歸成三批（同一次寄送有幾十行，要按階段 ＋ 版本 ＋ 分鐘歸批）',
    history.length === 3, JSON.stringify(history));
  check('★★★★ 逐批數啱人數',
    history[0].sent === 2 && history[1].sent === 1 && history[1].noEmail === 1,
    JSON.stringify(history));

  const view = gas.buildSendHistoryView_('2027T3');
  check('★★★★★ 逐行有中文階段名（唔係一串英文代號）',
    view.batches[0].stageLabel === '寄給堂委審閱'
    && view.batches[1].stageLabel === '正式發出給全體'
    && view.batches[2].stageLabel === '改動後重發',
    JSON.stringify(view.batches.map(function (b) { return b.stageLabel; })));
  check('★★★★★★ **現時嗰版從來未寄過 ⇒ 明確提醒**'
    + '——幹事最容易犯嘅錯就係「以為寄咗」：'
    + '佢改完、儲存咗、然後去做第二件事，而嗰一版由頭到尾冇寄過',
    view.warnSentence.indexOf('目前是第 10 版') !== -1
    && view.warnSentence.indexOf('未寄過給任何人') !== -1, view.warnSentence);
  check('★★★★★ 而且列得出**邊幾版**未寄過（第 9 及第 10 版）',
    view.warnSentence.indexOf('9') !== -1 && view.warnSentence.indexOf('10') !== -1,
    view.warnSentence);
  check('★★★★ 資料來源係 `SendLog`，冇另開一張表',
    /readSheet\(SHEETS\.SEND_LOG\)/.test(read('src/SendRecipients.gs'))
    && read('src/SendRecipients.gs').indexOf('SEND_HISTORY') === -1, '');

  // 反證：現時嗰版寄過 ⇒ 唔應該再提醒。
  gas.findLatestVersionNo = function () { return 8; };
  const view2 = gas.buildSendHistoryView_('2027T3');
  check('★★★★★★ （反證）現時嗰版寄過 ⇒ **冇**嗰句提醒'
    + '——一句永遠都出嘅提醒，等於冇提醒',
    view2.warnSentence === '', view2.warnSentence);
}

// =====================================================================
console.log('\n=== B2【核心】「有改動」一定要講明相對邊一版 ===');
{
  const context = setup({
    sendLog: [
      logRow('OFFICIAL', 6, '2026-08-20T12:48:00Z', 'SENT', 'P9001')
    ]
  });
  gas.Utilities = {
    formatDate: function (d) {
      const iso = new Date(d).toISOString();
      return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
    }
  };
  const last = gas.findLastSentSnapshot_('2027T3');
  check('★★★★★★ 搵得返「最近一次真正寄出過嘅版本」'
    + '——唔講相對邊一版，幹事根本無從判斷「有 4 位改過」係指乜：'
    + '係相對佢啱啱儲存嗰版？定係相對上一次寄嗰版？兩者可以差好遠',
    last && last.versionNo === 6, JSON.stringify(last));
  check('★★★★ 而且帶埋時間同階段（俾佢一眼對得返）',
    last.sentAt.indexOf('2026-08-20') === 0 && last.stage === 'OFFICIAL',
    JSON.stringify(last));

  // 從來未寄過 ⇒ 冇比較基準，要明講。
  const noneCtx = setup({ sendLog: [] });
  check('★★★★★★ 從來未寄過 ⇒ 回 `null`，**唔可以靜靜攞上一版當基準**'
    + '——嗰樣會變成一個睇落好合理、而完全講唔通嘅比較',
    gas.findLastSentSnapshot_('2027T3') === null);
  check('★★★★★ 畫面嗰陣要講明「選不到」同埋點解',
    /這一季從來沒有寄出過，所以沒有東西可以比較/.test(read('src/WebAppSendPlan.gs')), '');
}

// =====================================================================
console.log('\n=== B2 逐個人要講明**改咗乜**，唔淨係一個名單 ===');
{
  gas.readPostsNormalized = function () {
    return [{ postId: 'CHAIR', postNameTC: '主席' }];
  };
  gas.indexPeopleById_ = function () {
    return {
      P9001: { nameTC: '測試甲' },
      P9002: { nameTC: '測試乙' }
    };
  };
  gas.diffVersionAssignments_ = function () {
    return [
      { serviceDate: '2026-07-11', postId: 'CHAIR', slotIndex: 1,
        fromName: '', toName: '測試甲', fromPersonId: '', toPersonId: 'P9001' },
      { serviceDate: '2026-07-18', postId: 'CHAIR', slotIndex: 1,
        fromName: '測試乙', toName: '測試甲', fromPersonId: 'P9002', toPersonId: 'P9001' }
    ];
  };
  const changed = gas.listChangedPersonsBetweenVersions_('2027T3', 6, 10);
  check('★★★★★★ 逐個人講**改咗乜**（Ivan 要嘅係「7 月 11 日　主席（新增）」）'
    + '——一個淨係寫住名嘅名單，幹事核對唔到，'
    + '於是佢唯一做得到嘅就係照撳',
    (changed.P9001 || []).some(function (t) {
      return t.indexOf('7 月 11 日') !== -1 && t.indexOf('主席') !== -1
        && t.indexOf('（新增）') !== -1;
    }), JSON.stringify(changed));
  check('★★★★★ 被換走嗰個都要有份（佢一樣要知）',
    (changed.P9002 || []).some(function (t) { return t.indexOf('換走了') !== -1; }),
    JSON.stringify(changed));
  check('★★★★★ 同一版比自己 ⇒ 空（唔可以把整季當成「全部改過」）',
    Object.keys(gas.listChangedPersonsBetweenVersions_('2027T3', 10, 10)).length === 0);
  check('★★★★★ 冇基準（`null`）⇒ 空，唔會爆',
    Object.keys(gas.listChangedPersonsBetweenVersions_('2027T3', null, 10)).length === 0);

  check('★★★★★★ `diffVersionAssignments_()` 帶埋 `PersonID`'
    + '——本來只有名字快照，而「只寄給有改動嘅人」要嘅係收件人。'
    + '另寫一份「邊幾格改過」就會出現「畫面數到 4 位、實際寄 5 封」',
    /fromPersonId: beforeId\[key\] \|\| '',/.test(read('src/RosterWriter.gs'))
    && /toPersonId: afterId\[key\] \|\| ''/.test(read('src/RosterWriter.gs')), '');
}

// =====================================================================
console.log('\n=== D【核心】兩處改名 ＋ 儲存後接去寄出 ===');
{
  const flow = read('src/ui/ScriptMainFlow.html');
  const zone1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 第 4 步粒掣叫「下載及匯出」',
    /stepButton\('下載及匯出', \(\) => openPaperDialog\(\)/.test(flow), '');
  check('★★★★★ 而且副標題講清楚**兩種用途**'
    + '——唔講嘅話，幹事以為呢度淨係為咗冇電郵嗰批人，'
    + '而佢想自己留一份 PDF 嗰陣就唔知去邊度攞',
    /下載一份自己留底/.test(flow), '');
  check('★★★★ 「要印紙本的有 N 位」嗰個動態數字保留',
    /要印紙本的有 ' \+ n \+ ' 位/.test(flow), '');
  check('★★★★★ 儲存嗰粒叫「儲存及寄出」',
    /stepButton\('儲存及寄出', \(\) => openSaveAndConfirm\(\)/.test(flow), '');
  check('★★★★★★ 確認窗有「儲存之後直接去寄出」，而且**預設唔勾**'
    + '——預設幫佢揀咗，就等於一個唔為意嘅人撳「照樣儲存」之後'
    + '直接開咗寄出彈窗，而佢以為自己淨係喺度儲存',
    // ⚠️ 第四十七輪批次 A5 組：預設值改咗由 `saveThenSendDefault_` 出，
    // 而佢平時係 `false`，只有由〔立即儲存並繼續〕入嚟先會係 `true`。
    // 守嘅嘢冇變：**平時預設唔勾。**
    /text: '儲存之後直接去寄出'/.test(zone1)
    && /thenSendCb\.checked = saveThenSendDefault_;/.test(zone1)
    && /saveThenSendDefault_ = !!\(opts && opts\.thenSend\);/.test(zone1)
    && /let saveThenSendDefault_ = false;/.test(zone1), '');
  check('★★★★★★ 勾咗都**唔會跳過儲存結果畫面**'
    + '——嗰個係「系統改咗你嗰幾格」嘅唯一證據；'
    + '跳過就變成「撳一粒掣，寄出彈窗彈咗出嚟」',
    /button\('繼續去寄出'/.test(zone1)
    && /openSendDialog\(\);/.test(zone1), '');
}

// =====================================================================
console.log('\n=== C【核心】系統唔可以改動幹事親手改過嘅格（畫面嗰一層）===');
{
  const sug = read('src/ui/ScriptSuggestion.html');
  const sheet = read('src/SuggestionSheet.gs');

  check('★★★★★★ 幹事改過而違反規則嗰幾格**逐格列出嚟俾佢自己決定**'
    + '——Ivan 嘅原則：系統改壞幹事親手做嘅決定，比排錯更差',
    /你改的 ' \+ untouched\.length \+ ' 格違反了規則，系統沒有動它們/.test(sug), '');
  check('★★★★★★ 而且**預設全部唔勾**'
    + '——預設勾好就等於系統仍然喺度替佢決定，'
    + '只係多咗一個佢唔會細睇嘅畫面',
    /cb\.checked = false;   \/\/ ⚠️ 預設不勾/.test(sug), '');
  check('★★★★★ 兩粒掣：〔准系統調整我勾了的〕〔保持原狀〕',
    /button\('准系統調整我勾了的'/.test(sug)
    && /button\('保持原狀'/.test(sug), '');
  check('★★★★★ 一格都冇勾就撳落去 ⇒ **講一句**，唔會靜靜乜都唔做',
    /你一格都沒有勾。系統不會動你改過的任何一格。/.test(sug), '');
  check('★★★★★ 而且再算嗰陣用返同一個起點（唔會由頭再問一次）',
    /openBuildSuggestion\(r\.startSource, allow\)/.test(sug), '');

  check('★★★★★★ 後端預設**一格都唔准動**'
    + '——`allowKeys` 冇傳 ⇒ 空物件；'
    + '預設「全部准」就等於行返舊行為',
    /const allowedKeys = \{\};/.test(sheet)
    && /\(Array\.isArray\(allowKeys\) \? allowKeys : \[\]\)\.forEach/.test(sheet), '');
  check('★★★★★ 第四種顏色有自己嘅色碼，同黃色分開',
    /const SUGGESTION_COLOR_MANUAL_VIOLATION = /.test(sheet), '');
  check('★★★★★ 圖例印埋第四種（唔印就要人自己估）',
    /橙色格 ＝ 你改過、違反了規則，而系統沒有動它/.test(sheet), '');
  check('★★★★★★ 格註明講「系統沒有動它」同埋點樣叫佢動'
    + '——唔講嘅話，佢會以為系統已經修好咗',
    /系統沒有動它——你改的東西系統不會自己改走/.test(sheet)
    && /勾選這一格/.test(sheet), '');
}

// =====================================================================
console.log('\n=== A2 共用元件真係勾唔到（行真正嗰個 `pickListNodes()`）===');
{
  // ⚠️ 呢一節行**真正嗰份**碼。靜態斷言（「檔案入面有 `it.disabled`」）
  // 答唔到「幹事撳落去會唔會勾到」——第四十五輪嗰條教訓。
  const vm = require('vm');
  const common = read('src/ui/Script.html');
  const start = common.indexOf('function pickListNodes(');
  const fnSrc = common.slice(start, common.indexOf('\n  }\n', start) + 4);

  const made = [];
  function fakeEl(tag) {
    const el = {
      tagName: tag, children: [], className: '', textContent: '',
      type: '', checked: false, disabled: false, value: '',
      style: {}, listeners: {},
      appendChild: function (c) { this.children.push(c); return c; },
      addEventListener: function (n, f) { this.listeners[n] = f; },
      setAttribute: function () {}, focus: function () {}
    };
    made.push(el);
    return el;
  }
  const sandbox = {
    document: { createElement: fakeEl },
    make: function (tag, opts, children) {
      const el = fakeEl(tag);
      if (opts) {
        if (opts.text) el.textContent = opts.text;
        if (opts.className) el.className = opts.className;
        if (opts.type) el.type = opts.type;
      }
      (children || []).forEach(function (c) { el.appendChild(c); });
      return el;
    },
    escapeHtml: function (x) { return String(x); },
    console: console
  };
  sandbox.para = function (t, c) { return sandbox.make('div', { text: t, className: c }); };
  sandbox.row = function (kids) { return sandbox.make('div', { className: 'row' }, kids); };
  sandbox.button = function (t) { return sandbox.make('button', { text: t }); };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.pickListNodes = pickListNodes;',
    sandbox, { filename: 'pickListNodes.js' });

  const selected = { A: true, B: true };
  sandbox.pickListNodes({
    items: [
      { key: 'A', label: '測試甲', note: '（這一季 3 格）', warn: '' },
      { key: 'B', label: '測試丙', note: '（這一季 2 格）',
        warn: '⚠ 沒有電郵，收不到信——要用第 4 步印紙本給他', disabled: true }
    ],
    selected: selected,
    onChange: function () {},
    onRedraw: function () {},
    onToggle: function () {}
  });

  const boxes = made.filter(function (e) { return e.type === 'checkbox'; });
  check('★★★★★ 兩行都畫咗出嚟', boxes.length === 2, 'boxes=' + boxes.length);
  check('★★★★★★ **冇電郵嗰個 checkbox 真係 disabled**'
    + '——後端標咗勾唔到而畫面照樣勾得到，等於後端嗰個標記白做',
    boxes[1] && boxes[1].disabled === true);
  check('★★★★★★ 而且**強制解除勾選**'
    + '——`selected` 入面本來係 true；淨係 disable 而唔清走，'
    + '個數字會照計佢，幹事會見到「已選 2 位」而實際只寄到 1 封',
    boxes[1] && boxes[1].checked === false && selected.B === false,
    JSON.stringify(selected));
  check('★★★★ 有電郵嗰個唔受影響',
    boxes[0] && boxes[0].disabled === false && boxes[0].checked === true);
}

console.log(`
${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

