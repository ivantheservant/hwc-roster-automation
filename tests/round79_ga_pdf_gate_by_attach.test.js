// 第七十九輪批次 GA 組：個人 PDF 缺件檢查跟「這一次實際揀嘅附件」。
// 執行方式：node tests/round79_ga_pdf_gate_by_attach.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十八輪回歸第二次 K6）
// ═════════════════════════════════════════════════════════════════════
//
//   〔給所有人〕寄出窗揀咗附件「不附」、日曆檔唔勾 →〔寄出〕→
//   出「正式發出：還沒有個人 PDF」（58 / 58 人不能用），要等約 8 分鐘產生 58 份 PDF。
//   「不附」根本唔需要個人 PDF。成因：缺件檢查淨係睇範本嘅 AttachType，唔理幹事今次揀嘅。
//
//   GA1　揀「不附」⇒ 前端問嘅檢查唔適用、唔擋；後端閘門放行
//   GA2　揀「整季 PDF」⇒ 唔查個人 PDF
//   GA3　揀「個人版 PDF」而缺件 ⇒ 兩道閘門都照擋（唔准放寬）
//   GA4　冇傳 sendOptions（試算表選單版）⇒ 照範本，同以前一樣
//   GA5　範本寫「不附」、幹事改揀「個人版 PDF」⇒ 都要查（同寄信同一個解析）
//   GA6　前端 openOfficial() 真係傳 sendOpts；其他入口用同一支判斷

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'SendOptions.gs', 'Mailer.gs',
  'PdfBatch.gs', 'FiveStageCore.gs', 'WebAppFlow.gs'
]);

const Q = '2099T4';
let TEMPLATE_ATTACH = 'PERSONAL_PDF';
let sendCalled = 0;
const PEOPLE = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map((id) => ({ personId: id, nameTC: '假' + id }));

gas.findEmailTemplate_ = function () { return { attachType: TEMPLATE_ATTACH }; };
gas.findEmailTemplateById_ = function () { return null; };
gas.getConfig_ = function (_k, d) { return d; };
gas.requireQuarterStage_ = function () {};
gas.assertWebAppRequestAllowed_ = function () {};
gas.listPeopleNeedingPersonalPdf_ = function () { return PEOPLE; };
gas.listRosterPdfInfoForQuarter_ = function () { return new Map(); };   // 一份都冇
gas.readPersonalPdfContentStamp_ = function () { return { updatedAt: '', timezone: 'UTC' }; };
gas.buildAttachmentName_ = function (q, v, n) { return q + '_' + v + '_' + n + '.pdf'; };
gas.findLatestVersionNo_ = function () { return 1; };
gas.ensurePublicLinkFreshBeforeSend_ = function () { return { republished: false }; };
gas.sendStage_ = function () { sendCalled++; throw new Error('SEND_REACHED'); };
gas.log_ = function () {};

function warnings(opts) { return gas.apiStep4GetMissingPdfWarnings(Q, 1, opts); }
function sendOutcome(opts) {
  sendCalled = 0;
  try { gas.executeStep4Send_(Q, opts); } catch (e) {
    return { sent: sendCalled > 0, blocked: /個人 PDF 缺件太多/.test(e.message), msg: e.message };
  }
  return { sent: sendCalled > 0, blocked: false, msg: '' };
}

console.log('\n=== GA1【核心】揀「不附」⇒ 唔擋 ===');
{
  TEMPLATE_ATTACH = 'PERSONAL_PDF';
  const w = warnings({ attachType: 'NONE', includeIcs: false });
  check('★★★★★★ 前端問嘅檢查：applicable=false、blocked=false（唔使產生 58 份）',
    w.applicable === false && w.blocked === false && w.missingTotal === 0, JSON.stringify(w));
  const s = sendOutcome({ attachType: 'NONE', includeIcs: false });
  check('★★★★★★ 後端閘門放行（行到 sendStage_）', s.sent === true && s.blocked === false, s.msg);
}

console.log('\n=== GA2：揀「整季 PDF」⇒ 唔查個人 PDF ===');
{
  const w = warnings({ attachType: 'FULL_PDF' });
  check('★★★★★ applicable=false、blocked=false', w.applicable === false && w.blocked === false, JSON.stringify(w));
  const s = sendOutcome({ attachType: 'FULL_PDF' });
  check('★★★★★ 後端放行', s.sent === true && s.blocked === false, s.msg);
}

