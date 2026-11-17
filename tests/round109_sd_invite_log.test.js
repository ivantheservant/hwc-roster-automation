// 第一百零九輪批次 SD 組：申報連結「這一季已經寄過」改為逐人判斷（UnavailableInvite.gs、UnavailableSchedule.gs）
// 執行方式：node tests/round109_sd_invite_log.test.js
// 場景：tests/helpers/unavailable_scene.js（2099T1 生成日 2098-12-11；假 ID P97xx、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene } = require('./helpers/unavailable_scene.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + String(detail).slice(0, 1500) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const ON = { UNAVAILABLE_INVITE_AUTO: ['TRUE', 'BOOL'] };

function scene(today) {
  const sc = buildUnavailableScene({ config: Object.assign({}, ON), today: today || '2098-11-01',
    extraFiles: ['AdminTools.gs', 'PersonIdFormat.gs', 'PreLaunchWeb.gs', 'Trigger.gs', 'TemplateSamples.gs', 'EmailTemplateUpdate.gs'] });
  const g = sc.gas;
  sc.Q = '2099T1';
  sc.qRow = () => g.readSheet_(sc.S.QUARTERS).filter((r) => r[sc.C.QUARTERS.QUARTER_ID] === sc.Q)[0];
  sc.run = (day) => { sc.today = day; return g.runUnavailableScheduleSteps_(sc.qRow(), day, g.readConfig_(), g.getConfig_('DRY_RUN', true) !== false); };
  sc.goLive = () => {
    const cfg = sc.ss.getSheetByName(sc.S.CONFIG);
    for (let row = 3; row <= cfg.getLastRow(); row++) if (cfg.getRange(row, 1).getValue() === 'DRY_RUN') cfg.getRange(row, 2).setValue('FALSE');
    if (g.reloadConfigCache_) g.reloadConfigCache_();
    g.assertNotPreviewMode_ = () => {};
    g.readMailRedirectTarget_ = () => '';
  };
  sc.audience = () => g.resolveInviteAudience_(null, sc.today).recipients;
  sc.log = (kind) => g.readUnavailableInviteLog_(sc.Q).filter((r) => !kind || r.kind === kind);
  // 指定的人寄信時出錯（模擬寄不出）
  sc.failFor = (ids) => {
    const orig = g.sendRealEmail_;
    const emails = {};
    sc.audience().forEach((r) => { if (ids.indexOf(r.personId) !== -1) emails[r.email] = true; });
    g.sendRealEmail_ = function (to) {
      if (to && emails[to.email]) throw new Error('模擬寄不出');
      return orig.apply(this, arguments);
    };
    return () => { g.sendRealEmail_ = orig; };
  };
  return sc;
}
const step = (rep, action) => rep.filter((r) => r.action === action)[0] || {};

console.log('\n=== SD1 逐人紀錄（不記電郵）＋工作表 ===');
{
  const sc = scene('2098-11-20');
  const g = sc.gas;
  check('★★★★★ 未寄過 ⇒ 未有工作表、讀回空', !sc.ss.getSheetByName('UnavailableInviteLog') && sc.log().length === 0);
  const all = sc.audience();
  g.sendUnavailableInvites_(sc.Q, { recipients: all.slice(0, 3), noEmail: [], noLink: [] }, { mode: 'MANUAL' });
  const rows = sc.log('INVITE');
  check('★★★★★★ 人手寄 3 位 ⇒ 3 行 MANUAL／DRY_RUN', rows.length === 3 && rows.every((r) => r.mode === 'MANUAL' && r.result === 'DRY_RUN' && r.date === '2098-11-20'),
    JSON.stringify(rows));
  const sheet = sc.ss.getSheetByName('UnavailableInviteLog');
  const flat = JSON.stringify(sheet.getDataRange().getValues());
  check('★★★★★★ 工作表不記電郵', !/@/.test(flat), flat);
  check('★★★★★ 〔補建設定及範本〕會建立這張工作表', /SHEETS\.UNAVAILABLE_INVITE_LOG[,\]][^\n]*\.filter/.test(read('src/AdminTools.gs'))
    && /ensureUnavailableInviteLogSheet_\(\)\.created/.test(read('src/AdminTools.gs')));
}

