// 第八十七輪批次 NB 組：只可查看的使用者——前端，及唯讀崗位名單的內容。
// 執行方式：node tests/round87_nb_view_only_ui.test.js
//
//   NB7　頁頂「你只有查看權限」；會改動的按鈕變灰、滑鼠停留「你只有查看權限」、按了不做任何事；只看的按鈕照樣可以按
//   NB8　〔開始〕按鈕：預設當作改動，只有列明的唯讀工具可以按；常用設定那兩條試算表連結變灰
//   NB9　callServerMutating 不送出；開機不建立季度、不由出席系統更新電郵；狀態卡不畫試算表連結
//   NB10　〔開啟名單工作表〕⇒ 唯讀視窗「崗位名單（只可查看）」；可以修改的人照舊開試算表
//   NB11　〔查看／修改職事表〕⇒ 公開職事表；沒有公開連結 ⇒「這一季還沒有公開職事表」
//   NB12　唯讀崗位名單的內容：每個崗位一段；「堂委」寫明現任；暫時不做的人註明
// 下面用假資料（P97xx、example.invalid），不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UI = ['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html'];
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  const ui = loadUiScripts(UI);
  vm.runInContext("currentQuarterId = '2099T3'; runAction = async function (l, fn) { await fn(); };", ui);
  const buttons = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON');
  const byText = (node, t) => buttons(node).filter((b) => b.textContent === t)[0];

  console.log('\n=== NB7：灰色按鈕 ===');
  ui.setViewOnly_(true);
  const banner = ui.document.getElementById('viewOnlyBanner');
  check('★★★★★★ 頁頂「你只有查看權限」', banner.hidden === false && /^你只有查看權限/.test(banner.textContent), banner.textContent);
  const blocked = ['儲存', '請系統幫我調整', '給所有人', '變動的人', '選擇其他', '寄給堂委／執事', '寄出', '加入', '取消這一筆',
    '儲存並套用名單', '生成初稿', '確定發出', '確定重發', '接受這個建議版本', '用這一版作起點', '查看這一版', '寄出上一個版本（第 2 版）', '下載及匯出'];
  let clicked = 0;
  const bad = blocked.filter((t) => {
    const b = ui.button(t, () => { clicked++; }, '');
    b.fire('click');
    return !(b.disabled === true && b.title === '你只有查看權限' && /view-only-blocked/.test(b.className));
  });
  check('★★★★★★ 會改動的按鈕：灰色、滑鼠停留「你只有查看權限」', bad.length === 0, bad.join('、'));
  check('★★★★★★ 按了不做任何事（之後有人把它設回可按也一樣）', clicked === 0);
  const again = ui.button('儲存', () => { clicked++; }, '');
  again.disabled = false;
  again.fire('click');
  check('★★★★★ 設回可按再按 ⇒ 仍然不做，狀態列寫「你只有查看權限，不可以改動。」', clicked === 0
    && /你只有查看權限，不可以改動。/.test(ui.document.getElementById('status').textContent));
  const allowed = ['寄出季前資料', '不能服侍的日期', '排表偏好', '合堂主日', '人手檢查', '關閉', '取消', '知道了', '檢查我的改動',
    '開啟名單工作表', '查看／修改職事表', '複製連結', '全部列出', '出席系統連結', '加入名單', '修改'];
  const badAllowed = allowed.filter((t) => { const b = ui.button(t, () => { clicked++; }, ''); b.fire('click'); return b.disabled; });
  check('★★★★★★ 只看的按鈕照樣可以按（打開畫面、內容照樣顯示）', badAllowed.length === 0 && clicked === allowed.length, badAllowed.join('、'));
  const sb = ui.stepButton('請系統幫我調整', () => {}, { title: '原本的原因', disabled: false });
  check('★★★★★ stepButton 帶 title ⇒ 仍然寫「你只有查看權限」', sb.disabled === true && sb.title === '你只有查看權限', sb.title);

  console.log('\n=== NB8：〔開始〕按鈕、常用設定的試算表連結 ===');
  const row = (name) => buttons(ui.zone4Row(name, '說明', () => {}, false))[0];
  check('★★★★★★ 整季重設、匯出規則審閱表、建立未來季度、核對職事表 ⇒ 灰色', ['整季重設', '匯出規則審閱表', '建立未來季度', '核對職事表']
    .every((n) => row(n).disabled === true && row(n).title === '你只有查看權限'));
  check('★★★★★ 列出待補格子、草稿覆核報告、名單檢查、出席系統連結 ⇒ 可以按', ['列出待補格子', '草稿覆核報告（給堂委看）', '名單檢查', '出席系統連結']
    .every((n) => row(n).disabled === false));
  const link = ui.settingsSheetLink('身分（堂委／執事）', 'https://example.invalid/sheet', 'Roles');
  check('★★★★★ 常用設定〔身分（堂委／執事）〕不畫試算表連結，改為灰色按鈕', link.tagName === 'BUTTON' && link.disabled === true && link.title === '你只有查看權限');

  console.log('\n=== NB9：不送出改動、開機、狀態卡 ===');
  let err = null;
  const raw = [];
  ui.callServerRaw_ = async (name) => { raw.push(name); return 'SENT'; };  // 改壞了會即刻回來（不會一直等）
  try { await ui.callServerMutating('apiSaveCombinedServices', '2099T3', []); } catch (e) { err = e; }
  check('★★★★★★ callServerMutating ⇒ 沒有送去伺服器', raw.length === 0, raw.join());
  check('★★★★★★ callServerMutating ⇒ 不送出，「你只有查看權限，不可以改動。」', err && err.message === '你只有查看權限，不可以改動。', err && err.message);
  const calls = [];
  ui.callServer = async (name) => { calls.push(name); return name === 'apiListQuarters' ? [{ quarterId: '2099T3', label: 'x' }] : {}; };
  vm.runInContext('loadDashboard = async function () {};', ui);
  ui.callServerRaw_ = async (name) => { calls.push('RAW:' + name); return {}; };
  await ui.loadQuarters(null);
  check('★★★★★★ 只可查看 ⇒ 開機不建立季度（apiEnsureFutureQuarters）', calls.indexOf('RAW:apiEnsureFutureQuarters') === -1 && calls.indexOf('apiListQuarters') !== -1, calls.join());
  check('★★★★★ 開機：只可查看 ⇒ 不由出席系統更新電郵', /if \(!viewOnly_\) syncHwcasOnLoad\(\);/.test(read('src/ui/ScriptBoot.html')));
  check('★★★★★ 狀態卡：只可查看 ⇒ 不畫「開啟職事表」（試算表）', /if \(v && v\.sheetUrl && !viewOnly_\) \{/.test(read('src/ui/Script.html')));
  ui.callServer = async (name) => (name === 'apiGetMyPermission' ? { role: 'EDITOR', canModify: true } : {});
  await ui.loadMyPermission_();
  check('★★★★★ apiGetMyPermission＝可以修改 ⇒ 不是只可查看，頁頂那句收起', vm.runInContext('viewOnly_', ui) === false && banner.hidden === true);
  const ed = ui.button('儲存', () => {}, '');
  check('★★★★★★ 可以修改的人：〔儲存〕照舊可以按', ed.disabled === false && !/view-only-blocked/.test(ed.className));
  ui.callServer = async (name) => (name === 'apiGetMyPermission' ? { role: 'VIEWER', canModify: false } : {});
  await ui.loadMyPermission_();
  check('★★★★★ apiGetMyPermission＝只可查看 ⇒ 只可查看', vm.runInContext('viewOnly_', ui) === true);

  console.log('\n=== NB10：〔開啟名單工作表〕 ===');
  const sent = [];
  ui.callServer = async (name, q) => {
    sent.push(name);
    return { quarterLabel: '2099年7-9月', posts: [
      { postNameTC: '領詩', roleTexts: ['堂委（現任 2 位：假甲、假庚）'], names: ['假乙', '假丙（暫時不做這個崗位）'], excluded: ['假丙（原因：休息）'] },
      { postNameTC: '讀經', roleTexts: [], names: [], excluded: [] }] };
  };
  ui.callServerMutating = async (name) => { sent.push('MUT:' + name); return {}; };
  ui.openEligibilitySheet();
  await tick();
  const title = ui.document.getElementById('modalTitle').textContent;
  const body = ui.document.getElementById('modalBody').textContent;
  check('★★★★★★ 只可查看 ⇒ 不開試算表（沒有呼叫 apiOpenEligibilitySheet），開唯讀視窗', title === '崗位名單（只可查看）'
    && sent.indexOf('apiGetEligibilityViewOnly') !== -1 && sent.indexOf('MUT:apiOpenEligibilitySheet') === -1, title + '｜' + sent.join());
  check('★★★★★★ 每個崗位一段：名字、「堂委」現任、暫時不做', /領詩/.test(body) && /堂委（現任 2 位：假甲、假庚）/.test(body)
    && /假乙、假丙（暫時不做這個崗位）/.test(body) && /暫時不做這個崗位：假丙（原因：休息）/.test(body) && /讀經（名單上沒有人）/.test(body), body);
  check('★★★★★ 唯讀視窗只有〔關閉〕', buttons(ui.document.getElementById('modalActions')).map((b) => b.textContent).join() === '關閉');

  console.log('\n=== NB11：〔查看／修改職事表〕 ===');
  const d = { latestVersion: { versionNo: 2, sheetUrl: 'https://docs.google.com/spreadsheets/d/MAIN/edit' }, versionChoices: [] };
  let card = ui.renderStep2(d, { permanentLink: { hasLink: true, url: 'https://docs.google.com/spreadsheets/d/PUBLIC/preview' }, suggestion: {} });
  const a = card.flatten().filter((n) => n.tagName === 'A' && n.textContent === '查看／修改職事表')[0];
  check('★★★★★★ 只可查看 ⇒ 開公開職事表（唯讀連結），不是主試算表', a && a.href === 'https://docs.google.com/spreadsheets/d/PUBLIC/preview' && a.target === '_blank',
    a && a.href);
  card = ui.renderStep2(d, { permanentLink: { hasLink: false }, suggestion: {} });
  check('★★★★★★ 沒有公開連結 ⇒「這一季還沒有公開職事表」，沒有試算表連結', /這一季還沒有公開職事表/.test(card.textContent)
    && !card.flatten().some((n) => n.tagName === 'A' && /MAIN/.test(n.href || '')));
  ui.setViewOnly_(false);
  card = ui.renderStep2(d, { permanentLink: { hasLink: true, url: 'https://docs.google.com/spreadsheets/d/PUBLIC/preview' }, suggestion: {} });
  const a2 = card.flatten().filter((n) => n.tagName === 'A' && n.textContent === '查看／修改職事表')[0];
  check('★★★★★ 可以修改的人 ⇒ 照舊開主試算表', a2 && /MAIN/.test(a2.href), a2 && a2.href);

  console.log('\n=== NB12：唯讀崗位名單的內容（伺服器）===');
  {
    const sc = buildRound75Scene({ extraFiles: ['WebAppEligibility.gs'] });
    const g = sc.gas; const C = sc.C; const S = sc.S;
    const R = C.ROLES;
    seedSheet(sc.ss, S.ROLES, ['R'], Object.keys(R).map((k) => R[k]), [
      { [R.PERSON_ID]: 'P9701', [R.ROLE_CODE]: 'COMMITTEE', [R.EFFECTIVE_FROM]: '2020-01-01', [R.ACTIVE]: true },
      { [R.PERSON_ID]: 'P9707', [R.ROLE_CODE]: 'COMMITTEE', [R.EFFECTIVE_FROM]: '2020-01-01', [R.ACTIVE]: true }]);
    const E = C.ELIGIBILITY;
    sc.appendRows(sc.ss, S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
      [{ [E.ELIGIBILITY_ID]: 'ER', [E.PERSON_ID]: 'ROLE:COMMITTEE', [E.POST_ID]: 'WORSHIP', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
    const X = C.PERSON_POST_EXCLUSIONS;
    seedSheet(sc.ss, S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]),
      [{ [X.PERSON_ID]: 'P9703', [X.POST_ID]: 'CHAIR', [X.REASON]: '堂委會決定', [X.ACTIVE]: true }]);
    const r = g.buildEligibilityViewOnly_(sc.Q, '2098-12-10');
    const post = (n) => r.posts.filter((p) => p.postNameTC === n)[0];
    check('★★★★★ 每個自動排的崗位一段', r.posts.length > 0 && r.posts.every((p) => Array.isArray(p.names)), JSON.stringify(r.posts.map((p) => p.postNameTC)));
    check('★★★★★★ 「堂委」寫明現任是誰', /^堂委（現任 2 位：假甲、假庚）$/.test((post('領詩') || {}).roleTexts.join()), JSON.stringify(post('領詩')));
    check('★★★★★★ 暫時不做這個崗位的人註明', (post('主席').names || []).indexOf('假丙（暫時不做這個崗位）') !== -1
      && (post('主席').excluded || []).join() === '假丙（原因：堂委會決定）', JSON.stringify(post('主席')));
    check('★★★★★ apiGetEligibilityViewOnly 是唯讀 api（只可查看的人可以用）', /function apiGetEligibilityViewOnly\(quarterId\) \{\s*assertWebAppRequestAllowed_\('apiGetEligibilityViewOnly'\);/.test(read('src/WebAppEligibility.gs')));
  }

  console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
  process.exitCode = fail === 0 ? 0 : 1;
})();
