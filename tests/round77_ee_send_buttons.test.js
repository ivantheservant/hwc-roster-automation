// 第七十七輪批次 EE 組：第 3 步三粒寄出掣；未儲存時嘅畫面；自行輸入電郵。
// 執行方式：node tests/round77_ee_send_buttons.test.js
//
// Ivan（手動測試 B）：第 3 步加〔給所有人〕〔變動的人〕〔選擇其他〕；只填自行輸入電郵要寄得出；
// 有未儲存改動：提示先儲存、拿走〔立即儲存並繼續〕、加〔寄出上一個版本〕、保留〔取消〕；
// 主寄出窗拿走「另外自行輸入電郵」，只留喺〔選擇收件人〕視窗。
//
//   EE1　後端：只填自行輸入電郵、一位都冇勾 ⇒ 可以寄（resolveSendOptions_ 唔拋）；兩樣都冇先拋
//   EE2　後端：〔給所有人〕名單＝職事表上全部人（有電郵）∪ 堂委 ∪ 執事（∪ 固定收件人，按 Config）；冇電郵嘅另外列
//   EE3　後端：〔選擇其他〕預設勾選＝「有改動」嗰組；從來未寄過 ⇒ 一位都唔勾；唔再預設勾固定收件人
//   EE4　後端：officialSentOnce（OFFICIAL／RESEND／EXTERNAL 有紀錄）；〔變動的人〕未正式發出 ⇒ notOfficialYet；名單只計安排真係改咗嘅
//   EE5　後端：正式發出之後〔給所有人〕行改動後重發嗰條路，每一位都有理由（唔會 SKIPPED_UNCHANGED）；唔改 RESEND_ONLY_CHANGED
//   EE6　畫面：第 3 步三粒掣；〔變動的人〕未正式發出時變灰、有原因
//   EE7　畫面：未儲存窗只有〔寄出上一個版本（第 K 版）〕〔取消〕；撳落去直接開寄出窗、頂部黃框
//   EE8　畫面：〔給所有人〕主窗冇〔選擇收件人〕、冇自行輸入電郵；確認時 sendMode=ALL
//   EE9　畫面：〔變動的人〕逐個列出「原本／現在」；冇人改過 ⇒ 一句＋〔知道了〕
//   EE10　畫面：〔選擇其他〕自動開收件人視窗；按鈕叫〔確認〕；只填自行輸入電郵可以寄
//   EE11　源碼：thenSend／立即儲存並繼續／寄出但不儲存 全部清走

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sc = buildRound75Scene({ extraFiles: ['SendOptions.gs', 'WebAppSendPlan.gs', 'WebAppPeople.gs', 'PersonalLinkInMail.gs'] });
const gas = sc.gas;
gas.apiGenerateDraftExecute(sc.Q);

console.log('\n=== EE1：只填自行輸入電郵可以寄 ===');
{
  let threw = '';
  let d = null;
  try { d = gas.resolveSendOptions_('REVIEW', { recipientScope: 'PICK', pickedKeys: [], extraEmails: ['a@example.invalid'] }, null); } catch (e) { threw = e.message; }
  check('★★★★★★ PICK＋一位都冇勾＋有自訂地址 ⇒ 唔拋、extraEmails 1 個', threw === '' && d && d.extraEmails.length === 1, threw);
  threw = '';
  try { gas.resolveSendOptions_('OFFICIAL', { recipientScope: 'PICK', pickedKeys: [], extraEmails: [] }, null); } catch (e) { threw = e.message; }
  check('★★★★★ 兩樣都冇 ⇒ 照舊拋「一位都沒有選」', /一位都沒有選/.test(threw), threw);
  check('★★★★ sendMode 原樣帶落去（唔認得就空）', gas.resolveSendOptions_('RESEND', { sendMode: 'ALL', pickedKeys: ['P9701'] }, null).sendMode === 'ALL'
    && gas.resolveSendOptions_('RESEND', { sendMode: 'xyz', pickedKeys: ['P9701'] }, null).sendMode === '');
  check('★★★★★ resendHasExplicitRecipients_：ALL 或者有勾人先算', gas.resendHasExplicitRecipients_({ sendMode: 'ALL' }) === true
    && gas.resendHasExplicitRecipients_({ pickedKeys: ['P1'] }) === true && gas.resendHasExplicitRecipients_({ sendMode: 'CHANGED', pickedKeys: [] }) === false
    && gas.resendHasExplicitRecipients_(null) === false);
}

