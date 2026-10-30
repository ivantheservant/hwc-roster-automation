// 第七十輪批次 AU 組：「改為再寄一次審閱本」寄給上一次審閱本實際寄出的同一批人。
// 執行方式：node tests/review_same_batch.test.js
//
// 現場（2026-10-21 截圖 s31）：第一次審閱本寄給 6 位堂委（幹事在「選擇收件人」自己勾）。
// 之後撳〔改為再寄一次審閱本〕，確認窗寫「會再寄一次給同一批人」，列出的卻是
// `EmailRecipients` 的 3 個 REVIEWER 預設名單。
//
// 批次用 `SendLog.SendID`（季度-v版本-階段-批次時間戳-序號）去掉序號判斷，不新增欄位。
// 下面一律用假 PersonID 和 .invalid 地址。

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

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Roles.gs',
  'WebAppGuards.gs', 'SendOptions.gs', 'SendRecipients.gs', 'EmailRecipientsSeed.gs',
  'Mailer.gs', 'WebAppPeople.gs', 'WebAppDashboard.gs', 'WebAppSendPlan.gs'
]);
const TZ = 'Pacific/Auckland';
const Q = '2027T3';
const C = gas.COLUMNS.SEND_LOG;
gas.Utilities = {
  formatDate: function (d) {
    const iso = new Date(d).toISOString();
    return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
  }
};

function row(o) {
  const r = {};
  r[C.QUARTER_ID] = o.q || Q;
  r[C.VERSION_NO] = o.v === undefined ? 3 : o.v;
  r[C.STAGE] = o.stage || 'REVIEW';
  r[C.SEND_ID] = o.sendId === undefined ? '' : o.sendId;
  r[C.PERSON_ID] = o.personId || '';
  r[C.EMAIL] = o.email || '';
  r[C.SENT_AT] = o.sentAt || '2027-10-01T09:00:00Z';
  r[C.STATUS] = o.status || 'DRY_RUN';
  return r;
}
/** 一批（同一個批次時間戳）。 */
function batch(stamp, sentAt, people, lists, extra) {
  extra = extra || {};
  const out = [];
  let i = 0;
  (people || []).forEach(function (p) {
    i++;
    out.push(row({ sendId: Q + '-v3-REVIEW-' + stamp + '-' + i, personId: p, sentAt: sentAt,
      stage: extra.stage, status: extra.status }));
  });
  (lists || []).forEach(function (e) {
    i++;
    out.push(row({ sendId: Q + '-v3-REVIEW-' + stamp + '-' + i, email: e, sentAt: sentAt,
      stage: extra.stage, status: extra.status }));
  });
  return out;
}

// =====================================================================
console.log('\n=== AU1 findLastReviewBatch_：最近一次實際寄出嘅同一批人 ===');
{
  const rows = []
    // 較早一批：只寄給 3 個名單收件人（預設審閱名單）
    .concat(batch('B1', '2027-10-01T09:00:00Z', [],
      ['a@example.invalid', 'b@example.invalid', 'c@example.invalid']))
    // 最近一批：幹事自己勾咗 6 位
    .concat(batch('B2', '2027-10-01T11:00:00Z',
      ['P9001', 'P9002', 'P9003', 'P9004', 'P9005', 'P9006'], []))
    // 之後一批 OFFICIAL（唔係審閱，唔可以當成最近一次審閱）
    .concat(batch('B3', '2027-10-01T12:00:00Z', ['P9001', 'P9007'], [], { stage: 'OFFICIAL' }))
    // 另一季
    .concat([row({ q: '2027T4', sendId: '2027T4-v1-REVIEW-x-1', personId: 'P9100', sentAt: '2027-10-01T13:00:00Z' })]);
  const b = gas.findLastReviewBatch_(rows, Q, TZ);
  check('★★★★ 找到', b.found === true, JSON.stringify(b));
  checkEqual('★★★★★★ 就是最近一次審閱嗰 6 位（唔係較早嗰 3 個名單、唔係後來嘅正式發出）',
    b.personIds, ['P9001', 'P9002', 'P9003', 'P9004', 'P9005', 'P9006']);
  check('★★★★★ 名單收件人唔混入最近一批', b.listEmails.length === 0 && b.count === 6, JSON.stringify(b));

  // 實際寄出先算：查無電郵略過、失敗嘅唔算
  const mixed = batch('B4', '2027-10-01T13:00:00Z', ['P9001', 'P9002'], [])
    .concat([row({ sendId: Q + '-v3-REVIEW-B4-9', personId: 'P9003', status: 'SKIPPED_NO_EMAIL', sentAt: '2027-10-01T13:00:00Z' }),
      row({ sendId: Q + '-v3-REVIEW-B4-10', personId: 'P9004', status: 'FAILED', sentAt: '2027-10-01T13:00:00Z' })]);
  checkEqual('★★★★★★ 只計實際寄出（SENT／DRY_RUN）：略過同失敗嘅唔算「收過」',
    gas.findLastReviewBatch_(mixed, Q, TZ).personIds, ['P9001', 'P9002']);

  checkEqual('★★★★★ 從來冇寄過審閱 ⇒ found:false（唔係空批當成找到）',
    gas.findLastReviewBatch_(batch('x', '2027-10-01T13:00:00Z', ['P9001'], [], { stage: 'OFFICIAL' }), Q, TZ).found, false);

  // 舊紀錄冇 SendID ⇒ 退回「版本＋分鐘」
  const legacy = [
    row({ personId: 'P9001', sentAt: '2027-10-01T09:00:10Z' }),
    row({ personId: 'P9002', sentAt: '2027-10-01T09:00:40Z' }),
    row({ personId: 'P9003', sentAt: '2027-10-01T07:00:00Z' })
  ];
  checkEqual('★★★★ 舊紀錄冇 SendID：同一分鐘歸一批',
    gas.findLastReviewBatch_(legacy, Q, TZ).personIds, ['P9001', 'P9002']);
}

