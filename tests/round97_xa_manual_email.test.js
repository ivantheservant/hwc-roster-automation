// 第九十七輪批次 XA 組：幹事補填電郵（NameMapping.ManualEmail，不寫回出席系統）。
// 執行方式：node tests/round97_xa_manual_email.test.js
//
//   XA1 實際電郵：Email 有值就用 Email，否則用 ManualEmail；兩欄都空 ⇒ 空
//   XA2 出席系統同步、連結、套用永遠不讀不寫 ManualEmail（靜態＋同步時寫入的欄）
//   XA3 各寄信入口用實際電郵：寄信 context（OFFICIAL／RESEND／補寄／提醒）、申報邀請、季前資料、申報結果通知、
//       「沒有電郵」名單（紙本包、寄出窗）、狀態卡人數；src/ 讀 NameMapping 電郵只可以經 effectivePersonEmail_()
//   XA4〔補填電郵〕畫面：只列這一季可能用到、沒有實際電郵的人；已補填另列；出席系統已有電郵 ⇒ 寫明現時用出席系統的
//   XA5 儲存：格式檢查；只寫 ManualEmail（第一次自動補欄）；AuditLog 電郵遮蔽；清空＝清除
//   XA6 權限：畫面讀取在兩份唯讀清單；儲存不是（只可查看的人不可以）
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, T1 } = require('./helpers/unavailable_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function scene() {
  const sc = buildUnavailableScene({ extraFiles: ['ManualEmail.gs'] });
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
  sc.setCell = (personId, key, v) => {
    const s = sc.nmSheet(); const keys = sc.nmKeys(); const c = keys.indexOf(key) + 1;
    for (let r = 3; r <= s.getLastRow(); r++) if (String(s.getRange(r, 1).getValue()) === personId) { s.getRange(r, c).setValue(v); return; }
  };
  return sc;
}

console.log('\n=== XA1：實際電郵 ===');
{
  const g = scene().gas;
  const M = g.COLUMNS.NAME_MAPPING;
  const row = (e, m) => ({ [M.EMAIL]: e, [M.MANUAL_EMAIL]: m });
  check('★★★★★★ Email 有值 ⇒ 用 Email（就算有 ManualEmail）', g.effectivePersonEmail_(row('a@example.invalid', 'b@example.invalid')) === 'a@example.invalid');
  check('★★★★★★ Email 空白 ⇒ 用 ManualEmail', g.effectivePersonEmail_(row('', ' b@example.invalid ')) === 'b@example.invalid');
  check('★★★★★ 兩欄都空（或沒有 ManualEmail 欄）⇒ 空字串', g.effectivePersonEmail_(row('', '')) === '' && g.effectivePersonEmail_({ [M.EMAIL]: '' }) === '' && g.effectivePersonEmail_(null) === '');
  check('★★★★ 欄名 ManualEmail', M.MANUAL_EMAIL === 'ManualEmail');
}

console.log('\n=== XA2：出席系統同步不碰 ManualEmail ===');
{
  ['src/HwcasSync.gs', 'src/HwcasApply.gs', 'src/WebAppHwcas.gs'].forEach((f) => {
    check('★★★★★★ ' + f + ' 沒有讀寫 ManualEmail', !/MANUAL_EMAIL|ManualEmail/.test(read(f)));
  });
  const sc = scene();
  const g = sc.gas;
  const writes = [];
  const realWrite = g.writeRowFields_;
  g.writeRowFields_ = function (sheet, headers, sheetRow, updates) { writes.push(Object.keys(updates)); return realWrite.apply(this, arguments); };
  g.readHwcasByMemberNo_ = () => ({ records: [], fieldColumns: {}, headers: [] });
  g.analyseHwcasLinks_ = () => ({
    linked: [{ personId: 'P9707', nameTC: 'x', sheetRow: 9, row: { [g.COLUMNS.NAME_MAPPING.EMAIL]: '' }, hwcas: { email: '', lastAttendance: '', meetingPoint: '' } }],
    unlinked: [], notFound: [], duplicates: [], noEmailInHwcas: []
  });
  g.syncPeopleFromHwcasByMemberNo_();
  check('★★★★★★ 同步寫入的欄沒有 ManualEmail', writes.every((k) => k.indexOf('ManualEmail') === -1), JSON.stringify(writes));
}

