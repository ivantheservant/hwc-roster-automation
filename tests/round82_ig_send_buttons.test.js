// 第八十二輪批次 IG 組：寄出按鈕重整——加〔寄給堂委／執事〕，〔給所有人〕一律是正式發出。
// 執行方式：node tests/round82_ig_send_buttons.test.js
//
// Ivan（手動測試 C）：初稿階段撳〔給所有人〕，寄出嘅其實係審閱本；之後〔變動的人〕一直撳唔到。
// 要加一粒〔寄給堂委／執事〕（堂委、執事、管理員自己、IT 等固定名單），放喺〔給所有人〕前面。
//
//   IG1　初稿階段（DRAFT）〔給所有人〕⇒ 正式發出（kindByMode.ALL＝OFFICIAL）；唔使先寄審閱本／先「意見已收齊」
//        真入口：DRAFT 直接正式發出 ⇒ Stage＝OFFICIAL_SENT
//   IG2　〔寄給堂委／執事〕名單＝堂委＋執事＋IT＋幹事＋審閱固定名單＋登入者本人；同一個地址只寄一次
//   IG3　正式發出之後：〔變動的人〕可以撳；〔寄給堂委／執事〕照寄審閱本、進度唔退回；
//        之後寄嘅審閱本唔會令嗰個人嘅改動喺〔變動的人〕消失
//   IG4　〔選擇其他〕：正式發出之前＝審閱本；之後＝改動通知
//   IG5　零改動〔儲存〕唔再推進度（REVIEW_SENT 照舊）；唔再出「當作意見已收齊」
//   IG6　畫面：第 3 步四粒掣次序；〔變動的人〕灰色原因「要先用〔給所有人〕正式發出一次」；寄出窗標題寫明種類
//   IG7　字眼：src/ 冇「意見已收齊」「先撳「寄給堂委審閱」」等（註解以外）

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
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
function scene(selfEmail) {
  const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
  const gas = sc.gas;
  gas.Session = { getActiveUser: () => ({ getEmail: () => selfEmail }) };
  // 附件「不附」⇒ 唔使個人 PDF（PdfBatch.gs 唔載入；同真嗰支一樣回 applicable=false）
  gas.checkMissingPersonalPdfs_ = () => ({ applicable: false, missing: [], total: 0 });
  // 寄出會算安排 hash（SendLog）——harness 嘅 Utilities 冇 computeDigest，補返
  Object.assign(gas.Utilities, {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (algo, input) => Array.from(require('crypto').createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest()),
    parseDate: (str) => new Date(String(str).slice(0, 10) + 'T12:00:00Z')
  });
  const C = sc.C;
  // 身分：P9701 堂委、P9702 執事、P9703 IT、P9704 幹事（P9704 同時都係堂委 ⇒ 去重）
  const R = C.ROLES;
  if (sc.ss.getSheetByName(sc.S.ROLES)) sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.ROLES));
  const role = (id, p, code) => ({ [R.ROLE_ASSIGNMENT_ID]: id, [R.PERSON_ID]: p, [R.ROLE_CODE]: code,
    [R.EFFECTIVE_FROM]: '2000-01-01', [R.EFFECTIVE_TO]: '', [R.ACTIVE]: true });
  seedSheet(sc.ss, sc.S.ROLES, Object.keys(R).map(() => ''), Object.keys(R).map((k) => R[k]), [
    role('R1', 'P9701', 'COMMITTEE'), role('R2', 'P9702', 'DEACON'), role('R3', 'P9703', 'IT'),
    role('R4', 'P9704', 'CLERK'), role('R5', 'P9704', 'COMMITTEE')
  ]);
  // 固定收件人：審閱（Role=REVIEWER）一個、正式發出階段一個
  const E = C.EMAIL_RECIPIENTS;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_RECIPIENTS));
  seedSheet(sc.ss, sc.S.EMAIL_RECIPIENTS, Object.keys(E).map(() => ''), Object.keys(E).map((k) => E[k]), [
    { [E.RECIPIENT_ID]: 'E1', [E.EMAIL]: 'office@example.invalid', [E.DISPLAY_NAME]: '辦公室', [E.STAGE]: 'OFFICIAL',
      [E.SEND_AS]: 'TO', [E.ACTIVE]: true, [E.ROLE]: 'REVIEWER' },
    { [E.RECIPIENT_ID]: 'E2', [E.EMAIL]: 'only-official@example.invalid', [E.DISPLAY_NAME]: '只收正式', [E.STAGE]: 'OFFICIAL',
      [E.SEND_AS]: 'TO', [E.ACTIVE]: true, [E.ROLE]: '' }
  ]);
  // 範本：三個階段各一（附件「不附」）
  const T = C.EMAIL_TEMPLATES;
  sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.EMAIL_TEMPLATES));
  seedSheet(sc.ss, sc.S.EMAIL_TEMPLATES, Object.keys(T).map(() => ''), Object.keys(T).map((k) => T[k]),
    ['REVIEW', 'OFFICIAL', 'RESEND'].map((st) => ({ [T.TEMPLATE_ID]: 'T_' + st, [T.STAGE]: st, [T.LANG]: 'zh',
      [T.SUBJECT]: '職事表 ' + st, [T.BODY_HTML]: '<p>{{name}}</p>', [T.BODY_PLAIN]: '{{name}}', [T.ATTACH_TYPE]: 'NONE', [T.ACTIVE]: true })));
  gas.apiGenerateDraftExecute(sc.Q);
  return sc;
}

