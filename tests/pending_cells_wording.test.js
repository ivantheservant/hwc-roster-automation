// 第二十八輪批次階段 C1：「列出待補格子」唔可以講「全部格子都有人了」。
// 執行方式：node tests/pending_cells_wording.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測（2027T4 v1）
// ─────────────────────────────────────────────────────────────────────
//
// 講員 13 格、獻花 13 格全部空白。
// 生成完成畫面自己講「另有 26 格是要你人手填的」，
// 但「列出待補格子」報 `沒有待補格子／全部格子都有人了`。
//
// **兩個工具對住同一件事講咗相反嘅嘢。**
//
// 兩者其實問緊唔同嘅嘢：`listPendingBackfillCells_()` 只數
// 「系統試過排但排唔到」嗰啲；而講員／翻譯／獻花係**系統本來就唔會排**
// 嘅崗位，永遠唔會出現喺嗰個清單入面。
//
// 所以「0」係對嘅，但「全部格子都有人了」係錯嘅。
// ⚠️ 呢個係同一個 bug class 嘅第四、第五次：
// **計數同文案冇分開「系統要排」同「唔自動排」。**

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
const zone4 = read('src/WebAppZone4.gs');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

console.log('\n=== C1【核心】兩件事分開講 ===');
{
  const body = bodyOf(zone4, 'apiListPendingBackfillCellsForZone4');
  check('★★★★★ 有「系統排不到的格子：N」一行',
    /'系統排不到的格子：' \+ cells\.length/.test(body), body.slice(0, 400));
  check('★★★★★ 有「另有要你人手填的：…」一行',
    /'另有要你人手填的：'/.test(body));
  check('★★★★★ **完全冇咗「全部格子都有人了」呢句**'
    + '——同一份輸出入面，佢同「另有 26 格要人手填」直接矛盾',
    stripComments(zone4).indexOf('全部格子都有人了') === -1);
  check('★★★★★ 亦冇咗「沒有待補格子」呢個標題'
    + '（0 格排不到 ≠ 冇嘢要做）',
    stripComments(zone4).indexOf('沒有待補格子') === -1);
}

console.log('\n=== C1【核心】人手填嘅判斷要同區二共用，唔可以另寫一次 ===');
{
  const body = bodyOf(zone4, 'readManualFillSummaryForZone4_');
  check('★★★★★ 直接叫 apiGetPreQuarterChecklist()'
    + '——區二嗰個「還有 N 項未做」用嘅就係佢',
    /apiGetPreQuarterChecklist\(quarterId\)/.test(body));
  check('★★★★★ 而且用同一組項目 id（preacherEmpty／translationEmpty／flowerEmpty）',
    /\['preacherEmpty', 'translationEmpty', 'flowerEmpty'\]/.test(body));
  check('★★★★★ **冇自己數過翻譯**（翻譯只計 TranslationRequired=TRUE 嘅主日，'
    + '另寫一次就一定會有一日兩邊講唔同嘅數字）',
    !/TRANSLATION_REQUIRED/.test(stripComments(body)));
  check('★★★★ 逐項出數字（「講員 13、獻花 13」），唔係一個加埋嘅總數'
    + '——加埋嘅話，幹事要自己拆返出嚟先知去邊度填',
    /items\.map\(function \(i\) \{[\s\S]{0,200}?i\.count/.test(body)
    && /\.join\('、'\)/.test(body));
}

console.log('\n=== C1 查不到就講查不到 ===');
{
  const body = bodyOf(zone4, 'readManualFillSummaryForZone4_');
  check('★★★★★ 讀唔到 ⇒ available:false ＋ 一句原因'
    + '——回一個 0 或者空白會令幹事以為「冇嘢要填」',
    /available: false, text: '', reason: '查不到（/.test(body));
  const caller = bodyOf(zone4, 'apiListPendingBackfillCellsForZone4');
  check('★★★★★ 而且呼叫端真係分開兩條路（available 真／假）',
    /manual\.available[\s\S]{0,200}?manual\.reason/.test(caller));
}

console.log('\n=== C1 版本：仍然用最新版本，唔叫幹事揀 ===');
{
  const body = bodyOf(zone4, 'apiListPendingBackfillCellsForZone4');
  check('★★★★ 用 findLatestVersionNo()（「而家仲有邊幾格未填」永遠問最新版本）',
    /findLatestVersionNo\(id\)/.test(body));
  check('★★★★ 冇版本時講一句人話，唔會拋錯',
    body.indexOf('這一季還沒有生成過任何版本') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
