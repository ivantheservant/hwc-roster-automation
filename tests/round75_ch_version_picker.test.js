// 第七十五輪批次 CH 組：第 2 步嘅版本下拉（Ivan 已決定做法）。
// 執行方式：node tests/round75_ch_version_picker.test.js
//
//   CH1　版本清單：全部版本、新到舊；每項「第 N 版　yyyy-MM-dd HH:mm　來源　由誰」；預設＝最新一版
//   CH2　來源人話：系統生成／重新生成／人手調整後／系統調整／由人手職事表匯入／以第 M 版作起點
//   CH3　〔用這一版作起點〕：把那一版的格子＋每週標題按機器鍵寫入最新那張工作表；唔建立新版本、舊版本唔改
//   CH4　之後〔儲存〕⇒ 新一版來源「以第 M 版作起點」；再之後嘅儲存唔再沿用
//   CH5　〔查看這一版〕：舊版本未有保護就加（只提示）；最新一版唔加
//   CH6　畫面：揀最新 ⇒〔查看／修改職事表〕；揀舊版本 ⇒〔查看這一版〕（新分頁）〔用這一版作起點〕（先問）；
//        第 2 步〔回到上一個儲存版本〕、進階與診斷〔回到上一個版本〕拿走

const vm = require('vm');
const { buildRound75Scene } = require('./helpers/round75_harness.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene();
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);

const v0Chair = sc.getCell(0, D[0], 'CHAIR#1');
const otherChair = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => n !== v0Chair)[0];
const v0Title1 = sc.getCell(0, D[1], '_TYPE');
const v0RowsAtStart = JSON.stringify(sc.rows(0));

// v1：改主席＋改第 2 週標題
sc.setCell(0, D[0], 'CHAIR#1', otherChair);
sc.setCell(0, D[1], '_TYPE', '聖餐主日');
let res = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）第 1 版建立', res && res.versionNo === 1, JSON.stringify(res).slice(0, 300));

console.log('\n=== CH1／CH2：版本清單 ===');
{
  const list = gas.listQuarterVersionChoices_(sc.Q, sc.TZ);
  check('★★★★★ 全部版本、新到舊', list.length === 2 && list[0].versionNo === 1 && list[1].versionNo === 0,
    JSON.stringify(list));
  check('★★★★★ 最新一版標明 isLatest', list[0].isLatest === true && list[1].isLatest === false);
  check('★★★★★★ 每項：第 N 版　日期時間　來源　由誰',
    list[0].label === '第 1 版　2099-01-01 09:00　人手調整後　k'
      && list[1].label === '第 0 版　2099-01-01 09:00　系統生成　k', JSON.stringify(list.map((v) => v.label)));
  check('★★★★ 每版帶工作表網址（〔查看這一版〕用）', list.every((v) => /^https:\/\//.test(v.sheetUrl || '')),
    JSON.stringify(list.map((v) => v.sheetUrl)));
  const dash = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 主畫面帶住同一份清單', (dash.versionChoices || []).length === 2
    && dash.versionChoices[0].label === list[0].label, JSON.stringify(dash.versionChoices).slice(0, 300));

  const V = sc.C.ROSTER_VERSIONS;
  const src = (basis, parent) => gas.describeVersionSource_({ [V.BASIS]: basis, [V.PARENT_VERSION_NO]: parent });
  check('★★★★★ 來源：系統生成（第一版）／重新生成（之前有版本）',
    src('AUTO_GENERATE', '') === '系統生成' && src('AUTO_GENERATE', 0) === '重新生成');
  check('★★★★★ 來源：人手調整後／系統調整／由人手職事表匯入',
    src('FINE_TUNE', 0) === '人手調整後' && src('SUGGESTION', 1) === '系統調整'
      && src('IMPORT', '') === '由人手職事表匯入');
  check('★★★★ 接受建議表嘅版本寫 SUGGESTION（唔再同人手調整混埋）',
    /VERSION_VALUES\.BASIS_SUGGESTION, versionNo, 0, false,/.test(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'SuggestionSheet.gs'), 'utf8')));

  // 由誰：DisplayName → NameTC → 電郵 @ 前面
  const realRead = gas.readSheet;
  gas.readSheet = function (name) {
    if (name === sc.S.EMAIL_RECIPIENTS) {
      return [{ [sc.C.EMAIL_RECIPIENTS.EMAIL]: 'Admin@Example.invalid', [sc.C.EMAIL_RECIPIENTS.DISPLAY_NAME]: '幹事甲' }];
    }
    return realRead(name);
  };
  const who = gas.buildVersionAuthorResolver_();
  gas.readSheet = realRead;
  check('★★★★★ 由誰：有顯示名稱用顯示名稱（電郵唔分大細楷）', who('admin@example.invalid') === '幹事甲');
  check('★★★★★ 由誰：冇顯示名稱就用名單名字', who('p9702@example.invalid') === sc.nameOf('P9702'));
  check('★★★★★ 由誰：都冇就電郵 @ 前面部分（唔顯示成條電郵）', who('someone@example.invalid') === 'someone');
}

