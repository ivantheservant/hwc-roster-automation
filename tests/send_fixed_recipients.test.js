// 第七十輪批次 AT 組：正式發出時，辦公室等固定收件人（EmailRecipients 的 LIST 型）預設要收到。
// 執行方式：node tests/send_fixed_recipients.test.js
//
// 現場（2026-10-21 截圖 s49）：正式發出揀「職事表上全部人」之後，補寄預覽列出
// 「教會辦公室（名單收件人）、系統管理（名單收件人）還沒有收到」——
// 「選擇收件人」沒有任何一組勾得到他們。
//
// 做法：「選擇收件人」新增一組「辦公室等固定收件人（N 位）」，成員＝該階段
// `listRecipients_(stage, context)` 中 type=LIST 的人（用現有函式）；
// 只有正式發出預設勾上，寄給堂委審閱／改動後重發有這一組但不預設勾。
// 下面一律用假地址（.invalid），不涉及真實姓名。

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

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
  'WebAppGuards.gs', 'SendOptions.gs', 'SendRecipients.gs', 'EmailRecipientsSeed.gs',
  'Mailer.gs', 'MakeupSend.gs', 'WebAppSendPlan.gs'
]);

const TZ = 'Pacific/Auckland';
const Q = '2027T3';

/** 三行 EmailRecipients：辦公室（正式發出＋重發）、IT 管理（正式發出）、審閱名單（審閱）。 */
function emailRecipientRows() {
  const R = gas.COLUMNS.EMAIL_RECIPIENTS;
  const mk = function (email, name, stage, role) {
    const row = {};
    row[R.ACTIVE] = true;
    row[R.EMAIL] = email;
    row[R.DISPLAY_NAME] = name;
    row[R.SEND_AS] = 'TO';
    row[R.STAGE] = stage;
    row[R.ROLE] = role;
    return row;
  };
  return [
    mk('office@example.invalid', '固定甲', 'OFFICIAL,RESEND', 'ALL'),
    mk('it@example.invalid', '固定乙', 'OFFICIAL', 'ALL'),
    mk('review@example.invalid', '審閱丙', 'REVIEW', 'REVIEWER')
  ];
}

function setup(sendLog) {
  const people = {
    P9001: { personId: 'P9001', nameTC: '測試甲', email: 'a@example.invalid' },
    P9002: { personId: 'P9002', nameTC: '測試乙', email: 'b@example.invalid' }
  };
  gas.readRolesSafe_ = function () { return []; };
  gas.Utilities = {
    formatDate: function (d) {
      if (d === undefined || d === null || !(d instanceof Date) && isNaN(new Date(d))) return '2027-10-01';
      const iso = new Date(d).toISOString();
      return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
    }
  };
  gas.getConfig = function (_k, d) { return d; };
  gas.findLatestVersionNo = function () { return 3; };
  gas.beginSheetReadMemo_ = function () {};
  gas.endSheetReadMemo_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.EMAIL_RECIPIENTS) return emailRecipientRows();
    if (name === gas.SHEETS.SEND_LOG) return sendLog || [];
    return [];
  };
  const context = {
    quarterId: Q, versionNo: 3, stage: gas.MAIL_STAGES.OFFICIAL, timezone: TZ,
    peopleById: people,
    assignmentsByPerson: { P9001: [{}, {}], P9002: [{}] },
    lastHashByPerson: {}
  };
  gas.buildMailContext_ = function () { return context; };
  gas.listChangedPersonsBetweenVersions_ = function () { return {}; };
  return context;
}

function groupOf(res, key) {
  return res.groups.filter(function (g) { return g.key === key; })[0];
}

