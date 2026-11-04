// 第九十五輪批次 VE 組：第九十四輪觀察 1–3。
// 執行方式：node tests/round95_ve_unavailable_observations.test.js
//
//   VE1 由申報建立的 Unavailable 被幹事取消（或那一行已經不在）⇒ 個人頁「我已申報的日子」寫「幹事已取消」，
//       方格回復可以再申報（可以再提交）；工作表的 Status 不改、不寄信
//   VE2 〔不能服侍的日期〕清單、確認畫面、季前資料第四段：「指定崗位：」寫崗位名稱（多個用「、」），找不到崗位才寫編號
//   VE3 黃框：「系統沒有「上半場不在」這種概念。填了就代表那一日（或所選的崗位）整日不能服侍。」
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildUnavailableScene, tok, T1 } = require('./helpers/unavailable_scene.js');
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

function setUnavailableStatus(sc, unavailableId, status) {
  const sh = sc.ss.getSheetByName(sc.S.UNAVAILABLE);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = keys.indexOf(sc.C.UNAVAILABLE.UNAVAILABLE_ID) + 1;
  const stCol = keys.indexOf(sc.C.UNAVAILABLE.STATUS) + 1;
  for (let r = 3; r <= sh.getLastRow(); r++) {
    if (String(sh.getRange(r, idCol).getValue()) === unavailableId) { sh.getRange(r, stCol).setValue(status); return true; }
  }
  return false;
}

