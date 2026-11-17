// 第一百一十二輪批次 UC 組：沒有電郵的人——〔複製訊息〕。
// 執行方式：node tests/round112_uc_copy_message.test.js
//
//   UC1 訊息內容：稱呼、季度、用途、這個人的個人連結、截止日（申報）、有疑問找誰；兩個範本（申報、正式發出）
//   UC2 權限：只有可以修改的人（只可查看、確認者都不可以）；分階段開放照舊；沒有個人連結／已停用／認不出 ⇒ 不給
//   UC3 AuditLog：只記 PersonID，不記連結、token
//   UC4 清單：沒有電郵的人帶 personId＋copyState（伺服器判斷），不帶 token；沒有個人連結 ⇒ NO_LINK（不出按鈕、出提示）
//   UC5 畫面：〔複製訊息〕；剪貼簿寫入失敗 ⇒ 可以全選的文字框；只可查看變灰；審閱窗不出按鈕
//   UC6 範本：兩個新範本在 EMAIL_TEMPLATE_SEEDS；用字
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildUnavailableScene, tok } = require('./helpers/unavailable_scene.js');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

function scene(config) {
  const sc = buildUnavailableScene({ config: Object.assign({ ROSTER_CONTACT_TC: ['示範幹事', 'STR'] }, config || {}), extraFiles: ['PersonalLinkMessage.gs', 'WebAppFlow.gs'] });
  return sc;
}

console.log('\n=== UC1：訊息內容 ===');
{
  const sc = scene();
  const g = sc.gas;
  const r = g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'DECLARE');
  check('★★★★★★ 申報訊息：稱呼、季度、個人連結（這個人的 token＋季度）、截止日、有疑問找誰',
    r.ok === true && /^.+，平安！/.test(r.text) && r.text.indexOf(r.name) === 0
      && r.text.indexOf('p=' + tok(5)) !== -1 && r.text.indexOf('q=' + sc.Q) !== -1
      && /2098-12-04/.test(r.text) && /示範幹事/.test(r.text) && r.text.indexOf('{') === -1, r.text);
  check('★★★★★ 申報訊息講明用途（申報不能服侍的主日）及「連結只供本人使用」', /申報/.test(r.text) && /不能服侍的主日/.test(r.text) && /只供你本人使用/.test(r.text));
  check('★★★★★★ 回傳「已複製給〈名字〉的訊息，請貼到 WhatsApp 或短訊。」', r.message === '已複製給' + r.name + '的訊息，請貼到 WhatsApp 或短訊。', r.message);
  const noVersion = throwsMsg(() => g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'OFFICIAL'));
  check('★★★★★ 正式發出訊息：這一季還沒有職事表 ⇒ 不給', /這一季還沒有職事表/.test(noVersion), noVersion);
  g.findLatestVersionNo_ = function () { return 0; };
  const off = g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'OFFICIAL');
  check('★★★★★★ 正式發出訊息：已發出、查看服侍安排、個人連結、有疑問找誰；沒有截止日一句',
    off.ok && /職事表已經發出/.test(off.text) && /查看你的服侍安排/.test(off.text) && off.text.indexOf('p=' + tok(5)) !== -1
      && /示範幹事/.test(off.text) && !/截止|之前申報/.test(off.text) && off.text.indexOf('{') === -1, off.text);
  check('★★★★★ 兩種訊息不同', off.text !== r.text);
  check('★★★★★ 認不出的種類 ⇒ 拋錯', /認不出這是哪一種訊息/.test(throwsMsg(() => g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'X'))));
  // 純函式：沒有截止日 ⇒ 「生成日之前」
  const tpl = g.EMAIL_TEMPLATE_SEEDS.filter((t) => t.templateId === 'TPL_PERSONAL_LINK_MESSAGE_DECLARE_TC')[0];
  const t2 = g.renderPersonalLinkMessageText_(tpl, { name: '示範甲', quarterId: 'Q', quarterLabel: 'QL', link: 'https://example.invalid/x', generateDate: '', deadline: '' });
  check('★★★★★ 沒有截止日 ⇒ 寫「生成日之前」', /生成日之前/.test(t2) && t2.indexOf('{') === -1, t2);
}

