// 第七十七輪批次 ED 組：第 2 步〔儲存〕用主要按鈕樣式，同〔查看／修改職事表〕一樣顯眼。
// 執行方式：node tests/round77_ed_save_button_primary.test.js
//
// Ivan（手動測試 B）：「Pls highlight the button 儲存 like 查看/修改職事表」
//
//   ED1　〔儲存〕唔再係灰色次要按鈕（冇 `secondary`），字體大小、內距同〔查看／修改職事表〕一樣
//   ED2　撳唔到嗰陣照舊變灰（disabled）而且有原因（title）
//   ED3　其餘三粒（檢查我的改動／請系統幫我調整）照舊係次要按鈕

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
vm.runInContext("currentQuarterId = '2099T1';", ui);
const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];
const linkIn = (node, text) => node.flatten().filter((n) => n.tagName === 'A' && n.textContent === text)[0];

console.log('\n=== ED1：主要按鈕樣式 ===');
{
  const card = ui.renderStep2({ latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/g' },
    buttons: { save: { enabled: true } }, versionChoices: [] }, {});
  const save = btnIn(card, '儲存');
  const open = linkIn(card, '查看／修改職事表');
  check('★★★★★★ 〔儲存〕冇 secondary（唔係灰色次要按鈕）', save && !/\bsecondary\b/.test(save.className), save && save.className);
  check('★★★★★ 字體大小同〔查看／修改職事表〕一樣', save && open && save.style.fontSize === open.style.fontSize && save.style.fontSize === 'var(--fs-lg)',
    JSON.stringify([save && save.style.fontSize, open && open.style.fontSize]));
  check('★★★★★ 內距同〔查看／修改職事表〕一樣', save && open && save.style.padding === open.style.padding && save.style.padding === '12px 22px',
    JSON.stringify([save && save.style.padding, open && open.style.padding]));
  check('★★★★ 可以撳', save && !save.disabled);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'Style.html'), 'utf8');
  check('★★★★ Style 有 primary-big（撳唔到嗰陣變灰）', /button\.primary-big:disabled/.test(css));
}

console.log('\n=== ED2：撳唔到 ⇒ 灰、有原因 ===');
{
  const card = ui.renderStep2({ latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/g' },
    buttons: { save: { enabled: false, disabledReason: '有一張建議表未處理。' } }, versionChoices: [] }, {});
  const save = btnIn(card, '儲存');
  check('★★★★★ disabled 而且 title＝原因', save && save.disabled === true && save.title === '有一張建議表未處理。', save && save.title);
}

console.log('\n=== ED3：其餘照舊次要 ===');
{
  const card = ui.renderStep2({ latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/g' },
    buttons: { save: { enabled: true } }, versionChoices: [] }, {});
  check('★★★★ 〔檢查我的改動〕〔請系統幫我調整〕仍然係 secondary',
    /\bsecondary\b/.test(btnIn(card, '檢查我的改動').className) && /\bsecondary\b/.test(btnIn(card, '請系統幫我調整').className));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
