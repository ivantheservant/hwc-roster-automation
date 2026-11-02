// 第九十八輪批次 YB 組：已有版本之後開季前資料有改動 ⇒ 電郵通知幹事、狀態卡講明。
// 執行方式：node tests/round98_yb_preseason_change.test.js
//
//   YB1 純函式：短 hash、編碼還原、逐類比較（多了／少了／內容不同各 1 項）、電郵文字（標題、每類一行、行動句、連結）
//   YB2 建立版本時記下基準（PreseasonBaselines，第一次自動建立；九類＋通知簽名）；記不到也不令建立版本失敗
//   YB3 九類資料逐類偵測：名單、暫時不做、排表偏好、不能服侍（只看這一季）、詩班獻詩、合堂、預先安排、身分、規則
//   YB4 通知：同一批只通知一次；再有新改動 ⇒ 再通知；DRY_RUN 只記 Logger、AuditLog 寫 DRY_RUN；DRY_RUN 關 ⇒ 寄給幹事
//   YB5 不檢查：Config 關、沒有版本、季度已開始；沒有基準（部署前的版本）⇒ 補記；新版本 ⇒ 基準換新
//   YB6 每日檢查有這一步；狀態卡（同一個來源）；進階與診斷〔檢查開季前資料改動〕（改動類 api）；Config；範本樣本
// 用假資料（P97xx、假名、example.invalid）。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, T1 } = require('./helpers/unavailable_scene.js');
const { seedSheet } = require('./helpers/mock_sheets_realistic.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function setField(sc, sheetName, keyField, keyValue, field, value) {
  const sh = sc.ss.getSheetByName(sheetName);
  const keys = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  const kc = keys.indexOf(keyField) + 1;
  const fc = keys.indexOf(field) + 1;
  if (kc === 0 || fc === 0) throw new Error('沒有欄 ' + keyField + '／' + field);
  for (let r = 3; r <= sh.getLastRow(); r++) {
    const v = sh.getRange(r, kc).getValue();
    const text = Object.prototype.toString.call(v) === '[object Date]' ? sc.gas.toDateString_(v, sc.TZ) : String(v);
    if (text === keyValue) { sh.getRange(r, fc).setValue(value); return; }
  }
  throw new Error('找不到 ' + keyValue);
}

function scene(opts) {
  const sc = buildUnavailableScene(opts);
  const g = sc.gas;
  g.readWeightsForQuarterTune_ = () => ({ rows: [] });
  sc.cfg = () => g.readConfig_();
  sc.run = () => g.runPreseasonChangeNotify_(sc.Q, sc.today, sc.cfg(), g.getConfig_(g.CONFIG_KEYS.DRY_RUN, true) !== false, 'test');
  sc.baseRows = () => (sc.ss.getSheetByName(sc.S.PRESEASON_BASELINES) ? g.readSheet_(sc.S.PRESEASON_BASELINES) : []);
  sc.items = () => g.diffPreseasonSnapshots_(g.readPreseasonBaseline_(sc.Q).snapshot, g.readPreseasonSnapshot_(sc.Q, sc.TZ));
  sc.itemText = () => g.joinPreseasonChangeItems_(sc.items());
  return sc;
}

