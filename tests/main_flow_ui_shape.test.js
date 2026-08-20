// 第三十九輪批次 A／B／E 組：幹事介面重排之後嘅形狀。
// 執行方式：node tests/main_flow_ui_shape.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 嘅目標由「修 bug」轉成「可以全面交俾幹事測試」。呢一份守嘅係
// 三件會令幹事撳唔落手嘅事：
//
//   ・六步唔齊、或者次序錯咗
//   ・舊功能被搬走嗰陣**順手唔見咗**
//   ・字太細、載入回饋太細（佢明講過讀唔到、睇唔出做緊嘢定係做完咗）
//
// ⚠️ 呢一份係靜態檢查（讀原始碼）。佢證明唔到「撳落去真係行得通」——
// 嗰件事由 `main_flow_six_steps.test.js` 用真入口證明。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const UI = path.join(__dirname, '..', 'src', 'ui');
const readUi = (f) => fs.readFileSync(path.join(UI, f), 'utf8');

const index = readUi('Index.html');
const style = readUi('Style.html');
const common = readUi('Script.html');
const flow = readUi('ScriptMainFlow.html');
const sendPaper = readUi('ScriptSendPaper.html');
const boot = readUi('ScriptBoot.html');

// =====================================================================
console.log('\n=== A【核心】六步齊全，而且順序係幹事真實嘅工作次序 ===');
{
  // 六步嘅標題逐個喺原始碼度出現，而且**次序唔可以亂**——
  // 呢一段係一條直線，次序本身就係說明書。
  const titles = [
    '生成下一季職事表',
    '查看／修改職事表',
    '在職事表加入名單選單',
    '維護各崗位的事奉人員名單',
    '寄出',
    '要印紙本'
  ];
  const positions = titles.map((t) => flow.indexOf(t));
  check('★★★★★ 六步全部搵得到', positions.every((p) => p !== -1),
    JSON.stringify(titles.map((t, i) => t + '=' + positions[i])));

  const renderOrder = ['renderStep1(', 'renderStep2(', 'renderStep3(',
    'renderStep4(', 'renderStep5(', 'renderStep6('];
  const callBlock = flow.slice(flow.indexOf('async function renderMainFlow'));
  const callPos = renderOrder.map((r) => callBlock.indexOf(r + 'd') !== -1
    ? callBlock.indexOf(r) : callBlock.indexOf(r));
  check('★★★★★ 而且係由 1 畫到 6，次序冇亂',
    callPos.every((p, i) => p !== -1 && (i === 0 || p > callPos[i - 1])),
    JSON.stringify(callPos));

  check('★★★★ 每一步都有一個編號圓點（step-num），令佢一眼睇得出係第幾步',
    /className: 'step-num'/.test(flow));
}

