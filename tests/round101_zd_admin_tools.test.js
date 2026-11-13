// 第一百零一輪批次 ZD 組（及 ZG）：只在試算表選單的功能搬入幹事介面；〔使用權限〕；只可查看的人不見主試算表；〔上線前檢查〕。
// 執行方式：node tests/round101_zd_admin_tools.test.js
//
//   ZD1 入口：進階與診斷〔自動排程狀態〕〔安裝自動排程〕〔移除自動排程〕〔上線前檢查〕〔個人專屬連結〕〔上線切換〕〔回到測試模式〕
//       〔補建設定及範本〕；常用設定〔使用權限〕〔暫時不做某崗位〕；新 api 權限歸類（唯讀兩邊登記；改動用鎖）
//   ZD2 自動排程：時間表（未來兩季，每一項日期、會寄給誰、開／關）、上次執行紀錄、〔我已核對時間表〕、安裝／移除同一支後端
//   ZD3 使用者看得到的字串沒有試算表選單路徑（「職事表系統 ▸」「試算表選單」「四階段流程」「維護 ▸」等）
//   ZD4 只可查看的人：伺服器端不送主試算表網址；介面不畫打開主試算表的按鈕或連結（〔開啟事奉人員名單〕改為〔查看事奉人員名單〕）
//   ZD5 個人專屬連結：補發（新人）、重新產生（強確認）
//   ZD6 補建設定及範本：只新增缺少的
//   ZD7 上線切換／回到測試模式：同一套檢查、強確認、次序（上線：前綴→DRY_RUN；回退：DRY_RUN→前綴）
//   ZD8 使用權限：驗證電郵、不可以把自己移走、改動寫 AuditLog、只限可以修改的人看
//   ZD9 暫時不做某崗位：崗位可多選、全部合格才寫
//   ZG  上線前檢查：逐項 ✔／✘ 及去哪裏改；只讀
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');
const { extractStringLiterals } = require('./helpers/string_literals.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SELF = 'editor@example.invalid';

function scene(opts) {
  opts = opts || {};
  const sc = buildRound75Scene({ extraFiles: ['AdminTools.gs', 'PersonIdFormat.gs', 'PreLaunchWeb.gs', 'GoLiveWizard.gs', 'ConfigSeed.gs', 'EmailTemplateSeed.gs',
    'EmailTemplateUpdate.gs', 'WebAppPersonalLink.gs', 'PersonalLinkInMail.gs', 'WebApp.gs', 'WebAppExclusions.gs', 'WebAppRoster3Common.gs',
    'PreseasonPack.gs', 'UnavailableSchedule.gs', 'PersonalUnavailable.gs', 'UnavailableInvite.gs', 'SendAudience.gs', 'RolloutAudience.gs', 'PreseasonChange.gs', 'SeasonRehearsal.gs', 'CombinedSkipBackfill.gs', 'QuarterReset.gs', 'SelfTestRunner.gs'] });
  const g = sc.gas;
  g.Session = { getActiveUser: () => ({ getEmail: () => opts.self || SELF }) };
  g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }), getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  const props = {};
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) };
  sc.props = props;
  sc.triggers = [];
  g.ScriptApp = {
    getProjectTriggers: () => sc.triggers.slice(),
    deleteTrigger: (t) => { sc.triggers.splice(sc.triggers.indexOf(t), 1); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyDays: () => ({ atHour: (h) => ({ create: () => { sc.triggers.push({ getHandlerFunction: () => fn, getUniqueId: () => 'T' + sc.triggers.length, getEventType: () => 'CLOCK', hour: h }); } }) }) }) })
  };
  sc.audits = (action) => g.readSheet_(sc.S.AUDIT_LOG).filter((r) => !action || r[sc.C.AUDIT_LOG.ACTION] === action);
  return sc;
}