console.log('\n=== CH3：用第 0 版作起點 ===');
{
  const versionsBefore = gas.readSheet(sc.S.ROSTER_VERSIONS).length;
  const v0RowsBefore = JSON.stringify(sc.rows(0));
  const v1RowsBefore = JSON.stringify(sc.rows(1));
  const v0SheetBefore = JSON.stringify(sc.gridSheet(0).getDataRange().getValues());
  sc.setCell(1, D[2], 'READ#1', '亂打的字');   // 未儲存嘅改動：會被蓋過
  const r = gas.apiUseVersionAsStartPoint(sc.Q, 0);
  check('★★★★★★ 格子寫入最新那一張（主席返返第 0 版嘅人）', sc.getCell(1, D[0], 'CHAIR#1') === v0Chair,
    sc.getCell(1, D[0], 'CHAIR#1'));
  check('★★★★★★ 每週標題都寫入（第 2 週返返第 0 版嘅標題）', sc.getCell(1, D[1], '_TYPE') === v0Title1,
    sc.getCell(1, D[1], '_TYPE'));
  check('★★★★★ 未儲存嘅改動被蓋過', sc.getCell(1, D[2], 'READ#1') === sc.getCell(0, D[2], 'READ#1'));
  check('★★★★ 回報寫入幾多格、幾多週', r.ok === true && r.cellCount === 2 && r.titleCount === 1, JSON.stringify(r));
  check('★★★★★★ 唔建立新版本', gas.readSheet(sc.S.ROSTER_VERSIONS).length === versionsBefore);
  check('★★★★★★ 舊版本一律唔改：第 0、1 版派工紀錄、第 0 版工作表原封不動',
    JSON.stringify(sc.rows(0)) === v0RowsBefore && JSON.stringify(sc.rows(1)) === v1RowsBefore
      && JSON.stringify(sc.gridSheet(0).getDataRange().getValues()) === v0SheetBefore);
  const marks = gas.readSheet(sc.S.AUDIT_LOG).filter((a) => a[sc.C.AUDIT_LOG.ACTION] === 'VERSION_START_POINT');
  check('★★★★★ AuditLog 有一個起點標記（季度、寫入時最新一版、起點）', marks.length === 1
    && marks[0][sc.C.AUDIT_LOG.TARGET_KEY] === sc.Q && String(marks[0][sc.C.AUDIT_LOG.OLD_VALUE]) === '1'
    && String(marks[0][sc.C.AUDIT_LOG.NEW_VALUE]) === '0', JSON.stringify(marks));
  const unsaved = gas.apiGetDashboardState(sc.Q);
  check('★★★★★ 主畫面見到有未儲存的改動', unsaved.unsaved && unsaved.unsaved.hasAny === true,
    JSON.stringify(unsaved.unsaved));

  let threw = '';
  try { gas.apiUseVersionAsStartPoint(sc.Q, 1); } catch (e) { threw = e.message; }
  check('★★★★ 揀最新一版作起點 ⇒ 拒絕', /就是最新一版/.test(threw), threw);
  threw = '';
  try { gas.apiUseVersionAsStartPoint(sc.Q, 7); } catch (e) { threw = e.message; }
  check('★★★★ 冇呢一版 ⇒ 拒絕', /找不到這一季的第 7 版/.test(threw), threw);
}