console.log('\n=== A1：掣上面直接寫住季度，唔使佢揀 ===');
{
  check('★★★★★ 掣嘅字係「生成」＋季度名，唔係一個要佢自己諗嘅泛稱',
    /const label = '生成' \+ t\.label \+ '職事表'/.test(flow), '');
  check('★★★★★ 已經開始／已經過去要**先彈警告先做**，唔可以直接做',
    /if \(t\.warn\) \{[\s\S]{0,400}openConfirm\(/.test(flow), '');
  check('★★★★★ 目標季度唔係而家睇緊嗰一季嘅話，會**先切換頂部嘅季度選單**'
    + '——唔切嘅話，生成完之後畫面其餘部分仍然講緊另一季，'
    + '而幹事會以為生成失敗咗',
    /t\.quarterId !== currentQuarterId[\s\S]{0,300}sel\.value = t\.quarterId/.test(flow), '');
}

console.log('\n=== A1：那條永久連結 ===');
{
  check('★★★★★ 有一粒「複製連結」', /複製連結/.test(flow));
  check('★★★★★ 複製失敗**唔可以扮成功**'
    + '——幹事會以為複製好咗，貼出嚟卻係舊嘢',
    /複製不到/.test(flow), '');
  check('★★★★ 有退路（execCommand），因為 Apps Script 嘅 iframe 唔一定俾用 clipboard API',
    /fallbackCopy/.test(flow) && /execCommand\('copy'\)/.test(flow));
  check('★★★★★ 連結嘅意思有喺畫面上用一句人話講',
    /p.explanation/.test(flow) && /permalink-note/.test(flow), '');
}

// =====================================================================
console.log('\n=== E【核心】舊功能一樣都冇少 ===');
{
  // 四區全部仍然喺 Index.html，而且四個 render 入口一個都冇少。
  ['zone1Body', 'zone2Body', 'zone3Body', 'zone4Body'].forEach((id) => {
    check('★★★★★ ' + id + ' 仍然喺 Index.html（搬位置 ≠ 刪功能）',
      index.indexOf('id="' + id + '"') !== -1);
  });
  ['ScriptZone1', 'ScriptZone2', 'ScriptZone3', 'ScriptZone4', 'ScriptRollback']
    .forEach((f) => {
      check('★★★★★ 仍然載入 ' + f,
        index.indexOf("includeHtml('ui/" + f + "')") !== -1);
    });

  check('★★★★★ `renderZone1()` 仍然會被叫'
    + '（區一收咗起，但佢嘅行為仍然由原有測試守住）',
    /renderZone1\(dashboardState_\)/.test(common));
}

console.log('\n=== E：三組摺疊，每組標題旁邊有一句極短說明 ===');
{
  const groups = [
    ['開季前準備', '每季開頭做一次'],
    ['名單維護', '改人、改資格、改偏好'],
    ['進階與診斷', '出事或者要查數先用']
  ];
  groups.forEach((g) => {
    check('★★★★ 「' + g[0] + '」有標題', index.indexOf('>' + g[0] + '<') !== -1);
    check('★★★★ 而且旁邊有一句說明：' + g[1], index.indexOf(g[1]) !== -1);
    check('★★★★ 說明唔多過十個字（多過就冇人會讀）', g[1].length <= 10, g[1]);
  });
}

console.log('\n=== 載入次序：新檔案一定要喺 ScriptZone1 之後、ScriptBoot 之前 ===');
{
  // ⚠️ 主流程同寄出彈窗會叫 ScriptZone1 入面嘅
  // `openGenerateDraft()`／`openSaveAndConfirm()`／`openReview()`⋯⋯
  // 排前面嘅話嗰啲函式仲未定義。
  const at = (f) => index.indexOf("includeHtml('ui/" + f + "')");
  check('★★★★★ ScriptMainFlow 喺 ScriptZone1 之後',
    at('ScriptMainFlow') > at('ScriptZone1'));
  check('★★★★★ ScriptSendPaper 喺 ScriptZone1 之後',
    at('ScriptSendPaper') > at('ScriptZone1'));
  check('★★★★★ 兩個都喺 ScriptBoot 之前',
    at('ScriptMainFlow') < at('ScriptBoot') && at('ScriptSendPaper') < at('ScriptBoot'));
  check('★★★★★ 每個 includeHtml 引用嘅檔案都真係存在',
    (index.match(/includeHtml\('ui\/([A-Za-z0-9]+)'\)/g) || []).every((m) => {
      const name = m.replace(/.*ui\//, '').replace(/'\).*/, '');
      return fs.existsSync(path.join(UI, name + '.html'));
    }));
}

// =====================================================================
console.log('\n=== B【核心】字要夠大 ===');
{
  check('★★★★★ 內文基準至少 16px（Ivan 明講過讀唔到）',
    /font-size: 16px;/.test(style), '');
  check('★★★★★ 有一個一致嘅字級尺度（唔係逐個位寫死一個數字）',
    /--fs-md:/.test(style) && /--fs-xl:/.test(style) && /--fs-2xl:/.test(style));
  check('★★★★★ **唔用 `zoom`**'
    + '——佢會連邊框同陰影一齊放大，而且冇得逐個元件微調',
    !/\bzoom\s*:/.test(style), '');
  check('★★★★★ 主流程嘅標題明顯大過內文',
    /\.step-title \{[^}]*var\(--fs-xl\)/.test(style), '');
  check('★★★★ 主掣夠大撳（最少 48px 高，手指都撳得中）',
    /button\.step-btn \{[^}]*min-height: 48px/.test(style), '');
}

console.log('\n=== B：載入回饋要大而明確 ===');
{
  check('★★★★★ 有一塊蓋住畫面中央嘅載入牌，唔係一個細細嘅轉圈',
    /\.busy-overlay \{/.test(style) && /position: fixed/.test(style));
  check('★★★★★ 牌上面嘅字用最大嗰級（--fs-2xl）',
    /\.busy-title \{[^}]*var\(--fs-2xl\)/.test(style));
  check('★★★★★ 有 `busyShow()`，而且會講**做緊咩**（收一個 title）',
    /function busyShow\(title, sub\)/.test(common));
  check('★★★★★ 需時長嘅動作報得到進度（第幾／共幾）',
    /function setProgress\(done, total, label\)/.test(common));
  check('★★★★★ 總數唔知就**唔畫進度條**'
    + '——一條永遠唔郁嘅進度條比冇進度條更誤導',
    /const hasBar = total > 0;[\s\S]{0,120}hidden = !hasBar/.test(common), '');
  check('★★★★★ 完成之後會停留一陣先收（一閃即逝等於冇顯示過）',
    /BUSY_DONE_MS/.test(common) && /setTimeout\(\(\) => \{[\s\S]{0,160}hidden = true;/.test(common));
  check('★★★★ 停留時間至少一秒',
    (Number((common.match(/const BUSY_DONE_MS = (\d+);/) || [])[1]) || 0) >= 1000,
    (common.match(/const BUSY_DONE_MS = (\d+);/) || []).join(''));
  check('★★★★★ 失敗有自己嘅樣（紅），唔係同成功一樣',
    /\.busy-card\.is-fail/.test(style) && /busyHide\('fail'\)/.test(common));
  check('★★★★★ 收牌一定要喺刷新之後'
    + '——喺之前收就會出現「講咗已完成、但畫面仲係舊數字」嘅空窗',
    /loadDashboard\(\{ keepModal: true \}\)[\s\S]{0,400}if \(ok\) busyHide\('done'\)/.test(common), '');
}

console.log('\n=== B：手機／平板讀得到 ===');
{
  check('★★★★ 有 max-width 斷點', /@media \(max-width: 700px\)/.test(style));
  check('★★★★ 窄螢幕主掣會攤成整行（手指撳得中）',
    /@media \(max-width: 700px\)[\s\S]*?button\.step-btn \{ width: 100%; \}/.test(style));
}

console.log('\n=== B：新樣式唔可以蓋過 `[hidden]` ===');
{
  // ⚠️ 呢個檔案已經因為呢件事出過三次事
  //（`.zone-body`、`.modal-backdrop`、`.prop-opts`）。
  // 總閘係 `[hidden] { display: none !important; }`——
  // 只要冇人喺其他規則寫 `display: ... !important`，佢就贏。
  // ⚠️ 一定要先剥走註解——上面嗰段警告本身就引用咗 hidden 嗰條規則做對照，
  //  唔剥就會數多咗一條，而個測試會指住一段註解話你知有 bug。
  const styleRules = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const displayImportant = styleRules.match(/display:[^;]*!important/g) || [];
  checkEqual('★★★★★ 全份 Style 只有 `[hidden]` 嗰一條用 `display: ... !important`'
    + '——多一條就會同總閘打架，重現「睇得見、撳得到、但會被靜靜忽略」嗰個 bug',
    displayImportant.length, 1);
  check('★★★★★ 而且嗰一條真係 `[hidden]`',
    /\[hidden\] \{ display: none !important; \}/.test(style));
}

// =====================================================================
console.log('\n=== C：寄出彈窗 ===');
{
  check('★★★★★ 階段由系統判斷，用一句人話講出嚟（唔係俾佢揀）',
    /kindSentence/.test(sendPaper) && !/揀階段|選擇階段/.test(sendPaper));
  check('★★★★★ 頂部再講一次「系統只會寄已經儲存確認的版本」',
    /系統只會寄你已經儲存確認的版本/.test(sendPaper));
  check('★★★★★ 有未儲存改動要先問，而且「取消」嗰粒寫「先去儲存」'
    + '——嗰個係另一條路，唔係放棄',
    /cancelLabel: '先去儲存'/.test(sendPaper) && /onCancel: [\s\S]{0,60}openSaveAndConfirm\(\)/.test(sendPaper));
  check('★★★★★ 落到最後係叫返原本嗰三條路，冇另起爐灶',
    /openReview\(\)/.test(sendPaper) && /openOfficial\(\)/.test(sendPaper)
    && /openResend\(\)/.test(sendPaper));
  check('★★★★★ 範本冇放永久連結就要嘈'
    + '——靜靜寄一封冇連結嘅信，收信嘅人就冇辦法自己去睇最新版',
    /if \(!s\.contents\.hasPermanentLink\)/.test(sendPaper));
  check('★★★★ 模擬模式要講出嚟', /模擬模式/.test(sendPaper));
}

console.log('\n=== D：紙本 ===');
{
  check('★★★★★ 冇電郵嗰批**預設全部勾好**（佢哋一定要印，唔應該要幹事逐個勾）',
    /s\.noEmail\.forEach\(\(p\) => \{ paperSelection_\[p\.personId\] = true; \}\)/.test(sendPaper));
  check('★★★★ 有電郵嗰批可以額外加，而且搵得到人',
    /有電郵，但你也想印給他/.test(sendPaper) && /搵人名/.test(sendPaper));
  check('★★★★★ 兩個出口都有：下載（資料夾連結）同寄到自己信箱',
    /產生並取得連結/.test(sendPaper) && /寄到自己信箱/.test(sendPaper));
  check('★★★★★ 「寄到自己信箱」講明就算喺模擬模式都會真係寄'
    + '——唔講嘅話幹事會以為係模擬，然後一路等一封唔會嚟嘅信',
    /都會真的寄出/.test(sendPaper));
  check('★★★★★ 搵唔到 PDF 嗰幾位要逐個列出，唔可以靜靜略過',
    /找不到 PDF/.test(sendPaper) && /r\.missing/.test(sendPaper));
  check('★★★★★ 做唔晒會講「做咗一部分」，而且有得接住做',
    /做了一部分/.test(sendPaper) && /繼續做餘下的/.test(sendPaper));
}

// =====================================================================
console.log('\n=== 換季度／重新整理要清走主流程嘅快取 ===');
{
  // ⚠️ 唔清嘅話，主流程會講緊上一季嘅數字（要印紙本幾多位、
  // 永久連結係邊條），而畫面睇落完全正常——同第二十五輪嗰個 bug 一模一樣。
  check('★★★★★ 換季度時會 resetMainFlowState()',
    /resetAllZoneLoadState\(\);[\s\S]{0,400}resetMainFlowState\(\)/.test(boot));
  check('★★★★★ 撳「重新整理」時都會',
    /btnRefresh[\s\S]{0,200}resetMainFlowState\(\)/.test(boot));
  check('★★★★★ 而且主流程畫唔出唔可以令成版嘢載入失敗'
    + '（幹事會見到一版接近空白嘅畫面而完全唔知發生咩事）',
    /try \{\s*\n\s*await renderMainFlow\(dashboardState_\);\s*\n\s*\} catch/.test(common), '');
}

console.log('\n=== 儲存：一切正常就唔好彈窗 ===');
{
  const zone1 = readUi('ScriptZone1.html');
  check('★★★★★ 有「完全冇問題」嘅快路',
    /function saveIsCompletelyClean\(plan\)/.test(zone1));
  check('★★★★★ 定義寫得**嚴**——任何一項有嘢就照舊彈窗'
    + '（判斷錯嘅代價唔對稱：多彈一個窗只係麻煩，少彈一個就係靜靜改咗嘢）',
    /v\.real \|\| \[\]\)\.length === 0[\s\S]{0,600}plan\.overlaps \|\| \[\]\)\.length === 0/.test(zone1), '');
  check('★★★★★ 而且快路行嘅仍然係同一個 api，冇第二套儲存邏輯',
    /function executeCleanSave[\s\S]{0,600}callServerMutating\('apiSaveAndConfirmExecute'/.test(zone1), '');
  check('★★★★★ 有嘢要佢決定嗰陣，兩粒掣係「照樣儲存」同「返回修改」',
    /confirmLabel: '照樣儲存'/.test(zone1) && /cancelLabel: '返回修改'/.test(zone1));
}

console.log('\n=== 確認清單要講人話 ===');
{
  check('★★★★★ 規則代號有對應嘅一句人話',
    /HARD_ELIGIBILITY: '他未做過這個崗位'/.test(common));
  check('★★★★★ 對唔上嘅代號**照樣印出嚟**，唔可以變成空白'
    + '（印一個代號最少查得返；印空白就等於話「呢一格冇問題」）',
    /RULE_SENTENCE\[x\.ruleId\] \|\| x\.reason \|\| x\.ruleId \|\| ''/.test(common), '');
  check('★★★★ 日期寫成「7 月 11 日」，唔係 2027-07-11',
    /function humanDate/.test(common) && /' 月 '/.test(common));
  check('★★★★★ 認唔出格式嘅日期回原文，唔可以回空白',
    /if \(!m\) return String\(text \|\| ''\);/.test(common), '');
  check('★★★★ 單一 slot 嘅崗位唔會印一個冇意義嘅 `#1`',
    /Number\(x\.slotIndex\) > 1/.test(common));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
