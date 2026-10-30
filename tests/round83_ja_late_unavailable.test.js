// 第八十三輪批次 JA 組：「之後才申報不能服侍」唔可以當成「已放行」。
// 執行方式：node tests/round83_ja_late_unavailable.test.js
//
// 現場（第八十二輪 Q2）：生成第 0 版之後喺〔不能服侍的日期〕加咗一筆，撞到已排嘅格。
// 狀態卡即刻寫「這一季有 1 格是你放行的違反規則安排……（已放行）」；「調整之前」同一格
// 寫「已放行——系統不會改動這一格」、冇勾選框——但從來冇人放行過。後果：儲存唔出確認窗、
// 直接把不能服侍嘅人存入新一版；寄出亦唔提醒。原因：三處把 `LATE_UNAVAILABLE` 併入「已放行」。
//
//   JA1　狀態卡／寄出警告：唔係已放行；`unreleased` 有佢、理由「之後才申報不能服侍」；`lateUnavailable` 一格
//   JA2　逐格決定項目：未決定、有勾選框（released=false）、有標籤同說明句
//   JA3　儲存一格無關嘅改動 ⇒ 出確認窗、要求決定，理由「有 1 格的人之後才申報不能服侍」
//   JA4　勾保留 ⇒ 可以儲存、AuditLog 有放行、之後分類為 RELEASED（狀態卡變已放行）
//   JA5　唔勾而撳〔請系統幫我調整〕⇒ 嗰一格被換走
//   JA6　同一次儲存套用 Requests「不能服侍」⇒ 唔會重覆要求決定
//   JA7　字眼：`HARD_VIOLATION_CLASS_LABEL.LATE_UNAVAILABLE`＝「之後才申報不能服侍」；核對報告仍然獨立計數
//   JA8　前端：決定項目有標籤／說明／勾選框；狀態卡句子冇「放行」二字

const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const LATE_AT = '2099-06-01 09:00:00';   // 一定晚過任何版本嘅 CreatedAt

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  const gas = sc.gas;
  gas.readWeightsForQuarterTune_ = () => ({ rows: [] });
  const RS = sc.C.RULE_SETTINGS;
  sc.appendRows(sc.ss, sc.S.RULE_SETTINGS, [RS.RULE_ID, RS.LEVEL, RS.ENABLED, RS.SCOPE_POST_IDS, RS.ON_VIOLATION, RS.PRIORITY],
    [{ [RS.RULE_ID]: 'HARD_UNAVAILABLE', [RS.LEVEL]: 'HARD', [RS.ENABLED]: true, [RS.ON_VIOLATION]: 'BLOCK', [RS.PRIORITY]: 1 }]);
  gas.apiGenerateDraftExecute(sc.Q);
  sc.idOf = (name) => Object.keys(sc.PEOPLE).filter((id) => sc.PEOPLE[id] === name)[0];
  sc.addLateUnavailable = (personId, date) => {
    const U = sc.C.UNAVAILABLE;
    sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [{ [U.UNAVAILABLE_ID]: 'U' + date + personId,
      [U.PERSON_ID]: personId, [U.DATE_FROM]: date, [U.DATE_TO]: date, [U.SOURCE]: 'WEBUI', [U.STATUS]: 'ACTIVE',
      [U.APPLIES_TO]: 'ALL', [U.CREATED_AT]: LATE_AT }]);
  };
  sc.freeOn = (v, date) => {
    const busy = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((k) => sc.getCell(v, date, k));
    return ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
  };
  return sc;
}
const D = ['2099-01-04', '2099-01-11', '2099-01-18', '2099-01-25'];
const save = (gas, sc) => gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
const lateRule = (items) => (items || []).filter((r) => r.ruleId === 'HARD_UNAVAILABLE')[0];

