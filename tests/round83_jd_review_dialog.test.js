// 第八十三輪批次 JD 組：〔寄給堂委／執事〕窗嘅字眼同「收不到電郵」名單。
// 執行方式：node tests/round83_jd_review_dialog.test.js
//
// 現場（第八十二輪 Q5）：
//   ・摘要寫「這一次會寄給 11 位：職事表上全部人 7 位、另外堂委 1 位……」——審閱本唔係寄畀職事表上全部人
//   ・底部有〔改為再寄一次審閱本〕，但呢一季從未寄過，而且呢粒掣本身已經係寄審閱本
//   ・確認窗、完成窗「這幾位收不到電郵」列出 7 位只喺職事表上嘅人（唔喺審閱名單）
//
//   JD1　摘要句只按組別寫，冇「職事表上全部人」
//   JD2　審閱本嘅「收不到電郵」只由審閱名單計：唔包括只喺職事表上嘅人（預覽＋完成）
//   JD3　〔寄給堂委／執事〕一律冇〔改為再寄一次審閱本〕；〔選擇其他〕未寄過審閱本亦冇；寄過先有
//   JD4　〔給所有人〕照舊用職事表嗰一份

const fs = require('fs');
const path = require('path');
const { buildSendScene } = require('./helpers/send_scene.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const SRC = path.join(__dirname, '..', 'src');
const SELF = 'k@example.invalid';

// 冇電郵：P9702（執事，喺審閱名單）同 P9705（只喺職事表上）
function blankEmail(sc, ids) {
  const sh = sc.ss.getSheetByName(sc.S.NAME_MAPPING);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const idCol = keys.indexOf(sc.C.NAME_MAPPING.PERSON_ID) + 1;
  const emCol = keys.indexOf(sc.C.NAME_MAPPING.EMAIL) + 1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (ids.indexOf(String(sh.getRange(r, idCol).getValue())) !== -1) sh.getRange(r, emCol).setValue('');
  }
}
const names = (u) => ((u && u.people) || []).map((p) => p.name);
const committeeOpts = (cr) => ({ recipientScope: 'PICK', pickedKeys: cr.pickedKeys, extraEmails: cr.extraEmails,
  sendMode: 'COMMITTEE', attachType: 'NONE', includeIcs: false });

console.log('\n=== JD2／JD4：「收不到電郵」只由這一次的收件人計 ===');
{
  const sc = buildSendScene(SELF);
  const gas = sc.gas;
  blankEmail(sc, ['P9702', 'P9705']);
  const cr = gas.apiGetSendCommitteeRecipients(sc.Q);
  const pv = gas.apiStep2Preview(sc.Q, committeeOpts(cr));
  check('★★★★★★ JD2 審閱本預覽：列出審閱名單內冇電郵嘅執事', names(pv.unreachable).indexOf(sc.nameOf('P9702')) !== -1,
    JSON.stringify(pv.unreachable));
  check('★★★★★★ JD2 審閱本預覽：唔包括只喺職事表上嘅人', names(pv.unreachable).indexOf(sc.nameOf('P9705')) === -1,
    JSON.stringify(pv.unreachable));
  const done = gas.apiStep2Confirm(sc.Q, committeeOpts(cr));
  check('★★★★★★ JD2 審閱本完成窗：同一份（有執事、冇職事表上嘅人）',
    names(done.unreachable).indexOf(sc.nameOf('P9702')) !== -1 && names(done.unreachable).indexOf(sc.nameOf('P9705')) === -1,
    JSON.stringify(done.unreachable));
  const onRoster = gas.readSheet_(sc.S.ROSTER_ASSIGNMENTS).some((r) => r[sc.C.ROSTER_ASSIGNMENTS.PERSON_ID] === 'P9705');
  const roster = gas.buildUnreachablePeople_(sc.Q, null);
  check('★★★★★ JD4〔給所有人〕照舊用職事表嗰一份（職事表上冇電郵嘅人喺度）',
    !onRoster || names(roster).indexOf(sc.nameOf('P9705')) !== -1, JSON.stringify([onRoster, roster]));
  check('★★★★ JD4 給所有人預覽仍然叫 buildUnreachablePeople_（職事表）',
    fs.readFileSync(path.join(SRC, 'WebAppFlow.gs'), 'utf8').indexOf('preview.unreachable = buildUnreachablePeople_(quarterId, versionNo);') !== -1);
}

console.log('\n=== JD3：〔改為再寄一次審閱本〕===');
{
  const sc = buildSendScene(SELF);
  const gas = sc.gas;
  const s0 = gas.apiGetSendPlanSummary(sc.Q);
  check('★★★★★★ JD3 未寄過審閱本 ⇒ alsoReview＝false', s0.alsoReview === false, JSON.stringify(s0.alsoReview));
  const cr = gas.apiGetSendCommitteeRecipients(sc.Q);
  gas.apiStep2Confirm(sc.Q, committeeOpts(cr));
  const s1 = gas.apiGetSendPlanSummary(sc.Q);
  check('★★★★★ JD3 寄過審閱本（未正式發出）⇒ alsoReview＝true', s1.alsoReview === true, JSON.stringify([s1.kind, s1.alsoReview]));
  const sp = fs.readFileSync(path.join(SRC, 'ui', 'ScriptSendPaper.html'), 'utf8');
  check('★★★★★★ JD3 前端只喺〔選擇其他〕（PICK）先顯示', sp.indexOf("if (s.alsoReview && sendMode_ === 'PICK') {") !== -1);
}

console.log('\n=== JD1：摘要句 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptSendPaper.html']);
  const d = { counts: { COMMITTEE: 6, DEACON: 4, IT: 0, CLERK: 0, FIXED: 3 }, selfEmail: 'a@example.invalid', noEmailNames: [] };
  const t = ui.committeeSummarySentence(d, 11);
  check('★★★★★★ JD1 只按組別寫', t === '這一次會寄給 11 位：堂委 6 位、執事 4 位、IT 0 位、幹事 0 位、固定收件人 3 個、你自己（同一個人只寄一次）。', t);
  check('★★★★★★ JD1 冇「職事表上全部人」', t.indexOf('職事表上全部人') === -1);
  const sp = fs.readFileSync(path.join(SRC, 'ui', 'ScriptSendPaper.html'), 'utf8');
  check('★★★★★ JD1 寄出窗〔寄給堂委／執事〕用呢一句（唔用通用嗰句）',
    /text: sendMode_ === 'COMMITTEE'\s*\? committeeSummarySentence\(/.test(sp));
  check('★★★★ 冇登入者電郵 ⇒ 唔寫「你自己」', ui.committeeSummarySentence({ counts: {} }, 0).indexOf('你自己') === -1);
  check('★★★★ 補充行只講沒有電郵的人', ui.committeeSummaryLines({ noEmailNames: ['甲'] }).length === 1
    && ui.committeeSummaryLines({}).length === 0);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