// =====================================================================
console.log('\n=== AT1 新增一組「辦公室等固定收件人」，成員來自 listRecipients_() ===');
{
  setup();
  const res = gas.apiGetSendRecipientPool(Q, 'OFFICIAL');
  check('★★★★ 池讀得到', res.ok === true, JSON.stringify(res).slice(0, 300));
  const g = groupOf(res, 'FIXED');
  check('★★★★★★ 有「辦公室等固定收件人」這一組', !!g && g.label === '辦公室等固定收件人', JSON.stringify(res.groups));
  checkEqual('★★★★★★ 正式發出：成員是 Stage 含 OFFICIAL 的兩位（不含只審閱的那位）',
    g.members.map(function (m) { return m.displayName; }).sort(), ['固定乙', '固定甲']);
  check('★★★★★ 人數由後端數（2 位），電郵遮蔽（不顯示整個地址）',
    g.total === 2 && g.selectable === 2
    && g.members.every(function (m) { return m.emailMasked.indexOf('***') !== -1 && m.emailMasked.indexOf('office@') === -1; }),
    JSON.stringify(g));
  const items = res.items.filter(function (i) { return i.sources.indexOf('FIXED') !== -1; });
  checkEqual('★★★★★ 池內項目標了 FIXED（鍵同寄出時 sendRecipientKey_ 一致）',
    items.map(function (i) { return i.key; }).sort(),
    ['LIST:it@example.invalid', 'LIST:office@example.invalid']);

  const review = gas.apiGetSendRecipientPool(Q, 'REVIEW');
  checkEqual('★★★★★ 寄給堂委審閱：這一組是 Role=REVIEWER 那一位（同 listRecipients_ 一樣）',
    groupOf(review, 'FIXED').members.map(function (m) { return m.displayName; }), ['審閱丙']);
  const resend = gas.apiGetSendRecipientPool(Q, 'RESEND');
  checkEqual('★★★★★ 改動後重發：這一組是 Stage 含 RESEND 那一位',
    groupOf(resend, 'FIXED').members.map(function (m) { return m.displayName; }), ['固定甲']);
}

// =====================================================================
console.log('\n=== AT2 只有正式發出預設勾上 ===');
{
  setup();
  const official = gas.apiGetSendRecipientPool(Q, 'OFFICIAL');
  checkEqual('★★★★★★ 正式發出：預設勾上兩位固定收件人',
    official.defaultPickedKeys.slice().sort(),
    ['LIST:it@example.invalid', 'LIST:office@example.invalid']);
  checkEqual('★★★★★★ 寄給堂委審閱：有這一組但**不預設勾**',
    gas.apiGetSendRecipientPool(Q, 'REVIEW').defaultPickedKeys, []);
  checkEqual('★★★★★★ 改動後重發：有這一組但**不預設勾**',
    gas.apiGetSendRecipientPool(Q, 'RESEND').defaultPickedKeys, []);
  checkEqual('★★★★ 不傳階段（舊呼叫）當正式發出，不爆',
    gas.apiGetSendRecipientPool(Q).defaultPickedKeys.length, 2);
}

// =====================================================================
console.log('\n=== AT3 實際寄出名單同畫面講的一致（確認窗／完成窗都計入）===');
{
  const context = setup();
  const keys = ['P9001', 'LIST:office@example.invalid', 'LIST:it@example.invalid'];
  const picked = {};
  keys.forEach(function (k) { picked[k] = true; });
  const actual = gas.resolveActualRecipientsFromContext_(context, gas.MAIL_STAGES.OFFICIAL,
    { recipientScope: 'PICK', pickedKeys: keys });
  checkEqual('★★★★★★ 勾了「職事表上的 1 位 ＋ 固定收件人 2 位」⇒ 實際收件人 3 位，LIST 兩位在內',
    actual.map(function (r) { return r.personId || r.email; }).sort(),
    ['LIST:it@example.invalid'.slice(5), 'LIST:office@example.invalid'.slice(5), 'P9001'].sort());
}

// =====================================================================
console.log('\n=== AT4 補寄「還沒有收到」：正式發出有寄 ⇒ 不再列；取消了 ⇒ 照舊列 ===');
{
  const C = gas.COLUMNS.SEND_LOG;
  const logRow = function (email, personId) {
    const row = {};
    row[C.QUARTER_ID] = Q; row[C.STAGE] = 'OFFICIAL'; row[C.VERSION_NO] = 3;
    row[C.SENT_AT] = '2027-10-01T00:00:00Z'; row[C.STATUS] = 'DRY_RUN';
    row[C.PERSON_ID] = personId || ''; row[C.EMAIL] = email || '';
    return row;
  };
  const missingNames = function (plan) {
    return plan.needsResend.map(function (e) { return e.displayName; }).sort();
  };

  // 有勾固定收件人：SendLog 有他們（LIST 用電郵做鍵）
  setup([logRow('a@example.invalid', 'P9001'), logRow('b@example.invalid', 'P9002'),
    logRow('office@example.invalid'), logRow('it@example.invalid')]);
  const withFixed = gas.planMakeupSend_(Q, 3, gas.MAIL_STAGES.OFFICIAL);
  checkEqual('★★★★★★ 正式發出（含預設組）之後，補寄「還沒有收到」為空',
    missingNames(withFixed), []);

  // 幹事取消了這一組：SendLog 只有義工
  setup([logRow('a@example.invalid', 'P9001'), logRow('b@example.invalid', 'P9002')]);
  const without = gas.planMakeupSend_(Q, 3, gas.MAIL_STAGES.OFFICIAL);
  checkEqual('★★★★★★ 幹事取消了這一組 ⇒ 照舊列出（這是真實的未收到）',
    missingNames(without), ['固定乙', '固定甲']);
}

