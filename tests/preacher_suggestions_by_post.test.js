// 第二十五輪批次階段 C：講員／翻譯／獻花嘅建議名單要用 PostID 索引。
// 執行方式：node tests/preacher_suggestions_by_post.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// 幹事介面區二「填講員／翻譯／獻花」嘅建議下拉**永遠空白**。
//
// 成因係前後端各講各嘅：
//   前端讀 `c.suggestions`（逐格）
//   後端回 `preacherSuggestions`／`translationSuggestions`／
//         `flowerSuggestions`（頂層，三個唔同欄名）
//
// 而且前端仲有一句 `data.cells || data.pending`——後端從來冇 `cells`
// 呢個欄。呢種 fallback 睇落穩陣，實際上**遮蓋咗結構不符**：
// 兩個名都唔啱嘅話畫面只會空白，唔會報錯，而空白同「真係冇嘢要填」
// 睇落一模一樣。
//
// 修法揀咗**改後端**（加 `suggestionsByPostId`），唔係喺前端靠崗位名稱
// 做字串比對——崗位名係幹事可以喺 Posts 工作表自由改嘅，改一次就會
// 靜靜咁令全部建議消失而唔報錯。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const backend = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'PreacherTranslationFill.gs'), 'utf8');
const frontend = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8');
const sidebar = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'PreacherFillSidebar.html'), 'utf8');

const apiFn = backend.slice(backend.indexOf('function apiListPreacherTranslationPending'));
const apiBody = apiFn.slice(0, apiFn.indexOf('\n}\n') + 3);

console.log('\n=== C【核心】後端要有 suggestionsByPostId ===');
{
  check('★★★★★ 回傳物件有 suggestionsByPostId',
    /suggestionsByPostId: suggestionsByPostId/.test(apiBody));
  check('★★★★★ 三個崗位都有入索引（講員／翻譯／獻花）',
    /suggestionsByPostId\[ids\.preacherPostId\]/.test(apiBody)
    && /suggestionsByPostId\[ids\.translationPostId\]/.test(apiBody)
    && /suggestionsByPostId\[ids\.flowerPostId\]/.test(apiBody));
  check('★★★★★ 崗位 ID 唔存在時唔會加一個 undefined key'
    + '——加咗會令前端攞到 undefined 而唔係空陣列',
    /if \(ids\.preacherPostId\) suggestionsByPostId/.test(apiBody));
}

console.log('\n=== C 三個舊欄位唔可以刪——側邊欄仲用緊 ===');
{
  check('★★★★★ 後端仍然回 preacherSuggestions／translationSuggestions／flowerSuggestions',
    /preacherSuggestions: preacherSuggestions/.test(apiBody)
    && /translationSuggestions: translationSuggestions/.test(apiBody)
    && /flowerSuggestions: flowerSuggestions/.test(apiBody));
  check('★★★★★ 而且側邊欄確實仲讀緊佢哋（證明唔係為刪而留）'
    + '——刪咗會令一個而家行得通嘅工具即刻壞',
    /preacherSuggestions|translationSuggestions|flowerSuggestions/.test(sidebar));
}

console.log('\n=== C【核心】前端要用 PostID 攞，唔可以用崗位名稱比對 ===');
{
  const fn = frontend.slice(frontend.indexOf('function renderPreacherFill'));
  const body = fn.slice(0, fn.indexOf('\n  }\n') + 5);

  check('★★★★★ 用 suggestionsByPostId[c.postId]',
    /suggestionsByPostId\[c\.postId\]/.test(body));
  check('★★★★★ 攞唔到時 fallback 係空陣列（唔係 undefined，避免 .length 爆）',
    /suggestionsByPostId\[c\.postId\] \|\| \[\]/.test(body));
  check('★★★★★ **唔可以**用崗位名稱做字串比對'
    + '——崗位名係幹事可以改嘅，改一次就會靜靜令全部建議消失而唔報錯',
    body.indexOf("postName === '講員'") === -1
    && body.indexOf("postName === '翻譯'") === -1
    && body.indexOf("postName === '獻花'") === -1);
  check('★★★★ 唔再讀已經唔存在嘅逐格 c.suggestions',
    body.indexOf('c.suggestions') === -1);
}

console.log('\n=== C【核心】data.cells fallback 要收窄成單一 data.pending ===');
{
  check('★★★★★ 冇咗 `data.cells || data.pending` 呢種會遮蓋結構不符嘅 fallback'
    + '——兩個名都唔啱時只會空白，而空白同「真係冇嘢要填」睇落一模一樣',
    frontend.indexOf('data.cells || data.pending') === -1);
  check('★★★★ 改成直接讀 data.pending', /const cells = data\.pending \|\| \[\];/.test(frontend));
}

console.log('\n=== C officialSentHint 要真係用到 ===');
{
  check('★★★★★ 後端一直都有回 officialSentHint',
    /officialSentHint:/.test(apiBody));
  check('★★★★★ 前端而家真係讀佢（之前完全冇用到）',
    /data\.officialSentHint/.test(frontend));
  check('★★★★ 而且顯示規格指定嗰句',
    frontend.indexOf('這一季已經正式發出，改動之後記得用「改動後重發」通知受影響的人。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