console.log('\n=== SD2 人手只寄 3 位 ⇒ G−14 自動補其餘 ===');
{
  const sc = scene('2098-11-20');
  const g = sc.gas;
  const all = sc.audience();
  g.sendUnavailableInvites_(sc.Q, { recipients: all.slice(0, 3), noEmail: [], noLink: [] }, { mode: 'MANUAL' });
  let rep = sc.run('2098-11-27');
  const auto = sc.log('INVITE').filter((r) => r.mode === 'AUTO');
  check('★★★★★★ 自動只寄未收過的人（總數－3）', step(rep, 'UNAVAILABLE_INVITE').outcome === 'SENT' && auto.length === all.length - 3
    && auto.every((r) => all.slice(0, 3).every((m) => m.personId !== r.personId)), JSON.stringify([rep, auto.length, all.length]));
  rep = sc.run('2098-11-28');
  check('★★★★★★ 全部收過 ⇒ ALREADY_DONE', step(rep, 'UNAVAILABLE_INVITE').detail === 'ALREADY_DONE', JSON.stringify(rep));
}

console.log('\n=== SD3 全部失敗 ⇒ 不算做過，翌日再試，最多 3 日；第一次失敗通知幹事一次 ===');
{
  const sc = scene('2098-11-20');
  const g = sc.gas;
  sc.goLive();
  const all = sc.audience();
  const restore = sc.failFor(all.map((r) => r.personId));
  let rep = sc.run('2098-11-27');
  check('★★★★★★ 第 1 日全部失敗 ⇒ FAILED', step(rep, 'UNAVAILABLE_INVITE').outcome === 'FAILED', JSON.stringify(rep));
  const a = sc.audits('UNAVAILABLE_INVITE_SENT');
  check('★★★★★★ AuditLog 第三段寫 FAILED（不是 SENT）', a.length === 1 && /\|FAILED$/.test(a[a.length - 1][sc.C.AUDIT_LOG.NEW_VALUE]), JSON.stringify(a));
  check('★★★★★★ 第一次失敗就通知幹事一次', sc.audits('UNAVAILABLE_INVITE_FAIL_NOTIFIED').length === 1);
  check('★★★★★ 提醒不會寄給沒有收過的人（NOT_INVITED）', step(rep, 'UNAVAILABLE_REMIND').detail === 'NOT_INVITED', JSON.stringify(rep));
  rep = sc.run('2098-11-27');
  check('★★★★★ 同一日不重試', step(rep, 'UNAVAILABLE_INVITE').detail === 'TRIED_TODAY', JSON.stringify(rep));
  rep = sc.run('2098-11-28');
  check('★★★★★★ 翌日再試', step(rep, 'UNAVAILABLE_INVITE').outcome === 'FAILED', JSON.stringify(rep));
  check('★★★★★ 通知只寄一次', sc.audits('UNAVAILABLE_INVITE_FAIL_NOTIFIED').length === 1);
  sc.run('2098-11-29');
  rep = sc.run('2098-11-30');
  check('★★★★★★ 連續 3 日失敗之後停（RETRY_LIMIT）', step(rep, 'UNAVAILABLE_INVITE').detail === 'RETRY_LIMIT'
    && sc.audits('UNAVAILABLE_INVITE_SENT').length === 3, JSON.stringify(rep));
  restore();
}

