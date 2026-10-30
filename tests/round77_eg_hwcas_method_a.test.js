// 第七十七輪批次 EG 組：出席系統（方法 A）——姓名同電郵由出席系統讀取（按會眾編號）。
// 執行方式：node tests/round77_eg_hwcas_method_a.test.js
//
// Ivan 嘅決定：會眾資料只要出席系統一個來源；每次打開幹事介面時讀取；電郵跟出席系統（按會眾編號）；
// 名字保留職事表自己嘅寫法。對出席系統一律唯讀；絕不讀身份證號碼欄（E）同密碼欄（T）。
//
//   EG1　按會眾編號更新電郵：出席系統空白 ⇒ 空白；找不到 ⇒ 不改並列出；重複 ⇒ 列出；NameTC 不變；只寫有改變嘅格
//   EG2　runHwcasSyncSafely_：10 分鐘內不重讀（force 例外）；讀不到出席系統 ⇒ 唔拋、記低錯誤、主畫面照出、寄出確認窗有一句
//   EG3　〔出席系統連結〕四段；〔連結勾了的人〕只寫 MemberNo（＋堂會／身分），之後即時更新電郵；名字不變
//   EG4　〔加入名單〕：喺出席系統搜尋（姓名／編號）；揀一位 ⇒ 新行有 MemberNo、職事表寫法、電郵由出席系統來；
//        編號已存在 ⇒ 不新增、提供別名；找不到 ⇒ 不可以新增
//   EG5　絕不讀 E、T 欄（只讀 Config HWCAS_READ_COLUMNS 列明嘅欄）
//   EG6　主畫面：hwcasSync 一句＋「N 位收不到電郵」；載入時叫一次 apiSyncPeopleFromHwcas；寄出路寄信前同步
//   EG7　畫面：〔加入名單〕冇人手輸入電郵嘅格；找不到 ⇒ 兩個出路；狀態卡一行；進階與診斷嗰行開 openHwcasLink

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');
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
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

// ── 場景：擬真試算表 ＋ 一個假嘅出席系統試算表 ─────────────────────
const sc = buildRound75Scene({
  extraFiles: ['HwcasSync.gs', 'HwcasApply.gs', 'WebAppHwcas.gs', 'WebAppPeople.gs', 'WebAppRoster3Common.gs',
    'WebAppEligibility.gs', 'PersonalLinkInMail.gs', 'SendOptions.gs', 'WebAppSendPlan.gs'],
  config: {
    HWCAS_SPREADSHEET_ID: ['HWCAS1', 'STR'], HWCAS_MEMBERS_SHEET: ['Members', 'STR'],
    HWCAS_READ_COLUMNS: ['A,B,C,D', 'LIST'], HWCAS_COL_NAME: ['B', 'STR'], HWCAS_COL_EMAIL: ['C', 'STR'],
    HWCAS_COL_MEMBER_NO: ['A', 'STR'], HWCAS_COL_LAST_ATTENDANCE: ['D', 'STR']
  }
});
const gas = sc.gas;
const M = sc.C.NAME_MAPPING;
// 狀態卡「今日 HH:mm」要同真正嘅今日對得上（harness 嘅 nowTimestamp_ 係 2099）
gas.nowTimestamp_ = () => new Intl.DateTimeFormat('en-CA', { timeZone: sc.TZ }).format(new Date()) + ' 09:00:00';
const NAME = (id) => sc.nameOf(id);

// 出席系統（E＝身份證、T＝密碼——絕不可以讀）
const hwcasSs = new RealisticMockSpreadsheet();
const members = hwcasSs.insertSheet('Members');
const hdr = ['會眾編號', '姓名', '電郵', '最後出席日期', '身份證'];
while (hdr.length < 20) hdr.push('欄' + (hdr.length + 1));
hdr[19] = '密碼';
const rows = [
  [1, NAME('P9701'), 'p9701-new@example.invalid', '2099-01-04', 'ID-1'],
  ['00002', NAME('P9702'), 'p9702@example.invalid', '2099-01-04', 'ID-2'],
  ['00005', NAME('P9705'), '', '', 'ID-5'],
  ['00006', NAME('P9706'), 'p9706-h@example.invalid', '', 'ID-6'],
  ['00008', '新來的人', 'newcomer@example.invalid', '2099-01-11', 'ID-8'],
  ['00009', NAME('P9704'), 'p9704-h@example.invalid', '2099-01-11', 'ID-9']
].map((r) => { while (r.length < 20) r.push(''); r[19] = 'secret'; return r; });
members.getRange(1, 1, 1, 20).setValues([hdr]);
members.getRange(2, 1, rows.length, 20).setValues(rows);
const readCols = [];
const origGetRange = members.getRange.bind(members);
members.getRange = function (r, c, nr, nc) { readCols.push({ c: c, nc: nc || 1 }); return origGetRange(r, c, nr, nc); };
gas.SpreadsheetApp.openById = (id) => { if (id === 'HWCAS1') return hwcasSs; throw new Error('沒有存取權'); };
const props = {};
gas.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (props[k] === undefined ? null : props[k]),
  setProperty: (k, v) => { props[k] = String(v); },
  deleteProperty: (k) => { delete props[k]; }
}) };

