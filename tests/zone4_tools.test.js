// 第二十七輪批次階段 F：區四——把七個幹事真係會用嘅工具搬上 Web。
// 執行方式：node tests/zone4_tools.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢一階段最容易做錯嘅三件事
// ─────────────────────────────────────────────────────────────────────
//
// 1. **搬得太多。** 八十幾個選單項目大部分係診斷／維護工具，
//    使用者係 Ivan 或者 IT。搬上嚟只會令幹事喺一堆佢一世都唔會撳嘅嘢
//    入面搵佢真正要撳嗰粒——「搵唔到」同「撳錯」兩樣都會出事。
//
// 2. **叫咗 `run*_()`。** 嗰啲函式全部會叫 `ui.alert()`，
//    喺 Web App 環境冇 Sheets UI，一叫就爆。要叫佢哋裡面嘅純運算函式。
//
// 3. **改咗選單版。** 選單版係安全網——Web 介面爆咗嘅時候
//    （例如上一輪嗰個 HtmlService 樣板 bug 令整個介面開唔到），
//    選單仍然行得。所以本輪一行都唔改選單版嘅行為。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const backend = read('src/WebAppZone4.gs');
const zone4 = read('src/ui/ScriptZone4.html');
const common = read('src/ui/Script.html');
const index = read('src/ui/Index.html');