console.log('\n=== IG1：初稿階段〔給所有人〕＝正式發出 ===');
{
  const sc = scene(SELF);
  const gas = sc.gas;
  check('（準備）DRAFT', gas.getQuarterStage_(sc.Q) === 'DRAFT');
  const s = gas.apiGetSendPlanSummary(sc.Q);
  check('★★★★★★ kindByMode：〔給所有人〕＝OFFICIAL、〔寄給堂委／執事〕＝REVIEW、〔選擇其他〕＝REVIEW、〔變動的人〕＝NONE',
    s.kindByMode && s.kindByMode.ALL === 'OFFICIAL' && s.kindByMode.COMMITTEE === 'REVIEW' && s.kindByMode.PICK === 'REVIEW'
      && s.kindByMode.CHANGED === 'NONE', JSON.stringify(s.kindByMode));
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★★ 初稿階段「正式發出」已經可以撳（唔使先寄審閱本、先意見已收齊）', dash.buttons.official.enabled === true,
    JSON.stringify(dash.buttons.official));
  check('★★★★ 掣 3 原因唔再叫人先寄審閱本', !/先撳「寄給堂委審閱」/.test(JSON.stringify(dash.buttons)));
  check('★★★★ 進度文字：初稿已生成，未正式發出給全體', /初稿已生成，未正式發出給全體/.test(dash.statusText || JSON.stringify(dash)));
  check('★★★★ 審閱階段冇提示「先儲存推進度」', s.reviewSentHint === '');
  check('★★★★★ STEP4_ALLOWED_STAGES_ 包括 DRAFT／REVIEW_SENT／REQUESTS_APPLIED',
    ['DRAFT', 'REVIEW_SENT', 'REQUESTS_APPLIED'].every((x) => gas.STEP4_ALLOWED_STAGES_.indexOf(x) !== -1)
      && gas.STEP4_ALLOWED_STAGES_.indexOf('OFFICIAL_SENT') === -1);
  const all = gas.apiGetSendAllRecipients(sc.Q, 'OFFICIAL');
  const r = gas.apiStep4Confirm(sc.Q, { recipientScope: 'PICK', pickedKeys: all.pickedKeys, sendMode: 'ALL', attachType: 'NONE', includeIcs: false });
  check('★★★★★★ 真入口：DRAFT 直接正式發出 ⇒ OFFICIAL_SENT', gas.getQuarterStage_(sc.Q) === 'OFFICIAL_SENT', JSON.stringify(r).slice(0, 300));
}