console.log('\n=== VE1：幹事取消了由申報建立的紀錄 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0], T1[1]], 'test', []);
  const ids = sc.subs().filter((s) => s.personId === 'P9701').map((s) => s.submissionId);
  g.decideUnavailableSubmissions_(ids, 'ACCEPT', 'clerk@example.invalid');
  const linked = sc.subs().filter((s) => s.personId === 'P9701' && s.serviceDate === T1[0])[0];
  let v = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
  const row0 = () => v.submissions.filter((s) => s.serviceDate === T1[0])[0];
  const day0 = () => v.quarters[0].dates.filter((d) => d.serviceDate === T1[0])[0];
  check('（前置）確認之後：「已確認了你的申請」、方格「已確認」', row0().statusText === '已確認了你的申請' && day0().status === 'ACCEPTED' && !!linked.unavailableId);
  const mailsBefore = sc.mails.length;
  check('（前置）找到那一行 Unavailable 並取消', setUnavailableStatus(sc, linked.unavailableId, 'CANCELLED'));
  v = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
  check('★★★★★★ VE1 我已申報的日子：「幹事已取消」（不是「已確認了你的申請」）', row0().statusText === '幹事已取消' && row0().status === 'CANCELLED', JSON.stringify(row0()));
  check('★★★★★★ VE1 方格回復可以再申報（狀態空白）', day0().status === '', JSON.stringify(day0()));
  check('★★★★★ VE1 沒有被取消的那一日仍然「已確認」', v.submissions.filter((s) => s.serviceDate === T1[1])[0].statusText === '已確認了你的申請');
  check('★★★★★ VE1 幹事已取消的不可以撤回（canWithdraw false）', row0().canWithdraw === false);
  check('★★★★★★ VE1 工作表的 Status 不改（仍然 ACCEPTED）', sc.subs().filter((s) => s.submissionId === linked.submissionId)[0].status === 'ACCEPTED');
  check('★★★★★★ VE1 不寄信', sc.mails.length === mailsBefore);
  const r = g.personalSubmitUnavailable(tok(1), '', [T1[0]], '再申報', []);
  check('★★★★★★ VE1 那一日可以再申報（提交成功）', r.ok === true && r.added === 1, JSON.stringify(r).slice(0, 300));
  v = r.view;
  check('★★★★★ VE1 再申報之後方格「等候確認」，清單兩行（幹事已取消＋等候確認）', day0().status === 'PENDING'
    && v.submissions.filter((s) => s.serviceDate === T1[0]).map((s) => s.statusText).sort().join(',') === '幹事已取消,等候確認',
    JSON.stringify(v.submissions.filter((s) => s.serviceDate === T1[0])));
  // 那一行已經不在（例如整季重設刪了）⇒ 也是「幹事已取消」
  const sc2 = buildUnavailableScene();
  const g2 = sc2.gas;
  g2.personalSubmitUnavailable(tok(2), '', [T1[2]], '', []);
  g2.decideUnavailableSubmissions_(sc2.subs().map((s) => s.submissionId), 'ACCEPT', 'clerk@example.invalid');
  const uid = sc2.subs()[0].unavailableId;
  setUnavailableStatus(sc2, uid, 'ACTIVE');
  const sh = sc2.ss.getSheetByName(sc2.S.UNAVAILABLE);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = keys.indexOf(sc2.C.UNAVAILABLE.UNAVAILABLE_ID) + 1;
  for (let r2 = 3; r2 <= sh.getLastRow(); r2++) if (String(sh.getRange(r2, idCol).getValue()) === uid) sh.getRange(r2, idCol).setValue('U-OTHER');
  const v2 = g2.buildPersonalUnavailableView_('P9702', sc2.today, sc2.TZ);
  check('★★★★★ VE1 連結的 Unavailable 已經不在 ⇒ 也寫「幹事已取消」', v2.submissions[0].statusText === '幹事已取消');
  // 前端：狀態寫伺服器的字；不是 ACCEPTED ⇒ 不寫「如需取消，請聯絡幹事」
  const page = read('src/ui/PersonalRoster.html');
  check('★★★★ 個人頁照寫伺服器的 statusText；「如需取消，請聯絡幹事」只限 ACCEPTED', /el\('td', s\.statusText/.test(page)
    && /else if \(s\.status === 'ACCEPTED'\) \{\s*st\.appendChild\(el\('div', '如需取消，請聯絡幹事'/.test(page));
}

console.log('\n=== VE2：崗位名稱 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  const U = sc.C.UNAVAILABLE;
  sc.appendRows(sc.ss, sc.S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [
    { [U.UNAVAILABLE_ID]: 'UX1', [U.PERSON_ID]: 'P9703', [U.DATE_FROM]: T1[1], [U.DATE_TO]: T1[1], [U.SOURCE]: 'WEBUI',
      [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'POSTS', [U.POST_IDS]: 'READ,CHAIR,NOPOST', [U.REASON]: 'test 95' },
    { [U.UNAVAILABLE_ID]: 'UX2', [U.PERSON_ID]: 'P9704', [U.DATE_FROM]: T1[2], [U.DATE_TO]: T1[2], [U.SOURCE]: 'WEBUI',
      [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL', [U.POST_IDS]: '', [U.REASON]: '' }]);
  const names = {};
  g.readPostsNormalized_({ includeGroups: true }).forEach((p) => { names[p.postId] = p.postNameTC; });
  const want = names.READ + '、' + names.CHAIR + '、NOPOST';
  const list = g.apiListUnavailable('2099T1', '');
  const ux1 = list.current.filter((r) => r.unavailableId === 'UX1')[0];
  check('★★★★★★ VE2 apiListUnavailable：postsText 寫崗位名稱（多個用「、」），找不到才寫編號', ux1 && ux1.postsText === want, ux1 && ux1.postsText);
  check('★★★★ VE2 postIds 照舊（修改畫面用）', ux1 && ux1.postIds.join(',') === 'READ,CHAIR,NOPOST');
  check('★★★★ describePostNamesById_ 純函式', g.describePostNamesById_(['READ', 'X'], { READ: '讀經' }) === '讀經、X' && g.describePostNamesById_([], {}) === '');

  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html', 'ScriptZone4.html',
    'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  const rowNode = ui.unavailableRow(Object.assign({ personName: '假丙' }, ux1));
  check('★★★★★★ VE2 清單那一行：「指定崗位：讀經、主席、NOPOST」（不是編號）', rowNode.textContent.indexOf('指定崗位：' + want) !== -1
    && rowNode.textContent.indexOf('READ') === -1, rowNode.textContent);
  vm.runInContext('unavailableData = ' + JSON.stringify(list) + ';', ui);
  check('★★★★★★ VE2 新增／修改的確認畫面：崗位名稱', ui.unavailablePostNames_(['READ', 'CHAIR', 'NOPOST']) === want, ui.unavailablePostNames_(['READ', 'CHAIR', 'NOPOST']));
  check('★★★★ VE2 確認畫面用 unavailablePostNames_', /'指定崗位：' \+ unavailablePostNames_\(payload\.postIds\)/.test(read('src/ui/ScriptZone3.html')));

  const pack = g.buildPreseasonPack_('2099T1', sc.today, '');
  const s4 = pack.sections.filter((s) => s.title === '四、不能服侍的日期')[0];
  const line3 = s4.lines.filter((l) => l.indexOf(sc.nameOf('P9703')) === 0)[0];
  const line4 = s4.lines.filter((l) => l.indexOf(sc.nameOf('P9704')) === 0)[0];
  check('★★★★★★ VE2 季前資料第四段：只限崗位的一行寫「指定崗位：崗位名稱」', line3 && line3.indexOf('　指定崗位：' + want) !== -1, line3);
  check('★★★★★ VE2 季前資料第四段：全部崗位的一行不加崗位', line4 && line4.indexOf('指定崗位') === -1, line4);
}

console.log('\n=== VE3：黃框字眼 ===');
{
  const z3 = read('src/ui/ScriptZone3.html');
  check('★★★★★★ VE3 黃框新字眼（第一百零一輪 ZA-2 刪去「系統沒有…概念」一句）', z3.indexOf("text: '填了就代表那一日（或所選的崗位）整日不能服侍。'") !== -1 && z3.indexOf('這種概念') === -1);
  check('★★★★★ VE3 舊字眼已經沒有', z3.indexOf('填了就代表整日不能服侍。') === -1);
  check('★★★★ VE3 規格文件同步', read('docs/幹事介面規格.md').indexOf('填了就代表那一日（或所選的崗位）整日不能服侍。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