console.log('\n=== CH4：儲存 ⇒ 來源「以第 0 版作起點」===');
{
  const plan = gas.apiSaveAndConfirmPlan(sc.Q);
  check('（準備）唔使逐格決定', plan.needsDecision !== true && !plan.blocked, JSON.stringify(plan).slice(0, 300));
  const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  check('（準備）第 2 版建立', saved && saved.versionNo === 2, JSON.stringify(saved).slice(0, 300));
  const V = sc.C.ROSTER_VERSIONS;
  const v2 = gas.readSheet(sc.S.ROSTER_VERSIONS).filter((r) => Number(r[V.VERSION_NO]) === 2)[0];
  check('★★★★★★ 新一版來源寫「以第 0 版作起點」', v2 && v2[V.BASIS] === '以第 0 版作起點', v2 && v2[V.BASIS]);
  const list = gas.listQuarterVersionChoices_(sc.Q, sc.TZ);
  check('★★★★★ 下拉顯示「以第 0 版作起點」', /^第 2 版　.*　以第 0 版作起點　k$/.test(list[0].label), list[0].label);
  check('★★★★★ 新一版內容＝第 0 版（主席、標題）', sc.getCell(2, D[0], 'CHAIR#1') === v0Chair
    && sc.getCell(2, D[1], '_TYPE') === v0Title1);

  sc.setCell(2, D[3], 'CHAIR#1', otherChair);
  gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
  const v3 = gas.readSheet(sc.S.ROSTER_VERSIONS).filter((r) => Number(r[V.VERSION_NO]) === 3)[0];
  check('★★★★★★ 再之後嘅儲存唔再沿用起點（照寫人手調整）', v3 && v3[V.BASIS] === 'FINE_TUNE', v3 && v3[V.BASIS]);
}