// =====================================================================
console.log('\n=== AT5 畫面：開「選擇收件人」時由後端的預設勾上；取消了不會被加回去 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptSendPaper.html']);
  const pool = {
    ok: true, versionNo: 3,
    items: [
      { key: 'P9001', type: 'PERSON', displayName: '測試甲', sources: ['ROSTER'], selectable: true, cellCount: 2, hasEmail: true, roles: [] },
      { key: 'LIST:office@example.invalid', type: 'LIST', displayName: '固定甲', sources: ['FIXED'], selectable: true, cellCount: 0, hasEmail: true, roles: [] }
    ],
    groups: [
      { key: 'ROSTER', label: '職事表上全部人', total: 1, selectable: 1, members: [] },
      { key: 'FIXED', label: '辦公室等固定收件人', total: 1, selectable: 1,
        members: [{ displayName: '固定甲', emailMasked: 'o***@example.invalid' }] }
    ],
    defaultPickedKeys: ['LIST:office@example.invalid'],
    changed: { hasBaseline: false, sentence: '' }
  };
  ui.__pool = pool;
  const argsSeen = [];
  ui.__argsSeen = argsSeen;
  vm.runInContext(
    'callServer = async function (fn) { __argsSeen.push([].slice.call(arguments)); return __pool; };'
    + 'runAction = async function (label, fn) { await fn(); };'
    + 'currentQuarterId = "2027T3";'
    + 'sendOptions_ = { pickedKeys: [], extraEmails: [], extraEmailsRaw: "", recipientScope: "PICK" };', ui);
  vm.runInContext('openSendRecipients({ kind: "OFFICIAL" })', ui);
  // runAction 是 async，等一個 tick
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    const picked = vm.runInContext('sendOptions_.pickedKeys', ui);
    checkEqual('★★★★★★ 正式發出開窗：固定收件人預設勾上', Array.from(picked), ['LIST:office@example.invalid']);
    check('★★★★★ 前端把階段傳給後端（後端決定是哪一個階段的名單）',
      argsSeen.length === 1 && argsSeen[0][0] === 'apiGetSendRecipientPool' && argsSeen[0][2] === 'OFFICIAL',
      JSON.stringify(argsSeen));

    // 幹事取消了這一組，再開一次窗：不可以被加回去
    vm.runInContext('sendOptions_.pickedKeys = []; sendPool_ = null;', ui);
    vm.runInContext('openSendRecipients({ kind: "OFFICIAL" })', ui);
    return Promise.resolve().then(() => Promise.resolve());
  }).then(() => {
    const picked = vm.runInContext('sendOptions_.pickedKeys', ui);
    checkEqual('★★★★★★ 幹事取消之後再開窗，不會被預設加回去（同一次彈窗只加一次）', Array.from(picked), []);

    const text = vm.runInContext(
      '(function(){ var t = ""; var walk = function (n) { t += (n._text || "") + "\\n"; (n.children||[]).forEach(walk); };'
      + 'walk(document.getElementById("modalBody")); return t; })()', ui);
    check('★★★★★ 固定收件人那一組逐位列出名稱（電郵已遮蔽）',
      text.indexOf('辦公室等固定收件人（1 位）') !== -1 && text.indexOf('固定甲（o***@example.invalid）') !== -1, text);

    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptSendPaper.html'), 'utf8');
    check('★★★★★ 前端沒有寫死哪個階段預設勾（預設值由後端 defaultPickedKeys 決定）',
      src.indexOf("kind === 'OFFICIAL' && ") === -1 || /defaultPickedKeys/.test(src), '');
    console.log(fail === 0 ? '\nOK' : `\n${fail} FAILURE(S)`);
    process.exit(fail === 0 ? 0 : 1);
  });
}