console.log('\n=== EE2：〔給所有人〕名單由後端算 ===');
{
  const r = gas.apiGetSendAllRecipients(sc.Q, 'OFFICIAL');
  check('（準備）ok', r.ok === true, JSON.stringify(r).slice(0, 300));
  const rosterIds = Object.keys(gas.buildMailContext_(sc.Q, 0, 'OFFICIAL').assignmentsByPerson || {});
  const withEmail = rosterIds.filter((id) => id !== 'P9707');
  check('★★★★★★ 職事表上全部有電郵嘅人都喺名單', withEmail.length > 0 && withEmail.every((id) => r.pickedKeys.indexOf(id) !== -1), JSON.stringify([withEmail, r.pickedKeys]));
  check('★★★★★★ 冇電郵嘅（P9707）唔喺 pickedKeys，另外列出嚟畀第 4 步', r.pickedKeys.indexOf('P9707') === -1
    && (rosterIds.indexOf('P9707') === -1 || (r.noEmailCount === 1 && r.noEmailNames[0] === sc.nameOf('P9707'))), JSON.stringify([r.noEmailCount, r.noEmailNames]));
  check('★★★★ 預設包括固定收件人（Config SEND_ALL_INCLUDES_FIXED 預設 TRUE）', r.includesFixed === true);
  check('★★★★ 帶埋池同分組（摘要句由實際勾咗乜算）', Array.isArray(r.items) && Array.isArray(r.groups) && r.groups.length > 0);
  const src = read('src/ConfigSeed.gs');
  check('★★★★ Config 有種子 SEND_ALL_INCLUDES_FIXED（MAIL 組、預設 TRUE）', /CONFIG_KEYS\.SEND_ALL_INCLUDES_FIXED, type: CONFIG_TYPES\.BOOL, group: 'MAIL',\n\s+defaultValue: 'TRUE'/.test(src));
}

console.log('\n=== EE3：〔選擇其他〕預設勾選 ===');
{
  const pool = [
    { key: 'P1', selectable: true, sources: ['ROSTER', 'CHANGED'] },
    { key: 'P2', selectable: true, sources: ['ROSTER'] },
    { key: 'P3', selectable: false, sources: ['ROSTER', 'CHANGED'] },
    { key: 'LIST:office@example.invalid', selectable: true, sources: ['FIXED'] }
  ];
  check('★★★★★★ 有基準 ⇒ 預設勾「有改動」嗰組（有電郵嘅）', JSON.stringify(gas.defaultPickedKeysForChanged_(pool, { versionNo: 1 })) === '["P1"]');
  check('★★★★★ 從來未寄過 ⇒ 一位都唔勾（固定收件人都唔勾）', gas.defaultPickedKeysForChanged_(pool, null).length === 0);
  const r = gas.apiGetSendRecipientPool(sc.Q, 'OFFICIAL');
  check('★★★★★ 真入口：從來未寄過 ⇒ defaultPickedKeys 空', r.ok && r.defaultPickedKeys.length === 0, JSON.stringify(r.defaultPickedKeys));
}