console.log('\n=== CH5：查看這一版（唯讀）===');
{
  const protectedSheets = [];
  const wrap = (sheet) => {
    const orig = sheet.protect.bind(sheet);
    sheet.protect = function () {
      const p = orig();
      const rec = { sheet: sheet.getName(), warningOnly: null };
      protectedSheets.push(rec);
      const setW = p.setWarningOnly;
      p.setWarningOnly = function (v) { rec.warningOnly = v; return setW.call(p, v); };
      return p;
    };
  };
  wrap(sc.gridSheet(0));
  wrap(sc.gridSheet(3));
  const r = gas.apiOpenVersionForViewing(sc.Q, 0);
  check('★★★★★ 回嗰一版工作表網址', /^https:\/\//.test(r.url) && r.sheetName === 'Roster_' + sc.Q + '_v0', JSON.stringify(r));
  check('★★★★★★ 舊版本工作表先還原成嗰一版儲存咗嘅內容（幹事喺嗰張表改完先儲存成第 1 版）',
    sc.getCell(0, D[0], 'CHAIR#1') === v0Chair && sc.getCell(0, D[1], '_TYPE') === v0Title1 && r.restoredCells === 2,
    JSON.stringify([sc.getCell(0, D[0], 'CHAIR#1'), sc.getCell(0, D[1], '_TYPE'), r]));
  check('★★★★★★ 版本紀錄一格都唔改', JSON.stringify(sc.rows(0)) === v0RowsAtStart);
  check('★★★★★★ 舊版本未有保護 ⇒ 加保護（只提示）', protectedSheets.length === 1
    && protectedSheets[0].sheet === 'Roster_' + sc.Q + '_v0' && protectedSheets[0].warningOnly === true,
    JSON.stringify(protectedSheets));
  const v3Before = JSON.stringify(sc.gridSheet(3).getDataRange().getValues());
  gas.apiOpenVersionForViewing(sc.Q, 3);
  check('★★★★★ 最新一版唔加保護、唔郁（佢係要改嗰張）', protectedSheets.length === 1
    && JSON.stringify(sc.gridSheet(3).getDataRange().getValues()) === v3Before, JSON.stringify(protectedSheets));
}

console.log('\n=== CH6：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  const calls = [];
  ui.callServerMutating = async (name, q, no) => {
    calls.push({ name, q, no });
    return { ok: true, targetVersionNo: no, latestVersionNo: 2, cellCount: 3, titleCount: 1, sheetUrl: 'https://example.invalid/v2' };
  };
  ui.callServer = async (name) => { calls.push({ name }); return {}; };
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  const d = {
    latestVersion: { versionNo: 2, sheetUrl: 'https://example.invalid/v2' },
    buttons: { save: { enabled: true } },
    versionChoices: [
      { versionNo: 2, label: '第 2 版　2099-01-02 10:00　人手調整後　k', isLatest: true, sheetUrl: 'https://example.invalid/v2' },
      { versionNo: 1, label: '第 1 版　2099-01-01 10:00　系統調整　k', isLatest: false, sheetUrl: 'https://example.invalid/v1' },
      { versionNo: 0, label: '第 0 版　2099-01-01 09:00　系統生成　k', isLatest: false, sheetUrl: 'https://example.invalid/v0' }
    ]
  };
  const card = ui.renderStep2(d, {});
  const nodes = () => card.flatten();
  const sel = nodes().filter((n) => n.tagName === 'SELECT')[0];
  const textOf = () => card.textContent;
  const linkTo = (text) => nodes().filter((n) => n.tagName === 'A' && n.textContent === text)[0];
  const btnOf = (root, text) => root.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];

  check('★★★★★★ 第 2 步有版本下拉，列出全部版本', sel && sel.children.length === 3, sel && sel.children.length);
  check('★★★★★ 每項顯示「第 N 版　日期時間　來源　由誰」，最新一版標明',
    sel && sel.children[0].textContent === '第 2 版　2099-01-02 10:00　人手調整後　k（最新）'
      && sel.children[1].textContent === '第 1 版　2099-01-01 10:00　系統調整　k', sel && sel.children.map((o) => o.textContent).join(' / '));
  check('★★★★★★ 預設＝最新一版 ⇒〔查看／修改職事表〕照舊', sel && sel.value === '2' && !!linkTo('查看／修改職事表')
    && !linkTo('查看這一版'));
  check('★★★★★★ 〔回到上一個儲存版本〕拿走', !/回到上一個儲存版本/.test(textOf()), textOf());

  sel.value = '0';
  sel.fire('change');
  const view = linkTo('查看這一版');
  check('★★★★★★ 揀舊版本 ⇒〔查看這一版〕喺新分頁開嗰一版', view && view.href === 'https://example.invalid/v0'
    && view.target === '_blank', view && view.href);
  check('★★★★★ 〔查看／修改職事表〕收起（避免以為改緊舊版本）', !linkTo('查看／修改職事表'));
  view.fire('click');
  await tick();
  check('★★★★★ 撳〔查看這一版〕順手叫後端設唯讀', calls.some((c) => c.name === 'apiOpenVersionForViewing' && c.no === 0),
    JSON.stringify(calls));

  const startBtn = btnOf(card, '用這一版作起點');
  check('★★★★★★ 揀舊版本 ⇒〔用這一版作起點〕', !!startBtn);
  startBtn.fire('click');
  const mBody = () => ui.document.getElementById('modalBody');
  const mActs = () => ui.document.getElementById('modalActions');
  const modalText = mBody().textContent;
  check('★★★★★★ 先提示：「現在的職事表上未儲存的改動會被這一版的內容蓋過，舊版本不會改變。」',
    modalText.indexOf('現在的職事表上未儲存的改動會被這一版的內容蓋過，舊版本不會改變。') !== -1, modalText.slice(0, 400));
  check('★★★★★ 未撳〔確定〕之前乜都冇寫', !calls.some((c) => c.name === 'apiUseVersionAsStartPoint'));
  const okBtn = btnOf(mActs(), '確定');
  check('★★★★★ 有〔確定〕〔取消〕', !!okBtn && !!btnOf(mActs(), '取消'));
  okBtn.fire('click');
  await tick();
  check('★★★★★★ 〔確定〕⇒ apiUseVersionAsStartPoint(季度, 0)',
    calls.some((c) => c.name === 'apiUseVersionAsStartPoint' && c.q === '2099T1' && c.no === 0), JSON.stringify(calls));
  const after = mBody().textContent;
  check('★★★★★ 完成窗講明未儲存、要撳〔儲存〕', /還未儲存/.test(after) && /撳〔儲存〕成為新一版/.test(after), after.slice(-400));

  // 進階與診斷
  const fs = require('fs');
  const path = require('path');
  const z4 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone4.html'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  check('★★★★★★ 進階與診斷〔回到上一個版本〕拿走', !/renderRollbackEntry\(\)/.test(z4));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();
