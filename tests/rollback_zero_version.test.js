// 第二十八輪批次階段 C3／C4：兩句同事實相反嘅畫面文字。
// 執行方式：node tests/rollback_zero_version.test.js
//
// ─────────────────────────────────────────────────────────────────────
// C3　Ivan 實測：2027T1 一個版本都冇
// ─────────────────────────────────────────────────────────────────────
//
// 撳「回到上一個版本」，彈出嘅係
// `這一季只有一個版本，沒有可以回去的舊版本。`
// ——一句同事實相反嘅話。
//
// 成因：舊寫法用 `versions.length < 2` 一次過蓋住 0 同 1。
// 而 0 同 1 對幹事嚟講下一步完全唔同：
//   0 ⇒ 去撳「生成初稿」
//   1 ⇒ 等下一版，冇嘢可以做
//
// ⚠️ 同一個 bug class：**兩個唔同嘅狀態被合併成一句話**。
//
// ─────────────────────────────────────────────────────────────────────
// C4　重新生成完成畫面寫「規則違反（未提供）項」
// ─────────────────────────────────────────────────────────────────────
//
// 冇假造一個 0 係啱嘅——但個數字其實攞得到，只係讀錯咗欄名。

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
const rollback = read('src/ui/ScriptRollback.html');
const zone4 = read('src/ui/ScriptZone4.html');
const backend = read('src/WebApp.gs');

/**
 * 剝走註解再檢查。
 * ⚠️ 唔剝嘅話，**解釋「唔可以寫成咩」嘅註解本身就含住嗰個寫法**，
 * 而唯一嘅「修法」就係把註解寫得含糊。本專案已經撞過幾次。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const zone4Code = stripComments(zone4);

console.log('\n=== C3【核心】三種情況要分開講 ===');
{
  check('★★★★★ **冇咗 `< 2` 呢個一次過蓋住 0 同 1 嘅判斷**',
    !/data\.versions\.length < 2/.test(rollback)
    && !/versions\|\|\s*\[\]\)\.length < 2/.test(rollback));

  check('★★★★★ 0 個版本 ⇒ 「這一季還沒有生成初稿。」',
    /count === 0/.test(rollback)
    && rollback.indexOf('這一季還沒有生成初稿。') !== -1);
  check('★★★★★ 而且講埋下一步（去撳生成初稿）'
    + '——一句「還沒有」冇話俾佢知應該做乜',
    rollback.indexOf('先在上面撳「生成初稿」，之後才會有版本可以回去。') !== -1);

  check('★★★★★ 1 個版本 ⇒ 原本嗰句照樣保留（嗰句本身冇錯）',
    /count === 1/.test(rollback)
    && rollback.indexOf('這一季只有一個版本，沒有可以回去的舊版本。') !== -1);

  check('★★★★★ ≥2 個版本 ⇒ 行正常流程',
    /renderRollbackPicker\(data\)/.test(rollback));

  // 次序：0 嘅判斷一定要行喺 1 之前，否則 0 會跌入 1 嗰條。
  check('★★★★ 0 嘅判斷排喺 1 之前',
    rollback.indexOf('count === 0') < rollback.indexOf('count === 1'));
}

console.log('\n=== C3 後端：0 版本仍然回一個乾淨結構，唔拋錯 ===');
{
  const src = read('src/WebAppRollback.gs');
  check('★★★★ apiListVersionsForRollback 冇版本時回空陣列（前端自己分辨）',
    /return \{ latestVersionNo: latestVersionNo, versions: versions \};/.test(src));
  check('★★★★★ 而 apiRollbackPlan 嗰邊本來就有 NO_VERSION 分支'
    + '（後端唔靠前端做關卡）',
    /rollbackBlocked_\('NO_VERSION'/.test(src)
    && src.indexOf('這一季還沒有生成過任何版本。') !== -1);
}

console.log('\n=== C4【核心】重新生成完成：唔可以寫「（未提供）」 ===');
{
  check('★★★★★ 冇咗 `res.violationCount`（`apiGenerateRoster()` 根本冇呢個欄位）'
    + '——讀一個唔存在嘅欄名，畫面就永遠印「（未提供）」',
    !/res\.violationCount/.test(zone4Code));
  check('★★★★★ 亦冇咗「（未提供）」呢四個字',
    zone4Code.indexOf('（未提供）') === -1);
  check('★★★★★ 改成讀 `res.warnings`（`apiGenerateRoster()` 真係有回）',
    /typeof res\.warnings === 'number'/.test(zone4));
  check('★★★★★ 攞唔到嗰陣寫「稍後可用『核對職事表』查看」，而唔係一個假 0'
    + '——假 0 會令幹事以為已經檢查過而且冇問題',
    zone4.indexOf('規則違反：稍後可用「核對職事表」查看。') !== -1);
  check('★★★★ 順帶把「已排／留空」都寫出嚟，而且講明留空包括人手填嗰啲'
    + '（同階段 C1 同一個道理）',
    zone4.indexOf('留空包括講員／翻譯／獻花這些要你人手填的') !== -1);

  // 反面：後端真係回嗰個欄位。
  check('★★★★★ 後端 apiGenerateRoster() 確實有回 warnings／assigned／blank',
    /warnings: result\.warnings/.test(backend)
    && /assigned: result\.assigned/.test(backend)
    && /blank: result\.blank/.test(backend));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
