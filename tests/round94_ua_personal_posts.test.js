// 第九十四輪批次 UA 組：個人頁「申報不能服侍的日子」加選崗位（D4）。
// 執行方式：node tests/round94_ua_personal_posts.test.js
//
//   UA1 崗位清單：只列這個人這一季可以服侍的崗位（事奉人員表＋領詩／司琴；不列人手填寫、名單組別的詩班）；
//       名單寫「堂委」的崗位按這一季第一個主日的身分展開
//   UA2 提交：全部崗位（PostIDs 空白）；只限崗位（子集）；伺服器重新計算並拒絕不在清單的崗位、跨季、格式錯
//   UA3 確認後建立的 Unavailable：只限崗位 ⇒ AppliesTo＝POSTS＋PostIDs；全部 ⇒ ALL
//   UA4 生成、調整、人手檢查讀 Unavailable 時只避開那些崗位（真正行生成）
//   UA5 原有限制照舊（每次最多 20 個日子、原因去 HTML、公開函式只有兩個）；「我已申報的日子」有崗位及已撤回
//   UA6 個人頁：手機寬度沒有橫向捲動（靜態檢查 CSS）、方格、全選這個月、全部崗位／只限以下崗位、提示句
// 下面用假 ID（P97xx）、假名、假 token。

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

