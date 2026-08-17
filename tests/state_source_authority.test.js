// 第十九輪批次階段 A5／B3：派工狀態嘅權威來源。
// 執行方式：node tests/state_source_authority.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試鎖住嘅係一個**喺真實環境撞到、離線測試完全捉唔到**嘅 bug
// ─────────────────────────────────────────────────────────────────────
//
// Ivan 喺真實環境行過三次：
//   1. 步驟 3 報 HARD_ROLE_REQUIRED，訊息叫佢去 grid 人手修正
//   2. 佢改咗，grid 顯示新人名（有截圖）
//   3. 重跑步驟 3 —— 仍然報同一項違反，人名仍然係改之前嗰個
//   4. 再改再跑都一樣 ⇒ 唯一出路變成打「確認放行」
//
// 根因：`recomputeLatestVersionViolations_()` 讀 `context.original`
// （`RosterAssignments` 長表），但 UI 叫人去改 grid 工作表——兩份唔同
// 嘅資料。結果係**硬規則閘實際上形同虛設**：佢淨係得「放行」一個出口。
//
// 呢度用一個 grid 同長表**特登唔一致**嘅 fixture 直接重現。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');
const mock = require('./helpers/mock_roster_data.js');

// StateSource.gs 要 FineTune.gs 嘅 buildGridOverlayState_()／cellKey_()／
// normalizeCellText_()，同埋 Constants.gs 嘅 GRID_PLACEHOLDER_TEXTS。
const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['Verify.gs', 'RosterWriter.gs', 'StateSource.gs']));

// ⚠️ 呢個替身**一定要喺 loadGasSource() 之後先設**，唔可以用 overrides 參數。
// `resolvePersonId` 喺 .gs 入面係一個 top-level `function` 宣告，載入嗰陣
// 會覆蓋 sandbox 上面同名嘅屬性——用 overrides 傳入去係會被蓋走嘅
// （實測：仍然行到真嘅版本，於是撞 SpreadsheetApp stub 拋錯）。
// 載入之後再賦值就冇呢個問題，因為 top-level function 就係全域物件嘅屬性。
//
// 用替身嘅理由：grid 疊加只會對「真正改動過」嘅格做姓名解析，
// 我哋要測嘅係疊加邏輯，唔係 People 工作表嘅讀取路徑。
gas.resolvePersonId = function (name) {
  const map = { '假甲': 'P9001', '假乙': 'P9002', '假丙': 'P9003', '假丁': 'P9004' };
  return map[name] || null;
};

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

/**
 * 造一個 fine-tune context：長表寫住「假甲」，grid 被幹事改成「假乙」。
 * @param {boolean} withGridEdit true 代表 grid 有人手改動
 */
function buildContext(withGridEdit) {
  const base = mock.buildGeneratorContextMock({ weekCount: 2, peopleCount: 8 });
  const serviceDates = base.serviceDates.map(function (d) { return d.serviceDate; });

  const original = [
    { serviceDateId: 'D1', serviceDate: serviceDates[0], postId: 'CHAIR', slotIndex: 1,
      personId: 'P9001', personName: '假甲', assignSource: 'AUTO' },
    { serviceDateId: 'D2', serviceDate: serviceDates[1], postId: 'CHAIR', slotIndex: 1,
      personId: 'P9003', personName: '假丙', assignSource: 'AUTO' }
  ];

  const gridValues = {};
  gridValues[serviceDates[0] + '|CHAIR|1'] = withGridEdit ? '假乙' : '假甲';
  gridValues[serviceDates[1] + '|CHAIR|1'] = '假丙';

  return Object.assign({}, base, {
    quarterId: '2099T1',
    versionNo: 1,
    original: original,
    gridValues: gridValues,
    // 第二十輪批次階段 A2：人手改動偵測改成「算出應該渲染成咩再比對」，
    // 所以 context 要帶埋渲染資料。冇傳會拋錯（特登嘅——退回舊嘅反推做法
    // 會令合堂誤報嗰個 bug 靜靜咁復活）。
    gridRender: {
      labels: {
        pending: gas.DEFAULTS.GRID_PENDING_LABEL,
        na: gas.DEFAULTS.GRID_NOT_APPLICABLE_LABEL,
        specialSkip: gas.DEFAULTS.GRID_SPECIAL_SKIP_LABEL,
        gap: gas.DEFAULTS.GRID_GAP_LABEL
      },
      emptyDisplayByPostId: { CHAIR: 'PENDING' },
      externalOwnerByDate: {}
    },
    peopleById: {
      P9001: { nameTC: '假甲' }, P9002: { nameTC: '假乙' },
      P9003: { nameTC: '假丙' }, P9004: { nameTC: '假丁' }
    }
  });
}

