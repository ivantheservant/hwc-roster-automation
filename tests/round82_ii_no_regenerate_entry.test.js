// 第八十二輪批次 II 組：幹事介面拿走〔重新生成初稿（覆蓋式）〕（Ivan 決定）。
// 執行方式：node tests/round82_ii_no_regenerate_entry.test.js
//
// 現場：Stage 係 REQUESTS_APPLIED 嗰陣撳〔重新生成初稿（覆蓋式）〕⇒「需要 Stage 為『DRAFT』」。
// Ivan：要重來就用〔整季清走重來〕再生成；要回到之前嘅內容就用版本下拉〔用這一版作起點〕。
//
//   II1　常用設定冇〔重新生成初稿（覆蓋式）〕；前端冇 openRegenerate；任何 UI 字串冇「重新生成初稿」
//   II2　第 1 步已生成嗰句、灰掣原因指去〔整季清走重來〕／〔用這一版作起點〕
//   II3　後端會出現喺畫面嘅訊息（第 1 步警告、掣 0 原因、重複生成、名單選單）同一句 REDO_QUARTER_HINT_TEXT
//   II4　伺服器函式 apiGenerateRoster 保留（試算表選單、自測仍然用）

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const SRC = path.join(__dirname, '..', 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
// 拿走註解（`//` 行尾、`/* */`、`*` 開頭嘅 JSDoc 行），只睇真正會顯示嘅字串
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');

console.log('\n=== II1：常用設定同前端 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  ui.renderZone3({ settingsLinks: {} });
  const text = ui.document.getElementById('zone3Body').textContent;
  check('★★★★★★ 常用設定冇〔重新生成初稿（覆蓋式）〕', text.indexOf('重新生成初稿') === -1, text);
  check('★★★★★ 前端冇 openRegenerate', typeof ui.openRegenerate === 'undefined');
  const hits = fs.readdirSync(path.join(SRC, 'ui')).filter((f) => /\.html$/.test(f))
    .filter((f) => /重新生成初稿/.test(codeOnly(read(path.join('ui', f)))));
  check('★★★★★★ 任何 UI 檔（註解以外）冇「重新生成初稿」', hits.length === 0, JSON.stringify(hits));
  const mf = codeOnly(read('ui/ScriptMainFlow.html'));
  check('★★★★★ 第 1 步唔再叫人去「重新生成」', !/要重新生成這一季/.test(mf));
}

console.log('\n=== II2：第 1 步嗰句 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptMainFlow.html']);
  check('★★★★★ 提示句指去〔整季清走重來〕同〔用這一版作起點〕',
    /整季清走重來/.test(vm.runInContext('REDO_QUARTER_HINT', ui)) && /用這一版作起點/.test(vm.runInContext('REDO_QUARTER_HINT', ui)));
  const mf = read('ui/ScriptMainFlow.html');
  check('★★★★★ 灰掣原因同已生成嗰句都用 REDO_QUARTER_HINT',
    (mf.match(/REDO_QUARTER_HINT\)/g) || []).length + (mf.match(/'這一季已經生成過了。' \+ REDO_QUARTER_HINT/g) || []).length >= 2, '');
}

console.log('\n=== II3：後端訊息 ===');
{
  const gas = loadGasSource(['Constants.gs']);
  check('★★★★ REDO_QUARTER_HINT_TEXT 存在而且兩個入口都講', /整季清走重來/.test(gas.REDO_QUARTER_HINT_TEXT)
    && /用這一版作起點/.test(gas.REDO_QUARTER_HINT_TEXT));
  ['WebAppMainFlow.gs', 'WebAppDashboard.gs', 'WebAppGenerate.gs'].forEach((f) => {
    const c = codeOnly(read(f));
    check('★★★★★ ' + f + ' 用 REDO_QUARTER_HINT_TEXT、冇叫人重新生成初稿',
      /REDO_QUARTER_HINT_TEXT/.test(c) && !/重新生成初稿|如果想重新生成|如果要重新生成/.test(c));
  });
  check('★★★★ 名單選單（GridNameDropdown.gs）唔再叫人重新生成初稿', !/重新生成初稿/.test(codeOnly(read('GridNameDropdown.gs'))));
}

console.log('\n=== II4：伺服器函式保留 ===');
{
  check('★★★★ apiGenerateRoster 仍然存在（選單、自測）', /function apiGenerateRoster\(/.test(fs.readdirSync(SRC)
    .filter((f) => /\.gs$/.test(f)).map((f) => read(f)).join('\n')));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