console.log('\n=== GA3【核心】揀「個人版 PDF」而缺件 ⇒ 兩道閘門都擋（唔准放寬）===');
{
  const w = warnings({ attachType: 'PERSONAL_PDF' });
  check('★★★★★★ 前端問嘅檢查：applicable=true、blocked=true、5/5 缺',
    w.applicable === true && w.blocked === true && w.missingTotal === 5 && w.total === 5, JSON.stringify(w));
  const s = sendOutcome({ attachType: 'PERSONAL_PDF' });
  check('★★★★★★ 後端閘門擋住，一封都冇寄', s.blocked === true && s.sent === false, s.msg);
}

console.log('\n=== GA4：冇傳 sendOptions（選單版）⇒ 照範本 ===');
{
  TEMPLATE_ATTACH = 'PERSONAL_PDF';
  const a = warnings(null);
  check('★★★★★ 範本個人版 PDF、冇傳 ⇒ 照擋', a.applicable === true && a.blocked === true, JSON.stringify(a));
  check('★★★★★ undefined 一樣', warnings(undefined).blocked === true);
  check('★★★★★ 後端冇傳 ⇒ 照擋', sendOutcome(undefined).blocked === true && sendOutcome(null).sent === false);
  const e = warnings({});
  check('★★★★ 空物件（冇揀附件）⇒ 跟範本，照擋', e.applicable === true && e.blocked === true, JSON.stringify(e));

  TEMPLATE_ATTACH = 'NONE';
  const n = warnings(null);
  check('★★★★ 範本「不附」、冇傳 ⇒ 唔適用（同以前一樣）', n.applicable === false && n.blocked === false, JSON.stringify(n));
  check('★★★★ 後端放行', sendOutcome(null).sent === true);
}

console.log('\n=== GA5：範本「不附」、幹事改揀「個人版 PDF」⇒ 都要查 ===');
{
  TEMPLATE_ATTACH = 'NONE';
  const w = warnings({ attachType: 'PERSONAL_PDF' });
  check('★★★★★ 前端問嘅檢查擋', w.applicable === true && w.blocked === true, JSON.stringify(w));
  const s = sendOutcome({ attachType: 'PERSONAL_PDF' });
  check('★★★★★ 後端閘門擋（同寄信同一個解析）', s.blocked === true && s.sent === false, s.msg);
  TEMPLATE_ATTACH = 'PERSONAL_PDF';
}

console.log('\n=== GA6：入口核對（靜態）===');
{
  const zone1 = read('src/ui/ScriptZone1.html');
  check('★★★★★★ 前端 openOfficial() 把 sendOpts 傳俾 apiStep4GetMissingPdfWarnings',
    /callServer\(\s*'apiStep4GetMissingPdfWarnings',\s*currentQuarterId,\s*versionNo,\s*sendOpts\s*\)/.test(zone1));
  check('★★★★ 補完 PDF 之後行返轉頭仍然帶住 sendOpts',
    /onBack:\s*\(\)\s*=>\s*\{\s*closeModal\(\);\s*openOfficial\(sendOpts\);/.test(zone1));
  const core = read('src/FiveStageCore.gs');
  check('★★★★★ planStep4MissingPdf_ 收 sendOptions 並傳落 checkMissingPersonalPdfs_',
    /function planStep4MissingPdf_\(quarterId, versionNo, sendOptions\)/.test(core)
      && /checkMissingPersonalPdfs_\(quarterId, versionNo, MAIL_STAGES\.OFFICIAL, sendOptions\)/.test(core));
  const send = core.slice(core.indexOf('function executeStep4Send_'));
  check('★★★★★ executeStep4Send_ 閘門傳 sendOptions',
    /evaluateStep4MissingPdfGate_\(\s*checkMissingPersonalPdfs_\(quarterId, versionNo, MAIL_STAGES\.OFFICIAL, sendOptions\)\)/.test(send));
  const pdf = read('src/PdfBatch.gs');
  check('★★★★★ 附件判斷用 resolveSendOptions_()（唔另寫一套）',
    /function personalPdfNeededForSend_[\s\S]*?resolveSendOptions_\(stage, sendOptions, resolveStageTemplates_\(stage\)\)/.test(pdf));
  const menu = read('src/Menu.gs');
  check('★★★ 選單版（沒有揀附件的畫面）維持照範本：只傳三個參數',
    /checkMissingPersonalPdfs_\(target\.quarterId, target\.versionNo, stage\)/.test(menu));
  check('★★★★ 補寄用這一次實際附件（個人版 PDF）去查',
    /checkMissingPersonalPdfs_\(plan\.quarterId, plan\.versionNo, plan\.stage,\s*\{ attachType: ATTACH_TYPE\.PERSONAL_PDF \}\)/.test(read('src/MakeupSend.gs')));
  check('★★★★ 改動後重發本來就按 decision.attachType（第六十四輪 V 組）仍然一致',
    /decision\.attachType !== ATTACH_TYPE\.PERSONAL_PDF\) return \[\]/.test(read('src/ResendFlow.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
