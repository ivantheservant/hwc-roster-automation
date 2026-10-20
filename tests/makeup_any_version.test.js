// 第六十三輪批次 Q 組：「補寄未收到的人」一儲存新版本，全部人都變成「未收到」。
// 執行方式：node tests/makeup_any_version.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（2026-10-20 瀏覽器實測，`2028T2`）
// ═════════════════════════════════════════════════════════════════════
//
//   SendLog：OFFICIAL 只有兩行，VersionNo=2（P0005、P0011，DRY_RUN）
//   之後儲存咗第 3 版
//   「補寄未收到的人 ▸ 正式發出給全體 ▸ 先看預覽」：
//     「這 53 位還沒有收到」——**P0005 都喺入面**（佢已經收過）
//
// 成因：只搵**最新版本**嘅紀錄 ⇒ 一筆都冇。
// 真實使用：全體收咗第 2 版 → 改一格存成第 3 版 → 開補寄 ⇒ 列出全部人；
// 照撳嘅話，全體再收一封「正式發出」。
//
// 下面用假 ID（P92xx）。

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
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PersonalLinkInMail.gs',
  'WebAppGuards.gs', 'MakeupSend.gs', 'WebAppZone4.gs'
]);

const Q = '2099T3';
const L = gas.COLUMNS.SEND_LOG;
const OFFICIAL = gas.MAIL_STAGES.OFFICIAL;

function logRow(v, personId, status, email) {
  const r = {};
  r[L.QUARTER_ID] = Q; r[L.STAGE] = OFFICIAL; r[L.VERSION_NO] = v;
  r[L.STATUS] = status; r[L.PERSON_ID] = personId || ''; r[L.EMAIL] = email || '';
  return r;
}
let SEND_LOG = [];
const RECIPIENTS = [
  { type: 'PERSON', personId: 'P9201', email: 'p9201@example.invalid', displayName: '假甲' },
  { type: 'PERSON', personId: 'P9202', email: 'p9202@example.invalid', displayName: '假乙' },
  { type: 'PERSON', personId: 'P9203', email: '', displayName: '假丙' },
  { type: 'LIST', personId: '', email: 'office@example.invalid', displayName: '教會辦公室' }
];

gas.buildMailContext_ = function () { return {}; };
gas.listRecipients_ = function () { return RECIPIENTS; };
gas.readSheet = function (name) { return name === gas.SHEETS.SEND_LOG ? SEND_LOG : []; };
gas.getConfig = function (_k, d) { return d; };
gas.findEmailTemplate_ = function () { return { attachType: 'PERSONAL_PDF' }; };
gas.findLatestVersionNo = function () { return 3; };
gas.assertWebAppRequestAllowed_ = function () {};
// 第六十五輪批次 W 組：預覽會問個人 PDF 有冇缺——呢份測試唔關 PDF 事，當全部齊
gas.checkMissingPersonalPdfs_ = function () { return { applicable: true, missing: [], absent: [], stale: [] }; };

const keysOf = function (list) {
  return list.map(function (r) { return r.personId || r.email; }).sort();
};

// =====================================================================
console.log('\n=== Q1【核心】收過第 2 版，存咗第 3 版之後唔可以變返「未收到」 ===');
{
  SEND_LOG = [logRow(2, 'P9201', 'DRY_RUN')];
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★★★ P9201（收過第 2 版）**唔喺**補寄名單'
    + '——現場就係佢都喺「還沒有收到」，照撳會令全體再收一封正式發出',
    keysOf(plan.needsResend).indexOf('P9201') === -1, JSON.stringify(keysOf(plan.needsResend)));
  check('★★★★★ 而係「已收」', keysOf(plan.alreadySent).indexOf('P9201') !== -1);
  const a = plan.alreadySent.filter(function (r) { return r.personId === 'P9201'; })[0];
  check('★★★★★ 講明收過邊一版，同埋之後嘅改動要行「改動後重發」',
    a && a.receivedVersionNo === 2 && /第 2 版/.test(a.reason) && /改動後重發/.test(a.reason),
    JSON.stringify(a));
  check('★★★★★ 從來未收過嘅（P9202、辦公室）仍然要補寄',
    JSON.stringify(keysOf(plan.needsResend)) === JSON.stringify(['P9202', 'office@example.invalid']),
    JSON.stringify(keysOf(plan.needsResend)));
  check('★★★★ 冇電郵嘅另外一類', keysOf(plan.cannotSend).join() === 'P9203');
}

