// 第九十四輪批次 UC、UD 組：通知（新申報通知確認者；通知申請人處理結果）及未確認的申報在生成／調整時自動確認。
// 執行方式：node tests/round94_uc_ud_notify_autoconfirm.test.js
//
//   UC1 新申報：收件人＝MAIL_ADMIN_NOTIFY＋UNAVAILABLE_CONFIRMER_EMAILS（去重）；信內有確認畫面的深連結；每日最多一封；經寄信閘門
//   UC2 通知申請人：按人合併一封；確認／不確認的句子；DRY_RUN 只模擬（AuditLog）；沒有電郵 ⇒ 略過並記 AuditLog；
//       真正寄出經 sendRealEmail_（轉寄照舊）；工作表沒有範本 ⇒ 用程式預設；用字不用「接受」「拒絕」「批准」
//   UD1 〔生成初稿〕前自動確認該季的申報（DecidedBy＝系統自動（生成初稿）），建立 Unavailable，通知申請人，然後才排表
//   UD2 〔請系統幫我調整〕前自動確認（系統自動（請系統幫我調整））；〔儲存〕不會
//   UD3 確認窗一句（有待確認時才出現）；自動確認失敗 ⇒ 停下（三段式錯誤），不生成
//   UD4 每日排程自動生成、選單版生成都先自動確認（靜態）
// 用假資料（P97xx、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, tok, T1, T2 } = require('./helpers/unavailable_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function setCfg(sc, key, value) {
  const cfg = sc.ss.getSheetByName(sc.S.CONFIG);
  let found = false;
  for (let r = 3; r <= cfg.getLastRow(); r++) {
    if (cfg.getRange(r, 1).getValue() === key) { cfg.getRange(r, 2).setValue(value); found = true; }
  }
  if (!found) {
    const real = sc.gas.getConfig_;
    const prev = sc.gas.getConfig_;
    sc.gas.getConfig_ = function (k, d) { return k === key ? value : prev(k, d); };
    void real;
  }
  sc.gas.reloadConfigCache_ && sc.gas.reloadConfigCache_();
}

console.log('\n=== UC1：新申報通知 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  setCfg(sc, 'UNAVAILABLE_CONFIRMER_EMAILS', ['deacon@example.invalid', 'CLERK@example.invalid']);
  setCfg(sc, 'WEBAPP_STEWARD_URL', 'https://example.invalid/admin/exec');
  setCfg(sc, 'DRY_RUN', false);
  g.personalSubmitUnavailable(tok(1), '', [T1[1]], '出外', ['READ']);
  const r = g.runUnavailableSubmissionNotify_(sc.today, g.readConfig_(), false);
  check('★★★★★ 寄出一封', r.outcome === 'SENT' && sc.mails.length === 1, JSON.stringify(r));
  const m = sc.mails[0] || {};
  check('★★★★★★ 收件人＝幹事＋確認者（去重，大小寫不分）', m.to === 'clerk@example.invalid,deacon@example.invalid', m.to);
  check('★★★★★★ 信內有確認畫面的深連結（view=unavailable-confirm&quarter=2099T1）', String(m.body).indexOf('https://example.invalid/admin/exec?view=unavailable-confirm&quarter=2099T1') !== -1, m.body);
  check('★★★★★ 列出崗位；按鈕名〔確認申請〕〔不確認〕；不用「接受」', /讀經/.test(m.body) && /〔確認申請〕或〔不確認〕/.test(m.body) && !/接受/.test(m.body), m.body);
  check('★★★★ 講明未確認的會在生成／調整前自動確認', /自動當作確認/.test(m.body));
  const r2 = g.runUnavailableSubmissionNotify_(sc.today, g.readConfig_(), false);
  check('★★★★★ 同一日最多一封', r2.outcome === 'SKIP' && sc.mails.length === 1, JSON.stringify(r2));
  const src = read('src/PersonalUnavailable.gs');
  check('★★★★ 經 notifyAdmin_（寄信閘門）', /notifyAdmin_\(text\.subject, text\.body, recipients\.join\(','\), isDryRun\)/.test(src));
  check('★★★★ 沒有設定幹事介面網址 ⇒ 寫去哪裏找（不出空連結）', /開季前準備 ▸ 不能服侍的日期/.test(g.buildUnavailableSubmissionNotifyText_('', [{ personName: '甲', serviceDate: T1[0] }], 1, '').body));
}