console.log('\n=== EE4：officialSentOnce／〔變動的人〕 ===');
{
  const L = sc.C.SEND_LOG;
  const realRead = gas.readSheet_;
  const withLog = (rows) => { gas.readSheet_ = (n) => (n === sc.S.SEND_LOG ? rows : realRead(n)); };
  const row = (stage, status) => ({ [L.QUARTER_ID]: sc.Q, [L.STAGE]: stage, [L.STATUS]: status, [L.VERSION_NO]: 0, [L.SENT_AT]: '2099-01-02 10:00:00' });
  withLog([row('REVIEW', 'DRY_RUN')]);
  check('★★★★★ 只寄過審閱本 ⇒ officialSentOnce=false', gas.readSendLogSummaryForDashboard_(sc.Q, sc.TZ).officialSentOnce === false);
  const before = gas.apiGetSendChangedRecipients(sc.Q);
  check('★★★★★★ 未正式發出 ⇒ notOfficialYet，講明用〔給所有人〕或〔選擇其他〕', before.ok === false && before.notOfficialYet === true && /給所有人/.test(before.message), JSON.stringify(before));
  withLog([row('RESEND', 'DRY_RUN')]);
  check('★★★★★ RESEND 有紀錄 ⇒ true', gas.readSendLogSummaryForDashboard_(sc.Q, sc.TZ).officialSentOnce === true);
  withLog([row('OFFICIAL', 'EXTERNAL')]);
  check('★★★★★ 匯入時聲明已在系統外寄出（EXTERNAL）⇒ true', gas.readSendLogSummaryForDashboard_(sc.Q, sc.TZ).officialSentOnce === true);
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 主畫面帶 officialSentOnce', dash.officialSentOnce === true);

  // 名單形狀：用改動後重發同一支（planResendChangedPersons_），只計安排真係改咗嘅
  const realPlan = gas.planResendChangedPersons_;
  gas.planResendChangedPersons_ = () => ({ versionNo: 3, changed: [
    { personId: 'P9701', nameTC: '假甲', arrangementChanged: true, hasEmail: true, hasAssignments: true, previousSummary: '04/01 主席', currentSummary: '11/01 主席' },
    { personId: 'P9707', nameTC: '假庚', arrangementChanged: true, hasEmail: false, hasAssignments: false, previousSummary: '04/01 讀經', currentSummary: '' },
    { personId: 'P9702', nameTC: '假乙', arrangementChanged: false, hasEmail: true, hasAssignments: true }
  ] });
  gas.readResendChangeNotes_ = () => ({ P9701: ['1 月 4 日　主席（換走了，改為 假丙）'] });
  const r = gas.apiGetSendChangedRecipients(sc.Q);
  check('★★★★★★ 只列安排真係改咗嘅 2 位（包括被換走嘅人）；上次冇收到嘅 1 位只計數', r.ok && r.people.length === 2 && r.notReceivedCount === 1, JSON.stringify(r));
  check('★★★★★ pickedKeys 只有有電郵嘅；冇電郵嘅另外列名', JSON.stringify(r.pickedKeys) === '["P9701"]' && JSON.stringify(r.noEmailNames) === '["假庚"]', JSON.stringify(r));
  check('★★★★ 每人帶「原本／現在」同改動描述', r.people[0].changeNotes.length === 1 && r.people[0].previousSummary === '04/01 主席');
  gas.planResendChangedPersons_ = () => ({ versionNo: 3, changed: [] });
  check('★★★★★ 冇人改過 ⇒ noChanges', gas.apiGetSendChangedRecipients(sc.Q).noChanges === true);
  gas.planResendChangedPersons_ = realPlan;
  gas.readSheet_ = realRead;
}