console.log('\n=== A5【核心】grid 同長表唔一致時，規則檢查一定要睇 grid ===');
{
  const context = buildContext(true);

  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'test');
  const chairCell = overlay.state.filter(function (s) {
    return s.postId === 'CHAIR' && s.serviceDate === context.serviceDates[0].serviceDate;
  })[0];

  checkEqual('★★★★★ GRID_OVERLAY 睇到嘅係幹事改咗之後嗰個人（假乙 / P9002），'
    + '唔係長表入面嗰個（假甲 / P9001）——修正之前呢度會係 P9001，'
    + '所以幹事改幾多次都冇分別',
    chairCell.personId, 'P9002');
  check('★★★★ 改動過嘅格標成 isManual', chairCell.isManual === true);
  checkEqual('★★★★ changes 準確列出改動內容',
    overlay.changes.map(function (c) {
      return c.postId + ':' + c.originalName + '→' + c.manualText;
    }), ['CHAIR:假甲→假乙']);
  checkEqual('★★★ 冇改動嘅格唔會被當成人手改動', overlay.changes.length, 1);

  // ★ 反證：如果照舊讀長表，就係 Ivan 見到嗰個症狀
  const record = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.VERSION_OF_RECORD, 'test');
  const recordCell = record.state.filter(function (s) {
    return s.postId === 'CHAIR' && s.serviceDate === context.serviceDates[0].serviceDate;
  })[0];
  checkEqual('★★★★★ 反證：VERSION_OF_RECORD 睇到嘅仍然係改之前嗰個人'
    + '——呢個就係修正前嘅行為，亦係「改極都冇用」嘅來源',
    recordCell.personId, 'P9001');
  checkEqual('★★★ VERSION_OF_RECORD 模式唔會報任何人手改動', record.changes, []);
}

console.log('\n=== A5【核心】反方向：grid 冇改動時，行為要同修正之前逐格一致 ===');
{
  const context = buildContext(false);
  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'test');
  const record = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.VERSION_OF_RECORD, 'test');

  checkEqual('★★★★★ 冇人手改動時，兩個模式逐格完全一樣'
    + '（證明修正冇改變原有行為，只係補返「有改動」嗰個情況）',
    overlay.state.map(function (s) { return s.postId + ':' + s.personId; }),
    record.state.map(function (s) { return s.postId + ':' + s.personId; }));
  checkEqual('★★★★ 冇改動就冇 changes', overlay.changes, []);
  check('★★★★ 冇改動嘅格 isManual 一律 false',
    overlay.state.every(function (s) { return s.isManual === false; }));
}

console.log('\n=== A5：佔位文字唔算人手改動（「待確認」vs 空白）===');
{
  const context = buildContext(false);
  const d0 = context.serviceDates[0].serviceDate;
  context.original[0] = Object.assign({}, context.original[0], { personId: '', personName: '' });
  context.gridValues[d0 + '|CHAIR|1'] = '待確認';

  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'test');
  checkEqual('★★★★ 空白格顯示「待確認」唔會被當成人手改動'
    + '（否則每一格未派人嘅格都會日日報改動）', overlay.changes, []);
}