console.log('\n=== UC2：權限、開放範圍 ===');
{
  const sc = scene({ ROLLOUT_AUDIENCE: ['LEADERS', 'ENUM'] });
  const g = sc.gas;
  const m = throwsMsg(() => g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'DECLARE'));
  check('★★★★★★ 第一階段：不是堂委／執事／幹事 ⇒ 不給訊息', /現在只開放給堂委、執事及幹事/.test(m), m);
  check('★★★★★★ 清單狀態：NOT_OPEN（不出按鈕）', g.personalLinkMessageStates_(['P9705']).P9705 === 'NOT_OPEN');
  const sc2 = scene({ ROLLOUT_AUDIENCE: ['ALL', 'ENUM'] });
  check('★★★★★ 全面開放 ⇒ OK', sc2.gas.personalLinkMessageStates_(['P9705']).P9705 === 'OK');
  // 沒有個人連結
  const sc3 = scene();
  const nm = sc3.ss.getSheetByName(sc3.S.NAME_MAPPING);
  const col = sc3.gas.ensureNameMappingPersonalLinkTokenColumn_();
  for (let r = 3; r <= nm.getLastRow(); r++) if (String(nm.getRange(r, 1).getValue()) === 'P9706') nm.getRange(r, col).setValue('');
  const m3 = throwsMsg(() => sc3.gas.apiGetPersonalLinkMessage(sc3.Q, 'P9706', 'DECLARE'));
  check('★★★★★★ 沒有個人連結 ⇒ 不給，說明原因', /還沒有個人連結/.test(m3), m3);
  check('★★★★★★ 清單狀態：NO_LINK（不出按鈕，出提示）', sc3.gas.personalLinkMessageStates_(['P9706', 'P9705']).P9706 === 'NO_LINK' && sc3.gas.personalLinkMessageStates_(['P9706', 'P9705']).P9705 === 'OK');
  check('★★★★★ 認不出的人 ⇒ 不給', /不在名單上|找不到/.test(throwsMsg(() => sc3.gas.apiGetPersonalLinkMessage(sc3.Q, 'P0000', 'DECLARE'))));
  check('★★★★★ 認不出的季度 ⇒ 不給', /找不到這一季/.test(throwsMsg(() => sc3.gas.apiGetPersonalLinkMessage('2000T9', 'P9705', 'DECLARE'))));
  // 已停用
  const aCol = (function () { const h = nm.getRange(2, 1, 1, nm.getLastColumn()).getValues()[0]; return h.indexOf(sc3.C.NAME_MAPPING.ACTIVE) + 1; })();
  for (let r = 3; r <= nm.getLastRow(); r++) if (String(nm.getRange(r, 1).getValue()) === 'P9704') nm.getRange(r, aCol).setValue('FALSE');
  check('★★★★★ 已停用的人 ⇒ 不給', /已經停用/.test(throwsMsg(() => sc3.gas.apiGetPersonalLinkMessage(sc3.Q, 'P9704', 'DECLARE'))));
  // 只可查看
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs', 'PersonalLinkMessage.gs']);
  gas.Session = { getActiveUser: () => ({ getEmail: () => 'viewer@example.invalid' }) };
  gas.getConfig_ = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['editor@example.invalid'];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid'];
    return d;
  };
  gas.writeAuditLog_ = () => {}; gas.log_ = () => {};
  check('★★★★★★ 只可查看的人 ⇒ 拒絕（伺服器端把關；在讀任何資料之前）', throwsMsg(() => gas.apiGetPersonalLinkMessage('2099T1', 'P9705', 'DECLARE')) === '你只有查看權限，不可以改動。');
  const src = read('src/PersonalLinkMessage.gs');
  check('★★★★★★ apiGetPersonalLinkMessage 第一句是 assertWebAppRequestAllowed_()（不傳名字＝要可以修改）', /function apiGetPersonalLinkMessage\([^)]*\) \{\n  assertWebAppRequestAllowed_\(\);\n/.test(src));
}