console.log('\n=== XA3：各寄信入口用實際電郵 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('（前置）P9707 沒有 Email', !sc.cell('P9707', 'Email'));
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  check('（前置）ManualEmail 欄已自動補上並寫入', sc.cell('P9707', 'ManualEmail') === 'p9707-manual@example.invalid');
  check('★★★★★★ 寄信 context（OFFICIAL／RESEND／補寄／提醒都用 indexPeopleById_）用補填的電郵', g.indexPeopleById_().P9707.email === 'p9707-manual@example.invalid');
  const inv = g.buildUnavailableInviteRecipients_(sc.today);
  check('★★★★★★ 申報邀請：補填了的人變成收件人，不再在「沒有電郵」', inv.recipients.some((r) => r.personId === 'P9707' && r.email === 'p9707-manual@example.invalid')
    && inv.noEmailPeople.every((p) => p.personId !== 'P9707'), JSON.stringify(inv.noEmail));
  const pre = g.buildPreseasonRecipients_(sc.today);
  check('★★★★ 季前資料收件人經同一個函式（靜態）', /email: effectivePersonEmail_\(row\)/.test(read('src/PreseasonPack.gs')) && Array.isArray(pre.recipients));
  g.apiGenerateDraftExecute(sc.Q);
  const split = g.splitVersionPeopleForNotice_(sc.Q, 0);
  check('★★★★★★ 「沒有電郵」名單（紙本包、寄出窗）不再有補填了的人', split.noEmail.every((p) => p.personId !== 'P9707'), JSON.stringify(split.noEmail));
  const gapsBefore = g.countPeopleEmailGaps_().noEmail;
  sc.setCell('P9707', 'ManualEmail', '');
  check('★★★★★ 狀態卡「收不到電郵」人數用實際電郵（清除補填後多一位）', g.countPeopleEmailGaps_().noEmail === gapsBefore + 1);
  check('★★★★ 申報結果通知用實際電郵（靜態）', /emailById\[id\] = effectivePersonEmail_\(row\)/.test(read('src/PersonalUnavailable.gs')));

  // 靜態：src/ 讀 NameMapping 電郵只可以經 effectivePersonEmail_()（出席系統同步／連結、人員資料編輯〔寫 Email 欄本身〕除外）
  const ALLOW_FILES = { 'HwcasSync.gs': '出席系統同步', 'HwcasApply.gs': '出席系統套用', 'WebAppHwcas.gs': '出席系統連結',
    'WebAppPeople.gs': '人員資料編輯（寫 Email 欄本身；畫面顯示用 effectivePersonEmail_）' };
  const offenders = [];
  fs.readdirSync(SRC).filter((f) => /\.gs$/.test(f) && !ALLOW_FILES[f]).forEach((f) => {
    const text = read('src/' + f);
    const re = /^function (\w+)\(/gm;
    const starts = [];
    let m;
    while ((m = re.exec(text))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      const body = text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length);
      if (s.name === 'effectivePersonEmail_') return;
      const aliases = [];
      const ar = /const (\w+) = COLUMNS\.NAME_MAPPING;/g;
      let a;
      while ((a = ar.exec(body))) aliases.push(a[1]);
      const direct = /COLUMNS\.NAME_MAPPING\.EMAIL\b(?!_)/.test(body);
      const viaAlias = aliases.some((al) => new RegExp('\\b' + al + '\\.EMAIL\\b(?!_)').test(body));
      if (direct || viaAlias) offenders.push(f + ' ' + s.name);
    });
  });
  check('★★★★★★ src/ 讀 NameMapping 電郵只經 effectivePersonEmail_()', offenders.length === 0, offenders.join('、'));
  // 人員資料編輯：讀 Email 只限寫入時比較舊值；顯示用 effectivePersonEmail_
  check('★★★★ 人員資料畫面顯示用實際電郵', /const email = effectivePersonEmail_\(row\);/.test(read('src/WebAppPeople.gs')));
}

