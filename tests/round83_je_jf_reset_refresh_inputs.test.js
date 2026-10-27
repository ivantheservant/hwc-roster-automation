// 第八十三輪批次 JE／JF 組：
//   JE　〔整季清走重來〕撳〔完成〕之後，同〔重新整理〕同一條路整頁重畫（第 1 步唔再寫「現時有 4 個版本」）
//   JF　「特大」字體下圓形選項同勾選框跟住放大——**全部** radio／checkbox，冇一個被排除
// 執行方式：node tests/round83_je_jf_reset_refresh_inputs.test.js
//
// 現場：第八十二輪 Q8（清走後要撳〔重新整理〕先更新）；Q0b（寄出窗嘅選項特大級仍然約 8–10px）。
// JF 原因：輸入框唔繼承字號，`width: 1em` 永遠係瀏覽器預設字號（約 13px）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const UI = path.join(__dirname, '..', 'src', 'ui');
const read = (f) => fs.readFileSync(path.join(UI, f), 'utf8');

(async () => {
  console.log('\n=== JE：清走完成 ⇒ 同〔重新整理〕同一條路 ===');
  {
    const ui = loadUiScripts(['Script.html', 'ScriptZone3.html', 'ScriptMainFlow.html']);
    ui.setInterval = () => 0;
    ui.clearInterval = () => {};
    let loads = 0;
    ui.loadDashboard = async () => { loads++; };
    vm.runInContext("currentQuarterId = '2028T3'; mainFlowState_ = { versions: 4 }; mainFlowStaleQuarter_ = '2028T3';", ui);
    await ui.refreshLikeButton();
    check('★★★★★★ JE refreshLikeButton 清走主流程快取（第 1 步會重畫）',
      vm.runInContext('mainFlowState_ === null && mainFlowStaleQuarter_ === null', ui));
    check('★★★★★ JE 而且重新讀 dashboard', loads === 1, String(loads));
    const z3 = read('ScriptZone3.html');
    const reset = z3.slice(z3.indexOf('function openQuarterResetFromDashboard'), z3.indexOf('function renderZone3Always'));
    check('★★★★★★ JE 清走完成窗〔完成〕用 refreshLikeButton（唔係 closeModalAndRefresh）',
      reset.indexOf("button('完成', () => refreshLikeButton(), '')") !== -1 && reset.indexOf('closeModalAndRefresh') === -1, reset.slice(-600));
    check('★★★★★ JE 頁頂〔重新整理〕都係同一支', read('ScriptBoot.html').indexOf("el('btnRefresh').addEventListener('click', () => refreshLikeButton());") !== -1);
  }

  console.log('\n=== JF：全部 radio／checkbox 跟字體放大 ===');
  {
    const css = read('Style.html').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /input\[type="checkbox"\], input\[type="radio"\] \{([^}]*)\}/.exec(css);
    check('★★★★★★ JF 有一條全域規則同時管 checkbox 同 radio', !!rule);
    const body = rule ? rule[1] : '';
    check('★★★★★★ JF 闊高用字號變數（唔係 1em、唔係寫死 px）',
      /width:\s*calc\(var\(--fs-[a-z0-9]+\)\s*\*\s*[\d.]+\)/.test(body) && /height:\s*calc\(var\(--fs-[a-z0-9]+\)\s*\*\s*[\d.]+\)/.test(body), body);
    const others = [];
    css.replace(/([^{}]+)\{([^}]*)\}/g, (_m, sel, decl) => {
      if (/type="?(checkbox|radio)"?/.test(sel) && /(width|height)\s*:/.test(decl) && !/^\s*input\[type="checkbox"\], input\[type="radio"\]\s*$/.test(sel)) {
        others.push(sel.trim() + ' {' + decl.trim() + '}');
      }
      return '';
    });
    check('★★★★★★ JF 冇其他規則另外設 radio／checkbox 嘅闊高（冇一個被排除或者寫死）', others.length === 0, others.join('\n'));
    const scripts = fs.readdirSync(UI).filter((f) => /^Script.*\.html$/.test(f)).map(read).join('\n');
    check('★★★★ JF 前端冇逐個 inline 設勾選框大小', !/cb\.style\.(width|height)|input\.style\.(width|height)/.test(scripts));
  }
})().then(() => {
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
  process.exit(fail === 0 ? 0 : 1);
}, (e) => { console.log('FAIL  未預期例外：' + e.stack); process.exit(1); });