// 名單：重新種齊欄位
sc.ss.deleteSheet(sc.ss.getSheetByName(sc.S.NAME_MAPPING));
const KEYS = [M.PERSON_ID, M.NAME_TC, M.NAME_EN, M.MEMBER_NO, M.CONGREGATION, M.MEMBER_TYPE, M.MEETING_POINT,
  M.EMAIL, M.EMAIL_SOURCE, M.EMAIL_VERIFIED_AT, M.LAST_ATTENDANCE, M.ACTIVE, M.MAX_PER_QUARTER, M.SYNCED_AT];
const person = (id, memberNo, email, extra) => Object.assign({ [M.PERSON_ID]: id, [M.NAME_TC]: NAME(id), [M.MEMBER_NO]: memberNo,
  [M.EMAIL]: email, [M.ACTIVE]: true, [M.EMAIL_SOURCE]: email ? '手動' : '' }, extra || {});
seedSheet(sc.ss, sc.S.NAME_MAPPING, KEYS.map(() => ''), KEYS, [
  person('P9701', "'00001", 'p9701-old@example.invalid'),
  person('P9702', "'00002", 'p9702@example.invalid'),
  person('P9703', "'00003", 'p9703@example.invalid'),   // 出席系統搵唔到
  person('P9704', '', 'p9704@example.invalid'),         // 冇會眾編號
  person('P9705', "'00005", 'p9705@example.invalid'),   // 出席系統冇電郵 ⇒ 清空
  person('P9706', "'00006", 'p9706@example.invalid'),   // 重複編號
  person('P9707', "'00006", '')                         // 重複編號、冇電郵
]);
const rowOf = (id) => gas.readSheet_(sc.S.NAME_MAPPING).filter((r) => r[M.PERSON_ID] === id)[0];

console.log('\n=== EG1：按會眾編號更新電郵 ===');
{
  const writes = [];
  const realWrite = gas.writeRowFields_;
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) { writes.push({ sheetRow, updates }); return realWrite.apply(this, arguments); };
  const r = gas.syncPeopleFromHwcasByMemberNo_();
  gas.writeRowFields_ = realWrite;
  check('★★★★★★ 編號 00001（出席系統寫成數字 1）⇒ 電郵更新、EmailSource=HWCAS、SyncedAt 有值',
    rowOf('P9701')[M.EMAIL] === 'p9701-new@example.invalid' && rowOf('P9701')[M.EMAIL_SOURCE] === 'HWCAS' && !!rowOf('P9701')[M.SYNCED_AT], JSON.stringify(rowOf('P9701')));
  check('★★★★★★ 出席系統空白 ⇒ 名單都清空（跟出席系統）', rowOf('P9705')[M.EMAIL] === '', JSON.stringify(rowOf('P9705')));
  check('★★★★★★ 出席系統搵唔到（00003）⇒ 唔改，列入「找不到」', rowOf('P9703')[M.EMAIL] === 'p9703@example.invalid'
    && r.notFound.length === 1 && r.notFound[0].personId === 'P9703', JSON.stringify(r.notFound));
  check('★★★★★★ 兩行同一個編號（00006）⇒ 列入「重複」、兩位都唔改', r.duplicates.length === 1 && r.duplicates[0].memberNo === '00006'
    && rowOf('P9706')[M.EMAIL] === 'p9706@example.invalid', JSON.stringify(r.duplicates));
  check('★★★★★★ NameTC 一律唔改（保留職事表寫法）', ['P9701', 'P9702', 'P9705'].every((id) => rowOf(id)[M.NAME_TC] === NAME(id)));
  check('★★★★★ 只寫有改變嘅行：P9702 電郵一樣 ⇒ 只改 EmailSource；冇改嘅格唔寫',
    writes.every((w) => Object.keys(w.updates).indexOf(M.NAME_TC) === -1 && Object.keys(w.updates).indexOf(M.ACTIVE) === -1)
    && writes.some((w) => w.updates[M.EMAIL] === 'p9701-new@example.invalid') && r.updated >= 3, JSON.stringify(writes));
  check('★★★★ 最後出席日期一齊更新', gas.toDateString_(rowOf('P9701')[M.LAST_ATTENDANCE], sc.TZ) === '2099-01-04', String(rowOf('P9701')[M.LAST_ATTENDANCE]));
  check('★★★★ 回傳：冇會眾編號 1 位、出席系統冇電郵 1 位', r.unlinkedCount === 1 && r.noEmailInHwcasCount === 1, JSON.stringify(r));
}