console.log('\n=== SD4 部分失敗 ⇒ 翌日只補失敗的人；提醒只寄給收過而未回覆的人 ===');
{
  const sc = scene('2098-11-20');
  const g = sc.gas;
  sc.goLive();
  const all = sc.audience();
  const bad = [all[0].personId, all[1].personId];
  let restore = sc.failFor(bad);
  let rep = sc.run('2098-11-27');
  check('★★★★★ 第 1 日部分成功 ⇒ SENT，寫明失敗人數', step(rep, 'UNAVAILABLE_INVITE').outcome === 'SENT' && /失敗 2 位/.test(step(rep, 'UNAVAILABLE_INVITE').detail),
    JSON.stringify(rep));
  restore();
  const before = sc.mails.length;
  rep = sc.run('2098-11-28');
  const sentTo = sc.mails.slice(before).map((m) => m.to);
  const badEmails = all.filter((r) => bad.indexOf(r.personId) !== -1).map((r) => r.email);
  check('★★★★★★ 翌日只補寄失敗的 2 位', sentTo.length === 2 && sentTo.every((t) => badEmails.indexOf(t) !== -1), JSON.stringify([sentTo, rep]));
  // 另一場景：一直有 1 位寄不出 ⇒ 提醒不寄給他
  const sc2 = scene('2098-11-20');
  sc2.goLive();
  const all2 = sc2.audience();
  sc2.failFor([all2[0].personId]);
  for (const d of ['2098-11-27', '2098-11-28', '2098-11-29', '2098-11-30']) sc2.run(d);
  const b2 = sc2.mails.length;
  rep = sc2.run('2098-12-08');
  const remindTo = sc2.mails.slice(b2).map((m) => m.to);
  check('★★★★★★ G−3 提醒不寄給從來沒有收過邀請的人', step(rep, 'UNAVAILABLE_REMIND').outcome === 'SENT' && remindTo.indexOf(all2[0].email) === -1
    && remindTo.length === all2.length - 1, JSON.stringify([remindTo.length, all2.length, rep]));
  const rl = sc2.log('REMIND');
  check('★★★★★ 提醒亦逐人記錄（REMIND）', rl.length === all2.length - 1 && rl.every((r) => r.result === 'SENT'), JSON.stringify(rl.length));
}

console.log('\n=== SD5 DRY_RUN 的模擬紀錄在上線後不算；舊紀錄相容 ===');
{
  const sc = scene('2098-11-20');
  const g = sc.gas;
  const rows = [{ personId: 'P9701', date: '2098-11-27', kind: 'INVITE', mode: 'AUTO', result: 'DRY_RUN' }];
  check('★★★★★★ DRY_RUN 中：模擬當作收過', g.summariseUnavailableInviteLog_(rows, 'INVITE', true, '2098-11-28').receivedCount === 1);
  check('★★★★★★ 上線後：模擬不算收過', g.summariseUnavailableInviteLog_(rows, 'INVITE', false, '2098-11-28').receivedCount === 0);
  sc.run('2098-11-27');
  const n = sc.log('INVITE').length;
  sc.goLive();
  const before = sc.mails.length;
  const rep = sc.run('2098-11-28');
  check('★★★★★★ 上線之後真正寄給全部（模擬過的不算）', step(rep, 'UNAVAILABLE_INVITE').outcome === 'SENT' && sc.mails.length - before === n,
    JSON.stringify([rep, sc.mails.length - before, n]));

  // 舊紀錄：只有 AuditLog（MANUAL…SENT），沒有逐人紀錄 ⇒ 照舊當作做過，不重寄
  const old = scene('2098-11-20');
  old.goLive();
  old.gas.writeAuditLog_({ action: 'UNAVAILABLE_INVITE_SENT', targetSheet: 'Quarters', targetKey: old.Q, newValue: 'MANUAL|2098-11-20|SENT', source: 'apiUnavailableInviteSend' });
  const b = old.mails.length;
  let r2 = old.run('2098-11-27');
  check('★★★★★★ 舊紀錄 ⇒ ALREADY_DONE，不重寄', step(r2, 'UNAVAILABLE_INVITE').detail === 'ALREADY_DONE' && old.mails.length === b, JSON.stringify(r2));
  r2 = old.run('2098-12-08');
  check('★★★★★ 舊紀錄 ⇒ 提醒照舊按預設名單（未回覆的人）', step(r2, 'UNAVAILABLE_REMIND').outcome === 'SENT' && old.mails.length - b === old.audience().length,
    JSON.stringify([r2, old.mails.length - b]));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