console.log('\n=== UC3：AuditLog 只記 PersonID ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGetPersonalLinkMessage(sc.Q, 'P9705', 'DECLARE');
  const rows = sc.audits('PERSONAL_LINK_MESSAGE_COPIED');
  const A = sc.C.AUDIT_LOG;
  check('★★★★★★ 一筆 PERSONAL_LINK_MESSAGE_COPIED，targetKey＝PersonID', rows.length === 1 && rows[0][A.TARGET_KEY] === 'P9705', JSON.stringify(rows));
  const dump = JSON.stringify(rows);
  check('★★★★★★ AuditLog 沒有連結、token、網址', dump.indexOf(tok(5)) === -1 && dump.indexOf('https://') === -1 && dump.indexOf('p=') === -1, dump);
  check('★★★★★ 記下季度及種類', /申報不能服侍的日子/.test(rows[0][A.NOTES]) && rows[0][A.NEW_VALUE] === 'DECLARE' && rows[0][A.NOTES].indexOf(sc.Q) !== -1);
  const failed = throwsMsg(() => g.apiGetPersonalLinkMessage(sc.Q, 'P0000', 'DECLARE'));
  check('★★★★★ 失敗（沒有給出訊息）時不寫「已複製」', failed !== '' && sc.audits('PERSONAL_LINK_MESSAGE_COPIED').length === 1);
}

console.log('\n=== UC4：清單帶 personId＋copyState，不帶 token ===');
{
  const sc = scene({ ROLLOUT_AUDIENCE: ['LEADERS', 'ENUM'] });
  const g = sc.gas;
  const list = g.attachPersonalLinkMessageState_([{ name: '示範甲', personId: 'P9705' }, { name: '臨時', personId: 'NAME:臨時', tempHelper: true }, { name: '外', reason: 'x' }]);
  check('★★★★★★ 有 personId 的加 copyState；臨時幫手、沒有 personId 的不加', list[0].copyState === 'NOT_OPEN' && list[1].copyState === undefined && list[2].copyState === undefined, JSON.stringify(list));
  const people = g.personalLinkMessagePeople_([{ personId: 'P9705', displayName: '示範甲', token: tok(5) }]);
  check('★★★★★★ 給前端的物件沒有 token', people.length === 1 && people[0].personId === 'P9705' && people[0].name === '示範甲' && JSON.stringify(people).indexOf(tok(5)) === -1, JSON.stringify(people));
  const flow = read('src/WebAppFlow.gs');
  check('★★★★★ buildUnreachablePeople_ 帶 personId 並附 copyState；臨時幫手不帶', /reason: '沒有電郵', personId: p\.personId/.test(flow) && /attachPersonalLinkMessageState_\(noEmailPeople\)/.test(flow)
    && /name: t\.nameTC, reason: '臨時幫手' \}/.test(flow));
  const inv = read('src/UnavailableInvite.gs');
  check('★★★★★ 申報連結窗預覽及結果都帶 noEmailPeople／paper.people', /noEmailPeople: personalLinkMessagePeople_\(who\.noEmailPeople\)/.test(inv) && /people: personalLinkMessagePeople_\(who\.noEmailPeople\)/.test(inv));
}