console.log('\n=== EG2：安全同步／10 分鐘／讀不到 ===');
{
  const r1 = gas.runHwcasSyncSafely_({ force: true });
  check('★★★★★ force ⇒ 真係跑；記低時間', r1.ok && !r1.skipped && Number(props.HWCAS_SYNC_LAST_AT) > 0 && /^\d{4}-\d{2}-\d{2} /.test(props.HWCAS_SYNC_LAST_TEXT), JSON.stringify([r1, props]));
  const r2 = gas.runHwcasSyncSafely_({ force: false });
  check('★★★★★★ 10 分鐘內 ⇒ 略過（skipped=recent）', r2.ok && r2.skipped === 'recent', JSON.stringify(r2));
  check('★★★★ 寄出前用嘅係同一支（唔 force）', gas.syncPeopleFromHwcasBeforeSend_().skipped === 'recent');
  props.HWCAS_SYNC_LAST_AT = String(Date.now() - 11 * 60 * 1000);
  check('★★★★★ 過咗 10 分鐘 ⇒ 再跑', gas.runHwcasSyncSafely_({ force: false }).skipped === '');
  check('★★★★ 冇錯 ⇒ 確認窗嗰句係空', gas.readHwcasNoticeForSend_() === '');

  // 讀不到出席系統
  const origOpen = gas.SpreadsheetApp.openById;
  gas.SpreadsheetApp.openById = () => { throw new Error('沒有存取權'); };
  const bad = gas.runHwcasSyncSafely_({ force: true });
  check('★★★★★★ 讀不到 ⇒ 唔拋、ok=false、有一句「讀不到出席系統，暫時用上次（…）的電郵」',
    bad.ok === false && /讀不到出席系統，暫時用上次（.+）的電郵/.test(bad.notice), JSON.stringify(bad));
  check('★★★★★ 電郵一格都冇改', rowOf('P9701')[M.EMAIL] === 'p9701-new@example.invalid');
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★★ 主畫面照樣出，狀態卡講同一句', dash && dash.hwcasSync && /讀不到出席系統，暫時用上次/.test(dash.hwcasSync.line), JSON.stringify(dash.hwcasSync));
  check('★★★★★ 寄出確認窗同一句', /讀不到出席系統/.test(gas.readHwcasNoticeForSend_()));
  check('★★★★ apiSyncPeopleFromHwcas 唔拋', gas.apiSyncPeopleFromHwcas({ force: true }).ok === false);
  gas.SpreadsheetApp.openById = origOpen;
  gas.runHwcasSyncSafely_({ force: true });
  const dash2 = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 讀得到之後：「電郵已由出席系統更新（今日 HH:mm）」', /電郵已由出席系統更新（今日 \d{2}:\d{2}）/.test(dash2.hwcasSync.line), dash2.hwcasSync.line);
  check('★★★★★ 「N 位收不到電郵」：P9705（出席系統冇電郵）＋P9707（冇電郵）⇒ 2；冇編號 1 位', dash2.peopleEmailGaps.noEmail === 2 && dash2.peopleEmailGaps.unlinked === 1, JSON.stringify(dash2.peopleEmailGaps));
}