// =====================================================================
console.log('\n=== AU2 apiGetLastReviewSendOptions：回 PICK 選項；已不在池嘅人點數；自訂地址放 extraEmails ===');
{
  const people = {
    P9001: { personId: 'P9001', nameTC: '測試甲', email: 'a1@example.invalid' },
    P9002: { personId: 'P9002', nameTC: '測試乙', email: 'a2@example.invalid' },
    P9003: { personId: 'P9003', nameTC: '測試丙', email: 'a3@example.invalid' }
  };
  const R = gas.COLUMNS.EMAIL_RECIPIENTS;
  const listRow = function (email, name, stage, role) {
    const r = {}; r[R.ACTIVE] = true; r[R.EMAIL] = email; r[R.DISPLAY_NAME] = name;
    r[R.SEND_AS] = 'TO'; r[R.STAGE] = stage; r[R.ROLE] = role; return r;
  };
  const sendLog = []
    .concat(batch('B2', '2027-10-01T11:00:00Z', ['P9001', 'P9002', 'P9999'],
      ['rev@example.invalid', 'typed@example.invalid']));
  gas.readRolesSafe_ = function () { return []; };
  gas.Utilities = { formatDate: function (d) { return new Date(d).toISOString().slice(0, 10) + ' ' + new Date(d).toISOString().slice(11, 16); } };
  gas.getConfig_ = function (_k, d) { return d; };
  gas.findLatestVersionNo_ = function () { return 3; };
  gas.beginSheetReadMemo_ = function () {};
  gas.endSheetReadMemo_ = function () {};
  gas.assertWebAppRequestAllowed_ = function () {};
  let log = sendLog;
  gas.readSheet_ = function (name) {
    if (name === gas.SHEETS.EMAIL_RECIPIENTS) return [listRow('rev@example.invalid', '審閱丙', 'REVIEW', 'REVIEWER')];
    if (name === gas.SHEETS.SEND_LOG) return log;
    return [];
  };
  gas.buildMailContext_ = function () {
    return { quarterId: Q, versionNo: 3, timezone: TZ, peopleById: people,
      assignmentsByPerson: { P9001: [{}], P9002: [{}], P9003: [{}] }, lastHashByPerson: {} };
  };

  const r = gas.apiGetLastReviewSendOptions(Q);
  check('★★★★ ok', r.ok === true, JSON.stringify(r));
  check('★★★★ found', r.found === true && r.count === 5, JSON.stringify(r));
  checkEqual('★★★★★★ 收件人＝上一批：池內嘅 PERSON、名單收件人用 LIST: 鍵',
    r.sendOptions.pickedKeys.slice().sort(), ['LIST:rev@example.invalid', 'P9001', 'P9002']);
  checkEqual('★★★★★ 上次自己輸入嘅地址放入 extraEmails（唔係靜靜丟掉）',
    r.sendOptions.extraEmails, ['typed@example.invalid']);
  check('★★★★★★ 已經唔喺收件人池嘅人（P9999）點數，畫面講明唔會寄',
    r.droppedCount === 1, JSON.stringify(r));
  check('★★★★★ 用 PICK', r.sendOptions.recipientScope === 'PICK');

  // 用呢份選項落去真正解析收件人：寄嘅就係上一批，唔係預設審閱名單
  const ctx = gas.buildMailContext_();
  const actual = gas.resolveActualRecipientsFromContext_(ctx, gas.MAIL_STAGES.REVIEW, r.sendOptions);
  checkEqual('★★★★★★ 實際收件人＝上一批（預覽同真正寄出行同一條解析）',
    actual.map(function (a) { return a.personId || a.email; }).sort(),
    ['P9001', 'P9002', 'rev@example.invalid', 'typed@example.invalid']);

  log = [];
  checkEqual('★★★★★ 從來冇寄過 ⇒ found:false', gas.apiGetLastReviewSendOptions(Q).found, false);
}