console.log('\n=== UC5：畫面 ===');
{
  const sh = read('src/ui/Script.html');
  check('★★★★★★ 按鈕叫〔複製訊息〕，向伺服器取得訊息才複製', /button\('複製訊息', \(\) => runAction\('複製訊息'/.test(sh) && /callServerMutating\('apiGetPersonalLinkMessage', currentQuarterId, p\.personId, purpose\)/.test(sh));
  check('★★★★★★ 成功 ⇒「已複製給〈名字〉的訊息，請貼到 WhatsApp 或短訊。」', /'已複製給' \+ \(r\.name \|\| p\.name\) \+ '的訊息，請貼到 WhatsApp 或短訊。'/.test(sh));
  check('★★★★★★ 剪貼簿寫入失敗 ⇒ 顯示可以全選的文字框（readOnly textarea＋select）', /未能自動複製，請全選下面的文字再複製/.test(sh) && /ta\.readOnly = true;/.test(sh) && /ta\.select\(\)/.test(sh));
  check('★★★★★★ 沒有個人連結 ⇒ 不出按鈕，出提示', /p\.copyState === 'NO_LINK'\) return make\('span', \{ text: '　還沒有個人連結，未能複製訊息'/.test(sh));
  check('★★★★★ 還未開放 ⇒ 不出按鈕，出提示', /p\.copyState !== 'OK'\) return make\('span', \{ text: '　現在還未開放給這位，暫時不用通知'/.test(sh));
  check('★★★★★★ 只可查看的人：〔複製訊息〕變灰（VIEW_ONLY_BLOCKED_LABELS）', /\/\^複製訊息\$\//.test(sh));
  check('★★★★★ 取得訊息不令畫面標記過期', /apiGetPersonalLinkMessage: \(\) => false/.test(sh));
  check('★★★★★★ 介面沒有 PersonID、義工字眼', !/PersonID|義工/.test(sh.slice(sh.indexOf('function buildCopyMessageControl'), sh.indexOf('function buildUnreachableNodes'))));
  const z1 = read('src/ui/ScriptZone1.html');
  check('★★★★★★ 正式發出的確認窗及完成窗傳 OFFICIAL；審閱窗不傳',
    (z1.match(/buildUnreachableNodes\([a-z.]+unreachable, \{ messagePurpose: 'OFFICIAL' \}\)/g) || []).length === 2
      && (z1.match(/buildUnreachableNodes\([a-z.]+unreachable\)/g) || []).length === 2);
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★★ 申報連結窗：預覽及結果窗都有逐位〔複製訊息〕（申報用）', (z5.match(/buildNoEmailPersonRow\(n, 'DECLARE', ''\)/g) || []).length === 2);
  // 行一次畫面函式：沒有連結 ⇒ 只有提示、沒有按鈕
  const m = /function buildCopyMessageControl\(p, purpose\) \{[\s\S]*?\n  \}\n\n  \/\*\* 複製到剪貼簿/.exec(sh);
  const made = [];
  const ctx = { make: (tag, o) => { const n = { tag: tag, text: (o && o.text) || '', children: [], appendChild(c) { this.children.push(c); } }; made.push(n); return n; },
    button: () => ({ tag: 'button' }), runAction: () => {}, callServerMutating: () => {}, copyTextToClipboardAsync_: () => {}, setStatus: () => {}, document: {}, currentQuarterId: 'X' };
  vm.runInNewContext(m[0].replace(/\n  \/\*\* 複製到剪貼簿$/, '') + '\nthis.f = buildCopyMessageControl;', ctx);
  const noLink = ctx.f({ personId: 'P1', name: 'A', copyState: 'NO_LINK' }, 'DECLARE');
  const ok = ctx.f({ personId: 'P1', name: 'A', copyState: 'OK' }, 'DECLARE');
  const none = ctx.f({ name: 'B' }, 'DECLARE');
  check('★★★★★★ 行畫面函式：沒有個人連結 ⇒ 只有提示文字；可以 ⇒ 有按鈕；沒有 personId ⇒ 什麼都沒有',
    noLink.tag === 'span' && /還沒有個人連結/.test(noLink.text) && ok.tag === 'span' && ok.children.some((c) => c.tag === 'button') && none === null,
    JSON.stringify([noLink.text, ok.children.map((c) => c.tag), none]));
}

console.log('\n=== UC6：範本 ===');
{
  const g = loadGasSource(['Constants.gs', 'Utils.gs', 'EmailTemplateSeed.gs']);
  const seeds = g.EMAIL_TEMPLATE_SEEDS.filter((t) => /^TPL_PERSONAL_LINK_MESSAGE_/.test(t.templateId));
  check('★★★★★★ 兩個範本：申報、正式發出（在 EMAIL_TEMPLATE_SEEDS ⇒ 〔補建設定及範本〕、〔更新電郵範本到最新版〕會處理）',
    seeds.map((t) => t.templateId).sort().join() === 'TPL_PERSONAL_LINK_MESSAGE_DECLARE_TC,TPL_PERSONAL_LINK_MESSAGE_OFFICIAL_TC');
  check('★★★★★ 範本用「事奉人員」、不用「義工」；沒有台灣式用詞', seeds.every((t) => !/義工|您好|軟體|網路/.test(t.bodyPlain + t.subject)));
  check('★★★★★ 每個範本有 {PersonalLink}、{PersonName}、{QuarterLabel}、{ContactName}', seeds.every((t) => ['{PersonalLink}', '{PersonName}', '{QuarterLabel}', '{ContactName}'].every((k) => t.bodyPlain.indexOf(k) !== -1)));
  const ts = read('src/TemplateSamples.gs');
  check('★★★★★★ 範本樣本用正式〔複製訊息〕同一支砌文字函式（renderPersonalLinkMessageText_）', /isPersonalLinkMessageTemplateId_\(t\.id\)[\s\S]{0,600}renderPersonalLinkMessageText_\(t\.template,/.test(ts));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