console.log('\n=== XA4：〔補填電郵〕畫面 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const v = g.apiGetManualEmailView(sc.Q);
  check('★★★★★★ 只列沒有實際電郵的人（P9707）', v.missing.length >= 1 && v.missing.every((p) => !sc.cell(p.personId, 'Email'))
    && v.missing.some((p) => p.personId === 'P9707'), JSON.stringify(v.missing));
  check('★★★★★ 有電郵的人不列', !v.missing.some((p) => p.personId === 'P9701'));
  check('★★★★★ 每行有姓名、崗位摘要、為甚麼在名單上', v.missing.every((p) => p.nameTC && typeof p.posts === 'string' && p.why), JSON.stringify(v.missing));
  check('★★★★★ 說明句', v.explanation === '這裏填的電郵只供職事表寄信用，不會寫入出席系統。出席系統之後有了電郵，會改用出席系統的。');
  // 不在這一季名單上的人（例如停用、沒有任何崗位）不列
  check('★★★★ 不是這一季可能用到的人不列（P9706 不在自動崗位名單，也不在職事表）', !v.missing.some((p) => p.personId === 'P9706') || !!sc.cell('P9706', 'Email'));
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  const v2 = g.apiGetManualEmailView(sc.Q);
  check('★★★★★★ 儲存之後移到「已補填」', !v2.missing.some((p) => p.personId === 'P9707') && v2.filled.some((p) => p.personId === 'P9707' && p.manualEmail === 'p9707-manual@example.invalid' && !p.superseded));
  sc.setCell('P9707', 'Email', 'p9707-hwcas@example.invalid');
  const v3 = g.apiGetManualEmailView(sc.Q);
  const f3 = v3.filled.filter((p) => p.personId === 'P9707')[0];
  check('★★★★★★ 出席系統已有電郵 ⇒「出席系統已有電郵，現時用出席系統的」', f3 && f3.superseded && f3.note === '出席系統已有電郵，現時用出席系統的', JSON.stringify(f3));
  check('★★★★ 那時實際電郵是出席系統的', g.indexPeopleById_().P9707.email === 'p9707-hwcas@example.invalid');
}

console.log('\n=== XA5：儲存 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('（前置）還沒有 ManualEmail 欄', sc.nmKeys().indexOf('ManualEmail') === -1);
  const bad = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'not an email' }]);
  check('★★★★★★ 格式不對 ⇒ 不寫入，說明哪一個', bad.ok === false && /看起來不正確/.test(bad.message) && sc.nmKeys().indexOf('ManualEmail') === -1, bad.message);
  const emailBefore = sc.cell('P9707', 'Email');
  const r = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  check('★★★★★★ 第一次儲存自動補 ManualEmail 欄並寫入', r.ok && r.saved === 1 && sc.cell('P9707', 'ManualEmail') === 'p9707-manual@example.invalid', JSON.stringify(r).slice(0, 200));
  check('★★★★★★ Email 欄沒有被改', sc.cell('P9707', 'Email') === emailBefore);
  const audits = sc.audits('MANUAL_EMAIL_SET');
  const A = sc.C.AUDIT_LOG;
  check('★★★★★★ AuditLog MANUAL_EMAIL_SET，電郵遮蔽（不出現完整地址）', audits.length === 1
    && JSON.stringify(audits).indexOf('p9707-manual@example.invalid') === -1 && /ManualEmail=/.test(audits[0][A.NEW_VALUE]), JSON.stringify(audits));
  const same = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  check('★★★★ 沒有改動 ⇒ 不寫 AuditLog', same.saved === 0 && sc.audits('MANUAL_EMAIL_SET').length === 1);
  const c = g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: '' }]);
  check('★★★★★★ 清空＝清除', c.cleared === 1 && sc.cell('P9707', 'ManualEmail') === '');
  check('★★★★ 沒有任何項目 ⇒ 說明', g.saveManualEmails_locked_(sc.Q, []).ok === false);
  check('★★★★ 儲存之後回傳最新畫面', c.view && Array.isArray(c.view.missing));
}

console.log('\n=== XA6：權限 ===');
{
  const webApp = read('src/WebApp.gs');
  const script = read('src/ui/Script.html');
  const roList = (webApp.match(/const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/) || ['', ''])[1];
  const frontList = (script.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/) || ['', ''])[1];
  check('★★★★★★ 畫面讀取在兩份唯讀清單', /'apiGetManualEmailView'/.test(roList) && /'apiGetManualEmailView'/.test(frontList));
  check('★★★★★★ 儲存不在唯讀清單（只可查看的人不可以）', !/'apiSaveManualEmails'/.test(roList) && !/'apiSaveManualEmails'/.test(frontList));
  const me = read('src/ManualEmail.gs');
  check('★★★★★ 兩支 api 第一句檢查權限', /function apiGetManualEmailView\(quarterId\) \{\s*assertWebAppRequestAllowed_\('apiGetManualEmailView'\);/.test(me)
    && /function apiSaveManualEmails\(quarterId, entries\) \{\s*assertWebAppRequestAllowed_\(\);\s*return withMutationLock_\(/.test(me));
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★ 開季前準備有〔補填電郵〕；畫面〔儲存〕用 callServerMutating', /button\('補填電郵', \(\) => openManualEmails\(\)/.test(z2)
    && /callServerMutating\('apiSaveManualEmails', currentQuarterId, entries\)/.test(z2));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