console.log('\n=== UC2：通知申請人 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0], T1[1]], '', ['READ']);
  g.personalSubmitUnavailable(tok(2), '', [T1[2]], '', []);
  let ids = sc.subs().map((s) => s.submissionId);
  // DRY_RUN（預設 TRUE）⇒ 模擬
  let r = g.decideUnavailableSubmissions_(ids.slice(0, 1), 'ACCEPT', 'clerk@example.invalid');
  check('★★★★★★ DRY_RUN ⇒ 不寄，AuditLog 記模擬（UNAVAILABLE_DECISION_NOTIFIED｜DRY_RUN）', sc.mails.length === 0
    && sc.audits('UNAVAILABLE_DECISION_NOTIFIED').some((a) => a.NewValue === 'DRY_RUN'), JSON.stringify(sc.audits('UNAVAILABLE_DECISION_NOTIFIED')));
  check('★★★★ 訊息講明模擬', /測試模式，模擬 1 封/.test(r.message), r.message);
  setCfg(sc, 'DRY_RUN', false);
  r = g.decideUnavailableSubmissions_(ids.slice(1), 'ACCEPT', 'clerk@example.invalid');
  check('★★★★★★ 一次決定兩個人 ⇒ 兩封（按人合併）', sc.mails.length === 2, JSON.stringify(sc.mails.map((x) => x.to)));
  const m1 = sc.mails.filter((x) => /假甲|P9701/.test(x.body) || x.to === g.readPeople_().filter((p) => p.PersonID === 'P9701')[0].Email)[0] || sc.mails[0];
  check('★★★★★★ 確認句子：「你申報 2099年1-3月 以下主日不能服侍，已確認了你的申請：」＋清單（日子、崗位）＋「系統排表時會避開這些日子。如需更改，請聯絡幹事。」',
    sc.mails.some((x) => /你申報 2099年1-3月 以下主日不能服侍，已確認了你的申請：/.test(x.body) && /1 月 11 日（讀經）/.test(x.body)
      && /系統排表時會避開這些日子。如需更改，請聯絡幹事。/.test(x.body)), JSON.stringify(sc.mails.map((x) => x.body)));
  check('★★★★★ 主旨用範本（工作表沒有這一行 ⇒ 程式預設）', sc.mails.every((x) => /不能服侍的申報：處理結果/.test(x.subject)), JSON.stringify(sc.mails.map((x) => x.subject)));
  // 不確認
  sc.mails.length = 0;
  g.personalSubmitUnavailable(tok(3), '', [T1[3]], '', []);
  g.decideUnavailableSubmissions_(sc.subs().filter((s) => s.personId === 'P9703').map((s) => s.submissionId), 'REJECT', 'clerk@example.invalid');
  check('★★★★★★ 不確認句子：「未能確認你以下的申請：」＋清單＋「請聯絡幹事了解。」', sc.mails.length === 1 && /未能確認你以下的申請：/.test(sc.mails[0].body)
    && /請聯絡幹事了解。/.test(sc.mails[0].body) && !/接受|拒絕|批准/.test(sc.mails[0].body + sc.mails[0].html), sc.mails[0] && sc.mails[0].body);
  // 沒有電郵：P9707
  g.personalSubmitUnavailable(tok(7), '', [T1[0]], '', []);
  const before = sc.mails.length;
  g.decideUnavailableSubmissions_(sc.subs().filter((s) => s.personId === 'P9707').map((s) => s.submissionId), 'ACCEPT', 'clerk@example.invalid');
  check('★★★★★ 沒有電郵 ⇒ 略過並記 AuditLog（NO_EMAIL）', sc.mails.length === before && sc.audits('UNAVAILABLE_DECISION_NOTIFIED').some((a) => a.NewValue === 'NO_EMAIL' && a.TargetKey === 'P9707'));
  // 轉寄照舊
  setCfg(sc, 'MAIL_REDIRECT_ALL_TO', 'redirect@example.invalid');
  sc.mails.length = 0;
  g.personalSubmitUnavailable(tok(4), '', [T1[0]], '', []);
  g.decideUnavailableSubmissions_(sc.subs().filter((s) => s.personId === 'P9704').map((s) => s.submissionId), 'ACCEPT', 'clerk@example.invalid');
  check('★★★★★ 轉寄照舊（經 sendRealEmail_ → 寄信閘門）', sc.mails.length === 1 && sc.mails[0].to === 'redirect@example.invalid' && /^\[原收件人：/.test(sc.mails[0].subject), JSON.stringify(sc.mails));
  const seed = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_UNAVAILABLE_DECIDED_TC')[0];
  check('★★★★★ EmailTemplateSeed 有 TPL_UNAVAILABLE_DECIDED_TC', !!seed && /\{DecisionHtml\}/.test(seed.bodyHtml) && /\{DecisionPlain\}/.test(seed.bodyPlain));
}

console.log('\n=== UD1／UD3：生成前自動確認 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0]], '', ['READ']);
  g.personalSubmitUnavailable(tok(2), '', [T2[0]], '', []);   // 下一季：不會被自動確認
  const plan = g.apiGenerateDraftPlan(sc.Q);
  check('★★★★★★ 生成確認窗：「還有 1 項事奉人員申報未確認，開始之後會自動當作確認，並通知申請人。」（只計這一季）',
    plan.pendingAutoConfirmText === '還有 1 項事奉人員申報未確認，開始之後會自動當作確認，並通知申請人。' && plan.pendingAutoConfirmCount === 1, JSON.stringify(plan.pendingAutoConfirmText));
  const res = g.apiGenerateDraftExecute(sc.Q);
  const mine = sc.subs().filter((s) => s.personId === 'P9701')[0];
  check('★★★★★★ 生成之後：那一項變「已確認」，DecidedBy＝系統自動（生成初稿）', res.ok && mine.status === 'ACCEPTED' && mine.decidedBy === '系統自動（生成初稿）', JSON.stringify(mine));
  check('★★★★★ 下一季的申報不會被自動確認', sc.subs().filter((s) => s.personId === 'P9702')[0].status === 'PENDING');
  check('★★★★★ 建立了 Unavailable（只限讀經）', sc.unav().some((r) => r.PersonID === 'P9701' && r.AppliesTo === 'POSTS' && String(r.PostIDs) === 'READ'));
  check('★★★★★ 通知申請人（DRY_RUN 下為模擬，AuditLog 有紀錄）', sc.audits('UNAVAILABLE_DECISION_NOTIFIED').some((a) => a.TargetKey === 'P9701'));
  check('★★★★ 完成窗有一句「已自動確認 1 項事奉人員申報，並通知申請人。」', res.autoConfirmMessage === '已自動確認 1 項事奉人員申報，並通知申請人。', res.autoConfirmMessage);
  const A = sc.C.ROSTER_ASSIGNMENTS;
  check('★★★★★★ 排表時已經避開：P9701 在 ' + T1[0] + ' 沒有被排讀經', !g.readSheet_(sc.S.ROSTER_ASSIGNMENTS)
    .some((r) => g.toDateString_(r[A.SERVICE_DATE], sc.TZ) === T1[0] && r[A.POST_ID] === 'READ' && r[A.PERSON_ID] === 'P9701'));
  const plan2 = g.apiGenerateDraftPlan('2099T2');
  check('★★★★ 沒有待確認 ⇒ 確認窗沒有那一句（這裏 T2 有 1 項，所以有）', plan2.pendingAutoConfirmText !== undefined);
}
{
  // 失敗會停
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0]], '', []);
  const realOpen = g.openSheetForEdit_;
  g.openSheetForEdit_ = function (name) { if (name === sc.S.UNAVAILABLE) throw new Error('寫入失敗（測試）'); return realOpen(name); };
  const res = g.apiGenerateDraftExecute(sc.Q);
  check('★★★★★★ 自動確認失敗 ⇒ 停下，三段式錯誤，沒有生成任何版本', res.ok === false && res.versionCreated === false && /自動確認事奉人員申報時出錯/.test(res.message)
    && /沒有開始排表/.test(res.message) && g.findLatestVersionNo_(sc.Q) < 0, JSON.stringify(res).slice(0, 400));
  check('★★★★ 申報仍然等候確認（沒有靜靜略過）', sc.subs()[0].status === 'PENDING');
  g.openSheetForEdit_ = realOpen;
}