console.log('\n=== EG3：出席系統連結 ===');
{
  const p = gas.apiHwcasLinkPreview();
  check('（準備）ok', p.ok === true, JSON.stringify(p).slice(0, 300));
  const u = p.unlinked[0];
  check('★★★★★★ 一、沒有會眾編號：P9704，附出席系統同名候選人（編號 00009）', p.unlinked.length === 1 && u.personId === 'P9704'
    && u.candidates.length === 1 && u.candidates[0].memberNo === '00009' && u.candidates[0].emailMasked.indexOf('@') !== -1 && u.candidates[0].emailMasked !== 'p9704-h@example.invalid', JSON.stringify(u));
  check('★★★★★ 二、找不到編號：P9703；三、重複：00006；四、出席系統沒有電郵：P9705',
    p.notFound.length === 1 && p.notFound[0].personId === 'P9703' && p.duplicates.length === 1 && p.noEmailInHwcas.length === 1 && p.noEmailInHwcas[0].personId === 'P9705', JSON.stringify(p.counts));
  const r = gas.apiHwcasLinkSelected([{ personId: 'P9704', memberNo: '00009' }]);
  check('★★★★★★ 連結：只寫 MemberNo，名字不變，之後即時更新電郵', r.ok && r.linked.length === 1 && rowOf('P9704')[M.MEMBER_NO] === "'00009"
    && rowOf('P9704')[M.NAME_TC] === NAME('P9704') && rowOf('P9704')[M.EMAIL] === 'p9704-h@example.invalid' && r.sync && r.sync.ok, JSON.stringify([r, rowOf('P9704')]));
  const bad = gas.apiHwcasLinkSelected([{ personId: 'P9703', memberNo: '00001' }]);
  check('★★★★★ 編號已經係另一位嘅 ⇒ 略過並講明', bad.ok && bad.linked.length === 0 && bad.skipped.length === 1 && /已經/.test(bad.skipped[0].reason), JSON.stringify(bad));
  check('★★★★ 一位都冇勾 ⇒ 唔寫', gas.apiHwcasLinkSelected([]).ok === false);
}

console.log('\n=== EG4：加入名單（喺出席系統揀人）===');
{
  const s1 = gas.apiHwcasSearchPeople('新來的人');
  check('★★★★★★ 按姓名搜尋 ⇒ 候選人（編號、遮蔽電郵、最後出席）', s1.ok && s1.candidates.length === 1 && s1.candidates[0].memberNo === '00008'
    && s1.candidates[0].hasEmail && s1.candidates[0].emailMasked !== 'newcomer@example.invalid' && s1.candidates[0].existingPersonId === '', JSON.stringify(s1));
  const s2 = gas.apiHwcasSearchPeople('8');
  check('★★★★★ 按會眾編號搜尋（8 ⇒ 00008）', s2.candidates.length === 1 && s2.candidates[0].memberNo === '00008');
  const s3 = gas.apiHwcasSearchPeople(NAME('P9701'));
  check('★★★★★ 已經喺名單上嘅人 ⇒ 標明 existingPersonId', s3.candidates.length === 1 && s3.candidates[0].existingPersonId === 'P9701', JSON.stringify(s3));
  check('★★★★ 搵唔到 ⇒ 空清單（唔拋）', gas.apiHwcasSearchPeople('不存在的人').candidates.length === 0);

  const added = gas.apiAddPersonFromHwcas({ nameTC: '新來的人（表上寫法）', memberNo: '00008', postId: 'CHAIR', alsoEligible: true });
  check('★★★★★★ 揀一位 ⇒ 新行：NameTC＝職事表寫法、MemberNo、電郵由出席系統來（HWCAS）', added.ok && rowOf(added.personId)
    && rowOf(added.personId)[M.NAME_TC] === '新來的人（表上寫法）' && rowOf(added.personId)[M.MEMBER_NO] === "'00008"
    && rowOf(added.personId)[M.EMAIL] === 'newcomer@example.invalid' && rowOf(added.personId)[M.EMAIL_SOURCE] === 'HWCAS', JSON.stringify([added, rowOf(added.personId)]));
  check('★★★★★ 順帶加入崗位名單', added.eligibilityAdded === 1, JSON.stringify(added));
  const dup = gas.apiAddPersonFromHwcas({ nameTC: '假甲另一個寫法', memberNo: '00001', postId: 'CHAIR' });
  check('★★★★★★ 編號已經喺名單上 ⇒ 不新增、回 existing（提供別名）', dup.ok === false && dup.existing && dup.existing.personId === 'P9701' && dup.canAlias === true && /這是名單上的「/.test(dup.message), JSON.stringify(dup));
  const none = gas.apiAddPersonFromHwcas({ nameTC: '某人', memberNo: '00099', postId: 'CHAIR' });
  check('★★★★★★ 出席系統找不到 ⇒ 不可以新增', none.ok === false && none.notInHwcas === true && /請辦公室先在出席系統加入/.test(none.message), JSON.stringify(none));
  check('★★★★★ 後端冇任何「人手打電郵新增」嘅路：apiAddPersonFromHwcas 唔收 email', !/p\.email/.test(read('src/WebAppHwcas.gs').split('function addPersonFromHwcas_locked_')[1].split('\nfunction ')[0]));
}