// =====================================================================
console.log('\n=== AU3 畫面：句子按實際情況寫；〔改為再寄一次審閱本〕走同一批人這條路 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptSendPaper.html']);
  const sentence = function (last, meta) {
    ui.__last = last; ui.__meta = meta;
    return vm.runInContext('reviewLastSentSentence_(__last, __meta)', ui);
  };
  checkEqual('★★★★★★ 讀得到上一批 ⇒ 保留「會再寄一次給同一批人」',
    sentence('2027-10-01 11:00', { sameBatch: true, droppedCount: 0 }),
    '上次在 2027-10-01 11:00 寄過，會再寄一次給同一批人。');
  check('★★★★★ 上一批有人已不在名單 ⇒ 講明',
    /有 2 位現在已不在收件名單上/.test(sentence('2027-10-01 11:00', { sameBatch: true, droppedCount: 2 })));
  checkEqual('★★★★★★ 讀不到 ⇒ 用預設審閱名單，句子照實寫',
    sentence('2027-10-01 11:00', { lookupFailed: true }),
    '查不到上一次的收件人，這一次會寄給預設的審閱名單。');
  checkEqual('★★★★★★ 其他路徑（幹事自己選人／預設名單）：只講上次幾時寄，唔講「同一批人」',
    sentence('2027-10-01 11:00', null), '上次在 2027-10-01 11:00 寄過。');
  checkEqual('★★★★ 從來冇寄過 ⇒ 冇句子', sentence('', null), '');

  const paper = read('src/ui/ScriptSendPaper.html');
  check('★★★★★★ 〔改為再寄一次審閱本〕叫 openReviewSameBatch()，唔再叫冇參數嘅 openReview()',
    /button\('改為再寄一次審閱本', \(\) => \{ closeModal\(\); openReviewSameBatch\(\); \}/.test(paper), '');

  // openReviewSameBatch：讀到 ⇒ sendOptions 交畀 openReview；讀唔到 ⇒ null ＋ lookupFailed
  const seen = [];
  ui.__seen = seen;
  vm.runInContext(
    'runAction = async function (label, fn) { await fn(); };'
    + 'currentQuarterId = "2027T3";'
    + 'openReview = function (o, m) { __seen.push([o, m]); };'
    + 'callServer = async function () { return { ok: true, found: true, sendOptions: { recipientScope: "PICK", pickedKeys: ["P9001"], extraEmails: [] }, droppedCount: 1 }; };', ui);
  Promise.resolve(vm.runInContext('openReviewSameBatch()', ui)).then(() => Promise.resolve()).then(() => {
    check('★★★★★★ 讀到上一批 ⇒ openReview(sendOptions, {sameBatch:true})',
      seen.length === 1 && seen[0][0].pickedKeys[0] === 'P9001' && seen[0][1].sameBatch === true
      && seen[0][1].droppedCount === 1, JSON.stringify(seen));
    vm.runInContext(
      'callServer = async function () { return { ok: true, found: false }; };', ui);
    return Promise.resolve(vm.runInContext('openReviewSameBatch()', ui)).then(() => Promise.resolve());
  }).then(() => {
    check('★★★★★★ 讀唔到 ⇒ openReview(null, {lookupFailed:true})（預設審閱名單，照實講）',
      seen.length === 2 && seen[1][0] === null && seen[1][1].lookupFailed === true, JSON.stringify(seen));

    const zone = read('src/ui/ScriptZone1.html');
    check('★★★★★ 確認窗嗰句由 reviewLastSentSentence_() 出，原始碼冇寫死「同一批人」嘅 para',
      /reviewLastSentSentence_\(last, meta\)/.test(zone)
      && zone.indexOf("para('上次在 ' + last + ' 寄過，會再寄一次給同一批人。')") === -1, '');
    check('★★★★★ 後端 API 已經登記為唯讀',
      /'apiGetLastReviewSendOptions'/.test(read('src/ui/Script.html')), '');
    check('★★★★★ 儀表板按鈕文字唔再寫死「重新寄給同一批人」',
      read('src/WebAppDashboard.gs').indexOf('再撳一次會重新寄給同一批人') === -1, '');
    check('★★★★★ SendLog 整個檔仍然只讀一次（WebAppDashboard.gs 嘅規矩）',
      (read('src/WebAppDashboard.gs').split('\n')
        .filter(function (l) { return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n')
        .match(/readSheet_\(SHEETS\.SEND_LOG\)/g) || []).length === 1, '');
    console.log(fail === 0 ? 'OK' : fail + ' FAILURE(S)');
    process.exit(fail === 0 ? 0 : 1);
  });
}