console.log('\n=== YB1：純函式 ===');
{
  const g = scene().gas;
  const h = g.preseasonHash_('甲|乙');
  check('★★★★★ hash 定長 7 字元、同一內容同一結果', h.length === 7 && h === g.preseasonHash_('甲|乙') && h !== g.preseasonHash_('甲|丙'));
  const m = g.buildPreseasonCategoryMap_([['P1|READ', 'T|T'], ['P2|READ', 'T|F'], ['P1|READ', 'T|T']]);
  check('★★★★★ 同一個鍵出現兩次 ⇒ 分開記（#2）', Object.keys(m).length === 3);
  const enc = g.encodePreseasonCategory_(m);
  check('★★★★★ 編碼可以還原', JSON.stringify(g.decodePreseasonCategory_(enc)) === JSON.stringify(Object.keys(m).sort().reduce((o, k) => { o[k] = m[k]; return o; }, {})));
  const base = { WEIGHT: { a: '1', b: '2', c: '3' }, RULES: { r: '1' } };
  const cur = { WEIGHT: { a: '1', b: '9', d: '4' }, RULES: { r: '1' }, ROLES: { x: '1' } };
  const d = g.diffPreseasonSnapshots_(base, cur);
  check('★★★★★★ 內容不同、少了、多了各算 1 項；沒有改動的類別不列；次序固定',
    JSON.stringify(d) === JSON.stringify([{ id: 'WEIGHT', label: '排表偏好', count: 3 }, { id: 'ROLES', label: '身分（堂委／執事）', count: 1 }]), JSON.stringify(d));
  check('★★★★★ 九類、名稱', g.PRESEASON_CHANGE_CATEGORIES.map((c) => c.label).join('／')
    === '名單／暫時不做／排表偏好／不能服侍／詩班獻詩／合堂／預先安排／身分（堂委／執事）／規則設定');
  const t = g.buildPreseasonChangeNotifyText_('[測試] ', '2099T1', 2,
    [{ id: 'WEIGHT', label: '排表偏好', count: 2 }, { id: 'PRE', label: '預先安排', count: 1 }], 'https://example.invalid/admin/exec?quarter=2099T1');
  check('★★★★★★ 標題「{季度} 職事表：開季前資料在第 N 版之後有改動」', t.subject === '[測試] 2099T1 職事表：開季前資料在第 2 版之後有改動', t.subject);
  check('★★★★★★ 內文每類一行「排表偏好：2 項」＋行動句＋幹事介面連結',
    /\n排表偏好：2 項\n預先安排：1 項\n/.test(t.body)
    && t.body.indexOf('請打開幹事介面，按〔請系統幫我調整〕，檢查後〔儲存〕成新一版，改動才會生效。') !== -1
    && /https:\/\/example\.invalid\/admin\/exec\?quarter=2099T1$/.test(t.body), t.body);
}

console.log('\n=== YB2：建立版本時記下基準 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('（前置）生成之前沒有基準工作表', !sc.ss.getSheetByName(sc.S.PRESEASON_BASELINES));
  g.apiGenerateDraftExecute(sc.Q);
  const rows = sc.baseRows();
  const B = sc.C.PRESEASON_BASELINES;
  check('★★★★★★ 建立第 0 版時自動建立 PreseasonBaselines，九類＋通知簽名一共 10 行', rows.length === 10
    && rows.every((r) => r[B.QUARTER_ID] === sc.Q && Number(r[B.VERSION_NO]) === 0), JSON.stringify(rows.map((r) => r[B.CATEGORY])));
  const sh = sc.ss.getSheetByName(sc.S.PRESEASON_BASELINES);
  check('★★★★★ 第 1 行中文標題、第 2 行機器鍵', sh.getRange(1, 1).getValue() === '季度'
    && sh.getRange(2, 1, 1, 5).getValues()[0].join(',') === 'QuarterID,VersionNo,Category,Data,CapturedAt');
  check('★★★★★ 剛建立版本 ⇒ 沒有改動', sc.items().length === 0, sc.itemText());
  check('★★★★★★ registerVersion_() 叫 capturePreseasonBaselineSafe_()', /capturePreseasonBaselineSafe_\(quarterId, versionNo\);\n\}/.test(read('src/RosterWriter.gs')));
  const realRead = g.readPreseasonSnapshot_;
  g.readPreseasonSnapshot_ = () => { throw new Error('模擬讀不到'); };
  let threw = false;
  try { g.capturePreseasonBaselineSafe_(sc.Q, 0); } catch (e) { threw = true; }
  g.readPreseasonSnapshot_ = realRead;
  check('★★★★★★ 記不到基準不會拋錯（不令建立版本失敗）', threw === false);
}

