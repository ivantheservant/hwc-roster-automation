// 第九十一輪批次 RD 組：〔儲存〕不再即時重新發佈公開連結，改為完成窗出現之後在背景更新。
// 執行方式：node tests/round91_rd_publish_after_save.test.js
//
//   RD1 伺服器：儲存不發佈、回傳 publishPending:true；apiPublishPublicRosterAfterSave() 發佈並回傳第 N 版／原因
//   RD2 權限：新 api 開頭是 assertWebAppRequestAllowed_()（改動）、經 withMutationLock_、不在唯讀清單
//   RD3 前端：完成窗即時出現「公開連結更新中……」；成功／失敗文字；失敗有〔立即重新發佈〕（共用 republishPublicLinkNow）；
//       關閉完成窗不會取消；完成後狀態卡整理一次；更新中狀態卡寫「公開連結更新中」而不是「未更新」
//   RD4 安全網（靜態）：src/ 每一個呼叫 deliverOne_() 的函式（寄信的必經之路），在呼叫之前一定經過
//       ensurePublicLinkFreshBeforeSend_()；傳 publicLinkEnsured=true 的呼叫端自己先做過。新入口沒有 ⇒ 紅。
//   RD5 安全網（行為）：公開檔過期 ⇒ 寄出前先重新發佈；發佈失敗 ⇒ 一封都不寄
//   RD6 指南 4.4（guide/ 不在 repo，本機有才檢查）
// 下面用假資料（example.invalid），不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { buildSendScene } = require('./helpers/send_scene.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

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

/** 由函式名切出函式本體（到第一個頂層 `\n}` 為止）。 */
function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}');
  return end === -1 ? rest : rest.slice(0, end + 2);
}

/** 生成第 0 版，改一格主席（換成當日沒有崗位的人）。 */
function scene() {
  const sc = buildRound75Scene({ extraFiles: ['CellDecisions.gs'] });
  sc.gas.apiGenerateDraftExecute(sc.Q);
  const D = sc.DATES;
  const busy = ['CHAIR#1', 'READ#1', 'WORSHIP#1'].map((k) => sc.getCell(0, D[0], k));
  const free = ['P9701', 'P9702', 'P9703', 'P9705'].map(sc.nameOf).filter((n) => busy.indexOf(n) === -1)[0];
  sc.setCell(0, D[0], 'CHAIR#1', free);
  return sc;
}

console.log('\n=== RD1：儲存不發佈；背景那一支才發佈 ===');
{
  const sc = scene();
  const g = sc.gas;
  const pubs = [];
  let nextPublish = { failed: false, skipped: false, message: '' };
  g.tryPublishPublicRoster_ = (q) => { pubs.push(q); return nextPublish; };
  const r = g.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（前置）儲存成第 1 版', r && r.ok && r.versionNo === 1, JSON.stringify(r).slice(0, 300));
  check('★★★★★★ 儲存那一步沒有發佈公開連結（省 9–13 秒）', pubs.length === 0, JSON.stringify(pubs));
  check('★★★★★★ 回傳 publishPending:true（前端據此在背景更新）', r.publishPending === true && r.publishFailed === false);
  check('★★★★ 分段時間沒有「重新發佈公開連結」', !(r.timings || []).some((t) => t.label.indexOf('發佈') !== -1),
    JSON.stringify(r.timings));

  const a = g.apiPublishPublicRosterAfterSave(sc.Q);
  check('★★★★★★ apiPublishPublicRosterAfterSave：發佈一次，回傳 ok 和第 1 版', pubs.length === 1 && pubs[0] === sc.Q
    && a.ok === true && a.versionNo === 1, JSON.stringify(a));
  nextPublish = { failed: false, skipped: true, message: '' };
  const b = g.apiPublishPublicRosterAfterSave(sc.Q);
  check('★★★★ 已經是最新 ⇒ skipped:true，仍然 ok', b.ok === true && b.skipped === true, JSON.stringify(b));
  nextPublish = { failed: true, skipped: false, message: '假的發佈錯誤' };
  const c = g.apiPublishPublicRosterAfterSave(sc.Q);
  check('★★★★★★ 發佈失敗 ⇒ ok:false，message 是原因（前端寫「公開連結未能更新（原因）。」）',
    c.ok === false && c.message === '假的發佈錯誤', JSON.stringify(c));
  const none = g.apiPublishPublicRosterAfterSave('2098T1');
  check('★★★★ 沒有版本的季度 ⇒ ok:false，不發佈', none.ok === false && pubs.length === 3, JSON.stringify(none));
}