console.log('\n=== EG5：絕不讀 E、T 欄 ===');
{
  const bad = readCols.filter((x) => x.c > 4 || x.c + x.nc - 1 > 4);
  check('★★★★★★ 由頭到尾只讀 A–D（Config HWCAS_READ_COLUMNS），冇碰過 E（身份證）同 T（密碼）', readCols.length > 0 && bad.length === 0, JSON.stringify(bad));
  check('★★★★★ 冇任何對出席系統嘅寫入', !/openById\([^)]*\)[\s\S]{0,400}?\.(setValue|setValues|appendRow|insertSheet|deleteSheet)/.test(read('src/HwcasSync.gs') + read('src/WebAppHwcas.gs')));
}

console.log('\n=== EG6：寄出路寄信前同步 ===');
{
  const flow = code(read('src/WebAppFlow.gs'));
  check('★★★★★ 寄給堂委審閱／正式發出／改動後重發三條路寄信前都叫 syncPeopleFromHwcasBeforeSend_()',
    (flow.match(/syncPeopleFromHwcasBeforeSend_\(\);/g) || []).length === 3);
  check('★★★★ 補寄都叫', /syncPeopleFromHwcasBeforeSend_\(\);/.test(code(read('src/WebAppZone4.gs'))));
  check('★★★★★ 三個確認窗都帶 hwcasNotice', (flow.match(/hwcasNotice/g) || []).length >= 3);
  check('★★★★★ 幹事介面載入：主畫面畫好之後先 syncHwcasOnLoad()（唔經 runAction 鎖畫面）',
    /await loadQuarters\(deepLink_\.quarter\);\s*if \(!viewOnly_\) syncHwcasOnLoad\(\);/.test(code(read('src/ui/ScriptBoot.html'))) && /callServerMutating\('apiSyncPeopleFromHwcas', \{ force: true \}\)/.test(code(read('src/ui/ScriptZone3.html'))));
}