console.log('\n=== EE5：正式發出之後〔給所有人〕 ===');
{
  const btnsOff = { review: { enabled: false }, official: { enabled: false }, resend: { enabled: false, disabledReason: '沒有人的安排改過，不需要重發。' } };
  check('★★★★★★ 三粒都唔著、進度已正式發出、冇未儲存 ⇒ 〔給所有人〕行改動後重發',
    gas.resolveSendKindForAll_(btnsOff, { stage: 'OFFICIAL_SENT', unsaved: { hasAny: false } }) === 'RESEND');
  check('★★★★★ 有未儲存 ⇒ NONE（照舊擋）', gas.resolveSendKindForAll_(btnsOff, { stage: 'OFFICIAL_SENT', unsaved: { hasAny: true } }) === 'NONE');
  check('★★★★ 未正式發出 ⇒ NONE', gas.resolveSendKindForAll_(btnsOff, { stage: 'DRAFT', unsaved: { hasAny: false } }) === 'NONE');
  // 第八十二輪批次 IG 組（刻意改動）：〔給所有人〕一律係正式發出——只有審閱掣著唔會變成寄審閱本
  check('★★★★ 只有審閱掣著 ⇒ 唔會變成審閱本（NONE）；正式發出著 ⇒ OFFICIAL',
    gas.resolveSendKindForAll_({ review: { enabled: true } }, { stage: 'DRAFT', unsaved: {} }) === 'NONE'
    && gas.resolveSendKindForAll_({ official: { enabled: true } }, { stage: 'DRAFT', unsaved: {} }) === 'OFFICIAL');

  const context = { assignmentsByPerson: { P9701: [1], P9702: [1] }, lastHashByPerson: { P9701: 'h', P9702: 'h' }, notifyReasonByPerson: {} };
  const decision = gas.resolveSendOptions_('RESEND', { recipientScope: 'PICK', pickedKeys: ['P9701', 'P9702'], sendMode: 'ALL' }, null);
  const ids = gas.resolveResendTargetPersonIds_(context, decision, [], false);
  check('★★★★★★ 冇人改過都照寄；每一位都有理由（唔會被 SKIPPED_UNCHANGED 擋走）',
    ids.length === 2 && Object.keys(context.notifyReasonByPerson).length === 2
    && /所有人/.test(context.notifyReasonByPerson.P9701), JSON.stringify(context.notifyReasonByPerson));
  const flow = read('src/WebAppFlow.gs');
  check('★★★★★ 改動後重發四個入口都認 resendHasExplicitRecipients_（冇人改過都要行落去）',
    (flow.match(/resendHasExplicitRecipients_\(sendOptions\)/g) || []).length >= 4);
  check('★★★★★ 唔改 RESEND_ONLY_CHANGED 呢個全域設定（Mailer 照讀、種子照 TRUE、冇任何地方寫佢）',
    /getConfig_\(CONFIG_KEYS\.RESEND_ONLY_CHANGED, true\)/.test(read('src/Mailer.gs'))
    && /key: CONFIG_KEYS\.RESEND_ONLY_CHANGED, type: CONFIG_TYPES\.BOOL, group: 'MAIL',\n\s+defaultValue: 'TRUE'/.test(read('src/ConfigSeed.gs'))
    && !/setConfig[^\n]*RESEND_ONLY_CHANGED/.test(read('src/WebAppSendPlan.gs') + read('src/ResendFlow.gs') + read('src/WebAppFlow.gs')));
}

