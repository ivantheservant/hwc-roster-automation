// 第一百零一輪批次 ZE 組（及 ZC-3 合併窗）：收件人選擇、第一階段開放範圍、季前資料窗頂內容。
// 執行方式：node tests/round101_ze_audience.test.js
//
//   ZE1 收件人選擇（共用）：堂委（現任 N 位）、執事（現任 N 位）、幹事、全部事奉人員（N 位）、指定的人、輸入電郵（只限季前資料）；
//       同一地址只收一封（季前資料）；申報連結按人；預設：季前資料＝堂委＋執事＋幹事；申報連結＝按開放範圍
//   ZE2 第一階段 ROLLOUT_AUDIENCE=LEADERS：「全部事奉人員」及非堂委／執事／幹事的「指定的人」不可選（畫面＋伺服器端拋錯）；
//       個人連結頁申報區只給堂委、執事、幹事，其他人一句「暫時未開放」；提交申報的 api 伺服器端把關；ALL ⇒ 照舊
//   ZE3 〔寄出季前資料〕窗頂：「這封信會寄出：①…⑦」（照實際段落）及「不包括申報不能服侍日子的連結…」
//   ZC3 合併窗：一個確認——有電郵的寄信、沒有電郵的同時產生 Word 檔；第一階段只寄給堂委、執事、幹事
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, tok, T1 } = require('./helpers/unavailable_scene.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** P9701 堂委、P9702 執事、P9703 幹事（電郵＝MAIL_ADMIN_NOTIFY）；其餘一般事奉人員。 */
function scene(rollout, extraConfig) {
  const roles = (sc0) => [];
  const sc = buildUnavailableScene({
    config: Object.assign({ ROLLOUT_AUDIENCE: [rollout || 'LEADERS', 'ENUM'] }, extraConfig || {}),
    roles: [], extraFiles: ['InvitePaper.gs']
  });
  const g = sc.gas; const C = sc.C; const S = sc.S;
  const R = C.ROLES;
  const sh = sc.ss.getSheetByName(S.ROLES);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const add = (id, pid, code) => sh.getRange(sh.getLastRow() + 1, 1, 1, keys.length).setValues([keys.map((k) => ({
    [R.ROLE_ASSIGNMENT_ID]: id, [R.PERSON_ID]: pid, [R.ROLE_CODE]: code, [R.EFFECTIVE_FROM]: '2000-01-01', [R.EFFECTIVE_TO]: '', [R.ACTIVE]: true })[k] || '')]);
  add('R1', 'P9701', 'COMMITTEE');
  add('R2', 'P9702', 'DEACON');
  // P9703 的電郵 ⇒ MAIL_ADMIN_NOTIFY（幹事）
  const people = g.readSheet_(S.NAME_MAPPING);
  const p3 = people.filter((r) => r[C.NAME_MAPPING.PERSON_ID] === 'P9703')[0];
  sc.p3Email = g.effectivePersonEmail_(p3);
  const realGet = g.getConfig_;
  g.getConfig_ = function (k, d) { return k === 'MAIL_ADMIN_NOTIFY' ? sc.p3Email : realGet(k, d); };
  void roles;
  return sc;
}

console.log('\n=== ZE1：收件人選擇 ===');
{
  const sc = scene('ALL');
  const g = sc.gas;
  const o = g.buildAudienceOptions_('PRESEASON', sc.today);
  const lab = o.groups.map((x) => x.label);
  check('★★★★★★ 四組：堂委（現任 1 位）、執事（現任 1 位）、幹事、全部事奉人員（N 位）', lab[0] === '堂委（現任 1 位）' && lab[1] === '執事（現任 1 位）'
    && lab[2] === '幹事' && /^全部事奉人員（\d+ 位）$/.test(lab[3]), lab.join('／'));
  check('★★★★★ 指定的人：名單上的人（名字＋有沒有電郵）；季前資料可以輸入電郵，申報連結不可以', o.people.length >= 5 && o.people.every((p) => 'hasEmail' in p)
    && o.allowEmails === true && g.buildAudienceOptions_('INVITE', sc.today).allowEmails === false);
  check('★★★★★★ 預設：季前資料＝堂委＋執事＋幹事；申報連結（ALL）＝全部事奉人員',
    JSON.stringify(o.defaults) === '["COMMITTEE","DEACON","ADMIN"]' && JSON.stringify(g.buildAudienceOptions_('INVITE', sc.today).defaults) === '["ALL"]');
  const r = g.resolveAudienceSelection_('PRESEASON', { groups: ['COMMITTEE', 'DEACON', 'ADMIN'], personIds: ['P9701'], emails: ['x@example.invalid', sc.p3Email] }, sc.today);
  const emails = r.people.concat(r.extra).map((p) => p.email.toLowerCase());
  check('★★★★★★ 同一地址只收一封（指定了堂委本人、輸入了幹事的電郵也不重複）', new Set(emails).size === emails.length && emails.length === 4, JSON.stringify(emails));
  check('★★★★★ 理由合併：「堂委、指定」', r.people.filter((p) => p.personId === 'P9701')[0].why === '堂委、指定', JSON.stringify(r.people));
  let err = '';
  try { g.resolveAudienceSelection_('PRESEASON', { groups: [], emails: ['not-an-email'] }, sc.today); } catch (e) { err = e.message; }
  check('★★★★★ 電郵格式不對 ⇒ 拋錯，一封都不寄', /格式不對/.test(err), err);
  err = '';
  try { g.resolveAudienceSelection_('INVITE', { groups: [], emails: ['a@example.invalid'] }, sc.today); } catch (e) { err = e.message; }
  check('★★★★★ 申報連結不可以輸入電郵（每人一條個人連結）', /不可以輸入電郵/.test(err), err);
  const all = g.resolveAudienceSelection_('INVITE', { groups: ['ALL'] }, sc.today);
  check('★★★★★ 全部事奉人員＝這一季事奉人員表上的人（和舊邀請同一份）', all.people.length + all.noEmail.length === Object.keys(g.listUnavailableInviteCandidateIds_(sc.today)).length);
}

console.log('\n=== ZE2：第一階段（LEADERS）===');
{
  const sc = scene('LEADERS');
  const g = sc.gas;
  const o = g.buildAudienceOptions_('INVITE', sc.today);
  const allGroup = o.groups.filter((x) => x.id === 'ALL')[0];
  check('★★★★★★ 「全部事奉人員」不可選，旁邊寫「現時是第一階段，只開放給堂委、執事及幹事。」', allGroup.allowed === false && allGroup.note === '現時是第一階段，只開放給堂委、執事及幹事。');
  const byId = {};
  o.people.forEach((p) => { byId[p.personId] = p; });
  check('★★★★★★ 指定的人：堂委、執事、幹事可選；其他人不可選', byId.P9701.allowed && byId.P9702.allowed && byId.P9703.allowed && !byId.P9704.allowed && !byId.P9705.allowed);
  check('★★★★★ 預設（申報連結）＝堂委＋執事＋幹事', JSON.stringify(o.defaults) === '["COMMITTEE","DEACON","ADMIN"]');
  let err = '';
  try { g.resolveAudienceSelection_('INVITE', { groups: ['ALL'] }, sc.today); } catch (e) { err = e.message; }
  check('★★★★★★ 伺服器端把關：送來「全部事奉人員」⇒ 拋錯', /全部事奉人員」現時不可以選/.test(err), err);
  err = '';
  try { g.resolveAudienceSelection_('PRESEASON', { groups: [], personIds: ['P9705'] }, sc.today); } catch (e) { err = e.message; }
  check('★★★★★★ 伺服器端把關：指定了非堂委／執事／幹事 ⇒ 拋錯', /不是堂委、執事或幹事/.test(err), err);
  const ok = g.resolveAudienceSelection_('INVITE', { groups: [], personIds: ['P9702'] }, sc.today);
  check('★★★★★ 指定執事 ⇒ 可以', ok.people.length + ok.noEmail.length === 1);
  // 個人連結頁
  const closed = g.buildPersonalUnavailableBoot_('P9705', tok(5), sc.Q);
  check('★★★★★★ 一般事奉人員：申報區只寫「申報不能服侍的日子暫時未開放。如有不能服侍的日子，請直接與幹事聯絡。」',
    closed.closed === true && closed.view === null && closed.closedText === '申報不能服侍的日子暫時未開放。如有不能服侍的日子，請直接與幹事聯絡。', JSON.stringify(closed));
  const open = g.buildPersonalUnavailableBoot_('P9701', tok(1), sc.Q);
  check('★★★★★★ 堂委：申報區照常', !open.closed && open.view && open.view.quarters.length > 0);
  check('★★★★★ 幹事（電郵在 MAIL_ADMIN_NOTIFY）：照常', !g.buildPersonalUnavailableBoot_('P9703', tok(3), sc.Q).closed);
  const res = g.personalSubmitUnavailable(tok(5), '', [T1[1]], '', []);
  check('★★★★★★ 伺服器端把關：一般事奉人員提交 ⇒ 拒絕，一行都不寫', res.ok === false && res.closed === true && sc.subs().length === 0, JSON.stringify(res));
  const res2 = g.personalSubmitUnavailable(tok(1), '', [T1[1]], '', []);
  check('★★★★★ 堂委提交 ⇒ 照常', res2.ok === true && sc.subs().length === 1, JSON.stringify(res2));
  const page = read('src/ui/PersonalRoster.html');
  check('★★★★★ 頁面：boot.closed ⇒ 只顯示那一句，下面的提示一併改寫', /if \(boot\.closed\) renderClosed\(boot\.closedText\);/.test(page) && /id="howToDeclare"/.test(page));
  // Config ROSTER_CONTACT_TC
  const sc2 = scene('LEADERS', { ROSTER_CONTACT_TC: ['示範幹事', 'STR'] });
  check('★★★★★ {ContactName} 讀 Config', sc2.gas.buildPersonalUnavailableBoot_('P9705', tok(5), sc2.Q).closedText.indexOf('請直接與示範幹事聯絡') !== -1);
  // ALL ⇒ 照舊
  const sc3 = scene('ALL');
  check('★★★★★ ALL ⇒ 一般事奉人員可以申報', !sc3.gas.buildPersonalUnavailableBoot_('P9705', tok(5), sc3.Q).closed
    && sc3.gas.personalSubmitUnavailable(tok(5), '', [T1[1]], '', []).ok === true);
}

console.log('\n=== ZC3：合併窗（一個確認）===');
{
  const sc = scene('LEADERS');
  const g = sc.gas;
  g.syncPeopleFromHwcasBeforeSend_ = () => ({});
  g.assertWebAppRequestAllowed_ = () => {};
  const made = [];
  g.createInvitePaperDocx_ = (q, people) => { made.push(people.map((p) => p.personId)); return { blob: null, fileUrl: 'https://example.invalid/doc', fileName: 'x.docx' }; };
  // P9702 沒有電郵
  const nm = sc.ss.getSheetByName(sc.S.NAME_MAPPING);
  const keys = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0];
  const ec = keys.indexOf(sc.C.NAME_MAPPING.EMAIL) + 1;
  for (let r = 3; r <= nm.getLastRow(); r++) if (String(nm.getRange(r, 1).getValue()) === 'P9702') nm.getRange(r, ec).setValue('');
  const pv = g.apiUnavailableLinkPreview(sc.Q, null);
  check('★★★★★★ 預設（第一階段）：會收到電郵＝堂委、幹事；沒有電郵（執事）會產生 Word 檔', pv.recipientNames.length === 2 && pv.noEmail.length === 1, JSON.stringify(pv));
  const r = g.apiUnavailableLinkSendAndExport(sc.Q, null);
  check('★★★★★★ 一個確認：有電郵的寄信（DRY_RUN 模擬 2 封），沒有電郵的同時產生 Word 檔並給連結',
    r.dryRun === true && r.simulated === 2 && r.paper && r.paper.count === 1 && r.paper.fileUrl === 'https://example.invalid/doc' && JSON.stringify(made) === '[["P9702"]]', JSON.stringify(r));
  let err = '';
  try { g.apiUnavailableLinkSendAndExport(sc.Q, { groups: ['ALL'] }); } catch (e) { err = e.message; }
  check('★★★★★★ 第一階段送來「全部事奉人員」⇒ 拒絕', /現時不可以選/.test(err), err);
  const old = g.sendUnavailableInvites_(sc.Q);
  check('★★★★★★ 舊入口（不傳收件人）一樣按開放範圍：第一階段只寄給堂委、幹事（有電郵的）', old.simulated === 2, JSON.stringify(old));
  const z2 = read('src/ui/ScriptZone2.html');
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★ 開季前準備：〔寄出季前資料〕〔寄出／匯出申報不能服侍日子連結〕同一行', /button\('寄出季前資料', \(\) => openPreseasonSend\(\), 'secondary'\),\s*button\(UNAVAILABLE_LINK_BUTTON_LABEL, \(\) => openUnavailableInvite\(\), 'secondary'\)/.test(z2));
  check('★★★★★ 窗內 ① 寄給誰（共用元件）② 收件人名單 ③〔寄出及匯出〕', /renderAudiencePicker\(p\.audience, s, \(next\) => openUnavailableInvite\(next\)\)/.test(z5)
    && /'② 會收到電郵（'/.test(z5) && /button\('寄出及匯出'/.test(z5) && /callServerMutating\('apiUnavailableLinkSendAndExport', currentQuarterId, s\)/.test(z5));
  check('★★★★★ 舊深連結 view=invite／invitepaper ⇒ 新窗', /invite: \(\) => openUnavailableInvite\(\),\s*invitepaper: \(\) => openUnavailableInvite\(\)/.test(read('src/ui/Script.html')));
  check('★★★★★ 共用元件：不可選的打灰並寫原因；〔更新收件人名單〕', /cb\.disabled = !g\.allowed;/.test(z5) && /cb\.disabled = !p\.allowed;/.test(z5) && /button\('更新收件人名單'/.test(z5));
}

console.log('\n=== ZE3：〔寄出季前資料〕窗頂 ===');
{
  const sc = scene('LEADERS');
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = () => {};
  const p = g.apiPreseasonPreview(sc.Q, null);
  const titles = p.sections.map((s) => s.title.replace(/^[一二三四五六七八九十]+、/, ''));
  check('★★★★★★ 「這封信會寄出：①…」照季前資料實際的段落（不多寫、不少寫）', p.contentsLine === '這封信會寄出：' + titles.map((t, i) => '①②③④⑤⑥⑦⑧⑨⑩'[i] + t).join(' '), p.contentsLine);
  check('★★★★★ 現時七段：①事奉人員表 … ⑥預先安排的領詩、司琴 ⑦人手檢查', /^這封信會寄出：①事奉人員表 ②暫時不做某崗位 ③排表偏好 ④不能服侍的日期 ⑤合堂主日及詩班獻詩 ⑥預先安排的領詩、司琴 ⑦人手檢查$/.test(p.contentsLine), p.contentsLine);
  check('★★★★★★ 「不包括申報不能服侍日子的連結（那是〔寄出／匯出申報不能服侍日子連結〕）。」', p.notIncludedLine === '不包括申報不能服侍日子的連結（那是〔寄出／匯出申報不能服侍日子連結〕）。');
  check('★★★★★ 預覽帶收件人選項及預設收件人（堂委、執事、幹事）', p.audience && p.audience.groups.length === 4 && p.recipients.length >= 2, JSON.stringify(p.recipients));
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★ 窗最上面就是這兩句', /const nodes = \[\s*\/\/[^\n]*\n\s*make\('div', \{ className: 'warnbox' \}, \[\s*make\('div', \{ text: p\.contentsLine/.test(z5));
  let err = '';
  try { g.apiPreseasonSend(sc.Q, { groups: ['ALL'] }); } catch (e) { err = e.message; }
  check('★★★★★★ 季前資料第一階段一樣不可以寄「全部事奉人員」（伺服器端）', /現時不可以選/.test(err), err);
  const sent = g.sendPreseasonPack_(sc.Q, 'MANUAL', { groups: ['COMMITTEE'], personIds: [], emails: [] });
  check('★★★★★ 人手寄出只寄給選了的人（只選堂委 ⇒ 1 封）', sent.simulated === 1, JSON.stringify(sent));
}

console.log('\n=== Config ===');
{
  const seed = read('src/ConfigSeed.gs');
  check('★★★★★ ROLLOUT_AUDIENCE（ENUM，預設 LEADERS）', /CONFIG_KEYS\.ROLLOUT_AUDIENCE, type: CONFIG_TYPES\.ENUM[\s\S]{0,80}defaultValue: 'LEADERS'/.test(seed));
  check('★★★★ 認不出的值 ⇒ 當作 LEADERS（較安全）', /return v === ROLLOUT_AUDIENCE\.ALL \? ROLLOUT_AUDIENCE\.ALL : ROLLOUT_AUDIENCE\.LEADERS;/.test(read('src/RolloutAudience.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