console.log('\n=== EG7：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const body = () => ui.document.getElementById('modalBody');
  const acts = () => ui.document.getElementById('modalActions');
  const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];
  let search = { ok: true, keyword: 'ivan', candidates: [] };
  const calls = [];
  ui.callServer = async (name, ...args) => { calls.push({ name, args }); if (name === 'apiHwcasSearchPeople') return JSON.parse(JSON.stringify(search)); return {}; };
  ui.callServerMutating = async (name, ...args) => { calls.push({ name, args }); return { ok: true, personId: 'P9999', message: '已經加入', eligibilityAdded: 1 }; };
  let doneCalls = 0;

  // 找不到
  ui.openAddUnresolvedPerson({ gridText: 'ivan', postId: 'CHAIR', postNameTC: '主席' }, () => { doneCalls++; });
  await tick();
  const t1 = body().textContent;
  check('★★★★★★ 〔加入名單〕喺出席系統搜尋，搜尋格預設填入職事表上嗰個名', calls.some((c) => c.name === 'apiHwcasSearchPeople' && c.args[0] === 'ivan')
    && body().flatten().some((n) => n.tagName === 'INPUT' && n.value === 'ivan'));
  check('★★★★★★ 找不到 ⇒「出席系統找不到這個人」＋臨時幫手／請辦公室先在出席系統加入 兩個出路', /出席系統找不到這個人/.test(t1) && /這一季臨時幫手/.test(t1) && /請辦公室先在出席系統加入他/.test(t1), t1.slice(0, 400));
  const inputs = body().flatten().filter((n) => n.tagName === 'INPUT');
  check('★★★★★★ 冇人手輸入電郵嘅格（只有搜尋格）', inputs.length === 1 && t1.indexOf('電郵') !== -1 && !inputs.some((n) => /電郵|email/i.test(n.placeholder || '')), JSON.stringify(inputs.map((n) => n.placeholder)));

  // 搵到一位（未喺名單）
  search = { ok: true, keyword: '新人', candidates: [{ memberNo: '00008', hwcasName: '新人', congregation: '粵語堂', memberType: '會友', emailMasked: 'n***@example.invalid', hasEmail: true, lastAttendance: '2099-01-11', existingPersonId: '', existingNameTC: '' }] };
  ui.openAddUnresolvedPerson({ gridText: '新人', postId: 'CHAIR', postNameTC: '主席' }, () => { doneCalls++; });
  await tick();
  check('★★★★★ 列出候選人：編號、堂會、遮蔽電郵、最後出席', /新人　編號 00008　粵語堂／會友　n\*\*\*@example\.invalid　最後出席 2099-01-11/.test(body().textContent), body().textContent.slice(0, 300));
  btnIn(body(), '就是這一位').fire('click');
  await tick();
  check('★★★★★ 確認窗：名字用職事表寫法、電郵由出席系統讀取', /名字用職事表的寫法「新人」/.test(body().textContent) && /電郵由出席系統讀取/.test(body().textContent), body().textContent.slice(0, 300));
  btnIn(acts(), '加入').fire('click');
  await tick();
  const add = calls.filter((c) => c.name === 'apiAddPersonFromHwcas')[0];
  check('★★★★★★ 加入 ⇒ apiAddPersonFromHwcas({nameTC: 職事表寫法, memberNo}) 而且自動重新檢查', add && add.args[0].nameTC === '新人' && add.args[0].memberNo === '00008' && doneCalls === 1, JSON.stringify(add));

  // 已經喺名單上 ⇒ 別名
  search = { ok: true, keyword: '假甲甲', candidates: [{ memberNo: '00001', hwcasName: '假甲', congregation: '', memberType: '', emailMasked: 'p***@example.invalid', hasEmail: true, lastAttendance: '', existingPersonId: 'P9701', existingNameTC: '假甲' }] };
  ui.openAddUnresolvedPerson({ gridText: '假甲甲', postId: 'CHAIR', postNameTC: '主席' }, () => { doneCalls++; });
  await tick();
  btnIn(body(), '就是這一位（加一個別名）').fire('click');
  await tick();
  check('★★★★★★ 編號已在名單 ⇒「這是名單上的「假甲」」＋〔加一個別名〕', /這是名單上的「假甲」/.test(ui.document.getElementById('modalTitle').textContent) && !!btnIn(acts(), '加一個別名'));
  btnIn(acts(), '加一個別名').fire('click');
  await tick();
  const alias = calls.filter((c) => c.name === 'apiSaveAlias')[0];
  check('★★★★★ 寫 NameAlias（重用 apiSaveAlias）', alias && alias.args[0].alias === '假甲甲' && alias.args[0].personId === 'P9701', JSON.stringify(alias));

  // 狀態卡
  ui.renderTop({ statusText: 'x', latestVersion: null, hwcasSync: { line: '電郵已由出席系統更新（今日 09:00）', errorText: '' }, peopleEmailGaps: { noEmail: 3, unlinked: 1 },
    sendWarnings: null, eligibilityImpact: null, publicLink: {} });
  const hb = ui.document.getElementById('statusHwcas');
  check('★★★★★★ 狀態卡：「電郵已由出席系統更新（今日 09:00）」＋「3 位收不到電郵（…）▸ 進階與診斷 ▸ 出席系統連結」',
    hb && hb.hidden === false && /電郵已由出席系統更新（今日 09:00）/.test(hb.textContent) && /3 位收不到電郵（沒有連結出席系統或者出席系統沒有電郵）▸ 進階與診斷 ▸/.test(hb.textContent) && !!btnIn(hb, '出席系統連結'), hb && hb.textContent);
  check('★★★★★ 進階與診斷嗰行開 openHwcasLink', /zone4Row\('出席系統連結'[\s\S]{0,300}?openHwcasLink\(\)/.test(read('src/ui/ScriptZone4.html')));
  const uiCode = fs.readdirSync(path.join(ROOT, 'src', 'ui')).map((f) => code(read('src/ui/' + f))).join('\n');
  check('★★★★★ 舊「從出席系統補電郵」畫面拿走（前端冇 apiHwcasApplySelected）', uiCode.indexOf('apiHwcasApplySelected') === -1 && uiCode.indexOf("apiAddPersonForUnresolvedName") === -1);

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