console.log('\n=== EE6–EE11：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  const realOpenResend = ui.openResend;   // EE12 要用真嘅（下面會換成記錄用嘅 stub）
  vm.runInContext('__routed = null; openReview = function (o) { __routed = { kind: "REVIEW", o }; }; openOfficial = function (o) { __routed = { kind: "OFFICIAL", o }; }; openResend = function (o) { __routed = { kind: "RESEND", o }; };', ui);
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

  // EE12：〔給所有人〕喺正式發出之後 ⇒ 改動後重發確認窗寫明「全部 N 位都會收到」（用真嘅 openResend）
  {
    vm.runInContext('getDashboard = async function () { return { isDryRun: true, buttons: {} }; };', ui);
    const realCall = ui.callServer;
    ui.callServer = async (name) => (name === 'apiStep5Plan' ? {
      mode: 'HAS_CHANGES', sendMode: 'ALL', recipientCount: 5, versionNo: 3, changed: [], changedPersonCount: 0,
      confirmGroups: { willSend: [], changedNotSent: [], notReceivedNotSentCount: 0, notReceivedNotSentNames: [] },
      contents: null, sendWarnings: null, isDryRun: true
    } : realCall(name));
    await realOpenResend({ sendMode: 'ALL', pickedKeys: ['P9701'], recipientScope: 'PICK' });
    await tick();
    const t = ui.document.getElementById('modalBody').textContent;
    check('★★★★★★ 正式發出之後〔給所有人〕⇒ 確認窗寫明「全部 5 位都會收到，包括安排沒有改動的人。」', /全部 5 位都會收到，包括安排沒有改動的人。/.test(t), t.slice(0, 300));
    ui.callServer = realCall;
  }
  const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];
  const body = () => ui.document.getElementById('modalBody');
  const acts = () => ui.document.getElementById('modalActions');
  const title = () => ui.document.getElementById('modalTitle').textContent;
  const actTexts = () => acts().flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  const routed = () => vm.runInContext('__routed', ui);

  const baseSummary = (over) => Object.assign({
    kind: 'OFFICIAL', allKind: 'OFFICIAL', officialSentOnce: false, blockedByUnsavedOnly: false, canSendUnsaved: true, canSendUnsavedReason: '',
    unsaved: { hasAny: false }, latestVersion: { versionNo: 2, createdAt: '2099-01-01 09:00' },
    unsavedSendPreview: { versionNo: 2, savedAt: '2099-01-01 09:00', total: 0, shown: [], moreCount: 0, all: [] },
    sendOptionDefaults: { attachType: 'NONE', includeIcs: false }, attachOptionNotes: {}, sendHistory: { batches: [] },
    permanentLink: { hasLink: true }, isDryRun: true, blockedReasons: [], alsoReview: false, reviewSentHint: ''
  }, over || {});
  const pool = {
    ok: true, items: [
      { key: 'P9701', personId: 'P9701', type: 'PERSON', displayName: '假甲', hasEmail: true, selectable: true, cellCount: 2, roles: ['COMMITTEE'], sources: ['ROSTER', 'COMMITTEE'] },
      { key: 'P9702', personId: 'P9702', type: 'PERSON', displayName: '假乙', hasEmail: true, selectable: true, cellCount: 1, roles: [], sources: ['ROSTER', 'CHANGED'], changeNotes: ['1 月 4 日　主席（新增）'] },
      { key: 'P9707', personId: 'P9707', type: 'PERSON', displayName: '假庚', hasEmail: false, selectable: false, cellCount: 1, roles: [], sources: ['ROSTER'] },
      { key: 'LIST:office@example.invalid', personId: '', type: 'LIST', displayName: '辦公室', hasEmail: true, selectable: true, cellCount: 0, roles: [], sources: ['FIXED'] }
    ],
    groups: [{ key: 'ROSTER', label: '職事表上全部人', total: 3, selectable: 2, members: [] }, { key: 'COMMITTEE', label: '堂委', total: 1, selectable: 1, members: [] },
      { key: 'DEACON', label: '執事', total: 0, selectable: 0, members: [] }, { key: 'IT', label: 'IT', total: 0, selectable: 0, members: [] }, { key: 'CLERK', label: '幹事', total: 0, selectable: 0, members: [] },
      { key: 'FIXED', label: '辦公室等固定收件人', total: 1, selectable: 1, members: [] }, { key: 'CHANGED', label: '只寄給安排有改動的人', total: 1, selectable: 1, members: [] }],
    defaultPickedKeys: ['P9702'], changed: { hasBaseline: true, sentence: '同 第 1 版比較，有 1 位的安排改過。' }
  };
  let summary = baseSummary();
  let allReply = { ok: true, pickedKeys: ['P9701', 'P9702', 'LIST:office@example.invalid'], items: pool.items, groups: pool.groups, includesFixed: true, noEmailCount: 1, noEmailNames: ['假庚'] };
  let changedReply = { ok: true, noChanges: false, people: [{ personId: 'P9702', nameTC: '假乙', hasEmail: true, hasAssignments: true, previousSummary: '04/01 讀經', currentSummary: '04/01 主席', changeNotes: ['1 月 4 日　主席（新增）'] }],
    pickedKeys: ['P9702'], noEmailNames: [], notReceivedCount: 2, baseline: { versionNo: 1, sentAt: '2099-01-02 10:00', stageLabel: '正式發出' } };
  ui.callServer = async (name) => {
    if (name === 'apiGetSendPlanSummary') return JSON.parse(JSON.stringify(summary));
    if (name === 'apiGetSendRecipientPool') return JSON.parse(JSON.stringify(pool));
    if (name === 'apiGetSendAllRecipients') return JSON.parse(JSON.stringify(allReply));
    if (name === 'apiGetSendChangedRecipients') return JSON.parse(JSON.stringify(changedReply));
    return {};
  };

  // EE6
  {
    const card = ui.renderStepSend({ latestVersion: { versionNo: 2 }, officialSentOnce: false, buttons: {} });
    const texts = card.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
    // 第八十二輪批次 IG 組（刻意改動）：加〔寄給堂委／執事〕排第一；〔變動的人〕原因改為「要先用〔給所有人〕正式發出一次」
    check('★★★★★★ 第 3 步四粒掣：寄給堂委／執事／給所有人／變動的人／選擇其他',
      JSON.stringify(texts) === JSON.stringify(['寄給堂委／執事', '給所有人', '變動的人', '選擇其他']), JSON.stringify(texts));
    const changedBtn = btnIn(card, '變動的人');
    check('★★★★★★ 未正式發出 ⇒〔變動的人〕變灰、原因「要先用〔給所有人〕正式發出一次」', changedBtn.disabled === true && /要先用〔給所有人〕正式發出一次/.test(changedBtn.title), changedBtn.title);
    // 第八十五輪批次 LA 組（刻意改動）：〔給所有人〕和其餘寄出按鈕同一個樣式（secondary），不再是藍色主按鈕。
    check('★★★★ 〔給所有人〕可以按，和其餘寄出按鈕同一個樣式', !btnIn(card, '給所有人').disabled && /secondary/.test(btnIn(card, '給所有人').className));
    check('★★★★ 卡片說明：「系統只會寄已經儲存的版本。」', /系統只會寄已經儲存的版本。/.test(card.textContent));
    const card2 = ui.renderStepSend({ latestVersion: { versionNo: 2 }, officialSentOnce: true, buttons: {} });
    check('★★★★★ 正式發出之後〔變動的人〕可以撳', btnIn(card2, '變動的人').disabled === false);
  }

  // EE7：未儲存窗
  {
    summary = baseSummary({ blockedByUnsavedOnly: true, unsaved: { hasAny: true, gridChangeCount: 1 },
      unsavedSendPreview: { versionNo: 2, savedAt: '2099-01-01 09:00', total: 1, shown: [], moreCount: 0, all: [] } });
    await ui.openSendDialog('ALL');
    await tick();
    check('★★★★★★ 標題「寄出：你有 1 格改動還未儲存」', title() === '寄出：你有 1 格改動還未儲存', title());
    check('★★★★★★ 內文叫佢先〔取消〕再撳第 2 步〔儲存〕', /請先按〔取消〕，再按第 2 步〔儲存〕，然後才寄出/.test(body().textContent) && /或者寄出上一個儲存的版本（第 2 版）：這 1 格不會在裏面，會留在表上/.test(body().textContent), body().textContent);
    check('★★★★★★ 按鈕只有〔寄出上一個版本（第 2 版）〕〔取消〕', JSON.stringify(actTexts()) === JSON.stringify(['寄出上一個版本（第 2 版）', '取消']), JSON.stringify(actTexts()));
    btnIn(acts(), '寄出上一個版本（第 2 版）').fire('click');
    await tick();
    check('★★★★★★ 撳落去直接開寄出窗（冇「我明白」中間畫面），頂部黃框寫明會寄第 2 版、1 格唔會寄出',
      // 第八十二輪批次 IG 組：寄出窗標題寫明種類（「寄出：正式發出給全體」等）
      /^寄出(：.+)?$/.test(title()) && /會寄出第 2 版（2099-01-01 09:00 儲存）；表上未儲存的 1 格不會寄出，會留在表上/.test(body().textContent), title() + ' ' + body().textContent.slice(0, 300));
    check('★★★★★ allowUnsaved 係布林 true', vm.runInContext('sendOptions_.allowUnsaved === true', ui));
    // 後端唔准
    summary = baseSummary({ blockedByUnsavedOnly: true, canSendUnsaved: false, canSendUnsavedReason: '這一季還未寄過，不可以用舊版本。', unsaved: { hasAny: true, gridChangeCount: 2 } });
    await ui.openSendDialog('PICK');
    await tick();
    check('★★★★★ 後端唔准 ⇒ 只有〔取消〕，照舊寫原因', JSON.stringify(actTexts()) === '["取消"]' && /這一季還未寄過，不可以用舊版本/.test(body().textContent), JSON.stringify(actTexts()));
  }

  // EE8：給所有人
  {
    summary = baseSummary();
    vm.runInContext('__routed = null;', ui);
    await ui.openSendDialog('ALL');
    await tick();
    check('★★★★★★ 主窗冇〔選擇收件人〕', !btnIn(body(), '選擇收件人') && !btnIn(body(), '改一改寄給誰'));
    check('★★★★★★ 主窗冇「另外自行輸入電郵」', body().textContent.indexOf('另外自行輸入電郵') === -1);
    check('★★★★★ 摘要句每人只算一次（3 位）；另外 1 位冇電郵要印紙本', /這一次會寄給 3 位/.test(body().textContent) && /另外 1 位沒有電郵，收不到——要用第 4 步印紙本：假庚/.test(body().textContent), body().textContent.slice(0, 400));
    btnIn(acts(), '寄出').fire('click');
    await tick();
    const r = routed();
    check('★★★★★★ 確認 ⇒ 行原本嗰條路（正式發出），sendMode=ALL、pickedKeys 由後端嚟', r && r.kind === 'OFFICIAL' && r.o.sendMode === 'ALL' && JSON.stringify(r.o.pickedKeys) === JSON.stringify(allReply.pickedKeys), JSON.stringify(r));
    // 正式發出之後：kind NONE、allKind RESEND
    summary = baseSummary({ kind: 'NONE', allKind: 'RESEND', officialSentOnce: true, blockedReasons: [{ key: 'resend', reason: '沒有人的安排改過，不需要重發。' }] });
    vm.runInContext('__routed = null;', ui);
    await ui.openSendDialog('ALL');
    await tick();
    btnIn(acts(), '寄出').fire('click');
    await tick();
    check('★★★★★★ 正式發出之後、冇人改過 ⇒〔給所有人〕照樣行改動後重發嗰條路', routed() && routed().kind === 'RESEND' && routed().o.sendMode === 'ALL', JSON.stringify(routed()));
  }

  // EE9：變動的人
  {
    summary = baseSummary({ kind: 'RESEND', allKind: 'RESEND', officialSentOnce: true });
    vm.runInContext('__routed = null;', ui);
    await ui.openSendDialog('CHANGED');
    await tick();
    const t = body().textContent;
    check('★★★★★★ 逐個列出會收到嘅人同改動', /假乙/.test(t) && /1 月 4 日　主席（新增）/.test(t), t.slice(0, 400));
    check('★★★★★ 冇〔選擇收件人〕、冇自行輸入電郵；另外 2 位上一次沒有收到', !btnIn(body(), '選擇收件人') && t.indexOf('另外自行輸入電郵') === -1 && /另外 2 位上一次沒有收到/.test(t), t.slice(0, 400));
    btnIn(acts(), '寄出').fire('click');
    await tick();
    check('★★★★★ 確認 ⇒ 改動後重發，sendMode=CHANGED、pickedKeys=有改動嘅人', routed() && routed().kind === 'RESEND' && routed().o.sendMode === 'CHANGED' && JSON.stringify(routed().o.pickedKeys) === '["P9702"]', JSON.stringify(routed()));
    changedReply = Object.assign({}, changedReply, { noChanges: true, people: [], pickedKeys: [] });
    await ui.openSendDialog('CHANGED');
    await tick();
    check('★★★★★ 冇人改過 ⇒「和上一次寄出的版本比較，沒有人的安排改過。」只有〔知道了〕', /和上一次寄出的版本比較，沒有人的安排改過/.test(body().textContent) && JSON.stringify(actTexts()) === '["知道了"]', body().textContent);
    changedReply = Object.assign({}, changedReply, { ok: false, notOfficialYet: true, message: '這一季還未正式發出給全體，請用〔給所有人〕或〔選擇其他〕。' });
    await ui.openSendDialog('CHANGED');
    await tick();
    check('★★★★ 未正式發出 ⇒ 顯示後端嗰句', /這一季還未正式發出給全體/.test(body().textContent));
  }

  // EE10：選擇其他
  {
    summary = baseSummary({ kind: 'REVIEW', allKind: 'REVIEW' });
    vm.runInContext('__routed = null;', ui);
    await ui.openSendDialog('PICK');
    await tick();
    check('★★★★★★ 自動打開〔選擇收件人〕視窗', title() === '選擇收件人', title());
    check('★★★★★★ 底部按鈕叫〔確認〕，冇〔用這一份名單〕', !!btnIn(acts(), '確認') && !btnIn(acts(), '用這一份名單'), JSON.stringify(actTexts()));
    check('★★★★★ 預設勾選＝有改動嗰組（P9702）', JSON.stringify(vm.runInContext('sendOptions_.pickedKeys', ui)) === '["P9702"]', JSON.stringify(vm.runInContext('sendOptions_.pickedKeys', ui)));
    check('★★★★★ 「另外自行輸入電郵」喺呢個視窗入面', body().textContent.indexOf('另外自行輸入電郵') !== -1);
    // 只填自訂地址、一位都唔勾
    vm.runInContext("sendOptions_.pickedKeys = []; sendOptions_.extraEmailsRaw = 'roster-test@example.invalid';", ui);
    // 重畫一次令 selected 同 pickedKeys 一致（視窗入面取消勾選）
    vm.runInContext('drawSendRecipients(__lastSummary = ' + JSON.stringify(summary) + ', "")', ui);
    await tick();
    btnIn(acts(), '確認').fire('click');
    await tick();
    // 第八十四輪批次 KD 組：字眼改「N 個電郵地址」
    check('★★★★★★ 只填自訂地址 ⇒ 回到主窗，寄給誰寫「1 個電郵地址」', /^寄出(：.+)?$/.test(title()) && /會寄給 1 位：1 個電郵地址/.test(body().textContent), title() + ' ' + body().textContent.slice(0, 300));
    check('★★★★★ 主窗冇「另外自行輸入電郵」一段（只留喺收件人視窗）', body().textContent.indexOf('另外自行輸入電郵') === -1);
    btnIn(acts(), '寄出').fire('click');
    await tick();
    check('★★★★★★ 〔寄出〕⇒ 行原本嗰條路（唔再出「一位都沒有選」）', routed() && routed().kind === 'REVIEW' && JSON.stringify(routed().o.extraEmails) === '["roster-test@example.invalid"]' && routed().o.pickedKeys.length === 0, JSON.stringify(routed()));
  }

  // EE11：源碼
  {
    const uiDir = path.join(ROOT, 'src', 'ui');
    const hits = [];
    fs.readdirSync(uiDir).forEach((f) => {
      const t = fs.readFileSync(path.join(uiDir, f), 'utf8');
      const code = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      ['thenSend', '立即儲存並繼續', '寄出但不儲存', 'renderSendWithoutSavingConfirm', 'saveThenSend_', "'用這一份名單'"].forEach((w) => { if (code.indexOf(w) !== -1) hits.push(f + ':' + w); });
    });
    check('★★★★★ 前端冇殘留 thenSend／立即儲存並繼續／寄出但不儲存／用這一份名單', hits.length === 0, JSON.stringify(hits));
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
