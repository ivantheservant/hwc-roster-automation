// 第八十五輪批次 LE 組：合堂主日（開季前準備〔合堂主日〕）。
// 執行方式：node tests/round85_le_combined.test.js
//
//   LE1　種類清單來自 Config COMBINED_SERVICE_KINDS（預設合堂／浸禮／堂慶；可以加；格式不對退回預設）
//   LE2　儲存：ServiceDates 自動加 CombinedKind／CombinedName；每改一週寫 AuditLog；重新開啟見到已儲存；
//        沒有選種類 ⇒ 名稱清空；不可以選的種類 ⇒ 拒絕、甚麼都沒有儲存
//   LE3　不改動職事表：派工、每週標題都不變
//   LE4　整季重設（幹事介面）保留、會保留段寫「合堂主日 N 週」；選單版清空
//   LE5　畫面：〔合堂主日〕在〔不能服侍的日期〕〔排表偏好〕同一行；視窗標題和說明句；名稱選了種類才可以填
//   LE6　週報系統說明第 5、9 節有這兩欄
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function scene() {
  const sc = buildRound75Scene({ extraFiles: ['WebAppCombined.gs', 'CellDecisions.gs', 'QuarterReset.gs', 'Menu.gs', 'WebAppQuarterReset.gs'] });
  sc.gas.listRosterPdfFilesForQuarter_ = function () { return []; };
  sc.gas.listEditableCopyFilesForQuarter_ = function () { return []; };
  sc.gas.listEmptyVersionFoldersForReset_ = function () { return []; };
  return sc;
}

console.log('\n=== LE1：種類清單 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('★★★★★ 預設：合堂／浸禮／堂慶', JSON.stringify(g.readCombinedServiceKinds_().map((k) => k.code + '=' + k.label))
    === JSON.stringify(['COMBINED=合堂', 'BAPTISM=浸禮', 'ANNIVERSARY=堂慶']));
  check('★★★★★ 可以加（Config 改）', g.parseCombinedServiceKinds_('COMBINED=合堂,MISSION=宣教主日').map((k) => k.label).join('、') === '合堂、宣教主日');
  check('★★★★ 格式不對 ⇒ 退回預設', g.parseCombinedServiceKinds_('亂寫').length === 3);
  check('★★★★ Config 有登記（種子、預設值）', g.CONFIG_KEYS.COMBINED_SERVICE_KINDS === 'COMBINED_SERVICE_KINDS'
    && /COMBINED=合堂,BAPTISM=浸禮,ANNIVERSARY=堂慶/.test(read('src/ConfigSeed.gs')));
}

console.log('\n=== LE2／LE3：儲存、不改動職事表 ===');
{
  const sc = scene();
  const g = sc.gas; const D = sc.DATES; const C = sc.C; const S = sc.S;
  g.apiGenerateDraftExecute(sc.Q);
  const before = JSON.stringify(sc.rows(0).map((r) => [r[C.ROSTER_ASSIGNMENTS.POST_ID], r[C.ROSTER_ASSIGNMENTS.PERSON_ID]]));
  const open1 = g.apiGetCombinedServices(sc.Q);
  check('★★★★ 每個主日一行，預設不是合堂', open1.weeks.length === 4 && open1.weeks.every((w) => w.kind === ''), JSON.stringify(open1.weeks));
  check('★★★★★ 說明句', open1.note === '這個設定會傳給週報系統，不會改動職事表；合堂時不需要的崗位，請在職事表自行清空。');
  const res = g.apiSaveCombinedServices(sc.Q, [
    { serviceDate: D[0], kind: '', name: '' },
    { serviceDate: D[1], kind: 'BAPTISM', name: '' },
    { serviceDate: D[2], kind: 'COMBINED', name: 'Mission Month' },
    { serviceDate: D[3], kind: '', name: '不應該寫入' }]);
  check('★★★★★ 儲存 2 週', res.ok && res.changed === 2, JSON.stringify(res));
  const keys = sc.ss.getSheetByName(S.SERVICE_DATES).getRange(2, 1, 1, sc.ss.getSheetByName(S.SERVICE_DATES).getLastColumn()).getValues()[0];
  check('★★★★★ ServiceDates 自動加 CombinedKind、CombinedName', keys.indexOf('CombinedKind') !== -1 && keys.indexOf('CombinedName') !== -1, JSON.stringify(keys));
  const open2 = g.apiGetCombinedServices(sc.Q);
  check('★★★★★★ 重新開啟見到已儲存（第 2 週浸禮、第 3 週合堂：Mission Month）',
    open2.weeks[1].kind === 'BAPTISM' && open2.weeks[2].kind === 'COMBINED' && open2.weeks[2].name === 'Mission Month'
    && open2.weeks[3].kind === '' && open2.weeks[3].name === '', JSON.stringify(open2.weeks));
  check('★★★★ 顯示「合堂：Mission Month」', g.describeCombinedService_(open2.weeks[2]) === '合堂：Mission Month');
  const audit = g.readSheet_(S.AUDIT_LOG).filter((r) => r[C.AUDIT_LOG.ACTION] === 'COMBINED_SERVICE_CHANGED');
  check('★★★★★ 每改一週寫 AuditLog（2 筆）', audit.length === 2 && /浸禮/.test(audit[0][C.AUDIT_LOG.NEW_VALUE]), JSON.stringify(audit.map((a) => a[C.AUDIT_LOG.NEW_VALUE])));
  let threw = '';
  try { g.apiSaveCombinedServices(sc.Q, [{ serviceDate: D[0], kind: 'XXX', name: '' }]); } catch (err) { threw = err.message; }
  check('★★★★★ 不可以選的種類 ⇒ 拒絕、甚麼都沒有儲存', /不是可以選的合堂種類/.test(threw) && g.apiGetCombinedServices(sc.Q).weeks[0].kind === '', threw);
  const again = g.apiSaveCombinedServices(sc.Q, open2.weeks.map((w) => ({ serviceDate: w.serviceDate, kind: w.kind, name: w.name })));
  check('★★★★ 沒有改動 ⇒ 0 週', again.changed === 0);
  const after = JSON.stringify(sc.rows(0).map((r) => [r[C.ROSTER_ASSIGNMENTS.POST_ID], r[C.ROSTER_ASSIGNMENTS.PERSON_ID]]));
  check('★★★★★★ 不改動職事表（派工不變）', before === after);
  check('★★★★★ 不改每週標題', g.readSheet_(S.SERVICE_DATES).every((r) => !r[C.SERVICE_DATES.TITLE]));
  check('★★★★ 版本數不變（沒有新版本）', g.readSheet_(S.ROSTER_VERSIONS).length === 1);
}