console.log('\n=== UD2：請系統幫我調整前自動確認；儲存不會 ===');
{
  const sc = buildUnavailableScene({ extraFiles: ['StateSource.gs'] });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.personalSubmitUnavailable(tok(3), '', [T1[1]], '', []);
  // 儲存：不會自動確認
  try { g.apiSaveAndConfirmExecute(sc.Q, {}); } catch (e) { /* 沒有改動也可以 */ }
  check('★★★★★★ 〔儲存〕不會自動確認', sc.subs().filter((s) => s.personId === 'P9703')[0].status === 'PENDING');
  const pre = g.apiCheckMyChanges(sc.Q);
  check('★★★★★ 調整確認窗（〔檢查我的改動〕資料）有那一句', pre.pendingAutoConfirmText === '還有 1 項事奉人員申報未確認，開始之後會自動當作確認，並通知申請人。', pre.pendingAutoConfirmText);
  try { g.apiBuildSuggestion(sc.Q, 'GRID', []); } catch (e) { /* 只看自動確認 */ }
  const s3 = sc.subs().filter((s) => s.personId === 'P9703')[0];
  check('★★★★★★ 〔請系統幫我調整〕之後：DecidedBy＝系統自動（請系統幫我調整）', s3.status === 'ACCEPTED' && s3.decidedBy === '系統自動（請系統幫我調整）', JSON.stringify(s3));
  const src = read('src/SuggestionSheet.gs');
  const body = src.slice(src.indexOf('function apiBuildSuggestion_locked_'));
  check('★★★★★ 自動確認在讀資料、計算建議之前', body.indexOf('autoConfirmPendingSubmissionsForQuarter_(quarterId, UNAVAILABLE_AUTO_CONFIRM_BY.SUGGEST)') !== -1
    && body.indexOf('autoConfirmPendingSubmissionsForQuarter_') < body.indexOf('buildSuggestionState_('));
}