console.log('\n=== RD2：新 api 的權限 ===');
{
  const src = read('src/WebAppSaveConfirm.gs');
  const body = bodyOf(src, 'apiPublishPublicRosterAfterSave');
  const firstLine = (body.split('\n').slice(1).filter((l) => l.trim() && !/^\s*\/\//.test(l))[0] || '').trim();
  check('★★★★★★ 開頭是 assertWebAppRequestAllowed_()（不帶名字＝改動，只可查看的人會被拒絕）',
    firstLine === 'assertWebAppRequestAllowed_();', firstLine);
  check('★★★★★ 經 withMutationLock_（和其他寫入互斥）', /withMutationLock_\('更新公開連結'/.test(body));
  const webApp = read('src/WebApp.gs');
  const front = read('src/ui/Script.html');
  check('★★★★★ 不在伺服器 WEBAPP_READ_ONLY_APIS，也不在前端 READ_ONLY_APIS',
    !/WEBAPP_READ_ONLY_APIS = \[[\s\S]*?'apiPublishPublicRosterAfterSave'[\s\S]*?\];/.test(webApp)
    && !/READ_ONLY_APIS = \[[^\]]*'apiPublishPublicRosterAfterSave'/.test(front));

  const sc = scene();
  const g = sc.gas;
  const pubs = [];
  g.tryPublishPublicRoster_ = (q) => { pubs.push(q); return { failed: false }; };
  g.assertWebAppRequestAllowed_ = () => { throw new Error('你只有查看權限，不可以改動。'); };
  let thrown = '';
  try { g.apiPublishPublicRosterAfterSave(sc.Q); } catch (e) { thrown = e.message; }
  check('★★★★★★ 權限檢查拒絕 ⇒ 拋出、沒有發佈', /查看權限/.test(thrown) && pubs.length === 0, thrown);
}

console.log('\n=== RD3：前端完成窗 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  const inFlight = () => vm.runInContext('publishInFlight_', ui);
  let opened = null;
  ui.openModal = (title, nodes, acts) => { opened = { title: title, nodes: nodes, acts: acts }; };
  let closed = 0;
  ui.closeModal = () => { closed++; };
  const dash = [];
  ui.loadDashboard = (opts) => { dash.push(opts || {}); return Promise.resolve(); };
  const republish = [];
  ui.republishPublicLinkNow = () => { republish.push(1); return Promise.resolve(); };
  let pending = null;
  const serverCalls = [];
  ui.callServerMutating = (fn, ...args) => {
    serverCalls.push([fn].concat(args));
    return new Promise((resolve, reject) => { pending = { resolve: resolve, reject: reject }; });
  };
  const result = { ok: true, versionNo: 1, baseVersionNo: 0, publishPending: true, publishFailed: false,
    savedChanges: [], cellCount: 0, startPointCells: [], appliedRequestCount: 0 };
  const textOf = () => opened.nodes.map((n) => n.textContent).join('\n');
  const flush = () => new Promise((r) => setImmediate(r));

  (async () => {
    // 成功
    ui.renderSaveResult(result);
    check('★★★★★★ 完成窗即時出現（還沒有等發佈回來）', opened && opened.title === '儲存完成' && pending !== null);
    check('★★★★★★ 那一行寫「公開連結更新中……」', textOf().indexOf('公開連結更新中……') !== -1, textOf());
    check('★★★★★ 背景呼叫 apiPublishPublicRosterAfterSave(季度)', serverCalls.length === 1
      && serverCalls[0][0] === 'apiPublishPublicRosterAfterSave' && serverCalls[0][1] === '2099T1', JSON.stringify(serverCalls));
    check('★★★★★ 更新中 publishInFlight_ = true', inFlight() === true);
    pending.resolve({ ok: true, skipped: false, versionNo: 1, message: '' });
    await flush();
    check('★★★★★★ 成功 ⇒「公開連結已經更新（第 1 版）。」', textOf().indexOf('公開連結已經更新（第 1 版）。') !== -1, textOf());
    check('★★★★★ 完成後 publishInFlight_ = false，狀態卡整理一次（keepModal，不關完成窗）',
      inFlight() === false && dash.length === 1 && dash[0].keepModal === true && closed === 0, JSON.stringify(dash));

    // 失敗（伺服器回 ok:false）
    opened = null; pending = null; dash.length = 0;
    ui.renderSaveResult(result);
    pending.resolve({ ok: false, skipped: false, versionNo: 1, message: '假的發佈錯誤' });
    await flush();
    check('★★★★★★ 失敗 ⇒「公開連結未能更新（假的發佈錯誤）。」', textOf().indexOf('公開連結未能更新（假的發佈錯誤）。') !== -1, textOf());
    const btn = opened.nodes.map((n) => n.flatten()).reduce((a, b) => a.concat(b), [])
      .filter((n) => n.tagName === 'BUTTON' && n.textContent === '立即重新發佈')[0];
    check('★★★★★★ 失敗那一行有〔立即重新發佈〕', !!btn, textOf());
    if (btn) btn.fire('click');
    check('★★★★★★ 按下去用共用的 republishPublicLinkNow()（不是另寫一份）', republish.length === 1);
    check('★★★★ 失敗也整理狀態卡一次', dash.length === 1 && inFlight() === false);

    // 失敗（呼叫本身拋錯）
    opened = null; pending = null;
    ui.renderSaveResult(result);
    pending.reject(new Error('連線中斷'));
    await flush();
    check('★★★★★ 呼叫拋錯 ⇒「公開連結未能更新（連線中斷）。」', textOf().indexOf('公開連結未能更新（連線中斷）。') !== -1, textOf());

    // 關閉完成窗不會取消
    opened = null; pending = null; dash.length = 0;
    ui.renderSaveResult(result);
    opened = null;  // 幹事按〔知道了〕，完成窗關了
    pending.resolve({ ok: true, skipped: false, versionNo: 1, message: '' });
    await flush();
    check('★★★★★★ 關閉完成窗之後照樣完成更新並整理狀態卡', dash.length === 1 && inFlight() === false);

    // 沒有 publishPending（舊伺服器）⇒ 不呼叫
    serverCalls.length = 0;
    ui.renderSaveResult(Object.assign({}, result, { publishPending: false }));
    check('★★★★ 沒有 publishPending ⇒ 不在背景呼叫', serverCalls.length === 0);

    // 狀態卡：更新中 ⇒「公開連結更新中……」，不是「未更新」
    const card = read('src/ui/Script.html');
    check('★★★★★★ 狀態卡：stale 而更新中 ⇒ 寫「公開連結更新中……」，排在「未更新」警告之前',
      /if \(pl\.stale && publishInFlight_\) \{\s*\n[^\n]*\n\s*staleBox\.appendChild\(make\('div', \{ text: '公開連結更新中……'/.test(card));
    const zone1 = read('src/ui/ScriptZone1.html');
    const bg = zone1.slice(zone1.indexOf('async function startPublishAfterSave('));
    const bgBody = bg.slice(0, bg.indexOf('\n  }\n'));
    check('★★★★★ 狀態卡和完成窗共用 republishPublicLinkNow()：Script.html 只有一份 apiRepublishPublicLink，背景那一支沒有另寫',
      (card.match(/callServerMutating\('apiRepublishPublicLink'/g) || []).length === 1
      && /function republishPublicLinkNow\(\)/.test(card)
      && /button\('立即重新發佈', \(\) => republishPublicLinkNow\(\)/.test(card)
      && bgBody.indexOf('apiRepublishPublicLink') === -1 && bgBody.indexOf('republishPublicLinkNow()') !== -1, bgBody.slice(0, 200));
  })().then(() => runRest(), (e) => { fail++; console.log('FAIL  未預期例外：' + e.stack); runRest(); });
}

function runRest() {
  console.log('\n=== RD4：安全網——每一個寄信入口都先確保公開連結最新 ===');
  /**
   * 找出 src/ 裏面每一個呼叫 `deliverOne_(` 的函式，以及每一個傳 `true` 作 publicLinkEnsured 的呼叫端；
   * 檢查呼叫之前，同一個函式裏面已經有 `ensurePublicLinkFreshBeforeSend_(`。
   * @param {Object.<string,string>} files 檔名 → 原始碼
   * @returns {{entries: string[], problems: string[]}}
   */
  function scanSendEntries(files) {
    const entries = [];
    const problems = [];
    Object.keys(files).forEach((file) => {
      if (file === 'SelfTest.gs') return;  // 自我測試：假收件人＋DRY_RUN，不會真的寄
      const lines = files[file].split(/\r?\n/);
      let fn = '';
      let fnStart = 0;
      lines.forEach((line, i) => {
        const m = line.match(/^function (\w+)\s*\(/);
        if (m) { fn = m[1]; fnStart = i; }
        if (/^\s*(\*|\/\/)/.test(line)) return;
        const deliver = /\bdeliverOne_\(/.test(line) && !/^function deliverOne_/.test(line);
        const ensured = /\b(sendStage_|sendResendStage_)\([\s\S]*,\s*true\);/.test(line + (lines[i + 1] || ''))
          && /\b(sendStage_|sendResendStage_)\(/.test(line) && !/^function /.test(line);
        if (!deliver && !ensured) return;
        const before = lines.slice(fnStart, i).join('\n');
        entries.push(file + ' ' + fn + (deliver ? '（deliverOne_）' : '（publicLinkEnsured=true）'));
        if (before.indexOf('ensurePublicLinkFreshBeforeSend_(') === -1) {
          problems.push(file + ':' + (i + 1) + ' ' + fn + '：呼叫之前沒有 ensurePublicLinkFreshBeforeSend_()');
        }
      });
    });
    return { entries: entries, problems: problems };
  }
  const files = {};
  fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).forEach((f) => { files[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
  const scan = scanSendEntries(files);
  console.log('      入口：' + scan.entries.join('｜'));
  check('★★★★★★ 每一個寄信入口在寄出之前都經過 ensurePublicLinkFreshBeforeSend_()', scan.problems.length === 0,
    scan.problems.join('\n'));
  ['Mailer.gs sendStage_', 'ResendFlow.gs sendResendStage_', 'MakeupSend.gs executeMakeupSend_',
    'FiveStageCore.gs executeStep2_'].forEach((e) => {
    check('★★★★★ 掃描找得到：' + e, scan.entries.some((x) => x.indexOf(e) === 0), scan.entries.join('｜'));
  });
  const fake = Object.assign({}, files, {
    'NewEntry.gs': 'function sendSomethingNew_(quarterId) {\n  const ctx = {};\n  return deliverOne_(r, t, ctx, false);\n}\n',
    'NewEntry2.gs': 'function sendTrustMe_(q, v) {\n  return sendStage_(q, v, \'REVIEW\', {}, true);\n}\n'
  });
  const fakeScan = scanSendEntries(fake);
  check('★★★★★★ 自我驗證：新加一個寄信入口而沒有先確保 ⇒ 這個測試會紅（兩種寫法都捉到）',
    fakeScan.problems.some((p) => p.indexOf('sendSomethingNew_') !== -1)
    && fakeScan.problems.some((p) => p.indexOf('sendTrustMe_') !== -1), fakeScan.problems.join('\n'));
  check('★★★★★ sendStage_／sendResendStage_ 的保護：publicLinkEnsured 不是 true 就做',
    /if \(publicLinkEnsured !== true\) ensurePublicLinkFreshBeforeSend_\(quarterId\);/.test(bodyOf(files['Mailer.gs'], 'sendStage_'))
    && /if \(publicLinkEnsured !== true\) ensurePublicLinkFreshBeforeSend_\(quarterId\);/.test(bodyOf(files['ResendFlow.gs'], 'sendResendStage_')));

  console.log('\n=== RD5：過期 ⇒ 寄出前先重新發佈；發佈失敗 ⇒ 不寄 ===');
  {
    const sc = buildSendScene('p9704@example.invalid');
    const g = sc.gas;
    const ev = [];
    const realDeliver = g.deliverOne_;
    g.deliverOne_ = function () { ev.push('deliver'); return realDeliver.apply(null, arguments); };
    g.evaluatePublicLinkFreshness_ = () => ({ hasLink: true, stale: true, reason: 'OLD', message: '公開檔是第 0 版。' });
    let publishFails = false;
    g.tryPublishPublicRoster_ = () => { ev.push('publish'); return publishFails ? { failed: true, message: '假的發佈錯誤' } : { failed: false, skipped: false }; };

    g.sendStage_(sc.Q, 0, 'REVIEW', undefined);
    check('★★★★★★ 選單／其他入口直接叫 sendStage_：公開檔過期 ⇒ 先重新發佈，然後才寄',
      ev[0] === 'publish' && ev.indexOf('deliver') > 0, ev.join(','));
    ev.length = 0;
    g.sendStage_(sc.Q, 0, 'REVIEW', undefined, true);
    check('★★★★ 呼叫端已經確保（publicLinkEnsured=true）⇒ 不重做', ev.indexOf('publish') === -1 && ev.indexOf('deliver') !== -1, ev.join(','));
    ev.length = 0;
    try { g.sendResendStage_(sc.Q, 0, ['P9701'], undefined); } catch (e) { /* 只看次序 */ }
    check('★★★★★ sendResendStage_：先重新發佈', ev[0] === 'publish', ev.join(','));

    publishFails = true;
    ev.length = 0;
    let thrown = '';
    try { g.sendStage_(sc.Q, 0, 'REVIEW', undefined); } catch (e) { thrown = e.message; }
    check('★★★★★★ 重新發佈失敗 ⇒ 一封都不寄，訊息講明', ev.indexOf('deliver') === -1 && /一封都沒有寄出/.test(thrown), ev.join(',') + '｜' + thrown);
  }

  console.log('\n=== RD6：指南 4.4 ===');
  // guide/ 不在 repo（.gitignore）；只在本機有那個資料夾時才檢查
  const guidePath = path.join(ROOT, 'guide', '指南內容.md');
  if (fs.existsSync(guidePath)) check('★★★★ 指南 4.4 寫明公開連結在背景自動更新',
    read('guide/指南內容.md').indexOf('完成窗出現後，公開連結會在背景自動更新（約十秒），完成後會顯示「公開連結已經更新」') !== -1);

  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exitCode = fail === 0 ? 0 : 1;
}
