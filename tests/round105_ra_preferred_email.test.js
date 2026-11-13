// 第一百零五輪批次 RA 組：指定寄信電郵（NameMapping.PreferredEmail）優先用來寄信。
// 執行方式：node tests/round105_ra_preferred_email.test.js
//
// Ivan 決定：堂委、執事的教會電郵既用來登入幹事介面，亦用來寄信（取代出席系統的電郵）。
//
//   RA1 實際電郵次序：PreferredEmail ＞ 出席系統 Email ＞ ManualEmail
//   RA2 出席系統同步永遠不讀不寫 PreferredEmail
//   RA3〔補填電郵〕：kind=PREFERRED 寫 PreferredEmail（第一次自動補欄）；AuditLog PREFERRED_EMAIL_SET、電郵遮蔽；清空＝清除
//   RA4 畫面資料：preferred 一組、可選的人；「已補填」的人用了指定電郵 ⇒ 寫明現時用指定的
//   RA5 收件人標記：季前資料／申報連結的收件人、〔選擇收件人〕名單有「指定寄信電郵」
//   RA6 介面：〔補填電郵〕窗有「指定寄信電郵（優先）」一組，可以修改、清除、加一位
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildUnavailableScene } = require('./helpers/unavailable_scene.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function scene() {
  const sc = buildUnavailableScene({ extraFiles: ['ManualEmail.gs', 'SendAudience.gs', 'RolloutAudience.gs'] });
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = function () {};
  sc.nmSheet = () => sc.ss.getSheetByName(sc.S.NAME_MAPPING);
  sc.nmKeys = () => { const s = sc.nmSheet(); return s.getRange(2, 1, 1, s.getLastColumn()).getValues()[0]; };
  sc.cell = (personId, key) => {
    const s = sc.nmSheet(); const keys = sc.nmKeys(); const c = keys.indexOf(key) + 1;
    if (c === 0) return undefined;
    for (let r = 3; r <= s.getLastRow(); r++) if (String(s.getRange(r, 1).getValue()) === personId) return s.getRange(r, c).getValue();
    return undefined;
  };
  return sc;
}

console.log('\n=== RA1：實際電郵次序 ===');
{
  const g = scene().gas;
  const M = g.COLUMNS.NAME_MAPPING;
  const row = (p, e, m) => ({ [M.PREFERRED_EMAIL]: p, [M.EMAIL]: e, [M.MANUAL_EMAIL]: m });
  check('★★★★★★ 有指定寄信電郵 ⇒ 用它（就算出席系統、補填都有）',
    g.effectivePersonEmail_(row(' pref@example.invalid ', 'a@example.invalid', 'b@example.invalid')) === 'pref@example.invalid');
  check('★★★★★ 指定空白 ⇒ 出席系統', g.effectivePersonEmail_(row('', 'a@example.invalid', 'b@example.invalid')) === 'a@example.invalid');
  check('★★★★★ 指定、出席系統都空 ⇒ 補填', g.effectivePersonEmail_(row('', '', 'b@example.invalid')) === 'b@example.invalid');
  check('★★★★ 沒有 PreferredEmail 欄 ⇒ 照舊', g.effectivePersonEmail_({ [M.EMAIL]: 'a@example.invalid' }) === 'a@example.invalid');
  check('★★★★ 欄名 PreferredEmail', M.PREFERRED_EMAIL === 'PreferredEmail');
  check('★★★★ usesPreferredEmail_', g.usesPreferredEmail_(row('p@example.invalid', '', '')) === true && g.usesPreferredEmail_(row('', 'a@example.invalid', '')) === false);
}

console.log('\n=== RA2：出席系統同步不碰 PreferredEmail ===');
{
  ['src/HwcasSync.gs', 'src/HwcasApply.gs', 'src/WebAppHwcas.gs'].forEach((f) => {
    check('★★★★★★ ' + f + ' 沒有讀寫 PreferredEmail', !/PREFERRED_EMAIL|PreferredEmail/.test(read(f)));
  });
}

console.log('\n=== RA3：〔補填電郵〕設定指定寄信電郵 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('（前置）還沒有 PreferredEmail 欄', sc.nmKeys().indexOf('PreferredEmail') === -1);
  const emailBefore = sc.cell('P9701', 'Email');
  const r = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9701', email: 'p9701-church@example.invalid', kind: 'PREFERRED' }]);
  check('★★★★★★ 第一次設定自動補 PreferredEmail 欄並寫入', r.ok && r.saved === 1 && sc.cell('P9701', 'PreferredEmail') === 'p9701-church@example.invalid', JSON.stringify(r).slice(0, 300));
  check('★★★★★★ Email、ManualEmail 沒有被改', sc.cell('P9701', 'Email') === emailBefore && !sc.cell('P9701', 'ManualEmail'));
  check('★★★★★★ 之後寄信用指定的', g.indexPeopleById_().P9701.email === 'p9701-church@example.invalid' && g.indexPeopleById_().P9701.emailPreferred === true);
  const audits = sc.audits('PREFERRED_EMAIL_SET');
  const A = sc.C.AUDIT_LOG;
  check('★★★★★★ AuditLog PREFERRED_EMAIL_SET，電郵遮蔽', audits.length === 1
    && JSON.stringify(audits).indexOf('p9701-church@example.invalid') === -1 && /PreferredEmail=/.test(audits[0][A.NEW_VALUE]), JSON.stringify(audits));
  check('★★★★ 沒有寫 MANUAL_EMAIL_SET', sc.audits('MANUAL_EMAIL_SET').length === 0);
  const c = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9701', email: '', kind: 'PREFERRED' }]);
  check('★★★★★★ 清空＝清除，回復用出席系統的', c.ok && c.cleared === 1 && !sc.cell('P9701', 'PreferredEmail')
    && g.indexPeopleById_().P9701.email === emailBefore, JSON.stringify(c).slice(0, 200));
  const bad = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9701', email: 'not an email', kind: 'PREFERRED' }]);
  check('★★★★★ 格式不對 ⇒ 不寫入', bad.ok === false && !sc.cell('P9701', 'PreferredEmail'));
}