console.log('\n=== LE4：整季重設 ===');
{
  const sc = scene();
  const g = sc.gas; const D = sc.DATES;
  g.apiGenerateDraftExecute(sc.Q);
  g.apiSaveCombinedServices(sc.Q, [{ serviceDate: D[1], kind: 'BAPTISM', name: '' }, { serviceDate: D[2], kind: 'COMBINED', name: 'Mission Month' }]);
  const p = g.apiQuarterResetPlan(sc.Q);
  check('★★★★★★ 會保留：合堂主日 2 週', p.keptLines.indexOf('合堂主日 2 週') !== -1, JSON.stringify(p.keptLines));
  g.apiQuarterResetExecute(sc.Q, '確認重設');
  check('★★★★★★ 幹事介面重設之後兩週仍在', g.apiGetCombinedServices(sc.Q).weeks.filter((w) => w.kind).length === 2);
  const plan = g.planQuarterReset_(sc.Q, true);
  check('★★★★ 選單版計畫：合堂主日 2 週會清', plan.combinedDates.length === 2);
  g.executeQuarterResetBatch_([{ quarterId: sc.Q, plan: plan }]);
  check('★★★★★ 選單版清空', g.apiGetCombinedServices(sc.Q).weeks.every((w) => !w.kind));
}

console.log('\n=== LE5：畫面 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T3';", ui);
  ui.renderZone2Body({ preQuarter: { undoneItemCount: 0, items: [] }, staffing: { totalBlanks: 0, shortPostCount: 0, posts: [] } });
  const body = ui.document.getElementById('zone2Body');
  const rowBtns = body.flatten().filter((n) => n.className === 'row' || /\brow\b/.test(n.className || ''))
    .map((r) => r.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent)).filter((l) => l.indexOf('合堂主日') !== -1)[0];
  check('★★★★★★ 〔合堂主日〕在〔不能服侍的日期〕〔排表偏好〕同一行',
    JSON.stringify(rowBtns) === JSON.stringify(['不能服侍的日期', '排表偏好', '合堂主日']), JSON.stringify(rowBtns));
  ui.callServer = async function (name) {
    if (name === 'apiGetCombinedServices') {
      return { quarterLabel: '2028年7-9月', note: '這個設定會傳給週報系統，不會改動職事表；合堂時不需要的崗位，請在職事表自行清空。',
        kinds: [{ code: 'COMBINED', label: '合堂' }, { code: 'BAPTISM', label: '浸禮' }, { code: 'ANNIVERSARY', label: '堂慶' }],
        weeks: [{ serviceDate: '2028-07-02', kind: '', name: '' }, { serviceDate: '2028-07-09', kind: 'BAPTISM', name: '' }] };
    }
    return {};
  };
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  ui.openCombinedServices();
  setTimeout(() => {
    const title = ui.document.getElementById('modalTitle').textContent;
    const mb = ui.document.getElementById('modalBody');
    const selects = mb.flatten().filter((n) => n.tagName === 'SELECT');
    const inputs = mb.flatten().filter((n) => n.tagName === 'INPUT');
    check('★★★★★ 視窗標題「合堂主日：2028年7-9月」', title === '合堂主日：2028年7-9月', title);
    check('★★★★★ 每個主日一個下拉（不是合堂／合堂／浸禮／堂慶）',
      selects.length === 2 && selects[0].flatten().filter((n) => n.tagName === 'OPTION').map((o) => o.textContent).join('／') === '不是合堂／合堂／浸禮／堂慶');
    check('★★★★★ 名稱選了種類才可以填（第 1 週不可填、第 2 週可以）', inputs[0].disabled === true && inputs[1].disabled === false);
    check('★★★★ 說明句在視窗', /這個設定會傳給週報系統，不會改動職事表/.test(mb.textContent));
    const doc = read('docs/週報系統讀取職事表資料說明.md');
    console.log('\n=== LE6：週報系統說明 ===');
    check('★★★★★ 第 5 節有 CombinedKind／CombinedName、空白＝不是合堂、和 Title 的關係',
      /`ServiceDates\.CombinedKind`/.test(doc) && /`ServiceDates\.CombinedName`/.test(doc) && /空白＝不是合堂/.test(doc) && /和 `Title` 的關係/.test(doc));
    check('★★★★★ 第 9 節有第八十五輪（堂委／執事要展開；按鈕改名）', /\| 第八十五輪 \|[^\n]*ROLE:COMMITTEE[^\n]*整季重設/.test(doc));
    console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
    process.exitCode = fail === 0 ? 0 : 1;
  }, 30);
}