function sceneWithRoles() {
  const role = (id, p, code, from, to) => ({ RoleAssignmentID: id, PersonID: p, RoleCode: code, EffectiveFrom: from, EffectiveTo: to || '', Active: true });
  const sc = buildUnavailableScene({ roles: [role('R1', 'P9706', 'COMMITTEE', '2099-01-01'), role('R2', 'P9705', 'COMMITTEE', '2099-03-01')] });
  const E = sc.C.ELIGIBILITY;
  sc.appendRows(sc.ss, sc.S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
    [{ [E.ELIGIBILITY_ID]: 'ER1', [E.PERSON_ID]: 'ROLE:COMMITTEE', [E.POST_ID]: 'WORSHIP', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
  return sc;
}

console.log('\n=== UA1：崗位清單 ===');
{
  const sc = sceneWithRoles();
  const g = sc.gas;
  const v1 = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
  const posts1 = v1.quarters[0].posts.map((p) => p.postId);
  check('★★★★★★ 只列這個人這一季可以服侍的崗位（P9701：主席、讀經、領詩）', posts1.join() === 'CHAIR,READ,WORSHIP', JSON.stringify(v1.quarters[0].posts));
  check('★★★★★ 不列人手填寫的崗位（獻花、講員）', posts1.indexOf('FLOWER') === -1 && posts1.indexOf('PREACH') === -1);
  check('★★★★ 帶崗位中文名', v1.quarters[0].posts.every((p) => p.postNameTC && p.postNameTC !== p.postId));
  const v6 = g.buildPersonalUnavailableView_('P9706', sc.today, sc.TZ);
  check('★★★★★★ 名單寫「堂委」的崗位按第一個主日的身分展開：P9706 在 T1 第一個主日是堂委 ⇒ 有領詩', v6.quarters[0].posts.map((p) => p.postId).indexOf('WORSHIP') !== -1,
    JSON.stringify(v6.quarters[0].posts));
  const v5 = g.buildPersonalUnavailableView_('P9705', sc.today, sc.TZ);
  const p5 = v5.quarters[0].posts.map((p) => p.postId);
  const direct5 = g.readEligibility_().byPost.WORSHIP || [];
  check('★★★★★ 第一個主日之後才是堂委（P9705 由 3 月起）⇒ T1 沒有領詩（不在名單上，只經身分）', direct5.indexOf('P9705') === -1 && p5.indexOf('WORSHIP') === -1 && p5.indexOf('READ') !== -1, JSON.stringify(p5));
  // 詩班（名單組別）不列
  g.SpreadsheetApp.getUi = () => ({ ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES' }, alert: () => 'YES' });
  g.runSeedPostShowInRoster_ && g.runSeedPostShowInRoster_();
  if (g.runCreateChoirGroup_) {
    g.runCreateChoirGroup_();
    const E = sc.C.ELIGIBILITY;
    sc.appendRows(sc.ss, sc.S.ELIGIBILITY, [E.ELIGIBILITY_ID, E.PERSON_ID, E.POST_ID, E.ELIGIBLE, E.ACTIVE],
      [{ [E.ELIGIBILITY_ID]: 'EC1', [E.PERSON_ID]: 'P9701', [E.POST_ID]: 'CHOIR', [E.ELIGIBLE]: true, [E.ACTIVE]: true }]);
    const vc = g.buildPersonalUnavailableView_('P9701', sc.today, sc.TZ);
    check('★★★★★ 不列只作名單組別的詩班', vc.quarters[0].posts.every((p) => p.postId !== 'CHOIR'), JSON.stringify(vc.quarters[0].posts));
  }
}

console.log('\n=== UA2：提交 ===');
{
  const sc = sceneWithRoles();
  const g = sc.gas;
  let r = g.personalSubmitUnavailable(tok(1), '', [T1[0]], '出外', []);
  check('★★★★★★ 全部崗位（空陣列）⇒ PostIDs 空白；訊息「（全部崗位），等候確認」', r.ok && sc.subs()[0].postIds.length === 0
    && /已提交 1 個日子（全部崗位），等候確認。/.test(r.message), JSON.stringify(r).slice(0, 300));
  r = g.personalSubmitUnavailable(tok(1), '', [T1[1], T1[2]], '', ['READ', 'CHAIR']);
  const two = sc.subs().filter((s) => s.serviceDate === T1[1] || s.serviceDate === T1[2]);
  check('★★★★★★ 只限崗位 ⇒ 兩行都寫 PostIDs（讀經、主席）', r.ok && two.length === 2 && two.every((s) => s.postIds.join() === 'READ,CHAIR'), JSON.stringify(two));
  check('★★★★★ 訊息「已提交 2 個日子（崗位：讀經、主席），等候確認。」', r.message === '已提交 2 個日子（崗位：讀經、主席），等候確認。', r.message);
  const before = sc.subs().length;
  r = g.personalSubmitUnavailable(tok(1), '', [T1[3]], '', ['FLOWER']);
  check('★★★★★★ 不在這個人這一季可以服侍的崗位（獻花）⇒ 拒絕，甚麼都不寫', !r.ok && /不在名單上的崗位/.test(r.message) && sc.subs().length === before, r.message);
  r = g.personalSubmitUnavailable(tok(1), '', [T1[3]], '', ['P9999']);
  check('★★★★★ 亂寫的崗位編號 ⇒ 拒絕', !r.ok && sc.subs().length === before);
  r = g.personalSubmitUnavailable(tok(1), '', [T1[3], T2[0]], '', ['READ']);
  check('★★★★★ 只限崗位而日子跨兩季 ⇒ 拒絕（請分開提交）', !r.ok && /同一季/.test(r.message) && sc.subs().length === before, r.message);
  r = g.personalSubmitUnavailable(tok(1), '', [T1[3]], '', 'READ');
  check('★★★★ 崗位不是陣列 ⇒ 拒絕', !r.ok && sc.subs().length === before);
  r = g.personalSubmitUnavailable(tok(1), '', [T1[3]], '');
  check('★★★★ 沒有傳崗位（舊頁面）⇒ 全部崗位', r.ok && sc.subs().filter((s) => s.serviceDate === T1[3])[0].postIds.length === 0);
  const view = r.view;
  const listed = view.submissions.filter((s) => s.serviceDate === T1[1])[0];
  check('★★★★★ 「我已申報的日子」：崗位（讀經、主席）、狀態「等候確認」、可以撤回', listed.postsText === '讀經、主席' && listed.statusText === '等候確認' && listed.canWithdraw,
    JSON.stringify(listed));
  const all = view.submissions.filter((s) => s.serviceDate === T1[0])[0];
  check('★★★★ 全部崗位那一項寫「全部崗位」', all.postsText === '全部崗位');
  const ws = g.personalWithdrawUnavailable(tok(1), '', listed.submissionId);
  check('★★★★★ 撤回之後仍然列出，狀態「已撤回」', ws.ok && ws.view.submissions.some((s) => s.submissionId === listed.submissionId && s.statusText === '已撤回'));
  const audit = sc.audits('PERSONAL_UNAVAILABLE_SUBMITTED');
  check('★★★★ AuditLog 寫崗位、不寫 token', audit.some((a) => /讀經、主席/.test(a.Notes)) && JSON.stringify(audit).indexOf(tok(1)) === -1);
}

console.log('\n=== UA3／UA4：確認後的 Unavailable；生成只避開那些崗位 ===');
{
  const sc = sceneWithRoles();
  const g = sc.gas;
  g.personalSubmitUnavailable(tok(1), '', [T1[0]], '', ['READ']);
  g.personalSubmitUnavailable(tok(2), '', [T1[1]], '', []);
  const ids = sc.subs().map((s) => s.submissionId);
  g.decideUnavailableSubmissions_(ids, 'ACCEPT', 'clerk@example.invalid');
  const U = sc.C.UNAVAILABLE;
  const rows = sc.unav();
  const r1 = rows.filter((r) => r[U.PERSON_ID] === 'P9701')[0];
  const r2 = rows.filter((r) => r[U.PERSON_ID] === 'P9702')[0];
  check('★★★★★★ 只限崗位 ⇒ AppliesTo＝POSTS、PostIDs＝READ', r1 && r1[U.APPLIES_TO] === 'POSTS' && String(r1[U.POST_IDS]) === 'READ', JSON.stringify(r1));
  check('★★★★★★ 全部崗位 ⇒ AppliesTo＝ALL、PostIDs 空白', r2 && r2[U.APPLIES_TO] === 'ALL' && String(r2[U.POST_IDS] || '') === '', JSON.stringify(r2));
  const norm = g.readUnavailableNormalized_(sc.TZ);
  check('★★★★★★ 生成用的判斷：P9701 在那一日不可以做讀經，但可以做主席', g.isPersonUnavailable_('P9701', T1[0], 'READ', norm) === true
    && g.isPersonUnavailable_('P9701', T1[0], 'CHAIR', norm) === false);
  check('★★★★★ 全部崗位：P9702 那一日任何崗位都不可以', g.isPersonUnavailable_('P9702', T1[1], 'READ', norm) && g.isPersonUnavailable_('P9702', T1[1], 'CHAIR', norm));
  // 真正生成
  g.apiGenerateDraftExecute(sc.Q);
  const A = sc.C.ROSTER_ASSIGNMENTS;
  const asg = g.readSheet_(sc.S.ROSTER_ASSIGNMENTS).map((r) => ({ d: g.toDateString_(r[A.SERVICE_DATE], sc.TZ), post: r[A.POST_ID], p: r[A.PERSON_ID] }));
  check('★★★★★★ 生成：P9701 在 ' + T1[0] + ' 沒有被排讀經', asg.length > 0 && !asg.some((x) => x.d === T1[0] && x.post === 'READ' && x.p === 'P9701'), JSON.stringify(asg.filter((x) => x.d === T1[0])));
  check('★★★★★★ 生成：P9702 在 ' + T1[1] + ' 沒有被排任何崗位', !asg.some((x) => x.d === T1[1] && x.p === 'P9702'));
  // 人手檢查同樣讀 AppliesTo／PostIDs
  const st = g.buildStaffingContext_(sc.Q);
  check('★★★★★ 人手檢查的資料帶 appliesTo／postIds（同一支 readUnavailableNormalized_）', (st.unavailable || []).some((u) => u.personId === 'P9701' && u.appliesTo === 'POSTS' && u.postIds.join() === 'READ'),
    JSON.stringify(st.unavailable || []).slice(0, 300));
}

console.log('\n=== UA5：原有限制照舊 ===');
{
  const sc = buildUnavailableScene();
  const g = sc.gas;
  // 第一百零五輪批次 RB 組（刻意加）：〔我這一季沒有不能服侍的日子〕
  check('★★★★★★ 個人連結公開函式只有提交、撤回、回覆「沒有」', JSON.stringify(g.PERSONAL_LINK_PUBLIC_APIS) === '["personalSubmitUnavailable","personalWithdrawUnavailable","personalReplyNoUnavailable"]');
  const src = read('src/PersonalUnavailable.gs');
  check('★★★★★ 提交函式第一句仍然是 assertPersonalLinkCaller_(token)', /function personalSubmitUnavailable\(token, quarterId, dates, reason, postIds\) \{\s*const person = assertPersonalLinkCaller_\(token\);/.test(src));
  const many = [];
  for (let i = 0; i < 21; i++) many.push(T1[0]);
  check('★★★★ 每次最多 20 個日子（重複的只算一次之前先數）', g.personalSubmitUnavailable(tok(1), '', [T1[0], T1[1]], '<b>x</b>', ['READ']).ok
    && sc.subs()[0].reason === 'x');
}

console.log('\n=== UA6：個人頁 ===');
{
  const html = read('src/ui/PersonalRoster.html');
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
  const unavRules = css.split('}').filter((r) => /\.unav/.test(r));
  check('★★★★★★ 手機寬度：申報區的 CSS 沒有 white-space: nowrap', unavRules.every((r) => !/white-space:\s*nowrap/.test(r)), unavRules.filter((r) => /nowrap/.test(r)).join('}'));
  const fixed = unavRules.filter((r) => /(?:^|[^-])width:\s*(\d+)px/.test(r) && Number(r.match(/(?:^|[^-])width:\s*(\d+)px/)[1]) > 340);
  check('★★★★★★ 手機寬度：申報區沒有大過 340px 的固定闊度（390px 手機不會橫向捲動）', fixed.length === 0, fixed.join('}'));
  // 第一百零一輪批次 ZF 組（刻意改動）：方格放大到最少 52px 高
  check('★★★★★ 方格自動換行（flex-wrap）、最少 44px 高', /\.unav \.tiles \{[^}]*flex-wrap: wrap/.test(css) && /\.unav button\.tile \{[^}]*min-height: (4[4-9]|5\d)px/.test(css));
  check('★★★★★ 「我已申報的日子」表格會換行（white-space: normal、table-layout: fixed、width 100%）',
    /\.unav table\.mine th, \.unav table\.mine td \{[^}]*white-space: normal/.test(css) && /\.unav table\.mine \{[^}]*table-layout: fixed/.test(css));
  check('★★★★★ 每月一行、「全選這個月」、選取時有 ✓', /'全選這個月'/.test(html) && /'✓ '/.test(html) && /' 月', 'month-label'/.test(html));
  check('★★★★★★ 「這些日子不能服侍：」全部崗位（預設）／只限以下崗位', /'這些日子不能服侍：'/.test(html) && /radio\('ALL', '全部崗位', true\)/.test(html)
    && /radio\('POSTS', '只限以下崗位', false\)/.test(html));
  check('★★★★★★ 沒有選崗位時〔提交〕不可按，並寫提示', /if \(onlyPosts\(\) && selectedPosts\(\)\.length === 0\) \{\s*submit\.disabled = true;[\s\S]{0,120}'請最少選一個崗位，或選「全部崗位」'/.test(html));
  check('★★★★★ 「不同日子不能服侍的崗位不同？請分開兩次提交。」', html.indexOf('不同日子不能服侍的崗位不同？請分開兩次提交。') !== -1);
  check('★★★★★ 「我已申報的日子」表：主日、崗位、原因、狀態；已確認寫「如需取消，請聯絡幹事」', /\['主日', '崗位', '原因', '狀態'\]/.test(html) && /如需取消，請聯絡幹事/.test(html));
  check('★★★★★ 說明句「幹事或堂委確認」', /幹事或堂委確認之後才會生效/.test(html) && /幹事或堂委確認後生效/.test(html));
  // 第一百零五輪批次 RB 組（刻意加）：personalReplyNoUnavailable
  check('★★★★ 只呼叫三個公開函式（提交送崗位）', /runner\.personalSubmitUnavailable\(token, quarterId, args\[0\], args\[1\], args\[2\]\)/.test(html)
    && (html.match(/runner\.\w+\(/g) || []).every((m) => /personalSubmitUnavailable|personalWithdrawUnavailable|personalReplyNoUnavailable/.test(m)));
  check('★★★★ 介面不用「接受」「拒絕」「批准」', !/接受|拒絕|批准|approved/i.test(html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
