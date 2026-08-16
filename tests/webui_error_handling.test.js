// 階段 B（收尾輪）：Web UI 前端錯誤處理的靜態原始碼稽核。
// 執行方式：node tests/webui_error_handling.test.js
//
// src/ui/Script.html 是純前端 HTML/JS，沒有 DOM／jsdom 環境可以真正執行渲染，
// 所以跟 tests/webapp_access_guard.test.js 用同一套手法——直接讀取原始碼文字，
// 用樣式比對驗證「這一類問題不會再發生」，不是真正執行畫面互動。
//
// 背景：本輪稽核發現 Script.html 有兩類「google.script.run 呼叫完全沒有錯誤
// 處理」的情況——(1) closeWizardAndRefresh()（全部五步驟的取消／完成／關閉
// 按鈕共用）原本直接 `await loadFlowState()`，沒有包 runAction()；(2) 步驟 4
// 的兩個「繼續」按鈕直接呼叫沒有自己包 runAction() 的函式。兩者的共同後果都是
// ——失敗時完全靜默、沒有任何錯誤訊息、畫面看起來像卡住。這裡把「必須包
// runAction()」這件事寫成可以長期回歸的靜態檢查，不依賴人手每次重新閱讀原始碼。

const fs = require('fs');
const path = require('path');
const scriptHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'Script.html'), 'utf8');
const sidebarHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'PreacherFillSidebar.html'), 'utf8');

let fail = 0;
function check(label, condition) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

console.log('\n=== closeWizardAndRefresh()：必須經過 runAction()，不可以直接 await loadFlowState() ===');
{
  const fnMatch = scriptHtml.match(/async function closeWizardAndRefresh\(\)\s*\{([\s\S]*?)\n  \}/);
  check('★ 找得到 closeWizardAndRefresh() 函式本身', !!fnMatch);
  const body = fnMatch ? fnMatch[1] : '';
  check('★ 函式內容有呼叫 runAction(（不是裸露的 await loadFlowState()）', body.indexOf('runAction(') !== -1);
  check('★ 函式內容不再有「裸露」的 await loadFlowState()（即前面不是 runAction 相關字樣）',
    !/await loadFlowState\(\);/.test(body) || body.indexOf('runAction(') !== -1);
}