console.log('\n=== JA1／JA2／JA3／JA4：一個完整情境 ===');
{
  const sc = scene();
  const gas = sc.gas;
  const readP = sc.idOf(sc.getCell(0, D[1], 'READ#1'));
  sc.addLateUnavailable(readP, D[1]);

  // JA1
  const w = gas.summariseVersionSendWarnings_(sc.Q, 0);
  check('（前置）寄出警告算得到', !w.error, w.error);
  check('★★★★★★ JA1 唔係「已放行」（released 0）', w.released.count === 0, JSON.stringify(w.released));
  check('★★★★★★ JA1 寄出警告 unreleased 有佢，理由「之後才申報不能服侍」',
    w.unreleased.items.some((u) => u.serviceDate === D[1] && u.ruleId === 'HARD_UNAVAILABLE' && u.reason === '之後才申報不能服侍'),
    JSON.stringify(w.unreleased));
  check('★★★★★★ JA1 狀態卡清單 lateUnavailable 一格', w.lateUnavailable.count === 1
    && w.lateUnavailable.items[0].personName === sc.nameOf(readP), JSON.stringify(w.lateUnavailable));
  check('★★★★★ JA1 listUnreleasedHardViolations_（寄出時寫紀錄嗰支）包括佢',
    gas.listUnreleasedHardViolations_(sc.Q, 0, gas.findStateViolations_(
      gas.versionStateFromOriginal_(gas.buildFineTuneContext_(sc.Q, 0, { skipGrid: true })),
      gas.buildFineTuneContext_(sc.Q, 0, { skipGrid: true }))).some((v) => v.ruleId === 'HARD_UNAVAILABLE'));

  // JA3：改一格無關嘅
  sc.setCell(0, D[3], 'WORSHIP#1', sc.nameOf(['P9701', 'P9702', 'P9703'].filter((p) =>
    sc.nameOf(p) !== sc.getCell(0, D[3], 'WORSHIP#1') && ['CHAIR#1', 'READ#1'].every((k) => sc.getCell(0, D[3], k) !== sc.nameOf(p))
    && sc.getCell(0, D[2], 'WORSHIP#1') !== sc.nameOf(p))[0]));
  // JA2
  const chk = gas.apiCheckMyChanges(sc.Q);
  const item = lateRule(chk.violations);
    check('（前置）〔檢查我的改動〕找到那一格', !!item, JSON.stringify(chk.violations).slice(0, 300));
  check('★★★★★★ JA2 唔係已放行（released=false）', item && item.released === false, JSON.stringify(item));
  check('★★★★★★ JA2 未決定（checked=false）、一定要遵守', item && item.checked === false && item.mustFollow === true);
  check('★★★★★ JA2 標籤「之後才申報不能服侍」', item && item.lateUnavailable === true && item.lateLabel === '之後才申報不能服侍');
  check('★★★★★ JA2 說明句', item && item.lateNote === '這個人在這一版儲存之後才申報 1月11日 不能服侍。不勾的話，〔請系統幫我調整〕會換人。',
    item && item.lateNote);

  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ JA3 要求決定（needsDecision）', plan.needsDecision === true, JSON.stringify(plan.decisionItems));
  check('★★★★★★ JA3 決定項目有那一格', !!lateRule(plan.decisionItems.rules), JSON.stringify(plan.decisionItems.rules));
  const reason = (plan.confirmReasons || []).filter((r) => r.code === 'LATE_UNAVAILABLE_UNDECIDED')[0];
  check('★★★★★★ JA3 確認窗理由「有 1 格的人之後才申報不能服侍，你還沒有決定」',
    reason && reason.text === '有 1 格的人之後才申報不能服侍，你還沒有決定', JSON.stringify(plan.confirmReasons));
  check('★★★★★ JA3 冇被當成「已放行」', plan.violations.released.length === 0, JSON.stringify(plan.violations.released));
  check('★★★★★ JA3 RULE_UNDECIDED 冇重覆計呢一格', !(plan.confirmReasons || []).some((r) => r.code === 'RULE_UNDECIDED'),
    JSON.stringify(plan.confirmReasons));
  let blockedErr = '';
  try { save(gas, sc); } catch (e) { blockedErr = e.message; }
  check('★★★★★★ JA3 未決定 ⇒ 後端唔准儲存', /還有 1 格違反了一定要遵守的規則/.test(blockedErr), blockedErr);

  // JA4：勾保留
  gas.apiSetCellDecisions(sc.Q, [{ serviceDate: D[1], postId: 'READ', slotIndex: 1, kind: 'KEEP',
    cellText: sc.nameOf(readP), ruleId: 'HARD_UNAVAILABLE', checked: true }]);
  const plan2 = gas.apiSaveAndConfirmPlan(sc.Q);
  check('★★★★★★ JA4 勾咗 ⇒ 唔再要求決定', plan2.needsDecision === false, JSON.stringify(plan2.decisionItems));
  const r = save(gas, sc);
  check('（前置）第 1 版建立', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
  const audit = gas.readSheet_(sc.S.AUDIT_LOG);
  const AC = sc.C.AUDIT_LOG;
  check('★★★★★★ JA4 AuditLog 有放行紀錄（RELEASED_KEYS 有那一格）', audit.some((row) =>
    row[AC.ACTION] === gas.HARD_RELEASE_ACTION && String(row[AC.NOTES]).indexOf(D[1] + '|READ|1|' + readP + '|HARD_UNAVAILABLE') !== -1),
    JSON.stringify(audit.filter((row) => row[AC.ACTION] === gas.HARD_RELEASE_ACTION)).slice(0, 400));
  const w2 = gas.summariseVersionSendWarnings_(sc.Q, 1);
  check('★★★★★★ JA4 之後分類為 RELEASED（狀態卡變已放行、唔再係之後才申報）',
    w2.released.count === 1 && w2.lateUnavailable.count === 0 && w2.unreleased.count === 0, JSON.stringify(w2));
}

console.log('\n=== JA5：唔勾而撳〔請系統幫我調整〕⇒ 那一格被換走 ===');
{
  const sc = scene();
  const gas = sc.gas;
  const readP = sc.idOf(sc.getCell(0, D[2], 'READ#1'));
  sc.addLateUnavailable(readP, D[2]);
  const res = gas.apiBuildSuggestion(sc.Q, '', []);
  check('（前置）建議表 ok', res.ok === true, JSON.stringify(res).slice(0, 300));
  const sug = gas.readGridTextFromSheet_(gas.buildSuggestionSheetName_(sc.Q, 0), sc.TZ);
  check('★★★★★★ JA5 那一格被換走', sug[D[2] + '|READ|1'] && sug[D[2] + '|READ|1'] !== sc.nameOf(readP), sug[D[2] + '|READ|1']);
}

console.log('\n=== JA6：同一次儲存套用 Requests「不能服侍」⇒ 唔重覆要求決定 ===');
{
  const sc = scene();
  const gas = sc.gas;
  const reqSheet = sc.ss.getSheetByName(sc.S.REQUESTS);
  const keys = reqSheet.getRange(2, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(String);
  const readOn = sc.getCell(0, D[3], 'READ#1');
  sc.appendRows(sc.ss, sc.S.REQUESTS, keys, [{ QuarterID: sc.Q, ServiceDate: D[3], PostName: '讀經',
    PersonName: readOn, RequestType: '不能服侍', CreatedAt: LATE_AT }]);
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（前置）有一筆要套用', plan.requests && plan.requests.apply.length === 1, JSON.stringify(plan.requests).slice(0, 300));
  check('★★★★★★ JA6 唔會另外變成未決定嘅「之後才申報不能服侍」', !lateRule(plan.decisionItems.rules)
    && !(plan.confirmReasons || []).some((r) => r.code === 'LATE_UNAVAILABLE_UNDECIDED'),
    JSON.stringify(plan.decisionItems.rules) + JSON.stringify(plan.confirmReasons));
  const r = save(gas, sc);
  check('（前置）儲存成第 1 版', r && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
  const w = gas.summariseVersionSendWarnings_(sc.Q, 1);
  check('★★★★★ JA6 新一版冇「之後才申報不能服侍」（已經換人）', w.lateUnavailable.count === 0 && w.unreleased.count === 0,
    JSON.stringify(w));
}

console.log('\n=== JA7：字眼同核對報告 ===');
{
  const sc = scene();
  const gas = sc.gas;
  check('★★★★★★ JA7 HARD_VIOLATION_CLASS_LABEL.LATE_UNAVAILABLE＝「之後才申報不能服侍」',
    gas.HARD_VIOLATION_CLASS_LABEL.LATE_UNAVAILABLE === '之後才申報不能服侍');
  const ctx = { quarterId: sc.Q, releasedKeys: {}, legacyReleasedKeys: {},
    unavailableCreatedAtByPerson: { 'P9701|2099-01-04': 2000 }, versionCreatedAtMs: 1000 };
  const c = gas.classifyHardViolations_([{ serviceDate: '2099-01-04', postId: 'READ', slotIndex: 1, personId: 'P9701',
    ruleId: 'HARD_UNAVAILABLE' }], ctx);
  check('★★★★★ JA7 classifyHardViolations_ 仍然獨立分類（核對報告計數）', c.lateUnavailable.length === 1 && c.released.length === 0);
  check('★★★★ JA7 摘要句用新字眼', /之後才申報不能服侍 1/.test(c.summary), c.summary);
}

console.log('\n=== JA8：前端 ===');
{
  const ui = loadUiScripts(['Script.html']);
  const item = { kind: 'KEEP', key: '2099-01-11|READ|1', serviceDate: '2099-01-11', postId: 'READ', postNameTC: '讀經', slotIndex: 1,
    personName: '某某', cellText: '某某', ruleId: 'HARD_UNAVAILABLE', severity: 'HARD', mustFollow: true, reason: '該日已表明不能服侍',
    released: false, checked: false, lateUnavailable: true, lateLabel: '之後才申報不能服侍',
    lateNote: '這個人在這一版儲存之後才申報 1月11日 不能服侍。不勾的話，〔請系統幫我調整〕會換人。' };
  const sec = ui.buildDecisionSections({ names: [], rules: [item] }, {});
  const nodes = sec.nodes;
  const text = nodes.map((n) => n.textContent).join('\n');
  const flat = [].concat(...nodes.map((n) => n.flatten()));
  check('★★★★★★ JA8 決定項目有勾選框', flat.some((n) => n.tagName === 'INPUT' && n.type === 'checkbox'), text);
  check('★★★★★ JA8 有標籤「之後才申報不能服侍」同說明句', text.indexOf('之後才申報不能服侍') !== -1
    && text.indexOf('不勾的話，〔請系統幫我調整〕會換人') !== -1, text);
  check('★★★★★ JA8 冇「已放行」', text.indexOf('已放行') === -1, text);
  check('★★★★★ JA8 未勾 ⇒ allDecided＝false', sec.allDecided() === false);

  const w = { blank: { count: 0, items: [] }, released: { count: 0, items: [] },
    unreleased: { count: 1, items: [{ serviceDate: '2028-07-16', postNameTC: '讀經', slotIndex: 1, personName: '某某', reason: '之後才申報不能服侍', lateUnavailable: true }] },
    lateUnavailable: { count: 1, items: [{ serviceDate: '2028-07-16', postNameTC: '讀經', slotIndex: 1, personName: '某某' }], moreCount: 0 } };
  const card = ui.buildSendWarningNodes(w, { compact: true }).map((n) => n.textContent).join('\n');
  check('★★★★★★ JA8 狀態卡句子', card.indexOf('這一季有 1 格的人之後才申報不能服侍：') !== -1
    && card.indexOf('按第 2 步〔請系統幫我調整〕換人，或者在〔檢查我的改動〕勾「保留我的安排」。') !== -1, card);
  check('★★★★★★ JA8 狀態卡冇「放行」二字', card.indexOf('放行') === -1, card);
  const dlg = ui.buildSendWarningNodes(w, {}).map((n) => n.textContent).join('\n');
  check('★★★★★ JA8 寄出確認窗（非 compact）照樣提醒，理由「之後才申報不能服侍」', dlg.indexOf('之後才申報不能服侍') !== -1, dlg);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