console.log('\n=== RA4：畫面資料 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-church@example.invalid', kind: 'PREFERRED' }]);
  const v = g.apiGetManualEmailView(sc.Q);
  check('★★★★★★ preferred 一組列出', (v.preferred || []).some((p) => p.personId === 'P9707' && p.preferredEmail === 'p9707-church@example.invalid'), JSON.stringify(v.preferred));
  check('★★★★★ 有說明句', /指定寄信電郵（優先）/.test(v.preferredExplanation || ''));
  check('★★★★★ 可選的人（這一季可能用到的人＋已設定的人）', (v.people || []).length >= 1 && v.people.some((p) => p.personId === 'P9707'), JSON.stringify(v.people));
  const f = v.filled.filter((p) => p.personId === 'P9707')[0];
  check('★★★★★★ 已補填的人用了指定電郵 ⇒「已設定指定寄信電郵，現時用指定的」', f && f.superseded && f.note === '已設定指定寄信電郵，現時用指定的', JSON.stringify(f));
}

console.log('\n=== RA5：收件人標記 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9701', email: 'p9701-church@example.invalid', kind: 'PREFERRED' }]);
  const people = g.readAudiencePeople_();
  check('★★★★★★ 收件人資料帶 preferred', people.P9701 && people.P9701.preferred === true && people.P9701.email === 'p9701-church@example.invalid'
    && people.P9702 && people.P9702.preferred === false, JSON.stringify([people.P9701, people.P9702]));
  check('★★★★★ resolveAudienceSelection_ 的收件人帶 preferred', /seenEmail\[k\] = \{ personId: id, displayName: p\.name, email: p\.email, why: why, preferred: !!p\.preferred \};/.test(read('src/SendAudience.gs')));
  check('★★★★★ 申報連結收件人名字加標記', (read('src/UnavailableInvite.gs').match(/r\.displayName \+ \(r\.preferred \? PREFERRED_EMAIL_MARK : ''\)/g) || []).length === 2
    && g.PREFERRED_EMAIL_MARK === '（指定寄信電郵）');
  check('★★★★★ 季前資料收件人清單加標記', /r\.why \+ \(r\.preferred \? '；指定寄信電郵' : ''\)/.test(read('src/ui/ScriptZone5.html')));
  check('★★★★★ 〔選擇收件人〕名單加標記', /\(c\.emailPreferred \? '　指定寄信電郵' : ''\)/.test(read('src/ui/ScriptSendPaper.html'))
    && (read('src/SendRecipients.gs').match(/emailPreferred: !!/g) || []).length === 2);
}

console.log('\n=== RA6：介面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone2.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  const calls = [];
  ui.callServerMutating = async (fn, q, entries) => { calls.push({ fn, entries }); return { ok: true, message: 'ok', view: null }; };
  vm.runInContext(`manualEmailData_ = ${JSON.stringify({
    quarterLabel: 'Q', explanation: 'x', missing: [], filled: [],
    preferredExplanation: '指定寄信電郵（優先）：……',
    preferred: [{ personId: 'P1', nameTC: '甲', preferredEmail: 'p1@example.invalid', posts: '' }],
    people: [{ personId: 'P1', nameTC: '甲' }, { personId: 'P2', nameTC: '乙' }]
  })}; renderManualEmails_();`, ui);
  const body = ui.document.getElementById('modalBody');
  check('★★★★★★ 有「指定寄信電郵（優先）：1 位」一組', /指定寄信電郵（優先）：1 位/.test(body.textContent));
  const inputs = body.flatten().filter((n) => n.tagName === 'INPUT');
  const selects = body.flatten().filter((n) => n.tagName === 'SELECT');
  check('（前置）一個已設定的輸入框＋加一位的輸入框', inputs.length === 2 && selects.length === 1);
  check('★★★★★ 加一位的選單不列已設定的人', selects[0].children.map((o) => o.value).join(',') === ',P2', selects[0].children.map((o) => o.value).join(','));
  inputs[0].value = '';                       // 清除 P1
  selects[0].value = 'P2';
  inputs[1].value = 'p2@example.invalid';    // 加 P2
  const edits = vm.runInContext('collectManualEmailEdits_()', ui);
  check('★★★★★★ 清除＝送空白（kind PREFERRED）；加一位＝送 kind PREFERRED',
    edits.length === 2 && edits.some((e) => e.personId === 'P1' && e.email === '' && e.kind === 'PREFERRED')
    && edits.some((e) => e.personId === 'P2' && e.email === 'p2@example.invalid' && e.kind === 'PREFERRED'), JSON.stringify(edits));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