console.log('\n=== 步驟 4 的兩個「繼續」按鈕：呼叫 step4CheckMissingPdf／step4SendPreview 時必須包 runAction() ===');
{
  const hasWrappedCheckMissingPdf = /runAction\([^)]*step4CheckMissingPdf/.test(scriptHtml)
    || /runAction\(\s*['"][^'"]*['"]\s*,\s*\(\)\s*=>\s*step4CheckMissingPdf/.test(scriptHtml);
  const hasWrappedSendPreview = /runAction\([^)]*step4SendPreview/.test(scriptHtml)
    || /runAction\(\s*['"][^'"]*['"]\s*,\s*\(\)\s*=>\s*step4SendPreview/.test(scriptHtml);
  check('★ 呼叫 step4CheckMissingPdf 的地方有被 runAction( 包住', hasWrappedCheckMissingPdf);
  check('★ 呼叫 step4SendPreview 的地方有被 runAction( 包住', hasWrappedSendPreview);

  // 反向檢查：不應該再有「裸露」的 button(..., () => step4CheckMissingPdf(...), ...)
  // 或 button(..., () => step4SendPreview(...), ...)（前面沒有 runAction 包住）。
  const bareCheckMissingPdf = /button\([^)]*=>\s*step4CheckMissingPdf/.test(scriptHtml);
  const bareSendPreview = /button\([^)]*=>\s*step4SendPreview\(versionNo\)\s*,/.test(scriptHtml);
  check('★ 沒有殘留「裸露」呼叫 step4CheckMissingPdf 的 button()（即沒有被 runAction 包住的版本）', !bareCheckMissingPdf);
  check('★ 沒有殘留「裸露」呼叫 step4SendPreview 的 button()（即沒有被 runAction 包住的版本）', !bareSendPreview);
}

console.log('\n=== loadQuarters()：Quarters 完全沒有資料時，必須顯示明確說明，不能維持空白畫面 ===');
{
  const fnMatch = scriptHtml.match(/async function loadQuarters\(\)\s*\{([\s\S]*?)\n  \}/);
  check('★ 找得到 loadQuarters() 函式本身', !!fnMatch);
  const body = fnMatch ? fnMatch[1] : '';
  check('★ 函式內容有 else 分支（沒有季度時的處理）', /\}\s*else\s*\{/.test(body));
  check('★ else 分支內有呼叫 setStatus(（顯示說明文字，不是靜默）', body.indexOf('setStatus(') !== -1);
}

console.log('\n=== alreadySentCount 警告：步驟 2／4 的前端畫面要顯示這個新欄位（跟後端 planStep2_／planStep4SendPreview_ 同步）===');
{
  check('★ Script.html 有讀取 preview.alreadySentCount（步驟 2 或步驟 4 其中一處）',
    scriptHtml.indexOf('alreadySentCount') !== -1);
  const occurrences = (scriptHtml.match(/alreadySentCount/g) || []).length;
  check('★ 步驟 2、步驟 4 兩處都有顯示（至少出現 2 次）', occurrences >= 2);
}

console.log('\n=== PreacherFillSidebar.html：save() 必須在請求進行中停用按鈕，防止手快連撳送出兩次 ===');
{
  const fnMatch = sidebarHtml.match(/function save\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  check('★ 找得到 save() 函式本身', !!fnMatch);
  const body = fnMatch ? fnMatch[1] : '';
  check('★ 函式內容有把 saveBtn.disabled 設成 true（送出請求前停用按鈕）', /saveBtn\.disabled\s*=\s*true/.test(body));
  // 第十四輪批次階段 C：save() 改用共用嘅 saveOne()（包 Promise，畀「全部儲存」
  // 按鈕可以用 Promise 一齊等），失敗處理由 .withFailureHandler() 改成
  // .catch(——兩個檢查分別鎖住呢兩層各自嘅失敗路徑都有將按鈕重新啟用。
  check('★ save() 本身嘅 .catch( 有把按鈕重新啟用（saveBtn.disabled = false），失敗後使用者才可以重試',
    /\.catch\([\s\S]*?saveBtn\.disabled\s*=\s*false/.test(body));

  const saveOneMatch = sidebarHtml.match(/function saveOne\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  check('★★ 找得到共用嘅 saveOne()（save()／saveAll() 共用同一個真正送出請求嘅函式）', !!saveOneMatch);
  const saveOneBody = saveOneMatch ? saveOneMatch[1] : '';
  check('★★ saveOne() 用 withFailureHandler 將 google.script.run 嘅失敗轉成 Promise reject（唔會靜默吞錯誤）',
    /withFailureHandler[\s\S]*?reject\(/.test(saveOneBody));
}

console.log('\n=== PreacherFillSidebar.html：saveAll()（全部儲存）失敗時一樣要重新啟用按鈕、唔會靜默 ===');
{
  const fnMatch = sidebarHtml.match(/function saveAll\(\)\s*\{([\s\S]*?)\n  \}/);
  check('★★ 找得到 saveAll() 函式本身（第十四輪批次階段 C 新增）', !!fnMatch);
  const body = fnMatch ? fnMatch[1] : '';
  check('★ saveAll() 的 .catch( 有把對應格子嘅 saveBtn.disabled 重新啟用', /\.catch\([\s\S]*?saveBtn\.disabled\s*=\s*false/.test(body));
  check('★ saveAll() 有記錄失敗嘅格子（failed 陣列）並喺完成訊息反映，唔會靜默略過失敗',
    body.indexOf('failed.push') !== -1 && /failed\.length/.test(body));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