console.log('\n=== A5：認唔出嘅姓名要報出嚟，唔可以靜靜當成清空 ===');
{
  const context = buildContext(false);
  const d0 = context.serviceDates[0].serviceDate;
  context.gridValues[d0 + '|CHAIR|1'] = '唔存在嘅人';

  const overlay = gas.resolveAuthoritativeState_(
    context, gas.STATE_SOURCE.GRID_OVERLAY, 'test');
  checkEqual('★★★★★ 認唔出嘅姓名會入 unresolved（唔係靜靜當成空白——'
    + '噉樣會令一個打錯字嘅格變成「冇人服侍」而冇人知）',
    overlay.unresolved.map(function (u) { return u.text; }), ['唔存在嘅人']);
}

// =====================================================================
// B3：機制本身
// =====================================================================
console.log('\n=== B3【核心】mode 冇傳／傳錯一定要拋錯 ===');
{
  const context = buildContext(true);

  [undefined, null, '', 'original', 'GRID', 0, true].forEach(function (bad) {
    let threw = null;
    try { gas.resolveAuthoritativeState_(context, bad, 'test'); } catch (e) { threw = e; }
    check('★★★★★ mode = ' + JSON.stringify(bad) + ' 會拋錯，唔會靜靜揀一個'
      + '（呢個就係第十八輪 requireRoleContextField_ 同一套做法：'
      + '令「冇表態」大聲失敗）',
      threw !== null);
  });

  let msg = '';
  try { gas.resolveAuthoritativeState_(context, undefined, 'someCaller_'); } catch (e) { msg = e.message; }
  check('★★★★ 錯誤訊息講得出係邊個呼叫者', msg.indexOf('someCaller_') !== -1, msg);
  check('★★★★ 錯誤訊息列出兩個合法值',
    msg.indexOf('GRID_OVERLAY') !== -1 && msg.indexOf('VERSION_OF_RECORD') !== -1);
  check('★★★★ 錯誤訊息解釋咗兩份資料嘅分別同後果',
    msg.indexOf('grid') !== -1 && msg.indexOf('硬規則閘') !== -1, msg);
}

console.log('\n=== B3：疊加邏輯全專案只有一份實作 ===');
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'StateSource.gs'), 'utf8');
  check('★★★★★ StateSource.gs 唔會自己再實作一次疊加，'
    + '而係呼叫 FineTune.gs 嘅 buildGridOverlayState_()'
    + '（第十八輪階段 C 就係因為兩處各自實作同一個邏輯而分岔）',
    src.indexOf('buildGridOverlayState_(context)') !== -1
      && src.indexOf('normalizeCellText_') === -1,
    '喺 StateSource.gs 見到獨立嘅疊加實作');

  const fineTune = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'FineTune.gs'), 'utf8');
  check('★★★★ analyseManualState_() 亦都行同一個函式，冇留低第二份',
    fineTune.indexOf('buildGridOverlayState_(context)') !== -1);
}

console.log('\n=== B3：呼叫點唔可以再直接 context.original.map(...) ===');
{
  const fs = require('fs');
  const path = require('path');
  const srcDir = path.join(__dirname, '..', 'src');

  // 只查「同時攞到兩個來源」嘅檔案——即係會處理 fine-tune context 嗰啲。
  const suspects = [];
  fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); }).forEach(function (f) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    // StateSource.gs 本身係唯一容許直接讀 original 嘅地方（佢就係嗰個 resolver）
    if (f === 'StateSource.gs' || f === 'FineTune.gs') return;
    text.split('\n').forEach(function (line, i) {
      if (/context\.original\.map\s*\(/.test(line) || /plan\.context\.original\.map\s*\(/.test(line)) {
        suspects.push(f + ':' + (i + 1));
      }
    });
  });
  checkEqual('★★★★★ 除咗 resolver 本身之外，冇任何地方直接 `context.original.map(...)`'
    + '——攞派工狀態一律要行 resolveAuthoritativeState_() 並明確傳 mode',
    suspects, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