console.log('\n=== IG2：〔寄給堂委／執事〕名單 ===');
{
  const sc = scene(SELF);
  const gas = sc.gas;
  const r = gas.apiGetSendCommitteeRecipients(sc.Q);
  check('（準備）ok', r.ok === true, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 堂委、執事、IT、幹事都喺名單', ['P9701', 'P9702', 'P9703', 'P9704'].every((id) => r.pickedKeys.indexOf(id) !== -1),
    JSON.stringify(r.pickedKeys));
  check('★★★★★★ 審閱固定名單（Role=REVIEWER）喺；只收正式發出嘅固定收件人唔喺', r.pickedKeys.indexOf('LIST:office@example.invalid') !== -1
    && r.pickedKeys.indexOf('LIST:only-official@example.invalid') === -1, JSON.stringify(r.pickedKeys));
  check('★★★★★ 同一個人只寄一次（P9704 幹事＋堂委）', r.pickedKeys.filter((k) => k === 'P9704').length === 1);
  check('★★★★★★ 登入者本人（唔喺池）⇒ 另外加一個地址', JSON.stringify(r.extraEmails) === JSON.stringify([SELF]) && r.selfInPool === false,
    JSON.stringify([r.extraEmails, r.selfInPool]));
  check('★★★★ 冇服侍、冇身分嘅人唔喺（P9705）', r.pickedKeys.indexOf('P9705') === -1);
  check('★★★★ 每組人數', r.counts.COMMITTEE === 2 && r.counts.DEACON === 1 && r.counts.IT === 1 && r.counts.CLERK === 1 && r.counts.FIXED === 1,
    JSON.stringify(r.counts));
  // 登入者本人就係其中一位堂委 ⇒ 唔另外加
  const p1 = gas.readSheet(sc.S.NAME_MAPPING).filter((row) => row[sc.C.NAME_MAPPING.PERSON_ID] === 'P9701')[0];
  const sc2 = scene(String(p1[sc.C.NAME_MAPPING.EMAIL]).toUpperCase());
  const r2 = sc2.gas.apiGetSendCommitteeRecipients(sc2.Q);
  check('★★★★★★ 登入者本人已經喺名單（大小寫唔同都認得）⇒ 唔重複', r2.extraEmails.length === 0 && r2.selfInPool === true
    && r2.pickedKeys.filter((k) => k === 'P9701').length === 1, JSON.stringify([r2.extraEmails, r2.selfInPool]));
}

console.log('\n=== IG3／IG4：正式發出之後 ===');
{
  const sc = scene(SELF);
  const gas = sc.gas;
  const D = sc.DATES;
  const p1 = sc.nameOf('P9701');
  // 堂委 P9701 第 1 週做主席（正式發出之前先儲存）
  let v = 0;
  if (sc.getCell(0, D[0], 'CHAIR#1') !== p1) {
    sc.setCell(0, D[0], 'CHAIR#1', p1);
    v = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] }).versionNo;
  }
  const all = gas.apiGetSendAllRecipients(sc.Q, 'OFFICIAL');
  gas.apiStep4Confirm(sc.Q, { recipientScope: 'PICK', pickedKeys: all.pickedKeys, sendMode: 'ALL', attachType: 'NONE', includeIcs: false });
  check('（準備）OFFICIAL_SENT', gas.getQuarterStage_(sc.Q) === 'OFFICIAL_SENT');
  check('（準備）堂委 P9701 有一格', sc.getCell(v, D[0], 'CHAIR#1') === p1, sc.getCell(v, D[0], 'CHAIR#1'));
  // 正式發出之後，把 P9701 嗰格換走
  const other = ['P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => n !== p1)[0];
  sc.setCell(v, D[0], 'CHAIR#1', other);
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  const s = gas.apiGetSendPlanSummary(sc.Q);
  check('★★★★★★ 〔變動的人〕可以撳（RESEND）', s.kindByMode.CHANGED === 'RESEND', JSON.stringify(s.kindByMode));
  check('★★★★★ 〔給所有人〕＝改動後重發（全部人）；〔選擇其他〕＝改動通知', s.kindByMode.ALL === 'RESEND' && s.kindByMode.PICK === 'RESEND');
  check('★★★★★★ 〔寄給堂委／執事〕正式發出之後照可以寄（REVIEW）', s.kindByMode.COMMITTEE === 'REVIEW');
  const cr = gas.apiGetSendCommitteeRecipients(sc.Q);
  const rv = gas.apiStep2Confirm(sc.Q, { recipientScope: 'PICK', pickedKeys: cr.pickedKeys, extraEmails: cr.extraEmails,
    sendMode: 'COMMITTEE', attachType: 'NONE', includeIcs: false });
  check('★★★★★★ 審閱本寄得出、進度唔退回（仍然 OFFICIAL_SENT）', rv && gas.getQuarterStage_(sc.Q) === 'OFFICIAL_SENT',
    JSON.stringify(rv).slice(0, 300) + ' stage=' + gas.getQuarterStage_(sc.Q));
  const changed = gas.apiGetSendChangedRecipients(sc.Q);
  check('★★★★★★ 之後寄嘅審閱本唔會令 P9701 喺〔變動的人〕消失', changed.ok && changed.people.some((p) => p.personId === 'P9701'),
    JSON.stringify(changed).slice(0, 400));
}

