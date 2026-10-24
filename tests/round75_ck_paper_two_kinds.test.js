// 第七十五輪批次 CK 組：第 4 步〔下載及匯出〕只剩兩種；〔建立可編輯副本〕搬去「系統出問題時怎樣做」。
// 執行方式：node tests/round75_ck_paper_two_kinds.test.js
//
// Ivan 手動測試 A：「一份整季表，印一張大家看」同「每人一份，不標示名字」重複；
// 「可編輯的試算表副本（最新版本）」都唔要放喺第 4 步。
// 正式發出之後自動建立副本照舊（`EditableCopy.gs` 冇改）。
//
// 呢一份**真係執行** `renderPaperDialog()` 同 `openRecoveryHelp()`。

const vm = require('vm');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
  'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html']);
vm.runInContext("currentQuarterId = '2099T3';", ui);

const body = () => ui.document.getElementById('modalBody');
const actions = () => ui.document.getElementById('modalActions');
const buttonsIn = (node) => node.flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);

console.log('\n=== CK：下載及匯出只剩兩種 ===');
{
  const s = {
    versionNo: 1,
    noEmail: [{ personId: 'P9701', nameTC: '甲', cellCount: 3 }],
    withEmail: [{ personId: 'P9702', nameTC: '乙', cellCount: 2 }]
  };
  vm.runInContext("paperKind_ = 'PERSONAL'; paperSelection_ = {}; paperExtra_ = { extraEmails: [], extraEmailsRaw: '' };", ui);
  ui.renderPaperDialog(s, '');
  const radios = body().flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'radio');
  check('★★★★★★ 只有兩個選項', radios.length === 2, String(radios.length));
  const text = body().textContent;
  check('★★★★★ 兩個係「每人一份，標示…」「每人一份，不標示名字」',
    /每人一份，標示他自己的名字/.test(text) && /每人一份，不標示名字/.test(text), text.slice(0, 300));
  check('★★★★★ 冇「一份整季表，印一張大家看」', !/一份整季表/.test(text));
  check('★★★★★ 冇「可編輯的試算表副本（最新版本）」', !/可編輯的試算表副本/.test(text));
}

console.log('\n=== CK：〔建立可編輯副本〕喺「系統出問題時怎樣做」 ===');
(async () => {
  let editableCalled = 0;
  ui.runAction = async (label, fn) => { await fn(); };
  ui.callServer = async (name) => {
    if (name === 'apiGetRecoveryLinks') {
      return {
        publicLink: { url: 'https://example.invalid/p', note: '' },
        fullPdf: { url: '', note: '' },
        editableCopy: { url: '', note: '' },
        guideSentence: '', guideUrl: ''
      };
    }
    throw new Error('unexpected ' + name);
  };
  ui.runEditableCopy = () => { editableCalled++; };
  ui.openRecoveryHelp();
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  const btns = buttonsIn(actions());
  check('★★★★★★ 彈窗有〔建立可編輯副本〕', btns.indexOf('建立可編輯副本') !== -1, JSON.stringify(btns));
  const b = actions().flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === '建立可編輯副本')[0];
  if (b) b.fire('click');
  check('★★★★★ 撳落去行 runEditableCopy()（同正式發出自動建立嗰支同一條路）', editableCalled === 1, String(editableCalled));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL  拋錯：' + e.stack); process.exit(1); });
