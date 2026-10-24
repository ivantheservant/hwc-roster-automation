// 第七十五輪批次 CN 組：主流程第 1 步拿走〔用「匯入」〕；匯入只留喺「進階與診斷」。
// 執行方式：node tests/round75_cn_no_import_step1.test.js
//
// 現場（Ivan 手動測試 A）：生成前、生成後撳〔用「匯入」〕都只係開「檢查匯入表：填了 0 格」，
// 佢以為係匯入 Excel／PDF。真正嘅匯入要先「建立匯入表」再貼舊表——屬進階功能。
//
// 呢一份**真係執行** `renderStep1()`（ui_loader），睇畫咗乜出嚟，唔係讀字串。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ui = loadUiScripts(['Script.html', 'ScriptMainFlow.html']);
vm.runInContext("currentQuarterId = '2099T3';", ui);

function texts(node) {
  return node.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
}

console.log('\n=== CN：第 1 步冇〔用「匯入」〕 ===');
{
  const flow = {
    generateTarget: {
      found: true, quarterId: '2099T3', label: '2099年7-9月', alreadyGenerated: false,
      versionCount: 0, generateOn: '2099-05-27', daysUntil: 10
    },
    permanentLink: { hasLink: false }
  };
  const card = ui.renderStep1({ latestVersion: null }, flow);
  const btns = texts(card);
  check('★★★★★ 未生成：第 1 步仍有生成掣', btns.some((t) => /生成2099年7-9月職事表/.test(t)), JSON.stringify(btns));
  check('★★★★★★ 未生成：冇〔用「匯入」〕掣', !btns.some((t) => /匯入/.test(t)), JSON.stringify(btns));
  check('★★★★★ 未生成：冇「已經用舊方法排好？」', !/已經用舊方法排好/.test(card.textContent), card.textContent);

  const flow2 = JSON.parse(JSON.stringify(flow));
  flow2.generateTarget.alreadyGenerated = true;
  flow2.generateTarget.versionCount = 2;
  const card2 = ui.renderStep1({ latestVersion: { versionNo: 1 } }, flow2);
  check('★★★★ 已生成：同樣冇匯入掣', !texts(card2).some((t) => /匯入/.test(t)), JSON.stringify(texts(card2)));
}

console.log('\n=== CN：匯入功能仍然留喺「進階與診斷」 ===');
{
  const zone4 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone4.html'), 'utf8');
  check('★★★★★ 進階與診斷仍有「建立匯入表」「檢查並匯入」',
    /zone4Row\('建立匯入表'/.test(zone4) && /zone4Row\('檢查並匯入'/.test(zone4));
  check('★★★★ openImportRoster() 仍然存在（入口只係搬走，功能冇刪）', /function openImportRoster\(/.test(zone4));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);