console.log('\n=== ZD1：入口、權限歸類 ===');
{
  const z4 = read('src/ui/ScriptZone4.html');
  const z3 = read('src/ui/ScriptZone3.html');
  [['自動排程狀態', 'openAutomationStatus()'], ['安裝自動排程', 'installAutomationNow()'], ['移除自動排程', 'removeAutomationNow()'],
    ['上線前檢查', 'openPreLaunchCheck()'], ['個人專屬連結', 'openPersonalLinkTools()'], ['上線切換', 'openGoLive(false)'],
    ['回到測試模式', 'openGoLive(true)'], ['補建設定及範本', 'openSeedConfigAndTemplates()']].forEach(([name, fn]) => {
    const re = new RegExp("zone4Row\\('" + name + "',[\\s\\S]{0,200}\\(\\) => " + fn.replace(/[()]/g, '\\$&'));
    check('★★★★★ 進階與診斷〔' + name + '〕', re.test(z4));
  });
  check('★★★★★ 常用設定〔使用權限〕〔暫時不做某崗位〕', /button\('使用權限', \(\) => openPermissions\(\)/.test(z3) && /button\('暫時不做某崗位', \(\) => openExclusions\(''\)/.test(z3));
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★ 個人專屬連結窗內〔補發個人專屬連結〕〔重新產生某人的個人連結〕；自動排程狀態窗內〔我已核對時間表〕',
    /button\('補發個人專屬連結'/.test(z5) && /button\('重新產生某人的個人連結'/.test(z5) && /button\('我已核對時間表'/.test(z5));
  const web = read('src/WebApp.gs');
  const front = read('src/ui/Script.html');
  ['apiGetAutomationStatus', 'apiGetPersonalLinkTools', 'apiPlanSeedConfigAndTemplates', 'apiGoLivePlan', 'apiGetPermissions', 'apiGetPreLaunchCheck'].forEach((n) => {
    check('★★★★ 唯讀 ' + n + '：伺服器、前端兩邊登記', web.indexOf("'" + n + "'") !== -1 && front.indexOf("'" + n + "'") !== -1);
  });
  const admin = read('src/AdminTools.gs');
  ['apiInstallAutomation', 'apiRemoveAutomation', 'apiSeedPersonalLinkTokens', 'apiSeedConfigAndTemplates', 'apiSavePermissions'].forEach((n) => {
    check('★★★★ 改動 ' + n + '：assertWebAppRequestAllowed_()＋鎖', new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]{0,1200}?assertWebAppRequestAllowed_\\(\\);[\\s\\S]{0,1600}?withMutationLock_\\(').test(admin));
  });
}

console.log('\n=== ZD2：自動排程 ===');
{
  const sc = scene();
  const g = sc.gas;
  // 加兩季未來的季度（2099T2、2099T3）
  const Q = sc.C.QUARTERS;
  const qs = sc.ss.getSheetByName(sc.S.QUARTERS);
  qs.getRange(1, 7, 1, 2).setValues([['GenerateOn', 'OfficialSendOn']]);
  qs.getRange(2, 7, 1, 2).setValues([[Q.GENERATE_ON, Q.OFFICIAL_SEND_ON]]);
  sc.appendRows(sc.ss, sc.S.QUARTERS, [Q.QUARTER_ID, Q.YEAR, Q.TERM, Q.START_DATE, Q.END_DATE, Q.STAGE, Q.GENERATE_ON, Q.OFFICIAL_SEND_ON], [
    { [Q.QUARTER_ID]: '2099T2', [Q.YEAR]: 2099, [Q.TERM]: 2, [Q.START_DATE]: '2099-04-01', [Q.END_DATE]: '2099-06-30', [Q.STAGE]: 'DRAFT', [Q.GENERATE_ON]: '2099-03-01', [Q.OFFICIAL_SEND_ON]: '2099-03-15' },
    { [Q.QUARTER_ID]: '2099T3', [Q.YEAR]: 2099, [Q.TERM]: 3, [Q.START_DATE]: '2099-07-01', [Q.END_DATE]: '2099-09-30', [Q.STAGE]: 'DRAFT', [Q.GENERATE_ON]: '2099-06-01', [Q.OFFICIAL_SEND_ON]: '2099-06-15' }]);
  const tt = g.buildAutomationTimetable_('2099-01-15');
  check('★★★★★★ 未來兩季（開始日在今日之後、最早的兩季）', tt.map((q) => q.quarterId).join() === '2099T2,2099T3', JSON.stringify(tt.map((q) => q.quarterId)));
  const labels = tt[0].items.map((i) => i.label);
  // 第一百零五輪批次 RB 組（刻意改）：加申報時間表三項，按時間先後排
  check('★★★★★★ 每季八項：季前資料、申報連結、截止日前提醒、申報截止日、申報期完結通知、自動生成日、提醒、正式發出日（人手）',
    labels.join('／') === '季前資料自動寄出日／申報連結自動寄出日／截止日前提醒／申報截止日／申報期完結通知／自動生成日／提醒（接近正式發出日）／正式發出日（人手）', labels.join('／'));
  const it = (l) => tt[0].items.filter((i) => i.label === l)[0];
  check('★★★★★ 每一項寫明「會寄給誰」及「現時開／關」', tt[0].items.every((i) => i.who && i.onOff));
  check('★★★★★ 自動生成日＝GenerateOn；正式發出日＝OfficialSendOn（人手）', it('自動生成日').date === '2099-03-01' && it('正式發出日（人手）').date === '2099-03-15' && it('正式發出日（人手）').onOff === '人手');
  check('★★★★★ 季前資料自動寄出日＝生成日前 PRESEASON_DAYS_BEFORE（14）日', it('季前資料自動寄出日').date === '2099-02-15', it('季前資料自動寄出日').date);
  const realGet = g.getConfig_;
  g.getConfig_ = (k, d) => (k === 'PRESEASON_AUTO_SEND' ? false : realGet(k, d));
  check('★★★★★★ PRESEASON_AUTO_SEND=FALSE ⇒ 季前資料「關」', g.buildAutomationTimetable_('2099-01-15')[0].items.filter((i) => i.label === '季前資料自動寄出日')[0].onOff === '關');
  g.getConfig_ = realGet;
  // 安裝、移除、上次執行
  g.apiInstallAutomation();
  check('★★★★★ 〔安裝自動排程〕⇒ 一個 dailyAutomationCheck_ 觸發器；AuditLog', sc.triggers.length === 1 && sc.triggers[0].getHandlerFunction() === 'dailyAutomationCheck_' && sc.audits('AUTOMATION_INSTALLED').length === 1);
  g.apiInstallAutomation();
  check('★★★★ 再裝一次不會變兩個', sc.triggers.length === 1);
  let st = g.apiGetAutomationStatus();
  check('★★★★★ 狀態：已安裝；還沒有執行紀錄', st.installed === true && st.lastRun === null);
  g.recordAutomationLastRun_(true, '做了 1 項、略過 2 項、出錯 0 項');
  st = g.apiGetAutomationStatus();
  check('★★★★★ 上次執行時間及結果', st.lastRun && st.lastRun.ok === true && /做了 1 項/.test(st.lastRun.summary));
  check('★★★★★ 每日檢查完成／失敗都記下（Trigger.gs）', /recordAutomationLastRun_\(report\.every/.test(read('src/Trigger.gs')) && /recordAutomationLastRun_\(false, '執行失敗：'/.test(read('src/Trigger.gs')));
  g.apiMarkAutomationScheduleReviewed();
  check('★★★★★ 〔我已核對時間表〕記下日期', /^\d{4}-\d{2}-\d{2}$/.test(g.apiGetAutomationStatus().reviewedAt));
  g.apiRemoveAutomation();
  check('★★★★★ 〔移除自動排程〕', sc.triggers.length === 0 && sc.audits('AUTOMATION_REMOVED').length === 1);
}

console.log('\n=== ZD3：使用者看得到的字串沒有試算表選單路徑 ===');
{
  const MENU_ONLY = ['Menu.gs', 'SelfTest.gs', 'SelfTestRunner.gs', 'MonkeyRun.gs', 'SeasonRehearsal.gs', 'SeasonRehearsalResume.gs',
    'Debug.gs', 'Tune.gs', 'MultiRun.gs', 'EpsilonTrial.gs', 'FreshEnvironmentCheck.gs', 'FullHealthCheck.gs', 'PreLaunchChecklist.gs',
    'IcsTestSend.gs', 'SoftRuleMetrics.gs', 'VersionCellAudit.gs', 'ConfigBaselineCheck.gs', 'SheetTextUpdate.gs', 'ConfigSeed.gs'];
  const RE = /職事表系統\s*(▸|→|>)|試算表選單|四階段流程|(維護|準備工作|查看|測試工具)\s*▸|選單「|選單的|上方的選單/;
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f) && MENU_ONLY.indexOf(f) === -1).map((f) => 'src/' + f)
    .concat(fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => /\.html$/.test(f) && f !== 'PreacherFillSidebar.html').map((f) => 'src/ui/' + f));
  const hits = [];
  files.forEach((f) => {
    const src = read(f);
    const owner = []; let cur = '';
    src.split('\n').forEach((l, i) => { const m = /^function (\w+)/.exec(l); if (m) cur = m[1]; owner[i + 1] = cur; });
    extractStringLiterals(src, f).forEach((s) => {
      if (!RE.test(s.text)) return;
      if (/\.gs$/.test(f) && /^run[A-Z]\w*_$/.test(owner[s.line] || '')) return;   // 試算表選單自己的對話框
      hits.push(f + ':' + s.line + '　' + s.text.slice(0, 60));
    });
  });
  check('★★★★★★ 介面、電郵、錯誤訊息沒有「職事表系統 ▸」「試算表選單」「四階段流程」「維護 ▸」等選單路徑（選單專用檔及 run*_ 除外）', hits.length === 0, hits.join('\n'));
  check('★★★★ 掃描器真的會報（自我檢查）', RE.test('請用「維護 ▸ 補建 Config 參數」') && RE.test('改用試算表選單'));
  check('★★★★★ 階段提醒、{NextAction} 寫幹事介面的做法', /STAGE_NEXT_ACTION\[QUARTER_STAGE\.DRAFT\] = '在幹事介面第 3 步按〔寄給堂委／執事〕';/.test(read('src/Constants.gs')));
}

console.log('\n=== ZD4：只可查看的人不見主試算表 ===');
{
  const g = scene().gas;
  const ID = ['FAKEID', 'abcdefghij', 'klmnopqrst'].join('-');
  const state = { a: 'https://docs.google.com/spreadsheets/d/' + ID + '/edit#gid=1', b: { c: ['ok', 'x/' + ID] }, d: 3, e: 'https://example.invalid/pub/preview' };
  const s = g.stripMainSpreadsheetUrlsForViewer_(state, [ID]);
  check('★★★★★★ 含主試算表 ID 的字串一律清空（巢狀物件、陣列）；其他照舊', s.a === '' && s.b.c[0] === 'ok' && s.b.c[1] === '' && s.d === 3 && s.e === state.e, JSON.stringify(s));
  g.readBlockedSpreadsheetIds_ = () => [ID];
  check('★★★★★★ 只可查看（VIEWER）⇒ 清空；可以修改 ⇒ 原封不動', g.viewerSafeState_('VIEWER', state).a === '' && g.viewerSafeState_('EDITOR', state).a === state.a);
  check('★★★★★ 狀態端點用它（伺服器端把關）', /return viewerSafeState_\(role, buildDashboardState_\(quarterId\)\);/.test(read('src/WebAppDashboard.gs')));
  const mf = read('src/ui/ScriptMainFlow.html');
  check('★★★★★★ 只可查看：只有〔查看事奉人員名單〕（唯讀視窗），沒有〔開啟事奉人員名單〕〔儲存並套用名單〕',
    /if \(viewOnly_\) \{[\s\S]{0,400}acts: \[stepButton\('查看事奉人員名單', \(\) => openEligibilityViewOnly\(\)\)\]/.test(mf));
  const z3 = read('src/ui/ScriptZone3.html');
  check('★★★★★★ 只可查看：常用設定不畫試算表連結（身分、固定收件人）', /if \(!viewOnly_\) \{\s*body\.appendChild\(row\(\[\s*settingsSheetLink\('身分（堂委／執事）'/.test(z3)
    && /if \(viewOnly_\) return null;/.test(z3));
}

console.log('\n=== ZD5：個人專屬連結 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.ensureNameMappingPersonalLinkTokenColumn_();
  let seq = 0;
  g.generatePersonalLinkToken_ = () => 'tok' + String(++seq).padStart(29, '0');
  const before = g.apiGetPersonalLinkTools();
  check('★★★★★ 列出還沒有連結的人', before.missing.length === 7, before.missing.length);
  const r = g.apiSeedPersonalLinkTokens();
  check('★★★★★★ 〔補發個人專屬連結〕只補還沒有的', r.count === 7 && g.apiGetPersonalLinkTools().missing.length === 0 && g.apiSeedPersonalLinkTokens().count === 0);
  let err = '';
  try { g.apiReissuePersonalLinkToken('P9701', '確認', 'Q'); } catch (e) { err = e.message; }
  check('★★★★★★ 重新產生要逐字輸入「確認重新產生」（強確認）', /確認文字不對/.test(err), err);
  const re = g.apiReissuePersonalLinkToken('P9701', '確認重新產生', sc.Q);
  check('★★★★★ 重新產生 ⇒ 新 token、AuditLog（不記 token）', re.ok && sc.audits('PERSONAL_LINK_TOKEN_REISSUED').length === 1
    && JSON.stringify(sc.audits('PERSONAL_LINK_TOKEN_REISSUED')).indexOf('tok000') === -1);
}

console.log('\n=== ZD6：補建設定及範本 ===');
{
  const sc = scene();
  const g = sc.gas;
  const p = g.apiPlanSeedConfigAndTemplates();
  check('★★★★★ 比對：列出缺少的設定行（包括本輪新 Config）', p.configMissing.some((c) => c.key === 'ROLLOUT_AUDIENCE') && p.configMissing.some((c) => c.key === 'ROSTER_CONTACT_TC'), JSON.stringify(p.configMissing.map((c) => c.key)).slice(0, 300));
  const r = g.apiSeedConfigAndTemplates();
  const p2 = g.apiPlanSeedConfigAndTemplates();
  check('★★★★★★ 補建之後沒有缺少；新設定是預設值（ROLLOUT_AUDIENCE=LEADERS、ADMIN_NOTIFY_*=FALSE）', r.ok && p2.configMissing.length === 0 && p2.templatesMissing.length === 0
    && g.readRolloutAudience_() === 'LEADERS' && g.getConfig_('ADMIN_NOTIFY_NO_EMAIL', true) === false, JSON.stringify(p2));
}

console.log('\n=== ZD7：上線切換／回到測試模式 ===');
{
  const g = scene().gas;
  const order = [];
  g.setConfigValue_ = (k, v) => { order.push(k + '=' + v); return { key: k, oldValue: 'x', newValue: v }; };
  g.assessGoLiveState_ = () => ({ prefixCleared: false, description: 'TEST', phase: 'TEST' });
  let ready = false;
  g.checkGoLiveReadiness_ = () => ({ ok: ready, mustCount: ready ? 0 : 2, shouldCount: 0, mustItems: [] });
  let err = '';
  try { g.apiGoLiveExecute('', '確認'); } catch (e) { err = e.message; }
  check('★★★★★★ 上線要逐字輸入「確認上線」', /確認文字不對/.test(err) && order.length === 0);
  err = '';
  try { g.apiGoLiveExecute('', '確認上線'); } catch (e) { err = e.message; }
  check('★★★★★★ 全面體檢有「必須處理」⇒ 拒絕，一個值都不改（和選單嚮導同一套檢查）', /必須處理/.test(err) && order.length === 0, err);
  ready = true;
  g.apiGoLiveExecute('', '確認上線');
  check('★★★★★★ 次序：先清空主旨前綴，最後 DRY_RUN=FALSE', order.join('；') === 'MAIL_SUBJECT_PREFIX=；DRY_RUN=FALSE', order.join('；'));
  order.length = 0;
  g.apiGoLiveRollback('確認回退');
  check('★★★★★★ 回退：先 DRY_RUN=TRUE（止血），再放回前綴', order.join('；') === 'DRY_RUN=TRUE；MAIL_SUBJECT_PREFIX=[測試] ', order.join('；'));
  err = '';
  g.assertWebAppRequestAllowed_ = () => 'VIEWER';
  try { g.apiGoLivePlan(''); } catch (e) { err = e.message; }
  check('★★★★★ 只限可以修改的人', /只限可以修改的人/.test(err), err);
}

console.log('\n=== ZD8：使用權限 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiSeedConfigAndTemplates();
  const realGet = g.getConfig_;
  const sets = [];
  g.setConfigValue_ = (k, v, src, action) => { sets.push([k, v, action]); return { key: k, oldValue: '', newValue: v }; };
  g.readWebAppEmailList_ = (k) => (k === 'WEBAPP_ALLOWED_EMAILS' ? [SELF] : []);
  void realGet;
  const base = { editors: [SELF], viewers: [], confirmers: [], adminNotify: [], rollout: 'LEADERS' };
  let err = '';
  try { g.apiSavePermissions(Object.assign({}, base, { viewers: ['not-an-email'] })); } catch (e) { err = e.message; }
  check('★★★★★★ 電郵格式不對 ⇒ 拒絕，沒有改動', /格式不對/.test(err) && sets.length === 0, err);
  err = '';
  try { g.apiSavePermissions(Object.assign({}, base, { editors: ['other@example.invalid'] })); } catch (e) { err = e.message; }
  check('★★★★★★ 不可以把自己從「可以修改」移走', /不可以把你自己/.test(err) && sets.length === 0, err);
  err = '';
  try { g.apiSavePermissions(Object.assign({}, base, { rollout: 'SOME' })); } catch (e) { err = e.message; }
  check('★★★★★ 開放範圍只可以是 LEADERS／ALL', /LEADERS 或 ALL/.test(err));
  const r = g.apiSavePermissions(Object.assign({}, base, { viewers: ['v@example.invalid'], rollout: 'ALL' }));
  check('★★★★★★ 改了的才寫（只可查看、開放範圍），每項寫 AuditLog「使用權限：改 Config」＋總結', r.changes.length === 2
    && sets.map((s) => s[0]).join() === 'WEBAPP_VIEWER_EMAILS,ROLLOUT_AUDIENCE' && sets.every((s) => s[2] === '使用權限：改 Config')
    && sc.audits('PERMISSIONS_SAVED').length === 1, JSON.stringify(sets));
  g.assertWebAppRequestAllowed_ = () => 'EDITOR';
  const p = g.apiGetPermissions();
  check('★★★★★ 畫面資料：四類名單、開放範圍、現任堂委／執事、每類一句說明', Array.isArray(p.editors) && Array.isArray(p.committee) && p.text.viewers && p.text.rollout);
  err = '';
  g.assertWebAppRequestAllowed_ = () => 'VIEWER';
  try { g.apiGetPermissions(); } catch (e) { err = e.message; }
  check('★★★★★★ 只可查看的人看不到使用權限（有各人電郵）', /只限可以修改的人/.test(err), err);
}

console.log('\n=== ZD9：暫時不做某崗位（崗位可多選）===');
{
  const sc = scene();
  const g = sc.gas;
  const X = sc.C.PERSON_POST_EXCLUSIONS;
  if (!sc.ss.getSheetByName(sc.S.PERSON_POST_EXCLUSIONS)) seedSheet(sc.ss, sc.S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), []);
  const bad = g.apiAddExclusions({ personId: 'P9701', postIds: ['READ', 'CHAIR'], reason: '', effectiveFrom: '', effectiveTo: '' });
  check('★★★★★ 原因留空 ⇒ 一行都不寫', bad.ok === false && g.readSheet_(sc.S.PERSON_POST_EXCLUSIONS).length === 0, JSON.stringify(bad));
  const r = g.apiAddExclusions({ personId: 'P9701', postIds: ['READ', 'CHAIR', 'READ'], reason: 'test 101', effectiveFrom: '', effectiveTo: '' });
  const rows = g.readSheet_(sc.S.PERSON_POST_EXCLUSIONS);
  check('★★★★★★ 兩個崗位 ⇒ 兩行（重複的只算一次）；解除日留空＝直至另行通知', r.ok && r.exclusionIds.length === 2 && rows.length === 2
    && rows.every((x) => String(x[X.EFFECTIVE_TO] || '') === ''), JSON.stringify(r));
  check('★★★★ 沒有選崗位 ⇒ 拒絕', g.apiAddExclusions({ personId: 'P9701', postIds: [], reason: 'x' }).ok === false);
  check('★★★★★ 介面：崗位用勾選（可多選）', /cb\.className = 'excl-post';/.test(read('src/ui/ScriptZone3.html')) && /callServerMutating\('apiAddExclusions'/.test(read('src/ui/ScriptZone3.html')));
}

console.log('\n=== ZG：上線前檢查 ===');
{
  const sc = scene();
  const g = sc.gas;
  const r = g.apiGetPreLaunchCheck();
  const labels = r.items.map((i) => i.label);
  ['自動排程已安裝', '自動寄信時間表已看過', '季前資料自動寄出（PRESEASON_AUTO_SEND）已決定', '自動生成（TRIGGER_AUTO_GENERATE）已決定',
    '幹事通知「沒有電郵名單」（ADMIN_NOTIFY_NO_EMAIL）已決定', '幹事通知「階段提醒」（ADMIN_NOTIFY_STAGE_REMINDERS）已決定', '開放範圍（ROLLOUT_AUDIENCE）已決定',
    '有修改要聯絡的人（ROSTER_CONTACT_TC）已填', '測試轉寄（MAIL_REDIRECT_ALL_TO）已清空', '已離開測試模式（DRY_RUN=FALSE）', '電郵範本是最新版',
    '沒有不能服侍的測試行（UnavailableSubmissions／Unavailable）', '沒有排表偏好的測試行（PersonPostWeight）', '沒有 Eligibility 舊 REQUEST 行',
    '申報時間表自動化（UNAVAILABLE_INVITE_AUTO）已開',   // 第一百零五輪批次 RB 組刻意加
    '影音組合（PostTeams）已填', '協唱（WorshipBackingSingers）已填', '指定寄信電郵（PreferredEmail）已填人數'].forEach((l) => {   // RG 組刻意加
    check('★★★★ 有一項「' + l + '」', labels.indexOf(l) !== -1);
  });
  check('★★★★★★ 每一項都有 ✔／✘、現時、去哪裏改（幹事介面位置）', r.items.every((i) => typeof i.ok === 'boolean' && i.value && i.where) && r.total === r.items.length);
  const item = (l) => r.items.filter((i) => i.label === l)[0];
  check('★★★★★ 未安裝自動排程 ⇒ ✘；沒有核對時間表 ⇒ ✘', item('自動排程已安裝').ok === false && item('自動寄信時間表已看過').ok === false);
  sc.triggers.push({ getHandlerFunction: () => 'dailyAutomationCheck_', getUniqueId: () => 'T', getEventType: () => 'CLOCK' });
  g.apiMarkAutomationScheduleReviewed();
  const r2 = g.apiGetPreLaunchCheck();
  check('★★★★★★ 安裝了、核對了 ⇒ ✔', r2.items.filter((i) => i.label === '自動排程已安裝')[0].ok && r2.items.filter((i) => i.label === '自動寄信時間表已看過')[0].ok);
  check('★★★★★ 只讀：沒有寫任何 Config', /function apiGetPreLaunchCheck\(\) \{\s*assertWebAppRequestAllowed_\('apiGetPreLaunchCheck'\);/.test(read('src/PreLaunchWeb.gs'))
    && read('src/PreLaunchWeb.gs').indexOf('setConfigValue_') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