/**
 * 剝走註解再檢查。
 *
 * ⚠️ 呢一步唔可以慳：呢份測試好多條斷言係「唔可以出現某個寫法」，
 * 而**解釋嗰個寫法點解唔啱嘅註解，本身就含住嗰個寫法**。
 * 唔剝註解嘅話，寫得越清楚就越容易被自己嘅測試捉住——
 * 而唯一嘅「修法」就係把註解寫得含糊。本專案已經撞過四次。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== F【核心】唔可以叫 run*_()（佢哋會叫 ui.alert，喺 Web 一叫就爆）===');
{
  const calls = stripComments(backend).match(/\brun[A-Z][A-Za-z0-9]*_\s*\(/g) || [];
  check('★★★★★ 後端完全冇呼叫任何 run*_() 選單入口',
    calls.length === 0, '叫咗：' + calls.join('、'));
  check('★★★★★ 亦冇任何 SpreadsheetApp.getUi()／ui.alert',
    !/getUi\(\)|\bui\.alert\(/.test(stripComments(backend)));

  // 反面：真正要叫嘅係嗰啲純運算函式。
  [['核對職事表', 'apiVerifyRoster('],
    ['列出待補格子', 'listPendingBackfillCells_('],
    ['草稿覆核報告', 'measureSoftRuleMetrics_('],
    ['匯出職事表 PDF', 'exportRosterPdf('],
    ['產生個人 PDF', 'generatePersonalPdfBatch_('],
    ['補寄預覽', 'planMakeupSend_('],
    ['補寄執行', 'executeMakeupSend_(']
  ].forEach(function (pair) {
    check('★★★★ ' + pair[0] + ' 叫嘅係純運算函式 ' + pair[1] + '…',
      backend.indexOf(pair[1]) !== -1);
  });
}

console.log('\n=== F【核心】選單版一行都唔可以改 ===');
{
  // 呢一條係「安全網」原則：Web 爆咗嘅時候，選單要仍然行得。
  // 所以七個工具嘅選單入口全部要仍然存在。
  const menu = read('src/Menu.gs');
  ['runExportPdf_', 'runGeneratePersonalPdfBatch_'].forEach(function (fn) {
    check('★★★★★ 選單版 ' + fn + ' 仍然存在',
      menu.indexOf('function ' + fn) !== -1);
  });
  check('★★★★★ runMakeupSendPlan_／Execute_ 仍然存在',
    /function runMakeupSendPlan_/.test(read('src/MakeupSend.gs'))
    && /function runMakeupSendExecute_/.test(read('src/MakeupSend.gs')));
  check('★★★★★ runListPendingBackfillCells_ 仍然存在',
    /function runListPendingBackfillCells_/.test(read('src/FourStageFlow.gs')));
  check('★★★★★ runDraftReviewReport_ 仍然存在',
    /function runDraftReviewReport_/.test(read('src/DraftReviewReport.gs')));
}

console.log('\n=== F【核心】只搬七個 ===');
{
  const names = ['重新生成初稿（覆蓋式）', '匯出職事表 PDF', '產生個人 PDF',
    '補寄未收到的人', '核對職事表', '列出待補格子', '草稿覆核報告（給堂委看）'];
  names.forEach(function (n) {
    check('★★★★ 區四有「' + n + '」', zone4.indexOf("'" + n + "'") !== -1);
  });
  check('★★★★★ 頁尾指返選單，而且列出邊幾類留咗喺選單',
    zone4.indexOf('其餘工具（體檢、上線前檢查、匯出關鍵狀態等）請用試算表上方的選單。') !== -1);
  check('★★★★★ 而且冇咗舊嗰句「下一輪會搬上來」'
    + '——留住嘅話，幹事會等一個永遠唔會嚟嘅下一輪',
    !/下一輪會搬上來/.test(zone4));
}

console.log('\n=== F 版本下拉一律寫人話 ===');
{
  const list = bodyOf(backend, 'apiListVersionsForZone4');
  check('★★★★★ label 係「第 N 版　時間　原因」，唔係工作表名'
    + '——`Roster_2026T4_v2` 係內部代號，唔係幹事嘅語言',
    /'第 ' \+ no \+ ' 版　'/.test(list));
  check('★★★★★ 原因用共用嘅 buildVersionBasisText_()（同狀態卡同一份翻譯表）'
    + '——兩邊各有一套就會有一日對唔上',
    /buildVersionBasisText_\(v\[V\.BASIS\]\)/.test(list));
  check('★★★★ 時間用共用嘅 normalizeSentAt_()（唔會直接 String(Date)）',
    /normalizeSentAt_\(v\[V\.CREATED_AT\], timezone\)/.test(list));
  check('★★★★ 冇時間紀錄要講「（沒有時間紀錄）」，唔可以留空白',
    list.indexOf('（沒有時間紀錄）') !== -1);
  check('★★★★ 新版本排前面', /b\.versionNo - a\.versionNo/.test(list));
  check('★★★★★ 一個版本都冇嘅時候唔會彈一個空下拉，而係講一句人話',
    zone4.indexOf('這一季還沒有任何版本，所以沒有東西可以處理。') !== -1);
}

console.log('\n=== F【核心】重新生成（覆蓋式）要打字確認 ===');
{
  check('★★★★★ 有打字確認（會建立新版本，而且會蓋走未儲存嘅人手改動）',
    /openConfirm\(\{[\s\S]{0,1600}?requireTyping: true,[\s\S]{0,200}?confirmLabel: '確定重新生成'/.test(zone4));
  check('★★★★★ 而且明確警告會蓋走未儲存嘅人手改動',
    zone4.indexOf('你在表上做過的人手改動，如果還沒有撳「儲存並確認」，就會不見了。') !== -1);
  check('★★★★★ 而且指出「如果只係想套用幾格，應該用掣 1」'
    + '——唔講嘅話，幹事會用一個核彈去做一件小事',
    zone4.indexOf('如果只是想套用你剛才在表上改的幾格，請用區一的「儲存並確認」') !== -1);
  check('★★★★ 有「不會做的事」，講明唔會寄信、唔會刪舊版本',
    zone4.indexOf('・不會寄出任何電郵') !== -1
    && zone4.indexOf('・不會刪走任何舊版本') !== -1);
}

console.log('\n=== F 待補格子唔收版本號 ===');
{
  const body = bodyOf(backend, 'apiListPendingBackfillCellsForZone4');
  check('★★★★★ 用最新版本，唔叫幹事揀'
    + '——「而家仲有邊幾格未填」永遠係問最新版本；'
    + '叫佢揀只會令佢對住一份同現況無關嘅清單去填格',
    /findLatestVersionNo\(id\)/.test(body)
    && /function apiListPendingBackfillCellsForZone4\(quarterId\)/.test(backend));
  check('★★★★ 冇版本時講一句人話，唔會拋錯',
    body.indexOf('這一季還沒有生成過任何版本') !== -1);
}

console.log('\n=== F【核心】匯出 PDF：檔案大細唔可以砌一個假數出嚟 ===');
{
  const body = bodyOf(backend, 'apiExportRosterPdf');
  check('★★★★★ 大細由 Drive 攞，唔係 `result.fileSize || 0`'
    + '——`exportRosterPdf()` 根本冇回 fileSize，'
    + '嗰種寫法永遠印「0 B」，而「0 B」睇落係一個真實而且嚇人嘅數字',
    /DriveApp\.getFileById\(result\.fileId\)/.test(body)
    && !/result\.fileSize/.test(stripComments(body)));
  check('★★★★★ 攞唔到就誠實講「查不到檔案大小」',
    body.indexOf('（查不到檔案大小）') !== -1);
  check('★★★★ 而且攞唔到唔會令整個匯出算失敗（包 try/catch）',
    /try \{[\s\S]{0,200}?DriveApp\.getFileById[\s\S]{0,200}?catch/.test(body));
  check('★★★★ 畫面有顯示大細同資料夾',
    /'大小 ' \+ res\.fileSize \+ '　放在 ' \+ res\.folderName/.test(zone4));
}

console.log('\n=== F 產生個人 PDF：分批要接住跑，而且數字唔可以憑空作 ===');
{
  const body = bodyOf(backend, 'apiGeneratePersonalPdfBatch');
  check('★★★★★ 回傳嘅每一個欄位都係 generatePersonalPdfBatch_() 真係有嘅'
    + '——作一個唔存在嘅欄名出嚟，畫面就會永遠顯示 undefined 或者 0',
    !/skippedNoAssignmentCount/.test(stripComments(body)));
  check('★★★★ 有 done／doneCount／totalPeople（前端靠佢哋接住跑）',
    /done: !!result\.done/.test(body) && /doneCount: result\.doneCount/.test(body));
  check('★★★★★ 前端有 for 迴圈接住跑，而且有 guard 上限'
    + '——冇 guard 嘅話，後端一旦永遠回 done:false 就會無限打伺服器',
    /guard > 40/.test(zone4));
  check('★★★★★ 「略過已存在」有出數字'
    + '——唔出嘅話，幹事會以為「明明有 57 人，點解只新產生咗 3 個」',
    /last\.skippedExistingCount/.test(zone4));
}

console.log('\n=== F【核心】補寄：先預覽後執行，而且後端自己重算 ===');
{
  const stages = bodyOf(backend, 'apiMakeupSendStages');
  const exec = bodyOf(backend, 'apiMakeupSendExecute');
  check('★★★★★ 只列**真係寄過**嘅階段'
    + '——列一個從來未寄過嘅階段，幹事揀完只會見到「全部人都收到咗」，'
    + '而嗰個講法係錯嘅（根本一封都未寄過）',
    /\.filter\(function \(stage\) \{ return sent\[stage\]; \}\)/.test(stages));
  check('★★★★ 階段名寫人話（「寄給堂委審閱」而唔係 REVIEW）',
    /labels\[MAIL_STAGES\.REVIEW\] = '寄給堂委審閱'/.test(stages));
  check('★★★★★ 執行時後端自己重新算一次計畫，唔信前端傳返嚟嗰份'
    + '——前端嗰份係幾分鐘前算嘅，期間可能已經有人收到咗',
    /const plan = planMakeupSend_\(id, versionNo, String\(stage \|\| ''\)\.trim\(\)\);/.test(exec));
  check('★★★★★ 全部人都收到咗就唔會扮成功，而且指返掣 4',
    exec.indexOf('這一次所有人都已經收到了。') !== -1
    && exec.indexOf('請用區一的「改動後重發」') !== -1);
  check('★★★★★ 前端一定要先睇預覽先撳得到執行',
    /button\('先看預覽'/.test(zone4)
    && /callServer\('apiMakeupSendPlan'/.test(zone4));
  check('★★★★ 確認畫面有「不會做的事」，講明唔會推前進度',
    zone4.indexOf('・不會推前這一季的進度') !== -1);
}

console.log('\n=== F 錯誤處理：一律三段式，而且指返選單（安全網）===');
{
  check('★★★★★ 有共用嘅 zone4Failure_()',
    /function zone4Failure_/.test(backend));
  check('★★★★★ 訊息講明「沒有寄出任何電郵」',
    /什麼都沒有改動，沒有寄出任何電郵。/.test(backend));
  check('★★★★★ 而且指返選單——嗰邊係安全網',
    backend.indexOf('用試算表上方的選單做同一件事——那邊是安全網') !== -1);
  const uses = (backend.match(/zone4Failure_\(/g) || []).length;
  check('★★★★ 每一個工具都包咗 try/catch（至少七處用到）',
    uses >= 8, '用咗 ' + uses + ' 次');
}

console.log('\n=== F 呼叫層：讀寫分流 ===');
{
  const listMatch = common.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
  const readOnly = (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));

  ['apiListVersionsForZone4', 'apiVerifyRosterForZone4',
    'apiListPendingBackfillCellsForZone4', 'apiDraftReviewReportForZone4',
    'apiMakeupSendStages', 'apiMakeupSendPlan'].forEach(function (n) {
    check('★★★★ ' + n + ' 喺唯讀白名單', readOnly.indexOf(n) !== -1);
  });
  ['apiGenerateRoster', 'apiExportRosterPdf', 'apiGeneratePersonalPdfBatch',
    'apiMakeupSendExecute', 'apiRepublishPublicLink'].forEach(function (n) {
    check('★★★★★ ' + n + ' 唔喺白名單，而且用 callServerMutating()',
      readOnly.indexOf(n) === -1
      && zone4.indexOf("callServerMutating('" + n + "'") !== -1);
  });
}

console.log('\n=== F 檔案結構：區四搬咗出去，冇兩份同名函式 ===');
{
  check('★★★★★ renderZone4() 只喺 ScriptZone4.html 出現一次'
    + '——GAS 係單一全域作用域，兩份同名函式後載入嗰份會靜靜蓋過前面',
    (zone4.match(/function renderZone4\(/g) || []).length === 1
    && !/function renderZone4\(/.test(common));
  check('★★★★★ renderRepublishEntry() 亦已經搬走（唔會兩份）',
    (zone4.match(/function renderRepublishEntry\(/g) || []).length === 1
    && !/function renderRepublishEntry\(/.test(common));
  check('★★★★★ Index.html 有載入 ScriptZone4',
    index.indexOf("includeHtml('ui/ScriptZone4')") !== -1);
  check('★★★★★ 而且排喺 ScriptBoot 之前（ScriptBoot 會叫其他檔案定義嘅函式）',
    index.indexOf("includeHtml('ui/ScriptZone4')")
      < index.indexOf("includeHtml('ui/ScriptBoot')"));
  check('★★★★★ 每個 includeHtml 引用嘅檔案都真係存在',
    (index.match(/includeHtml\('ui\/([A-Za-z0-9]+)'\)/g) || []).every(function (m) {
      const name = m.replace(/.*'ui\//, '').replace(/'\)/, '');
      return fs.existsSync(path.join(__dirname, '..', 'src', 'ui', name + '.html'));
    }));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
