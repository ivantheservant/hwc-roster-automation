// 第一百零四輪批次 PD 組：使用者看得到的字串不可以叫人按一個不存在的按鈕。
// 執行方式：node tests/round104_pd_button_names.test.js
//
// 現場：SuggestionSheet.gs 的提示寫「儲存我的修改」，但第 2 步的按鈕是〔儲存〕。
// 全專案掃一次：「按／撳／用 … 〔X〕／「X」」而 X 是已經不存在的按鈕名稱（舊名）⇒ 一律改為現時按鈕名稱。
//
//   PD1　src 內（註解除外）不再有這幾個舊名稱的按鈕引用
//   PD2　逐處核對改成的現時按鈕名稱
//   PD3　〔儲存〕的鎖名稱（「另一個動作仍在進行，所以「…」沒有開始」）用按鈕本身的名稱

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).map((f) => path.join(SRC, f))
  .concat(fs.readdirSync(path.join(SRC, 'ui')).filter((f) => f.endsWith('.html')).map((f) => path.join(SRC, 'ui', f)));
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// 已經不存在的按鈕名稱（現時名稱寫在右邊，只作說明）
const OLD = {
  '儲存我的修改': '〔儲存〕',
  '寄給堂委審閱': '〔寄給堂委／執事〕',
  '改動後重發': '〔變動的人〕',
  '生成初稿': '第 1 步的生成按鈕（〔生成<季度>職事表〕）',
  '邀請事奉人員申報不能服侍的日子': '〔寄出／匯出申報不能服侍日子連結〕',
  '邀請義工申報不能服侍的日子': '〔寄出／匯出申報不能服侍日子連結〕',
  '產生 docx': '〔寄出及匯出〕',
  '正式發出': '〔給所有人〕'
};
// 刻意保留（理由）：Config 說明文字由一次性更新工具（SheetTextUpdate.gs）核對「完全等於」，
// 改了會令已經更新過的試算表被列為「不相等，略過」——只出現在 Config 工作表的說明欄，幹事介面看不到。
const ALLOW = ['ConfigSeed.gs:TRIGGER_AUTO_GENERATE', 'SheetTextUpdate.gs:TRIGGER_AUTO_GENERATE'];

const names = Object.keys(OLD).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const pressRe = new RegExp('(按|撳|點|用|改用|執行)[^，。；\'"]{0,8}?[「〔](' + names + ')[」〕]', 'g');
const bracketRe = new RegExp('〔(' + names + ')〕', 'g');

console.log('\n=== PD1：掃描 ===');
const hits = [];
files.forEach((f) => {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
    if (!/['`"]/.test(line)) return;
    const found = [...line.matchAll(pressRe)].map((m) => m[0]).concat([...line.matchAll(bracketRe)].map((m) => m[0]));
    if (found.length === 0) return;
    const base = path.basename(f);
    // 允許清單：同一個 Config Key 的說明（往上十行內有那個 Key）
    const ctx = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
    if (ALLOW.some((a) => { const [file, key] = a.split(':'); return base === file && ctx.indexOf(key) !== -1; })) return;
    hits.push(base + ':' + (i + 1) + '  ' + found.join(' | '));
  });
});
check('★★★★★★ 使用者看得到的字串沒有叫人按舊名稱的按鈕', hits.length === 0, hits.join('\n      '));

console.log('\n=== PD2：逐處核對 ===');
check('★★★★★★ 系統調整的提示：按第 2 步的〔儲存〕（不是「儲存我的修改」）',
  /'或者按第 2 步的〔儲存〕，確認窗內有〔立即加入這個人〕'/.test(read('SuggestionSheet.gs')));
const rb = read('ui/ScriptRollback.html');
check('★★★★★ 回到上一個版本：先按第 2 步的〔儲存〕', /先按第 2 步的〔儲存〕，再回來按這個按鈕/.test(rb));
check('★★★★★ 回退之後：第 3 步按〔變動的人〕', /回退之後要在第 3 步按〔變動的人〕/.test(rb) && /記得在第 3 步按〔變動的人〕通知他們/.test(rb));
check('★★★★★ 公開連結未更新：先不要按〔寄給堂委／執事〕', /先不要按〔寄給堂委／執事〕/.test(read('ui/ScriptZone1.html')));
check('★★★★ 狀態卡：按下面第 1 步的生成按鈕', /按下面第 1 步的生成按鈕/.test(read('WebAppDashboard.gs')));
check('★★★★ 上線前檢查：第 3 步按〔給所有人〕', /幹事在第 3 步按〔給所有人〕之後/.test(read('PreLaunchChecklist.gs')));
// 改成的名稱真的是按鈕
const ui = files.filter((f) => /\.html$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
['儲存', '寄給堂委／執事', '變動的人', '給所有人', '立即加入這個人', '寄出及匯出'].forEach((n) => {
  check('★★★★ 〔' + n + '〕是現時介面上的按鈕', ui.indexOf("button('" + n + "'") !== -1 || ui.indexOf("stepButton('" + n + "'") !== -1);
});

console.log('\n=== PD3：鎖的名稱 ===');
check('★★★★★ 〔儲存〕的鎖名稱是「儲存」', /withMutationLock_\('儲存', function \(\) \{\n\s*return apiSaveAndConfirmExecute_locked_/.test(read('WebAppSaveConfirm.gs').replace(/\r\n/g, '\n')));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