console.log('\n=== IG5：零改動〔儲存〕唔推進度 ===');
{
  const sc = scene(SELF);
  const gas = sc.gas;
  gas.setQuarterStage_(sc.Q, 'REVIEW_SENT', '測試');
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★ 零改動嘅動作係 NOTHING', plan.zeroChange === true && plan.zeroChangeAction === 'NOTHING', JSON.stringify([plan.zeroChange, plan.zeroChangeAction]));
  const r = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('★★★★★★ 審閱階段零改動儲存 ⇒ 進度唔變、唔講意見已收齊', gas.getQuarterStage_(sc.Q) === 'REVIEW_SENT' && r.stageAdvanced === false
    && !/意見已收齊/.test(r.message), JSON.stringify(r));
  check('★★★★ 第 2 步嗰句唔再叫人撳一下當作意見已收齊', !/意見已收齊/.test(gas.apiGetDashboardState(sc.Q).buttons.save.dynamicText));
}

console.log('\n=== IG6：畫面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const card = ui.renderStepSend({ latestVersion: { versionNo: 1 }, officialSentOnce: false });
  const btns = card.flatten().filter((n) => n.tagName === 'BUTTON');
  check('★★★★★★ 次序：〔寄給堂委／執事〕〔給所有人〕〔變動的人〕〔選擇其他〕',
    btns.map((b) => b.textContent).join('|') === '寄給堂委／執事|給所有人|變動的人|選擇其他', btns.map((b) => b.textContent).join('|'));
  const changedBtn = btns.filter((b) => b.textContent === '變動的人')[0];
  check('★★★★★★ 〔變動的人〕灰色、原因「要先用〔給所有人〕正式發出一次」', changedBtn.disabled === true
    && /要先用〔給所有人〕正式發出一次/.test(changedBtn.title) && /要先用〔給所有人〕正式發出一次/.test(card.textContent), changedBtn.title);
  const card2 = ui.renderStepSend({ latestVersion: { versionNo: 1 }, officialSentOnce: true });
  check('★★★★ 正式發出之後〔變動的人〕亮', card2.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '變動的人')[0].disabled === false);
  const sp = fs.readFileSync(path.join(SRC, 'ui', 'ScriptSendPaper.html'), 'utf8');
  // 第八十四輪批次 KD 組：〔選擇其他〕另有自己嘅標題（pickOtherSendTitle）
  check('★★★★★ 寄出窗標題寫明種類', /: '寄出：' \+ \(SEND_KIND_NAMES_TC\[/.test(sp) && /sendMode_ === 'PICK' \? pickOtherSendTitle\(s\.kind\)/.test(sp));
  check('★★★★★ 〔寄給堂委／執事〕冇〔選擇收件人〕（只顯示摘要）', /sendMode_ === 'COMMITTEE'\) \{\n\s+\/\/ 第八十二輪批次 IG 組：只顯示摘要/.test(sp));
  check('★★★★ 只讀 API 名單有 apiGetSendCommitteeRecipients', /'apiGetSendCommitteeRecipients'/.test(fs.readFileSync(path.join(SRC, 'ui', 'Script.html'), 'utf8')));
}

console.log('\n=== IG7：字眼 ===');
{
  const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  const hits = [];
  const walk = (dir) => fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!/\.(gs|html)$/.test(f)) return;
    const c = codeOnly(fs.readFileSync(p, 'utf8'));
    if (/意見已收齊|先撳「寄給堂委審閱」|收齊意見之後再撳/.test(c)) hits.push(f);
  });
  walk(SRC);
  check('★★★★★ src/（註解以外）冇「意見已收齊」「先撳「寄給堂委審閱」」', hits.length === 0, JSON.stringify(hits));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
