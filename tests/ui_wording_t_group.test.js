// 第六十三輪批次 T 組第 2、3 點：畫面文字。
// 執行方式：node tests/ui_wording_t_group.test.js
//
// T2：等候牌所有動作等到 25 秒都顯示「這一步通常要三十幾秒」。實測儲存要
//     70–160 秒、讀取確認資料 30–55 秒、產生個人 PDF 約 10 分鐘。
// T3：「回到上一個版本」確認框同時寫「這個動作不可逆」同「第 N 版不會被刪除，
//     仍然可以再回去」。回退唔刪任何版本。
// （T 組第 1 點——三種寄出確認框列出附件同日曆檔——喺 tests/official_partial_send.test.js。）

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const UI = path.join(__dirname, '..', 'src', 'ui');
/** 拆走註解，淨低真正會顯示／執行嘅程式碼。 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

console.log('\n=== T2：等候牌唔講一個對大部分動作都錯嘅秒數 ===');
{
  const script = fs.readFileSync(path.join(UI, 'Script.html'), 'utf8');
  const live = code(script);
  check('★★★★★★ 程式碼入面冇「三十幾秒」', live.indexOf('三十幾秒') === -1,
    (live.match(/.{0,40}三十幾秒.{0,40}/) || [''])[0]);
  const m = script.match(/const BUSY_SLOW_HINT_TEXT = '([^']*)';/);
  check('（前提）有 BUSY_SLOW_HINT_TEXT', !!m);
  check('★★★★★ 句子唔講秒數（冇阿拉伯數字、冇「秒」）',
    m && !/[0-9０-９]/.test(m[1]) && m[1].indexOf('秒') === -1, m && m[1]);
  check('★★★★ 仍然叫佢唔好關頁', m && /不要關掉這一頁/.test(m[1]), m && m[1]);
  check('★★★★ 仍然係 25 秒之後先出（一開始就講會令人以為每個動作都咁耐）',
    /const BUSY_SLOW_HINT_AFTER_SECS = 25;/.test(script)
    && /secs >= BUSY_SLOW_HINT_AFTER_SECS/.test(live)
    && /'已經 ' \+ secs \+ ' 秒　' \+ BUSY_SLOW_HINT_TEXT/.test(live));
}

console.log('\n=== T3：回退確認框唔講「不可逆」 ===');
{
  const rb = fs.readFileSync(path.join(UI, 'ScriptRollback.html'), 'utf8');
  const fn = rb.slice(rb.indexOf('function renderRollbackPreview('), rb.indexOf('function rollbackStageNote('));
  const confirmCall = fn.slice(fn.indexOf('openConfirm({'));
  check('（前提）回退預覽有打字確認', /requireTyping: true/.test(confirmCall));
  check('★★★★★★ 有自己嘅 typingHint（唔用預設嗰句「這個動作不可逆」）',
    /typingHint: '確定的話，請在下面輸入「' \+ CONFIRM_PHRASE \+ '」兩個字：'/.test(confirmCall),
    confirmCall.slice(0, 600));
  check('★★★★★ 回退框嘅程式碼入面冇「不可逆」', code(fn).indexOf('不可逆') === -1);
  check('★★★★ 同一個框仍然講「不會被刪除，仍然可以查看和再回去」',
    /版不會被刪除，仍然可以查看和再回去/.test(fn));
  const common = fs.readFileSync(path.join(UI, 'Script.html'), 'utf8');
  check('★★★ 預設提示（真正不可逆嘅寄出用）冇改',
    /opts\.typingHint \|\| '這個動作不可逆。確定的話/.test(common));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
