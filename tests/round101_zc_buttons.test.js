// 第一百零一輪批次 ZC 組：介面按鈕名稱及合併。
// 執行方式：node tests/round101_zc_buttons.test.js
//
//   ZC1 〔開啟名單工作表〕→〔開啟事奉人員名單〕（說明、確認窗、錯誤指引全部同步；src 一個舊名都沒有）
//   ZC2 〔詩班獻詩〕→〔詩班獻詩日期〕（按鈕、視窗標題、規則審閱說明、AuditLog 備註）
//   ZC3 〔邀請事奉人員申報不能服侍的日子〕＋〔沒有電郵的人：匯出邀請〕⇒ 一個〔寄出／匯出申報不能服侍日子連結〕
//       （行為見 round101_ze_audience；這裏核對名稱、舊按鈕已拿走、伺服器與介面同一句）

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.gs$/.test(f)).map((f) => 'src/' + f)
  .concat(fs.readdirSync(path.join(ROOT, 'src/ui')).filter((f) => /\.html$/.test(f)).map((f) => 'src/ui/' + f));
const grepSrc = (word) => SRC.filter((f) => read(f).indexOf(word) !== -1);

console.log('\n=== ZC1：〔開啟事奉人員名單〕===');
{
  const mf = read('src/ui/ScriptMainFlow.html');
  check('★★★★★★ 按鈕〔開啟事奉人員名單〕', /stepButton\('開啟事奉人員名單', openEligibilitySheet\)/.test(mf));
  check('★★★★★★ src 一個「開啟名單工作表」都沒有（說明、錯誤指引、註解）', grepSrc('開啟名單工作表').length === 0, grepSrc('開啟名單工作表').join('、'));
  check('★★★★★ 錯誤指引用新名', /先按「開啟事奉人員名單」/.test(read('src/EligibilitySheetEditor.gs')));
}

console.log('\n=== ZC2：〔詩班獻詩日期〕===');
{
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 按鈕〔詩班獻詩日期〕', /button\('詩班獻詩日期', \(\) => openChoirSinging\(\), ''\)/.test(z2) && !/button\('詩班獻詩',/.test(z2));
  check('★★★★★ 視窗標題「詩班獻詩日期：…」', /openModal\('詩班獻詩日期：'/.test(z2));
  check('★★★★★ 規則審閱說明、AuditLog 備註用新名', /開季前準備〔詩班獻詩日期〕勾了的主日/.test(read('src/RuleReview.gs')) && /notes: '開季前準備〔詩班獻詩日期〕'/.test(read('src/WebAppChoir.gs')));
  check('★★★★ src 沒有〔詩班獻詩〕（方括號的舊按鈕名）', grepSrc('〔詩班獻詩〕').length === 0, grepSrc('〔詩班獻詩〕').join('、'));
}

console.log('\n=== ZC3：合併為〔寄出／匯出申報不能服侍日子連結〕===');
{
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 前端、伺服器同一句', /const UNAVAILABLE_LINK_BUTTON_LABEL = '寄出／匯出申報不能服侍日子連結';/.test(z2)
    && /const UNAVAILABLE_LINK_BUTTON_LABEL = '寄出／匯出申報不能服侍日子連結';/.test(read('src/UnavailableInvite.gs')));
  check('★★★★★★ 舊的兩粒按鈕已拿走', z2.indexOf("button('邀請事奉人員申報不能服侍的日子'") === -1 && z2.indexOf('INVITE_PAPER_BUTTON_LABEL') === -1);
  check('★★★★★ 只可查看的人仍然可以打開窗（看名單；按鈕灰色）', /VIEW_ONLY_ALLOWED_LABELS = \['寄出季前資料', '寄出／匯出申報不能服侍日子連結'\]/.test(read('src/ui/Script.html')));
  check('★★★★★ 合併窗的 api：讀取在唯讀清單，寄出及匯出是改動（鎖）', /'apiUnavailableLinkPreview'/.test(read('src/WebApp.gs'))
    && /function apiUnavailableLinkSendAndExport\(quarterId, selection\) \{\s*assertWebAppRequestAllowed_\(\);\s*return withMutationLock_\(UNAVAILABLE_LINK_BUTTON_LABEL/.test(read('src/UnavailableInvite.gs')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