console.log('\n=== Q1：收過之後再失敗一次，唔會抹走「收過」 ===');
{
  SEND_LOG = [logRow(2, 'P9201', 'SENT'), logRow(3, 'P9201', 'FAILED')];
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★★ 第 2 版 SENT、第 3 版 FAILED ⇒ 仍然當已收',
    keysOf(plan.alreadySent).indexOf('P9201') !== -1);
  SEND_LOG = [logRow(2, 'P9202', 'FAILED')];
  const plan2 = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★★ 從來冇成功過（只得 FAILED）⇒ 仍然要補寄',
    keysOf(plan2.needsResend).indexOf('P9202') !== -1);
  SEND_LOG = [logRow(2, 'P9202', 'FAILED'), logRow(3, 'P9202', 'DRY_RUN')];
  const plan3 = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★ 先失敗後成功 ⇒ 已收', keysOf(plan3.alreadySent).indexOf('P9202') !== -1);
}

console.log('\n=== Q1：其他季度／其他階段嘅紀錄唔算 ===');
{
  const other = logRow(2, 'P9201', 'SENT');
  other[L.QUARTER_ID] = '2099T2';
  const review = logRow(2, 'P9202', 'SENT');
  review[L.STAGE] = gas.MAIL_STAGES.REVIEW;
  SEND_LOG = [other, review];
  const plan = gas.planMakeupSend_(Q, 3, OFFICIAL);
  check('★★★★★ 另一季收過唔算', keysOf(plan.needsResend).indexOf('P9201') !== -1);
  check('★★★★★ 審閱階段收過唔算正式發出', keysOf(plan.needsResend).indexOf('P9202') !== -1);
}

console.log('\n=== Q2：預覽畫面講明寄第幾版、附甚麼、名單收件人、冇電郵 ===');
{
  SEND_LOG = [logRow(2, 'P9201', 'DRY_RUN')];
  const res = gas.apiMakeupSendPlan(Q, OFFICIAL);
  check('（前置）成功', res.ok, JSON.stringify(res).slice(0, 300));
  check('★★★★★ 帶住版本號（會寄第 3 版）', res.versionNo === 3);
  check('★★★★★ 帶住附件類型同一句人話',
    res.attachType === 'PERSONAL_PDF' && /PDF/.test(res.attachLabel), JSON.stringify(res.attachLabel));
  const office = res.people.filter(function (p) { return p.nameTC === '教會辦公室'; })[0];
  check('★★★★★ 名單收件人標明', office && office.isListRecipient === true, JSON.stringify(res.people));
  check('★★★★ 義工就唔係名單收件人',
    res.people.filter(function (p) { return p.nameTC === '假乙'; })[0].isListRecipient === false);
  check('★★★★★ 冇電郵嘅另外列出（唔係淨係一個數字）',
    res.cannotSend.length === 1 && res.cannotSend[0].nameTC === '假丙', JSON.stringify(res.cannotSend));

  const ui = read('src/ui/ScriptZone4.html');
  check('★★★★ 畫面寫「會寄第 N 版」', /'會寄第 ' \+ plan\.versionNo \+ ' 版/.test(ui));
  check('★★★★ 畫面寫附件', /'附件：' \+ plan\.attachLabel/.test(ui));
  check('★★★★ 畫面標「名單收件人」', /p\.isListRecipient \? '（名單收件人）'/.test(ui));
  check('★★★★ 畫面另外一段列冇電郵嘅人', /makeupCannotSendBox\(plan\.cannotSend\)/.test(ui));
}

console.log('\n=== Q：執行補寄嗰陣重新篩，都係用同一個規則 ===');
{
  const src = read('src/MakeupSend.gs').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // 第六十五輪批次 X 組：兩處改為經 `buildQuarterNoticeReceivedIndex_()`（唔傳版本號），
  // 而 `buildSendStatusByRecipient_()` 只喺嗰一支入面被叫一次
  check('★★★★★ 兩處都唔再傳版本號（經共用嘅 buildQuarterNoticeReceivedIndex_()）',
    (src.match(/buildQuarterNoticeReceivedIndex_\((plan\.)?quarterId, (plan\.)?stage\)/g) || []).length === 2
      && (src.match(/buildSendStatusByRecipient_\(/g) || []).length === 2,
    (src.match(/buildQuarterNoticeReceivedIndex_\([^)]*\)/g) || []).join(' | '));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