console.log('\n=== YB3：九類逐類偵測 ===');
{
  const sc = scene();
  const g = sc.gas;
  const C = sc.C; const S = sc.S;
  g.apiGenerateDraftExecute(sc.Q);
  const expect = (label, want) => {
    const got = sc.itemText();
    check('★★★★★★ ' + label + ' ⇒ ' + want, got === want, got);
  };
  setField(sc, S.ELIGIBILITY, C.ELIGIBILITY.ELIGIBILITY_ID, 'E0', C.ELIGIBILITY.ELIGIBLE, false);
  expect('名單：一行改了 Eligible', '名單 1 項');
  const X = C.PERSON_POST_EXCLUSIONS;
  seedSheet(sc.ss, S.PERSON_POST_EXCLUSIONS, ['X'], Object.keys(X).map((k) => X[k]), [{ [X.EXCLUSION_ID]: 'X1', [X.PERSON_ID]: 'P9701', [X.POST_ID]: 'CHAIR', [X.ACTIVE]: true }]);
  expect('暫時不做：加一行', '名單 1 項、暫時不做 1 項');
  const Wt = C.PERSON_POST_WEIGHT;
  seedSheet(sc.ss, S.PERSON_POST_WEIGHT, ['W'], Object.keys(Wt).map((k) => Wt[k]), [
    { [Wt.WEIGHT_ID]: 'W1', [Wt.PERSON_ID]: 'P9702', [Wt.POST_ID]: 'READ', [Wt.ADJUST]: 1, [Wt.ACTIVE]: true },
    { [Wt.WEIGHT_ID]: 'W2', [Wt.PERSON_ID]: 'P9703', [Wt.POST_ID]: 'READ', [Wt.ADJUST]: -1, [Wt.ACTIVE]: true }]);
  expect('排表偏好：加兩行', '名單 1 項、暫時不做 1 項、排表偏好 2 項');
  const U = C.UNAVAILABLE;
  sc.appendRows(sc.ss, S.UNAVAILABLE, Object.keys(U).map((k) => U[k]), [
    { [U.UNAVAILABLE_ID]: 'U1', [U.PERSON_ID]: 'P9704', [U.DATE_FROM]: T1[1], [U.DATE_TO]: T1[1], [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL' },
    { [U.UNAVAILABLE_ID]: 'U2', [U.PERSON_ID]: 'P9704', [U.DATE_FROM]: '2099-05-03', [U.DATE_TO]: '2099-05-03', [U.STATUS]: 'ACTIVE', [U.APPLIES_TO]: 'ALL' }]);
  expect('不能服侍：這一季加一行（下一季那一行不計）', '名單 1 項、暫時不做 1 項、排表偏好 2 項、不能服侍 1 項');
  const sd = sc.ss.getSheetByName(S.SERVICE_DATES);
  g.ensureServiceDatesChoirColumn_(sd);
  g.ensureServiceDatesCombinedColumns_(sd);
  check('★★★★★ 只是補欄（值空白）⇒ 不算改動', sc.itemText() === '名單 1 項、暫時不做 1 項、排表偏好 2 項、不能服侍 1 項', sc.itemText());
  setField(sc, S.SERVICE_DATES, C.SERVICE_DATES.SERVICE_DATE, T1[0], C.SERVICE_DATES.CHOIR_SINGING, true);
  setField(sc, S.SERVICE_DATES, C.SERVICE_DATES.SERVICE_DATE, T1[3], C.SERVICE_DATES.COMBINED_KIND, 'COMBINED');
  expect('詩班獻詩、合堂各一個主日', '名單 1 項、暫時不做 1 項、排表偏好 2 項、不能服侍 1 項、詩班獻詩 1 項、合堂 1 項');
  g.apiSavePreAssignments(sc.Q, [{ serviceDate: T1[1], postId: 'WORSHIP', slotIndex: 1, personId: 'P9701', freeText: '' }]);
  const R = C.ROLES;
  sc.appendRows(sc.ss, S.ROLES, Object.keys(R).map((k) => R[k]), [{ [R.ROLE_ASSIGNMENT_ID]: 'R1', [R.PERSON_ID]: 'P9705', [R.ROLE_CODE]: 'COMMITTEE', [R.ACTIVE]: true }]);
  setField(sc, S.RULE_SETTINGS, C.RULE_SETTINGS.RULE_ID, 'SEMI_NO_CONSECUTIVE', C.RULE_SETTINGS.ENABLED, false);
  expect('預先安排、身分（直接在工作表改，AuditLog 沒有紀錄）、規則設定',
    '名單 1 項、暫時不做 1 項、排表偏好 2 項、不能服侍 1 項、詩班獻詩 1 項、合堂 1 項、預先安排 1 項、身分（堂委／執事） 1 項、規則設定 1 項');
  const dash = g.describePreseasonChangeForDashboard_(sc.Q, 0);
  check('★★★★★★ 狀態卡：「第 0 版之後，開季前資料有改動：……」（同電郵同一個來源）', dash.count === 9
    && dash.text.indexOf('第 0 版之後，開季前資料有改動：名單 1 項、') === 0, dash.text);
  setField(sc, S.ELIGIBILITY, C.ELIGIBILITY.ELIGIBILITY_ID, 'E0', C.ELIGIBILITY.ELIGIBLE, true);
  check('★★★★★ 改回原狀 ⇒ 那一類不再列出', sc.items().every((i) => i.id !== 'ELIG'));
}

console.log('\n=== YB4：通知 ===');
{
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  const before = sc.run();
  check('★★★★★ 沒有改動 ⇒ 不通知', before.outcome === 'SKIP' && before.detail === 'NO_CHANGE', JSON.stringify(before));
  const Wt = sc.C.PERSON_POST_WEIGHT;
  seedSheet(sc.ss, sc.S.PERSON_POST_WEIGHT, ['W'], Object.keys(Wt).map((k) => Wt[k]), [
    { [Wt.WEIGHT_ID]: 'W1', [Wt.PERSON_ID]: 'P9702', [Wt.POST_ID]: 'READ', [Wt.ADJUST]: 1, [Wt.ACTIVE]: true }]);
  const logs = [];
  g.log_ = (lv, msg) => logs.push(msg);
  const r1 = sc.run();
  const audits = () => sc.audits('PRESEASON_CHANGE_NOTIFIED');
  check('★★★★★★ 有改動 ⇒ 通知（DRY_RUN：模擬）', r1.outcome === 'SENT' && /模擬通知幹事/.test(r1.detail), JSON.stringify(r1));
  check('★★★★★★ DRY_RUN ⇒ 不寄，只寫 Logger', sc.mails.length === 0 && logs.some((l) => /\[DRY_RUN\][\s\S]*開季前資料在第 0 版之後有改動/.test(l)));
  check('★★★★★★ AuditLog PRESEASON_CHANGE_NOTIFIED（DRY_RUN、改動類別）', audits().length === 1
    && /\|DRY_RUN$/.test(audits()[0][sc.C.AUDIT_LOG.NEW_VALUE]) && audits()[0][sc.C.AUDIT_LOG.NOTES] === '排表偏好 1 項', JSON.stringify(audits()));
  const r2 = sc.run();
  check('★★★★★★ 同一批改動只通知一次', r2.outcome === 'SKIP' && r2.detail === 'ALREADY_NOTIFIED' && audits().length === 1, JSON.stringify(r2));
  g.apiSavePreAssignments(sc.Q, [{ serviceDate: T1[1], postId: 'WORSHIP', slotIndex: 1, personId: 'P9701', freeText: '' }]);
  const r3 = sc.run();
  check('★★★★★★ 再有新改動 ⇒ 再通知（列出排表偏好及預先安排）', r3.outcome === 'SENT' && audits().length === 2
    && audits()[1][sc.C.AUDIT_LOG.NOTES] === '排表偏好 1 項、預先安排 1 項', JSON.stringify(audits().map((a) => a[sc.C.AUDIT_LOG.NOTES])));
}
{
  const sc = scene({ config: { DRY_RUN: ['FALSE', 'BOOL'], WEBAPP_STEWARD_URL: ['https://example.invalid/admin/exec', 'STR'] } });
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  setField(sc, sc.S.RULE_SETTINGS, sc.C.RULE_SETTINGS.RULE_ID, 'SEMI_NO_CONSECUTIVE', sc.C.RULE_SETTINGS.ENABLED, false);
  sc.mails.length = 0;
  const r = sc.run();
  const m = sc.mails.filter((x) => /開季前資料/.test(x.subject));
  check('★★★★★★ DRY_RUN 關 ⇒ 寄給幹事（MAIL_ADMIN_NOTIFY），內文有幹事介面連結', r.outcome === 'SENT' && m.length === 1
    && m[0].to === 'clerk@example.invalid' && m[0].subject === '2099T1 職事表：開季前資料在第 0 版之後有改動'
    && /規則設定：1 項/.test(m[0].body) && /https:\/\/example\.invalid\/admin\/exec\?quarter=2099T1/.test(m[0].body), JSON.stringify(sc.mails));
  check('★★★★★ AuditLog 寫 SENT', /\|SENT$/.test(sc.audits('PRESEASON_CHANGE_NOTIFIED')[0][sc.C.AUDIT_LOG.NEW_VALUE]));
}

console.log('\n=== YB5：不檢查的情況；基準補記、換新 ===');
{
  const sc = scene();
  const g = sc.gas;
  const none = sc.run();
  check('★★★★★ 沒有版本 ⇒ 不檢查', none.outcome === 'SKIP' && none.detail === 'NO_VERSION');
  g.apiGenerateDraftExecute(sc.Q);
  const sh = sc.ss.getSheetByName(sc.S.PRESEASON_BASELINES);
  sh.deleteRows(3, sh.getLastRow() - 2);
  const cap = sc.run();
  check('★★★★★★ 沒有基準（部署前已有的版本）⇒ 補記，這一次不通知', cap.outcome === 'SKIP' && cap.detail === 'BASELINE_CAPTURED' && sc.baseRows().length === 10,
    JSON.stringify(cap));
  check('★★★★★ 補記之後沒有改動', sc.run().detail === 'NO_CHANGE');
  setField(sc, sc.S.RULE_SETTINGS, sc.C.RULE_SETTINGS.RULE_ID, 'SEMI_NO_CONSECUTIVE', sc.C.RULE_SETTINGS.ENABLED, false);
  g.performRosterGeneration_(sc.Q);   // 第 1 版（同一個 registerVersion_()）
  check('★★★★★★ 建立新一版 ⇒ 基準換新（第 1 版），之前的改動不再算', sc.baseRows().every((r) => Number(r[sc.C.PRESEASON_BASELINES.VERSION_NO]) === 1)
    && sc.run().detail === 'NO_CHANGE' && g.describePreseasonChangeForDashboard_(sc.Q, 1).count === 0);
  setField(sc, sc.S.RULE_SETTINGS, sc.C.RULE_SETTINGS.RULE_ID, 'SEMI_NO_CONSECUTIVE', sc.C.RULE_SETTINGS.ENABLED, true);
  const today = sc.today;
  sc.today = '2099-01-01';
  const started = sc.run();
  check('★★★★★★ 季度已開始（今日 ≥ StartDate）⇒ 不檢查、狀態卡不顯示', started.outcome === 'SKIP' && started.detail === 'STARTED'
    && g.describePreseasonChangeForDashboard_(sc.Q, 1).count === 0, JSON.stringify(started));
  sc.today = today;
  setField(sc, sc.S.CONFIG, sc.C.CONFIG.KEY, 'DRY_RUN', sc.C.CONFIG.VALUE, 'TRUE');
  sc.appendRows(sc.ss, sc.S.CONFIG, [sc.C.CONFIG.KEY, sc.C.CONFIG.VALUE, sc.C.CONFIG.TYPE], [{ [sc.C.CONFIG.KEY]: 'PRESEASON_CHANGE_NOTIFY', [sc.C.CONFIG.VALUE]: 'FALSE', [sc.C.CONFIG.TYPE]: 'BOOL' }]);
  if (g.clearConfigCache_) g.clearConfigCache_();
  const off = sc.run();
  check('★★★★★★ Config PRESEASON_CHANGE_NOTIFY＝FALSE ⇒ 不檢查', off.outcome === 'SKIP' && off.detail === 'DISABLED', JSON.stringify(off));
}

console.log('\n=== YB6：每日檢查、狀態卡、進階與診斷、Config、範本樣本 ===');
{
  const trig = read('src/Trigger.gs');
  check('★★★★★★ 每日檢查逐季叫 runPreseasonChangeNotify_（包 try/catch，出錯只影響這一項）',
    /try \{\n\s*const changed = runPreseasonChangeNotify_\(quarterId, today, config, isDryRun, 'dailyAutomationCheck_'\);[\s\S]{0,200}\} catch \(err\) \{\n\s*log_\('WARN', 'dailyAutomationCheck_: 開季前資料改動/.test(trig));
  check('★★★★★ 主畫面資料有 preseasonChange；狀態卡顯示', /preseasonChange: preseasonChange/.test(read('src/WebAppDashboard.gs'))
    && /\.concat\(buildPlainWarnNodes\(d\.preseasonChange\)\)/.test(read('src/ui/Script.html')));
  const src = read('src/PreseasonChange.gs');
  check('★★★★★★ 〔檢查開季前資料改動〕是改動類 api（assertWebAppRequestAllowed_()＋withMutationLock_），不在唯讀清單',
    /function apiRunPreseasonChangeCheck\(quarterId\) \{\n  assertWebAppRequestAllowed_\(\);\n  return withMutationLock_\(/.test(src)
    && !/apiRunPreseasonChangeCheck/.test(read('src/WebApp.gs')) && /callServerMutating\('apiRunPreseasonChangeCheck', currentQuarterId\)/.test(read('src/ui/ScriptZone4.html')));
  check('★★★★★ ConfigSeed：PRESEASON_CHANGE_NOTIFY BOOL 預設 TRUE',
    /key: CONFIG_KEYS\.PRESEASON_CHANGE_NOTIFY, type: CONFIG_TYPES\.BOOL[\s\S]{0,80}defaultValue: 'TRUE'/.test(read('src/ConfigSeed.gs')));
  check('★★★★★ 範本樣本有這一封', /幹事通知：開季前資料有改動/.test(read('src/TemplateSamples.gs')));
  const sc = scene();
  const g = sc.gas;
  g.apiGenerateDraftExecute(sc.Q);
  setField(sc, sc.S.RULE_SETTINGS, sc.C.RULE_SETTINGS.RULE_ID, 'SEMI_NO_CONSECUTIVE', sc.C.RULE_SETTINGS.ENABLED, false);
  const res = g.apiRunPreseasonChangeCheck(sc.Q);
  check('★★★★★★ 〔檢查開季前資料改動〕立即檢查這一季：通知並講明', res.ok && res.outcome === 'SENT' && /規則設定 1 項/.test(res.message), JSON.stringify(res));
  const again = g.apiRunPreseasonChangeCheck(sc.Q);
  check('★★★★★ 再按 ⇒ 「這一批改動已經通知過」', /已經通知過/.test(again.message), again.message);
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAIL');
process.exitCode = fail === 0 ? 0 : 1;