console.log('\n=== UD4：其他入口（靜態）===');
{
  const trig = read('src/Trigger.gs');
  check('★★★★★ 每日排程自動生成：先自動確認再生成', /autoConfirmPendingSubmissionsForQuarter_\(quarterId, UNAVAILABLE_AUTO_CONFIRM_BY\.GENERATE\);\s*const gen = performRosterGeneration_\(quarterId\);/.test(trig));
  check('★★★★ 選單版生成：先自動確認再生成', /autoConfirmPendingSubmissionsForQuarter_\(quarterId, UNAVAILABLE_AUTO_CONFIRM_BY\.GENERATE\);\s*const result = performRosterGeneration_\(quarterId\);/.test(read('src/FourStageFlow.gs')));
  const others = ['src/WebAppSaveConfirm.gs', 'src/RosterImport.gs', 'src/WebAppRollback.gs'].filter((f) => /autoConfirmPendingSubmissionsForQuarter_/.test(read(f)));
  check('★★★★★ 儲存、匯入、用舊版本作起點不會自動確認', others.length === 0, others.join());
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★★ 生成確認窗顯示那一句；有待確認時不再寫「不會寄出任何電郵」', /if \(plan\.pendingAutoConfirmText\) \{\s*facts\.appendChild\(make\('div', \{ text: plan\.pendingAutoConfirmText, className: 'warn-head' \}\)\);/.test(z1) && /不會寄出職事表；只會通知那幾位申請人/.test(z1));
  const sg = read('src/ui/ScriptSuggestion.html');
  check('★★★★★ 調整前：沒有其他要決定的項目也先出一個窗講那一句', /pre\.pendingAutoConfirmText[\s\S]{0,200}openModal\('請系統幫我調整'/.test(sg));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
